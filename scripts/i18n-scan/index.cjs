/**
 * i18n 扫描脚本 — CLI 入口
 *
 * 用法:
 *   node scripts/i18n-scan/index.cjs              # 默认 scan 执行替换
 *   node scripts/i18n-scan/index.cjs --dry-run    # 预览模式（严格按配置）
 *   node scripts/i18n-scan/index.cjs --scan       # 执行替换（修改源文件 + 更新语言包）
 *   node scripts/i18n-scan/index.cjs --gap        # 盲区扫描（输出所有中文）
 *   node scripts/i18n-scan/index.cjs --translate  # AI 翻译（扫描 + 去重 + 翻译 + 写回）
 */

const path = require("path");
const fs = require("fs");
const { scanFiles } = require("./scanner.cjs");
const {
  loadLocaleReverseMap,
  appendNewKeys,
} = require("./generators/locale-manager.cjs");
const { lookupKey } = require("./generators/key-generator.cjs");
const { replaceInFile } = require("./replacer.cjs");
const { translateViaAI } = require("./translator.cjs");
const { printSeparator, printFileHeader } = require("./utils/logger.cjs");
const { runInit } = require("./init.cjs");

// 脚本所在目录（配置文件 i18n.config.js 位于同级目录）
const SCRIPT_DIR = __dirname;

/**
 * 简单的 Y/n 确认提示
 * @param {string} question - 提示问题
 * @param {boolean} defaultYes - 默认是否选 Yes
 * @returns {Promise<boolean>}
 */
function confirm(question, defaultYes = true) {
  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const hint = defaultYes ? " [Y/n]" : " [y/N]";
  return new Promise((resolve) => {
    rl.question(question + hint + ": ", (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (!trimmed) resolve(defaultYes);
      else resolve(trimmed === "y" || trimmed === "yes");
    });
  });
}

/**
 * 加载配置文件
 * @returns {Promise<object>} 合并默认值后的配置
 */
async function loadConfig() {
  // 配置文件始终与脚本同级
  const configPath = path.join(SCRIPT_DIR, "i18n.config.js");

  // 使用 import() 动态加载 ESM 配置
  const configUrl = `file://${configPath.replace(/\\/g, "/")}`;
  const mod = await import(configUrl);
  const config = mod.default || mod;
  return normalizeConfig(config);
}

/**
 * 规范化配置，填充默认值
 * @param {object} config - 用户配置
 * @returns {object} 规范化后的配置
 */
function normalizeConfig(config) {
  return {
    projectPath: config.projectPath || ".",
    scanScript: config.scanScript !== undefined ? config.scanScript : true,
    entry: config.entry || ["src/**/*.vue"],
    exclude: config.exclude || [],
    output: config.output || "src/locales",
    sourceLanguage: config.sourceLanguage || "zh-CN",
    targetLanguages: config.targetLanguages || ["en"],
    localeStorageKey: config.localeStorageKey || "lang",
    translateAttributes: config.translateAttributes || [],
    ignoreAttributes: config.ignoreAttributes || [],
    ignoreMethods: config.ignoreMethods || [],
    logDir: config.logDir || "logs",
    ai: config.ai || { enabled: false },
  };
}

/**
 * 解析命令行参数
 * @returns {{ mode: 'dry'|'gap'|'scan'|'translate'|'init'|'all'|'interactive' }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes("--dry-run") || args.includes("-d")) return { mode: "dry" };
  if (args.includes("--gap") || args.includes("-g")) return { mode: "gap" };
  if (args.includes("--translate") || args.includes("-t"))
    return { mode: "translate" };
  if (args.includes("--init") || args.includes("-i")) return { mode: "init" };
  if (args.includes("--all") || args.includes("-a")) return { mode: "all" };
  if (args.includes("--scan") || args.includes("-s")) return { mode: "scan" };
  // 无参数 → 交互模式
  if (args.length === 0) return { mode: "interactive" };
  // 有参数但未识别 → 默认 scan
  return { mode: "scan" };
}

// 项目根目录（由配置 projectPath 决定，main() 中赋值）
let PROJECT_ROOT = SCRIPT_DIR;

/**
 * 主函数
 */
async function main() {
  const { mode } = parseArgs();

  // ---- interactive 模式：无参数启动，进入交互式全流程 ----
  if (mode === "interactive") {
    await runInteractiveFlow();
    return;
  }

  // ---- 其他模式：需要配置文件，不存在则引导创建 ----
  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    console.log("\n  未找到配置文件，进入配置向导...");
    console.log(`  (${err.message})\n`);
    const { loadExistingConfig, runSetup } = require("./setup.cjs");
    const { config: existingConfig, configPath } = await loadExistingConfig();
    await runSetup(existingConfig, configPath);
    // 配置创建完成后，重新加载
    try {
      config = await loadConfig();
    } catch (err2) {
      console.error("配置加载失败，退出:", err2.message);
      process.exit(1);
    }
  }

  // 从配置读取项目路径
  PROJECT_ROOT = path.resolve(config.projectPath || SCRIPT_DIR);

  // init 模式
  if (mode === "init") {
    await runInit(config, PROJECT_ROOT);
    return;
  }

  // all 模式：init → translate → scan（非交互）
  if (mode === "all") {
    console.log("========== 全流程模式：init → translate → scan ==========\n");

    console.log("[1/3] 初始化...");
    await runInit(config, PROJECT_ROOT);

    console.log("\n[2/3] AI 翻译...");
    await translateViaAI(config, PROJECT_ROOT);

    console.log("\n[3/3] 扫描替换...");
    await runScanMode(config, "scan");
    return;
  }

  // translate 模式：独立流程，扫描 + AI 翻译 + 写回语言包
  if (mode === "translate") {
    await translateViaAI(config, PROJECT_ROOT);
    return;
  }

  // dry / scan / gap 模式
  await runScanMode(config, mode);
}

/**
 * 交互式全流程：配置 → 初始化 → AI翻译(可选) → 预览 → 替换
 * 每步之间有 Y/n 确认，用户可以逐步查看并决定是否继续
 */
async function runInteractiveFlow() {
  const { loadExistingConfig, runSetup } = require("./setup.cjs");

  console.log("");
  printSeparator("i18n 自动化工具");

  // ========== Step 0: 加载/创建配置 ==========
  const { config: existingConfig, configPath } = await loadExistingConfig();
  let config;

  if (existingConfig) {
    console.log("\n检测到已有配置文件: " + path.relative(PROJECT_ROOT, configPath));
    const wantModify = await confirm("是否修改配置？", false);
    if (wantModify) {
      await runSetup(existingConfig, configPath);
    }
  } else {
    console.log("\n未找到配置文件，进入配置向导...\n");
    await runSetup(null, configPath);
  }

  // 加载配置
  try {
    config = await loadConfig();
  } catch (err) {
    console.error("配置加载失败，退出:", err.message);
    process.exit(1);
  }
  PROJECT_ROOT = path.resolve(config.projectPath || SCRIPT_DIR);

  // ========== Step 1: 初始化 ==========
  console.log("");
  printSeparator("步骤 1/4: 初始化");
  await runInit(config, PROJECT_ROOT);

  if (!(await confirm("\n初始化完成，是否继续？"))) {
    console.log("已退出");
    return;
  }

  // ========== Step 2: AI 翻译（可选） ==========
  let aiTranslated = false;
  if (config.ai && config.ai.enabled) {
    console.log("");
    printSeparator("步骤 2/4: AI 翻译");

    if (!config.ai.apiKey) {
      console.log("AI 翻译已启用但未配置 API Key，跳过");
    } else {
      const wantTranslate = await confirm(
        "\n检测到 AI 翻译已配置，是否进行 AI 翻译？"
      );
      if (wantTranslate) {
        await translateViaAI(config, PROJECT_ROOT);
        aiTranslated = true;
      } else {
        console.log("跳过 AI 翻译");
      }
    }

    if (!(await confirm("\n是否继续？"))) {
      console.log("已退出");
      return;
    }
  }

  // ========== Step 3: 扫描预览 ==========
  const stepNum = config.ai && config.ai.enabled ? "3/4" : "2/3";
  console.log("");
  printSeparator(`步骤 ${stepNum}: 扫描预览`);

  const {
    fileGroups,
    matched,
    unmatched,
    special,
    results,
    filesScanned,
    errors,
    reverseMap,
  } = await prepareScanResults(config, PROJECT_ROOT);

  const totalFound = matched.length + unmatched.length + special.length;
  if (totalFound === 0) {
    console.log("\n未发现中文文本，流程结束");
    return;
  }

  printDryRun(fileGroups, matched, unmatched, special, filesScanned, errors);

  if (!(await confirm("\n请查看以上预览结果，是否继续？"))) {
    console.log("已退出");
    return;
  }

  // ========== Step 4: 执行替换 ==========
  const replaceStepNum = config.ai && config.ai.enabled ? "4/4" : "3/3";
  console.log("");
  printSeparator(`步骤 ${replaceStepNum}: 执行替换`);

  const wantReplace = await confirm(
    "\n以上匹配项将被替换为 $t() 调用，是否执行？"
  );
  if (!wantReplace) {
    console.log("已取消，退出");
    return;
  }

  await runScan(
    fileGroups,
    matched,
    unmatched,
    special,
    filesScanned,
    errors,
    config,
    reverseMap,
    { skipConfirm: true }, // 已经在上面确认过了
  );

  console.log("");
  console.log("全流程完成！请检查修改后的文件，确认无误后提交");
}

/**
 * 扫描并分类结果（dry-run / scan / gap 共用）
 * @param {object} config - 配置
 * @param {string} projectRoot - 项目根目录
 * @returns {Promise<object>} { fileGroups, matched, unmatched, special, results, filesScanned, errors, reverseMap, outputDir }
 */
async function prepareScanResults(config, projectRoot) {
  const outputDir = path.resolve(projectRoot, config.output);

  // 打印配置信息
  console.log("配置加载完成");
  console.log(`  输出目录: ${outputDir}`);
  console.log(`  源语言: ${config.sourceLanguage}`);
  console.log(`  目标语言: ${config.targetLanguages.join(", ")}`);

  // 加载 locale 反向映射
  const { reverseMap, keyCount } = loadLocaleReverseMap(
    outputDir,
    config.sourceLanguage,
  );
  console.log(
    `\n语言包: 从 ${config.sourceLanguage}.json 加载 ${keyCount} 条映射`,
  );

  // 扫描文件
  const { results, errors, filesScanned } = await scanFiles(
    config,
    projectRoot,
  );
  console.log(`  扫描到 ${filesScanned} 个文件`);

  // 分类结果
  const matched = [];
  const unmatched = [];
  const special = [];

  // 用于去重（同一文件同一行同一中文只保留一条）
  const seen = new Set();

  for (const item of results) {
    const { file, line, chineseText, type } = item;

    // 去重 key
    const dedupeKey = `${file}:${line}:${chineseText}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // 特殊类型直接归类
    if (
      type === "special-template-literal" ||
      type === "special-string-concat"
    ) {
      special.push(item);
      continue;
    }

    // 查找 key
    const {
      key,
      module,
      matched: isMatched,
    } = lookupKey(chineseText, reverseMap);

    if (isMatched) {
      matched.push({ ...item, key, module });
    } else {
      unmatched.push({ ...item, key: null, module: null });
    }
  }

  // 按文件分组
  const fileGroups = groupByFile([...matched, ...unmatched, ...special]);

  return {
    fileGroups,
    matched,
    unmatched,
    special,
    results,
    filesScanned,
    errors,
    reverseMap,
    outputDir,
  };
}

/**
 * 扫描模式：dry-run / scan / gap 的公共逻辑
 */
async function runScanMode(config, modeOverride) {
  const mode = modeOverride || parseArgs().mode;

  const {
    fileGroups,
    matched,
    unmatched,
    special,
    results,
    filesScanned,
    errors,
    reverseMap,
  } = await prepareScanResults(config, PROJECT_ROOT);

  if (mode === "dry") {
    printDryRun(fileGroups, matched, unmatched, special, filesScanned, errors);
  } else if (mode === "gap") {
    printGap(results, filesScanned, errors, config);
  } else if (mode === "scan") {
    await runScan(
      fileGroups,
      matched,
      unmatched,
      special,
      filesScanned,
      errors,
      config,
      reverseMap,
      { skipConfirm: true },
    );
  }
}

/**
 * 按文件路径分组
 * @param {object[]} items - 结果数组
 * @returns {object} { 文件路径: [结果项] }
 */
function groupByFile(items) {
  const groups = {};
  for (const item of items) {
    const relPath = item.file
      ? path.relative(PROJECT_ROOT, item.file).replace(/\\/g, "/")
      : "unknown";
    if (!groups[relPath]) groups[relPath] = [];
    groups[relPath].push(item);
  }
  return groups;
}

/**
 * dry-run 输出
 */
function printDryRun(
  fileGroups,
  matched,
  unmatched,
  special,
  filesScanned,
  errors,
) {
  // 文件级摘要
  console.log("");
  const fileNames = Object.keys(fileGroups).sort();
  for (const fileName of fileNames) {
    const items = fileGroups[fileName];
    const matchedCount = items.filter((i) => i.key).length;
    const unmatchedCount = items.filter((i) => !i.key && !i.reason).length;
    const specialCount = items.filter((i) => i.reason).length;
    const parts = [];
    if (matchedCount > 0) parts.push(`${matchedCount} 条已匹配`);
    if (unmatchedCount > 0) parts.push(`${unmatchedCount} 条未匹配`);
    if (specialCount > 0) parts.push(`${specialCount} 条特殊`);
    console.log(`  ${fileName}: ${parts.join(", ")}`);
  }

  printSeparator("预览模式 - 不会修改任何文件");

  // 逐文件详细输出
  for (const fileName of fileNames) {
    const items = fileGroups[fileName];
    // 只输出有匹配或未匹配的文件（特殊项单独输出）
    const normalItems = items.filter((i) => !i.reason);
    if (normalItems.length === 0) continue;

    printFileHeader(fileName);

    for (const item of normalItems) {
      const { line, chineseText, key, type, attrName, context } = item;

      console.log(`  L ${String(line).padEnd(4)} │ ${chineseText}`);

      if (key) {
        // 根据类型显示替换形式
        if (type === "static-attr") {
          console.log(`       │ →  :${attrName}="$t('${key}')"`);
        } else if (type === "dynamic-attr") {
          console.log(`       │ →  $t('${key}')`);
        } else if (type === "text-content") {
          console.log(`       │ →  {{ $t('${key}') }}`);
        } else if (type === "interpolation") {
          console.log(`       │ →  $t('${key}')`);
        } else {
          console.log(`       │ →  $t('${key}')`);
        }
      } else {
        console.log(`       │ →  [未匹配] 需手动处理`);
      }

      if (context) {
        const shortCtx =
          context.length > 70 ? context.slice(0, 70) + "..." : context;
        console.log(`       │ ${shortCtx}`);
      }
    }
  }

  // Key 汇总
  const uniqueKeys = new Map();
  for (const item of matched) {
    if (!uniqueKeys.has(item.key)) {
      uniqueKeys.set(item.key, {
        key: item.key,
        module: item.module,
        chineseText: item.chineseText,
      });
    }
  }

  if (uniqueKeys.size > 0) {
    console.log("");
    printSeparator(`Key 汇总 (${uniqueKeys.size} 个唯一 key)`);

    // 按模块分组
    const moduleGroups = {};
    for (const [, entry] of uniqueKeys) {
      const mod = entry.module || "unknown";
      if (!moduleGroups[mod]) moduleGroups[mod] = [];
      moduleGroups[mod].push(entry);
    }

    for (const mod of Object.keys(moduleGroups).sort()) {
      for (const entry of moduleGroups[mod]) {
        console.log(`  [${mod}] ${entry.chineseText} → $t('${entry.key}')`);
      }
    }
  }

  // 特殊：本期不处理
  if (special.length > 0) {
    console.log("");
    printSeparator("特殊：本期不处理");

    const specialByFile = {};
    for (const item of special) {
      const relPath = item.file
        ? path.relative(PROJECT_ROOT, item.file).replace(/\\/g, "/")
        : "unknown";
      if (!specialByFile[relPath]) specialByFile[relPath] = [];
      specialByFile[relPath].push(item);
    }

    for (const fileName of Object.keys(specialByFile).sort()) {
      const items = specialByFile[fileName];
      console.log(`\n  ${fileName} (${items.length} 处)`);
      for (const item of items) {
        console.log(
          `    L ${String(item.line).padEnd(4)} │ ${item.chineseText} → ${
            item.reason
          }`,
        );
        if (item.context) {
          const shortCtx =
            item.context.length > 70
              ? item.context.slice(0, 70) + "..."
              : item.context;
          console.log(`         │ ${shortCtx}`);
        }
      }
    }
  }

  // 汇总
  console.log("");
  printSeparator("i18n 扫描汇总");
  console.log(`  扫描文件:     ${filesScanned}`);
  console.log(
    `  发现字符串:   ${matched.length + unmatched.length + special.length}`,
  );
  console.log(`  已匹配:       ${matched.length}`);
  console.log(`  未匹配:       ${unmatched.length}`);
  console.log(`  特殊-未处理:  ${special.length}`);
  console.log(`  错误:         ${errors.length}`);
  printSeparator();
}

/**
 * gap 盲区扫描输出
 * 输出所有中文，不受配置限制
 */
function printGap(allResults, filesScanned, errors, config) {
  console.log("");
  printSeparator("盲区扫描（所有中文）");

  // 去重
  const seen = new Set();
  const uniqueResults = [];
  for (const item of allResults) {
    const dedupeKey = `${item.file}:${item.line}:${item.chineseText}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    uniqueResults.push(item);
  }

  // 按文件分组
  const byFile = {};
  for (const item of uniqueResults) {
    const relPath = item.file
      ? path.relative(PROJECT_ROOT, item.file).replace(/\\/g, "/")
      : "unknown";
    if (!byFile[relPath]) byFile[relPath] = [];
    byFile[relPath].push(item);
  }

  let totalCount = 0;
  for (const fileName of Object.keys(byFile).sort()) {
    const items = byFile[fileName];
    totalCount += items.length;
    console.log(`\n  ${fileName} (${items.length} 处)`);
    for (const item of items) {
      // 判断状态
      let status = "";
      if (item.type === "special-template-literal") {
        status = "含变量插值";
      } else if (item.type === "special-string-concat") {
        status = "字符串+拼接";
      } else if (item.type === "static-attr") {
        const inWhitelist =
          config.translateAttributes &&
          config.translateAttributes.includes(item.attrName);
        status = inWhitelist ? "白名单属性" : "不在白名单";
      } else if (item.type === "dynamic-attr") {
        const inWhitelist =
          config.translateAttributes &&
          config.translateAttributes.includes(item.attrName);
        status = inWhitelist ? "白名单属性" : "不在白名单";
      } else {
        status = item.type;
      }

      console.log(`    L ${String(item.line).padEnd(4)} │ ${item.chineseText}`);
      console.log(`         │ 类型: ${item.type} 状态: ${status}`);
      if (item.context) {
        const shortCtx =
          item.context.length > 70
            ? item.context.slice(0, 70) + "..."
            : item.context;
        console.log(`         │ ${shortCtx}`);
      }
    }
  }

  console.log("");
  printSeparator("盲区扫描汇总");
  console.log(`  扫描文件:     ${filesScanned}`);
  console.log(
    `  盲区合计:     ${totalCount} 处，涉及 ${
      Object.keys(byFile).length
    } 个文件`,
  );
  console.log(`  错误:         ${errors.length}`);
  printSeparator();

  // 写入日志文件
  writeGapLog(byFile, totalCount, filesScanned, errors, config);
}

/**
 * 将 gap 盲区扫描结果写入日志文件
 */
function writeGapLog(byFile, totalCount, filesScanned, errors, config) {
  const logDir = path.resolve(PROJECT_ROOT, config.logDir || "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logFile = path.join(logDir, `i18n-gap-${dateStr}.log`);

  const lines = [];
  lines.push(`i18n 盲区扫描报告`);
  lines.push(`生成时间: ${new Date().toISOString()}`);
  lines.push(`扫描文件: ${filesScanned} 个`);
  lines.push(
    `盲区合计: ${totalCount} 处，涉及 ${Object.keys(byFile).length} 个文件`,
  );
  lines.push(`=`.repeat(60));
  lines.push("");

  for (const fileName of Object.keys(byFile).sort()) {
    const items = byFile[fileName];
    lines.push(`[${fileName}] (${items.length} 处)`);
    for (const item of items) {
      let status = "";
      if (item.type === "special-template-literal") {
        status = "含变量插值";
      } else if (item.type === "special-string-concat") {
        status = "字符串+拼接";
      } else if (item.type === "static-attr" || item.type === "dynamic-attr") {
        const inWhitelist =
          config.translateAttributes &&
          config.translateAttributes.includes(item.attrName);
        status = inWhitelist ? "白名单属性" : "不在白名单";
      } else {
        status = item.type;
      }
      lines.push(`  L ${String(item.line).padEnd(4)} │ ${item.chineseText}`);
      lines.push(`       │ 类型: ${item.type} 状态: ${status}`);
      if (item.context) {
        lines.push(`       │ ${item.context}`);
      }
    }
    lines.push("");
  }

  if (errors.length > 0) {
    lines.push(`[错误] ${errors.length} 个`);
    for (const err of errors) {
      lines.push(`  ${err.file}: ${err.message}`);
    }
    lines.push("");
  }

  fs.writeFileSync(logFile, lines.join("\n"), "utf-8");
  console.log(`\n  盲区日志: ${path.relative(PROJECT_ROOT, logFile)}`);
}

/**
 * scan 模式：执行实际替换 + 更新语言包
 */
async function runScan(
  fileGroups,
  matched,
  unmatched,
  special,
  filesScanned,
  errors,
  config,
  reverseMap,
  options = {},
) {
  const { skipConfirm = false } = options;
  const outputDir = path.resolve(PROJECT_ROOT, config.output);

  // 先展示预览
  printDryRun(fileGroups, matched, unmatched, special, filesScanned, errors);

  // 确认提示
  console.log("");
  printSeparator("警告：即将修改源文件");
  console.log("  以上匹配项将被替换为 $t() 调用");
  if (unmatched.length > 0) {
    console.log(`  ${unmatched.length} 条未匹配的中文将追加到语言包`);
  }
  console.log("");

  if (!skipConfirm) {
    const ok = await confirm("是否执行替换？");
    if (!ok) {
      console.log("已取消");
      return;
    }
  }

  // 执行替换
  let filesModified = 0;
  const allNewKeys = [];

  for (const [relPath, items] of Object.entries(fileGroups)) {
    const filePath = path.resolve(PROJECT_ROOT, relPath);
    if (!fs.existsSync(filePath)) continue;

    const { changed, newKeys } = replaceInFile(filePath, items, reverseMap);
    if (changed) filesModified++;
    allNewKeys.push(...newKeys);
  }

  // 追加未匹配的中文到语言包
  const newChineseTexts = unmatched.map((item) => item.chineseText);
  const addedKeys = appendNewKeys(
    outputDir,
    config.sourceLanguage,
    config.targetLanguages,
    newChineseTexts,
  );

  // 输出结果
  console.log("");
  printSeparator("替换完成");
  console.log(`  修改文件:     ${filesModified}`);
  console.log(`  已匹配替换:   ${matched.length}`);
  console.log(`  未匹配跳过:   ${unmatched.length}`);
  console.log(`  特殊跳过:     ${special.length}`);

  if (addedKeys.length > 0) {
    console.log("");
    console.log("  ⚠ 以下中文未匹配，已追加到语言包，请手动翻译:");
    for (const item of addedKeys) {
      console.log(`    + [common] ${item.chineseText} → $t('${item.key}')`);
    }
  }

  console.log("");
  console.log("  提示: 请检查修改后的文件，确认无误后提交");
  printSeparator();
}

// 执行
main().catch((err) => {
  console.error("脚本执行失败:", err);
  process.exit(1);
});

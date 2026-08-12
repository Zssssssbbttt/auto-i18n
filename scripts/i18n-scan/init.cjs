/**
 * i18n 初始化脚本
 * 生成 locale 目录结构、语言包空文件、index.ts 配置、useI18n composable
 * 同时更新 main.ts 中的 i18n 引入路径
 *
 * 版本专用逻辑（generateIndexContent / updateMainTs / 模板生成）已提取到 init/ 目录，
 * 本文件只保留共享逻辑 + 版本调度。
 *
 * 用法: node scripts/i18n-scan/init.cjs
 */

const path = require("path");
const fs = require("fs");
const { validateLocalePaths } = require("./utils/validate-locales.cjs");

// 脚本所在目录（配置文件 i18n.config.js 位于同级目录）
const SCRIPT_DIR = __dirname;

/**
 * 加载配置文件
 */
async function loadConfig() {
  const configPath = path.join(SCRIPT_DIR, "i18n.config.js");
  try {
    const configUrl = `file://${configPath.replace(/\\/g, "/")}`;
    const mod = await import(configUrl);
    return mod.default || mod;
  } catch (err) {
    console.error(`无法加载配置文件: ${configPath}`);
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * 将语言代码转为变量名（camelCase）
 * zh-CN → zhCN, en → en, th → th
 */
function langToVarName(lang) {
  const parts = lang.split("-");
  return (
    parts[0].toLowerCase() +
    parts
      .slice(1)
      .map((p) => p[0].toUpperCase() + p.slice(1))
      .join("")
  );
}

/**
 * 获取已有 index.ts 中缺失的语言列表
 * @param {string} filePath - index.ts 路径
 * @param {string[]} allLangs - 所有语言代码列表
 * @returns {string[]} 缺失的语言代码列表
 */
function getMissingLangs(filePath, allLangs) {
  if (!fs.existsSync(filePath)) return [...allLangs]
  const content = fs.readFileSync(filePath, "utf-8")
  const missing = []
  for (const lang of allLangs) {
    const varName = langToVarName(lang)
    const importPattern = new RegExp(
      `import\\s+${varName}\\s+from\\s+['"]\\.\\/${lang}\\.json['"]`
    )
    if (!importPattern.test(content)) {
      missing.push(lang)
    }
  }
  return missing
}

/**
 * 执行初始化逻辑（可由 index.cjs --all 调用）
 * @param {object} config - i18n 配置
 * @param {string} projectRoot - 项目根目录
 * @param {object} [options] - 可选参数
 * @param {boolean} [options.interactive] - 是否交互模式（校验失败时询问用户）
 * @param {Function} [options.confirmFn] - 交互确认函数 (question, defaultYes) => Promise<boolean>
 */
async function runInit(config, projectRoot, options = {}) {
  const { interactive = false, confirmFn = null } = options;
  const outputDir = path.resolve(projectRoot, config.output || "src/locales");
  const sourceLang = config.sourceLanguage || "zh-CN";
  const targetLangs = config.targetLanguages || ["en"];

  // ========== 共享逻辑：目录 + 空 JSON + 共享包校验 ==========

  // 确保目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 创建源语言空文件
  const sourceFile = path.join(outputDir, `${sourceLang}.json`);
  if (!fs.existsSync(sourceFile)) {
    fs.writeFileSync(sourceFile, "{}\n", "utf-8");
    console.log(`  创建: ${sourceLang}.json`);
  } else {
    console.log(`  跳过: ${sourceLang}.json（已存在）`);
  }

  // 创建目标语言空文件
  for (const lang of targetLangs) {
    if (lang === sourceLang) continue;
    const targetFile = path.join(outputDir, `${lang}.json`);
    if (!fs.existsSync(targetFile)) {
      fs.writeFileSync(targetFile, "{}\n", "utf-8");
      console.log(`  创建: ${lang}.json`);
    } else {
      console.log(`  跳过: ${lang}.json（已存在）`);
    }
  }

  // 校验共享语言包
  const sharedLocales = config.sharedLocales || [];
  let validSharedLocales = [];

  if (sharedLocales.length > 0) {
    const { valid, errors } = validateLocalePaths(
      sharedLocales,
      projectRoot,
      sourceLang,
      targetLangs
    );

    if (valid) {
      validSharedLocales = sharedLocales;
      console.log(`  共享语言包校验通过: ${sharedLocales.length} 个`);
    } else {
      console.log(`\n  共享语言包校验失败:`);
      for (const err of errors) {
        console.log(`    - ${err}`);
      }

      if (interactive && confirmFn) {
        const proceed = await confirmFn(
          "\n  是否继续？（继续将不合并共享语言包，生成标准 index.ts）",
          true
        );
        if (!proceed) {
          console.log("  已中止");
          process.exit(1);
        }
        console.log("  继续，将不合并共享语言包");
      } else {
        console.log("  警告: 共享语言包校验未通过，将不合并共享语言包");
      }
    }
  }

  // ========== 版本调度：加载对应版本的模块 ==========

  const vueVersion = config.vueVersion || 3;
  const api = require(`./init/init-vue${vueVersion}.cjs`);

  // ========== 生成文件（统一接口调用） ==========

  // 创建/更新 index.ts
  const indexFile = path.join(outputDir, "index.ts");
  const allLangs = [sourceLang, ...targetLangs.filter((l) => l !== sourceLang)];
  const missingLangs = getMissingLangs(indexFile, allLangs);

  if (missingLangs.length > 0) {
    if (fs.existsSync(indexFile)) {
      // 补齐缺失的语言注册
      const existingContent = fs.readFileSync(indexFile, "utf-8");
      const patchedContent = api.patchIndexContent(existingContent, config, missingLangs);
      fs.writeFileSync(indexFile, patchedContent, "utf-8");
      console.log(`  更新: index.ts（添加 ${missingLangs.join(', ')} 语言注册）`);
    } else {
      const indexContent = api.generateIndexContent(
        config,
        outputDir,
        projectRoot,
        validSharedLocales
      );
      fs.writeFileSync(indexFile, indexContent, "utf-8");
      console.log(`  创建: index.ts`);
    }
  } else {
    console.log(`  跳过: index.ts（已存在且语言配置完整）`);
  }

  // 创建 typeToString.ts
  const typeToStringFile = path.join(outputDir, "typeToString.ts");
  if (!fs.existsSync(typeToStringFile)) {
    fs.writeFileSync(typeToStringFile, api.generateTypeToString(), "utf-8");
    console.log(`  创建: typeToString.ts`);
  } else {
    console.log(`  跳过: typeToString.ts（已存在）`);
  }

  // 创建 toI18n.ts
  const toI18nFile = path.join(outputDir, "toI18n.ts");
  if (!fs.existsSync(toI18nFile)) {
    fs.writeFileSync(toI18nFile, api.generateToI18n(), "utf-8");
    console.log(`  创建: toI18n.ts`);
  } else {
    console.log(`  跳过: toI18n.ts（已存在）`);
  }

  // 创建 useI18n composable
  const composableFile = path.join(outputDir, "useI18n.ts");
  if (!fs.existsSync(composableFile)) {
    fs.writeFileSync(composableFile, api.generateUseI18n(), "utf-8");
    console.log(`  创建: useI18n.ts`);
  } else {
    console.log(`  跳过: useI18n.ts（已存在）`);
  }

  // 更新 main.ts
  api.updateMainTs(projectRoot);

  console.log("\n初始化完成");
}

/**
 * CLI 入口（独立运行时）
 */
async function main() {
  const config = await loadConfig();
  const projectRoot = path.resolve(config.projectPath || SCRIPT_DIR);
  await runInit(config, projectRoot);
}

module.exports = { runInit };

if (require.main === module) {
  main().catch((err) => {
    console.error("初始化失败:", err);
    process.exit(1);
  });
}
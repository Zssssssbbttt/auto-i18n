/**
 * i18n 初始化脚本
 * 生成 locale 目录结构、语言包空文件、index.ts 配置、useI18n composable
 * 同时更新 main.ts 中的 i18n 引入路径
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
  // 配置文件始终与脚本同级
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
  const storageKey = config.localeStorageKey || "lang";

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

  // 创建 index.ts（i18n 配置 + $t 导出 + Element Plus 集成）
  const indexFile = path.join(outputDir, "index.ts");
  if (!fs.existsSync(indexFile)) {
    const indexContent = generateIndexContent(
      config,
      outputDir,
      projectRoot,
      validSharedLocales
    );

    fs.writeFileSync(indexFile, indexContent, "utf-8");
    console.log(`  创建: index.ts`);
  } else {
    console.log(`  跳过: index.ts（已存在）`);
  }

  // 创建 typeToString.ts
  const typeToStringFile = path.join(outputDir, "typeToString.ts");
  if (!fs.existsSync(typeToStringFile)) {
    const typeToStringContent = `import i18n from './index'

/**
 * 将 $t 的返回值强制转为 string 类型
 * 解决 vue-i18n 中 $t 返回 TranslateResult 联合类型导致的 TS 类型报错
 */
export function i18nTypeToString(key: string): string {
  const result = i18n.global.t(key)
  return typeof result === 'string' ? result : String(result)
}
`;
    fs.writeFileSync(typeToStringFile, typeToStringContent, "utf-8");
    console.log(`  创建: typeToString.ts`);
  } else {
    console.log(`  跳过: typeToString.ts（已存在）`);
  }

  // 创建 useI18n composable
  const composableFile = path.join(outputDir, "useI18n.ts");
  if (!fs.existsSync(composableFile)) {
    const composableContent = `import i18n from './index'

/**
 * i18n composable
 * 在 <script setup> 中使用: const { t } = useI18n()
 * 模板中可直接使用 {{ t('key') }}
 */
export function useI18n() {
  return { t: i18n.global.t }
}
`;
    fs.writeFileSync(composableFile, composableContent, "utf-8");
    console.log(`  创建: useI18n.ts`);
  } else {
    console.log(`  跳过: useI18n.ts（已存在）`);
  }

  // 更新 main.ts 中的 i18n 引入路径
  updateMainTs(projectRoot);

  console.log("\n初始化完成");
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
 * 生成 index.ts 内容
 * @param {object} config - i18n 配置
 * @param {string} outputDir - locale 输出目录（绝对路径）
 * @param {string} projectRoot - 项目根目录
 * @param {string[]} validSharedLocales - 校验通过的共享语言包路径列表
 * @returns {string} index.ts 文件内容
 */
function generateIndexContent(
  config,
  outputDir,
  projectRoot,
  validSharedLocales
) {
  const sourceLang = config.sourceLanguage || "zh-CN";
  const targetLangs = config.targetLanguages || ["en"];
  const storageKey = config.localeStorageKey || "lang";
  const uiLibrary = config.uiLibrary || "element-plus";
  const allLangs = [sourceLang, ...targetLangs.filter((l) => l !== sourceLang)];

  // 生成共享语言包的 import 语句
  let sharedImports = "";
  const sharedVars = {}; // { 'zh-CN': ['sharedZhCN0', 'sharedZhCN1'], 'en': ['sharedEn0', 'sharedEn1'] }
  for (const lang of allLangs) {
    sharedVars[lang] = [];
  }

  for (let i = 0; i < validSharedLocales.length; i++) {
    const sharedPath = validSharedLocales[i];
    const absSharedPath = path.resolve(projectRoot, sharedPath);
    let relPath = path.relative(outputDir, absSharedPath).replace(/\\/g, "/");
    if (!relPath.startsWith(".")) {
      relPath = "./" + relPath;
    }

    for (const lang of allLangs) {
      const varName = `shared${langToVarName(lang)}${i}`;
      sharedImports += `import ${varName} from '${relPath}/${lang}.json'\n`;
      sharedVars[lang].push(varName);
    }
  }

  const hasShared = validSharedLocales.length > 0;

  // deepMerge 工具函数（有共享包时才生成）
  const deepMergeFn = hasShared
    ? `
function deepMerge(target: any, ...sources: any[]): any {
  for (const source of sources) {
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key]) target[key] = {}
        deepMerge(target[key], source[key])
      } else {
        target[key] = source[key]
      }
    }
  }
  return target
}
`
    : "";

  // 构建 messages 对象
  const messagesLines = allLangs
    .map((lang) => {
      const localVar = langToVarName(lang);
      if (hasShared) {
        const args = ["{}", ...sharedVars[lang], localVar].join(", ");
        return `    '${lang}': deepMerge(${args}),`;
      }
      return `    '${lang}': ${localVar},`;
    })
    .join("\n");

  // 构建本地语言包 import
  const localImports = allLangs
    .map((lang) => `import ${langToVarName(lang)} from './${lang}.json'`)
    .join("\n");

  if (uiLibrary === "element-plus") {
    return `import { createI18n } from 'vue-i18n'
import { i18nTypeToString } from './typeToString'
import { ref, watch } from 'vue'
import { localeContextKey } from 'element-plus'
${localImports}
${sharedImports}import zhCNElement from 'element-plus/dist/locale/zh-cn.mjs'
import enElement from 'element-plus/dist/locale/en.mjs'${deepMergeFn}
const elementLocales: Record<string, any> = {
  'zh-CN': zhCNElement,
  en: enElement,
}

const currentElementLocale = ref(
  elementLocales[localStorage.getItem('${storageKey}') || 'zh-CN'] ||
    elementLocales['zh-CN']
)

const i18n = createI18n({
  legacy: false,
  locale: localStorage.getItem('${storageKey}') || 'zh-CN',
  messages: {
${messagesLines}
  },
  silentTranslationWarn: true,
})

watch(
  () => i18n.global.locale.value,
  (newLocale) => {
    currentElementLocale.value =
      elementLocales[newLocale] || elementLocales['zh-CN']
  }
)

// 拦截 install，在 app.use(i18n) 时自动 provide Element Plus 的 locale
const originalInstall = i18n.install.bind(i18n)
i18n.install = (app: any) => {
  originalInstall(app)
  app.provide(localeContextKey, currentElementLocale)
}

export const $t = i18n.global.t

export default i18n

// 全局注册 $t，可在 script setup 中直接使用
export function setupI18n(app: any) {
  app.use(i18n)
  app.config.globalProperties.$t = i18n.global.t
  app.config.globalProperties.i18nTypeToString = i18nTypeToString
}
`;
  } else {
    return `import { createI18n } from 'vue-i18n'
${localImports}
${sharedImports}${deepMergeFn}
const i18n = createI18n({
  legacy: false,
  locale: localStorage.getItem('${storageKey}') || 'zh-CN',
  messages: {
${messagesLines}
  },
  silentTranslationWarn: true,
})

export const $t = i18n.global.t

export default i18n

export function setupI18n(app: any) {
  app.use(i18n)
  app.config.globalProperties.$t = i18n.global.t
}
`;
  }
}

/**
 * CLI 入口（独立运行时）
 */
async function main() {
  const config = await loadConfig();
  const projectRoot = path.resolve(config.projectPath || SCRIPT_DIR);
  await runInit(config, projectRoot);
}

/**
 * 更新 main.ts：补全 i18n 引入、全局 $t 注册、app.use(i18n)
 */
function updateMainTs(projectRoot) {
  const mainFile = path.join(projectRoot, "src", "main.ts");
  if (!fs.existsSync(mainFile)) {
    console.log("  警告: 未找到 src/main.ts，跳过引入路径更新");
    return;
  }

  let content = fs.readFileSync(mainFile, "utf-8");
  const newImport = "import i18n, { $t } from './locales'";
  const vnetImport = "import { setI18nInstance, getComponentMessages } from '@vnet/i18n'";
  let changed = false;

  // 1. 处理 import 引入
  if (content.includes(newImport)) {
    console.log("  跳过: main.ts 引入路径已正确");
  } else {
    // 完全没有 i18n 引入，自动补上
    const lines = content.split("\n");
    let lastImportLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^import\s+.+/.test(lines[i].trim())) {
        lastImportLine = i;
      }
    }
    if (lastImportLine >= 0) {
      lines.splice(lastImportLine + 1, 0, newImport);
      lastImportLine++; // 插入了一行，lastImportLine 后移
      content = lines.join("\n");
      console.log("  新增: main.ts 添加 i18n 引入");
      changed = true;
    } else {
      console.log("  警告: main.ts 中未找到 import 语句，请手动添加 i18n 引入");
    }
  }

  // 1.1 处理 @vnet/i18n 引入
  if (content.includes(vnetImport)) {
    console.log("  跳过: main.ts @vnet/i18n 引入已存在");
  } else {
    const lines = content.split("\n");
    let lastImportLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^import\s+.+/.test(lines[i].trim())) {
        lastImportLine = i;
      }
    }
    if (lastImportLine >= 0) {
      lines.splice(lastImportLine + 1, 0, vnetImport);
      content = lines.join("\n");
      console.log("  新增: main.ts 添加 @vnet/i18n 引入");
      changed = true;
    } else {
      console.log("  警告: main.ts 中未找到 import 语句，请手动添加 @vnet/i18n 引入");
    }
  }

  // 2. 检查并补全全局 $t 注册 + @vnet/i18n 注册
  const globalTLine = "app.config.globalProperties.$t = $t";
  if (!content.includes(globalTLine)) {
    const lines = content.split("\n");
    let inserted = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(?:const\s+)?app\s*=\s*createApp/.test(lines[i].trim())) {
        lines.splice(
          i + 1,
          0,
          "",
          `// 全局注册 $t，模板中可直接使用`,
          globalTLine,
          "",
          `// 将公共组件词条合并到当前 i18n 实例，并注册到 @vnet/i18n，`,
          `// 使 FlowProcess 等公共组件能随项目语言切换`,
          `const compMsgs = getComponentMessages()`,
          `for (const locale of Object.keys(compMsgs)) {`,
          `  i18n.global.mergeLocaleMessage(locale, compMsgs[locale])`,
          `}`,
          `setI18nInstance(i18n)`,
        );
        content = lines.join("\n");
        console.log("  新增: main.ts 添加全局 $t 注册及 @vnet/i18n 注册");
        changed = true;
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      console.log("  警告: 未找到 createApp，请手动添加全局 $t 注册");
    }
  } else {
    console.log("  跳过: main.ts 全局 $t 注册已存在");
    // 即使 $t 已存在，也要检查 @vnet/i18n 注册代码
    if (!content.includes("setI18nInstance(i18n)")) {
      const lines = content.split("\n");
      let inserted = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === globalTLine) {
          lines.splice(
            i + 1,
            0,
            "",
            `// 将公共组件词条合并到当前 i18n 实例，并注册到 @vnet/i18n，`,
            `// 使 FlowProcess 等公共组件能随项目语言切换`,
            `const compMsgs = getComponentMessages()`,
            `for (const locale of Object.keys(compMsgs)) {`,
            `  i18n.global.mergeLocaleMessage(locale, compMsgs[locale])`,
            `}`,
            `setI18nInstance(i18n)`,
          );
          content = lines.join("\n");
          console.log("  新增: main.ts 添加 @vnet/i18n 注册代码");
          changed = true;
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        console.log("  警告: 未找到全局 $t 注册行，请手动添加 @vnet/i18n 注册代码");
      }
    } else {
      console.log("  跳过: main.ts @vnet/i18n 注册代码已存在");
    }
  }

  // 3. 检查并补全 app.use(i18n)，插入到 .mount( 之前的链式调用中
  if (!content.includes(".use(i18n)")) {
    const lines = content.split("\n");
    let inserted = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // 跳过注释行
      if (trimmed.startsWith("//") || trimmed.startsWith("/*")) continue;

      const mountIdx = line.indexOf(".mount(");
      if (mountIdx === -1) continue;

      // .mount( 之前的内容（去掉尾部空白）
      const beforeMount = line.slice(0, mountIdx).trimEnd();

      if (!beforeMount) {
        // 模式 A: 缩进续行 — 行首只有空白，然后是 .mount(
        //   app
        //     .use(router)
        //     .mount('#app')
        // → 提取缩进，插入 .use(i18n) 到上一行
        const indent = line.slice(0, line.length - line.trimStart().length);
        lines.splice(i, 0, `${indent}.use(i18n)`);
      } else if (beforeMount.endsWith(")")) {
        // 模式 B: 同行链式调用 — .mount( 前有 ).use() 等链式调用
        //   app.use(router).mount('#app')
        //   createApp(App).use(router).mount('#app')
        // → 在 .mount( 前插入 .use(i18n)
        lines[i] = beforeMount + ".use(i18n)" + line.slice(mountIdx);
      } else {
        // 模式 C: 独立调用 — 行首是变量名.mount(
        //   app.mount('#app')
        // → 提取变量名和缩进，插入独立调用行
        const indent = line.slice(0, line.length - line.trimStart().length);
        const varName = beforeMount.trim();
        lines.splice(i, 0, `${indent}${varName}.use(i18n)`);
      }

      content = lines.join("\n");
      console.log("  新增: main.ts 添加 app.use(i18n)");
      changed = true;
      inserted = true;
      break;
    }

    if (!inserted) {
      console.log("  警告: 未找到 .mount(，请手动添加 app.use(i18n)");
    }
  } else {
    console.log("  跳过: main.ts app.use(i18n) 已存在");
  }

  if (changed) {
    fs.writeFileSync(mainFile, content, "utf-8");
  }
}

module.exports = { runInit };

if (require.main === module) {
  main().catch((err) => {
    console.error("初始化失败:", err);
    process.exit(1);
  });
}

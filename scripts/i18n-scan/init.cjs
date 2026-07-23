/**
 * i18n 初始化脚本
 * 生成 locale 目录结构、语言包空文件、index.ts 配置、useI18n composable
 * 同时更新 main.ts 中的 i18n 引入路径
 *
 * 用法: node scripts/i18n-scan/init.cjs
 */

const path = require('path')
const fs = require('fs')

// 脚本所在目录（配置文件 i18n.config.js 位于同级目录）
const SCRIPT_DIR = __dirname

/**
 * 加载配置文件
 */
async function loadConfig() {
  // 配置文件始终与脚本同级
  const configPath = path.join(SCRIPT_DIR, 'i18n.config.js')
  try {
    const configUrl = `file://${configPath.replace(/\\/g, '/')}`
    const mod = await import(configUrl)
    return mod.default || mod
  } catch (err) {
    console.error(`无法加载配置文件: ${configPath}`)
    console.error(err.message)
    process.exit(1)
  }
}

/**
 * 执行初始化逻辑（可由 index.cjs --all 调用）
 * @param {object} config - i18n 配置
 * @param {string} projectRoot - 项目根目录
 */
async function runInit(config, projectRoot) {
  const outputDir = path.resolve(projectRoot, config.output || 'src/locales')
  const sourceLang = config.sourceLanguage || 'zh-CN'
  const targetLangs = config.targetLanguages || ['en']
  const storageKey = config.localeStorageKey || 'lang'

  // 确保目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // 创建源语言空文件
  const sourceFile = path.join(outputDir, `${sourceLang}.json`)
  if (!fs.existsSync(sourceFile)) {
    fs.writeFileSync(sourceFile, '{}\n', 'utf-8')
    console.log(`  创建: ${sourceLang}.json`)
  } else {
    console.log(`  跳过: ${sourceLang}.json（已存在）`)
  }

  // 创建目标语言空文件
  for (const lang of targetLangs) {
    if (lang === sourceLang) continue
    const targetFile = path.join(outputDir, `${lang}.json`)
    if (!fs.existsSync(targetFile)) {
      fs.writeFileSync(targetFile, '{}\n', 'utf-8')
      console.log(`  创建: ${lang}.json`)
    } else {
      console.log(`  跳过: ${lang}.json（已存在）`)
    }
  }

  // 创建 index.ts（i18n 配置 + $t 导出 + Element Plus 集成）
  const indexFile = path.join(outputDir, 'index.ts')
  if (!fs.existsSync(indexFile)) {
    const indexContent = `import { createI18n } from 'vue-i18n'
import { i18nTypeToString } from './typeToString'
import { ref, watch } from 'vue'
import { localeContextKey } from 'element-plus'
import zhCN from './zh-CN.json'
import en from './en.json'
import zhCNElement from 'element-plus/dist/locale/zh-cn.mjs'
import enElement from 'element-plus/dist/locale/en.mjs'

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
    'zh-CN': zhCN,
    en: en,
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
`
    fs.writeFileSync(indexFile, indexContent, 'utf-8')
    console.log(`  创建: index.ts`)
  } else {
    console.log(`  跳过: index.ts（已存在）`)
  }

  // 创建 typeToString.ts
  const typeToStringFile = path.join(outputDir, 'typeToString.ts')
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
`
    fs.writeFileSync(typeToStringFile, typeToStringContent, 'utf-8')
    console.log(`  创建: typeToString.ts`)
  } else {
    console.log(`  跳过: typeToString.ts（已存在）`)
  }

  // 创建 useI18n composable
  const composableFile = path.join(outputDir, 'useI18n.ts')
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
`
    fs.writeFileSync(composableFile, composableContent, 'utf-8')
    console.log(`  创建: useI18n.ts`)
  } else {
    console.log(`  跳过: useI18n.ts（已存在）`)
  }

  // 更新 main.ts 中的 i18n 引入路径
  updateMainTs(projectRoot)

  console.log('\n初始化完成')
}

/**
 * CLI 入口（独立运行时）
 */
async function main() {
  const config = await loadConfig()
  const projectRoot = path.resolve(config.projectPath || SCRIPT_DIR)
  await runInit(config, projectRoot)
}

/**
 * 更新 main.ts：补全 i18n 引入、全局 $t 注册、app.use(i18n)
 */
function updateMainTs(projectRoot) {
  const mainFile = path.join(projectRoot, 'src', 'main.ts')
  if (!fs.existsSync(mainFile)) {
    console.log('  警告: 未找到 src/main.ts，跳过引入路径更新')
    return
  }

  let content = fs.readFileSync(mainFile, 'utf-8')
  const newImport = "import i18n, { $t } from './locales'"
  let changed = false

  // 1. 处理 import 引入
  if (content.includes(newImport)) {
    console.log('  跳过: main.ts 引入路径已正确')
  } else {
    // 完全没有 i18n 引入，自动补上
    const lines = content.split('\n')
    let lastImportLine = -1
    for (let i = 0; i < lines.length; i++) {
      if (/^import\s+.+/.test(lines[i].trim())) {
        lastImportLine = i
      }
    }
    if (lastImportLine >= 0) {
      lines.splice(lastImportLine + 1, 0, newImport)
      content = lines.join('\n')
      console.log('  新增: main.ts 添加 i18n 引入')
      changed = true
    } else {
      console.log('  警告: main.ts 中未找到 import 语句，请手动添加 i18n 引入')
    }
  }

  // 2. 检查并补全全局 $t 注册
  const globalTLine = 'app.config.globalProperties.$t = $t'
  if (!content.includes(globalTLine)) {
    const lines = content.split('\n')
    let inserted = false
    for (let i = 0; i < lines.length; i++) {
      if (/^const\s+app\s*=\s*createApp/.test(lines[i].trim())) {
        lines.splice(
          i + 1,
          0,
          '',
          `// 全局注册 $t，模板中可直接使用`,
          globalTLine
        )
        content = lines.join('\n')
        console.log('  新增: main.ts 添加全局 $t 注册')
        changed = true
        inserted = true
        break
      }
    }
    if (!inserted) {
      console.log('  警告: 未找到 createApp，请手动添加全局 $t 注册')
    }
  } else {
    console.log('  跳过: main.ts 全局 $t 注册已存在')
  }

  // 3. 检查并补全 app.use(i18n)
  if (!content.includes('.use(i18n)')) {
    const lines = content.split('\n')
    let inserted = false
    for (let i = 0; i < lines.length; i++) {
      if (/\.mount\(/.test(lines[i].trim())) {
        lines.splice(i, 0, 'app.use(i18n)')
        content = lines.join('\n')
        console.log('  新增: main.ts 添加 app.use(i18n)')
        changed = true
        inserted = true
        break
      }
    }
    if (!inserted) {
      console.log('  警告: 未找到 mount，请手动添加 app.use(i18n)')
    }
  } else {
    console.log('  跳过: main.ts app.use(i18n) 已存在')
  }

  if (changed) {
    fs.writeFileSync(mainFile, content, 'utf-8')
  }
}

module.exports = { runInit }

if (require.main === module) {
  main().catch((err) => {
    console.error('初始化失败:', err)
    process.exit(1)
  })
}

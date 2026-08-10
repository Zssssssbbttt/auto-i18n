/**
 * Vue 3 初始化模块
 * 生成 Vue 3 + Element Plus / Vant 的 i18n 配置文件和模板
 *
 * 导出统一接口，由 init.cjs 调度调用
 */

const path = require('path')
const fs = require('fs')

/** vue-i18n 包名（Vue 3 用 v9+） */
const i18nPackageName = 'vue-i18n'

/**
 * 将语言代码转为变量名（camelCase）
 * zh-CN → zhCN, en → en, th → th
 */
function langToVarName(lang) {
  const parts = lang.split('-')
  return (
    parts[0].toLowerCase() +
    parts
      .slice(1)
      .map((p) => p[0].toUpperCase() + p.slice(1))
      .join('')
  )
}

/**
 * 生成 index.ts 内容
 * @param {object} config - i18n 配置
 * @param {string} outputDir - locale 输出目录（绝对路径）
 * @param {string} projectRoot - 项目根目录
 * @param {string[]} validSharedLocales - 校验通过的共享语言包路径列表
 * @returns {string} index.ts 文件内容
 */
function generateIndexContent(config, outputDir, projectRoot, validSharedLocales) {
  const sourceLang = config.sourceLanguage || 'zh-CN'
  const targetLangs = config.targetLanguages || ['en']
  const storageKey = config.localeStorageKey || 'lang'
  const uiLibrary = config.uiLibrary || 'element-plus'
  const allLangs = [sourceLang, ...targetLangs.filter((l) => l !== sourceLang)]

  // 生成共享语言包的 import 语句
  let sharedImports = ''
  const sharedVars = {}
  for (const lang of allLangs) {
    sharedVars[lang] = []
  }

  for (let i = 0; i < validSharedLocales.length; i++) {
    const sharedPath = validSharedLocales[i]
    const absSharedPath = path.resolve(projectRoot, sharedPath)
    let relPath = path.relative(outputDir, absSharedPath).replace(/\\/g, '/')
    if (!relPath.startsWith('.')) {
      relPath = './' + relPath
    }

    for (const lang of allLangs) {
      const varName = `shared${langToVarName(lang)}${i}`
      sharedImports += `import ${varName} from '${relPath}/${lang}.json'\n`
      sharedVars[lang].push(varName)
    }
  }

  const hasShared = validSharedLocales.length > 0

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
    : ''

  // 构建 messages 对象
  const messagesLines = allLangs
    .map((lang) => {
      const localVar = langToVarName(lang)
      if (hasShared) {
        const args = ['{}', ...sharedVars[lang], localVar].join(', ')
        return `    '${lang}': deepMerge(${args}),`
      }
      return `    '${lang}': ${localVar},`
    })
    .join('\n')

  // 构建本地语言包 import
  const localImports = allLangs
    .map((lang) => `import ${langToVarName(lang)} from './${lang}.json'`)
    .join('\n')

  if (uiLibrary === 'element-plus') {
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
`
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
`
  }
}

/**
 * 生成 typeToString.ts 内容
 * @returns {string}
 */
function generateTypeToString() {
  return `import i18n from './index'

/**
 * 将 $t 的返回值强制转为 string 类型
 * 解决 vue-i18n 中 $t 返回 TranslateResult 联合类型导致的 TS 类型报错
 */
export function i18nTypeToString(key: string): string {
  const result = i18n.global.t(key)
  return typeof result === 'string' ? result : String(result)
}
`
}

/**
 * 生成 useI18n.ts 内容
 * @returns {string}
 */
function generateUseI18n() {
  return `import i18n from './index'

/**
 * i18n composable
 * 在 <script setup> 中使用: const { t } = useI18n()
 * 模板中可直接使用 {{ t('key') }}
 */
export function useI18n() {
  return { t: i18n.global.t }
}
`
}

/**
 * 更新 main.ts：补全 i18n 引入、全局 $t 注册、app.use(i18n)
 * @param {string} projectRoot - 项目根目录
 */
function updateMainTs(projectRoot) {
  const mainFile = path.join(projectRoot, 'src', 'main.ts')
  if (!fs.existsSync(mainFile)) {
    console.log('  警告: 未找到 src/main.ts，跳过引入路径更新')
    return
  }

  let content = fs.readFileSync(mainFile, 'utf-8')
  const newImport = "import i18n, { $t } from './locales'"
  const vnetImport = "import { setI18nInstance, getComponentMessages } from '@vnet/i18n'"
  let changed = false

  // 1. 处理 import 引入
  if (content.includes(newImport)) {
    console.log('  跳过: main.ts 引入路径已正确')
  } else {
    const lines = content.split('\n')
    let lastImportLine = -1
    for (let i = 0; i < lines.length; i++) {
      if (/^import\s+.+/.test(lines[i].trim())) {
        lastImportLine = i
      }
    }
    if (lastImportLine >= 0) {
      lines.splice(lastImportLine + 1, 0, newImport)
      lastImportLine++
      content = lines.join('\n')
      console.log('  新增: main.ts 添加 i18n 引入')
      changed = true
    } else {
      console.log('  警告: main.ts 中未找到 import 语句，请手动添加 i18n 引入')
    }
  }

  // 1.1 处理 @vnet/i18n 引入
  if (content.includes(vnetImport)) {
    console.log('  跳过: main.ts @vnet/i18n 引入已存在')
  } else {
    const lines = content.split('\n')
    let lastImportLine = -1
    for (let i = 0; i < lines.length; i++) {
      if (/^import\s+.+/.test(lines[i].trim())) {
        lastImportLine = i
      }
    }
    if (lastImportLine >= 0) {
      lines.splice(lastImportLine + 1, 0, vnetImport)
      content = lines.join('\n')
      console.log('  新增: main.ts 添加 @vnet/i18n 引入')
      changed = true
    } else {
      console.log('  警告: main.ts 中未找到 import 语句，请手动添加 @vnet/i18n 引入')
    }
  }

  // 2. 检查并补全全局 $t 注册 + @vnet/i18n 注册
  const globalTLine = 'app.config.globalProperties.$t = $t'
  if (!content.includes(globalTLine)) {
    const lines = content.split('\n')
    let inserted = false
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(?:const\s+)?app\s*=\s*createApp/.test(lines[i].trim())) {
        lines.splice(
          i + 1,
          0,
          '',
          `// 全局注册 $t，模板中可直接使用`,
          globalTLine,
          '',
          `// 将公共组件词条合并到当前 i18n 实例，并注册到 @vnet/i18n，`,
          `// 使 FlowProcess 等公共组件能随项目语言切换`,
          `const compMsgs = getComponentMessages()`,
          `for (const locale of Object.keys(compMsgs)) {`,
          `  i18n.global.mergeLocaleMessage(locale, compMsgs[locale])`,
          `}`,
          `setI18nInstance(i18n)`,
        )
        content = lines.join('\n')
        console.log('  新增: main.ts 添加全局 $t 注册及 @vnet/i18n 注册')
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
    // 即使 $t 已存在，也要检查 @vnet/i18n 注册代码
    if (!content.includes('setI18nInstance(i18n)')) {
      const lines = content.split('\n')
      let inserted = false
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === globalTLine) {
          lines.splice(
            i + 1,
            0,
            '',
            `// 将公共组件词条合并到当前 i18n 实例，并注册到 @vnet/i18n，`,
            `// 使 FlowProcess 等公共组件能随项目语言切换`,
            `const compMsgs = getComponentMessages()`,
            `for (const locale of Object.keys(compMsgs)) {`,
            `  i18n.global.mergeLocaleMessage(locale, compMsgs[locale])`,
            `}`,
            `setI18nInstance(i18n)`,
          )
          content = lines.join('\n')
          console.log('  新增: main.ts 添加 @vnet/i18n 注册代码')
          changed = true
          inserted = true
          break
        }
      }
      if (!inserted) {
        console.log('  警告: 未找到全局 $t 注册行，请手动添加 @vnet/i18n 注册代码')
      }
    } else {
      console.log('  跳过: main.ts @vnet/i18n 注册代码已存在')
    }
  }

  // 3. 检查并补全 app.use(i18n)，插入到 .mount( 之前的链式调用中
  if (!content.includes('.use(i18n)')) {
    const lines = content.split('\n')
    let inserted = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()

      // 跳过注释行
      if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue

      const mountIdx = line.indexOf('.mount(')
      if (mountIdx === -1) continue

      // .mount( 之前的内容（去掉尾部空白）
      const beforeMount = line.slice(0, mountIdx).trimEnd()

      if (!beforeMount) {
        // 模式 A: 缩进续行 — 行首只有空白，然后是 .mount(
        const indent = line.slice(0, line.length - line.trimStart().length)
        lines.splice(i, 0, `${indent}.use(i18n)`)
      } else if (beforeMount.endsWith(')')) {
        // 模式 B: 同行链式调用 — .mount( 前有 ).use() 等链式调用
        lines[i] = beforeMount + '.use(i18n)' + line.slice(mountIdx)
      } else {
        // 模式 C: 独立调用 — 行首是变量名.mount(
        const indent = line.slice(0, line.length - line.trimStart().length)
        const varName = beforeMount.trim()
        lines.splice(i, 0, `${indent}${varName}.use(i18n)`)
      }

      content = lines.join('\n')
      console.log('  新增: main.ts 添加 app.use(i18n)')
      changed = true
      inserted = true
      break
    }

    if (!inserted) {
      console.log('  警告: 未找到 .mount(，请手动添加 app.use(i18n)')
    }
  } else {
    console.log('  跳过: main.ts app.use(i18n) 已存在')
  }

  if (changed) {
    fs.writeFileSync(mainFile, content, 'utf-8')
  }
}

module.exports = {
  i18nPackageName,
  generateIndexContent,
  generateTypeToString,
  generateUseI18n,
  updateMainTs,
}
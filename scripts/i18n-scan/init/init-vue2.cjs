/**
 * Vue 2 初始化模块
 * 生成 Vue 2 + Element UI / Vant 的 i18n 配置文件和模板
 *
 * 模板参考 vue2-scan/init.js，接口与 init-vue3.cjs 统一
 */

const path = require('path')
const fs = require('fs')

/** vue-i18n 包名（Vue 2 用 v8） */
const i18nPackageName = 'vue-i18n@8'

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

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Element UI locale 路径映射
 * zh-CN → zh-CN, en → en, th → th 等
 */
function elementUILocalePath(lang) {
  if (lang === 'zh-CN') return 'zh-CN'
  return lang.split('-')[0]
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
  const uiLibrary = config.uiLibrary || 'element-ui'
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

  if (uiLibrary === 'element-ui') {
    // Element UI locale 导入
    const elementImports = allLangs
      .map((l) => `import element${capitalize(langToVarName(l))} from 'element-ui/lib/locale/lang/${elementUILocalePath(l)}'`)
      .join('\n')

    const elementEntries = allLangs
      .map((l) => `  '${l}': element${capitalize(langToVarName(l))},`)
      .join('\n')

    const defaultLocale = sourceLang

    return `import Vue from 'vue'
import VueI18n from 'vue-i18n'
import { i18nTypeToString } from './typeToString'
import { translateText, translateArray } from './toI18n'
${localImports}
${sharedImports}import elementLocale from 'element-ui/lib/locale'
${elementImports}${deepMergeFn}
Vue.use(VueI18n)

Vue.prototype.i18nTypeToString = i18nTypeToString
Vue.prototype.translateText = translateText
Vue.prototype.translateArray = translateArray

const elementLocales: Record<string, any> = {
${elementEntries}
}

const i18n = new VueI18n({
  locale: localStorage.getItem('${storageKey}') || '${defaultLocale}',
  messages: {
${messagesLines}
  },
  silentTranslationWarn: true,
})

// 初始设置 Element UI 语言
elementLocale.use(elementLocales[i18n.locale] || element${capitalize(langToVarName(defaultLocale))})

export default i18n

export const $t = i18n.t.bind(i18n)

/**
 * 切换语言
 * 在 Vue 组件中调用: switchLanguage('en')
 */
export function switchLanguage(lang: string) {
  i18n.locale = lang
  localStorage.setItem('${storageKey}', lang)
  elementLocale.use(elementLocales[lang] || element${capitalize(langToVarName(defaultLocale))})
}
`
  } else {
    // vant / none → 精简模板，无 UI 库耦合
    const defaultLocale = sourceLang

    return `import Vue from 'vue'
import VueI18n from 'vue-i18n'
import { i18nTypeToString } from './typeToString'
import { translateText, translateArray } from './toI18n'
${localImports}
${sharedImports}${deepMergeFn}
Vue.use(VueI18n)

Vue.prototype.i18nTypeToString = i18nTypeToString
Vue.prototype.translateText = translateText
Vue.prototype.translateArray = translateArray

const i18n = new VueI18n({
  locale: localStorage.getItem('${storageKey}') || '${defaultLocale}',
  messages: {
${messagesLines}
  },
  silentTranslationWarn: true,
})

export default i18n

export const $t = i18n.t.bind(i18n)

/**
 * 切换语言
 */
export function switchLanguage(lang: string) {
  i18n.locale = lang
  localStorage.setItem('${storageKey}', lang)
}
`
  }
}

/**
 * 生成 typeToString.ts 内容（Vue 2 版本，使用 i18n.t）
 * @returns {string}
 */
function generateTypeToString() {
  return `import i18n from './index'

/**
 * 将 $t 的返回值强制转为 string 类型
 * 解决 vue-i18n 中 $t 返回 TranslateResult 联合类型导致的 TS 类型报错
 */
export function i18nTypeToString(key: string): string {
  const result = i18n.t(key)
  return typeof result === 'string' ? result : String(result)
}
`
}

/**
 * 生成 useI18n.ts 内容（Vue 2 版本，使用 i18n.t）
 * @returns {string}
 */
function generateUseI18n() {
  return `import i18n from './index'

/**
 * i18n composable
 * 在 Vue 组件中使用: const { t } = useI18n()
 * 模板中可直接使用 {{ $t('key') }}（通过 Vue.prototype.$t 全局注册）
 */
export function useI18n() {
  return { t: i18n.t }
}
`
}

/**
 * 更新 main.ts：补全 i18n 引入、Vue.prototype.$t 全局注册、new Vue 中传入 i18n
 *
 * Vue 2 入口模式：
 *   new Vue({ router, store, render: h => h(App) }).$mount('#app')
 *
 * 修改后：
 *   import i18n, { $t } from './locales'
 *   Vue.prototype.$t = $t
 *   new Vue({ router, store, i18n, render: h => h(App) }).$mount('#app')
 *
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
  let changed = false

  // 1. 处理 i18n import 引入
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
      content = lines.join('\n')
      console.log('  新增: main.ts 添加 i18n 引入')
      changed = true
    } else {
      console.log('  警告: main.ts 中未找到 import 语句，请手动添加 i18n 引入')
    }
  }

  // 2. 检查并补全 Vue.prototype.$t 全局注册
  const globalTLine = 'Vue.prototype.$t = $t'
  if (!content.includes(globalTLine)) {
    const lines = content.split('\n')
    let inserted = false

    // 在 new Vue({ 之前插入
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*new\s+Vue\s*\(\s*\{/.test(lines[i].trim())) {
        lines.splice(
          i,
          0,
          '',
          `// 全局注册 $t，模板和脚本中可直接使用 this.$t()`,
          globalTLine,
        )
        content = lines.join('\n')
        console.log('  新增: main.ts 添加 Vue.prototype.$t 全局注册')
        changed = true
        inserted = true
        break
      }
    }
    if (!inserted) {
      console.log('  警告: 未找到 new Vue({，请手动添加 Vue.prototype.$t 全局注册')
    }
  } else {
    console.log('  跳过: main.ts Vue.prototype.$t 注册已存在')
  }

  // 3. 在 new Vue({ ... }) 的选项对象中插入 i18n 属性
  // 注意：不能用 content.includes('i18n,') 因为 import 语句中也有 i18n,
  const vueInstanceRegex = /new\s+Vue\s*\(\s*\{([^}]*)\}/s
  const vueMatch = content.match(vueInstanceRegex)
  const hasI18nOption = vueMatch && vueMatch[1] && vueMatch[1].includes('i18n')

  if (!hasI18nOption) {
    const lines = content.split('\n')
    let inserted = false

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      // 匹配 new Vue({
      if (/^\s*new\s+Vue\s*\(\s*\{/.test(trimmed)) {
        // 在 { 后面插入 i18n,
        const braceIdx = lines[i].indexOf('{')
        if (braceIdx >= 0) {
          lines[i] = lines[i].slice(0, braceIdx + 1) + '\n  i18n,' + lines[i].slice(braceIdx + 1)
        }
        content = lines.join('\n')
        console.log('  新增: main.ts 在 new Vue 选项中添加 i18n')
        changed = true
        inserted = true
        break
      }
    }

    if (!inserted) {
      console.log('  警告: 未找到 new Vue({，请手动添加 i18n 选项')
    }
  } else {
    console.log('  跳过: main.ts i18n 选项已存在')
  }

  if (changed) {
    fs.writeFileSync(mainFile, content, 'utf-8')
  }
}

/**
 * 生成 toI18n.ts 内容（Vue 2 版本，使用 i18n.t 和 i18n.locale）
 * @returns {string}
 */
function generateToI18n() {
  return `import i18n from './index'
import zhCN from './zh-CN.json'

const reverseMap: Record<string, string> = {}
;(function buildReverseMap(obj: any, prefix: string = '') {
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key]
      const fullKey = prefix ? \`\${prefix}.\${key}\` : key
      if (typeof value === 'string') {
        reverseMap[value] = fullKey
      } else if (typeof value === 'object' && value !== null) {
        buildReverseMap(value, fullKey)
      }
    }
  }
})(zhCN)

/**
 * 单条翻译：通过中文查找语言包中的key并翻译
 * 模板中使用：{{ translateText(item.name) }}
 */
export function translateText(chineseText: string): string {
  if (!chineseText) return chineseText

  const locale = i18n.locale as string
  if (locale === 'zh-CN') return chineseText

  const key = reverseMap[chineseText]
  if (key) {
    const translated = i18n.t(key)
    return translated !== key ? translated : chineseText
  }

  return chineseText
}

/**
 * 批量翻译：遍历数组，翻译每个对象指定 key 的值
 * 脚本中使用：translateArray(this.viewBtns, 'name')
 */
export function translateArray<T extends Record<string, any>>(arr: T[], keyName: string): T[] {
  if (!arr || !arr.length) return arr

  const locale = i18n.locale as string
  if (locale === 'zh-CN') return arr

  return arr.map((item) => {
    const value = item[keyName]
    if (typeof value === 'string') {
      const translated = translateText(value)
      if (translated !== value) {
        return { ...item, [keyName]: translated }
      }
    }
    return item
  })
}
`
}

/**
 * 在已有 index.ts 中补齐缺失语言的注册代码（精确补丁，不重写整个文件）
 * @param {string} existingContent - 现有 index.ts 内容
 * @param {object} config - i18n 配置
 * @param {string[]} missingLangs - 缺失的语言代码列表
 * @returns {string} 补齐后的内容
 */
function patchIndexContent(existingContent, config, missingLangs) {
  const uiLibrary = config.uiLibrary || 'element-ui'
  const hasShared = existingContent.includes('deepMerge(')
  const lines = existingContent.split('\n')

  function insertAfterLastMatch(regex, newLine) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (regex.test(lines[i])) {
        lines.splice(i + 1, 0, newLine)
        return
      }
    }
  }

  function insertBeforeBlockClosing(openPattern, newLine) {
    let startIdx = -1
    for (let i = 0; i < lines.length; i++) {
      if (openPattern.test(lines[i])) {
        startIdx = i
        break
      }
    }
    if (startIdx === -1) return

    let depth = 0
    let started = false
    for (let i = startIdx; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') { depth++; started = true }
        else if (ch === '}') {
          depth--
          if (started && depth === 0) {
            lines.splice(i, 0, newLine)
            return
          }
        }
      }
    }
  }

  for (const lang of missingLangs) {
    const varName = langToVarName(lang)

    // 1. 本地 JSON import
    insertAfterLastMatch(
      /import \w+ from '\.\/[\w-]+\.json'/,
      `import ${varName} from './${lang}.json'`
    )

    if (uiLibrary === 'element-ui') {
      // 2. element-ui locale import
      const elementPath = lang === 'zh-CN' ? 'zh-CN' : lang.split('-')[0]
      const elementVar = `element${capitalize(varName)}`
      insertAfterLastMatch(
        /import \w+ from 'element-ui\/lib\/locale\/lang\//,
        `import ${elementVar} from 'element-ui/lib/locale/lang/${elementPath}'`
      )

      // 3. elementLocales 条目
      insertBeforeBlockClosing(
        /const elementLocales/,
        `  '${lang}': ${elementVar},`
      )
    }

    // 4. messages 条目
    const msgEntry = hasShared
      ? `    '${lang}': deepMerge({}, ${varName}),`
      : `    '${lang}': ${varName},`
    insertBeforeBlockClosing(/messages:\s*\{/, msgEntry)
  }

  return lines.join('\n')
}

module.exports = {
  i18nPackageName,
  generateIndexContent,
  generateTypeToString,
  generateUseI18n,
  generateToI18n,
  updateMainTs,
  patchIndexContent,
}
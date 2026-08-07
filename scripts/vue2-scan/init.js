/**
 * i18n 初始化模块
 * 创建 locales 目录、空语言包骨架文件、index.ts 注册入口
 *
 * 用法：node src/scripts/i18n/init.js [-c <configPath>]
 */
const fs = require('fs')
const path = require('path')
const { loadConfig } = require('./config')

function main() {
  const args = process.argv.slice(2)
  const configPath = args.includes('-c') ? args[args.indexOf('-c') + 1] : null

  const config = loadConfig(configPath)
  const outputDir = path.resolve(config.output)
  const languages = config.languages || ['zh-CN']

  console.log('\n========== i18n 初始化 ==========\n')

  // 1. 创建 locales 目录
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
    console.log(`  创建目录: ${outputDir}`)
  } else {
    console.log(`  目录已存在: ${outputDir}`)
  }

  // 2. 创建语言包骨架文件
  const created = []
  const skipped = []
  for (const lang of languages) {
    const filePath = path.join(outputDir, `${lang}.json`)
    if (fs.existsSync(filePath)) {
      skipped.push(`${lang}.json`)
    } else {
      fs.writeFileSync(filePath, '{}\n', 'utf-8')
      created.push(`${lang}.json`)
    }
  }

  if (created.length > 0) {
    console.log(`\n  已创建 ${created.length} 个语言包文件:`)
    created.forEach((f) => console.log(`    + ${f}`))
  }
  if (skipped.length > 0) {
    console.log(`\n  已跳过 ${skipped.length} 个已存在的文件:`)
    skipped.forEach((f) => console.log(`    - ${f}`))
  }

  // 3. 创建 toI18n.ts
  const toI18nFile = path.join(outputDir, 'toI18n.ts')
  if (fs.existsSync(toI18nFile)) {
    console.log(`\n  已跳过已存在的 toI18n.ts`)
  } else {
    fs.writeFileSync(toI18nFile, generateToI18n(), 'utf-8')
    console.log(`\n  已创建 toI18n.ts`)
  }

  // 3.5 创建 typeToString.ts
  const typeToStringFile = path.join(outputDir, 'typeToString.ts')
  if (fs.existsSync(typeToStringFile)) {
    console.log(`\n  已跳过已存在的 typeToString.ts`)
  } else {
    fs.writeFileSync(typeToStringFile, generateTypeToString(), 'utf-8')
    console.log(`\n  已创建 typeToString.ts`)
  }

  // 4. 创建 index.ts
  const indexExt = fs.existsSync(path.join(outputDir, 'index.ts')) ? '.ts' : ''
  const indexFile = path.join(outputDir, 'index.ts')
  if (!indexExt && fs.existsSync(indexFile)) {
    console.log(`\n  已跳过已存在的 index.ts`)
  } else {
    fs.writeFileSync(indexFile, generateIndex(languages), 'utf-8')
    console.log(`\n  已创建 index.ts`)
  }

  console.log(`\n========== 初始化完成 ==========\n`)
}

/**
 * 根据语言列表生成 index.ts 内容
 */
function generateIndex(languages) {
  const langVar = (lang) => lang.replace(/-([a-zA-Z])/g, (_, c) => c.toUpperCase())
  const elementPath = (lang) => {
    if (lang === 'zh-CN') return 'zh-CN'
    return lang.split('-')[0]
  }

  const jsonImports = languages
    .map((l) => `import ${langVar(l)} from './${l}.json'`)
    .join('\n')

  const elementImports = languages
    .map((l) => `import element${capitalize(langVar(l))} from 'element-ui/lib/locale/lang/${elementPath(l)}'`)
    .join('\n')

  const elementEntries = languages
    .map((l) => `  '${l}': element${capitalize(langVar(l))},`)
    .join('\n')

  const messageEntries = languages
    .map((l) => `    '${l}': ${langVar(l)},`)
    .join('\n')

  const defaultLocale = languages[0] || 'zh-CN'

  return `import Vue from 'vue'
import VueI18n from 'vue-i18n'
import { i18nTypeToString } from './typeToString'
${jsonImports}
import elementLocale from 'element-ui/lib/locale'
${elementImports}

Vue.use(VueI18n)

Vue.prototype.i18nTypeToString = i18nTypeToString

const elementLocales: Record<string, any> = {
${elementEntries}
}

const i18n = new VueI18n({
  locale: localStorage.getItem('lang') || '${defaultLocale}',
  messages: {
${messageEntries}
  },
  silentTranslationWarn: true,
})

elementLocale.use(elementLocales[i18n.locale] || element${capitalize(langVar(defaultLocale))})

export default i18n

export function switchLanguage(lang: string) {
  i18n.locale = lang
  localStorage.setItem('lang', lang)
  elementLocale.use(elementLocales[lang] || element${capitalize(langVar(defaultLocale))})
}
`
}

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

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function generateToI18n() {
  return `import i18n from './index'
import zhCN from './zh-CN.json'

function findKeyByChinese(chineseText: string): string | null {
  function findKey(obj: any, prefix: string = ''): string | null {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key]
        const fullKey = prefix ? \`\${prefix}.\${key}\` : key

        if (value === chineseText) {
          return fullKey
        }

        if (typeof value === 'object' && value !== null) {
          const result = findKey(value, fullKey)
          if (result) return result
        }
      }
    }
    return null
  }

  return findKey(zhCN)
}

/**
 * 单条翻译：通过中文查找语言包中的key并翻译
 * 模板中使用：{{ translateText(item.name) }}
 */
export function translateText(chineseText: string): string {
  if (!chineseText) return chineseText

  const locale = i18n.locale as string
  if (locale === 'zh-CN') return chineseText

  const key = findKeyByChinese(chineseText)
  if (key) {
    const translated = i18n.t(key)
    const translatedText = translated !== key ? translated : chineseText
    console.log(chineseText + '对应的翻译key为：' + key + '，翻译结果为：' + translatedText)
    return translatedText
  }

  console.log(chineseText + '未找到对应的翻译key，请检查语言包')

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

main()
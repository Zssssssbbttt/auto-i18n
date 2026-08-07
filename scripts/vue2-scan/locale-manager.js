/**
 * 语言包管理模块
 * 读取/写入语言包、构建反向索引、生成嵌套 key、模块推断
 */
const fs = require('fs')
const path = require('path')

/**
 * 从文件路径推断模块名
 * views/accredit/xxx.vue → accredit
 * views/accredit/components/xxx.vue → accredit
 * components/upload/xxx.vue → upload
 * views/xxx.vue → defaultModule
 */
function inferModule(filePath, baseDir, defaultModule) {
  const relPath = path.relative(baseDir, filePath).replace(/\\/g, '/')

  // views/<module>/... → module
  const viewsMatch = relPath.match(/^views\/([^/]+)/)
  if (viewsMatch) {
    const mod = viewsMatch[1]
    if (['components', 'utils', 'mixins', 'assets'].includes(mod)) {
      return defaultModule
    }
    return lowerFirst(mod)
  }

  // components/<name>/... → name
  const compMatch = relPath.match(/^components\/([^/]+)/)
  if (compMatch) return lowerFirst(compMatch[1])

  return defaultModule
}

/**
 * 读取语言包文件，返回完整对象
 */
function readLocale(localePath) {
  if (!fs.existsSync(localePath)) return {}
  return JSON.parse(fs.readFileSync(localePath, 'utf-8'))
}

/**
 * 写入语言包文件（标准 JSON 格式）
 */
function writeLocale(localePath, data) {
  const dir = path.dirname(localePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(localePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

/**
 * 读取语言包文件，构建 中文→嵌套key 的反向索引
 * 遍历嵌套结构，生成 "中文文本" → "module.subKey" 的映射
 */
function buildReverseIndex(localePath) {
  if (!fs.existsSync(localePath)) return { reverse: {}, badKeys: [] }

  const locale = readLocale(localePath)
  const reverse = {}
  const badKeys = []

  function walk(obj, prefix) {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        const fullKey = prefix ? `${prefix}.${key}` : key
        if (key === value) {
          // key 和 value 相同，说明是旧格式占位，没有实际映射意义
          badKeys.push(fullKey)
        } else {
          reverse[value] = fullKey
        }
      } else if (typeof value === 'object' && value !== null) {
        walk(value, prefix ? `${prefix}.${key}` : key)
      }
    }
  }

  walk(locale, '')
  return { reverse, badKeys }
}

/**
 * 将嵌套 key 写入语言包对象
 * "accredit.sponsor" → { accredit: { sponsor: "发起人" } }
 */
function setNested(obj, nestedKey, value) {
  const parts = nestedKey.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {}
    current = current[parts[i]]
  }
  const lastKey = parts[parts.length - 1]
  // 如果目标位置已经是对象（模块命名空间），不覆盖，追加 _key 后缀
  if (typeof current[lastKey] === 'object' && current[lastKey] !== null) {
    current[lastKey + '_key'] = value
    return
  }
  current[lastKey] = value
}

/**
 * 为中文文本生成嵌套 key
 * @param {string} chineseText - 中文文本
 * @param {string} moduleName - 模块名
 * @param {object} reverseIndex - 现有反向索引
 * @param {object} config - 配置
 * @returns {string} 嵌套 key，如 "accredit.sponsor"
 */
function generateKey(chineseText, moduleName, reverseIndex, config) {
  // 1. 已有映射直接用
  if (reverseIndex[chineseText]) return reverseIndex[chineseText]

  // 2. commonKeys 白名单 → common 模块
  if (config.commonKeys && config.commonKeys.includes(chineseText)) {
    const camelKey = chineseToCamelKey(chineseText)
    return `common.${camelKey}`
  }

  // 3. 新 key：模块名 + camelCase
  const camelKey = chineseToCamelKey(chineseText)
  return `${moduleName}.${camelKey}`
}

/**
 * 中文 → camelCase key 生成
 */
function chineseToCamelKey(chinese) {
  const cleaned = chinese.replace(/[，。！？、；：""''（）【】《》…—·\s]/g, ' ').trim()

  // 纯英文/数字 → camelCase
  if (/^[a-zA-Z0-9\s/]+$/.test(cleaned)) {
    return cleaned
      .split(/[\s/]+/)
      .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('')
  }

  // 中文 → hash key（实际项目应维护映射表）
  return 'key_' + simpleHash(chinese)
}

function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function lowerFirst(str) {
  return str.charAt(0).toLowerCase() + str.slice(1)
}

/**
 * 默认翻译函数：中文占位
 * 后续可替换为 AI API 翻译
 */
function defaultTranslator(chineseText, targetLang) {
  return chineseText
}

/**
 * 更新所有语言包
 * @param {object} newMappings - { chineseText: nestedKey }
 * @param {string} outputDir - 语言包目录
 * @param {string[]} languages - 语言列表
 * @param {object} config - 配置
 */
function updateLocales(newMappings, outputDir, languages, config) {
  const translator = config.translator || defaultTranslator
  const results = []

  for (const lang of languages) {
    const localePath = path.join(outputDir, `${lang}.json`)
    const localeData = readLocale(localePath)

    for (const [chineseText, nestedKey] of Object.entries(newMappings)) {
      if (lang === 'zh-CN') {
        setNested(localeData, nestedKey, chineseText)
      } else {
        const translated = translator(chineseText, lang)
        setNested(localeData, nestedKey, translated)
      }
    }

    writeLocale(localePath, localeData)
    results.push({ lang, path: localePath, count: Object.keys(newMappings).length })
  }

  return results
}

module.exports = {
  inferModule,
  buildReverseIndex,
  readLocale,
  writeLocale,
  setNested,
  generateKey,
  chineseToCamelKey,
  updateLocales,
}
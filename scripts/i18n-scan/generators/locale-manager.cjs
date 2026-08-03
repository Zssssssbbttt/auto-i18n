/**
 * Locale 文件管理器
 * 负责读取 locale JSON、构建反向映射、追加新 key
 */

const path = require('path')
const fs = require('fs')

/**
 * 加载 locale 文件并构建反向映射
 * @param {string} outputDir - locale 文件所在目录
 * @param {string} sourceLanguage - 源语言文件名（如 'zh-CN'）
 * @returns {{ reverseMap: object, localeData: object, keyCount: number }}
 */
function loadLocaleReverseMap(outputDir, sourceLanguage) {
  const localeFile = path.join(outputDir, `${sourceLanguage}.json`)
  const reverseMap = {}
  let localeData = {}
  let keyCount = 0

  if (fs.existsSync(localeFile)) {
    try {
      localeData = JSON.parse(fs.readFileSync(localeFile, 'utf-8'))
      walkLocale(localeData, '', reverseMap)
      keyCount = Object.keys(reverseMap).length
    } catch (err) {
      console.error(
        `  警告: 无法解析 locale 文件 ${localeFile}: ${err.message}`
      )
    }
  }

  return { reverseMap, localeData, keyCount }
}

/**
 * 递归遍历 locale JSON，构建反向映射
 */
function walkLocale(obj, prefix, reverseMap) {
  for (const key of Object.keys(obj)) {
    const value = obj[key]
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      reverseMap[value] = fullKey
    } else if (typeof value === 'object' && value !== null) {
      walkLocale(value, fullKey, reverseMap)
    }
  }
}

/**
 * 将新中文文本追加到语言包
 * @param {string} outputDir - locale 目录
 * @param {string} sourceLanguage - 源语言（如 'zh-CN'）
 * @param {string[]} targetLanguages - 目标语言列表（如 ['en']）
 * @param {string[]} newChineseTexts - 未匹配的中文文本（去重后）
 * @returns {object[]} 新增的 key 列表
 */
function appendNewKeys(
  outputDir,
  sourceLanguage,
  targetLanguages,
  newChineseTexts
) {
  // 不再自动生成 key 写入语言包。
  // 未匹配的中文应由 AI 翻译（--translate）或用户手动添加到语言包。
  if (newChineseTexts.length === 0) return []
  return []
}

module.exports = { loadLocaleReverseMap, appendNewKeys }

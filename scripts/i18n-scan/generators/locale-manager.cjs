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
  if (newChineseTexts.length === 0) return []

  const addedKeys = []

  // 处理源语言文件
  const sourceFile = path.join(outputDir, `${sourceLanguage}.json`)
  let sourceData = {}
  if (fs.existsSync(sourceFile)) {
    try {
      sourceData = JSON.parse(fs.readFileSync(sourceFile, 'utf-8'))
    } catch (err) {
      console.error(`  警告: 无法解析 ${sourceFile}: ${err.message}`)
      return addedKeys
    }
  }

  // 确保 common 模块存在
  if (!sourceData.common) sourceData.common = {}

  // 去重并追加
  const uniqueTexts = [...new Set(newChineseTexts)]
  for (const chineseText of uniqueTexts) {
    // 生成简单 key：取中文前几个字
    const key = generateSimpleKey(chineseText)
    // 检查是否已存在
    if (sourceData.common[key]) continue
    sourceData.common[key] = chineseText
    addedKeys.push({ chineseText, key: `common.${key}` })
  }

  // 写回源语言文件
  if (addedKeys.length > 0) {
    fs.writeFileSync(sourceFile, JSON.stringify(sourceData, null, 2), 'utf-8')
  }

  // 处理目标语言文件
  for (const lang of targetLanguages) {
    if (lang === sourceLanguage) continue
    const targetFile = path.join(outputDir, `${lang}.json`)
    let targetData = {}
    if (fs.existsSync(targetFile)) {
      try {
        targetData = JSON.parse(fs.readFileSync(targetFile, 'utf-8'))
      } catch (err) {
        console.error(`  警告: 无法解析 ${targetFile}: ${err.message}`)
        continue
      }
    }

    if (!targetData.common) targetData.common = {}

    for (const item of addedKeys) {
      const shortKey = item.key.replace('common.', '')
      if (!targetData.common[shortKey]) {
        // 目标语言值为空，等待手动翻译
        targetData.common[shortKey] = ''
      }
    }

    fs.writeFileSync(targetFile, JSON.stringify(targetData, null, 2), 'utf-8')
  }

  return addedKeys
}

/**
 * 生成简单 key（取中文前几个字）
 */
function generateSimpleKey(chineseText) {
  // 去掉标点，取前 6 个字
  const cleaned = chineseText.replace(/[，。！？、：；""''（）《》【】\s]/g, '')
  return cleaned.length <= 6 ? cleaned : cleaned.slice(0, 6)
}

module.exports = { loadLocaleReverseMap, appendNewKeys }

/**
 * 语言包校验工具
 * 校验外部语言包目录的完整性
 */

const path = require('path')
const fs = require('fs')

/**
 * 递归统计 JSON 对象中叶子节点（字符串值）的数量
 * @param {object} obj - 语言包 JSON 对象
 * @returns {number}
 */
function countKeys(obj) {
  let count = 0
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'string') {
      count++
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      count += countKeys(obj[key])
    }
  }
  return count
}

/**
 * 校验外部语言包目录的完整性
 * 1. 路径必须存在
 * 2. 每种语言必须有对应文件
 * 3. 各语言文件的 key 数量必须与源语言一致
 *
 * @param {string[]} localePaths - 语言包路径列表（相对于 projectRoot）
 * @param {string} projectRoot - 项目根目录
 * @param {string} sourceLang - 源语言
 * @param {string[]} targetLangs - 目标语言列表
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateLocalePaths(localePaths, projectRoot, sourceLang, targetLangs) {
  const errors = []

  if (!localePaths || localePaths.length === 0) {
    return { valid: true, errors: [] }
  }

  const allLangs = [sourceLang, ...targetLangs.filter((l) => l !== sourceLang)]

  for (const localePath of localePaths) {
    const absPath = path.resolve(projectRoot, localePath)

    // 1. 路径存在
    if (!fs.existsSync(absPath)) {
      errors.push(`路径不存在: ${localePath}`)
      continue
    }

    // 2. 每种语言文件存在
    let missingFiles = false
    for (const lang of allLangs) {
      const langFile = path.join(absPath, `${lang}.json`)
      if (!fs.existsSync(langFile)) {
        errors.push(`缺少语言文件: ${localePath}/${lang}.json`)
        missingFiles = true
      }
    }
    if (missingFiles) continue

    // 3. key 数量一致
    const sourceFile = path.join(absPath, `${sourceLang}.json`)
    let sourceData
    try {
      sourceData = JSON.parse(fs.readFileSync(sourceFile, 'utf-8'))
    } catch (err) {
      errors.push(`无法解析 ${localePath}/${sourceLang}.json: ${err.message}`)
      continue
    }
    const sourceKeyCount = countKeys(sourceData)

    for (const lang of targetLangs) {
      if (lang === sourceLang) continue
      const langFile = path.join(absPath, `${lang}.json`)
      let langData
      try {
        langData = JSON.parse(fs.readFileSync(langFile, 'utf-8'))
      } catch (err) {
        errors.push(`无法解析 ${localePath}/${lang}.json: ${err.message}`)
        continue
      }
      const langKeyCount = countKeys(langData)

      if (langKeyCount !== sourceKeyCount) {
        errors.push(
          `key 数量不一致: ${localePath}/${sourceLang}.json (${sourceKeyCount} 条) vs ${lang}.json (${langKeyCount} 条)`
        )
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

module.exports = { countKeys, validateLocalePaths }
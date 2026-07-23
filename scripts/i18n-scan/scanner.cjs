/**
 * 文件扫描器
 * 使用 fast-glob 匹配文件，调用 SFC 解析器逐文件处理
 */

const fg = require('fast-glob')
const path = require('path')
const fs = require('fs')
const { parseVueFile } = require('./parsers/vue-sfc-parser.cjs')

/**
 * 扫描项目文件，提取所有中文文本
 * @param {object} config - 扫描配置（来自 i18n.config.js）
 * @param {string} projectRoot - 项目根目录
 * @returns {Promise<{ results: object[], errors: object[], filesScanned: number }>}
 */
async function scanFiles(config, projectRoot) {
  const allResults = []
  const allErrors = []
  let filesScanned = 0

  // 使用相对路径 + cwd，避免 Windows 绝对路径兼容问题
  const patterns = config.entry

  // 构建排除模式
  const ignorePatterns = ['**/node_modules/**', '**/dist/**']
  if (config.exclude && config.exclude.length > 0) {
    ignorePatterns.push(...config.exclude)
  }

  // 扫描文件
  let files = []
  try {
    files = await fg(patterns, {
      cwd: projectRoot,
      ignore: ignorePatterns,
      absolute: true,
      onlyFiles: true,
    })
  } catch (err) {
    allErrors.push({ file: '', message: `文件扫描失败: ${err.message}` })
    return { results: allResults, errors: allErrors, filesScanned: 0 }
  }

  filesScanned = files.length

  // 逐文件解析
  for (const filePath of files) {
    // 读取文件内容
    let source
    try {
      source = fs.readFileSync(filePath, 'utf-8')
    } catch (err) {
      allErrors.push({
        file: filePath,
        message: `读取文件失败: ${err.message}`,
      })
      continue
    }

    // 解析文件
    const { results, errors } = parseVueFile(filePath, source, config)

    // 收集结果
    allResults.push(...results)

    // 收集错误
    errors.forEach((msg) => {
      allErrors.push({ file: filePath, message: msg })
    })
  }

  return { results: allResults, errors: allErrors, filesScanned }
}

module.exports = { scanFiles }

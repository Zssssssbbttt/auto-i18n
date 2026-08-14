/**
 * 打印工具
 * 仅负责控制台格式化输出，不写文件
 */

const path = require('path')

/**
 * 打印分隔线
 * @param {string} title - 分隔线标题（可选）
 * @param {number} width - 分隔线宽度，默认 60
 */
function printSeparator(title, width = 60) {
  if (title) {
    const len = title.length
    const left = Math.max(0, Math.floor((width - len - 2) / 2))
    const right = Math.max(0, width - len - 2 - left)
    console.log(`${'='.repeat(left)} ${title} ${'='.repeat(right)}`)
  } else {
    console.log('='.repeat(width))
  }
}

/**
 * 打印文件分隔标题
 * @param {string} filePath - 文件路径
 */
function printFileHeader(filePath) {
  console.log('')
  printSeparator(`  ${filePath}  `)
}

/**
 * 打印解析失败的文件列表
 * 这些文件因解析错误未参与扫描，其中文需要人工处理
 * @param {object[]} errors - [{ file, message }]
 * @param {string} projectRoot - 项目根目录（用于显示相对路径）
 */
function printParseErrors(errors, projectRoot) {
  if (!errors || errors.length === 0) return
  console.log('')
  printSeparator('解析失败（未扫描）')
  for (const err of errors) {
    const relPath = err.file
      ? path.relative(projectRoot, err.file).replace(/\\/g, '/')
      : ''
    console.log(`  ${relPath ? relPath + ' — ' : ''}${err.message}`)
  }
}

module.exports = { printSeparator, printFileHeader, printParseErrors }

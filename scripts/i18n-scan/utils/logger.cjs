/**
 * 打印工具
 * 仅负责控制台格式化输出，不写文件
 */

/**
 * 打印分隔线
 * @param {string} title - 分隔线标题（可选）
 * @param {number} width - 分隔线宽度，默认 60
 */
function printSeparator(title, width = 60) {
  if (title) {
    const len = title.length
    const left = Math.floor((width - len - 2) / 2)
    const right = width - len - 2 - left
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

module.exports = { printSeparator, printFileHeader }

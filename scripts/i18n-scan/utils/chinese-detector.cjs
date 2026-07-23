/**
 * 中文检测工具
 * 提供中文文本的检测、提取、判断等基础功能
 */

// 匹配中文字符的正则
const CHINESE_RE = /[一-龥]/

/**
 * 判断字符串是否包含中文
 * @param {string} str - 待检测字符串
 * @returns {boolean}
 */
function hasChinese(str) {
  if (!str || typeof str !== 'string') return false
  return CHINESE_RE.test(str)
}

module.exports = { hasChinese }

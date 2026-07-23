/**
 * Key 查找器
 * 通过现有 locale 反向映射查找中文对应的 key
 * 未匹配的不自动生成，直接归类输出中文原文
 */

/**
 * 在 locale 反向映射中查找中文对应的 key
 * @param {string} chineseText - 中文文本
 * @param {object} reverseMap - 现有 locale 的反向映射 { 中文: 'module.key' }
 * @returns {{ key: string|null, module: string|null, matched: boolean }}
 */
function lookupKey(chineseText, reverseMap) {
  if (reverseMap && reverseMap[chineseText]) {
    const fullKey = reverseMap[chineseText]
    // 从 'common.search' 中提取模块名 'common'
    const module = fullKey.split('.')[0]
    return { key: fullKey, module, matched: true }
  }

  // 未匹配：不生成 key，不猜模块
  return { key: null, module: null, matched: false }
}

module.exports = { lookupKey }

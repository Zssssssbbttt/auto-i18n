/**
 * 源码替换器
 * 纯 Node.js 实现，不依赖第三方包
 * 按行定位中文文本，从后往前替换避免行号偏移
 */

const fs = require('fs')

/**
 * 对单个文件执行替换
 * @param {string} filePath - 文件绝对路径
 * @param {object[]} items - 该文件的匹配结果
 * @param {object} reverseMap - locale 反向映射 { 中文: 'module.key' }
 * @returns {{ changed: boolean, newKeys: string[] }}
 */
function replaceInFile(filePath, items, reverseMap) {
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n')
  const newKeys = []
  let changed = false

  // 按行分组
  const byLine = {}
  for (const item of items) {
    // 特殊类型不替换
    if (
      item.type === 'special-template-literal' ||
      item.type === 'special-string-concat'
    ) {
      continue
    }
    const key = reverseMap[item.chineseText] || null
    if (!key) {
      newKeys.push(item.chineseText)
      continue
    }
    const lineIdx = item.line - 1
    if (!byLine[lineIdx]) byLine[lineIdx] = []
    byLine[lineIdx].push({ ...item, key })
  }

  // 从后往前处理每一行
  const lineNums = Object.keys(byLine)
    .map(Number)
    .sort((a, b) => b - a)
  for (const lineIdx of lineNums) {
    let line = lines[lineIdx]
    if (!line) continue

    // 同一行内按中文文本长度降序排列，避免短文本先替换导致长文本匹配失败
    const lineItems = byLine[lineIdx].sort(
      (a, b) => b.chineseText.length - a.chineseText.length
    )

    for (const item of lineItems) {
      const replacement = buildReplacement(item, item.key)
      if (!replacement) continue

      let start, end

      if (item.type === 'static-attr') {
        // 静态属性：定位整个属性 label="中文" → :label="$t('key')"
        const pattern = `${item.attrName}="${item.chineseText}"`
        const idx = line.indexOf(pattern)
        if (idx === -1) continue
        start = idx
        end = idx + pattern.length
      } else {
        // 其他类型：定位中文文本
        let idx = line.indexOf(item.chineseText)
        if (idx === -1) continue

        start = idx
        end = idx + item.chineseText.length

        // script-string / dynamic-attr / interpolation：去掉外围引号 '中文' → $t('key')
        if (
          item.type === 'script-string' ||
          item.type === 'dynamic-attr' ||
          item.type === 'interpolation'
        ) {
          const charBefore = idx > 0 ? line[idx - 1] : ''
          const charAfter =
            idx + item.chineseText.length < line.length
              ? line[idx + item.chineseText.length]
              : ''
          if (charBefore === "'" || charBefore === '"' || charBefore === '`') {
            start = idx - 1
          }
          if (charAfter === "'" || charAfter === '"' || charAfter === '`') {
            end = end + 1
          }
        }
      }

      line = line.slice(0, start) + replacement + line.slice(end)
      changed = true
    }

    lines[lineIdx] = line
  }

  if (changed) {
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8')
    // 替换后检查并注入 import { $t }
    injectImportT(filePath)
  }

  return { changed, newKeys }
}

/**
 * 检查 Vue 文件是否使用了 $t() 但没有 import，自动补全
 * @param {string} filePath - 文件绝对路径
 */
function injectImportT(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8')

  // 检查是否使用了 $t()
  if (!/\$t\(/.test(content)) return

  // 检查是否已有 import { $t } 或 import { ... $t ... }
  if (/import\s*\{[^}]*\$t[^}]*\}\s*from/.test(content)) return

  // 找到 <script> 或 <script setup> 标签
  const scriptMatch = content.match(/<script\b[^>]*>/)
  if (!scriptMatch) return

  const scriptTag = scriptMatch[0]
  const scriptStart = scriptMatch.index
  const afterTagIdx = scriptStart + scriptTag.length

  // 在 script 标签内部查找所有 import 语句
  const scriptEndMatch = content.indexOf('</script>', afterTagIdx)
  const scriptBody = content.slice(afterTagIdx, scriptEndMatch)

  // 找最后一个 import 语句的位置
  const importRegex = /^import\s+.+$/gm
  let lastImportEnd = -1
  let match
  while ((match = importRegex.exec(scriptBody)) !== null) {
    lastImportEnd = match.index + match[0].length
  }

  let insertPos
  let newContent

  if (lastImportEnd >= 0) {
    // 在最后一个 import 之后插入
    insertPos = afterTagIdx + lastImportEnd
    // 找到该行末尾的换行符之后
    const afterImport = content.indexOf('\n', insertPos)
    insertPos = afterImport >= 0 ? afterImport + 1 : insertPos
    newContent =
      content.slice(0, insertPos) +
      `import { $t } from '@/locales'\n` +
      content.slice(insertPos)
  } else {
    // 没有 import 语句，插入到 <script> 标签后的第一行
    insertPos = afterTagIdx
    // 跳过标签后的换行符
    let idx = insertPos
    while (idx < content.length && content[idx] === '\n') idx++
    // 在换行符之后插入，保持一个空行
    const leadingNewlines = content.slice(insertPos, idx)
    newContent =
      content.slice(0, insertPos) +
      leadingNewlines +
      `import { $t } from '@/locales'\n` +
      content.slice(idx)
  }

  fs.writeFileSync(filePath, newContent, 'utf-8')
}

/**
 * 根据匹配类型生成替换文本
 */
function buildReplacement(item, key) {
  switch (item.type) {
    case 'static-attr':
      // label="中文" → :label="$t('key')"
      return `:${item.attrName}="$t('${key}')"`

    case 'dynamic-attr':
    case 'interpolation':
      // 表达式中的 '中文' → $t('key')
      return `$t('${key}')`

    case 'text-content':
      // <span>中文</span> → <span>{{ $t('key') }}</span>
      return `{{ $t('${key}') }}`

    case 'script-string':
      // '中文' → $t('key')
      return `$t('${key}')`

    default:
      return null
  }
}

module.exports = { replaceInFile }

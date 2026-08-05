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
 * @param {boolean} scriptReactive - 是否对 const 变量包裹 computed
 * @returns {{ changed: boolean, newKeys: string[] }}
 */
function replaceInFile(filePath, items, reverseMap, scriptReactive = false) {
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

  // 处理 template-literal 类型：按行列范围分组，整体重建模板字符串
  const templateLiteralGroups = {}
  for (const lineIdx of Object.keys(byLine)) {
    const lineItems = byLine[lineIdx]
    const templateItems = lineItems.filter(
      (i) => i.type === 'template-literal'
    )
    if (templateItems.length === 0) continue

    for (const item of templateItems) {
      const groupKey = `${item.templateStartCol}:${item.templateEndCol}`
      if (!templateLiteralGroups[`${lineIdx}:${groupKey}`]) {
        templateLiteralGroups[`${lineIdx}:${groupKey}`] = {
          lineIdx: Number(lineIdx),
          startCol: item.templateStartCol,
          endCol: item.templateEndCol,
          quasis: item.quasis,
          expressions: item.expressions,
          items: [],
        }
      }
      templateLiteralGroups[`${lineIdx}:${groupKey}`].items.push(item)
    }

    // 从 byLine 中移除 template-literal 条目（它们会被整体处理）
    byLine[lineIdx] = lineItems.filter((i) => i.type !== 'template-literal')
    if (byLine[lineIdx].length === 0) delete byLine[lineIdx]
  }

  // 对每组模板字符串执行重建
  for (const groupKey of Object.keys(templateLiteralGroups)) {
    const group = templateLiteralGroups[groupKey]
    const lineIdx = group.lineIdx
    let line = lines[lineIdx]
    if (!line) continue

    // 构建 quasiIndex → key 映射
    const quasiKeyMap = {}
    for (const item of group.items) {
      if (item.key) {
        quasiKeyMap[item.quasiIndex] = item.key
      }
    }

    // 重建模板字符串
    let newTemplate = '`'
    for (let i = 0; i < group.quasis.length; i++) {
      if (quasiKeyMap[i] !== undefined) {
        newTemplate += '${$t(\'' + quasiKeyMap[i] + '\')}'
      } else {
        newTemplate += group.quasis[i]
      }
      if (i < group.expressions.length) {
        newTemplate += '${' + group.expressions[i] + '}'
      }
    }
    newTemplate += '`'

    line = line.slice(0, group.startCol) + newTemplate + line.slice(group.endCol + 1)
    lines[lineIdx] = line
    changed = true
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

        // script-string / dynamic-attr / interpolation：去掉外围引号
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

  // scriptReactive: 对 const 变量包裹 computed(() => ...)
  if (scriptReactive) {
    wrapWithComputed(lines, items)
    changed = true  // 只要有 scriptReactive 匹配的变量，视为有变更
  }

  if (changed) {
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8')
    // 替换后检查并注入 import
    injectImports(filePath)
  }

  return { changed, newKeys }
}

/**
 * 对 scriptTargets 中 const 声明的变量包裹 computed(() => ...)
 * 按 varName 去重，从后往前包裹避免行号偏移
 */
function wrapWithComputed(lines, allItems) {
  // 收集有 varName 的条目，按 varName 去重
  const varGroups = {}
  for (const item of allItems) {
    if (!item.varName || !item.isConst) continue
    // 已经是 computed() 包裹的变量不重复包裹
    if (item.isComputed) continue
    // 仅纯文本值（非 ref/reactive 包裹）才需要 computed 包裹
    if (!item.isPlainValue) continue
    // 同一变量只保留第一个（元数据相同）
    if (!varGroups[item.varName]) {
      varGroups[item.varName] = item
    }
  }

  const entries = Object.values(varGroups)
  if (entries.length === 0) return

  // 从后往前处理，避免行号偏移
  entries.sort((a, b) => b.initStartLine - a.initStartLine)

  for (const meta of entries) {
    wrapSingleInit(lines, meta)
  }
}

/**
 * 包裹单个变量声明的 init 表达式为 computed(() => ...)
 */
function wrapSingleInit(lines, meta) {
  const startIdx = meta.initStartLine - 1
  if (startIdx < 0 || startIdx >= lines.length) return

  const startLine = lines[startIdx]

  // 找到变量声明中的 "=" 位置（在 init 开始列之前）
  const eqIdx = startLine.lastIndexOf('=', meta.initStartCol)
  if (eqIdx < 0) return

  const prefix = startLine.slice(0, eqIdx + 1)
  const after = startLine.slice(eqIdx + 1)

  if (meta.initStartLine === meta.initEndLine) {
    // 单行：const columns = expr → const columns = computed(() => expr)
    lines[startIdx] = prefix + ' computed(() =>' + after + ')'
  } else {
    // 多行：在 "=" 后插入 "computed(() =>"，末尾加 ")"
    lines[startIdx] = prefix + ' computed(() =>' + after
    const endIdx = meta.initEndLine - 1
    if (endIdx >= 0 && endIdx < lines.length) {
      lines[endIdx] = lines[endIdx] + ')'
    }
  }
}

/**
 * 从 import 起始行向后扫描，找到 import 语句真正的结束位置
 * 处理多行 import：import { a,\n  b\n } from 'x' 的情况
 * 找到 from '...' 所在行的换行符作为插入点
 * @param {string} content - 文件完整内容
 * @param {number} startPos - import 起始行末尾位置
 * @returns {number} 插入位置（from 行换行符之后，或退化为 startPos 后第一个换行符）
 */
function skipToImportEnd(content, startPos) {
  const remaining = content.slice(startPos)
  const fromMatch = remaining.match(/from\s*['"][^'"]*['"]/)
  if (fromMatch) {
    const fromEnd = startPos + fromMatch.index + fromMatch[0].length
    const nextNewline = content.indexOf('\n', fromEnd)
    return nextNewline >= 0 ? nextNewline + 1 : fromEnd
  }
  // 无 from（如 import 'module'），退化为原逻辑
  const nextNewline = content.indexOf('\n', startPos)
  return nextNewline >= 0 ? nextNewline + 1 : startPos
}

/**
 * 检查文件是否使用了 $t() 但没有 import，自动补全
 * 同时检查 computed() 是否需要注入
 * @param {string} filePath - 文件绝对路径
 */
function injectImports(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8')

  const usesT = /\$t\(/.test(content)
  const usesComputed = /computed\(/.test(content)

  if (!usesT && !usesComputed) return

  // 检查是否已有 import { $t } 或 import { ... $t ... }
  const hasImportT = /import\s*\{[^}]*\$t[^}]*\}\s*from/.test(content)
  // 检查是否已有 import { computed } 或 import { ... computed ... }
  const hasImportComputed = /import\s*\{[^}]*computed[^}]*\}\s*from/.test(content)

  // 需要注入的 import 语句
  const importsToAdd = []
  if (usesT && !hasImportT) {
    importsToAdd.push("import { $t } from '@/locales'")
  }
  if (usesComputed && !hasImportComputed) {
    importsToAdd.push("import { computed } from 'vue'")
  }

  if (importsToAdd.length === 0) return

  const importBlock = importsToAdd.join('\n') + '\n'

  // 找到 <script> 或 <script setup> 标签（.vue 文件）
  const scriptMatch = content.match(/<script\b[^>]*>/)

  if (scriptMatch) {
    // .vue 文件：在 <script> 标签内最后一个 import 之后插入
    const scriptTag = scriptMatch[0]
    const scriptStart = scriptMatch.index
    const afterTagIdx = scriptStart + scriptTag.length

    const scriptEndMatch = content.indexOf('</script>', afterTagIdx)
    const scriptBody = content.slice(afterTagIdx, scriptEndMatch)

    const importRegex = /^import\s+.+$/gm
    let lastImportEnd = -1
    let match
    while ((match = importRegex.exec(scriptBody)) !== null) {
      lastImportEnd = match.index + match[0].length
    }

    let newContent = content

    if (lastImportEnd >= 0) {
      let insertPos = afterTagIdx + lastImportEnd
      insertPos = skipToImportEnd(content, insertPos)
      newContent =
        content.slice(0, insertPos) + importBlock + content.slice(insertPos)
    } else {
      let insertPos = afterTagIdx
      let idx = insertPos
      while (idx < content.length && content[idx] === '\n') idx++
      const leadingNewlines = content.slice(insertPos, idx)
      newContent =
        content.slice(0, insertPos) +
        leadingNewlines +
        importBlock +
        content.slice(idx)
    }

    fs.writeFileSync(filePath, newContent, 'utf-8')
  } else {
    // .ts / .js 文件：在最后一个 import 之后插入，没有 import 则在文件顶部插入
    const importRegex = /^import\s+.+$/gm
    let lastImportEnd = -1
    let match
    while ((match = importRegex.exec(content)) !== null) {
      lastImportEnd = match.index + match[0].length
    }

    let newContent = content

    if (lastImportEnd >= 0) {
      let insertPos = lastImportEnd
      insertPos = skipToImportEnd(content, insertPos)
      newContent =
        content.slice(0, insertPos) + importBlock + content.slice(insertPos)
    } else {
      newContent = importBlock + '\n' + content
    }

    fs.writeFileSync(filePath, newContent, 'utf-8')
  }
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

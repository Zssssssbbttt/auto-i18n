/**
 * 报告输出模块
 * dry-run diff、Key 汇总、盲区报告、dump 导出
 */
const fs = require('fs')
const path = require('path')

/**
 * 格式化替换后的调用代码
 */
function formatCall(type, key, config, isVue) {
  const t = (config && config.tFunction) || '$t'
  const useTypeToString = config && config.typeToString !== false

  if (type === 'TEMPLATE_TEXT') return `{{ ${t}('${key}') }}`
  if (type === 'TEMPLATE_ATTR') return `:${t}('${key}')`
  if (type === 'TEMPLATE_QUASI') return `\${${t}('${key}')}`
  if (type === 'JS_STRING') {
    const fn = useTypeToString ? 'i18nTypeToString' : t
    return `this.${fn}('${key}')`
  }
  if (type === 'SCRIPT_TARGET_ARRAY') {
    const call = isVue ? formatVueCall(t, key, config) : `i18n.t('${key}')`
    return `${call}  [computed 包裹]`
  }
  // SCRIPT_TARGET_OBJECT, TRANSLATE_METHOD_ARG, TRANSLATE_METHOD_PROP
  if (isVue) return formatVueCall(t, key, config)
  return `i18n.t('${key}')`
}

function formatVueCall(t, key, config) {
  const useTypeToString = config && config.typeToString !== false
  const fnName = useTypeToString ? 'i18nTypeToString' : t
  return `this.${fnName}('${key}')`
}

/**
 * dry-run 详细 diff 输出
 */
function printDryRunDiff(allDiffs, config) {
  const t = (config && config.tFunction) || '$t'
  for (const [relPath, { changes, code }] of Object.entries(allDiffs)) {
    console.log(`============================================================`)
    console.log(`  ${relPath}`)
    console.log(`============================================================`)

    const lines = code.split('\n')
    const isVue = relPath.endsWith('.vue')

    for (const c of changes) {
      const lineIdx = c.line - 1
      const contextLine = lines[lineIdx] ? lines[lineIdx].trim() : ''

      console.log(`  L ${String(c.line).padStart(3)} │ ${c.text}`)
      console.log(`       │ →  ${formatCall(c.type, c.key, config, isVue)}`)
      console.log(`       │ ${contextLine}`)
      console.log('')
    }
  }

  writeDiffLog(allDiffs, config)
}

function writeDiffLog(allDiffs, config) {
  const logDir = config.logDir || 'logs'
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const logFile = path.join(logDir, `i18n-diff_${timestamp}.log`)

  let content = `i18n dry-run diff - ${timestamp}\n${'='.repeat(60)}\n`
  for (const [relPath, { changes }] of Object.entries(allDiffs)) {
    content += `\n${relPath}\n${'-'.repeat(40)}\n`
    const isVue = relPath.endsWith('.vue')
    for (const c of changes) {
      const call = formatCall(c.type, c.key, config, isVue)
      content += `  L${c.line}: "${c.text}" → ${call}\n`
    }
  }
  fs.writeFileSync(logFile, content, 'utf-8')
}

/**
 * Key Summary 按模块分组输出
 */
function printKeySummary(allDiffs, config) {
  const t = (config && config.tFunction) || '$t'
  const keyMap = {}
  const seen = new Set()

  for (const [relPath, { changes }] of Object.entries(allDiffs)) {
    const isVue = relPath.endsWith('.vue')
    for (const c of changes) {
      if (seen.has(c.key)) continue
      seen.add(c.key)
      const module = c.key.split('.')[0]
      if (!keyMap[module]) keyMap[module] = []
      keyMap[module].push({ text: c.text, key: c.key, type: c.type, isVue })
    }
  }

  console.log(`============================================================`)
  console.log(`  Key 汇总 (${seen.size} 个唯一 key)`)
  console.log(`============================================================\n`)

  for (const [module, entries] of Object.entries(keyMap).sort()) {
    for (const { text, key, type, isVue } of entries) {
      console.log(`  [${module}] ${text}  →  ${formatCall(type, key, config, isVue)}`)
    }
  }
  console.log('')
}

/**
 * --dump: 导出待翻译文本到文件
 */
function dumpUnmapped(unmappedByFile, config) {
  const logDir = config.logDir || 'logs'
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dumpFile = path.join(logDir, `i18n-unmapped_${timestamp}.txt`)

  const allTexts = []
  for (const texts of Object.values(unmappedByFile)) {
    allTexts.push(...texts)
  }
  const uniqueTexts = [...new Set(allTexts)]

  const allFilePaths = Object.keys(unmappedByFile).join(', ')
  const targetLanguages = config.languages.filter(l => l !== 'zh-CN')
  let content = config.ai.userPromptTemplate
    .replace('{filePath}', allFilePaths)
    .replace('{targetLanguages}', targetLanguages.join(', '))
    .replace('{chineseTexts}', uniqueTexts.map((t, i) => `${i + 1}. ${t}`).join('\n'))

  fs.writeFileSync(dumpFile, content, 'utf-8')
  console.log(`\n========== 待翻译文本已导出 ==========`)
  console.log(`  文件: ${path.resolve(dumpFile)}`)
  console.log(`  总计: ${allTexts.length} 条（去重后 ${uniqueTexts.length} 条）`)
  console.log(`  涉及: ${Object.keys(unmappedByFile).length} 个文件`)
  console.log(`========================================\n`)
}

/**
 * --gap: 正则暴力扫描，找出 AST 扫描器遗漏的中文文本
 */
function findScannerGaps(code, scannerItems, config) {
  const gaps = []

  const covered = new Array(code.length).fill(false)
  for (const item of scannerItems) {
    for (let i = item.start; i < item.end; i++) {
      covered[i] = true
    }
  }

  // 收集注释区间
  const commentRanges = []
  let cm
  const htmlCommentRe = /<!--[\s\S]*?-->/g
  while ((cm = htmlCommentRe.exec(code)) !== null) {
    commentRanges.push({ start: cm.index, end: cm.index + cm[0].length })
  }
  const lineCommentRe = /\/\/.*/g
  while ((cm = lineCommentRe.exec(code)) !== null) {
    commentRanges.push({ start: cm.index, end: cm.index + cm[0].length })
  }
  const blockCommentRe = /\/\*[\s\S]*?\*\//g
  while ((cm = blockCommentRe.exec(code)) !== null) {
    commentRanges.push({ start: cm.index, end: cm.index + cm[0].length })
  }

  function isInComment(pos) {
    return commentRanges.some(r => pos >= r.start && pos < r.end)
  }

  // 收集黑名单属性区间
  const ignoreAttrs = config.ignoreAttributes || []
  const attrRanges = []
  if (ignoreAttrs.length > 0) {
    const attrRe = new RegExp(
      `\\b(${ignoreAttrs.map(escapeRe).join('|')})\\s*=\\s*"[^"]*"`,
      'g'
    )
    while ((cm = attrRe.exec(code)) !== null) {
      attrRanges.push({ start: cm.index, end: cm.index + cm[0].length })
    }
  }

  function isInBlacklistedAttr(pos) {
    return attrRanges.some(r => pos >= r.start && pos < r.end)
  }

  // 收集黑名单方法调用区间
  const ignoreMethods = config.ignoreMethods || []
  const methodRanges = []
  if (ignoreMethods.length > 0) {
    const methodRe = new RegExp(
      `(${ignoreMethods.map(escapeRe).join('|')})\\s*\\([^)]*\\)`,
      'g'
    )
    while ((cm = methodRe.exec(code)) !== null) {
      methodRanges.push({ start: cm.index, end: cm.index + cm[0].length })
    }
  }

  function isInBlacklistedMethod(pos) {
    return methodRanges.some(r => pos >= r.start && pos < r.end)
  }

  const chineseRe = /[一-龥]+/g
  while ((cm = chineseRe.exec(code)) !== null) {
    if (covered[cm.index]) continue
    if (isInComment(cm.index)) continue
    if (isInBlacklistedAttr(cm.index)) continue
    if (isInBlacklistedMethod(cm.index)) continue

    const lineNum = code.slice(0, cm.index).split('\n').length
    const lineStart = code.lastIndexOf('\n', cm.index) + 1
    const lineEnd = code.indexOf('\n', cm.index)
    const line = code.slice(lineStart, lineEnd === -1 ? code.length : lineEnd)

    gaps.push({ text: cm[0], line: line.trim(), lineNum })
  }

  return gaps
}

function escapeRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 输出盲区报告（控制台 + 日志文件）
 */
function printGapReport(allGaps, config) {
  let totalGaps = 0
  const fileCount = Object.keys(allGaps).length

  console.log(`\n========== 扫描盲区（AST 未捕获的中文）==========`)
  console.log(`  以下 ${fileCount} 个文件存在未被 AST 捕获的中文文本:\n`)

  for (const [relPath, gaps] of Object.entries(allGaps)) {
    console.log(`  ${relPath}  (${gaps.length} 处)`)
    for (const g of gaps) {
      console.log(`    L${String(g.lineNum).padStart(4)} │ ${g.text}`)
    }
    totalGaps += gaps.length
  }
  console.log(`\n  盲区合计: ${totalGaps} 处，涉及 ${fileCount} 个文件`)
  console.log(`========================================\n`)

  const logDir = config.logDir || 'logs'
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const logFile = path.join(logDir, `i18n-gap_${timestamp}.log`)

  let content = `i18n 扫描盲区报告 - ${timestamp}\n`
  content += `${'='.repeat(60)}\n`
  content += `以下中文文本未被 AST 扫描器捕获（已排除注释、黑名单属性/方法）\n`
  content += `${'='.repeat(60)}\n\n`

  for (const [relPath, gaps] of Object.entries(allGaps)) {
    content += `\n${'-'.repeat(40)}\n`
    content += `文件: ${relPath}  (${gaps.length} 处)\n`
    content += `${'-'.repeat(40)}\n`
    for (const g of gaps) {
      content += `  L${String(g.lineNum).padStart(4)} │ ${g.text}\n`
      content += `       │ ${g.line}\n\n`
    }
  }

  content += `\n${'='.repeat(60)}\n`
  content += `汇总: ${totalGaps} 处遗漏，涉及 ${fileCount} 个文件\n`
  content += `${'='.repeat(60)}\n`

  fs.writeFileSync(logFile, content, 'utf-8')
}

module.exports = { printDryRunDiff, printKeySummary, dumpUnmapped, findScannerGaps, printGapReport }
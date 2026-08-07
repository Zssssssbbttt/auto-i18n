/**
 * i18n 自动国际化脚本 - 主入口
 *
 * 语言包是唯一数据源：zh-CN.json 中的 中文→key 映射决定所有替换。
 * 不在语言包中的中文会被跳过并在报告中列出，用户需先手动添加到语言包。
 *
 * 用法：
 *   node src/scripts/i18n/index.js              # 完整运行
 *   node src/scripts/i18n/index.js -d           # dry-run 预览变更
 *   node src/scripts/i18n/index.js -c <path>    # 指定配置文件
 *   node src/scripts/i18n/index.js --dump       # 导出待翻译文本到文件
 */
const fs = require('fs')
const path = require('path')
const fg = require('fast-glob')
const pm = require('picomatch')
const { loadConfig } = require('./config')
const { parseVueTemplate, parseScript, extraScan, parseScriptTargets, parseTranslateMethods, getScriptCode } = require('./scanner')
const { buildReverseIndex } = require('./locale-manager')
const { translateAll, mergeToLocales } = require('./translator')
const { applyReplacements } = require('./patcher')
const { printDryRunDiff, printKeySummary, dumpUnmapped, findScannerGaps, printGapReport } = require('./report')
const { runWizard } = require('./wizard')

async function main() {
  const args = process.argv.slice(2)
  const wizardMode = args.includes('--wizard')

  if (wizardMode) {
    const configPath = args.includes('-c') ? args[args.indexOf('-c') + 1] : null
    await runWizard(configPath)
    return
  }

  const dryRun = args.includes('-d') || args.includes('--dry-run')
  const configPath = args.includes('-c') ? args[args.indexOf('-c') + 1] : null
  const useAI = args.includes('--ai')
  const translateOnly = args.includes('--translate-only')
  const dumpOnly = args.includes('--dump')
  const gapOnly = args.includes('--gap')

  console.log('\n========== i18n 扫描开始 ==========\n')

  // 1. 加载配置
  const config = loadConfig(configPath)
  console.log(`  配置加载完成，输出目录: ${path.resolve(config.output)}`)
  console.log(`  源语言: ${config.languages[0] || 'zh-CN'}`)
  console.log(`  目标语言: ${config.languages.slice(1).join(', ') || '(无)'}`)

  // 2. 扫描文件
  const files = scanFiles(config)
  console.log(`  扫描到 ${files.length} 个文件\n`)

  // 3. 从 zh-CN.json 构建反向索引（中文 → 嵌套key）
  const zhPath = path.join(config.output, 'zh-CN.json')
  const zhExists = fs.existsSync(zhPath)
  let reverseIndex = {}
  let badKeys = []

  if (zhExists) {
    const result = buildReverseIndex(zhPath)
    reverseIndex = result.reverse
    badKeys = result.badKeys
    console.log(`  语言包: 从 zh-CN.json 加载 ${Object.keys(reverseIndex).length} 条映射`)
  } else if (useAI || translateOnly) {
    console.log(`  语言包: zh-CN.json 不存在，将使用 AI 冷启动生成`)
  } else {
    console.log(`  语言包: zh-CN.json 不存在，请先运行 npm run i18n:init 初始化，或使用 --ai 参数`)
  }

  // 检查语言包中的问题条目
  if (badKeys.length > 0) {
    console.log(`  ⚠ 警告: 语言包中有 ${badKeys.length} 条 key 和 value 相同，无法用于映射:`)
    for (const k of badKeys) {
      console.log(`    - ${k}: "${k}" (请修改为有意义的英文 key)`)
    }
  }
  console.log('')

  // 4. 提取所有中文，按文件组织
  const fileItems = {} // { relPath: { file, code, items: [...] } }
  const textSource = {} // { "中文文本": "文件路径" } 用于报告
  let totalStrings = 0

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf-8')
    const relPath = path.relative(config.baseDir, file)

    let templateItems = []
    if (file.endsWith('.vue')) {
      templateItems = parseVueTemplate(code, file, config)
    }

    let scriptItems = []
    if (config.scriptScan !== false) {
      const sc = getScriptCode(code, file)
      if (sc) {
        if (config.scriptTargets || config.translateMethods) {
          // 白名单模式：精确匹配 scriptTargets / translateMethods
          if (config.scriptTargets) {
            const targets = parseScriptTargets(sc.code, config)
            targets.forEach((item) => {
              item.start += sc.offset
              item.end += sc.offset
              if (item.wrapStart != null) item.wrapStart += sc.offset
              if (item.wrapEnd != null) item.wrapEnd += sc.offset
            })
            scriptItems.push(...targets)
          }
          if (config.translateMethods) {
            const methods = parseTranslateMethods(sc.code, config)
            methods.forEach((item) => {
              item.start += sc.offset
              item.end += sc.offset
            })
            scriptItems.push(...methods)
          }
        } else {
          // 回退：扫描所有含中文字符串
          scriptItems = parseScript(sc.code, file, config)
          scriptItems.forEach((item) => {
            item.start += sc.offset
            item.end += sc.offset
          })
        }
      }
    }

    // 补充扫描：动态属性（正则兜底）
    let extraItems = []
    if (file.endsWith('.vue')) {
      extraItems = extraScan(code, file, config)
    }

    const items = [...templateItems, ...scriptItems, ...extraItems]
    totalStrings += items.length
    for (const item of items) {
      if (!textSource[item.text]) textSource[item.text] = relPath
    }
    fileItems[relPath] = { file, code, items }
  }

  // --gap: 仅扫描盲区
  if (gapOnly) {
    const allGaps = {}
    for (const [relPath, { code, items }] of Object.entries(fileItems)) {
      const gaps = findScannerGaps(code, items, config)
      if (gaps.length > 0) allGaps[relPath] = gaps
    }
    printGapReport(allGaps, config)
    return
  }

  // 4.5 匹配 + AI 翻译循环
  let allFileItems = []
  let unmappedSet = new Set()

  function separateItems() {
    allFileItems = []
    unmappedSet = new Set()
    const unmappedByFile = {}

    for (const [relPath, { file, code, items }] of Object.entries(fileItems)) {
      const mapped = items.filter((item) => {
        if (reverseIndex[item.text]) return true
        // 回退：剥离首尾标点后用 matchText 匹配
        if (item.matchText && reverseIndex[item.matchText]) {
          const offset = item.text.indexOf(item.matchText)
          item.start = item.start + offset
          item.end = item.start + item.matchText.length
          item.text = item.matchText
          return true
        }
        return false
      })
      const unmapped = items.filter((item) => !reverseIndex[item.text])

      unmapped.forEach((item) => unmappedSet.add(item.text))

      if (useAI || translateOnly || dumpOnly) {
        for (const item of unmapped) {
          if (!unmappedByFile[relPath]) unmappedByFile[relPath] = []
          if (!unmappedByFile[relPath].includes(item.text)) {
            unmappedByFile[relPath].push(item.text)
          }
        }
      }

      if (mapped.length > 0) {
        allFileItems.push({ file, code, items: mapped, relPath })
      }

      if (mapped.length > 0 || unmapped.length > 0) {
        const skipInfo = unmapped.length > 0 ? `跳过: ${unmapped.map((i) => `"${i.text}"`).join(', ')}` : ''
        console.log(`  ${relPath}: ${mapped.length} 条已匹配 ${skipInfo}`)
      }
    }

    return unmappedByFile
  }

  let unmappedByFile = separateItems()

  // --dump: 导出待翻译文本到文件，不触发 AI、不替换代码
  if (dumpOnly) {
    dumpUnmapped(unmappedByFile, config)
    return
  }

  // AI 翻译未匹配的中文
  if ((useAI || translateOnly) && Object.keys(unmappedByFile).length > 0) {
    const totalUnmapped = Object.values(unmappedByFile).reduce((s, a) => s + a.length, 0)
    console.log(`\n========== AI 翻译 ==========`)
    console.log(`  未匹配文本: ${totalUnmapped} 条`)
    console.log(`  涉及文件: ${Object.keys(unmappedByFile).length} 个\n`)

    try {
      const aiResult = await translateAll(unmappedByFile, config)
      const { added, skipped } = mergeToLocales(aiResult, config.output, config.languages)
      console.log(`  AI 翻译完成: 新增 ${added} 条，跳过 ${skipped} 条（已存在）\n`)

      // 重建反向索引
      const rebuilt = buildReverseIndex(zhPath)
      reverseIndex = rebuilt.reverse
      console.log(`  语言包已更新: ${Object.keys(reverseIndex).length} 条映射\n`)

      // 重新分离：检查还有哪些未匹配
      unmappedByFile = separateItems()
    } catch (err) {
      console.error(`  AI 翻译失败: ${err.message}`)
      if (!translateOnly) {
        console.log(`  将继续使用现有语言包进行替换\n`)
      }
    }
  }

  // 如果仅翻译模式，到此结束
  if (translateOnly) {
    const remaining = Object.values(unmappedByFile).reduce((s, a) => s + a.length, 0)
    console.log(`========== i18n 翻译完成 ==========`)
    console.log(`  生成语言包: ${config.languages.map((l) => `${l}.json`).join(', ')}`)
    console.log(`  输出目录: ${path.resolve(config.output)}`)
    if (remaining > 0) {
      console.log(`  剩余未匹配: ${remaining} 条（AI 未能翻译）`)
    }
    console.log(`========================================\n`)
    return
  }

  // 5. 替换代码
  const allDiffs = {}
  const modifiedFiles = []
  let totalReplacements = 0

  if (allFileItems.length > 0) {
    for (const { file, code, items, relPath } of allFileItems) {
      const { code: newCode, changes } = applyReplacements(code, items, reverseIndex, config, file)
      if (changes.length > 0) {
        modifiedFiles.push(file)
        allDiffs[relPath] = { changes, code }
        totalReplacements += changes.length
        if (!dryRun) {
          fs.writeFileSync(file, newCode, 'utf-8')
        }
      }
    }
  }

  // 6. 输出
  if (dryRun) {
    console.log(`\n========== 预览模式 - 不会修改任何文件 ==========\n`)
    if (Object.keys(allDiffs).length > 0) {
      printDryRunDiff(allDiffs, config)
      printKeySummary(allDiffs, config)
    }
  } else {
    console.log(`\n  已替换 ${modifiedFiles.length} 个文件中的 ${totalReplacements} 处字符串`)
  }

  // 7. 报告未映射的中文
  if (unmappedSet.size > 0) {
    console.log(`\n========== 未匹配的字符串（不在语言包中）==========`)
    console.log(`  以下 ${unmappedSet.size} 条未匹配，请先添加到 zh-CN.json:\n`)
    for (const text of [...unmappedSet].sort()) {
      const source = textSource[text] || '(未知)'
      console.log(`  - "${text}"  (${source})`)
    }
    console.log('')
  }

  // 8. 扫描盲区（dry-run 和正常模式都执行）
  const allGaps = {}
  for (const [relPath, { code, items }] of Object.entries(fileItems)) {
    const gaps = findScannerGaps(code, items, config)
    if (gaps.length > 0) allGaps[relPath] = gaps
  }
  if (Object.keys(allGaps).length > 0) {
    printGapReport(allGaps, config)
  }

  // 9. 汇总
  const mappedCount = Object.keys(reverseIndex).length
  console.log(`========== i18n 扫描汇总 ==========`)
  console.log(`  扫描文件:     ${files.length}`)
  console.log(`  修改文件:     ${dryRun ? 0 : modifiedFiles.length}`)
  console.log(`  发现字符串:   ${totalStrings}`)
  console.log(`  已匹配:       ${totalReplacements}`)
  console.log(`  未匹配:       ${unmappedSet.size}`)
  console.log(`  语言包 key 数: ${mappedCount}`)
  console.log(`  错误:         0`)
  console.log(`========================================\n`)
}

/**
 * 扫描文件
 */
function scanFiles(config) {
  const patterns = config.entry.map((e) => {
    if (e.endsWith('/')) return '**/*.{vue,js,ts,jsx,tsx}'
    if (e.includes('*')) return e
    if (fs.existsSync(e) && fs.statSync(e).isDirectory()) return '**/*.{vue,js,ts,jsx,tsx}'
    return e
  })
  const absBase = path.resolve(config.baseDir)
  const ignore = ['**/node_modules/**', '**/locales/**', '**/scripts/**']
  if (config.exclude && config.exclude.length > 0) {
    config.exclude.forEach((e) => {
      ignore.push(/[*?[\]{}]/.test(e) ? e : '**/' + e)
    })
  }
  let files = fg.sync(patterns, { cwd: absBase, absolute: true, ignore })

  if (config.include && config.include.length > 0) {
    const matchers = config.include.map((p) => pm(p))
    files = files.filter((f) => {
      const rel = path.relative(absBase, f).replace(/\\/g, '/')
      return matchers.some((m) => m(rel))
    })
  }

  return files
}

main().catch((err) => {
  console.error('错误:', err.message)
  console.error(err.stack)
  process.exit(1)
})

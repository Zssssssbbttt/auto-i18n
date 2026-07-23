/**
 * AI 翻译模块
 * 扫描 Vue 文件中的中文 → 去重 → 调用 AI API → 写回语言包
 */

const path = require('path')
const fs = require('fs')
const { scanFiles } = require('./scanner.cjs')
const { loadLocaleReverseMap } = require('./generators/locale-manager.cjs')

/**
 * 主入口：扫描 + 去重 + AI 翻译 + 写回
 * @param {object} config - i18n 配置
 * @param {string} projectRoot - 项目根目录
 */
async function translateViaAI(config, projectRoot) {
  const aiConfig = config.ai || {}
  if (!aiConfig.enabled) {
    console.log('AI 翻译未启用（config.ai.enabled = false），跳过')
    return
  }

  const outputDir = path.resolve(projectRoot, config.output || 'src/locales')
  const sourceLang = config.sourceLanguage || 'zh-CN'
  const targetLangs = config.targetLanguages || ['en']

  // ========== Step 1: 扫描 Vue 文件中的中文 ==========
  console.log('\n[1/4] 扫描项目文件中的中文文本...')
  const { results, errors, filesScanned } = await scanFiles(config, projectRoot)
  console.log(`  扫描 ${filesScanned} 个文件，发现 ${results.length} 处中文`)

  if (errors.length > 0) {
    console.log(`  警告: ${errors.length} 个解析错误`)
  }

  // 提取中文文本（去重，过滤特殊类型）
  const specialTypes = new Set([
    'special-template-literal',
    'special-string-concat',
  ])
  const allChineseTexts = []
  const specialItems = [] // 特殊类型，记录用于日志
  const seen = new Set()
  for (const item of results) {
    if (specialTypes.has(item.type)) {
      if (!seen.has(item.chineseText)) {
        seen.add(item.chineseText)
        specialItems.push(item)
      }
      continue
    }
    if (seen.has(item.chineseText)) continue
    seen.add(item.chineseText)
    allChineseTexts.push(item.chineseText)
  }
  console.log(`  去重后 ${allChineseTexts.length} 个唯一中文文本`)

  if (allChineseTexts.length === 0) {
    console.log('没有需要翻译的中文文本')
    return
  }

  // ========== Step 2: 加载已有翻译（去重） ==========
  console.log('\n[2/4] 加载已有翻译...')

  // 2a. 本项目 locale
  const {
    reverseMap: projectMap,
    localeData: sourceData,
    keyCount: projectKeyCount,
  } = loadLocaleReverseMap(outputDir, sourceLang)
  console.log(`  本项目语言包: ${projectKeyCount} 条`)

  // 2b. 校验参考语言包（阻塞性）
  const refLocales = aiConfig.referenceLocales || []
  validateReferenceLocales(refLocales, projectRoot, sourceLang, targetLangs)

  // 2c. 加载参考语言包
  let refKeyCount = 0
  for (const refPath of refLocales) {
    const absRefPath = path.resolve(projectRoot, refPath)
    const { reverseMap, keyCount } = loadLocaleReverseMap(
      absRefPath,
      sourceLang
    )
    // 合并到 projectMap（本项目优先，不覆盖）
    for (const [chinese, key] of Object.entries(reverseMap)) {
      if (!projectMap[chinese]) {
        projectMap[chinese] = key
        refKeyCount++
      }
    }
    console.log(
      `  参考语言包 ${refPath}: ${keyCount} 条（合并 ${
        Object.keys(reverseMap).filter(
          (k) => !projectMap[k] || projectMap[k] === reverseMap[k]
        ).length
      } 条）`
    )
  }
  if (refKeyCount > 0) {
    console.log(`  从参考语言包合并 ${refKeyCount} 条新映射`)
  }

  // 2d. 过滤已存在翻译的中文
  const untranslated = allChineseTexts.filter((text) => !projectMap[text])
  const alreadyTranslated = allChineseTexts.length - untranslated.length
  console.log(
    `  已有翻译: ${alreadyTranslated} 条，待翻译: ${untranslated.length} 条`
  )

  // 2e. 加载目标语言文件（用于缺口检测和后续写入）
  const targetDataMap = {}
  for (const lang of targetLangs) {
    if (lang === sourceLang) continue
    const targetFile = path.join(outputDir, `${lang}.json`)
    if (fs.existsSync(targetFile)) {
      try {
        targetDataMap[lang] = JSON.parse(fs.readFileSync(targetFile, 'utf-8'))
      } catch (err) {
        console.error(`  警告: 无法解析 ${targetFile}: ${err.message}`)
        targetDataMap[lang] = {}
      }
    } else {
      // 文件不存在，自动创建空文件
      targetDataMap[lang] = {}
      console.log(`  目标语言文件不存在，自动创建: ${lang}.json`)
    }
  }

  // 2f. 检测翻译缺口
  const gaps = sourceData
    ? findTranslationGaps(sourceData, targetDataMap, targetLangs, sourceLang)
    : []
  console.log(`  翻译缺口: ${gaps.length} 条（已有 key 但缺少目标语言翻译）`)

  // 提前退出判断
  if (untranslated.length === 0 && gaps.length === 0) {
    console.log('所有中文文本已有完整翻译，无需调用 AI')
    return
  }

  // ========== Step 3a: 翻译新文本 ==========
  console.log('\n[3a/4] 调用 AI 翻译新文本...')
  const batchSize = aiConfig.batchSize || 200
  const batches = []
  for (let i = 0; i < untranslated.length; i += batchSize) {
    batches.push(untranslated.slice(i, i + batchSize))
  }
  console.log(`  共 ${batches.length} 批，每批最多 ${batchSize} 条`)

  const allAiResults = {} // { "中文": { key: "module.key", translation: "..." } }
  let failedBatches = 0

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    console.log(
      `  处理第 ${i + 1}/${batches.length} 批 (${batch.length} 条)...`
    )

    try {
      const batchResult = await callAiApi(aiConfig, batch, targetLangs)
      Object.assign(allAiResults, batchResult)
      console.log(`    ✓ 完成，获取 ${Object.keys(batchResult).length} 条翻译`)
    } catch (err) {
      failedBatches++
      console.error(`    ✗ 失败: ${err.message}`)
    }
  }

  console.log(
    `  总计获取 ${
      Object.keys(allAiResults).length
    } 条翻译，${failedBatches} 批失败`
  )

  // ========== Step 3b: 翻译缺口 ==========
  let allGapResults = {}
  let gapFailedBatches = 0
  if (gaps.length > 0) {
    console.log('\n[3b/4] 补齐翻译缺口...')
    const gapResult = await translateGaps(
      aiConfig,
      gaps,
      targetLangs,
      sourceLang
    )
    allGapResults = gapResult.allResults
    gapFailedBatches = gapResult.failedBatches
  }

  if (
    Object.keys(allAiResults).length === 0 &&
    Object.keys(allGapResults).length === 0
  ) {
    console.log('没有获取到任何翻译结果')
    return
  }

  // ========== Step 4: 写回语言包 ==========
  console.log('\n[4/4] 写回语言包...')

  // 确保目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // 确保源语言文件路径
  const sourceFile = path.join(outputDir, `${sourceLang}.json`)

  // 合并 AI 结果到语言包
  let writtenCount = 0
  const aiMissed = [] // AI 未返回翻译的文本
  const aiInvalidKey = [] // AI 返回了但 key 无效的

  for (const chineseText of untranslated) {
    const aiResult = allAiResults[chineseText]
    if (!aiResult) {
      aiMissed.push(chineseText)
      continue
    }

    const fullKey = aiResult.key // e.g. "common.search"
    if (!fullKey) {
      aiInvalidKey.push({ chineseText, reason: 'key 为空', aiResult })
      continue
    }

    const [module, ...keyParts] = fullKey.split('.')
    const shortKey = keyParts.join('.')

    if (!module || !shortKey) {
      aiInvalidKey.push({
        chineseText,
        reason: `key 格式无效: "${fullKey}"`,
        aiResult,
      })
      continue
    }

    // 写入源语言文件
    if (!sourceData[module]) sourceData[module] = {}
    if (!sourceData[module][shortKey]) {
      sourceData[module][shortKey] = chineseText
    }

    // 写入目标语言文件
    for (const lang of targetLangs) {
      if (lang === sourceLang) continue
      const langKey = lang.replace(/-/g, '_') // en-US → en_US (AI may use either)
      const translation =
        aiResult[lang] ||
        aiResult[langKey] ||
        aiResult['en-US'] ||
        aiResult['en_US'] ||
        ''
      if (translation) {
        if (!targetDataMap[lang][module]) targetDataMap[lang][module] = {}
        targetDataMap[lang][module][shortKey] = translation
      }
    }

    writtenCount++
  }

  // 写入缺口翻译结果到目标语言文件
  let gapWrittenCount = 0
  for (const [fullKey, translations] of Object.entries(allGapResults)) {
    const [module, ...keyParts] = fullKey.split('.')
    const shortKey = keyParts.join('.')

    if (!module || !shortKey) continue

    for (const [lang, text] of Object.entries(translations)) {
      if (text && text.trim()) {
        if (!targetDataMap[lang]) targetDataMap[lang] = {}
        if (!targetDataMap[lang][module]) targetDataMap[lang][module] = {}
        targetDataMap[lang][module][shortKey] = text
        gapWrittenCount++
      }
    }
  }

  // 写回文件
  fs.writeFileSync(sourceFile, JSON.stringify(sourceData, null, 2), 'utf-8')
  console.log(`  写入 ${sourceLang}.json: ${writtenCount} 条`)

  for (const lang of targetLangs) {
    if (lang === sourceLang) continue
    const targetFile = path.join(outputDir, `${lang}.json`)
    fs.writeFileSync(
      targetFile,
      JSON.stringify(targetDataMap[lang], null, 2),
      'utf-8'
    )
    console.log(`  写入 ${lang}.json: ${writtenCount} 条`)
  }

  // ========== 写入未匹配翻译的日志 ==========
  writeUnmatchedLog(config, projectRoot, {
    specialItems,
    aiMissed,
    aiInvalidKey,
    failedBatches,
    gapFailedBatches,
  })

  // 汇总
  console.log('')
  console.log('='.repeat(50))
  console.log('AI 翻译完成')
  console.log(`  扫描文件:     ${filesScanned}`)
  console.log(`  发现中文:     ${allChineseTexts.length}`)
  console.log(`  已有翻译:     ${alreadyTranslated}`)
  console.log(`  新增翻译:     ${writtenCount}`)
  console.log(`  缺口补齐:     ${gapWrittenCount}`)
  if (gapFailedBatches > 0) {
    console.log(`  缺口失败批次: ${gapFailedBatches}`)
  }
  console.log(`  失败批次:     ${failedBatches}`)
  console.log('='.repeat(50))
}

/**
 * 调用 AI API 进行批量翻译
 * @param {object} aiConfig - AI 配置
 * @param {string[]} chineseTexts - 待翻译的中文文本数组
 * @param {string[]} targetLanguages - 目标语言列表
 * @returns {Promise<object>} { "中文": { key: "module.key", "en-US": "..." } }
 */
async function callAiApi(aiConfig, chineseTexts, targetLanguages) {
  const {
    apiKey,
    baseURL,
    model,
    temperature,
    maxTokens,
    systemPrompt,
    userPromptTemplate,
  } = aiConfig

  // 构建 user prompt
  const chineseTextsStr = chineseTexts.join('\n')
  const userPrompt = userPromptTemplate
    .replace('{filePath}', 'batch translation')
    .replace('{targetLanguages}', targetLanguages.join(', '))
    .replace('{chineseTexts}', chineseTextsStr)

  // 调用 API
  const url = `${baseURL}/chat/completions`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: temperature || 0.3,
      max_tokens: maxTokens || 200000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`API 返回 ${response.status}: ${body.slice(0, 200)}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content || ''

  // 解析 AI 返回的 JSON
  return parseAiResponse(content)
}

/**
 * 解析 AI 响应，提取翻译结果
 * 期望格式: { "中文原文": { "key": "module.keyName", "en-US": "Translation" } }
 * @param {string} content - AI 返回的文本
 * @returns {object}
 */
function parseAiResponse(content) {
  if (!content) return {}

  // 尝试直接解析
  try {
    return JSON.parse(content)
  } catch {
    // 尝试提取 JSON 块（可能被 markdown 代码块包裹）
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim())
      } catch {
        // 继续尝试其他方式
      }
    }

    // 尝试找到第一个 { 和最后一个 }
    const firstBrace = content.indexOf('{')
    const lastBrace = content.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(content.slice(firstBrace, lastBrace + 1))
      } catch {
        // 失败
      }
    }

    console.error(`  警告: 无法解析 AI 响应: ${content.slice(0, 200)}...`)
    return {}
  }
}

/**
 * 写入未匹配翻译的日志文件
 * @param {object} config - i18n 配置
 * @param {string} projectRoot - 项目根目录
 * @param {object} unmatched - 未匹配数据
 */
function writeUnmatchedLog(config, projectRoot, unmatched) {
  const {
    specialItems,
    aiMissed,
    aiInvalidKey,
    failedBatches,
    gapFailedBatches,
  } = unmatched
  const totalUnmatched =
    specialItems.length + aiMissed.length + aiInvalidKey.length

  if (totalUnmatched === 0 && failedBatches === 0 && gapFailedBatches === 0)
    return

  // 确保日志目录存在
  const logDir = path.resolve(projectRoot, config.logDir || 'logs')
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }

  // 生成日志文件名
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const logFile = path.join(logDir, `i18n-translate-unmatched-${dateStr}.log`)

  const lines = []
  lines.push(`i18n AI 翻译 — 未匹配记录`)
  lines.push(`生成时间: ${new Date().toISOString()}`)
  lines.push(`=`.repeat(60))
  lines.push('')

  // 特殊类型（模板字符串插值、字符串拼接）
  if (specialItems.length > 0) {
    lines.push(
      `[特殊-未处理] ${specialItems.length} 条（模板字符串插值 / 字符串拼接）`
    )
    lines.push(`-`.repeat(40))
    for (const item of specialItems) {
      const file = item.file || 'unknown'
      lines.push(`  ${item.chineseText}`)
      lines.push(`    文件: ${file} 行: ${item.line} 类型: ${item.type}`)
    }
    lines.push('')
  }

  // AI 未返回翻译
  if (aiMissed.length > 0) {
    lines.push(`[AI 未返回] ${aiMissed.length} 条（已发送但 AI 响应中缺失）`)
    lines.push(`-`.repeat(40))
    for (const text of aiMissed) {
      lines.push(`  ${text}`)
    }
    lines.push('')
  }

  // AI 返回了但 key 无效
  if (aiInvalidKey.length > 0) {
    lines.push(
      `[Key 无效] ${aiInvalidKey.length} 条（AI 返回了但 key 格式不正确）`
    )
    lines.push(`-`.repeat(40))
    for (const item of aiInvalidKey) {
      lines.push(`  ${item.chineseText}`)
      lines.push(`    原因: ${item.reason}`)
    }
    lines.push('')
  }

  // 缺口翻译失败批次
  if (gapFailedBatches > 0) {
    lines.push(
      `[缺口翻译失败] ${gapFailedBatches} 批缺口翻译调用失败，对应文本未补齐`
    )
    lines.push('')
  }

  // 失败批次
  if (failedBatches > 0) {
    lines.push(
      `[API 失败] ${failedBatches} 批调用失败，对应批次的中文文本未翻译`
    )
    lines.push('')
  }

  fs.writeFileSync(logFile, lines.join('\n'), 'utf-8')
  console.log(`  未匹配日志: ${path.relative(projectRoot, logFile)}`)
}

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
 * 校验参考语言包的完整性（阻塞性）
 * 1. 路径必须存在
 * 2. targetLanguages 中的每种语言必须有对应文件
 * 3. 各语言文件的 key 数量必须与 zh-CN 一致
 * @param {string[]} refLocales - 参考语言包路径列表
 * @param {string} projectRoot - 项目根目录
 * @param {string} sourceLang - 源语言
 * @param {string[]} targetLangs - 目标语言列表
 */
function validateReferenceLocales(
  refLocales,
  projectRoot,
  sourceLang,
  targetLangs
) {
  if (!refLocales || refLocales.length === 0) return

  for (const refPath of refLocales) {
    const absRefPath = path.resolve(projectRoot, refPath)

    // 1. 路径存在
    if (!fs.existsSync(absRefPath)) {
      console.error(`\n参考语言包校验失败: 路径不存在`)
      console.error(`  路径: ${absRefPath}`)
      process.exit(1)
    }

    // 2. 每种语言文件存在
    const allLangs = [
      sourceLang,
      ...targetLangs.filter((l) => l !== sourceLang),
    ]
    for (const lang of allLangs) {
      const langFile = path.join(absRefPath, `${lang}.json`)
      if (!fs.existsSync(langFile)) {
        console.error(`\n参考语言包校验失败: 缺少语言文件`)
        console.error(`  路径: ${absRefPath}`)
        console.error(`  缺少: ${lang}.json`)
        console.error(`  需要: ${allLangs.map((l) => `${l}.json`).join(', ')}`)
        process.exit(1)
      }
    }

    // 3. key 数量一致
    const sourceFile = path.join(absRefPath, `${sourceLang}.json`)
    let sourceData
    try {
      sourceData = JSON.parse(fs.readFileSync(sourceFile, 'utf-8'))
    } catch (err) {
      console.error(`\n参考语言包校验失败: 无法解析 ${sourceLang}.json`)
      console.error(`  路径: ${absRefPath}`)
      console.error(`  错误: ${err.message}`)
      process.exit(1)
    }
    const sourceKeyCount = countKeys(sourceData)

    for (const lang of targetLangs) {
      if (lang === sourceLang) continue
      const langFile = path.join(absRefPath, `${lang}.json`)
      let langData
      try {
        langData = JSON.parse(fs.readFileSync(langFile, 'utf-8'))
      } catch (err) {
        console.error(`\n参考语言包校验失败: 无法解析 ${lang}.json`)
        console.error(`  路径: ${absRefPath}`)
        console.error(`  错误: ${err.message}`)
        process.exit(1)
      }
      const langKeyCount = countKeys(langData)

      if (langKeyCount !== sourceKeyCount) {
        console.error(`\n参考语言包校验失败: key 数量不一致`)
        console.error(`  路径: ${absRefPath}`)
        console.error(`  ${sourceLang}.json: ${sourceKeyCount} 条`)
        console.error(`  ${lang}.json: ${langKeyCount} 条`)
        process.exit(1)
      }
    }
  }
}

/**
 * 检测翻译缺口：遍历 zh-CN.json 所有条目，检查各目标语言是否缺失翻译
 * @param {object} sourceData - 源语言包解析后的 JSON 对象
 * @param {object} targetDataMap - { lang: parsedJson } 各目标语言包数据
 * @param {string[]} targetLangs - 目标语言列表
 * @param {string} sourceLang - 源语言
 * @returns {object[]} [{ fullKey, chineseText, missingLangs: string[] }]
 */
function findTranslationGaps(
  sourceData,
  targetDataMap,
  targetLangs,
  sourceLang
) {
  const allEntries = []
  walkSourceData(sourceData, '', allEntries)

  const gaps = []
  for (const { fullKey, chineseText } of allEntries) {
    const missingLangs = []

    for (const lang of targetLangs) {
      if (lang === sourceLang) continue

      const targetData = targetDataMap[lang] || {}
      const value = getNestedValue(targetData, fullKey)

      if (value === undefined || value === null || value === '') {
        missingLangs.push(lang)
      }
    }

    if (missingLangs.length > 0) {
      gaps.push({ fullKey, chineseText, missingLangs })
    }
  }

  return gaps
}

/**
 * 递归遍历源语言包，提取所有叶子节点的 key 路径和中文文本
 * @param {object} obj - 源语言包 JSON 对象
 * @param {string} prefix - 当前 key 前缀
 * @param {object[]} result - 结果数组，每项 { fullKey, chineseText }
 */
function walkSourceData(obj, prefix, result) {
  for (const key of Object.keys(obj)) {
    const value = obj[key]
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      result.push({ fullKey, chineseText: value })
    } else if (typeof value === 'object' && value !== null) {
      walkSourceData(value, fullKey, result)
    }
  }
}

/**
 * 按点分隔的 key 路径从嵌套对象中取值
 * @param {object} obj - 嵌套对象
 * @param {string} keyPath - 点分隔路径，如 "transfer.sponsor"
 * @returns {string|undefined}
 */
function getNestedValue(obj, keyPath) {
  const parts = keyPath.split('.')
  let current = obj
  for (const part of parts) {
    if (current === undefined || current === null) return undefined
    current = current[part]
  }
  return current
}

/**
 * 缺口翻译的默认系统提示词（用户未在 config 中配置时使用）
 */
function getDefaultGapSystemPrompt() {
  return `你是一个 i18n 翻译助手。请将给定的中文文本翻译为指定的目标语言。
每条文本已有固定的 key 路径，你只需要将 JSON 中的空字符串替换为对应翻译。
严格保持 JSON 结构不变，不要修改任何 key，不要添加或删除任何字段。
只输出填充后的 JSON 对象，不要添加任何其他内容。`
}

/**
 * 调用 AI API 进行缺口翻译（填空式）
 * @param {object} aiConfig - AI 配置
 * @param {object[]} batch - 本批缺口条目 [{ fullKey, chineseText, missingLangs }]
 * @param {string[]} missingLangs - 本批需要翻译的语言列表
 * @param {string[]|null} retryMissingKeys - 重试时上次缺失的 key 列表
 * @returns {Promise<object>} { "transfer.sponsor": { "th": "ผู้สนับสนุน" } }
 */
async function callAiApiForGaps(
  aiConfig,
  batch,
  missingLangs,
  retryMissingKeys
) {
  const { apiKey, baseURL, model, temperature, maxTokens } = aiConfig

  // 构建中文原文对照
  const referenceLines = batch
    .map((item) => `  ${item.fullKey} → ${item.chineseText}`)
    .join('\n')

  // 构建填空 JSON 模板
  const template = {}
  for (const item of batch) {
    template[item.fullKey] = {}
    for (const lang of item.missingLangs) {
      template[item.fullKey][lang] = ''
    }
  }
  const templateJson = JSON.stringify(template, null, 2)

  // 构建 user prompt
  let userPrompt = `中文原文对照：\n${referenceLines}\n\n请将以下 JSON 中的空字符串替换为对应语言的翻译，只输出填充后的 JSON：\n\n${templateJson}`

  if (retryMissingKeys && retryMissingKeys.length > 0) {
    userPrompt += `\n\n注意：上次返回中以下 key 缺失或为空，请务必补全：\n${retryMissingKeys.join(
      '\n'
    )}`
  }

  // 使用 gap 专用提示词或默认值
  const systemPrompt = aiConfig.gapSystemPrompt || getDefaultGapSystemPrompt()

  let finalUserPrompt
  if (aiConfig.gapUserPromptTemplate) {
    finalUserPrompt = aiConfig.gapUserPromptTemplate
      .replace(/\{missingLangs\}/g, missingLangs.join(', '))
      .replace(/\{template\}/g, templateJson)
      .replace(/\{reference\}/g, referenceLines)
  } else {
    finalUserPrompt = userPrompt
  }

  // 调用 API
  const url = `${baseURL}/chat/completions`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: temperature || 0.3,
      max_tokens: maxTokens || 200000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: finalUserPrompt },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`API 返回 ${response.status}: ${body.slice(0, 200)}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content || ''

  return parseAiResponse(content)
}

/**
 * 校验 AI 返回的缺口翻译结果，失败时自动重试（最多 3 次）
 * @param {object} aiConfig - AI 配置
 * @param {object[]} batch - 本批缺口条目
 * @param {string[]} missingLangs - 本批需要翻译的语言列表
 * @param {number} maxRetries - 最大重试次数
 * @returns {Promise<object>} 校验通过的翻译结果
 */
async function validateAndRetryGapBatch(
  aiConfig,
  batch,
  missingLangs,
  maxRetries
) {
  maxRetries = maxRetries || 3
  let lastMissingKeys = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await callAiApiForGaps(
        aiConfig,
        batch,
        missingLangs,
        lastMissingKeys
      )

      // 校验：模板中的每个 key 在返回中都存在且值非空
      const missingKeys = []
      for (const item of batch) {
        if (!result[item.fullKey]) {
          missingKeys.push(item.fullKey)
          continue
        }
        for (const lang of item.missingLangs) {
          if (
            !result[item.fullKey][lang] ||
            result[item.fullKey][lang].trim() === ''
          ) {
            missingKeys.push(`${item.fullKey}.${lang}`)
          }
        }
      }

      if (missingKeys.length === 0) {
        return result
      }

      console.log(
        `      校验失败，缺失 ${missingKeys.length} 项，重试 ${attempt}/${maxRetries}`
      )
      lastMissingKeys = missingKeys
    } catch (err) {
      if (attempt >= maxRetries) throw err
      console.log(
        `      调用失败: ${err.message}，重试 ${attempt}/${maxRetries}`
      )
      lastMissingKeys = null
    }
  }

  throw new Error(
    `重试 ${maxRetries} 次后仍校验失败，缺失: ${lastMissingKeys.join(', ')}`
  )
}

/**
 * 按缺失语言组合分组，分批调用 AI 补齐翻译缺口
 * @param {object} aiConfig - AI 配置
 * @param {object[]} gaps - 缺口条目数组
 * @param {string[]} targetLangs - 目标语言列表
 * @param {string} sourceLang - 源语言
 * @returns {Promise<object>} 所有缺口翻译结果 { "transfer.sponsor": { "th": "..." } }
 */
async function translateGaps(aiConfig, gaps, targetLangs, sourceLang) {
  // 按缺失语言组合分组
  const groups = {}
  for (const gap of gaps) {
    const comboKey = gap.missingLangs.slice().sort().join(',')
    if (!groups[comboKey]) groups[comboKey] = []
    groups[comboKey].push(gap)
  }

  const allResults = {}
  const batchSize = aiConfig.batchSize || 200
  let failedBatches = 0

  for (const [comboKey, groupGaps] of Object.entries(groups)) {
    const missingLangs = comboKey.split(',')

    // 分批
    const batches = []
    for (let i = 0; i < groupGaps.length; i += batchSize) {
      batches.push(groupGaps.slice(i, i + batchSize))
    }

    console.log(
      `  缺口组 [${comboKey}]: ${groupGaps.length} 条，分 ${batches.length} 批`
    )

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      console.log(
        `    处理第 ${i + 1}/${batches.length} 批 (${batch.length} 条)...`
      )

      try {
        const batchResult = await validateAndRetryGapBatch(
          aiConfig,
          batch,
          missingLangs
        )
        Object.assign(allResults, batchResult)
        console.log(`      ✓ 完成`)
      } catch (err) {
        failedBatches++
        console.error(`      ✗ 失败: ${err.message}`)
      }
    }
  }

  console.log(
    `  缺口翻译总计获取 ${
      Object.keys(allResults).length
    } 条，${failedBatches} 批失败`
  )
  return { allResults, failedBatches }
}

module.exports = {
  translateViaAI,
  findTranslationGaps,
  validateReferenceLocales,
  countKeys,
}

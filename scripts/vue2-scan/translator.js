/**
 * AI 翻译模块
 * 调用 OpenAI 兼容 API，批量翻译中文文本
 */
const path = require('path')
const { readLocale, writeLocale, setNested } = require('./locale-manager')

/**
 * 批量翻译中文文本
 * @param {string[]} chineseTexts - 中文文本数组
 * @param {string} filePath - 来源文件相对路径
 * @param {object} config - 完整配置对象
 * @returns {Promise<object>} { "中文文本": { key: "module.keyName", "en-US": "翻译" } }
 */
async function translateBatch(chineseTexts, filePath, config) {
  const ai = config.ai
  const targetLanguages = config.languages.filter(l => l !== 'zh-CN')

  const systemPrompt = ai.systemPrompt
  const userPrompt = ai.userPromptTemplate
    .replace('{filePath}', filePath)
    .replace('{targetLanguages}', targetLanguages.join(', '))
    .replace('{chineseTexts}', chineseTexts.map((t, i) => `${i + 1}. ${t}`).join('\n'))

  const body = {
    model: ai.model,
    temperature: ai.temperature,
    max_tokens: ai.maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  }

  // 添加 json_schema 响应格式
  if (ai.responseFormat !== false) {
    body.response_format = buildJsonSchema(targetLanguages)
  }

  const response = await fetch(`${ai.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ai.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`AI API 请求失败 (${response.status}): ${errBody}`)
  }

  const data = await response.json()
  const content = data.choices[0].message.content
  console.log(`  [AI 响应] ${content.slice(0, 200)}${content.length > 200 ? '...' : ''}`)
  return parseAIResponse(content)
}

/**
 * 根据目标语言构建 json_schema 响应格式
 * 输出格式: { "中文文本": { key: "module.keyName", "en-US": "翻译", ... } }
 */
function buildJsonSchema(targetLanguages) {
  const langProps = {}
  const langRequired = ['key']
  for (const lang of targetLanguages) {
    langProps[lang] = { type: 'string' }
    langRequired.push(lang)
  }

  return {
    type: 'json_schema',
    json_schema: {
      name: 'i18n_translations',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '嵌套 key，如 common.save、accredit.sponsor' },
            ...langProps,
          },
          required: langRequired,
          additionalProperties: false,
        },
      },
    },
  }
}

/**
 * 解析 AI 返回的 JSON（处理 markdown 代码块包裹等）
 */
function parseAIResponse(content) {
  let json = content
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  try {
    return JSON.parse(json)
  } catch (e) {
    const match = json.match(/\{[\s\S]*\}/)
    if (match) {
      return JSON.parse(match[0])
    }
    throw new Error(`无法解析 AI 返回: ${e.message}\n原始内容: ${content.slice(0, 500)}`)
  }
}

/**
 * 将 AI 翻译结果合并到各语言包文件
 * @param {object} aiResult - { "中文文本": { key: "module.keyName", "en-US": "翻译" } }
 * @param {string} outputDir - 语言包目录
 * @param {string[]} languages - 所有语言列表
 * @returns {object} { added: 新增条数, skipped: 跳过条数 }
 */
function mergeToLocales(aiResult, outputDir, languages) {
  let added = 0
  let skipped = 0

  for (const lang of languages) {
    const localePath = path.join(outputDir, `${lang}.json`)
    const existing = readLocale(localePath)

    for (const [chineseText, info] of Object.entries(aiResult)) {
      if (!info || !info.key) continue

      const value = lang === 'zh-CN' ? chineseText : (info[lang] || chineseText)

      if (keyExists(existing, info.key)) {
        skipped++
        continue
      }

      setNested(existing, info.key, value)
      added++
    }

    writeLocale(localePath, existing)
  }

  return { added, skipped }
}

/**
 * 检查嵌套 key 是否已存在
 */
function keyExists(obj, nestedKey) {
  const parts = nestedKey.split('.')
  let current = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return false
    if (!(part in current)) return false
    current = current[part]
  }
  return typeof current === 'string'
}

/**
 * 分批翻译所有未匹配中文
 * @param {object} unmappedByFile - { filePath: [chineseText, ...] }
 * @param {object} config - 完整配置
 * @returns {Promise<object>} 合并后的完整 AI 返回结果
 */
async function translateAll(unmappedByFile, config) {
  const batchSize = config.ai.batchSize || 30
  const allResults = {}

  // 1. 收集所有文件的文本 → 全局去重
  const allTexts = []
  for (const texts of Object.values(unmappedByFile)) {
    allTexts.push(...texts)
  }
  const uniqueTexts = [...new Set(allTexts)]

  // 2. 聚合文件路径（AI 据此推断模块分类）
  const allFilePaths = Object.keys(unmappedByFile).join(', ')

  // 3. 按 batchSize 切片
  const batches = []
  for (let i = 0; i < uniqueTexts.length; i += batchSize) {
    batches.push(uniqueTexts.slice(i, i + batchSize))
  }

  console.log(`  [AI] 翻译: ${uniqueTexts.length} 条（去重后），涉及 ${Object.keys(unmappedByFile).length} 个文件，分 ${batches.length} 批`)

  // 4. 逐批请求
  for (let i = 0; i < batches.length; i++) {
    console.log(`    第 ${i + 1}/${batches.length} 批...`)
    const result = await translateBatch(batches[i], allFilePaths, config)
    Object.assign(allResults, result)
  }

  return allResults
}

module.exports = { translateBatch, translateAll, mergeToLocales, parseAIResponse }
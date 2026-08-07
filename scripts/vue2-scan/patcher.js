/**
 * 代码替换模块
 * 根据映射表将源码中的中文替换为 $t('nested.key') 调用
 */
const { MagicString } = require('magic-string')
const path = require('path')

/**
 * 对单个文件执行替换
 * @param {string} code - 原始代码
 * @param {Array} items - 提取的中文项 [{text, start, end, type, attrName}]
 * @param {object} reverseIndex - 中文→嵌套key 映射
 * @param {object} config - 配置
 * @param {string} filePath - 文件绝对路径（用于判断文件类型和计算 import 路径）
 * @returns {{ code: string, changes: Array }}
 */
function applyReplacements(code, items, reverseIndex, config, filePath) {
  const ms = new MagicString(code)
  const t = (config && config.tFunction) || '$t'
  // 从后往前替换，避免位置偏移
  const sorted = [...items].sort((a, b) => b.start - a.start)
  const changes = []
  const isVue = filePath ? filePath.endsWith('.vue') : true

  // 收集需要 computed 包裹的区域（去重）
  const wrapRegions = new Map()

  for (const item of sorted) {
    const key = reverseIndex[item.text]
    if (!key) continue

    let oldStr, newStr
    if (item.type === 'TEMPLATE_TEXT') {
      oldStr = code.slice(item.start, item.end)
      newStr = `{{ ${t}('${key}') }}`
      ms.overwrite(item.start, item.end, newStr)
    } else if (item.type === 'TEMPLATE_ATTR') {
      oldStr = code.slice(item.start, item.end)
      newStr = `:${item.attrName}="${t}('${key}')"`
      ms.overwrite(item.start, item.end, newStr)
    } else if (item.type === 'JS_STRING') {
      oldStr = code.slice(item.start, item.end)
      const useTypeToString = config && config.typeToString !== false
      const fnName = useTypeToString ? 'i18nTypeToString' : t
      newStr = `this.${fnName}('${key}')`
      ms.overwrite(item.start, item.end, newStr)
    } else if (item.type === 'TEMPLATE_ATTR_DYNAMIC') {
      // 动态属性：替换 '中文' 为 $t('key')（含引号）
      oldStr = code.slice(item.start - 1, item.end + 1)
      newStr = `${t}('${key}')`
      ms.overwrite(item.start - 1, item.end + 1, newStr)
    } else if (item.type === 'TEMPLATE_QUASI') {
      oldStr = code.slice(item.start, item.end)
      newStr = `\${${t}('${key}')}`
      ms.overwrite(item.start, item.end, newStr)
    } else if (item.type === 'SCRIPT_TARGET_OBJECT' || item.type === 'TRANSLATE_METHOD_ARG' || item.type === 'TRANSLATE_METHOD_PROP') {
      oldStr = code.slice(item.start, item.end)
      newStr = isVue ? formatVueScriptCall(t, key, config) : `i18n.t('${key}')`
      ms.overwrite(item.start, item.end, newStr)
    } else if (item.type === 'SCRIPT_TARGET_ARRAY') {
      oldStr = code.slice(item.start, item.end)
      newStr = isVue ? formatVueScriptCall(t, key, config) : `i18n.t('${key}')`
      ms.overwrite(item.start, item.end, newStr)
      if (item.wrapStart != null && item.wrapEnd != null) {
        wrapRegions.set(`${item.wrapStart}-${item.wrapEnd}`, { start: item.wrapStart, end: item.wrapEnd })
      }
    }

    const lineNum = code.slice(0, item.start).split('\n').length
    changes.push({ line: lineNum, old: oldStr, new: newStr, key, text: item.text, type: item.type, attrName: item.attrName })
  }

  // 应用 computed 包裹（从后往前，避免位置偏移）
  const sortedWraps = [...wrapRegions.values()].sort((a, b) => b.start - a.start)
  for (const wrap of sortedWraps) {
    ms.prependLeft(wrap.start, 'computed(() => (')
    ms.appendRight(wrap.end, '))')
  }

  // 检查是否需要添加 import
  let needsComputedImport = false
  let needsI18nImport = false
  for (const item of items) {
    const key = reverseIndex[item.text]
    if (!key) continue
    if (item.type === 'SCRIPT_TARGET_ARRAY' && item.wrapStart != null) {
      needsComputedImport = true
    }
    if (!isVue && (item.type === 'SCRIPT_TARGET_OBJECT' || item.type === 'SCRIPT_TARGET_ARRAY' || item.type === 'TRANSLATE_METHOD_ARG' || item.type === 'TRANSLATE_METHOD_PROP')) {
      needsI18nImport = true
    }
  }

  if (!isVue && needsI18nImport) {
    insertI18nImport(ms, code, filePath, config)
  }
  if (needsComputedImport) {
    insertComputedImport(ms, code)
  }

  return { code: ms.toString(), changes }
}

function formatVueScriptCall(t, key, config) {
  const useTypeToString = config && config.typeToString !== false
  const fnName = useTypeToString ? 'i18nTypeToString' : t
  return `this.${fnName}('${key}')`
}

function insertI18nImport(ms, code, filePath, config) {
  if (/import\s+i18n\s+from/.test(code)) return

  const importPath = calcRelativeImportPath(filePath, config)
  const importStmt = `import i18n from '${importPath}'\n`

  const insertPos = findLastImportEnd(code)
  if (insertPos >= 0) {
    ms.appendRight(insertPos, '\n' + importStmt)
  } else {
    ms.prepend(importStmt)
  }
}

function insertComputedImport(ms, code) {
  if (/import\s+\{[^}]*\bcomputed\b[^}]*\}\s+from\s+['"]vue['"]/.test(code)) return

  const importStmt = `import { computed } from 'vue'\n`
  const insertPos = findLastImportEnd(code)
  if (insertPos >= 0) {
    ms.appendRight(insertPos, '\n' + importStmt)
  } else {
    ms.prepend(importStmt)
  }
}

function findLastImportEnd(code) {
  const importRe = /^import\s+.+$/gm
  let lastEnd = -1
  let match
  while ((match = importRe.exec(code)) !== null) {
    lastEnd = match.index + match[0].length
  }
  return lastEnd
}

function calcRelativeImportPath(filePath, config) {
  const outputDir = path.resolve(config.output)
  const fileDir = path.dirname(path.resolve(filePath))
  let relPath = path.relative(fileDir, outputDir).replace(/\\/g, '/')
  if (!relPath.startsWith('.')) relPath = './' + relPath
  return relPath + '/index'
}

module.exports = { applyReplacements }
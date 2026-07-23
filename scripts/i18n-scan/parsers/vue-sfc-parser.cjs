/**
 * Vue SFC 解析器
 * 使用 @vue/compiler-sfc 解析 .vue 单文件组件
 * 分别提取 template 和 script 部分，交给对应的解析器处理
 */

const { parse: parseSFC } = require('@vue/compiler-sfc')
const { parseTemplate } = require('./template-parser.cjs')
const { parseScript } = require('./script-parser.cjs')

/**
 * 解析 .vue 文件，提取所有需要翻译的中文文本
 * @param {string} filePath - 文件路径
 * @param {string} source - 文件源码
 * @param {object} config - 扫描配置
 * @param {string[]} config.translateAttributes - 属性白名单
 * @param {string[]} config.ignoreAttributes - 属性黑名单
 * @param {string[]} config.ignoreMethods - 方法黑名单
 * @returns {{ results: object[], errors: string[] }}
 */
function parseVueFile(filePath, source, config) {
  const allResults = []
  const errors = []

  // 解析 SFC
  let sfc
  try {
    sfc = parseSFC(source, {
      filename: filePath,
    })
  } catch (err) {
    errors.push(`SFC 解析失败: ${err.message}`)
    return { results: allResults, errors }
  }

  // 检查是否有解析错误
  if (sfc.errors && sfc.errors.length > 0) {
    sfc.errors.forEach((err) => {
      errors.push(`SFC 错误: ${err.message}`)
    })
  }

  // 解析 template
  if (sfc.descriptor.template) {
    const template = sfc.descriptor.template
    const templateSource = template.content
    // template 内容起始行号（内容紧接 <template> 标签，-1 抵消标签行）
    const templateStartLine = template.loc ? template.loc.start.line - 1 : 0

    try {
      const templateResults = parseTemplate(
        templateSource,
        config.translateAttributes,
        config.ignoreAttributes,
        templateStartLine
      )
      // 标记来源
      templateResults.forEach((r) => {
        r.file = filePath
        r.section = 'template'
      })
      allResults.push(...templateResults)
    } catch (err) {
      errors.push(`Template 解析失败: ${err.message}`)
    }
  }

  // 解析 script 和 script setup
  if (config.scanScript !== false) {
    const scripts = []
    if (sfc.descriptor.script) {
      scripts.push(sfc.descriptor.script)
    }
    if (sfc.descriptor.scriptSetup) {
      scripts.push(sfc.descriptor.scriptSetup)
    }

    scripts.forEach((scriptBlock) => {
      const scriptSource = scriptBlock.content
      const scriptStartLine = scriptBlock.loc
        ? scriptBlock.loc.start.line - 1
        : 0

      try {
        const scriptResults = parseScript(
          scriptSource,
          config.ignoreMethods,
          scriptStartLine
        )
        scriptResults.forEach((r) => {
          r.file = filePath
          r.section = 'script'
        })
        allResults.push(...scriptResults)
      } catch (err) {
        errors.push(`Script 解析失败: ${err.message}`)
      }
    })
  }

  return { results: allResults, errors }
}

module.exports = { parseVueFile }

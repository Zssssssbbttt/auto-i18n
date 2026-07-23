/**
 * 模板 AST 解析器
 * 使用 @vue/compiler-dom 解析 Vue 模板，提取需要翻译的中文文本
 */

const { parse } = require('@vue/compiler-dom')
const { hasChinese } = require('../utils/chinese-detector.cjs')

// AST 节点类型常量（@vue/compiler-dom 定义）
const NODE_TYPE = {
  ROOT: 0,
  ELEMENT: 1,
  TEXT: 2,
  COMMENT: 3,
  SIMPLE_EXPRESSION: 4,
  INTERPOLATION: 5,
  ATTRIBUTE: 6,
  DIRECTIVE: 7,
  COMPOUND_EXPRESSION: 8,
}

/**
 * 解析 Vue 模板，提取所有需要翻译的中文文本
 * @param {string} template - 模板源代码
 * @param {string[]} translateAttributes - 需要翻译的属性白名单
 * @param {string[]} ignoreAttributes - 永远不翻译的属性黑名单
 * @param {number} templateStartLine - 模板在 .vue 文件中的起始行号（1-based）
 * @returns {object[]} 扫描结果数组
 */
function parseTemplate(
  template,
  translateAttributes,
  ignoreAttributes,
  templateStartLine
) {
  const results = []

  // 解析模板为 AST
  let ast
  try {
    ast = parse(template, {
      comments: true,
      getTextMode: () => 0, // 0 = DATA mode
    })
  } catch (err) {
    // 解析失败时返回空结果，由上层处理错误
    return results
  }

  // 递归遍历 AST 节点
  walkNode(
    ast,
    results,
    translateAttributes,
    ignoreAttributes,
    templateStartLine
  )

  return results
}

/**
 * 递归遍历 AST 节点
 */
function walkNode(
  node,
  results,
  translateAttributes,
  ignoreAttributes,
  lineOffset
) {
  if (!node) return

  switch (node.type) {
    case NODE_TYPE.ROOT:
      if (node.children) {
        node.children.forEach((child) =>
          walkNode(
            child,
            results,
            translateAttributes,
            ignoreAttributes,
            lineOffset
          )
        )
      }
      break

    case NODE_TYPE.ELEMENT:
      walkElement(
        node,
        results,
        translateAttributes,
        ignoreAttributes,
        lineOffset
      )
      break

    case NODE_TYPE.TEXT:
      walkText(node, results, lineOffset)
      break

    case NODE_TYPE.INTERPOLATION:
      walkInterpolation(node, results, lineOffset)
      break

    case NODE_TYPE.COMPOUND_EXPRESSION:
      walkCompoundExpression(node, results, lineOffset)
      break

    case NODE_TYPE.COMMENT:
      // 跳过注释
      break

    default:
      if (node.children) {
        node.children.forEach((child) =>
          walkNode(
            child,
            results,
            translateAttributes,
            ignoreAttributes,
            lineOffset
          )
        )
      }
      break
  }
}

/**
 * 处理元素节点
 */
function walkElement(
  node,
  results,
  translateAttributes,
  ignoreAttributes,
  lineOffset
) {
  // 处理属性
  if (node.props) {
    node.props.forEach((prop) => {
      if (prop.type === NODE_TYPE.ATTRIBUTE) {
        // 静态属性：label="中文"
        handleStaticAttribute(
          prop,
          node,
          results,
          translateAttributes,
          ignoreAttributes,
          lineOffset
        )
      } else if (prop.type === NODE_TYPE.DIRECTIVE) {
        // 指令：v-bind:label / :label / v-if / @click 等
        handleDirective(
          prop,
          node,
          results,
          translateAttributes,
          ignoreAttributes,
          lineOffset
        )
      }
    })
  }

  // 处理子节点
  if (node.children) {
    node.children.forEach((child) =>
      walkNode(
        child,
        results,
        translateAttributes,
        ignoreAttributes,
        lineOffset
      )
    )
  }
}

/**
 * 处理静态属性
 * 例如：label="申请人"、placeholder="请选择"
 */
function handleStaticAttribute(
  prop,
  element,
  results,
  translateAttributes,
  ignoreAttributes,
  lineOffset
) {
  const attrName = prop.name
  const attrValue = prop.value

  // 检查属性值是否包含中文
  if (!attrValue || !hasChinese(attrValue.content)) return

  // 黑名单优先
  if (ignoreAttributes && ignoreAttributes.includes(attrName)) return

  // 检查是否在白名单中
  if (!translateAttributes || !translateAttributes.includes(attrName)) return

  // 获取行号
  const line = getLine(prop.loc, lineOffset)

  results.push({
    line,
    chineseText: attrValue.content,
    type: 'static-attr',
    attrName,
    context: getSourceLine(element.loc, lineOffset),
  })
}

/**
 * 处理指令属性
 * 例如：:label="condition ? '是' : '否'"、v-if="status === '已通过'"
 */
function handleDirective(
  prop,
  element,
  results,
  translateAttributes,
  ignoreAttributes,
  lineOffset
) {
  // 获取指令名和参数名
  // v-bind:label → name='bind', arg='label'
  // :label → name='bind', arg='label'
  const directiveName = prop.name
  const argName = prop.arg ? prop.arg.content || prop.arg : null

  // 确定要检查的属性名
  let attrName = null
  if (directiveName === 'bind' && argName) {
    attrName = argName
  }

  // 如果无法确定属性名，跳过
  if (!attrName) return

  // 黑名单优先
  if (ignoreAttributes && ignoreAttributes.includes(attrName)) return

  // 检查是否在白名单中
  if (!translateAttributes || !translateAttributes.includes(attrName)) return

  // 解析表达式中的中文
  if (prop.exp) {
    const expression = getExpressionContent(prop.exp)
    if (expression && hasChinese(expression)) {
      const chineseStrings = extractChineseFromExpression(expression)
      const line = getLine(prop.exp.loc || prop.loc, lineOffset)

      chineseStrings.forEach((chineseText) => {
        results.push({
          line,
          chineseText,
          type: 'dynamic-attr',
          attrName,
          context: getSourceLine(element.loc, lineOffset),
        })
      })
    }
  }
}

/**
 * 处理文本节点
 * 例如：<span>中文文本</span>
 */
function walkText(node, results, lineOffset) {
  const content = node.content
  if (!content || !hasChinese(content)) return

  // 跳过纯空白
  const trimmed = content.trim()
  if (!trimmed) return

  const line = getLine(node.loc, lineOffset)

  results.push({
    line,
    chineseText: trimmed,
    type: 'text-content',
    context: trimmed,
  })
}

/**
 * 处理插值表达式
 * 例如：{{ $t('key') }} → 跳过；{{ 中文 }} → 提取
 */
function walkInterpolation(node, results, lineOffset) {
  if (!node.content) return

  const expression = getExpressionContent(node.content)

  // 跳过已有的 $t() 调用
  if (expression && isAlreadyTranslated(expression)) return

  if (expression && hasChinese(expression)) {
    const chineseStrings = extractChineseFromExpression(expression)
    const line = getLine(node.loc, lineOffset)

    chineseStrings.forEach((chineseText) => {
      results.push({
        line,
        chineseText,
        type: 'interpolation',
        context: `{{ ${expression} }}`,
      })
    })
  }
}

/**
 * 处理复合表达式节点
 */
function walkCompoundExpression(node, results, lineOffset) {
  if (!node.children) return

  node.children.forEach((child) => {
    if (typeof child === 'string') {
      if (hasChinese(child)) {
        const line = getLine(node.loc, lineOffset)
        results.push({
          line,
          chineseText: child.trim(),
          type: 'compound-expression',
          context: child,
        })
      }
    } else if (child && typeof child === 'object') {
      walkNode(child, results, [], [], lineOffset)
    }
  })
}

/**
 * 从表达式节点中提取表达式字符串
 */
function getExpressionContent(expNode) {
  if (!expNode) return ''
  if (typeof expNode === 'string') return expNode
  if (expNode.content !== undefined) return expNode.content
  return ''
}

/**
 * 判断表达式是否已经是 $t() 调用
 */
function isAlreadyTranslated(expression) {
  return /^\s*\$t\s*\(/.test(expression)
}

/**
 * 从表达式中提取中文字符串
 * 处理三元表达式、字符串字面量等
 */
function extractChineseFromExpression(expression) {
  const results = []

  // 匹配单引号和双引号字符串中的中文
  const stringRegex = /(['"])((?:(?!\1).)*?)\1/g
  let match
  while ((match = stringRegex.exec(expression)) !== null) {
    const strContent = match[2]
    if (hasChinese(strContent)) {
      results.push(strContent)
    }
  }

  // 匹配模板字符串中的中文静态部分
  const templateRegex = /`([^`]*)`/g
  while ((match = templateRegex.exec(expression)) !== null) {
    const templateContent = match[1]
    // 提取 ${...} 之外的静态部分
    const staticParts = templateContent.replace(/\$\{[^}]*\}/g, '')
    if (hasChinese(staticParts)) {
      results.push(staticParts.trim())
    }
  }

  return results
}

/**
 * 从 AST loc 获取行号
 */
function getLine(loc, lineOffset) {
  if (loc && loc.start && typeof loc.start.line === 'number') {
    return loc.start.line + lineOffset
  }
  return lineOffset + 1
}

/**
 * 获取元素节点的源码行（用于上下文展示）
 */
function getSourceLine(loc, lineOffset) {
  if (loc && loc.source) {
    return loc.source
  }
  return ''
}

module.exports = { parseTemplate }

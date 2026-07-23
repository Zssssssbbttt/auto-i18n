/**
 * 脚本 AST 解析器
 * 使用 @babel/parser + @babel/traverse 解析 JS/TS 代码，提取需要翻译的中文文本
 */

const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const { hasChinese } = require('../utils/chinese-detector.cjs')

/**
 * 解析脚本代码，提取所有需要翻译的中文文本
 * @param {string} code - 脚本源代码
 * @param {string[]} ignoreMethods - 跳过的方法名列表（如 console.log）
 * @param {number} scriptStartLine - 脚本在 .vue 文件中的起始行号（1-based）
 * @returns {object[]} 扫描结果数组
 */
function parseScript(code, ignoreMethods, scriptStartLine) {
  const results = []
  // 将源码按行拆分，用于提取上下文
  const sourceLines = code.split('\n')

  // 解析代码为 AST
  let ast
  try {
    ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      errorRecovery: true,
    })
  } catch (err) {
    // 解析失败时返回空结果，由上层处理错误
    return results
  }

  // 遍历 AST
  traverse(ast, {
    /**
     * 处理字符串字面量：'付款暂存失败'、"请选择"
     */
    StringLiteral(path) {
      const value = path.node.value
      if (!hasChinese(value)) return

      // 跳过 import/export 声明中的字符串
      if (isInImport(path)) return

      // 跳过 ignoreMethods 中的方法调用参数
      if (isIgnoredMethodArg(path, ignoreMethods)) return

      // 跳过对象 key
      if (
        path.parent.type === 'ObjectProperty' &&
        path.parent.key === path.node
      )
        return

      // 跳过 TS 类型注解
      if (path.parent.type === 'TSLiteralType') return

      // 跳过三元运算符中的中文文本
      if (isInConditionalExpression(path)) return

      const line = path.node.loc
        ? path.node.loc.start.line + scriptStartLine
        : scriptStartLine

      results.push({
        line,
        chineseText: value,
        type: 'script-string',
        context: getContext(path, sourceLines, scriptStartLine),
      })
    },

    /**
     * 处理模板字符串：`完成时间：${date}`
     * 含变量插值的归类为「特殊-未处理」
     */
    TemplateLiteral(path) {
      // 跳过三元运算符中的模板字符串
      if (isInConditionalExpression(path)) return

      const quasis = path.node.quasis || []
      const hasInterpolation =
        path.node.expressions && path.node.expressions.length > 0

      quasis.forEach((quasi) => {
        const text = quasi.value.raw || quasi.value.cooked || ''
        if (!hasChinese(text)) return

        const line = path.node.loc
          ? path.node.loc.start.line + scriptStartLine
          : scriptStartLine

        if (hasInterpolation) {
          // 含变量插值 → 特殊-未处理
          results.push({
            line,
            chineseText: text.trim(),
            type: 'special-template-literal',
            reason: '模板字符串含变量插值',
            context: getContext(path, sourceLines, scriptStartLine),
          })
        } else {
          // 不含插值 → 正常处理
          if (isIgnoredMethodArg(path, ignoreMethods)) return
          results.push({
            line,
            chineseText: text.trim(),
            type: 'script-string',
            context: getContext(path, sourceLines, scriptStartLine),
          })
        }
      })
    },

    /**
     * 处理二元表达式中的字符串拼接：'完成时间：' + variable
     * 归类为「特殊-未处理」
     */
    BinaryExpression(path) {
      if (path.node.operator !== '+') return

      // 跳过三元运算符中的字符串拼接
      if (isInConditionalExpression(path)) return

      const left = path.node.left
      const right = path.node.right

      // 检查是否涉及字符串拼接
      const hasStringOperand =
        left.type === 'StringLiteral' || right.type === 'StringLiteral'

      if (!hasStringOperand) return

      // 检查字符串操作数是否包含中文
      const chineseParts = []
      if (left.type === 'StringLiteral' && hasChinese(left.value)) {
        chineseParts.push(left.value)
      }
      if (right.type === 'StringLiteral' && hasChinese(right.value)) {
        chineseParts.push(right.value)
      }

      if (chineseParts.length === 0) return

      const line = path.node.loc
        ? path.node.loc.start.line + scriptStartLine
        : scriptStartLine

      chineseParts.forEach((chineseText) => {
        results.push({
          line,
          chineseText,
          type: 'special-string-concat',
          reason: '字符串 + 拼接含变量',
          context: getContext(path, sourceLines, scriptStartLine),
        })
      })
    },
  })

  return results
}

/**
 * 判断节点是否在 import/export 声明中
 */
function isInImport(path) {
  let current = path.parentPath
  while (current) {
    const type = current.node.type
    if (
      type === 'ImportDeclaration' ||
      type === 'ExportNamedDeclaration' ||
      type === 'ExportDefaultDeclaration' ||
      type === 'ExportAllDeclaration'
    ) {
      return true
    }
    if (
      type === 'CallExpression' &&
      current.node.callee &&
      current.node.callee.type === 'Import'
    ) {
      return true
    }
    current = current.parentPath
  }
  return false
}

/**
 * 判断字符串是否作为 ignoreMethods 中方法的参数
 * 例如：console.log('加载失败') → 跳过
 * 支持完整方法名匹配（console.log）和仅方法名匹配（includes）
 */
function isIgnoredMethodArg(path, ignoreMethods) {
  if (!ignoreMethods || ignoreMethods.length === 0) return false

  const parent = path.parent

  // 直接作为函数参数：fn('中文')
  if (parent.type === 'CallExpression') {
    const callee = parent.callee
    const fullName = getFullMethodName(callee)
    if (fullName) {
      // 完整匹配：console.log
      if (ignoreMethods.includes(fullName)) return true
      // 仅方法名匹配：includes、indexOf 等
      const methodName = fullName.split('.').pop()
      if (ignoreMethods.includes(methodName)) return true
    }
  }

  return false
}

/**
 * 判断节点是否在三元运算符中
 */
function isInConditionalExpression(path) {
  let current = path.parentPath
  while (current) {
    if (current.node.type === 'ConditionalExpression') return true
    current = current.parentPath
  }
  return false
}

/**
 * 获取完整的方法名（支持 a.b.c 形式）
 * 例如：console.log → 'console.log'
 */
function getFullMethodName(callee) {
  if (!callee) return null

  if (callee.type === 'MemberExpression') {
    const parts = []
    let current = callee
    while (current.type === 'MemberExpression') {
      if (current.property.type === 'Identifier') {
        parts.unshift(current.property.name)
      }
      current = current.object
    }
    if (current.type === 'Identifier') {
      parts.unshift(current.name)
    }
    return parts.join('.')
  }

  if (callee.type === 'Identifier') {
    return callee.name
  }

  return null
}

/**
 * 获取节点的源码上下文（用于输出展示）
 * @param {object} path - babel traverse path
 * @param {string[]} sourceLines - 源码按行拆分
 * @param {number} scriptStartLine - 脚本起始行号
 * @returns {string} 上下文源码
 */
function getContext(path, sourceLines, scriptStartLine) {
  try {
    const node = path.node
    if (node.loc) {
      const lineIdx = node.loc.start.line - 1
      const line = sourceLines[lineIdx]
      if (line) {
        return line.trim().length > 80
          ? line.trim().slice(0, 80) + '...'
          : line.trim()
      }
    }
    // 回退：尝试从父节点获取
    const parent = path.parent
    if (parent && parent.loc) {
      const lineIdx = parent.loc.start.line - 1
      const line = sourceLines[lineIdx]
      if (line) {
        return line.trim().length > 80
          ? line.trim().slice(0, 80) + '...'
          : line.trim()
      }
    }
    return ''
  } catch {
    return ''
  }
}

module.exports = { parseScript }

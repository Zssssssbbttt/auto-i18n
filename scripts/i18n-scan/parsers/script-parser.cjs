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
 * @param {string[]} translateMethods - 白名单方法列表（只有这些方法的参数才翻译）
 * @param {number} scriptStartLine - 脚本在 .vue 文件中的起始行号（1-based）
 * @returns {object[]} 扫描结果数组
 */
function parseScript(code, translateMethods, scriptStartLine, scanDeclarations = true) {
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

      // 跳过成员表达式赋值（form.status = '中文'）
      if (isMemberAssignmentTarget(path)) return

      // 跳过字符串拼接的操作数（由 BinaryExpression 访问器统一处理）
      if (isInStringConcat(path)) return

      // 跳过数组元素中的字符串
      if (path.parent.type === 'ArrayExpression') return

      // 函数调用参数：不在白名单则跳过
      if (isInCallExpression(path) && !isTranslatableMethodArg(path, translateMethods)) return

      // 变量声明赋值：未启用则跳过
      if (!scanDeclarations && isInVariableDeclarator(path)) return

      // 跳过对象 key
      if (
        path.parent.type === 'ObjectProperty' &&
        path.parent.key === path.node
      )
        return

      // 跳过 TS 类型注解
      if (path.parent.type === 'TSLiteralType') return

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
          // 检查是否为变量声明赋值（const/let/var msg = `...`）
          if (
            path.parent.type === 'VariableDeclarator' &&
            path.parent.init === path.node
          ) {
            // 变量声明赋值未启用 → 跳过
            if (!scanDeclarations) return

            // 多行模板字符串跳过，标记为特殊
            const startLine = path.node.loc.start.line
            const endLine = path.node.loc.end.line
            if (startLine !== endLine) {
              results.push({
                line,
                chineseText: text.trim(),
                type: 'special-template-literal',
                reason: '多行模板字符串含变量插值',
                context: getContext(path, sourceLines, scriptStartLine),
              })
              return
            }

            // 收集所有 quasi 文本和 expression 源码
            const allQuasis = quasis.map(
              (q) => q.value.raw || q.value.cooked || ''
            )
            const allExpressions = (path.node.expressions || []).map(
              (expr) => {
                if (expr.loc) {
                  const exprLineIdx = expr.loc.start.line - 1
                  const exprLine = sourceLines[exprLineIdx]
                  if (exprLine) {
                    return exprLine.slice(
                      expr.loc.start.column,
                      expr.loc.end.column
                    )
                  }
                }
                return ''
              }
            )

            results.push({
              line,
              chineseText: text.trim(),
              type: 'template-literal',
              quasiIndex: quasis.indexOf(quasi),
              templateStartCol: path.node.loc.start.column,
              templateEndCol: path.node.loc.end.column,
              quasis: allQuasis,
              expressions: allExpressions,
              context: getContext(path, sourceLines, scriptStartLine),
            })
          } else {
            // 非变量声明 → 特殊-未处理
            results.push({
              line,
              chineseText: text.trim(),
              type: 'special-template-literal',
              reason: '模板字符串含变量插值',
              context: getContext(path, sourceLines, scriptStartLine),
            })
          }
        } else {
          // 不含插值 → 正常处理
          if (isMemberAssignmentTarget(path)) return
          if (isInCallExpression(path) && !isTranslatableMethodArg(path, translateMethods)) return
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
        if (isInVariableDeclarator(path)) {
          if (!scanDeclarations) return
          // 变量声明赋值中的字符串拼接 → 正常替换
          results.push({
            line,
            chineseText,
            type: 'script-string',
            context: getContext(path, sourceLines, scriptStartLine),
          })
        } else {
          // 非变量声明 → 特殊-未处理
          results.push({
            line,
            chineseText,
            type: 'special-string-concat',
            reason: '字符串 + 拼接含变量',
            context: getContext(path, sourceLines, scriptStartLine),
          })
        }
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
 * 判断字符串是否作为 translateMethods 白名单中方法的参数
 * 默认：函数调用参数不翻译，只有匹配白名单的才翻译
 * 支持通配符：'ElMessage.*' 匹配 ElMessage.success / ElMessage.warning 等
 * 仅完整链匹配，不支持裸方法名匹配
 * @param {object} path - babel traverse path
 * @param {string[]} translateMethods - 白名单方法列表
 * @returns {boolean} true = 应该翻译
 */
function isTranslatableMethodArg(path, translateMethods) {
  if (!translateMethods || translateMethods.length === 0) return false

  const parent = path.parent

  // 直接作为函数参数：fn('中文')
  if (parent.type === 'CallExpression') {
    const callee = parent.callee
    const fullName = getFullMethodName(callee)
    if (!fullName) return false

    // 精确匹配
    if (translateMethods.includes(fullName)) return true

    // 通配符匹配：ElMessage.* → 匹配 ElMessage.success 等
    for (const pattern of translateMethods) {
      if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2)
        if (fullName.startsWith(prefix + '.')) return true
      }
    }

    return false
  }

  return false
}

/**
 * 判断节点是否在变量声明赋值中（const/let/var x = ...）
 * 遇到函数边界（FunctionDeclaration/FunctionExpression/ArrowFunctionExpression/CallExpression）时停止
 * @param {object} path - babel traverse path
 * @returns {boolean}
 */
function isInVariableDeclarator(path) {
  let current = path.parentPath
  while (current) {
    const type = current.node.type
    if (type === 'VariableDeclarator') return true
    // 遇到函数边界或调用表达式时停止，避免穿透到外层
    if (
      type === 'FunctionDeclaration' ||
      type === 'FunctionExpression' ||
      type === 'ArrowFunctionExpression' ||
      type === 'CallExpression'
    ) return false
    current = current.parentPath
  }
  return false
}

/**
 * 判断字符串是否作为成员表达式赋值的右值
 * 例如：form.status = '已通过' → 跳过（大概率是提交给后端的数据值）
 * @param {object} path - babel traverse path
 * @returns {boolean}
 */
function isMemberAssignmentTarget(path) {
  const parent = path.parent
  if (
    parent.type === 'AssignmentExpression' &&
    parent.left &&
    parent.left.type === 'MemberExpression' &&
    parent.right === path.node
  ) {
    return true
  }
  return false
}

/**
 * 判断字符串是否在函数调用表达式中作为参数
 */
function isInCallExpression(path) {
  return path.parent.type === 'CallExpression'
}

/**
 * 判断字符串是否是 + 拼接表达式的操作数
 * 这些由 BinaryExpression 访问器统一处理，StringLiteral 不重复处理
 */
function isInStringConcat(path) {
  const parent = path.parent
  return parent.type === 'BinaryExpression' && parent.operator === '+'
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

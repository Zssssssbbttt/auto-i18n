/**
 * 脚本 AST 解析器
 * 使用 @babel/parser + @babel/traverse 解析 JS/TS 代码，提取需要翻译的中文文本
 *
 * 两条独立路径：
 * 1. VariableDeclarator 正向匹配 — 变量名命中 scriptTargets 时，按属性白名单或全量翻译
 * 2. translateMethods 白名单 — 方法调用参数中的中文（如 ElMessage.success('中文')）
 */

const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const { hasChinese } = require('../utils/chinese-detector.cjs')

/**
 * 解析脚本代码，提取所有需要翻译的中文文本
 * @param {string} code - 脚本源代码
 * @param {string[]} translateMethods - 白名单方法列表（只有这些方法的参数才翻译）
 * @param {number} scriptStartLine - 脚本在 .vue 文件中的起始行号（0-based）
 * @param {object} scriptTargets - 变量名 → 属性名数组映射，如 { columns: ['label'] }
 *        value 为 [] 表示该变量内所有中文都翻译
 * @returns {object[]} 扫描结果数组
 */
function parseScript(code, translateMethods, scriptStartLine, scriptTargets = {}) {
  const results = []
  const sourceLines = code.split('\n')
  const targetVarNames = Object.keys(scriptTargets)

  // 解析代码为 AST
  let ast
  try {
    ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      errorRecovery: true,
    })
  } catch (err) {
    return results
  }

  // 遍历 AST
  traverse(ast, {
    /**
     * 路径1：VariableDeclarator 正向匹配
     * 仅处理变量名命中 scriptTargets 的声明，其他变量内的中文不翻译
     */
    VariableDeclarator(path) {
      if (targetVarNames.length === 0) return

      const varName = getVariableName(path)
      if (!varName || !targetVarNames.includes(varName)) return

      const target = scriptTargets[varName]
      const init = path.node.init
      if (!init) return

      // 跳过接口数据/函数返回值的初始化
      if (shouldSkipByInit(init)) return

      const isConst = path.parent.kind === 'const'

      // 构建变量元数据（供 replacer 做 computed 包裹）
      const meta = {
        varName,
        isConst,
        initStartLine: init.loc ? init.loc.start.line + scriptStartLine : 0,
        initStartCol: init.loc ? init.loc.start.column : 0,
        initEndLine: init.loc ? init.loc.end.line + scriptStartLine : 0,
        initEndCol: init.loc ? init.loc.end.column : 0,
      }

      if (target.length === 0) {
        // [] → 递归收集该变量内所有中文
        collectAllChinese(init, results, sourceLines, scriptStartLine, meta)
      } else {
        // ['label', 'title'] → 递归找对象，属性名匹配则收集
        collectByProperties(init, target, results, sourceLines, scriptStartLine, meta)
      }
    },

    /**
     * 路径2：StringLiteral 访问器 — 仅处理 translateMethods 白名单
     * 变量声明中的字符串由 VariableDeclarator 访问器处理
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

      // 跳过对象 key
      if (path.parent.type === 'ObjectProperty' && path.parent.key === path.node) return

      // 跳过 TS 类型注解
      if (path.parent.type === 'TSLiteralType') return

      // 变量声明中的字符串由 VariableDeclarator 处理，此处跳过
      if (isInVariableDeclarator(path)) return

      // 只翻译白名单方法调用参数
      if (!isInCallExpression(path) || !isTranslatableMethodArg(path, translateMethods)) return

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
     * 路径2：模板字符串 — 变量声明由 VariableDeclarator 处理，此处只处理 translateMethods
     */
    TemplateLiteral(path) {
      // 变量声明中的模板字符串由 VariableDeclarator 处理
      if (isInVariableDeclarator(path)) return

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
          results.push({
            line,
            chineseText: text.trim(),
            type: 'special-template-literal',
            reason: '模板字符串含变量插值',
            context: getContext(path, sourceLines, scriptStartLine),
          })
        } else {
          if (isMemberAssignmentTarget(path)) return
          if (!isInCallExpression(path) || !isTranslatableMethodArg(path, translateMethods)) return
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
     * 路径2：二元表达式拼接 — 变量声明由 VariableDeclarator 处理
     */
    BinaryExpression(path) {
      if (path.node.operator !== '+') return

      // 变量声明中的拼接由 VariableDeclarator 处理
      if (isInVariableDeclarator(path)) return

      const left = path.node.left
      const right = path.node.right

      const hasStringOperand =
        left.type === 'StringLiteral' || right.type === 'StringLiteral'
      if (!hasStringOperand) return

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

// ======================== 辅助函数 ========================

/**
 * 从 VariableDeclarator 节点提取变量名（仅支持简单标识符，解构跳过）
 */
function getVariableName(path) {
  const id = path.node.id
  if (id.type === 'Identifier') return id.name
  return null
}

/**
 * 判断变量 init 是否应跳过（函数调用/await 返回的数据不翻译）
 * 例外：ref()、reactive() 包裹的值不跳过
 */
function shouldSkipByInit(init) {
  if (!init) return false
  if (isVueReactive(init)) return false
  return init.type === 'CallExpression' || init.type === 'AwaitExpression'
}

/**
 * 判断 CallExpression 是否为 ref() 或 reactive() 调用
 */
function isVueReactive(init) {
  if (init.type !== 'CallExpression') return false
  const name = getFullMethodName(init.callee)
  return name === 'ref' || name === 'reactive'
}

/**
 * 展开 Vue 响应式包裹（ref/reactive），返回内部值
 * ref({ label: '中文' }) → { label: '中文' }，ref('中文') → '中文'
 */
function unwrapVueReactive(node) {
  if (node.type === 'CallExpression' && isVueReactive(node)) {
    const args = node.arguments || []
    if (args.length > 0) return args[0]
  }
  return node
}

// ======================== 递归收集函数 ========================

/**
 * 精确匹配属性名：递归遍历 init AST，找到匹配属性后提取中文
 * @param {object} node - AST 节点
 * @param {string[]} targetProps - 要匹配的属性名数组
 * @param {object[]} results - 结果数组
 * @param {string[]} sourceLines - 源码行
 * @param {number} scriptStartLine - 脚本起始行
 * @param {object} meta - 变量元数据 { varName, isConst, initStartLine, initStartCol, initEndLine, initEndCol }
 */
function collectByProperties(node, targetProps, results, sourceLines, scriptStartLine, meta) {
  if (!node) return

  // 展开 Vue 响应式包裹：ref({ label: '中文' }) → { label: '中文' }
  node = unwrapVueReactive(node)

  if (node.type === 'ObjectExpression') {
    for (const prop of node.properties) {
      if (!prop) continue
      // 跳过 spread 元素
      if (prop.type === 'SpreadElement') continue

      const keyName = getObjectKeyName(prop)
      if (!keyName) continue

      if (targetProps.includes(keyName)) {
        // 匹配到目标属性 → 提取其中的中文
        extractChineseFromExpression(prop.value, results, sourceLines, scriptStartLine, meta)
      }

      // 继续递归嵌套对象/数组
      if (
        prop.value &&
        (prop.value.type === 'ObjectExpression' || prop.value.type === 'ArrayExpression')
      ) {
        collectByProperties(prop.value, targetProps, results, sourceLines, scriptStartLine, meta)
      }
    }
  } else if (node.type === 'ArrayExpression') {
    for (const elem of node.elements) {
      if (!elem) continue
      collectByProperties(elem, targetProps, results, sourceLines, scriptStartLine, meta)
    }
  }
  // 其他类型（CallExpression等）不处理
}

/**
 * 全量收集：递归遍历 init AST，收集所有中文文本
 * @param {object} node - AST 节点
 * @param {object[]} results - 结果数组
 * @param {string[]} sourceLines - 源码行
 * @param {number} scriptStartLine - 脚本起始行
 * @param {object} meta - 变量元数据
 */
function collectAllChinese(node, results, sourceLines, scriptStartLine, meta) {
  if (!node) return

  // 展开 Vue 响应式包裹：ref('中文') → '中文'
  node = unwrapVueReactive(node)

  if (node.type === 'StringLiteral') {
    if (hasChinese(node.value)) {
      const line = node.loc ? node.loc.start.line + scriptStartLine : scriptStartLine
      results.push({
        line,
        chineseText: node.value,
        type: 'script-string',
        context: getContextByNode(node, sourceLines),
        ...meta,
      })
    }
  } else if (node.type === 'TemplateLiteral') {
    const quasis = node.quasis || []
    const hasInterpolation = node.expressions && node.expressions.length > 0

    quasis.forEach((quasi, idx) => {
      const text = quasi.value.raw || quasi.value.cooked || ''
      if (!hasChinese(text)) return

      const line = node.loc ? node.loc.start.line + scriptStartLine : scriptStartLine

      if (hasInterpolation) {
        const startLine = node.loc.start.line
        const endLine = node.loc.end.line
        if (startLine !== endLine) {
          results.push({
            line,
            chineseText: text.trim(),
            type: 'special-template-literal',
            reason: '多行模板字符串含变量插值',
            context: getContextByNode(node, sourceLines),
            ...meta,
          })
          return
        }

        const allQuasis = quasis.map((q) => q.value.raw || q.value.cooked || '')
        const allExpressions = (node.expressions || []).map((expr) => {
          if (expr.loc) {
            const exprLineIdx = expr.loc.start.line - 1
            const exprLine = sourceLines[exprLineIdx]
            if (exprLine) {
              return exprLine.slice(expr.loc.start.column, expr.loc.end.column)
            }
          }
          return ''
        })

        results.push({
          line,
          chineseText: text.trim(),
          type: 'template-literal',
          quasiIndex: idx,
          templateStartCol: node.loc.start.column,
          templateEndCol: node.loc.end.column,
          quasis: allQuasis,
          expressions: allExpressions,
          context: getContextByNode(node, sourceLines),
          ...meta,
        })
      } else {
        results.push({
          line,
          chineseText: text.trim(),
          type: 'script-string',
          context: getContextByNode(node, sourceLines),
          ...meta,
        })
      }
    })
  } else if (node.type === 'BinaryExpression' && node.operator === '+') {
    extractChineseFromBinaryExpression(node, results, sourceLines, scriptStartLine, meta)
  } else if (node.type === 'ConditionalExpression') {
    collectAllChinese(node.consequent, results, sourceLines, scriptStartLine, meta)
    collectAllChinese(node.alternate, results, sourceLines, scriptStartLine, meta)
  } else if (node.type === 'ObjectExpression') {
    for (const prop of node.properties) {
      if (!prop) continue
      if (prop.type === 'SpreadElement') continue
      if (prop.value) {
        collectAllChinese(prop.value, results, sourceLines, scriptStartLine, meta)
      }
    }
  } else if (node.type === 'ArrayExpression') {
    for (const elem of node.elements) {
      if (elem) collectAllChinese(elem, results, sourceLines, scriptStartLine, meta)
    }
  }
}

/**
 * 从表达式中提取中文（处理 StringLiteral、TemplateLiteral、BinaryExpression、ConditionalExpression）
 * 用于 collectByProperties 中匹配属性值的提取
 */
function extractChineseFromExpression(expr, results, sourceLines, scriptStartLine, meta) {
  if (!expr) return

  // 展开 Vue 响应式包裹
  expr = unwrapVueReactive(expr)

  if (expr.type === 'StringLiteral') {
    if (hasChinese(expr.value)) {
      const line = expr.loc ? expr.loc.start.line + scriptStartLine : scriptStartLine
      results.push({
        line,
        chineseText: expr.value,
        type: 'script-string',
        context: getContextByNode(expr, sourceLines),
        ...meta,
      })
    }
  } else if (expr.type === 'TemplateLiteral') {
    const quasis = expr.quasis || []
    const hasInterpolation = expr.expressions && expr.expressions.length > 0

    quasis.forEach((quasi, idx) => {
      const text = quasi.value.raw || quasi.value.cooked || ''
      if (!hasChinese(text)) return

      const line = expr.loc ? expr.loc.start.line + scriptStartLine : scriptStartLine

      if (hasInterpolation) {
        const startLine = expr.loc.start.line
        const endLine = expr.loc.end.line
        if (startLine !== endLine) {
          results.push({
            line,
            chineseText: text.trim(),
            type: 'special-template-literal',
            reason: '多行模板字符串含变量插值',
            context: getContextByNode(expr, sourceLines),
            ...meta,
          })
          return
        }

        const allQuasis = quasis.map((q) => q.value.raw || q.value.cooked || '')
        const allExpressions = (expr.expressions || []).map((e) => {
          if (e.loc) {
            const exprLineIdx = e.loc.start.line - 1
            const exprLine = sourceLines[exprLineIdx]
            if (exprLine) {
              return exprLine.slice(e.loc.start.column, e.loc.end.column)
            }
          }
          return ''
        })

        results.push({
          line,
          chineseText: text.trim(),
          type: 'template-literal',
          quasiIndex: idx,
          templateStartCol: expr.loc.start.column,
          templateEndCol: expr.loc.end.column,
          quasis: allQuasis,
          expressions: allExpressions,
          context: getContextByNode(expr, sourceLines),
          ...meta,
        })
      } else {
        results.push({
          line,
          chineseText: text.trim(),
          type: 'script-string',
          context: getContextByNode(expr, sourceLines),
          ...meta,
        })
      }
    })
  } else if (expr.type === 'BinaryExpression' && expr.operator === '+') {
    extractChineseFromBinaryExpression(expr, results, sourceLines, scriptStartLine, meta)
  } else if (expr.type === 'ConditionalExpression') {
    extractChineseFromExpression(expr.consequent, results, sourceLines, scriptStartLine, meta)
    extractChineseFromExpression(expr.alternate, results, sourceLines, scriptStartLine, meta)
  }
  // 其他类型（箭头函数、调用表达式等）不处理
}

/**
 * 从 BinaryExpression (+) 中提取中文操作数
 */
function extractChineseFromBinaryExpression(node, results, sourceLines, scriptStartLine, meta) {
  const parts = collectAllChineseFromBinaryExpression(node)
  if (parts.length === 0) return

  const line = node.loc ? node.loc.start.line + scriptStartLine : scriptStartLine
  parts.forEach((chineseText) => {
    results.push({
      line,
      chineseText,
      type: 'script-string',
      context: getContextByNode(node, sourceLines),
      ...meta,
    })
  })
}

/**
 * 递归收集二元表达式 (+) 中的所有中文操作数
 */
function collectAllChineseFromBinaryExpression(node) {
  const parts = []

  function walk(n) {
    if (!n) return
    if (n.type === 'StringLiteral' && hasChinese(n.value)) {
      parts.push(n.value)
    } else if (n.type === 'BinaryExpression' && n.operator === '+') {
      walk(n.left)
      walk(n.right)
    }
    // 跳过非字符串操作数（如变量）
  }

  walk(node)
  return parts
}

/**
 * 获取对象属性的 key 名称（支持 Identifier 和 StringLiteral）
 */
function getObjectKeyName(prop) {
  if (!prop.key) return null
  if (prop.key.type === 'Identifier') return prop.key.name
  if (prop.key.type === 'StringLiteral') return prop.key.value
  return null
}

// ======================== 已有辅助函数（保留不变） ========================

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
 * 支持通配符：'ElMessage.*' 匹配 ElMessage.success / ElMessage.warning 等
 */
function isTranslatableMethodArg(path, translateMethods) {
  if (!translateMethods || translateMethods.length === 0) return false

  const parent = path.parent

  if (parent.type === 'CallExpression') {
    const callee = parent.callee
    const fullName = getFullMethodName(callee)
    if (!fullName) return false

    if (translateMethods.includes(fullName)) return true

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
 * 遇到函数边界、调用表达式、三元表达式时停止
 */
function isInVariableDeclarator(path) {
  let current = path.parentPath
  while (current) {
    const type = current.node.type
    if (type === 'VariableDeclarator') return true
    if (
      type === 'FunctionDeclaration' ||
      type === 'FunctionExpression' ||
      type === 'ArrowFunctionExpression' ||
      type === 'CallExpression' ||
      type === 'ConditionalExpression'
    ) return false
    current = current.parentPath
  }
  return false
}

/**
 * 判断字符串是否作为成员表达式赋值的右值
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
 */
function isInStringConcat(path) {
  const parent = path.parent
  return parent.type === 'BinaryExpression' && parent.operator === '+'
}

/**
 * 获取完整的方法名（支持 a.b.c 形式）
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
 * 获取节点的源码上下文（通过 babel path）
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

/**
 * 获取 AST 节点的源码上下文（通过 node，用于递归遍历）
 */
function getContextByNode(node, sourceLines) {
  try {
    if (node.loc) {
      const lineIdx = node.loc.start.line - 1
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

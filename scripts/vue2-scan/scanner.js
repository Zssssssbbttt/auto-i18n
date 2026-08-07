/**
 * AST 扫描模块
 * 解析 Vue 模板和 JS/TS 脚本，提取硬编码中文
 */
const babelParser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const vueParser = require('vue-eslint-parser')

function hasChinese(str) {
  return /[一-龥]/.test(str)
}

/**
 * 剥离字符串首尾的标点符号，保留中间部分
 * "代理人：" → "代理人"
 * "（代理人）" → "代理人"
 * "代理：人" → "代理：人"（中间标点不动）
 */
function stripBoundaryPunctuation(str) {
  return str.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')
}

/**
 * 解析 Vue 模板中的中文
 */
function parseVueTemplate(code, filePath, config) {
  const items = []
  let ast
  try {
    const templateOnly = code.replace(/<script[\s\S]*?<\/script>/g, '<script></script>')
    ast = vueParser.parse(templateOnly, {
      sourceType: 'module',
      ecmaVersion: 2020,
    })
  } catch (e) {
    console.error(`  [WARN] 模板解析失败 ${filePath}: ${e.message}`)
    return items
  }

  const templateBody = ast.templateBody
  if (!templateBody) return items

  function walk(node) {
    if (!node) return

    // VText: 纯文本节点 → {{ $t('key') }}
    if (node.type === 'VText') {
      const text = node.value
      if (hasChinese(text)) {
        const trimmed = text.trim()
        if (trimmed) {
          const item = {
            text: trimmed,
            start: node.range[0] + text.indexOf(trimmed),
            end: node.range[0] + text.indexOf(trimmed) + trimmed.length,
            type: 'TEMPLATE_TEXT',
          }
          // 剥离首尾标点，生成 matchText 用于回退匹配
          const matchText = stripBoundaryPunctuation(trimmed)
          if (matchText && matchText !== trimmed) {
            item.matchText = matchText
          }
          items.push(item)
        }
      }
    }

    // VAttribute: 属性
    if (node.type === 'VAttribute') {
      // 从源码中提取原始属性名（AST 会转小写，源码保留原始大小写）
      let attrName = ''
      if (node.key.range) {
        attrName = code.slice(node.key.range[0], node.key.range[1])
      }
      // 去掉指令前缀（: 或 v-bind: 或 @ 等）
      attrName = attrName.replace(/^(?:v-bind:|:)/, '')

      if (attrName && config.ignoreAttributes.includes(attrName)) return

      // 只处理白名单中的普通属性（非指令）
      if (!node.directive && node.value && node.value.type === 'VLiteral') {
        const text = node.value.value
        if (hasChinese(text) && config.translateAttributes.includes(attrName)) {
          items.push({
            text: text,
            start: node.range[0],
            end: node.range[1],
            type: 'TEMPLATE_ATTR',
            attrName: attrName,
          })
        }
      }
    }

    if (node.children) node.children.forEach(walk)
    if (node.startTag && node.startTag.attributes) {
      node.startTag.attributes.forEach(walk)
    }
  }

  walk(templateBody)
  return items
}

/**
 * 解析 JS/TS 脚本中的中文
 */
function parseScript(code, filePath, config) {
  const items = []
  let ast
  try {
    ast = babelParser.parse(code, {
      sourceType: 'module',
      plugins: [
        'typescript',
        'jsx',
        'classProperties',
        'decorators-legacy',
        'dynamicImport',
        'optionalChaining',
        'nullishCoalescingOperator',
      ],
    })
  } catch (e) {
    console.error(`  [WARN] 脚本解析失败 ${filePath}: ${e.message}`)
    return items
  }

  traverse(ast, {
    StringLiteral(path) {
      if (path.parentPath.isImportDeclaration()) return
      if (path.parentPath.isObjectProperty() && path.key === 'key') return

      // 跳过 $t() / this.$t() / i18n.t() 调用
      if (path.parentPath.isCallExpression()) {
        const callee = path.parentPath.node.callee
        if (isI18nCall(callee, config.tFunction)) return
      }

      // 跳过黑名单方法
      if (isIgnoredMethod(path, config)) return

      const value = path.node.value
      if (!hasChinese(value)) return

      items.push({
        text: value,
        start: path.node.start,
        end: path.node.end,
        type: 'JS_STRING',
      })
    },

    TemplateLiteral(path) {
      if (path.parentPath.isCallExpression()) {
        const callee = path.parentPath.node.callee
        if (isI18nCall(callee, config.tFunction)) return
      }

      if (isIgnoredMethod(path, config)) return

      path.node.quasis.forEach(quasi => {
        const value = quasi.value.raw
        if (hasChinese(value)) {
          items.push({
            text: value,
            start: quasi.start,
            end: quasi.end,
            type: 'TEMPLATE_QUASI',
          })
        }
      })
    },
  })

  return items
}

function isI18nCall(callee, tFunction) {
  const t = tFunction || '$t'
  if (callee.type === 'Identifier' && callee.name === t) return true
  if (
    callee.type === 'MemberExpression' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === t
  ) return true
  return false
}

function isIgnoredMethod(path, config) {
  if (!path.parentPath.isCallExpression()) return false
  const callee = path.parentPath.node.callee
  let methodName = ''
  if (callee.type === 'Identifier') {
    methodName = callee.name
  } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    const objName = callee.object.type === 'Identifier' ? callee.object.name + '.' : ''
    methodName = objName + callee.property.name
  }
  if (methodName && config.ignoreMethods.includes(methodName)) return true
  if (callee.property && config.ignoreMethods.includes(callee.property.name)) return true
  return false
}

module.exports = { parseVueTemplate, parseScript, extraScan, hasChinese, parseScriptTargets, parseTranslateMethods, getScriptCode }

/**
 * 从源码中提取 script 部分
 * @returns {{ code: string, offset: number } | null}
 */
function getScriptCode(code, filePath) {
  if (filePath.endsWith('.vue')) {
    const match = code.match(/<script[^>]*>([\s\S]*?)<\/script>/)
    if (match) {
      return { code: match[1], offset: match.index + match[0].indexOf(match[1]) }
    }
    return null
  }
  if (/\.(ts|js|tsx|jsx)$/.test(filePath)) {
    return { code, offset: 0 }
  }
  return null
}

/**
 * 补充扫描：对 translateAttributes 中的属性做正则兜底
 * 处理 AST 无法覆盖的动态绑定场景
 *
 * 匹配形式（任意拼接组合）：
 *   :titleInfo="'查看详情'"
 *   :titleInfo="'查看-' + businessKey"
 *   :titleInfo="businessKey + '查看'"
 *   :label="'查看-'+key+'号'"
 */
function extraScan(code, filePath, config) {
  const items = []
  const attrs = config.translateAttributes || []

  for (const attrName of attrs) {
    // 匹配整个动态属性值 :attrName="..."
    const attrRe = new RegExp(
      `:${escapeRe(attrName)}\\s*=\\s*"([^"]*)"`,
      'g'
    )
    let attrMatch
    while ((attrMatch = attrRe.exec(code)) !== null) {
      const attrValue = attrMatch[1]
      const attrStart = attrMatch.index

      // 在属性值中提取所有含中文的字符串字面量 '...'
      const strRe = /'([^']*[一-龥][^']*)'/g
      let strMatch
      while ((strMatch = strRe.exec(attrValue)) !== null) {
        const text = strMatch[1]
        // 定位在源码中的绝对位置
        const absStart = attrStart + attrMatch[0].indexOf("'" + text + "'") + 1
        items.push({
          text: text,
          start: absStart,
          end: absStart + text.length,
          type: 'TEMPLATE_ATTR_DYNAMIC',
          attrName: attrName,
        })
      }
    }
  }

  return items
}

function escapeRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 白名单模式：匹配 scriptTargets 配置的变量属性中的中文
 * 支持 const/let/var/解构/重新赋值/data()返回/箭头函数
 */
function parseScriptTargets(code, config) {
  const items = []
  let ast
  try {
    ast = babelParser.parse(code, {
      sourceType: 'module',
      plugins: [
        'typescript', 'jsx', 'classProperties',
        'decorators-legacy', 'dynamicImport',
        'optionalChaining', 'nullishCoalescingOperator',
      ],
    })
  } catch (e) {
    console.error(`  [WARN] 脚本解析失败: ${e.message}`)
    return items
  }

  const targetNames = new Set(Object.keys(config.scriptTargets))

  traverse(ast, {
    VariableDeclarator(path) {
      const name = resolveVarName(path.node.id)
      if (!name || !targetNames.has(name)) return
      if (path.node.init) {
        processTargetInit(path.node.init, name, items, config, path)
      }
    },

    AssignmentExpression(path) {
      const name = resolveVarName(path.node.left)
      if (!name || !targetNames.has(name)) return
      processTargetInit(path.node.right, name, items, config, path)
    },

    // data() { return { rules: [...] } }
    ObjectProperty(path) {
      if (!path.node.key || path.node.key.type !== 'Identifier') return
      const name = path.node.key.name
      if (!targetNames.has(name)) return
      if (!isInsideDataReturn(path) && !isInsideComputed(path)) return
      processTargetInit(path.node.value, name, items, config, path)
    },

    // class property: a = { name: '张杰' }
    ClassProperty(path) {
      if (!path.node.key || path.node.key.type !== 'Identifier') return
      const name = path.node.key.name
      if (!targetNames.has(name)) return
      if (path.node.value) {
        processTargetInit(path.node.value, name, items, config, path)
      }
    },
  })

  return items
}

/**
 * 白名单模式：匹配 translateMethods 配置的方法调用中的中文
 * 支持 this. / (this as any). 前缀，支持 * 通配符
 */
function parseTranslateMethods(code, config) {
  const items = []
  let ast
  try {
    ast = babelParser.parse(code, {
      sourceType: 'module',
      plugins: [
        'typescript', 'jsx', 'classProperties',
        'decorators-legacy', 'dynamicImport',
        'optionalChaining', 'nullishCoalescingOperator',
      ],
    })
  } catch (e) {
    console.error(`  [WARN] 脚本解析失败: ${e.message}`)
    return items
  }

  const methods = config.translateMethods

  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee
      const methodInfo = resolveMethod(callee, methods)
      if (!methodInfo) return

      if (methodInfo.mode === 'object') {
        // $message({ message: '...' }) — 提取第一个对象参数中的字符串属性值
        const firstArg = path.node.arguments[0]
        if (firstArg && firstArg.type === 'ObjectExpression') {
          for (const prop of firstArg.properties) {
            if (prop.value.type === 'StringLiteral' && hasChinese(prop.value.value)) {
              items.push({
                text: prop.value.value,
                start: prop.value.start,
                end: prop.value.end,
                type: 'TRANSLATE_METHOD_PROP',
              })
            } else if (prop.value.type === 'TemplateLiteral') {
              for (const quasi of prop.value.quasis) {
                if (hasChinese(quasi.value.raw)) {
                  items.push({
                    text: quasi.value.raw,
                    start: quasi.start,
                    end: quasi.end,
                    type: 'TRANSLATE_METHOD_PROP',
                  })
                }
              }
            }
          }
        }
      } else if (methodInfo.mode === 'args') {
        // $message.success('...') 或 $confirm('...', '...') — 提取所有字符串参数
        for (const arg of path.node.arguments) {
          if (arg.type === 'StringLiteral' && hasChinese(arg.value)) {
            items.push({
              text: arg.value,
              start: arg.start,
              end: arg.end,
              type: 'TRANSLATE_METHOD_ARG',
            })
          } else if (arg.type === 'TemplateLiteral') {
            for (const quasi of arg.quasis) {
              if (hasChinese(quasi.value.raw)) {
                items.push({
                  text: quasi.value.raw,
                  start: quasi.start,
                  end: quasi.end,
                  type: 'TRANSLATE_METHOD_ARG',
                })
              }
            }
          }
        }
      }
    },
  })

  return items
}

// --- scriptTargets helpers ---

function resolveVarName(node) {
  if (node.type === 'Identifier') return node.name
  // TODO: 解构赋值支持待实现 const { rules } = xxx
  return null
}

function processTargetInit(init, varName, items, config, path) {
  if (!init) return
  const allowedProps = config.scriptTargets[varName]
  if (!allowedProps || allowedProps.length === 0) return

  // Unwrap arrow function / function expression to get the effective value
  let value = init
  if (init.type === 'ArrowFunctionExpression' && init.body.type !== 'BlockStatement') {
    value = init.body
  } else if (init.type === 'ArrowFunctionExpression' && init.body.type === 'BlockStatement') {
    value = findReturnValue(init.body)
  } else if (init.type === 'FunctionExpression') {
    value = findReturnValue(init.body)
  }

  if (!value) return

  if (value.type === 'ObjectExpression') {
    extractObjectStrings(value, allowedProps, items, 'SCRIPT_TARGET_OBJECT')
  } else if (value.type === 'ArrayExpression') {
    const needsComputed = !isInsideDataReturn(path) && !isInsideComputed(path)
    const itemType = needsComputed ? 'SCRIPT_TARGET_ARRAY' : 'SCRIPT_TARGET_OBJECT'
    for (const elem of value.elements) {
      if (elem && elem.type === 'ObjectExpression') {
        extractObjectStrings(elem, allowedProps, items, itemType)
      }
    }
    if (needsComputed) {
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]
        if (item._arrayNode === value) break
        if (item.type === 'SCRIPT_TARGET_ARRAY' && item.start >= value.start && item.end <= value.end) {
          item.wrapStart = value.start
          item.wrapEnd = value.end
          item._arrayNode = value
        } else {
          break
        }
      }
    }
  }
}

function extractObjectStrings(objNode, allowedProps, items, itemType) {
  for (const prop of objNode.properties) {
    if (!prop.key) continue
    const keyName = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value
    const value = prop.value

    if (allowedProps.includes(keyName)) {
      // 匹配的属性名 → 提取字符串值
      if (value.type === 'StringLiteral' && hasChinese(value.value)) {
        items.push({ text: value.value, start: value.start, end: value.end, type: itemType })
      } else if (value.type === 'TemplateLiteral') {
        for (const quasi of value.quasis) {
          if (hasChinese(quasi.value.raw)) {
            items.push({ text: quasi.value.raw, start: quasi.start, end: quasi.end, type: itemType })
          }
        }
      }
    }

    // 无论 key 是否匹配，递归进入嵌套结构
    if (value.type === 'ObjectExpression') {
      extractObjectStrings(value, allowedProps, items, itemType)
    } else if (value.type === 'ArrayExpression') {
      for (const elem of value.elements) {
        if (elem && elem.type === 'ObjectExpression') {
          extractObjectStrings(elem, allowedProps, items, itemType)
        }
      }
    }
  }
}

function findReturnValue(body) {
  if (!body.body) return null
  for (const stmt of body.body) {
    if (stmt.type === 'ReturnStatement' && stmt.argument) {
      return stmt.argument
    }
  }
  return null
}

function isInsideDataReturn(path) {
  let p = path.parentPath
  while (p) {
    if (p.isObjectProperty() && p.node.key && p.node.key.type === 'Identifier' && p.node.key.name === 'data') {
      return true
    }
    if (p.isObjectMethod() && p.node.key && p.node.key.type === 'Identifier' && p.node.key.name === 'data') {
      return true
    }
    p = p.parentPath
  }
  return false
}

function isInsideComputed(path) {
  let p = path
  while (p) {
    if (p.isCallExpression()) {
      const callee = p.node.callee
      if (callee.type === 'Identifier' && callee.name === 'computed') return true
    }
    // Vue 2 computed: computed: { foo() { return ... } }
    if (p.isObjectProperty() || p.isObjectMethod()) {
      let pp = p.parentPath
      while (pp) {
        if (pp.isObjectProperty() && pp.node.key && pp.node.key.type === 'Identifier' && pp.node.key.name === 'computed') {
          return true
        }
        pp = pp.parentPath
      }
    }
    p = p.parentPath
  }
  return false
}

// --- translateMethods helpers ---

function resolveMethod(callee, methods) {
  let parts = []
  if (callee.type === 'Identifier') {
    return null
  } else if (callee.type === 'MemberExpression') {
    parts = getMemberParts(callee)
  } else if (callee.type === 'CallExpression') {
    // (this as any).$message(...) — unwrap TS type assertion
    const inner = callee.callee
    if (inner.type === 'MemberExpression') {
      parts = getMemberParts(inner)
    } else {
      return null
    }
  } else {
    return null
  }

  if (parts.length === 0) return null
  if (parts[0] !== 'this') return null

  const methodPath = parts.slice(1).join('.') // e.g. '$message.success' or '$message'

  // Check wildcard: $message.* matches $message.success, $message.error, etc.
  for (const m of methods) {
    if (m.endsWith('.*')) {
      const prefix = m.slice(0, -2)
      if (methodPath.startsWith(prefix + '.')) {
        return { mode: 'args' }
      }
    }
  }

  // Check exact match
  if (methods.includes(methodPath)) {
    // message-like methods ($message, $$message) → object mode
    // others ($confirm) → args mode
    const baseName = parts[parts.length - 1]
    if (baseName.toLowerCase().includes('message')) {
      return { mode: 'object' }
    }
    return { mode: 'args' }
  }

  return null
}

function getMemberParts(node) {
  const parts = []
  if (node.type === 'Identifier') {
    parts.push(node.name)
  } else if (node.type === 'ThisExpression') {
    parts.push('this')
  } else if (node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion') {
    // (this as any) — unwrap type assertion
    const inner = getMemberParts(node.expression)
    parts.push(...inner)
  } else if (node.type === 'MemberExpression') {
    const objParts = getMemberParts(node.object)
    parts.push(...objParts)
    if (node.property.type === 'Identifier') {
      parts.push(node.property.name)
    }
  }
  return parts
}
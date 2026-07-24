# Script 解析：方法参数黑名单转白名单 + 成员赋值跳过 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `ignoreMethods`（黑名单）反转为 `translateMethods`（白名单），并新增成员表达式赋值跳过规则。

**Architecture:** 改动集中在 `script-parser.cjs` 的两个判断函数（`isIgnoredMethodArg` → `isTranslatableMethodArg`，新增 `isMemberAssignmentTarget`），其余文件做字段名同步替换。核心解析/替换模块不变。

**Tech Stack:** Node.js CommonJS，@babel/parser + @babel/traverse

---

### Task 1: 修改 script-parser.cjs — 核心逻辑

**Files:**
- Modify: `scripts/i18n-scan/parsers/script-parser.cjs`

- [ ] **Step 1: 将 `isIgnoredMethodArg` 改为 `isTranslatableMethodArg`（白名单 + 通配符匹配）**

定位到 `isIgnoredMethodArg` 函数（约第 198 行），替换为以下实现：

```js
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
```

- [ ] **Step 2: 新增 `isMemberAssignmentTarget` 函数**

在 `isInConditionalExpression` 函数之后（约第 229 行之后）插入：

```js
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
```

- [ ] **Step 3: 修改 `StringLiteral` 访问器，调用新函数**

在 `StringLiteral` 访问器中（约第 40-73 行），将：

```js
// 跳过 ignoreMethods 中的方法调用参数
if (isIgnoredMethodArg(path, ignoreMethods)) return
```

替换为：

```js
// 跳过成员表达式赋值（form.status = '中文'）
if (isMemberAssignmentTarget(path)) return

// 函数调用参数：不在白名单则跳过
if (isInCallExpression(path) && !isTranslatableMethodArg(path, translateMethods)) return
```

同时需要新增 `isInCallExpression` 辅助函数（因为原来的 `isIgnoredMethodArg` 内部做了 parent 类型判断，现在需要拆开）：

```js
/**
 * 判断字符串是否在函数调用表达式中作为参数
 */
function isInCallExpression(path) {
  return path.parent.type === 'CallExpression'
}
```

- [ ] **Step 4: 修改 `TemplateLiteral` 访问器中的 `isIgnoredMethodArg` 调用**

在 `TemplateLiteral` 访问器中（约第 106 行），将：

```js
if (isIgnoredMethodArg(path, ignoreMethods)) return
```

替换为：

```js
if (isInCallExpression(path) && !isTranslatableMethodArg(path, translateMethods)) return
```

- [ ] **Step 5: 修改函数签名和参数名**

将 `parseScript` 函数签名（约第 17 行）从：

```js
function parseScript(code, ignoreMethods, scriptStartLine) {
```

改为：

```js
function parseScript(code, translateMethods, scriptStartLine) {
```

- [ ] **Step 6: 验证 script-parser.cjs 语法正确**

```bash
node -e "require('./scripts/i18n-scan/parsers/script-parser.cjs')" && echo "OK"
```

Expected: `OK`（无语法错误）

- [ ] **Step 7: Commit**

```bash
git add scripts/i18n-scan/parsers/script-parser.cjs
git commit -m "feat: flip ignoreMethods blacklist to translateMethods whitelist, add member-assignment skip

- Replace isIgnoredMethodArg with isTranslatableMethodArg (whitelist + wildcard)
- Add isMemberAssignmentTarget to skip form.status = '中文' patterns
- Add isInCallExpression helper
- Update parseScript signature: ignoreMethods → translateMethods

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: 修改 vue-sfc-parser.cjs — 传参同步

**Files:**
- Modify: `scripts/i18n-scan/parsers/vue-sfc-parser.cjs`

- [ ] **Step 1: 更新 JSDoc 注释和调用传参**

将第 18 行的 JSDoc：

```js
 * @param {string[]} config.ignoreMethods - 方法黑名单
```

改为：

```js
 * @param {string[]} config.translateMethods - 方法白名单
```

将第 87 行的调用：

```js
const scriptResults = parseScript(
  scriptSource,
  config.ignoreMethods,
  scriptStartLine
)
```

改为：

```js
const scriptResults = parseScript(
  scriptSource,
  config.translateMethods,
  scriptStartLine
)
```

- [ ] **Step 2: Commit**

```bash
git add scripts/i18n-scan/parsers/vue-sfc-parser.cjs
git commit -m "chore: update vue-sfc-parser to pass translateMethods instead of ignoreMethods

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: 修改 index.cjs — 默认值字段替换

**Files:**
- Modify: `scripts/i18n-scan/index.cjs`

- [ ] **Step 1: 修改 `normalizeConfig` 中的默认值**

将第 83 行：

```js
ignoreMethods: config.ignoreMethods || [],
```

改为：

```js
translateMethods: config.translateMethods || [
  'ElMessage.*',
  'ElMessageBox.*',
  'ElNotification.*',
  'alert',
  'confirm',
],
```

- [ ] **Step 2: Commit**

```bash
git add scripts/i18n-scan/index.cjs
git commit -m "chore: replace ignoreMethods default with translateMethods whitelist in index.cjs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: 修改 setup.cjs — 配置向导同步

**Files:**
- Modify: `scripts/i18n-scan/setup.cjs`

- [ ] **Step 1: 替换 `DEFAULT_IGNORE_METHODS` 为 `DEFAULT_TRANSLATE_METHODS`**

将第 600-610 行：

```js
const DEFAULT_IGNORE_METHODS = [
  "console.log",
  "console.error",
  "console.warn",
  "console.info",
  "openTag",
  "indexOf",
  "includes",
  "split",
  "toString",
];
```

替换为：

```js
const DEFAULT_TRANSLATE_METHODS = [
  "ElMessage.*",
  "ElMessageBox.*",
  "ElNotification.*",
  "alert",
  "confirm",
];
```

- [ ] **Step 2: 修改 `MAIN_ITEMS` 中的配置项定义**

将第 783-789 行：

```js
  {
    key: "ignoreMethods",
    title: "跳过的方法字符串参数",
    description: "这些方法调用中的字符串参数不翻译",
    type: "editableList",
    default: DEFAULT_IGNORE_METHODS,
  },
```

替换为：

```js
  {
    key: "translateMethods",
    title: "需要翻译的方法调用",
    description: "只有这些方法调用中的字符串参数会被翻译（支持通配符如 ElMessage.*）",
    type: "editableList",
    default: DEFAULT_TRANSLATE_METHODS,
  },
```

- [ ] **Step 3: 修改 `writeConfig` 中的序列化**

将第 970-971 行：

```js
  nested.ignoreMethods = ensureArray(
    nested.ignoreMethods || DEFAULT_IGNORE_METHODS,
  );
```

替换为：

```js
  nested.translateMethods = ensureArray(
    nested.translateMethods || DEFAULT_TRANSLATE_METHODS,
  );
```

将第 1012-1013 行：

```js
  lines.push("  // 跳过这些方法的字符串参数");
  lines.push(`  ignoreMethods: ${JSON.stringify(nested.ignoreMethods)},`);
```

替换为：

```js
  lines.push("  // 需要翻译的方法调用（白名单，支持通配符如 ElMessage.*）");
  lines.push(`  translateMethods: ${JSON.stringify(nested.translateMethods)},`);
```

- [ ] **Step 4: 修改配置摘要打印**

将第 1299-1304 行：

```js
    [
      "忽略方法",
      Array.isArray(config.ignoreMethods)
        ? `${config.ignoreMethods.length} 项`
        : "(无)",
    ],
```

替换为：

```js
    [
      "翻译方法",
      Array.isArray(config.translateMethods)
        ? `${config.translateMethods.length} 项`
        : "(无)",
    ],
```

- [ ] **Step 5: Commit**

```bash
git add scripts/i18n-scan/setup.cjs
git commit -m "chore: update setup.cjs config wizard for translateMethods whitelist

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: 修改示例配置文件

**Files:**
- Modify: `i18n.config copy.js`

- [ ] **Step 1: 替换 `ignoreMethods` 为 `translateMethods`**

将第 30-31 行：

```js
  // 跳过这些方法的字符串参数
  ignoreMethods: ["console.log","console.error","console.warn","console.info","openTag","indexOf","includes","split","toString"],
```

替换为：

```js
  // 需要翻译的方法调用（白名单，支持通配符如 ElMessage.*）
  translateMethods: ["ElMessage.*","ElMessageBox.*","ElNotification.*","alert","confirm"],
```

- [ ] **Step 2: Commit**

```bash
git add "i18n.config copy.js"
git commit -m "chore: update example config with translateMethods whitelist

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: 更新文档

**Files:**
- Modify: `CLAUDE.md`
- Modify: `md/i18n-parse-summary.md`
- Modify: `md/i18n脚本使用指南.md`
- Modify: `md/PLAN.md`
- Modify: `md/DESIGN-setup.md`
- Modify: `scripts/i18n-scan/README.md`

- [ ] **Step 1: 更新 CLAUDE.md**

找到 `ignoreMethods` 相关描述（约第 55-56 行附近），将：

```
- `ignoreMethods` — 跳过的方法调用参数（如 console.log, includes）
```

改为：

```
- `translateMethods` — 需要翻译的方法调用白名单（支持通配符如 ElMessage.*），函数调用参数默认跳过
```

- [ ] **Step 2: 更新 md/i18n-parse-summary.md**

将第 274 行：

```
| ignoreMethods 方法参数 | `console.log('调试信息')` | `isIgnoredMethodArg()` 返回 true |
```

改为：

```
| 不在 translateMethods 白名单的方法参数 | `fn('调试信息')` | `isTranslatableMethodArg()` 返回 false |
```

将第 275 行：

```
| ignoreMethods 仅方法名 | `'abc'.includes('中')` | 支持仅方法名匹配 |
```

改为：

```
| 成员表达式赋值 | `form.status = '已通过'` | `isMemberAssignmentTarget()` 返回 true |
```

将第 352-360 行的待优化项表格中"数据值被误翻译"行标记为已解决，并更新"ignoreMethods 不支持通配"行标记为已解决。

- [ ] **Step 3: 更新 md/i18n脚本使用指南.md**

将配置示例中的：

```js
  // 跳过这些方法的字符串参数（不翻译）
  ignoreMethods: [
    'console.log', 'console.error', 'console.warn', 'console.info',
    'openTag', 'indexOf', 'includes', 'split', 'toString',
  ],
```

替换为：

```js
  // 需要翻译的方法调用（白名单，支持通配符如 ElMessage.*）
  translateMethods: [
    'ElMessage.*', 'ElMessageBox.*', 'ElNotification.*', 'alert', 'confirm',
  ],
```

- [ ] **Step 4: 更新 md/PLAN.md**

将配置项表格中 `ignoreMethods` 行替换为 `translateMethods` 行，说明改为"需要翻译的方法调用白名单"。

- [ ] **Step 5: 更新 md/DESIGN-setup.md**

将"不询问项"表格中 `ignoreMethods` 行替换为 `translateMethods` 行。

- [ ] **Step 6: 更新 scripts/i18n-scan/README.md**

将配置说明中 `ignoreMethods` 相关内容替换为 `translateMethods`。

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md md/i18n-parse-summary.md "md/i18n脚本使用指南.md" md/PLAN.md md/DESIGN-setup.md scripts/i18n-scan/README.md
git commit -m "docs: update all docs for ignoreMethods → translateMethods rename

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: 重新打包 toI18n.cjs

**Files:**
- Modify: `toI18n.cjs`（通过 build 脚本生成）

- [ ] **Step 1: 运行打包**

```bash
npm run build
```

Expected: 输出 `✓ 打包完成: .../toI18n.cjs` 及文件大小，无错误。

- [ ] **Step 2: 验证打包产物可加载**

```bash
node -e "require('./toI18n.cjs')" && echo "OK"
```

Expected: `OK`（无语法/加载错误）

- [ ] **Step 3: Commit**

```bash
git add toI18n.cjs
git commit -m "build: regenerate toI18n.cjs with translateMethods whitelist

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: 功能验证

- [ ] **Step 1: 验证 dry-run 模式正常运行**

```bash
node scripts/i18n-scan/index.cjs --dry-run 2>&1 | head -30
```

Expected: 正常输出扫描结果，无报错。

- [ ] **Step 2: 验证 gap 模式正常运行**

```bash
node scripts/i18n-scan/index.cjs --gap 2>&1 | head -30
```

Expected: 正常输出盲区扫描结果，无报错。

- [ ] **Step 3: 验证打包后的 toI18n.cjs 同样可用**

```bash
node toI18n.cjs --dry-run 2>&1 | head -30
```

Expected: 与 Step 1 输出一致。
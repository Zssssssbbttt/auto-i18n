# Script 解析：方法参数黑名单转白名单 + 成员赋值跳过 — 设计

## 背景

`scripts/i18n-scan/parsers/script-parser.cjs` 当前对函数调用参数中的中文字符串采用**黑名单**策略（`ignoreMethods`）：默认全部翻译，只有配置里列出的方法（如 `console.log`）才跳过。这带来两个问题：

1. 大量业务函数调用（`fn('中文')`、工具函数、组件方法）的字符串参数本意不明确，是否该翻译无法从语法层面判断，默认翻译容易误翻数据值或未预期的调用。
2. `form.status = '已通过'` 这类**赋值给对象属性**的字符串，语义上大概率是提交给后端的数据值（不是展示文本），但当前逻辑把它当普通 `StringLiteral` 处理，会被误翻译。

工具仍在开发阶段，尚未上线，无需兼容旧配置字段，可直接替换字段名和默认行为。

## 变更内容

### 变更一：`ignoreMethods`（黑名单）→ `translateMethods`（白名单）

- 删除配置项 `ignoreMethods`。
- 新增配置项 `translateMethods`：数组，列出"参数中的中文才翻译"的方法调用。
- 默认行为反转：**函数调用参数默认跳过**，只有方法名匹配 `translateMethods` 才翻译其字符串参数。
- 匹配规则：
  - 仅支持**完整调用链匹配**，如 `'ElMessage.warning'`、`'alert'`。不支持"仅方法名匹配"（旧逻辑中 `'includes'` 会匹配任意对象的 `.includes()`，本次不保留）。
  - 支持通配符 `*`，如 `'ElMessage.*'` 匹配 `ElMessage.success`、`ElMessage.warning`、`ElMessage.error` 等该对象下的所有方法。
- 用户未配置 `translateMethods` 时，脚本内置默认值：
  ```js
  ['ElMessage.*', 'ElMessageBox.*', 'ElNotification.*', 'alert', 'confirm']
  ```
- 不在白名单里的函数调用参数（如 `fn('中文')`、自定义工具函数、组件方法调用），一律跳过，不参与扫描分类。

### 变更二：成员表达式赋值跳过

- 新增判断：字符串字面量的直接父节点是 `AssignmentExpression`，且该赋值表达式的 `left` 是 `MemberExpression`（形如 `obj.prop = ...`、`this.a.b = ...`）时，该字符串跳过，不翻译。
- 仅限成员表达式赋值。以下场景**不受影响**，继续翻译：
  - 变量声明/赋值：`const status = '已通过'`、`let msg = '加载失败'`
  - 对象字面量属性值：`{ status: '已通过' }`（本轮不处理，行为不变）

### 两条规则的判断依据

字符串字面量节点的直接父节点类型不同，可无歧义区分：

| 场景 | 示例 | `parent.type` | 处理 |
|---|---|---|---|
| 变量声明赋值 | `const msg = '加载失败'` | `VariableDeclarator` | 不受影响，继续翻译 |
| 函数调用参数 | `fn('中文')` / `ElMessage.warning('中文')` | `CallExpression` | 按 `translateMethods` 白名单判断 |
| 成员表达式赋值 | `form.status = '已通过'` | `AssignmentExpression`（`left.type === 'MemberExpression'`） | 跳过 |
| 对象字面量属性值 | `{ label: '请输入' }` | `ObjectProperty` | 不受影响（现状不变） |

两条规则各自基于不同的 `parent.type` 判断，互不冲突，不存在重叠场景。

## 涉及文件

| 文件 | 改动内容 |
|---|---|
| `scripts/i18n-scan/parsers/script-parser.cjs` | 核心逻辑：`isIgnoredMethodArg` 改为 `isTranslatableMethodArg`（白名单 + 通配符匹配，仅完整链），新增 `isMemberAssignmentTarget` 判断，在 `StringLiteral` 访问器中调用并跳过 |
| `scripts/i18n-scan/parsers/vue-sfc-parser.cjs` | 调用 `parseScript` 时传参从 `config.ignoreMethods` 改为 `config.translateMethods` |
| `scripts/i18n-scan/index.cjs` | `normalizeConfig()` 中默认值字段从 `ignoreMethods: config.ignoreMethods || []` 改为 `translateMethods: config.translateMethods || [默认值]` |
| `scripts/i18n-scan/setup.cjs` | `DEFAULT_IGNORE_METHODS` 改为 `DEFAULT_TRANSLATE_METHODS`（新默认值列表）；配置向导条目（`MAIN_ITEMS` 中 key/title/description）；`writeConfig()` 序列化字段名；配置摘要打印字段名 |
| `i18n.config copy.js` | 示例配置文件同步：删除 `ignoreMethods`，新增 `translateMethods` |
| `CLAUDE.md` | 配置项说明表格同步更新 |
| `md/i18n-parse-summary.md` | Script 部分"当前会跳过的情况"表格、"待优化项"表格同步更新（该文档记录的问题本次已解决，标注或更新对应条目） |
| `md/i18n脚本使用指南.md` | 配置文件示例中的 `ignoreMethods` 字段替换 |
| `md/PLAN.md` | 提及 `ignoreMethods` 的配置项说明表格同步 |
| `md/DESIGN-setup.md` | 配置项定义表格中 `ignoreMethods` 相关描述同步 |
| `scripts/i18n-scan/README.md` | 配置说明同步 |
| `toI18n.cjs` | 打包产物，源码改完后用 `npm run build`（`scripts/i18n-scan/build.cjs`）重新生成，不手动编辑 |

## 不受影响的部分

- Template 侧解析逻辑（`template-parser.cjs`）不变，`ignoreAttributes` / `translateAttributes` 属性白黑名单机制不变。
- 三元表达式内跳过（`isInConditionalExpression`）、模板字符串插值标记为特殊（`special-template-literal`）、字符串拼接标记为特殊（`special-string-concat`）的现有逻辑均不变。
- 对象字面量属性值（`{ status: '中文' }`）本轮不处理，继续按现状翻译。
- `import/export` 跳过、TS 类型注解跳过等既有规则不变。

## 验证方式

1. 单测/手动构造覆盖以下场景，确认扫描分类结果符合预期：
   - `fn('中文')` → 跳过（不在白名单）
   - `ElMessage.warning('中文')` → 翻译（默认白名单命中 `ElMessage.*`）
   - `console.log('中文')` → 跳过（不在白名单，且原黑名单字段已废弃）
   - `alert('中文')` → 翻译（默认白名单）
   - `form.status = '已通过'` → 跳过（成员表达式赋值）
   - `const status = '已通过'` → 翻译（变量声明不受影响）
   - `{ label: '请输入' }` → 翻译（对象属性值不受影响，现状不变）
   - 用户在 `i18n.config.js` 自定义 `translateMethods: ['MyUtil.showTip']` → 翻译 `MyUtil.showTip('中文')`
2. 运行 `npm run i18n:dry` 对现有测试项目扫描，确认分类结果符合新规则，且未出现异常报错。
3. 运行 `npm run build` 重新打包 `toI18n.cjs`，确认打包无警告。

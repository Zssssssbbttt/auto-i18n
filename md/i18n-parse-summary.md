# i18n 脚本 — Template & Script 解析总结

## 目录

- [Template 解析](#template-解析)
  - [当前会匹配的情况](#template-当前会匹配的情况)
  - [当前不会匹配的情况](#template-当前不会匹配的情况)
  - [需要注意的问题](#template-需要注意的问题)
  - [待优化项](#template-待优化项)
- [Script 解析](#script-解析)
  - [当前会匹配的情况](#script-当前会匹配的情况)
  - [当前会跳过的情况](#script-当前会跳过的情况)
  - [需要注意的问题](#script-需要注意的问题)
  - [待优化项](#script-待优化项)
- [通用问题：数据值 vs 展示文本](#通用问题数据值-vs-展示文本)

---

## Template 解析

> 代码位置：`scripts/i18n-scan/parsers/template-parser.cjs`
> 依赖：`@vue/compiler-dom` 解析 AST，`utils/chinese-detector.cjs` 检测中文

### Template 当前会匹配的情况

#### 1. 静态属性 → `static-attr`

属性名在 `translateAttributes` 白名单中，且不在 `ignoreAttributes` 黑名单中。

```html
<!-- 替换前 -->
<el-input label="申请人" placeholder="请输入姓名" title="删除操作" />
<a alt="返回首页" />

<!-- 替换后 -->
<el-input :label="$t('common.applicant')" :placeholder="$t('common.pleaseEnterName')" :title="$t('common.delete')" />
<a :alt="$t('common.backHome')" />
```

替换规则：`attrName="中文"` → `:attrName="$t('key')"`（静态属性变为动态绑定）

#### 2. 动态属性 → `dynamic-attr`

`:attrName` 或 `v-bind:attrName`，属性名在白名单中，表达式内包含中文字符串。

```html
<!-- 替换前 -->
<el-select :placeholder="status === 1 ? '已通过' : '待审核'" />
<el-input :label="'搜索关键字'" />

<!-- 替换后 -->
<el-select :placeholder="status === 1 ? $t('common.passed') : $t('common.pending')" />
<el-input :label="$t('common.searchKeyword')" />
```

替换规则：表达式中的 `'中文'` → `$t('key')`

#### 3. 文本内容 → `text-content`

HTML 标签之间的纯文本节点，包含中文。

```html
<!-- 替换前 -->
<span>确认删除</span>
<el-button>提交</el-button>
<div>共 10 条记录</div>

<!-- 替换后 -->
<span>{{ $t('common.confirmDelete') }}</span>
<el-button>{{ $t('common.submit') }}</el-button>
<div>{{ $t('common.totalRecords') }}</div>
```

替换规则：`中文文本` → `{{ $t('key') }}`

#### 4. 插值表达式 → `interpolation`

`{{ }}` 中包含中文字符串，且不是已有的 `$t()` 调用。

```html
<!-- 替换前 -->
<span>{{ status === 1 ? '启用' : '禁用' }}</span>
<span>{{ '加载中' }}</span>

<!-- 替换后 -->
<span>{{ status === 1 ? $t('common.enable') : $t('common.disable') }}</span>
<span>{{ $t('common.loading') }}</span>
```

替换规则：`{{ }}` 内的 `'中文'` → `$t('key')`

---

### Template 当前不会匹配的情况

| 情况 | 示例 | 原因 |
|------|------|------|
| 黑名单属性 | `<div class="中文类名">` | `class` 在 `ignoreAttributes` 中 |
| 不在白名单的属性 | `<span :id="'中文'">` | `id` 不在 `translateAttributes` 中 |
| 已是 `$t()` 调用 | `{{ $t('already.translated') }}` | `isAlreadyTranslated()` 返回 true |
| 事件绑定 | `@click="handle('中文')"` | 指令名不是 `bind`，无法确定属性名 |
| 控制流指令 | `v-if="status === '已通过'"` | 指令名不是 `bind` |
| `v-model` | `v-model="form.name"` | 指令名不是 `bind` |
| HTML 注释 | `<!-- 中文注释 -->` | `NODE_TYPE.COMMENT` 直接跳过 |
| 无中文的文本 | `<span>OK</span>` | `hasChinese()` 返回 false |

---

### Template 需要注意的问题

#### 1. 属性名相同但语义因组件而异（高风险）

同一个属性名在不同组件上含义不同：

| 组件 | 属性 | 语义 | 该不该翻译 |
|------|------|------|-----------|
| `el-input` | `label="申请人"` | 展示文本 | 应该 |
| `el-radio` | `label="已通过"` | 提交给后端的值 | **不该** |
| `el-checkbox` | `label="已通过"` | 提交给后端的值 | **不该** |
| `el-form-item` | `label="用户名"` | 展示文本 | 应该 |
| `el-table-column` | `label="姓名"` | 表头展示 | 应该 |

当前工具只看属性名，不区分组件标签名。`label` 在 `el-radio` 上会被误翻译，导致提交给后端的数据出错。

**建议**：引入 `组件.属性` 级别的精确配置，如 `!el-radio.label` 排除特定组件的属性。

#### 2. 模板字符串含变量插值未标记为特殊（高风险）

```html
:label="`共${total}条记录`"
```

当前 `extractChineseFromExpression` 会提取静态部分 `共条记录` 当作普通文本处理，而不是像 script 解析器那样标记为 `special-template-literal`。翻译后变量丢失。

#### 3. 字符串拼接未标记为特殊（中风险）

```html
:label="'共' + total + '条'"
```

当前正则分别提取 `'共'` 和 `'条'` 为两个独立项，各自替换为 `$t()`。翻译后拼接结果大概率不通顺。应该像 script 解析器一样标记为 `special-string-concat`。

#### 4. `v-text` / `v-html` 未处理（低风险）

```html
<span v-text="'加载中'" />
<div v-html="'<b>重要提示</b>'" />
```

指令名不是 `bind`，直接跳过。但这些指令的值确实包含展示文本。

#### 5. `v-bind` 无参数（对象展开）未处理（低风险）

```html
<div v-bind="{ title: '中文标题', placeholder: '请输入' }" />
```

`prop.arg` 为 `undefined`，`attrName` 为 `null`，整条跳过。对象内部的中文字符串被遗漏。

#### 6. 嵌套引号匹配可能错位（低风险）

```html
:label="message === '成功' ? '已处理' : '未处理'"
```

正则 `/(['"])((?:(?!\1).)*?)\1/g` 遇到嵌套同种引号时可能匹配错位。

#### 7. 转义引号（低风险）

```html
:label="'It\'s ok'"
```

正则遇到 `\'` 会提前截断。

#### 8. `<pre>` / `<code>` 中的中文（低风险）

```html
<pre>请执行 npm install 命令</pre>
<code>const 名称 = '值'</code>
```

代码块中的中文通常不应翻译，当前会无差别提取。

#### 9. 纯模板组件 `$t` 注入失败（低风险）

如果 `.vue` 文件只有 `<template>` 没有 `<script>`，`replacer.cjs` 的 `injectImportT()` 找不到 `<script>` 标签，`$t` 未定义导致运行时错误。

#### 10. 自定义组件属性名无法穷举（中风险）

```html
<MyTable empty-text="暂无数据" confirm-text="确认删除" no-data-tip="暂无记录" />
```

`empty-text`、`confirm-text`、`no-data-tip` 等第三方组件属性不在默认白名单中，会被静默跳过。

---

### Template 待优化项

| 优先级 | 问题 | 建议方案 |
|--------|------|----------|
| **高** | 模板字符串含变量插值未标记为特殊 | 对齐 script 解析器逻辑，标记为 `special-template-literal` |
| **高** | 字符串拼接未标记为特殊 | 对齐 script 解析器逻辑，标记为 `special-string-concat` |
| **高** | 属性名相同但组件语义不同 | 支持 `组件.属性` 级别配置，如 `!el-radio.label` |
| **中** | `v-text` / `v-html` 未处理 | 增加对 `text` 和 `html` 指令的处理 |
| **中** | `v-bind` 无参数对象展开 | 递归解析对象内的字符串 |
| **中** | 自定义组件属性名无法穷举 | 支持通配符 `*-text`、`*-tip`，或提供"翻译所有属性"开关 |
| **低** | 嵌套引号匹配错位 | 改用 AST 方式提取表达式中的字符串 |
| **低** | `<pre>` / `<code>` 误翻译 | 增加元素黑名单配置 |
| **低** | 纯模板组件 `$t` 注入失败 | 检测无 `<script>` 时自动创建 `<script setup>` |

---

## Script 解析

> 代码位置：`scripts/i18n-scan/parsers/script-parser.cjs`
> 依赖：`@babel/parser` + `@babel/traverse` 解析 AST，`utils/chinese-detector.cjs` 检测中文

### Script 当前会匹配的情况

#### 1. 普通字符串字面量 → `script-string`（替换）

```js
const msg = '加载失败'                    // → $t('common.loadFailed')
const title = "确认删除"                   // → $t('common.confirmDelete')
const obj = { label: '请输入名称' }        // → $t('common.pleaseEnterName')
const arr = ['启用', '禁用']               // → 两条 $t()
fn('参数中的中文')                         // → $t('common.chineseInParam')
```

#### 2. 无插值的模板字符串 → `script-string`（替换）

```js
const msg = `确认删除该记录吗？`           // → $t('common.confirmDelete')
```

#### 3. 含变量插值的模板字符串 → `special-template-literal`（跳过）

```js
const msg = `共${total}条记录`             // → 标记为特殊，不替换
const tip = `用户${name}已登录`            // → 标记为特殊，不替换
```

#### 4. 字符串拼接 → `special-string-concat`（跳过）

```js
const msg = '共' + total + '条'            // → 标记为特殊，不替换
const tip = '用户' + name + '已登录'       // → 标记为特殊，不替换
```

#### 5. 三元表达式中的中文

```js
const text = status === 1 ? '已通过' : '待审核'
// → 两个分支各自替换为 $t()
const text = status === 1 ? $t('common.passed') : $t('common.pending')
```

#### 6. 数组方法回调中的中文

```js
const labels = items.map(item => item.status === 1 ? '启用' : '禁用')
// → 正常提取替换
```

---

### Script 当前会跳过的情况

| 情况 | 示例 | 原因 |
|------|------|------|
| import/export 声明 | `import { ref } from 'vue'` | `isInImport()` 返回 true |
| ignoreMethods 方法参数 | `console.log('调试信息')` | `isIgnoredMethodArg()` 返回 true |
| ignoreMethods 仅方法名 | `'abc'.includes('中')` | 支持仅方法名匹配 |
| 对象 key | `{ '中文键名': 'value' }` | `ObjectProperty` 且 `key === node` |
| TS 类型注解 | `type Status = '已通过' \| '未通过'` | `TSLiteralType` 跳过 |
| 无中文的字符串 | `const key = 'hello'` | `hasChinese()` 返回 false |

---

### Script 需要注意的问题

#### 1. 数据值 vs 展示文本无法自动区分（高风险）

工具无法判断一个中文字符串最终是展示给用户还是提交给后端：

```js
// 展示文本 → 应该翻译
const tip = '加载失败'
ElMessage.warning('请先选择数据')

// 数据值 → 绝对不能翻译
form.status = '已通过'
form.type = '收入'
const params = { category: '办公用品', source: '手动录入' }
this.searchForm.auditStatus = '待审核'
```

从 AST 角度看两者完全一样——都是 `StringLiteral` 节点。工具没有后端接口 schema，无法自动区分。

**规避方案**：

| 方案 | 成本 | 安全性 | 说明 |
|------|------|--------|------|
| `ignoreAssignments` 配置 | 中（改工具） | 高 | 指定哪些变量路径的赋值不翻译 |
| `dataProperties` 配置 | 低（改工具） | 中 | 标记哪些属性名是数据属性 |
| `// i18n-ignore` 注释 | 低（改工具） | 高 | 单行跳过标记 |
| 代码规范（枚举分离） | 高（改项目） | 最高 | 数据值用英文 key，展示用 `$t()` |
| dry-run 人工审核 | 低 | 取决于人 | 预览后逐条确认 |

#### 2. 嵌套拼接中的中文被漏掉（中风险）

```js
const msg = '共' + total + '条' + suffix
// '共' 被提取 ✓
// '条' 在嵌套 BinaryExpression 中，被漏掉 ✗
```

当前只检查 `BinaryExpression` 的直接左右操作数，不递归遍历拼接链。

#### 3. `$t()` 调用中的中文可能被二次替换（中风险）

```js
const key = $t('确认')  // key 本身含中文
// '确认' 被提取 → 替换为 $t($t('common.confirm'))
```

应该在提取前检查是否已在 `$t()` 调用中。

#### 4. JSX 中的中文被漏掉（低风险）

```jsx
const el = <span>中文文本</span>
const el = <Input placeholder="请输入" />
```

`JSXText` 和 `JSXAttribute` 不是 `StringLiteral`，会被漏掉。Vue 项目中 JSX 使用较少。

#### 5. ignoreMethods 不支持通配符（低风险）

```js
ElMessage.error('操作失败')
ElMessage.success('保存成功')
ElNotification.warning('请注意')
```

需要逐个添加 `ElMessage.error`、`ElMessage.success` 等。如果支持 `ElMessage.*`，一条规则覆盖所有。

---

### Script 待优化项

| 优先级 | 问题 | 建议方案 |
|--------|------|----------|
| **高** | 数据值被误翻译 | 新增 `ignoreAssignments` 配置 + `// i18n-ignore` 注释支持 |
| **中** | 嵌套拼接漏提取 | 递归遍历 BinaryExpression 拼接链 |
| **中** | `$t()` 内中文二次替换 | 检查是否在 `$t()` 调用中 |
| **低** | JSX 中文漏掉 | 增加 JSXText / JSXAttribute 处理 |
| **低** | ignoreMethods 不支持通配 | 支持 `ElMessage.*` 通配符 |

---

## 通用问题：数据值 vs 展示文本

这是整个工具最核心的风险点。**Template 和 Script 都存在这个问题**：

**Template 侧**：`el-radio` 的 `label` 属性是提交值，`el-input` 的 `label` 是展示文本，但工具只看属性名。

**Script 侧**：`form.status = '已通过'` 是提交值，`const tip = '加载失败'` 是展示文本，但工具只看字符串字面量。

**根本原因**：工具没有后端接口 schema，无法判断值的最终用途。

**建议的防御层次**：

1. **工具层**：增加 `ignoreAssignments` 配置 + `组件.属性` 精确配置 + `// i18n-ignore` 注释
2. **流程层**：dry-run 预览 → 人工审核 → 确认替换
3. **规范层**：推动数据值和展示文本分离，数据值用英文常量，展示文本用 `$t()`
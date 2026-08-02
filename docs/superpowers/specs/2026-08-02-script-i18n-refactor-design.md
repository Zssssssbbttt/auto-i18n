# Script 标签国际化重构 — 一期设计

## 概述

重构 `<script>` 标签和 `.ts`/`.js` 文件的中文国际化处理，从"布尔开关一刀切"改为"用户精确配置变量名 + 属性名白名单"的**正向匹配**模式。

---

## 一、配置变更

### 删除

- `scanScriptDeclarations` — 布尔开关，语义模糊，一刀切

### 保留

- `scanScript` — 总开关
- `translateMethods` — 方法调用白名单，已有逻辑不变

### 新增

```js
// i18n.config.js
{
  entry: ["src/**/*.vue", "src/**/*.ts", "src/**/*.js"],  // 扩展 .ts/.js

  scanScript: true,  // 开启后，对话中才出现以下两项

  // script 翻译目标变量
  // key = 变量名，value = 要翻译的属性名数组
  // [] 表示该变量内所有中文都翻译（无论嵌套层级）
  scriptTargets: {
    columns: ['label', 'title'],
    rules: ['message'],
    options: ['label', 'text'],
    columns: ['label', 'title'],
  },

  // 响应式包裹（默认 false）
  // true: scriptTargets 中 const 声明的变量包裹为 computed(() => ...)
  scriptReactive: false,
}
```

---

## 二、完整场景矩阵

### 变量声明场景（`value: []` 全量翻译时生效）

| # | 场景 | 示例 | 替换后 |
|---|------|------|--------|
| 1 | 变量 + 纯字符串 | `const label = '中文'` | `const label = $t('key')` |
| 2 | 变量 + 模板插值 | `` const label = `共${n}条` `` | `` const label = `${$t('k1')}${n}${$t('k2')}` `` |
| 3 | 变量 + 拼接 | `const label = '共' + n + '条'` | `const label = $t('k1') + n + $t('k2')` |
| 4 | 变量 + 三元 | `const label = cond ? '是' : '否'` | `const label = cond ? $t('k1') : $t('k2')` |

### 对象属性场景（`value: ['label']` 精确匹配时生效）

| # | 场景 | 示例 | 替换后 |
|---|------|------|--------|
| 5 | 对象 + 纯字符串 | `{ label: '中文' }` | `{ label: $t('key') }` |
| 6 | 对象 + 模板插值 | `` { label: `共${n}条` } `` | `` { label: `${$t('k1')}${n}${$t('k2')}` } `` |
| 7 | 对象 + 拼接 | `{ label: '共' + n + '条' }` | `{ label: $t('k1') + n + $t('k2') }` |
| 8 | 对象 + 三元 | `{ label: cond ? '是' : '否' }` | `{ label: cond ? $t('k1') : $t('k2') }` |

### 数组/嵌套场景

| # | 场景 | 示例 |
|---|------|------|
| 9 | 数组 + 纯字符串 | `[{ label: '中文' }]` |
| 10 | 数组 + 模板插值 | `` [{ label: `共${n}条` }] `` |
| 11 | 数组 + 拼接 | `[{ label: '共' + n + '条' }]` |
| 12 | 数组 + 三元 | `[{ label: cond ? '是' : '否' }]` |
| 13 | 深层嵌套 | `{ children: { label: '中文' } }` |
| 14 | 混合嵌套 | `{ items: [{ label: '中文' }] }` |

---

## 三、核心逻辑

### 匹配流程

```
1. 遍历 AST，找到 VariableDeclarator 节点
2. 变量名匹配 scriptTargets 的 key → 不匹配则跳过
3. 检查变量 init 是否为函数调用初始化：
   - 是 ref()/reactive()  → 继续
   - 是其他 CallExpression 或 AwaitExpression → 跳过（接口数据）
4. 递归拍平所有嵌套对象/数组
5. 属性名匹配 value 数组 → 翻译
   - value 为 [] → 全量翻译
6. 根据表达式类型生成替换：
   - StringLiteral → $t('key')
   - TemplateLiteral(with interpolation) → 重建模板字符串
   - BinaryExpression(+) → 逐个替换操作数
   - ConditionalExpression(三元) → 替换两个分支
```

### 上下文感知（一期两项）

```js
// 检查1：Vue 响应式包裹（不跳过）
function isVueReactive(init) {
  if (init.type === 'CallExpression') {
    const name = getCallName(init.callee)
    return name === 'ref' || name === 'reactive'
  }
  return false
}

// 检查2：跳过函数调用初始化（接口数据）
function shouldSkipByInit(init) {
  if (!init) return false
  // ref/reactive 不跳过
  if (isVueReactive(init)) return false
  // 其他 CallExpression 或 AwaitExpression → 跳过
  return init.type === 'CallExpression' || init.type === 'AwaitExpression'
}
```

### 跳过规则（已有，保留）

- `form.x = '中文'`（成员赋值）— 跳过
- import/export 声明中的字符串 — 跳过
- 对象 key — 跳过
- TS 类型注解 — 跳过
- 已有 `$t()` 调用 — 跳过
- 注释、console — 跳过

### 扫描结果条目扩展

为支持 `scriptReactive`，script-parser 返回的结果条目需新增变量元数据字段：

```js
{
  // 原有字段
  line,            // 行号
  chineseText,     // 中文文本
  type,            // 'script-string' | 'template-literal' | ...
  context,         // 上下文源码

  // 新增字段（仅 scriptTargets 匹配的变量声明有此字段）
  varName,         // 所属变量名，如 'columns'
  isConst,         // 是否 const 声明（let 不包裹 computed）
  initStartLine,   // 变量 init 起始行
  initStartCol,    // 变量 init 起始列
  initEndLine,     // 变量 init 结束行
  initEndCol,      // 变量 init 结束列
}
```

这些字段由 script-parser 产出，replacer 消费。replacer 按 `varName` 分组同一变量的所有条目，按 `isConst` + `scriptReactive` 配置决定是否包裹 `computed(() => ...)`。

### 扫描器 TS/JS 文件分支

`scanner.cjs` 需按文件扩展名分流，`.vue` 走 SFC 解析（含 template），`.ts`/`.js` 直接走 script 解析（无 template）：

```js
for (const filePath of files) {
  const source = fs.readFileSync(filePath, 'utf-8')

  if (filePath.endsWith('.vue')) {
    const { results, errors } = parseVueFile(filePath, source, config)
    allResults.push(...results)
  } else if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
    const scriptResults = parseScript(source, config.translateMethods, 0,
      config.scriptTargets)
    scriptResults.forEach(r => { r.file = filePath; r.section = 'script' })
    allResults.push(...scriptResults)
  }
}
```

### shouldSkipByInit 明确说明

**规则：变量 init 为函数调用（且非 ref/reactive）或 AwaitExpression 时，跳过该变量，不翻译其中的中文。**

这是因为此类初始化大概率来自接口返回数据、函数返回值等动态内容，其中的中文字符串不应被静态替换。

```js
// 会跳过（接口数据 / 非响应式函数调用）
const data = fetchData()          // CallExpression
const list = await getList()      // AwaitExpression
const msg = someFunction('中文')  // CallExpression

// 不会跳过（Vue 响应式声明）
const form = ref({ label: '中文' })      // 继续处理
const state = reactive({ title: '中文' }) // 继续处理

// 不会跳过（非函数调用）
const columns = [{ label: '中文' }]      // 继续处理
const label = '中文'                     // 继续处理
```

### Replacer computed 包裹 + import 注入

`scriptReactive: true` 时：
- 对 `isConst: true` 的变量声明，在其 init 表达式外包 `computed(() => ...)`
- 检测是否需要注入 `import { computed } from 'vue'`：
  - 已有 `import { ... computed ... } from 'vue'` → 不注入
  - 无 vue import → 新增 `import { computed } from 'vue'`
  - 有 vue import 但不含 computed → 在已有 import 中追加 `computed`

`scriptReactive: false`（默认）：
- 不包裹 computed，不注入 computed import
- 仅逐行替换中文 → `$t('key')`，注入 `import { $t }`

---

## 四、替换产物

### scriptReactive: false（直接替换）

```ts
// 替换前
export const columns = [
  { label: '姓名', prop: 'name' },
  { label: '年龄', prop: 'age' },
]

// 替换后
import { $t } from '@/locales'
export const columns = [
  { label: $t('common.name'), prop: 'name' },
  { label: $t('common.age'), prop: 'age' },
]
```

### scriptReactive: true（computed 包裹，仅 const）

```ts
// 替换前
export const columns = [
  { label: '姓名', prop: 'name' },
]

// 替换后
import { computed } from 'vue'
import { $t } from '@/locales'
export const columns = computed(() => [
  { label: $t('common.name'), prop: 'name' },
])

// let 变量不包裹，只替换中文
let dynamicCols = [{ label: '姓名' }]
// → let dynamicCols = [{ label: $t('common.name') }]
```

### 复杂表达式替换

```ts
// 三元
// 替换前：{ label: isActive ? '已激活' : '未激活' }
// 替换后：{ label: isActive ? $t('k1') : $t('k2') }

// 模板插值
// 替换前：`共${total}条记录`
// 替换后：`${$t('k1')}${total}${$t('k2')}`

// 字符串拼接
// 替换前：'共' + total + '条记录'
// 替换后：$t('k1') + total + $t('k2')
```

---

## 五、需要改的文件

| 文件 | 改动 |
|------|------|
| `i18n.config.js` | 删 `scanScriptDeclarations`，加 `scriptTargets`、`scriptReactive` |
| `script-parser.cjs` | 重写：删 ~230 行旧逻辑（TemplateLiteral 复杂处理、BinaryExpression 拼接、isInVariableDeclarator 等），新增正向属性匹配 + 上下文感知 + 递归拍平。**扫描结果条目新增变量元数据字段**（见下方） |
| `vue-sfc-parser.cjs` | 透传 `scriptTargets` 给 script parser；`.vue` 文件解析逻辑不变 |
| `replacer.cjs` | 保留 `template-literal` 重建逻辑（维持 parser/replacer 职责分离），新增 `computed` 包裹 + `import` 注入（需区分 const/let） |
| `scanner.cjs` | 扩展 `entry` 支持 `.ts`/`.js` 文件：`.vue` → `parseVueFile`，`.ts`/`.js` → 直接 `parseScript`（不需要 template 解析） |
| `setup.cjs` | 交互对话中增加 `scriptTargets` 和 `scriptReactive` 配置项 |

### script-parser.cjs 核心改动

```js
// 新函数签名
function parseScript(code, translateMethods, scriptStartLine, scriptTargets) {
  // 旧参数 translateMethods 保留，删掉 scanDeclarations 布尔
  // 新增 scriptTargets: { columns: ['label'], rules: ['message'] }
}

// 核心遍历逻辑（伪代码）
traverse(ast, {
  VariableDeclarator(path) {
    const varName = getVariableName(path)
    const target = scriptTargets[varName]
    if (!target) return  // 不在配置中，跳过
    
    // 检查函数调用初始化
    if (shouldSkipByInit(path.node.init)) return
    
    // 全量翻译 or 精确匹配
    if (target.length === 0) {
      // [] → 递归收集该变量内所有中文
      collectAllChinese(path.node.init, results)
    } else {
      // ['label', 'title'] → 递归找对象，属性名匹配则收集
      collectByProperties(path.node.init, target, results)
    }
  }
})
```

---

## 六、不做的（留待二期）

- 反向查找（全局扫描所有对象，不限定变量名）
- 通配符变量名匹配（`*_MAP` 等）
- 跨文件 import 追踪
- 上下文感知的 patterns 正则匹配
- 枚举对象 value 全量翻译（`STATUS_MAP` 模式）
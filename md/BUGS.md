# Bug 修复记录

## 2026-08-12

### translator: 缺口翻译 prompt 未明确指定目标语言

- **现象**：新增语言（如泰语）后运行 `--translate`，缺口补齐（Step 3b）生成的翻译大量缺失，且已有条目值为英文而非目标语言
- **根因**：`callAiApiForGaps` 的 user prompt 只靠 JSON key 中的语言代码（如 `"th"`）暗示目标语言，从未显式告诉 AI 要翻译成什么语言。AI 容易默认输出英文
- **修复**：
  1. 新增 `langToName()` 映射函数（`th` → `泰语`、`en` → `英文` 等）
  2. user prompt 改为 `目标语言：泰语\n\n...请将以下 JSON 中的空字符串替换为泰语的翻译...`
- **文件**：`scripts/i18n-scan/translator.cjs`

### init: toI18n.ts 未在主流 init 中生成

- **现象**：`scripts/i18n-scan/init.cjs` 的 init 流程只生成 `typeToString.ts` 和 `useI18n.ts`，不生成 `toI18n.ts`（仅旧版 `vue2-scan/init.js` 有）
- **修复**：在 `init-vue2.cjs` 和 `init-vue3.cjs` 中添加 `generateToI18n()`，`init.cjs` 中增加 `toI18n.ts` 生成步骤，并在生成的 `index.ts` 中将 `translateText` / `translateArray` 注册到 Vue 原型
- **文件**：`scripts/i18n-scan/init.cjs`、`init/init-vue2.cjs`、`init/init-vue3.cjs`

### toI18n.ts: 反向查找性能差 + console.log 残留

- **现象**：`translateText` 每次调用都完整递归遍历 `zh-CN.json` 对象树，无缓存；生产环境打印 debug 日志
- **修复**：模块加载时预建 `reverseMap`（`{ 中文: key }`），O(1) 查表；去掉 `console.log`
- **文件**：`scripts/vue2-scan/init.js`、`scripts/i18n-scan/init/init-vue2.cjs`、`scripts/i18n-scan/init/init-vue3.cjs`

---

## 2026-08-11

### template-parser: @vue/compiler-dom 列号 1-based 导致 replacer 定位偏移

- **现象**：同一行出现相同中文时（如 `<el-button @click="form.taskComment = '同意'">同意</el-button>`），replacer 的 col 定位永远差 1，失败后回退 `indexOf` 命中第一个（`@click` 里的），导致错误替换为 `{{ $t('key') }}`
- **根因**：`@vue/compiler-dom` 的 `loc.start.column` 是 1-based，replacer 当 0-based 用
- **修复**：`template-parser.cjs` 的 `getCol()` 改为 `loc.start.column - 1`，`extractTemplateLiterals()` 同理
- **文件**：`scripts/i18n-scan/parsers/template-parser.cjs`

### replacer: 多行 static-attr 属性值无法替换

- **现象**：跨行属性值（如多行 placeholder）在单行内 `indexOf` 找不到完整 pattern，替换被跳过
- **修复**：单行匹配失败且 `chineseText` 含换行时，启用多行匹配 — 找 `attrName="` 起始 → 向后扫描闭合 `"` → 跨行替换
- **文件**：`scripts/i18n-scan/replacer.cjs`

### init-vue2: main.ts 无条件生成 @vnet/i18n 代码

- **现象**：Vue 2 项目通常无 `@vnet/i18n` 依赖，`updateMainTs()` 却无条件生成其 import 和注册代码
- **修复**：从 `init-vue2.cjs` 的 `updateMainTs()` 移除 @vnet/i18n 相关代码生成
- **文件**：`scripts/i18n-scan/init/init-vue2.cjs`

### init-vue2: index.ts 模板缺少 $t 导出

- **现象**：`main.ts` 中 `import { $t } from './locales'`，但生成的 `index.ts` 没有 `export const $t`
- **修复**：在两个模板（element-ui 和 非 element-ui）的 `export default i18n` 之后添加 `export const $t = i18n.t.bind(i18n)`
- **文件**：`scripts/i18n-scan/init/init-vue2.cjs`

---

## 2026-08-10

### setup.cjs: 缺少 element-ui 选项

- **现象**：`UI_LIBRARY_OPTIONS` 只有 element-plus / vant / none，Vue 2 项目无法选择 Element UI
- **修复**：
  - 新增 `{ value: "element-ui", label: "Element UI（Vue 2）" }`
  - `UI_TRANSLATE_METHODS_MAP` 新增 element-ui 条目（`this.$message.*`、`this.$confirm` 等）
  - `uiLibrary` 默认值根据 `vueVersion` 动态调整
- **文件**：`scripts/i18n-scan/setup.cjs`

### template-parser + replacer: 同行相同中文 col 定位缺失

- **现象**：同一行相同中文出现多次时，replacer 用 `indexOf` 找位置，命中第一个导致错误替换
- **修复**：template-parser 所有 result 类型新增 `col` 字段（AST `loc.start.column`），replacer 优先用列号精确定位
- **注意**：此修复未考虑 1-based 问题，col 定位实际未生效，在 2026-08-11 的列号修复中彻底解决
- **文件**：`scripts/i18n-scan/parsers/template-parser.cjs`、`scripts/i18n-scan/replacer.cjs`

---

## 2026-08-09

### script-parser: @babel/parser 解析 .ts 文件缺少 decorators-legacy 插件

- **现象**：TypeScript 项目中使用 `@HttpBindNormal()` 等装饰器时，babel parser 直接抛异常，`parseScript` 的 try-catch 返回空数组，整个文件被静默跳过
- **修复**：parser plugins 数组中添加 `'decorators-legacy'`，放在 `'typescript'` 之前
- **文件**：`scripts/i18n-scan/parsers/script-parser.cjs`

### replacer: injectImports 只处理 .vue 文件

- **现象**：`.ts` / `.js` 文件替换后 `$t()` 没有对应 import，TypeScript 报 `Cannot find name '$t'`
- **根因**：`injectImports` 依赖 `<script>` 标签定位，`.ts`/`.js` 文件找不到标签直接 return
- **修复**：`scriptMatch` 匹配失败时走 else 分支处理纯 TS/JS 文件 — 找到全文件最后一个 import 后插入，无 import 则在文件顶部插入
- **文件**：`scripts/i18n-scan/replacer.cjs`

---

## 2026-08-08

### script-parser: TemplateLiteral 无插值分支缺少成员赋值检查

- **现象**：`` form.label = `中文` `` 这种成员赋值中的模板字符串未被跳过
- **修复**：在 TemplateLiteral no-interpolation 分支添加 `isMemberAssignmentTarget` 检查
- **提交**：`1e2d231`

### script-parser: $t() 调用内的字符串被重复替换

- **现象**：已有 `$t('确认')` 中的 `'确认'` 被再次扫描，导致二次替换
- **修复**：添加 `isInTCall` 检查，跳过 `$t()` 调用参数中的字符串；同时添加 `ArrayExpression` 父节点检查，跳过数组元素中的字符串
- **提交**：`21cbd6e`

---

## 2026-08-07

### Element Plus locale 无法跟随项目语言切换

- **现象**：切换语言后 Element Plus 组件（如 ElMessage、ElTable）仍显示旧语言
- **修复**：`index.ts` 模板中 Element Plus locale 改用 `ref` + `watch` 响应式同步，并通过拦截 `i18n.install` 自动 `provide` locale
- **提交**：`488eff2`
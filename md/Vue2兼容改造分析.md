# Vue 2 项目兼容改造分析

## 背景

当前 i18n 脚本（`scripts/i18n-scan/`）针对 Vue 3 项目设计。现需支持 `program/vue2-applicationSystemServices` 这个 Vue 2 + Element UI + Class-based 组件的项目，保持现有配置项不变，功能完整可用。

## 目标项目特征

| 项目 | vue2-applicationSystemServices |
|------|-------------------------------|
| 框架 | Vue 2 + TypeScript |
| 组件风格 | Class-based（`vue-property-decorator`，`@Component` 装饰器） |
| UI 库 | Element UI（非 Element Plus） |
| 路由 | Vue Router（hash 模式） |
| 状态管理 | Vuex（空壳） |
| HTTP | Axios + js-md5 签名 |
| CSS | Less |
| 文件规模 | 19 个 .vue + 6 个 .ts API + 2 个 utils |
| i18n 现状 | 零国际化，无 vue-i18n，无 $t()，无 locales 目录 |

## 改造方案总览

新增配置项 `vueVersion`（默认 `3`），各模块按版本分支处理。

---

## 一、必须改造的模块

### 1. `init.cjs` — 改动最大

涉及 3 个生成函数 + 1 个更新函数。

#### 1.1 `generateIndexContent()` — 生成的 `index.ts` 完全不同

| 差异点 | Vue 3（当前） | Vue 2（需新增） |
|--------|-------------|----------------|
| 创建实例 | `createI18n({ legacy: false, ... })` | `new VueI18n({ ... })`（无 `legacy` 选项） |
| 导入方式 | `import { createI18n } from 'vue-i18n'` | `import VueI18n from 'vue-i18n'` |
| 响应式 | `import { ref, watch } from 'vue'` | 不需要（vue-i18n v8 内置响应式） |
| Element 集成 | `app.provide(localeContextKey, ...)` + `install` 拦截 | `ElementUI.locale()` 或 `Element.locale()` 直接调用 |
| Element locale 导入 | `element-plus/dist/locale/zh-cn.mjs` | `element-ui/lib/locale/lang/zh-CN` |
| `$t` 导出 | `i18n.global.t` | `i18n.t`（v8 无 `.global` 层级） |
| `setupI18n` | `app.use(i18n)` + `app.config.globalProperties.$t` | `Vue.prototype.$t = i18n.t` 或 `app.i18n = i18n` |

**Vue 2 + Element UI 的 `index.ts` 模板示例：**

```ts
import Vue from 'vue'
import VueI18n from 'vue-i18n'
import zhCNLocale from 'element-ui/lib/locale/lang/zh-CN'
import enLocale from 'element-ui/lib/locale/lang/en'
import zhCN from './zh-CN.json'
import en from './en.json'

Vue.use(VueI18n)

const messages = {
  'zh-CN': { ...zhCN },
  en: { ...en },
}

const i18n = new VueI18n({
  locale: localStorage.getItem('ZXY_locale') || 'zh-CN',
  messages,
  silentTranslationWarn: true,
})

// Element UI 语言同步
const elementLocales: Record<string, any> = {
  'zh-CN': zhCNLocale,
  en: enLocale,
}

// 初始设置 Element UI 语言
import ElementUI from 'element-ui'
ElementUI.locale(elementLocales[i18n.locale] || zhCNLocale)

// 监听语言切换，同步 Element UI
i18n.locale = i18n.locale // 触发响应式
const originalWatch = (i18n as any)._watchLocale
// vue-i18n v8 通过 watch 或 $watch 监听 locale 变化
// 在 Vue 组件中使用 watch: { '$i18n.locale'(val) { ElementUI.locale(elementLocales[val]) } }

export const $t = i18n.t.bind(i18n)

export default i18n

export function setupI18n() {
  // Vue 2 中在 new Vue() 时传入 i18n 实例即可
}
```

#### 1.2 `updateMainTs()` — 入口文件修改逻辑不同

| 差异点 | Vue 3（当前） | Vue 2（需新增） |
|--------|-------------|----------------|
| 入口模式 | `const app = createApp(App)` | `new Vue({ router, store, render: h => h(App) }).$mount('#app')` |
| i18n 挂载 | `.use(i18n).mount('#app')` 链式 | 在 `new Vue({ ... })` 的选项对象中加 `i18n` 属性 |
| 全局注册 | `app.config.globalProperties.$t = $t` | `Vue.prototype.$t = $t`（在 `new Vue` 之前） |
| `@vnet/i18n` 注册 | `mergeLocaleMessage` + `setI18nInstance` | 同 API（`vue-i18n` v8 也有 `mergeLocaleMessage`） |

**Vue 2 的 main.ts 修改示例：**

```ts
import Vue from 'vue'
import i18n, { $t } from './locales'
import { setI18nInstance, getComponentMessages } from '@vnet/i18n'

// 全局注册 $t
Vue.prototype.$t = $t

// @vnet/i18n 注册
const compMsgs = getComponentMessages()
for (const locale of Object.keys(compMsgs)) {
  i18n.mergeLocaleMessage(locale, compMsgs[locale])
}
setI18nInstance(i18n)

new Vue({
  router,
  store,
  i18n,        // ← 关键：在选项中传入 i18n 实例
  render: (h) => h(App)
}).$mount('#app')
```

#### 1.3 `typeToString.ts` 模板

```ts
// Vue 3: i18n.global.t(key)
// Vue 2: i18n.t(key)
```

#### 1.4 `useI18n.ts` 模板

```ts
// Vue 3: return { t: i18n.global.t }
// Vue 2: return { t: i18n.t }
```

---

### 2. `index.cjs` — 小改

#### 2.1 `ensureVueI18n()`

Vue 2 需要安装 `vue-i18n@8` 而非 `vue-i18n`（默认安装 v9）。

```js
// 当前
const installCmd = pm === 'yarn' ? 'yarn add vue-i18n' : ...

// 需改为
const pkg = config.vueVersion === 2 ? 'vue-i18n@8' : 'vue-i18n'
```

#### 2.2 `normalizeConfig()`

新增 `vueVersion` 默认值 `3`。

```js
vueVersion: config.vueVersion !== undefined ? config.vueVersion : 3,
```

---

### 3. `replacer.cjs` — 基本兼容，小改

`injectImports()` 中 `import { computed } from 'vue'` 对 Vue 2 同样适用（`vue` 包名相同），**基本不需要改**。

但需确认 `import { $t } from '@/locales'` 路径在 Vue 2 项目中同样有效。

---

## 二、可能需要改造的模块

### 4. `template-parser.cjs` — 中等风险

使用 `@vue/compiler-dom`（Vue 3 模板编译器）解析 Vue 2 模板。存在以下兼容风险：

| Vue 2 特有语法 | 风险 |
|---------------|------|
| `slot-scope` 属性 | `@vue/compiler-dom` 可能报 warning 但不影响解析 |
| `{{ value \| filter }}` 过滤器 | 可能解析失败或产生错误 AST |
| `v-model` 在组件上 | 行为不同但 AST 结构类似 |
| `v-bind.sync` | 可能报 warning |
| `v-for` + `v-if` 同元素 | Vue 3 不允许，可能报错 |

**建议方案**：先用 `@vue/compiler-dom` 尝试解析，失败时降级为**正则兜底提取**（提取文本内容和静态属性中的中文）。对于基本的 `label="中文"`、`<span>中文</span>`、`:label="'中文'"` 场景，正则兜底足够覆盖。

---

### 5. `vue-sfc-parser.cjs` — 低风险

`@vue/compiler-sfc` 解析 `.vue` 文件结构（template/script/style 分块），Vue 2 和 Vue 3 的 SFC 格式一致。`scriptSetup` 检测对 Vue 2 无影响（找不到就跳过）。

---

## 三、不需要改造的模块

| 模块 | 原因 |
|------|------|
| `script-parser.cjs` | 已配置 `decorators-legacy` 插件，class-based 组件可正常解析；`@babel/parser` 与 Vue 版本无关 |
| `scanner.cjs` | 纯调度层，按扩展名分流逻辑与 Vue 版本无关 |
| `translator.cjs` | 纯文本/AI 处理，无 Vue 依赖 |
| `locale-manager.cjs` | 纯 JSON 读写，无 Vue 依赖 |
| `key-generator.cjs` | 纯字符串匹配，无 Vue 依赖 |
| `chinese-detector.cjs` | 纯正则，无 Vue 依赖 |
| `logger.cjs` | 纯输出格式化，无 Vue 依赖 |
| `validate-locales.cjs` | 纯文件校验，无 Vue 依赖 |
| `setup.cjs` | 交互配置向导，只需在配置项列表中新增 `vueVersion` 选项 |

---

## 四、改造工作量汇总

| 模块 | 改动量 | 复杂度 | 说明 |
|------|--------|--------|------|
| `init.cjs` | ~150 行 | **高** | 新增 Vue 2 分支的 `generateIndexContent`、`updateMainTs`、`typeToString`、`useI18n` 模板 |
| `index.cjs` | ~10 行 | 低 | `ensureVueI18n` 版本区分 + `normalizeConfig` 加默认值 |
| `template-parser.cjs` | ~30 行 | 中 | 加 try-catch + 正则兜底降级方案 |
| `replacer.cjs` | ~5 行 | 低 | 基本兼容，可能需要微调 |
| `setup.cjs` | ~10 行 | 低 | 配置项新增 `vueVersion` |
| `i18n.config.js` | 1 行 | 低 | 新增 `vueVersion: 2` 配置项 |

**总计约 200 行改动，核心复杂度集中在 `init.cjs`。**

---

## 五、边界问题与决策

| # | 问题 | 决策 |
|---|------|------|
| 1 | 子项目无 package.json，版本检测失败 | 交互模式第一步就问版本；有参数模式需配置文件显式指定 `vueVersion` |
| 2 | Class-based 组件中 class 属性声明（ClassProperty）的中文 | `script-parser.cjs` 新增 ClassProperty 访问器，参考 vue2-scan `scanner.js:323-330`，原 VariableDeclarator 逻辑不变 |
| 3 | Vue 2 的 `this.$message()` / `this.$confirm()` 调用方式 | `script-parser.cjs` 的 translateMethods 匹配新增 `this.` 前缀支持，参考 vue2-scan `resolveMethod()` |
| 4 | Vue 2 模板过滤器 `{{ value \| filter }}` 导致解析失败 | **不做正则兜底**，解析失败直接归入"特殊-未处理"，用户自行处理 |
| 5 | `main.ts` 入口模式完全不同 | `init/init-vue2.cjs` 的 `updateMainTs()` 完全重写，不复用 Vue 3 逻辑 |
| 6 | `$t` 在 script 中的使用方式 | Vue 2 统一用 `this.$t('key')` 格式，不询问用户，完全按 Vue 2 惯例 |

---

## 六、建议实施顺序

详见下方"实施计划 → 执行顺序"。

---

## 七、vue2-scan 与 i18n-scan 功能差距

vue2-scan 是之前写的 Vue 2 专用脚本，功能较基础。以下是相比 i18n-scan 缺失的功能：

### CLI 命令

| i18n-scan | vue2-scan | 差距 |
|-----------|-----------|------|
| `-a` 全流程一键 | 无 | **缺失** |
| `-i` 独立 init | init.js 单独文件 | 需整合为统一入口 |
| `-t` 独立 translate | `--translate-only` / `--ai` | 基本覆盖 |
| `-d` dry-run | `-d` | 已有 |
| `-s` scan | 默认行为 | 已有 |
| `-g` gap | `--gap` | 已有 |
| 无参数交互模式 | `--wizard` | 基本覆盖 |

### 扫描与替换

| 功能 | i18n-scan | vue2-scan | 差距 |
|------|-----------|-----------|------|
| 模板解析 | `@vue/compiler-dom` AST | `vue-eslint-parser` AST | vue2-scan 方案更适配 Vue 2 |
| Script 正向匹配 | VariableDeclarator | VariableDeclarator + AssignmentExpression + ObjectProperty(data/computed) + **ClassProperty** | vue2-scan 覆盖更全（Vue 2 class 组件） |
| translateMethods | 支持通配符 `ElMessage.*` | 支持通配符 + **`this.` 前缀** | vue2-scan 适配 Vue 2 调用方式 |
| 模板字符串重建 | `template-literal` 类型整体重建 | 无 | **缺失** |
| computed 包裹 | `scriptReactive` 配置驱动 | 硬编码判断 | **缺失**（需配置化） |
| import 自动注入 | `$t` + `computed` | `i18n` + `computed` | 基本覆盖 |
| 替换方式 | 逐行字符串拼接 | `magic-string` 精确位置 | vue2-scan 更精确 |
| 动态属性补充扫描 | 无 | `extraScan()` 正则 | vue2-scan 有，i18n-scan 无 |
| HTML 标签检测 | `hasHtmlTags()` 归入特殊 | 无 | **缺失** |

### 翻译

| 功能 | i18n-scan | vue2-scan | 差距 |
|------|-----------|-----------|------|
| 新文本翻译 | ✓ | ✓ | 持平 |
| 缺口检测 + 补齐 | `findTranslationGaps()` | 无 | **缺失** |
| 重试机制 | 最多 3 次 | 无 | **缺失** |
| 参考语言包 | `referenceLocales` | 无 | **缺失** |
| 校验 AI 返回 | `validateAndRetryGapBatch()` | 无 | **缺失** |

### 初始化

| 功能 | i18n-scan | vue2-scan | 差距 |
|------|-----------|-----------|------|
| 目录 + 空 JSON | ✓ | ✓ | 持平 |
| index.ts 生成 | Element Plus / Vant 模板 | Element UI 模板 | 各有模板，需合并 |
| main.ts 自动更新 | `updateMainTs()` | 无 | **缺失** |
| sharedLocales 深度合并 | ✓ | 无 | **缺失** |
| @vnet/i18n 注册 | ✓ | 无 | **缺失** |
| useI18n composable | ✓ | 无（有 toI18n.ts 不同方案） | **缺失** |
| vue-i18n 自动安装 | `ensureVueI18n()` | 无 | **缺失** |
| 共享包校验 | `validate-locales.cjs` | 无 | **缺失** |

### 其他

| 功能 | i18n-scan | vue2-scan | 差距 |
|------|-----------|-----------|------|
| 配置向导 | `setup.cjs` 完整向导 | `wizard.js` 简单问答 | i18n-scan 更完善 |
| 日志输出 | `logger.cjs` 格式化 | 直接 console.log | i18n-scan 更规范 |
| 特殊分类 | matched/unmatched/special 三类 | matched/unmapped 两类 | **缺失** special 分类 |
| 去重 | 文件+行号+中文 | 无 | **缺失** |

### 结论

- **从 vue2-scan 拿过来直接用**：模板解析（vue-eslint-parser）、ClassProperty + `this.` 前缀的 script 解析、magic-string 替换、Element UI 的 index.ts 模板、extraScan 动态属性补充
- **i18n-scan 框架已有、Vue 2 也需要的**：缺口补齐+重试、sharedLocales、main.ts 自动更新、special 分类、computed 配置化包裹、模板字符串重建、@vnet/i18n 注册、useI18n composable — 这些在 i18n-scan 中 Vue 3 已有实现，Vue 2 版本需新增同名接口
- **i18n-scan 框架提供、直接复用**：CLI 入口、配置体系、pipeline 调度、translator、locale-manager、key-generator、logger、validate-locales、scanner 调度层

---

# 实施计划

## 核心策略：框架归 i18n-scan，实现归 vue2-scan

```
i18n-scan（流程框架）            vue2-scan（Vue 2 实现）
─────────────────────────       ─────────────────────────
CLI 入口、配置体系          →   不动的框架
pipeline 调度、模式切换
translator（AI 翻译）
locale-manager、key-generator
logger、validate-locales
scanner（文件扫描调度）

                                模板解析 → vue-eslint-parser（拿过来）
                                Script 解析 → ClassProperty + this. 前缀（拿过来）
                                替换方式 → magic-string（拿过来）
                                init 模板 → Element UI index.ts（拿过来）
                                extraScan 动态属性（拿过来）
```

**策略**：i18n-scan 的流程框架不动。Vue 2 的具体实现从 vue2-scan 拿过来，套上统一接口，接入 i18n-scan 的调度。不是"在 Vue 3 代码里加 if/else"，而是"Vue 2 实现直接用 vue2-scan 的代码，Vue 3 实现保持原样，两边物理隔离、接口统一"。

## 核心设计原则：一次分发，统一接口

**避免在代码中到处写 `if (vueVersion === 2)`。** 版本判断只在入口处做一次，后续所有调用走统一接口。

```
index.cjs（唯一版本判断点）
  │  detectVueVersion() → config.vueVersion = 2 或 3
  │
  ├─ init.cjs
  │     const api = require(`./init/init-vue${config.vueVersion}.cjs`)
  │     api.generateIndexContent(...)   // 同名函数，不同实现
  │     api.updateMainTs(...)           // 同名函数，不同实现
  │     api.generateTypeToString()      // 同名函数，不同实现
  │     api.generateUseI18n()           // 同名函数，不同实现
  │     api.i18nPackageName             // 'vue-i18n@8' 或 'vue-i18n'
  │
  ├─ ensureVueI18n()
  │     直接用 api.i18nPackageName，无版本判断
  │
  └─ template-parser.cjs
        parse() 失败 → fallbackParse()，无版本判断（通用降级）
```

每个版本模块导出**完全相同的接口**，调用方不关心版本。

## 版本检测策略

优先级：`i18n.config.js` 显式 `vueVersion` > `package.json` 的 `vue` 依赖版本 > 默认值 `3`

**只在 `index.cjs` 的 `normalizeConfig()` 中做一次检测**，之后 `config.vueVersion` 就是确定值，其他模块不重复判断。

---

## 文件组织方案

```
scripts/i18n-scan/
  init.cjs                    # 共享逻辑 + 调度：根据 vueVersion 加载对应模块，其余逻辑不变
  init/
    init-vue3.cjs             # Vue 3 实现：generateIndexContent、updateMainTs、generateTypeToString、generateUseI18n、i18nPackageName
    init-vue2.cjs             # Vue 2 实现：同上接口，不同实现
  index.cjs                   # 唯一版本判断点：detectVueVersion() + normalizeConfig()
  template-parser.cjs         # 通用降级：parse() 失败 → fallbackParse()，不区分版本
  setup.cjs                   # 必答项第一位加 vueVersion
  # 以下模块不改动
  scanner.cjs / replacer.cjs / translator.cjs
  parsers/  generators/  utils/
```

---

## 版本模块统一接口

`init/init-vue3.cjs` 和 `init/init-vue2.cjs` 导出完全相同的接口：

```js
module.exports = {
  i18nPackageName,                                    // string: 'vue-i18n' 或 'vue-i18n@8'
  generateIndexContent,                               // (config, outputDir, projectRoot, validSharedLocales) => string
  updateMainTs,                                       // (projectRoot) => void
  generateTypeToString,                               // () => string
  generateUseI18n,                                    // () => string
}
```

---

## Vue 2 参考脚本（vue2-scan）

`scripts/vue2-scan/` 是之前写的 Vue 2 专用脚本，以下方案可直接参考复用，将来该目录会删除。

### 可复用的方案

| 来源 | 方案 | 用途 |
|------|------|------|
| `scanner.js:parseVueTemplate` | 使用 `vue-eslint-parser` 解析模板，AST 节点 VText/VAttribute/VLiteral | 后续如需增强 Vue 2 模板解析精度时引入 |
| `scanner.js:parseScriptTargets` | ClassProperty 节点处理（`scanner.js:323-330`），处理 class-based 组件的属性声明 | `script-parser.cjs` 的 Vue 2 分支需新增此节点访问器 |
| `scanner.js:parseTranslateMethods` | `resolveMethod()` 处理 `this.$message()` / `this.$confirm()` 调用链 | `script-parser.cjs` 的 translateMethods 匹配需支持 `this.` 前缀 |
| `scanner.js:extraScan` | 正则补充扫描动态属性 `:titleInfo="'查看详情'"` | 可选增强，当前版本不做 |
| `patcher.js` | `magic-string` 做精确位置替换，`this.$t()` / `this.i18nTypeToString()` 格式 | replacer 的 Vue 2 分支参考 |
| `init.js:generateIndex` | Vue 2 + Element UI 的 `index.ts` 模板，`new VueI18n()` + `element-ui/lib/locale` | `init/init-vue2.cjs` 直接参考 |

### 不复用的部分

- 整体流程逻辑 → 以 i18n-scan 现有逻辑为准
- 配置格式 → 以 i18n-scan 的 `i18n.config.js` 为准
- AI 翻译 → 以 i18n-scan 的 `translator.cjs` 为准
- 语言包管理 → 以 i18n-scan 的 `locale-manager.cjs` 为准

---

## 实施步骤

### 步骤 1：创建 `init/` 目录，提取 Vue 3 代码到 `init/init-vue3.cjs`

**目标**：把 `init.cjs` 中 Vue 3 专用的函数提取到独立文件，`init.cjs` 只保留共享逻辑 + 调度。

**提取内容**：
- `generateIndexContent()` → `init/init-vue3.cjs`
- `updateMainTs()` → `init/init-vue3.cjs`
- `typeToString.ts` 模板 → `init/init-vue3.cjs` 导出 `generateTypeToString`
- `useI18n.ts` 模板 → `init/init-vue3.cjs` 导出 `generateUseI18n`
- 新增导出 `i18nPackageName: 'vue-i18n'`
- `langToVarName()` → 保留在 `init.cjs`（两个版本共用）

**`init.cjs` 改造后的 `runInit()` 结构**：
```js
async function runInit(config, projectRoot, options = {}) {
  // 共享逻辑：创建目录、空 JSON、校验共享包
  // ...

  // 一次加载，后续统一调用
  const api = require(`./init/init-vue${config.vueVersion}.cjs`)

  // 生成文件（所有版本调用同名函数）
  const indexContent = api.generateIndexContent(config, outputDir, projectRoot, validSharedLocales)
  fs.writeFileSync(indexFile, indexContent, 'utf-8')

  const typeToStringContent = api.generateTypeToString()
  fs.writeFileSync(typeToStringFile, typeToStringContent, 'utf-8')

  const composableContent = api.generateUseI18n()
  fs.writeFileSync(composableFile, composableContent, 'utf-8')

  // 更新 main.ts
  api.updateMainTs(projectRoot)
}
```

**关键约束**：`init/init-vue3.cjs` 导出的函数签名和原来 `init.cjs` 中的完全一致，确保 Vue 3 零回归。

### 步骤 2：创建 `init/init-vue2.cjs`

**目标**：实现 Vue 2 版本，导出与 `init-vue3.cjs` 完全相同的接口。

**导出**：
```js
module.exports = {
  i18nPackageName: 'vue-i18n@8',
  generateIndexContent,    // 生成 Vue 2 + Element UI / Vant 的 index.ts
  updateMainTs,            // 修改 new Vue({...}) 模式的 main.ts
  generateTypeToString,    // i18n.t(key) 版本
  generateUseI18n,         // i18n.t 版本
}
```

**各函数要点**：

1. **`generateIndexContent()`**
   - `import VueI18n from 'vue-i18n'` + `Vue.use(VueI18n)`
   - `new VueI18n({ ... })` 创建实例
   - `$t = i18n.t` 导出
   - Element UI：`import ElementUI from 'element-ui'` + `ElementUI.locale(...)`
   - Element UI locale：`element-ui/lib/locale/lang/zh-CN`
   - `uiLibrary === 'none'` 时生成精简模板

2. **`updateMainTs()`**
   - 检测 `new Vue({` 模式
   - 在选项对象中插入 `i18n,` 属性
   - `Vue.prototype.$t = $t` 全局注册

3. **`generateTypeToString()`** — `i18n.t(key)`
4. **`generateUseI18n()`** — `return { t: i18n.t }`

### 步骤 3：修改 `index.cjs`

**3.1 `normalizeConfig()` 加版本检测（唯一判断点）**：
```js
function detectVueVersion(config) {
  if (config.vueVersion) return config.vueVersion
  const projectPath = config.projectPath || '.'
  const pkgPath = path.join(path.resolve(projectPath), 'package.json')
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    const vueVer = pkg.dependencies?.vue || pkg.devDependencies?.vue || ''
    if (/^[\^~]?2/.test(vueVer)) return 2
    if (/^[\^~]?3/.test(vueVer)) return 3
  } catch {}
  return 3
}
```

**3.2 `ensureVueI18n()` 从版本模块取包名，不做版本判断**：
```js
function ensureVueI18n(projectRoot, vueVersion) {
  // ...检查 package.json 是否已有 vue-i18n...
  const api = require(`./init/init-vue${vueVersion}.cjs`)
  const installCmd = pm === 'yarn'
    ? `yarn add ${api.i18nPackageName}`
    : pm === 'pnpm'
      ? `pnpm add ${api.i18nPackageName}`
      : `npm install ${api.i18nPackageName}`
  // ...
}
```

### 步骤 4：修改 `template-parser.cjs`

**不做正则兜底**。`@vue/compiler-dom` 解析失败时，直接将整段中文归入"特殊-未处理"，让用户自行处理。

```js
try {
  ast = parse(template, { comments: true, getTextMode: () => 0 })
} catch (err) {
  // Vue 2 特有语法（如过滤器 |）导致解析失败
  // 不降级，归入特殊未处理，由用户人工处理
  return []
}
```

> **参考**：vue2-scan 使用 `vue-eslint-parser` 解析 Vue 2 模板，AST 节点类型为 VText / VAttribute / VLiteral，天然兼容 Vue 2 语法。如果后续需要增强 Vue 2 模板解析精度，可考虑引入 `vue-eslint-parser` 作为 Vue 2 项目的模板解析器，但当前版本不做。

### 步骤 5：修改 `setup.cjs`

`vueVersion` 放在**必答项第一位**，在所有配置之前询问：

```js
{
  key: 'vueVersion',
  title: 'Vue 版本',
  description: '项目使用的 Vue 版本，不确定可查看 package.json 中 vue 的版本号',
  type: 'select',
  options: [
    { label: 'Vue 3（默认）', value: 3 },
    { label: 'Vue 2', value: 2 },
  ],
  default: 3,
}
```

后续配置项根据 `vueVersion` 动态调整默认值（如 `uiLibrary` 选项、`translateMethods` 默认值）。

---

## 验证方案

### 验证 1：Vue 3 PC 端（Element Plus）— 零回归

项目：`program/vue3-fundTransfer`
```bash
# 1. dry-run 预览
node scripts/i18n-scan/index.cjs -d

# 2. 全流程
node scripts/i18n-scan/index.cjs -a

# 3. 检查生成的 index.ts 是否与改造前一致
git diff src/locales/index.ts
```

### 验证 2：Vue 3 移动端（Vant）— 零回归

项目：`program/vue3-moblie-fundTransfer`
```bash
node scripts/i18n-scan/index.cjs -d
node scripts/i18n-scan/index.cjs -a
```

### 验证 3：Vue 2（Element UI）— 新功能

项目：`program/vue2-applicationSystemServices`
```bash
# 1. 交互模式（无参数）
node scripts/i18n-scan/index.cjs

# 2. 有参数模式
node scripts/i18n-scan/index.cjs -i    # 初始化
node scripts/i18n-scan/index.cjs -d    # 预览
node scripts/i18n-scan/index.cjs -s    # 替换
```

### 验证 4：版本自动检测

- 删除 `i18n.config.js` 中的 `vueVersion`，验证从 package.json 自动检测
- 显式配置 `vueVersion: 2`，验证配置优先

---

## 执行顺序

| 序号 | 步骤 | 风险 | 验证点 |
|------|------|------|--------|
| 1 | 创建 `init/` 目录 + `init/init-vue3.cjs`，提取 Vue 3 代码 | **高** | 跑 Vue 3 两个项目全流程，确认零回归 |
| 2 | 修改 `init.cjs`，改为调度入口 | **高** | 同上 |
| 3 | 修改 `index.cjs`（normalizeConfig + ensureVueI18n） | 低 | 版本检测逻辑正确 |
| 4 | 创建 `init/init-vue2.cjs` | 低 | Vue 2 项目 init 正常 |
| 5 | 修改 `template-parser.cjs`（降级兜底） | 中 | Vue 2 模板扫描不报错 |
| 6 | 修改 `setup.cjs` | 低 | 配置向导正常 |
| 7 | 端到端验证 | — | 三个项目全流程通过 |

步骤 1+2 是核心，做完立即验证 Vue 3 零回归。步骤 4-6 是增量，不影响 Vue 3。

---

## 不改动的文件

- `scanner.cjs`、`replacer.cjs`、`translator.cjs`
- `parsers/vue-sfc-parser.cjs`、`parsers/script-parser.cjs`
- `generators/key-generator.cjs`、`generators/locale-manager.cjs`
- `utils/chinese-detector.cjs`、`utils/logger.cjs`、`utils/validate-locales.cjs`
- `test-full.cjs`
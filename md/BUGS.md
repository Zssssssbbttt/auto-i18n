# toI18n.cjs 全量测试 Bug 报告

> 测试时间: 2026-08-13
> 测试脚本: `toI18n.cjs` (打包产物)
> 测试项目: Vue2 PC (Element UI) / Vue3 PC (Element Plus) / Vue3 Mobile (Vant)

---

## 测试覆盖

| 模式 | Vue2 | Vue3 PC | Vue3 Mobile |
|------|------|---------|-------------|
| `-a` (全流程) | ✓ | — | — |
| `-i` (初始化) | ✓ | ✓ | ✓ |
| `-d` (预览) | ✓ | ✓ | ✓ |
| `-s` (替换) | ✓ | — | — |
| `-g` (盲区) | ✓ | — | — |

---

## Bug 1 [P0]: `--scan` 单引号静态属性"已匹配但不替换"

**复现步骤**: 源文件包含单引号属性值，如 `<el-table-column label='组类型' />`，且语言包中有对应 key，执行 `-s`。

**现象**: 扫描阶段正确识别为"已匹配"（`已匹配替换: N`），但替换阶段静默跳过（`修改文件: 0`），该中文原样保留。双引号属性 `label="中文"` 正常替换。

**根因**: `replacer.cjs` 的 `static-attr` 分支硬编码双引号模式 `` `${attrName}="${chineseText}"` `` 做 `indexOf` 定位。Vue 模板允许单引号属性值（AST 扫描器正常解析），但替换器找不到模式 → `idx === -1` → 静默 `continue`，`changed` 保持 false。

**影响**: "已匹配"的条目实际未替换，用户看到的计数与真实修改不一致，且此类中文永远翻译不了。

**修复**（2026-08-14）: `static-attr` 分支依次尝试双引号和单引号两种模式；多行匹配分支同样支持两种引号并据此找闭合引号。单测 `test-replacer-changed.cjs` 覆盖单引号/多行单引号/双轮回归，11/11 通过。

---

## Bug 2 [P0]: Vue3 项目 `main.ts` 注入代码缩进错误

**复现步骤**: 对 Vue3 Mobile 项目（qiankun 微前端，`render()` 函数写法）执行 `-i`。

**现象**: 注入的 `@vnet/i18n` 注册代码和 `.use(i18n)` 缩进不正确，代码结构被破坏：

```ts
// 生成的代码（缩进错误）
  app = createApp(App)

// 全局注册 $t，模板中可直接使用
app.config.globalProperties.$t = $t          // ← 缩进不匹配

// @vnet/i18n 注册代码块
const compMsgs = getComponentMessages()      // ← 在 render 函数内但缩进不对
// ...
        .use(i18n)                           // ← 多余缩进
        .mount(...)
}
```

**根因**（`init/init-vue3.cjs` 的 `updateMainTs()`）：
1. `$t` 注册 + @vnet/i18n 块以硬编码无缩进字符串拼接，未继承 `app = createApp(App)` 锚点行的前导空白
2. 模式 A 的 `.use(i18n)` 缩进复制自 `.mount(` 行自身，而续行缩进可能比兄弟链（`.use(router)` 等）深

**预期**: 注入的代码应匹配周围代码的缩进风格。

**影响**: 生成的代码在 IDE 中看起来结构混乱，`.use(i18n)` 的缩进会导致对代码结构的误解。

**修复**（2026-08-14）: 两处注入均继承锚点行缩进；模式 A 的 `.use(i18n)` 缩进取兄弟续行缩进（无兄弟时取基行缩进 + 2）。单测 `test-update-main-ts.cjs` 覆盖真实 PC/移动端文件及全部代码路径，12/12 通过。

---

## Bug 3 [已确认设计决策，不修复]: `@vnet/i18n` 无条件注入到所有 Vue3 项目

**复现步骤**: 对 Vue3 Mobile 项目（使用 Vant，无 `@vnet/i18n` 依赖）执行 `-i`。

**现象**: `main.ts` 被注入了：
```ts
import { setI18nInstance, getComponentMessages } from '@vnet/i18n'
// ...
const compMsgs = getComponentMessages()
for (const locale of Object.keys(compMsgs)) {
  i18n.global.mergeLocaleMessage(locale, compMsgs[locale])
}
setI18nInstance(i18n)
```

**决策**（2026-08-14 与用户确认）: `@vnet/i18n` 属于公共组件依赖，与脚本无关，脚本不负责安装。注入的注册代码是有意为之——使用公共组件（FlowProcess 等）的开发人员会在编译报错时自行安装公共依赖；不使用公共组件的项目无需理会。**保持现状，不做依赖检测。**

---

## Bug 4 [P1]: Workspace 项目 `vue-i18n` 安装失败

**复现步骤**: 对 `package.json` 中有 `workspace:*` 依赖的 Vue3 Mobile 项目执行 `-i` 或 `-a`。

**现象**: `npm install vue-i18n` 失败：
```
npm error Unsupported URL Type "workspace:": workspace:^0.0.1
```

**预期**: 脚本应检测到 workspace 依赖并给出更清晰的指引（如"请在 workspace 根目录手动安装"），或使用项目已有的包管理器。

**影响**: `vue-i18n` 未安装，后续 `index.ts` 中的 `import { createI18n } from 'vue-i18n'` 会报错。

---

## Bug 5 [P2]: Vant 项目未生成 Vant 语言包集成

**复现步骤**: 对 `uiLibrary: "vant"` 的 Vue3 Mobile 项目执行 `-i`。

**现象**: 生成的 `index.ts` 使用"none"模板（仅 vue-i18n 核心），没有 Vant locale 集成代码。

**预期**: 类似 Element Plus 的语言包集成，应为 Vant 生成对应的 locale 切换逻辑。

**影响**: 切换语言后 Vant 组件不会跟随切换语言。

---

## Bug 6 [P2]: Vue 2 模板解析报错文件不可见

**复现步骤**: 对 Vue2 项目执行 `-d` 或 `-s`。

**现象**: 扫描汇总只显示 `错误: N` 数字，用户不知道哪些文件解析失败、哪些中文没被扫描。

**原因**: `@vue/compiler-sfc`（Vue 3 编译器）无法解析 Vue 2 特有的模板语法，解析失败的文件被静默跳过。且 compiler-sfc 对同一错误会重复上报两次（错误计数虚高）。

**修复**（2026-08-14）:
1. dry-run / scan 预览输出新增"解析失败（未扫描）"区块，列出失败文件的相对路径和原因（`utils/logger.cjs` 新增 `printParseErrors`，`printDryRun` 调用）
2. `vue-sfc-parser.cjs` 对 `sfc.errors` 按消息去重，同一错误不再重复计入

**验证**: 真实 Vue2 项目 `-d` 输出正确列出 `flowButtonsNew.vue` 及原因，错误计数 2 → 1。单测 `test-parse-error-output.cjs` 4/4 通过（含端到端 bundle 输出验证）。

---

## 其他观察

1. **AI 翻译不可用**: 当前 API Key 余额不足（¥7.52），无法测试 `-t` 和缺口补齐功能。建议充值后补充测试。

2. **替换正确性**: 手动填充语言包后，`-s` 替换结果正确——`label="中文"` → `:label="$t('key')"`、`<span>中文</span>` → `<span>{{ $t('key') }}</span>`、Vue 2 脚本中替换为 `this.$t('key')`（`buildReplacement` 按 `vueVersion` 区分）。

3. **init 生成的 index.ts 正确性**: Vue2 生成 `new VueI18n()` + Element UI 模板，Vue3 生成 `createI18n()` + Element Plus 动态 locale 模板，结构正确。

4. **语言包追加**: 未匹配的中文**不会**写入语言包（`appendNewKeys` 为有意的空实现，见《语言包管理与无AI模式方案》方向 B），由 `--translate` 或用户手动添加。dry-run 中原先的误导文案已移除。

5. **import 注入**: `import { $t } from '@/locales'` 正确注入到被修改的文件中。

6. **特殊项处理**: 模板字符串插值、字符串拼接被正确归类为"特殊-未处理"，写入日志文件。
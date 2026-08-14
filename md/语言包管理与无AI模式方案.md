# 语言包管理边界与「无 AI 模式」方案讨论

> 记录日期：2026-08-12
> 状态：方案讨论中，待明日商定后落地

## 一、已确认的行为与结论

### 1. 新增语言的自动注册（已支持）

第二次执行脚本新增语言（如泰语）时，`init.cjs` 会根据配置中的 `sourceLanguage` + `targetLanguages` **完整重建** `index.ts`，遍历所有配置语言生成 import、messages 条目、Element UI/Plus locale 注册。

> **2026-08-13 重构**：原先使用 `getMissingLangs` + `patchIndexContent` 的补丁方式，在文件结构中用正则查找插入位置，结构稍有变化就容易静默失败（如新增泰语未注册到 index.ts）。现已改为每次 init 直接调用 `generateIndexContent` 完整重建，配置里有什么语言就注册什么语言，简单可靠。

### 2. 移除语言的自动清理（已实现）

从 `targetLanguages` 中删除某语言后，下次 init 重建 `index.ts` 时自然不会再生成该语言的注册，同时**不删除语言包 JSON 文件**，防止用户误删配置导致语言包文件丢失。

### 3. 手动放置但未配置的语言包（不处理）

用户手动在 `locales/` 下放置了符合标准但未在配置中声明的语言包（如自行生成的 `th.json`），脚本**不处理、不提示**。以配置为唯一真相来源。

### 4. 目标语言包与中文包 key 不对应

- **目标语言缺少 key**（中文有、泰语没有）：已支持，`findTranslationGaps` 单向检测 → AI 缺口补齐。
- **目标语言有多余 key**（泰语有、中文没有）：不处理。以 `zh-CN.json` 为唯一结构基准，多余的"僵尸条目"留待人工处理。

### 5. 项目自身语言包不做 key 数量校验

`validateLocalePaths`（key 数量一致性校验）仅用于 `sharedLocales` 和 `referenceLocales`，**不校验项目自己的 `locales/` 目录**。AI 返回某语言翻译为空时，可能出现中文包写了但目标语言包没写，数量不一致也通过。

---

## 二、增量翻译逻辑（已确认）

### 已翻译过 + 新增中文

1. 扫描全部中文 → 加载 `zh-CN.json` 反向映射 → 过滤出已有翻译
2. 仅对 `untranslated`（新文本）调用 AI
3. 写回：`zh-CN.json` + 各目标语言文件同步新增

### 新增中文 + 新增语言

- 新文本走「新文本翻译」路径（AI 生成 key + 翻译到所有目标语言）
- 已有文本在新增语言中的缺失走「缺口补齐」路径（复用已有 key，只补翻译）
- 最终所有语言包 key 结构对齐到 `zh-CN.json`

---

## 三、「无 AI 模式」方案（待商定）

### 背景

用户未配置 AI 翻译时，当前 `--scan` 无法替换任何内容（反向映射为空，全部未匹配），脚本对用户没有直接产出价值。

### 讨论过的两个方向

**方向 A：脚本自动生成 key 写入 `zh-CN.json`**

- 内置映射表处理常用词（"确认"→`confirm`）+ 序号/规则处理长文本（`common.k0`）
- 优点：用户可直接拿语言包去翻译，一次到位
- 缺点：
  - 脚本生成的 key 质量不如 AI（序号 key 不语义化）
  - **key 一经写入 `zh-CN.json`，后续启用 AI 时会被反向映射判定为「已翻译」，永久跳过，不会重写**
  - 低质量 key 会永久残留

**方向 B（当前倾向）：输出模板文件 `zh-CN.template.json`，不生成 key**

```json
{
  "需要翻译的中文": [
    "确认",
    "取消",
    "请输入用户名",
    "提交成功"
  ]
}
```

- 只输出未匹配的中文原文，方便用户拿去翻译
- 不污染正式语言包
- 后续启用 AI 时从零开始，生成语义化 key，不受任何残留影响

### 关键结论

AI 的缺口补齐机制**天然支持「先有 key、后翻译」**：已有 key 的中文在 `findTranslationGaps` 中缺失翻译时，AI 按 `中文原文 → 已有 key` 的对照直接填空，**只翻译、不改 key**。

因此方向 A 的 key 质量问题是不可逆的（AI 不会重写 key），这决定了方向 B 更安全。

---

## 四、待明日商定事项

1. **无 AI 模式最终方案**：确认采用方向 B（模板文件），还是另有折中？
2. **模板文件命名与位置**：`zh-CN.template.json` 放 `locales/` 下还是项目根目录 / `logs/`？
3. **模板文件内容格式**：纯数组，还是按模块分类（`{ "common": [...], "validation": [...] }`）？
4. **是否同时输出已匹配项**：模板只含未匹配项，还是全部中文（含已匹配，便于整体审阅）？
5. **项目自身语言包校验**：是否需要在写回后增加 key 数量一致性校验（当前不校验）？

---

## 五、本次已落地的代码改动

| 文件 | 改动 |
|------|------|
| `init.cjs` | 移除 `getMissingLangs`、`getExtraLangs`、`langToVarName`；`runInit` 中 index.ts 生成改为每次完整重建 |
| `init/init-vue2.cjs` | 移除 `patchIndexContent`、`removeLangFromIndex` |
| `init/init-vue3.cjs` | 移除 `patchIndexContent`、`removeLangFromIndex` |
| `CLAUDE.md` | 初始化流程更新为完整重建方式 |

> **2026-08-13 重构原因**：补丁方案（`patchIndexContent` / `removeLangFromIndex`）靠正则在文件中查找插入/删除位置，文件结构稍有变化就容易静默失败。实际案例：配置中同时有日语和泰语，日语注册成功但泰语未注册。改为完整重建后，`generateIndexContent` 遍历所有配置语言一次性生成，不会遗漏。

---

## 六、2026-08-13 Vue 2/3 对齐与配置优化

### 背景

全面审查脚本代码后，发现 Vue 2 和 Vue 3 之间存在多项不对齐问题，以及部分配置项未生效。

### 已修复的问题

#### 1. Vue 3 Element Plus locale 硬编码（P0）

**问题**：`init-vue3.cjs` 的 `generateIndexContent` 中 Element Plus locale 只硬编码了 `zh-CN` 和 `en` 两个语言。配置了 `targetLanguages: ["en","th","ja"]` 时，切换到泰语或日语后 Element Plus 组件不会切换语言。

**修复**：改为动态遍历 `allLangs` 生成所有语言的 Element Plus locale import 和注册，与 Vue 2 的 Element UI 行为一致。

#### 2. translateMethods 默认值不区分 Vue 版本和 UI 库（P1）

**问题**：`normalizeConfig` 中 `translateMethods` 默认值硬编码为 Element Plus 的白名单（`ElMessage.*` 等），Vue 2 项目也会拿到错误的默认值。

**修复**：新增 `getDefaultTranslateMethods(vueVersion, uiLibrary)` 函数：
- Vue 3 按 UI 库区分：element-plus / vant / none
- Vue 2 统一使用 `this.$message.*` 等实例方法，不区分 UI 库

#### 3. baseDir 配置项未生效（P1）

**问题**：`i18n.config.js` 中定义了 `baseDir` 但脚本从未读取使用。

**修复**：`normalizeConfig` 中实现 baseDir 解析逻辑：
- 支持字符串（`"src"`）或数组（`["src/views", "src/components"]`）
- 自动拼接 `entry` 扫描路径：`baseDir + "/" + pattern`
- 若 entry 已包含 baseDir 前缀或以 `./`、`../` 开头，不重复拼接
- 默认值 `"src"`

#### 4. keyStyle 配置项移除

**问题**：`keyStyle` 在交互向导中展示但代码中从未使用，AI 翻译 prompt 硬编码了 camelCase。

**修复**：从 `setup.cjs` 中移除 `KEY_STYLE_OPTIONS`、ADVANCED_ITEMS 中的 keyStyle 项、`writeConfig` 输出和 `printSummary` 引用。

#### 5. Vue 2 不需要 @vnet/i18n 注册

**确认**：Vue 2 项目没有公共组件（FlowProcess 等），不需要 `getComponentMessages` + `mergeLocaleMessage` + `setI18nInstance` 注册逻辑。仅 Vue 3 的 `updateMainTs` 执行此注入。

### 代码改动清单

| 文件 | 改动 |
|------|------|
| `init/init-vue3.cjs` | `generateIndexContent` 中 Element Plus locale 改为动态遍历 `allLangs` 生成 |
| `index.cjs` | 新增 `getDefaultTranslateMethods()`；`normalizeConfig` 中实现 `baseDir` 解析 |
| `setup.cjs` | 移除 `KEY_STYLE_OPTIONS`、keyStyle 配置项及相关引用 |
| `CLAUDE.md` | 更新初始化流程、`translateMethods` 默认值、`baseDir` 说明 |

### 确认不处理

| 项目 | 原因 |
|------|------|
| Vue 2 添加 @vnet/i18n 注册 | Vue 2 无公共组件，不需要 |
| tsx/jsx 文件扫描 | Vue 项目暂不需要 |
| `appendNewKeys` 死代码 | 不影响功能，后续清理 |

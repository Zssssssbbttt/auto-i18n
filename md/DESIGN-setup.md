# 交互式配置 + 功能菜单 — 设计方案

## 目标

将 i18n 脚本的配置方式从「手动编辑 `i18n.config.js`」改为「终端对话式配置」，降低使用门槛。同时提供统一的功能菜单入口，用户只需记住一个命令。

## 启动流程

```
node i18n-scan.bundle.js
  │
  ├─ 有命令行参数（--scan / --translate / --dry-run / --gap / --init / --all）
  │     → 跳过交互，直接执行对应功能（兼容模式，供 CI/脚本调用）
  │
  └─ 无参数
        → 阶段一：配置确认（逐项对话）
        → 阶段二：功能菜单（选择操作 → 执行 → 回到菜单）
```

## 阶段一：配置确认

### 规则

- **逐项展示**，一问一答，不堆砌
- **已有配置文件则读取作为默认值**，直接回车保留原值
- **每项格式**：标题 → 说明/注释 → 配置
- **Ctrl+C 任意步骤安全退出**，不产生半成品文件
- **所有配置确认完毕后一次性写入**，中途退出不保存
- **API Key 输入时脱敏**，不回显

### 配置项定义

#### 必答项（逐一询问）

| 序号 | 配置项 | 标题 | 说明 | 类型 | 默认值 |
|------|--------|------|------|------|--------|
| 1 | `projectPath` | 项目根目录 | 需要国际化的项目所在目录，相对于本脚本的位置 | input | `./` |
| 2 | `entry` | 扫描范围 | 要扫描哪些文件。`src/**/*.vue` 表示 src 下所有 .vue 文件，`src/**/*.{vue,js,ts}` 表示 src 下所有 vue/js/ts 文件 | input | `src/**/*.vue` |
| 3 | `sourceLanguage` | 源码语言 | 项目中当前使用的语言 | select | `zh-CN` |
| 4 | `targetLanguages` | 目标语言 | 需要翻译到哪些语言，用逗号分隔序号 | multiselect | `en` |
| 5 | `ai.enabled` | 是否启用 AI 翻译 | 启用后可通过 AI 自动翻译，需要提供 API Key | confirm | `Y` |

#### 条件项（启用 AI 时才问）

| 序号 | 配置项 | 标题 | 说明 | 类型 | 默认值 |
|------|--------|------|------|------|--------|
| 6 | `ai.apiKey` | AI API Key | OpenAI 兼容接口的密钥，输入时不显示 | input-secret | 无 |
| 7 | `ai.baseURL` | AI API 地址 | OpenAI 兼容接口地址 | input | `https://api.openai.com/v1` |
| 8 | `ai.model` | AI 模型名称 | 使用的模型，如 gpt-4、deepseek-v4-pro | input | `gpt-4` |

#### 高级项（默认跳过，用户选择修改时才逐一展示）

| 序号 | 配置项 | 标题 | 说明 | 类型 | 默认值 |
|------|--------|------|------|------|--------|
| 9 | `exclude` | 排除文件 | 不需要扫描的文件，逗号分隔 | input | `src/router.ts, src/utils/*.ts, src/views/print.vue` |
| 10 | `scanScript` | 扫描 script | 是否扫描 `<script>` 中的中文 | confirm | `Y` |
| 11 | `baseDir` | 源码根目录 | 项目源码根目录 | input | `src` |
| 12 | `output` | 输出目录 | 语言包文件输出目录 | input | `src/locales` |
| 13 | `localeStorageKey` | 存储键名 | localStorage 中存储语言设置的 key 名 | input | `ZXY_locale` |
| 14 | `keyStyle` | Key 命名风格 | 生成 key 的命名风格 | select | `camelCase` |
| 15 | `logDir` | 日志目录 | 日志文件输出目录 | input | `logs` |
| 16 | `ai.batchSize` | 翻译批次大小 | 每批最多翻译条数 | input | `200` |
| 17 | `ai.referenceLocales` | 参考语言包 | 复用已有翻译的语言包路径，逗号分隔，无则留空 | input | 空 |

#### 不询问项（直接用默认值，不展示）

| 配置项 | 原因 |
|--------|------|
| `translateAttributes` | 14 项白名单，通用性强 |
| `ignoreAttributes` | 30+ 项黑名单，通用性强 |
| `ignoreMethods` | 通用性强 |
| `ai.temperature` | 技术参数，默认 0.3 够用 |
| `ai.maxTokens` | 技术参数，默认 200000 够用 |
| `ai.systemPrompt` | 内容太长，不适合终端展示 |
| `ai.userPromptTemplate` | 内容太长，不适合终端展示 |
| `ai.gapSystemPrompt` | 内容太长，不适合终端展示 |
| `ai.gapUserPromptTemplate` | 内容太长，不适合终端展示 |

### 语言选项

**sourceLanguage 选项：**
1. zh-CN（简体中文）
2. zh-TW（繁体中文）
3. en（英文）
4. ja（日语）
5. ko（韩语）

**targetLanguages 选项（多选）：**
1. en（英文）
2. th（泰语）
3. ja（日语）
4. ko（韩语）
5. fr（法语）
6. de（德语）
7. vi（越南语）
8. pt（葡萄牙语）
9. es（西班牙语）
10. ru（俄语）

### 交互示例

```
$ node i18n-scan.bundle.js

============================================================
  i18n 自动化工具
============================================================

--- 配置确认 ---
（已有配置将作为默认值，直接回车保留原值）

1/5 项目根目录
  需要国际化的项目所在目录，相对于本脚本的位置
  [./]

2/5 扫描范围
  要扫描哪些文件
  src/**/*.vue           → src 下所有 .vue 文件
  src/**/*.{vue,js,ts}   → src 下所有 vue/js/ts 文件
  [src/**/*.vue]

3/5 源码语言
  项目中当前使用的语言
  1. zh-CN（简体中文）
  2. zh-TW（繁体中文）
  3. en（英文）
  4. ja（日语）
  5. ko（韩语）
  请选择 [1]

4/5 目标语言（可多选）
  需要翻译到哪些语言，用逗号分隔序号
  1. en（英文）      2. th（泰语）
  3. ja（日语）      4. ko（韩语）
  5. fr（法语）      6. de（德语）
  7. vi（越南语）    8. pt（葡萄牙语）
  9. es（西班牙语）  10. ru（俄语）
  请选择 [1]

5/5 是否启用 AI 翻译？
  启用后可通过 AI 自动翻译，需要提供 API Key
  [Y/n]

--- 条件项（启用 AI 时） ---

6/8 AI API Key
  OpenAI 兼容接口的密钥，输入时不显示
  [****]（已有则脱敏显示，输入新值覆盖，直接回车保留原值）

7/8 AI API 地址
  OpenAI 兼容接口地址
  [https://api.openai.com/v1]

8/8 AI 模型名称
  使用的模型，如 gpt-4、deepseek-v4-pro
  [gpt-4]

--- 高级配置 ---

是否修改高级配置？[y/N]

（选 N 则跳过，选 Y 则逐一展示 exclude / scanScript / baseDir / output / keyStyle / logDir / batchSize / referenceLocales）

--- 配置确认完毕 ---

是否保存配置？[Y/n]
  → 保存 → 写入 i18n.config.js
  → 进入功能菜单
```

## 阶段二：功能菜单

配置确认后进入功能选择：

```
请选择操作：
  1. 初始化 locales 目录（init）
  2. AI 翻译（translate）
  3. 预览扫描（dry-run）
  4. 执行替换（scan）
  5. 盲区扫描（gap）
  6. 全流程一键处理（init → translate → scan）
  7. 退出

请输入序号：
```

选择后执行对应功能，执行完毕后回到菜单（选择 7 退出则结束）。

## 技术实现

### 模块结构

```
scripts/i18n-scan/
  setup.cjs    ← 新增：配置向导 + 功能菜单
  index.cjs    ← 修改：无参数时调用 setup.cjs
  ...          ← 其他模块不变
```

### setup.cjs 核心设计

使用 Node.js 内置 `readline` 模块，零第三方依赖。

```js
const readline = require('readline')

function createPrompt() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return {
    // 普通输入
    async input(question, defaultValue) { ... },
    // 脱敏输入（API Key）
    async secret(question, defaultValue) { ... },
    // 单选
    async select(question, options, defaultIndex) { ... },
    // 多选
    async multiselect(question, options, defaultIndices) { ... },
    // 确认
    async confirm(question, defaultYes) { ... },
    close() { rl.close() },
  }
}
```

### 配置项驱动

用数组定义配置项，循环驱动交互：

```js
const CONFIG_ITEMS = [
  {
    key: 'projectPath',
    title: '项目根目录',
    description: '需要国际化的项目所在目录，相对于本脚本的位置',
    type: 'input',
    default: './',
  },
  // ...
]
```

### 输入校验

- `projectPath`：路径不存在时给出警告但允许继续
- `entry`：非空即可
- `sourceLanguage`：必须在选项范围内
- `targetLanguages`：至少选一个
- `ai.apiKey`：启用 AI 时不能为空
- `ai.baseURL`：必须以 `http://` 或 `https://` 开头

### 配置文件读写

- **读取**：动态 `import()` 加载 ESM 格式的 `i18n.config.js`
- **写入**：生成带注释的 JS 文件，保持 `export default { ... }` 格式
- **脱敏**：读取到的 API Key 显示为 `****`（前 4 位 + 后 4 位保留中间用 `****` 替代）

## 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `scripts/i18n-scan/setup.cjs` | 新建 | 配置向导 + 功能菜单 |
| `scripts/i18n-scan/index.cjs` | 修改 | 无参数时调用 setup.cjs，有参数保持原有逻辑 |

## 不变更

- `scanner.cjs`、`translator.cjs`、`replacer.cjs`、`init.cjs` 等核心模块
- `parsers/`、`generators/`、`utils/` 子模块
- `i18n.config.js` 配置文件格式
- 命令行参数 `--scan`、`--translate`、`--dry-run`、`--gap`、`--init`、`--all` 的行为
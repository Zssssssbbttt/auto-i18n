# toi18n — Vue 3 i18n 自动化工具

## 项目概述

这是一个 **Vue 3 国际化（i18n）自动化脚本工具集**，位于 `scripts/i18n-scan/`。核心功能：扫描 Vue 文件中的硬编码中文 → 替换为 `$t()` 调用 → 生成/更新语言包 JSON → 支持 AI 自动翻译。

## 脚本入口

`scripts/i18n-scan/index.cjs` — CLI 入口，支持以下模式：

| 命令 | 功能 |
|------|------|
| `-a` / `--all` | 全流程：依赖检查 → init → translate → scan |
| `-i` / `--init` | 初始化 locales 目录结构 |
| `-t` / `--translate` | AI 翻译（扫描中文 → 去重 → 调 API → 写回语言包） |
| `-d` / `--dry-run` | 预览模式，只输出不修改文件 |
| `-s` / `--scan` | 执行替换（修改源文件 + 更新语言包） |
| `-g` / `--gap` | 盲区扫描（输出所有中文，不受配置白名单限制） |
| 无参数 | 交互模式：配置向导 → 依赖检查 → 初始化 → AI翻译(可选) → 预览 → 替换 |

交互模式和 `--all` 模式在初始化前会自动检查项目 `package.json` 中是否有 `vue-i18n` 依赖，缺失则自动安装（自动识别 npm/yarn/pnpm）。

## 模块架构

```
scripts/i18n-scan/
  index.cjs              # CLI 入口，串联全流程
  scanner.cjs            # 文件扫描（fast-glob），调用 SFC 解析器
  replacer.cjs           # 源码替换器，将中文替换为 $t() 调用，自动注入 import
  translator.cjs         # AI 翻译模块（OpenAI 兼容 API），含缺口检测+补齐+重试
  init.cjs               # 初始化 locales 目录，根据 uiLibrary 配置生成 index.ts（Element Plus 模板 / 精简模板）
  setup.cjs              # 交互式配置向导 + 功能菜单（readline 实现）
  parsers/
    vue-sfc-parser.cjs   # 解析 .vue 单文件组件（@vue/compiler-sfc）
    template-parser.cjs  # 解析 Vue 模板 AST（@vue/compiler-dom）
    script-parser.cjs    # 解析 JS/TS AST（@babel/parser + traverse）
  generators/
    key-generator.cjs    # 在 locale 反向映射中查找中文对应的 key
    locale-manager.cjs   # 读写 locale JSON 文件，构建反向映射 {中文: module.key}
  utils/
    chinese-detector.cjs # 中文检测（正则 /[一-龥]/）
    logger.cjs           # 控制台格式化输出
    validate-locales.cjs # 外部语言包校验（路径存在、文件齐全、key 数量一致）
```

## 核心工作流

### 初始化流程
1. 检查项目 `package.json` 中是否有 `vue-i18n` 依赖，缺失则自动安装（识别 npm/yarn/pnpm）
2. 校验 `sharedLocales`（如有配置）：路径存在、语言文件齐全、key 数量一致。校验失败时交互模式询问是否继续（跳过共享包），非交互模式自动跳过
3. 根据 `uiLibrary` 配置生成 `index.ts`：
   - `"element-plus"` → 完整模板：含 Element Plus locale 集成、语言切换同步（watch + install 拦截）
   - `"vant"` 或 `"none"` → 精简模板：仅 vue-i18n 核心配置，无 UI 库耦合
   - 有共享包时生成 `deepMerge` 工具函数，messages 使用深度合并（共享包在前，项目包覆盖在后）
4. 创建语言包空文件（zh-CN.json / en.json 等）
5. 生成 `typeToString.ts`（TS 类型转换辅助）和 `useI18n.ts`（composable）
6. 更新 `main.ts`：补全 i18n 引入、全局 `$t` 注册、`@vnet/i18n` 注册（`getComponentMessages` + `mergeLocaleMessage` + `setI18nInstance`）、`app.use(i18n)`

### 扫描流程
1. 加载 `i18n.config.js` 配置
2. 加载现有 locale 文件，构建反向映射 `{ "中文": "module.key" }`
3. fast-glob 匹配文件 → 逐文件 SFC 解析 → template AST + script AST 提取中文
4. 分类输出：**已匹配**（locale 中有 key）、**未匹配**（无 key）、**特殊**（模板字符串插值/字符串拼接，需人工处理）

### 替换流程
1. 按文件分组，从后往前按行替换（避免行号偏移）
2. 根据类型生成对应替换：`label="中文"` → `:label="$t('key')"`、`<span>中文</span>` → `<span>{{ $t('key') }}</span>`、`'中文'` → `$t('key')`
3. 自动注入 `import { $t } from '@/locales'`（检测是否已有，避免重复）
4. 未匹配的中文追加到语言包 common 模块

### AI 翻译流程
1. 扫描 Vue 文件提取中文 → 去重
2. 加载已有翻译 + 参考语言包（去重合并）
3. 过滤已翻译 → 得到 untranslated（新文本）
4. 检测翻译缺口（zh-CN 有但目标语言缺失的 key）
5. 分批调用 OpenAI 兼容 API 翻译新文本 + 补齐缺口
6. 校验 AI 返回 → 失败自动重试（最多 3 次）→ 写回语言包
7. 未匹配项写入日志文件

## 配置文件 `i18n.config.js`

脚本行为完全由同级目录的 `i18n.config.js` 驱动，关键配置项：

- `projectPath` — 项目根目录
- `entry` / `exclude` — 扫描范围（glob 模式）
- `uiLibrary` — UI 组件库类型（`"element-plus"` / `"vant"` / `"none"`），决定生成的 `index.ts` 模板和 `translateMethods` 默认值
- `translateAttributes` — 需要翻译的 HTML 属性白名单（如 label, placeholder, title）
- `ignoreAttributes` — 永远不翻译的属性黑名单（优先级更高）
- `translateMethods` — 需要翻译的方法调用白名单（支持通配符如 ElMessage.*）。默认值根据 `uiLibrary` 自动设置：Element Plus → `['ElMessage.*', 'ElMessageBox.*', 'ElNotification.*', 'alert', 'confirm']`，Vant → `['Toast', 'Toast.*']`，无组件库 → `[]`
- `sourceLanguage` / `targetLanguages` — 源语言和目标语言列表
- `output` — locale 输出目录（默认 src/locales）
- `ai.enabled` / `ai.apiKey` / `ai.baseURL` / `ai.model` — AI 翻译配置
- AI 提示词（systemPrompt、userPromptTemplate 等）为 `translator.cjs` 内部常量，不暴露在配置文件中
- `ai.referenceLocales` — 参考语言包路径（翻译时复用已有 key 映射，跳过重复翻译）
- `sharedLocales` — 共享语言包路径列表（相对于 projectPath）。初始化时 import 并深度合并到 i18n 实例的 messages 中，当前项目翻译优先级高于共享包。校验失败时交互模式询问是否继续，非交互模式自动跳过

## 扫描分类规则

| 类别 | 说明 | 处理 |
|------|------|------|
| 已匹配 | 中文在 locale 中有对应 key | 替换为 `$t('key')` |
| 未匹配 | 中文不在 locale 中 | 追加到语言包 common 模块 |
| 特殊 | 模板字符串插值、字符串 + 拼接 | 跳过，需人工处理 |

## 跳过规则（优先级从高到低）
1. `ignoreAttributes` 黑名单属性 → 跳过
2. 不在 `translateAttributes` 白名单的属性 → 跳过
3. 不在 `translateMethods` 白名单的方法调用参数 → 跳过
4. `exclude` 中的文件 → 跳过
5. 注释、import 声明、TS 类型注解 → 跳过
6. 已有 `$t()` 调用 → 跳过
7. 纯数字/英文/符号字符串 → 跳过

## 依赖

- `@vue/compiler-sfc` + `@vue/compiler-dom` — Vue 模板 AST 解析
- `@babel/parser` + `@babel/traverse` — JS/TS AST 解析
- `fast-glob` — 文件匹配
- Node.js 内置模块：`fs`, `path`, `readline`, `fetch`, `child_process`（Node 18+）

## 相关文档

- `md/i18n脚本使用指南.md` — 用户使用指南
- `md/DESIGN.md` — AI 翻译增强设计方案（缺口补齐）
- `md/PLAN.md` — 整体实现计划
- `md/DESIGN-setup.md` — 交互式配置设计方案
- `md/PLAN-setup.md` — 交互式配置实现计划
- `scripts/i18n-scan/README.md` — 脚本 README
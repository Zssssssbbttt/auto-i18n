# i18n-scan

Vue 3 国际化自动扫描脚本，将硬编码中文替换为 `$t()` 调用，支持 AI 翻译。

## 产物结构

```
i18n-tool/
├── i18n-scan.bundle.js   # 单文件脚本
├── i18n.config.js         # 配置文件
└── README.md              # 本文件
```

## 配置

脚本自动读取同级目录的 `i18n.config.js`。

```js
export default {
  // 项目根目录路径（必填，绝对路径或相对路径）
  projectPath: '/path/to/your-project',

  // 扫描范围
  entry: ['src/**/*.vue'],
  exclude: ['src/router.ts', 'src/views/print.vue'],

  // locales 输出目录（相对于 projectPath）
  output: 'src/locales',

  // 语言配置
  sourceLanguage: 'zh-CN',
  targetLanguages: ['en'],
  localeStorageKey: 'lang',

  // 需要翻译的 HTML 属性（白名单）
  translateAttributes: ['label', 'placeholder', 'title', 'message', 'content'],

  // 永远不翻译的属性（黑名单，优先级更高）
  ignoreAttributes: ['style', 'class', 'ref', 'key', 'id', 'type'],

  // 跳过这些方法的字符串参数
  ignoreMethods: ['console.log', 'console.error', 'includes', 'split'],

  // 日志目录
  logDir: 'logs',

  // AI 翻译配置
  ai: {
    enabled: true,
    apiKey: 'sk-xxx',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4',
    temperature: 0.3,
    maxTokens: 200000,
    batchSize: 200,
    systemPrompt: '你是一个 i18n 翻译助手...',
    userPromptTemplate:
      '文件路径：{filePath}\n目标语言：{targetLanguages}\n...',
    // 参考语言包（复用已有翻译）
    referenceLocales: [],
  },
}
```

## 命令

| 短命令 | 长命令        | 功能                            |
| ------ | ------------- | ------------------------------- |
| `-d`   | `--dry-run`   | 预览模式，不修改文件            |
| `-s`   | `--scan`      | 执行替换（默认）                |
| `-t`   | `--translate` | AI 翻译                         |
| `-g`   | `--gap`       | 盲区扫描                        |
| `-i`   | `--init`      | 初始化 locales 目录             |
| `-a`   | `--all`       | 全流程：init → translate → scan |

## 使用示例

```bash
# 全流程一键处理
node i18n-scan.bundle.js -a

# 分步执行
node i18n-scan.bundle.js -i    # 1. 初始化 locales 目录
node i18n-scan.bundle.js -t    # 2. AI 翻译
node i18n-scan.bundle.js -d    # 3. 预览替换结果
node i18n-scan.bundle.js -s    # 4. 执行替换

# 盲区扫描（查看所有中文，不受白名单限制）
node i18n-scan.bundle.js -g
```

## 工作流程

### 全流程 (`-a`)

```
init → translate → scan
  │        │         └─ 替换源文件中所有中文为 $t() 调用
  │        └─ 扫描中文 → AI 翻译 → 写回语言包
  └─ 创建 src/locales/ 目录结构和基础文件
```

### 扫描分类

| 类别   | 说明                       | 处理                     |
| ------ | -------------------------- | ------------------------ |
| 已匹配 | 中文在 locale 中有对应 key | 直接替换为 `$t('key')`   |
| 未匹配 | 中文不在 locale 中         | 追加到语言包 common 模块 |
| 特殊   | 模板字符串插值、字符串拼接 | 跳过，需人工处理         |

### 属性白名单

只有 `translateAttributes` 中的属性会被处理，指令属性（`v-if`、`@click` 等）不在白名单则忽略。`ignoreAttributes` 优先级更高。

## 生成的文件

执行 `-i` 或 `-a` 后，在 `{projectPath}/src/locales/` 下生成：

```
src/locales/
├── zh-CN.json        # 中文语言包
├── en.json           # 英文语言包
├── index.ts          # vue-i18n 配置 + Element Plus 集成
├── typeToString.ts   # 类型转换工具
└── useI18n.ts        # composable
```

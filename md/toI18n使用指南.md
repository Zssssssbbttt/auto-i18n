# toI18n — 使用指南

## 快速开始

```bash
# 交互模式（推荐首次使用）：配置向导 → 翻译 → 预览 → 替换
node toI18n.cjs

# 预览模式：只看将要改什么，不动文件
node toI18n.cjs -d

# 一键全流程：init → translate → scan
node toI18n.cjs -a
```

---

## 1. 执行流程

工具分四步执行，**每一步完成后都可以暂停查看结果，再决定是否继续**：

```
第 1 步：配置确认
  → 终端对话式向导，只需回答几个关键问题
  → 其余配置自动写入文件，直接回车保留默认值

第 2 步：AI 翻译（可选）
  → 扫描项目中所有中文 → 去重 → 调用 AI 翻译为目标语言
  → 翻译结果展示完毕后暂停，用户可检查翻译质量

第 3 步：预览扫描
  → 逐文件展示将要做的每一项改动（原文本 → 替换结果）
  → 已匹配、未匹配、需人工处理的条目分别归类展示

第 4 步：执行替换
  → 用户最终确认后，执行源码修改 + 语言包更新
  → 自动注入 import 语句
```

**每一步都有 Y/n 确认**，中途 Ctrl+C 安全退出，不产生半成品。

---

## 2. 命令行参数

| 参数 | 简写 | 功能 |
|------|------|------|
| 无参数 | — | 交互模式：配置向导 → 依赖检查 → 初始化 → AI翻译(可选) → 预览 → 替换 |
| `--all` | `-a` | 全流程一键执行：init → translate → scan |
| `--init` | `-i` | 初始化 locales 目录结构和配置文件 |
| `--translate` | `-t` | AI 翻译：扫描中文 → 去重 → 调 API → 写回语言包 |
| `--dry-run` | `-d` | 预览模式，只展示改动明细，不修改文件 |
| `--scan` | `-s` | 执行替换：修改源文件 + 更新语言包 |
| `--gap` | `-g` | 盲区扫描：列出所有中文，定位配置遗漏 |

```bash
node toI18n.cjs -d    # 只看将要改什么，不动文件
node toI18n.cjs -t    # 只执行 AI 翻译
node toI18n.cjs -a    # 一键全流程
```

---

## 3. 配置向导

首次运行交互模式时，对话式配置只需回答几个关键问题：

| 步骤 | 问题 | 说明 |
|------|------|------|
| 1 | 项目根目录 | 需要国际化的项目路径 |
| 2 | 源码语言 / 目标语言 | 目标语言多选（en、th、ja、ko 等） |
| 3 | 是否启用 AI 翻译 | 启用后补充 API Key（脱敏输入）、地址、模型名称（预设可选） |
| 4 | 是否扫描 script 中的中文 | 总开关，关闭则只处理模板 |
| 5 | Script 翻译目标变量 | 精确配置哪些变量的哪些属性需要翻译 |
| 6 | 是否用 computed 包裹 | const 声明变量包裹后翻译结果响应式更新 |
| 7 | UI 组件库 | 选择 Element Plus / Vant / 无，决定模板和翻译方法默认值 |

**AI 模型预设**：gpt-4o、gpt-4、deepseek-v4-pro、deepseek-chat、claude-sonnet-4-6 等，方向键选择；也可选「自定义」手动输入任意模型名。

**其余配置**（属性白名单、黑名单、方法白名单、排除文件、Key 风格等）在初始化时自动写入 `i18n.config.js`，无需在对话中逐项确认。需要微调时直接编辑配置文件即可。

### 交互细节

- 方向键 `↑↓` 导航选择，Enter 确认
- API Key 脱敏（输入时显示 `*`，已有值显示 `sk-Ix****RI8C`）
- 确认完毕一次性写入，Ctrl+C 退出不产生半成品

---

## 4. 配置文件 `i18n.config.js`

初始化后自动生成在项目根目录，完整配置项：

```js
export default {
  // 项目根目录路径
  projectPath: './program/vue3-fundTransfer',

  // 扫描范围（glob 模式）
  entry: ['src/**/*.{vue,js,ts,jsx,tsx}'],

  // 排除文件
  exclude: ['src/router.ts'],

  // 是否扫描 <script> 中的中文（总开关）
  scanScript: false,

  // UI 组件库：element-plus / vant / none
  // 影响生成的 locales/index.ts 模板和 translateMethods 默认值
  uiLibrary: 'element-plus',

  // 共享语言包路径（相对于 projectPath）
  sharedLocales: [],

  // locale 文件输出目录
  output: 'src/locales',

  // 源码语言（作为 key 来源）
  sourceLanguage: 'zh-CN',

  // 目标语言列表
  targetLanguages: ['en'],

  // localStorage 中存储语言设置的 key
  localeStorageKey: 'ZXY_locale',

  // 需要翻译的 HTML 属性（白名单）
  translateAttributes: [
    'label', 'placeholder', 'title', 'title-info', 'alt',
    'message', 'content', 'desc', 'text', 'header', 'menuTitle',
  ],

  // 永远不翻译的属性（黑名单，优先级高于白名单）
  ignoreAttributes: [
    'style', 'class', 'ref', 'rules', 'model', 'prop',
    'key', 'slot', 'name', 'id', 'type', 'format',
    'value-format', 'range-separator', 'prefix-icon', 'suffix-icon',
    'scoped', 'lang', 'src', 'href', 'target', 'width', 'size',
    'mode', 'disabled', 'clearable', 'filterable', 'remote',
    'reserve-keyword', 'multiple', 'show-overflow-tooltip',
    'align', 'maxlength', 'rows', 'trigger', 'icon',
  ],

  // 需要翻译的方法调用（白名单，支持通配符如 ElMessage.*）
  translateMethods: [
    'ElMessage.*', 'ElMessageBox.*', 'ElNotification.*', 'alert', 'confirm',
  ],

  // key 命名风格
  keyStyle: 'camelCase',

  // 日志输出目录
  logDir: 'logs',

  // AI 翻译配置
  ai: {
    enabled: true,
    referenceLocales: [],          // 参考语言包，翻译时优先复用已有翻译
    apiKey: 'sk-xxx',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    temperature: 0.3,
    maxTokens: 200000,
    batchSize: 200,                // 每批最多翻译条数
  },
}
```

---

## 5. 模板替换规则

### 5.1 自动替换的情况

| 类型 | 原始写法 | 替换后 |
|------|----------|--------|
| 静态属性 | `<el-input label="申请人" />` | `<el-input :label="$t('common.applicant')" />` |
| 动态属性 | `:placeholder="status === 1 ? '已通过' : '待审核'"` | `:placeholder="status === 1 ? $t('common.passed') : $t('common.pending')"` |
| 文本内容 | `<el-button>确认删除</el-button>` | `<el-button>{{ $t('common.confirmDelete') }}</el-button>` |
| 插值表达式 | `{{ status === 1 ? '启用' : '禁用' }}` | `{{ status === 1 ? $t('common.enable') : $t('common.disable') }}` |

### 5.2 自动跳过的情况

| 原始写法 | 跳过原因 |
|----------|----------|
| `<div class="中文类名">` | `class` 在 ignoreAttributes 黑名单 |
| `v-if="status === '已通过'"` | 指令名不是 bind，无法确定属性名 |
| `@click="handle('确认')"` | 事件绑定，不在白名单 |
| `{{ $t('already.translated') }}` | 已被 `$t()` 包裹，避免二次替换 |

### 5.3 标记为"特殊-未处理"的情况

| 类型 | 示例 | 原因 |
|------|------|------|
| 不在白名单的属性 | `empty-text="暂无数据"` | 自定义组件属性，可能也需要翻译但需确认 |
| 模板字符串含变量 | `` `共${total}条记录` `` | 变量参数需人工设计 |
| 字符串拼接 | `'完成时间：' + date` | 拼接语序问题需人工处理 |
| 字符串含 HTML 标签 | `'当<b>不是</b>时'` | 避免 AI 翻译破坏 HTML 标签结构 |

---

## 6. Script 标签配置详解

### 6.1 `scriptTargets` — 翻译目标变量

精确指定需要翻译的变量名及其属性，采用**正向匹配**模式——只有在配置中声明的变量才会被翻译。

```js
// i18n.config.js
scriptTargets: {
  columns: ['label', 'title'],   // 只翻译 columns 中 label、title 属性
  rules: ['message'],             // 只翻译 rules 中 message 属性
  options: [],                    // [] = 翻译该变量内所有中文（全量递归）
}
```

**对话式配置中的输入格式**（空格分隔多个变量，冒号后跟属性列表）：

```
columns:label,title  rules:message  options
```

**规则要点：**

- **不在配置中的变量不会被翻译**（宁可漏，也不瞎改）
- 属性数组为空 `[]` 表示全量翻译该变量内所有中文
- 支持深层嵌套对象和数组嵌套的递归处理
- **接口数据自动跳过**：变量 init 为函数调用（非 ref/reactive）或 await 时，认为数据来自接口，不翻译
- `ref()` 和 `reactive()` 包裹的值会自动展开后处理

**替换示例：**

| 场景 | 原始写法 | 替换后 |
|------|----------|--------|
| 对象属性 | `{ label: '请输入名称' }` | `{ label: $t('common.pleaseEnterName') }` |
| 三元表达式 | `{ label: cond ? '是' : '否' }` | `{ label: cond ? $t('k1') : $t('k2') }` |
| 模板插值 | `` `共${n}条记录` `` | `` `${$t('k1')}${n}${$t('k2')}` `` |
| 字符串拼接 | `'共' + n + '条'` | `$t('k1') + n + $t('k2')` |

### 6.2 `scriptReactive` — 响应式包裹

控制是否对纯文本值 `const` 声明的翻译目标用 `computed(() => ...)` 包裹，使翻译结果随语言切换响应式更新。默认 `false`。

```js
// 替换前
export const columns = [{ label: '姓名' }]
export const title = '页面标题'

// scriptReactive: true → 包裹 computed
import { computed } from 'vue'
export const columns = computed(() => [{ label: $t('common.name') }])
export const title = computed(() => $t('common.page_title'))

// scriptReactive: false（默认）→ 直接替换
export const columns = [{ label: $t('common.name') }]
export const title = $t('common.page_title')
```

- 仅对 `const` 声明的变量生效，`let`/`var` 永不包裹
- 仅当 init 为纯字符串/模板字符串时生效，`ref()`/`reactive()` 包裹的变量不处理
- 包裹时自动注入 `import { computed } from 'vue'`

### 6.3 `translateMethods` — 方法调用白名单

指定哪些函数调用的参数需要翻译，支持精确匹配和通配符。

```js
translateMethods: [
  'ElMessage.*',         // 通配符：匹配 ElMessage.success / .warning / .error 等
  'ElMessageBox.*',      // 通配符：匹配 ElMessageBox.confirm / .alert 等
  'ElNotification.*',    // 通配符：匹配 ElNotification 所有子方法
  'alert',               // 精确匹配：全局 alert('提示')
  'confirm',             // 精确匹配：全局 confirm('确认删除？')
]
```

| 原始写法 | 替换后 |
|----------|--------|
| `ElMessage.warning('请先选择数据')` | `ElMessage.warning($t('common.pleaseSelectData'))` |
| `ElMessageBox.confirm('确认删除？')` | `ElMessageBox.confirm($t('common.confirmDeleteQ'))` |
| `ElMessage.success('操作成功')` | `ElMessage.success($t('common.operationSuccess'))` |

默认值根据 `uiLibrary` 自动设置：Element Plus → `ElMessage.*` 等，Vant → `Toast.*`，无组件库 → 空。

---

## 7. 外部共享语言包

### 使用场景

多个项目共用一套公共组件的翻译时，可将公共语言包作为共享包引入，避免每个项目重复维护相同翻译。

### 配置方式

```js
// i18n.config.js
sharedLocales: ['../common-ui/src/locales']
```

### 目录结构

```
common-locales/
  zh-CN.json
  en.json
```

### 合并策略

深度合并，共享语言包在前，项目语言包覆盖在后——项目可以对共享包中的任意 key 进行覆盖：

```js
// 共享包 zh-CN.json
{ "common": { "confirm": "确认", "startTime": "开始时间" } }

// 项目 zh-CN.json
{ "common": { "confirm": "确定" } }

// 合并结果：项目覆盖共享
{ "common": { "confirm": "确定", "startTime": "开始时间" } }
```

### 校验规则

共享包必须同时满足以下三条，否则跳过（交互模式下允许用户选择是否继续）：

1. **路径存在** — 配置的目录路径必须存在
2. **语言文件齐全** — 必须包含源语言和全部目标语言的 `.json` 文件
3. **Key 数量一致** — 各语言文件的 key 数量必须与源语言一致

---

## 8. 新增语言

只需两步：

```
1. 在 i18n.config.js 的 targetLanguages 中添加语言代码，如 ['en', 'th']
2. 重新执行 node toI18n.cjs
```

工具自动检测已有中文翻译中哪些语言缺失，调用 AI 一次性补齐，**已有翻译完全不受影响**。

实际运行效果（新增泰语为例）：

```
[2/4] 加载已有翻译...
  本项目语言包: 96 条
  翻译缺口: 96 条

[3b/4] 补齐翻译缺口...
  缺口组 [th]: 96 条，分 1 批
    ✓ 完成

AI 翻译完成
  新增翻译:     0
  缺口补齐:     96
  失败批次:     0
```

三个语言包（zh-CN / en / th）各 96 条，结构完全一致，原有 en.json 零修改。

---

## 9. 生成的 locale 文件结构

```json
{
  "common": {
    "search": "查询",
    "reset": "重置",
    "confirm": "确定"
  },
  "form": {
    "applicant": "申请人",
    "title": "标题"
  },
  "validation": {
    "pleaseSelectApplicant": "请选择申请人"
  },
  "table": {
    "no": "序号",
    "processNo": "流程号"
  },
  "message": {
    "companyCannotOperate": "该公司不能对此功能进行操作！"
  }
}
```

---

## 10. 初始化对 main.ts 的修改

执行 `-i` 或 `--all` 时，脚本会自动修改 `src/main.ts`，插入以下内容（每项都有去重检测）：

```ts
import { setI18nInstance, getComponentMessages } from '@vnet/i18n'
import i18n, { $t } from './locales'

const app = createApp(App)

// 全局注册 $t，模板中可直接使用
app.config.globalProperties.$t = $t

// 将公共组件词条合并到当前 i18n 实例
const compMsgs = getComponentMessages()
for (const locale of Object.keys(compMsgs)) {
  i18n.global.mergeLocaleMessage(locale, compMsgs[locale])
}
setI18nInstance(i18n)

app.use(i18n).mount('#app')
```

---

## 11. 组件库兼容

| uiLibrary | 适用场景 | 自动设置 |
|-----------|----------|---------|
| `element-plus` | PC 端 | 生成 Element Plus locale 集成代码（watch 同步 + install 拦截），translateMethods 默认 `ElMessage.*` 等 |
| `vant` | 移动端 | 生成精简模板，translateMethods 默认 `Toast.*` |
| `none` | 无组件库 | 仅 vue-i18n 核心配置，translateMethods 默认空 |

Element Plus 集成做了两件事确保组件库语言与项目语言始终保持一致：
- **watch 同步**：监听 i18n locale 变化，自动切换 Element Plus 语言包
- **install 拦截**：在 `app.use(i18n)` 时自动 provide Element Plus 的 locale

---

## 12. 注意事项

1. **先 dry-run**：执行 `-d` 预览所有改动，确认无误后再 `-s` 执行替换
2. **$t 全局可用**：`main.ts` 中已全局注册 `$t`，模板和脚本中直接使用，无需 import
3. **语言切换**：使用 vue-i18n 的 `locale` 响应式切换，无需手动刷新页面
4. **日志**：每次扫描会在 `logs/` 目录生成 JSON 日志文件，记录所有改动
5. **安全替换**：从后往前按行替换避免行号偏移，自动注入 import 避免遗漏
6. **Key 复用**：同一中文始终映射到同一 key，内置 100+ 常用词汇映射 + 已有语言包反向映射 + AI 生成
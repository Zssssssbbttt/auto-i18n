// i18n 自动扫描配置
// 用法: node scripts/i18n-scan/index.cjs
// 预览: node scripts/i18n-scan/index.cjs --dry-run
export default {
  // Vue 版本（2 或 3，默认自动检测）
  vueVersion: 2,

  // 项目根目录路径（绝对路径或相对于本配置文件的路径）
  projectPath: "../packages/officeCenter/applicationSystemServices",

  // 扫描范围
  entry: ["src/**/*.vue"],
  exclude: [],

  // 是否扫描 <script> 中的中文
  scanScript: true,

  // script 翻译目标变量（变量名 → 属性名数组，[] = 全量翻译）
  scriptTargets: {
    EmpowerRule: ["message"],
  },

  // 是否用 computed 包裹 const 声明的翻译目标
  scriptReactive: false,

  // UI 组件库（element-plus / element-ui / vant / none）
  uiLibrary: "element-ui",

  // 共享语言包路径（相对于 projectPath）
  // 初始化时会将指定目录下的语言文件 import 并合并到 i18n 实例的 messages 中
  // 当前项目自身的翻译优先级高于共享语言包（项目覆盖共享）
  sharedLocales: [],

  // 输出目录
  output: "src/locales",
  baseDir: "src",

  // 语言配置
  sourceLanguage: "zh-CN",
  targetLanguages: ["en", "th", "ja"],
  localeStorageKey: "ZXY_locale",

  // 需要翻译的 HTML 属性
  translateAttributes: [
    "label",
    "placeholder",
    "titleInfo",
    "title",
    "tip-content",
    "title-info",
    "alt",
    "message",
    "content",
    "desc",
    "text",
    "header",
    "menuTitle",
    "start-placeholder",
    "end-placeholder",
    "error",
    "tip",
    "label-text",
  ],

  // 永远不翻译的属性
  ignoreAttributes: [
    "style",
    "class",
    "ref",
    "rules",
    "model",
    "prop",
    "key",
    "name",
    "id",
    "type",
    "format",
    "value-format",
    "range-separator",
    "prefix-icon",
    "suffix-icon",
    "scoped",
    "lang",
    "src",
    "href",
    "target",
    "width",
    "size",
    "mode",
    "disabled",
    "clearable",
    "filterable",
    "remote",
    "reserve-keyword",
    "multiple",
    "show-overflow-tooltip",
    "align",
    "maxlength",
    "rows",
    "trigger",
    "icon",
  ],

  // 需要翻译的方法调用（白名单，支持通配符如 ElMessage.*）
  translateMethods: [
    "this.$message.*",
    "this.$confirm",
    "this.$alert",
    "this.$prompt",
    "this.$notify.*",
  ],

  // key 命名风格
  keyStyle: "camelCase",

  // 日志目录
  logDir: "logs",

  // AI 翻译配置
  ai: {
    enabled: true,

    // 参考语言包路径，翻译时优先复用已有翻译
    referenceLocales: [],

    // OpenAI 兼容 API 配置
    apiKey: "sk-vWxemQoctjoxDwujDz3aC53N6MRKzUND23U5xblrmn9UMass",
    baseURL: "https://wan.vnet.com/v1",
    model: "deepseek-v4-pro",
    temperature: 0.3,
    maxTokens: 200000,

    // 每批最多翻译条数
    batchSize: 200,
  },
};

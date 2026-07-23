// i18n 自动扫描配置
// 用法: node scripts/i18n-scan/index.cjs
// 预览: node scripts/i18n-scan/index.cjs --dry-run
export default {
  // 项目根目录路径（绝对路径或相对于本配置文件的路径）
  projectPath: "./program/vue3-fundTransfer",

  // 扫描范围
  entry: ["src/**/*.vue"],
  exclude: ["src/router.ts","src/utils/*.ts","src/views/print.vue"],

  // 是否扫描 <script> 中的中文
  scanScript: true,

  // 输出目录
  output: "src/locales",
  baseDir: "src",

  // 语言配置
  sourceLanguage: "zh-CN",
  targetLanguages: ["en"],
  localeStorageKey: "ZXY_locale",

  // 需要翻译的 HTML 属性
  translateAttributes: ["label","placeholder","title","title-info","alt","message","content","desc","text","header","menuTitle","start-placeholder","end-placeholder","error","tip"],

  // 永远不翻译的属性
  ignoreAttributes: ["style","class","ref","rules","model","prop","key","slot","name","id","type","format","value-format","range-separator","prefix-icon","suffix-icon","scoped","lang","src","href","target","width","size","mode","disabled","clearable","filterable","remote","reserve-keyword","multiple","show-overflow-tooltip","align","maxlength","rows","trigger","icon"],

  // 跳过这些方法的字符串参数
  ignoreMethods: ["console.log","console.error","console.warn","console.info","openTag","indexOf","includes","split","toString"],

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
    apiKey: "sk-ImMyS8coROCmzb0CQmkcpHHRdu3wrFPBfN0GcDVPEmAZRI8C",
    baseURL: "https://wan.vnet.com/v1",
    model: "deepseek-v4-pro",
    temperature: 0.3,
    maxTokens: 200000,

    // 每批最多翻译条数
    batchSize: 200,

    // 系统提示词
    systemPrompt: "# 角色定义\n你是一个严谨的 Vue 项目 i18n 国际化翻译助手。你的核心职责是接收一段或多段中文文本，将其翻译为目标语言，并生成结构清晰、语义准确且符合前端工程规范的 JSON 映射对象。\n\n# 任务目标\n将输入的中文文本翻译成指定的目标语言（如英文），并为每条翻译文本生成一个合理的嵌套 Key，最终输出一个严格符合格式要求的 JSON 对象。\n\n# 硬性规则（必须遵守，违反即视为错误）\n\n## 1. JSON 顶层 Key 规则（最高优先级）\n- 顶层 Key **必须**、**强制**使用输入的中文原文，**一字不改**。\n- 包括原文中的**所有空格、标点符号（全角/半角）、特殊字符**均需原样保留在 Key 中。\n- **严禁**对原文进行任何形式的修改，包括但不限于：\n  - ❌ 删除任何字符（如删除句号、问号、感叹号）\n  - ❌ 添加任何字符（如添加省略号 `...`、句号、空格等）\n  - ❌ 替换任何字符（如将半角逗号改为全角逗号，或将中文括号改为英文括号）\n  - ❌ 调整顺序或改变格式\n- ✅ 正确示例：原文 `加载中` → Key 必须为 `\"加载中\"`\n- ❌ 错误示例：原文 `加载中` → Key 误写为 `\"加载中...\"`（添加了 `...`）\n\n## 2. 嵌套 Value Key 规则\n- 每个顶层 Key 对应的值是一个对象，该对象内部的 Key 为翻译条目的唯一标识符。\n- 该标识符必须使用 **camelCase（小驼峰）** 格式的英文，应**精准、简洁**地概括对应中文文本的核心含义。\n- 建议格式：`{模块前缀}{具体动作/名词}`，例如 `commonConfirm`、`formValidateError`。\n\n## 3. 模块名（module）推断规则\n根据输入文本的使用场景，推断其所属模块，作为嵌套对象的分组依据：\n- `common` — 通用界面元素（如\"确认\"、\"取消\"、\"关闭\"）\n- `validation` — 表单校验提示（如\"请输入用户名\"、\"密码不能为空\"）\n- `placeholder` — 输入框占位符（如\"搜索关键字\"、\"请选择日期\"）\n- `flow` — 业务流程描述（如\"提交成功\"、\"正在处理中\"）\n- `status` — 状态提示（如\"加载中\"、\"暂无数据\"）\n- 若无法明确归类，根据语义推断业务领域（如 `user`、`order`、`dashboard`）\n\n## 4. 翻译内容规则\n- 翻译为目标语言时，应保持**语义准确、自然流畅**。\n- 翻译内容**不必**与中文原文在标点符号上严格一一对应，但应遵循目标语言的标准表达习惯。\n- 例如：中文 `加载中` 可译为 `Loading`，而不必添加 `...`。\n\n## 5. 输出格式要求（绝对严格）\n- **最终输出必须是一个纯 JSON 对象**。\n- **禁止**在输出内容前后添加任何文字说明、注释、Markdown 代码块标记（如 ```json 或 ```）。\n- **禁止**输出任何解释性、分析性或无关的文本内容。\n- 确保 JSON 格式合法，可被 `JSON.parse()` 直接解析。\n- 整个输出只能包含一个 JSON 对象，不能包含多个顶层对象或数组包裹。\n\n# 禁止项清单（红线，不可触碰）\n| 禁止行为 | 说明 |\n|---------|------|\n| 修改顶层 Key 中的中文原文 | 包括删除、添加、替换任何字符，哪怕是一个空格或一个标点 |\n| 在中文原文后添加省略号 `...` | 如 `加载中` → `加载中...` 绝对禁止 |\n| 在中文原文后添加句号或问号 | 如 `确认` → `确认。` 绝对禁止 |\n| 删除中文原文中的句号、问号等 | 如 `提交成功。` → `提交成功` 绝对禁止 |\n| 输出非 JSON 格式的内容 | 如添加解释、注释、Markdown 标记等 |\n| 合并多条文本到同一个 Key | 每条中文文本必须独立成键 |\n\n# 重要提醒\n- **顶层 Key 是中文原文的\"镜像\"**，必须做到字符级别的一致。\n- 如果原文有句号，Key 中就有句号；如果原文没有，Key 中就没有。\n- 嵌套 Key（英文 camelCase）可以自由设计，不受此限制。",

    // 用户提示词模板
    userPromptTemplate: "文件路径：{filePath}\n目标语言：{targetLanguages}\n\n请为以下中文文本生成 key 和翻译，输出 JSON 格式：\n{chineseTexts}\n\n输出格式示例：\n{\"发起人\": {\"key\": \"accredit.sponsor\", \"en-US\": \"Sponsor\"}, \"请选择\": {\"key\": \"common.pleaseSelect\", \"en-US\": \"Please select\"}}",

    // 缺口补齐翻译的系统提示词
    gapSystemPrompt: "你是一个 i18n 翻译助手。请将给定的中文文本翻译为指定的目标语言。\n每条文本已有固定的 key 路径，你只需要将 JSON 中的空字符串替换为对应翻译。\n严格保持 JSON 结构不变，不要修改任何 key，不要添加或删除任何字段。\n只输出填充后的 JSON 对象，不要添加任何其他内容。",

    // 缺口补齐翻译的用户提示词模板
    gapUserPromptTemplate: '',
  },
}

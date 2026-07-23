/**
 * i18n 脚本 — 交互式配置向导
 *
 * 使用 Node.js 内置 readline 模块，零第三方依赖。
 * 提供终端对话式配置创建/修改 i18n.config.js。
 */

const readline = require("readline");
const path = require("path");
const fs = require("fs");

// ============================================================
// 终端颜色
// ============================================================

function gray(text) {
  return `\x1b[90m${text}\x1b[0m`;
}

function yellow(text) {
  return `\x1b[33m${text}\x1b[0m`;
}

function green(text) {
  return `\x1b[32m${text}\x1b[0m`;
}

function cyan(text) {
  return `\x1b[36m${text}\x1b[0m`;
}

function bold(text) {
  return `\x1b[1m${text}\x1b[0m`;
}

// ============================================================
// 分隔线
// ============================================================

function separator(title) {
  const width = 60;
  if (title) {
    const pad = Math.max(0, (width - title.length - 2) / 2);
    const left = "=".repeat(Math.floor(pad));
    const right = "=".repeat(Math.ceil(pad));
    console.log(`\n${left} ${title} ${right}`);
  } else {
    console.log("=".repeat(width));
  }
}

// ============================================================
// 底层 raw mode 输入工具
// ============================================================

/**
 * 进入 raw mode，逐键监听。返回 cleanup 函数。
 */
function rawListen(onData) {
  const prevRaw = process.stdin.isRaw;
  const prevPaused = process.stdin.isPaused();
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const handler = (buf) => {
    const str = buf.toString();
    for (const char of str) {
      onData(char);
    }
  };
  process.stdin.on("data", handler);

  return function cleanup() {
    process.stdin.setRawMode(prevRaw || false);
    process.stdin.removeListener("data", handler);
    if (prevPaused) {
      process.stdin.pause();
    }
  };
}

// ============================================================
// 路径 Tab 补全
// ============================================================

/**
 * 根据用户输入补全文件系统路径
 * @param {string} input - 用户当前输入
 * @param {string} baseDir - 解析相对路径的基准目录
 * @returns {{ matches: string[], completed: string, commonPrefix: string|null }}
 */
function tabCompletePath(input, baseDir) {
  const normalized = input.replace(/\\/g, "/");

  // 分离目录部分和正在输入的文件名部分
  const lastSlash = normalized.lastIndexOf("/");
  const dirPart = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : "";
  const partial = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;

  // 解析目录
  const resolvedDir = path.resolve(baseDir, dirPart || ".");

  // 目录不存在则无匹配
  if (!fs.existsSync(resolvedDir)) {
    return { matches: [], completed: input, commonPrefix: null };
  }
  let stat;
  try {
    stat = fs.statSync(resolvedDir);
  } catch {
    return { matches: [], completed: input, commonPrefix: null };
  }
  if (!stat.isDirectory()) {
    return { matches: [], completed: input, commonPrefix: null };
  }

  // 列出匹配项
  let entries;
  try {
    entries = fs.readdirSync(resolvedDir);
  } catch {
    return { matches: [], completed: input, commonPrefix: null };
  }

  const matches = entries
    .filter((e) => e.startsWith(partial))
    .map((e) => {
      try {
        return fs.statSync(path.join(resolvedDir, e)).isDirectory()
          ? e + "/"
          : e;
      } catch {
        return e;
      }
    })
    .sort();

  if (matches.length === 0) {
    return { matches: [], completed: input, commonPrefix: null };
  }

  if (matches.length === 1) {
    return { matches, completed: dirPart + matches[0], commonPrefix: null };
  }

  // 计算公共前缀
  let commonLen = partial.length;
  const first = matches[0];
  while (commonLen < first.length) {
    const ch = first[commonLen];
    if (matches.every((m) => m[commonLen] === ch)) {
      commonLen++;
    } else {
      break;
    }
  }

  const commonPrefix =
    commonLen > partial.length ? dirPart + first.slice(0, commonLen) : null;

  return { matches, completed: input, commonPrefix };
}

// ============================================================
// 交互提示工具
// ============================================================

function createPrompt() {
  let rl = null;

  function getRl() {
    if (!rl) {
      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }
    return rl;
  }

  function closeRl() {
    if (rl) {
      rl.close();
      rl = null;

      process.stdin.resume();
    }
  }

  /**
   * 普通文本输入
   */
  function input(title, description, defaultValue) {
    return new Promise((resolve) => {
      if (description) {
        console.log(`  ${gray(description)}`);
      }
      const hint = defaultValue ? ` [${defaultValue}]` : "";
      getRl().question(`${title}${hint}: `, (answer) => {
        resolve(answer.trim() || defaultValue || "");
      });
    });
  }

  /**
   * 路径输入（使用 readline completer 支持 Tab 补全目录/文件名）
   */
  function pathInput(title, description, defaultValue) {
    return new Promise((resolve) => {
      closeRl();

      if (description) {
        console.log(`  ${gray(description)}`);
      }
      const hint = defaultValue ? ` [${defaultValue}]` : "";
      const promptText = `${title}${hint}: `;

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer: (line) => {
          const result = tabCompletePath(line, process.cwd());
          if (result.matches.length === 0) {
            return [[], line];
          }
          // readline 用 hits 数组做公共前缀补全，用 line 做展示过滤
          return [result.matches, line];
        },
      });

      rl.question(promptText, (answer) => {
        rl.close();
        resolve(answer.trim() || defaultValue || "");
      });
    });
  }

  /**
   * 脱敏输入（API Key），输入时显示 *
   */
  function secret(title, description, defaultValue) {
    return new Promise((resolve) => {
      // 关闭 readline，避免按键冲突
      closeRl();

      if (description) {
        console.log(`  ${gray(description)}`);
      }
      const hint = defaultValue ? ` [${maskApiKey(defaultValue)}]` : "";
      process.stdout.write(`${title}${hint}: `);

      let value = "";
      const cleanup = rawListen((char) => {
        switch (char) {
          case "\r":
          case "\n":
            process.stdout.write("\n");
            cleanup();
            resolve(value || defaultValue || "");
            break;
          case "\x03":
            process.stdout.write("\n");
            cleanup();
            process.exit(0);
            break;
          case "\x08":
          case "\x7f":
            if (value.length > 0) {
              value = value.slice(0, -1);
              process.stdout.write("\b \b");
            }
            break;
          default:
            if (char >= " ") {
              value += char;
              process.stdout.write("*");
            }
        }
      });
    });
  }

  /**
   * 单选 — 方向键 ↑↓ 移动，Enter 确认
   */
  function select(title, description, options, defaultIndex) {
    return new Promise((resolve) => {
      // 关闭 readline，避免按键冲突
      closeRl();

      if (description) {
        console.log(`  ${gray(description)}`);
      }

      let cursor = defaultIndex >= 0 ? defaultIndex : 0;
      const optionLines = options.length;

      renderOptions(options, cursor);
      process.stdout.write(`\n${gray("  ↑↓ 移动  Enter 确认")}`);

      let escapeBuf = "";
      const cleanup = rawListen((char) => {
        if (char === "\x1b") {
          escapeBuf = "\x1b";
          return;
        }
        if (escapeBuf === "\x1b") {
          escapeBuf += char;
          if (char === "[") return;
          escapeBuf = "";
          return;
        }
        if (escapeBuf === "\x1b[") {
          escapeBuf = "";
          clearLines(optionLines + 1);
          if (char === "A") {
            cursor = cursor > 0 ? cursor - 1 : options.length - 1;
          } else if (char === "B") {
            cursor = cursor < options.length - 1 ? cursor + 1 : 0;
          }
          renderOptions(options, cursor);
          process.stdout.write(`\n${gray("  ↑↓ 移动  Enter 确认")}`);
          return;
        }

        switch (char) {
          case "\r":
          case "\n":
            clearLines(optionLines + 1);
            renderOptions(options, cursor, true);
            process.stdout.write("\n");
            cleanup();
            resolve(options[cursor].value);
            break;
          case "\x03":
            process.stdout.write("\n");
            cleanup();
            process.exit(0);
            break;
        }
      });
    });
  }

  /**
   * 多选 — 方向键 ↑↓ 移动，Space 切换选中，Enter 确认
   */
  function multiselect(title, description, options, defaultIndices) {
    return new Promise((resolve) => {
      // 关闭 readline，避免按键冲突
      closeRl();

      if (description) {
        console.log(`  ${gray(description)}`);
      }

      const selected = new Set(defaultIndices);
      let cursor = defaultIndices.length > 0 ? defaultIndices[0] : 0;
      const optionLines = options.length;

      renderMultiOptions(options, cursor, selected);
      process.stdout.write(
        `\n${gray("  ↑↓ 移动  Space 选中/取消  Enter 确认")}`,
      );

      let escapeBuf = "";
      const cleanup = rawListen((char) => {
        if (char === "\x1b") {
          escapeBuf = "\x1b";
          return;
        }
        if (escapeBuf === "\x1b") {
          escapeBuf += char;
          if (char === "[") return;
          escapeBuf = "";
          return;
        }
        if (escapeBuf === "\x1b[") {
          escapeBuf = "";
          clearLines(optionLines + 1);
          if (char === "A") {
            cursor = cursor > 0 ? cursor - 1 : options.length - 1;
          } else if (char === "B") {
            cursor = cursor < options.length - 1 ? cursor + 1 : 0;
          }
          renderMultiOptions(options, cursor, selected);
          process.stdout.write(
            `\n${gray("  ↑↓ 移动  Space 选中/取消  Enter 确认")}`,
          );
          return;
        }

        switch (char) {
          case " ":
            clearLines(optionLines + 1);
            if (selected.has(cursor)) {
              selected.delete(cursor);
            } else {
              selected.add(cursor);
            }
            renderMultiOptions(options, cursor, selected);
            process.stdout.write(
              `\n${gray("  ↑↓ 移动  Space 选中/取消  Enter 确认")}`,
            );
            break;
          case "\r":
          case "\n":
            clearLines(optionLines + 1);
            if (selected.size === 0) {
              selected.add(cursor);
            }
            renderMultiOptions(options, cursor, selected, true);
            process.stdout.write("\n");
            cleanup();
            resolve(
              [...selected].sort((a, b) => a - b).map((i) => options[i].value),
            );
            break;
          case "\x03":
            process.stdout.write("\n");
            cleanup();
            process.exit(0);
            break;
        }
      });
    });
  }

  /**
   * 可编辑列表 — 展示默认值，用户可追加
   */
  function editableList(title, description, defaults, current) {
    return new Promise((resolve) => {
      const items = current && current.length > 0 ? current : defaults;
      console.log(`  ${gray(description)}`);
      console.log(`  ${gray("当前配置:")}`);
      for (const item of items) {
        console.log(`    ${gray("-")} ${item}`);
      }
      console.log(
        `  ${gray("输入要追加的内容（逗号分隔），直接回车保留当前配置")}`,
      );
      getRl().question(`${title}: `, (answer) => {
        const trimmed = answer.trim();
        if (!trimmed) {
          resolve([...items]);
          return;
        }
        const additions = trimmed
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const merged = [...items];
        for (const a of additions) {
          if (!merged.includes(a)) {
            merged.push(a);
          }
        }
        resolve(merged);
      });
    });
  }

  /**
   * 确认
   */
  function confirm(title, description, defaultYes) {
    return new Promise((resolve) => {
      if (description) {
        console.log(`  ${gray(description)}`);
      }
      const hint = defaultYes ? " [Y/n]" : " [y/N]";
      getRl().question(`${title}${hint}: `, (answer) => {
        const trimmed = answer.trim().toLowerCase();
        if (!trimmed) {
          resolve(defaultYes);
        } else {
          resolve(trimmed === "y" || trimmed === "yes");
        }
      });
    });
  }

  function close() {
    closeRl();
  }

  return {
    input,
    pathInput,
    secret,
    select,
    multiselect,
    editableList,
    confirm,
    close,
  };
}

// ============================================================
// 渲染辅助
// ============================================================

function clearLines(count) {
  for (let i = 0; i < count; i++) {
    process.stdout.write("\x1b[1A"); // 上移一行
    process.stdout.write("\x1b[2K"); // 清除当前行
  }
}

function renderOptions(options, cursor, isFinal) {
  for (let i = 0; i < options.length; i++) {
    const prefix = i === cursor ? cyan("❯ ") : "  ";
    const label =
      i === cursor && !isFinal ? cyan(options[i].label) : options[i].label;
    console.log(`${prefix}${label}`);
  }
}

function renderMultiOptions(options, cursor, selected, isFinal) {
  for (let i = 0; i < options.length; i++) {
    const checked = selected.has(i) ? green("◉") : "◯";
    const prefix = i === cursor ? cyan("❯") : " ";
    const label =
      i === cursor && !isFinal ? cyan(options[i].label) : options[i].label;
    console.log(`${prefix} ${checked} ${label}`);
  }
}

// ============================================================
// API Key 脱敏
// ============================================================

function maskApiKey(key) {
  if (!key || key.length <= 8) return key ? "****" : "";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

// ============================================================
// 默认值常量
// ============================================================

const DEFAULT_TRANSLATE_ATTRIBUTES = [
  "label",
  "placeholder",
  "title",
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
];

const DEFAULT_IGNORE_ATTRIBUTES = [
  "style",
  "class",
  "ref",
  "rules",
  "model",
  "prop",
  "key",
  "slot",
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
];

const DEFAULT_IGNORE_METHODS = [
  "console.log",
  "console.error",
  "console.warn",
  "console.info",
  "openTag",
  "indexOf",
  "includes",
  "split",
  "toString",
];

const AI_SYSTEM_PROMPT = `# 角色定义
你是一个严谨的 Vue 项目 i18n 国际化翻译助手。你的核心职责是接收一段或多段中文文本，将其翻译为目标语言，并生成结构清晰、语义准确且符合前端工程规范的 JSON 映射对象。

# 任务目标
将输入的中文文本翻译成指定的目标语言（如英文），并为每条翻译文本生成一个合理的嵌套 Key，最终输出一个严格符合格式要求的 JSON 对象。

# 硬性规则（必须遵守，违反即视为错误）

## 1. JSON 顶层 Key 规则（最高优先级）
- 顶层 Key **必须**、**强制**使用输入的中文原文，**一字不改**。
- 包括原文中的**所有空格、标点符号（全角/半角）、特殊字符**均需原样保留在 Key 中。
- **严禁**对原文进行任何形式的修改，包括但不限于：
  - ❌ 删除任何字符（如删除句号、问号、感叹号）
  - ❌ 添加任何字符（如添加省略号 \`...\`、句号、空格等）
  - ❌ 替换任何字符（如将半角逗号改为全角逗号，或将中文括号改为英文括号）
  - ❌ 调整顺序或改变格式
- ✅ 正确示例：原文 \`加载中\` → Key 必须为 \`"加载中"\`
- ❌ 错误示例：原文 \`加载中\` → Key 误写为 \`"加载中..."\`（添加了 \`...\`）

## 2. 嵌套 Value Key 规则
- 每个顶层 Key 对应的值是一个对象，该对象内部的 Key 为翻译条目的唯一标识符。
- 该标识符必须使用 **camelCase（小驼峰）** 格式的英文，应**精准、简洁**地概括对应中文文本的核心含义。
- 建议格式：\`{模块前缀}{具体动作/名词}\`，例如 \`commonConfirm\`、\`formValidateError\`。

## 3. 模块名（module）推断规则
根据输入文本的使用场景，推断其所属模块，作为嵌套对象的分组依据：
- \`common\` — 通用界面元素（如"确认"、"取消"、"关闭"）
- \`validation\` — 表单校验提示（如"请输入用户名"、"密码不能为空"）
- \`placeholder\` — 输入框占位符（如"搜索关键字"、"请选择日期"）
- \`flow\` — 业务流程描述（如"提交成功"、"正在处理中"）
- \`status\` — 状态提示（如"加载中"、"暂无数据"）
- 若无法明确归类，根据语义推断业务领域（如 \`user\`、\`order\`、\`dashboard\`）

## 4. 翻译内容规则
- 翻译为目标语言时，应保持**语义准确、自然流畅**。
- 翻译内容**不必**与中文原文在标点符号上严格一一对应，但应遵循目标语言的标准表达习惯。
- 例如：中文 \`加载中\` 可译为 \`Loading\`，而不必添加 \`...\`。

## 5. 输出格式要求（绝对严格）
- **最终输出必须是一个纯 JSON 对象**。
- **禁止**在输出内容前后添加任何文字说明、注释、Markdown 代码块标记（如 \`\`\`json 或 \`\`\`）。
- **禁止**输出任何解释性、分析性或无关的文本内容。
- 确保 JSON 格式合法，可被 \`JSON.parse()\` 直接解析。
- 整个输出只能包含一个 JSON 对象，不能包含多个顶层对象或数组包裹。

# 禁止项清单（红线，不可触碰）
| 禁止行为 | 说明 |
|---------|------|
| 修改顶层 Key 中的中文原文 | 包括删除、添加、替换任何字符，哪怕是一个空格或一个标点 |
| 在中文原文后添加省略号 \`...\` | 如 \`加载中\` → \`加载中...\` 绝对禁止 |
| 在中文原文后添加句号或问号 | 如 \`确认\` → \`确认。\` 绝对禁止 |
| 删除中文原文中的句号、问号等 | 如 \`提交成功。\` → \`提交成功\` 绝对禁止 |
| 输出非 JSON 格式的内容 | 如添加解释、注释、Markdown 标记等 |
| 合并多条文本到同一个 Key | 每条中文文本必须独立成键 |

# 重要提醒
- **顶层 Key 是中文原文的"镜像"**，必须做到字符级别的一致。
- 如果原文有句号，Key 中就有句号；如果原文没有，Key 中就没有。
- 嵌套 Key（英文 camelCase）可以自由设计，不受此限制。`;

const AI_USER_PROMPT_TEMPLATE =
  '文件路径：{filePath}\n目标语言：{targetLanguages}\n\n请为以下中文文本生成 key 和翻译，输出 JSON 格式：\n{chineseTexts}\n\n输出格式示例：\n{"发起人": {"key": "accredit.sponsor", "en-US": "Sponsor"}, "请选择": {"key": "common.pleaseSelect", "en-US": "Please select"}}';

const AI_GAP_SYSTEM_PROMPT = `你是一个 i18n 翻译助手。请将给定的中文文本翻译为指定的目标语言。
每条文本已有固定的 key 路径，你只需要将 JSON 中的空字符串替换为对应翻译。
严格保持 JSON 结构不变，不要修改任何 key，不要添加或删除任何字段。
只输出填充后的 JSON 对象，不要添加任何其他内容。`;

// ============================================================
// 配置项定义
// ============================================================

const SOURCE_LANGUAGE_OPTIONS = [
  { value: "zh-CN", label: "zh-CN（简体中文）" },
  { value: "zh-TW", label: "zh-TW（繁体中文）" },
  { value: "en", label: "en（英文）" },
  { value: "ja", label: "ja（日语）" },
  { value: "ko", label: "ko（韩语）" },
];

const TARGET_LANGUAGE_OPTIONS = [
  { value: "en", label: "en（英文）" },
  { value: "th", label: "th（泰语）" },
  { value: "ja", label: "ja（日语）" },
  { value: "ko", label: "ko（韩语）" },
  { value: "fr", label: "fr（法语）" },
  { value: "de", label: "de（德语）" },
  { value: "vi", label: "vi（越南语）" },
  { value: "pt", label: "pt（葡萄牙语）" },
  { value: "es", label: "es（西班牙语）" },
  { value: "ru", label: "ru（俄语）" },
];

const KEY_STYLE_OPTIONS = [
  { value: "camelCase", label: "camelCase（小驼峰）" },
  { value: "snake_case", label: "snake_case（蛇形）" },
  { value: "kebab-case", label: "kebab-case（短横线）" },
];

// 必答项
const REQUIRED_ITEMS = [
  {
    key: "projectPath",
    title: "项目根目录",
    description: "需要国际化的项目所在目录，相对于本脚本的位置（Tab 补全路径）",
    type: "path",
    default: "./",
  },
  {
    key: "entry",
    title: "扫描范围",
    description:
      "要扫描哪些文件。src/**/*.vue 表示 src 下所有 .vue 文件，src/**/*.{vue,js,ts} 表示 src 下所有 vue/js/ts 文件",
    type: "input",
    default: "src/**/*.vue",
  },
  {
    key: "sourceLanguage",
    title: "源码语言",
    description: "项目中当前使用的语言",
    type: "select",
    options: SOURCE_LANGUAGE_OPTIONS,
    default: "zh-CN",
  },
  {
    key: "targetLanguages",
    title: "目标语言（可多选）",
    description: "需要翻译到哪些语言，Space 选中/取消，Enter 确认",
    type: "multiselect",
    options: TARGET_LANGUAGE_OPTIONS,
    default: ["en"],
  },
  {
    key: "ai.enabled",
    title: "是否启用 AI 翻译？",
    description: "启用后可通过 AI 自动翻译，需要提供 API Key",
    type: "confirm",
    default: true,
  },
];

// 主流程项（必答之后，AI 配置之前）
const MAIN_ITEMS = [
  {
    key: "exclude",
    title: "排除文件",
    description: "不需要扫描的文件",
    type: "editableList",
    default: ["src/router.ts", "src/utils/*.ts", "src/views/print.vue"],
  },
  {
    key: "scanScript",
    title: "扫描 <script> 中的中文",
    description: "是否扫描 Vue 文件 <script> 部分的中文",
    type: "confirm",
    default: true,
  },
  {
    key: "translateAttributes",
    title: "需要翻译的 HTML 属性",
    description: "这些属性中的中文会被提取翻译",
    type: "editableList",
    default: DEFAULT_TRANSLATE_ATTRIBUTES,
  },
  {
    key: "ignoreAttributes",
    title: "不翻译的 HTML 属性",
    description: "这些属性中的中文永远不翻译",
    type: "editableList",
    default: DEFAULT_IGNORE_ATTRIBUTES,
  },
  {
    key: "ignoreMethods",
    title: "跳过的方法字符串参数",
    description: "这些方法调用中的字符串参数不翻译",
    type: "editableList",
    default: DEFAULT_IGNORE_METHODS,
  },
  {
    key: "localeStorageKey",
    title: "localStorage 键名",
    description: "localStorage 中存储语言设置的 key 名",
    type: "input",
    default: "lang",
  },
];

// AI 条件项
const CONDITIONAL_ITEMS = [
  {
    key: "ai.apiKey",
    title: "AI API Key",
    description: "OpenAI 兼容接口的密钥，输入时不显示",
    type: "secret",
    default: "",
  },
  {
    key: "ai.baseURL",
    title: "AI API 地址",
    description: "OpenAI 兼容接口地址",
    type: "input",
    default: "https://api.openai.com/v1",
  },
  {
    key: "ai.model",
    title: "AI 模型名称",
    description: "使用的模型，如 gpt-4、deepseek-v4-pro",
    type: "input",
    default: "gpt-4",
  },
];

// 高级项
const ADVANCED_ITEMS = [
  {
    key: "baseDir",
    title: "源码根目录",
    description: "项目源码根目录",
    type: "input",
    default: "src",
  },
  {
    key: "output",
    title: "输出目录",
    description: "语言包文件输出目录",
    type: "input",
    default: "src/locales",
  },
  {
    key: "keyStyle",
    title: "Key 命名风格",
    description: "生成 key 的命名风格",
    type: "select",
    options: KEY_STYLE_OPTIONS,
    default: "camelCase",
  },
  {
    key: "logDir",
    title: "日志目录",
    description: "日志文件输出目录",
    type: "input",
    default: "logs",
  },
  {
    key: "ai.batchSize",
    title: "翻译批次大小",
    description: "每批最多翻译条数",
    type: "input",
    default: "200",
  },
  {
    key: "ai.referenceLocales",
    title: "参考语言包路径",
    description: "复用已有翻译的语言包路径，逗号分隔，无则留空",
    type: "input",
    default: "",
  },
];

// ============================================================
// 配置读写
// ============================================================

/**
 * 加载已有配置文件，解析为扁平对象
 */
async function loadExistingConfig() {
  // 配置文件始终与脚本同级
  const configPath = path.join(__dirname, "i18n.config.js");
  if (!fs.existsSync(configPath)) {
    return { config: null, configPath };
  }

  try {
    const configUrl = `file://${configPath.replace(/\\/g, "/")}`;
    const mod = await import(configUrl);
    const raw = mod.default || mod;

    // 扁平化嵌套对象
    const flat = {};
    for (const [key, value] of Object.entries(raw)) {
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        for (const [subKey, subValue] of Object.entries(value)) {
          flat[`${key}.${subKey}`] = subValue;
        }
      } else {
        flat[key] = value;
      }
    }

    return { config: flat, configPath };
  } catch (err) {
    console.log(`  ${yellow("无法读取已有配置: " + err.message)}`);
    return { config: null, configPath };
  }
}

/**
 * 从扁平配置中取值
 */
function getConfigValue(flatConfig, key, defaultValue) {
  if (flatConfig && flatConfig[key] !== undefined) {
    return flatConfig[key];
  }
  return defaultValue;
}

/**
 * 将扁平配置重组为嵌套对象
 */
function unflattenConfig(flat) {
  const result = {};
  const aiKeys = {};

  for (const [key, value] of Object.entries(flat)) {
    if (key.startsWith("ai.")) {
      aiKeys[key.slice(3)] = value;
    } else {
      result[key] = value;
    }
  }

  if (Object.keys(aiKeys).length > 0) {
    result.ai = aiKeys;
  }

  return result;
}

/**
 * 写入配置文件
 */
function writeConfig(flat, configPath) {
  const nested = unflattenConfig(flat);

  // 确保数组字段是数组格式
  const ensureArray = (val) => {
    if (Array.isArray(val)) return val;
    if (typeof val === "string")
      return val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return [];
  };
  nested.entry = ensureArray(nested.entry || ["src/**/*.vue"]);
  nested.exclude = ensureArray(nested.exclude || []);
  nested.targetLanguages = ensureArray(nested.targetLanguages || ["en"]);
  nested.translateAttributes = ensureArray(
    nested.translateAttributes || DEFAULT_TRANSLATE_ATTRIBUTES,
  );
  nested.ignoreAttributes = ensureArray(
    nested.ignoreAttributes || DEFAULT_IGNORE_ATTRIBUTES,
  );
  nested.ignoreMethods = ensureArray(
    nested.ignoreMethods || DEFAULT_IGNORE_METHODS,
  );

  const ai = nested.ai || {};

  const lines = [];
  lines.push("// i18n 自动扫描配置");
  lines.push("// 用法: node scripts/i18n-scan/index.cjs");
  lines.push("// 预览: node scripts/i18n-scan/index.cjs --dry-run");
  lines.push("export default {");
  lines.push("  // 项目根目录路径（绝对路径或相对于本配置文件的路径）");
  lines.push(`  projectPath: ${JSON.stringify(nested.projectPath || "./")},`);
  lines.push("");
  lines.push("  // 扫描范围");
  lines.push(`  entry: ${JSON.stringify(nested.entry)},`);
  lines.push(`  exclude: ${JSON.stringify(nested.exclude)},`);
  lines.push("");
  lines.push("  // 是否扫描 <script> 中的中文");
  lines.push(`  scanScript: ${nested.scanScript !== false},`);
  lines.push("");
  lines.push("  // 输出目录");
  lines.push(`  output: ${JSON.stringify(nested.output || "src/locales")},`);
  lines.push(`  baseDir: ${JSON.stringify(nested.baseDir || "src")},`);
  lines.push("");
  lines.push("  // 语言配置");
  lines.push(
    `  sourceLanguage: ${JSON.stringify(nested.sourceLanguage || "zh-CN")},`,
  );
  lines.push(`  targetLanguages: ${JSON.stringify(nested.targetLanguages)},`);
  lines.push(
    `  localeStorageKey: ${JSON.stringify(nested.localeStorageKey || "lang")},`,
  );
  lines.push("");
  lines.push("  // 需要翻译的 HTML 属性");
  lines.push(
    `  translateAttributes: ${JSON.stringify(nested.translateAttributes)},`,
  );
  lines.push("");
  lines.push("  // 永远不翻译的属性");
  lines.push(`  ignoreAttributes: ${JSON.stringify(nested.ignoreAttributes)},`);
  lines.push("");
  lines.push("  // 跳过这些方法的字符串参数");
  lines.push(`  ignoreMethods: ${JSON.stringify(nested.ignoreMethods)},`);
  lines.push("");
  lines.push("  // key 命名风格");
  lines.push(`  keyStyle: ${JSON.stringify(nested.keyStyle || "camelCase")},`);
  lines.push("");
  lines.push("  // 日志目录");
  lines.push(`  logDir: ${JSON.stringify(nested.logDir || "logs")},`);
  lines.push("");
  lines.push("  // AI 翻译配置");
  lines.push("  ai: {");
  lines.push(`    enabled: ${ai.enabled !== undefined ? ai.enabled : false},`);
  lines.push("");
  lines.push("    // 参考语言包路径，翻译时优先复用已有翻译");
  if (ai.referenceLocales) {
    const refs =
      typeof ai.referenceLocales === "string"
        ? ai.referenceLocales
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : ai.referenceLocales;
    lines.push(`    referenceLocales: ${JSON.stringify(refs)},`);
  } else {
    lines.push("    referenceLocales: [],");
  }
  lines.push("");
  lines.push("    // OpenAI 兼容 API 配置");
  lines.push(`    apiKey: ${JSON.stringify(ai.apiKey || "")},`);
  lines.push(
    `    baseURL: ${JSON.stringify(ai.baseURL || "https://api.openai.com/v1")},`,
  );
  lines.push(`    model: ${JSON.stringify(ai.model || "gpt-4")},`);
  lines.push("    temperature: 0.3,");
  lines.push("    maxTokens: 200000,");
  lines.push("");
  lines.push("    // 每批最多翻译条数");
  lines.push(`    batchSize: ${Number(ai.batchSize) || 200},`);
  lines.push("");
  lines.push("    // 系统提示词");
  lines.push(`    systemPrompt: ${JSON.stringify(AI_SYSTEM_PROMPT)},`);
  lines.push("");
  lines.push("    // 用户提示词模板");
  lines.push(
    `    userPromptTemplate: ${JSON.stringify(AI_USER_PROMPT_TEMPLATE)},`,
  );
  lines.push("");
  lines.push("    // 缺口补齐翻译的系统提示词");
  lines.push(`    gapSystemPrompt: ${JSON.stringify(AI_GAP_SYSTEM_PROMPT)},`);
  lines.push("");
  lines.push("    // 缺口补齐翻译的用户提示词模板");
  lines.push(`    gapUserPromptTemplate: '',`);
  lines.push("  },");
  lines.push("}");
  lines.push("");

  fs.writeFileSync(configPath, lines.join("\n"), "utf-8");
}

// ============================================================
// 配置向导主流程
// ============================================================

async function runSetup(existingConfig, configPath) {
  const prompt = createPrompt();
  const newConfig = {};

  try {
    // 欢迎横幅
    console.log("");
    separator("i18n 自动化工具");
    console.log("");

    console.log(bold("--- 基础配置 ---"));
    console.log(gray("（已有配置将作为默认值，直接回车保留原值）"));
    console.log(gray("（Ctrl+C 任意步骤安全退出，不保存）"));
    console.log("");

    // ---- 必答项 ----
    let step = 0;
    const totalRequired = REQUIRED_ITEMS.length;

    for (const item of REQUIRED_ITEMS) {
      step++;
      const label = `${step}/${totalRequired}`;
      const defaultValue = getConfigValue(
        existingConfig,
        item.key,
        item.default,
      );

      console.log(`${bold(label)} ${item.title}`);

      const value = await askItem(prompt, item, defaultValue, existingConfig);
      newConfig[item.key] = value;
      console.log(`  → ${green(formatValue(value, item.type))}`);
      console.log("");
    }

    // ---- 主流程项 ----
    console.log(bold("--- 扫描与属性配置 ---"));
    console.log("");

    for (const item of MAIN_ITEMS) {
      const defaultValue = getConfigValue(
        existingConfig,
        item.key,
        item.default,
      );

      console.log(`${bold(item.title)}`);

      const value = await askItem(prompt, item, defaultValue, existingConfig);
      newConfig[item.key] = value;
      console.log(`  → ${green(formatValue(value, item.type))}`);
      console.log("");
    }

    // ---- AI 条件项 ----
    if (newConfig["ai.enabled"]) {
      console.log(bold("--- AI 翻译配置 ---"));
      console.log("");

      for (const item of CONDITIONAL_ITEMS) {
        const defaultValue = getConfigValue(
          existingConfig,
          item.key,
          item.default,
        );

        console.log(`${bold(item.title)}`);

        const value = await askItem(prompt, item, defaultValue, existingConfig);
        newConfig[item.key] = value;
        const display =
          item.type === "secret"
            ? maskApiKey(value)
            : formatValue(value, item.type);
        console.log(`  → ${green(display)}`);
        console.log("");
      }
    }

    // ---- 高级配置 ----
    console.log(bold("--- 高级配置 ---"));
    console.log("");
    const showAdvanced = await prompt.confirm(
      "是否修改高级配置？",
      null,
      false,
    );

    if (showAdvanced) {
      console.log("");
      for (const item of ADVANCED_ITEMS) {
        const defaultValue = getConfigValue(
          existingConfig,
          item.key,
          item.default,
        );

        console.log(`${bold(item.title)}`);

        const value = await askItem(prompt, item, defaultValue, existingConfig);
        newConfig[item.key] = value;
        console.log(`  → ${green(formatValue(value, item.type))}`);
        console.log("");
      }
    } else {
      for (const item of ADVANCED_ITEMS) {
        newConfig[item.key] = getConfigValue(
          existingConfig,
          item.key,
          item.default,
        );
      }
    }

    // ---- 配置摘要 ----
    console.log(bold("--- 配置摘要 ---"));
    console.log("");
    printSummary(newConfig);

    // ---- 保存 ----
    console.log("");
    const save = await prompt.confirm("是否保存配置？", null, true);
    if (save) {
      writeConfig(newConfig, configPath);
      console.log(`\n  ${green("✓")} 配置已保存到 ${configPath}`);
    } else {
      console.log(`\n  ${yellow("已取消保存")}`);
    }

    return newConfig;
  } finally {
    prompt.close();
  }
}

/**
 * 根据 item.type 调用对应的 prompt 方法
 */
async function askItem(prompt, item, defaultValue, existingConfig) {
  switch (item.type) {
    case "input":
      return await prompt.input("", item.description, String(defaultValue));
    case "path":
      return await prompt.pathInput("", item.description, String(defaultValue));
    case "select":
      return await prompt.select(
        "",
        item.description,
        item.options,
        item.options.findIndex((o) => o.value === defaultValue),
      );
    case "multiselect":
      return await prompt.multiselect(
        "",
        item.description,
        item.options,
        (Array.isArray(defaultValue) ? defaultValue : [defaultValue])
          .map((v) => item.options.findIndex((o) => o.value === v))
          .filter((i) => i >= 0),
      );
    case "confirm":
      return await prompt.confirm("", item.description, defaultValue !== false);
    case "secret":
      return await prompt.secret("", item.description, String(defaultValue));
    case "editableList": {
      const current = getConfigValue(existingConfig, item.key, null);
      return await prompt.editableList(
        "",
        item.description,
        item.default,
        current,
      );
    }
    default:
      return defaultValue;
  }
}

// ============================================================
// 辅助函数
// ============================================================

function formatValue(value, type) {
  if (type === "editableList" || Array.isArray(value)) {
    if (Array.isArray(value)) {
      return value.length > 5 ? `${value.length} 项` : value.join(", ");
    }
    return String(value);
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function printSummary(config) {
  const rows = [
    ["项目根目录", config.projectPath],
    ["扫描范围", config.entry],
    [
      "排除文件",
      Array.isArray(config.exclude)
        ? `${config.exclude.length} 项`
        : config.exclude || "(无)",
    ],
    ["扫描 script", config.scanScript !== false ? "是" : "否"],
    ["源码语言", config.sourceLanguage],
    [
      "目标语言",
      Array.isArray(config.targetLanguages)
        ? config.targetLanguages.join(", ")
        : config.targetLanguages,
    ],
    [
      "翻译属性",
      Array.isArray(config.translateAttributes)
        ? `${config.translateAttributes.length} 项`
        : "(无)",
    ],
    [
      "忽略属性",
      Array.isArray(config.ignoreAttributes)
        ? `${config.ignoreAttributes.length} 项`
        : "(无)",
    ],
    [
      "忽略方法",
      Array.isArray(config.ignoreMethods)
        ? `${config.ignoreMethods.length} 项`
        : "(无)",
    ],
    ["存储键名", config.localeStorageKey],
    ["AI 翻译", config["ai.enabled"] ? "启用" : "禁用"],
  ];

  if (config["ai.enabled"]) {
    rows.push(
      ["AI 模型", config["ai.model"]],
      ["AI 地址", config["ai.baseURL"]],
      ["API Key", maskApiKey(config["ai.apiKey"])],
    );
  }

  rows.push(
    ["输出目录", config.output],
    ["Key 风格", config.keyStyle],
    ["日志目录", config.logDir],
  );

  for (const [label, value] of rows) {
    console.log(`  ${label}: ${green(String(value))}`);
  }
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  createPrompt,
  loadExistingConfig,
  runSetup,
  writeConfig,
  maskApiKey,
};

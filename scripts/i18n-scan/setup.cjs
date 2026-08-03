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

  /**
   * 选择或自定义输入 — 预设选项 + 底部"自定义"选项
   * 选预设直接返回，选"自定义"弹出输入框
   */
  async function selectOrInput(title, description, options, defaultValue) {
    const customOption = { value: "__custom__", label: "自定义（手动输入）" };
    const allOptions = [...options, customOption];

    const presetIndex = options.findIndex((o) => o.value === defaultValue);

    const selected = await select(
      title,
      description,
      allOptions,
      presetIndex >= 0 ? presetIndex : allOptions.length - 1,
    );

    if (selected === "__custom__") {
      return await input("  请输入模型名称", null, defaultValue || "");
    }
    return selected;
  }

  return {
    input,
    pathInput,
    secret,
    select,
    multiselect,
    editableList,
    confirm,
    selectOrInput,
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

const DEFAULT_TRANSLATE_METHODS = [
  "ElMessage.*",
  "ElMessageBox.*",
  "ElNotification.*",
  "alert",
  "confirm",
];

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

const UI_LIBRARY_OPTIONS = [
  { value: "element-plus", label: "Element Plus" },
  { value: "vant", label: "Vant" },
  { value: "none", label: "无组件库" },
];

const KEY_STYLE_OPTIONS = [
  { value: "camelCase", label: "camelCase（小驼峰）" },
  { value: "snake_case", label: "snake_case（蛇形）" },
  { value: "kebab-case", label: "kebab-case（短横线）" },
];

const AI_MODEL_OPTIONS = [
  { value: "gpt-4o", label: "gpt-4o — OpenAI 最新多模态" },
  { value: "gpt-4", label: "gpt-4 — OpenAI GPT-4" },
  { value: "deepseek-v4-pro", label: "deepseek-v4-pro — DeepSeek V4 Pro" },
  { value: "deepseek-chat", label: "deepseek-chat — DeepSeek Chat" },
  { value: "claude-sonnet-4-6", label: "claude-sonnet-4-6 — Anthropic Claude" },
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
    key: "scanScript",
    title: "扫描 <script> 中的中文",
    description: "是否扫描 Vue 文件 <script> 部分的中文",
    type: "confirm",
    default: true,
  },
  {
    key: "scriptTargets",
    title: "Script 翻译目标变量",
    description:
      "精确指定要翻译的变量名及属性，不在配置中的变量不会被翻译。\n" +
      "      格式: 变量名:属性1,属性2  多个变量用空格分隔\n" +
      "      示例: columns:label,title     → 只翻译 columns 的 label 和 title\n" +
      "            rules:message            → 只翻译 rules 的 message\n" +
      "            options                  → 属性为空 = 翻译该变量内所有中文\n" +
      "      无则留空",
    type: "input",
    default: "",
  },
  {
    key: "scriptReactive",
    title: "是否用 computed 包裹 const 声明",
    description:
      "启用后 scriptTargets 中 const 声明的变量会用 computed(() => ...) 包裹，\n" +
      "      使翻译结果响应式更新。let 变量不包裹",
    type: "confirm",
    default: false,
  },
  {
    key: "uiLibrary",
    title: "使用的 UI 组件库",
    description:
      "选择项目使用的 UI 组件库，影响生成的 locales/index.ts 模板和翻译方法白名单",
    type: "select",
    options: UI_LIBRARY_OPTIONS,
    default: "element-plus",
  },
  {
    key: "localeStorageKey",
    title: "localStorage 键名",
    description: "localStorage 中存储语言设置的 key 名",
    type: "input",
    default: "ZXY_locale",
  },
  {
    key: "sharedLocales",
    title: "共享语言包路径",
    description:
      "外部共享语言包目录路径（相对于项目根目录），逗号分隔。\n" +
      "      初始化时会 import 并合并到 i18n 实例中，本项目翻译优先级更高。无则留空",
    type: "input",
    default: "",
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
    description: "使用的模型，↑↓ 选择预设或选「自定义」手动输入",
    type: "selectOrInput",
    options: AI_MODEL_OPTIONS,
    default: "gpt-4o",
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

    // 扁平化嵌套对象（仅 ai 配置）
    const flat = {};
    for (const [key, value] of Object.entries(raw)) {
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        key === "ai"
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
 * 解析 scriptTargets 字符串为对象
 * 输入: "columns:label,title  rules:message  options"
 * 输出: { columns: ['label', 'title'], rules: ['message'], options: [] }
 * @param {string} raw - 用户输入的原始字符串
 * @returns {object}
 */
function parseScriptTargets(raw) {
  if (!raw || !raw.trim()) return {}
  const result = {}
  // 用空白字符分割变量组
  const parts = raw.trim().split(/\s+/)
  for (const part of parts) {
    const colonIdx = part.indexOf(':')
    if (colonIdx >= 0) {
      const varName = part.slice(0, colonIdx).trim()
      const propsStr = part.slice(colonIdx + 1).trim()
      result[varName] = propsStr ? propsStr.split(',').map((s) => s.trim()).filter(Boolean) : []
    } else {
      // 无冒号 = 全量翻译
      result[part.trim()] = []
    }
  }
  return result
}

/**
 * 将 scriptTargets 对象转为交互模式输入的字符串
 * 输入: { columns: ['label', 'title'], rules: [] }
 * 输出: "columns:label,title  rules"
 * @param {object} targets
 * @returns {string}
 */
function objectScriptTargetsToString(targets) {
  if (!targets || Object.keys(targets).length === 0) return ''
  const parts = []
  for (const [varName, props] of Object.entries(targets)) {
    if (Array.isArray(props) && props.length > 0) {
      parts.push(`${varName}:${props.join(',')}`)
    } else {
      parts.push(varName)
    }
  }
  return parts.join('  ')
}

/**
 * 格式化 scriptTargets 对象为字符串（用于配置输出）
 * @param {object} targets
 * @returns {string}
 */
function formatScriptTargets(targets) {
  if (!targets || Object.keys(targets).length === 0) return '{}'
  const parts = []
  for (const [varName, props] of Object.entries(targets)) {
    if (props.length === 0) {
      parts.push(`${varName}: []`)
    } else {
      parts.push(`${varName}: [${props.map((p) => `'${p}'`).join(', ')}]`)
    }
  }
  return `{\n    ${parts.join(',\n    ')}\n  }`
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
  nested.translateMethods = ensureArray(
    nested.translateMethods || DEFAULT_TRANSLATE_METHODS,
  );
  nested.sharedLocales = ensureArray(nested.sharedLocales || []);

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
  lines.push("  // script 翻译目标变量（变量名 → 属性名数组，[] = 全量翻译）");
  lines.push(`  scriptTargets: ${formatScriptTargets(nested.scriptTargets)},`);
  lines.push("");
  lines.push("  // 是否用 computed 包裹 const 声明的翻译目标");
  lines.push(`  scriptReactive: ${nested.scriptReactive === true},`);
  lines.push("");
  lines.push("  // UI 组件库（element-plus / vant / none）");
  lines.push(
    `  uiLibrary: ${JSON.stringify(nested.uiLibrary || "element-plus")},`,
  );
  lines.push("");
  lines.push("  // 共享语言包路径（相对于 projectPath）");
  lines.push(
    "  // 初始化时会将指定目录下的语言文件 import 并合并到 i18n 实例的 messages 中",
  );
  lines.push("  // 当前项目自身的翻译优先级高于共享语言包（项目覆盖共享）");
  lines.push(`  sharedLocales: ${JSON.stringify(nested.sharedLocales)},`);
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
    `  localeStorageKey: ${JSON.stringify(nested.localeStorageKey || "ZXY_locale")},`,
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
  lines.push("  // 需要翻译的方法调用（白名单，支持通配符如 ElMessage.*）");
  lines.push(`  translateMethods: ${JSON.stringify(nested.translateMethods)},`);
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
  lines.push(`    model: ${JSON.stringify(ai.model || "gpt-4o")},`);
  lines.push("    temperature: 0.3,");
  lines.push("    maxTokens: 200000,");
  lines.push("");
  lines.push("    // 每批最多翻译条数");
  lines.push(`    batchSize: ${Number(ai.batchSize) || 200},`);
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
      let defaultValue = getConfigValue(existingConfig, item.key, item.default);

      // 如果已有配置中 scriptTargets 是对象，转为字符串显示
      if (
        item.key === "scriptTargets" &&
        typeof defaultValue === "object" &&
        defaultValue !== null &&
        !Array.isArray(defaultValue)
      ) {
        defaultValue = objectScriptTargetsToString(defaultValue)
      }

      // scanScript 为否时，跳过 scriptTargets 和 scriptReactive 问题
      if (
        (item.key === "scriptTargets" || item.key === "scriptReactive") &&
        newConfig.scanScript === false
      ) {
        newConfig[item.key] = item.key === "scriptTargets" ? {} : false;
        continue;
      }

      console.log(`${bold(item.title)}`);

      const value = await askItem(prompt, item, defaultValue, existingConfig);

      // 解析 scriptTargets 输入（字符串 → 对象）
      if (item.key === "scriptTargets" && value) {
        newConfig[item.key] = parseScriptTargets(value);
      } else {
        newConfig[item.key] = value;
      }
      console.log(`  → ${green(formatValue(value, item.type))}`);
      console.log("");
    }

    // 以下项使用默认值，不逐项询问，可在 i18n.config.js 中手动修改
    newConfig.entry = getConfigValue(existingConfig, "entry", ["src/**/*.vue"]);
    newConfig.exclude = getConfigValue(existingConfig, "exclude", []);
    newConfig.translateAttributes = getConfigValue(
      existingConfig,
      "translateAttributes",
      DEFAULT_TRANSLATE_ATTRIBUTES,
    );
    newConfig.ignoreAttributes = getConfigValue(
      existingConfig,
      "ignoreAttributes",
      DEFAULT_IGNORE_ATTRIBUTES,
    );
    const UI_TRANSLATE_METHODS_MAP = {
      "element-plus": DEFAULT_TRANSLATE_METHODS,
      vant: ["Toast", "Toast.*"],
      none: [],
    };

    newConfig.translateMethods = getConfigValue(
      existingConfig,
      "translateMethods",
      UI_TRANSLATE_METHODS_MAP[newConfig.uiLibrary] ||
        DEFAULT_TRANSLATE_METHODS,
    );

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

    // ---- 高级配置（使用默认值，可在 i18n.config.js 中手动修改） ----
    for (const item of ADVANCED_ITEMS) {
      newConfig[item.key] = getConfigValue(
        existingConfig,
        item.key,
        item.default,
      );
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
    case "selectOrInput":
      return await prompt.selectOrInput(
        "",
        item.description,
        item.options,
        String(defaultValue),
      );
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
    ...(config.scanScript !== false
      ? [
          [
            "翻译目标变量",
            config.scriptTargets && Object.keys(config.scriptTargets).length > 0
              ? Object.keys(config.scriptTargets).join(", ")
              : "(未配置)",
          ],
          [
            "computed 包裹",
            config.scriptReactive === true ? "是" : "否",
          ],
        ]
      : []),
    ["UI 组件库", config.uiLibrary || "element-plus"],
    [
      "共享语言包",
      Array.isArray(config.sharedLocales) && config.sharedLocales.length > 0
        ? config.sharedLocales.join(", ")
        : "(无)",
    ],
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
      "翻译方法",
      Array.isArray(config.translateMethods)
        ? `${config.translateMethods.length} 项`
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

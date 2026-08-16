# 三篇文档拆分设计

> 日期：2026-08-16
> 状态：设计稿（供下次修改与续写使用）
> 范围：把现有 `md/` 文档拆分、重组为三篇面向外部用户的交付文档

---

## 一、背景与目标

toI18n 是一个 Vue 2/3 国际化自动化工具。交付给最终用户的只有两样东西：

1. 一个单文件脚本 `toI18n.cjs`（`npm run build` 用 esbuild 打包的产物，`target: node18`）
2. 文档

用户**看不到源码**（`scripts/i18n-scan/` 整个目录不交付）。因此文档必须自包含，不能出现 `scripts/`、`npm run build`、源码模块路径等内部信息。

现有 `md/` 目录里文档较多且互相重叠（`i18n自动化工具.md`、`i18n脚本使用指南.md`、`toI18n使用指南.md`、`i18n脚本架构设计.md` 等）。本次目标是把它们拆分、重组、补充，形成三篇边界清晰、面向不同问题的交付文档。

三篇文档的定位（用户原话）：

| 文档 | 解决什么问题 |
|------|-------------|
| 01 项目说明 | 让人知道「**这是什么**」 |
| 02 使用手册 | 让人知道「**怎么用**」 |
| 03 脚本运行说明 | 让人知道「**做了什么、有什么思考、替用户想了什么**」 |

---

## 二、已确认的决策（约束）

| # | 决策 | 说明 |
|---|------|------|
| 1 | 新建独立文件夹 `使用文档/`，不与 `md/` 混合 | 旧 `md/` 全部保留不动，只新增 |
| 2 | 文件名 `01-项目说明.md`、`02-使用手册.md`、`03-脚本运行说明.md` | 用户说"文件名随便，能分清即可" |
| 3 | 面向单文件 `toI18n.cjs`，不提源码/打包 | 用户看不到源码 |
| 4 | Node 版本要求：**18+** | 由 `build.cjs` 的 `target: 'node18'` 确定；脚本用到 `fetch`（Node 18 内置） |
| 5 | 全中文 | 与现有文档一致 |
| 6 | 所有路径解释基于「脚本 `toI18n.cjs` 所在目录」 | `projectPath` 相对脚本目录解析 |
| 7 | 不解释代码 | 用户明确要求；第三篇讲机制/行为，不讲代码实现 |

---

## 三、三篇文档大纲

### 01-项目说明.md —— 让人知道「这是什么」

从当前 `md/i18n自动化工具.md` 的「第一部分：项目说明」直接拆分，措辞微调（去掉内部路径），内容基本不动：

1. 这是什么
2. 为什么做（痛点表 + 为什么不用正则 + 落地原则）
3. 架构（分层图 + 数据流图）
4. Template 与 Script 分别处理（替换规则表、跳过规则、特殊标记）
5. 特殊处理与安全机制
6. 关键技术点（AI 填空式翻译、key 复用、共享语言包、语言包管理边界、typeToString/toI18n 简介）
7. Vue 2 / Vue 3 双版本兼容对照表
8. 当前状态

### 02-使用手册.md —— 让人知道「怎么用」

1. **快速开始**：`node toI18n.cjs`（无参交互模式）
2. **运行环境**：Node 18+
3. **命令行参数**：`-i / -t / -d / -s / -g / -a` 逐一说明「单独执行会动什么、产出什么」
4. **完整运行流程**（用户视角四步：配置 → 翻译 → 预览 → 替换，每步可暂停确认）
5. **基础配置入门**（必懂三件事）：
   - `projectPath`（基于脚本所在目录，不是项目自己的目录）
   - `vueVersion`（2/3，如何区分）
   - `uiLibrary`（Vue3 移动端 vs PC 端：`vant` vs `element-plus`；Vue2 用 `element-ui`）
6. **完整配置项详解**（每个配置项：作用 + 默认值 + 示例）
7. **Vue 2 / Vue 3 分开配置**：两套完整 `i18n.config.js` 示例对照
8. **typeToString 与 toI18n 是什么、怎么用**
9. **新增语言 / 移除语言**两步操作

### 03-脚本运行说明.md —— 让人知道「做了什么、替用户想了什么」

最深的一篇，讲机制与设计权衡：

1. **运行会产出什么**（控制台打印 + 日志文件 + 语言包文件）
2. **会匹配什么、不会匹配什么**（扫描分类 + 跳过规则优先级）
3. **key 如何生成**（反向映射 → 参考语言包 → AI，三级优先）
4. **AI 翻译的三次重试机制**
5. **不配置 AI 时的流程**
6. **跑过一次后再扫描会怎样**
7. **边界情况与设计思考**（见第五节清单）

---

## 四、三篇边界（防重叠）

| | 02 使用手册 | 03 脚本运行说明 |
|---|---|---|
| 视角 | 用户（我要怎么操作/配置） | 脚本（它内部怎么运作） |
| 流程 | 四步操作流程 | 扫描→分类→查 key→替换→写回 的机制 |
| 配置 | 每项怎么填、填什么、示例 | 配置如何驱动脚本行为 |

一句话：01 = 是什么 → 02 = 怎么用 → 03 = 为什么这么设计、脚本替你挡了什么。

---

## 五、为第三篇准备的「边界情况与设计思考」清单

这些是脚本「替用户挡掉的坑」，来自代码与各篇文档的提炼，是第三篇的核心增值内容：

### 5.1 数据值 vs 展示文本（最核心风险点）
- Template 侧：`el-input` 的 `label="申请人"` 是展示文本（该翻译），`el-radio` 的 `label="已通过"` 是提交给后端的值（**不该翻译**）。当前脚本只看属性名，不区分组件标签名 —— 这是已知局限。
- Script 侧：`const tip = '加载失败'` 是展示文本，`form.status = '已通过'` 是数据值。脚本通过 `isMemberAssignmentTarget()` 检测成员表达式赋值（`form.x = '中文'`）自动跳过。
- 根本原因：脚本没有后端接口 schema，无法判断值的最终用途。防御靠「正向匹配（scriptTargets）+ 跳过规则 + dry-run 预览人工确认」。

### 5.2 接口数据自动跳过
变量 init 为函数调用（非 ref/reactive）或 await 表达式时跳过，认为是接口返回数据：
- `const data = fetchData()` → 跳过
- `const list = await getList()` → 跳过
- `const form = ref({ label: '中文' })` → 处理
- `const columns = [{ label: '中文' }]` → 处理

### 5.3 替换的精确性
- **从后往前替换**：先改后面行，前面行号不受影响
- **同行长文本优先**：避免短文本先替换破坏长文本
- **列号精确定位**：优先用 AST 列号切片匹配，失败才回退 `indexOf`。解决「同行相同中文」误替换（如 `@click="form.taskComment = '同意'"` 与按钮文本 `同意` 并存）
- 单引号/双引号属性值都支持（`label='中文'` 和 `label="中文"`）
- 多行属性值也能替换

### 5.4 标记为「特殊-未处理」的边界
- 模板字符串含变量插值：`` `共${total}条记录` ``（需人工设计参数）
- 字符串拼接：`'完成时间：' + date`（语序问题）
- 含 HTML 标签的字符串：`'当<b>不是</b>时'`（避免 AI 破坏标签结构）
- 这些会写入 `logs/i18n-special-<时间戳>.log`，并单独列在预览区

### 5.5 共享语言包三重校验
路径存在 → 语言文件齐全 → key 数量一致。校验失败：交互模式询问是否继续，非交互模式自动跳过。

### 5.6 语言包管理边界
- 新增语言：每次 init **完整重建** `index.ts`（不再用正则补丁，避免静默失败）
- 移除语言：重建时自然不生成注册，但**不删除**语言包 JSON（防误删）
- 手动放置但未配置的语言包：不处理、不提示，以配置为唯一真相来源
- 僵尸条目（目标语言有、中文没有）：不处理，以 `zh-CN.json` 为唯一结构基准

### 5.7 Vue2 模板解析失败可见化
`@vue/compiler-sfc`（Vue3 编译器）无法解析部分 Vue2 旧语法，解析失败的文件**明确列出路径和原因**（不静默跳过），并去重避免错误计数虚高。

### 5.8 幂等与空项目
- 空项目：缺口检测为空，全部走新增翻译路径
- 重复执行：untranslated 为空、gaps 为空 → 直接退出，不调 AI
- 缺口补齐只写缺失语言，已有翻译零覆盖

### 5.9 AI 容错
- 填空式 JSON 模板降低格式错误
- `response_format: { type: 'json_object' }` 双重约束
- 返回逐条校验，缺失项重试最多 3 次，仍失败记日志
- 失败不阻断其他批次，最终一次性写回（保证文件完整性）

---

## 六、关键事实速查（写文档时用，避免重读代码）

### 6.1 命令行参数 → 行为
| 参数 | 模式 | 行为 |
|------|------|------|
| 无参 | interactive | 交互式全流程：加载配置 → 初始化 → AI翻译(可选) → 预览 → 替换，每步 Y/n 确认 |
| `-i` | init | 检查/安装 vue-i18n → 生成 locales 目录 + 5 个文件 + 更新 main.ts |
| `-t` | translate | 扫描中文 → 去重 → 调 AI 翻译 + 补缺口 → 写回语言包。**不碰源码** |
| `-d` | dry-run | 预览，只输出不修改 |
| `-s` | scan | 执行替换（改源码 + 未匹配提示），**不写未匹配 key 到语言包** |
| `-g` | gap | 盲区扫描，输出所有中文（不受白名单限制），写 `i18n-gap-*.log` |
| `-a` | all | init → translate → scan，非交互 |

### 6.2 init 生成的文件（`src/locales/` 下）
| 文件 | 导出 | 作用 |
|------|------|------|
| `index.ts` | `i18n`（默认导出）、`$t`、`setupI18n(app)` | i18n 实例 + UI 库语言同步 |
| `typeToString.ts` | `i18nTypeToString(key): string` | 把 `$t` 返回值强制转 `string`，解决 TS 类型报错 |
| `toI18n.ts` | `translateText(text)` / `translateArray(arr, keyName)` | 接口返回中文的运行时翻译（中文→key 反向映射） |
| `useI18n.ts` | `useI18n()` → `{ t }` | `<script setup>` 里的 composable |

四个方法（`$t` / `i18nTypeToString` / `translateText` / `translateArray`）都在 `setupI18n` 里全局注册，模板和脚本可直接用。

### 6.3 key 生成三级优先
```
已有语言包反向映射（中文 → 已有 key）
  > 参考语言包反向映射（referenceLocales，本项目优先）
  > AI 生成（根据语义生成 module.camelCase）
```
`lookupKey` 只做反向映射查询，**不猜 key**；新 key 完全交给 AI 生成。

### 6.4 无 AI 模式流程
`translateViaAI` 在 `ai.enabled=false` 时直接跳过。`--scan` 时若语言包为空（反向映射空），所有中文归「未匹配」→ 不替换。未匹配的中文**不会**写入语言包（防止低质量 key 永久残留，后续启用 AI 也无法重写）。需用户手动补充语言包或启用 AI。

### 6.5 再扫描机制
反向映射每次运行都从 `zh-CN.json` 重建。所以用户手动往语言包加翻译后，再次 `-d`/`-s` 时这些中文会自动变成「已匹配」。

### 6.6 默认配置值（写配置项详解时用）
- `projectPath: '.'`（相对脚本目录）
- `baseDir: 'src'`（支持字符串/数组）
- `entry: ['**/*.vue']`（自动拼 baseDir）
- `sourceLanguage: 'zh-CN'`，`targetLanguages: ['en']`
- `output: 'src/locales'`
- `scanScript: true`（总开关）
- `scriptTargets: {}`，`scriptReactive: false`
- `vueVersion` 默认 3（检测：配置 > package.json > 3）
- `uiLibrary` 默认：Vue2→`element-ui`，Vue3→`element-plus`
- `translateMethods` 默认按 vueVersion + uiLibrary 自动设置
- `localeStorageKey: 'lang'`

### 6.7 translateMethods 默认值
- Vue3 + element-plus：`ElMessage.*`、`ElMessageBox.*`、`ElNotification.*`、`alert`、`confirm`、`showWarningMessage`
- Vue3 + vant：`Toast`、`Toast.*`
- Vue3 + none：`[]`
- Vue2（不区分库）：`this.$message.*`、`this.$confirm`、`this.$alert`、`this.$prompt`、`this.$notify.*`

### 6.8 跳过规则优先级（高→低）
1. `ignoreAttributes` 黑名单属性
2. 不在 `translateAttributes` 白名单的属性
3. 不在 `translateMethods` 白名单的方法参数
4. `exclude` 中的文件
5. 变量名不在 `scriptTargets` 中的变量声明
6. 变量 init 为非 ref/reactive 的 CallExpression / AwaitExpression（接口数据）
7. 注释、import 声明、TS 类型注解
8. 已有 `$t()` 调用
9. 纯数字/英文/符号字符串

---

## 七、待办（下一步）

1. 写 `使用文档/01-项目说明.md`
2. 写 `使用文档/02-使用手册.md`
3. 写 `使用文档/03-脚本运行说明.md`
4. 三篇完成后：检查三篇之间无内容冲突、无重复；确认无内部路径泄露

---

## 八、参考源

- `md/i18n自动化工具.md` — 01 的主要来源，02 的部分来源
- `md/i18n脚本使用指南.md` / `md/toI18n使用指南.md` — 02 的来源
- `md/i18n脚本架构设计.md` — 03 的来源
- `md/i18n-parse-summary.md` — 03 的「边界情况」主要来源
- `md/BUGS.md` — 03 的「已修复的坑」
- `md/语言包管理与无AI模式方案.md` — 03 的无 AI 流程 + 语言包边界
- `md/AI翻译增强-新增语言自动补齐.md` / `md/DESIGN.md` — 03 的缺口补齐 + 重试
- `docs/superpowers/specs/2026-08-02-script-i18n-refactor-design.md` — scriptTargets 设计
- 代码：`scripts/i18n-scan/`（index.cjs / translator.cjs / init.cjs / init/init-vue3.cjs 等）

# i18n 自动化脚本 — 实现计划

## Context

fundTransfer 项目是 Vue 3 + Element Plus 子应用，所有 Vue 文件中的中文文本均为硬编码，尚未替换为 `$t()` 调用。`src/locales/zh-CN.json` 和 `en.json` 已有翻译内容（嵌套结构），但旧的扫描脚本已删除。需要重新构建一套 i18n 自动化脚本，实现 AST 精确扫描 + 预览输出 + 初始化。

**脚本目录**：`scripts/i18n-scan/`（复用 `package.json` 中已有的 scripts 配置）

---

## 一、扫描分类体系

所有中文文本分 3 类输出：

| 类别            | 说明                           | 处理方式                            |
| --------------- | ------------------------------ | ----------------------------------- |
| **已匹配**      | 中文在现有 locale 中有对应 key | 显示替换后形式，归类到对应模块      |
| **未匹配**      | 中文在现有 locale 中无对应 key | 自动生成 key（camelCase），显示建议 |
| **特殊-未处理** | 本期不处理的特殊情况           | 单独归类，列出供人工处理            |

### 指令属性处理规则

指令属性（`v-if`、`v-for`、`@click`、`@change`、`:prop` 等）：

- 如果指令名在 `translateAttributes` 白名单中 → 正常处理其中的中文
- 如果指令名**不在**白名单中 → **直接忽略**，不处理、不分类、不输出

```
示例：
  v-if="status === '已通过'"     → v-if 不在白名单 → 忽略
  :label="condition ? '是':'否'"  → label 在白名单 → 正常处理
  @click="handle('确认')"         → @click 不在白名单 → 忽略
```

---

## 二、配置文件驱动

脚本行为完全由 `i18n.config.js` 控制：

| 配置项                | 控制内容                             |
| --------------------- | ------------------------------------ |
| `entry`               | 扫描哪些文件（glob 模式）            |
| `exclude`             | 排除哪些文件                         |
| `translateAttributes` | 哪些属性中的中文需要翻译（白名单）   |
| `ignoreAttributes`    | 哪些属性中的中文永远不翻译（黑名单） |
| `ignoreMethods`       | 哪些方法调用中的字符串参数不翻译     |
| `output`              | locale 文件输出目录                  |
| `sourceLanguage`      | 源码语言                             |
| `targetLanguages`     | 目标语言列表                         |

**优先级**：`ignoreAttributes` > `translateAttributes`

---

## 三、命令模式

### 3.1 `pnpm run i18n:dry` — 预览模式

按照配置文件，严格匹配。只输出 3 类：已匹配、未匹配、特殊-未处理。

不修改任何文件。

### 3.2 `pnpm run i18n:gap` — 盲区扫描模式

输出**所有**出现中文的地方，不受配置文件限制。不管是否在 `translateAttributes` 白名单、不管是否 `ignoreMethods`、不管是否指令。

目的：发现脚本的扫描盲区，根据输出优化脚本。

输出格式：

```
========== 盲区扫描（所有中文）==========

  src/views/start.vue (5 处)
    L 164 │ 付款暂存
         │ 类型: 指令(v-if) 状态: 不在白名单
         │ v-if="flowButton?.name === '付款暂存'"
    L 205 │ 完成时间：
         │ 类型: 模板字符串 状态: 含变量插值
         │ `完成时间：${formModel.value.transferDate}`
    ...

  盲区合计: N 处，涉及 M 个文件
========================================
```

---

## 四、阶段 1：i18n:init — 初始化脚本

**实现**：`scripts/i18n-scan/init.cjs`

### 生成内容

```
src/locales/
  zh-CN.json          # 空语言包 {}
  en.json             # 空语言包 {}
  index.ts            # vue-i18n 基础配置
```

### index.ts 模板

- `createI18n()` 基础配置（legacy: false）
- 导入 zh-CN.json 和 en.json
- localStorage 读取/切换语言
- Element Plus locale 同步切换
- 导出 `$t` 函数

### i18n.config.js 处理

- 已存在 → 跳过，不覆盖
- 不存在 → 生成默认配置模板

---

## 五、阶段 2：i18n:dry + i18n:gap — 扫描与预览

**实现**：`scripts/i18n-scan/index.cjs`（CLI 入口）

### 模块结构

```
scripts/i18n-scan/
  index.cjs              # CLI 入口，串联全流程
  scanner.cjs            # 文件扫描（fast-glob）
  parsers/
    vue-sfc-parser.cjs   # 解析 .vue 单文件组件
    template-parser.cjs  # 解析 Vue 模板 AST（@vue/compiler-dom）
    script-parser.cjs    # 解析 JS/TS AST（@babel/parser + traverse）
  generators/
    key-generator.cjs    # 中文 → 驼峰英文 key
    locale-manager.cjs   # 读写合并 locale JSON 文件
  utils/
    chinese-detector.cjs # 中文检测（正则）
    logger.cjs           # 日志输出
```

### 执行流程

```
加载配置 → 加载 locale 反向映射 → 扫描文件 → 逐文件 AST 解析 → 分类输出 → 汇总报告
```

### AST 解析细节

**Template 解析**（`@vue/compiler-dom` 的 `parse`）：

- 遍历 AST 节点树
- **静态属性**：`label="申请人"` → 检查是否在 `translateAttributes` 白名单
- **动态绑定**：`:placeholder="condition ? '是' : '否'"` → babel 解析表达式中的中文
- **文本内容**：`<span>中文文本</span>` → 提取纯文本子节点
- **插值**：`{{ $t('key') }}` → 跳过；`{{ 中文 }}` → 提取
- **指令**：检查指令名是否在白名单，不在则跳过

**Script 解析**（`@babel/parser` + `@babel/traverse`）：

- `StringLiteral`：`'付款暂存失败'` → 提取
- `TemplateLiteral`：`` `完成时间：${date}` `` → 归类「特殊-未处理」
- **二元表达式**（`+` 拼接）：`'完成时间：' + variable` → 提取字符串中的中文，归类「特殊-未处理」
- 跳过 `ignoreMethods` 中的方法调用参数
- 跳过 import 声明、类型注解、注释

### 跳过规则

1. `ignoreMethods` 中的方法调用参数 → 跳过
2. `ignoreAttributes` 中的属性 → 跳过
3. `exclude` 中的文件 → 跳过
4. 注释（`<!-- -->`、`//`、`/* */`）→ 跳过
5. 已有 `$t('...')` 调用 → 跳过
6. 纯数字/纯英文/纯符号字符串 → 跳过
7. 不在 `translateAttributes` 白名单的指令属性 → 跳过

### 本期不处理的特殊情况（检测到但归类到「特殊-未处理」）

| 情况                  | 示例                         | 原因                 |
| --------------------- | ---------------------------- | -------------------- |
| 模板字符串 + 变量插值 | `` `完成时间：${date}` ``    | 需人工确定参数名     |
| 字符串 `+` 拼接       | `'完成时间：' + variable`    | 需人工拆分为独立 key |
| 字符串 `+` 拼接       | `'前缀' + variable + '后缀'` | 同上                 |

> 这些情况**会被检测并输出**到「特殊-未处理」区块，但不会自动生成替换方案。

---

### dry 输出格式

```
配置加载完成
  输出目录: C:\...\src\locales
  源语言: zh-CN
  目标语言: en
  扫描到 N 个文件

语言包: 从 zh-CN.json 加载 M 条映射

========== 预览模式 - 不会修改任何文件 ==========

============================================================
  src/views/list.vue
============================================================
  L  43 │ 发起人
       │ →  :label="$t('common.promoter')"
       │ <el-table-column label="发起人">

============================================================
  Key 汇总 (N 个唯一 key)
============================================================
  [common] 发起人 → $t('common.promoter')
  [table] 流程号 → $t('table.processNo')

========== 特殊：本期不处理 ==========
  src/views/start.vue (2 处)
    L 205 │ 完成时间： → 模板字符串含变量插值
         │ `完成时间：${formModel.value.transferDate}`

========== i18n 扫描汇总 ==========
  扫描文件:     N
  发现字符串:   N
  已匹配:       N
  未匹配:       N
  特殊-未处理:  N
  错误:         N
========================================
```

---

## 六、阶段 3：i18n:scan — 实际替换（后续）

dry-run 验证通过后执行。不在本次范围。

---

## 七、注意事项

1. **不要挂载 `window.$t`**：多个子项目共存时，`window.$t` 会被反复覆盖，且无法确定当前是哪个项目的实例。已从 `main.ts` 中移除。

2. **脚本中使用 `$t` 需要手动 import**：

   ```ts
   import { $t } from '@/i18n'
   ```

   模板中通过 `app.config.globalProperties.$t` 已全局注册，可直接使用 `{{ $t('key') }}`。

3. **print.vue 不需要国际化**：打印页面是内部预览，已在 `i18n.config.js` 的 `exclude` 中排除。

4. **模板字符串含变量插值不会自动替换**：如 `` `资金划拨申请 ${key}` ``，需人工改为 `$t('key') + ' ' + variable` 或参数化翻译。

5. **依赖包说明**：脚本依赖 `@vue/compiler-sfc`、`@vue/compiler-dom`、`@babel/parser`、`@babel/traverse`、`fast-glob`，均为项目间接依赖。如报 `MODULE_NOT_FOUND`，执行 `pnpm install`。

---

## 八、关键文件

| 文件                                              | 操作                       |
| ------------------------------------------------- | -------------------------- |
| `scripts/i18n-scan/index.cjs`                     | 新建 - CLI 入口            |
| `scripts/i18n-scan/init.cjs`                      | 新建 - 初始化脚本          |
| `scripts/i18n-scan/scanner.cjs`                   | 新建 - 文件扫描            |
| `scripts/i18n-scan/parsers/vue-sfc-parser.cjs`    | 新建 - SFC 解析            |
| `scripts/i18n-scan/parsers/template-parser.cjs`   | 新建 - 模板 AST            |
| `scripts/i18n-scan/parsers/script-parser.cjs`     | 新建 - 脚本 AST            |
| `scripts/i18n-scan/generators/key-generator.cjs`  | 新建 - Key 生成            |
| `scripts/i18n-scan/generators/locale-manager.cjs` | 新建 - Locale 管理         |
| `scripts/i18n-scan/utils/chinese-detector.cjs`    | 新建 - 中文检测            |
| `scripts/i18n-scan/utils/logger.cjs`              | 新建 - 日志                |
| `i18n.config.js`                                  | 已存在，脚本的外部配置文件 |
| `package.json`                                    | 已存在，scripts 已配置好   |

## 九、验证方式

1. `pnpm run i18n:dry` — 扫描项目，检查只输出配置允许的内容
2. `pnpm run i18n:gap` — 盲区扫描，检查是否有遗漏的中文
3. 检查「已匹配」是否使用了现有 locale 中的 key
4. 检查「未匹配」是否生成了合理的 camelCase key
5. 检查指令中的中文是否被正确忽略（不在白名单的）
6. 检查 `ignoreMethods`、`ignoreAttributes` 是否正确跳过
7. `pnpm run i18n:init` — 验证生成的文件结构

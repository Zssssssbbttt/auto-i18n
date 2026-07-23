# AI 翻译增强：新增语言自动补齐

## 问题描述

当前 `--translate` 只能处理**新扫描到的中文文本**，无法处理**新增目标语言后已有文本的翻译缺口**。

**场景：** 项目已有 zh-CN + en，用户新增 th 语言，同时扫描出 3 条新中文。

|               | 当前行为              | 期望行为       |
| ------------- | --------------------- | -------------- |
| 3 条新文本    | 翻译为 en + th        | 翻译为 en + th |
| 100+ 条旧文本 | 跳过（已在 zh-CN 中） | 补齐 th 翻译   |

## 设计方案

### 整体流程

在现有 4 步流程中插入缺口检测 + 缺口翻译：

```
Step 1:   扫描 Vue 文件 → 去重
Step 2:   加载语言包 → 过滤已翻译 → untranslated（新文本）
Step 2.5: 【新增】遍历 zh-CN.json → 检查各目标语言文件 → gaps（缺口文本）
Step 3a:  AI 翻译 untranslated → 生成 key + 所有语言翻译（现有逻辑）
Step 3b:  【新增】AI 翻译 gaps → 只补缺失语言，key 复用已有
Step 4:   一次性写回所有语言包（合并 3a + 3b 结果）
```

### 缺口检测（Step 2.5）

- 递归遍历 `zh-CN.json` 所有叶子节点，得到完整 key 路径集合
- 对每个目标语言文件，按相同 key 路径查找
- key 不存在 或 值为空字符串 `""` → 标记为该语言缺失
- 只要有一个目标语言缺失，该条目归入 gaps
- 目标语言文件不存在 → 自动创建空文件，所有条目都算缺失

### 缺口翻译（Step 3b）

**按缺失语言组合分组后分批发送：**

```
第 1 批 (缺 en+th, 2条):
  transfer.sponsor → 发起人
  transfer.transferStatus → 划拨状态

第 2 批 (只缺 th, 100条):
  transfer.applicant → 申请人
  ...
```

**AI 输入格式（填空式，降低 AI 出错概率）：**

```
中文原文对照：
  transfer.sponsor → 发起人
  transfer.transferStatus → 划拨状态

请将以下 JSON 中的空字符串替换为对应语言的翻译，只输出填充后的 JSON：

{
  "transfer.sponsor": {"en": "", "th": ""},
  "transfer.transferStatus": {"th": ""}
}
```

**AI 返回：**

```json
{
  "transfer.sponsor": { "en": "Sponsor", "th": "ผู้สนับสนุน" },
  "transfer.transferStatus": { "th": "สถานะการโอน" }
}
```

### 新增 vs 补全对比

|          | 新文本 (untranslated)          | 缺口文本 (gaps)                |
| -------- | ------------------------------ | ------------------------------ |
| 来源     | 不在 zh-CN.json 中             | 在 zh-CN.json 中，但某语言缺失 |
| key      | AI 生成                        | 已有，复用                     |
| 翻译范围 | 所有目标语言                   | 仅缺失的语言                   |
| 写回     | zh-CN + 所有目标语言文件       | 仅目标语言文件                 |
| 互斥性   | 一个文本不可能同时属于两个集合 |                                |

### 边界场景

| 场景                   | 行为                                      |
| ---------------------- | ----------------------------------------- |
| 全新项目（零语言包）   | untranslated = 全部，gaps = 空，自然退化  |
| 已有 zh-CN+en，新加 th | untranslated = 新文本，gaps = 旧文本缺 th |
| 什么都没变，重复执行   | untranslated = 空，gaps = 空，直接退出    |
| 目标语言文件不存在     | 自动创建空文件，全部归入 gaps             |

## AI 返回校验 + 重试

缺口翻译写入前校验：

```
发送 AI 请求
  → 解析返回 JSON
  → 校验：模板中的每个 key 在返回中都存在且值非空
  → 通过 → 收集结果
  → 不通过 → 将缺失 key 列表带回 AI 重试（最多 3 次）
  → 3 次都失败 → 该批记入失败日志，跳过
```

## 提示词配置

在 `i18n.config.js` 的 `ai` 块中新增缺口翻译提示词（可选，不配则用脚本内置默认值）：

```js
ai: {
  // 现有：新文本翻译
  systemPrompt: '...',
  userPromptTemplate: '...',

  // 新增：缺口补齐翻译
  gapSystemPrompt: '...',        // 可选
  gapUserPromptTemplate: '...',  // 可选
}
```

## referenceLocales 校验

加载参考语言包时增加阻塞性校验：

1. 路径不存在/无法加载 → `console.error` + `process.exit(1)`
2. targetLanguages 中的语言在参考包中缺少对应文件 → 报错退出
3. zh-CN.json 和各语言文件的 key 数量不一致 → 报错退出

校验不通过阻塞整个翻译流程，防止用户误以为参考包已生效。

## 需要修改的文件

### `translator.cjs`

- 新增 `findTranslationGaps()` — 遍历 zh-CN.json，检测各目标语言的缺失
- 新增 `translateGaps()` — 按缺失语言组合分组，分批调用 AI，填空式翻译
- 新增 `callAiApiForGaps()` — 缺口翻译专用 API 调用（不同提示词、不同格式）
- 新增 `validateAndRetryGapBatch()` — 校验 AI 返回 + 最多 3 次重试
- 新增 `validateReferenceLocales()` — 参考语言包阻塞性校验
- 修改 `translateViaAI()` — 集成 Step 2.5 + Step 3b

### `i18n.config.js`

- 新增 `ai.gapSystemPrompt` 配置项（可选）
- 新增 `ai.gapUserPromptTemplate` 配置项（可选）

## 不改动的文件

- `index.cjs` — 不新增命令，`--translate` 行为增强
- `scanner.cjs` — 扫描逻辑不变
- `init.cjs` — 初始化逻辑不变
- `locale-manager.cjs` — 现有函数不变（缺口检测逻辑在 translator 中）
- `key-generator.cjs` — 不变
- `replacer.cjs` — 不变

## 注意事项

1. **untranslated 和 gaps 天然互斥**，不会重复翻译
2. **缺口检测读磁盘文件**，在写入之前执行，不存在"先写 zh-CN 再扫到"的时序问题
3. **AI 请求保持同步**（for + await），和现有代码风格一致
4. **所有结果一次性写入**，中途失败不影响文件完整性
5. **缺口翻译的 AI 提示词**脚本内置默认值，用户不配也能跑
6. **目标语言文件不存在时自动创建**，不需要用户手动 init（但 init 仍需跑以更新 index.ts）

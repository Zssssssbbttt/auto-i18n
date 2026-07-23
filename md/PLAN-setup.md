# 交互式配置 + 功能菜单 — 实现计划

## 目标

新增 `setup.cjs`，实现终端对话式配置向导和功能菜单。修改 `index.cjs`，无参数启动时进入交互模式。

## 实现步骤

### 步骤 1：创建 setup.cjs — 交互提示工具函数

**文件**：`scripts/i18n-scan/setup.cjs`

实现 `readline` 封装，提供以下函数：

- `input(title, description, defaultValue)` — 普通文本输入
- `secret(title, description, defaultValue)` — 脱敏输入（API Key），输入时显示 `*`
- `select(title, description, options, defaultIndex)` — 单选，返回选中的 value
- `multiselect(title, description, options, defaultIndices)` — 多选，返回选中的 value 数组
- `confirm(title, description, defaultYes)` — 确认，返回 boolean

每个函数内部：
1. 打印标题
2. 打印说明（灰色/缩进）
3. 打印提示符和默认值
4. 等待用户输入
5. 校验输入（如果校验失败，提示并重新询问）
6. 返回结果

### 步骤 2：创建 setup.cjs — 配置项定义

定义 `CONFIG_ITEMS` 数组，描述每个配置项：

```js
const CONFIG_ITEMS = [
  {
    key: 'projectPath',
    title: '项目根目录',
    description: '需要国际化的项目所在目录，相对于本脚本的位置',
    type: 'input',
    default: './',
    validate: (v) => true, // 可选校验
  },
  // ... 共 17 项（5 必答 + 3 条件 + 9 高级）
]
```

配置项分为三组：
- **required**：必答项（projectPath, entry, sourceLanguage, targetLanguages, ai.enabled）
- **conditional**：条件项，仅当 `ai.enabled = true` 时展示（ai.apiKey, ai.baseURL, ai.model）
- **advanced**：高级项，仅当用户选择修改高级配置时展示

### 步骤 3：创建 setup.cjs — 配置向导主流程

实现 `runSetup(existingConfig)` 函数：

```
1. 打印欢迎横幅
2. 打印"配置确认"标题和提示
3. 遍历 required 项，逐项询问
4. 如果 ai.enabled = true，遍历 conditional 项
5. 询问"是否修改高级配置？"
6. 如果选 Y，遍历 advanced 项
7. 打印配置摘要
8. 询问"是否保存配置？"
9. 如果选 Y，写入 i18n.config.js
10. 返回最终配置对象
```

### 步骤 4：创建 setup.cjs — 配置文件读写

- `loadExistingConfig()` — 动态 `import()` 加载 `i18n.config.js`，解析为扁平配置对象
- `maskApiKey(key)` — 脱敏显示：`sk-Im****RI8C`（前 4 + 后 4，中间 `****`）
- `writeConfig(config)` — 生成带注释的 `i18n.config.js` 文件

写入时保持原有文件格式（`export default { ... }`），每个配置项上方添加注释说明。

### 步骤 5：创建 setup.cjs — 功能菜单

实现 `runMenu(config)` 函数：

```
循环：
  1. 打印功能菜单
  2. 等待用户选择序号
  3. 根据选择调用对应模块：
     1 → runInit(config, projectRoot)
     2 → translateViaAI(config, projectRoot)
     3 → runScanMode(config, 'dry')
     4 → runScanMode(config, 'scan')
     5 → runScanMode(config, 'gap')
     6 → runInit → translateViaAI → runScanMode('scan')
     7 → 退出循环，关闭 readline
  4. 执行完毕后回到菜单
```

### 步骤 6：修改 index.cjs — 入口改造

修改 `main()` 函数：

```
main():
  解析命令行参数
  if (有参数):
    保持原有逻辑（--scan / --translate / --dry-run / --gap / --init / --all）
  else:
    引入 setup.cjs
    existingConfig = loadExistingConfig()
    config = await runSetup(existingConfig)
    await runMenu(config)
```

### 步骤 7：测试验证

1. **无配置文件场景**：删除 `i18n.config.js`，启动脚本，验证逐项配置流程
2. **有配置文件场景**：保留 `i18n.config.js`，启动脚本，验证默认值读取
3. **启用/不启用 AI**：验证条件项的展示/隐藏
4. **高级配置跳过**：验证默认跳过，选择修改时展示
5. **API Key 脱敏**：验证输入时不回显，已有值脱敏显示
6. **配置保存**：验证生成的 `i18n.config.js` 格式正确
7. **功能菜单**：验证各选项正确调用对应模块
8. **Ctrl+C 退出**：验证任意步骤可安全中断
9. **兼容模式**：验证 `--scan`、`--translate` 等参数仍然有效
10. **输入校验**：验证非法输入时提示重试

## 关键文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `scripts/i18n-scan/setup.cjs` | 新建 | 配置向导 + 功能菜单，约 400-500 行 |
| `scripts/i18n-scan/index.cjs` | 修改 | 入口改造，约 10-20 行改动 |

## 不变更

- `scanner.cjs`、`translator.cjs`、`replacer.cjs`、`init.cjs`
- `parsers/`、`generators/`、`utils/`
- `i18n.config.js` 格式
- 命令行参数行为
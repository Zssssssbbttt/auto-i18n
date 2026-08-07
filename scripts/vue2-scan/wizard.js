/**
 * 交互式配置向导
 * 用法：node script/index.js --wizard
 */
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { defaultConfig } = require('./config')

async function runWizard(configPath) {
  const resolvedPath = configPath
    ? path.resolve(configPath)
    : path.join(__dirname, '..', 'i18n.config.js')
  const existing = fs.existsSync(resolvedPath) ? require(resolvedPath) : null

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  function ask(question, defaultValue) {
    const display = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `
    return new Promise((resolve) => {
      rl.question(display, (answer) => {
        resolve(answer.trim() || defaultValue || '')
      })
    })
  }

  console.log('')
  console.log('======================== i18n 自动化工具 ========================')
  console.log('')
  if (existing) {
    console.log('（已有配置将作为默认值，直接回车保留原值）')
  }
  console.log('（Ctrl+C 任意步骤安全退出，不保存）')
  console.log('')

  const defaultEntry = existing
    ? (existing.entry ? existing.entry[0] : 'src/')
    : 'src/'

  console.log('项目根目录')
  console.log('  需要国际化的项目所在目录，相对于本脚本的位置')
  const entry = await ask('', defaultEntry)
  console.log(`  → ${entry}`)
  console.log('')

  rl.close()

  // 合并配置
  const baseDir = entry.replace(/\/$/, '')
  const config = {
    ...defaultConfig,
    ...(existing || {}),
    entry: [entry],
    baseDir,
    output: existing ? existing.output : `${baseDir}/locales`,
  }

  const content = generateConfigFile(config)
  fs.writeFileSync(resolvedPath, content, 'utf-8')

  console.log('======================== 配置已保存 ========================')
  console.log(`  文件: ${resolvedPath}`)
  if (!existing) {
    console.log(`  提示: 可编辑该文件进行高级配置`)
  }
  console.log('============================================================')
  console.log('')
}

function generateConfigFile(config) {
  const lines = ['module.exports = {']
  const indent = '  '

  lines.push(`${indent}// 扫描入口`)
  lines.push(`${indent}entry: ['${config.entry[0]}'],`)
  lines.push('')
  lines.push(`${indent}// 语言包目录`)
  lines.push(`${indent}output: '${config.output}',`)
  lines.push('')
  lines.push(`${indent}// 支持的语言`)
  lines.push(`${indent}languages: [${config.languages.map((l) => `'${l}'`).join(', ')}],`)
  lines.push('')
  lines.push(`${indent}// 基础目录`)
  lines.push(`${indent}baseDir: '${config.baseDir}',`)
  lines.push('')
  lines.push(`${indent}// 白名单：只翻译这些 HTML 属性`)
  lines.push(`${indent}translateAttributes: [${config.translateAttributes.map((a) => `'${a}'`).join(', ')}],`)
  lines.push('')
  lines.push(`${indent}// 黑名单：跳过这些方法调用中的字符串`)
  lines.push(`${indent}ignoreMethods: [${config.ignoreMethods.map((m) => `'${m}'`).join(', ')}],`)
  lines.push('')
  lines.push(`${indent}// 黑名单：跳过这些 HTML 属性`)
  lines.push(`${indent}ignoreAttributes: [${config.ignoreAttributes.map((a) => `'${a}'`).join(', ')}],`)
  lines.push('')
  lines.push(`${indent}// 排除文件/目录（支持 glob）`)
  lines.push(`${indent}exclude: [${config.exclude.map((e) => `'${e}'`).join(', ')}],`)
  lines.push('')
  lines.push(`${indent}// i18n 函数名`)
  lines.push(`${indent}tFunction: '${config.tFunction}',`)
  lines.push('')
  lines.push(`${indent}// script 中使用 i18nTypeToString 替代 $t（解决 TS 类型问题）`)
  lines.push(`${indent}typeToString: ${config.typeToString !== false},`)
  lines.push('')
  lines.push(`${indent}// Script 扫描总开关，false 则跳过 script 部分`)
  lines.push(`${indent}scriptScan: ${config.scriptScan !== false},`)
  lines.push('')
  lines.push(`${indent}// 日志目录`)
  lines.push(`${indent}logDir: '${config.logDir}',`)
  lines.push('')
  lines.push(`${indent}// 默认模块名`)
  lines.push(`${indent}defaultModule: '${config.defaultModule}',`)
  lines.push('')
  lines.push(`${indent}// 归入 common 模块的高频通用词`)
  lines.push(`${indent}commonKeys: [${config.commonKeys.map((k) => `'${k}'`).join(', ')}],`)
  lines.push('};')
  lines.push('')
  return lines.join('\n')
}

module.exports = { runWizard }
/**
 * 配置加载模块
 */
const path = require('path')
const fs = require('fs')

const defaultConfig = {
  entry: ['src/'],
  output: 'src/locales',
  languages: ['zh-CN', 'en-US'],
  baseDir: 'src',
  translateAttributes: ['label', 'placeholder', 'title', 'alt', 'message', 'content', 'desc', 'text', 'header', 'titleInfo'],
  ignoreMethods: ['console.log', 'openTag', 'indexOf', 'includes', 'split', 'toString'],
  ignoreAttributes: ['style', 'class', 'ref', 'rules', 'model', 'prop', 'key', 'slot', 'name', 'type', 'scoped', 'lang', 'form', 'src', 'href', 'target', 'width', 'size', 'mode', 'format', 'value-format', 'picker-options', 'disabled', 'clearable', 'filterable', 'remote', 'reserve-keyword', 'multiple', 'show-overflow-tooltip', 'align', 'maxlength', 'rows', 'trigger', 'icon', 'prefix-icon', 'suffix-icon'],
  keyStyle: 'camelCase',
  exclude: ['router.ts'],
  logDir: 'logs',

  // 嵌套 key 相关
  defaultModule: 'form',
  commonKeys: ['保存', '取消', '确定', '确认', '删除', '查询', '清除', '提交', '新增', '新建', '导出', '查看', '下载', '预览', '提示', '说明', '序号', '操作', '名称', '是', '否', '关闭', '重置', '请输入', '请选择', '选择日期', '请输入关键词'],

  // 扩展口：新增语言翻译函数 (chineseText, targetLang) => translatedText
  translator: null,

  // i18n 函数名，默认 $t，可改为 $cat、$miaomiao 等
  tFunction: '$t',

  // Script 扫描控制
  scriptScan: true,
  scriptTargets: undefined,
  translateMethods: undefined,
}

function loadConfig(configPath) {
  const resolvedPath = configPath ? path.resolve(configPath) : path.resolve('i18n.config.js')

  if (fs.existsSync(resolvedPath)) {
    const userConfig = require(resolvedPath)
    return { ...defaultConfig, ...userConfig }
  }
  return defaultConfig
}

module.exports = { defaultConfig, loadConfig }
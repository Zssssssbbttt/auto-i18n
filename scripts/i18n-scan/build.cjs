/**
 * 打包脚本
 * 将 i18n-scan 所有模块 + node_modules 依赖打包为单个 toI18n.js
 *
 * 用法: node scripts/i18n-scan/build.cjs
 */

const esbuild = require('esbuild')
const path = require('path')
const fs = require('fs')

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const ENTRY = path.join(__dirname, 'index.cjs')
const OUT = path.join(PROJECT_ROOT, 'toI18n.cjs')

async function build() {
  console.log('开始打包 toI18n.js ...\n')

  // Node.js 内置模块列表
const builtinModules = [
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'https',
  'module', 'net', 'os', 'path', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
  'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
]

// 插件：node_modules 内部未解析的第三方模块标记为 external
// @vue/compiler-sfc 内包含 consolidate.js，require 了大量可选模板引擎
// 这些模块都在 try-catch 里，运行时不会实际调用
const unresolvedExternalPlugin = {
  name: 'unresolved-external',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      // 跳过 Node.js 内置模块
      if (builtinModules.includes(args.path)) return
      // 跳过已带 node: 前缀的
      if (args.path.startsWith('node:')) return

      if (args.resolveDir.includes('node_modules')) {
        try {
          const resolved = require.resolve(args.path, {
            paths: [args.resolveDir],
          })
          return { path: resolved }
        } catch {
          return { path: args.path, external: true }
        }
      }
    })
  },
}

  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: OUT,
    external: [],
    loader: {
      '.cjs': 'js',
      '.js': 'js',
      '.mjs': 'js',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    minify: false,
    sourcemap: false,
    mainFields: ['main', 'module'],
    plugins: [unresolvedExternalPlugin],
    // 允许顶级 require 失败时继续
    banner: {
      js: `// toI18n.cjs — Vue 3 i18n 自动扫描脚本
// 用法: node toI18n.cjs
// 生成时间: ${new Date().toISOString()}
`,
    },
  })

  // 输出文件大小
  const stat = fs.statSync(OUT)
  const sizeKB = (stat.size / 1024).toFixed(1)
  console.log(`✓ 打包完成: ${OUT}`)
  console.log(`  文件大小: ${sizeKB} KB`)

  // 检查是否有警告
  if (result.warnings.length > 0) {
    console.log('\n警告:')
    result.warnings.forEach((w) => console.log(`  - ${w.text}`))
  }
}

build().catch((err) => {
  console.error('打包失败:', err)
  process.exit(1)
})
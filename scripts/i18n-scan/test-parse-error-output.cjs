#!/usr/bin/env node
/**
 * 单元测试：解析失败文件在 dry-run 输出中的可见性
 * 覆盖：
 *  1. printParseErrors 单元测试（相对路径转换、空文件、空数组）
 *  2. 端到端：打包产物 -d 输出包含"解析失败（未扫描）"区块，列出失败文件，
 *     且正常文件不受影响仍被扫描
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const { printParseErrors } = require(path.join(__dirname, 'utils', 'logger.cjs'));

const BUNDLE = path.resolve(__dirname, '../../toI18n.cjs');
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-parse-err-test-'));

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    if (fn()) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ FAIL: ${name}`); }
  } catch (e) {
    failed++;
    console.log(`  ✗ ERROR: ${name} — ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// 捕获 console.log 输出
function captureOutput(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { fn(); } finally { console.log = orig; }
  return lines;
}

console.log(`临时测试目录: ${TEST_DIR}\n`);
console.log('=== 解析失败输出测试 ===\n');

// ============ 单元测试：printParseErrors ============
test('printParseErrors: 输出相对路径 + 错误信息', () => {
  const projectRoot = path.join(TEST_DIR, 'proj');
  const lines = captureOutput(() =>
    printParseErrors(
      [
        {
          file: path.join(projectRoot, 'src', 'views', 'broken.vue'),
          message: 'SFC 错误: Error parsing JavaScript expression',
        },
      ],
      projectRoot
    )
  );
  assert(lines.some((l) => l.includes('解析失败（未扫描）') && l.includes('=====')), '缺少区块标题');
  assert(
    lines.some((l) => l.includes('src/views/broken.vue') && l.includes('SFC 错误: Error parsing JavaScript expression')),
    `应输出相对路径和错误信息: ${lines.join(' | ')}`
  );
  return true;
});

test('printParseErrors: 空 file 只输出错误信息，不崩溃', () => {
  const lines = captureOutput(() =>
    printParseErrors([{ file: '', message: '文件扫描失败: xxx' }], TEST_DIR)
  );
  assert(lines.some((l) => l.trim() === '文件扫描失败: xxx'), `应只输出错误信息: ${lines.join(' | ')}`);
  return true;
});

test('printParseErrors: 空数组不输出任何内容', () => {
  const lines = captureOutput(() => printParseErrors([], TEST_DIR));
  assert(lines.length === 0, `空数组不应有输出: ${lines.join(' | ')}`);
  return true;
});

// ============ 端到端：打包产物 -d 输出 ============
test('端到端: -d 输出列出解析失败文件，正常文件照常扫描', () => {
  assert(fs.existsSync(BUNDLE), `未找到 ${BUNDLE}，请先运行 npm run build`);

  const proj = path.join(TEST_DIR, 'proj');
  fs.mkdirSync(path.join(proj, 'src', 'views'), { recursive: true });
  // 解析失败的文件（Vue3 编译器无法解析的表达式）
  fs.writeFileSync(path.join(proj, 'src', 'views', 'broken.vue'), `<template>
  <div>{{ a b }}</div>
</template>
`, 'utf-8');
  // 正常文件
  fs.writeFileSync(path.join(proj, 'src', 'views', 'good.vue'), `<template>
  <div>
    <span>正常的中文文本</span>
  </div>
</template>
`, 'utf-8');

  fs.copyFileSync(BUNDLE, path.join(TEST_DIR, 'toI18n.cjs'));
  fs.writeFileSync(path.join(TEST_DIR, 'i18n.config.js'), `export default {
  vueVersion: 3,
  projectPath: './proj',
  entry: ['src/**/*.vue'],
  exclude: [],
  scanScript: false,
  scriptTargets: {},
  scriptReactive: false,
  uiLibrary: 'none',
  sharedLocales: [],
  output: 'src/locales',
  baseDir: 'src',
  sourceLanguage: 'zh-CN',
  targetLanguages: ['en'],
  localeStorageKey: 'ZXY_locale',
  translateAttributes: ['label', 'placeholder'],
  ignoreAttributes: [],
  translateMethods: [],
  logDir: 'logs',
  ai: { enabled: false },
}
`, 'utf-8');

  const stdout = execFileSync('node', ['toI18n.cjs', '-d'], {
    cwd: TEST_DIR,
    encoding: 'utf-8',
  });

  // 解析失败区块：标题 + 文件 + 原因
  assert(stdout.includes('解析失败（未扫描）'), '缺少"解析失败（未扫描）"区块');
  assert(stdout.includes('src/views/broken.vue'), '未列出解析失败的文件路径');
  assert(stdout.includes('Error parsing JavaScript expression'), '未列出解析失败原因');
  assert(stdout.includes('错误:         1'), '汇总中错误数应为 1');

  // 正常文件不受影响
  assert(stdout.includes('正常的中文文本'), '正常文件的中文未被扫描');
  assert(stdout.includes('src/views/good.vue'), '正常文件未出现在扫描结果中');
  return true;
});

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
fs.rmSync(TEST_DIR, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);

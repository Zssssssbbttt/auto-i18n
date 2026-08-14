#!/usr/bin/env node
/**
 * 单元测试：scan 替换流程 — replaceInFile 返回 changed 是否正确
 * 场景：语言包有 key → 扫描分类 matched → replaceInFile 替换 → 断言 changed=true 且文件被修改
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPT_DIR = __dirname;
const { scanFiles } = require(path.join(SCRIPT_DIR, 'scanner.cjs'));
const { loadLocaleReverseMap } = require(path.join(SCRIPT_DIR, 'generators/locale-manager.cjs'));
const { lookupKey } = require(path.join(SCRIPT_DIR, 'generators/key-generator.cjs'));
const { replaceInFile } = require(path.join(SCRIPT_DIR, 'replacer.cjs'));

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-replacer-test-'));

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

function buildConfig(overrides = {}) {
  return {
    entry: ['src/**/*.vue'],
    exclude: [],
    scanScript: false,
    scriptTargets: {},
    translateAttributes: ['label', 'placeholder', 'title'],
    ignoreAttributes: [],
    translateMethods: [],
    ...overrides,
  };
}

// 准备测试项目
const srcDir = path.join(TEST_DIR, 'src');
fs.mkdirSync(path.join(srcDir, 'views'), { recursive: true });
fs.mkdirSync(path.join(srcDir, 'locales'), { recursive: true });

const vueA = `<template>
  <div>
    <span>查询</span>
    <el-input placeholder="请输入姓名" />
  </div>
</template>
`;
fs.writeFileSync(path.join(srcDir, 'views', 'a.vue'), vueA, 'utf-8');

const vueB = `<template>
  <div>
    <el-table-column label="确定" />
    <span>未翻译的文本</span>
  </div>
</template>
`;
fs.writeFileSync(path.join(srcDir, 'views', 'b.vue'), vueB, 'utf-8');

fs.writeFileSync(path.join(srcDir, 'locales', 'zh-CN.json'), JSON.stringify({
  common: { query: '查询', confirm: '确定', pleaseEnterName: '请输入姓名' },
}, null, 2), 'utf-8');

const config = buildConfig();

async function main() {
  console.log(`临时测试目录: ${TEST_DIR}\n`);
  console.log('=== replaceInFile changed 返回值测试 ===\n');

  // 1. 扫描 + 分类（模拟 prepareScanResults 的核心逻辑）
  const { results, errors } = await scanFiles(config, TEST_DIR);
  assert(errors.length === 0, `扫描错误: ${JSON.stringify(errors)}`);

  const { reverseMap } = loadLocaleReverseMap(path.join(srcDir, 'locales'), 'zh-CN');

  const matched = [];
  const unmatched = [];
  for (const item of results) {
    const { key, matched: isMatched } = lookupKey(item.chineseText, reverseMap);
    if (isMatched) matched.push({ ...item, key });
    else unmatched.push({ ...item });
  }

  test('扫描结果: 3 条已匹配, 1 条未匹配', () => {
    assert(matched.length === 3, `期望 3 条已匹配，实际 ${matched.length}`);
    assert(unmatched.length === 1, `期望 1 条未匹配，实际 ${unmatched.length}`);
    return true;
  });

  // 2. 按文件分组
  const fileGroups = {};
  for (const item of [...matched, ...unmatched]) {
    const relPath = path.relative(TEST_DIR, item.file).replace(/\\/g, '/');
    if (!fileGroups[relPath]) fileGroups[relPath] = [];
    fileGroups[relPath].push(item);
  }

  // 3. 逐文件替换，统计 changed 文件数
  let filesModified = 0;
  for (const [relPath, items] of Object.entries(fileGroups)) {
    const filePath = path.resolve(TEST_DIR, relPath);
    const { changed } = replaceInFile(filePath, items, reverseMap, false, 3);
    if (changed) filesModified++;
  }

  test('replaceInFile: changed 文件数应为 2', () => {
    assert(filesModified === 2, `期望 2 个文件被修改，实际 ${filesModified}`);
    return true;
  });

  // 4. 验证文件内容确实被替换
  test('a.vue: 中文被替换为 $t()', () => {
    const content = fs.readFileSync(path.join(srcDir, 'views', 'a.vue'), 'utf-8');
    assert(content.includes("{{ $t('common.query') }}"), '查询 未替换');
    assert(content.includes(":placeholder=\"$t('common.pleaseEnterName')\""), 'placeholder 未替换');
    assert(!content.includes('查询'), '原文残留');
    assert(!content.includes('请输入姓名'), '原文残留');
    return true;
  });

  test('b.vue: 已匹配替换、未匹配保留', () => {
    const content = fs.readFileSync(path.join(srcDir, 'views', 'b.vue'), 'utf-8');
    assert(content.includes(":label=\"$t('common.confirm')\""), '确定 未替换');
    assert(content.includes('未翻译的文本'), '未匹配文本应保留原文');
    return true;
  });

  test('import 自动注入', () => {
    const content = fs.readFileSync(path.join(srcDir, 'views', 'a.vue'), 'utf-8');
    assert(content.includes("import { $t } from '@/locales'"), '缺少 $t import');
    return true;
  });

  // 6. 单引号静态属性：label='中文' 必须被替换（回归：曾因 pattern 硬编码双引号而静默跳过）
  test('单引号静态属性被替换', () => {
    const singleFile = path.join(srcDir, 'views', 'single-quote.vue');
    fs.writeFileSync(singleFile, `<template>
  <div>
    <el-table-column label='单引号属性' prop="a" />
    <el-table-column label="双引号属性" prop="b" />
  </div>
</template>
`, 'utf-8');
    const reverseMap = {
      单引号属性: 'common.singleQuote',
      双引号属性: 'common.doubleQuote',
    };
    const { changed } = replaceInFile(singleFile, [
      { line: 3, col: 23, chineseText: '单引号属性', type: 'static-attr', attrName: 'label' },
      { line: 4, col: 23, chineseText: '双引号属性', type: 'static-attr', attrName: 'label' },
    ], reverseMap, false, 3);
    assert(changed === true, '单引号属性文件应返回 changed=true');
    const content = fs.readFileSync(singleFile, 'utf-8');
    assert(content.includes(":label=\"$t('common.singleQuote')\""), '单引号属性未替换');
    assert(content.includes(":label=\"$t('common.doubleQuote')\""), '双引号属性未替换');
    assert(!content.includes('单引号属性') && !content.includes('双引号属性'), '原文残留');
    return true;
  });

  test('多行单引号静态属性被替换', () => {
    const multiFile = path.join(srcDir, 'views', 'multi-quote.vue');
    fs.writeFileSync(multiFile, `<template>
  <el-input placeholder='第一行
第二行中文' />
</template>
`, 'utf-8');
    const reverseMap = { '第一行\n第二行中文': 'common.multiLine' };
    const { changed } = replaceInFile(multiFile, [
      { line: 2, col: 18, chineseText: '第一行\n第二行中文', type: 'static-attr', attrName: 'placeholder' },
    ], reverseMap, false, 3);
    assert(changed === true, '多行单引号属性应返回 changed=true');
    const content = fs.readFileSync(multiFile, 'utf-8');
    assert(content.includes(":placeholder=\"$t('common.multiLine')\""), '多行单引号属性未替换');
    return true;
  });

  // 5. 二次运行：已替换的文件不应重复替换，changed 应为 false
  test('二次运行: 无新匹配，changed=false 不重复写入', async () => {
    const before = fs.readFileSync(path.join(srcDir, 'views', 'a.vue'), 'utf-8');
    const { results: results2 } = await scanFiles(config, TEST_DIR);
    const matched2 = [];
    for (const item of results2) {
      const { key, matched: isMatched } = lookupKey(item.chineseText, reverseMap);
      if (isMatched) matched2.push({ ...item, key });
    }
    const fileGroups2 = {};
    for (const item of matched2) {
      const relPath = path.relative(TEST_DIR, item.file).replace(/\\/g, '/');
      if (!fileGroups2[relPath]) fileGroups2[relPath] = [];
      fileGroups2[relPath].push(item);
    }
    let changedCount = 0;
    for (const [relPath, items] of Object.entries(fileGroups2)) {
      const { changed } = replaceInFile(path.resolve(TEST_DIR, relPath), items, reverseMap, false, 3);
      if (changed) changedCount++;
    }
    const after = fs.readFileSync(path.join(srcDir, 'views', 'a.vue'), 'utf-8');
    assert(changedCount === 0, `二次运行不应有替换，实际 ${changedCount} 个文件 changed`);
    assert(before === after, '二次运行不应改动文件内容');
    return true;
  });

  console.log('\n=== 真实项目文件回归测试 ===\n');

  // 复制真实 vue2 项目的几个文件（含 script 和复杂 template）
  const REAL_SRC = path.resolve(SCRIPT_DIR, '../../program/vue2-applicationSystemServices/src');
  const realFiles = [
    'components/DeviceSubGroup/index.vue',
    'components/FlowPopup/flowPopup.vue',
    'components/AttachmentsInfo/attachments-table.vue',
  ];
  const realDir = path.join(TEST_DIR, 'real');
  for (const rel of realFiles) {
    const srcPath = path.join(REAL_SRC, rel);
    if (!fs.existsSync(srcPath)) continue;
    const destPath = path.join(realDir, rel);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }

  const realConfig = buildConfig({
    entry: ['real/**/*.vue'],
    scanScript: true,
    scriptTargets: { EmpowerRule: ['message'] },
    translateMethods: ['this.$message.*', 'this.$confirm', 'this.$alert'],
    translateAttributes: ['label', 'placeholder', 'title', 'titleInfo', 'tip-content', 'title-info', 'alt', 'message', 'content', 'desc', 'text', 'header', 'menuTitle'],
  });

  test('真实文件: 扫描无错误', async () => {
    const { results, errors } = await scanFiles(realConfig, TEST_DIR);
    assert(errors.length === 0, `扫描错误: ${errors.map((e) => e.message).join('; ')}`);
    assert(results.length > 0, '扫描结果为空');
    return true;
  });

  test('真实文件: 全量匹配后替换，changed 与匹配文件数一致', async () => {
    const { results } = await scanFiles(realConfig, TEST_DIR);
    // 用扫描结果构建语言包，保证 100% 匹配
    const pack = {};
    let i = 0;
    for (const item of results) {
      if (!pack[item.chineseText]) pack[item.chineseText] = `common.k${i++}`;
    }
    const reverseMap = {};
    for (const [chinese, key] of Object.entries(pack)) reverseMap[chinese] = key;

    // 分类
    const matched = [];
    for (const item of results) {
      const { key, matched: isMatched } = lookupKey(item.chineseText, reverseMap);
      if (isMatched) matched.push({ ...item, key });
    }
    assert(matched.length === results.length, `应有 ${results.length} 条匹配，实际 ${matched.length}`);

    // 分组
    const fileGroups = {};
    for (const item of matched) {
      const relPath = path.relative(TEST_DIR, item.file).replace(/\\/g, '/');
      if (!fileGroups[relPath]) fileGroups[relPath] = [];
      fileGroups[relPath].push(item);
    }

    // 替换
    let filesModified = 0;
    for (const [relPath, items] of Object.entries(fileGroups)) {
      const filePath = path.resolve(TEST_DIR, relPath);
      const { changed } = replaceInFile(filePath, items, reverseMap, false, 2);
      if (changed) filesModified++;
    }

    const expected = Object.keys(fileGroups).length;
    assert(
      filesModified === expected,
      `期望 ${expected} 个文件被修改，实际 ${filesModified}`
    );

    // 验证没有残留可替换的中文
    const { results: after } = await scanFiles(realConfig, TEST_DIR);
    const remaining = after.filter((item) => {
      const { matched: isMatched } = lookupKey(item.chineseText, reverseMap);
      return isMatched;
    });
    assert(
      remaining.length === 0,
      `替换后仍有 ${remaining.length} 条可替换中文残留: ${remaining
        .slice(0, 5)
        .map((r) => `${r.file}:${r.line} ${r.chineseText}`)
        .join(' | ')}`
    );
    return true;
  });

  test('真实文件: 两轮运行（部分匹配→全量匹配），每轮 changed 计数正确', async () => {
    // 清理真实文件目录，重新复制
    fs.rmSync(realDir, { recursive: true, force: true });
    for (const rel of realFiles) {
      const srcPath = path.join(REAL_SRC, rel);
      if (!fs.existsSync(srcPath)) continue;
      const destPath = path.join(realDir, rel);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }

    const { results } = await scanFiles(realConfig, TEST_DIR);

    // 第 1 轮：语言包只覆盖一半的中文（模拟用户手动填了部分语言包）
    const allPack = {};
    const halfPack = {};
    const uniques = [];
    for (const item of results) {
      if (!allPack[item.chineseText]) {
        allPack[item.chineseText] = `common.k${uniques.length}`;
        uniques.push(item.chineseText);
      }
    }
    uniques.forEach((chinese, idx) => {
      if (idx % 2 === 0) halfPack[chinese] = allPack[chinese];
    });
    const reverseMapHalf = {};
    for (const [chinese, key] of Object.entries(halfPack)) reverseMapHalf[chinese] = key;
    const reverseMapFull = {};
    for (const [chinese, key] of Object.entries(allPack)) reverseMapFull[chinese] = key;

    // 第 1 轮：部分匹配
    const matched1 = [];
    for (const item of results) {
      const { key, matched: isMatched } = lookupKey(item.chineseText, reverseMapHalf);
      if (isMatched) matched1.push({ ...item, key });
    }
    const groups1 = {};
    for (const item of matched1) {
      const relPath = path.relative(TEST_DIR, item.file).replace(/\\/g, '/');
      if (!groups1[relPath]) groups1[relPath] = [];
      groups1[relPath].push(item);
    }
    let count1 = 0;
    for (const [relPath, items] of Object.entries(groups1)) {
      const { changed } = replaceInFile(path.resolve(TEST_DIR, relPath), items, reverseMapHalf, false, 2);
      if (changed) count1++;
    }
    assert(count1 === Object.keys(groups1).length, `第1轮: 期望修改 ${Object.keys(groups1).length} 个文件，实际 ${count1}`);

    // 第 2 轮：全量语言包（模拟 AI 补齐后再次 -s）
    const { results: results2 } = await scanFiles(realConfig, TEST_DIR);
    const matched2 = [];
    for (const item of results2) {
      const { key, matched: isMatched } = lookupKey(item.chineseText, reverseMapFull);
      if (isMatched) matched2.push({ ...item, key });
    }
    const groups2 = {};
    for (const item of matched2) {
      const relPath = path.relative(TEST_DIR, item.file).replace(/\\/g, '/');
      if (!groups2[relPath]) groups2[relPath] = [];
      groups2[relPath].push(item);
    }
    let count2 = 0;
    for (const [relPath, items] of Object.entries(groups2)) {
      const { changed } = replaceInFile(path.resolve(TEST_DIR, relPath), items, reverseMapFull, false, 2);
      if (changed) count2++;
    }
    assert(count2 === Object.keys(groups2).length, `第2轮: 期望修改 ${Object.keys(groups2).length} 个文件，实际 ${count2}`);
    assert(count2 > 0, '第2轮应有替换（第1轮未覆盖的中文）');

    // 两轮后不应有可替换中文残留
    const { results: after } = await scanFiles(realConfig, TEST_DIR);
    const remaining = after.filter((item) => lookupKey(item.chineseText, reverseMapFull).matched);
    assert(remaining.length === 0, `两轮后仍有 ${remaining.length} 条中文残留`);
    return true;
  });

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('测试异常:', err);
  process.exit(1);
});

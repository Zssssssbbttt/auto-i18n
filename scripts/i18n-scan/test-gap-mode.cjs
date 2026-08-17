#!/usr/bin/env node
/**
 * 单元测试：盲区扫描（gap mode）
 * 验证 -g 模式能突破白名单限制，收集非白名单的中文
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPT_DIR = __dirname;
const { scanFiles } = require(path.join(SCRIPT_DIR, 'scanner.cjs'));

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-gap-test-'));

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    if (fn()) { passed++; console.log('  ✓ ' + name); }
    else { failed++; console.log('  ✗ FAIL: ' + name); }
  } catch (e) {
    failed++;
    console.log('  ✗ ERROR: ' + name + ' — ' + e.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function buildConfig(overrides) {
  overrides = overrides || {};
  return Object.assign({
    entry: ['src/**/*.vue'],
    exclude: [],
    scanScript: true,
    scriptTargets: {},
    translateAttributes: ['label', 'placeholder'],
    ignoreAttributes: [],
    translateMethods: [],
  }, overrides);
}

// 准备测试项目
var srcDir = path.join(TEST_DIR, 'src');
fs.mkdirSync(path.join(srcDir, 'views'), { recursive: true });

// 1. Template 非白名单属性
fs.writeFileSync(path.join(srcDir, 'views', 'template-gap.vue'), [
  '<template>',
  '  <div>',
  '    <el-input label="请输入姓名" placeholder="请填写" />',
  '    <el-select empty-text="暂无数据" />',
  '  </div>',
  '</template>',
  '',
].join('\n'), 'utf-8');

// 2. Script 非白名单变量 + 方法调用
fs.writeFileSync(path.join(srcDir, 'views', 'script-gap.vue'), [
  '<template>',
  '  <div><span>文本</span></div>',
  '</template>',
  '<script setup>',
  '// 不在 scriptTargets 里的变量',
  "const tips = '这是提示信息'",
  '// 不在 translateMethods 里的方法调用',
  "console.log('这段中文会被漏掉')",
  '</script>',
  '',
].join('\n'), 'utf-8');

// 3. 安全过滤项
fs.writeFileSync(path.join(srcDir, 'views', 'safety.vue'), [
  '<template>',
  '  <div class="安全过滤测试"></div>',
  '</template>',
  '<script setup lang="ts">',
  "import { ref } from 'vue'",
  "type Status = '已通过'",
  "const obj = { ['这是一个key']: 'value' }",
  "form.status = '这是数据值'",
  '</script>',
  '',
].join('\n'), 'utf-8');

// 4. 模板字符串插值
var tlContent = 'const msg = `共${total}条记录`'; // 共${total}条记录
fs.writeFileSync(path.join(srcDir, 'views', 'template-literal.vue'), [
  '<template>',
  '  <div></div>',
  '</template>',
  '<script setup>',
  tlContent,
  '</script>',
  '',
].join('\n'), 'utf-8');

var config = buildConfig();

async function main() {
  console.log('临时测试目录: ' + TEST_DIR + '\n');
  console.log('=== 盲区扫描（gap mode）单元测试 ===\n');

  var normal = await scanFiles(config, TEST_DIR);
  var gap = await scanFiles(config, TEST_DIR, { gap: true });

  // 1. 模板：非白名单属性
  test('正常模式：只收集白名单属性（label, placeholder）', function() {
    var items = normal.results.filter(function(r) {
      return r.file && r.file.indexOf('template-gap.vue') >= 0;
    });
    var attrs = items.filter(function(r) { return r.type === 'static-attr'; });
    assert(attrs.length === 2, '期望 2 条，实际 ' + attrs.length);
    var names = attrs.map(function(r) { return r.attrName; }).sort();
    assert(names.join(',') === 'label,placeholder', '实际: ' + names.join(','));
    return true;
  });

  test('盲区模式：收集所有含中文的属性（含非白名单 empty-text）', function() {
    var items = gap.results.filter(function(r) {
      return r.file && r.file.indexOf('template-gap.vue') >= 0;
    });
    var attrs = items.filter(function(r) { return r.type === 'static-attr'; });
    assert(attrs.length === 3, '期望 3 条，实际 ' + attrs.length);
    var hasEmptyText = attrs.some(function(r) {
      return r.attrName === 'empty-text' && r.chineseText === '暂无数据';
    });
    assert(hasEmptyText, '未找到 empty-text="暂无数据"');
    return true;
  });

  test('盲区模式：白名单属性也一并收集', function() {
    var items = gap.results.filter(function(r) {
      return r.file && r.file.indexOf('template-gap.vue') >= 0;
    });
    var attrs = items.filter(function(r) { return r.type === 'static-attr'; });
    var hasLabel = attrs.some(function(r) { return r.attrName === 'label'; });
    var hasPlaceholder = attrs.some(function(r) { return r.attrName === 'placeholder'; });
    assert(hasLabel && hasPlaceholder, '白名单属性缺失');
    return true;
  });

  // 2. 脚本：非白名单变量 + 方法调用
  test('正常模式：script 不收集非白名单变量/方法的中文', function() {
    var items = normal.results.filter(function(r) {
      return r.file && r.file.indexOf('script-gap.vue') >= 0 && r.section === 'script';
    });
    assert(items.length === 0, '期望 0 条，实际 ' + items.length);
    return true;
  });

  test('盲区模式：script 收集所有中文', function() {
    var items = gap.results.filter(function(r) {
      return r.file && r.file.indexOf('script-gap.vue') >= 0 && r.section === 'script';
    });
    assert(items.length >= 2, '期望 >= 2 条，实际 ' + items.length);
    var hasTips = items.some(function(r) { return r.chineseText === '这是提示信息'; });
    var hasConsole = items.some(function(r) { return r.chineseText === '这段中文会被漏掉'; });
    assert(hasTips, '未收集到 "这是提示信息"');
    assert(hasConsole, '未收集到 "这段中文会被漏掉"');
    return true;
  });

  // 3. 安全过滤
  test('盲区模式：不收集 import 声明中的中文', function() {
    var items = gap.results.filter(function(r) {
      return r.file && r.file.indexOf('safety.vue') >= 0 && r.section === 'script';
    });
    var importItems = items.filter(function(r) { return r.chineseText === 'vue'; });
    assert(importItems.length === 0, 'import 中的字符串不应被收集');
    return true;
  });

  test('盲区模式：不收集 TS 类型注解中的中文', function() {
    var items = gap.results.filter(function(r) {
      return r.file && r.file.indexOf('safety.vue') >= 0 && r.section === 'script';
    });
    var typeItems = items.filter(function(r) { return r.chineseText === '已通过'; });
    assert(typeItems.length === 0, 'TS 类型注解中的字符串不应被收集');
    return true;
  });

  test('盲区模式：不收集对象 computed key 中的中文', function() {
    var items = gap.results.filter(function(r) {
      return r.file && r.file.indexOf('safety.vue') >= 0 && r.section === 'script';
    });
    var keyItems = items.filter(function(r) { return r.chineseText === '这是一个key'; });
    assert(keyItems.length === 0, '对象 computed key 不应被收集');
    return true;
  });

  test('盲区模式：不收集成员赋值中的中文', function() {
    var items = gap.results.filter(function(r) {
      return r.file && r.file.indexOf('safety.vue') >= 0 && r.section === 'script';
    });
    var assignItems = items.filter(function(r) { return r.chineseText === '这是数据值'; });
    assert(assignItems.length === 0, '成员赋值中的字符串不应被收集');
    return true;
  });

  // 4. 模板字符串插值
  test('盲区模式：模板字符串含插值 → 标记为 special-template-literal', function() {
    var items = gap.results.filter(function(r) {
      return r.file && r.file.indexOf('template-literal.vue') >= 0 && r.section === 'script';
    });
    var special = items.filter(function(r) { return r.type === 'special-template-literal'; });
    assert(special.length >= 1, '期望 >= 1 条 special-template-literal，实际 ' + special.length);
    var hasItem = special.some(function(r) {
      return r.chineseText === '共' || r.chineseText === '条记录';
    });
    assert(hasItem, '模板字符串插值部分未收集');
    return true;
  });

  // 5. 回归
  test('回归：正常模式结果不受 gap 代码改动影响', async function() {
    var normal2 = await scanFiles(config, TEST_DIR);
    assert(
      normal.results.length === normal2.results.length,
      '两次正常扫描结果数量应一致: ' + normal.results.length + ' vs ' + normal2.results.length
    );
    return true;
  });

  console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function(err) {
  console.error('测试异常:', err);
  process.exit(1);
});
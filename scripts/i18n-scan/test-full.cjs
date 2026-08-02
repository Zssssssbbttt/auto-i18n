#!/usr/bin/env node
/**
 * 全量功能测试 — i18n 脚本
 * 覆盖：parseScript、parseVueFile、scanner、replacer
 */
const fs = require('fs');
const path = require('path');

const PROJECT_DIR = '/Users/zhousiyu/auto-i18n';
const TEST_DIR = '/tmp/i18n-test';
const SRC_DIR = path.join(TEST_DIR, 'src');

// 清理 + 重建
fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(SRC_DIR, 'locales'), { recursive: true });
fs.mkdirSync(path.join(SRC_DIR, 'views'), { recursive: true });
fs.mkdirSync(path.join(SRC_DIR, 'utils'), { recursive: true });

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    if (fn()) { passed++; }
    else { failed++; console.log(`  ✗ FAIL: ${name}`); }
  } catch (e) {
    failed++;
    console.log(`  ✗ ERROR: ${name} — ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// =====================================================================
// 第1部分：parseScript 单元测试
// =====================================================================
console.log('\n=== 第1部分：parseScript 单元测试 ===\n');

const { parseScript } = require(path.join(PROJECT_DIR, 'scripts/i18n-scan/parsers/script-parser.cjs'));

// --- 1.1 变量全量翻译 (scriptTargets: { varName: [] }) ---
test('变量+纯字符串', () => {
  const r = parseScript('const label = "中文"', [], 0, { label: [] });
  assert(r.length === 1 && r[0].chineseText === '中文' && r[0].type === 'script-string');
  assert(r[0].varName === 'label' && r[0].isConst === true);
  return true;
});

test('变量+模板插值(单行)', () => {
  const r = parseScript('const msg = `共${n}条记录`', [], 0, { msg: [] });
  assert(r.every(x => x.type === 'template-literal'));
  assert(r.every(x => x.quasis && x.expressions));
  assert(r.map(x => x.chineseText).includes('共'));
  assert(r.map(x => x.chineseText).includes('条记录'));
  return true;
});

test('变量+模板插值(标记为template-literal)', () => {
  // 单行插值模板 → template-literal（交由 replacer 重建）
  const r = parseScript('const msg = `共${n}条记录`', [], 0, { msg: [] });
  assert(r.every(x => x.type === 'template-literal'));
  assert(r.some(x => x.chineseText === '共'));
  assert(r.some(x => x.chineseText === '条记录'));
  return true;
});

test('变量+拼接', () => {
  const r = parseScript('const label = "共" + n + "条"', [], 0, { label: [] });
  assert(r.length === 2);
  assert(r.map(x => x.chineseText).includes('共'));
  assert(r.map(x => x.chineseText).includes('条'));
  return true;
});

test('变量+三元', () => {
  const r = parseScript('const label = cond ? "是" : "否"', [], 0, { label: [] });
  assert(r.length === 2);
  assert(r.map(x => x.type).every(t => t === 'script-string'));
  return true;
});

test('变量+嵌套三元', () => {
  const r = parseScript(
    'const label = a ? "一" : (b ? "二" : "三")', [], 0, { label: [] }
  );
  assert(r.length === 3);
  return true;
});

// --- 1.2 精确属性匹配 (scriptTargets: { varName: ['label'] }) ---
test('对象+纯字符串(label匹配)', () => {
  const r = parseScript('const cols = { label: "姓名", prop: "name" }', [], 0, { cols: ['label'] });
  assert(r.length === 1 && r[0].chineseText === '姓名');
  return true;
});

test('对象+不匹配属性跳过', () => {
  const r = parseScript('const cols = { label: "姓名", other: "跳过我" }', [], 0, { cols: ['label'] });
  assert(r.length === 1);
  return true;
});

test('数组+嵌套对象', () => {
  const r = parseScript(
    'const cols = [{ label: "姓名" }, { label: "年龄" }]', [], 0, { cols: ['label'] }
  );
  assert(r.length === 2);
  return true;
});

test('深层嵌套对象', () => {
  const r = parseScript(
    'const data = { child: { label: "子项" }, items: [{ label: "项目" }] }', [], 0,
    { data: ['label'] }
  );
  assert(r.length === 2);
  return true;
});

test('对象+模板插值(属性匹配)', () => {
  const r = parseScript(
    'const cols = { label: `共${n}条` }', [], 0, { cols: ['label'] }
  );
  assert(r.every(x => x.type === 'template-literal'));
  return true;
});

test('对象+拼接(属性匹配)', () => {
  const r = parseScript(
    'const cols = { label: "共" + n + "条" }', [], 0, { cols: ['label'] }
  );
  assert(r.length === 2);
  return true;
});

test('对象+三元(属性匹配)', () => {
  const r = parseScript(
    'const cols = { label: cond ? "是" : "否" }', [], 0, { cols: ['label'] }
  );
  assert(r.length === 2);
  return true;
});

// --- 1.3 Vue 响应式包裹 ---
test('ref包裹(属性匹配)', () => {
  const r = parseScript('const form = ref({ label: "姓名" })', [], 0, { form: ['label'] });
  assert(r.length === 1 && r[0].chineseText === '姓名');
  return true;
});

test('ref包裹(全量翻译)', () => {
  const r = parseScript('const msg = ref("中文")', [], 0, { msg: [] });
  assert(r.length === 1 && r[0].chineseText === '中文');
  return true;
});

test('reactive包裹', () => {
  const r = parseScript('const st = reactive({ title: "标题" })', [], 0, { st: ['title'] });
  assert(r.length === 1);
  return true;
});

// --- 1.4 跳过规则 ---
test('跳过函数调用初始化', () => {
  const r = parseScript('const data = fetchData()', [], 0, { data: ['label'] });
  assert(r.length === 0);
  return true;
});

test('跳过await初始化', () => {
  const r = parseScript('const data = await getList()', [], 0, { data: ['label'] });
  assert(r.length === 0);
  return true;
});

test('跳过非whiteList方法的函数调用', () => {
  const r = parseScript('someFn("中文")', ['ElMessage.*'], 0, {});
  assert(r.length === 0);
  return true;
});

test('跳过不在scriptTargets中的变量', () => {
  const r = parseScript('const other = "中文"', [], 0, { cols: ['label'] });
  assert(r.length === 0);
  return true;
});

test('跳过解构声明', () => {
  const r = parseScript('const { label } = obj', [], 0, { label: [] });
  assert(r.length === 0);
  return true;
});

test('跳过成员赋值', () => {
  const r = parseScript('form.status = "已通过"', [], 0, { form: ['status'] });
  assert(r.length === 0);
  return true;
});

// --- 1.5 translateMethods 独立路径 ---
test('translateMethods匹配', () => {
  const r = parseScript('ElMessage.success("操作成功")', ['ElMessage.*'], 0, {});
  assert(r.length === 1 && r[0].chineseText === '操作成功');
  return true;
});

test('translateMethods通配符', () => {
  const r = parseScript('ElMessage.warning("警告信息")', ['ElMessage.*'], 0, {});
  assert(r.length === 1);
  return true;
});

test('translateMethods模板字符串', () => {
  const r = parseScript('ElMessage.success(`操作${name}成功`)', ['ElMessage.*'], 0, {});
  assert(r[0].type === 'special-template-literal');
  return true;
});

test('translateMethods与scriptTargets互不干扰', () => {
  const code = 'const cols = [{ label: "姓名" }];\nElMessage.success("操作成功");';
  const r = parseScript(code, ['ElMessage.*'], 0, { cols: ['label'] });
  assert(r.length === 2);
  assert(r.some(x => x.chineseText === '姓名' && x.varName === 'cols'));
  assert(r.some(x => x.chineseText === '操作成功' && !x.varName));
  return true;
});

// --- 1.6 元数据 ---
test('const标记', () => {
  const r = parseScript('const a = "中文"', [], 0, { a: [] });
  assert(r[0].isConst === true);
  return true;
});

test('let标记', () => {
  const r = parseScript('let a = "中文"', [], 0, { a: [] });
  assert(r[0].isConst === false);
  return true;
});

test('var标记', () => {
  const r = parseScript('var a = "中文"', [], 0, { a: [] });
  assert(r[0].isConst === false);
  return true;
});

test('位置信息', () => {
  const r = parseScript('const columns = [{ label: "姓名" }]', [], 0, { columns: ['label'] });
  assert(r[0].initStartLine > 0 && r[0].initStartCol > 0 && r[0].initEndLine > 0);
  return true;
});

// =====================================================================
// 第2部分：parseVueFile SFC 解析测试
// =====================================================================
console.log('\n=== 第2部分：parseVueFile SFC 解析测试 ===\n');

const { parseVueFile } = require(path.join(PROJECT_DIR, 'scripts/i18n-scan/parsers/vue-sfc-parser.cjs'));

const VUE_FILE = `<template>
  <div>
    <span>你好世界</span>
    <el-input placeholder="请输入姓名" />
  </div>
</template>

<script setup>
import { ref } from 'vue'

const columns = [
  { label: '姓名', prop: 'name' },
  { label: '年龄', prop: 'age' },
]

ElMessage.success('操作成功')
</script>
`;

test('SFC template提取', () => {
  const config = {
    translateAttributes: ['placeholder'],
    ignoreAttributes: [],
    translateMethods: ['ElMessage.*'],
    scanScript: true,
    scriptTargets: { columns: ['label'] },
  };
  const { results, errors } = parseVueFile('test.vue', VUE_FILE, config);
  assert(errors.length === 0, `errors: ${errors.join(', ')}`);

  const templateResults = results.filter(r => r.section === 'template');
  const scriptResults = results.filter(r => r.section === 'script');

  // template: 2 results ('你好世界' text + '请输入姓名' placeholder)
  assert(templateResults.length === 2, `template count: ${templateResults.length}`);
  assert(templateResults.some(r => r.chineseText === '你好世界'));
  assert(templateResults.some(r => r.chineseText === '请输入姓名'));

  // script: columns.label 匹配到 '姓名' 和 '年龄', translateMethods 匹配到 '操作成功'
  assert(scriptResults.length === 3, `script count: ${scriptResults.length}`);
  assert(scriptResults.some(r => r.chineseText === '姓名' && r.varName === 'columns'));
  assert(scriptResults.some(r => r.chineseText === '年龄' && r.varName === 'columns'));
  assert(scriptResults.some(r => r.chineseText === '操作成功' && !r.varName));
  return true;
});

test('SFC scanScript关闭时不解析script', () => {
  const config = {
    translateAttributes: [],
    ignoreAttributes: [],
    scanScript: false,
  };
  const { results } = parseVueFile('test.vue', VUE_FILE, config);
  assert(results.every(r => r.section === 'template'));
  return true;
});

// =====================================================================
// 第3部分：scanner 文件扫描测试
// =====================================================================
console.log('\n=== 第3部分：scanner 文件扫描测试 ===\n');

// 创建测试文件
fs.writeFileSync(path.join(SRC_DIR, 'views', 'Test.vue'), VUE_FILE);

fs.writeFileSync(path.join(SRC_DIR, 'utils', 'constants.ts'),
`export const STATUS_MAP = {
  active: '已激活',
  inactive: '未激活',
}

export function getStatusLabel(status: string): string {
  return STATUS_MAP[status] || '未知'
}
`);

fs.writeFileSync(path.join(SRC_DIR, 'utils', 'config.js'),
`export const tableColumns = [
  { label: '用户名', key: 'username' },
  { label: '邮箱', key: 'email' },
]
`);

const { scanFiles } = require(path.join(PROJECT_DIR, 'scripts/i18n-scan/scanner.cjs'));

test('scanner扫描.vue文件', async () => {
  const config = {
    entry: ['src/views/Test.vue'],
    exclude: [],
    translateAttributes: ['placeholder'],
    ignoreAttributes: [],
    translateMethods: ['ElMessage.*'],
    scanScript: true,
    scriptTargets: { columns: ['label'] },
  };
  const { results, errors, filesScanned } = await scanFiles(config, TEST_DIR);
  assert(errors.length === 0, `errors: ${JSON.stringify(errors)}`);
  assert(filesScanned === 1);
  assert(results.length === 5); // 2 template + 3 script
  return true;
});

test('scanner扫描.ts文件', async () => {
  const config = {
    entry: ['src/utils/constants.ts'],
    exclude: [],
    translateMethods: [],
    scanScript: true,
    scriptTargets: { STATUS_MAP: [] },
  };
  const { results, errors, filesScanned } = await scanFiles(config, TEST_DIR);
  assert(errors.length === 0, `errors: ${JSON.stringify(errors)}`);
  assert(filesScanned === 1);
  assert(results.length === 2); // '已激活' and '未激活'
  // The '未知' string is in a function, not in STATUS_MAP init, so should NOT be picked up
  assert(results.every(r => r.varName === 'STATUS_MAP'));
  return true;
});

test('scanner扫描.js文件', async () => {
  const config = {
    entry: ['src/utils/config.js'],
    exclude: [],
    translateMethods: [],
    scanScript: true,
    scriptTargets: { tableColumns: ['label'] },
  };
  const { results, errors, filesScanned } = await scanFiles(config, TEST_DIR);
  assert(errors.length === 0);
  assert(filesScanned === 1);
  assert(results.length === 2); // '用户名', '邮箱'
  assert(results.every(r => r.varName === 'tableColumns'));
  return true;
});

test('scanner同时扫描多类型文件', async () => {
  const config = {
    entry: ['src/**/*.{vue,ts,js}'],
    exclude: [],
    translateAttributes: ['placeholder'],
    ignoreAttributes: [],
    translateMethods: ['ElMessage.*'],
    scanScript: true,
    scriptTargets: {
      columns: ['label'],
      STATUS_MAP: [],
      tableColumns: ['label'],
    },
  };
  const { results, filesScanned } = await scanFiles(config, TEST_DIR);
  assert(filesScanned === 3);
  assert(results.length > 0);
  // 验证各 section 标记
  const vue = results.filter(r => r.file.endsWith('.vue'));
  const ts = results.filter(r => r.file.endsWith('.ts'));
  const js = results.filter(r => r.file.endsWith('.js'));
  assert(vue.length > 0 && ts.length > 0 && js.length > 0);
  assert(vue.every(r => r.section === 'template' || r.section === 'script'));
  assert(ts.every(r => r.section === 'script'));
  assert(js.every(r => r.section === 'script'));
  return true;
});

// =====================================================================
// 第4部分：replacer 替换测试
// =====================================================================
console.log('\n=== 第4部分：replacer 替换测试 ===\n');

const { replaceInFile } = require(path.join(PROJECT_DIR, 'scripts/i18n-scan/replacer.cjs'));

// 准备 locale 文件（反向映射）
const zhCN = {
  common: {
    world: '你好世界',
    name_placeholder: '请输入姓名',
    success: '操作成功',
    name: '姓名',
    age: '年龄',
    active: '已激活',
    inactive: '未激活',
    username: '用户名',
    email: '邮箱',
  }
};

function buildReverseMap(zhCN) {
  const map = {};
  for (const [mod, keys] of Object.entries(zhCN)) {
    for (const [k, v] of Object.entries(keys)) {
      map[v] = `${mod}.${k}`;
    }
  }
  return map;
}

const reverseMap = buildReverseMap(zhCN);

test('replacer: .vue文件替换+import注入', () => {
  const testFile = path.join(SRC_DIR, 'views', 'ReplaceTest.vue');
  fs.writeFileSync(testFile,
`<template>
  <span>你好世界</span>
</template>
<script setup>
ElMessage.success('操作成功')
</script>
`);

  const items = [
    {
      line: 2, chineseText: '你好世界', type: 'text-content',
      file: testFile, section: 'template',
    },
    {
      line: 5, chineseText: '操作成功', type: 'script-string',
      file: testFile, section: 'script',
    },
  ];

  const { changed, newKeys } = replaceInFile(testFile, items, reverseMap);
  assert(changed === true);
  assert(newKeys.length === 0);

  const content = fs.readFileSync(testFile, 'utf-8');
  assert(content.includes("{{ $t('common.world') }}"));
  assert(content.includes("$t('common.success')"));
  assert(content.includes("import { $t } from '@/locales'"));
  return true;
});

test('replacer: scriptReactive computed包裹', () => {
  const testFile = path.join(SRC_DIR, 'views', 'ReactiveTest.vue');
  fs.writeFileSync(testFile,
`<script setup>
const columns = [
  { label: '姓名', prop: 'name' },
  { label: '年龄', prop: 'age' },
]
</script>
`);

  const items = [
    {
      line: 3, chineseText: '姓名', type: 'script-string',
      file: testFile, section: 'script',
      varName: 'columns', isConst: true,
      initStartLine: 2, initStartCol: 16, initEndLine: 5, initEndCol: 1,
    },
    {
      line: 4, chineseText: '年龄', type: 'script-string',
      file: testFile, section: 'script',
      varName: 'columns', isConst: true,
      initStartLine: 2, initStartCol: 16, initEndLine: 5, initEndCol: 1,
    },
  ];

  const { changed } = replaceInFile(testFile, items, reverseMap, true);
  assert(changed === true);

  const content = fs.readFileSync(testFile, 'utf-8');
  assert(content.includes('computed(() =>'), 'should contain computed wrapper');
  assert(content.includes("$t('common.name')"));
  assert(content.includes("$t('common.age')"));
  assert(content.includes("import { $t } from '@/locales'"));
  assert(content.includes("import { computed } from 'vue'"));
  return true;
});

test('replacer: scriptReactive=false 不包裹', () => {
  const testFile = path.join(SRC_DIR, 'views', 'NonReactiveTest.vue');
  fs.writeFileSync(testFile,
`<script setup>
const columns = [
  { label: '姓名', prop: 'name' },
]
</script>
`);

  const items = [{
    line: 3, chineseText: '姓名', type: 'script-string',
    file: testFile, section: 'script',
    varName: 'columns', isConst: true,
    initStartLine: 2, initStartCol: 16, initEndLine: 4, initEndCol: 1,
  }];

  const { changed } = replaceInFile(testFile, items, reverseMap, false);
  const content = fs.readFileSync(testFile, 'utf-8');
  assert(!content.includes('computed(() =>'), 'should NOT contain computed wrapper');
  assert(content.includes("$t('common.name')"));
  return true;
});

test('replacer: let变量不包裹computed', () => {
  const testFile = path.join(SRC_DIR, 'views', 'LetVarTest.vue');
  fs.writeFileSync(testFile,
`<script setup>
let items = [
  { label: '姓名' },
]
</script>
`);

  const items = [{
    line: 3, chineseText: '姓名', type: 'script-string',
    file: testFile, section: 'script',
    varName: 'items', isConst: false,
    initStartLine: 2, initStartCol: 13, initEndLine: 4, initEndCol: 1,
  }];

  const { changed } = replaceInFile(testFile, items, reverseMap, true);
  const content = fs.readFileSync(testFile, 'utf-8');
  assert(!content.includes('computed(() =>'), 'let should NOT be wrapped');
  assert(content.includes("$t('common.name')"));
  return true;
});

test('replacer: 已有import时不重复注入', () => {
  const testFile = path.join(SRC_DIR, 'views', 'DupImportTest.vue');
  fs.writeFileSync(testFile,
`<script setup>
import { $t } from '@/locales'
import { computed } from 'vue'

const label = '姓名'
</script>
`);

  const items = [{
    line: 5, chineseText: '姓名', type: 'script-string',
    file: testFile, section: 'script',
  }];

  replaceInFile(testFile, items, reverseMap, false);
  const content = fs.readFileSync(testFile, 'utf-8');
  // 统计 $t import 出现次数
  const tImports = (content.match(/import\s*\{[^}]*\$t[^}]*\}\s*from/g) || []).length;
  assert(tImports === 1, `should have exactly 1 $t import, got ${tImports}`);
  return true;
});

test('replacer: 已有computed时不重复注入', () => {
  const testFile = path.join(SRC_DIR, 'views', 'DupComputedTest.vue');
  fs.writeFileSync(testFile,
`<script setup>
import { computed } from 'vue'

const columns = [
  { label: '姓名' },
]
</script>
`);

  const items = [{
    line: 5, chineseText: '姓名', type: 'script-string',
    file: testFile, section: 'script',
    varName: 'columns', isConst: true,
    initStartLine: 4, initStartCol: 16, initEndLine: 6, initEndCol: 1,
  }];

  replaceInFile(testFile, items, reverseMap, true);
  const content = fs.readFileSync(testFile, 'utf-8');
  // computed 应该只有一处 import
  const computedImports = (content.match(/import\s*\{[^}]*computed[^}]*\}\s*from/g) || []).length;
  assert(computedImports === 1, `should have exactly 1 computed import, got ${computedImports}`);
  return true;
});

test('replacer: .ts文件替换', () => {
  const testFile = path.join(SRC_DIR, 'utils', 'replace-test.ts');
  fs.writeFileSync(testFile, `export const STATUS_MAP = {\n  active: '已激活',\n  inactive: '未激活',\n}\n`);

  const items = [
    { line: 2, chineseText: '已激活', type: 'script-string', file: testFile, section: 'script',
      varName: 'STATUS_MAP', isConst: true,
      initStartLine: 1, initStartCol: 26, initEndLine: 4, initEndCol: 1 },
    { line: 3, chineseText: '未激活', type: 'script-string', file: testFile, section: 'script',
      varName: 'STATUS_MAP', isConst: true,
      initStartLine: 1, initStartCol: 26, initEndLine: 4, initEndCol: 1 },
  ];

  const { changed } = replaceInFile(testFile, items, reverseMap, false);
  assert(changed === true);
  const content = fs.readFileSync(testFile, 'utf-8');
  assert(content.includes("$t('common.active')"));
  assert(content.includes("$t('common.inactive')"));
  return true;
});

test('replacer: static-attr替换', () => {
  const testFile = path.join(SRC_DIR, 'views', 'AttrTest.vue');
  fs.writeFileSync(testFile, `<template>\n  <el-input placeholder="请输入姓名" />\n</template>\n`);

  const items = [{
    line: 2, chineseText: '请输入姓名', type: 'static-attr', attrName: 'placeholder',
    file: testFile, section: 'template',
  }];

  const { changed } = replaceInFile(testFile, items, reverseMap);
  const content = fs.readFileSync(testFile, 'utf-8');
  assert(content.includes(':placeholder='));
  assert(content.includes("$t('common.name_placeholder')"));
  return true;
});

test('replacer: template-literal重建', () => {
  const testFile = path.join(SRC_DIR, 'views', 'TLTest.vue');
  fs.writeFileSync(testFile, `<script setup>\nconst msg = \`共\${n}条记录\`\n</script>\n`);

  const items = [
    {
      line: 2, chineseText: '共', type: 'template-literal',
      quasiIndex: 0, templateStartCol: 13, templateEndCol: 22,
      quasis: ['共', '条记录'], expressions: ['n'],
      file: testFile, section: 'script',
    },
    {
      line: 2, chineseText: '条记录', type: 'template-literal',
      quasiIndex: 1, templateStartCol: 13, templateEndCol: 22,
      quasis: ['共', '条记录'], expressions: ['n'],
      file: testFile, section: 'script',
    },
  ];

  // mock keys for translation
  const tlReverseMap = { ...reverseMap, '共': 'common.total_prefix', '条记录': 'common.record_suffix' };
  const { changed } = replaceInFile(testFile, items, tlReverseMap);
  const content = fs.readFileSync(testFile, 'utf-8');
  assert(content.includes("${$t('common.total_prefix')}"));
  assert(content.includes("${$t('common.record_suffix')}"));
  return true;
});

// =====================================================================
// 结果
// =====================================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`  通过: ${passed}  |  失败: ${failed}  |  总计: ${passed + failed}`);
if (failed === 0) {
  console.log('  ✓ 全量测试通过');
} else {
  console.log('  ✗ 存在失败用例');
}
console.log(`${'='.repeat(60)}\n`);

// 清理
fs.rmSync(TEST_DIR, { recursive: true, force: true });

process.exit(failed > 0 ? 1 : 0);

#!/usr/bin/env node
/**
 * 单元测试：init-vue3 updateMainTs 注入正确性
 * 覆盖 updateMainTs 的所有代码路径：
 *   - 真实 Vue3 PC main.ts（顶层 createApp + 同行链式 .mount）→ 完整注入
 *   - 真实 Vue3 Mobile main.ts（qiankun 嵌套 createApp + 续行 .mount）→ 完整注入
 *   - 幂等性（真实两个项目二次运行零改动）
 *   - 模式 A/B/C 三种 .mount 写法
 *   - 已有 globalTLine 但缺 @vnet/i18n 注册（第二注入路径）
 *   - 无 import / 无 createApp / 无 .mount 的告警分支
 *   - 全部已存在 → 全跳过
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const { updateMainTs } = require(path.join(__dirname, 'init', 'init-vue3.cjs'));

const REAL_PC = path.resolve(__dirname, '../../program/vue3-fundTransfer/src/main.ts');
const REAL_MOBILE = path.resolve(__dirname, '../../program/vue3-moblie-fundTransfer/src/main.ts');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-maints-test-'));

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

// 每个用例独立的项目目录，互不影响
function makeProject(name, mainContent) {
  const dir = path.join(TEST_DIR, name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'main.ts'), mainContent, 'utf-8');
  return dir;
}

function readMain(dir) {
  return fs.readFileSync(path.join(dir, 'src', 'main.ts'), 'utf-8');
}

// 屏蔽 updateMainTs 的进度输出，返回日志
function silent(fn) {
  const logs = [];
  const orig = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try { fn(); } finally { console.log = orig; }
  return logs;
}

// 校验注入块的每一行缩进（顶层 indent 为空串，嵌套为 '  '）
function assertInjectedBlock(content, indent) {
  assert(content.includes(`\n${indent}// 全局注册 $t，模板中可直接使用\n`), `注释行缩进错误（期望 "${indent}"）`);
  assert(content.includes(`\n${indent}app.config.globalProperties.$t = $t\n`), 'globalTLine 缩进错误');
  assert(content.includes(`\n${indent}const compMsgs = getComponentMessages()\n`), 'compMsgs 行缩进错误');
  assert(content.includes(`\n${indent}for (const locale of Object.keys(compMsgs)) {\n`), 'for 行缩进错误');
  assert(content.includes(`\n${indent}  i18n.global.mergeLocaleMessage(locale, compMsgs[locale])\n`), 'for 体内行缩进错误');
  assert(content.includes(`\n${indent}}\n`), 'for 结束括号缩进错误');
  assert(content.includes(`\n${indent}setI18nInstance(i18n)\n`), 'setI18nInstance 行缩进错误');
}

console.log(`临时测试目录: ${TEST_DIR}\n`);
console.log('=== updateMainTs 全路径测试 ===\n');

// =====================================================================
// 1. 真实 Vue3 PC main.ts — 顶层 createApp + 同行链式 .mount（模式 B）
// =====================================================================
test('真实 Vue3 PC: 顶层注入无缩进前缀 + 同行链插入 .use(i18n)', () => {
  const dir = makeProject('real-pc', fs.readFileSync(REAL_PC, 'utf-8'));
  const logs = silent(() => updateMainTs(dir));
  const content = readMain(dir);

  assertInjectedBlock(content, '');
  assert(content.includes("import i18n, { $t } from './locales'"), '缺少 i18n import');
  assert(content.includes("import { setI18nInstance, getComponentMessages } from '@vnet/i18n'"), '缺少 @vnet/i18n import');
  // 模式 B：原链式调用中 .use(i18n) 插在 .mount( 前，其余原样
  assert(
    content.includes('app.use(ElementPlus, { locale: zhCn }).use(router).use(i18n).mount("#app");'),
    '同行链式调用未正确插入 .use(i18n)'
  );
  // 原文件其他内容不受影响
  assert(content.includes('app.provide(LoginUserInstance, myLocalStorage.getItem(LoginUserKey));'), '原有代码被破坏');
  assert(logs.some((l) => l.includes('新增')), '应产生注入日志');
  return true;
});

// =====================================================================
// 2. 真实 Vue3 Mobile main.ts — qiankun 嵌套 createApp + 续行 .mount（模式 A）
// =====================================================================
test('真实 Vue3 Mobile: 嵌套注入继承 2 空格缩进 + .use(i18n) 取兄弟链 4 空格', () => {
  const dir = makeProject('real-mobile', fs.readFileSync(REAL_MOBILE, 'utf-8'));
  silent(() => updateMainTs(dir));
  const content = readMain(dir);

  assertInjectedBlock(content, '  ');
  assert(content.includes("import i18n, { $t } from './locales'"), '缺少 i18n import');
  assert(content.includes("import { setI18nInstance, getComponentMessages } from '@vnet/i18n'"), '缺少 @vnet/i18n import');

  // .use(i18n) 与兄弟链 .use(router)/.use(provideUser) 同为 4 空格
  assert(content.includes('\n    .use(i18n)\n'), '.use(i18n) 应为 4 空格');
  const chainLines = content.split('\n').filter((l) => /^\s*\.(use|mount)\(/.test(l));
  assert(
    chainLines.every((l) => l.match(/^\s*/)[0].length === 4),
    `链条所有行应为 4 空格: ${JSON.stringify(chainLines)}`
  );
  // 原文件其他内容不受影响（bootstrap/unmount 等）
  assert(content.includes('export const bootstrap = async () => {'), '原有代码被破坏');
  return true;
});

// =====================================================================
// 3. 幂等性 — 两个真实文件二次运行零改动
// =====================================================================
for (const [name, realFile] of [['Vue3 PC', REAL_PC], ['Vue3 Mobile', REAL_MOBILE]]) {
  test(`幂等性 ${name}: 二次运行不产生任何改动`, () => {
    const dir = makeProject(`idem-${name}`, fs.readFileSync(realFile, 'utf-8'));
    silent(() => updateMainTs(dir));
    const first = readMain(dir);
    const logs = silent(() => updateMainTs(dir));
    const second = readMain(dir);
    assert(first === second, '二次运行后文件内容发生变化');
    assert(
      !logs.some((l) => l.includes('新增')),
      `二次运行不应有"新增"操作: ${logs.join(' | ')}`
    );
    return true;
  });
}

// =====================================================================
// 4. 模式 A 变体：无兄弟续行（.mount 紧跟基行）→ 缩进 = 基行 + 2
// =====================================================================
test('模式 A 无兄弟: .use(i18n) 缩进 = 基行缩进 + 2', () => {
  const dir = makeProject('mode-a-no-sibling', `import { createApp } from 'vue'
import App from './App.vue'

const render = () => {
  app = createApp(App)

  app
    .mount('#app')
}
`);
  silent(() => updateMainTs(dir));
  const content = readMain(dir);
  assert(content.includes('\n    .use(i18n)\n'), '.use(i18n) 应为 4 空格（基行 2 + 2）');
  assert(content.includes("\n    .mount('#app')\n"), '.mount 行不应被改动');
  return true;
});

// =====================================================================
// 5. 模式 A 变体：const 声明 + 缩进续行（修复前顶格的场景）
// =====================================================================
test('模式 A const 嵌套: 注入块继承缩进', () => {
  const dir = makeProject('mode-a-const', `import { createApp } from 'vue'
import App from './App.vue'

const render = () => {
  const app = createApp(App)

  app
    .use(router)
    .mount('#app')
}
`);
  silent(() => updateMainTs(dir));
  const content = readMain(dir);
  assertInjectedBlock(content, '  ');
  assert(content.includes('\n    .use(i18n)\n'), '.use(i18n) 应为 4 空格');
  return true;
});

// =====================================================================
// 6. 模式 C：独立调用 app.mount('#app') → 插入独立 app.use(i18n) 行
// =====================================================================
test('模式 C 独立调用: 插入独立 app.use(i18n) 行', () => {
  const dir = makeProject('mode-c', `import { createApp } from "vue";
import App from "./App.vue";

const app = createApp(App);
app.mount("#app");
`);
  silent(() => updateMainTs(dir));
  const content = readMain(dir);
  assert(content.includes('\napp.use(i18n)\napp.mount("#app");'), '模式 C 未正确插入 app.use(i18n) 行');
  return true;
});

// =====================================================================
// 7. 第二注入路径：已有 globalTLine 但缺 @vnet/i18n 注册代码
// =====================================================================
test('已有 $t 注册缺 @vnet/i18n: 只补 @vnet 块并继承缩进', () => {
  const dir = makeProject('partial', `import { createApp } from 'vue'
import App from './App.vue'

const render = () => {
  app = createApp(App)

  app.config.globalProperties.$t = $t

  app
    .mount('#app')
}
`);
  const logs = silent(() => updateMainTs(dir));
  const content = readMain(dir);
  assert(content.includes('\n  // 将公共组件词条合并到当前 i18n 实例，并注册到 @vnet/i18n，\n'), '@vnet 注释行缩进错误');
  assert(content.includes('\n  const compMsgs = getComponentMessages()\n'), 'compMsgs 行缩进错误');
  assert(content.includes('\n  setI18nInstance(i18n)\n'), 'setI18nInstance 行缩进错误');
  // globalTLine 不重复
  assert(content.split('app.config.globalProperties.$t = $t').length === 2, 'globalTLine 不应重复注入');
  assert(logs.some((l) => l.includes('添加 @vnet/i18n 注册代码')), '应只走 @vnet 补全路径');
  return true;
});

// =====================================================================
// 8. 全部已存在 → 全跳过，零改动
// =====================================================================
test('全部已存在: 全跳过零改动', () => {
  const dir = makeProject('all-exists', `import { createApp } from 'vue'
import App from './App.vue'
import i18n, { $t } from './locales'
import { setI18nInstance, getComponentMessages } from '@vnet/i18n'

const app = createApp(App);

app.config.globalProperties.$t = $t
setI18nInstance(i18n)

app.use(i18n).mount('#app');
`);
  const before = readMain(dir);
  const logs = silent(() => updateMainTs(dir));
  const after = readMain(dir);
  assert(before === after, '全部已存在时不应改动文件');
  assert(!logs.some((l) => l.includes('新增')), `不应有新增操作: ${logs.join(' | ')}`);
  return true;
});

// =====================================================================
// 9. 告警分支：无 import 语句 → 告警但不崩溃、其余照常注入
// =====================================================================
test('无 import 语句: 告警但 $t 注册与 use(i18n) 照常注入', () => {
  const dir = makeProject('no-import', `const app = createApp(App);

app.mount('#app');
`);
  const logs = silent(() => updateMainTs(dir));
  const content = readMain(dir);
  assert(logs.some((l) => l.includes('未找到 import')), '应输出 import 告警');
  assert(content.includes('app.config.globalProperties.$t = $t'), '$t 注册应照常注入');
  assert(content.includes('app.use(i18n)'), 'app.use(i18n) 应照常注入');
  return true;
});

// =====================================================================
// 10. 告警分支：无 createApp → 告警；无 .mount → 告警
// =====================================================================
test('无 createApp 与 .mount: 仅告警不崩溃', () => {
  const dir = makeProject('no-anchor', `import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
`);
  // 有 createApp（同行）但正则要求 app = createApp 形式 → 走告警；.mount 同行在链中（模式 B 匹配 .mount( 前的 createApp(App) 以 ) 结尾）
  const logs = silent(() => updateMainTs(dir));
  assert(logs.some((l) => l.includes('警告')), `应输出告警: ${logs.join(' | ')}`);
  return true;
});

// =====================================================================
// 11. 模式 A 边界：链条中间有注释行
// =====================================================================
test('模式 A 链中注释: 跳过注释取兄弟链缩进', () => {
  const dir = makeProject('chain-comment', `import { createApp } from 'vue'
import App from './App.vue'

const render = () => {
  app = createApp(App)

  app
    .use(router)
    // 注释
    .mount('#app')
}
`);
  silent(() => updateMainTs(dir));
  const content = readMain(dir);
  assert(content.includes('\n    .use(i18n)\n'), '.use(i18n) 应为 4 空格');
  return true;
});

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
fs.rmSync(TEST_DIR, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);

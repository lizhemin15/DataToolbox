#!/usr/bin/env node
/**
 * 质量审核模块：DOM 引用完整性回归测试。
 *
 * 背景：这类 bug 已经咬过两次 ——
 *   1) quality-audit.js 用 getElementById('qaToggleExpand')，index.html 里却是 id="qaExpandAll"
 *      → 按钮点了没反应，没人发现；
 *   2) 删除按钮判断的 class 名（.qa-fill-row）和实际渲染的 class（.qa-fill-node）不一致
 *      → 删除功能静默失效。
 * 本测试静态检查：JS 里 getElementById 引用的 id，必须在 index.html（或 JS 动态拼的 HTML）里存在。
 *
 * 运行：node tests/js/qa_dom_ids.test.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'quality-audit.js'), 'utf8');

const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
// JS 动态生成的 markup 里出现的 id（例如 modal 内容）
for (const m of js.matchAll(/id=\\?["']([^"'\\]+)\\?["']/g)) ids.add(m[1]);

const used = new Map();
for (const m of js.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) {
  used.set(m[1], (used.get(m[1]) || 0) + 1);
}

let failed = 0;
const missing = [...used.keys()].filter(id => !ids.has(id));
if (missing.length) {
  failed++;
  console.error('✗ 以下 id 在 JS 里被 getElementById 引用，但 HTML 和 JS 动态 markup 里都不存在：');
  missing.forEach(id => console.error(`   - ${id}（被引用 ${used.get(id)} 次）→ 该控件永远不会生效`));
} else {
  console.log(`✓ quality-audit.js 引用的 ${used.size} 个 DOM id 全部存在`);
}

// class 名一致性：填充行的元素 class 必须在 JS 与 CSS 里都存在
const css = fs.readFileSync(path.join(root, 'css', 'style-models-quality.css'), 'utf8');
const badCls = [];
['qa-fill-node', 'qa-fill-cb', 'qa-fill-table-name', 'qa-fill-field-name', 'qa-fill-sql', 'qa-fill-rm'].forEach(c => {
  if (!js.includes(c) || !css.includes(c)) badCls.push(c);
});
if (badCls.length) {
  failed++;
  console.error('✗ 填报率行 class 在 JS/CSS 里不成对：' + badCls.join(', '));
} else {
  console.log('✓ 填报率行元素 class 在 JS 与 CSS 中一致');
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);

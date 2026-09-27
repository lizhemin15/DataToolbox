#!/usr/bin/env node
/**
 * 报告模板 content 的「存得下 → 读得回」往返回归测试。
 *
 * 背景（真实事故）：章节编号形态 section_number 只有采集侧认。
 *   - 采集侧 quality-audit.js 保存/预览时会把 editor 的值写进 content ✅
 *   - 回填侧 qa-shared.js 的 qaParseTplContent 白名单里没有这个键 ❌
 * 结果：用户把编号方式改成「1. 2.」，保存成功（服务端确实存了 arabic），
 * 一关一开弹窗就静默变回「一、二、三」，再保存就把 arabic 洗掉了。
 * 这类 bug 的共同形态是「字段名在一条路上有、另一条路上没有」，
 * 界面不报错、日志不报错，只能靠断言咬住，所以这里锁两层：
 *   ① 功能层：模板字段往返必须无损（新增字段忘了补解析器就会红）
 *   ② 契约层：采集侧 / 回填侧都必须出现该字段名（改名即红）
 *
 * 运行：node tests/js/qa_tpl_content_roundtrip.test.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
require(path.join(root, 'qa-shared.js'));
const editorSrc = fs.readFileSync(path.join(root, 'quality-audit.js'), 'utf8');
const P = globalThis.QA_SHARED && globalThis.QA_SHARED.qaParseTplContent;

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failed++;
    console.error(`✗ ${name}\n   实际: ${a}\n   期望: ${e}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

if (typeof P !== 'function') {
  console.error('✗ qa-shared.js 未导出 qaParseTplContent（编辑器回填全靠它，缺了会静默退化）');
  process.exit(1);
}

// ── ① 功能层：一份「全字段非默认值」的 content，解析后必须原样读回 ──────────
const full = {
  doc_title: '质量报告-往返用例',
  title: { font_family: 'SimHei, sans-serif', font_size: '26px', color: '#112233' },
  section: { font_family: 'KaiTi, serif', font_size: '18px', color: '#445566' },
  table: { border: '2px solid #778899', header_bg: '#ddeeff', row_alt: '#f0f1f2' },
  page_header: '页眉-往返',
  page_footer: '页脚-往返',
  section_number: 'arabic'
};
const back = P(JSON.stringify(full));
check('往返 doc_title', back.doc_title, full.doc_title);
check('往返 title', back.title, full.title);
check('往返 section', back.section, full.section);
check('往返 table', back.table, full.table);
check('往返 page_header', back.page_header, full.page_header);
check('往返 page_footer', back.page_footer, full.page_footer);
check('往返 section_number', back.section_number, 'arabic');

// ── ② section_number 的三种合法形态 + 容错 ────────────────────────────────
check('section_number=cn', P(JSON.stringify({ section_number: 'cn' })).section_number, 'cn');
check('section_number=none', P(JSON.stringify({ section_number: 'none' })).section_number, 'none');
check('section_number=arabic', P(JSON.stringify({ section_number: 'arabic' })).section_number, 'arabic');
check('section_number=脏值回落 cn', P(JSON.stringify({ section_number: 'x1' })).section_number, 'cn');
check('section_number=缺省回落 cn', P('{}').section_number, 'cn');
check('content 非法也不炸', P('not-json').section_number, 'cn');

// ── ③ 契约层：采集侧写、回填侧读，两边都得在 ──────────────────────────────
// 采集侧：collectQaTplContent 里 section_number 取自 qaTplSecNum 选择框
check('采集侧带 section_number', /section_number\s*:/.test(editorSrc), true);
// 回填侧：applyQaTplNormalized 里必须把它写回选择框
check('回填侧读 section_number', /c\.section_number/.test(editorSrc), true);
// 选择框锚点不能改名（改名会让上面两条静默落空）
check('选择框锚点 qaTplSecNum 存在', /getElementById\('qaTplSecNum'\)/.test(editorSrc), true);

if (failed) {
  console.error(`\n${failed} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');

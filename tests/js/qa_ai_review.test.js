#!/usr/bin/env node
/**
 * 质量审核：规则级「AI 复核原则」+ 定时任务「启用 AI 校核」回归测试。
 *
 * 需求（用户确认版）：
 *   1) 导入可多一列「AI复核原则」（可选）：填了 → 该规则不通过时交 AI 复核；留空 → 以 SQL 审核结果为最终结果，不跑 AI。
 *   2) 旧文件（只有 NM/XH/名称/SQL/类别/[参数]）必须照样导入成功。
 *   3) 定时任务规则树只保留「执行」一列；删掉「AI 校核原则」输入框，改为勾选项「启用 AI 校核」。
 *   4) 手动「一键审核」同样支持 AI 复核（默认勾选）。
 *   5) 报告：纯 SQL 规则保持原样；有 AI 复核的规则 SQL 结果 + AI 结论一起给，并标注「须人类专家最终校核」。
 *
 * 运行：node tests/js/qa_ai_review.test.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html');
const js = read('quality-audit.js');
const core = read('js/script-core.js');
const css = read('css/style-models-quality.css');
const goQuality = read('quality_audit.go');
const goSched = read('qa_schedule.go');

let failed = 0;
const ok = m => console.log('✓ ' + m);
const bad = m => { failed++; console.error('✗ ' + m); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

// ---------- 1) 解析层：老文件/新文件都能导入 ----------
require(path.join(root, 'qa-shared.js'));
const Q = globalThis.QA_SHARED || (global.window && global.window.QA_SHARED);
if (!Q || typeof Q.parseRuleRows !== 'function') {
  bad('qa-shared.js 未导出 parseRuleRows（规则导入统一入口）');
} else {
  ok('qa-shared.js 导出 parseRuleRows');

  // 老文件：只有 5 列（无参数、无 AI 列）
  const legacy5 = [
    ['NM', 'XH', '名称', 'SQL', '类别'],
    ['010100', '0101', '主键唯一性', 'SELECT 1', '完整性'],
  ];
  const r5 = Q.parseRuleRows(legacy5);
  check(r5.length === 1 && r5[0].ai_review_prompt === '',
    '只有 5 列的老文件可导入，AI 复核原则为空（不跑 AI）');

  // 老文件：6 列（含参数）
  const legacy6 = [
    ['010100', '0101', '主键唯一性', 'SELECT {{字段名}} FROM {{表名}}', '完整性', '{"表名":"T","字段名":"C"}'],
  ];
  const r6 = Q.parseRuleRows(legacy6);
  check(r6.length === 1 && r6[0].params.表名 === 'T' && r6[0].ai_review_prompt === '',
    '6 列老文件可导入：参数解析正常、AI 复核原则为空');

  // 新文件：7 列，最后一列是复核原则
  const new7 = [
    ['NM', 'XH', '名称', 'SQL', '类别', '参数', 'AI复核原则'],
    ['010100', '0101', '主键唯一性', 'SELECT 1', '完整性', '', '该表为归档表，重复属正常'],
    ['010200', '0102', '手机号格式', 'SELECT 2', '规范性', '', ''],
  ];
  const r7 = Q.parseRuleRows(new7);
  check(r7.length === 2 && r7[0].ai_review_prompt === '该表为归档表，重复属正常' && r7[1].ai_review_prompt === '',
    '7 列新文件：填了原则的规则带上原则，留空的为空');

  // 列顺序打乱（表头名识别）：AI 列在中间也应认出来，其余列不错位
  const shuffled = [
    ['NM', 'XH', '名称', 'SQL', '类别', 'AI复核原则', '参数'],
    ['010300', '0103', '取值域', 'SELECT 3', '规范性', '按业务口径允许空', '{"表名":"T2"}'],
  ];
  const rs = Q.parseRuleRows(shuffled);
  check(rs.length === 1 && rs[0].ai_review_prompt === '按业务口径允许空' && rs[0].category === '规范性' &&
    rs[0].params.表名 === 'T2',
    'AI 复核原则列位置不固定也能识别，其余列不错位');

  // 历史叫法「人工审核规则」也认
  const alias = [
    ['NM', 'XH', '名称', 'SQL', '类别', '人工审核规则'],
    ['010400', '0104', '别名列', 'SELECT 4', '规范性', '按历史叫法也认'],
  ];
  const ra = Q.parseRuleRows(alias);
  check(ra.length === 1 && ra[0].ai_review_prompt === '按历史叫法也认',
    '表头写「人工审核规则」同样识别为 AI 复核原则列');
}

// ---------- 2) 定时任务表单：单列 + 开关 ----------
check(!js.includes('qa-sched-cb-ai') && !html.includes('qa-sched-cb-ai'),
  '定时任务规则树已移除「AI 核验」复选框');
check(!/id="qaSchedAiPrompt"/.test(html) && !js.includes('qaSchedAiPrompt'),
  '已删除「AI 校核原则（可选）」输入框');
check(html.includes('id="qaSchedAiEnabled"') && js.includes("getElementById('qaSchedAiEnabled')"),
  '存在勾选项「启用 AI 校核」且已接线');
check(/qa-sched-tree-header[\s\S]{0,400}?<span>执行<\/span><span>规则名称<\/span>/.test(html),
  '规则树表头只剩「执行 / 规则名称」两列');
check(/grid-template-columns: 38px minmax\(0, 1fr\)/.test(css) && !/grid-template-columns: 38px 58px/.test(css),
  'CSS 里规则树网格已改为单复选框列（38px + 名称）');
check(js.includes('ai_check_enabled') && goSched.includes('"ai_check_enabled"'),
  '定时任务保存体与后端字段都带 ai_check_enabled');
check(js.includes('qaSchedAiEnabledOf'), '老任务（有 ai_check_nms）打开时自动视为启用，行为不倒退');

// ---------- 3) 手动执行也支持 AI 复核 ----------
check(html.includes('id="qaRunAiEnabled"') && js.includes("getElementById('qaRunAiEnabled')"),
  '手动「一键审核」旁有「启用 AI 校核」勾选且已接线');
check(/ai_check_enabled: aiOn/.test(js), '手动执行请求体带 ai_check_enabled');
check(goQuality.includes('AICheckEnabled *bool `json:"ai_check_enabled"`'),
  '后端 execute 接口接收 ai_check_enabled');

// ---------- 4) 规则级复核原则：表单 + 后端字段 ----------
check(html.includes('id="qaAiReviewPrompt"') && js.includes("getElementById('qaAiReviewPrompt')"),
  '规则编辑区有「AI 复核原则」输入框且已接线');
check(/ai_review_prompt/.test(js) && /ai_review_prompt/.test(read('qa-shared.js')),
  '前端保存/导入都带上 ai_review_prompt');
check(goQuality.includes("ai_review_prompt") && goSched.includes("ai_review_prompt"),
  '后端规则读写与 AI 复核目标都使用 ai_review_prompt');
check(goQuality.includes('migrateQualityAuditRuleAiReview') && goQuality.includes('migrateQualityAuditScheduleAiEnabled'),
  '老库迁移：rules.ai_review_prompt 与 qa_schedules.ai_check_enabled');
check(/SELECT NM, XH, NAME, COALESCE\(SQL,'\'\), CATEGORY, COALESCE\(PARAMS,'\'\), UPDATED_AT, COALESCE\(ai_review_prompt,''\)/.test(goQuality),
  '规则查询已带上 ai_review_prompt');

// ---------- 5) 报告：SQL 结果 + AI 结论 + 人类专家校核标注 ----------
check(goQuality.includes('AI 复核（仅供参考，须人类专家最终校核）'),
  '报告 AI 段标题确认为「AI 复核（仅供参考，须人类专家最终校核）」');
check(goQuality.includes('SQL 审核结果：') && goQuality.includes('※ 本条须由人类专家最终校核。'),
  '报告同时给出 SQL 审核结果与「须人类专家最终校核」标注');
check(goQuality.includes('ai_reviewed'), '报告汇总含 AI 复核条数 ai_reviewed');
check(/AI 复核（仅供参考，须人类专家最终校核）/.test(js) || js.includes('须人类专家最终校核'),
  '界面结果区同样标注「须人类专家最终校核」');
check(js.includes('qa-ai-need-human') && css.includes('.qa-ai-need-human'),
  '「须人类专家最终校核」样式在 JS/CSS 中成对');
check(js.includes('qa-ai-review-badge') && css.includes('.qa-ai-review-badge'),
  '规则树「AI 复核」标识样式在 JS/CSS 中成对');

// ---------- 6) 模板与导入提示 ----------
check(/var header = \['NM', 'XH', '名称', 'SQL', '类别', '参数', 'AI复核原则'\]/.test(js),
  '下载模板表头含第 7 列「AI复核原则」');
check(js.includes('AI复核原则') && html.includes('AI复核原则'),
  '导入提示与模板说明都提到 AI复核原则列');
check(html.includes('只有前 6 列的老文件同样可以导入'),
  '界面明确说明：只有前 6 列的老文件也能导入');
check(/第一行|表头/.test(js) && js.includes('parseRuleRows'),
  'Excel 导入走 parseRuleRows（保留表头以便按列名识别）');

// ---------- 7) 缓存版本已 bump（否则用户看到旧页面）----------
check(/qa-shared\.js\?v=[0-9.]+\.20260919/.test(core) && /quality-audit\.js\?v=[0-9.]+\.20260919/.test(core),
  'qa-shared.js / quality-audit.js 缓存版本已 bump');
check(/style-models-quality\.css\?v=20260919/.test(html), 'style-models-quality.css 缓存版本已 bump');

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);

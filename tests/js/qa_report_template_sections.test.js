#!/usr/bin/env node
/**
 * 报告模板「可视化编辑 + 选择性生成」前端装配回归测试。
 *
 * 背景：这两块能力横跨三层，任何一层改名就会静默失效（点了没反应、或退回旧行为）：
 *   ① index.html 的 DOM 锚点（章节编辑器容器、生成弹窗）
 *   ② quality-audit.js 的调用契约（/templates/normalize、selection、iframe 桥）
 *   ③ 后端 Go 路由与章节模型（/templates/normalize 必须在路由表里）
 * 另外顺带守一件事：index.html 里所有 data-ui-ico 图标名都必须在 js/ui-icons.js 里登记，
 * 否则水合失败会留下一个空占位（界面看起来"少了个图标"却不报错）。
 *
 * 运行：node tests/js/qa_report_template_sections.test.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'quality-audit.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style-models-quality.css'), 'utf8');
const core = fs.readFileSync(path.join(root, 'js', 'script-core.js'), 'utf8');
const goFile = fs.readFileSync(path.join(root, 'quality_audit.go'), 'utf8');
const renderGo = fs.readFileSync(path.join(root, 'qa_report_render.go'), 'utf8');
const icons = fs.readFileSync(path.join(root, 'js', 'ui-icons.js'), 'utf8');

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.error(`✗ ${name}${detail ? '\n   ' + detail : ''}`);
  }
}

/* ── ① DOM 锚点 ─────────────────────────────────────────────────────────── */
const htmlIds = [
  'qaTplSections',      // 章节编辑器容器
  'qaTplSecNum',        // 章节编号方式
  'qaTplPick',          // 模板选择
  'qaTplExportBtn',     // 导出 JSON
  'qaTplImportBtn',     // 导入 JSON
  'qaGenModal',         // 选择性生成弹窗
  'qaGenSections',      // 弹窗里的章节勾选
  'qaGenRulesGroup',    // 弹窗里的规则范围分组
  'qaGenRules',         // 弹窗里的规则勾选
  'qaGenRuleSearch',    // 规则搜索
  'qaGenRuleFailed',    // 仅不通过
  'qaGenSubmit',        // 生成 Word
  'qaGenPreview'        // 预览所选内容
];
htmlIds.forEach(function (id) {
  check(`index.html 存在 #${id}`, new RegExp('id="' + id + '"').test(html));
});

/* ── ② 前端调用契约 ───────────────────────────────────────────────────── */
check('走 /templates/normalize 拿规范模板（前端不再自带默认值）',
  /PREFIX \+ 'templates\/normalize'/.test(js), '后端补全章节/选项是预览＝导出的前提');
check('预览请求带 interactive 标记', /interactive:\s*true/.test(js));
check('预览请求带 scroll 位置（编辑时不跳回顶部）', /scroll:\s*scrollTop/.test(js));
check('预览 iframe 桥：点选章节回传 qa-pick', /qa-pick/.test(js));
check('预览 iframe 桥：双击标题回传 qa-title', /qa-title/.test(js));
check('章节支持拖拽排序（dragstart/drop）', /'dragstart'/.test(js) && /'drop'/.test(js));
check('章节支持启停（眼睛开关写 enabled）', /sec\.enabled = !sec\.enabled/.test(js));
check('章节标题可直接改并写回模型', /sec\.title = el\.value/.test(js));
check('生成报告带 selection 提交', /payload\.selection = sel/.test(js));
check('规则范围为空时拦截（避免出现"勾了章节却没规则"的空报告）',
  /至少要选一个报告章节/.test(js) && /一条规则都没选/.test(js));

// 「生成报告」按钮必须打开选择性生成弹窗，而不是退回"一键吐整本"
const reportHandler = js.match(/getElementById\('qaReport'\)[\s\S]{0,300}?\}\);/);
check('「生成报告」按钮改走选择性生成弹窗',
  !!reportHandler && /openQaGenModal\(\)/.test(reportHandler[0]),
  '旧的直接 POST /report 逻辑若残留，用户就绕过了选择这一步');
check('「生成报告」按钮不再直接下载整本报告',
  !!reportHandler && !/PREFIX \+ 'report'/.test(reportHandler[0]));

/* ── ③ 后端路由与章节模型 ──────────────────────────────────────────────── */
check('Go 路由注册了 templates/normalize', /path == "templates\/normalize"/.test(goFile));
check('报告接口接受选择性参数 selection', /parseQASelection\(body\["selection"\]\)/.test(goFile));
check('预览接口接受选择性参数 selection', (goFile.match(/parseQASelection\(body\["selection"\]\)/g) || []).length >= 2);
check('章节模型含五个章节键',
  ['overview', 'rules', 'item_fill', 'record_fill', 'ai_review'].every(function (k) {
    return new RegExp('"' + k + '"').test(renderGo);
  }));
check('渲染层把 docx 与预览都建立在同一份 IR 上',
  /func qaBuildReportBlocks/.test(renderGo) &&
  /func qaRenderDocxBlocks/.test(renderGo) &&
  /func qaRenderHTMLBlocks/.test(renderGo));
check('模板规范化会补全章节（老模板也能对齐预览与导出）',
  /func qaNormalizeTemplateContent/.test(renderGo));

/* ── ④ 样式与图标 ──────────────────────────────────────────────────────── */
['.qa-sec-card', '.qa-sec-row', '.qa-gen-item', '.qa-gen-rules'].forEach(function (sel) {
  check(`css 存在 ${sel}`, css.indexOf(sel) !== -1);
});

const shapesBlock = icons.slice(icons.indexOf('var SHAPES'), icons.indexOf('return') > 0 ? undefined : undefined);
const registered = {};
(shapesBlock.match(/\n\s+'?([A-Za-z][A-Za-z0-9_-]*)'?\s*:\s*'</g) || []).forEach(function (line) {
  var name = line.trim().replace(/\s+/g, '').split(':')[0].replace(/'/g, '');
  registered[name] = true;
});
check('图标库里登记了 grip（拖拽手柄）', !!registered.grip);
check('图标库里登记了 eyeOff（隐藏状态）', !!registered.eyeOff);

const used = {};
(html.match(/data-ui-ico="([^"]+)"/g) || []).forEach(function (m) {
  used[m.replace(/.*data-ui-ico="([^"]+)"/, '$1')] = true;
});
var missing = Object.keys(used).filter(function (n) { return !registered[n]; });
check('index.html 用到的图标名都在图标库里登记',
  missing.length === 0,
  missing.length ? '未登记：' + missing.join(', ') : '');

/* ── ⑤ 缓存版本（改过 JS/CSS 必须 bump，否则用户拿到旧文件）────────────── */
check('quality-audit.js 缓存版本已 bump 到 2026092803',
  /quality-audit\.js\?v=[0-9.]+\.2026092803/.test(core));
check('style-models-quality.css 缓存版本已 bump',
  /style-models-quality\.css\?v=20260919[0-9.]*\.2026092801/.test(html),
  '该文件被 qa_ai_review.test.js 钉住必须以 20260919 开头');
check('ui-icons.js 缓存版本已 bump（新增了 grip/eyeOff）',
  /ui-icons\.js\?v=2026092801/.test(html));

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);

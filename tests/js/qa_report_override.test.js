#!/usr/bin/env node
/**
 * 「多模板管理 + 任务级报告内容定制」装配回归测试。
 *
 * 这块能力横跨四层，任何一层改名都会静默失效（按钮点了没反应 / 配置存了不生效）：
 *   ① index.html 的 DOM 锚点（模板管理按钮组、任务弹窗的报告内容覆盖区）
 *   ② quality-audit.js 的契约（收/发 report_overrides、三态语义、复用后端目录）
 *   ③ 后端 Go：DB 列 + 迁移 + 路由 + 调度器把覆盖层交给渲染层
 *   ④ CSS class 成对（JS 生成的 markup 与样式表对不上 = 界面看起来"坏了"）
 *
 * 特别守两件容易被改回去的事：
 *   a) 「没勾自定义」必须显式发 {sections:[]} —— 否则用户取消勾选后旧覆盖永远
 *      清不掉，界面显示跟随模板、实际报告还是旧配置。
 *   b) 覆盖层必须叠加在「规范化之后的模板」上，不能叠在原始 content 上 ——
 *      原始 content 可能缺章节，叠上去会被静默丢弃。
 *
 * 运行：node tests/js/qa_report_override.test.js
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
const schedGo = fs.readFileSync(path.join(root, 'qa_schedule.go'), 'utf8');

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
  'qaTplNewBtn',            // 新建模板
  'qaTplCopyBtn',           // 复制当前模板
  'qaTplDelBtn',            // 删除当前模板
  'qaSchedReportCustom',    // 「自定义本任务的报告内容」总开关
  'qaSchedReportBox',       // 覆盖编辑区
  'qaSchedReportSections',  // 章节卡片容器
  'qaSchedReportReset',     // 全部改回跟随模板
  'qaSchedReportPreview',   // 预览效果
  'qaSchedReportHint',      // 「改了 N 个章节」提示
  'qaSchedReportFrame'      // 预览 iframe
];
htmlIds.forEach(function (id) {
  check(`index.html 存在 #${id}`, new RegExp('id="' + id + '"').test(html));
});

/* ── ② 前端契约 ─────────────────────────────────────────────────────────── */
check('模板管理按钮都接了事件（新建/复制/删除）',
  ['qaTplNewBtn', 'qaTplCopyBtn', 'qaTplDelBtn'].every(function (id) {
    return new RegExp("getElementById\\('" + id + "'\\)").test(js);
  }),
  '只加 DOM 不接线 = 按钮点了没反应');

check('新建模板自动生成 ID（用户不必手打 ID 才能加第二套模板）',
  /function qaTplSuggestId/.test(js) && /while \(used\[id\]\)/.test(js),
  'ID 冲突时会覆盖别人的模板');

check('删除模板走 DELETE /templates/{id}', /PREFIX \+ 'templates\/' \+ encodeURIComponent\(id\)/.test(js));

// 任务侧：覆盖层的收 / 发
check('保存任务时勾了自定义才收集覆盖层', /reportCustom\.checked/.test(js) && /body\.report_overrides = qaSchedCollectReportOverride\(\)/.test(js));
check('没勾自定义时显式发 {sections:[]}（否则旧覆盖清不掉）',
  /body\.report_overrides = \{ sections: \[\] \}/.test(js),
  '取消勾选后如果发 null/不发，后端保留旧覆盖 → 界面显示跟随模板、报告还是旧配置');

check('打开任务时从 report_overrides 恢复（编辑已配过的任务不丢配置）',
  /sch\.report_overrides/.test(js) && /qaSchedReportState\.overrides\[s\.key\] = s/.test(js));

// 三态语义：这是整个功能的正确性核心，逐条钉死
check('三态开关：只有 on/off 才写 enabled，跟随模板时留空',
  /entry\.enabled = true/.test(js) && /entry\.enabled = false/.test(js) &&
  /mode === 'on'/.test(js) && /else if \(mode === 'off'\)/.test(js) && /'inherit'/.test(js));
check('只有勾了「改标题」才写 title（否则覆盖不了"空标题"这种合法用法）',
  /titleOwn\.checked/.test(js) && /entry\.title = tv/.test(js));
check('只有勾了「改选项」才写 opts',
  /optsOwn\.checked/.test(js) && /entry\.opts = o/.test(js));
check('没动过的章节不进覆盖层（保证「模板升级自动传导」）',
  /entry\.enabled !== undefined \|\| Object\.prototype\.hasOwnProperty\.call\(entry, 'title'\) \|\| entry\.opts/.test(js),
  '把全量章节都写进任务 = 模板以后升级就传导不过来了');

check('选项控件复用后端章节目录（不在前端另抄一份选项表）',
  /qaSecOptControl\(\{ key: sec\.key, opts: eff \}, opt\)/.test(js),
  '前端自己抄一份选项表，后端加选项时任务侧就会缺控件');
check('任务弹窗拿不到目录时补上 catalog（否则「改选项」整块不出现）',
  /qaTplState\.catalog = d\.catalog/.test(js));
check('改模板下拉后重载章节（保留已有覆盖）',
  /qaSchedReportLoad\(tplSel\.value, true\)/.test(js));
check('卡片改动即时写回状态（改完没保存就切模板不丢配置）',
  /function qaSchedReportSyncFromDom/.test(js) && /box\.addEventListener\('input'/.test(js));
check('预览请求带 overrides（所见 = 定时任务真正出的）',
  /payload = \{ audit: QA_SAMPLE_AUDIT, interactive: true, overrides: ov \}/.test(js));

/* ── ③ 后端：DB 列 / 迁移 / 路由 / 调度器 ──────────────────────────────── */
check('qa_schedules 建表含 report_overrides 列', /report_overrides TEXT DEFAULT ''/.test(goFile));
check('老库有迁移补列（升级后行为与升级前一致）',
  /func migrateQualityAuditScheduleReportOverrides/.test(goFile) &&
  /migrateQualityAuditScheduleReportOverrides\(db\)/.test(goFile));
check('迁移函数真的被调用（定义了不调用 = 老库升级后一读列就报错）',
  /func migrateQualityAuditScheduleReportOverrides/.test(goFile) &&
  /^\s*migrateQualityAuditScheduleReportOverrides\(db\)$/m.test(goFile),
  '只有定义没有调用，说明没接上启动流程');

check('schedule 的 SELECT/INSERT/UPDATE 都带上了 report_overrides',
  (schedGo.match(/report_overrides/g) || []).length >= 4,
  '漏掉任一 SQL，覆盖层就会「存了读不出」或「改了存不下」');
check('schedule 结构体有 ReportOverrides 字段', /ReportOverrides\s+\*qaReportOverride/.test(schedGo));
check('调度器把任务覆盖层交给渲染层（走 qaBuildReportDocxSel）',
  /qaBuildReportDocxSel\(/.test(schedGo) && /qaScheduleReportSelection\(s\)/.test(schedGo),
  '仍调 qaBuildReportDocx（无选择参数）= 任务里配的报告内容永远不生效');

check('预览接口接受 overrides', /parseQAReportOverride\(body\["overrides"\]\)/.test(goFile));
check('单次生成接口接受 overrides',
  (goFile.match(/parseQAReportOverride\(body\["overrides"\]\)/g) || []).length >= 2);
check('覆盖层叠加在规范化之后的模板上（不能叠在原始 content 上）',
  /parseQATemplateContent\(qaNormalizeTemplateContent\(qaTemplateContentJSON\(styles\)\)\)[\s\S]{0,400}?parseQAReportOverride\(body\["overrides"\]\)/.test(goFile),
  '原始 content 可能缺章节，叠上去会被静默丢弃');

check('删除默认模板后会把剩余模板提为默认（默认不能落空）',
  /SELECT COUNT\(1\) FROM report_templates WHERE is_default=1/.test(goFile));

/* ── ④ 渲染层语义（函数存在 + 空覆盖是 noop）──────────────────────────── */
check('渲染层有覆盖层合并函数', /func qaApplyReportOverride/.test(renderGo));
check('空覆盖直接返回原列表（不改任何东西）',
  /func qaApplyReportOverride[\s\S]{0,200}?if ov == nil \{\s*return base/.test(renderGo));
check('单次运行的覆盖在任务覆盖之上再叠一层',
  /if sel != nil \{\s*secs = qaApplyReportOverride\(secs, sel\.Override\)/.test(renderGo));
check('选项覆盖逐字段生效（不是整段替换）', /func qaApplyOptOverride/.test(renderGo));

/* ── ⑤ CSS class 成对 ──────────────────────────────────────────────────── */
['.qa-tpl-mgr-row', '.qa-sec-name', '.qa-sec-mode', '.qa-sec-toggle', '.qa-sec-title-row',
 '.qa-rep-box', '.qa-rep-head', '.qa-rep-hint', '.qa-rep-frame'].forEach(function (sel) {
  check(`css 存在 ${sel}`, css.indexOf(sel) !== -1);
});
// JS 动态生成的章节卡片 class（这些必须 JS/CSS 成对）
['qa-sec-mode', 'qa-sec-toggle', 'qa-sec-title-row'].forEach(function (cls) {
  check(`JS 生成的 .${cls} 在 CSS 里有样式`, js.indexOf(cls) !== -1 && css.indexOf(cls) !== -1);
});
// 静态写在 index.html 里的覆盖区容器 class（JS 只按 id 取，不生成这些 class）
['qa-rep-box', 'qa-rep-head', 'qa-rep-hint', 'qa-rep-frame'].forEach(function (cls) {
  check(`index.html 的 .${cls} 在 CSS 里有样式`, html.indexOf(cls) !== -1 && css.indexOf(cls) !== -1);
});

/* ── ⑥ 缓存版本（改过 JS/CSS 必须 bump，否则用户拿到旧文件）────────────── */
check('quality-audit.js 缓存版本已 bump 到 2026092901',
  /quality-audit\.js\?v=[0-9.]+\.2026092901/.test(core));
check('style-models-quality.css 缓存版本已 bump 到 2026092901',
  /style-models-quality\.css\?v=20260919[0-9.]*\.2026092901/.test(html),
  '该文件被其它测试钉住必须以 20260919 开头');

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);

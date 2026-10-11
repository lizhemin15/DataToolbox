#!/usr/bin/env node
/**
 * SQL 工作台「默认分页」前端装配回归测试。
 *
 * 背景：分页能力横跨三层，任一层脱节都会**静默**退回旧行为 —— 后端分了页但前端没传
 * page/page_size（永远只看第 1 页），或者前端有分页条但后端不认（点下一页没反应）。
 * 这些都不会报错，只会让用户觉得「哪里不对」。所以在这里把三层的契约钉死：
 *   ① index.html 的 DOM 锚点（分页条 + 上一页/下一页/每页条数）
 *   ② js/script-api.js 的调用契约（请求带 page/page_size、翻页复用原 SQL、has_more 驱动）
 *   ③ Go 后端确实认这几个字段（有路由含义的字段名不能单方面改）
 *
 * 运行：node tests/js/sql_workbench_paging.test.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const api = fs.readFileSync(path.join(root, 'js', 'script-api.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style-core.css'), 'utf8');
const goFile = fs.readFileSync(path.join(root, 'handlers_table.go'), 'utf8');
const core = fs.readFileSync(path.join(root, 'js', 'script-core.js'), 'utf8');

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
  'sqlPager',     // 分页条容器
  'sqlPrevPage',  // 上一页
  'sqlNextPage',  // 下一页
  'sqlPageInfo',  // 页码文案
  'sqlPageSize',  // 每页条数下拉
];
htmlIds.forEach(function (id) {
  check(`index.html 存在 #${id}`, new RegExp(`id="${id}"`).test(html));
});

// 分页条默认必须藏着 —— 查询没跑之前露出来会显示一个空壳分页条
check('分页条默认隐藏（display:none）',
  /id="sqlPager"[^>]*style="[^"]*display:\s*none/.test(html),
  '否则进页面就看到一条空分页条');

/* ── ② 前端调用契约 ─────────────────────────────────────────────────────── */
check('请求体带上 page 与 page_size',
  /sql:\s*sql\s*,\s*page:\s*sqlPage\s*,\s*page_size:\s*sqlPageSize/.test(api),
  '不带这两项后端会按第 1 页返回，用户永远翻不到第二页');

check('每页条数默认 100（与后端默认一致）',
  /SQL_DEFAULT_PAGE_SIZE\s*=\s*100/.test(api),
  '前后端默认值不一致时首屏会出现「明明设了 100 却来了别的行数」');

// 这条是分页最容易踩的坑：翻页时若重新读编辑器内容，用户改了但没点执行，
// 得到的结果集和当前页就不是同一条语句 —— 页码和数据对不上。
check('翻页复用上一次的 SQL（不重读编辑器）',
  /opts\.followSQL/.test(api) && /sqlPageSQL/.test(api),
  '翻页必须沿用上一条已执行的 SQL，否则用户改编辑器后会串页');

check('「下一页」由 has_more 驱动',
  /sqlHasMore\s*=\s*data\.has_more/.test(api) && /next\.disabled\s*=\s*!sqlHasMore/.test(api),
  '后端没有 total，下一页按钮只能靠 has_more 判断');

check('每页条数变化时页码重置回第 1 页',
  /sqlPageSize\s*=\s*n[\s\S]{0,80}sqlPage\s*=\s*1/.test(api),
  '只在换每页条数时不回第 1 页会跳过中间数据');

check('关闭结果区时一起收起分页条',
  /function closeSqlResult\(\)[\s\S]{0,300}sqlPager[\s\S]{0,120}display\s*=\s*'none'/.test(api),
  '否则关掉结果后残留一条僵尸分页条');

check('分页条不显示「共 N 页」（后端没有精确总数）',
  !/共\s*'\s*\+\s*sqlTotalPages|共.*total_pages/.test(api),
  '后端为了不改写用户 SQL 没有算总数，编造页码数比不显示更糟');

/* ── ③ 后端契约 ─────────────────────────────────────────────────────────── */
check('后端解码 page / page_size',
  /Page\s+int\s+`json:"page"`/.test(goFile) && /PageSize\s+int\s+`json:"page_size"`/.test(goFile));

check('后端返回 has_more / has_prev / paged',
  /"has_more":\s*hasMore/.test(goFile) && /"has_prev":\s*page > 1/.test(goFile) && /"paged":\s*true/.test(goFile),
  '前端靠这三个字段驱动分页条');

check('后端默认每页 100 且设上限',
  /sqlWorkbenchDefaultPageSize\s*=\s*100/.test(goFile) && /sqlWorkbenchMaxPageSize\s*=\s*1000/.test(goFile));

check('后端查询走 ctx（可取消/超时）',
  /db\.QueryContext\(ctx/.test(goFile),
  '没有 ctx 的话慢查询会永远挂着，用户点了取消也没用');

check('后端不自动改写用户 SQL（不加 LIMIT）',
  !/sqlUpper\s*\+=\s*" LIMIT/.test(goFile) && !/req\.SQL\s*\+=\s*" LIMIT/.test(goFile),
  '自动拼 LIMIT 在 Oracle/达梦等方言上会直接报语法错，且改变语义');

/* ── ④ CSS ──────────────────────────────────────────────────────────────── */
check('css 存在 .sql-pager', /\.sql-pager\s*\{/.test(css));
check('禁用态按钮有可见样式', /\.sql-pager\s+\.btn\[disabled\]/.test(css));

/* ── ⑤ 缓存版本 ─────────────────────────────────────────────────────────── */
check('script-api.js 缓存版本已 bump', /script-api\.js\?v=2026101101/.test(html));
check('style-core.css 缓存版本已 bump（新增 .sql-pager）',
  /style-core\.css\?v=2026101101/.test(html) || /style-core\.css\?v=2026101101/.test(core));

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);

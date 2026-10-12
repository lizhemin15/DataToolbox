#!/usr/bin/env node
/**
 * 数据质量审核「结果按结构树顺序显示 + 超时重试」回归防线。
 *
 * 背景（用户原话）：
 *   ①「数据审核的显示顺序需要按照 XH 的顺序进行显示，即和结构树保持一致」
 *   ②「context deadline exceeded 应当要对该规则重试审核」
 *
 * 两个问题都属于「静默变质」型：不报错、不抛异常。
 *   ① 规则是最多 5 路并发跑的，谁先跑完谁先进结果 → 不排序时每次刷新顺序都不同，
 *      用户在结构树里找到的次序在结果表里对不上号；
 *   ② 超时被判成「规则失败」，界面红一片 context deadline exceeded —— 用户以为审核坏了。
 *
 * 所以这里把契约钉死，分三层：
 *   - 后端：结果在 qaExecuteRules 返回前排序；只对超时重试；父 ctx 结束不重试
 *   - 前端：renderAuditResult 再排一次（防抖），并把重试痕迹显示出来
 *   - 排序的「尺子」必须和结构树同源（结构树 = 库里 ORDER BY XH 的字符串序）
 *
 * 运行：node tests/js/qa_order_retry.test.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const goAudit = read('quality_audit.go');       // 后端：执行 + 排序 + 重试
const qaudit = read('quality-audit.js');        // 前端：审核结果页
const core = read('js/script-core.js');         // 惰性加载器（版本号在这里）
const css = read('css/style-models-quality.css');
const goTest = fs.existsSync(path.join(root, 'qa_order_retry_test.go'))
  ? read('qa_order_retry_test.go') : '';

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.error(`✗ ${name}${detail ? '\n   ' + detail : ''}`);
  }
}

/**
 * 取出某个 Go 函数的函数体（大括号配平），用于「只在这个函数里找」的断言。
 *
 * 注意：不能只数 { } —— Go 代码里到处是含花括号的字符串（SQL 模板、JSON 文案），
 * 数到字符串里的 } 会提前收工，函数体被截断一半，后面的断言就变成「假绿」。
 * 所以这里要跳过字符串字面量、rune、行注释、块注释。
 */
function goFunc(src, name) {
  const i = src.indexOf(`func ${name}(`);
  if (i < 0) return '';
  // 函数体起点的候选：签名里的 map[string]interface{}、泛型约束都带花括号，
  // 第一个 { 很可能在类型里（取到的「函数体」只有 2 个字符）。所以逐个候选试，
  // 取第一个能取出真实函数体的（用长度做判据）。
  let open = src.indexOf('{', i);
  while (open >= 0) {
    const body = braceBody(src, open);
    if (body.length > 50) return body;
    open = src.indexOf('{', open + 1);
  }
  return '';
}

/** 从 open 处的 { 开始配平，跳过字符串/注释，返回整段函数体。 */
function braceBody(src, open) {
  let depth = 0;
  let str = null;          // 当前所在的字符串字面量定界符
  let line = false;        // 是否在 // 注释里
  let block = false;       // 是否在 /* */ 注释里
  for (let j = open; j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; j++; } continue; }
    if (str) {
      if (c === '\\' && str !== '`') { j++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '/' && n === '/') { line = true; j++; continue; }
    if (c === '/' && n === '*') { block = true; j++; continue; }
    if (c === '"' || c === '`' || c === "'") { str = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(open, j + 1);
    }
  }
  return '';
}

/** 断言提取到的函数体是完整的：结尾必须是收口的 }（防「半截函数体」造成假绿）。 */
function checkBodyComplete(label, body, anchorTail) {
  check(`${label} 函数体提取完整`, body.length > 100 && /}$/.test(body.trim()) && body.indexOf(anchorTail) >= 0,
    `len=${body.length} 是否含尾部锚点「${anchorTail}」=${body.indexOf(anchorTail) >= 0}`);
}

// ---------------------------------------------------------------------------
// ① 后端：结果顺序 = 结构树顺序
// ---------------------------------------------------------------------------

const execRules = goFunc(goAudit, 'qaExecuteRules');
check('qaExecuteRules 存在（顺序就在它的返回点上钉）', execRules.length > 0);
checkBodyComplete('qaExecuteRules', execRules, 'onDone(result.nm, name)');

const sortCall = execRules.indexOf('qaSortResultRowsByXH(ruleResults)');
const sortReturn = execRules.indexOf('return ruleResults, passed, failed, nil');
check('qaExecuteRules 返回前调用 qaSortResultRowsByXH',
  sortCall >= 0,
  '调用不见了 = 并发完成次序会直接漏到界面（这就是用户看到的「顺序不对」）');
check('排序发生在 return 之前（不是排完又原样返回）',
  sortCall >= 0 && sortReturn >= 0 && sortCall < sortReturn,
  `sortAt=${sortCall} returnAt=${sortReturn}`);

const sortFn = goFunc(goAudit, 'qaSortResultRowsByXH');
checkBodyComplete('qaSortResultRowsByXH', sortFn, 'return rows');
check('qaSortResultRowsByXH 用 SliceStable（同 XH 不被并发抖动打乱）',
  /sort\.SliceStable\(/.test(sortFn));
check('排序按 xh 字段比较', /"xh"|\["xh"\]/.test(sortFn));
check('排序在同 XH 时兜底按 nm', /"nm"/.test(sortFn));
// 负向断言必须先确认「函数体真的取到了」，否则空字符串恒过 = 假绿
check('排序尺子是字符串序（与结构树 ORDER BY XH 同源）',
  sortFn.length > 0 && !/qaXHSegments|Atoi|strconv\./.test(sortFn),
  '一旦改成「按层切段转数字」的聪明排序，非补零 XH 上就会和结构树分叉');

// 结构树自身的次序来源：库里 ORDER BY XH —— 排序尺子必须跟它一致
check('结构树的元数据读取仍是 ORDER BY XH（两边的尺子要对齐）',
  /loadRulesFlat/.test(goAudit) && /ORDER BY XH/.test(goAudit));

// ---------------------------------------------------------------------------
// ② 后端：超时重试
// ---------------------------------------------------------------------------

const retryFn = goFunc(goAudit, 'executeRuleQueryRetry');
check('executeRuleQueryRetry 存在（超时重试的落点）', retryFn.length > 0);
checkBodyComplete('executeRuleQueryRetry', retryFn, 'case <-parent.Done():');
check('只对超时重试（非超时错误直接返回，不白等）',
  /!qaIsQueryTimeout\(err\)/.test(retryFn));
check('父 ctx 已结束就不再重试（用户点取消后不该继续打库）',
  /parent\.Err\(\) != nil/.test(retryFn));
check('重试阈值逐次放宽（qaRetryTimeout）', /qaRetryTimeout\(/.test(retryFn));
const escalateFn = goFunc(goAudit, 'qaRetryTimeout');
checkBodyComplete('qaRetryTimeout', escalateFn, 'return base * time.Duration(mult)');
check('超时阈值有上限（不会把单条规则拖成半小时）',
  /mult > 4|>= 4|base\*4/.test(escalateFn),
  '缺上限 = 重试次数一调大，单条规则能跑几十分钟');

// 规则执行处必须真的把 onRetry 接上，否则「重试可见」是假的
check('qaExecuteRules 调 executeRuleQueryRetry 时带上了 onRetry 回调',
  /executeRuleQueryRetry\(ctx, targetDB, execSQL, func\(attempt int, next time\.Duration\)/.test(execRules));
check('定时任务把重试进度打进进度对象（pr.setCurrent）',
  /pr\.setCurrent\(msg\)/.test(read('qa_schedule.go')));

// 结果里带重试痕迹，前端/报告才能解释「这条为什么慢」
check('结果行写入 retries / retry_note', /entry\["retries"\]/.test(goAudit) && /entry\["retry_note"\]/.test(goAudit));
check('错误文案里带上重试过程（用户不会问「为什么不重试」）',
  /qaRetryNote\(retried, false\)/.test(goAudit));

// 回归防线自身不能被悄悄删掉
check('Go 侧顺序/重试用例仍在（qa_order_retry_test.go）',
  /TestQAExecuteRulesReturnsResultsInStructureTreeOrder/.test(goTest) &&
  /TestExecuteRuleQueryRetryRetriesOnTimeout/.test(goTest) &&
  /TestExecuteRuleQueryRetryDoesNotRetryNonTimeoutErrors/.test(goTest));

// ---------------------------------------------------------------------------
// ③ 前端：结果排序（防抖）+ 重试痕迹可见
// ---------------------------------------------------------------------------

check('renderAuditResult 对 rules 先拷贝再排序（不改原数组）',
  /var ruleList = \(audit\.rules \|\| \[\]\)\.slice\(\)\.sort\(function \(a, b\) \{/.test(qaudit));
check('渲染用的是排过序的 ruleList', /var ruleRows = ruleList\.map\(function \(r\) \{/.test(qaudit));
check('前端也按 xh → nm 定序（与后端同一套次序）',
  /var xa = String\(a && a\.xh/.test(qaudit) && /var na = String\(a && a\.nm/.test(qaudit));
check('重试痕迹渲染进明细列（qa-retry-note）',
  /qa-retry-note/.test(qaudit) && /r\.retries > 0/.test(qaudit) && /r\.retry_note/.test(qaudit));
check('错误行不重复贴重试说明（后端已在 error 里说明过）',
  /detail\.indexOf\('已重试'\) === -1/.test(qaudit));
check('.qa-retry-note 有样式（否则是一串没格式的裸文字）',
  /\.qa-retry-note\s*\{/.test(css));
check('.qa-retry-note 不上彩色（重试是系统自救了，不是错误）',
  /\.qa-retry-note\s*\{[^}]*color:\s*#4a5568/.test(css));

// 真正跑一遍前端排序器：从源码里取出排序比较函数，用 Node 执行它。
// 这样测的是「上线的那段代码本身」，而不是这里重抄一份实现。
let cmp = null;
const cmpMatch = qaudit.match(/var ruleList = \(audit\.rules \|\| \[\]\)\.slice\(\)\.sort\(function \(a, b\) \{([\s\S]*?)\n\s*\}\);/);
if (cmpMatch) {
  try {
    cmp = new Function('a', 'b', cmpMatch[1]);
  } catch (e) {
    cmp = null;
  }
}
check('前端排序比较函数可被取出执行（防止断言变成纯字符串检查）', !!cmp);

if (cmp) {
  const rows = [
    { nm: '030200', xh: '0302' },
    { nm: '010000', xh: '01' },
    { nm: '020100', xh: '0201' },
    { nm: '010200', xh: '0102' },
    { nm: '020000', xh: '02' },
    { nm: '010100', xh: '0101' },
  ];
  const got = rows.slice().sort(cmp).map(r => r.xh).join(',');
  check('前端排序实跑结果 = 结构树顺序', got === '01,0101,0102,02,0201,0302', got);

  const dup = [{ nm: '020000', xh: '02' }, { nm: '010000', xh: '02' }];
  check('前端排序：同 XH 按 nm 定序（顺序不随并发抖动）',
    dup.slice().sort(cmp)[0].nm === '010000');

  const noXh = [{ nm: '020000', xh: '02' }, { nm: '010000' }];
  check('前端排序：缺 xh 的旧结果不炸、排在最前（与库里 NULL 序一致）',
    dup.slice().sort(cmp).length === 2 && noXh.slice().sort(cmp)[0].nm === '010000');
}

// ---------------------------------------------------------------------------
// ④ 缓存版本号：改了 js/css 不 bump = 用户浏览器还在跑旧代码
// ---------------------------------------------------------------------------

check('quality-audit.js 版本号 bump 到 2026101201', /quality-audit\.js\?v=[^'"]*2026101201/.test(core));
check('quality-audit.js 保留了钉死的旧前缀 2026092803', /quality-audit\.js\?v=[^'"]*2026092803/.test(core));
check('quality-audit.js 保留了上一轮前缀 2026101102', /quality-audit\.js\?v=[^'"]*2026101102/.test(core));
check('样式表版本号同步 bump（.qa-retry-note 才会生效）',
  /style-models-quality\.css\?v=[^"]*2026101201/.test(read('index.html')));

if (failed) {
  console.error(`\n${failed} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');

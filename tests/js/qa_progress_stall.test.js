#!/usr/bin/env node
/**
 * 数据质量审核「卡死可观测 + 可取消」前端装配回归测试。
 *
 * 背景（用户原话）：「容易卡死在某个地方一直运行，可能是在生成 word 阶段，
 * 但是以为还在运行最后一项」——这里有**两个**独立故障叠在一起：
 *   ① 后端进度模型在切阶段时没清 current，界面一直显示「正在执行：规则C」；
 *   ② 卡住和正常运行在界面上长得一模一样，用户除了干等没有别的动作。
 *
 * 这类故障不会抛异常、不会报错，只会让用户觉得「界面坏了」——所以必须把契约钉死：
 *   ① 后端 qa_progress.go：切阶段清 current、idle_ms/stale 真算、非 running 不 stale
 *   ② 前端 quality-audit.js：stale 上「疑似卡住」提示、取消按钮只在真能取消时出现
 *   ③ 前后端字段名与 URL 必须对得上（对不上 = 静默失效，按钮点了没反应）
 *
 * 运行：node tests/js/qa_progress_stall.test.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const prog = read('qa_progress.go');          // 后端进度模型
const qaudit = read('quality-audit.js');      // 前端质量审核页
const core = read('js/script-core.js');       // 惰性加载器（版本号在这里）
const css = read('css/style-models-quality.css');
const goAudit = read('quality_audit.go');     // API 路由

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.error(`✗ ${name}${detail ? '\n   ' + detail : ''}`);
  }
}

/** 取出某个 Go 函数的完整函数体（按大括号配平），用于「只在这个函数里找」的断言。 */
function goFunc(src, name) {
  const start = src.indexOf(`func (p *qaRunProgress) ${name}(`);
  const alt = start < 0 ? src.indexOf(`func ${name}(`) : start;
  const i = alt < 0 ? -1 : alt;
  if (i < 0) return '';
  const open = src.indexOf('{', i);
  if (open < 0) return '';
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, j + 1);
    }
  }
  return src.slice(open);
}

/* ── ① 后端：切阶段必须清 current（用户报的原始症状） ────────────────────── */
const setPhaseBody = goFunc(prog, 'setPhase');
check('setPhase 函数能定位到', setPhaseBody.length > 0);
check('切阶段时清空 Current（病根）',
  /p\.Current\s*=\s*""/.test(setPhaseBody),
  '不清的话界面会一直显示「正在执行：规则C」，用户就会以为还在跑最后一项规则（而他其实早就跑完了）—— 这正是用户报的现象');
check('切阶段时同时清空 CurrentSince（否则下一个 current_elapsed_ms 会继承上一项的起始时间）',
  /p\.CurrentSince\s*=\s*time\.Time\{\}/.test(setPhaseBody));

/* ── ② 后端：卡死必须可观测（idle_ms / stale） ───────────────────────────── */
check('snapshot 输出 idle_ms（距上次有进展多久）',
  /"idle_ms"\s*:/.test(prog));
check('snapshot 输出 stale（是否已判定卡住）',
  /"stale"\s*:/.test(prog));
check('snapshot 输出 stale_threshold_ms（让前端能解释阈值，而不是魔法数）',
  /"stale_threshold_ms"\s*:/.test(prog));
check('snapshot 输出 cancelable（前端据此决定是否渲染取消按钮）',
  /"cancelable"\s*:/.test(prog));
check('snapshot 输出 canceled（区分「已取消」与「执行失败」）',
  /"canceled"\s*:/.test(prog));
check('snapshot 输出 current_elapsed_ms（当前项已跑多久）',
  /"current_elapsed_ms"\s*:/.test(prog));

check('idle_ms 取自 Progress 的最后更新时间',
  /idleMS\s*:=\s*now\.Sub\(p\.UpdatedAt\)\.Milliseconds\(\)/.test(prog),
  'idle_ms 是「卡死可观测」的核心数字，旧版界面卡死与正常运行长得一模一样');
check('非 running 时 idle_ms 归零（已完成的任务不该被判卡住）',
  /if\s+p\.Status\s*!=\s*"running"\s*\{\s*\n?\s*idleMS\s*=\s*0/.test(prog));
check('stale 判定 = running 且 idle 超过阈值',
  /stale\s*:=\s*p\.Status\s*==\s*"running"\s*&&\s*idleMS\s*>=\s*qaStaleIdleMS\(\)/.test(prog));

check('无当前项时 current_elapsed_ms 返回 -1（未知）而不是 0',
  /currentElapsedMS\s*:=\s*int64\(-1\)/.test(prog),
  '返回 0 会被读成「这一项刚开始了 0 秒」（正常得很），而真实情况是「已经没有当前项了」');

/* ── ③ 后端：看门狗与超时口子 ───────────────────────────────────────────── */
check('存在整体运行超时（看门狗），防止任务永远挂着',
  /func qaRunTimeoutMS\(\)/.test(prog));
check('存在报告/生成 word 阶段超时',
  /func qaReportTimeoutMS\(\)/.test(prog),
  '用户怀疑卡死发生在「生成 word 阶段」，这一段必须有独立超时');
check('卡住判定阈值可用环境变量回退',
  /DT_QA_STALE_IDLE_MS/.test(prog));
check('完成态不再 stale（finished 由 status 推导）',
  /"finished"\s*:\s*p\.Status\s*!=\s*"running"/.test(prog));

/* ── ④ 前端：「疑似卡住」必须显式写出来 ─────────────────────────────────── */
check('进度卡在 stale 时加 is-stale 类（视觉上与正常运行区分）',
  /qa-progress-card'[^;]*pr\.stale\s*\?\s*'\s*is-stale'/.test(qaudit),
  '旧界面上卡死和正常运行时长得一模一样，用户只能干等');
check('stale 时渲染「疑似卡住」提示条', /疑似卡住/.test(qaudit));
check('提示条写出「已多久没有任何进展」（把数字摆出来，别让用户猜）',
  /没有任何进展/.test(qaudit) && /qaFmtProgressDuration\(pr\.idle_ms\)/.test(qaudit));
check('提示条指出卡在哪个阶段', /停在「/.test(qaudit));
check('未到阈值但已明显停滞时给温和提示（30s 无进展）',
  /Number\(pr\.idle_ms\)\s*>=\s*30000/.test(qaudit));

/* ── ⑤ 前端：取消按钮（用户唯一的自救手段） ─────────────────────────────── */
check('取消按钮只在 cancelable 时渲染',
  /running\s*&&\s*pr\.cancelable/.test(qaudit),
  '后端没接通 cancel 却渲染按钮 = 点了没反应的假按钮，正是用户最烦的');
check('取消按钮带 run_id（data 属性），点击时能定位到具体这次执行',
  /data-qa-cancel-run/.test(qaudit));
check('取消走 POST 到 runs/{id}/cancel',
  /runs\/'\s*\+\s*encodeURIComponent\(runID\)\s*\+\s*'\/cancel'/.test(qaudit) &&
  /method:\s*'POST'/.test(qaudit));
check('点击用 document 级事件委托（进度卡整块 innerHTML 重绘，绑在按钮上的 onclick 会丢）',
  /document\.addEventListener\('click'/.test(qaudit) && /closest\('\[data-qa-cancel-run\]'\)/.test(qaudit),
  '否则会出现「按钮偶尔点了没反应」—— 比起没按钮更让人恼火');
check('取消中按钮置灰并改文案「正在取消…」',
  /正在取消/.test(qaudit) && /btn\.disabled\s*=\s*true/.test(qaudit));
check('取消失败时恢复按钮可点（不能永远卡在「正在取消…」）',
  /btn\.disabled\s*=\s*false/.test(qaudit));
check('stale 且不可取消时告诉用户在等自动终止（不给出无法执行的建议）',
  /等待系统自动终止/.test(qaudit));

/* ── ⑤-2 取消后不能把用户当出错处理 ─────────────────────────────────────── */
check('已取消的执行在卡片上显示「已取消」而不是伪装成成功/失败',
  /pr\.canceled\s*\)\s*\{\s*\n?\s*etaText\s*=\s*'已取消'/.test(qaudit));
check('已取消的执行用独立类名 is-canceled（配色与真失败区分）',
  /pr\.canceled\s*\?\s*'\s*is-canceled'/.test(qaudit));
check('已取消的任务收尾不弹红色「执行失败」',
  /if\s*\(pr\.canceled\)\s*\{[\s\S]{0,160}?已取消/.test(qaudit) &&
  /if\s*\(pr\.canceled\)\s*\{[\s\S]{0,200}?执行失败/.test(qaudit) === false,
  '用户自己点的取消，回头却看到红色「执行失败」，会以为把系统搞坏了');
check('当前项显示「已跑多久」（用户报的正是「以为还在跑最后一项」）',
  /pr\.current_elapsed_ms\)\s*>=\s*0/.test(qaudit) && /已跑 /.test(qaudit));
// rules 阶段是 5 路并发、tick 在「完成时」触发，current 是最后完成的那条，
// current_elapsed_ms 是「距它完成多久」。自测实测：快规则 B 完成后 3.2s 界面仍写「已跑 3.2s」，
// 把「3.2 秒前就完成了」说成「正在跑 3.2 秒」——用户据此判断卡死位置会判错。故按阶段换措辞。
check('rules 阶段说「最后完成 X（X 前）」而不是「当前：X（已跑 X）」',
  /pr\.phase\s*===\s*'rules'/.test(qaudit) && /最后完成/.test(qaudit) && /前）/.test(qaudit),
  '并发阶段把「已完成」写成「正在跑」，是在界面上说假话');


/* ── ⑥ 前后端契约对齐（对不上 = 静默失效） ──────────────────────────────── */
['stale', 'idle_ms', 'cancelable', 'canceled', 'current_elapsed_ms', 'phase_label']
  .forEach(f => {
    const usedByFe = qaudit.indexOf('pr.' + f) >= 0 || qaudit.indexOf(f) >= 0;
    check(`前端用到的字段 ${f} 后端确实输出`, usedByFe && new RegExp(`"${f}"\\s*:`).test(prog));
  });

check('取消 URL 与后端路由对得上（runs/{id}/cancel）',
  /parts\[0\]\s*==\s*"runs"/.test(goAudit) && /parts\[2\]\s*==\s*"cancel"/.test(goAudit),
  '前端调 runs/{id}/cancel 而后端只认别的路径 = 404，按钮点了没反应');

/* ── ⑦ CSS：视觉上必须能一眼区分「卡住」与「正常运行」 ──────────────────── */
check('css 存在 .qa-progress-card.is-stale', /\.qa-progress-card\.is-stale\s*\{/.test(css));
check('css 存在 .qa-progress-stale 提示条', /\.qa-progress-stale\s*\{/.test(css));
check('css 存在 .qa-progress-idle 温和提示', /\.qa-progress-idle\s*\{/.test(css));
check('css 存在 .qa-progress-cancel 按钮', /\.qa-progress-cancel\s*\{/.test(css));
check('取消按钮有禁用态样式（置灰要看得出来）',
  /\.qa-progress-cancel:disabled\s*\{/.test(css));
check('样式为黑白灰、无渐变（符合项目 UI 约定）',
  !/\.qa-progress-(stale|cancel|idle)[^}]*linear-gradient/.test(css),
  '项目 UI 约定：黑白灰、无装饰性渐变');

/* ── ⑧ 缓存版本（改了 JS/CSS 不 bump，用户看到的还是旧界面） ────────────── */
check('quality-audit.js 缓存版本已 bump',
  /quality-audit\.js\?v=[^'"]*2026101101/.test(core),
  '不 bump 的话用户浏览器还在跑旧版，会以为「改了没用」');
check('quality-audit.js 版本号保留了既有钉死的前缀 2026092803',
  /quality-audit\.js\?v=[^'"]*2026092803/.test(core));
check('style-models-quality.css 缓存版本已 bump',
  /style-models-quality\.css\?v=2026\d{6}/.test(fs.readFileSync(path.join(root, 'index.html'), 'utf8') + core));

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);




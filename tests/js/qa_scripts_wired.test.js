#!/usr/bin/env node
/**
 * 前端脚本装配回归测试。
 *
 * 背景：quality-audit.js 里所有解析函数都依赖 window.QA_SHARED（qa-shared.js）。
 * 之前 ensureQualityAuditScriptLoaded() 只加载 quality-audit.js，qa-shared.js 从未被
 * 任何 <script> 或懒加载引用，导致 QA_SHARED 为 undefined，解析函数静默退化成空实现
 * —— 表现就是「导入模板提示：表中无有效数据」。
 *
 * 运行：node tests/js/qa_scripts_wired.test.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
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

// 1) ensureQualityAuditScriptLoaded 必须同时加载 qa-shared.js 和 quality-audit.js
const m = core.match(/async function ensureQualityAuditScriptLoaded\(\)\s*\{([\s\S]*?)\n\}/);
check('存在 ensureQualityAuditScriptLoaded', !!m);
const body = m ? m[1] : '';
const iShared = body.indexOf("qa-shared.js");
const iAudit = body.indexOf("quality-audit.js");
check('懒加载包含 qa-shared.js', iShared >= 0, 'QA_SHARED 未加载会让解析函数静默失效');
check('懒加载包含 quality-audit.js', iAudit >= 0);
check('qa-shared.js 先于 quality-audit.js 加载', iShared >= 0 && iAudit >= 0 && iShared < iAudit);

// 2) 被懒加载的文件必须真实存在（且与脚本里写的路径一致，根目录）
['qa-shared.js', 'quality-audit.js'].forEach(function (f) {
  check(`文件存在：${f}`, fs.existsSync(path.join(root, f)));
});

// 3) qa-shared.js 必须真的把 QA_SHARED 暴露到 window/globalThis
const sharedSrc = fs.readFileSync(path.join(root, 'qa-shared.js'), 'utf8');
check('qa-shared.js 导出 window.QA_SHARED', /window\.QA_SHARED\s*=/.test(sharedSrc));

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);

// gov-code-studio.js 的纯逻辑 + 接线回归测试（CI: tests/js/*.test.js 全量）
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..', '..');
const studio = require(path.join(root, 'js', 'gov-code-studio.js'));

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); console.log('✓ ' + name); pass++; }
    catch (e) { console.log('✗ ' + name + '\n   ' + e.message); fail++; }
}

// ---------- 代码提取 ----------
t('提取 ```javascript 代码块', () => {
    const r = studio.extractCodeFromReply('说明\n```javascript\nconst a = 1;\n```\n尾巴');
    assert.strictEqual(r.fenced, true);
    assert.ok(r.code.includes('const a = 1;'));
    assert.ok(!r.code.includes('说明'));
});

t('提取无语言标注的代码块', () => {
    const r = studio.extractCodeFromReply('```\ngov.log("hi");\n```');
    assert.strictEqual(r.fenced, true);
    assert.ok(r.code.includes('gov.log("hi")'));
});

t('多个代码块时优先 JS 且取最大', () => {
    const reply = '先说\n```json\n{"a":1}\n```\n然后\n```js\nline1\nline2\ngov.log(1);\n```';
    const r = studio.extractCodeFromReply(reply);
    assert.ok(r.code.includes('gov.log(1)'), '应选 js 块');
    assert.ok(!r.code.includes('"a":1'));
});

t('没有代码块时 fenced=false', () => {
    const r = studio.extractCodeFromReply('我建议你先这样改……');
    assert.strictEqual(r.fenced, false);
    assert.strictEqual(r.code, '');
});

t('空输入不炸', () => {
    assert.strictEqual(studio.extractCodeFromReply('').fenced, false);
    assert.strictEqual(studio.extractCodeFromReply(null).fenced, false);
});

// ---------- API 参考格式化 ----------
t('API 参考格式化成条目（带示例缩进）', () => {
    const out = studio.formatApiReference([
        { name: 'gov.log', desc: '输出日志', example: "gov.log('x');" },
        { signature: 'gov.showTable(data)', desc: '渲染表格' }
    ]);
    assert.ok(out.includes('- gov.log：输出日志'));
    assert.ok(out.includes("例: gov.log('x');"));
    assert.ok(out.includes('gov.showTable(data)'));
});

t('API 参考为空时给出兜底提示', () => {
    assert.ok(studio.formatApiReference([]).includes('未能读取到 API 参考'));
    assert.ok(studio.formatApiReference(null).includes('未能读取到 API 参考'));
});

// ---------- prompt 组装 ----------
t('prompt 包含 API 参考 / 当前代码 / 任务信息 / 本次请求', () => {
    const p = studio.buildPrompt({
        task: { name: '公文转Excel', description: '把公文整理成表', input_type: 'file', run_mode: 'frontend' },
        docs: [{ name: 'gov.writeExcel', desc: '导出 Excel' }],
        code: 'gov.log("old");',
        chat: [{ role: 'user', content: '上次说了什么' }, { role: 'assistant', content: '好的' }],
        userText: '把日志改成中文'
    });
    assert.ok(p.includes('gov.writeExcel'), '注入 API 参考');
    assert.ok(p.includes('公文转Excel'), '任务名');
    assert.ok(p.includes('把公文整理成表'), '任务描述');
    assert.ok(p.includes('gov.log("old")'), '当前代码');
    assert.ok(p.includes('上次说了什么'), '历史对话');
    assert.ok(p.includes('把日志改成中文'), '本次请求');
    assert.ok(p.includes('```javascript'), '要求输出代码块');
});

t('prompt 在 API 参考缺失时仍可生成', () => {
    const p = studio.buildPrompt({ task: {}, docs: [], code: '', chat: [], userText: '写个脚本' });
    assert.ok(p.includes('未能读取到 API 参考'));
    assert.ok(p.includes('// (空)'));
});

// ---------- 接线 ----------
t('index.html 里有「✨ AI 编辑」按钮且调用 GovCodeStudio.open', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(html.includes('id="govAiEditBtn"'), '按钮存在');
    assert.ok(html.includes('GovCodeStudio.open()'), '点击打开工作室');
    assert.ok(/gov-code-studio\.js/.test(html), '脚本已引入');
});

t('AI 编辑按钮紧邻 API 参考按钮（同一行标题栏）', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const i = html.indexOf('openGovApiHelp()');
    const j = html.indexOf('id="govAiEditBtn"');
    assert.ok(i > 0 && j > i, 'AI 编辑应排在 API 参考之后');
    assert.ok(j - i < 600, '两者应相邻（不跨区块）');
});

t('工作室自身 DOM 的 id 与代码引用一致', () => {
    const src = fs.readFileSync(path.join(root, 'js', 'gov-code-studio.js'), 'utf8');
    const declared = new Set();
    const re = /id="([^"]+)"/g; let m;
    while ((m = re.exec(src)) !== null) declared.add(m[1]);
    const used = new Set();
    const re2 = /el\.(gcs[A-Za-z0-9_]+)\s*=/g;
    while ((m = re2.exec(src)) !== null) used.add(m[1]);
    const listMatch = src.match(/\['gcsTaskName'[\s\S]*?\]\.forEach/);
    if (listMatch) {
        const ids = listMatch[0].match(/'([^']+)'/g) || [];
        ids.forEach(s => used.add(s.replace(/'/g, '')));
    }
    const missing = [...used].filter(id => !declared.has(id) && id !== 'gcsClearChat');
    assert.deepStrictEqual(missing, [], '代码里用了但未在 DOM 模板中声明的 id: ' + missing.join(','));
});

t('CSS 里有工作室图层（置顶用 z-index）', () => {
    const css = fs.readFileSync(path.join(root, 'css', 'style-governance.css'), 'utf8');
    assert.ok(/\.gcs-overlay\s*\{/.test(css), 'overlay 样式');
    const m = css.match(/\.gcs-overlay\s*\{[\s\S]*?z-index:\s*(\d+)/);
    assert.ok(m && Number(m[1]) >= 2000, '应置顶（z-index>=2000），实际 ' + (m && m[1]));
    assert.ok(/\.gcs-body\s*\{/.test(css), '三栏布局');
});

console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
process.exit(fail ? 1 : 0);

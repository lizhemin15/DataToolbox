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

// ---------- API 参考拍平（历史 bug：分区结构直接喂给 AI = 一条 API 都没有）----------
t('flattenApiDocs 把分区结构拍平成条目', () => {
    const sections = [
        { category: 'gov 对象', items: [{ name: 'gov.log', desc: '日志' }, { name: 'gov.readWord', desc: '读 Word' }] },
        { category: '其它', items: [{ name: 'gov.writeExcel' }] }
    ];
    const flat = studio.flattenApiDocs(sections);
    assert.strictEqual(flat.length, 3, '应拍平成 3 条');
    assert.ok(studio.formatApiReference(flat).includes('gov.readWord'), '拍平后能渲染出 API');
    assert.ok(!studio.formatApiReference(sections).includes('gov.readWord'), '未拍平时渲染不出来（这正是要修的 bug）');
});

t('flattenApiDocs 兼容直接给条目数组 / {items}/{sections}', () => {
    assert.strictEqual(studio.flattenApiDocs([{ name: 'gov.a' }]).length, 1);
    assert.strictEqual(studio.flattenApiDocs({ items: [{ name: 'gov.b' }] }).length, 1);
    assert.strictEqual(studio.flattenApiDocs({ sections: [{ items: [{ name: 'gov.c' }] }] }).length, 1);
    assert.deepStrictEqual(studio.flattenApiDocs(null), []);
});

t('真实 gov-shared.js 的 API 参考能被完整拍平（含 readWord/writeExcel/callAI）', () => {
    const raw = require(path.join(root, 'gov-shared.js'));
    const flat = studio.flattenApiDocs(globalThis.GOV_API_SECTIONS || globalThis.GOV_API_DOCS || []);
    assert.ok(flat.length >= 15, 'API 条目数应 >= 15，实际 ' + flat.length);
    const names = flat.map((x) => studio.apiMethodName(x));
    ['log', 'readWord', 'readExcel', 'writeExcel', 'parseWordStructure', 'callAI', 'querySQL', 'executeSQL'].forEach((n) => {
        assert.ok(names.indexOf(n) >= 0, '缺少 API: gov.' + n);
    });
});

// ---------- 产出自检 ----------
t('validateCode 能抓出不存在的 gov 方法', () => {
    const docs = [{ name: 'gov.log' }, { name: 'gov.readWord', signature: 'await gov.readWord(file)' }];
    const v = studio.validateCode("const f = gov.readFile();\nconst t = gov.readDocxText('a');\ngov.log(t);", docs);
    assert.deepStrictEqual(v.unknown.sort(), ['readDocxText', 'readFile']);
    assert.strictEqual(v.ok, false);
});

t('validateCode 通过合法代码，并提示漏 await', () => {
    const docs = [{ name: 'gov.log' }, { name: 'gov.readWord', signature: 'await gov.readWord(file)' }];
    const good = studio.validateCode('const r = await gov.readWord(INPUT_FILE);\ngov.log(r.value);', docs);
    assert.deepStrictEqual(good, { unknown: [], missingAwait: [], ok: true });
    const leak = studio.validateCode('const r = gov.readWord(INPUT_FILE);\ngov.log(r.value);', docs);
    assert.deepStrictEqual(leak.unknown, []);
    assert.deepStrictEqual(leak.missingAwait, ['readWord']);
});

t('prompt 告诉 AI 有哪些全局变量、别自己造 readFile', () => {
    const p = studio.buildPrompt({ task: {}, docs: [{ name: 'gov.log' }], code: '', chat: [], userText: 'x' });
    assert.ok(p.includes('INPUT_FILE'), '注入 INPUT_FILE');
    assert.ok(p.includes('INPUT_FILES'), '注入 INPUT_FILES');
    assert.ok(p.includes('mammoth'), '注入可用库');
    assert.ok(/不要杜撰/.test(p), '明确禁止杜撰方法');
});

t('prompt 带上样例文件名与样例正文节选', () => {
    const p = studio.buildPrompt({
        task: { name: 'T', example_files: [{ name: '区市县经济社会发展情况通报.docx' }] },
        docs: [{ name: 'gov.log' }], code: '', chat: [], userText: '抽表格',
        exampleText: '北京市概况\n一、人口情况\n常住人口 2185 万人'
    });
    assert.ok(p.includes('区市县经济社会发展情况通报.docx'), '样例文件名');
    assert.ok(p.includes('常住人口 2185 万人'), '样例正文节选');
});

t('prompt 支持把「自检驳回」原因带回去', () => {
    const p = studio.buildPrompt({ task: {}, docs: [], code: '', chat: [], userText: 'x', repairNotes: '用到了不存在的 gov 方法：gov.readFile' });
    assert.ok(/自动校验驳回/.test(p));
    assert.ok(p.includes('gov.readFile'));
});

t('exampleFileNames 兼容对象/字符串两种写法', () => {
    assert.deepStrictEqual(studio.exampleFileNames({ example_files: [{ name: 'a.docx' }, 'b.docx'] }), ['a.docx', 'b.docx']);
    assert.deepStrictEqual(studio.exampleFileNames({ exampleFiles: ['c.docx'] }), ['c.docx']);
    assert.deepStrictEqual(studio.exampleFileNames({}), []);
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

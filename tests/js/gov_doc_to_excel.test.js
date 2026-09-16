#!/usr/bin/env node
/**
 * 数据治理示例任务回归测试：公文 Word → 结构化 Excel（正则 / AI 两条路径）。
 *
 * - 正则脚本：直接用示例公文抽取，断言 8 个县级单位 + 8 列全部有值、层级归属正确；
 * - AI 脚本：mock gov.callAI 返回带 ```json 围栏的 JSON，断言解析/归一化/过滤逻辑。
 *
 * 不依赖任何第三方库（自己解析 docx 的 zip），CI 可直接跑。
 * 运行：node tests/js/gov_doc_to_excel.test.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..', '..');
const DOCX = path.join(root, 'apps', 'data-ontology', 'example_files', '区市县经济社会发展情况通报.docx');
const SCRIPT_REGEX = path.join(root, 'scripts', 'gov-doc-to-excel-regex.js');
const SCRIPT_AI = path.join(root, 'scripts', 'gov-doc-to-excel-ai.js');

let failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`✓ ${name}`); }
  else { failed++; console.error(`✗ ${name}${detail ? '\n   ' + detail : ''}`); }
}

/* ---------- 极简 docx 文本提取（zip central directory + inflate） ---------- */
function docxParagraphs(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('不是合法的 zip/docx');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (name === 'word/document.xml') {
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.slice(start, start + compSize);
      const xml = method === 0 ? data.toString('utf8') : zlib.inflateRawSync(data).toString('utf8');
      const out = [];
      const re = /<w:p[^>]*>([\s\S]*?)<\/w:p>/g;
      let m;
      while ((m = re.exec(xml)) !== null) {
        const ts = m[1].match(/<w:t[^>]*>[^<]*<\/w:t>/g) || [];
        const text = ts.map(t => t.replace(/<[^>]+>/g, '')).join('');
        if (text.trim()) out.push(text);
      }
      return out;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('未找到 word/document.xml');
}

function runScript(file, govApi) {
  const src = fs.readFileSync(file, 'utf8');
  const fn = new Function('gov', 'INPUT_FILE', '"use strict"; return (async () => {\n' + src + '\n})();');
  return fn(govApi, 'in.docx');
}

function makeGov(text, aiReply) {
  const captured = { excel: null, table: null, logs: [] };
  return {
    captured,
    api: {
      log: m => captured.logs.push(String(m)),
      readWord: async () => ({ value: text }),
      parseWordStructure: async () => ({ title: '', sections: [], sectionsFlat: [], tables: [], rawText: text }),
      callAI: async () => aiReply,
      showTable: d => { captured.table = d; },
      writeExcel: (name, data, opts) => { captured.excel = { name, data, opts }; }
    }
  };
}

(async () => {
  const paras = docxParagraphs(fs.readFileSync(DOCX));
  const text = paras.join('\n\n');
  check('示例公文可解析出段落', paras.length > 20, `段落数 ${paras.length}`);
  check('示例公文包含四级标题', paras.includes('一、江源省') && paras.includes('（一）云台市') && paras.includes('1. 城东区') && paras.includes('（1）平安县'));

  /* ---------- 1. 正则脚本 ---------- */
  const cols = ['所属省份', '所属市', '所属区', '所属县', '人口情况', '经济情况', '工业情况', '教育情况'];
  const g1 = makeGov(text, '');
  await runScript(SCRIPT_REGEX, g1.api);
  const t1 = g1.captured.excel;
  check('正则脚本产出 Excel', !!t1 && /\.xlsx$/.test(t1.name), t1 && t1.name);
  const data1 = t1 ? t1.data : [];
  check('正则脚本含表头且列顺序正确', JSON.stringify(data1[0]) === JSON.stringify(cols), JSON.stringify(data1[0]));
  check('正则脚本抽出 8 个县', data1.length === 9, `实际 ${data1.length - 1} 行`);

  const byCounty = {};
  data1.slice(1).forEach(r => { byCounty[r[3]] = r; });
  check('层级归属正确：平安县 → 江源省/云台市/城东区',
    !!byCounty['平安县'] && byCounty['平安县'][0] === '江源省' && byCounty['平安县'][1] === '云台市' && byCounty['平安县'][2] === '城东区',
    JSON.stringify(byCounty['平安县'] && byCounty['平安县'].slice(0, 4)));
  check('维度归类正确：平安县人口/经济/工业/教育四段都归位',
    !!byCounty['平安县'] &&
    /常住人口\s*28\.6\s*万人/.test(byCounty['平安县'][4]) &&
    /地区生产总值\s*156\.3\s*亿元/.test(byCounty['平安县'][5]) &&
    /规模以上工业企业\s*87\s*家/.test(byCounty['平安县'][6]) &&
    /各级各类学校\s*126\s*所/.test(byCounty['平安县'][7]),
    JSON.stringify(byCounty['平安县'] && byCounty['平安县'].slice(4)));
  const missing1 = data1.slice(1).filter(r => r.some((v, i) => i > 0 && !v));
  check('正则脚本无空缺维度', missing1.length === 0, JSON.stringify(missing1.slice(0, 2)));

  /* ---------- 2. AI 脚本 ---------- */
  const aiReply = [
    '好的，结果如下：',
    '```json',
    JSON.stringify([
      { 所属省份: '江源省', 所属市: '云台市', 所属区: '城东区', 所属县: '平安县', 人口情况: '常住人口 28.6 万人', 经济情况: '地区生产总值 156.3 亿元', 工业情况: '规上工业企业 87 家', 教育情况: '学校 126 所' },
      { 所属省份: '江源省', 所属市: '云台市', 所属区: '城东区', 所属县: '长乐县', 人口情况: '常住人口 21.3 万人', 经济情况: '地区生产总值 118.7 亿元', 工业情况: '规上工业企业 64 家' }
    ], null, 2),
    '```',
    '如需继续分析请告知。'
  ].join('\n');
  const g2 = makeGov(text, aiReply);
  await runScript(SCRIPT_AI, g2.api);
  const t2 = g2.captured.excel;
  check('AI 脚本产出 Excel', !!t2 && /\.xlsx$/.test(t2.name), t2 && t2.name);
  const data2 = t2 ? t2.data : [];
  check('AI 脚本能从 ```json 围栏中解析结果', data2.length === 3, `实际 ${data2.length - 1} 行`);
  check('AI 脚本列顺序与表头一致', JSON.stringify(data2[0]) === JSON.stringify(cols));
  const changle = data2.slice(1).find(r => r[3] === '长乐县');
  check('AI 脚本把缺失维度归一化为空串（8 列齐全）',
    !!changle && changle.length === 8 && changle[7] === '',
    JSON.stringify(changle));

  /* ---------- 3. 两个脚本输出列定义一致 ---------- */
  const srcR = fs.readFileSync(SCRIPT_REGEX, 'utf8');
  const srcA = fs.readFileSync(SCRIPT_AI, 'utf8');
  check('两个脚本的列定义一致', srcR.includes(JSON.stringify(cols).replace(/"/g, "'")) || (srcR.includes(`'所属省份', '所属市'`) && srcA.includes(`'所属省份', '所属市'`)));

  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });

#!/usr/bin/env node
/**
 * Round 2 前端回归：gov 详细 Word/Excel 格式 API（浏览器共享层）。
 *
 * 目标：不依赖浏览器，直接把浏览器真正加载的「手写版 gov-shared.js + lib/docx.iife.js」
 * 放进 Node vm 沙箱执行，验证：
 *   1) 富文本解析（加粗/斜体/下划线/字体/颜色/首行缩进）去标记与区间正确；
 *   2) govParseDocxTables 能从真实样例 docx 读出单元格、列宽与可复用样式；
 *   3) govCreateWordBuilder 能按模板样式生成带边框/底纹/合并单元格的 .docx；
 *   4) govApplyXlsxStyles 能写入字体/底纹/边框/列宽/合并/冻结/筛选与数字格式。
 *
 * 运行：node tests/js/gov_word_excel_format.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const root = path.join(__dirname, '..', '..');
const EXAMPLE_DOCX = path.join(root, 'apps', 'data-ontology', 'example_files', '2024年4月12日单位B日报.docx');

/* ---------- 加载浏览器版 XLSX / PizZip ----------
 * 直接用仓库里前端真正加载的 lib/*.js，放进 vm 沙箱取全局，
 * 不依赖 gov-runner-src/node_modules —— 否则 CI（未装 bun 依赖）会挂。
 */
function loadBrowserGlobal(relFile, name) {
  const sb = { console, TextEncoder, TextDecoder, Buffer, setTimeout, clearTimeout };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(root, relFile), 'utf8'), sb, { filename: relFile });
  if (!sb[name]) throw new Error('无法从 ' + relFile + ' 取得全局 ' + name);
  return sb[name];
}
const XLSX = loadBrowserGlobal(path.join('lib', 'xlsx.full.min.js'), 'XLSX');
const PizZip = loadBrowserGlobal(path.join('lib', 'pizzip.js'), 'PizZip');

let failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`✓ ${name}`); }
  else { failed++; console.error(`✗ ${name}${detail ? '\n   ' + detail : ''}`); }
}

/* ---------- 把浏览器共享层加载进沙箱 ---------- */
function loadBrowserSurface() {
  const sandbox = {
    console, TextEncoder, TextDecoder, Blob, Buffer,
    setTimeout, clearTimeout, URL, atob, btoa,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'lib', 'docx.iife.js'), 'utf8'), sandbox, { filename: 'docx.iife.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'gov-shared.js'), 'utf8'), sandbox, { filename: 'gov-shared.js' });
  return sandbox;
}

/* ---------- 极简 zip 读取（central directory + inflate） ---------- */
function readZipEntry(buf, target) {
  buf = Buffer.from(buf);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('不是合法的 zip');
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
    if (name === target) {
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.slice(start, start + compSize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('未找到 ' + target);
}

(async () => {
  const sb = loadBrowserSurface();

  check('gov-shared 暴露新函数（前端真正加载的手写版）',
    typeof sb.govParseRichLine === 'function' &&
    typeof sb.govCreateWordBuilder === 'function' &&
    typeof sb.govNormalizeDocxColor === 'function',
    Object.keys(sb.GOV_SHARED || {}).join(','));

  /* ---------- 1. 富文本解析 ---------- */
  const p = sb.govParseRichLine('**加粗**普通*斜体*__下划线__[c:red]红字');
  check('富文本去掉全部标记', p.text === '加粗普通斜体下划线红字', JSON.stringify(p.text));
  check('bold/italic/underline 区间齐全',
    p.bold.length > 0 && p.italic.length > 0 && p.underline.length > 0,
    JSON.stringify({ b: p.bold, i: p.italic, u: p.underline }));
  check('命名色/短十六进制归一化',
    sb.govNormalizeDocxColor('red') === 'FF0000' &&
    sb.govNormalizeDocxColor('#0f0') === '00FF00' &&
    sb.govNormalizeDocxColor('nope') === null);
  check('[c:red] 颜色区间为 FF0000', p.colors.some((c) => c[2] === 'FF0000'), JSON.stringify(p.colors));
  const hex = sb.govParseRichLine('前[c:#C00000]深红');
  check('[c:#RRGGBB] 十六进制颜色生效', hex.colors.some((c) => c[2] === 'C00000'), JSON.stringify(hex.colors));
  const indent = sb.govParseRichLine('>缩进段落');
  check('> 开头识别为首行缩进', indent.indent === true && indent.text === '缩进段落', JSON.stringify(indent));
  const fonted = sb.govParseRichLine('[f:黑体,s:18]标题字');
  check('[f:字体,s:字号] 区间正确',
    fonted.fonts.some((f) => f[2] === '黑体' && f[3] === 18), JSON.stringify(fonted.fonts));

  /* ---------- 2. 读 Word 表格（真实样例） ---------- */
  const docxBuf = fs.readFileSync(EXAMPLE_DOCX);
  const xml = readZipEntry(docxBuf, 'word/document.xml').toString('utf8');
  const tables = sb.govParseDocxTables(xml);
  check('govParseDocxTables 读到表格', Array.isArray(tables) && tables.length > 0, `tables=${tables && tables.length}`);
  const t0 = tables[0] || {};
  check('单元格文本为二维数组', Array.isArray(t0.rows) && Array.isArray(t0.rows[0]), JSON.stringify(t0.rows && t0.rows[0]));
  check('提取到列宽', Array.isArray(t0.colWidths) && t0.colWidths.length > 0, JSON.stringify(t0.colWidths));
  check('提取到可复用样式（字体/字号/表头加粗）',
    !!t0.style && (!!t0.style.fontName || !!t0.style.fontSize || !!t0.style.headBold),
    JSON.stringify(t0.style));

  /* ---------- 3. 按模板样式生成 Word ---------- */
  const captured = {};
  const builder = sb.govCreateWordBuilder(sb.docx, {
    pack: (doc) => sb.docx.Packer.toBuffer(doc),
    sink: (name, bytes) => { captured.name = name; captured.bytes = bytes; },
    log: () => {},
  });
  builder
    .heading('产品汇总', 1)
    .paragraph('按区展示产品', { font: { name: '仿宋_GB2312', size: 16 }, bold: true, align: 'center', firstLineIndent: 2 })
    .tableFromTemplate(t0.style, [['产品', '数量'], ['苹果', '10']])
    .table([['合计', '']], { colWidths: [20, 12], merges: ['0,0-0,1'], borders: { style: 'single', size: 4, color: '#999999' } });
  const outName = await builder.save('汇总');
  check('save 自动补 .docx 后缀', outName === '汇总.docx', String(outName));
  check('sink 收到字节', !!captured.bytes && captured.bytes.length > 0);
  const docXml = readZipEntry(captured.bytes, 'word/document.xml').toString('utf8');
  check('生成的 Word 含表格', docXml.includes('<w:tbl>'));
  check('生成的 Word 含表格边框', /<w:tblBorders/.test(docXml));
  check('模板表格样式被复用（内容 + 列宽）',
    docXml.includes('苹果') && /<w:gridCol w:w="2880"/.test(docXml));
  check('显式合并单元格生效', /<w:gridSpan w:val="2"/.test(docXml));
  check('生成标题段落（Heading1）', /w:val="Heading1"/.test(docXml));
  check('段落对齐 center 生效', /<w:jc w:val="center"/.test(docXml));

  /* ---------- 4. Excel 样式后处理 ---------- */
  // 复刻前端 writeExcel 的链路：XLSX 建表 → govApplyXlsxStyles 后处理
  const ws = XLSX.utils.aoa_to_sheet([['名称', '金额'], ['A', 1.5], ['B', 2.5]]);
  ws['!cols'] = [{ wch: 20 }, { wch: 12 }];
  ws['!merges'] = [XLSX.utils.decode_range('A1:B1')];
  ws['!autofilter'] = { ref: 'A1:B1' };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const base = Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));

  check('!cols/!merges/!autofilter 已写入基础表', true);
  const styled = sb.govApplyXlsxStyles(PizZip, base, {
    sheets: {
      Sheet1: {
        freeze: 'A2',
        cells: {
          'A1:B1': { fill: { fgColor: '#DDEBF7' }, bold: true, alignment: { horizontal: 'center' } },
          'A2': { font: { name: '微软雅黑', size: 12, bold: true, color: 'red' }, border: { style: 'thin' } },
          'B2:B3': { numFmt: '0.00' },
        },
      },
    },
  });
  const sheetXml = readZipEntry(styled, 'xl/worksheets/sheet1.xml').toString('utf8');
  const stylesXml = readZipEntry(styled, 'xl/styles.xml').toString('utf8');
  check('样式链路写出冻结窗格 <pane>', sheetXml.includes('<pane'), sheetXml.slice(0, 200));
  check('单元格写入样式索引 s="N"', /<c r="A2" s="\d+"/.test(sheetXml));
  check('表头底纹写入 fills', stylesXml.includes('DDEBF7'));
  check('字体红色写入 fonts', stylesXml.includes('FF0000'));
  check('边框写入 borders', /<border>\s*<left style="thin"/.test(stylesXml));
  check('数字格式写入 numFmt', stylesXml.includes('numFmt') && stylesXml.includes('0.00'));
  check('列宽 <cols> 保留', sheetXml.includes('<cols>'));
  check('合并 <mergeCell> 保留', sheetXml.includes('<mergeCell'));
  check('自动筛选 <autoFilter> 保留', sheetXml.includes('<autoFilter'));

  /* ---------- 5. 前端接线静态校验 ---------- */
  const ontology = fs.readFileSync(path.join(root, 'js', 'script-ontology.js'), 'utf8');
  check('懒加载列表包含 docx 库', ontology.includes('lib/docx.iife.js'));
  check('gov 对象挂载 readWordTables/word/buildWordTables',
    ontology.includes('async readWordTables(file)') &&
    /^\s*word\(\)\s*\{/m.test(ontology) &&
    ontology.includes('async buildWordTables(filename, opts)'));
  check('word() 走共享构建器并下载 Blob',
    ontology.includes('_govCreateWordBuilder(docxLib') && ontology.includes('Packer.toBlob'));
  check('writeExcel 在 styles/freeze 时调用 govApplyXlsxStyles',
    ontology.includes('shared.govApplyXlsxStyles(window.PizZip') && ontology.includes('opts.styles || opts.freeze'));
  check('富文本支持斜体/下划线/颜色',
    ontology.includes('<w:i/>') && ontology.includes('w:u w:val="single"') && ontology.includes('<w:color w:val='));

  const studio = fs.readFileSync(path.join(root, 'js', 'gov-code-studio.js'), 'utf8');
  check('AI 编辑器提示词提示 gov.word()/gov.readWordTables()',
    studio.includes('gov.word()') && studio.includes('gov.readWordTables()') && studio.includes('docx（生成 .docx）'));

  const rootShared = fs.readFileSync(path.join(root, 'gov-shared.js'), 'utf8');
  const appShared = fs.readFileSync(path.join(root, 'apps', 'data-ontology', 'gov-shared.js'), 'utf8');
  check('两份手写 gov-shared.js 保持一致', rootShared === appShared);
  check('GOV_API_SECTIONS 文档含新 API', ['gov.readWordTables', 'gov.word', 'gov.buildWordTables'].every((n) => rootShared.includes(`name: '${n}'`)));

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  check('index.html 已 bump script-ontology/gov-code-studio 版本',
    /script-ontology\.js\?v=2026091909/.test(html) && /gov-code-studio\.js\?v=2026091909/.test(html));

  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });

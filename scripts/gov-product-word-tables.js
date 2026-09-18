// ============================================================================
// 示例任务：产品汇总 Word 生成（按「区」套用表格模板）
//
// 输入（多文件）：
//   1) 「表格模板」Word —— 内含一张带边框/底纹/列宽的示例表格，只取它的样式；
//   2) 「纯文本产品介绍」Word —— 按「省 → 市 → 区」组织，每个区用自然语言介绍若干产品，
//      每个产品一行，形如：
//        产品名，规格 xxx，参考价 xxx，年产量 xxx。
//
// 处理：用 gov.readWordTables() 从模板 Word 里提取表格样式，
//       用 gov.readWord() 读取产品介绍正文，按标题切出省/市/区层级，
//       把每个产品转成一张套用模板样式的表格，最后输出一份汇总 Word。
//
// 关键 API：
//   gov.readWordTables(file) → [{ rows, colWidths, style }]
//   gov.word()               → 链式构建器（heading/paragraph/tableFromTemplate/save）
// ============================================================================

const COLUMNS = ['产品名称', '规格', '参考价', '年产量'];

// ---- 标题层级正则（与「公文Word转Excel」保持一致的编号习惯） ----
const RE_PROVINCE = /^[一二三四五六七八九十]+[、．.，,]\s*(.+?)\s*$/;   // 一、江源省
const RE_CITY = /^[（(][一二三四五六七八九十]+[）)]\s*(.+?)\s*$/;      // （一）云台市
const RE_DISTRICT = /^\d+[、．.，,]\s*(.+?)\s*$/;                     // 1. 城东区

function normalizeHeading(line) {
  return String(line)
    .replace(/[\s\u3000\u200b]+/g, '')
    .replace(/[（(]/g, '（')
    .replace(/[）)]/g, '）');
}

// 识别产品行并抽取字段：产品名，规格 xxx，参考价 xxx，年产量 xxx。
function parseProduct(line) {
  const m = String(line).match(/^(.+?)[，,]\s*规格\s*([^，,。；;]+)/);
  if (!m) return null;
  const pick = (re) => { const x = String(line).match(re); return x ? x[1].trim() : ''; };
  return {
    name: m[1].trim(),
    spec: m[2].trim(),
    price: pick(/(?:参考价|价格|单价)\s*([^，,。；;]+)/),
    output: pick(/(?:年产量|产量)\s*([^，,。；;]+)/),
  };
}

// ===== 主流程 =====

const F = (Array.isArray(INPUT_FILES) && INPUT_FILES.length)
  ? INPUT_FILES.slice()
  : (INPUT_FILE ? [INPUT_FILE] : []);

if (!F.length) {
  gov.log('请上传两个文件：1 个「表格模板」Word + 1 个「纯文本产品介绍」Word。');
  gov.log('支持格式：.docx（推荐）、.doc、.wps。');
} else {
  // ---- 1. 识别模板文件与数据文件 ----
  let templateFile = F.find((f) => /模板|template/i.test(f.name)) || null;
  let dataFiles = F.filter((f) => f !== templateFile);

  // 没按命名标出模板时：挑第一个含表格的文件当模板
  if (!templateFile && F.length >= 2) {
    for (const f of F) {
      try {
        const ts = await gov.readWordTables(f);
        if (ts && ts.length) { templateFile = f; dataFiles = F.filter((x) => x !== f); break; }
      } catch (e) { /* 忽略，继续尝试下一个 */ }
    }
  }
  // 只有一个文件：既当数据源，也尝试从它自身的表格取样式
  if (!templateFile && F.length === 1) { templateFile = F[0]; dataFiles = [F[0]]; }
  if (!dataFiles.length) dataFiles = F.slice();

  let templateStyle = null;
  let templateWidths = null;
  if (templateFile) {
    try {
      const tpls = await gov.readWordTables(templateFile);
      const withStyle = (tpls || []).find((t) => t && t.style);
      const picked = withStyle || (tpls || [])[0];
      if (picked) {
        templateStyle = picked.style || null;
        templateWidths = picked.colWidths || null;
      }
      gov.log(`表格模板：${templateFile.name}（读到 ${tpls ? tpls.length : 0} 张表` +
        (templateStyle ? '，已提取样式' : '，未提取到可复用样式') + '）');
    } catch (e) {
      gov.log(`⚠️ 读取模板失败（将用默认表格样式）：${e.message}`);
    }
  }
  if (!templateStyle) {
    gov.log('未取到模板样式，退化为默认表格样式（边框/表头加粗）。');
  }

  // ---- 2. 读取产品介绍正文 ----
  let text = '';
  for (const f of dataFiles) {
    const w = await gov.readWord(f);
    text += '\n' + ((w && w.value) ? w.value : '');
    gov.log(`产品介绍：${f.name}`);
  }
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);

  // ---- 3. 按「省-市-区」层级解析产品 ----
  let province = '', city = '', district = '';
  const products = [];
  for (const raw of lines) {
    const h = normalizeHeading(raw);
    let m;
    if ((m = h.match(RE_DISTRICT))) { district = m[1]; continue; }
    if ((m = h.match(RE_CITY))) { city = m[1]; district = ''; continue; }
    if ((m = h.match(RE_PROVINCE))) { province = m[1]; city = ''; district = ''; continue; }
    const prod = parseProduct(raw);
    if (prod && district) products.push(Object.assign({ province, city, district }, prod));
  }
  gov.log(`解析出产品 ${products.length} 个`);

  // 结构化预览
  gov.showTable(products.map((p) => ({
    所属市: p.city, 所属区: p.district, 产品名称: p.name,
    规格: p.spec, 参考价: p.price, 年产量: p.output,
  })));

  // ---- 4. 生成汇总 Word：每个产品一张模板样式表格 ----
  const doc = gov.word();
  doc.heading('产品汇总（按区套用表格模板）', 1);
  doc.paragraph(
    `按「省-市-区」整理，共 ${products.length} 个产品，每个产品一张表格；` +
    (templateStyle ? '表格样式来自模板 Word。' : '未能读取模板样式，使用默认样式。'),
    { font: { name: '仿宋_GB2312', size: 16 }, firstLineIndent: 2 }
  );

  let lastGroup = '';
  for (const p of products) {
    const group = [p.province, p.city, p.district].filter(Boolean).join(' / ');
    if (group && group !== lastGroup) {
      doc.heading(group, 2);
      lastGroup = group;
    }
    doc.paragraph(`产品：${p.name}`, {
      bold: true, firstLineIndent: 2, font: { name: '仿宋_GB2312', size: 16 },
    });
    const rows = [COLUMNS, [p.name, p.spec, p.price || '—', p.output || '—']];
    if (templateStyle) doc.tableFromTemplate(templateStyle, rows);
    else doc.table(rows, { borders: { style: 'single', size: 4, color: '000000' }, colWidths: templateWidths || undefined });
  }

  const outName = await doc.save('产品汇总(模板样式).docx');
  gov.log(`已生成 ${outName}，共 ${products.length} 张产品表格。`);
}

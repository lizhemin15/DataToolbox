// ============================================================================
// 示例任务：公文 Word → 结构化 Excel（AI 抽取）
//
// 与「正则抽取」示例用同一份公文、同一套输出列，区别是这里交给大模型理解正文，
// 适合表述灵活、层级编号不规整、同一维度分散在多个段落的文档。
//   输入：省 → 市 → 区 → 县 四级标题的公文（每个县下用文字描述人口/经济/工业/教育）
//   输出列：所属省份 / 所属市 / 所属区 / 所属县 / 人口情况 / 经济情况 / 工业情况 / 教育情况
// AI 使用「AI 助手」里配置的 URL / API Key / 模型（gov.callAI）。
// ============================================================================

const COLUMNS = ['所属省份', '所属市', '所属区', '所属县', '人口情况', '经济情况', '工业情况', '教育情况'];

const word = await gov.readWord(INPUT_FILE);
const text = (word && word.value ? word.value : '').trim();
gov.log('Word 正文字符数：' + text.length);
if (!text) {
  gov.log('未读到正文，请确认上传的是 .docx / .doc / .wps 文件。');
}

// 先拿到公文层级结构，作为「提示」丢给模型，能显著提高层级归属的准确率
let outline = '';
try {
  const parsed = await gov.parseWordStructure(INPUT_FILE);
  const flat = (parsed && parsed.sectionsFlat) ? parsed.sectionsFlat : [];
  if (flat.length) {
    outline = flat.map(n => new Array(n.level || 1).join('  ') + n.title).slice(0, 200).join('\n');
    gov.log('已解析出标题层级 ' + flat.length + ' 条，作为提示词上下文');
  }
} catch (e) {
  gov.log('层级解析跳过（不影响抽取）：' + e.message);
}

const prompt = [
  '你是公文结构化抽取助手。下面是一份「省—市—区—县」四级公文的正文，每个县下面用若干段文字描述了该县的人口、经济、工业、教育情况。',
  '请为每一个「县」级单位抽取一行数据，只输出一个 JSON 数组，不要输出任何解释、不要加 markdown 代码块。',
  '数组中每个对象的字段固定为：' + COLUMNS.join('、') + '。',
  '抽取要求：',
  '1) 所属省份 = 一级标题（如“一、江源省” → “江源省”）；所属市 = 二级标题（如“（一）云台市” → “云台市”）；所属区 = 三级标题（如“1. 城东区” → “城东区”）；所属县 = 四级标题（如“（1）平安县” → “平安县”）。去掉编号，保留名称原文。',
  '2) 人口情况 / 经济情况 / 工业情况 / 教育情况：分别填入该县下对应的那段话的原文，逐字保留，不要改写、不要总结、不要跨维度合并。',
  '3) 同一维度若散了多段，合并成一段用“；”连接；确实没有的留空字符串。',
  '4) 不要把“各市（区）、县：”这类抬头、导语当成县。',
  '',
  outline ? ('【标题层级】\n' + outline + '\n') : '',
  '【正文】',
  text.slice(0, 20000)
].join('\n');

gov.log('调用 AI 进行结构化抽取…');
const aiText = await gov.callAI(prompt);
gov.log('AI 返回 ' + (aiText ? String(aiText).length : 0) + ' 字符');

function extractJsonArray(s) {
  if (!s) return null;
  const text = String(s).replace(/```(?:json)?/gi, '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { return null; }
}

let rows = extractJsonArray(aiText);
if (!Array.isArray(rows)) {
  gov.log('AI 返回内容不是合法 JSON 数组，原文片段：');
  gov.log(String(aiText || '').slice(0, 300));
  rows = [];
}

// 统一成 8 列，并按「所属市/区/县」排序，输出更整齐
rows = rows.map(r => {
  const o = {};
  COLUMNS.forEach(c => { o[c] = (r && r[c] != null) ? String(r[c]).trim() : ''; });
  return o;
}).filter(r => r.所属县);

gov.log('AI 抽取到县级单位 ' + rows.length + ' 个');
rows.forEach((r, i) => {
  const miss = COLUMNS.filter(c => !r[c]);
  gov.log(`  [${i + 1}] ${r.所属市} / ${r.所属区} / ${r.所属县}` + (miss.length ? `（缺：${miss.join('、')}）` : ''));
});

const table = [COLUMNS].concat(rows.map(r => COLUMNS.map(c => r[c] || '')));
gov.showTable(rows);
gov.writeExcel('区市县情况-结构化(AI抽取).xlsx', table, { sheetName: '结构化结果' });
gov.log('已生成 Excel：区市县情况-结构化(AI抽取).xlsx');

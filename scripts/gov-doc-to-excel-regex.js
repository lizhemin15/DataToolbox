// ============================================================================
// 示例任务：公文 Word → 结构化 Excel（正则抽取，不依赖 AI）
//
// 适用文档：按「省 → 市 → 区 → 县」四级标题编写的公文，县一级下用若干段文字
// 分别介绍人口、经济、工业、教育情况。
//   一级标题：一、江源省
//   二级标题：（一）云台市
//   三级标题：1. 城东区
//   四级标题：（1）平安县
// 输出列：所属省份 / 所属市 / 所属区 / 所属县 / 人口情况 / 经济情况 / 工业情况 / 教育情况
//
// 纯正则实现：按标题切层级，再用关键词把段落归类到 4 个维度。不调用任何模型，
// 结果稳定可复现，适合格式规整、口径固定的公文。
// ============================================================================

const COLUMNS = ['所属省份', '所属市', '所属区', '所属县', '人口情况', '经济情况', '工业情况', '教育情况'];

const word = await gov.readWord(INPUT_FILE);
const text = (word && word.value ? word.value : '').trim();
gov.log('Word 正文字符数：' + text.length);
if (!text) {
  gov.log('未读到正文，请确认上传的是 .docx / .doc / .wps 文件。');
}

// 标题正则：识别四级编号（全角/半角括号、顿号/点号都兼容）
const RE_PROVINCE = /^[一二三四五六七八九十]+[、．.，,]\s*(.+?)\s*$/;      // 一、江源省
const RE_CITY = /^[（(][一二三四五六七八九十]+[）)]\s*(.+?)\s*$/;         // （一）云台市
const RE_DISTRICT = /^\d+[、．.，,]\s*(.+?)\s*$/;                        // 1. 城东区
const RE_COUNTY = /^[（(]\d+[）)]\s*(.+?)\s*$/;                          // （1）平安县

// 归一化：去掉空白、统一括号，便于匹配
function normalize(line) {
  return String(line)
    .replace(/[\s\u3000\u200b]+/g, '')
    .replace(/[（(]/g, '（')
    .replace(/[）)]/g, '）')
    .replace(/[、．.，,]+$/g, '');
}

// 维度识别：用关键词判断段落属于哪个维度（按优先级，避免互相串味）
const DIM_RULES = [
  ['教育情况', /教育|学校|在校学生|教师|义务教育|升学|教学点/],
  ['工业情况', /规模以上工业|规上工业|工业企业|工业增加值|制造业|工业总产值/],
  ['人口情况', /常住人口|户籍人口|人口|城镇化率/],
  ['经济情况', /地区生产总值|生产总值|GDP|一般公共预算收入|社会消费品零售|财政收入|第三产业|经济/]
];
function dimensionOf(line) {
  for (let i = 0; i < DIM_RULES.length; i++) {
    if (DIM_RULES[i][1].test(line)) return DIM_RULES[i][0];
  }
  return '';
}

const lines = text.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
gov.log('正文段落数：' + lines.length);

let province = '', city = '', district = '';
let current = null;
const rows = [];

function pushCurrent() {
  if (current) rows.push(current);
  current = null;
}

for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  const line = normalize(raw);
  if (!line) continue;

  let m;
  if ((m = line.match(RE_COUNTY))) {          // （1）平安县 —— 先判断，避免被三级标题误吃
    pushCurrent();
    province = province || '';
    current = {
      所属省份: province,
      所属市: city,
      所属区: district,
      所属县: m[1],
      人口情况: '',
      经济情况: '',
      工业情况: '',
      教育情况: ''
    };
    continue;
  }
  if ((m = line.match(RE_DISTRICT))) { district = m[1]; continue; }
  if ((m = line.match(RE_CITY))) { city = m[1]; district = ''; continue; }
  if ((m = line.match(RE_PROVINCE))) { province = m[1]; city = ''; district = ''; continue; }

  // 普通段落：按关键词归类到当前县的对应维度（每个维度只取第一段）
  if (current) {
    const col = dimensionOf(raw);
    if (col && !current[col]) current[col] = raw;
  }
}
pushCurrent();

gov.log('解析出县级单位 ' + rows.length + ' 个');

// 列顺序固定成 8 列
const table = [COLUMNS].concat(rows.map(r => COLUMNS.map(c => r[c] || '')));
rows.forEach((r, i) => {
  const miss = COLUMNS.filter(c => !r[c]);
  gov.log(`  [${i + 1}] ${r.所属市} / ${r.所属区} / ${r.所属县}` + (miss.length ? `（缺：${miss.join('、')}）` : ''));
});

gov.showTable(rows);
gov.writeExcel('区市县情况-结构化(正则抽取).xlsx', table, { sheetName: '结构化结果' });
gov.log('已生成 Excel：区市县情况-结构化(正则抽取).xlsx');

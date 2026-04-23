// 综合日报生成器：单次上传模板 + 多单位日报，INPUT_FILES 为全部文件
// 使用 gov.callAI 解析合并内容，gov.fillWordTemplate 按占位符生成 Word（须与 daily-report-template.docx 字段一致）

function parseDailyReportFilename(name) {
  const base = name.replace(/\.(docx?|DOCX?)$/i, '');
  const m = base.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(.+?)日报$/);
  if (!m) return { unitName: base.trim(), dateStr: '', dateDisplay: '' };
  const y = m[1];
  const mo = m[2].padStart(2, '0');
  const d = m[3].padStart(2, '0');
  return {
    unitName: m[4].trim(),
    dateStr: `${y}-${mo}-${d}`,
    dateDisplay: `${y}年${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日`,
  };
}

function pickTemplate(files) {
  const byName = files.find((f) => /模板|template|综合日报模板|日报模板/i.test(f.name));
  if (byName) return byName;
  return files[0];
}

function pickUnitFiles(files, template) {
  return files.filter((f) => f !== template);
}

function str(v) {
  if (v === undefined || v === null) return '';
  return String(v);
}

function governanceHint() {
  let hint = '';
  try {
    if (typeof gov.getDatabases === 'function') {
      const dbs = gov.getDatabases();
      if (dbs && dbs.length) {
        hint += '【数据治理环境】已配置数据库：' + dbs.map((d) => d.name || d.id).join('、') + '。\n';
      }
    }
    if (typeof gov.getDbType === 'function' && gov.getDbType()) {
      hint += '当前任务默认数据库类型：' + gov.getDbType() + '。\n';
    }
  } catch (_) {}
  return hint;
}

/** 将 AI 返回对象规范为模板所需结构，杜绝 undefined 写入 Word */
function normalizeTemplateData(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const unitsIn = Array.isArray(o.units) ? o.units : [];

  const units = unitsIn.map((u) => ({
    unit_name: str(u.unit_name),
    unit_report_date: str(u.unit_report_date || u.report_date),
    unit_summary: str(u.unit_summary),
    unit_risk: str(u.unit_risk),
    unit_overview: str(u.unit_overview),
    unit_key_projects: str(u.unit_key_projects),
    unit_risks: str(u.unit_risks),
    unit_tomorrow: str(u.unit_tomorrow),
  }));

  let risk_items = Array.isArray(o.risk_items) ? o.risk_items.map((x) => str(x)).filter(Boolean) : [];
  if (!risk_items.length && str(o.risks)) {
    risk_items = str(o.risks)
      .split(/[；;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  return {
    report_title: str(o.report_title),
    report_date: str(o.report_date),
    unit_count: String(units.length || o.unit_count || ''),
    overview: str(o.overview),
    key_projects: str(o.key_projects),
    risks: str(o.risks),
    risk_detail: str(o.risk_detail),
    risk_items,
    tomorrow_plan: str(o.tomorrow_plan),
    units,
  };
}

function extractJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  let s = text.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return s.slice(start, end + 1);
}

async function main() {
  const files = INPUT_FILES && INPUT_FILES.length ? INPUT_FILES : (INPUT_FILE ? [INPUT_FILE] : []);
  if (files.length < 2) {
    gov.log('请至少上传 2 个文件：1 个综合日报 Word 模板（.docx）+ 至少 1 份单位日报。');
    gov.log('建议模板文件名包含「模板」；单位日报文件名形如：2024年4月12日某某单位日报.docx');
    return;
  }

  const template = pickTemplate(files);
  const unitFiles = pickUnitFiles(files, template);
  if (unitFiles.length === 0) {
    gov.log('未识别到单位日报文件（除模板外的 .docx）。');
    return;
  }

  gov.log(`模板: ${template.name}；单位日报 ${unitFiles.length} 份`);

  const units = [];
  for (const f of unitFiles) {
    const meta = parseDailyReportFilename(f.name);
    let text = '';
    try {
      const r = await gov.readWord(f);
      text = (r && r.value) ? String(r.value) : '';
    } catch (e) {
      gov.log(`读取失败 ${f.name}: ${e.message || e}`);
      text = '';
    }
    units.push({
      unit_name: meta.unitName,
      report_date: meta.dateStr || meta.dateDisplay,
      raw_text: text.slice(0, 12000),
      source_file: f.name,
    });
  }

  const hint = governanceHint();
  const prompt = `你是政务/企业数据治理与综合日报编辑。请根据下列各单位日报原文，解析、归纳并合并为一份综合日报数据，仅输出一个 JSON 对象（不要用 markdown 代码块包裹）。
${hint}
输出 JSON 的键必须全部存在且值为字符串或数组（不要输出 undefined，不要省略键）。结构如下：
{
  "report_title": "综合日报标题，可含日期或主题",
  "report_date": "主报告日期，YYYY-MM-DD 或中文日期",
  "overview": "全局工作概述，整合各单位要点",
  "key_projects": "全局重点项目与进展摘要",
  "risks": "全局问题与风险综述（一段话）",
  "risk_detail": "对风险与问题的补充说明",
  "risk_items": ["分项风险或问题要点1", "要点2"],
  "tomorrow_plan": "全局明日计划与协调事项",
  "units": [
    {
      "unit_name": "单位名称",
      "unit_report_date": "该单位日报日期",
      "unit_summary": "一行当日重点摘要",
      "unit_risk": "该单位风险/待协调项摘要",
      "unit_overview": "该单位工作概述",
      "unit_key_projects": "该单位重点项目",
      "unit_risks": "该单位问题与风险",
      "unit_tomorrow": "该单位明日计划"
    }
  ]
}
规则：
1. 严格依据各单位原文与文件名中的单位名、日期，可归纳合并，禁止编造具体数字与事实。
2. units 数组顺序与输入单位顺序一致；条数与输入单位数一致。
3. 若某字段原文未涉及，填「无」或「暂无」，不要留空键。
4. risk_items 至少 0 条，宜从原文风险点拆分。

输入（JSON）：
${JSON.stringify({ template_hint: template.name, units })}`;

  let data;
  try {
    const aiText = await gov.callAI(prompt);
    const jsonStr = extractJsonObject(aiText);
    if (!jsonStr) throw new Error('未从模型输出中解析到 JSON');
    data = JSON.parse(jsonStr);
  } catch (e) {
    gov.log('AI 整理失败: ' + (e.message || e));
    return;
  }

  const filled = normalizeTemplateData(data);
  if (!filled.units.length) {
    gov.log('AI 返回的 units 为空，已中止');
    return;
  }
  if (!filled.report_title) {
    filled.report_title = '数据治理综合日报';
  }
  if (!filled.report_date) {
    filled.report_date = filled.units[0].unit_report_date || '';
  }

  const outName = '综合日报_' + (filled.report_date || '输出').replace(/[\\/:*?"<>|]/g, '-') + '.docx';
  await gov.fillWordTemplate(template, filled, outName);
  gov.log('完成：已按模板生成 ' + outName);
}

await main();

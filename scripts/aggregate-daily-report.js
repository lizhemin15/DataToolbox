// 综合日报生成器 v2：两阶段 LLM — 先逐单位解析、再汇总整合
// 使用 gov.parseWordStructure 保留公文结构，分块调用 LLM 避免上下文溢出

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

// 把 gov.parseWordStructure 的返回压缩成适合 LLM 输入的文本
function summarizeStructureForAI(parsed) {
  const parts = [];
  if (parsed.title) parts.push('【文档标题】' + parsed.title);
  if (Array.isArray(parsed.sections)) {
    for (const sec of parsed.sections) {
      const tag = sec.level > 0 ? `（${sec.level}级标题）` : '';
      parts.push(`【${sec.title || '无标题'}${tag}】`);
      if (Array.isArray(sec.paragraphs)) {
        for (const p of sec.paragraphs) {
          parts.push(p);
        }
      }
    }
  }
  if (Array.isArray(parsed.tables) && parsed.tables.length > 0) {
    for (let i = 0; i < parsed.tables.length; i++) {
      const t = parsed.tables[i];
      parts.push(`【表格${i + 1}】`);
      if (t.headers) parts.push('表头：' + t.headers.join(' | '));
      if (t.rows) {
        for (const row of t.rows) {
          parts.push(row.join(' | '));
        }
      }
    }
  }
  // 如果结构化数据太少，补 rawText
  if (parts.length < 5 && parsed.rawText) {
    parts.push('【原始文本补充】');
    parts.push(parsed.rawText.slice(0, 3000));
  }
  return parts.join('\n');
}

// 将阶段1的单位提取结果规范化
function normalizeUnitExtraction(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    unit_name: str(o.unit_name),
    unit_report_date: str(o.unit_report_date),
    unit_summary: str(o.unit_summary),
    unit_overview: str(o.unit_overview),
    unit_key_projects: str(o.unit_key_projects),
    unit_risks: str(o.unit_risks),
    unit_risk: str(o.unit_risk),
    unit_tomorrow: str(o.unit_tomorrow),
    metrics: Array.isArray(o.metrics) ? o.metrics.map((x) => str(x)) : [],
  };
}

// 将阶段2的汇总结果规范化
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

  gov.log('模板识别: ' + template.name);
  gov.log('单位日报 ' + unitFiles.length + ' 份，开始逐份解析...');

  // ====== 阶段 1：逐份解析 ======
  const unitExtractions = [];
  for (let i = 0; i < unitFiles.length; i++) {
    const f = unitFiles[i];
    const meta = parseDailyReportFilename(f.name);
    gov.log('解析第 ' + (i + 1) + '/' + unitFiles.length + ' 份: ' + f.name);

    let parsed;
    try {
      parsed = await gov.parseWordStructure(f);
    } catch (e) {
      gov.log('结构解析失败 ' + f.name + ': ' + (e.message || e));
      parsed = { title: '', sections: [], tables: [], rawText: '' };
    }

    const aiInput = summarizeStructureForAI(parsed);
    // 如果结构化太少且没有 rawText，回退到 readWord
    let aiText = aiInput;
    if (aiText.length < 50 && parsed.rawText) {
      aiText = parsed.rawText.slice(0, 8000);
    }

    const prompt1 = `你是政务数据治理助手。请从以下单位日报中提取关键信息，输出一个 JSON 对象（不要用 markdown 代码块包裹）。
输出 JSON 结构：
{
  "unit_name": "单位名称（从文件名或内容推断）",
  "unit_report_date": "报告日期",
  "unit_summary": "一行摘要：今日核心工作要点",
  "unit_overview": "工作进展概述（几句话）",
  "unit_key_projects": "重点项目与进展",
  "unit_risks": "存在的问题与风险",
  "unit_risk": "待协调或需关注的总体风险一句话",
  "unit_tomorrow": "明日计划",
  "metrics": ["关键指标或数据点1", "指标2"]
}
规则：字段缺失填"暂无"，metrics 为数组。

单位日报内容：
文件名：${f.name}
-----
${aiText}`;

    let extraction;
    try {
      const aiResult = await gov.callAI(prompt1);
      const jsonStr = extractJsonObject(aiResult);
      if (!jsonStr) throw new Error('阶段1: 未从模型输出解析到 JSON, unit=' + meta.unitName);
      const raw = JSON.parse(jsonStr);
      extraction = normalizeUnitExtraction(raw);
    } catch (e) {
      gov.log('阶段1提取失败 ' + f.name + ': ' + (e.message || e) + '，使用文件名兜底');
      extraction = normalizeUnitExtraction({
        unit_name: meta.unitName,
        unit_report_date: meta.dateStr || meta.dateDisplay,
      });
    }
    unitExtractions.push(extraction);
  }

  gov.log('阶段1完成: 已提取 ' + unitExtractions.length + ' 份单位日报摘要');

  // ====== 阶段 2：汇总整合 ======
  const unitsContext = unitExtractions.map((u, i) => ({
    序号: i + 1,
    ...u,
  }));

  const prompt2 = `你是政务/企业数据治理与综合日报编辑。请根据以下各单位日报摘要，归纳合并为一份综合日报数据，仅输出一个 JSON 对象（不要用 markdown 代码块包裹）。

输出 JSON 结构（所有键必须存在，值缺省填"暂无"）：
{
  "report_title": "综合日报标题（可含日期）",
  "report_date": "主报告日期（YYYY-MM-DD 或中文日期）",
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
1. units 顺序必须与输入顺序一致，条数与输入单位数一致（${unitExtractions.length} 个）。
2. 严格依据各单位摘要，可归纳合并但禁止编造具体数字与事实。
3. 若某字段原文未涉及，填"暂无"。
4. risk_items 至少 0 条，宜从各单位风险中拆分整合。

各单位摘要输入：
${JSON.stringify(unitsContext, null, 2)}`;

  let data;
  try {
    const aiText2 = await gov.callAI(prompt2);
    const jsonStr2 = extractJsonObject(aiText2);
    if (!jsonStr2) throw new Error('阶段2: 未从模型输出解析到 JSON');
    data = JSON.parse(jsonStr2);
  } catch (e) {
    gov.log('阶段2整合失败: ' + (e.message || e));
    return;
  }

  gov.log('阶段2完成: AI 汇总成功');

  const filled = normalizeTemplateData(data);
  if (!filled.units.length) {
    gov.log('AI 返回的 units 为空，已中止');
    return;
  }
  if (!filled.report_title) {
    filled.report_title = '数据治理综合日报';
  }
  if (!filled.report_date && filled.units[0]) {
    filled.report_date = filled.units[0].unit_report_date || '';
  }

  gov.log('开始生成 Word 文档...');
  const outName = '综合日报_' + (filled.report_date || '输出').replace(/[/\\:*?"<>|]/g, '-') + '.docx';
  await gov.fillWordTemplate(template, filled, outName);
  gov.log('完成：已按模板生成 ' + outName);
}

await main();
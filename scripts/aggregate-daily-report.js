// 综合日报生成器 v4：按标题层级细分合并（parse 模式）
// 核心改造：解析到最深层级，按最小节点聚合各单位内容

const CONFIG = {
  mode: "parse", // "parse" 或 "ai"，默认 "parse"
  fileClassification: {
    template: { pattern: /模板|template|综合日报模板|日报模板/i },
    dataFiles: { pattern: /^(\d{4})年(\d{1,2})月(\d{1,2})日(.+?)日报$/ }
  },
  extraction: {
    fields: ["unit_name", "unit_report_date", "unit_summary", "unit_overview", "unit_key_projects", "unit_risks", "unit_risk", "unit_tomorrow", "metrics"],
    promptTemplate: `你是政务数据治理助手。请从以下单位日报中提取关键信息,输出一个 JSON 对象（不要用 markdown 代码块包裹）。
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
文件名：{filename}
-----
{content}`
  },
  aggregation: {
    fields: ["report_title", "report_date", "overview", "key_projects", "risks", "risk_detail", "risk_items", "tomorrow_plan", "units"],
    promptTemplate: `你是政务/企业数据治理与综合日报编辑。请根据以下各单位日报摘要，归纳合并为一份综合日报数据，仅输出一个 JSON 对象（不要用 markdown 代码块包裹）。

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
1. units 顺序必须与输入顺序一致，条数与输入单位数一致（{unitCount} 个）。
2. 严格依据各单位摘要，可归纳合并但禁止编造具体数字与事实。
3. 若某字段原文未涉及，填"暂无"。
4. risk_items 至少 0 条，宜从各单位风险中拆分整合。

各单位摘要输入：
{unitsJson}`
  },
  output: {
    namingPattern: "综合日报_{report_date}.docx",
    defaultTitle: "数据治理综合日报"
  }
};

function parseFilenameWithPattern(name, pattern) {
  const base = name.replace(/\.(docx?|DOCX?)$/i, '');
  const m = base.match(pattern);
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

function classifyFiles(files, rules) {
  const template = files.find((f) => rules.template.pattern.test(f.name)) || files[0];
  const dataFiles = files.filter((f) => f !== template);
  return { template, dataFiles };
}

function str(v) {
  if (v === undefined || v === null) return '';
  return String(v);
}

// 从解析结果提取特定字段（parse 模式专用）
function extractFieldFromParsed(parsed, keywords) {
  const result = [];
  if (Array.isArray(parsed.sections)) {
    for (const sec of parsed.sections) {
      const titleLower = (sec.title || "").toLowerCase();
      for (const kw of keywords) {
        if (titleLower.includes(kw)) {
          if (Array.isArray(sec.paragraphs)) {
            result.push(...sec.paragraphs.filter(p => p && p.trim()));
          }
        }
      }
    }
  }
  return result.join("；");
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
function normalizeUnitExtraction(raw, fields) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const result = {};
  for (const f of fields) {
    if (f === 'metrics') {
      result[f] = Array.isArray(o[f]) ? o[f].map((x) => str(x)) : [];
    } else {
      result[f] = str(o[f]);
    }
  }
  return result;
}

// 将阶段2的汇总结果规范化
function normalizeTemplateData(raw, fields) {
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

  const result = {
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
  return result;
}

// ========== 新增：按标题层级细分合并的核心函数 ==========

/**
 * 找到所有最深层级节点（叶子节点）
 * 规则：扁平数组中，一个 section 是叶子节点，当且仅当它后面没有更深层级的 section（直到遇到同级或更高级标题）
 */
function findLeafSections(sections) {
  const leaves = [];

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const currentLevel = Math.max(1, Number(sec.level || 1));

    let hasDeeperChild = false;
    for (let j = i + 1; j < sections.length; j++) {
      const nextLevel = Math.max(1, Number(sections[j].level || 1));
      if (nextLevel <= currentLevel) {
        break;
      }
      if (nextLevel > currentLevel) {
        hasDeeperChild = true;
        break;
      }
    }

    if (!hasDeeperChild) {
      leaves.push({
        index: i,
        section: sec
      });
    }
  }

  return leaves;
}

/**
 * 为每个 section 构建完整标题路径
 */
function buildSectionPaths(sections) {
  const paths = [];
  const currentPath = [];

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i] || {};
    const level = Math.max(1, Number(sec.level || 1));
    currentPath[level - 1] = sec.title || '无标题';
    currentPath.length = level;
    paths[i] = currentPath.slice();
  }

  return paths;
}

/**
 * 提取节点的所有段落内容
 */
function extractSectionContent(section) {
  const paras = section.paragraphs || [];
  return paras.filter(p => p && p.trim()).join('；');
}

/**
 * 按标题路径聚合各单位内容
 * 返回：Map<path, Array<{unitName, content}>>
 */
function aggregateByHierarchy(unitParsedList) {
  gov.log('[DEBUG] aggregateByHierarchy called with ' + unitParsedList.length + ' units');
  const aggregationMap = new Map();

  for (const unitData of unitParsedList) {
    const { unitName, parsed } = unitData;
    const sections = parsed.sections || [];
    gov.log('[DEBUG] unit=' + unitName + ' sections=' + sections.length);
    sections.forEach((s, i) => gov.log('  section[' + i + '] level=' + s.level + ' title=' + s.title + ' paras=' + (s.paragraphs||[]).length));
    const paths = buildSectionPaths(sections);
    const leaves = findLeafSections(sections);

    for (const leaf of leaves) {
      const path = paths[leaf.index] || [];
      const pathKey = path.join(' > ');
      const content = extractSectionContent(leaf.section);
      gov.log('[DEBUG] leaf=' + leaf.section.title + ' content_len=' + content.length);

      if (!content || content.trim() === '' || content === '暂无') {
        continue;
      }

      if (!aggregationMap.has(pathKey)) {
        aggregationMap.set(pathKey, {
          path,
          items: []
        });
      }

      aggregationMap.get(pathKey).items.push({
        unitName,
        content
      });
    }
  }

  return aggregationMap;
}

/**
 * 生成汇总文本
 * 格式：
 *   一、今日工作进展
 *     （一）系统开发
 *       【单位A】完成数据采集模块、修复登录 bug
 *       【单位B】完成前端重构、优化查询性能
 *       ─────────────────────────────────
 *       【汇总】共完成 5 项：数据采集模块、登录 bug 修复...
 */
function generateAggregatedText(aggregationMap) {
  const lines = [];
  const emittedTitleKeys = new Set();

  // 按路径排序（确保一级标题在前）
  const sortedEntries = Array.from(aggregationMap.entries()).sort((a, b) => {
    return a[0].localeCompare(b[0], 'zh-CN');
  });

  for (const [pathKey, data] of sortedEntries) {
    const { path, items } = data;

    // 输出标题层级（同一路径前缀标题只输出一次）
    for (let i = 0; i < path.length; i++) {
      const titleKey = path.slice(0, i + 1).join(' > ');
      if (emittedTitleKeys.has(titleKey)) {
        continue;
      }

      const indent = '  '.repeat(i);
      const title = path[i];
      lines.push(indent + title);
      emittedTitleKeys.add(titleKey);
    }

    // 输出各单位内容
    const lastIndent = '  '.repeat(path.length);
    for (const item of items) {
      lines.push(lastIndent + `【${item.unitName}】${item.content}`);
    }

    // 生成汇总行
    if (items.length > 0) {
      lines.push(lastIndent + '─────────────────────────────────');

      // 简单汇总：统计项数，合并关键内容
      const allContents = items.map(it => it.content).join('、');
      const summary = `共 ${items.length} 个单位：${allContents}`;
      lines.push(lastIndent + `【汇总】${summary}`);
    }

    lines.push(''); // 空行分隔
  }

  return lines.join('\n');
}

// ========== 改造后的 extractFromDocument ==========

async function extractFromDocument(file, config) {
  const meta = parseFilenameWithPattern(file.name, config.fileClassification.dataFiles.pattern);

  let parsed;
  try {
    parsed = await gov.parseWordStructure(file);
    gov.log('[DEBUG] parseWordStructure returned: title=' + parsed.title + ' sections=' + (parsed.sections?.length||0) + ' rawText_len=' + (parsed.rawText?.length||0));
    if (parsed.rawText) gov.log('[DEBUG] rawText preview: ' + parsed.rawText.slice(0, 200));
  } catch (e) {
    gov.log('结构解析失败 ' + file.name + ': ' + (e.message || e));
    parsed = { title: '', sections: [], tables: [], rawText: '' };
  }

  if (config.mode === 'parse') {
    // parse 模式：返回完整的 parsed 结构，供后续按层级聚合
    return {
      unit_name: meta.unitName,
      unit_report_date: meta.dateStr || meta.dateDisplay,
      unit_summary: parsed.title || '暂无',
      // 保留完整解析结构
      parsed: parsed,
      // 兼容字段（用于 AI 模式或兜底）
      unit_overview: '已解析结构化内容',
      unit_key_projects: extractFieldFromParsed(parsed, ['重点项目', '项目进展', '重点工作']) || '暂无',
      unit_risks: extractFieldFromParsed(parsed, ['风险', '问题', '困难']) || '暂无',
      unit_risk: extractFieldFromParsed(parsed, ['风险', '问题', '困难']) || '暂无',
      unit_tomorrow: extractFieldFromParsed(parsed, ['明日计划', '明天计划', '下一步', '后续工作']) || '暂无',
      metrics: [],
    };
  }

  // AI 模式：保持原有逻辑
  const aiInput = summarizeStructureForAI(parsed);
  let aiText = aiInput;
  if (aiText.length < 50 && parsed.rawText) {
    aiText = parsed.rawText.slice(0, 8000);
  }

  const prompt = config.extraction.promptTemplate
    .replace('{filename}', file.name)
    .replace('{content}', aiText);

  let extraction;
  try {
    const aiResult = await gov.callAI(prompt);
    const jsonStr = extractJsonObject(aiResult);
    if (!jsonStr) throw new Error('阶段1: 未从模型输出解析到 JSON, unit=' + meta.unitName);
    const raw = JSON.parse(jsonStr);
    extraction = normalizeUnitExtraction(raw, config.extraction.fields);
  } catch (e) {
    gov.log('阶段1提取失败 ' + file.name + ': ' + (e.message || e) + '，使用文件名兜底');
    extraction = normalizeUnitExtraction({
      unit_name: meta.unitName,
      unit_report_date: meta.dateStr || meta.dateDisplay,
    }, config.extraction.fields);
  }
  return extraction;
}

// ========== 改造后的 aggregateResults ==========

async function aggregateResults(extractions, config) {
  if (config.mode === 'parse') {
    // parse 模式：按标题层级细分合并
    const unitParsedList = extractions.map(u => ({
      unitName: str(u.unit_name),
      parsed: u.parsed || { sections: [], tables: [], rawText: '' }
    }));

    // 按层级聚合
    const aggregationMap = aggregateByHierarchy(unitParsedList);

    // 生成汇总文本
    const aggregatedText = generateAggregatedText(aggregationMap);

    // 构建返回数据（文本形式传给模板）
    const units = extractions.map((u) => ({
      unit_name: str(u.unit_name),
      unit_report_date: str(u.unit_report_date),
      unit_summary: str(u.unit_summary),
      unit_risk: str(u.unit_risk),
      unit_overview: str(u.unit_overview),
      unit_key_projects: str(u.unit_key_projects),
      unit_risks: str(u.unit_risks),
      unit_tomorrow: str(u.unit_tomorrow),
    }));

    const reportDate = units[0] ? units[0].unit_report_date : '';
    const keyProjects = units.map((u) => u.unit_key_projects).filter(Boolean).filter((v) => v !== '暂无').join('；');
    const risks = units.map((u) => u.unit_risks).filter(Boolean).filter((v) => v !== '暂无').join('；');
    const tomorrowPlan = units.map((u) => u.unit_tomorrow).filter(Boolean).filter((v) => v !== '暂无').join('；');

    return normalizeTemplateData({
      report_title: CONFIG.output.defaultTitle,
      report_date: reportDate,
      overview: aggregatedText, // 将汇总文本放入 overview 字段
      key_projects: keyProjects || '暂无',
      risks: risks || '暂无',
      risk_detail: risks || '暂无',
      risk_items: risks ? risks.split(/[；;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 12) : [],
      tomorrow_plan: tomorrowPlan || '暂无',
      units,
    }, config.aggregation.fields);
  }

  // AI 模式：保持原有逻辑
  const unitsContext = extractions.map((u, i) => ({
    序号: i + 1,
    ...u,
  }));

  const prompt = config.aggregation.promptTemplate
    .replace('{unitCount}', String(extractions.length))
    .replace('{unitsJson}', JSON.stringify(unitsContext, null, 2));

  const aiText = await gov.callAI(prompt);
  const jsonStr = extractJsonObject(aiText);
  if (!jsonStr) throw new Error('阶段2: 未从模型输出解析到 JSON');
  const data = JSON.parse(jsonStr);
  return normalizeTemplateData(data, config.aggregation.fields);
}

async function main() {
  const files = INPUT_FILES && INPUT_FILES.length ? INPUT_FILES : (INPUT_FILE ? [INPUT_FILE] : []);
  if (files.length < 2) {
    gov.log('请至少上传 2 个文件：1 个综合日报 Word 模板（.docx）+ 至少 1 份单位日报。');
    gov.log('建议模板文件名包含「模板」；单位日报文件名形如：2024年4月12日某某单位日报.docx');
    return;
  }

  const { template, dataFiles: unitFiles } = classifyFiles(files, CONFIG.fileClassification);
  if (unitFiles.length === 0) {
    gov.log('未识别到单位日报文件（除模板外的 .docx）。');
    return;
  }

  gov.log('模板识别: ' + template.name);
  gov.log('运行模式: ' + (CONFIG.mode === 'ai' ? 'AI 提取与汇总' : '纯解析模式（按层级细分合并）'));
  gov.log('单位日报 ' + unitFiles.length + ' 份，开始逐份解析...');

  // ====== 阶段 1：逐份解析 ======
  const unitExtractions = [];
  for (let i = 0; i < unitFiles.length; i++) {
    const f = unitFiles[i];
    gov.log('解析第 ' + (i + 1) + '/' + unitFiles.length + ' 份: ' + f.name);
    const extraction = await extractFromDocument(f, CONFIG);
    unitExtractions.push(extraction);
  }

  gov.log('阶段1完成: 已提取 ' + unitExtractions.length + ' 份单位日报摘要');

  // ====== 阶段 2：汇总整合 ======
  let data;
  try {
    data = await aggregateResults(unitExtractions, CONFIG);
  } catch (e) {
    gov.log('阶段2整合失败: ' + (e.message || e));
    return;
  }

  gov.log('阶段2完成: ' + (CONFIG.mode === 'ai' ? 'AI 汇总成功' : '按层级细分合并成功'));

  if (!data.units.length) {
    gov.log('汇总结果 units 为空，已中止');
    return;
  }
  if (!data.report_title) {
    data.report_title = CONFIG.output.defaultTitle;
  }
  if (!data.report_date && data.units[0]) {
    data.report_date = data.units[0].unit_report_date || '';
  }

  gov.log('开始生成 Word 文档...');
  const outName = CONFIG.output.namingPattern
    .replace('{report_date}', data.report_date || '输出')
    .replace(/[/\\:*?"<>|]/g, '-');
  await gov.fillWordTemplate(template, data, outName);
  gov.log('完成：已按模板生成 ' + outName);
}

await main();

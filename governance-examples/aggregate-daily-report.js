// 综合日报生成器：单次上传模板 + 多单位日报，INPUT_FILES 为全部文件
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
  const byName = files.find((f) => /模板|template|综合日报模板/i.test(f.name));
  if (byName) return byName;
  return files[0];
}

function pickUnitFiles(files, template) {
  return files.filter((f) => f !== template);
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

  const prompt = `你是政务/企业综合日报编辑。根据下列各单位日报原文，整理为一份综合日报所需的数据结构。
要求只输出一个 JSON 对象（不要用 markdown 代码块），格式严格如下：
{
  "report_date": "主报告日期，YYYY-MM-DD 或中文日期",
  "units": [
    { "unit_name": "单位名称", "report_date": "该单位日报对应日期", "section_content": "该单位部分的整合正文，分段清晰，可含小标题" }
  ]
}
规则：
1. section_content 综合该单位原文要点，保持事实性，可适度归纳，不要编造数据。
2. units 顺序与输入顺序一致。
3. report_date 可取多数单位日报的共同日期或最新日期。

输入数据（JSON）：
${JSON.stringify({ template_hint: template.name, units })}`;

  let data;
  try {
    const aiText = await gov.callAI(prompt);
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : aiText;
    data = JSON.parse(jsonStr);
  } catch (e) {
    gov.log('AI 整理失败: ' + (e.message || e));
    return;
  }

  if (!data.units || !Array.isArray(data.units)) {
    gov.log('AI 返回格式无效');
    return;
  }

  const outName = '综合日报_' + (data.report_date || '输出').replace(/[\\/:*?"<>|]/g, '-') + '.docx';
  await gov.fillWordTemplate(template, data, outName);
  gov.log('完成：已按模板生成 ' + outName);
}

await main();

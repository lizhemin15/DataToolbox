// 综合日报生成器 v7：修复字段提取逻辑
const MAPPING = { overview: ["今日工作进展", "工作概述"], key_projects: ["项目进展", "重点项目"], risks: ["存在问题", "风险"], tomorrow_plan: ["下一步计划", "明日计划"] };

const files = INPUT_FILES?.length ? INPUT_FILES : (INPUT_FILE ? [INPUT_FILE] : []);
if (files.length < 2) { gov.log('请上传模板 + 至少 1 份单位日报'); } else {
  const { template, dataFiles } = gov.classifyFiles(files, { template: { contains: '模板' }, data: { excludeContains: '模板' } });
  if (!dataFiles.length) { gov.log('未识别到单位日报文件'); } else {
    gov.log('模板: ' + template.name + '，单位日报 ' + dataFiles.length + ' 份');
    const unitRegex = /^(\d{4})年(\d{1,2})月(\d{1,2})日(.+?)日报/;
    // 提取字段函数
    const extractField = (parsed, keywords) => {
      for (const s of parsed.sections || []) {
        if (s.level > 0 && keywords.some(kw => s.title?.includes(kw))) {
          const paras = s.paragraphs || [];
          if (paras.length > 0) return paras.join('；');
        }
      }
      return '';
    };
    const units = await Promise.all(dataFiles.map(async f => {
      const m = f.name.replace(/\.\w+$/, '').match(unitRegex);
      const parsed = await gov.parseWordStructure(f);
      if (!parsed.sections.filter(s => s.level > 0).length && parsed.rawText?.length > 50) parsed.sections = gov.parseSectionsFromRawText(parsed.rawText);
      const unitName = m ? m[4].trim() : f.name.replace(/\.\w+$/, '');
      const unitDate = m ? `${m[1]}年${m[2]}月${m[3]}日` : '';
      return {
        unitName,
        unitDate,
        unitOverview: extractField(parsed, MAPPING.overview),
        unitKeyProjects: extractField(parsed, MAPPING.key_projects),
        unitRisks: extractField(parsed, MAPPING.risks),
        unitTomorrow: extractField(parsed, MAPPING.tomorrow_plan),
        parsed
      };
    }));
    const aggregated = gov.aggregateByMapping(units, MAPPING);
    const reportDate = dataFiles[0].name.match(/(\d{4}年\d{1,2}月\d{1,2}日)/)?.[1] || '';
    const riskItems = units.filter(u => u.unitRisks).map(u => ({ risk_detail: u.unitName + '：' + u.unitRisks }));
    const unitsData = units.map(u => ({
      unit_name: u.unitName,
      unit_overview: u.unitOverview,
      unit_key_projects: u.unitKeyProjects,
      unit_risks: u.unitRisks,
      unit_tomorrow: u.unitTomorrow,
      unit_summary: u.unitOverview || u.unitKeyProjects,
      unit_report_date: u.unitDate,
      unit_risk: u.unitRisks
    }));
    await gov.fillWordTemplate(template, {
      report_title: '数据治理综合日报',
      report_date: reportDate,
      overview: aggregated.overview || '',
      key_projects: aggregated.key_projects || '',
      risks: aggregated.risks || '',
      tomorrow_plan: aggregated.tomorrow_plan || '',
      unit_count: units.length,
      risk_detail: aggregated.risks || '',
      risk_items: riskItems,
      units: unitsData
    }, '综合日报_' + reportDate + '.docx');
    gov.log('完成：已生成综合日报_' + reportDate + '.docx');
  }
}

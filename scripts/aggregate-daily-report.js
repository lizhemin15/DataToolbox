// 综合日报生成器 v5：精简版，核心逻辑由 gov API 封装
const MAPPING = { overview: ["今日工作进展", "工作概述"], key_projects: ["项目进展", "重点项目"], risks: ["存在问题", "风险"], tomorrow_plan: ["下一步计划", "明日计划"] };
const files = INPUT_FILES?.length ? INPUT_FILES : (INPUT_FILE ? [INPUT_FILE] : []);
if (files.length < 2) { gov.log('请上传模板 + 至少 1 份单位日报'); } else {
  const { template, dataFiles } = gov.classifyFiles(files, { template: { contains: '模板' }, data: { excludeContains: '模板' } });
  if (!dataFiles.length) { gov.log('未识别到单位日报文件'); } else {
    gov.log('模板: ' + template.name + '，单位日报 ' + dataFiles.length + ' 份');
    const unitRegex = /^(\d{4})年(\d{1,2})月(\d{1,2})日(.+?)日报/;
    const units = await Promise.all(dataFiles.map(async f => {
      const m = f.name.replace(/\.\w+$/, '').match(unitRegex);
      const parsed = await gov.parseWordStructure(f);
      if (!parsed.sections.filter(s => s.level > 0).length && parsed.rawText?.length > 50) parsed.sections = gov.parseSectionsFromRawText(parsed.rawText);
      return { unitName: m ? m[4].trim() : f.name.replace(/\.\w+$/, ''), parsed };
    }));
    const aggregated = gov.aggregateByMapping(units, MAPPING);
    const reportDate = dataFiles[0].name.match(/(\d{4}年\d{1,2}月\d{1,2}日)/)?.[1] || '';
    await gov.fillWordTemplate(template, { report_title: '数据治理综合日报', report_date: reportDate, ...aggregated, units: units.map(u => ({ unit_name: u.unitName })) }, '综合日报_' + reportDate + '.docx');
    gov.log('完成：已生成综合日报_' + reportDate + '.docx');
  }
}
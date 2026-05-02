// 综合日报生成器 v10 - 结构化路径选择器
const FIELD_MAP = {
  overview: "sections[level=1][0]",
  key_projects: "sections[level=1][1]",
  risks: "sections[level=1][2]",
  tomorrow_plan: "sections[level=1][3]"
};

const files = INPUT_FILES?.length ? INPUT_FILES : (INPUT_FILE ? [INPUT_FILE] : []);
if (files.length < 2) {
  gov.log('请上传模板 + 至少 1 份单位日报');
} else {
  const { template, dataFiles } = gov.classifyFiles(files, {
    template: { contains: '模板' },
    data: { excludeContains: '模板' }
  });

  if (!dataFiles.length) {
    gov.log('未识别到单位日报文件');
  } else {
    gov.log('模板: ' + template.name + '，单位日报 ' + dataFiles.length + ' 份');

    const unitRegex = /^(\d{4})年(\d{1,2})月(\d{1,2})日(.+?)日报/;

    const units = await Promise.all(dataFiles.map(async f => {
      const m = f.name.replace(/\.\w+$/, '').match(unitRegex);
      const parsed = await gov.parseWordStructure(f);

      // 兜底解析
      if (!parsed.sections.some(s => s.level > 0) && parsed.rawText?.length > 50) {
        parsed.sections = gov.parseSectionsFromRawText(parsed.rawText);
      }

      const unitName = m?.[4]?.trim() || f.name.replace(/\.\w+$/, '');
      const unitDate = m ? `${m[1]}年${m[2]}月${m[3]}日` : '';

      return { unitName, unitDate, parsed };
    }));

    // 用选择器聚合
    const { aggregated, perUnit } = gov.aggregateByFields(units, FIELD_MAP);

    const reportDate = dataFiles[0].name.match(/(\d{4}年\d{1,2}月\d{1,2}日)/)?.[1] || '';

    await gov.fillWordTemplate(template, {
      report_title: '数据治理综合日报',
      report_date: reportDate,
      unit_count: units.length,
      overview: aggregated.overview,
      key_projects: aggregated.key_projects,
      risks: aggregated.risks,
      tomorrow_plan: aggregated.tomorrow_plan,
      risk_detail: aggregated.risks,
      risk_items: perUnit.filter((row, i) => row.risks).map((row, i) => units[i].unitName + '：' + row.risks),
      units: units.map((u, i) => ({
        unit_name: u.unitName,
        unit_report_date: u.unitDate,
        unit_summary: perUnit[i].overview || perUnit[i].key_projects,
        unit_overview: perUnit[i].overview,
        unit_key_projects: perUnit[i].key_projects,
        unit_risks: perUnit[i].risks,
        unit_tomorrow: perUnit[i].tomorrow_plan,
        unit_risk: perUnit[i].risks
      }))
    }, '综合日报_' + reportDate + '.docx');

    gov.log('完成：已生成综合日报_' + reportDate + '.docx');
  }
}

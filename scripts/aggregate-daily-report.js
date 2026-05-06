// 综合日报生成器 - 使用 gov API 公共方法
// 只保留特异性配置：模板识别、占位符映射

async function main() {
    const files = INPUT_FILES;
    if (!files || files.length < 2) {
        gov.log('请上传：1个模板 + 至少1份单位日报');
        return;
    }

    // ===== 特异性配置 =====
    // 模板识别规则
    const templatePattern = /模板|template/i;
    // 输出文件名格式
    const outputNameFormat = (date) => `综合日报_${date || '输出'}.docx`;
    // 报告标题
    const reportTitle = '数据治理综合日报';
    // ===== 特异性配置结束 =====

    // 找模板
    const template = files.find(f => templatePattern.test(f.name)) || files[0];
    const unitFiles = files.filter(f => f !== template);

    gov.log(`模板: ${template.name}`);
    gov.log(`单位日报: ${unitFiles.length} 份`);
    gov.log('');

    // 解析每份单位日报
    const units = [];
    for (const f of unitFiles) {
        // 使用 gov API 解析文件名
        const meta = gov.parseFilename(f.name);
        gov.log(`解析: ${f.name}`);
        
        // 使用 gov API 解析文档结构
        const doc = await gov.parseWordStructure(f);
        
        // 使用 gov API 统计树形结构
        const stats = gov.countTree(doc.sections);
        
        gov.log(`  文档标题: ${doc.title || '(未识别)'}`);
        gov.log(`  章节总数: ${stats.total}`);
        gov.log(`  最大层级: ${stats.maxDepth}`);
        gov.log('');

        // 使用 gov API 转换树形结构为模板格式
        const unit = {
            unit_name: meta.unit || doc.title || '未知单位',
            unit_report_date: meta.date,
            unit_sections_tree: gov.treeToJSON(doc.sections),
            unit_section_count: stats.total,
            unit_max_level: stats.maxDepth
        };
        
        units.push(unit);
        gov.log(`  提取完成: ${unit.unit_name} | ${unit.unit_report_date || '无日期'}`);
        gov.log('');
    }

    // 汇总数据
    const data = {
        report_title: reportTitle,
        report_date: units[0]?.unit_report_date || '',
        units_count: units.length,
        units: units
    };

    // 生成报告
    const outName = outputNameFormat(data.report_date);
    await gov.fillWordTemplate(template, data, outName);
    gov.log(`完成: ${outName}`);
}

await main();

// 综合日报生成器 - v10 简洁版 JSON 路径提取
// 使用 gov. 的树形 JSON，通过 JSON 路径直接提取内容
// 格式标记：**加粗** >首行缩进

async function main() {
    const files = INPUT_FILES;
    if (!files || files.length < 2) {
        gov.log('请上传：1个模板 + 至少1份单位日报');
        return;
    }

    // ===== 特异性配置 =====
    const templatePattern = /模板|template/i;
    const outputNameFormat = (date) => `综合日报_${date || '输出'}.docx`;
    const reportTitle = '数据治理综合日报';
    
    // JSON 路径配置：L1索引 → 目标字段
    // gov. 返回的 sections 是数组，sections[0] 是第一个 L1 标题节点
    const pathConfig = [
        { path: 'sections[0]', field: 'overview', desc: '今日工作' },
        { path: 'sections[1]', field: 'risks', desc: '存在问题' },
        { path: 'sections[2]', field: 'tomorrow', desc: '下一步计划' },
        { path: 'sections[3]', field: 'key_projects', desc: '项目进展' }
    ];
    // ===== 特异性配置结束 =====

    const template = files.find(f => templatePattern.test(f.name)) || files[0];
    const unitFiles = files.filter(f => f !== template);

    gov.log(`模板: ${template.name}`);
    gov.log(`单位日报: ${unitFiles.length} 份`);
    gov.log('');

    // 递归提取节点内容：标题 + 子节点
    function getContent(node) {
        const lines = [];
        // 标题加粗
        lines.push(`**${node.title}**`);
        // 自身段落（首行缩进）
        for (const p of (node.paragraphs || [])) {
            if (p.trim()) lines.push(`>${p.trim()}`);
        }
        // 子节点递归
        for (const child of (node.children || [])) {
            lines.push(...getContent(child));
        }
        return lines.join('\n');
    }

    // 解析每份单位日报
    const units = [];
    for (const f of unitFiles) {
        const meta = gov.parseFilename(f.name);
        gov.log(`解析: ${f.name}`);
        
        const doc = await gov.parseWordStructure(f);
        
        const fields = { overview: '', key_projects: '', risks: '', summary: '', tomorrow: '' };
        
        // 按 JSON 路径提取
        for (const cfg of pathConfig) {
            const node = eval(cfg.path);  // sections[0] 等
            if (node) {
                fields[cfg.field] = getContent(node);
                gov.log(`  ${cfg.desc} → ${cfg.field}: ${fields[cfg.field].length} 字符`);
            }
        }
        
        units.push({
            unit_name: meta.unit || doc.title || '未知单位',
            unit_report_date: meta.date,
            unit_overview: fields.overview,
            unit_key_projects: fields.key_projects || '>暂无',
            unit_risks: fields.risks || '>暂无',
            unit_summary: fields.summary || '>暂无',
            unit_tomorrow: fields.tomorrow || '>暂无'
        });
        gov.log('');
    }

    // 生成报告
    const outName = outputNameFormat(units[0]?.unit_report_date || '');
    await gov.fillWordTemplate(template, {
        report_title: reportTitle,
        report_date: units[0]?.unit_report_date || '',
        units_count: units.length,
        units: units
    }, outName);
    gov.log(`完成: ${outName}`);
}

await main();
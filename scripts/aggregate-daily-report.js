// 综合日报生成器 - 纯 JSON 解析版
// 使用 gov.parseWordStructure 解析文档，输出 JSON 结构，合并后填充模板

function parseFilename(name) {
    const base = name.replace(/\.(docx?|DOCX?)$/i, '');
    const m = base.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(.+?)日报$/);
    if (!m) return { unit: base, date: '' };
    return {
        unit: m[4].trim(),
        date: `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日`
    };
}

// 从章节中提取内容（支持多种关键词）
function getSectionContent(sections, keywords) {
    for (const sec of sections) {
        const title = sec.title || '';
        for (const k of keywords) {
            if (title.includes(k)) {
                return sec.paragraphs.join('\n') || '暂无';
            }
        }
    }
    return '暂无';
}

async function main() {
    const files = INPUT_FILES;
    if (!files || files.length < 2) {
        gov.log('请上传：1个模板 + 至少1份单位日报');
        return;
    }

    // 找模板（文件名含"模板"或第一个文件）
    const template = files.find(f => /模板|template/i.test(f.name)) || files[0];
    const unitFiles = files.filter(f => f !== template);

    gov.log(`模板: ${template.name}`);
    gov.log(`单位日报: ${unitFiles.length} 份`);
    gov.log('');

    // 解析每份单位日报
    const units = [];
    for (const f of unitFiles) {
        const meta = parseFilename(f.name);
        const doc = await gov.parseWordStructure(f);
        
        // 输出解析出的 JSON 结构
        gov.log('========================================');
        gov.log(`文件: ${f.name}`);
        gov.log('--- 解析结果 JSON ---');
        gov.log(JSON.stringify({
            文件名: f.name,
            识别单位: meta.unit || doc.title || '未知单位',
            日期: meta.date,
            文档标题: doc.title,
            章节数: doc.sections.length,
            表格数: doc.tables.length,
            章节列表: doc.sections.map(s => ({
                层级: s.level,
                标题: s.title,
                段落数: s.paragraphs.length,
                内容预览: s.paragraphs.slice(0, 2).join(' ').slice(0, 100)
            }))
        }, null, 2));
        gov.log('');
        
        const unit = {
            unit_name: meta.unit || doc.title || '未知单位',
            unit_report_date: meta.date,
            unit_overview: getSectionContent(doc.sections, ['工作进展', '今日工作', '工作概述', '进展']),
            unit_key_projects: getSectionContent(doc.sections, ['重点项目', '项目进展', '项目', '四、']),
            unit_risks: getSectionContent(doc.sections, ['问题', '风险', '存在', '二、存在']),
            unit_tomorrow: getSectionContent(doc.sections, ['计划', '下一步', '明日', '三、下一步'])
        };
        units.push(unit);
        gov.log(`提取字段: ${unit.unit_name} | ${unit.unit_report_date || '无日期'}`);
    }

    // 汇总数据
    const data = {
        report_title: '数据治理综合日报',
        report_date: units[0]?.unit_report_date || '',
        overview: units.map(u => `【${u.unit_name}】${u.unit_overview.slice(0, 80)}`).join('\n'),
        key_projects: units.map(u => `【${u.unit_name}】${u.unit_key_projects}`).join('\n'),
        risks: units.map(u => `【${u.unit_name}】${u.unit_risks}`).join('\n'),
        tomorrow_plan: units.map(u => `【${u.unit_name}】${u.unit_tomorrow}`).join('\n'),
        units: units
    };

    // 输出最终汇总 JSON
    gov.log('');
    gov.log('========================================');
    gov.log('--- 最终汇总数据 JSON ---');
    gov.log(JSON.stringify(data, null, 2));
    gov.log('');

    // 生成报告
    const outName = `综合日报_${data.report_date || '输出'}.docx`;
    await gov.fillWordTemplate(template, data, outName);
    gov.log(`完成: ${outName}`);
}

await main();

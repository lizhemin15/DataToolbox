// 综合日报生成器 - 完整树形结构输出版
// 解析 Word 文档，输出完整层级 JSON，供模板递归渲染

function parseFilename(name) {
    const base = name.replace(/\.(docx?|DOCX?)$/i, '');
    const m = base.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(.+?)日报$/);
    if (!m) return { unit: base, date: '' };
    return {
        unit: m[4].trim(),
        date: `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日`
    };
}

// 将树形结构转换为纯净 JSON（保留完整层级）
function treeToJSON(nodes) {
    return nodes.map(node => ({
        level: node.level,
        title: node.title,
        paragraph_count: (node.paragraphs || []).length,
        paragraphs: node.paragraphs || [],
        children: node.children && node.children.length > 0 ? treeToJSON(node.children) : []
    }));
}

// 统计树形结构信息
function countTree(nodes) {
    let total = 0;
    let maxDepth = 0;
    function walk(nodes, depth) {
        for (const node of nodes) {
            total++;
            maxDepth = Math.max(maxDepth, depth);
            if (node.children && node.children.length > 0) {
                walk(node.children, depth + 1);
            }
        }
    }
    walk(nodes, 1);
    return { total, maxDepth };
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
        gov.log(`解析: ${f.name}`);
        
        const doc = await gov.parseWordStructure(f);
        
        // 统计树形结构
        const stats = countTree(doc.sections);
        
        // 输出解析结果
        gov.log(`  文档标题: ${doc.title || '(未识别)'}`);
        gov.log(`  章节总数: ${stats.total}`);
        gov.log(`  最大层级: ${stats.maxDepth}`);
        
        // 打印树形结构预览
        function printTree(nodes, indent = '  ') {
            for (const node of nodes) {
                gov.log(`${indent}├─ L${node.level} ${node.title} (${node.paragraphs.length}段, ${node.children.length}子节点)`);
                if (node.children.length > 0) {
                    printTree(node.children, indent + '  ');
                }
            }
        }
        printTree(doc.sections);
        gov.log('');

        // 构建单位数据（保留完整树形结构）
        const unit = {
            unit_name: meta.unit || doc.title || '未知单位',
            unit_report_date: meta.date,
            // 完整树形结构（核心输出）
            unit_sections_tree: treeToJSON(doc.sections),
            // 统计信息
            unit_section_count: stats.total,
            unit_max_level: stats.maxDepth
        };
        
        units.push(unit);
        gov.log(`  提取完成: ${unit.unit_name} | ${unit.unit_report_date || '无日期'}`);
        gov.log('');
    }

    // 汇总数据
    const data = {
        report_title: '数据治理综合日报',
        report_date: units[0]?.unit_report_date || '',
        units_count: units.length,
        // 各单位完整树形数据
        units: units
    };

    // 输出汇总 JSON（完整结构）
    gov.log('======== 汇总数据（完整树形结构）========');
    gov.log(JSON.stringify(data, null, 2));
    gov.log('');

    // 生成报告
    const outName = `综合日报_${data.report_date || '输出'}.docx`;
    await gov.fillWordTemplate(template, data, outName);
    gov.log(`完成: ${outName}`);
}

await main();

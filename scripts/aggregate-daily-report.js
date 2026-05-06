// 综合日报生成器 - 树形结构解析版
// 使用 gov.parseWordStructure 解析文档，基于树形结构智能提取内容

function parseFilename(name) {
    const base = name.replace(/\.(docx?|DOCX?)$/i, '');
    const m = base.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(.+?)日报$/);
    if (!m) return { unit: base, date: '' };
    return {
        unit: m[4].trim(),
        date: `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日`
    };
}

// 从树形结构中查找指定标题的节点（支持模糊匹配）
function findSectionByTitle(nodes, keyword, depth = 0) {
    if (depth > 10 || !nodes) return null;
    for (const node of nodes) {
        // 模糊匹配：标题包含关键词即可
        if (node.title && node.title.includes(keyword)) {
            return node;
        }
        // 递归搜索子节点
        if (node.children && node.children.length > 0) {
            const found = findSectionByTitle(node.children, keyword, depth + 1);
            if (found) return found;
        }
    }
    return null;
}

// 收集节点及其所有子节点的内容（递归）
function collectContent(node, includeChildren = true) {
    const lines = [];
    if (!node) return lines;
    
    // 收集当前节点的段落
    if (node.paragraphs && node.paragraphs.length > 0) {
        lines.push(...node.paragraphs);
    }
    
    // 递归收集子节点内容
    if (includeChildren && node.children && node.children.length > 0) {
        for (const child of node.children) {
            // 包含子标题（带层级标记）
            const prefix = '  '.repeat(child.level - 1);
            lines.push(`${prefix}${child.title}`);
            lines.push(...collectContent(child, true));
        }
    }
    
    return lines;
}

// 从树形章节中提取内容（支持多个关键词，按优先级匹配）
function getSectionContent(sections, keywords) {
    for (const kw of keywords) {
        const node = findSectionByTitle(sections, kw);
        if (node) {
            const lines = collectContent(node, true);
            if (lines.length > 0) {
                return lines.join('\n');
            }
        }
    }
    return '暂无';
}

// 提取表格数据（从段落中识别表格结构）
function extractTableFromParagraphs(paragraphs) {
    if (!paragraphs || paragraphs.length < 2) return null;
    
    // 检测表格特征：连续包含制表符或固定格式的行
    const tableLines = [];
    let inTable = false;
    
    for (const p of paragraphs) {
        // 表格行特征：包含制表符或看起来像表格数据
        if (p.includes('\t') || /^\S+\s+\S+\s+\S+/.test(p)) {
            tableLines.push(p);
            inTable = true;
        } else if (inTable && p.length < 50) {
            // 可能是表格的一部分
            tableLines.push(p);
        } else if (inTable) {
            break; // 表格结束
        }
    }
    
    return tableLines.length >= 3 ? tableLines : null;
}

// 格式化表格为 Markdown
function formatTableAsMarkdown(tableLines) {
    if (!tableLines || tableLines.length < 2) return '';
    
    const rows = tableLines.map(line => line.split(/[\t|]+/).map(cell => cell.trim()).filter(c => c));
    if (rows.length < 2) return '';
    
    // 第一行作为表头
    const header = rows[0];
    const dataRows = rows.slice(1);
    
    let md = '| ' + header.join(' | ') + ' |\n';
    md += '| ' + header.map(() => '---').join(' | ') + ' |\n';
    for (const row of dataRows) {
        md += '| ' + row.join(' | ') + ' |\n';
    }
    
    return md;
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
        
        // 输出解析结果
        gov.log(`  标题: ${doc.title || '(未识别)'}`);
        gov.log(`  一级节点: ${doc.sections.length} 个`);
        
        // 打印树形结构
        function printTree(nodes, indent = '  ') {
            for (const node of nodes) {
                gov.log(`${indent}├─ ${node.title} (${node.paragraphs.length}段, ${node.children.length}子节点)`);
                if (node.children.length > 0) {
                    printTree(node.children, indent + '  ');
                }
            }
        }
        printTree(doc.sections);
        gov.log('');

        // 基于树形结构提取各字段
        const unit = {
            unit_name: meta.unit || doc.title || '未知单位',
            unit_report_date: meta.date,
            // 工作进展：匹配多个可能的关键词
            unit_overview: getSectionContent(doc.sections, ['工作进展', '今日工作', '工作概述', '进展', '一、']),
            // 重点项目：优先匹配"项目"相关章节
            unit_key_projects: getSectionContent(doc.sections, ['重点项目', '项目进展', '项目', '四、']),
            // 问题风险
            unit_risks: getSectionContent(doc.sections, ['问题', '风险', '存在', '困难', '二、']),
            // 明日计划
            unit_tomorrow: getSectionContent(doc.sections, ['计划', '下一步', '明日', '三、'])
        };
        
        // 尝试提取表格数据
        const projectSection = findSectionByTitle(doc.sections, '项目');
        if (projectSection && projectSection.paragraphs.length > 0) {
            const tableLines = extractTableFromParagraphs(projectSection.paragraphs);
            if (tableLines) {
                unit.unit_projects_table = formatTableAsMarkdown(tableLines);
            }
        }
        
        units.push(unit);
        gov.log(`  提取: ${unit.unit_name} | ${unit.unit_report_date || '无日期'}`);
        gov.log('');
    }

    // 汇总数据
    const data = {
        report_title: '数据治理综合日报',
        report_date: units[0]?.unit_report_date || '',
        // 各单位工作进展汇总
        overview: units.map(u => `【${u.unit_name}】\n${u.unit_overview}`).join('\n\n'),
        // 重点项目汇总
        key_projects: units.map(u => `【${u.unit_name}】\n${u.unit_key_projects}`).join('\n\n'),
        // 问题风险汇总
        risks: units.map(u => `【${u.unit_name}】\n${u.unit_risks}`).join('\n\n'),
        // 明日计划汇总
        tomorrow_plan: units.map(u => `【${u.unit_name}】\n${u.unit_tomorrow}`).join('\n\n'),
        // 原始单位数据（供模板循环使用）
        units: units
    };

    // 输出汇总 JSON（调试用）
    gov.log('======== 汇总数据 ========');
    gov.log(JSON.stringify({
        report_title: data.report_title,
        report_date: data.report_date,
        units_count: units.length,
        units: units.map(u => ({
            name: u.unit_name,
            date: u.unit_report_date,
            overview_len: u.unit_overview.length,
            projects_len: u.unit_key_projects.length
        }))
    }, null, 2));
    gov.log('');

    // 生成报告
    const outName = `综合日报_${data.report_date || '输出'}.docx`;
    await gov.fillWordTemplate(template, data, outName);
    gov.log(`完成: ${outName}`);
}

await main();

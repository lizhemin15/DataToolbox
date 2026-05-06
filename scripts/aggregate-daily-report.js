// 综合日报生成器 - v11 按公文标题规律匹配解析
// 按标题关键词匹配提取内容，而非固定索引
// 格式标记：**加粗** >首行缩进

async function main() {
    const files = INPUT_FILES;
    if (!files || files.length < 2) {
        gov.log('请上传：1个模板 + 至少1份单位日报');
        return;
    }

    // ===== 配置 =====
    const templatePattern = /模板|template/i;
    const outputNameFormat = (date) => `综合日报_${date || '输出'}.docx`;
    const reportTitle = '数据治理综合日报';
    
    // 标题关键词匹配规则：按公文标题规律
    // L1: 一、二、三 → 主题大类
    // L2: （一）（二）（三）→ 子主题
    // L3: 1. 2. 3. → 详细条目
    const titlePatterns = {
        // 今日工作相关
        overview: ['工作', '情况', '概述', '概要', '内容', '进展', '完成', '开展'],
        // 存在问题
        risks: ['问题', '风险', '隐患', '困难', '不足', '缺陷', '待解决'],
        // 下一步计划
        tomorrow: ['计划', '安排', '下一步', '后续', '将要', '预计', '打算'],
        // 项目进展
        key_projects: ['项目', '工程', '建设', '任务', '专项', '重点']
    };
    // ===== 配置结束 =====

    const template = files.find(f => templatePattern.test(f.name)) || files[0];
    const unitFiles = files.filter(f => f !== template);

    gov.log(`模板: ${template.name}`);
    gov.log(`单位日报: ${unitFiles.length} 份`);
    gov.log('');

    // 递归提取节点完整内容
    function extractContent(node, includeChildren = true) {
        const lines = [];
        // 标题加粗
        lines.push(`**${node.title}**`);
        // 自身段落（首行缩进）
        for (const p of (node.paragraphs || [])) {
            if (p && p.trim()) lines.push(`>${p.trim()}`);
        }
        // 子节点递归
        if (includeChildren) {
            for (const child of (node.children || [])) {
                lines.push(...extractContent(child, true));
            }
        }
        return lines.join('\n');
    }

    // 递归查找匹配标题的节点
    function findNodesByKeyword(nodes, keywords, results = []) {
        for (const node of nodes) {
            const titleLower = (node.title || '').toLowerCase();
            for (const kw of keywords) {
                if (titleLower.includes(kw)) {
                    results.push(node);
                    break;
                }
            }
            // 递归子节点
            if (node.children && node.children.length > 0) {
                findNodesByKeyword(node.children, keywords, results);
            }
        }
        return results;
    }

    // 递归统计节点数
    function countNodes(nodes) {
        let count = 0;
        for (const node of nodes) {
            count += 1;
            if (node.children) count += countNodes(node.children);
        }
        return count;
    }

    // 解析每份单位日报
    const units = [];
    for (const f of unitFiles) {
        const meta = gov.parseFilename(f.name);
        gov.log(`解析: ${f.name}`);
        
        const doc = await gov.parseWordStructure(f);
        
        // 输出解析结果用于调试
        gov.log(`  文档标题: ${doc.title}`);
        gov.log(`  章节总数: ${countNodes(doc.sections)}`);
        
        const fields = { overview: '', key_projects: '', risks: '', summary: '', tomorrow: '' };
        
        // 按关键词匹配提取各字段
        for (const [field, keywords] of Object.entries(titlePatterns)) {
            const matchedNodes = findNodesByKeyword(doc.sections, keywords);
            
            if (matchedNodes.length > 0) {
                // 合并所有匹配节点的内容
                const contents = matchedNodes.map(n => extractContent(n, true));
                fields[field] = contents.join('\n\n');
                gov.log(`  ${field} → 匹配到 ${matchedNodes.length} 个节点, ${fields[field].length} 字符`);
            } else {
                fields[field] = '>暂无';
                gov.log(`  ${field} → 未匹配到相关内容`);
            }
        }
        
        units.push({
            unit_name: meta.unit || doc.title || '未知单位',
            unit_report_date: meta.date,
            unit_overview: fields.overview || '>暂无',
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
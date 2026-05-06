// 综合日报生成器 - v8 按公文层级规律自动归纳
// 使用 gov.parseWordStructure 解析树形结构，按 L1 标题关键词自动分类

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
    
    // L1 标题关键词 → 字段映射规则
    // 按公文规律：L1 是一级标题（一、二、三...），标题文字决定字段归属
    const fieldRules = [
        { keywords: ['工作进展', '工作动态', '今日工作', '情况', '综述', '进展'], field: 'overview' },
        { keywords: ['重点', '项目', '任务', '工程'], field: 'key_projects' },
        { keywords: ['问题', '风险', '隐患', '困难', '异常'], field: 'risks' },
        { keywords: ['总结', '合计', '汇总', '整体', '完成'], field: 'summary' },
        { keywords: ['计划', '下一步', '明日', '次日', '打算', '安排'], field: 'tomorrow' }
    ];
    // ===== 特异性配置结束 =====

    const template = files.find(f => templatePattern.test(f.name)) || files[0];
    const unitFiles = files.filter(f => f !== template);

    gov.log(`模板: ${template.name}`);
    gov.log(`单位日报: ${unitFiles.length} 份`);
    gov.log('');

    // 递归收集节点及所有子节点内容（含子标题）
    function collectContent(node, includeTitle = false) {
        const lines = includeTitle ? [node.title] : [];
        lines.push(...(node.paragraphs || []));
        for (const child of (node.children || [])) {
            lines.push(...collectContent(child, true)); // 子节点带标题
        }
        return lines;
    }

    // 按 L1 标题关键词匹配字段
    function matchField(title) {
        const t = title || '';
        for (const rule of fieldRules) {
            for (const kw of rule.keywords) {
                if (t.includes(kw)) return rule.field;
            }
        }
        return null;
    }

    // 解析每份单位日报
    const units = [];
    for (const f of unitFiles) {
        const meta = gov.parseFilename(f.name);
        gov.log(`解析: ${f.name}`);
        
        const doc = await gov.parseWordStructure(f);
        const stats = gov.countTree(doc.sections);
        
        gov.log(`  文档标题: ${doc.title || '(未识别)'}`);
        gov.log(`  章节总数: ${stats.total}`);
        gov.log(`  最大层级: ${stats.maxDepth}`);
        
        // 初始化字段容器
        const fields = {
            overview: '',
            key_projects: '',
            risks: '',
            summary: '',
            tomorrow: ''
        };
        
        // 遍历 L1 节点，按标题关键词归类
        const sections = doc.sections || [];
        for (const node of sections) {
            if (node.level !== 1) continue; // 只处理 L1
            
            const field = matchField(node.title);
            if (!field) {
                gov.log(`  跳过未匹配的 L1: ${node.title}`);
                continue;
            }
            
            // 收集该节点及所有子节点内容
            const content = collectContent(node).join('\n');
            if (fields[field]) {
                fields[field] += '\n' + content; // 多个同类型 L1 合并
            } else {
                fields[field] = content;
            }
            
            gov.log(`  L1 "${node.title}" → ${field} (${content.length} 字符)`);
        }
        
        // 应用格式标记（缩进 + 加粗）
        // 规则：段落首行缩进，标题行加粗
        const formatContent = (text) => {
            if (!text) return '';
            return text.split('\n').map(line => {
                if (!line.trim()) return '';
                // 已经是格式标记的不重复处理
                if (line.startsWith('>') || line.startsWith('**')) return line;
                // 检测是否是子标题（短行 + 以编号开头）
                const isSubTitle = line.length < 30 && /^（[一二三四五六七八九十]+）|^\d+[\.、．：]|^（\d+）/.test(line);
                if (isSubTitle) {
                    return `**${line}**`; // 子标题加粗
                }
                return `>${line}`; // 普通段落缩进
            }).filter(l => l).join('\n');
        };
        
        const unit = {
            unit_name: meta.unit || doc.title || '未知单位',
            unit_report_date: meta.date,
            // 模板占位符字段（带格式标记）
            unit_overview: formatContent(fields.overview),
            unit_key_projects: formatContent(fields.key_projects),
            unit_risks: formatContent(fields.risks),
            unit_summary: formatContent(fields.summary),
            unit_tomorrow: formatContent(fields.tomorrow),
            // 树形结构字段（高级用户）
            unit_sections_tree: gov.treeToJSON(doc.sections),
            unit_section_count: stats.total,
            unit_max_level: stats.maxDepth
        };
        
        units.push(unit);
        
        gov.log(`  字段统计:`);
        gov.log(`    overview: ${fields.overview ? fields.overview.length + ' 字符' : '(未找到)'}`);
        gov.log(`    key_projects: ${fields.key_projects ? fields.key_projects.length + ' 字符' : '(未找到)'}`);
        gov.log(`    risks: ${fields.risks ? fields.risks.length + ' 字符' : '(未找到)'}`);
        gov.log(`    summary: ${fields.summary ? fields.summary.length + ' 字符' : '(未找到)'}`);
        gov.log(`    tomorrow: ${fields.tomorrow ? fields.tomorrow.length + ' 字符' : '(未找到)'}`);
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

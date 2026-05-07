// 综合日报生成器 - v12 重构版
// 支持 .doc/.docx/.wps 格式，模板占位符提取，子文档 JSON 化，用户自定义替换规则

async function main() {
    const files = INPUT_FILES;
    if (!files || files.length < 2) {
        gov.log('请上传：1个模板 + 至少1份单位日报');
        return;
    }

    // ===== 配置区 =====
    const templatePattern = /模板|template/i;
    const outputNameFormat = (date) => `综合日报_${date || '输出'}.docx`;

    // ===== 步骤1：识别模板和子文档 =====
    const template = files.find(f => templatePattern.test(f.name)) || files[0];
    const unitFiles = files.filter(f => f !== template);

    gov.log(`模板文件: ${template.name}`);
    gov.log(`单位日报: ${unitFiles.length} 份`);
    gov.log('');

    // ===== 步骤2：提取模板占位符 =====
    gov.log('===== 步骤1：提取模板占位符 =====');
    const templateText = await gov.readWord(template);
    const placeholderPattern = /\{([^}]+)\}/g;
    const placeholders = [];
    let match;

    while ((match = placeholderPattern.exec(templateText.value)) !== null) {
        if (!placeholders.includes(match[1])) {
            placeholders.push(match[1]);
        }
    }

    gov.log(`发现 ${placeholders.length} 个占位符:`);
    placeholders.forEach(p => gov.log(`  - {${p}}`));
    gov.log('');

    // 创建占位符字典（初始为空）
    const module = {};
    placeholders.forEach(p => {
        module[p] = '';
    });

    // ===== 步骤3：解析子文档为 JSON =====
    gov.log('===== 步骤2：解析子文档为 JSON =====');
    const jsons = {};

    for (const f of unitFiles) {
        gov.log(`解析: ${f.name}`);

        try {
            // 检查文件格式
            const ext = f.name.split('.').pop().toLowerCase();

            // 使用 parseWordStructure 解析文档结构
            const doc = await gov.parseWordStructure(f);

            // 将文档结构转换为树状 JSON
            const treeData = buildTree(doc.sections);

            // 存入 jsons 字典，使用文件名（不含扩展名）作为 key
            const docName = f.name.replace(/\.(docx?|wps)$/i, '');
            jsons[docName] = treeData;

            gov.log(`  文档标题: ${doc.title}`);
            gov.log(`  章节数: ${doc.sections.length}`);
            gov.log(`  表格数: ${doc.tables.length}`);
            gov.log(`  JSON 结构已生成`);
        } catch (err) {
            gov.log(`  ⚠️ 解析失败: ${err.message}`);
        }
        gov.log('');
    }

    // ===== 步骤4：用户填写替换规则 =====
    gov.log('===== 步骤3：填写替换规则 =====');
    gov.log('请根据以下 JSON 数据结构，填写 module 字典的替换规则：');
    gov.log('');

    // 输出 JSON 结构示例
    const docNames = Object.keys(jsons);
    if (docNames.length > 0) {
        gov.log('可用文档:');
        docNames.forEach(name => {
            gov.log(`  - jsons["${name}"]`);
            // 输出树状结构概览
            const tree = jsons[name];
            if (tree && tree.length > 0) {
                gov.log(`    结构: [${tree.length}个一级节点]`);
                tree.slice(0, 3).forEach((node, idx) => {
                    gov.log(`      [${idx}]: ${node.title}`);
                });
            }
        });
        gov.log('');
    }

    // ===== 用户自定义替换规则区域 =====
    // 用户可在此处编写替换逻辑
    // 示例：
    // module["报告标题"] = "数据治理综合日报";
    // module["日期"] = gov.word(jsons["单位A日报"][0][2], { bold: true });
    // module["工作概述"] = jsons["单位A日报"][0].content + jsons["单位B日报"][0].content;

    // ===== 示例替换规则（可根据实际需求修改） =====
    // 自动提取第一个文档的日期
    if (docNames.length > 0) {
        const firstDoc = jsons[docNames[0]];
        const meta = gov.parseFilename(docNames[0]);
        module["报告日期"] = meta.date || '';
        module["报告标题"] = "数据治理综合日报";
    }

    // 合并所有单位的工作概述（假设第一个节点是工作概述）
    const overviewParts = [];
    for (const [docName, tree] of Object.entries(jsons)) {
        if (tree && tree.length > 0) {
            const firstNode = tree[0];
            overviewParts.push(`【${docName}】\n${firstNode.content || ''}`);
        }
    }
    module["工作概述"] = overviewParts.join('\n\n');

    // ===== 步骤5：生成最终文档 =====
    gov.log('===== 步骤4：生成最终文档 =====');

    // 显示 module 字典内容
    gov.log('module 字典内容:');
    for (const [key, value] of Object.entries(module)) {
        const preview = typeof value === 'string' && value.length > 50
            ? value.substring(0, 50) + '...'
            : value;
        gov.log(`  ${key}: ${preview}`);
    }
    gov.log('');

    // 使用 fillWordTemplate 生成文档
    const outName = outputNameFormat(module["报告日期"] || module["日期"] || '');
    await gov.fillWordTemplate(template, module, outName);
    gov.log(`✅ 完成: ${outName}`);
}

/**
 * 将 sections 数组转换为树状结构
 * @param {Array} sections - parseWordStructure 返回的 sections 数组
 * @returns {Array} 树状结构数组
 */
function buildTree(sections) {
    if (!sections || !Array.isArray(sections)) return [];

    const tree = [];
    const stack = [{ level: 0, children: tree }];

    for (const section of sections) {
        const node = {
            level: section.level,
            title: section.title,
            content: (section.paragraphs || []).join('\n'),
            paragraphs: section.paragraphs || [],
            children: []
        };

        // 找到合适的父节点
        while (stack.length > 1 && stack[stack.length - 1].level >= section.level) {
            stack.pop();
        }

        // 添加到父节点的 children
        const parent = stack[stack.length - 1];
        if (parent.children) {
            parent.children.push(node);
        }

        // 将当前节点加入栈
        stack.push({ level: section.level, children: node.children });
    }

    return tree;
}

/**
 * 辅助函数：格式化文本
 * @param {string} text - 原始文本
 * @param {Object} options - 格式选项 { bold: boolean, indent: boolean }
 * @returns {string} 格式化后的文本
 */
gov.word = function(text, options = {}) {
    if (!text) return '';

    let result = String(text);

    // 首行缩进
    if (options.indent) {
        result = '>' + result;
    }

    // 加粗
    if (options.bold) {
        result = `**${result}**`;
    }

    return result;
};

await main();

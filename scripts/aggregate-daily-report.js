// 综合日报生成器 v13 - 模块化架构
// 1. 提取模板占位符 → module 字典
// 2. 解析子文档 → jsons 字典 (数组形式，支持 [层级][索引] 访问)
// 3. 用户手动写替换规则
// 4. 一键替换生成最终文档

// ===== 工具函数 =====

function str(v) {
  if (v === undefined || v === null) return '';
  return String(v);
}

// 从模板文本中提取占位符 {xxx}
function extractPlaceholders(text) {
  const matches = text.match(/\{[^}]+\}/g) || [];
  const unique = [...new Set(matches.map(m => m. slice(1, -1)))];
  return unique;
}

// 递归收集节点及所有子节点内容
function collectContent(node, includeTitle = false) {
  const lines = includeTitle ? [node.title] : [];
  lines.push(...(node.paragraphs || []));
  for (const child of (node.children || [])) {
    lines.push(...collectContent(child, true));
  }
  return lines;
}

// 将树形结构转换为数组格式 [层级][索引] = {title, paragraphs, children}
// 便于用 jsons["文档"][0][2] 这种方式访问
function treeToArray(nodes, level = 0, result = {}) {
  if (!result[level]) result[level] = [];
  
  for (const node of nodes) {
    const item = {
      title: node.title || '',
      paragraphs: node.paragraphs || [],
      children: node.children || []
    };
    result[level].push(item);
    
    // 递归处理子节点
    if (node.children && node.children.length > 0) {
      treeToArray(node.children, level + 1, result);
    }
  }
  
  return result;
}

// 格式化内容：子标题加粗，普通段落缩进
function formatContent(text) {
  if (!text) return '';
  return text.split('\n').map(line => {
    if (!line.trim()) return '';
    if (line.startsWith('>') || line.startsWith('**')) return line;
    const isSubTitle = line.length < 30 && /^（[一二三四五六七八九十]+）|^\d+[\.、．：]|^（\d+）/.test(line);
    return isSubTitle ? `**${line}**` : `>${line}`;
  }).filter(l => l).join('\n');
}



// ===== 主流程 =====

async function main() {
  const files = INPUT_FILES;
  if (!files || files.length < 2) {
    gov.log('请上传：1个模板 + 至少1份单位日报');
    gov.log('支持格式：.docx（推荐）、.doc（需先转换）、.wps（需先转换）');
    return;
  }

  // ===== 1. 识别模板和数据文件 =====
  const templatePattern = /模板|template/i;
  const template = files.find(f => templatePattern.test(f.name)) || files[0];
  const unitFiles = files.filter(f => f !== template);

  gov.log(`=== 综合日报生成器 v13 ===`);
  gov.log(`模板: ${template.name}`);
  gov.log(`单位日报: ${unitFiles.length} 份`);
  gov.log('');

  // ===== 2. 检查文件格式 =====
  const validExts = ['.docx'];
  const warnExts = ['.doc', '.wps'];
  
  for (const f of [template, ...unitFiles]) {
    const ext = f.name.toLowerCase().slice(f.name.lastIndexOf('.'));
    if (warnExts.includes(ext)) {
      gov.log(`⚠️  ${f.name}: .doc/.wps 格式兼容性有限，建议先用 Word/ WPS 转换为 .docx`);
    } else if (!validExts.includes(ext)) {
      gov.log(`❌ ${f. name}: 不支持的格式 ${ext}，请上传 .docx 文件`);
      return;
    }
  }

  // ===== 3. 提取模板占位符 =====
  gov.log(`=== 步骤1: 提取模板占位符 ===`);
  const templateText = await gov.readWord(template);
  const placeholders = extractPlaceholders(templateText. value || '');
  
  const module = {};
  for (const p of placeholders) {
    module[p] = '';
  }
  
  gov.log(`发现 ${placeholders.length} 个占位符:`);
  placeholders.forEach(p => gov.log(`  {${p}}`));
  gov.log('');

  // ===== 4. 解析子文档为 JSON (数组格式) =====
  gov.log(`=== 步骤2: 解析子文档 ===`);
  const jsons = {};

  // 按关键词查找文档（比完整文件名更稳定）
  function findJson(keyword) {
    for (const name in jsons) {
      if (name.includes(keyword)) {
        return { name, data: jsons[name] };
      }
    }
    return null;
  }

  // 按关键词查找所有匹配文档
  function findJsons(keyword) {
    const results = [];
    for (const name in jsons) {
      if (name.includes(keyword)) {
        results.push({ name, data: jsons[name] });
      }
    }
    return results;
  }
  
  for (const f of unitFiles) {
    const name = f.name.replace(/\.(docx?|DOCX?)$/i, '');
    gov.log(`解析: ${f.name}`);
    
    try {
      const doc = await gov.parseWordStructure(f);
      const stats = gov.countTree(doc.sections);
      
      gov.log(`  文档标题: ${doc.title || '(未识别)'}`);
      gov.log(`  章节总数: ${stats.total}`);
      gov.log(`  最大层级: ${stats.maxDepth}`);
      
      // 转换为数组格式 [层级][索引] = {title, paragraphs, children}
      // 这样可以: jsons["文档名"][0] 获取 L1 数组
      //          jsons["文档名"][0][0] 获取 L1 第一个节点
      //          jsons["文档名"][0][0].title 获取标题
      //          jsons["文档名"][0][0].paragraphs 获取段落数组
      const jsonArray = treeToArray(doc.sections || []);
      
      jsons[name] = jsonArray;
      gov.log(`  ✓ 已存储到 jsons["${name}"] (层级数: ${Object.keys(jsonArray).length})`);
      
      // 打印各层级节点数量
      for (const [lvl, arr] of Object.entries(jsonArray)) {
        gov.log(`    L${parseInt(lvl)+1}: ${arr.length} 个节点`);
      }
    } catch (e) {
      gov.log(`  ✗ 解析失败: ${e.message}`);
      jsons[name] = { error: e.message };
    }
    gov.log('');
  }

  // ===== 5. 用户替换规则区域 =====
  gov.log(`=== 步骤3: 用户替换规则 ===`);
  gov.log(`请在下方 "用户填写区域" 编写替换规则`);
  gov.log(`可用变量: module, jsons, formatContent`);
  gov.log(`访问示例:`);
  gov.log(`  jsons["单位A日报"][0]         // L1 一级标题数组`);
  gov.log(`  jsons["单位A日报"][0][0]      // L1 第一个节点`);
  gov.log(`  jsons["单位A日报"][0][0].title        // 节点标题`);
  gov.log(`  jsons["单位A日报"][0][0].paragraphs   // 节点段落数组`);
  gov.log('');
  gov.log(`  // 合并多份文档的 L1 内容`);
  gov.log(`  const allContent = Object.values(jsons).flatMap(j => j[0]?.map(n => n.paragraphs.join('\\n')) || []);`);
  gov.log(`  module["overview"] = allContent.join('\\n\\n');`);
  gov.log('');

  // ===== 用户填写区域开始 =====
  // ============================================================
  // 【配置区】可修改以下默认值
  // ============================================================
  const DEFAULT_FONT = '仿宋_GB2312';  // 默认字体
  const DEFAULT_SIZE = 16;              // 默认字号(pt)：16=三号, 18=四号, 22=小二
  
  // ============================================================
  // 【富文本格式说明】可在文字中混排以下格式标记：
  //
  // 1. 加粗：    **要加粗的文字**
  // 2. 字体字号：[f:字体名,字号]文字  例如：[f:黑体,18]黑体18pt
  //              常用字号：16=三号(16pt), 18=四号(18pt), 22=小二(22pt)
  // 3. 首行缩进：>要缩进的文字
  //
  // 【混排示例】
  //   "这是普通文字**这是加粗**也是普通"  → 混合排版
  //   "[f:黑体,18]标题后面是其他文字"      → 黑体18pt会延续到文字结束
  // ============================================================
  //
  // 实际替换规则 - 从单位日报提取内容填充模板
  // 多层级文档结构：一、→ （一）→ 1. → （1）
  
  // 1. 填充基本信息
  module["report_title"] = "**数据治理综合日报**";
  module["report_date"] = "2024年4月12日";
  module["unit_count"] = String(findJsons("日报").length);
  
  // 2. 提取各单位概览（从 L1 "一、工作概述" 的 L2 子节点获取）
  const overviews = [];
  for (const { name, data } of findJsons("日报")) {
    const unitMatch = name.match(/单位([A-Z])/);
    const unitName = unitMatch ? `单位${unitMatch[1]}` : name.replace(/日报|\\.docx/g, '');
    const overviewNode = data[0]?.find(n => n.title?.includes('工作概述'));
    if (overviewNode) {
      const contents = [];
      // 从 L2 子节点提取内容
      for (const l2 of (overviewNode.children || [])) {
        if (l2.paragraphs?.length > 0) {
          contents.push(...l2.paragraphs);
        }
      }
      if (contents.length > 0) {
        overviews.push(`**${unitName}：**${contents.join('；')}`);
      }
    }
  }
  module["overview"] = overviews.join('\n\n');
  
  // 3. 提取重点项目（按项目类型分组，合并各单位内容）
  // 文档结构：二、重点项目 → （一）在建项目 → 1.数据治理平台 → 内容
  const projectSections = {};  // { "在建项目": { "数据治理平台": ["单位A：xxx", "单位B：yyy"] } }
  
  for (const { name, data } of findJsons("日报")) {
    const unitMatch = name.match(/单位([A-Z])/);
    const unitName = unitMatch ? `单位${unitMatch[1]}` : name.replace(/日报|\\.docx/g, '');
    
    // 找 L1 中包含"项目"的节点
    const projectNode = data[0]?.find(n => n.title?.includes('项目'));
    if (!projectNode) continue;
    
    // 遍历 L2 子节点（如"（一）在建项目"）
    for (const l2 of (projectNode.children || [])) {
      const sectionTitle = l2.title?.replace(/^[（(][一二三四五六七八九十]+[)）]\\s*/, '') || l2.title || '其他';
      if (!projectSections[sectionTitle]) {
        projectSections[sectionTitle] = {};
      }
      
      // 遍历 L3 子节点（如"1.数据治理平台"）
      for (const l3 of (l2.children || [])) {
        const projectTitle = l3.title?.replace(/^\\d+[\\.、．：:]\\s*/, '') || l3.title || '其他项目';
        if (!projectSections[sectionTitle][projectTitle]) {
          projectSections[sectionTitle][projectTitle] = [];
        }
        
        // 收集内容
        const content = l3.paragraphs?.join('；') || '';
        if (content) {
          projectSections[sectionTitle][projectTitle].push(`${unitName}：${content}`);
        }
      }
      
      // L2 自己的段落（如"下月计划启动：移动端适配项目"）
      if (l2.paragraphs?.length > 0) {
        const l2Content = l2.paragraphs.join('；');
        if (!projectSections[sectionTitle]['_summary']) {
          projectSections[sectionTitle]['_summary'] = [];
        }
        projectSections[sectionTitle]['_summary'].push(`${unitName}：${l2Content}`);
      }
    }
    
    // L1 的段落
    if (projectNode.paragraphs?.length > 0) {
      if (!projectSections['_overview']) {
        projectSections['_overview'] = [];
      }
      projectSections['_overview'].push(...projectNode.paragraphs);
    }
  }
  
  // 格式化输出
  const projectLines = [];
  for (const [section, projects] of Object.entries(projectSections)) {
    if (section === '_overview') {
      projectLines.push(...projects);
      continue;
    }
    
    projectLines.push(`**（${section}）**`);
    for (const [project, contents] of Object.entries(projects)) {
      if (project === '_summary') {
        // L2 级别的汇总内容
        for (const c of contents) {
          projectLines.push(`>${c}`);
        }
      } else {
        // L3 级别的项目内容
        projectLines.push(`**${project}**`);
        for (const c of contents) {
          projectLines.push(`>${c}`);
        }
      }
    }
  }
  module["key_projects"] = projectLines.join('\\n') || '暂无重点项目信息';
  
  // 4. 提取风险信息（按风险类型分组，合并各单位内容）
  const riskSections = {};
  
  for (const { name, data } of findJsons("日报")) {
    const unitMatch = name.match(/单位([A-Z])/);
    const unitName = unitMatch ? `单位${unitMatch[1]}` : name.replace(/日报|\\.docx/g, '');
    
    // 找 L1 中包含"风险"或"问题"的节点
    const riskNode = data[0]?.find(n => n.title?.includes('风险') || n.title?.includes('问题'));
    if (!riskNode) continue;
    
    // 遍历 L2 子节点
    for (const l2 of (riskNode.children || [])) {
      const sectionTitle = l2.title?.replace(/^[（(][一二三四五六七八九十]+[)）]\\s*/, '') || l2.title || '其他';
      if (!riskSections[sectionTitle]) {
        riskSections[sectionTitle] = {};
      }
      
      // 遍历 L3 子节点
      for (const l3 of (l2.children || [])) {
        const riskTitle = l3.title?.replace(/^\\d+[\\.、．：:]\\s*/, '') || l3.title || '其他风险';
        if (!riskSections[sectionTitle][riskTitle]) {
          riskSections[sectionTitle][riskTitle] = [];
        }
        
        const content = l3.paragraphs?.join('；') || '';
        if (content) {
          riskSections[sectionTitle][riskTitle].push(`${unitName}：${content}`);
        }
      }
      
      // L2 自己的段落
      if (l2.paragraphs?.length > 0) {
        const l2Content = l2.paragraphs.join('；');
        if (!riskSections[sectionTitle]['_summary']) {
          riskSections[sectionTitle]['_summary'] = [];
        }
        riskSections[sectionTitle]['_summary'].push(`${unitName}：${l2Content}`);
      }
    }
    
    // L1 的段落
    if (riskNode.paragraphs?.length > 0) {
      if (!riskSections['_overview']) {
        riskSections['_overview'] = [];
      }
      riskSections['_overview'].push(...riskNode.paragraphs);
    }
  }
  
  // 格式化输出
  const riskLines = [];
  for (const [section, risks] of Object.entries(riskSections)) {
    if (section === '_overview') {
      riskLines.push(...risks);
      continue;
    }
    
    riskLines.push(`**（${section}）**`);
    for (const [risk, contents] of Object.entries(risks)) {
      if (risk === '_summary') {
        for (const c of contents) {
          riskLines.push(`>${c}`);
        }
      } else {
        riskLines.push(`**${risk}**`);
        for (const c of contents) {
          riskLines.push(`>${c}`);
        }
      }
    }
  }
  module["risk_detail"] = riskLines.join('\\n') || '暂无风险信息';
  
  // 5. 提取明日计划（按计划类型分组，合并各单位内容）
  const planSections = {};
  
  for (const { name, data } of findJsons("日报")) {
    const unitMatch = name.match(/单位([A-Z])/);
    const unitName = unitMatch ? `单位${unitMatch[1]}` : name.replace(/日报|\\.docx/g, '');
    
    // 找 L1 中包含"计划"的节点
    const planNode = data[0]?.find(n => n.title?.includes('计划'));
    if (!planNode) continue;
    
    // 遍历 L2 子节点
    for (const l2 of (planNode.children || [])) {
      const sectionTitle = l2.title?.replace(/^[（(][一二三四五六七八九十]+[)）]\\s*/, '') || l2.title || '其他';
      if (!planSections[sectionTitle]) {
        planSections[sectionTitle] = {};
      }
      
      // 遍历 L3 子节点
      for (const l3 of (l2.children || [])) {
        const planTitle = l3.title?.replace(/^\\d+[\\.、．：:]\\s*/, '') || l3.title || '其他计划';
        if (!planSections[sectionTitle][planTitle]) {
          planSections[sectionTitle][planTitle] = [];
        }
        
        const content = l3.paragraphs?.join('；') || '';
        if (content) {
          planSections[sectionTitle][planTitle].push(`${unitName}：${content}`);
        }
      }
      
      // L2 自己的段落
      if (l2.paragraphs?.length > 0) {
        const l2Content = l2.paragraphs.join('；');
        if (!planSections[sectionTitle]['_summary']) {
          planSections[sectionTitle]['_summary'] = [];
        }
        planSections[sectionTitle]['_summary'].push(`${unitName}：${l2Content}`);
      }
    }
    
    // L1 的段落
    if (planNode.paragraphs?.length > 0) {
      if (!planSections['_overview']) {
        planSections['_overview'] = [];
      }
      planSections['_overview'].push(...planNode.paragraphs);
    }
  }
  
  // 格式化输出
  const planLines = [];
  for (const [section, plans] of Object.entries(planSections)) {
    if (section === '_overview') {
      planLines.push(...plans);
      continue;
    }
    
    planLines.push(`**（${section}）**`);
    for (const [plan, contents] of Object.entries(plans)) {
      if (plan === '_summary') {
        for (const c of contents) {
          planLines.push(`>${c}`);
        }
      } else {
        planLines.push(`**${plan}**`);
        for (const c of contents) {
          planLines.push(`>${c}`);
        }
      }
    }
  }
  module["tomorrow_plan"] = planLines.join('\\n') || '暂无明日计划';
  
  gov.log('=== 替换规则执行完成 ===');
  gov.log(`已填充 ${Object.keys(module).filter(k => module[k]).length} 个占位符`);
  gov.log(`处理了 ${findJsons('日报').length} 个单位的多层级内容`);
  
  // ===== 用户填写区域结束 =====




  // ===== 6. 检查占位符是否已填充 =====
  gov.log(`=== 步骤4: 检查占位符 ===`);
  
  // 已知的模板未使用占位符（用户可能上传了旧模板）
  const knownUnused = ['risk_items', 'risk_item', 'units', 'unit_name', 'unit_report_date', 'unit_overview', 'unit_key_projects', 'unit_risks', 'unit_tomorrow'];
  const unfilled = Object.entries(module).filter(([k, v]) => !v && !knownUnused.includes(k)).map(([k]) => k);
  
  if (unfilled.length > 0) {
    gov.log(`⚠️  以下占位符未填充，Word 中将显示为空:`);
    unfilled.forEach(k => gov.log(`  {${k}}`));
    gov.log('');
  } else {
    gov.log(`✓ 所有占位符已填充`);
  }

  // ===== 7. 生成最终文档 =====
  gov.log(`=== 步骤5: 生成最终文档 ===`);
  
  // 使用用户配置的默认字体
  const defaultFont = { name: DEFAULT_FONT, size: DEFAULT_SIZE };
  
  const data = {};
  for (const [k, v] of Object.entries(module)) {
    data[k] = v;
  }
  
  const dateStr = new Date().toISOString().slice(0, 10);
  const outName = `综合日报_${dateStr}.docx`;
  
  try {
    await gov.fillWordTemplate(template, data, outName, defaultFont);
    gov.log(`✓ 完成: ${outName}`);
  } catch (e) {
    gov.log(`✗ 生成失败: ${e.message}`);
  }
}

await main();
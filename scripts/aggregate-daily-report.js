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
  // 
  // 在此编写替换规则，例如:
  //
  // // 示例1: 直接赋值
  // module["report_title"] = "数据治理综合日报";
  // module["report_date"] = "2024年4月12日";
  //
  // // 示例2: 格式标记（v14 新增）
  // // **文字** 加粗，支持混排
  // module["title"] = "**重要通知**";
  // module["overview"] = "**工作进展：**已完成数据采集，共处理 **1200 万条**数据。";
  //
  // // [f:字体,s:字号] 指定字体字号
  // module["header"] = "[f:黑体,s:18]关于XX工作的报告";
  // module["key_point"] = "**[f:黑体,s:16]重点项目：**[f:楷体,s:14]已完成一期建设";
  //
  // // >文字 首行缩进
  // module["content"] = ">**摘要：**本项目已完成全部既定目标...";
  //
  // // 示例3: 从 jsons 提取内容
  // const unitA = jsons["单位A日报"];
  // if (unitA && unitA[0]) {
  //   // 合并 L1 所有节点的段落
  //   const overview = unitA[0].map(n => n.paragraphs.join('\n')).join('\n\n');
  //   module["overview"] = formatContent(overview);
  // }
  //
  // // 示例4: 合并多份文档
  // const allRisks = [];
  // for (const name in jsons) {
  //   const doc = jsons[name];
  //   // 查找"风险"相关标题的节点
  //   const riskNodes = doc[0]?.filter(n => n.title.includes('风险') || n.title.includes('问题')) || [];
  //   for (const n of riskNodes) {
  //     allRisks.push(...n.paragraphs);
  //   }
  // }
  // module["risks"] = formatContent(allRisks.join('\n'));
  //
  // // 示例5: 提取特定索引的内容
  // module["summary"] = jsons["单位A日报"][0][1]?.paragraphs[0] || '无';
  //
  // // 示例6: 设置全局默认字体（仿宋三号）
  // // await gov.fillWordTemplate(template, data, outName, { name: '仿宋_GB2312', size: 16 });
  //
  // ===== 用户填写区域结束 =====

  // ===== 6. 检查占位符是否已填充 =====
  gov.log(`=== 步骤4: 检查占位符 ===`);
  const unfilled = Object.entries(module).filter(([k, v]) => !v).map(([k]) => k);
  
  if (unfilled.length > 0) {
    gov.log(`⚠️  以下占位符未填充，Word 中将显示为空:`);
    unfilled.forEach(k => gov.log(`  {${k}}`));
    gov.log('');
  } else {
    gov.log(`✓ 所有占位符已填充`);
  }

  // ===== 7. 生成最终文档 =====
  gov.log(`=== 步骤5: 生成最终文档 ===`);
  
  const data = {};
  for (const [k, v] of Object.entries(module)) {
    data[k] = v;
  }
  
  const dateStr = new Date().toISOString().slice(0, 10);
  const outName = `综合日报_${dateStr}.docx`;
  
  try {
    await gov.fillWordTemplate(template, data, outName);
    gov.log(`✓ 完成: ${outName}`);
  } catch (e) {
    gov.log(`✗ 生成失败: ${e.message}`);
  }
}

await main();
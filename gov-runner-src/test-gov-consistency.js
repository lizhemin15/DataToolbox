/**
 * 前后端一致性测试
 * 测试 gov-shared 函数在浏览器和 Bun 环境下的结果是否一致
 */

import * as XLSX from 'xlsx';

// 模拟 gov-shared 函数（后端版本）
function govParseFilename(name, options = {}) {
  if (!name || typeof name !== 'string') return { unit: '', date: '' };
  
  const base = name.replace(/\.(docx?|DOCX?)$/i, '');
  const datePattern = options.datePattern || /^(\d{4})年(\d{1,2})月(\d{1,2})日/;
  const m = base.match(datePattern);
  
  if (m) {
    return {
      unit: base.replace(datePattern, '').replace(/日报$/, '').trim() || base,
      date: `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日`
    };
  }
  
  const m2 = base.match(/^(\d{1,2})月(\d{1,2})日/);
  if (m2) {
    return {
      unit: base.replace(/^(\d{1,2})月(\d{1,2})日/, '').replace(/日报$/, '').trim() || base,
      date: `${parseInt(m2[1])}月${parseInt(m2[2])}日`
    };
  }
  
  return {
    unit: base.replace(/日报$/, '').trim() || base,
    date: ''
  };
}

function govParseWordStructure(text, options = {}) {
  const maxLen = options.maxTextLength || 50000;
  const truncatedText = text.length > maxLen ? text.slice(0, maxLen) : text;
  
  const titlePatterns = [
    /^[一二三四五六七八九十]+、[^\n]+/,
    /^（[一二三四五六七八九十]+）[^\n]+/,
    /^\d+[\.、．：][^\n]+/,
    /^（\d+）[^\n]+/,
    /^[（\(][一二三四五六七八九十\d]+[）\)][^\n]+/,
    /^第[一二三四五六七八九十\d]+章[^\n]*/,
    /^第[一二三四五六七八九十\d]+条[^\n]*/,
    /^[•●○◆■★][\s　][^\n]+/,
    /^[\u25A0\u25B2\u25CB\u25CF][\s　][^\n]+/,
    /^[\d]+\.[\s　]+[^\n]+/,
    /^[\\(（]?[a-zA-Z0-9]+[\\)）]?[\.、：\s　]+[^\n]+/
  ];
  
  const lines = truncatedText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const sections = [];
  let current = null;
  let title = '';
  
  // 提取标题（前10行非标题行）
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i];
    if (line && line.length > 2 && line.length < 100) {
      let isTitle = false;
      for (const p of titlePatterns) {
        if (p.test(line)) {
          isTitle = true;
          break;
        }
      }
      if (!isTitle) {
        title = line;
        break;
      }
    }
  }
  
  for (const line of lines) {
    if (!line) continue;
    
    // 一级标题
    let m = line.match(/^([一二三四五六七八九十]+)、(.*)$/);
    if (m) {
      if (current) sections.push(current);
      current = { level: 1, title: `${m[1]}、${(m[2] || '').trim()}`.trim(), paragraphs: [] };
      continue;
    }
    
    // 二级标题
    m = line.match(/^（([一二三四五六七八九十]+)）(.*)$/);
    if (m) {
      if (current) sections.push(current);
      current = { level: 2, title: `（${m[1]}）${(m[2] || '').trim()}`.trim(), paragraphs: [] };
      continue;
    }
    
    // 三级标题
    m = line.match(/^(\d+)([\.、．])(.*)$/);
    if (m) {
      if (current) sections.push(current);
      current = { level: 3, title: `${m[1]}${m[2]}${(m[3] || '').trim()}`.trim(), paragraphs: [] };
      continue;
    }
    
    // 四级标题
    m = line.match(/^（(\d+)）(.*)$/);
    if (m) {
      if (current) sections.push(current);
      current = { level: 4, title: `（${m[1]}）${(m[2] || '').trim()}`.trim(), paragraphs: [] };
      continue;
    }
    
    if (current) current.paragraphs.push(line);
  }
  
  if (current) sections.push(current);
  
  return { title, sections, tables: [], rawText: truncatedText };
}

function govCsvEscapeCell(val) {
  const s = val === null || val === undefined ? '' : String(val);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// 测试用例
console.log('========== 测试 1: 文件名解析 ==========');
const testCases1 = [
  '2024年4月12日单位A日报.docx',
  '5月10日运输情况通报.docx',
  '国际新闻与运输情况通报.docx',
  '19990101_国际新闻与运输情况通报_模拟数据.docx'
];

for (const name of testCases1) {
  const result = govParseFilename(name);
  console.log(`输入: ${name}`);
  console.log(`结果: unit="${result.unit}", date="${result.date}"`);
  console.log('---');
}

console.log('\n========== 测试 2: Word 结构解析 ==========');
const testText = `单位A日报

一、工作情况
今日完成各项工作任务。

（一）重点项目
1. 项目A进展顺利
2. 项目B遇到困难

（二）常规工作
（1）日常巡检
（2）数据整理

二、存在问题
部分设备需要维护。`;

const result2 = govParseWordStructure(testText);
console.log(`标题: ${result2.title}`);
console.log(`章节数: ${result2.sections.length}`);
for (const s of result2.sections) {
  console.log(`  Level ${s.level}: ${s.title} (${s.paragraphs.length} paragraphs)`);
}

console.log('\n========== 测试 3: CSV 转义 ==========');
const testCases3 = [
  '普通文本',
  '包含"引号"的文本',
  '包含,逗号的文本',
  '包含\n换行的文本',
  '包含"引号,逗号\n换行的复杂文本'
];

for (const val of testCases3) {
  const escaped = govCsvEscapeCell(val);
  console.log(`输入: ${JSON.stringify(val)}`);
  console.log(`转义: ${escaped}`);
  console.log('---');
}

console.log('\n========== 测试 4: Excel 数据处理 ==========');
// 创建测试 Excel
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ['姓名', '年龄', '部门'],
  ['张三', 25, '技术部'],
  ['李四', 30, '市场部'],
  ['王五', 28, '财务部']
]);
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

// 测试读取
const data = XLSX.utils.sheet_to_json(ws);
console.log('Excel 数据:');
console.log(JSON.stringify(data, null, 2));

console.log('\n========== 测试完成 ==========');

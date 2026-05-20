/**
 * 测试数据入库功能
 * 模拟前端和后端的数据处理流程
 */

import * as XLSX from 'xlsx';

console.log('========== 测试场景：Excel 数据入库 ==========\n');

// 场景1：读取 Excel 并生成 INSERT SQL
console.log('场景1: Excel 转 SQL INSERT');
console.log('---');

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ['id', 'name', 'age', 'department'],
  [1, '张三', 25, '技术部'],
  [2, '李四', 30, '市场部'],
  [3, '王五', 28, '财务部']
]);
XLSX.utils.book_append_sheet(wb, ws, 'employees');

const data = XLSX.utils.sheet_to_json(ws);
console.log('Excel 数据:');
console.log(JSON.stringify(data, null, 2));

// 生成 SQL
const tableName = 'employees';
for (const row of data) {
  const columns = Object.keys(row).join(', ');
  const values = Object.values(row).map(v => {
    if (typeof v === 'string') return `'${v}'`;
    return v;
  }).join(', ');
  const sql = `INSERT INTO ${tableName} (${columns}) VALUES (${values});`;
  console.log(sql);
}

console.log('\n---\n');

// 场景2：CSV 数据入库
console.log('场景2: CSV 转 SQL INSERT');
console.log('---');

const csvText = `id,product,quantity,price
1,苹果,100,5.5
2,香蕉,200,3.2
3,橙子,150,4.8`;

const lines = csvText.split('\n');
const headers = lines[0].split(',');
console.log('CSV 列:', headers);

for (let i = 1; i < lines.length; i++) {
  const values = lines[i].split(',');
  const row = {};
  headers.forEach((h, idx) => row[h] = values[idx]);
  
  const columns = Object.keys(row).join(', ');
  const vals = Object.values(row).map(v => {
    const num = parseFloat(v);
    if (!isNaN(num)) return num;
    return `'${v}'`;
  }).join(', ');
  
  const sql = `INSERT INTO products (${columns}) VALUES (${vals});`;
  console.log(sql);
}

console.log('\n---\n');

// 场景3：Word 文档结构提取（用于日报入库）
console.log('场景3: Word 结构提取');
console.log('---');

const wordText = `单位A日报

一、工作情况
今日完成各项工作任务，处理了3个紧急问题。

（一）重点项目
1. 项目A进展顺利，完成度80%
2. 项目B遇到技术难题，需要协调资源

（二）常规工作
（1）完成日常巡检，发现2处隐患
（2）整理上周数据，生成报表

二、存在问题
部分设备老化，需要更换。

三、明日计划
继续推进重点项目，协调资源解决问题。`;

// 简化版解析（模拟 govParseWordStructure）
function parseWordStructure(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const result = { title: '', sections: [] };
  
  // 提取标题
  for (const line of lines) {
    if (line.length > 2 && line.length < 50 && !line.match(/^[一二三四五六七八九十]+、/)) {
      result.title = line;
      break;
    }
  }
  
  // 提取章节
  let current = null;
  for (const line of lines) {
    const m1 = line.match(/^([一二三四五六七八九十]+)、(.*)$/);
    if (m1) {
      if (current) result.sections.push(current);
      current = { level: 1, title: line, content: '' };
      continue;
    }
    
    const m2 = line.match(/^（([一二三四五六七八九十]+)）(.*)$/);
    if (m2) {
      if (current) result.sections.push(current);
      current = { level: 2, title: line, content: '' };
      continue;
    }
    
    const m3 = line.match(/^(\d+)\.(.*)$/);
    if (m3) {
      if (current) result.sections.push(current);
      current = { level: 3, title: line, content: '' };
      continue;
    }
    
    if (current) {
      current.content += (current.content ? ' ' : '') + line;
    }
  }
  if (current) result.sections.push(current);
  
  return result;
}

const parsed = parseWordStructure(wordText);
console.log(`标题: ${parsed.title}`);
console.log(`章节数: ${parsed.sections.length}`);

// 生成入库 SQL
console.log('\n生成日报入库 SQL:');
const insertSQL = `INSERT INTO daily_reports (unit, date, title, content, created_at) 
VALUES ('单位A', '2024-04-12', '${parsed.title}', '${wordText.replace(/'/g, "''")}', NOW());`;
console.log(insertSQL);

// 提取关键信息入库
console.log('\n提取关键信息入库:');
for (const section of parsed.sections) {
  if (section.level === 1) {
    const sql = `INSERT INTO report_sections (report_id, level, title, content) 
VALUES (1, ${section.level}, '${section.title}', '${section.content.replace(/'/g, "''")}');`;
    console.log(sql);
  }
}

console.log('\n========== 测试完成 ==========');

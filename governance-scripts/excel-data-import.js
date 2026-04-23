// Excel 数据解析预览 + 入「当前关联的单个库」的指定表

const workbook = await gov.readExcel(INPUT_FILE);
const sheetName = workbook.SheetNames[0];
const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
const headers = data[0];
const rows = data.slice(1);

gov.log(`工作表: ${sheetName}`);
gov.log(`总行数: ${rows.length}, 列数: ${headers.length}`);
gov.log(`表头: ${headers.join(', ')}`);

gov.log('
--- 数据预览 (前5行) ---');
for (let i = 0; i < Math.min(5, rows.length); i++) {
    gov.log(`  行${i + 1}: ${rows[i].join(' | ')}`);
}

const tableName = 'your_table';
const insertCols = ['col1', 'col2', 'col3'];
let n = 0;
try {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    await gov.executeSQL(`INSERT INTO ${tableName} (${insertCols.join(',')}) VALUES (?,?,?)`, [row[0], row[1], row[2] ?? null]);
    n++;
  }
  gov.log(`
入库完成: ${tableName} 写入 ${n} 行`);
} catch (e) {
  gov.log('
入库失败: ' + e.message);
  gov.log('请编辑任务：1) 关联一个数据库 2) 修改上面 tableName、insertCols 与列数');
}

// 定时任务：检查各表的数据完整性（支持 MySQL / 达梦等）
const dbType = gov.getDbType();
let tableList = [];
if (dbType === 'dm') {
  const rows = await gov.querySQL("SELECT NAME FROM SYSOBJECTS WHERE TYPE$='SCHOBJ' AND SUBTYPE$='UTAB' AND PID=-1");
  tableList = rows.map(r => r.NAME != null ? r.NAME : r.name).filter(t => { const n = String(t); return !n.startsWith('##') && !n.startsWith('AQ$_') && !n.startsWith('SYS$') && !n.startsWith('DBMS_') && !n.startsWith('REG$') && n !== 'POLICIES' && !n.startsWith('POLICY_'); });
} else {
  const rows = await gov.querySQL('SHOW TABLES');
  tableList = rows.map(r => Object.values(r)[0]);
}
const q = (t) => { if (dbType === 'oracle') return '"' + String(t).replace(/"/g, '""') + '"'; if (dbType === 'dm') return String(t); if (dbType === 'mysql' || dbType === 'mariadb' || dbType === 'tidb') return '`' + String(t).replace(/`/g, '``') + '`'; return t; };
const now = new Date().toLocaleString();
gov.log(`数据完整性检查报告 - ${now}`);
gov.log('='.repeat(50));
for (const tableName of tableList) {
  gov.log(`
[${tableName}]`);
  let columns = [];
  if (dbType === 'dm') {
    const rows = await gov.querySQL(`SELECT COLUMN_NAME, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '${String(tableName).replace(/'/g, "''").toUpperCase()}' ORDER BY COLUMN_ID`);
    columns = rows.map(r => ({ name: r.COLUMN_NAME ?? r.column_name, nullable: (r.NULLABLE ?? r.nullable) === 'Y' }));
  } else {
    const rows = await gov.querySQL(`SHOW COLUMNS FROM ${q(tableName)}`);
    columns = rows.map(r => ({ name: r.Field, nullable: r.Null === 'YES' }));
  }
  const countResult = await gov.querySQL(`SELECT COUNT(*) as cnt FROM ${q(tableName)}`);
  const totalCnt = countResult && countResult[0] ? (countResult[0].cnt ?? countResult[0].CNT ?? 0) : 0;
  for (const col of columns) {
    if (col.nullable) {
      const colQ = q(col.name);
      const nullResult = await gov.querySQL(`SELECT COUNT(*) as cnt FROM ${q(tableName)} WHERE ${colQ} IS NULL`);
      const n = nullResult && nullResult[0] ? (nullResult[0].cnt ?? nullResult[0].CNT ?? 0) : 0;
      if (n > 0) gov.log(`  ⚠ ${col.name}: ${n} 个空值`);
    }
  }
  gov.log(`  总行数: ${totalCnt}, 列数: ${columns.length}`);
}
gov.log('='.repeat(50));
gov.log('检查完成');

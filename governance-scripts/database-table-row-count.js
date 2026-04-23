// 定时任务：统计数据库所有表的行数（支持 MySQL / 达梦等）
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
gov.log('='.repeat(40));
gov.log(`共 ${tableList.length} 张表`);
gov.log('='.repeat(40));
for (const tableName of tableList) {
  const result = await gov.querySQL(`SELECT COUNT(*) as cnt FROM ${q(tableName)}`);
  const cnt = result && result[0] ? (result[0].cnt ?? result[0].CNT ?? 0) : 0;
  gov.log(`  ${String(tableName).padEnd(30)} ${cnt} 行`);
}
gov.log('='.repeat(40));
gov.log('统计完成');

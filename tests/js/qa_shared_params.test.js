#!/usr/bin/env node
/**
 * 规则导入「参数」列的解析回归测试。
 * 运行：node tests/js/qa_shared_params.test.js
 */
const path = require('path');
require(path.join(__dirname, '..', '..', 'qa-shared.js'));
const S = globalThis.QA_SHARED;

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failed++;
    console.error(`✗ ${name}\n   实际: ${a}\n   期望: ${e}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

// 1) Excel 粘贴（引号被 TSV 解析吞掉）→ 仍能解析出参数
const pasted = S.parseExcelPasteRules(
  '010100\t0101\t主键非空检查\tSELECT * FROM {{表名}} WHERE {{字段名}} IS NULL\t完整性\t{"表名":"T_ORDER","字段名":"ORDER_ID"}'
);
check('Excel 粘贴：参数解析', pasted[0].params, { 表名: 'T_ORDER', 字段名: 'ORDER_ID' });
check('Excel 粘贴：SQL 保留占位符', pasted[0].sql, 'SELECT * FROM {{表名}} WHERE {{字段名}} IS NULL');

// 2) 键值写法
check('kv 分号', S.parseRuleParamsCell('表名=T_USER;字段名=USER_ID'), { 表名: 'T_USER', 字段名: 'USER_ID' });
check('kv 冒号', S.parseRuleParamsCell('表名:T;字段名:C'), { 表名: 'T', 字段名: 'C' });

// 3) 标准 JSON
check('标准 JSON', S.parseRuleParamsCell('{"表名":"T","字段名":"C"}'), { 表名: 'T', 字段名: 'C' });

// 4) 空值 / 无参数列
check('空字符串', S.parseRuleParamsCell(''), {});
check('null', S.parseRuleParamsCell(null), {});
check('无参数列', S.parseExcelPasteRules('010300\t0103\t普通规则\tSELECT COUNT(*) FROM T\t基础校验')[0].params, {});

// 5) 表头行被过滤
const withHeader = S.parseExcelPasteRules('NM\tXH\t名称\tSQL\t类别\t参数\n010400\t0104\tX\tSELECT 1 FROM T\t\t');
check('表头行过滤', withHeader.map(r => r.nm), ['010400']);

// 6) 多行 SQL 续行不应丢掉参数
const multi = S.mergeRuleContinuationRows([
  ['010500', '0105', '多行规则', 'SELECT *\nFROM {{表名}}', '完整性', '表名=T'],
]);
check('续行：参数保留', multi[0].params, { 表名: 'T' });

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/**
 * 填报率粘贴导入解析回归测试。
 *
 * 背景：记录填报率按整表统计，界面上不再有「字段名」列，
 * 因此粘贴列顺序变成 表名/分子/分母；但用户从旧表格复制的 4 列
 * （表名/字段名/分子/分母）也要能正确落位，不能把字段名当成分子。
 *
 * 运行：node tests/js/qa_fill_rates.test.js
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

// 1) 项填报率（默认）：表名 / 字段名 / 分子 / 分母
const item = S.parseExcelPasteFillRates('T_USER\tPHONE\tSELECT 1\tSELECT 2');
check('项填报率：4 列解析', item, [
  { table_name: 'T_USER', field_name: 'PHONE', numerator: 'SELECT 1', denominator: 'SELECT 2' },
]);

// 2) 项填报率：3 列（无字段名）→ 分子/分母 落位
const item3 = S.parseExcelPasteFillRates('T_USER\tSELECT 1\tSELECT 2');
check('项填报率：3 列解析', item3, [
  { table_name: 'T_USER', field_name: '', numerator: 'SELECT 1', denominator: 'SELECT 2' },
]);

// 3) 记录填报率：表名 / 分子 / 分母
const rec = S.parseExcelPasteFillRates('T_DETAIL\tSELECT COUNT(*) FROM T_DETAIL\tSELECT 1', false);
check('记录填报率：3 列解析', rec, [
  { table_name: 'T_DETAIL', field_name: '', numerator: 'SELECT COUNT(*) FROM T_DETAIL', denominator: 'SELECT 1' },
]);

// 4) 记录填报率：用户仍按旧的 4 列粘贴 → 字段名列被忽略，不能串位
const rec4 = S.parseExcelPasteFillRates('T_DETAIL\t该列应被忽略\tSELECT COUNT(*) FROM T_DETAIL\tSELECT 1', false);
check('记录填报率：旧 4 列粘贴忽略字段列', rec4, [
  { table_name: 'T_DETAIL', field_name: '', numerator: 'SELECT COUNT(*) FROM T_DETAIL', denominator: 'SELECT 1' },
]);

// 5) 记录填报率：多行 + 表头行过滤 + 续行合并
const recMulti = S.parseExcelPasteFillRates('表名\t分子\t分母\nT_A\tSELECT 1\tSELECT 2\nT_B\tSELECT 3\tSELECT 4', false);
check('记录填报率：表头过滤 + 多行', recMulti, [
  { table_name: 'T_A', field_name: '', numerator: 'SELECT 1', denominator: 'SELECT 2' },
  { table_name: 'T_B', field_name: '', numerator: 'SELECT 3', denominator: 'SELECT 4' },
]);

process.exit(failed ? 1 : 0);

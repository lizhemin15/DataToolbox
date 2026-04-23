// CSV 文本解析预览

const result = Papa.parse(INPUT_TEXT, { header: true });

gov.log(`列数: ${result.meta.fields.length}`);
gov.log(`表头: ${result.meta.fields.join(', ')}`);
gov.log(`数据行数: ${result.data.length}`);

gov.log('
--- 数据预览 (前5行) ---');
for (let i = 0; i < Math.min(5, result.data.length); i++) {
    const row = result.data[i];
    gov.log(`行 ${i + 1}: ${Object.values(row).join(' | ')}`);
}
gov.log(`
提示: 使用"入库代码生成助手"可快速生成入库代码`);

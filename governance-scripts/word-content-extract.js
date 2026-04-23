// 1. 读取 Word 得到非结构化文本
const result = await gov.readWord(INPUT_FILE);
const rawText = result.value || '';
gov.log('Word 原文长度: ' + rawText.length + ' 字符');
if (result.messages && result.messages.length > 0) {
  result.messages.forEach(m => gov.log(`  ${m.type}: ${m.message}`));
}

// 2. 使用 AI（与 AI 助手相同的 API URL / API Key / Model）将非结构化文本整理为结构化数据
const prompt = `你是一个文本结构化助手。请将下面从 Word 文档提取的非结构化文本，整理为结构化数据。
要求：只输出一个 JSON 数组，每项为对象，包含字段 title（标题）、summary（摘要）、content（对应段落或条目的正文）。若原文无明确标题/摘要，可据内容归纳。不要输出任何 markdown 或解释，仅输出 JSON 数组。

原文：
${rawText.slice(0, 6000)}`;

let structured = [];
try {
  const aiText = await gov.callAI(prompt);
  const jsonMatch = aiText.match(/\[([\s\S]*)\]/);
  const jsonStr = jsonMatch ? '[' + jsonMatch[1] + ']' : aiText;
  structured = JSON.parse(jsonStr);
  gov.log('AI 结构化得到 ' + structured.length + ' 条');
} catch (e) {
  gov.log('AI 结构化失败: ' + e.message);
  gov.log('原文前 500 字: ' + rawText.slice(0, 500));
}

// 3. 若关联了数据库，则写入表（请按实际表结构修改表名和列）
const tableName = 'doc_extracts';
const dbType = gov.getDbType();
if (structured.length > 0 && dbType) {
  let n = 0;
  for (const row of structured) {
    try {
      await gov.executeSQL(
        'INSERT INTO ' + tableName + ' (title, summary, content) VALUES (?, ?, ?)',
        [row.title || '', row.summary || '', row.content || '']
      );
      n++;
    } catch (e) {
      gov.log('写入失败: ' + e.message);
    }
  }
  gov.log('入库完成: ' + tableName + ' 写入 ' + n + ' 条');
} else if (structured.length > 0) {
  gov.log('未关联数据库，仅展示结构化结果（关联数据库后可自动入库）');
  structured.slice(0, 5).forEach((r, i) => gov.log(`  [${i+1}] ${(r.title || '').slice(0, 30)}`));
}
gov.log('文档处理完成');

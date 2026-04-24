# gov API 参考文档

## 概述

`gov` 对象是 DataToolbox 平台提供的核心 API 对象，用于在数据处理任务中执行各种操作。它提供了统一的接口来处理日志输出、文件读写、数据库操作和 AI 调用等功能。

**使用场景：**
- 数据导入导出（Excel、CSV、Word、JSON 等）
- 数据库查询与写入
- AI 辅助数据处理
- 任务执行日志记录
- 跨数据库数据同步

**典型用法：**
```javascript
// 在数据处理脚本中直接使用 gov 对象
const rows = await gov.querySQL('SELECT * FROM users LIMIT 10');
gov.showTable(rows);
gov.writeExcel('导出数据.xlsx', rows);
```

---

## 目录

- [日志输出](#日志输出)
  - [gov.log](#govlog)
  - [gov.showTable](#govshowtable)
- [文件读取](#文件读取)
  - [gov.readExcel](#govreadexcel)
  - [gov.readCSV](#govreadcsv)
  - [gov.readWord](#govreadword)
- [文件写入](#文件写入)
  - [gov.writeExcel](#govwriteexcel)
  - [gov.writeCSV](#govwritecsv)
  - [gov.writeText](#govwritetext)
  - [gov.writeJSON](#govwritejson)
- [模板填充](#模板填充)
  - [gov.fillWordTemplate](#govfillwordtemplate)
  - [gov.fillExcelTemplate](#govfillexceltemplate)
- [数据库操作](#数据库操作)
  - [gov.getDbType](#govgetdbtype)
  - [gov.getDatabases](#govgetdatabases)
  - [gov.querySQL](#govquerysql)
  - [gov.executeSQL](#govexecutesql)
  - [gov.querySQLForDb](#govquerysqlfordb)
  - [gov.executeSQLForDb](#govexecutesqlfordb)
- [AI 调用](#ai-调用)
  - [gov.callAI](#govcallai)

---

## 日志输出

### gov.log

**签名：** `gov.log(msg)`

**描述：** 向执行日志面板输出一条消息。

**参数：**
- `msg` - 要输出的消息内容（任意类型，会自动转为字符串）

**返回值：** 无

**示例代码：**
```javascript
gov.log('处理完成，共 ' + n + ' 行');
gov.log('当前时间: ' + new Date().toISOString());
```

---

### gov.showTable

**签名：** `gov.showTable(data)`

**描述：** 将数组数据以表格形式输出，前端与后端都会识别并渲染成表格。适用于数据预览和调试。

**参数：**
- `data` - 要显示的数据数组（对象数组或二维数组）

**返回值：** 无

**示例代码：**
```javascript
const rows = await gov.querySQL('SELECT id, name FROM users');
gov.showTable(rows);

// 显示自定义数据
const data = [
  { name: '张三', age: 25 },
  { name: '李四', age: 30 }
];
gov.showTable(data);
```

---

## 文件读取

### gov.readExcel

**签名：** `await gov.readExcel(file) → workbook`

**描述：** 读取上传的 Excel 文件（.xlsx/.xls），返回 SheetJS workbook 对象。配合 `XLSX.utils.sheet_to_json` 解析数据。

**参数：**
- `file` - 文件对象（File/Blob）或文件路径字符串

**返回值：** SheetJS workbook 对象

**示例代码：**
```javascript
const wb = await gov.readExcel(INPUT_FILE);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
gov.log('共 ' + rows.length + ' 行');

// 解析为对象数组（第一行为表头）
const objs = XLSX.utils.sheet_to_json(sheet);
gov.showTable(objs);
```

---

### gov.readCSV

**签名：** `await gov.readCSV(text) → string[][]`

**描述：** 解析 CSV 文本，返回二维字符串数组（行×列）。自动处理引号、逗号和换行符。

**参数：**
- `text` - CSV 格式的文本内容

**返回值：** 二维字符串数组

**示例代码：**
```javascript
const rows = await gov.readCSV(INPUT_TEXT);
for (const row of rows) {
  gov.log(row.join(' | '));
}

// 跳过表头
const [header, ...data] = rows;
gov.log('列名: ' + header.join(', '));
gov.log('数据行数: ' + data.length);
```

---

### gov.readWord

**签名：** `await gov.readWord(file) → {value: string, messages: [...]}`

**描述：** 读取上传的 Word 文件（.docx），提取纯文本内容。返回 mammoth 的结果对象，`value` 为正文文本。

**参数：**
- `file` - Word 文件对象（File/Blob）或文件路径字符串

**返回值：** 包含 `value` 和 `messages` 的对象
- `value` - 提取的纯文本内容
- `messages` - 转换过程中的警告和错误信息

**示例代码：**
```javascript
const result = await gov.readWord(INPUT_FILE);
const text = result.value;
gov.log('字数: ' + text.length);

// 检查转换警告
if (result.messages.length > 0) {
  gov.log('警告: ' + JSON.stringify(result.messages));
}
```

---

## 文件写入

### gov.writeExcel

**签名：** `gov.writeExcel(filename, data, options?)`

**描述：** 从空白生成 Excel 并下载。`data` 为二维数组或对象数组；`options` 可选 `{ sheetName }`。若需基于已有 .xlsx 模板只填单元格，请用 `gov.fillExcelTemplate`。

**参数：**
- `filename` - 输出文件名（如 `'结果.xlsx'`）
- `data` - 数据内容
  - 二维数组：`[['列1', '列2'], ['值1', '值2']]`
  - 对象数组：`[{ 列1: '值1', 列2: '值2' }]`
- `options` - 可选配置对象
  - `sheetName` - 工作表名称（默认 `'Sheet1'`）

**返回值：** 无（触发浏览器下载）

**示例代码：**
```javascript
// 方式一：二维数组
const rows = [['姓名', '分数'], ['张三', 90], ['李四', 85]];
gov.writeExcel('结果.xlsx', rows, { sheetName: 'Sheet1' });

// 方式二：对象数组
const objs = [
  { name: '张三', score: 90 },
  { name: '李四', score: 85 }
];
gov.writeExcel('导出.xlsx', objs);

// 从数据库查询结果导出
const data = await gov.querySQL('SELECT id, name, age FROM users');
gov.writeExcel('用户数据.xlsx', data);
```

---

### gov.writeCSV

**签名：** `gov.writeCSV(filename, data)`

**描述：** 将二维数组转为 CSV 并下载（UTF-8 BOM，便于 Excel 打开中文）。

**参数：**
- `filename` - 输出文件名（如 `'数据.csv'`）
- `data` - 二维字符串数组

**返回值：** 无（触发浏览器下载）

**示例代码：**
```javascript
const rows = [['姓名', '年龄'], ['张三', '25'], ['李四', '30']];
gov.writeCSV('数据.csv', rows);

// 从查询结果生成
const data = await gov.querySQL('SELECT name, age FROM users');
const csvData = [Object.keys(data[0]), ...data.map(row => Object.values(row))];
gov.writeCSV('用户.csv', csvData);
```

---

### gov.writeText

**签名：** `gov.writeText(filename, content)`

**描述：** 将字符串写入纯文本文件并下载。

**参数：**
- `filename` - 输出文件名（如 `'报告.txt'`）
- `content` - 文本内容字符串

**返回值：** 无（触发浏览器下载）

**示例代码：**
```javascript
gov.writeText('报告.txt', '第一行\n第二行\n第三行');

// 生成日志文件
const logs = ['开始处理', '处理完成', '共 100 行'];
gov.writeText('处理日志.txt', logs.join('\n'));
```

---

### gov.writeJSON

**签名：** `gov.writeJSON(filename, data)`

**描述：** 将对象或数组格式化为 JSON（缩进 2 空格）并下载。

**参数：**
- `filename` - 输出文件名（如 `'数据.json'`）
- `data` - 要序列化的对象或数组

**返回值：** 无（触发浏览器下载）

**示例代码：**
```javascript
const rows = await gov.querySQL('SELECT id, name FROM t LIMIT 10');
gov.writeJSON('查询结果.json', rows);

// 导出配置对象
const config = {
  apiUrl: 'https://api.example.com',
  timeout: 5000,
  retries: 3
};
gov.writeJSON('config.json', config);
```

---

## 模板填充

### gov.fillWordTemplate

**签名：** `await gov.fillWordTemplate(templateFile, data, outputFilename)`

**描述：** 基于 .docx 模板（占位符 `{name}`、循环 `{#items}...{/items}`、条件 `{#show}...{/show}`）用 docxtemplater 渲染并下载。`templateFile` 为 File/Blob，或与已上传文件同名的字符串。

**参数：**
- `templateFile` - Word 模板文件（File/Blob 或文件名字符串）
- `data` - 填充数据对象
  - 简单字段：`{ name: '张三' }` → 模板中 `{name}` 被替换
  - 循环：`{ items: [{ x: 1 }, { x: 2 }] }` → 模板中 `{#items}{x}{/items}` 循环渲染
  - 条件：`{ show: true }` → 模板中 `{#show}显示内容{/show}` 条件显示
- `outputFilename` - 输出文件名

**返回值：** 无（触发浏览器下载）

**示例代码：**
```javascript
// 简单字段填充
await gov.fillWordTemplate(INPUT_FILE, {
  name: '张三',
  date: '2024-01-01'
}, '报告.docx');

// 复杂模板（循环和条件）
await gov.fillWordTemplate(INPUT_FILE, {
  title: '月度报告',
  date: '2024-01-01',
  items: [
    { name: '项目A', progress: 80 },
    { name: '项目B', progress: 60 }
  ],
  showSummary: true
}, '月度报告.docx');
```

**模板示例：**
```
标题：{title}
日期：{date}

项目列表：
{#items}
- {name}: {progress}%
{/items}

{#showSummary}
总体进度良好。
{/showSummary}
```

---

### gov.fillExcelTemplate

**签名：** `await gov.fillExcelTemplate(templateFile, data, outputFilename)`

**描述：** 读取 .xlsx 模板，按单元格地址写入 data 后下载。data 可为 `{ A1: '值', B2: 123 }`（默认第一个工作表），或 `{ Sheet1: { A1: '值' }, Sheet2: { B2: 2 } }`。

**参数：**
- `templateFile` - Excel 模板文件（File/Blob 或文件名字符串）
- `data` - 单元格数据对象
  - 单工作表：`{ A1: '值', B2: 100 }`
  - 多工作表：`{ Sheet1: { A1: '值' }, Sheet2: { B2: 2 } }`
- `outputFilename` - 输出文件名

**返回值：** 无（触发浏览器下载）

**示例代码：**
```javascript
// 单工作表填充
await gov.fillExcelTemplate(INPUT_FILE, {
  A1: '标题',
  B2: 100,
  C3: new Date()
}, '导出.xlsx');

// 多工作表填充
await gov.fillExcelTemplate('tpl.xlsx', {
  Sheet1: { A1: '表1数据', B1: '值1' },
  数据: { A1: '表2数据', B1: '值2' }
}, '结果.xlsx');

// 从数据库读取后填充
const row = await gov.querySQL('SELECT * FROM config WHERE id = 1');
await gov.fillExcelTemplate('模板.xlsx', {
  A1: row[0].title,
  B2: row[0].value,
  C3: row[0].date
}, '填充结果.xlsx');
```

---

## 数据库操作

### gov.getDbType

**签名：** `gov.getDbType() → string`

**描述：** 返回关联数据库的类型字符串，如 `"mysql"`、`"oracle"`、`"postgresql"`、`"dm"` 等。未关联时返回空字符串。

**参数：** 无

**返回值：** 数据库类型字符串

**示例代码：**
```javascript
const t = gov.getDbType();
if (t === 'mysql') {
  gov.log('当前使用 MySQL 数据库');
} else if (t === 'oracle') {
  gov.log('当前使用 Oracle 数据库');
} else if (t === '') {
  gov.log('未关联数据库');
}
```

---

### gov.getDatabases

**签名：** `gov.getDatabases() → [{id, name, type}]`

**描述：** 返回平台中所有已配置数据库的列表，可用于多库写入。每个数据库对象包含 `id`（唯一标识）、`name`（显示名称）、`type`（数据库类型）。

**参数：** 无

**返回值：** 数据库对象数组

**示例代码：**
```javascript
const dbs = gov.getDatabases();
for (const db of dbs) {
  gov.log(db.name + ' - ' + db.type);
}

// 查询所有数据库的表数量
for (const db of dbs) {
  const rows = await gov.querySQLForDb(db.id, 'SELECT COUNT(*) as c FROM users');
  gov.log(db.name + ' 用户数: ' + rows[0].c);
}
```

---

### gov.querySQL

**签名：** `await gov.querySQL(sql, params?) → [{...}]`

**描述：** 对任务关联的数据库执行 SELECT 查询，返回行对象数组。`params` 为可选参数数组（`?` 占位符对应）。未关联数据库时抛出错误。

**参数：**
- `sql` - SQL 查询语句（SELECT）
- `params` - 可选参数数组，对应 SQL 中的 `?` 占位符

**返回值：** 行对象数组

**示例代码：**
```javascript
// 简单查询
const rows = await gov.querySQL('SELECT * FROM users LIMIT 10');
gov.showTable(rows);

// 带参数查询（防 SQL 注入）
const rows = await gov.querySQL('SELECT * FROM users WHERE age > ?', [18]);
for (const row of rows) {
  gov.log(row.name);
}

// 多参数查询
const rows = await gov.querySQL(
  'SELECT * FROM orders WHERE status = ? AND amount > ?',
  ['completed', 1000]
);
```

---

### gov.executeSQL

**签名：** `await gov.executeSQL(sql, params?) → number`

**描述：** 对任务关联的数据库执行 INSERT/UPDATE/DELETE，返回影响行数。`params` 为可选参数数组。未关联数据库时抛出错误。

**参数：**
- `sql` - SQL 执行语句（INSERT/UPDATE/DELETE）
- `params` - 可选参数数组，对应 SQL 中的 `?` 占位符

**返回值：** 影响的行数

**示例代码：**
```javascript
// 插入数据
const n = await gov.executeSQL(
  'INSERT INTO logs (msg, ts) VALUES (?, ?)',
  ['done', new Date().toISOString()]
);
gov.log('写入 ' + n + ' 行');

// 更新数据
const n = await gov.executeSQL(
  'UPDATE users SET status = ? WHERE id = ?',
  ['active', 123]
);
gov.log('更新 ' + n + ' 行');

// 删除数据
const n = await gov.executeSQL('DELETE FROM temp WHERE created_at < ?', ['2024-01-01']);
gov.log('删除 ' + n + ' 行');
```

---

### gov.querySQLForDb

**签名：** `await gov.querySQLForDb(databaseId, sql, params?) → [{...}]`

**描述：** 对指定数据库（by id）执行 SELECT 查询，可查询任意已配置的数据库，用于跨库操作。

**参数：**
- `databaseId` - 数据库 ID（从 `gov.getDatabases()` 获取）
- `sql` - SQL 查询语句（SELECT）
- `params` - 可选参数数组

**返回值：** 行对象数组

**示例代码：**
```javascript
// 查询第一个数据库
const dbs = gov.getDatabases();
const rows = await gov.querySQLForDb(dbs[0].id, 'SELECT count(*) as c FROM orders');
gov.log('订单数: ' + rows[0].c);

// 跨库查询
const mysqlDb = dbs.find(db => db.type === 'mysql');
const oracleDb = dbs.find(db => db.type === 'oracle');

const mysqlData = await gov.querySQLForDb(mysqlDb.id, 'SELECT * FROM users LIMIT 10');
const oracleData = await gov.querySQLForDb(oracleDb.id, 'SELECT * FROM customers LIMIT 10');

gov.log('MySQL 用户: ' + mysqlData.length);
gov.log('Oracle 客户: ' + oracleData.length);
```

---

### gov.executeSQLForDb

**签名：** `await gov.executeSQLForDb(databaseId, sql, params?) → number`

**描述：** 对指定数据库执行 INSERT/UPDATE/DELETE，可将同一份数据写入多个数据库。

**参数：**
- `databaseId` - 数据库 ID
- `sql` - SQL 执行语句
- `params` - 可选参数数组

**返回值：** 影响的行数

**示例代码：**
```javascript
// 写入所有数据库
const dbs = gov.getDatabases();
const timestamp = Date.now();

for (const db of dbs) {
  const n = await gov.executeSQLForDb(
    db.id,
    'INSERT INTO sync_log (ts, source) VALUES (?, ?)',
    [timestamp, 'batch_job']
  );
  gov.log(db.name + ' 写入 ' + n + ' 行');
}

// 数据同步：从源库读取，写入目标库
const sourceDb = dbs.find(db => db.name === '生产库');
const targetDb = dbs.find(db => db.name === '备份库');

const data = await gov.querySQLForDb(sourceDb.id, 'SELECT * FROM orders WHERE date = CURDATE()');

for (const row of data) {
  await gov.executeSQLForDb(
    targetDb.id,
    'INSERT INTO orders_backup (id, amount, date) VALUES (?, ?, ?)',
    [row.id, row.amount, row.date]
  );
}
```

---

## AI 调用

### gov.callAI

**签名：** `await gov.callAI(prompt) → string`

**描述：** 调用 AI 助手（共用 AI 设置中配置的 API URL/Key/模型），发送 prompt 并返回 AI 回复的文本字符串。

**参数：**
- `prompt` - 发送给 AI 的提示文本

**返回值：** AI 回复的文本字符串

**示例代码：**
```javascript
// 文本翻译
const reply = await gov.callAI('请将以下内容翻译为英文：' + text);
gov.log(reply);

// 数据分析
const data = await gov.querySQL('SELECT * FROM sales WHERE month = "2024-01"');
const summary = await gov.callAI('请分析以下销售数据并给出总结：\n' + JSON.stringify(data));
gov.log(summary);

// 文本处理
const wordContent = await gov.readWord(INPUT_FILE);
const extracted = await gov.callAI('请从以下文本中提取所有日期和金额：\n' + wordContent.value);
gov.writeText('提取结果.txt', extracted);

// 智能分类
const rows = await gov.querySQL('SELECT id, description FROM tickets');
for (const row of rows) {
  const category = await gov.callAI('请将以下工单分类（技术/财务/其他）：' + row.description);
  await gov.executeSQL('UPDATE tickets SET category = ? WHERE id = ?', [category, row.id]);
}
```

---

## 最佳实践

### 错误处理
```javascript
try {
  const rows = await gov.querySQL('SELECT * FROM users');
  gov.showTable(rows);
} catch (error) {
  gov.log('查询失败: ' + error.message);
}
```

### 批量操作
```javascript
// 批量插入时使用事务（如果数据库支持）
const data = [...]; // 大量数据
let count = 0;
for (const row of data) {
  await gov.executeSQL('INSERT INTO logs (msg) VALUES (?)', [row.msg]);
  count++;
  if (count % 100 === 0) {
    gov.log('已处理 ' + count + ' 行');
  }
}
```

### 性能优化
```javascript
// 大文件分块处理
const wb = await gov.readExcel(INPUT_FILE);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet);

const chunkSize = 1000;
for (let i = 0; i < rows.length; i += chunkSize) {
  const chunk = rows.slice(i, i + chunkSize);
  // 处理分块数据
  gov.log('处理第 ' + (i / chunkSize + 1) + ' 批');
}
```

---

## 注意事项

1. **异步操作**：所有带 `await` 的 API 都是异步的，必须在 async 函数中使用
2. **数据库关联**：`gov.querySQL` 和 `gov.executeSQL` 需要任务已关联数据库
3. **文件大小**：处理大文件时注意内存占用，建议分块处理
4. **SQL 注入**：始终使用参数化查询（`?` 占位符）而非字符串拼接
5. **AI 调用限制**：频繁调用 AI API 可能产生费用，建议批量处理
6. **浏览器兼容**：文件下载功能依赖浏览器环境，服务端脚本可能不支持

---

## 版本信息

- 文档版本：1.0
- 最后更新：2026-04-25
- 基于源文件：`apps/data-ontology/gov-shared.js`

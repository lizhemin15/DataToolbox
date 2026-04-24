# Gov API 文档

本文档详细介绍了 `gov` 对象提供的所有 API 方法，用于数据处理、文件操作、数据库查询和 AI 调用等功能。

## 目录

- [概述](#概述)
- [日志与显示](#日志与显示)
  - [gov.log](#govlog)
  - [gov.showTable](#govshowtable)
- [数据库信息](#数据库信息)
  - [gov.getDbType](#govgetdbtype)
  - [gov.getDatabases](#govgetdatabases)
- [文件读取](#文件读取)
  - [gov.readExcel](#govreadexcel)
  - [gov.readCSV](#govreadcsv)
  - [gov.readWord](#govreadword)
- [文件写入](#文件写入)
  - [gov.writeExcel](#govwriteexcel)
  - [gov.fillWordTemplate](#govfillwordtemplate)
  - [gov.fillExcelTemplate](#govfillexceltemplate)
  - [gov.writeCSV](#govwritecsv)
  - [gov.writeText](#govwritetext)
  - [gov.writeJSON](#govwritejson)
- [数据库操作](#数据库操作)
  - [gov.querySQL](#govquerysql)
  - [gov.executeSQL](#govexecutesql)
  - [gov.querySQLForDb](#govquerysqlfordb)
  - [gov.executeSQLForDb](#govexecutesqlfordb)
- [AI 调用](#ai-调用)
  - [gov.callAI](#govcallai)
- [使用说明](#使用说明)
- [注意事项](#注意事项)

---

## 概述

`gov` 对象是数据治理平台提供的核心 API 对象，提供了以下功能：

- **日志输出**：向执行日志面板输出信息
- **数据展示**：以表格形式展示数据
- **文件操作**：读取和写入 Excel、CSV、Word、文本、JSON 等格式文件
- **数据库操作**：查询和执行 SQL 语句，支持关联数据库和指定数据库
- **AI 调用**：调用平台配置的 AI 助手

---

## 日志与显示

### gov.log

**签名**：`gov.log(msg)`

**描述**：向执行日志面板输出一条消息。

**参数**：
- `msg` - 要输出的消息内容（字符串或可转换为字符串的值）

**示例**：
```javascript
gov.log('处理完成，共 ' + n + ' 行');
gov.log('开始处理数据...');
```

---

### gov.showTable

**签名**：`gov.showTable(data)`

**描述**：将数组数据以表格形式输出，前端与后端都会识别并渲染成表格。

**参数**：
- `data` - 数组数据，每个元素为一个对象，代表表格的一行

**示例**：
```javascript
const rows = await gov.querySQL('SELECT id, name FROM users');
gov.showTable(rows);
```

---

## 数据库信息

### gov.getDbType

**签名**：`gov.getDbType() → string`

**描述**：返回关联数据库的类型字符串，如 "mysql"、"oracle"、"postgresql"、"dm" 等。未关联时返回空字符串。

**返回值**：数据库类型字符串，未关联数据库时返回空字符串

**示例**：
```javascript
const t = gov.getDbType();
if (t === 'mysql') {
  // MySQL 特定逻辑
} else if (t === 'oracle') {
  // Oracle 特定逻辑
}
```

---

### gov.getDatabases

**签名**：`gov.getDatabases() → [{id, name, type}]`

**描述**：返回平台中所有已配置数据库的列表，可用于多库写入。

**返回值**：数据库对象数组，每个对象包含：
- `id` - 数据库 ID
- `name` - 数据库名称
- `type` - 数据库类型

**示例**：
```javascript
const dbs = gov.getDatabases();
for (const db of dbs) {
  gov.log(db.name + ' - ' + db.type);
}
```

---

## 文件读取

### gov.readExcel

**签名**：`await gov.readExcel(file) → workbook`

**描述**：读取上传的 Excel 文件（.xlsx/.xls），返回 SheetJS workbook 对象。配合 `XLSX.utils.sheet_to_json` 解析数据。

**参数**：
- `file` - 上传的 Excel 文件对象（通常使用 `INPUT_FILE` 变量）

**返回值**：SheetJS workbook 对象

**示例**：
```javascript
const wb = await gov.readExcel(INPUT_FILE);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
gov.log('共 ' + rows.length + ' 行');
```

---

### gov.readCSV

**签名**：`await gov.readCSV(text) → string[][]`

**描述**：解析 CSV 文本，返回二维字符串数组（行×列）。

**参数**：
- `text` - CSV 格式的文本内容（通常使用 `INPUT_TEXT` 变量）

**返回值**：二维字符串数组，每个元素为一行，每行为字符串数组

**示例**：
```javascript
const rows = await gov.readCSV(INPUT_TEXT);
for (const row of rows) {
  gov.log(row.join(' | '));
}
```

---

### gov.readWord

**签名**：`await gov.readWord(file) → {value: string, messages: [...]}`

**描述**：读取上传的 Word 文件（.docx），提取纯文本内容。返回 mammoth 的结果对象，`value` 为正文文本。

**参数**：
- `file` - 上传的 Word 文件对象（通常使用 `INPUT_FILE` 变量）

**返回值**：mammoth 结果对象，包含：
- `value` - 提取的纯文本内容
- `messages` - 转换过程中的消息数组

**示例**：
```javascript
const result = await gov.readWord(INPUT_FILE);
const text = result.value;
gov.log('字数: ' + text.length);
```

---

## 文件写入

### gov.writeExcel

**签名**：`gov.writeExcel(filename, data, options?)`

**描述**：从空白生成 Excel 并下载。`data` 为二维数组或对象数组；`options` 可选 `{sheetName}`。若需基于已有 .xlsx 模板只填单元格，请用 `gov.fillExcelTemplate`。

**参数**：
- `filename` - 输出文件名（如 '结果.xlsx'）
- `data` - 数据，可以是二维数组或对象数组
- `options` - 可选配置对象，包含 `sheetName` 属性

**示例**：
```javascript
// 二维数组
const rows = [['姓名', '分数'], ['张三', 90]];
gov.writeExcel('结果.xlsx', rows, { sheetName: 'Sheet1' });

// 对象数组
const objs = [{ name: '张三', score: 90 }];
gov.writeExcel('导出.xlsx', objs);
```

---

### gov.fillWordTemplate

**签名**：`await gov.fillWordTemplate(templateFile, data, outputFilename)`

**描述**：基于 .docx 模板（占位符 `{name}`、循环 `{#items}...{/items}`、条件 `{#show}...{/show}`）用 docxtemplater 渲染并下载。`templateFile` 为 File/Blob，或与已上传文件同名的字符串。

**参数**：
- `templateFile` - 模板文件对象或文件名字符串
- `data` - 模板数据对象
- `outputFilename` - 输出文件名

**模板语法**：
- `{变量名}` - 变量占位符
- `{#数组}...{/数组}` - 循环
- `{#条件}...{/条件}` - 条件渲染

**示例**：
```javascript
await gov.fillWordTemplate(INPUT_FILE, {
  name: '张三',
  date: '2024-01-01',
  items: [{ x: 1 }, { x: 2 }],
  show: true
}, '报告.docx');
```

---

### gov.fillExcelTemplate

**签名**：`await gov.fillExcelTemplate(templateFile, data, outputFilename)`

**描述**：读取 .xlsx 模板，按单元格地址写入 `data` 后下载。`data` 可为 `{A1: '值', B2: 123}`（默认第一个工作表），或 `{Sheet1: {A1: '值'}, Sheet2: {B2: 2}}`。

**参数**：
- `templateFile` - 模板文件对象或文件名字符串
- `data` - 单元格数据对象
- `outputFilename` - 输出文件名

**数据格式**：
- 单工作表：`{A1: '值', B2: 123}`
- 多工作表：`{Sheet1: {A1: '值'}, Sheet2: {B2: 2}}`

**示例**：
```javascript
// 单表
await gov.fillExcelTemplate(INPUT_FILE, { A1: '标题', B2: 100 }, '导出.xlsx');

// 多表
await gov.fillExcelTemplate('tpl.xlsx', {
  Sheet1: { A1: 'a' },
  数据: { B3: 'b' }
}, '结果.xlsx');
```

---

### gov.writeCSV

**签名**：`gov.writeCSV(filename, data)`

**描述**：将二维数组转为 CSV 并下载（UTF-8 BOM，便于 Excel 打开中文）。

**参数**：
- `filename` - 输出文件名（如 '数据.csv'）
- `data` - 二维数组

**示例**：
```javascript
const rows = [['a', 'b'], ['1', '2']];
gov.writeCSV('数据.csv', rows);
```

---

### gov.writeText

**签名**：`gov.writeText(filename, content)`

**描述**：将字符串写入纯文本文件并下载。

**参数**：
- `filename` - 输出文件名（如 '报告.txt'）
- `content` - 文本内容字符串

**示例**：
```javascript
gov.writeText('报告.txt', '第一行\n第二行');
```

---

### gov.writeJSON

**签名**：`gov.writeJSON(filename, data)`

**描述**：将对象或数组格式化为 JSON（缩进 2 空格）并下载。

**参数**：
- `filename` - 输出文件名（如 '数据.json'）
- `data` - 要序列化的对象或数组

**示例**：
```javascript
const rows = await gov.querySQL('SELECT id, name FROM t LIMIT 10');
gov.writeJSON('查询结果.json', rows);
```

---

## 数据库操作

### gov.querySQL

**签名**：`await gov.querySQL(sql, params?) → [{...}]`

**描述**：对任务关联的数据库执行 SELECT 查询，返回行对象数组。`params` 为可选参数数组（`?` 占位符对应）。未关联数据库时抛出错误。

**参数**：
- `sql` - SQL 查询语句（SELECT）
- `params` - 可选参数数组，对应 SQL 中的 `?` 占位符

**返回值**：行对象数组，每个对象的属性对应查询列

**示例**：
```javascript
const rows = await gov.querySQL('SELECT * FROM users WHERE age > ?', [18]);
for (const row of rows) {
  gov.log(row.name);
}
```

---

### gov.executeSQL

**签名**：`await gov.executeSQL(sql, params?) → number`

**描述**：对任务关联的数据库执行 INSERT/UPDATE/DELETE，返回影响行数。`params` 为可选参数数组。未关联数据库时抛出错误。

**参数**：
- `sql` - SQL 执行语句（INSERT/UPDATE/DELETE）
- `params` - 可选参数数组，对应 SQL 中的 `?` 占位符

**返回值**：影响的行数

**示例**：
```javascript
const n = await gov.executeSQL(
  'INSERT INTO logs (msg, ts) VALUES (?, ?)',
  ['done', new Date().toISOString()]
);
gov.log('写入 ' + n + ' 行');
```

---

### gov.querySQLForDb

**签名**：`await gov.querySQLForDb(databaseId, sql, params?) → [{...}]`

**描述**：对指定数据库（by id）执行 SELECT 查询，可查询任意已配置的数据库，用于跨库操作。

**参数**：
- `databaseId` - 数据库 ID（从 `gov.getDatabases()` 获取）
- `sql` - SQL 查询语句（SELECT）
- `params` - 可选参数数组，对应 SQL 中的 `?` 占位符

**返回值**：行对象数组

**示例**：
```javascript
const dbs = gov.getDatabases();
const rows = await gov.querySQLForDb(dbs[0].id, 'SELECT count(*) as c FROM orders');
gov.log('订单数: ' + rows[0].c);
```

---

### gov.executeSQLForDb

**签名**：`await gov.executeSQLForDb(databaseId, sql, params?) → number`

**描述**：对指定数据库执行 INSERT/UPDATE/DELETE，可将同一份数据写入多个数据库。

**参数**：
- `databaseId` - 数据库 ID（从 `gov.getDatabases()` 获取）
- `sql` - SQL 执行语句（INSERT/UPDATE/DELETE）
- `params` - 可选参数数组，对应 SQL 中的 `?` 占位符

**返回值**：影响的行数

**示例**：
```javascript
const dbs = gov.getDatabases();
for (const db of dbs) {
  await gov.executeSQLForDb(db.id,
    'INSERT INTO sync_log (ts) VALUES (?)',
    [Date.now()]
  );
}
```

---

## AI 调用

### gov.callAI

**签名**：`await gov.callAI(prompt) → string`

**描述**：调用 AI 助手（共用 AI 设置中配置的 API URL/Key/模型），发送 `prompt` 并返回 AI 回复的文本字符串。

**参数**：
- `prompt` - 发送给 AI 的提示文本

**返回值**：AI 回复的文本字符串

**示例**：
```javascript
const reply = await gov.callAI('请将以下内容翻译为英文：' + text);
gov.log(reply);
```

---

## 使用说明

### 1. 变量说明

在脚本执行环境中，以下变量自动可用：

- `INPUT_FILE` - 用户上传的文件对象（用于 `readExcel`、`readWord`、`fillWordTemplate`、`fillExcelTemplate`）
- `INPUT_TEXT` - 用户输入的文本内容（用于 `readCSV`）
- `gov` - Gov API 对象
- `XLSX` - SheetJS 库（用于 Excel 操作）

### 2. 异步操作

所有文件读取和数据库操作都是异步的，需要使用 `await` 关键字：

```javascript
// 正确
const rows = await gov.querySQL('SELECT * FROM users');

// 错误（不会等待结果）
const rows = gov.querySQL('SELECT * FROM users');
```

### 3. 数据库关联

- `gov.querySQL` 和 `gov.executeSQL` 需要任务关联数据库
- 使用 `gov.querySQLForDb` 和 `gov.executeSQLForDb` 可以操作任意已配置的数据库
- 使用 `gov.getDatabases()` 获取所有可用数据库列表

### 4. 文件模板

- Word 模板使用 docxtemplater 语法：`{变量}`、`{#数组}...{/数组}`、`{#条件}...{/条件}`
- Excel 模板使用单元格地址：`A1`、`B2` 等
- 模板文件可以是 File 对象或文件名字符串

---

## 注意事项

### 1. 错误处理

建议使用 try-catch 处理可能的错误：

```javascript
try {
  const rows = await gov.querySQL('SELECT * FROM users');
  gov.showTable(rows);
} catch (error) {
  gov.log('错误: ' + error.message);
}
```

### 2. SQL 参数化

使用参数化查询防止 SQL 注入：

```javascript
// 正确（参数化）
const rows = await gov.querySQL('SELECT * FROM users WHERE name = ?', [userName]);

// 错误（字符串拼接，有注入风险）
const rows = await gov.querySQL(`SELECT * FROM users WHERE name = '${userName}'`);
```

### 3. 大数据量处理

处理大量数据时，注意：
- 分批查询和处理，避免内存溢出
- 使用 `gov.log` 输出进度信息
- 适当使用 `gov.showTable` 展示关键数据

### 4. 文件编码

- CSV 文件使用 UTF-8 BOM 编码，确保 Excel 正确打开中文
- Word 文件仅支持 .docx 格式（不支持 .doc）
- Excel 文件支持 .xlsx 和 .xls 格式

### 5. 数据库兼容性

不同数据库类型的 SQL 语法可能不同，使用 `gov.getDbType()` 判断：

```javascript
const dbType = gov.getDbType();
let sql;

if (dbType === 'mysql') {
  sql = 'SELECT * FROM users LIMIT 10';
} else if (dbType === 'oracle') {
  sql = 'SELECT * FROM users WHERE ROWNUM <= 10';
}

const rows = await gov.querySQL(sql);
```

### 6. AI 调用限制

- AI 调用依赖平台 AI 设置中的配置
- 注意 API 调用频率和费用
- 处理超时和错误情况

---

## 完整示例

### 示例 1：读取 Excel 并导入数据库

```javascript
// 读取 Excel 文件
const wb = await gov.readExcel(INPUT_FILE);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet);

gov.log('读取到 ' + rows.length + ' 行数据');

// 导入数据库
let count = 0;
for (const row of rows) {
  await gov.executeSQL(
    'INSERT INTO users (name, age, email) VALUES (?, ?, ?)',
    [row.name, row.age, row.email]
  );
  count++;
}

gov.log('成功导入 ' + count + ' 行');
```

### 示例 2：查询数据库并生成 Excel

```javascript
// 查询数据
const rows = await gov.querySQL('SELECT id, name, created_at FROM users ORDER BY created_at DESC LIMIT 100');

gov.log('查询到 ' + rows.length + ' 行');

// 生成 Excel
const data = [['ID', '姓名', '创建时间']];
for (const row of rows) {
  data.push([row.id, row.name, row.created_at]);
}

gov.writeExcel('用户列表.xlsx', data, { sheetName: '用户' });
gov.log('Excel 文件已生成');
```

### 示例 3：使用 AI 处理文本

```javascript
// 读取 Word 文档
const result = await gov.readWord(INPUT_FILE);
const text = result.value;

gov.log('原文长度: ' + text.length);

// 使用 AI 总结
const summary = await gov.callAI('请总结以下内容的要点：\n\n' + text);

gov.log('摘要: ' + summary);

// 输出结果
gov.writeText('摘要.txt', summary);
```

### 示例 4：跨库数据同步

```javascript
// 获取所有数据库
const dbs = gov.getDatabases();
gov.log('共有 ' + dbs.length + ' 个数据库');

// 从第一个库查询数据
const rows = await gov.querySQLForDb(dbs[0].id, 'SELECT * FROM products WHERE status = 1');
gov.log('查询到 ' + rows.length + ' 条产品数据');

// 同步到其他库
for (let i = 1; i < dbs.length; i++) {
  let count = 0;
  for (const row of rows) {
    await gov.executeSQLForDb(dbs[i].id,
      'INSERT INTO products (id, name, price) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = ?, price = ?',
      [row.id, row.name, row.price, row.name, row.price]
    );
    count++;
  }
  gov.log('同步到 ' + dbs[i].name + ': ' + count + ' 条');
}
```

---

**文档版本**：1.0
**最后更新**：2026-04-25
**API 数量**：17 个

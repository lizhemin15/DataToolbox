const GOV_API_SECTIONS = [
    {
        category: 'gov 对象',
        items: [
            {
                name: 'gov.log',
                signature: 'gov.log(msg)',
                desc: '向执行日志面板输出一条消息。',
                example: 'gov.log(\'处理完成，共 \'+ n + \' 行\');'
            },
            {
                name: 'gov.showTable',
                signature: 'gov.showTable(data)',
                desc: '将数组数据以表格形式输出，前端与后端都会识别并渲染成表格。',
                example: 'const rows = await gov.querySQL(\'SELECT id, name FROM users\');\ngov.showTable(rows);'
            },
            {
                name: 'gov.getDbType',
                signature: 'gov.getDbType() → string',
                desc: '返回关联数据库的类型字符串，如 "mysql"、"oracle"、"postgresql"、"dm" 等。未关联时返回空字符串。',
                example: 'const t = gov.getDbType();\nif (t === \'mysql\') { /* ... */ }'
            },
            {
                name: 'gov.getDatabases',
                signature: 'gov.getDatabases() → [{id, name, type}]',
                desc: '返回平台中所有已配置数据库的列表，可用于多库写入。',
                example: 'const dbs = gov.getDatabases();\nfor (const db of dbs) {\n  gov.log(db.name + \' - \' + db.type);\n}'
            },
            {
                name: 'gov.readExcel',
                signature: 'await gov.readExcel(file) → workbook',
                desc: '读取上传的 Excel 文件（.xlsx/.xls），返回 SheetJS workbook 对象。配合 XLSX.utils.sheet_to_json 解析数据。',
                example: 'const wb = await gov.readExcel(INPUT_FILE);\nconst sheet = wb.Sheets[wb.SheetNames[0]];\nconst rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });\ngov.log(\'共 \'+ rows.length + \' 行\');'
            },
            {
                name: 'gov.readCSV',
                signature: 'await gov.readCSV(text) → string[][]',
                desc: '解析 CSV 文本，返回二维字符串数组（行×列）。',
                example: 'const rows = await gov.readCSV(INPUT_TEXT);\nfor (const row of rows) {\n  gov.log(row.join(\' | \'));\n}'
            },
            {
                name: 'gov.readWord',
                signature: 'await gov.readWord(file) → {value: string, messages: [...]}',
                desc: '读取上传的 Word 文件（.docx），提取纯文本内容。返回 mammoth 的结果对象，value 为正文文本。',
                example: 'const result = await gov.readWord(INPUT_FILE);\nconst text = result.value;\ngov.log(\'字数: \' + text.length);'
            },
            {
                name: 'gov.parseWordStructure',
                signature: 'await gov.parseWordStructure(file, options?) → {title, sections, sectionsFlat, tables, rawText}',
                desc: '解析 Word 文档结构，识别公文格式的标题层级（一、二、三、 / （一）（二） / 1. 2. / （1）（2））、段落、表格等。sections 返回树形结构（每个节点有 children），sectionsFlat 为扁平数组。',
                example: 'const structure = await gov.parseWordStructure(INPUT_FILE);\ngov.log(\'文档标题: \' + structure.title);\nstructure.sections.forEach(s => {\n  gov.log(s.title + \': \' + s.children.length + \'子节点\');\n});'
            },
            {
                name: 'gov.writeExcel',
                signature: 'gov.writeExcel(filename, data, options?)',
                desc: '从空白生成 Excel 并下载。data 为二维数组或对象数组；options 可选 { sheetName }。若需基于已有 .xlsx 模板只填单元格，请用 gov.fillExcelTemplate。',
                example: '// 二维数组\nconst rows = [[\'姓名\', \'分数\'], [\'张三\', 90]];\ngov.writeExcel(\'结果.xlsx\', rows, { sheetName: \'Sheet1\' });\n\n// 对象数组\nconst objs = [{ name: \'张三\', score: 90 }];\ngov.writeExcel(\'导出.xlsx\', objs);'
            },
            {
                name: 'gov.fillWordTemplate',
                signature: 'await gov.fillWordTemplate(templateFile, data, outputFilename)',
                desc: '基于 .docx 模板（占位符 {name}、循环 {#items}...{/items}、条件 {#show}...{/show}）用 docxtemplater 渲染并下载。templateFile 为 File/Blob，或与已上传文件同名的字符串。',
                example: 'await gov.fillWordTemplate(INPUT_FILE, {\n  name: \'张三\',\n  date: \'2024-01-01\',\n  items: [{ x: 1 }, { x: 2 }],\n  show: true\n}, \'报告.docx\');'
            },
            {
                name: 'gov.fillExcelTemplate',
                signature: 'await gov.fillExcelTemplate(templateFile, data, outputFilename)',
                desc: '读取 .xlsx 模板，按单元格地址写入 data 后下载。data 可为 { A1: \'值\', B2: 123 }（默认第一个工作表），或 { Sheet1: { A1: \'值\' }, Sheet2: { B2: 2 } }。',
                example: '// 单表\nawait gov.fillExcelTemplate(INPUT_FILE, { A1: \'标题\', B2: 100 }, \'导出.xlsx\');\n\n// 多表\nawait gov.fillExcelTemplate(\'tpl.xlsx\', {\n  Sheet1: { A1: \'a\' },\n  数据: { B3: \'b\' }\n}, \'结果.xlsx\');'
            },
            {
                name: 'gov.writeCSV',
                signature: 'gov.writeCSV(filename, data)',
                desc: '将二维数组转为 CSV 并下载（UTF-8 BOM，便于 Excel 打开中文）。',
                example: 'const rows = [[\'a\', \'b\'], [\'1\', \'2\']];\ngov.writeCSV(\'数据.csv\', rows);'
            },
            {
                name: 'gov.writeText',
                signature: 'gov.writeText(filename, content)',
                desc: '将字符串写入纯文本文件并下载。',
                example: 'gov.writeText(\'报告.txt\', \'第一行\\n第二行\');'
            },
            {
                name: 'gov.writeJSON',
                signature: 'gov.writeJSON(filename, data)',
                desc: '将对象或数组格式化为 JSON（缩进 2 空格）并下载。',
                example: 'const rows = await gov.querySQL(\'SELECT id, name FROM t LIMIT 10\');\ngov.writeJSON(\'查询结果.json\', rows);'
            },
            {
                name: 'gov.querySQL',
                signature: 'await gov.querySQL(sql, params?) → [{...}]',
                desc: '对任务关联的数据库执行 SELECT 查询，返回行对象数组。params 为可选参数数组（? 占位符对应）。未关联数据库时抛出错误。',
                example: 'const rows = await gov.querySQL(\'SELECT * FROM users WHERE age > ?\', [18]);\nfor (const row of rows) gov.log(row.name);'
            },
            {
                name: 'gov.executeSQL',
                signature: 'await gov.executeSQL(sql, params?) → number',
                desc: '对任务关联的数据库执行 INSERT/UPDATE/DELETE，返回影响行数。params 为可选参数数组。未关联数据库时抛出错误。',
                example: 'const n = await gov.executeSQL(\n  \'INSERT INTO logs (msg, ts) VALUES (?, ?)\',\n  [\'done\', new Date().toISOString()]\n);\ngov.log(\'写入 \' + n + \' 行\');'
            },
            {
                name: 'gov.querySQLForDb',
                signature: 'await gov.querySQLForDb(databaseId, sql, params?) → [{...}]',
                desc: '对指定数据库（by id）执行 SELECT 查询，可查询任意已配置的数据库，用于跨库操作。',
                example: 'const dbs = gov.getDatabases();\nconst rows = await gov.querySQLForDb(dbs[0].id, \'SELECT count(*) as c FROM orders\');\ngov.log(\'订单数: \' + rows[0].c);'
            },
            {
                name: 'gov.executeSQLForDb',
                signature: 'await gov.executeSQLForDb(databaseId, sql, params?) → number',
                desc: '对指定数据库执行 INSERT/UPDATE/DELETE，可将同一份数据写入多个数据库。',
                example: 'const dbs = gov.getDatabases();\nfor (const db of dbs) {\n  await gov.executeSQLForDb(db.id,\n    \'INSERT INTO sync_log (ts) VALUES (?)\',\n    [Date.now()]\n  );\n}'
            },
            {
                name: 'gov.callAI',
                signature: 'await gov.callAI(prompt) → string',
                desc: '调用 AI 助手（共用 AI 设置中配置的 API URL/Key/模型），发送 prompt 并返回 AI 回复的文本字符串。',
                example: 'const reply = await gov.callAI(\'请将以下内容翻译为英文：\' + text);\ngov.log(reply);'
            }
        ]
    }
];

function govExcelCellForValue(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number' && !isNaN(val)) return { t: 'n', v: val };
    if (val instanceof Date) return { t: 'd', v: val };
    if (typeof val === 'boolean') return { t: 'b', v: val };
    return { t: 's', v: String(val) };
}

function govExpandSheetRef(XLSX, ws) {
    let maxR = 0;
    let maxC = 0;
    let has = false;
    for (const k of Object.keys(ws)) {
        if (k[0] === '!') continue;
        try {
            const cell = XLSX.utils.decode_cell(k);
            has = true;
            maxR = Math.max(maxR, cell.r);
            maxC = Math.max(maxC, cell.c);
        } catch (e) {
            /* ignore */
        }
    }
    if (has) {
        ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    }
}

function govApplyCellMapToSheet(XLSX, ws, cellMap) {
    for (const [addr, val] of Object.entries(cellMap)) {
        if (!addr || addr[0] === '!') continue;
        try {
            XLSX.utils.decode_cell(addr);
        } catch (e) {
            continue;
        }
        const cellObj = govExcelCellForValue(val);
        if (cellObj === null) delete ws[addr];
        else ws[addr] = cellObj;
    }
    govExpandSheetRef(XLSX, ws);
}

function govDataIsFlatCellMap(XLSX, data) {
    const keys = Object.keys(data);
    if (keys.length === 0) return false;
    return keys.every(k => {
        if (typeof k !== 'string') return false;
        try {
            XLSX.utils.decode_cell(k);
            return true;
        } catch (e) {
            return false;
        }
    });
}

function govCsvEscapeCell(val) {
    const s = val === null || val === undefined ? '' : String(val);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function govDownloadBlob(blob, filename) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function govDownloadExamplesForTask(taskId) {
    const task = window.govTasks?.find(t => t.id === taskId);
    if (!task?.example_files?.length) {
        alert('没有可下载的样例文件');
        return;
    }
    const token = localStorage.getItem('authToken') || '';
    for (const file of task.example_files) {
        const url = `/api/data-ontology/governance/examples/${encodeURIComponent(file.path)}`;
        try {
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) throw new Error(res.statusText);
            const blob = await res.blob();
            govDownloadBlob(blob, file.name || file.path);
        } catch (e) {
            console.error('下载失败:', file.name, e);
        }
    }
}

const GOV_API_DOCS = GOV_API_SECTIONS;
const governanceFunctions = GOV_API_DOCS;

const GOV_SHARED = {
    GOV_API_SECTIONS,
    GOV_API_DOCS,
    governanceFunctions,
    govExcelCellForValue,
    govExpandSheetRef,
    govApplyCellMapToSheet,
    govDataIsFlatCellMap,
    govCsvEscapeCell,
    govDownloadBlob,
    govDownloadExamplesForTask
};

if (typeof window !== 'undefined') {
    window.GOV_SHARED = GOV_SHARED;
    window.GOV_API_SECTIONS = GOV_API_SECTIONS;
    window.GOV_API_DOCS = GOV_API_DOCS;
    window.governanceFunctions = governanceFunctions;
    window.govExcelCellForValue = govExcelCellForValue;
    window.govExpandSheetRef = govExpandSheetRef;
    window.govApplyCellMapToSheet = govApplyCellMapToSheet;
    window.govDataIsFlatCellMap = govDataIsFlatCellMap;
    window.govCsvEscapeCell = govCsvEscapeCell;
    window.govDownloadBlob = govDownloadBlob;
    window.govDownloadExamplesForTask = govDownloadExamplesForTask;
}
if (typeof globalThis !== 'undefined') {
    globalThis.GOV_SHARED = GOV_SHARED;
    globalThis.GOV_API_SECTIONS = GOV_API_SECTIONS;
    globalThis.GOV_API_DOCS = GOV_API_DOCS;
    globalThis.governanceFunctions = governanceFunctions;
    globalThis.govExcelCellForValue = govExcelCellForValue;
    globalThis.govExpandSheetRef = govExpandSheetRef;
    globalThis.govApplyCellMapToSheet = govApplyCellMapToSheet;
    globalThis.govDataIsFlatCellMap = govDataIsFlatCellMap;
    globalThis.govCsvEscapeCell = govCsvEscapeCell;
    globalThis.govDownloadBlob = govDownloadBlob;
    globalThis.govDownloadExamplesForTask = govDownloadExamplesForTask;
}

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
                desc: '从空白生成 Excel 并下载。data 为二维数组或对象数组；options 可选 { sheetName, columnWidths, rowHeights, merges, freeze, autofilter, styles }。styles 以单元格或区域为键，如 { \'A1\': {...}, \'A1:D1\': { fill:{fgColor:\'#DDEBF7\'}, bold:true } }，支持 font{name,size,bold,italic,color,underline}、fill{fgColor}、alignment{horizontal,vertical,wrapText}、border{style,color}、numFmt。若需基于已有 .xlsx 模板只填单元格，请用 gov.fillExcelTemplate。',
                example: '// 基础\nconst rows = [[\'姓名\', \'分数\'], [\'张三\', 90]];\ngov.writeExcel(\'结果.xlsx\', rows, { sheetName: \'Sheet1\' });\n\n// 列宽 + 冻结首行 + 表头样式 + 单元格格式\ngov.writeExcel(\'成绩.xlsx\', rows, {\n  sheetName: \'成绩\',\n  columnWidths: [12, 10],\n  freeze: \'A2\',\n  merges: [\'A1:B1\'],\n  autofilter: \'A1:B1\',\n  styles: {\n    \'A1:B1\': { fill:{fgColor:\'#DDEBF7\'}, bold:true, align:\'center\', border:{style:\'thin\'} },\n    \'B2\': { font:{name:\'微软雅黑\',size:12,bold:true,color:\'#C00000\'}, numFmt:\'0.00\' },\n    \'A2:B3\': { border:{style:\'thin\',color:\'#999999\'} }\n  }\n});'
            },
            {
                name: 'gov.readWordTables',
                signature: 'await gov.readWordTables(file) → [{ rows, colWidths?, style? }]',
                desc: '读取 .docx 中的**所有表格**：rows 为单元格文本二维数组，colWidths 为列宽（twip），style 为可复用样式（border{style,size,color}、headFill 表头底纹、headBold、fill、fontName、fontSize、align、valign、colWidths）。常用于把一个「表格模板」Word 当作样式来源。file 为 File/Blob 或已上传文件名字符串。',
                example: 'const tables = await gov.readWordTables(INPUT_FILE);\nconst tpl = tables[0].style;           // 提取模板表格样式\ngov.log(\'模板列数: \' + tables[0].rows[0].length);\ngov.log(\'表头底纹: \' + (tpl && tpl.headFill));'
            },
            {
                name: 'gov.word',
                signature: 'gov.word() → builder（.heading/.paragraph/.table/.tableFromTemplate/.save）',
                desc: 'Word 文档构建器，链式调用。.heading(text, level=1)；.paragraph(text, opts?)，opts={font:{name,size,color},bold,italic,underline,align:\'left|center|right|both\',firstLineIndent,lineSpacing,spaceBefore,spaceAfter}；.table(rows, opts?)，opts={template,colWidths,header,borders:{style,size,color},align,fontName,fontSize,wrap,merges:[\'0,0-0,1\'],rowHeight}；.tableFromTemplate(templateStyle, rows) 按模板样式生成表格；.save(filename) 生成并下载 .docx（自动补后缀）。',
                example: 'const doc = gov.word();\n// 从模板 Word 提取表格样式\nconst tpls = await gov.readWordTables(INPUT_FILE);\ndoc.heading(\'产品汇总\', 1);\ndoc.paragraph(\'以下按区展示产品：\', { font:{name:\'仿宋_GB2312\',size:16}, firstLineIndent:2 });\ndoc.tableFromTemplate(tpls[0].style, [\n  [\'产品名称\', \'规格\', \'单价\'],\n  [\'示例产品\', \'A型\', \'100\']\n]);\ndoc.save(\'产品汇总.docx\');'
            },
            {
                name: 'gov.buildWordTables',
                signature: 'gov.buildWordTables(filename, opts)',
                desc: '便捷封装：一次性生成「标题 + 段落 + 表格」的 Word。opts={ templateFile | templateTables, sections:[{title?, paragraphs?, table?}], defaultFont }。templateFile 为模板 Word，templateTables 为 gov.readWordTables 的结果（任选其一），表格会自动套用模板第 1 个表格的样式。',
                example: 'const tpls = await gov.readWordTables(INPUT_FILE);\nconst sections = [\n  { title:\'海淀区\', paragraphs:[\'本区共有 2 个产品。\'], table:[[\'产品\',\'规格\'],[\'产品A\',\'A型\']] },\n  { title:\'朝阳区\', table:[[\'产品\',\'规格\'],[\'产品B\',\'B型\']] }\n];\ngov.buildWordTables(\'分区产品.docx\', { templateTables: tpls, sections, defaultFont:{name:\'仿宋_GB2312\',size:16} });'
            },
            {
                name: 'gov.fillWordTemplate',
                signature: 'await gov.fillWordTemplate(templateFile, data, outputFilename, defaultFont?)',
                desc: '基于 .docx 模板（占位符 {name}、循环 {#items}...{/items}、条件 {#show}...{/show}）用 docxtemplater 渲染并下载。支持富文本语法：**加粗**、*斜体*、__下划线__、>首行缩进、[f:字体,s:字号]、[c:颜色]。defaultFont 可选，格式如 {name:"仿宋_GB2312",size:16}，不传时默认仿宋三号。templateFile 为 File/Blob，或与已上传文件同名的字符串。',
                example: '// 默认字体\nawait gov.fillWordTemplate(INPUT_FILE, {title: "报告"}, "报告.docx");\n\n// 指定字体字号\nawait gov.fillWordTemplate(INPUT_FILE, data, "报告.docx", {name:"黑体",size:18});'
            },
            {
                name: 'gov.getDefaultFont',
                signature: 'gov.getDefaultFont() → {name, size}',
                desc: '返回默认字体配置 {name:"仿宋_GB2312", size:16}。可传给 fillWordTemplate 或自行修改后传入。',
                example: 'const font = gov.getDefaultFont();\nfont.name = "黑体";\nawait gov.fillWordTemplate(INPUT_FILE, data, "报告.docx", font);'
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

// ==================== 纯函数：docx 表格解析 ====================

function govDecodeXmlEntities(s) {
    return String(s)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&amp;/g, '&');
}

function govTagAttr(tag, name) {
    const m = String(tag).match(new RegExp(name + '="([^"]*)"'));
    return m ? govDecodeXmlEntities(m[1]) : '';
}

function govParseTableCellMeta(tcXml) {
    const meta = {};
    const shd = tcXml.match(/<w:shd\b[^>]*w:fill="([^"]+)"/);
    if (shd && shd[1] && shd[1] !== 'auto') meta.fill = shd[1];
    const b = tcXml.match(/<w:b\b([^>]*)\/?>/);
    if (b) {
        const v = govTagAttr(b[0], 'w:val');
        if (!v || v === '1' || v === 'true') meta.bold = true;
    }
    const rf = tcXml.match(/<w:rFonts\b[^>]*\/?>/);
    if (rf) meta.fontName = govTagAttr(rf[0], 'w:eastAsia') || govTagAttr(rf[0], 'w:ascii') || '';
    const sz = tcXml.match(/<w:sz\b[^>]*w:val="(\d+)"/);
    if (sz) meta.fontSize = parseInt(sz[1], 10) / 2;
    const jc = tcXml.match(/<w:jc\b[^>]*w:val="([^"]+)"/);
    if (jc) meta.align = jc[1];
    const va = tcXml.match(/<w:vAlign\b[^>]*w:val="([^"]+)"/);
    if (va) meta.valign = va[1];
    return meta;
}

function govParseTableBorder(tblXml) {
    const block = tblXml.match(/<w:tblBorders\b[^>]*>([\s\S]*?)<\/w:tblBorders>/);
    const src = block ? block[1] : tblXml;
    const re = /<w:(top|left|bottom|right|insideH|insideV|inside)\b[^>]*\/?>/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const tag = m[0];
        const val = govTagAttr(tag, 'w:val');
        if (!val || val === 'none' || val === 'nil') continue;
        return { style: val, size: parseInt(govTagAttr(tag, 'w:sz') || '4', 10), color: govTagAttr(tag, 'w:color') || 'auto' };
    }
    const tc = tblXml.match(/<w:tcBorders\b[^>]*>([\s\S]*?)<\/w:tcBorders>/);
    if (tc) {
        const m2 = tc[1].match(/<w:(top|left|bottom|right)\b[^>]*\/?>/);
        if (m2) {
            const val = govTagAttr(m2[0], 'w:val');
            if (val && val !== 'none' && val !== 'nil') {
                return { style: val, size: parseInt(govTagAttr(m2[0], 'w:sz') || '4', 10), color: govTagAttr(m2[0], 'w:color') || 'auto' };
            }
        }
    }
    return undefined;
}

// 读取 docx 的 word/document.xml，解析所有表格：单元格文本 + 列宽 + 可复用样式
function govParseDocxTables(xml) {
    const tables = [];
    if (!xml || typeof xml !== 'string') return tables;
    const tblRe = /<w:tbl(?:\s[^>]*)?>([\s\S]*?)<\/w:tbl>/g;
    let tm;
    while ((tm = tblRe.exec(xml)) !== null) {
        const tblXml = tm[1];
        const colWidths = [];
        const gcRe = /<w:gridCol\b[^>]*w:w="(\d+)"/g;
        let gm;
        while ((gm = gcRe.exec(tblXml)) !== null) colWidths.push(parseInt(gm[1], 10));

        const rows = [];
        const rowMeta = [];
        const trRe = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g;
        let rm;
        while ((rm = trRe.exec(tblXml)) !== null) {
            const trXml = rm[1];
            const cells = [];
            const meta = [];
            const tcRe = /<w:tc>([\s\S]*?)<\/w:tc>/g;
            let cm;
            while ((cm = tcRe.exec(trXml)) !== null) {
                const tcXml = cm[1];
                let text = '';
                const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
                let txt;
                while ((txt = tRe.exec(tcXml)) !== null) text += govDecodeXmlEntities(txt[1]);
                cells.push(text);
                meta.push(govParseTableCellMeta(tcXml));
            }
            rows.push(cells);
            rowMeta.push(meta);
        }
        if (!rows.length) continue;

        const style = {};
        const border = govParseTableBorder(tblXml);
        if (border) style.border = border;
        const head = rowMeta[0] || [];
        const body = (rowMeta[1] || rowMeta[0] || []);
        const headFirst = head[0] || {};
        const bodyFirst = body[0] || {};
        if (headFirst.fill) style.headFill = headFirst.fill;
        if (headFirst.bold) style.headBold = true;
        if (bodyFirst.fill) style.fill = bodyFirst.fill;
        if (bodyFirst.fontName) style.fontName = bodyFirst.fontName;
        if (bodyFirst.fontSize) style.fontSize = bodyFirst.fontSize;
        const alignSrc = bodyFirst.align || headFirst.align;
        if (alignSrc) style.align = alignSrc;
        const valignSrc = bodyFirst.valign || headFirst.valign;
        if (valignSrc) style.valign = valignSrc;
        if (colWidths.length) style.colWidths = colWidths.slice();

        tables.push({
            rows,
            colWidths: colWidths.length ? colWidths.slice() : undefined,
            style: Object.keys(style).length ? style : undefined
        });
    }
    return tables;
}

// ==================== 纯函数：Excel 样式后处理 ====================

function govNormalizeXlsxColor(c) {
    if (!c) return null;
    const s = String(c).trim().replace(/^#/, '').toUpperCase();
    if (/^[0-9A-F]{6}$/.test(s)) return 'FF' + s;
    if (/^[0-9A-F]{8}$/.test(s)) return s;
    return null;
}

function govXmlAttr(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// 给 xlsx 二进制打补丁：写入单元格样式 + 冻结窗格（SheetJS CE 会忽略 cell.s / !freeze）
function govApplyXlsxStyles(PizZip, bytes, spec) {
    if (!spec || !spec.sheets) return bytes;
    const zip = new PizZip(bytes);
    const stylesEntry = zip.file('xl/styles.xml');
    if (!stylesEntry) return bytes;
    let stylesXml = stylesEntry.asText();

    function extractBlock(tag) {
        const re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>');
        const m = stylesXml.match(re);
        return m ? m[1] : '';
    }
    function splitEntries(inner, entryTag) {
        const re = new RegExp('<' + entryTag + '(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?</' + entryTag + '>)', 'g');
        return inner.match(re) || [];
    }
    function appendToBlock(tag, xmls) {
        if (!xmls.length) return;
        const openRe = new RegExp('<' + tag + '\\b([^>]*?)(/?)>');
        const m = stylesXml.match(openRe);
        if (!m) {
            stylesXml = stylesXml.replace('</styleSheet>', '<' + tag + ' count="' + xmls.length + '">' + xmls.join('') + '</' + tag + '></styleSheet>');
            return;
        }
        const start = m.index + m[0].length;
        if (m[2] === '/') {
            let attrs = (m[1] || '').replace(/count="\d+"/, 'count="' + xmls.length + '"');
            if (!/count="/.test(attrs)) attrs += ' count="' + xmls.length + '"';
            const repl = '<' + tag + attrs + '>' + xmls.join('') + '</' + tag + '>';
            stylesXml = stylesXml.slice(0, m.index) + repl + stylesXml.slice(start);
            return;
        }
        const closeIdx = stylesXml.indexOf('</' + tag + '>', start);
        let attrs = m[1] || '';
        attrs = /count="\d+"/.test(attrs)
            ? attrs.replace(/count="(\d+)"/, (x, n) => 'count="' + (parseInt(n, 10) + xmls.length) + '"')
            : attrs + ' count="' + xmls.length + '"';
        const openNew = '<' + tag + attrs + '>';
        stylesXml = stylesXml.slice(0, m.index) + openNew + stylesXml.slice(start, closeIdx) + xmls.join('') + stylesXml.slice(closeIdx);
    }

    const fontEntries = splitEntries(extractBlock('fonts'), 'font');
    const fillEntries = splitEntries(extractBlock('fills'), 'fill');
    const borderEntries = splitEntries(extractBlock('borders'), 'border');
    const xfEntries = splitEntries(extractBlock('cellXfs'), 'xf');
    const numFmtEntries = splitEntries(extractBlock('numFmts'), 'numFmt');

    const newFonts = [], newFills = [], newBorders = [], newXfs = [], newNumFmts = [];
    const seenFont = new Map(), seenFill = new Map(), seenBorder = new Map(), seenXf = new Map(), seenFmt = new Map();
    let nextFmtId = 164;
    for (const e of numFmtEntries) {
        const idm = e.match(/numFmtId="(\d+)"/);
        if (idm) nextFmtId = Math.max(nextFmtId, parseInt(idm[1], 10) + 1);
    }

    function buildFontXml(font, st) {
        const parts = [];
        if (font && font.bold || st.bold) parts.push('<b/>');
        if (font && font.italic || st.italic) parts.push('<i/>');
        if (font && font.underline || st.underline) parts.push('<u/>');
        const size = Number((font && font.size) || st.fontSize);
        if (size > 0) parts.push('<sz val="' + size + '"/>');
        const color = govNormalizeXlsxColor((font && font.color) || st.color);
        if (color) parts.push('<color rgb="' + color + '"/>');
        const name = (font && font.name) || st.fontName || '';
        if (name) parts.push('<name val="' + govXmlAttr(name) + '"/>');
        return parts.length ? '<font>' + parts.join('') + '</font>' : '';
    }
    function getFontId(st) {
        const xml = buildFontXml(st.font || {}, st);
        if (!xml) return 0;
        if (seenFont.has(xml)) return seenFont.get(xml);
        const id = fontEntries.length + newFonts.length;
        newFonts.push(xml);
        seenFont.set(xml, id);
        return id;
    }
    function buildFillXml(st) {
        let color = null;
        if (typeof st.fill === 'string') color = govNormalizeXlsxColor(st.fill);
        else if (st.fill) color = govNormalizeXlsxColor(st.fill.fgColor || st.fill.color || st.fill.startColor);
        else color = govNormalizeXlsxColor(st.bgColor);
        if (!color) return '';
        return '<fill><patternFill patternType="solid"><fgColor rgb="' + color + '"/><bgColor indexed="64"/></patternFill></fill>';
    }
    function getFillId(st) {
        const xml = buildFillXml(st);
        if (!xml) return 0;
        if (seenFill.has(xml)) return seenFill.get(xml);
        const id = fillEntries.length + newFills.length;
        newFills.push(xml);
        seenFill.set(xml, id);
        return id;
    }
    function buildBorderXml(st) {
        const b = st.border;
        if (!b) return '';
        const style = b.style || 'thin';
        const color = govNormalizeXlsxColor(b.color) || 'FF000000';
        const side = (tag) => '<' + tag + ' style="' + govXmlAttr(style) + '"><color rgb="' + color + '"/></' + tag + '>';
        return '<border>' + side('left') + side('right') + side('top') + side('bottom') + '<diagonal/></border>';
    }
    function getBorderId(st) {
        const xml = buildBorderXml(st);
        if (!xml) return 0;
        if (seenBorder.has(xml)) return seenBorder.get(xml);
        const id = borderEntries.length + newBorders.length;
        newBorders.push(xml);
        seenBorder.set(xml, id);
        return id;
    }
    function getFmtId(st) {
        const code = st.numFmt;
        if (!code) return 0;
        for (const e of numFmtEntries) {
            const cm = e.match(/formatCode="([^"]*)"/);
            if (cm && govDecodeXmlEntities(cm[1]) === code) {
                const idm = e.match(/numFmtId="(\d+)"/);
                if (idm) return parseInt(idm[1], 10);
            }
        }
        if (seenFmt.has(code)) return seenFmt.get(code);
        const id = nextFmtId++;
        newNumFmts.push('<numFmt numFmtId="' + id + '" formatCode="' + govXmlAttr(code) + '"/>');
        seenFmt.set(code, id);
        return id;
    }
    function getXfId(st) {
        const fontId = getFontId(st);
        const fillId = getFillId(st);
        const borderId = getBorderId(st);
        const numFmtId = getFmtId(st);
        const al = st.alignment || {};
        const horiz = al.horizontal || st.align;
        const vert = al.vertical || st.valign;
        const wrap = al.wrapText || st.wrap;
        const alignParts = [];
        if (horiz) alignParts.push('horizontal="' + govXmlAttr(horiz) + '"');
        if (vert) alignParts.push('vertical="' + govXmlAttr(vert) + '"');
        if (wrap) alignParts.push('wrapText="1"');
        const attrs = 'numFmtId="' + numFmtId + '" fontId="' + fontId + '" fillId="' + fillId + '" borderId="' + borderId + '" xfId="0"'
            + (fontId ? ' applyFont="1"' : '')
            + (fillId ? ' applyFill="1"' : '')
            + (borderId ? ' applyBorder="1"' : '')
            + (numFmtId ? ' applyNumberFormat="1"' : '')
            + (alignParts.length ? ' applyAlignment="1"' : '');
        const xml = alignParts.length
            ? '<xf ' + attrs + '><alignment ' + alignParts.join(' ') + '/></xf>'
            : '<xf ' + attrs + '/>';
        if (seenXf.has(xml)) return seenXf.get(xml);
        const id = xfEntries.length + newXfs.length;
        newXfs.push(xml);
        seenXf.set(xml, id);
        return id;
    }

    function parseAddr(a) {
        const m = String(a || '').toUpperCase().match(/^([A-Z]+)(\d+)$/);
        if (!m) return null;
        let c = 0;
        for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
        return { r: parseInt(m[2], 10), c: c - 1, ref: m[1] + m[2] };
    }
    function colName(c) {
        let s = '', n = c + 1;
        while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
        return s;
    }
    function expandRefs(ref) {
        const m = String(ref || '').toUpperCase().match(/^([A-Z]+\d+)(?::([A-Z]+\d+))?$/);
        if (!m) return [];
        const a = parseAddr(m[1]);
        const b = m[2] ? parseAddr(m[2]) : a;
        if (!a || !b) return [];
        const out = [];
        for (let r = a.r; r <= b.r; r++) for (let c = a.c; c <= b.c; c++) out.push(colName(c) + r);
        return out;
    }

    function sheetPathForName(name) {
        const wbXml = (zip.file('xl/workbook.xml') || { asText: () => '' }).asText();
        const relsXml = (zip.file('xl/_rels/workbook.xml.rels') || { asText: () => '' }).asText();
        const relMap = {};
        const relRe = /<Relationship\b[^>]*\/>/g;
        let rm;
        while ((rm = relRe.exec(relsXml)) !== null) {
            const id = govTagAttr(rm[0], 'Id');
            let tgt = govTagAttr(rm[0], 'Target');
            if (id && tgt) {
                tgt = tgt.replace(/^\//, '');
                relMap[id] = tgt.indexOf('xl/') === 0 ? tgt : 'xl/' + tgt;
            }
        }
        const shRe = /<sheet\b[^>]*\/>/g;
        let sm;
        while ((sm = shRe.exec(wbXml)) !== null) {
            const nm = govTagAttr(sm[0], 'name');
            const rid = govTagAttr(sm[0], 'r:id');
            if (nm === name && relMap[rid]) return relMap[rid];
        }
        return null;
    }

    function applyCell(sheetXml, ref, xfId) {
        const info = parseAddr(ref);
        if (!info) return sheetXml;
        const cellRe = new RegExp('<c r="' + info.ref + '"([^>]*?)(/?)>');
        const m = sheetXml.match(cellRe);
        if (m) {
            const attrs = m[1].replace(/\s+s="[^"]*"/, '');
            return sheetXml.replace(m[0], '<c r="' + info.ref + '" s="' + xfId + '"' + attrs + m[2] + '>');
        }
        const rowRe = new RegExp('<row r="' + info.r + '"([^>]*?)>([\\s\\S]*?)</row>');
        const rw = sheetXml.match(rowRe);
        if (!rw) return sheetXml;
        const inner = rw[2];
        let insertAt = inner.length;
        const cRe = /<c r="([A-Z]+)\d+"/g;
        let cm;
        while ((cm = cRe.exec(inner)) !== null) {
            const ci = parseAddr(cm[1] + '1');
            if (ci && ci.c > info.c) { insertAt = cm.index; break; }
        }
        const newCell = '<c r="' + info.ref + '" s="' + xfId + '"/>';
        const newInner = inner.slice(0, insertAt) + newCell + inner.slice(insertAt);
        return sheetXml.replace(rw[0], '<row r="' + info.r + '"' + rw[1] + '>' + newInner + '</row>');
    }

    function applyFreeze(sheetXml, ref) {
        const info = parseAddr(ref);
        if (!info) return sheetXml;
        const xSplit = info.c, ySplit = Math.max(0, info.r - 1);
        if (!xSplit && !ySplit) return sheetXml;
        const activePane = ySplit > 0 ? (xSplit > 0 ? 'bottomRight' : 'bottomLeft') : 'topRight';
        const pane = '<pane' + (xSplit ? ' xSplit="' + xSplit + '"' : '') + (ySplit ? ' ySplit="' + ySplit + '"' : '')
            + ' topLeftCell="' + info.ref + '" activePane="' + activePane + '" state="frozen"/>';
        const sel = '<selection pane="' + activePane + '" activeCell="' + info.ref + '" sqref="' + info.ref + '"/>';
        const svRe = /<sheetView\b([^>]*?)(\/?)>/;
        const m = sheetXml.match(svRe);
        if (!m) return sheetXml;
        const start = m.index + m[0].length;
        if (m[2] === '/') return sheetXml.slice(0, m.index) + '<sheetView' + m[1] + '>' + pane + sel + '</sheetView>' + sheetXml.slice(start);
        return sheetXml.slice(0, start) + pane + sel + sheetXml.slice(start);
    }

    let anyChange = false;
    for (const [sheetName, sheetSpec] of Object.entries(spec.sheets)) {
        if (!sheetSpec) continue;
        const path = sheetPathForName(sheetName);
        if (!path) continue;
        const entry = zip.file(path);
        if (!entry) continue;
        let sheetXml = entry.asText();
        if (sheetSpec.cells) {
            const keys = Object.keys(sheetSpec.cells);
            keys.sort((a, b) => (a.indexOf(':') >= 0 ? 0 : 1) - (b.indexOf(':') >= 0 ? 0 : 1));
            const merged = {};
            for (const key of keys) {
                const st = sheetSpec.cells[key];
                if (!st || typeof st !== 'object') continue;
                for (const ref of expandRefs(key)) {
                    merged[ref] = Object.assign({}, merged[ref] || {}, st);
                }
            }
            for (const [ref, st] of Object.entries(merged)) {
                sheetXml = applyCell(sheetXml, ref, getXfId(st));
            }
        }
        if (sheetSpec.freeze) sheetXml = applyFreeze(sheetXml, sheetSpec.freeze);
        zip.file(path, sheetXml);
        anyChange = true;
    }
    if (!anyChange) return bytes;

    appendToBlock('numFmts', newNumFmts);
    appendToBlock('fonts', newFonts);
    appendToBlock('fills', newFills);
    appendToBlock('borders', newBorders);
    appendToBlock('cellXfs', newXfs);
    zip.file('xl/styles.xml', stylesXml);
    return zip.generate({ type: 'uint8array' });
}

// ==================== 纯函数：富文本解析（前后端共享） ====================

const GOV_DOCX_NAMED_COLORS = {
    black: '000000', white: 'FFFFFF', red: 'FF0000', green: '00B050', blue: '0000FF',
    yellow: 'FFFF00', orange: 'FFA500', purple: '800080', gray: '808080', grey: '808080',
    pink: 'FFC0CB', brown: 'A52A2A', cyan: '00FFFF', magenta: 'FF00FF', gold: 'FFD700'
};

/** 颜色值归一化为 docx 可用的 6 位大写十六进制（支持 #RGB/#RRGGBB/命名色） */
function govNormalizeDocxColor(value) {
    if (value === null || value === undefined) return null;
    let s = String(value).trim();
    if (!s) return null;
    const lower = s.toLowerCase();
    if (GOV_DOCX_NAMED_COLORS[lower]) return GOV_DOCX_NAMED_COLORS[lower];
    s = s.replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(s)) return s.split('').map((c) => c + c).join('').toUpperCase();
    if (/^[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
    return null;
}

/**
 * 解析单行富文本（前后端共享，浏览器/服务端行为一致）
 * 支持：**加粗**、*斜体*、__下划线__、>首行缩进、[f:字体,s:字号]、[c:颜色]
 * 返回的 bold/italic/underline/colors/fonts 均为「去标记后文本」的下标区间。
 */
function govParseRichLine(line, defaultFont) {
    const df = defaultFont || { name: '仿宋_GB2312', size: 16 };
    const chars = [];
    const src = typeof line === 'string' ? line : String(line === null || line === undefined ? '' : line);
    let indent = false;
    let start = 0;
    if (src.startsWith('>')) { indent = true; start = 1; }

    function parseSpan(text, inherited, out) {
        let idx = 0;
        let buf = '';
        let color = inherited.color === undefined ? null : inherited.color;
        let fontName = inherited.fontName === undefined ? null : inherited.fontName;
        let fontSize = inherited.fontSize === undefined ? null : inherited.fontSize;
        const flush = () => {
            if (!buf) return;
            for (const ch of buf) {
                out.push({
                    ch,
                    bold: !!inherited.bold,
                    italic: !!inherited.italic,
                    underline: !!inherited.underline,
                    color, fontName, fontSize
                });
            }
            buf = '';
        };
        while (idx < text.length) {
            const rest = text.slice(idx);
            let m;
            if ((m = /^\[f:([^,\]]+),s:(\d+)\]/.exec(rest))) {
                flush();
                fontName = m[1].trim();
                fontSize = parseInt(m[2], 10);
                idx += m[0].length;
                continue;
            }
            if ((m = /^\[c:([^\]]+)\]/.exec(rest))) {
                flush();
                color = govNormalizeDocxColor(m[1]);
                idx += m[0].length;
                continue;
            }
            if (text.startsWith('**', idx)) {
                const end = text.indexOf('**', idx + 2);
                if (end !== -1) {
                    flush();
                    parseSpan(text.slice(idx + 2, end), { bold: true, italic: inherited.italic, underline: inherited.underline, color, fontName, fontSize }, out);
                    idx = end + 2;
                    continue;
                }
                idx += 2;
                continue;
            }
            if (text.startsWith('__', idx)) {
                const end = text.indexOf('__', idx + 2);
                if (end !== -1) {
                    flush();
                    parseSpan(text.slice(idx + 2, end), { bold: inherited.bold, italic: inherited.italic, underline: true, color, fontName, fontSize }, out);
                    idx = end + 2;
                    continue;
                }
                idx += 2;
                continue;
            }
            if (text[idx] === '*') {
                const end = text.indexOf('*', idx + 1);
                if (end !== -1) {
                    flush();
                    parseSpan(text.slice(idx + 1, end), { bold: inherited.bold, italic: true, underline: inherited.underline, color, fontName, fontSize }, out);
                    idx = end + 1;
                    continue;
                }
                buf += text[idx];
                idx++;
                continue;
            }
            buf += text[idx];
            idx++;
        }
        flush();
    }

    parseSpan(src.slice(start), { fontName: df.name, fontSize: df.size }, chars);

    const text = chars.map((c) => c.ch).join('');
    function rangesFor(pred) {
        const out = [];
        let s = -1;
        for (let k = 0; k < chars.length; k++) {
            if (pred(chars[k])) { if (s < 0) s = k; }
            else if (s >= 0) { out.push([s, k]); s = -1; }
        }
        if (s >= 0) out.push([s, chars.length]);
        return out;
    }

    const colors = [];
    {
        let s = -1;
        let cur = null;
        for (let k = 0; k < chars.length; k++) {
            const c = chars[k].color || null;
            if (c !== cur) {
                if (s >= 0 && cur) colors.push([s, k, cur]);
                s = k;
                cur = c;
            }
        }
        if (s >= 0 && cur) colors.push([s, chars.length, cur]);
    }

    const fonts = [];
    {
        let s = -1;
        let curName = null;
        let curSize = null;
        for (let k = 0; k < chars.length; k++) {
            const cn = chars[k].fontName;
            const cs = chars[k].fontSize;
            if (!cn || cn !== curName || cs !== curSize) {
                if (s >= 0 && curName) fonts.push([s, k, curName, curSize]);
                if (cn) { s = k; curName = cn; curSize = cs; } else { s = -1; curName = null; curSize = null; }
            }
        }
        if (s >= 0 && curName) fonts.push([s, chars.length, curName, curSize]);
    }

    return {
        text,
        indent,
        bold: rangesFor((c) => c.bold),
        italic: rangesFor((c) => c.italic),
        underline: rangesFor((c) => c.underline),
        colors,
        fonts
    };
}

// ==================== 纯函数：Word 文档构建器（前后端共享） ====================

/**
 * 创建链式 Word 构建器。两端传入各自环境下的 docx 对象与打包/落盘钩子，
 * 保证方法签名与生成结构完全一致。
 */
function govCreateWordBuilder(docx, hooks) {
    if (!docx || !docx.Document) throw new Error('docx 库未就绪，无法创建 Word 构建器');
    const B = docx.BorderStyle || {};
    const A = docx.AlignmentType || {};
    const H = docx.HeadingLevel || {};
    const S = docx.ShadingType || {};
    const VA = docx.VerticalAlign || {};
    const WT = docx.WidthType || {};
    const HR = docx.HeightRule || {};
    const UT = docx.UnderlineType || {};
    const TL = docx.TableLayoutType || {};
    const children = [];

    function borderStyle(v) {
        if (!v) return B.SINGLE;
        const key = String(v).toUpperCase().replace(/[-\s]/g, '_');
        return B[key] || B.SINGLE;
    }
    function alignValue(a) {
        switch (String(a || '').toLowerCase()) {
            case 'center': return A.CENTER;
            case 'right': return A.RIGHT;
            case 'both': case 'justify': case 'justified': return A.JUSTIFIED;
            case 'left': return A.LEFT;
            default: return undefined;
        }
    }
    function valignValue(v) {
        switch (String(v || '').toLowerCase()) {
            case 'center': case 'middle': return VA.CENTER;
            case 'bottom': return VA.BOTTOM;
            case 'top': return VA.TOP;
            default: return undefined;
        }
    }
    function makeBorders(spec) {
        const b = spec || {};
        const style = borderStyle(b.style || 'single');
        const size = typeof b.size === 'number' ? b.size : 4;
        const color = govNormalizeDocxColor(b.color) || '000000';
        const side = { style, size, color };
        return { top: side, bottom: side, left: side, right: side, insideHorizontal: side, insideVertical: side };
    }
    function makeRun(text, st) {
        const s = st || {};
        const f = s.font || {};
        const runOpts = { text: text === null || text === undefined ? '' : String(text) };
        const fontName = f.name || s.fontName;
        if (fontName) runOpts.font = fontName;
        const sizePt = Number(f.size || s.fontSize);
        if (sizePt > 0) runOpts.size = sizePt * 2;
        if (s.bold || f.bold) runOpts.bold = true;
        if (s.italic || f.italic) runOpts.italics = true;
        if (s.underline || f.underline) runOpts.underline = { type: UT.SINGLE || 'single' };
        const color = govNormalizeDocxColor(f.color || s.color);
        if (color) runOpts.color = color;
        return new docx.TextRun(runOpts);
    }
    function parseMerges(merges) {
        const info = {};
        if (!Array.isArray(merges)) return info;
        for (const item of merges) {
            const mm = String(item).match(/^(\d+)\s*,\s*(\d+)\s*-\s*(\d+)\s*,\s*(\d+)$/);
            if (!mm) continue;
            const r1 = parseInt(mm[1], 10), c1 = parseInt(mm[2], 10);
            const r2 = parseInt(mm[3], 10), c2 = parseInt(mm[4], 10);
            const rowSpan = r2 - r1 + 1, colSpan = c2 - c1 + 1;
            if (rowSpan < 1 || colSpan < 1) continue;
            info[`${r1},${c1}`] = { rowSpan, colSpan };
            for (let r = r1; r <= r2; r++) {
                for (let c = c1; c <= c2; c++) {
                    if (r === r1 && c === c1) continue;
                    info[`${r},${c}`] = { skip: true };
                }
            }
        }
        return info;
    }
    function resolveColWidths(colWidths) {
        if (!colWidths) return undefined;
        let arr;
        if (typeof colWidths === 'string') arr = colWidths.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        else if (Array.isArray(colWidths)) arr = colWidths.slice();
        else return undefined;
        if (!arr.length) return undefined;
        return arr.map((v) => {
            const s = String(v).replace('%', '').trim();
            const n = Number(s);
            return isNaN(n) ? 0 : n;
        });
    }
    function makeCell(text, opts) {
        const o = opts || {};
        const par = { children: [makeRun(text, { bold: o.bold, fontName: o.fontName, fontSize: o.fontSize })] };
        if (o.align) par.alignment = o.align;
        const cellOpts = { children: [new docx.Paragraph(par)] };
        if (o.colSpan && o.colSpan > 1) cellOpts.columnSpan = o.colSpan;
        if (o.rowSpan && o.rowSpan > 1) cellOpts.rowSpan = o.rowSpan;
        if (o.shading) cellOpts.shading = { type: S.CLEAR || 'clear', fill: o.shading, color: 'auto' };
        if (o.valign) cellOpts.verticalAlign = o.valign;
        return new docx.TableCell(cellOpts);
    }
    function buildTable(rows, style, opts) {
        const s = style || {};
        const o = Object.assign({}, s, opts || {});
        const rowsArr = Array.isArray(rows) ? rows : [];
        const colWidths = resolveColWidths(o.colWidths);
        const borderSpec = o.borders || s.border || { style: 'single', size: 4, color: '000000' };
        const align = alignValue(o.align);
        const valign = valignValue(o.valign);
        const merges = parseMerges(o.merges);
        const headFill = govNormalizeDocxColor(o.headFill) || undefined;
        const bodyFill = govNormalizeDocxColor(o.fill) || undefined;
        const headBold = o.headBold !== undefined ? !!o.headBold : !!o.header;
        const rowHeightPt = Number(o.rowHeight);
        const trs = rowsArr.map((row, ri) => {
            const isHead = ri === 0;
            const rowArr = Array.isArray(row) ? row : [row];
            const cells = [];
            for (let ci = 0; ci < rowArr.length; ci++) {
                const mk = merges[`${ri},${ci}`];
                if (mk && mk.skip) continue;
                cells.push(makeCell(rowArr[ci], {
                    shading: isHead ? headFill : bodyFill,
                    colSpan: mk && mk.colSpan,
                    rowSpan: mk && mk.rowSpan,
                    align,
                    valign,
                    fontName: o.fontName,
                    fontSize: o.fontSize,
                    bold: isHead ? headBold : false
                }));
            }
            const rowOpts = { children: cells };
            if (isHead) rowOpts.tableHeader = true;
            if (rowHeightPt > 0) rowOpts.height = { value: Math.round(rowHeightPt * 20), rule: HR.ATLEAST || 'atLeast' };
            return new docx.TableRow(rowOpts);
        });
        const tableOpts = { rows: trs, width: { size: 100, type: WT.PERCENTAGE || 'pct' } };
        if (colWidths) {
            tableOpts.columnWidths = colWidths;
            if (TL.FIXED) tableOpts.layout = TL.FIXED;
        }
        if (borderSpec !== false) tableOpts.borders = makeBorders(borderSpec);
        return new docx.Table(tableOpts);
    }

    const builder = {
        heading(text, level = 1) {
            const lvl = Math.min(Math.max(parseInt(String(level), 10) || 1, 1), 6);
            const key = `HEADING_${lvl}`;
            children.push(new docx.Paragraph({
                heading: H[key] || H.HEADING_1,
                children: [new docx.TextRun({ text: text === null || text === undefined ? '' : String(text) })]
            }));
            return builder;
        },
        paragraph(text, opts) {
            const o = opts || {};
            const sizePt = Number(o.font && o.font.size) || 16;
            const parOpts = { children: [makeRun(text, o)] };
            const al = alignValue(o.align);
            if (al) parOpts.alignment = al;
            if (o.firstLineIndent) parOpts.indent = { firstLine: Math.round(Number(o.firstLineIndent) * sizePt * 20) };
            const spacing = {};
            if (o.lineSpacing) { spacing.line = Math.round(Number(o.lineSpacing) * 240); spacing.lineRule = 'auto'; }
            if (o.spaceBefore) spacing.before = Math.round(Number(o.spaceBefore) * 20);
            if (o.spaceAfter) spacing.after = Math.round(Number(o.spaceAfter) * 20);
            if (Object.keys(spacing).length) parOpts.spacing = spacing;
            children.push(new docx.Paragraph(parOpts));
            return builder;
        },
        table(rows, opts) {
            const o = opts || {};
            children.push(buildTable(rows, o.template || {}, o));
            return builder;
        },
        tableFromTemplate(templateStyle, rows) {
            children.push(buildTable(rows, templateStyle || {}, {}));
            return builder;
        },
        build() {
            return new docx.Document({ sections: [{ properties: {}, children: children.slice() }] });
        },
        async save(filename) {
            const base = filename || 'output.docx';
            const name = /\.docx$/i.test(base) ? base : `${base}.docx`;
            const bytes = await hooks.pack(builder.build());
            await hooks.sink(name, bytes);
            if (hooks.log) hooks.log(`已生成输出文件: ${name}`);
            return name;
        }
    };
    return builder;
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

// govDownloadExamplesForTask 已在 script.js 中定义，支持 taskName 和 exampleFiles 参数

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
    govParseDocxTables,
    govApplyXlsxStyles,
    govNormalizeXlsxColor,
    govParseRichLine,
    govNormalizeDocxColor,
    govCreateWordBuilder,
    govDownloadBlob
    // govDownloadExamplesForTask 已在 script.js 中定义，不在此导出
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
    window.govParseDocxTables = govParseDocxTables;
    window.govApplyXlsxStyles = govApplyXlsxStyles;
    window.govNormalizeXlsxColor = govNormalizeXlsxColor;
    window.govParseRichLine = govParseRichLine;
    window.govNormalizeDocxColor = govNormalizeDocxColor;
    window.govCreateWordBuilder = govCreateWordBuilder;
    window.govDownloadBlob = govDownloadBlob;
    // govDownloadExamplesForTask 已在 script.js 中定义，不在此覆盖
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
    globalThis.govParseDocxTables = govParseDocxTables;
    globalThis.govApplyXlsxStyles = govApplyXlsxStyles;
    globalThis.govNormalizeXlsxColor = govNormalizeXlsxColor;
    globalThis.govParseRichLine = govParseRichLine;
    globalThis.govNormalizeDocxColor = govNormalizeDocxColor;
    globalThis.govCreateWordBuilder = govCreateWordBuilder;
    globalThis.govDownloadBlob = govDownloadBlob;
    // govDownloadExamplesForTask 已在 script.js 中定义，不在此覆盖
}

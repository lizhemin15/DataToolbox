/**
 * 数据质量审核模块的可复用解析工具。
 * 保留旧行为：支持 Excel 复制粘贴的 TSV、引号多行、多列续行。
 */
(function () {
    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function parseExcelTSVWithQuotes(text) {
        var rows = [];
        var row = [];
        var field = '';
        var inQuotes = false;
        var i = 0;
        text = String(text || '');
        while (i < text.length) {
            var c = text.charAt(i);
            if (inQuotes) {
                if (c === '"') {
                    if (text.charAt(i + 1) === '"') {
                        field += '"';
                        i += 2;
                        continue;
                    }
                    inQuotes = false;
                    i++;
                    continue;
                }
                field += c;
                i++;
                continue;
            }
            if (c === '"') {
                inQuotes = true;
                i++;
                continue;
            }
            if (c === '\t') {
                row.push(field);
                field = '';
                i++;
                continue;
            }
            if (c === '\n') {
                row.push(field);
                field = '';
                rows.push(row);
                row = [];
                i++;
                continue;
            }
            if (c === '\r') {
                if (text.charAt(i + 1) === '\n') i++;
                row.push(field);
                field = '';
                rows.push(row);
                row = [];
                i++;
                continue;
            }
            field += c;
            i++;
        }
        row.push(field);
        if (row.length > 1 || field !== '') rows.push(row);
        return rows;
    }

    function looksLikeNmCell(s) {
        s = String(s || '').trim();
        return /^\d{1,6}$/.test(s);
    }

    function mergeRuleContinuationRows(parsedRows) {
        var out = [];
        var cur = null;
        (parsedRows || []).forEach(function (p) {
            if (!p || !p.length) return;
            if (p.length >= 3 && looksLikeNmCell(p[0])) {
                if (cur) out.push(cur);
                cur = {
                    nm: String(p[0] || '').trim().padStart(6, '0').slice(0, 6),
                    xh: (p[1] || '').trim(),
                    name: (p[2] || '').trim(),
                    sql: p[3] != null ? String(p[3]) : '',
                    category: p[4] != null ? String(p[4]).trim() : ''
                };
            } else if (cur) {
                cur.sql += '\n' + p.join('\t');
            }
        });
        if (cur) out.push(cur);
        return out;
    }

    function parseExcelPasteMergedLines(raw) {
        var lines = String(raw || '').split('\n');
        var rules = [];
        var cur = null;
        lines.forEach(function (line) {
            var p = line.split('\t');
            if (p.length >= 3 && looksLikeNmCell(p[0])) {
                if (cur) rules.push(cur);
                cur = {
                    nm: String(p[0] || '').trim().padStart(6, '0').slice(0, 6),
                    xh: (p[1] || '').trim(),
                    name: (p[2] || '').trim(),
                    sql: p[3] != null ? String(p[3]) : '',
                    category: (p[4] || '').trim()
                };
            } else if (cur) {
                cur.sql += '\n' + line;
            }
        });
        if (cur) rules.push(cur);
        return rules;
    }

    function parseExcelPasteRules(raw) {
        var trimmed = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        var parsedRows = parseExcelTSVWithQuotes(trimmed);
        var rules = mergeRuleContinuationRows(parsedRows);
        rules = rules.filter(function (r) {
            var h = String(r.nm || '').trim().toLowerCase();
            if (h === 'nm' || h === '') return false;
            return !!(r.nm && r.xh && r.name);
        });
        return rules.length ? rules : mergeRuleContinuationRows(trimmed.split('\n').map(function (line) { return line.split('\t'); })).filter(function (r) {
            return !!(r.nm && r.xh && r.name);
        });
    }

    function mergeFillContinuationRows(parsedRows) {
        var out = [];
        var cur = null;
        var lastTableName = '';
        (parsedRows || []).forEach(function (p) {
            if (!p || !p.length) return;
            var colCount = p.length;
            var tableName = String(p[0] || '').trim();
            var fieldName = '';
            var numerator = '';
            var denominator = '';

            if (colCount >= 4) {
                fieldName = String(p[1] || '').trim();
                numerator = p[2] != null ? String(p[2]) : '';
                denominator = p[3] != null ? String(p[3]) : '';
            } else if (colCount >= 3) {
                numerator = p[1] != null ? String(p[1]) : '';
                denominator = p[2] != null ? String(p[2]) : '';
            }

            if (tableName === '' && lastTableName !== '') {
                tableName = lastTableName;
            }

            if (tableName !== '') {
                if (cur) out.push(cur);
                cur = {
                    table_name: tableName,
                    field_name: fieldName,
                    numerator: numerator,
                    denominator: denominator
                };
                lastTableName = tableName;
            } else if (cur) {
                if (numerator) cur.numerator += '\n' + numerator;
                if (denominator) cur.denominator += '\n' + denominator;
            }
        });
        if (cur) out.push(cur);
        return out;
    }

    function parseExcelPasteMergedLinesFill(raw) {
        var lines = String(raw || '').split('\n');
        var rows = [];
        var cur = null;
        var lastTableName = '';
        lines.forEach(function (line) {
            var p = line.split('\t');
            var colCount = p.length;
            var tableName = String(p[0] || '').trim();
            var fieldName = '';
            var numerator = '';
            var denominator = '';

            if (colCount >= 4) {
                fieldName = String(p[1] || '').trim();
                numerator = p[2] != null ? String(p[2]) : '';
                denominator = p[3] != null ? String(p[3]) : '';
            } else if (colCount >= 3) {
                numerator = p[1] != null ? String(p[1]) : '';
                denominator = p[2] != null ? String(p[2]) : '';
            }

            if (tableName === '' && lastTableName !== '') {
                tableName = lastTableName;
            }

            if (tableName !== '') {
                if (cur) rows.push(cur);
                cur = {
                    table_name: tableName,
                    field_name: fieldName,
                    numerator: numerator,
                    denominator: denominator
                };
                lastTableName = tableName;
            } else if (cur) {
                if (numerator) cur.numerator += '\n' + numerator;
                if (denominator) cur.denominator += '\n' + denominator;
            }
        });
        if (cur) rows.push(cur);
        return rows;
    }

    function parseExcelPasteFillRates(raw) {
        var trimmed = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        var parsedRows = parseExcelTSVWithQuotes(trimmed);
        var rows = mergeFillContinuationRows(parsedRows);
        rows = rows.filter(function (r) {
            var h = String(r.table_name || '').trim().toLowerCase();
            if (h === '表名' || h === 'table_name' || h === 'table' || h === '') return false;
            return !!r.table_name;
        });
        return rows.length ? rows : mergeFillContinuationRows(trimmed.split('\n').map(function (line) { return line.split('\t'); })).filter(function (r) {
            var h = String(r.table_name || '').trim().toLowerCase();
            if (h === '表名' || h === 'table_name' || h === 'table' || h === '') return false;
            return !!r.table_name;
        });
    }

    function formatCellVal(v) {
        if (v === null || v === undefined) return '';
        if (typeof v === 'object') return escapeHtml(JSON.stringify(v));
        return escapeHtml(String(v));
    }

    function qaHex6FromCssColor(s) {
        s = String(s || '').trim();
        if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase();
        if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
            var h = s.slice(1);
            return ('#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2]).toLowerCase();
        }
        return '#000000';
    }

    function qaParseTplContent(raw) {
        var def = {
            doc_title: '数据质量审核报告',
            title: { font_family: 'Microsoft YaHei, SimHei, sans-serif', font_size: '24px', color: '#1a202c' },
            section: { font_family: 'Microsoft YaHei, SimHei, sans-serif', font_size: '16px', color: '#2d3748' },
            table: { border: '1px solid #cbd5e1', header_bg: '#edf2f7', row_alt: '#f8fafc' },
            page_header: '',
            page_footer: ''
        };
        try {
            var m = JSON.parse(String(raw || '{}'));
            if (m && typeof m === 'object') {
                if (m.doc_title != null && String(m.doc_title).trim() !== '') def.doc_title = String(m.doc_title);
                if (m.title && typeof m.title === 'object') {
                    if (m.title.font_family != null) def.title.font_family = String(m.title.font_family);
                    if (m.title.font_size != null) def.title.font_size = String(m.title.font_size);
                    if (m.title.color != null) def.title.color = String(m.title.color);
                }
                if (m.section && typeof m.section === 'object') {
                    if (m.section.font_family != null) def.section.font_family = String(m.section.font_family);
                    if (m.section.font_size != null) def.section.font_size = String(m.section.font_size);
                    if (m.section.color != null) def.section.color = String(m.section.color);
                }
                if (m.table && typeof m.table === 'object') {
                    if (m.table.border != null) def.table.border = String(m.table.border);
                    if (m.table.header_bg != null) def.table.header_bg = String(m.table.header_bg);
                    if (m.table.row_alt != null) def.table.row_alt = String(m.table.row_alt);
                }
                if (m.page_header != null) def.page_header = String(m.page_header);
                if (m.page_footer != null) def.page_footer = String(m.page_footer);
            }
        } catch (e) {}
        return def;
    }

    var shared = {
        escapeHtml: escapeHtml,
        parseExcelTSVWithQuotes: parseExcelTSVWithQuotes,
        mergeRuleContinuationRows: mergeRuleContinuationRows,
        parseExcelPasteRules: parseExcelPasteRules,
        mergeFillContinuationRows: mergeFillContinuationRows,
        parseExcelPasteFillRates: parseExcelPasteFillRates,
        formatCellVal: formatCellVal,
        qaHex6FromCssColor: qaHex6FromCssColor,
        qaParseTplContent: qaParseTplContent
    };

    if (typeof window !== 'undefined') {
        window.QA_SHARED = shared;
    }
    if (typeof globalThis !== 'undefined') {
        globalThis.QA_SHARED = shared;
    }
})();

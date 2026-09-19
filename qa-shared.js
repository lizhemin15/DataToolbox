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

    // parseRuleParamsCell 解析导入表的「参数」列。
    // 兼容三种写法：
    //   1) 标准 JSON：{"表名":"T","字段名":"C"}
    //   2) 被 TSV/Excel 引号解析吞掉引号的 JSON：{表名:T,字段名:C}
    //   3) 键值对：表名=T;字段名=C
    function parseRuleParamsCell(v) {
        var raw = String(v == null ? '' : v).trim();
        if (!raw) return {};
        var out = {};
        var assign = function (k, val) {
            k = String(k == null ? '' : k).trim().replace(/^["']|["']$/g, '');
            val = String(val == null ? '' : val).trim().replace(/^["']|["']$/g, '');
            if (k && val) out[k] = val;
        };
        if (raw.charAt(0) === '{') {
            try {
                var obj = JSON.parse(raw);
                Object.keys(obj || {}).forEach(function (k) {
                    var val = obj[k];
                    if (val !== null && val !== undefined && String(val).trim() !== '') assign(k, val);
                });
                return out;
            } catch (e) { /* 落回宽松解析 */ }
            raw.replace(/^\{/, '').replace(/\}$/, '').split(/[;,\n]/).forEach(function (pair) {
                var m = pair.match(/^\s*([^:=]+?)\s*[:=]\s*(.+?)\s*$/);
                if (m) assign(m[1], m[2]);
            });
            return out;
        }
        raw.split(/[;,\n]/).forEach(function (pair) {
            var m = pair.match(/^\s*([^:=]+?)\s*[:=]\s*(.+?)\s*$/);
            if (m) assign(m[1], m[2]);
        });
        return out;
    }

    // ===== 规则导入：AI 复核原则列（可选第 7 列）=====
    // 列顺序：NM / XH / 名称 / SQL / 类别 / 参数 / AI复核原则
    // 兼容要求：老文件只有前 6 列（甚至只有前 5 列）也必须能导入，缺列时该规则不跑 AI 复核。

    // looksLikeAiHeaderCell 判断表头单元格是否为「AI 复核原则」列（兼容历史叫法「人工审核规则」）
    function looksLikeAiHeaderCell(text) {
        var h = String(text == null ? '' : text).replace(/[\s　]/g, '').toLowerCase();
        if (!h) return false;
        return /ai复核|复核原则|ai审核|人工审核|aicheck|airereview/.test(h) || h === 'ai';
    }

    // detectAiReviewColumn 从前若干行里找表头行，再定位「AI 复核原则」列的下标。
    // 返回 { headerIdx, aiIdx }；没有表头或没有该列时 aiIdx = -1（表示按位置兜底）。
    function detectAiReviewColumn(rows) {
        var headerIdx = -1;
        for (var i = 0; i < (rows || []).length; i++) {
            var p = rows[i] || [];
            var first = String(p[0] == null ? '' : p[0]).trim();
            if (first.toLowerCase() === 'nm') { headerIdx = i; break; }
            if (first !== '') break;   // 第一行有内容但不是表头 → 无表头
        }
        if (headerIdx < 0) return { headerIdx: -1, aiIdx: -1 };
        var hdr = rows[headerIdx] || [];
        for (var j = 0; j < hdr.length; j++) {
            if (looksLikeAiHeaderCell(hdr[j])) return { headerIdx: headerIdx, aiIdx: j };
        }
        return { headerIdx: headerIdx, aiIdx: -1 };
    }

    // extractAiReviewColumn 把 AI 复核原则列从行里摘出来（列位置不固定也能认）。
    // 返回 { rows: 摘掉该列后的行, aiVals: 与行一一对应的 AI 原则文本（或 null 表示按第 7 列兜底） }
    function extractAiReviewColumn(rows) {
        var det = detectAiReviewColumn(rows);
        // 表头里没写该列 → 按位置兜底：第 7 列（下标 6）
        if (det.aiIdx < 0) return { rows: rows, aiVals: null };
        if (det.aiIdx === 6) return { rows: rows, aiVals: null };
        var aiVals = [];
        var out = [];
        (rows || []).forEach(function (p, i) {
            p = p || [];
            if (i === det.headerIdx) { out.push(p); aiVals[i] = ''; return; }
            var q = p.slice();
            var v = '';
            if (q.length > det.aiIdx) v = q.splice(det.aiIdx, 1)[0];
            aiVals[i] = v;
            out.push(q);
        });
        return { rows: out, aiVals: aiVals };
    }

    function mergeRuleContinuationRows(parsedRows, aiVals) {
        var out = [];
        var cur = null;
        (parsedRows || []).forEach(function (p, idx) {
            if (!p || !p.length) return;
            if (p.length >= 3 && looksLikeNmCell(p[0])) {
                if (cur) out.push(cur);
                var aiText = '';
                if (aiVals && aiVals[idx] != null) aiText = String(aiVals[idx]);
                else if (p[6] != null) aiText = String(p[6]);
                cur = {
                    nm: String(p[0] || '').trim().padStart(6, '0').slice(0, 6),
                    xh: (p[1] || '').trim(),
                    name: (p[2] || '').trim(),
                    sql: p[3] != null ? String(p[3]) : '',
                    category: p[4] != null ? String(p[4]).trim() : '',
                    params: parseRuleParamsCell(p[5]),
                    ai_review_prompt: String(aiText == null ? '' : aiText).trim()
                };
            } else if (cur) {
                cur.sql += '\n' + p.join('\t');
            }
        });
        if (cur) out.push(cur);
        return out;
    }

    // parseRuleRows 规则导入的统一入口：二维行数组（可含表头）→ 规则对象数组。
    // 供「粘贴导入」与「Excel 文件导入」共用，保证两条路径行为一致。
    function parseRuleRows(rows) {
        var cleaned = [];
        (rows || []).forEach(function (p) {
            if (!p || !p.length) return;
            cleaned.push((Array.isArray(p) ? p : [p]).map(function (c) { return c == null ? '' : String(c); }));
        });
        var ex = extractAiReviewColumn(cleaned);
        var rules = mergeRuleContinuationRows(ex.rows, ex.aiVals);
        return rules.filter(function (r) {
            var h = String(r.nm || '').trim().toLowerCase();
            if (h === 'nm' || h === '') return false;
            return !!(r.nm && r.xh && r.name);
        });
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
                    category: (p[4] || '').trim(),
                    params: parseRuleParamsCell(p[5])
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
        var rules = parseRuleRows(parseExcelTSVWithQuotes(trimmed));
        return rules.length ? rules : parseRuleRows(trimmed.split('\n').map(function (line) { return line.split('\t'); }));
    }

    /**
     * 填报率粘贴/导入的续行合并。
     * withField=true（项填报率）：列顺序 表名、字段名、分子、分母。
     * withField=false（记录填报率）：不涉及字段，列顺序 表名、分子、分母；
     *   若仍按老的 4 列格式（表名、字段名、分子、分母）粘贴，则忽略第 2 列字段名。
     */
    function mergeFillContinuationRows(parsedRows, withField) {
        if (withField === undefined) withField = true;
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

            if (withField) {
                if (colCount >= 4) {
                    fieldName = String(p[1] || '').trim();
                    numerator = p[2] != null ? String(p[2]) : '';
                    denominator = p[3] != null ? String(p[3]) : '';
                } else if (colCount >= 3) {
                    numerator = p[1] != null ? String(p[1]) : '';
                    denominator = p[2] != null ? String(p[2]) : '';
                }
            } else {
                if (colCount >= 4) {
                    numerator = p[2] != null ? String(p[2]) : '';
                    denominator = p[3] != null ? String(p[3]) : '';
                } else if (colCount >= 3) {
                    numerator = p[1] != null ? String(p[1]) : '';
                    denominator = p[2] != null ? String(p[2]) : '';
                } else if (colCount >= 2) {
                    numerator = p[1] != null ? String(p[1]) : '';
                }
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

    function parseExcelPasteMergedLinesFill(raw, withField) {
        if (withField === undefined) withField = true;
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

            if (withField) {
                if (colCount >= 4) {
                    fieldName = String(p[1] || '').trim();
                    numerator = p[2] != null ? String(p[2]) : '';
                    denominator = p[3] != null ? String(p[3]) : '';
                } else if (colCount >= 3) {
                    numerator = p[1] != null ? String(p[1]) : '';
                    denominator = p[2] != null ? String(p[2]) : '';
                }
            } else {
                if (colCount >= 4) {
                    numerator = p[2] != null ? String(p[2]) : '';
                    denominator = p[3] != null ? String(p[3]) : '';
                } else if (colCount >= 3) {
                    numerator = p[1] != null ? String(p[1]) : '';
                    denominator = p[2] != null ? String(p[2]) : '';
                } else if (colCount >= 2) {
                    numerator = p[1] != null ? String(p[1]) : '';
                }
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

    function parseExcelPasteFillRates(raw, withField) {
        if (withField === undefined) withField = true;
        var trimmed = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        var parsedRows = parseExcelTSVWithQuotes(trimmed);
        var rows = mergeFillContinuationRows(parsedRows, withField);
        rows = rows.filter(function (r) {
            var h = String(r.table_name || '').trim().toLowerCase();
            if (h === '表名' || h === 'table_name' || h === 'table' || h === '') return false;
            return !!r.table_name;
        });
        return rows.length ? rows : mergeFillContinuationRows(trimmed.split('\n').map(function (line) { return line.split('\t'); }), withField).filter(function (r) {
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
        parseRuleParamsCell: parseRuleParamsCell,
        parseExcelPasteRules: parseExcelPasteRules,
        parseRuleRows: parseRuleRows,
        detectAiReviewColumn: detectAiReviewColumn,
        looksLikeAiHeaderCell: looksLikeAiHeaderCell,
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

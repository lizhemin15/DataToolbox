/**
 * 数据质量审核：嵌入主应用 tab，依赖 script.js 中的 API_BASE、fetchWithAuth。
 */
(function () {
    var PREFIX = API_BASE + '/api/data-ontology/quality-audit/';
    var ruleTree = [];
    var flatRules = [];
    var selectedNms = {};
    var lastAudit = null;
    var listenersBound = false;

    function showMsg(text, isErr) {
        var el = document.getElementById('qaMsg');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'qa-msg show ' + (isErr ? 'err' : 'ok');
        if (!text) el.classList.remove('show');
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatCellVal(v) {
        if (v === null || v === undefined) return '';
        if (typeof v === 'object') return escapeHtml(JSON.stringify(v));
        return escapeHtml(String(v));
    }

    function renderSampleRowsTable(sampleRows) {
        if (!sampleRows || !sampleRows.length) return '';
        var keys = Object.keys(sampleRows[0] || {});
        if (!keys.length) return '';
        var th = keys.map(function (k) { return '<th>' + escapeHtml(k) + '</th>'; }).join('');
        var trs = sampleRows.map(function (row) {
            var tds = keys.map(function (k) {
                return '<td>' + formatCellVal(row[k]) + '</td>';
            }).join('');
            return '<tr>' + tds + '</tr>';
        }).join('');
        return '<table class="qa-sample-table"><thead><tr>' + th + '</tr></thead><tbody>' + trs + '</tbody></table>';
    }

    function renderAuditResult(audit) {
        var wrap = document.getElementById('qaAuditResult');
        if (!wrap) return;
        if (!audit) {
            wrap.style.display = 'none';
            wrap.innerHTML = '';
            return;
        }
        var hasRules = audit.rules && audit.rules.length;
        var hasFill = (audit.item_fill_rates && audit.item_fill_rates.length) ||
            (audit.record_fill_rates && audit.record_fill_rates.length);
        if (!hasRules && !hasFill) {
            wrap.style.display = 'none';
            wrap.innerHTML = '';
            return;
        }
        var sum = audit.summary || {};
        var head =
            '<div class="qa-audit-result-hd">审核结果' +
            (hasRules && (sum.passed != null || sum.failed != null)
                ? ' <span class="qa-audit-sum">通过 ' + escapeHtml(sum.passed) + ' / 不通过 ' + escapeHtml(sum.failed) + '</span>'
                : '') +
            '</div>';
        var ruleRows = (audit.rules || []).map(function (r) {
            var nm = escapeHtml(r.nm || '');
            var name = escapeHtml(r.name || '');
            var status;
            var detail = '';
            if (r.skipped) {
                status = '<span class="qa-badge qa-badge-skip">跳过</span>';
                detail = escapeHtml(r.message || '');
            } else if (r.error) {
                status = '<span class="qa-badge qa-badge-fail">错误</span>';
                detail = escapeHtml(r.error);
            } else if (r.passed === true) {
                status = '<span class="qa-badge qa-badge-pass">通过</span>';
                detail = '违规行数 0';
            } else {
                status = '<span class="qa-badge qa-badge-fail">不通过</span>';
                var vc = r.violation_count;
                detail = '违规行数 ' + escapeHtml(vc != null ? vc : '') + (r.sample_rows && r.sample_rows.length ? '（示例见下表）' : '');
                if (r.sample_rows && r.sample_rows.length) {
                    detail += '<div class="qa-detail-sample">' + renderSampleRowsTable(r.sample_rows) + '</div>';
                }
            }
            return '<tr><td><code>' + nm + '</code></td><td>' + name + '</td><td>' + status + '</td><td class="qa-detail-cell">' + detail + '</td></tr>';
        }).join('');

        var fillBlocks = '';
        function fillSection(title, rows) {
            if (!rows || !rows.length) return '';
            var thead = '<thead><tr><th>表名</th><th>分子</th><th>分母</th><th>填报率</th><th>备注</th></tr></thead>';
            var body = '<tbody>' + rows.map(function (x) {
                var rate = x.rate_percent != null ? (Number(x.rate_percent).toFixed(2) + '%') : '—';
                var note = '';
                if (x.numerator_error) note += '分子: ' + x.numerator_error + ' ';
                if (x.denominator_error) note += '分母: ' + x.denominator_error;
                return '<tr><td>' + escapeHtml(x.table_name || '') + '</td><td>' + formatCellVal(x.numerator) + '</td><td>' + formatCellVal(x.denominator) + '</td><td>' + escapeHtml(rate) + '</td><td>' + escapeHtml(note.trim()) + '</td></tr>';
            }).join('') + '</tbody>';
            return '<div class="qa-fill-section"><strong>' + escapeHtml(title) + '</strong><table class="qa-result-table qa-fill-rate-table">' + thead + body + '</table></div>';
        }
        fillBlocks += fillSection('项填报率', audit.item_fill_rates);
        fillBlocks += fillSection('记录填报率', audit.record_fill_rates);

        var rulesTable = hasRules
            ? '<table class="qa-result-table"><thead><tr><th>规则 NM</th><th>名称</th><th>结果</th><th>详情</th></tr></thead><tbody>' +
                ruleRows +
                '</tbody></table>'
            : '';
        wrap.innerHTML = head + rulesTable + fillBlocks;
        wrap.style.display = 'block';
    }

    function padNm(s) {
        s = String(s || '').trim();
        if (!s) return '';
        while (s.length < 6) s = '0' + s;
        return s.length > 6 ? s.slice(0, 6) : s;
    }

    /** Excel 剪贴板 TSV：支持引号内换行、制表符；与 Excel 多行单元格一致 */
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

    /** 将「非新规则起始行」合并到上一条的 SQL（无引号粘贴时 SQL 换行会变成多物理行） */
    function mergeRuleContinuationRows(parsedRows) {
        var out = [];
        var cur = null;
        (parsedRows || []).forEach(function (p) {
            if (!p || !p.length) return;
            if (p.length >= 3 && looksLikeNmCell(p[0])) {
                if (cur) out.push(cur);
                cur = {
                    nm: padNm(p[0]),
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
        var lines = String(raw || '').split(/\n/);
        var rules = [];
        var cur = null;
        lines.forEach(function (line) {
            var p = line.split('\t');
            if (p.length >= 3 && looksLikeNmCell(p[0])) {
                if (cur) rules.push(cur);
                cur = {
                    nm: padNm(p[0]),
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
        if (rules.length) return rules;
        return parseExcelPasteMergedLines(trimmed).filter(function (r) {
            return !!(r.nm && r.xh && r.name);
        });
    }

    /** 填报率：列顺序 表名、分子、分母。多行单元格应用 Excel 引号粘贴，由 parseExcelTSVWithQuotes 解析；无引号续行时首列为空则按列并入分子/分母 */
    function mergeFillContinuationRows(parsedRows) {
        var out = [];
        var cur = null;
        (parsedRows || []).forEach(function (p) {
            if (!p || !p.length) return;
            if (p.length >= 3 && String(p[0] || '').trim() !== '') {
                if (cur) out.push(cur);
                cur = {
                    table_name: String(p[0] || '').trim(),
                    numerator: p[1] != null ? String(p[1]) : '',
                    denominator: p[2] != null ? String(p[2]) : ''
                };
            } else if (cur) {
                if (p.length >= 3 && String(p[0] || '').trim() === '') {
                    var ns = p[1] != null ? String(p[1]) : '';
                    var ds = p[2] != null ? String(p[2]) : '';
                    if (ns) cur.numerator += '\n' + ns;
                    if (ds) cur.denominator += '\n' + ds;
                } else {
                    cur.numerator += '\n' + p.join('\t');
                }
            }
        });
        if (cur) out.push(cur);
        return out;
    }

    function parseExcelPasteMergedLinesFill(raw) {
        var lines = String(raw || '').split(/\n/);
        var rows = [];
        var cur = null;
        lines.forEach(function (line) {
            var p = line.split('\t');
            if (p.length >= 3 && String(p[0] || '').trim() !== '') {
                if (cur) rows.push(cur);
                cur = {
                    table_name: String(p[0] || '').trim(),
                    numerator: p[1] != null ? String(p[1]) : '',
                    denominator: p[2] != null ? String(p[2]) : ''
                };
            } else if (cur) {
                var pp = line.split('\t');
                if (pp.length >= 3 && String(pp[0] || '').trim() === '') {
                    var ns2 = pp[1] != null ? String(pp[1]) : '';
                    var ds2 = pp[2] != null ? String(pp[2]) : '';
                    if (ns2) cur.numerator += '\n' + ns2;
                    if (ds2) cur.denominator += '\n' + ds2;
                } else {
                    cur.numerator += '\n' + line;
                }
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
        if (rows.length) return rows;
        return parseExcelPasteMergedLinesFill(trimmed).filter(function (r) {
            var h = String(r.table_name || '').trim().toLowerCase();
            if (h === '表名' || h === 'table_name' || h === 'table' || h === '') return false;
            return !!r.table_name;
        });
    }

    function collectSubtreeNms(node, out) {
        out = out || [];
        out.push(node.nm);
        (node.children || []).forEach(function (ch) {
            collectSubtreeNms(ch, out);
        });
        return out;
    }

    function isSubtreeFullySelected(node) {
        if (!node.children || !node.children.length) {
            return !!selectedNms[node.nm];
        }
        return node.children.every(function (ch) {
            return isSubtreeFullySelected(ch);
        });
    }

    function reconcileTree(nodes) {
        nodes.forEach(function (n) {
            if (n.children && n.children.length) {
                reconcileTree(n.children);
                if (n.children.every(function (ch) { return isSubtreeFullySelected(ch); })) {
                    selectedNms[n.nm] = true;
                } else {
                    delete selectedNms[n.nm];
                }
            }
        });
    }

    function captureOpenState(container) {
        var state = {};
        if (!container) return state;
        container.querySelectorAll('details').forEach(function (d) {
            var k = d.dataset.treeNm;
            if (k) state[k] = d.open;
        });
        return state;
    }

    function bindRuleCheckbox(cb, n, hasKids) {
        cb.addEventListener('click', function (e) {
            e.stopPropagation();
        });
        cb.addEventListener('change', function () {
            var treeEl = document.getElementById('qaTree');
            if (hasKids) {
                var nms = collectSubtreeNms(n);
                if (cb.checked) {
                    nms.forEach(function (nm) { selectedNms[nm] = true; });
                } else {
                    nms.forEach(function (nm) { delete selectedNms[nm]; });
                }
            } else {
                if (cb.checked) selectedNms[n.nm] = true;
                else delete selectedNms[n.nm];
            }
            reconcileTree(ruleTree);
            var openState = captureOpenState(treeEl);
            renderTree(ruleTree, treeEl, openState);
        });
    }

    function renderTree(nodes, container, openState) {
        openState = openState || {};
        container.innerHTML = '';
        nodes.forEach(function (n) {
            var hasKids = n.children && n.children.length;
            if (hasKids) {
                var det = document.createElement('details');
                var nmKey = String(n.nm);
                det.dataset.treeNm = nmKey;
                det.open = openState[nmKey] !== undefined ? !!openState[nmKey] : true;
                var sum = document.createElement('summary');
                var line = document.createElement('div');
                line.className = 'rule-line';
                var toggle = document.createElement('span');
                toggle.className = 'qa-tree-toggle';
                toggle.setAttribute('aria-hidden', 'true');
                var cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.dataset.nm = n.nm;
                cb.checked = isSubtreeFullySelected(n);
                bindRuleCheckbox(cb, n, true);
                line.appendChild(toggle);
                line.appendChild(cb);
                line.appendChild(document.createTextNode(' ' + (n.name || '') + ' '));
                var c = document.createElement('code');
                c.textContent = n.nm + ' / ' + n.xh;
                line.appendChild(c);
                sum.appendChild(line);
                sum.addEventListener('click', function (e) {
                    if (e.target.tagName === 'INPUT') return;
                    fillEditor(n);
                });
                det.appendChild(sum);
                var inner = document.createElement('div');
                renderTree(n.children, inner, openState);
                det.appendChild(inner);
                container.appendChild(det);
            } else {
                var div = document.createElement('div');
                div.className = 'rule-line';
                div.style.padding = '4px 0';
                var leafSp = document.createElement('span');
                leafSp.className = 'qa-tree-leaf-spacer';
                leafSp.setAttribute('aria-hidden', 'true');
                var cb2 = document.createElement('input');
                cb2.type = 'checkbox';
                cb2.dataset.nm = n.nm;
                cb2.checked = !!selectedNms[n.nm];
                bindRuleCheckbox(cb2, n, false);
                div.appendChild(leafSp);
                div.appendChild(cb2);
                div.appendChild(document.createTextNode(' ' + (n.name || '') + ' '));
                var c2 = document.createElement('code');
                c2.textContent = n.nm + ' / ' + n.xh;
                div.appendChild(c2);
                div.addEventListener('click', function (e) {
                    if (e.target.tagName === 'INPUT') return;
                    fillEditor(n);
                });
                container.appendChild(div);
            }
        });
    }

    function fillEditor(rule) {
        document.getElementById('qaNm').value = rule.nm || '';
        document.getElementById('qaXh').value = rule.xh || '';
        document.getElementById('qaName').value = rule.name || '';
        document.getElementById('qaCategory').value = rule.category || '';
        document.getElementById('qaSql').value = rule.sql || '';
    }

    function loadRules() {
        return fetchWithAuth(PREFIX + 'rules').then(function (r) { return r.json(); }).then(function (d) {
            if (!d.success) throw new Error(d.message || '加载失败');
            ruleTree = d.tree || [];
            flatRules = d.flat || [];
            renderTree(ruleTree, document.getElementById('qaTree'));
        });
    }

    function loadDatabases() {
        return fetchWithAuth(API_BASE + '/api/data-ontology/databases').then(function (r) { return r.json(); }).then(function (d) {
            if (!d.success) throw new Error(d.message || '加载数据库失败');
            var sel = document.getElementById('qaDbSelect');
            sel.innerHTML = '<option value="">请选择</option>';
            (d.databases || []).forEach(function (db) {
                var sqlTypes = { mysql:1,mariadb:1,tidb:1,postgresql:1,timescaledb:1,cockroachdb:1,sqlserver:1,oracle:1,dm:1,sqlite:1 };
                if (!sqlTypes[db.type]) return;
                var o = document.createElement('option');
                o.value = db.id;
                o.textContent = db.name + ' (' + db.type + ')';
                sel.appendChild(o);
            });
        });
    }

    var QA_FILL_ROWS_MIN = 2;
    var QA_FILL_ROWS_MAX = 10;

    function adjustQaFillTextarea(ta) {
        if (!ta) return;
        var s = String(ta.value || '');
        var lineCount = s ? s.split('\n').length : 1;
        var r = lineCount;
        if (r < QA_FILL_ROWS_MIN) r = QA_FILL_ROWS_MIN;
        if (r > QA_FILL_ROWS_MAX) r = QA_FILL_ROWS_MAX;
        ta.rows = r;
    }

    function bindQaFillTextarea(ta) {
        ta.addEventListener('input', function () {
            adjustQaFillTextarea(ta);
        });
    }

    function normalizeFillRow(row) {
        row = row || {};
        return {
            table_name: row.table_name != null ? String(row.table_name) : '',
            numerator: row.numerator != null ? String(row.numerator) : '',
            denominator: row.denominator != null ? String(row.denominator) : '',
            checked: row.checked !== false
        };
    }

    function createFillNode(row) {
        row = normalizeFillRow(row);
        var wrap = document.createElement('div');
        wrap.className = 'qa-fill-node';
        var hd = document.createElement('div');
        hd.className = 'rule-line qa-fill-node-hd';
        var leafSp = document.createElement('span');
        leafSp.className = 'qa-tree-leaf-spacer';
        leafSp.setAttribute('aria-hidden', 'true');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'qa-fill-cb';
        cb.checked = row.checked;
        cb.addEventListener('click', function (e) {
            e.stopPropagation();
        });
        var nameIn = document.createElement('input');
        nameIn.type = 'text';
        nameIn.className = 'qa-fill-table-name';
        nameIn.placeholder = '表名';
        nameIn.value = row.table_name;
        var rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn btn-sm qa-rm qa-fill-rm';
        rm.textContent = '删除';
        hd.appendChild(leafSp);
        hd.appendChild(cb);
        hd.appendChild(nameIn);
        hd.appendChild(rm);
        var bd = document.createElement('div');
        bd.className = 'qa-fill-node-bd';
        var ln = document.createElement('label');
        ln.className = 'qa-fill-sql-label';
        ln.textContent = '分子 SQL';
        var taN = document.createElement('textarea');
        taN.className = 'qa-fill-sql';
        taN.setAttribute('data-k', 'n');
        taN.placeholder = 'SELECT ...';
        taN.value = row.numerator;
        var ld = document.createElement('label');
        ld.className = 'qa-fill-sql-label';
        ld.textContent = '分母 SQL';
        var taD = document.createElement('textarea');
        taD.className = 'qa-fill-sql';
        taD.setAttribute('data-k', 'd');
        taD.placeholder = 'SELECT ...';
        taD.value = row.denominator;
        bd.appendChild(ln);
        bd.appendChild(taN);
        bd.appendChild(ld);
        bd.appendChild(taD);
        wrap.appendChild(hd);
        wrap.appendChild(bd);
        bindQaFillTextarea(taN);
        bindQaFillTextarea(taD);
        adjustQaFillTextarea(taN);
        adjustQaFillTextarea(taD);
        rm.addEventListener('click', function () {
            var root = wrap.parentNode;
            if (root && root.querySelectorAll('.qa-fill-node').length > 1) {
                wrap.remove();
            }
        });
        return wrap;
    }

    function renderFillTree(treeId, rows) {
        var root = document.getElementById(treeId);
        if (!root) return;
        root.innerHTML = '';
        if (!rows || !rows.length) {
            rows = [{ table_name: '', numerator: '', denominator: '', checked: true }];
        }
        rows.forEach(function (r) {
            root.appendChild(createFillNode(r));
        });
    }

    function setFillTreeChecked(treeId, val) {
        var root = document.getElementById(treeId);
        if (!root) return;
        root.querySelectorAll('.qa-fill-cb').forEach(function (cb) {
            cb.checked = val;
        });
    }

    function loadFillRates() {
        return fetchWithAuth(PREFIX + 'fill-rates').then(function (r) { return r.json(); }).then(function (d) {
            if (!d.success) throw new Error(d.message || '加载填报率失败');
            renderFillTree('qaFillItemTree', d.item_fill_rate || []);
            renderFillTree('qaFillRecordTree', d.record_fill_rate || []);
        });
    }

    function collectFill(treeId) {
        var rows = [];
        var root = document.getElementById(treeId);
        if (!root) return rows;
        root.querySelectorAll('.qa-fill-node').forEach(function (node) {
            var tIn = node.querySelector('.qa-fill-table-name');
            var t = tIn && String(tIn.value || '').trim();
            if (!t) return;
            var cb = node.querySelector('.qa-fill-cb');
            var n = node.querySelector('textarea[data-k="n"]');
            var d = node.querySelector('textarea[data-k="d"]');
            rows.push({
                table_name: t,
                numerator: n ? n.value : '',
                denominator: d ? d.value : '',
                checked: !!(cb && cb.checked)
            });
        });
        return rows;
    }

    function bindListeners() {
        if (listenersBound) return;
        try {
        document.getElementById('qaSaveRule').addEventListener('click', function () {
            var body = {
                nm: padNm(document.getElementById('qaNm').value),
                xh: document.getElementById('qaXh').value.trim(),
                name: document.getElementById('qaName').value.trim(),
                category: document.getElementById('qaCategory').value.trim(),
                sql: document.getElementById('qaSql').value
            };
            fetchWithAuth(PREFIX + 'rules', { method: 'POST', body: JSON.stringify(body) })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (!d.success) throw new Error(d.message);
                    showMsg('已保存', false);
                    return loadRules();
                })
                .catch(function (e) { showMsg(e.message || String(e), true); });
        });

        document.getElementById('qaDelRule').addEventListener('click', function () {
            var nm = padNm(document.getElementById('qaNm').value);
            if (!nm || !confirm('确定删除 ' + nm + ' ?')) return;
            fetchWithAuth(PREFIX + 'rules/' + encodeURIComponent(nm), { method: 'DELETE' })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (!d.success) throw new Error(d.message);
                    showMsg('已删除', false);
                    return loadRules();
                })
                .catch(function (e) { showMsg(e.message || String(e), true); });
        });

        document.getElementById('qaPasteExcel').addEventListener('click', function () {
            var raw = prompt('请从 Excel 复制多行（列顺序：NM, XH, 名称, SQL, 类别），粘贴到此处：');
            if (!raw) return;
            var rules = parseExcelPasteRules(raw);
            if (!rules.length) { showMsg('未解析到有效行', true); return; }
            fetchWithAuth(PREFIX + 'rules/import', { method: 'POST', body: JSON.stringify({ rules: rules }) })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (!d.success) throw new Error(d.message);
                    showMsg('导入 ' + (d.imported || rules.length) + ' 条', false);
                    return loadRules();
                })
                .catch(function (e) { showMsg(e.message || String(e), true); });
        });

        document.getElementById('qaXlsxFile').addEventListener('change', function (ev) {
            var f = ev.target.files && ev.target.files[0];
            ev.target.value = '';
            if (!f || typeof XLSX === 'undefined') return;
            var reader = new FileReader();
            reader.onload = function () {
                try {
                    var wb = XLSX.read(reader.result, { type: 'array' });
                    var sh = wb.Sheets[wb.SheetNames[0]];
                    var data = XLSX.utils.sheet_to_json(sh, { header: 1, raw: false, defval: '' });
                    var rows = [];
                    data.forEach(function (row) {
                        if (!row || !row.length) return;
                        var r0 = String(row[0] != null ? row[0] : '').trim();
                        if (r0.toLowerCase() === 'nm') return;
                        rows.push(row.map(function (c) { return c == null ? '' : String(c); }));
                    });
                    var rules = mergeRuleContinuationRows(rows);
                    rules = rules.filter(function (r) { return r.nm && r.xh && r.name; });
                    if (!rules.length) { showMsg('表中无有效数据', true); return; }
                    fetchWithAuth(PREFIX + 'rules/import', { method: 'POST', body: JSON.stringify({ rules: rules }) })
                        .then(function (r) { return r.json(); })
                        .then(function (d) {
                            if (!d.success) throw new Error(d.message);
                            showMsg('导入 ' + (d.imported || rules.length) + ' 条', false);
                            return loadRules();
                        })
                        .catch(function (e) { showMsg(e.message || String(e), true); });
                } catch (e) {
                    showMsg(e.message || String(e), true);
                }
            };
            reader.readAsArrayBuffer(f);
        });

        document.querySelectorAll('#qualityTab .qa-tab').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('#qualityTab .qa-tab').forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                var fr = btn.getAttribute('data-fr');
                document.getElementById('qaFillItem').style.display = fr === 'item' ? 'block' : 'none';
                document.getElementById('qaFillRecord').style.display = fr === 'record' ? 'block' : 'none';
            });
        });

        document.getElementById('qaFillItemAll').addEventListener('click', function () {
            setFillTreeChecked('qaFillItemTree', true);
        });
        document.getElementById('qaFillItemNone').addEventListener('click', function () {
            setFillTreeChecked('qaFillItemTree', false);
        });
        document.getElementById('qaFillRecordAll').addEventListener('click', function () {
            setFillTreeChecked('qaFillRecordTree', true);
        });
        document.getElementById('qaFillRecordNone').addEventListener('click', function () {
            setFillTreeChecked('qaFillRecordTree', false);
        });

        document.getElementById('qaAddRowItem').addEventListener('click', function () {
            var root = document.getElementById('qaFillItemTree');
            if (root) root.appendChild(createFillNode({ table_name: '', numerator: '', denominator: '', checked: true }));
        });
        document.getElementById('qaAddRowRecord').addEventListener('click', function () {
            var root = document.getElementById('qaFillRecordTree');
            if (root) root.appendChild(createFillNode({ table_name: '', numerator: '', denominator: '', checked: true }));
        });

        document.getElementById('qaSaveFill').addEventListener('click', function () {
            var body = {
                item_fill_rate: collectFill('qaFillItemTree'),
                record_fill_rate: collectFill('qaFillRecordTree')
            };
            fetchWithAuth(PREFIX + 'fill-rates', { method: 'POST', body: JSON.stringify(body) })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (!d.success) throw new Error(d.message);
                    showMsg('填报率已保存', false);
                })
                .catch(function (e) { showMsg(e.message || String(e), true); });
        });

        document.getElementById('qaPasteFill').addEventListener('click', function () {
            var raw = prompt('请从 Excel 复制多行（列顺序：表名, 分子, 分母），粘贴到此处：');
            if (!raw) return;
            var parsed = parseExcelPasteFillRates(raw);
            if (!parsed.length) { showMsg('未解析到有效行', true); return; }
            var itemVisible = document.getElementById('qaFillItem').style.display !== 'none';
            var treeId = itemVisible ? 'qaFillItemTree' : 'qaFillRecordTree';
            var withChecked = parsed.map(function (p) {
                return normalizeFillRow(p);
            });
            renderFillTree(treeId, withChecked);
            showMsg('已填充 ' + parsed.length + ' 行（' + (itemVisible ? '项填报率' : '记录填报率') + '）', false);
        });

        document.getElementById('qaExpandAll').addEventListener('click', function () {
            document.querySelectorAll('#qualityTab .qa-tree details').forEach(function (d) { d.open = true; });
        });

        document.getElementById('qaRun').addEventListener('click', function () {
            var dbId = document.getElementById('qaDbSelect').value;
            var ruleNms = Object.keys(selectedNms);
            if (!dbId) { showMsg('请选择数据库', true); return; }
            if (!ruleNms.length) { showMsg('请勾选规则', true); return; }
            showMsg('执行中…', false);
            fetchWithAuth(PREFIX + 'execute', {
                method: 'POST',
                body: JSON.stringify({ database_id: dbId, rule_nms: ruleNms })
            }).then(function (r) { return r.json();             }).then(function (d) {
                if (!d.success) throw new Error(d.message || '执行失败');
                lastAudit = d;
                showMsg('审核完成：通过 ' + (d.summary && d.summary.passed) + '，不通过 ' + (d.summary && d.summary.failed), false);
                renderAuditResult(d);
            }).catch(function (e) { showMsg(e.message || String(e), true); });
        });

        document.getElementById('qaReport').addEventListener('click', function () {
            if (!lastAudit) { showMsg('请先执行一键审核', true); return; }
            fetchWithAuth(PREFIX + 'report', {
                method: 'POST',
                body: JSON.stringify({ audit: lastAudit })
            }).then(function (r) {
                var ct = r.headers.get('Content-Type') || '';
                if (!r.ok || ct.indexOf('json') !== -1) {
                    return r.json().then(function (j) { throw new Error((j && j.message) || r.statusText); });
                }
                return r.blob();
            }).then(function (blob) {
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'quality-audit-report.docx';
                a.click();
                URL.revokeObjectURL(a.href);
            }).catch(function (e) { showMsg(e.message || String(e), true); });
        });
        listenersBound = true;
        try { window.__qaPasteImportBound = true; } catch (e2) {}
        } catch (e) {
            try { console.error('quality-audit bindListeners:', e); } catch (e3) {}
        }
    }

    window.initQualityAuditTab = function () {
        bindListeners();
        if (window._qualityAuditDataLoaded) return;
        window._qualityAuditDataLoaded = true;
        loadRules().then(loadDatabases).then(loadFillRates).catch(function (e) {
            showMsg(e.message || String(e), true);
        });
    };

    bindListeners();

    window.__qaVerifyPasteImport = function () {
        var pe = document.getElementById('qaPasteExcel');
        var pf = document.getElementById('qaPasteFill');
        if (!pe || !pf) {
            return { ok: false, reason: 'missing #qaPasteExcel or #qaPasteFill' };
        }
        return {
            ok: !!window.__qaPasteImportBound,
            listenersBound: listenersBound,
            ids: { qaPasteExcel: !!pe, qaPasteFill: !!pf }
        };
    };

    /** 填报率粘贴解析自测（控制台：__qaRunPasteFillTests()） */
    window.__qaRunPasteFillTests = function () {
        var failures = [];
        function fail(msg) { failures.push(msg); }
        function assertEq(actual, expected, label) {
            if (actual !== expected) fail(label + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
        }
        var sample = '表名\t分子SQL\t分母SQL\ntable1\t"SELECT *\nFROM a"\t"SELECT *\nFROM b"\ntable2\tSELECT id\tSELECT *';
        var rows = parseExcelPasteFillRates(sample);
        if (rows.length !== 2) fail('rows.length should be 2, got ' + rows.length);
        if (rows[0]) {
            assertEq(rows[0].table_name, 'table1', 'row0 table_name');
            assertEq(rows[0].numerator, 'SELECT *\nFROM a', 'row0 numerator multiline');
            assertEq(rows[0].denominator, 'SELECT *\nFROM b', 'row0 denominator multiline');
        }
        if (rows[1]) {
            assertEq(rows[1].table_name, 'table2', 'row1 table_name');
            assertEq(rows[1].numerator, 'SELECT id', 'row1 numerator');
            assertEq(rows[1].denominator, 'SELECT *', 'row1 denominator');
        }
        var tsv = parseExcelTSVWithQuotes('a\t"b\tc"\td');
        if (!tsv.length || tsv[0].length !== 3 || tsv[0][1] !== 'b\tc') fail('quoted tab inside field');
        var tsvNl = parseExcelTSVWithQuotes('t\t"x\ny"\tz');
        if (!tsvNl.length || tsvNl[0][1] !== 'x\ny') fail('quoted newline inside field');
        var cont = parseExcelPasteFillRates('t1\tA\tB\n\tC\tD');
        if (cont.length !== 1 || cont[0].numerator !== 'A\nC' || cont[0].denominator !== 'B\nD') fail('continuation empty first column');
        return { ok: failures.length === 0, failures: failures };
    };
})();

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

    function padNm(s) {
        s = String(s || '').trim();
        if (!s) return '';
        while (s.length < 6) s = '0' + s;
        return s.length > 6 ? s.slice(0, 6) : s;
    }

    function renderTree(nodes, container) {
        container.innerHTML = '';
        nodes.forEach(function (n) {
            var hasKids = n.children && n.children.length;
            if (hasKids) {
                var det = document.createElement('details');
                det.open = true;
                var sum = document.createElement('summary');
                var line = document.createElement('div');
                line.className = 'rule-line';
                var cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.dataset.nm = n.nm;
                cb.checked = !!selectedNms[n.nm];
                cb.addEventListener('change', function () {
                    if (cb.checked) selectedNms[n.nm] = true; else delete selectedNms[n.nm];
                });
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
                renderTree(n.children, inner);
                det.appendChild(inner);
                container.appendChild(det);
            } else {
                var div = document.createElement('div');
                div.className = 'rule-line';
                div.style.padding = '4px 0 4px 8px';
                var cb2 = document.createElement('input');
                cb2.type = 'checkbox';
                cb2.dataset.nm = n.nm;
                cb2.checked = !!selectedNms[n.nm];
                cb2.addEventListener('change', function () {
                    if (cb2.checked) selectedNms[n.nm] = true; else delete selectedNms[n.nm];
                });
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

    function loadFillRates() {
        return fetchWithAuth(PREFIX + 'fill-rates').then(function (r) { return r.json(); }).then(function (d) {
            if (!d.success) throw new Error(d.message || '加载填报率失败');
            fillTableRows('qaTableItem', d.item_fill_rate || []);
            fillTableRows('qaTableRecord', d.record_fill_rate || []);
        });
    }

    function fillTableRows(tableId, rows) {
        var tb = document.querySelector('#' + tableId + ' tbody');
        tb.innerHTML = '';
        if (!rows.length) rows = [{ table_name: '', numerator: '', denominator: '' }];
        rows.forEach(function (row) {
            addRow(tb, row.table_name || '', row.numerator || '', row.denominator || '');
        });
    }

    function addRow(tbody, a, b, c) {
        var tr = document.createElement('tr');
        ['t', 'n', 'd'].forEach(function (k, i) {
            var td = document.createElement('td');
            var inp = document.createElement('input');
            inp.setAttribute('data-k', k);
            inp.value = [a, b, c][i] || '';
            td.appendChild(inp);
            tr.appendChild(td);
        });
        var tdGo = document.createElement('td');
        var rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn btn-sm qa-rm';
        rm.textContent = '删除';
        rm.addEventListener('click', function () {
            if (tbody.children.length > 1) tr.remove();
        });
        tdGo.appendChild(rm);
        tr.appendChild(tdGo);
        tbody.appendChild(tr);
    }

    function collectFill(tableId) {
        var rows = [];
        document.querySelectorAll('#' + tableId + ' tbody tr').forEach(function (tr) {
            var ins = tr.querySelectorAll('input[data-k]');
            var t = ins[0] && ins[0].value.trim();
            if (!t) return;
            rows.push({
                table_name: t,
                numerator: ins[1] ? ins[1].value : '',
                denominator: ins[2] ? ins[2].value : ''
            });
        });
        return rows;
    }

    function bindListeners() {
        if (listenersBound) return;
        listenersBound = true;

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
            var lines = raw.trim().split(/\r?\n/);
            var rules = [];
            lines.forEach(function (line) {
                var p = line.split('\t');
                if (p.length < 3) return;
                rules.push({
                    nm: padNm(p[0]),
                    xh: (p[1] || '').trim(),
                    name: (p[2] || '').trim(),
                    sql: p[3] != null ? String(p[3]) : '',
                    category: (p[4] || '').trim()
                });
            });
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
                    var data = XLSX.utils.sheet_to_json(sh, { header: 1, raw: false });
                    var rules = [];
                    data.forEach(function (row) {
                        if (!row || !row.length) return;
                        var p = row;
                        if ((p[0] + '').trim() === 'NM' || (p[0] + '').trim() === 'nm') return;
                        rules.push({
                            nm: padNm(p[0]),
                            xh: (p[1] !== undefined ? String(p[1]) : '').trim(),
                            name: (p[2] !== undefined ? String(p[2]) : '').trim(),
                            sql: p[3] !== undefined ? String(p[3]) : '',
                            category: p[4] !== undefined ? String(p[4]).trim() : ''
                        });
                    });
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

        document.getElementById('qaAddRowItem').addEventListener('click', function () {
            addRow(document.querySelector('#qaTableItem tbody'), '', '', '');
        });
        document.getElementById('qaAddRowRecord').addEventListener('click', function () {
            addRow(document.querySelector('#qaTableRecord tbody'), '', '', '');
        });

        document.getElementById('qaSaveFill').addEventListener('click', function () {
            var body = {
                item_fill_rate: collectFill('qaTableItem'),
                record_fill_rate: collectFill('qaTableRecord')
            };
            fetchWithAuth(PREFIX + 'fill-rates', { method: 'POST', body: JSON.stringify(body) })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (!d.success) throw new Error(d.message);
                    showMsg('填报率已保存', false);
                })
                .catch(function (e) { showMsg(e.message || String(e), true); });
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
            }).then(function (r) { return r.json(); }).then(function (d) {
                if (!d.success) throw new Error(d.message || '执行失败');
                lastAudit = d;
                showMsg('审核完成：通过 ' + (d.summary && d.summary.passed) + '，不通过 ' + (d.summary && d.summary.failed), false);
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
    }

    window.initQualityAuditTab = function () {
        bindListeners();
        if (window._qualityAuditDataLoaded) return;
        window._qualityAuditDataLoaded = true;
        loadRules().then(loadDatabases).then(loadFillRates).catch(function (e) {
            showMsg(e.message || String(e), true);
        });
    };
})();

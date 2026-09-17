/**
 * 数据质量审核：嵌入主应用 tab，依赖 script.js 中的 API_BASE、fetchWithAuth。
 */
(function () {
    // Get API_BASE from window (set by script.js) or use current origin
    var API_BASE = window.API_BASE || (typeof window !== 'undefined' ? window.location.origin : '');
    var PREFIX = API_BASE + '/api/v1/quality-audit/';
    var ruleTree = [];
    var flatRules = [];
    var selectedNms = {};
    var lastAudit = null;
    var listenersBound = false;
    var qaReportTemplateId = '';
    var qaTplPreviewTimer = null;
    var qaTplModalBound = false;

    var QA_SAMPLE_AUDIT = {
        summary: { total_rules: 3, passed: 2, failed: 1 },
        rules: [
            {
                nm: '010101',
                name: '主键完整性',
                sql_executed: 'SELECT * FROM demo_table WHERE id IS NULL',
                violation_count: 0,
                passed: true
            },
            {
                nm: '010102',
                name: '枚举值校验',
                sql_executed: 'SELECT * FROM demo_table WHERE status NOT IN (1,2)',
                violation_count: 2,
                passed: false,
                sample_rows: [{ id: 101, status: 'invalid' }, { id: 102, status: 'bad' }]
            },
            {
                nm: '020201',
                name: '重复记录检查',
                violation_count: 0,
                passed: true
            }
        ],
        item_fill_rates: [
            {
                table_name: '用户信息表',
                numerator: 'SELECT COUNT(*) FROM 用户信息表 WHERE 姓名 IS NOT NULL',
                denominator: 'SELECT COUNT(*) FROM 用户信息表',
                rate_percent: 96.12
            },
            {
                table_name: '订单表',
                numerator: 'SELECT COUNT(*) FROM 订单表 WHERE 订单号 IS NOT NULL',
                denominator: 'SELECT COUNT(*) FROM 订单表',
                rate_percent: 88.5
            }
        ],
        record_fill_rates: [
            {
                table_name: '明细表',
                numerator: 'SELECT SUM(cnt) FROM t',
                denominator: 'SELECT COUNT(*) FROM t',
                rate_percent: 72.33
            }
        ]
    };

    function qaParseTplContent(raw) {
        return qaShared.qaParseTplContent ? qaShared.qaParseTplContent(raw) : {
            doc_title: '数据质量审核报告',
            title: { font_family: 'Microsoft YaHei, SimHei, sans-serif', font_size: '24px', color: '#1a202c' },
            section: { font_family: 'Microsoft YaHei, SimHei, sans-serif', font_size: '16px', color: '#2d3748' },
            table: { border: '1px solid #cbd5e1', header_bg: '#edf2f7', row_alt: '#f8fafc' },
            page_header: '',
            page_footer: ''
        };
    }

    function qaApplyTplFormFromRow(row) {
        var c = qaParseTplContent(row && row.content);
        document.getElementById('qaTplId').value = row && row.id ? row.id : 'default';
        document.getElementById('qaTplName').value = row && row.name ? row.name : '默认报告模板';
        document.getElementById('qaTplType').value = (row && row.template_type) ? row.template_type : 'html';
        document.getElementById('qaTplIsDefault').checked = row ? !!row.is_default : true;
        document.getElementById('qaTplDocTitle').value = c.doc_title;
        document.getElementById('qaTplTitleFont').value = c.title.font_family;
        document.getElementById('qaTplTitleSize').value = c.title.font_size;
        document.getElementById('qaTplTitleColor').value = qaHex6FromCssColor(c.title.color);
        document.getElementById('qaTplSectionFont').value = c.section.font_family;
        document.getElementById('qaTplSectionSize').value = c.section.font_size;
        document.getElementById('qaTplSectionColor').value = qaHex6FromCssColor(c.section.color);
        document.getElementById('qaTplTblBorder').value = c.table.border;
        document.getElementById('qaTplTblHead').value = qaHex6FromCssColor(c.table.header_bg);
        document.getElementById('qaTplTblAlt').value = qaHex6FromCssColor(c.table.row_alt);
        document.getElementById('qaTplHeader').value = c.page_header;
        document.getElementById('qaTplFooter').value = c.page_footer;
    }

    function qaCollectTplContent() {
        return {
            doc_title: document.getElementById('qaTplDocTitle').value.trim() || '数据质量审核报告',
            title: {
                font_family: document.getElementById('qaTplTitleFont').value.trim() || 'Microsoft YaHei, SimHei, sans-serif',
                font_size: document.getElementById('qaTplTitleSize').value.trim() || '24px',
                color: document.getElementById('qaTplTitleColor').value
            },
            section: {
                font_family: document.getElementById('qaTplSectionFont').value.trim() || 'Microsoft YaHei, SimHei, sans-serif',
                font_size: document.getElementById('qaTplSectionSize').value.trim() || '16px',
                color: document.getElementById('qaTplSectionColor').value
            },
            table: {
                border: document.getElementById('qaTplTblBorder').value.trim() || '1px solid #cbd5e1',
                header_bg: document.getElementById('qaTplTblHead').value,
                row_alt: document.getElementById('qaTplTblAlt').value
            },
            page_header: document.getElementById('qaTplHeader').value,
            page_footer: document.getElementById('qaTplFooter').value
        };
    }

    function syncQaReportTemplateIdFromServer() {
        return fetchWithAuth(PREFIX + 'templates').then(function (r) { return r.json(); }).then(function (d) {
            if (!d.success || !d.templates || !d.templates.length) return;
            var def = d.templates.find(function (t) { return t.is_default; });
            var pick = def || d.templates[0];
            if (pick && pick.id) qaReportTemplateId = pick.id;
        }).catch(function () {});
    }

    function bindQaTplModalOnce() {
        if (qaTplModalBound) return;
        var modal = document.getElementById('qaTplModal');
        var iframe = document.getElementById('qaTplPreviewFrame');
        if (!modal || !iframe) return;
        qaTplModalBound = true;

        function scheduleQaTplPreview(immediate) {
            clearTimeout(qaTplPreviewTimer);
            var run = function () {
                if (!modal.classList.contains('is-open')) return;
                var body = { audit: QA_SAMPLE_AUDIT, content: qaCollectTplContent() };
                fetchWithAuth(PREFIX + 'preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                }).then(function (r) {
                    var ct = r.headers.get('Content-Type') || '';
                    if (!r.ok || ct.indexOf('json') !== -1) {
                        return r.json().then(function (j) { throw new Error((j && j.message) || r.statusText); });
                    }
                    return r.text();
                }).then(function (html) {
                    iframe.srcdoc = html;
                }).catch(function (e) {
                    iframe.srcdoc = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"></head><body style="font-family:system-ui,sans-serif;padding:16px;color:#c53030;">预览失败：' +
                        escapeHtml(e.message || String(e)) + '</body></html>';
                });
            };
            if (immediate) run();
            else qaTplPreviewTimer = setTimeout(run, 260);
        }

        function openQaTplModal() {
            modal.classList.add('is-open');
            modal.setAttribute('aria-hidden', 'false');
            fetchWithAuth(PREFIX + 'templates').then(function (r) { return r.json(); }).then(function (d) {
                if (!d.success) throw new Error(d.message || '加载模板失败');
                var list = d.templates || [];
                var row = list.find(function (t) { return t.is_default; }) || list[0];
                if (row) qaApplyTplFormFromRow(row);
                else qaApplyTplFormFromRow(null);
                scheduleQaTplPreview(true);
            }).catch(function () {
                qaApplyTplFormFromRow(null);
                scheduleQaTplPreview(true);
            });
        }

        function closeQaTplModal() {
            modal.classList.remove('is-open');
            modal.setAttribute('aria-hidden', 'true');
            clearTimeout(qaTplPreviewTimer);
        }

        modal.addEventListener('input', function () { scheduleQaTplPreview(false); });
        modal.addEventListener('change', function () { scheduleQaTplPreview(false); });

        var openBtn = document.getElementById('qaOpenReportTpl');
        if (openBtn) openBtn.addEventListener('click', openQaTplModal);
        document.getElementById('qaTplBackdrop').addEventListener('click', closeQaTplModal);
        document.getElementById('qaTplCloseX').addEventListener('click', closeQaTplModal);
        document.getElementById('qaTplCloseBtn').addEventListener('click', closeQaTplModal);
        document.getElementById('qaTplSaveBtn').addEventListener('click', function () {
            var id = document.getElementById('qaTplId').value.trim();
            if (!id) { showMsg('模板 ID 不能为空', true); return; }
            var payload = {
                id: id,
                name: document.getElementById('qaTplName').value.trim() || id,
                template_type: document.getElementById('qaTplType').value,
                content: JSON.stringify(qaCollectTplContent()),
                is_default: document.getElementById('qaTplIsDefault').checked
            };
            fetchWithAuth(PREFIX + 'templates', { method: 'POST', body: JSON.stringify(payload) })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (!d.success) throw new Error(d.message);
                    qaReportTemplateId = id;
                    showMsg('报告模板已保存', false);
                    closeQaTplModal();
                })
                .catch(function (e) { showMsg(e.message || String(e), true); });
        });

        // 保存 keydown 处理器引用，避免重复添加监听器
        if (!window._qaTplKeydownHandler) {
            window._qaTplKeydownHandler = function (ev) {
                var modal = document.getElementById('qaTplModal');
                if (ev.key === 'Escape' && modal && modal.classList.contains('is-open')) {
                    closeQaTplModal();
                }
            };
            document.addEventListener('keydown', window._qaTplKeydownHandler);
        }
    }

    function showMsg(text, isErr) {
        var el = document.getElementById('qaMsg');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'qa-msg show ' + (isErr ? 'err' : 'ok');
        if (!text) el.classList.remove('show');
    }

    var qaShared = window.QA_SHARED || globalThis.QA_SHARED || {};
    if (!qaShared.mergeRuleContinuationRows) {
        console.error('[quality-audit] qa-shared.js 未加载，规则/填报率导入与报告模板解析会失效；请检查 ensureQualityAuditScriptLoaded() 是否同时加载了 qa-shared.js');
    }
    function escapeHtml(s) {
        return qaShared.escapeHtml ? qaShared.escapeHtml(s) : String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatCellVal(v) {
        return qaShared.formatCellVal ? qaShared.formatCellVal(v) : (v === null || v === undefined ? '' : escapeHtml(String(v)));
    }

    function qaHex6FromCssColor(s) {
        return qaShared.qaHex6FromCssColor ? qaShared.qaHex6FromCssColor(s) : (String(s || '').trim() || '#000000');
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
        function fillSection(title, rows, withField) {
            if (!rows || !rows.length) return '';
            var thead = withField
                ? '<thead><tr><th>表名</th><th>字段名</th><th>填报率</th><th>备注</th></tr></thead>'
                : '<thead><tr><th>表名</th><th>填报率</th><th>备注</th></tr></thead>';
            var body = '<tbody>' + rows.map(function (x) {
                var noTable = x.no_such_table === true;
                var rate = noTable
                    ? '没有这个表'
                    : (x.rate_percent != null ? (Number(x.rate_percent).toFixed(2) + '%') : '—');
                var note = '';
                if (!noTable) {
                    if (x.numerator_error) note += '分子: ' + x.numerator_error + ' ';
                    if (x.denominator_error) note += '分母: ' + x.denominator_error;
                }
                var cells = '<td>' + escapeHtml(x.table_name || '') + '</td>';
                if (withField) cells += '<td>' + escapeHtml(x.field_name || '') + '</td>';
                cells += '<td>' + escapeHtml(rate) + '</td><td>' + escapeHtml(note.trim()) + '</td>';
                return '<tr>' + cells + '</tr>';
            }).join('') + '</tbody>';
            return '<div class="qa-fill-section"><strong>' + escapeHtml(title) + '</strong><table class="qa-result-table qa-fill-rate-table">' + thead + body + '</table></div>';
        }
        fillBlocks += fillSection('项填报率', audit.item_fill_rates, true);
        fillBlocks += fillSection('记录填报率', audit.record_fill_rates, false);

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
        return qaShared.parseExcelTSVWithQuotes ? qaShared.parseExcelTSVWithQuotes(text) : [];
    }

    function looksLikeNmCell(s) {
        s = String(s || '').trim();
        return /^\d{1,6}$/.test(s);
    }

    /** 将「非新规则起始行」合并到上一条的 SQL（无引号粘贴时 SQL 换行会变成多物理行） */
    function mergeRuleContinuationRows(parsedRows) {
        return qaShared.mergeRuleContinuationRows ? qaShared.mergeRuleContinuationRows(parsedRows) : [];
    }

    function parseExcelPasteMergedLines(raw) {
        return qaShared.parseExcelPasteMergedLines ? qaShared.parseExcelPasteMergedLines(raw) : [];
    }

    function parseExcelPasteRules(raw) {
        return qaShared.parseExcelPasteRules ? qaShared.parseExcelPasteRules(raw) : [];
    }

    /**
     * 填报率粘贴导入。
     * withField=true（项填报率）：列顺序 表名、字段名、分子、分母。
     * withField=false（记录填报率）：列顺序 表名、分子、分母，字段名列不参与统计。
     * 多行单元格应用 Excel 引号粘贴，由 parseExcelTSVWithQuotes 解析；无引号续行时首列为空则按列并入分子/分母。
     */
    function mergeFillContinuationRows(parsedRows, withField) {
        return qaShared.mergeFillContinuationRows ? qaShared.mergeFillContinuationRows(parsedRows, withField) : [];
    }

    function parseExcelPasteMergedLinesFill(raw, withField) {
        return qaShared.parseExcelPasteMergedLinesFill ? qaShared.parseExcelPasteMergedLinesFill(raw, withField) : [];
    }

    function parseExcelPasteFillRates(raw, withField) {
        return qaShared.parseExcelPasteFillRates ? qaShared.parseExcelPasteFillRates(raw, withField) : [];
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
                det.open = openState[nmKey] !== undefined ? !!openState[nmKey] : false;
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
                var pb1 = qaParamBadge(n);
                if (pb1) line.appendChild(pb1);
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
                var pb2 = qaParamBadge(n);
                if (pb2) div.appendChild(pb2);
                div.addEventListener('click', function (e) {
                    if (e.target.tagName === 'INPUT') return;
                    fillEditor(n);
                });
                container.appendChild(div);
            }
        });
    }

    // qaParamBadge 规则树上的参数状态标记：缺参数时提醒，避免带着空壳规则去执行
    function qaParamBadge(n) {
        var miss = qaMissingParams(n && n.sql, n && n.params);
        if (!miss.length) return null;
        var sp = document.createElement('span');
        sp.className = 'qa-param-warn';
        sp.textContent = '⚠ 参数未配置：' + miss.join('、');
        return sp;
    }

    function fillEditor(rule) {
        document.getElementById('qaNm').value = rule.nm || '';
        document.getElementById('qaXh').value = rule.xh || '';
        document.getElementById('qaName').value = rule.name || '';
        document.getElementById('qaCategory').value = rule.category || '';
        document.getElementById('qaSql').value = rule.sql || '';
        qaCurrentRuleParams = rule.params || {};
        qaRenderRuleParams();
    }

    // ===== 规则参数（占位符 {{xxx}}）=====
    var qaCurrentRuleParams = {};

    // qaExtractPlaceholders 取出 SQL 里的占位符名（去重、保持顺序），与后端 qaRulePlaceholders 对齐
    function qaExtractPlaceholders(sql) {
        var out = [], seen = {};
        String(sql || '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, function (m, name) {
            name = String(name || '').trim();
            if (!name || seen[name]) return '';
            seen[name] = true;
            out.push(name);
            return '';
        });
        return out;
    }

    // qaRenderRuleParams 按 SQL 中的占位符渲染参数输入框，保留已填内容
    function qaRenderRuleParams() {
        var box = document.getElementById('qaParamList');
        if (!box) return;
        var names = qaExtractPlaceholders(document.getElementById('qaSql').value);
        var prev = {};
        box.querySelectorAll('input[data-param]').forEach(function (inp) { prev[inp.getAttribute('data-param')] = inp.value; });
        box.innerHTML = '';
        if (!names.length) {
            var hint = document.createElement('span');
            hint.className = 'qa-form-hint';
            hint.textContent = '当前 SQL 中暂无占位符';
            box.appendChild(hint);
            return;
        }
        names.forEach(function (name) {
            var row = document.createElement('div');
            row.className = 'qa-param-row';
            var lb = document.createElement('span');
            lb.className = 'qa-param-label';
            lb.textContent = '{{' + name + '}}';
            var inp = document.createElement('input');
            inp.type = 'text';
            inp.setAttribute('data-param', name);
            inp.placeholder = '填写实际' + name;
            var v = qaCurrentRuleParams[name];
            if (v === undefined || v === null || v === '') v = prev[name];
            inp.value = v || '';
            row.appendChild(lb);
            row.appendChild(inp);
            box.appendChild(row);
        });
    }

    // qaCollectRuleParams 收集参数输入框的值
    function qaCollectRuleParams() {
        var out = {};
        var box = document.getElementById('qaParamList');
        if (!box) return out;
        box.querySelectorAll('input[data-param]').forEach(function (inp) {
            var name = inp.getAttribute('data-param');
            var v = String(inp.value || '').trim();
            if (v) out[name] = v;
        });
        return out;
    }

    // qaMissingParams 返回 SQL 中未填值的占位符名
    function qaMissingParams(sql, params) {
        return qaExtractPlaceholders(sql).filter(function (name) {
            return !(params && String(params[name] || '').trim());
        });
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
        return fetchWithAuth(API_BASE + '/api/v1/databases').then(function (r) { return r.json(); }).then(function (d) {
            if (!d.success) throw new Error(d.message || '加载数据库失败');
            var sel = document.getElementById('qaDbSelect');
            sel.innerHTML = '<option value="">请选择</option>';
            (d.databases || []).forEach(function (db) {
                qaDbMap[db.id] = db;
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
            field_name: row.field_name != null ? String(row.field_name) : '',
            numerator: row.numerator != null ? String(row.numerator) : '',
            denominator: row.denominator != null ? String(row.denominator) : '',
            checked: row.checked !== false
        };
    }

    function createFillNode(row, withField) {
        row = normalizeFillRow(row);
        if (withField === undefined) withField = true;
        var wrap = document.createElement('div');
        wrap.className = 'qa-fill-node';
        // 记录填报率不展示字段名，但保留已配置的值，保存时不丢
        wrap.setAttribute('data-field-name', row.field_name || '');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'qa-fill-cb';
        cb.checked = row.checked;
        cb.addEventListener('click', function (e) {
            e.stopPropagation();
            updateFillSelectAll();
        });
        var nameIn = document.createElement('input');
        nameIn.type = 'text';
        nameIn.className = 'qa-fill-table-name';
        nameIn.placeholder = '表名';
        nameIn.value = row.table_name;
        var fieldIn = document.createElement('input');
        fieldIn.type = 'text';
        fieldIn.className = 'qa-fill-field-name';
        fieldIn.placeholder = '字段名';
        fieldIn.value = row.field_name;
        var taN = document.createElement('textarea');
        taN.className = 'qa-fill-sql';
        taN.setAttribute('data-k', 'n');
        taN.placeholder = '分子 SQL';
        taN.value = row.numerator;
        var taD = document.createElement('textarea');
        taD.className = 'qa-fill-sql';
        taD.setAttribute('data-k', 'd');
        taD.placeholder = '分母 SQL';
        taD.value = row.denominator;
        var rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn btn-sm qa-fill-rm';
        rm.textContent = '×';
        rm.title = '删除';
        wrap.appendChild(cb);
        wrap.appendChild(nameIn);
        if (withField) wrap.appendChild(fieldIn);
        wrap.appendChild(taN);
        wrap.appendChild(taD);
        wrap.appendChild(rm);
        bindQaFillTextarea(taN);
        bindQaFillTextarea(taD);
        adjustQaFillTextarea(taN);
        adjustQaFillTextarea(taD);
        rm.addEventListener('click', function () {
            var root = wrap.parentNode;
            if (!root) return;
            var tName = nameIn.value || '（未命名）';
            if (!confirm('确定删除这条填报率配置？\n表名：' + tName)) return;
            wrap.remove();
            // 删空了补一行空白，保证列表始终至少有一行可编辑
            if (!root.querySelector('.qa-fill-node')) {
                root.appendChild(createFillNode({ checked: true }));
            }
            updateFillSelectAll();
        });
        return wrap;
    }

    function updateFillSelectAll() {
        var itemRoot = document.getElementById('qaFillItemTree');
        var recRoot = document.getElementById('qaFillRecordTree');
        var itemCb = document.getElementById('qaFillItemAll');
        var recCb = document.getElementById('qaFillRecordAll');
        if (itemRoot && itemCb) {
            var cbs = itemRoot.querySelectorAll('.qa-fill-cb');
            var all = cbs.length > 0 && Array.prototype.every.call(cbs, function (c) { return c.checked; });
            itemCb.checked = all;
        }
        if (recRoot && recCb) {
            var cbs2 = recRoot.querySelectorAll('.qa-fill-cb');
            var all2 = cbs2.length > 0 && Array.prototype.every.call(cbs2, function (c) { return c.checked; });
            recCb.checked = all2;
        }
    }

    // 项填报率按「表+字段」统计，记录填报率按整表统计 —— 后者不展示字段名列
    function qaFillTreeHasField(treeId) {
        return treeId !== 'qaFillRecordTree';
    }

    function renderFillTree(treeId, rows) {
        var root = document.getElementById(treeId);
        if (!root) return;
        var withField = qaFillTreeHasField(treeId);
        root.innerHTML = '';
        if (!rows || !rows.length) {
            rows = [{ table_name: '', field_name: '', numerator: '', denominator: '', checked: true }];
        }
        rows.forEach(function (r) {
            root.appendChild(createFillNode(r, withField));
        });
        updateFillSelectAll();
    }

    function setFillTreeChecked(treeId, val) {
        var root = document.getElementById(treeId);
        if (!root) return;
        root.querySelectorAll('.qa-fill-cb').forEach(function (cb) {
            cb.checked = val;
        });
        updateFillSelectAll();
    }

    // 删除勾选行；删空后补一行空白，避免出现「整块空白、没法再新增」的死状态
    function deleteCheckedFillRows(treeId) {
        var root = document.getElementById(treeId);
        if (!root) return;
        var nodes = Array.prototype.slice.call(root.querySelectorAll('.qa-fill-node'));
        var targets = nodes.filter(function (n) {
            var cb = n.querySelector('.qa-fill-cb');
            return cb && cb.checked;
        });
        if (!targets.length) { showMsg('请先勾选要删除的行', true); return; }
        if (!confirm('确定删除选中的 ' + targets.length + ' 行填报率配置？\n删除后还需点「保存填报率」才会生效。')) return;
        targets.forEach(function (n) { n.remove(); });
        if (!root.querySelector('.qa-fill-node')) {
            root.appendChild(createFillNode({ checked: true }, qaFillTreeHasField(treeId)));
        }
        updateFillSelectAll();
        showMsg('已删除 ' + targets.length + ' 行，记得点「保存填报率」生效', false);
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
            var fIn = node.querySelector('.qa-fill-field-name');
            var n = node.querySelector('textarea[data-k="n"]');
            var d = node.querySelector('textarea[data-k="d"]');
            rows.push({
                table_name: t,
                // 记录填报率没有字段输入框：沿用行上留存的原值，不要凭空清空
                field_name: fIn ? String(fIn.value || '').trim() : String(node.getAttribute('data-field-name') || ''),
                numerator: n ? n.value : '',
                denominator: d ? d.value : '',
                checked: !!(cb && cb.checked)
            });
        });
        return rows;
    }

    // ===================== 定时任务 & 执行记录 =====================
    var qaSchedList = [];
    var qaDbMap = {};
    var qaSchedEditingId = '';
    var qaSchedRuleNms = {};
    var qaSchedAiNms = {};
    var qaSchedBound = false;
    var qaRunDetailRow = null;
    var qaCurrentSub = 'rules';
    var qaTplOptionsLoaded = false;
    var QA_SQL_DB_TYPES = { mysql: 1, mariadb: 1, tidb: 1, postgresql: 1, timescaledb: 1, cockroachdb: 1, sqlserver: 1, oracle: 1, dm: 1, sqlite: 1 };

    function qaPad2(n) { n = Number(n) || 0; return (n < 10 ? '0' : '') + n; }

    function qaFmtTime(s) {
        s = String(s == null ? '' : s).trim();
        if (!s) return '';
        var m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
        return m ? (m[1] + ' ' + m[2]) : s;
    }

    function qaFmtDateObj(d) {
        if (!d) return '';
        return d.getFullYear() + '-' + qaPad2(d.getMonth() + 1) + '-' + qaPad2(d.getDate()) + ' ' + qaPad2(d.getHours()) + ':' + qaPad2(d.getMinutes());
    }

    function qaFmtDuration(ms) {
        ms = Number(ms) || 0;
        if (ms < 1000) return ms + ' ms';
        if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
        return Math.floor(ms / 60000) + ' 分 ' + Math.round((ms % 60000) / 1000) + ' 秒';
    }

    function qaDbLabel(id) {
        var d = qaDbMap[id];
        return d ? (d.name + ' (' + d.type + ')') : (id || '');
    }

    var QA_WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    function qaWeekdayName(v) { v = Number(v); if (v === 7) v = 0; return QA_WEEKDAY_NAMES[v] || ''; }

    /** 前端轻量 cron 解析（仅用于表单实时预览，与后端 qa_cron.go 语义一致）。 */
    function qaJsCronField(s, min, max) {
        s = String(s == null ? '' : s).trim();
        if (!s) return null;
        var wholeStar = (s === '*');
        var set = {};
        var parts = s.split(',');
        for (var pi = 0; pi < parts.length; pi++) {
            var part = parts[pi].trim();
            if (!part) return null;
            var step = 1, rangePart = part, hasStep = false;
            var slash = part.indexOf('/');
            if (slash >= 0) {
                hasStep = true;
                rangePart = part.slice(0, slash).trim();
                var st = parseInt(part.slice(slash + 1), 10);
                if (!isFinite(st) || st <= 0) return null;
                step = st;
            }
            var start = min, end = max;
            if (rangePart === '*') {
                // 全范围
            } else if (rangePart.indexOf('-') >= 0) {
                var idx = rangePart.indexOf('-');
                var a = parseInt(rangePart.slice(0, idx), 10);
                var b = parseInt(rangePart.slice(idx + 1), 10);
                if (!isFinite(a) || !isFinite(b)) return null;
                start = a; end = b;
            } else {
                var n = parseInt(rangePart, 10);
                if (!isFinite(n)) return null;
                if (hasStep) { start = n; end = max; } else { start = n; end = n; }
            }
            if (start < min || end > max || start > end) return null;
            for (var v = start; v <= end; v += step) set[v] = true;
        }
        return { set: set, star: wholeStar, min: min, max: max };
    }

    function qaJsCronParse(expr) {
        var f = String(expr == null ? '' : expr).trim().split(/\s+/);
        if (f.length !== 5) return null;
        var ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
        var fields = [];
        for (var i = 0; i < 5; i++) {
            var fl = qaJsCronField(f[i], ranges[i][0], ranges[i][1]);
            if (!fl) return null;
            fields.push(fl);
        }
        return { fields: fields, raw: f };
    }

    function qaJsSingle(field) {
        var vals = [];
        for (var v = field.min; v <= field.max; v++) if (field.set[v]) vals.push(v);
        return vals.length === 1 ? vals[0] : null;
    }

    function qaJsDayMatch(spec, d) {
        var dom = !!spec.fields[2].set[d.getDate()];
        var wd = d.getDay();
        var dow = !!spec.fields[4].set[wd] || (wd === 0 && !!spec.fields[4].set[7]);
        if (!spec.fields[2].star && !spec.fields[4].star) return dom || dow;
        return dom && dow;
    }

    function qaJsCronNext(expr, from) {
        var spec = qaJsCronParse(expr);
        if (!spec) return null;
        from = from || new Date();
        var t = new Date(from.getTime());
        t.setSeconds(0, 0);
        t.setMinutes(t.getMinutes() + 1);
        var limit = new Date(from.getTime());
        limit.setFullYear(limit.getFullYear() + 10);
        var guard = 0;
        while (t < limit && guard++ < 200000) {
            if (!spec.fields[3].set[t.getMonth() + 1]) { t = new Date(t.getFullYear(), t.getMonth() + 1, 1, 0, 0, 0, 0); continue; }
            if (!qaJsDayMatch(spec, t)) { t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, 0, 0, 0, 0); continue; }
            if (!spec.fields[1].set[t.getHours()]) { t = new Date(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours() + 1, 0, 0, 0); continue; }
            if (!spec.fields[0].set[t.getMinutes()]) { t = new Date(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes() + 1, 0, 0); continue; }
            return t;
        }
        return null;
    }

    function qaJsCronDescribe(expr) {
        var spec = qaJsCronParse(expr);
        if (!spec) return '';
        var f = spec.raw;
        var restStar = f[1] === '*' && f[2] === '*' && f[3] === '*' && f[4] === '*';
        if (f[0] === '*' && restStar) return '每分钟';
        if (/^\*\/\d+$/.test(f[0]) && restStar) return '每 ' + f[0].slice(2) + ' 分钟';
        if (f[2] === '*' && f[3] === '*' && f[4] === '*') {
            if (/^\*\/\d+$/.test(f[1])) {
                var mm = qaJsSingle(spec.fields[0]);
                return mm === 0 ? ('每 ' + f[1].slice(2) + ' 小时') : ('每 ' + f[1].slice(2) + ' 小时的第 ' + mm + ' 分');
            }
            if (f[1] === '*') {
                var m0 = qaJsSingle(spec.fields[0]);
                if (m0 === 0) return '每小时整点';
                if (m0 !== null) return '每小时第 ' + m0 + ' 分';
            }
        }
        var m = qaJsSingle(spec.fields[0]);
        var h = qaJsSingle(spec.fields[1]);
        if (m !== null && h !== null) {
            var tt = qaPad2(h) + ':' + qaPad2(m);
            if (f[2] === '*' && f[3] === '*' && f[4] !== '*') {
                var w = qaJsSingle(spec.fields[4]);
                if (w !== null) return '每' + qaWeekdayName(w) + ' ' + tt;
                var r = f[4].match(/^(\d+)-(\d+)$/);
                if (r) return '每' + qaWeekdayName(parseInt(r[1], 10)) + '至' + qaWeekdayName(parseInt(r[2], 10)) + ' ' + tt;
            }
            if (f[2] === '*' && f[3] === '*' && f[4] === '*') return '每天 ' + tt;
            var d = qaJsSingle(spec.fields[2]);
            if (d !== null && f[3] === '*' && f[4] === '*') return '每月 ' + d + ' 日 ' + tt;
            if (d !== null && f[4] === '*') {
                var mo = qaJsSingle(spec.fields[3]);
                if (mo !== null) return '每年 ' + mo + ' 月 ' + d + ' 日 ' + tt;
            }
        }
        return String(expr).trim();
    }

    function qaEnsureModal(id, open) {
        var m = document.getElementById(id);
        if (!m) return null;
        if (open) { m.classList.add('show'); m.setAttribute('aria-hidden', 'false'); }
        else { m.classList.remove('show'); m.setAttribute('aria-hidden', 'true'); }
        return m;
    }

    function qaStatusBadge(status) {
        if (status === 'success') return '<span class="qa-badge qa-badge-pass">成功</span>';
        if (status === 'failed') return '<span class="qa-badge qa-badge-fail">失败</span>';
        return '<span class="qa-badge qa-badge-skip">未执行</span>';
    }

    // ---------- 子 tab ----------
    function qaSwitchSub(name) {
        if (name !== 'rules' && name !== 'schedules' && name !== 'runs') name = 'rules';
        qaCurrentSub = name;
        Array.prototype.forEach.call(document.querySelectorAll('#qaSubtabs .qa-subtab'), function (b) {
            b.classList.toggle('active', b.getAttribute('data-qa-sub') === name);
        });
        [['rules', 'qaSubRules'], ['schedules', 'qaSubSchedules'], ['runs', 'qaSubRuns']].forEach(function (pair) {
            var el = document.getElementById(pair[1]);
            if (el) el.style.display = (pair[0] === name) ? 'block' : 'none';
        });
        if (name === 'schedules') loadSchedules();
        if (name === 'runs') { loadOverview(); loadRuns(qaRunFilterValue()); }
    }

    // ---------- 定时任务列表 ----------
    function loadSchedules() {
        var body = document.getElementById('qaSchedBody');
        if (body) body.innerHTML = '<tr><td colspan="9" class="qa-empty-cell">加载中…</td></tr>';
        return fetchWithAuth(PREFIX + 'schedules').then(function (r) { return r.json(); }).then(function (d) {
            if (!d.success) throw new Error(d.message || '加载定时任务失败');
            qaSchedList = d.schedules || [];
            renderSchedules();
            qaFillRunFilter();
        }).catch(function (e) {
            if (body) body.innerHTML = '';
            var empty = document.getElementById('qaSchedEmpty');
            if (empty) { empty.style.display = 'block'; empty.textContent = e.message || String(e); }
        });
    }

    function renderSchedules() {
        var body = document.getElementById('qaSchedBody');
        var empty = document.getElementById('qaSchedEmpty');
        if (!body || !empty) return;
        body.innerHTML = '';
        if (!qaSchedList.length) {
            empty.style.display = 'block';
            empty.textContent = '暂无定时任务，点击「+ 新建任务」创建。';
            return;
        }
        empty.style.display = 'none';
        qaSchedList.forEach(function (s) {
            var tr = document.createElement('tr');
            var ruleCount = (s.rule_nms || []).length;
            var aiCount = (s.ai_check_nms || []).length;
            tr.innerHTML =
                '<td>' + escapeHtml(s.name || '') + '</td>' +
                '<td>' + escapeHtml(qaDbLabel(s.database_id)) + '</td>' +
                '<td><div>' + escapeHtml(s.cron_text || s.cron_expr || '') + '</div><code class="qa-cron-raw">' + escapeHtml(s.cron_expr || '') + '</code></td>' +
                '<td>' + ruleCount + '</td>' +
                '<td>' + (aiCount ? ('<span class="qa-badge qa-badge-ai">' + aiCount + ' 项</span>') : '<span class="qa-muted">关闭</span>') + '</td>' +
                '<td><label class="qa-sched-toggle-wrap" title="启用 / 停用"><input type="checkbox" class="qa-sched-toggle" data-id="' + escapeHtml(s.id) + '"' + (s.enabled ? ' checked' : '') + '> <span>' + (s.enabled ? '启用' : '停用') + '</span></label></td>' +
                '<td>' + (s.last_run_at ? (escapeHtml(qaFmtTime(s.last_run_at)) + ' ' + qaStatusBadge(s.last_run_status)) : '<span class="qa-muted">—</span>') + '</td>' +
                '<td>' + (s.next_run_at ? escapeHtml(qaFmtTime(s.next_run_at)) : '<span class="qa-muted">—</span>') + '</td>' +
                '<td class="qa-row-actions">' +
                    '<button type="button" class="btn btn-sm" data-act="run" data-id="' + escapeHtml(s.id) + '">立即执行</button>' +
                    '<button type="button" class="btn btn-sm" data-act="edit" data-id="' + escapeHtml(s.id) + '">编辑</button>' +
                    '<button type="button" class="btn btn-sm btn-danger" data-act="del" data-id="' + escapeHtml(s.id) + '">删除</button>' +
                '</td>';
            body.appendChild(tr);
        });
    }

    function qaRunFilterValue() {
        var el = document.getElementById('qaRunFilter');
        return el ? el.value : '';
    }

    function qaFillRunFilter() {
        var sel = document.getElementById('qaRunFilter');
        if (!sel) return;
        var cur = sel.value;
        var html = '<option value="">全部任务</option>';
        qaSchedList.forEach(function (s) {
            html += '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.name || s.id) + '</option>';
        });
        sel.innerHTML = html;
        sel.value = cur;
    }

    // ---------- 新建 / 编辑弹窗 ----------
    function qaLeafRules() {
        return (flatRules || []).filter(function (r) { return r && r.sql && String(r.sql).trim(); });
    }

    function qaSyncSchedTreeState() {
        var all = document.getElementById('qaSchedRuleAll');
        if (!all) return;
        var leaves = qaLeafRules();
        var sel = 0;
        leaves.forEach(function (r) { if (qaSchedRuleNms[r.nm]) sel++; });
        all.checked = leaves.length > 0 && sel === leaves.length;
    }

    function qaRenderSchedTreeNodes(nodes, container) {
        (nodes || []).forEach(function (n) {
            var hasKids = n.children && n.children.length;
            if (hasKids) {
                var det = document.createElement('details');
                det.open = true;
                det.className = 'qa-sched-group';
                var sum = document.createElement('summary');
                sum.innerHTML = escapeHtml(n.name || '') + ' <code>' + escapeHtml(n.nm || '') + '</code>';
                det.appendChild(sum);
                var inner = document.createElement('div');
                inner.className = 'qa-sched-group-body';
                qaRenderSchedTreeNodes(n.children, inner);
                det.appendChild(inner);
                container.appendChild(det);
                return;
            }
            var hasSql = !!(n.sql && String(n.sql).trim());
            var row = document.createElement('div');
            row.className = 'qa-sched-rule-row' + (hasSql ? '' : ' qa-sched-rule-nosql');
            var cbRule = document.createElement('input');
            cbRule.type = 'checkbox';
            cbRule.className = 'qa-sched-cb-rule';
            cbRule.title = '执行范围：勾选后该规则参与本次审核';
            cbRule.disabled = !hasSql;
            cbRule.checked = !!qaSchedRuleNms[n.nm];
            var cbAi = document.createElement('input');
            cbAi.type = 'checkbox';
            cbAi.className = 'qa-sched-cb-ai';
            cbAi.title = 'AI 核验：审核不通过时交由 AI 复核是否误判（勾选会自动加入执行范围）';
            cbAi.disabled = !hasSql;
            cbAi.checked = !!qaSchedAiNms[n.nm];
            cbRule.addEventListener('change', function () {
                if (cbRule.checked) qaSchedRuleNms[n.nm] = true;
                else { delete qaSchedRuleNms[n.nm]; delete qaSchedAiNms[n.nm]; cbAi.checked = false; }
                qaSyncSchedTreeState();
            });
            cbAi.addEventListener('change', function () {
                if (cbAi.checked) { qaSchedAiNms[n.nm] = true; qaSchedRuleNms[n.nm] = true; cbRule.checked = true; }
                else delete qaSchedAiNms[n.nm];
                qaSyncSchedTreeState();
            });
            var label = document.createElement('span');
            label.className = 'qa-sched-rule-label';
            label.innerHTML = escapeHtml(n.name || '') + ' <code>' + escapeHtml(n.nm || '') + '</code>' + (hasSql ? '' : ' <span class="qa-muted">（无 SQL，不可选）</span>');
            row.appendChild(cbRule);
            row.appendChild(cbAi);
            row.appendChild(label);
            container.appendChild(row);
        });
    }

    function qaRenderSchedTree() {
        var root = document.getElementById('qaSchedRuleTree');
        if (!root) return;
        root.innerHTML = '';
        if (!ruleTree || !ruleTree.length) {
            root.innerHTML = '<div class="qa-empty">暂无可用规则，请先在「规则配置」中维护规则。</div>';
            qaSyncSchedTreeState();
            return;
        }
        qaRenderSchedTreeNodes(ruleTree, root);
        qaSyncSchedTreeState();
    }

    function qaSchedCollectRuleNms() {
        return Object.keys(qaSchedRuleNms).filter(function (nm) { return qaSchedRuleNms[nm]; });
    }

    function qaSchedCollectAiNms() {
        return Object.keys(qaSchedAiNms).filter(function (nm) { return qaSchedAiNms[nm] && qaSchedRuleNms[nm]; });
    }

    function qaReadInt(id, def) {
        var el = document.getElementById(id);
        if (!el) return def;
        var n = parseInt(el.value, 10);
        return isFinite(n) ? n : def;
    }

    function qaRenderFreqFields() {
        var box = document.getElementById('qaSchedFreqFields');
        var custom = document.getElementById('qaSchedCron');
        var freqEl = document.getElementById('qaSchedFreq');
        if (!box || !freqEl) return;
        var freq = freqEl.value;
        if (freq === 'custom') {
            box.innerHTML = '';
            if (custom) custom.style.display = 'inline-block';
            qaUpdateCron();
            return;
        }
        if (custom) custom.style.display = 'none';
        function numSel(id, min, max, val) {
            var s = '<select id="' + id + '">';
            for (var v = min; v <= max; v++) s += '<option value="' + v + '"' + (v === val ? ' selected' : '') + '>' + qaPad2(v) + '</option>';
            return s + '</select>';
        }
        if (freq === 'daily') {
            box.innerHTML = '每天 ' + numSel('qaSchedFreqHour', 0, 23, 8) + ' : ' + numSel('qaSchedFreqMinute', 0, 59, 0);
        } else if (freq === 'weekly') {
            var dw = '<select id="qaSchedFreqDow">';
            ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].forEach(function (nm, i) {
                var v = (i === 6) ? 0 : i + 1;
                dw += '<option value="' + v + '"' + (v === 1 ? ' selected' : '') + '>' + nm + '</option>';
            });
            dw += '</select>';
            box.innerHTML = '每 ' + dw + ' ' + numSel('qaSchedFreqHour', 0, 23, 8) + ' : ' + numSel('qaSchedFreqMinute', 0, 59, 0);
        } else if (freq === 'monthly') {
            box.innerHTML = '每月 ' + numSel('qaSchedFreqDom', 1, 31, 1) + ' 日 ' + numSel('qaSchedFreqHour', 0, 23, 8) + ' : ' + numSel('qaSchedFreqMinute', 0, 59, 0);
        } else if (freq === 'hourly') {
            box.innerHTML = '每 ' + numSel('qaSchedFreqStep', 1, 23, 6) + ' 小时的第 ' + numSel('qaSchedFreqMinute', 0, 59, 0) + ' 分';
        }
        qaUpdateCron();
    }

    function qaBuildCronFromFreq() {
        var freqEl = document.getElementById('qaSchedFreq');
        if (!freqEl) return '';
        var freq = freqEl.value;
        if (freq === 'custom') {
            var c = document.getElementById('qaSchedCron');
            return String(c ? c.value : '').trim();
        }
        var h = qaReadInt('qaSchedFreqHour', 8);
        var m = qaReadInt('qaSchedFreqMinute', 0);
        if (freq === 'daily') return m + ' ' + h + ' * * *';
        if (freq === 'weekly') return m + ' ' + h + ' * * ' + qaReadInt('qaSchedFreqDow', 1);
        if (freq === 'monthly') return m + ' ' + h + ' ' + qaReadInt('qaSchedFreqDom', 1) + ' * *';
        if (freq === 'hourly') return m + ' */' + qaReadInt('qaSchedFreqStep', 6) + ' * * *';
        return '';
    }

    function qaUpdateCron() {
        var freqEl = document.getElementById('qaSchedFreq');
        var custom = document.getElementById('qaSchedCron');
        var cron = qaBuildCronFromFreq();
        if (custom && freqEl && freqEl.value !== 'custom') custom.value = cron;
        var prev = document.getElementById('qaSchedCronPreview');
        if (!prev) return;
        if (!cron) {
            prev.textContent = '请填写 cron 表达式（分 时 日 月 周）';
            prev.className = 'qa-cron-preview';
            return;
        }
        if (!qaJsCronParse(cron)) {
            prev.textContent = '表达式无效：' + cron + '（需为 5 段：分 时 日 月 周）';
            prev.className = 'qa-cron-preview err';
            return;
        }
        var next = qaJsCronNext(cron, new Date());
        prev.textContent = qaJsCronDescribe(cron) + (next ? (' ｜ 下次执行 ' + qaFmtDateObj(next)) : '');
        prev.className = 'qa-cron-preview';
    }

    function qaFillSchedDbOptions(selectedId) {
        var sel = document.getElementById('qaSchedDb');
        if (!sel) return;
        var html = '<option value="">请选择</option>';
        Object.keys(qaDbMap).forEach(function (id) {
            var db = qaDbMap[id];
            if (!db || !QA_SQL_DB_TYPES[db.type]) return;
            html += '<option value="' + escapeHtml(id) + '">' + escapeHtml(db.name + ' (' + db.type + ')') + '</option>';
        });
        sel.innerHTML = html;
        sel.value = selectedId || '';
    }

    function qaLoadTplOptions(selectedId) {
        var sel = document.getElementById('qaSchedTpl');
        if (!sel) return;
        var cur = selectedId || '';
        if (qaTplOptionsLoaded) { sel.value = cur; return; }
        sel.innerHTML = '<option value="">默认模板</option>';
        fetchWithAuth(PREFIX + 'templates').then(function (r) { return r.json(); }).then(function (d) {
            if (!d.success) return;
            (d.templates || []).forEach(function (t) {
                var o = document.createElement('option');
                o.value = t.id;
                o.textContent = t.name || t.id;
                sel.appendChild(o);
            });
            qaTplOptionsLoaded = true;
            sel.value = cur;
        }).catch(function () {});
    }

    function qaOpenSchedModal(sch) {
        qaSchedRuleNms = {};
        qaSchedAiNms = {};
        qaSchedEditingId = (sch && sch.id) ? sch.id : '';
        var title = document.getElementById('qaSchedModalTitle');
        if (title) title.textContent = qaSchedEditingId ? '编辑定时任务' : '新建定时任务';
        document.getElementById('qaSchedName').value = sch ? (sch.name || '') : '';
        qaFillSchedDbOptions(sch ? sch.database_id : '');
        (sch && sch.rule_nms || []).forEach(function (nm) { qaSchedRuleNms[padNm(nm)] = true; });
        (sch && sch.ai_check_nms || []).forEach(function (nm) { qaSchedAiNms[padNm(nm)] = true; });
        document.getElementById('qaSchedAiPrompt').value = sch ? (sch.ai_prompt || '') : '';
        document.getElementById('qaSchedEnabled').checked = sch ? !!sch.enabled : true;
        qaLoadTplOptions(sch ? (sch.report_template_id || '') : '');
        var freqSel = document.getElementById('qaSchedFreq');
        var cronInput = document.getElementById('qaSchedCron');
        if (sch && sch.cron_expr) {
            freqSel.value = 'custom';
            if (cronInput) cronInput.value = sch.cron_expr;
        } else {
            freqSel.value = 'daily';
            if (cronInput) cronInput.value = '';
        }
        qaRenderSchedTree();
        qaRenderFreqFields();
        qaEnsureModal('qaSchedModal', true);
    }

    function qaSaveSched() {
        var name = String(document.getElementById('qaSchedName').value || '').trim();
        if (!name) { showMsg('任务名称不能为空', true); return; }
        var dbId = document.getElementById('qaSchedDb').value;
        if (!dbId) { showMsg('请选择目标数据库', true); return; }
        var ruleNms = qaSchedCollectRuleNms();
        if (!ruleNms.length) { showMsg('请至少勾选一条审核项', true); return; }
        var cron = qaBuildCronFromFreq();
        if (!cron || !qaJsCronParse(cron)) { showMsg('cron 表达式无效：' + (cron || '空'), true); return; }
        var body = {
            name: name,
            database_id: dbId,
            cron_expr: cron,
            enabled: document.getElementById('qaSchedEnabled').checked,
            rule_nms: ruleNms,
            ai_check_nms: qaSchedCollectAiNms(),
            ai_prompt: String(document.getElementById('qaSchedAiPrompt').value || '').trim(),
            report_template_id: document.getElementById('qaSchedTpl').value
        };
        if (qaSchedEditingId) body.id = qaSchedEditingId;
        fetchWithAuth(PREFIX + 'schedules', { method: 'POST', body: JSON.stringify(body) })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d.success) throw new Error(d.message || '保存失败');
                qaEnsureModal('qaSchedModal', false);
                showMsg(qaSchedEditingId ? '定时任务已更新' : '定时任务已创建', false);
                return loadSchedules();
            })
            .catch(function (e) { showMsg(e.message || String(e), true); });
    }

    function qaDeleteSchedule(id, name) {
        if (!confirm('确定删除定时任务「' + (name || id) + '」？')) return;
        fetchWithAuth(PREFIX + 'schedules/' + encodeURIComponent(id), { method: 'DELETE' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d.success) throw new Error(d.message || '删除失败');
                showMsg('已删除', false);
                return loadSchedules();
            })
            .catch(function (e) { showMsg(e.message || String(e), true); });
    }

    function qaToggleSchedule(id, enabled) {
        var s = qaSchedList.filter(function (x) { return x.id === id; })[0];
        if (!s) return;
        var body = {
            id: id, name: s.name, database_id: s.database_id, cron_expr: s.cron_expr,
            enabled: enabled, rule_nms: s.rule_nms || [], ai_check_nms: s.ai_check_nms || [],
            ai_prompt: s.ai_prompt || '', report_template_id: s.report_template_id || ''
        };
        fetchWithAuth(PREFIX + 'schedules', { method: 'POST', body: JSON.stringify(body) })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d.success) throw new Error(d.message || '更新失败');
                showMsg(enabled ? '已启用' : '已停用', false);
                return loadSchedules();
            })
            .catch(function (e) { showMsg(e.message || String(e), true); loadSchedules(); });
    }

    function qaRunScheduleNow(id) {
        if (!confirm('立即执行该定时任务？执行期间请勿关闭页面。')) return;
        showMsg('任务执行中…', false);
        fetchWithAuth(PREFIX + 'schedules/' + encodeURIComponent(id) + '/run', { method: 'POST', body: '{}' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d.success) throw new Error(d.message || '执行失败');
                showMsg('执行完成：' + (d.status === 'success' ? '成功' : '失败') + (d.error ? ('（' + d.error + '）') : ''), d.status !== 'success');
                return loadSchedules();
            })
            .then(function () { if (qaCurrentSub === 'runs') { loadOverview(); loadRuns(qaRunFilterValue()); } })
            .catch(function (e) { showMsg(e.message || String(e), true); });
    }

    // ---------- 执行记录 / 概览 ----------
    function qaSetText(id, v) {
        var el = document.getElementById(id);
        if (el) el.textContent = (v == null ? '-' : String(v));
    }

    function loadOverview() {
        return fetchWithAuth(PREFIX + 'overview').then(function (r) { return r.json(); }).then(function (d) {
            if (!d.success) throw new Error(d.message || '加载统计失败');
            qaSetText('qaOvSchedTotal', d.schedules_total);
            qaSetText('qaOvSchedEnabled', d.schedules_enabled);
            qaSetText('qaOvRunsToday', d.runs_today);
            qaSetText('qaOvSuccessRate', d.success_rate_30d == null ? '-' : (d.success_rate_30d + '%'));
            qaSetText('qaOvAiFlagged', d.ai_flagged_30d);
            renderTrendChart(d.daily || []);
            renderTopFailed(d.top_failed_rules || []);
        }).catch(function (e) { showMsg(e.message || String(e), true); });
    }

    function renderTrendChart(daily) {
        var box = document.getElementById('qaTrendChart');
        if (!box) return;
        box.innerHTML = '';
        if (!daily.length) { box.innerHTML = '<div class="qa-empty">暂无数据</div>'; return; }
        var max = 1;
        daily.forEach(function (d) {
            var t = (Number(d.passed) || 0) + (Number(d.failed) || 0);
            if (t > max) max = t;
        });
        daily.forEach(function (d) {
            var passed = Number(d.passed) || 0;
            var failed = Number(d.failed) || 0;
            var total = passed + failed;
            var col = document.createElement('div');
            col.className = 'qa-chart-col';
            col.title = d.date + '：通过 ' + passed + ' / 不通过 ' + failed;
            var bar = document.createElement('div');
            bar.className = 'qa-chart-bar';
            if (total === 0) {
                bar.innerHTML = '<div class="qa-chart-zero"></div>';
            } else {
                bar.innerHTML = '<div class="qa-chart-seg qa-chart-pass" style="height:' + Math.round(passed / max * 100) + '%"></div>' +
                    '<div class="qa-chart-seg qa-chart-fail" style="height:' + Math.round(failed / max * 100) + '%"></div>';
            }
            var tip = document.createElement('div');
            tip.className = 'qa-chart-tip';
            tip.textContent = total ? String(total) : '';
            var lbl = document.createElement('div');
            lbl.className = 'qa-chart-label';
            lbl.textContent = String(d.date || '').slice(5);
            col.appendChild(bar);
            col.appendChild(tip);
            col.appendChild(lbl);
            box.appendChild(col);
        });
    }

    function renderTopFailed(list) {
        var box = document.getElementById('qaTopFailed');
        if (!box) return;
        if (!list.length) { box.innerHTML = '<div class="qa-muted">近 30 天无失败规则</div>'; return; }
        var html = '<div class="qa-top-failed-title">近 30 天高频不通过规则</div><ul class="qa-top-failed-list">';
        list.forEach(function (x) {
            html += '<li><code>' + escapeHtml(x.nm || '') + '</code> ' + escapeHtml(x.name || '') +
                ' <span class="qa-top-count">' + (Number(x.count) || 0) + ' 次</span></li>';
        });
        box.innerHTML = html + '</ul>';
    }

    function loadRuns(scheduleId) {
        var body = document.getElementById('qaRunsBody');
        if (body) body.innerHTML = '<tr><td colspan="9" class="qa-empty-cell">加载中…</td></tr>';
        var q = 'runs?limit=50';
        if (scheduleId) q += '&schedule_id=' + encodeURIComponent(scheduleId);
        return fetchWithAuth(PREFIX + q).then(function (r) { return r.json(); }).then(function (d) {
            if (!d.success) throw new Error(d.message || '加载执行记录失败');
            renderRuns(d.runs || []);
        }).catch(function (e) {
            if (body) body.innerHTML = '';
            var empty = document.getElementById('qaRunsEmpty');
            if (empty) { empty.style.display = 'block'; empty.textContent = e.message || String(e); }
        });
    }

    function renderRuns(runs) {
        var body = document.getElementById('qaRunsBody');
        var empty = document.getElementById('qaRunsEmpty');
        if (!body || !empty) return;
        body.innerHTML = '';
        if (!runs.length) { empty.style.display = 'block'; empty.textContent = '暂无执行记录。'; return; }
        empty.style.display = 'none';
        runs.forEach(function (ru) {
            var tr = document.createElement('tr');
            var trigger = ru.trigger_type === 'manual' ? '手动' : '定时';
            var status = ru.status === 'success' ? '<span class="qa-badge qa-badge-pass">成功</span>'
                : (ru.status === 'failed' ? '<span class="qa-badge qa-badge-fail">失败</span>' : escapeHtml(ru.status || ''));
            var ai = Number(ru.ai_flagged) || 0;
            var aiHtml = ai > 0 ? ('<span class="qa-badge qa-badge-warn">' + ai + '</span>') : '<span class="qa-muted">0</span>';
            tr.innerHTML =
                '<td>' + escapeHtml(qaFmtTime(ru.started_at)) + '</td>' +
                '<td>' + escapeHtml(ru.schedule_name || '（手动）') + '</td>' +
                '<td>' + trigger + '</td>' +
                '<td>' + escapeHtml(qaDbLabel(ru.database_id)) + '</td>' +
                '<td><span class="qa-pass-num">' + (Number(ru.passed) || 0) + '</span> / <span class="qa-fail-num">' + (Number(ru.failed) || 0) + '</span></td>' +
                '<td>' + aiHtml + '</td>' +
                '<td>' + escapeHtml(qaFmtDuration(ru.duration_ms)) + '</td>' +
                '<td>' + status + '</td>' +
                '<td class="qa-row-actions">' +
                    '<button type="button" class="btn btn-sm" data-act="detail" data-id="' + escapeHtml(ru.id) + '">详情</button>' +
                    (ru.has_report ? '<button type="button" class="btn btn-sm" data-act="report" data-id="' + escapeHtml(ru.id) + '">下载报告</button>' : '') +
                '</td>';
            body.appendChild(tr);
        });
    }

    function qaRunAiCell(r) {
        if (r.ai_misjudged === undefined && r.ai_reason === undefined) return '<span class="qa-muted">—</span>';
        var mis = r.ai_misjudged === true;
        var conf = (r.ai_confidence != null) ? ('（置信度 ' + Number(r.ai_confidence).toFixed(2) + '）') : '';
        var html = mis
            ? ('<span class="qa-badge qa-badge-warn">疑似规则过严误判</span>' + conf)
            : ('<span class="qa-badge qa-badge-ok">判定正常</span>' + conf);
        if (r.ai_reason) html += '<div class="qa-ai-reason">' + escapeHtml(r.ai_reason) + '</div>';
        if (r.ai_suggestion) html += '<div class="qa-ai-sug">建议：' + escapeHtml(r.ai_suggestion) + '</div>';
        return html;
    }

    function renderRunDetail(run) {
        if (!run) return;
        var top = document.getElementById('qaRunDetailTop');
        var body = document.getElementById('qaRunDetailBody');
        if (top) {
            var s = run.summary || {};
            var aiNote = '';
            if (s.ai_skipped) aiNote = ' ｜ <span class="qa-muted">AI 校核已跳过：' + escapeHtml(s.ai_skip_reason || '') + '</span>';
            else if (s.ai_model) aiNote = ' ｜ 模型 ' + escapeHtml(s.ai_model);
            top.innerHTML =
                '<div class="qa-run-meta">' +
                    '<span>任务：<b>' + escapeHtml(run.schedule_name || '（手动）') + '</b></span>' +
                    '<span>数据库：' + escapeHtml(qaDbLabel(run.database_id)) + '</span>' +
                    '<span>开始：' + escapeHtml(qaFmtTime(run.started_at)) + '</span>' +
                    '<span>耗时：' + escapeHtml(qaFmtDuration(run.duration_ms)) + '</span>' +
                    '<span>状态：' + (run.status === 'success' ? '<span class="qa-badge qa-badge-pass">成功</span>' : '<span class="qa-badge qa-badge-fail">失败</span>') + '</span>' +
                '</div>' +
                '<div class="qa-run-sum">通过 ' + (Number(run.passed) || 0) + ' / 不通过 ' + (Number(run.failed) || 0) +
                ' ｜ AI 误判提示 ' + (Number(run.ai_flagged) || 0) + aiNote + '</div>' +
                (run.error ? ('<div class="qa-err">' + escapeHtml(run.error) + '</div>') : '');
        }
        if (body) {
            body.innerHTML = '';
            var rows = run.detail || [];
            if (!Array.isArray(rows) || !rows.length) {
                body.innerHTML = '<tr><td colspan="6" class="qa-empty-cell">无规则明细。</td></tr>';
            } else {
                rows.forEach(function (r) {
                    var tr = document.createElement('tr');
                    var result;
                    if (r.skipped) result = '<span class="qa-badge qa-badge-skip">跳过</span>';
                    else if (r.error) result = '<span class="qa-badge qa-badge-fail">错误</span>';
                    else if (r.passed === true) result = '<span class="qa-badge qa-badge-pass">通过</span>';
                    else result = '<span class="qa-badge qa-badge-fail">不通过</span>';
                    tr.innerHTML =
                        '<td><code>' + escapeHtml(r.nm || '') + '</code></td>' +
                        '<td>' + escapeHtml(r.name || '') + '</td>' +
                        '<td>' + escapeHtml(r.category || '') + '</td>' +
                        '<td>' + result + '</td>' +
                        '<td>' + (r.violation_count != null ? escapeHtml(r.violation_count) : '') + '</td>' +
                        '<td class="qa-run-ai-cell">' + qaRunAiCell(r) + '</td>';
                    if (r.ai_misjudged === true) tr.className = 'qa-run-row-warn';
                    body.appendChild(tr);
                });
            }
        }
        var rep = document.getElementById('qaRunDetailReport');
        if (rep) rep.disabled = !run.has_report;
    }

    function qaOpenRunModal(id) {
        qaRunDetailRow = null;
        var top = document.getElementById('qaRunDetailTop');
        var body = document.getElementById('qaRunDetailBody');
        if (top) top.innerHTML = '加载中…';
        if (body) body.innerHTML = '';
        qaEnsureModal('qaRunModal', true);
        fetchWithAuth(PREFIX + 'runs/' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (d) {
            if (!d.success) throw new Error(d.message || '加载详情失败');
            qaRunDetailRow = d.run;
            renderRunDetail(d.run);
        }).catch(function (e) {
            if (top) top.innerHTML = '<span class="qa-err">' + escapeHtml(e.message || String(e)) + '</span>';
        });
    }

    function qaDownloadRunReport(id) {
        fetchWithAuth(PREFIX + 'runs/' + encodeURIComponent(id) + '/report').then(function (r) {
            var ct = r.headers.get('Content-Type') || '';
            if (!r.ok || ct.indexOf('json') !== -1) {
                return r.json().then(function (j) { throw new Error((j && j.message) || r.statusText); });
            }
            return r.blob();
        }).then(function (blob) {
            var shared = window.GOV_SHARED || globalThis.GOV_SHARED || {};
            var download = typeof shared.govDownloadBlob === 'function'
                ? shared.govDownloadBlob
                : function (b, filename) {
                    var a = document.createElement('a');
                    a.href = URL.createObjectURL(b);
                    a.download = filename;
                    a.click();
                    URL.revokeObjectURL(a.href);
                };
            download(blob, 'qa-run-' + id + '.docx');
        }).catch(function (e) { showMsg(e.message || String(e), true); });
    }

    function bindQaSchedListeners() {
        if (qaSchedBound) return;
        qaSchedBound = true;

        Array.prototype.forEach.call(document.querySelectorAll('#qaSubtabs .qa-subtab'), function (btn) {
            btn.addEventListener('click', function () { qaSwitchSub(btn.getAttribute('data-qa-sub')); });
        });

        var schedRefresh = document.getElementById('qaSchedRefresh');
        if (schedRefresh) schedRefresh.addEventListener('click', function () { loadSchedules(); });
        var schedNew = document.getElementById('qaSchedNew');
        if (schedNew) schedNew.addEventListener('click', function () { qaOpenSchedModal(null); });
        var schedSave = document.getElementById('qaSchedSave');
        if (schedSave) schedSave.addEventListener('click', qaSaveSched);
        var schedCancel = document.getElementById('qaSchedCancel');
        if (schedCancel) schedCancel.addEventListener('click', function () { qaEnsureModal('qaSchedModal', false); });
        var schedCloseX = document.getElementById('qaSchedCloseX');
        if (schedCloseX) schedCloseX.addEventListener('click', function () { qaEnsureModal('qaSchedModal', false); });

        var freq = document.getElementById('qaSchedFreq');
        if (freq) freq.addEventListener('change', qaRenderFreqFields);
        var freqFields = document.getElementById('qaSchedFreqFields');
        if (freqFields) freqFields.addEventListener('change', qaUpdateCron);
        var cronInput = document.getElementById('qaSchedCron');
        if (cronInput) cronInput.addEventListener('input', qaUpdateCron);

        var ruleAll = document.getElementById('qaSchedRuleAll');
        if (ruleAll) ruleAll.addEventListener('change', function () {
            var v = ruleAll.checked;
            qaLeafRules().forEach(function (r) {
                if (v) qaSchedRuleNms[r.nm] = true;
                else delete qaSchedRuleNms[r.nm];
            });
            if (!v) qaSchedAiNms = {};
            qaRenderSchedTree();
        });

        var schedBody = document.getElementById('qaSchedBody');
        if (schedBody) schedBody.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
            if (!btn) return;
            var id = btn.getAttribute('data-id');
            var act = btn.getAttribute('data-act');
            var s = qaSchedList.filter(function (x) { return x.id === id; })[0];
            if (act === 'edit') qaOpenSchedModal(s);
            else if (act === 'del') qaDeleteSchedule(id, s && s.name);
            else if (act === 'run') qaRunScheduleNow(id);
        });
        if (schedBody) schedBody.addEventListener('change', function (e) {
            var t = e.target;
            if (t && t.classList && t.classList.contains('qa-sched-toggle')) {
                qaToggleSchedule(t.getAttribute('data-id'), t.checked);
            }
        });

        var runFilter = document.getElementById('qaRunFilter');
        if (runFilter) runFilter.addEventListener('change', function () { loadRuns(qaRunFilterValue()); });
        var runsRefresh = document.getElementById('qaRunsRefresh');
        if (runsRefresh) runsRefresh.addEventListener('click', function () { loadOverview(); loadRuns(qaRunFilterValue()); });
        var runsBody = document.getElementById('qaRunsBody');
        if (runsBody) runsBody.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
            if (!btn) return;
            var id = btn.getAttribute('data-id');
            if (btn.getAttribute('data-act') === 'detail') qaOpenRunModal(id);
            else if (btn.getAttribute('data-act') === 'report') qaDownloadRunReport(id);
        });

        var runCloseX = document.getElementById('qaRunCloseX');
        if (runCloseX) runCloseX.addEventListener('click', function () { qaEnsureModal('qaRunModal', false); });
        var runCloseBtn = document.getElementById('qaRunCloseBtn');
        if (runCloseBtn) runCloseBtn.addEventListener('click', function () { qaEnsureModal('qaRunModal', false); });
        var runReport = document.getElementById('qaRunDetailReport');
        if (runReport) runReport.addEventListener('click', function () {
            if (qaRunDetailRow && qaRunDetailRow.has_report) qaDownloadRunReport(qaRunDetailRow.id);
        });

        ['qaSchedModal', 'qaRunModal'].forEach(function (mid) {
            var m = document.getElementById(mid);
            if (m) m.addEventListener('click', function (e) { if (e.target === m) qaEnsureModal(mid, false); });
        });
        if (!window._qaSchedKeydownHandler) {
            window._qaSchedKeydownHandler = function (ev) {
                if (ev.key !== 'Escape') return;
                ['qaSchedModal', 'qaRunModal'].forEach(function (mid) {
                    var m = document.getElementById(mid);
                    if (m && m.classList.contains('show')) qaEnsureModal(mid, false);
                });
            };
            document.addEventListener('keydown', window._qaSchedKeydownHandler);
        }
    }

    function bindListeners() {
        if (listenersBound) return;
        try {
        bindQaTplModalOnce();
        bindQaSchedListeners();
        var qaSaveRule = document.getElementById('qaSaveRule');
        if (qaSaveRule) qaSaveRule.addEventListener('click', function () {
            var body = {
                nm: padNm(document.getElementById('qaNm').value),
                xh: document.getElementById('qaXh').value.trim(),
                name: document.getElementById('qaName').value.trim(),
                category: document.getElementById('qaCategory').value.trim(),
                sql: document.getElementById('qaSql').value,
                params: qaCollectRuleParams()
            };
            var miss = qaMissingParams(body.sql, body.params);
            if (miss.length) {
                showMsg('SQL 里的占位符还没填参数：' + miss.map(function (m) { return '{{' + m + '}}'; }).join('、'), true);
                return;
            }
            fetchWithAuth(PREFIX + 'rules', { method: 'POST', body: JSON.stringify(body) })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (!d.success) throw new Error(d.message);
                    showMsg('已保存', false);
                    return loadRules();
                })
                .catch(function (e) { showMsg(e.message || String(e), true); });
        });

        var qaSqlInput = document.getElementById('qaSql');
        if (qaSqlInput) qaSqlInput.addEventListener('input', function () { qaRenderRuleParams(); });
        qaRenderRuleParams();

        var qaDelRule = document.getElementById('qaDelRule');
        if (qaDelRule) qaDelRule.addEventListener('click', function () {            var nm = padNm(document.getElementById('qaNm').value);
            var nmName = (document.getElementById('qaName').value || '').trim();
            if (!nm) return;
            if (!confirm('确定删除规则 ' + nm + (nmName ? '「' + nmName + '」' : '') + '？\n此操作不可恢复，且引用该规则的定时任务会同步失效。')) return;
            fetchWithAuth(PREFIX + 'rules/' + encodeURIComponent(nm), { method: 'DELETE' })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (!d.success) throw new Error(d.message);
                    showMsg('已删除', false);
                    return loadRules();
                })
                .catch(function (e) { showMsg(e.message || String(e), true); });
        });

        var qaPasteExcel = document.getElementById('qaPasteExcel');
        if (qaPasteExcel) qaPasteExcel.addEventListener('click', function () {
            var raw = prompt('请从 Excel 复制多行（列顺序：NM, XH, 名称, SQL, 类别, 参数），粘贴到此处：\n参数列可选，填写 SQL 中 {{占位符}} 的实际值（JSON 或 表名=xxx;字段名=yyy）。\n批量导入，一次多行；列格式见「下载模板」。');
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

        var qaDownloadTemplate = document.getElementById('qaDownloadTemplate');
        if (qaDownloadTemplate) qaDownloadTemplate.addEventListener('click', function () {
            try {
                if (typeof XLSX === 'undefined') { showMsg('XLSX 库未加载，无法生成模板', true); return; }
                var header = ['NM', 'XH', '名称', 'SQL', '类别', '参数'];
                var rows = [
                    ['010100', '0101', '主键唯一性', 'SELECT {{字段名}} FROM {{表名}} GROUP BY {{字段名}} HAVING COUNT(*) > 1', '完整性', '{"表名":"T_ORDER","字段名":"ORDER_ID"}'],
                    ['010200', '0102', '手机号格式', "SELECT * FROM {{表名}} WHERE {{字段名}} NOT LIKE '1%'", '规范性', '{"表名":"T_USER","字段名":"PHONE"}'],
                    ['010000', '01', '表数据量校验', 'SELECT COUNT(*) FROM T_COUNT', '基础校验', '']
                ];
                var wb = XLSX.utils.book_new();
                var ws = XLSX.utils.aoa_to_sheet([header].concat(rows));
                ws['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 64 }, { wch: 12 }, { wch: 40 }];
                XLSX.utils.book_append_sheet(wb, ws, '规则导入模板');
                var notes = [
                    ['列名', '是否必填', '说明'],
                    ['NM', '是', '6 位数字编号，不足 6 位前补 0（如 010000）。同一 NM 重复导入会覆盖原规则'],
                    ['XH', '是', '层级编码，每两位一级（01 / 0101 / 010101），用于规则树分组'],
                    ['名称', '是', '规则名称'],
                    ['SQL', '是', '审核用 SQL，按 Oracle 方言书写，执行时自动转换为目标库方言。可变部分写成 {{名称}} 占位符，例如 SELECT * FROM {{表名}} WHERE {{字段名}} IS NULL'],
                    ['类别', '否', '自由文本分类，如 完整性 / 规范性 / 基础校验'],
                    ['参数', '占位符存在时必填', 'JSON 对象，键为占位符名：{"表名":"T_ORDER","字段名":"ORDER_ID"}。也支持 表名=T_ORDER;字段名=ORDER_ID 写法'],
                    ['', '', '占位符没填参数时规则无法执行（会提示「参数未配置」），保存时即会被拦下']
                ];
                var ws2 = XLSX.utils.aoa_to_sheet(notes);
                ws2['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 72 }];
                XLSX.utils.book_append_sheet(wb, ws2, '列说明');
                XLSX.writeFile(wb, 'quality-audit-rules-template.xlsx');
                showMsg('模板已下载', false);
            } catch (e) {
                showMsg(e.message || String(e), true);
            }
        });

        var qaXlsxFile = document.getElementById('qaXlsxFile');
        if (qaXlsxFile) qaXlsxFile.addEventListener('change', function (ev) {
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

        var qaFillItemAll = document.getElementById('qaFillItemAll');
        if (qaFillItemAll) qaFillItemAll.addEventListener('change', function (e) {
            setFillTreeChecked('qaFillItemTree', e.target.checked);
        });
        var qaFillRecordAll = document.getElementById('qaFillRecordAll');
        if (qaFillRecordAll) qaFillRecordAll.addEventListener('change', function (e) {
            setFillTreeChecked('qaFillRecordTree', e.target.checked);
        });

        var qaAddRowItem = document.getElementById('qaAddRowItem');
        if (qaAddRowItem) qaAddRowItem.addEventListener('click', function () {
            var root = document.getElementById('qaFillItemTree');
            if (root) {
                root.appendChild(createFillNode({ table_name: '', numerator: '', denominator: '', checked: true }));
                updateFillSelectAll();
            }
        });
        var qaAddRowRecord = document.getElementById('qaAddRowRecord');
        if (qaAddRowRecord) qaAddRowRecord.addEventListener('click', function () {
            var root = document.getElementById('qaFillRecordTree');
            if (root) {
                root.appendChild(createFillNode({ table_name: '', numerator: '', denominator: '', checked: true }));
                updateFillSelectAll();
            }
        });

        var qaDelRowsItem = document.getElementById('qaDelRowsItem');
        if (qaDelRowsItem) qaDelRowsItem.addEventListener('click', function () {
            deleteCheckedFillRows('qaFillItemTree');
        });
        var qaDelRowsRecord = document.getElementById('qaDelRowsRecord');
        if (qaDelRowsRecord) qaDelRowsRecord.addEventListener('click', function () {
            deleteCheckedFillRows('qaFillRecordTree');
        });

        var qaSaveFill = document.getElementById('qaSaveFill');
        if (qaSaveFill) qaSaveFill.addEventListener('click', function () {
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

        var qaPasteFill = document.getElementById('qaPasteFill');
        if (qaPasteFill) qaPasteFill.addEventListener('click', function () {
            var itemVisible = document.getElementById('qaFillItem').style.display !== 'none';
            var raw = prompt(itemVisible
                ? '请从 Excel 复制多行（列顺序：表名, 字段名, 分子, 分母），粘贴到此处：'
                : '请从 Excel 复制多行（列顺序：表名, 分子, 分母），粘贴到此处：');
            if (!raw) return;
            var parsed = parseExcelPasteFillRates(raw, itemVisible);
            if (!parsed.length) { showMsg('未解析到有效行', true); return; }
            var treeId = itemVisible ? 'qaFillItemTree' : 'qaFillRecordTree';
            var withChecked = parsed.map(function (p) {
                return normalizeFillRow(p);
            });
            renderFillTree(treeId, withChecked);
            // 自动保存
            var body = {
                item_fill_rate: collectFill('qaFillItemTree'),
                record_fill_rate: collectFill('qaFillRecordTree')
            };
            fetchWithAuth(PREFIX + 'fill-rates', { method: 'POST', body: JSON.stringify(body) })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (!d.success) throw new Error(d.message);
                    showMsg('已填充 ' + parsed.length + ' 行并保存（' + (itemVisible ? '项填报率' : '记录填报率') + '）', false);
                })
                .catch(function (e) { showMsg(e.message || String(e), true); });
        });

        // 规则树全选/取消全选
        // 展开/折叠切换按钮
        var qaToggleExpand = document.getElementById('qaToggleExpand');
        if (qaToggleExpand) qaToggleExpand.addEventListener('click', function () {
            var btn = this;
            var details = document.querySelectorAll('#qualityTab .qa-tree details');
            var allOpen = Array.from(details).every(function(d) { return d.open; });
            if (allOpen) {
                // 全部展开 -> 折叠全部
                details.forEach(function(d) { d.open = false; });
                btn.textContent = '展开全部';
            } else {
                // 部分折叠 -> 展开全部
                details.forEach(function(d) { d.open = true; });
                btn.textContent = '折叠全部';
            }
        });
        var qaTreeSelectAll = document.getElementById('qaTreeSelectAll');
        if (qaTreeSelectAll) qaTreeSelectAll.addEventListener('change', function (e) {
            var checked = e.target.checked;
            // 从 flatRules 获取所有规则 NM
            flatRules.forEach(function (r) {
                if (r.sql && r.sql.trim()) { // 只选择有 SQL 的叶子规则
                    selectedNms[r.nm] = checked;
                }
            });
            // 更新所有复选框
            document.querySelectorAll('#qaTree .qa-rule-cb').forEach(function (cb) { cb.checked = checked; });
            // 重新渲染树以更新父节点状态
            var treeEl = document.getElementById('qaTree');
            var openState = {};
            treeEl.querySelectorAll('details').forEach(function (d) {
                var k = d.dataset.treeNm;
                if (k) openState[k] = d.open;
            });
            reconcileTree(ruleTree);
            renderTree(ruleTree, treeEl, openState);
        });

        // 批量删除
        var qaBatchDelete = document.getElementById('qaBatchDelete');
        if (qaBatchDelete) qaBatchDelete.addEventListener('click', function () {
            var toDelete = Object.keys(selectedNms).filter(function (nm) { return selectedNms[nm]; });
            if (!toDelete.length) { showMsg('请先勾选要删除的规则', true); return; }
            if (!confirm('确定删除选中的 ' + toDelete.length + ' 条规则？此操作不可恢复。')) return;
            var prom = Promise.resolve();
            toDelete.forEach(function (nm) {
                prom = prom.then(function () {
                    return fetchWithAuth(PREFIX + 'rules/' + encodeURIComponent(nm), { method: 'DELETE' })
                        .then(function (r) { return r.json(); })
                        .then(function (d) { if (!d.success) throw new Error(d.message || '删除失败'); });
                });
            });
            prom.then(function () {
                showMsg('已删除 ' + toDelete.length + ' 条规则', false);
                selectedNms = {};
                return loadRules();
            }).catch(function (e) { showMsg(e.message || String(e), true); });
        });

        var qaRun = document.getElementById('qaRun');
        if (qaRun) qaRun.addEventListener('click', function () {
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

        var qaReport = document.getElementById('qaReport');
        if (qaReport) qaReport.addEventListener('click', function () {
            if (!lastAudit) { showMsg('请先执行一键审核', true); return; }
            var repPayload = { audit: lastAudit };
            if (qaReportTemplateId) repPayload.template_id = qaReportTemplateId;
            fetchWithAuth(PREFIX + 'report', {
                method: 'POST',
                body: JSON.stringify(repPayload)
            }).then(function (r) {
                var ct = r.headers.get('Content-Type') || '';
                if (!r.ok || ct.indexOf('json') !== -1) {
                    return r.json().then(function (j) { throw new Error((j && j.message) || r.statusText); });
                }
                return r.blob();
            }).then(function (blob) {
                var shared = window.GOV_SHARED || globalThis.GOV_SHARED || {};
                var download = typeof shared.govDownloadBlob === 'function'
                    ? shared.govDownloadBlob
                    : function (blob, filename) {
                        var a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = filename;
                        a.click();
                        URL.revokeObjectURL(a.href);
                    };
                download(blob, 'quality-audit-report.docx');
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
        var needLoadRules = !window._qualityAuditRulesLoaded;
        var chain = needLoadRules ? loadRules() : Promise.resolve();
        if (needLoadRules) {
            chain = chain.then(function () {
                window._qualityAuditRulesLoaded = true;
            });
        }
        chain.then(loadDatabases).then(loadFillRates).then(function () {
            return syncQaReportTemplateIdFromServer();
        }).then(function () {
            qaSwitchSub(qaCurrentSub);
        }).catch(function (e) {
            if (needLoadRules) {
                window._qualityAuditRulesLoaded = false;
            }
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

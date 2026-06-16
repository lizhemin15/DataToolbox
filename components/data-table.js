/* 数据表格 — 原子组件 */
/* config: { title, data_source, columns, rows, striped, dense, max_height } */
function renderDataTable(config, containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    function buildTable(data) {
        var cols = data.columns || config.columns || [];
        var rows = data.rows || config.rows || [];
        var striped = config.striped !== false;
        var dense = config.dense || false;

        if (!cols.length || !rows.length) {
            container.innerHTML = '<div class="widget-empty">暂无数据</div>';
            return;
        }

        var cellP = dense ? '6px 10px' : '10px 14px';
        var fontSize = dense ? '11px' : '12px';

        var thead = '<thead><tr>' + cols.map(function(c) {
            var key = typeof c === 'string' ? c : c.key;
            var title = typeof c === 'string' ? c : (c.title || c.key);
            return '<th style="padding:' + cellP + ';font-size:' + fontSize + ';font-weight:500;color:var(--text-secondary);text-align:left;border-bottom:1px solid var(--border);white-space:nowrap;">' + title + '</th>';
        }).join('') + '</tr></thead>';

        var tbody = '<tbody>' + rows.map(function(row, ri) {
            var bg = striped && ri % 2 === 1 ? 'background:var(--bg-hover);' : '';
            return '<tr style="' + bg + '">' + cols.map(function(c) {
                var key = typeof c === 'string' ? c : c.key;
                var val = row[key] !== undefined ? row[key] : '';
                return '<td style="padding:' + cellP + ';font-size:' + fontSize + ';color:var(--text);border-bottom:1px solid var(--border-subtle);">' + val + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody>';

        var wrapperStyle = '';
        if (config.max_height > 0) {
            wrapperStyle = 'max-height:' + config.max_height + 'px;overflow-y:auto;';
            thead = '<table class="widget-table" style="width:100%;border-collapse:collapse;position:sticky;top:0;background:var(--bg);z-index:1;">' + thead + '</table>';
            tbody = '<div style="' + wrapperStyle + '"><table class="widget-table" style="width:100%;border-collapse:collapse;">' + tbody + '</table></div>';
        } else {
            var tableHTML = '<table class="widget-table" style="width:100%;border-collapse:collapse;">' + thead + tbody + '</table>';
        }

        var html = (config.title ? '<div class="widget-header">' + config.title + '</div>' : '') +
            (config.max_height > 0 ? thead + tbody : tableHTML);

        container.innerHTML = html;
    }

    if (config.data_source && window.fetchWithAuth) {
        container.innerHTML = '<div class="widget-loading">加载中...</div>';
        fetchWithAuth(config.data_source)
            .then(function(r) { return r.json(); })
            .then(buildTable)
            .catch(function() { buildTable({}); });
    } else {
        buildTable({});
    }
}

/* 统计报表卡片组模板 */
/* config: { title, data_source, metric_field, value_field, change_field, columns, colors } */
function renderDashboardSummary(config, containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var cols = config.columns || 4;
    var colors = config.colors || ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];

    function buildCards(metrics) {
        var html = '';
        if (config.title) {
            html += '<div style="font-size:18px;font-weight:600;color:#1a202c;margin-bottom:16px;">' + config.title + '</div>';
        }
        html += '<div style="display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:16px;">';
        metrics.forEach(function(m, i) {
            var color = colors[i % colors.length];
            var changeHtml = '';
            if (m.change !== undefined && m.change !== null) {
                var up = m.change >= 0;
                var arrow = up ? '↑' : '↓';
                var changeColor = up ? '#10B981' : '#EF4444';
                changeHtml = '<div style="font-size:13px;color:' + changeColor + ';margin-top:8px;">' + arrow + ' ' + Math.abs(m.change).toFixed(1) + '%</div>';
            }
            html += '<div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);border-left:4px solid ' + color + ';">' +
                '<div style="font-size:13px;color:#718096;margin-bottom:8px;">' + m.name + '</div>' +
                '<div style="font-size:28px;font-weight:700;color:#1a202c;">' + formatNum(m.value) + '</div>' +
                changeHtml +
                '</div>';
        });
        html += '</div>';
        return html;
    }

    function formatNum(v) {
        if (v === null || v === undefined) return '-';
        if (Math.abs(v) >= 100000000) return (v / 100000000).toFixed(2) + '亿';
        if (Math.abs(v) >= 10000) return (v / 10000).toFixed(2) + '万';
        if (Number.isInteger(v)) return v.toLocaleString();
        return parseFloat(v).toFixed(2);
    }

    // Demo data
    var demoMetrics = [
        { name: '总销售额', value: 1285600, change: 12.5 },
        { name: '订单数', value: 8520, change: 8.3 },
        { name: '客单价', value: 150.8, change: -2.1 },
        { name: '活跃用户', value: 32400, change: 15.7 }
    ];

    if (config.data_source) {
        container.innerHTML = '<div style="padding:20px;color:#999;">加载中...</div>';
        fetchWithAuth(config.data_source)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var rows = data.rows || data.data || [];
                var dbCols = data.columns || [];
                if (rows.length === 0) { container.innerHTML = buildCards(demoMetrics); return; }

                var colNames = dbCols.map(function(c) { return typeof c === 'string' ? c : c.name; });
                var mIdx = colNames.indexOf(config.metric_field || colNames[0]);
                var vIdx = colNames.indexOf(config.value_field || colNames[1]);
                var cIdx = config.change_field ? colNames.indexOf(config.change_field) : -1;

                var metrics = rows.map(function(r) {
                    var obj = { name: r[mIdx !== -1 ? mIdx : 0], value: r[vIdx !== -1 ? vIdx : 1] };
                    if (cIdx !== -1) obj.change = r[cIdx];
                    return obj;
                });

                container.innerHTML = buildCards(metrics);
            })
            .catch(function(err) {
                container.innerHTML = '<div style="padding:8px;color:#999;font-size:12px;margin-bottom:8px;">数据加载失败，显示示例数据</div>' + buildCards(demoMetrics);
            });
    } else {
        container.innerHTML = buildCards(demoMetrics);
    }
}

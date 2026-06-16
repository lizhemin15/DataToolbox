/* KPI 卡片 — 原子组件 */
/* config: { title, value, prefix, suffix, trend, trend_value, sparkline_data, accent } */
function renderKpiCard(config, containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var value = config.value || '--';
    var prefix = config.prefix || '';
    var suffix = config.suffix || '';
    var title = config.title || '';
    var trend = config.trend || 'none';
    var trendValue = config.trend_value || '';
    var accent = config.accent || 'var(--accent)';
    var sparkline = config.sparkline_data || [];

    // Build sparkline SVG if data provided
    var sparklineHTML = '';
    if (sparkline.length > 1) {
        var w = 80, h = 24, pad = 2;
        var max = Math.max.apply(null, sparkline);
        var min = Math.min.apply(null, sparkline);
        var range = max - min || 1;
        var points = sparkline.map(function(v, i) {
            var x = pad + (i / (sparkline.length - 1)) * (w - pad * 2);
            var y = pad + (1 - (v - min) / range) * (h - pad * 2);
            return x + ',' + y;
        }).join(' ');
        var areaPoints = points + ' ' + (w - pad) + ',' + (h - pad) + ' ' + pad + ',' + (h - pad);
        var color = trend === 'up' ? 'var(--success)' : trend === 'down' ? 'var(--danger)' : accent;
        sparklineHTML = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="flex-shrink:0;margin-left:auto;">' +
            '<polygon points="' + areaPoints + '" fill="' + color + '" opacity="0.12"/>' +
            '<polyline points="' + points + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>';
    }

    // Trend indicator
    var trendHTML = '';
    if (trend !== 'none' && trendValue) {
        var arrow = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
        var trendColor = trend === 'up' ? 'var(--success)' : trend === 'down' ? 'var(--danger)' : 'var(--text-secondary)';
        trendHTML = '<span class="kpi-trend" style="color:' + trendColor + '">' + arrow + ' ' + trendValue + '</span>';
    }

    container.innerHTML = '<div class="kpi-card" style="--kpi-accent:' + accent + '">' +
        (title ? '<div class="kpi-title">' + title + '</div>' : '') +
        '<div class="kpi-body">' +
            '<div class="kpi-value-row">' +
                '<span class="kpi-value">' + prefix + value + suffix + '</span>' +
                sparklineHTML +
            '</div>' +
            trendHTML +
        '</div>' +
        '</div>';
}

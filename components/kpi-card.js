/* config: { title, data_source, metrics[], columns } */
/* metrics: [{ label, field, prefix, suffix, trend_field, color }] */
function renderKpiCards(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const cols = parseInt(config.columns) || 4;
    container.style.display = 'grid';
    container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    container.style.gap = '16px';

    fetchWithAuth(config.data_source)
        .then(r => r.json())
        .then(data => {
            const rows = data.rows || data.data || [];
            const row = rows[0] || {};
            const metrics = config.metrics || [];

            container.innerHTML = metrics.map(m => {
                const value = row[m.field] || '--';
                const trend = m.trend_field && row[m.trend_field] !== undefined ? row[m.trend_field] : null;
                const trendUp = trend !== null && parseFloat(trend) > 0;
                const trendDown = trend !== null && parseFloat(trend) < 0;
                const trendColor = trendUp ? '#10B981' : trendDown ? '#EF4444' : '#6B7280';
                const trendIcon = trendUp ? '↑' : trendDown ? '↓' : '→';

                return `
                <div class="kpi-card" style="background:var(--bg);border-radius:var(--radius);padding:20px;box-shadow:var(--shadow);border-left:3px solid ${m.color || '#4F46E5'}">
                    <div style="color:var(--text-secondary);font-size:13px;margin-bottom:8px">${m.label}</div>
                    <div style="font-size:28px;font-weight:700;color:${m.color || 'var(--text)'}">
                        ${m.prefix || ''}${value}${m.suffix || ''}
                    </div>
                    ${trend !== null ? `
                    <div style="margin-top:8px;font-size:13px;color:${trendColor}">
                        ${trendIcon} ${Math.abs(parseFloat(trend))}%
                    </div>` : ''}
                </div>`;
            }).join('');
        })
        .catch(err => {
            container.innerHTML = '<div style="padding:20px;color:#EF4444;">数据加载失败: ' + err.message + '</div>';
        });
}
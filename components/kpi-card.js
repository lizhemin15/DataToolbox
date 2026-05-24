/* KPI 指标卡片模板 */
/* config: { title, data_source, metrics, value, unit, trend, trend_value, columns } */
/* 支持两种模式: metrics[] (API) 或直接 value/unit/trend (静态预览) */
function renderKpiCards(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const cols = parseInt(config.columns) || 4;

    // 直接数据模式（静态 KPI）
    if (config.value !== undefined) {
        container.style.display = 'grid';
        container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        container.style.gap = '16px';

        const trendUp = config.trend === 'up';
        const trendDown = config.trend === 'down';
        const trendColor = trendUp ? '#10B981' : trendDown ? '#EF4444' : '#6B7280';
        const trendIcon = trendUp ? '↑' : trendDown ? '↓' : '→';

        container.innerHTML = `
        <div class="kpi-card" style="background:var(--bg);border-radius:var(--radius);padding:20px;box-shadow:var(--shadow);border-left:3px solid var(--primary)">
            <div style="color:var(--text-secondary);font-size:13px;margin-bottom:8px">${config.title || ''}</div>
            <div style="font-size:28px;font-weight:700;color:var(--primary)">
                ${config.prefix || ''}${config.value}${config.suffix || config.unit ? ' ' + (config.unit || '') : ''}
            </div>
            ${config.trend ? `
            <div style="margin-top:8px;font-size:13px;color:${trendColor}">
                ${trendIcon} ${config.trend_value || ''}
            </div>` : ''}
        </div>`;
        return;
    }

    // API 数据模式: metrics[] 数组
    container.style.display = 'grid';
    container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    container.style.gap = '16px';

    // 演示数据回退：无 metrics 且无 data_source 时显示演示 KPI
    const hasMetrics = config.metrics && config.metrics.length > 0;
    const hasDataSource = config.data_source;

    if (!hasMetrics && !hasDataSource) {
        const demoMetrics = [
            { label: '总收入', value: '¥128,500', trend: 'up', trend_value: '12.5%', color: '#4F46E5' },
            { label: '订单数', value: '2,340', trend: 'up', trend_value: '8.2%', color: '#10B981' },
            { label: '客单价', value: '¥54.9', trend: 'down', trend_value: '3.1%', color: '#F59E0B' },
            { label: '转化率', value: '24.6%', trend: 'up', trend_value: '5.3%', color: '#8B5CF6' }
        ];
        container.innerHTML = demoMetrics.map(m => {
            const trendColor = m.trend === 'up' ? '#10B981' : '#EF4444';
            const trendIcon = m.trend === 'up' ? '↑' : '↓';
            return `
            <div class="kpi-card" style="background:var(--bg);border-radius:var(--radius);padding:20px;box-shadow:var(--shadow);border-left:3px solid ${m.color}">
                <div style="color:var(--text-secondary);font-size:13px;margin-bottom:8px">${m.label}</div>
                <div style="font-size:28px;font-weight:700;color:${m.color}">${m.value}</div>
                <div style="margin-top:8px;font-size:13px;color:${trendColor}">${trendIcon} ${m.trend_value}</div>
            </div>`;
        }).join('');
        return;
    }

    if (!hasMetrics || !hasDataSource) {
        container.innerHTML = '<div style="padding:20px;color:#999;">未配置数据源或指标</div>';
        return;
    }

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
                <div class="kpi-card" style="background:var(--bg);border-radius:var(--radius);padding:20px;box-shadow:var(--shadow);border-left:3px solid ${m.color || 'var(--primary)'}">
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
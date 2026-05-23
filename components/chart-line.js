/* config: { title, data_source, x_field, y_fields, smooth, area_fill, colors, height } */
function renderLineChart(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container || typeof echarts === 'undefined') {
        if (container) container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">ECharts 未加载</div>';
        return;
    }
    const chart = echarts.init(container);
    const colors = config.colors || ['#4F46E5', '#10B981', '#F59E0B'];

    fetchWithAuth(config.data_source)
        .then(r => r.json())
        .then(data => {
            const rows = data.rows || data.data || [];
            const xData = rows.map(r => r[config.x_field]);
            const yFields = config.y_fields || [];

            const series = yFields.map((field, i) => ({
                name: field,
                type: 'line',
                smooth: config.smooth !== false,
                areaStyle: config.area_fill ? { opacity: 0.15 } : undefined,
                data: rows.map(r => r[field]),
                lineStyle: { width: 2, color: colors[i % colors.length] },
                itemStyle: { color: colors[i % colors.length] }
            }));

            chart.setOption({
                title: { text: config.title || '', left: 'center', textStyle: { fontSize: 16, fontWeight: 600 } },
                tooltip: { trigger: 'axis' },
                legend: { bottom: 0 },
                grid: { left: '3%', right: '4%', bottom: 40, top: config.title ? 50 : 20, containLabel: true },
                xAxis: { type: 'category', data: xData, boundaryGap: false },
                yAxis: { type: 'value' },
                series
            });
        })
        .catch(err => {
            container.innerHTML = '<div style="padding:20px;color:#EF4444;">数据加载失败: ' + err.message + '</div>';
        });

    window.addEventListener('resize', () => chart.resize());
    return chart;
}
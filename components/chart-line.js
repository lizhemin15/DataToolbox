/* ECharts 折线图模板 */
/* config: { title, data_source, x_field, y_fields, x_axis, series, colors, show_legend, height, smooth, area } */
function renderLineChart(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (typeof echarts === 'undefined') {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">ECharts 未加载</div>';
        return;
    }

    const chart = echarts.init(container);
    const colors = config.colors || ['#4F46E5', '#10B981', '#F59E0B', '#EF4444'];
    const smooth = config.smooth !== false;

    // 直接数据模式
    if (config.x_axis && config.series && config.series.length > 0) {
        chart.setOption(buildLineOption(config, colors, smooth));
        window.addEventListener('resize', () => chart.resize());
        return chart;
    }

    // API 模式
    if (config.data_source) {
        container.innerHTML = '<div style="padding:20px;color:#999;">加载中...</div>';
        fetchWithAuth(config.data_source)
            .then(r => r.json())
            .then(data => {
                const rows = data.rows || data.data || [];
                const xField = config.x_field || 'name';
                const yFields = config.y_fields || [];
                const xData = rows.map(r => r[xField]);
                const series = yFields.map((yf, i) => ({
                    name: yf,
                    type: 'line',
                    smooth: smooth,
                    data: rows.map(r => r[yf]),
                    lineStyle: { width: 2 },
                    itemStyle: { color: colors[i % colors.length] }
                }));
                chart.setOption({
                    title: { text: config.title || '', left: 'center', textStyle: { fontSize: 16, fontWeight: 600 } },
                    tooltip: { trigger: 'axis' },
                    legend: { show: config.show_legend !== false && series.length > 1, bottom: 0 },
                    grid: { left: '3%', right: '4%', bottom: series.length > 1 ? '12%' : '6%', top: config.title ? '15%' : '8%', containLabel: true },
                    xAxis: { type: 'category', data: xData, boundaryGap: false },
                    yAxis: { type: 'value' },
                    series: series
                });
            })
            .catch(err => {
                container.innerHTML = '<div style="padding:20px;color:#EF4444;">数据加载失败: ' + err.message + '</div>';
            });
        window.addEventListener('resize', () => chart.resize());
        return chart;
    }

    // 演示数据回退
    const demoConfig = {
        title: config.title || '收入与成本趋势',
        x_axis: ['1月', '2月', '3月', '4月', '5月', '6月'],
        series: [
            { name: '收入(万元)', data: [82, 93, 90, 110, 125, 140] },
            { name: '成本(万元)', data: [55, 58, 60, 62, 68, 72] }
        ]
    };
    chart.setOption(buildLineOption(demoConfig, colors, smooth));
    window.addEventListener('resize', () => chart.resize());
    return chart;
}

function buildLineOption(config, colors, smooth) {
    const series = (config.series || []).map((s, i) => ({
        name: s.name || ('系列' + (i + 1)),
        type: 'line',
        smooth: smooth,
        data: s.data || [],
        lineStyle: { width: 2 },
        itemStyle: { color: s.color || colors[i % colors.length] },
        areaStyle: config.area ? { opacity: 0.15 } : undefined
    }));
    return {
        title: { text: config.title || '', left: 'center', textStyle: { fontSize: 16, fontWeight: 600 } },
        tooltip: { trigger: 'axis' },
        legend: { show: config.show_legend !== false && series.length > 1, bottom: 0 },
        grid: { left: '3%', right: '4%', bottom: series.length > 1 ? '12%' : '6%', top: config.title ? '15%' : '8%', containLabel: true },
        xAxis: { type: 'category', data: config.x_axis || [], boundaryGap: false },
        yAxis: { type: 'value' },
        series: series
    };
}
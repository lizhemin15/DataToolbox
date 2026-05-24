/* ECharts 柱状图模板 */
/* config: { title, data_source, x_field, y_fields, x_axis, series, colors, show_legend, height, stack } */
function renderBarChart(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (typeof echarts === 'undefined') {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">ECharts 未加载</div>';
        return;
    }

    const chart = echarts.init(container);
    const colors = config.colors || ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];

    // 直接数据模式: config.x_axis + config.series[]
    if (config.x_axis && config.series && config.series.length > 0) {
        chart.setOption(buildBarOption(config, colors));
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
                    type: 'bar',
                    stack: config.stack ? 'total' : undefined,
                    data: rows.map(r => r[yf]),
                    itemStyle: { color: colors[i % colors.length], borderRadius: [4, 4, 0, 0] }
                }));
                chart.setOption({
                    title: { text: config.title || '', left: 'center', textStyle: { fontSize: 16, fontWeight: 600 } },
                    tooltip: { trigger: 'axis' },
                    legend: { show: config.show_legend !== false && series.length > 1, bottom: 0 },
                    grid: { left: '3%', right: '4%', bottom: series.length > 1 ? '12%' : '6%', top: config.title ? '15%' : '8%', containLabel: true },
                    xAxis: { type: 'category', data: xData },
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
        title: config.title || '月度收入统计',
        x_axis: ['1月', '2月', '3月', '4月', '5月', '6月'],
        series: [{ name: '收入(万元)', data: [82, 93, 90, 110, 125, 140] }]
    };
    chart.setOption(buildBarOption(demoConfig, colors));
    window.addEventListener('resize', () => chart.resize());
    return chart;
}

function buildBarOption(config, colors) {
    const series = (config.series || []).map((s, i) => ({
        name: s.name || ('系列' + (i + 1)),
        type: 'bar',
        stack: config.stack ? 'total' : undefined,
        data: s.data || [],
        itemStyle: { color: s.color || colors[i % colors.length], borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 40
    }));
    return {
        title: { text: config.title || '', left: 'center', textStyle: { fontSize: 16, fontWeight: 600 } },
        tooltip: { trigger: 'axis' },
        legend: { show: config.show_legend !== false && series.length > 1, bottom: 0 },
        grid: { left: '3%', right: '4%', bottom: series.length > 1 ? '12%' : '6%', top: config.title ? '15%' : '8%', containLabel: true },
        xAxis: { type: 'category', data: config.x_axis || [] },
        yAxis: { type: 'value' },
        series: series
    };
}
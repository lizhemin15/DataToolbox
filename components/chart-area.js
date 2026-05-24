/* ECharts 面积图模板 */
/* config: { title, data_source, x_field, y_fields, x_axis, series, colors, show_legend, height, smooth, opacity } */
function renderChartArea(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (typeof echarts === 'undefined') {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">ECharts 未加载</div>';
        return;
    }

    const chart = echarts.init(container);
    const colors = config.colors || ['#4F46E5', '#10B981', '#F59E0B', '#EF4444'];
    const smooth = config.smooth !== false;
    const opacity = config.opacity || 0.25;

    // 直接数据模式
    if (config.x_axis && config.series && config.series.length > 0) {
        chart.setOption(buildAreaOption(config, colors, smooth, opacity));
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
                    data: rows.map(r => r[yf])
                }));
                chart.setOption(buildAreaOption({ ...config, x_axis: xData, series: series }, colors, smooth, opacity));
            })
            .catch(err => {
                container.innerHTML = '<div style="padding:20px;color:#EF4444;">数据加载失败: ' + err.message + '</div>';
            });
        window.addEventListener('resize', () => chart.resize());
        return chart;
    }

    // 演示数据回退
    const demoConfig = {
        title: config.title || '流量与转化趋势',
        x_axis: ['1月', '2月', '3月', '4月', '5月', '6月'],
        series: [
            { name: '访问量', data: [820, 932, 901, 1034, 1290, 1330] },
            { name: '转化量', data: [220, 282, 311, 356, 410, 438] }
        ]
    };
    chart.setOption(buildAreaOption(demoConfig, colors, smooth, opacity));
    window.addEventListener('resize', () => chart.resize());
    return chart;
}

function buildAreaOption(config, colors, smooth, opacity) {
    const series = (config.series || []).map((s, i) => ({
        name: s.name || ('系列' + (i + 1)),
        type: 'line',
        smooth: smooth,
        data: s.data || [],
        lineStyle: { width: 2 },
        itemStyle: { color: s.color || colors[i % colors.length] },
        areaStyle: { opacity: opacity, color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: (s.color || colors[i % colors.length]) + '40' },
            { offset: 1, color: (s.color || colors[i % colors.length]) + '05' }
        ])}
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
/* ECharts 折线图模板 */
/* config: { title, data_source, x_field, y_fields, x_axis, series, smooth, area, colors, show_legend, height } */
function renderLineChart(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (typeof echarts === 'undefined') {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">ECharts 未加载</div>';
        return;
    }

    const chart = echarts.init(container);
    const colors = config.colors || ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

    // 直接数据模式
    if (config.x_axis && config.series) {
        const xData = config.x_axis;
        const series = config.series.map((s, i) => ({
            name: s.name || `系列${i+1}`,
            type: 'line',
            smooth: config.smooth !== false,
            areaStyle: config.area ? { opacity: 0.15 } : undefined,
            data: s.data,
            itemStyle: { color: colors[i % colors.length] }
        }));

        chart.setOption({
            title: { text: config.title || '', left: 'center', textStyle: { fontSize: 16, fontWeight: 600 } },
            tooltip: { trigger: 'axis' },
            legend: { show: config.show_legend !== false, bottom: 0 },
            grid: { left: '3%', right: '4%', bottom: config.show_legend !== false ? 40 : 20, top: config.title ? 50 : 20, containLabel: true },
            xAxis: { type: 'category', data: xData, boundaryGap: false },
            yAxis: { type: 'value' },
            series
        });
    } else if (config.data_source) {
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
                    areaStyle: config.area ? { opacity: 0.15 } : undefined,
                    data: rows.map(r => r[field]),
                    itemStyle: { color: colors[i % colors.length] }
                }));
                chart.setOption({
                    title: { text: config.title || '', left: 'center', textStyle: { fontSize: 16, fontWeight: 600 } },
                    tooltip: { trigger: 'axis' },
                    legend: { show: config.show_legend !== false, bottom: 0 },
                    grid: { left: '3%', right: '4%', bottom: config.show_legend !== false ? 40 : 20, top: config.title ? 50 : 20, containLabel: true },
                    xAxis: { type: 'category', data: xData, boundaryGap: false },
                    yAxis: { type: 'value' },
                    series
                });
            })
            .catch(err => {
                container.innerHTML = '<div style="padding:20px;color:#EF4444;">数据加载失败: ' + err.message + '</div>';
            });
    }

    window.addEventListener('resize', () => chart.resize());
    return chart;
}
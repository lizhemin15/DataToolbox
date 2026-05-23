/* ECharts 饼图模板 */
/* config: { title, data_source, name_field, value_field, data, rose_type, colors, show_legend, height } */
function renderPieChart(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (typeof echarts === 'undefined') {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">ECharts 未加载</div>';
        return;
    }

    const chart = echarts.init(container);
    const colors = config.colors || ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#EC4899'];

    // 直接数据模式: config.data = [{name, value}]
    if (config.data) {
        chart.setOption({
            title: { text: config.title || '', left: 'center', textStyle: { fontSize: 16, fontWeight: 600 } },
            tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
            legend: { show: config.show_legend !== false, bottom: 0, type: 'scroll' },
            series: [{
                type: 'pie',
                radius: config.rose_type ? ['20%', '70%'] : ['40%', '70%'],
                roseType: config.rose_type || false,
                data: config.data.map((d, i) => ({
                    name: d.name,
                    value: d.value,
                    itemStyle: { color: colors[i % colors.length] }
                })),
                label: { formatter: '{b}\n{d}%' },
                emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' } }
            }]
        });
    } else if (config.data_source) {
        fetchWithAuth(config.data_source)
            .then(r => r.json())
            .then(data => {
                const rows = data.rows || data.data || [];
                const pieData = rows.map((r, i) => ({
                    name: r[config.name_field],
                    value: r[config.value_field],
                    itemStyle: { color: colors[i % colors.length] }
                }));
                chart.setOption({
                    title: { text: config.title || '', left: 'center', textStyle: { fontSize: 16, fontWeight: 600 } },
                    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
                    legend: { show: config.show_legend !== false, bottom: 0, type: 'scroll' },
                    series: [{
                        type: 'pie',
                        radius: config.rose_type ? ['20%', '70%'] : ['40%', '70%'],
                        roseType: config.rose_type || false,
                        data: pieData,
                        label: { formatter: '{b}\n{d}%' },
                        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' } }
                    }]
                });
            })
            .catch(err => {
                container.innerHTML = '<div style="padding:20px;color:#EF4444;">数据加载失败: ' + err.message + '</div>';
            });
    }

    window.addEventListener('resize', () => chart.resize());
    return chart;
}
/* config: { title, data_source, name_field, value_field, ring, ring_width, show_label, colors, height } */
function renderPieChart(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container || typeof echarts === 'undefined') {
        if (container) container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">ECharts 未加载</div>';
        return;
    }
    const chart = echarts.init(container);
    const colors = config.colors || ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

    fetchWithAuth(config.data_source)
        .then(r => r.json())
        .then(data => {
            const rows = data.rows || data.data || [];
            const pieData = rows.map(r => ({
                name: r[config.name_field],
                value: r[config.value_field]
            }));

            chart.setOption({
                title: { text: config.title || '', left: 'center', textStyle: { fontSize: 16, fontWeight: 600 } },
                tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
                legend: { orient: 'vertical', left: 'left', top: 'middle' },
                series: [{
                    type: 'pie',
                    radius: config.ring ? [config.ring_width + '%', '70%'] : '70%',
                    center: config.ring ? ['55%', '50%'] : ['50%', '50%'],
                    data: pieData,
                    label: { show: config.show_label !== false, formatter: '{b}\n{d}%' },
                    itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
                    color: colors,
                    emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.2)' } }
                }]
            });
        })
        .catch(err => {
            container.innerHTML = '<div style="padding:20px;color:#EF4444;">数据加载失败: ' + err.message + '</div>';
        });

    window.addEventListener('resize', () => chart.resize());
    return chart;
}
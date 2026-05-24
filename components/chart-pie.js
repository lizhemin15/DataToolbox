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
    if (config.data && config.data.length > 0) {
        chart.setOption(buildPieOption(config, colors));
        window.addEventListener('resize', () => chart.resize());
        return chart;
    }

    // API 模式
    if (config.data_source) {
        fetchWithAuth(config.data_source)
            .then(r => r.json())
            .then(data => {
                const rows = data.rows || data.data || [];
                const pieData = rows.map((r, i) => ({
                    name: r[config.name_field || 'name'],
                    value: r[config.value_field || 'value'],
                    itemStyle: { color: colors[i % colors.length] }
                }));
                chart.setOption(buildPieOption({ ...config, data: pieData }, colors));
            })
            .catch(err => {
                container.innerHTML = '<div style="padding:20px;color:#EF4444;">数据加载失败: ' + err.message + '</div>';
            });
        window.addEventListener('resize', () => chart.resize());
        return chart;
    }

    // 演示数据回退
    const demoConfig = {
        title: config.title || '产品销售占比',
        data: [
            { name: '电子产品', value: 35 },
            { name: '服装', value: 25 },
            { name: '食品', value: 20 },
            { name: '家居', value: 15 },
            { name: '其他', value: 5 }
        ]
    };
    chart.setOption(buildPieOption(demoConfig, colors));
    window.addEventListener('resize', () => chart.resize());
    return chart;
}

function buildPieOption(config, colors) {
    return {
        title: { text: config.title || '', left: 'center', textStyle: { fontSize: 16, fontWeight: 600 } },
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { show: config.show_legend !== false, bottom: 0, type: 'scroll' },
        series: [{
            type: 'pie',
            radius: config.rose_type ? ['20%', '70%'] : ['40%', '70%'],
            roseType: config.rose_type || false,
            data: (config.data || []).map((d, i) => ({
                name: d.name,
                value: d.value,
                itemStyle: d.itemStyle || { color: colors[i % colors.length] }
            })),
            label: { formatter: '{b}\n{d}%' },
            emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' } }
        }]
    };
}
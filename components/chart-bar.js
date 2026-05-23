/* ECharts 统一依赖 — 所有图表组件共用 */
/* 本地化 echarts.min.js 必须放在 /js/lib/echarts.min.js */

/* === 柱状图模板 === */
/* config: { title, data_source, x_field, y_fields, mode, colors, show_legend, height } */
function (config, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // 加载 ECharts
    if (typeof echarts === 'undefined') {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">ECharts 未加载</div>';
        return;
    }

    const chart = echarts.init(container);
    const colors = config.colors || ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

    fetchWithAuth(config.data_source)
        .then(r => r.json())
        .then(data => {
            const rows = data.rows || data.data || [];
            const cols = data.columns || [];
            const xData = rows.map(r => r[config.x_field]);
            const yFields = config.y_fields || [];

            const series = yFields.map((field, i) => ({
                name: field,
                type: 'bar',
                stack: config.mode === 'stacked' ? 'total' : undefined,
                data: rows.map(r => r[field]),
                itemStyle: { color: colors[i % colors.length], borderRadius: [4, 4, 0, 0] }
            }));

            chart.setOption({
                title: { text: config.title || '', left: 'center', textStyle: { fontSize: 16, fontWeight: 600 } },
                tooltip: { trigger: 'axis' },
                legend: { show: config.show_legend !== false, bottom: 0 },
                grid: { left: '3%', right: '4%', bottom: config.show_legend !== false ? 40 : 20, top: config.title ? 50 : 20, containLabel: true },
                xAxis: { type: 'category', data: xData, axisLabel: { rotate: xData.length > 8 ? 30 : 0 } },
                yAxis: { type: 'value' },
                series
            });
        })
        .catch(err => {
            container.innerHTML = '<div style="padding:20px;color:#EF4444;">数据加载失败: ' + err.message + '</div>';
        });

    // 响应式
    window.addEventListener('resize', () => chart.resize());
    return chart;
}
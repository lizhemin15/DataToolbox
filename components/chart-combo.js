/* ECharts 组合图模板（柱状+折线） */
/* config: { title, data_source, x_field, bar_fields, line_fields, colors, show_legend, height } */
function renderComboChart(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (typeof echarts === 'undefined') {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">ECharts 未加载</div>';
        return;
    }

    const chart = echarts.init(container);
    const colors = config.colors || ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];

    // Demo 数据
    var demoOption = {
        title: { text: config.title || '数据对比', left: 'center', textStyle: { fontSize: 16, color: '#1a202c' } },
        tooltip: { trigger: 'axis' },
        legend: { show: config.show_legend !== false, bottom: 0 },
        grid: { left: 60, right: 60, top: 50, bottom: 50 },
        xAxis: { type: 'category', data: ['1月','2月','3月','4月','5月','6月'] },
        yAxis: [
            { type: 'value', name: '销售额' },
            { type: 'value', name: '增长率(%)', splitLine: { show: false } }
        ],
        series: [
            { name: '销售额', type: 'bar', data: [120, 200, 150, 80, 70, 110], itemStyle: { color: colors[0] } },
            { name: '增长率', type: 'line', yAxisIndex: 1, data: [5, 12, -3, 8, 15, 7], itemStyle: { color: colors[1] }, lineStyle: { width: 2 } }
        ]
    };

    if (config.data_source) {
        container.innerHTML = '<div style="padding:20px;color:#999;">加载中...</div>';
        fetchWithAuth(config.data_source)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var rows = data.rows || data.data || [];
                var cols = data.columns || [];
                if (rows.length === 0) { chart.setOption(demoOption); return; }

                var xField = config.x_field || (cols[0] && cols[0].name) || 'name';
                var barFields = config.bar_fields || [];
                var lineFields = config.line_fields || [];

                // Build column name map
                var colNames = cols.map(function(c) { return typeof c === 'string' ? c : c.name; });
                var xIdx = colNames.indexOf(xField);
                var xData = rows.map(function(r) { return r[xIdx !== -1 ? xIdx : 0]; });

                var series = [];
                var colorIdx = 0;
                barFields.forEach(function(f) {
                    var fIdx = colNames.indexOf(f);
                    series.push({
                        name: f, type: 'bar', yAxisIndex: 0,
                        data: rows.map(function(r) { return fIdx !== -1 ? r[fIdx] : 0; }),
                        itemStyle: { color: colors[colorIdx++ % colors.length] }
                    });
                });
                lineFields.forEach(function(f) {
                    var fIdx = colNames.indexOf(f);
                    series.push({
                        name: f, type: 'line', yAxisIndex: 1,
                        data: rows.map(function(r) { return fIdx !== -1 ? r[fIdx] : 0; }),
                        itemStyle: { color: colors[colorIdx++ % colors.length] },
                        lineStyle: { width: 2 }
                    });
                });

                chart.setOption({
                    title: { text: config.title || '', left: 'center', textStyle: { fontSize: 16, color: '#1a202c' } },
                    tooltip: { trigger: 'axis' },
                    legend: { show: config.show_legend !== false, bottom: 0 },
                    grid: { left: 60, right: 60, top: 50, bottom: 50 },
                    xAxis: { type: 'category', data: xData },
                    yAxis: [
                        { type: 'value' },
                        { type: 'value', splitLine: { show: false } }
                    ],
                    series: series
                });
            })
            .catch(function(err) {
                container.innerHTML = '<div style="padding:20px;color:#999;">数据加载失败，显示示例数据</div>';
                chart.setOption(demoOption);
            });
    } else {
        chart.setOption(demoOption);
    }

    window.addEventListener('resize', function() { chart.resize(); });
    return chart;
}

/* ECharts 热力图模板 */
/* config: { title, data_source, x_field, y_field, value_field, color_range, show_legend, height } */
function renderHeatmapChart(config, containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    if (typeof echarts === 'undefined') {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">ECharts 未加载</div>';
        return;
    }

    var chart = echarts.init(container);
    var colorRanges = {
        'blue-red': ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'],
        'green-yellow': ['#006837', '#1a9850', '#66bd63', '#a6d96a', '#d9ef8b', '#fee08b', '#fdae61', '#f46d43', '#d73027', '#a50026'],
        'purple-orange': ['#4a1486', '#6a1b9a', '#8e24aa', '#ab47bc', '#ce93d8', '#ffcc80', '#ffa726', '#fb8c00', '#e65100', '#bf360c']
    };
    var inRange = colorRanges[config.color_range || 'blue-red'] || colorRanges['blue-red'];

    // Demo: 7x24 访问热力图
    var hours = ['00','01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23'];
    var days = ['周一','周二','周三','周四','周五','周六','周日'];
    var demoData = [];
    for (var i = 0; i < 7; i++) {
        for (var j = 0; j < 24; j++) {
            demoData.push([j, i, Math.round(Math.random() * 100)]);
        }
    }

    function buildOption(xData, yData, data) {
        return {
            title: { text: config.title || '热力分布', left: 'center', textStyle: { fontSize: 16, color: '#1a202c' } },
            tooltip: {
                position: 'top',
                formatter: function(p) { return yData[p.value[1]] + ' ' + xData[p.value[0]] + ': ' + p.value[2]; }
            },
            grid: { left: 80, right: 40, top: 50, bottom: 60 },
            xAxis: { type: 'category', data: xData, splitArea: { show: true } },
            yAxis: { type: 'category', data: yData, splitArea: { show: true } },
            visualMap: {
                min: 0, max: 100, calculable: true,
                orient: 'horizontal', left: 'center', bottom: 0,
                inRange: { color: inRange },
                show: config.show_legend !== false
            },
            series: [{
                type: 'heatmap', data: data,
                label: { show: false },
                emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.5)' } }
            }]
        };
    }

    if (config.data_source) {
        container.innerHTML = '<div style="padding:20px;color:#999;">加载中...</div>';
        fetchWithAuth(config.data_source)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var rows = data.rows || data.data || [];
                var cols = data.columns || [];
                if (rows.length === 0) { chart.setOption(buildOption(hours, days, demoData)); return; }

                var colNames = cols.map(function(c) { return typeof c === 'string' ? c : c.name; });
                var xField = config.x_field || colNames[0];
                var yField = config.y_field || colNames[1];
                var vField = config.value_field || colNames[2];
                var xIdx = colNames.indexOf(xField);
                var yIdx = colNames.indexOf(yField);
                var vIdx = colNames.indexOf(vField);

                var xSet = [], ySet = [];
                var heatData = [];
                rows.forEach(function(r) {
                    var x = r[xIdx !== -1 ? xIdx : 0];
                    var y = r[yIdx !== -1 ? yIdx : 1];
                    var v = r[vIdx !== -1 ? vIdx : 2];
                    if (xSet.indexOf(x) === -1) xSet.push(x);
                    if (ySet.indexOf(y) === -1) ySet.push(y);
                    heatData.push([xSet.indexOf(x), ySet.indexOf(y), v]);
                });

                chart.setOption(buildOption(xSet, ySet, heatData));
            })
            .catch(function(err) {
                container.innerHTML = '<div style="padding:20px;color:#999;">数据加载失败，显示示例数据</div>';
                chart.setOption(buildOption(hours, days, demoData));
            });
    } else {
        chart.setOption(buildOption(hours, days, demoData));
    }

    window.addEventListener('resize', function() { chart.resize(); });
    return chart;
}

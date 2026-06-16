/* 柱状图 — 原子组件，依赖 ECharts */
/* config: { title, data_source, categories, series, horizontal, stacked, show_legend } */
function renderBarChart(config, containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    if (typeof echarts === 'undefined') {
        container.innerHTML = '<div class="widget-error">ECharts 未加载</div>';
        return;
    }

    var chartDom = document.createElement('div');
    chartDom.style.width = '100%';
    chartDom.style.height = '100%';
    container.innerHTML = '';
    container.appendChild(chartDom);

    var myChart = echarts.init(chartDom);

    function drawChart(data) {
        var cats = data.categories || config.categories || [];
        var series = data.series || config.series || [];
        var horiz = config.horizontal || false;
        var stacked = config.stacked || false;

        var option = {
            title: config.title ? {
                text: config.title,
                left: 'left',
                top: 8,
                textStyle: { fontSize: 14, fontWeight: 500, color: 'var(--text)' }
            } : undefined,
            tooltip: { trigger: 'axis' },
            legend: config.show_legend !== false ? {
                bottom: 0,
                textStyle: { fontSize: 10, color: 'var(--text-secondary)' }
            } : undefined,
            grid: {
                left: '3%', right: '4%',
                top: config.title ? 40 : 16,
                bottom: config.show_legend !== false ? 32 : 8,
                containLabel: true
            },
            xAxis: horiz ? { type: 'value' } : {
                type: 'category', data: cats,
                axisLabel: { color: 'var(--text-secondary)', fontSize: 10 }
            },
            yAxis: horiz ? {
                type: 'category', data: cats,
                axisLabel: { color: 'var(--text-secondary)', fontSize: 10 }
            } : { type: 'value' },
            series: series.map(function(s) {
                return {
                    name: s.name,
                    type: 'bar',
                    data: s.data,
                    stack: stacked ? 'total' : undefined,
                    itemStyle: { borderRadius: [4, 4, 0, 0] },
                    barWidth: series.length > 1 ? '40%' : '60%'
                };
            })
        };

        myChart.setOption(option);
    }

    if (config.data_source && window.fetchWithAuth) {
        fetchWithAuth(config.data_source)
            .then(function(r) { return r.json(); })
            .then(drawChart)
            .catch(function() { drawChart({}); });
    } else {
        drawChart({});
    }

    // Resize observer
    var ro = new ResizeObserver(function() { myChart.resize(); });
    ro.observe(chartDom);
}

/* 饼图/环形图 — 原子组件，依赖 ECharts */
/* config: { title, data_source, data, donut, rose, show_label, show_legend } */
function renderPieChart(config, containerId) {
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
        var pieData = data.data || config.data || [];
        var donut = config.donut !== false;
        var rose = config.rose || false;

        var option = {
            title: config.title ? {
                text: config.title,
                left: 'left',
                top: 8,
                textStyle: { fontSize: 14, fontWeight: 500, color: 'var(--text)' }
            } : undefined,
            tooltip: { trigger: 'item' },
            legend: config.show_legend !== false ? {
                bottom: 0,
                textStyle: { fontSize: 10, color: 'var(--text-secondary)' }
            } : undefined,
            series: [{
                type: 'pie',
                radius: donut ? ['40%', '70%'] : '70%',
                center: ['50%', '50%'],
                roseType: rose ? 'radius' : undefined,
                itemStyle: { borderRadius: 4, borderColor: 'var(--bg)', borderWidth: 2 },
                label: {
                    show: config.show_label !== false,
                    fontSize: 10,
                    color: 'var(--text-secondary)'
                },
                emphasis: {
                    label: { fontSize: 14, fontWeight: 'bold' },
                    scaleSize: 8
                },
                data: pieData
            }]
        };

        // Adjust grid for title/legend
        if (option.title) option.series[0].center = ['50%', '52%'];
        if (option.legend) option.series[0].radius = donut ? ['35%', '62%'] : '62%';

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

    var ro = new ResizeObserver(function() { myChart.resize(); });
    ro.observe(chartDom);
}

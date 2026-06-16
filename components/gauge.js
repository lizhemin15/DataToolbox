/* 仪表盘 — 原子组件，依赖 ECharts */
/* config: { title, value, min, max, unit, segments, colors } */
function renderGauge(config, containerId) {
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

    var value = config.value || 0;
    var min = config.min || 0;
    var max = config.max || 100;
    var unit = config.unit || '%';
    var segments = config.segments || 3;
    var colors = config.colors || ['var(--success)', 'var(--warning)', 'var(--danger)'];

    var option = {
        title: config.title ? {
            text: config.title,
            left: 'center',
            bottom: 0,
            textStyle: { fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }
        } : undefined,
        series: [{
            type: 'gauge',
            startAngle: 210,
            endAngle: -30,
            min: min,
            max: max,
            center: ['50%', '55%'],
            radius: '85%',
            splitNumber: segments * 2,
            axisLine: {
                show: true,
                lineStyle: {
                    width: 12,
                    color: (function() {
                        var steps = [];
                        var step = (max - min) / segments;
                        for (var i = 0; i < segments; i++) {
                            steps.push([(i + 1) / segments, colors[i] || colors[i % colors.length]]);
                        }
                        return steps;
                    })()
                }
            },
            pointer: {
                icon: 'path://M12.8,0.7l12,40.1H0.7L12.8,0.7z',
                length: '70%',
                width: 6,
                itemStyle: { color: 'var(--text)' }
            },
            axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: { show: false },
            detail: {
                valueAnimation: true,
                formatter: '{value}' + unit,
                fontSize: 20,
                fontWeight: 600,
                color: 'var(--text)',
                offsetCenter: [0, '60%']
            },
            data: [{ value: value }]
        }]
    };

    myChart.setOption(option);

    var ro = new ResizeObserver(function() { myChart.resize(); });
    ro.observe(chartDom);
}

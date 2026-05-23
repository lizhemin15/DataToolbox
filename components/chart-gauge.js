/* 依赖: ECharts (必须本地化到 /lib/echarts.min.js) */

(function() {
    var container = document.getElementById('__CONTAINER_ID__');
    if (!container) return;

    var config = __CONFIG__;
    var title = config.title || '完成率';
    var value = Number(config.value) || 0;
    var min = Number(config.min) || 0;
    var max = Number(config.max) || 100;
    var unit = config.unit || '%';
    var color = config.color || '#4F46E5';
    var thresholds = config.thresholds || [
        {value: 30, color: '#ef4444'},
        {value: 70, color: '#f59e0b'},
        {value: 100, color: '#22c55e'}
    ];
    var apiUrl = config.api_url || '';

    var chartDom = document.createElement('div');
    chartDom.style.width = '100%';
    chartDom.style.height = '280px';
    container.appendChild(chartDom);

    function render(val) {
        if (typeof echarts === 'undefined') {
            container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">ECharts 未加载，请确保 /lib/echarts.min.js 存在</div>';
            return;
        }
        var chart = echarts.init(chartDom);
        var option = {
            series: [{
                type: 'gauge',
                startAngle: 220,
                endAngle: -40,
                min: min,
                max: max,
                progress: { show: true, width: 14 },
                axisLine: {
                    lineStyle: {
                        width: 14,
                        color: thresholds.map(function(t) {
                            return [t.value / max, t.color];
                        })
                    }
                },
                axisTick: { show: false },
                splitLine: { length: 8, lineStyle: { width: 2, color: '#999' } },
                axisLabel: { distance: 20, color: '#666', fontSize: 11 },
                pointer: {
                    itemStyle: { color: color }
                },
                anchor: {
                    show: true,
                    size: 10,
                    itemStyle: { color: color }
                },
                title: { offsetCenter: [0, '70%'], fontSize: 14, color: '#666' },
                detail: {
                    valueAnimation: true,
                    fontSize: 28,
                    fontWeight: 'bold',
                    offsetCenter: [0, '45%'],
                    formatter: '{value}' + unit,
                    color: color
                },
                data: [{ value: val, name: title }]
            }]
        };
        chart.setOption(option);
        window.addEventListener('resize', function() { chart.resize(); });
    }

    // 如果有 API，先获取数据
    if (apiUrl) {
        var token = localStorage.getItem('dataOntologyToken') || '';
        fetch(apiUrl, { headers: { 'Authorization': 'Bearer ' + token } })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var v = data.value !== undefined ? data.value : (data.data && data.data.value !== undefined ? data.data.value : value);
                render(Number(v) || value);
            })
            .catch(function() { render(value); });
    } else {
        render(value);
    }
})();

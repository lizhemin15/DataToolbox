/* 依赖: ECharts (必须本地化到 /lib/echarts.min.js) */

(function() {
    var container = document.getElementById('__CONTAINER_ID__');
    if (!container) return;

    var config = __CONFIG__;
    var title = config.title || '业务趋势';
    var xField = config.x_field || 'month';
    var yFields = config.y_fields || [
        {name: '收入', color: '#4F46E5'},
        {name: '成本', color: '#ef4444'}
    ];
    var smooth = config.smooth !== false;
    var areaOpacity = Number(config.area_opacity);
    if (isNaN(areaOpacity)) areaOpacity = 0.15;
    var stackMode = config.stack_mode || 'none';
    var color = config.primary_color || '#4F46E5';
    var apiUrl = config.api_url || '';

    // 示例数据
    var sampleData = [
        {month: '1月', 收入: 82, 成本: 55},
        {month: '2月', 收入: 93, 成本: 60},
        {month: '3月', 收入: 90, 成本: 58},
        {month: '4月', 收入: 110, 成本: 65},
        {month: '5月', 收入: 125, 成本: 70},
        {month: '6月', 收入: 140, 成本: 72}
    ];

    var chartDom = document.createElement('div');
    chartDom.style.width = '100%';
    chartDom.style.height = '300px';
    container.appendChild(chartDom);

    function render(data) {
        if (typeof echarts === 'undefined') {
            container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">ECharts 未加载，请确保 /lib/echarts.min.js 存在</div>';
            return;
        }
        var chart = echarts.init(chartDom);

        var xData = data.map(function(d) { return d[xField]; });
        var stack = stackMode === 'none' ? null : 'total';
        var isPercent = stackMode === 'percent';

        var series = yFields.map(function(yf, idx) {
            var s = {
                name: yf.name,
                type: 'line',
                smooth: smooth,
                symbol: 'circle',
                symbolSize: 6,
                lineStyle: { width: 2, color: yf.color || color },
                itemStyle: { color: yf.color || color },
                areaStyle: { opacity: areaOpacity, color: yf.color || color },
                data: data.map(function(d) { return d[yf.name]; })
            };
            if (stack) s.stack = stack;
            if (isPercent) {
                s.areaStyle = { opacity: areaOpacity };
                s.label = { show: false };
            }
            return s;
        });

        var option = {
            title: { text: title, left: 'center', textStyle: { fontSize: 14, fontWeight: 600 } },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross', label: { backgroundColor: '#6a7985' } }
            },
            legend: {
                data: yFields.map(function(yf) { return yf.name; }),
                bottom: 0,
                textStyle: { fontSize: 12 }
            },
            grid: { left: '3%', right: '4%', bottom: '15%', top: '15%', containLabel: true },
            xAxis: { type: 'category', boundaryGap: false, data: xData, axisLabel: { fontSize: 11 } },
            yAxis: {
                type: isPercent ? 'value' : 'value',
                max: isPercent ? 100 : undefined,
                axisLabel: { fontSize: 11, formatter: isPercent ? '{value}%' : undefined }
            },
            series: series
        };
        chart.setOption(option);
        window.addEventListener('resize', function() { chart.resize(); });
    }

    if (apiUrl) {
        var token = localStorage.getItem('dataOntologyToken') || '';
        fetch(apiUrl, { headers: { 'Authorization': 'Bearer ' + token } })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var d = Array.isArray(data) ? data : (data.data && Array.isArray(data.data) ? data.data : sampleData);
                render(d);
            })
            .catch(function() { render(sampleData); });
    } else {
        render(sampleData);
    }
})();

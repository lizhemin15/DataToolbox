/* ECharts 仪表盘模板 */
/* config: { title, data_source, value_field, value, min, max, unit, name, colors, height, split_number } */
function renderChartGauge(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (typeof echarts === 'undefined') {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">ECharts 未加载</div>';
        return;
    }

    const chart = echarts.init(container);
    const min = config.min || 0;
    const max = config.max || 100;
    const splitNumber = config.split_number || 10;

    // 直接数据模式: config.value
    if (config.value !== undefined && config.value !== null) {
        chart.setOption(buildGaugeOption(config, min, max, splitNumber));
        window.addEventListener('resize', () => chart.resize());
        return chart;
    }

    // API 模式
    if (config.data_source) {
        container.innerHTML = '<div style="padding:20px;color:#999;">加载中...</div>';
        fetchWithAuth(config.data_source)
            .then(r => r.json())
            .then(data => {
                const rows = data.rows || data.data || [];
                if (rows.length > 0) {
                    const valField = config.value_field || 'value';
                    const val = parseFloat(rows[0][valField]);
                    if (!isNaN(val)) {
                        config.value = val;
                        config.name = config.name || rows[0].name || '';
                        chart.setOption(buildGaugeOption(config, min, max, splitNumber));
                        return;
                    }
                }
                container.innerHTML = '<div style="padding:20px;color:#999;">无有效数据</div>';
            })
            .catch(err => {
                container.innerHTML = '<div style="padding:20px;color:#EF4444;">数据加载失败: ' + err.message + '</div>';
            });
        window.addEventListener('resize', () => chart.resize());
        return chart;
    }

    // 演示数据回退
    const demoConfig = {
        title: config.title || '系统健康度',
        value: 78.5,
        name: '健康度',
        unit: '%'
    };
    chart.setOption(buildGaugeOption(demoConfig, min, max, splitNumber));
    window.addEventListener('resize', () => chart.resize());
    return chart;
}

function buildGaugeOption(config, min, max, splitNumber) {
    return {
        title: { text: config.title || '', left: 'center', textStyle: { fontSize: 16, fontWeight: 600 } },
        series: [{
            type: 'gauge',
            min: min,
            max: max,
            splitNumber: splitNumber,
            progress: { show: true, width: 14 },
            axisLine: { lineStyle: { width: 14 } },
            axisTick: { show: true },
            splitLine: { length: 10, lineStyle: { width: 2, color: '#999' } },
            axisLabel: { distance: 20, color: '#999', fontSize: 11 },
            pointer: { itemStyle: { color: 'auto' } },
            anchor: { show: true, showAbove: true, size: 14, itemStyle: { borderWidth: 6 } },
            detail: {
                valueAnimation: true,
                fontSize: 26,
                offsetCenter: [0, '70%'],
                formatter: '{value}' + (config.unit || '')
            },
            title: {
                offsetCenter: [0, '90%'],
                fontSize: 14,
                color: '#666'
            },
            data: [{ value: config.value, name: config.name || '' }]
        }]
    };
}
/* ECharts 区域着色地图模板 */
/* config: { title, data_source, region_field, value_field, map_level, color_range, show_legend, height } */
function renderMapChoropleth(config, containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    if (typeof echarts === 'undefined') {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">ECharts 未加载</div>';
        return;
    }

    var colorSchemes = {
        blue: ['#e0f3ff', '#a8d8ff', '#6bb8ff', '#3d96ff', '#0d6efd', '#0a58ca'],
        green: ['#e6f7e6', '#a8e6a8', '#6bcf6b', '#3db83d', '#1a9e1a', '#0d7a0d'],
        red: ['#ffe6e6', '#ffb3b3', '#ff8080', '#ff4d4d', '#e60000', '#b30000'],
        purple: ['#f0e6ff', '#cda8ff', '#aa6bff', '#8833ff', '#6600cc', '#4d0099']
    };
    var inRange = colorSchemes[config.color_range || 'blue'] || colorSchemes['blue'];

    function buildOption(data) {
        return {
            title: { text: config.title || '区域分布', left: 'center', textStyle: { fontSize: 16, color: '#1a202c' } },
            tooltip: {
                trigger: 'item',
                formatter: function(p) {
                    return p.name + ': ' + (p.value !== undefined && p.value !== null ? p.value : '暂无数据');
                }
            },
            visualMap: {
                min: 0, max: 1000, left: 'left', top: 'bottom',
                text: ['高', '低'], calculable: true,
                inRange: { color: inRange },
                show: config.show_legend !== false
            },
            series: [{
                type: 'map', map: 'china',
                roam: true,
                label: { show: true, fontSize: 10, color: '#333' },
                emphasis: {
                    label: { show: true, fontSize: 12, fontWeight: 'bold' },
                    itemStyle: { areaColor: '#ffd700' }
                },
                data: data
            }]
        };
    }

    // Demo data
    var demoData = [
        {name: '北京', value: 890}, {name: '上海', value: 1200}, {name: '广东', value: 980},
        {name: '浙江', value: 760}, {name: '江苏', value: 850}, {name: '四川', value: 420},
        {name: '湖北', value: 380}, {name: '山东', value: 560}, {name: '河南', value: 340},
        {name: '福建', value: 450}
    ];

    // Try to load china map geo JSON
    var mapLoaded = false;
    try {
        if (echarts.getMap('china')) {
            mapLoaded = true;
        }
    } catch(e) {}

    if (!mapLoaded) {
        // Try loading from local
        var baseUrl = '';
        try { baseUrl = window._appBaseURL || ''; } catch(e) {}
        fetch(baseUrl + '/assets/china.json')
            .then(function(r) { return r.json(); })
            .then(function(geo) {
                echarts.registerMap('china', geo);
                renderMap();
            })
            .catch(function() {
                // Fallback: show scatter on map
                container.innerHTML = '<div style="padding:20px;text-align:center;color:#999;">地图数据未加载，使用散点模式</div>';
                renderScatterFallback();
            });
    } else {
        renderMap();
    }

    function renderMap() {
        var chart = echarts.init(container);
        if (config.data_source) {
            container.innerHTML = '<div style="padding:20px;color:#999;">加载中...</div>';
            fetchWithAuth(config.data_source)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var rows = data.rows || data.data || [];
                    var dbCols = data.columns || [];
                    if (rows.length === 0) { chart.setOption(buildOption(demoData)); return; }

                    var colNames = dbCols.map(function(c) { return typeof c === 'string' ? c : c.name; });
                    var rIdx = colNames.indexOf(config.region_field || colNames[0]);
                    var vIdx = colNames.indexOf(config.value_field || colNames[1]);

                    var mapData = rows.map(function(r) {
                        return { name: r[rIdx !== -1 ? rIdx : 0], value: r[vIdx !== -1 ? vIdx : 1] };
                    });
                    chart.setOption(buildOption(mapData));
                })
                .catch(function() {
                    chart.setOption(buildOption(demoData));
                });
        } else {
            chart.setOption(buildOption(demoData));
        }
        window.addEventListener('resize', function() { chart.resize(); });
    }

    function renderScatterFallback() {
        // Use existing map-scatter as fallback
        if (typeof renderMapScatter === 'function') {
            renderMapScatter(Object.assign({}, config, {data_source: config.data_source}), containerId);
        }
    }
}

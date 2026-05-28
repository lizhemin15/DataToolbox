/* config: { title, data_source, lat_field, lng_field, name_field, popup_fields, markers, center_lat, center_lng, zoom, marker_color, heatmap, height } */
/* 依赖: ECharts (必须本地化到 /lib/echarts.min.js) */
function renderMapScatter(config, containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    if (typeof echarts === 'undefined') {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">ECharts 未加载，请确保 /lib/echarts.min.js 存在</div>';
        return;
    }

    var markerColor = config.marker_color || '#4F46E5';

    // 注册中国地图 GeoJSON 后渲染
    function ensureMapThenRender(renderFn) {
        if (echarts.getMap('china')) {
            renderFn();
            return;
        }
        var baseUrl = '';
        try { baseUrl = window._appBaseURL || ''; } catch(e) {}
        fetch(baseUrl + '/assets/china.json')
            .then(function(r) { return r.json(); })
            .then(function(geo) {
                echarts.registerMap('china', geo);
                renderFn();
            })
            .catch(function(err) {
                container.innerHTML = '<div style="padding:20px;color:#EF4444;">地图数据加载失败: ' + err.message + '</div>';
            });
    }

    // 经纬度 → 散点数据
    function rowsToScatter(rows, latField, lngField, nameField, popupFields) {
        var result = [];
        rows.forEach(function(r) {
            var lat = parseFloat(r[latField || 'lat']);
            var lng = parseFloat(r[lngField || 'lng']);
            if (isNaN(lat) || isNaN(lng)) return;
            var name = r[nameField || 'name'] || '';
            var popup = [];
            (popupFields || []).forEach(function(f) {
                if (r[f] !== undefined) popup.push(f + ': ' + r[f]);
            });
            result.push({
                name: name,
                value: [lng, lat],
                _popup: popup.join('<br>')
            });
        });
        return result;
    }

    function buildChart(scatterData) {
        var chart = echarts.init(container);
        var option = {
            tooltip: {
                trigger: 'item',
                formatter: function(p) {
                    if (p.data && p.data._popup) {
                        var html = p.name ? '<strong>' + p.name + '</strong><br>' : '';
                        html += p.data._popup;
                        return html || (p.name || '');
                    }
                    return p.name || '';
                }
            },
            geo: {
                map: 'china',
                roam: true,
                zoom: config.zoom || 1.2,
                center: [config.center_lng || 104.19, config.center_lat || 35.86],
                label: { show: false },
                itemStyle: {
                    areaColor: '#f3f4f6',
                    borderColor: '#d1d5db',
                    borderWidth: 0.8
                },
                emphasis: {
                    itemStyle: { areaColor: '#e5e7eb' },
                    label: { show: true, fontSize: 10, color: '#374151' }
                }
            },
            series: [{
                type: 'scatter',
                coordinateSystem: 'geo',
                data: scatterData,
                symbolSize: function(val, params) {
                    return 10;
                },
                itemStyle: {
                    color: markerColor,
                    borderColor: '#fff',
                    borderWidth: 2
                },
                emphasis: {
                    itemStyle: {
                        shadowBlur: 10,
                        shadowColor: 'rgba(0,0,0,0.3)'
                    }
                },
                zlevel: 10
            }]
        };

        // 如果配置了热力图效果，用 effectScatter
        if (config.heatmap) {
            option.series.push({
                type: 'effectScatter',
                coordinateSystem: 'geo',
                data: scatterData.slice(0, 20),
                symbolSize: 8,
                showEffectOn: 'render',
                rippleEffect: { brushType: 'stroke', scale: 3, period: 4 },
                itemStyle: { color: markerColor, shadowBlur: 10, shadowColor: markerColor },
                zlevel: 11
            });
        }

        chart.setOption(option);
        window.addEventListener('resize', function() { chart.resize(); });
        return chart;
    }

    // 直接数据模式: config.markers = [{lat, lng, name, ...}]
    if (config.markers && config.markers.length > 0) {
        ensureMapThenRender(function() {
            buildChart(rowsToScatter(config.markers, 'lat', 'lng', 'name', config.popup_fields));
        });
        return;
    }

    // API 模式
    if (config.data_source) {
        ensureMapThenRender(function() {
            fetchWithAuth(config.data_source)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var rows = data.rows || data.data || [];
                    buildChart(rowsToScatter(rows, config.lat_field, config.lng_field, config.name_field, config.popup_fields));
                })
                .catch(function(err) {
                    container.innerHTML = '<div style="padding:20px;color:#EF4444;">数据加载失败: ' + err.message + '</div>';
                });
        });
        return;
    }

    // 演示数据回退
    var demoMarkers = [
        { lat: 39.9, lng: 116.4, name: '北京', population: '2189万' },
        { lat: 31.2, lng: 121.5, name: '上海', population: '2487万' },
        { lat: 23.1, lng: 113.3, name: '广州', population: '1868万' },
        { lat: 22.5, lng: 114.1, name: '深圳', population: '1756万' },
        { lat: 30.6, lng: 104.1, name: '成都', population: '2094万' }
    ];
    ensureMapThenRender(function() {
        buildChart(rowsToScatter(demoMarkers, 'lat', 'lng', 'name', ['population']));
    });
}

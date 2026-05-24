/* config: { title, data_source, lat_field, lng_field, name_field, popup_fields, markers, center_lat, center_lng, zoom, marker_color, heatmap, height } */
/* 依赖: Leaflet (必须本地化到 /lib/leaflet.min.js) */
function renderMapScatter(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (typeof L === 'undefined') {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">Leaflet 未加载，请确保 /lib/leaflet.min.js 存在</div>';
        return;
    }

    const map = L.map(containerId, {
        center: [config.center_lat || 35.86, config.center_lng || 104.19],
        zoom: config.zoom || 4
    });

    // 离线瓦片（唯一底图，不回退 OSM — 云服务器 IP 被 OSM 封禁 403）
    var _base = (window._appBaseURL && window._appBaseURL !== 'null') ? window._appBaseURL : (window.location.origin && window.location.origin !== 'null' ? window.location.origin : '');
    L.tileLayer(_base + '/lib/leaflet-images/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 5,
        maxNativeZoom: 5
    }).addTo(map);

    // zoom > 5 时用纯色 Canvas 瓦片替代（无离线瓦片，也不请求 OSM）
    L.tileLayer.canvas = undefined; // safety
    var CanvasTile = L.TileLayer.extend({
        createTile: function(coords) {
            var tile = document.createElement('canvas');
            tile.width = 256; tile.height = 256;
            var ctx = tile.getContext('2d');
            ctx.fillStyle = '#e8e8e8';
            ctx.fillRect(0, 0, 256, 256);
            ctx.strokeStyle = '#d0d0d0';
            ctx.strokeRect(0, 0, 256, 256);
            ctx.fillStyle = '#bbb';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('z' + coords.z, 128, 128);
            return tile;
        }
    });
    var canvasLayer = new CanvasTile('', { minZoom: 6, maxZoom: 18 });
    map.on('zoomend', function() {
        if (map.getZoom() > 5 && !map._canvasAdded) {
            map._canvasAdded = true;
            canvasLayer.addTo(map);
        } else if (map.getZoom() <= 5 && map._canvasAdded) {
            map._canvasAdded = false;
            map.removeLayer(canvasLayer);
        }
    });

    const markerColor = config.marker_color || '#4F46E5';

    function addMarkers(rows, latField, lngField, nameField, popupFields) {
        const markers = [];
        rows.forEach(r => {
            const lat = parseFloat(r[latField || 'lat']);
            const lng = parseFloat(r[lngField || 'lng']);
            if (isNaN(lat) || isNaN(lng)) return;

            const icon = L.divIcon({
                className: '',
                html: '<div style="width:12px;height:12px;background:' + markerColor + ';border:2px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>',
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            });

            const marker = L.marker([lat, lng], { icon: icon }).addTo(map);
            const name = r[nameField || 'name'] || '';
            const pFields = popupFields || [];
            if (name || pFields.length > 0) {
                let popupHtml = name ? '<strong>' + name + '</strong>' : '';
                pFields.forEach(f => {
                    if (r[f] !== undefined) popupHtml += '<br><span style="color:#666">' + f + ':</span> ' + r[f];
                });
                marker.bindPopup(popupHtml);
            }
            markers.push(marker);
        });

        if (markers.length > 0) {
            const group = L.featureGroup(markers);
            map.fitBounds(group.getBounds().pad(0.1));
        }
    }

    // 直接数据模式: config.markers = [{lat, lng, name, ...}]
    if (config.markers && config.markers.length > 0) {
        addMarkers(config.markers, 'lat', 'lng', 'name', config.popup_fields);
        return;
    }

    // API 模式
    if (config.data_source) {
        fetchWithAuth(config.data_source)
            .then(r => r.json())
            .then(data => {
                const rows = data.rows || data.data || [];
                addMarkers(rows, config.lat_field, config.lng_field, config.name_field, config.popup_fields);
            })
            .catch(err => {
                container.innerHTML = '<div style="padding:20px;color:#EF4444;">数据加载失败: ' + err.message + '</div>';
            });
        return;
    }

    // 演示数据回退
    const demoMarkers = [
        { lat: 39.9, lng: 116.4, name: '北京', population: '2189万' },
        { lat: 31.2, lng: 121.5, name: '上海', population: '2487万' },
        { lat: 23.1, lng: 113.3, name: '广州', population: '1868万' },
        { lat: 22.5, lng: 114.1, name: '深圳', population: '1756万' },
        { lat: 30.6, lng: 104.1, name: '成都', population: '2094万' }
    ];
    addMarkers(demoMarkers, 'lat', 'lng', 'name', ['population']);
}
/* config: { title, data_source, lat_field, lng_field, name_field, popup_fields, center_lat, center_lng, zoom, marker_color, heatmap, height } */
/* 依赖: Leaflet (必须本地化到 /js/lib/leaflet/) */
function renderMapScatter(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (typeof L === 'undefined') {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">Leaflet 未加载，请确保 /js/lib/leaflet/ 目录存在</div>';
        return;
    }

    // 初始化地图
    const map = L.map(containerId, {
        center: [config.center_lat || 35.86, config.center_lng || 104.19],
        zoom: config.zoom || 4
    });

    // 使用 OpenStreetMap 瓦片（离线可替换）
    L.tileLayer('/js/lib/leaflet/tiles/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 18
    }).addTo(map);

    // 如果离线瓦片不存在，尝试在线瓦片
    map.on('tileerror', function() {
        if (!map._onlineFallback) {
            map._onlineFallback = true;
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 18
            }).addTo(map);
        }
    });

    // 加载标注数据
    fetchWithAuth(config.data_source)
        .then(r => r.json())
        .then(data => {
            const rows = data.rows || data.data || [];
            const markers = [];
            const markerColor = config.marker_color || '#4F46E5';

            rows.forEach(r => {
                const lat = parseFloat(r[config.lat_field || 'lat']);
                const lng = parseFloat(r[config.lng_field || 'lng']);
                if (isNaN(lat) || isNaN(lng)) return;

                const icon = L.divIcon({
                    className: '',
                    html: `<div style="width:12px;height:12px;background:${markerColor};border:2px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
                    iconSize: [12, 12],
                    iconAnchor: [6, 6]
                });

                const marker = L.marker([lat, lng], { icon }).addTo(map);

                // 弹窗
                const name = r[config.name_field || 'name'] || '';
                const popupFields = config.popup_fields || [];
                if (name || popupFields.length > 0) {
                    let popupHtml = name ? `<strong>${name}</strong>` : '';
                    popupFields.forEach(f => {
                        if (r[f] !== undefined) popupHtml += `<br><span style="color:#666">${f}:</span> ${r[f]}`;
                    });
                    marker.bindPopup(popupHtml);
                }

                markers.push(marker);
            });

            // 自动适配边界
            if (markers.length > 0) {
                const group = L.featureGroup(markers);
                map.fitBounds(group.getBounds().pad(0.1));
            }
        })
        .catch(err => {
            container.innerHTML = '<div style="padding:20px;color:#EF4444;">数据加载失败: ' + err.message + '</div>';
        });
}
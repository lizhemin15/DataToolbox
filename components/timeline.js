/* 时间线/项目进度模板 */
/* config: { title, layout, primary_color, show_date, events, api_url } */
/* 支持两种模式: events[](直接数据) 或 api_url(API) */
function renderTimeline(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const title = config.title || '项目进度';
    const layout = config.layout || 'vertical';
    const color = config.primary_color || '#4F46E5';
    const showDate = config.show_date !== false;

    // 默认演示数据
    const demoEvents = [
        { date: '2024-01', title: '项目启动', desc: '完成需求分析与技术选型', status: 'done' },
        { date: '2024-03', title: '开发阶段', desc: '核心功能开发与单元测试', status: 'done' },
        { date: '2024-06', title: '测试阶段', desc: '集成测试与用户验收', status: 'active' },
        { date: '2024-09', title: '正式上线', desc: '部署上线与运维监控', status: 'pending' }
    ];

    const events = (config.events && config.events.length > 0) ? config.events : null;
    const apiUrl = config.api_url || '';

    function render(evts) {
        const statusColors = { done: '#22c55e', active: color, pending: '#9ca3af' };
        const statusLabels = { done: '已完成', active: '进行中', pending: '待开始' };

        let html = '<div style="font-family:-apple-system,sans-serif;padding:16px;">';
        html += '<h3 style="margin:0 0 20px;font-size:16px;color:var(--text);">' + title + '</h3>';

        if (layout === 'horizontal') {
            html += '<div style="display:flex;overflow-x:auto;padding-bottom:12px;">';
            evts.forEach(function(evt, i) {
                var sc = statusColors[evt.status] || '#9ca3af';
                html += '<div style="flex:0 0 160px;text-align:center;position:relative;padding:0 8px;">';
                if (i > 0) {
                    html += '<div style="position:absolute;top:10px;left:-40px;width:40px;height:2px;background:' + (evt.status === 'done' || evt.status === 'active' ? color : '#e5e7eb') + ';"></div>';
                }
                html += '<div style="width:20px;height:20px;border-radius:50%;background:' + sc + ';margin:0 auto 8px;border:3px solid #fff;box-shadow:0 0 0 2px ' + sc + ';"></div>';
                if (showDate && evt.date) {
                    html += '<div style="font-size:11px;color:#999;margin-bottom:4px;">' + evt.date + '</div>';
                }
                html += '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px;">' + evt.title + '</div>';
                if (evt.desc) {
                    html += '<div style="font-size:11px;color:var(--text-secondary);line-height:1.4;">' + evt.desc + '</div>';
                }
                html += '<span style="display:inline-block;margin-top:4px;font-size:10px;padding:1px 6px;border-radius:8px;background:' + sc + '22;color:' + sc + ';">' + (statusLabels[evt.status] || '') + '</span>';
                html += '</div>';
            });
            html += '</div>';
        } else {
            html += '<div style="position:relative;padding-left:24px;">';
            html += '<div style="position:absolute;left:9px;top:0;bottom:0;width:2px;background:#e5e7eb;"></div>';
            evts.forEach(function(evt, i) {
                var sc = statusColors[evt.status] || '#9ca3af';
                html += '<div style="position:relative;padding:0 0 24px 20px;">';
                html += '<div style="position:absolute;left:-24px;top:2px;width:16px;height:16px;border-radius:50%;background:' + sc + ';border:3px solid #fff;box-shadow:0 0 0 2px ' + sc + ';z-index:1;"></div>';
                if (showDate && evt.date) {
                    html += '<div style="font-size:11px;color:#999;margin-bottom:2px;">' + evt.date + '</div>';
                }
                html += '<div style="font-size:14px;font-weight:600;color:var(--text);">' + evt.title + ' <span style="font-size:10px;padding:1px 6px;border-radius:8px;background:' + sc + '22;color:' + sc + ';">' + (statusLabels[evt.status] || '') + '</span></div>';
                if (evt.desc) {
                    html += '<div style="font-size:12px;color:var(--text-secondary);margin-top:2px;line-height:1.4;">' + evt.desc + '</div>';
                }
                html += '</div>';
            });
            html += '</div>';
        }

        html += '</div>';
        container.innerHTML = html;
    }

    // 如果有 API，先获取数据
    if (apiUrl) {
        fetchWithAuth(apiUrl)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var evts = data.events || (data.data && data.data.events) || demoEvents;
                render(evts);
            })
            .catch(function() { render(events || demoEvents); });
    } else if (events) {
        render(events);
    } else {
        render(demoEvents);
    }
}
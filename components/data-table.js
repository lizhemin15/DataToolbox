/* 数据表格模板 */
/* config: { title, data_source, columns, rows, page_size, show_search, height } */
/* columns 支持两种格式: ["name", "age"] 或 [{field:"name", label:"姓名"}] */
function renderDataTable(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const pageSize = parseInt(config.page_size) || 10;
    const showSearch = config.show_search !== false;

    // 统一 normalize columns：提取 {key, label}
    function normalizeColumns(cols) {
        if (!cols || cols.length === 0) return [];
        return cols.map(c => {
            if (typeof c === 'string') return { key: c, label: c };
            if (c && typeof c === 'object') return { key: c.field || c.key || c.name || '', label: c.label || c.title || c.field || c.key || c.name || '' };
            return { key: String(c), label: String(c) };
        });
    }

    let html = '';
    if (config.title) {
        html += '<div style="font-size:16px;font-weight:600;margin-bottom:12px;color:var(--text)">' + config.title + '</div>';
    }
    if (showSearch) {
        html += '<div style="margin-bottom:8px"><input type="text" placeholder="搜索..." oninput="dtFilter(this.value,\'' + containerId + '\')" style="padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius);width:240px;font-size:13px"></div>';
    }

    // 直接数据模式
    if (config.rows && config.rows.length > 0) {
        const rawCols = config.columns || Object.keys(config.rows[0]);
        const normCols = normalizeColumns(rawCols);
        html += buildTableHTML(normCols, config.rows, containerId, pageSize);
        container.innerHTML = html;
        return;
    }

    // API 模式
    if (config.data_source) {
        container.innerHTML = html + '<div style="padding:20px;color:#999;">加载中...</div>';
        fetchWithAuth(config.data_source)
            .then(r => r.json())
            .then(data => {
                const rows = data.rows || data.data || [];
                const rawCols = config.columns || (data.columns ? data.columns : (rows.length > 0 ? Object.keys(rows[0]) : []));
                const normCols = normalizeColumns(rawCols);
                // 如果 columns 是 [{field,label}] 且 rows 用 field 做 key，数据映射正确
                // 如果 columns 是 [string] 且 rows 用 string 做 key，也正确
                container.innerHTML = html + buildTableHTML(normCols, rows, containerId, pageSize);
            })
            .catch(err => {
                container.innerHTML = html + '<div style="padding:20px;color:#EF4444;">数据加载失败: ' + err.message + '</div>';
            });
        return;
    }

    // 演示数据回退
    const demoCols = [
        { key: '姓名', label: '姓名' },
        { key: '邮箱', label: '邮箱' },
        { key: '城市', label: '城市' },
        { key: '订单数', label: '订单数' },
        { key: '金额', label: '金额(元)' }
    ];
    const demoRows = [
        { '姓名': '张伟', '邮箱': 'zhangwei@example.com', '城市': '北京', '订单数': 23, '金额': 12800 },
        { '姓名': '李娜', '邮箱': 'lina@example.com', '城市': '上海', '订单数': 18, '金额': 9650 },
        { '姓名': '王磊', '邮箱': 'wanglei@example.com', '城市': '广州', '订单数': 31, '金额': 18320 },
        { '姓名': '赵敏', '邮箱': 'zhaomin@example.com', '城市': '深圳', '订单数': 15, '金额': 7430 },
        { '姓名': '陈浩', '邮箱': 'chenhao@example.com', '城市': '成都', '订单数': 27, '金额': 15100 }
    ];
    html += buildTableHTML(demoCols, demoRows, containerId, pageSize);
    container.innerHTML = html;
}

function buildTableHTML(normCols, rows, containerId, pageSize) {
    let html = '<div style="overflow-x:auto"><table id="dt_' + containerId + '" style="width:100%;border-collapse:collapse;font-size:13px">';
    html += '<thead><tr>';
    for (const col of normCols) {
        html += '<th style="padding:10px 12px;text-align:left;background:var(--bg-secondary);border-bottom:2px solid var(--border);color:var(--text-secondary);font-weight:600">' + col.label + '</th>';
    }
    html += '</tr></thead><tbody>';
    const displayRows = rows.slice(0, pageSize);
    for (const row of displayRows) {
        html += '<tr style="border-bottom:1px solid var(--border)">';
        for (const col of normCols) {
            const val = row[col.key] !== undefined ? row[col.key] : (row[col.label] !== undefined ? row[col.label] : '');
            const display = typeof val === 'object' ? JSON.stringify(val) : val;
            html += '<td style="padding:10px 12px;color:var(--text)">' + display + '</td>';
        }
        html += '</tr>';
    }
    html += '</tbody></table></div>';
    if (rows.length > pageSize) {
        html += '<div style="margin-top:8px;font-size:12px;color:var(--text-secondary)">显示 ' + pageSize + ' / ' + rows.length + ' 条</div>';
    }
    return html;
}

function dtFilter(keyword, containerId) {
    const table = document.getElementById('dt_' + containerId);
    if (!table) return;
    const rows = table.querySelectorAll('tbody tr');
    keyword = keyword.toLowerCase();
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(keyword) ? '' : 'none';
    });
}
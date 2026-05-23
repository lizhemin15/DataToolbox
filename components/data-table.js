/* config: { title, data_source, columns[], page_size, show_search, show_export, stripe } */
/* columns: [{ field, label, width, align, sortable, render }] */
function renderDataTable(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const columns = config.columns || [];
    const pageSize = config.page_size || 20;
    let allRows = [];
    let filteredRows = [];
    let currentPage = 1;
    let sortField = null;
    let sortDir = 'asc';

    function renderTable() {
        const start = (currentPage - 1) * pageSize;
        const pageRows = filteredRows.slice(start, start + pageSize);
        const totalPages = Math.ceil(filteredRows.length / pageSize);

        container.innerHTML = `
        ${config.title ? `<h3 style="margin:0 0 12px;font-size:16px">${config.title}</h3>` : ''}
        ${config.show_search !== false ? `<div style="margin-bottom:12px"><input type="text" id="${containerId}-search" placeholder="搜索..." style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius);width:240px;font-size:14px"></div>` : ''}
        <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
            <thead>
                <tr style="background:var(--bg-secondary);border-bottom:2px solid var(--border)">
                    ${columns.map(c => `<th style="padding:10px 12px;text-align:${c.align || 'left'};cursor:${c.sortable ? 'pointer' : 'default'};white-space:nowrap;${c.width !== 'auto' ? 'width:' + c.width : ''}" data-sort="${c.sortable ? c.field : ''}">${c.label}${c.sortable ? ' ↕' : ''}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${pageRows.length === 0 ? `<tr><td colspan="${columns.length}" style="padding:40px;text-align:center;color:#999">暂无数据</td></tr>` :
                pageRows.map((r, i) => `
                <tr style="${config.stripe !== false && i % 2 === 1 ? 'background:var(--bg-secondary)' : ''};border-bottom:1px solid var(--border)">
                    ${columns.map(c => {
                        let val = r[c.field] ?? '';
                        if (c.render === 'number') val = parseFloat(val).toLocaleString();
                        if (c.render === 'percent') val = parseFloat(val).toFixed(1) + '%';
                        if (c.render === 'tag') val = `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;background:#EEF2FF;color:#4F46E5">${val}</span>`;
                        if (c.render === 'link') val = `<a href="${val}" target="_blank" style="color:var(--primary)">${val}</a>`;
                        return `<td style="padding:10px 12px;text-align:${c.align || 'left'}">${val}</td>`;
                    }).join('')}
                </tr>`).join('')}
            </tbody>
        </table>
        </div>
        ${totalPages > 1 ? `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:13px;color:var(--text-secondary)">
            <span>共 ${filteredRows.length} 条</span>
            <div style="display:flex;gap:4px">
                <button onclick="this.__prev()" style="padding:4px 10px;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:var(--bg)">${currentPage > 1 ? '上一页' : ''}</button>
                <span style="padding:4px 8px">${currentPage}/${totalPages}</span>
                <button onclick="this.__next()" style="padding:4px 10px;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:var(--bg)">${currentPage < totalPages ? '下一页' : ''}</button>
            </div>
        </div>` : ''}
        `;
    }

    // Load data
    fetchWithAuth(config.data_source)
        .then(r => r.json())
        .then(data => {
            allRows = data.rows || data.data || [];
            filteredRows = [...allRows];
            renderTable();
        })
        .catch(err => {
            container.innerHTML = '<div style="padding:20px;color:#EF4444;">数据加载失败: ' + err.message + '</div>';
        });
}
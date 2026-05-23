/* config: { filters[], layout } */
/* filters: [{ id, label, type, data_source, default_value }] */
function renderFilterBar(config, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const filters = config.filters || [];
    const isHorizontal = config.layout !== 'vertical';

    container.style.display = isHorizontal ? 'flex' : 'block';
    container.style.flexWrap = 'wrap';
    container.style.gap = '12px';
    container.style.alignItems = isHorizontal ? 'center' : 'stretch';
    container.style.padding = '16px';
    container.style.background = 'var(--bg)';
    container.style.borderRadius = 'var(--radius)';
    container.style.boxShadow = 'var(--shadow)';
    container.style.marginBottom = '16px';

    // 全局筛选状态存储
    if (!window._filterState) window._filterState = {};
    const filterState = window._filterState;

    const filterPromises = filters.map(f => {
        const currentValue = filterState[f.id] !== undefined ? filterState[f.id] : (f.default_value || '');

        if (f.type === 'select') {
            // 从数据源加载选项
            if (f.data_source) {
                return fetchWithAuth(f.data_source)
                    .then(r => r.json())
                    .then(data => {
                        const rows = data.rows || data.data || [];
                        const options = rows.map(r => Object.values(r)[0]);
                        return renderSelectFilter(f, options, currentValue);
                    })
                    .catch(() => renderSelectFilter(f, [], currentValue));
            }
            return Promise.resolve(renderSelectFilter(f, [], currentValue));
        }
        if (f.type === 'date_range') return Promise.resolve(renderDateRangeFilter(f, currentValue));
        if (f.type === 'text') return Promise.resolve(renderTextFilter(f, currentValue));
        return Promise.resolve('');
    });

    Promise.all(filterPromises).then(htmls => {
        container.innerHTML = htmls.join('');
        // 绑定事件
        container.querySelectorAll('[data-filter-id]').forEach(el => {
            el.addEventListener('change', () => {
                filterState[el.dataset.filterId] = el.value;
                // 触发全局筛选变更事件（两种方式：原生 + 事件总线）
                window.dispatchEvent(new CustomEvent('filterChange', { detail: filterState }));
                if (window.__appEventBus) window.__appEventBus.emit('filterChange', filterState);
            });
        });
        // 文本输入也触发（防抖 300ms）
        container.querySelectorAll('input[type="text"][data-filter-id]').forEach(el => {
            let debounce = null;
            el.addEventListener('input', () => {
                clearTimeout(debounce);
                debounce = setTimeout(() => {
                    filterState[el.dataset.filterId] = el.value;
                    window.dispatchEvent(new CustomEvent('filterChange', { detail: filterState }));
                    if (window.__appEventBus) window.__appEventBus.emit('filterChange', filterState);
                }, 300);
            });
        });
    });

    function renderSelectFilter(f, options, current) {
        return `<div style="display:flex;align-items:center;gap:6px">
            <label style="font-size:13px;color:var(--text-secondary);white-space:nowrap">${f.label}:</label>
            <select data-filter-id="${f.id}" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;background:var(--bg)">
                <option value="">全部</option>
                ${options.map(o => `<option value="${o}" ${o === current ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
        </div>`;
    }

    function renderDateRangeFilter(f, current) {
        return `<div style="display:flex;align-items:center;gap:6px">
            <label style="font-size:13px;color:var(--text-secondary);white-space:nowrap">${f.label}:</label>
            <input type="date" data-filter-id="${f.id}_start" style="padding:6px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px">
            <span style="color:#999">~</span>
            <input type="date" data-filter-id="${f.id}_end" style="padding:6px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px">
        </div>`;
    }

    function renderTextFilter(f, current) {
        return `<div style="display:flex;align-items:center;gap:6px">
            <label style="font-size:13px;color:var(--text-secondary);white-space:nowrap">${f.label}:</label>
            <input type="text" data-filter-id="${f.id}" value="${current}" placeholder="输入${f.label}..." style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;width:160px">
        </div>`;
    }
}
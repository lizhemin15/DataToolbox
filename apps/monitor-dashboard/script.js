// ==================== State ====================
const STORAGE_KEY = 'monitor-dashboard-config';
let state = {
    mode: 'edit',
    dashboard: { name: '监控大屏', width: 1920, height: 1080, background: '#0a0e1a', gridSize: 20, showGrid: true },
    widgets: [],
    selectedId: null
};
let connections = {};
let clockTimers = {};
let scale = 1;
let drag = null;
let resize = null;
let paletteDrag = null;

// ==================== Widget Types ====================
const WIDGET_TYPES = {
    text:     { name: '文本',     icon: '📝', w: 300, h: 100, ds: true },
    clock:    { name: '时钟',     icon: '🕐', w: 280, h: 120, ds: false },
    number:   { name: '数值卡片', icon: '🔢', w: 220, h: 150, ds: true },
    progress: { name: '进度条',   icon: '📊', w: 380, h: 80,  ds: true },
    table:    { name: '数据表格', icon: '📋', w: 480, h: 280, ds: true },
    image:    { name: '图片',     icon: '🖼️', w: 300, h: 200, ds: false },
    iframe:   { name: '网页嵌入', icon: '🌐', w: 480, h: 360, ds: false },
    log:      { name: '日志流',   icon: '📜', w: 460, h: 260, ds: true }
};

function defaultConfig(type) {
    const base = { background: 'rgba(16,22,40,0.92)', borderColor: '#1e2844', borderWidth: 1, borderRadius: 8, padding: 10 };
    const ds = { sourceType: 'none', url: '', method: 'GET', headers: '', body: '', interval: 5000, dataPath: '', sendOnConnect: '' };
    switch (type) {
        case 'text': return { ...base, text: '双击编辑文字', fontSize: 20, fontWeight: '400', color: '#e2e8f0', textAlign: 'center', dataSource: { ...ds }, template: '' };
        case 'clock': return { ...base, fontSize: 48, color: '#00bbff', showDate: true, showSeconds: true, timezone: '' };
        case 'number': return { ...base, label: '指标名称', value: '0', unit: '', fontSize: 42, color: '#00e48c', dataSource: { ...ds } };
        case 'progress': return { ...base, label: '进度', value: 65, min: 0, max: 100, barColor: '', showValue: true, dataSource: { ...ds } };
        case 'table': return { ...base, padding: 0, columns: '', data: '[]', dataSource: { ...ds } };
        case 'image': return { ...base, padding: 0, url: '', objectFit: 'cover' };
        case 'iframe': return { ...base, padding: 0, url: '', borderRadius: 0 };
        case 'log': return { ...base, padding: 0, maxLines: 200, fontSize: 12, showTimestamp: true, dataSource: { ...ds }, logs: [] };
    }
    return base;
}

// ==================== Themes ====================
const THEMES = {
    tech: {
        name: '科技风',
        canvas: '#070b1a',
        widget: { background: 'rgba(16,22,40,0.92)', borderColor: '#1e2844', borderWidth: 1, borderRadius: 8 },
        title: '#00bbff',
        text: '#e2e8f0',
        textDim: '#8294b0',
        clock: '#00bbff',
        numbers: ['#00bbff', '#00e48c', '#a78bfa', '#f59e0b', '#ec4899', '#14b8a6'],
        progress: '',
        tableHead: 'rgba(255,255,255,0.04)',
        tableBorder: 'rgba(255,255,255,0.03)'
    },
    gov: {
        name: '党政风',
        canvas: '#1a0505',
        widget: { background: 'rgba(70,12,12,0.88)', borderColor: '#8b2020', borderWidth: 1, borderRadius: 4 },
        title: '#ffd700',
        text: '#fce8c3',
        textDim: '#d4a853',
        clock: '#ffd700',
        numbers: ['#ffd700', '#ff4444', '#ff8c00', '#ffd700', '#ff6347', '#ffb347'],
        progress: 'linear-gradient(90deg, #cc0000, #ff4444)',
        tableHead: 'rgba(139,32,32,0.5)',
        tableBorder: 'rgba(255,215,0,0.08)'
    },
    business: {
        name: '商务风',
        canvas: '#0d1b2a',
        widget: { background: 'rgba(18,36,58,0.9)', borderColor: '#1e3a5f', borderWidth: 1, borderRadius: 6 },
        title: '#4a9eda',
        text: '#c9d6e3',
        textDim: '#7a9cc6',
        clock: '#4a9eda',
        numbers: ['#4a9eda', '#2ecc71', '#3498db', '#e67e22', '#1abc9c', '#9b59b6'],
        progress: 'linear-gradient(90deg, #2980b9, #3498db)',
        tableHead: 'rgba(74,144,217,0.1)',
        tableBorder: 'rgba(74,144,217,0.06)'
    },
    academic: {
        name: '学术风',
        canvas: '#f0ebe3',
        widget: { background: 'rgba(255,255,255,0.95)', borderColor: '#c8bda8', borderWidth: 1, borderRadius: 4 },
        title: '#1a3c5e',
        text: '#2c3e50',
        textDim: '#7f8c8d',
        clock: '#2c3e50',
        numbers: ['#2c3e50', '#27ae60', '#2980b9', '#c0392b', '#8e44ad', '#16a085'],
        progress: 'linear-gradient(90deg, #2c3e50, #3498db)',
        tableHead: 'rgba(44,62,80,0.08)',
        tableBorder: 'rgba(44,62,80,0.08)'
    },
    minimal: {
        name: '极简风',
        canvas: '#0a0a0a',
        widget: { background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderRadius: 0 },
        title: '#ffffff',
        text: '#cccccc',
        textDim: '#555555',
        clock: '#ffffff',
        numbers: ['#ffffff', '#cccccc', '#ffffff', '#cccccc', '#ffffff', '#cccccc'],
        progress: '#ffffff',
        tableHead: 'rgba(255,255,255,0.04)',
        tableBorder: 'rgba(255,255,255,0.04)'
    },
    nature: {
        name: '自然风',
        canvas: '#0a1a0f',
        widget: { background: 'rgba(10,30,18,0.9)', borderColor: '#1a3a25', borderWidth: 1, borderRadius: 10 },
        title: '#4ade80',
        text: '#d1e7d5',
        textDim: '#6a9e78',
        clock: '#4ade80',
        numbers: ['#4ade80', '#22d3ee', '#a3e635', '#facc15', '#34d399', '#86efac'],
        progress: 'linear-gradient(90deg, #166534, #4ade80)',
        tableHead: 'rgba(74,222,128,0.08)',
        tableBorder: 'rgba(74,222,128,0.05)'
    }
};

function applyTheme(themeId) {
    const theme = THEMES[themeId];
    if (!theme) return;
    state.dashboard.theme = themeId;
    state.dashboard.background = theme.canvas;
    document.getElementById('themeSelect').value = themeId;

    let numIdx = 0;
    state.widgets.forEach(w => {
        const c = w.config;
        const isFloating = c.borderWidth === 0 && (c.background === 'transparent' || c.background?.includes?.('transparent'));

        if (!isFloating) {
            c.background = theme.widget.background;
            c.borderColor = theme.widget.borderColor;
            c.borderWidth = theme.widget.borderWidth;
            c.borderRadius = theme.widget.borderRadius;
        }

        switch (w.type) {
            case 'text':
                c.color = isFloating ? theme.title : theme.text;
                break;
            case 'clock':
                c.color = theme.clock;
                break;
            case 'number':
                c.color = theme.numbers[numIdx++ % theme.numbers.length];
                break;
            case 'progress':
                if (theme.progress) c.barColor = theme.progress;
                else c.barColor = '';
                break;
        }
    });

    updateCanvasScale();
    renderAllWidgets();
    if (state.selectedId) renderPropsPanel();
    save();
}

// ==================== Utilities ====================
function genId() { return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function snap(v) { const g = state.dashboard.gridSize; return Math.round(v / g) * g; }
function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }
function getWidget(id) { return state.widgets.find(w => w.id === id); }

function getNestedValue(obj, path) {
    if (!path) return obj;
    return path.split('.').reduce((c, k) => {
        if (c == null) return undefined;
        if (k.match(/^\d+$/) && Array.isArray(c)) return c[parseInt(k)];
        return c[k];
    }, obj);
}

function processTemplate(tpl, data) {
    return tpl.replace(/\{\{(.+?)\}\}/g, (_, p) => {
        const v = getNestedValue(data, p.trim());
        return v !== undefined ? v : '';
    });
}

function screenToCanvas(sx, sy) {
    const r = canvas.getBoundingClientRect();
    return { x: (sx - r.left) / scale, y: (sy - r.top) / scale };
}

// ==================== Canvas ====================
const canvas = document.getElementById('canvas');
const container = document.getElementById('canvasContainer');

function updateCanvasScale() {
    const r = container.getBoundingClientRect();
    const sx = r.width / state.dashboard.width;
    const sy = r.height / state.dashboard.height;
    scale = Math.min(sx, sy);
    canvas.style.width = state.dashboard.width + 'px';
    canvas.style.height = state.dashboard.height + 'px';
    canvas.style.transform = `scale(${scale})`;
    const aw = state.dashboard.width * scale, ah = state.dashboard.height * scale;
    canvas.style.left = ((r.width - aw) / 2) + 'px';
    canvas.style.top = ((r.height - ah) / 2) + 'px';
    canvas.style.background = state.dashboard.background || '#0a0e1a';
    canvas.classList.toggle('show-grid', state.dashboard.showGrid && state.mode === 'edit');
    canvas.style.backgroundSize = state.dashboard.gridSize + 'px ' + state.dashboard.gridSize + 'px';
}

// ==================== Widget Rendering ====================
function renderAllWidgets() {
    canvas.innerHTML = '';
    state.widgets.forEach(w => canvas.appendChild(createWidgetElement(w)));
    updateAllClocks();
}

function createWidgetElement(w) {
    const el = document.createElement('div');
    el.className = 'widget' + (w.id === state.selectedId ? ' selected' : '');
    el.id = 'wid-' + w.id;
    el.dataset.wid = w.id;
    applyWidgetStyle(el, w);
    el.innerHTML = buildWidgetBody(w) + buildResizeHandles();
    return el;
}

function applyWidgetStyle(el, w) {
    const c = w.config;
    const theme = THEMES[state.dashboard.theme] || THEMES.tech;
    Object.assign(el.style, {
        left: w.x + 'px', top: w.y + 'px', width: w.width + 'px', height: w.height + 'px',
        background: c.background, border: `${c.borderWidth}px solid ${c.borderColor}`,
        borderRadius: c.borderRadius + 'px', zIndex: w.z || 1,
        color: theme.text
    });
}

function buildWidgetBody(w) {
    const c = w.config;
    const hasTitle = c.titleShow !== false && w.title;
    return `<div class="widget-body${hasTitle ? ' has-title' : ''}">
        ${hasTitle ? `<div class="widget-title">${escHtml(w.title)}</div>` : ''}
        <div class="widget-content">${renderWidgetContent(w)}</div>
    </div>`;
}

function buildResizeHandles() {
    return ['n','ne','e','se','s','sw','w','nw'].map(d =>
        `<div class="resize-handle rh-${d}" data-dir="${d}"></div>`
    ).join('');
}

function renderWidgetContent(w) {
    const c = w.config;
    switch (w.type) {
        case 'text': {
            const txt = w._liveData && c.template ? processTemplate(c.template, w._liveData) : c.text;
            return `<div class="wt-text" style="font-size:${c.fontSize}px;font-weight:${c.fontWeight};color:${c.color};text-align:${c.textAlign}">${escHtml(txt)}</div>`;
        }
        case 'clock': {
            const th = THEMES[state.dashboard.theme] || THEMES.tech;
            return `<div class="wt-clock" style="font-size:${c.fontSize}px;color:${c.color}"><div class="clock-time" id="clock-${w.id}">--:--:--</div>${c.showDate ? `<div class="clock-date" id="clockd-${w.id}" style="color:${th.textDim}"></div>` : ''}</div>`;
        }
        case 'number': {
            const val = w._liveData !== undefined ? getNestedValue(w._liveData, c.dataSource.dataPath) ?? c.value : c.value;
            const th = THEMES[state.dashboard.theme] || THEMES.tech;
            return `<div class="wt-number"><div class="num-label" style="color:${th.textDim}">${escHtml(c.label)}</div><div class="num-value" style="font-size:${c.fontSize}px;color:${c.color}">${escHtml(String(val))}<span class="num-unit" style="color:${th.textDim}">${escHtml(c.unit)}</span></div></div>`;
        }
        case 'progress': {
            let val = w._liveData !== undefined ? getNestedValue(w._liveData, c.dataSource.dataPath) ?? c.value : c.value;
            val = Number(val) || 0;
            const pct = clamp(((val - c.min) / (c.max - c.min)) * 100, 0, 100);
            const color = c.barColor || '';
            const grad = color ? `background:${color}` : '';
            const th = THEMES[state.dashboard.theme] || THEMES.tech;
            const trackBg = (state.dashboard.theme === 'academic') ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
            return `<div class="wt-progress"><div class="prog-label" style="color:${th.textDim}"><span>${escHtml(c.label)}</span>${c.showValue ? `<span>${val} / ${c.max}</span>` : ''}</div><div class="prog-bar" style="background:${trackBg}"><div class="prog-fill" style="width:${pct}%;${grad}"></div></div></div>`;
        }
        case 'table': {
            let data = [];
            try {
                if (w._liveData) data = c.dataSource.dataPath ? getNestedValue(w._liveData, c.dataSource.dataPath) : w._liveData;
                else data = JSON.parse(c.data || '[]');
            } catch {}
            if (!Array.isArray(data) || !data.length) return '<div class="wt-error">暂无数据</div>';
            const cols = c.columns ? c.columns.split(',').map(s => s.trim()) : Object.keys(data[0]);
            const th = THEMES[state.dashboard.theme] || THEMES.tech;
            return `<div class="wt-table"><table><thead><tr>${cols.map(k => `<th style="background:${th.tableHead};color:${th.textDim};border-bottom-color:${th.tableBorder}">${escHtml(k)}</th>`).join('')}</tr></thead><tbody>${data.slice(0, 200).map(r => `<tr>${cols.map(k => `<td style="border-bottom-color:${th.tableBorder}">${escHtml(String(r[k] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        }
        case 'image':
            return c.url ? `<div class="wt-image"><img src="${escAttr(c.url)}" style="object-fit:${c.objectFit}" onerror="this.parentElement.innerHTML='<div class=wt-error>图片加载失败</div>'"></div>` : '<div class="wt-error">请设置图片URL</div>';
        case 'iframe':
            return c.url ? `<div class="wt-iframe"><iframe src="${escAttr(c.url)}" sandbox="allow-scripts allow-same-origin allow-forms"></iframe></div>` : '<div class="wt-error">请设置网页URL</div>';
        case 'log': {
            const logs = c.logs || [];
            if (!logs.length) return '<div class="wt-log"><div class="wt-error">等待数据...</div></div>';
            return `<div class="wt-log" style="font-size:${c.fontSize}px" id="log-${w.id}">${logs.map(l => `<div class="log-line">${c.showTimestamp ? `<span class="log-ts">${l.ts}</span>` : ''}${escHtml(l.msg)}</div>`).join('')}</div>`;
        }
    }
    return '';
}

function updateWidgetElement(w) {
    const el = document.getElementById('wid-' + w.id);
    if (!el) return;
    applyWidgetStyle(el, w);
    el.className = 'widget' + (w.id === state.selectedId ? ' selected' : '');
    const body = el.querySelector('.widget-body');
    if (body) body.outerHTML = buildWidgetBody(w);
}

function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escAttr(s) { return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

// ==================== Clock ====================
function updateAllClocks() {
    Object.values(clockTimers).forEach(clearInterval);
    clockTimers = {};
    state.widgets.filter(w => w.type === 'clock').forEach(w => {
        const tick = () => {
            const now = w.config.timezone ? new Date(new Date().toLocaleString('en-US', { timeZone: w.config.timezone })) : new Date();
            const te = document.getElementById('clock-' + w.id);
            if (te) te.textContent = now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', ...(w.config.showSeconds ? { second: '2-digit' } : {}) });
            const de = document.getElementById('clockd-' + w.id);
            if (de) de.textContent = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
        };
        tick();
        clockTimers[w.id] = setInterval(tick, 1000);
    });
}

// ==================== Widget CRUD ====================
function addWidget(type, x, y) {
    const t = WIDGET_TYPES[type];
    if (!t) return;
    const wx = x !== undefined ? snap(x - t.w / 2) : snap(state.dashboard.width / 2 - t.w / 2);
    const wy = y !== undefined ? snap(y - t.h / 2) : snap(state.dashboard.height / 2 - t.h / 2);
    const w = {
        id: genId(), type, title: t.name,
        x: clamp(wx, 0, state.dashboard.width - t.w),
        y: clamp(wy, 0, state.dashboard.height - t.h),
        width: t.w, height: t.h,
        z: state.widgets.length + 1, config: defaultConfig(type)
    };
    state.widgets.push(w);
    canvas.appendChild(createWidgetElement(w));
    selectWidget(w.id);
    if (type === 'clock') updateAllClocks();
    save();
}

function deleteWidget(id) {
    stopDataSource(id);
    if (clockTimers[id]) { clearInterval(clockTimers[id]); delete clockTimers[id]; }
    state.widgets = state.widgets.filter(w => w.id !== id);
    const el = document.getElementById('wid-' + id);
    if (el) el.remove();
    if (state.selectedId === id) { state.selectedId = null; renderPropsPanel(); }
    save();
}

function duplicateWidget(id) {
    const src = getWidget(id);
    if (!src) return;
    const w = JSON.parse(JSON.stringify(src));
    w.id = genId();
    w.x += 40;
    w.y += 40;
    w.z = state.widgets.length + 1;
    if (w.config.logs) w.config.logs = [];
    state.widgets.push(w);
    canvas.appendChild(createWidgetElement(w));
    selectWidget(w.id);
    save();
}

// ==================== Selection ====================
function selectWidget(id) {
    state.selectedId = id;
    document.querySelectorAll('.widget.selected').forEach(e => e.classList.remove('selected'));
    if (id) {
        const el = document.getElementById('wid-' + id);
        if (el) { el.classList.add('selected'); bringToFront(id); }
    }
    renderPropsPanel();
}

function bringToFront(id) {
    const maxZ = Math.max(0, ...state.widgets.map(w => w.z || 0));
    const w = getWidget(id);
    if (w) { w.z = maxZ + 1; const el = document.getElementById('wid-' + id); if (el) el.style.zIndex = w.z; }
}

// ==================== Drag ====================
canvas.addEventListener('mousedown', e => {
    if (state.mode !== 'edit') return;
    const rh = e.target.closest('.resize-handle');
    if (rh) return startResize(e, rh);
    const wEl = e.target.closest('.widget');
    if (!wEl) { selectWidget(null); return; }
    const wid = wEl.dataset.wid;
    selectWidget(wid);
    const w = getWidget(wid);
    if (!w) return;
    const cp = screenToCanvas(e.clientX, e.clientY);
    drag = { id: wid, startX: cp.x - w.x, startY: cp.y - w.y };
    wEl.classList.add('dragging');
    e.preventDefault();
});

window.addEventListener('mousemove', e => {
    if (drag) onDragMove(e);
    if (resize) onResizeMove(e);
    if (paletteDrag) onPaletteDragMove(e);
});

window.addEventListener('mouseup', e => {
    if (drag) {
        const el = document.getElementById('wid-' + drag.id);
        if (el) el.classList.remove('dragging');
        const w = getWidget(drag.id);
        if (w) { w.x = snap(w.x); w.y = snap(w.y); applyWidgetStyle(document.getElementById('wid-' + w.id), w); }
        drag = null;
        save();
    }
    if (resize) { endResize(); }
    if (paletteDrag) onPaletteDragEnd(e);
});

function onDragMove(e) {
    const w = getWidget(drag.id);
    if (!w) return;
    const cp = screenToCanvas(e.clientX, e.clientY);
    w.x = clamp(cp.x - drag.startX, 0, state.dashboard.width - w.width);
    w.y = clamp(cp.y - drag.startY, 0, state.dashboard.height - w.height);
    const el = document.getElementById('wid-' + w.id);
    if (el) { el.style.left = w.x + 'px'; el.style.top = w.y + 'px'; }
    updatePropsPosition(w);
}

// ==================== Resize ====================
function startResize(e, handle) {
    const wEl = handle.closest('.widget');
    const wid = wEl.dataset.wid;
    const w = getWidget(wid);
    if (!w) return;
    selectWidget(wid);
    const cp = screenToCanvas(e.clientX, e.clientY);
    resize = { id: wid, dir: handle.dataset.dir, startMouse: cp, startRect: { x: w.x, y: w.y, w: w.width, h: w.height } };
    e.preventDefault();
    e.stopPropagation();
}

function onResizeMove(e) {
    const w = getWidget(resize.id);
    if (!w) return;
    const cp = screenToCanvas(e.clientX, e.clientY);
    const dx = cp.x - resize.startMouse.x, dy = cp.y - resize.startMouse.y;
    const s = resize.startRect;
    const MIN = 40;
    let nx = s.x, ny = s.y, nw = s.w, nh = s.h;
    const dir = resize.dir;
    if (dir.includes('e')) nw = Math.max(MIN, s.w + dx);
    if (dir.includes('s')) nh = Math.max(MIN, s.h + dy);
    if (dir.includes('w')) { nw = Math.max(MIN, s.w - dx); nx = s.x + s.w - nw; }
    if (dir.includes('n')) { nh = Math.max(MIN, s.h - dy); ny = s.y + s.h - nh; }
    w.x = nx; w.y = ny; w.width = nw; w.height = nh;
    const el = document.getElementById('wid-' + w.id);
    if (el) { el.style.left = nx + 'px'; el.style.top = ny + 'px'; el.style.width = nw + 'px'; el.style.height = nh + 'px'; }
    updatePropsPosition(w);
}

function endResize() {
    const w = getWidget(resize.id);
    if (w) { w.x = snap(w.x); w.y = snap(w.y); w.width = snap(w.width) || 40; w.height = snap(w.height) || 40; updateWidgetElement(w); if (w.type === 'clock') updateAllClocks(); }
    resize = null;
    save();
}

// ==================== Properties Panel ====================
const propsContent = document.getElementById('propsContent');

function renderPropsPanel() {
    const w = state.selectedId ? getWidget(state.selectedId) : null;
    if (!w) { propsContent.innerHTML = '<div class="props-empty">点击选中组件<br>以编辑属性</div>'; return; }
    const c = w.config;
    const T = WIDGET_TYPES[w.type];
    let html = `<div class="props-header"><span>${T.icon} ${T.name}</span><div><button class="props-delete" onclick="duplicateWidget('${w.id}')" title="复制" style="margin-right:4px;border-color:var(--accent);color:var(--accent)">📋</button><button class="props-delete" onclick="deleteWidget('${w.id}')" title="删除">🗑️</button></div></div>`;

    html += `<div class="props-section"><h4>位置与尺寸</h4>
        <div class="prop-row"><label>X</label><input type="number" data-prop="x" value="${w.x}" step="${state.dashboard.gridSize}"><label>Y</label><input type="number" data-prop="y" value="${w.y}" step="${state.dashboard.gridSize}"></div>
        <div class="prop-row"><label>宽</label><input type="number" data-prop="width" value="${w.width}" step="${state.dashboard.gridSize}"><label>高</label><input type="number" data-prop="height" value="${w.height}" step="${state.dashboard.gridSize}"></div>
        <div class="prop-row"><label>标题</label><input type="text" data-prop="title" value="${escAttr(w.title || '')}"></div>
    </div>`;

    html += `<div class="props-section"><h4>外观</h4>
        <div class="prop-row"><label>背景</label><input type="color" data-prop="config.background" value="${toHexColor(c.background)}"><input type="text" data-prop="config.background" value="${escAttr(c.background)}"></div>
        <div class="prop-row"><label>边框</label><input type="color" data-prop="config.borderColor" value="${toHexColor(c.borderColor)}"><input type="number" data-prop="config.borderWidth" value="${c.borderWidth}" min="0" max="10"></div>
        <div class="prop-row"><label>圆角</label><input type="number" data-prop="config.borderRadius" value="${c.borderRadius}" min="0"><label>内距</label><input type="number" data-prop="config.padding" value="${c.padding}" min="0"></div>
    </div>`;

    html += `<div class="props-section"><h4>内容</h4>${renderTypeProps(w)}</div>`;

    if (T.ds) {
        const ds = c.dataSource || {};
        html += `<div class="props-section"><h4>数据源</h4>
            <div class="prop-row"><label>类型</label><select data-prop="config.dataSource.sourceType" onchange="onSourceTypeChange(this)">
                <option value="none"${ds.sourceType === 'none' ? ' selected' : ''}>无</option>
                <option value="polling"${ds.sourceType === 'polling' ? ' selected' : ''}>轮询请求</option>
                <option value="sse"${ds.sourceType === 'sse' ? ' selected' : ''}>SSE推送</option>
                <option value="websocket"${ds.sourceType === 'websocket' ? ' selected' : ''}>WebSocket</option>
            </select></div>`;
        if (ds.sourceType && ds.sourceType !== 'none') {
            html += `<div class="prop-row prop-row-wide"><label>URL</label><input type="url" data-prop="config.dataSource.url" value="${escAttr(ds.url || '')}" placeholder="https://..."></div>`;
            if (ds.sourceType === 'polling') {
                html += `<div class="prop-row"><label>方法</label><select data-prop="config.dataSource.method"><option value="GET"${ds.method === 'GET' ? ' selected' : ''}>GET</option><option value="POST"${ds.method === 'POST' ? ' selected' : ''}>POST</option></select><label>间隔</label><input type="number" data-prop="config.dataSource.interval" value="${ds.interval || 5000}" min="500" step="500">ms</div>`;
                html += `<div class="prop-row prop-row-wide"><label>Headers (JSON)</label><textarea data-prop="config.dataSource.headers" rows="2" placeholder='{"Authorization":"Bearer xxx"}'>${escHtml(ds.headers || '')}</textarea></div>`;
                if (ds.method === 'POST') html += `<div class="prop-row prop-row-wide"><label>Body</label><textarea data-prop="config.dataSource.body" rows="2">${escHtml(ds.body || '')}</textarea></div>`;
            }
            if (ds.sourceType === 'websocket') {
                html += `<div class="prop-row prop-row-wide"><label>连接后发送</label><textarea data-prop="config.dataSource.sendOnConnect" rows="2" placeholder="连接建立后发送的消息">${escHtml(ds.sendOnConnect || '')}</textarea></div>`;
            }
            html += `<div class="prop-row prop-row-wide"><label>数据路径</label><input type="text" data-prop="config.dataSource.dataPath" value="${escAttr(ds.dataPath || '')}" placeholder="data.value"></div>`;
            html += `<div class="prop-note">用点分路径提取JSON值，如: data.cpu_usage</div>`;
            html += `<div class="prop-row"><button class="tb-btn" onclick="testDataSource('${w.id}')" style="width:100%">🔄 测试连接</button></div>`;
        }
        html += '</div>';
    }

    propsContent.innerHTML = html;
    propsContent.querySelectorAll('input,textarea,select').forEach(el => {
        if (el.dataset.prop) {
            el.addEventListener('input', onPropInput);
            el.addEventListener('change', onPropChange);
        }
    });
}

function renderTypeProps(w) {
    const c = w.config;
    switch (w.type) {
        case 'text': return `
            <div class="prop-row prop-row-wide"><label>文字</label><textarea data-prop="config.text" rows="3">${escHtml(c.text)}</textarea></div>
            <div class="prop-row"><label>字号</label><input type="number" data-prop="config.fontSize" value="${c.fontSize}" min="8"><label>颜色</label><input type="color" data-prop="config.color" value="${toHexColor(c.color)}"></div>
            <div class="prop-row"><label>粗细</label><select data-prop="config.fontWeight"><option value="400"${c.fontWeight === '400' ? ' selected' : ''}>常规</option><option value="600"${c.fontWeight === '600' ? ' selected' : ''}>半粗</option><option value="700"${c.fontWeight === '700' ? ' selected' : ''}>粗体</option></select><label>对齐</label><select data-prop="config.textAlign"><option value="left"${c.textAlign === 'left' ? ' selected' : ''}>左</option><option value="center"${c.textAlign === 'center' ? ' selected' : ''}>中</option><option value="right"${c.textAlign === 'right' ? ' selected' : ''}>右</option></select></div>
            ${c.dataSource?.sourceType && c.dataSource.sourceType !== 'none' ? `<div class="prop-row prop-row-wide"><label>模板</label><textarea data-prop="config.template" rows="2" placeholder="CPU: {{data.cpu}}%">${escHtml(c.template || '')}</textarea></div><div class="prop-note">用 {{路径}} 插入数据值</div>` : ''}`;
        case 'clock': return `
            <div class="prop-row"><label>字号</label><input type="number" data-prop="config.fontSize" value="${c.fontSize}" min="12"><label>颜色</label><input type="color" data-prop="config.color" value="${toHexColor(c.color)}"></div>
            <div class="prop-row"><label>显示</label><label style="width:auto"><input type="checkbox" data-prop="config.showDate" ${c.showDate ? 'checked' : ''}> 日期</label><label style="width:auto"><input type="checkbox" data-prop="config.showSeconds" ${c.showSeconds ? 'checked' : ''}> 秒</label></div>
            <div class="prop-row prop-row-wide"><label>时区</label><input type="text" data-prop="config.timezone" value="${escAttr(c.timezone || '')}" placeholder="留空为本地，如: Asia/Shanghai"></div>`;
        case 'number': return `
            <div class="prop-row"><label>标签</label><input type="text" data-prop="config.label" value="${escAttr(c.label)}"></div>
            <div class="prop-row"><label>值</label><input type="text" data-prop="config.value" value="${escAttr(String(c.value))}"><label>单位</label><input type="text" data-prop="config.unit" value="${escAttr(c.unit)}" style="width:50px"></div>
            <div class="prop-row"><label>字号</label><input type="number" data-prop="config.fontSize" value="${c.fontSize}" min="12"><label>颜色</label><input type="color" data-prop="config.color" value="${toHexColor(c.color)}"></div>`;
        case 'progress': return `
            <div class="prop-row"><label>标签</label><input type="text" data-prop="config.label" value="${escAttr(c.label)}"></div>
            <div class="prop-row"><label>值</label><input type="number" data-prop="config.value" value="${c.value}"><label>最小</label><input type="number" data-prop="config.min" value="${c.min}"><label>最大</label><input type="number" data-prop="config.max" value="${c.max}"></div>
            <div class="prop-row"><label>颜色</label><input type="color" data-prop="config.barColor" value="${toHexColor(c.barColor || '#00bbff')}"><label style="width:auto"><input type="checkbox" data-prop="config.showValue" ${c.showValue ? 'checked' : ''}> 显示值</label></div>`;
        case 'table': return `
            <div class="prop-row prop-row-wide"><label>列名 (逗号分隔，留空自动)</label><input type="text" data-prop="config.columns" value="${escAttr(c.columns || '')}" placeholder="name,value,status"></div>
            <div class="prop-row prop-row-wide"><label>静态数据 (JSON数组)</label><textarea data-prop="config.data" rows="4" placeholder='[{"name":"A","value":1}]'>${escHtml(c.data || '[]')}</textarea></div>`;
        case 'image': return `
            <div class="prop-row prop-row-wide"><label>图片URL</label><input type="url" data-prop="config.url" value="${escAttr(c.url || '')}" placeholder="https://..."></div>
            <div class="prop-row"><label>适应</label><select data-prop="config.objectFit"><option value="cover"${c.objectFit === 'cover' ? ' selected' : ''}>覆盖</option><option value="contain"${c.objectFit === 'contain' ? ' selected' : ''}>包含</option><option value="fill"${c.objectFit === 'fill' ? ' selected' : ''}>拉伸</option></select></div>`;
        case 'iframe': return `
            <div class="prop-row prop-row-wide"><label>网页URL</label><input type="url" data-prop="config.url" value="${escAttr(c.url || '')}" placeholder="https://..."></div>`;
        case 'log': return `
            <div class="prop-row"><label>字号</label><input type="number" data-prop="config.fontSize" value="${c.fontSize}" min="8"><label>最大行</label><input type="number" data-prop="config.maxLines" value="${c.maxLines}" min="10"></div>
            <div class="prop-row"><label style="width:auto"><input type="checkbox" data-prop="config.showTimestamp" ${c.showTimestamp ? 'checked' : ''}> 显示时间戳</label></div>
            <div class="prop-row"><button class="tb-btn" onclick="clearLogs('${w.id}')" style="width:100%">清空日志</button></div>`;
    }
    return '';
}

function toHexColor(c) {
    if (!c || c === 'transparent') return '#000000';
    if (c.startsWith('#') && (c.length === 7 || c.length === 4)) return c;
    if (c.startsWith('rgba') || c.startsWith('rgb')) {
        const m = c.match(/[\d.]+/g);
        if (m && m.length >= 3) return '#' + [0,1,2].map(i => Math.round(Number(m[i])).toString(16).padStart(2,'0')).join('');
    }
    return '#000000';
}

function onPropInput(e) {
    const el = e.target;
    if (el.type === 'range' || el.type === 'color') applyProp(el);
}

function onPropChange(e) { applyProp(e.target); }

function applyProp(el) {
    const w = getWidget(state.selectedId);
    if (!w) return;
    const path = el.dataset.prop;
    let val;
    if (el.type === 'checkbox') val = el.checked;
    else if (el.type === 'number') val = Number(el.value);
    else val = el.value;
    setNested(w, path, val);
    updateWidgetElement(w);
    if (w.type === 'clock') updateAllClocks();
    save();
}

function setNested(obj, path, val) {
    const keys = path.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!cur[keys[i]]) cur[keys[i]] = {};
        cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = val;
}

function updatePropsPosition(w) {
    const inputs = propsContent.querySelectorAll('input[data-prop="x"], input[data-prop="y"], input[data-prop="width"], input[data-prop="height"]');
    inputs.forEach(el => {
        if (el.dataset.prop === 'x') el.value = Math.round(w.x);
        if (el.dataset.prop === 'y') el.value = Math.round(w.y);
        if (el.dataset.prop === 'width') el.value = Math.round(w.width);
        if (el.dataset.prop === 'height') el.value = Math.round(w.height);
    });
}

function onSourceTypeChange(el) {
    applyProp(el);
    const w = getWidget(state.selectedId);
    if (w) { stopDataSource(w.id); renderPropsPanel(); }
}

// ==================== Data Sources ====================
function startAllDataSources() {
    state.widgets.forEach(w => {
        if (w.config.dataSource && w.config.dataSource.sourceType !== 'none' && w.config.dataSource.url) {
            startDataSource(w);
        }
    });
}

function stopAllDataSources() {
    Object.keys(connections).forEach(stopDataSource);
}

function startDataSource(w) {
    stopDataSource(w.id);
    const ds = w.config.dataSource;
    if (!ds || ds.sourceType === 'none' || !ds.url) return;
    try {
        switch (ds.sourceType) {
            case 'polling': startPolling(w); break;
            case 'sse': startSSE(w); break;
            case 'websocket': startWebSocket(w); break;
        }
    } catch (e) { console.error('Data source error:', e); }
}

function stopDataSource(id) {
    const c = connections[id];
    if (!c) return;
    if (c.timer) clearInterval(c.timer);
    if (c.source) { try { c.source.close(); } catch {} }
    if (c.ws) { try { c.ws.close(); } catch {} }
    delete connections[id];
}

function startPolling(w) {
    const ds = w.config.dataSource;
    const doFetch = async () => {
        try {
            const opts = { method: ds.method || 'GET', headers: {} };
            if (ds.headers) { try { Object.assign(opts.headers, JSON.parse(ds.headers)); } catch {} }
            if (ds.method === 'POST' && ds.body) opts.body = ds.body;
            const res = await fetch(ds.url, opts);
            const ct = res.headers.get('content-type') || '';
            const data = ct.includes('json') ? await res.json() : await res.text();
            onDataReceived(w.id, data);
        } catch (e) { onDataError(w.id, e.message); }
    };
    doFetch();
    connections[w.id] = { type: 'polling', timer: setInterval(doFetch, ds.interval || 5000) };
}

function startSSE(w) {
    const ds = w.config.dataSource;
    const source = new EventSource(ds.url);
    source.onmessage = e => {
        try { onDataReceived(w.id, JSON.parse(e.data)); } catch { onDataReceived(w.id, e.data); }
    };
    source.onerror = () => onDataError(w.id, 'SSE连接失败');
    connections[w.id] = { type: 'sse', source };
}

function startWebSocket(w) {
    const ds = w.config.dataSource;
    const ws = new WebSocket(ds.url);
    ws.onopen = () => { if (ds.sendOnConnect) ws.send(ds.sendOnConnect); };
    ws.onmessage = e => {
        try { onDataReceived(w.id, JSON.parse(e.data)); } catch { onDataReceived(w.id, e.data); }
    };
    ws.onerror = () => onDataError(w.id, 'WebSocket连接失败');
    ws.onclose = () => onDataError(w.id, 'WebSocket已断开');
    connections[w.id] = { type: 'websocket', ws };
}

function onDataReceived(wid, data) {
    const w = getWidget(wid);
    if (!w) return;
    w._liveData = data;
    w._error = null;
    if (w.type === 'log') {
        const ds = w.config.dataSource;
        const msg = ds.dataPath ? String(getNestedValue(data, ds.dataPath) ?? JSON.stringify(data)) : (typeof data === 'string' ? data : JSON.stringify(data));
        if (!w.config.logs) w.config.logs = [];
        w.config.logs.push({ ts: new Date().toLocaleTimeString('zh-CN', { hour12: false }), msg });
        if (w.config.logs.length > (w.config.maxLines || 200)) w.config.logs.shift();
    }
    updateWidgetElement(w);
    if (w.type === 'clock') updateAllClocks();
}

function onDataError(wid, msg) {
    const w = getWidget(wid);
    if (w) { w._error = msg; }
}

function testDataSource(wid) {
    const w = getWidget(wid);
    if (!w) return;
    startDataSource(w);
}

function clearLogs(wid) {
    const w = getWidget(wid);
    if (!w) return;
    w.config.logs = [];
    updateWidgetElement(w);
}

// ==================== Mode ====================
function setMode(mode) {
    state.mode = mode;
    const app = document.getElementById('app');
    app.className = 'mode-' + mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    updateCanvasScale();
    setTimeout(updateCanvasScale, 300);
    if (mode === 'play') {
        selectWidget(null);
        startAllDataSources();
    }
}

// ==================== Import / Export ====================
function exportConfig() {
    const cfg = {
        dashboard: state.dashboard,
        widgets: state.widgets.map(w => {
            const wc = { ...w };
            delete wc._liveData;
            delete wc._error;
            const cc = { ...wc.config };
            if (cc.logs) cc.logs = [];
            wc.config = cc;
            return wc;
        })
    };
    const json = JSON.stringify(cfg, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.dashboard.name || '监控大屏') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
}

function importConfig() { document.getElementById('importModal').style.display = ''; }
function closeImportModal() { document.getElementById('importModal').style.display = 'none'; }

function doImport() {
    const text = document.getElementById('importText').value.trim();
    if (!text) return;
    try { loadConfig(JSON.parse(text)); closeImportModal(); }
    catch (e) { alert('JSON解析失败: ' + e.message); }
}

function importFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try { loadConfig(JSON.parse(reader.result)); closeImportModal(); }
        catch (err) { alert('文件解析失败: ' + err.message); }
    };
    reader.readAsText(file);
    e.target.value = '';
}

function loadConfig(cfg) {
    stopAllDataSources();
    Object.values(clockTimers).forEach(clearInterval);
    clockTimers = {};
    if (cfg.dashboard) Object.assign(state.dashboard, cfg.dashboard);
    state.widgets = cfg.widgets || [];
    state.widgets.forEach(w => { delete w._liveData; delete w._error; if (w.config.logs) w.config.logs = []; });
    state.selectedId = null;
    document.getElementById('dashboardName').value = state.dashboard.name;
    document.getElementById('themeSelect').value = state.dashboard.theme || 'tech';
    updateDashSizeSelect();
    document.getElementById('gridToggle').checked = state.dashboard.showGrid;
    updateCanvasScale();
    renderAllWidgets();
    renderPropsPanel();
    startAllDataSources();
    save();
}

// ==================== Persistence ====================
function save() {
    const cfg = {
        dashboard: state.dashboard,
        widgets: state.widgets.map(w => {
            const wc = { ...w };
            delete wc._liveData;
            delete wc._error;
            const cc = { ...wc.config };
            if (cc.logs) cc.logs = [];
            wc.config = cc;
            return wc;
        })
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch {}
}

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const cfg = JSON.parse(raw);
            if (cfg.dashboard) Object.assign(state.dashboard, cfg.dashboard);
            if (cfg.widgets) state.widgets = cfg.widgets;
        }
    } catch {}
}

// ==================== Dashboard Settings ====================
function toggleGrid() {
    state.dashboard.showGrid = document.getElementById('gridToggle').checked;
    updateCanvasScale();
    save();
}

function changeDashSize() {
    const v = document.getElementById('dashW').value.split('x');
    state.dashboard.width = parseInt(v[0]);
    state.dashboard.height = parseInt(v[1]);
    updateCanvasScale();
    save();
}

function updateDashSizeSelect() {
    const sel = document.getElementById('dashW');
    const key = state.dashboard.width + 'x' + state.dashboard.height;
    for (const o of sel.options) { if (o.value === key) { sel.value = key; return; } }
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = state.dashboard.width + '×' + state.dashboard.height;
    sel.appendChild(opt);
    sel.value = key;
}

function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
}
document.addEventListener('fullscreenchange', () => { updateCanvasScale(); setTimeout(updateCanvasScale, 100); });

function goBack() { window.location.href = '../../index.html'; }

// ==================== Context Menu ====================
let ctxMenu = null;
canvas.addEventListener('contextmenu', e => {
    if (state.mode !== 'edit') return;
    e.preventDefault();
    removeCtxMenu();
    const wEl = e.target.closest('.widget');
    if (!wEl) return;
    const wid = wEl.dataset.wid;
    selectWidget(wid);
    ctxMenu = document.createElement('div');
    ctxMenu.className = 'ctx-menu';
    ctxMenu.innerHTML = `
        <div class="ctx-item" onclick="duplicateWidget('${wid}');removeCtxMenu()">📋 复制组件</div>
        <div class="ctx-item" onclick="bringToFront('${wid}');removeCtxMenu()">⬆️ 置顶</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item" onclick="deleteWidget('${wid}');removeCtxMenu()" style="color:var(--danger)">🗑️ 删除</div>`;
    ctxMenu.style.left = e.clientX + 'px';
    ctxMenu.style.top = e.clientY + 'px';
    document.body.appendChild(ctxMenu);
});

function removeCtxMenu() { if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; } }
document.addEventListener('click', removeCtxMenu);

// ==================== Keyboard ====================
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (state.mode === 'play') { setMode('edit'); return; }
        if (state.selectedId) selectWidget(null);
    }
    if (state.mode !== 'edit' || !state.selectedId) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    const w = getWidget(state.selectedId);
    if (!w) return;
    const step = e.shiftKey ? 1 : state.dashboard.gridSize;
    switch (e.key) {
        case 'Delete': case 'Backspace': deleteWidget(w.id); e.preventDefault(); break;
        case 'ArrowLeft':  w.x = Math.max(0, w.x - step); break;
        case 'ArrowRight': w.x = Math.min(state.dashboard.width - w.width, w.x + step); break;
        case 'ArrowUp':    w.y = Math.max(0, w.y - step); break;
        case 'ArrowDown':  w.y = Math.min(state.dashboard.height - w.height, w.y + step); break;
        default: return;
    }
    e.preventDefault();
    updateWidgetElement(w);
    updatePropsPosition(w);
    save();
});

// ==================== Palette Drag ====================
function renderWidgetPalette() {
    const list = document.getElementById('widgetList');
    list.innerHTML = Object.entries(WIDGET_TYPES).map(([type, t]) =>
        `<div class="palette-item" data-type="${type}"><span class="pi-icon">${t.icon}</span><span class="pi-name">${t.name}</span></div>`
    ).join('');
    list.querySelectorAll('.palette-item').forEach(el => {
        el.addEventListener('mousedown', onPaletteDragStart);
    });
}

function onPaletteDragStart(e) {
    const type = e.currentTarget.dataset.type;
    const t = WIDGET_TYPES[type];
    if (!t) return;
    e.preventDefault();
    const ghost = document.createElement('div');
    ghost.className = 'palette-ghost';
    ghost.textContent = t.icon + ' ' + t.name;
    ghost.style.left = e.clientX + 'px';
    ghost.style.top = e.clientY + 'px';
    document.body.appendChild(ghost);
    paletteDrag = { type, ghost };
    container.classList.add('drop-active');
}

function onPaletteDragMove(e) {
    if (!paletteDrag) return;
    paletteDrag.ghost.style.left = e.clientX + 'px';
    paletteDrag.ghost.style.top = e.clientY + 'px';
}

function onPaletteDragEnd(e) {
    if (!paletteDrag) return;
    paletteDrag.ghost.remove();
    container.classList.remove('drop-active');
    const rect = canvas.getBoundingClientRect();
    if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const cp = screenToCanvas(e.clientX, e.clientY);
        addWidget(paletteDrag.type, cp.x, cp.y);
    }
    paletteDrag = null;
}

// ==================== Templates ====================
const TEMPLATES = [
    {
        id: 'server', icon: '🖥️', name: '服务器监控', desc: 'CPU、内存、磁盘、网络流量与系统日志',
        build: () => ({
            dashboard: { name: '服务器监控中心', width: 1920, height: 1080, background: '#070b1a', gridSize: 20, showGrid: true },
            widgets: [
                { id: genId(), type: 'text', title: '标题', x: 560, y: 20, width: 800, height: 80, z: 1, config: { ...defaultConfig('text'), text: '服务器监控中心', fontSize: 36, fontWeight: '700', color: '#00bbff', textAlign: 'center', background: 'transparent', borderWidth: 0 } },
                { id: genId(), type: 'clock', title: '时钟', x: 1580, y: 20, width: 300, height: 80, z: 2, config: { ...defaultConfig('clock'), fontSize: 32, color: '#ffffff', showDate: true, showSeconds: true, background: 'transparent', borderWidth: 0 } },
                { id: genId(), type: 'number', title: 'CPU', x: 60, y: 140, width: 260, height: 160, z: 3, config: { ...defaultConfig('number'), label: 'CPU 使用率', value: '23.5', unit: '%', fontSize: 48, color: '#00e48c' } },
                { id: genId(), type: 'number', title: '内存', x: 360, y: 140, width: 260, height: 160, z: 4, config: { ...defaultConfig('number'), label: '内存使用率', value: '67.2', unit: '%', fontSize: 48, color: '#ffaa00' } },
                { id: genId(), type: 'number', title: '磁盘', x: 660, y: 140, width: 260, height: 160, z: 5, config: { ...defaultConfig('number'), label: '磁盘使用率', value: '45.8', unit: '%', fontSize: 48, color: '#00bbff' } },
                { id: genId(), type: 'number', title: '网络', x: 960, y: 140, width: 260, height: 160, z: 6, config: { ...defaultConfig('number'), label: '网络吞吐', value: '128', unit: 'Mbps', fontSize: 48, color: '#a78bfa' } },
                { id: genId(), type: 'number', title: '在线', x: 1260, y: 140, width: 260, height: 160, z: 7, config: { ...defaultConfig('number'), label: '在线连接数', value: '1,842', unit: '', fontSize: 48, color: '#f472b6' } },
                { id: genId(), type: 'number', title: '运行', x: 1560, y: 140, width: 300, height: 160, z: 8, config: { ...defaultConfig('number'), label: '运行时间', value: '72', unit: '天', fontSize: 48, color: '#34d399' } },
                { id: genId(), type: 'progress', title: 'CPU进度', x: 60, y: 340, width: 580, height: 80, z: 9, config: { ...defaultConfig('progress'), label: 'CPU 负载', value: 23.5, max: 100, showValue: true } },
                { id: genId(), type: 'progress', title: '内存进度', x: 60, y: 440, width: 580, height: 80, z: 10, config: { ...defaultConfig('progress'), label: '内存占用', value: 67.2, max: 100, barColor: '#ffaa00', showValue: true } },
                { id: genId(), type: 'progress', title: '磁盘进度', x: 60, y: 540, width: 580, height: 80, z: 11, config: { ...defaultConfig('progress'), label: '磁盘空间', value: 45.8, max: 100, barColor: '#a78bfa', showValue: true } },
                { id: genId(), type: 'table', title: '进程列表', x: 680, y: 340, width: 560, height: 340, z: 12, config: { ...defaultConfig('table'), columns: '进程名,PID,CPU%,内存MB,状态', data: JSON.stringify([
                    { '进程名': 'nginx', 'PID': 1024, 'CPU%': 2.1, '内存MB': 128, '状态': '运行中' },
                    { '进程名': 'mysql', 'PID': 2048, 'CPU%': 8.5, '内存MB': 512, '状态': '运行中' },
                    { '进程名': 'redis', 'PID': 3072, 'CPU%': 1.2, '内存MB': 64, '状态': '运行中' },
                    { '进程名': 'node', 'PID': 4096, 'CPU%': 5.3, '内存MB': 256, '状态': '运行中' },
                    { '进程名': 'java', 'PID': 5120, 'CPU%': 12.7, '内存MB': 1024, '状态': '运行中' },
                    { '进程名': 'cron', 'PID': 6144, 'CPU%': 0.1, '内存MB': 8, '状态': '空闲' }
                ]) } },
                { id: genId(), type: 'log', title: '系统日志', x: 1280, y: 340, width: 580, height: 340, z: 13, config: { ...defaultConfig('log'), fontSize: 11, showTimestamp: true, logs: [
                    { ts: '09:15:02', msg: '[INFO] nginx 重载配置完成' },
                    { ts: '09:14:58', msg: '[INFO] SSL证书自动续签成功' },
                    { ts: '09:12:30', msg: '[WARN] 磁盘 /data 使用率超过 40%' },
                    { ts: '09:10:15', msg: '[INFO] 定时备份任务开始执行' },
                    { ts: '09:08:42', msg: '[INFO] MySQL 慢查询: SELECT * FROM orders (3.2s)' },
                    { ts: '09:05:00', msg: '[INFO] 系统健康检查通过' },
                    { ts: '09:01:12', msg: '[INFO] Redis 内存整理完成, 释放 12MB' }
                ] } },
                { id: genId(), type: 'table', title: '磁盘详情', x: 60, y: 660, width: 580, height: 280, z: 14, config: { ...defaultConfig('table'), columns: '挂载点,总容量,已用,可用,使用率', data: JSON.stringify([
                    { '挂载点': '/', '总容量': '100GB', '已用': '45GB', '可用': '55GB', '使用率': '45%' },
                    { '挂载点': '/data', '总容量': '500GB', '已用': '210GB', '可用': '290GB', '使用率': '42%' },
                    { '挂载点': '/backup', '总容量': '1TB', '已用': '380GB', '可用': '620GB', '使用率': '38%' },
                    { '挂载点': '/tmp', '总容量': '50GB', '已用': '2GB', '可用': '48GB', '使用率': '4%' }
                ]) } },
                { id: genId(), type: 'text', title: '状态', x: 680, y: 720, width: 560, height: 220, z: 15, config: { ...defaultConfig('text'), text: '✅ Web服务: 正常运行\n✅ 数据库: 正常运行\n✅ 缓存服务: 正常运行\n✅ 消息队列: 正常运行\n⚠️ 备份服务: 执行中...', fontSize: 16, color: '#e2e8f0', textAlign: 'left' } },
                { id: genId(), type: 'text', title: '网络', x: 1280, y: 720, width: 580, height: 220, z: 16, config: { ...defaultConfig('text'), text: '📡 入站流量: 68.5 Mbps\n📡 出站流量: 42.3 Mbps\n📊 今日请求: 1,284,567\n⏱️ 平均响应: 23ms\n🚫 错误率: 0.02%', fontSize: 16, color: '#e2e8f0', textAlign: 'left' } }
            ]
        })
    },
    {
        id: 'ops', icon: '📈', name: '运营数据', desc: '用户量、收入、转化率、订单等业务指标',
        build: () => ({
            dashboard: { name: '运营数据大屏', width: 1920, height: 1080, background: '#080c1e', gridSize: 20, showGrid: true },
            widgets: [
                { id: genId(), type: 'text', title: '标题', x: 510, y: 20, width: 900, height: 80, z: 1, config: { ...defaultConfig('text'), text: '运营数据实时大屏', fontSize: 36, fontWeight: '700', color: '#ffffff', textAlign: 'center', background: 'transparent', borderWidth: 0 } },
                { id: genId(), type: 'clock', title: '时钟', x: 40, y: 30, width: 280, height: 60, z: 2, config: { ...defaultConfig('clock'), fontSize: 28, color: '#94a3b8', showDate: true, showSeconds: true, background: 'transparent', borderWidth: 0 } },
                { id: genId(), type: 'number', title: '总用户', x: 60, y: 120, width: 280, height: 160, z: 3, config: { ...defaultConfig('number'), label: '累计用户', value: '586,432', unit: '', fontSize: 38, color: '#00bbff' } },
                { id: genId(), type: 'number', title: '日活', x: 380, y: 120, width: 280, height: 160, z: 4, config: { ...defaultConfig('number'), label: '今日活跃', value: '42,856', unit: '', fontSize: 38, color: '#00e48c' } },
                { id: genId(), type: 'number', title: '新增', x: 700, y: 120, width: 280, height: 160, z: 5, config: { ...defaultConfig('number'), label: '今日新增', value: '1,234', unit: '', fontSize: 38, color: '#a78bfa' } },
                { id: genId(), type: 'number', title: '收入', x: 1020, y: 120, width: 280, height: 160, z: 6, config: { ...defaultConfig('number'), label: '今日收入', value: '¥89,650', unit: '', fontSize: 36, color: '#f59e0b' } },
                { id: genId(), type: 'number', title: 'ARPU', x: 1340, y: 120, width: 260, height: 160, z: 7, config: { ...defaultConfig('number'), label: 'ARPU', value: '¥12.8', unit: '', fontSize: 38, color: '#ec4899' } },
                { id: genId(), type: 'number', title: '留存', x: 1640, y: 120, width: 240, height: 160, z: 8, config: { ...defaultConfig('number'), label: '次留率', value: '45.2', unit: '%', fontSize: 38, color: '#14b8a6' } },
                { id: genId(), type: 'progress', title: 'KPI', x: 60, y: 320, width: 560, height: 80, z: 9, config: { ...defaultConfig('progress'), label: '月度KPI完成率', value: 78, max: 100, showValue: true } },
                { id: genId(), type: 'progress', title: '注册转化', x: 60, y: 420, width: 560, height: 80, z: 10, config: { ...defaultConfig('progress'), label: '注册转化率', value: 32, max: 100, barColor: '#a78bfa', showValue: true } },
                { id: genId(), type: 'progress', title: '付费转化', x: 60, y: 520, width: 560, height: 80, z: 11, config: { ...defaultConfig('progress'), label: '付费转化率', value: 8.5, max: 100, barColor: '#f59e0b', showValue: true } },
                { id: genId(), type: 'table', title: '热门商品', x: 660, y: 320, width: 600, height: 340, z: 12, config: { ...defaultConfig('table'), columns: '商品名称,销量,金额,转化率', data: JSON.stringify([
                    { '商品名称': '年度VIP会员', '销量': 2456, '金额': '¥245,600', '转化率': '12.3%' },
                    { '商品名称': '月度VIP会员', '销量': 5832, '金额': '¥174,960', '转化率': '8.7%' },
                    { '商品名称': '高级功能包', '销量': 1253, '金额': '¥62,650', '转化率': '5.2%' },
                    { '商品名称': '存储扩展包', '销量': 876, '金额': '¥26,280', '转化率': '3.1%' },
                    { '商品名称': '专属客服', '销量': 342, '金额': '¥34,200', '转化率': '1.8%' },
                    { '商品名称': '企业定制', '销量': 28, '金额': '¥168,000', '转化率': '0.9%' }
                ]) } },
                { id: genId(), type: 'table', title: '渠道分析', x: 1300, y: 320, width: 560, height: 340, z: 13, config: { ...defaultConfig('table'), columns: '渠道,访问量,注册数,付费数,ROI', data: JSON.stringify([
                    { '渠道': '自然搜索', '访问量': 45000, '注册数': 3200, '付费数': 280, 'ROI': '320%' },
                    { '渠道': '微信推广', '访问量': 28000, '注册数': 4500, '付费数': 420, 'ROI': '185%' },
                    { '渠道': '信息流', '访问量': 62000, '注册数': 2800, '付费数': 156, 'ROI': '95%' },
                    { '渠道': '直接访问', '访问量': 15000, '注册数': 1200, '付费数': 180, 'ROI': '-' },
                    { '渠道': 'KOL合作', '访问量': 18000, '注册数': 2100, '付费数': 310, 'ROI': '210%' }
                ]) } },
                { id: genId(), type: 'text', title: '通知', x: 60, y: 640, width: 560, height: 300, z: 14, config: { ...defaultConfig('text'), text: '📊 今日数据亮点\n\n🔺 日活环比增长 +8.2%\n🔺 付费用户新增 +156\n🔺 平均订单金额 ¥68.5 (+5.3%)\n\n⚠️ 信息流渠道ROI低于预期\n💡 建议优化落地页转化流程', fontSize: 15, color: '#e2e8f0', textAlign: 'left' } },
                { id: genId(), type: 'text', title: '地区', x: 660, y: 700, width: 1200, height: 240, z: 15, config: { ...defaultConfig('text'), text: '🏆 Top5 活跃地区\n\n1. 广东 — 8,542 (19.9%)    2. 北京 — 6,128 (14.3%)    3. 浙江 — 5,432 (12.7%)\n4. 上海 — 4,856 (11.3%)    5. 江苏 — 3,921 (9.2%)', fontSize: 18, color: '#94a3b8', textAlign: 'left' } }
            ]
        })
    },
    {
        id: 'iot', icon: '🏭', name: '物联网设备', desc: '设备状态、传感器数据、告警信息',
        build: () => ({
            dashboard: { name: 'IoT 设备监控', width: 1920, height: 1080, background: '#050a15', gridSize: 20, showGrid: true },
            widgets: [
                { id: genId(), type: 'text', title: '标题', x: 560, y: 20, width: 800, height: 80, z: 1, config: { ...defaultConfig('text'), text: 'IoT 设备监控平台', fontSize: 34, fontWeight: '700', color: '#00bbff', textAlign: 'center', background: 'transparent', borderWidth: 0 } },
                { id: genId(), type: 'clock', title: '时钟', x: 1600, y: 30, width: 280, height: 60, z: 2, config: { ...defaultConfig('clock'), fontSize: 26, color: '#64748b', showDate: true, showSeconds: true, background: 'transparent', borderWidth: 0 } },
                { id: genId(), type: 'number', title: '总设备', x: 60, y: 120, width: 220, height: 140, z: 3, config: { ...defaultConfig('number'), label: '设备总数', value: '3,847', unit: '', fontSize: 36, color: '#00bbff' } },
                { id: genId(), type: 'number', title: '在线', x: 320, y: 120, width: 220, height: 140, z: 4, config: { ...defaultConfig('number'), label: '在线设备', value: '3,612', unit: '', fontSize: 36, color: '#00e48c' } },
                { id: genId(), type: 'number', title: '离线', x: 580, y: 120, width: 220, height: 140, z: 5, config: { ...defaultConfig('number'), label: '离线设备', value: '235', unit: '', fontSize: 36, color: '#64748b' } },
                { id: genId(), type: 'number', title: '告警', x: 840, y: 120, width: 220, height: 140, z: 6, config: { ...defaultConfig('number'), label: '当前告警', value: '12', unit: '', fontSize: 36, color: '#ff4757' } },
                { id: genId(), type: 'number', title: '温度', x: 1100, y: 120, width: 240, height: 140, z: 7, config: { ...defaultConfig('number'), label: '平均温度', value: '24.6', unit: '°C', fontSize: 36, color: '#f59e0b' } },
                { id: genId(), type: 'number', title: '湿度', x: 1380, y: 120, width: 240, height: 140, z: 8, config: { ...defaultConfig('number'), label: '平均湿度', value: '62.3', unit: '%', fontSize: 36, color: '#06b6d4' } },
                { id: genId(), type: 'number', title: '功率', x: 1660, y: 120, width: 220, height: 140, z: 9, config: { ...defaultConfig('number'), label: '总功率', value: '847', unit: 'kW', fontSize: 36, color: '#a78bfa' } },
                { id: genId(), type: 'progress', title: '在线率', x: 60, y: 300, width: 440, height: 80, z: 10, config: { ...defaultConfig('progress'), label: '设备在线率', value: 93.9, max: 100, showValue: true } },
                { id: genId(), type: 'progress', title: '负载', x: 60, y: 400, width: 440, height: 80, z: 11, config: { ...defaultConfig('progress'), label: '系统负载', value: 56, max: 100, barColor: '#f59e0b', showValue: true } },
                { id: genId(), type: 'progress', title: '存储', x: 60, y: 500, width: 440, height: 80, z: 12, config: { ...defaultConfig('progress'), label: '数据存储', value: 72, max: 100, barColor: '#a78bfa', showValue: true } },
                { id: genId(), type: 'table', title: '设备列表', x: 540, y: 300, width: 680, height: 360, z: 13, config: { ...defaultConfig('table'), columns: '设备ID,类型,位置,状态,温度,更新时间', data: JSON.stringify([
                    { '设备ID': 'DEV-001', '类型': '温湿度', '位置': 'A区-1F', '状态': '🟢 在线', '温度': '24.5°C', '更新时间': '09:15:02' },
                    { '设备ID': 'DEV-002', '类型': '电力', '位置': 'A区-2F', '状态': '🟢 在线', '温度': '26.1°C', '更新时间': '09:15:01' },
                    { '设备ID': 'DEV-003', '类型': '摄像头', '位置': 'B区-1F', '状态': '🟢 在线', '温度': '-', '更新时间': '09:14:58' },
                    { '设备ID': 'DEV-004', '类型': '温湿度', '位置': 'B区-3F', '状态': '🔴 离线', '温度': '-', '更新时间': '08:42:15' },
                    { '设备ID': 'DEV-005', '类型': '烟感', '位置': 'C区-1F', '状态': '🟢 在线', '温度': '23.8°C', '更新时间': '09:15:00' },
                    { '设备ID': 'DEV-006', '类型': '电力', '位置': 'C区-2F', '状态': '🟡 告警', '温度': '38.2°C', '更新时间': '09:14:55' },
                    { '设备ID': 'DEV-007', '类型': '门禁', '位置': 'A区-大厅', '状态': '🟢 在线', '温度': '-', '更新时间': '09:15:03' }
                ]) } },
                { id: genId(), type: 'log', title: '告警日志', x: 1260, y: 300, width: 600, height: 360, z: 14, config: { ...defaultConfig('log'), fontSize: 11, showTimestamp: true, logs: [
                    { ts: '09:14:55', msg: '🔴 [告警] DEV-006 温度异常: 38.2°C > 阈值35°C' },
                    { ts: '09:10:22', msg: '🟡 [警告] B区-3F 网络延迟升高: 250ms' },
                    { ts: '09:08:15', msg: '🔴 [离线] DEV-004 设备连接断开' },
                    { ts: '09:05:00', msg: '🟢 [恢复] DEV-012 温度恢复正常: 28.5°C' },
                    { ts: '09:02:33', msg: '🟡 [警告] 数据存储使用率超过 70%' },
                    { ts: '08:55:10', msg: '🟢 [信息] 批量固件升级: 12台设备完成' },
                    { ts: '08:50:00', msg: '🟢 [信息] 定时巡检任务启动' }
                ] } },
                { id: genId(), type: 'text', title: '区域', x: 60, y: 620, width: 440, height: 320, z: 15, config: { ...defaultConfig('text'), text: '📍 区域设备分布\n\nA区: 1,245台 (在线 1,198)\nB区:    986台 (在线   941)\nC区:    823台 (在线   795)\nD区:    793台 (在线   678)', fontSize: 15, color: '#e2e8f0', textAlign: 'left' } },
                { id: genId(), type: 'text', title: '概况', x: 540, y: 700, width: 680, height: 240, z: 16, config: { ...defaultConfig('text'), text: '📋 今日设备运维概况\n\n✅ 固件升级: 120台完成 (批次 v2.4.1)\n✅ 巡检完成: A区、B区\n⏳ 待巡检: C区 (预计 10:00)\n⚠️ 待处理工单: 3条\n📊 今日数据采集: 12,456,789 条', fontSize: 14, color: '#94a3b8', textAlign: 'left' } },
                { id: genId(), type: 'table', title: '告警统计', x: 1260, y: 700, width: 600, height: 240, z: 17, config: { ...defaultConfig('table'), columns: '告警级别,今日,本周,状态', data: JSON.stringify([
                    { '告警级别': '🔴 严重', '今日': 2, '本周': 8, '状态': '处理中' },
                    { '告警级别': '🟡 警告', '今日': 5, '本周': 23, '状态': '3条待处理' },
                    { '告警级别': '🔵 提示', '今日': 12, '本周': 67, '状态': '已自动处理' }
                ]) } }
            ]
        })
    },
    {
        id: 'api', icon: '🔌', name: 'API监控', desc: '接口响应时间、成功率、QPS、错误追踪',
        build: () => ({
            dashboard: { name: 'API 服务监控', width: 1920, height: 1080, background: '#06091a', gridSize: 20, showGrid: true },
            widgets: [
                { id: genId(), type: 'text', title: '标题', x: 560, y: 20, width: 800, height: 80, z: 1, config: { ...defaultConfig('text'), text: 'API 服务监控', fontSize: 34, fontWeight: '700', color: '#00bbff', textAlign: 'center', background: 'transparent', borderWidth: 0 } },
                { id: genId(), type: 'clock', title: '时钟', x: 40, y: 30, width: 280, height: 60, z: 2, config: { ...defaultConfig('clock'), fontSize: 26, color: '#64748b', showDate: true, showSeconds: true, background: 'transparent', borderWidth: 0 } },
                { id: genId(), type: 'number', title: 'QPS', x: 60, y: 120, width: 280, height: 160, z: 3, config: { ...defaultConfig('number'), label: '当前 QPS', value: '12,458', unit: '', fontSize: 40, color: '#00bbff' } },
                { id: genId(), type: 'number', title: '成功率', x: 380, y: 120, width: 280, height: 160, z: 4, config: { ...defaultConfig('number'), label: '成功率', value: '99.97', unit: '%', fontSize: 40, color: '#00e48c' } },
                { id: genId(), type: 'number', title: '延迟', x: 700, y: 120, width: 280, height: 160, z: 5, config: { ...defaultConfig('number'), label: 'P99延迟', value: '45', unit: 'ms', fontSize: 40, color: '#f59e0b' } },
                { id: genId(), type: 'number', title: '今日请求', x: 1020, y: 120, width: 280, height: 160, z: 6, config: { ...defaultConfig('number'), label: '今日总请求', value: '8.6M', unit: '', fontSize: 40, color: '#a78bfa' } },
                { id: genId(), type: 'number', title: '错误', x: 1340, y: 120, width: 260, height: 160, z: 7, config: { ...defaultConfig('number'), label: '今日错误', value: '2,581', unit: '', fontSize: 40, color: '#ff4757' } },
                { id: genId(), type: 'number', title: '服务数', x: 1640, y: 120, width: 220, height: 160, z: 8, config: { ...defaultConfig('number'), label: '服务实例', value: '24', unit: '', fontSize: 40, color: '#14b8a6' } },
                { id: genId(), type: 'table', title: '接口排行', x: 60, y: 320, width: 700, height: 360, z: 9, config: { ...defaultConfig('table'), columns: '接口,方法,QPS,P99,成功率,状态', data: JSON.stringify([
                    { '接口': '/api/v1/users', '方法': 'GET', 'QPS': 3200, 'P99': '12ms', '成功率': '99.99%', '状态': '🟢 正常' },
                    { '接口': '/api/v1/orders', '方法': 'POST', 'QPS': 1850, 'P99': '45ms', '成功率': '99.95%', '状态': '🟢 正常' },
                    { '接口': '/api/v1/search', '方法': 'GET', 'QPS': 2400, 'P99': '120ms', '成功率': '99.80%', '状态': '🟡 偏慢' },
                    { '接口': '/api/v1/upload', '方法': 'POST', 'QPS': 450, 'P99': '350ms', '成功率': '99.60%', '状态': '🟡 偏慢' },
                    { '接口': '/api/v1/auth', '方法': 'POST', 'QPS': 1200, 'P99': '25ms', '成功率': '99.98%', '状态': '🟢 正常' },
                    { '接口': '/api/v1/export', '方法': 'GET', 'QPS': 80, 'P99': '2.5s', '成功率': '98.20%', '状态': '🔴 异常' },
                    { '接口': '/api/v1/notify', '方法': 'POST', 'QPS': 620, 'P99': '80ms', '成功率': '99.92%', '状态': '🟢 正常' }
                ]) } },
                { id: genId(), type: 'log', title: '错误日志', x: 800, y: 320, width: 560, height: 360, z: 10, config: { ...defaultConfig('log'), fontSize: 11, showTimestamp: true, logs: [
                    { ts: '09:15:03', msg: '[500] /api/v1/export - TimeoutError: 请求超时 (5000ms)' },
                    { ts: '09:14:22', msg: '[429] /api/v1/search - RateLimit: 超过频率限制' },
                    { ts: '09:12:45', msg: '[500] /api/v1/export - DB连接池耗尽' },
                    { ts: '09:10:18', msg: '[502] /api/v1/notify - 上游服务不可达' },
                    { ts: '09:08:01', msg: '[400] /api/v1/orders - JSON解析错误' },
                    { ts: '09:05:33', msg: '[500] /api/v1/export - OOM: 内存不足' },
                    { ts: '09:02:15', msg: '[503] /api/v1/upload - 存储服务维护中' }
                ] } },
                { id: genId(), type: 'table', title: '服务实例', x: 1400, y: 320, width: 460, height: 360, z: 11, config: { ...defaultConfig('table'), columns: '实例,CPU,内存,连接数,状态', data: JSON.stringify([
                    { '实例': 'api-01', 'CPU': '32%', '内存': '68%', '连接数': 1240, '状态': '🟢' },
                    { '实例': 'api-02', 'CPU': '45%', '内存': '72%', '连接数': 1380, '状态': '🟢' },
                    { '实例': 'api-03', 'CPU': '28%', '内存': '55%', '连接数': 980, '状态': '🟢' },
                    { '实例': 'api-04', 'CPU': '78%', '内存': '85%', '连接数': 1850, '状态': '🟡' },
                    { '实例': 'api-05', 'CPU': '15%', '内存': '42%', '连接数': 620, '状态': '🟢' },
                    { '实例': 'api-06', 'CPU': '22%', '内存': '51%', '连接数': 840, '状态': '🟢' }
                ]) } },
                { id: genId(), type: 'progress', title: '容量', x: 60, y: 720, width: 440, height: 80, z: 12, config: { ...defaultConfig('progress'), label: '整体负载容量', value: 62, max: 100, showValue: true } },
                { id: genId(), type: 'progress', title: 'SLA', x: 60, y: 820, width: 440, height: 80, z: 13, config: { ...defaultConfig('progress'), label: '月度SLA达成', value: 99.95, max: 100, barColor: '#00e48c', showValue: true } },
                { id: genId(), type: 'text', title: '摘要', x: 540, y: 720, width: 700, height: 220, z: 14, config: { ...defaultConfig('text'), text: '📋 服务健康摘要\n\n✅ 核心服务: 6/6 在线\n⚠️ /api/v1/export 响应超时频繁，建议扩容\n⚠️ api-04 实例负载较高 (CPU 78%, 内存 85%)\n📊 今日峰值QPS: 18,200 (10:30)\n🎯 月度可用性: 99.95% (目标 99.9%)', fontSize: 14, color: '#e2e8f0', textAlign: 'left' } },
                { id: genId(), type: 'text', title: '变更', x: 1280, y: 720, width: 580, height: 220, z: 15, config: { ...defaultConfig('text'), text: '🚀 近期变更\n\n09:00 api-v2.1.3 灰度发布 (api-01, api-02)\n08:30 缓存策略优化上线\n昨日  数据库索引优化完成\n前日  CDN节点扩容 (+3节点)', fontSize: 14, color: '#94a3b8', textAlign: 'left' } }
            ]
        })
    }
];

function showTemplates() {
    let modal = document.getElementById('tplModal');
    if (modal) { modal.style.display = ''; return; }
    modal = document.createElement('div');
    modal.id = 'tplModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="modal tpl-modal"><h3>选择预制模板</h3><p style="font-size:12px;color:var(--text-dim);margin-bottom:12px">选择模板将替换当前画布内容</p><div class="tpl-grid">${
        TEMPLATES.map(t => `<div class="tpl-card" onclick="applyTemplate('${t.id}')"><div class="tpl-icon">${t.icon}</div><div class="tpl-name">${t.name}</div><div class="tpl-desc">${t.desc}</div></div>`).join('')
    }</div><div class="modal-actions" style="margin-top:16px;justify-content:flex-end"><button class="btn-cancel" onclick="document.getElementById('tplModal').style.display='none'">取消</button></div></div>`;
    document.body.appendChild(modal);
}

function applyTemplate(id) {
    const tpl = TEMPLATES.find(t => t.id === id);
    if (!tpl) return;
    if (state.widgets.length > 0 && !confirm('应用模板将替换当前所有组件，确定继续？')) return;
    const cfg = tpl.build();
    loadConfig(cfg);
    document.getElementById('tplModal').style.display = 'none';
}

// ==================== Dashboard Name ====================
document.getElementById('dashboardName').addEventListener('change', e => {
    state.dashboard.name = e.target.value || '监控大屏';
    save();
});

// ==================== Init ====================
function init() {
    load();
    document.getElementById('dashboardName').value = state.dashboard.name;
    document.getElementById('gridToggle').checked = state.dashboard.showGrid;
    document.getElementById('themeSelect').value = state.dashboard.theme || 'tech';
    updateDashSizeSelect();
    renderWidgetPalette();
    updateCanvasScale();
    renderAllWidgets();
    renderPropsPanel();
    startAllDataSources();
    window.addEventListener('resize', () => updateCanvasScale());
}

init();

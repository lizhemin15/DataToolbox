/**
 * 低代码开发编辑器 - 线性堆叠模式
 * 模块从上到下顺序执行，数据通过隐式上下文自动传递
 */

/* ==================== 常量 ==================== */
const CAT_COLORS = { file: '#2196F3', excel: '#4CAF50', word: '#9C27B0', data: '#FF9800', ui: '#E91E63' };

const MODULE_CATS = [
    { id: 'all', name: '全部', icon: '' },
    { id: 'file', name: '文件', icon: '📁' },
    { id: 'excel', name: 'Excel', icon: '📊' },
    { id: 'word', name: 'Word', icon: '📝' },
    { id: 'data', name: '数据', icon: '🔄' },
    { id: 'ui', name: '交互', icon: '🖥️' }
];

/* ==================== 模块定义 ====================
 * 每个模块的 compile(block, ctx, idx) 返回:
 *   html  - 编译到目标HTML的界面部分
 *   runJs - 编译到 run() 函数体内的JS代码
 *   ctx   - 执行后更新的上下文变量 { file, data, headers, rows, doc, value }
 * ctx 在模块间隐式传递，后面的模块自动使用前面最近的同类型输出
 */
const MODS = {
    'file.upload': {
        name: '文件上传', icon: '📁', cat: 'file',
        desc: '上传本地文件供后续处理',
        config: [
            { name: 'label', label: '标签文字', type: 'text', default: '上传文件' },
            { name: 'accept', label: '文件类型', type: 'text', default: '.xlsx,.xls,.csv' }
        ],
        libs: [],
        compile(b, ctx, i) {
            return {
                html: `<div class="fg"><label>${b.config.label || '上传文件'}</label><div class="upload-box"><input type="file" id="fu${i}" accept="${b.config.accept || '.xlsx,.xls,.csv'}"></div></div>`,
                runJs: `const v${i}_file=document.getElementById('fu${i}').files[0];\n  if(!v${i}_file){alert('请先上传文件');return;}`,
                ctx: { file: `v${i}_file` }
            };
        }
    },
    'file.download': {
        name: '文件下载', icon: '💾', cat: 'file',
        desc: '将当前数据下载为Excel文件',
        config: [
            { name: 'filename', label: '文件名', type: 'text', default: '导出数据.xlsx' }
        ],
        libs: ['xlsx'],
        compile(b, ctx, i) {
            return {
                runJs: `_writeExcel(${ctx.data || '[]'},'${b.config.filename || '导出数据.xlsx'}');`,
                ctx: {}
            };
        }
    },
    'excel.read': {
        name: '读取Excel', icon: '📖', cat: 'excel',
        desc: '读取上传的Excel文件，获取数据',
        config: [],
        libs: ['xlsx'],
        compile(b, ctx, i) {
            return {
                runJs: `const v${i}_r=await _readExcel(${ctx.file || 'null'});\n  const v${i}_data=v${i}_r.raw,v${i}_headers=v${i}_r.headers,v${i}_rows=v${i}_r.rows;`,
                ctx: { data: `v${i}_data`, headers: `v${i}_headers`, rows: `v${i}_rows` }
            };
        }
    },
    'excel.write': {
        name: '导出Excel', icon: '📤', cat: 'excel',
        desc: '将当前数据导出为Excel文件',
        config: [
            { name: 'filename', label: '文件名', type: 'text', default: '导出数据.xlsx' }
        ],
        libs: ['xlsx'],
        compile(b, ctx, i) {
            return {
                runJs: `_writeExcel(${ctx.data || '[]'},'${b.config.filename || '导出数据.xlsx'}');`,
                ctx: {}
            };
        }
    },
    'excel.filter': {
        name: '筛选数据', icon: '🔍', cat: 'excel',
        desc: '按条件筛选数据行',
        config: [
            { name: 'column', label: '列索引(从0开始)', type: 'text', default: '0' },
            {
                name: 'operator', label: '条件', type: 'select', default: 'includes', options: [
                    { value: 'includes', label: '包含' }, { value: 'equals', label: '等于' },
                    { value: 'gt', label: '大于' }, { value: 'lt', label: '小于' }
                ]
            },
            { name: 'value', label: '比较值', type: 'text', default: '', hint: '输入 $value 可引用上方表单输入的值' }
        ],
        libs: [],
        compile(b, ctx, i) {
            const col = b.config.column || '0';
            const op = b.config.operator || 'includes';
            let valExpr;
            if (b.config.value === '$value' && ctx.value) {
                valExpr = ctx.value;
            } else {
                valExpr = `'${b.config.value || ''}'`;
            }
            let cond;
            if (op === 'includes') cond = `String(c).includes(String(${valExpr}))`;
            else if (op === 'equals') cond = `String(c)===String(${valExpr})`;
            else if (op === 'gt') cond = `Number(c)>Number(${valExpr})`;
            else cond = `Number(c)<Number(${valExpr})`;
            return {
                runJs: `const v${i}_data=(function(){const d=${ctx.data || '[]'};if(d.length<2)return d;const ci=${col};return[d[0],...d.slice(1).filter(r=>{const c=r[ci]||'';return ${cond};})];})();`,
                ctx: { data: `v${i}_data` }
            };
        }
    },
    'excel.sort': {
        name: '排序数据', icon: '↕️', cat: 'excel',
        desc: '按指定列排序数据',
        config: [
            { name: 'column', label: '列索引(从0开始)', type: 'text', default: '0' },
            {
                name: 'order', label: '排序方向', type: 'select', default: 'asc', options: [
                    { value: 'asc', label: '升序' }, { value: 'desc', label: '降序' }
                ]
            }
        ],
        libs: [],
        compile(b, ctx, i) {
            const col = b.config.column || '0';
            const desc = b.config.order === 'desc';
            return {
                runJs: `const v${i}_data=(function(){const d=${ctx.data || '[]'};if(d.length<2)return d;const ci=${col},rows=[...d.slice(1)];rows.sort((a,b)=>{const va=a[ci]||'',vb=b[ci]||'';return ${desc ? "String(vb).localeCompare(String(va),'zh-CN')" : "String(va).localeCompare(String(vb),'zh-CN')"};});return[d[0],...rows];})();`,
                ctx: { data: `v${i}_data` }
            };
        }
    },
    'word.create': {
        name: '创建文档', icon: '📄', cat: 'word',
        desc: '创建一个新的Word文档对象',
        config: [],
        libs: ['docx'],
        compile(b, ctx, i) {
            return { runJs: `const v${i}_doc={paragraphs:[],tables:[]};`, ctx: { doc: `v${i}_doc` } };
        }
    },
    'word.addParagraph': {
        name: '添加段落', icon: '📝', cat: 'word',
        desc: '向文档中添加一段文字',
        config: [
            { name: 'text', label: '段落文本', type: 'textarea', default: '' }
        ],
        libs: ['docx'],
        compile(b, ctx, i) {
            const docVar = ctx.doc || '_doc';
            const text = ctx.value ? ctx.value : `'${(b.config.text || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
            return { runJs: `${docVar}.paragraphs.push(${text});const v${i}_doc=${docVar};`, ctx: { doc: `v${i}_doc` } };
        }
    },
    'word.save': {
        name: '保存文档', icon: '💾', cat: 'word',
        desc: '将文档保存为.docx文件',
        config: [
            { name: 'filename', label: '文件名', type: 'text', default: '文档.docx' }
        ],
        libs: ['docx'],
        compile(b, ctx, i) {
            return { runJs: `await _saveWord(${ctx.doc || '_doc'},'${b.config.filename || '文档.docx'}');`, ctx: {} };
        }
    },
    'data.transform': {
        name: '数据映射', icon: '🔄', cat: 'data',
        desc: '对每行数据执行自定义转换',
        config: [
            { name: 'expression', label: '映射表达式 (row为每行数组)', type: 'textarea', default: 'row' },
            {
                name: 'keepHeader', label: '保留表头', type: 'select', default: 'yes', options: [
                    { value: 'yes', label: '是' }, { value: 'no', label: '否' }
                ]
            }
        ],
        libs: [],
        compile(b, ctx, i) {
            const expr = b.config.expression || 'row';
            const kh = b.config.keepHeader !== 'no';
            return {
                runJs: kh
                    ? `const v${i}_data=(function(){const d=${ctx.data || '[]'};if(!d.length)return d;return[d[0],...d.slice(1).map(row=>(${expr}))];})();`
                    : `const v${i}_data=(${ctx.data || '[]'}).map(row=>(${expr}));`,
                ctx: { data: `v${i}_data` }
            };
        }
    },
    'data.merge': {
        name: '合并数据', icon: '🔗', cat: 'data',
        desc: '上传第二个文件并与当前数据合并',
        config: [
            { name: 'label', label: '第二个文件标签', type: 'text', default: '上传第二个文件' },
            {
                name: 'mode', label: '合并方式', type: 'select', default: 'append', options: [
                    { value: 'append', label: '上下拼接(去第二表头)' }, { value: 'concat', label: '直接拼接' }
                ]
            }
        ],
        libs: ['xlsx'],
        compile(b, ctx, i) {
            const mode = b.config.mode || 'append';
            return {
                html: `<div class="fg"><label>${b.config.label || '上传第二个文件'}</label><div class="upload-box"><input type="file" id="fu2_${i}" accept=".xlsx,.xls,.csv"></div></div>`,
                runJs: `const v${i}_f2=document.getElementById('fu2_${i}').files[0];\n  let v${i}_d2=[];\n  if(v${i}_f2){const r2=await _readExcel(v${i}_f2);v${i}_d2=r2.raw;}\n  const v${i}_data=${mode === 'concat' ? `[...${ctx.data || '[]'},...v${i}_d2]` : `[...${ctx.data || '[]'},...v${i}_d2.slice(1)]`};`,
                ctx: { data: `v${i}_data` }
            };
        }
    },
    'data.dedup': {
        name: '数据去重', icon: '🧹', cat: 'data',
        desc: '按指定列去除重复行',
        config: [
            { name: 'column', label: '去重列索引(从0开始)', type: 'text', default: '0' }
        ],
        libs: [],
        compile(b, ctx, i) {
            const col = b.config.column || '0';
            return {
                runJs: `const v${i}_data=(function(){const d=${ctx.data || '[]'};if(d.length<2)return d;const seen=new Set(),res=[];d.slice(1).forEach(r=>{const k=String(r[${col}]||'');if(!seen.has(k)){seen.add(k);res.push(r);}});return[d[0],...res];})();`,
                ctx: { data: `v${i}_data` }
            };
        }
    },
    'ui.formInput': {
        name: '表单输入', icon: '📋', cat: 'ui',
        desc: '让用户输入一个值',
        config: [
            { name: 'label', label: '标签', type: 'text', default: '请输入' },
            {
                name: 'inputType', label: '输入类型', type: 'select', default: 'text', options: [
                    { value: 'text', label: '文本' }, { value: 'number', label: '数字' },
                    { value: 'date', label: '日期' }, { value: 'textarea', label: '多行文本' }
                ]
            },
            { name: 'placeholder', label: '提示文字', type: 'text', default: '' },
            { name: 'defaultValue', label: '默认值', type: 'text', default: '' }
        ],
        libs: [],
        compile(b, ctx, i) {
            const c = b.config;
            const tag = c.inputType === 'textarea'
                ? `<textarea id="inp${i}" placeholder="${c.placeholder || ''}">${c.defaultValue || ''}</textarea>`
                : `<input type="${c.inputType || 'text'}" id="inp${i}" placeholder="${c.placeholder || ''}" value="${c.defaultValue || ''}">`;
            return {
                html: `<div class="fg"><label>${c.label || '请输入'}</label>${tag}</div>`,
                runJs: `const v${i}_value=document.getElementById('inp${i}').value;`,
                ctx: { value: `v${i}_value` }
            };
        }
    },
    'ui.button': {
        name: '执行按钮', icon: '▶️', cat: 'ui',
        desc: '点击后触发流程执行',
        config: [
            { name: 'label', label: '按钮文字', type: 'text', default: '执行' }
        ],
        libs: [],
        compile(b, ctx, i) {
            return {
                html: `<button class="run-btn" onclick="run()">${b.config.label || '执行'}</button>`,
                ctx: {}
            };
        }
    },
    'ui.table': {
        name: '数据表格', icon: '📊', cat: 'ui',
        desc: '以表格形式展示当前数据',
        config: [],
        libs: [],
        compile(b, ctx, i) {
            return {
                html: `<div id="tbl${i}" class="tbl-box"></div>`,
                runJs: `_displayTable(${ctx.data || '[]'},'#tbl${i}');`,
                ctx: {}
            };
        }
    },
    'ui.text': {
        name: '文本显示', icon: '📄', cat: 'ui',
        desc: '显示一段文本内容',
        config: [
            { name: 'prefix', label: '前缀文字', type: 'text', default: '' }
        ],
        libs: [],
        compile(b, ctx, i) {
            const src = ctx.value || "''";
            const prefix = b.config.prefix ? `'${b.config.prefix}'+` : '';
            return {
                html: `<div id="txt${i}" class="txt-box"></div>`,
                runJs: `document.getElementById('txt${i}').textContent=${prefix}String(${src});`,
                ctx: {}
            };
        }
    }
};

/* ==================== 状态 ==================== */
let project = { name: '未命名项目', icon: '🧩', description: '', blocks: [] };
let activeCat = 'all';

/* ==================== 初始化 ==================== */
document.addEventListener('DOMContentLoaded', () => {
    const fp = document.getElementById('flowPanel');
    const fd = document.getElementById('flowDrop');
    fp.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; fd.classList.add('drag-over'); });
    fp.addEventListener('dragleave', e => { if (!fp.contains(e.relatedTarget)) fd.classList.remove('drag-over'); });
    fp.addEventListener('drop', onFlowDrop);
    showWelcome();
});

/* ==================== 页面切换 ==================== */
function showWelcome() {
    document.getElementById('welcomeScreen').style.display = '';
    document.getElementById('editorScreen').style.display = 'none';
}
function showEditor() {
    document.getElementById('welcomeScreen').style.display = 'none';
    document.getElementById('editorScreen').style.display = '';
    document.getElementById('projectNameInput').value = project.name;
    renderPalette();
    renderFlow();
}
function createNewProject() {
    project = { name: '未命名项目', icon: '🧩', description: '', blocks: [] };
    showEditor();
}
function openExistingProject() {
    const input = document.getElementById('jsonFileInput');
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try { project = JSON.parse(ev.target.result); showEditor(); }
            catch (err) { alert('JSON格式错误: ' + err.message); }
        };
        reader.readAsText(file);
        input.value = '';
    };
    input.click();
}
function backToWelcome() {
    if (project.blocks.length > 0 && !confirm('返回将丢失未保存的更改，确定吗？')) return;
    showWelcome();
}

/* ==================== 模块面板 ==================== */
function renderPalette() {
    document.getElementById('paletteTabs').innerHTML = MODULE_CATS.map(c =>
        `<button class="palette-tab${activeCat === c.id ? ' active' : ''}" onclick="switchCat('${c.id}')">${c.icon ? c.icon + ' ' : ''}${c.name}</button>`
    ).join('');
    filterPalette();
}
function switchCat(id) { activeCat = id; renderPalette(); }
function filterPalette() {
    const q = (document.getElementById('paletteSearch').value || '').toLowerCase();
    const el = document.getElementById('paletteModules');
    let html = '';
    const cats = activeCat === 'all' ? MODULE_CATS.filter(c => c.id !== 'all') : MODULE_CATS.filter(c => c.id === activeCat);
    cats.forEach(cat => {
        const items = Object.entries(MODS).filter(([, m]) => m.cat === cat.id && (!q || m.name.toLowerCase().includes(q)));
        if (!items.length) return;
        html += `<div class="palette-category-label">${cat.icon || ''} ${cat.name}</div>`;
        items.forEach(([id, m]) => {
            html += `<div class="palette-module" draggable="true" data-module-id="${id}">
                <span class="mod-icon">${m.icon}</span><span class="mod-name">${m.name}</span>
                <span class="mod-color" style="background:${CAT_COLORS[m.cat]}"></span></div>`;
        });
    });
    el.innerHTML = html;
    el.querySelectorAll('.palette-module').forEach(el => {
        el.addEventListener('dragstart', e => {
            e.dataTransfer.setData('moduleId', el.dataset.moduleId);
            e.dataTransfer.effectAllowed = 'copy';
        });
    });
}

/* ==================== 流程列表渲染 ==================== */
function renderFlow() {
    const list = document.getElementById('flowList');
    if (!project.blocks.length) {
        list.innerHTML = '<div class="flow-empty">从左侧拖入模块开始构建</div>';
        document.getElementById('flowDrop').style.display = '';
        return;
    }
    let html = '';
    project.blocks.forEach((block, idx) => {
        const mod = MODS[block.moduleId];
        if (!mod) return;
        const color = CAT_COLORS[mod.cat] || '#667eea';
        const summary = getConfigSummary(block);

        if (idx > 0) {
            html += `<div class="flow-arrow"><svg width="16" height="14" viewBox="0 0 16 14"><path d="M8 1v10M4 8l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
        }

        html += `<div class="flow-block" data-id="${block.id}" ondblclick="openEditModal('${block.id}')">`;
        html += `<div class="fb-header" style="border-left-color:${color}">`;
        html += `<span class="fb-icon">${mod.icon}</span><span class="fb-name">${mod.name}</span>`;
        html += `<span class="fb-summary">${summary}</span>`;
        html += `<span class="fb-step">#${idx + 1}</span>`;
        html += `<div class="fb-actions">`;
        if (idx > 0) html += `<button class="fb-btn" onclick="event.stopPropagation();moveBlock('${block.id}',-1)" title="上移">↑</button>`;
        if (idx < project.blocks.length - 1) html += `<button class="fb-btn" onclick="event.stopPropagation();moveBlock('${block.id}',1)" title="下移">↓</button>`;
        html += `<button class="fb-btn delete" onclick="event.stopPropagation();removeBlock('${block.id}')" title="删除">×</button>`;
        html += `</div></div></div>`;
    });
    list.innerHTML = html;
    document.getElementById('flowDrop').style.display = '';
}

function getConfigSummary(block) {
    const mod = MODS[block.moduleId];
    if (!mod || !mod.config || !mod.config.length) return '';
    const parts = [];
    mod.config.forEach(cfg => {
        const val = block.config[cfg.name];
        if (val === undefined || val === '' || val === cfg.default) return;
        if (cfg.type === 'select' && cfg.options) {
            const opt = cfg.options.find(o => o.value === val);
            parts.push(opt ? opt.label : val);
        } else if (cfg.type === 'textarea') {
            const short = String(val).replace(/\n/g, ' ').substring(0, 20);
            parts.push(short + (val.length > 20 ? '...' : ''));
        } else {
            parts.push(String(val).substring(0, 16));
        }
    });
    return parts.length ? parts.join(' · ') : '';
}

/* ==================== 模块编辑弹窗 ==================== */
let editingBlockId = null;

function openEditModal(blockId) {
    const block = project.blocks.find(b => b.id === blockId);
    if (!block) return;
    editingBlockId = blockId;
    const mod = MODS[block.moduleId];
    const color = CAT_COLORS[mod.cat] || '#667eea';

    document.getElementById('editModalTitle').innerHTML = `<span style="color:${color}">${mod.icon}</span> ${mod.name}`;

    let html = '';
    if (mod.desc) html += `<div class="edit-desc">${mod.desc}</div>`;

    if (!mod.config || !mod.config.length) {
        html += '<div class="edit-noconfig">此模块无需配置</div>';
    } else {
        mod.config.forEach(cfg => {
            const val = block.config[cfg.name] ?? cfg.default ?? '';
            html += `<div class="edit-field"><label>${cfg.label}</label>`;
            if (cfg.type === 'select') {
                html += `<select onchange="updateCfg('${block.id}','${cfg.name}',this.value)">`;
                cfg.options.forEach(o => { html += `<option value="${o.value}"${val === o.value ? ' selected' : ''}>${o.label}</option>`; });
                html += '</select>';
            } else if (cfg.type === 'textarea') {
                html += `<textarea oninput="updateCfg('${block.id}','${cfg.name}',this.value)">${val}</textarea>`;
            } else {
                html += `<input type="${cfg.type || 'text'}" value="${String(val).replace(/"/g, '&quot;')}" oninput="updateCfg('${block.id}','${cfg.name}',this.value)">`;
            }
            if (cfg.hint) html += `<div class="edit-hint">${cfg.hint}</div>`;
            html += '</div>';
        });
    }
    document.getElementById('editModalBody').innerHTML = html;
    document.getElementById('editModal').style.display = '';
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
    editingBlockId = null;
    renderFlow();
}

/* ==================== 块操作 ==================== */
function onFlowDrop(e) {
    e.preventDefault();
    document.getElementById('flowDrop').classList.remove('drag-over');
    const moduleId = e.dataTransfer.getData('moduleId');
    if (!moduleId || !MODS[moduleId]) return;
    addBlock(moduleId);
}

function addBlock(moduleId) {
    const mod = MODS[moduleId];
    const block = { id: 'b' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4), moduleId, config: {} };
    if (mod.config) mod.config.forEach(c => { block.config[c.name] = c.default ?? ''; });
    project.blocks.push(block);
    renderFlow();
    // 滚动到底部
    const fp = document.getElementById('flowPanel');
    setTimeout(() => fp.scrollTop = fp.scrollHeight, 50);
}

function removeBlock(id) {
    project.blocks = project.blocks.filter(b => b.id !== id);
    renderFlow();
}

function moveBlock(id, dir) {
    const idx = project.blocks.findIndex(b => b.id === id);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= project.blocks.length) return;
    const tmp = project.blocks[idx];
    project.blocks[idx] = project.blocks[newIdx];
    project.blocks[newIdx] = tmp;
    renderFlow();
}

function updateCfg(blockId, key, value) {
    const block = project.blocks.find(b => b.id === blockId);
    if (block) block.config[key] = value;
}

/* ==================== 保存 ==================== */
function saveProject() {
    project.name = document.getElementById('projectNameInput').value || '未命名项目';
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = project.name + '.json'; a.click();
    URL.revokeObjectURL(url);
}

/* ==================== 编译 ==================== */
function compileProject() {
    project.name = document.getElementById('projectNameInput').value || '未命名项目';
    if (!project.blocks.length) { alert('项目为空，请先添加模块'); return; }

    const needLibs = new Set();
    project.blocks.forEach(b => { const m = MODS[b.moduleId]; if (m && m.libs) m.libs.forEach(l => needLibs.add(l)); });

    const htmlParts = [], runJsParts = [];
    const ctx = { file: null, data: null, headers: null, rows: null, doc: null, value: null };
    let hasButton = false;

    project.blocks.forEach((block, idx) => {
        const mod = MODS[block.moduleId];
        if (!mod) return;
        const res = mod.compile(block, { ...ctx }, idx);
        if (res.html) htmlParts.push(res.html);
        if (res.runJs) runJsParts.push('  // #' + (idx + 1) + ' ' + mod.name + '\n  ' + res.runJs);
        if (block.moduleId === 'ui.button') hasButton = true;
        if (res.ctx) Object.entries(res.ctx).forEach(([k, v]) => { if (v) ctx[k] = v; });
    });

    // 辅助函数
    let helpers = '';
    if (needLibs.has('xlsx')) {
        helpers += `async function _readExcel(file){return new Promise((ok,no)=>{const r=new FileReader();r.onload=e=>{const wb=XLSX.read(e.target.result,{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];const d=XLSX.utils.sheet_to_json(ws,{header:1});ok({headers:d[0]||[],rows:d.slice(1),raw:d});};r.onerror=no;r.readAsArrayBuffer(file);})}\nfunction _writeExcel(data,fn){const ws=XLSX.utils.aoa_to_sheet(data);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Sheet1');XLSX.writeFile(wb,fn);}`;
    }
    if (needLibs.has('docx')) {
        helpers += `\nasync function _saveWord(doc,fn){const{Document:D,Paragraph:P,Packer}=docx;const ch=[];doc.paragraphs.forEach(t=>ch.push(new P({text:String(t)})));const d=new D({sections:[{children:ch}]});const blob=await Packer.toBlob(d);const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=fn;a.click();URL.revokeObjectURL(u);}`;
    }
    helpers += `\nfunction _displayTable(data,sel){const c=document.querySelector(sel);if(!data||!data.length){c.innerHTML='<p style=\"color:rgba(255,255,255,.5)\">无数据</p>';return;}let h='<table><thead><tr>';const hdr=data[0];hdr.forEach(v=>h+='<th>'+(v??'')+'</th>');h+='</tr></thead><tbody>';data.slice(1).forEach(r=>{h+='<tr>';for(let i=0;i<hdr.length;i++)h+='<td>'+(r[i]??'')+'</td>';h+='</tr>';});h+='</tbody></table>';c.innerHTML=h;}`;

    let libTags = '';
    if (needLibs.has('xlsx')) libTags += '    <script src="../../lib/xlsx.full.min.js"><\/script>\n';
    if (needLibs.has('docx')) libTags += '    <script src="../../lib/docx.iife.js"><\/script>\n';

    const compiled = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(project.name)} - 数据工具箱</title>
    <style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;}
.container{max-width:900px;margin:0 auto;padding:20px;}
.header{display:flex;align-items:center;gap:16px;margin-bottom:24px;}
.back-btn{background:rgba(255,255,255,.15);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.2);padding:10px 20px;border-radius:10px;font-size:14px;color:#fff;cursor:pointer;transition:all .2s;}
.back-btn:hover{background:rgba(255,255,255,.25);}
h1{color:#fff;font-size:28px;font-weight:600;}
.content{background:rgba(255,255,255,.1);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.2);border-radius:16px;padding:32px;}
.fg{margin-bottom:18px;}
.fg label{display:block;color:rgba(255,255,255,.8);font-size:14px;margin-bottom:6px;font-weight:500;}
.fg input,.fg textarea,.fg select{width:100%;padding:10px 14px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:8px;color:#fff;font-size:14px;outline:none;font-family:inherit;}
.fg input:focus,.fg textarea:focus{border-color:rgba(255,255,255,.4);}
.fg textarea{min-height:80px;resize:vertical;}
.upload-box input[type=file]{color:rgba(255,255,255,.7);font-size:14px;}
.run-btn{display:inline-block;padding:12px 32px;background:#667eea;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;margin:12px 0;transition:all .2s;}
.run-btn:hover{background:#5a6fd6;transform:translateY(-1px);}
.tbl-box{margin:16px 0;overflow-x:auto;border-radius:8px;}
.tbl-box table{width:100%;border-collapse:collapse;font-size:13px;}
.tbl-box th,.tbl-box td{padding:8px 12px;border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.85);text-align:left;}
.tbl-box th{background:rgba(255,255,255,.1);font-weight:600;}
.tbl-box tr:hover td{background:rgba(255,255,255,.05);}
.txt-box{padding:12px 16px;background:rgba(255,255,255,.06);border-radius:8px;color:rgba(255,255,255,.85);font-size:14px;margin:12px 0;line-height:1.6;}
.footer{margin-top:40px;text-align:center;}.footer p{color:rgba(255,255,255,.5);font-size:13px;}
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <button class="back-btn" onclick="window.location.href='../../index.html'">← 返回</button>
            <h1>${esc(project.icon || '🧩')} ${esc(project.name)}</h1>
        </header>
        <main class="content">
${htmlParts.join('\n')}
${!hasButton ? '            <button class="run-btn" onclick="run()">▶ 执行</button>' : ''}
        </main>
        <footer class="footer"><p>由低代码开发工具生成</p></footer>
    </div>
${libTags}    <script>
${helpers}
async function run(){
  try{
${runJsParts.join('\n')}
  }catch(err){alert('执行出错: '+err.message);console.error(err);}
}
    <\/script>
</body>
</html>`;

    showCompileResult(compiled);
}

function showCompileResult(html) {
    const pid = (project.name || 'app').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '');
    const entry = JSON.stringify({ id: pid, name: project.name, icon: project.icon || '🧩', description: project.description || '由低代码工具生成', keywords: ['低代码', '自动生成'] }, null, 4);
    const jsEntry = JSON.stringify({ id: pid, name: project.name, icon: project.icon || '🧩', description: project.description || '由低代码工具生成', keywords: ['低代码', '自动生成'], category: 'tool' }, null, 4);

    document.getElementById('compileModalBody').innerHTML = `
        <div class="compile-section"><h4>编译成功</h4>
            <button class="compile-btn primary" onclick="downloadCompiled()">下载 HTML 文件</button>
            <button class="compile-btn secondary" onclick="previewCompiled()">预览运行</button></div>
        <div class="compile-section"><h4>添加到应用商店</h4>
            <div class="compile-info">
                <strong>步骤：</strong><br>
                1. 在 <code>apps/</code> 下创建文件夹: <code>apps/${pid}/</code><br>
                2. 将下载的 HTML 重命名为 <code>index.html</code> 放入<br>
                3. 在 <code>apps/apps.json</code> 数组中添加下方条目<br>
                4. 在 <code>apps/apps.js</code> 的 <code>appsData</code> 数组中添加下方条目</div></div>
        <div class="compile-section"><h4>apps.json 条目</h4><div class="compile-code">${escHtml(entry)}</div></div>
        <div class="compile-section"><h4>apps.js 条目</h4><div class="compile-code">${escHtml(jsEntry)}</div></div>`;

    window._compiledHtml = html;
    document.getElementById('compileModal').style.display = '';
}

function downloadCompiled() {
    if (!window._compiledHtml) return;
    const blob = new Blob([window._compiledHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = (project.name || '应用') + '.html'; a.click();
    URL.revokeObjectURL(url);
}
function previewCompiled() {
    if (!window._compiledHtml) return;
    const w = window.open('', '_blank'); w.document.write(window._compiledHtml); w.document.close();
}
function closeCompileModal() { document.getElementById('compileModal').style.display = 'none'; }

/* ==================== 工具 ==================== */
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

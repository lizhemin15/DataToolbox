// 低代码可视化开发平台
let app = {
    name: '未命名应用',
    components: [],
    variables: [],
    layout: {
        gap: 12
    },
    savedTime: null
};

let selectedComponent = null;
let zoom = 100;

// 消息提示函数
function showMessage(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️',
        warning: '⚠️'
    };
    
    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || icons.info}</div>
        <div class="toast-content">${message}</div>
        <button class="toast-close" onclick="this.parentElement.remove()">×</button>
    `;
    
    container.appendChild(toast);
    
    // 触发动画
    setTimeout(() => toast.classList.add('show'), 10);
    
    // 自动消失
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// AI 配置
let aiConfig = {
    apiUrl: '',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.7
};

// 从localStorage加载AI配置
function loadAIConfig() {
    const saved = localStorage.getItem('lowcode_ai_config');
    if (saved) {
        try {
            aiConfig = { ...aiConfig, ...JSON.parse(saved) };
        } catch (e) {
            console.error('加载AI配置失败', e);
        }
    }
}

// 保存AI配置到localStorage
function saveAIConfigToStorage() {
    localStorage.setItem('lowcode_ai_config', JSON.stringify(aiConfig));
}

// 组件定义
const COMPONENTS = {
    input: {
        type: 'input',
        category: 'all',
        icon: '📝',
        name: '输入',
        desc: '可配置多种输入类型',
        defaultProps: {
            label: '输入框',
            varName: 'input1',
            inputType: 'text', // text | textarea | number | date
            placeholder: '请输入',
            value: '',
            rows: 3,
            min: 0,
            max: 100,
            width: '100%'
        }
    },
    choice: {
        type: 'choice',
        category: 'all',
        icon: '🔽',
        name: '选择',
        desc: '可配置多种选择类型',
        defaultProps: {
            label: '选择框',
            varName: 'choice1',
            choiceType: 'select', // select | checkbox | radio
            options: '选项1\n选项2\n选项3',
            value: '',
            width: '100%'
        }
    },
    button: {
        type: 'button',
        category: 'all',
        icon: '🔘',
        name: '按钮',
        desc: '操作按钮',
        defaultProps: {
            text: '提交',
            variant: 'primary',
            width: '100%'
        }
    },
    fileUpload: {
        type: 'fileUpload',
        category: 'all',
        icon: '📎',
        name: '文件上传',
        desc: '上传文件（支持拖拽）',
        defaultProps: {
            label: '上传文件',
            varName: 'file1',
            accept: '',
            multiple: false,
            showFileName: true,
            width: '100%'
        }
    },
    display: {
        type: 'display',
        category: 'all',
        icon: '📺',
        name: '输出显示',
        desc: '显示内容区域（支持动态更新）',
        defaultProps: {
            label: '输出内容',
            varName: 'display1',
            content: '',
            minHeight: '200px',
            maxHeight: '500px',
            showMarkdown: false,
            width: '100%'
        }
    }
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadAIConfig();
    initUI();
    renderComponentList();
    setupEventListeners();
    updateGapDisplay();
});

function initUI() {
    document.getElementById('appNameInput').value = app.name;
    updatePropertyTabs();
}

function renderComponentList() {
    const list = document.getElementById('componentList');
    const searchTerm = document.getElementById('componentSearch').value.toLowerCase();
    
    let html = '';
    Object.entries(COMPONENTS).forEach(([id, comp]) => {
        if (searchTerm && !comp.name.toLowerCase().includes(searchTerm) && 
            !comp.desc.toLowerCase().includes(searchTerm)) return;
        
        html += `
            <div class="component-item" draggable="true" data-comp-type="${id}">
                <div class="component-icon">${comp.icon}</div>
                <div class="component-info">
                    <div class="component-name">${comp.name}</div>
                    <div class="component-desc">${comp.desc}</div>
                </div>
            </div>
        `;
    });
    
    if (!html) {
        html = '<div class="property-empty"><p>未找到组件</p></div>';
    }
    
    list.innerHTML = html;
    
    // 添加拖拽事件
    list.querySelectorAll('.component-item').forEach(el => {
        el.addEventListener('dragstart', onComponentDragStart);
    });
}

function setupEventListeners() {
    // 搜索
    document.getElementById('componentSearch').addEventListener('input', renderComponentList);
    
    // 属性面板标签切换
    document.querySelectorAll('.property-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.property-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderPropertyPanel();
        });
    });
    
    // 应用名称变化
    document.getElementById('appNameInput').addEventListener('input', (e) => {
        app.name = e.target.value;
        markUnsaved();
    });
}

// 拖拽功能
function onComponentDragStart(e) {
    const compType = e.target.closest('.component-item').dataset.compType;
    e.dataTransfer.setData('componentType', compType);
    e.dataTransfer.effectAllowed = 'copy';
}

function allowDrop(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
}

function onCanvasDrop(e) {
    e.preventDefault();
    const compType = e.dataTransfer.getData('componentType');
    if (!compType || !COMPONENTS[compType]) return;
    
    addComponent(compType);
}

function addComponent(type) {
    const compDef = COMPONENTS[type];
    const newComp = {
        id: 'comp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        type: type,
        props: { ...compDef.defaultProps },
        style: {},
        events: {}
    };
    
    // 确保变量名唯一
    if (newComp.props.varName) {
        const existingVars = app.components
            .filter(c => c.props.varName)
            .map(c => c.props.varName);
        
        let baseVarName = compDef.defaultProps.varName.replace(/\d+$/, '');
        let counter = 1;
        let newVarName = compDef.defaultProps.varName;
        
        while (existingVars.includes(newVarName)) {
            counter++;
            newVarName = baseVarName + counter;
        }
        
        newComp.props.varName = newVarName;
    }
    
    app.components.push(newComp);
    renderCanvas();
    selectComponent(newComp.id);
    markUnsaved();
}

function renderCanvas() {
    const canvas = document.getElementById('canvas');
    const placeholder = canvas.querySelector('.canvas-placeholder');
    
    // 应用布局样式
    canvas.style.display = 'flex';
    canvas.style.flexDirection = 'column';
    canvas.style.gap = app.layout.gap + 'px';
    
    if (app.components.length === 0) {
        if (placeholder) placeholder.style.display = 'flex';
        return;
    }
    
    if (placeholder) placeholder.style.display = 'none';
    
    // 移除旧组件
    canvas.querySelectorAll('.canvas-component').forEach(el => el.remove());
    
    // 渲染新组件
    app.components.forEach(comp => {
        const el = renderComponent(comp);
        canvas.appendChild(el);
    });
    
    // 更新工具栏显示
    updateGapDisplay();
}

function renderComponent(comp) {
    const compDef = COMPONENTS[comp.type];
    const wrapper = document.createElement('div');
    wrapper.className = 'canvas-component';
    if (selectedComponent === comp.id) {
        wrapper.classList.add('selected');
    }
    wrapper.dataset.compId = comp.id;
    wrapper.draggable = true;
    
    wrapper.onclick = (e) => {
        e.stopPropagation();
        selectComponent(comp.id);
    };
    
    // 拖拽开始
    wrapper.ondragstart = (e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', comp.id);
        wrapper.classList.add('dragging');
    };
    
    // 拖拽结束
    wrapper.ondragend = (e) => {
        wrapper.classList.remove('dragging');
    };
    
    // 拖拽经过
    wrapper.ondragover = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        
        const dragging = document.querySelector('.canvas-component.dragging');
        if (dragging && dragging !== wrapper) {
            const rect = wrapper.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            
            if (e.clientY < midpoint) {
                wrapper.classList.add('drag-over-top');
                wrapper.classList.remove('drag-over-bottom');
            } else {
                wrapper.classList.add('drag-over-bottom');
                wrapper.classList.remove('drag-over-top');
            }
        }
    };
    
    // 拖拽离开
    wrapper.ondragleave = (e) => {
        wrapper.classList.remove('drag-over-top', 'drag-over-bottom');
    };
    
    // 放置
    wrapper.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        wrapper.classList.remove('drag-over-top', 'drag-over-bottom');
        
        const draggedId = e.dataTransfer.getData('text/plain');
        if (draggedId && draggedId !== comp.id) {
            moveComponentTo(draggedId, comp.id, e.clientY < wrapper.getBoundingClientRect().top + wrapper.getBoundingClientRect().height / 2);
        }
    };
    
    // 应用宽度样式
    if (comp.props.width) {
        wrapper.style.width = comp.props.width;
    }
    
    let html = '';
    
    switch (comp.type) {
        case 'input':
            const inputType = comp.props.inputType || 'text';
            html = `<div class="component-label">${comp.props.label}</div><div class="component-control">`;
            
            if (inputType === 'textarea') {
                html += `<textarea placeholder="${comp.props.placeholder}" rows="${comp.props.rows}">${comp.props.value}</textarea>`;
            } else if (inputType === 'number') {
                html += `<input type="number" placeholder="${comp.props.placeholder}" value="${comp.props.value}" min="${comp.props.min}" max="${comp.props.max}">`;
            } else if (inputType === 'date') {
                html += `<input type="date" value="${comp.props.value}">`;
            } else {
                html += `<input type="text" placeholder="${comp.props.placeholder}" value="${comp.props.value}">`;
            }
            
            html += `</div>`;
            break;
            
        case 'choice':
            const choiceType = comp.props.choiceType || 'select';
            const options = comp.props.options.split('\n').filter(o => o.trim());
            
            html = `<div class="component-label">${comp.props.label}</div><div class="component-control">`;
            
            if (choiceType === 'select') {
                html += `<select><option value="">请选择</option>`;
                options.forEach(opt => {
                    html += `<option value="${opt}">${opt}</option>`;
                });
                html += `</select>`;
            } else if (choiceType === 'checkbox') {
                html += `<div class="choice-group">`;
                options.forEach(opt => {
                    html += `<label class="choice-label"><input type="checkbox" value="${opt}"><span>${opt}</span></label>`;
                });
                html += `</div>`;
            } else if (choiceType === 'radio') {
                html += `<div class="choice-group">`;
                options.forEach(opt => {
                    html += `<label class="choice-label"><input type="radio" name="${comp.props.varName}" value="${opt}"><span>${opt}</span></label>`;
                });
                html += `</div>`;
            }
            
            html += `</div>`;
            break;
            
        case 'button':
            const btnClass = comp.props.variant === 'secondary' ? 'btn-secondary' : '';
            html = `
                <div class="component-control">
                    <button class="${btnClass}">${comp.props.text}</button>
                </div>
            `;
            break;
            
        case 'fileUpload':
            html = `
                <div class="component-label">${comp.props.label}</div>
                <div class="component-control">
                    <div class="file-upload-area" data-comp-id="${comp.id}">
                        <div class="file-upload-icon">📎</div>
                        <div class="file-upload-text">点击或拖拽文件到此处</div>
                        ${comp.props.showFileName ? '<div class="file-upload-name"></div>' : ''}
                    </div>
                </div>
            `;
            break;
            
        case 'display':
            const displayStyle = `min-height:${comp.props.minHeight};max-height:${comp.props.maxHeight};overflow-y:auto;`;
            html = `
                <div class="component-label">${comp.props.label}</div>
                <div class="component-control">
                    <div class="display-area" style="${displayStyle}" data-comp-id="${comp.id}">
                        ${comp.props.content ? comp.props.content.replace(/\n/g, '<br>') : '<span style="color:#86868b;">内容为空，可通过代码动态更新</span>'}
                    </div>
                </div>
            `;
            break;
            
        default:
            html = `<div>未知组件类型: ${comp.type}</div>`;
    }
    
    wrapper.innerHTML = html;
    return wrapper;
}

function selectComponent(compId) {
    selectedComponent = compId;
    renderCanvas();
    updatePropertyTabs();
    renderPropertyPanel();
}

function updatePropertyTabs() {
    const tabs = document.querySelectorAll('.property-tab');
    
    if (!selectedComponent) {
        // 未选中组件时，只显示变量
        tabs.forEach(tab => {
            const tabType = tab.dataset.tab;
            if (tabType === 'variables') {
                tab.style.display = '';
            } else {
                tab.style.display = 'none';
            }
        });
        return;
    }
    
    const comp = app.components.find(c => c.id === selectedComponent);
    if (!comp) return;
    
    tabs.forEach(tab => {
        const tabType = tab.dataset.tab;
        
        if (tabType === 'props' || tabType === 'style') {
            // 属性和布局始终显示
            tab.style.display = '';
        } else if (tabType === 'events') {
            // 事件只对按钮显示
            tab.style.display = comp.type === 'button' ? '' : 'none';
        } else if (tabType === 'variables') {
            // 变量标签：按钮不显示，其他组件显示
            tab.style.display = comp.type === 'button' ? 'none' : '';
        }
    });
    
    // 如果当前活动标签被隐藏了，切换到属性标签
    const activeTab = document.querySelector('.property-tab.active');
    if (activeTab && activeTab.style.display === 'none') {
        tabs.forEach(t => t.classList.remove('active'));
        document.querySelector('.property-tab[data-tab="props"]')?.classList.add('active');
    }
}

// HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderPropertyPanel() {
    const activeTab = document.querySelector('.property-tab.active')?.dataset.tab || 'props';
    const content = document.getElementById('propertyContent');
    
    // 更新标签页显示状态
    updatePropertyTabs();
    
    // 变量和代码标签页不需要选中组件
    if (activeTab === 'variables') {
        document.getElementById('propertyPanelTitle').textContent = '变量管理';
        content.innerHTML = renderVariablesTab();
        return;
    }
    
    if (!selectedComponent) {
        document.getElementById('propertyPanelTitle').textContent = '属性';
        content.innerHTML = `
            <div class="property-empty">
                <div class="empty-icon">👆</div>
                <p>选择一个组件查看属性</p>
                <div class="property-hint" style="margin-top:20px;text-align:center;font-size:12px;">
                    💡 提示：点击上方"变量"标签<br>管理应用变量
                </div>
            </div>
        `;
        return;
    }
    
    const comp = app.components.find(c => c.id === selectedComponent);
    if (!comp) return;
    
    const compDef = COMPONENTS[comp.type];
    document.getElementById('propertyPanelTitle').textContent = compDef.name;
    
    let html = '';
    
    if (activeTab === 'props') {
        html = '<div class="property-group"><div class="property-group-title">属性</div>';
        
        // 基础属性
        if (comp.props.label !== undefined) {
            html += `
                <div class="property-field">
                    <label>标签文本</label>
                    <input type="text" value="${comp.props.label}" onchange="updateComponentProp('${comp.id}', 'label', this.value)">
                </div>
            `;
        }
        
        if (comp.props.text !== undefined) {
            html += `
                <div class="property-field">
                    <label>按钮文本</label>
                    <input type="text" value="${comp.props.text}" onchange="updateComponentProp('${comp.id}', 'text', this.value)">
                </div>
            `;
        }
        
        // 输入组件特有属性
        if (comp.type === 'input') {
            html += `
                <div class="property-field">
                    <label>输入类型</label>
                    <select onchange="updateComponentProp('${comp.id}', 'inputType', this.value); renderPropertyPanel();">
                        <option value="text" ${comp.props.inputType === 'text' ? 'selected' : ''}>单行文本</option>
                        <option value="textarea" ${comp.props.inputType === 'textarea' ? 'selected' : ''}>多行文本</option>
                        <option value="number" ${comp.props.inputType === 'number' ? 'selected' : ''}>数字</option>
                        <option value="date" ${comp.props.inputType === 'date' ? 'selected' : ''}>日期</option>
                    </select>
                </div>
            `;
            
            if (comp.props.inputType === 'text' || comp.props.inputType === 'textarea') {
                html += `
                    <div class="property-field">
                        <label>占位符</label>
                        <input type="text" value="${comp.props.placeholder}" onchange="updateComponentProp('${comp.id}', 'placeholder', this.value)">
                    </div>
                `;
            }
            
            if (comp.props.inputType === 'textarea') {
                html += `
                    <div class="property-field">
                        <label>行数</label>
                        <input type="number" value="${comp.props.rows}" min="1" max="20" onchange="updateComponentProp('${comp.id}', 'rows', parseInt(this.value))">
                    </div>
                `;
            }
            
            if (comp.props.inputType === 'number') {
                html += `
                    <div class="property-field">
                        <label>最小值</label>
                        <input type="number" value="${comp.props.min}" onchange="updateComponentProp('${comp.id}', 'min', parseInt(this.value))">
                    </div>
                    <div class="property-field">
                        <label>最大值</label>
                        <input type="number" value="${comp.props.max}" onchange="updateComponentProp('${comp.id}', 'max', parseInt(this.value))">
                    </div>
                `;
            }
        }
        
        // 选择组件特有属性
        if (comp.type === 'choice') {
            html += `
                <div class="property-field">
                    <label>选择类型</label>
                    <select onchange="updateComponentProp('${comp.id}', 'choiceType', this.value); renderCanvas();">
                        <option value="select" ${comp.props.choiceType === 'select' ? 'selected' : ''}>下拉选择</option>
                        <option value="checkbox" ${comp.props.choiceType === 'checkbox' ? 'selected' : ''}>复选框</option>
                        <option value="radio" ${comp.props.choiceType === 'radio' ? 'selected' : ''}>单选框</option>
                    </select>
                </div>
                <div class="property-field">
                    <label>选项（每行一个）</label>
                    <textarea onchange="updateComponentProp('${comp.id}', 'options', this.value)" rows="5">${comp.props.options}</textarea>
                </div>
            `;
        }
        
        // 按钮特有属性
        if (comp.type === 'button') {
            html += `
                <div class="property-field">
                    <label>按钮样式</label>
                    <select onchange="updateComponentProp('${comp.id}', 'variant', this.value); renderCanvas();">
                        <option value="primary" ${comp.props.variant === 'primary' ? 'selected' : ''}>主要按钮</option>
                        <option value="secondary" ${comp.props.variant === 'secondary' ? 'selected' : ''}>次要按钮</option>
                    </select>
                </div>
            `;
        }
        
        // 文件上传特有属性
        if (comp.type === 'fileUpload') {
            html += `
                <div class="property-field">
                    <label>允许的文件类型</label>
                    <input type="text" value="${comp.props.accept || ''}" 
                           onchange="updateComponentProp('${comp.id}', 'accept', this.value)"
                           placeholder="例: .xlsx,.xls,.csv">
                    <div class="property-hint">留空表示允许所有类型</div>
                </div>
                <div class="property-field">
                    <label>
                        <input type="checkbox" ${comp.props.multiple ? 'checked' : ''} 
                               onchange="updateComponentProp('${comp.id}', 'multiple', this.checked); renderCanvas();">
                        允许多文件上传
                    </label>
                </div>
                <div class="property-field">
                    <label>
                        <input type="checkbox" ${comp.props.showFileName ? 'checked' : ''} 
                               onchange="updateComponentProp('${comp.id}', 'showFileName', this.checked); renderCanvas();">
                        显示文件名
                    </label>
                </div>
            `;
        }
        
        // 输出显示特有属性
        if (comp.type === 'display') {
            html += `
                <div class="property-field">
                    <label>最小高度</label>
                    <input type="text" value="${comp.props.minHeight || '200px'}" 
                           onchange="updateComponentProp('${comp.id}', 'minHeight', this.value)"
                           placeholder="例: 200px, 10vh">
                    <div class="property-hint">支持像素(px)或视口高度(vh)</div>
                </div>
                <div class="property-field">
                    <label>最大高度</label>
                    <input type="text" value="${comp.props.maxHeight || '500px'}" 
                           onchange="updateComponentProp('${comp.id}', 'maxHeight', this.value)"
                           placeholder="例: 500px, 50vh">
                    <div class="property-hint">超出时显示滚动条</div>
                </div>
                <div class="property-field">
                    <label>初始内容</label>
                    <textarea onchange="updateComponentProp('${comp.id}', 'content', this.value)" rows="3" placeholder="可留空，通过代码动态更新">${escapeHtml(comp.props.content || '')}</textarea>
                    <div class="property-hint">可在按钮事件中使用代码更新内容</div>
                </div>
            `;
        }
        
        html += '</div>';
        
        // 删除按钮
        html += `
            <div class="property-group">
                <button class="btn-secondary" style="width:100%;" onclick="deleteComponent('${comp.id}')">
                    🗑️ 删除组件
                </button>
            </div>
        `;
    } else if (activeTab === 'style') {
        html = '<div class="property-group"><div class="property-group-title">组件布局</div>';
        
        // 宽度设置
        html += `
            <div class="property-field">
                <label>宽度</label>
                <div class="width-input-group">
                    <input type="text" value="${comp.props.width || '100%'}" 
                           onchange="updateComponentProp('${comp.id}', 'width', this.value)"
                           placeholder="例: 100%, 300px, auto">
                </div>
                <div class="property-hint">支持: 百分比(50%)、像素(300px)、auto</div>
            </div>
        `;
        
        // 快捷宽度按钮
        html += `
            <div class="property-field">
                <label>快捷设置</label>
                <div class="width-preset-buttons">
                    <button class="preset-btn" onclick="updateComponentProp('${comp.id}', 'width', '25%'); renderCanvas(); renderPropertyPanel();">25%</button>
                    <button class="preset-btn" onclick="updateComponentProp('${comp.id}', 'width', '50%'); renderCanvas(); renderPropertyPanel();">50%</button>
                    <button class="preset-btn" onclick="updateComponentProp('${comp.id}', 'width', '75%'); renderCanvas(); renderPropertyPanel();">75%</button>
                    <button class="preset-btn" onclick="updateComponentProp('${comp.id}', 'width', '100%'); renderCanvas(); renderPropertyPanel();">100%</button>
                </div>
            </div>
        `;
        
        html += '</div>';
        
        // 全局布局设置
        html += '<div class="property-group" style="margin-top:24px;">';
        html += '<div class="property-group-title">画布布局</div>';
        html += `
            <div class="property-field">
                <label>组件间距</label>
                <input type="number" value="${app.layout.gap}" min="0" max="50" 
                       onchange="updateLayoutGap(this.value)">
                <div class="property-hint">组件之间的间距（像素）</div>
            </div>
        `;
        html += '</div>';
    } else if (activeTab === 'events') {
        // 只有按钮才显示事件配置
        if (comp.type !== 'button') {
            html = '<div class="property-group">';
            html += '<div class="property-hint" style="text-align:center;padding:40px 20px;color:#86868b;">';
            html += '只有按钮组件支持事件配置';
            html += '</div></div>';
            content.innerHTML = html;
            return;
        }
        html = '<div class="property-group"><div class="property-group-title">点击事件</div>';
        html += '<div class="property-hint" style="margin-bottom:12px;">配置按钮点击后执行的JavaScript代码</div>';
        
        const clickEvent = comp.events?.click;
        if (!clickEvent || !clickEvent.code) {
            html += '<div style="text-align:center;padding:40px 20px;color:#86868b;">';
            html += '<div style="font-size:48px;margin-bottom:12px;">⚡</div>';
            html += '<p>暂未配置点击事件</p>';
            html += '</div>';
        } else {
            html += '<div class="event-preview">';
            html += '<div class="event-preview-label">当前代码：</div>';
            html += `<pre class="event-preview-code">${escapeHtml(clickEvent.code)}</pre>`;
            html += '</div>';
        }
        
        html += `<button class="btn-primary" style="width:100%;margin-top:12px;" onclick="editEvent('${comp.id}')">${clickEvent ? '✏️ 编辑事件' : '+ 添加事件'}</button>`;
        html += '</div>';
    }
    
    content.innerHTML = html;
}


function updateComponentProp(compId, prop, value) {
    const comp = app.components.find(c => c.id === compId);
    if (!comp) return;
    
    comp.props[prop] = value;
    renderCanvas();
    
    // 如果修改了变量名，需要更新属性面板（更新使用示例等）
    if (prop === 'varName') {
        renderPropertyPanel();
    }
    
    markUnsaved();
}

function deleteComponent(compId) {
    if (!confirm('确定删除此组件？')) return;
    
    app.components = app.components.filter(c => c.id !== compId);
    selectedComponent = null;
    renderCanvas();
    updatePropertyTabs();
    renderPropertyPanel();
    markUnsaved();
}

function moveComponentTo(draggedId, targetId, insertBefore) {
    const draggedIndex = app.components.findIndex(c => c.id === draggedId);
    const targetIndex = app.components.findIndex(c => c.id === targetId);
    
    if (draggedIndex === -1 || targetIndex === -1) return;
    
    // 移除被拖拽的组件
    const [draggedComp] = app.components.splice(draggedIndex, 1);
    
    // 重新计算目标位置（因为删除了一个元素）
    const newTargetIndex = app.components.findIndex(c => c.id === targetId);
    
    // 插入到新位置
    if (insertBefore) {
        app.components.splice(newTargetIndex, 0, draggedComp);
    } else {
        app.components.splice(newTargetIndex + 1, 0, draggedComp);
    }
    
    renderCanvas();
    markUnsaved();
}

function addEvent(compId) {
    selectedComponent = compId;
    
    // 清空表单
    document.getElementById('aiPrompt').value = '';
    document.getElementById('eventCode').value = '';
    
    // 显示可用变量
    updateAvailableVars();
    
    document.getElementById('eventModal').style.display = '';
}

function editEvent(compId) {
    selectedComponent = compId;
    const comp = app.components.find(c => c.id === compId);
    if (!comp) return;
    
    // 加载现有的点击事件代码
    const clickEvent = comp.events?.click;
    document.getElementById('aiPrompt').value = '';
    document.getElementById('eventCode').value = clickEvent?.code || '';
    
    // 显示可用变量
    updateAvailableVars();
    
    document.getElementById('eventModal').style.display = '';
}

function closeEventModal() {
    document.getElementById('eventModal').style.display = 'none';
}

function saveEvent() {
    if (!selectedComponent) return;
    
    const comp = app.components.find(c => c.id === selectedComponent);
    if (!comp) return;
    
    const code = document.getElementById('eventCode').value;
    
    if (!comp.events) comp.events = {};
    comp.events.click = {
        type: 'js',
        code: code
    };
    
    closeEventModal();
    renderPropertyPanel();
    markUnsaved();
}

// 更新可用变量显示
function updateAvailableVars() {
    const componentVars = extractComponentVariables();
    const varsContainer = document.getElementById('availableVars');
    
    if (componentVars.length === 0) {
        varsContainer.innerHTML = '<div class="no-vars">暂无可用变量</div>';
        return;
    }
    
    let html = '';
    componentVars.forEach(v => {
        html += `
            <div class="var-chip" onclick="insertVar('${v.varName}')" title="点击插入到代码中">
                <span class="var-icon">${v.icon}</span>
                <span class="var-name">${v.varName}</span>
                <span class="var-type">${v.type}</span>
            </div>
        `;
    });
    varsContainer.innerHTML = html;
}

// 插入变量到代码编辑器
function insertVar(varName) {
    const codeTextarea = document.getElementById('eventCode');
    const cursorPos = codeTextarea.selectionStart;
    const textBefore = codeTextarea.value.substring(0, cursorPos);
    const textAfter = codeTextarea.value.substring(cursorPos);
    
    codeTextarea.value = textBefore + varName + textAfter;
    codeTextarea.focus();
    codeTextarea.setSelectionRange(cursorPos + varName.length, cursorPos + varName.length);
}

// AI 生成代码
async function generateCodeWithAI() {
    const prompt = document.getElementById('aiPrompt').value.trim();
    if (!prompt) {
        alert('请输入功能描述');
        return;
    }
    
    // 检查AI配置
    if (!aiConfig.apiUrl || !aiConfig.apiKey) {
        if (confirm('AI 功能未配置。是否现在配置？')) {
            openAISettings();
        }
        return;
    }
    
    const button = event.target;
    button.disabled = true;
    button.textContent = '⏳ AI 生成中...';
    
    try {
        // 获取可用变量信息
        const componentVars = extractComponentVariables();
        const varsInfo = componentVars.map(v => `${v.varName} (${v.type}): ${v.label}`).join('\n');
        
        // 构建AI提示
        const systemPrompt = `你是一个JavaScript代码生成助手。用户会描述一个功能需求，你需要生成对应的JavaScript代码。

可用的变量：
${varsInfo || '(暂无可用变量)'}

注意：
1. 只生成JavaScript代码，不要有任何解释
2. 代码要简洁、易读
3. 使用上面列出的变量
4. 可以使用 alert()、console.log() 等函数
5. 如果需要验证，使用 if 语句和 alert 提示`;
        
        const response = await fetch(aiConfig.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aiConfig.apiKey}`
            },
            body: JSON.stringify({
                model: aiConfig.model || 'deepseek-chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                temperature: parseFloat(aiConfig.temperature) || 0.7,
                max_tokens: 500
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `请求失败: ${response.status}`);
        }
        
        const data = await response.json();
        let generatedCode = data.choices[0].message.content.trim();
        
        // 清理代码块标记
        generatedCode = generatedCode.replace(/```javascript\n?/g, '').replace(/```\n?/g, '');
        
        // 插入到代码编辑器
        const codeTextarea = document.getElementById('eventCode');
        if (codeTextarea.value.trim()) {
            codeTextarea.value += '\n\n' + generatedCode;
        } else {
            codeTextarea.value = generatedCode;
        }
        
        alert('✅ AI 代码生成成功！');
        
    } catch (error) {
        console.error('AI生成失败:', error);
        alert('❌ AI 生成失败: ' + error.message + '\n\n请检查 AI 设置是否正确');
    } finally {
        button.disabled = false;
        button.textContent = '✨ AI 生成代码';
    }
}

// AI 设置管理
function openAISettings() {
    // 加载当前配置到表单
    document.getElementById('aiApiUrl').value = aiConfig.apiUrl || 'https://api.deepseek.com/v1/chat/completions';
    document.getElementById('aiApiKey').value = aiConfig.apiKey || '';
    document.getElementById('aiModel').value = aiConfig.model || 'deepseek-chat';
    document.getElementById('aiTemperature').value = aiConfig.temperature || 0.7;
    
    document.getElementById('aiSettingsModal').style.display = '';
}

function closeAISettings() {
    document.getElementById('aiSettingsModal').style.display = 'none';
}

function saveAISettings() {
    // 获取表单值
    aiConfig.apiUrl = document.getElementById('aiApiUrl').value.trim();
    aiConfig.apiKey = document.getElementById('aiApiKey').value.trim();
    aiConfig.model = document.getElementById('aiModel').value.trim() || 'deepseek-chat';
    aiConfig.temperature = parseFloat(document.getElementById('aiTemperature').value) || 0.7;
    
    // 保存到localStorage
    saveAIConfigToStorage();
    
    closeAISettings();
    alert('✅ AI 设置已保存！');
}

async function testAIConnection() {
    const apiUrl = document.getElementById('aiApiUrl').value.trim();
    const apiKey = document.getElementById('aiApiKey').value.trim();
    const model = document.getElementById('aiModel').value.trim() || 'deepseek-chat';
    
    if (!apiUrl || !apiKey) {
        alert('请先填写 API 地址和密钥');
        return;
    }
    
    const button = event.target;
    button.disabled = true;
    button.textContent = '⏳ 测试中...';
    
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'user', content: '你好' }
                ],
                max_tokens: 10
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `连接失败: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.choices && data.choices[0]) {
            alert('✅ 连接测试成功！\n\nAI 响应正常，可以保存配置使用。');
        } else {
            throw new Error('响应格式异常');
        }
        
    } catch (error) {
        console.error('测试失败:', error);
        alert('❌ 连接测试失败\n\n' + error.message + '\n\n请检查 API 地址、密钥和模型名称是否正确。');
    } finally {
        button.disabled = false;
        button.textContent = '🧪 测试连接';
    }
}

function closePropertyPanel() {
    selectedComponent = null;
    renderCanvas();
    updatePropertyTabs();
    renderPropertyPanel();
}

// 布局控制
// 布局控制
function adjustGap(delta) {
    app.layout.gap = Math.max(0, Math.min(50, app.layout.gap + delta));
    renderCanvas();
    markUnsaved();
}

function updateGapDisplay() {
    const gapEl = document.getElementById('gapLevel');
    if (gapEl) {
        gapEl.textContent = app.layout.gap + 'px';
    }
}

function updateLayoutGap(gap) {
    app.layout.gap = parseInt(gap) || 12;
    renderCanvas();
    markUnsaved();
}

// 更新属性面板标签页显示
// 画布操作
function zoomIn() {
    zoom = Math.min(zoom + 10, 200);
    updateZoom();
}

function zoomOut() {
    zoom = Math.max(zoom - 10, 50);
    updateZoom();
}

function resetZoom() {
    zoom = 100;
    updateZoom();
}

function updateZoom() {
    document.getElementById('canvas').style.transform = `scale(${zoom / 100})`;
    document.getElementById('zoomLevel').textContent = zoom + '%';
}

// 模板管理 - 内嵌模板数据以避免CORS问题
const TEMPLATES = {
    'excel-to-word': {"name":"Excel转Word文档","components":[{"id":"comp_1708123456789_abc123","type":"fileUpload","props":{"label":"选择Excel文件","varName":"excelFile","accept":".xlsx,.xls","multiple":false,"showFileName":true,"width":"100%"},"style":{},"events":{}},{"id":"comp_1708123456790_def456","type":"choice","props":{"label":"文档布局","varName":"layout","choiceType":"radio","options":"横向排列\n纵向排列\n表格形式","value":"","width":"100%"},"style":{},"events":{}},{"id":"comp_1708123456791_ghi789","type":"button","props":{"text":"转换为Word文档","variant":"primary","width":"100%"},"style":{},"events":{"click":{"type":"js","code":"if (!excelFile) {\n  showMessage('请先上传Excel文件！', 'warning');\n  return;\n}\n\nif (!layout) {\n  showMessage('请选择文档布局！', 'warning');\n  return;\n}\n\nshowMessage('正在处理，请稍候...', 'info', 2000);\n\n// 读取Excel文件\nconst reader = new FileReader();\nreader.onload = async function(e) {\n  try {\n    // 使用 xlsx 库解析Excel\n    const data = new Uint8Array(e.target.result);\n    const workbook = XLSX.read(data, { type: 'array' });\n    \n    // 获取第一个工作表\n    const sheetName = workbook.SheetNames[0];\n    const worksheet = workbook.Sheets[sheetName];\n    \n    // 转换为JSON数据\n    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });\n    \n    if (jsonData.length === 0) {\n      showMessage('Excel文件为空！', 'warning');\n      return;\n    }\n    \n    // 准备文档内容\n    const children = [];\n    \n    // 添加标题\n    children.push(\n      new docx.Paragraph({\n        text: '数据报告',\n        heading: docx.HeadingLevel.HEADING_1,\n        alignment: docx.AlignmentType.CENTER\n      })\n    );\n    \n    // 根据布局选择生成内容\n    if (layout === '表格形式') {\n      // 创建表格\n      const rows = jsonData.map((row, index) => {\n        return new docx.TableRow({\n          children: row.map(cell => \n            new docx.TableCell({\n              children: [new docx.Paragraph(String(cell || ''))],\n              shading: index === 0 ? {\n                fill: '4472C4',\n                color: 'FFFFFF'\n              } : undefined\n            })\n          )\n        });\n      });\n      \n      const table = new docx.Table({\n        rows: rows,\n        width: {\n          size: 100,\n          type: docx.WidthType.PERCENTAGE\n        }\n      });\n      \n      children.push(table);\n    } else {\n      // 段落形式\n      jsonData.forEach((row, rowIndex) => {\n        if (rowIndex === 0) {\n          // 标题行\n          children.push(\n            new docx.Paragraph({\n              text: row.join(' - '),\n              bold: true,\n              size: 24\n            })\n          );\n        } else {\n          // 数据行\n          const text = layout === '横向排列' \n            ? row.join(' | ') \n            : row.join('\\n');\n          \n          children.push(\n            new docx.Paragraph({\n              text: text,\n              spacing: { after: 200 }\n            })\n          );\n        }\n      });\n    }\n    \n    // 创建Word文档\n    const doc = new docx.Document({\n      sections: [{\n        properties: {},\n        children: children\n      }]\n    });\n    \n    // 生成并下载Word文档\n    const blob = await docx.Packer.toBlob(doc);\n    const url = URL.createObjectURL(blob);\n    const a = document.createElement('a');\n    a.href = url;\n    a.download = excelFile.name.replace(/\\.[^.]+$/, '') + '.docx';\n    a.click();\n    URL.revokeObjectURL(url);\n    \n    showMessage('转换成功！Word文档已下载', 'success');\n    \n  } catch (error) {\n    console.error('转换失败:', error);\n    showMessage('转换失败: ' + error.message, 'error', 5000);\n  }\n};\n\nreader.readAsArrayBuffer(excelFile);"}}}],"variables":[],"layout":{"gap":16},"savedTime":null},
    
    'excel-filter': {"name":"Excel数据筛选器","components":[{"id":"comp_1708123456792_jkl012","type":"fileUpload","props":{"label":"上传Excel文件","varName":"sourceFile","accept":".xlsx,.xls","multiple":false,"showFileName":true,"width":"100%"},"style":{},"events":{}},{"id":"comp_1708123456793_mno345","type":"input","props":{"label":"筛选列名","varName":"columnName","inputType":"text","placeholder":"例如: 姓名、部门、成绩","value":"","width":"100%"},"style":{},"events":{}},{"id":"comp_1708123456794_pqr678","type":"input","props":{"label":"筛选条件（包含的关键词）","varName":"filterValue","inputType":"text","placeholder":"例如: 张三、销售部、90","value":"","width":"100%"},"style":{},"events":{}},{"id":"comp_1708123456795_stu901","type":"button","props":{"text":"筛选并导出","variant":"primary","width":"100%"},"style":{},"events":{"click":{"type":"js","code":"if (!sourceFile) {\n  showMessage('请先上传Excel文件！', 'warning');\n  return;\n}\n\nif (!columnName || !filterValue) {\n  showMessage('请填写筛选列名和条件！', 'warning');\n  return;\n}\n\nconst reader = new FileReader();\nreader.onload = function(e) {\n  try {\n    // 解析Excel\n    const data = new Uint8Array(e.target.result);\n    const workbook = XLSX.read(data, { type: 'array' });\n    const sheetName = workbook.SheetNames[0];\n    const worksheet = workbook.Sheets[sheetName];\n    const jsonData = XLSX.utils.sheet_to_json(worksheet);\n    \n    if (jsonData.length === 0) {\n      showMessage('Excel文件为空！', 'warning');\n      return;\n    }\n    \n    // 筛选数据\n    const filteredData = jsonData.filter(row => {\n      const cellValue = String(row[columnName] || '');\n      return cellValue.includes(filterValue);\n    });\n    \n    if (filteredData.length === 0) {\n      showMessage('未找到符合条件的数据！', 'warning');\n      return;\n    }\n    \n    // 创建新的工作表\n    const newWorksheet = XLSX.utils.json_to_sheet(filteredData);\n    const newWorkbook = XLSX.utils.book_new();\n    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, '筛选结果');\n    \n    // 导出Excel\n    XLSX.writeFile(newWorkbook, '筛选结果.xlsx');\n    \n    showMessage(`筛选完成！共找到 ${filteredData.length} 条符合条件的数据`, 'success');\n    \n  } catch (error) {\n    console.error('筛选失败:', error);\n    showMessage('筛选失败: ' + error.message + ' 请检查列名是否正确', 'error', 5000);\n  }\n};\n\nreader.readAsArrayBuffer(sourceFile);"}}}],"variables":[],"layout":{"gap":16},"savedTime":null},
    
    'batch-rename': {"name":"批量文件重命名","components":[{"id":"comp_1708123456796_vwx234","type":"fileUpload","props":{"label":"上传Excel名单文件","varName":"nameListFile","accept":".xlsx,.xls","multiple":false,"showFileName":true,"width":"100%"},"style":{},"events":{}},{"id":"comp_1708123456797_yza567","type":"input","props":{"label":"文件名前缀","varName":"prefix","inputType":"text","placeholder":"例如: 2024-员工照片-","value":"","width":"100%"},"style":{},"events":{}},{"id":"comp_1708123456798_bcd890","type":"choice","props":{"label":"编号格式","varName":"numberFormat","choiceType":"radio","options":"无编号\n001、002、003\n0001、0002、0003","value":"","width":"100%"},"style":{},"events":{}},{"id":"comp_1708123456799_efg123","type":"button","props":{"text":"生成重命名脚本","variant":"primary","width":"100%"},"style":{},"events":{"click":{"type":"js","code":"if (!nameListFile) {\n  showMessage('请先上传Excel名单文件！', 'warning');\n  return;\n}\n\nif (!numberFormat) {\n  showMessage('请选择编号格式！', 'warning');\n  return;\n}\n\nconst reader = new FileReader();\nreader.onload = function(e) {\n  try {\n    // 解析Excel\n    const data = new Uint8Array(e.target.result);\n    const workbook = XLSX.read(data, { type: 'array' });\n    const sheetName = workbook.SheetNames[0];\n    const worksheet = workbook.Sheets[sheetName];\n    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });\n    \n    if (jsonData.length === 0) {\n      showMessage('Excel文件为空！', 'warning');\n      return;\n    }\n    \n    // 生成重命名命令\n    let script = '';\n    const isWindows = navigator.platform.includes('Win');\n    \n    if (isWindows) {\n      script += '@echo off\\n';\n      script += 'chcp 65001 > nul\\n';\n      script += 'echo 批量重命名脚本\\n';\n      script += 'echo.\\n';\n    } else {\n      script += '#!/bin/bash\\n';\n      script += 'echo \"批量重命名脚本\"\\n';\n      script += 'echo \"\"\\n';\n    }\n    \n    jsonData.forEach((row, index) => {\n      if (index === 0 || !row[0]) return; // 跳过标题行和空行\n      \n      const name = row[0];\n      let number = '';\n      \n      if (numberFormat === '001、002、003') {\n        number = String(index).padStart(3, '0');\n      } else if (numberFormat === '0001、0002、0003') {\n        number = String(index).padStart(4, '0');\n      }\n      \n      const newName = prefix + number + (number ? '-' : '') + name;\n      \n      if (isWindows) {\n        script += `ren \"原文件${index}.jpg\" \"${newName}.jpg\"\\n`;\n      } else {\n        script += `mv \"原文件${index}.jpg\" \"${newName}.jpg\"\\n`;\n      }\n    });\n    \n    if (isWindows) {\n      script += 'echo.\\n';\n      script += 'echo 重命名完成！\\n';\n      script += 'pause\\n';\n    } else {\n      script += 'echo \"\"\\n';\n      script += 'echo \"重命名完成！\"\\n';\n    }\n    \n    // 下载脚本文件\n    const blob = new Blob([script], { type: 'text/plain;charset=utf-8' });\n    const url = URL.createObjectURL(blob);\n    const a = document.createElement('a');\n    a.href = url;\n    a.download = isWindows ? '重命名.bat' : '重命名.sh';\n    a.click();\n    URL.revokeObjectURL(url);\n    \n    showMessage(`脚本生成成功！共生成 ${jsonData.length - 1} 条重命名命令，请将脚本放在文件所在目录，双击运行`, 'success', 5000);\n    \n  } catch (error) {\n    console.error('生成失败:', error);\n    showMessage('生成失败: ' + error.message, 'error', 5000);\n  }\n};\n\nreader.readAsArrayBuffer(nameListFile);"}}}],"variables":[],"layout":{"gap":16},"savedTime":null},
    
    'data-validator': {"name":"数据验证工具","components":[{"id":"comp_1708123456800_hij456","type":"fileUpload","props":{"label":"上传待验证的Excel文件","varName":"dataFile","accept":".xlsx,.xls","multiple":false,"showFileName":true,"width":"100%"},"style":{},"events":{}},{"id":"comp_1708123456801_klm789","type":"choice","props":{"label":"验证规则","varName":"rules","choiceType":"checkbox","options":"检查空值\n检查重复数据\n检查数字格式\n检查邮箱格式\n检查手机号格式","value":"","width":"100%"},"style":{},"events":{}},{"id":"comp_1708123456802_nop012","type":"button","props":{"text":"开始验证","variant":"primary","width":"100%"},"style":{},"events":{"click":{"type":"js","code":"if (!dataFile) {\n  showMessage('请先上传Excel文件！', 'warning');\n  return;\n}\n\nif (!rules || rules.length === 0) {\n  showMessage('请至少选择一个验证规则！', 'warning');\n  return;\n}\n\nconst reader = new FileReader();\nreader.onload = function(e) {\n  try {\n    // 解析Excel\n    const data = new Uint8Array(e.target.result);\n    const workbook = XLSX.read(data, { type: 'array' });\n    const sheetName = workbook.SheetNames[0];\n    const worksheet = workbook.Sheets[sheetName];\n    const jsonData = XLSX.utils.sheet_to_json(worksheet);\n    \n    if (jsonData.length === 0) {\n      showMessage('Excel文件为空！', 'warning');\n      return;\n    }\n    \n    const errors = [];\n    const columns = Object.keys(jsonData[0]);\n    \n    // 检查空值\n    if (rules.includes('检查空值')) {\n      jsonData.forEach((row, index) => {\n        columns.forEach(col => {\n          if (!row[col] || String(row[col]).trim() === '') {\n            errors.push(`第${index + 2}行「${col}」列为空`);\n          }\n        });\n      });\n    }\n    \n    // 检查重复数据\n    if (rules.includes('检查重复数据')) {\n      columns.forEach(col => {\n        const values = jsonData.map(row => String(row[col] || ''));\n        const seen = new Set();\n        values.forEach((val, index) => {\n          if (val && seen.has(val)) {\n            errors.push(`第${index + 2}行「${col}」列存在重复值: ${val}`);\n          }\n          seen.add(val);\n        });\n      });\n    }\n    \n    // 检查数字格式\n    if (rules.includes('检查数字格式')) {\n      jsonData.forEach((row, index) => {\n        columns.forEach(col => {\n          const val = row[col];\n          if (val && /[0-9]/.test(String(val)) && !/^-?\\d+(\\.\\d+)?$/.test(String(val))) {\n            errors.push(`第${index + 2}行「${col}」列数字格式错误: ${val}`);\n          }\n        });\n      });\n    }\n    \n    // 检查邮箱格式\n    if (rules.includes('检查邮箱格式')) {\n      const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n      jsonData.forEach((row, index) => {\n        columns.forEach(col => {\n          const val = String(row[col] || '');\n          if (val && val.includes('@') && !emailRegex.test(val)) {\n            errors.push(`第${index + 2}行「${col}」列邮箱格式错误: ${val}`);\n          }\n        });\n      });\n    }\n    \n    // 检查手机号格式\n    if (rules.includes('检查手机号格式')) {\n      const phoneRegex = /^1[3-9]\\d{9}$/;\n      jsonData.forEach((row, index) => {\n        columns.forEach(col => {\n          const val = String(row[col] || '').replace(/\\s+/g, '');\n          if (val && /^1[3-9]/.test(val) && !phoneRegex.test(val)) {\n            errors.push(`第${index + 2}行「${col}」列手机号格式错误: ${val}`);\n          }\n        });\n      });\n    }\n    \n    // 生成验证报告\n    let report = `数据验证报告\\n`;\n    report += `文件名: ${dataFile.name}\\n`;\n    report += `数据行数: ${jsonData.length}\\n`;\n    report += `列数: ${columns.length}\\n`;\n    report += `\\n验证规则:\\n`;\n    rules.forEach(rule => {\n      report += `  ✓ ${rule}\\n`;\n    });\n    report += `\\n验证结果:\\n`;\n    \n    if (errors.length === 0) {\n      report += `✅ 所有数据验证通过！未发现问题。\\n`;\n      alert(report);\n    } else {\n      report += `❌ 发现 ${errors.length} 个问题:\\n\\n`;\n      errors.forEach(err => {\n        report += `- ${err}\\n`;\n      });\n      \n      // 保存报告\n      const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });\n      const url = URL.createObjectURL(blob);\n      const a = document.createElement('a');\n      a.href = url;\n      a.download = '验证报告.txt';\n      a.click();\n      URL.revokeObjectURL(url);\n      \n      showMessage(`发现 ${errors.length} 个问题，验证报告已下载，请查看详情`, 'error', 5000);\n    }\n    \n  } catch (error) {\n    console.error('验证失败:', error);\n    showMessage('验证失败: ' + error.message, 'error', 5000);\n  }\n};\n\nreader.readAsArrayBuffer(dataFile);"}}}],"variables":[],"layout":{"gap":16},"savedTime":null},
    
    'ai-chat-assistant': {"name":"AI聊天助手","components":[{"id":"comp_ai_1","type":"input","props":{"label":"API地址","varName":"apiUrl","inputType":"text","placeholder":"https://api.deepseek.com/v1/chat/completions","value":"https://api.deepseek.com/v1/chat/completions","rows":3,"min":0,"max":100,"width":"100%"},"style":{},"events":{}},{"id":"comp_ai_2","type":"input","props":{"label":"API密钥","varName":"apiKey","inputType":"text","placeholder":"sk-...","value":"","rows":3,"min":0,"max":100,"width":"100%"},"style":{},"events":{}},{"id":"comp_ai_3","type":"input","props":{"label":"模型名称","varName":"modelName","inputType":"text","placeholder":"deepseek-chat","value":"deepseek-chat","rows":3,"min":0,"max":100,"width":"100%"},"style":{},"events":{}},{"id":"comp_ai_4","type":"display","props":{"label":"聊天记录","varName":"chatDisplay","content":"欢迎使用AI聊天助手！请在上方配置API信息后开始对话。","minHeight":"300px","maxHeight":"500px","showMarkdown":false,"width":"100%"},"style":{},"events":{}},{"id":"comp_ai_5","type":"input","props":{"label":"输入消息","varName":"userMessage","inputType":"textarea","placeholder":"输入您的问题...","value":"","rows":4,"min":0,"max":100,"width":"100%"},"style":{},"events":{}},{"id":"comp_ai_6","type":"button","props":{"text":"发送消息","variant":"primary","width":"100%"},"style":{},"events":{}}],"variables":[],"layout":{"gap":12},"savedTime":null}
};

function openTemplates() {
    document.getElementById('templatesModal').style.display = '';
}

function closeTemplates() {
    document.getElementById('templatesModal').style.display = 'none';
}

function loadTemplate(templateId) {
    if (app.components.length > 0) {
        if (!confirm('加载模板将覆盖当前项目，确定继续吗？')) {
            return;
        }
    }
    
    try {
        const templateData = TEMPLATES[templateId];
        if (!templateData) {
            throw new Error('模板不存在');
        }
        
        // 深拷贝模板数据，避免修改原始模板
        app = JSON.parse(JSON.stringify(templateData));
        
        // AI聊天助手模板特殊处理
        if (templateId === 'ai-chat-assistant') {
            const buttonComp = app.components.find(c => c.id === 'comp_ai_6');
            if (buttonComp) {
                buttonComp.events = {
                    click: {
                        type: 'js',
                        code: getAIChatButtonCode()
                    }
                };
            }
        }
        
        selectedComponent = null;
        
        // 更新界面
        document.getElementById('appNameInput').value = app.name;
        renderCanvas();
        updatePropertyTabs();
        renderPropertyPanel();
        
        closeTemplates();
        showMessage(`模板「${app.name}」加载成功！`, 'success');
        markUnsaved();
        
    } catch (error) {
        console.error('加载模板失败:', error);
        showMessage('模板加载失败: ' + error.message, 'error');
    }
}

function getAIChatButtonCode() {
    return `// 验证配置
if (!apiUrl || !apiKey || !modelName) {
  showMessage('请先配置API地址、密钥和模型名称！', 'warning');
  return;
}

if (!userMessage || !userMessage.trim()) {
  showMessage('请输入消息内容！', 'warning');
  return;
}

// 获取显示区域元素
const displayEl = document.getElementById('comp_ai_4');
if (!displayEl) {
  showMessage('找不到聊天显示区域！', 'error');
  return;
}

// 添加用户消息到显示区域
const userMsg = userMessage.trim();
let currentContent = displayEl.innerHTML;
if (currentContent.includes('欢迎使用')) {
  currentContent = '';
}
currentContent += \`<div style="margin-bottom:16px;padding:12px;background:#e3f2fd;border-radius:8px;border-left:4px solid #2196f3;"><strong>👤 用户：</strong><br>\${userMsg.replace(/\\n/g, '<br>')}</div>\`;
displayEl.innerHTML = currentContent;

// 清空输入框
document.getElementById('comp_ai_5').value = '';
userMessage = '';

// 添加加载提示
currentContent += \`<div id="ai-loading" style="margin-bottom:16px;padding:12px;background:#f5f5f5;border-radius:8px;border-left:4px solid #9e9e9e;"><strong>🤖 AI：</strong><br>思考中...</div>\`;
displayEl.innerHTML = currentContent;
displayEl.scrollTop = displayEl.scrollHeight;

// 调用AI API
fetch(apiUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': \`Bearer \${apiKey}\`
  },
  body: JSON.stringify({
    model: modelName,
    messages: [{ role: 'user', content: userMsg }],
    stream: true
  })
})
.then(response => {
  if (!response.ok) {
    throw new Error(\`API请求失败: \${response.status} \${response.statusText}\`);
  }
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let aiResponse = '';
  
  // 移除加载提示，准备流式输出
  const loadingEl = document.getElementById('ai-loading');
  if (loadingEl) loadingEl.remove();
  
  // 创建AI回复区域
  const aiMsgId = 'ai-msg-' + Date.now();
  currentContent = displayEl.innerHTML;
  currentContent += \`<div id="\${aiMsgId}" style="margin-bottom:16px;padding:12px;background:#e8f5e9;border-radius:8px;border-left:4px solid #4caf50;"><strong>🤖 AI：</strong><br><span id="\${aiMsgId}-content"></span></div>\`;
  displayEl.innerHTML = currentContent;
  
  function processStream() {
    reader.read().then(({ done, value }) => {
      if (done) {
        displayEl.scrollTop = displayEl.scrollHeight;
        return;
      }
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\\n').filter(line => line.trim() !== '');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content || '';
            if (content) {
              aiResponse += content;
              const contentEl = document.getElementById(\`\${aiMsgId}-content\`);
              if (contentEl) {
                contentEl.innerHTML = aiResponse.replace(/\\n/g, '<br>');
                displayEl.scrollTop = displayEl.scrollHeight;
              }
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
      
      processStream();
    }).catch(error => {
      console.error('流式读取错误:', error);
      const contentEl = document.getElementById(\`\${aiMsgId}-content\`);
      if (contentEl && !aiResponse) {
        contentEl.innerHTML = \`<span style="color:#f44336;">错误: \${error.message}</span>\`;
      }
    });
  }
  
  processStream();
})
.catch(error => {
  console.error('AI请求失败:', error);
  const loadingEl = document.getElementById('ai-loading');
  if (loadingEl) {
    loadingEl.innerHTML = \`<strong>🤖 AI：</strong><br><span style="color:#f44336;">错误: \${error.message}</span>\`;
    loadingEl.style.borderLeftColor = '#f44336';
    loadingEl.removeAttribute('id');
  }
  showMessage('AI请求失败，请检查配置和网络连接', 'error', 5000);
});`;
}

// 应用操作
function goBack() {
    if (app.components.length > 0 && !confirm('返回将丢失未保存的更改，确定吗？')) return;
    window.location.href = '../../index.html';
}

function markUnsaved() {
    document.querySelector('.app-status').textContent = '未保存';
}

function saveApp() {
    const data = JSON.stringify(app, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (app.name || '应用') + '.json';
    a.click();
    URL.revokeObjectURL(url);
    
    app.savedTime = new Date();
    document.querySelector('.app-status').textContent = '已保存';
}

function previewApp() {
    const html = generatePreviewHTML();
    const modal = document.getElementById('previewModal');
    const previewBody = document.getElementById('previewBody');
    
    const iframe = document.createElement('iframe');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '12px';
    iframe.style.background = '#fff';
    
    previewBody.innerHTML = '';
    previewBody.appendChild(iframe);
    
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();
    
    modal.style.display = '';
}

function closePreview() {
    document.getElementById('previewModal').style.display = 'none';
}

async function publishApp() {
    if (!window.JSZip) {
        alert('JSZip 库未加载，请刷新页面重试');
        return;
    }
    
    const zip = new JSZip();
    
    // 生成独立的 HTML、CSS、JS 文件
    const cssContent = generateCSS();
    const jsContent = generateJS();
    
    // 生成引用外部文件的 HTML
    let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${app.name}</title>
    <link rel="stylesheet" href="style.css">
    <!-- 必要的库文件 -->
    <script src="../../lib/xlsx.full.min.js"></script>
    <script src="../../lib/docx.iife.js"></script>
    <script src="../../lib/jszip.min.js"></script>
</head>
<body>
    <div class="app-container">
        <h1 class="app-title">${app.name}</h1>
        <div class="app-content">
`;
    
    app.components.forEach(comp => {
        html += generateComponentHTML(comp);
    });
    
    html += `
        </div>
    </div>
    <div class="toast-container" id="toastContainer"></div>
    <script src="script.js"></script>
</body>
</html>`;
    
    // 添加 README 说明文件
    const readme = `# ${app.name}

## 使用说明

1. 直接双击打开 index.html 即可在浏览器中运行应用
2. 所有文件都在同一目录下，无需额外配置

## 文件说明

- index.html - 应用主页面
- style.css - 样式文件
- script.js - JavaScript 逻辑

## 集成到应用商店

如需将此应用添加到 DataToolbox 应用商店：

1. 将整个文件夹复制到 apps 目录下
2. 编辑 apps.js，在 APPS 数组中添加：

\`\`\`javascript
{
    id: '${app.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}',
    name: '${app.name}',
    desc: '应用描述',
    icon: '📱',
    path: 'apps/${app.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}/index.html',
    cat: 'tool'
}
\`\`\`

3. 刷新主页面即可看到新应用
`;
    
    // 添加文件到 ZIP
    zip.file('index.html', html);
    zip.file('style.css', cssContent);
    zip.file('script.js', jsContent);
    zip.file('README.md', readme);
    
    // 生成并下载 ZIP
    try {
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = app.name + '.zip';
        a.click();
        URL.revokeObjectURL(url);
        
        alert('✅ 应用已打包成功！\n\n📦 已下载: ' + app.name + '.zip\n\n包含文件:\n- index.html\n- style.css\n- script.js\n- README.md\n\n请查看 README.md 了解使用和集成说明');
    } catch (error) {
        console.error('打包失败:', error);
        alert('❌ 打包失败，请重试');
    }
}

function generatePreviewHTML() {
    let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${app.name}</title>
    <script src="../../lib/xlsx.full.min.js"></script>
    <script src="../../lib/docx.iife.js"></script>
    <script src="../../lib/jszip.min.js"></script>
    <style>${generateCSS()}</style>
</head>
<body>
    <div class="app-container">
        <h1 class="app-title">${app.name}</h1>
        <div class="app-content">
`;
    
    app.components.forEach(comp => {
        html += generateComponentHTML(comp);
    });
    
    html += `
        </div>
    </div>
    <div class="toast-container" id="toastContainer"></div>
    <script>${generateJS()}</script>
</body>
</html>`;
    
    return html;
}

function generateComponentHTML(comp) {
    let html = '';
    const props = comp.props;
    const widthStyle = props.width ? ` style="width:${props.width}"` : '';
    const varName = props.varName || comp.id;
    
    switch (comp.type) {
        case 'input':
            const inputType = props.inputType || 'text';
            html = `<div class="form-group"${widthStyle}><label>${props.label}</label>`;
            
            if (inputType === 'textarea') {
                html += `<textarea id="${comp.id}" name="${varName}" placeholder="${props.placeholder}" rows="${props.rows}">${props.value || ''}</textarea>`;
            } else if (inputType === 'number') {
                html += `<input type="number" id="${comp.id}" name="${varName}" min="${props.min}" max="${props.max}" value="${props.value || ''}">`;
            } else if (inputType === 'date') {
                html += `<input type="date" id="${comp.id}" name="${varName}" value="${props.value || ''}">`;
            } else {
                html += `<input type="text" id="${comp.id}" name="${varName}" placeholder="${props.placeholder}" value="${props.value || ''}">`;
            }
            
            html += `</div>`;
            break;
            
        case 'choice':
            const choiceType = props.choiceType || 'select';
            const options = props.options.split('\n').filter(o => o.trim());
            
            html = `<div class="form-group"${widthStyle}><label>${props.label}</label>`;
            
            if (choiceType === 'select') {
                html += `<select id="${comp.id}" name="${varName}"><option value="">请选择</option>`;
                options.forEach(opt => {
                    html += `<option value="${opt}">${opt}</option>`;
                });
                html += `</select>`;
            } else if (choiceType === 'checkbox') {
                html += `<div>`;
                options.forEach(opt => {
                    html += `<label><input type="checkbox" name="${varName}" value="${opt}"><span>${opt}</span></label>`;
                });
                html += `</div>`;
            } else if (choiceType === 'radio') {
                html += `<div>`;
                options.forEach(opt => {
                    html += `<label><input type="radio" name="${varName}" value="${opt}"><span>${opt}</span></label>`;
                });
                html += `</div>`;
            }
            
            html += `</div>`;
            break;
            
        case 'button':
            const onClick = comp.events?.click ? `onclick="handleEvent_${comp.id}()"` : '';
            const btnWidthStyle = props.width ? ` style="width:${props.width}"` : '';
            html = `<button id="${comp.id}" class="btn-${props.variant}" ${onClick}${btnWidthStyle}>${props.text}</button>`;
            break;
            
        case 'fileUpload':
            const acceptAttr = props.accept ? ` accept="${props.accept}"` : '';
            const multipleAttr = props.multiple ? ' multiple' : '';
            html = `<div class="form-group"${widthStyle}>
                <label>${props.label}</label>
                <div class="file-upload-wrapper">
                    <input type="file" id="${comp.id}" name="${varName}" 
                           ${acceptAttr}${multipleAttr} style="display:none;">
                    <div class="file-upload-area" onclick="document.getElementById('${comp.id}').click()">
                        <div class="file-upload-icon">📎</div>
                        <div class="file-upload-text">点击或拖拽文件到此处</div>
                        ${props.showFileName ? `<div class="file-upload-name" id="${comp.id}_name"></div>` : ''}
                    </div>
                </div>
            </div>`;
            break;
            
        case 'display':
            const displayStyle = `min-height:${props.minHeight || '200px'};max-height:${props.maxHeight || '500px'};overflow-y:auto;`;
            html = `<div class="form-group"${widthStyle}>
                <label>${props.label}</label>
                <div class="display-output" id="${comp.id}" data-var="${varName}" style="${displayStyle}">
                    ${props.content ? props.content.replace(/\n/g, '<br>') : '<span style="color:#86868b;">内容为空</span>'}
                </div>
            </div>`;
            break;
            
        default:
            html = `<div><!-- ${comp.type} --></div>`;
    }
    
    return html;
}

function generateCSS() {
    return `
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    padding: 40px 20px;
}
.app-container {
    max-width: 600px;
    margin: 0 auto;
    background: #fff;
    border-radius: 16px;
    padding: 32px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}
.app-title {
    font-size: 28px;
    font-weight: 700;
    color: #1d1d1f;
    margin-bottom: 24px;
    text-align: center;
}
.app-content {
    display: flex;
    flex-direction: column;
    gap: ${app.layout.gap}px;
}
.form-group {
    margin-bottom: 0;
}
.form-group label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: #1d1d1f;
    margin-bottom: 8px;
}
input, select, textarea {
    width: 100%;
    padding: 10px 14px;
    border: 2px solid #e5e5e7;
    border-radius: 8px;
    font-size: 14px;
    font-family: inherit;
    transition: all 0.2s;
}
input:focus, select:focus, textarea:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102,126,234,0.1);
}
button, .btn-primary {
    padding: 12px 24px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
}
button:hover, .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 20px rgba(102,126,234,0.3);
}
.btn-secondary {
    background: #f5f5f7;
    color: #1d1d1f;
    border: 1px solid #d2d2d7;
}
.btn-secondary:hover {
    background: #e8e8ed;
    box-shadow: none;
}
/* 自定义单选框和复选框样式 */
.form-group > div label {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    margin: 6px 0;
    background: #f5f5f7;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
}
.form-group > div label:hover {
    background: #e8e8ed;
}
.form-group > div label input[type="checkbox"],
.form-group > div label input[type="radio"] {
    appearance: none;
    width: 20px;
    height: 20px;
    border: 2px solid #d2d2d7;
    margin-right: 12px;
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;
}
.form-group > div label input[type="checkbox"] {
    border-radius: 6px;
}
.form-group > div label input[type="radio"] {
    border-radius: 50%;
}
.form-group > div label input[type="checkbox"]:checked,
.form-group > div label input[type="radio"]:checked {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-color: #667eea;
}
.form-group > div label:has(input:checked) {
    background: rgba(102,126,234,0.1);
    border-color: #667eea;
}
.form-group > div label input[type="checkbox"]:checked::before {
    content: '✓';
    display: block;
    color: white;
    text-align: center;
    line-height: 16px;
    font-size: 14px;
    font-weight: bold;
}
.form-group > div label input[type="radio"]:checked::before {
    content: '';
    display: block;
    width: 8px;
    height: 8px;
    background: white;
    border-radius: 50%;
    margin: 4px;
}
/* 文件上传样式 */
.file-upload-wrapper {
    position: relative;
}
.file-upload-area {
    border: 2px dashed #d2d2d7;
    border-radius: 8px;
    padding: 30px 20px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    background: #f5f5f7;
}
.file-upload-area:hover {
    border-color: #667eea;
    background: rgba(102,126,234,0.05);
}
.file-upload-area.drag-over {
    border-color: #667eea;
    background: rgba(102,126,234,0.1);
    transform: scale(1.02);
}
.file-upload-icon {
    font-size: 36px;
    margin-bottom: 8px;
}
.file-upload-text {
    font-size: 14px;
    color: #86868b;
}
.file-upload-name {
    margin-top: 8px;
    font-size: 12px;
    color: #667eea;
    font-weight: 600;
}
/* 输出显示样式 */
.display-output {
    border: 2px solid #e5e5e7;
    border-radius: 8px;
    padding: 16px;
    background: #fafafa;
    font-size: 14px;
    line-height: 1.6;
    color: #1d1d1f;
    word-wrap: break-word;
    white-space: pre-wrap;
}
/* 消息提示框 */
.toast-container {
    position: fixed;
    top: 80px;
    right: 20px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 12px;
    pointer-events: none;
}
.toast {
    min-width: 300px;
    max-width: 500px;
    padding: 16px 20px;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    display: flex;
    align-items: center;
    gap: 12px;
    opacity: 0;
    transform: translateX(400px);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: auto;
}
.toast.show {
    opacity: 1;
    transform: translateX(0);
}
.toast-icon {
    font-size: 24px;
    flex-shrink: 0;
}
.toast-content {
    flex: 1;
    font-size: 14px;
    line-height: 1.5;
    color: #1d1d1f;
}
.toast-close {
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: #86868b;
    font-size: 18px;
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.2s;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
}
.toast-close:hover {
    background: #f5f5f7;
    color: #1d1d1f;
}
.toast.success {
    border-left: 4px solid #34c759;
}
.toast.error {
    border-left: 4px solid #ff3b30;
}
.toast.info {
    border-left: 4px solid #007aff;
}
.toast.warning {
    border-left: 4px solid #ff9500;
}
`;
}

function generateJS() {
    let js = '// 应用逻辑\n\n';
    
    // 添加消息提示函数
    js += `// 消息提示函数\nfunction showMessage(message, type = 'info', duration = 3000) {\n  let container = document.getElementById('toastContainer');\n  if (!container) {\n    container = document.createElement('div');\n    container.id = 'toastContainer';\n    container.className = 'toast-container';\n    document.body.appendChild(container);\n  }\n  const toast = document.createElement('div');\n  toast.className = \`toast \${type}\`;\n  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };\n  toast.innerHTML = \`<div class="toast-icon">\${icons[type] || icons.info}</div><div class="toast-content">\${message}</div><button class="toast-close" onclick="this.parentElement.remove()">×</button>\`;\n  container.appendChild(toast);\n  setTimeout(() => toast.classList.add('show'), 10);\n  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, duration);\n}\n\n`;
    
    // 添加全局变量
    if (app.variables.length > 0) {
        js += '// 全局变量\n';
        app.variables.forEach(v => {
            let defaultValue = '';
            switch (v.type) {
                case 'string': defaultValue = "''"; break;
                case 'number': defaultValue = '0'; break;
                case 'boolean': defaultValue = 'false'; break;
                case 'array': defaultValue = '[]'; break;
                case 'object': defaultValue = '{}'; break;
                default: defaultValue = 'null';
            }
            js += `let ${v.name} = ${defaultValue};\n`;
        });
        js += '\n';
    }
    
    // 生成事件处理函数
    app.components.forEach(comp => {
        if (comp.events) {
            Object.entries(comp.events).forEach(([eventType, action]) => {
                js += `function handleEvent_${comp.id}() {\n`;
                if (action.code) {
                    // 处理多行代码的缩进
                    const codeLines = action.code.split('\n');
                    codeLines.forEach(line => {
                        if (line.trim()) {
                            js += `  ${line}\n`;
                        } else {
                            js += '\n';
                        }
                    });
                }
                js += `}\n\n`;
            });
        }
    });
    
    // 添加获取组件值的代码
    js += '// 组件变量（自动更新）\n';
    const componentVars = extractComponentVariables();
    componentVars.forEach(v => {
        if (v.type === 'array') {
            js += `let ${v.varName} = Array.from(document.querySelectorAll('[name="${v.varName}"]:checked')).map(e => e.value);\n`;
        } else if (v.type === 'file') {
            js += `let ${v.varName} = null;\n`;
        } else if (v.choiceType === 'radio') {
            js += `let ${v.varName} = document.querySelector('[name="${v.varName}"]:checked')?.value || '';\n`;
        } else {
            js += `let ${v.varName} = document.getElementById('${v.id}')?.value || '';\n`;
        }
    });
    
    if (componentVars.length > 0) {
        js += '\n// 更新变量值的函数\n';
        js += 'function updateVariables() {\n';
        componentVars.forEach(v => {
            if (v.type === 'array') {
                js += `  ${v.varName} = Array.from(document.querySelectorAll('[name="${v.varName}"]:checked')).map(e => e.value);\n`;
            } else if (v.type === 'file') {
                // 文件类型不在这里更新，由change事件直接更新
            } else if (v.choiceType === 'radio') {
                js += `  ${v.varName} = document.querySelector('[name="${v.varName}"]:checked')?.value || '';\n`;
            } else {
                js += `  ${v.varName} = document.getElementById('${v.id}')?.value || '';\n`;
            }
        });
        js += '}\n\n';
        
        // 添加输入事件监听
        js += '// 自动更新变量\n';
        componentVars.forEach(v => {
            if (v.type === 'array' || v.choiceType === 'radio') {
                js += `document.querySelectorAll('[name="${v.varName}"]').forEach(el => {\n`;
                js += `  el.addEventListener('change', updateVariables);\n`;
                js += `});\n`;
            } else if (v.type === 'file') {
                // 文件上传特殊处理
                js += `const fileInput_${v.id} = document.getElementById('${v.id}');\n`;
                js += `if (fileInput_${v.id}) {\n`;
                js += `  const fileArea_${v.id} = fileInput_${v.id}.closest('.file-upload-wrapper')?.querySelector('.file-upload-area');\n`;
                js += `  fileInput_${v.id}.addEventListener('change', function(e) {\n`;
                js += `    const files = e.target.files;\n`;
                js += `    ${v.varName} = files.length === 1 ? files[0] : (files.length > 0 ? Array.from(files) : null);\n`;
                js += `    const nameEl = document.getElementById('${v.id}_name');\n`;
                js += `    if (nameEl) {\n`;
                js += `      nameEl.textContent = files.length > 0 ? (files.length === 1 ? files[0].name : files.length + ' 个文件') : '';\n`;
                js += `    }\n`;
                js += `  });\n`;
                js += `  if (fileArea_${v.id}) {\n`;
                js += `    fileArea_${v.id}.addEventListener('dragover', function(e) {\n`;
                js += `      e.preventDefault();\n`;
                js += `      e.stopPropagation();\n`;
                js += `      this.classList.add('drag-over');\n`;
                js += `    });\n`;
                js += `    fileArea_${v.id}.addEventListener('dragleave', function(e) {\n`;
                js += `      e.preventDefault();\n`;
                js += `      e.stopPropagation();\n`;
                js += `      this.classList.remove('drag-over');\n`;
                js += `    });\n`;
                js += `    fileArea_${v.id}.addEventListener('drop', function(e) {\n`;
                js += `      e.preventDefault();\n`;
                js += `      e.stopPropagation();\n`;
                js += `      this.classList.remove('drag-over');\n`;
                js += `      fileInput_${v.id}.files = e.dataTransfer.files;\n`;
                js += `      fileInput_${v.id}.dispatchEvent(new Event('change'));\n`;
                js += `    });\n`;
                js += `  }\n`;
                js += `}\n`;
            } else {
                js += `document.getElementById('${v.id}')?.addEventListener('input', updateVariables);\n`;
            }
        });
        js += '\n';
    }
    
    return js;
}

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// 变量管理标签页
function renderVariablesTab() {
    const comp = selectedComponent ? app.components.find(c => c.id === selectedComponent) : null;
    let html = '<div class="property-group">';
    
    // 如果选中了组件，显示该组件的变量配置
    if (comp) {
        if (comp.props.varName !== undefined) {
            html += '<div class="property-group-title">组件变量</div>';
            html += '<div class="property-hint" style="margin-bottom:12px;">此组件的变量名，可在按钮事件中直接使用</div>';
            
            html += `
                <div class="property-field">
                    <label>变量名</label>
                    <input type="text" value="${comp.props.varName}" 
                           onchange="updateComponentProp('${comp.id}', 'varName', this.value)"
                           placeholder="例: userName">
                </div>
            `;
            
            // 显示变量类型
            let varType = 'string';
            let varIcon = '📝';
            if (comp.type === 'input') {
                if (comp.props.inputType === 'number') {
                    varType = 'number';
                    varIcon = '🔢';
                } else if (comp.props.inputType === 'date') {
                    varType = 'date';
                    varIcon = '📅';
                } else if (comp.props.inputType === 'textarea') {
                    varType = 'string';
                    varIcon = '📄';
                } else {
                    varType = 'string';
                    varIcon = '📝';
                }
            } else if (comp.type === 'choice') {
                if (comp.props.choiceType === 'checkbox') {
                    varType = 'array';
                    varIcon = '☑️';
                } else {
                    varType = 'string';
                    varIcon = '🔽';
                }
            } else if (comp.type === 'fileUpload') {
                varType = 'file';
                varIcon = '📎';
            }
            
            html += `
                <div class="property-field">
                    <label>变量类型</label>
                    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f5f5f7;border-radius:6px;">
                        <span style="font-size:16px;">${varIcon}</span>
                        <span style="font-weight:500;">${varType}</span>
                    </div>
                </div>
            `;
            
            // 使用提示
            html += '<div class="property-hint" style="margin-top:16px;padding:12px;background:rgba(102,126,234,0.05);border-radius:8px;">';
            html += '💡 <strong>使用示例：</strong><br>';
            html += '在按钮事件中可以这样使用：<br>';
            html += `<code>console.log(${comp.props.varName});</code><br>`;
            html += `<code>alert('值为: ' + ${comp.props.varName});</code>`;
            html += '</div>';
            
        } else {
            // 按钮组件没有变量
            html += '<div class="property-group-title">组件变量</div>';
            html += '<div class="property-hint" style="text-align:center;padding:40px 20px;color:#86868b;">';
            html += '按钮组件不需要变量<br><br>';
            html += '只有输入和选择组件才有变量';
            html += '</div>';
        }
    } else {
        // 没有选中组件，显示全局变量和所有组件变量列表
        html += '<div class="property-group-title">应用变量</div>';
        html += '<div class="property-hint" style="margin-bottom:12px;">定义可在全局代码和事件中使用的变量</div>';
        
        if (app.variables.length === 0) {
            html += '<div class="property-hint" style="text-align:center;padding:20px;color:#86868b;">暂无自定义变量</div>';
        } else {
            html += '<div class="variable-list">';
            app.variables.forEach((v, idx) => {
                html += `
                    <div class="variable-item">
                        <div class="variable-info">
                            <div class="variable-name">${v.name}</div>
                            <div class="variable-type">${v.type}</div>
                        </div>
                        <button class="var-btn" onclick="editVariable(${idx})">编辑</button>
                        <button class="var-btn delete" onclick="deleteVariable(${idx})">×</button>
                    </div>
                `;
            });
            html += '</div>';
        }
        
        html += `<button class="btn-primary" style="width:100%;margin-top:12px;" onclick="addVariable()">+ 添加变量</button>`;
        
        // 显示所有组件变量
        html += '<div class="property-group-title" style="margin-top:24px;">组件变量</div>';
        html += '<div class="property-hint" style="margin-bottom:12px;">点击可选中对应组件并修改变量名</div>';
        const componentVars = extractComponentVariables();
        if (componentVars.length === 0) {
            html += '<div class="property-hint" style="text-align:center;padding:20px;color:#86868b;">添加输入或选择组件后显示</div>';
        } else {
            html += '<div class="component-var-list">';
            componentVars.forEach(v => {
                html += `
                    <div class="component-var-item" onclick="selectComponent('${v.id}')" title="点击选中并编辑">
                        <span class="comp-var-icon">${v.icon}</span>
                        <div class="comp-var-info">
                            <div class="comp-var-name">${v.varName}</div>
                            <div class="comp-var-label">${v.label}</div>
                        </div>
                        <span class="comp-var-type">${v.type}</span>
                    </div>
                `;
            });
            html += '</div>';
        }
    }
    
    html += '</div>';
    return html;
}

// 提取组件变量
function extractComponentVariables() {
    const vars = [];
    app.components.forEach(comp => {
        // 按钮不算变量
        if (comp.type === 'button') return;
        
        // 只有有varName的组件才算变量
        if (!comp.props.varName) return;
        
        const compDef = COMPONENTS[comp.type];
        let type = 'string';
        let icon = '📝';
        
        if (comp.type === 'input') {
            if (comp.props.inputType === 'number') {
                type = 'number';
                icon = '🔢';
            } else if (comp.props.inputType === 'date') {
                type = 'date';
                icon = '📅';
            } else if (comp.props.inputType === 'textarea') {
                type = 'string';
                icon = '📄';
            } else {
                type = 'string';
                icon = '📝';
            }
        } else if (comp.type === 'choice') {
            if (comp.props.choiceType === 'checkbox') {
                type = 'array';
                icon = '☑️';
            } else {
                type = 'string';
                icon = '🔽';
            }
        } else if (comp.type === 'fileUpload') {
            type = 'file';
            icon = '📎';
        } else if (comp.type === 'display') {
            type = 'display';
            icon = '📺';
        }
        
        vars.push({
            id: comp.id,
            varName: comp.props.varName,
            label: comp.props.label || comp.props.text,
            type: type,
            icon: icon,
            choiceType: comp.props.choiceType // 添加选择类型，用于区分radio/select/checkbox
        });
    });
    return vars;
}

// 添加变量
function addVariable() {
    const name = prompt('变量名称:');
    if (!name) return;
    
    const type = prompt('变量类型 (string/number/boolean/array/object):', 'string');
    if (!type) return;
    
    app.variables.push({
        name: name,
        type: type,
        value: ''
    });
    
    renderPropertyPanel();
    markUnsaved();
}

// 编辑变量
function editVariable(idx) {
    const variable = app.variables[idx];
    const newName = prompt('变量名称:', variable.name);
    if (!newName) return;
    
    const newType = prompt('变量类型:', variable.type);
    if (!newType) return;
    
    variable.name = newName;
    variable.type = newType;
    
    renderPropertyPanel();
    markUnsaved();
}

// 删除变量
function deleteVariable(idx) {
    if (!confirm('确定删除此变量？')) return;
    app.variables.splice(idx, 1);
    renderPropertyPanel();
    markUnsaved();
}


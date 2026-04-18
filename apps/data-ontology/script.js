// 全局状态
let currentUser = null;
let databases = [];
let currentDb = null;
let isEditMode = false;
let editingDbId = null;
let userMgmtMode = false;
let userPasswordTarget = null;

const USER_MIN_PASSWORD_LEN = 4;

function clearUserMgmtCreatePwdHint() {
    const el = document.getElementById('userMgmtCreatePwdHint');
    if (el) {
        el.classList.remove('show');
        el.textContent = '';
    }
}

function clearUserPasswordModalPwdHint() {
    const el = document.getElementById('userPasswordModalPwdHint');
    if (el) {
        el.classList.remove('show');
        el.textContent = '';
    }
}

/** 校验密码与确认密码：先长度再一致性。hintEl 为带 .error-message 的提示节点 */
function validateUserPasswordPair(password, confirm, hintEl) {
    if (!hintEl) return false;
    hintEl.classList.remove('show');
    hintEl.textContent = '';
    if (password.length < USER_MIN_PASSWORD_LEN) {
        hintEl.textContent = '密码至少4位';
        hintEl.classList.add('show');
        return false;
    }
    if (password !== confirm) {
        hintEl.textContent = '两次密码输入不一致';
        hintEl.classList.add('show');
        return false;
    }
    return true;
}

// 接口管理状态
let apis = [];
let currentApi = null;
let isEditApiMode = false;
let editingApiId = null;
let currentApiKey = '';

// AI助手状态
let aiConfig = null;
let aiMessages = [];
let currentDbReference = null;
let dbSuggestionIndex = -1;

const aiModules = [
    { id: 'db-manage', name: '数据库管理', icon: '🗄️', description: '查询、写入、表结构操作' },
    { id: 'api-dispatch', name: '接口分发', icon: '🔌', description: '生成和管理数据接口' },
    { id: 'data-governance', name: '数据治理', icon: '🔧', description: '任务管理与数据处理' },
    { id: 'ontology', name: '本体论抽象', icon: '🧠', description: '开发中...' },
];

let aiSessionContext = {
    databases: [],
    modules: [],
    history: []
};

// API基础URL
const API_BASE = window.location.origin;

const RETURN_URL_KEY = 'dataOntologyReturnUrl';

function saveReturnUrlForLogin() {
    try {
        sessionStorage.setItem(RETURN_URL_KEY, location.pathname + location.search + location.hash);
    } catch (e) {}
}

function handleUnauthorizedFromApi() {
    if (!localStorage.getItem('dataOntologyToken')) return;
    try { closeUserMgmtPanel(true); } catch (e) {}
    try { window._qualityAuditDataLoaded = false; } catch (e) {}
    saveReturnUrlForLogin();
    localStorage.removeItem('dataOntologyToken');
    localStorage.removeItem('dataOntologyUser');
    currentUser = null;
    databases = [];
    currentDb = null;
    govTasks = [];
    currentGovTask = null;
    showLoginPage();
}

async function fetchWithAuth(input, init) {
    const initCopy = init ? { ...init } : {};
    const headers = new Headers(initCopy.headers || {});
    const token = localStorage.getItem('dataOntologyToken');
    if (token) {
        headers.set('Authorization', 'Bearer ' + token);
    }
    const response = await fetch(input, { ...initCopy, headers });
    if (response.status === 401) {
        handleUnauthorizedFromApi();
        return response;
    }
    const ct = response.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) {
        const cloned = response.clone();
        try {
            const data = await cloned.json();
            if (data && data.success === false && typeof data.message === 'string' && data.message.indexOf('未授权') !== -1) {
                handleUnauthorizedFromApi();
            }
        } catch (e) {}
    }
    return response;
}

/**
 * 统一的 API 请求封装函数
 * @param {string} endpoint - API 端点路径（不含 API_BASE）
 * @param {Object} options - 请求选项
 * @param {string} options.method - HTTP 方法（默认 GET）
 * @param {Object} options.body - 请求体（会自动 JSON 序列化）
 * @param {string} options.errorPrefix - 错误消息前缀（默认 '操作失败'）
 * @param {boolean} options.showToastOnError - 是否在错误时显示 toast（默认 true）
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
async function apiRequest(endpoint, options = {}) {
    const { method = 'GET', body, errorPrefix = '操作失败', showToastOnError = true } = options;
    
    const init = { method };
    if (body) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(body);
    }
    
    try {
        const response = await fetchWithAuth(`${API_BASE}${endpoint}`, init);
        const data = await response.json();
        
        if (!data.success && showToastOnError) {
            showToast(`${errorPrefix}：${data.message || '未知错误'}`, 'error');
        }
        
        return { success: data.success, data, error: data.success ? null : (data.message || '未知错误') };
    } catch (error) {
        const errorMsg = error.message || '网络错误';
        if (showToastOnError) {
            showToast(`${errorPrefix}：${errorMsg}`, 'error');
        }
        return { success: false, error: errorMsg };
    }
}

// ---- 演示库（前端模拟 SQLite 内存库；后端未持久化该 ID）----
const DEMO_ONTOLOGY_DB_ID = 'demo-ontology-memory';

const DEMO_ONTOLOGY_TABLES = {
    customers: {
        columns: [
            { name: 'id', type: 'INTEGER', nullable: false },
            { name: 'name', type: 'TEXT', nullable: false },
            { name: 'email', type: 'TEXT', nullable: true }
        ],
        rows: [
            { id: 1, name: '张三', email: 'zhang@example.com' },
            { id: 2, name: '李四', email: 'li@example.com' }
        ]
    },
    products: {
        columns: [
            { name: 'id', type: 'INTEGER', nullable: false },
            { name: 'name', type: 'TEXT', nullable: false },
            { name: 'price', type: 'REAL', nullable: false }
        ],
        rows: [
            { id: 101, name: '笔记本', price: 5999 },
            { id: 102, name: '鼠标', price: 99 }
        ]
    },
    orders: {
        columns: [
            { name: 'id', type: 'INTEGER', nullable: false },
            { name: 'customer_id', type: 'INTEGER', nullable: false },
            { name: 'order_date', type: 'TEXT', nullable: false },
            { name: 'total', type: 'REAL', nullable: false }
        ],
        rows: [
            { id: 1001, customer_id: 1, order_date: '2025-03-01', total: 6098 },
            { id: 1002, customer_id: 2, order_date: '2025-03-02', total: 99 }
        ]
    },
    order_items: {
        columns: [
            { name: 'id', type: 'INTEGER', nullable: false },
            { name: 'order_id', type: 'INTEGER', nullable: false },
            { name: 'product_id', type: 'INTEGER', nullable: false },
            { name: 'qty', type: 'INTEGER', nullable: false },
            { name: 'unit_price', type: 'REAL', nullable: false }
        ],
        rows: [
            { id: 1, order_id: 1001, product_id: 101, qty: 1, unit_price: 5999 },
            { id: 2, order_id: 1001, product_id: 102, qty: 1, unit_price: 99 },
            { id: 3, order_id: 1002, product_id: 102, qty: 1, unit_price: 99 }
        ]
    },
    payments: {
        columns: [
            { name: 'id', type: 'INTEGER', nullable: false },
            { name: 'order_id', type: 'INTEGER', nullable: false },
            { name: 'amount', type: 'REAL', nullable: false },
            { name: 'paid_at', type: 'TEXT', nullable: true }
        ],
        rows: [
            { id: 1, order_id: 1001, amount: 6098, paid_at: '2025-03-01T10:00:00' },
            { id: 2, order_id: 1002, amount: 99, paid_at: '2025-03-02T15:00:00' }
        ]
    },
    report_sales: {
        columns: [
            { name: 'period', type: 'TEXT', nullable: false },
            { name: 'sku', type: 'TEXT', nullable: false },
            { name: 'qty_sold', type: 'INTEGER', nullable: false },
            { name: 'revenue', type: 'REAL', nullable: false }
        ],
        rows: [
            { period: '2025-03', sku: '笔记本', qty_sold: 1, revenue: 5999 },
            { period: '2025-03', sku: '鼠标', qty_sold: 2, revenue: 198 }
        ]
    }
};

/** 外键 + ETL：kind==='etl' 表示 from 聚合到 to（与 FK 箭头方向相反） */
const DEMO_ONTOLOGY_LINEAGE_EDGES = [
    { fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id' },
    { fromTable: 'order_items', fromColumn: 'order_id', toTable: 'orders', toColumn: 'id' },
    { fromTable: 'order_items', fromColumn: 'product_id', toTable: 'products', toColumn: 'id' },
    { fromTable: 'payments', fromColumn: 'order_id', toTable: 'orders', toColumn: 'id' },
    { fromTable: 'orders', fromColumn: '(聚合)', toTable: 'report_sales', toColumn: '(ETL)', kind: 'etl' },
    { fromTable: 'order_items', fromColumn: '(聚合)', toTable: 'report_sales', toColumn: '(ETL)', kind: 'etl' }
];

function getDemoDatabaseListEntry() {
    return {
        id: DEMO_ONTOLOGY_DB_ID,
        type: 'sqlite',
        name: '演示库（内存模拟）',
        host: '',
        port: 0,
        path: ':memory:',
        user: '',
        database: 'demo_shop'
    };
}

function mergeDemoDatabaseIntoList() {
    if (databases.some(d => d.id === DEMO_ONTOLOGY_DB_ID)) return;
    databases.push(getDemoDatabaseListEntry());
}

function demoOntologyJsonResponse(obj, status) {
    const s = status === undefined ? 200 : status;
    return Promise.resolve(new Response(JSON.stringify(obj), {
        status: s,
        headers: { 'Content-Type': 'application/json' }
    }));
}

function parseDemoOntologyApiPath(pathname) {
    const prefix = '/api/data-ontology/databases/' + DEMO_ONTOLOGY_DB_ID;
    if (!pathname.startsWith(prefix)) return null;
    const rest = pathname.slice(prefix.length);
    if (!rest || rest === '/') return { kind: 'detail' };
    if (rest === '/lineage') return { kind: 'lineage' };
    const m = rest.match(/^\/tables\/([^/]+)(\/structure|\/data|\/rename)?$/);
    if (m) {
        return {
            kind: 'table',
            table: decodeURIComponent(m[1]),
            sub: m[2] || ''
        };
    }
    return { kind: 'unknown' };
}

function handleDemoOntologyFetch(url, init) {
    let pathname;
    try {
        pathname = new URL(url, API_BASE).pathname;
    } catch (e) {
        return null;
    }
    const parsed = parseDemoOntologyApiPath(pathname);
    if (!parsed) return null;
    const method = (init && init.method) ? init.method.toUpperCase() : 'GET';

    if (parsed.kind === 'detail') {
        if (method === 'GET') {
            const tableNames = Object.keys(DEMO_ONTOLOGY_TABLES);
            return demoOntologyJsonResponse({
                success: true,
                database: {
                    id: DEMO_ONTOLOGY_DB_ID,
                    type: 'sqlite',
                    name: getDemoDatabaseListEntry().name,
                    host: '',
                    port: 0,
                    path: ':memory:',
                    database: 'demo_shop',
                    connected: true,
                    tables: tableNames
                }
            });
        }
        if (method === 'DELETE') {
            const i = databases.findIndex(d => d.id === DEMO_ONTOLOGY_DB_ID);
            if (i >= 0) databases.splice(i, 1);
            return demoOntologyJsonResponse({ success: true });
        }
        return demoOntologyJsonResponse({ success: false, message: '演示库不支持此操作' }, 400);
    }

    if (parsed.kind === 'lineage' && method === 'GET') {
        const tables = Object.keys(DEMO_ONTOLOGY_TABLES);
        return demoOntologyJsonResponse({
            success: true,
            dbType: 'sqlite',
            tables,
            edges: DEMO_ONTOLOGY_LINEAGE_EDGES,
            edgeCount: DEMO_ONTOLOGY_LINEAGE_EDGES.length,
            message: '演示数据：外键血缘 + ETL（report_sales）'
        });
    }

    if (parsed.kind === 'table') {
        const tdef = DEMO_ONTOLOGY_TABLES[parsed.table];
        if (!tdef) {
            return demoOntologyJsonResponse({ success: false, message: '表不存在' }, 404);
        }
        if (parsed.sub === '/structure' && method === 'GET') {
            return demoOntologyJsonResponse({ success: true, columns: tdef.columns });
        }
        if (parsed.sub === '' && method === 'GET') {
            return demoOntologyJsonResponse({ success: true, data: tdef.rows });
        }
        return demoOntologyJsonResponse({ success: false, message: '演示库为只读' }, 400);
    }

    return demoOntologyJsonResponse({ success: false, message: '无效的演示库请求' }, 404);
}

(function installDemoOntologyFetchInterceptor() {
    const origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url);
        if (typeof url === 'string' && url.indexOf('/api/data-ontology/databases/' + DEMO_ONTOLOGY_DB_ID) !== -1) {
            const r = handleDemoOntologyFetch(url, init);
            if (r) return r;
        }
        return origFetch(input, init);
    };
})();

function initDemoData() {
    mergeDemoDatabaseIntoList();
}

// ==================== 全局错误处理与 Toast 通知系统 ====================

// Toast 通知系统（替代 alert，提升用户体验）
let toastContainer = null;

function initToastContainer() {
    if (toastContainer) return;
    toastContainer = document.createElement('div');
    toastContainer.id = 'toastContainer';
    toastContainer.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
    `;
    document.body.appendChild(toastContainer);
}

/**
 * 显示 Toast 通知
 * @param {string} message - 消息内容
 * @param {string} type - 类型: 'success' | 'error' | 'warning' | 'info'
 * @param {number} duration - 显示时长（毫秒），默认 3000
 */
function showToast(message, type = 'info', duration = 3000) {
    if (!toastContainer) initToastContainer();
    
    const colors = {
        success: { bg: '#10b981', icon: '✓' },
        error: { bg: '#ef4444', icon: '✗' },
        warning: { bg: '#f59e0b', icon: '⚠' },
        info: { bg: '#3b82f6', icon: 'ℹ' }
    };
    const config = colors[type] || colors.info;
    
    const toast = document.createElement('div');
    toast.style.cssText = `
        background: ${config.bg};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        font-size: 14px;
        max-width: 360px;
        word-wrap: break-word;
        pointer-events: auto;
        cursor: pointer;
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        gap: 8px;
    `;
    toast.innerHTML = `<span style="font-size:16px">${config.icon}</span><span>${escapeHtml(message)}</span>`;
    
    toast.onclick = () => removeToast(toast);
    toastContainer.appendChild(toast);
    
    // 触发动画
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    });
    
    // 自动消失
    if (duration > 0) {
        setTimeout(() => removeToast(toast), duration);
    }
    
    return toast;
}

function removeToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.parentNode && toast.parentNode.removeChild(toast), 300);
}

/**
 * 模态框辅助函数
 * @param {string} modalId - 模态框元素ID
 * @param {boolean} show - true显示，false隐藏
 */
function toggleModal(modalId, show) {
    const modal = document.getElementById(modalId);
    if (modal) {
        if (show) {
            modal.classList.add('show');
        } else {
            modal.classList.remove('show');
        }
    }
}

/**
 * 显示模态框并清除错误/成功提示
 * @param {string} modalId - 模态框ID
 * @param {string[]} clearIds - 需要隐藏的错误/成功提示元素ID数组
 */
function showModal(modalId, clearIds = []) {
    toggleModal(modalId, true);
    clearIds.forEach(id => toggleModal(id, false));
}

/**
 * 隐藏模态框
 * @param {string} modalId - 模态框ID
 */
function hideModal(modalId) {
    toggleModal(modalId, false);
}

/**
 * 复制文本到剪贴板，并更新按钮状态
 * @param {string} text - 要复制的文本
 * @param {HTMLElement} btnEl - 按钮元素（可选，用于显示复制状态）
 * @param {string} successText - 成功时的文本（默认 '已复制'）
 * @param {number} duration - 状态恢复时间（毫秒，默认 1500）
 */
function copyToClipboard(text, btnEl, successText = '已复制', duration = 1500) {
    if (!text) return Promise.resolve(false);
    return navigator.clipboard.writeText(text).then(() => {
        if (btnEl) {
            const originalText = btnEl.textContent;
            btnEl.textContent = successText;
            setTimeout(() => { btnEl.textContent = originalText; }, duration);
        }
        return true;
    }).catch(err => {
        console.error('复制失败:', err);
        showToast('复制失败', 'error');
        return false;
    });
}

// 全局错误处理（统一在 setupGlobalErrorHandlers 中初始化）

// 初始化全局错误处理器
function setupGlobalErrorHandlers() {
    // 处理未捕获的 Promise rejection
    window.addEventListener('unhandledrejection', function(event) {
        console.error('未捕获的 Promise 异常:', event.reason);
        const msg = event.reason?.message || String(event.reason) || '未知错误';
        showToast('操作失败: ' + msg, 'error', 5000);
        event.preventDefault(); // 阻止默认的控制台错误输出
    });
    
    // 处理全局 JavaScript 错误
    window.addEventListener('error', function(event) {
        // 忽略脚本加载错误（通常由网络问题引起）
        if (event.target && (event.target.tagName === 'SCRIPT' || event.target.tagName === 'LINK' || event.target.tagName === 'IMG')) {
            return;
        }
        console.error('JavaScript 错误:', event.message);
        // 仅在非开发环境显示用户友好提示
        if (event.message && !event.message.includes('Script error')) {
            showToast('页面出现错误，请刷新重试', 'error', 4000);
        }
    }, true);
}

// 初始化
document.addEventListener('DOMContentLoaded', async function() {
    // 初始化全局错误处理
    setupGlobalErrorHandlers();
    initToastContainer();
    
    // 检测是否通过服务端运行
    if (!checkServerAvailability()) {
        return; // 如果服务端不可用，直接返回，不初始化应用
    }

    // 检查登录状态
    const token = localStorage.getItem('dataOntologyToken');
    if (token) {
        currentUser = localStorage.getItem('dataOntologyUser');
        if (currentUser) {
            showMainPage();
            loadDatabases();
            loadGovernanceTasks();
        }
    }

    initEventListeners();
});

// 检测服务端是否可用
function checkServerAvailability() {
    // 检测1: 检查是否通过 file:// 协议打开
    if (window.location.protocol === 'file:') {
        showServerError('检测到通过 file:// 协议打开文件。当前协议：' + window.location.protocol);
        return false;
    }

    // 检测2: 检查是否有有效的服务器地址
    if (!window.location.origin || window.location.origin === 'null') {
        showServerError('无法检测到有效的服务器地址。');
        return false;
    }

    // 检测3: 异步检查服务器是否响应（可选，这里先返回true）
    // 后续的API调用失败会自然地显示错误
    return true;
}

// 显示服务端错误页面
function showServerError(detail) {
    // 隐藏所有页面
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('mainPage').style.display = 'none';
    
    // 显示错误页面
    const errorPage = document.getElementById('serverErrorPage');
    errorPage.style.display = 'block';
    
    // 设置错误详情
    document.getElementById('serverErrorDetail').textContent = detail;
    
    // 绑定返回按钮事件
    const returnBtn = document.getElementById('returnToMainBtn');
    if (returnBtn) {
        returnBtn.onclick = function() {
            // 返回应用商店主界面
            window.location.href = '../../index.html';
        };
    }
}

// 初始化事件监听
function initEventListeners() {
    // 登录表单
    document.getElementById('loginForm').addEventListener('submit', handleLogin);

    // 退出登录
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // 标签页切换
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            if (!this.disabled) {
                switchTab(this.dataset.tab);
            }
        });
    });

    // 添加数据库
    document.getElementById('addDbBtn').addEventListener('click', showAddDbModal);

    // 数据库类型切换
    document.getElementById('dbTypeInput').addEventListener('change', handleDbTypeChange);

    // 弹窗关闭
    document.querySelector('.modal-close').addEventListener('click', hideAddDbModal);
    document.getElementById('addDbModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideAddDbModal();
        }
    });

    // 测试连接
    document.getElementById('testConnectionBtn').addEventListener('click', testConnection);

    // 添加数据库表单
    document.getElementById('addDbForm').addEventListener('submit', handleAddDatabase);

    // 编辑数据库
    document.getElementById('editDbBtn').addEventListener('click', handleEditDatabase);

    // 刷新数据库
    document.getElementById('refreshDbBtn').addEventListener('click', function() {
        if (currentDb) {
            loadDatabaseDetail(currentDb.id);
        }
    });

    // 删除数据库
    document.getElementById('deleteDbBtn').addEventListener('click', handleDeleteDatabase);

    // 关闭预览（已在closePreview函数中处理）
    
    // 创建表事件
    document.getElementById('createTableForm').addEventListener('submit', handleCreateTable);
    document.getElementById('addColumnBtn').addEventListener('click', addTableColumn);
    document.getElementById('closeCreateTableModal').addEventListener('click', hideCreateTableModal);
    document.getElementById('createTableModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideCreateTableModal();
        }
    });

    // 接口管理事件
    document.getElementById('apikeyTriggerBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        const popover = document.getElementById('apikeyPopover');
        const btn = document.getElementById('apikeyTriggerBtn');
        popover.classList.toggle('show');
        if (popover.classList.contains('show')) {
            var rect = btn.getBoundingClientRect();
            var popoverW = 270;
            var sidebarWidth = 330;
            // 弹层始终在侧栏右侧打开，绝不覆盖接口列表（left 至少为 sidebarWidth）
            var targetLeft = Math.max(rect.right, sidebarWidth);
            if (targetLeft + popoverW <= window.innerWidth) {
                popover.style.left = targetLeft + 'px';
                popover.style.right = 'auto';
            } else {
                popover.style.right = '20px';
                popover.style.left = 'auto';
            }
            popover.style.top = rect.top + 'px';
        }
    });
    // API Key 弹出层关闭处理器（保存引用避免重复添加）
    if (!window._apikeyPopoverClickHandler) {
        window._apikeyPopoverClickHandler = function(e) {
            const popover = document.getElementById('apikeyPopover');
            if (popover && !popover.contains(e.target) && e.target.id !== 'apikeyTriggerBtn') {
                popover.classList.remove('show');
            }
        };
        document.addEventListener('click', window._apikeyPopoverClickHandler);
    }
    document.getElementById('generateApikeyBtn').addEventListener('click', generateApiKey);
    document.getElementById('copyApikeyBtn').addEventListener('click', copyApiKey);
    document.getElementById('deleteApikeyBtn').addEventListener('click', deleteApiKey);
    document.getElementById('addApiBtn').addEventListener('click', showAddApiModal);
    document.getElementById('closeApiModal').addEventListener('click', hideAddApiModal);
    document.getElementById('addApiModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideAddApiModal();
        }
    });
    document.getElementById('addApiForm').addEventListener('submit', handleAddApi);
    document.querySelectorAll('input[name="apiType"]').forEach(radio => {
        radio.addEventListener('change', () => switchApiTypeFields(radio.value));
    });
    document.getElementById('editApiBtn').addEventListener('click', handleEditApi);
    document.getElementById('testApiBtn').addEventListener('click', showTestApiModal);
    document.getElementById('deleteApiBtn').addEventListener('click', handleDeleteApi);

    // MCP 模块事件
    const mcpCopyBaseUrlBtn = document.getElementById('mcpCopyBaseUrlBtn');
    if (mcpCopyBaseUrlBtn) mcpCopyBaseUrlBtn.addEventListener('click', function() {
        copyToClipboard(API_BASE || window.location.origin, this);
    });
    const mcpCopyKeyBtn = document.getElementById('mcpCopyKeyBtn');
    if (mcpCopyKeyBtn) mcpCopyKeyBtn.addEventListener('click', function() {
        if (!currentApiKey) return;
        copyToClipboard(currentApiKey, this);
    });
    const mcpGenerateKeyBtn = document.getElementById('mcpGenerateKeyBtn');
    if (mcpGenerateKeyBtn) mcpGenerateKeyBtn.addEventListener('click', async function() {
        await generateApiKey();
        loadMcpInfo();
    });
    const mcpCopyConfigBtn = document.getElementById('mcpCopyConfigBtn');
    if (mcpCopyConfigBtn) mcpCopyConfigBtn.addEventListener('click', function() {
        const pre = document.getElementById('mcpConfigPre');
        if (!pre) return;
        copyToClipboard(pre.textContent, this, '已复制');
    });
    
    // 测试接口事件
    document.getElementById('closeTestApiModal').addEventListener('click', hideTestApiModal);
    document.getElementById('testApiModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideTestApiModal();
        }
    });
    document.getElementById('executeTestBtn').addEventListener('click', executeApiTest);
    
    // AI助手事件
    document.getElementById('aiSettingsBtn').addEventListener('click', showAiSettingsModal);
    document.getElementById('closeAiSettingsModal').addEventListener('click', hideAiSettingsModal);
    document.getElementById('aiSettingsModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideAiSettingsModal();
        }
    });
    document.getElementById('aiSettingsForm').addEventListener('submit', handleSaveAiSettings);
    document.getElementById('aiSendBtn').addEventListener('click', handleSendAiMessage);
    document.getElementById('aiInput').addEventListener('keydown', handleAiInputKeydown);
    document.getElementById('aiInput').addEventListener('input', handleAiInputChange);
    
    // 设置弹窗事件
    document.getElementById('settingsBtn').addEventListener('click', showSettingsModal);
    document.getElementById('closeSettingsModal').addEventListener('click', hideSettingsModal);
    document.getElementById('settingsModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideSettingsModal();
        }
    });
    document.getElementById('saveTabSettingsBtn').addEventListener('click', saveTabSettings);
    document.getElementById('resetTabSettingsBtn').addEventListener('click', resetTabSettings);
    
    // 清除AI上下文按钮（稍后会动态添加）

    const userMgmtHeaderBtn = document.getElementById('userMgmtHeaderBtn');
    if (userMgmtHeaderBtn) {
        userMgmtHeaderBtn.addEventListener('click', function () {
            if (currentUser !== 'admin') return;
            if (userMgmtMode) {
                closeUserMgmtPanel();
            } else {
                openUserMgmtPanel();
            }
        });
    }
    const userMgmtBackdrop = document.getElementById('userMgmtDrawerBackdrop');
    if (userMgmtBackdrop) userMgmtBackdrop.addEventListener('click', function () { closeUserMgmtPanel(); });
    const userMgmtCloseBtn = document.getElementById('userMgmtCloseBtn');
    if (userMgmtCloseBtn) userMgmtCloseBtn.addEventListener('click', function () { closeUserMgmtPanel(); });
    const createUserBtn = document.getElementById('createUserBtn');
    if (createUserBtn) createUserBtn.addEventListener('click', handleCreateUser);
    const closeUserPasswordModal = document.getElementById('closeUserPasswordModal');
    if (closeUserPasswordModal) closeUserPasswordModal.addEventListener('click', hideUserPasswordModal);
    const userPasswordModal = document.getElementById('userPasswordModal');
    if (userPasswordModal) {
        userPasswordModal.addEventListener('click', function (e) {
            if (e.target === this) hideUserPasswordModal();
        });
    }
    const submitUserPasswordBtn = document.getElementById('submitUserPasswordBtn');
    if (submitUserPasswordBtn) submitUserPasswordBtn.addEventListener('click', submitUserPasswordChange);
    const newUserPwd = document.getElementById('newUserPassword');
    const newUserPwdConfirm = document.getElementById('newUserPasswordConfirm');
    if (newUserPwd) newUserPwd.addEventListener('input', clearUserMgmtCreatePwdHint);
    if (newUserPwdConfirm) newUserPwdConfirm.addEventListener('input', clearUserMgmtCreatePwdHint);
    const editPwd = document.getElementById('editPasswordInput');
    const editPwdConfirm = document.getElementById('editPasswordConfirmInput');
    if (editPwd) editPwd.addEventListener('input', clearUserPasswordModalPwdHint);
    if (editPwdConfirm) editPwdConfirm.addEventListener('input', clearUserPasswordModalPwdHint);
}

// 登录处理
async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('loginError');

    try {
        const response = await fetch(`${API_BASE}/api/data-ontology/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            currentUser = username;
            localStorage.setItem('dataOntologyToken', data.token);
            localStorage.setItem('dataOntologyUser', username);
            showMainPage();
            loadDatabases();
            loadGovernanceTasks();
            try {
                const ret = sessionStorage.getItem(RETURN_URL_KEY);
                if (ret) {
                    sessionStorage.removeItem(RETURN_URL_KEY);
                    const cur = location.pathname + location.search + location.hash;
                    if (ret !== cur) {
                        location.replace(ret);
                    }
                }
            } catch (e) {}
        } else {
            errorEl.textContent = data.message || '登录失败';
            errorEl.classList.add('show');
        }
    } catch (error) {
        errorEl.textContent = '登录失败：' + error.message;
        errorEl.classList.add('show');
    }
}

// 退出登录
function handleLogout() {
    closeUserMgmtPanel(true);
    try { sessionStorage.removeItem(RETURN_URL_KEY); } catch (e) {}
    try { window._qualityAuditDataLoaded = false; } catch (e) {}
    localStorage.removeItem('dataOntologyToken');
    localStorage.removeItem('dataOntologyUser');
    currentUser = null;
    databases = [];
    currentDb = null;
    govTasks = [];
    currentGovTask = null;
    showLoginPage();
}

// 显示登录页面
function showLoginPage() {
    document.getElementById('loginPage').classList.add('active');
    document.getElementById('mainPage').classList.remove('active');
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    document.getElementById('loginError').classList.remove('show');
}

// 显示主页面
function showMainPage() {
    document.getElementById('loginPage').classList.remove('active');
    document.getElementById('mainPage').classList.add('active');
    document.getElementById('currentUser').textContent = currentUser;
    updateUserMgmtNavVisibility();
    // 应用标签页可见性设置
    applyTabVisibility();
    try {
        if (location.hash === '#quality') {
            switchTab('quality');
        }
    } catch (e) {}
}

function updateUserMgmtNavVisibility() {
    const btn = document.getElementById('userMgmtHeaderBtn');
    if (btn) {
        btn.style.display = currentUser === 'admin' ? 'inline-flex' : 'none';
    }
    const govRefresh = document.getElementById('govRefreshExamplesBtn');
    if (govRefresh) {
        govRefresh.style.display = currentUser === 'admin' ? 'inline-flex' : 'none';
    }
}

// 切换标签页
function switchTab(tabName) {
    if (tabName !== 'database') {
        closeUserMgmtPanel();
        const wv = document.getElementById('welcomeView');
        const dv = document.getElementById('dbDetailView');
        if (wv && dv) {
            if (currentDb) {
                wv.style.display = 'none';
                dv.style.display = 'block';
            } else {
                wv.style.display = 'block';
                dv.style.display = 'none';
            }
        }
    }
    // 更新标签按钮状态
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // 更新标签内容
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}Tab`).classList.add('active');

    // 标签页切换时加载数据
    if (tabName === 'api') {
        loadApis();
        loadApiKey();
    } else if (tabName === 'mcp') {
        loadMcpInfo();
    } else if (tabName === 'ai') {
        loadAiConfig();
        updateAiContextDisplay();
    } else if (tabName === 'governance') {
        loadGovernanceTasks();
    } else if (tabName === 'ontology') {
        initOntologyTab();
    } else if (tabName === 'models') {
        initModelsTab();
    } else if (tabName === 'lineage') {
        initLineageTab();
        if (!window._lineageDemoAutoLoaded) {
            window._lineageDemoAutoLoaded = true;
            const demo = databases.find(d => d.id === DEMO_ONTOLOGY_DB_ID);
            if (demo && !lineageSelectedDbId) {
                selectLineageDb(demo.id, demo.name, demo.type);
            }
            if (lineageSelectedDbId) {
                loadLineageGraph();
            }
        }
    } else if (tabName === 'quality') {
        if (typeof window.initQualityAuditTab === 'function') {
            window.initQualityAuditTab();
        }
    }
}

// 数据库类型默认端口配置
const dbTypeDefaults = {
    // 关系型数据库
    mysql: { port: 3306, requiresDb: true },
    mariadb: { port: 3306, requiresDb: true },
    postgresql: { port: 5432, requiresDb: true },
    sqlserver: { port: 1433, requiresDb: true },
    oracle: { port: 1521, requiresDb: true },
    dm: { port: 5236, requiresDb: true },
    sqlite: { port: 0, requiresDb: false, isFile: true },
    duckdb: { port: 0, requiresDb: false, isFile: true },
    
    // 分布式数据库
    tidb: { port: 4000, requiresDb: true },
    cockroachdb: { port: 26257, requiresDb: true },
    
    // 文档型数据库
    mongodb: { port: 27017, requiresDb: true },
    
    // KV存储/缓存
    redis: { port: 6379, requiresDb: false },
    memcached: { port: 11211, requiresDb: false },
    
    // 列式数据库
    clickhouse: { port: 9000, requiresDb: true },
    cassandra: { port: 9042, requiresDb: true },
    hbase: { port: 9090, requiresDb: false },
    
    // 时序数据库
    influxdb: { port: 8086, requiresDb: true },
    timescaledb: { port: 5432, requiresDb: true },
    
    // 搜索引擎
    elasticsearch: { port: 9200, requiresDb: false },
    
    // 图数据库
    neo4j: { port: 7687, requiresDb: false }
};

// 数据库类型图标映射
const dbTypeIcons = {
    mysql: '🐬',
    mariadb: '🦭',
    postgresql: '🐘',
    sqlserver: '🪟',
    oracle: '🔶',
    dm: '📊',
    sqlite: '📁',
    duckdb: '🦆',
    tidb: '🐯',
    cockroachdb: '🪳',
    mongodb: '🍃',
    redis: '🔴',
    memcached: '💾',
    clickhouse: '⚡',
    cassandra: '💍',
    hbase: '🏔️',
    influxdb: '⏱️',
    timescaledb: '⏰',
    elasticsearch: '🔍',
    neo4j: '🕸️'
};

// 处理数据库类型切换
function handleDbTypeChange() {
    const dbType = document.getElementById('dbTypeInput').value;
    const config = dbTypeDefaults[dbType];
    
    const sqlFields = document.getElementById('sqlFields');
    const sqliteFields = document.getElementById('sqliteFields');
    const dbDatabaseGroup = document.getElementById('dbDatabaseGroup');
    
    if (config.isFile) {
        // 文件数据库 (SQLite, DuckDB)
        sqlFields.style.display = 'none';
        sqliteFields.style.display = 'block';
        document.getElementById('dbPathInput').placeholder = 
            dbType === 'duckdb' ? '例如: /path/to/database.duckdb' : '例如: /path/to/database.db';
    } else {
        // 网络数据库
        sqlFields.style.display = 'block';
        sqliteFields.style.display = 'none';
        
        // 设置默认端口
        document.getElementById('dbPortInput').value = config.port;
        
        // 根据数据库类型显示/隐藏数据库名字段
        if (config.requiresDb) {
            dbDatabaseGroup.style.display = 'block';
            document.getElementById('dbDatabaseInput').required = true;
            
            // 更新标签和占位符
            const label = document.querySelector('#dbDatabaseGroup label');
            const input = document.getElementById('dbDatabaseInput');
            if (dbType === 'redis') {
                label.textContent = '数据库索引';
                input.placeholder = '例如: 0 (默认)';
            } else if (dbType === 'cassandra') {
                label.textContent = 'Keyspace';
                input.placeholder = '例如: my_keyspace';
            } else if (dbType === 'neo4j') {
                label.textContent = '数据库名称';
                input.placeholder = '例如: neo4j';
            } else if (dbType === 'oracle') {
                label.textContent = 'SID/服务名';
                input.placeholder = '例如: ORCL、XE 或服务名';
            } else {
                label.textContent = '数据库名';
                input.placeholder = '要连接的数据库';
            }
        } else {
            dbDatabaseGroup.style.display = 'none';
            document.getElementById('dbDatabaseInput').required = false;
        }
    }
}

// 显示添加数据库弹窗
function showAddDbModal() {
    isEditMode = false;
    editingDbId = null;
    document.getElementById('modalTitle').textContent = '添加数据库';
    document.getElementById('addDbModal').classList.add('show');
    document.getElementById('addDbForm').reset();
    document.getElementById('dbTypeInput').value = 'mysql';
    document.getElementById('dbTypeInput').disabled = false;
    handleDbTypeChange();
    document.getElementById('dbFormError').classList.remove('show');
    document.getElementById('dbFormSuccess').classList.remove('show');
}

// 显示编辑数据库弹窗
function handleEditDatabase() {
    if (!currentDb) return;
    
    isEditMode = true;
    editingDbId = currentDb.id;
    document.getElementById('modalTitle').textContent = '编辑数据库';
    document.getElementById('addDbModal').classList.add('show');
    
    // 预填充配置
    document.getElementById('dbTypeInput').value = currentDb.type;
    document.getElementById('dbTypeInput').disabled = true; // 不允许修改类型
    document.getElementById('dbNameInput').value = currentDb.name;
    
    if (dbTypeDefaults[currentDb.type].isFile) {
        document.getElementById('dbPathInput').value = currentDb.path || '';
    } else {
        document.getElementById('dbHostInput').value = currentDb.host || '';
        document.getElementById('dbPortInput').value = currentDb.port || '';
        document.getElementById('dbUserInput').value = currentDb.user || '';
        document.getElementById('dbPasswordInput').value = ''; // 不显示密码
        document.getElementById('dbPasswordInput').placeholder = '如不修改密码请留空';
        if (dbTypeDefaults[currentDb.type].requiresDb) {
            document.getElementById('dbDatabaseInput').value = currentDb.database || '';
        }
    }
    
    handleDbTypeChange();
    document.getElementById('dbFormError').classList.remove('show');
    document.getElementById('dbFormSuccess').classList.remove('show');
}

// 隐藏添加数据库弹窗
function hideAddDbModal() {
    document.getElementById('addDbModal').classList.remove('show');
    document.getElementById('dbPasswordInput').placeholder = '数据库密码';
    isEditMode = false;
    editingDbId = null;
}

function openUserMgmtPanel() {
    if (currentUser !== 'admin') return;
    userMgmtMode = true;
    const root = document.getElementById('userMgmtDrawerRoot');
    if (root) {
        root.classList.add('open');
        root.setAttribute('aria-hidden', 'false');
    }
    const hb = document.getElementById('userMgmtHeaderBtn');
    if (hb) hb.classList.add('active');
    renderDatabaseList();
    loadUsers();
}

function closeUserMgmtPanel(skipRender) {
    userMgmtMode = false;
    const root = document.getElementById('userMgmtDrawerRoot');
    if (root) {
        root.classList.remove('open');
        root.setAttribute('aria-hidden', 'true');
    }
    const hb = document.getElementById('userMgmtHeaderBtn');
    if (hb) hb.classList.remove('active');
    if (!skipRender) renderDatabaseList();
}

async function loadUsers() {
    const listEl = document.getElementById('userMgmtList');
    if (!listEl) return;
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/users`);
        const data = await response.json();
        if (!data.success) {
            listEl.innerHTML = '<div style="padding:16px;color:#e53e3e;">' + escapeHtml(data.message || '加载失败') + '</div>';
            return;
        }
        renderUserMgmtList(data.users || []);
    } catch (e) {
        listEl.innerHTML = '<div style="padding:16px;color:#e53e3e;">' + escapeHtml(e.message) + '</div>';
    }
}

function renderUserMgmtList(users) {
    const listEl = document.getElementById('userMgmtList');
    if (!listEl) return;
    listEl.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'user-mgmt-row um-head';
    head.innerHTML = '<div class="um-col">用户名</div><div class="um-col">API Key</div><div class="um-actions">操作</div>';
    listEl.appendChild(head);
    users.forEach(u => {
        const name = u.username || '';
        const key = u.api_key || '';
        const keyShow = key ? (key.length > 48 ? key.slice(0, 24) + '…' + key.slice(-8) : key) : '未生成';
        const row = document.createElement('div');
        row.className = 'user-mgmt-row';
        const col1 = document.createElement('div');
        col1.className = 'um-col';
        col1.textContent = name;
        const col2 = document.createElement('div');
        col2.className = 'um-col';
        const span = document.createElement('span');
        span.className = 'user-mgmt-apikey';
        span.title = key;
        span.textContent = keyShow;
        col2.appendChild(span);
        const actions = document.createElement('div');
        actions.className = 'um-actions';
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'btn btn-sm';
        copyBtn.textContent = key ? '复制 Key' : '生成 Key';
        copyBtn.onclick = async function () {
            if (key) {
                const label = copyBtn.textContent;
                try {
                    await navigator.clipboard.writeText(key);
                    copyBtn.textContent = '已复制';
                    setTimeout(() => { copyBtn.textContent = label; }, 1000);
                } catch (e) {
                    console.error(e);
                }
                return;
            }
            try {
                const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/apikey`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username: name })
                });
                const data = await response.json();
                if (data.success) {
                    showToast('密码已重置', 'success');
                    loadUsers();
                } else {
                    showToast(data.message || '生成失败', 'error');
                }
            } catch (e) {
                showToast(e.message || '生成失败', 'error');
            }
        };
        const passBtn = document.createElement('button');
        passBtn.type = 'button';
        passBtn.className = 'btn btn-sm';
        passBtn.textContent = '改密';
        passBtn.onclick = function () {
            openUserPasswordModal(name);
        };
        actions.appendChild(copyBtn);
        actions.appendChild(passBtn);
        if (name !== 'admin') {
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn btn-sm btn-danger';
            delBtn.textContent = '删除';
            delBtn.onclick = function () {
                userMgmtDelete(name);
            };
            actions.appendChild(delBtn);
        }
        row.appendChild(col1);
        row.appendChild(col2);
        row.appendChild(actions);
        listEl.appendChild(row);
    });
}

function openUserPasswordModal(username) {
    userPasswordTarget = username;
    const title = document.getElementById('userPasswordModalTitle');
    if (title) title.textContent = '修改密码 — ' + username;
    const inp = document.getElementById('editPasswordInput');
    if (inp) inp.value = '';
    const inp2 = document.getElementById('editPasswordConfirmInput');
    if (inp2) inp2.value = '';
    const err = document.getElementById('userPasswordModalErr');
    if (err) err.classList.remove('show');
    clearUserPasswordModalPwdHint();
    document.getElementById('userPasswordModal').classList.add('show');
}

function hideUserPasswordModal() {
    document.getElementById('userPasswordModal').classList.remove('show');
    userPasswordTarget = null;
}

async function submitUserPasswordChange() {
    const pwd = document.getElementById('editPasswordInput').value;
    const pwdConfirm = document.getElementById('editPasswordConfirmInput').value;
    const errEl = document.getElementById('userPasswordModalErr');
    const hintEl = document.getElementById('userPasswordModalPwdHint');
    if (!userPasswordTarget) return;
    errEl.classList.remove('show');
    if (!pwd || !pwdConfirm) {
        errEl.textContent = '请输入新密码与确认新密码';
        errEl.classList.add('show');
        return;
    }
    if (!validateUserPasswordPair(pwd, pwdConfirm, hintEl)) return;
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/users/${encodeURIComponent(userPasswordTarget)}/password`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password: pwd })
        });
        const data = await response.json();
        if (data.success) {
            showToast('密码修改成功', 'success');
            hideUserPasswordModal();
            if (userMgmtMode) loadUsers();
        } else {
            errEl.textContent = data.message || '修改失败';
            errEl.classList.add('show');
        }
    } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.add('show');
    }
}

async function userMgmtDelete(username) {
    if (!confirm('确定删除用户「' + username + '」？')) return;
    
    const btn = event.target;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '删除中...';
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/users/${encodeURIComponent(username)}`, {
            method: 'DELETE',
        });
        const data = await response.json();
        if (data.success) {
            showToast('用户已删除', 'success');
            loadUsers();
        } else {
            showToast(data.message || '删除失败', 'error');
            btn.disabled = false;
            btn.textContent = originalText;
        }
    } catch (e) {
        showToast(e.message || '删除失败', 'error');
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

async function handleCreateUser() {
    const name = document.getElementById('newUserName').value.trim();
    const pwd = document.getElementById('newUserPassword').value;
    const pwdConfirm = document.getElementById('newUserPasswordConfirm').value;
    const msgEl = document.getElementById('userMgmtCreateMsg');
    const hintEl = document.getElementById('userMgmtCreatePwdHint');
    msgEl.classList.remove('show');
    clearUserMgmtCreatePwdHint();
    if (!name) {
        msgEl.textContent = '请输入用户名';
        msgEl.classList.add('show');
        return;
    }
    if (!pwd || !pwdConfirm) {
        msgEl.textContent = '请输入密码和确认密码';
        msgEl.classList.add('show');
        return;
    }
    if (!validateUserPasswordPair(pwd, pwdConfirm, hintEl)) return;
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username: name, password: pwd })
        });
        const data = await response.json();
        if (data.success) {
            document.getElementById('newUserName').value = '';
            document.getElementById('newUserPassword').value = '';
            document.getElementById('newUserPasswordConfirm').value = '';
            loadUsers();
        } else {
            msgEl.textContent = data.message || '创建失败';
            msgEl.classList.add('show');
        }
    } catch (e) {
        msgEl.textContent = e.message;
        msgEl.classList.add('show');
    }
}

// 测试数据库连接
async function testConnection() {
    const dbType = document.getElementById('dbTypeInput').value;
    const config = {
        type: dbType
    };

    if (dbTypeDefaults[dbType].isFile) {
        config.path = document.getElementById('dbPathInput').value;
    } else {
        config.host = document.getElementById('dbHostInput').value;
        config.port = parseInt(document.getElementById('dbPortInput').value);
        config.user = document.getElementById('dbUserInput').value;
        
        // 编辑模式下，如果密码为空，使用原密码进行测试
        const password = document.getElementById('dbPasswordInput').value;
        if (isEditMode && password === '' && currentDb) {
            // 提示用户密码未修改
            const errorEl = document.getElementById('dbFormError');
            errorEl.textContent = '编辑模式下，如不修改密码请留空，将使用原密码。要测试连接请输入密码。';
            errorEl.classList.add('show');
            return;
        }
        config.password = password;
        
        if (dbTypeDefaults[dbType].requiresDb) {
            config.database = document.getElementById('dbDatabaseInput').value;
        }
    }

    const errorEl = document.getElementById('dbFormError');
    const successEl = document.getElementById('dbFormSuccess');
    errorEl.classList.remove('show');
    successEl.classList.remove('show');

    // 显示加载状态
    const testBtn = document.getElementById('testConnectionBtn');
    const originalText = testBtn ? testBtn.textContent : '';
    if (testBtn) {
        testBtn.disabled = true;
        testBtn.textContent = '测试中...';
    }

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/test-connection`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });

        const data = await response.json();

        if (data.success) {
            successEl.textContent = '连接成功！';
            successEl.classList.add('show');
        } else {
            errorEl.textContent = data.message || '连接失败';
            errorEl.classList.add('show');
        }
    } catch (error) {
        errorEl.textContent = '连接失败：' + error.message;
        errorEl.classList.add('show');
    } finally {
        // 恢复按钮状态
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.textContent = originalText || '测试连接';
        }
    }
}

// 添加/编辑数据库
async function handleAddDatabase(e) {
    e.preventDefault();

    const dbType = document.getElementById('dbTypeInput').value;
    const dbName = document.getElementById('dbNameInput').value.trim();
    
    const errorEl = document.getElementById('dbFormError');
    const successEl = document.getElementById('dbFormSuccess');
    errorEl.classList.remove('show');
    successEl.classList.remove('show');
    
    // 表单验证
    if (!dbName) {
        errorEl.textContent = '请输入数据库名称';
        errorEl.classList.add('show');
        return;
    }
    
    const config = {
        type: dbType,
        name: dbName
    };

    if (dbTypeDefaults[dbType].isFile) {
        const dbPath = document.getElementById('dbPathInput').value.trim();
        if (!dbPath) {
            errorEl.textContent = '请输入数据库文件路径';
            errorEl.classList.add('show');
            return;
        }
        config.path = dbPath;
    } else {
        const dbHost = document.getElementById('dbHostInput').value.trim();
        const dbPort = document.getElementById('dbPortInput').value.trim();
        const dbUser = document.getElementById('dbUserInput').value.trim();
        
        if (!dbHost) {
            errorEl.textContent = '请输入主机地址';
            errorEl.classList.add('show');
            return;
        }
        if (!dbPort || isNaN(parseInt(dbPort)) || parseInt(dbPort) <= 0) {
            errorEl.textContent = '请输入有效的端口号';
            errorEl.classList.add('show');
            return;
        }
        if (!dbUser) {
            errorEl.textContent = '请输入用户名';
            errorEl.classList.add('show');
            return;
        }
        
        config.host = dbHost;
        config.port = parseInt(dbPort);
        config.user = dbUser;
        const password = document.getElementById('dbPasswordInput').value;
        
        // 编辑模式下，如果密码为空则不更新密码
        if (isEditMode && password === '') {
            // 不包含password字段，后端会保留原密码
        } else {
            config.password = password;
        }
        
        if (dbTypeDefaults[dbType].requiresDb) {
            const dbDatabase = document.getElementById('dbDatabaseInput').value.trim();
            if (!dbDatabase) {
                errorEl.textContent = '请输入数据库名';
                errorEl.classList.add('show');
                return;
            }
            config.database = dbDatabase;
        }
    }

    try {
        const url = isEditMode 
            ? `${API_BASE}/api/data-ontology/databases/${editingDbId}`
            : `${API_BASE}/api/data-ontology/databases`;
        
        const method = isEditMode ? 'PUT' : 'POST';
        
        const response = await fetchWithAuth(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });

        const data = await response.json();

        if (data.success) {
            successEl.textContent = isEditMode ? '数据库更新成功！' : '数据库添加成功！';
            successEl.classList.add('show');
            setTimeout(() => {
                hideAddDbModal();
                loadDatabases();
                if (isEditMode && currentDb && currentDb.id === editingDbId) {
                    // 刷新当前显示的数据库详情
                    setTimeout(() => {
                        loadDatabaseDetail(editingDbId);
                    }, 300);
                }
            }, 1000);
        } else {
            errorEl.textContent = data.message || (isEditMode ? '更新失败' : '添加失败');
            errorEl.classList.add('show');
        }
    } catch (error) {
        errorEl.textContent = (isEditMode ? '更新失败：' : '添加失败：') + error.message;
        errorEl.classList.add('show');
    }
}

// 加载数据库列表
/**
 * 从后端获取数据库列表并更新 UI
 * @returns {Promise<void>}
 */
async function loadDatabases() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases`);

        const data = await response.json();

        if (data.success) {
            databases = data.databases || [];
            initDemoData();
            renderDatabaseList();
            
            // 如果当前选中的数据库被更新，同步更新currentDb
            if (currentDb) {
                const updatedDb = databases.find(db => db.id === currentDb.id);
                if (updatedDb) {
                    currentDb = updatedDb;
                } else {
                    currentDb = null;
                    document.getElementById('welcomeView').style.display = 'block';
                    document.getElementById('dbDetailView').style.display = 'none';
                }
            }
        }
    } catch (error) {
        console.error('加载数据库列表失败：', error);
        showToast('加载数据库列表失败', 'error');
    }
}

// 渲染数据库列表
function renderDatabaseList() {
    const listEl = document.getElementById('dbList');
    
    if (databases.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;color:#718096;padding:20px;">暂无数据库</div>';
        return;
    }

    listEl.innerHTML = databases.map(db => {
        const typeIcon = dbTypeIcons[db.type] || '🗄️';
        const isFileDb = dbTypeDefaults[db.type]?.isFile;
        const info = isFileDb ? db.path : `${db.host}:${db.port}`;
        
        const isActive = !userMgmtMode && currentDb && currentDb.id === db.id;
        const safeDbId = escapeHtml(db.id);
        const safeName = escapeHtml(db.name);
        const safeInfo = escapeHtml(info);
        return `
            <div class="db-item ${isActive ? 'active' : ''}" onclick="selectDatabase('${safeDbId}')">
                <div class="db-item-name">${typeIcon} ${safeName}</div>
                <div class="db-item-info">${safeInfo}</div>
            </div>
        `;
    }).join('');
}

// 选择数据库
function selectDatabase(dbId) {
    closeUserMgmtPanel(true);
    currentDb = databases.find(db => db.id === dbId);
    if (currentDb) {
        renderDatabaseList();
        showDatabaseLoading();
        loadDatabaseDetail(dbId);
    }
}

// 显示数据库加载状态
function showDatabaseLoading() {
    closeUserMgmtPanel(true);
    document.getElementById('welcomeView').style.display = 'none';
    document.getElementById('dbDetailView').style.display = 'block';
    
    // 显示加载状态
    document.getElementById('dbName').innerHTML = '<span style="color:#718096;">加载中...</span>';
    document.getElementById('dbStatus').textContent = '连接中...';
    document.getElementById('dbStatus').className = 'info-value status';
    
    const listEl = document.getElementById('tablesList');
    listEl.innerHTML = `
        <div style="text-align:center;padding:40px;color:#718096;">
            <div class="loading-spinner"></div>
            <div style="margin-top:12px;">正在加载数据库信息...</div>
        </div>
    `;
    
    document.getElementById('tablePreview').style.display = 'none';
}

// 加载数据库详情
async function loadDatabaseDetail(dbId) {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${dbId}`);

        const data = await response.json();

        if (data.success) {
            document.getElementById('welcomeView').style.display = 'none';
            document.getElementById('dbDetailView').style.display = 'block';
            
            const typeNames = {
                mysql: 'MySQL',
                mariadb: 'MariaDB',
                postgresql: 'PostgreSQL',
                sqlserver: 'SQL Server',
                oracle: 'Oracle',
                dm: '达梦',
                sqlite: 'SQLite',
                duckdb: 'DuckDB',
                tidb: 'TiDB',
                cockroachdb: 'CockroachDB',
                mongodb: 'MongoDB',
                redis: 'Redis',
                memcached: 'Memcached',
                clickhouse: 'ClickHouse',
                cassandra: 'Cassandra',
                hbase: 'HBase',
                influxdb: 'InfluxDB',
                timescaledb: 'TimescaleDB',
                elasticsearch: 'Elasticsearch',
                neo4j: 'Neo4j'
            };
            
            const isFileDb = dbTypeDefaults[data.database.type]?.isFile;
            document.getElementById('dbName').textContent = `${data.database.name} (${typeNames[data.database.type] || data.database.type})`;
            document.getElementById('dbHost').textContent = isFileDb ? data.database.path : data.database.host;
            document.getElementById('dbPort').textContent = isFileDb ? '-' : data.database.port;
            document.getElementById('dbDatabase').textContent = data.database.database || '-';
            
            const statusEl = document.getElementById('dbStatus');
            if (data.database.connected) {
                statusEl.textContent = '已连接';
                statusEl.className = 'info-value status connected';
            } else {
                statusEl.textContent = '未连接';
                statusEl.className = 'info-value status disconnected';
            }

            renderTablesList(data.database.tables || []);
            document.getElementById('tablePreview').style.display = 'none';
        } else {
            // 加载失败显示错误信息
            const listEl = document.getElementById('tablesList');
            listEl.innerHTML = `
                <div style="text-align:center;padding:40px;color:#e53e3e;">
                    <div style="font-size:48px;margin-bottom:12px;">⚠️</div>
                    <div>加载失败：${data.message || '未知错误'}</div>
                </div>
            `;
        }
    } catch (error) {
        console.error('加载数据库详情失败：', error);
        // 网络错误或其他异常
        const listEl = document.getElementById('tablesList');
        listEl.innerHTML = `
            <div style="text-align:center;padding:40px;color:#e53e3e;">
                <div style="font-size:48px;margin-bottom:12px;">⚠️</div>
                <div>加载失败：网络错误或服务器无响应</div>
            </div>
        `;
    }
}

// 渲染表列表
function renderTablesList(tables) {
    const listEl = document.getElementById('tablesList');
    
    if (tables.length === 0) {
        const dbNameEl = document.getElementById('dbDatabase');
        const currentDbName = dbNameEl ? dbNameEl.textContent : '';
        
        let hint = '';
        if (currentDb && currentDb.type === 'mongodb') {
            hint = `<div style="margin-top:12px;font-size:13px;color:#a0aec0;">
                当前连接数据库: <strong style="color:#718096;">${currentDbName}</strong><br/>
                如果数据库名称不正确，请编辑配置修改为正确的数据库名称（如 sample_mflix）
            </div>`;
        }
        
        listEl.innerHTML = `
            <div style="text-align:center;color:#718096;padding:40px;">
                <div style="font-size:48px;margin-bottom:12px;opacity:0.6;">📂</div>
                <div style="font-size:16px;">暂无数据表</div>
                ${hint}
            </div>
        `;
        return;
    }

    const tablesHtml = tables.map(table => `
        <div class="table-item" onclick="previewTable('${escapeHtml(table)}')">
            ${escapeHtml(table)}
        </div>
    `).join('');
    
    listEl.innerHTML = '<div class="tables-grid">' + tablesHtml + '</div>';
}

// 当前预览的表名
let currentPreviewTable = null;
let isTableEditMode = false;

// 预览表数据
async function previewTable(tableName, keepEditMode = false) {
    if (!currentDb) {
        console.error('没有选中数据库');
        return;
    }

    currentPreviewTable = tableName;
    
    // 如果不是保持编辑模式，则重置
    if (!keepEditMode) {
        isTableEditMode = false;
    }

    // 显示加载状态
    document.getElementById('tablePreview').style.display = 'block';
    const previewContent = document.getElementById('previewContent');
    previewContent.innerHTML = `
        <div style="text-align:center;padding:60px;color:#718096;">
            <div class="loading-spinner"></div>
            <div style="margin-top:16px;">正在加载表数据...</div>
        </div>
    `;

    try {
        // 首先获取表结构
        const structureResponse = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${tableName}/structure`);
        const structureData = await structureResponse.json();
        
        // 然后获取表数据
        const dataResponse = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${tableName}`);
        const data = await dataResponse.json();

        if (data.success) {
            document.getElementById('tablePreview').style.display = 'block';
            
            // 更新预览头部按钮
            updatePreviewHeader();
            
            const previewContent = document.getElementById('previewContent');
            
            // 获取列信息（优先使用结构信息，否则从数据推断）
            let columns = [];
            if (structureData.success && structureData.columns && structureData.columns.length > 0) {
                columns = structureData.columns.map(col => col.name);
            } else if (data.data && data.data.length > 0) {
                columns = Object.keys(data.data[0]);
            } else {
                // 无结构且无数据时重试一次拉取表结构（新创建的空表可能首次未返回）
                const retryResp = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${encodeURIComponent(tableName)}/structure`);
                const retryData = await retryResp.json();
                if (retryData.success && retryData.columns && retryData.columns.length > 0) {
                    columns = retryData.columns.map(col => col.name);
                }
            }
            if (columns.length === 0) {
                // 仍无列信息时显示提示，并允许“添加行”时再试加载结构
                previewContent.innerHTML = `
                    <div style="text-align:center;padding:40px;">
                        <div style="font-size:48px;margin-bottom:16px;opacity:0.6;">📋</div>
                        <div style="color:#718096;font-size:16px;margin-bottom:12px;">表结构为空或无法获取</div>
                        <div style="color:#a0aec0;font-size:14px;margin-bottom:16px;">此表可能是新创建的空表</div>
                        <button type="button" class="btn btn-primary" onclick="loadStructureAndRenderTable()">重新加载表结构</button>
                    </div>
                `;
                return;
            }
            
            // 即使数据为空也显示表头
            const hasData = data.data && data.data.length > 0;
            const actionColumnHtml = isTableEditMode ? '<th class="action-column">操作</th>' : '';
            const tableHtml = `
                <table class="preview-table" id="dataTable">
                    <thead>
                        <tr>
                            ${columns.map(col => `<th>${escapeHtml(col)}</th>`).join('')}
                            ${actionColumnHtml}
                        </tr>
                    </thead>
                    <tbody>
                        ${hasData ? data.data.map((row, rowIndex) => {
                            const rowId = 'row-' + Date.now() + '-' + rowIndex;
                            return `
                                <tr data-row-id="${rowId}" data-row-index="${rowIndex}">
                                    ${columns.map(col => {
                                        const value = row[col];
                                        const displayValue = value !== null ? escapeHtml(String(value)) : '<i class="null-value">NULL</i>';
                                        return `<td data-column="${escapeHtml(col)}" class="editable-cell">${displayValue}</td>`;
                                    }).join('')}
                                    ${isTableEditMode ? `<td class="action-column"><button class="btn-icon-delete" onclick="deleteTableRow('${rowId}')" title="删除行">🗑️</button></td>` : ''}
                                </tr>
                            `;
                        }).join('') : `
                            <tr class="empty-row">
                                <td colspan="${columns.length + (isTableEditMode ? 1 : 0)}" style="text-align:center;color:#718096;padding:20px;">
                                    ${isTableEditMode ? '表中暂无数据，点击上方"+ 添加行"按钮添加数据' : '表中暂无数据'}
                                </td>
                            </tr>
                        `}
                    </tbody>
                </table>
            `;
            
            previewContent.innerHTML = tableHtml;
            previewContent.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            
            // 如果在编辑模式，添加编辑功能
            const table = document.getElementById('dataTable');
            if (isTableEditMode) {
                table.classList.add('editing-mode');
                enableTableEditing();
            } else {
                table.classList.remove('editing-mode');
                // 移除统计显示（如果存在）
                const statsEl = document.getElementById('editStats');
                if (statsEl) {
                    statsEl.remove();
                }
            }
        }
    } catch (error) {
        console.error('预览表数据失败：', error);
        const previewContent = document.getElementById('previewContent');
        previewContent.innerHTML = '<div style="text-align:center;color:#e53e3e;padding:20px;">加载失败：' + escapeHtml(error.message) + '</div>';
    }
}

// 防止表结构重复请求（避免频繁刷新）
let structureLoadingLock = false;

// 当表结构未加载时（空表）：重新拉取表结构并渲染表格，可选是否直接添加一行
async function loadStructureAndRenderTable(addOneRow) {
    if (!currentDb || !currentPreviewTable) return;
    if (structureLoadingLock) return;
    const previewContent = document.getElementById('previewContent');
    if (!previewContent) return;
    structureLoadingLock = true;
    previewContent.innerHTML = '<div style="text-align:center;padding:40px;color:#718096;">正在加载表结构...</div>';
    try {
        const structureResponse = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${encodeURIComponent(currentPreviewTable)}/structure`, {
        });
        const structureData = await structureResponse.json();
        if (!structureData.success || !structureData.columns || structureData.columns.length === 0) {
            const msg = (structureData.message && structureData.message.trim()) ? structureData.message : '无法获取表结构，请稍后重试';
            previewContent.innerHTML = '<div style="text-align:center;padding:40px;color:#e53e3e;">' + escapeHtml(msg) + '</div>';
            structureLoadingLock = false;
            return;
        }
        const columns = structureData.columns.map(col => col.name);
        const actionColumnHtml = isTableEditMode ? '<th class="action-column">操作</th>' : '';
        const emptyRowHtml = `
            <tr class="empty-row">
                <td colspan="${columns.length + (isTableEditMode ? 1 : 0)}" style="text-align:center;color:#718096;padding:20px;">
                    表中暂无数据，点击上方"+ 添加行"按钮添加数据
                </td>
            </tr>
        `;
        const tableHtml = `
            <table class="preview-table" id="dataTable">
                <thead>
                    <tr>
                        ${columns.map(col => `<th>${escapeHtml(col)}</th>`).join('')}
                        ${actionColumnHtml}
                    </tr>
                </thead>
                <tbody>${emptyRowHtml}</tbody>
            </table>
        `;
        previewContent.innerHTML = tableHtml;
        const table = document.getElementById('dataTable');
        if (!table) {
            structureLoadingLock = false;
            return;
        }
        if (isTableEditMode) {
            table.classList.add('editing-mode');
            enableTableEditing();
        }
        if (addOneRow) addTableRow();
    } catch (e) {
        previewContent.innerHTML = '<div style="text-align:center;padding:40px;color:#e53e3e;">加载失败：' + escapeHtml(e.message) + '</div>';
    }
    structureLoadingLock = false;
}

// 更新预览头部按钮
function updatePreviewHeader() {
    const actionsContainer = document.querySelector('#tablePreview .preview-actions');
    const tableNameEl = document.getElementById('previewTableName');
    
    if (!actionsContainer || !tableNameEl) {
        console.error('找不到预览头部元素');
        return;
    }
    
    // 更新表名
    tableNameEl.textContent = currentPreviewTable;
    
    // 更新按钮
    const actionsHtml = isTableEditMode ? `
        <button id="addRowBtn" class="btn btn-sm btn-primary" onclick="addTableRow()">+ 添加行</button>
        <button id="saveTableBtn" class="btn btn-sm btn-primary" onclick="saveTableData()">💾 保存</button>
        <button id="cancelEditBtn" class="btn btn-sm" onclick="cancelTableEdit()">取消</button>
    ` : `
        <button id="editTableBtn" class="btn btn-sm btn-primary" onclick="enableTableEditMode()">✏️ 编辑数据</button>
        <button id="editStructureBtn" class="btn btn-sm btn-primary" onclick="showEditStructureModal()">🔧 编辑结构</button>
        <button id="renameTableBtn" class="btn btn-sm" onclick="showRenameTableModal()">📝 重命名表</button>
        <button id="dropTableBtn" class="btn btn-sm btn-danger" onclick="dropTable()">删除表</button>
        <button id="closePreviewBtn" class="btn btn-sm" onclick="closePreview()">关闭</button>
    `;
    
    actionsContainer.innerHTML = actionsHtml;
}

// 启用表格编辑模式
function enableTableEditMode() {
    if (!currentPreviewTable) {
        showToast('请先选择一个表', 'warning');
        return;
    }

    if (!currentDb) {
        showToast('请先选择数据库', 'warning');
        return;
    }
    
    isTableEditMode = true;
    
    // 显示加载提示
    const previewContent = document.getElementById('previewContent');
    if (previewContent) {
        const loadingHtml = '<div style="text-align:center;padding:40px;color:#667eea;"><div style="font-size:24px;margin-bottom:12px;">⏳</div><div>正在加载编辑模式...</div></div>';
        previewContent.innerHTML = loadingHtml;
    }
    
    // 重新加载表格数据
    previewTable(currentPreviewTable, true);
}

// 启用表格编辑功能
function enableTableEditing() {
    const cells = document.querySelectorAll('.editable-cell');
    cells.forEach(cell => {
        cell.contentEditable = 'true';
        cell.classList.add('editing');
        
        // 处理NULL值的编辑
        const focusHandler = function() {
            const nullEl = this.querySelector('.null-value');
            if (nullEl) {
                this.textContent = '';
            }
        };
        
        const blurHandler = function() {
            if (this.textContent.trim() === '') {
                this.innerHTML = '<i class="null-value">NULL</i>';
            }
            // 更新统计
            updateEditStats();
        };
        
        // 移除旧的事件监听器（如果存在）
        cell.removeEventListener('focus', focusHandler);
        cell.removeEventListener('blur', blurHandler);
        
        // 添加新的事件监听器
        cell.addEventListener('focus', focusHandler);
        cell.addEventListener('blur', blurHandler);
        
        // 保存处理器引用以便后续移除
        cell._focusHandler = focusHandler;
        cell._blurHandler = blurHandler;
    });
    
    // 初始化统计显示
    updateEditStats();
}

// 显示保存成功提示
function showSaveSuccess(message) {
    // 创建提示元素
    const toast = document.createElement('div');
    toast.className = 'save-success-toast';
    toast.innerHTML = `
        <div class="toast-icon">✅</div>
        <div class="toast-message">${message.replace(/\n/g, '<br>')}</div>
    `;
    
    document.body.appendChild(toast);
    
    // 显示动画
    setTimeout(() => toast.classList.add('show'), 10);
    
    // 自动隐藏
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 1200);
}

// 更新编辑统计
function updateEditStats() {
    const table = document.getElementById('dataTable');
    if (!table || !isTableEditMode) return;
    
    const rows = table.querySelectorAll('tbody tr:not(.empty-row)');
    let newCount = 0;
    let deletedCount = 0;
    let normalCount = 0;
    
    rows.forEach(row => {
        const isNew = row.dataset.isNew === 'true';
        const isDeleted = row.dataset.deleted === 'true';
        
        if (isNew) {
            newCount++;
        } else if (isDeleted) {
            deletedCount++;
        } else {
            normalCount++;
        }
    });
    
    // 查找或创建统计显示元素
    let statsEl = document.getElementById('editStats');
    if (!statsEl) {
        statsEl = document.createElement('div');
        statsEl.id = 'editStats';
        statsEl.className = 'edit-stats';
        const previewContent = document.getElementById('previewContent');
        previewContent.insertBefore(statsEl, previewContent.firstChild);
    }
    
    const totalChanges = newCount + deletedCount;
    const statsHtml = totalChanges > 0 ? `
        <span class="stats-item">
            <span class="stats-label">📊 当前状态：</span>
            ${normalCount > 0 ? `<span class="stats-badge stats-normal">${normalCount} 行正常</span>` : ''}
            ${newCount > 0 ? `<span class="stats-badge stats-new">+ ${newCount} 行新增</span>` : ''}
            ${deletedCount > 0 ? `<span class="stats-badge stats-deleted">- ${deletedCount} 行删除</span>` : ''}
        </span>
    ` : '<span class="stats-item"><span class="stats-label">📊 暂无更改</span></span>';
    
    statsEl.innerHTML = statsHtml;
}

// 禁用表格编辑功能
function disableTableEditing() {
    const cells = document.querySelectorAll('.editable-cell');
    cells.forEach(cell => {
        cell.contentEditable = 'false';
        cell.classList.remove('editing');
    });
}

// 取消编辑
function cancelTableEdit() {
    isTableEditMode = false;
    disableTableEditing();
    
    // 移除统计显示
    const statsEl = document.getElementById('editStats');
    if (statsEl) {
        statsEl.remove();
    }
    
    previewTable(currentPreviewTable);
}

// 添加表格行
function addTableRow() {
    const table = document.getElementById('dataTable');
    if (!table) {
        // 表未渲染（如空表结构未加载），先拉取结构并渲染再添加一行
        loadStructureAndRenderTable(true);
        return;
    }
    const tbody = table.querySelector('tbody');
    const headers = Array.from(table.querySelectorAll('thead th'))
        .slice(0, -1) // 排除操作列
        .map(th => th.textContent);
    
    // 移除空行提示
    const emptyRow = tbody.querySelector('.empty-row');
    if (emptyRow) {
        emptyRow.remove();
    }
    
    const rowId = 'row-new-' + Date.now();
    const newRow = document.createElement('tr');
    newRow.dataset.rowId = rowId;
    newRow.dataset.isNew = 'true';
    newRow.innerHTML = headers.map(col => 
        `<td data-column="${escapeHtml(col)}" class="editable-cell editing" contenteditable="true"><i class="null-value">NULL</i></td>`
    ).join('') + `
        <td class="action-column">
            <button class="btn-icon-delete" onclick="deleteTableRow('${rowId}')" title="删除行">🗑️</button>
        </td>
    `;
    
    tbody.appendChild(newRow);
    
    // 聚焦到第一个单元格
    const firstCell = newRow.querySelector('.editable-cell');
    if (firstCell) {
        firstCell.focus();
        // 清空NULL提示
        if (firstCell.querySelector('.null-value')) {
            firstCell.textContent = '';
        }
    }
    
    // 更新统计
    updateEditStats();
}

// 删除表格行
function deleteTableRow(rowId) {
    const row = document.querySelector(`tr[data-row-id="${rowId}"]`);
    if (!row) {
        return;
    }
    
    // 如果是新增行，直接删除DOM
    if (row.dataset.isNew === 'true') {
        row.remove();
        
        // 如果删除后没有行了，显示空行提示
        const tbody = document.getElementById('dataTable').querySelector('tbody');
        if (tbody.children.length === 0) {
            const columns = Array.from(document.querySelectorAll('#dataTable thead th')).length;
            tbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="${columns}" style="text-align:center;color:#718096;padding:20px;">
                        表中暂无数据，点击上方"+ 添加行"按钮添加数据
                    </td>
                </tr>
            `;
        }
    } else {
        // 已存在的行，标记为删除或取消删除
        const deleteBtn = row.querySelector('.btn-icon-delete');
        
        if (row.dataset.deleted === 'true') {
            // 取消删除标记
            row.dataset.deleted = 'false';
            row.classList.remove('row-deleted');
            if (deleteBtn) {
                deleteBtn.textContent = '🗑️';
                deleteBtn.title = '删除行';
            }
        } else {
            // 标记为删除
            row.dataset.deleted = 'true';
            row.classList.add('row-deleted');
            if (deleteBtn) {
                deleteBtn.textContent = '↶';
                deleteBtn.title = '撤销删除';
            }
        }
    }
    
    // 更新统计
    updateEditStats();
}

// 保存表格数据
async function saveTableData() {
    if (!currentDb || !currentPreviewTable) return;
    
    const table = document.getElementById('dataTable');
    const rows = table.querySelectorAll('tbody tr:not(.empty-row)');
    
    const updates = [];
    const inserts = [];
    const deletes = [];
    
    rows.forEach((row, index) => {
        const rowId = row.dataset.rowId;
        const rowIndex = row.dataset.rowIndex;
        const isNew = row.dataset.isNew === 'true';
        const isDeleted = row.dataset.deleted === 'true';
        
        if (isDeleted) {
            // 只有非新增的行才需要删除
            if (!isNew && rowIndex !== undefined) {
                deletes.push(parseInt(rowIndex));
            }
        } else {
            const rowData = {};
            const cells = row.querySelectorAll('.editable-cell');
            cells.forEach(cell => {
                const column = cell.dataset.column;
                const nullEl = cell.querySelector('.null-value');
                const value = nullEl ? null : cell.textContent.trim();
                rowData[column] = value === '' ? null : value;
            });
            
            if (isNew) {
                inserts.push(rowData);
            } else if (rowIndex !== undefined) {
                updates.push({ index: parseInt(rowIndex), data: rowData });
            }
        }
    });
    
    // 检查是否有更改
    if (updates.length === 0 && inserts.length === 0 && deletes.length === 0) {
        showToast('没有任何更改', 'info');
        return;
    }
    
    // 确认保存
    const message = `确认保存更改？\n更新: ${updates.length} 条\n插入: ${inserts.length} 条\n删除: ${deletes.length} 条`;
    if (!confirm(message)) {
        return;
    }
    
    // 发送保存请求
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${currentPreviewTable}/data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                updates,
                inserts,
                deletes
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // 显示成功提示
            const successMsg = `保存成功！\n✓ 更新: ${updates.length} 条\n✓ 插入: ${inserts.length} 条\n✓ 删除: ${deletes.length} 条`;
            
            // 使用自定义提示替代 alert
            showSaveSuccess(successMsg);
            
            // 延迟重新加载，确保提示显示
            setTimeout(() => {
                previewTable(currentPreviewTable, true);
            }, 1500);
        } else {
            showToast('保存失败：' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('保存失败：' + error.message, 'error');
    }
}

// 删除表
async function dropTable() {
    if (!currentDb || !currentPreviewTable) return;
    
    if (!confirm(`确定要删除表 "${currentPreviewTable}" 吗？此操作不可恢复！`)) {
        return;
    }
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${currentPreviewTable}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('表删除成功！', 'success');
            closePreview();
            loadDatabaseDetail(currentDb.id);
        } else {
            showToast('删除失败：' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('删除失败：' + error.message, 'error');
    }
}

// 关闭预览
function closePreview() {
    document.getElementById('tablePreview').style.display = 'none';
    currentPreviewTable = null;
    isTableEditMode = false;
}

// 显示编辑表结构模态框
async function showEditStructureModal() {
    if (!currentDb || !currentPreviewTable) return;
    
    try {
        // 获取当前表结构
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${currentPreviewTable}/structure`);
        const data = await response.json();
        
        if (!data.success) {
            showToast('获取表结构失败：' + (data.message || '未知错误'), 'error');
            return;
        }
        
        // 渲染编辑界面
        renderEditStructure(data.columns || []);
        document.getElementById('editStructureModal').style.display = 'block';
    } catch (error) {
        showToast('获取表结构失败：' + error.message, 'error');
    }
}

// 渲染编辑结构界面
function renderEditStructure(columns) {
    const container = document.getElementById('structureColumnsContainer');
    
    let html = '';
    columns.forEach((col, index) => {
        html += `
            <div class="structure-column-item" data-index="${index}">
                <div class="structure-column-header">
                    <span class="column-number">#${index + 1}</span>
                    <input type="text" class="form-control" value="${col.name}" data-field="name" placeholder="列名" />
                    <button type="button" class="btn-icon-delete" onclick="removeStructureColumn(${index})" title="删除列">🗑️</button>
                </div>
                <div class="structure-column-fields">
                    <div class="form-group">
                        <label>类型</label>
                        <select class="form-control" data-field="type">
                            <option value="INT" ${col.type.toUpperCase().includes('INT') ? 'selected' : ''}>INT</option>
                            <option value="BIGINT" ${col.type.toUpperCase().includes('BIGINT') ? 'selected' : ''}>BIGINT</option>
                            <option value="VARCHAR" ${col.type.toUpperCase().includes('VARCHAR') ? 'selected' : ''}>VARCHAR</option>
                            <option value="TEXT" ${col.type.toUpperCase().includes('TEXT') ? 'selected' : ''}>TEXT</option>
                            <option value="DATETIME" ${col.type.toUpperCase().includes('DATETIME') ? 'selected' : ''}>DATETIME</option>
                            <option value="TIMESTAMP" ${col.type.toUpperCase().includes('TIMESTAMP') ? 'selected' : ''}>TIMESTAMP</option>
                            <option value="DATE" ${col.type.toUpperCase().includes('DATE') && !col.type.toUpperCase().includes('DATETIME') ? 'selected' : ''}>DATE</option>
                            <option value="DECIMAL" ${col.type.toUpperCase().includes('DECIMAL') ? 'selected' : ''}>DECIMAL</option>
                            <option value="FLOAT" ${col.type.toUpperCase().includes('FLOAT') ? 'selected' : ''}>FLOAT</option>
                            <option value="DOUBLE" ${col.type.toUpperCase().includes('DOUBLE') ? 'selected' : ''}>DOUBLE</option>
                            <option value="BOOLEAN" ${col.type.toUpperCase().includes('BOOL') ? 'selected' : ''}>BOOLEAN</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>长度</label>
                        <input type="text" class="form-control" data-field="size" placeholder="如: 255" 
                            value="${extractSize(col.type)}" />
                    </div>
                    <div class="form-group-inline">
                        <label>
                            <input type="checkbox" data-field="nullable" ${col.nullable ? 'checked' : ''} />
                            允许NULL
                        </label>
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// 提取类型中的长度信息
function extractSize(typeStr) {
    const match = typeStr.match(/\((\d+)\)/);
    return match ? match[1] : '';
}

// 添加新列
function addStructureColumn() {
    const container = document.getElementById('structureColumnsContainer');
    const index = container.children.length;
    
    const newColumn = document.createElement('div');
    newColumn.className = 'structure-column-item';
    newColumn.dataset.index = index;
    newColumn.innerHTML = `
        <div class="structure-column-header">
            <span class="column-number">#${index + 1}</span>
            <input type="text" class="form-control" data-field="name" placeholder="列名" />
            <button type="button" class="btn-icon-delete" onclick="removeStructureColumn(${index})" title="删除列">🗑️</button>
        </div>
        <div class="structure-column-fields">
            <div class="form-group">
                <label>类型</label>
                <select class="form-control" data-field="type">
                    <option value="INT">INT</option>
                    <option value="BIGINT">BIGINT</option>
                    <option value="VARCHAR" selected>VARCHAR</option>
                    <option value="TEXT">TEXT</option>
                    <option value="DATETIME">DATETIME</option>
                    <option value="TIMESTAMP">TIMESTAMP</option>
                    <option value="DATE">DATE</option>
                    <option value="DECIMAL">DECIMAL</option>
                    <option value="FLOAT">FLOAT</option>
                    <option value="DOUBLE">DOUBLE</option>
                    <option value="BOOLEAN">BOOLEAN</option>
                </select>
            </div>
            <div class="form-group">
                <label>长度</label>
                <input type="text" class="form-control" data-field="size" placeholder="如: 255" value="255" />
            </div>
            <div class="form-group-inline">
                <label>
                    <input type="checkbox" data-field="nullable" checked />
                    允许NULL
                </label>
            </div>
        </div>
    `;
    
    container.appendChild(newColumn);
}

// 移除列
function removeStructureColumn(index) {
    const item = document.querySelector(`.structure-column-item[data-index="${index}"]`);
    if (item) {
        item.remove();
    }
}

// 保存表结构修改
async function saveTableStructure() {
    if (!currentDb || !currentPreviewTable) return;
    
    const container = document.getElementById('structureColumnsContainer');
    const columnItems = container.querySelectorAll('.structure-column-item');
    
    const newColumns = [];
    columnItems.forEach(item => {
        const name = item.querySelector('[data-field="name"]').value.trim();
        const type = item.querySelector('[data-field="type"]').value;
        const size = item.querySelector('[data-field="size"]').value.trim();
        const nullable = item.querySelector('[data-field="nullable"]').checked;
        
        if (name) {
            newColumns.push({
                name,
                type,
                size,
                nullable
            });
        }
    });
    
    if (newColumns.length === 0) {
        showToast('至少需要一个列', 'warning');
        return;
    }
    
    if (!confirm(`确定要修改表 "${currentPreviewTable}" 的结构吗？\n此操作可能导致数据丢失！`)) {
        return;
    }
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${currentPreviewTable}/structure`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ columns: newColumns })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('表结构修改成功！', 'success');
            closeEditStructureModal();
            previewTable(currentPreviewTable);
        } else {
            showToast('修改失败：' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('修改失败：' + error.message, 'error');
    }
}

// 关闭编辑结构模态框
function closeEditStructureModal() {
    document.getElementById('editStructureModal').style.display = 'none';
}

// 显示重命名表模态框
function showRenameTableModal() {
    if (!currentDb || !currentPreviewTable) return;
    document.getElementById('renameTableNewName').value = currentPreviewTable;
    document.getElementById('renameTableModal').classList.add('show');
}

// 隐藏重命名表模态框
function hideRenameTableModal() {
    document.getElementById('renameTableModal').classList.remove('show');
}

// 提交重命名表
async function submitRenameTable() {
    if (!currentDb || !currentPreviewTable) return;
    const newName = document.getElementById('renameTableNewName').value.trim();
    if (!newName) {
        showToast('请输入新表名', 'warning');
        return;
    }
    if (newName === currentPreviewTable) {
        hideRenameTableModal();
        return;
    }
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${currentPreviewTable}/rename`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ new_name: newName })
        });
        const data = await response.json();
        if (data.success) {
            hideRenameTableModal();
            currentPreviewTable = newName;
            updatePreviewHeader();
            loadDatabaseDetail(currentDb.id).then(() => previewTable(newName));
        } else {
            showToast('重命名失败：' + (data.message || '未知错误'), 'error');
        }
    } catch (e) {
        showToast('重命名失败：' + e.message, 'error');
    }
}

// 删除数据库
async function handleDeleteDatabase() {
    if (!currentDb) return;

    if (!confirm(`确定要删除数据库 "${currentDb.name}" 吗？此操作不可恢复。`)) {
        return;
    }

    const deleteBtn = document.getElementById('deleteDbBtn');
    const originalText = deleteBtn.textContent;
    deleteBtn.disabled = true;
    deleteBtn.textContent = '删除中...';

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            currentDb = null;
            currentPreviewTable = null;
            document.getElementById('welcomeView').style.display = 'flex';
            document.getElementById('dbDetailView').style.display = 'none';
            document.getElementById('tablePreview').style.display = 'none';
            loadDatabases();
        } else {
            showToast(data.message || '删除失败', 'error');
            deleteBtn.disabled = false;
            deleteBtn.textContent = originalText;
        }
    } catch (error) {
        showToast('删除失败：' + error.message, 'error');
        deleteBtn.disabled = false;
        deleteBtn.textContent = originalText;
    }
}

// ==================== 接口管理功能 ====================

// ---- ApiKey 管理 ----

async function loadApiKey() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/apikey`);
        const data = await response.json();
        if (data.success) {
            currentApiKey = data.api_key || '';
            renderApiKeyUI();
        }
    } catch (e) {
        console.error('加载ApiKey失败：', e);
        showToast('加载 API Key 失败', 'error');
    }
}

async function generateApiKey() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/apikey`, {
            method: 'POST',
        });
        const data = await response.json();
        if (data.success) {
            currentApiKey = data.api_key;
            renderApiKeyUI();
            if (currentApi) renderCodeExamples(currentApi);
        } else {
            showToast(data.message || '生成失败', 'error');
        }
    } catch (e) {
        console.error('生成ApiKey失败：', e);
        showToast('生成 API Key 失败', 'error');
    }
}

async function deleteApiKey() {
    if (!confirm('删除后，使用此 API Key 的外部调用将全部失效，确认删除？')) return;
    
    const deleteBtn = document.getElementById('deleteApikeyBtn');
    const originalText = deleteBtn.textContent;
    deleteBtn.disabled = true;
    deleteBtn.textContent = '删除中...';
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/apikey`, {
            method: 'DELETE',
        });
        const data = await response.json();
        if (data.success) {
            currentApiKey = '';
            renderApiKeyUI();
            if (currentApi) renderCodeExamples(currentApi);
        } else {
            showToast(data.message || '删除失败', 'error');
            deleteBtn.disabled = false;
            deleteBtn.textContent = originalText;
        }
    } catch (e) {
        console.error('删除ApiKey失败：', e);
        showToast('删除 API Key 失败', 'error');
        deleteBtn.disabled = false;
        deleteBtn.textContent = originalText;
    }
}

function copyApiKey() {
    if (!currentApiKey) return;
    copyToClipboard(currentApiKey, document.getElementById('copyApikeyBtn'));
}

function renderApiKeyUI() {
    const contentEl = document.getElementById('apikeyContent');
    const generateBtn = document.getElementById('generateApikeyBtn');
    const copyBtn = document.getElementById('copyApikeyBtn');
    const deleteBtn = document.getElementById('deleteApikeyBtn');

    if (currentApiKey) {
        const masked = currentApiKey.substring(0, 8) + '••••••••' + currentApiKey.substring(currentApiKey.length - 4);
        contentEl.innerHTML = `<code class="apikey-value" title="${currentApiKey}">${masked}</code>`;
        generateBtn.textContent = '重新生成';
        copyBtn.style.display = '';
        deleteBtn.style.display = '';
    } else {
        contentEl.innerHTML = '<span class="apikey-placeholder">未生成</span>';
        generateBtn.textContent = '生成';
        copyBtn.style.display = 'none';
        deleteBtn.style.display = 'none';
    }
    updateMcpDisplay();
}

// MCP 模块：切换至 MCP 标签时刷新展示
let mcpConfigEnabled = true;
async function loadMcpInfo() {
    await loadApiKey();
    try {
        const r = await fetchWithAuth(`${API_BASE}/api/data-ontology/mcp/config`);
        const data = await r.json();
        if (data.success) mcpConfigEnabled = data.enabled !== false;
    } catch (e) { mcpConfigEnabled = true; }
    const mcpCb = document.getElementById('mcpEnabledCheck');
    if (mcpCb) mcpCb.checked = mcpConfigEnabled;
    updateMcpDisplay();
}

async function toggleMcpEnabled() {
    const cb = document.getElementById('mcpEnabledCheck');
    if (!cb) return;
    const next = cb.checked;
    try {
        const r = await fetchWithAuth(`${API_BASE}/api/data-ontology/mcp/config`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ enabled: next })
        });
        const data = await r.json();
        if (data.success) mcpConfigEnabled = next;
        else cb.checked = !next;
    } catch (e) {
        cb.checked = !next;
    }
}

function updateMcpDisplay() {
    const baseUrl = API_BASE || window.location.origin;
    const baseEl = document.getElementById('mcpBaseUrl');
    const keyEl = document.getElementById('mcpApiKeyDisplay');
    const copyKeyBtn = document.getElementById('mcpCopyKeyBtn');
    const genKeyBtn = document.getElementById('mcpGenerateKeyBtn');
    const configPre = document.getElementById('mcpConfigPre');
    const clientSelect = document.getElementById('mcpClientType');
    const stepsList = document.getElementById('mcpStepsList');
    if (!baseEl) return;

    baseEl.textContent = baseUrl;
    if (currentApiKey) {
        keyEl.textContent = currentApiKey.substring(0, 8) + '••••••••' + currentApiKey.substring(currentApiKey.length - 4);
        keyEl.title = currentApiKey;
        if (copyKeyBtn) copyKeyBtn.style.display = '';
        if (genKeyBtn) genKeyBtn.textContent = '重新生成';
    } else {
        keyEl.textContent = '未生成';
        keyEl.title = '';
        if (copyKeyBtn) copyKeyBtn.style.display = 'none';
        if (genKeyBtn) genKeyBtn.textContent = '生成 API Key';
    }

    const key = currentApiKey || '<请先生成 API Key>';
    const clientType = (clientSelect && clientSelect.value) || 'cursor';
    const mcpUrl = baseUrl + '/mcp';
    let configText = '';
    let steps = [];
    if (clientType === 'cursor') {
        const config = {
            'data-ontology': {
                url: mcpUrl,
                headers: {
                    Authorization: 'Bearer ' + key
                }
            }
        };
        configText = JSON.stringify(config, null, 2);
        steps = [
            '确认数据本体池服务已运行，并在上方开启 MCP 总开关。',
            '打开 Cursor → Settings → MCP，点击"Add new MCP server"，粘贴上方配置；或写入 <code>~/.cursor/mcp.json</code>（Windows: <code>%USERPROFILE%\\.cursor\\mcp.json</code>）。',
            '保存后 Cursor 会自动连接，无需在本机安装任何额外程序。'
        ];
    } else if (clientType === 'claude') {
        const config = {
            mcpServers: {
                'data-ontology': {
                    url: mcpUrl,
                    headers: {
                        Authorization: 'Bearer ' + key
                    }
                }
            }
        };
        configText = JSON.stringify(config, null, 2);
        steps = [
            '确认数据本体池服务已运行，并在上方开启 MCP 总开关。',
            '在 Claude Desktop 配置文件（macOS: <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>，Windows: <code>%APPDATA%\\Claude\\claude_desktop_config.json</code>）中加入上述 mcpServers 片段。',
            '重启 Claude Desktop 即可，无需在本机安装额外程序。'
        ];
    } else if (clientType === 'cherry') {
        const config = {
            mcpServers: {
                'data-ontology': {
                    url: mcpUrl,
                    headers: {
                        Authorization: 'Bearer ' + key
                    }
                }
            }
        };
        configText = JSON.stringify(config, null, 2);
        steps = [
            '确认数据本体池服务已运行，并在上方开启 MCP 总开关。',
            '打开 Cherry Studio → 设置 → MCP 服务器，点击"添加服务器" → "从 JSON 导入"，将上方配置粘贴进去后保存。',
            '在聊天窗口底部开启 MCP 服务即可使用，无需在本机安装额外程序。'
        ];
    } else if (clientType === 'dify') {
        const config = {
            mcpServers: {
                'data-ontology': {
                    transport: 'streamable_http',
                    url: mcpUrl,
                    headers: {
                        Authorization: 'Bearer ' + key
                    },
                    timeout: 60
                }
            }
        };
        configText = JSON.stringify(config, null, 2);
        steps = [
            '确认数据本体池服务已运行，并在上方开启 MCP 总开关。',
            '在 Dify 插件市场安装 <code>dify-plugin-tools-mcp_sse</code> 插件（支持 GitHub 安装：<code>junjiem/dify-plugin-tools-mcp_sse</code>）。',
            '进入插件授权设置，将上方 JSON 粘贴到"MCP Servers config"输入框并保存。',
            '在需要使用的 Agent 应用中添加该插件工具，即可在对话中调用 data-ontology 工具集。',
            '注意：若 Dify 部署在 nginx 后且报超时错误，可在 .env 中设置 <code>NGINX_KEEPALIVE_TIMEOUT=650</code>。'
        ];
    } else {
        configText = `# Stdio 本地模式（客户端需在本机安装 datatoolbox-server 二进制）
# 从 GitHub Release 下载对应平台的可执行文件

# 环境变量
export DATA_ONTOLOGY_BASE_URL="${baseUrl}"
export DATA_ONTOLOGY_API_KEY="${key}"

# 运行命令
# Linux/macOS: ./datatoolbox-server mcp
# Windows PowerShell:
#   $env:DATA_ONTOLOGY_BASE_URL="${baseUrl}"
#   $env:DATA_ONTOLOGY_API_KEY="${key}"
#   .\\datatoolbox-server.exe mcp`;
        steps = [
            '从 GitHub Release 下载与系统对应的 datatoolbox-server 可执行文件到<strong>客户端本机</strong>。',
            '在支持 stdio MCP 的客户端中配置：命令 <code>datatoolbox-server</code>，参数 <code>mcp</code>，并设置上方两个环境变量。',
            '推荐优先使用 HTTP 模式（无需本地安装）。'
        ];
    }
    if (configPre) configPre.textContent = configText;
    if (stepsList) stepsList.innerHTML = steps.map((s, i) => `<li>${s}</li>`).join('');
}

// 加载接口列表
async function loadApis() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/apis`);

        const data = await response.json();

        if (data.success) {
            apis = data.apis || [];
            renderApiList();
        }
    } catch (error) {
        console.error('加载接口列表失败：', error);
        showToast('加载接口列表失败', 'error');
    }
}

// 过滤接口列表
function filterApiList() {
    renderApiList();
}

// 渲染接口列表
function renderApiList() {
    const listEl = document.getElementById('apiList');
    const searchInput = document.getElementById('apiSearchInput');
    const keyword = (searchInput ? searchInput.value : '').trim().toLowerCase();
    
    const filtered = keyword
        ? apis.filter(api => 
            api.name.toLowerCase().includes(keyword) || 
            api.path.toLowerCase().includes(keyword) ||
            api.method.toLowerCase().includes(keyword))
        : apis;

    if (filtered.length === 0) {
        listEl.innerHTML = `<div style="text-align:center;color:#718096;padding:20px;">${keyword ? '无匹配接口' : '暂无接口'}</div>`;
        return;
    }

    listEl.innerHTML = filtered.map(api => {
        const methodColor = {
            'GET': '#48bb78',
            'POST': '#4299e1',
            'PUT': '#ed8936',
            'DELETE': '#f56565'
        }[api.method] || '#718096';
        const enabled = api.enabled !== false;
        const safeApiId = escapeHtml(api.id);
        const safeApiName = escapeHtml(api.name);
        const safeApiPath = escapeHtml(api.path);
        return `
            <div class="db-item api-item ${currentApi && currentApi.id === api.id ? 'active' : ''} ${enabled ? '' : 'api-disabled'}" onclick="selectApi('${safeApiId}')">
                <div class="db-item-main">
                    <div class="db-item-name">${safeApiName}</div>
                    <div class="db-item-info">
                        <span style="color:${methodColor};font-weight:600;">${api.method}</span> ${safeApiPath}
                    </div>
                </div>
                <label class="switch-wrap" onclick="event.stopPropagation(); toggleApiEnabled('${safeApiId}')" title="${enabled ? '关闭接口' : '开启接口'}" style="flex-shrink:0;">
                    <input type="checkbox" ${enabled ? 'checked' : ''} onchange="event.stopPropagation()">
                    <span class="switch-slider"></span>
                </label>
            </div>
        `;
    }).join('');
}

// 选择接口
function selectApi(apiId) {
    currentApi = apis.find(api => api.id === apiId);
    if (currentApi) {
        renderApiList();
        loadApiDetail(apiId);
    }
}

// 切换接口启用状态（从列表或详情）。forceEnabled 为 undefined 时取反，否则设为该值
async function toggleApiEnabled(apiId, forceEnabled) {
    const api = apis.find(a => a.id === apiId);
    if (!api) return;
    const next = forceEnabled !== undefined ? forceEnabled : (api.enabled === false);
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/apis/${apiId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ enabled: next })
        });
        const data = await response.json();
        if (data.success) {
            api.enabled = next;
            renderApiList();
            if (currentApi && currentApi.id === apiId) {
                const cb = document.getElementById('apiDetailEnabledCheck');
                if (cb) cb.checked = next;
            }
        }
    } catch (e) {
        console.error('切换接口状态失败', e);
        showToast('切换接口状态失败', 'error');
    }
}

function toggleApiEnabledFromDetail() {
    if (!currentApi) return;
    const cb = document.getElementById('apiDetailEnabledCheck');
    if (!cb) return;
    toggleApiEnabled(currentApi.id, cb.checked);
}

// 加载接口详情
async function loadApiDetail(apiId) {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/apis/${apiId}`);

        const data = await response.json();

        if (data.success) {
            // 更新currentApi为完整的接口详情
            currentApi = data.api;
            
            document.getElementById('apiWelcomeView').style.display = 'none';
            document.getElementById('apiDetailView').style.display = 'block';
            
            const api = data.api;
            document.getElementById('apiName').textContent = api.name;
            const detailEnabledCb = document.getElementById('apiDetailEnabledCheck');
            if (detailEnabledCb) detailEnabledCb.checked = api.enabled !== false;
            document.getElementById('apiPath').textContent = api.path;
            document.getElementById('apiMethod').textContent = api.method;

            const apiType = api.type || 'query';
            document.getElementById('apiTypeDisplay').textContent = apiType === 'forward' ? 'HTTP转发' : '数据库查询';

            if (apiType === 'forward') {
                document.getElementById('apiDatabaseRow').style.display = 'none';
                document.getElementById('apiForwardUrlRow').style.display = '';
                document.getElementById('apiForwardUrlDisplay').textContent = api.forward_url || '';
                document.getElementById('apiSqlSection').style.display = 'none';
                document.getElementById('apiParamsSection').style.display = 'none';
            } else {
                document.getElementById('apiDatabaseRow').style.display = '';
                document.getElementById('apiForwardUrlRow').style.display = 'none';
                document.getElementById('apiSqlSection').style.display = '';
                document.getElementById('apiParamsSection').style.display = '';
                document.getElementById('apiDatabase').textContent = api.database_name || api.database_id;
                document.getElementById('apiSqlDisplay').textContent = api.sql;
            }
            
            // 解析并显示参数（仅 query 类型）
            const params = apiType === 'forward' ? [] : parseMyBatisParams(api.sql || '');
            renderApiParams(params);
            
            // 渲染调用示例
            renderCodeExamples(api);
        }
    } catch (error) {
        console.error('加载接口详情失败：', error);
        showToast('加载接口详情失败', 'error');
    }
}

// 解析MyBatis参数
function parseMyBatisParams(sql) {
    const paramsMap = new Map();
    
    // 匹配 #{paramName} 格式
    const hashPattern = /#\{([^}]+)\}/g;
    let match;
    while ((match = hashPattern.exec(sql)) !== null) {
        const paramName = match[1].trim();
        if (!paramsMap.has(paramName)) {
            paramsMap.set(paramName, {
                name: paramName,
                type: 'prepared',
                required: true
            });
        }
    }
    
    // 匹配 ${paramName} 格式
    const dollarPattern = /\$\{([^}]+)\}/g;
    while ((match = dollarPattern.exec(sql)) !== null) {
        const paramName = match[1].trim();
        // 如果参数不存在，添加为 direct 类型
        if (!paramsMap.has(paramName)) {
            paramsMap.set(paramName, {
                name: paramName,
                type: 'direct',
                required: true
            });
        }
    }
    
    return Array.from(paramsMap.values());
}

// 渲染接口参数
function renderApiParams(params) {
    const displayEl = document.getElementById('apiParamsDisplay');
    
    // 检查SQL语法问题
    let sqlWarningHtml = '';
    if (currentApi && currentApi.sql) {
        const warnings = validateSqlSyntax(currentApi.sql);
        if (warnings.length > 0) {
            const errorWarnings = warnings.filter(w => w.type === 'error');
            if (errorWarnings.length > 0) {
                sqlWarningHtml = `
                    <div class="sql-syntax-error">
                        <div class="error-icon">⚠️</div>
                        <div class="error-content">
                            <div class="error-title">SQL语法错误</div>
                            <div class="error-message">${errorWarnings[0].message}</div>
                            <div class="error-fix">
                                <strong>建议修复：</strong>
                                <div class="fix-example">
                                    <div class="fix-before">❌ ${escapeHtml(currentApi.sql)}</div>
                                    <div class="fix-after">✅ ${escapeHtml(currentApi.sql.replace(/#\{/g, '${'))}</div>
                                </div>
                                <button class="btn btn-sm btn-primary" onclick="quickFixSql()" style="margin-top:8px;">🔧 一键修复</button>
                            </div>
                        </div>
                    </div>
                `;
            }
        }
    }
    
    if (params.length === 0) {
        displayEl.innerHTML = sqlWarningHtml + '<div style="text-align:center;color:#718096;padding:12px;">无参数</div>';
        return;
    }
    
    const paramsHtml = params.map(param => {
        const typeLabel = param.type === 'prepared' ? '预编译' : '直接替换';
        const typeClass = param.required ? 'required' : 'optional';
        const requiredLabel = param.required ? '必填' : '可选';
        
        // 获取默认值
        let defaultValue = '';
        if (currentApi && currentApi.default_params && currentApi.default_params[param.name] !== undefined) {
            const val = currentApi.default_params[param.name];
            defaultValue = `<span style="color:#48bb78;margin-left:8px;font-size:12px;">默认: ${typeof val === 'string' ? '"' + val + '"' : val}</span>`;
        }
        
        return `
            <div class="param-item">
                <span class="param-name">${param.name}</span>
                <span class="param-type ${typeClass}">${requiredLabel}</span>
                <span style="color:#718096;margin-left:8px;font-size:13px;">(${typeLabel})</span>
                ${defaultValue}
            </div>
        `;
    }).join('');
    
    displayEl.innerHTML = sqlWarningHtml + paramsHtml;
}

// ==================== 调用示例代码生成 ====================

function getCodeExampleContext(api) {
    const apiType = api.type || 'query';
    let exampleParams = {};
    if (apiType === 'forward') {
        exampleParams = api.default_params ? { ...api.default_params } : {};
    } else {
        const params = parseMyBatisParams(api.sql || '');
        params.forEach(p => {
            if (api.default_params && api.default_params[p.name] !== undefined) {
                exampleParams[p.name] = api.default_params[p.name];
            } else {
                exampleParams[p.name] = '';
            }
        });
    }
    const hasParams = Object.keys(exampleParams).length > 0;
    const method = (api.method || 'GET').toUpperCase();
    const isBodyMethod = method === 'POST' || method === 'PUT' || method === 'PATCH';
    const baseUrl = `${window.location.origin}${api.path}`;
    const token = currentApiKey || localStorage.getItem('dataOntologyToken') || '<YOUR_TOKEN>';

    let fullUrl = baseUrl;
    if (!isBodyMethod && hasParams) {
        const qs = Object.entries(exampleParams)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&');
        fullUrl = `${baseUrl}?${qs}`;
    }

    return { params: exampleParams, hasParams, method, isBodyMethod, baseUrl, fullUrl, token };
}

function generateCodeExamples(api) {
    const ctx = getCodeExampleContext(api);
    return [
        { id: 'javascript', label: 'JavaScript', code: genJavaScript(ctx) },
        { id: 'python', label: 'Python', code: genPython(ctx) },
        { id: 'java', label: 'Java', code: genJava(ctx) },
        { id: 'golang', label: 'Go', code: genGolang(ctx) },
        { id: 'node', label: 'Node.js', code: genNode(ctx) },
        { id: 'php', label: 'PHP', code: genPhp(ctx) },
        { id: 'curl', label: 'cURL', code: genCurl(ctx) },
    ];
}

/**
 * 生成 JavaScript/Node.js 代码示例（两者语法相同）
 * @param {Object} ctx - 代码上下文
 * @returns {string} 生成的代码
 */
function genJavaScriptOrNode(ctx) {
    if (ctx.isBodyMethod && ctx.hasParams) {
        const bodyJson = JSON.stringify(ctx.params, null, 4);
        return `const response = await fetch("${ctx.baseUrl}", {
    method: "${ctx.method}",
    headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer ${ctx.token}"
    },
    body: JSON.stringify(${bodyJson})
});

const data = await response.json();
console.log(data);`;
    }
    if (ctx.isBodyMethod) {
        return `const response = await fetch("${ctx.baseUrl}", {
    method: "${ctx.method}",
    headers: {
        "Authorization": "Bearer ${ctx.token}"
    }
});

const data = await response.json();
console.log(data);`;
    }
    return `const response = await fetch("${ctx.fullUrl}", {
    headers: {
        "Authorization": "Bearer ${ctx.token}"
    }
});

const data = await response.json();
console.log(data);`;
}

// JavaScript 和 Node.js 使用相同的语法
const genJavaScript = genJavaScriptOrNode;
const genNode = genJavaScriptOrNode;

function genPython(ctx) {
    const lines = [];
    lines.push('import requests');
    lines.push('');
    lines.push(`url = "${ctx.baseUrl}"`);
    lines.push(`headers = {`);
    lines.push(`    "Authorization": "Bearer ${ctx.token}"`);
    lines.push(`}`);

    if (ctx.isBodyMethod && ctx.hasParams) {
        const items = Object.entries(ctx.params)
            .map(([k, v]) => `    "${k}": ${typeof v === 'string' ? `"${v}"` : v}`)
            .join(',\n');
        lines.push(`data = {\n${items}\n}`);
        lines.push('');
        lines.push(`response = requests.${ctx.method.toLowerCase()}(url, json=data, headers=headers)`);
    } else if (ctx.isBodyMethod) {
        lines.push('');
        lines.push(`response = requests.${ctx.method.toLowerCase()}(url, headers=headers)`);
    } else if (ctx.hasParams) {
        const items = Object.entries(ctx.params)
            .map(([k, v]) => `    "${k}": ${typeof v === 'string' ? `"${v}"` : v}`)
            .join(',\n');
        lines.push(`params = {\n${items}\n}`);
        lines.push('');
        lines.push(`response = requests.get(url, params=params, headers=headers)`);
    } else {
        lines.push('');
        lines.push(`response = requests.get(url, headers=headers)`);
    }
    lines.push('print(response.json())');
    return lines.join('\n');
}

function genJava(ctx) {
    const lines = [];
    lines.push('import java.net.URI;');
    lines.push('import java.net.http.HttpClient;');
    lines.push('import java.net.http.HttpRequest;');
    lines.push('import java.net.http.HttpResponse;');
    lines.push('');
    lines.push('HttpClient client = HttpClient.newHttpClient();');

    if (ctx.isBodyMethod && ctx.hasParams) {
        const bodyEsc = JSON.stringify(JSON.stringify(ctx.params));
        lines.push(`String body = ${bodyEsc};`);
        lines.push('');
        lines.push('HttpRequest request = HttpRequest.newBuilder()');
        lines.push(`    .uri(URI.create("${ctx.baseUrl}"))`);
        lines.push('    .header("Content-Type", "application/json")');
        lines.push(`    .header("Authorization", "Bearer ${ctx.token}")`);
        lines.push(`    .${ctx.method}(HttpRequest.BodyPublishers.ofString(body))`);
        lines.push('    .build();');
    } else {
        const methodCall = ctx.isBodyMethod
            ? `${ctx.method}(HttpRequest.BodyPublishers.noBody())`
            : 'GET()';
        lines.push('');
        lines.push('HttpRequest request = HttpRequest.newBuilder()');
        lines.push(`    .uri(URI.create("${ctx.fullUrl}"))`);
        lines.push(`    .header("Authorization", "Bearer ${ctx.token}")`);
        lines.push(`    .${methodCall}`);
        lines.push('    .build();');
    }

    lines.push('');
    lines.push('HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());');
    lines.push('System.out.println(response.body());');
    return lines.join('\n');
}

function genGolang(ctx) {
    const lines = [];
    lines.push('package main');
    lines.push('');
    lines.push('import (');
    lines.push('    "fmt"');
    lines.push('    "io"');
    lines.push('    "net/http"');
    if (ctx.isBodyMethod && ctx.hasParams) {
        lines.push('    "strings"');
    }
    lines.push(')');
    lines.push('');
    lines.push('func main() {');

    if (ctx.isBodyMethod && ctx.hasParams) {
        const bodyEsc = JSON.stringify(ctx.params).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        lines.push(`    body := strings.NewReader("${bodyEsc}")`);
        lines.push(`    req, _ := http.NewRequest("${ctx.method}", "${ctx.baseUrl}", body)`);
        lines.push('    req.Header.Set("Content-Type", "application/json")');
    } else {
        lines.push(`    req, _ := http.NewRequest("${ctx.method}", "${ctx.fullUrl}", nil)`);
    }

    lines.push(`    req.Header.Set("Authorization", "Bearer ${ctx.token}")`);
    lines.push('');
    lines.push('    resp, err := http.DefaultClient.Do(req)');
    lines.push('    if err != nil {');
    lines.push('        panic(err)');
    lines.push('    }');
    lines.push('    defer resp.Body.Close()');
    lines.push('');
    lines.push('    data, _ := io.ReadAll(resp.Body)');
    lines.push('    fmt.Println(string(data))');
    lines.push('}');
    return lines.join('\n');
}

function genPhp(ctx) {
    const lines = [];
    lines.push('<?php');

    if (ctx.isBodyMethod && ctx.hasParams) {
        lines.push(`$url = '${ctx.baseUrl}';`);
        const items = Object.entries(ctx.params)
            .map(([k, v]) => `    '${k}' => ${typeof v === 'string' ? `'${v}'` : v}`)
            .join(',\n');
        lines.push(`$data = [\n${items}\n];`);
        lines.push('');
        lines.push('$ch = curl_init($url);');
        lines.push('curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);');
        lines.push(`curl_setopt($ch, CURLOPT_CUSTOMREQUEST, '${ctx.method}');`);
        lines.push('curl_setopt($ch, CURLOPT_HTTPHEADER, [');
        lines.push("    'Content-Type: application/json',");
        lines.push(`    'Authorization: Bearer ${ctx.token}'`);
        lines.push(']);');
        lines.push('curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));');
    } else {
        lines.push(`$url = '${ctx.fullUrl}';`);
        lines.push('');
        lines.push('$ch = curl_init($url);');
        lines.push('curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);');
        if (ctx.method !== 'GET') {
            lines.push(`curl_setopt($ch, CURLOPT_CUSTOMREQUEST, '${ctx.method}');`);
        }
        lines.push('curl_setopt($ch, CURLOPT_HTTPHEADER, [');
        lines.push(`    'Authorization: Bearer ${ctx.token}'`);
        lines.push(']);');
    }

    lines.push('');
    lines.push('$response = curl_exec($ch);');
    lines.push('curl_close($ch);');
    lines.push('');
    lines.push('echo $response;');
    return lines.join('\n');
}

function genCurl(ctx) {
    const lines = [];
    if (ctx.isBodyMethod && ctx.hasParams) {
        const bodyEsc = JSON.stringify(ctx.params).replace(/'/g, "'\\''");
        lines.push(`curl -X ${ctx.method} '${ctx.baseUrl}' \\`);
        lines.push(`  -H 'Content-Type: application/json' \\`);
        lines.push(`  -H 'Authorization: Bearer ${ctx.token}' \\`);
        lines.push(`  -d '${bodyEsc}'`);
    } else {
        if (ctx.method === 'GET') {
            lines.push(`curl '${ctx.fullUrl}' \\`);
        } else {
            lines.push(`curl -X ${ctx.method} '${ctx.fullUrl}' \\`);
        }
        lines.push(`  -H 'Authorization: Bearer ${ctx.token}'`);
    }
    return lines.join('\n');
}

function renderCodeExamples(api) {
    const container = document.getElementById('apiCodeExamples');
    if (!container) return;

    const languages = generateCodeExamples(api);
    const activeTab = container.dataset.activeTab || languages[0].id;

    const tabsHtml = languages.map(lang =>
        `<button class="code-tab ${lang.id === activeTab ? 'active' : ''}" data-lang="${lang.id}">${lang.label}</button>`
    ).join('');

    const panelsHtml = languages.map(lang =>
        `<div class="code-panel ${lang.id === activeTab ? 'active' : ''}" data-lang="${lang.id}"><pre><code>${escapeHtml(lang.code)}</code></pre></div>`
    ).join('');

    container.innerHTML = `
        <div class="code-tabs-header">
            <div class="code-tabs">${tabsHtml}</div>
            <button class="code-copy-btn" title="复制代码">📋 复制</button>
        </div>
        <div class="code-panels">${panelsHtml}</div>
    `;

    container.dataset.activeTab = activeTab;

    container.querySelectorAll('.code-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const lang = tab.dataset.lang;
            container.dataset.activeTab = lang;
            container.querySelectorAll('.code-tab').forEach(t => t.classList.toggle('active', t.dataset.lang === lang));
            container.querySelectorAll('.code-panel').forEach(p => p.classList.toggle('active', p.dataset.lang === lang));
        });
    });

    container.querySelector('.code-copy-btn').addEventListener('click', () => {
        const activePanel = container.querySelector('.code-panel.active code');
        if (activePanel) {
            const text = activePanel.textContent;
            navigator.clipboard.writeText(text).then(() => {
                const btn = container.querySelector('.code-copy-btn');
                const original = btn.textContent;
                btn.textContent = '✅ 已复制';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.textContent = original;
                    btn.classList.remove('copied');
                }, 2000);
            });
        }
    });
}

// 一键修复SQL
async function quickFixSql() {
    if (!currentApi) return;
    
    if (!confirm('将 #{} 替换为 ${}，确认修复？')) {
        return;
    }
    
    // 修复SQL
    const fixedSql = currentApi.sql.replace(/#\{/g, '${');
    
    // 更新接口
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/apis/${currentApi.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: currentApi.name,
                path: currentApi.path,
                method: currentApi.method,
                database_id: currentApi.database_id,
                sql: fixedSql,
                description: currentApi.description,
                default_params: currentApi.default_params
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('修复成功！', 'success');
            loadApiDetail(currentApi.id);
        } else {
            showToast('修复失败：' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('修复失败：' + error.message, 'error');
    }
}

// 切换接口类型显示/隐藏字段
function switchApiTypeFields(type) {
    const queryFields = document.getElementById('apiQueryFields');
    const forwardFields = document.getElementById('apiForwardFields');
    const dbSelect = document.getElementById('apiDbSelect');
    const sqlInput = document.getElementById('apiSqlInput');
    const forwardUrlInput = document.getElementById('apiForwardUrlInput');
    if (type === 'forward') {
        queryFields.style.display = 'none';
        forwardFields.style.display = '';
        dbSelect.required = false;
        sqlInput.required = false;
        forwardUrlInput.required = true;
    } else {
        queryFields.style.display = '';
        forwardFields.style.display = 'none';
        dbSelect.required = true;
        sqlInput.required = true;
        forwardUrlInput.required = false;
    }
}

// 显示添加接口弹窗
async function showAddApiModal() {
    isEditApiMode = false;
    editingApiId = null;
    document.getElementById('apiModalTitle').textContent = '添加接口';
    document.getElementById('addApiModal').classList.add('show');
    document.getElementById('addApiForm').reset();
    document.getElementById('apiFormError').classList.remove('show');
    document.getElementById('apiFormSuccess').classList.remove('show');
    // 重置为 query 类型
    document.getElementById('apiTypeQuery').checked = true;
    switchApiTypeFields('query');
    // 加载数据库列表
    await loadDatabasesForSelect();
}

// 加载数据库列表到下拉框
async function loadDatabasesForSelect() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases`);

        const data = await response.json();

        if (data.success) {
            const selectEl = document.getElementById('apiDbSelect');
            const currentValue = selectEl.value;
            
            selectEl.innerHTML = '<option value="">请选择数据库</option>' + 
                (data.databases || []).map(db => 
                    `<option value="${db.id}">${db.name}</option>`
                ).join('');
            
            // 恢复之前的选择
            if (currentValue) {
                selectEl.value = currentValue;
            }
        }
    } catch (error) {
        console.error('加载数据库列表失败：', error);
    }
}

// 隐藏添加接口弹窗
function hideAddApiModal() {
    const form = document.getElementById('addApiForm');
    document.getElementById('addApiModal').classList.remove('show');
    isEditApiMode = false;
    editingApiId = null;
    
    // 清理AI标记
    delete form.dataset.fromAi;
    delete form.dataset.aiMessageId;
    
    // 清空表单
    form.reset();
}

// 添加/编辑接口
async function handleAddApi(e) {
    e.preventDefault();

    const apiType = document.querySelector('input[name="apiType"]:checked')?.value || 'query';

    const apiData = {
        name: document.getElementById('apiNameInput').value.trim(),
        path: document.getElementById('apiPathInput').value.trim(),
        method: document.getElementById('apiMethodInput').value,
        type: apiType,
        description: document.getElementById('apiDescInput').value.trim()
    };

    // 接口名称验证
    if (!apiData.name) {
        showApiFormError('请输入接口名称');
        return;
    }

    // 路径验证
    if (!apiData.path) {
        showApiFormError('请输入接口路径');
        return;
    }

    // 验证路径格式
    if (!apiData.path.startsWith('/')) {
        showApiFormError('接口路径必须以 / 开头');
        return;
    }

    if (apiType === 'forward') {
        apiData.forward_url = document.getElementById('apiForwardUrlInput').value.trim();
        if (!apiData.forward_url) {
            showApiFormError('请填写转发目标URL');
            return;
        }
        // URL格式验证
        try {
            new URL(apiData.forward_url);
        } catch {
            showApiFormError('转发目标URL格式不正确');
            return;
        }
    } else {
        apiData.database_id = document.getElementById('apiDbSelect').value;
        apiData.sql = document.getElementById('apiSqlInput').value.trim();
        
        // SQL验证
        if (!apiData.sql) {
            showApiFormError('请输入SQL语句');
            return;
        }
    }

    // 处理默认参数
    const defaultParamsText = document.getElementById('apiDefaultParamsInput').value.trim();
    if (defaultParamsText) {
        try {
            apiData.default_params = JSON.parse(defaultParamsText);
        } catch (error) {
            showApiFormError('默认参数格式错误，请输入有效的JSON格式');
            return;
        }
    }

    // query类型才验证SQL语法
    if (apiType !== 'forward') {
        const sqlWarnings = validateSqlSyntax(apiData.sql);
        if (sqlWarnings.length > 0) {
            const errors = sqlWarnings.filter(w => w.type === 'error');
            if (errors.length > 0) {
                showApiFormError(errors[0].message);
                return;
            }
            const warnings = sqlWarnings.filter(w => w.type === 'warning');
            if (warnings.length > 0) {
                const warningMsg = warnings.map(w => w.message).join('\n\n');
                if (!confirm('⚠️ SQL语法警告：\n\n' + warningMsg + '\n\n是否继续保存？')) {
                    return;
                }
            }
        }
    }

    const errorEl = document.getElementById('apiFormError');
    const successEl = document.getElementById('apiFormSuccess');
    errorEl.classList.remove('show');
    successEl.classList.remove('show');

    try {
        const url = isEditApiMode 
            ? `${API_BASE}/api/data-ontology/apis/${editingApiId}`
            : `${API_BASE}/api/data-ontology/apis`;
        
        const method = isEditApiMode ? 'PUT' : 'POST';
        
        const response = await fetchWithAuth(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(apiData)
        });

        const data = await response.json();

        if (data.success) {
            const isFromAi = e.target.dataset.fromAi === 'true';
            
            successEl.textContent = isEditApiMode ? '接口更新成功！' : '接口添加成功！';
            successEl.classList.add('show');
            
            setTimeout(() => {
                hideAddApiModal();
                loadApis();
                
                // 如果是从AI编辑后创建的，在AI聊天中显示成功消息
                if (isFromAi) {
                    const messagesEl = document.getElementById('aiChatMessages');
                    const messageId = 'msg-success-' + Date.now();
                    const messageHtml = `
                        <div class="ai-message assistant" id="${messageId}">
                            <div class="ai-message-avatar">✅</div>
                            <div class="ai-message-content">
                                <div style="padding: 12px; background: #d4edda; border-left: 3px solid #28a745; border-radius: 6px; color: #155724; font-size: 14px;">
                                    <strong>接口创建成功！</strong><br>
                                    <span style="font-size: 13px; margin-top: 4px; display: block;">
                                        接口名称: ${escapeHtml(apiData.name)}<br>
                                        接口路径: ${escapeHtml(apiData.path)}<br>
                                        请前往"接口分发"标签页查看和测试
                                    </span>
                                </div>
                            </div>
                        </div>
                    `;
                    messagesEl.insertAdjacentHTML('beforeend', messageHtml);
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                    
                    // 清理标记
                    delete e.target.dataset.fromAi;
                    delete e.target.dataset.aiMessageId;
                }
                
                if (isEditApiMode && currentApi && currentApi.id === editingApiId) {
                    setTimeout(() => {
                        loadApiDetail(editingApiId);
                    }, 300);
                }
            }, 1000);
        } else {
            showApiFormError(data.message || (isEditApiMode ? '更新失败' : '添加失败'));
        }
    } catch (error) {
        showApiFormError((isEditApiMode ? '更新失败：' : '添加失败：') + error.message);
    }
}

// 显示接口表单错误
function showApiFormError(message) {
    const errorEl = document.getElementById('apiFormError');
    errorEl.textContent = message;
    errorEl.classList.add('show');
}

// 验证SQL语法
function validateSqlSyntax(sql) {
    const warnings = [];
    
    // 检查DDL语句是否使用了预编译参数
    const isDDL = /^\s*(CREATE|DROP|ALTER|TRUNCATE)\s+/i.test(sql);
    const hasPreparedParams = /#\{[^}]+\}/g.test(sql);
    
    if (isDDL && hasPreparedParams) {
        warnings.push({
            type: 'error',
            message: 'DDL语句（CREATE/DROP/ALTER）不能使用预编译参数 #{}，请改用直接替换 ${}'
        });
    }
    
    // 检查${} 的SQL注入风险
    const hasDirectReplace = /\$\{[^}]+\}/g.test(sql);
    if (hasDirectReplace && !isDDL) {
        warnings.push({
            type: 'warning',
            message: '检测到直接替换 ${}，请注意SQL注入风险。建议优先使用预编译参数 #{}'
        });
    }
    
    return warnings;
}

// 编辑接口
async function handleEditApi() {
    if (!currentApi) return;
    
    isEditApiMode = true;
    editingApiId = currentApi.id;
    document.getElementById('apiModalTitle').textContent = '编辑接口';
    document.getElementById('addApiModal').classList.add('show');
    
    // 预填充表单
    document.getElementById('apiNameInput').value = currentApi.name;
    document.getElementById('apiPathInput').value = currentApi.path;
    document.getElementById('apiMethodInput').value = currentApi.method;
    document.getElementById('apiDescInput').value = currentApi.description || '';
    
    // 预填充接口类型
    const editType = currentApi.type || 'query';
    document.getElementById(editType === 'forward' ? 'apiTypeForward' : 'apiTypeQuery').checked = true;
    switchApiTypeFields(editType);
    
    if (editType === 'forward') {
        document.getElementById('apiForwardUrlInput').value = currentApi.forward_url || '';
    } else {
        document.getElementById('apiSqlInput').value = currentApi.sql || '';
    }
    
    // 预填充默认参数
    if (currentApi.default_params && Object.keys(currentApi.default_params).length > 0) {
        document.getElementById('apiDefaultParamsInput').value = JSON.stringify(currentApi.default_params, null, 2);
    } else {
        document.getElementById('apiDefaultParamsInput').value = '';
    }
    
    // 加载数据库列表并选择当前数据库
    await loadDatabasesForSelect();
    document.getElementById('apiDbSelect').value = currentApi.database_id;
    
    document.getElementById('apiFormError').classList.remove('show');
    document.getElementById('apiFormSuccess').classList.remove('show');
}

// 删除接口
async function handleDeleteApi() {
    if (!currentApi) return;

    if (!confirm(`确定要删除接口 "${currentApi.name}" 吗？此操作不可恢复。`)) {
        return;
    }

    const deleteBtn = document.getElementById('deleteApiBtn');
    const originalText = deleteBtn.textContent;
    deleteBtn.disabled = true;
    deleteBtn.textContent = '删除中...';

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/apis/${currentApi.id}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            currentApi = null;
            document.getElementById('apiWelcomeView').style.display = 'flex';
            document.getElementById('apiDetailView').style.display = 'none';
            loadApis();
        } else {
            showToast(data.message || '删除失败', 'error');
            deleteBtn.disabled = false;
            deleteBtn.textContent = originalText;
        }
    } catch (error) {
        showToast('删除失败：' + error.message, 'error');
        deleteBtn.disabled = false;
        deleteBtn.textContent = originalText;
    }
}

// 显示测试接口弹窗
function showTestApiModal() {
    if (!currentApi) return;
    
    document.getElementById('testApiModal').classList.add('show');
    document.getElementById('testApiPath').textContent = currentApi.path;
    document.getElementById('testApiMethod').textContent = currentApi.method;
    document.getElementById('testApiParams').value = '';
    document.getElementById('testApiError').classList.remove('show');
    document.getElementById('testApiResultGroup').style.display = 'none';
    
    // 预填充参数
    const apiType = currentApi.type || 'query';
    if (apiType === 'forward') {
        // 转发类型：预填充默认参数（如有）
        if (currentApi.default_params && Object.keys(currentApi.default_params).length > 0) {
            document.getElementById('testApiParams').value = JSON.stringify(currentApi.default_params, null, 2);
        }
    } else {
        // query类型：从 SQL 解析参数
        const params = parseMyBatisParams(currentApi.sql);
        if (params.length > 0) {
            const exampleParams = {};
            params.forEach(param => {
                if (currentApi.default_params && currentApi.default_params[param.name] !== undefined) {
                    exampleParams[param.name] = currentApi.default_params[param.name];
                } else {
                    exampleParams[param.name] = '';
                }
            });
            document.getElementById('testApiParams').value = JSON.stringify(exampleParams, null, 2);
        } else if (currentApi.default_params && Object.keys(currentApi.default_params).length > 0) {
            document.getElementById('testApiParams').value = JSON.stringify(currentApi.default_params, null, 2);
        }
    }
}

// 隐藏测试接口弹窗
function hideTestApiModal() {
    document.getElementById('testApiModal').classList.remove('show');
}

// 执行接口测试
async function executeApiTest() {
    if (!currentApi) return;
    
    const paramsText = document.getElementById('testApiParams').value.trim();
    let params = {};
    
    // 解析参数
    if (paramsText) {
        try {
            params = JSON.parse(paramsText);
        } catch (error) {
            showTestApiError('参数格式错误，请输入有效的JSON格式');
            return;
        }
    }
    
    const errorEl = document.getElementById('testApiError');
    const resultGroup = document.getElementById('testApiResultGroup');
    errorEl.classList.remove('show');
    resultGroup.style.display = 'none';
    
    const startTime = Date.now();
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/apis/${currentApi.id}/test`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ params })
        });

        const endTime = Date.now();
        const duration = endTime - startTime;
        
        const data = await response.json();

        if (data.success) {
            document.getElementById('testResultStatus').textContent = '成功';
            document.getElementById('testResultStatus').style.color = '#38a169';
            document.getElementById('testResultTime').textContent = duration;
            document.getElementById('testResultContent').textContent = JSON.stringify(data.data, null, 2);
            resultGroup.style.display = 'block';
        } else {
            showTestApiError(data.message || '测试失败');
        }
    } catch (error) {
        showTestApiError('测试失败：' + error.message);
    }
}

// 显示测试接口错误
function showTestApiError(message) {
    const errorEl = document.getElementById('testApiError');
    errorEl.textContent = message;
    errorEl.classList.add('show');
}

// ==================== AI助手功能 ====================

// 加载AI配置
async function loadAiConfig() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/ai/config`);

        const data = await response.json();

        if (data.success && data.config) {
            aiConfig = data.config;
        }
    } catch (error) {
        console.error('加载AI配置失败：', error);
    }
}

// 显示AI设置弹窗
function showAiSettingsModal() {
    document.getElementById('aiSettingsModal').classList.add('show');
    
    // 预填充配置
    if (aiConfig) {
        document.getElementById('aiUrlInput').value = aiConfig.url || '';
        document.getElementById('aiApiKeyInput').value = aiConfig.api_key || '';
        document.getElementById('aiModelInput').value = aiConfig.model || '';
    } else {
        document.getElementById('aiSettingsForm').reset();
    }
    
    document.getElementById('aiSettingsError').classList.remove('show');
    document.getElementById('aiSettingsSuccess').classList.remove('show');
}

// 隐藏AI设置弹窗
function hideAiSettingsModal() {
    document.getElementById('aiSettingsModal').classList.remove('show');
}

// ========== 设置弹窗功能 ==========
const TAB_VISIBILITY_KEY = 'tabVisibilitySettings';
const ALL_TABS = [
    { id: 'database', name: '数据库管理' },
    { id: 'governance', name: '数据治理' },
    { id: 'ontology', name: '本体论抽象' },
    { id: 'lineage', name: '数据血缘' },
    { id: 'api', name: '接口分发' },
    { id: 'mcp', name: 'MCP' },
    { id: 'ai', name: 'AI助手' },
    { id: 'models', name: '模型管理' },
    { id: 'quality', name: '数据质量审核' }
];

// 显示设置弹窗
function showSettingsModal() {
    document.getElementById('settingsModal').classList.add('show');
    loadTabSettings();
}

// 隐藏设置弹窗
function hideSettingsModal() {
    document.getElementById('settingsModal').classList.remove('show');
}

// 加载标签页可见性设置
function loadTabSettings() {
    const container = document.getElementById('tabVisibilitySettings');
    if (!container) return;

    // 从 localStorage 加载设置
    let settings = null;
    try {
        const stored = localStorage.getItem(TAB_VISIBILITY_KEY);
        if (stored) {
            settings = JSON.parse(stored);
        }
    } catch (e) {
        console.error('加载标签页设置失败：', e);
    }

    // 应用设置到复选框
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        const tabId = cb.dataset.tab;
        if (settings && settings.hasOwnProperty(tabId)) {
            cb.checked = settings[tabId];
        } else {
            cb.checked = true; // 默认显示
        }
    });
}

// 保存标签页可见性设置
function saveTabSettings() {
    const container = document.getElementById('tabVisibilitySettings');
    if (!container) return;

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    const settings = {};
    let visibleCount = 0;

    checkboxes.forEach(cb => {
        const tabId = cb.dataset.tab;
        settings[tabId] = cb.checked;
        if (cb.checked) visibleCount++;
    });

    // 至少保留一个标签页
    if (visibleCount < 1) {
        showToast('至少需要保留一个标签页显示', 'warning');
        return false;
    }

    try {
        localStorage.setItem(TAB_VISIBILITY_KEY, JSON.stringify(settings));
        applyTabVisibility(settings);
        showToast('设置已保存', 'success');
        hideSettingsModal();
        return true;
    } catch (e) {
        console.error('保存标签页设置失败：', e);
        showToast('保存设置失败', 'error');
        return false;
    }
}

// 重置标签页设置为默认（全部显示）
function resetTabSettings() {
    const container = document.getElementById('tabVisibilitySettings');
    if (!container) return;

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        cb.checked = true;
    });
}

// 应用标签页可见性
function applyTabVisibility(settings) {
    if (!settings) {
        // 如果没有设置，加载保存的设置
        try {
            const stored = localStorage.getItem(TAB_VISIBILITY_KEY);
            if (stored) {
                settings = JSON.parse(stored);
            }
        } catch (e) {
            console.error('加载标签页设置失败：', e);
            return;
        }
    }

    // 如果还是没有设置，默认全部显示
    if (!settings) return;

    // 应用到标签页按钮
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
        const tabId = tab.dataset.tab;
        if (settings.hasOwnProperty(tabId)) {
            tab.style.display = settings[tabId] ? '' : 'none';
        }
    });

    // 检查当前激活的标签页是否被隐藏，如果是则切换到第一个可见的标签页
    const activeTab = document.querySelector('.nav-tab.active');
    if (activeTab) {
        const activeTabId = activeTab.dataset.tab;
        if (settings[activeTabId] === false) {
            // 找到第一个可见的标签页并激活
            const firstVisibleTab = document.querySelector('.nav-tab:not([style*="display: none"])');
            if (firstVisibleTab) {
                switchTab(firstVisibleTab.dataset.tab);
            }
        }
    }
}

// 保存AI配置
async function handleSaveAiSettings(e) {
    e.preventDefault();

    const config = {
        url: document.getElementById('aiUrlInput').value,
        api_key: document.getElementById('aiApiKeyInput').value,
        model: document.getElementById('aiModelInput').value
    };

    const errorEl = document.getElementById('aiSettingsError');
    const successEl = document.getElementById('aiSettingsSuccess');
    errorEl.classList.remove('show');
    successEl.classList.remove('show');

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/ai/config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });

        const data = await response.json();

        if (data.success) {
            aiConfig = config;
            successEl.textContent = 'AI配置保存成功！';
            successEl.classList.add('show');
            setTimeout(() => {
                hideAiSettingsModal();
            }, 1000);
        } else {
            errorEl.textContent = data.message || '保存失败';
            errorEl.classList.add('show');
        }
    } catch (error) {
        errorEl.textContent = '保存失败：' + error.message;
        errorEl.classList.add('show');
    }
}

// 处理AI输入框输入
function handleAiInputChange(e) {
    const input = e.target;
    const value = input.value;
    const cursorPos = input.selectionStart;
    
    // 自动调整高度
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    
    // 检测@符号
    const textBeforeCursor = value.substring(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\S*)$/);
    
    if (atMatch) {
        const searchTerm = atMatch[1].toLowerCase();
        showDbSuggestions(searchTerm);
    } else {
        hideDbSuggestions();
    }
}

// 显示@建议（模块+数据库混合）
function showDbSuggestions(searchTerm) {
    const matchedModules = aiModules.filter(m =>
        m.name.toLowerCase().includes(searchTerm)
    );
    const matchedDbs = databases.filter(db =>
        db.name.toLowerCase().includes(searchTerm)
    );

    if (matchedModules.length === 0 && matchedDbs.length === 0) {
        hideDbSuggestions();
        return;
    }

    const suggestionsEl = document.getElementById('aiDbSuggestions');
    let html = '';

    if (matchedModules.length > 0) {
        html += '<div class="ai-suggestion-group-title">功能模块</div>';
        html += matchedModules.map(m => {
            const safeMId = escapeHtml(m.id);
            const safeMName = escapeHtml(m.name);
            const safeMDesc = escapeHtml(m.description);
            return `
            <div class="ai-db-suggestion ai-module-suggestion"
                 onclick="selectSuggestion('module','${safeMId}')"
                 data-type="module" data-id="${safeMId}">
                <span class="ai-db-suggestion-icon">${m.icon}</span>
                <span class="ai-db-suggestion-name">${safeMName}</span>
                <span class="ai-db-suggestion-info">${safeMDesc}</span>
            </div>
        `}).join('');
    }

    if (matchedDbs.length > 0) {
        html += '<div class="ai-suggestion-group-title">数据库</div>';
        html += matchedDbs.map(db => {
            const typeIcon = dbTypeIcons[db.type] || '🗄️';
            const isFileDb = dbTypeDefaults[db.type]?.isFile;
            const info = isFileDb ? db.path : `${db.host}:${db.port}`;
            const safeDbId = escapeHtml(db.id);
            const safeDbName = escapeHtml(db.name);
            const safeInfo = escapeHtml(info);
            return `
                <div class="ai-db-suggestion"
                     onclick="selectSuggestion('db','${safeDbId}')"
                     data-type="db" data-id="${safeDbId}">
                    <span class="ai-db-suggestion-icon">${typeIcon}</span>
                    <span class="ai-db-suggestion-name">${safeDbName}</span>
                    <span class="ai-db-suggestion-info">${safeInfo}</span>
                </div>
            `;
        }).join('');
    }

    suggestionsEl.innerHTML = html;
    suggestionsEl.style.display = 'block';
    dbSuggestionIndex = -1;
}

// 隐藏建议
function hideDbSuggestions() {
    document.getElementById('aiDbSuggestions').style.display = 'none';
    dbSuggestionIndex = -1;
}

// 统一选择建议项
function selectSuggestion(type, id) {
    let name = '';
    if (type === 'module') {
        const m = aiModules.find(m => m.id === id);
        if (!m) return;
        name = m.name;
    } else {
        const db = databases.find(d => d.id === id);
        if (!db) return;
        name = db.name;
    }

    const input = document.getElementById('aiInput');
    const value = input.value;
    const cursorPos = input.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex !== -1) {
        const newValue = value.substring(0, atIndex) + `@${name} ` + value.substring(cursorPos);
        input.value = newValue;
        input.selectionStart = input.selectionEnd = atIndex + name.length + 2;
        input.focus();
    }

    hideDbSuggestions();
}

// 兼容旧调用
function selectDbSuggestion(dbId) {
    selectSuggestion('db', dbId);
}

// 处理AI输入框按键
function handleAiInputKeydown(e) {
    const suggestionsEl = document.getElementById('aiDbSuggestions');

    if (suggestionsEl.style.display === 'block') {
        const items = suggestionsEl.querySelectorAll('.ai-db-suggestion');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            dbSuggestionIndex = Math.min(dbSuggestionIndex + 1, items.length - 1);
            updateSuggestionHighlight(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            dbSuggestionIndex = Math.max(dbSuggestionIndex - 1, -1);
            updateSuggestionHighlight(items);
        } else if (e.key === 'Enter' && dbSuggestionIndex >= 0) {
            e.preventDefault();
            const item = items[dbSuggestionIndex];
            selectSuggestion(item.dataset.type, item.dataset.id);
        } else if (e.key === 'Escape') {
            hideDbSuggestions();
        }
    } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendAiMessage();
    }
}

// 更新建议高亮
function updateSuggestionHighlight(suggestions) {
    suggestions.forEach((el, index) => {
        if (index === dbSuggestionIndex) {
            el.classList.add('active');
            el.scrollIntoView({ block: 'nearest' });
        } else {
            el.classList.remove('active');
        }
    });
}

// 发送AI消息（流式）
async function handleSendAiMessage() {
    const input = document.getElementById('aiInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    // 检查AI配置
    if (!aiConfig || !aiConfig.url || !aiConfig.api_key || !aiConfig.model) {
        showAiError('请先配置AI设置');
        return;
    }
    
    // 提取所有@引用，区分模块和数据库
    const allMatches = [...message.matchAll(/@([^\s]+)/g)];
    const dbReferences = [];
    const moduleReferences = [];

    for (const match of allMatches) {
        const refName = match[1];
        const mod = aiModules.find(m => m.name === refName);
        if (mod) {
            moduleReferences.push(mod);
            continue;
        }
        const db = databases.find(d => d.name === refName);
        if (db) {
            dbReferences.push(db);
        }
    }

    // 更新模块上下文
    if (moduleReferences.length > 0) {
        aiSessionContext.modules = moduleReferences;
    }

    // 更新数据库上下文
    if (dbReferences.length > 0) {
        aiSessionContext.databases = dbReferences;
    } else if (aiSessionContext.databases.length > 0) {
        dbReferences.push(...aiSessionContext.databases);
    } else {
        showAiError('请使用 @数据库名 来引用数据库，或在之前的对话中已经引用过数据库');
        return;
    }

    updateAiContextDisplay();

    // 添加到历史记录
    aiSessionContext.history.push({
        role: 'user',
        content: message,
        databases: dbReferences.map(db => db.id),
        modules: aiSessionContext.modules.map(m => m.id)
    });

    // 添加用户消息（如果没有@但使用了上下文，显示提示）
    let displayMessage = message;
    if (allMatches.length === 0 && aiSessionContext.databases.length > 0) {
        const contextDbs = aiSessionContext.databases.map(db => `@${db.name}`).join(' ');
        displayMessage = message + `\n<div class="ai-context-hint">💡 使用上下文: ${contextDbs}</div>`;
    }
    addAiMessage('user', displayMessage);
    
    // 清空输入框
    input.value = '';
    input.style.height = 'auto';
    
    // 禁用发送按钮
    const sendBtn = document.getElementById('aiSendBtn');
    sendBtn.disabled = true;
    
    // 创建流式消息容器
    const streamMessageId = addAiStreamMessage();
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/ai/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                databases: dbReferences.map(db => db.id),
                modules: aiSessionContext.modules.map(m => m.id),
                history: aiSessionContext.history.slice(-5)
            })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, {stream: true});
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
                if (!line.trim()) continue;
                
                const eventMatch = line.match(/^event: (.+)\ndata: (.+)$/);
                if (eventMatch) {
                    const eventType = eventMatch[1];
                    const data = JSON.parse(eventMatch[2]);
                    handleStreamEvent(streamMessageId, eventType, data, message);
                }
            }
        }
    } catch (error) {
        updateStreamMessage(streamMessageId, 'error', {message: '查询失败：' + error.message});
    } finally {
        sendBtn.disabled = false;
    }
}

// 添加AI消息
function addAiMessage(role, content) {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-' + Date.now();
    
    // 移除欢迎消息
    const welcomeMsg = messagesEl.querySelector('.ai-welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }
    
    const avatar = role === 'user' ? '👤' : '🤖';
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    
    // 处理数据库引用高亮（只对不包含HTML的内容进行转义和高亮）
    let displayContent = content;
    
    // 如果内容包含HTML标签（如上下文提示），直接使用
    if (content.includes('<div')) {
        // 先提取HTML部分
        const parts = content.split('<div');
        displayContent = escapeHtml(parts[0]);
        
        // 处理@引用高亮
        const dbMatches = [...parts[0].matchAll(/@([^\s]+)/g)];
        for (const match of dbMatches) {
            const dbName = match[1];
            displayContent = displayContent.replace(
                new RegExp(escapeHtml(`@${dbName}`), 'g'),
                `<span class="ai-db-reference">@${dbName}</span>`
            );
        }
        
        // 添加HTML部分（不转义）
        if (parts.length > 1) {
            displayContent += '<div' + parts.slice(1).join('<div');
        }
    } else {
        // 普通内容，先转义再高亮
        displayContent = escapeHtml(content);
        const dbMatches = [...content.matchAll(/@([^\s]+)/g)];
        for (const match of dbMatches) {
            const dbName = match[1];
            displayContent = displayContent.replace(
                new RegExp(escapeHtml(`@${dbName}`), 'g'),
                `<span class="ai-db-reference">@${dbName}</span>`
            );
        }
    }
    
    const messageHtml = `
        <div class="ai-message ${role}" id="${messageId}">
            <div class="ai-message-avatar">${avatar}</div>
            <div class="ai-message-content">
                <div class="ai-message-bubble">${displayContent}</div>
                <div class="ai-message-meta">${time}</div>
            </div>
        </div>
    `;
    
    messagesEl.insertAdjacentHTML('beforeend', messageHtml);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    
    return messageId;
}

// 添加AI助手消息（带SQL和结果）
function addAiAssistantMessage(content, sql, results) {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-' + Date.now();
    
    const avatar = '🤖';
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    
    let resultHtml = '';
    
    // 如果有SQL，显示SQL标题和代码块
    if (sql) {
        resultHtml += `
            <div style="margin-top: 6px;">
                <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">📝 生成的SQL查询：</div>
                <div class="ai-sql-block">${escapeHtml(sql)}</div>
            </div>
        `;
    }
    
    // 如果有结果，显示结果标题和表格
    if (results && results.length > 0) {
        resultHtml += `
            <div style="margin-top: 6px;">
                <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">📊 查询结果：</div>
                <div class="ai-result-table">
                    <table>
                        <thead>
                            <tr>
                                ${Object.keys(results[0]).map(col => `<th>${escapeHtml(col)}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${results.slice(0, 10).map(row => `
                                <tr>
                                    ${Object.keys(results[0]).map(col => `<td>${row[col] !== null ? escapeHtml(String(row[col])) : '<i style="color: #a0aec0;">NULL</i>'}</td>`).join('')}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div style="font-size: 11px; color: #718096; margin-top: 4px; padding-left: 4px;">
                    ✓ 共查询到 <strong>${results.length}</strong> 条记录${results.length > 10 ? '，显示前10条' : ''}
                </div>
            </div>
        `;
    } else if (results && results.length === 0) {
        resultHtml += `
            <div style="margin-top: 6px;">
                <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">📊 查询结果：</div>
                <div style="padding: 10px; background: #f7fafc; border-radius: 6px; color: #718096; text-align: center; font-size: 12px;">
                    暂无数据
                </div>
            </div>
        `;
    }
    
    const messageHtml = `
        <div class="ai-message assistant" id="${messageId}">
            <div class="ai-message-avatar">${avatar}</div>
            <div class="ai-message-content">
                <div class="ai-message-bubble">
                    <div>${formatAIText(content)}</div>
                    ${resultHtml}
                </div>
                <div class="ai-message-meta">${time}</div>
            </div>
        </div>
    `;
    
    messagesEl.insertAdjacentHTML('beforeend', messageHtml);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    
    return messageId;
}

// 添加AI助手消息（带重试过程）
function addAiAssistantMessageWithRetries(content, sql, results, attempts, retries) {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-' + Date.now();
    
    const avatar = '🤖';
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    
    let resultHtml = '';
    
    // 显示重试信息
    if (retries > 0) {
        const retryId = 'retry-' + messageId;
        resultHtml += `
            <div style="margin-top: 6px;">
                <div class="ai-retry-header" onclick="toggleRetryDetails('${retryId}')" style="cursor: pointer; padding: 5px 10px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 5px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 12px; color: #856404;">
                        🔄 经过 ${retries} 次重试后成功
                    </span>
                    <span id="${retryId}-icon" style="font-size: 11px; color: #856404;">▼</span>
                </div>
                <div id="${retryId}" class="ai-retry-details" style="display: none; margin-top: 4px; padding: 8px; background: #f8f9fa; border-radius: 5px; border: 1px solid #e2e8f0;">
                    ${attempts.map((attempt, index) => `
                        <div style="margin-bottom: ${index < attempts.length - 1 ? '6px' : '0'}; padding-bottom: ${index < attempts.length - 1 ? '6px' : '0'}; border-bottom: ${index < attempts.length - 1 ? '1px solid #e2e8f0' : 'none'};">
                            <div style="font-size: 11px; font-weight: 600; color: #e53e3e; margin-bottom: 2px;">
                                ❌ 尝试 ${attempt.attempt}：${escapeHtml(attempt.error)}
                            </div>
                            ${attempt.sql ? `<div class="ai-sql-block" style="font-size: 11px; padding: 6px 8px; margin-top: 3px;">${escapeHtml(attempt.sql)}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    // 如果有SQL，显示SQL标题和代码块
    if (sql) {
        resultHtml += `
            <div style="margin-top: 6px;">
                <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">✅ 最终成功的SQL查询：</div>
                <div class="ai-sql-block">${escapeHtml(sql)}</div>
            </div>
        `;
    }
    
    // 如果有结果，显示结果标题和表格
    if (results && results.length > 0) {
        resultHtml += `
            <div style="margin-top: 6px;">
                <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">📊 查询结果：</div>
                <div class="ai-result-table">
                    <table>
                        <thead>
                            <tr>
                                ${Object.keys(results[0]).map(col => `<th>${escapeHtml(col)}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${results.slice(0, 10).map(row => `
                                <tr>
                                    ${Object.keys(results[0]).map(col => `<td>${row[col] !== null ? escapeHtml(String(row[col])) : '<i style="color: #a0aec0;">NULL</i>'}</td>`).join('')}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div style="font-size: 11px; color: #718096; margin-top: 4px; padding-left: 4px;">
                    ✓ 共查询到 <strong>${results.length}</strong> 条记录${results.length > 10 ? '，显示前10条' : ''}
                </div>
            </div>
        `;
    }
    
    const messageHtml = `
        <div class="ai-message assistant" id="${messageId}">
            <div class="ai-message-avatar">${avatar}</div>
            <div class="ai-message-content">
                <div class="ai-message-bubble">
                    <div>${formatAIText(content)}</div>
                    ${resultHtml}
                </div>
                <div class="ai-message-meta">${time}</div>
            </div>
        </div>
    `;
    
    messagesEl.insertAdjacentHTML('beforeend', messageHtml);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    
    return messageId;
}

// 显示AI错误（带尝试记录）
function showAiErrorWithAttempts(message, attempts) {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-error-' + Date.now();
    const retryId = 'retry-' + messageId;
    
    const messageHtml = `
        <div class="ai-message assistant" id="${messageId}">
            <div class="ai-message-avatar">⚠️</div>
            <div class="ai-message-content">
                <div class="ai-error">
                    <div style="font-weight: 600; margin-bottom: 4px;">${escapeHtml(message)}</div>
                    <div style="font-size: 11px; margin-bottom: 6px;">已尝试 ${attempts.length} 次，均未成功</div>
                    <div class="ai-retry-header" onclick="toggleRetryDetails('${retryId}')" style="cursor: pointer; padding: 4px 8px; background: rgba(255, 255, 255, 0.3); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 12px;">查看所有尝试</span>
                        <span id="${retryId}-icon" style="font-size: 11px;">▼</span>
                    </div>
                    <div id="${retryId}" class="ai-retry-details" style="display: none; margin-top: 4px; padding: 8px; background: rgba(255, 255, 255, 0.2); border-radius: 4px;">
                        ${attempts.map((attempt, index) => `
                            <div style="margin-bottom: ${index < attempts.length - 1 ? '6px' : '0'}; padding-bottom: ${index < attempts.length - 1 ? '6px' : '0'}; border-bottom: ${index < attempts.length - 1 ? '1px solid rgba(255, 255, 255, 0.3)' : 'none'};">
                                <div style="font-size: 11px; font-weight: 600; margin-bottom: 2px;">
                                    尝试 ${attempt.attempt}：${escapeHtml(attempt.error)}
                                </div>
                                ${attempt.sql ? `<div class="ai-sql-block" style="font-size: 11px; padding: 6px 8px; margin-top: 3px;">${escapeHtml(attempt.sql)}</div>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    messagesEl.insertAdjacentHTML('beforeend', messageHtml);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// 切换重试详情显示
function toggleRetryDetails(retryId) {
    const details = document.getElementById(retryId);
    const icon = document.getElementById(retryId + '-icon');
    
    if (details.style.display === 'none') {
        details.style.display = 'block';
        icon.textContent = '▲';
    } else {
        details.style.display = 'none';
        icon.textContent = '▼';
    }
}

async function executeConfirmedSQL(confirmId, sql, dbId, messageId) {
    const confirmEl = document.getElementById(confirmId);
    if (!confirmEl) return;

    confirmEl.innerHTML = `<div class="ai-status-executing">⚡ 正在执行写操作...</div>`;

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/ai/confirm-execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sql, dbId })
        });
        const result = await response.json();

        if (result.success) {
            let html = `<div class="ai-status-success" style="margin-bottom: 4px;">✅ 写操作执行成功</div>`;
            if (result.results && result.results.length > 0) {
                html += `
                    <div style="margin-top: 6px;">
                        <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">📊 执行结果：</div>
                        <div class="ai-result-table">
                            <table>
                                <thead><tr>${Object.keys(result.results[0]).map(col => `<th>${escapeHtml(col)}</th>`).join('')}</tr></thead>
                                <tbody>${result.results.slice(0, 10).map(row => `<tr>${Object.keys(result.results[0]).map(col => `<td>${row[col] !== null ? escapeHtml(String(row[col])) : '<i style="color:#a0aec0;">NULL</i>'}</td>`).join('')}</tr>`).join('')}</tbody>
                            </table>
                        </div>
                    </div>`;
            } else {
                html += `<div style="font-size: 12px; color: #718096; margin-top: 4px;">操作已成功执行。</div>`;
            }
            confirmEl.innerHTML = html;
        } else {
            confirmEl.innerHTML = `<div class="ai-error">${escapeHtml(result.message)}</div>`;
        }
    } catch (error) {
        confirmEl.innerHTML = `<div class="ai-error">执行失败：${escapeHtml(error.message)}</div>`;
    }
}

function cancelConfirmedSQL(confirmId, messageId) {
    const confirmEl = document.getElementById(confirmId);
    if (!confirmEl) return;
    confirmEl.innerHTML = `<div class="ai-status-retry" style="animation: none;">🚫 用户已取消执行该写操作</div>`;
}

// 添加流式消息容器
function addAiStreamMessage() {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-stream-' + Date.now();
    
    // 移除欢迎消息
    const welcomeMsg = messagesEl.querySelector('.ai-welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }
    
    const avatar = '🤖';
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    
    const messageHtml = `
        <div class="ai-message assistant" id="${messageId}">
            <div class="ai-message-avatar">${avatar}</div>
            <div class="ai-message-content">
                <div class="ai-message-bubble">
                    <div id="${messageId}-status" class="ai-stream-status"></div>
                    <div id="${messageId}-content" class="ai-stream-content"></div>
                    <div id="${messageId}-attempts" class="ai-stream-attempts" style="display:none;"></div>
                </div>
                <div class="ai-message-meta">${time}</div>
            </div>
        </div>
    `;
    
    messagesEl.insertAdjacentHTML('beforeend', messageHtml);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    
    return messageId;
}

// 处理流式事件
function handleStreamEvent(messageId, eventType, data, userMessage) {
    const statusEl = document.getElementById(`${messageId}-status`);
    const contentEl = document.getElementById(`${messageId}-content`);
    const attemptsEl = document.getElementById(`${messageId}-attempts`);
    const messagesEl = document.getElementById('aiChatMessages');
    
    switch (eventType) {
        case 'start':
            statusEl.innerHTML = `<div class="ai-loading"><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div> ${escapeHtml(data.message)}</div>`;
            break;
            
        case 'thinking':
            statusEl.innerHTML = `<div class="ai-status-thinking">🤔 ${escapeHtml(data.message)}</div>`;
            break;
            
        case 'retry':
            const retryHtml = `<div class="ai-status-retry">🔄 ${escapeHtml(data.message)}<br><span style="font-size:11px;color:#856404;">错误: ${escapeHtml(data.error)}</span></div>`;
            attemptsEl.style.display = 'block';
            attemptsEl.insertAdjacentHTML('beforeend', retryHtml);
            statusEl.innerHTML = `<div class="ai-status-thinking">🔄 ${escapeHtml(data.message)}</div>`;
            break;
            
        case 'sql_generated':
            statusEl.innerHTML = `<div class="ai-status-success">✅ SQL生成完成</div>`;
            contentEl.innerHTML = `
                <div style="margin-bottom: 6px;">${formatAIText(data.response)}</div>
                <div style="margin-top: 6px;">
                    <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">📝 生成的SQL查询：</div>
                    <div class="ai-sql-block">${escapeHtml(data.sql)}</div>
                </div>
            `;
            break;
            
        case 'executing':
            statusEl.innerHTML = `<div class="ai-status-executing">⚡ ${escapeHtml(data.message)}</div>`;
            break;
            
        case 'attempt_failed':
            const failedHtml = `<div class="ai-attempt-failed">❌ 尝试 ${data.attempt} 失败: ${escapeHtml(data.error)}${data.sql ? '<br><div class="ai-sql-block" style="font-size:11px;padding:6px;margin-top:3px;">' + escapeHtml(data.sql) + '</div>' : ''}</div>`;
            attemptsEl.style.display = 'block';
            attemptsEl.insertAdjacentHTML('beforeend', failedHtml);
            break;
            
        case 'success':
            statusEl.innerHTML = '';
            
            let resultHtml = `<div style="margin-bottom: 6px;">${formatAIText(data.response)}</div>`;
            
            if (data.insight != null && String(data.insight).trim() !== '') {
                const conf = data.confidence;
                const confStr = typeof conf === 'number' && conf > 0
                    ? `<div style="font-size:11px;color:#718096;margin-top:6px;">置信度: ${conf <= 1 ? Math.round(conf * 100) + '%' : escapeHtml(String(conf))}</div>`
                    : '';
                resultHtml += `
                    <div class="ai-reflection-insight" style="margin-top:8px;padding:10px 12px;background:#ebf8ff;border-radius:6px;border-left:4px solid #3182ce;">
                        <div style="font-size:12px;font-weight:600;color:#2c5282;margin-bottom:4px;">💡 数据洞察</div>
                        <div style="font-size:13px;color:#2d3748;">${formatAIText(data.insight)}</div>
                        ${confStr}
                    </div>`;
            }
            
            // 显示重试信息（如果有）
            if (data.attempts && data.attempts.length > 0) {
                const retryId = 'retry-' + messageId;
                resultHtml += `
                    <div style="margin-top: 6px;">
                        <div class="ai-retry-header" onclick="toggleRetryDetails('${retryId}')" style="cursor: pointer; padding: 5px 10px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 5px; display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 12px; color: #856404;">🔄 经过 ${data.retries} 次重试后成功</span>
                            <span id="${retryId}-icon" style="font-size: 11px; color: #856404;">▼</span>
                        </div>
                        <div id="${retryId}" class="ai-retry-details" style="display: none; margin-top: 4px; padding: 8px; background: #f8f9fa; border-radius: 5px; border: 1px solid #e2e8f0;">
                            ${data.attempts.map((attempt, index) => `
                                <div style="margin-bottom: ${index < data.attempts.length - 1 ? '6px' : '0'}; padding-bottom: ${index < data.attempts.length - 1 ? '6px' : '0'}; border-bottom: ${index < data.attempts.length - 1 ? '1px solid #e2e8f0' : 'none'};">
                                    <div style="font-size: 11px; font-weight: 600; color: #e53e3e; margin-bottom: 2px;">❌ 尝试 ${attempt.attempt}：${escapeHtml(attempt.error)}</div>
                                    ${attempt.sql ? '<div class="ai-sql-block" style="font-size: 11px; padding: 6px 8px; margin-top: 3px;">' + escapeHtml(attempt.sql) + '</div>' : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
            
            resultHtml += `
                <div style="margin-top: 6px;">
                    <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">${data.attempts && data.attempts.length > 0 ? '✅ 最终成功的SQL查询：' : '📝 生成的SQL查询：'}</div>
                    <div class="ai-sql-block">${escapeHtml(data.sql)}</div>
                </div>
            `;
            
            if (data.results && data.results.length > 0) {
                resultHtml += `
                    <div style="margin-top: 6px;">
                        <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">📊 查询结果：</div>
                        <div class="ai-result-table">
                            <table>
                                <thead>
                                    <tr>${Object.keys(data.results[0]).map(col => `<th>${escapeHtml(col)}</th>`).join('')}</tr>
                                </thead>
                                <tbody>
                                    ${data.results.slice(0, 10).map(row => `
                                        <tr>${Object.keys(data.results[0]).map(col => `<td>${row[col] !== null ? escapeHtml(String(row[col])) : '<i style="color: #a0aec0;">NULL</i>'}</td>`).join('')}</tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        <div style="font-size: 11px; color: #718096; margin-top: 4px; padding-left: 4px;">
                            ✓ 共查询到 <strong>${data.results.length}</strong> 条记录${data.results.length > 10 ? '，显示前10条' : ''}
                        </div>
                    </div>
                `;
            } else if (data.results && data.results.length === 0) {
                resultHtml += `
                    <div style="margin-top: 6px;">
                        <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">📊 查询结果：</div>
                        <div style="padding: 10px; background: #f7fafc; border-radius: 6px; color: #718096; text-align: center; font-size: 12px;">暂无数据</div>
                    </div>
                `;
            }
            
            contentEl.innerHTML = resultHtml;
            attemptsEl.style.display = 'none';
            break;

        case 'confirm_write':
            statusEl.innerHTML = '';
            const confirmId = 'confirm-' + messageId;
            let confirmHtml = `<div style="margin-bottom: 6px;">${formatAIText(data.response)}</div>`;
            confirmHtml += `
                <div style="margin-top: 6px;">
                    <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">📝 待执行的SQL：</div>
                    <div class="ai-sql-block">${escapeHtml(data.sql)}</div>
                </div>
                <div class="ai-confirm-write" id="${confirmId}">
                    <div class="ai-confirm-warning">
                        <span class="ai-confirm-icon">⚠️</span>
                        <span>该操作将修改数据库数据，请确认是否执行？</span>
                    </div>
                    <div class="ai-confirm-actions">
                        <button class="btn ai-confirm-btn-yes" onclick="executeConfirmedSQL('${confirmId}', ${escapeHtml(JSON.stringify(data.sql))}, ${escapeHtml(JSON.stringify(data.dbId))}, '${messageId}')">✓ 确认执行</button>
                        <button class="btn ai-confirm-btn-no" onclick="cancelConfirmedSQL('${confirmId}', '${messageId}')">✕ 取消</button>
                    </div>
                </div>
            `;
            contentEl.innerHTML = confirmHtml;
            attemptsEl.style.display = 'none';
            break;
            
        case 'error':
            statusEl.innerHTML = '';
            let errorHtml = `<div class="ai-error"><div style="font-weight: 600; margin-bottom: 4px;">${escapeHtml(data.message)}</div>`;
            
            // 显示AI原始响应（用于调试）
            if (data.response) {
                const debugId = 'debug-' + messageId;
                errorHtml += `
                    <div style="margin-top: 6px;">
                        <div class="ai-retry-header" onclick="toggleRetryDetails('${debugId}')" style="cursor: pointer; padding: 4px 8px; background: rgba(255, 255, 255, 0.3); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 12px;">查看AI原始响应（调试）</span>
                            <span id="${debugId}-icon" style="font-size: 11px;">▼</span>
                        </div>
                        <div id="${debugId}" class="ai-retry-details" style="display: none; margin-top: 4px; padding: 8px; background: rgba(255, 255, 255, 0.2); border-radius: 4px;">
                            <pre style="white-space: pre-wrap; word-break: break-word; font-size: 11px; margin: 0;">${escapeHtml(data.response)}</pre>
                        </div>
                    </div>
                `;
            }
            
            if (data.attempts && data.attempts.length > 0) {
                const retryId = 'retry-' + messageId;
                errorHtml += `
                    <div style="font-size: 11px; margin-top: 6px; margin-bottom: 6px;">已尝试 ${data.attempts.length} 次，均未成功</div>
                    <div class="ai-retry-header" onclick="toggleRetryDetails('${retryId}')" style="cursor: pointer; padding: 4px 8px; background: rgba(255, 255, 255, 0.3); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 12px;">查看所有尝试</span>
                        <span id="${retryId}-icon" style="font-size: 11px;">▼</span>
                    </div>
                    <div id="${retryId}" class="ai-retry-details" style="display: none; margin-top: 4px; padding: 8px; background: rgba(255, 255, 255, 0.2); border-radius: 4px;">
                        ${data.attempts.map((attempt, index) => `
                            <div style="margin-bottom: ${index < data.attempts.length - 1 ? '6px' : '0'}; padding-bottom: ${index < data.attempts.length - 1 ? '6px' : '0'}; border-bottom: ${index < data.attempts.length - 1 ? '1px solid rgba(255, 255, 255, 0.3)' : 'none'};">
                                <div style="font-size: 11px; font-weight: 600; margin-bottom: 2px;">尝试 ${attempt.attempt}：${escapeHtml(attempt.error)}</div>
                                ${attempt.sql ? '<div class="ai-sql-block" style="font-size: 11px; padding: 6px 8px; margin-top: 3px;">' + escapeHtml(attempt.sql) + '</div>' : ''}
                            </div>
                        `).join('')}
                    </div>
                `;
            }
            
            errorHtml += '</div>';
            contentEl.innerHTML = errorHtml;
            attemptsEl.style.display = 'none';
            break;
            
        case 'api_config_generated':
            statusEl.innerHTML = '';
            
            // 显示接口配置预览
            const config = data.config;
            
            // 构建默认参数显示
            let defaultParamsHtml = '';
            if (config.default_params && Object.keys(config.default_params).length > 0) {
                const paramsEntries = Object.entries(config.default_params).map(([key, value]) => {
                    return `<div style="margin: 4px 0;"><span style="color: #805ad5; font-weight: 500;">${escapeHtml(key)}</span>: <span style="color: #48bb78;">${typeof value === 'string' ? '"' + escapeHtml(value) + '"' : escapeHtml(String(value))}</span></div>`;
                }).join('');
                defaultParamsHtml = `
                    <div class="config-item" style="grid-column: 1 / -1;">
                        <span class="config-label">默认参数:</span>
                        <div style="margin-top: 6px; padding: 8px; background: rgba(72, 187, 120, 0.05); border-left: 3px solid #48bb78; border-radius: 4px;">
                            ${paramsEntries}
                        </div>
                    </div>
                `;
            }
            
            const configHtml = `
                <div style="margin-bottom: 6px;">${formatAIText(data.message)}</div>
                <div class="ai-api-config-preview">
                    <div class="ai-api-config-header">
                        <span style="font-weight: 600;">接口配置预览</span>
                        <button class="btn btn-sm" onclick="editApiConfigFromAI('${messageId}', ${escapeHtml(JSON.stringify(config))})">✏️ 编辑</button>
                    </div>
                    <div class="ai-api-config-body">
                        <div class="config-item"><span class="config-label">接口名称:</span> <span class="config-value">${escapeHtml(config.name)}</span></div>
                        <div class="config-item"><span class="config-label">接口路径:</span> <span class="config-value">${escapeHtml(config.path)}</span></div>
                        <div class="config-item"><span class="config-label">请求方法:</span> <span class="config-value">${escapeHtml(config.method)}</span></div>
                        <div class="config-item"><span class="config-label">接口描述:</span> <span class="config-value">${escapeHtml(config.description || '')}</span></div>
                        <div class="config-item" style="grid-column: 1 / -1;">
                            <span class="config-label">SQL语句:</span>
                            <div class="ai-sql-block" style="margin-top: 6px;">${escapeHtml(config.sql)}</div>
                        </div>
                        ${defaultParamsHtml}
                    </div>
                    <div class="ai-api-config-actions">
                        <button class="btn btn-primary" onclick="confirmCreateApiFromAI(${escapeHtml(JSON.stringify(config))}, '${messageId}')">✓ 确认创建</button>
                        <button class="btn" onclick="cancelCreateApiFromAI('${messageId}')">✕ 取消</button>
                    </div>
                </div>
            `;
            
            contentEl.innerHTML = configHtml;
            attemptsEl.style.display = 'none';
            break;

        case 'governance_task_draft':
            statusEl.innerHTML = '';
            const govDraft = data.task || {};
            if (!window._aiGovDraftByMessageId) window._aiGovDraftByMessageId = {};
            window._aiGovDraftByMessageId[messageId] = govDraft;
            const govCronDisplay = govDraft.cron_expr ? escapeHtml(govDraft.cron_expr) : '—';
            const govInputTypeDisplay = { file: '文件', text: '文本', both: '文件+文本' }[govDraft.input_type] || '—';
            const govExtsDisplay = (govDraft.accept_exts && govDraft.accept_exts.length) ? escapeHtml(govDraft.accept_exts.join(', ')) : '—';
            const govTaskHtml = `
                <div style="margin-bottom: 6px;">${formatAIText(data.message)}</div>
                <div class="ai-api-config-preview ai-gov-draft-preview" id="gov-draft-${messageId}">
                    <div class="ai-api-config-header">
                        <span style="font-weight: 600;">数据治理任务草稿</span>
                        <button class="btn btn-sm" onclick="editGovTaskDraftFromAI('${messageId}')">✏️ 编辑</button>
                    </div>
                    <div class="ai-api-config-body">
                        <div class="config-item"><span class="config-label">任务名称:</span> <span class="config-value">${escapeHtml(govDraft.name || '')}</span></div>
                        <div class="config-item"><span class="config-label">类型:</span> <span class="config-value">${govDraft.type === 'scheduled' ? '⏰ 定时' : '📤 交互'}</span></div>
                        <div class="config-item"><span class="config-label">描述:</span> <span class="config-value">${escapeHtml(govDraft.description || '—')}</span></div>
                        ${govDraft.type === 'scheduled' ? `<div class="config-item"><span class="config-label">Cron:</span> <span class="config-value">${govCronDisplay}</span></div>` : ''}
                        ${govDraft.type === 'interactive' ? `<div class="config-item"><span class="config-label">输入方式:</span> <span class="config-value">${govInputTypeDisplay}</span></div>` : ''}
                        ${govDraft.type === 'interactive' ? `<div class="config-item"><span class="config-label">接受扩展名:</span> <span class="config-value">${govExtsDisplay}</span></div>` : ''}
                        <div class="config-item" style="grid-column: 1 / -1;">
                            <span class="config-label">脚本代码:</span>
                            <div class="ai-sql-block" style="margin-top: 6px; max-height: 120px; overflow: auto;">${escapeHtml((govDraft.js_code || '').slice(0, 500))}${(govDraft.js_code || '').length > 500 ? '...' : ''}</div>
                        </div>
                    </div>
                    <div class="ai-api-config-actions">
                        <button class="btn btn-primary" onclick="confirmCreateGovTaskFromAI('${messageId}')">✓ 确认创建任务</button>
                        <button class="btn" onclick="cancelGovTaskDraft('${messageId}')">✕ 取消</button>
                    </div>
                </div>
            `;
            contentEl.innerHTML = govTaskHtml;
            attemptsEl.style.display = 'none';
            break;
            
        case 'done':
            // 完成，不需要特别处理
            break;
    }
    
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// 添加加载消息
function addAiLoadingMessage() {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-loading-' + Date.now();
    
    const messageHtml = `
        <div class="ai-message assistant" id="${messageId}">
            <div class="ai-message-avatar">🤖</div>
            <div class="ai-message-content">
                <div class="ai-message-bubble">
                    <div class="ai-loading">
                        <div class="ai-loading-dot"></div>
                        <div class="ai-loading-dot"></div>
                        <div class="ai-loading-dot"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    messagesEl.insertAdjacentHTML('beforeend', messageHtml);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    
    return messageId;
}

// 移除AI消息
function removeAiMessage(messageId) {
    const messageEl = document.getElementById(messageId);
    if (messageEl) {
        messageEl.remove();
    }
}

// 显示AI错误
function showAiError(message) {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-error-' + Date.now();
    
    const messageHtml = `
        <div class="ai-message assistant" id="${messageId}">
            <div class="ai-message-avatar">⚠️</div>
            <div class="ai-message-content">
                <div class="ai-error">${escapeHtml(message)}</div>
            </div>
        </div>
    `;
    
    messagesEl.insertAdjacentHTML('beforeend', messageHtml);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// HTML转义
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function formatAIText(text) {
    let escaped = escapeHtml(text).trim();
    escaped = escaped.replace(/\n{2,}/g, '\n');
    escaped = escaped.replace(/\n/g, '<br>');
    return escaped;
}

// 更新AI上下文显示
function updateAiContextDisplay() {
    const header = document.querySelector('#aiTab .ai-chat-header');
    if (!header) return;

    let contextEl = document.getElementById('aiContextDisplay');
    const input = document.getElementById('aiInput');
    const hasDbs = aiSessionContext.databases.length > 0;
    const hasMods = aiSessionContext.modules.length > 0;

    if (hasDbs || hasMods) {
        if (!contextEl) {
            contextEl = document.createElement('div');
            contextEl.id = 'aiContextDisplay';
            contextEl.className = 'ai-context-display';
            const h3 = header.querySelector('h3');
            h3.parentNode.insertBefore(contextEl, h3.nextSibling);
        }

        let tagsHtml = '';
        if (hasMods) {
            tagsHtml += aiSessionContext.modules.map(m =>
                `<span class="ai-context-tag ai-context-tag-module">${m.icon} ${escapeHtml(m.name)}</span>`
            ).join('');
        }
        if (hasDbs) {
            tagsHtml += aiSessionContext.databases.map(db => {
                const icon = dbTypeIcons[db.type] || '🗄️';
                return `<span class="ai-context-tag ai-context-tag-db">${icon} ${escapeHtml(db.name)}</span>`;
            }).join('');
        }

        contextEl.innerHTML = `
            <div class="ai-context-info">
                <span class="ai-context-label">上下文:</span>
                <span class="ai-context-value">${tagsHtml}</span>
                <button class="ai-context-clear" onclick="clearAiContext()" title="清除上下文，开始新对话">✕</button>
            </div>
        `;

        if (input) {
            input.placeholder = '继续提问... (无需再次 @)';
        }
    } else {
        if (contextEl) {
            contextEl.remove();
        }
        if (input) {
            input.placeholder = '输入问题... (使用 @ 引用数据库或模块)';
        }
    }
}

// 清除AI上下文
function clearAiContext() {
    if (confirm('确定要清除当前对话上下文吗？这将开始新的对话。')) {
        aiSessionContext.databases = [];
        aiSessionContext.modules = [];
        aiSessionContext.history = [];
        updateAiContextDisplay();

        const messagesEl = document.getElementById('aiChatMessages');
        const messageId = 'msg-clear-' + Date.now();
        const messageHtml = `
            <div class="ai-message assistant" id="${messageId}" style="opacity: 0.8;">
                <div class="ai-message-avatar">ℹ️</div>
                <div class="ai-message-content">
                    <div style="padding: 12px; background: #e6f7ff; border-left: 3px solid #1890ff; border-radius: 6px; color: #0050b3; font-size: 13px;">
                        已清除对话上下文，请重新使用 @ 引用数据库或模块开始新的对话
                    </div>
                </div>
            </div>
        `;
        messagesEl.insertAdjacentHTML('beforeend', messageHtml);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }
}

// ==================== AI创建接口功能 ====================

// 编辑AI生成的接口配置
function editApiConfigFromAI(messageId, config) {
    // 显示编辑表单
    isEditApiMode = false;
    editingApiId = null;
    document.getElementById('apiModalTitle').textContent = '编辑接口配置';
    document.getElementById('addApiModal').classList.add('show');
    
    // 预填充配置（AI生成的接口固定为 query 类型）
    document.getElementById('apiTypeQuery').checked = true;
    switchApiTypeFields('query');
    document.getElementById('apiNameInput').value = config.name || '';
    document.getElementById('apiPathInput').value = config.path || '';
    document.getElementById('apiMethodInput').value = config.method || 'GET';
    document.getElementById('apiSqlInput').value = config.sql || '';
    document.getElementById('apiDescInput').value = config.description || '';
    
    // 预填充默认参数
    if (config.default_params && Object.keys(config.default_params).length > 0) {
        document.getElementById('apiDefaultParamsInput').value = JSON.stringify(config.default_params, null, 2);
    } else {
        document.getElementById('apiDefaultParamsInput').value = '';
    }
    
    // 加载数据库列表并选择
    loadDatabasesForSelect().then(() => {
        if (config.database_id) {
            document.getElementById('apiDbSelect').value = config.database_id;
        }
    });
    
    // 标记这是从AI生成的，保存时直接创建
    document.getElementById('addApiForm').dataset.fromAi = 'true';
    document.getElementById('addApiForm').dataset.aiMessageId = messageId;
    
    document.getElementById('apiFormError').classList.remove('show');
    document.getElementById('apiFormSuccess').classList.remove('show');
}

// 确认创建AI生成的接口
async function confirmCreateApiFromAI(config, messageId) {
    // 先隐藏配置预览
    const contentEl = document.getElementById(`${messageId}-content`);
    if (contentEl) {
        contentEl.innerHTML = '<div class="ai-loading"><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div> 正在创建接口...</div>';
    }
    
    // 添加数据库列表
    await loadDatabasesForSelect();
    
    const apiData = {
        name: config.name,
        path: config.path,
        method: config.method,
        type: 'query',
        database_id: config.database_id || aiSessionContext.databases[0]?.id,
        sql: config.sql,
        description: config.description || ''
    };
    
    // 包含默认参数
    if (config.default_params) {
        apiData.default_params = config.default_params;
    }
    
    if (!apiData.database_id) {
        if (contentEl) {
            contentEl.innerHTML = '<div class="ai-error">无法确定数据库，请重新操作</div>';
        }
        return;
    }
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/apis`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(apiData)
        });

        const data = await response.json();

        if (data.success) {
            // 更新为成功消息
            if (contentEl) {
                contentEl.innerHTML = `
                    <div style="padding: 12px; background: #d4edda; border-left: 3px solid #28a745; border-radius: 6px; color: #155724; font-size: 14px;">
                        <strong>✅ 接口创建成功！</strong><br>
                        <span style="font-size: 13px; margin-top: 4px; display: block;">
                            接口名称: ${escapeHtml(apiData.name)}<br>
                            接口路径: ${escapeHtml(apiData.path)}<br>
                            请前往"接口分发"标签页查看和测试
                        </span>
                    </div>
                `;
            }
            
            // 刷新接口列表（如果在接口标签页）
            if (document.querySelector('[data-tab="api"]').classList.contains('active')) {
                loadApis();
            }
        } else {
            if (contentEl) {
                contentEl.innerHTML = `<div class="ai-error">接口创建失败: ${escapeHtml(data.message || '未知错误')}</div>`;
            }
        }
    } catch (error) {
        if (contentEl) {
            contentEl.innerHTML = `<div class="ai-error">接口创建失败: ${escapeHtml(error.message)}</div>`;
        }
    }
}

// 取消创建接口
function cancelCreateApiFromAI(messageId) {
    const contentEl = document.getElementById(`${messageId}-content`);
    if (contentEl) {
        contentEl.innerHTML = `
            <div style="padding: 12px; background: #f8f9fa; border-left: 3px solid #6c757d; border-radius: 6px; color: #495057; font-size: 13px;">
                ℹ️ 已取消创建接口
            </div>
        `;
    }
}

// 确认创建 AI 生成的数据治理任务（用户同意后才创建）
async function confirmCreateGovTaskFromAI(messageId) {
    const draft = window._aiGovDraftByMessageId && window._aiGovDraftByMessageId[messageId];
    if (!draft) return;
    const contentEl = document.getElementById(`${messageId}-content`);
    if (contentEl) {
        contentEl.innerHTML = '<div class="ai-loading"><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div> 正在创建任务...</div>';
    }
    const taskData = {
        name: draft.name,
        type: draft.type,
        description: draft.description || '',
        js_code: draft.js_code,
        database_id: draft.database_id || '',
        cron_expr: draft.type === 'scheduled' ? (draft.cron_expr || '0 0 * * *') : '',
        enabled: draft.type === 'scheduled',
        input_type: draft.type === 'interactive' ? (draft.input_type || 'file') : '',
        accept_exts: draft.type === 'interactive' && draft.accept_exts && draft.accept_exts.length ? draft.accept_exts : []
    };
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(taskData)
        });
        const data = await response.json();
        if (data.success && contentEl) {
            contentEl.innerHTML = `
                <div style="padding: 12px; background: #e6ffed; border-left: 3px solid #52c41a; border-radius: 6px; color: #389e0d; font-size: 13px;">
                    ✓ 任务已创建。可到「数据治理」页查看。
                </div>
            `;
            loadGovernanceTasks();
        } else if (contentEl) {
            contentEl.innerHTML = `
                <div style="padding: 12px; background: #fff2f0; border-left: 3px solid #ff4d4f; border-radius: 6px; color: #cf1322; font-size: 13px;">
                    ${escapeHtml(data.message || '创建失败')}
                </div>
            `;
        }
    } catch (err) {
        if (contentEl) {
            contentEl.innerHTML = `
                <div style="padding: 12px; background: #fff2f0; border-left: 3px solid #ff4d4f; border-radius: 6px; color: #cf1322; font-size: 13px;">
                    ${escapeHtml('请求失败: ' + err.message)}
                </div>
            `;
        }
    }
    if (window._aiGovDraftByMessageId) delete window._aiGovDraftByMessageId[messageId];
}

function cancelGovTaskDraft(messageId) {
    const contentEl = document.getElementById(`${messageId}-content`);
    if (contentEl) {
        contentEl.innerHTML = `
            <div style="padding: 12px; background: #f8f9fa; border-left: 3px solid #6c757d; border-radius: 6px; color: #495057; font-size: 13px;">
                ℹ️ 已取消创建任务
            </div>
        `;
    }
    if (window._aiGovDraftByMessageId) delete window._aiGovDraftByMessageId[messageId];
}

// 编辑草稿：用草稿预填治理任务弹窗，用户修改后点保存即创建
function editGovTaskDraftFromAI(messageId) {
    const draft = window._aiGovDraftByMessageId && window._aiGovDraftByMessageId[messageId];
    if (!draft) return;
    isEditGovMode = false;
    editingGovTaskId = null;
    document.getElementById('govModalTitle').textContent = '编辑任务草稿并创建';
    document.getElementById('govTaskNameInput').value = draft.name || '';
    document.getElementById('govTaskTypeInput').value = draft.type || 'interactive';
    document.getElementById('govTaskDescInput').value = draft.description || '';
    document.getElementById('govCodeInput').value = draft.js_code || '';
    document.getElementById('govCronInput').value = draft.cron_expr || '';
    document.getElementById('govEnabledInput').checked = true;
    document.getElementById('govEnabledLabel').textContent = '已启用';
    document.getElementById('govInputTypeSelect').value = draft.input_type || 'file';
    document.getElementById('govAcceptExtsInput').value = (draft.accept_exts || []).join(', ');
    populateGovDbSelect();
    document.getElementById('govTaskDbSelect').value = draft.database_id || '';
    onGovTaskTypeChange();
    document.getElementById('govFormError').textContent = '';
    document.getElementById('govFormError').classList.remove('show');
    document.getElementById('govFormSuccess').textContent = '';
    document.getElementById('govFormSuccess').classList.remove('show');
    document.getElementById('govTaskModal').classList.add('show');
}

// ==================== 表格管理功能 ====================

// 显示创建表弹窗
function showCreateTableModal() {
    if (!currentDb) {
        showToast('请先选择数据库', 'warning');
        return;
    }
    
    document.getElementById('createTableModal').classList.add('show');
    document.getElementById('createTableForm').reset();
    document.getElementById('createTableError').classList.remove('show');
    document.getElementById('createTableSuccess').classList.remove('show');
    
    // 初始化默认列
    const columnsContainer = document.getElementById('tableColumnsContainer');
    columnsContainer.innerHTML = `
        <div class="table-column-item">
            <input type="text" class="column-name-input" placeholder="列名" value="id" required>
            <select class="column-type-select" required>
                <option value="INT">INT</option>
                <option value="VARCHAR">VARCHAR</option>
                <option value="TEXT">TEXT</option>
                <option value="DATETIME">DATETIME</option>
                <option value="DECIMAL">DECIMAL</option>
                <option value="BOOLEAN">BOOLEAN</option>
            </select>
            <input type="text" class="column-size-input" placeholder="长度" value="">
            <label><input type="checkbox" class="column-notnull" checked> NOT NULL</label>
            <label><input type="checkbox" class="column-primary" checked> 主键</label>
            <label><input type="checkbox" class="column-autoincrement" checked> 自增</label>
            <button type="button" class="btn-icon" onclick="removeTableColumn(this)" title="删除列">🗑️</button>
        </div>
    `;
}

// 隐藏创建表弹窗
function hideCreateTableModal() {
    document.getElementById('createTableModal').classList.remove('show');
}

// 添加表列
function addTableColumn() {
    const columnsContainer = document.getElementById('tableColumnsContainer');
    const newColumn = document.createElement('div');
    newColumn.className = 'table-column-item';
    newColumn.innerHTML = `
        <input type="text" class="column-name-input" placeholder="列名" required>
        <select class="column-type-select" required>
            <option value="INT">INT</option>
            <option value="VARCHAR" selected>VARCHAR</option>
            <option value="TEXT">TEXT</option>
            <option value="DATETIME">DATETIME</option>
            <option value="DECIMAL">DECIMAL</option>
            <option value="BOOLEAN">BOOLEAN</option>
        </select>
        <input type="text" class="column-size-input" placeholder="长度" value="255">
        <label><input type="checkbox" class="column-notnull"> NOT NULL</label>
        <label><input type="checkbox" class="column-primary"> 主键</label>
        <label><input type="checkbox" class="column-autoincrement"> 自增</label>
        <button type="button" class="btn-icon" onclick="removeTableColumn(this)" title="删除列">🗑️</button>
    `;
    columnsContainer.appendChild(newColumn);
}

// 删除表列
function removeTableColumn(btn) {
    const columnsContainer = document.getElementById('tableColumnsContainer');
    if (columnsContainer.children.length <= 1) {
        showToast('至少需要保留一列', 'warning');
        return;
    }
    btn.parentElement.remove();
}

// 创建表
async function handleCreateTable(e) {
    e.preventDefault();
    
    if (!currentDb) return;
    
    const tableName = document.getElementById('tableNameInput').value.trim();
    const columnItems = document.querySelectorAll('.table-column-item');
    
    // 表名验证
    if (!tableName) {
        showCreateTableError('请输入表名');
        return;
    }
    
    // 表名格式验证：只允许字母、数字、下划线，且以字母开头
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        showCreateTableError('表名只能包含字母、数字、下划线，且必须以字母或下划线开头');
        return;
    }
    
    // 列数量验证
    if (columnItems.length === 0) {
        showCreateTableError('请至少添加一个列');
        return;
    }
    
    const columns = [];
    for (const item of columnItems) {
        const name = item.querySelector('.column-name-input').value.trim();
        const type = item.querySelector('.column-type-select').value;
        const size = item.querySelector('.column-size-input').value.trim();
        const notNull = item.querySelector('.column-notnull').checked;
        const primary = item.querySelector('.column-primary').checked;
        const autoIncrement = item.querySelector('.column-autoincrement').checked;
        
        if (!name) {
            showCreateTableError('请填写所有列名');
            return;
        }
        
        columns.push({
            name,
            type,
            size: size || null,
            not_null: notNull,
            primary_key: primary,
            auto_increment: autoIncrement
        });
    }
    
    const errorEl = document.getElementById('createTableError');
    const successEl = document.getElementById('createTableSuccess');
    errorEl.classList.remove('show');
    successEl.classList.remove('show');
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: tableName,
                columns
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            successEl.textContent = '表创建成功！';
            successEl.classList.add('show');
            setTimeout(() => {
                hideCreateTableModal();
                loadDatabaseDetail(currentDb.id);
            }, 1000);
        } else {
            showCreateTableError(data.message || '创建失败');
        }
    } catch (error) {
        showCreateTableError('创建失败：' + error.message);
    }
}

// 显示创建表错误
function showCreateTableError(message) {
    const errorEl = document.getElementById('createTableError');
    errorEl.textContent = message;
    errorEl.classList.add('show');
}

// ==================== 数据治理模块 ====================

let govTasks = [];
let currentGovTask = null;
let isEditGovMode = false;
let editingGovTaskId = null;
let govCurrentFilter = 'all';
/** @type {File[]} */
let govSelectedFiles = [];

// 初始化治理模块事件
(function initGovernanceEvents() {
    document.addEventListener('DOMContentLoaded', function() {
        const addBtn = document.getElementById('addGovernanceTaskBtn');
        if (addBtn) addBtn.addEventListener('click', showAddGovTaskModal);

        const closeBtn = document.getElementById('closeGovTaskModal');
        if (closeBtn) closeBtn.addEventListener('click', hideGovTaskModal);

        const form = document.getElementById('govTaskForm');
        if (form) form.addEventListener('submit', handleGovTaskSubmit);

        const enabledInput = document.getElementById('govEnabledInput');
        if (enabledInput) enabledInput.addEventListener('change', function() {
            document.getElementById('govEnabledLabel').textContent = this.checked ? '已启用' : '已禁用';
        });

        const modal = document.getElementById('govTaskModal');
        if (modal) modal.addEventListener('click', function(e) {
            if (e.target === this) hideGovTaskModal();
        });

        const dbSelect = document.getElementById('govTaskDbSelect');
        if (dbSelect) dbSelect.addEventListener('change', function() {
            if (document.getElementById('govCodeGenPanel').style.display !== 'none') refreshCodegenTables();
        });

        // 拖拽上传
        const dropZone = document.getElementById('govDropZone');
        if (dropZone) {
            dropZone.addEventListener('dragover', function(e) {
                e.preventDefault();
                this.classList.add('drag-over');
            });
            dropZone.addEventListener('dragleave', function() {
                this.classList.remove('drag-over');
            });
            dropZone.addEventListener('drop', function(e) {
                e.preventDefault();
                this.classList.remove('drag-over');
                if (e.dataTransfer.files.length > 0) {
                    setGovFiles(e.dataTransfer.files);
                }
            });
        }
    });
})();

/**
 * 加载治理任务列表并恢复上次选中的任务状态
 * @returns {Promise<void>}
 */
async function loadGovernanceTasks() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/tasks`);
        const data = await response.json();
        if (data.success) {
            govTasks = data.tasks || [];
            if (currentGovTask) {
                const fresh = govTasks.find(t => t.id === currentGovTask.id);
                if (fresh) {
                    currentGovTask = fresh;
                    showGovTaskDetail(currentGovTask);
                    loadGovTaskLogs();
                    if (currentGovTask.status === 'running') {
                        setTimeout(refreshGovTaskStatus, 3000);
                    }
                } else {
                    currentGovTask = null;
                    try { sessionStorage.removeItem('govLastSelectedTaskId'); } catch (e) {}
                    document.getElementById('govTaskDetailView').style.display = 'none';
                    document.getElementById('govWelcomeView').style.display = '';
                }
            } else {
                const savedId = sessionStorage.getItem('govLastSelectedTaskId');
                if (savedId) {
                    const t = govTasks.find(x => x.id === savedId);
                    if (t) {
                        currentGovTask = t;
                        showGovTaskDetail(currentGovTask);
                        loadGovTaskLogs();
                        if (currentGovTask.status === 'running') {
                            setTimeout(refreshGovTaskStatus, 3000);
                        }
                    }
                }
            }
            renderGovTaskList();
        }
    } catch (error) {
        console.error('加载治理任务失败:', error);
        showToast('加载治理任务失败', 'error');
    }
}

function renderGovTaskList() {
    const container = document.getElementById('govTaskList');
    if (!container) return;

    const search = (document.getElementById('govTaskSearchInput')?.value || '').toLowerCase();
    let filtered = govTasks.filter(t => {
        if (govCurrentFilter !== 'all' && t.type !== govCurrentFilter) return false;
        if (search && !t.name.toLowerCase().includes(search)) return false;
        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = '<div class="gov-output-placeholder" style="padding:30px;color:#a0aec0;">暂无任务</div>';
        return;
    }

    container.innerHTML = filtered.map(t => {
        const safeTId = escapeHtml(t.id);
        return `
        <div class="gov-task-item ${currentGovTask && currentGovTask.id === t.id ? 'active' : ''}"
             onclick="selectGovTask('${safeTId}')">
            <div class="gov-task-item-icon">${t.type === 'scheduled' ? '⏰' : '📤'}</div>
            <div class="gov-task-item-info">
                <div class="gov-task-item-name">
                    ${escapeHtml(t.name)}
                    ${t.register_as_api ? '<span class="gov-api-badge" title="已注册为 API">🔗</span>' : ''}
                </div>
                <div class="gov-task-item-meta">
                    <span class="gov-task-badge ${t.type}">${t.type === 'scheduled' ? '定时' : '交互'}</span>
                    <span class="gov-status-dot ${t.status}"></span>
                    <span>${t.status === 'idle' ? '空闲' : t.status === 'running' ? '运行中' : t.status === 'success' ? '成功' : '错误'}</span>
                </div>
            </div>
            ${t.example_files && t.example_files.length ? `<button type="button" class="gov-example-btn" onclick="event.stopPropagation(); govDownloadExamplesForTask('${safeTId}')">下载示例</button>` : ''}
        </div>
    `;}).join('');
}

function filterGovTaskList() {
    renderGovTaskList();
}

function filterGovByType(type) {
    govCurrentFilter = type;
    document.querySelectorAll('.gov-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === type);
    });
    renderGovTaskList();
}

async function selectGovTask(taskId) {
    const task = govTasks.find(t => t.id === taskId);
    if (!task) return;
    try { sessionStorage.setItem('govLastSelectedTaskId', taskId); } catch (e) {}
    currentGovTask = task;
    renderGovTaskList();
    showGovTaskDetail(task);
    loadGovTaskLogs();
}

function showGovTaskDetail(task) {
    document.getElementById('govWelcomeView').style.display = 'none';
    document.getElementById('govTaskDetailView').style.display = 'block';

    document.getElementById('govTaskName').textContent = task.name;
    document.getElementById('govTaskType').textContent = task.type === 'scheduled' ? '⏰ 定时任务' : '📤 交互任务';

    const statusMap = { idle: '空闲', running: '运行中', success: '成功', error: '错误' };
    const statusEl = document.getElementById('govTaskStatus');
    statusEl.textContent = statusMap[task.status] || task.status;
    statusEl.className = 'info-value status ' + task.status;

    const cronItem = document.getElementById('govCronItem');
    const enabledItem = document.getElementById('govEnabledItem');
    if (task.type === 'scheduled') {
        cronItem.style.display = '';
        enabledItem.style.display = '';
        document.getElementById('govTaskCron').textContent = task.cron_expr || '未设置';
        document.getElementById('govTaskEnabled').textContent = task.enabled ? '已启用' : '已禁用';
        document.getElementById('govToggleBtn').textContent = task.enabled ? '禁用' : '启用';
    } else {
        cronItem.style.display = 'none';
        enabledItem.style.display = 'none';
    }

    // 数据库
    const dbName = databases.find(d => d.id === task.database_id);
    document.getElementById('govTaskDb').textContent = dbName ? dbName.name : '未关联';

    document.getElementById('govTaskLastRun').textContent = task.last_run_at ? new Date(task.last_run_at).toLocaleString() : '从未运行';

    document.getElementById('govTaskCode').textContent = task.js_code;

    // 交互区域
    const interactiveSection = document.getElementById('govInteractiveSection');
    if (task.type === 'interactive') {
        interactiveSection.style.display = '';
        const inputType = task.input_type || 'file';
        document.getElementById('govFileUploadArea').style.display = (inputType === 'file' || inputType === 'both') ? '' : 'none';
        document.getElementById('govTextInputArea').style.display = (inputType === 'text' || inputType === 'both') ? '' : 'none';
        const exts = task.accept_exts && task.accept_exts.length > 0 ? task.accept_exts.join(', ') : '所有类型';
        document.getElementById('govAcceptExts').textContent = '支持: ' + exts;
        if (task.accept_exts && task.accept_exts.length > 0) {
            document.getElementById('govFileInput').accept = task.accept_exts.join(',');
        } else {
            document.getElementById('govFileInput').accept = '';
        }
        const hintEl = document.getElementById('govSingleBatchHint');
        if (hintEl) {
            hintEl.style.display = (task.file_batch_mode === 'single') ? '' : 'none';
        }
    } else {
        interactiveSection.style.display = 'none';
    }
    clearGovFile();
}

async function loadGovTaskLogs() {
    if (!currentGovTask) return;
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/tasks/${currentGovTask.id}/logs`);
        const data = await response.json();
        if (data.success) {
            renderGovLogs(data.logs || []);
        }
    } catch (error) {
        console.error('加载任务日志失败:', error);
        showToast('加载任务日志失败', 'error');
    }
}

function renderGovLogs(logs) {
    const container = document.getElementById('govTaskOutput');
    if (logs.length === 0) {
        container.innerHTML = '<div class="gov-output-placeholder">暂无执行记录</div>';
        return;
    }
    const sorted = [...logs].sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
    container.innerHTML = sorted.map(log => `
        <div class="gov-log-entry">
            <div class="gov-log-header">
                <span>${new Date(log.start_time).toLocaleString()}${log.end_time ? ' → ' + new Date(log.end_time).toLocaleString() : ''}</span>
                <span class="gov-log-status ${log.status}">${log.status === 'success' ? '成功' : log.status === 'error' ? '错误' : '运行中'}</span>
            </div>
            ${log.input ? `<div class="gov-log-input">输入: ${escapeHtml(log.input)}</div>` : ''}
            ${log.output ? `<div class="gov-log-output">${escapeHtml(log.output)}</div>` : ''}
            ${log.error ? `<div class="gov-log-error">${escapeHtml(log.error)}</div>` : ''}
        </div>
    `).join('');
}

// 新建/编辑任务
function showAddGovTaskModal() {
    isEditGovMode = false;
    editingGovTaskId = null;
    document.getElementById('govModalTitle').textContent = '新建任务';
    document.getElementById('govTaskForm').reset();
    document.getElementById('govEnabledInput').checked = true;
    document.getElementById('govEnabledLabel').textContent = '已启用';
    // 重置 API 字段
    document.getElementById('govRegisterAPIInput').checked = false;
    document.getElementById('govRegisterAPILabel').textContent = '未注册';
    document.getElementById('govAPIPathInput').value = '';
    document.getElementById('govAPIMethodInput').value = 'POST';
    document.getElementById('govAPIFields').style.display = 'none';
    const fbNew = document.getElementById('govFileBatchModeSelect');
    if (fbNew) fbNew.value = 'per_file';
    onGovTaskTypeChange();
    populateGovDbSelect();
    document.getElementById('govFormError').textContent = '';
    document.getElementById('govFormError').classList.remove('show');
    document.getElementById('govFormSuccess').textContent = '';
    document.getElementById('govFormSuccess').classList.remove('show');
    document.getElementById('govTaskModal').classList.add('show');
}

function editGovTask() {
    if (!currentGovTask) return;
    isEditGovMode = true;
    editingGovTaskId = currentGovTask.id;
    document.getElementById('govModalTitle').textContent = '编辑任务';
    document.getElementById('govTaskNameInput').value = currentGovTask.name;
    document.getElementById('govTaskTypeInput').value = currentGovTask.type;
    document.getElementById('govTaskDescInput').value = currentGovTask.description || '';
    document.getElementById('govCodeInput').value = currentGovTask.js_code;
    document.getElementById('govCronInput').value = currentGovTask.cron_expr || '';
    document.getElementById('govEnabledInput').checked = currentGovTask.enabled;
    document.getElementById('govEnabledLabel').textContent = currentGovTask.enabled ? '已启用' : '已禁用';
    document.getElementById('govInputTypeSelect').value = currentGovTask.input_type || 'file';
    document.getElementById('govAcceptExtsInput').value = (currentGovTask.accept_exts || []).join(',');
    const fb = document.getElementById('govFileBatchModeSelect');
    if (fb) fb.value = currentGovTask.file_batch_mode || 'per_file';
    // API 字段
    document.getElementById('govRegisterAPIInput').checked = currentGovTask.register_as_api || false;
    document.getElementById('govRegisterAPILabel').textContent = currentGovTask.register_as_api ? '已注册' : '未注册';
    document.getElementById('govAPIPathInput').value = currentGovTask.api_path || '';
    document.getElementById('govAPIMethodInput').value = currentGovTask.api_method || 'POST';
    document.getElementById('govAPIFields').style.display = currentGovTask.register_as_api ? '' : 'none';
    populateGovDbSelect();
    document.getElementById('govTaskDbSelect').value = currentGovTask.database_id || '';
    onGovTaskTypeChange();
    document.getElementById('govFormError').textContent = '';
    document.getElementById('govFormError').classList.remove('show');
    document.getElementById('govFormSuccess').textContent = '';
    document.getElementById('govFormSuccess').classList.remove('show');
    document.getElementById('govTaskModal').classList.add('show');
}

function hideGovTaskModal() {
    document.getElementById('govTaskModal').classList.remove('show');
}

function onGovTaskTypeChange() {
    const type = document.getElementById('govTaskTypeInput').value;
    document.getElementById('govScheduledFields').style.display = type === 'scheduled' ? '' : 'none';
    document.getElementById('govInteractiveFields').style.display = type === 'interactive' ? '' : 'none';
}

// 中文转拼音首字母
function chineseToPinyinInitials(str) {
    const pinyinMap = {
        '阿': 'a', '啊': 'a', '安': 'a', '爱': 'a', '艾': 'a',
        '巴': 'b', '白': 'b', '北': 'b', '本': 'b', '表': 'b', '别': 'b', '不': 'b',
        '才': 'c', '成': 'c', '城': 'c', '出': 'c', '处': 'c', '从': 'c', '存': 'c',
        '大': 'd', '但': 'd', '当': 'd', '到': 'd', '得': 'd', '的': 'd', '地': 'd', '点': 'd', '定': 'd', '东': 'd', '动': 'd', '对': 'd', '多': 'd',
        '而': 'e', '二': 'e',
        '发': 'f', '法': 'f', '方': 'f', '分': 'f', '服': 'f', '府': 'f',
        '改': 'g', '高': 'g', '个': 'g', '给': 'g', '更': 'g', '工': 'g', '公': 'g', '共': 'g', '关': 'g', '管': 'g', '国': 'g', '过': 'g',
        '还': 'h', '海': 'h', '好': 'h', '和': 'h', '合': 'h', '很': 'h', '后': 'h', '会': 'h', '活': 'h',
        '机': 'j', '基': 'j', '级': 'j', '即': 'j', '几': 'j', '技': 'j', '计': 'j', '记': 'j', '加': 'j', '家': 'j', '间': 'j', '建': 'j', '将': 'j', '交': 'j', '教': 'j', '解': 'j', '进': 'j', '经': 'j', '就': 'j', '局': 'j', '据': 'j', '决': 'j',
        '开': 'k', '看': 'k', '可': 'k', '客': 'k', '空': 'k', '口': 'k',
        '来': 'l', '老': 'l', '了': 'l', '理': 'l', '力': 'l', '立': 'l', '利': 'l', '连': 'l', '两': 'l', '林': 'l', '路': 'l',
        '妈': 'm', '马': 'm', '么': 'm', '没': 'm', '每': 'm', '美': 'm', '门': 'm', '们': 'm', '面': 'm', '名': 'm', '明': 'm', '目': 'm',
        '那': 'n', '南': 'n', '能': 'n', '你': 'n', '年': 'n', '您': 'n',
        '欧': 'o',
        '排': 'p', '配': 'p', '朋': 'p', '平': 'p', '品': 'p',
        '期': 'q', '其': 'q', '起': 'q', '气': 'q', '前': 'q', '情': 'q', '请': 'q', '区': 'q', '去': 'q', '全': 'q', '确': 'q',
        '然': 'r', '人': 'r', '日': 'r', '容': 'r', '入': 'r',
        '三': 's', '色': 's', '上': 's', '少': 's', '社': 's', '设': 's', '生': 's', '时': 's', '实': 's', '使': 's', '事': 's', '是': 's', '书': 's', '水': 's', '说': 's', '思': 's', '四': 's', '送': 's', '算': 's', '所': 's',
        '他': 't', '她': 't', '台': 't', '天': 't', '条': 't', '通': 't', '同': 't', '头': 't', '图': 't', '团': 't',
        '外': 'w', '完': 'w', '万': 'w', '网': 'w', '为': 'w', '文': 'w', '问': 'w', '我': 'w', '无': 'w', '五': 'w', '物': 'w',
        '西': 'x', '系': 'x', '下': 'x', '先': 'x', '显': 'x', '现': 'x', '相': 'x', '想': 'x', '向': 'x', '小': 'x', '效': 'x', '新': 'x', '心': 'x', '信': 'x', '行': 'x', '学': 'x',
        '研': 'y', '样': 'y', '要': 'y', '也': 'y', '业': 'y', '一': 'y', '已': 'y', '以': 'y', '意': 'y', '因': 'y', '应': 'y', '用': 'y', '有': 'y', '又': 'y', '于': 'y', '元': 'y', '月': 'y', '员': 'y', '原': 'y', '源': 'y', '约': 'y', '越': 'y',
        '再': 'z', '在': 'z', '则': 'z', '怎': 'z', '展': 'z', '张': 'z', '找': 'z', '这': 'z', '真': 'z', '正': 'z', '证': 'z', '知': 'z', '只': 'z', '至': 'z', '制': 'z', '中': 'z', '种': 'z', '重': 'z', '主': 'z', '注': 'z', '专': 'z', '资': 'z', '子': 'z', '自': 'z', '总': 'z', '组': 'z', '最': 'z', '作': 'z',
        '数': 's', '据': 'j', '治': 'z', '理': 'l', '任': 'r', '务': 'w', '导': 'd', '入': 'r', '出': 'c', '报': 'b', '告': 'g', '处': 'c', '析': 'x', '测': 'c', '试': 's', '运': 'y', '行': 'x', '配': 'p', '置': 'z', '查': 'c', '询': 'x', '更': 'g', '新': 'x', '删': 's', '除': 'c', '添': 't', '加': 'j', '编': 'b', '辑': 'j', '创': 'c', '建': 'j'
    };
    
    let result = '';
    for (const char of str) {
        if (pinyinMap[char]) {
            result += pinyinMap[char];
        } else if (/[a-zA-Z]/.test(char)) {
            result += char.toLowerCase();
        } else if (/[0-9]/.test(char)) {
            result += char;
        }
    }
    return result;
}

function onGovRegisterAPIChange() {
    const checked = document.getElementById('govRegisterAPIInput').checked;
    document.getElementById('govAPIFields').style.display = checked ? '' : 'none';
    document.getElementById('govRegisterAPILabel').textContent = checked ? '已注册' : '未注册';
    
    // 自动生成 API 路径（拼音首字母）
    if (checked && !document.getElementById('govAPIPathInput').value) {
        const taskName = document.getElementById('govTaskNameInput').value.trim();
        if (taskName) {
            const initials = chineseToPinyinInitials(taskName);
            document.getElementById('govAPIPathInput').value = `/api/tasks/${initials}`;
        }
    }
}

function populateGovDbSelect() {
    const select = document.getElementById('govTaskDbSelect');
    select.innerHTML = '<option value="">不关联数据库</option>';
    databases.forEach(db => {
        select.innerHTML += `<option value="${escapeHtml(db.id)}">${escapeHtml(db.name)} (${escapeHtml(db.type)})</option>`;
    });
}

async function handleGovTaskSubmit(e) {
    e.preventDefault();
    const type = document.getElementById('govTaskTypeInput').value;
    const extsStr = document.getElementById('govAcceptExtsInput').value.trim();
    const registerAsAPI = document.getElementById('govRegisterAPIInput').checked;
    const taskData = {
        name: document.getElementById('govTaskNameInput').value.trim(),
        type: type,
        description: document.getElementById('govTaskDescInput').value.trim(),
        js_code: document.getElementById('govCodeInput').value,
        database_id: document.getElementById('govTaskDbSelect').value,
        cron_expr: type === 'scheduled' ? document.getElementById('govCronInput').value.trim() : '',
        enabled: type === 'scheduled' ? document.getElementById('govEnabledInput').checked : false,
        input_type: type === 'interactive' ? document.getElementById('govInputTypeSelect').value : '',
        accept_exts: type === 'interactive' && extsStr ? extsStr.split(',').map(s => s.trim()).filter(Boolean) : [],
        file_batch_mode: type === 'interactive' && document.getElementById('govFileBatchModeSelect') ? document.getElementById('govFileBatchModeSelect').value : '',
        register_as_api: registerAsAPI,
        api_path: registerAsAPI ? document.getElementById('govAPIPathInput').value.trim() : '',
        api_method: registerAsAPI ? document.getElementById('govAPIMethodInput').value : 'POST',
    };

    if (!taskData.name || !taskData.js_code) {
        document.getElementById('govFormError').textContent = '任务名称和Go代码不能为空';
        document.getElementById('govFormError').classList.add('show');
        return;
    }

    try {
        const url = isEditGovMode
            ? `${API_BASE}/api/data-ontology/governance/tasks/${editingGovTaskId}`
            : `${API_BASE}/api/data-ontology/governance/tasks`;
        const method = isEditGovMode ? 'PUT' : 'POST';
        const response = await fetchWithAuth(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(taskData)
        });
        const data = await response.json();
        if (data.success) {
            document.getElementById('govFormSuccess').textContent = isEditGovMode ? '更新成功' : '创建成功';
            document.getElementById('govFormSuccess').classList.add('show');
            setTimeout(() => {
                hideGovTaskModal();
                loadGovernanceTasks().then(() => {
                    if (data.task) selectGovTask(data.task.id);
                });
            }, 600);
        } else {
            document.getElementById('govFormError').textContent = data.message || '操作失败';
            document.getElementById('govFormError').classList.add('show');
        }
    } catch (error) {
        document.getElementById('govFormError').textContent = '请求失败: ' + error.message;
        document.getElementById('govFormError').classList.add('show');
    }
}

async function deleteGovTask() {
    if (!currentGovTask) return;
    if (!confirm(`确定删除任务「${currentGovTask.name}」？`)) return;
    
    const deleteBtn = document.getElementById('deleteGovTaskBtn');
    const originalText = deleteBtn ? deleteBtn.textContent : '';
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.textContent = '删除中...';
    }
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/tasks/${currentGovTask.id}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            currentGovTask = null;
            try { sessionStorage.removeItem('govLastSelectedTaskId'); } catch (e) {}
            document.getElementById('govTaskDetailView').style.display = 'none';
            document.getElementById('govWelcomeView').style.display = '';
            loadGovernanceTasks();
        } else {
            showToast(data.message || '删除失败', 'error');
            if (deleteBtn) {
                deleteBtn.disabled = false;
                deleteBtn.textContent = originalText;
            }
        }
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.textContent = originalText;
        }
    }
}

async function runGovTask() {
    if (!currentGovTask) return;
    await executeGovTaskInBrowser(currentGovTask.js_code, null, '');
}

async function toggleGovTask() {
    if (!currentGovTask) return;
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/tasks/${currentGovTask.id}/toggle`, {
            method: 'POST'
        });
        const data = await response.json();
        if (data.success) {
            currentGovTask.enabled = data.enabled;
            showGovTaskDetail(currentGovTask);
            renderGovTaskList();
        }
    } catch (error) {
        showToast('操作失败: ' + error.message, 'error');
    }
}

async function refreshGovTaskStatus() {
    if (!currentGovTask) return;
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/tasks/${currentGovTask.id}`);
        const data = await response.json();
        if (data.success && data.task) {
            const idx = govTasks.findIndex(t => t.id === data.task.id);
            if (idx >= 0) govTasks[idx] = data.task;
            currentGovTask = data.task;
            showGovTaskDetail(data.task);
            renderGovTaskList();
            loadGovTaskLogs();
            if (data.task.status === 'running') {
                setTimeout(refreshGovTaskStatus, 3000);
            }
        }
    } catch (error) {
        console.error('刷新任务状态失败:', error);
    }
}

// 文件上传（支持多选）
function handleGovFileSelect(event) {
    if (event.target.files.length > 0) {
        setGovFiles(event.target.files);
    }
}

function setGovFiles(fileList) {
    govSelectedFiles = Array.from(fileList || []);
    const row = document.getElementById('govSelectedFile');
    const nameEl = document.getElementById('govFileName');
    if (govSelectedFiles.length === 0) {
        row.style.display = 'none';
        return;
    }
    if (govSelectedFiles.length === 1) {
        const f = govSelectedFiles[0];
        nameEl.textContent = f.name + ' (' + formatFileSize(f.size) + ')';
    } else {
        const total = govSelectedFiles.reduce((s, f) => s + f.size, 0);
        const names = govSelectedFiles.map(f => f.name).join('、');
        const maxLen = 200;
        const showNames = names.length > maxLen ? names.slice(0, maxLen) + '…' : names;
        nameEl.textContent = `已选 ${govSelectedFiles.length} 个文件（共 ${formatFileSize(total)}）：${showNames}`;
    }
    row.style.display = 'flex';
}

function clearGovFile() {
    govSelectedFiles = [];
    document.getElementById('govFileInput').value = '';
    document.getElementById('govSelectedFile').style.display = 'none';
    document.getElementById('govInputText') && (document.getElementById('govInputText').value = '');
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function executeInteractiveTask() {
    if (!currentGovTask) return;
    const inputType = currentGovTask.input_type || 'file';
    const inputText = document.getElementById('govInputText')?.value || '';
    const files = govSelectedFiles;

    if ((inputType === 'file' || inputType === 'both') && files.length === 0 && !inputText) {
        showToast('请选择文件或输入文本', 'warning');
        return;
    }
    if (inputType === 'text' && !inputText) {
        showToast('请输入文本内容', 'warning');
        return;
    }

    const batchMode = currentGovTask.file_batch_mode || 'per_file';
    if (currentGovTask.type === 'interactive' && batchMode === 'single') {
        if (files.length < 2) {
            showToast('请至少上传 2 个文件：1 个综合日报 Word 模板 + 至少 1 份单位日报', 'warning');
            return;
        }
        await executeGovTaskAggregateInBrowser(files, inputText);
        return;
    }

    await executeGovTaskOnBackend(files, inputText);
}

async function executeGovTaskAggregateInBrowser(files, inputText) {
    if (!currentGovTask) return;
    currentGovTask.status = 'running';
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();
    const container = document.getElementById('govTaskOutput');
    container.innerHTML = '<div class="gov-log-entry"><div class="gov-log-header"><span>执行中...</span><span class="gov-log-status running">运行中</span></div></div>';

    const { status, output, errorMsg, inputDesc } = await executeGovTaskInBrowserOnce(currentGovTask.js_code, null, inputText, files);

    currentGovTask.status = status;
    currentGovTask.last_output = output;
    currentGovTask.last_error = errorMsg;
    currentGovTask.last_run_at = new Date().toISOString();
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    container.innerHTML = `
        <div class="gov-log-entry">
            <div class="gov-log-header">
                <span>${new Date().toLocaleString()}</span>
                <span class="gov-log-status ${status}">${status === 'success' ? '成功' : '错误'}</span>
            </div>
            ${inputDesc ? `<div class="gov-log-input">输入: ${escapeHtml(inputDesc)}</div>` : ''}
            ${output ? `<div class="gov-log-output">${escapeHtml(output)}</div>` : ''}
            ${errorMsg ? `<div class="gov-log-error">${escapeHtml(errorMsg)}</div>` : ''}
        </div>
    `;
}

// 后端异步执行任务
async function executeGovTaskOnBackend(files, inputText) {
    if (!currentGovTask) return;

    const taskId = currentGovTask.id;

    // 更新 UI 显示运行中
    currentGovTask.status = 'running';
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    const container = document.getElementById('govTaskOutput');
    container.innerHTML = '<div class="gov-log-entry"><div class="gov-log-header"><span>正在上传文件...</span></div></div>';

    try {
        // 构建 multipart 表单
        const formData = new FormData();
        formData.append('input_text', inputText || '');

        if (files && files.length > 0) {
            for (const file of files) {
                formData.append('files', file);
            }
        }

        // 调用后端 run 接口
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/tasks/${taskId}/run`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || '任务启动失败');
        }

        const runId = result.run_id;
        container.innerHTML = `<div class="gov-log-entry"><div class="gov-log-header"><span>任务已入队，后台执行中...</span><span class="gov-log-status running">运行中</span></div></div>`;

        // 开始轮询进度
        await pollTaskProgress(taskId, runId);

    } catch (error) {
        currentGovTask.status = 'error';
        currentGovTask.last_error = error.message;
        container.innerHTML = `<div class="gov-log-entry"><div class="gov-log-header"><span style="color:red">错误: ${escapeHtml(error.message)}</span></div></div>`;
        renderGovTaskList();
    }
}

/**
 * 轮询任务执行进度
 * 每 2 秒查询一次后端进度接口，直到任务完成或出错
 * @param {string} taskId - 任务 ID
 * @param {string} runId - 执行 ID
 * @returns {Promise<void>}
 */
async function pollTaskProgress(taskId, runId) {
    const container = document.getElementById('govTaskOutput');

    const pollInterval = 2000; // 2秒轮询一次
    let lastProcessed = 0;

    const poll = async () => {
        try {
            const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/tasks/${taskId}/progress`);
            const data = await response.json();

            if (!data.success) {
                console.error('获取进度失败:', data.message);
                return;
            }

            const { status, percent, processed_files, total_files, current_file, last_output, last_error } = data;

            // 更新进度显示（有文件时显示进度条；无文件的后台任务仍显示状态与 last_output，便于看到 gov.log 汇总输出）
            if (total_files > 0) {
                container.innerHTML = `
                    <div class="gov-log-entry">
                        <div class="gov-log-header">
                            <span>进度: ${processed_files}/${total_files} (${percent}%)</span>
                            <span class="gov-log-status ${status}">${status === 'running' ? '运行中' : status === 'success' ? '成功' : '错误'}</span>
                        </div>
                        ${current_file ? `<div class="gov-log-input">当前: ${escapeHtml(current_file)}</div>` : ''}
                        ${last_output ? `<div class="gov-log-output">${escapeHtml(last_output)}</div>` : ''}
                    </div>`;
            } else {
                container.innerHTML = `
                    <div class="gov-log-entry">
                        <div class="gov-log-header">
                            <span>后台执行${status === 'running' ? '中…' : ''}</span>
                            <span class="gov-log-status ${status}">${status === 'running' ? '运行中' : status === 'success' ? '成功' : '错误'}</span>
                        </div>
                        ${last_output ? `<div class="gov-log-output">${escapeHtml(last_output)}</div>` : ''}
                        ${last_error ? `<div class="gov-log-error">${escapeHtml(last_error)}</div>` : ''}
                    </div>`;
            }

            // 如果任务完成，停止轮询
            if (status !== 'running') {
                // 刷新任务详情与持久化执行日志（后端异步任务会写入 /logs）
                await loadGovernanceTasks();
                const task = govTasks.find(t => t.id === taskId);
                if (task) {
                    currentGovTask = task;
                    showGovTaskDetail(task);
                }
                await loadGovTaskLogs();
                return;
            }

            // 继续轮询
            setTimeout(poll, pollInterval);

        } catch (error) {
            console.error('轮询进度失败:', error);
            // 出错后继续轮询
            setTimeout(poll, pollInterval);
        }
    };

    await poll();
}

// ==================== 浏览器端 JS 执行引擎 ====================

let govLibsLoaded = false;

/**
 * 动态加载治理任务所需的第三方库（XLSX, PapaParse, mammoth, PizZip, docxtemplater）
 * 采用延迟加载策略，仅在首次执行治理任务时加载
 * @returns {Promise<void>}
 */
async function ensureGovLibsLoaded() {
    if (govLibsLoaded) return;
    const libs = [
        { global: 'XLSX',    src: '../../lib/xlsx.full.min.js' },
        { global: 'Papa',    src: '../../lib/papaparse.min.js' },
        { global: 'mammoth', src: '../../lib/mammoth.browser.min.js' },
        { global: 'PizZip',  src: 'lib/pizzip.js' },
    ];
    for (const lib of libs) {
        if (!window[lib.global]) {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = lib.src;
                s.onload = resolve;
                s.onerror = () => reject(new Error(`加载 ${lib.src} 失败`));
                document.head.appendChild(s);
            });
        }
    }
    if (!_govGetDocxtemplaterClass()) {
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'lib/docxtemplater.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('加载 docxtemplater 失败'));
            document.head.appendChild(s);
        });
    }
    if (!_govGetDocxtemplaterClass()) {
        throw new Error('Docxtemplater 不可用');
    }
    govLibsLoaded = true;
}

function _govGetDocxtemplaterClass() {
    if (typeof window.Docxtemplater !== 'undefined') return window.Docxtemplater;
    const d = window.docxtemplater;
    if (d && (d.default || d.Docxtemplater)) return d.default || d.Docxtemplater;
    return null;
}

function _govExcelCellForValue(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number' && !isNaN(val)) return { t: 'n', v: val };
    if (val instanceof Date) return { t: 'd', v: val };
    if (typeof val === 'boolean') return { t: 'b', v: val };
    return { t: 's', v: String(val) };
}

function _govExpandSheetRef(XLSX, ws) {
    let maxR = 0;
    let maxC = 0;
    let has = false;
    for (const k of Object.keys(ws)) {
        if (k[0] === '!') continue;
        try {
            const cell = XLSX.utils.decode_cell(k);
            has = true;
            maxR = Math.max(maxR, cell.r);
            maxC = Math.max(maxC, cell.c);
        } catch (e) {
            /* ignore */
        }
    }
    if (has) {
        ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    }
}

function _govApplyCellMapToSheet(XLSX, ws, cellMap) {
    for (const [addr, val] of Object.entries(cellMap)) {
        if (!addr || addr[0] === '!') continue;
        try {
            XLSX.utils.decode_cell(addr);
        } catch (e) {
            continue;
        }
        const cellObj = _govExcelCellForValue(val);
        if (cellObj === null) delete ws[addr];
        else ws[addr] = cellObj;
    }
    _govExpandSheetRef(XLSX, ws);
}

function _govDataIsFlatCellMap(XLSX, data) {
    const keys = Object.keys(data);
    if (keys.length === 0) return false;
    return keys.every(k => {
        if (typeof k !== 'string') return false;
        try {
            XLSX.utils.decode_cell(k);
            return true;
        } catch (e) {
            return false;
        }
    });
}

function createGovHelper(logLines, uploadedFiles) {
    const uploaded = Array.isArray(uploadedFiles) ? uploadedFiles : [];
    const dbId = currentGovTask?.database_id || '';

    async function _resolveGovTemplateFile(templateFile) {
        if (templateFile instanceof File || templateFile instanceof Blob) return templateFile;
        if (typeof templateFile === 'string') {
            const name = templateFile.trim();
            if (!name) throw new Error('未指定模板文件名');
            const found = uploaded.find(f => f && f.name === name)
                || uploaded.find(f => f && (f.name.endsWith(name) || name.endsWith(f.name)));
            if (found) return found;
            throw new Error(`未找到模板文件「${name}」，请上传后传入 File 或匹配的文件名`);
        }
        throw new Error('templateFile 须为 File/Blob 或文件名字符串');
    }

    async function _runSQL(databaseId, sql, params = []) {
        const resp = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/execute-sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ database_id: databaseId, sql, params })
        });
        const data = await resp.json();
        if (!data.success) throw new Error(data.message || 'SQL执行失败');
        return data;
    }

    const dbType = (() => {
        const db = (databases || []).find(d => d.id === (currentGovTask && currentGovTask.database_id));
        return db ? db.type : '';
    })();

    function _govDownloadBlob(blob, filename) {
        const a = document.createElement('a');
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function _govCsvEscapeCell(val) {
        const s = val === null || val === undefined ? '' : String(val);
        if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    return {
        log(msg) {
            logLines.push(String(msg));
        },
        getDbType() {
            return dbType;
        },
        getDatabases() {
            return (databases || []).map(d => ({ id: d.id, name: d.name, type: d.type }));
        },
        async readExcel(file) {
            if (!file) throw new Error('未提供文件');
            const arrayBuffer = await file.arrayBuffer();
            const data = new Uint8Array(arrayBuffer);
            const wb = XLSX.read(data, { type: 'array' });
            if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
                throw new Error('Excel解析失败: 未检测到工作表');
            }
            return wb;
        },
        async readCSV(text) {
            if (!text) throw new Error('未提供文本');
            return Papa.parse(text, { header: false }).data;
        },
        async readWord(file) {
            if (!file) throw new Error('未提供文件');
            const arrayBuffer = await file.arrayBuffer();
            return mammoth.extractRawText({ arrayBuffer });
        },
        async querySQL(sql, params) {
            if (!dbId) throw new Error('未关联数据库，请编辑任务关联一个数据库');
            const result = await _runSQL(dbId, sql, params || []);
            return result.data || [];
        },
        async executeSQL(sql, params) {
            if (!dbId) throw new Error('未关联数据库，请编辑任务关联一个数据库');
            const result = await _runSQL(dbId, sql, params || []);
            return result.rows_affected || 0;
        },
        async querySQLForDb(databaseId, sql, params) {
            const result = await _runSQL(databaseId, sql, params || []);
            return result.data || [];
        },
        async executeSQLForDb(databaseId, sql, params) {
            const result = await _runSQL(databaseId, sql, params || []);
            return result.rows_affected || 0;
        },
        // 调用 AI 补全（与 AI 助手共用 URL/API Key/模型），返回结构化文本
        async callAI(prompt) {
            const resp = await fetchWithAuth(`${API_BASE}/api/data-ontology/ai/completion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });
            const data = await resp.json();
            if (!data.success) throw new Error(data.message || 'AI 调用失败');
            return data.content || '';
        },
        async fillWordTemplate(templateFile, data, outputFilename) {
            await ensureGovLibsLoaded();
            if (!window.PizZip) throw new Error('PizZip 未加载');
            const DocxCtor = _govGetDocxtemplaterClass();
            if (!DocxCtor) throw new Error('Docxtemplater 未加载');
            const fileObj = await _resolveGovTemplateFile(templateFile);
            const buf = await fileObj.arrayBuffer();
            const zip = new window.PizZip(buf);
            const doc = new DocxCtor(zip, { paragraphLoop: true, linebreaks: true });
            doc.setData(data || {});
            doc.render();
            const blob = doc.getZip().generate({
                type: 'blob',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            });
            const base = outputFilename || 'output.docx';
            const outName = /\.docx$/i.test(base) ? base : `${base}.docx`;
            _govDownloadBlob(blob, outName);
        },
        async fillExcelTemplate(templateFile, data, outputFilename) {
            if (typeof XLSX === 'undefined' || !XLSX.utils || !XLSX.writeFile) throw new Error('XLSX 未加载');
            if (!data || typeof data !== 'object') throw new Error('data 须为对象');
            const fileObj = await _resolveGovTemplateFile(templateFile);
            const wb = await this.readExcel(fileObj);
            const flat = _govDataIsFlatCellMap(XLSX, data);
            if (flat) {
                const sn = wb.SheetNames[0];
                _govApplyCellMapToSheet(XLSX, wb.Sheets[sn], data);
            } else {
                for (const [sheetName, cells] of Object.entries(data)) {
                    if (!cells || typeof cells !== 'object' || Array.isArray(cells)) continue;
                    const ws = wb.Sheets[sheetName];
                    if (!ws) throw new Error(`模板中不存在工作表「${sheetName}」`);
                    _govApplyCellMapToSheet(XLSX, ws, cells);
                }
            }
            const base = outputFilename || 'output.xlsx';
            const outName = /\.xlsx?$/i.test(base) ? base : `${base}.xlsx`;
            XLSX.writeFile(wb, outName);
        },
        writeExcel(filename, data, options) {
            if (!filename) throw new Error('未提供文件名');
            if (typeof XLSX === 'undefined' || !XLSX.utils || !XLSX.writeFile) throw new Error('XLSX 未加载');
            const opts = options || {};
            const sheetName = String(opts.sheetName || 'Sheet1').slice(0, 31);
            let ws;
            if (!data || !data.length) {
                ws = XLSX.utils.aoa_to_sheet([[]]);
            } else if (Array.isArray(data[0])) {
                ws = XLSX.utils.aoa_to_sheet(data);
            } else {
                ws = XLSX.utils.json_to_sheet(data);
            }
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
            const outName = /\.xlsx?$/i.test(filename) ? filename : `${filename}.xlsx`;
            XLSX.writeFile(wb, outName);
        },
        writeCSV(filename, data) {
            if (!filename) throw new Error('未提供文件名');
            if (!Array.isArray(data)) throw new Error('data 须为二维数组');
            const lines = data.map(row => {
                if (!Array.isArray(row)) throw new Error('CSV 每行须为数组');
                return row.map(_govCsvEscapeCell).join(',');
            });
            const csv = lines.join('\r\n');
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
            const outName = /\.csv$/i.test(filename) ? filename : `${filename}.csv`;
            _govDownloadBlob(blob, outName);
        },
        writeText(filename, content) {
            if (!filename) throw new Error('未提供文件名');
            const text = content === undefined || content === null ? '' : String(content);
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            _govDownloadBlob(blob, filename);
        },
        writeJSON(filename, data) {
            if (!filename) throw new Error('未提供文件名');
            const text = JSON.stringify(data, null, 2);
            const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
            const outName = /\.json$/i.test(filename) ? filename : `${filename}.json`;
            _govDownloadBlob(blob, outName);
        },
    };
}

// ==================== 入库代码生成助手 ====================
let codegenColumns = [];

function toggleCodeGen() {
    const panel = document.getElementById('govCodeGenPanel');
    const arrow = document.getElementById('codegenArrow');
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : 'block';
    arrow.classList.toggle('open', !visible);
    if (!visible) refreshCodegenTables();
}

// 折叠/展开任务代码预览
function toggleGovTaskCode() {
    const panel = document.getElementById('govTaskCodePanel');
    const arrow = document.getElementById('govTaskCodeArrow');
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : 'block';
    arrow.classList.toggle('open', !visible);
}

async function refreshCodegenTables() {
    const dbId = document.getElementById('govTaskDbSelect').value;
    const sel = document.getElementById('codegenTable');
    codegenColumns = [];
    document.getElementById('codegenMappingArea').style.display = 'none';

    if (!dbId) {
        sel.innerHTML = '<option value="">请先选择关联数据库</option>';
        return;
    }

    const db = databases.find(d => d.id === dbId);
    if (!db) return;

    sel.innerHTML = '<option value="">加载中...</option>';

    try {
        let sql;
        if (db.type === 'sqlite') sql = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";
        else if (db.type === 'postgresql') sql = "SELECT table_name as name FROM information_schema.tables WHERE table_schema='public'";
        else if (db.type === 'dm') sql = "SELECT NAME FROM SYSOBJECTS WHERE TYPE$='SCHOBJ' AND SUBTYPE$='UTAB' AND PID=-1";
        else if (db.type === 'oracle') sql = "SELECT table_name as name FROM user_tables WHERE table_name NOT LIKE '%$%' AND table_name NOT LIKE 'ALL\\_%' ESCAPE '\\' AND table_name NOT LIKE 'DBA\\_%' ESCAPE '\\' AND table_name NOT LIKE 'ACCHK\\_%' ESCAPE '\\' AND table_name NOT LIKE 'ALERT\\_%' ESCAPE '\\' AND table_name NOT LIKE 'LOGMNR\\_%' ESCAPE '\\' AND table_name NOT LIKE 'WRM$%' AND table_name NOT LIKE 'WRI$%' AND table_name NOT LIKE 'AQ\\_%' ESCAPE '\\' AND table_name NOT LIKE 'ATP\\_%' ESCAPE '\\' AND table_name NOT LIKE 'AUDIT\\_%' ESCAPE '\\' AND table_name NOT LIKE 'AV\\_%' ESCAPE '\\' AND table_name NOT LIKE 'BDSQL\\_%' ESCAPE '\\' AND table_name NOT LIKE 'CATALOG\\_%' ESCAPE '\\' AND table_name NOT LIKE 'CLUSTER\\_%' ESCAPE '\\' AND table_name NOT LIKE 'CQN\\_%' ESCAPE '\\' AND table_name NOT LIKE 'DBMS\\_%' ESCAPE '\\' AND table_name NOT LIKE 'DEF$%' AND table_name NOT LIKE 'ERROR\\_%' ESCAPE '\\' AND table_name NOT LIKE 'FILE\\_%' ESCAPE '\\' AND table_name NOT LIKE 'HELP\\_%' ESCAPE '\\' AND table_name NOT LIKE 'LOGSTDBY%' AND table_name NOT LIKE 'MVIEW\\_%' ESCAPE '\\' AND table_name NOT LIKE 'OLAP\\_%' ESCAPE '\\' AND table_name NOT LIKE 'REPCAT\\_%' ESCAPE '\\' AND table_name NOT LIKE 'SCHEDULER\\_%' ESCAPE '\\' AND table_name NOT LIKE 'SYS\\_%' ESCAPE '\\' AND table_name NOT LIKE 'TRACE\\_%' ESCAPE '\\' AND table_name <> 'DUAL' AND table_name NOT LIKE 'DDL\\_%' ESCAPE '\\' AND table_name NOT LIKE 'FOREIGN\\_%' ESCAPE '\\' AND table_name NOT LIKE 'HANG\\_%' ESCAPE '\\' AND table_name NOT LIKE 'IMPDP\\_%' ESCAPE '\\' AND table_name NOT LIKE 'INC%' AND table_name NOT LIKE 'KU\\_%' ESCAPE '\\' AND table_name NOT LIKE 'LOGMNRC\\_%' ESCAPE '\\' ORDER BY table_name";
        else sql = 'SHOW TABLES';

        const resp = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/execute-sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ database_id: dbId, sql, params: [] })
        });
        const result = await resp.json();
        if (!result.success) throw new Error(result.message);

        let tables = (result.data || []).map(row => Object.values(row)[0]);
        if (db.type === 'dm') {
            tables = tables.filter(t => {
                const n = String(t);
                return !n.startsWith('##') && !n.startsWith('AQ$_') && !n.startsWith('SYS$') && !n.startsWith('DBMS_') && !n.startsWith('REG$') && n !== 'POLICIES' && !n.startsWith('POLICY_');
            });
        }
        sel.innerHTML = '<option value="">-- 请选择目标表 --</option>' + tables.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    } catch (e) {
        sel.innerHTML = `<option value="">加载失败: ${escapeHtml(e.message)}</option>`;
    }
}

async function onCodegenTableChange() {
    const tableName = document.getElementById('codegenTable').value;
    const dbId = document.getElementById('govTaskDbSelect').value;
    const db = databases.find(d => d.id === dbId);
    const area = document.getElementById('codegenMappingArea');
    const body = document.getElementById('codegenMappingBody');

    if (!tableName || !db) {
        area.style.display = 'none';
        codegenColumns = [];
        return;
    }

    try {
        let sql;
        if (db.type === 'sqlite') sql = `PRAGMA table_info('${tableName}')`;
        else if (db.type === 'postgresql') sql = `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='${tableName}'`;
        else if (db.type === 'dm' || db.type === 'oracle') sql = `SELECT COLUMN_NAME, DATA_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '${String(tableName).replace(/'/g, "''").toUpperCase()}' ORDER BY COLUMN_ID`;
        else sql = 'SHOW COLUMNS FROM `' + tableName + '`';

        const resp = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/execute-sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ database_id: dbId, sql, params: [] })
        });
        const result = await resp.json();
        if (!result.success) throw new Error(result.message);

        codegenColumns = (result.data || []).map(row => {
            if (db.type === 'sqlite') return { name: row.name, type: row.type || 'TEXT' };
            if (db.type === 'postgresql') return { name: row.column_name, type: row.data_type };
            if (db.type === 'dm' || db.type === 'oracle') {
                const name = row.COLUMN_NAME ?? row.column_name;
                const type = row.DATA_TYPE ?? row.data_type ?? '';
                return { name: name || '', type: type };
            }
            return { name: row.Field, type: row.Type };
        });

        body.innerHTML = codegenColumns.map((col, i) => `
            <div class="gov-codegen-mapping-row">
                <span class="gov-cg-check"><input type="checkbox" class="codegen-col-check" data-idx="${i}" checked></span>
                <span class="gov-cg-col">${escapeHtml(col.name)}</span>
                <span class="gov-cg-type">${escapeHtml(col.type)}</span>
                <span class="gov-cg-src"><input type="number" class="codegen-col-src" data-idx="${i}" value="${i}" min="0"></span>
            </div>
        `).join('');
        area.style.display = 'block';
    } catch (e) {
        area.style.display = 'none';
        codegenColumns = [];
    }
}

function generateImportCode() {
    const sourceType = document.getElementById('codegenSourceType').value;
    const tableName = document.getElementById('codegenTable').value;
    const dbId = document.getElementById('govTaskDbSelect').value;
    const db = databases.find(d => d.id === dbId);

    if (!tableName) { showToast('请先选择目标表', 'warning'); return; }

    const checks = document.querySelectorAll('.codegen-col-check');
    const srcs = document.querySelectorAll('.codegen-col-src');
    const mappings = [];
    checks.forEach((chk, i) => {
        if (chk.checked) {
            const srcIdx = parseInt(srcs[i].value);
            mappings.push({ col: codegenColumns[i].name, srcIdx });
        }
    });

    if (mappings.length === 0) { showToast('请至少勾选一个列', 'warning'); return; }

    const q = (db && (db.type === 'mysql' || db.type === 'mariadb')) ? '`' : '"';
    const colList = mappings.map(m => `${q}${m.col}${q}`).join(', ');
    const placeholders = mappings.map(() => '?').join(', ');
    const valExpr = mappings.map(m => `row[${m.srcIdx}]`).join(', ');
    const colComments = mappings.map(m => `//   源列 ${m.srcIdx} → ${m.col}`).join('\n');

    let parseCode = '';
    if (sourceType === 'excel') {
        parseCode = `const workbook = await gov.readExcel(INPUT_FILE);
const sheetName = workbook.SheetNames[0];
const allData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
const headers = allData[0];
const rows = allData.slice(1);
gov.log(\`解析工作表: \${sheetName}, \${rows.length} 行 × \${headers.length} 列\`);`;
    } else if (sourceType === 'csv_file') {
        parseCode = `const text = await INPUT_FILE.text();
const parsed = Papa.parse(text, { header: false });
const allData = parsed.data.filter(r => r.some(c => c));
const headers = allData[0];
const rows = allData.slice(1);
gov.log(\`解析CSV文件: \${rows.length} 行 × \${headers.length} 列\`);`;
    } else {
        parseCode = `const parsed = Papa.parse(INPUT_TEXT, { header: false });
const allData = parsed.data.filter(r => r.some(c => c));
const headers = allData[0];
const rows = allData.slice(1);
gov.log(\`解析CSV文本: \${rows.length} 行 × \${headers.length} 列\`);`;
    }

    const code = `${parseCode}

// 列映射:
${colComments}

let inserted = 0, failed = 0;
for (const row of rows) {
    try {
        await gov.executeSQL(
            'INSERT INTO ${q}${tableName}${q} (${colList}) VALUES (${placeholders})',
            [${valExpr}]
        );
        inserted++;
    } catch (e) {
        failed++;
        if (failed <= 5) gov.log(\`✗ 行 \${inserted + failed} 失败: \${e.message}\`);
    }
}

gov.log(\`\\n入库完成: ${tableName} ← 成功 \${inserted} 行, 失败 \${failed} 行\`);`;

    document.getElementById('govCodeInput').value = code;
}

// AI 辅助生成入库代码（使用与 AI 助手相同的 API URL、API Key、模型）
async function generateImportCodeWithAI() {
    const dbId = document.getElementById('govTaskDbSelect').value;
    const tableName = document.getElementById('codegenTable').value;
    const sourceType = document.getElementById('codegenSourceType').value;
    const db = databases.find(d => d.id === dbId);

    if (!dbId || !tableName) {
        showToast('请先选择关联数据库并选择目标表', 'warning');
        return;
    }
    const checks = document.querySelectorAll('.codegen-col-check');
    const srcs = document.querySelectorAll('.codegen-col-src');
    const mappings = [];
    checks.forEach((chk, i) => {
        if (chk.checked && codegenColumns[i]) {
            const srcIdx = parseInt(srcs[i].value, 10);
            mappings.push({
                name: codegenColumns[i].name,
                type: codegenColumns[i].type || 'TEXT',
                source_index: isNaN(srcIdx) ? i : srcIdx
            });
        }
    });
    if (mappings.length === 0) {
        showToast('请至少勾选一个要导入的列', 'warning');
        return;
    }

    if (!aiConfig) await loadAiConfig();
    if (!aiConfig || !aiConfig.url || !aiConfig.api_key || !aiConfig.model) {
        showToast('请先在「AI助手」中配置 AI 设置（AI服务URL、API Key、模型名称）后再使用 AI 辅助生成', 'warning');
        return;
    }

    const userHintEl = document.getElementById('codegenUserHint');
    const userHint = userHintEl ? userHintEl.value.trim() : '';

    const payload = {
        database_id: dbId,
        database_name: db.name,
        db_type: db.type,
        table_name: tableName,
        source_type: sourceType,
        columns: mappings,
        user_hint: userHint
    };

    const btn = document.querySelector('.gov-codegen-actions .btn-secondary');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '生成中...';
    }
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/ai/codegen`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (data.success && data.code != null) {
            document.getElementById('govCodeInput').value = data.code;
        } else {
            showToast(data.message || 'AI 生成失败', 'error');
        }
    } catch (e) {
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'AI 辅助生成代码';
        }
    }
}

/** 单次执行并写入服务端日志，返回结果供单文件或批量汇总使用 */
async function executeGovTaskInBrowserOnce(code, file, inputText, allFilesOverride) {
    const logLines = [];
    let status = 'success';
    let errorMsg = '';

    try {
        await ensureGovLibsLoaded();
        const uploaded = Array.isArray(allFilesOverride) ? allFilesOverride : (file ? [file] : (govSelectedFiles || []));
        const gov = createGovHelper(logLines, uploaded);
        const DocxCtor = _govGetDocxtemplaterClass();

        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const fn = new AsyncFunction('gov', 'INPUT_FILE', 'INPUT_TEXT', 'XLSX', 'Papa', 'mammoth', 'PizZip', 'Docxtemplater', 'INPUT_FILES', code);
        const inputFiles = uploaded;
        await fn(gov, file || null, inputText || '', window.XLSX, window.Papa, window.mammoth, window.PizZip, DocxCtor, inputFiles);
    } catch (err) {
        status = 'error';
        errorMsg = err.message || String(err);
        logLines.push(`[错误] ${errorMsg}`);
    }

    const output = logLines.join('\n');
    let inputDesc = '';
    if (Array.isArray(allFilesOverride) && allFilesOverride.length) {
        inputDesc = `files (${allFilesOverride.length}): ${allFilesOverride.map(f => f.name).join('、')}`;
    } else if (file) {
        inputDesc = `file: ${file.name}`;
    } else if (inputText) {
        inputDesc = `text: ${inputText.substring(0, 50)}`;
    }

    if (currentGovTask) {
        const taskId = currentGovTask.id;
        try {
            await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/tasks/${taskId}/save-log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status, output, error: errorMsg, input: inputDesc })
            });
        } catch (e) {
            console.error('保存日志失败:', e);
        }
    }

    return { status, output, errorMsg, inputDesc };
}

async function executeGovTaskBatchInBrowser(code, files, inputText) {
    if (!currentGovTask || !files || files.length < 2) return;

    currentGovTask.status = 'running';
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    const container = document.getElementById('govTaskOutput');
    const results = [];
    const startedAt = Date.now();

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        container.innerHTML = `
            <div class="gov-log-entry">
                <div class="gov-log-header">
                    <span>批量处理 ${i + 1}/${files.length}：${escapeHtml(file.name)}</span>
                    <span class="gov-log-status running">运行中</span>
                </div>
            </div>`;

        const r = await executeGovTaskInBrowserOnce(code, file, inputText, [file]);
        results.push({ fileName: file.name, ...r });
    }

    const ok = results.filter(r => r.status === 'success').length;
    const fail = results.length - ok;
    const overallStatus = fail === 0 ? 'success' : 'error';
    const summaryLines = [
        `批量处理完成：共 ${results.length} 个文件，成功 ${ok}，失败 ${fail}。`,
        ...results.map(r =>
            (r.status === 'success' ? '✓' : '✗') + ' ' + r.fileName + (r.errorMsg ? ' — ' + r.errorMsg : '')
        )
    ];
    const summaryText = summaryLines.join('\n');
    const combinedOutput = results.map(r => `--- ${r.fileName} ---\n${r.output || ''}`).join('\n\n');

    currentGovTask.status = overallStatus;
    currentGovTask.last_output = summaryText + (combinedOutput ? '\n\n' + combinedOutput : '');
    currentGovTask.last_error = fail > 0 ? `${fail} 个文件处理失败` : '';
    currentGovTask.last_run_at = new Date().toISOString();
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    container.innerHTML = `
        <div class="gov-log-entry">
            <div class="gov-log-header">
                <span>${new Date().toLocaleString()} · 耗时 ${durationSec}s</span>
                <span class="gov-log-status ${overallStatus}">汇总：成功 ${ok} / 失败 ${fail}</span>
            </div>
            <div class="gov-log-input">共 ${results.length} 个文件，成功 ${ok}，失败 ${fail}</div>
            <div class="gov-log-output">${escapeHtml(summaryText)}</div>
            ${results.map(r => `
                <div class="gov-log-entry" style="margin-top:10px;border-top:1px solid rgba(0,0,0,0.08);padding-top:8px;">
                    <div class="gov-log-header">
                        <span>${escapeHtml(r.fileName)}</span>
                        <span class="gov-log-status ${r.status}">${r.status === 'success' ? '成功' : '错误'}</span>
                    </div>
                    ${r.inputDesc ? `<div class="gov-log-input">输入: ${escapeHtml(r.inputDesc)}</div>` : ''}
                    ${r.output ? `<div class="gov-log-output">${escapeHtml(r.output)}</div>` : ''}
                    ${r.errorMsg ? `<div class="gov-log-error">${escapeHtml(r.errorMsg)}</div>` : ''}
                </div>
            `).join('')}
        </div>`;
}

async function executeGovTaskInBrowser(code, file, inputText) {
    if (!currentGovTask) return;

    currentGovTask.status = 'running';
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    const container = document.getElementById('govTaskOutput');
    container.innerHTML = '<div class="gov-log-entry"><div class="gov-log-header"><span>执行中...</span><span class="gov-log-status running">运行中</span></div></div>';

    const { status, output, errorMsg, inputDesc } = await executeGovTaskInBrowserOnce(code, file, inputText);

    currentGovTask.status = status;
    currentGovTask.last_output = output;
    currentGovTask.last_error = errorMsg;
    currentGovTask.last_run_at = new Date().toISOString();
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    container.innerHTML = `
        <div class="gov-log-entry">
            <div class="gov-log-header">
                <span>${new Date().toLocaleString()}</span>
                <span class="gov-log-status ${status}">${status === 'success' ? '成功' : '错误'}</span>
            </div>
            ${inputDesc ? `<div class="gov-log-input">输入: ${escapeHtml(inputDesc)}</div>` : ''}
            ${output ? `<div class="gov-log-output">${escapeHtml(output)}</div>` : ''}
            ${errorMsg ? `<div class="gov-log-error">${escapeHtml(errorMsg)}</div>` : ''}
        </div>
    `;
}

// ==================== gov API 帮助 ====================

const GOV_API_DOCS = [
    {
        category: 'gov 对象',
        items: [
            {
                name: 'gov.log',
                signature: 'gov.log(msg)',
                desc: '向执行日志面板输出一条消息。',
                example: 'gov.log(\'处理完成，共 \' + n + \' 行\');'
            },
            {
                name: 'gov.getDbType',
                signature: 'gov.getDbType() → string',
                desc: '返回关联数据库的类型字符串，如 "mysql"、"oracle"、"postgresql"、"dm" 等。未关联时返回空字符串。',
                example: 'const t = gov.getDbType();\nif (t === \'mysql\') { /* ... */ }'
            },
            {
                name: 'gov.getDatabases',
                signature: 'gov.getDatabases() → [{id, name, type}]',
                desc: '返回平台中所有已配置数据库的列表，可用于多库写入。',
                example: 'const dbs = gov.getDatabases();\nfor (const db of dbs) {\n  gov.log(db.name + \' - \' + db.type);\n}'
            },
            {
                name: 'gov.readExcel',
                signature: 'await gov.readExcel(file) → workbook',
                desc: '读取上传的 Excel 文件（.xlsx/.xls），返回 SheetJS workbook 对象。配合 XLSX.utils.sheet_to_json 解析数据。',
                example: 'const wb = await gov.readExcel(INPUT_FILE);\nconst sheet = wb.Sheets[wb.SheetNames[0]];\nconst rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });\ngov.log(\'共 \' + rows.length + \' 行\');'
            },
            {
                name: 'gov.readCSV',
                signature: 'await gov.readCSV(text) → string[][]',
                desc: '解析 CSV 文本，返回二维字符串数组（行×列）。',
                example: 'const rows = await gov.readCSV(INPUT_TEXT);\nfor (const row of rows) {\n  gov.log(row.join(\' | \'));\n}'
            },
            {
                name: 'gov.readWord',
                signature: 'await gov.readWord(file) → {value: string, messages: [...]}',
                desc: '读取上传的 Word 文件（.docx），提取纯文本内容。返回 mammoth 的结果对象，value 为正文文本。',
                example: 'const result = await gov.readWord(INPUT_FILE);\nconst text = result.value;\ngov.log(\'字数: \' + text.length);'
            },
            {
                name: 'gov.writeExcel',
                signature: 'gov.writeExcel(filename, data, options?)',
                desc: '从空白生成 Excel 并下载。data 为二维数组或对象数组；options 可选 { sheetName }。若需基于已有 .xlsx 模板只填单元格，请用 gov.fillExcelTemplate。',
                example: '// 二维数组\nconst rows = [[\'姓名\', \'分数\'], [\'张三\', 90]];\ngov.writeExcel(\'结果.xlsx\', rows, { sheetName: \'Sheet1\' });\n\n// 对象数组\nconst objs = [{ name: \'张三\', score: 90 }];\ngov.writeExcel(\'导出.xlsx\', objs);'
            },
            {
                name: 'gov.fillWordTemplate',
                signature: 'await gov.fillWordTemplate(templateFile, data, outputFilename)',
                desc: '基于 .docx 模板（占位符 {name}、循环 {#items}...{/items}、条件 {#show}...{/show}）用 docxtemplater 渲染并下载。templateFile 为 File/Blob，或与已上传文件同名的字符串。',
                example: 'await gov.fillWordTemplate(INPUT_FILE, {\n  name: \'张三\',\n  date: \'2024-01-01\',\n  items: [{ x: 1 }, { x: 2 }],\n  show: true\n}, \'报告.docx\');'
            },
            {
                name: 'gov.fillExcelTemplate',
                signature: 'await gov.fillExcelTemplate(templateFile, data, outputFilename)',
                desc: '读取 .xlsx 模板，按单元格地址写入 data 后下载。data 可为 { A1: \'值\', B2: 123 }（默认第一个工作表），或 { Sheet1: { A1: \'值\' }, Sheet2: { B2: 2 } }。',
                example: '// 单表\nawait gov.fillExcelTemplate(INPUT_FILE, { A1: \'标题\', B2: 100 }, \'导出.xlsx\');\n\n// 多表\nawait gov.fillExcelTemplate(\'tpl.xlsx\', {\n  Sheet1: { A1: \'a\' },\n  数据: { B3: \'b\' }\n}, \'结果.xlsx\');'
            },
            {
                name: 'gov.writeCSV',
                signature: 'gov.writeCSV(filename, data)',
                desc: '将二维数组转为 CSV 并下载（UTF-8 BOM，便于 Excel 打开中文）。',
                example: 'const rows = [[\'a\', \'b\'], [\'1\', \'2\']];\ngov.writeCSV(\'数据.csv\', rows);'
            },
            {
                name: 'gov.writeText',
                signature: 'gov.writeText(filename, content)',
                desc: '将字符串写入纯文本文件并下载。',
                example: 'gov.writeText(\'报告.txt\', \'第一行\\n第二行\');'
            },
            {
                name: 'gov.writeJSON',
                signature: 'gov.writeJSON(filename, data)',
                desc: '将对象或数组格式化为 JSON（缩进 2 空格）并下载。',
                example: 'const rows = await gov.querySQL(\'SELECT id, name FROM t LIMIT 10\');\ngov.writeJSON(\'查询结果.json\', rows);'
            },
            {
                name: 'gov.querySQL',
                signature: 'await gov.querySQL(sql, params?) → [{...}]',
                desc: '对任务关联的数据库执行 SELECT 查询，返回行对象数组。params 为可选参数数组（? 占位符对应）。未关联数据库时抛出错误。',
                example: 'const rows = await gov.querySQL(\'SELECT * FROM users WHERE age > ?\', [18]);\nfor (const row of rows) gov.log(row.name);'
            },
            {
                name: 'gov.executeSQL',
                signature: 'await gov.executeSQL(sql, params?) → number',
                desc: '对任务关联的数据库执行 INSERT/UPDATE/DELETE，返回影响行数。params 为可选参数数组。未关联数据库时抛出错误。',
                example: 'const n = await gov.executeSQL(\n  \'INSERT INTO logs (msg, ts) VALUES (?, ?)\',\n  [\'done\', new Date().toISOString()]\n);\ngov.log(\'写入 \' + n + \' 行\');'
            },
            {
                name: 'gov.querySQLForDb',
                signature: 'await gov.querySQLForDb(databaseId, sql, params?) → [{...}]',
                desc: '对指定数据库（by id）执行 SELECT 查询，可查询任意已配置的数据库，用于跨库操作。',
                example: 'const dbs = gov.getDatabases();\nconst rows = await gov.querySQLForDb(dbs[0].id, \'SELECT count(*) as c FROM orders\');\ngov.log(\'订单数: \' + rows[0].c);'
            },
            {
                name: 'gov.executeSQLForDb',
                signature: 'await gov.executeSQLForDb(databaseId, sql, params?) → number',
                desc: '对指定数据库执行 INSERT/UPDATE/DELETE，可将同一份数据写入多个数据库。',
                example: 'const dbs = gov.getDatabases();\nfor (const db of dbs) {\n  await gov.executeSQLForDb(db.id,\n    \'INSERT INTO sync_log (ts) VALUES (?)\',\n    [Date.now()]\n  );\n}'
            },
            {
                name: 'gov.callAI',
                signature: 'await gov.callAI(prompt) → string',
                desc: '调用 AI 助手（共用 AI 设置中配置的 API URL/Key/模型），发送 prompt 并返回 AI 回复的文本字符串。',
                example: 'const reply = await gov.callAI(\'请将以下内容翻译为英文：\' + text);\ngov.log(reply);'
            }
        ]
    },
    {
        category: '全局变量',
        items: [
            {
                name: 'INPUT_FILE',
                signature: 'INPUT_FILE : File | null',
                desc: '交互任务中用户上传的文件对象（File）。仅当任务输入方式含"文件上传"时有效，否则为 null。',
                example: 'if (INPUT_FILE) {\n  const wb = await gov.readExcel(INPUT_FILE);\n  // ...\n}'
            },
            {
                name: 'INPUT_TEXT',
                signature: 'INPUT_TEXT : string | ""',
                desc: '交互任务中用户输入的文本字符串。仅当任务输入方式含"文本输入"时有效，否则为空字符串。',
                example: 'if (INPUT_TEXT) {\n  const rows = await gov.readCSV(INPUT_TEXT);\n  // ...\n}'
            },
            {
                name: 'INPUT_FILES',
                signature: 'INPUT_FILES : File[]',
                desc: '当任务「多文件执行」为「合并为一次执行」时，为用户上传的全部文件数组；否则与单文件时一致（第一个文件同 INPUT_FILE）。',
                example: 'for (const f of INPUT_FILES) {\n  gov.log(f.name);\n}'
            }
        ]
    },
    {
        category: '内置库',
        items: [
            {
                name: 'XLSX',
                signature: 'XLSX (SheetJS)',
                desc: '完整的 SheetJS 库，用于 Excel 文件读写。常用：XLSX.utils.sheet_to_json、XLSX.utils.json_to_sheet、XLSX.writeFile。导出可直接用 gov.writeExcel（内部调用 XLSX.writeFile）。',
                example: 'const wb = await gov.readExcel(INPUT_FILE);\nconst sheet = wb.Sheets[wb.SheetNames[0]];\n// 带表头的对象数组\nconst data = XLSX.utils.sheet_to_json(sheet);\n// 原始二维数组\nconst raw = XLSX.utils.sheet_to_json(sheet, { header: 1 });\n// 或导出：gov.writeExcel(\'out.xlsx\', raw);'
            },
            {
                name: 'Papa',
                signature: 'Papa (PapaParse)',
                desc: 'CSV 解析库。Papa.parse(text, options) 解析 CSV 文本，返回 { data, errors, meta }。',
                example: '// 带表头，返回对象数组\nconst result = Papa.parse(INPUT_TEXT, { header: true });\nfor (const row of result.data) gov.log(row.name);\n\n// 不带表头，返回二维数组\nconst raw = Papa.parse(INPUT_TEXT, { header: false }).data;'
            },
            {
                name: 'mammoth',
                signature: 'mammoth',
                desc: 'Word 文档处理库。mammoth.extractRawText({ arrayBuffer }) 提取 .docx 纯文本，convertToHtml 转为 HTML。gov.readWord 已封装常用用法。',
                example: '// gov.readWord 已封装，直接使用：\nconst result = await gov.readWord(INPUT_FILE);\ngov.log(result.value); // 纯文本'
            },
            {
                name: 'PizZip',
                signature: 'PizZip',
                desc: '读写 docx 的 zip 结构。gov.fillWordTemplate 已封装；也可在任务代码中直接 new PizZip(arrayBuffer) 做自定义处理。',
                example: 'const zip = new PizZip(buf);'
            },
            {
                name: 'Docxtemplater',
                signature: 'Docxtemplater',
                desc: 'Word 模板占位符替换。gov.fillWordTemplate 已封装；也可 new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true }) 后 setData、render、getZip().generate。',
                example: 'const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });\ndoc.setData({ name: \'x\' });\ndoc.render();'
            }
        ]
    }
];

/** 治理任务函数说明（与 GOV_API_DOCS 相同，供帮助面板与检索） */
const governanceFunctions = GOV_API_DOCS;

function openGovApiHelp() {
    const modal = document.getElementById('govApiHelpModal');
    modal.style.display = 'flex';
    document.getElementById('govApiSearchInput').value = '';
    renderGovApiDocs('');
    setTimeout(() => document.getElementById('govApiSearchInput').focus(), 100);
}

function closeGovApiHelp() {
    document.getElementById('govApiHelpModal').style.display = 'none';
}

function filterGovApiHelp(query) {
    renderGovApiDocs(query.trim().toLowerCase());
}

function renderGovApiDocs(query) {
    const body = document.getElementById('govApiBody');
    let html = '';
    for (const cat of governanceFunctions) {
        const items = cat.items.filter(item =>
            !query ||
            item.name.toLowerCase().includes(query) ||
            item.signature.toLowerCase().includes(query) ||
            item.desc.toLowerCase().includes(query) ||
            item.example.toLowerCase().includes(query)
        );
        if (!items.length) continue;
        html += `<div class="gov-api-category"><h3>${escapeHtml(cat.category)}</h3>`;
        for (const item of items) {
            html += `
            <div class="gov-api-item">
                <div class="gov-api-sig"><code>${escapeHtml(item.signature)}</code></div>
                <div class="gov-api-desc">${escapeHtml(item.desc)}</div>
                <pre class="gov-api-example">${escapeHtml(item.example)}</pre>
            </div>`;
        }
        html += '</div>';
    }
    if (!html) html = '<div style="color:#888;padding:24px;text-align:center;">未找到匹配的 API</div>';
    body.innerHTML = html;
}

// ============================================================
// 本体论抽象模块 - 知识图谱可视化
// ============================================================

// ---- 状态 ----
let ontoData = null;
let ontoSimulation = null;
let ontoInsightExpanded = true;
let ontoSelectedDbId = null;
let ontoGraphViewMode = '2d';
let ontoThreeState = null;

// ---- 颜色与配置 ----
const ONTO_COLORS = {
    entity:    { fill: '#4ECDC4', dark: '#2aa59e', emoji: '📦' },
    event:     { fill: '#FF6B6B', dark: '#cc4444', emoji: '⚡' },
    concept:   { fill: '#A29BFE', dark: '#7c73e6', emoji: '💡' },
    rule:      { fill: '#55EFC4', dark: '#2ecc97', emoji: '📋' },
    conflict:  { fill: '#E17055', dark: '#b5503a', emoji: '⚠️' },
    attribute: { fill: '#FDCB6E', dark: '#d4a224', emoji: '🏷️' },
};

const ONTO_CATEGORY_LABELS = {
    entity: '实体', event: '事件', concept: '概念',
    rule: '规则', conflict: '冲突', attribute: '属性',
};

// ---- 演示数据 — 企业电商平台场景 ----
const DEMO_ONTOLOGY = {
    concepts: [
        { id: 'customer', label: '客户', category: 'entity', importance: 0.95,
          description: '代表系统中的终端消费者或企业采购方，是所有业务关系的核心主体。对应数据库 users 表和 customers 表（存在命名冲突）。',
          tables: ['users', 'customers'],
          attributes: ['id','name','email','phone','address','created_at'],
          governance_issues: ['users表与customers表语义重叠', '个人信息字段缺少脱敏标注'] },
        { id: 'order', label: '订单', category: 'entity', importance: 0.90,
          description: '记录客户购买行为的核心交易实体，承载商品、价格、状态等关键业务数据。是支付和物流的触发器。',
          tables: ['orders','order_items'], attributes: ['order_id','total_amount','status','created_at'], governance_issues: [] },
        { id: 'product', label: '商品', category: 'entity', importance: 0.85,
          description: '系统销售的商品实体，包含价格、库存关联、分类等属性。价格字段在多处存储，存在一致性风险。',
          tables: ['products','product_variants'], attributes: ['product_id','name','price','sku','status'],
          governance_issues: ['价格字段类型不一致（decimal vs float）', '商品信息分散在多表'] },
        { id: 'inventory', label: '库存', category: 'entity', importance: 0.75,
          description: '实时追踪商品库存数量和仓库位置，是供应链管理的关键数据资产。',
          tables: ['inventory','warehouse_stock'], attributes: ['sku','quantity','warehouse_id','updated_at'], governance_issues: [] },
        { id: 'payment', label: '支付', category: 'entity', importance: 0.80,
          description: '记录订单支付信息的实体，包含支付渠道、金额、状态等敏感财务数据。需满足金融监管合规要求。',
          tables: ['payments','payment_logs'], attributes: ['payment_id','amount','channel','status','transaction_id'],
          governance_issues: ['支付敏感信息需加密存储', '缺少支付流水审计日志'] },
        { id: 'logistics', label: '物流', category: 'entity', importance: 0.70,
          description: '追踪订单配送状态和路径的实体，连接仓储与终端客户，是售后服务的数据基础。',
          tables: ['shipments','tracking_events'], attributes: ['tracking_no','carrier','status','estimated_delivery'], governance_issues: [] },
        { id: 'cart', label: '购物车', category: 'event', importance: 0.60,
          description: '记录客户加购意向的临时状态实体，是订单生成前的前置业务事件，反映用户购买意图。',
          tables: ['shopping_carts','cart_items'], attributes: ['cart_id','customer_id','items','total'], governance_issues: [] },
        { id: 'review', label: '商品评价', category: 'event', importance: 0.50,
          description: '客户对购买商品的反馈事件，包含评分和文字描述，直接影响商品排序权重和选品决策。',
          tables: ['reviews','review_images'], attributes: ['review_id','rating','content','created_at'], governance_issues: [] },
        { id: 'coupon', label: '优惠券', category: 'concept', importance: 0.55,
          description: '营销促销工具，定义折扣规则和使用条件，影响订单最终价格计算逻辑，与财务对账强关联。',
          tables: ['coupons','coupon_usage'], attributes: ['code','discount_type','value','conditions'], governance_issues: [] },
        { id: 'category', label: '商品分类', category: 'concept', importance: 0.60,
          description: '商品的层级分类体系，支持多级嵌套，是商品检索、推荐算法和运营管理的基础数据结构。',
          tables: ['categories'], attributes: ['category_id','name','parent_id','path'], governance_issues: [] },
        { id: 'loyalty', label: '会员等级', category: 'rule', importance: 0.50,
          description: '定义客户等级晋升阈值和权益体系的业务规则实体，决定差异化服务策略和折扣体系。',
          tables: ['membership_rules','customer_loyalty'], attributes: ['level','threshold','benefits','discount_rate'], governance_issues: [] },
        { id: 'risk_naming', label: '命名冲突', category: 'conflict', importance: 0.90,
          description: '⚠️ 严重治理问题：users 表与 customers 表在业务语义上均代表"客户"，命名不一致导致跨系统数据整合困难，增加开发维护成本，建议统一命名规范。',
          tables: ['users','customers'], attributes: [], governance_issues: ['需要数据模型标准化', '影响跨域数据集成'] },
    ],
    relations: [
        { source: 'customer', target: 'order', label: '下单', type: 'has-many', description: '一个客户可以创建多个订单，体现购买行为的主要业务路径。' },
        { source: 'order', target: 'product', label: '包含', type: 'many-to-many', description: '订单通过订单明细关联商品，支持一单多品。' },
        { source: 'order', target: 'payment', label: '触发支付', type: 'has-one', description: '每个订单对应一次主要支付记录，支付成功后订单状态更新。' },
        { source: 'order', target: 'logistics', label: '生成物流', type: 'has-one', description: '支付完成后自动生成物流配送单，触发仓库发货流程。' },
        { source: 'customer', target: 'cart', label: '创建', type: 'has-many', description: '客户可以有多个购物车（多设备场景），体现购买意图。' },
        { source: 'cart', target: 'product', label: '加入', type: 'many-to-many', description: '购物车中可加入多种商品，记录用户选品偏好。' },
        { source: 'product', target: 'inventory', label: '关联库存', type: 'has-one', description: '每个SKU对应唯一库存记录，下单后自动扣减库存。' },
        { source: 'product', target: 'category', label: '属于', type: 'many-to-one', description: '商品归属于特定分类层级，支持多级分类结构。' },
        { source: 'customer', target: 'review', label: '提交评价', type: 'has-many', description: '客户可对购买的商品提交评价，影响商品声誉评分。' },
        { source: 'review', target: 'product', label: '针对', type: 'many-to-one', description: '每条评价与特定商品绑定。' },
        { source: 'customer', target: 'coupon', label: '持有', type: 'has-many', description: '营销活动向符合条件的客户发放优惠券。' },
        { source: 'order', target: 'coupon', label: '使用', type: 'many-to-one', description: '订单结算时可核销一张优惠券，影响最终支付金额。' },
        { source: 'customer', target: 'loyalty', label: '适用规则', type: 'has-one', description: '客户等级由会员积分规则动态决定，影响服务差异化。' },
        { source: 'risk_naming', target: 'customer', label: '影响', type: 'conflict', description: '命名冲突直接影响客户实体的数据一致性和可信度。' },
    ],
    insights: [
        { type: 'conflict', title: '实体命名冲突', severity: 'high', affectedConcepts: ['customer','risk_naming'],
          description: 'users 表与 customers 表语义重叠，跨系统整合困难，建议统一为 customer 概念，制定命名规范。' },
        { type: 'quality', title: '价格字段类型不一致', severity: 'high', affectedConcepts: ['product','order'],
          description: 'products.price 使用 float，order_items.unit_price 使用 decimal，可能导致精度丢失和财务计算错误。' },
        { type: 'governance', title: '个人信息缺少脱敏标注', severity: 'medium', affectedConcepts: ['customer'],
          description: '客户实体包含手机号、邮箱等敏感信息，字段未标注脱敏级别，存在个人隐私合规风险（GDPR/个人信息保护法）。' },
        { type: 'missing', title: '物流与商品未直接关联', severity: 'medium', affectedConcepts: ['logistics','product'],
          description: '物流信息无法直接追溯到具体商品，退换货场景下的链路追溯存在断点，建议增加关联关系。' },
        { type: 'governance', title: '支付审计日志缺失', severity: 'medium', affectedConcepts: ['payment'],
          description: '支付实体缺少操作变更记录，无法满足金融监管对支付流水完整性的审计要求。' },
        { type: 'quality', title: '识别12个核心业务概念', severity: 'info', affectedConcepts: [],
          description: 'AI从数据库结构中识别出客户、订单、商品等12个核心业务实体，共14条语义关联关系，构建了完整的电商领域知识图谱。' },
    ],
};

// ---- 节点半径 ----
function ontoNodeRadius(d) {
    return 18 + (d.importance || 0.5) * 16;
}

function ontoNodeRadius3D(d) {
    return (ontoNodeRadius(d) / 14) * 0.85;
}

function syncOntologyViewToggleUI() {
    const b2 = document.getElementById('ontoView2dBtn');
    const b3 = document.getElementById('ontoView3dBtn');
    if (b2) b2.classList.toggle('active', ontoGraphViewMode === '2d');
    if (b3) b3.classList.toggle('active', ontoGraphViewMode === '3d');
}

function setOntologyGraphView(mode) {
    ontoGraphViewMode = mode === '3d' ? '3d' : '2d';
    syncOntologyViewToggleUI();
    if (ontoData) renderOntologyGraph(ontoData, false);
}

function disposeOntologyGraph3D() {
    if (!ontoThreeState) return;
    const st = ontoThreeState;
    if (st.raf) cancelAnimationFrame(st.raf);
    if (st.onResize) window.removeEventListener('resize', st.onResize);
    const domEl = st.renderer && st.renderer.domElement;
    if (domEl && st._pickDown) domEl.removeEventListener('mousedown', st._pickDown);
    if (domEl && st._pickUp) domEl.removeEventListener('mouseup', st._pickUp);
    if (st.controls) {
        if (typeof st.controls.dispose === 'function') st.controls.dispose();
    }
    if (st.sharedSphereGeom) st.sharedSphereGeom.dispose();
    if (st.meshes) {
        st.meshes.forEach(({ mesh }) => {
            if (mesh.material) mesh.material.dispose();
        });
    }
    if (st.lineBundles) {
        st.lineBundles.forEach(b => {
            if (b.glowGeo) b.glowGeo.dispose();
            if (b.dashGeo) b.dashGeo.dispose();
            if (b.glowMat) b.glowMat.dispose();
            if (b.dashMat) b.dashMat.dispose();
        });
    }
    if (st.renderer) {
        st.renderer.dispose();
        if (st.renderer.domElement && st.renderer.domElement.parentNode) {
            st.renderer.domElement.parentNode.removeChild(st.renderer.domElement);
        }
    }
    ontoThreeState = null;
}

/** 简单 3D 力导向一步：斥力 + 弹簧边 + 质心引力 + 阻尼 */
function ontoForceLayout3DStep(nodes, links, opts) {
    const repulsion = opts.repulsion ?? 1200;
    const attraction = opts.attraction ?? 0.06;
    const centerGrav = opts.centerGrav ?? 0.018;
    const damping = opts.damping ?? 0.88;
    const dt = opts.dt ?? 0.45;
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
        nodes[i].ax = 0;
        nodes[i].ay = 0;
        nodes[i].az = 0;
    }
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            let dx = nodes[j].x - nodes[i].x;
            let dy = nodes[j].y - nodes[i].y;
            let dz = nodes[j].z - nodes[i].z;
            let distSq = dx * dx + dy * dy + dz * dz;
            const dist = Math.sqrt(distSq) || 0.01;
            const f = repulsion / distSq;
            dx /= dist;
            dy /= dist;
            dz /= dist;
            nodes[i].ax -= f * dx;
            nodes[i].ay -= f * dy;
            nodes[i].az -= f * dz;
            nodes[j].ax += f * dx;
            nodes[j].ay += f * dy;
            nodes[j].az += f * dz;
        }
    }
    for (let li = 0; li < links.length; li++) {
        const l = links[li];
        const a = l.source;
        const b = l.target;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dz = b.z - a.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
        dx /= dist;
        dy /= dist;
        dz /= dist;
        const ideal = l.idealLength ?? 7;
        const f = (dist - ideal) * attraction;
        a.ax += f * dx;
        a.ay += f * dy;
        a.az += f * dz;
        b.ax -= f * dx;
        b.ay -= f * dy;
        b.az -= f * dz;
    }
    for (let i = 0; i < n; i++) {
        const p = nodes[i];
        p.ax -= p.x * centerGrav;
        p.ay -= p.y * centerGrav;
        p.az -= p.z * centerGrav;
        p.vx = (p.vx + p.ax * dt) * damping;
        p.vy = (p.vy + p.ay * dt) * damping;
        p.vz = (p.vz + p.az * dt) * damping;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
    }
}

function createOntoOrbitControls(camera, domElement) {
    if (typeof THREE === 'undefined') return null;
    const OC = THREE.OrbitControls || (typeof OrbitControls !== 'undefined' ? OrbitControls : null);
    if (OC) {
        const c = new OC(camera, domElement);
        c.enableDamping = true;
        c.dampingFactor = 0.06;
        c.minDistance = 8;
        c.maxDistance = 120;
        return c;
    }
    const target = new THREE.Vector3(0, 0, 0);
    let radius = 42;
    let phi = Math.acos(0.45);
    let theta = 0.55;
    function updateCam() {
        const sp = Math.sin(phi);
        camera.position.set(
            target.x + radius * sp * Math.cos(theta),
            target.y + radius * Math.cos(phi),
            target.z + radius * sp * Math.sin(theta)
        );
        camera.lookAt(target);
    }
    updateCam();
    let down = false;
    let lx = 0;
    let ly = 0;
    const onDown = e => { down = true; lx = e.clientX; ly = e.clientY; };
    const onMove = e => {
        if (!down) return;
        theta += (e.clientX - lx) * 0.01;
        phi += (e.clientY - ly) * 0.01;
        phi = Math.max(0.12, Math.min(Math.PI - 0.12, phi));
        lx = e.clientX;
        ly = e.clientY;
        updateCam();
    };
    const onUp = () => { down = false; };
    const onWheel = e => {
        e.preventDefault();
        radius *= 1 + e.deltaY * 0.0012;
        radius = Math.max(8, Math.min(140, radius));
        updateCam();
    };
    domElement.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    domElement.addEventListener('wheel', onWheel, { passive: false });
    return {
        target,
        update: () => {},
        dispose: () => {
            domElement.removeEventListener('mousedown', onDown);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            domElement.removeEventListener('wheel', onWheel);
        },
    };
}

/**
 * Three.js 3D 力导向知识图谱（复用 ontoData / ONTO_COLORS）
 */
function renderOntologyGraph3D(data, animate) {
    if (typeof THREE === 'undefined') return;
    disposeOntologyGraph3D();

    const container = document.getElementById('ontoGraph3d');
    if (!container) return;

    const W = container.clientWidth || 800;
    const H = container.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0d1020, 0.012);

    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 500);
    camera.position.set(0, 6, 38);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x0d1020, 1);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x6a7ba8, 0.35));
    const dir = new THREE.DirectionalLight(0xffffff, 0.55);
    dir.position.set(12, 24, 20);
    scene.add(dir);
    const pt = new THREE.PointLight(0x8899ff, 0.4, 80);
    pt.position.set(-10, 10, 10);
    scene.add(pt);

    const nodes = (data.concepts || []).map(c => ({
        ...c,
        x: (Math.random() - 0.5) * 22,
        y: (Math.random() - 0.5) * 18,
        z: (Math.random() - 0.5) * 22,
        vx: 0,
        vy: 0,
        vz: 0,
    }));
    const nodeById = {};
    nodes.forEach(n => { nodeById[n.id] = n; });
    const links = (data.relations || [])
        .filter(r => nodeById[r.source] && nodeById[r.target])
        .map(r => ({
            ...r,
            source: nodeById[r.source],
            target: nodeById[r.target],
            idealLength: r.type === 'conflict' ? 5.5 : 8.2,
        }));

    for (let s = 0; s < 140; s++) {
        ontoForceLayout3DStep(nodes, links, { repulsion: 1400, attraction: 0.07, damping: 0.9, dt: 0.38 });
    }

    const meshes = [];
    const sphereGeomShared = new THREE.SphereGeometry(1, 28, 28);
    nodes.forEach((d, idx) => {
        const cfg = ONTO_COLORS[d.category] || ONTO_COLORS.entity;
        const col = new THREE.Color(cfg.fill);
        const mat = new THREE.MeshStandardMaterial({
            color: col,
            emissive: col,
            emissiveIntensity: 0.32,
            metalness: 0.25,
            roughness: 0.42,
        });
        const mesh = new THREE.Mesh(sphereGeomShared, mat);
        const r = ontoNodeRadius3D(d);
        mesh.scale.setScalar(r);
        mesh.position.set(d.x, d.y, d.z);
        mesh.userData.ontoId = d.id;
        mesh.userData.phase = idx * 0.73;
        scene.add(mesh);
        meshes.push({ mesh, data: d, baseR: r });
    });

    const lineBundles = [];
    links.forEach(l => {
        const isConflict = l.type === 'conflict';
        const cGlow = new THREE.Color(isConflict ? 0xe17055 : 0x8899ff);
        const glowGeo = new THREE.BufferGeometry();
        const glowPos = new Float32Array(6);
        glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
        const glowMat = new THREE.LineBasicMaterial({
            color: cGlow,
            transparent: true,
            opacity: isConflict ? 0.55 : 0.38,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const glowLine = new THREE.Line(glowGeo, glowMat);
        scene.add(glowLine);

        const dashGeo = new THREE.BufferGeometry();
        const dashPos = new Float32Array(6);
        dashGeo.setAttribute('position', new THREE.BufferAttribute(dashPos, 3));
        const dashMat = new THREE.LineDashedMaterial({
            color: isConflict ? 0xff8a70 : 0xb4c4ff,
            dashSize: 0.55,
            gapSize: 0.38,
            transparent: true,
            opacity: 0.92,
        });
        const dashLine = new THREE.Line(dashGeo, dashMat);
        scene.add(dashLine);

        lineBundles.push({ l, glowGeo, dashGeo, glowMat, dashMat, glowLine, dashLine });
    });

    const controls = createOntoOrbitControls(camera, renderer.domElement);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pickDownX = 0;
    let pickDownY = 0;

    const st = {
        raf: null,
        renderer,
        scene,
        camera,
        controls,
        meshes,
        lineBundles,
        nodes,
        links,
        selectedId: null,
        clock: new THREE.Clock(),
        timeEnter: performance.now(),
        sharedSphereGeom: sphereGeomShared,
        didAnimateEnter: !!animate,
    };
    ontoThreeState = st;

    const onResize = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w < 2 || h < 2) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    };
    st.onResize = onResize;
    window.addEventListener('resize', onResize);

    st._pickDown = e => { pickDownX = e.clientX; pickDownY = e.clientY; };
    st._pickUp = e => {
        if (Math.hypot(e.clientX - pickDownX, e.clientY - pickDownY) > 10) return;
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const objs = meshes.map(m => m.mesh);
        const hits = raycaster.intersectObjects(objs, false);
        if (hits.length) {
            const d = hits[0].object.userData.ontoNodeRef || nodes.find(n => n.id === hits[0].object.userData.ontoId);
            if (d) showNodeDetail(d, nodes, links);
        } else {
            closeNodeDetail();
        }
    };
    renderer.domElement.addEventListener('mousedown', st._pickDown);
    renderer.domElement.addEventListener('mouseup', st._pickUp);

    // 供 raycast 与详情面板使用完整节点、边（与 D3 一致的对象引用）
    meshes.forEach(({ mesh, data }) => {
        mesh.userData.ontoNodeRef = data;
    });

    function animate() {
        st.raf = requestAnimationFrame(animate);
        const t = st.clock.getElapsedTime();
        let enterScale = 1;
        if (st.didAnimateEnter) {
            const u = Math.min(1, (performance.now() - st.timeEnter) / 880);
            enterScale = 0.04 + (1 - 0.04) * (1 - Math.pow(1 - u, 3));
            if (u >= 1) st.didAnimateEnter = false;
        }

        ontoForceLayout3DStep(nodes, links, { repulsion: 320, attraction: 0.035, damping: 0.92, dt: 0.28 });

        meshes.forEach(({ mesh, data, baseR }) => {
            const phase = mesh.userData.phase || 0;
            const hover = Math.sin(t * 1.6 + phase) * 0.22;
            mesh.position.set(data.x, data.y + hover, data.z);
            const sel = st.selectedId && data.id === st.selectedId;
            mesh.material.emissiveIntensity = sel ? 0.72 : 0.3 + Math.sin(t * 2.2 + phase) * 0.06;
            const pulse = sel ? 1.14 : 1 + Math.sin(t * 1.9 + phase) * 0.04;
            mesh.scale.setScalar(baseR * pulse * enterScale);
        });

        lineBundles.forEach(b => {
            const a = b.l.source;
            const bnode = b.l.target;
            const tA = meshes.find(m => m.data.id === a.id);
            const tB = meshes.find(m => m.data.id === bnode.id);
            if (!tA || !tB) return;
            const ax = tA.mesh.position.x;
            const ay = tA.mesh.position.y;
            const az = tA.mesh.position.z;
            const bx = tB.mesh.position.x;
            const by = tB.mesh.position.y;
            const bz = tB.mesh.position.z;
            const arrG = b.glowGeo.attributes.position.array;
            arrG[0] = ax;
            arrG[1] = ay;
            arrG[2] = az;
            arrG[3] = bx;
            arrG[4] = by;
            arrG[5] = bz;
            b.glowGeo.attributes.position.needsUpdate = true;
            const arrD = b.dashGeo.attributes.position.array;
            arrD.set(arrG);
            b.dashGeo.attributes.position.needsUpdate = true;
            b.dashLine.computeLineDistances();
            b.dashMat.dashOffset -= 0.045;
        });

        if (controls && controls.update) controls.update();
        renderer.render(scene, camera);
    }

    animate();
}

// ---- 初始化/渲染知识图谱 ----
function renderOntologyGraph(data, animate) {
    if (!data) return;
    ontoData = data;

    const svgEl = document.getElementById('ontoSvg');
    if (!svgEl) return;

    // 隐藏欢迎界面
    document.getElementById('ontoWelcome').style.display = 'none';

    const viewToggle = document.getElementById('ontoViewToggle');
    const viewSep = document.getElementById('ontoViewToggleSep');
    if (viewToggle) viewToggle.style.display = 'inline-flex';
    if (viewSep) viewSep.style.display = '';

    if (ontoGraphViewMode === '3d') {
        if (typeof THREE === 'undefined') {
            showOntoToast('⚠️ Three.js 未加载，已切回 2D 视图', true);
            ontoGraphViewMode = '2d';
            syncOntologyViewToggleUI();
        } else {
            if (ontoSimulation) {
                ontoSimulation.stop();
                ontoSimulation = null;
            }
            d3.select('#ontoSvg').selectAll('*').remove();
            svgEl.style.display = 'none';
            const g3 = document.getElementById('ontoGraph3d');
            if (g3) g3.style.display = 'block';
            renderOntologyGraph3D(data, animate);
            document.getElementById('ontoQueryBar').classList.remove('onto-query-disabled');
            document.getElementById('ontoClearBtn').style.display = '';
            updateOntoStats(data);
            renderInsights(data.insights || []);
            return;
        }
    }

    disposeOntologyGraph3D();
    svgEl.style.display = '';
    const g3el = document.getElementById('ontoGraph3d');
    if (g3el) g3el.style.display = 'none';

    const W = svgEl.parentElement.clientWidth;
    const H = svgEl.parentElement.clientHeight;

    // 清空旧内容
    const svg = d3.select('#ontoSvg').attr('width', W).attr('height', H);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');

    // 发光滤镜
    const fGlow = defs.append('filter').attr('id', 'onto-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    fGlow.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '4').attr('result', 'blur');
    const fMerge = fGlow.append('feMerge');
    fMerge.append('feMergeNode').attr('in', 'blur');
    fMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // 强发光 (选中节点)
    const fGlow2 = defs.append('filter').attr('id', 'onto-glow-strong').attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%');
    fGlow2.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '8').attr('result', 'blur');
    const fMerge2 = fGlow2.append('feMerge');
    fMerge2.append('feMergeNode').attr('in', 'blur');
    fMerge2.append('feMergeNode').attr('in', 'SourceGraphic');

    // 箭头
    ['default','conflict'].forEach(t => {
        const m = defs.append('marker').attr('id', `onto-arrow-${t}`)
            .attr('viewBox','0 -5 10 10').attr('refX', 22).attr('refY', 0)
            .attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto');
        m.append('path').attr('d','M0,-5L10,0L0,5')
            .attr('fill', t === 'conflict' ? '#E17055' : 'rgba(160,160,220,0.6)');
    });

    // 放射渐变
    Object.entries(ONTO_COLORS).forEach(([cat, cfg]) => {
        const g = defs.append('radialGradient').attr('id', `onto-grad-${cat}`).attr('cx','35%').attr('cy','35%');
        g.append('stop').attr('offset','0%').attr('stop-color','#fff').attr('stop-opacity', 0.7);
        g.append('stop').attr('offset','100%').attr('stop-color', cfg.fill).attr('stop-opacity', 1);
    });

    // 主 group（支持 zoom/pan）
    const mainG = svg.append('g').attr('class','onto-main');
    const zoom = d3.zoom().scaleExtent([0.25, 4]).on('zoom', e => mainG.attr('transform', e.transform));
    svg.call(zoom).on('dblclick.zoom', null);

    // 数据准备
    const nodes = data.concepts.map(c => ({ ...c, x: W/2 + (Math.random()-0.5)*400, y: H/2 + (Math.random()-0.5)*300 }));
    const nodeById = {};
    nodes.forEach(n => nodeById[n.id] = n);
    const links = (data.relations || []).filter(r => nodeById[r.source] && nodeById[r.target])
        .map(r => ({ ...r, source: nodeById[r.source], target: nodeById[r.target] }));

    // 力模拟
    if (ontoSimulation) ontoSimulation.stop();
    ontoSimulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(d => d.type === 'conflict' ? 100 : 130))
        .force('charge', d3.forceManyBody().strength(d => -250 - (d.importance||0.5)*200))
        .force('center', d3.forceCenter(W/2, H/2))
        .force('collision', d3.forceCollide().radius(d => ontoNodeRadius(d) + 22));

    // 绘制连线
    const linkG = mainG.append('g');
    const linkSel = linkG.selectAll('.onto-link-g').data(links).enter().append('g');
    const linkLine = linkSel.append('line')
        .attr('stroke', d => d.type === 'conflict' ? '#E17055' : 'rgba(160,160,230,0.3)')
        .attr('stroke-width', d => d.type === 'conflict' ? 2.5 : 1.5)
        .attr('stroke-dasharray', d => d.type === 'conflict' ? '8,4' : 'none')
        .attr('marker-end', d => `url(#onto-arrow-${d.type==='conflict'?'conflict':'default'})`);
    const linkLabel = linkSel.append('text').attr('class','onto-link-label')
        .attr('text-anchor','middle').attr('fill','rgba(180,180,220,0.55)').attr('font-size','10px')
        .text(d => d.label);

    // 绘制节点
    const nodeG = mainG.append('g');
    const nodeSel = nodeG.selectAll('.onto-node').data(nodes).enter().append('g').attr('class','onto-node')
        .attr('opacity', animate ? 0 : 1)
        .style('cursor','pointer')
        .call(d3.drag()
            .on('start', (e,d) => { if(!e.active) ontoSimulation.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
            .on('drag',  (e,d) => { d.fx=e.x; d.fy=e.y; })
            .on('end',   (e,d) => { if(!e.active) ontoSimulation.alphaTarget(0); d.fx=null; d.fy=null; })
        )
        .on('click', (e,d) => { e.stopPropagation(); showNodeDetail(d, nodes, links); });

    // 外光晕
    nodeSel.append('circle').attr('class','onto-node-glow')
        .attr('r', d => ontoNodeRadius(d)+10)
        .attr('fill', d => ONTO_COLORS[d.category]?.fill || '#4ECDC4')
        .attr('opacity', 0.12).attr('filter','url(#onto-glow)');

    // 主圆
    nodeSel.append('circle').attr('class','onto-node-circle')
        .attr('r', d => ontoNodeRadius(d))
        .attr('fill', d => `url(#onto-grad-${d.category})`)
        .attr('stroke', d => ONTO_COLORS[d.category]?.fill || '#4ECDC4')
        .attr('stroke-width', 2).attr('filter','url(#onto-glow)');

    // emoji 图标
    nodeSel.append('text').attr('text-anchor','middle').attr('dominant-baseline','central')
        .attr('font-size', d => Math.round(ontoNodeRadius(d)*0.75)+'px')
        .attr('pointer-events','none').text(d => ONTO_COLORS[d.category]?.emoji || '📦');

    // 标签
    nodeSel.append('text').attr('class','onto-node-label').attr('text-anchor','middle')
        .attr('dy', d => ontoNodeRadius(d)+16+'px')
        .attr('fill','#e2e8f0').attr('font-size','12px').attr('font-weight','600')
        .attr('pointer-events','none').text(d => d.label);

    // 入场动画
    if (animate) {
        nodeSel.each(function(d, i) {
            d3.select(this).transition().delay(i * 80).duration(500)
                .attr('opacity', 1).ease(d3.easeBackOut.overshoot(1.4));
        });
    }

    // tick
    ontoSimulation.on('tick', () => {
        linkLine.attr('x1', d=>d.source.x).attr('y1', d=>d.source.y)
                .attr('x2', d=>d.target.x).attr('y2', d=>d.target.y);
        linkLabel.attr('x', d=>(d.source.x+d.target.x)/2).attr('y', d=>(d.source.y+d.target.y)/2-4);
        nodeSel.attr('transform', d=>`translate(${d.x},${d.y})`);
    });

    // 点击空白取消选中
    svg.on('click', () => closeNodeDetail());

    // 启用查询栏 & 更新统计
    document.getElementById('ontoQueryBar').classList.remove('onto-query-disabled');
    document.getElementById('ontoClearBtn').style.display = '';
    updateOntoStats(data);
    renderInsights(data.insights || []);
}

// ---- 更新统计数字 ----
function updateOntoStats(data) {
    const risks = (data.insights || []).filter(i => i.severity === 'high' || i.severity === 'medium').length;
    animateCounter('ontoStatConcepts', (data.concepts || []).length);
    animateCounter('ontoStatRelations', (data.relations || []).length);
    animateCounter('ontoStatRisks', risks);
}

function animateCounter(elId, target) {
    const el = document.getElementById(elId);
    if (!el) return;
    let cur = 0;
    const step = Math.ceil(target / 20);
    const t = setInterval(() => {
        cur = Math.min(cur + step, target);
        el.textContent = cur;
        if (cur >= target) clearInterval(t);
    }, 40);
}

// ---- 渲染洞察面板 ----
function renderInsights(insights) {
    const body = document.getElementById('ontoInsightBody');
    if (!insights || insights.length === 0) {
        body.innerHTML = '<div class="onto-insight-placeholder"><span>💡</span><p>暂无洞察</p></div>';
        return;
    }
    const iconMap = { conflict: '🔴', quality: '🟡', governance: '🔵', missing: '🟠', performance: '⚡', info: '✅' };
    body.innerHTML = insights.map((ins, i) => `
        <div class="onto-insight-card ${ins.severity}" style="animation-delay:${i*0.08}s" onclick="highlightInsight(${i})">
            <div class="onto-insight-title">
                ${iconMap[ins.type]||'💡'} ${ins.title}
                <span class="onto-insight-badge ${ins.severity}">${ins.severity === 'high' ? '严重' : ins.severity === 'medium' ? '中' : ins.severity === 'low' ? '低' : '信息'}</span>
            </div>
            <div class="onto-insight-desc">${ins.description}</div>
        </div>`).join('');
}

// ---- 高亮洞察相关节点 ----
function highlightInsight(idx) {
    if (!ontoData || !ontoData.insights[idx]) return;
    const ins = ontoData.insights[idx];
    const affected = new Set(ins.affectedConcepts || []);
    if (affected.size === 0) return;
    d3.selectAll('.onto-node').each(function(d) {
        const active = affected.has(d.id);
        d3.select(this).select('.onto-node-circle')
            .transition().duration(300)
            .attr('filter', active ? 'url(#onto-glow-strong)' : 'url(#onto-glow)')
            .attr('stroke-width', active ? 3.5 : 2)
            .attr('opacity', active ? 1 : 0.45);
        d3.select(this).select('.onto-node-glow')
            .transition().duration(300).attr('opacity', active ? 0.35 : 0.1);
    });
    setTimeout(() => {
        d3.selectAll('.onto-node .onto-node-circle')
            .transition().duration(400).attr('stroke-width', 2).attr('opacity', 1).attr('filter','url(#onto-glow)');
        d3.selectAll('.onto-node .onto-node-glow').transition().duration(400).attr('opacity', 0.12);
    }, 2500);
}

// ---- 节点详情 ----
function showNodeDetail(d, nodes, links) {
    if (ontoGraphViewMode === '3d' && ontoThreeState) ontoThreeState.selectedId = d.id;

    const popup = document.getElementById('ontoNodePopup');
    const badge = document.getElementById('ontoPopupBadge');
    const title = document.getElementById('ontoPopupTitle');
    const body  = document.getElementById('ontoPopupBody');

    const cfg = ONTO_COLORS[d.category] || ONTO_COLORS.entity;
    badge.textContent = ONTO_CATEGORY_LABELS[d.category] || d.category;
    badge.style.cssText = `background:${cfg.fill}22;color:${cfg.fill};border:1px solid ${cfg.fill}66`;
    title.textContent = d.label;

    // 计算连接的节点
    const connected = [];
    if (links) {
        links.forEach(l => {
            const src = l.source.id || l.source;
            const tgt = l.target.id || l.target;
            if (src === d.id) connected.push({ label: l.label, direction: '→', name: (l.target.label || l.target) });
            else if (tgt === d.id) connected.push({ label: l.label, direction: '←', name: (l.source.label || l.source) });
        });
    }

    let html = '';
    if (d.description) {
        html += `<div class="onto-popup-section">
            <div class="onto-popup-section-label">语义描述</div>
            <div class="onto-popup-desc">${d.description}</div>
        </div>`;
    }
    if (d.tables && d.tables.length) {
        html += `<div class="onto-popup-section">
            <div class="onto-popup-section-label">关联数据表</div>
            <div class="onto-popup-tags">${d.tables.map(t=>`<span class="onto-tag">${t}</span>`).join('')}</div>
        </div>`;
    }
    if (d.attributes && d.attributes.length) {
        html += `<div class="onto-popup-section">
            <div class="onto-popup-section-label">核心字段</div>
            <div class="onto-popup-tags">${d.attributes.map(a=>`<span class="onto-tag">${a}</span>`).join('')}</div>
        </div>`;
    }
    if (connected.length) {
        html += `<div class="onto-popup-section">
            <div class="onto-popup-section-label">关联关系 (${connected.length})</div>
            <div class="onto-popup-tags">${connected.map(c=>`<span class="onto-tag">${c.direction} ${c.label} ${c.name}</span>`).join('')}</div>
        </div>`;
    }
    if (d.governance_issues && d.governance_issues.length) {
        html += `<div class="onto-popup-section">
            <div class="onto-popup-section-label">⚠️ 治理问题</div>
            <div class="onto-popup-tags">${d.governance_issues.map(g=>`<span class="onto-tag issue">${g}</span>`).join('')}</div>
        </div>`;
    }
    body.innerHTML = html || '<div class="onto-popup-desc" style="color:#6e7681">暂无详细信息</div>';

    popup.style.display = '';

    // 高亮当前节点（仅 2D SVG）
    if (ontoGraphViewMode === '2d' && document.querySelector('.onto-node')) {
        d3.selectAll('.onto-node').each(function(nd) {
            const active = nd.id === d.id;
            d3.select(this).select('.onto-node-circle')
                .transition().duration(200)
                .attr('filter', active ? 'url(#onto-glow-strong)' : 'url(#onto-glow)')
                .attr('stroke-width', active ? 4 : 2)
                .attr('opacity', active ? 1 : 0.55);
        });
    }
}

function closeNodeDetail() {
    document.getElementById('ontoNodePopup').style.display = 'none';
    if (ontoThreeState) ontoThreeState.selectedId = null;
    if (ontoGraphViewMode === '2d' && document.querySelector('.onto-node')) {
        d3.selectAll('.onto-node .onto-node-circle')
            .transition().duration(200).attr('stroke-width', 2).attr('opacity', 1).attr('filter','url(#onto-glow)');
    }
}

// ---- 加载演示数据 ----
function loadOntologyDemo() {
    showOntologyLoading('加载演示场景...');
    let progress = 0;
    const steps = ['构建实体本体...', '分析语义关系...', '识别治理风险...', '生成知识图谱...'];
    let si = 0;
    const t = setInterval(() => {
        progress = Math.min(progress + 5, 95);
        document.getElementById('ontoAiProgressBar').style.width = progress + '%';
        if (si < steps.length && progress >= (si + 1) * 20) {
            document.getElementById('ontoAiText').textContent = steps[si++];
        }
    }, 60);
    setTimeout(() => {
        clearInterval(t);
        document.getElementById('ontoAiProgressBar').style.width = '100%';
        setTimeout(() => {
            hideOntologyLoading();
            renderOntologyGraph(DEMO_ONTOLOGY, true);
            showOntoToast('✅ 演示场景已加载：电商平台业务本体图谱（12个概念 · 14条关系 · 5个治理洞察）');
        }, 300);
    }, 1800);
}

// ---- AI 提取 ----
function startOntologyExtract() {
    if (!ontoSelectedDbId) {
        showOntoToast('⚠️ 请先选择要分析的数据库', true);
        return;
    }
    const dbIds = [ontoSelectedDbId];
    showOntologyLoading('AI 正在分析数据库结构...');

    let progress2 = 0;
    const pi2 = setInterval(() => {
        progress2 = Math.min(progress2 + 2, 88);
        document.getElementById('ontoAiProgressBar').style.width = progress2 + '%';
    }, 300);

    fetchWithAuth(`${API_BASE}/api/data-ontology/ontology/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databases: dbIds }),
    }).then(async res => {
        clearInterval(pi2);
        if (res.status === 401) {
            hideOntologyLoading();
            return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop();
            for (const part of parts) {
                const lines = part.split('\n');
                let evType = '', evData = '';
                for (const line of lines) {
                    if (line.startsWith('event:')) evType = line.slice(6).trim();
                    if (line.startsWith('data:')) evData = line.slice(5).trim();
                }
                if (!evType || !evData) continue;
                try { const d = JSON.parse(evData); ontoHandleSSE(evType, d); } catch {}
            }
        }
        hideOntologyLoading();
    }).catch(err => {
        clearInterval(pi2);
        hideOntologyLoading();
        showOntoToast('❌ 连接失败：' + err.message, true);
    });
}

function ontoHandleSSE(type, data) {
    switch (type) {
        case 'onto-start':
        case 'onto-thinking':
            document.getElementById('ontoAiText').textContent = data.message || 'AI 思考中...';
            break;
        case 'onto-result':
            document.getElementById('ontoAiProgressBar').style.width = '100%';
            setTimeout(() => {
                hideOntologyLoading();
                renderOntologyGraph(data, true);
                showOntoToast(`✅ 提取完成：${(data.concepts||[]).length}个概念 · ${(data.relations||[]).length}条关系`);
            }, 400);
            break;
        case 'onto-error':
            hideOntologyLoading();
            showOntoToast('❌ ' + (data.message || '提取失败'), true);
            break;
        case 'onto-done':
            hideOntologyLoading();
            break;
    }
}

// ---- 清空图谱 ----
function clearOntology() {
    if (ontoSimulation) { ontoSimulation.stop(); ontoSimulation = null; }
    disposeOntologyGraph3D();
    ontoData = null;
    d3.select('#ontoSvg').selectAll('*').remove();
    const svgEl = document.getElementById('ontoSvg');
    if (svgEl) svgEl.style.display = '';
    const g3 = document.getElementById('ontoGraph3d');
    if (g3) g3.style.display = 'none';
    const viewToggle = document.getElementById('ontoViewToggle');
    const viewSep = document.getElementById('ontoViewToggleSep');
    if (viewToggle) viewToggle.style.display = 'none';
    if (viewSep) viewSep.style.display = 'none';
    document.getElementById('ontoWelcome').style.display = '';
    document.getElementById('ontoQueryBar').classList.add('onto-query-disabled');
    document.getElementById('ontoClearBtn').style.display = 'none';
    document.getElementById('ontoNodePopup').style.display = 'none';
    document.getElementById('ontoQueryResult').style.display = 'none';
    document.getElementById('ontoInsightBody').innerHTML = '<div class="onto-insight-placeholder"><span>💡</span><p>提取本体后，AI将自动生成数据治理洞察</p></div>';
    ['ontoStatConcepts','ontoStatRelations','ontoStatRisks'].forEach(id => { document.getElementById(id).textContent='0'; });
}

// ---- 语义查询 ----
async function doOntologyQuery() {
    const input = document.getElementById('ontoQueryInput');
    const query = input.value.trim();
    if (!query) return;
    if (!ontoData) { showOntoToast('⚠️ 请先加载或提取本体图谱', true); return; }

    const btn = document.getElementById('ontoQueryBtn');
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> 分析中...';

    const resultEl = document.getElementById('ontoQueryResult');
    resultEl.style.display = '';
    resultEl.innerHTML = '<span style="color:#667eea">🧠 AI正在进行语义推理...</span>';

    try {
        const res = await fetchWithAuth(`${API_BASE}/api/data-ontology/ontology/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, ontology: ontoData }),
        });
        if (res.status === 401) return;
        const data = await res.json();
        if (data.success) {
            // 高亮相关节点
            if (data.highlighted && data.highlighted.length) {
                const set = new Set(data.highlighted);
                d3.selectAll('.onto-node').each(function(d) {
                    const active = set.has(d.id);
                    d3.select(this).select('.onto-node-circle')
                        .transition().duration(300)
                        .attr('filter', active ? 'url(#onto-glow-strong)' : 'url(#onto-glow)')
                        .attr('stroke-width', active ? 4 : 2).attr('opacity', active ? 1 : 0.4);
                });
                setTimeout(() => {
                    d3.selectAll('.onto-node .onto-node-circle')
                        .transition().duration(400).attr('stroke-width', 2).attr('opacity', 1).attr('filter','url(#onto-glow)');
                }, 4000);
            }
            // 格式化回答
            let answer = data.answer || '';
            answer = answer.replace(/【([^】]+)】/g, '<span class="onto-highlight-badge">$1</span>');
            resultEl.innerHTML = answer;
        } else {
            resultEl.innerHTML = `<span style="color:#E17055">❌ ${data.message}</span>`;
        }
    } catch (e) {
        resultEl.innerHTML = `<span style="color:#E17055">❌ 请求失败：${e.message}</span>`;
    }
    btn.disabled = false;
    btn.innerHTML = '<span>🔍</span> 语义分析';
}

// ---- 收起/展开洞察面板 ----
function toggleInsightPanel() {
    ontoInsightExpanded = !ontoInsightExpanded;
    document.getElementById('ontoInsightPanel').classList.toggle('collapsed', !ontoInsightExpanded);
}

// ---- Loading 遮罩 ----
function showOntologyLoading(text) {
    const ov = document.getElementById('ontoAiOverlay');
    document.getElementById('ontoAiText').textContent = text || 'AI 正在分析...';
    document.getElementById('ontoAiProgressBar').style.width = '0%';
    ov.style.display = 'flex';
}

function hideOntologyLoading() {
    document.getElementById('ontoAiOverlay').style.display = 'none';
}

// ---- Toast ----
let ontoToastTimer = null;
function showOntoToast(msg, isError) {
    if (ontoToastTimer) clearTimeout(ontoToastTimer);
    const old = document.querySelector('.onto-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'onto-toast';
    el.style.cssText = isError ? 'border-color:#fed7d7;color:#c53030' : '';
    el.textContent = msg;
    document.body.appendChild(el);
    ontoToastTimer = setTimeout(() => el.remove(), 3500);
}

// ---- 数据库类型图标 ----
const DB_TYPE_ICONS = {
    mysql: '🐬', postgresql: '🐘', oracle: '🔴', mssql: '🪟', mongodb: '🍃',
    dm: '🇨🇳', sqlite: '📁', duckdb: '🦆', clickhouse: '⚡', neo4j: '🕸️',
};

function getDbIcon(type) {
    return DB_TYPE_ICONS[(type||'').toLowerCase()] || '🗄️';
}

// ---- 自定义下拉：开关 ----
function toggleDbPicker(e) {
    e.stopPropagation();
    const dd = document.getElementById('ontoDbDropdown');
    const btn = document.getElementById('ontoDbBtn');
    const isOpen = dd.classList.contains('open');
    dd.classList.toggle('open', !isOpen);
    btn.classList.toggle('active', !isOpen);
}

// ---- 自定义下拉：选择某个数据库 ----
function selectOntologyDb(dbId, dbName, dbType) {
    ontoSelectedDbId = dbId;
    const textEl = document.getElementById('ontoDbBtnText');
    textEl.textContent = `${getDbIcon(dbType)} ${dbName}`;
    textEl.classList.remove('placeholder');
    // 更新选中状态
    document.querySelectorAll('.onto-db-option').forEach(el => {
        const isSelected = el.dataset.dbId === dbId;
        el.classList.toggle('selected', isSelected);
        const check = el.querySelector('.onto-db-option-check');
        if (check) check.style.display = isSelected ? '' : 'none';
    });
    // 关闭下拉
    document.getElementById('ontoDbDropdown').classList.remove('open');
    document.getElementById('ontoDbBtn').classList.remove('active');
}

// 点击外部关闭下拉
document.addEventListener('click', () => {
    const dd = document.getElementById('ontoDbDropdown');
    const btn = document.getElementById('ontoDbBtn');
    if (dd) dd.classList.remove('open');
    if (btn) btn.classList.remove('active');
    const ldd = document.getElementById('lineageDbDropdown');
    const lbtn = document.getElementById('lineageDbBtn');
    if (ldd) ldd.classList.remove('open');
    if (lbtn) lbtn.classList.remove('active');
});

// ---- 初始化：本体论 tab 激活时同步数据库列表 ----
function initOntologyTab() {
    const dropdown = document.getElementById('ontoDbDropdown');
    const emptyEl  = document.getElementById('ontoDbDropdownEmpty');
    if (!dropdown) return;

    // 清空旧选项
    dropdown.querySelectorAll('.onto-db-option').forEach(el => el.remove());

    if (databases.length === 0) {
        if (emptyEl) emptyEl.style.display = '';
    } else {
        if (emptyEl) emptyEl.style.display = 'none';
        databases.forEach(db => {
            const item = document.createElement('div');
            item.className = 'onto-db-option';
            item.dataset.dbId = db.id;
            const isSelected = db.id === ontoSelectedDbId;
            if (isSelected) item.classList.add('selected');
            item.innerHTML = `
                <span class="onto-db-option-icon">${getDbIcon(db.type)}</span>
                <span class="onto-db-option-info">
                    <span class="onto-db-option-name">${db.name}</span>
                    <span class="onto-db-option-type">${db.type || 'unknown'}</span>
                </span>
                <span class="onto-db-option-check" style="display:${isSelected ? '' : 'none'}">✓</span>`;
            item.onclick = (e) => {
                e.stopPropagation();
                selectOntologyDb(db.id, db.name, db.type);
            };
            dropdown.appendChild(item);
        });
        // 若之前已选，文本保持
        if (!ontoSelectedDbId) {
            const textEl = document.getElementById('ontoDbBtnText');
            if (textEl) { textEl.textContent = '选择数据库'; textEl.classList.add('placeholder'); }
        }
    }

    // resize 时重绘（只注册一次）
    if (!window._ontoResizeRegistered) {
        window._ontoResizeRegistered = true;
        window.addEventListener('resize', () => {
            if (ontoData) renderOntologyGraph(ontoData, false);
        });
    }
}

// ---- 数据血缘 ----
let lineageSelectedDbId = null;
let lineageSimulation = null;
let lineageFocusTableId = null;
let lineageParticleRafId = null;

function lineageStopParticleLoop() {
    if (lineageParticleRafId != null) {
        cancelAnimationFrame(lineageParticleRafId);
        lineageParticleRafId = null;
    }
}

function lineageQuadBezierPoint(p0, p1, p2, t) {
    const u = 1 - t;
    return {
        x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
        y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y
    };
}

function lineageShortTableName(full) {
    if (!full) return '';
    const s = String(full);
    const i = s.lastIndexOf('.');
    return i >= 0 ? s.slice(i + 1) : s;
}

function toggleLineageDbPicker(e) {
    e.stopPropagation();
    const dd = document.getElementById('lineageDbDropdown');
    const btn = document.getElementById('lineageDbBtn');
    if (!dd || !btn) return;
    const isOpen = dd.classList.contains('open');
    dd.classList.toggle('open', !isOpen);
    btn.classList.toggle('active', !isOpen);
}

function selectLineageDb(dbId, dbName, dbType) {
    lineageSelectedDbId = dbId;
    const textEl = document.getElementById('lineageDbBtnText');
    if (textEl) {
        textEl.textContent = `${getDbIcon(dbType)} ${dbName}`;
        textEl.classList.remove('placeholder');
    }
    document.querySelectorAll('.lineage-db-option').forEach(el => {
        const sel = el.dataset.dbId === dbId;
        el.classList.toggle('selected', sel);
        const c = el.querySelector('.lineage-db-option-check');
        if (c) c.style.display = sel ? '' : 'none';
    });
    const dd = document.getElementById('lineageDbDropdown');
    const btn = document.getElementById('lineageDbBtn');
    if (dd) dd.classList.remove('open');
    if (btn) btn.classList.remove('active');
}

function initLineageTab() {
    const dropdown = document.getElementById('lineageDbDropdown');
    const emptyEl = document.getElementById('lineageDbDropdownEmpty');
    if (!dropdown) return;
    dropdown.querySelectorAll('.lineage-db-option').forEach(el => el.remove());
    if (databases.length === 0) {
        if (emptyEl) emptyEl.style.display = '';
    } else {
        if (emptyEl) emptyEl.style.display = 'none';
        databases.forEach(db => {
            const item = document.createElement('div');
            item.className = 'lineage-db-option';
            item.dataset.dbId = db.id;
            const isSelected = db.id === lineageSelectedDbId;
            if (isSelected) item.classList.add('selected');
            item.innerHTML = `
                <span>${getDbIcon(db.type)}</span>
                <span style="flex:1;min-width:0"><strong>${escapeHtml(db.name)}</strong><br><span style="color:#a0aec0;font-size:11px">${escapeHtml(db.type || '')}</span></span>
                <span class="lineage-db-option-check" style="display:${isSelected ? '' : 'none'}">✓</span>`;
            item.onclick = (ev) => {
                ev.stopPropagation();
                selectLineageDb(db.id, db.name, db.type);
            };
            dropdown.appendChild(item);
        });
        if (!lineageSelectedDbId) {
            const te = document.getElementById('lineageDbBtnText');
            if (te) { te.textContent = '选择数据库'; te.classList.add('placeholder'); }
        }
    }
    if (!window._lineageResizeRegistered) {
        window._lineageResizeRegistered = true;
        window.addEventListener('resize', () => {
            if (lineageSelectedDbId && window.lineageLastPayload) {
                renderLineageGraph(window.lineageLastPayload);
            }
        });
    }
}

function lineageDirectedLinksFromEdges(edges) {
    return (edges || []).map(e => {
        if (e.kind === 'etl') {
            return { s: e.fromTable, t: e.toTable, kind: 'etl', fromColumn: e.fromColumn, toColumn: e.toColumn };
        }
        return { s: e.toTable, t: e.fromTable, kind: 'fk', fromColumn: e.fromColumn, toColumn: e.toColumn };
    });
}

function lineageNeighborsUp(tableId, dlinks) {
    const out = new Set();
    dlinks.forEach(l => {
        if (l.t === tableId) out.add(l.s);
    });
    return out;
}

function lineageNeighborsDown(tableId, dlinks) {
    const out = new Set();
    dlinks.forEach(l => {
        if (l.s === tableId) out.add(l.t);
    });
    return out;
}

function lineageExpandedUpstreamIds(focusId, dlinks) {
    const up = lineageNeighborsUp(focusId, dlinks);
    const down = lineageNeighborsDown(focusId, dlinks);
    const expanded = new Set(up);
    down.forEach(c => {
        lineageNeighborsUp(c, dlinks).forEach(p => {
            if (p !== focusId) expanded.add(p);
        });
    });
    return expanded;
}

function lineageDownstreamBfsIds(focusId, dlinks) {
    const seen = new Set();
    const q = [focusId];
    seen.add(focusId);
    while (q.length) {
        const n = q.shift();
        dlinks.forEach(l => {
            if (l.s === n && !seen.has(l.t)) {
                seen.add(l.t);
                q.push(l.t);
            }
        });
    }
    seen.delete(focusId);
    return seen;
}

/** 血缘节点标签拆行：优先 schema.table 两行，否则按长度折行 */
function lineageTableLabelLines(full) {
    const s = String(full || '');
    if (!s) return [''];
    const max1 = 26;
    if (s.length <= max1) return [s];
    const dot = s.lastIndexOf('.');
    if (dot > 0) {
        const schema = s.slice(0, dot + 1);
        const table = s.slice(dot + 1);
        if (schema.length <= max1 && table.length <= max1) return [schema, table];
    }
    const lines = [];
    for (let i = 0; i < s.length; i += max1) lines.push(s.slice(i, i + max1));
    return lines;
}

function lineageMeasureNodeBoxes(svg, nodes) {
    const tmp = svg.append('text')
        .attr('class', 'lineage-node-label lineage-node-label-measure')
        .attr('visibility', 'hidden')
        .attr('x', -9999)
        .attr('y', -9999);
    const lineHeight = 14;
    const padX = 12;
    const padY = 8;
    const maxLabelWidth = 320;
    const minW = 80;
    nodes.forEach(d => {
        d._lines = lineageTableLabelLines(d.full || d.id);
        let maxW = 0;
        d._lines.forEach(line => {
            tmp.text(line);
            try {
                const bb = tmp.node().getBBox();
                maxW = Math.max(maxW, bb.width);
            } catch (e) {
                maxW = Math.max(maxW, line.length * 7);
            }
        });
        d._nw = Math.min(maxLabelWidth, Math.max(minW, maxW + padX * 2));
        d._nh = d._lines.length * lineHeight + padY * 2;
        d.lw = d._nw / 2;
        d.lh = d._nh / 2;
    });
    tmp.remove();
}

function lineageLineEndpoints(sx, sy, tx, ty, offS, offT) {
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return { x1: sx, y1: sy, x2: tx, y2: ty };
    const ux = dx / len;
    const uy = dy / len;
    return {
        x1: sx + ux * offS,
        y1: sy + uy * offS,
        x2: tx - ux * offT,
        y2: ty - uy * offT
    };
}

function lineageLinkCurveGeom(d, bias) {
    const offS = Math.hypot(d.source.lw, d.source.lh) + 4;
    const offT = Math.hypot(d.target.lw, d.target.lh) + 4;
    const { x1, y1, x2, y2 } = lineageLineEndpoints(
        d.source.x, d.source.y, d.target.x, d.target.y, offS, offT
    );
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len;
    const py = dx / len;
    const curve = 0.24 * len + (bias || 0);
    const cx = mx + px * curve;
    const cy = my + py * curve;
    return {
        x1, y1, cx, cy, x2, y2,
        dPath: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`
    };
}

function applyLineageFocusHighlight(nodeSel, linkItems, nodes, edges, statsEl, tables, edgeCount) {
    const dlinks = lineageDirectedLinksFromEdges(edges);
    const base = `${tables.length} 张表 · ${edgeCount} 条依赖`;
    if (!statsEl) return;
    if (!lineageFocusTableId) {
        statsEl.textContent = `${base} · 单击表节点查看上下游，双击空白处取消`;
        nodeSel.selectAll('.lineage-node-shape').attr('opacity', 1).attr('stroke-width', 2).attr('stroke', 'url(#lineage-node-stroke-grad)');
        linkItems.selectAll('path').attr('opacity', 1);
        linkItems.selectAll('.lineage-particle').attr('opacity', 1);
        return;
    }
    const focus = lineageFocusTableId;
    const up = lineageExpandedUpstreamIds(focus, dlinks);
    const down = lineageDownstreamBfsIds(focus, dlinks);
    const keep = new Set([focus, ...up, ...down]);
    const upStr = [...up].sort().join(', ') || '—';
    const downStr = [...down].sort().join(', ') || '—';
    statsEl.innerHTML = `${escapeHtml(base)} · 选中 <code style="color:#67e8f9">${escapeHtml(focus)}</code> · 上游: ${escapeHtml(upStr)} · 下游: ${escapeHtml(downStr)}`;

    nodeSel.selectAll('.lineage-node-shape')
        .attr('opacity', d => (keep.has(d.id) ? 1 : 0.15))
        .attr('stroke-width', d => (d.id === focus ? 3.5 : 2))
        .attr('stroke', d => (d.id === focus ? '#fbbf24' : 'url(#lineage-node-stroke-grad)'));

    const linkOp = d => {
        const sid = d.source.id;
        const tid = d.target.id;
        return keep.has(sid) && keep.has(tid) ? 1 : 0.12;
    };
    linkItems.selectAll('path').attr('opacity', linkOp);
    linkItems.selectAll('.lineage-particle').attr('opacity', linkOp);
}

async function loadLineageGraph() {
    if (!lineageSelectedDbId) {
        showOntoToast('请先选择数据库', true);
        return;
    }
    lineageFocusTableId = null;
    try {
        const res = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${lineageSelectedDbId}/lineage`);
        const data = await res.json();
        if (!data.success) {
            showOntoToast(data.message || '血缘分析失败', true);
            return;
        }
        window.lineageLastPayload = data;
        renderLineageGraph(data);
        if (data.message) showOntoToast(data.message);
    } catch (err) {
        showOntoToast('请求失败: ' + (err.message || String(err)), true);
    }
}

function renderLineageGraph(data) {
    const svgEl = document.getElementById('lineageSvg');
    const ph = document.getElementById('lineagePlaceholder');
    const statsEl = document.getElementById('lineageStats');
    const listEl = document.getElementById('lineageEdgeList');
    if (!svgEl || !data) return;

    const tables = data.tables || [];
    const edges = data.edges || [];
    const edgeCount = data.edgeCount != null ? data.edgeCount : edges.length;

    if (listEl) {
        if (edges.length === 0) {
            listEl.innerHTML = '<div style="color:#a0aec0;padding:12px">未检测到外键约束</div>';
        } else {
            listEl.innerHTML = edges.map(e => {
                const ft = escapeHtml(e.fromTable || '');
                const fc = escapeHtml(e.fromColumn || '');
                const tt = escapeHtml(e.toTable || '');
                const tc = escapeHtml(e.toColumn || '');
                const tag = e.kind === 'etl' ? ' <span style="color:#f6ad55;font-size:11px">ETL</span>' : '';
                return `<div class="lineage-edge-row"><code>${ft}</code>.<code>${fc}</code> → <code>${tt}</code>.<code>${tc}</code>${tag}</div>`;
            }).join('');
        }
    }

    const nodeById = new Map();
    tables.forEach(t => nodeById.set(t, { id: t, label: lineageShortTableName(t), full: t }));
    edges.forEach(e => {
        if (!nodeById.has(e.fromTable)) nodeById.set(e.fromTable, { id: e.fromTable, label: lineageShortTableName(e.fromTable), full: e.fromTable });
        if (!nodeById.has(e.toTable)) nodeById.set(e.toTable, { id: e.toTable, label: lineageShortTableName(e.toTable), full: e.toTable });
    });
    const nodes = Array.from(nodeById.values());
    const links = edges.map(e => {
        if (e.kind === 'etl') {
            return {
                source: e.fromTable,
                target: e.toTable,
                fromColumn: e.fromColumn,
                toColumn: e.toColumn,
                kind: 'etl'
            };
        }
        return {
            source: e.toTable,
            target: e.fromTable,
            fromColumn: e.fromColumn,
            toColumn: e.toColumn,
            kind: 'fk'
        };
    });

    if (nodes.length === 0) {
        lineageStopParticleLoop();
        if (ph) ph.style.display = '';
        d3.select('#lineageSvg').selectAll('*').remove();
        if (lineageSimulation) { lineageSimulation.stop(); lineageSimulation = null; }
        return;
    }
    if (ph) ph.style.display = 'none';

    const wrap = document.getElementById('lineageChartWrap');
    const W = (wrap && wrap.clientWidth) || svgEl.parentElement.clientWidth || 600;
    const H = (wrap && wrap.clientHeight) || svgEl.parentElement.clientHeight || 400;

    lineageStopParticleLoop();
    const svg = d3.select('#lineageSvg').attr('width', W).attr('height', H);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    const nodeFillGrad = defs.append('linearGradient')
        .attr('id', 'lineage-node-fill-grad')
        .attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '100%');
    nodeFillGrad.append('stop').attr('offset', '0%').attr('stop-color', '#1e3a5f');
    nodeFillGrad.append('stop').attr('offset', '55%').attr('stop-color', '#312e81');
    nodeFillGrad.append('stop').attr('offset', '100%').attr('stop-color', '#4c1d95');

    const nodeStrokeGrad = defs.append('linearGradient')
        .attr('id', 'lineage-node-stroke-grad')
        .attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '100%');
    nodeStrokeGrad.append('stop').attr('offset', '0%').attr('stop-color', '#22d3ee');
    nodeStrokeGrad.append('stop').attr('offset', '100%').attr('stop-color', '#a78bfa');

    const arrowGrad = defs.append('linearGradient')
        .attr('id', 'lineage-arrow-grad')
        .attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '0%');
    arrowGrad.append('stop').attr('offset', '0%').attr('stop-color', '#67e8f9');
    arrowGrad.append('stop').attr('offset', '100%').attr('stop-color', '#c4b5fd');

    const m = defs.append('marker')
        .attr('id', 'lineage-arrow')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 9)
        .attr('refY', 0)
        .attr('markerWidth', 7)
        .attr('markerHeight', 7)
        .attr('orient', 'auto');
    m.append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', 'url(#lineage-arrow-grad)');

    const mainG = svg.append('g').attr('class', 'lineage-main-g');
    const zoom = d3.zoom().scaleExtent([0.2, 4]).on('zoom', ev => mainG.attr('transform', ev.transform));
    svg.call(zoom).on('dblclick.zoom', null);

    const nodeMap = {};
    nodes.forEach(n => { n.x = W / 2 + (Math.random() - 0.5) * 200; n.y = H / 2 + (Math.random() - 0.5) * 200; nodeMap[n.id] = n; });
    const linkData = links.filter(l => nodeMap[l.source] && nodeMap[l.target]).map(l => ({
        source: nodeMap[l.source],
        target: nodeMap[l.target],
        fromColumn: l.fromColumn,
        toColumn: l.toColumn,
        kind: l.kind || 'fk'
    }));

    const pairCount = new Map();
    linkData.forEach(d => {
        const key = `${d.source.id}\0${d.target.id}`;
        const n = pairCount.get(key) || 0;
        pairCount.set(key, n + 1);
        d._curveBias = (n % 2 === 0 ? 1 : -1) * (Math.floor(n / 2) + 1) * 14;
    });

    lineageMeasureNodeBoxes(svg, nodes);

    if (lineageSimulation) lineageSimulation.stop();
    lineageSimulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(linkData).id(d => d.id).distance(d => (d.kind === 'etl' ? 150 : 125)))
        .force('charge', d3.forceManyBody().strength(-420))
        .force('center', d3.forceCenter(W / 2, H / 2))
        .force('collision', d3.forceCollide().radius(d => Math.hypot(d.lw, d.lh) + 22));

    const linkG = mainG.append('g').attr('class', 'lineage-links-layer');
    const linkItems = linkG.selectAll('g.lineage-link-item')
        .data(linkData)
        .enter()
        .append('g')
        .attr('class', d => `lineage-link-item ${d.kind === 'etl' ? 'lineage-link-item-etl' : 'lineage-link-item-fk'}`);

    linkItems.each(function (d) {
        const g = d3.select(this);
        const baseKind = d.kind === 'etl' ? 'lineage-link-kind-etl' : 'lineage-link-kind-fk';
        g.append('path')
            .attr('class', `lineage-link-base lineage-link-path ${baseKind}`)
            .attr('fill', 'none')
            .attr('marker-end', 'url(#lineage-arrow)');
        const flowClass = d.kind === 'etl' ? 'lineage-link-flow lineage-link-flow-etl' : 'lineage-link-flow lineage-link-flow-fk';
        g.append('path')
            .attr('class', flowClass)
            .attr('fill', 'none')
            .attr('pointer-events', 'none');
        const radii = [3.4, 2.6, 2.2];
        radii.forEach((r, i) => {
            g.append('circle')
                .attr('class', `lineage-particle lineage-particle-${i}`)
                .attr('r', r)
                .attr('pointer-events', 'none');
        });
    });

    const nodeG = mainG.append('g').attr('class', 'lineage-nodes-layer');
    const nodeSel = nodeG.selectAll('g.lineage-node').data(nodes).enter().append('g')
        .attr('class', 'lineage-node')
        .style('cursor', 'grab')
        .call(d3.drag()
            .on('start', (ev, d) => { if (!ev.active) lineageSimulation.alphaTarget(0.35).restart(); d.fx = d.x; d.fy = d.y; })
            .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
            .on('end', (ev, d) => { if (!ev.active) lineageSimulation.alphaTarget(0); d.fx = null; d.fy = null; })
        );

    const inner = nodeSel.append('g').attr('class', 'lineage-node-inner');
    const hitPad = 10;
    inner.append('rect')
        .attr('class', 'lineage-node-hit')
        .attr('x', d => -d._nw / 2 - hitPad)
        .attr('y', d => -d._nh / 2 - hitPad)
        .attr('width', d => d._nw + hitPad * 2)
        .attr('height', d => d._nh + hitPad * 2)
        .attr('rx', 12)
        .attr('ry', 12)
        .attr('fill', 'transparent')
        .attr('stroke', 'none')
        .attr('pointer-events', 'all');
    inner.append('rect')
        .attr('class', 'lineage-node-shape')
        .attr('x', d => -d._nw / 2)
        .attr('y', d => -d._nh / 2)
        .attr('width', d => d._nw)
        .attr('height', d => d._nh)
        .attr('rx', 10)
        .attr('ry', 10)
        .attr('fill', 'url(#lineage-node-fill-grad)')
        .attr('stroke', 'url(#lineage-node-stroke-grad)')
        .attr('stroke-width', 2);

    inner.append('text')
        .attr('class', 'lineage-node-label')
        .attr('text-anchor', 'middle')
        .attr('pointer-events', 'none')
        .each(function (d) {
            const el = d3.select(this);
            const lh = 14;
            const lines = d._lines || [d.full || d.id];
            lines.forEach((line, i) => {
                el.append('tspan')
                    .attr('x', 0)
                    .attr('dy', i === 0 ? `${-(lines.length - 1) * lh / 2}` : `${lh}`)
                    .text(line);
            });
        });

    nodeSel.append('title').text(d => d.full || d.id);

    nodeSel.on('click', (ev, d) => {
        ev.stopPropagation();
        lineageFocusTableId = d.id;
        applyLineageFocusHighlight(nodeSel, linkItems, nodes, edges, statsEl, tables, edgeCount);
    });

    svg.on('dblclick', (ev) => {
        if (ev.target && ev.target.id === 'lineageSvg') {
            lineageFocusTableId = null;
            applyLineageFocusHighlight(nodeSel, linkItems, nodes, edges, statsEl, tables, edgeCount);
        }
    });

    applyLineageFocusHighlight(nodeSel, linkItems, nodes, edges, statsEl, tables, edgeCount);

    lineageSimulation.on('tick', () => {
        linkItems.each(function (d) {
            const geom = lineageLinkCurveGeom(d, d._curveBias || 0);
            d._curve = geom;
            d3.select(this).selectAll('path').attr('d', geom.dPath);
        });
        nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    const phases = [0, 0.33, 0.66];
    const stepParticles = () => {
        const tBase = (performance.now() / 2200) % 1;
        linkItems.each(function (d) {
            const c = d._curve;
            if (!c) return;
            const p0 = { x: c.x1, y: c.y1 };
            const p1 = { x: c.cx, y: c.cy };
            const p2 = { x: c.x2, y: c.y2 };
            const g = d3.select(this);
            g.selectAll('.lineage-particle').each(function (_, i) {
                const t = (tBase + phases[i % phases.length]) % 1;
                const pt = lineageQuadBezierPoint(p0, p1, p2, t);
                d3.select(this).attr('cx', pt.x).attr('cy', pt.y);
            });
        });
        lineageParticleRafId = requestAnimationFrame(stepParticles);
    };
    lineageParticleRafId = requestAnimationFrame(stepParticles);
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('govApiHelpModal')?.style.display !== 'none') {
        closeGovApiHelp();
    }
});

// ============================================================
// 模型管理模块
// ============================================================

let llmModels = [];
let smallModels = [];
let editingLLMModelId = null;
let editingSmallModelId = null;

// 初始化模型管理
function initModelsTab() {
    loadLLMModels();
    loadSmallModels();
    
    // Tab 切换
    document.querySelectorAll('.models-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.models-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.modelTab;
            document.getElementById('llmModelsPanel').style.display = tab === 'llm' ? '' : 'none';
            document.getElementById('smallModelsPanel').style.display = tab === 'small' ? '' : 'none';
        });
    });
}

// ========== 大模型管理 ==========

async function loadLLMModels() {
    try {
        const resp = await fetchWithAuth(`${API_BASE}/api/data-ontology/models/llm`);
        const data = await resp.json();
        if (data.success) {
            llmModels = data.models || [];
            renderLLMModels();
        }
    } catch (e) {
        console.error('加载大模型失败:', e);
    }
}

function renderLLMModels() {
    const container = document.getElementById('llmModelsList');
    if (llmModels.length === 0) {
        container.innerHTML = '<div class="models-empty">暂无大模型配置，点击"添加模型"创建</div>';
        return;
    }
    
    const typeIcons = { llm: '🤖', rerank: '🔄', embedding: '📊', asr: '🎤', tts: '🔊' };
    const typeLabels = { llm: 'LLM', rerank: 'Rerank', embedding: 'Embedding', asr: 'ASR', tts: 'TTS' };
    
    container.innerHTML = llmModels.map(m => {
        const safeMId = escapeHtml(m.id);
        return `
        <div class="model-card ${m.enabled ? '' : 'disabled'}">
            <div class="model-card-header">
                <span class="model-icon">${typeIcons[m.type] || '🤖'}</span>
                <span class="model-name">${escapeHtml(m.name)}</span>
                <span class="model-type-badge">${typeLabels[m.type] || m.type}</span>
            </div>
            <div class="model-card-body">
                <div class="model-info"><strong>服务商:</strong> ${escapeHtml(m.provider || 'custom')}</div>
                <div class="model-info"><strong>模型:</strong> ${escapeHtml(m.model || '-')}</div>
                <div class="model-info"><strong>地址:</strong> ${escapeHtml(m.url)}</div>
                ${m.description ? `<div class="model-desc">${escapeHtml(m.description)}</div>` : ''}
            </div>
            <div class="model-card-footer">
                <span class="model-status ${m.enabled ? 'enabled' : 'disabled'}">${m.enabled ? '✓ 已启用' : '✗ 已禁用'}</span>
                <div class="model-actions">
                    <button class="btn btn-sm" onclick="editLLMModel('${safeMId}')">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteLLMModel('${safeMId}')">删除</button>
                </div>
            </div>
        </div>
    `;}).join('');
}

function showAddLLMModelModal() {
    editingLLMModelId = null;
    document.getElementById('llmModalTitle').textContent = '添加大模型';
    document.getElementById('llmModelForm').reset();
    document.getElementById('llmEnabledInput').checked = true;
    document.getElementById('llmModelModal').classList.add('show');
}

function editLLMModel(id) {
    const model = llmModels.find(m => m.id === id);
    if (!model) return;
    editingLLMModelId = id;
    document.getElementById('llmModalTitle').textContent = '编辑大模型';
    document.getElementById('llmNameInput').value = model.name;
    document.getElementById('llmTypeInput').value = model.type;
    document.getElementById('llmProviderInput').value = model.provider || 'custom';
    document.getElementById('llmModelNameInput').value = model.model || '';
    document.getElementById('llmUrlInput').value = model.url;
    document.getElementById('llmApiKeyInput').value = model.api_key || '';
    document.getElementById('llmDescInput').value = model.description || '';
    document.getElementById('llmEnabledInput').checked = model.enabled;
    document.getElementById('llmModelModal').classList.add('show');
}

function hideLLMModelModal() {
    document.getElementById('llmModelModal').classList.remove('show');
}

async function handleLLMModelSubmit(e) {
    e.preventDefault();
    const data = {
        name: document.getElementById('llmNameInput').value.trim(),
        type: document.getElementById('llmTypeInput').value,
        provider: document.getElementById('llmProviderInput').value,
        model: document.getElementById('llmModelNameInput').value.trim(),
        url: document.getElementById('llmUrlInput').value.trim(),
        api_key: document.getElementById('llmApiKeyInput').value,
        description: document.getElementById('llmDescInput').value.trim(),
        enabled: document.getElementById('llmEnabledInput').checked,
    };
    
    try {
        const url = editingLLMModelId
            ? `${API_BASE}/api/data-ontology/models/llm/${editingLLMModelId}`
            : `${API_BASE}/api/data-ontology/models/llm`;
        const method = editingLLMModelId ? 'PUT' : 'POST';
        const resp = await fetchWithAuth(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await resp.json();
        if (result.success) {
            hideLLMModelModal();
            loadLLMModels();
        } else {
            showToast(result.message || '保存失败', 'error');
        }
    } catch (e) {
        showToast('保存失败: ' + e.message, 'error');
    }
}

async function deleteLLMModel(id) {
    if (!confirm('确定删除该模型？')) return;
    try {
        const resp = await fetchWithAuth(`${API_BASE}/api/data-ontology/models/llm/${id}`, { method: 'DELETE' });
        const result = await resp.json();
        if (result.success) loadLLMModels();
        else showToast(result.message || '删除失败', 'error');
    } catch (e) {
        showToast('删除失败: ' + e.message, 'error');
    }
}

// ========== 小模型管理 ==========

async function loadSmallModels() {
    try {
        const resp = await fetchWithAuth(`${API_BASE}/api/data-ontology/models/small`);
        const data = await resp.json();
        if (data.success) {
            smallModels = data.models || [];
            renderSmallModels();
        }
    } catch (e) {
        console.error('加载小模型失败:', e);
    }
}

function renderSmallModels() {
    const container = document.getElementById('smallModelsList');
    if (smallModels.length === 0) {
        container.innerHTML = '<div class="models-empty">暂无小模型配置，点击"添加模型"创建</div>';
        return;
    }
    
    container.innerHTML = smallModels.map(m => {
        const safeMId = escapeHtml(m.id);
        return `
        <div class="model-card ${m.enabled ? '' : 'disabled'}">
            <div class="model-card-header">
                <span class="model-icon">📝</span>
                <span class="model-name">${escapeHtml(m.name)}</span>
            </div>
            <div class="model-card-body">
                ${m.description ? `<div class="model-desc">${escapeHtml(m.description)}</div>` : ''}
                <div class="model-info"><strong>输入:</strong> ${m.input_type || 'text'}</div>
                <div class="model-info"><strong>输出:</strong> ${m.output_type || 'text'}</div>
            </div>
            <div class="model-card-footer">
                <span class="model-status ${m.enabled ? 'enabled' : 'disabled'}">${m.enabled ? '✓ 已启用' : '✗ 已禁用'}</span>
                <div class="model-actions">
                    <button class="btn btn-sm" onclick="runSmallModel('${safeMId}')">运行</button>
                    <button class="btn btn-sm" onclick="editSmallModel('${safeMId}')">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteSmallModel('${safeMId}')">删除</button>
                </div>
            </div>
        </div>
    `;}).join('');
}

function showAddSmallModelModal() {
    editingSmallModelId = null;
    document.getElementById('smallModalTitle').textContent = '添加小模型';
    document.getElementById('smallModelForm').reset();
    document.getElementById('smallEnabledInput').checked = true;
    populateSmallModelDbSelect();
    document.getElementById('smallModelModal').classList.add('show');
}

function editSmallModel(id) {
    const model = smallModels.find(m => m.id === id);
    if (!model) return;
    editingSmallModelId = id;
    document.getElementById('smallModalTitle').textContent = '编辑小模型';
    populateSmallModelDbSelect();
    document.getElementById('smallNameInput').value = model.name;
    document.getElementById('smallDescInput').value = model.description || '';
    document.getElementById('smallDbSelect').value = model.database_id || '';
    document.getElementById('smallInputTypeInput').value = model.input_type || 'text';
    document.getElementById('smallAcceptExtsInput').value = model.accept_exts || '';
    document.getElementById('smallOutputTypeInput').value = model.output_type || 'text';
    document.getElementById('smallCodeInput').value = model.js_code || '';
    document.getElementById('smallEnabledInput').checked = model.enabled;
    document.getElementById('smallModelModal').classList.add('show');
}

function hideSmallModelModal() {
    document.getElementById('smallModelModal').classList.remove('show');
}

function populateSmallModelDbSelect() {
    const select = document.getElementById('smallDbSelect');
    select.innerHTML = '<option value="">不关联数据库</option>';
    databases.forEach(db => {
        select.innerHTML += `<option value="${escapeHtml(db.id)}">${escapeHtml(db.name)} (${escapeHtml(db.type)})</option>`;
    });
}

async function handleSmallModelSubmit(e) {
    e.preventDefault();
    const data = {
        name: document.getElementById('smallNameInput').value.trim(),
        description: document.getElementById('smallDescInput').value.trim(),
        database_id: document.getElementById('smallDbSelect').value,
        input_type: document.getElementById('smallInputTypeInput').value,
        accept_exts: document.getElementById('smallAcceptExtsInput').value.trim(),
        output_type: document.getElementById('smallOutputTypeInput').value,
        js_code: document.getElementById('smallCodeInput').value,
        enabled: document.getElementById('smallEnabledInput').checked,
    };
    
    try {
        const url = editingSmallModelId
            ? `${API_BASE}/api/data-ontology/models/small/${editingSmallModelId}`
            : `${API_BASE}/api/data-ontology/models/small`;
        const method = editingSmallModelId ? 'PUT' : 'POST';
        const resp = await fetchWithAuth(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await resp.json();
        if (result.success) {
            hideSmallModelModal();
            loadSmallModels();
        } else {
            showToast(result.message || '保存失败', 'error');
        }
    } catch (e) {
        showToast('保存失败: ' + e.message, 'error');
    }
}

async function deleteSmallModel(id) {
    if (!confirm('确定删除该模型？')) return;
    try {
        const resp = await fetchWithAuth(`${API_BASE}/api/data-ontology/models/small/${id}`, { method: 'DELETE' });
        const result = await resp.json();
        if (result.success) loadSmallModels();
        else showToast(result.message || '删除失败', 'error');
    } catch (e) {
        showToast('删除失败: ' + e.message, 'error');
    }
}

async function runSmallModel(id) {
    const model = smallModels.find(m => m.id === id);
    if (!model) return;
    
    const inputText = prompt('请输入文本内容:');
    if (inputText === null) return;
    
    try {
        const resp = await fetchWithAuth(`${API_BASE}/api/data-ontology/models/small/${id}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input_text: inputText })
        });
        const result = await resp.json();
        if (result.success) {
            showToast('运行结果:\n' + (Array.isArray(result.output) ? result.output.join('\n') : JSON.stringify(result.output, null, 2)), 'success', 10000);
        } else {
            showToast('运行失败: ' + result.message, 'error');
        }
    } catch (e) {
        showToast('运行失败: ' + e.message, 'error');
    }
}

// 数据本体池主脚本
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

/** 校验用户密码和确认密码是否一致，并在提示元素中显示错误。 */
function validateUserPasswordPair(password, confirm, hintEl) {
    if (!hintEl) return false;
    hintEl.classList.remove('show');
    hintEl.textContent = '';
    if (password.length < USER_MIN_PASSWORD_LEN) {
        hintEl.textContent = '密码至少 4 位';
        hintEl.classList.add('show');
        return false;
    }
    if (password !== confirm) {
        hintEl.textContent = '两次输入的密码不一致';
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

// AI 助手状态
let aiConfig = null;
let aiCapabilities = null; // AI模型能力检测结果
let aiMessages = [];
let currentDbReference = null;
let dbSuggestionIndex = -1;

const aiModules = [
    { id: 'db-manage', name: '数据库管理', icon: '🗄️', description: '管理数据库连接与表结构' },
    { id: 'api-dispatch', name: '接口分发', icon: '🔌', description: '统一分发和调用数据接口' },
    { id: 'data-governance', name: '数据治理', icon: '🧭', description: '治理规则、质量与权限管理' },
    { id: 'ontology', name: '本体论抽象', icon: '📐', description: '从数据中抽象业务本体' },
];

let aiSessionContext = {
    databases: [],
    modules: [],
    history: []
};

// API 基础地址
const API_BASE = window.location.origin;
// Make API_BASE globally accessible for quality-audit.js
if (typeof window !== 'undefined') {
    window.API_BASE = API_BASE;
}

const RETURN_URL_KEY = 'dataOntologyReturnUrl';

const lazyScriptRegistry = {};
function loadLazyScript(src) {
    if (!lazyScriptRegistry[src]) {
        lazyScriptRegistry[src] = new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[data-lazy-src="${CSS.escape(src)}"]`);
            if (existing && existing.dataset.loaded === 'true') {
                resolve();
                return;
            }
            const script = existing || document.createElement('script');
            script.src = existing ? existing.getAttribute('src') || src : src;
            script.async = true;
            script.dataset.lazySrc = src;
            script.addEventListener('load', () => {
                script.dataset.loaded = 'true';
                resolve();
            }, { once: true });
            script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
            if (!existing) document.body.appendChild(script);
        });
    }
    return lazyScriptRegistry[src];
}

async function ensureGovernanceScriptsLoaded() {
    await loadLazyScript('gov-shared.js?v=4.2.31');
    await loadLazyScript('gov-api.js?v=4.2.31');
    await loadLazyScript('governance.js?v=4.2.31');
}

async function ensureQualityAuditScriptLoaded() {
    await loadLazyScript('quality-audit.js?v=4.2.31');
}


function handleUnauthorizedFromApi() {
    if (!localStorage.getItem('dataOntologyToken')) return;
    try { closeUserMgmtPanel(true); } catch (e) {}
    try {
        window._qualityAuditDataLoaded = false;
        window._qualityAuditRulesLoaded = false;
    } catch (e) {}
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

async function fetchWithAuth(input, init, timeoutMs = 60000) {
    const initCopy = init ? { ...init } : {};
    const headers = new Headers(initCopy.headers || {});
    const token = localStorage.getItem('dataOntologyToken');
    if (token) {
        headers.set('Authorization', 'Bearer ' + token);
    }
    
    // 添加超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    initCopy.signal = controller.signal;
    
    try {
        const response = await fetch(input, { ...initCopy, headers });
        clearTimeout(timeoutId);
        if (response.status === 401) {
            const ct401 = response.headers.get('Content-Type') || '';
            if (ct401.includes('application/json')) {
                try {
                    const data401 = await response.clone().json();
                    if (data401 && typeof data401.message === 'string' && data401.message.indexOf('未授权') !== -1) {
                        handleUnauthorizedFromApi();
                    }
                } catch (e) {}
            }
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
    } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') {
            // 返回一个模拟的 Response 对象，标记为超时
            return {
                ok: false,
                status: 0,
                statusText: 'Timeout',
                json: async () => ({ success: false, message: '请求超时，请检查网络连接或联系管理员' }),
                text: async () => '请求超时',
                headers: new Headers()
            };
        }
        throw e;
    }
}

/**
 * 发送 API 请求并自动附带认证信息。
 * @param {string} endpoint - API 路径，拼接到 API_BASE 后面。
 * @param {Object} options - 请求选项。
 * @param {string} options.method - HTTP 方法，默认 GET。
 * @param {Object} options.body - 请求体对象，将被序列化为 JSON。
 * @param {string} options.errorPrefix - 错误提示前缀，默认“请求失败”。
 * @param {boolean} options.showToastOnError - 是否在失败时提示 toast，默认 true。
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
async function apiRequest(endpoint, options = {}) {
    const { method = 'GET', body, errorPrefix = '请求失败', showToastOnError = true } = options;
    
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
        const errorMsg = error.message || '未知错误';
        if (showToastOnError) {
            showToast(`${errorPrefix}：${errorMsg}`, 'error');
        }
        return { success: false, error: errorMsg };
    }
}

// ---- 演示数据库（内存 SQLite）----
const DEMO_ONTOLOGY_DB_ID = 'demo-ontology-memory';

const DEMO_ONTOLOGY_TABLES = {
    customers: {
        comment: '客户信息表',
        columns: [
            { name: 'id', type: 'INTEGER', nullable: false, comment: '客户ID' },
            { name: 'name', type: 'TEXT', nullable: false, comment: '客户姓名' },
            { name: 'email', type: 'TEXT', nullable: true, comment: '电子邮箱' }
        ],
        rows: [
            { id: 1, name: '张三', email: 'zhang@example.com' },
            { id: 2, name: '李四', email: 'li@example.com' }
        ]
    },
    products: {
        comment: '商品信息表',
        columns: [
            { name: 'id', type: 'INTEGER', nullable: false, comment: '商品ID' },
            { name: 'name', type: 'TEXT', nullable: false, comment: '商品名称' },
            { name: 'price', type: 'REAL', nullable: false, comment: '商品单价' }
        ],
        rows: [
            { id: 101, name: '笔记本电脑', price: 5999 },
            { id: 102, name: '鼠标', price: 99 }
        ]
    },
    orders: {
        comment: '订单主表',
        columns: [
            { name: 'id', type: 'INTEGER', nullable: false, comment: '订单ID' },
            { name: 'customer_id', type: 'INTEGER', nullable: false, comment: '客户ID' },
            { name: 'order_date', type: 'TEXT', nullable: false, comment: '下单日期' },
            { name: 'total', type: 'REAL', nullable: false, comment: '订单总额' }
        ],
        rows: [
            { id: 1001, customer_id: 1, order_date: '2025-03-01', total: 6098 },
            { id: 1002, customer_id: 2, order_date: '2025-03-02', total: 99 }
        ]
    },
    order_items: {
        comment: '订单明细表',
        columns: [
            { name: 'id', type: 'INTEGER', nullable: false, comment: '明细ID' },
            { name: 'order_id', type: 'INTEGER', nullable: false, comment: '订单ID' },
            { name: 'product_id', type: 'INTEGER', nullable: false, comment: '商品ID' },
            { name: 'qty', type: 'INTEGER', nullable: false, comment: '购买数量' },
            { name: 'unit_price', type: 'REAL', nullable: false, comment: '单价' }
        ],
        rows: [
            { id: 1, order_id: 1001, product_id: 101, qty: 1, unit_price: 5999 },
            { id: 2, order_id: 1001, product_id: 102, qty: 1, unit_price: 99 },
            { id: 3, order_id: 1002, product_id: 102, qty: 1, unit_price: 99 }
        ]
    },
    payments: {
        comment: '支付记录表',
        columns: [
            { name: 'id', type: 'INTEGER', nullable: false, comment: '支付ID' },
            { name: 'order_id', type: 'INTEGER', nullable: false, comment: '订单ID' },
            { name: 'amount', type: 'REAL', nullable: false, comment: '支付金额' },
            { name: 'paid_at', type: 'TEXT', nullable: true, comment: '支付时间' }
        ],
        rows: [
            { id: 1, order_id: 1001, amount: 6098, paid_at: '2025-03-01T10:00:00' },
            { id: 2, order_id: 1002, amount: 99, paid_at: '2025-03-02T15:00:00' }
        ]
    },
    report_sales: {
        comment: '销售汇总报表',
        columns: [
            { name: 'period', type: 'TEXT', nullable: false, comment: '统计周期' },
            { name: 'sku', type: 'TEXT', nullable: false, comment: '商品SKU' },
            { name: 'qty_sold', type: 'INTEGER', nullable: false, comment: '销售数量' },
            { name: 'revenue', type: 'REAL', nullable: false, comment: '销售收入' }
        ],
        rows: [
            { period: '2025-03', sku: 'Laptop', qty_sold: 1, revenue: 5999 },
            { period: '2025-03', sku: 'Mouse', qty_sold: 2, revenue: 198 }
        ]
    }
};

/** 数据血缘示例：包含 ETL 汇总到 `report_sales` 的关系。 */
const DEMO_ONTOLOGY_LINEAGE_EDGES = [
    { fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id' },
    { fromTable: 'order_items', fromColumn: 'order_id', toTable: 'orders', toColumn: 'id' },
    { fromTable: 'order_items', fromColumn: 'product_id', toTable: 'products', toColumn: 'id' },
    { fromTable: 'payments', fromColumn: 'order_id', toTable: 'orders', toColumn: 'id' },
    { fromTable: 'orders', fromColumn: '(ETL)', toTable: 'report_sales', toColumn: '(ETL)', kind: 'etl' },
    { fromTable: 'order_items', fromColumn: '(ETL)', toTable: 'report_sales', toColumn: '(ETL)', kind: 'etl' }
];

function getDemoDatabaseListEntry() {
    return {
        id: DEMO_ONTOLOGY_DB_ID,
        type: 'sqlite',
        name: '内存示例库',
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
            // 返回带备注的表列表
            const tablesWithComments = tableNames.map(name => ({
                name: name,
                comment: DEMO_ONTOLOGY_TABLES[name].comment || ''
            }));
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
                    tables: tablesWithComments
                }
            });
        }
        if (method === 'DELETE') {
            const i = databases.findIndex(d => d.id === DEMO_ONTOLOGY_DB_ID);
            if (i >= 0) databases.splice(i, 1);
            return demoOntologyJsonResponse({ success: true });
        }
        return demoOntologyJsonResponse({ success: false, message: '不支持的请求方法' }, 400);
    }

    if (parsed.kind === 'lineage' && method === 'GET') {
        const tables = Object.keys(DEMO_ONTOLOGY_TABLES);
        return demoOntologyJsonResponse({
            success: true,
            dbType: 'sqlite',
            tables,
            edges: DEMO_ONTOLOGY_LINEAGE_EDGES,
            edgeCount: DEMO_ONTOLOGY_LINEAGE_EDGES.length,
            message: '示例数据血缘已加载，包含订单到报表表的 ETL 汇总关系'
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
        return demoOntologyJsonResponse({ success: false, message: '请求参数错误' }, 400);
    }

    return demoOntologyJsonResponse({ success: false, message: '未找到对应资源' }, 404);
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

// ==================== 提示消息组件 ====================

// Toast 组件替代 alert，提供更友好的视觉反馈。
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
 * 显示一条 Toast 提示。
 * @param {string} message - 提示内容。
 * @param {string} type - 类型：'success' | 'error' | 'warning' | 'info'
 * @param {number} duration - 显示时长，默认 3000ms。
 */
function showToast(message, type = 'info', duration = 3000) {
    if (!toastContainer) initToastContainer();
    
    const colors = {
        success: { bg: '#10b981', icon: '✓' },
        error: { bg: '#ef4444', icon: '✕' },
        warning: { bg: '#f59e0b', icon: '!' },
        info: { bg: '#3b82f6', icon: 'i' }
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
    
    // 使用 requestAnimationFrame 触发进入动画。
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    });
    
    // 自动关闭。
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
 * 切换模态框显示状态。
 * @param {string} modalId - 模态框 ID
 * @param {boolean} show - true 表示显示，false 表示隐藏。
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
 * 显示模态框，并隐藏其他需要清理的模态框。
 * @param {string} modalId - 目标模态框 ID
 * @param {string[]} clearIds - 需要隐藏的其他模态框 ID 列表。
 */
function showModal(modalId, clearIds = []) {
    toggleModal(modalId, true);
    clearIds.forEach(id => toggleModal(id, false));
}

/**
 * 隐藏指定模态框。
 * @param {string} modalId - 模态框 ID
 */
function hideModal(modalId) {
    toggleModal(modalId, false);
}

/**
 * 复制文本到剪贴板，并在按钮上显示成功提示。
 * @param {string} text - 要复制的文本。
 * @param {HTMLElement} btnEl - 触发复制的按钮元素。
 * @param {string} successText - 成功提示文本，默认“已复制”。
 * @param {number} duration - 提示回退时长，默认 1500ms。
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

// 安装全局错误处理器。
function setupGlobalErrorHandlers() {
    // 捕获 Promise 未处理拒绝。
    window.addEventListener('unhandledrejection', function(event) {
        console.error('Promise 未处理拒绝:', event.reason);
        const msg = event.reason?.message || String(event.reason) || '未知错误';
        showToast('运行异常：' + msg, 'error', 5000);
        event.preventDefault();
    });
    
    // 捕获 JavaScript 运行错误。
    window.addEventListener('error', function(event) {
        if (event.target && (event.target.tagName === 'SCRIPT' || event.target.tagName === 'LINK' || event.target.tagName === 'IMG')) {
            return;
        }
        console.error('JavaScript 错误:', event.message);
        if (event.message && !event.message.includes('Script error')) {
            showToast('页面发生异常，请稍后重试', 'error', 4000);
        }
    }, true);
}

// 初始化页面。
document.addEventListener('DOMContentLoaded', async function() {
    setupGlobalErrorHandlers();
    initToastContainer();
    
    if (!checkServerAvailability()) {
        return;
    }

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

// 检查当前运行环境。
function checkServerAvailability() {
    if (window.location.protocol === 'file:') {
        showServerError('请通过服务端访问，不要直接打开 file:// 页面。当前协议：' + window.location.protocol);
        return false;
    }

    if (!window.location.origin || window.location.origin === 'null') {
        showServerError('当前页面来源无效，请通过正式站点访问。');
        return false;
    }

    return true;
}

// 显示服务端错误页面。
function showServerError(detail) {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('mainPage').style.display = 'none';
    
    const errorPage = document.getElementById('serverErrorPage');
    errorPage.style.display = 'block';
    
    document.getElementById('serverErrorDetail').textContent = detail;
    
    const returnBtn = document.getElementById('returnToMainBtn');
    if (returnBtn) {
        returnBtn.onclick = function() {
            window.location.href = '../../index.html';
        };
    }
}

// 绑定页面事件。
function initEventListeners() {
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
}

// 全局错误处理。
function setupGlobalErrorHandlers() {
    // 捕获 Promise 未处理拒绝。
    window.addEventListener('unhandledrejection', function(event) {
        console.error('Promise 未处理拒绝:', event.reason);
        const msg = event.reason?.message || String(event.reason) || '未知错误';
        showToast('运行异常：' + msg, 'error', 5000);
        event.preventDefault();
    });
    
    // 捕获 JavaScript 运行错误。
    window.addEventListener('error', function(event) {
        if (event.target && (event.target.tagName === 'SCRIPT' || event.target.tagName === 'LINK' || event.target.tagName === 'IMG')) {
            return;
        }
        console.error('JavaScript 错误:', event.message);
        if (event.message && !event.message.includes('Script error')) {
            showToast('页面发生异常，请稍后重试', 'error', 4000);
        }
    }, true);
}

// 初始化页面。
document.addEventListener('DOMContentLoaded', async function() {
    setupGlobalErrorHandlers();
    initToastContainer();
    
    if (!checkServerAvailability()) {
        return;
    }

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

// 检查当前运行环境。
function checkServerAvailability() {
    if (window.location.protocol === 'file:') {
        showServerError('请通过服务端访问，不要直接打开 file:// 页面。当前协议：' + window.location.protocol);
        return false;
    }

    if (!window.location.origin || window.location.origin === 'null') {
        showServerError('当前页面来源无效，请通过正式站点访问。');
        return false;
    }

    return true;
}

// 显示服务端错误页面。
function showServerError(detail) {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('mainPage').style.display = 'none';
    
    const errorPage = document.getElementById('serverErrorPage');
    errorPage.style.display = 'block';
    
    document.getElementById('serverErrorDetail').textContent = detail;
    
    const returnBtn = document.getElementById('returnToMainBtn');
    if (returnBtn) {
        returnBtn.onclick = function() {
            window.location.href = '../../index.html';
        };
    }
}

// 绑定页面事件。
function initEventListeners() {
    document.getElementById('loginForm').addEventListener('submit', handleLogin);

    // 页面状态与事件绑定。
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // 复制当前数据库信息到表单。
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            if (!this.disabled) {
                switchTab(this.dataset.tab);
            }
        });
    });

    // 回填当前 API 信息。
    document.getElementById('addDbBtn').addEventListener('click', showAddDbModal);

    // 用户管理面板。
    document.getElementById('dbTypeInput').addEventListener('change', handleDbTypeChange);

    // 显示后自动淡入。
    document.getElementById('closeAddDbModal').addEventListener('click', hideAddDbModal);
    document.getElementById('addDbModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideAddDbModal();
        }
    });

    // 重新渲染当前 API。
    document.getElementById('testConnectionBtn').addEventListener('click', testConnection);

    // 加载数据库下拉选项。
    document.getElementById('addDbForm').addEventListener('submit', handleAddDatabase);

    // 根据接口类型填充示例参数。
    document.getElementById('editDbBtn').addEventListener('click', handleEditDatabase);

    // 刷新当前数据库详情。
    document.getElementById('refreshDbBtn').addEventListener('click', function() {
        if (currentDb) {
            loadDatabaseDetail(currentDb.id);
        }
    });

    // 删除当前数据库。
    document.getElementById('deleteDbBtn').addEventListener('click', handleDeleteDatabase);

    // closePreview 在预览区后半段定义。
    
    // 创建数据表。
    document.getElementById('createTableForm').addEventListener('submit', handleCreateTable);
    document.getElementById('addColumnBtn').addEventListener('click', addTableColumn);
    document.getElementById('closeCreateTableModal').addEventListener('click', hideCreateTableModal);
    document.getElementById('createTableModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideCreateTableModal();
        }
    });

    // API 与鉴权逻辑。
    document.getElementById('apikeyTriggerBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        const popover = document.getElementById('apikeyPopover');
        const btn = document.getElementById('apikeyTriggerBtn');
        popover.classList.toggle('show');
        if (popover.classList.contains('show')) {
            var rect = btn.getBoundingClientRect();
            var popoverW = 270;
            var sidebarWidth = 330;
            // 避免弹层被左侧栏遮挡，固定到右侧安全区域。
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
    // API Key 弹层点击空白处自动关闭。
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

    // MCP 相关按钮。
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
    const mcpSavePortBtn = document.getElementById('mcpSavePortBtn');
    if (mcpSavePortBtn) mcpSavePortBtn.addEventListener('click', async function() {
        await saveMcpPort();
    });

    // 基础校验。
    document.getElementById('closeTestApiModal').addEventListener('click', hideTestApiModal);
    document.getElementById('testApiModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideTestApiModal();
        }
    });
    document.getElementById('executeTestBtn').addEventListener('click', executeApiTest);

    // 测试结果视图切换
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            switchTestResultView(this.dataset.view);
        });
    });
    
    // AI 相关按钮。
    document.getElementById('aiSettingsBtn').addEventListener('click', showAiSettingsModal);
    document.getElementById('closeAiSettingsModal').addEventListener('click', hideAiSettingsModal);
    document.getElementById('aiSettingsModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideAiSettingsModal();
        }
    });
    document.getElementById('aiSettingsForm').addEventListener('submit', handleSaveAiSettings);
    document.getElementById('detectCapabilitiesBtn').addEventListener('click', detectAiCapabilities);
    document.getElementById('aiMinRelevance').addEventListener('input', function() {
        document.getElementById('aiMinRelevanceValue').textContent = this.value;
    });
    document.getElementById('aiSendBtn').addEventListener('click', handleSendAiMessage);
    document.getElementById('aiInput').addEventListener('keydown', handleAiInputKeydown);
    document.getElementById('aiInput').addEventListener('input', handleAiInputChange);
    
    // 设置面板按钮。
    document.getElementById('settingsBtn').addEventListener('click', showSettingsModal);
    document.getElementById('closeSettingsModal').addEventListener('click', hideSettingsModal);
    document.getElementById('settingsModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideSettingsModal();
        }
    });
    document.getElementById('saveTabSettingsBtn').addEventListener('click', saveTabSettings);
    document.getElementById('resetTabSettingsBtn').addEventListener('click', resetTabSettings);

    // 数据备份与恢复按钮。
    document.getElementById('exportBackupBtn').addEventListener('click', exportBackup);
    document.getElementById('importBackupBtn').addEventListener('click', importBackup);
    document.getElementById('importBackupFile').addEventListener('change', handleBackupFileSelect);

    // AI 设置入口的事件绑定。

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

// 提示框相关工具。
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
            errorEl.textContent = data.message || '请求失败';
            errorEl.classList.add('show');
        }
    } catch (error) {
        errorEl.textContent = '加载失败：' + error.message;
        errorEl.classList.add('show');
    }
}

// 数据库类型切换相关。
function handleLogout() {
    closeUserMgmtPanel(true);
    try { sessionStorage.removeItem(RETURN_URL_KEY); } catch (e) {}
    try {
        window._qualityAuditDataLoaded = false;
        window._qualityAuditRulesLoaded = false;
    } catch (e) {}
    localStorage.removeItem('dataOntologyToken');
    localStorage.removeItem('dataOntologyUser');
    currentUser = null;
    databases = [];
    currentDb = null;
    govTasks = [];
    currentGovTask = null;
    showLoginPage();
}

// 折叠数据查询结果面板。
function showLoginPage() {
    document.getElementById('loginPage').classList.add('active');
    document.getElementById('mainPage').classList.remove('active');
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    document.getElementById('loginError').classList.remove('show');
}

// 显示主页面。
function showMainPage() {
    document.getElementById('loginPage').classList.remove('active');
    document.getElementById('mainPage').classList.add('active');
    document.getElementById('currentUser').textContent = currentUser;
    updateUserMgmtNavVisibility();
    // 加载数据库后再选中目标库。
    applyTabVisibility();
    // 将引用的模块写入会话上下文。
    initEmbedMode();
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

// 数据库列表
async function switchTab(tabName) {
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
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}Tab`).classList.add('active');

    if (tabName === 'api') {
        loadApis();
        loadApiKey();
    } else if (tabName === 'mcp') {
        loadMcpInfo();
    } else if (tabName === 'ai') {
        loadAiConfig();
        updateAiContextDisplay();
    } else if (tabName === 'governance') {
        await ensureGovernanceScriptsLoaded();
        if (typeof loadGovernanceTasks === 'function') loadGovernanceTasks();
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
        await ensureQualityAuditScriptLoaded();
        if (typeof window.initQualityAuditTab === 'function') {
            window.initQualityAuditTab();
        }
    }
}

// 数据库列表与详情管理。
const dbTypeDefaults = {
    dm: { port: 5236, requiresDb: true },
    oracle: { port: 1521, requiresDb: true },
    mysql: { port: 3306, requiresDb: true },
    mariadb: { port: 3306, requiresDb: true },
    postgresql: { port: 5432, requiresDb: true },
    sqlserver: { port: 1433, requiresDb: true },
    sqlite: { port: 0, requiresDb: false, isFile: true },
    tidb: { port: 4000, requiresDb: true },
    cockroachdb: { port: 26257, requiresDb: true },
    timescaledb: { port: 5432, requiresDb: true }
};

// 数据库类型图标。
const dbTypeIcons = {
    dm: '🔶',
    oracle: '🏛️',
    mysql: '🛢️',
    mariadb: '🛢️',
    postgresql: '🐘',
    sqlserver: '🪟',
    sqlite: '📄',
    tidb: '🌐',
    cockroachdb: '🪳',
    timescaledb: '⏱️'
};

// 根据数据库类型切换表单字段。
function handleDbTypeChange() {
    const dbType = document.getElementById('dbTypeInput').value;
    const config = dbTypeDefaults[dbType];
    
    const sqlFields = document.getElementById('sqlFields');
    const sqliteFields = document.getElementById('sqliteFields');
    const dbDatabaseGroup = document.getElementById('dbDatabaseGroup');
    
    if (config.isFile) {
        // 文件型数据库（SQLite、DuckDB）。
        sqlFields.style.display = 'none';
        sqliteFields.style.display = 'block';
        document.getElementById('dbPathInput').placeholder = 
            dbType === 'duckdb' ? '路径：/path/to/database.duckdb' : '路径：/path/to/database.db';
    } else {
        // 非文件型数据库。
        sqlFields.style.display = 'block';
        sqliteFields.style.display = 'none';
        
        // 自动填充默认端口。
        document.getElementById('dbPortInput').value = config.port;
        
        // 根据是否需要默认库名，控制输入项显示。
        if (config.requiresDb) {
            dbDatabaseGroup.style.display = 'block';
            document.getElementById('dbDatabaseInput').required = true;
            
            // 表单与模态框控制。
            const label = document.querySelector('#dbDatabaseGroup label');
            const input = document.getElementById('dbDatabaseInput');
            if (dbType === 'redis') {
                label.textContent = '数据库编号';
                input.placeholder = '例如：0（内置）';
            } else if (dbType === 'cassandra') {
                label.textContent = 'Keyspace';
                input.placeholder = '例如：my_keyspace';
            } else if (dbType === 'neo4j') {
                label.textContent = '图数据库编号';
                input.placeholder = '例如：neo4j';
            } else if (dbType === 'oracle') {
                label.textContent = 'SID/实例名';
                input.placeholder = '例如：ORCL 或 XE 实例';
            } else {
                label.textContent = '数据库名';
                input.placeholder = '请输入数据库名';
            }
        } else {
            dbDatabaseGroup.style.display = 'none';
            document.getElementById('dbDatabaseInput').required = false;
        }
    }
}

// 显示新增数据库弹窗。
function showAddDbModal() {
    isEditMode = false;
    editingDbId = null;
    document.getElementById('modalTitle').textContent = '新增数据库';
    document.getElementById('addDbModal').classList.add('show');
    document.getElementById('addDbForm').reset();
    document.getElementById('dbTypeInput').value = 'dm';
    document.getElementById('dbTypeInput').disabled = false;
    handleDbTypeChange();
    document.getElementById('dbFormError').classList.remove('show');
    document.getElementById('dbFormSuccess').classList.remove('show');
}

// 显示编辑数据库弹窗。
function handleEditDatabase() {
    if (!currentDb) return;
    
    isEditMode = true;
    editingDbId = currentDb.id;
    document.getElementById('modalTitle').textContent = '编辑数据库';
    document.getElementById('addDbModal').classList.add('show');
    
    // 已存在的数据库
    document.getElementById('dbTypeInput').value = currentDb.type;
    document.getElementById('dbTypeInput').disabled = true; // 数据库类型不可编辑
    document.getElementById('dbNameInput').value = currentDb.name;
    
    if (dbTypeDefaults[currentDb.type].isFile) {
        document.getElementById('dbPathInput').value = currentDb.path || '';
    } else {
        document.getElementById('dbHostInput').value = currentDb.host || '';
        document.getElementById('dbPortInput').value = currentDb.port || '';
        document.getElementById('dbUserInput').value = currentDb.user || '';
        document.getElementById('dbPasswordInput').value = ''; // 编辑时默认不回填密码。
        document.getElementById('dbPasswordInput').placeholder = '请输入新密码（可留空）';
        if (dbTypeDefaults[currentDb.type].requiresDb) {
            document.getElementById('dbDatabaseInput').value = currentDb.database || '';
        }
    }
    
    handleDbTypeChange();
    document.getElementById('dbFormError').classList.remove('show');
    document.getElementById('dbFormSuccess').classList.remove('show');
}

// 隐藏新增/编辑数据库弹窗。
function hideAddDbModal() {
    document.getElementById('addDbModal').classList.remove('show');
    document.getElementById('dbPasswordInput').placeholder = '请输入密码';
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
                    showToast('API Key 已生成', 'success');
                    loadUsers();
                } else {
                    showToast(data.message || '操作失败', 'error');
                }
            } catch (e) {
                showToast(e.message || '操作失败', 'error');
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
    if (title) title.textContent = '修改密码 · ' + username;
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
        errEl.textContent = '请先输入新密码和确认密码';
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
            showToast('密码已更新', 'success');
            hideUserPasswordModal();
            if (userMgmtMode) loadUsers();
        } else {
            errEl.textContent = data.message || '操作失败';
            errEl.classList.add('show');
        }
    } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.add('show');
    }
}

async function userMgmtDelete(username) {
    if (!confirm('确定删除用户 ' + username + ' 吗？')) return;
    
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
            showToast('删除成功', 'success');
            loadUsers();
        } else {
            showToast(data.message || '操作失败', 'error');
            btn.disabled = false;
            btn.textContent = originalText;
        }
    } catch (e) {
        showToast(e.message || '操作失败', 'error');
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
        msgEl.textContent = '请输入密码并再次确认';
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
            msgEl.textContent = data.message || '操作失败';
            msgEl.classList.add('show');
        }
    } catch (e) {
        msgEl.textContent = e.message;
        msgEl.classList.add('show');
    }
}

// 测试数据库连接。
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
        
        // 编辑模式下，如果密码为空则复用旧密码。
        const password = document.getElementById('dbPasswordInput').value;
        if (isEditMode && password === '' && currentDb) {
            // 编辑时必须输入旧密码才能进行连通性测试。
            const errorEl = document.getElementById('dbFormError');
            errorEl.textContent = '编辑模式下测试连接需要输入密码';
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

    // 绑定测试按钮状态。
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
            successEl.textContent = '连接成功';
            successEl.classList.add('show');
        } else {
            errorEl.textContent = data.message || '测试失败';
            errorEl.classList.add('show');
        }
    } catch (error) {
        errorEl.textContent = '测试失败：' + error.message;
        errorEl.classList.add('show');
    } finally {
        // 恢复按钮状态。
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.textContent = originalText || '测试连接';
        }
    }
}

// 新增或编辑数据库。
async function handleAddDatabase(e) {
    e.preventDefault();

    const dbType = document.getElementById('dbTypeInput').value;
    const dbName = document.getElementById('dbNameInput').value.trim();
    
    const errorEl = document.getElementById('dbFormError');
    const successEl = document.getElementById('dbFormSuccess');
    errorEl.classList.remove('show');
    successEl.classList.remove('show');
    
    // 校验数据库名称。
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
            errorEl.textContent = '请输入文件路径';
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
            errorEl.textContent = '请输入正确的端口号';
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
        
        // 编辑时若未输入密码，则沿用原密码。
        if (isEditMode && password === '') {
            // 不回填密码字段。
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
            successEl.textContent = isEditMode ? '数据库已更新' : '数据库已添加';
            successEl.classList.add('show');
            setTimeout(() => {
                hideAddDbModal();
                loadDatabases();
                if (isEditMode && currentDb && currentDb.id === editingDbId) {
                    // 刷新详情视图。
                    setTimeout(() => {
                        loadDatabaseDetail(editingDbId);
                    }, 300);
                }
            }, 1000);
        } else {
            errorEl.textContent = data.message || (isEditMode ? '更新失败' : '新增失败');
            errorEl.classList.add('show');
        }
    } catch (error) {
        errorEl.textContent = (isEditMode ? '更新失败：' : '新增失败：') + error.message;
        errorEl.classList.add('show');
    }
}

// 加载数据库列表并刷新当前选中项。
/**
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
            
            // 如果当前数据库仍存在，则同步刷新引用。
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
        console.error('加载数据库详情失败', error);
        showToast('加载数据库列表失败', 'error');
    }
}

// 渲染数据库列表。
function renderDatabaseList() {
    const listEl = document.getElementById('dbList');
    
    if (databases.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;color:#718096;padding:20px;">暂无数据库</div>';
        return;
    }

    // 达梦和 Oracle 排在前面。
    const priorityTypes = ['dm', 'oracle'];
    const sortedDatabases = [...databases].sort((a, b) => {
        const aIsPriority = priorityTypes.includes(a.type);
        const bIsPriority = priorityTypes.includes(b.type);
        if (aIsPriority && !bIsPriority) return -1;
        if (!aIsPriority && bIsPriority) return 1;
        return 0;
    });

    listEl.innerHTML = sortedDatabases.map(db => {
        const typeIcon = dbTypeIcons[db.type] || '🗃️';
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

// 选择数据库并加载详情。
function selectDatabase(dbId) {
    closeUserMgmtPanel(true);
    currentDb = databases.find(db => db.id === dbId);
    if (currentDb) {
        renderDatabaseList();
        showDatabaseLoading();
        loadDatabaseDetail(dbId);
    }
}

// 显示数据库加载状态。
function showDatabaseLoading() {
    closeUserMgmtPanel(true);
    document.getElementById('welcomeView').style.display = 'none';
    document.getElementById('dbDetailView').style.display = 'block';
    
    // 先显示占位信息。
    document.getElementById('dbName').innerHTML = '<span style="color:#718096;">加载中...</span>';
    document.getElementById('dbStatus').textContent = '加载中...';
    document.getElementById('dbStatus').className = 'info-value status';
    
    const listEl = document.getElementById('tablesList');
    listEl.innerHTML = `
        <div style="text-align:center;padding:40px;color:#718096;">
            <div class="loading-spinner"></div>
            <div style="margin-top:12px;">正在加载数据库详情...</div>
        </div>
    `;
    
    document.getElementById('tablePreview').style.display = 'none';
}

// 加载数据库详情。
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
            // 数据库未连接时展示错误状态。
            const listEl = document.getElementById('tablesList');
            listEl.innerHTML = `
                <div style="text-align:center;padding:40px;color:#e53e3e;">
                    <div style="font-size:48px;margin-bottom:12px;">⚠️</div>
                    <div>加载失败：${escapeHtml(data.message || '未知错误')}</div>
                </div>
            `;
        }
    } catch (error) {
        console.error('加载数据库详情失败', error);
        // 退回到通用错误状态。
        const listEl = document.getElementById('tablesList');
        listEl.innerHTML = `
            <div style="text-align:center;padding:40px;color:#e53e3e;">
                <div style="font-size:48px;margin-bottom:12px;">⚠️</div>
                <div>无法加载数据库详情，请稍后重试</div>
            </div>
        `;
    }
}

// 渲染数据表列表。
function renderTablesList(tables) {
    const listEl = document.getElementById('tablesList');
    
    if (tables.length === 0) {
        const dbNameEl = document.getElementById('dbDatabase');
        const currentDbName = dbNameEl ? dbNameEl.textContent : '';
        
        let hint = '';
        if (currentDb && currentDb.type === 'mongodb') {
            hint = `<div style="margin-top:12px;font-size:13px;color:#a0aec0;">
                当前库：<strong style="color:#718096;">${currentDbName}</strong><br/>
                如果是 MongoDB，请先检查是否选择了示例库 sample_mflix。
            </div>`;
        }
        
        listEl.innerHTML = `
            <div style="text-align:center;color:#718096;padding:40px;">
                <div style="font-size:48px;margin-bottom:12px;opacity:0.6;">📭</div>
                <div style="font-size:16px;">当前没有表数据</div>
                ${hint}
            </div>
        `;
        return;
    }

    // tables 可能是字符串数组或对象数组
    const tablesHtml = tables.map(table => {
        const tableName = typeof table === 'string' ? table : table.name;
        const tableComment = typeof table === 'object' ? (table.comment || '') : '';
        const displayName = tableComment 
            ? `<span class="table-name">${escapeHtml(tableName)}</span><span class="table-comment">${escapeHtml(tableComment)}</span>`
            : escapeHtml(tableName);
        return `
            <div class="table-item" onclick="previewTable('${escapeHtml(tableName)}')" title="${escapeHtml(tableComment || tableName)}">
                ${displayName}
            </div>
        `;
    }).join('');
    
    listEl.innerHTML = '<div class="tables-grid">' + tablesHtml + '</div>';
}

// 当前预览的表。
let currentPreviewTable = null;
let isTableEditMode = false;

// 预览指定数据表。
async function previewTable(tableName, keepEditMode = false) {
    if (!currentDb) {
        console.error('当前没有选中数据库');
        return;
    }

    currentPreviewTable = tableName;
    
    // 默认退出编辑模式。
    if (!keepEditMode) {
        isTableEditMode = false;
    }

    // 显示表格预览区域。
    document.getElementById('tablePreview').style.display = 'block';
    const previewContent = document.getElementById('previewContent');
    previewContent.innerHTML = `
        <div style="text-align:center;padding:60px;color:#718096;">
            <div class="loading-spinner"></div>
            <div style="margin-top:16px;">正在加载表结构...</div>
        </div>
    `;

    try {
        // 先加载字段结构。
        const structureResponse = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${tableName}/structure`);
        const structureData = await structureResponse.json();
        
        // 再加载表数据。
        const dataResponse = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${tableName}`);
        const data = await dataResponse.json();

        if (data.success) {
            document.getElementById('tablePreview').style.display = 'block';
            
            // 更新预览头部按钮。
            updatePreviewHeader();
            
            const previewContent = document.getElementById('previewContent');
            
            // 优先使用结构接口返回的字段名，其次使用首行数据推断。
            let columns = [];
            if (structureData.success && structureData.columns && structureData.columns.length > 0) {
                columns = structureData.columns.map(col => col.name);
            } else if (data.data && data.data.length > 0) {
                columns = Object.keys(data.data[0]);
            } else {
                // 如果结构接口失败，重试一次以避免偶发网络错误。
                const retryResp = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${encodeURIComponent(tableName)}/structure`);
                const retryData = await retryResp.json();
                if (retryData.success && retryData.columns && retryData.columns.length > 0) {
                    columns = retryData.columns.map(col => col.name);
                }
            }
            if (columns.length === 0) {
                // 仍然无法获取字段时，显示空状态。
                previewContent.innerHTML = `
                    <div style="text-align:center;padding:40px;">
                        <div style="font-size:48px;margin-bottom:16px;opacity:0.6;">📭</div>
                        <div style="color:#718096;font-size:16px;margin-bottom:12px;">当前表没有字段</div>
                        <div style="color:#a0aec0;font-size:14px;margin-bottom:16px;">请先确认数据库表结构是否可访问</div>
                        <button type="button" class="btn btn-primary" onclick="loadStructureAndRenderTable()">重新加载</button>
                    </div>
                `;
                return;
            }
            
            // 数据库连接测试与提交。
            const hasData = data.data && data.data.length > 0;
            const actionColumnHtml = isTableEditMode ? '<th class="action-column">操作</th>' : '';
            
            // 构建字段备注映射
            const columnComments = {};
            if (structureData.success && structureData.columns) {
                structureData.columns.forEach(col => {
                    if (col.comment) {
                        columnComments[col.name] = col.comment;
                    }
                });
            }
            
            const tableHtml = `
                <table class="preview-table" id="dataTable">
                    <thead>
                        <tr>
                            ${columns.map(col => {
                                const comment = columnComments[col];
                                return comment 
                                    ? `<th title="${escapeHtml(comment)}">${escapeHtml(col)}<span class="column-comment">${escapeHtml(comment)}</span></th>`
                                    : `<th>${escapeHtml(col)}</th>`;
                            }).join('')}
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
                                    ${isTableEditMode ? `<td class="action-column"><button class="btn-icon-delete" onclick="deleteTableRow('${rowId}')" title="删除">×</button></td>` : ''}
                                </tr>
                            `;
                        }).join('') : `
                            <tr class="empty-row">
                                <td colspan="${columns.length + (isTableEditMode ? 1 : 0)}" style="text-align:center;color:#718096;padding:20px;">
                                    ${isTableEditMode ? '当前无数据，可点击“添加行”继续编辑' : '暂无数据'}
                                </td>
                            </tr>
                        `}
                    </tbody>
                </table>
            `;
            
            previewContent.innerHTML = tableHtml;
            previewContent.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            
            // 隐藏新增数据库弹窗
            const table = document.getElementById('dataTable');
            if (isTableEditMode) {
                table.classList.add('editing-mode');
                enableTableEditing();
            } else {
                table.classList.remove('editing-mode');
                // 关闭编辑数据库弹窗
                const statsEl = document.getElementById('editStats');
                if (statsEl) {
                    statsEl.remove();
                }
            }
        }
    } catch (error) {
        console.error('预览表格失败', error);
        const previewContent = document.getElementById('previewContent');
        previewContent.innerHTML = '<div style="text-align:center;color:#e53e3e;padding:20px;">加载失败：' + escapeHtml(error.message) + '</div>';
    }
}

// 防止重复加载表结构。
let structureLoadingLock = false;

// 加载表结构并渲染空表格骨架。
async function loadStructureAndRenderTable(addOneRow) {
    if (!currentDb || !currentPreviewTable) return;
    if (structureLoadingLock) return;
    const previewContent = document.getElementById('previewContent');
    if (!previewContent) return;
    structureLoadingLock = true;
    previewContent.innerHTML = '<div style="text-align:center;padding:40px;color:#718096;">正在加载结构...</div>';
    try {
        const structureResponse = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${encodeURIComponent(currentPreviewTable)}/structure`, {
        });
        const structureData = await structureResponse.json();
        if (!structureData.success || !structureData.columns || structureData.columns.length === 0) {
            const msg = (structureData.message && structureData.message.trim()) ? structureData.message : '无法获取表结构';
            previewContent.innerHTML = '<div style="text-align:center;padding:40px;color:#e53e3e;">' + escapeHtml(msg) + '</div>';
            structureLoadingLock = false;
            return;
        }
        const columns = structureData.columns.map(col => col.name);
        const actionColumnHtml = isTableEditMode ? '<th class="action-column">操作</th>' : '';
        const emptyRowHtml = `
            <tr class="empty-row">
                <td colspan="${columns.length + (isTableEditMode ? 1 : 0)}" style="text-align:center;color:#718096;padding:20px;">
                    当前无数据，可点击“添加行”继续编辑
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

// 更新预览头部按钮与表名。
function updatePreviewHeader() {
    const actionsContainer = document.querySelector('#tablePreview .preview-actions');
    const tableNameEl = document.getElementById('previewTableName');
    
    if (!actionsContainer || !tableNameEl) {
        console.error('预览头部容器缺失');
        return;
    }
    
    // 更新当前表名。
    tableNameEl.textContent = currentPreviewTable;
    
    // 根据是否编辑模式生成按钮。
    const actionsHtml = isTableEditMode ? `
        <button id="addRowBtn" class="btn btn-sm btn-primary" onclick="addTableRow()">+ 添加行</button>
        <button id="saveTableBtn" class="btn btn-sm btn-primary" onclick="saveTableData()">保存数据</button>
        <button id="cancelEditBtn" class="btn btn-sm" onclick="cancelTableEdit()">取消</button>
    ` : `
        <button id="editTableBtn" class="btn btn-sm btn-primary" onclick="enableTableEditMode()">编辑数据</button>
        <button id="editStructureBtn" class="btn btn-sm btn-primary" onclick="showEditStructureModal()">编辑结构</button>
        <button id="renameTableBtn" class="btn btn-sm" onclick="showRenameTableModal()">重命名</button>
        <button id="dropTableBtn" class="btn btn-sm btn-danger" onclick="dropTable()">删除</button>
        <button id="closePreviewBtn" class="btn btn-sm" onclick="closePreview()">关闭</button>
    `;
    
    actionsContainer.innerHTML = actionsHtml;
}

// 启用表格编辑模式。
function enableTableEditMode() {
    if (!currentPreviewTable) {
        showToast('请先选择表', 'warning');
        return;
    }

    if (!currentDb) {
        showToast('请先选择数据库表', 'warning');
        return;
    }
    
    isTableEditMode = true;
    
    // 显示编辑模式加载态。
    const previewContent = document.getElementById('previewContent');
    if (previewContent) {
        const loadingHtml = '<div style="text-align:center;padding:40px;color:#667eea;"><div style="font-size:24px;margin-bottom:12px;">⏳</div><div>正在进入编辑模式...</div></div>';
        previewContent.innerHTML = loadingHtml;
    }
    
    // 创建流式消息占位。
    previewTable(currentPreviewTable, true);
}

// 启用表格单元格编辑。
function enableTableEditing() {
    const cells = document.querySelectorAll('.editable-cell');
    cells.forEach(cell => {
        cell.contentEditable = 'true';
        cell.classList.add('editing');
        
        // 清空 NULL 占位符。
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
            // 刷新编辑统计。
            updateEditStats();
        };
        
        // 绑定一次焦点和失焦事件。
        cell.removeEventListener('focus', focusHandler);
        cell.removeEventListener('blur', blurHandler);
        
        // 绑定焦点和失焦事件。
        cell.addEventListener('focus', focusHandler);
        cell.addEventListener('blur', blurHandler);
        
        // 保存事件句柄，便于后续清理。
        cell._focusHandler = focusHandler;
        cell._blurHandler = blurHandler;
    });
    
    // 更新编辑统计。
    updateEditStats();
}

// 显示保存成功提示。
function showSaveSuccess(message) {
    // 创建成功提示浮层。
    const toast = document.createElement('div');
    toast.className = 'save-success-toast';
    toast.innerHTML = `
        <div class="toast-icon">✓</div>
        <div class="toast-message">${message.replace(/\n/g, '<br>')}</div>
    `;
    
    document.body.appendChild(toast);
    
    // 解析用户输入的 JSON 参数。
    setTimeout(() => toast.classList.add('show'), 10);
    
    // 结束后自动消失。
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 1200);
}

// 更新编辑统计。
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
    
    // 如果统计条还不存在则创建。
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
            <span class="stats-label">编辑统计</span>
            ${normalCount > 0 ? `<span class="stats-badge stats-normal">${normalCount} 行原始</span>` : ''}
            ${newCount > 0 ? `<span class="stats-badge stats-new">+ ${newCount} 行新增</span>` : ''}
            ${deletedCount > 0 ? `<span class="stats-badge stats-deleted">- ${deletedCount} 行删除</span>` : ''}
        </span>
    ` : '<span class="stats-item"><span class="stats-label">无改动</span></span>';
    
    statsEl.innerHTML = statsHtml;
}

// 禁用表格编辑。
function disableTableEditing() {
    const cells = document.querySelectorAll('.editable-cell');
    cells.forEach(cell => {
        cell.contentEditable = 'false';
        cell.classList.remove('editing');
    });
}

// 取消表格编辑。
function cancelTableEdit() {
    isTableEditMode = false;
    disableTableEditing();
    
    // 移除编辑统计条。
    const statsEl = document.getElementById('editStats');
    if (statsEl) {
        statsEl.remove();
    }
    
    previewTable(currentPreviewTable);
}

// 新增表格行。
function addTableRow() {
    const table = document.getElementById('dataTable');
    if (!table) {
        // 如果表格不存在，先加载结构再继续。
        loadStructureAndRenderTable(true);
        return;
    }
    const tbody = table.querySelector('tbody');
    const headers = Array.from(table.querySelectorAll('thead th'))
        .slice(0, -1) // 去掉操作列
        .map(th => th.textContent);
    
    // 去除空状态行。
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
            <button class="btn-icon-delete" onclick="deleteTableRow('${rowId}')" title="删除">×</button>
        </td>
    `;
    
    tbody.appendChild(newRow);
    
    // 自动聚焦第一格。
    const firstCell = newRow.querySelector('.editable-cell');
    if (firstCell) {
        firstCell.focus();
        // 清除默认 NULL 占位。
        if (firstCell.querySelector('.null-value')) {
            firstCell.textContent = '';
        }
    }
    
    // 刷新统计。
    updateEditStats();
}

// 删除或恢复表格行。
function deleteTableRow(rowId) {
    const row = document.querySelector(`tr[data-row-id="${rowId}"]`);
    if (!row) {
        return;
    }
    
    // 新增行直接移除，已有行切换删除状态。
    if (row.dataset.isNew === 'true') {
        row.remove();
        
        // 如果删除后为空，恢复空状态行。
        const tbody = document.getElementById('dataTable').querySelector('tbody');
        if (tbody.children.length === 0) {
            const columns = Array.from(document.querySelectorAll('#dataTable thead th')).length;
            tbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="${columns}" style="text-align:center;color:#718096;padding:20px;">
                        当前无数据，可点击“添加行”继续编辑
                    </td>
                </tr>
            `;
        }
    } else {
        // 切换行删除标记。
        const deleteBtn = row.querySelector('.btn-icon-delete');
        
        if (row.dataset.deleted === 'true') {
            // 显示重试详情。
            row.dataset.deleted = 'false';
            row.classList.remove('row-deleted');
            if (deleteBtn) {
                deleteBtn.textContent = '×';
                deleteBtn.title = '删除';
            }
        } else {
            // 渲染返回答案。
            row.dataset.deleted = 'true';
            row.classList.add('row-deleted');
            if (deleteBtn) {
                deleteBtn.textContent = '↩';
                deleteBtn.title = '恢复';
            }
        }
    }
    
    // 颜色渐变。
    updateEditStats();
}

// 保存表格数据变更。
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
            // 隐藏API测试结果
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
    
    // 没有改动时直接返回。
    if (updates.length === 0 && inserts.length === 0 && deletes.length === 0) {
        showToast('没有需要保存的改动', 'info');
        return;
    }
    
    // 生成确认信息。
    const message = `确定保存以下变更？\n更新：${updates.length} 行\n新增：${inserts.length} 行\n删除：${deletes.length} 行`;
    if (!confirm(message)) {
        return;
    }
    
    // 清理欢迎区。
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
            // 保存成功后的提示信息。
            const successMsg = `保存成功\n更新：${updates.length} 行\n新增：${inserts.length} 行\n删除：${deletes.length} 行`;
            
            // 使用自定义提示而不是 alert。
            showSaveSuccess(successMsg);
            
            // 重新加载当前表格内容。
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

// 删除当前数据表。
async function dropTable() {
    if (!currentDb || !currentPreviewTable) return;
    
    if (!confirm(`确定删除数据表 “${currentPreviewTable}” 吗？此操作不可恢复。`)) {
        return;
    }
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${currentPreviewTable}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('删除成功', 'success');
            closePreview();
            loadDatabaseDetail(currentDb.id);
        } else {
            showToast('删除失败：' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('删除失败：' + error.message, 'error');
    }
}

// 关闭表格预览。
function closePreview() {
    document.getElementById('tablePreview').style.display = 'none';
    currentPreviewTable = null;
    isTableEditMode = false;
}

// 打开结构编辑弹窗。
async function showEditStructureModal() {
    if (!currentDb || !currentPreviewTable) return;
    
    try {
        // 读取当前表结构。
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${currentPreviewTable}/structure`);
        const data = await response.json();
        
        if (!data.success) {
            showToast('读取结构失败：' + (data.message || '未知错误'), 'error');
            return;
        }
        
        // 渲染结构编辑表单。
        renderEditStructure(data.columns || []);
        document.getElementById('editStructureModal').style.display = 'block';
    } catch (error) {
        showToast('读取结构失败：' + error.message, 'error');
    }
}

// 渲染结构编辑表单。
function renderEditStructure(columns) {
    const container = document.getElementById('structureColumnsContainer');
    
    let html = '';
    columns.forEach((col, index) => {
        html += `
            <div class="structure-column-item" data-index="${index}">
                <div class="structure-column-header">
                    <span class="column-number">#${index + 1}</span>
                    <input type="text" class="form-control" value="${col.name}" data-field="name" placeholder="字段名" />
                    <button type="button" class="btn-icon-delete" onclick="removeStructureColumn(${index})" title="删除">×</button>
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
                        <input type="text" class="form-control" data-field="size" placeholder="?: 255" 
                            value="${extractSize(col.type)}" />
                    </div>
                    <div class="form-group-inline">
                        <label>
                            <input type="checkbox" data-field="nullable" ${col.nullable ? 'checked' : ''} />
                            可为空
                        </label>
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// 提取字段类型中的长度信息。
function extractSize(typeStr) {
    const match = typeStr.match(/\((\d+)\)/);
    return match ? match[1] : '';
}

// 新增结构字段。
function addStructureColumn() {
    const container = document.getElementById('structureColumnsContainer');
    const index = container.children.length;
    
    const newColumn = document.createElement('div');
    newColumn.className = 'structure-column-item';
    newColumn.dataset.index = index;
    newColumn.innerHTML = `
        <div class="structure-column-header">
            <span class="column-number">#${index + 1}</span>
            <input type="text" class="form-control" data-field="name" placeholder="字段名" />
            <button type="button" class="btn-icon-delete" onclick="removeStructureColumn(${index})" title="删除">×</button>
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
                <input type="text" class="form-control" data-field="size" placeholder="例如：255" value="255" />
            </div>
            <div class="form-group-inline">
                <label>
                    <input type="checkbox" data-field="nullable" checked />
                    可为空
                </label>
            </div>
        </div>
    `;
    
    container.appendChild(newColumn);
}

// 删除结构字段。
function removeStructureColumn(index) {
    const item = document.querySelector(`.structure-column-item[data-index="${index}"]`);
    if (item) {
        item.remove();
    }
}

// 保存表结构变更。
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
        showToast('请至少保留一个字段', 'warning');
        return;
    }
    
    if (!confirm(`确定保存表 “${currentPreviewTable}” 的结构变更吗？\n此操作可能影响现有数据。`)) {
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
            showToast('结构已更新', 'success');
            closeEditStructureModal();
            previewTable(currentPreviewTable);
        } else {
            showToast('保存结构失败：' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('保存结构失败：' + error.message, 'error');
    }
}

// 关闭结构编辑弹窗。
function closeEditStructureModal() {
    document.getElementById('editStructureModal').style.display = 'none';
}

// 打开重命名表弹窗。
function showRenameTableModal() {
    if (!currentDb || !currentPreviewTable) return;
    document.getElementById('renameTableNewName').value = currentPreviewTable;
    document.getElementById('renameTableModal').classList.add('show');
}

// 获取数据库表列表
function hideRenameTableModal() {
    document.getElementById('renameTableModal').classList.remove('show');
}

// 获取列?
async function submitRenameTable() {
    if (!currentDb || !currentPreviewTable) return;
    const newName = document.getElementById('renameTableNewName').value.trim();
    if (!newName) {
        showToast('请先输入新的表名', 'warning');
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

// 删除当前数据库。
async function handleDeleteDatabase() {
    if (!currentDb) return;

    if (!confirm(`确定删除数据库 “${currentDb.name}” 吗？此操作不可恢复。`)) {
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

// ==================== API Key 管理 ====================

// ---- API Key ----

async function loadApiKey() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/apikey`);
        const data = await response.json();
        if (data.success) {
            currentApiKey = data.api_key || '';
            renderApiKeyUI();
        }
    } catch (e) {
        console.error('加载 API Key 失败', e);
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
        console.error('生成 API Key 失败', e);
        showToast('生成 API Key 失败', 'error');
    }
}

async function deleteApiKey() {
    if (!confirm('确定删除当前 API Key 吗？删除后相关调用将失效。')) return;
    
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
            showToast(data.message || '保存失败', 'error');
            deleteBtn.disabled = false;
            deleteBtn.textContent = originalText;
        }
    } catch (e) {
        console.error('加载 API Key 失败', e);
        showToast('加载 API Key 失败', 'error');
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
        const masked = currentApiKey.substring(0, 8) + '********' + currentApiKey.substring(currentApiKey.length - 4);
        const safeKey = escapeHtml(currentApiKey);
        const safeMasked = escapeHtml(masked);
        contentEl.innerHTML = `<code class="apikey-value" title="${safeKey}">${safeMasked}</code>`;
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

// MCP 配置展示与生成。
let mcpConfigEnabled = true;
let mcpConfigPort = 0;
async function loadMcpInfo() {
    await loadApiKey();
    try {
        const r = await fetchWithAuth(`${API_BASE}/api/data-ontology/mcp/config`);
        const data = await r.json();
        if (data.success) {
            mcpConfigEnabled = data.enabled !== false;
            mcpConfigPort = data.port || 0;
        }
    } catch (e) { mcpConfigEnabled = true; mcpConfigPort = 0; }
    const mcpCb = document.getElementById('mcpEnabledCheck');
    if (mcpCb) mcpCb.checked = mcpConfigEnabled;
    const mcpPortInput = document.getElementById('mcpPortInput');
    if (mcpPortInput) mcpPortInput.value = mcpConfigPort || '';
    updateMcpDisplay();
    // 加载安全配置
    await loadMcpSafeConfig();
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

// MCP 安全配置
async function loadMcpSafeConfig() {
    try {
        const r = await fetchWithAuth(`${API_BASE}/api/data-ontology/mcp/safe-config`);
        const data = await r.json();
        if (data.success && data.config) {
            const config = data.config;
            const readOnlyCb = document.getElementById('mcpReadOnlyMode');
            const blockDangerousCb = document.getElementById('mcpBlockDangerous');
            const blockedKeywordsEl = document.getElementById('mcpBlockedKeywords');
            const allowedTablesEl = document.getElementById('mcpAllowedTables');
            
            if (readOnlyCb) readOnlyCb.checked = config.read_only_mode || false;
            if (blockDangerousCb) blockDangerousCb.checked = config.block_dangerous || false;
            if (blockedKeywordsEl && config.blocked_keywords) {
                blockedKeywordsEl.value = config.blocked_keywords.join('\n');
            }
            if (allowedTablesEl && config.allowed_tables) {
                allowedTablesEl.value = config.allowed_tables.join('\n');
            }
        }
    } catch (e) {
        console.error('加载 MCP 安全配置失败:', e);
    }
}

async function saveMcpSafeConfig() {
    const readOnlyCb = document.getElementById('mcpReadOnlyMode');
    const blockDangerousCb = document.getElementById('mcpBlockDangerous');
    const blockedKeywordsEl = document.getElementById('mcpBlockedKeywords');
    const allowedTablesEl = document.getElementById('mcpAllowedTables');
    
    const config = {
        read_only_mode: readOnlyCb ? readOnlyCb.checked : false,
        block_dangerous: blockDangerousCb ? blockDangerousCb.checked : false,
        blocked_keywords: blockedKeywordsEl ? blockedKeywordsEl.value.split('\n').map(s => s.trim()).filter(s => s) : [],
        allowed_tables: allowedTablesEl ? allowedTablesEl.value.split('\n').map(s => s.trim()).filter(s => s) : []
    };
    
    try {
        const r = await fetchWithAuth(`${API_BASE}/api/data-ontology/mcp/safe-config`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ config })
        });
        const data = await r.json();
        if (data.success) {
            showToast('安全配置已保存');
        }
    } catch (e) {
        console.error('保存 MCP 安全配置失败:', e);
        showToast('保存失败', 'error');
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
        keyEl.textContent = currentApiKey.substring(0, 8) + '********' + currentApiKey.substring(currentApiKey.length - 4);
        keyEl.title = currentApiKey;
        if (copyKeyBtn) copyKeyBtn.style.display = '';
        if (genKeyBtn) genKeyBtn.textContent = '重新生成';
    } else {
        keyEl.textContent = '未生成';
        keyEl.title = '';
        if (copyKeyBtn) copyKeyBtn.style.display = 'none';
        if (genKeyBtn) genKeyBtn.textContent = '生成 API Key';
    }

    const key = currentApiKey || '<YOUR_API_KEY>';
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
            '请先在当前平台生成 API Key，然后在 MCP 客户端中配置连接。',
            '在 Cursor 的设置里打开 MCP，点击 “Add new MCP server”，将配置保存到 <code>~/.cursor/mcp.json</code>；Windows 可使用 <code>%USERPROFILE%\\.cursor\\mcp.json</code>。',
            '完成后重启 Cursor，即可开始使用 MCP。'
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
            '在 Claude Desktop 中启用 MCP。',
            '将配置写入 <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>（macOS）或 <code>%APPDATA%\\Claude\\claude_desktop_config.json</code>（Windows），并确认 <code>mcpServers</code> 配置正确。',
            '保存后重启 Claude Desktop。'
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
            '在 Cherry Studio 中添加 MCP 服务器。',
            '进入 MCP 配置页，选择导入 JSON 或手动创建服务器配置。',
            '保存后刷新连接状态。'
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
            '在 Dify 中配置 MCP 工具连接。',
            '建议先安装可用的 MCP 插件，再在服务器配置中填入当前平台的 MCP 地址。',
            '如使用反向代理，请确保请求超时足够长。'
        ];
    } else {
        configText = `# Stdio 模式示例，适用于本地运行 datatoolbox-server。\n\n# 环境变量\nexport DATA_ONTOLOGY_BASE_URL="${baseUrl}"\nexport DATA_ONTOLOGY_API_KEY="${key}"\n\n# 启动命令\n# Linux/macOS: ./datatoolbox-server mcp\n# Windows PowerShell:\n#   $env:DATA_ONTOLOGY_BASE_URL="${baseUrl}"\n#   $env:DATA_ONTOLOGY_API_KEY="${key}"\n#   .\\datatoolbox-server.exe mcp`;
        steps = [
            '适用于 GitHub Release 或本地构建的 datatoolbox-server。',
            '使用 stdio 模式启动后，再在 MCP 客户端中填入对应的可执行文件和参数。',
            '如仅需 HTTP 访问，建议优先使用前面的客户端配置方式。'
        ];
    }
    if (configPre) configPre.textContent = configText;
    if (stepsList) stepsList.innerHTML = steps.map((s, i) => `<li>${s}</li>`).join('');
}

// 加载 API 列表。
async function loadApis() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/apis`);

        const data = await response.json();

        if (data.success) {
            apis = data.apis || [];
            renderApiList();
        }
    } catch (error) {
        console.error('加载 API 列表失败', error);
        showToast('加载 API 列表失败', 'error');
    }
}

// 过滤 API 列表。
function filterApiList() {
    renderApiList();
}

// 渲染 API 列表。
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
        listEl.innerHTML = `<div style="text-align:center;color:#718096;padding:20px;">${keyword ? '未找到匹配 API' : '暂无 API'}</div>`;
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
                <label class="switch-wrap" onclick="event.stopPropagation(); toggleApiEnabled('${safeApiId}')" title="${enabled ? '禁用' : '启用'}" style="flex-shrink:0;">
                    <input type="checkbox" ${enabled ? 'checked' : ''} onchange="event.stopPropagation()">
                    <span class="switch-slider"></span>
                </label>
            </div>
        `;
    }).join('');
}

// 选择 API。
function selectApi(apiId) {
    currentApi = apis.find(api => api.id === apiId);
    if (currentApi) {
        renderApiList();
        loadApiDetail(apiId);
    }
}

// 切换 API 启用状态，forceEnabled 为 undefined 时自动翻转。
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
        console.error('切换 API 状态失败', e);
        showToast('切换 API 状态失败', 'error');
    }
}

function toggleApiEnabledFromDetail() {
    if (!currentApi) return;
    const cb = document.getElementById('apiDetailEnabledCheck');
    if (!cb) return;
    toggleApiEnabled(currentApi.id, cb.checked);
}

// 加载 API 详情。
async function loadApiDetail(apiId) {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/apis/${apiId}`);

        const data = await response.json();

        if (data.success) {
            // 同步当前选中的 API。
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
            document.getElementById('apiTypeDisplay').textContent = apiType === 'forward' ? 'HTTP 转发' : '查询接口';

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
            
            // 查询接口才需要解析参数。
            const params = apiType === 'forward' ? [] : parseMyBatisParams(api.sql || '');
            renderApiParams(params);
            
            // 渲染代码示例。
            renderCodeExamples(api);
        }
    } catch (error) {
        console.error('加载 API 详情失败', error);
        showToast('加载 API 详情失败', 'error');
    }
}

// 解析 MyBatis 参数。
function parseMyBatisParams(sql) {
    const paramsMap = new Map();
    
    // 匹配 #{paramName} 形式的参数。
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
    
    // 匹配 ${paramName} 形式的直接替换参数。
    const dollarPattern = /\$\{([^}]+)\}/g;
    while ((match = dollarPattern.exec(sql)) !== null) {
        const paramName = match[1].trim();
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

// 渲染 SQL 参数区。
function renderApiParams(params) {
    const displayEl = document.getElementById('apiParamsDisplay');
    
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
                            <div class="error-title">SQL 语法异常</div>
                            <div class="error-message">${errorWarnings[0].message}</div>
                            <div class="error-fix">
                                <strong>修复建议</strong>
                                <div class="fix-example">
                                    <div class="fix-before">原始：${escapeHtml(currentApi.sql)}</div>
                                    <div class="fix-after">修正：${escapeHtml(currentApi.sql.replace(/#\{/g, '${'))}</div>
                                </div>
                                <button class="btn btn-sm btn-primary" onclick="quickFixSql()" style="margin-top:8px;">一键修复</button>
                            </div>
                        </div>
                    </div>
                `;
            }
        }
    }
    
    if (params.length === 0) {
        displayEl.innerHTML = sqlWarningHtml + '<div style="text-align:center;color:#718096;padding:12px;">暂无参数</div>';
        return;
    }
    
    const paramsHtml = params.map(param => {
        const typeLabel = param.type === 'prepared' ? '预编译' : '直接拼接';
        const typeClass = param.required ? 'required' : 'optional';
        const requiredLabel = param.required ? '必填' : '可选';
        
        let defaultValue = '';
        if (currentApi && currentApi.default_params && currentApi.default_params[param.name] !== undefined) {
            const val = currentApi.default_params[param.name];
            defaultValue = `<span style="color:#48bb78;margin-left:8px;font-size:12px;">默认值: ${typeof val === 'string' ? '"' + val + '"' : val}</span>`;
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

// 代码示例上下文。
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
 * Generate JavaScript/Node.js example code.
 * @param {Object} ctx - Example context.
 * @returns {string} Generated code.
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

// JavaScript 与 Node.js 共用同一模板。
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
            <button class="code-copy-btn" title="复制代码">复制</button>
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
                btn.textContent = '已复制';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.textContent = original;
                    btn.classList.remove('copied');
                }, 2000);
            });
        }
    });
}

// 快速修复 SQL 参数语法。
async function quickFixSql() {
    if (!currentApi) return;
    
    if (!confirm('将 SQL 中的 #{} 与 ${} 参数写法统一为合法格式吗？')) {
        return;
    }
    
    // 替换 SQL 中的参数占位符。
    const fixedSql = currentApi.sql.replace(/#\{/g, '${');
    
    // 处理API类型
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
            showToast('修复成功', 'success');
            loadApiDetail(currentApi.id);
        } else {
            showToast('修复失败：' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('修复失败：' + error.message, 'error');
    }
}

// 切换 API 类型表单字段。
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

// 打开新增 API 弹窗。
async function showAddApiModal() {
    isEditApiMode = false;
    editingApiId = null;
    document.getElementById('apiModalTitle').textContent = '新增 API';
    document.getElementById('addApiModal').classList.add('show');
    document.getElementById('addApiForm').reset();
    document.getElementById('apiFormError').classList.remove('show');
    document.getElementById('apiFormSuccess').classList.remove('show');
    // 默认选择查询接口。
    document.getElementById('apiTypeQuery').checked = true;
    switchApiTypeFields('query');
    // 填充默认参数。
    await loadDatabasesForSelect();
}

    // 加载API列表
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
            
            // 保留当前选中的数据库。
            if (currentValue) {
                selectEl.value = currentValue;
            }
        }
    } catch (error) {
        console.error('刷新API列表失败', error);
    }
}

// 关闭新增 API 弹窗。
function hideAddApiModal() {
    const form = document.getElementById('addApiForm');
    document.getElementById('addApiModal').classList.remove('show');
    isEditApiMode = false;
    editingApiId = null;
    
    // 清除 AI 填充标记。
    delete form.dataset.fromAi;
    delete form.dataset.aiMessageId;
    
    // 刷新API列表
    form.reset();
}

// 提交新增或编辑 API 表单。
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

    // 初始化一行默认列。
    if (!apiData.name) {
        showApiFormError('请输入 API 名称');
        return;
    }

    // 删除API
    if (!apiData.path) {
        showApiFormError('请输入请求路径');
        return;
    }

    // 初始化默认列。
    if (!apiData.path.startsWith('/')) {
        showApiFormError('路径必须以 / 开头');
        return;
    }

    if (apiType === 'forward') {
        apiData.forward_url = document.getElementById('apiForwardUrlInput').value.trim();
        if (!apiData.forward_url) {
            showApiFormError('请输入转发 URL');
            return;
        }
        // URL参数解析
        try {
            new URL(apiData.forward_url);
        } catch {
            showApiFormError('请输入有效的 URL');
            return;
        }
    } else {
        apiData.database_id = document.getElementById('apiDbSelect').value;
        apiData.sql = document.getElementById('apiSqlInput').value.trim();
        
        // SQL校验
        if (!apiData.sql) {
            showApiFormError('请输入 SQL');
            return;
        }
    }

    // 解析MyBatis参数
    const defaultParamsText = document.getElementById('apiDefaultParamsInput').value.trim();
    if (defaultParamsText) {
        try {
            apiData.default_params = JSON.parse(defaultParamsText);
        } catch (error) {
            showApiFormError('默认参数必须是合法 JSON');
            return;
        }
    }

    // query类型需要校验SQL
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
                if (!confirm('SQL 存在警告，是否仍然继续保存？\n\n' + warningMsg + '\n\n继续将按当前内容提交。')) {
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
            
            successEl.textContent = isEditApiMode ? 'API 已更新' : 'API 已创建';
            successEl.classList.add('show');
            
            setTimeout(() => {
                hideAddApiModal();
                loadApis();
                
                // 如果是 AI 生成的表单，回写成功消息。
                if (isFromAi) {
                    const messagesEl = document.getElementById('aiChatMessages');
                    const messageId = 'msg-success-' + Date.now();
                    const messageHtml = `
                        <div class="ai-message assistant" id="${messageId}">
                            <div class="ai-message-avatar">${getAiAvatarSvg()}</div>
                            <div class="ai-message-content">
                                <div style="padding: 12px; background: #d4edda; border-left: 3px solid #28a745; border-radius: 6px; color: #155724; font-size: 14px;">
                                    <strong>创建成功</strong><br>
                                    <span style="font-size: 13px; margin-top: 4px; display: block;">
                                        名称：${escapeHtml(apiData.name)}<br>
                                        路径：${escapeHtml(apiData.path)}<br>
                                        已同步到“API 列表”中。
                                    </span>
                                </div>
                            </div>
                        </div>
                    `;
                    messagesEl.insertAdjacentHTML('beforeend', messageHtml);
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                    
                    // 清理 AI 标记。
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
            showApiFormError(data.message || (isEditApiMode ? '更新失败' : '创建失败'));
        }
    } catch (error) {
        showApiFormError((isEditApiMode ? '更新失败：' : '创建失败：') + error.message);
    }
}

// 显示 API 表单错误。
function showApiFormError(message) {
    const errorEl = document.getElementById('apiFormError');
    errorEl.textContent = message;
    errorEl.classList.add('show');
}

// 校验 SQL 语法风险。
function validateSqlSyntax(sql) {
    const warnings = [];
    
    // DDL 与参数占位符冲突时给出错误提示。
    const isDDL = /^\s*(CREATE|DROP|ALTER|TRUNCATE)\s+/i.test(sql);
    const hasPreparedParams = /#\{[^}]+\}/g.test(sql);
    
    if (isDDL && hasPreparedParams) {
        warnings.push({
            type: 'error',
            message: 'DDL 语句不应同时使用 #{} 预编译参数；请改用 ${} 或普通 SQL。'
        });
    }
    
    // 检测 ${} 风险占位符。
    const hasDirectReplace = /\$\{[^}]+\}/g.test(sql);
    if (hasDirectReplace && !isDDL) {
        warnings.push({
            type: 'warning',
            message: '检测到 ${} 直接拼接参数，若参数来自用户输入，建议改为 #{} 预编译参数。'
        });
    }
    
    return warnings;
}

// 打开编辑 API 弹窗。
async function handleEditApi() {
    if (!currentApi) return;
    
    isEditApiMode = true;
    editingApiId = currentApi.id;
    document.getElementById('apiModalTitle').textContent = '编辑 API';
    document.getElementById('addApiModal').classList.add('show');
    
    // 执行SQL查询
    document.getElementById('apiNameInput').value = currentApi.name;
    document.getElementById('apiPathInput').value = currentApi.path;
    document.getElementById('apiMethodInput').value = currentApi.method;
    document.getElementById('apiDescInput').value = currentApi.description || '';
    
    // 恢复编辑模式时同步配置。
    const editType = currentApi.type || 'query';
    document.getElementById(editType === 'forward' ? 'apiTypeForward' : 'apiTypeQuery').checked = true;
    switchApiTypeFields(editType);
    
    if (editType === 'forward') {
        document.getElementById('apiForwardUrlInput').value = currentApi.forward_url || '';
    } else {
        document.getElementById('apiSqlInput').value = currentApi.sql || '';
    }
    
    // 切换API类型
    if (currentApi.default_params && Object.keys(currentApi.default_params).length > 0) {
        document.getElementById('apiDefaultParamsInput').value = JSON.stringify(currentApi.default_params, null, 2);
    } else {
        document.getElementById('apiDefaultParamsInput').value = '';
    }
    
    // 如果有结果，则把结果表附在消息下方。
    await loadDatabasesForSelect();
    document.getElementById('apiDbSelect').value = currentApi.database_id;
    
    document.getElementById('apiFormError').classList.remove('show');
    document.getElementById('apiFormSuccess').classList.remove('show');
}

// 删除当前 API。
async function handleDeleteApi() {
    if (!currentApi) return;

    if (!confirm(`确定删除 API “${currentApi.name}” 吗？此操作不可恢复。`)) {
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
            deleteBtn.disabled = false;
            deleteBtn.textContent = originalText;
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

// 打开测试 API 弹窗。
function showTestApiModal() {
    if (!currentApi) return;
    
    document.getElementById('testApiModal').classList.add('show');
    document.getElementById('testApiPath').textContent = currentApi.path;
    document.getElementById('testApiMethod').textContent = currentApi.method;
    document.getElementById('testApiParams').value = '';
    document.getElementById('testApiError').classList.remove('show');
    document.getElementById('testApiResultGroup').style.display = 'none';
    
    // 勾选设置?
    const apiType = currentApi.type || 'query';
    if (apiType === 'forward') {
        // 显示API测试结果弹窗
        if (currentApi.default_params && Object.keys(currentApi.default_params).length > 0) {
            document.getElementById('testApiParams').value = JSON.stringify(currentApi.default_params, null, 2);
        }
    } else {
        // query类型 SQL 参数
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

// 关闭测试 API 弹窗。
function hideTestApiModal() {
    document.getElementById('testApiModal').classList.remove('show');
}

// 执行 API 测试。
// 存储测试结果数据
let testResultData = null;

async function executeApiTest() {
    if (!currentApi) return;

    const paramsText = document.getElementById('testApiParams').value.trim();
    let params = {};

    // 搜索数据库
    if (paramsText) {
        try {
            params = JSON.parse(paramsText);
        } catch (error) {
            showTestApiError('测试参数必须是合法 JSON');
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
            // 保存结果数据
            testResultData = data.data;

            document.getElementById('testResultStatus').textContent = '成功';
            document.getElementById('testResultStatus').style.color = '#38a169';
            document.getElementById('testResultTime').textContent = duration;
            document.getElementById('testResultContent').textContent = JSON.stringify(data.data, null, 2);

            // 渲染表格视图
            renderTestResultTable(data.data);

            resultGroup.style.display = 'block';

            // 重置为 JSON 视图
            switchTestResultView('json');
        } else {
            showTestApiError(data.message || '测试失败');
        }
    } catch (error) {
        showTestApiError('测试失败：' + error.message);
    }
}

// 显示测试 API 错误。
function showTestApiError(message) {
    const errorEl = document.getElementById('testApiError');
    errorEl.textContent = message;
    errorEl.classList.add('show');
}

// 切换测试结果视图
function switchTestResultView(view) {
    const jsonView = document.getElementById('testResultJson');
    const tableView = document.getElementById('testResultTable');
    const buttons = document.querySelectorAll('.view-toggle-btn');

    buttons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.view === view) {
            btn.classList.add('active');
        }
    });

    if (view === 'json') {
        jsonView.style.display = 'block';
        tableView.style.display = 'none';
    } else {
        jsonView.style.display = 'none';
        tableView.style.display = 'block';
    }
}

// 渲染测试结果表格
function renderTestResultTable(data) {
    const container = document.getElementById('testResultTableContent');

    if (!data) {
        container.innerHTML = '<div class="table-empty">暂无数据</div>';
        return;
    }

    // 如果是数组
    if (Array.isArray(data)) {
        if (data.length === 0) {
            container.innerHTML = '<div class="table-empty">空数组</div>';
            return;
        }
        container.innerHTML = renderArrayTable(data);
    }
    // 如果是对象
    else if (typeof data === 'object') {
        container.innerHTML = renderObjectTable(data);
    }
    // 其他类型
    else {
        container.innerHTML = renderPrimitiveValue(data);
    }
}

// 渲染数组表格
function renderArrayTable(arr) {
    if (arr.length === 0) return '<div class="table-empty">空数组</div>';

    // 检查数组元素是否都是对象
    const isObjectArray = arr.every(item => typeof item === 'object' && item !== null && !Array.isArray(item));

    if (isObjectArray) {
        // 获取所有可能的键
        const allKeys = new Set();
        arr.forEach(item => {
            if (item && typeof item === 'object') {
                Object.keys(item).forEach(key => allKeys.add(key));
            }
        });
        const keys = Array.from(allKeys);

        let html = '<div class="table-wrapper"><table class="data-table">';
        html += '<thead><tr>';
        keys.forEach(key => {
            html += `<th>${escapeHtml(key)}</th>`;
        });
        html += '</tr></thead><tbody>';

        arr.forEach((item, index) => {
            html += `<tr class="${index % 2 === 0 ? 'even' : 'odd'}">`;
            keys.forEach(key => {
                const value = item && item[key];
                html += `<td>${renderCellValue(value)}</td>`;
            });
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    } else {
        // 简单数组
        let html = '<div class="table-wrapper"><table class="data-table">';
        html += '<thead><tr><th>索引</th><th>值</th></tr></thead><tbody>';

        arr.forEach((item, index) => {
            html += `<tr class="${index % 2 === 0 ? 'even' : 'odd'}">`;
            html += `<td>${index}</td>`;
            html += `<td>${renderCellValue(item)}</td>`;
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    }
}

// 渲染对象表格
function renderObjectTable(obj) {
    const keys = Object.keys(obj);

    if (keys.length === 0) {
        return '<div class="table-empty">空对象</div>';
    }

    let html = '<div class="table-wrapper"><table class="data-table">';
    html += '<thead><tr><th>键</th><th>值</th></tr></thead><tbody>';

    keys.forEach((key, index) => {
        html += `<tr class="${index % 2 === 0 ? 'even' : 'odd'}">`;
        html += `<td><strong>${escapeHtml(key)}</strong></td>`;
        html += `<td>${renderCellValue(obj[key])}</td>`;
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
}

// 渲染单元格值
function renderCellValue(value, depth = 0) {
    if (depth > 3) {
        return '<span class="value-deep">...</span>';
    }

    if (value === null) {
        return '<span class="value-null">null</span>';
    }

    if (value === undefined) {
        return '<span class="value-undefined">undefined</span>';
    }

    if (typeof value === 'boolean') {
        return `<span class="value-boolean">${value}</span>`;
    }

    if (typeof value === 'number') {
        return `<span class="value-number">${value}</span>`;
    }

    if (typeof value === 'string') {
        return `<span class="value-string">"${escapeHtml(value)}"</span>`;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return '<span class="value-array">[]</span>';
        }
        if (value.length <= 5 && depth < 2) {
            const items = value.map(item => renderCellValue(item, depth + 1)).join(', ');
            return `<span class="value-array">[${items}]</span>`;
        }
        return `<span class="value-array">Array(${value.length})</span>`;
    }

    if (typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 0) {
            return '<span class="value-object">{}</span>';
        }
        if (keys.length <= 3 && depth < 2) {
            const items = keys.map(key => {
                return `<span class="object-key">${escapeHtml(key)}</span>: ${renderCellValue(value[key], depth + 1)}`;
            }).join(', ');
            return `<span class="value-object">{${items}}</span>`;
        }
        return `<span class="value-object">Object{${keys.length} keys}</span>`;
    }

    return escapeHtml(String(value));
}

// 渲染原始值
function renderPrimitiveValue(value) {
    return `<div class="primitive-value">${renderCellValue(value)}</div>`;
}

// HTML 转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== AI 配置 ====================

// 加载 AI 配置。
async function loadAiConfig() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/ai/config`);

        const data = await response.json();

        if (data.success && data.config) {
            aiConfig = data.config;
        }

        // 同时加载AI能力信息
        await loadAiCapabilities();
    } catch (error) {
        console.error('加载 AI 配置失败', error);
    }
}

// 打开 AI 设置弹窗。
function showAiSettingsModal() {
    document.getElementById('aiSettingsModal').classList.add('show');
    
    if (aiConfig) {
        document.getElementById('aiUrlInput').value = aiConfig.url || '';
        document.getElementById('aiApiKeyInput').value = aiConfig.api_key || '';
        document.getElementById('aiModelInput').value = aiConfig.model || '';
        document.getElementById('aiTimeoutInput').value = aiConfig.timeout || '';
        
        // 加载能力设置
        if (aiConfig.enable_function_call !== undefined && aiConfig.enable_function_call !== null) {
            document.getElementById('aiEnableFunctionCall').checked = aiConfig.enable_function_call;
        }
        if (aiConfig.enable_thinking !== undefined && aiConfig.enable_thinking !== null) {
            document.getElementById('aiEnableThinking').checked = aiConfig.enable_thinking;
        }
        if (aiConfig.enable_streaming !== undefined && aiConfig.enable_streaming !== null) {
            document.getElementById('aiEnableStreaming').checked = aiConfig.enable_streaming;
        }
        if (aiConfig.enable_json_mode !== undefined && aiConfig.enable_json_mode !== null) {
            document.getElementById('aiEnableJSONMode').checked = aiConfig.enable_json_mode;
        }
        document.getElementById('aiContextWindow').value = aiConfig.context_window_override || 0;
        
        // 表检索配置
        if (aiConfig.table_retrieval) {
            const tr = aiConfig.table_retrieval;
            document.getElementById('aiRetrievalStrategy').value = tr.strategy || 'keyword';
            document.getElementById('aiMaxTables').value = tr.max_tables || 15;
            document.getElementById('aiMinRelevance').value = tr.min_relevance_score || 0.3;
            document.getElementById('aiMinRelevanceValue').textContent = tr.min_relevance_score || 0.3;
            document.getElementById('aiIncludeFields').checked = tr.include_fields !== false;
            document.getElementById('aiMaxFields').value = tr.max_fields_per_table || 50;
            if (tr.keyword_config && tr.keyword_config.match_fields) {
                document.getElementById('aiMatchName').checked = tr.keyword_config.match_fields.includes('name');
                document.getElementById('aiMatchComment').checked = tr.keyword_config.match_fields.includes('comment');
                document.getElementById('aiMatchColumns').checked = tr.keyword_config.match_fields.includes('column_names');
            }
        }
    } else {
        document.getElementById('aiSettingsForm').reset();
    }
    
    // 显示能力检测结果
    updateCapabilityHints();
    
    document.getElementById('aiSettingsError').classList.remove('show');
    document.getElementById('aiSettingsSuccess').classList.remove('show');
}

// 关闭 AI 设置弹窗。
function hideAiSettingsModal() {
    document.getElementById('aiSettingsModal').classList.remove('show');
}

// 加载AI能力信息
async function loadAiCapabilities() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/ai/capabilities`);
        const data = await response.json();
        if (data.success && data.capabilities) {
            aiCapabilities = data.capabilities;
            console.log('AI模型能力:', aiCapabilities);
            return aiCapabilities;
        }
    } catch (error) {
        console.error('加载AI能力失败:', error);
    }
    return null;
}

// 显示AI能力信息（可选，用于调试或显示给用户）
function displayAiCapabilities() {
    if (!aiCapabilities) return;

    const capInfo = `
AI模型能力检测结果:
- Function Call支持: ${aiCapabilities.supports_function_call ? '✓' : '✗'}
- Thinking模式支持: ${aiCapabilities.supports_thinking ? '✓' : '✗'}
- 流式输出支持: ${aiCapabilities.supports_streaming ? '✓' : '✗'}
- JSON模式支持: ${aiCapabilities.supports_json_mode ? '✓' : '✗'}
- 上下文窗口: ${aiCapabilities.context_window} tokens
    `;
    console.log(capInfo);
}

// 更新能力提示信息
function updateCapabilityHints() {
    if (!aiCapabilities) {
        document.getElementById('functionCallHint').textContent = '未检测';
        document.getElementById('thinkingHint').textContent = '未检测';
        document.getElementById('streamingHint').textContent = '未检测';
        document.getElementById('jsonModeHint').textContent = '未检测';
        document.getElementById('contextWindowHint').textContent = '未检测';
        return;
    }
    
    const fcHint = document.getElementById('functionCallHint');
    fcHint.textContent = aiCapabilities.supports_function_call ? '✓ 支持' : '✗ 不支持';
    fcHint.className = 'capability-hint ' + (aiCapabilities.supports_function_call ? 'supported' : 'not-supported');
    
    const thinkHint = document.getElementById('thinkingHint');
    thinkHint.textContent = aiCapabilities.supports_thinking ? '✓ 支持' : '✗ 不支持';
    thinkHint.className = 'capability-hint ' + (aiCapabilities.supports_thinking ? 'supported' : 'not-supported');
    
    const streamHint = document.getElementById('streamingHint');
    streamHint.textContent = aiCapabilities.supports_streaming ? '✓ 支持' : '✗ 不支持';
    streamHint.className = 'capability-hint ' + (aiCapabilities.supports_streaming ? 'supported' : 'not-supported');
    
    const jsonHint = document.getElementById('jsonModeHint');
    jsonHint.textContent = aiCapabilities.supports_json_mode ? '✓ 支持' : '✗ 不支持';
    jsonHint.className = 'capability-hint ' + (aiCapabilities.supports_json_mode ? 'supported' : 'not-supported');
    
    const ctxHint = document.getElementById('contextWindowHint');
    ctxHint.textContent = `${aiCapabilities.context_window} tokens`;
    ctxHint.className = 'capability-hint supported';
}

// 自动检测模型能力
async function detectAiCapabilities() {
    const btn = document.getElementById('detectCapabilitiesBtn');
    btn.disabled = true;
    btn.textContent = '检测中...';
    
    try {
        // 先保存当前配置（触发后端检测）
        const timeoutValue = parseInt(document.getElementById('aiTimeoutInput').value, 10);
        const config = {
            url: document.getElementById('aiUrlInput').value,
            api_key: document.getElementById('aiApiKeyInput').value,
            model: document.getElementById('aiModelInput').value,
            timeout: Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : 120
        };
        
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/ai/config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });
        
        const data = await response.json();
        
        console.log('[AI能力检测] 返回数据:', data);
        console.log('[AI能力检测] capabilities:', data.capabilities);
        console.log('[AI能力检测] context_window:', data.capabilities?.context_window);
        
        if (data.success && data.capabilities) {
            aiCapabilities = data.capabilities;
            updateCapabilityHints();
            
            // 根据检测结果自动勾选
            document.getElementById('aiEnableFunctionCall').checked = aiCapabilities.supports_function_call;
            document.getElementById('aiEnableThinking').checked = aiCapabilities.supports_thinking;
            document.getElementById('aiEnableStreaming').checked = aiCapabilities.supports_streaming;
            document.getElementById('aiEnableJSONMode').checked = aiCapabilities.supports_json_mode;
            document.getElementById('aiContextWindow').value = aiCapabilities.context_window || 0;
            console.log('[AI能力检测] 设置输入框值为:', aiCapabilities.context_window || 0);
            
            btn.textContent = '检测完成';
            setTimeout(() => {
                btn.textContent = '自动检测模型能力';
                btn.disabled = false;
            }, 2000);
        } else {
            throw new Error(data.message || '检测失败');
        }
    } catch (error) {
        console.error('检测模型能力失败:', error);
        btn.textContent = '检测失败';
        setTimeout(() => {
            btn.textContent = '自动检测模型能力';
            btn.disabled = false;
        }, 2000);
    }
}

// ========== 标签页显示设置 ==========
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

// 默认标签页设置
const DEFAULT_TAB_VISIBILITY = {
    database: true,
    governance: true,
    api: true,
    ai: true,
    ontology: false,
    lineage: false,
    mcp: false,
    models: false,
    quality: false
};

const DEFAULT_TAB_ORDER = ['database', 'governance', 'api', 'ai', 'ontology', 'lineage', 'mcp', 'models', 'quality'];

// 当前标签页设置状态（用于设置弹窗）
let currentTabOrder = [...DEFAULT_TAB_ORDER];
let currentTabNames = {};
let currentTabVisibility = {...DEFAULT_TAB_VISIBILITY};

// 打开设置弹窗。
async function showSettingsModal() {
    document.getElementById('settingsModal').classList.add('show');
    await loadTabSettings();
    await loadBackupStats();
}

// 关闭设置弹窗。
function hideSettingsModal() {
    document.getElementById('settingsModal').classList.remove('show');
}

// 加载标签页设置。
async function loadTabSettings() {
    const container = document.getElementById('tabVisibilitySettings');
    if (!container) return;

    // 从后端 API 读取设置
    let settings = null;
    try {
        const userSettings = await loadUserSettings();
        if (userSettings) {
            // 合并默认值
            currentTabVisibility = {...DEFAULT_TAB_VISIBILITY, ...(userSettings.tabVisibility || {})};
            currentTabOrder = userSettings.tabOrder ? [...userSettings.tabOrder] : [...DEFAULT_TAB_ORDER];
            currentTabNames = userSettings.tabNames ? {...userSettings.tabNames} : {};
            // 确保 currentTabOrder 包含所有标签页
            ALL_TABS.forEach(t => {
                if (!currentTabOrder.includes(t.id)) {
                    currentTabOrder.push(t.id);
                }
            });
            settings = currentTabVisibility;
        }
    } catch (e) {
        console.error('加载标签页设置失败', e);
    }

    if (!settings) {
        currentTabVisibility = {...DEFAULT_TAB_VISIBILITY};
        currentTabOrder = [...DEFAULT_TAB_ORDER];
        currentTabNames = {};
        settings = currentTabVisibility;
    }

    // 动态生成标签页设置行
    renderTabSettingsUI(container, settings);
}

// 保存标签页设置
function saveTabSettings() {
    // 从设置弹窗中收集当前状态
    collectTabSettingsFromUI();

    let visibleCount = 0;
    for (const key in currentTabVisibility) {
        if (currentTabVisibility[key]) visibleCount++;
    }

    if (visibleCount < 1) {
        showToast('至少需要显示一个标签页', 'warning');
        return false;
    }

    // 应用嵌入模式设置
    const embedModeToggle = document.getElementById('embedModeToggle');
    const embedMode = embedModeToggle ? embedModeToggle.checked : false;
    applyEmbedMode(embedMode);

    // 保存到后端
    (async () => {
        const userSettings = await loadUserSettings();
        userSettings.embedMode = embedMode;
        userSettings.tabVisibility = currentTabVisibility;
        userSettings.tabOrder = currentTabOrder;
        userSettings.tabNames = currentTabNames;
        await saveUserSettings(userSettings);
    })();

    try {
        applyTabVisibility(currentTabVisibility, currentTabOrder, currentTabNames);
        showToast('保存成功', 'success');
        hideSettingsModal();
        return true;
    } catch (e) {
        console.error('保存失败', e);
        showToast('保存失败', 'error');
        return false;
    }
}

// 重置标签页设置为默认值
function resetTabSettings() {
    currentTabVisibility = {...DEFAULT_TAB_VISIBILITY};
    currentTabOrder = [...DEFAULT_TAB_ORDER];
    currentTabNames = {};

    const container = document.getElementById('tabVisibilitySettings');
    if (container) {
        renderTabSettingsUI(container, currentTabVisibility);
    }

    // 更新嵌入模式复选框
    const embedModeToggle = document.getElementById('embedModeToggle');
    if (embedModeToggle) {
        embedModeToggle.checked = true; // 默认开启嵌入模式
    }
}

// ====== 数据备份与恢复 ======

// 加载备份统计信息
async function loadBackupStats() {
    const container = document.getElementById('backupStatsContainer');
    if (!container) return;

    try {
        // 从 API 获取准确统计
        const stats = {
            databases: 0,
            apis: 0,
            tasks: 0,
            users: 0,
            llmModels: 0,
            smallModels: 0,
        };

        // 从全局变量获取基础统计（快速显示）
        if (typeof databases !== 'undefined' && databases) {
            stats.databases = databases.length;
        }
        if (typeof apis !== 'undefined' && apis) {
            stats.apis = apis.length;
        }
        if (typeof govTasks !== 'undefined' && govTasks) {
            stats.tasks = govTasks.length;
        }
        if (typeof llmModels !== 'undefined' && llmModels) {
            stats.llmModels = llmModels.length;
        }
        if (typeof smallModels !== 'undefined' && smallModels) {
            stats.smallModels = smallModels.length;
        }

        // 异步获取用户数和 API 数（需要 admin 权限，且这些数据可能未加载）
        if (typeof currentUser !== 'undefined' && currentUser === 'admin') {
            try {
                // 获取用户数
                const usersResp = await fetchWithAuth(`${API_BASE}/api/data-ontology/users`);
                const usersData = await usersResp.json();
                if (usersData.success && usersData.users) {
                    stats.users = usersData.users.length;
                }
                
                // 获取 API 数（apis 全局变量可能未初始化）
                if (stats.apis === 0) {
                    const apisResp = await fetchWithAuth(`${API_BASE}/api/data-ontology/apis`);
                    const apisData = await apisResp.json();
                    if (apisData.success && apisData.apis) {
                        stats.apis = apisData.apis.length;
                    }
                }
                
                // 获取任务数（govTasks 全局变量可能未初始化）
                if (stats.tasks === 0) {
                    const tasksResp = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/tasks`);
                    const tasksData = await tasksResp.json();
                    if (tasksData.success && tasksData.tasks) {
                        stats.tasks = tasksData.tasks.length;
                    }
                }
            } catch (e) {
                console.warn('获取统计数据失败', e);
            }
        }

        container.innerHTML = `
            <div class="backup-stats-grid">
                <div class="backup-stat-item">
                    <span class="stat-label">数据库</span>
                    <span class="stat-value">${stats.databases}</span>
                </div>
                <div class="backup-stat-item">
                    <span class="stat-label">API</span>
                    <span class="stat-value">${stats.apis}</span>
                </div>
                <div class="backup-stat-item">
                    <span class="stat-label">任务</span>
                    <span class="stat-value">${stats.tasks}</span>
                </div>
                <div class="backup-stat-item">
                    <span class="stat-label">用户</span>
                    <span class="stat-value">${stats.users}</span>
                </div>
                <div class="backup-stat-item">
                    <span class="stat-label">大模型</span>
                    <span class="stat-value">${stats.llmModels}</span>
                </div>
                <div class="backup-stat-item">
                    <span class="stat-label">小模型</span>
                    <span class="stat-value">${stats.smallModels}</span>
                </div>
            </div>
        `;
    } catch (e) {
        console.error('加载备份统计失败', e);
        container.innerHTML = '<div class="backup-stats-loading">加载失败</div>';
    }
}

// 导出备份（ZIP 格式，包含所有持久化数据）
async function exportBackup() {
    const messageDiv = document.getElementById('backupMessage');
    messageDiv.className = 'backup-message info';
    messageDiv.textContent = '正在导出备份（包含所有数据文件）...';

    try {
        const resp = await fetchWithAuth(API_BASE + '/api/data-ontology/backup');
        if (!resp.ok) {
            const errData = await resp.json();
            throw new Error(errData.message || '导出失败');
        }

        // 获取文件名
        const contentDisp = resp.headers.get('Content-Disposition');
        let filename = 'datatoolbox-backup.zip';
        if (contentDisp) {
            const match = contentDisp.match(/filename="?(.+?)"?(;|$)/);
            if (match) filename = match[1];
        }

        // 下载文件
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
        messageDiv.className = 'backup-message success';
        messageDiv.textContent = `备份已导出：${filename}（${sizeMB}MB）`;
        setTimeout(() => {
            messageDiv.className = 'backup-message';
            messageDiv.textContent = '';
        }, 5000);
    } catch (e) {
        console.error('导出备份失败', e);
        messageDiv.className = 'backup-message error';
        messageDiv.textContent = '导出失败：' + e.message;
    }
}

// 导入备份（支持 ZIP 和 JSON 格式）
async function importBackup() {
    const fileInput = document.getElementById('importBackupFile');
    const modeSelect = document.getElementById('importMode');
    const messageDiv = document.getElementById('backupMessage');

    if (!fileInput.files || fileInput.files.length === 0) {
        messageDiv.className = 'backup-message error';
        messageDiv.textContent = '请先选择备份文件';
        return;
    }

    const mode = modeSelect.value;
    const file = fileInput.files[0];
    const fileName = file.name.toLowerCase();

    if (mode === 'overwrite') {
        const confirmed = confirm('覆盖模式将完全替换所有现有数据（包括文件和数据库），此操作不可撤销！\n\n确定要继续吗？');
        if (!confirmed) {
            return;
        }
    }

    messageDiv.className = 'backup-message info';
    messageDiv.textContent = '正在导入备份...';

    try {
        if (fileName.endsWith('.zip')) {
            // ZIP 格式：使用 multipart/form-data 上传
            const formData = new FormData();
            formData.append('backup', file);
            formData.append('mode', mode);

            const resp = await fetchWithAuth(API_BASE + '/api/data-ontology/restore-upload', {
                method: 'POST',
                body: formData
            });

            const result = await resp.json();
            if (!result.success) {
                throw new Error(result.message || '导入失败');
            }

            let successMsg = '导入成功！';
            const data = result.data || result;
            if (mode === 'overwrite') {
                successMsg += ` 已导入 ${data.databases_count || 0} 个数据库，${data.apis_count || 0} 个API，${data.tasks_count || 0} 个任务`;
                if (data.files_restored) {
                    successMsg += `，${data.files_restored} 个文件`;
                }
            } else {
                successMsg += ` 新增 ${data.users_added || 0} 个用户，${data.databases_added || 0} 个数据库，${data.apis_added || 0} 个API，${data.tasks_added || 0} 个任务`;
                if (data.files_restored) {
                    successMsg += `，${data.files_restored} 个文件`;
                }
            }

            messageDiv.className = 'backup-message success';
            messageDiv.textContent = successMsg;
        } else if (fileName.endsWith('.json')) {
            // JSON 格式：使用 restore-upload 端点（multipart 上传）
            const formData = new FormData();
            formData.append('backup', file);
            formData.append('mode', mode || 'merge');  // 默认 merge 模式

            const resp = await fetchWithAuth(API_BASE + '/api/data-ontology/restore-upload', {
                method: 'POST',
                body: formData
            });

            const result = await resp.json();
            if (!result.success) {
                throw new Error(result.message || '导入失败');
            }

            let successMsg = '导入成功！';
            if (mode === 'overwrite') {
                successMsg += ` 已导入 ${result.databases_count || 0} 个数据库，${result.apis_count || 0} 个API，${result.tasks_count || 0} 个任务`;
            } else {
                successMsg += ` 新增 ${result.users_added || 0} 个用户，${result.databases_added || 0} 个数据库，${result.apis_added || 0} 个API，${result.tasks_added || 0} 个任务`;
            }

            messageDiv.className = 'backup-message success';
            messageDiv.textContent = successMsg;
        } else {
            throw new Error('不支持的文件格式，请选择 .zip 或 .json 文件');
        }

        // 刷新页面以加载新数据
        setTimeout(() => {
            if (confirm('数据已成功导入，需要刷新页面以加载新数据。是否立即刷新？')) {
                window.location.reload();
            }
        }, 1000);
    } catch (e) {
        console.error('导入备份失败', e);
        messageDiv.className = 'backup-message error';
        messageDiv.textContent = '导入失败：' + e.message;
    }
}

// 处理文件选择
function handleBackupFileSelect(event) {
    const file = event.target.files[0];
    const fileNameSpan = document.getElementById('importFileName');
    const importBtn = document.getElementById('importBackupBtn');

    if (file) {
        fileNameSpan.textContent = file.name;
        fileNameSpan.style.display = 'inline';
        importBtn.style.display = 'inline-block';
    } else {
        fileNameSpan.style.display = 'none';
        importBtn.style.display = 'none';
    }
}

// 发送AI消息?
function applyEmbedMode(enabled) {
    const embedSettingsBtn = document.getElementById('embedSettingsBtn');
    if (enabled) {
        document.body.classList.add('embed-mode');
        if (embedSettingsBtn) embedSettingsBtn.style.display = 'block';
    } else {
        document.body.classList.remove('embed-mode');
        if (embedSettingsBtn) embedSettingsBtn.style.display = 'none';
    }
}

// 获取用户设置
async function loadUserSettings() {
    try {
        const resp = await fetchWithAuth(API_BASE + '/api/data-ontology/settings');
        const data = await resp.json();
        if (data.success && data.settings) {
            return data.settings;
        }
    } catch (e) {
        console.error('加载用户设置失败', e);
    }
    return {};
}

// 加载用户设置成功
async function saveUserSettings(settings) {
    try {
        const resp = await fetchWithAuth(API_BASE + '/api/data-ontology/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        const data = await resp.json();
        return data.success;
    } catch (e) {
        console.error('保存用户设置失败', e);
        return false;
    }
}

// 初始化嵌入模式
async function initEmbedMode() {
    const settings = await loadUserSettings();
    const embedMode = settings.embedMode !== false; // 默认开启嵌入模式
    const embedModeToggle = document.getElementById('embedModeToggle');
    if (embedModeToggle) {
        embedModeToggle.checked = embedMode;
    }
    applyEmbedMode(embedMode);
    
    // 应用标签页设置
    const tabVisibility = settings.tabVisibility || DEFAULT_TAB_VISIBILITY;
    const tabOrder = settings.tabOrder || DEFAULT_TAB_ORDER;
    const tabNames = settings.tabNames || {};
    
    // 更新当前状态
    currentTabVisibility = {...DEFAULT_TAB_VISIBILITY, ...tabVisibility};
    currentTabOrder = [...tabOrder];
    currentTabNames = {...tabNames};
    
    // 确保 currentTabOrder 包含所有标签页
    ALL_TABS.forEach(t => {
        if (!currentTabOrder.includes(t.id)) {
            currentTabOrder.push(t.id);
        }
    });
    
    applyTabVisibilityWithSettings(currentTabVisibility, currentTabOrder, currentTabNames);
    
    // 绑定嵌入模式设置按钮
    const embedSettingsBtn = document.getElementById('embedSettingsBtn');
    if (embedSettingsBtn) {
        embedSettingsBtn.addEventListener('click', showSettingsModal);
    }
}

// 应用标签页可见性
function applyTabVisibility(settings, tabOrder, tabNames) {
    if (!settings) {
        // 如果没有设置，从后端加载
        (async () => {
            const userSettings = await loadUserSettings();
            const vis = userSettings.tabVisibility || DEFAULT_TAB_VISIBILITY;
            const order = userSettings.tabOrder || DEFAULT_TAB_ORDER;
            const names = userSettings.tabNames || {};
            applyTabVisibilityWithSettings(vis, order, names);
        })();
        return;
    }
    applyTabVisibilityWithSettings(settings, tabOrder || DEFAULT_TAB_ORDER, tabNames || {});
}

// 实际应用标签页设置
function applyTabVisibilityWithSettings(settings, tabOrder, tabNames) {
    const tabsContainer = document.querySelector('.nav-tabs');
    if (!tabsContainer) return;

    const tabs = document.querySelectorAll('.nav-tab');
    const tabArray = Array.from(tabs);

    // 按 tabOrder 排序标签页
    tabArray.sort((a, b) => {
        const aIndex = tabOrder.indexOf(a.dataset.tab);
        const bIndex = tabOrder.indexOf(b.dataset.tab);
        return aIndex - bIndex;
    });

    // 重新排列标签页DOM
    tabArray.forEach(tab => tabsContainer.appendChild(tab));

    // 应用可见性和名称
    tabs.forEach(tab => {
        const tabId = tab.dataset.tab;
        
        // 设置可见性
        if (settings.hasOwnProperty(tabId)) {
            tab.style.display = settings[tabId] ? '' : 'none';
        } else {
            tab.style.display = DEFAULT_TAB_VISIBILITY[tabId] ? '' : 'none';
        }

        // 设置名称
        const tabInfo = ALL_TABS.find(t => t.id === tabId);
        const customName = tabNames && tabNames[tabId];
        tab.textContent = customName || (tabInfo ? tabInfo.name : tabId);
    });

    // 如果当前活动标签页被隐藏，切换到第一个可见标签页
    const activeTab = document.querySelector('.nav-tab.active');
    if (activeTab) {
        const activeTabId = activeTab.dataset.tab;
        if (settings[activeTabId] === false) {
            const firstVisibleTab = document.querySelector('.nav-tab:not([style*="display: none"])');
            if (firstVisibleTab) {
                switchTab(firstVisibleTab.dataset.tab);
            }
        }
    }
}

// 渲染标签页设置UI
function renderTabSettingsUI(container, settings) {
    container.innerHTML = '';
    
    currentTabOrder.forEach((tabId, index) => {
        const tabInfo = ALL_TABS.find(t => t.id === tabId);
        if (!tabInfo) return;

        const row = document.createElement('div');
        row.className = 'tab-setting-row';
        row.dataset.tabId = tabId;
        row.draggable = true;

        const isVisible = settings[tabId] !== false;
        const customName = currentTabNames[tabId] || '';
        const displayName = customName || tabInfo.name;

        row.innerHTML = `
            <input type="checkbox" data-tab="${tabId}" ${isVisible ? 'checked' : ''}>
            <span class="tab-name-text" data-tab="${tabId}" title="双击编辑名称">${escapeHtml(displayName)}</span>
            <input type="text" class="tab-name-input hidden" data-tab="${tabId}" 
                   placeholder="${tabInfo.name}" value="${escapeHtml(customName)}">
        `;

        // 勾选事件
        const checkbox = row.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', () => {
            currentTabVisibility[tabId] = checkbox.checked;
        });

        // 双击编辑名称
        const nameText = row.querySelector('.tab-name-text');
        const nameInput = row.querySelector('.tab-name-input');
        
        nameText.addEventListener('dblclick', () => {
            nameText.classList.add('hidden');
            nameInput.classList.remove('hidden');
            nameInput.focus();
            nameInput.select();
        });

        nameInput.addEventListener('blur', () => {
            saveTabName(tabId, nameInput, nameText, tabInfo.name);
        });

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                nameInput.blur();
            } else if (e.key === 'Escape') {
                nameInput.value = currentTabNames[tabId] || '';
                nameInput.blur();
            }
        });

        // 拖拽排序
        row.addEventListener('dragstart', (e) => {
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tabId);
        });

        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            document.querySelectorAll('.tab-setting-row.drag-over').forEach(el => {
                el.classList.remove('drag-over');
            });
        });

        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const draggingRow = document.querySelector('.tab-setting-row.dragging');
            if (draggingRow && draggingRow !== row) {
                row.classList.add('drag-over');
            }
        });

        row.addEventListener('dragleave', () => {
            row.classList.remove('drag-over');
        });

        row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('drag-over');
            
            const dragTabId = e.dataTransfer.getData('text/plain');
            if (dragTabId === tabId) return;
            
            const dragIndex = currentTabOrder.indexOf(dragTabId);
            const dropIndex = currentTabOrder.indexOf(tabId);
            
            if (dragIndex === -1 || dropIndex === -1) return;
            
            // 移动元素
            const [removed] = currentTabOrder.splice(dragIndex, 1);
            currentTabOrder.splice(dropIndex, 0, removed);

            // 保存到后端
            (async () => {
                const userSettings = await loadUserSettings();
                userSettings.tabOrder = currentTabOrder;
                await saveUserSettings(userSettings);
            })();

            // 重新渲染
            renderTabSettingsUI(container, currentTabVisibility);
        });

        container.appendChild(row);
    });
}

function saveTabName(tabId, input, textSpan, defaultName) {
    const value = input.value.trim();
    if (value) {
        currentTabNames[tabId] = value;
        textSpan.textContent = value;
    } else {
        delete currentTabNames[tabId];
        textSpan.textContent = defaultName;
    }
    input.classList.add('hidden');
    textSpan.classList.remove('hidden');
}

// 从UI收集标签页设置
function collectTabSettingsFromUI() {
    const container = document.getElementById('tabVisibilitySettings');
    if (!container) return;

    const rows = container.querySelectorAll('.tab-setting-row');
    rows.forEach(row => {
        const tabId = row.dataset.tabId;
        const checkbox = row.querySelector('input[type="checkbox"]');
        const nameInput = row.querySelector('.tab-name-input');

        currentTabVisibility[tabId] = checkbox ? checkbox.checked : true;
        
        if (nameInput && nameInput.value.trim()) {
            currentTabNames[tabId] = nameInput.value.trim();
        } else {
            delete currentTabNames[tabId];
        }
    });
}

// 保存AI配置
async function handleSaveAiSettings(e) {
    e.preventDefault();

    const timeoutValue = parseInt(document.getElementById('aiTimeoutInput').value, 10);
    const contextWindowValue = parseInt(document.getElementById('aiContextWindow').value, 10);
    
    const config = {
        url: document.getElementById('aiUrlInput').value,
        api_key: document.getElementById('aiApiKeyInput').value,
        model: document.getElementById('aiModelInput').value,
        timeout: Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : 120,
        // 能力设置
        enable_function_call: document.getElementById('aiEnableFunctionCall').checked,
        enable_thinking: document.getElementById('aiEnableThinking').checked,
        enable_streaming: document.getElementById('aiEnableStreaming').checked,
        enable_json_mode: document.getElementById('aiEnableJSONMode').checked,
        context_window_override: Number.isFinite(contextWindowValue) && contextWindowValue > 0 ? contextWindowValue : 0,
        // 表检索配置
        table_retrieval: {
            strategy: document.getElementById('aiRetrievalStrategy').value,
            max_tables: parseInt(document.getElementById('aiMaxTables').value, 10) || 15,
            min_relevance_score: parseFloat(document.getElementById('aiMinRelevance').value) || 0.3,
            keyword_config: {
                match_fields: [
                    document.getElementById('aiMatchName').checked ? 'name' : null,
                    document.getElementById('aiMatchComment').checked ? 'comment' : null,
                    document.getElementById('aiMatchColumns').checked ? 'column_names' : null
                ].filter(Boolean)
            },
            include_fields: document.getElementById('aiIncludeFields').checked,
            max_fields_per_table: parseInt(document.getElementById('aiMaxFields').value, 10) || 50
        }
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
            // 保存能力检测结果
            if (data.capabilities) {
                aiCapabilities = data.capabilities;
                console.log('AI模型能力检测完成:', aiCapabilities);
            }
            successEl.textContent = 'AI 设置已保存';
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

// 处理 AI 输入框内容变化。
function handleAiInputChange(e) {
    const input = e.target;
    const value = input.value;
    const cursorPos = input.selectionStart;
    
    // 显示进度
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    
    // 检测 @ 提示触发词。
    const textBeforeCursor = value.substring(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\S*)$/);
    
    if (atMatch) {
        const searchTerm = atMatch[1].toLowerCase();
        showDbSuggestions(searchTerm);
    } else {
        hideDbSuggestions();
    }
}

// 显示 @ 联想建议。
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
        html += '<div class="ai-suggestion-group-title">AI 模块</div>';
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
            const typeIcon = dbTypeIcons[db.type] || '🗃️';
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

// 加载治理任务
function hideDbSuggestions() {
    document.getElementById('aiDbSuggestions').style.display = 'none';
    dbSuggestionIndex = -1;
}

// 过滤数据库建议列表
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

// 选择数据库
function selectDbSuggestion(dbId) {
    selectSuggestion('db', dbId);
}

// AI输入框键盘事件
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

// 更新联想建议高亮。
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

// 发送 AI 消息。
async function handleSendAiMessage() {
    const input = document.getElementById('aiInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    // 检查 AI 配置是否完整。
    if (!aiConfig || !aiConfig.url || !aiConfig.api_key || !aiConfig.model) {
        showAiError('请先完成 AI 配置');
        return;
    }
    
    // 提取消息中的 @ 引用。
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
        // 改进数据库匹配：支持精确匹配、忽略大小写、部分匹配、ID匹配
        const refNameLower = refName.toLowerCase();
        let db = databases.find(d => d.name === refName); // 精确匹配
        if (!db) {
            db = databases.find(d => d.name.toLowerCase() === refNameLower); // 忽略大小写
        }
        if (!db) {
            db = databases.find(d => d.name.toLowerCase().includes(refNameLower)); // 部分匹配
        }
        if (!db) {
            db = databases.find(d => d.id === refName); // ID匹配
        }
        if (db) {
            dbReferences.push(db);
        }
    }

    // 清除数据库建议列表
    if (moduleReferences.length > 0) {
        aiSessionContext.modules = moduleReferences;
    }

    // 合并数据库上下文
    if (dbReferences.length > 0) {
        aiSessionContext.databases = dbReferences;
    } else if (aiSessionContext.databases.length > 0) {
        dbReferences.push(...aiSessionContext.databases);
    }
    // 如果没有指定数据库，让后端返回数据库选择卡片，不再前端拦截

    updateAiContextDisplay();

    // 记录用户消息
    aiSessionContext.history.push({
        role: 'user',
        content: message,
        databases: dbReferences.map(db => db.id),
        modules: aiSessionContext.modules.map(m => m.id)
    });

    // 如果没有显式选择数据库，则使用已有上下文补足。
    let displayMessage = message;
    if (allMatches.length === 0 && aiSessionContext.databases.length > 0) {
        const contextDbs = aiSessionContext.databases.map(db => `@${db.name}`).join(' ');
        displayMessage = message + `\n<div class="ai-context-hint">当前上下文：${contextDbs}</div>`;
    }
    addAiMessage('user', displayMessage);
    
    // 发送AI消息
    input.value = '';
    input.style.height = 'auto';
    
    // 显示进度
    const sendBtn = document.getElementById('aiSendBtn');
    sendBtn.disabled = true;
    
    // 清除数据库建议列表
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
            const chunks = buffer.split(/\n\n+/);
            buffer = chunks.pop() || '';
            
            for (const chunk of chunks) {
                if (!chunk.trim()) continue;
                const eventLines = chunk.split('\n');
                let eventType = '';
                const dataLines = [];
                for (const line of eventLines) {
                    if (line.startsWith('event:')) eventType = line.slice(6).trim();
                    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
                }
                if (!eventType || dataLines.length === 0) continue;
                try {
                    const data = JSON.parse(dataLines.join('\n'));
                    handleStreamEvent(streamMessageId, eventType, data, message);
                } catch (err) {
                    console.warn('SSE JSON parse failed', eventType, dataLines.join('\n'), err);
                }
            }
        }
    } catch (error) {
        updateStreamMessage(streamMessageId, 'error', {message: '发送失败：' + error.message});
    } finally {
        sendBtn.disabled = false;
    }
}

// 生成用户头像 SVG
function getUserAvatarSvg() {
    return `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="url(#userGrad)"/>
        <circle cx="16" cy="12" r="5" fill="white"/>
        <path d="M8 26c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="white"/>
        <defs>
            <linearGradient id="userGrad" x1="0" y1="0" x2="32" y2="32">
                <stop offset="0%" stop-color="#667eea"/>
                <stop offset="100%" stop-color="#764ba2"/>
            </linearGradient>
        </defs>
    </svg>`;
}

// 生成 AI 助手头像 SVG
function getAiAvatarSvg() {
    return `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="url(#aiGrad)"/>
        <rect x="10" y="10" width="12" height="10" rx="2" fill="white"/>
        <circle cx="13" cy="14" r="1.5" fill="#6366f1"/>
        <circle cx="19" cy="14" r="1.5" fill="#6366f1"/>
        <path d="M13 17h6" stroke="#6366f1" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M16 8v2M12 9l1 1.5M20 9l-1 1.5" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
        <defs>
            <linearGradient id="aiGrad" x1="0" y1="0" x2="32" y2="32">
                <stop offset="0%" stop-color="#6366f1"/>
                <stop offset="100%" stop-color="#8b5cf6"/>
            </linearGradient>
        </defs>
    </svg>`;
}

// 添加 AI 消息。
function addAiMessage(role, content) {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-' + Date.now();
    
    // 处理AI流式响应
    const welcomeMsg = messagesEl.querySelector('.ai-welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }
    
    const avatar = role === 'user' ? getUserAvatarSvg() : getAiAvatarSvg();
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    
    // 保留 HTML 片段并对普通文本做转义。
    let displayContent = content;
    
    // 如果消息里包含 HTML，只处理前缀文本中的 @ 引用。
    if (content.includes('<div')) {
        // 先转义前缀文本。
        const parts = content.split('<div');
        displayContent = escapeHtml(parts[0]);
        
        // 高亮 @ 数据库引用。
        const dbMatches = [...parts[0].matchAll(/@([^\s]+)/g)];
        for (const match of dbMatches) {
            const dbName = match[1];
            displayContent = displayContent.replace(
                new RegExp(escapeHtml(`@${dbName}`), 'g'),
                `<span class="ai-db-reference">@${dbName}</span>`
            );
        }
        
        // 拼回原始 HTML 后半段。
        if (parts.length > 1) {
            displayContent += '<div' + parts.slice(1).join('<div');
        }
    } else {
        // 普通文本全部转义后再处理引用。
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

// 添加 AI 辅助消息和 SQL 结果。
function addAiAssistantMessage(content, sql, results) {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-' + Date.now();
    
    const avatar = getAiAvatarSvg();
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    
    let resultHtml = '';
    
    // SQL 片段显示在消息下方。
    if (sql) {
        resultHtml += `
            <div style="margin-top: 6px;">
                <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">参考 SQL</div>
                <div class="ai-sql-block">${escapeHtml(sql)}</div>
            </div>
        `;
    }
    
    // 流式读取SSE响应并更新界面
    if (results && results.length > 0) {
        resultHtml += `
            <div style="margin-top: 6px;">
                <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">查询结果</div>
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
                    共返回 <strong>${results.length}</strong> 条记录${results.length > 10 ? '，仅显示前 10 条' : ''}
                </div>
            </div>
        `;
    } else if (results && results.length === 0) {
        resultHtml += `
            <div style="margin-top: 6px;">
                <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">查询结果</div>
                <div style="padding: 10px; background: #f7fafc; border-radius: 6px; color: #718096; text-align: center; font-size: 12px;">
                    无结果
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

// 添加带重试信息的 AI 助手消息。
function addAiAssistantMessageWithRetries(content, sql, results, attempts, retries) {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-' + Date.now();
    
    const avatar = getAiAvatarSvg();
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    
    let resultHtml = '';
    
    // 处理AI响应完成
    if (retries > 0) {
        const retryId = 'retry-' + messageId;
        resultHtml += `
            <div style="margin-top: 6px;">
                <div class="ai-retry-header" onclick="toggleRetryDetails('${retryId}')" style="cursor: pointer; padding: 5px 10px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 5px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 12px; color: #856404;">
                        共 ${retries} 次重试
                    </span>
                    <span id="${retryId}-icon" style="font-size: 11px; color: #856404;">?</span>
                </div>
                <div id="${retryId}" class="ai-retry-details" style="display: none; margin-top: 4px; padding: 8px; background: #f8f9fa; border-radius: 5px; border: 1px solid #e2e8f0;">
                    ${attempts.map((attempt, index) => `
                        <div style="margin-bottom: ${index < attempts.length - 1 ? '6px' : '0'}; padding-bottom: ${index < attempts.length - 1 ? '6px' : '0'}; border-bottom: ${index < attempts.length - 1 ? '1px solid #e2e8f0' : 'none'};">
                            <div style="font-size: 11px; font-weight: 600; color: #e53e3e; margin-bottom: 2px;">
                                第 ${attempt.attempt} 次失败：${escapeHtml(attempt.error)}
                            </div>
                            ${attempt.sql ? `<div class="ai-sql-block" style="font-size: 11px; padding: 6px 8px; margin-top: 3px;">${escapeHtml(attempt.sql)}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    // 在消息下方展示参考 SQL。
    if (sql) {
        resultHtml += `
            <div style="margin-top: 6px;">
                <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">参考 SQL</div>
                <div class="ai-sql-block">${escapeHtml(sql)}</div>
            </div>
        `;
    }
    
    // 保存AI设置到服务器
    if (results && results.length > 0) {
        resultHtml += `
            <div style="margin-top: 6px;">
                <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">查询结果</div>
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
                    共返回 <strong>${results.length}</strong> 条记录${results.length > 10 ? '，仅显示前 10 条' : ''}
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

// 显示 AI 错误及重试记录。
function showAiErrorWithAttempts(message, attempts) {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-error-' + Date.now();
    const retryId = 'retry-' + messageId;
    
    const messageHtml = `
        <div class="ai-message assistant" id="${messageId}">
            <div class="ai-message-avatar">${getAiAvatarSvg()}</div>
            <div class="ai-message-content">
                <div class="ai-error">
                    <div style="font-weight: 600; margin-bottom: 4px;">${escapeHtml(message)}</div>
                    <div style="font-size: 11px; margin-bottom: 6px;">共 ${attempts.length} 次失败</div>
                    <div class="ai-retry-header" onclick="toggleRetryDetails('${retryId}')" style="cursor: pointer; padding: 4px 8px; background: rgba(255, 255, 255, 0.3); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 12px;">展开详情</span>
                        <span id="${retryId}-icon" style="font-size: 11px;">?</span>
                    </div>
                    <div id="${retryId}" class="ai-retry-details" style="display: none; margin-top: 4px; padding: 8px; background: rgba(255, 255, 255, 0.2); border-radius: 4px;">
                        ${attempts.map((attempt, index) => `
                            <div style="margin-bottom: ${index < attempts.length - 1 ? '6px' : '0'}; padding-bottom: ${index < attempts.length - 1 ? '6px' : '0'}; border-bottom: ${index < attempts.length - 1 ? '1px solid rgba(255, 255, 255, 0.3)' : 'none'};">
                                <div style="font-size: 11px; font-weight: 600; margin-bottom: 2px;">
                                    第 ${attempt.attempt} 次失败：${escapeHtml(attempt.error)}
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

// 追加进度步骤
function toggleRetryDetails(retryId) {
    const details = document.getElementById(retryId);
    const icon = document.getElementById(retryId + '-icon');
    
    if (details.style.display === 'none') {
        details.style.display = 'block';
        icon.textContent = '?';
    } else {
        details.style.display = 'none';
        icon.textContent = '?';
    }
}

// 通过 data-* 属性安全执行确认 SQL。
async function executeConfirmedSQLFromElement(confirmId, messageId) {
    const confirmEl = document.getElementById(confirmId);
    if (!confirmEl) return;
    
    const sqlData = confirmEl.dataset.sql;
    const dbIdData = confirmEl.dataset.dbId;
    
    if (!sqlData || !dbIdData) {
        console.error('Missing SQL or dbId data');
        return;
    }
    
    const sql = JSON.parse(decodeURIComponent(sqlData));
    const dbId = JSON.parse(decodeURIComponent(dbIdData));
    
    await executeConfirmedSQL(confirmId, sql, dbId, messageId);
}

async function executeConfirmedSQL(confirmId, sql, dbId, messageId) {
    const confirmEl = document.getElementById(confirmId);
    if (!confirmEl) return;

    confirmEl.innerHTML = `<div class="ai-status-executing">正在执行 SQL...</div>`;

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
            let html = `<div class="ai-status-success" style="margin-bottom: 4px;">执行成功</div>`;
            if (result.results && result.results.length > 0) {
                html += `
                    <div style="margin-top: 6px;">
                        <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">执行结果</div>
                        <div class="ai-result-table">
                            <table>
                                <thead><tr>${Object.keys(result.results[0]).map(col => `<th>${escapeHtml(col)}</th>`).join('')}</tr></thead>
                                <tbody>${result.results.slice(0, 10).map(row => `<tr>${Object.keys(result.results[0]).map(col => `<td>${row[col] !== null ? escapeHtml(String(row[col])) : '<i style="color:#a0aec0;">NULL</i>'}</td>`).join('')}</tr>`).join('')}</tbody>
                            </table>
                        </div>
                    </div>`;
            } else {
                html += `<div style="font-size: 12px; color: #718096; margin-top: 4px;">未返回结果</div>`;
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
    confirmEl.innerHTML = `<div class="ai-status-retry" style="animation: none;">已取消，可重新发送</div>`;
}

// 新建 AI 流式消息卡片。
function addAiStreamMessage() {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-stream-' + Date.now();
    
    // 处理AI代码块
    const welcomeMsg = messagesEl.querySelector('.ai-welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }
    
    const avatar = getAiAvatarSvg();
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    
    const messageHtml = `
        <div class="ai-message assistant ai-process-card" id="${messageId}">
            <div class="ai-message-avatar">${avatar}</div>
            <div class="ai-message-content">
                <div class="ai-message-bubble">
                    <div id="${messageId}-status" class="ai-stream-status"></div>
                    <div id="${messageId}-timeline" class="ai-process-timeline"></div>
                    <div id="${messageId}-content" class="ai-stream-content"></div>
                    <div id="${messageId}-attempts" class="ai-stream-attempts" style="display:none;"></div>
                </div>
                <div class="ai-message-meta">
                    <span>${time}</span>
                    <button type="button" class="ai-process-toggle" id="${messageId}-toggle" onclick="toggleAiProcess('${messageId}')" style="display:none;">展开</button>
                </div>
            </div>
        </div>
    `;
    
    messagesEl.insertAdjacentHTML('beforeend', messageHtml);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    
    return messageId;
}

function appendAiProcessStep(messageId, title, detail, state, phase) {
    const timelineEl = document.getElementById(`${messageId}-timeline`);
    if (!timelineEl) return;
    const safeTitle = escapeHtml(title);
    const safeDetail = detail ? escapeHtml(detail) : '';
    const safePhase = phase ? escapeHtml(phase) : '';
    const stepId = `${messageId}-step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    timelineEl.insertAdjacentHTML('beforeend', `
        <div class="ai-process-step ${state || 'pending'}" id="${stepId}">
            <div class="ai-process-step-dot"></div>
            <div class="ai-process-step-body">
                ${safePhase ? `<div class="ai-process-step-phase">${safePhase}</div>` : ''}
                <div class="ai-process-step-title">${safeTitle}</div>
                ${safeDetail ? `<div class="ai-process-step-detail">${safeDetail}</div>` : ''}
            </div>
        </div>
    `);
}

function setAiProcessCollapsed(messageId, collapsed) {
    const card = document.getElementById(messageId);
    if (!card) return;
    card.classList.toggle('ai-process-collapsed', collapsed);
    const toggle = document.getElementById(`${messageId}-toggle`);
    if (toggle) toggle.textContent = collapsed ? '展开' : '收起';
}

function toggleAiProcess(messageId) {
    const card = document.getElementById(messageId);
    if (!card) return;
    setAiProcessCollapsed(messageId, !card.classList.contains('ai-process-collapsed'));
}

function finalizeAiProcess(messageId) {
    const toggle = document.getElementById(`${messageId}-toggle`);
    if (toggle) toggle.style.display = 'inline-flex';
    setAiProcessCollapsed(messageId, true);
}

// 处理 AI 流式事件。
function handleStreamEvent(messageId, eventType, data, userMessage) {
    const statusEl = document.getElementById(`${messageId}-status`);
    const contentEl = document.getElementById(`${messageId}-content`);
    const attemptsEl = document.getElementById(`${messageId}-attempts`);
    const messagesEl = document.getElementById('aiChatMessages');

    function stageLabel(type) {
        if (type === 'start' || type === 'thinking') return '思考中';
        if (type === 'retry' || type === 'attempt_failed') return '重试中';
        if (type === 'sql_generated' || type === 'api_config_generated' || type === 'governance_task_draft' || type === 'quality_rule_draft' || type === 'small_model_draft') return '已生成';
        if (type === 'executing') return '执行中';
        if (type === 'confirm_write') return '待确认';
        return '处理中';
    }
    const markStep = (title, detail, state) => appendAiProcessStep(messageId, title, detail, state, stageLabel(eventType));
    const showTimeline = () => {
        const toggle = document.getElementById(`${messageId}-toggle`);
        if (toggle) toggle.style.display = 'inline-flex';
    };
    
    switch (eventType) {
        case 'start':
            statusEl.innerHTML = `<div class="ai-loading"><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div> ${escapeHtml(data.message)}</div>`;
            markStep('开始', data.message || '等待 AI 处理', 'running');
            showTimeline();
            break;
            
        case 'thinking':
            statusEl.innerHTML = `<div class="ai-status-thinking">${escapeHtml(data.message)}</div>`;
            markStep('思考', data.message || '继续分析中', 'running');
            showTimeline();
            break;
            
        case 'retry':
            const retryHtml = `<div class="ai-status-retry">${escapeHtml(data.message)}<br><span style="font-size:11px;color:#856404;">原因: ${escapeHtml(data.error)}</span></div>`;
            attemptsEl.style.display = 'block';
            attemptsEl.insertAdjacentHTML('beforeend', retryHtml);
            statusEl.innerHTML = `<div class="ai-status-thinking">${escapeHtml(data.message)}</div>`;
            markStep('失败', data.error || data.message || '发生错误', 'warning');
            showTimeline();
            break;
            
        case 'sql_generated':
            statusEl.innerHTML = `<div class="ai-status-success">SQL 已生成</div>`;
            contentEl.innerHTML = `
                <div style="margin-bottom: 6px;">${formatAIText(data.response)}</div>
                <div style="margin-top: 6px;">
                    <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">参考 SQL</div>
                    <div class="ai-sql-block">${escapeHtml(data.sql)}</div>
                </div>
            `;
            markStep('SQL 完成', 'SQL 已成功生成', 'done');
            showTimeline();
            break;
            
        case 'executing':
            statusEl.innerHTML = `<div class="ai-status-executing">${escapeHtml(data.message)}</div>`;
            markStep('执行 SQL', data.message || '准备执行 SQL', 'running');
            showTimeline();
            break;
            
        case 'attempt_failed':
            const failedHtml = `<div class="ai-attempt-failed">第 ${data.attempt} 次失败：${escapeHtml(data.error)}${data.sql ? '<br><div class="ai-sql-block" style="font-size:11px;padding:6px;margin-top:3px;">' + escapeHtml(data.sql) + '</div>' : ''}</div>`;
            attemptsEl.style.display = 'block';
            attemptsEl.insertAdjacentHTML('beforeend', failedHtml);
            markStep(`第 ${data.attempt} 次失败`, data.error || '未知错误', 'warning');
            showTimeline();
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
                        <div style="font-size:12px;font-weight:600;color:#2c5282;margin-bottom:4px;">AI 反思结果</div>
                        <div style="font-size:13px;color:#2d3748;">${formatAIText(data.insight)}</div>
                        ${confStr}
                    </div>`;
            }
            
            if (data.attempts && data.attempts.length > 0) {
                const retryId = 'retry-' + messageId;
                resultHtml += `
                    <div style="margin-top: 6px;">
                        <div class="ai-retry-header" onclick="toggleRetryDetails('${retryId}')" style="cursor: pointer; padding: 5px 10px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 5px; display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 12px; color: #856404;">共 ${data.retries} 次重试</span>
                            <span id="${retryId}-icon" style="font-size: 11px; color: #856404;">?</span>
                        </div>
                        <div id="${retryId}" class="ai-retry-details" style="display: none; margin-top: 4px; padding: 8px; background: #f8f9fa; border-radius: 5px; border: 1px solid #e2e8f0;">
                            ${data.attempts.map((attempt, index) => `
                                <div style="margin-bottom: ${index < data.attempts.length - 1 ? '6px' : '0'}; padding-bottom: ${index < data.attempts.length - 1 ? '6px' : '0'}; border-bottom: ${index < data.attempts.length - 1 ? '1px solid #e2e8f0' : 'none'};">
                                    <div style="font-size: 11px; font-weight: 600; color: #e53e3e; margin-bottom: 2px;">第 ${attempt.attempt} 次：${escapeHtml(attempt.error)}</div>
                                    ${attempt.sql ? '<div class="ai-sql-block" style="font-size: 11px; padding: 6px 8px; margin-top: 3px;">' + escapeHtml(attempt.sql) + '</div>' : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
            
            resultHtml += `
                <div style="margin-top: 6px;">
                    <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">${data.attempts && data.attempts.length > 0 ? '参考 SQL' : '生成 SQL'}</div>
                    <div class="ai-sql-block">${escapeHtml(data.sql)}</div>
                </div>
            `;
            
            if (data.results && data.results.length > 0) {
                resultHtml += `
                    <div style="margin-top: 6px;">
                        <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">查询结果</div>
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
                            共返回 <strong>${data.results.length}</strong> 条记录${data.results.length > 10 ? '，仅显示前 10 条' : ''}
                        </div>
                    </div>
                `;
            } else if (data.results && data.results.length === 0) {
                resultHtml += `
                    <div style="margin-top: 6px;">
                        <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">查询 结果</div>
                        <div style="padding: 10px; background: #f7fafc; border-radius: 6px; color: #718096; text-align: center; font-size: 12px;">暂无结果</div>
                    </div>
                `;
            }
            
            contentEl.innerHTML = resultHtml;
            attemptsEl.style.display = 'none';
            markStep('完成', 'AI 处理完成', 'done');
            finalizeAiProcess(messageId);
            break;

        case 'confirm_write':
            statusEl.innerHTML = '';
            const confirmId = 'confirm-' + messageId;
            const confirmSqlData = encodeURIComponent(JSON.stringify(data.sql));
            const confirmDbIdData = encodeURIComponent(JSON.stringify(data.dbId));
            let confirmHtml = `<div style="margin-bottom: 6px;">${formatAIText(data.response)}</div>`;
            confirmHtml += `
                <div style="margin-top: 6px;">
                    <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">待确认 SQL</div>
                    <div class="ai-sql-block">${escapeHtml(data.sql)}</div>
                </div>
                <div class="ai-confirm-write" id="${confirmId}" data-sql="${confirmSqlData}" data-db-id="${confirmDbIdData}">
                    <div class="ai-confirm-warning">
                        <span class="ai-confirm-icon">⚠️</span>
                        <span>检测到写入操作，请确认后再执行。</span>
                    </div>
                    <div class="ai-confirm-actions">
                        <button class="btn ai-confirm-btn-yes" onclick="executeConfirmedSQLFromElement('${confirmId}', '${messageId}')">执行</button>
                        <button class="btn ai-confirm-btn-no" onclick="cancelConfirmedSQL('${confirmId}', '${messageId}')">取消</button>
                    </div>
                </div>
            `;
            contentEl.innerHTML = confirmHtml;
            attemptsEl.style.display = 'none';
            markStep('待确认', '检测到写入操作，请确认执行', 'warning');
            showTimeline();
            break;
            
        case 'error':
            statusEl.innerHTML = '';
            let errorHtml = `<div class="ai-error"><div style="font-weight: 600; margin-bottom: 4px;">${escapeHtml(data.message)}</div>`;
            if (data.response) {
                const debugId = 'debug-' + messageId;
                errorHtml += `
                    <div style="margin-top: 6px;">
                        <div class="ai-retry-header" onclick="toggleRetryDetails('${debugId}')" style="cursor: pointer; padding: 4px 8px; background: rgba(255, 255, 255, 0.3); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 12px;">查看 AI 调试信息</span>
                            <span id="${debugId}-icon" style="font-size: 11px;">?</span>
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
                    <div style="font-size: 11px; margin-top: 6px; margin-bottom: 6px;">共 ${data.attempts.length} 次尝试</div>
                    <div class="ai-retry-header" onclick="toggleRetryDetails('${retryId}')" style="cursor: pointer; padding: 4px 8px; background: rgba(255, 255, 255, 0.3); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 12px;">展开详情</span>
                        <span id="${retryId}-icon" style="font-size: 11px;">?</span>
                    </div>
                    <div id="${retryId}" class="ai-retry-details" style="display: none; margin-top: 4px; padding: 8px; background: rgba(255, 255, 255, 0.2); border-radius: 4px;">
                        ${data.attempts.map((attempt, index) => `
                            <div style="margin-bottom: ${index < data.attempts.length - 1 ? '6px' : '0'}; padding-bottom: ${index < data.attempts.length - 1 ? '6px' : '0'}; border-bottom: ${index < data.attempts.length - 1 ? '1px solid rgba(255, 255, 255, 0.3)' : 'none'};">
                                <div style="font-size: 11px; font-weight: 600; margin-bottom: 2px;">第 ${attempt.attempt} 次：${escapeHtml(attempt.error)}</div>
                                ${attempt.sql ? '<div class="ai-sql-block" style="font-size: 11px; padding: 6px 8px; margin-top: 3px;">' + escapeHtml(attempt.sql) + '</div>' : ''}
                            </div>
                        `).join('')}
                    </div>
                `;
            }
            errorHtml += '</div>';
            contentEl.innerHTML = errorHtml;
            attemptsEl.style.display = 'none';
            markStep('失败', data.message || '未知错误', 'warning');
            finalizeAiProcess(messageId);
            break;
            
        case 'sql_validation_error':
            statusEl.innerHTML = '';
            let sqlErrorHtml = `<div class="ai-error"><div style="font-weight: 600; margin-bottom: 4px;">SQL 校验失败</div>`;
            sqlErrorHtml += `<div style="margin-top: 6px; font-size: 13px;">${escapeHtml(data.message)}</div>`;
            if (data.sql) {
                sqlErrorHtml += `
                    <div style="margin-top: 8px;">
                        <div style="font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 3px;">生成的 SQL</div>
                        <div class="ai-sql-block">${escapeHtml(data.sql)}</div>
                    </div>`;
            }
            if (data.response) {
                const sqlDebugId = 'sql-debug-' + messageId;
                sqlErrorHtml += `
                    <div style="margin-top: 6px;">
                        <div class="ai-retry-header" onclick="toggleRetryDetails('${sqlDebugId}')" style="cursor: pointer; padding: 4px 8px; background: rgba(255, 255, 255, 0.3); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 12px;">查看 AI 响应</span>
                            <span id="${sqlDebugId}-icon" style="font-size: 11px;">?</span>
                        </div>
                        <div id="${sqlDebugId}" class="ai-retry-details" style="display: none; margin-top: 4px; padding: 8px; background: rgba(255, 255, 255, 0.2); border-radius: 4px;">
                            <pre style="white-space: pre-wrap; word-break: break-word; font-size: 11px; margin: 0;">${escapeHtml(data.response)}</pre>
                        </div>
                    </div>`;
            }
            sqlErrorHtml += '</div>';
            contentEl.innerHTML = sqlErrorHtml;
            attemptsEl.style.display = 'none';
            markStep('校验失败', data.message || 'SQL 校验失败', 'warning');
            finalizeAiProcess(messageId);
            break;
            
        case 'database_selection_required':
            statusEl.innerHTML = '';
            const dbList = data.databases || [];
            const userQuery = data.user_query || '';
            let dbSelectionHtml = `
                <div class="ai-db-selection-card">
                    <div class="ai-db-selection-header">
                        <span style="font-size: 16px;">📊</span>
                        <span style="font-weight: 600; margin-left: 8px;">${escapeHtml(data.message)}</span>
                    </div>
                    <div class="ai-db-selection-body">
            `;
            
            dbList.forEach(db => {
                dbSelectionHtml += `
                    <div class="ai-db-option" onclick="selectDatabaseAndRetry('${db.id}', '${escapeHtml(userQuery).replace(/'/g, "\\'")}', '${messageId}')" style="cursor: pointer; padding: 12px 16px; margin: 6px 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; color: white; display: flex; align-items: center; justify-content: space-between; transition: transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 12px rgba(102,126,234,0.4)';" onmouseout="this.style.transform='';this.style.boxShadow='';">
                        <div>
                            <div style="font-weight: 600; font-size: 14px;">${escapeHtml(db.name)}</div>
                            <div style="font-size: 11px; opacity: 0.8; margin-top: 2px;">${escapeHtml(db.type || 'database')}</div>
                        </div>
                        <span style="font-size: 18px;">→</span>
                    </div>
                `;
            });
            
            dbSelectionHtml += `
                    </div>
                </div>
            `;
            contentEl.innerHTML = dbSelectionHtml;
            attemptsEl.style.display = 'none';
            markStep('等待选择', '请选择要操作的数据库', 'waiting');
            finalizeAiProcess(messageId);
            break;
            
        case 'intent_selection_required':
            statusEl.innerHTML = '';
            const intentList = data.intents || [];
            const intentUserQuery = data.user_query || '';
            const detectedIntent = data.detected || {};
            let intentSelectionHtml = `
                <div class="ai-db-selection-card">
                    <div class="ai-db-selection-header">
                        <span style="font-size: 16px;">🤔</span>
                        <span style="font-weight: 600; margin-left: 8px;">${escapeHtml(data.message)}</span>
                    </div>
            `;
            
            // 如果检测到低置信度意图，显示提示
            if (detectedIntent.reason && detectedIntent.confidence > 0) {
                intentSelectionHtml += `
                    <div style="padding: 8px 16px; background: rgba(255, 193, 7, 0.1); border-left: 3px solid #ffc107; margin: 8px 0; font-size: 12px; color: #856404;">
                        💡 检测到: ${escapeHtml(detectedIntent.reason)} (置信度 ${Math.round(detectedIntent.confidence * 100)}%)
                    </div>
                `;
            }
            
            intentSelectionHtml += `<div class="ai-db-selection-body">`;
            
            intentList.forEach(intent => {
                intentSelectionHtml += `
                    <div class="ai-db-option" onclick="selectIntentAndRetry('${intent.id}', '${escapeHtml(intentUserQuery).replace(/'/g, "\\'")}', '${messageId}')" style="cursor: pointer; padding: 12px 16px; margin: 6px 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; color: white; display: flex; align-items: center; justify-content: space-between; transition: transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 12px rgba(102,126,234,0.4)';" onmouseout="this.style.transform='';this.style.boxShadow='';">
                        <div>
                            <div style="font-weight: 600; font-size: 14px;"><span style="margin-right: 6px;">${intent.icon}</span>${escapeHtml(intent.name)}</div>
                            <div style="font-size: 11px; opacity: 0.8; margin-top: 2px;">${escapeHtml(intent.description)}</div>
                        </div>
                        <span style="font-size: 18px;">→</span>
                    </div>
                `;
            });
            
            intentSelectionHtml += `
                    </div>
                </div>
            `;
            contentEl.innerHTML = intentSelectionHtml;
            attemptsEl.style.display = 'none';
            markStep('等待选择', '请选择操作类型', 'waiting');
            finalizeAiProcess(messageId);
            break;
            
        case 'api_config_generated':
            statusEl.innerHTML = '';
            const config = data.config;
            let defaultParamsHtml = '';
            if (config.default_params && Object.keys(config.default_params).length > 0) {
                const paramsEntries = Object.entries(config.default_params).map(([key, value]) => {
                    return `<div style="margin: 4px 0;"><span style="color: #805ad5; font-weight: 500;">${escapeHtml(key)}</span>: <span style="color: #48bb78;">${typeof value === 'string' ? '"' + escapeHtml(value) + '"' : escapeHtml(String(value))}</span></div>`;
                }).join('');
                defaultParamsHtml = `
                    <div class="config-item" style="grid-column: 1 / -1;">
                        <span class="config-label">名称:</span>
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
                        <span style="font-weight: 600;">API 配置建议</span>
                        <button class="btn btn-sm" onclick="editApiConfigFromAI('${messageId}', ${escapeHtml(JSON.stringify(config))})">编辑</button>
                    </div>
                    <div class="ai-api-config-body">
                        <div class="config-item"><span class="config-label">名称:</span> <span class="config-value">${escapeHtml(config.name)}</span></div>
                        <div class="config-item"><span class="config-label">路径:</span> <span class="config-value">${escapeHtml(config.path)}</span></div>
                        <div class="config-item"><span class="config-label">方法:</span> <span class="config-value">${escapeHtml(config.method)}</span></div>
                        <div class="config-item"><span class="config-label">描述:</span> <span class="config-value">${escapeHtml(config.description || '')}</span></div>
                        <div class="config-item" style="grid-column: 1 / -1;"><span class="config-label">SQL:</span><div class="ai-sql-block" style="margin-top: 6px;">${escapeHtml(config.sql)}</div></div>
                        ${defaultParamsHtml}
                    </div>
                    <div class="ai-api-config-actions">
                        <button class="btn btn-primary" onclick="confirmCreateApiFromAI(${escapeHtml(JSON.stringify(config))}, '${messageId}')">创建</button>
                        <button class="btn" onclick="cancelCreateApiFromAI('${messageId}')">取消</button>
                    </div>
                </div>
            `;
            contentEl.innerHTML = configHtml;
            attemptsEl.style.display = 'none';
            markStep('创建完成', 'API 配置已生成', 'done');
            finalizeAiProcess(messageId);
            break;

        case 'governance_task_draft':
            statusEl.innerHTML = '';
            const govDraft = data.task || {};
            if (!window._aiGovDraftByMessageId) window._aiGovDraftByMessageId = {};
            window._aiGovDraftByMessageId[messageId] = govDraft;
            const govCronDisplay = govDraft.cron_expr ? escapeHtml(govDraft.cron_expr) : '未设置';
            const govInputTypeDisplay = { file: '文件', text: '文本', both: '文件+文本' }[govDraft.input_type] || '未设置';
            const govExtsDisplay = (govDraft.accept_exts && govDraft.accept_exts.length) ? escapeHtml(govDraft.accept_exts.join(', ')) : '未设置';
            const govTaskHtml = `
                <div style="margin-bottom: 6px;">${formatAIText(data.message)}</div>
                <div class="ai-api-config-preview ai-gov-draft-preview" id="gov-draft-${messageId}">
                    <div class="ai-api-config-header">
                        <span style="font-weight: 600;">治理任务草稿</span>
                        <button class="btn btn-sm" onclick="editGovTaskDraftFromAI('${messageId}')">编辑</button>
                    </div>
                    <div class="ai-api-config-body">
                        <div class="config-item"><span class="config-label">名称:</span> <span class="config-value">${escapeHtml(govDraft.name || '')}</span></div>
                        <div class="config-item"><span class="config-label">类型:</span> <span class="config-value">${govDraft.type === 'scheduled' ? '定时' : '交互'}</span></div>
                        <div class="config-item"><span class="config-label">描述:</span> <span class="config-value">${escapeHtml(govDraft.description || '未填写')}</span></div>
                        ${govDraft.type === 'scheduled' ? `<div class="config-item"><span class="config-label">Cron:</span> <span class="config-value">${govCronDisplay}</span></div>` : ''}
                        ${govDraft.type === 'interactive' ? `<div class="config-item"><span class="config-label">输入类型:</span> <span class="config-value">${govInputTypeDisplay}</span></div>` : ''}
                        ${govDraft.type === 'interactive' ? `<div class="config-item"><span class="config-label">允许扩展名:</span> <span class="config-value">${govExtsDisplay}</span></div>` : ''}
                        <div class="config-item" style="grid-column: 1 / -1;"><span class="config-label">脚本:</span><div class="ai-sql-block" style="margin-top: 6px; max-height: 120px; overflow: auto;">${escapeHtml((govDraft.js_code || '').slice(0, 500))}${(govDraft.js_code || '').length > 500 ? '...' : ''}</div></div>
                    </div>
                    <div class="ai-api-config-actions">
                        <button class="btn btn-primary" onclick="confirmCreateGovTaskFromAI('${messageId}')">确认创建</button>
                        <button class="btn" onclick="cancelGovTaskDraft('${messageId}')">取消</button>
                    </div>
                </div>
            `;
            contentEl.innerHTML = govTaskHtml;
            attemptsEl.style.display = 'none';
            markStep('治理任务完成', '治理任务草稿已生成', 'done');
            finalizeAiProcess(messageId);
            break;

        case 'quality_rule_draft':
            statusEl.innerHTML = '';
            const rule = data.rule || {};
            const ruleHtml = `
                <div style="margin-bottom: 6px;">${formatAIText(data.message)}</div>
                <div class="ai-api-config-preview ai-quality-preview">
                    <div class="ai-api-config-header">
                        <span style="font-weight: 600;">质量规则草稿</span>
                    </div>
                    <div class="ai-api-config-body">
                        <div class="config-item"><span class="config-label">编号:</span> <span class="config-value">${escapeHtml(rule.nm || '未设置')}</span></div>
                        <div class="config-item"><span class="config-label">序号:</span> <span class="config-value">${escapeHtml(rule.xh || '未设置')}</span></div>
                        <div class="config-item"><span class="config-label">名称:</span> <span class="config-value">${escapeHtml(rule.name || '未设置')}</span></div>
                        <div class="config-item"><span class="config-label">分类:</span> <span class="config-value">${escapeHtml(rule.category || '未设置')}</span></div>
                        <div class="config-item" style="grid-column: 1 / -1;"><span class="config-label">SQL:</span><div class="ai-sql-block" style="margin-top: 6px;">${escapeHtml(rule.sql || '')}</div></div>
                    </div>
                </div>
            `;
            contentEl.innerHTML = ruleHtml;
            attemptsEl.style.display = 'none';
            markStep('质量规则完成', '质量规则草稿已生成', 'done');
            finalizeAiProcess(messageId);
            break;

        case 'small_model_draft':
            statusEl.innerHTML = '';
            const model = data.model || {};
            const modelHtml = `
                <div style="margin-bottom: 6px;">${formatAIText(data.message)}</div>
                <div class="ai-api-config-preview ai-quality-preview">
                    <div class="ai-api-config-header">
                        <span style="font-weight: 600;">小模型草稿</span>
                    </div>
                    <div class="ai-api-config-body">
                        <div class="config-item"><span class="config-label">名称:</span> <span class="config-value">${escapeHtml(model.name || '未命名')}</span></div>
                        <div class="config-item"><span class="config-label">描述:</span> <span class="config-value">${escapeHtml(model.description || '未填写')}</span></div>
                        <div class="config-item"><span class="config-label">输入类型:</span> <span class="config-value">${escapeHtml(model.input_type || '未设置')}</span></div>
                        <div class="config-item"><span class="config-label">输出类型:</span> <span class="config-value">${escapeHtml(model.output_type || '未设置')}</span></div>
                        <div class="config-item" style="grid-column: 1 / -1;"><span class="config-label">脚本:</span><div class="ai-sql-block" style="margin-top: 6px; max-height: 120px; overflow: auto;">${escapeHtml((model.js_code || '').slice(0, 500))}${(model.js_code || '').length > 500 ? '...' : ''}</div></div>
                    </div>
                </div>
            `;
            contentEl.innerHTML = modelHtml;
            attemptsEl.style.display = 'none';
            markStep('小模型完成', '小模型草稿已生成', 'done');
            finalizeAiProcess(messageId);
            break;

        case 'answer':
            statusEl.innerHTML = '';
            contentEl.innerHTML = `<div style="margin-bottom: 6px;">${formatAIText(data.text || data.message || '')}</div>`;
            attemptsEl.style.display = 'none';
            markStep('回答完成', '已生成最终回答', 'done');
            finalizeAiProcess(messageId);
            break;
            
        case 'done':
            finalizeAiProcess(messageId);
            break;
    }
    
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// 添加 AI 加载消息。
function addAiLoadingMessage() {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-loading-' + Date.now();
    
    const messageHtml = `
        <div class="ai-message assistant" id="${messageId}">
            <div class="ai-message-avatar">${getAiAvatarSvg()}</div>
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

// 移除 AI 消息。
function removeAiMessage(messageId) {
    const messageEl = document.getElementById(messageId);
    if (messageEl) {
        messageEl.remove();
    }
}

// 显示 AI 错误消息。
function showAiError(message) {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-error-' + Date.now();
    
    const messageHtml = `
        <div class="ai-message assistant" id="${messageId}">
            <div class="ai-message-avatar">${getAiAvatarSvg()}</div>
            <div class="ai-message-content">
                <div class="ai-error">${escapeHtml(message)}</div>
            </div>
        </div>
    `;
    
    messagesEl.insertAdjacentHTML('beforeend', messageHtml);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// HTML 转义。
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

// Render gov.showTable() output as HTML table
function renderGovOutput(text) {
    if (typeof text !== 'string') return escapeHtml(String(text));

    // 先将字面量 \n 转换为真正的换行符
    text = text.replace(/\\n/g, '\n');

    const prefix = '__TABLE__:';
    const tryRender = function (jsonStr) {
        try {
            const data = JSON.parse(jsonStr);
            if (!Array.isArray(data) || data.length === 0) {
                return '<div class="gov-table-empty">暂无数据</div>';
            }
            const keys = [...new Set(data.flatMap(obj => Object.keys(obj)))];
            let html = '<div class="gov-table-wrapper"><table class="gov-table"><thead><tr>';
            keys.forEach(key => {
                html += `<th>${escapeHtml(key)}</th>`;
            });
            html += '</tr></thead><tbody>';
            data.forEach(row => {
                html += '<tr>';
                keys.forEach(key => {
                    const val = row[key];
                    html += `<td>${val !== undefined && val !== null ? escapeHtml(String(val)) : ''}</td>`;
                });
                html += '</tr>';
            });
            html += '</tbody></table></div>';
            return html;
        } catch (e) {
            return escapeHtml(prefix + jsonStr);
        }
    };

    // 处理多行文本，逐行检查是否有 __TABLE__: 标记
    const lines = text.split('\n');
    const result = lines.map(line => {
        if (line.startsWith(prefix)) {
            return tryRender(line.substring(prefix.length));
        }
        if (line.startsWith('__TABLE_ROWS__:')) {
            return tryRender(line.substring('__TABLE_ROWS__'.length));
        }
        return escapeHtml(line);
    });
    return result.join('<br>');
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
                const icon = dbTypeIcons[db.type] || '🗃️';
                return `<span class="ai-context-tag ai-context-tag-db">${icon} ${escapeHtml(db.name)}</span>`;
            }).join('');
        }

        contextEl.innerHTML = `
            <div class="ai-context-info">
                <span class="ai-context-label">当前上下文:</span>
                <span class="ai-context-value">${tagsHtml}</span>
                <button class="ai-context-clear" onclick="clearAiContext()" title="清空当前上下文">×</button>
            </div>
        `;

        if (input) {
            input.placeholder = '输入消息...（可用 @ 引用上下文）';
        }
    } else {
        if (contextEl) {
            contextEl.remove();
        }
        if (input) {
            input.placeholder = '输入消息...（输入 @ 选择上下文）';
        }
    }
}

// 清空 AI 上下文。
function clearAiContext() {
    if (confirm('确定清空当前 AI 上下文吗？')) {
        aiSessionContext.databases = [];
        aiSessionContext.modules = [];
        aiSessionContext.history = [];
        updateAiContextDisplay();

        const messagesEl = document.getElementById('aiChatMessages');
        const messageId = 'msg-clear-' + Date.now();
        const messageHtml = `
            <div class="ai-message assistant" id="${messageId}" style="opacity: 0.8;">
                <div class="ai-message-avatar">${getAiAvatarSvg()}</div>
                <div class="ai-message-content">
                    <div style="padding: 12px; background: #e6f7ff; border-left: 3px solid #1890ff; border-radius: 6px; color: #0050b3; font-size: 13px;">
                        当前上下文已清空，可继续通过 @ 选择数据库或模块。
                    </div>
                </div>
            </div>
        `;
        messagesEl.insertAdjacentHTML('beforeend', messageHtml);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }
}

// ==================== AI 配置确认 ====================

// 从 AI 生成的配置中打开编辑弹窗。
function editApiConfigFromAI(messageId, config) {
    // 切换到新增模式。
    isEditApiMode = false;
    editingApiId = null;
    document.getElementById('apiModalTitle').textContent = '新增 API';
    document.getElementById('addApiModal').classList.add('show');
    
    // 默认按 query 接口填充。
    document.getElementById('apiTypeQuery').checked = true;
    switchApiTypeFields('query');
    document.getElementById('apiNameInput').value = config.name || '';
    document.getElementById('apiPathInput').value = config.path || '';
    document.getElementById('apiMethodInput').value = config.method || 'GET';
    document.getElementById('apiSqlInput').value = config.sql || '';
    document.getElementById('apiDescInput').value = config.description || '';
    
    // 填充默认参数。
    if (config.default_params && Object.keys(config.default_params).length > 0) {
        document.getElementById('apiDefaultParamsInput').value = JSON.stringify(config.default_params, null, 2);
    } else {
        document.getElementById('apiDefaultParamsInput').value = '';
    }
    
    // 加载数据库后再选中目标库。
    loadDatabasesForSelect().then(() => {
        if (config.database_id) {
            document.getElementById('apiDbSelect').value = config.database_id;
        }
    });
    
    // 标记为 AI 生成来源。
    document.getElementById('addApiForm').dataset.fromAi = 'true';
    document.getElementById('addApiForm').dataset.aiMessageId = messageId;
    
    document.getElementById('apiFormError').classList.remove('show');
    document.getElementById('apiFormSuccess').classList.remove('show');
}

// 确认创建 AI 生成的 API。
async function confirmCreateApiFromAI(config, messageId) {
    // 显示处理中状态。
    const contentEl = document.getElementById(`${messageId}-content`);
    if (contentEl) {
        contentEl.innerHTML = '<div class="ai-loading"><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div> 处理中...</div>';
    }
    
    // 先刷新数据库下拉框。
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
    
    // 复制默认参数。
    if (config.default_params) {
        apiData.default_params = config.default_params;
    }
    
    if (!apiData.database_id) {
        if (contentEl) {
            contentEl.innerHTML = '<div class="ai-error">请先选择一个数据库</div>';
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
            // 生成成功后显示结果。
            if (contentEl) {
                contentEl.innerHTML = `
                    <div style="padding: 12px; background: #d4edda; border-left: 3px solid #28a745; border-radius: 6px; color: #155724; font-size: 14px;">
                        <strong>创建成功</strong><br>
                        <span style="font-size: 13px; margin-top: 4px; display: block;">
                            名称：${escapeHtml(apiData.name)}<br>
                            路径：${escapeHtml(apiData.path)}<br>
                            已同步到“API 列表”。
                        </span>
                    </div>
                `;
            }
            
            // 如果当前停留在 API 页，则刷新列表。
            if (document.querySelector('[data-tab="api"]').classList.contains('active')) {
                loadApis();
            }
        } else {
            if (contentEl) {
                contentEl.innerHTML = `<div class="ai-error">创建失败：${escapeHtml(data.message || '未知错误')}</div>`;
            }
        }
    } catch (error) {
        if (contentEl) {
            contentEl.innerHTML = `<div class="ai-error">创建失败：${escapeHtml(error.message)}</div>`;
        }
    }
}

// 取消 AI 生成的 API 创建。
function cancelCreateApiFromAI(messageId) {
    const contentEl = document.getElementById(`${messageId}-content`);
    if (contentEl) {
        contentEl.innerHTML = `
            <div style="padding: 12px; background: #f8f9fa; border-left: 3px solid #6c757d; border-radius: 6px; color: #495057; font-size: 13px;">
                已取消创建。
            </div>
        `;
    }
}

// 创建治理任务草稿并提交。
async function confirmCreateGovTaskFromAI(messageId) {
    const draft = window._aiGovDraftByMessageId && window._aiGovDraftByMessageId[messageId];
    if (!draft) return;
    const contentEl = document.getElementById(`${messageId}-content`);
    if (contentEl) {
        contentEl.innerHTML = '<div class="ai-loading"><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div> 处理中...</div>';
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
                    治理任务创建成功。
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
                    ${escapeHtml('创建失败：' + err.message)}
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
                已取消治理任务草稿。
            </div>
        `;
    }
    if (window._aiGovDraftByMessageId) delete window._aiGovDraftByMessageId[messageId];
}

// 从 AI 草稿打开治理任务编辑弹窗。
function editGovTaskDraftFromAI(messageId) {
    const draft = window._aiGovDraftByMessageId && window._aiGovDraftByMessageId[messageId];
    if (!draft) return;
    isEditGovMode = false;
    editingGovTaskId = null;
    document.getElementById('govModalTitle').textContent = '编辑治理任务';
    document.getElementById('govTaskNameInput').value = draft.name || '';
    document.getElementById('govTaskTypeInput').value = draft.type || 'interactive';
    document.getElementById('govTaskDescInput').value = draft.description || '';
    document.getElementById('govCodeInput').value = draft.js_code || '';
    document.getElementById('govCronInput').value = draft.cron_expr || '';
    document.getElementById('govEnabledInput').checked = true;
    document.getElementById('govEnabledLabel').textContent = '启用';
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

// ==================== 表结构管理 ====================

// 打开创建表弹窗。
function showCreateTableModal() {
    if (!currentDb) {
        showToast('请先选择一个数据库', 'warning');
        return;
    }
    
    document.getElementById('createTableModal').classList.add('show');
    document.getElementById('createTableForm').reset();
    document.getElementById('createTableError').classList.remove('show');
    document.getElementById('createTableSuccess').classList.remove('show');
    
    // 显示AI消息历史
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
            <button type="button" class="btn-icon" onclick="removeTableColumn(this)" title="删除">×</button>
        </div>
    `;
}

// 清空AI消息历史
function hideCreateTableModal() {
    document.getElementById('createTableModal').classList.remove('show');
}

// 治理标签页
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
        <button type="button" class="btn-icon" onclick="removeTableColumn(this)" title="删除">×</button>
    `;
    columnsContainer.appendChild(newColumn);
}

// 加载治理任务
function removeTableColumn(btn) {
    const columnsContainer = document.getElementById('tableColumnsContainer');
    if (columnsContainer.children.length <= 1) {
        showToast('至少保留一列', 'warning');
        return;
    }
    btn.parentElement.remove();
}

// 提交创建表单。
async function handleCreateTable(e) {
    e.preventDefault();
    
    if (!currentDb) return;
    
    const tableName = document.getElementById('tableNameInput').value.trim();
    const columnItems = document.querySelectorAll('.table-column-item');
    
    // 表名不能为空。
    if (!tableName) {
        showCreateTableError('请输入表名');
        return;
    }
    
    // 表名只能包含字母、数字和下划线，且不能以数字开头。
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        showCreateTableError('表名只能包含字母、数字和下划线，且不能以数字开头');
        return;
    }
    
    // 至少需要一列。
    if (columnItems.length === 0) {
        showCreateTableError('请至少添加一列');
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
            showCreateTableError('请输入列名');
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
            successEl.textContent = '创建成功';
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

// 显示创建表错误。
function showCreateTableError(message) {
    const errorEl = document.getElementById('createTableError');
    errorEl.textContent = message;
    errorEl.classList.add('show');
}

// ==================== 治理任务 ====================

let govTasks = [];
let currentGovTask = null;
let isEditGovMode = false;
let editingGovTaskId = null;
let govCurrentFilter = 'all';
/** @type {File[]} */
let govSelectedFiles = [];

// 注册治理任务相关事件。
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

        // 拖拽上传区域。
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
 * 加载治理任务列表并刷新详情视图。
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
        console.error('加载治理任务失败', error);
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
        container.innerHTML = '<div class="gov-output-placeholder" style="padding:30px;color:#a0aec0;">暂无治理任务</div>';
        return;
    }

    container.innerHTML = filtered.map(t => {
        const safeTId = escapeHtml(t.id);
        return `
        <div class="gov-task-item ${currentGovTask && currentGovTask.id === t.id ? 'active' : ''}"
             data-task-id="${safeTId}"
             draggable="true"
             onclick="selectGovTask('${safeTId}')">
            <div class="gov-task-item-icon">${t.type === 'scheduled' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>'}</div>
            <div class="gov-task-item-info">
                <div class="gov-task-item-name">
                    ${escapeHtml(t.name)}
                    ${t.register_as_api ? '<span class="gov-api-badge" title="注册为 API">API</span>' : ''}
                </div>
                <div class="gov-task-item-meta">
                    <span class="gov-task-badge ${t.type}">${t.type === 'scheduled' ? '定时' : '交互'}</span>
                    <span class="gov-status-icon ${t.status}">${t.status === 'idle' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>' : t.status === 'running' ? '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>' : t.status === 'success' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'}</span>
                    <span>${t.status === 'idle' ? '待运行' : t.status === 'running' ? '运行中' : t.status === 'success' ? '成功' : '失败'}</span>
                </div>
            </div>
            ${t.example_files && t.example_files.length ? `<button type="button" class="gov-example-btn" onclick="event.stopPropagation(); govDownloadExamplesForTask('${safeTId}')">下载样例</button>` : ''}
        </div>
    `;}).join('');

    // 添加拖拽事件监听
    container.querySelectorAll('.gov-task-item').forEach(item => {
        item.addEventListener('dragstart', handleGovTaskDragStart);
        item.addEventListener('dragend', handleGovTaskDragEnd);
        item.addEventListener('dragover', handleGovTaskDragOver);
        item.addEventListener('dragleave', handleGovTaskDragLeave);
        item.addEventListener('drop', handleGovTaskDrop);
    });
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

// 治理任务拖拽排序事件处理
function handleGovTaskDragStart(e) {
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', e.currentTarget.dataset.taskId);
}

function handleGovTaskDragEnd() {
    document.querySelectorAll('.gov-task-item.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.gov-task-item.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function handleGovTaskDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const draggingItem = document.querySelector('.gov-task-item.dragging');
    if (draggingItem && draggingItem !== e.currentTarget) {
        e.currentTarget.classList.add('drag-over');
    }
}

function handleGovTaskDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

async function handleGovTaskDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');

    const dragTaskId = e.dataTransfer.getData('text/plain');
    const dropTaskId = e.currentTarget.dataset.taskId;
    if (dragTaskId === dropTaskId) return;

    // 构建新的完整任务顺序
    const newOrder = govTasks.map(t => t.id);
    const dragIndex = newOrder.indexOf(dragTaskId);
    const dropIndex = newOrder.indexOf(dropTaskId);
    if (dragIndex === -1 || dropIndex === -1) return;

    const [removed] = newOrder.splice(dragIndex, 1);
    newOrder.splice(dropIndex, 0, removed);

    // 保存到后端
    const userSettings = await loadUserSettings();
    userSettings.govTaskOrder = newOrder;
    await saveUserSettings(userSettings);

    // 重新加载任务列表（后端会返回排序后的结果）
    await loadGovernanceTasks();
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
    document.getElementById('govTaskType').textContent = task.type === 'scheduled' ? '定时任务' : '交互任务';

    const statusMap = { idle: '待运行', running: '运行中', success: '成功', error: '失败' };
    const statusEl = document.getElementById('govTaskStatus');
    statusEl.textContent = statusMap[task.status] || task.status;
    statusEl.className = 'info-value status ' + task.status;

    const cronItem = document.getElementById('govCronItem');
    const enabledItem = document.getElementById('govEnabledItem');
    if (task.type === 'scheduled') {
        cronItem.style.display = '';
        enabledItem.style.display = '';
        document.getElementById('govTaskCron').textContent = task.cron_expr || '未设置';
        document.getElementById('govTaskEnabled').textContent = task.enabled ? '启用' : '禁用';
        document.getElementById('govToggleBtn').textContent = task.enabled ? '停用' : '启用';
    } else {
        cronItem.style.display = 'none';
        enabledItem.style.display = 'none';
    }

    // 显示关联数据库名称。
    const dbName = databases.find(d => d.id === task.database_id);
    document.getElementById('govTaskDb').textContent = dbName ? dbName.name : '未绑定';

    document.getElementById('govTaskLastRun').textContent = task.last_run_at ? new Date(task.last_run_at).toLocaleString() : '从未运行';

    document.getElementById('govTaskCode').textContent = task.js_code;

    const execMode = task.run_mode || task.execution_mode || task.exec_mode || 'backend';
    const execModeEl = document.getElementById('govTaskRunMode');
    if (execModeEl) {
        execModeEl.textContent = execMode === 'frontend' ? '前端运行' : '后端运行';
    }

    // 交互任务时显示上传区。
    const interactiveSection = document.getElementById('govInteractiveSection');
    if (task.type === 'interactive') {
        interactiveSection.style.display = '';
        const inputType = task.input_type || 'file';
        document.getElementById('govFileUploadArea').style.display = (inputType === 'file' || inputType === 'both') ? '' : 'none';
        document.getElementById('govTextInputArea').style.display = (inputType === 'text' || inputType === 'both') ? '' : 'none';
        const exts = task.accept_exts && task.accept_exts.length > 0 ? task.accept_exts.join(', ') : '未设置';
        document.getElementById('govAcceptExts').textContent = '允许扩展名: ' + exts;
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
        console.error('加载治理日志失败', error);
        showToast('加载治理日志失败', 'error');
    }
}

function renderGovLogs(logs) {
    const container = document.getElementById('govTaskOutput');
    if (logs.length === 0) {
        container.innerHTML = '<div class="gov-output-placeholder">暂无日志</div>';
        return;
    }
    const sorted = [...logs].sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
    container.innerHTML = sorted.map(log => `
        <div class="gov-log-entry" data-log-id="${log.id}">
            <div class="gov-log-header">
                <span>${new Date(log.start_time).toLocaleString()}${log.end_time ? ' → ' + new Date(log.end_time).toLocaleString() : ''}</span>
                <div class="gov-log-actions">
                    <span class="gov-log-status ${log.status}">${log.status === 'success' ? '成功' : log.status === 'error' ? '失败' : '运行中'}</span>
                    <button class="btn btn-sm btn-danger" onclick="deleteGovTaskLog('${log.id}')" title="删除此日志">🗑️</button>
                </div>
            </div>
            ${log.input ? `<div class="gov-log-input">输入: ${escapeHtml(log.input)}</div>` : ''}
            ${log.output ? `<div class="gov-log-output">${renderGovOutput(log.output)}</div>` : ''}
            ${log.error ? `<div class="gov-log-error">${escapeHtml(log.error)}</div>` : ''}
        </div>
    `).join('');
}

async function deleteGovTaskLog(logId) {
    if (!currentGovTask || !logId) return;
    if (!confirm('确定要删除这条执行日志吗？')) return;
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/tasks/${currentGovTask.id}/logs/${logId}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            showToast('日志已删除', 'success');
            loadGovTaskLogs();
        } else {
            showToast(data.message || '删除失败', 'error');
        }
    } catch (error) {
        console.error('删除日志失败', error);
        showToast('删除日志失败', 'error');
    }
}

async function clearGovTaskLogs() {
    if (!currentGovTask) return;
    if (!confirm('确定要清空所有执行日志吗？此操作不可恢复。')) return;
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/tasks/${currentGovTask.id}/logs-clear`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            showToast('日志已清空', 'success');
            loadGovTaskLogs();
        } else {
            showToast(data.message || '清空失败', 'error');
        }
    } catch (error) {
        console.error('清空日志失败', error);
        showToast('清空日志失败', 'error');
    }
}

// 新增/编辑治理任务
function showAddGovTaskModal() {
    isEditGovMode = false;
    editingGovTaskId = null;
    document.getElementById('govModalTitle').textContent = '新增治理任务';
    document.getElementById('govTaskForm').reset();
    document.getElementById('govEnabledInput').checked = true;
    document.getElementById('govEnabledLabel').textContent = '已启用';
    // 重置 API 设置
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
    document.getElementById('govModalTitle').textContent = '编辑治理任务';
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
    // API 设置
    document.getElementById('govRegisterAPIInput').checked = currentGovTask.register_as_api || false;
    document.getElementById('govRegisterAPILabel').textContent = currentGovTask.register_as_api ? '已注册' : '未注册';
    document.getElementById('govAPIPathInput').value = currentGovTask.api_path || '';
    document.getElementById('govAPIMethodInput').value = currentGovTask.api_method || 'POST';
    document.getElementById('govAPIFields').style.display = currentGovTask.register_as_api ? '' : 'none';
    // 分享设置
    document.getElementById('govShareEnabledInput').checked = currentGovTask.share_enabled || false;
    document.getElementById('govShareEnabledLabel').textContent = currentGovTask.share_enabled ? '已开启' : '未开启';
    document.getElementById('govShareFields').style.display = currentGovTask.share_enabled ? '' : 'none';
    if (currentGovTask.share_enabled && currentGovTask.share_token) {
        updateShareLink(currentGovTask.share_token);
    }
    const currentRunMode = currentGovTask.run_mode || currentGovTask.execution_mode || currentGovTask.exec_mode || 'backend';
    const runModeSelect = document.getElementById('govRunModeSelect');
    if (runModeSelect) runModeSelect.value = currentRunMode;
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
    const runModeGroup = document.getElementById('govRunModeGroup');
    if (runModeGroup) {
        runModeGroup.style.display = type === 'interactive' ? '' : 'none';
    }
}

// 提取中文拼音首字母。
function chineseToPinyinInitials(str) {
    const pinyinMap = {
        '?': 'a', '?': 'a', '?': 'a', '?': 'a', '?': 'a',
        '?': 'b', '?': 'b', '?': 'b', '?': 'b', '?': 'b', '?': 'b', '?': 'b',
        '?': 'c', '?': 'c', '?': 'c', '?': 'c', '?': 'c', '?': 'c', '?': 'c',
        '?': 'd', '?': 'd', '?': 'd', '?': 'd', '?': 'd', '?': 'd', '?': 'd', '?': 'd', '?': 'd', '?': 'd', '?': 'd', '?': 'd', '?': 'd',
        '?': 'e', '?': 'e',
        '?': 'f', '?': 'f', '?': 'f', '?': 'f', '?': 'f', '?': 'f',
        '?': 'g', '?': 'g', '?': 'g', '?': 'g', '?': 'g', '?': 'g', '?': 'g', '?': 'g', '?': 'g', '?': 'g', '?': 'g', '?': 'g',
        '?': 'h', '?': 'h', '?': 'h', '?': 'h', '?': 'h', '?': 'h', '?': 'h', '?': 'h', '?': 'h',
        '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j', '?': 'j',
        '?': 'k', '?': 'k', '?': 'k', '?': 'k', '?': 'k', '?': 'k',
        '?': 'l', '?': 'l', '?': 'l', '?': 'l', '?': 'l', '?': 'l', '?': 'l', '?': 'l', '?': 'l', '?': 'l', '?': 'l',
        '?': 'm', '?': 'm', '?': 'm', '?': 'm', '?': 'm', '?': 'm', '?': 'm', '?': 'm', '?': 'm', '?': 'm', '?': 'm', '?': 'm',
        '?': 'n', '?': 'n', '?': 'n', '?': 'n', '?': 'n', '?': 'n',
        '?': 'o',
        '?': 'p', '?': 'p', '?': 'p', '?': 'p', '?': 'p',
        '?': 'q', '?': 'q', '?': 'q', '?': 'q', '?': 'q', '?': 'q', '?': 'q', '?': 'q', '?': 'q', '?': 'q', '?': 'q',
        '?': 'r', '?': 'r', '?': 'r', '?': 'r', '?': 'r',
        '?': 's', '?': 's', '?': 's', '?': 's', '?': 's', '?': 's', '?': 's', '?': 's', '?': 's', '?': 's', '?': 's', '?': 's', '?': 's', '?': 's', '?': 's', '?': 's', '?': 's', '?': 's', '?': 's', '?': 's',
        '?': 't', '?': 't', '?': 't', '?': 't', '?': 't', '?': 't', '?': 't', '?': 't', '?': 't', '?': 't',
        '?': 'w', '?': 'w', '?': 'w', '?': 'w', '?': 'w', '?': 'w', '?': 'w', '?': 'w', '?': 'w', '?': 'w', '?': 'w',
        '?': 'x', '?': 'x', '?': 'x', '?': 'x', '?': 'x', '?': 'x', '?': 'x', '?': 'x', '?': 'x', '?': 'x', '?': 'x', '?': 'x', '?': 'x', '?': 'x', '?': 'x', '?': 'x',
        '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y', '?': 'y',
        '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z', '?': 'z',
        '?': 's', '?': 'j', '?': 'z', '?': 'l', '?': 'r', '?': 'w', '?': 'd', '?': 'r', '?': 'c', '?': 'b', '?': 'g', '?': 'c', '?': 'x', '?': 'c', '?': 's', '?': 'y', '?': 'x', '?': 'p', '?': 'z', '?': 'c', '?': 'x', '?': 'g', '?': 'x', '?': 's', '?': 'c', '?': 't', '?': 'j', '?': 'b', '?': 'j', '?': 'c', '?': 'j'
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
    document.getElementById('govRegisterAPILabel').textContent = checked ? '启用' : '关闭';

    // 若启用 API 注册，则自动生成路径。
    if (checked && !document.getElementById('govAPIPathInput').value) {
        const taskName = document.getElementById('govTaskNameInput').value.trim();
        if (taskName) {
            const initials = chineseToPinyinInitials(taskName);
            document.getElementById('govAPIPathInput').value = `/api/tasks/${initials}`;
        }
    }
}

function onGovShareEnabledChange() {
    const checked = document.getElementById('govShareEnabledInput').checked;
    document.getElementById('govShareFields').style.display = checked ? '' : 'none';
    document.getElementById('govShareEnabledLabel').textContent = checked ? '已开启' : '未开启';

    if (checked && currentGovTask && currentGovTask.share_token) {
        updateShareLink(currentGovTask.share_token);
    }
}

function updateShareLink(shareToken) {
    const baseUrl = window.location.origin;
    const shareLink = `${baseUrl}/share/${shareToken}`;
    document.getElementById('govShareLinkInput').value = shareLink;
}

function copyShareLink() {
    const input = document.getElementById('govShareLinkInput');
    input.select();
    document.execCommand('copy');
    alert('分享链接已复制到剪贴板');
}

async function toggleGovTaskShare(taskId, enable) {
    try {
        const url = `${API_BASE}/api/data-ontology/governance/tasks/${taskId}/share`;
        const method = enable ? 'POST' : 'DELETE';
        const response = await fetchWithAuth(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        if (data.success) {
            await loadGovernanceTasks();
            return data;
        } else {
            alert('操作失败: ' + data.message);
            return null;
        }
    } catch (error) {
        console.error('切换分享状态失败:', error);
        alert('操作失败');
        return null;
    }
}

function populateGovDbSelect() {
    const select = document.getElementById('govTaskDbSelect');
    select.innerHTML = '<option value="">请选择数据库</option>';
    databases.forEach(db => {
        select.innerHTML += `<option value="${escapeHtml(db.id)}">${escapeHtml(db.name)} (${escapeHtml(db.type)})</option>`;
    });
}

async function handleGovTaskSubmit(e) {
    e.preventDefault();
    const type = document.getElementById('govTaskTypeInput').value;
    const extsStr = document.getElementById('govAcceptExtsInput').value.trim();
    const registerAsAPI = document.getElementById('govRegisterAPIInput').checked;
    const shareEnabled = document.getElementById('govShareEnabledInput').checked;
    const runMode = document.getElementById('govRunModeSelect') ? document.getElementById('govRunModeSelect').value : (currentGovTask?.run_mode || 'backend');
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
        share_enabled: shareEnabled,
        run_mode: runMode,
        execution_mode: runMode
    };

    if (!taskData.name || !taskData.js_code) {
        document.getElementById('govFormError').textContent = '名称和脚本不能为空';
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
            const savedId = data?.task?.id || data?.id || editingGovTaskId || null;
            document.getElementById('govFormSuccess').textContent = isEditGovMode ? '已保存' : '已创建';
            document.getElementById('govFormSuccess').classList.add('show');
            setTimeout(async () => {
                try {
                    hideGovTaskModal();
                    await loadGovernanceTasks();
                    if (savedId) {
                        const fresh = govTasks.find(t => t.id === savedId);
                        if (fresh) {
                            const expected = {
                                name: taskData.name,
                                type: taskData.type,
                                description: taskData.description,
                                js_code: taskData.js_code,
                                database_id: taskData.database_id,
                                cron_expr: taskData.cron_expr,
                                enabled: taskData.enabled,
                                input_type: taskData.input_type,
                                accept_exts: taskData.accept_exts,
                                file_batch_mode: taskData.file_batch_mode,
                                register_as_api: taskData.register_as_api,
                                api_path: taskData.api_path,
                                api_method: taskData.api_method,
                                run_mode: taskData.run_mode,
                                execution_mode: taskData.execution_mode
                            };
                            const normalize = (val, key) => {
                                // 数组或 null：JSON 序列化，null/undefined 视为空数组
                                if (Array.isArray(val)) return JSON.stringify(val);
                                if (val === null || val === undefined) return '[]';
                                // 布尔：统一为 "true"/"false"
                                if (typeof val === 'boolean') return String(val);
                                // 字符串：trim 后返回
                                return String(val ?? '').trim();
                            };
                            const mismatched = [];
                            for (const key of Object.keys(expected)) {
                                const a = normalize(expected[key], key);
                                const b = normalize(fresh[key], key);
                                if (a === b) continue;
                                // 容错1：前端发空字符串，服务端保留旧值（因 PUT 对空值不覆盖），属正常行为
                                // 容错2：前端 execution_mode 与 run_mode 设为相同值，服务端回填逻辑可能调整，跳过比对
                                const aEmpty = (a === '' || a === 'undefined');
                                const bEmpty = (b === '' || b === 'undefined');
                                if (aEmpty || bEmpty) continue;
                                // 容错3：execution_mode 和 run_mode 服务端会互相回填
                                if (key === 'execution_mode' && (b === fresh['run_mode'] || b === fresh['runtime'])) continue;
                                if (key === 'run_mode' && a === expected['execution_mode']) continue;
                                mismatched.push(key);
                            }
                            if (mismatched.length > 0) {
                                showToast('保存已返回成功，但服务端回读字段不一致：' + mismatched.join(', '), 'warning', 6000);
                            }
                            selectGovTask(fresh.id);
                        }
                    }
                } catch (verifyErr) {
                    showToast('保存成功，但回读验证失败：' + verifyErr.message, 'warning', 6000);
                }
            }, 600);
        } else {
            document.getElementById('govFormError').textContent = data.message || '保存失败';
            document.getElementById('govFormError').classList.add('show');
        }
    } catch (error) {
        document.getElementById('govFormError').textContent = '保存失败：' + error.message;
        document.getElementById('govFormError').classList.add('show');
    }
}

async function deleteGovTask() {
    if (!currentGovTask) return;
    if (!confirm(`确定删除治理任务“${currentGovTask.name}”吗？此操作不可恢复。`)) return;
    
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
        showToast('删除失败：' + error.message, 'error');
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.textContent = originalText;
        }
    }
}

function getGovTaskRunMode(task) {
    const mode = String(task?.run_mode || task?.execution_mode || task?.exec_mode || 'backend').toLowerCase();
    if (mode === 'frontend' || mode === 'browser' || mode === 'client') return 'frontend';
    if (mode === 'backend' || mode === 'server' || mode === 'remote') return 'backend';
    return 'backend';
}

async function runGovTask() {
    if (!currentGovTask) return;

    const runMode = getGovTaskRunMode(currentGovTask);
    if (runMode === 'frontend') {
        await executeGovTaskInBrowser(currentGovTask.js_code, null, '');
        return;
    }

    await executeGovTaskOnBackend([], '');
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
        showToast('切换状态失败: ' + error.message, 'error');
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
        console.error('刷新治理任务状态失败', error);
    }
}

// 处理AI流式响应
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
        nameEl.textContent = `已选择 ${govSelectedFiles.length} 个文件，共 ${formatFileSize(total)}，${showNames}`;
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
    const runMode = getGovTaskRunMode(currentGovTask);

    if ((inputType === 'file' || inputType === 'both') && files.length === 0 && !inputText) {
        showToast('请输入文件或文本后再运行', 'warning');
        return;
    }
    if (inputType === 'text' && !inputText) {
        showToast('请输入文本内容后再运行', 'warning');
        return;
    }

    if (runMode === 'frontend') {
        const batchMode = currentGovTask.file_batch_mode || 'per_file';
        if (currentGovTask.type === 'interactive' && batchMode === 'single') {
            if (files.length < 2) {
                showToast('当前前端模式要求至少 2 个文件，才能一次合并处理', 'warning');
                return;
            }
            await executeGovTaskAggregateInBrowser(files, inputText);
            return;
        }
        await executeGovTaskInBrowser(currentGovTask.js_code, files[0] || null, inputText);
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
    container.innerHTML = '<div class="gov-log-entry"><div class="gov-log-header"><span>处理中...</span><span class="gov-log-status running">运行中</span></div></div>';

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
                <span class="gov-log-status ${status}">${status === 'success' ? '成功' : '失败'}</span>
            </div>
            ${inputDesc ? `<div class="gov-log-input">输入: ${escapeHtml(inputDesc)}</div>` : ''}
            ${output ? `<div class="gov-log-output">${renderGovOutput(output)}</div>` : ''}
            ${errorMsg ? `<div class="gov-log-error">${escapeHtml(errorMsg)}</div>` : ''}
        </div>
    `;
}

// 在后端执行治理任务。
async function executeGovTaskOnBackend(files, inputText) {
    if (!currentGovTask) return;

    const taskId = currentGovTask.id;

    // 更新 UI 显示运行中
    currentGovTask.status = 'running';
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    const container = document.getElementById('govTaskOutput');
    container.innerHTML = '<div class="gov-log-entry"><div class="gov-log-header"><span>后端运行中...</span></div></div>';

    try {
        // 构造 multipart 表单。
        const formData = new FormData();
        formData.append('input_text', inputText || '');

        if (files && files.length > 0) {
            for (const file of files) {
                formData.append('files', file);
            }
        }

        // 提交执行请求。
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/tasks/${taskId}/run`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || '后端执行失败');
        }

        const runId = result.run_id;
        container.innerHTML = `<div class="gov-log-entry"><div class="gov-log-header"><span>已提交后端执行，等待进度...</span><span class="gov-log-status running">运行中</span></div></div>`;

        // 在后端执行治理任务
        await pollTaskProgress(taskId, runId);

    } catch (error) {
        currentGovTask.status = 'error';
        currentGovTask.last_error = error.message;
        container.innerHTML = `<div class="gov-log-entry"><div class="gov-log-header"><span style="color:red">错误: ${escapeHtml(error.message)}</span></div></div>`;
        renderGovTaskList();
    }
}

/**
 * 轮询任务进度
 * 每 2 秒查询一次任务进度，直到完成或出错
 * @param {string} taskId - 任务 ID
 * @param {string} runId - 运行 ID
 * @returns {Promise<void>}
 */
async function pollTaskProgress(taskId, runId) {
    const container = document.getElementById('govTaskOutput');

    const pollInterval = 2000; // 2秒间隔
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

            // 如果有文件进度，渲染进度条；否则显示 last_output（由 gov.log 输出）
            if (total_files > 0) {
                container.innerHTML = `
                    <div class="gov-log-entry">
                        <div class="gov-log-header">
                            <span>进度: ${processed_files}/${total_files} (${percent}%)</span>
                            <span class="gov-log-status ${status}">${status === 'running' ? '运行中' : status === 'success' ? '成功' : '失败'}</span>
                        </div>
                        ${current_file ? `<div class="gov-log-input">当前文件: ${escapeHtml(current_file)}</div>` : ''}
                        ${last_output ? `<div class="gov-log-output">${renderGovOutput(last_output)}</div>` : ''}
                    </div>`;
            } else {
                container.innerHTML = `
                    <div class="gov-log-entry">
                        <div class="gov-log-header">
                            <span>运行中${status === 'running' ? '...' : ''}</span>
                            <span class="gov-log-status ${status}">${status === 'running' ? '运行中' : status === 'success' ? '成功' : '失败'}</span>
                        </div>
                        ${last_output ? `<div class="gov-log-output">${renderGovOutput(last_output)}</div>` : ''}
                        ${last_error ? `<div class="gov-log-error">${escapeHtml(last_error)}</div>` : ''}
                    </div>`;
            }

            // 任务已结束，刷新详情
            if (status !== 'running') {
                // 重新加载任务详情和日志 /logs?
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
            console.error('获取进度失败:', error);
            // 网络错误继续轮询
            setTimeout(poll, pollInterval);
        }
    };

    await poll();
}

// ==================== 治理任务执行支持 ====================

let govLibsLoaded = false;

/**
 * 动态加载治理任务所需的外部库（XLSX, PapaParse, mammoth, PizZip, docxtemplater）。
 * 仅在首次使用时加载，后续调用直接返回。
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
                s.onerror = () => reject(new Error(`加载失败: ${lib.src}`));
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
        throw new Error('Docxtemplater 未就绪');
    }
    govLibsLoaded = true;
}

function _govGetDocxtemplaterClass() {
    if (typeof window.Docxtemplater !== 'undefined') return window.Docxtemplater;
    const d = window.docxtemplater;
    if (d && (d.default || d.Docxtemplater)) return d.default || d.Docxtemplater;
    return null;
}

function _govShared() {
    return window.GOV_SHARED || globalThis.GOV_SHARED || {};
}

function _govExcelCellForValue(val) {
    const shared = _govShared();
    if (typeof shared.govExcelCellForValue === 'function') return shared.govExcelCellForValue(val);
    return val === null || val === undefined ? null : { t: 's', v: String(val) };
}

function _govExpandSheetRef(XLSX, ws) {
    const shared = _govShared();
    if (typeof shared.govExpandSheetRef === 'function') return shared.govExpandSheetRef(XLSX, ws);
}

function _govApplyCellMapToSheet(XLSX, ws, cellMap) {
    const shared = _govShared();
    if (typeof shared.govApplyCellMapToSheet === 'function') return shared.govApplyCellMapToSheet(XLSX, ws, cellMap);
}

function _govDataIsFlatCellMap(XLSX, data) {
    const shared = _govShared();
    if (typeof shared.govDataIsFlatCellMap === 'function') return shared.govDataIsFlatCellMap(XLSX, data);
    return false;
}

function createGovHelper(logLines, uploadedFiles) {
    const uploaded = Array.isArray(uploadedFiles) ? uploadedFiles : [];
    const dbId = currentGovTask?.database_id || '';

    async function _resolveGovTemplateFile(templateFile) {
        if (templateFile instanceof File || templateFile instanceof Blob) return templateFile;
        if (typeof templateFile === 'string') {
            const name = templateFile.trim();
            if (!name) throw new Error('模板文件名不能为空');
            const found = uploaded.find(f => f && f.name === name)
                || uploaded.find(f => f && (f.name.endsWith(name) || name.endsWith(f.name)));
            if (found) return found;
            throw new Error(`模板文件 ${name} 在上传列表中未找到，请确保 File 对象可用`);
        }
        throw new Error('templateFile 必须为 File/Blob 类型才能解析');
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
        const shared = _govShared();
        if (typeof shared.govDownloadBlob === 'function') return shared.govDownloadBlob(blob, filename);
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
        if (typeof window.govCsvEscapeCell === 'function') return window.govCsvEscapeCell(val);
        if (typeof globalThis.govCsvEscapeCell === 'function') return globalThis.govCsvEscapeCell(val);
        const s = val === null || val === undefined ? '' : String(val);
        if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    const showTable = (data) => {
        if (!Array.isArray(data)) {
            logLines.push('__TABLE__:[]');
            return;
        }
        try {
            const jsonStr = JSON.stringify(data);
            logLines.push(`__TABLE__:${jsonStr}`);
        } catch (e) {
            logLines.push(`__TABLE__:[] // Error serializing data: ${e.message}`);
        }
    };

    return {
        log(msg) {
            logLines.push(String(msg));
        },
        showTable,
        table: showTable,
        getDbType() {
            return dbType;
        },
        getDatabases() {
            return (databases || []).map(d => ({ id: d.id, name: d.name, type: d.type }));
        },
        async readExcel(file) {
            if (!file) throw new Error('缺少文件');
            const arrayBuffer = await file.arrayBuffer();
            const data = new Uint8Array(arrayBuffer);
            const wb = XLSX.read(data, { type: 'array' });
            if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
                throw new Error('Excel读取失败: 未找到工作表');
            }
            return wb;
        },
        async readCSV(text) {
            if (!text) throw new Error('缺少文本内容');
            return Papa.parse(text, { header: false }).data;
        },
        async readWord(file) {
            if (!file) throw new Error('缺少文件');
            const arrayBuffer = await file.arrayBuffer();
            return mammoth.extractRawText({ arrayBuffer });
        },
        async querySQL(sql, params) {
            if (!dbId) throw new Error('请先选择治理任务关联的数据库');
            const result = await _runSQL(dbId, sql, params || []);
            return result.data || [];
        },
        async executeSQL(sql, params) {
            if (!dbId) throw new Error('请先选择治理任务关联的数据库');
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
        // 调用 AI 接口；会自动携带 AI 配置的 URL/API Key/超时等参数
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
            if (!data || typeof data !== 'object') throw new Error('data 必须为对象');
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
                    if (!ws) throw new Error(`工作表不存在: ${sheetName}`);
                    _govApplyCellMapToSheet(XLSX, ws, cells);
                }
            }
            const base = outputFilename || 'output.xlsx';
            const outName = /\.xlsx?$/i.test(base) ? base : `${base}.xlsx`;
            XLSX.writeFile(wb, outName);
        },
        writeExcel(filename, data, options) {
            if (!filename) throw new Error('缺少文件名');
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
            if (!filename) throw new Error('缺少文件名');
            if (!Array.isArray(data)) throw new Error('data 必须为数组');
            const lines = data.map(row => {
                if (!Array.isArray(row)) throw new Error('CSV 数据必须为二维数组');
                return row.map(_govCsvEscapeCell).join(',');
            });
            const csv = lines.join('\r\n');
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
            const outName = /\.csv$/i.test(filename) ? filename : `${filename}.csv`;
            _govDownloadBlob(blob, outName);
        },
        writeText(filename, content) {
            if (!filename) throw new Error('缺少文件名');
            const text = content === undefined || content === null ? '' : String(content);
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            _govDownloadBlob(blob, filename);
        },
        writeJSON(filename, data) {
            if (!filename) throw new Error('缺少文件名');
            const text = JSON.stringify(data, null, 2);
            const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
            const outName = /\.json$/i.test(filename) ? filename : `${filename}.json`;
            _govDownloadBlob(blob, outName);
        },
        /**
         * 解析 Word 文档结构，识别公文格式的标题层级、段落、表格等。
         * @param {File|Blob} file - Word 文件对象
         * @param {Object} options - 可选配置 { maxTextLength?: number }
         * @returns {Promise<{title: string, sections: Array, tables: Array, rawText: string}>}
         */
        async parseWordStructure(file, options = {}) {
            if (!file) throw new Error('缺少文件');
            const arrayBuffer = await file.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer });
            const rawText = result.value || '';
            const maxLen = options.maxTextLength || 50000;
            const text = rawText.length > maxLen ? rawText.slice(0, maxLen) : rawText;

            // 公文标题正则：一、二、三、... 或 （一）（二）... 或 1. 2. ... 或 （1）（2）...
            const titlePatterns = [
                /^[一二三四五六七八九十]+、[^\n]+/,           // 一、标题
                /^（[一二三四五六七八九十]+）[^\n]+/,         // （一）标题
                /^\d+[\.、．][^\n]+/,                        // 1. 标题
                /^（\d+）[^\n]+/,                            // （1）标题
                /^[（\(][一二三四五六七八九十\d]+[）\)][^\n]+/ // 混合括号
            ];

            const lines = text.split(/\r?\n/);
            const sections = [];
            const tables = [];
            let currentSection = null;
            let title = '';

            // 尝试识别文档标题（第一个非空行，通常是大标题）
            for (let i = 0; i < Math.min(10, lines.length); i++) {
                const line = lines[i].trim();
                if (line && line.length > 2 && line.length < 100) {
                    // 检查是否是章节标题
                    let isChapterTitle = false;
                    for (const pattern of titlePatterns) {
                        if (pattern.test(line)) {
                            isChapterTitle = true;
                            break;
                        }
                    }
                    if (!isChapterTitle) {
                        title = line;
                        break;
                    }
                }
            }

            // 解析章节和段落
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                let matchedLevel = 0;
                let matchedTitle = '';

                // 检测一级标题：一、二、三、
                const m1 = line.match(/^([一二三四五六七八九十]+)、(.*)$/);
                if (m1) {
                    matchedLevel = 1;
                    matchedTitle = line;
                }

                // 检测二级标题：（一）（二）
                const m2 = line.match(/^（([一二三四五六七八九十]+)）(.*)$/);
                if (m2) {
                    matchedLevel = 2;
                    matchedTitle = line;
                }

                // 检测三级标题：1. 2. 或 1、2、
                const m3 = line.match(/^(\d+)[\.、．](.*)$/);
                if (m3) {
                    matchedLevel = 3;
                    matchedTitle = line;
                }

                // 检测四级标题：（1）（2）
                const m4 = line.match(/^（(\d+)）(.*)$/);
                if (m4) {
                    matchedLevel = 4;
                    matchedTitle = line;
                }

                if (matchedLevel > 0) {
                    // 保存上一个 section
                    if (currentSection) {
                        sections.push(currentSection);
                    }
                    currentSection = {
                        level: matchedLevel,
                        title: matchedTitle,
                        paragraphs: []
                    };
                } else if (currentSection) {
                    // 添加到当前 section 的段落
                    if (line.length > 0) {
                        currentSection.paragraphs.push(line);
                    }
                } else {
                    // 还没有遇到标题，可能是前言
                    if (!sections.find(s => s.level === 0)) {
                        sections.push({
                            level: 0,
                            title: '前言',
                            paragraphs: [line]
                        });
                        currentSection = sections[sections.length - 1];
                    } else if (sections.length > 0) {
                        sections[sections.length - 1].paragraphs.push(line);
                    }
                }

                // 简单的表格检测：连续包含多个制表符或 | 分隔的行
                if (line.includes('\t') || line.includes('|')) {
                    const cells = line.split(/[\t|]+/).filter(c => c.trim());
                    if (cells.length >= 2) {
                        // 尝试识别表格
                        const lastTable = tables.length > 0 ? tables[tables.length - 1] : null;
                        if (lastTable && lastTable._building) {
                            lastTable.rows.push(cells);
                        } else {
                            tables.push({
                                headers: cells,
                                rows: [],
                                _building: true
                            });
                        }
                    }
                } else {
                    // 结束表格构建
                    if (tables.length > 0) {
                        const lastTable = tables[tables.length - 1];
                        if (lastTable._building) {
                            delete lastTable._building;
                        }
                    }
                }
            }

            // 保存最后一个 section
            if (currentSection) {
                sections.push(currentSection);
            }

            // 清理表格对象中的临时属性
            for (const t of tables) {
                delete t._building;
            }

            return {
                title,
                sections,
                tables,
                rawText: text
            };
        },
    };
}

// ==================== 导入代码生成 ====================
let codegenColumns = [];

function toggleCodeGen() {
    const panel = document.getElementById('govCodeGenPanel');
    const arrow = document.getElementById('codegenArrow');
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : 'block';
    arrow.classList.toggle('open', !visible);
    if (!visible) refreshCodegenTables();
}

// 展开或收起治理任务代码区。
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
        sel.innerHTML = '<option value="">请选择数据库</option>';
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
        sel.innerHTML = '<option value="">-- 请选择表 --</option>' + tables.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    } catch (e) {
        sel.innerHTML = `<option value="">加载表失败: ${escapeHtml(e.message)}</option>`;
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

    if (!tableName) { showToast('请先选择表', 'warning'); return; }

    const checks = document.querySelectorAll('.codegen-col-check');
    const srcs = document.querySelectorAll('.codegen-col-src');
    const mappings = [];
    checks.forEach((chk, i) => {
        if (chk.checked) {
            const srcIdx = parseInt(srcs[i].value);
            mappings.push({ col: codegenColumns[i].name, srcIdx });
        }
    });

    if (mappings.length === 0) { showToast('请至少选择一列', 'warning'); return; }

    const q = (db && (db.type === 'mysql' || db.type === 'mariadb')) ? '`' : '"';
    const colList = mappings.map(m => `${q}${m.col}${q}`).join(', ');
    const placeholders = mappings.map(() => '?').join(', ');
    const valExpr = mappings.map(m => `row[${m.srcIdx}]`).join(', ');
    const colComments = mappings.map(m => `//   列 ${m.srcIdx} -> ${m.col}`).join('\n');

    let parseCode = '';
    if (sourceType === 'excel') {
        parseCode = `const workbook = await gov.readExcel(INPUT_FILE);
const sheetName = workbook.SheetNames[0];
const allData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
const headers = allData[0];
const rows = allData.slice(1);
gov.log(\`读取工作表: \${sheetName}, \${rows.length} 行 ? \${headers.length} 列\`);`;
    } else if (sourceType === 'csv_file') {
        parseCode = `const text = await INPUT_FILE.text();
const parsed = Papa.parse(text, { header: false });
const allData = parsed.data.filter(r => r.some(c => c));
const headers = allData[0];
const rows = allData.slice(1);
gov.log(\`解析CSV数据: \${rows.length} 行 ? \${headers.length} 列\`);`;
    } else {
        parseCode = `const parsed = Papa.parse(INPUT_TEXT, { header: false });
const allData = parsed.data.filter(r => r.some(c => c));
const headers = allData[0];
const rows = allData.slice(1);
gov.log(\`解析CSV数据: \${rows.length} 行 ? \${headers.length} 列\`);`;
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
        if (failed <= 5) gov.log(\`第 \${inserted + failed} 行失败: \${e.message}\`);
    }
}

gov.log(\`\\n导入完成: ${tableName} 表 插入 \${inserted} 行, 失败 \${failed} 行\`);`;

    document.getElementById('govCodeInput').value = code;
}

// 使用 AI 生成导入代码。
async function generateImportCodeWithAI() {
    const dbId = document.getElementById('govTaskDbSelect').value;
    const tableName = document.getElementById('codegenTable').value;
    const sourceType = document.getElementById('codegenSourceType').value;
    const db = databases.find(d => d.id === dbId);

    if (!dbId || !tableName) {
        showToast('请先选择数据库和表', 'warning');
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
        showToast('请至少选择一列', 'warning');
        return;
    }

    if (!aiConfig) await loadAiConfig();
    if (!aiConfig || !aiConfig.url || !aiConfig.api_key || !aiConfig.model) {
        showToast('请先配置 AI 服务的 URL、API Key 和模型', 'warning');
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
        showToast('生成失败：' + e.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'AI 生成代码';
        }
    }
}

/** 在浏览器中执行治理任务代码一次。 */
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
            console.error('保存治理日志失败', e);
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
                    <span>批量处理 ${i + 1}/${files.length}?${escapeHtml(file.name)}</span>
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
        `批量完成 共 ${results.length} 个文件 成功 ${ok}个 失败 ${fail}个`,
        ...results.map(r =>
            (r.status === 'success' ? '?' : '?') + ' ' + r.fileName + (r.errorMsg ? ' ? ' + r.errorMsg : '')
        )
    ];
    const summaryText = summaryLines.join('\n');
    const combinedOutput = results.map(r => `--- ${r.fileName} ---\n${r.output || ''}`).join('\n\n');

    currentGovTask.status = overallStatus;
    currentGovTask.last_output = summaryText + (combinedOutput ? '\n\n' + combinedOutput : '');
    currentGovTask.last_error = fail > 0 ? `${fail} 个文件执行失败` : '';
    currentGovTask.last_run_at = new Date().toISOString();
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    container.innerHTML = `
        <div class="gov-log-entry">
            <div class="gov-log-header">
                <span>${new Date().toLocaleString()} 耗时 ${durationSec}s</span>
                <span class="gov-log-status ${overallStatus}">批量结果 成功 ${ok} / 失败 ${fail}</span>
            </div>
            <div class="gov-log-input">共 ${results.length} 个文件 成功${ok}个 失败${fail}个</div>
            <div class="gov-log-output">${escapeHtml(summaryText)}</div>
            ${results.map(r => `
                <div class="gov-log-entry" style="margin-top:10px;border-top:1px solid rgba(0,0,0,0.08);padding-top:8px;">
                    <div class="gov-log-header">
                        <span>${escapeHtml(r.fileName)}</span>
                        <span class="gov-log-status ${r.status}">${r.status === 'success' ? '成功' : '失败'}</span>
                    </div>
                    ${r.inputDesc ? `<div class="gov-log-input">输入: ${escapeHtml(r.inputDesc)}</div>` : ''}
                    ${r.output ? `<div class="gov-log-output">${renderGovOutput(r.output)}</div>` : ''}
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
                <span class="gov-log-status ${status}">${status === 'success' ? '成功' : '失败'}</span>
            </div>
            ${inputDesc ? `<div class="gov-log-input">输入: ${escapeHtml(inputDesc)}</div>` : ''}
            ${output ? `<div class="gov-log-output">${renderGovOutput(output)}</div>` : ''}
            ${errorMsg ? `<div class="gov-log-error">${escapeHtml(errorMsg)}</div>` : ''}
        </div>
    `;
}

// ==================== gov API 接口 ====================

// Get GOV_SHARED from window/globalThis (defined in gov-shared.js)
// Use var so repeated script evaluation does not crash on redeclaration.
var GOV_SHARED_REF = window.__GOV_SHARED_REF__ || (window.__GOV_SHARED_REF__ = (window.GOV_SHARED || globalThis.GOV_SHARED || {}));
var GOV_API_SECTIONS_LOCAL = GOV_SHARED_REF.GOV_API_SECTIONS || [];
var GOV_API_DOCS_LOCAL = GOV_SHARED_REF.GOV_API_DOCS || GOV_API_SECTIONS_LOCAL;
var governanceFunctionsLocal = GOV_SHARED_REF.governanceFunctions || GOV_API_DOCS_LOCAL;

async function openGovApiHelp() {
    const modal = document.getElementById('govApiHelpModal');
    modal.style.display = 'flex';
    document.getElementById('govApiSearchInput').value = '';
    // 确保 gov-shared.js 已加载
    await ensureGovernanceScriptsLoaded();
    // 重新获取 governanceFunctions（加载后才有值）
    // 直接从 window 获取，gov-shared.js 会设置这些全局变量
    const funcs = window.governanceFunctions || window.GOV_API_DOCS || 
                  (window.GOV_SHARED && window.GOV_SHARED.governanceFunctions) || [];
    console.log('[openGovApiHelp] loaded funcs:', funcs.length, funcs);
    window.__govApiFunctions = funcs;
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
    // 优先使用加载后的数据，否则 fallback 到顶层变量
    const funcs = window.__govApiFunctions || governanceFunctionsLocal || [];
    let html = '';
    for (const cat of funcs) {
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
    if (!html) html = '<div style="color:#888;padding:24px;text-align:center;">暂无可用 API 文档</div>';
    body.innerHTML = html;
}

// ============================================================
// 本体分析模块
// ============================================================

// ---- 状态 ----
let ontoData = null;
let ontoSimulation = null;
let ontoInsightExpanded = true;
let ontoSelectedDbId = null;
let ontoGraphViewMode = '2d';
let ontoThreeState = null;

// ---- 颜色映射 ----
const ONTO_COLORS = {
    entity:    { fill: '#4ECDC4', dark: '#2aa59e', emoji: 'E' },
    event:     { fill: '#FF6B6B', dark: '#cc4444', emoji: 'V' },
    concept:   { fill: '#A29BFE', dark: '#7c73e6', emoji: 'C' },
    rule:      { fill: '#55EFC4', dark: '#2ecc97', emoji: 'R' },
    conflict:  { fill: '#E17055', dark: '#b5503a', emoji: 'X' },
    attribute: { fill: '#FDCB6E', dark: '#d4a224', emoji: 'A' },
};

const ONTO_CATEGORY_LABELS = {
    entity: '实体', event: '事件', concept: '概念',
    rule: '规则', conflict: '冲突', attribute: '属性',
};

// ---- 演示本体数据 ----
const DEMO_ONTOLOGY = {
    concepts: [
        { id: 'customer', label: '客户', category: 'entity', importance: 0.95,
          description: '客户是电商场景中的核心实体，通常对应 users 与 customers 两张表，需要统一主数据口径。',
          tables: ['users', 'customers'],
          attributes: ['id','name','email','phone','address','created_at'],
          governance_issues: ['users和customers表关联缺失', '客户主数据需要统一'] },
        { id: 'order', label: '订单', category: 'entity', importance: 0.90,
          description: '订单记录用户的购买行为，是交易链路中最重要的业务对象之一。',
          tables: ['orders','order_items'], attributes: ['order_id','total_amount','status','created_at'], governance_issues: [] },
        { id: 'product', label: '商品', category: 'entity', importance: 0.85,
          description: '商品信息通常来源于商品中心，需要统一 SKU、价格与状态字段。',
          tables: ['products','product_variants'], attributes: ['product_id','name','price','sku','status'],
          governance_issues: ['价格精度问题decimal vs float?', '商品状态值不一致'] },
        { id: 'inventory', label: '库存', category: 'entity', importance: 0.75,
          description: '库存实体描述商品在仓库中的可用数量和流转状态。',
          tables: ['inventory','warehouse_stock'], attributes: ['sku','quantity','warehouse_id','updated_at'], governance_issues: [] },
        { id: 'payment', label: '支付', category: 'entity', importance: 0.80,
          description: '支付记录交易支付过程，常与订单、渠道和流水号关联。',
          tables: ['payments','payment_logs'], attributes: ['payment_id','amount','channel','status','transaction_id'],
          governance_issues: ['支付渠道缺少枚举校验', '支付状态流转不完整'] },
        { id: 'logistics', label: '物流', category: 'entity', importance: 0.70,
          description: '物流实体跟踪包裹运输、签收与异常状态。',
          tables: ['shipments','tracking_events'], attributes: ['tracking_no','carrier','status','estimated_delivery'], governance_issues: [] },
        { id: 'cart', label: '购物车', category: 'event', importance: 0.60,
          description: '购物车代表用户一次临时性的选购行为。',
          tables: ['shopping_carts','cart_items'], attributes: ['cart_id','customer_id','items','total'], governance_issues: [] },
        { id: 'review', label: '评价', category: 'event', importance: 0.50,
          description: '评价实体记录用户对商品的反馈与打分。',
          tables: ['reviews','review_images'], attributes: ['review_id','rating','content','created_at'], governance_issues: [] },
        { id: 'coupon', label: '优惠券', category: 'concept', importance: 0.55,
          description: '优惠券用于描述营销优惠规则与可用范围。',
          tables: ['coupons','coupon_usage'], attributes: ['code','discount_type','value','conditions'], governance_issues: [] },
        { id: 'category', label: '分类', category: 'concept', importance: 0.60,
          description: '分类用于组织商品结构和层级关系。',
          tables: ['categories'], attributes: ['category_id','name','parent_id','path'], governance_issues: [] },
        { id: 'loyalty', label: '会员规则', category: 'rule', importance: 0.50,
          description: '会员规则定义等级、门槛和权益配置。',
          tables: ['membership_rules','customer_loyalty'], attributes: ['level','threshold','benefits','discount_rate'], governance_issues: [] },
        { id: 'risk_naming', label: '命名冲突', category: 'conflict', importance: 0.90,
          description: 'users 与 customers 存在语义重叠，需要统一命名与主数据口径。',
          tables: ['users','customers'], attributes: [], governance_issues: ['字段命名不一致', '表结构需要规范'] },
    ],
    relations: [
        { source: 'customer', target: 'order', label: '下单', type: 'has-many', description: '客户可以创建多个订单，记录购买行为和时间线' },
        { source: 'order', target: 'product', label: '包含', type: 'many-to-many', description: '订单包含多个商品，商品可出现在多个订单中' },
        { source: 'order', target: 'payment', label: '支付', type: 'has-one', description: '一个订单对应一条支付记录，记录支付渠道和状态' },
        { source: 'order', target: 'logistics', label: '物流', type: 'has-one', description: '订单关联物流信息，追踪包裹运输和签收' },
        { source: 'customer', target: 'cart', label: '拥有', type: 'has-many', description: '客户可创建多个购物车记录，保留临时选购' },
        { source: 'cart', target: 'product', label: '包含', type: 'many-to-many', description: '购物车包含多个商品，多对多关联' },
        { source: 'product', target: 'inventory', label: '库存', type: 'has-one', description: '每个SKU对应一条库存记录，记录可用数量' },
        { source: 'product', target: 'category', label: '归类', type: 'many-to-one', description: '商品归入某个分类，支持层级结构' },
        { source: 'customer', target: 'review', label: '评价', type: 'has-many', description: '客户可以对多个商品发表评价和反馈' },
        { source: 'review', target: 'product', label: '针对', type: 'many-to-one', description: '评价针对某个具体商品' },
        { source: 'customer', target: 'coupon', label: '领取', type: 'has-many', description: '客户可领取多张优惠券，优惠券有使用条件' },
        { source: 'order', target: 'coupon', label: '使用', type: 'many-to-one', description: '订单可使用一张优惠券，记录优惠金额和使用条件' },
        { source: 'customer', target: 'loyalty', label: '会员', type: 'has-one', description: '客户关联会员等级和权益，记录积分和等级' },
        { source: 'risk_naming', target: 'customer', label: '冲突', type: 'conflict', description: 'users与customers存在命名冲突，需统一客户口径' },
    ],
    insights: [
        { type: 'conflict', title: '命名冲突风险', severity: 'high', affectedConcepts: ['customer','risk_naming'],
          description: 'users 与 customers 存在语义重叠，需要统一为 customer 主数据口径' },
        { type: 'quality', title: '数据精度不一致', severity: 'high', affectedConcepts: ['product','order'],
          description: 'products.price 是 float，order_items.unit_price 是 decimal，需要统一精度以避免计算误差' },
        { type: 'governance', title: '隐私合规缺失', severity: 'medium', affectedConcepts: ['customer'],
          description: '客户敏感字段缺少脱敏策略，联系方式、地址等是否满足GDPR/个人信息保护法要求' },
        { type: 'missing', title: '物流商品关联缺失', severity: 'medium', affectedConcepts: ['logistics','product'],
          description: '物流与商品之间缺少溯源关联，无法追溯退换货和破损责任方' },
        { type: 'governance', title: '支付数据留痕', severity: 'medium', affectedConcepts: ['payment'],
          description: '支付流水缺少操作审计日志，需按要求保留至少五年记录' },
        { type: 'quality', title: '典型电商12实体模型', severity: 'info', affectedConcepts: [],
          description: 'AI已识别出典型电商场景12个核心实体，实际可能扩展到14个以上，建议持续补充完善' },
    ],
};

// ---- 本体可视化 ----
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

/** 单步 3D 力导向模拟 + 阻尼 + 中心引力 + 速度 */
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
 * Three.js 3D 本体图渲染，依赖 ontoData 和 ONTO_COLORS。
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

    // 为 D3 视图保留节点引用，便于射线拾取。
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

// 渲染本体图。
function renderOntologyGraph(data, animate) {
    if (!data) return;
    ontoData = data;

    const svgEl = document.getElementById('ontoSvg');
    if (!svgEl) return;

    // 隐藏欢迎页。
    document.getElementById('ontoWelcome').style.display = 'none';

    const viewToggle = document.getElementById('ontoViewToggle');
    const viewSep = document.getElementById('ontoViewToggleSep');
    if (viewToggle) viewToggle.style.display = 'inline-flex';
    if (viewSep) viewSep.style.display = '';

    if (ontoGraphViewMode === '3d') {
        if (typeof THREE === 'undefined') {
            showOntoToast('当前环境缺少 Three.js，已切换到 2D 视图', true);
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

    // 初始化 SVG 容器。
    const svg = d3.select('#ontoSvg').attr('width', W).attr('height', H);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');

    // 发光滤镜。
    const fGlow = defs.append('filter').attr('id', 'onto-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    fGlow.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '4').attr('result', 'blur');
    const fMerge = fGlow.append('feMerge');
    fMerge.append('feMergeNode').attr('in', 'blur');
    fMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // 强对比发光滤镜。
    const fGlow2 = defs.append('filter').attr('id', 'onto-glow-strong').attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%');
    fGlow2.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '8').attr('result', 'blur');
    const fMerge2 = fGlow2.append('feMerge');
    fMerge2.append('feMergeNode').attr('in', 'blur');
    fMerge2.append('feMergeNode').attr('in', 'SourceGraphic');

    // 箭头标记。
    ['default','conflict'].forEach(t => {
        const m = defs.append('marker').attr('id', `onto-arrow-${t}`)
            .attr('viewBox','0 -5 10 10').attr('refX', 22).attr('refY', 0)
            .attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto');
        m.append('path').attr('d','M0,-5L10,0L0,5')
            .attr('fill', t === 'conflict' ? '#E17055' : 'rgba(160,160,220,0.6)');
    });

    // 为每个分类生成渐变色。
    Object.entries(ONTO_COLORS).forEach(([cat, cfg]) => {
        const g = defs.append('radialGradient').attr('id', `onto-grad-${cat}`).attr('cx','35%').attr('cy','35%');
        g.append('stop').attr('offset','0%').attr('stop-color','#fff').attr('stop-opacity', 0.7);
        g.append('stop').attr('offset','100%').attr('stop-color', cfg.fill).attr('stop-opacity', 1);
    });

    // 主图层支持缩放和平移。
    const mainG = svg.append('g').attr('class','onto-main');
    const zoom = d3.zoom().scaleExtent([0.25, 4]).on('zoom', e => mainG.attr('transform', e.transform));
    svg.call(zoom).on('dblclick.zoom', null);

    // 初始化节点与边。
    const nodes = data.concepts.map(c => ({ ...c, x: W/2 + (Math.random()-0.5)*400, y: H/2 + (Math.random()-0.5)*300 }));
    const nodeById = {};
    nodes.forEach(n => nodeById[n.id] = n);
    const links = (data.relations || []).filter(r => nodeById[r.source] && nodeById[r.target])
        .map(r => ({ ...r, source: nodeById[r.source], target: nodeById[r.target] }));

    // 启动力导布局模拟。
    if (ontoSimulation) ontoSimulation.stop();
    ontoSimulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(d => d.type === 'conflict' ? 100 : 130))
        .force('charge', d3.forceManyBody().strength(d => -250 - (d.importance||0.5)*200))
        .force('center', d3.forceCenter(W/2, H/2))
        .force('collision', d3.forceCollide().radius(d => ontoNodeRadius(d) + 22));

    // 绘制关系边。
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

    // 绘制节点层。
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

    // 节点发光层。
    nodeSel.append('circle').attr('class','onto-node-glow')
        .attr('r', d => ontoNodeRadius(d)+10)
        .attr('fill', d => ONTO_COLORS[d.category]?.fill || '#4ECDC4')
        .attr('opacity', 0.12).attr('filter','url(#onto-glow)');

    // 光晕
    nodeSel.append('circle').attr('class','onto-node-circle')
        .attr('r', d => ontoNodeRadius(d))
        .attr('fill', d => `url(#onto-grad-${d.category})`)
        .attr('stroke', d => ONTO_COLORS[d.category]?.fill || '#4ECDC4')
        .attr('stroke-width', 2).attr('filter','url(#onto-glow)');

    // emoji 图标 
    nodeSel.append('text').attr('text-anchor','middle').attr('dominant-baseline','central')
        .attr('font-size', d => Math.round(ontoNodeRadius(d)*0.75)+'px')
        .attr('pointer-events','none').text(d => ONTO_COLORS[d.category]?.emoji || '🔵');

    // 节点标签。
    nodeSel.append('text').attr('class','onto-node-label').attr('text-anchor','middle')
        .attr('dy', d => ontoNodeRadius(d)+16+'px')
        .attr('fill','#e2e8f0').attr('font-size','12px').attr('font-weight','600')
        .attr('pointer-events','none').text(d => d.label);

    // 初次进入时使用渐显动画。
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

    // 点击空白处关闭详情。
    svg.on('click', () => closeNodeDetail());

    // 恢复查询栏并刷新统计与洞察。
    document.getElementById('ontoQueryBar').classList.remove('onto-query-disabled');
    document.getElementById('ontoClearBtn').style.display = '';
    updateOntoStats(data);
    renderInsights(data.insights || []);
}

// 更新本体统计。
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

// 渲染洞察卡片。
function renderInsights(insights) {
    const body = document.getElementById('ontoInsightBody');
    if (!insights || insights.length === 0) {
        body.innerHTML = '<div class="onto-insight-placeholder"><span>无</span><p>暂无洞察</p></div>';
        return;
    }
    const iconMap = { conflict: '冲突', quality: '质量', governance: '治理', missing: '缺失', performance: '性能', info: '信息' };
    body.innerHTML = insights.map((ins, i) => `
        <div class="onto-insight-card ${ins.severity}" style="animation-delay:${i*0.08}s" onclick="highlightInsight(${i})">
            <div class="onto-insight-title">
                ${iconMap[ins.type]||'信息'} ${ins.title}
                <span class="onto-insight-badge ${ins.severity}">${ins.severity === 'high' ? '高' : ins.severity === 'medium' ? '中' : ins.severity === 'low' ? '低' : '信息'}</span>
            </div>
            <div class="onto-insight-desc">${ins.description}</div>
        </div>`).join('');
}

// 高亮洞察影响的概念。
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

// 显示节点详情。
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

    // 收集相连节点。
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
            <div class="onto-popup-section-label">描述</div>
            <div class="onto-popup-desc">${d.description}</div>
        </div>`;
    }
    if (d.tables && d.tables.length) {
        html += `<div class="onto-popup-section">
            <div class="onto-popup-section-label">关联表</div>
            <div class="onto-popup-tags">${d.tables.map(t=>`<span class="onto-tag">${t}</span>`).join('')}</div>
        </div>`;
    }
    if (d.attributes && d.attributes.length) {
        html += `<div class="onto-popup-section">
            <div class="onto-popup-section-label">属性</div>
            <div class="onto-popup-tags">${d.attributes.map(a=>`<span class="onto-tag">${a}</span>`).join('')}</div>
        </div>`;
    }
    if (connected.length) {
        html += `<div class="onto-popup-section">
            <div class="onto-popup-section-label">关联节点 (${connected.length})</div>
            <div class="onto-popup-tags">${connected.map(c=>`<span class="onto-tag">${c.direction} ${c.label} ${c.name}</span>`).join('')}</div>
        </div>`;
    }
    if (d.governance_issues && d.governance_issues.length) {
        html += `<div class="onto-popup-section">
            <div class="onto-popup-section-label">治理问题</div>
            <div class="onto-popup-tags">${d.governance_issues.map(g=>`<span class="onto-tag issue">${g}</span>`).join('')}</div>
        </div>`;
    }
    body.innerHTML = html || '<div class="onto-popup-desc" style="color:#6e7681">暂无详情</div>';

    popup.style.display = '';

    // 在 2D 视图中同步高亮选中节点。
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

// 加载本体演示数据。
function loadOntologyDemo() {
    showOntologyLoading('正在加载演示数据...');
    let progress = 0;
    const steps = ['解析本体...', '构建关系...', '生成洞察...', '完成渲染...'];
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
            showOntoToast('已生成本体示例：12 个概念、14 条关系、5 条洞察');
        }, 300);
    }, 1800);
}

// 启动本体抽取。
function startOntologyExtract() {
    if (!ontoSelectedDbId) {
        showOntoToast('请先选择要解析的数据库', true);
        return;
    }
    const dbIds = [ontoSelectedDbId];
    showOntologyLoading('AI 正在抽取本体...');

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
        showOntoToast('抽取失败：' + err.message, true);
    });
}

function ontoHandleSSE(type, data) {
    switch (type) {
        case 'onto-start':
        case 'onto-thinking':
            document.getElementById('ontoAiText').textContent = data.message || 'AI 处理中...';
            break;
        case 'answer':
            document.getElementById('ontoAiProgressBar').style.width = '100%';
            setTimeout(() => {
                hideOntologyLoading();
                const payload = {
                    concepts: [],
                    relations: [],
                    insights: []
                };
                renderOntologyGraph(payload, true);
                const resultEl = document.getElementById('ontoQueryResult');
                if (resultEl) {
                    let answer = data.text || '';
                    answer = escapeHtml(answer).replace(/\?([^?]+)\?/g, '<span class="onto-highlight-badge">$1</span>');
                    resultEl.innerHTML = answer;
                }
                showOntoToast('本体抽取完成');
            }, 400);
            break;
        case 'onto-result':
            document.getElementById('ontoAiProgressBar').style.width = '100%';
            setTimeout(() => {
                hideOntologyLoading();
                renderOntologyGraph(data, true);
                showOntoToast(`已生成本体：${(data.concepts||[]).length} 个概念，${(data.relations||[]).length} 条关系`);
            }, 400);
            break;
        case 'onto-error':
            hideOntologyLoading();
            showOntoToast('错误：' + (data.message || '未知错误'), true);
            break;
        case 'onto-done':
            hideOntologyLoading();
            break;
    }
}

// 清空本体视图。
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
    document.getElementById('ontoInsightBody').innerHTML = '<div class="onto-insight-placeholder"><span>无</span><p>请先通过 AI 抽取或加载本体数据</p></div>';
    ['ontoStatConcepts','ontoStatRelations','ontoStatRisks'].forEach(id => { document.getElementById(id).textContent='0'; });
}

// 执行本体问答查询。
async function doOntologyQuery() {
    const input = document.getElementById('ontoQueryInput');
    const query = input.value.trim();
    if (!query) return;
    if (!ontoData) { showOntoToast('请先加载本体数据', true); return; }

    const btn = document.getElementById('ontoQueryBtn');
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> 查询中...';

    const resultEl = document.getElementById('ontoQueryResult');
    resultEl.style.display = '';
    resultEl.innerHTML = '<span style="color:#667eea">AI 正在分析本体...</span>';

    try {
        const res = await fetchWithAuth(`${API_BASE}/api/data-ontology/ontology/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, ontology: ontoData }),
        });
        if (res.status === 401) return;
        const data = await res.json();
        if (data.success) {
            // 根据命中的概念做高亮。
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
            // 渲染返回答案。
            let answer = data.answer || '';
            answer = escapeHtml(answer).replace(/\?([^?]+)\?/g, '<span class="onto-highlight-badge">$1</span>');
            resultEl.innerHTML = answer;
        } else {
            resultEl.innerHTML = `<span style="color:#E17055">错误：${escapeHtml(data.message)}</span>`;
        }
    } catch (e) {
        resultEl.innerHTML = `<span style="color:#E17055">错误：${escapeHtml(e.message)}</span>`;
    }
    btn.disabled = false;
    btn.innerHTML = '<span>⌕</span> 查询本体';
}

// 展开或收起洞察面板。
function toggleInsightPanel() {
    ontoInsightExpanded = !ontoInsightExpanded;
    document.getElementById('ontoInsightPanel').classList.toggle('collapsed', !ontoInsightExpanded);
}

// 显示本体加载遮罩。
function showOntologyLoading(text) {
    const ov = document.getElementById('ontoAiOverlay');
    document.getElementById('ontoAiText').textContent = text || 'AI 处理中...';
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

// 数据库类型图标。
const DB_TYPE_ICONS = {
    mysql: '🛢️', postgresql: '🐘', oracle: '🏛️', mssql: '🪟', mongodb: '🍃',
    dm: '🔶', sqlite: '📄', duckdb: '🦆', clickhouse: '📊', neo4j: '🕸️',
};

function getDbIcon(type) {
    return DB_TYPE_ICONS[(type||'').toLowerCase()] || '🗄️';
}

// 切换本体数据库选择器。
function toggleDbPicker(e) {
    e.stopPropagation();
    const dd = document.getElementById('ontoDbDropdown');
    const btn = document.getElementById('ontoDbBtn');
    const isOpen = dd.classList.contains('open');
    dd.classList.toggle('open', !isOpen);
    btn.classList.toggle('active', !isOpen);
}

// 选择本体数据库。
function selectOntologyDb(dbId, dbName, dbType) {
    ontoSelectedDbId = dbId;
    const textEl = document.getElementById('ontoDbBtnText');
    textEl.textContent = `${getDbIcon(dbType)} ${dbName}`;
    textEl.classList.remove('placeholder');
    // 更新选中状态。
    document.querySelectorAll('.onto-db-option').forEach(el => {
        const isSelected = el.dataset.dbId === dbId;
        el.classList.toggle('selected', isSelected);
        const check = el.querySelector('.onto-db-option-check');
        if (check) check.style.display = isSelected ? '' : 'none';
    });
    // 收起下拉框。
    document.getElementById('ontoDbDropdown').classList.remove('open');
    document.getElementById('ontoDbBtn').classList.remove('active');
}

// 点击页面空白处时收起数据库下拉框。
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

// 初始化本体标签页。
function initOntologyTab() {
    const dropdown = document.getElementById('ontoDbDropdown');
    const emptyEl  = document.getElementById('ontoDbDropdownEmpty');
    if (!dropdown) return;

    // 清空旧的数据库选项。
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
                <span class="onto-db-option-check" style="display:${isSelected ? '' : 'none'}">?</span>`;
            item.onclick = (e) => {
                e.stopPropagation();
                selectOntologyDb(db.id, db.name, db.type);
            };
            dropdown.appendChild(item);
        });
        // 没有选中时显示占位文本。
        if (!ontoSelectedDbId) {
            const textEl = document.getElementById('ontoDbBtnText');
            if (textEl) { textEl.textContent = '请选择数据库'; textEl.classList.add('placeholder'); }
        }
    }

    // 监听窗口缩放，重新渲染本体图。
    if (!window._ontoResizeRegistered) {
        window._ontoResizeRegistered = true;
        window.addEventListener('resize', () => {
            if (ontoData) renderOntologyGraph(ontoData, false);
        });
    }
}

// 血缘分析状态。
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
                <span class="lineage-db-option-check" style="display:${isSelected ? '' : 'none'}">?</span>`;
            item.onclick = (ev) => {
                ev.stopPropagation();
                selectLineageDb(db.id, db.name, db.type);
            };
            dropdown.appendChild(item);
        });
        if (!lineageSelectedDbId) {
            const te = document.getElementById('lineageDbBtnText');
            if (te) { te.textContent = '请选择数据库'; te.classList.add('placeholder'); }
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

// 将 schema.table 拆成可换行标签。
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

// 测量血缘节点尺寸。
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

// 生成血缘连线曲线。
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

// 按焦点表高亮血缘图。
function applyLineageFocusHighlight(nodeSel, linkItems, nodes, edges, statsEl, tables, edgeCount) {
    const dlinks = lineageDirectedLinksFromEdges(edges);
    const base = `${tables.length} 张表 / ${edgeCount} 条关系`;
    if (!statsEl) return;
    if (!lineageFocusTableId) {
        statsEl.textContent = `${base}，未选择焦点表`;
        nodeSel.selectAll('.lineage-node-shape').attr('opacity', 1).attr('stroke-width', 2).attr('stroke', 'url(#lineage-node-stroke-grad)');
        linkItems.selectAll('path').attr('opacity', 1);
        linkItems.selectAll('.lineage-particle').attr('opacity', 1);
        return;
    }
    const focus = lineageFocusTableId;
    const up = lineageExpandedUpstreamIds(focus, dlinks);
    const down = lineageDownstreamBfsIds(focus, dlinks);
    const keep = new Set([focus, ...up, ...down]);
    const upStr = [...up].sort().join(', ') || '无';
    const downStr = [...down].sort().join(', ') || '无';
    statsEl.innerHTML = `${escapeHtml(base)}，焦点表 <code style="color:#67e8f9">${escapeHtml(focus)}</code>，上游：${escapeHtml(upStr)}，下游：${escapeHtml(downStr)}`;

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

// 加载血缘图数据。
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
            showOntoToast(data.message || '加载失败', true);
            return;
        }
        window.lineageLastPayload = data;
        renderLineageGraph(data);
        if (data.message) showOntoToast(data.message);
    } catch (err) {
        showOntoToast('加载失败：' + (err.message || String(err)), true);
    }
}

// 渲染血缘图。
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
            listEl.innerHTML = '<div style="color:#a0aec0;padding:12px">暂无血缘关系</div>';
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

    // 没有节点时显示空状态。
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
// 模型管理
// ============================================================

let llmModels = [];
let smallModels = [];
let editingLLMModelId = null;
let editingSmallModelId = null;

// 初始化模型页签。
function initModelsTab() {
    loadLLMModels();
    loadSmallModels();
    
    // 切换模型子页签。
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

// ========== LLM 模型 ==========

async function loadLLMModels() {
    try {
        const resp = await fetchWithAuth(`${API_BASE}/api/data-ontology/models/llm`);
        const data = await resp.json();
        if (data.success) {
            llmModels = data.models || [];
            renderLLMModels();
        }
    } catch (e) {
        console.error('加载 LLM 模型失败:', e);
    }
}

function renderLLMModels() {
    const container = document.getElementById('llmModelsList');
    if (llmModels.length === 0) {
        container.innerHTML = '<div class="models-empty">暂无模型，点击“新增”开始配置</div>';
        return;
    }
    
    const typeIcons = { llm: 'LLM', rerank: 'R', embedding: 'E', asr: 'ASR', tts: 'TTS' };
    const typeLabels = { llm: 'LLM', rerank: 'Rerank', embedding: 'Embedding', asr: 'ASR', tts: 'TTS' };
    
    container.innerHTML = llmModels.map(m => {
        const safeMId = escapeHtml(m.id);
        return `
        <div class="model-card ${m.enabled ? '' : 'disabled'}">
            <div class="model-card-header">
                <span class="model-icon">${typeIcons[m.type] || 'M'}</span>
                <span class="model-name">${escapeHtml(m.name)}</span>
                <span class="model-type-badge">${typeLabels[m.type] || m.type}</span>
            </div>
            <div class="model-card-body">
                <div class="model-info"><strong>提供方:</strong> ${escapeHtml(m.provider || 'custom')}</div>
                <div class="model-info"><strong>模型:</strong> ${escapeHtml(m.model || '-')}</div>
                <div class="model-info"><strong>地址:</strong> ${escapeHtml(m.url)}</div>
                ${m.description ? `<div class="model-desc">${escapeHtml(m.description)}</div>` : ''}
            </div>
            <div class="model-card-footer">
                <span class="model-status ${m.enabled ? 'enabled' : 'disabled'}">${m.enabled ? '已启用' : '已停用'}</span>
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
    document.getElementById('llmModalTitle').textContent = '新增模型';
    document.getElementById('llmModelForm').reset();
    document.getElementById('llmEnabledInput').checked = true;
    document.getElementById('llmModelModal').classList.add('show');
}

function editLLMModel(id) {
    const model = llmModels.find(m => m.id === id);
    if (!model) return;
    editingLLMModelId = id;
    document.getElementById('llmModalTitle').textContent = '编辑模型';
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
        showToast('保存失败：' + e.message, 'error');
    }
}

async function deleteLLMModel(id) {
    if (!confirm('确定删除这个模型吗？')) return;
    try {
        const resp = await fetchWithAuth(`${API_BASE}/api/data-ontology/models/llm/${id}`, { method: 'DELETE' });
        const result = await resp.json();
        if (result.success) loadLLMModels();
        else showToast(result.message || '删除失败', 'error');
    } catch (e) {
        showToast('删除失败：' + e.message, 'error');
    }
}

// ========== 小模型 ==========

async function loadSmallModels() {
    try {
        const resp = await fetchWithAuth(`${API_BASE}/api/data-ontology/models/small`);
        const data = await resp.json();
        if (data.success) {
            smallModels = data.models || [];
            renderSmallModels();
        }
    } catch (e) {
        console.error('加载小模型失败', e);
    }
}

function renderSmallModels() {
    const container = document.getElementById('smallModelsList');
    if (smallModels.length === 0) {
        container.innerHTML = '<div class="models-empty">暂无模型，点击“新增”开始配置</div>';
        return;
    }
    
    container.innerHTML = smallModels.map(m => {
        const safeMId = escapeHtml(m.id);
        return `
        <div class="model-card ${m.enabled ? '' : 'disabled'}">
            <div class="model-card-header">
                <span class="model-icon">S</span>
                <span class="model-name">${escapeHtml(m.name)}</span>
            </div>
            <div class="model-card-body">
                ${m.description ? `<div class="model-desc">${escapeHtml(m.description)}</div>` : ''}
                <div class="model-info"><strong>输入类型:</strong> ${m.input_type || 'text'}</div>
                <div class="model-info"><strong>输出类型:</strong> ${m.output_type || 'text'}</div>
            </div>
            <div class="model-card-footer">
                <span class="model-status ${m.enabled ? 'enabled' : 'disabled'}">${m.enabled ? '已启用' : '已停用'}</span>
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
    document.getElementById('smallModalTitle').textContent = '新增小模型';
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
    select.innerHTML = '<option value="">请选择数据库</option>';
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
        showToast('保存失败：' + e.message, 'error');
    }
}

async function deleteSmallModel(id) {
    if (!confirm('确定删除这个小模型吗？')) return;
    try {
        const resp = await fetchWithAuth(`${API_BASE}/api/data-ontology/models/small/${id}`, { method: 'DELETE' });
        const result = await resp.json();
        if (result.success) loadSmallModels();
        else showToast(result.message || '删除失败', 'error');
    } catch (e) {
        showToast('删除失败：' + e.message, 'error');
    }
}

async function runSmallModel(id) {
    const model = smallModels.find(m => m.id === id);
    if (!model) return;
    
    const inputText = prompt('请输入运行内容：');
    if (inputText === null) return;
    
    try {
        const resp = await fetchWithAuth(`${API_BASE}/api/data-ontology/models/small/${id}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input_text: inputText })
        });
        const result = await resp.json();
        if (result.success) {
            showToast('运行结果：\n' + (Array.isArray(result.output) ? result.output.join('\n') : JSON.stringify(result.output, null, 2)), 'success', 10000);
        } else {
            showToast('运行失败：' + result.message, 'error');
        }
    } catch (e) {
        showToast('运行失败：' + e.message, 'error');
    }
}

// ==================== 本体关系表功能 ====================

// 显示本体关系表模态框
function showOntologyRelationTable() {
    showDbOntologyRelations();
}

// 隐藏本体关系表模态框
function hideOntologyRelationModal() {
    document.getElementById('ontologyRelationModal').style.display = 'none';
}

// 刷新本体关系列表（兼容旧代码）
async function refreshOntologyRelations() {
    await refreshDbOntologyRelations();
}

// 显示数据库本体关系表
async function showDbOntologyRelations() {
    if (!currentDb) {
        alert('请先选择数据库');
        return;
    }

    // 显示模态框
    document.getElementById('ontologyRelationModal').style.display = 'block';
    await refreshDbOntologyRelations();
}

// 刷新数据库本体关系列表
async function refreshDbOntologyRelations() {
    if (!currentDb) return;

    const loading = document.getElementById('relationTableLoading');
    const tbody = document.getElementById('relationTableBody');

    loading.style.display = 'flex';

    try {
        const res = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/ontology/relations`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}` }
        });
        const data = await res.json();

        if (data.success) {
            const relations = data.relations || [];
            renderDbRelationTable(relations);
        } else {
            alert('获取关系列表失败: ' + (data.message || '未知错误'));
        }
    } catch (err) {
        console.error('获取关系列表失败:', err);
        alert('获取关系列表失败: ' + err.message);
    } finally {
        loading.style.display = 'none';
    }
}

// 渲染数据库关系表
function renderDbRelationTable(relations) {
    const tbody = document.getElementById('relationTableBody');

    if (relations.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-row">暂无数据</td></tr>';
        return;
    }

    tbody.innerHTML = relations.map(rel => `
        <tr>
            <td>${escapeHtml(rel.name)}</td>
            <td>${escapeHtml(rel.source.table_name)}.${escapeHtml(rel.source.field_name)}</td>
            <td>${escapeHtml(rel.target.table_name)}.${escapeHtml(rel.target.field_name)}</td>
            <td>${escapeHtml(rel.match_type)}</td>
            <td>${new Date(rel.created_at).toLocaleString()}</td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="deleteDbOntologyRelation('${rel.id}')">删除</button>
            </td>
        </tr>
    `).join('');
}

// 删除数据库本体关系
async function deleteDbOntologyRelation(relId) {
    if (!currentDb || !confirm('确定要删除这个关系吗？')) {
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/ontology/relations/${relId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}` }
        });
        const data = await res.json();

        if (data.success) {
            refreshDbOntologyRelations();
        } else {
            alert('删除失败: ' + (data.message || '未知错误'));
        }
    } catch (err) {
        console.error('删除关系失败:', err);
        alert('删除失败: ' + err.message);
    }
}

// 扫描数据库本体关系
let dbScanCandidates = [];

async function scanDbOntologyRelations() {
    if (!currentDb) {
        alert('请先选择数据库');
        return;
    }

    try {
        showToast('正在获取表列表...', 'info');

        // 先获取表列表
        const tablesRes = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}` }
        });
        const tablesData = await tablesRes.json();

        if (!tablesData.success) {
            alert('获取表列表失败: ' + (tablesData.message || '未知错误'));
            return;
        }

        if (!tablesData.tables || tablesData.tables.length === 0) {
            alert('数据库中没有表');
            return;
        }

        // 显示表选择对话框
        const selectedTables = await showTableSelectionDialog(tablesData.tables);
        if (!selectedTables || selectedTables.length === 0) {
            showToast('已取消扫描', 'info');
            return;
        }

        if (!confirm(`确定要扫描数据库 "${currentDb.name}" 中 ${selectedTables.length} 个表的本体关系吗？`)) {
            return;
        }

        showToast('正在扫描...', 'info');

        const res = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/ontology/scan`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ tables: selectedTables })
        });
        const data = await res.json();

        if (data.success) {
            dbScanCandidates = data.candidates || [];

            if (dbScanCandidates.length === 0) {
                alert('未发现等价字段关系');
                return;
            }

            // 显示候选列表让用户勾选
            const selectedIndices = await showRelationSelectionDialog(dbScanCandidates);
            
            if (selectedIndices.length > 0) {
                for (const idx of selectedIndices) {
                    await addDbCandidateAsRelation(idx);
                }
                showToast(`已添加 ${selectedIndices.length} 个关系`, 'success');
            }
        } else {
            alert('扫描失败: ' + (data.message || '未知错误'));
        }
    } catch (err) {
        console.error('扫描失败:', err);
        alert('扫描失败: ' + err.message);
    }
}

// 显示表选择对话框
function showTableSelectionDialog(tables) {
    return new Promise((resolve) => {
        // 创建模态对话框
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white;
            padding: 20px;
            border-radius: 8px;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;

        let html = `
            <h3 style="margin: 0 0 15px 0;">选择要扫描的表</h3>
            <div style="margin-bottom: 15px;">
                <button id="selectAllBtn" style="margin-right: 10px; padding: 5px 15px; cursor: pointer;">全选</button>
                <button id="deselectAllBtn" style="padding: 5px 15px; cursor: pointer;">全不选</button>
            </div>
            <div style="margin-bottom: 15px; max-height: 400px; overflow-y: auto; border: 1px solid #ddd; padding: 10px;">
        `;

        tables.forEach((table, idx) => {
            html += `
                <div style="margin-bottom: 8px;">
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" class="table-checkbox" value="${table}" checked style="margin-right: 8px;">
                        <span>${table}</span>
                    </label>
                </div>
            `;
        });

        html += `
            </div>
            <div style="text-align: right;">
                <button id="cancelBtn" style="margin-right: 10px; padding: 8px 20px; cursor: pointer;">取消</button>
                <button id="confirmBtn" style="padding: 8px 20px; cursor: pointer; background: #4CAF50; color: white; border: none; border-radius: 4px;">确定</button>
            </div>
        `;

        dialog.innerHTML = html;
        modal.appendChild(dialog);
        document.body.appendChild(modal);

        // 全选按钮
        dialog.querySelector('#selectAllBtn').addEventListener('click', () => {
            dialog.querySelectorAll('.table-checkbox').forEach(cb => cb.checked = true);
        });

        // 全不选按钮
        dialog.querySelector('#deselectAllBtn').addEventListener('click', () => {
            dialog.querySelectorAll('.table-checkbox').forEach(cb => cb.checked = false);
        });

        // 取消按钮
        dialog.querySelector('#cancelBtn').addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(null);
        });

        // 确定按钮
        dialog.querySelector('#confirmBtn').addEventListener('click', () => {
            const selected = [];
            dialog.querySelectorAll('.table-checkbox:checked').forEach(cb => {
                selected.push(cb.value);
            });
            document.body.removeChild(modal);
            resolve(selected);
        });

        // 点击背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
                resolve(null);
            }
        });
    });
}

// 显示关系选择对话框
function showRelationSelectionDialog(candidates) {
    return new Promise((resolve) => {
        // 创建模态对话框
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white;
            padding: 20px;
            border-radius: 8px;
            max-width: 700px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;

        let html = `
            <h3 style="margin: 0 0 15px 0;">选择要入库的关系</h3>
            <div style="margin-bottom: 15px;">
                <button id="selectAllBtn" style="margin-right: 10px; padding: 5px 15px; cursor: pointer;">全选</button>
                <button id="deselectAllBtn" style="padding: 5px 15px; cursor: pointer;">全不选</button>
            </div>
            <div style="margin-bottom: 15px; max-height: 400px; overflow-y: auto; border: 1px solid #ddd; padding: 10px;">
        `;

        candidates.forEach((cand, idx) => {
            html += `
                <div style="margin-bottom: 12px; padding: 8px; background: #f9f9f9; border-radius: 4px;">
                    <label style="display: flex; align-items: flex-start; cursor: pointer;">
                        <input type="checkbox" class="relation-checkbox" value="${idx}" checked style="margin-right: 10px; margin-top: 3px;">
                        <div>
                            <div style="font-weight: bold; margin-bottom: 4px;">${cand.name}</div>
                            <div style="font-size: 12px; color: #666;">
                                ${cand.source.table_name}.${cand.source.field_name} ↔ ${cand.target.table_name}.${cand.target.field_name}
                            </div>
                            <div style="font-size: 11px; color: #999;">
                                匹配类型: ${cand.match_type} | 得分: ${cand.match_score.toFixed(2)}
                            </div>
                        </div>
                    </label>
                </div>
            `;
        });

        html += `
            </div>
            <div style="text-align: right;">
                <button id="cancelBtn" style="margin-right: 10px; padding: 8px 20px; cursor: pointer;">取消</button>
                <button id="confirmBtn" style="padding: 8px 20px; cursor: pointer; background: #4CAF50; color: white; border: none; border-radius: 4px;">确定入库</button>
            </div>
        `;

        dialog.innerHTML = html;
        modal.appendChild(dialog);
        document.body.appendChild(modal);

        // 全选按钮
        dialog.querySelector('#selectAllBtn').addEventListener('click', () => {
            dialog.querySelectorAll('.relation-checkbox').forEach(cb => cb.checked = true);
        });

        // 全不选按钮
        dialog.querySelector('#deselectAllBtn').addEventListener('click', () => {
            dialog.querySelectorAll('.relation-checkbox').forEach(cb => cb.checked = false);
        });

        // 取消按钮
        dialog.querySelector('#cancelBtn').addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve([]);
        });

        // 确定按钮
        dialog.querySelector('#confirmBtn').addEventListener('click', () => {
            const selected = [];
            dialog.querySelectorAll('.relation-checkbox:checked').forEach(cb => {
                selected.push(parseInt(cb.value));
            });
            document.body.removeChild(modal);
            resolve(selected);
        });

        // 点击背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
                resolve([]);
            }
        });
    });
}

// 将候选添加为关系
async function addDbCandidateAsRelation(idx) {
    const cand = dbScanCandidates[idx];
    if (!cand || !currentDb) return;
    
    try {
        const res = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/ontology/relations`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: cand.name,
                description: cand.description,
                source: cand.source,
                target: cand.target,
                match_type: cand.match_type
            })
        });
        const data = await res.json();
        
        if (!data.success) {
            console.error('添加关系失败:', data.message);
        }
    } catch (err) {
        console.error('添加关系失败:', err);
    }
}

// 保留旧函数兼容性（调用新函数）

// 用户选择数据库后重新发起 AI 请求
async function selectDatabaseAndRetry(dbId, userQuery, oldMessageId) {
    // 更新旧消息，显示用户已选择
    const oldContentEl = document.getElementById(`${oldMessageId}-content`);
    if (oldContentEl) {
        const dbName = databases.find(d => d.id === dbId)?.name || dbId;
        oldContentEl.innerHTML = `<div style="padding: 12px; background: #e6fffa; border-radius: 8px; border-left: 4px solid #38b2ac;">
            <div style="font-size: 13px; color: #234e52;">已选择数据库：<strong>${escapeHtml(dbName)}</strong></div>
            <div style="font-size: 11px; color: #4a5568; margin-top: 4px;">正在继续处理您的请求...</div>
        </div>`;
    }
    
    // 更新上下文
    aiSessionContext.databases = [{id: dbId, name: databases.find(d => d.id === dbId)?.name || ''}];
    updateAiContextDisplay();
    
    // 发起新的 AI 请求
    const streamMessageId = addAiStreamMessage();
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/ai/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: userQuery,
                databases: [dbId],
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
            const chunks = buffer.split(/\n\n+/);
            buffer = chunks.pop() || '';
            
            for (const chunk of chunks) {
                if (!chunk.trim()) continue;
                const eventLines = chunk.split('\n');
                let eventType = '';
                const dataLines = [];
                for (const line of eventLines) {
                    if (line.startsWith('event:')) eventType = line.slice(6).trim();
                    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
                }
                if (!eventType || dataLines.length === 0) continue;
                try {
                    const data = JSON.parse(dataLines.join('\n'));
                    handleStreamEvent(streamMessageId, eventType, data, userQuery);
                } catch (err) {
                    console.warn('SSE JSON parse failed', eventType, dataLines.join('\n'), err);
                }
            }
        }
        
        // 记录到历史
        aiSessionContext.history.push({
            role: 'user',
            content: userQuery,
            databases: [dbId],
            modules: aiSessionContext.modules.map(m => m.id)
        });
        
    } catch (err) {
        console.error('AI 请求失败:', err);
        const statusEl = document.getElementById(`${streamMessageId}-status`);
        if (statusEl) {
            statusEl.innerHTML = `<div class="ai-error">请求失败: ${escapeHtml(err.message)}</div>`;
        }
    }
    
    // 恢复发送按钮
    const sendBtn = document.getElementById('aiSendBtn');
    if (sendBtn) sendBtn.disabled = false;
}

// 用户选择意图后重新发起 AI 请求
async function selectIntentAndRetry(intentId, userQuery, oldMessageId) {
    // 意图名称映射
    const intentNames = {
        'db-manage': '通用提问',
        'api-dispatch': '接口制作',
        'data-governance': '数据治理',
        'quality-audit': '质量审计',
        'ontology': '本体查询',
        'small-model': '小模型'
    };
    
    // 更新旧消息，显示用户已选择
    const oldContentEl = document.getElementById(`${oldMessageId}-content`);
    if (oldContentEl) {
        const intentName = intentNames[intentId] || intentId;
        oldContentEl.innerHTML = `<div style="padding: 12px; background: #e6fffa; border-radius: 8px; border-left: 4px solid #38b2ac;">
            <div style="font-size: 13px; color: #234e52;">已选择操作类型：<strong>${escapeHtml(intentName)}</strong></div>
            <div style="font-size: 11px; color: #4a5568; margin-top: 4px;">正在继续处理您的请求...</div>
        </div>`;
    }
    
    // 更新上下文模块
    aiSessionContext.modules = [{id: intentId, name: intentNames[intentId] || intentId}];
    updateAiContextDisplay();
    
    // 发起新的 AI 请求
    const streamMessageId = addAiStreamMessage();
    
    const currentDBs = aiSessionContext.databases.map(d => d.id);
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/ai/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: userQuery,
                databases: currentDBs,
                modules: [intentId],
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
            const chunks = buffer.split(/\n\n+/);
            buffer = chunks.pop() || '';
            
            for (const chunk of chunks) {
                if (!chunk.trim()) continue;
                const eventLines = chunk.split('\n');
                let eventType = '';
                const dataLines = [];
                for (const line of eventLines) {
                    if (line.startsWith('event:')) eventType = line.slice(6).trim();
                    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
                }
                if (!eventType || dataLines.length === 0) continue;
                try {
                    const data = JSON.parse(dataLines.join('\n'));
                    handleStreamEvent(streamMessageId, eventType, data, userQuery);
                } catch (err) {
                    console.warn('SSE JSON parse failed', eventType, dataLines.join('\n'), err);
                }
            }
        }
        
        // 记录到历史
        aiSessionContext.history.push({
            role: 'user',
            content: userQuery,
            databases: currentDBs,
            modules: [intentId]
        });
        
    } catch (err) {
        console.error('AI 请求失败:', err);
        const statusEl = document.getElementById(`${streamMessageId}-status`);
        if (statusEl) {
            statusEl.innerHTML = `<div class="ai-error">请求失败: ${escapeHtml(err.message)}</div>`;
        }
    }
    
    // 恢复发送按钮
    const sendBtn = document.getElementById('aiSendBtn');
    if (sendBtn) sendBtn.disabled = false;
}


async function saveMcpPort() {
    const portInput = document.getElementById('mcpPortInput');
    if (!portInput) return;

    const port = parseInt(portInput.value) || 0;

    // 验证端口范围
    if (port < 0 || port > 65535) {
        showToast('端口号必须在 0-65535 范围内', 'error');
        return;
    }

    try {
        const r = await fetchWithAuth(`${API_BASE}/api/data-ontology/mcp/port`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ port })
        });
        const data = await r.json();
        if (data.success) {
            mcpConfigPort = port;
            showToast('端口配置已保存，重启服务后生效');
        }
    } catch (e) {
        console.error('保存 MCP 端口配置失败:', e);
        showToast('保存失败', 'error');
    }
}

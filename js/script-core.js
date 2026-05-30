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

// === Agent Cluster Mode ===
let clusterTraceData = []; // agent_trace bubbles for current session
let mcpServersList = []; // MCP server list cache
let skillsList = []; // Skill list cache
// === Agent Cluster Mode End ===

const aiModules = [
    { id: 'db-manage', name: '通用提问', icon: '💬', description: '查询数据、统计信息、了解表结构等', aliases: ['数据库管理', '数据库', '查询', '提问', '问答'] },
    { id: 'api-dispatch', name: '接口制作', icon: '🔌', description: '创建 API 接口、生成数据服务', aliases: ['接口分发', '接口', 'API', 'api', '创建接口', '制作接口'] },
    { id: 'data-governance', name: '数据治理', icon: '⚙️', description: '创建定时任务、数据导入导出', aliases: ['治理', '定时任务', '导入', '导出', '任务'] },
    { id: 'quality-audit', name: '质量审计', icon: '✅', description: '数据质量检查、校验规则', aliases: ['质量', '审计', '校验', '检查'] },
    { id: 'ontology', name: '本体查询', icon: '🧠', description: '概念关系、语义分析', aliases: ['本体论', '本体', '语义', '概念'] },
    { id: 'small-model', name: '小模型', icon: '🤖', description: '小模型相关、本地模型、离线推理', aliases: ['小模型', '本地模型', '离线'] },
    { id: 'apps', name: '应用广场', icon: '📱', description: '浏览和管理应用', aliases: ['应用', '广场', 'app', 'apps'] },
    { id: 'mcp', name: 'Agent服务', icon: '🤝', description: 'MCP服务、智能体编排', aliases: ['agent', 'MCP', '智能体', '代理'] },
    { id: 'lineage', name: '数据血缘', icon: '🔗', description: '数据溯源、血缘关系追踪', aliases: ['血缘', '溯源', '追踪', 'lineage'] },
];

let aiSessionContext = {
    databases: [],
    modules: [],
    history: []
};

// === 会话管理系统 ===
let aiSessions = []; // [{id, title, mode, messages[], databases[], modules[], history[], createdAt, updatedAt}]
let currentSessionId = null;

// 从后端加载会话（账号持久化）
async function loadSessions() {
    try {
        const res = await fetchWithAuth(`${API_BASE}/api/v1/agent/sessions`);
        const data = await res.json();
        console.log('[loadSessions] API response:', JSON.stringify(data).substring(0, 500));
        if (data.success) {
            aiSessions = data.data || data.sessions || [];
            console.log('[loadSessions] loaded sessions:', aiSessions.length);
            // 如果有会话但没有当前会话，选择第一个
            if (aiSessions.length > 0 && !currentSessionId) {
                currentSessionId = aiSessions[0].id;
            }
        }
    } catch(e) { console.error('[loadSessions] error:', e); aiSessions = []; }
}

// 保存会话到后端（账号持久化）
async function saveSessionToBackend(session) {
    try {
        const res = await fetchWithAuth(`${API_BASE}/api/v1/agent/sessions/${session.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(session)
        });
        const data = await res.json();
        if (!data.success) {
            console.error('保存会话失败:', data.message);
            showToast('会话保存失败: ' + (data.message || '未知错误'), 'error');
        }
    } catch(e) {
        console.error('保存会话失败:', e);
        showToast('会话保存失败: ' + e.message, 'error');
    }
}

// 创建新会话并保存到后端
async function createNewSession() {
    const session = {
        id: 'sess-' + Date.now(),
        title: '🚀 新会话',
        mode: 'cluster',
        messages: [],
        databases: [],
        modules: [],
        history: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    try {
        await fetchWithAuth(`${API_BASE}/api/v1/agent/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(session)
        });
        aiSessions.unshift(session);
        currentSessionId = session.id;
        renderSessionList();
        switchToSession(session.id);
    } catch(e) {
        showToast('创建会话失败: ' + e.message, 'error');
    }
}
async function switchToSession(sessionId) {
    currentSessionId = sessionId;
    const session = getCurrentSession();
    if (!session) return;
    
    // 从后端加载完整会话数据（含消息）
    try {
        const res = await fetchWithAuth(`${API_BASE}/api/v1/agent/sessions/${sessionId}`);
        const data = await res.json();
        if (data.success && data.data) {
            const fullSession = data.data;
            session.messages = fullSession.messages || [];
            session.databases = fullSession.databases || [];
            session.modules = fullSession.modules || [];
            session.history = fullSession.history || [];
        }
    } catch(e) {
        console.error('加载会话详情失败:', e);
        showToast('加载会话详情失败', 'error');
    }
    
    // 恢复会话上下文
    aiSessionContext.databases = session.databases || [];
    aiSessionContext.modules = session.modules || [];
    aiSessionContext.history = session.history || [];
    
    // 清空聊天区并重新渲染消息
    const messagesEl = document.getElementById('aiChatMessages');
    if (messagesEl) {
        messagesEl.innerHTML = '';
        if (session.messages && session.messages.length > 0) {
            // 有消息的会话，隐藏快捷提示
            if (typeof hideQuickPrompts === 'function') hideQuickPrompts();
            session.messages.forEach(msg => {
                if (msg.mode === 'cluster' && msg.blocks && msg.blocks.length > 0) {
                    appendClusterMessageToChat(msg.content, msg.blocks);
                } else {
                    appendMessageToChat(msg.role, msg.content);
                }
            });
        } else {
            // 空会话显示欢迎信息
            showSessionWelcome();
        }
    }
    
    renderSessionList();
}

async function deleteSession(sessionId, event) {
    if (event) event.stopPropagation();
    
    try {
        await fetchWithAuth(`${API_BASE}/api/v1/agent/sessions/${sessionId}`, {
            method: 'DELETE'
        });
        aiSessions = aiSessions.filter(s => s.id !== sessionId);
        if (currentSessionId === sessionId) {
            currentSessionId = null;
            const messagesEl = document.getElementById('aiChatMessages');
            if (messagesEl) messagesEl.innerHTML = '';
            if (aiSessions.length > 0) {
                switchToSession(aiSessions[0].id);
            }
        }
        renderSessionList();
    } catch(e) {
        showToast('删除会话失败: ' + e.message, 'error');
    }
}

function appendMessageToChat(role, content) {
    // 简化版：直接添加消息气泡
    const messagesEl = document.getElementById('aiChatMessages');
    if (!messagesEl) return;
    const welcomeMsg = messagesEl.querySelector('.ai-welcome-message');
    if (welcomeMsg) welcomeMsg.remove();
    
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const isUser = role === 'user';
    const div = document.createElement('div');
    div.className = `ai-message ${isUser ? 'user' : 'assistant'}`;
    div.innerHTML = `
        <div class="ai-message-avatar">${isUser ? getUserAvatarSvg() : getAiAvatarSvg()}</div>
        <div class="ai-message-content">
            <div class="ai-message-bubble">${isUser ? escapeHtml(content) : formatClusterMarkdown(content)}</div>
            <div class="ai-message-meta"><span>${time}</span></div>
        </div>`;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// 从保存的 blocks 数据恢复集群模式卡片（刷新后使用）
function appendClusterMessageToChat(textContent, blocksData) {
    const messagesEl = document.getElementById('aiChatMessages');
    if (!messagesEl) return;
    const welcomeMsg = messagesEl.querySelector('.ai-welcome-message');
    if (welcomeMsg) welcomeMsg.remove();

    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    const div = document.createElement('div');
    div.className = 'ai-message assistant';

    const bubble = document.createElement('div');
    bubble.className = 'ai-message-bubble cluster-response-card';

    // 重建折叠块
    const blocksContainer = document.createElement('div');
    blocksContainer.className = 'cluster-blocks';
    if (blocksData && blocksData.length > 0) {
        blocksData.forEach(b => {
            const block = document.createElement('div');
            block.className = 'cluster-block ' + (b.className || '') + ' collapsed';
            const headerId = 'cbh-h-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
            block.innerHTML = `
                <div class="cluster-block-header" id="${headerId}" onclick="toggleClusterBlock(this)">
                    <span class="cluster-block-title">${escapeHtml(b.title)}</span>
                    <span class="cluster-block-chevron">▶</span>
                </div>
                <div class="cluster-block-body" style="display:none"></div>`;
            const bodyEl = block.querySelector('.cluster-block-body');
            if (bodyEl && b.bodyHtml) bodyEl.innerHTML = b.bodyHtml;
            blocksContainer.appendChild(block);
        });
    }
    bubble.appendChild(blocksContainer);

    // 文本内容
    const textDiv = document.createElement('div');
    textDiv.className = 'cluster-text-content';
    textDiv.innerHTML = formatClusterMarkdown(textContent);
    bubble.appendChild(textDiv);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'ai-message-content';
    contentDiv.appendChild(bubble);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'ai-message-meta';
    metaDiv.innerHTML = '<span>' + time + '</span>';
    contentDiv.appendChild(metaDiv);

    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'ai-message-avatar';
    avatarDiv.innerHTML = getAiAvatarSvg();

    div.appendChild(avatarDiv);
    div.appendChild(contentDiv);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showSessionWelcome() {
    const messagesEl = document.getElementById('aiChatMessages');
    if (!messagesEl) return;
    messagesEl.innerHTML = `
        <div class="ai-welcome-message">
            <p class="ai-welcome-subtitle">输入 @ 引用数据库或模块，直接描述任务</p>
        </div>`;
    if (typeof showQuickPrompts === 'function') showQuickPrompts();
}

function fillPrompt(text) {
    const input = document.getElementById('aiInput');
    if (input) {
        input.value = text;
        input.focus();
        input.style.height = 'auto';
        input.style.height = input.scrollHeight + 'px';
    }
}

function getCurrentSession() {
    return aiSessions.find(s => s.id === currentSessionId) || null;
}

function saveCurrentSessionMessage(role, content, blocksData) {
    const session = getCurrentSession();
    if (!session) return;
    const msg = { role, content, time: new Date().toISOString() };
    if (blocksData && blocksData.length > 0) {
        msg.blocks = blocksData;
        msg.mode = 'cluster';
    }
    session.messages.push(msg);
    // 自动更新标题：用第一条用户消息
    if (role === 'user' && session.messages.filter(m => m.role === 'user').length === 1) {
        session.title = content.substring(0, 20) + (content.length > 20 ? '...' : '');
    }
    session.databases = aiSessionContext.databases.map(db => typeof db === 'object' ? db.id : db);
    session.modules = aiSessionContext.modules.map(m => typeof m === 'object' ? m.id : m);
    session.history = aiSessionContext.history.map(h => ({
        role: h.role,
        content: h.content,
        databases: (h.databases || []).map(d => typeof d === 'object' ? d.id : d),
        modules: (h.modules || []).map(m => typeof m === 'object' ? m.id : m)
    }));
    session.updatedAt = new Date().toISOString();
    saveSessionToBackend(session);
    renderSessionList();
}

function renderSessionList() {
    const listEl = document.getElementById('aiSessionList');
    if (!listEl) return;
    
    if (aiSessions.length === 0) {
        listEl.innerHTML = '<div style="padding:20px 12px;color:#64748b;font-size:12px;text-align:center;">点击上方按钮<br>新建会话</div>';
        return;
    }
    
    listEl.innerHTML = aiSessions.map(s => {
        const isActive = s.id === currentSessionId;
        return `<div class="ai-session-item ${isActive ? 'active' : ''}" onclick="switchToSession('${s.id}')">
            <span class="session-title" ondblclick="renameSession('${s.id}', event)">${escapeHtml(s.title)}</span>
            <button class="session-delete" onclick="deleteSession('${s.id}', event)" title="删除">✕</button>
        </div>`;
    }).join('');
}

// 双击重命名会话
function renameSession(sessionId, event) {
    event.stopPropagation();
    const session = aiSessions.find(s => s.id === sessionId);
    if (!session) return;
    const titleEl = event.target;
    const oldTitle = session.title;
    titleEl.contentEditable = true;
    titleEl.focus();
    // 选中全部文字
    const range = document.createRange();
    range.selectNodeContents(titleEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    function finish() {
        titleEl.contentEditable = false;
        const newTitle = titleEl.textContent.trim();
        if (newTitle && newTitle !== oldTitle) {
            session.title = newTitle;
            saveSessionToBackend(session);
        } else {
            titleEl.textContent = oldTitle;
        }
        titleEl.removeEventListener('blur', finish);
        titleEl.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
        if (e.key === 'Enter') { e.preventDefault(); finish(); }
        if (e.key === 'Escape') { titleEl.textContent = oldTitle; finish(); }
    }
    titleEl.addEventListener('blur', finish);
    titleEl.addEventListener('keydown', onKey);
}

function toggleAISidebar() {
    const sidebar = document.getElementById('aiSessionSidebar');
    if (sidebar) sidebar.classList.toggle('collapsed');
}


// 初始化会话系统
async function initSessionSystem() {
    await loadSessions();
    // 恢复上次会话
    const lastSessionId = localStorage.getItem('lastSessionId');
    if (lastSessionId && aiSessions.find(s => s.id === lastSessionId)) {
        switchToSession(lastSessionId);
    } else if (aiSessions.length > 0) {
        switchToSession(aiSessions[0].id);
    }
    renderSessionList();
}

// 保存当前会话ID
const _origSwitchToSession = switchToSession;
switchToSession = function(sessionId) {
    _origSwitchToSession(sessionId);
    localStorage.setItem('lastSessionId', sessionId);
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
    await loadLazyScript('gov-shared.js?v=2026.05.14.1706.1706.1249.1249.1450.1450');
    await loadLazyScript('gov-api.js?v=2026.05.14.1706.1706.1249.1249.1450.1450');
    await loadLazyScript('governance.js?v=2026.05.14.1706.1706.1249.1249.1450.1450');
}

async function ensureQualityAuditScriptLoaded() {
    await loadLazyScript('quality-audit.js?v=2026.05.14.1706.1706.1249.1249.1450.1450');
}


function handleUnauthorizedFromApi() {
    if (!localStorage.getItem('dataOntologyToken')) return;
    try { closeUserMgmtPanel(true); } catch (e) { console.warn('[logout] closeUserMgmtPanel:', e); }
    try {
        window._qualityAuditDataLoaded = false;
        window._qualityAuditRulesLoaded = false;
    } catch (e) { console.warn('[logout] qualityAudit reset:', e); }
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
            // 401 直接跳转登录，不依赖响应内容
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
            } catch (e) { /* non-JSON response, ignore */ }
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
    const prefix = '/api/v1/databases/' + DEMO_ONTOLOGY_DB_ID;
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
        if (typeof url === 'string' && url.indexOf('/api/v1/databases/' + DEMO_ONTOLOGY_DB_ID) !== -1) {
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

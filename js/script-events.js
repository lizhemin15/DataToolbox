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
    restoreColumnState();
    
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
    document.getElementById('aiSendBtn').addEventListener('click', handleSendAiMessage);
    document.getElementById('aiInput').addEventListener('keydown', handleAiInputKeydown);
    document.getElementById('aiInput').addEventListener('input', handleAiInputChange);

    // 同步索引弹窗
    document.getElementById('closeSyncIndexModal').addEventListener('click', hideSyncIndexModal);
    document.getElementById('syncIndexModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideSyncIndexModal();
        }
    });
    document.getElementById('cancelSyncIndexBtn').addEventListener('click', hideSyncIndexModal);
    document.getElementById('startSyncIndexBtn').addEventListener('click', handleSyncIndex);

    // 下拉菜单切换
    document.getElementById('syncDropdownToggle').addEventListener('click', function(e) {
        e.stopPropagation();
        const menu = document.getElementById('syncDropdownMenu');
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });

    // 点击其他地方关闭下拉菜单
    document.addEventListener('click', function(e) {
        const menu = document.getElementById('syncDropdownMenu');
        if (menu && !e.target.closest('#syncDropdownToggle') && !e.target.closest('#syncDropdownMenu')) {
            menu.style.display = 'none';
        }
    });

    // 数据库操作下拉菜单
    const indexPreviewBtn = document.getElementById('indexPreviewBtn');
    if (indexPreviewBtn) {
        indexPreviewBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const menu = document.getElementById('indexPreviewMenu');
            if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });
    }

    // 点击其他地方关闭数据库操作菜单
    document.addEventListener('click', function(e) {
        const menu = document.getElementById('indexPreviewMenu');
        if (menu && !e.target.closest('#indexPreviewBtn') && !e.target.closest('#indexPreviewMenu')) {
            menu.style.display = 'none';
        }
    });

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
    // 批量导入用户
    const downloadUserTemplateBtn = document.getElementById('downloadUserTemplateBtn');
    if (downloadUserTemplateBtn) downloadUserTemplateBtn.addEventListener('click', handleDownloadUserTemplate);
    const importUsersFile = document.getElementById('importUsersFile');
    if (importUsersFile) importUsersFile.addEventListener('change', handleImportUsers);
}

// 提示框相关工具。
async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('loginError');

    try {
        const response = await fetch(`${API_BASE}/api/v1/system/auth/login`, {
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
        // 首次进入智能助手 tab 时初始化会话系统
        if (!window._aiSessionInitialized) {
            window._aiSessionInitialized = true;
            initAgentMode();
        }
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
    } else if (tabName === 'apps') {
        loadAppsMarketplace();
    }
}

// 数据库列表与详情管理。
const dbTypeDefaults = {
    dm: { port: 5236, requiresDb: false },  // 达梦用用户名作为schema，不需要数据库名
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/system/users`);
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
                const response = await fetchWithAuth(`${API_BASE}/api/v1/system/apikeys`, {
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/system/users/${encodeURIComponent(userPasswordTarget)}/password`, {
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/system/users/${encodeURIComponent(username)}`, {
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/system/users`, {
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

// 下载用户导入模板
function handleDownloadUserTemplate() {
    // 使用 SheetJS 创建 Excel
    const wb = XLSX.utils.book_new();
    const wsData = [
        ['用户名', '密码'],
        ['user1', 'password1'],
        ['user2', 'password2'],
        ['user3', 'password3']
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    // 设置列宽
    ws['!cols'] = [{ wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, '用户列表');
    XLSX.writeFile(wb, '用户导入模板.xlsx');
}

// 导入用户 Excel
async function handleImportUsers(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const msgEl = document.getElementById('userMgmtImportMsg');
    msgEl.classList.remove('show');
    
    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet, { header: ['username', 'password'] });
        
        // 跳过表头
        const users = json.slice(1).filter(row => row.username && row.password);
        
        if (users.length === 0) {
            msgEl.textContent = 'Excel 中没有有效的用户数据';
            msgEl.classList.add('show');
            e.target.value = '';
            return;
        }
        
        const response = await fetchWithAuth(`${API_BASE}/api/v1/system/users/batch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ users })
        });
        
        const result = await response.json();
        
        if (result.success) {
            const successCount = result.success_count || 0;
            const failCount = result.fail_count || 0;
            let message = `导入完成：成功 ${successCount} 个`;
            if (failCount > 0) {
                message += `，失败 ${failCount} 个`;
                if (result.fail_list && result.fail_list.length > 0) {
                    message += '\n失败原因：\n' + result.fail_list.map(f => `${f.username}: ${f.message}`).join('\n');
                }
            }
            showToast(message, failCount > 0 ? 'warning' : 'success');
            loadUsers();
        } else {
            msgEl.textContent = result.message || '导入失败';
            msgEl.classList.add('show');
        }
    } catch (err) {
        msgEl.textContent = '解析文件失败: ' + err.message;
        msgEl.classList.add('show');
    }
    
    e.target.value = '';
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/test-connection`, {
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
            ? `${API_BASE}/api/v1/databases/${editingDbId}`
            : `${API_BASE}/api/v1/databases`;
        
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


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

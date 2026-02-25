// 全局状态
let currentUser = null;
let databases = [];
let currentDb = null;
let isEditMode = false;
let editingDbId = null;

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

// 初始化
document.addEventListener('DOMContentLoaded', async function() {
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
    document.addEventListener('click', function(e) {
        const popover = document.getElementById('apikeyPopover');
        if (popover && !popover.contains(e.target) && e.target.id !== 'apikeyTriggerBtn') {
            popover.classList.remove('show');
        }
    });
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
    document.getElementById('editApiBtn').addEventListener('click', handleEditApi);
    document.getElementById('testApiBtn').addEventListener('click', showTestApiModal);
    document.getElementById('deleteApiBtn').addEventListener('click', handleDeleteApi);

    // MCP 模块事件
    const mcpCopyBaseUrlBtn = document.getElementById('mcpCopyBaseUrlBtn');
    if (mcpCopyBaseUrlBtn) mcpCopyBaseUrlBtn.addEventListener('click', function() {
        const url = (API_BASE || window.location.origin);
        navigator.clipboard.writeText(url).then(() => { this.textContent = '已复制'; setTimeout(() => { this.textContent = '复制'; }, 1500); });
    });
    const mcpCopyKeyBtn = document.getElementById('mcpCopyKeyBtn');
    if (mcpCopyKeyBtn) mcpCopyKeyBtn.addEventListener('click', function() {
        if (!currentApiKey) return;
        navigator.clipboard.writeText(currentApiKey).then(() => { this.textContent = '已复制'; setTimeout(() => { this.textContent = '复制'; }, 1500); });
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
        navigator.clipboard.writeText(pre.textContent).then(() => { this.textContent = '已复制'; setTimeout(() => { this.textContent = '复制配置'; }, 1500); });
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
    
    // 清除AI上下文按钮（稍后会动态添加）
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
    localStorage.removeItem('dataOntologyToken');
    localStorage.removeItem('dataOntologyUser');
    currentUser = null;
    databases = [];
    currentDb = null;
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
}

// 切换标签页
function switchTab(tabName) {
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

    try {
        const response = await fetch(`${API_BASE}/api/data-ontology/test-connection`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
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
    }
}

// 添加/编辑数据库
async function handleAddDatabase(e) {
    e.preventDefault();

    const dbType = document.getElementById('dbTypeInput').value;
    const config = {
        type: dbType,
        name: document.getElementById('dbNameInput').value
    };

    if (dbTypeDefaults[dbType].isFile) {
        config.path = document.getElementById('dbPathInput').value;
    } else {
        config.host = document.getElementById('dbHostInput').value;
        config.port = parseInt(document.getElementById('dbPortInput').value);
        config.user = document.getElementById('dbUserInput').value;
        const password = document.getElementById('dbPasswordInput').value;
        
        // 编辑模式下，如果密码为空则不更新密码
        if (isEditMode && password === '') {
            // 不包含password字段，后端会保留原密码
        } else {
            config.password = password;
        }
        
        if (dbTypeDefaults[dbType].requiresDb) {
            config.database = document.getElementById('dbDatabaseInput').value;
        }
    }

    const errorEl = document.getElementById('dbFormError');
    const successEl = document.getElementById('dbFormSuccess');
    errorEl.classList.remove('show');
    successEl.classList.remove('show');

    try {
        const url = isEditMode 
            ? `${API_BASE}/api/data-ontology/databases/${editingDbId}`
            : `${API_BASE}/api/data-ontology/databases`;
        
        const method = isEditMode ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
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
async function loadDatabases() {
    try {
        const response = await fetch(`${API_BASE}/api/data-ontology/databases`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
            }
        });

        const data = await response.json();

        if (data.success) {
            databases = data.databases || [];
            renderDatabaseList();
            
            // 如果当前选中的数据库被更新，同步更新currentDb
            if (currentDb) {
                const updatedDb = databases.find(db => db.id === currentDb.id);
                if (updatedDb) {
                    currentDb = updatedDb;
                }
            }
        }
    } catch (error) {
        console.error('加载数据库列表失败：', error);
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
        
        return `
            <div class="db-item ${currentDb && currentDb.id === db.id ? 'active' : ''}" onclick="selectDatabase('${db.id}')">
                <div class="db-item-name">${typeIcon} ${db.name}</div>
                <div class="db-item-info">${info}</div>
            </div>
        `;
    }).join('');
}

// 选择数据库
function selectDatabase(dbId) {
    currentDb = databases.find(db => db.id === dbId);
    if (currentDb) {
        renderDatabaseList();
        showDatabaseLoading();
        loadDatabaseDetail(dbId);
    }
}

// 显示数据库加载状态
function showDatabaseLoading() {
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
        const response = await fetch(`${API_BASE}/api/data-ontology/databases/${dbId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
            }
        });

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
        <div class="table-item" onclick="previewTable('${table}')">
            ${table}
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

    console.log('预览表:', tableName, '保持编辑模式:', keepEditMode, '当前编辑模式:', isTableEditMode);
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
        const structureResponse = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${tableName}/structure`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
            }
        });
        const structureData = await structureResponse.json();
        
        // 然后获取表数据
        const dataResponse = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${tableName}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
            }
        });
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
                const retryResp = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${encodeURIComponent(tableName)}/structure`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}` }
                });
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
        previewContent.innerHTML = '<div style="text-align:center;color:#e53e3e;padding:20px;">加载失败：' + error.message + '</div>';
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
        const structureResponse = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${encodeURIComponent(currentPreviewTable)}/structure`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}` }
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
    console.log('enableTableEditMode被调用');
    console.log('currentPreviewTable:', currentPreviewTable);
    console.log('currentDb:', currentDb);
    
    if (!currentPreviewTable) {
        console.error('没有选中的表');
        alert('请先选择一个表');
        return;
    }
    
    if (!currentDb) {
        console.error('没有选中数据库');
        alert('请先选择数据库');
        return;
    }
    
    console.log('启用编辑模式，当前表:', currentPreviewTable);
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
    console.log('删除行被调用，rowId:', rowId);
    const row = document.querySelector(`tr[data-row-id="${rowId}"]`);
    if (!row) {
        console.error('找不到行，rowId:', rowId);
        return;
    }
    
    console.log('找到行:', row);
    console.log('行数据 - isNew:', row.dataset.isNew, 'deleted:', row.dataset.deleted, 'rowIndex:', row.dataset.rowIndex);
    
    // 如果是新增行，直接删除DOM
    if (row.dataset.isNew === 'true') {
        console.log('删除新增行');
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
            console.log('取消删除标记');
            row.dataset.deleted = 'false';
            row.classList.remove('row-deleted');
            if (deleteBtn) {
                deleteBtn.textContent = '🗑️';
                deleteBtn.title = '删除行';
            }
        } else {
            // 标记为删除
            console.log('标记为删除，rowIndex:', row.dataset.rowIndex);
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
    
    console.log('总行数（不包括空行）:', rows.length);
    
    const updates = [];
    const inserts = [];
    const deletes = [];
    
    rows.forEach((row, index) => {
        const rowId = row.dataset.rowId;
        const rowIndex = row.dataset.rowIndex;
        const isNew = row.dataset.isNew === 'true';
        const isDeleted = row.dataset.deleted === 'true';
        
        console.log(`行 ${index}:`, {
            rowId,
            rowIndex,
            isNew,
            isDeleted,
            hasDeletedClass: row.classList.contains('row-deleted')
        });
        
        if (isDeleted) {
            // 只有非新增的行才需要删除
            if (!isNew && rowIndex !== undefined) {
                console.log(`添加到删除列表: rowIndex=${rowIndex}`);
                deletes.push(parseInt(rowIndex));
            } else {
                console.log('跳过删除（新增行或无索引）');
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
                console.log('添加到插入列表:', rowData);
                inserts.push(rowData);
            } else if (rowIndex !== undefined) {
                console.log(`添加到更新列表: rowIndex=${rowIndex}`, rowData);
                updates.push({ index: parseInt(rowIndex), data: rowData });
            }
        }
    });
    
    // 调试日志
    console.log('准备保存数据：');
    console.log('- 更新:', updates.length, '条', updates);
    console.log('- 插入:', inserts.length, '条', inserts);
    console.log('- 删除:', deletes.length, '条', deletes);
    
    // 检查是否有更改
    if (updates.length === 0 && inserts.length === 0 && deletes.length === 0) {
        alert('没有任何更改');
        return;
    }
    
    // 确认保存
    const message = `确认保存更改？\n更新: ${updates.length} 条\n插入: ${inserts.length} 条\n删除: ${deletes.length} 条`;
    if (!confirm(message)) {
        return;
    }
    
    // 发送保存请求
    try {
        console.log('发送保存请求到后端：', {
            url: `${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${currentPreviewTable}/data`,
            updates,
            inserts,
            deletes
        });
        
        const response = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${currentPreviewTable}/data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
            },
            body: JSON.stringify({
                updates,
                inserts,
                deletes
            })
        });
        
        const data = await response.json();
        console.log('后端响应:', data);
        
        if (data.success) {
            console.log('✅ 后端返回成功');
            console.log('📊 后端处理结果:', {
                affected: data.affected || 'N/A',
                updated: data.updated || 'N/A',
                inserted: data.inserted || 'N/A',
                deleted: data.deleted || 'N/A'
            });
            
            // 检查后端是否真正处理了删除
            if (deletes.length > 0) {
                if (data.deleted !== undefined && data.deleted !== deletes.length) {
                    console.warn('⚠️ 警告：请求删除 ' + deletes.length + ' 条，但后端只删除了 ' + data.deleted + ' 条');
                }
            }
            
            // 显示成功提示
            const successMsg = `保存成功！\n✓ 更新: ${updates.length} 条\n✓ 插入: ${inserts.length} 条\n✓ 删除: ${deletes.length} 条`;
            
            // 使用自定义提示替代 alert
            showSaveSuccess(successMsg);
            
            // 延迟重新加载，确保提示显示
            setTimeout(() => {
                console.log('🔄 开始重新加载表格，isTableEditMode:', isTableEditMode);
                previewTable(currentPreviewTable, true);
            }, 1500);
        } else {
            console.error('❌ 保存失败:', data.message);
            alert('保存失败：' + (data.message || '未知错误'));
        }
    } catch (error) {
        console.error('保存异常:', error);
        alert('保存失败：' + error.message);
    }
}

// 删除表
async function dropTable() {
    if (!currentDb || !currentPreviewTable) return;
    
    if (!confirm(`确定要删除表 "${currentPreviewTable}" 吗？此操作不可恢复！`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${currentPreviewTable}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('表删除成功！');
            closePreview();
            loadDatabaseDetail(currentDb.id);
        } else {
            alert('删除失败：' + (data.message || '未知错误'));
        }
    } catch (error) {
        alert('删除失败：' + error.message);
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
        const response = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${currentPreviewTable}/structure`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
            }
        });
        const data = await response.json();
        
        if (!data.success) {
            alert('获取表结构失败：' + (data.message || '未知错误'));
            return;
        }
        
        // 渲染编辑界面
        renderEditStructure(data.columns || []);
        document.getElementById('editStructureModal').style.display = 'block';
    } catch (error) {
        alert('获取表结构失败：' + error.message);
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
        alert('至少需要一个列');
        return;
    }
    
    if (!confirm(`确定要修改表 "${currentPreviewTable}" 的结构吗？\n此操作可能导致数据丢失！`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${currentPreviewTable}/structure`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
            },
            body: JSON.stringify({ columns: newColumns })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('表结构修改成功！');
            closeEditStructureModal();
            previewTable(currentPreviewTable);
        } else {
            alert('修改失败：' + (data.message || '未知错误'));
        }
    } catch (error) {
        alert('修改失败：' + error.message);
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
        alert('请输入新表名');
        return;
    }
    if (newName === currentPreviewTable) {
        hideRenameTableModal();
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${currentPreviewTable}/rename`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
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
            alert('重命名失败：' + (data.message || '未知错误'));
        }
    } catch (e) {
        alert('重命名失败：' + e.message);
    }
}

// 删除数据库
async function handleDeleteDatabase() {
    if (!currentDb) return;

    if (!confirm(`确定要删除数据库 "${currentDb.name}" 吗？此操作不可恢复。`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
            }
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
            alert(data.message || '删除失败');
        }
    } catch (error) {
        alert('删除失败：' + error.message);
    }
}

// ==================== 接口管理功能 ====================

// ---- ApiKey 管理 ----

async function loadApiKey() {
    try {
        const response = await fetch(`${API_BASE}/api/data-ontology/apikey`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}` }
        });
        const data = await response.json();
        if (data.success) {
            currentApiKey = data.api_key || '';
            renderApiKeyUI();
        }
    } catch (e) {
        console.error('加载ApiKey失败：', e);
    }
}

async function generateApiKey() {
    try {
        const response = await fetch(`${API_BASE}/api/data-ontology/apikey`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}` }
        });
        const data = await response.json();
        if (data.success) {
            currentApiKey = data.api_key;
            renderApiKeyUI();
            if (currentApi) renderCodeExamples(currentApi);
        }
    } catch (e) {
        console.error('生成ApiKey失败：', e);
    }
}

async function deleteApiKey() {
    if (!confirm('删除后，使用此 API Key 的外部调用将全部失效，确认删除？')) return;
    try {
        const response = await fetch(`${API_BASE}/api/data-ontology/apikey`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}` }
        });
        const data = await response.json();
        if (data.success) {
            currentApiKey = '';
            renderApiKeyUI();
            if (currentApi) renderCodeExamples(currentApi);
        }
    } catch (e) {
        console.error('删除ApiKey失败：', e);
    }
}

function copyApiKey() {
    if (!currentApiKey) return;
    navigator.clipboard.writeText(currentApiKey).then(() => {
        const btn = document.getElementById('copyApikeyBtn');
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = '复制'; }, 1500);
    });
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
        const r = await fetch(`${API_BASE}/api/data-ontology/mcp/config`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}` }
        });
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
        const r = await fetch(`${API_BASE}/api/data-ontology/mcp/config`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`,
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
        const response = await fetch(`${API_BASE}/api/data-ontology/apis`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
            }
        });

        const data = await response.json();

        if (data.success) {
            apis = data.apis || [];
            renderApiList();
        }
    } catch (error) {
        console.error('加载接口列表失败：', error);
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
        return `
            <div class="db-item api-item ${currentApi && currentApi.id === api.id ? 'active' : ''} ${enabled ? '' : 'api-disabled'}" onclick="selectApi('${api.id}')">
                <div class="db-item-main">
                    <div class="db-item-name">${api.name}</div>
                    <div class="db-item-info">
                        <span style="color:${methodColor};font-weight:600;">${api.method}</span> ${api.path}
                    </div>
                </div>
                <label class="switch-wrap" onclick="event.stopPropagation(); toggleApiEnabled('${api.id}')" title="${enabled ? '关闭接口' : '开启接口'}" style="flex-shrink:0;">
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
        const response = await fetch(`${API_BASE}/api/data-ontology/apis/${apiId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`,
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
        const response = await fetch(`${API_BASE}/api/data-ontology/apis/${apiId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
            }
        });

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
            document.getElementById('apiDatabase').textContent = api.database_name || api.database_id;
            document.getElementById('apiSqlDisplay').textContent = api.sql;
            
            // 解析并显示参数
            const params = parseMyBatisParams(api.sql);
            renderApiParams(params);
            
            // 渲染调用示例
            renderCodeExamples(api);
        }
    } catch (error) {
        console.error('加载接口详情失败：', error);
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
    const params = parseMyBatisParams(api.sql);
    const exampleParams = {};
    params.forEach(p => {
        if (api.default_params && api.default_params[p.name] !== undefined) {
            exampleParams[p.name] = api.default_params[p.name];
        } else {
            exampleParams[p.name] = '';
        }
    });
    const hasParams = params.length > 0;
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

function genJavaScript(ctx) {
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

function genNode(ctx) {
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
        const response = await fetch(`${API_BASE}/api/data-ontology/apis/${currentApi.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
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
            alert('修复成功！');
            loadApiDetail(currentApi.id);
        } else {
            alert('修复失败：' + (data.message || '未知错误'));
        }
    } catch (error) {
        alert('修复失败：' + error.message);
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
    
    // 加载数据库列表
    await loadDatabasesForSelect();
}

// 加载数据库列表到下拉框
async function loadDatabasesForSelect() {
    try {
        const response = await fetch(`${API_BASE}/api/data-ontology/databases`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
            }
        });

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

    const apiData = {
        name: document.getElementById('apiNameInput').value,
        path: document.getElementById('apiPathInput').value,
        method: document.getElementById('apiMethodInput').value,
        database_id: document.getElementById('apiDbSelect').value,
        sql: document.getElementById('apiSqlInput').value,
        description: document.getElementById('apiDescInput').value
    };

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

    // 验证路径格式
    if (!apiData.path.startsWith('/')) {
        showApiFormError('接口路径必须以 / 开头');
        return;
    }

    // 验证SQL语法
    const sqlWarnings = validateSqlSyntax(apiData.sql);
    if (sqlWarnings.length > 0) {
        const errors = sqlWarnings.filter(w => w.type === 'error');
        if (errors.length > 0) {
            showApiFormError(errors[0].message);
            return;
        }
        
        // 如果只有警告，询问用户是否继续
        const warnings = sqlWarnings.filter(w => w.type === 'warning');
        if (warnings.length > 0) {
            const warningMsg = warnings.map(w => w.message).join('\n\n');
            if (!confirm('⚠️ SQL语法警告：\n\n' + warningMsg + '\n\n是否继续保存？')) {
                return;
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
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
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
    document.getElementById('apiSqlInput').value = currentApi.sql;
    document.getElementById('apiDescInput').value = currentApi.description || '';
    
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

    try {
        const response = await fetch(`${API_BASE}/api/data-ontology/apis/${currentApi.id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
            }
        });

        const data = await response.json();

        if (data.success) {
            currentApi = null;
            document.getElementById('apiWelcomeView').style.display = 'flex';
            document.getElementById('apiDetailView').style.display = 'none';
            loadApis();
        } else {
            alert(data.message || '删除失败');
        }
    } catch (error) {
        alert('删除失败：' + error.message);
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
    
    // 预填充参数（优先使用默认参数）
    const params = parseMyBatisParams(currentApi.sql);
    if (params.length > 0) {
        const exampleParams = {};
        params.forEach(param => {
            // 如果有默认参数，使用默认值；否则使用空字符串
            if (currentApi.default_params && currentApi.default_params[param.name] !== undefined) {
                exampleParams[param.name] = currentApi.default_params[param.name];
            } else {
                exampleParams[param.name] = '';
            }
        });
        document.getElementById('testApiParams').value = JSON.stringify(exampleParams, null, 2);
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
        const response = await fetch(`${API_BASE}/api/data-ontology/apis/${currentApi.id}/test`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
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
        const response = await fetch(`${API_BASE}/api/data-ontology/ai/config`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
            }
        });

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
        const response = await fetch(`${API_BASE}/api/data-ontology/ai/config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
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
        html += matchedModules.map(m => `
            <div class="ai-db-suggestion ai-module-suggestion"
                 onclick="selectSuggestion('module','${m.id}')"
                 data-type="module" data-id="${m.id}">
                <span class="ai-db-suggestion-icon">${m.icon}</span>
                <span class="ai-db-suggestion-name">${m.name}</span>
                <span class="ai-db-suggestion-info">${m.description}</span>
            </div>
        `).join('');
    }

    if (matchedDbs.length > 0) {
        html += '<div class="ai-suggestion-group-title">数据库</div>';
        html += matchedDbs.map(db => {
            const typeIcon = dbTypeIcons[db.type] || '🗄️';
            const isFileDb = dbTypeDefaults[db.type]?.isFile;
            const info = isFileDb ? db.path : `${db.host}:${db.port}`;
            return `
                <div class="ai-db-suggestion"
                     onclick="selectSuggestion('db','${db.id}')"
                     data-type="db" data-id="${db.id}">
                    <span class="ai-db-suggestion-icon">${typeIcon}</span>
                    <span class="ai-db-suggestion-name">${db.name}</span>
                    <span class="ai-db-suggestion-info">${info}</span>
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
        const response = await fetch(`${API_BASE}/api/data-ontology/ai/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
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
        const response = await fetch(`${API_BASE}/api/data-ontology/ai/confirm-execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
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
    
    // 预填充配置
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
        const response = await fetch(`${API_BASE}/api/data-ontology/apis`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
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
        const token = localStorage.getItem('dataOntologyToken');
        const response = await fetch(`${API_BASE}/api/data-ontology/governance/tasks`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
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
        alert('请先选择数据库');
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
        alert('至少需要保留一列');
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
        const response = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
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
let govSelectedFile = null;

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
                    setGovFile(e.dataTransfer.files[0]);
                }
            });
        }
    });
})();

async function loadGovernanceTasks() {
    try {
        const token = localStorage.getItem('dataOntologyToken');
        const response = await fetch(`${API_BASE}/api/data-ontology/governance/tasks`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            govTasks = data.tasks || [];
            renderGovTaskList();
        }
    } catch (error) {
        console.error('加载治理任务失败:', error);
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

    container.innerHTML = filtered.map(t => `
        <div class="gov-task-item ${currentGovTask && currentGovTask.id === t.id ? 'active' : ''}"
             onclick="selectGovTask('${t.id}')">
            <div class="gov-task-item-icon">${t.type === 'scheduled' ? '⏰' : '📤'}</div>
            <div class="gov-task-item-info">
                <div class="gov-task-item-name">${escapeHtml(t.name)}</div>
                <div class="gov-task-item-meta">
                    <span class="gov-task-badge ${t.type}">${t.type === 'scheduled' ? '定时' : '交互'}</span>
                    <span class="gov-status-dot ${t.status}"></span>
                    <span>${t.status === 'idle' ? '空闲' : t.status === 'running' ? '运行中' : t.status === 'success' ? '成功' : '错误'}</span>
                </div>
            </div>
        </div>
    `).join('');
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
    } else {
        interactiveSection.style.display = 'none';
    }
    clearGovFile();
}

async function loadGovTaskLogs() {
    if (!currentGovTask) return;
    try {
        const token = localStorage.getItem('dataOntologyToken');
        const response = await fetch(`${API_BASE}/api/data-ontology/governance/tasks/${currentGovTask.id}/logs`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            renderGovLogs(data.logs || []);
        }
    } catch (error) {
        console.error('加载任务日志失败:', error);
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

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 新建/编辑任务
function showAddGovTaskModal() {
    isEditGovMode = false;
    editingGovTaskId = null;
    document.getElementById('govModalTitle').textContent = '新建任务';
    document.getElementById('govTaskForm').reset();
    document.getElementById('govEnabledInput').checked = true;
    document.getElementById('govEnabledLabel').textContent = '已启用';
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

function populateGovDbSelect() {
    const select = document.getElementById('govTaskDbSelect');
    select.innerHTML = '<option value="">不关联数据库</option>';
    databases.forEach(db => {
        select.innerHTML += `<option value="${db.id}">${escapeHtml(db.name)} (${db.type})</option>`;
    });
}

async function handleGovTaskSubmit(e) {
    e.preventDefault();
    const type = document.getElementById('govTaskTypeInput').value;
    const extsStr = document.getElementById('govAcceptExtsInput').value.trim();
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
    };

    if (!taskData.name || !taskData.js_code) {
        document.getElementById('govFormError').textContent = '任务名称和Go代码不能为空';
        document.getElementById('govFormError').classList.add('show');
        return;
    }

    try {
        const token = localStorage.getItem('dataOntologyToken');
        const url = isEditGovMode
            ? `${API_BASE}/api/data-ontology/governance/tasks/${editingGovTaskId}`
            : `${API_BASE}/api/data-ontology/governance/tasks`;
        const method = isEditGovMode ? 'PUT' : 'POST';
        const response = await fetch(url, {
            method: method,
            headers: {
                'Authorization': `Bearer ${token}`,
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
    try {
        const token = localStorage.getItem('dataOntologyToken');
        const response = await fetch(`${API_BASE}/api/data-ontology/governance/tasks/${currentGovTask.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            currentGovTask = null;
            document.getElementById('govTaskDetailView').style.display = 'none';
            document.getElementById('govWelcomeView').style.display = '';
            loadGovernanceTasks();
        }
    } catch (error) {
        alert('删除失败: ' + error.message);
    }
}

async function runGovTask() {
    if (!currentGovTask) return;
    await executeGovTaskInBrowser(currentGovTask.js_code, null, '');
}

async function toggleGovTask() {
    if (!currentGovTask) return;
    try {
        const token = localStorage.getItem('dataOntologyToken');
        const response = await fetch(`${API_BASE}/api/data-ontology/governance/tasks/${currentGovTask.id}/toggle`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            currentGovTask.enabled = data.enabled;
            showGovTaskDetail(currentGovTask);
            renderGovTaskList();
        }
    } catch (error) {
        alert('操作失败: ' + error.message);
    }
}

async function refreshGovTaskStatus() {
    if (!currentGovTask) return;
    try {
        const token = localStorage.getItem('dataOntologyToken');
        const response = await fetch(`${API_BASE}/api/data-ontology/governance/tasks/${currentGovTask.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
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

// 文件上传
function handleGovFileSelect(event) {
    if (event.target.files.length > 0) {
        setGovFile(event.target.files[0]);
    }
}

function setGovFile(file) {
    govSelectedFile = file;
    document.getElementById('govFileName').textContent = file.name + ' (' + formatFileSize(file.size) + ')';
    document.getElementById('govSelectedFile').style.display = 'flex';
}

function clearGovFile() {
    govSelectedFile = null;
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
    const file = govSelectedFile;

    if ((inputType === 'file' || inputType === 'both') && !file && !inputText) {
        alert('请选择文件或输入文本');
        return;
    }
    if (inputType === 'text' && !inputText) {
        alert('请输入文本内容');
        return;
    }

    await executeGovTaskInBrowser(currentGovTask.js_code, file, inputText);
}

// ==================== 浏览器端 JS 执行引擎 ====================

let govLibsLoaded = false;

async function ensureGovLibsLoaded() {
    if (govLibsLoaded) return;
    const libs = [
        { global: 'XLSX',    src: '../../lib/xlsx.full.min.js' },
        { global: 'Papa',    src: '../../lib/papaparse.min.js' },
        { global: 'mammoth', src: '../../lib/mammoth.browser.min.js' },
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
    govLibsLoaded = true;
}

function createGovHelper(logLines) {
    const token = localStorage.getItem('dataOntologyToken');
    const dbId = currentGovTask?.database_id || '';

    async function _runSQL(databaseId, sql, params = []) {
        const resp = await fetch(`${API_BASE}/api/data-ontology/governance/execute-sql`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
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
            const resp = await fetch(`${API_BASE}/api/data-ontology/ai/completion`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });
            const data = await resp.json();
            if (!data.success) throw new Error(data.message || 'AI 调用失败');
            return data.content || '';
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
    const token = localStorage.getItem('dataOntologyToken');

    try {
        let sql;
        if (db.type === 'sqlite') sql = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";
        else if (db.type === 'postgresql') sql = "SELECT table_name as name FROM information_schema.tables WHERE table_schema='public'";
        else if (db.type === 'dm') sql = "SELECT NAME FROM SYSOBJECTS WHERE TYPE$='SCHOBJ' AND SUBTYPE$='UTAB' AND PID=-1";
        else if (db.type === 'oracle') sql = "SELECT table_name as name FROM user_tables WHERE table_name NOT LIKE '%$%' AND table_name NOT LIKE 'ALL\\_%' ESCAPE '\\' AND table_name NOT LIKE 'DBA\\_%' ESCAPE '\\' AND table_name NOT LIKE 'ACCHK\\_%' ESCAPE '\\' AND table_name NOT LIKE 'ALERT\\_%' ESCAPE '\\' AND table_name NOT LIKE 'LOGMNR\\_%' ESCAPE '\\' AND table_name NOT LIKE 'WRM$%' AND table_name NOT LIKE 'WRI$%' AND table_name NOT LIKE 'AQ\\_%' ESCAPE '\\' AND table_name NOT LIKE 'ATP\\_%' ESCAPE '\\' AND table_name NOT LIKE 'AUDIT\\_%' ESCAPE '\\' AND table_name NOT LIKE 'AV\\_%' ESCAPE '\\' AND table_name NOT LIKE 'BDSQL\\_%' ESCAPE '\\' AND table_name NOT LIKE 'CATALOG\\_%' ESCAPE '\\' AND table_name NOT LIKE 'CLUSTER\\_%' ESCAPE '\\' AND table_name NOT LIKE 'CQN\\_%' ESCAPE '\\' AND table_name NOT LIKE 'DBMS\\_%' ESCAPE '\\' AND table_name NOT LIKE 'DEF$%' AND table_name NOT LIKE 'ERROR\\_%' ESCAPE '\\' AND table_name NOT LIKE 'FILE\\_%' ESCAPE '\\' AND table_name NOT LIKE 'HELP\\_%' ESCAPE '\\' AND table_name NOT LIKE 'LOGSTDBY%' AND table_name NOT LIKE 'MVIEW\\_%' ESCAPE '\\' AND table_name NOT LIKE 'OLAP\\_%' ESCAPE '\\' AND table_name NOT LIKE 'REPCAT\\_%' ESCAPE '\\' AND table_name NOT LIKE 'SCHEDULER\\_%' ESCAPE '\\' AND table_name NOT LIKE 'SYS\\_%' ESCAPE '\\' AND table_name NOT LIKE 'TRACE\\_%' ESCAPE '\\' AND table_name <> 'DUAL' AND table_name NOT LIKE 'DDL\\_%' ESCAPE '\\' AND table_name NOT LIKE 'FOREIGN\\_%' ESCAPE '\\' AND table_name NOT LIKE 'HANG\\_%' ESCAPE '\\' AND table_name NOT LIKE 'IMPDP\\_%' ESCAPE '\\' AND table_name NOT LIKE 'INC%' AND table_name NOT LIKE 'KU\\_%' ESCAPE '\\' AND table_name NOT LIKE 'LOGMNRC\\_%' ESCAPE '\\' ORDER BY table_name";
        else sql = 'SHOW TABLES';

        const resp = await fetch(`${API_BASE}/api/data-ontology/governance/execute-sql`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
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

    const token = localStorage.getItem('dataOntologyToken');
    try {
        let sql;
        if (db.type === 'sqlite') sql = `PRAGMA table_info('${tableName}')`;
        else if (db.type === 'postgresql') sql = `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='${tableName}'`;
        else if (db.type === 'dm' || db.type === 'oracle') sql = `SELECT COLUMN_NAME, DATA_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '${String(tableName).replace(/'/g, "''").toUpperCase()}' ORDER BY COLUMN_ID`;
        else sql = 'SHOW COLUMNS FROM `' + tableName + '`';

        const resp = await fetch(`${API_BASE}/api/data-ontology/governance/execute-sql`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
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

    if (!tableName) { alert('请先选择目标表'); return; }

    const checks = document.querySelectorAll('.codegen-col-check');
    const srcs = document.querySelectorAll('.codegen-col-src');
    const mappings = [];
    checks.forEach((chk, i) => {
        if (chk.checked) {
            const srcIdx = parseInt(srcs[i].value);
            mappings.push({ col: codegenColumns[i].name, srcIdx });
        }
    });

    if (mappings.length === 0) { alert('请至少勾选一个列'); return; }

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
        alert('请先选择关联数据库并选择目标表');
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
        alert('请至少勾选一个要导入的列');
        return;
    }

    if (!aiConfig) await loadAiConfig();
    if (!aiConfig || !aiConfig.url || !aiConfig.api_key || !aiConfig.model) {
        alert('请先在「AI助手」中配置 AI 设置（AI服务URL、API Key、模型名称）后再使用 AI 辅助生成');
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
        const token = localStorage.getItem('dataOntologyToken');
        const response = await fetch(`${API_BASE}/api/data-ontology/ai/codegen`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (data.success && data.code != null) {
            document.getElementById('govCodeInput').value = data.code;
        } else {
            alert(data.message || 'AI 生成失败');
        }
    } catch (e) {
        alert('请求失败: ' + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'AI 辅助生成代码';
        }
    }
}

async function executeGovTaskInBrowser(code, file, inputText) {
    if (!currentGovTask) return;
    const logLines = [];
    const taskId = currentGovTask.id;

    currentGovTask.status = 'running';
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    const container = document.getElementById('govTaskOutput');
    container.innerHTML = '<div class="gov-log-entry"><div class="gov-log-header"><span>执行中...</span><span class="gov-log-status running">运行中</span></div></div>';

    let status = 'success';
    let errorMsg = '';

    try {
        await ensureGovLibsLoaded();
        const gov = createGovHelper(logLines);

        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const fn = new AsyncFunction('gov', 'INPUT_FILE', 'INPUT_TEXT', 'XLSX', 'Papa', 'mammoth', code);
        await fn(gov, file || null, inputText || '', window.XLSX, window.Papa, window.mammoth);
    } catch (err) {
        status = 'error';
        errorMsg = err.message || String(err);
        logLines.push(`[错误] ${errorMsg}`);
    }

    const output = logLines.join('\n');

    currentGovTask.status = status;
    currentGovTask.last_output = output;
    currentGovTask.last_error = errorMsg;
    currentGovTask.last_run_at = new Date().toISOString();
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    const inputDesc = file ? `file: ${file.name}` : (inputText ? `text: ${inputText.substring(0, 50)}` : '');
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

    try {
        const token = localStorage.getItem('dataOntologyToken');
        await fetch(`${API_BASE}/api/data-ontology/governance/tasks/${taskId}/save-log`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, output, error: errorMsg, input: inputDesc })
        });
    } catch (e) {
        console.error('保存日志失败:', e);
    }
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
            }
        ]
    },
    {
        category: '内置库',
        items: [
            {
                name: 'XLSX',
                signature: 'XLSX (SheetJS)',
                desc: '完整的 SheetJS 库，用于 Excel 文件读写。常用：XLSX.utils.sheet_to_json、XLSX.utils.json_to_sheet、XLSX.writeFile。',
                example: 'const wb = await gov.readExcel(INPUT_FILE);\nconst sheet = wb.Sheets[wb.SheetNames[0]];\n// 带表头的对象数组\nconst data = XLSX.utils.sheet_to_json(sheet);\n// 原始二维数组\nconst raw = XLSX.utils.sheet_to_json(sheet, { header: 1 });'
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
            }
        ]
    }
];

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
    for (const cat of GOV_API_DOCS) {
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

// ---- 初始化/渲染知识图谱 ----
function renderOntologyGraph(data, animate) {
    if (!data) return;
    ontoData = data;

    const svgEl = document.getElementById('ontoSvg');
    if (!svgEl) return;

    // 隐藏欢迎界面
    document.getElementById('ontoWelcome').style.display = 'none';

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

    // 显示查询栏 & 更新统计
    document.getElementById('ontoQueryBar').style.display = '';
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

    // 高亮当前节点
    d3.selectAll('.onto-node').each(function(nd) {
        const active = nd.id === d.id;
        d3.select(this).select('.onto-node-circle')
            .transition().duration(200)
            .attr('filter', active ? 'url(#onto-glow-strong)' : 'url(#onto-glow)')
            .attr('stroke-width', active ? 4 : 2)
            .attr('opacity', active ? 1 : 0.55);
    });
}

function closeNodeDetail() {
    document.getElementById('ontoNodePopup').style.display = 'none';
    d3.selectAll('.onto-node .onto-node-circle')
        .transition().duration(200).attr('stroke-width', 2).attr('opacity', 1).attr('filter','url(#onto-glow)');
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
    const sel = document.getElementById('ontoDbSelect');
    const dbIds = Array.from(sel.selectedOptions).map(o => o.value);
    if (dbIds.length === 0) {
        showOntoToast('⚠️ 请先选择要分析的数据库', true);
        return;
    }
    showOntologyLoading('AI 正在分析数据库结构...');
    const token = localStorage.getItem('dataOntologyToken');

    let progress = 0;
    const progressInterval = setInterval(() => {
        progress = Math.min(progress + 2, 88);
        document.getElementById('ontoAiProgressBar').style.width = progress + '%';
    }, 300);

    const evtSource = new EventSource('/api/data-ontology/ontology/extract?' + new URLSearchParams({token}));
    fetch('/api/data-ontology/ontology/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ databases: dbIds }),
    }).then(res => {
        // 不走 EventSource，直接用 fetch+ReadableStream
    }).catch(() => {});

    // 改用 fetch + SSE 手动读取
    evtSource.close();
    clearInterval(progressInterval);
    let progress2 = 0;
    const pi2 = setInterval(() => {
        progress2 = Math.min(progress2 + 2, 88);
        document.getElementById('ontoAiProgressBar').style.width = progress2 + '%';
    }, 300);

    fetch('/api/data-ontology/ontology/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ databases: dbIds }),
    }).then(async res => {
        clearInterval(pi2);
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
    ontoData = null;
    d3.select('#ontoSvg').selectAll('*').remove();
    document.getElementById('ontoWelcome').style.display = '';
    document.getElementById('ontoQueryBar').style.display = 'none';
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
    resultEl.innerHTML = '<span style="color:#A29BFE;animation:onto-brain-pulse 1s infinite">🧠 AI正在进行语义推理...</span>';

    const token = localStorage.getItem('dataOntologyToken');
    try {
        const res = await fetch('/api/data-ontology/ontology/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ query, ontology: ontoData }),
        });
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
    el.style.cssText = isError ? 'border-color:rgba(225,112,85,.5);color:#E17055' : '';
    el.textContent = msg;
    document.body.appendChild(el);
    ontoToastTimer = setTimeout(() => el.remove(), 3500);
}

// ---- 初始化：本体论 tab 激活时同步数据库列表 ----
function initOntologyTab() {
    const sel = document.getElementById('ontoDbSelect');
    if (!sel) return;
    sel.innerHTML = '';
    databases.forEach(db => {
        const opt = document.createElement('option');
        opt.value = db.id;
        opt.textContent = `${db.name} (${db.type})`;
        sel.appendChild(opt);
    });
    // resize 时重绘
    window.addEventListener('resize', () => {
        if (ontoData) renderOntologyGraph(ontoData, false);
    });
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('govApiHelpModal')?.style.display !== 'none') {
        closeGovApiHelp();
    }
});

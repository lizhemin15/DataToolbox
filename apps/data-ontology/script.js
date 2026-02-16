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

// AI助手状态
let aiConfig = null;
let aiMessages = [];
let currentDbReference = null;
let dbSuggestionIndex = -1;
let aiSessionContext = {
    databases: [], // 当前会话使用的数据库
    history: []    // 对话历史
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

    // 关闭预览
    document.getElementById('closePreviewBtn').addEventListener('click', function() {
        document.getElementById('tablePreview').style.display = 'none';
    });

    // 接口管理事件
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
    } else if (tabName === 'ai') {
        loadAiConfig();
        updateAiContextDisplay();
    }
}

// 数据库类型默认端口配置
const dbTypeDefaults = {
    // 关系型数据库
    mysql: { port: 3306, requiresDb: true },
    mariadb: { port: 3306, requiresDb: true },
    postgresql: { port: 5432, requiresDb: true },
    sqlserver: { port: 1433, requiresDb: true },
    oracle: { port: 1521, requiresDb: false },
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
        loadDatabaseDetail(dbId);
    }
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
        }
    } catch (error) {
        console.error('加载数据库详情失败：', error);
    }
}

// 渲染表列表
function renderTablesList(tables) {
    const listEl = document.getElementById('tablesList');
    
    if (tables.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;color:#718096;padding:20px;">暂无数据表</div>';
        return;
    }

    listEl.innerHTML = tables.map(table => `
        <div class="table-item" onclick="previewTable('${table}')">
            ${table}
        </div>
    `).join('');
}

// 预览表数据
async function previewTable(tableName) {
    if (!currentDb) return;

    try {
        const response = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/tables/${tableName}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
            }
        });

        const data = await response.json();

        if (data.success) {
            document.getElementById('tablePreview').style.display = 'block';
            document.getElementById('previewTableName').textContent = tableName;
            
            const previewContent = document.getElementById('previewContent');
            
            if (!data.data || data.data.length === 0) {
                previewContent.innerHTML = '<div style="text-align:center;color:#718096;padding:20px;">表中暂无数据</div>';
                return;
            }

            const columns = Object.keys(data.data[0]);
            const tableHtml = `
                <table class="preview-table">
                    <thead>
                        <tr>
                            ${columns.map(col => `<th>${col}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${data.data.map(row => `
                            <tr>
                                ${columns.map(col => `<td>${row[col] !== null ? row[col] : '<i>NULL</i>'}</td>`).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
            
            previewContent.innerHTML = tableHtml;
            previewContent.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    } catch (error) {
        console.error('预览表数据失败：', error);
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
            document.getElementById('welcomeView').style.display = 'flex';
            document.getElementById('dbDetailView').style.display = 'none';
            loadDatabases();
        } else {
            alert(data.message || '删除失败');
        }
    } catch (error) {
        alert('删除失败：' + error.message);
    }
}

// ==================== 接口管理功能 ====================

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

// 渲染接口列表
function renderApiList() {
    const listEl = document.getElementById('apiList');
    
    if (apis.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;color:#718096;padding:20px;">暂无接口</div>';
        return;
    }

    listEl.innerHTML = apis.map(api => {
        const methodColor = {
            'GET': '#48bb78',
            'POST': '#4299e1',
            'PUT': '#ed8936',
            'DELETE': '#f56565'
        }[api.method] || '#718096';
        
        return `
            <div class="db-item ${currentApi && currentApi.id === api.id ? 'active' : ''}" onclick="selectApi('${api.id}')">
                <div class="db-item-name">${api.name}</div>
                <div class="db-item-info">
                    <span style="color:${methodColor};font-weight:600;">${api.method}</span> ${api.path}
                </div>
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
            document.getElementById('apiWelcomeView').style.display = 'none';
            document.getElementById('apiDetailView').style.display = 'block';
            
            const api = data.api;
            document.getElementById('apiName').textContent = api.name;
            document.getElementById('apiPath').textContent = api.path;
            document.getElementById('apiMethod').textContent = api.method;
            document.getElementById('apiDatabase').textContent = api.database_name || api.database_id;
            document.getElementById('apiSqlDisplay').textContent = api.sql;
            
            // 解析并显示参数
            const params = parseMyBatisParams(api.sql);
            renderApiParams(params);
        }
    } catch (error) {
        console.error('加载接口详情失败：', error);
    }
}

// 解析MyBatis参数
function parseMyBatisParams(sql) {
    const params = new Set();
    
    // 匹配 #{paramName} 格式
    const hashPattern = /#\{([^}]+)\}/g;
    let match;
    while ((match = hashPattern.exec(sql)) !== null) {
        params.add({
            name: match[1].trim(),
            type: 'prepared',
            required: true
        });
    }
    
    // 匹配 ${paramName} 格式
    const dollarPattern = /\$\{([^}]+)\}/g;
    while ((match = dollarPattern.exec(sql)) !== null) {
        const paramName = match[1].trim();
        // 检查是否已经作为 prepared 参数存在
        const existing = Array.from(params).find(p => p.name === paramName);
        if (!existing) {
            params.add({
                name: paramName,
                type: 'direct',
                required: true
            });
        }
    }
    
    return Array.from(params);
}

// 渲染接口参数
function renderApiParams(params) {
    const displayEl = document.getElementById('apiParamsDisplay');
    
    if (params.length === 0) {
        displayEl.innerHTML = '<div style="text-align:center;color:#718096;padding:12px;">无参数</div>';
        return;
    }
    
    displayEl.innerHTML = params.map(param => {
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

// 显示数据库建议
function showDbSuggestions(searchTerm) {
    const suggestions = databases.filter(db => 
        db.name.toLowerCase().includes(searchTerm)
    );
    
    if (suggestions.length === 0) {
        hideDbSuggestions();
        return;
    }
    
    const suggestionsEl = document.getElementById('aiDbSuggestions');
    suggestionsEl.innerHTML = suggestions.map((db, index) => {
        const typeIcon = dbTypeIcons[db.type] || '🗄️';
        const isFileDb = dbTypeDefaults[db.type]?.isFile;
        const info = isFileDb ? db.path : `${db.host}:${db.port}`;
        
        return `
            <div class="ai-db-suggestion ${index === dbSuggestionIndex ? 'active' : ''}" 
                 onclick="selectDbSuggestion('${db.id}')" 
                 data-db-id="${db.id}">
                <span class="ai-db-suggestion-icon">${typeIcon}</span>
                <span class="ai-db-suggestion-name">${db.name}</span>
                <span class="ai-db-suggestion-info">${info}</span>
            </div>
        `;
    }).join('');
    
    suggestionsEl.style.display = 'block';
    dbSuggestionIndex = -1;
}

// 隐藏数据库建议
function hideDbSuggestions() {
    document.getElementById('aiDbSuggestions').style.display = 'none';
    dbSuggestionIndex = -1;
}

// 选择数据库建议
function selectDbSuggestion(dbId) {
    const db = databases.find(d => d.id === dbId);
    if (!db) return;
    
    const input = document.getElementById('aiInput');
    const value = input.value;
    const cursorPos = input.selectionStart;
    
    // 找到@符号的位置
    const textBeforeCursor = value.substring(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');
    
    if (atIndex !== -1) {
        const newValue = value.substring(0, atIndex) + `@${db.name} ` + value.substring(cursorPos);
        input.value = newValue;
        input.selectionStart = input.selectionEnd = atIndex + db.name.length + 2;
        input.focus();
    }
    
    hideDbSuggestions();
}

// 处理AI输入框按键
function handleAiInputKeydown(e) {
    const suggestionsEl = document.getElementById('aiDbSuggestions');
    
    if (suggestionsEl.style.display === 'block') {
        const suggestions = suggestionsEl.querySelectorAll('.ai-db-suggestion');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            dbSuggestionIndex = Math.min(dbSuggestionIndex + 1, suggestions.length - 1);
            updateSuggestionHighlight(suggestions);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            dbSuggestionIndex = Math.max(dbSuggestionIndex - 1, -1);
            updateSuggestionHighlight(suggestions);
        } else if (e.key === 'Enter' && dbSuggestionIndex >= 0) {
            e.preventDefault();
            const dbId = suggestions[dbSuggestionIndex].dataset.dbId;
            selectDbSuggestion(dbId);
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
    
    // 提取数据库引用
    const dbMatches = [...message.matchAll(/@([^\s]+)/g)];
    const dbReferences = [];
    
    for (const match of dbMatches) {
        const dbName = match[1];
        const db = databases.find(d => d.name === dbName);
        if (db) {
            dbReferences.push(db);
        }
    }
    
    // 如果消息中有@引用，更新会话上下文
    if (dbReferences.length > 0) {
        aiSessionContext.databases = dbReferences;
        updateAiContextDisplay();
    } else if (aiSessionContext.databases.length > 0) {
        // 如果没有新的@引用，但有历史数据库，继续使用
        dbReferences.push(...aiSessionContext.databases);
    } else {
        // 既没有@引用，也没有历史数据库
        showAiError('请使用 @数据库名 来引用数据库，或在之前的对话中已经引用过数据库');
        return;
    }
    
    // 添加到历史记录
    aiSessionContext.history.push({
        role: 'user',
        content: message,
        databases: dbReferences.map(db => db.id)
    });
    
    // 添加用户消息（如果没有@但使用了上下文，显示提示）
    let displayMessage = message;
    if (dbMatches.length === 0 && aiSessionContext.databases.length > 0) {
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
                history: aiSessionContext.history.slice(-5) // 只发送最近5条历史
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
            <div style="margin-top: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #4a5568; margin-bottom: 6px;">📝 生成的SQL查询：</div>
                <div class="ai-sql-block">${escapeHtml(sql)}</div>
            </div>
        `;
    }
    
    // 如果有结果，显示结果标题和表格
    if (results && results.length > 0) {
        resultHtml += `
            <div style="margin-top: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #4a5568; margin-bottom: 6px;">📊 查询结果：</div>
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
                <div style="font-size: 12px; color: #718096; margin-top: 8px; padding-left: 4px;">
                    ✓ 共查询到 <strong>${results.length}</strong> 条记录${results.length > 10 ? '，显示前10条' : ''}
                </div>
            </div>
        `;
    } else if (results && results.length === 0) {
        resultHtml += `
            <div style="margin-top: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #4a5568; margin-bottom: 6px;">📊 查询结果：</div>
                <div style="padding: 16px; background: #f7fafc; border-radius: 8px; color: #718096; text-align: center;">
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
                    <div style="line-height: 1.6;">${escapeHtml(content)}</div>
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
            <div style="margin-top: 12px;">
                <div class="ai-retry-header" onclick="toggleRetryDetails('${retryId}')" style="cursor: pointer; padding: 8px 12px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 13px; color: #856404;">
                        🔄 经过 ${retries} 次重试后成功
                    </span>
                    <span id="${retryId}-icon" style="font-size: 12px; color: #856404;">▼</span>
                </div>
                <div id="${retryId}" class="ai-retry-details" style="display: none; margin-top: 8px; padding: 12px; background: #f8f9fa; border-radius: 6px; border: 1px solid #e2e8f0;">
                    ${attempts.map((attempt, index) => `
                        <div style="margin-bottom: ${index < attempts.length - 1 ? '12px' : '0'}; padding-bottom: ${index < attempts.length - 1 ? '12px' : '0'}; border-bottom: ${index < attempts.length - 1 ? '1px solid #e2e8f0' : 'none'};">
                            <div style="font-size: 12px; font-weight: 600; color: #e53e3e; margin-bottom: 4px;">
                                ❌ 尝试 ${attempt.attempt}：${escapeHtml(attempt.error)}
                            </div>
                            ${attempt.sql ? `<div class="ai-sql-block" style="font-size: 12px; padding: 8px 10px; margin-top: 6px;">${escapeHtml(attempt.sql)}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    // 如果有SQL，显示SQL标题和代码块
    if (sql) {
        resultHtml += `
            <div style="margin-top: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #4a5568; margin-bottom: 6px;">✅ 最终成功的SQL查询：</div>
                <div class="ai-sql-block">${escapeHtml(sql)}</div>
            </div>
        `;
    }
    
    // 如果有结果，显示结果标题和表格
    if (results && results.length > 0) {
        resultHtml += `
            <div style="margin-top: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #4a5568; margin-bottom: 6px;">📊 查询结果：</div>
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
                <div style="font-size: 12px; color: #718096; margin-top: 8px; padding-left: 4px;">
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
                    <div style="line-height: 1.6;">${escapeHtml(content)}</div>
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
                    <div style="font-weight: 600; margin-bottom: 8px;">${escapeHtml(message)}</div>
                    <div style="font-size: 12px; margin-bottom: 12px;">已尝试 ${attempts.length} 次，均未成功</div>
                    <div class="ai-retry-header" onclick="toggleRetryDetails('${retryId}')" style="cursor: pointer; padding: 8px 12px; background: rgba(255, 255, 255, 0.3); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 13px;">查看所有尝试</span>
                        <span id="${retryId}-icon" style="font-size: 12px;">▼</span>
                    </div>
                    <div id="${retryId}" class="ai-retry-details" style="display: none; margin-top: 8px; padding: 12px; background: rgba(255, 255, 255, 0.2); border-radius: 4px;">
                        ${attempts.map((attempt, index) => `
                            <div style="margin-bottom: ${index < attempts.length - 1 ? '12px' : '0'}; padding-bottom: ${index < attempts.length - 1 ? '12px' : '0'}; border-bottom: ${index < attempts.length - 1 ? '1px solid rgba(255, 255, 255, 0.3)' : 'none'};">
                                <div style="font-size: 12px; font-weight: 600; margin-bottom: 4px;">
                                    尝试 ${attempt.attempt}：${escapeHtml(attempt.error)}
                                </div>
                                ${attempt.sql ? `<div class="ai-sql-block" style="font-size: 12px; padding: 8px 10px; margin-top: 6px;">${escapeHtml(attempt.sql)}</div>` : ''}
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
            const retryHtml = `<div class="ai-status-retry">🔄 ${escapeHtml(data.message)}<br><span style="font-size:12px;color:#856404;">错误: ${escapeHtml(data.error)}</span></div>`;
            attemptsEl.style.display = 'block';
            attemptsEl.insertAdjacentHTML('beforeend', retryHtml);
            statusEl.innerHTML = `<div class="ai-status-thinking">🔄 ${escapeHtml(data.message)}</div>`;
            break;
            
        case 'sql_generated':
            statusEl.innerHTML = `<div class="ai-status-success">✅ SQL生成完成</div>`;
            contentEl.innerHTML = `
                <div style="line-height: 1.6; margin-bottom: 12px;">${escapeHtml(data.response)}</div>
                <div style="margin-top: 12px;">
                    <div style="font-size: 13px; font-weight: 600; color: #4a5568; margin-bottom: 6px;">📝 生成的SQL查询：</div>
                    <div class="ai-sql-block">${escapeHtml(data.sql)}</div>
                </div>
            `;
            break;
            
        case 'executing':
            statusEl.innerHTML = `<div class="ai-status-executing">⚡ ${escapeHtml(data.message)}</div>`;
            break;
            
        case 'attempt_failed':
            const failedHtml = `<div class="ai-attempt-failed">❌ 尝试 ${data.attempt} 失败: ${escapeHtml(data.error)}${data.sql ? '<br><div class="ai-sql-block" style="font-size:12px;padding:8px;margin-top:4px;">' + escapeHtml(data.sql) + '</div>' : ''}</div>`;
            attemptsEl.style.display = 'block';
            attemptsEl.insertAdjacentHTML('beforeend', failedHtml);
            break;
            
        case 'success':
            statusEl.innerHTML = '';
            
            let resultHtml = `<div style="line-height: 1.6; margin-bottom: 12px;">${escapeHtml(data.response)}</div>`;
            
            // 显示重试信息（如果有）
            if (data.attempts && data.attempts.length > 0) {
                const retryId = 'retry-' + messageId;
                resultHtml += `
                    <div style="margin-top: 12px;">
                        <div class="ai-retry-header" onclick="toggleRetryDetails('${retryId}')" style="cursor: pointer; padding: 8px 12px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 13px; color: #856404;">🔄 经过 ${data.retries} 次重试后成功</span>
                            <span id="${retryId}-icon" style="font-size: 12px; color: #856404;">▼</span>
                        </div>
                        <div id="${retryId}" class="ai-retry-details" style="display: none; margin-top: 8px; padding: 12px; background: #f8f9fa; border-radius: 6px; border: 1px solid #e2e8f0;">
                            ${data.attempts.map((attempt, index) => `
                                <div style="margin-bottom: ${index < data.attempts.length - 1 ? '12px' : '0'}; padding-bottom: ${index < data.attempts.length - 1 ? '12px' : '0'}; border-bottom: ${index < data.attempts.length - 1 ? '1px solid #e2e8f0' : 'none'};">
                                    <div style="font-size: 12px; font-weight: 600; color: #e53e3e; margin-bottom: 4px;">❌ 尝试 ${attempt.attempt}：${escapeHtml(attempt.error)}</div>
                                    ${attempt.sql ? '<div class="ai-sql-block" style="font-size: 12px; padding: 8px 10px; margin-top: 6px;">' + escapeHtml(attempt.sql) + '</div>' : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
            
            resultHtml += `
                <div style="margin-top: 12px;">
                    <div style="font-size: 13px; font-weight: 600; color: #4a5568; margin-bottom: 6px;">${data.attempts && data.attempts.length > 0 ? '✅ 最终成功的SQL查询：' : '📝 生成的SQL查询：'}</div>
                    <div class="ai-sql-block">${escapeHtml(data.sql)}</div>
                </div>
            `;
            
            if (data.results && data.results.length > 0) {
                resultHtml += `
                    <div style="margin-top: 12px;">
                        <div style="font-size: 13px; font-weight: 600; color: #4a5568; margin-bottom: 6px;">📊 查询结果：</div>
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
                        <div style="font-size: 12px; color: #718096; margin-top: 8px; padding-left: 4px;">
                            ✓ 共查询到 <strong>${data.results.length}</strong> 条记录${data.results.length > 10 ? '，显示前10条' : ''}
                        </div>
                    </div>
                `;
            } else if (data.results && data.results.length === 0) {
                resultHtml += `
                    <div style="margin-top: 12px;">
                        <div style="font-size: 13px; font-weight: 600; color: #4a5568; margin-bottom: 6px;">📊 查询结果：</div>
                        <div style="padding: 16px; background: #f7fafc; border-radius: 8px; color: #718096; text-align: center;">暂无数据</div>
                    </div>
                `;
            }
            
            contentEl.innerHTML = resultHtml;
            attemptsEl.style.display = 'none';
            break;
            
        case 'error':
            statusEl.innerHTML = '';
            let errorHtml = `<div class="ai-error"><div style="font-weight: 600; margin-bottom: 8px;">${escapeHtml(data.message)}</div>`;
            
            if (data.attempts && data.attempts.length > 0) {
                const retryId = 'retry-' + messageId;
                errorHtml += `
                    <div style="font-size: 12px; margin-bottom: 12px;">已尝试 ${data.attempts.length} 次，均未成功</div>
                    <div class="ai-retry-header" onclick="toggleRetryDetails('${retryId}')" style="cursor: pointer; padding: 8px 12px; background: rgba(255, 255, 255, 0.3); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 13px;">查看所有尝试</span>
                        <span id="${retryId}-icon" style="font-size: 12px;">▼</span>
                    </div>
                    <div id="${retryId}" class="ai-retry-details" style="display: none; margin-top: 8px; padding: 12px; background: rgba(255, 255, 255, 0.2); border-radius: 4px;">
                        ${data.attempts.map((attempt, index) => `
                            <div style="margin-bottom: ${index < data.attempts.length - 1 ? '12px' : '0'}; padding-bottom: ${index < data.attempts.length - 1 ? '12px' : '0'}; border-bottom: ${index < data.attempts.length - 1 ? '1px solid rgba(255, 255, 255, 0.3)' : 'none'};">
                                <div style="font-size: 12px; font-weight: 600; margin-bottom: 4px;">尝试 ${attempt.attempt}：${escapeHtml(attempt.error)}</div>
                                ${attempt.sql ? '<div class="ai-sql-block" style="font-size: 12px; padding: 8px 10px; margin-top: 6px;">' + escapeHtml(attempt.sql) + '</div>' : ''}
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
                <div style="line-height: 1.6; margin-bottom: 12px;">${escapeHtml(data.message)}</div>
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

// 更新AI上下文显示
function updateAiContextDisplay() {
    const header = document.querySelector('#aiTab .ai-chat-header');
    if (!header) return;
    
    let contextEl = document.getElementById('aiContextDisplay');
    const input = document.getElementById('aiInput');
    
    if (aiSessionContext.databases.length > 0) {
        const dbNames = aiSessionContext.databases.map(db => db.name).join(', ');
        const dbIcons = aiSessionContext.databases.map(db => {
            const typeIcon = dbTypeIcons[db.type] || '🗄️';
            return typeIcon;
        }).join(' ');
        
        if (!contextEl) {
            contextEl = document.createElement('div');
            contextEl.id = 'aiContextDisplay';
            contextEl.className = 'ai-context-display';
            
            const h3 = header.querySelector('h3');
            h3.parentNode.insertBefore(contextEl, h3.nextSibling);
        }
        
        contextEl.innerHTML = `
            <div class="ai-context-info">
                <span class="ai-context-label">上下文:</span>
                <span class="ai-context-value">${dbIcons} ${escapeHtml(dbNames)}</span>
                <button class="ai-context-clear" onclick="clearAiContext()" title="清除上下文，开始新对话">✕</button>
            </div>
        `;
        
        // 更新输入框占位符
        if (input) {
            input.placeholder = '继续提问... (无需再次 @ 数据库)';
        }
    } else {
        if (contextEl) {
            contextEl.remove();
        }
        
        // 更新输入框占位符
        if (input) {
            input.placeholder = '输入问题... (首次使用 @数据库名)';
        }
    }
}

// 清除AI上下文
function clearAiContext() {
    if (confirm('确定要清除当前对话上下文吗？这将开始新的对话。')) {
        aiSessionContext.databases = [];
        aiSessionContext.history = [];
        updateAiContextDisplay();
        
        // 显示提示消息
        const messagesEl = document.getElementById('aiChatMessages');
        const messageId = 'msg-clear-' + Date.now();
        const messageHtml = `
            <div class="ai-message assistant" id="${messageId}" style="opacity: 0.8;">
                <div class="ai-message-avatar">ℹ️</div>
                <div class="ai-message-content">
                    <div style="padding: 12px; background: #e6f7ff; border-left: 3px solid #1890ff; border-radius: 6px; color: #0050b3; font-size: 13px;">
                        已清除对话上下文，请重新使用 @数据库名 开始新的对话
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

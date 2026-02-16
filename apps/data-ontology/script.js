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
        
        return `
            <div class="param-item">
                <span class="param-name">${param.name}</span>
                <span class="param-type ${typeClass}">${requiredLabel}</span>
                <span style="color:#718096;margin-left:8px;font-size:13px;">(${typeLabel})</span>
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
    document.getElementById('addApiModal').classList.remove('show');
    isEditApiMode = false;
    editingApiId = null;
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
            successEl.textContent = isEditApiMode ? '接口更新成功！' : '接口添加成功！';
            successEl.classList.add('show');
            setTimeout(() => {
                hideAddApiModal();
                loadApis();
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
    
    // 预填充参数示例
    const params = parseMyBatisParams(currentApi.sql);
    if (params.length > 0) {
        const exampleParams = {};
        params.forEach(param => {
            exampleParams[param.name] = '';
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

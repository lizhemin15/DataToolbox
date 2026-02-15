// 全局状态
let currentUser = null;
let databases = [];
let currentDb = null;

// API基础URL
const API_BASE = window.location.origin;

// 初始化
document.addEventListener('DOMContentLoaded', function() {
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
}

// 显示添加数据库弹窗
function showAddDbModal() {
    document.getElementById('addDbModal').classList.add('show');
    document.getElementById('addDbForm').reset();
    document.getElementById('dbPortInput').value = '3306';
    document.getElementById('dbFormError').classList.remove('show');
    document.getElementById('dbFormSuccess').classList.remove('show');
}

// 隐藏添加数据库弹窗
function hideAddDbModal() {
    document.getElementById('addDbModal').classList.remove('show');
}

// 测试数据库连接
async function testConnection() {
    const config = {
        host: document.getElementById('dbHostInput').value,
        port: parseInt(document.getElementById('dbPortInput').value),
        user: document.getElementById('dbUserInput').value,
        password: document.getElementById('dbPasswordInput').value,
        database: document.getElementById('dbDatabaseInput').value
    };

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

// 添加数据库
async function handleAddDatabase(e) {
    e.preventDefault();

    const config = {
        name: document.getElementById('dbNameInput').value,
        host: document.getElementById('dbHostInput').value,
        port: parseInt(document.getElementById('dbPortInput').value),
        user: document.getElementById('dbUserInput').value,
        password: document.getElementById('dbPasswordInput').value,
        database: document.getElementById('dbDatabaseInput').value
    };

    const errorEl = document.getElementById('dbFormError');
    const successEl = document.getElementById('dbFormSuccess');
    errorEl.classList.remove('show');
    successEl.classList.remove('show');

    try {
        const response = await fetch(`${API_BASE}/api/data-ontology/databases`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('dataOntologyToken')}`
            },
            body: JSON.stringify(config)
        });

        const data = await response.json();

        if (data.success) {
            successEl.textContent = '数据库添加成功！';
            successEl.classList.add('show');
            setTimeout(() => {
                hideAddDbModal();
                loadDatabases();
            }, 1000);
        } else {
            errorEl.textContent = data.message || '添加失败';
            errorEl.classList.add('show');
        }
    } catch (error) {
        errorEl.textContent = '添加失败：' + error.message;
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

    listEl.innerHTML = databases.map(db => `
        <div class="db-item ${currentDb && currentDb.id === db.id ? 'active' : ''}" onclick="selectDatabase('${db.id}')">
            <div class="db-item-name">${db.name}</div>
            <div class="db-item-info">${db.host}:${db.port}</div>
        </div>
    `).join('');
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
            
            document.getElementById('dbName').textContent = data.database.name;
            document.getElementById('dbHost').textContent = data.database.host;
            document.getElementById('dbPort').textContent = data.database.port;
            
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

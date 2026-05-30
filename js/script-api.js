
// ===== 三列布局辅助函数 =====

// 重置第二列和第三列为占位提示（数据库被删除或切换时调用）。
function resetDbColumns() {
    const dbNameEl = document.getElementById('colTablesDbName');
    if (dbNameEl) dbNameEl.textContent = '数据表列表';
    const dbInfoEl = document.getElementById('colTablesDbInfo');
    if (dbInfoEl) dbInfoEl.textContent = '';
    const listEl = document.getElementById('tablesList');
    if (listEl) {
        listEl.innerHTML = '<div class="col-tables-placeholder"><div class="placeholder-icon">📂</div><p>← 请先选择数据库</p></div>';
    }
    resetDetailColumn();
}

// 重置第三列为占位提示（关闭表预览时调用）。
function resetDetailColumn() {
    currentPreviewTable = null;
    const nameEl = document.getElementById('previewTableName');
    if (nameEl) nameEl.textContent = '← 请先选择数据表';
    const contentEl = document.getElementById('previewContent');
    if (contentEl) {
        contentEl.innerHTML = '<div id="detailPlaceholder" class="col-detail-placeholder"><div class="placeholder-icon">📋</div><p>请先选择数据表查看详情</p></div>';
    }
}

// ===== 原有函数 =====

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
                    console.error(e); showToast('操作失败', 'error');
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
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases`);

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
                    resetDbColumns();
                }
            } else {
                // 无选中数据库时，设置第二列占位提示。
                resetDbColumns();
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
        const info = isFileDb ? (db.path || '未配置') : `${db.host || ''}:${db.port || ''}`;
        
        const isActive = !userMgmtMode && currentDb && currentDb.id === db.id;
        const safeDbId = escapeHtml(db.id);
        const safeName = escapeHtml(db.name);
        const safeInfo = escapeHtml(info);
        return `
            <div class="db-item ${isActive ? 'active' : ''}" onclick="selectDatabase('${safeDbId}')">
                <div class="db-item-name">${safeName}</div>
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
    
    // 更新第二列标题为加载状态。
    document.getElementById('colTablesDbName').innerHTML = '<span style="color:#718096;">加载中...</span>';
    document.getElementById('colTablesDbInfo').textContent = '';
    
    const listEl = document.getElementById('tablesList');
    listEl.innerHTML = `
        <div style="text-align:center;padding:40px;color:#718096;">
            <div class="loading-spinner"></div>
            <div style="margin-top:12px;">正在加载数据库详情...</div>
        </div>
    `;
    
    // 第三列重置为占位提示。
    resetDetailColumn();
}

// 加载数据库详情。
async function loadDatabaseDetail(dbId) {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${dbId}`);

        const data = await response.json();

        if (data.success) {
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
            const dbLabel = `${data.database.name} (${typeNames[data.database.type] || data.database.type})`;
            document.getElementById('colTablesDbName').textContent = dbLabel;
            
            // 第二列简要信息
            const host = isFileDb ? data.database.path : data.database.host;
            const port = isFileDb ? '-' : data.database.port;
            const status = data.database.connected ? '✅ 已连接' : '❌ 未连接';
            document.getElementById('colTablesDbInfo').innerHTML = `${host}${port !== '-' ? ':' + port : ''} · ${status}`;
            
            // 保存db信息供其他函数使用（兼容旧代码引用）
            window._currentDbInfo = data.database;
            
            renderTablesList(data.database.tables || []);
            resetDetailColumn();
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

// 折叠/展开列
function toggleColumn(columnId) {
    const column = document.getElementById(columnId);
    if (!column) return;
    
    column.classList.toggle('collapsed');
    
    // 保存折叠状态到 localStorage
    const collapsedState = {
        dbSidebar: document.getElementById('dbSidebar')?.classList.contains('collapsed'),
        tablesColumn: document.getElementById('tablesColumn')?.classList.contains('collapsed')
    };
    localStorage.setItem('dbColumnCollapsed', JSON.stringify(collapsedState));
}

// 恢复列折叠状态
function restoreColumnState() {
    try {
        const saved = localStorage.getItem('dbColumnCollapsed');
        if (saved) {
            const collapsedState = JSON.parse(saved);
            if (collapsedState.dbSidebar) {
                document.getElementById('dbSidebar')?.classList.add('collapsed');
            }
            if (collapsedState.tablesColumn) {
                document.getElementById('tablesColumn')?.classList.add('collapsed');
            }
        }
    } catch (e) {
        console.error('恢复列状态失败:', e);
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
        const isActive = currentPreviewTable === tableName;
        const activeClass = isActive ? ' active' : '';
        const displayName = escapeHtml(tableName);
        const commentTag = tableComment ? `<span class="table-comment">(${escapeHtml(tableComment)})</span>` : '';
        return `
            <div class="table-item${activeClass}" onclick="previewTable('${escapeHtml(tableName)}')" title="${escapeHtml(tableName)}${tableComment ? ' — '+escapeHtml(tableComment) : ''}">
                <span class="table-name">${displayName}</span>${commentTag}
            </div>
        `;
    }).join('');
    
    listEl.innerHTML = tablesHtml;
}

// 搜索过滤表列表。
function filterTables(keyword) {
    const items = document.querySelectorAll('.tables-list-col .table-item');
    const kw = keyword.toLowerCase().trim();
    items.forEach(item => {
        const name = item.getAttribute('title') || item.textContent || '';
        item.style.display = (!kw || name.toLowerCase().includes(kw)) ? '' : 'none';
    });
}

// 刷新当前数据库。
function refreshCurrentDb() {
    if (currentDb) {
        selectDatabase(currentDb.id);
    }
}

// 编辑数据库弹窗（复用现有modal）。
function showEditDbModal() {
    // 触发原有的编辑数据库弹窗
    const editBtn = document.getElementById('editDbBtn');
    if (editBtn) editBtn.click();
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

    // 加载数据表详情到第三列。
    const previewContent = document.getElementById('previewContent');
    previewContent.innerHTML = `
        <div style="text-align:center;padding:60px;color:#718096;">
            <div class="loading-spinner"></div>
            <div style="margin-top:16px;">正在加载表结构...</div>
        </div>
    `;

    // 高亮当前选中的表
    document.querySelectorAll('.tables-list-col .table-item').forEach(el => {
        el.classList.toggle('active', el.getAttribute('onclick')?.includes(`'${tableName}'`));
    });

    try {
        // 先加载字段结构。
        const structureResponse = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${tableName}/structure`);
        const structureData = await structureResponse.json();
        
        // 再加载表数据。
        const dataResponse = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${tableName}`);
        const data = await dataResponse.json();

        if (data.success) {
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
                const retryResp = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${encodeURIComponent(tableName)}/structure`);
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
        console.error('预览表格失败', error); showToast('预览表格失败', 'error');
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
        const structureResponse = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${encodeURIComponent(currentPreviewTable)}/structure`, {
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
    const actionsContainer = document.querySelector('#colTableDetail .detail-actions');
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

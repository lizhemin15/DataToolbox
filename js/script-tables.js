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
        const info = isFileDb ? (db.path || '未配置') : `${db.host || ''}:${db.port || ''}`;
        
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${dbId}`);

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
        const displayText = tableComment ? `${tableName} (${tableComment})` : tableName;
        return `
            <div class="table-item-compact${activeClass}" onclick="previewTable('${escapeHtml(tableName)}')" title="${escapeHtml(tableComment || tableName)}">
                ${escapeHtml(displayText)}
            </div>
        `;
    }).join('');
    
    listEl.innerHTML = tablesHtml;
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
        const structureResponse = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${tableName}/structure`);
        const structureData = await structureResponse.json();
        
        // 再加载表数据。
        const dataResponse = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${tableName}`);
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${currentPreviewTable}/data`, {
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${currentPreviewTable}`, {
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${currentPreviewTable}/structure`);
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${currentPreviewTable}/structure`, {
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${currentPreviewTable}/rename`, {
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}`, {
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/system/apikeys`);
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/system/apikeys`, {
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/system/apikeys`, {
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
    const banner = document.getElementById('apiKeyBanner');

    if (currentApiKey) {
        const masked = currentApiKey.substring(0, 8) + '********' + currentApiKey.substring(currentApiKey.length - 4);
        const safeKey = escapeHtml(currentApiKey);
        const safeMasked = escapeHtml(masked);
        contentEl.innerHTML = `<code class="apikey-value" title="${safeKey}">${safeMasked}</code>`;
        generateBtn.textContent = '重新生成';
        copyBtn.style.display = '';
        deleteBtn.style.display = '';
        if (banner) banner.style.display = 'none';
    } else {
        contentEl.innerHTML = '<span class="apikey-placeholder">未生成</span>';
        generateBtn.textContent = '生成';
        copyBtn.style.display = 'none';
        deleteBtn.style.display = 'none';
        if (banner) banner.style.display = 'flex';
    }
    updateMcpDisplay();
    initMcpSubTabs();
}

// MCP 配置展示与生成。
let mcpConfigEnabled = true;
let mcpConfigPort = 0;
async function loadMcpInfo() {
    await loadApiKey();
    try {
        const r = await fetchWithAuth(`${API_BASE}/api/v1/mcp/config`);
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
        const r = await fetchWithAuth(`${API_BASE}/api/v1/mcp/config`, {
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
        const r = await fetchWithAuth(`${API_BASE}/api/v1/mcp/safe-config`);
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
        const r = await fetchWithAuth(`${API_BASE}/api/v1/mcp/safe-config`, {
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

// 初始化 MCP 子标签切换
function initMcpSubTabs() {
    const subTabs = document.querySelectorAll('.mcp-sub-tab');
    subTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const subTab = this.getAttribute('data-subtab');
            
            // 切换按钮状态
            document.querySelectorAll('.mcp-sub-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            // 切换内容显示
            if (subTab === 'mcp') {
                document.getElementById('mcpSubTab').classList.add('active');
                document.getElementById('skillsSubTab').classList.remove('active');
            } else if (subTab === 'skills') {
                document.getElementById('mcpSubTab').classList.remove('active');
                document.getElementById('skillsSubTab').classList.add('active');
            }
        });
    });
}

// 安装技能
function installSkill(type) {
    const apiBase = API_BASE || window.location.origin;
    const token = localStorage.getItem('dataOntologyToken') || currentApiKey;
    
    fetch(apiBase + '/api/v1/skills/export?type=' + type, {
        headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            // 显示安装指引
            const guide = document.getElementById('skillInstallGuide');
            const title = document.getElementById('skillGuideTitle');
            const configPre = document.getElementById('skillConfigPre');
            const stepsList = document.getElementById('skillStepsList');
            
            guide.style.display = 'block';
            title.textContent = data.title + ' - ' + data.description;
            configPre.textContent = data.config;
            stepsList.innerHTML = data.steps.map(s => '<li>' + s + '</li>').join('');
            
            // 自动复制配置
            navigator.clipboard.writeText(data.config).then(() => {
                showToast('配置已复制到剪贴板', 'success');
            }).catch(() => {
                showToast('请手动复制配置', 'warning');
            });
        } else {
            showToast(data.message || '获取技能配置失败', 'error');
        }
    })
    .catch(err => {
        console.error('installSkill error:', err);
        showToast('获取技能配置失败', 'error');
    });
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

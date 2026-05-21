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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables`, {
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks`);
        const data = await response.json();
        if (data.success) {
            govTasks = data.tasks || [];
            if (currentGovTask) {
                const fresh = govTasks.find(t => t.id === currentGovTask.id);
                if (fresh) {
                    currentGovTask = fresh;
                    showGovTaskDetail(currentGovTask);
                    loadGovTaskLogs();
                    console.log('[loadGovernanceTasks] 更新任务:', fresh.name, 'status:', fresh.status);
                    if (currentGovTask.status === 'running') {
                        console.log('[loadGovernanceTasks] 任务状态为 running, 启动轮询');
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
                        console.log('[loadGovernanceTasks] 恢复任务:', t.name, 'status:', t.status);
                        if (currentGovTask.status === 'running') {
                            console.log('[loadGovernanceTasks] 任务状态为 running, 启动轮询');
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

    // 将 example_files 存入全局变量，供下载按钮使用
    window._govTaskExamples = window._govTaskExamples || {};
    govTasks.forEach(t => {
        if (t.example_files?.length) {
            window._govTaskExamples[t.id] = t.example_files;
        }
    });

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
            ${t.example_files && t.example_files.length ? `<button type="button" class="gov-example-btn" data-task-id="${safeTId}" data-task-name="${t.name ? t.name.replace(/"/g, '&quot;') : ''}" onclick="event.stopPropagation(); govDownloadExamplesForTask(this.dataset.taskId, ${JSON.stringify(t.example_files).replace(/"/g, '&quot;')}, this.dataset.taskName)">下载样例</button>` : ''}
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

    // 分享状态
    const shareItem = document.getElementById('govShareItem');
    const shareStatusEl = document.getElementById('govTaskShareStatus');
    const copyLinkBtn = document.getElementById('govCopyShareLinkBtn');
    const shareBtn = document.getElementById('shareGovTaskBtn');
    if (task.share_enabled) {
        shareItem.style.display = '';
        shareStatusEl.textContent = '已开启';
        shareStatusEl.style.color = '#28a745';
        copyLinkBtn.style.display = '';
        shareBtn.textContent = '🔗 关闭分享';
    } else {
        shareItem.style.display = 'none';
        copyLinkBtn.style.display = 'none';
        shareBtn.textContent = '🔗 分享';
    }

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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}/logs`);
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}/logs/${logId}`, {
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}/logs-clear`, {
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
    // 重置开放方式
    document.getElementById('govOpenShare').checked = false;
    document.getElementById('govOpenAPI').checked = false;
    document.getElementById('govAPIPathInput').value = '';
    document.getElementById('govAPIMethodInput').value = 'POST';
    document.getElementById('govShareConfig').style.display = 'none';
    document.getElementById('govAPIConfig').style.display = 'none';
    document.getElementById('govShareLinkInput').value = '';
    document.getElementById('govShareLinkRow').style.display = 'none';
    document.getElementById('govShareLinkPlaceholder').style.display = '';
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
    
    // 开放方式设置
    const openShare = document.getElementById('govOpenShare');
    const openAPI = document.getElementById('govOpenAPI');
    if (openShare) openShare.checked = currentGovTask.share_enabled || false;
    if (openAPI) openAPI.checked = currentGovTask.register_as_api || false;
    
    // API 配置
    document.getElementById('govAPIPathInput').value = currentGovTask.api_path || '';
    document.getElementById('govAPIMethodInput').value = currentGovTask.api_method || 'POST';
    
    // 分享链接
    if (currentGovTask.share_token) {
        const shareLink = `${window.location.origin}/share/${currentGovTask.share_token}`;
        document.getElementById('govShareLinkInput').value = shareLink;
        document.getElementById('govShareLinkRow').style.display = '';
        document.getElementById('govShareLinkPlaceholder').style.display = 'none';
    } else {
        document.getElementById('govShareLinkInput').value = '';
        document.getElementById('govShareLinkRow').style.display = 'none';
        document.getElementById('govShareLinkPlaceholder').style.display = '';
    }
    
    // 显示/隐藏配置面板
    document.getElementById('govShareConfig').style.display = currentGovTask.share_enabled ? '' : 'none';
    document.getElementById('govAPIConfig').style.display = currentGovTask.register_as_api ? '' : 'none';
    
    // 更新 API 示例
    if (currentGovTask.register_as_api) {
        updateAPIExample();
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

// 任务详情页 - 任务代码折叠切换
function toggleGovTaskCode() {
    const panel = document.getElementById('govTaskCodePanel');
    const arrow = document.getElementById('govTaskCodeArrow');
    if (!panel) return;
    if (panel.style.display === 'none') {
        panel.style.display = '';
        if (arrow) arrow.textContent = '▼';
    } else {
        panel.style.display = 'none';
        if (arrow) arrow.textContent = '▶';
    }
}

// 折叠块切换
function toggleGovCollapsible(headerEl) {
    const collapsible = headerEl.parentElement;
    const arrow = headerEl.querySelector('.gov-collapsible-arrow');
    if (collapsible.classList.contains('gov-collapsible-collapsed')) {
        collapsible.classList.remove('gov-collapsible-collapsed');
        collapsible.querySelector('.gov-collapsible-body').style.display = '';
        if (arrow) arrow.textContent = '▼';
    } else {
        collapsible.classList.add('gov-collapsible-collapsed');
        collapsible.querySelector('.gov-collapsible-body').style.display = 'none';
        if (arrow) arrow.textContent = '▶';
    }
}

// 提取中文拼音首字母。
function chineseToPinyinInitials(str) {
    // 常用汉字拼音首字母映射
    const pinyinMap = {
        // A
        '阿': 'a', '啊': 'a', '安': 'a', '按': 'a', '爱': 'a',
        // B
        '把': 'b', '白': 'b', '百': 'b', '板': 'b', '办': 'b', '半': 'b', '包': 'b', '保': 'b', '报': 'b', '北': 'b', '本': 'b', '比': 'b', '必': 'b', '边': 'b', '变': 'b', '表': 'b', '别': 'b', '宾': 'b', '并': 'b', '波': 'b', '博': 'b', '补': 'b', '不': 'b', '步': 'b', '部': 'b',
        // C
        '才': 'c', '材': 'c', '采': 'c', '参': 'c', '操': 'c', '测': 'c', '策': 'c', '查': 'c', '产': 'c', '常': 'c', '场': 'c', '车': 'c', '成': 'c', '程': 'c', '城': 'c', '承': 'c', '持': 'c', '充': 'c', '重': 'c', '出': 'c', '初': 'c', '除': 'c', '处': 'c', '传': 'c', '创': 'c', '窗': 'c', '春': 'c', '纯': 'c', '次': 'c', '聪': 'c', '从': 'c', '促': 'c', '存': 'c', '错': 'c',
        // D
        '达': 'd', '大': 'd', '代': 'd', '单': 'd', '但': 'd', '当': 'd', '到': 'd', '道': 'd', '得': 'd', '的': 'd', '等': 'd', '低': 'd', '底': 'd', '地': 'd', '第': 'd', '点': 'd', '电': 'd', '店': 'd', '定': 'd', '东': 'd', '冬': 'd', '动': 'd', '都': 'd', '读': 'd', '度': 'd', '短': 'd', '段': 'd', '对': 'd', '多': 'd',
        // E
        '而': 'e', '儿': 'e', '二': 'e',
        // F
        '发': 'f', '法': 'f', '反': 'f', '返': 'f', '范': 'f', '方': 'f', '防': 'f', '房': 'f', '放': 'f', '非': 'f', '费': 'f', '分': 'f', '丰': 'f', '风': 'f', '封': 'f', '否': 'f', '服': 'f', '福': 'f', '府': 'f', '复': 'f', '负': 'f', '附': 'f', '父': 'f', '付': 'f',
        // G
        '改': 'g', '盖': 'g', '干': 'g', '感': 'g', '刚': 'g', '高': 'g', '告': 'g', '格': 'g', '个': 'g', '给': 'g', '根': 'g', '更': 'g', '工': 'g', '公': 'g', '功': 'g', '共': 'g', '供': 'g', '构': 'g', '古': 'g', '股': 'g', '固': 'g', '故': 'g', '关': 'g', '观': 'g', '管': 'g', '光': 'g', '广': 'g', '规': 'g', '国': 'g', '过': 'g',
        // H
        '海': 'h', '含': 'h', '函': 'h', '汉': 'h', '行': 'h', '好': 'h', '号': 'h', '合': 'h', '何': 'h', '和': 'h', '河': 'h', '核': 'h', '黑': 'h', '很': 'h', '红': 'h', '后': 'h', '候': 'h', '互': 'h', '护': 'h', '花': 'h', '化': 'h', '话': 'h', '环': 'h', '黄': 'h', '回': 'h', '会': 'h', '汇': 'h', '婚': 'h', '活': 'h', '火': 'h', '获': 'h', '货': 'h', '基': 'j',
        // J
        '机': 'j', '积': 'j', '基': 'j', '级': 'j', '集': 'j', '及': 'j', '即': 'j', '极': 'j', '急': 'j', '计': 'j', '记': 'j', '技': 'j', '际': 'j', '济': 'j', '继': 'j', '加': 'j', '家': 'j', '价': 'j', '假': 'j', '间': 'j', '建': 'j', '健': 'j', '件': 'j', '检': 'j', '简': 'j', '见': 'j', '江': 'j', '将': 'j', '讲': 'j', '交': 'j', '教': 'j', '角': 'j', '脚': 'j', '叫': 'j', '接': 'j', '街': 'j', '节': 'j', '结': 'j', '解': 'j', '介': 'j', '界': 'j', '今': 'j', '金': 'j', '紧': 'j', '进': 'j', '近': 'j', '经': 'j', '精': 'j', '警': 'j', '境': 'j', '竞': 'j', '究': 'j', '酒': 'j', '旧': 'j', '就': 'j', '居': 'j', '局': 'j', '举': 'j', '巨': 'j', '具': 'j', '据': 'j', '距': 'j', '卷': 'j', '决': 'j', '绝': 'j', '均': 'j',
        // K
        '开': 'k', '看': 'k', '康': 'k', '考': 'k', '科': 'k', '可': 'k', '克': 'k', '客': 'k', '空': 'k', '控': 'k', '口': 'k', '快': 'k', '块': 'k', '况': 'k',
        // L
        '拉': 'l', '来': 'l', '蓝': 'l', '劳': 'l', '老': 'l', '乐': 'l', '类': 'l', '累': 'l', '冷': 'l', '离': 'l', '理': 'l', '力': 'l', '历': 'l', '立': 'l', '利': 'l', '连': 'l', '联': 'l', '脸': 'l', '练': 'l', '良': 'l', '两': 'l', '亮': 'l', '量': 'l', '料': 'l', '列': 'l', '林': 'l', '灵': 'l', '领': 'l', '令': 'l', '另': 'l', '流': 'l', '留': 'l', '六': 'l', '龙': 'l', '路': 'l', '录': 'l', '旅': 'l', '律': 'l', '绿': 'l', '乱': 'l', '论': 'l', '络': 'l', '落': 'l',
        // M
        '妈': 'm', '马': 'm', '码': 'm', '买': 'm', '卖': 'm', '满': 'm', '慢': 'm', '忙': 'm', '毛': 'm', '贸': 'm', '没': 'm', '每': 'm', '美': 'm', '门': 'm', '们': 'm', '米': 'm', '面': 'm', '民': 'm', '名': 'm', '明': 'm', '命': 'm', '模': 'm', '末': 'm', '母': 'm', '目': 'm',
        // N
        '南': 'n', '难': 'n', '内': 'n', '能': 'n', '你': 'n', '年': 'n', '念': 'n', '您': 'n', '农': 'n',
        // O
        '哦': 'o',
        // P
        '排': 'p', '判': 'p', '盘': 'p', '旁': 'p', '配': 'p', '朋': 'p', '批': 'p', '平': 'p', '凭': 'p', '评': 'p', '普': 'p',
        // Q
        '期': 'q', '七': 'q', '其': 'q', '奇': 'q', '起': 'q', '气': 'q', '企': 'q', '器': 'q', '千': 'q', '前': 'q', '钱': 'q', '签': 'q', '强': 'q', '情': 'q', '请': 'q', '求': 'q', '区': 'q', '曲': 'q', '去': 'q', '权': 'q', '全': 'q', '确': 'q', '群': 'q',
        // R
        '然': 'r', '让': 'r', '人': 'r', '任': 'r', '认': 'r', '日': 'r', '容': 'r', '入': 'r', '软': 'r',
        // S
        '三': 's', '色': 's', '森': 's', '山': 's', '商': 's', '上': 's', '少': 's', '社': 's', '设': 's', '申': 's', '身': 's', '深': 's', '神': 's', '生': 's', '声': 's', '胜': 's', '省': 's', '师': 's', '十': 's', '时': 's', '实': 's', '识': 's', '史': 's', '使': 's', '始': 's', '世': 's', '市': 's', '示': 's', '式': 's', '事': 's', '势': 's', '视': 's', '试': 's', '室': 's', '是': 's', '适': 's', '收': 's', '手': 's', '首': 's', '受': 's', '书': 's', '术': 's', '数': 's', '述': 's', '树': 's', '双': 's', '水': 's', '税': 's', '说': 's', '司': 's', '思': 's', '斯': 's', '死': 's', '四': 's', '似': 's', '送': 's', '速': 's', '算': 's', '随': 's', '岁': 's', '损': 's', '所': 's',
        // T
        '台': 't', '太': 't', '态': 't', '谈': 't', '探': 't', '特': 't', '提': 't', '题': 't', '体': 't', '天': 't', '条': 't', '调': 't', '铁': 't', '听': 't', '通': 't', '同': 't', '统': 't', '投': 't', '头': 't', '图': 't', '土': 't', '团': 't', '推': 't',
        // W
        '外': 'w', '完': 'w', '万': 'w', '网': 'w', '往': 'w', '忘': 'w', '望': 'w', '危': 'w', '为': 'w', '位': 'w', '委': 'w', '文': 'w', '问': 'w', '稳': 'w', '我': 'w', '无': 'w', '五': 'w', '物': 'w', '务': 'w', '误': 'w',
        // X
        '西': 'x', '希': 'x', '息': 'x', '系': 'x', '细': 'x', '席': 'x', '习': 'x', '喜': 'x', '下': 'x', '先': 'x', '显': 'x', '险': 'x', '县': 'x', '现': 'x', '线': 'x', '限': 'x', '相': 'x', '香': 'x', '想': 'x', '向': 'x', '项': 'x', '象': 'x', '消': 'x', '小': 'x', '效': 'x', '校': 'x', '些': 'x', '新': 'x', '心': 'x', '信': 'x', '星': 'x', '行': 'x', '形': 'x', '型': 'x', '性': 'x', '姓': 'x', '修': 'x', '秀': 'x', '需': 'x', '许': 'x', '选': 'x', '学': 'x', '血': 'x', '讯': 'x', '讯': 'x',
        // Y
        '压': 'y', '亚': 'y', '言': 'y', '研': 'y', '颜': 'y', '眼': 'y', '演': 'y', '验': 'y', '央': 'y', '扬': 'y', '阳': 'y', '样': 'y', '要': 'y', '也': 'y', '业': 'y', '叶': 'y', '页': 'y', '一': 'y', '医': 'y', '依': 'y', '仪': 'y', '宜': 'y', '已': 'y', '以': 'y', '意': 'y', '义': 'y', '议': 'y', '益': 'y', '因': 'y', '引': 'y', '印': 'y', '英': 'y', '应': 'y', '营': 'y', '迎': 'y', '影': 'y', '硬': 'y', '用': 'y', '优': 'y', '由': 'y', '油': 'y', '游': 'y', '有': 'y', '友': 'y', '右': 'y', '于': 'y', '余': 'y', '与': 'y', '语': 'y', '育': 'y', '预': 'y', '元': 'y', '原': 'y', '源': 'y', '远': 'y', '院': 'y', '约': 'y', '月': 'y', '阅': 'y', '越': 'y', '云': 'y', '运': 'y',
        // Z
        '杂': 'z', '在': 'z', '载': 'z', '赞': 'z', '早': 'z', '造': 'z', '责': 'z', '则': 'z', '增': 'z', '展': 'z', '站': 'z', '张': 'z', '章': 'z', '长': 'z', '找': 'z', '照': 'z', '这': 'z', '真': 'z', '争': 'z', '正': 'z', '证': 'z', '支': 'z', '知': 'z', '直': 'z', '指': 'z', '制': 'z', '质': 'z', '中': 'z', '终': 'z', '种': 'z', '重': 'z', '周': 'z', '主': 'z', '注': 'z', '专': 'z', '转': 'z', '赚': 'z', '准': 'z', '资': 'z', '子': 'z', '字': 'z', '自': 'z', '综': 'z', '总': 'z', '走': 'z', '组': 'z', '最': 'z', '左': 'z', '作': 'z', '做': 'z'
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
    // 已废弃，改用 onGovOpenModeChange
}

// 开放方式切换
function onGovOpenModeChange() {
    const openShare = document.getElementById('govOpenShare').checked;
    const openAPI = document.getElementById('govOpenAPI').checked;
    
    // 显示/隐藏分享配置
    document.getElementById('govShareConfig').style.display = openShare ? '' : 'none';
    
    // 显示/隐藏 API 配置
    document.getElementById('govAPIConfig').style.display = openAPI ? '' : 'none';
    
    // 如果启用分享，自动生成分享链接（如果没有）
    if (openShare && !document.getElementById('govShareLinkInput').value) {
        const shareToken = generateShareToken();
        const shareLink = `${window.location.origin}/share/${shareToken}`;
        document.getElementById('govShareLinkInput').value = shareLink;
        document.getElementById('govShareLinkInput').dataset.token = shareToken;
        document.getElementById('govShareLinkRow').style.display = '';
        document.getElementById('govShareLinkPlaceholder').style.display = 'none';
    }
    
    // 如果启用 API，自动生成路径并更新示例（如果没有）
    if (openAPI && !document.getElementById('govAPIPathInput').value) {
        const taskName = document.getElementById('govTaskNameInput').value.trim();
        if (taskName) {
            const initials = chineseToPinyinInitials(taskName);
            document.getElementById('govAPIPathInput').value = `/api/v1/gov/tasks/${initials}`;
        }
    }
    
    if (openAPI) {
        updateAPIExample();
    }
}

// 生成分享 token
function generateShareToken() {
    // 生成 8 位随机字符串
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 8; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
}

// 从分享链接中提取 token
function extractShareToken() {
    const linkInput = document.getElementById('govShareLinkInput');
    const link = linkInput.value.trim();
    if (!link) return '';
    
    // 如果有 dataset.token，直接返回
    if (linkInput.dataset.token) {
        return linkInput.dataset.token;
    }
    
    // 从链接中提取：/share/xxxxxxxx
    const match = link.match(/\/share\/([a-z0-9-]+)/);
    if (match) {
        return match[1];
    }
    
    // 如果链接格式不对，尝试直接作为 token
    return link;
}

// 分享链接变化时更新 dataset.token
function onShareLinkChange() {
    const linkInput = document.getElementById('govShareLinkInput');
    const link = linkInput.value.trim();
    
    // 从链接中提取 token
    const match = link.match(/\/share\/([a-z0-9-]+)/);
    if (match) {
        linkInput.dataset.token = match[1];
    } else if (link) {
        // 直接作为 token
        linkInput.dataset.token = link;
    }
}

// 检查路径冲突
function checkPathConflicts(shareToken, apiPath, currentTaskId) {
    const conflicts = [];
    
    if (shareToken) {
        for (const task of govTasks) {
            if (task.id === currentTaskId) continue;
            if (task.share_token === shareToken) {
                conflicts.push({
                    type: 'share_token',
                    value: shareToken,
                    taskName: task.name
                });
            }
        }
    }
    
    if (apiPath) {
        for (const task of govTasks) {
            if (task.id === currentTaskId) continue;
            if (task.api_path === apiPath) {
                conflicts.push({
                    type: 'api_path',
                    value: apiPath,
                    taskName: task.name
                });
            }
        }
    }
    
    return conflicts;
}

// 复制分享链接
function copyGovShareLink() {
    const link = document.getElementById('govShareLinkInput').value;
    if (!link) {
        showToast('分享链接不存在', 'error');
        return;
    }
    navigator.clipboard.writeText(link).then(() => {
        showToast('分享链接已复制', 'success');
    }).catch(err => {
        console.error('复制失败:', err);
        showToast('复制失败', 'error');
    });
}

// API 示例相关函数
let currentAPILang = 'curl';

function switchAPILang(lang) {
    currentAPILang = lang;
    document.querySelectorAll('.gov-api-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.lang === lang);
    });
    updateAPIExample();
}

function updateAPIExample() {
    const apiPath = document.getElementById('govAPIPathInput').value || '/api/v1/gov/tasks/my-task';
    const method = document.getElementById('govAPIMethodInput').value || 'POST';
    const inputType = document.getElementById('govInputTypeSelect')?.value || 'file';
    const taskName = document.getElementById('govTaskNameInput').value || '我的任务';
    
    const code = generateAPIExampleCode(apiPath, method, inputType, taskName);
    document.getElementById('govAPIExampleCode').textContent = code;
}

function generateAPIExampleCode(apiPath, method, inputType, taskName) {
    const host = 'HOST';
    
    const examples = {
        curl: generateCurlExample(apiPath, method, inputType, host),
        python: generatePythonExample(apiPath, method, inputType, host),
        javascript: generateJavaScriptExample(apiPath, method, inputType, host),
        go: generateGoExample(apiPath, method, inputType, host)
    };
    
    return examples[currentAPILang] || examples.curl;
}

function generateCurlExample(apiPath, method, inputType, host) {
    let code = `# ${method} 请求调用任务\n`;
    code += `curl -X ${method} "${host}${apiPath}" \\\n`;
    
    if (method === 'POST') {
        if (inputType === 'file' || inputType === 'both') {
            code += `  -F "files=@/path/to/your/file.docx" \\\n`;
            code += `  -F "files=@/path/to/another/file.xlsx"\n\n`;
            code += `# JSON 参数方式（如果任务接受参数）\n`;
            code += `curl -X POST "${host}${apiPath}" \\\n`;
            code += `  -H "Content-Type: application/json" \\\n`;
            code += `  -d '{"param1": "value1", "param2": "value2"}'\n\n`;
            code += `# 同时上传文件和参数\n`;
            code += `curl -X POST "${host}${apiPath}" \\\n`;
            code += `  -F "files=@/path/to/file.docx" \\\n`;
            code += `  -F "options={\"mode\":\"fast\",\"output\":\"pdf\"}"`;
        } else {
            code += `  -H "Content-Type: application/json" \\\n`;
            code += `  -d '{"param1": "value1", "param2": "value2"}'`;
        }
    } else {
        code += `  # GET 请求通过 URL 参数传递\n`;
        code += `  "?param1=value1&param2=value2"`;
    }
    
    return code;
}

function generatePythonExample(apiPath, method, inputType, host) {
    let code = `import requests\n\n`;
    code += `HOST = "${host}"\n\n`;
    
    if (method === 'POST') {
        if (inputType === 'file' || inputType === 'both') {
            code += `# 上传文件调用任务\n`;
            code += `def call_task_with_files(file_paths, params=None):\n`;
            code += `    url = f"{HOST}${apiPath}"\n`;
            code += `    \n`;
            code += `    # 准备文件\n`;
            code += `    files = [("files", open(fp, "rb")) for fp in file_paths]\n`;
            code += `    \n`;
            code += `    # 准备参数\n`;
            code += `    data = {"options": str(params)} if params else None\n`;
            code += `    \n`;
            code += `    try:\n`;
            code += `        response = requests.post(url, files=files, data=data)\n`;
            code += `        return response.json()\n`;
            code += `    finally:\n`;
            code += `        for _, f in files:\n`;
            code += `            f.close()\n\n`;
            code += `# 使用示例\n`;
            code += `result = call_task_with_files(\n`;
            code += `    ["/path/to/file1.docx", "/path/to/file2.xlsx"],\n`;
            code += `    {"mode": "fast"}\n`;
            code += `)\n`;
            code += `print(result)\n\n`;
            code += `# JSON 参数方式（如果任务接受参数）\n`;
            code += `def call_task_with_json(params):\n`;
            code += `    url = f"{HOST}${apiPath}"\n`;
            code += `    headers = {"Content-Type": "application/json"}\n`;
            code += `    response = requests.post(url, headers=headers, json=params)\n`;
            code += `    return response.json()\n\n`;
            code += `result = call_task_with_json({"param1": "value1"})\n`;
            code += `print(result)`;
        } else {
            code += `# JSON 参数调用任务\n`;
            code += `def call_task(params):\n`;
            code += `    url = f"{HOST}${apiPath}"\n`;
            code += `    headers = {"Content-Type": "application/json"}\n`;
            code += `    response = requests.post(url, headers=headers, json=params)\n`;
            code += `    return response.json()\n\n`;
            code += `result = call_task({"param1": "value1"})\n`;
            code += `print(result)`;
        }
    } else {
        code += `# GET 请求调用任务\n`;
        code += `def call_task(params):\n`;
        code += `    url = f"{HOST}${apiPath}"\n`;
        code += `    response = requests.get(url, params=params)\n`;
        code += `    return response.json()\n\n`;
        code += `result = call_task({"param1": "value1"})\n`;
        code += `print(result)`;
    }
    
    return code;
}

function generateJavaScriptExample(apiPath, method, inputType, host) {
    let code = `const HOST = '${host}';\n\n`;
    
    if (method === 'POST') {
        if (inputType === 'file' || inputType === 'both') {
            code += `// 上传文件调用任务\n`;
            code += `async function callTaskWithFiles(files, params = {}) {\n`;
            code += `  const formData = new FormData();\n`;
            code += `  \n`;
            code += `  // 添加文件\n`;
            code += `  for (const file of files) {\n`;
            code += `    formData.append('files', file);\n`;
            code += `  }\n`;
            code += `  \n`;
            code += `  // 添加参数\n`;
            code += `  if (Object.keys(params).length > 0) {\n`;
            code += `    formData.append('options', JSON.stringify(params));\n`;
            code += `  }\n`;
            code += `  \n`;
            code += `  const response = await fetch(\`\${HOST}${apiPath}\`, {\n`;
            code += `    method: 'POST',\n`;
            code += `    body: formData\n`;
            code += `  });\n`;
            code += `  \n`;
            code += `  return response.json();\n`;
            code += `}\n\n`;
            code += `// 使用示例（浏览器环境）\n`;
            code += `const fileInput = document.querySelector('input[type="file"]');\n`;
            code += `const result = await callTaskWithFiles(\n`;
            code += `  fileInput.files,\n`;
            code += `  { mode: 'fast' }\n`;
            code += `);\n`;
            code += `console.log(result);\n\n`;
            code += `// JSON 参数方式\n`;
            code += `async function callTaskWithJson(params) {\n`;
            code += `  const response = await fetch(\`\${HOST}${apiPath}\`, {\n`;
            code += `    method: 'POST',\n`;
            code += `    headers: {\n`;
            code += `      'Content-Type': 'application/json'\n`;
            code += `    },\n`;
            code += `    body: JSON.stringify(params)\n`;
            code += `  });\n`;
            code += `  return response.json();\n`;
            code += `}`;
        } else {
            code += `// JSON 参数调用任务\n`;
            code += `async function callTask(params) {\n`;
            code += `  const response = await fetch(\`\${HOST}${apiPath}\`, {\n`;
            code += `    method: 'POST',\n`;
            code += `    headers: {\n`;
            code += `      'Content-Type': 'application/json'\n`;
            code += `    },\n`;
            code += `    body: JSON.stringify(params)\n`;
            code += `  });\n`;
            code += `  return response.json();\n`;
            code += `}\n\n`;
            code += `const result = await callTask({ param1: 'value1' });\n`;
            code += `console.log(result);`;
        }
    } else {
        code += `// GET 请求调用任务\n`;
        code += `async function callTask(params) {\n`;
        code += `  const url = new URL(\`\${HOST}${apiPath}\`);\n`;
        code += `  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));\n`;
        code += `  \n`;
        code += `  const response = await fetch(url);\n`;
        code += `  return response.json();\n`;
        code += `}\n\n`;
        code += `const result = await callTask({ param1: 'value1' });\n`;
        code += `console.log(result);`;
    }
    
    return code;
}

function generateGoExample(apiPath, method, inputType, host) {
    let code = `package main\n\n`;
    code += `import (\n`;
    code += `    "bytes"\n`;
    code += `    "encoding/json"\n`;
    code += `    "fmt"\n`;
    code += `    "io"\n`;
    code += `    "mime/multipart"\n`;
    code += `    "net/http"\n`;
    code += `    "os"\n`;
    code += `)\n\n`;
    code += `const host = "${host}"\n\n`;
    
    if (method === 'POST') {
        if (inputType === 'file' || inputType === 'both') {
            code += `// 上传文件调用任务\n`;
            code += `func callTaskWithFiles(filePaths []string, params map[string]interface{}) (map[string]interface{}, error) {\n`;
            code += `    var buf bytes.Buffer\n`;
            code += `    writer := multipart.NewWriter(&buf)\n\n`;
            code += `    // 添加文件\n`;
            code += `    for _, path := range filePaths {\n`;
            code += `        file, err := os.Open(path)\n`;
            code += `        if err != nil {\n`;
            code += `            return nil, err\n`;
            code += `        }\n`;
            code += `        defer file.Close()\n\n`;
            code += `        part, err := writer.CreateFormFile("files", path)\n`;
            code += `        if err != nil {\n`;
            code += `            return nil, err\n`;
            code += `        }\n`;
            code += `        io.Copy(part, file)\n`;
            code += `    }\n\n`;
            code += `    // 添加参数\n`;
            code += `    if len(params) > 0 {\n`;
            code += `        paramsJSON, _ := json.Marshal(params)\n`;
            code += `        writer.WriteField("options", string(paramsJSON))\n`;
            code += `    }\n\n`;
            code += `    writer.Close()\n\n`;
            code += `    req, _ := http.NewRequest("POST", host+"${apiPath}", &buf)\n`;
            code += `    req.Header.Set("Content-Type", writer.FormDataContentType())\n\n`;
            code += `    resp, err := http.DefaultClient.Do(req)\n`;
            code += `    if err != nil {\n`;
            code += `        return nil, err\n`;
            code += `    }\n`;
            code += `    defer resp.Body.Close()\n\n`;
            code += `    var result map[string]interface{}\n`;
            code += `    json.NewDecoder(resp.Body).Decode(&result)\n`;
            code += `    return result, nil\n`;
            code += `}\n\n`;
            code += `func main() {\n`;
            code += `    result, err := callTaskWithFiles(\n`;
            code += `        []string{"/path/to/file1.docx", "/path/to/file2.xlsx"},\n`;
            code += `        map[string]interface{}{"mode": "fast"},\n`;
            code += `    )\n`;
            code += `    if err != nil {\n`;
            code += `        panic(err)\n`;
            code += `    }\n`;
            code += `    fmt.Printf("%+v\\n", result)\n`;
            code += `}`;
        } else {
            code += `// JSON 参数调用任务\n`;
            code += `func callTask(params map[string]interface{}) (map[string]interface{}, error) {\n`;
            code += `    body, _ := json.Marshal(params)\n`;
            code += `    req, _ := http.NewRequest("POST", host+"${apiPath}", bytes.NewReader(body))\n`;
            code += `    req.Header.Set("Content-Type", "application/json")\n\n`;
            code += `    resp, err := http.DefaultClient.Do(req)\n`;
            code += `    if err != nil {\n`;
            code += `        return nil, err\n`;
            code += `    }\n`;
            code += `    defer resp.Body.Close()\n\n`;
            code += `    var result map[string]interface{}\n`;
            code += `    json.NewDecoder(resp.Body).Decode(&result)\n`;
            code += `    return result, nil\n`;
            code += `}\n\n`;
            code += `func main() {\n`;
            code += `    result, _ := callTask(map[string]interface{}{"param1": "value1"})\n`;
            code += `    fmt.Printf("%+v\\n", result)\n`;
            code += `}`;
        }
    } else {
        code += `// GET 请求调用任务\n`;
        code += `func callTask(params map[string]string) (map[string]interface{}, error) {\n`;
        code += `    req, _ := http.NewRequest("GET", host+"${apiPath}", nil)\n\n`;
        code += `    q := req.URL.Query()\n`;
        code += `    for k, v := range params {\n`;
        code += `        q.Add(k, v)\n`;
        code += `    }\n`;
        code += `    req.URL.RawQuery = q.Encode()\n\n`;
        code += `    resp, err := http.DefaultClient.Do(req)\n`;
        code += `    if err != nil {\n`;
        code += `        return nil, err\n`;
        code += `    }\n`;
        code += `    defer resp.Body.Close()\n\n`;
        code += `    var result map[string]interface{}\n`;
        code += `    json.NewDecoder(resp.Body).Decode(&result)\n`;
        code += `    return result, nil\n`;
        code += `}\n\n`;
        code += `func main() {\n`;
        code += `    result, _ := callTask(map[string]string{"param1": "value1"})\n`;
        code += `    fmt.Printf("%+v\\n", result)\n`;
        code += `}`;
    }
    
    return code;
}

function copyAPIExample() {
    const code = document.getElementById('govAPIExampleCode').textContent;
    navigator.clipboard.writeText(code).then(() => {
        showToast('已复制到剪贴板', 'success');
    }).catch(err => {
        console.error('复制失败:', err);
        // 降级方案
        const textarea = document.createElement('textarea');
        textarea.value = code;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('已复制到剪贴板', 'success');
    });
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
    const openShare = document.getElementById('govOpenShare').checked;
    const openAPI = document.getElementById('govOpenAPI').checked;
    const runMode = document.getElementById('govRunModeSelect') ? document.getElementById('govRunModeSelect').value : (currentGovTask?.run_mode || 'backend');
    
    // 提取 share_token 和 api_path
    let shareToken = openShare ? extractShareToken() : '';
    let apiPath = openAPI ? document.getElementById('govAPIPathInput').value.trim() : '';
    
    // 冲突检测：自动重新生成直到不冲突
    let attempts = 0;
    const maxAttempts = 10;
    while (attempts < maxAttempts) {
        const conflicts = checkPathConflicts(shareToken, apiPath, editingGovTaskId);
        if (conflicts.length === 0) break;
        
        attempts++;
        for (const conflict of conflicts) {
            if (conflict.type === 'share_token') {
                // 自动重新生成 share_token
                shareToken = generateShareToken();
                const shareLink = `${window.location.origin}/share/${shareToken}`;
                document.getElementById('govShareLinkInput').value = shareLink;
                document.getElementById('govShareLinkInput').dataset.token = shareToken;
                showToast(`分享 token 已冲突，自动重新生成: ${shareToken}`, 'info');
            } else if (conflict.type === 'api_path') {
                // 自动重新生成 api_path
                const taskName = document.getElementById('govTaskNameInput').value.trim();
                const initials = chineseToPinyinInitials(taskName);
                apiPath = `/api/v1/gov/tasks/${initials}-${generateShareToken().substring(0, 4)}`;
                document.getElementById('govAPIPathInput').value = apiPath;
                updateAPIExample();
                showToast(`API 路径已冲突，自动重新生成: ${apiPath}`, 'info');
            }
        }
    }
    
    if (attempts >= maxAttempts) {
        document.getElementById('govFormError').textContent = '无法生成唯一的路径，请手动修改';
        document.getElementById('govFormError').classList.add('show');
        return;
    }
    
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
        share_enabled: openShare,
        share_token: shareToken,
        register_as_api: openAPI,
        api_path: apiPath,
        api_method: openAPI ? document.getElementById('govAPIMethodInput').value : 'POST',
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
            ? `${API_BASE}/api/v1/gov/tasks/${editingGovTaskId}`
            : `${API_BASE}/api/v1/gov/tasks`;
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
            // 构建成功消息
            let successMsg = isEditGovMode ? '已保存' : '已创建';
            if (taskData.register_as_api && taskData.api_path) {
                successMsg += `，API 已注册：${taskData.api_path}`;
            }
            if (taskData.share_enabled) {
                successMsg += '，分享已开启';
            }
            document.getElementById('govFormSuccess').textContent = successMsg;
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

// 分享任务
async function toggleShareGovTask() {
    if (!currentGovTask) return;
    const shareBtn = document.getElementById('shareGovTaskBtn');
    const originalText = shareBtn.textContent;
    shareBtn.disabled = true;
    
    try {
        const isShared = currentGovTask.share_enabled;
        const method = isShared ? 'DELETE' : 'POST';
        const response = await fetchWithAuth(
            `${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}/share`,
            { method }
        );
        const data = await response.json();
        if (data.success) {
            currentGovTask.share_enabled = !isShared;
            currentGovTask.share_token = data.share_token || '';
            showGovTaskDetail(currentGovTask);
            // 同步编辑界面的 checkbox 状态
            const openShare = document.getElementById('govOpenShare');
            if (openShare) openShare.checked = currentGovTask.share_enabled;
            // 同步编辑界面的分享配置面板显示
            const shareConfig = document.getElementById('govShareConfig');
            if (shareConfig) shareConfig.style.display = currentGovTask.share_enabled ? '' : 'none';
            showToast(isShared ? '已关闭分享' : '已开启分享', 'success');
        } else {
            showToast(data.message || '操作失败', 'error');
        }
    } catch (error) {
        console.error('分享操作失败', error);
        showToast('分享操作失败', 'error');
    } finally {
        shareBtn.disabled = false;
    }
}

function copyGovShareLink() {
    if (!currentGovTask || !currentGovTask.share_token) {
        showToast('未开启分享', 'error');
        return;
    }
    const url = `${window.location.origin}/share/${currentGovTask.share_token}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            showToast('分享链接已复制', 'success');
        }).catch(e => {
            console.error('复制失败', e);
            fallbackCopy(url);
        });
    } else {
        fallbackCopy(url);
    }
}

function fallbackCopy(text) {
    const input = document.createElement('input');
    input.value = text;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.select();
    try {
        document.execCommand('copy');
        showToast('分享链接已复制', 'success');
    } catch (e) {
        showToast('复制失败，请手动复制: ' + text, 'error');
    }
    document.body.removeChild(input);
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}`, {
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
        await executeGovTaskInBrowser(currentGovTask.js_code, null, '', []);
        return;
    }

    await executeGovTaskOnBackend([], '');
}

async function toggleGovTask() {
    if (!currentGovTask) return;
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}/toggle`, {
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
    console.log('[refreshGovTaskStatus] 开始刷新, 当前状态:', currentGovTask.status);
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}`);
        const data = await response.json();
        if (data.success && data.task) {
            console.log('[refreshGovTaskStatus] 后端返回状态:', data.task.status);
            const idx = govTasks.findIndex(t => t.id === data.task.id);
            if (idx >= 0) govTasks[idx] = data.task;
            currentGovTask = data.task;
            showGovTaskDetail(data.task);
            renderGovTaskList();
            loadGovTaskLogs();
            if (data.task.status === 'running') {
                console.log('[refreshGovTaskStatus] 状态仍为 running, 3秒后继续轮询');
                setTimeout(refreshGovTaskStatus, 3000);
            } else {
                console.log('[refreshGovTaskStatus] 任务已结束, 停止轮询');
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
        await executeGovTaskInBrowser(currentGovTask.js_code, files[0] || null, inputText, files);
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

    // 前端执行完成后，通知后端保存结果并同步到分享页
    try {
        // 如果有文件且任务开启了分享，用 FormData 上传文件
        if (files && files.length > 0 && currentGovTask.share_enabled && currentGovTask.share_token) {
            const formData = new FormData();
            formData.append('status', status);
            formData.append('output', output || '');
            formData.append('error', errorMsg || '');
            formData.append('input_text', inputText || '');
            formData.append('share_enabled', 'true');
            formData.append('share_token', currentGovTask.share_token);
            // 传 input_files 文件名数组，后端需要用这个来记录
            const inputFileNames = files.map(f => f.name || f);
            formData.append('input_files', JSON.stringify(inputFileNames));
            for (const f of files) {
                if (f instanceof File) {
                    formData.append('files', f);
                }
            }
            await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}/frontend-run`, {
                method: 'POST',
                body: formData
            });
        } else {
            // 无文件或未开启分享，只传 JSON
            const inputFileNames = files ? files.map(f => f.name || f) : [];
            const shareEnabled = currentGovTask.share_enabled ? true : false;
            await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}/frontend-run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: status,
                    output: output,
                    error: errorMsg,
                    input_text: inputText,
                    input_files: inputFileNames,
                    share_enabled: shareEnabled,
                    share_token: currentGovTask.share_token || ''
                })
            });
        }
    } catch (e) {
        console.warn('同步前端执行结果到后端失败:', e);
    }
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
        const response = await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${taskId}/run`, {
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
            console.log('[pollTaskProgress] 轮询中...');
            const response = await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${taskId}/progress`);
            const data = await response.json();

            if (!data.success) {
                console.error('获取进度失败:', data.message);
                return;
            }

            const { status, percent, processed_files, total_files, current_file, last_output, last_error } = data;
            console.log('[pollTaskProgress] status:', status, 'percent:', percent);

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

            // 任务已结束，更新状态并刷新详情
            if (status !== 'running') {
                console.log('[pollTaskProgress] 任务已结束, status:', status);
                // 直接更新 currentGovTask 和 govTasks 数组，避免 loadGovernanceTasks 触发额外的轮询
                if (currentGovTask && currentGovTask.id === taskId) {
                    currentGovTask.status = status;
                    currentGovTask.percent = percent;
                    currentGovTask.last_output = last_output;
                    currentGovTask.last_error = last_error;
                    currentGovTask.last_run_at = new Date().toISOString();
                    const idx = govTasks.findIndex(t => t.id === taskId);
                    if (idx >= 0) govTasks[idx] = currentGovTask;
                    showGovTaskDetail(currentGovTask);
                    renderGovTaskList();
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
        const resp = await fetchWithAuth(`${API_BASE}/api/v1/gov/execute-sql`, {
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

    /**
     * 解析格式化文本语法
     * 支持语法：
     *   **文字** - 加粗
     *   >文字 - 首行缩进 2 字符
     *   [f:字体,s:字号] - 指定字体和字号（可选，可嵌套）
     * @param {string} str - 输入字符串
     * @param {Object} defaultFont - 默认字体配置 {name: string, size: number}
     * @returns {{text: string, bold: Array<[number, number]>, indent: boolean, fonts: Array<[number, number, string, number]>}}
     */
    function parseFormatText(str, defaultFont = null) {
        if (typeof str !== 'string') return { text: String(str ?? ''), bold: [], indent: false, fonts: [] };

        let indent = false;
        let text = str;

        // 检测首行缩进语法（行首的 >）
        if (text.startsWith('>')) {
            indent = true;
            text = text.slice(1);
        }

        // 解析字体字号标记 [f:字体,s:字号]
        const fontMarkers = [];
        const fontRegex = /\[f:([^,\]]+),s:(\d+)\]/g;
        let fontMatch;
        while ((fontMatch = fontRegex.exec(text)) !== null) {
            const fontName = fontMatch[1].trim();
            const fontSize = parseInt(fontMatch[2], 10);
            const markerStart = fontMatch.index;
            const markerLength = fontMatch[0].length;

            // 找到标记后的文字（直到下一个标记或字符串结束）
            const afterMarker = text.slice(markerStart + markerLength);
            const nextMarker = afterMarker.search(/\[f:|$/);
            const contentLength = nextMarker === -1 ? afterMarker.length : nextMarker;

            fontMarkers.push({
                markerStart,
                markerLength,
                fontName,
                fontSize,
                contentLength
            });
        }

        // 移除字体标记，计算最终文本
        let textWithoutFontMarkers = text.replace(fontRegex, '');

        // 计算字体标记在移除标记后的文本中的位置
        const fonts = [];
        let offsetAdjustment = 0;
        for (const marker of fontMarkers) {
            const adjustedStart = marker.markerStart - offsetAdjustment;
            fonts.push([adjustedStart, adjustedStart + marker.contentLength, marker.fontName, marker.fontSize]);
            offsetAdjustment += marker.markerLength;
        }

        // 解析加粗语法 **文字**
        const bold = [];
        const result = [];
        let i = 0;
        text = textWithoutFontMarkers;
        while (i < text.length) {
            if (text[i] === '*' && text[i + 1] === '*') {
                // 找到结束的 **
                const end = text.indexOf('**', i + 2);
                if (end !== -1) {
                    const boldText = text.slice(i + 2, end);
                    const startOffset = result.length;
                    result.push(boldText);
                    bold.push([startOffset, startOffset + boldText.length]);
                    i = end + 2;
                } else {
                    // 没有结束符，保留原样
                    result.push(text[i]);
                    i++;
                }
            } else {
                result.push(text[i]);
                i++;
            }
        }

        const finalText = result.join('');

        // 调整字体位置（因为加粗标记也被移除了）
        const adjustedFonts = fonts.map(([start, end, name, size]) => {
            // 计算加粗标记移除后的位置调整
            let boldAdjustment = 0;
            let pos = 0;
            for (const [boldStart, boldEnd] of bold) {
                if (boldStart <= start) {
                    boldAdjustment += 2; // 开始的 **
                }
                if (boldEnd <= end) {
                    boldAdjustment += 2; // 结束的 **
                }
            }
            return [start - boldAdjustment, end - boldAdjustment, name, size];
        });

        return { text: finalText, bold, indent, fonts: adjustedFonts, defaultFont: defaultFont || { name: '仿宋_GB2312', size: 16 } };
    }

    /**
     * 检查数据中是否包含格式标记
     * @param {any} data - 数据对象
     * @returns {boolean}
     */
    function _hasFormatMarkers(data) {
        if (!data || typeof data !== 'object') return false;
        for (const value of Object.values(data)) {
            if (typeof value === 'string') {
                if (value.includes('**') || value.startsWith('>') || value.includes('[f:')) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 对 docx XML 应用格式化
     * @param {string} xmlContent - word/document.xml 内容
     * @param {Object} formatMap - 格式映射 {占位符: {text, bold, indent, fonts, defaultFont}}
     * @returns {string} - 处理后的 XML
     */
    function _applyDocxFormatting(xmlContent, formatMap) {
        if (!formatMap || Object.keys(formatMap).length === 0) return xmlContent;

        // 解析 XML
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'application/xml');

        // Word 命名空间
        const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

        // 查找所有文本节点
        const textNodes = doc.getElementsByTagNameNS(NS_W, 't');

        for (let i = 0; i < textNodes.length; i++) {
            const tNode = textNodes[i];
            const textContent = tNode.textContent || '';

            // 查找匹配的格式规则
            let matchedFormat = null;
            for (const [key, format] of Object.entries(formatMap)) {
                if (textContent.includes(format.text)) {
                    matchedFormat = format;
                    break;
                }
            }

            if (!matchedFormat) continue;

            const rNode = tNode.parentNode; // <w:r>
            if (!rNode || rNode.localName !== 'r') continue;

            const pNode = rNode.parentNode; // <w:p>
            if (!pNode || pNode.localName !== 'p') continue;

            // 默认字体配置
            const defaultFont = matchedFormat.defaultFont || { name: '仿宋_GB2312', size: 16 };

            // 处理首行缩进
            if (matchedFormat.indent) {
                let pPr = pNode.getElementsByTagNameNS(NS_W, 'pPr')[0];
                if (!pPr) {
                    pPr = doc.createElementNS(NS_W, 'w:pPr');
                    pNode.insertBefore(pPr, pNode.firstChild);
                }

                // 检查是否已有 ind
                let ind = pPr.getElementsByTagNameNS(NS_W, 'ind')[0];
                if (!ind) {
                    ind = doc.createElementNS(NS_W, 'w:ind');
                    pPr.appendChild(ind);
                }
                ind.setAttribute('w:firstLine', '640'); // 2 字符 = 640 twips
            }

            // 处理加粗和字体混排
            const hasBold = matchedFormat.bold && matchedFormat.bold.length > 0;
            const hasFonts = matchedFormat.fonts && matchedFormat.fonts.length > 0;

            if (hasBold || hasFonts) {
                // 需要拆分成多个 <w:r> 节点
                const segments = _splitTextByFormat(textContent, matchedFormat);

                // 移除原有的 <w:r>
                const nextSibling = rNode.nextSibling;
                pNode.removeChild(rNode);

                // 为每个片段创建新的 <w:r>
                for (const segment of segments) {
                    const newR = doc.createElementNS(NS_W, 'w:r');

                    // 创建 rPr
                    const rPr = doc.createElementNS(NS_W, 'w:rPr');
                    newR.appendChild(rPr);

                    // 设置字体
                    const rFonts = doc.createElementNS(NS_W, 'w:rFonts');
                    rFonts.setAttribute('w:ascii', segment.fontName);
                    rFonts.setAttribute('w:eastAsia', segment.fontName);
                    rFonts.setAttribute('w:hAnsi', segment.fontName);
                    rPr.appendChild(rFonts);

                    // 设置字号（pt -> half-points）
                    const sz = doc.createElementNS(NS_W, 'w:sz');
                    sz.setAttribute('w:val', String(segment.fontSize * 2));
                    rPr.appendChild(sz);

                    const szCs = doc.createElementNS(NS_W, 'w:szCs');
                    szCs.setAttribute('w:val', String(segment.fontSize * 2));
                    rPr.appendChild(szCs);

                    // 设置加粗
                    if (segment.bold) {
                        const b = doc.createElementNS(NS_W, 'w:b');
                        rPr.appendChild(b);
                    }

                    // 创建文本节点
                    const newT = doc.createElementNS(NS_W, 'w:t');
                    newT.textContent = segment.text;
                    if (segment.text.startsWith(' ') || segment.text.endsWith(' ')) {
                        newT.setAttribute('xml:space', 'preserve');
                    }
                    newR.appendChild(newT);

                    // 插入到段落中
                    if (nextSibling) {
                        pNode.insertBefore(newR, nextSibling);
                    } else {
                        pNode.appendChild(newR);
                    }
                }
            } else {
                // 没有加粗和字体标记，只设置默认字体
                let rPr = rNode.getElementsByTagNameNS(NS_W, 'rPr')[0];
                if (!rPr) {
                    rPr = doc.createElementNS(NS_W, 'w:rPr');
                    rNode.insertBefore(rPr, rNode.firstChild);
                }

                // 设置字体
                let rFonts = rPr.getElementsByTagNameNS(NS_W, 'rFonts')[0];
                if (!rFonts) {
                    rFonts = doc.createElementNS(NS_W, 'w:rFonts');
                    rPr.insertBefore(rFonts, rPr.firstChild);
                }
                rFonts.setAttribute('w:ascii', defaultFont.name);
                rFonts.setAttribute('w:eastAsia', defaultFont.name);
                rFonts.setAttribute('w:hAnsi', defaultFont.name);

                // 设置字号
                if (!rPr.getElementsByTagNameNS(NS_W, 'sz').length) {
                    const sz = doc.createElementNS(NS_W, 'w:sz');
                    sz.setAttribute('w:val', String(defaultFont.size * 2));
                    rPr.appendChild(sz);
                }
                if (!rPr.getElementsByTagNameNS(NS_W, 'szCs').length) {
                    const szCs = doc.createElementNS(NS_W, 'w:szCs');
                    szCs.setAttribute('w:val', String(defaultFont.size * 2));
                    rPr.appendChild(szCs);
                }
            }
        }

        // 序列化回 XML
        const serializer = new XMLSerializer();
        return serializer.serializeToString(doc);
    }

    /**
     * 根据格式信息拆分文本
     * @param {string} text - 文本内容
     * @param {Object} format - 格式信息 {bold, fonts, defaultFont}
     * @returns {Array<{text: string, bold: boolean, fontName: string, fontSize: number}>}
     */
    function _splitTextByFormat(text, format) {
        const segments = [];
        const defaultFont = format.defaultFont || { name: '仿宋_GB2312', size: 16 };

        // 创建文本位置到格式的映射
        const formatMap = new Map();

        // 映射字体信息
        if (format.fonts && format.fonts.length > 0) {
            for (const [start, end, fontName, fontSize] of format.fonts) {
                for (let i = start; i < end; i++) {
                    formatMap.set(i, { fontName, fontSize });
                }
            }
        }

        // 映射加粗信息
        const boldSet = new Set();
        if (format.bold && format.bold.length > 0) {
            for (const [start, end] of format.bold) {
                for (let i = start; i < end; i++) {
                    boldSet.add(i);
                }
            }
        }

        // 按格式变化拆分文本
        if (text.length === 0) return segments;

        let currentSegment = {
            text: '',
            bold: boldSet.has(0),
            fontName: formatMap.has(0) ? formatMap.get(0).fontName : defaultFont.name,
            fontSize: formatMap.has(0) ? formatMap.get(0).fontSize : defaultFont.size
        };

        for (let i = 0; i < text.length; i++) {
            const charBold = boldSet.has(i);
            const charFont = formatMap.has(i) ? formatMap.get(i) : defaultFont;

            // 检查格式是否变化
            if (charBold !== currentSegment.bold ||
                charFont.fontName !== currentSegment.fontName ||
                charFont.fontSize !== currentSegment.fontSize) {
                // 保存当前片段
                if (currentSegment.text.length > 0) {
                    segments.push(currentSegment);
                }
                // 开始新片段
                currentSegment = {
                    text: text[i],
                    bold: charBold,
                    fontName: charFont.fontName,
                    fontSize: charFont.fontSize
                };
            } else {
                currentSegment.text += text[i];
            }
        }

        // 保存最后一个片段
        if (currentSegment.text.length > 0) {
            segments.push(currentSegment);
        }

        return segments;
    }

    /**
     * 处理数据中的格式标记，返回处理后的数据和格式映射
     * @param {Object} data - 原始数据
     * @param {Object} defaultFont - 默认字体配置 {name: string, size: number}
     * @returns {{data: Object, formatMap: Object}}
     */
    function _processFormatData(data, defaultFont = null) {
        if (!data || typeof data !== 'object') return { data, formatMap: {} };

        const formatMap = {};
        const processedData = {};

        for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'string' && (value.includes('**') || value.startsWith('>') || value.includes('[f:'))) {
                const parsed = parseFormatText(value, defaultFont);
                processedData[key] = parsed.text;
                formatMap[key] = parsed;
            } else {
                processedData[key] = value;
            }
        }

        return { data: processedData, formatMap };
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
        log(...args) {
            logLines.push(args.map(a => {
                if (a === null) return 'null';
                if (a === undefined) return 'undefined';
                if (typeof a === 'object') return JSON.stringify(a);
                return String(a);
            }).join(' '));
        },
        getDefaultFont() {
            // 返回默认字体配置，可在代码中覆盖：gov.fillWordTemplate(tpl, data, fn, {name:'黑体',size:18})
            return { name: '仿宋_GB2312', size: 16 };
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
            const resp = await fetchWithAuth(`${API_BASE}/api/v1/agent/completion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });
            const data = await resp.json();
            if (!data.success) throw new Error(data.message || 'AI 调用失败');
            return data.content || '';
        },
        async fillWordTemplate(templateFile, data, outputFilename, defaultFont = null) {
            await ensureGovLibsLoaded();
            const effectiveDefaultFont = defaultFont || this.getDefaultFont();
            if (!window.PizZip) throw new Error('PizZip 未加载');
            const DocxCtor = _govGetDocxtemplaterClass();
            if (!DocxCtor) throw new Error('Docxtemplater 未加载');
            const fileObj = await _resolveGovTemplateFile(templateFile);
            const buf = await fileObj.arrayBuffer();
            const zip = new window.PizZip(buf);
            
            // 检查是否有格式标记
            const hasFormatting = _hasFormatMarkers(data);
            let processedData = data;
            let formatMap = {};
            
            if (hasFormatting) {
                const processed = _processFormatData(data, effectiveDefaultFont);
                processedData = processed.data;
                formatMap = processed.formatMap;
            }
            
            const doc = new DocxCtor(zip, { paragraphLoop: true, linebreaks: true });
            doc.setData(processedData || {});
            doc.render();
            
            let outputZip = doc.getZip();
            
            // 如果有格式标记，后处理 XML
            if (hasFormatting && Object.keys(formatMap).length > 0) {
                const documentXml = outputZip.file('word/document.xml');
                if (documentXml) {
                    const xmlContent = documentXml.asText();
                    const formattedXml = _applyDocxFormatting(xmlContent, formatMap);
                    outputZip.file('word/document.xml', formattedXml);
                }
            }
            
            const blob = outputZip.generate({
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

            // ===== 扩展公文标题正则模式 =====
            // 公文格式支持：
            // 1. 一级标题：一、二、三、... （中文数字+顿号）
            // 2. 二级标题：（一）（二）（三）... （中文数字+括号）
            // 3. 三级标题：1. 2. 3. ... （阿拉伯数字+点/顿号）
            // 4. 四级标题：（1）（2）（3）... （阿拉伯数字+括号）
            // 5. 五级标题：第一章、第二章、... （阿拉伯数字+章节）
            // 6. 条目式：第1条、第2条、... （第+数字+条）
            // 7. 无序列表：• xxx （项目符号）
            // 8. 其他变体：１．、(一)、(１) 等全角/半角混合
            const titlePatterns = [
                /^[一二三四五六七八九十]+、[^\n]+/,                    // 一、标题
                /^（[一二三四五六七八九十]+）[^\n]+/,                  // （一）标题
                /^\d+[\.、．：][^\n]+/,                                 // 1. 标题 或 1、标题
                /^（\d+）[^\n]+/,                                      // （1）标题
                /^[（\(][一二三四五六七八九十\d]+[）\)][^\n]+/,        // 混合括号
                /^第[一二三四五六七八九十\d]+章[^\n]*/,                // 第一章、第二章
                /^第[一二三四五六七八九十\d]+条[^\n]*/,                // 第1条、第2条
                /^[•●○◆■★][\s　][^\n]+/,                             // • xxx 无序列表
                /^[\u25A0\u25B2\u25CB\u25CF][\s　][^\n]+/,            // ■ ★ ◆ ● ○ 无序列表变体
                /^[\d]+\.[\s　]+[^\n]+/,                              // 1. xxx 数字点开头
                /^[\(（]?[a-zA-Z0-9]+[\)）]?[\.、：\s　]+[^\n]+/       // a. A. (1) 等字母数字编号
            ];

            // 无序列表符号模式（用于识别内容行）
            const bulletPattern = /^[•●○◆■★\u25A0\u25B2\u25CB\u25CF][\s　]+(.+)$/;

            // 更健壮的行分割：处理各种换行符和不可见字符
            const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            const sections = [];
            const tables = [];
            let currentSection = null;
            let title = '';

            // 尝试识别文档标题（第一个非空行，通常是大标题）
            for (let i = 0; i < Math.min(10, lines.length); i++) {
                const line = lines[i];
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
                const line = lines[i];
                if (!line) continue;

                let matchedLevel = 0;
                let matchedTitle = '';

                function splitInlineTitleContent(prefix, rest) {
                    const text = (rest || '').trim();
                    if (!text) {
                        return { title: prefix, paragraphs: [] };
                    }

                    const colonIndex = text.search(/[：:]/);
                    if (colonIndex > 0) {
                        const titlePart = text.slice(0, colonIndex).trim();
                        const contentPart = text.slice(colonIndex + 1).trim();
                        return {
                            title: `${prefix}${titlePart}`,
                            paragraphs: contentPart ? [contentPart] : []
                        };
                    }

                    return {
                        title: `${prefix}${text}`,
                        paragraphs: []
                    };
                }

                // 检测一级标题：一、二、三、
                const m1 = line.match(/^([一二三四五六七八九十]+)、(.*)$/);
                if (m1) {
                    if (currentSection) sections.push(currentSection);
                    currentSection = {
                        level: 1,
                        title: `${m1[1]}、${(m1[2] || '').trim()}`.trim(),
                        paragraphs: []
                    };
                    continue;
                }

                // 检测二级标题：（一）（二）
                const m2 = line.match(/^（([一二三四五六七八九十]+)）(.*)$/);
                if (m2) {
                    if (currentSection) sections.push(currentSection);
                    currentSection = {
                        level: 2,
                        title: `（${m2[1]}）${(m2[2] || '').trim()}`.trim(),
                        paragraphs: []
                    };
                    continue;
                }

                // 检测三级标题：1. 2. 或 1、2、
                const m3 = line.match(/^(\d+)([\.、．])(.*)$/);
                if (m3) {
                    if (currentSection) sections.push(currentSection);
                    const inline = splitInlineTitleContent(`${m3[1]}${m3[2]}`, m3[3]);
                    currentSection = {
                        level: 3,
                        title: inline.title,
                        paragraphs: inline.paragraphs
                    };
                    continue;
                }

                // 检测四级标题：（1）（2）
                const m4 = line.match(/^（(\d+)）(.*)$/);
                if (m4) {
                    if (currentSection) sections.push(currentSection);
                    const inline = splitInlineTitleContent(`（${m4[1]}）`, m4[2]);
                    currentSection = {
                        level: 4,
                        title: inline.title,
                        paragraphs: inline.paragraphs
                    };
                    continue;
                }

                // ===== 新增：检测更多公文标题格式 =====

                // 检测第一章、第二章...（阿拉伯数字章节）
                const mChapter = line.match(/^第(\d+)章[：:\s]*(.*)$/);
                if (mChapter) {
                    if (currentSection) sections.push(currentSection);
                    currentSection = {
                        level: 1,
                        title: `第${mChapter[1]}章 ${(mChapter[2] || '').trim()}`.trim(),
                        paragraphs: []
                    };
                    continue;
                }

                // 检测第一章、第二章...（中文数字章节）
                const mChapterCN = line.match(/^第([一二三四五六七八九十]+)章[：:\s]*(.*)$/);
                if (mChapterCN) {
                    if (currentSection) sections.push(currentSection);
                    currentSection = {
                        level: 1,
                        title: `第${mChapterCN[1]}章 ${(mChapterCN[2] || '').trim()}`.trim(),
                        paragraphs: []
                    };
                    continue;
                }

                // 检测第1条、第2条...（条目式）
                const mArticle = line.match(/^第(\d+)条[：:\s]*(.*)$/);
                if (mArticle) {
                    if (currentSection) sections.push(currentSection);
                    currentSection = {
                        level: 2,
                        title: `第${mArticle[1]}条 ${(mArticle[2] || '').trim()}`.trim(),
                        paragraphs: []
                    };
                    continue;
                }

                // 检测第一条、第二条...（中文数字条目）
                const mArticleCN = line.match(/^第([一二三四五六七八九十]+)条[：:\s]*(.*)$/);
                if (mArticleCN) {
                    if (currentSection) sections.push(currentSection);
                    currentSection = {
                        level: 2,
                        title: `第${mArticleCN[1]}条 ${(mArticleCN[2] || '').trim()}`.trim(),
                        paragraphs: []
                    };
                    continue;
                }

                // 检测无序列表：• xxx（作为内容节点，层级为5）
                const mBullet = line.match(bulletPattern);
                if (mBullet) {
                    // 无序列表作为内容节点，如果有父节点则作为子节点
                    const bulletContent = mBullet[1] || line;
                    if (currentSection) {
                        // 将无序列表项添加为独立的子节点或段落
                        currentSection.paragraphs.push(line);
                    } else {
                        // 没有父节点时，创建一个内容节点
                        if (currentSection) sections.push(currentSection);
                        currentSection = {
                            level: 5,
                            title: bulletContent.trim().slice(0, 50), // 取前50字符作为标题
                            paragraphs: [line]
                        };
                    }
                    continue;
                }

                // 检测半角括号格式：(1) (2) 或 (一) (二)
                const mParenHalf = line.match(/^\((\d+)\)[\s]*(.*)$/);
                if (mParenHalf) {
                    if (currentSection) sections.push(currentSection);
                    const inline = splitInlineTitleContent(`(${mParenHalf[1]})`, mParenHalf[2]);
                    currentSection = {
                        level: 4,
                        title: inline.title,
                        paragraphs: inline.paragraphs
                    };
                    continue;
                }

                const mParenHalfCN = line.match(/^\(([一二三四五六七八九十]+)\)[\s]*(.*)$/);
                if (mParenHalfCN) {
                    if (currentSection) sections.push(currentSection);
                    currentSection = {
                        level: 2,
                        title: `(${mParenHalfCN[1]}) ${(mParenHalfCN[2] || '').trim()}`.trim(),
                        paragraphs: []
                    };
                    continue;
                }

                // 检测字母编号：a. b. c. 或 A. B. C.
                const mLetter = line.match(/^([a-zA-Z])[\.、．：][\s]*(.*)$/);
                if (mLetter) {
                    if (currentSection) sections.push(currentSection);
                    currentSection = {
                        level: 4,
                        title: `${mLetter[1]}. ${(mLetter[2] || '').trim()}`.trim(),
                        paragraphs: []
                    };
                    continue;
                }

                // 非标题行：添加到当前段落
                if (currentSection) {
                    if (line.length > 0) {
                        currentSection.paragraphs.push(line);
                    }
                } else {
                    // 还没有遇到标题，可能是前言
                    if (!sections.find(s => s.level === 0)) {
                        sections.push({ level: 0, title: '前言', paragraphs: [line] });
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

            // ===== 构建树形结构 =====
            // 将扁平的 sections 数组转换为层级树
            // 支持层级跳跃容错：自动降级处理（L1→L3 变为 L1→L2，L2→L4 变为 L2→L3）
            function buildTree(flatSections) {
                const root = { level: -1, title: 'ROOT', children: [], paragraphs: [] };
                const stack = [root]; // 栈顶是当前父节点

                for (const sec of flatSections) {
                    // 计算目标层级（检测是否需要自动降级）
                    let targetLevel = sec.level;
                    const currentParentLevel = stack[stack.length - 1].level;
                    
                    // 层级自动降级规则：
                    // - L1 后直接出现 L3 → 降为 L2
                    // - L1 后直接出现 L4 → 降为 L2
                    // - L2 后直接出现 L4 → 降为 L3
                    if (targetLevel > currentParentLevel + 1) {
                        // 跳跃超过1级，自动降级到合理层级
                        targetLevel = currentParentLevel + 1;
                    }
                    
                    // 使用降级后的层级构建树
                    sec.level = targetLevel;
                    
                    // 情况1：正常层级递增或同级，弹出栈中 level >= 当前的节点
                    // 情况2：层级跳跃（如 L1 → L3），需要找到合适的父节点
                    if (targetLevel > currentParentLevel + 1) {
                        // 层级跳跃：尝试找最近的高层级节点作为父节点
                        // 例如 L1 下出现 L3，应该挂在 L1 下，而不是报错
                        // 弹出直到找到 level < targetLevel 的节点
                        while (stack.length > 1 && stack[stack.length - 1].level >= targetLevel) {
                            stack.pop();
                        }
                    } else {
                        // 正常情况：弹出栈中 level >= 当前的节点
                        while (stack.length > 1 && stack[stack.length - 1].level >= targetLevel) {
                            stack.pop();
                        }
                    }
                    
                    const parent = stack[stack.length - 1];
                    const node = {
                        level: sec.level,
                        title: sec.title,
                        paragraphs: sec.paragraphs || [],
                        children: []
                    };
                    parent.children.push(node);
                    stack.push(node);
                }

                return root.children;
            }

            const sectionTree = buildTree(sections);

            const parsedResult = {
                title,
                sections: sectionTree,  // 树形结构
                sectionsFlat: sections, // 保留扁平结构供兼容
                tables,
                rawText: text
            };

            // 输出解析结果到执行日志
            logLines.push('=== 文档结构解析结果 ===');
            logLines.push(`标题: ${title || '(未识别)'}`);
            logLines.push(`章节数: ${sections.length}`);
            logLines.push(`表格数: ${tables.length}`);
            logLines.push('');
            logLines.push('--- 章节结构（树形） ---');
            function printTree(nodes, indent = '') {
                for (const node of nodes) {
                    logLines.push(`${indent}${node.title} (${node.paragraphs.length}段, ${node.children.length}子节点)`);
                    if (node.children.length > 0) {
                        printTree(node.children, indent + '  ');
                    }
                }
            }
            printTree(sectionTree);
            if (tables.length > 0) {
                logLines.push('');
                logLines.push('--- 表格预览 ---');
                for (let i = 0; i < tables.length; i++) {
                    const t = tables[i];
                    logLines.push(`表格${i + 1}: ${t.headers.join(' | ')} (${t.rows.length}行)`);
                }
            }
            logLines.push('');
            logLines.push('--- 完整 JSON ---');
            logLines.push(JSON.stringify({ title, sections, tables }, null, 2));

            return parsedResult;
        },

        // ===== 通用公文解析辅助方法 =====

        /**
         * 解析文件名，提取单位和日期
         * @param {string} name - 文件名
         * @param {Object} options - 可选配置 { datePattern?: RegExp }
         * @returns {{unit: string, date: string}}
         * 
         * 支持格式：
         *   2024年4月15日数据中心日报 → {unit: "数据中心", date: "2024年4月15日"}
         *   04月15日运维部日报 → {unit: "运维部", date: "04月15日"}
         */
        parseFilename(name, options = {}) {
            if (!name || typeof name !== 'string') return { unit: '', date: '' };
            
            const base = name.replace(/\.(docx?|DOCX?)$/i, '');
            const datePattern = options.datePattern || /^(\d{4})年(\d{1,2})月(\d{1,2})日/;
            const m = base.match(datePattern);
            
            if (m) {
                // 带年份的完整日期
                return {
                    unit: base.replace(datePattern, '').replace(/日报$/, '').trim() || base,
                    date: `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日`
                };
            }
            
            // 尝试匹配月日格式：04月15日
            const mdMatch = base.match(/^(\d{1,2})月(\d{1,2})日/);
            if (mdMatch) {
                return {
                    unit: base.replace(/^(\d{1,2})月(\d{1,2})日/, '').replace(/日报$/, '').trim() || base,
                    date: `${parseInt(mdMatch[1])}月${parseInt(mdMatch[2])}日`
                };
            }
            
            // 无法解析日期
            return { unit: base.replace(/日报$/, '').trim() || base, date: '' };
        },

        /**
         * 将树形结构转换为模板可用的 JSON 格式
         * @param {Array} nodes - parseWordStructure 返回的 sections 树形结构
         * @param {Object} options - 可选配置 { baseIndent?: number, paragraphsKey?: string }
         * @returns {Array} - 转换后的节点数组，每个节点包含 level, title, indent, paragraphs, children
         */
        treeToJSON(nodes, options = {}) {
            const baseIndent = options.baseIndent || 0;
            const paragraphsKey = options.paragraphsKey || 'paragraphs';
            
            const convert = (nodeList, parentLevel = 0) => {
                return nodeList.map(node => {
                    // 根据层级计算缩进
                    const indent = '  '.repeat(baseIndent + Math.max(0, node.level - 1));
                    
                    // 将 paragraphs 数组转换为模板可用的对象数组格式
                    const paragraphs = (node[paragraphsKey] || []).map(p => {
                        return { paragraph: typeof p === 'string' ? p : (p.paragraph || JSON.stringify(p)) };
                    });
                    
                    return {
                        level: node.level,
                        title: node.title,
                        indent: indent,
                        paragraphs: paragraphs,
                        children: node.children && node.children.length > 0 
                            ? convert(node.children, node.level) 
                            : []
                    };
                });
            };
            
            return convert(nodes);
        },

        /**
         * 统计树形结构信息
         * @param {Array} nodes - 树形节点数组
         * @returns {{total: number, maxDepth: number}}
         */
        countTree(nodes) {
            let total = 0;
            let maxDepth = 0;
            
            function walk(nodeList, depth) {
                for (const node of nodeList) {
                    total++;
                    maxDepth = Math.max(maxDepth, depth);
                    if (node.children && node.children.length > 0) {
                        walk(node.children, depth + 1);
                    }
                }
            }
            
            walk(nodes, 1);
            return { total, maxDepth };
        },
    };
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
        const fn = new AsyncFunction('gov', 'currentGovTask', 'INPUT_FILE', 'INPUT_TEXT', 'XLSX', 'Papa', 'mammoth', 'PizZip', 'Docxtemplater', 'INPUT_FILES', code);
        const inputFiles = uploaded;
        const taskForRun = currentGovTask;
        await fn(gov, taskForRun, file || null, inputText || '', window.XLSX, window.Papa, window.mammoth, window.PizZip, DocxCtor, inputFiles);
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
            await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${taskId}/save-log`, {
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

async function executeGovTaskInBrowser(code, file, inputText, files) {
    if (!currentGovTask) return;

    currentGovTask.status = 'running';
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    const container = document.getElementById('govTaskOutput');
    container.innerHTML = '<div class="gov-log-entry"><div class="gov-log-header"><span>执行中...</span><span class="gov-log-status running">运行中</span></div></div>';

    const { status, output, errorMsg, inputDesc } = await executeGovTaskInBrowserOnce(code, file, inputText, files);

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

    // 前端执行完成后，通知后端保存结果并同步到分享页
    try {
        // 提取文件列表（兼容单文件和文件数组）
        let filesToUpload = [];
        if (file) {
            filesToUpload = [file];
        } else if (files && files.length > 0) {
            filesToUpload = files;
        }

        // 如果有文件且任务开启了分享，用 FormData 上传文件
        if (filesToUpload.length > 0 && currentGovTask.share_enabled && currentGovTask.share_token) {
            const formData = new FormData();
            formData.append('status', status);
            formData.append('output', output || '');
            formData.append('error', errorMsg || '');
            formData.append('input_text', inputText || '');
            formData.append('share_enabled', 'true');
            formData.append('share_token', currentGovTask.share_token);
            // 传 input_files 文件名数组，后端需要用这个来记录
            const inputFileNames = filesToUpload.map(f => f.name || f);
            formData.append('input_files', JSON.stringify(inputFileNames));
            for (const f of filesToUpload) {
                if (f instanceof File) {
                    formData.append('files', f);
                }
            }
            await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}/frontend-run`, {
                method: 'POST',
                body: formData
            });
        } else {
            // 无文件或未开启分享，只传 JSON
            const inputFileNames = filesToUpload.map(f => f.name || f);
            const shareEnabled = currentGovTask.share_enabled ? true : false;
            await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}/frontend-run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: status,
                    output: output,
                    error: errorMsg,
                    input_text: inputText,
                    input_files: inputFileNames,
                    share_enabled: shareEnabled,
                    share_token: currentGovTask.share_token || ''
                })
            });
        }
    } catch (e) {
        console.warn('同步前端执行结果到后端失败:', e);
    }
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

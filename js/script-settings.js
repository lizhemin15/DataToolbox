
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
    currentPreviewTable = null;
    isTableEditMode = false;
    resetDetailColumn();
    // 清除表列表高亮
    document.querySelectorAll('.tables-list-col .table-item').forEach(el => {
        el.classList.remove('active');
    });
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
            resetDbColumns();
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
    } catch (e) { console.warn('[mcpConfig] load failed, using defaults:', e); mcpConfigEnabled = true; mcpConfigPort = 0; }
    const mcpCb = document.getElementById('mcpEnabledCheck');
    if (mcpCb) mcpCb.checked = mcpConfigEnabled;
    const mcpPortInput = document.getElementById('mcpPortInput');
    if (mcpPortInput) mcpPortInput.value = mcpConfigPort || '';
    updateMcpDisplay();
    // 加载安全配置
    await loadMcpSafeConfig();
    await loadMcpToolsList();
}

// 加载 MCP 工具列表
async function loadMcpToolsList() {
    try {
        const r = await fetchWithAuth(`${API_BASE}/api/v1/mcp/tools`);
        const data = await r.json();
        if (data.success && data.data) {
            const toolsList = document.getElementById('mcpToolsList');
            if (!toolsList) return;
            toolsList.innerHTML = data.data.map(tool => 
                `<li><code>${tool.name}</code> — ${tool.description}</li>`
            ).join('');
        }
    } catch (e) {
        console.error('加载 MCP 工具列表失败:', e); showToast('加载MCP工具列表失败', 'error');
    }
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
        console.error('加载 MCP 安全配置失败:', e); showToast('加载MCP安全配置失败', 'error');
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
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/openapis`);

        const data = await response.json();

        if (data.success) {
            apis = data.apis || [];
            renderApiList();
        }
    } catch (error) {
        console.error('加载 API 列表失败', error);
        showToast('加载 API 列表失败', 'error');
    }
}

// 过滤 API 列表。
let apiTypeFilter = 'all';
function setApiTypeFilter(type) {
    apiTypeFilter = type;
    document.querySelectorAll('.api-filter-tag').forEach(tag => {
        tag.classList.toggle('active', tag.dataset.type === type);
    });
    renderApiList();
}
function filterApiList() {
    renderApiList();
}

// 渲染 API 列表。
function renderApiList() {
    const listEl = document.getElementById('apiList');
    const searchInput = document.getElementById('apiSearchInput');
    const keyword = (searchInput ? searchInput.value : '').trim().toLowerCase();
    
    const filtered = apis.filter(api => {
        if (apiTypeFilter !== 'all' && (api.type || 'query') !== apiTypeFilter) return false;
        if (keyword) {
            return api.name.toLowerCase().includes(keyword) || 
                api.path.toLowerCase().includes(keyword) ||
                api.method.toLowerCase().includes(keyword);
        }
        return true;
    });

    if (filtered.length === 0) {
        listEl.innerHTML = `<div style="text-align:center;color:#718096;padding:20px;">${keyword ? '未找到匹配 API' : '暂无 API'}</div>`;
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
        const safeApiId = escapeHtml(api.id);
        const safeApiName = escapeHtml(api.name);
        const safeApiPath = escapeHtml(api.path);
        const apiType = api.type || 'query';
        const typeLabel = apiType === 'forward' ? '<span class="api-type-badge forward">转发</span>' : '<span class="api-type-badge query">SQL</span>';
        return `
            <div class="db-item api-item ${currentApi && currentApi.id === api.id ? 'active' : ''} ${enabled ? '' : 'api-disabled'}" onclick="selectApi('${safeApiId}')">
                <div class="db-item-main">
                    <div class="db-item-name">${typeLabel}${safeApiName}</div>
                    <div class="db-item-info">
                        <span style="color:${methodColor};font-weight:600;">${api.method}</span> ${safeApiPath}
                    </div>
                </div>
                <label class="switch-wrap" onclick="event.stopPropagation(); toggleApiEnabled('${safeApiId}')" title="${enabled ? '禁用' : '启用'}" style="flex-shrink:0;">
                    <input type="checkbox" ${enabled ? 'checked' : ''} onchange="event.stopPropagation()">
                    <span class="switch-slider"></span>
                </label>
            </div>
        `;
    }).join('');
}

// 选择 API。
function selectApi(apiId) {
    currentApi = apis.find(api => api.id === apiId);
    if (currentApi) {
        renderApiList();
        loadApiDetail(apiId);
    }
}

// 切换 API 启用状态，forceEnabled 为 undefined 时自动翻转。
async function toggleApiEnabled(apiId, forceEnabled) {
    const api = apis.find(a => a.id === apiId);
    if (!api) return;
    const next = forceEnabled !== undefined ? forceEnabled : (api.enabled === false);
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/openapis/${apiId}`, {
            method: 'PUT',
            headers: {
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
        console.error('切换 API 状态失败', e);
        showToast('切换 API 状态失败', 'error');
    }
}

function toggleApiEnabledFromDetail() {
    if (!currentApi) return;
    const cb = document.getElementById('apiDetailEnabledCheck');
    if (!cb) return;
    toggleApiEnabled(currentApi.id, cb.checked);
}

// 加载 API 详情。
async function loadApiDetail(apiId) {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/openapis/${apiId}`);

        const data = await response.json();

        if (data.success) {
            // 同步当前选中的 API。
            currentApi = data.api;
            
            document.getElementById('apiWelcomeView').style.display = 'none';
            document.getElementById('apiDetailView').style.display = 'block';
            
            const api = data.api;
            document.getElementById('apiName').textContent = api.name;
            const detailEnabledCb = document.getElementById('apiDetailEnabledCheck');
            if (detailEnabledCb) detailEnabledCb.checked = api.enabled !== false;
            document.getElementById('apiPath').textContent = api.path;
            document.getElementById('apiMethod').textContent = api.method;

            const apiType = api.type || 'query';
            document.getElementById('apiTypeDisplay').textContent = apiType === 'forward' ? 'HTTP 转发' : '查询接口';

            if (apiType === 'forward') {
                document.getElementById('apiDatabaseRow').style.display = 'none';
                document.getElementById('apiForwardUrlRow').style.display = '';
                document.getElementById('apiForwardUrlDisplay').textContent = api.forward_url || '';
                document.getElementById('apiSqlSection').style.display = 'none';
                document.getElementById('apiParamsSection').style.display = 'none';
            } else {
                document.getElementById('apiDatabaseRow').style.display = '';
                document.getElementById('apiForwardUrlRow').style.display = 'none';
                document.getElementById('apiSqlSection').style.display = '';
                document.getElementById('apiParamsSection').style.display = '';
                document.getElementById('apiDatabase').textContent = api.database_name || api.database_id;
                document.getElementById('apiSqlDisplay').textContent = api.sql;
            }
            
            // 查询接口才需要解析参数。
            const params = apiType === 'forward' ? [] : parseMyBatisParams(api.sql || '');
            renderApiParams(params);
            
            // 渲染代码示例。
            renderCodeExamples(api);
        }
    } catch (error) {
        console.error('加载 API 详情失败', error);
        showToast('加载 API 详情失败', 'error');
    }
}

// 解析 MyBatis 参数。
function parseMyBatisParams(sql) {
    const paramsMap = new Map();
    
    // 匹配 #{paramName} 形式的参数。
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
    
    // 匹配 ${paramName} 形式的直接替换参数。
    const dollarPattern = /\$\{([^}]+)\}/g;
    while ((match = dollarPattern.exec(sql)) !== null) {
        const paramName = match[1].trim();
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

// 渲染 SQL 参数区。
function renderApiParams(params) {
    const displayEl = document.getElementById('apiParamsDisplay');
    
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
                            <div class="error-title">SQL 语法异常</div>
                            <div class="error-message">${errorWarnings[0].message}</div>
                            <div class="error-fix">
                                <strong>修复建议</strong>
                                <div class="fix-example">
                                    <div class="fix-before">原始：${escapeHtml(currentApi.sql)}</div>
                                    <div class="fix-after">修正：${escapeHtml(currentApi.sql.replace(/#\{/g, '${'))}</div>
                                </div>
                                <button class="btn btn-sm btn-primary" onclick="quickFixSql()" style="margin-top:8px;">一键修复</button>
                            </div>
                        </div>
                    </div>
                `;
            }
        }
    }
    
    if (params.length === 0) {
        displayEl.innerHTML = sqlWarningHtml + '<div style="text-align:center;color:#718096;padding:12px;">暂无参数</div>';
        return;
    }
    
    const paramsHtml = params.map(param => {
        const typeLabel = param.type === 'prepared' ? '预编译' : '直接拼接';
        const typeClass = param.required ? 'required' : 'optional';
        const requiredLabel = param.required ? '必填' : '可选';
        
        let defaultValue = '';
        if (currentApi && currentApi.default_params && currentApi.default_params[param.name] !== undefined) {
            const val = currentApi.default_params[param.name];
            defaultValue = `<span style="color:#48bb78;margin-left:8px;font-size:12px;">默认值: ${typeof val === 'string' ? '"' + val + '"' : val}</span>`;
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

// 代码示例上下文。
function getCodeExampleContext(api) {
    const apiType = api.type || 'query';
    let exampleParams = {};
    if (apiType === 'forward') {
        exampleParams = api.default_params ? { ...api.default_params } : {};
    } else {
        const params = parseMyBatisParams(api.sql || '');
        params.forEach(p => {
            if (api.default_params && api.default_params[p.name] !== undefined) {
                exampleParams[p.name] = api.default_params[p.name];
            } else {
                exampleParams[p.name] = '';
            }
        });
    }
    const hasParams = Object.keys(exampleParams).length > 0;
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

/**
 * Generate JavaScript/Node.js example code.
 * @param {Object} ctx - Example context.
 * @returns {string} Generated code.
 */
function genJavaScriptOrNode(ctx) {
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

// JavaScript 与 Node.js 共用同一模板。
const genJavaScript = genJavaScriptOrNode;
const genNode = genJavaScriptOrNode;

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

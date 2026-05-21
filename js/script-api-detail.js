
// ============================================================
// 模型管理
// ============================================================

let llmModels = [];
let smallModels = [];
let editingLLMModelId = null;
let editingSmallModelId = null;

// 初始化模型页签。
function initModelsTab() {
    loadLLMModels();
    loadSmallModels();
    
    // 切换模型子页签。
    document.querySelectorAll('.models-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.models-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.modelTab;
            document.getElementById('llmModelsPanel').style.display = tab === 'llm' ? '' : 'none';
            document.getElementById('smallModelsPanel').style.display = tab === 'small' ? '' : 'none';
        });
    });
}

// ========== LLM 模型 ==========

async function loadLLMModels() {
    try {
        const resp = await fetchWithAuth(`${API_BASE}/api/v1/models/llm`);
        const data = await resp.json();
        if (data.success) {
            llmModels = data.models || [];
            renderLLMModels();
        }
    } catch (e) {
        console.error('加载 LLM 模型失败:', e);
    }
}

function renderLLMModels() {
    const container = document.getElementById('llmModelsList');
    if (llmModels.length === 0) {
        container.innerHTML = '<div class="models-empty">暂无模型，点击“新增”开始配置</div>';
        return;
    }
    
    const typeIcons = { llm: 'LLM', rerank: 'R', embedding: 'E', asr: 'ASR', tts: 'TTS' };
    const typeLabels = { llm: 'LLM', rerank: 'Rerank', embedding: 'Embedding', asr: 'ASR', tts: 'TTS' };
    
    container.innerHTML = llmModels.map(m => {
        const safeMId = escapeHtml(m.id);
        return `
        <div class="model-card ${m.enabled ? '' : 'disabled'}">
            <div class="model-card-header">
                <span class="model-icon">${typeIcons[m.type] || 'M'}</span>
                <span class="model-name">${escapeHtml(m.name)}</span>
                <span class="model-type-badge">${typeLabels[m.type] || m.type}</span>
            </div>
            <div class="model-card-body">
                <div class="model-info"><strong>提供方:</strong> ${escapeHtml(m.provider || 'custom')}</div>
                <div class="model-info"><strong>模型:</strong> ${escapeHtml(m.model || '-')}</div>
                <div class="model-info"><strong>地址:</strong> ${escapeHtml(m.url)}</div>
                ${m.description ? `<div class="model-desc">${escapeHtml(m.description)}</div>` : ''}
            </div>
            <div class="model-card-footer">
                <span class="model-status ${m.enabled ? 'enabled' : 'disabled'}">${m.enabled ? '已启用' : '已停用'}</span>
                <div class="model-actions">
                    <button class="btn btn-sm" onclick="editLLMModel('${safeMId}')">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteLLMModel('${safeMId}')">删除</button>
                </div>
            </div>
        </div>
    `;}).join('');
}

function showAddLLMModelModal() {
    editingLLMModelId = null;
    document.getElementById('llmModalTitle').textContent = '新增模型';
    document.getElementById('llmModelForm').reset();
    document.getElementById('llmEnabledInput').checked = true;
    document.getElementById('llmModelModal').classList.add('show');
}

function editLLMModel(id) {
    const model = llmModels.find(m => m.id === id);
    if (!model) return;
    editingLLMModelId = id;
    document.getElementById('llmModalTitle').textContent = '编辑模型';
    document.getElementById('llmNameInput').value = model.name;
    document.getElementById('llmTypeInput').value = model.type;
    document.getElementById('llmProviderInput').value = model.provider || 'custom';
    document.getElementById('llmModelNameInput').value = model.model || '';
    document.getElementById('llmUrlInput').value = model.url;
    document.getElementById('llmApiKeyInput').value = model.api_key || '';
    document.getElementById('llmDescInput').value = model.description || '';
    document.getElementById('llmEnabledInput').checked = model.enabled;
    document.getElementById('llmModelModal').classList.add('show');
}

function hideLLMModelModal() {
    document.getElementById('llmModelModal').classList.remove('show');
}

async function handleLLMModelSubmit(e) {
    e.preventDefault();
    const data = {
        name: document.getElementById('llmNameInput').value.trim(),
        type: document.getElementById('llmTypeInput').value,
        provider: document.getElementById('llmProviderInput').value,
        model: document.getElementById('llmModelNameInput').value.trim(),
        url: document.getElementById('llmUrlInput').value.trim(),
        api_key: document.getElementById('llmApiKeyInput').value,
        description: document.getElementById('llmDescInput').value.trim(),
        enabled: document.getElementById('llmEnabledInput').checked,
    };
    
    try {
        const url = editingLLMModelId
            ? `${API_BASE}/api/v1/models/llm/${editingLLMModelId}`
            : `${API_BASE}/api/v1/models/llm`;
        const method = editingLLMModelId ? 'PUT' : 'POST';
        const resp = await fetchWithAuth(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await resp.json();
        if (result.success) {
            hideLLMModelModal();
            loadLLMModels();
        } else {
            showToast(result.message || '保存失败', 'error');
        }
    } catch (e) {
        showToast('保存失败：' + e.message, 'error');
    }
}

async function deleteLLMModel(id) {
    if (!confirm('确定删除这个模型吗？')) return;
    try {
        const resp = await fetchWithAuth(`${API_BASE}/api/v1/models/llm/${id}`, { method: 'DELETE' });
        const result = await resp.json();
        if (result.success) loadLLMModels();
        else showToast(result.message || '删除失败', 'error');
    } catch (e) {
        showToast('删除失败：' + e.message, 'error');
    }
}

// ========== 小模型 ==========

async function loadSmallModels() {
    try {
        const resp = await fetchWithAuth(`${API_BASE}/api/v1/models/small`);
        const data = await resp.json();
        if (data.success) {
            smallModels = data.models || [];
            renderSmallModels();
        }
    } catch (e) {
        console.error('加载小模型失败', e);
    }
}

function renderSmallModels() {
    const container = document.getElementById('smallModelsList');
    if (smallModels.length === 0) {
        container.innerHTML = '<div class="models-empty">暂无模型，点击“新增”开始配置</div>';
        return;
    }
    
    container.innerHTML = smallModels.map(m => {
        const safeMId = escapeHtml(m.id);
        return `
        <div class="model-card ${m.enabled ? '' : 'disabled'}">
            <div class="model-card-header">
                <span class="model-icon">S</span>
                <span class="model-name">${escapeHtml(m.name)}</span>
            </div>
            <div class="model-card-body">
                ${m.description ? `<div class="model-desc">${escapeHtml(m.description)}</div>` : ''}
                <div class="model-info"><strong>输入类型:</strong> ${m.input_type || 'text'}</div>
                <div class="model-info"><strong>输出类型:</strong> ${m.output_type || 'text'}</div>
            </div>
            <div class="model-card-footer">
                <span class="model-status ${m.enabled ? 'enabled' : 'disabled'}">${m.enabled ? '已启用' : '已停用'}</span>
                <div class="model-actions">
                    <button class="btn btn-sm" onclick="runSmallModel('${safeMId}')">运行</button>
                    <button class="btn btn-sm" onclick="editSmallModel('${safeMId}')">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteSmallModel('${safeMId}')">删除</button>
                </div>
            </div>
        </div>
    `;}).join('');
}

function showAddSmallModelModal() {
    editingSmallModelId = null;
    document.getElementById('smallModalTitle').textContent = '新增小模型';
    document.getElementById('smallModelForm').reset();
    document.getElementById('smallEnabledInput').checked = true;
    populateSmallModelDbSelect();
    document.getElementById('smallModelModal').classList.add('show');
}

function editSmallModel(id) {
    const model = smallModels.find(m => m.id === id);
    if (!model) return;
    editingSmallModelId = id;
    document.getElementById('smallModalTitle').textContent = '编辑小模型';
    populateSmallModelDbSelect();
    document.getElementById('smallNameInput').value = model.name;
    document.getElementById('smallDescInput').value = model.description || '';
    document.getElementById('smallDbSelect').value = model.database_id || '';
    document.getElementById('smallInputTypeInput').value = model.input_type || 'text';
    document.getElementById('smallAcceptExtsInput').value = model.accept_exts || '';
    document.getElementById('smallOutputTypeInput').value = model.output_type || 'text';
    document.getElementById('smallCodeInput').value = model.js_code || '';
    document.getElementById('smallEnabledInput').checked = model.enabled;
    document.getElementById('smallModelModal').classList.add('show');
}

function hideSmallModelModal() {
    document.getElementById('smallModelModal').classList.remove('show');
}

function populateSmallModelDbSelect() {
    const select = document.getElementById('smallDbSelect');
    select.innerHTML = '<option value="">请选择数据库</option>';
    databases.forEach(db => {
        select.innerHTML += `<option value="${escapeHtml(db.id)}">${escapeHtml(db.name)} (${escapeHtml(db.type)})</option>`;
    });
}

async function handleSmallModelSubmit(e) {
    e.preventDefault();
    const data = {
        name: document.getElementById('smallNameInput').value.trim(),
        description: document.getElementById('smallDescInput').value.trim(),
        database_id: document.getElementById('smallDbSelect').value,
        input_type: document.getElementById('smallInputTypeInput').value,
        accept_exts: document.getElementById('smallAcceptExtsInput').value.trim(),
        output_type: document.getElementById('smallOutputTypeInput').value,
        js_code: document.getElementById('smallCodeInput').value,
        enabled: document.getElementById('smallEnabledInput').checked,
    };
    
    try {
        const url = editingSmallModelId
            ? `${API_BASE}/api/v1/models/small/${editingSmallModelId}`
            : `${API_BASE}/api/v1/models/small`;
        const method = editingSmallModelId ? 'PUT' : 'POST';
        const resp = await fetchWithAuth(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await resp.json();
        if (result.success) {
            hideSmallModelModal();
            loadSmallModels();
        } else {
            showToast(result.message || '保存失败', 'error');
        }
    } catch (e) {
        showToast('保存失败：' + e.message, 'error');
    }
}

async function deleteSmallModel(id) {
    if (!confirm('确定删除这个小模型吗？')) return;
    try {
        const resp = await fetchWithAuth(`${API_BASE}/api/v1/models/small/${id}`, { method: 'DELETE' });
        const result = await resp.json();
        if (result.success) loadSmallModels();
        else showToast(result.message || '删除失败', 'error');
    } catch (e) {
        showToast('删除失败：' + e.message, 'error');
    }
}

async function runSmallModel(id) {
    const model = smallModels.find(m => m.id === id);
    if (!model) return;
    
    const inputText = prompt('请输入运行内容：');
    if (inputText === null) return;
    
    try {
        const resp = await fetchWithAuth(`${API_BASE}/api/v1/models/small/${id}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input_text: inputText })
        });
        const result = await resp.json();
        if (result.success) {
            showToast('运行结果：\n' + (Array.isArray(result.output) ? result.output.join('\n') : JSON.stringify(result.output, null, 2)), 'success', 10000);
        } else {
            showToast('运行失败：' + result.message, 'error');
        }
    } catch (e) {
        showToast('运行失败：' + e.message, 'error');
    }
}

// ==================== 本体关系表功能 ====================

// 显示本体关系表模态框
function showOntologyRelationTable() {
    showDbOntologyRelations();
}

// 隐藏本体关系表模态框
function hideOntologyRelationModal() {
    document.getElementById('ontologyRelationModal').style.display = 'none';
}

// 刷新本体关系列表（兼容旧代码）
async function refreshOntologyRelations() {
    await refreshDbOntologyRelations();
}

// 显示数据库本体关系表
async function showDbOntologyRelations() {
    if (!currentDb) {
        alert('请先选择数据库');
        return;
    }

    // 显示模态框
    document.getElementById('ontologyRelationModal').style.display = 'block';
    await refreshDbOntologyRelations();
}

// 刷新数据库本体关系列表
async function refreshDbOntologyRelations() {
    if (!currentDb) return;

    const loading = document.getElementById('relationTableLoading');
    const tbody = document.getElementById('relationTableBody');

    loading.style.display = 'flex';

    try {
        const res = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/ontology/relations`);
        const data = await res.json();

        if (data.success) {
            const relations = data.relations || [];
            renderDbRelationTable(relations);
        } else {
            alert('获取关系列表失败: ' + (data.message || '未知错误'));
        }
    } catch (err) {
        console.error('获取关系列表失败:', err);
        alert('获取关系列表失败: ' + err.message);
    } finally {
        loading.style.display = 'none';
    }
}

// 渲染数据库关系表
function renderDbRelationTable(relations) {
    const tbody = document.getElementById('relationTableBody');

    if (relations.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-row">暂无数据</td></tr>';
        return;
    }

    tbody.innerHTML = relations.map(rel => `
        <tr>
            <td>${escapeHtml(rel.name)}</td>
            <td>${escapeHtml(rel.source.table_name)}.${escapeHtml(rel.source.field_name)}</td>
            <td>${escapeHtml(rel.target.table_name)}.${escapeHtml(rel.target.field_name)}</td>
            <td>${escapeHtml(rel.match_type)}</td>
            <td>${new Date(rel.created_at).toLocaleString()}</td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="deleteDbOntologyRelation('${rel.id}')">删除</button>
            </td>
        </tr>
    `).join('');
}

// 删除数据库本体关系
async function deleteDbOntologyRelation(relId) {
    if (!currentDb || !confirm('确定要删除这个关系吗？')) {
        return;
    }

    try {
        const res = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/ontology/relations/${relId}`, {
            method: 'DELETE'
        });
        const data = await res.json();

        if (data.success) {
            refreshDbOntologyRelations();
        } else {
            alert('删除失败: ' + (data.message || '未知错误'));
        }
    } catch (err) {
        console.error('删除关系失败:', err);
        alert('删除失败: ' + err.message);
    }
}

// 扫描数据库本体关系
let dbScanCandidates = [];

async function scanDbOntologyRelations() {
    if (!currentDb) {
        alert('请先选择数据库');
        return;
    }

    try {
        showToast('正在获取表列表...', 'info');

        // 先获取表列表
        const tablesRes = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables`);
        const tablesData = await tablesRes.json();

        if (!tablesData.success) {
            alert('获取表列表失败: ' + (tablesData.message || '未知错误'));
            return;
        }

        if (!tablesData.tables || tablesData.tables.length === 0) {
            alert('数据库中没有表');
            return;
        }

        // 显示表选择对话框
        const selectedTables = await showTableSelectionDialog(tablesData.tables);
        if (!selectedTables || selectedTables.length === 0) {
            showToast('已取消扫描', 'info');
            return;
        }

        if (!confirm(`确定要扫描数据库 "${currentDb.name}" 中 ${selectedTables.length} 个表的本体关系吗？`)) {
            return;
        }

        showToast('正在扫描...', 'info');

        const res = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/ontology/scan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ tables: selectedTables })
        });
        const data = await res.json();

        if (data.success) {
            dbScanCandidates = data.candidates || [];

            if (dbScanCandidates.length === 0) {
                alert('未发现等价字段关系');
                return;
            }

            // 显示候选列表让用户勾选
            const selectedIndices = await showRelationSelectionDialog(dbScanCandidates);
            
            if (selectedIndices.length > 0) {
                for (const idx of selectedIndices) {
                    await addDbCandidateAsRelation(idx);
                }
                showToast(`已添加 ${selectedIndices.length} 个关系`, 'success');
            }
        } else {
            alert('扫描失败: ' + (data.message || '未知错误'));
        }
    } catch (err) {
        console.error('扫描失败:', err);
        alert('扫描失败: ' + err.message);
    }
}

// 显示表选择对话框
function showTableSelectionDialog(tables) {
    return new Promise((resolve) => {
        // 创建模态对话框
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white;
            padding: 20px;
            border-radius: 8px;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;

        let html = `
            <h3 style="margin: 0 0 15px 0;">选择要扫描的表</h3>
            <div style="margin-bottom: 15px;">
                <button id="selectAllBtn" style="margin-right: 10px; padding: 5px 15px; cursor: pointer;">全选</button>
                <button id="deselectAllBtn" style="padding: 5px 15px; cursor: pointer;">全不选</button>
            </div>
            <div style="margin-bottom: 15px; max-height: 400px; overflow-y: auto; border: 1px solid #ddd; padding: 10px;">
        `;

        tables.forEach((table, idx) => {
            html += `
                <div style="margin-bottom: 8px;">
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" class="table-checkbox" value="${table}" checked style="margin-right: 8px;">
                        <span>${table}</span>
                    </label>
                </div>
            `;
        });

        html += `
            </div>
            <div style="text-align: right;">
                <button id="cancelBtn" style="margin-right: 10px; padding: 8px 20px; cursor: pointer;">取消</button>
                <button id="confirmBtn" style="padding: 8px 20px; cursor: pointer; background: #4CAF50; color: white; border: none; border-radius: 4px;">确定</button>
            </div>
        `;

        dialog.innerHTML = html;
        modal.appendChild(dialog);
        document.body.appendChild(modal);

        // 全选按钮
        dialog.querySelector('#selectAllBtn').addEventListener('click', () => {
            dialog.querySelectorAll('.table-checkbox').forEach(cb => cb.checked = true);
        });

        // 全不选按钮
        dialog.querySelector('#deselectAllBtn').addEventListener('click', () => {
            dialog.querySelectorAll('.table-checkbox').forEach(cb => cb.checked = false);
        });

        // 取消按钮
        dialog.querySelector('#cancelBtn').addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(null);
        });

        // 确定按钮
        dialog.querySelector('#confirmBtn').addEventListener('click', () => {
            const selected = [];
            dialog.querySelectorAll('.table-checkbox:checked').forEach(cb => {
                selected.push(cb.value);
            });
            document.body.removeChild(modal);
            resolve(selected);
        });

        // 点击背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
                resolve(null);
            }
        });
    });
}

// 显示关系选择对话框
function showRelationSelectionDialog(candidates) {
    return new Promise((resolve) => {
        // 创建模态对话框
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white;
            padding: 20px;
            border-radius: 8px;
            max-width: 700px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;

        let html = `
            <h3 style="margin: 0 0 15px 0;">选择要入库的关系</h3>
            <div style="margin-bottom: 15px;">
                <button id="selectAllBtn" style="margin-right: 10px; padding: 5px 15px; cursor: pointer;">全选</button>
                <button id="deselectAllBtn" style="padding: 5px 15px; cursor: pointer;">全不选</button>
            </div>
            <div style="margin-bottom: 15px; max-height: 400px; overflow-y: auto; border: 1px solid #ddd; padding: 10px;">
        `;

        candidates.forEach((cand, idx) => {
            html += `
                <div style="margin-bottom: 12px; padding: 8px; background: #f9f9f9; border-radius: 4px;">
                    <label style="display: flex; align-items: flex-start; cursor: pointer;">
                        <input type="checkbox" class="relation-checkbox" value="${idx}" checked style="margin-right: 10px; margin-top: 3px;">
                        <div>
                            <div style="font-weight: bold; margin-bottom: 4px;">${cand.name}</div>
                            <div style="font-size: 12px; color: #666;">
                                ${cand.source.table_name}.${cand.source.field_name} ↔ ${cand.target.table_name}.${cand.target.field_name}
                            </div>
                            <div style="font-size: 11px; color: #999;">
                                匹配类型: ${cand.match_type} | 得分: ${cand.match_score.toFixed(2)}
                            </div>
                        </div>
                    </label>
                </div>
            `;
        });

        html += `
            </div>
            <div style="text-align: right;">
                <button id="cancelBtn" style="margin-right: 10px; padding: 8px 20px; cursor: pointer;">取消</button>
                <button id="confirmBtn" style="padding: 8px 20px; cursor: pointer; background: #4CAF50; color: white; border: none; border-radius: 4px;">确定入库</button>
            </div>
        `;

        dialog.innerHTML = html;
        modal.appendChild(dialog);
        document.body.appendChild(modal);

        // 全选按钮
        dialog.querySelector('#selectAllBtn').addEventListener('click', () => {
            dialog.querySelectorAll('.relation-checkbox').forEach(cb => cb.checked = true);
        });

        // 全不选按钮
        dialog.querySelector('#deselectAllBtn').addEventListener('click', () => {
            dialog.querySelectorAll('.relation-checkbox').forEach(cb => cb.checked = false);
        });

        // 取消按钮
        dialog.querySelector('#cancelBtn').addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve([]);
        });

        // 确定按钮
        dialog.querySelector('#confirmBtn').addEventListener('click', () => {
            const selected = [];
            dialog.querySelectorAll('.relation-checkbox:checked').forEach(cb => {
                selected.push(parseInt(cb.value));
            });
            document.body.removeChild(modal);
            resolve(selected);
        });

        // 点击背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
                resolve([]);
            }
        });
    });
}

// 将候选添加为关系
async function addDbCandidateAsRelation(idx) {
    const cand = dbScanCandidates[idx];
    if (!cand || !currentDb) return;
    
    try {
        const res = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/ontology/relations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: cand.name,
                description: cand.description,
                source: cand.source,
                target: cand.target,
                match_type: cand.match_type
            })
        });
        const data = await res.json();
        
        if (!data.success) {
            console.error('添加关系失败:', data.message);
        }
    } catch (err) {
        console.error('添加关系失败:', err);
    }
}

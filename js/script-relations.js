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


async function saveMcpPort() {
    const portInput = document.getElementById('mcpPortInput');
    if (!portInput) return;

    const port = parseInt(portInput.value) || 0;

    // 验证端口范围
    if (port < 0 || port > 65535) {
        showToast('端口号必须在 0-65535 范围内', 'error');
        return;
    }

    try {
        const r = await fetchWithAuth(`${API_BASE}/api/v1/mcp/port`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ port })
        });
        const data = await r.json();
        if (data.success) {
            mcpConfigPort = port;
            showToast('端口配置已保存，重启服务后生效');
        }
    } catch (e) {
        console.error('保存 MCP 端口配置失败:', e);
        showToast('保存失败', 'error');
    }
}

// ==================== 表检索配置 ====================

let tableRetrievalConfig = null;
let embeddingConfig = null;

// 显示表检索配置弹窗

// 加载表检索配置
async function loadTableRetrievalConfig() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/agent/table-retrieval-config`);
        const data = await response.json();
        if (data.success && data.config) {
            tableRetrievalConfig = data.config;
            // 填充表单
            document.getElementById('trStrategy').value = tableRetrievalConfig.strategy || 'hybrid';
            document.getElementById('trMaxTables').value = tableRetrievalConfig.max_tables || 15;
            document.getElementById('trKeywordWeight').value = tableRetrievalConfig.keyword_weight || 0.4;
            document.getElementById('trVectorWeight').value = tableRetrievalConfig.vector_weight || 0.3;
            document.getElementById('trGraphWeight').value = tableRetrievalConfig.graph_weight || 0.3;
            if (tableRetrievalConfig.graph_config) {
                document.getElementById('trGraphDepth').value = tableRetrievalConfig.graph_config.max_depth || 2;
            }
        }
    } catch (error) {
        console.error('加载表检索配置失败:', error);
    }
}

// 加载 Embedding 配置
async function loadEmbeddingConfig() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/agent/embedding-config`);
        const data = await response.json();
        if (data.success && data.config) {
            embeddingConfig = data.config;
            successEl.textContent = '配置已保存';
            successEl.classList.add('show');
            setTimeout(() => successEl.classList.remove('show'), 2000);
        } else {
            errorEl.textContent = trData.message || '保存失败';
            errorEl.classList.add('show');
        }
    } catch (error) {
        errorEl.textContent = '保存失败: ' + error.message;
        errorEl.classList.add('show');
    }
}

// 同步表检索数据
async function handleSyncTableRetrieval() {
    const btn = document.getElementById('syncTableRetrievalBtn');
    const originalText = btn.textContent;
    btn.textContent = '同步中...';
    btn.disabled = true;
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const data = await response.json();
        
        if (data.success) {
            btn.textContent = '同步已启动';
            // 轮询检查状态
            setTimeout(async () => {
                const statusResponse = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/embedding-status`);
                const statusData = await statusResponse.json();
                if (statusData.success) {
                    const total = statusData.total_vectors || 0;
                    btn.textContent = `已完成 (${total} 向量)`;
                    setTimeout(() => {
                        btn.textContent = originalText;
                        btn.disabled = false;
                    }, 2000);
                }
            }, 10000);
        } else {
            btn.textContent = '同步失败';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 2000);
        }
    } catch (error) {
        btn.textContent = '同步失败';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 2000);
    }
}

// ========== 同步索引弹窗（数据库管理界面）==========

// 折叠/展开 Embedding 配置
function toggleEmbeddingConfig() {
    const panel = document.getElementById('embeddingConfigPanel');
    const toggle = document.getElementById('embeddingConfigToggle');
    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        toggle.textContent = '收起 ▲';
    } else {
        panel.style.display = 'none';
        toggle.textContent = '展开 ▼';
    }
}

// 显示同步索引弹窗
async function showSyncIndexModal() {
    const modal = document.getElementById('syncIndexModal');
    modal.style.display = 'flex';
    
    // 加载当前 Embedding 配置
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/agent/embedding-config`);
        const data = await response.json();
        if (data.success && data.config) {
            document.getElementById('syncEmbEnabled').checked = data.config.enabled || false;
            document.getElementById('syncEmbUrl').value = data.config.url || '';
            document.getElementById('syncEmbApiKey').value = data.config.api_key || '';
            document.getElementById('syncEmbModel').value = data.config.model || '';
            document.getElementById('syncEmbDimension').value = data.config.dimension || 1024;
        }
    } catch (error) {
        console.error('加载 Embedding 配置失败:', error);
    }
    
    // 隐藏状态区域
    document.getElementById('syncIndexStatus').style.display = 'none';
}

// 隐藏同步索引弹窗
function hideSyncIndexModal() {
    document.getElementById('syncIndexModal').style.display = 'none';
}

// 关闭索引预览下拉菜单
function closeIndexPreviewMenu() {
    const menu = document.getElementById('indexPreviewMenu');
    if (menu) menu.style.display = 'none';
}

// 执行同步索引
async function handleSyncIndex() {
    const statusEl = document.getElementById('syncIndexStatus');
    const progressEl = document.getElementById('syncIndexProgress');
    const btn = document.getElementById('startSyncIndexBtn');

    // 收集 Embedding 配置
    const embConfig = {
        enabled: document.getElementById('syncEmbEnabled').checked,
        url: document.getElementById('syncEmbUrl').value,
        api_key: document.getElementById('syncEmbApiKey').value,
        model: document.getElementById('syncEmbModel').value,
        dimension: parseInt(document.getElementById('syncEmbDimension').value, 10) || 1024
    };

    const syncTables = document.getElementById('syncTables').checked;
    const syncVectors = document.getElementById('syncVectors').checked;
    const syncRelations = document.getElementById('syncRelations').checked;

    // 至少选择一项
    if (!syncTables && !syncVectors && !syncRelations) {
        alert('请至少选择一项同步内容');
        return;
    }

    // 显示状态
    statusEl.style.display = 'block';
    progressEl.textContent = '保存 Embedding 配置...';
    btn.disabled = true;

    try {
        // 1. 保存 Embedding 配置
        const embResponse = await fetchWithAuth(`${API_BASE}/api/v1/agent/embedding-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(embConfig)
        });
        const embData = await embResponse.json();

        if (!embData.success) {
            progressEl.textContent = 'Embedding 配置保存失败: ' + (embData.message || '');
            btn.disabled = false;
            return;
        }

        // 2. 触发同步
        const syncTypes = [];
        if (syncTables) syncTypes.push('表数据');
        if (syncVectors) syncTypes.push('向量索引');
        if (syncRelations) syncTypes.push('关系数据');
        progressEl.textContent = `正在同步: ${syncTypes.join('、')}...`;

        const syncResponse = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                database_id: currentDb?.id,
                sync_tables: syncTables,
                sync_vectors: syncVectors,
                sync_relations: syncRelations
            })
        });
        const syncData = await syncResponse.json();

        if (!syncData.success) {
            progressEl.textContent = '同步失败: ' + (syncData.message || '');
            btn.disabled = false;
            return;
        }

        // 3. 轮询检查状态（最多等待 2 分钟）
        progressEl.textContent = '同步进行中，请稍候...';
        const maxAttempts = 24; // 24 * 5秒 = 2分钟
        let attempts = 0;

        const pollStatus = async () => {
            attempts++;
            try {
                const statusResponse = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/embedding-status`);
                const statusData = await statusResponse.json();

                if (statusData.success) {
                    const tables = statusData.total_tables || 0;
                    const vectors = statusData.total_vectors || 0;
                    const relations = statusData.total_relations || 0;

                    // 显示详细进度
                    let progressHtml = '✅ 同步完成<br>';
                    const parts = [];
                    if (syncTables) parts.push(`表: ${tables}`);
                    if (syncVectors) parts.push(`向量: ${vectors}`);
                    if (syncRelations) parts.push(`关系: ${relations}`);
                    progressHtml += parts.join(' | ');

                    progressEl.innerHTML = progressHtml;
                    btn.disabled = false;
                } else {
                    if (attempts < maxAttempts) {
                        // 继续轮询
                        progressEl.textContent = `同步进行中... (${attempts}/${maxAttempts})`;
                        setTimeout(pollStatus, 5000);
                    } else {
                        // 超时
                        progressEl.textContent = '⚠️ 同步超时，请稍后刷新查看结果';
                        btn.disabled = false;
                    }
                }
            } catch (error) {
                if (attempts < maxAttempts) {
                    // 出错后继续尝试
                    progressEl.textContent = `同步进行中... (${attempts}/${maxAttempts})`;
                    setTimeout(pollStatus, 5000);
                } else {
                    progressEl.textContent = '⚠️ 获取状态失败: ' + error.message;
                    btn.disabled = false;
                }
            }
        };

        // 开始轮询
        setTimeout(pollStatus, 3000);

    } catch (error) {
        progressEl.textContent = '同步失败: ' + error.message;
        btn.disabled = false;
    }
}

// 建立向量索引
async function handleVectorIndex() {
    console.log('handleVectorIndex called, currentDb:', currentDb);
    if (!currentDb) {
        showToast('请先在左侧列表中选择一个数据库', 'warning');
        return;
    }

    // 创建同步模式选择弹窗
    const modalHtml = `
        <div id="vectorIndexModal" class="modal" style="display:flex;">
            <div class="modal-content" style="max-width:550px;">
                <div class="modal-header">
                    <h2>🔤 建立向量索引</h2>
                </div>
                <div class="modal-body">
                    <div style="padding:20px;">
                        <div style="margin-bottom:20px;font-size:14px;color:#666;">
                            数据库: <strong>${currentDb.name}</strong>
                        </div>

                        <div style="margin-bottom:16px;">
                            <label style="display:flex;align-items:flex-start;cursor:pointer;padding:12px;border:2px solid #e0e0e0;border-radius:6px;transition:all 0.2s;" onmouseover="this.style.borderColor='#4CAF50'" onmouseout="if(!this.querySelector('input').checked)this.style.borderColor='#e0e0e0'" onclick="document.querySelectorAll('#vectorIndexModal input[name=syncMode]').forEach(r=>{r.parentElement.parentElement.style.borderColor='#e0e0e0'});this.style.borderColor='#4CAF50'">
                                <input type="radio" name="syncMode" value="incremental" checked style="margin-top:3px;margin-right:12px;">
                                <div style="flex:1;">
                                    <div style="font-size:15px;font-weight:500;color:#333;">增量同步</div>
                                    <div style="font-size:12px;color:#888;margin-top:4px;">只处理新增、删除或修改的表，速度快，适合日常更新</div>
                                </div>
                            </label>
                        </div>

                        <div style="margin-bottom:16px;">
                            <label style="display:flex;align-items:flex-start;cursor:pointer;padding:12px;border:2px solid #e0e0e0;border-radius:6px;transition:all 0.2s;" onmouseover="this.style.borderColor='#4CAF50'" onmouseout="if(!this.querySelector('input').checked)this.style.borderColor='#e0e0e0'" onclick="document.querySelectorAll('#vectorIndexModal input[name=syncMode]').forEach(r=>{r.parentElement.parentElement.style.borderColor='#e0e0e0'});this.style.borderColor='#4CAF50'">
                                <input type="radio" name="syncMode" value="full" style="margin-top:3px;margin-right:12px;">
                                <div style="flex:1;">
                                    <div style="font-size:15px;font-weight:500;color:#333;">全量同步</div>
                                    <div style="font-size:12px;color:#888;margin-top:4px;">重新处理所有表，适合数据结构发生重大变化时使用</div>
                                </div>
                            </label>
                        </div>

                        <div style="margin-bottom:16px;">
                            <label style="display:flex;align-items:flex-start;cursor:pointer;padding:12px;border:2px solid #e0e0e0;border-radius:6px;transition:all 0.2s;" onmouseover="this.style.borderColor='#4CAF50'" onmouseout="if(!this.querySelector('input').checked)this.style.borderColor='#e0e0e0'" onclick="document.querySelectorAll('#vectorIndexModal input[name=syncMode]').forEach(r=>{r.parentElement.parentElement.style.borderColor='#e0e0e0'});this.style.borderColor='#4CAF50'">
                                <input type="radio" name="syncMode" value="range" style="margin-top:3px;margin-right:12px;">
                                <div style="flex:1;">
                                    <div style="font-size:15px;font-weight:500;color:#333;">选定范围</div>
                                    <div style="font-size:12px;color:#888;margin-top:4px;">指定表范围同步，支持通配符（如 user_*）</div>
                                </div>
                            </label>
                        </div>

                        <div id="tableFilterInput" style="display:none;margin-top:12px;padding:12px;background:#f8f9fa;border-radius:4px;">
                            <label style="display:block;font-size:13px;font-weight:500;color:#555;margin-bottom:6px;">表名模式：</label>
                            <input type="text" id="tableFilter" placeholder="例如: user_* 或 table1,table2" style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:4px;font-size:13px;" />
                            <div style="font-size:11px;color:#999;margin-top:4px;">支持通配符 * 和 ?，多个表用逗号分隔</div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-primary" onclick="executeVectorIndex()">开始同步</button>
                    <button type="button" class="btn btn-secondary" onclick="closeVectorIndexModal()">取消</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 监听单选按钮变化，显示/隐藏表范围输入框
    document.querySelectorAll('#vectorIndexModal input[name=syncMode]').forEach(radio => {
        radio.addEventListener('change', function() {
            const tableFilterInput = document.getElementById('tableFilterInput');
            if (this.value === 'range') {
                tableFilterInput.style.display = 'block';
            } else {
                tableFilterInput.style.display = 'none';
            }
        });
    });

    // 默认选中增量同步，设置边框颜色
    document.querySelector('#vectorIndexModal input[name=syncMode][value=incremental]').parentElement.parentElement.style.borderColor = '#4CAF50';
}

// 执行向量索引同步
async function executeVectorIndex() {
    const modal = document.getElementById('vectorIndexModal');
    const syncMode = document.querySelector('#vectorIndexModal input[name=syncMode]:checked').value;
    const tableFilter = document.getElementById('tableFilter')?.value.trim() || '';

    // 验证输入
    if (syncMode === 'range' && !tableFilter) {
        showToast('请输入表名模式', 'warning');
        return;
    }

    // 更新弹窗内容为进度显示
    const modalContent = modal.querySelector('.modal-content');
    modalContent.innerHTML = `
        <div class="modal-header">
            <h2>🔤 建立向量索引</h2>
        </div>
        <div class="modal-body">
            <div style="padding:20px;text-align:center;">
                <div id="vectorIndexProgress" style="margin-bottom:16px;">
                    <div style="font-size:14px;color:#666;">正在建立向量索引...</div>
                    <div style="margin-top:12px;font-size:13px;color:#999;">数据库: ${currentDb.name}</div>
                    <div style="margin-top:8px;font-size:12px;color:#999;">同步模式: ${syncMode === 'incremental' ? '增量同步' : syncMode === 'full' ? '全量同步' : '选定范围'}</div>
                </div>
                <div id="vectorIndexResult" style="display:none;"></div>
            </div>
        </div>
        <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="closeVectorIndexModal()">关闭</button>
        </div>
    `;

    try {
        // 构建请求参数
        const requestBody = { db_id: currentDb.id };

        if (syncMode === 'full') {
            requestBody.sync_mode = 'full';
        } else if (syncMode === 'range') {
            requestBody.sync_mode = 'filtered';
            requestBody.table_filter = tableFilter;
        }
        // 增量同步不需要额外参数

        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/embedding-sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        const progressEl = document.getElementById('vectorIndexProgress');
        const resultEl = document.getElementById('vectorIndexResult');

        if (data.success) {
            progressEl.style.display = 'none';
            resultEl.style.display = 'block';
            resultEl.innerHTML = `
                <div style="color:#28a745;font-size:16px;margin-bottom:12px;">✅ 向量索引建立成功</div>
                <div style="font-size:13px;color:#666;line-height:1.8;">
                    <div>新增向量: ${data.synced || 0}</div>
                    <div>总向量数: ${data.vectors || 0}</div>
                </div>
            `;
        } else {
            progressEl.style.display = 'none';
            resultEl.style.display = 'block';
            resultEl.innerHTML = `
                <div style="color:#dc3545;font-size:16px;">❌ 建立失败</div>
                <div style="font-size:13px;color:#666;margin-top:8px;">${data.message || '未知错误'}</div>
            `;
        }
    } catch (error) {
        const progressEl = document.getElementById('vectorIndexProgress');
        const resultEl = document.getElementById('vectorIndexResult');
        progressEl.style.display = 'none';
        resultEl.style.display = 'block';
        resultEl.innerHTML = `
            <div style="color:#dc3545;font-size:16px;">❌ 请求失败</div>
            <div style="font-size:13px;color:#666;margin-top:8px;">${error.message}</div>
        `;
    }
}

function closeVectorIndexModal() {
    const modal = document.getElementById('vectorIndexModal');
    if (modal) modal.remove();
}

// 显示规则选择对话框
function showRelationScanRulesModal() {
    return new Promise((resolve) => {
        const modalHtml = `
            <div id="relationScanRulesModal" class="modal" style="display:flex;">
                <div class="modal-content" style="max-width:550px;">
                    <div class="modal-header">
                        <h2>🔗 选择扫描规则</h2>
                    </div>
                    <div class="modal-body" style="padding:20px;">
                        <div style="font-size:13px;color:#666;margin-bottom:16px;">
                            请选择用于扫描关系候选的规则，默认全部启用
                        </div>
                        <div style="display:flex;flex-direction:column;gap:12px;">
                            <label style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:#f8f9fa;border-radius:4px;cursor:pointer;">
                                <input type="checkbox" id="rule-exact-match" checked style="margin-top:2px;width:16px;height:16px;">
                                <div style="flex:1;">
                                    <div style="font-size:14px;font-weight:600;color:#333;">精确匹配</div>
                                    <div style="font-size:12px;color:#666;margin-top:4px;">字段名完全相同</div>
                                </div>
                            </label>
                            <label style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:#f8f9fa;border-radius:4px;cursor:pointer;">
                                <input type="checkbox" id="rule-naming-style" checked style="margin-top:2px;width:16px;height:16px;">
                                <div style="flex:1;">
                                    <div style="font-size:14px;font-weight:600;color:#333;">命名风格</div>
                                    <div style="font-size:12px;color:#666;margin-top:4px;">id ↔ table_id 命名模式</div>
                                </div>
                            </label>
                            <label style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:#f8f9fa;border-radius:4px;cursor:pointer;">
                                <input type="checkbox" id="rule-type-keyword" checked style="margin-top:2px;width:16px;height:16px;">
                                <div style="flex:1;">
                                    <div style="font-size:14px;font-weight:600;color:#333;">类型+关键词</div>
                                    <div style="font-size:12px;color:#666;margin-top:4px;">类型匹配 + 名称部分相似</div>
                                </div>
                            </label>
                            <label style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:#f8f9fa;border-radius:4px;cursor:pointer;">
                                <input type="checkbox" id="rule-prefix-consistency" checked style="margin-top:2px;width:16px;height:16px;">
                                <div style="flex:1;">
                                    <div style="font-size:14px;font-weight:600;color:#333;">前缀一致性</div>
                                    <div style="font-size:12px;color:#666;margin-top:4px;">表名前缀重合越多，置信度越高</div>
                                </div>
                            </label>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeRelationScanRulesModal()">取消</button>
                        <button type="button" class="btn btn-primary" onclick="confirmRelationScanRules()">开始扫描</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // 保存 resolve 函数供后续使用
        window._relationScanRulesResolve = resolve;
    });
}

function closeRelationScanRulesModal(result = null) {
    const modal = document.getElementById('relationScanRulesModal');
    if (modal) modal.remove();
    if (window._relationScanRulesResolve) {
        window._relationScanRulesResolve(result);
        delete window._relationScanRulesResolve;
    }
}

function confirmRelationScanRules() {
    const rules = [];

    if (document.getElementById('rule-exact-match').checked) {
        rules.push('exact_match');
    }
    if (document.getElementById('rule-naming-style').checked) {
        rules.push('naming_style');
    }
    if (document.getElementById('rule-type-keyword').checked) {
        rules.push('type_keyword');
    }
    if (document.getElementById('rule-prefix-consistency').checked) {
        rules.push('prefix_consistency');
    }

    if (rules.length === 0) {
        showToast('请至少选择一个扫描规则', 'warning');
        return;
    }

    // 直接传入 rules，不再分开调用
    closeRelationScanRulesModal(rules);
}

// 扫描关系候选并确认
async function handleRelationIndex() {
    console.log('handleRelationIndex called, currentDb:', currentDb);
    if (!currentDb) {
        showToast('请先在左侧列表中选择一个数据库', 'warning');
        return;
    }

    // 显示规则选择对话框
    const selectedRules = await showRelationScanRulesModal();

    // 用户取消选择
    if (!selectedRules) {
        return;
    }

    // 显示扫描进度
    const scanModalHtml = `
        <div id="relationScanModal" class="modal" style="display:flex;">
            <div class="modal-content" style="max-width:500px;">
                <div class="modal-header">
                    <h2>🔗 扫描关系候选</h2>
                </div>
                <div class="modal-body">
                    <div style="padding:20px;text-align:center;">
                        <div style="font-size:14px;color:#666;">正在扫描关系候选...</div>
                        <div style="margin-top:12px;font-size:13px;color:#999;">数据库: ${currentDb.name}</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', scanModalHtml);

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/relation-scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ db_id: currentDb.id, rules: selectedRules })
        });

        const data = await response.json();

        // 移除扫描进度弹窗
        const scanModal = document.getElementById('relationScanModal');
        if (scanModal) scanModal.remove();

        if (data.success && data.candidates && data.candidates.length > 0) {
            // 显示候选列表让用户确认
            showRelationCandidates(data.candidates);
        } else if (data.success && (!data.candidates || data.candidates.length === 0)) {
            showToast('未发现新的关系候选', 'info');
        } else {
            showToast('扫描失败: ' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        const scanModal = document.getElementById('relationScanModal');
        if (scanModal) scanModal.remove();
        showToast('扫描失败: ' + error.message, 'error');
    }
}

// 关系候选筛选状态
let relationCandidatesData = [];
let relationFilters = {
    table: '',
    column: '',
    matchType: '',
    minConfidence: 0,
    tableExclude: false,
    columnExclude: false,
    logicMode: 'AND'  // 'AND' 或 'OR'
};

// 显示关系候选列表
function showRelationCandidates(candidates) {
    relationCandidatesData = candidates;
    relationFilters = {
        table: '',
        column: '',
        matchType: '',
        minConfidence: 0,
        tableExclude: false,
        columnExclude: false,
        logicMode: 'AND'
    };

    const modalHtml = `
        <style>
            .relation-filterable:hover {
                color: #764ba2 !important;
                text-decoration-style: solid !important;
            }
            #relationCandidatesModal input[type="text"]:focus,
            #relationCandidatesModal select:focus {
                border-color: #667eea;
                outline: none;
                box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
            }
            #relationCandidatesModal input[type="range"] {
                cursor: pointer;
            }
        </style>
        <div id="relationCandidatesModal" class="modal" style="display:flex;">
            <div class="modal-content" style="max-width:700px;max-height:85vh;">
                <div class="modal-header">
                    <h2>🔗 确认关系候选</h2>
                    <button class="modal-close" onclick="closeRelationCandidatesModal()">&times;</button>
                </div>

                <!-- 筛选栏 -->
                <div style="padding:12px;background:#f8f9fa;border-bottom:1px solid #e9ecef;">
                    <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;align-items:center;">
                        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:220px;">
                            <input type="text" id="relationTableFilter" placeholder="筛选表名（逗号分隔多个）..."
                                style="flex:1;min-width:120px;padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;"
                                oninput="applyRelationFilters()">
                            <label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#666;white-space:nowrap;cursor:pointer;">
                                <input type="checkbox" id="relationTableExclude" onchange="applyRelationFilters()" style="width:14px;height:14px;">
                                <span>排除</span>
                            </label>
                        </div>
                        <button type="button" id="relationLogicModeBtn" onclick="toggleRelationLogicMode()"
                            style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#475569;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">
                            AND
                        </button>
                        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:220px;">
                            <input type="text" id="relationColumnFilter" placeholder="筛选字段名（逗号分隔多个）..."
                                style="flex:1;min-width:120px;padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;"
                                oninput="applyRelationFilters()">
                            <label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#666;white-space:nowrap;cursor:pointer;">
                                <input type="checkbox" id="relationColumnExclude" onchange="applyRelationFilters()" style="width:14px;height:14px;">
                                <span>排除</span>
                            </label>
                        </div>
                        <select id="relationMatchTypeFilter"
                            style="flex:1;min-width:120px;padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#fff;"
                            onchange="applyRelationFilters()">
                            <option value="">全部类型</option>
                        </select>
                        <button type="button" onclick="clearRelationFilters()"
                            style="padding:6px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#475569;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">
                            清空
                        </button>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <label style="font-size:13px;color:#666;white-space:nowrap;">最低置信度:</label>
                        <input type="range" id="relationConfidenceSlider" min="0" max="100" value="0"
                            style="flex:1;" oninput="updateConfidenceFilter(this.value)">
                        <span id="relationConfidenceValue" style="font-size:13px;color:#666;min-width:45px;">0%</span>
                    </div>
                    <div id="relationFilterStats" style="margin-top:8px;font-size:13px;color:#666;"></div>
                </div>

                <div class="modal-body" style="max-height:400px;overflow-y:auto;padding:0;" id="relationCandidatesList">
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="closeRelationCandidatesModal()">取消</button>
                    <button type="button" class="btn btn-primary" onclick="confirmRelationCandidates()">确认选中</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 初始化匹配类型下拉框
    initMatchTypeFilter();
    // 渲染候选列表
    renderRelationCandidates();
}

// 初始化匹配类型筛选下拉框
function initMatchTypeFilter() {
    const matchTypes = [...new Set(relationCandidatesData.map(c => c.match_type))].sort();
    const select = document.getElementById('relationMatchTypeFilter');

    matchTypes.forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type;
        select.appendChild(option);
    });
}

// 更新置信度筛选
function updateConfidenceFilter(value) {
    document.getElementById('relationConfidenceValue').textContent = value + '%';
    applyRelationFilters();
}

// 应用筛选条件
function applyRelationFilters() {
    const tableFilter = document.getElementById('relationTableFilter').value.trim().toLowerCase();
    const columnFilter = document.getElementById('relationColumnFilter').value.trim().toLowerCase();
    const matchTypeFilter = document.getElementById('relationMatchTypeFilter').value;
    const confidenceFilter = parseInt(document.getElementById('relationConfidenceSlider').value) / 100;
    const tableExclude = document.getElementById('relationTableExclude').checked;
    const columnExclude = document.getElementById('relationColumnExclude').checked;
    const logicMode = document.getElementById('relationLogicModeBtn').textContent.trim();

    relationFilters = {
        table: tableFilter,
        column: columnFilter,
        matchType: matchTypeFilter,
        minConfidence: confidenceFilter,
        tableExclude: tableExclude,
        columnExclude: columnExclude,
        logicMode: logicMode
    };

    // 排除模式视觉反馈
    const tableInput = document.getElementById('relationTableFilter');
    const columnInput = document.getElementById('relationColumnFilter');
    tableInput.style.borderColor = tableExclude ? '#ef4444' : '#e2e8f0';
    columnInput.style.borderColor = columnExclude ? '#ef4444' : '#e2e8f0';

    renderRelationCandidates();
}

// 切换 AND/OR 逻辑
function toggleRelationLogicMode() {
    const btn = document.getElementById('relationLogicModeBtn');
    const current = btn.textContent.trim();
    btn.textContent = current === 'AND' ? 'OR' : 'AND';
    btn.style.background = current === 'AND' ? '#e0e7ff' : '#fff';
    applyRelationFilters();
}

// 清空所有筛选条件
function clearRelationFilters() {
    document.getElementById('relationTableFilter').value = '';
    document.getElementById('relationColumnFilter').value = '';
    document.getElementById('relationMatchTypeFilter').value = '';
    document.getElementById('relationConfidenceSlider').value = 0;
    document.getElementById('relationConfidenceValue').textContent = '0%';
    document.getElementById('relationTableExclude').checked = false;
    document.getElementById('relationColumnExclude').checked = false;
    document.getElementById('relationLogicModeBtn').textContent = 'AND';
    document.getElementById('relationLogicModeBtn').style.background = '#fff';
    document.getElementById('relationTableFilter').style.borderColor = '#e2e8f0';
    document.getElementById('relationColumnFilter').style.borderColor = '#e2e8f0';
    applyRelationFilters();
}

// 快速筛选 - 点击标签（追加模式，逗号分隔）
function quickFilterRelation(type, value) {
    const inputId = type === 'table' ? 'relationTableFilter' :
                    type === 'column' ? 'relationColumnFilter' : null;
    if (!inputId) {
        // matchType 保持替换模式
        document.getElementById('relationMatchTypeFilter').value = value;
        applyRelationFilters();
        return;
    }
    const input = document.getElementById(inputId);
    const current = input.value.trim();
    if (!current) {
        input.value = value;
    } else {
        // 检查是否已存在
        const parts = current.split(',').map(p => p.trim().toLowerCase());
        if (!parts.includes(value.toLowerCase())) {
            input.value = current + ',' + value;
        }
    }
    applyRelationFilters();
}

// 全选/取消全选当前筛选结果
function toggleSelectAllRelation(checked) {
    const checkboxes = document.querySelectorAll('.relation-candidate-checkbox');
    checkboxes.forEach(cb => cb.checked = checked);
}

// 多值匹配辅助函数：支持逗号分隔的多个筛选词
function matchMultiValue(text, filterValue) {
    if (!filterValue) return true;
    const parts = filterValue.split(',').map(p => p.trim()).filter(p => p);
    if (parts.length === 0) return true;
    const textLower = text.toLowerCase();
    return parts.some(p => textLower.includes(p.toLowerCase()));
}

// 渲染关系候选列表
function renderRelationCandidates() {
    const filtered = relationCandidatesData.filter(c => {
        // 表名筛选（支持排除、多值逗号分隔）
        let tablePass = true;
        if (relationFilters.table) {
            const tableMatch = matchMultiValue(c.table1, relationFilters.table) ||
                              matchMultiValue(c.table2, relationFilters.table);
            tablePass = relationFilters.tableExclude ? !tableMatch : tableMatch;
            if (!tablePass && relationFilters.logicMode === 'AND') return false;
        }

        // 字段名筛选（支持排除、多值逗号分隔）
        if (relationFilters.column) {
            const columnMatch = matchMultiValue(c.col1, relationFilters.column) ||
                               matchMultiValue(c.col2, relationFilters.column);
            const columnPass = relationFilters.columnExclude ? !columnMatch : columnMatch;
            if (!columnPass && relationFilters.logicMode === 'AND') return false;
            // OR 模式下，只要表名或字段名有一个通过就通过
            if (relationFilters.logicMode === 'OR' && relationFilters.table) {
                if (tablePass || columnPass) return true;
                return false;
            }
            if (!columnPass) return false;
        } else if (relationFilters.logicMode === 'OR' && relationFilters.table) {
            // 只有表名筛选，OR 模式下表名通过就行
            if (tablePass) return true;
        }

        // 匹配类型筛选
        if (relationFilters.matchType && c.match_type !== relationFilters.matchType) {
            return false;
        }

        // 置信度筛选
        if (c.confidence < relationFilters.minConfidence) {
            return false;
        }

        return true;
    });

    // 更新统计信息和全选框
    const statsEl = document.getElementById('relationFilterStats');
    statsEl.innerHTML = `
        <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="checkbox" id="relationSelectAll" onchange="toggleSelectAllRelation(this.checked)" style="width:14px;height:14px;">
            <span>全选</span>
        </label>
        <span style="margin:0 8px;color:#ddd;">|</span>
        <span>显示 <strong style="color:#667eea;">${filtered.length}</strong> / ${relationCandidatesData.length} 个候选</span>
    `;

    // 渲染列表
    const listEl = document.getElementById('relationCandidatesList');

    if (filtered.length === 0) {
        listEl.innerHTML = `
            <div style="text-align:center;color:#718096;padding:40px 20px;">
                <div style="font-size:48px;margin-bottom:12px;">🔍</div>
                <div>未找到匹配的关系候选</div>
            </div>
        `;
        return;
    }

    const candidatesHtml = filtered.map(c => `
        <div style="padding:10px;border-bottom:1px solid #eee;">
            <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;">
                <input type="checkbox" class="relation-candidate-checkbox" data-id="${c.id}" style="margin-top:3px;width:16px;height:16px;">
                <div style="flex:1;">
                    <div style="font-size:13px;font-weight:600;color:#333;">
                        <span class="relation-filterable" onclick="quickFilterRelation('table', '${escapeHtml(c.table1)}'); event.stopPropagation();"
                              style="cursor:pointer;color:#667eea;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px;"
                              title="点击筛选此表">${escapeHtml(c.table1)}</span>
                        <span style="color:#999;">→</span>
                        <span class="relation-filterable" onclick="quickFilterRelation('table', '${escapeHtml(c.table2)}'); event.stopPropagation();"
                              style="cursor:pointer;color:#667eea;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px;"
                              title="点击筛选此表">${escapeHtml(c.table2)}</span>
                    </div>
                    <div style="font-size:12px;color:#666;margin-top:4px;">
                        关联字段:
                        <span class="relation-filterable" onclick="quickFilterRelation('column', '${escapeHtml(c.col1)}'); event.stopPropagation();"
                              style="cursor:pointer;color:#667eea;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px;"
                              title="点击筛选此字段">${escapeHtml(c.col1)}</span>
                        <span style="color:#999;">=</span>
                        <span class="relation-filterable" onclick="quickFilterRelation('column', '${escapeHtml(c.col2)}'); event.stopPropagation();"
                              style="cursor:pointer;color:#667eea;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px;"
                              title="点击筛选此字段">${escapeHtml(c.col2)}</span>
                        <br>
                        置信度: <strong style="color:${c.confidence >= 0.8 ? '#48bb78' : c.confidence >= 0.5 ? '#ed8936' : '#718096'};">${(c.confidence * 100).toFixed(1)}%</strong>
                        ·
                        <span class="relation-filterable" onclick="quickFilterRelation('matchType', '${escapeHtml(c.match_type)}'); event.stopPropagation();"
                              style="cursor:pointer;color:#667eea;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px;"
                              title="点击筛选此类型">${escapeHtml(c.match_type)}</span>
                        <br>
                        <span style="color:#888;">${escapeHtml(c.reason)}</span>
                    </div>
                </div>
            </label>
        </div>
    `).join('');

    listEl.innerHTML = candidatesHtml;
}

// 确认关系候选
async function confirmRelationCandidates() {
    const checkboxes = document.querySelectorAll('.relation-candidate-checkbox:checked');
    const relationIds = Array.from(checkboxes).map(cb => parseInt(cb.dataset.id));

    if (relationIds.length === 0) {
        showToast('请至少选择一个关系候选', 'warning');
        return;
    }

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/relation-confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ db_id: currentDb.id, relations: relationIds })
        });

        const data = await response.json();

        if (data.success) {
            closeRelationCandidatesModal();
            showToast(`成功确认 ${relationIds.length} 个关系`, 'success');
        } else {
            showToast('确认失败: ' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('确认失败: ' + error.message, 'error');
    }
}

function closeRelationCandidatesModal() {
    const modal = document.getElementById('relationCandidatesModal');
    if (modal) modal.remove();
}

// 显示向量预览
async function showVectorPreview() {
    if (!currentDb) {
        showToast('请先在左侧列表中选择一个数据库', 'warning');
        return;
    }

    // 加载第一页数据
    await loadVectorPreviewPage(1);
}

// 加载向量预览分页数据
async function loadVectorPreviewPage(page) {
    const pageSize = 50;

    // 创建或更新弹窗
    let modal = document.getElementById('vectorPreviewModal');
    if (!modal) {
        const modalHtml = `
            <div id="vectorPreviewModal" class="modal" style="display:flex;">
                <div class="modal-content" style="max-width:1100px;max-height:85vh;">
                    <div class="modal-header">
                        <h2>👁️ 向量索引预览</h2>
                        <button class="modal-close" onclick="closeVectorPreviewModal()">&times;</button>
                    </div>
                    <div class="modal-body" style="max-height:500px;overflow-y:auto;padding:15px;">
                        <!-- 工具栏 -->
                        <div style="display:flex;gap:10px;margin-bottom:15px;flex-wrap:wrap;align-items:center;">
                            <button type="button" class="btn btn-primary" onclick="showAddVectorModal()">➕ 新增向量</button>
                            <div style="flex:1;"></div>
                            <button type="button" class="btn" style="background:#dc3545;color:#fff;" onclick="deleteSelectedVectors()">🗑️ 删除选中</button>
                        </div>
                        <div id="vectorPreviewContent" style="text-align:center;padding:40px;color:#999;">加载中...</div>
                    </div>
                    <div class="modal-footer" style="justify-content:space-between;">
                        <div style="display:flex;gap:8px;align-items:center;">
                            <input type="checkbox" id="vectorSelectAll" onchange="toggleVectorSelectAll()" style="margin-right:8px;">
                            <label for="vectorSelectAll" style="font-size:13px;margin-right:8px;">全选</label>
                        </div>
                        <div id="vectorPreviewInfo" style="font-size:13px;color:#666;"></div>
                        <div style="display:flex;gap:8px;">
                            <button type="button" class="btn btn-secondary" id="vectorPrevBtn" onclick="loadVectorPreviewPage(currentVectorPage - 1)">上一页</button>
                            <button type="button" class="btn btn-secondary" id="vectorNextBtn" onclick="loadVectorPreviewPage(currentVectorPage + 1)">下一页</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    const contentEl = document.getElementById('vectorPreviewContent');
    const infoEl = document.getElementById('vectorPreviewInfo');

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/vectors?db_id=${currentDb.id}&page=${page}&page_size=${pageSize}`);
        const data = await response.json();

        if (data.success) {
            const vectors = data.vectors || [];
            const total = data.total || 0;
            const totalPages = Math.ceil(total / pageSize);

            window.currentVectorPage = page;
            window.currentVectorData = vectors;

            // 清除全选
            const selectAllEl = document.getElementById('vectorSelectAll');
            if (selectAllEl) selectAllEl.checked = false;

            if (vectors.length === 0) {
                contentEl.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">暂无向量索引数据</div>';
                infoEl.textContent = '';
            } else {
                const tableHtml = `
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                        <thead>
                            <tr style="background:#f8f9fa;">
                                <th style="padding:10px;text-align:center;border-bottom:2px solid #dee2e6;width:40px;">✓</th>
                                <th style="padding:10px;text-align:left;border-bottom:2px solid #dee2e6;">表名</th>
                                <th style="padding:10px;text-align:left;border-bottom:2px solid #dee2e6;">索引摘要</th>
                                <th style="padding:10px;text-align:center;border-bottom:2px solid #dee2e6;">向量维度</th>
                                <th style="padding:10px;text-align:left;border-bottom:2px solid #dee2e6;">更新时间</th>
                                <th style="padding:10px;text-align:center;border-bottom:2px solid #dee2e6;width:120px;">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${vectors.map(v => {
                                const sourceParts = [];
                                if (v.comment) sourceParts.push(`表注释：${v.comment}`);
                                if (v.column_count) sourceParts.push(`字段数：${v.column_count}`);
                                if (v.pk_fields) sourceParts.push(`PK：${v.pk_fields}`);
                                if (v.fk_fields) sourceParts.push(`FK：${v.fk_fields}`);
                                const summary = sourceParts.length > 0 ? sourceParts.join('；') : '未返回表元数据';
                                const display = [];
                                if (v.column_count) display.push(`${v.column_count} 字段`);
                                if (v.pk_fields) display.push(`PK ${v.pk_fields}`);
                                if (v.fk_fields) display.push(`FK ${v.fk_fields}`);
                                if (display.length === 0) display.push('元数据缺失');
                                const encodedTableName = encodeURIComponent(v.table_name || '');
                                return `
                                <tr data-table="${v.table_name || ''}">
                                    <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">
                                        <input type="checkbox" class="vector-checkbox" value="${v.table_name}">
                                    </td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;">${v.table_name || '-'}</td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${summary}">${display.join(' · ')}</td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">${v.dimension || '-'}</td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;">${v.updated_at || v.created_at || '-'}</td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">
                                        <button type="button" class="btn btn-secondary" style="padding:4px 8px;font-size:12px;margin-right:4px;" onclick="showEditVectorModal('${encodedTableName}')">编辑</button>
                                        <button type="button" class="btn" style="padding:4px 8px;font-size:12px;background:#dc3545;color:#fff;" onclick="deleteVector('${encodedTableName}')">删除</button>
                                    </td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                `;
                contentEl.innerHTML = tableHtml;
                infoEl.textContent = `共 ${total} 条， 第 ${page}/${totalPages} 页`;

                // 更新按钮状态
                document.getElementById('vectorPrevBtn').disabled = page <= 1;
                document.getElementById('vectorNextBtn').disabled = page >= totalPages;
            }
        } else {
            contentEl.innerHTML = `<div style="text-align:center;padding:40px;color:#dc3545;">加载失败: ${data.message || '未知错误'}</div>`;
        }
    } catch (error) {
        contentEl.innerHTML = `<div style="text-align:center;padding:40px;color:#dc3545;">加载失败: ${error.message}</div>`;
    }
}

// 全选/取消全选 向量
function toggleVectorSelectAll() {
    const selectAll = document.getElementById('vectorSelectAll').checked;
    document.querySelectorAll('.vector-checkbox').forEach(cb => {
        cb.checked = selectAll;
    });
}

// 删除选中的向量
async function deleteSelectedVectors() {
    const checked = document.querySelectorAll('.vector-checkbox:checked');
    if (checked.length === 0) {
        showToast('请先选择要删除的向量', 'warning');
        return;
    }

    if (!confirm(`确定要删除选中的 ${checked.length} 条向量吗？此操作不可恢复。`)) {
        return;
    }

    const tableNames = Array.from(checked).map(cb => cb.value);

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/vectors`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                database_id: currentDb.id,
                table_names: tableNames
            })
        });

        const data = await response.json();
        if (data.success) {
            showToast(`成功删除 ${data.deleted_count} 条向量`, 'success');
            loadVectorPreviewPage(currentVectorPage);
        } else {
            showToast('删除失败: ' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
    }
}

// 删除单个向量
async function deleteVector(tableName) {
    if (!confirm(`确定要删除表 "${tableName}" 的向量吗？此操作不可恢复。`)) {
        return;
    }

    // 前端先移除行，让用户感觉更快
    const row = document.querySelector(`tr[data-table="${tableName}"]`);
    if (row) {
        row.style.opacity = '0.5';
        row.innerHTML = `<td colspan="5" style="text-align:center;color:#888;"><span class="spinner"></span> 正在删除...</td>`;
    }

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/vectors`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                database_id: currentDb.id,
                table_names: [tableName]
            })
        });

        const data = await response.json();
        if (data.success) {
            showToast('删除成功', 'success');
            loadVectorPreviewPage(currentVectorPage);
        } else {
            showToast('删除失败: ' + (data.message || '未知错误'), 'error');
            loadVectorPreviewPage(currentVectorPage); // 失败也刷新恢复
        }
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
        loadVectorPreviewPage(currentVectorPage); // 失败刷新恢复
    }
}

// 显示新增向量弹窗
async function showAddVectorModal() {
    // 先获取该数据库的表列表
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables`);
        const data = await response.json();

        if (!data.success) {
            showToast('获取表列表失败: ' + data.message, 'error');
            return;
        }

        const tables = data.tables || [];
        const existingVectors = window.currentVectorData || [];
        const existingTableNames = new Set(existingVectors.map(v => v.table_name));

        // 过滤掉已有向量的表
        const availableTables = tables.filter(t => !existingTableNames.has(t.name));

        if (availableTables.length === 0) {
            showToast('所有表都已有向量索引', 'warning');
            return;
        }

        const tableOptions = availableTables.map(t => `<option value="${t.name}">${t.name}${t.comment ? ' (' + t.comment + ')' : ''}</option>`).join('');

        const modalHtml = `
            <div id="addVectorModal" class="modal" style="display:flex;">
                <div class="modal-content" style="max-width:500px;">
                    <div class="modal-header">
                        <h2>➕ 新增向量</h2>
                        <button class="modal-close" onclick="closeAddVectorModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">选择表（可多选）:</label>
                            <select id="addVectorTables" multiple style="width:100%;height:200px;padding:8px;border:1px solid #ddd;border-radius:4px;">
                                ${tableOptions}
                            </select>
                            <div style="font-size:12px;color:#666;margin-top:5px;">按住 Ctrl 或 Cmd 可多选</div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeAddVectorModal()">取消</button>
                        <button type="button" class="btn btn-primary" onclick="createVectors()">创建向量</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    } catch (error) {
        showToast('获取表列表失败: ' + error.message, 'error');
    }
}

function closeAddVectorModal() {
    const modal = document.getElementById('addVectorModal');
    if (modal) modal.remove();
}

// 创建向量
async function createVectors() {
    const select = document.getElementById('addVectorTables');
    const selectedTables = Array.from(select.selectedOptions).map(opt => opt.value);

    if (selectedTables.length === 0) {
        showToast('请至少选择一个表', 'warning');
        return;
    }

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/vectors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                database_id: currentDb.id,
                tables: selectedTables
            })
        });

        const data = await response.json();
        if (data.success) {
            showToast(`成功创建 ${data.synced} 个向量`, 'success');
            closeAddVectorModal();
            loadVectorPreviewPage(currentVectorPage);
        } else {
            showToast('创建失败: ' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('创建失败: ' + error.message, 'error');
    }
}

// 显示编辑向量弹窗（重新生成向量）
function showEditVectorModal(tableName) {
    tableName = decodeURIComponent(tableName);
    if (!confirm(`确定要重新生成表 "${tableName}" 的向量吗？\n这将删除旧向量并重新生成。`)) {
        return;
    }

    updateVector(tableName);
}

// 更新向量
async function updateVector(tableName) {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/vectors`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                database_id: currentDb.id,
                tables: [tableName]
            })
        });

        const data = await response.json();
        if (data.success) {
            showToast(`向量更新成功`, 'success');
            loadVectorPreviewPage(currentVectorPage);
        } else {
            showToast('更新失败: ' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('更新失败: ' + error.message, 'error');
    }
}

function closeVectorPreviewModal() {
    const modal = document.getElementById('vectorPreviewModal');
    if (modal) modal.remove();
}

// 显示关系预览
async function showRelationPreview() {

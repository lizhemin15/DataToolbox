

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
    if (!currentDb) {
        showToast('请先在左侧列表中选择一个数据库', 'warning');
        return;
    }

    // 加载第一页数据
    await loadRelationPreviewPage(1);
}

// 加载关系预览分页数据
async function loadRelationPreviewPage(page) {
    const pageSize = 50;

    // 从页面获取筛选条件
    const searchInput = document.getElementById('relationSearchInput');
    const matchTypeSelect = document.getElementById('relationMatchTypeSelect');
    const keyword = searchInput ? searchInput.value.trim() : '';
    const matchType = matchTypeSelect ? matchTypeSelect.value : '';

    // 创建或更新弹窗
    let modal = document.getElementById('relationPreviewModal');
    if (!modal) {
        const modalHtml = `
            <div id="relationPreviewModal" class="modal" style="display:flex;">
                <div class="modal-content" style="max-width:1200px;max-height:85vh;">
                    <div class="modal-header">
                        <h2>👁️ 关系索引预览</h2>
                        <button class="modal-close" onclick="closeRelationPreviewModal()">&times;</button>
                    </div>
                    <div class="modal-body" style="max-height:500px;overflow-y:auto;padding:15px;">
                        <!-- 工具栏 -->
                        <div style="display:flex;gap:10px;margin-bottom:15px;flex-wrap:wrap;align-items:center;">
                            <input type="text" id="relationSearchInput" placeholder="搜索表名/字段名..." 
                                style="padding:8px 12px;border:1px solid #ddd;border-radius:4px;flex:1;min-width:200px;max-width:300px;"
                                onkeyup="if(event.key==='Enter')loadRelationPreviewPage(1)">
                            <select id="relationMatchTypeSelect" 
                                style="padding:8px 12px;border:1px solid #ddd;border-radius:4px;min-width:150px;"
                                onchange="loadRelationPreviewPage(1)">
                                <option value="">全部匹配类型</option>
                            </select>
                            <button type="button" class="btn btn-primary" onclick="loadRelationPreviewPage(1)">🔍 搜索</button>
                            <button type="button" class="btn btn-secondary" onclick="clearRelationFilters()">清空</button>
                            <div style="flex:1;"></div>
                            <button type="button" class="btn btn-primary" onclick="showAddRelationModal()">➕ 新增关系</button>
                            <button type="button" class="btn" style="background:#dc3545;color:#fff;" onclick="deleteSelectedRelations()">🗑️ 删除选中</button>
                        </div>
                        <div id="relationPreviewContent" style="text-align:center;padding:40px;color:#999;">加载中...</div>
                    </div>
                    <div class="modal-footer" style="justify-content:space-between;">
                        <div id="relationPreviewInfo" style="font-size:13px;color:#666;"></div>
                        <div style="display:flex;gap:8px;align-items:center;">
                            <input type="checkbox" id="relationSelectAll" onchange="toggleRelationSelectAll()" style="margin-right:8px;">
                            <label for="relationSelectAll" style="font-size:13px;margin-right:8px;">全选</label>
                            <button type="button" class="btn btn-secondary" id="relationPrevBtn" onclick="loadRelationPreviewPage(currentRelationPage - 1)">上一页</button>
                            <button type="button" class="btn btn-secondary" id="relationNextBtn" onclick="loadRelationPreviewPage(currentRelationPage + 1)">下一页</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    const contentEl = document.getElementById('relationPreviewContent');
    const infoEl = document.getElementById('relationPreviewInfo');
    const matchTypeSelectEl = document.getElementById('relationMatchTypeSelect');

    try {
        // 调用 relation-preview API（从 data-store.json 读取）
        let url = `${API_BASE}/api/v1/retrieval/relation-preview?db_id=${currentDb.id}`;
        
        const response = await fetchWithAuth(url);
        const data = await response.json();

        if (data.success) {
            // 转换字段名：table1/col1/table2/col2 → source_table/source_field/target_table/target_field
            const rawRelations = data.relations || [];
            const relations = rawRelations.map(r => ({
                id: r.id,
                source_table: r.table1,
                source_field: r.col1,
                target_table: r.table2,
                target_field: r.col2,
                match_type: r.type,
                created_at: '-'
            }));
            const total = relations.length;
            const totalPages = 1;
            const matchTypes = [...new Set(relations.map(r => r.match_type))];

            window.currentRelationPage = page;

            // 初始化匹配类型下拉（只在第一次加载时）
            if (matchTypes.length > 0 && matchTypeSelectEl.options.length <= 1) {
                matchTypes.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t;
                    opt.textContent = t;
                    if (t === matchType) opt.selected = true;
                    matchTypeSelectEl.appendChild(opt);
                });
            }

            // 恢复筛选条件
            const searchInputEl = document.getElementById('relationSearchInput');
            if (searchInputEl) searchInputEl.value = keyword;

            // 清除选中状态
            document.getElementById('relationSelectAll').checked = false;

            if (relations.length === 0) {
                contentEl.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">暂无关系索引数据</div>';
                infoEl.textContent = keyword ? `共 ${total} 条（筛选结果）` : '共 0 条';
            } else {
                // 保存当前页数据用于删除
                window.currentRelationData = relations;
                
                const tableHtml = `
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                        <thead>
                            <tr style="background:#f8f9fa;">
                                <th style="padding:10px;text-align:center;border-bottom:2px solid #dee2e6;width:40px;">✓</th>
                                <th style="padding:10px;text-align:left;border-bottom:2px solid #dee2e6;">源表</th>
                                <th style="padding:10px;text-align:left;border-bottom:2px solid #dee2e6;">源字段</th>
                                <th style="padding:10px;text-align:center;border-bottom:2px solid #dee2e6;">→</th>
                                <th style="padding:10px;text-align:left;border-bottom:2px solid #dee2e6;">目标表</th>
                                <th style="padding:10px;text-align:left;border-bottom:2px solid #dee2e6;">目标字段</th>
                                <th style="padding:10px;text-align:center;border-bottom:2px solid #dee2e6;">匹配类型</th>
                                <th style="padding:10px;text-align:left;border-bottom:2px solid #dee2e6;">创建时间</th>
                                <th style="padding:10px;text-align:center;border-bottom:2px solid #dee2e6;width:120px;">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${relations.map(r => `
                                <tr data-id="${r.id}">
                                    <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">
                                        <input type="checkbox" class="relation-checkbox" value="${r.id}">
                                    </td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;">${r.source_table || '-'}</td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;">${r.source_field || '-'}</td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;color:#999;">→</td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;">${r.target_table || '-'}</td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;">${r.target_field || '-'}</td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">
                                        <span style="background:#e9ecef;padding:2px 8px;border-radius:3px;font-size:12px;">${r.match_type || '-'}</span>
                                    </td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;">${r.created_at || '-'}</td>
                                    <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">
                                        <button type="button" class="btn btn-secondary" style="padding:4px 8px;font-size:12px;margin-right:4px;" onclick="showEditRelationModal(${r.id})">编辑</button>
                                        <button type="button" class="btn" style="padding:4px 8px;font-size:12px;background:#dc3545;color:#fff;" onclick="deleteRelation(${r.id})">删除</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
                contentEl.innerHTML = tableHtml;
                
                const filterInfo = keyword || matchType ? '（筛选结果）' : '';
                infoEl.textContent = `共 ${total} 条${filterInfo}，第 ${page}/${totalPages} 页`;

                // 更新按钮状态
                document.getElementById('relationPrevBtn').disabled = page <= 1;
                document.getElementById('relationNextBtn').disabled = page >= totalPages;
            }
        } else {
            contentEl.innerHTML = `<div style="text-align:center;padding:40px;color:#dc3545;">加载失败: ${data.message || '未知错误'}</div>`;
        }
    } catch (error) {
        contentEl.innerHTML = `<div style="text-align:center;padding:40px;color:#dc3545;">加载失败: ${error.message}</div>`;
    }
}

// 清空关系筛选条件
function clearRelationFilters() {
    const searchInput = document.getElementById('relationSearchInput');
    const matchTypeSelect = document.getElementById('relationMatchTypeSelect');
    if (searchInput) searchInput.value = '';
    if (matchTypeSelect) matchTypeSelect.value = '';
    loadRelationPreviewPage(1);
}

// 全选/取消全选
function toggleRelationSelectAll() {
    const selectAll = document.getElementById('relationSelectAll').checked;
    document.querySelectorAll('.relation-checkbox').forEach(cb => {
        cb.checked = selectAll;
    });
}

// 删除选中的关系
async function deleteSelectedRelations() {
    const checked = document.querySelectorAll('.relation-checkbox:checked');
    if (checked.length === 0) {
        showToast('请先选择要删除的关系', 'warning');
        return;
    }

    if (!confirm(`确定要删除选中的 ${checked.length} 条关系吗？此操作不可恢复。`)) {
        return;
    }

    const relationIDs = Array.from(checked).map(cb => parseInt(cb.value));
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/relations`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                database_id: currentDb.id,
                relation_ids: relationIDs
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast(`成功删除 ${data.deleted_count} 条关系`, 'success');
            loadRelationPreviewPage(currentRelationPage);
        } else {
            showToast('删除失败: ' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
    }
}

function closeRelationPreviewModal() {
    const modal = document.getElementById('relationPreviewModal');
    if (modal) modal.remove();
}

// 显示新增关系弹窗
async function showAddRelationModal() {
    try {
        // 获取表列表
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables`);
        const data = await response.json();

        if (!data.success) {
            showToast('获取表列表失败: ' + data.message, 'error');
            return;
        }

        const tables = data.tables || [];
        const tableOptions = tables.map(t => `<option value="${t.name}">${t.name}${t.comment ? ' (' + t.comment + ')' : ''}</option>`).join('');

        const modalHtml = `
            <div id="addRelationModal" class="modal" style="display:flex;">
                <div class="modal-content" style="max-width:600px;">
                    <div class="modal-header">
                        <h2>➕ 新增关系</h2>
                        <button class="modal-close" onclick="closeAddRelationModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">源表:</label>
                            <select id="addRelationSourceTable" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;" onchange="loadSourceFields()">
                                <option value="">请选择源表</option>
                                ${tableOptions}
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">源字段:</label>
                            <select id="addRelationSourceField" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
                                <option value="">请先选择源表</option>
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">目标表:</label>
                            <select id="addRelationTargetTable" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;" onchange="loadTargetFields()">
                                <option value="">请选择目标表</option>
                                ${tableOptions}
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">目标字段:</label>
                            <select id="addRelationTargetField" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
                                <option value="">请先选择目标表</option>
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">匹配类型:</label>
                            <select id="addRelationMatchType" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
                                <option value="exact">精确匹配</option>
                                <option value="case_insensitive">大小写不敏感</option>
                                <option value="naming_style">命名风格相似</option>
                                <option value="type_keyword">类型+关键词</option>
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">关系名称（可选）:</label>
                            <input type="text" id="addRelationName" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;" placeholder="输入关系名称（可选）">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeAddRelationModal()">取消</button>
                        <button type="button" class="btn btn-primary" onclick="createRelation()">创建关系</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    } catch (error) {
        showToast('获取表列表失败: ' + error.message, 'error');
    }
}

function closeAddRelationModal() {
    const modal = document.getElementById('addRelationModal');
    if (modal) modal.remove();
}

// 加载源表字段
async function loadSourceFields() {
    const tableName = document.getElementById('addRelationSourceTable').value;
    const fieldSelect = document.getElementById('addRelationSourceField');

    if (!tableName) {
        fieldSelect.innerHTML = '<option value="">请先选择源表</option>';
        return;
    }

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${tableName}/structure`);
        const data = await response.json();

        if (data.success) {
            const fields = data.columns || [];
            fieldSelect.innerHTML = '<option value="">请选择字段</option>' +
                fields.map(f => `<option value="${f.name}">${f.name}${f.comment ? ' (' + f.comment + ')' : ''}</option>`).join('');
        } else {
            showToast('获取字段列表失败: ' + data.message, 'error');
        }
    } catch (error) {
        showToast('获取字段列表失败: ' + error.message, 'error');
    }
}

// 加载目标表字段
async function loadTargetFields() {
    const tableName = document.getElementById('addRelationTargetTable').value;
    const fieldSelect = document.getElementById('addRelationTargetField');

    if (!tableName) {
        fieldSelect.innerHTML = '<option value="">请先选择目标表</option>';
        return;
    }

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${tableName}/structure`);
        const data = await response.json();

        if (data.success) {
            const fields = data.columns || [];
            fieldSelect.innerHTML = '<option value="">请选择字段</option>' +
                fields.map(f => `<option value="${f.name}">${f.name}${f.comment ? ' (' + f.comment + ')' : ''}</option>`).join('');
        } else {
            showToast('获取字段列表失败: ' + data.message, 'error');
        }
    } catch (error) {
        showToast('获取字段列表失败: ' + error.message, 'error');
    }
}

// 创建关系
async function createRelation() {
    const sourceTable = document.getElementById('addRelationSourceTable').value;
    const sourceField = document.getElementById('addRelationSourceField').value;
    const targetTable = document.getElementById('addRelationTargetTable').value;
    const targetField = document.getElementById('addRelationTargetField').value;
    const matchType = document.getElementById('addRelationMatchType').value;
    const relationName = document.getElementById('addRelationName').value.trim();

    if (!sourceTable || !sourceField || !targetTable || !targetField || !matchType) {
        showToast('请填写所有必填字段', 'warning');
        return;
    }

    try {
        const body = {
            database_id: currentDb.id,
            source_table: sourceTable,
            source_field: sourceField,
            target_table: targetTable,
            target_field: targetField,
            match_type: matchType
        };
        if (relationName) {
            body.relation_name = relationName;
        }

        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/relations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json();
        if (data.success) {
            showToast('关系创建成功', 'success');
            closeAddRelationModal();
            loadRelationPreviewPage(currentRelationPage);
        } else {
            showToast('创建失败: ' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('创建失败: ' + error.message, 'error');
    }
}

// 显示编辑关系弹窗
async function showEditRelationModal(relationId) {
    const relation = (window.currentRelationData || []).find(r => r.id === relationId);
    if (!relation) {
        showToast('未找到关系数据', 'error');
        return;
    }

    try {
        // 获取表列表
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables`);
        const data = await response.json();

        if (!data.success) {
            showToast('获取表列表失败: ' + data.message, 'error');
            return;
        }

        const tables = data.tables || [];
        const tableOptions = tables.map(t => `<option value="${t.name}">${t.name}${t.comment ? ' (' + t.comment + ')' : ''}</option>`).join('');

        const modalHtml = `
            <div id="editRelationModal" class="modal" style="display:flex;">
                <div class="modal-content" style="max-width:600px;">
                    <div class="modal-header">
                        <h2>✏️ 编辑关系</h2>
                        <button class="modal-close" onclick="closeEditRelationModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">源表:</label>
                            <select id="editRelationSourceTable" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;" onchange="loadEditSourceFields()">
                                <option value="">请选择源表</option>
                                ${tableOptions}
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">源字段:</label>
                            <select id="editRelationSourceField" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
                                <option value="">请先选择源表</option>
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">目标表:</label>
                            <select id="editRelationTargetTable" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;" onchange="loadEditTargetFields()">
                                <option value="">请选择目标表</option>
                                ${tableOptions}
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">目标字段:</label>
                            <select id="editRelationTargetField" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
                                <option value="">请先选择目标表</option>
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">匹配类型:</label>
                            <select id="editRelationMatchType" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
                                <option value="exact">精确匹配</option>
                                <option value="case_insensitive">大小写不敏感</option>
                                <option value="naming_style">命名风格相似</option>
                                <option value="type_keyword">类型+关键词</option>
                            </select>
                        </div>
                        <div style="margin-bottom:15px;">
                            <label style="display:block;margin-bottom:5px;font-weight:bold;">关系名称（可选）:</label>
                            <input type="text" id="editRelationName" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;" placeholder="输入关系名称（可选）">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="closeEditRelationModal()">取消</button>
                        <button type="button" class="btn btn-primary" onclick="updateRelation(${relationId})">保存修改</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // 设置当前值
        document.getElementById('editRelationSourceTable').value = relation.source_table;
        document.getElementById('editRelationTargetTable').value = relation.target_table;
        document.getElementById('editRelationMatchType').value = relation.match_type || 'exact';
        document.getElementById('editRelationName').value = relation.relation_name || '';

        // 加载字段并设置当前值
        await loadEditSourceFields();
        document.getElementById('editRelationSourceField').value = relation.source_field;

        await loadEditTargetFields();
        document.getElementById('editRelationTargetField').value = relation.target_field;

    } catch (error) {
        showToast('获取表列表失败: ' + error.message, 'error');
    }
}

function closeEditRelationModal() {
    const modal = document.getElementById('editRelationModal');
    if (modal) modal.remove();
}

// 加载编辑弹窗的源表字段
async function loadEditSourceFields() {
    const tableName = document.getElementById('editRelationSourceTable').value;
    const fieldSelect = document.getElementById('editRelationSourceField');

    if (!tableName) {
        fieldSelect.innerHTML = '<option value="">请先选择源表</option>';
        return;
    }

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${tableName}/structure`);
        const data = await response.json();

        if (data.success) {
            const fields = data.columns || [];
            fieldSelect.innerHTML = '<option value="">请选择字段</option>' +
                fields.map(f => `<option value="${f.name}">${f.name}${f.comment ? ' (' + f.comment + ')' : ''}</option>`).join('');
        } else {
            showToast('获取字段列表失败: ' + data.message, 'error');
        }
    } catch (error) {
        showToast('获取字段列表失败: ' + error.message, 'error');
    }
}

// 加载编辑弹窗的目标表字段
async function loadEditTargetFields() {
    const tableName = document.getElementById('editRelationTargetTable').value;
    const fieldSelect = document.getElementById('editRelationTargetField');

    if (!tableName) {
        fieldSelect.innerHTML = '<option value="">请先选择目标表</option>';
        return;
    }

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases/${currentDb.id}/tables/${tableName}/structure`);
        const data = await response.json();

        if (data.success) {
            const fields = data.columns || [];
            fieldSelect.innerHTML = '<option value="">请选择字段</option>' +
                fields.map(f => `<option value="${f.name}">${f.name}${f.comment ? ' (' + f.comment + ')' : ''}</option>`).join('');
        } else {
            showToast('获取字段列表失败: ' + data.message, 'error');
        }
    } catch (error) {
        showToast('获取字段列表失败: ' + error.message, 'error');
    }
}

// 更新关系
async function updateRelation(relationId) {
    const sourceTable = document.getElementById('editRelationSourceTable').value;
    const sourceField = document.getElementById('editRelationSourceField').value;
    const targetTable = document.getElementById('editRelationTargetTable').value;
    const targetField = document.getElementById('editRelationTargetField').value;
    const matchType = document.getElementById('editRelationMatchType').value;
    const relationName = document.getElementById('editRelationName').value.trim();

    if (!sourceTable || !sourceField || !targetTable || !targetField || !matchType) {
        showToast('请填写所有必填字段', 'warning');
        return;
    }

    try {
        const body = {
            database_id: currentDb.id,
            relation_id: relationId,
            source_table: sourceTable,
            source_field: sourceField,
            target_table: targetTable,
            target_field: targetField,
            match_type: matchType
        };
        if (relationName) {
            body.relation_name = relationName;
        }

        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/relations`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json();
        if (data.success) {
            showToast('关系更新成功', 'success');
            closeEditRelationModal();
            loadRelationPreviewPage(currentRelationPage);
        } else {
            showToast('更新失败: ' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('更新失败: ' + error.message, 'error');
    }
}

// 删除单个关系
async function deleteRelation(relationId) {
    if (!confirm('确定要删除该关系吗？此操作不可恢复。')) {
        return;
    }

    // 前端先移除行，让用户感觉更快
    const row = document.querySelector(`tr[data-id="${relationId}"]`);
    if (row) {
        row.style.opacity = '0.5';
        row.innerHTML = `<td colspan="6" style="text-align:center;color:#888;"><span class="spinner"></span> 正在删除...</td>`;
    }

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/retrieval/relations`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                database_id: currentDb.id,
                relation_ids: [relationId]
            })
        });

        const data = await response.json();
        if (data.success) {
            showToast('删除成功', 'success');
            loadRelationPreviewPage(currentRelationPage);
        } else {
            showToast('删除失败: ' + (data.message || '未知错误'), 'error');
            loadRelationPreviewPage(currentRelationPage); // 失败也刷新恢复
        }
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
        loadRelationPreviewPage(currentRelationPage); // 失败刷新恢复
    }
}

async function govDownloadExamplesForTask(taskId, exampleFiles, taskName = '') {
    const token = localStorage.getItem('dataOntologyToken') || '';
    if (!token) {
        showToast('请先登录', 'error');
        return;
    }
    
    // 优先从全局 govTasks 查找，确保数据最新
    let files = exampleFiles;
    if (!files || !files.length) {
        const task = govTasks.find(t => t.id === taskId);
        if (task && task.example_files && task.example_files.length) {
            files = task.example_files;
        }
    }
    
    if (!files || !files.length) {
        showToast('没有可下载的样例文件', 'error');
        return;
    }
    
    // 清理任务名中的非法字符，用于文件名
    const safeTaskName = (taskName || '治理任务').replace(/[\\/:*?"<>|]/g, '_');
    const zipName = `${safeTaskName}_样例文件.zip`;
    
    showToast('正在准备下载...', 'info');
    
    // 格式化文件列表：{ name: "xxx.docx", path: "xxx.docx" }
    const formattedFiles = files.map(f => ({
        name: typeof f === 'string' ? f : f.name,
        path: typeof f === 'string' ? f : (f.path || f.name)
    }));
    
    // 使用批量打包接口下载
    try {
        const res = await fetch(`${API_BASE}/api/v1/gov/examples/download`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: formattedFiles,
                zip_name: zipName
            })
        });
        if (!res.ok) throw new Error(res.statusText);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    } catch (e) {
        console.error('下载失败:', e);
        showToast('下载失败: ' + e.message, 'error');
    }
}

// === Agent Cluster Mode Functions ===

// Show cluster mode usage guide
function showClusterModeGuide() {
    const messagesEl = document.getElementById('aiChatMessages');
    if (!messagesEl) return;
    
    // Remove existing guide if any
    removeClusterModeGuide();
    
    const guideEl = document.createElement('div');
    guideEl.id = 'clusterModeGuide';
    guideEl.className = 'cluster-mode-guide';
    guideEl.innerHTML = `
        <div class="cluster-guide-header">🤖 智能助手 — 多智能体自主规划执行</div>
        <div class="cluster-guide-body">
            <p>智能助手由多个AI智能体协作完成任务，具备自主规划、工具调用、深度分析能力。</p>
            <div class="cluster-guide-tips">
                <div class="cluster-tip">💡 <b>直接提问</b>：输入自然语言描述，如"帮我分析这个数据库的数据质量"</div>
                <div class="cluster-tip">🔍 <b>深度分析</b>：智能体会自动拆解复杂任务，多步执行</div>
                <div class="cluster-tip">🔧 <b>工具调用</b>：支持SQL生成、Schema审查、数据治理等工具</div>
                <div class="cluster-tip">📋 <b>Trace追踪</b>：可查看每个智能体的执行轨迹和工具调用</div>
            </div>
            <div class="cluster-guide-note">
                ⚠️ 智能助手需要多步推理，复杂任务响应较慢。
            </div>
            <div class="cluster-guide-config">
                ⚙️ 点击右上角 <b>Agent配置</b> 按钮，可管理 MCP Server 和 Skill。
            </div>
        </div>
    `;
    messagesEl.insertBefore(guideEl, messagesEl.firstChild);
}

// Remove cluster mode guide
function removeClusterModeGuide() {
    const existing = document.getElementById('clusterModeGuide');
    if (existing) existing.remove();
}

// Initialize session system on DOMContentLoaded
async function initAgentMode() {
    await initSessionSystem();
    // 恢复正在进行的 agent run（断线重连）
    await resumeActiveAgentRuns();
}

// 断线重连：检查当前会话是否有正在进行的 agent run，恢复轮询
async function resumeActiveAgentRuns() {
    if (!currentSessionId || currentSessionId === 'default') return;
    try {
        const resp = await fetchWithAuth(`${API_BASE}/api/v1/agent/runs?session_id=${currentSessionId}&status=running,waiting_hitl`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.success || !data.data || !data.data.runs) return;

        const activeRuns = data.data.runs;
        for (const run of activeRuns) {
            if (!run.id) continue; // 防御性检查
            // 为每个活跃 run 创建卡片并开始轮询
            await resumeAgentRun(run.id, run.last_seq || 0);
        }
    } catch (e) {
        console.error('Resume active runs error:', e);
    }
}

// 恢复单个 agent run 的轮询
async function resumeAgentRun(runId, startSeq) {
    if (!runId || runId === 'undefined') return; // 防御性检查
    const messagesEl = document.getElementById('aiChatMessages');
    messagesEl.classList.add('cluster-mode');

    const cardId = 'cluster-card-resume-' + runId;
    // 检查是否已有卡片
    if (document.getElementById(cardId)) return;

    const cardHtml = `
        <div class="ai-message assistant" id="${cardId}">
            <div class="ai-message-avatar">${getAiAvatarSvg()}</div>
            <div class="ai-message-content">
                <div class="ai-message-bubble cluster-response-card">
                    <div id="${cardId}-blocks" class="cluster-blocks"></div>
                    <div id="${cardId}-text" class="cluster-text-content"></div>
                    <div id="${cardId}-typing" class="cluster-typing-indicator"><span></span><span></span><span></span></div>
                </div>
                <div class="ai-message-meta"><span>恢复同步中...</span></div>
            </div>
        </div>`;
    messagesEl.insertAdjacentHTML('beforeend', cardHtml);

    const blocksEl = document.getElementById(`${cardId}-blocks`);
    const textEl = document.getElementById(`${cardId}-text`);
    const typingEl = document.getElementById(`${cardId}-typing`);

    let currentBlock = null;
    let fullText = '';
    const processWrapperRef = { wrapper: null, body: null, count: 0 };
    let lastSeq = startSeq;
    let runStatus = 'running';
    let hitlPending = false;
    let pollInterval = null;
    let pollCount = 0;
    const MAX_POLLS = 600; // 500ms * 600 = 5分钟安全阀

    const pollEvents = async () => {
        if (hitlPending) return;
        pollCount++;
        try {
            const resp = await fetchWithAuth(`${API_BASE}/api/v1/agent/runs/${runId}/events?after_seq=${lastSeq}`);
            if (!resp.ok) {
                // 认证失败时停止轮询，避免无限循环
                if (resp.status === 401) {
                    clearInterval(pollInterval);
                    pollInterval = null;
                    finishClusterResponse();
                }
                return;
            }
            const data = await resp.json();
            if (!data.success || !data.data) return;

            const events = data.data.events || [];
            runStatus = data.data.run_status || runStatus;

            for (const evt of events) {
                let evtData;
                try { evtData = JSON.parse(evt.event_data); } catch (e) { evtData = { type: evt.event_type, message: evt.event_data }; }
                if (!evtData.type) evtData.type = evt.event_type;

                const content = evtData.content || evtData.text || evtData.message || '';
                if (evtData.type === 'text' && evtData.partial === false && content) fullText = content;
                else if (evtData.type === 'text' && content) fullText += content;

                currentBlock = handleClusterEventV2(evtData, blocksEl, textEl, typingEl, currentBlock, processWrapperRef);

                if (evt.event_type === 'hitl_interaction') {
                    hitlPending = true;
                    const hitlCard = blocksEl.querySelector(`.hitl-card[data-hitl-id="${evtData.hitl_id}"]`);
                    if (hitlCard) { hitlCard.dataset.runId = runId; hitlCard.dataset.resumePoll = 'true'; }
                }
                lastSeq = evt.seq;
            }

            if (runStatus === 'completed' || runStatus === 'error' || pollCount >= MAX_POLLS) {
                clearInterval(pollInterval);
                pollInterval = null;
                finishClusterResponse();
            }
        } catch (e) { console.error('Resume poll error:', e); }
    };

    let finished = false;
    const finishClusterResponse = () => {
        if (finished) return;
        finished = true;
        typingEl.style.display = 'none';
        if (fullText) textEl.innerHTML = formatClusterMarkdown(fullText);
        const pw = processWrapperRef.wrapper;
        if (pw) {
            pw.classList.add('collapsed');
            const pwBody = pw.querySelector('.cluster-block-body');
            if (pwBody) { pwBody.style.display = 'none'; pwBody.style.maxHeight = 'none'; pwBody.style.overflowY = 'hidden'; }
            const chevron = pw.querySelector('.cluster-block-chevron');
            if (chevron) chevron.textContent = '▶';
            const titleEl = pw.querySelector('.cluster-block-title');
            if (titleEl) titleEl.textContent = `⚙️ 中间过程 (${processWrapperRef.count} 步)`;
        }
        const blocksData = [];
        blocksEl.querySelectorAll(':scope > .cluster-block').forEach(b => {
            const titleEl = b.querySelector(':scope > .cluster-block-header .cluster-block-title');
            const bodyEl = b.querySelector(':scope > .cluster-block-body');
            blocksData.push({ title: titleEl ? titleEl.textContent : '', className: b.className.replace('cluster-block ', '').replace(' collapsed', '').replace(' closed', ''), bodyHtml: bodyEl ? bodyEl.innerHTML : '' });
        });
        if (fullText || blocksData.length > 0) saveCurrentSessionMessage('assistant', fullText || '', blocksData.length > 0 ? blocksData : null);
    };

    pollInterval = setInterval(pollEvents, 500);
    await pollEvents();

    const card = document.getElementById(cardId);
    if (card) {
        card.dataset.runId = runId;
        card._pollInterval = pollInterval;
        card._pollEvents = pollEvents;
        card._finishClusterResponse = finishClusterResponse;
        card._processWrapperRef = processWrapperRef;
        card._hitlPending = () => hitlPending;
        card._setHitlPending = (v) => { hitlPending = v; };
    }
}

// Send message via cluster mode — 异步轮询模式
// 用户发消息后，后端独立执行，前端轮询事件同步状态
// 用户关闭页面不影响后端执行，回来后可继续同步
async function sendClusterQuery(message, databases, modules) {
    const messagesEl = document.getElementById('aiChatMessages');
    messagesEl.classList.add('cluster-mode');
    
    // 创建助手消息卡片
    const cardId = 'cluster-card-' + Date.now();
    const cardHtml = `
        <div class="ai-message assistant" id="${cardId}">
            <div class="ai-message-avatar">${getAiAvatarSvg()}</div>
            <div class="ai-message-content">
                <div class="ai-message-bubble cluster-response-card">
                    <div id="${cardId}-blocks" class="cluster-blocks"></div>
                    <div id="${cardId}-text" class="cluster-text-content"></div>
                    <div id="${cardId}-typing" class="cluster-typing-indicator"><span></span><span></span><span></span></div>
                </div>
                <div class="ai-message-meta"><span>${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</span></div>
            </div>
        </div>`;
    messagesEl.insertAdjacentHTML('beforeend', cardHtml);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    
    const blocksEl = document.getElementById(`${cardId}-blocks`);
    const textEl = document.getElementById(`${cardId}-text`);
    const typingEl = document.getElementById(`${cardId}-typing`);
    
    clusterTraceData = [];
    let currentBlock = null;
    let fullText = '';
    const processWrapperRef = { wrapper: null, body: null, count: 0 };

    try {
        // 1. 创建异步运行
        const response = await fetchWithAuth(`${API_BASE}/api/v1/agent/runs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message, 
                databases, 
                modules, 
                session_id: currentSessionId || 'default'
            })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (!result.success || !result.data || !result.data.run_id) {
            throw new Error(result.message || '创建运行失败');
        }

        const runId = result.data.run_id;
        typingEl.style.display = 'flex';

        // 2. 轮询事件
        let lastSeq = 0;
        let runStatus = 'running';
        let pollInterval = null;
        let hitlPending = false; // HITL 等待中，暂停轮询直到用户响应
        let pollCount = 0;
        const MAX_POLLS = 600; // 500ms * 600 = 5分钟安全阀

        const pollEvents = async () => {
        if (hitlPending) return; // HITL 等待中不轮询
        pollCount++;
        try {
            const resp = await fetchWithAuth(`${API_BASE}/api/v1/agent/runs/${runId}/events?after_seq=${lastSeq}`);
            if (!resp.ok) {
                // 认证失败时停止轮询，避免无限循环
                if (resp.status === 401) {
                    clearInterval(pollInterval);
                    pollInterval = null;
                    finishClusterResponse();
                }
                return;
            }
            const data = await resp.json();
            if (!data.success || !data.data) return;

            const events = data.data.events || [];
            runStatus = data.data.run_status || runStatus;

            for (const evt of events) {
                // 解析 event_data JSON
                let evtData;
                try {
                    evtData = JSON.parse(evt.event_data);
                } catch (e) {
                    evtData = { type: evt.event_type, message: evt.event_data };
                }

                // 设置事件类型
                if (!evtData.type) evtData.type = evt.event_type;

                // 处理 text 事件的 fullText
                const content = evtData.content || evtData.text || evtData.message || '';
                if (evtData.type === 'text' && evtData.partial === false && content) {
                    fullText = content;
                } else if (evtData.type === 'text' && content) {
                    fullText += content;
                }

                // 复用现有渲染逻辑
                currentBlock = handleClusterEventV2(evtData, blocksEl, textEl, typingEl, currentBlock, processWrapperRef);

                // HITL: 暂停轮询，等用户响应
                if (evt.event_type === 'hitl_interaction') {
                    hitlPending = true;
                    // 在 HITL 卡片上绑定恢复轮询的回调
                    const hitlCard = blocksEl.querySelector(`.hitl-card[data-hitl-id="${evtData.hitl_id}"]`);
                    if (hitlCard) {
                        hitlCard.dataset.runId = runId;
                        hitlCard.dataset.resumePoll = 'true';
                    }
                }

                lastSeq = evt.seq;
            }

            // 运行结束
            if (runStatus === 'completed' || runStatus === 'error' || pollCount >= MAX_POLLS) {
                clearInterval(pollInterval);
                pollInterval = null;
                finishClusterResponse();
            }
        } catch (e) {
            console.error('Poll events error:', e);
        }
    };

        // 完成处理（渲染最终文本、折叠中间过程、保存会话）
        let finished = false;
        const finishClusterResponse = () => {
            if (finished) return;
            finished = true;
            typingEl.style.display = 'none';
            if (fullText) {
                textEl.innerHTML = formatClusterMarkdown(fullText);
            }
            // 折叠外层"中间过程"块
            const pw = processWrapperRef.wrapper;
            if (pw) {
                pw.classList.add('collapsed');
                const pwBody = pw.querySelector('.cluster-block-body');
                if (pwBody) { pwBody.style.display = 'none'; pwBody.style.maxHeight = 'none'; pwBody.style.overflowY = 'hidden'; }
                const chevron = pw.querySelector('.cluster-block-chevron');
                if (chevron) chevron.textContent = '▶';
                const titleEl = pw.querySelector('.cluster-block-title');
                if (titleEl) titleEl.textContent = `⚙️ 中间过程 (${processWrapperRef.count} 步)`;
            }

            // 保存会话
            const blocksData = [];
            blocksEl.querySelectorAll(':scope > .cluster-block').forEach(b => {
                const titleEl = b.querySelector(':scope > .cluster-block-header .cluster-block-title');
                const bodyEl = b.querySelector(':scope > .cluster-block-body');
                blocksData.push({
                    title: titleEl ? titleEl.textContent : '',
                    className: b.className.replace('cluster-block ', '').replace(' collapsed', '').replace(' closed', ''),
                    bodyHtml: bodyEl ? bodyEl.innerHTML : ''
                });
            });
            if (fullText || blocksData.length > 0) saveCurrentSessionMessage('assistant', fullText || '', blocksData.length > 0 ? blocksData : null);
        };

        // 每 500ms 轮询
        pollInterval = setInterval(pollEvents, 500);
        // 立即执行一次
        await pollEvents();

        // 将轮询控制信息存到卡片上，供 HITL 恢复时使用
        const card = document.getElementById(cardId);
        if (card) {
            card.dataset.runId = runId;
            card.dataset.lastSeq = lastSeq;
            card._pollInterval = pollInterval;
            card._pollEvents = pollEvents;
            card._finishClusterResponse = finishClusterResponse;
            card._processWrapperRef = processWrapperRef;
            card._fullText = '';
            Object.defineProperty(card, '_currentFullText', {
                get: () => fullText,
                set: (v) => { fullText = v; }
            });
            card._currentBlock = currentBlock;
            card._hitlPending = () => hitlPending;
            card._setHitlPending = (v) => { hitlPending = v; };
        }

    } catch (e) {
        console.error('Cluster query error:', e);
        typingEl.style.display = 'none';
        textEl.innerHTML = `<div class="ai-error">智能助手请求失败: ${escapeHtml(e.message)}</div>`;
    }
}

// Handle cluster SSE events — PicoClaw-style structured blocks
// processWrapperRef: { wrapper, body, count } — 外层"中间过程"折叠块的引用
function handleClusterEventV2(evt, blocksEl, textEl, typingEl, currentBlock, processWrapperRef) {
    if (!evt || !evt.type) return currentBlock;
    const content = evt.content || evt.text || evt.message || '';
    const agent = evt.agent || evt.from || '';
    const tool = evt.tool || '';

    // 确保中间过程需要的事件能获取到外层 wrapper
    function ensureProcessWrapper() {
        if (!processWrapperRef.wrapper) {
            const wrapper = createClusterBlock('⚙️ 中间过程', 'cluster-block-process');
            wrapper.classList.add('cluster-process-wrapper');
            // 流式过程中保持展开
            wrapper.classList.remove('collapsed');
            const body = wrapper.querySelector('.cluster-block-body');
            if (body) body.style.display = 'block';
            const chevron = wrapper.querySelector('.cluster-block-chevron');
            if (chevron) chevron.textContent = '▼';
            blocksEl.appendChild(wrapper);
            processWrapperRef.wrapper = wrapper;
            processWrapperRef.body = body;
            processWrapperRef.count = 0;
        }
        // 每次访问时确保展开状态，滚动到最新子块
        const body = processWrapperRef.body;
        if (body) {
            body.style.display = 'block';
            processWrapperRef.wrapper.classList.remove('collapsed');
            // 自动滚动到最新子块
            requestAnimationFrame(() => {
                body.scrollTop = body.scrollHeight;
                // 同时滚动整个消息区域
                const messagesEl = document.getElementById('aiChatMessages');
                if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
            });
        }
        return body;
    }

    switch (evt.type) {
        case 'start':
            typingEl.style.display = 'flex';
            break;

        case 'text':
            if (content) {
                typingEl.style.display = 'none';
                if (evt.partial === false) {
                    textEl.innerHTML = formatClusterMarkdown(content);
                } else {
                    // 流式增量文本：拼接后重新渲染
                    const existing = textEl._rawText || '';
                    textEl._rawText = existing + content;
                    textEl.innerHTML = formatClusterMarkdown(textEl._rawText);
                }
            }
            break;

        case 'thinking': {
            // 追加到外层"中间过程"块内
            const pBody = ensureProcessWrapper();
            let thinkBlock = pBody.querySelector('.cluster-block-thinking:not(.closed)');
            if (!thinkBlock) {
                thinkBlock = createClusterBlock('💭 思考过程', 'cluster-block-thinking');
                pBody.appendChild(thinkBlock);
                processWrapperRef.count++;
            }
            const body = thinkBlock.querySelector('.cluster-block-body');
            if (content) {
                body.insertAdjacentHTML('beforeend', `<div class="cluster-think-step">${escapeHtml(content.substring(0, 200))}</div>`);
            }
            currentBlock = thinkBlock;
            break;
        }

        case 'tool_call': {
            // 工具调用折叠块 → 追加到外层"中间过程"块内
            const pBody = ensureProcessWrapper();
            const toolBlock = createClusterBlock(`🔧 ${tool || '工具调用'}`, 'cluster-block-tool');
            const body = toolBlock.querySelector('.cluster-block-body');
            if (content) body.insertAdjacentHTML('beforeend', formatToolContent(content, false, tool));
            pBody.appendChild(toolBlock);
            processWrapperRef.count++;
            currentBlock = toolBlock;
            break;
        }

        case 'tool_result': {
            // 追加到当前工具块，或创建新块（都在外层"中间过程"内）
            const pBody = ensureProcessWrapper();
            if (currentBlock && currentBlock.classList.contains('cluster-block-tool')) {
                const body = currentBlock.querySelector('.cluster-block-body');
                body.insertAdjacentHTML('beforeend', formatToolContent(content, true, tool));
                currentBlock.classList.add('closed');
            } else {
                const resultBlock = createClusterBlock(`📋 ${tool || '工具结果'}`, 'cluster-block-tool');
                const body = resultBlock.querySelector('.cluster-block-body');
                body.insertAdjacentHTML('beforeend', formatToolContent(content, true, tool));
                pBody.appendChild(resultBlock);
                resultBlock.classList.add('closed');
                processWrapperRef.count++;
                currentBlock = resultBlock;
            }
            break;
        }

        case 'agent_switch': {
            const pBody = ensureProcessWrapper();
            const switchBlock = createClusterBlock(`🔀 ${evt.from || '?'} → ${evt.to || '?'}`, 'cluster-block-switch');
            pBody.appendChild(switchBlock);
            switchBlock.classList.add('closed');
            processWrapperRef.count++;
            currentBlock = switchBlock;
            break;
        }

        case 'llm_retry': {
            // LLM 重试事件 → 追加到外层"中间过程"块内
            const pBody = ensureProcessWrapper();
            const retryBlock = createClusterBlock(`⚠️ 重试`, 'cluster-block-retry');
            const body = retryBlock.querySelector('.cluster-block-body');
            const reason = evt.reason || '未知';
            const attempt = evt.attempt || '?';
            const maxAttempts = evt.max_attempts || '?';
            const backoff = evt.backoff_secs || 0;
            body.insertAdjacentHTML('beforeend', `<div class="cluster-retry-detail">${escapeHtml(`${reason}，第 ${attempt}/${maxAttempts} 次重试，等待 ${backoff}s...`)}</div>`);
            pBody.appendChild(retryBlock);
            retryBlock.classList.add('closed');
            processWrapperRef.count++;
            currentBlock = retryBlock;
            break;
        }

        case 'error': {
            const errBlock = createClusterBlock(`❌ 错误`, 'cluster-block-error');
            const body = errBlock.querySelector('.cluster-block-body');
            body.insertAdjacentHTML('beforeend', `<div class="cluster-error-detail">${escapeHtml(evt.message || content || '未知错误')}</div>`);
            // error 保持独立，不包在中间过程里
            blocksEl.appendChild(errBlock);
            currentBlock = errBlock;
            break;
        }

        case 'hitl_interaction': {
            // HITL 人在环路交互卡片 — 保持独立，不包在中间过程里
            const hitlCard = renderHITLCard(evt);
            if (hitlCard) {
                blocksEl.appendChild(hitlCard);
                currentBlock = hitlCard;
            }
            break;
        }

        case 'done':
            typingEl.style.display = 'none';
            break;
    }

    // 自动滚动
    const messagesEl = document.getElementById('aiChatMessages');
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    
    clusterTraceData.push({ agent: agent || 'system', action: evt.type, type: evt.type, time: new Date().toISOString() });
    return currentBlock;
}

// ============================================================
// HITL 人在环路交互卡片渲染
// ============================================================

function renderHITLCard(evt) {
    const hitlId = evt.hitl_id;
    const interactionType = evt.interaction_type;
    const title = evt.title || '确认';
    const description = evt.description || '';
    const options = evt.options || [];
    const fields = evt.fields || [];
    const timeoutSeconds = evt.timeout_seconds || 300;

    if (!hitlId) return null;

    const card = document.createElement('div');
    card.className = 'hitl-card';
    card.dataset.hitlId = hitlId;

    // 如果是 preview 类型，存蓝图数据以便刷新预览时重建
    if (interactionType === 'preview' && evt.blueprint) {
        try {
            card.dataset.blueprint = JSON.stringify(evt.blueprint);
        } catch(e) {}
    }

    // Header
    let html = `<div class="hitl-card-header">
        <span class="hitl-card-icon">${interactionType === 'confirm' ? '⚠️' : interactionType === 'form' ? '📝' : interactionType === 'preview' ? '👁️' : '❓'}</span>
        <span class="hitl-card-title">${escapeHtml(title)}</span>
    </div>`;

    // Description
    if (description) {
        html += `<div class="hitl-card-description">${escapeHtml(description)}</div>`;
    }

    // Body — depends on interaction type
    html += '<div class="hitl-card-body">';

    if (interactionType === 'confirm') {
        // Confirm: show options as buttons
        if (options.length > 0) {
            html += '<div class="hitl-options">';
            for (const opt of options) {
                const style = opt.style || 'default';
                html += `<button class="hitl-option-btn hitl-option-${style}" data-option-id="${escapeHtml(opt.id)}" onclick="hitlSubmitConfirm('${hitlId}', '${escapeHtml(opt.id)}')">${escapeHtml(opt.label)}</button>`;
            }
            html += '</div>';
        } else {
            // Default confirm/cancel buttons
            html += `<div class="hitl-options">
                <button class="hitl-option-btn hitl-option-primary" onclick="hitlSubmitConfirm('${hitlId}', 'yes')">✅ 确认</button>
                <button class="hitl-option-btn hitl-option-danger" onclick="hitlSubmitCancel('${hitlId}')">❌ 取消</button>
            </div>`;
        }
    } else if (interactionType === 'form' || interactionType === 'input') {
        // Form: render fields
        if (fields.length > 0) {
            for (const field of fields) {
                const required = field.required ? ' <span class="hitl-required">*</span>' : '';
                html += `<div class="hitl-field">
                    <label class="hitl-field-label">${escapeHtml(field.label)}${required}</label>`;
                if (field.type === 'select' && field.options && field.options.length > 0) {
                    html += `<select class="hitl-field-select" data-field-id="${escapeHtml(field.id)}">`;
                    for (const fo of field.options) {
                        const selected = field.default_value && fo.id === field.default_value ? ' selected' : '';
                        html += `<option value="${escapeHtml(fo.id)}"${selected}>${escapeHtml(fo.label)}</option>`;
                    }
                    html += '</select>';
                } else if (field.type === 'textarea') {
                    html += `<textarea class="hitl-field-textarea" data-field-id="${escapeHtml(field.id)}" placeholder="${escapeHtml(field.placeholder || '')}">${escapeHtml(field.default_value || '')}</textarea>`;
                } else {
                    html += `<input class="hitl-field-input" type="${field.type === 'number' ? 'number' : 'text'}" data-field-id="${escapeHtml(field.id)}" placeholder="${escapeHtml(field.placeholder || '')}" value="${escapeHtml(field.default_value || '')}">`;
                }
                html += '</div>';
            }
            html += `<div class="hitl-options">
                <button class="hitl-option-btn hitl-option-primary" onclick="hitlSubmitForm('${hitlId}')">✅ 提交</button>
                <button class="hitl-option-btn hitl-option-danger" onclick="hitlSubmitCancel('${hitlId}')">❌ 取消</button>
            </div>`;
        } else {
            // No fields — just show description + confirm/cancel
            html += `<div class="hitl-options">
                <button class="hitl-option-btn hitl-option-primary" onclick="hitlSubmitConfirm('${hitlId}', 'yes')">✅ 确认</button>
                <button class="hitl-option-btn hitl-option-danger" onclick="hitlSubmitCancel('${hitlId}')">❌ 取消</button>
            </div>`;
        }
    } else if (interactionType === 'single_select') {
        html += '<div class="hitl-single-select-group">';
        for (const opt of options) {
            html += `<label class="hitl-radio-label" data-hitl-id="${escapeHtml(hitlId)}" data-option-id="${escapeHtml(opt.id)}" onclick="hitlRadioSelect(this, '${hitlId}', '${escapeHtml(opt.id)}')">
                <span class="hitl-radio-circle"><span class="hitl-radio-dot"></span></span>
                <span class="hitl-radio-text">${escapeHtml(opt.label)}</span>
            </label>`;
        }
        html += '</div>';
    } else if (interactionType === 'multi_select') {
        html += '<div class="hitl-options hitl-options-vertical">';
        for (const opt of options) {
            html += `<label class="hitl-checkbox-label"><input type="checkbox" class="hitl-checkbox" data-option-id="${escapeHtml(opt.id)}"> ${escapeHtml(opt.label)}</label>`;
        }
        html += `</div>
        <div class="hitl-options">
            <button class="hitl-option-btn hitl-option-primary" onclick="hitlSubmitMultiSelect('${hitlId}')">✅ 提交</button>
            <button class="hitl-option-btn hitl-option-danger" onclick="hitlSubmitCancel('${hitlId}')">❌ 取消</button>
        </div>`;
    } else if (interactionType === 'preview') {
        // 预览交互类型 — iframe 预览 + 配置表单
        const previewHtml = evt.preview_html || '';
        const previewWidth = evt.preview_width || '100%';
        const previewHeight = evt.preview_height || '420px';
        const configFields = evt.config_fields || fields || [];

        // 始终渲染 iframe 容器（即使 preview_html 暂时为空，后续可能异步加载）
        html += `<div class="hitl-preview-container">
            <div style="display:flex;gap:4px;margin-bottom:6px;">
                <button class="hitl-device-btn" onclick="hitlSetDeviceSize('${hitlId}','100%','420px')" title="桌面" style="padding:2px 8px;font-size:11px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;">🖥️ 桌面</button>
                <button class="hitl-device-btn" onclick="hitlSetDeviceSize('${hitlId}','768px','500px')" title="平板" style="padding:2px 8px;font-size:11px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;">📱 平板</button>
                <button class="hitl-device-btn" onclick="hitlSetDeviceSize('${hitlId}','375px','600px')" title="手机" style="padding:2px 8px;font-size:11px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;">📲 手机</button>
            </div>
            <iframe class="hitl-preview-iframe" style="width:${previewWidth};height:${previewHeight};border:1px solid #e5e7eb;border-radius:8px;transition:width 0.2s,height 0.2s;" sandbox="allow-scripts allow-same-origin"></iframe>
        </div>`;

        // 配置表单（按组件分组，可交互修改组件配置）
        if (configFields.length > 0) {
            html += '<div class="hitl-config-section"><div class="hitl-config-title">⚙️ 组件配置</div><div class="hitl-config-fields">';
            // 检测嵌套格式：[{component_id, component_name, fields: [...]}]
            const isNested = configFields[0] && configFields[0].component_id && configFields[0].fields;
            if (isNested) {
                configFields.forEach((cf, compIdx) => {
                    if (!cf.fields || cf.fields.length === 0) return;
                    html += `<div style="margin-bottom:12px;padding:8px;background:#f8fafc;border-radius:6px;">`;
                    html += `<div style="font-size:12px;color:#6b7280;margin-bottom:6px;font-weight:600;">${escapeHtml(cf.component_name || cf.component_id)}</div>`;
                    cf.fields.forEach(field => {
                        const fieldId = `comp${compIdx}_${field.id}`;
                        const required = field.required ? ' <span class="hitl-required">*</span>' : '';
                        html += `<div style="margin-bottom:4px;"><label style="font-size:11px;color:#9ca3af;">${escapeHtml(field.label)}${required}</label>`;
                        if (field.type === 'select' && field.options && field.options.length > 0) {
                            html += `<select class="hitl-field-select" data-field-id="${escapeHtml(fieldId)}" onchange="hitlUpdatePreview('${hitlId}')" style="width:100%;padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;">`;
                            for (const fo of field.options) {
                                const foVal = typeof fo === 'object' ? fo.id : fo;
                                const foLabel = typeof fo === 'object' ? fo.label : fo;
                                const selected = field.default_value && foVal === field.default_value ? ' selected' : '';
                                html += `<option value="${escapeHtml(String(foVal))}"${selected}>${escapeHtml(String(foLabel))}</option>`;
                            }
                            html += '</select>';
                        } else if (field.type === 'color' || field.type === 'color_list') {
                            html += `<input class="hitl-field-color" type="color" data-field-id="${escapeHtml(fieldId)}" value="${escapeHtml(field.default_value || '#4F46E5')}" onchange="hitlUpdatePreview('${hitlId}')" style="width:100%;padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;">`;
                        } else if (field.type === 'number') {
                            html += `<input class="hitl-field-input" type="number" data-field-id="${escapeHtml(fieldId)}" value="${escapeHtml(String(field.default_value || ''))}" min="${field.min ?? ''}" max="${field.max ?? ''}" oninput="hitlUpdatePreview('${hitlId}')" style="width:100%;padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;">`;
                        } else if (field.type === 'boolean') {
                            html += `<label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;width:fit-content;"><input class="hitl-field-input" type="checkbox" data-field-id="${escapeHtml(fieldId)}" ${field.default_value ? 'checked' : ''} onchange="hitlUpdatePreview('${hitlId}')"> ${escapeHtml(field.label)}</label>`;
                        } else if (field.type === 'textarea') {
                            html += `<textarea class="hitl-field-textarea" data-field-id="${escapeHtml(fieldId)}" placeholder="${escapeHtml(field.placeholder || '')}" oninput="hitlUpdatePreview('${hitlId}')" style="width:100%;padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;">${escapeHtml(String(field.default_value || ''))}</textarea>`;
                        } else {
                            html += `<input class="hitl-field-input" type="text" data-field-id="${escapeHtml(fieldId)}" placeholder="${escapeHtml(field.placeholder || '')}" value="${escapeHtml(String(field.default_value || ''))}" oninput="hitlUpdatePreview('${hitlId}')" style="width:100%;padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;">`;
                        }
                        html += '</div>';
                    });
                    html += '</div>';
                });
            } else {
                // 兼容平铺格式
                for (const field of configFields) {
                    const required = field.required ? ' <span class="hitl-required">*</span>' : '';
                    html += `<div class="hitl-field"><label class="hitl-field-label">${escapeHtml(field.label)}${required}</label>`;
                    if (field.type === 'select' && field.options && field.options.length > 0) {
                        html += `<select class="hitl-field-select" data-field-id="${escapeHtml(field.id)}" onchange="hitlUpdatePreview('${hitlId}')">`;
                        for (const fo of field.options) {
                            const selected = field.default_value && fo.id === field.default_value ? ' selected' : '';
                            html += `<option value="${escapeHtml(fo.id)}"${selected}>${escapeHtml(fo.label)}</option>`;
                        }
                        html += '</select>';
                    } else if (field.type === 'color') {
                        html += `<input class="hitl-field-color" type="color" data-field-id="${escapeHtml(field.id)}" value="${escapeHtml(field.default_value || '#4F46E5')}" onchange="hitlUpdatePreview('${hitlId}')">`;
                    } else if (field.type === 'textarea') {
                        html += `<textarea class="hitl-field-textarea" data-field-id="${escapeHtml(field.id)}" placeholder="${escapeHtml(field.placeholder || '')}" oninput="hitlUpdatePreview('${hitlId}')">${escapeHtml(field.default_value || '')}</textarea>`;
                    } else {
                        html += `<input class="hitl-field-input" type="${field.type === 'number' ? 'number' : 'text'}" data-field-id="${escapeHtml(field.id)}" placeholder="${escapeHtml(field.placeholder || '')}" value="${escapeHtml(field.default_value || '')}" oninput="hitlUpdatePreview('${hitlId}')">`;
                    }
                    html += '</div>';
                }
            }
            html += '</div></div>'; // hitl-config-fields + hitl-config-section
        }

        html += `<div class="hitl-options" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:#6b7280;cursor:pointer;"><input type="checkbox" id="hitl-live-${hitlId}" checked onchange="hitlToggleLive('${hitlId}')"> 实时预览</label>
            <span style="flex:1;"></span>
            <button class="hitl-option-btn hitl-option-primary" onclick="hitlSubmitPreview('${hitlId}')">✅ 确认并创建</button>
            <button class="hitl-option-btn hitl-option-default" onclick="hitlRefreshPreview('${hitlId}')">🔄 重新生成</button>
            <button class="hitl-option-btn hitl-option-danger" onclick="hitlSubmitCancel('${hitlId}')">❌ 取消</button>
        </div>`;
    }

    html += '</div>'; // hitl-card-body

    // Footer — 不再显示超时倒计时，后端会一直等待
    html += `<div class="hitl-card-footer">
        <span class="hitl-timeout-hint">⏱ 等待您的响应</span>
    </div>`;

    card.innerHTML = html;

    // 保存 blueprint 数据，供 hitlRefreshPreview 使用
    if (interactionType === 'preview' && evt.blueprint) {
        card.dataset.blueprint = JSON.stringify(evt.blueprint);
    }

    // 如果是 preview 类型，注入 iframe 内容
    if (interactionType === 'preview') {
        const iframe = card.querySelector('.hitl-preview-iframe');
        if (iframe) {
            const baseURL = window.location.origin;
            const baseInject = `<script>Object.defineProperty(window,'_appBaseURL',{value:"${baseURL}",writable:false});try{Object.defineProperty(window,'_appToken',{value:localStorage.getItem('dataOntologyToken')||'',writable:false});}catch(e){Object.defineProperty(window,'_appToken',{value:'',writable:false});}<\/script>`;
            
            // 安全写入 iframe 的辅助函数
            function writeIframeContent(html) {
                const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
                if (!doc) {
                    // iframe 还没准备好，等 load 事件再写入
                    iframe.addEventListener('load', () => {
                        const d = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
                        if (d) { d.open(); d.write(baseInject + html); d.close(); }
                    }, { once: true });
                    return;
                }
                doc.open();
                doc.write(baseInject + html);
                doc.close();
            }
            
            if (evt.preview_html) {
                // 直接写入已有的 preview_html
                setTimeout(() => writeIframeContent(evt.preview_html), 100);
            } else if (evt.blueprint) {
                // 没有 preview_html 但有 blueprint → 从服务器生成
                iframe.style.background = '#f9fafb';
                const token = localStorage.getItem('dataOntologyToken') || '';
                fetch('/api/v1/components/preview?format=json', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ blueprint: evt.blueprint })
                }).then(r => r.json()).then(data => {
                    if (data.preview_html) {
                        writeIframeContent(data.preview_html);
                    }
                    iframe.style.background = '';
                }).catch(err => {
                    console.error('Auto-generate preview from blueprint failed:', err);
                    iframe.style.background = '#fee2e2';
                });
            }
        }
    }

    return card;
}

// HITL submit helpers
function hitlRadioSelect(labelEl, hitlId, optionId) {
    const group = labelEl.closest('.hitl-single-select-group');
    if (group) {
        group.querySelectorAll('.hitl-radio-label').forEach(l => l.classList.remove('selected'));
    }
    labelEl.classList.add('selected');
    hitlSubmit(hitlId, 'submit', { confirm: optionId });
}

function hitlSubmitConfirm(hitlId, optionId) {
    hitlSubmit(hitlId, 'submit', { confirm: optionId });
}

function hitlSubmitCancel(hitlId) {
    hitlSubmit(hitlId, 'cancel', {});
}

function hitlSubmitForm(hitlId) {
    const card = document.querySelector(`.hitl-card[data-hitl-id="${hitlId}"]`);
    if (!card) return;
    const values = {};
    card.querySelectorAll('.hitl-field-input, .hitl-field-select, .hitl-field-textarea').forEach(el => {
        values[el.dataset.fieldId] = el.value;
    });
    hitlSubmit(hitlId, 'submit', values);
}

function hitlSubmitMultiSelect(hitlId) {
    const card = document.querySelector(`.hitl-card[data-hitl-id="${hitlId}"]`);
    if (!card) return;
    const selected = [];
    card.querySelectorAll('.hitl-checkbox:checked').forEach(el => {
        selected.push(el.dataset.optionId);
    });
    hitlSubmit(hitlId, 'submit', { selected: selected });
}

// 预览模式：提交确认
function hitlSubmitPreview(hitlId) {
    const card = document.querySelector(`.hitl-card[data-hitl-id="${hitlId}"]`);
    if (!card) return;
    const values = collectHITLConfigValues(card);
    hitlSubmit(hitlId, 'submit', values);
}

// 收集 HITL 配置表单值（处理 checkbox 的 checked 状态）
function collectHITLConfigValues(card) {
    const values = {};
    card.querySelectorAll('.hitl-field-input, .hitl-field-select, .hitl-field-textarea, .hitl-field-color').forEach(el => {
        if (el.type === 'checkbox') {
            values[el.dataset.fieldId] = el.checked;
        } else if (el.type === 'number') {
            values[el.dataset.fieldId] = el.value !== '' ? Number(el.value) : '';
        } else {
            values[el.dataset.fieldId] = el.value;
        }
    });
    return values;
}

// 预览模式：配置变更 → 实时更新 iframe 预览
function hitlUpdatePreview(hitlId) {
    const card = document.querySelector(`.hitl-card[data-hitl-id="${hitlId}"]`);
    if (!card) return;
    // 检查实时预览开关
    const liveToggle = document.getElementById(`hitl-live-${hitlId}`);
    if (liveToggle && !liveToggle.checked) return;
    const values = collectHITLConfigValues(card);
    // 通过 postMessage 通知 iframe 内的应用更新配置
    const iframe = card.querySelector('.hitl-preview-iframe');
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'updateConfig', config: values }, '*');
    }
}

// 实时预览开关
function hitlToggleLive(hitlId) {
    // 开关状态由 hitlUpdatePreview 内部检查，无需额外逻辑
}

// 预览设备尺寸切换
function hitlSetDeviceSize(hitlId, w, h) {
    const card = document.querySelector(`.hitl-card[data-hitl-id="${hitlId}"]`);
    if (!card) return;
    const iframe = card.querySelector('.hitl-preview-iframe');
    if (!iframe) return;
    iframe.style.width = w;
    iframe.style.height = h;
    // 通知 iframe 内 ECharts 重绘
    setTimeout(() => {
        if (iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'resize' }, '*');
        }
    }, 250);
}

// 预览模式：重新生成预览（请求后端重新组装）
function hitlRefreshPreview(hitlId) {
    const card = document.querySelector(`.hitl-card[data-hitl-id="${hitlId}"]`);
    if (!card) return;

    // 收集当前配置值
    const values = collectHITLConfigValues(card);

    // 构建请求体：蓝图 + 修改后的配置
    let reqBody = values;
    if (card.dataset.blueprint) {
        try {
            const blueprint = JSON.parse(card.dataset.blueprint);
            // 将配置值映射回蓝图
            // fieldId 格式: compN_fieldName, N 是 config_fields 数组索引
            // configFields[0] = _global (全局配置)
            // configFields[1..N] = 组件配置, 对应 blueprint.components[0..N-1]
            for (const key of Object.keys(values)) {
                if (!key.startsWith('comp')) continue;
                const parts = key.split('_');
                const compIdx = parseInt(parts[0].replace('comp', ''), 10);
                const fieldName = parts.slice(1).join('_');
                if (compIdx === 0) {
                    // 全局配置: comp0_title, comp0_primary_color
                    if (fieldName === 'title') blueprint.title = values[key];
                    else if (fieldName === 'primary_color') blueprint.primary_color = values[key];
                } else {
                    // 组件配置: comp1_xxx → blueprint.components[0].config.xxx
                    const bpCompIdx = compIdx - 1;
                    if (bpCompIdx < blueprint.components.length) {
                        if (!blueprint.components[bpCompIdx].config) blueprint.components[bpCompIdx].config = {};
                        blueprint.components[bpCompIdx].config[fieldName] = values[key];
                    }
                }
            }
            reqBody = blueprint;
        } catch(e) {
            console.error('Blueprint parse error:', e);
        }
    }

    const token = localStorage.getItem('dataOntologyToken') || '';
    fetch('/api/v1/components/preview?format=json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(reqBody)
    }).then(r => r.json()).then(data => {
        // 更新 blueprint（可能有新的默认值填充）
        if (data.blueprint) {
            card.dataset.blueprint = JSON.stringify(data.blueprint);
        }
        const iframe = card.querySelector('.hitl-preview-iframe');
        if (iframe && data.preview_html) {
            const doc = iframe.contentDocument || iframe.contentWindow.document;
            const baseURL = window.location.origin;
            const baseInject = `<script>Object.defineProperty(window,'_appBaseURL',{value:"${baseURL}",writable:false});try{Object.defineProperty(window,'_appToken',{value:localStorage.getItem('dataOntologyToken')||'',writable:false});}catch(e){Object.defineProperty(window,'_appToken',{value:'',writable:false});}<\/script>`;
            doc.open();
            doc.write(baseInject + data.preview_html);
            doc.close();
        }
        // 更新 config_fields 表单
        if (data.config_fields) {
            updateHITLConfigFields(card, data.config_fields);
        }
    }).catch(err => console.error('Refresh preview error:', err));
}

// 更新 HITL 卡片中的组件配置表单（刷新预览后调用）
function updateHITLConfigFields(card, configFields) {
    const container = card.querySelector('.hitl-config-fields');
    if (!container || !configFields || configFields.length === 0) return;
    container.innerHTML = '';
    configFields.forEach((cf, idx) => {
        if (!cf.fields || cf.fields.length === 0) return;
        const section = document.createElement('div');
        section.style.cssText = 'margin-bottom:12px;padding:8px;background:#f8fafc;border-radius:6px;';
        section.innerHTML = `<div style="font-size:12px;color:#6b7280;margin-bottom:6px;font-weight:600;">${cf.component_name || cf.component_id}</div>`;
        cf.fields.forEach(f => {
            const fieldId = `comp${idx}_${f.id}`;
            let input = '';
            if (f.type === 'select' && f.options) {
                input = `<select class="hitl-field-select" data-field-id="${fieldId}" style="width:100%;padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;">`;
                f.options.forEach(o => {
                    const val = typeof o === 'object' ? o.value : o;
                    const label = typeof o === 'object' ? o.label : o;
                    input += `<option value="${val}" ${String(val) === String(f.default ?? '') ? 'selected' : ''}>${label}</option>`;
                });
                input += '</select>';
            } else if (f.type === 'color' || f.type === 'color_list') {
                input = `<input type="text" class="hitl-field-color" data-field-id="${fieldId}" value="${f.default ?? ''}" style="width:100%;padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;" placeholder="${f.label}">`;
            } else if (f.type === 'number') {
                input = `<input type="number" class="hitl-field-input" data-field-id="${fieldId}" value="${f.default ?? ''}" min="${f.min ?? ''}" max="${f.max ?? ''}" style="width:100%;padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;">`;
            } else if (f.type === 'boolean') {
                input = `<label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;width:fit-content;"><input type="checkbox" class="hitl-field-input" data-field-id="${fieldId}" ${f.default ? 'checked' : ''}> ${f.label}</label>`;
            } else {
                input = `<input type="text" class="hitl-field-input" data-field-id="${fieldId}" value="${f.default ?? ''}" style="width:100%;padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;" placeholder="${f.label}">`;
            }
            if (f.type !== 'boolean') {
                section.innerHTML += `<div style="margin-bottom:4px;"><label style="font-size:11px;color:#9ca3af;">${f.label}</label>${input}</div>`;
            } else {
                section.innerHTML += `<div style="margin-bottom:4px;">${input}</div>`;
            }
        });
        container.appendChild(section);
    });
}

function hitlSubmit(hitlId, action, values) {
    const card = document.querySelector(`.hitl-card[data-hitl-id="${hitlId}"]`);
    // Disable buttons
    if (card) {
        card.querySelectorAll('.hitl-option-btn').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
        });
        const footer = card.querySelector('.hitl-card-footer');
        if (footer) footer.innerHTML = '<span class="hitl-timeout-hint">✅ 响应已提交，智能助手继续执行...</span>';
    }

    const token = localStorage.getItem('dataOntologyToken') || '';
    fetch('/api/v1/agent/hitl/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ hitl_id: hitlId, action: action, values: values })
    }).then(r => r.json()).then(data => {
        if (!data.success) {
            // HITL entry 不存在可能是：已超时被agent消费、session重启、重复提交
            // 这些都是正常场景，不需要红色错误提示
            if (card) {
                const footer = card.querySelector('.hitl-card-footer');
                if (footer) footer.innerHTML = `<span class="hitl-timeout-hint">✅ 已处理</span>`;
            }
        } else {
            // HITL 提交成功，恢复轮询
            const assistantCard = card ? card.closest('.ai-message.assistant') : null;
            if (assistantCard && assistantCard._setHitlPending) {
                assistantCard._setHitlPending(false);
                // 立即触发一次轮询
                if (assistantCard._pollEvents) {
                    assistantCard._pollEvents();
                }
            }
        }
    }).catch(err => {
        console.error('HITL respond error:', err);
    });
}

// 创建可折叠的 trace 块（仿 PicoClaw isCollapsedBlock）
function createClusterBlock(title, className) {
    const block = document.createElement('div');
    block.className = `cluster-block ${className}`;
    const headerId = 'cbh-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
    block.innerHTML = `
        <div class="cluster-block-header" id="${headerId}" onclick="toggleClusterBlock(this)">
            <span class="cluster-block-title">${title}</span>
            <span class="cluster-block-chevron">▼</span>
        </div>
        <div class="cluster-block-body"></div>`;
    return block;
}

// 渲染 profile_table 数据概览卡片
function renderProfileCard(data, toolNameFallback) {
    const tableName = data.table_name || '';
    const rowCount = data.row_count != null ? Number(data.row_count).toLocaleString() : '?';

    let html = '<div class="profile-card">';
    // 顶部：表名 + 行数
    html += '<div class="profile-card-header">';
    html += '<span class="profile-card-title">' + escapeHtml(tableName || '数据概览') + '</span>';
    html += '<span class="profile-card-rows">' + rowCount + ' 行</span>';
    html += '</div>';

    // 字段列表
    if (Array.isArray(data.columns) && data.columns.length > 0) {
        html += '<div class="profile-card-columns">';
        for (const col of data.columns) {
            html += '<div class="profile-card-col">';
            // 左侧：字段名 + 类型
            html += '<div class="profile-col-left">';
            html += '<span class="profile-col-name">' + escapeHtml(col.name || '') + '</span>';
            html += '<span class="profile-col-type">' + escapeHtml(col.type || '') + '</span>';
            html += '</div>';
            // 右侧：统计信息
            html += '<div class="profile-col-right">';
            // 空值率
            const nullRate = col.null_rate != null ? col.null_rate : 0;
            const nullPct = (nullRate * 100).toFixed(nullRate < 0.01 ? 2 : 1);
            const barColor = nullRate === 0 ? '#2d3748' : nullRate < 0.05 ? '#718096' : nullRate < 0.2 ? '#a0aec0' : '#e53e3e';
            html += '<div class="profile-null-row">';
            html += '<div class="profile-null-bar"><div class="profile-null-fill" style="width:' + Math.max(nullRate * 100, 0.5) + '%;background:' + barColor + '"></div></div>';
            html += '<span class="profile-null-text">' + nullPct + '% null</span>';
            html += '</div>';
            // 数值字段：min/max/avg
            if (col.min !== undefined || col.max !== undefined || col.avg !== undefined) {
                const parts = [];
                if (col.min !== undefined) parts.push('min=' + col.min);
                if (col.max !== undefined) parts.push('max=' + col.max);
                if (col.avg !== undefined) parts.push('avg=' + (typeof col.avg === 'number' ? col.avg.toFixed(2) : col.avg));
                html += '<div class="profile-numeric-stats">' + escapeHtml(parts.join(' / ')) + '</div>';
            }
            // 字符串字段：TOP3 高频值
            if (Array.isArray(col.top_values) && col.top_values.length > 0) {
                html += '<div class="profile-top-values">';
                const topN = col.top_values.slice(0, 3);
                for (const tv of topN) {
                    const val = tv.value != null ? String(tv.value) : '(null)';
                    const cnt = tv.count != null ? Number(tv.count).toLocaleString() : '?';
                    html += '<span class="profile-top-item"><b>' + escapeHtml(val) + '</b> ' + cnt + '</span>';
                }
                html += '</div>';
            }
            // 错误信息
            if (col.error) {
                html += '<div class="profile-col-error">' + escapeHtml(col.error) + '</div>';
            }
            html += '</div>'; // profile-col-right
            html += '</div>'; // profile-card-col
        }
        html += '</div>'; // profile-card-columns
    }

    html += '</div>'; // profile-card
    return html;
}

// 将工具调用/返回内容格式化为用户友好的显示
function formatToolContent(rawContent, isResult, toolNameFallback) {
    if (!rawContent || rawContent.trim() === '' || rawContent.trim() === 'null' || rawContent.trim() === 'None') {
        return isResult ? '<div class="cluster-tool-summary"><span class="tool-status-empty">无返回数据</span></div>' : '<div class="cluster-tool-summary"><span class="tool-status-empty">无参数</span></div>';
    }
    
    // 尝试解析JSON
    let parsed = null;
    try {
        // 去掉可能的markdown代码块包裹
        let cleanContent = rawContent.trim();
        if (cleanContent.startsWith('```')) {
            cleanContent = cleanContent.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
        }
        parsed = JSON.parse(cleanContent);
    } catch(e) {
        // 不是JSON，检查是否是SQL
        const trimmed = rawContent.trim();
        if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH)\s/i.test(trimmed)) {
            return `<div class="cluster-tool-summary"><span class="tool-label">SQL</span><pre class="cluster-tool-sql">${escapeHtml(trimmed)}</pre></div>`;
        }
        // 普通文本，截取显示
        const display = trimmed.length > 200 ? trimmed.substring(0, 200) + '...' : trimmed;
        return `<div class="cluster-tool-summary">${escapeHtml(display)}</div>`;
    }

    // JSON解析成功
    if (isResult) {
        // === tool_result 格式化 ===

        // profile_table 数据概览卡片
        if (typeof parsed === 'object' && parsed !== null && parsed.row_count !== undefined && parsed.columns !== undefined) {
            return renderProfileCard(parsed, toolNameFallback);
        }

        // 数组：显示条数 + 摘要表
        if (Array.isArray(parsed)) {
            if (parsed.length === 0) {
                return '<div class="cluster-tool-summary"><span class="tool-status-empty">返回空数组</span></div>';
            }
            // 提取前3条做摘要表
            const columns = Object.keys(parsed[0] || {});
            const sampleRows = parsed.slice(0, 3);
            let tableHtml = '<div class="cluster-tool-summary">';
            tableHtml += `<span class="tool-label">结果</span><span class="tool-count">${parsed.length} 条记录</span>`;
            tableHtml += '<table class="md-table"><thead><tr>';
            const maxCols = Math.min(columns.length, 5);
            for (let i = 0; i < maxCols; i++) {
                tableHtml += `<th>${escapeHtml(columns[i])}</th>`;
            }
            if (columns.length > 5) tableHtml += '<th>...</th>';
            tableHtml += '</tr></thead><tbody>';
            for (const row of sampleRows) {
                tableHtml += '<tr>';
                for (let i = 0; i < maxCols; i++) {
                    const val = row[columns[i]];
                    const displayVal = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
                    tableHtml += `<td>${escapeHtml(displayVal.length > 30 ? displayVal.substring(0,30)+'...' : displayVal)}</td>`;
                }
                if (columns.length > 5) tableHtml += '<td>...</td>';
                tableHtml += '</tr>';
            }
            tableHtml += '</tbody></table>';
            if (parsed.length > 3) tableHtml += `<span class="tool-more">及 ${parsed.length - 3} 条更多...</span>`;
            tableHtml += '</div>';
            return tableHtml;
        }
        
        // 对象：提取关键字段
        if (typeof parsed === 'object') {
            const keys = Object.keys(parsed);
            // 如果只有success/error/message等通用字段
            if (parsed.success !== undefined) {
                const status = parsed.success ? '<span class="tool-status-ok">✓ 成功</span>' : '<span class="tool-status-err">✗ 失败</span>';
                let html = `<div class="cluster-tool-summary">${status}`;
                if (parsed.message) html += ` <span class="tool-detail">${escapeHtml(String(parsed.message).substring(0, 100))}</span>`;
                html += '</div>';
                return html;
            }
            // 一般对象：显示为简洁键值表
            let html = '<div class="cluster-tool-summary"><table class="md-table kv-table"><tbody>';
            const maxKeys = Math.min(keys.length, 8);
            for (let i = 0; i < maxKeys; i++) {
                const val = parsed[keys[i]];
                const displayVal = typeof val === 'object' ? (Array.isArray(val) ? `${val.length}项` : '...') : String(val ?? '');
                html += `<tr><th>${escapeHtml(keys[i])}</th><td>${escapeHtml(displayVal.length > 50 ? displayVal.substring(0,50)+'...' : displayVal)}</td></tr>`;
            }
            html += '</tbody></table>';
            if (keys.length > 8) html += `<span class="tool-more">及 ${keys.length - 8} 个字段...</span>`;
            html += '</div>';
            return html;
        }
        
        // 简单值
        return `<div class="cluster-tool-summary"><span class="tool-detail">${escapeHtml(String(parsed))}</span></div>`;
    } else {
        // === tool_call 格式化 ===
        // 空对象 {} 表示无参数调用
        if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length === 0) {
            return '<div class="cluster-tool-summary"><span class="tool-status-empty">无参数</span></div>';
        }
        // 提取工具名和参数摘要
        const toolName = parsed.name || parsed.tool || parsed.function?.name || toolNameFallback || '';
        const args = parsed.arguments || parsed.args || parsed.function?.arguments || parsed.parameters || parsed.params || parsed.input || null;
        
        let html = '<div class="cluster-tool-summary">';
        if (toolName) html += `<span class="tool-label">调用</span><span class="tool-name">${escapeHtml(toolName)}</span>`;
        
        if (args) {
            if (typeof args === 'string') {
                try { args = JSON.parse(args); } catch(e) {}
            }
            if (typeof args === 'object' && args !== null) {
                const argKeys = Object.keys(args);
                const maxArgs = Math.min(argKeys.length, 6);
                html += '<div class="tool-args">';
                for (let i = 0; i < maxArgs; i++) {
                    const val = args[argKeys[i]];
                    const displayVal = typeof val === 'object' ? (Array.isArray(val) ? `[${val.length}项]` : '{...}') : String(val ?? '');
                    html += `<span class="tool-arg"><b>${escapeHtml(argKeys[i])}</b>: ${escapeHtml(displayVal.length > 40 ? displayVal.substring(0,40)+'...' : displayVal)}</span>`;
                }
                html += '</div>';
                if (argKeys.length > 6) html += `<span class="tool-more">及 ${argKeys.length - 6} 个参数...</span>`;
            } else if (typeof args === 'string') {
                // SQL等长字符串参数
                if (/^(SELECT|INSERT|UPDATE|DELETE|WITH)\s/i.test(args)) {
                    html += `<pre class="cluster-tool-sql">${escapeHtml(args)}</pre>`;
                } else {
                    html += `<span class="tool-detail">${escapeHtml(args.substring(0, 100))}</span>`;
                }
            }
        } else {
            // 没有明确的args字段，显示对象的几个关键字
            const keys = Object.keys(parsed).filter(k => k !== 'name' && k !== 'tool' && k !== 'function');
            if (keys.length > 0) {
                html += '<div class="tool-args">';
                const maxK = Math.min(keys.length, 4);
                for (let i = 0; i < maxK; i++) {
                    const val = parsed[keys[i]];
                    const displayVal = typeof val === 'object' ? '...' : String(val ?? '');
                    html += `<span class="tool-arg"><b>${escapeHtml(keys[i])}</b>: ${escapeHtml(displayVal.length > 40 ? displayVal.substring(0,40)+'...' : displayVal)}</span>`;
                }
                html += '</div>';
            }
        }
        html += '</div>';
        return html;
    }
}

// 切换折叠块展开/收起
function toggleClusterBlock(headerEl) {
    const block = headerEl.parentElement;
    const body = block.querySelector('.cluster-block-body');
    const chevron = headerEl.querySelector('.cluster-block-chevron');
    const isCollapsed = block.classList.contains('collapsed');
    if (isCollapsed) {
        block.classList.remove('collapsed');
        body.style.display = 'block';
        chevron.textContent = '▼';
    } else {
        block.classList.add('collapsed');
        body.style.display = 'none';
        chevron.textContent = '▶';
    }
}

// 简易 Markdown 渲染（不依赖库）
function formatClusterMarkdown(text) {
    if (!text) return '';
    // 先处理 think 标签：提取思考内容到折叠块
    let thinkContent = '';
    let mainContent = text;

    const closedThinkRegex = /<think>([\s\S]*?)<\/think>/g;
    let match;
    while ((match = closedThinkRegex.exec(text)) !== null) {
        thinkContent += match[1];
    }

    const openThinkRegex = /<think>([\s\S]*)$/;
    const openMatch = openThinkRegex.exec(text.replace(closedThinkRegex, ''));
    if (openMatch) {
        thinkContent += openMatch[1];
    }

    mainContent = text.replace(closedThinkRegex, '').replace(/<think>[\s\S]*$/, '').trim();

    let result = '';
    if (thinkContent.trim()) {
        let thinkHtml = escapeHtml(thinkContent.trim());
        thinkHtml = thinkHtml.replace(/\n/g, '<br>');
        result += `<details class="ai-think-block"><summary class="ai-think-summary">💭 思考过程</summary><div class="ai-think-content">${thinkHtml}</div></details>`;
    }

    if (mainContent.trim()) {
        // 先提取表格（在 escapeHtml 之前，因为表格需要保留 | 结构）
        const tableBlocks = [];
        let textWithoutTables = mainContent;
        // markdown table: lines with |, separator line with |---|
        const tableRegex = /((?:^[ \t]*\|.+\|[ \t]*\n)+(?:^[ \t]*\|[-: ]+\|.+\|[ \t]*\n)(?:^[ \t]*\|.+\|[ \t]*\n)*)/gm;
        let tblMatch;
        while ((tblMatch = tableRegex.exec(mainContent)) !== null) {
            const tblText = tblMatch[1];
            const tblId = `__TABLE_${tableBlocks.length}__`;
            textWithoutTables = textWithoutTables.replace(tblText, tblId);
            tableBlocks.push({ id: tblId, text: tblText });
        }

        let html = escapeHtml(textWithoutTables);
        // bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // italic
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        // inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        // code block
        html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
        // headers
        html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
        // bullet list
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
        // numbered list
        html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
        // collapse multiple blank lines into one
        html = html.replace(/\n{2,}/g, '\n');
        // line breaks
        html = html.replace(/\n/g, '<br>');
        // remove <br> between/around list items (block elements don't need <br>)
        html = html.replace(/<\/li><br>/g, '</li>');
        html = html.replace(/<br><li>/g, '<li>');
        html = html.replace(/<br><ul>/g, '<ul>');
        html = html.replace(/<\/ul><br>/g, '</ul>');
        // remove <br> around headers
        html = html.replace(/<br><h[234]>/g, (m) => m.slice(4));
        html = html.replace(/<\/h[234]><br>/g, (m) => m.slice(0, -4));

        // 渲染表格
        for (const tbl of tableBlocks) {
            const lines = tbl.text.trim().split('\n');
            const rows = lines.map(line => line.trim().replace(/^ \|/, '').replace(/\| $/, '').split('|').map(c => c.trim()));
            // 分隔行（|---|---|）跳过
            let tableHtml = '<table class="md-table"><thead><tr>';
            // 第一行作为表头
            const headerCells = rows[0];
            headerCells.forEach(cell => { tableHtml += `<th>${escapeHtml(cell)}</th>`; });
            tableHtml += '</tr></thead><tbody>';
            // 数据行（跳过分隔行）
            for (let i = 2; i < rows.length; i++) {
                tableHtml += '<tr>';
                rows[i].forEach(cell => { tableHtml += `<td>${escapeHtml(cell)}</td>`; });
                tableHtml += '</tr>';
            }
            tableHtml += '</tbody></table>';
            html = html.replace(tbl.id, tableHtml);
        }

        result += html;
    }
    return result;
}

// Show agent configuration panel
function showAgentConfigPanel() {
    const existing = document.getElementById('agentConfigPanel');
    if (existing) { existing.remove(); return; }

    const panel = document.createElement('div');
    panel.id = 'agentConfigPanel';
    panel.className = 'agent-config-panel';
    panel.innerHTML = `
        <div class="agent-config-header">
            <div class="agent-config-title">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                智能体配置
            </div>
            <button class="agent-config-close" onclick="document.getElementById('agentConfigPanel').remove()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
        </div>
        <div class="agent-config-tabs">
            <button class="agent-config-tab active" onclick="switchAgentConfigTab('mcp', this)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                MCP Server
            </button>
            <button class="agent-config-tab" onclick="switchAgentConfigTab('skill', this)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                Skill
            </button>
            <button class="agent-config-tab" onclick="switchAgentConfigTab('status', this)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                状态
            </button>
        </div>
        <div id="agentConfigContent" class="agent-config-content">
            <div style="text-align:center;padding:24px;color:#94a3b8;">加载中...</div>
        </div>
    `;
    document.body.appendChild(panel);
    loadAgentConfigTab('mcp');
}

// Switch config panel tab
function switchAgentConfigTab(tab, btn) {
    document.querySelectorAll('.agent-config-tab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadAgentConfigTab(tab);
}

// Load config tab content
async function loadAgentConfigTab(tab) {
    const content = document.getElementById('agentConfigContent');
    if (!content) return;

    try {
        if (tab === 'mcp') {
            const resp = await fetchWithAuth(`${API_BASE}/api/v1/agent/mcp`);
            const json = await resp.json();
            renderMCPConfig(content, (json.data && json.data.mcp_servers) || []);
        } else if (tab === 'skill') {
            const resp = await fetchWithAuth(`${API_BASE}/api/v1/agent/skill`);
            const json = await resp.json();
            renderSkillConfig(content, json.data || []);
        } else if (tab === 'status') {
            const resp = await fetchWithAuth(`${API_BASE}/api/v1/agent/status`);
            const json = await resp.json();
            renderAgentStatus(content, json.data || json);
        }
    } catch (e) {
        content.innerHTML = `<div style="color:#e53e3e;padding:20px;">加载失败: ${escapeHtml(e.message)}</div>`;
    }
}

// Render MCP Server config
function renderMCPConfig(container, servers) {
    let html = '<div class="ac-list">';
    if (!servers.length) {
        html += `<div class="ac-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e0" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
            <div>暂无 MCP Server</div>
            <small>添加外部 MCP 服务扩展智能体能力</small>
        </div>`;
    } else {
        for (const s of servers) {
            const isRunning = s.status === 'running';
            const isBuiltin = s.builtin;
            const transport = s.transport || 'stdio';
            const toolsCount = s.tools_count || s.tools?.length || 0;
            
            // Transport type class
            const transportClass = transport === 'streamable-http' || transport === 'http' ? 'ac-transport-http' 
                : transport === 'sse' ? 'ac-transport-sse' : 'ac-transport-stdio';
            const transportLabel = transport === 'streamable-http' ? 'HTTP' : transport === 'sse' ? 'SSE' : 'STDIO';
            
            html += `<div class="ac-card ${isBuiltin ? 'ac-card-builtin' : ''}">
                <div class="ac-card-left">
                    <div class="ac-card-icon ${isRunning ? 'ac-icon-running' : 'ac-icon-stopped'}">
                        ${isBuiltin ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>'}
                    </div>
                    <div class="ac-card-info">
                        <div class="ac-card-name">${escapeHtml(s.name || '未命名')}
                            ${isBuiltin ? '<span class="ac-badge ac-badge-builtin">内置</span>' : ''}
                        </div>
                        <div class="ac-card-meta">
                            <span class="ac-transport ${transportClass}">${transportLabel}</span>
                            ${toolsCount > 0 ? `<span class="ac-tools-count"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>${toolsCount} 工具</span>` : ''}
                            ${s.url ? `<span class="ac-meta-detail">${escapeHtml(s.url.replace(/^https?:\/\//, '').split('/')[0])}</span>` : ''}
                            ${s.command ? `<span class="ac-meta-detail">${escapeHtml(s.command.split('/').pop())}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="ac-card-right">
                    <span class="ac-status ${isRunning ? 'ac-status-on' : 'ac-status-off'}">
                        <span class="ac-status-dot"></span>${isRunning ? '运行中' : '已停止'}
                    </span>
                    <div class="ac-card-actions">
                        ${!isBuiltin ? `
                            ${isRunning
                                ? `<button class="ac-btn ac-btn-ghost" onclick="toggleMCPServer('${s.id}','stop')" title="停止"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></button>`
                                : `<button class="ac-btn ac-btn-ghost" onclick="toggleMCPServer('${s.id}','start')" title="启动"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></button>`
                            }
                            <button class="ac-btn ac-btn-danger" onclick="removeMCPServer('${s.id}')\" title="删除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
                        ` : ''}
                    </div>
                </div>
            </div>`;
        }
    }
    html += '</div>';
    html += `<button class="ac-add-btn" onclick="showAddMCPForm()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        添加 MCP Server
    </button>`;
    container.innerHTML = html;
}

// Render Skill config
function renderSkillConfig(container, skills) {
    let html = '<div class="ac-list">';
    if (!skills.length) {
        html += `<div class="ac-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e0" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            <div>暂无 Skill</div>
            <small>添加技能增强智能体专业能力</small>
        </div>`;
    } else {
        for (const s of skills) {
            const category = s.category || s.type || '';
            const categoryColor = category === 'devops' ? '#10b981' : category === 'data' ? '#3b82f6' : category === 'ai' ? '#8b5cf6' : '#64748b';
            
            html += `<div class="ac-card" id="skill-card-${s.id}">
                <div class="ac-card-left">
                    <div class="ac-card-icon ${s.enabled ? 'ac-icon-running' : 'ac-icon-stopped'}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                    </div>
                    <div class="ac-card-info">
                        <div class="ac-card-name">${escapeHtml(s.name || '未命名')}
                            ${category ? `<span class="ac-badge" style="background:${categoryColor};color:white;">${escapeHtml(category)}</span>` : ''}
                        </div>
                        <div class="ac-card-meta">
                            ${s.description ? `<span class="ac-meta-detail">${escapeHtml(s.description.substring(0, 60))}${s.description.length > 60 ? '...' : ''}</span>` : ''}
                            ${s.source_path ? `<span class="ac-meta-path" title="${escapeHtml(s.source_path)}">📁 ${escapeHtml(s.source_path.split('/').pop())}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="ac-card-right">
                    <label class="ac-toggle" title="${s.enabled ? '点击禁用' : '点击启用'}">
                        <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="toggleSkill('${s.id}', this.checked)">
                        <span class="ac-toggle-track"></span>
                        <span class="ac-toggle-thumb"></span>
                    </label>
                    <div class="ac-card-actions">
                        <button class="ac-btn ac-btn-ghost" onclick="showEditSkillForm({id:'${s.id}',name:'${escapeHtml(s.name||'')}',description:'${escapeHtml(s.description||'')}',category:'${escapeHtml(s.category||'')}',source_path:'${escapeHtml(s.source_path||'')}'})" title="编辑"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        <button class="ac-btn ac-btn-ghost" onclick="showSkillFiles('${s.id}')" title="查看文件"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></button>
                        <button class="ac-btn ac-btn-ghost" onclick="reloadSkill('${s.id}')" title="重载"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg></button>
                        <button class="ac-btn ac-btn-danger" onclick="removeSkill('${s.id}')" title="删除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
                    </div>
                </div>
            </div>
            <div id="skill-files-${s.id}" class="skill-files-panel" style="display:none;"></div>`;
        }
    }
    html += '</div>';
    html += `<div class="ac-btn-group" style="margin-top:16px;display:flex;gap:8px;">
        <button class="ac-add-btn" onclick="showNewSkillForm()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15h6"/></svg>
            新建 Skill
        </button>
        <button class="ac-add-btn" onclick="showAddSkillForm()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            添加已有 Skill
        </button>
    </div>`;
    container.innerHTML = html;
}

// Render agent status
function renderAgentStatus(container, data) {
    const providers = data.providers || [];
    const mcpCount = data.mcp_count || (data.mcp_servers || []).length;
    const skillCount = (data.skills || []).length;

    let html = `<div class="ac-status-grid">
        <div class="ac-stat-card">
            <div class="ac-stat-icon" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            </div>
            <div class="ac-stat-info">
                <div class="ac-stat-value">${providers.length}</div>
                <div class="ac-stat-label">AI 模型</div>
            </div>
        </div>
        <div class="ac-stat-card">
            <div class="ac-stat-icon" style="background:linear-gradient(135deg,#10b981,#059669);">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
            </div>
            <div class="ac-stat-info">
                <div class="ac-stat-value">${mcpCount}</div>
                <div class="ac-stat-label">MCP 服务</div>
            </div>
        </div>
        <div class="ac-stat-card">
            <div class="ac-stat-icon" style="background:linear-gradient(135deg,#f59e0b,#d97706);">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            </div>
            <div class="ac-stat-info">
                <div class="ac-stat-value">${skillCount}</div>
                <div class="ac-stat-label">技能</div>
            </div>
        </div>
        <div class="ac-stat-card">
            <div class="ac-stat-icon" style="background:linear-gradient(135deg,#667eea,#764ba2);">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            </div>
            <div class="ac-stat-info">
                <div class="ac-stat-value">集群</div>
                <div class="ac-stat-label">运行模式</div>
            </div>
        </div>
    </div>`;

    // Provider details
    if (providers.length) {
        html += '<div class="ac-section-title">AI 模型配置</div><div class="ac-list">';
        for (const p of providers) {
            const modelName = (p.model || p.name || '未知').split('/').pop();
            html += `<div class="ac-card">
                <div class="ac-card-left">
                    <div class="ac-card-icon ac-icon-running">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20"/><path d="M12 2a15 15 0 014 10 15 15 0 01-4 10 15 15 0 01-4-10A15 15 0 0112 2z"/></svg>
                    </div>
                    <div class="ac-card-info">
                        <div class="ac-card-name">${escapeHtml(modelName)}</div>
                        <div class="ac-card-meta">
                            <span class="ac-tag">${escapeHtml((p.provider || p.type || 'api'))}</span>
                            ${p.url ? `<span class="ac-meta-detail">${escapeHtml(p.url.replace(/^https?:\/\//, '').split('/')[0])}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="ac-card-right">
                    <span class="ac-status ac-status-on"><span class="ac-status-dot"></span>就绪</span>
                </div>
            </div>`;
        }
        html += '</div>';
    }

    container.innerHTML = html;
}

// MCP Server actions
async function toggleMCPServer(id, action) {
    try {
        await fetchWithAuth(`${API_BASE}/api/v1/agent/mcp`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id, action: action })
        });
        loadAgentConfigTab('mcp');
    } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}

async function removeMCPServer(id) {
    if (!confirm('确定删除此 MCP Server?')) return;
    try {
        await fetchWithAuth(`${API_BASE}/api/v1/agent/mcp?id=${id}`, { method: 'DELETE' });
        loadAgentConfigTab('mcp');
    } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
}

function showAddMCPForm() {
    // 在列表下方插入表单
    const container = document.getElementById('agentConfigContent');
    const existingForm = document.getElementById('mcp-add-form');
    if (existingForm) { existingForm.remove(); return; }
    
    const formHtml = `
    <div id="mcp-add-form" class="ac-form-card">
        <div class="ac-form-header">
            <h3>添加 MCP Server</h3>
            <button class="ac-btn ac-btn-ghost" onclick="document.getElementById('mcp-add-form').remove()">✕</button>
        </div>
        <div class="ac-form-body">
            <div class="ac-form-row">
                <label>名称 <span class="ac-required">*</span></label>
                <input type="text" id="mcp-name" placeholder="如: my-mcp-server" class="ac-input">
            </div>
            <div class="ac-form-row">
                <label>传输类型</label>
                <select id="mcp-transport" class="ac-select" onchange="toggleMCPFields()">
                    <option value="stdio">stdio (本地进程)</option>
                    <option value="sse">sse (Server-Sent Events)</option>
                    <option value="streamable_http">streamable-http (HTTP)</option>
                </select>
            </div>
            <div id="mcp-http-fields" style="display:none;">
                <div class="ac-form-row">
                    <label>URL <span class="ac-required">*</span></label>
                    <input type="text" id="mcp-url" placeholder="http://localhost:3000/mcp" class="ac-input">
                </div>
                <div class="ac-form-row">
                    <label>请求头 (JSON)</label>
                    <input type="text" id="mcp-headers" placeholder='{"Authorization":"Bearer xxx"}' class="ac-input">
                </div>
            </div>
            <div id="mcp-stdio-fields">
                <div class="ac-form-row">
                    <label>命令 <span class="ac-required">*</span></label>
                    <input type="text" id="mcp-command" placeholder="npx @modelcontextprotocol/server-sqlite" class="ac-input">
                </div>
                <div class="ac-form-row">
                    <label>参数 (空格分隔)</label>
                    <input type="text" id="mcp-args" placeholder="-y @modelcontextprotocol/server-echo" class="ac-input">
                </div>
                <div class="ac-form-row">
                    <label>环境变量 (JSON)</label>
                    <input type="text" id="mcp-env" placeholder='{"API_KEY":"xxx"}' class="ac-input">
                </div>
            </div>
            <div class="ac-form-row">
                <label>描述</label>
                <input type="text" id="mcp-desc" placeholder="可选描述" class="ac-input">
            </div>
            <div class="ac-form-actions">
                <button class="ac-btn ac-btn-secondary" onclick="document.getElementById('mcp-add-form').remove()">取消</button>
                <button class="ac-btn ac-btn-primary" onclick="submitMCPForm()">添加</button>
            </div>
        </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', formHtml);
}

function toggleMCPFields() {
    const transport = document.getElementById('mcp-transport').value;
    document.getElementById('mcp-http-fields').style.display = (transport === 'sse' || transport === 'streamable_http') ? 'block' : 'none';
    document.getElementById('mcp-stdio-fields').style.display = transport === 'stdio' ? 'block' : 'none';
}

async function submitMCPForm() {
    const name = document.getElementById('mcp-name').value.trim();
    if (!name) { showToast('请输入名称', 'error'); return; }
    
    const transport = document.getElementById('mcp-transport').value;
    let body = { name, type: transport, enabled: true, auto_start: false };
    
    if (transport === 'sse' || transport === 'streamable_http') {
        const url = document.getElementById('mcp-url').value.trim();
        if (!url) { showToast('请输入 URL', 'error'); return; }
        body.url = url;
        const headers = document.getElementById('mcp-headers').value.trim();
        if (headers) try { body.headers = JSON.parse(headers); } catch(e) { showToast('请求头 JSON 格式错误', 'error'); return; }
    } else {
        const command = document.getElementById('mcp-command').value.trim();
        if (!command) { showToast('请输入命令', 'error'); return; }
        body.command = command;
        const args = document.getElementById('mcp-args').value.trim();
        if (args) body.args = args.split(/\s+/);
        const env = document.getElementById('mcp-env').value.trim();
        if (env) try { body.env = JSON.parse(env); } catch(e) { showToast('环境变量 JSON 格式错误', 'error'); return; }
    }
    
    const desc = document.getElementById('mcp-desc').value.trim();
    if (desc) body.description = desc;
    
    try {
        await fetchWithAuth(`${API_BASE}/api/v1/agent/mcp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        document.getElementById('mcp-add-form').remove();
        loadAgentConfigTab('mcp');
        showToast('MCP Server 添加成功', 'success');
    } catch (e) {
        showToast('添加失败: ' + e.message, 'error');
    }
}

// Show skill files panel
async function showSkillFiles(skillId) {
    const panel = document.getElementById(`skill-files-${skillId}`);
    if (!panel) return;
    
    // Toggle panel
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
        return;
    }
    
    // Show loading
    panel.style.display = 'block';
    panel.innerHTML = '<div class="skill-files-loading">加载中...</div>';
    
    try {
        const res = await fetchWithAuth(`${API_BASE}/api/v1/agent/skill/files?id=${skillId}`);
        const data = await res.json();
        
        if (!data.success) {
            panel.innerHTML = `<div class="skill-files-error">加载失败: ${data.message}</div>`;
            return;
        }
        
        const files = data.data.files || [];
        
        // Build file tree with toolbar
        let html = '<div class="skill-files-tree">';
        html += `<div class="skill-files-header"><strong>📁 ${escapeHtml(data.data.source_path)}</strong></div>`;
        
        // Toolbar
        html += `<div class="skill-files-toolbar">
            <button onclick="createSkillFile('${skillId}')" class="primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15h6"/></svg>
                新建文件
            </button>
            <button onclick="createSkillDir('${skillId}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><path d="M12 11v6M9 14h6"/></svg>
                新建文件夹
            </button>
            <button onclick="uploadSkillFile('${skillId}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                上传文件
            </button>
        </div>`;
        
        if (files.length === 0) {
            html += '<div class="skill-files-empty">目录为空，点击上方按钮添加文件</div>';
        } else {
            // Group by directory
            const tree = buildFileTree(files);
            html += renderFileTree(tree, skillId);
        }
        
        html += '</div>';
        panel.innerHTML = html;
        
        // Store skill info for later use
        panel.dataset.skillId = skillId;
        panel.dataset.sourcePath = data.data.source_path;
    } catch (e) {
        panel.innerHTML = `<div class="skill-files-error">加载失败: ${e.message}</div>`;
    }
}

function buildFileTree(files) {
    const root = { name: '', children: {}, files: [] };
    
    for (const f of files) {
        const parts = f.rel.split('/');
        let current = root;
        
        // Navigate/create directories
        for (let i = 0; i < parts.length - 1; i++) {
            const dir = parts[i];
            if (!current.children[dir]) {
                current.children[dir] = { name: dir, children: {}, files: [] };
            }
            current = current.children[dir];
        }
        
        // Add file
        current.files.push(f);
    }
    
    return root;
}

function renderFileTree(node, skillId, depth = 0, basePath = '') {
    let html = '';
    const indent = depth * 16;
    
    // Render directories
    for (const dirName of Object.keys(node.children).sort()) {
        const child = node.children[dirName];
        const dirPath = basePath ? `${basePath}/${dirName}` : dirName;
        html += `<div class="skill-file-item skill-file-dir" style="padding-left:${indent}px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
            <span class="skill-file-name">${escapeHtml(dirName)}</span>
            <div class="skill-file-actions">
                <button onclick="createSkillFile('${skillId}', '${dirPath}')" title="在此目录新建文件">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M12 18v-6M9 15h6"/></svg>
                </button>
                <button onclick="deleteSkillDir('${skillId}', '${dirPath}')" title="删除文件夹">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
            </div>
        </div>`;
        html += renderFileTree(child, skillId, depth + 1, dirPath);
    }
    
    // Render files
    for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
        const icon = getFileIcon(f.name);
        const size = f.size ? formatFileSize(f.size) : '';
        const filePath = f.rel;
        const isSkillMd = f.name === 'SKILL.md';
        html += `<div class="skill-file-item ${isSkillMd ? 'skill-file-main' : ''}" style="padding-left:${indent}px;" title="${escapeHtml(f.path)}">
            ${icon}
            <span class="skill-file-name" onclick="editSkillFile('${skillId}', '${filePath}')">${escapeHtml(f.name)}</span>
            ${size ? `<span class="skill-file-size">${size}</span>` : ''}
            <div class="skill-file-actions">
                <button onclick="editSkillFile('${skillId}', '${filePath}')" title="编辑">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                ${!isSkillMd ? `<button onclick="deleteSkillFile('${skillId}', '${filePath}')" title="删除">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>` : ''}
            </div>
        </div>`;
    }
    
    return html;
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'md': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
        'json': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>',
        'yaml': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>',
        'py': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>',
        'sh': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>',
    };
    return icons[ext] || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Skill actions
async function toggleSkill(id, enabled) {
    try {
        await fetchWithAuth(`${API_BASE}/api/v1/agent/skill`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, enabled })
        });
        loadAgentConfigTab('skill');
    } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}

async function reloadSkill(id) {
    try {
        await fetchWithAuth(`${API_BASE}/api/v1/agent/skill`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, action: 'reload' })
        });
        loadAgentConfigTab('skill');
        showToast('Skill 已重新加载', 'info');
    } catch (e) { showToast('重载失败: ' + e.message, 'error'); }
}

async function removeSkill(id) {
    if (!confirm('确定删除此 Skill?')) return;
    try {
        await fetchWithAuth(`${API_BASE}/api/v1/agent/skill?id=${id}`, { method: 'DELETE' });
        loadAgentConfigTab('skill');
    } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
}

function showAddSkillForm() {
    const container = document.getElementById('agentConfigContent');
    const existingForm = document.getElementById('skill-add-form');
    if (existingForm) { existingForm.remove(); return; }
    
    const formHtml = `
    <div id="skill-add-form" class="ac-form-card">
        <div class="ac-form-header">
            <h3>添加 Skill</h3>
            <button class="ac-btn ac-btn-ghost" onclick="document.getElementById('skill-add-form').remove()">✕</button>
        </div>
        <div class="ac-form-body">
            <div class="ac-form-row">
                <label>名称 <span class="ac-required">*</span></label>
                <input type="text" id="skill-name" placeholder="如: my-skill" class="ac-input">
            </div>
            <div class="ac-form-row">
                <label>SKILL.md 路径 <span class="ac-required">*</span></label>
                <div class="skill-path-input-group">
                    <input type="text" id="skill-path" placeholder="点击下方浏览器选择 SKILL.md 文件" class="ac-input" readonly>
                    <button type="button" class="ac-btn ac-btn-secondary" onclick="toggleSkillFileBrowser()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                        浏览
                    </button>
                </div>
                <small class="ac-form-hint">从文件浏览器中选择 SKILL.md 文件</small>
            </div>
            <div id="skill-file-browser" class="skill-file-browser" style="display:none;">
                <div class="sfb-toolbar">
                    <button class="sfb-btn" onclick="browseSkillPath('')" title="根目录">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/></svg>
                    </button>
                    <button class="sfb-btn" onclick="browseSkillParentPath()" title="上级目录">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    </button>
                    <span id="sfb-current-path" class="sfb-path-display">/</span>
                    <button class="sfb-btn sfb-refresh" onclick="refreshSkillBrowser()" title="刷新">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
                    </button>
                </div>
                <div id="sfb-file-list" class="sfb-file-list">
                    <div class="sfb-loading">加载中...</div>
                </div>
            </div>
            <div class="ac-form-row">
                <label>描述</label>
                <input type="text" id="skill-desc" placeholder="可选描述" class="ac-input">
            </div>
            <div class="ac-form-row">
                <label>分类</label>
                <select id="skill-category" class="ac-select">
                    <option value="">无</option>
                    <option value="devops">DevOps</option>
                    <option value="data">数据</option>
                    <option value="ai">AI</option>
                    <option value="productivity">效率</option>
                </select>
            </div>
            <div class="ac-form-actions">
                <button class="ac-btn ac-btn-secondary" onclick="document.getElementById('skill-add-form').remove()">取消</button>
                <button class="ac-btn ac-btn-primary" onclick="submitSkillForm()">添加</button>
            </div>
        </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', formHtml);
    // 文件浏览器在用户点击"浏览"按钮时加载，不自动加载
}

// 新建 Skill 表单（创建新目录 + SKILL.md）
function showNewSkillForm() {
    const container = document.getElementById('agentConfigContent');
    const existingForm = document.getElementById('skill-new-form');
    if (existingForm) { existingForm.remove(); return; }
    
    const formHtml = `
    <div id="skill-new-form" class="ac-form-card">
        <div class="ac-form-header">
            <h3>新建 Skill</h3>
            <button class="ac-btn ac-btn-ghost" onclick="document.getElementById('skill-new-form').remove()">✕</button>
        </div>
        <div class="ac-form-body">
            <div class="ac-form-row">
                <label>名称 <span class="ac-required">*</span></label>
                <input type="text" id="new-skill-name" placeholder="如: my-skill" class="ac-input">
                <small class="ac-form-hint">将在 /opt/datatoolbox/agent-config/skills/ 下创建同名目录</small>
            </div>
            <div class="ac-form-row">
                <label>描述</label>
                <textarea id="new-skill-desc" placeholder="Skill 描述（可选）" class="ac-input" rows="3"></textarea>
            </div>
            <div class="ac-form-row">
                <label>分类</label>
                <select id="new-skill-category" class="ac-select">
                    <option value="">无</option>
                    <option value="devops">DevOps</option>
                    <option value="data">数据</option>
                    <option value="ai">AI</option>
                    <option value="productivity">效率</option>
                </select>
            </div>
            <div class="ac-form-actions">
                <button class="ac-btn ac-btn-secondary" onclick="document.getElementById('skill-new-form').remove()">取消</button>
                <button class="ac-btn ac-btn-primary" onclick="submitNewSkillForm()">创建</button>
            </div>
        </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', formHtml);
}

async function submitNewSkillForm() {
    const name = document.getElementById('new-skill-name').value.trim();
    if (!name) { showToast('请输入名称', 'error'); return; }
    
    // 验证名称格式（只允许字母、数字、连字符、下划线）
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        showToast('名称只能包含字母、数字、连字符和下划线', 'error');
        return;
    }
    
    const body = { name, enabled: true };
    const desc = document.getElementById('new-skill-desc').value.trim();
    if (desc) body.description = desc;
    const category = document.getElementById('new-skill-category').value;
    if (category) body.category = category;
    
    try {
        await fetchWithAuth(`${API_BASE}/api/v1/agent/skill?create=new`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        document.getElementById('skill-new-form').remove();
        loadAgentConfigTab('skill');
        showToast('Skill 创建成功', 'success');
    } catch (e) {
        showToast('创建失败: ' + e.message, 'error');
    }
}

// 编辑 Skill 元信息
function showEditSkillForm(skill) {
    const container = document.getElementById('agentConfigContent');
    const existingForm = document.getElementById('skill-edit-form');
    if (existingForm) { existingForm.remove(); return; }
    
    const formHtml = `
    <div id="skill-edit-form" class="ac-form-card">
        <div class="ac-form-header">
            <h3>编辑 Skill</h3>
            <button class="ac-btn ac-btn-ghost" onclick="document.getElementById('skill-edit-form').remove()">✕</button>
        </div>
        <div class="ac-form-body">
            <div class="ac-form-row">
                <label>ID</label>
                <input type="text" value="${escapeHtml(skill.id)}" class="ac-input" disabled>
            </div>
            <div class="ac-form-row">
                <label>名称 <span class="ac-required">*</span></label>
                <input type="text" id="edit-skill-name" value="${escapeHtml(skill.name)}" class="ac-input">
            </div>
            <div class="ac-form-row">
                <label>描述</label>
                <textarea id="edit-skill-desc" class="ac-input" rows="3">${escapeHtml(skill.description || '')}</textarea>
            </div>
            <div class="ac-form-row">
                <label>分类</label>
                <select id="edit-skill-category" class="ac-select">
                    <option value="" ${!skill.category ? 'selected' : ''}>无</option>
                    <option value="devops" ${skill.category === 'devops' ? 'selected' : ''}>DevOps</option>
                    <option value="data" ${skill.category === 'data' ? 'selected' : ''}>数据</option>
                    <option value="ai" ${skill.category === 'ai' ? 'selected' : ''}>AI</option>
                    <option value="productivity" ${skill.category === 'productivity' ? 'selected' : ''}>效率</option>
                </select>
            </div>
            <div class="ac-form-row">
                <label>路径</label>
                <input type="text" value="${escapeHtml(skill.source_path)}" class="ac-input" disabled>
                <small class="ac-form-hint">路径不可修改，如需更换请删除后重新添加</small>
            </div>
            <div class="ac-form-actions">
                <button class="ac-btn ac-btn-secondary" onclick="document.getElementById('skill-edit-form').remove()">取消</button>
                <button class="ac-btn ac-btn-primary" onclick="submitEditSkillForm('${skill.id}')">保存</button>
            </div>
        </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', formHtml);
}

async function submitEditSkillForm(skillId) {
    const name = document.getElementById('edit-skill-name').value.trim();
    if (!name) { showToast('请输入名称', 'error'); return; }
    
    const body = { id: skillId, name, enabled: true };
    const desc = document.getElementById('edit-skill-desc').value.trim();
    if (desc) body.description = desc;
    const category = document.getElementById('edit-skill-category').value;
    if (category) body.category = category;
    
    try {
        // 先获取当前 skill 的 source_path
        const res = await fetchWithAuth(`${API_BASE}/api/v1/agent/skill`);
        const data = await res.json();
        const skills = data.data || [];
        const current = skills.find(s => s.id === skillId);
        if (current) {
            body.source_path = current.source_path;
        }
        
        await fetchWithAuth(`${API_BASE}/api/v1/agent/skill`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        document.getElementById('skill-edit-form').remove();
        loadAgentConfigTab('skill');
        showToast('Skill 更新成功', 'success');
    } catch (e) {
        showToast('更新失败: ' + e.message, 'error');
    }
}

async function submitSkillForm() {
    const name = document.getElementById('skill-name').value.trim();
    const sourcePath = document.getElementById('skill-path').value.trim();
    if (!name) { showToast('请输入名称', 'error'); return; }
    if (!sourcePath) { showToast('请选择 SKILL.md 文件', 'error'); return; }
    
    const body = { name, source_path: sourcePath, enabled: true };
    const desc = document.getElementById('skill-desc').value.trim();
    if (desc) body.description = desc;
    const category = document.getElementById('skill-category').value;
    if (category) body.category = category;
    
    try {
        await fetchWithAuth(`${API_BASE}/api/v1/agent/skill`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        document.getElementById('skill-add-form').remove();
        loadAgentConfigTab('skill');
        showToast('Skill 添加成功', 'success');
    } catch (e) {
        showToast('添加失败: ' + e.message, 'error');
    }
}

// ========== Skill 文件浏览器操作 ==========

let _skillBrowserCurrentPath = '';

// 切换文件浏览器显示
function toggleSkillFileBrowser() {
    const browser = document.getElementById('skill-file-browser');
    if (!browser) return;
    
    if (browser.style.display === 'none') {
        browser.style.display = 'block';
        // 始终重新加载当前目录，确保数据最新
        browseSkillPath(_skillBrowserCurrentPath || '');
    } else {
        browser.style.display = 'none';
    }
}

// 浏览指定路径
async function browseSkillPath(path) {
    const fileList = document.getElementById('sfb-file-list');
    const pathDisplay = document.getElementById('sfb-current-path');
    if (!fileList) return;
    
    fileList.innerHTML = '<div class="sfb-loading">加载中...</div>';
    
    try {
        const url = path ? `${API_BASE}/api/v1/agent/skill/browse?path=${encodeURIComponent(path)}` : `${API_BASE}/api/v1/agent/skill/browse`;
        const resp = await fetchWithAuth(url);
        const data = await resp.json();
        
        if (!data.success) {
            fileList.innerHTML = `<div class="sfb-error">加载失败: ${data.message}</div>`;
            return;
        }
        
        _skillBrowserCurrentPath = data.data.current_path;
        pathDisplay.textContent = _skillBrowserCurrentPath;
        
        const files = data.data.files || [];
        const parentPath = data.data.parent_path || '';
        
        let html = '';
        
        // 父目录条目
        if (parentPath) {
            html += `<div class="sfb-item sfb-parent" onclick="browseSkillPath('${escapeHtml(parentPath)}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                <span>..</span>
            </div>`;
        }
        
        if (files.length === 0) {
            html += '<div class="sfb-empty">目录为空</div>';
        } else {
            for (const f of files) {
                if (f.is_dir) {
                    html += `<div class="sfb-item sfb-dir" onclick="browseSkillPath('${escapeHtml(f.path)}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                        <span>${escapeHtml(f.name)}</span>
                    </div>`;
                } else if (f.is_skill) {
                    // SKILL.md 文件，高亮显示，点击选择
                    html += `<div class="sfb-item sfb-skill" onclick="selectSkillFile('${escapeHtml(f.path)}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
                        <span class="sfb-skill-name">SKILL.md</span>
                        <span class="sfb-skill-badge">✓ 选择</span>
                    </div>`;
                } else {
                    // 其他文件，灰色显示
                    const icon = getFileIcon(f.name);
                    html += `<div class="sfb-item sfb-file" onclick="selectSkillFile('${escapeHtml(f.path)}')">
                        ${icon}
                        <span>${escapeHtml(f.name)}</span>
                        <span class="sfb-file-size">${formatFileSize(f.size)}</span>
                    </div>`;
                }
            }
        }
        
        fileList.innerHTML = html;
    } catch (e) {
        fileList.innerHTML = `<div class="sfb-error">加载失败: ${e.message}</div>`;
    }
}

// 浏览父目录
function browseSkillParentPath() {
    if (!_skillBrowserCurrentPath || _skillBrowserCurrentPath === '/') {
        return;
    }
    
    const parentPath = _skillBrowserCurrentPath.split('/').slice(0, -1).join('/') || '/';
    browseSkillPath(parentPath);
}

// 刷新当前目录
function refreshSkillBrowser() {
    browseSkillPath(_skillBrowserCurrentPath);
}

// 选择文件
function selectSkillFile(path) {
    const input = document.getElementById('skill-path');
    if (input) {
        input.value = path;
        // 添加视觉反馈
        input.style.background = '#f0fdf4';
        setTimeout(() => { input.style.background = ''; }, 500);
    }
    
    // 如果是 SKILL.md，自动提取名称（父目录名）
    if (path.endsWith('/SKILL.md') || path.endsWith('SKILL.md')) {
        const nameInput = document.getElementById('skill-name');
        if (nameInput && !nameInput.value.trim()) {
            const parts = path.split('/');
            const parentDir = parts[parts.length - 2] || 'skill';
            nameInput.value = parentDir;
        }
    }
}

// ========== Skill 文件管理操作 ==========

// 新建文件
async function createSkillFile(skillId, dirPath = '') {
    const fileName = prompt('请输入文件名（如: references/api.md）:', dirPath ? dirPath + '/new-file.md' : 'new-file.md');
    if (!fileName) return;
    
    const cleanName = fileName.trim();
    if (!cleanName) { showToast('文件名不能为空', 'error'); return; }
    
    try {
        await fetchWithAuth(`${API_BASE}/api/v1/agent/skill/files`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skill_id: skillId, path: cleanName, type: 'file', content: '' })
        });
        showToast('文件创建成功', 'success');
        showSkillFiles(skillId); // 刷新文件列表
    } catch (e) { showToast('创建失败: ' + e.message, 'error'); }
}

// 新建文件夹
async function createSkillDir(skillId, parentPath = '') {
    const dirName = prompt('请输入文件夹名:', parentPath ? parentPath + '/new-folder' : 'new-folder');
    if (!dirName) return;
    
    const cleanName = dirName.trim();
    if (!cleanName) { showToast('文件夹名不能为空', 'error'); return; }
    
    try {
        await fetchWithAuth(`${API_BASE}/api/v1/agent/skill/files`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skill_id: skillId, path: cleanName, type: 'dir' })
        });
        showToast('文件夹创建成功', 'success');
        showSkillFiles(skillId);
    } catch (e) { showToast('创建失败: ' + e.message, 'error'); }
}

// 编辑文件（弹窗编辑器）
async function editSkillFile(skillId, filePath) {
    try {
        // 先读取文件内容
        const resp = await fetchWithAuth(`${API_BASE}/api/v1/agent/skill/files?id=${skillId}&path=${encodeURIComponent(filePath)}`);
        const data = await resp.json();
        if (!data.success) throw new Error(data.message || '读取失败');
        
        const content = data.data.content || '';
        const fileName = filePath.split('/').pop();
        
        // 创建编辑器弹窗
        const modalHtml = `
        <div id="skill-file-editor-modal" class="modal-overlay" style="display:flex;align-items:center;justify-content:center;z-index:10000;">
            <div class="modal-content" style="width:90%;max-width:800px;height:80vh;background:#fff;border-radius:12px;display:flex;flex-direction:column;">
                <div class="modal-header" style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
                    <h3 style="margin:0;font-size:16px;color:#111827;">编辑: ${escapeHtml(fileName)}</h3>
                    <button onclick="document.getElementById('skill-file-editor-modal').remove()" style="background:none;border:none;font-size:20px;color:#6b7280;cursor:pointer;">✕</button>
                </div>
                <div class="modal-body" style="flex:1;padding:16px;overflow:hidden;">
                    <textarea id="skill-file-editor-content" style="width:100%;height:100%;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-family:monospace;font-size:14px;resize:none;outline:none;" spellcheck="false">${escapeHtml(content)}</textarea>
                </div>
                <div class="modal-footer" style="padding:16px 20px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:12px;">
                    <button onclick="document.getElementById('skill-file-editor-modal').remove()" class="ac-btn ac-btn-secondary">取消</button>
                    <button onclick="saveSkillFileContent('${skillId}', '${filePath}')" class="ac-btn ac-btn-primary">保存</button>
                </div>
            </div>
        </div>`;
        
        // 移除旧弹窗（如果存在）
        const oldModal = document.getElementById('skill-file-editor-modal');
        if (oldModal) oldModal.remove();
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    } catch (e) { showToast('读取文件失败: ' + e.message, 'error'); }
}

// 保存文件内容
async function saveSkillFileContent(skillId, filePath) {
    const textarea = document.getElementById('skill-file-editor-content');
    if (!textarea) return;
    
    const content = textarea.value;
    
    try {
        await fetchWithAuth(`${API_BASE}/api/v1/agent/skill/files`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skill_id: skillId, path: filePath, content })
        });
        showToast('文件保存成功', 'success');
        document.getElementById('skill-file-editor-modal').remove();
        showSkillFiles(skillId); // 刷新文件列表
    } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
}

// 删除文件
async function deleteSkillFile(skillId, filePath) {
    if (!confirm(`确定删除文件 "${filePath}"?`)) return;
    
    try {
        await fetchWithAuth(`${API_BASE}/api/v1/agent/skill/files`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skill_id: skillId, path: filePath })
        });
        showToast('文件已删除', 'info');
        showSkillFiles(skillId);
    } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
}

// 删除文件夹
async function deleteSkillDir(skillId, dirPath) {
    if (!confirm(`确定删除文件夹 "${dirPath}" 及其所有内容?`)) return;
    
    try {
        await fetchWithAuth(`${API_BASE}/api/v1/agent/skill/files`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skill_id: skillId, path: dirPath })
        });
        showToast('文件夹已删除', 'info');
        showSkillFiles(skillId);
    } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
}

// 上传文件
function uploadSkillFile(skillId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.md,.json,.yaml,.yml,.py,.sh,.txt,.js,.ts,.html,.css';
    
    input.onchange = async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        
        for (const file of files) {
            try {
                const content = await readFileAsText(file);
                await fetchWithAuth(`${API_BASE}/api/v1/agent/skill/files`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ skill_id: skillId, path: file.name, type: 'file', content })
                });
                showToast(`已上传: ${file.name}`, 'success');
            } catch (err) {
                showToast(`上传 ${file.name} 失败: ${err.message}`, 'error');
            }
        }
        
        showSkillFiles(skillId); // 刷新文件列表
    };
    
    input.click();
}

// 辅助函数：读取文件为文本
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsText(file);
    });
}

// ==================== 应用广场模块 ====================

// 加载应用广场列表
async function loadAppsMarketplace() {
    const container = document.getElementById('appsMarketplaceList');
    if (!container) return;
    
    container.innerHTML = '<div class="loading">加载中...</div>';
    
    try {
        const response = await fetchWithAuth('/api/v1/apps');
        if (!response.ok) throw new Error('加载失败: ' + response.status);
        const data = await response.json();
        console.log('[loadAppsMarketplace] API response:', JSON.stringify(data).substring(0, 500));
        const apps = data.data?.apps || data.apps || [];
        console.log('[loadAppsMarketplace] parsed apps count:', apps.length);
        
        if (apps.length === 0) {
            container.innerHTML = `
                <div class="apps-empty-state">
                    <div class="empty-icon">📦</div>
                    <h3>暂无应用</h3>
                    <p>点击上方「创建应用」按钮添加第一个应用</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = apps.map(app => {
            // 从 config 中提取蓝图信息
            let blueprint = null;
            try { blueprint = (typeof app.config === 'string' ? JSON.parse(app.config) : app.config)?.blueprint; } catch(e) {}
            const designLabel = blueprint?.design_direction ? {minimal:'极简',corporate:'商务',vibrant:'活力',elegant:'优雅',playful:'趣味',dark:'暗色',nature:'自然',brutalist:'粗野'}[blueprint.design_direction] || blueprint.design_direction : '';
            const primaryColor = blueprint?.primary_color || '';
            const styleTag = blueprint?.style || '';
            return `
            <div class="app-card-item">
                <div class="app-card-icon">${app.icon || '📄'}</div>
                <h3 class="app-card-title">${escapeHtml(app.title)}</h3>
                <p class="app-card-desc">${escapeHtml(app.description || '暂无描述')}</p>
                <div class="app-card-meta">
                    <span class="app-card-slug">/app/${escapeHtml(app.slug)}</span>
                    <span>访问: ${app.view_count || 0}</span>
                    ${designLabel ? `<span class="app-card-badge" ${primaryColor ? `style="background:${primaryColor}22;color:${primaryColor};border:1px solid ${primaryColor}44"` : ''}>${designLabel}</span>` : ''}
                    ${primaryColor ? `<span class="app-card-color-dot" style="background:${primaryColor}" title="${primaryColor}"></span>` : ''}
                </div>
                <div class="app-card-actions">
                    <button class="btn" onclick="openAppInMarketplace('${escapeHtml(app.slug)}')">打开</button>
                    <button class="btn" onclick="editAppInMarketplace('${escapeHtml(app.id)}')">编辑</button>
                    <button class="btn btn-danger" onclick="deleteAppInMarketplace('${escapeHtml(app.id)}', '${escapeHtml(app.title)}')">删除</button>
                </div>
            </div>
        `;}).join('');
    } catch (e) {
        console.error('加载应用列表失败:', e);
        container.innerHTML = `<div class="apps-empty-state"><div class="empty-icon">❌</div><h3>加载失败</h3><p>${escapeHtml(e.message)}</p></div>`;
    }
}

// 打开应用编辑器（内联 CodePen 风格）
function openAppEditor() {
    // 切换视图
    document.getElementById('appsListView').style.display = 'none';
    const editorView = document.getElementById('appsEditorView');
    editorView.style.display = 'flex';
    editorView.classList.add('active');
    
    // 给容器添加编辑器模式 class
    document.querySelector('.apps-marketplace-container').classList.add('editor-mode');
    
    // 重置编辑器状态
    document.getElementById('codepenAppTitle').textContent = '✨ 创建应用';
    document.getElementById('codepenAppName').value = '';
    document.getElementById('codepenAppSlug').value = '';
    document.getElementById('codepenAppDesc').value = '';
    document.getElementById('codepenAppPublic').checked = true;
    document.getElementById('codepenHtmlEditor').value = '<div id="app">\n  <h1>Hello World</h1>\n</div>';
    document.getElementById('codepenCssEditor').value = '#app {\n  padding: 20px;\n  font-family: sans-serif;\n}\n\nh1 {\n  color: #333;\n}';
    document.getElementById('codepenJsEditor').value = 'console.log("App loaded");';
    document.getElementById('codepenDeleteBtn').style.display = 'none';
    document.getElementById('codepenLastSaved').textContent = '未保存';
    document.getElementById('codepenStatusMsg').textContent = '就绪';
    
    // 重置图标选择
    document.querySelectorAll('.codepen-icon-opt').forEach((opt, i) => {
        opt.classList.toggle('selected', i === 0);
    });
    
    // 清空编辑器 ID（新建模式）
    window._currentEditingAppId = null;
    
    // 自动预览
    previewCodepenApp();
    
    // 绑定自动预览（debounce 500ms）
    ['codepenHtmlEditor', 'codepenCssEditor', 'codepenJsEditor'].forEach(id => {
        const el = document.getElementById(id);
        el._debounceTimer && clearTimeout(el._debounceTimer);
        el.addEventListener('input', function() {
            this._debounceTimer = setTimeout(previewCodepenApp, 500);
        });
    });
    
    // 绑定名称 → slug 自动转换
    document.getElementById('codepenAppName').addEventListener('input', function() {
        const name = this.value;
        const slug = name.toLowerCase()
            .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 30);
        document.getElementById('codepenAppSlug').value = slug;
        document.getElementById('codepenSlugPreview').textContent = `/app/${slug || 'my-app'}`;
    });
    
    // 绑定图标选择
    document.querySelectorAll('.codepen-icon-opt').forEach(opt => {
        opt.addEventListener('click', function() {
            document.querySelectorAll('.codepen-icon-opt').forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
        });
    });
}

// 关闭应用编辑器
function closeAppEditor() {
    document.getElementById('appsListView').style.display = 'block';
    const editorView = document.getElementById('appsEditorView');
    editorView.style.display = 'none';
    editorView.classList.remove('active');
    // 移除编辑器模式 class
    document.querySelector('.apps-marketplace-container').classList.remove('editor-mode');
    window._currentEditingAppId = null;
    loadAppsMarketplace(); // 刷新列表
}

function openAppInMarketplace(slug) {
    const token = localStorage.getItem('dataOntologyToken');
    const url = token ? `/app/${slug}?token=${encodeURIComponent(token)}` : `/app/${slug}`;
    window.open(url, '_blank');
}

// 编辑应用（内联编辑器）
function editAppInMarketplace(appId) {
    // 切换视图
    document.getElementById('appsListView').style.display = 'none';
    const editorView = document.getElementById('appsEditorView');
    editorView.style.display = 'flex';
    editorView.classList.add('active');
    
    // 给容器添加编辑器模式 class
    document.querySelector('.apps-marketplace-container').classList.add('editor-mode');
    
    // 加载应用数据
    loadAppIntoEditor(appId);
}

// 删除应用
async function deleteAppInMarketplace(appId, title) {
    if (!confirm(`确定要删除应用「${title}」吗？此操作不可恢复。`)) return;
    
    try {
        const response = await fetchWithAuth(`/api/v1/apps/${appId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('删除失败');
        showToast('应用已删除', 'success');
        loadAppsMarketplace();
    } catch (e) {
        showToast('删除失败: ' + e.message, 'error');
    }
}

// ========== CodePen 风格编辑器核心函数 ==========

// 预览应用
function previewCodepenApp() {
    const html = document.getElementById('codepenHtmlEditor').value;
    const css = document.getElementById('codepenCssEditor').value;
    const js = document.getElementById('codepenJsEditor').value;
    
    const previewHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>${css}</style>
</head>
<body>
${html}
<script>${js}<\/script>
</body>
</html>`;
    
    const iframe = document.getElementById('codepenPreviewFrame');
    iframe.srcdoc = previewHtml;
    
    document.getElementById('codepenPreviewStatus').textContent = '已更新';
    setTimeout(() => {
        document.getElementById('codepenPreviewStatus').textContent = '';
    }, 1000);
}

// 保存应用
async function saveCodepenApp() {
    const name = document.getElementById('codepenAppName').value.trim();
    const slug = document.getElementById('codepenAppSlug').value.trim();
    const desc = document.getElementById('codepenAppDesc').value.trim();
    const isPublic = document.getElementById('codepenAppPublic').checked;
    const html = document.getElementById('codepenHtmlEditor').value;
    const css = document.getElementById('codepenCssEditor').value;
    const js = document.getElementById('codepenJsEditor').value;
    const iconEl = document.querySelector('.codepen-icon-opt.selected');
    const icon = iconEl ? iconEl.dataset.icon : '🎨';
    
    if (!name) {
        showToast('请输入应用名称', 'error');
        return;
    }
    if (!slug) {
        showToast('请输入应用 slug', 'error');
        return;
    }
    
    const appData = {
        title: name,
        slug: slug,
        description: desc,
        icon: icon,
        is_public: isPublic,
        html_content: html,
        css_content: css,
        js_content: js
    };
    
    try {
        document.getElementById('codepenStatusMsg').textContent = '保存中...';
        
        let response;
        if (window._currentEditingAppId) {
            // 更新现有应用
            response = await fetchWithAuth(`/api/v1/apps/${window._currentEditingAppId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(appData)
            });
        } else {
            // 创建新应用
            response = await fetchWithAuth('/api/v1/apps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(appData)
            });
        }
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || '保存失败');
        }
        
        const result = await response.json();
        window._currentEditingAppId = result.id || result.app_id;
        document.getElementById('codepenAppTitle').textContent = '✏️ 编辑应用';
        document.getElementById('codepenDeleteBtn').style.display = 'inline-block';
        
        const now = new Date().toLocaleTimeString();
        document.getElementById('codepenLastSaved').textContent = `已保存 ${now}`;
        document.getElementById('codepenStatusMsg').textContent = '保存成功';
        showToast('应用已保存', 'success');
        
    } catch (e) {
        document.getElementById('codepenStatusMsg').textContent = '保存失败';
        showToast('保存失败: ' + e.message, 'error');
    }
}

// 删除应用（编辑器内）
async function deleteCodepenApp() {
    if (!window._currentEditingAppId) return;
    
    const name = document.getElementById('codepenAppName').value;
    if (!confirm(`确定要删除应用「${name}」吗？此操作不可恢复。`)) return;
    
    try {
        const response = await fetchWithAuth(`/api/v1/apps/${window._currentEditingAppId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) throw new Error('删除失败');
        
        showToast('应用已删除', 'success');
        closeAppEditor();
        
    } catch (e) {
        showToast('删除失败: ' + e.message, 'error');
    }
}

// 加载应用到编辑器
async function loadAppIntoEditor(appId) {
    try {
        document.getElementById('codepenStatusMsg').textContent = '加载中...';
        
        const response = await fetchWithAuth(`/api/v1/apps/${appId}`);
        if (!response.ok) throw new Error('加载失败');
        
        const app = await response.json();
        
        // 填充表单
        document.getElementById('codepenAppTitle').textContent = '✏️ 编辑应用';
        document.getElementById('codepenAppName').value = app.title || '';
        document.getElementById('codepenAppSlug').value = app.slug || '';
        document.getElementById('codepenAppDesc').value = app.description || '';
        document.getElementById('codepenAppPublic').checked = app.is_public !== false;
        document.getElementById('codepenHtmlEditor').value = app.html_content || '';
        document.getElementById('codepenCssEditor').value = app.css_content || '';
        document.getElementById('codepenJsEditor').value = app.js_content || '';
        document.getElementById('codepenSlugPreview').textContent = `/app/${app.slug || 'my-app'}`;
        document.getElementById('codepenDeleteBtn').style.display = 'inline-block';
        document.getElementById('codepenLastSaved').textContent = '已加载';
        
        // 设置图标
        document.querySelectorAll('.codepen-icon-opt').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.icon === app.icon);
        });
        
        // 保存编辑器 ID
        window._currentEditingAppId = appId;
        
        // 自动预览
        previewCodepenApp();
        
        document.getElementById('codepenStatusMsg').textContent = '就绪';
        
    } catch (e) {
        document.getElementById('codepenStatusMsg').textContent = '加载失败';
        showToast('加载失败: ' + e.message, 'error');
    }
}

// 切换设置面板
function toggleAppSettings() {
    const panel = document.getElementById('codepenSettingsPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

// === 快捷提示模板逻辑 ===
(function initQuickPrompts() {
    // 点击气泡 → 填入输入框 → 自动发送
    document.addEventListener('click', (e) => {
        const bubble = e.target.closest('.ai-quick-prompt');
        if (!bubble) return;

        const prompt = bubble.dataset.prompt;
        if (!prompt) return;

        const input = document.getElementById('aiInput');
        if (input) {
            input.value = prompt;
            input.focus();
            input.style.height = 'auto';
            input.style.height = input.scrollHeight + 'px';
        }

        // 触发发送
        if (typeof handleSendAiMessage === 'function') {
            handleSendAiMessage();
        }
    });

    // 隐藏快捷提示
    window.hideQuickPrompts = function() {
        const qp = document.getElementById('aiQuickPrompts');
        if (qp) qp.classList.add('hidden');
    };

    // 显示快捷提示
    window.showQuickPrompts = function() {
        const qp = document.getElementById('aiQuickPrompts');
        if (qp) qp.classList.remove('hidden');
    };
})();


// 打开编辑 API 弹窗。
async function handleEditApi() {
    if (!currentApi) return;
    
    isEditApiMode = true;
    editingApiId = currentApi.id;
    document.getElementById('apiModalTitle').textContent = '编辑 API';
    document.getElementById('addApiModal').classList.add('show');
    
    // 执行SQL查询
    document.getElementById('apiNameInput').value = currentApi.name;
    document.getElementById('apiPathInput').value = currentApi.path;
    document.getElementById('apiMethodInput').value = currentApi.method;
    document.getElementById('apiDescInput').value = currentApi.description || '';
    
    // 恢复编辑模式时同步配置。
    const editType = currentApi.type || 'query';
    document.getElementById(editType === 'forward' ? 'apiTypeForward' : 'apiTypeQuery').checked = true;
    switchApiTypeFields(editType);
    
    if (editType === 'forward') {
        document.getElementById('apiForwardUrlInput').value = currentApi.forward_url || '';
    } else {
        document.getElementById('apiSqlInput').value = currentApi.sql || '';
    }
    
    // 切换API类型
    if (currentApi.default_params && Object.keys(currentApi.default_params).length > 0) {
        document.getElementById('apiDefaultParamsInput').value = JSON.stringify(currentApi.default_params, null, 2);
    } else {
        document.getElementById('apiDefaultParamsInput').value = '';
    }
    
    // 如果有结果，则把结果表附在消息下方。
    await loadDatabasesForSelect();
    document.getElementById('apiDbSelect').value = currentApi.database_id;
    
    document.getElementById('apiFormError').classList.remove('show');
    document.getElementById('apiFormSuccess').classList.remove('show');
}

// 删除当前 API。
async function handleDeleteApi() {
    if (!currentApi) return;

    if (!confirm(`确定删除 API “${currentApi.name}” 吗？此操作不可恢复。`)) {
        return;
    }

    const deleteBtn = document.getElementById('deleteApiBtn');
    const originalText = deleteBtn.textContent;
    deleteBtn.disabled = true;
    deleteBtn.textContent = '删除中...';

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/openapis/${currentApi.id}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            deleteBtn.disabled = false;
            deleteBtn.textContent = originalText;
            currentApi = null;
            document.getElementById('apiWelcomeView').style.display = 'flex';
            document.getElementById('apiDetailView').style.display = 'none';
            loadApis();
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

// 打开测试 API 弹窗。
function showTestApiModal() {
    if (!currentApi) return;
    
    document.getElementById('testApiModal').classList.add('show');
    document.getElementById('testApiPath').textContent = currentApi.path;
    document.getElementById('testApiMethod').textContent = currentApi.method;
    document.getElementById('testApiParams').value = '';
    document.getElementById('testApiError').classList.remove('show');
    document.getElementById('testApiResultGroup').style.display = 'none';
    
    // 勾选设置?
    const apiType = currentApi.type || 'query';
    if (apiType === 'forward') {
        // 显示API测试结果弹窗
        if (currentApi.default_params && Object.keys(currentApi.default_params).length > 0) {
            document.getElementById('testApiParams').value = JSON.stringify(currentApi.default_params, null, 2);
        }
    } else {
        // query类型 SQL 参数
        const params = parseMyBatisParams(currentApi.sql);
        if (params.length > 0) {
            const exampleParams = {};
            params.forEach(param => {
                if (currentApi.default_params && currentApi.default_params[param.name] !== undefined) {
                    exampleParams[param.name] = currentApi.default_params[param.name];
                } else {
                    exampleParams[param.name] = '';
                }
            });
            document.getElementById('testApiParams').value = JSON.stringify(exampleParams, null, 2);
        } else if (currentApi.default_params && Object.keys(currentApi.default_params).length > 0) {
            document.getElementById('testApiParams').value = JSON.stringify(currentApi.default_params, null, 2);
        }
    }
}

// 关闭测试 API 弹窗。
function hideTestApiModal() {
    document.getElementById('testApiModal').classList.remove('show');
}

// 执行 API 测试。
// 存储测试结果数据
let testResultData = null;

async function executeApiTest() {
    if (!currentApi) return;

    const paramsText = document.getElementById('testApiParams').value.trim();
    let params = {};

    // 搜索数据库
    if (paramsText) {
        try {
            params = JSON.parse(paramsText);
        } catch (error) {
            showTestApiError('测试参数必须是合法 JSON');
            return;
        }
    }

    const errorEl = document.getElementById('testApiError');
    const resultGroup = document.getElementById('testApiResultGroup');
    errorEl.classList.remove('show');
    resultGroup.style.display = 'none';

    const startTime = Date.now();

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/openapis/${currentApi.id}/test`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ params })
        });

        const endTime = Date.now();
        const duration = endTime - startTime;

        const data = await response.json();

        if (data.success) {
            // 保存结果数据
            testResultData = data.data;

            document.getElementById('testResultStatus').textContent = '成功';
            document.getElementById('testResultStatus').style.color = '#38a169';
            document.getElementById('testResultTime').textContent = duration;
            document.getElementById('testResultContent').textContent = JSON.stringify(data.data, null, 2);

            // 渲染表格视图
            renderTestResultTable(data.data);

            resultGroup.style.display = 'block';

            // 重置为 JSON 视图
            switchTestResultView('json');
        } else {
            showTestApiError(data.message || '测试失败');
        }
    } catch (error) {
        showTestApiError('测试失败：' + error.message);
    }
}

// 显示测试 API 错误。
function showTestApiError(message) {
    const errorEl = document.getElementById('testApiError');
    errorEl.textContent = message;
    errorEl.classList.add('show');
}

// 切换测试结果视图
function switchTestResultView(view) {
    const jsonView = document.getElementById('testResultJson');
    const tableView = document.getElementById('testResultTable');
    const buttons = document.querySelectorAll('.view-toggle-btn');

    buttons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.view === view) {
            btn.classList.add('active');
        }
    });

    if (view === 'json') {
        jsonView.style.display = 'block';
        tableView.style.display = 'none';
    } else {
        jsonView.style.display = 'none';
        tableView.style.display = 'block';
    }
}

// 渲染测试结果表格
function renderTestResultTable(data) {
    const container = document.getElementById('testResultTableContent');

    if (!data) {
        container.innerHTML = '<div class="table-empty">暂无数据</div>';
        return;
    }

    // 如果是数组
    if (Array.isArray(data)) {
        if (data.length === 0) {
            container.innerHTML = '<div class="table-empty">空数组</div>';
            return;
        }
        container.innerHTML = renderArrayTable(data);
    }
    // 如果是对象
    else if (typeof data === 'object') {
        container.innerHTML = renderObjectTable(data);
    }
    // 其他类型
    else {
        container.innerHTML = renderPrimitiveValue(data);
    }
}

// 渲染数组表格
function renderArrayTable(arr) {
    if (arr.length === 0) return '<div class="table-empty">空数组</div>';

    // 检查数组元素是否都是对象
    const isObjectArray = arr.every(item => typeof item === 'object' && item !== null && !Array.isArray(item));

    if (isObjectArray) {
        // 获取所有可能的键
        const allKeys = new Set();
        arr.forEach(item => {
            if (item && typeof item === 'object') {
                Object.keys(item).forEach(key => allKeys.add(key));
            }
        });
        const keys = Array.from(allKeys);

        let html = '<div class="table-wrapper"><table class="data-table">';
        html += '<thead><tr>';
        keys.forEach(key => {
            html += `<th>${escapeHtml(key)}</th>`;
        });
        html += '</tr></thead><tbody>';

        arr.forEach((item, index) => {
            html += `<tr class="${index % 2 === 0 ? 'even' : 'odd'}">`;
            keys.forEach(key => {
                const value = item && item[key];
                html += `<td>${renderCellValue(value)}</td>`;
            });
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    } else {
        // 简单数组
        let html = '<div class="table-wrapper"><table class="data-table">';
        html += '<thead><tr><th>索引</th><th>值</th></tr></thead><tbody>';

        arr.forEach((item, index) => {
            html += `<tr class="${index % 2 === 0 ? 'even' : 'odd'}">`;
            html += `<td>${index}</td>`;
            html += `<td>${renderCellValue(item)}</td>`;
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    }
}

// 渲染对象表格
function renderObjectTable(obj) {
    const keys = Object.keys(obj);

    if (keys.length === 0) {
        return '<div class="table-empty">空对象</div>';
    }

    let html = '<div class="table-wrapper"><table class="data-table">';
    html += '<thead><tr><th>键</th><th>值</th></tr></thead><tbody>';

    keys.forEach((key, index) => {
        html += `<tr class="${index % 2 === 0 ? 'even' : 'odd'}">`;
        html += `<td><strong>${escapeHtml(key)}</strong></td>`;
        html += `<td>${renderCellValue(obj[key])}</td>`;
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
}

// 渲染单元格值
function renderCellValue(value, depth = 0) {
    if (depth > 3) {
        return '<span class="value-deep">...</span>';
    }

    if (value === null) {
        return '<span class="value-null">null</span>';
    }

    if (value === undefined) {
        return '<span class="value-undefined">undefined</span>';
    }

    if (typeof value === 'boolean') {
        return `<span class="value-boolean">${value}</span>`;
    }

    if (typeof value === 'number') {
        return `<span class="value-number">${value}</span>`;
    }

    if (typeof value === 'string') {
        return `<span class="value-string">"${escapeHtml(value)}"</span>`;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return '<span class="value-array">[]</span>';
        }
        if (value.length <= 5 && depth < 2) {
            const items = value.map(item => renderCellValue(item, depth + 1)).join(', ');
            return `<span class="value-array">[${items}]</span>`;
        }
        return `<span class="value-array">Array(${value.length})</span>`;
    }

    if (typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 0) {
            return '<span class="value-object">{}</span>';
        }
        if (keys.length <= 3 && depth < 2) {
            const items = keys.map(key => {
                return `<span class="object-key">${escapeHtml(key)}</span>: ${renderCellValue(value[key], depth + 1)}`;
            }).join(', ');
            return `<span class="value-object">{${items}}</span>`;
        }
        return `<span class="value-object">Object{${keys.length} keys}</span>`;
    }

    return escapeHtml(String(value));
}

// 渲染原始值
function renderPrimitiveValue(value) {
    return `<div class="primitive-value">${renderCellValue(value)}</div>`;
}

// HTML 转义
function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== AI 配置 ====================

// 加载 AI 配置。
async function loadAiConfig() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/agent/config`);

        const data = await response.json();

        if (data.success && data.config) {
            aiConfig = data.config;
        }

        // 同时加载AI能力信息
        await loadAiCapabilities();
    } catch (error) {
        console.error('加载 AI 配置失败', error);
    }
}

// 打开 AI 设置弹窗。
async function showAiSettingsModal() {
    document.getElementById('aiSettingsModal').classList.add('show');

    if (aiConfig) {
        document.getElementById('aiUrlInput').value = aiConfig.url || '';
        document.getElementById('aiApiKeyInput').value = aiConfig.api_key || '';
        document.getElementById('aiModelInput').value = aiConfig.model || '';
        document.getElementById('aiTimeoutInput').value = aiConfig.timeout || '';

        // 加载能力设置
        if (aiConfig.enable_function_call !== undefined && aiConfig.enable_function_call !== null) {
            document.getElementById('aiEnableFunctionCall').checked = aiConfig.enable_function_call;
        }
        if (aiConfig.enable_thinking !== undefined && aiConfig.enable_thinking !== null) {
            document.getElementById('aiEnableThinking').checked = aiConfig.enable_thinking;
        }
        if (aiConfig.enable_streaming !== undefined && aiConfig.enable_streaming !== null) {
            document.getElementById('aiEnableStreaming').checked = aiConfig.enable_streaming;
        }
        if (aiConfig.enable_json_mode !== undefined && aiConfig.enable_json_mode !== null) {
            document.getElementById('aiEnableJSONMode').checked = aiConfig.enable_json_mode;
        }
        document.getElementById('aiContextWindow').value = aiConfig.context_window_override || 0;

        // 加载 Embedding 配置
        if (aiConfig.embedding) {
            document.getElementById('aiEmbEnabled').checked = aiConfig.embedding.enabled || false;
            document.getElementById('aiEmbUrl').value = aiConfig.embedding.url || '';
            document.getElementById('aiEmbApiKey').value = aiConfig.embedding.api_key || '';
            document.getElementById('aiEmbModel').value = aiConfig.embedding.model || '';
            document.getElementById('aiEmbDimension').value = aiConfig.embedding.dimension || 1024;
        }
    } else {
        document.getElementById('aiSettingsForm').reset();
    }

    // 加载 RAG 配置
    await loadTableRetrievalConfig();

    // 显示能力检测结果
    updateCapabilityHints();

    document.getElementById('aiSettingsError').classList.remove('show');
    document.getElementById('aiSettingsSuccess').classList.remove('show');
}

// 折叠/展开 LLM 配置
function toggleLlmConfig() {
    const panel = document.getElementById('llmConfigPanel');
    const toggle = document.getElementById('llmConfigToggle');
    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        toggle.textContent = '收起 ▲';
    } else {
        panel.style.display = 'none';
        toggle.textContent = '展开 ▼';
    }
}

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

// 折叠/展开 RAG 配置
function toggleRagConfig() {
    const panel = document.getElementById('ragConfigPanel');
    const toggle = document.getElementById('ragConfigToggle');
    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        toggle.textContent = '收起 ▲';
    } else {
        panel.style.display = 'none';
        toggle.textContent = '展开 ▼';
    }
}

// 关闭 AI 设置弹窗。
function hideAiSettingsModal() {
    document.getElementById('aiSettingsModal').classList.remove('show');
}

// 加载AI能力信息
async function loadAiCapabilities() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/agent/capabilities`);
        const data = await response.json();
        if (data.success && data.capabilities) {
            aiCapabilities = data.capabilities;
            console.log('AI模型能力:', aiCapabilities);
            return aiCapabilities;
        }
    } catch (error) {
        console.error('加载AI能力失败:', error);
    }
    return null;
}

// 显示AI能力信息（可选，用于调试或显示给用户）
function displayAiCapabilities() {
    if (!aiCapabilities) return;

    const capInfo = `
AI模型能力检测结果:
- Function Call支持: ${aiCapabilities.supports_function_call ? '✓' : '✗'}
- Thinking模式支持: ${aiCapabilities.supports_thinking ? '✓' : '✗'}
- 流式输出支持: ${aiCapabilities.supports_streaming ? '✓' : '✗'}
- JSON模式支持: ${aiCapabilities.supports_json_mode ? '✓' : '✗'}
- 上下文窗口: ${aiCapabilities.context_window} tokens
    `;
    console.log(capInfo);
}

// 更新能力提示信息
function updateCapabilityHints() {
    if (!aiCapabilities) {
        document.getElementById('functionCallHint').textContent = '未检测';
        document.getElementById('thinkingHint').textContent = '未检测';
        document.getElementById('streamingHint').textContent = '未检测';
        document.getElementById('jsonModeHint').textContent = '未检测';
        document.getElementById('contextWindowHint').textContent = '未检测';
        return;
    }
    
    const fcHint = document.getElementById('functionCallHint');
    fcHint.textContent = aiCapabilities.supports_function_call ? '✓ 支持' : '✗ 不支持';
    fcHint.className = 'capability-hint ' + (aiCapabilities.supports_function_call ? 'supported' : 'not-supported');
    
    const thinkHint = document.getElementById('thinkingHint');
    thinkHint.textContent = aiCapabilities.supports_thinking ? '✓ 支持' : '✗ 不支持';
    thinkHint.className = 'capability-hint ' + (aiCapabilities.supports_thinking ? 'supported' : 'not-supported');
    
    const streamHint = document.getElementById('streamingHint');
    streamHint.textContent = aiCapabilities.supports_streaming ? '✓ 支持' : '✗ 不支持';
    streamHint.className = 'capability-hint ' + (aiCapabilities.supports_streaming ? 'supported' : 'not-supported');
    
    const jsonHint = document.getElementById('jsonModeHint');
    jsonHint.textContent = aiCapabilities.supports_json_mode ? '✓ 支持' : '✗ 不支持';
    jsonHint.className = 'capability-hint ' + (aiCapabilities.supports_json_mode ? 'supported' : 'not-supported');
    
    const ctxHint = document.getElementById('contextWindowHint');
    ctxHint.textContent = `${aiCapabilities.context_window} tokens`;
    ctxHint.className = 'capability-hint supported';
}

// 自动检测模型能力
async function detectAiCapabilities() {
    const btn = document.getElementById('detectCapabilitiesBtn');
    btn.disabled = true;
    btn.textContent = '检测中...';
    
    try {
        // 先保存当前配置（触发后端检测）
        const timeoutValue = parseInt(document.getElementById('aiTimeoutInput').value, 10);
        const config = {
            url: document.getElementById('aiUrlInput').value,
            api_key: document.getElementById('aiApiKeyInput').value,
            model: document.getElementById('aiModelInput').value,
            timeout: Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : 120
        };
        
        const response = await fetchWithAuth(`${API_BASE}/api/v1/agent/config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });
        
        const data = await response.json();
        
        console.log('[AI能力检测] 返回数据:', data);
        console.log('[AI能力检测] capabilities:', data.capabilities);
        console.log('[AI能力检测] context_window:', data.capabilities?.context_window);
        
        if (data.success && data.capabilities) {
            aiCapabilities = data.capabilities;
            updateCapabilityHints();
            
            // 根据检测结果自动勾选
            document.getElementById('aiEnableFunctionCall').checked = aiCapabilities.supports_function_call;
            document.getElementById('aiEnableThinking').checked = aiCapabilities.supports_thinking;
            document.getElementById('aiEnableStreaming').checked = aiCapabilities.supports_streaming;
            document.getElementById('aiEnableJSONMode').checked = aiCapabilities.supports_json_mode;
            document.getElementById('aiContextWindow').value = aiCapabilities.context_window || 0;
            console.log('[AI能力检测] 设置输入框值为:', aiCapabilities.context_window || 0);
            
            btn.textContent = '检测完成';
            setTimeout(() => {
                btn.textContent = '自动检测模型能力';
                btn.disabled = false;
            }, 2000);
        } else {
            throw new Error(data.message || '检测失败');
        }
    } catch (error) {
        console.error('检测模型能力失败:', error);
        btn.textContent = '检测失败';
        setTimeout(() => {
            btn.textContent = '自动检测模型能力';
            btn.disabled = false;
        }, 2000);
    }
}

// ========== 标签页显示设置 ==========
const TAB_VISIBILITY_KEY = 'tabVisibilitySettings';
const ALL_TABS = [
    { id: 'database', name: '数据库管理' },
    { id: 'governance', name: '数据治理' },
    { id: 'ontology', name: '本体论抽象' },
    { id: 'lineage', name: '数据血缘' },
    { id: 'api', name: '接口分发' },
    { id: 'mcp', name: 'Agent服务' },
    { id: 'ai', name: '智能助手' },
    { id: 'models', name: '模型管理' },
    { id: 'quality', name: '数据质量审核' },
    { id: 'apps', name: '应用广场' }
];

// 默认标签页设置
const DEFAULT_TAB_VISIBILITY = {
    database: true,
    governance: true,
    api: true,
    ai: true,
    apps: true,
    ontology: false,
    lineage: false,
    mcp: false,
    models: false,
    quality: false
};

const DEFAULT_TAB_ORDER = ['database', 'governance', 'api', 'ai', 'apps', 'ontology', 'lineage', 'mcp', 'models', 'quality'];

// 当前标签页设置状态（用于设置弹窗）
let currentTabOrder = [...DEFAULT_TAB_ORDER];
let currentTabNames = {};
let currentTabVisibility = {...DEFAULT_TAB_VISIBILITY};

// 打开设置弹窗。
async function showSettingsModal() {
    document.getElementById('settingsModal').classList.add('show');
    await loadTabSettings();
    // 管理员才显示数据管理区域
    const dataSection = document.getElementById('dataManagementSection');
    if (dataSection) {
        dataSection.style.display = currentUser === 'admin' ? 'block' : 'none';
    }
}

// 关闭设置弹窗。
function hideSettingsModal() {
    document.getElementById('settingsModal').classList.remove('show');
}

// 加载标签页设置。
async function loadTabSettings() {
    const container = document.getElementById('tabVisibilitySettings');
    if (!container) return;

    // 从后端 API 读取设置
    let settings = null;
    try {
        const userSettings = await loadUserSettings();
        if (userSettings) {
            // 合并默认值
            currentTabVisibility = {...DEFAULT_TAB_VISIBILITY, ...(userSettings.tabVisibility || {})};
            currentTabOrder = userSettings.tabOrder ? [...userSettings.tabOrder] : [...DEFAULT_TAB_ORDER];
            currentTabNames = userSettings.tabNames ? {...userSettings.tabNames} : {};
            // 确保 currentTabOrder 包含所有标签页
            ALL_TABS.forEach(t => {
                if (!currentTabOrder.includes(t.id)) {
                    currentTabOrder.push(t.id);
                }
            });
            settings = currentTabVisibility;
        }
    } catch (e) {
        console.error('加载标签页设置失败', e);
    }

    if (!settings) {
        currentTabVisibility = {...DEFAULT_TAB_VISIBILITY};
        currentTabOrder = [...DEFAULT_TAB_ORDER];
        currentTabNames = {};
        settings = currentTabVisibility;
    }

    // 动态生成标签页设置行
    renderTabSettingsUI(container, settings);
}

// 保存标签页设置
function saveTabSettings() {
    // 从设置弹窗中收集当前状态
    collectTabSettingsFromUI();

    let visibleCount = 0;
    for (const key in currentTabVisibility) {
        if (currentTabVisibility[key]) visibleCount++;
    }

    if (visibleCount < 1) {
        showToast('至少需要显示一个标签页', 'warning');
        return false;
    }

    // 应用嵌入模式设置
    const embedModeToggle = document.getElementById('embedModeToggle');
    const embedMode = embedModeToggle ? embedModeToggle.checked : false;
    applyEmbedMode(embedMode);

    // 保存到后端
    (async () => {
        const userSettings = await loadUserSettings();
        userSettings.embedMode = embedMode;
        userSettings.tabVisibility = currentTabVisibility;
        userSettings.tabOrder = currentTabOrder;
        userSettings.tabNames = currentTabNames;
        await saveUserSettings(userSettings);
    })();

    try {
        applyTabVisibility(currentTabVisibility, currentTabOrder, currentTabNames);
        showToast('保存成功', 'success');
        hideSettingsModal();
        return true;
    } catch (e) {
        console.error('保存失败', e);
        showToast('保存失败', 'error');
        return false;
    }
}

// 重置标签页设置为默认值
function resetTabSettings() {
    currentTabVisibility = {...DEFAULT_TAB_VISIBILITY};
    currentTabOrder = [...DEFAULT_TAB_ORDER];
    currentTabNames = {};
    
    const container = document.getElementById('tabVisibilitySettings');
    if (container) {
        renderTabSettingsUI(container, currentTabVisibility);
    }
    
    // 更新嵌入模式复选框
    const embedModeToggle = document.getElementById('embedModeToggle');
    if (embedModeToggle) {
        embedModeToggle.checked = true; // 默认开启嵌入模式
    }
}

// ====== 数据管理：一键导入导出 ======

// 导出系统数据（管理员）
async function exportSystemData() {
    const statusEl = document.getElementById('dataManagementStatus');
    const btn = document.getElementById('exportDataBtn');
    try {
        btn.disabled = true;
        btn.textContent = '⏳ 导出中...';
        statusEl.textContent = '正在生成备份文件...';
        statusEl.style.color = '#a0aec0';

        const token = localStorage.getItem('token');
        const resp = await fetch('/api/v1/system/backup', {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({error: '导出失败'}));
            throw new Error(err.error || '导出失败');
        }

        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `datatoolbox-backup-${dateStr}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
        statusEl.textContent = `✅ 导出成功 (${sizeMB} MB)`;
        statusEl.style.color = '#48bb78';
        showToast('数据导出成功', 'success');
    } catch (e) {
        statusEl.textContent = '❌ ' + e.message;
        statusEl.style.color = '#fc8181';
        showToast('导出失败: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '📤 导出数据';
    }
}

// 导入系统数据（管理员）
async function importSystemData(input) {
    const file = input.files && input.files[0];
    if (!file) return;

    const mode = document.getElementById('importModeSelect').value;
    const statusEl = document.getElementById('dataManagementStatus');

    // 覆盖模式二次确认
    if (mode === 'overwrite') {
        if (!confirm('覆盖模式将替换所有现有数据，确定继续吗？')) {
            input.value = '';
            return;
        }
    }

    try {
        statusEl.textContent = '正在导入数据...';
        statusEl.style.color = '#a0aec0';

        const token = localStorage.getItem('token');
        const formData = new FormData();
        formData.append('backup', file);
        formData.append('mode', mode);

        const resp = await fetch('/api/v1/system/restore-upload', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: formData
        });

        const result = await resp.json();
        if (!resp.ok || result.error) {
            throw new Error(result.error || result.message || '导入失败');
        }

        const data = result.data || result;
        let msg = '✅ 导入成功';
        if (data.db_bytes) msg += ` (数据库 ${Math.round(data.db_bytes/1024)}KB)`;
        if (data.users_count !== undefined) msg += ` — ${data.users_count} 用户, ${data.databases_count} 数据库, ${data.apis_count} 接口`;
        if (data.files_restored) msg += `, ${data.files_restored} 文件`;

        statusEl.textContent = msg;
        statusEl.style.color = '#48bb78';
        showToast('数据导入成功，即将刷新页面', 'success');

        // 导入成功后刷新页面加载新数据
        setTimeout(() => location.reload(), 2000);
    } catch (e) {
        statusEl.textContent = '❌ ' + e.message;
        statusEl.style.color = '#fc8181';
        showToast('导入失败: ' + e.message, 'error');
    } finally {
        input.value = '';
    }
}

// 发送AI消息?
function applyEmbedMode(enabled) {
    const embedSettingsBtn = document.getElementById('embedSettingsBtn');
    if (enabled) {
        document.body.classList.add('embed-mode');
        if (embedSettingsBtn) embedSettingsBtn.style.display = 'block';
    } else {
        document.body.classList.remove('embed-mode');
        if (embedSettingsBtn) embedSettingsBtn.style.display = 'none';
    }
}

// 获取用户设置
async function loadUserSettings() {
    try {
        const resp = await fetchWithAuth(API_BASE + '/api/v1/system/settings');
        const data = await resp.json();
        if (data.success && data.settings) {
            return data.settings;
        }
    } catch (e) {
        console.error('加载用户设置失败', e);
    }
    return {};
}

// 加载用户设置成功
async function saveUserSettings(settings) {
    try {
        const resp = await fetchWithAuth(API_BASE + '/api/v1/system/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        const data = await resp.json();
        return data.success;
    } catch (e) {
        console.error('保存用户设置失败', e);
        return false;
    }
}

// 初始化嵌入模式
async function initEmbedMode() {
    const settings = await loadUserSettings();
    const embedMode = settings.embedMode !== false; // 默认开启嵌入模式
    const embedModeToggle = document.getElementById('embedModeToggle');
    if (embedModeToggle) {
        embedModeToggle.checked = embedMode;
    }
    applyEmbedMode(embedMode);
    
    // 应用标签页设置
    const tabVisibility = settings.tabVisibility || DEFAULT_TAB_VISIBILITY;
    const tabOrder = settings.tabOrder || DEFAULT_TAB_ORDER;
    const tabNames = settings.tabNames || {};
    
    // 更新当前状态
    currentTabVisibility = {...DEFAULT_TAB_VISIBILITY, ...tabVisibility};
    currentTabOrder = [...tabOrder];
    currentTabNames = {...tabNames};
    
    // 确保 currentTabOrder 包含所有标签页
    ALL_TABS.forEach(t => {
        if (!currentTabOrder.includes(t.id)) {
            currentTabOrder.push(t.id);
        }
    });
    
    applyTabVisibilityWithSettings(currentTabVisibility, currentTabOrder, currentTabNames);
    
    // 绑定嵌入模式设置按钮
    const embedSettingsBtn = document.getElementById('embedSettingsBtn');
    if (embedSettingsBtn) {
        embedSettingsBtn.addEventListener('click', showSettingsModal);
    }
}

// 应用标签页可见性
function applyTabVisibility(settings, tabOrder, tabNames) {
    if (!settings) {
        // 如果没有设置，从后端加载
        (async () => {
            const userSettings = await loadUserSettings();
            const vis = userSettings.tabVisibility || DEFAULT_TAB_VISIBILITY;
            const order = userSettings.tabOrder || DEFAULT_TAB_ORDER;
            const names = userSettings.tabNames || {};
            applyTabVisibilityWithSettings(vis, order, names);
        })();
        return;
    }
    applyTabVisibilityWithSettings(settings, tabOrder || DEFAULT_TAB_ORDER, tabNames || {});
}

// 实际应用标签页设置
function applyTabVisibilityWithSettings(settings, tabOrder, tabNames) {
    const tabsContainer = document.querySelector('.nav-tabs');
    if (!tabsContainer) return;

    const tabs = document.querySelectorAll('.nav-tab');
    const tabArray = Array.from(tabs);

    // 按 tabOrder 排序标签页
    tabArray.sort((a, b) => {
        const aIndex = tabOrder.indexOf(a.dataset.tab);
        const bIndex = tabOrder.indexOf(b.dataset.tab);
        return aIndex - bIndex;
    });

    // 重新排列标签页DOM
    tabArray.forEach(tab => tabsContainer.appendChild(tab));

    // 应用可见性和名称
    tabs.forEach(tab => {
        const tabId = tab.dataset.tab;
        
        // 设置可见性
        if (settings.hasOwnProperty(tabId)) {
            tab.style.display = settings[tabId] ? '' : 'none';
        } else {
            tab.style.display = DEFAULT_TAB_VISIBILITY[tabId] ? '' : 'none';
        }

        // 设置名称
        const tabInfo = ALL_TABS.find(t => t.id === tabId);
        const customName = tabNames && tabNames[tabId];
        tab.textContent = customName || (tabInfo ? tabInfo.name : tabId);
    });

    // 如果当前活动标签页被隐藏，切换到第一个可见标签页
    const activeTab = document.querySelector('.nav-tab.active');
    if (activeTab) {
        const activeTabId = activeTab.dataset.tab;
        if (settings[activeTabId] === false) {
            const firstVisibleTab = document.querySelector('.nav-tab:not([style*="display: none"])');
            if (firstVisibleTab) {
                switchTab(firstVisibleTab.dataset.tab);
            }
        }
    }
}

// 渲染标签页设置UI
function renderTabSettingsUI(container, settings) {
    container.innerHTML = '';
    
    currentTabOrder.forEach((tabId, index) => {
        const tabInfo = ALL_TABS.find(t => t.id === tabId);
        if (!tabInfo) return;

        const row = document.createElement('div');
        row.className = 'tab-setting-row';
        row.dataset.tabId = tabId;
        row.draggable = true;

        const isVisible = settings[tabId] !== false;
        const customName = currentTabNames[tabId] || '';
        const displayName = customName || tabInfo.name;

        row.innerHTML = `
            <input type="checkbox" data-tab="${tabId}" ${isVisible ? 'checked' : ''}>
            <span class="tab-name-text" data-tab="${tabId}" title="双击编辑名称">${escapeHtml(displayName)}</span>
            <input type="text" class="tab-name-input hidden" data-tab="${tabId}" 
                   placeholder="${tabInfo.name}" value="${escapeHtml(customName)}">
        `;

        // 勾选事件
        const checkbox = row.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', () => {
            currentTabVisibility[tabId] = checkbox.checked;
        });

        // 双击编辑名称
        const nameText = row.querySelector('.tab-name-text');
        const nameInput = row.querySelector('.tab-name-input');
        
        nameText.addEventListener('dblclick', () => {
            nameText.classList.add('hidden');
            nameInput.classList.remove('hidden');
            nameInput.focus();
            nameInput.select();
        });

        nameInput.addEventListener('blur', () => {
            saveTabName(tabId, nameInput, nameText, tabInfo.name);
        });

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                nameInput.blur();
            } else if (e.key === 'Escape') {
                nameInput.value = currentTabNames[tabId] || '';
                nameInput.blur();
            }
        });

        // 拖拽排序
        row.addEventListener('dragstart', (e) => {
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tabId);
        });

        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            document.querySelectorAll('.tab-setting-row.drag-over').forEach(el => {
                el.classList.remove('drag-over');
            });
        });

        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const draggingRow = document.querySelector('.tab-setting-row.dragging');
            if (draggingRow && draggingRow !== row) {
                row.classList.add('drag-over');
            }
        });

        row.addEventListener('dragleave', () => {
            row.classList.remove('drag-over');
        });

        row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('drag-over');
            
            const dragTabId = e.dataTransfer.getData('text/plain');
            if (dragTabId === tabId) return;
            
            const dragIndex = currentTabOrder.indexOf(dragTabId);
            const dropIndex = currentTabOrder.indexOf(tabId);
            
            if (dragIndex === -1 || dropIndex === -1) return;
            
            // 移动元素
            const [removed] = currentTabOrder.splice(dragIndex, 1);
            currentTabOrder.splice(dropIndex, 0, removed);

            // 保存到后端
            (async () => {
                const userSettings = await loadUserSettings();
                userSettings.tabOrder = currentTabOrder;
                await saveUserSettings(userSettings);
            })();

            // 重新渲染
            renderTabSettingsUI(container, currentTabVisibility);
        });

        container.appendChild(row);
    });
}

function saveTabName(tabId, input, textSpan, defaultName) {
    const value = input.value.trim();
    if (value) {
        currentTabNames[tabId] = value;
        textSpan.textContent = value;
    } else {
        delete currentTabNames[tabId];
        textSpan.textContent = defaultName;
    }
    input.classList.add('hidden');
    textSpan.classList.remove('hidden');
}

// 从UI收集标签页设置
function collectTabSettingsFromUI() {
    const container = document.getElementById('tabVisibilitySettings');
    if (!container) return;

    const rows = container.querySelectorAll('.tab-setting-row');
    rows.forEach(row => {
        const tabId = row.dataset.tabId;
        const checkbox = row.querySelector('input[type="checkbox"]');
        const nameInput = row.querySelector('.tab-name-input');

        currentTabVisibility[tabId] = checkbox ? checkbox.checked : true;
        
        if (nameInput && nameInput.value.trim()) {
            currentTabNames[tabId] = nameInput.value.trim();
        } else {
            delete currentTabNames[tabId];
        }
    });
}

// 保存AI配置
async function handleSaveAiSettings(e) {
    e.preventDefault();

    const timeoutValue = parseInt(document.getElementById('aiTimeoutInput').value, 10);
    const contextWindowValue = parseInt(document.getElementById('aiContextWindow').value, 10);
    const embDimensionValue = parseInt(document.getElementById('aiEmbDimension').value, 10);

    const config = {
        url: document.getElementById('aiUrlInput').value,
        api_key: document.getElementById('aiApiKeyInput').value,
        model: document.getElementById('aiModelInput').value,
        timeout: Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : 120,
        // 能力设置
        enable_function_call: document.getElementById('aiEnableFunctionCall').checked,
        enable_thinking: document.getElementById('aiEnableThinking').checked,
        enable_streaming: document.getElementById('aiEnableStreaming').checked,
        enable_json_mode: document.getElementById('aiEnableJSONMode').checked,
        context_window_override: Number.isFinite(contextWindowValue) && contextWindowValue > 0 ? contextWindowValue : 0,
        // Embedding 配置
        embedding: {
            enabled: document.getElementById('aiEmbEnabled').checked,
            url: document.getElementById('aiEmbUrl').value,
            api_key: document.getElementById('aiEmbApiKey').value,
            model: document.getElementById('aiEmbModel').value,
            dimension: Number.isFinite(embDimensionValue) && embDimensionValue > 0 ? embDimensionValue : 1024
        }
    };

    // 收集 RAG 配置
    const trConfig = {
        strategy: document.getElementById('trStrategy').value,
        max_tables: parseInt(document.getElementById('trMaxTables').value, 10) || 15,
        keyword_weight: parseFloat(document.getElementById('trKeywordWeight').value) || 0.4,
        vector_weight: parseFloat(document.getElementById('trVectorWeight').value) || 0.3,
        graph_weight: parseFloat(document.getElementById('trGraphWeight').value) || 0.3,
        graph_config: {
            max_depth: parseInt(document.getElementById('trGraphDepth').value, 10) || 2
        }
    };

    const errorEl = document.getElementById('aiSettingsError');
    const successEl = document.getElementById('aiSettingsSuccess');
    errorEl.classList.remove('show');
    successEl.classList.remove('show');

    try {
        // 保存 AI 配置
        const aiResponse = await fetchWithAuth(`${API_BASE}/api/v1/agent/config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });

        const aiData = await aiResponse.json();

        if (!aiData.success) {
            errorEl.textContent = aiData.message || 'AI 配置保存失败';
            errorEl.classList.add('show');
            return;
        }

        // 保存 RAG 配置
        const trResponse = await fetchWithAuth(`${API_BASE}/api/v1/agent/table-retrieval-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trConfig)
        });

        const trData = await trResponse.json();

        if (trData.success) {
            aiConfig = config;
            tableRetrievalConfig = trConfig;
            // 保存能力检测结果
            if (aiData.capabilities) {
                aiCapabilities = aiData.capabilities;
                console.log('AI模型能力检测完成:', aiCapabilities);
            }
            successEl.textContent = '设置已保存';
            successEl.classList.add('show');
            setTimeout(() => {
                hideAiSettingsModal();
            }, 1000);
        } else {
            errorEl.textContent = trData.message || 'RAG 配置保存失败';
            errorEl.classList.add('show');
        }
    } catch (error) {
        errorEl.textContent = '保存失败：' + error.message;
        errorEl.classList.add('show');
    }
}

// 处理 AI 输入框内容变化。
function handleAiInputChange(e) {
    const input = e.target;
    const value = input.value;
    const cursorPos = input.selectionStart;
    
    // 显示进度
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    
    // 检测 @ 提示触发词。
    const textBeforeCursor = value.substring(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\S*)$/);
    
    if (atMatch) {
        const searchTerm = atMatch[1].toLowerCase();
        showDbSuggestions(searchTerm);
    } else {
        hideDbSuggestions();
    }
}

// AI模块 → 标签页 映射关系（模块只在对应标签页可见时才在@联想中显示）
const AI_MODULE_TAB_MAP = {
    'db-manage': 'database',
    'api-dispatch': 'api',
    'data-governance': 'governance',
    'quality-audit': 'quality',
    'ontology': 'ontology',
    'small-model': 'models'
};

// 显示 @ 联想建议。
function showDbSuggestions(searchTerm) {
    const matchedModules = aiModules.filter(m => {
        // 过滤掉对应标签页不可见的模块
        const tabId = AI_MODULE_TAB_MAP[m.id];
        if (tabId && currentTabVisibility[tabId] === false) return false;
        return m.name.toLowerCase().includes(searchTerm) ||
            m.id.toLowerCase().includes(searchTerm) ||
            (m.aliases && m.aliases.some(a => a.toLowerCase().includes(searchTerm)));
    });
    const matchedDbs = databases.filter(db =>
        db.name.toLowerCase().includes(searchTerm)
    );

    if (matchedModules.length === 0 && matchedDbs.length === 0) {
        hideDbSuggestions();
        return;
    }

    const suggestionsEl = document.getElementById('aiDbSuggestions');
    let html = '';

    if (matchedModules.length > 0) {
        html += '<div class="ai-suggestion-group-title">智能助手</div>';
        html += matchedModules.map(m => {
            const safeMId = escapeHtml(m.id);
            const safeMName = escapeHtml(m.name);
            const safeMDesc = escapeHtml(m.description);
            return `
            <div class="ai-db-suggestion ai-module-suggestion"
                 onclick="selectSuggestion('module','${safeMId}')"
                 data-type="module" data-id="${safeMId}">
                <span class="ai-db-suggestion-icon">${m.icon}</span>
                <span class="ai-db-suggestion-name">${safeMName}</span>
                <span class="ai-db-suggestion-info">${safeMDesc}</span>
            </div>
        `}).join('');
    }

    if (matchedDbs.length > 0) {
        html += '<div class="ai-suggestion-group-title">数据库</div>';
        html += matchedDbs.map(db => {
            const typeIcon = dbTypeIcons[db.type] || '🗃️';
            const isFileDb = dbTypeDefaults[db.type]?.isFile;
            const info = isFileDb ? (db.path || '未配置路径') : (db.host && db.port ? `${db.host}:${db.port}` : (db.host || '未配置连接'));
            const safeDbId = escapeHtml(db.id);
            const safeDbName = escapeHtml(db.name);
            const safeInfo = escapeHtml(info);
            return `
                <div class="ai-db-suggestion"
                     onclick="selectSuggestion('db','${safeDbId}')"
                     data-type="db" data-id="${safeDbId}">
                    <span class="ai-db-suggestion-icon">${typeIcon}</span>
                    <span class="ai-db-suggestion-name">${safeDbName}</span>
                    <span class="ai-db-suggestion-info">${safeInfo}</span>
                </div>
            `;
        }).join('');
    }

    suggestionsEl.innerHTML = html;
    suggestionsEl.style.display = 'block';
    dbSuggestionIndex = -1;
}

// 加载治理任务
function hideDbSuggestions() {
    document.getElementById('aiDbSuggestions').style.display = 'none';
    dbSuggestionIndex = -1;
}

// 过滤数据库建议列表
function selectSuggestion(type, id) {
    let name = '';
    if (type === 'module') {
        const m = aiModules.find(m => m.id === id);
        if (!m) return;
        name = m.name;
    } else {
        const db = databases.find(d => d.id === id);
        if (!db) return;
        name = db.name;
    }

    const input = document.getElementById('aiInput');
    const value = input.value;
    const cursorPos = input.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex !== -1) {
        const newValue = value.substring(0, atIndex) + `@${name} ` + value.substring(cursorPos);
        input.value = newValue;
        input.selectionStart = input.selectionEnd = atIndex + name.length + 2;
        input.focus();
    }

    hideDbSuggestions();
}

// 选择数据库
function selectDbSuggestion(dbId) {
    selectSuggestion('db', dbId);
}

// AI输入框键盘事件
function handleAiInputKeydown(e) {
    const suggestionsEl = document.getElementById('aiDbSuggestions');

    if (e.isComposing) return; // 中文输入法 composing 中，回车是确认输入不是发送

    if (suggestionsEl.style.display === 'block') {
        const items = suggestionsEl.querySelectorAll('.ai-db-suggestion');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            dbSuggestionIndex = Math.min(dbSuggestionIndex + 1, items.length - 1);
            updateSuggestionHighlight(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            dbSuggestionIndex = Math.max(dbSuggestionIndex - 1, -1);
            updateSuggestionHighlight(items);
        } else if (e.key === 'Enter' && dbSuggestionIndex >= 0) {
            e.preventDefault();
            const item = items[dbSuggestionIndex];
            selectSuggestion(item.dataset.type, item.dataset.id);
        } else if (e.key === 'Escape') {
            hideDbSuggestions();
        }
    } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendAiMessage();
    }
}

// 更新联想建议高亮。
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

// 发送 AI 消息。
async function handleSendAiMessage() {
    const input = document.getElementById('aiInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    // 检查 AI 配置是否完整
    if (!aiConfig || !aiConfig.url || !aiConfig.api_key || !aiConfig.model) {
        showAiError('请先完成 AI 配置');
        return;
    }
    
    // 如果没有当前会话，自动创建一个
    if (!currentSessionId || !getCurrentSession()) {
        await createNewSession();
    }
    
    // 提取消息中的 @ 引用
    const allMatches = [...message.matchAll(/@([^\s]+)/g)];
    const dbRefs = [];
    const modRefs = [];
    for (const match of allMatches) {
        const ref = match[1];
        const refL = ref.toLowerCase();
        let mod = aiModules.find(m => m.name === ref || m.name.toLowerCase() === refL || m.id === ref);
        if (mod) { modRefs.push(mod); continue; }
        let db = databases.find(d => d.name === ref || d.name.toLowerCase() === refL || d.id === ref);
        if (db) dbRefs.push(db);
    }
    if (modRefs.length > 0) aiSessionContext.modules = modRefs;
    if (dbRefs.length > 0) aiSessionContext.databases = dbRefs;
    else if (aiSessionContext.databases.length > 0) dbRefs.push(...aiSessionContext.databases);

    // 记录用户消息
    aiSessionContext.history.push({
        role: 'user',
        content: message,
        databases: dbRefs.map(db => db.id),
        modules: aiSessionContext.modules.map(m => m.id)
    });

    addAiMessage('user', message);
    saveCurrentSessionMessage('user', message);
    input.value = '';
    input.style.height = 'auto';
    document.getElementById('aiSendBtn').disabled = true;

    // 隐藏快捷提示气泡
    if (typeof hideQuickPrompts === 'function') hideQuickPrompts();

    // 统一走集群模式
    await sendClusterQuery(message, dbRefs.map(d => d.id), aiSessionContext.modules.map(m => m.id));

    document.getElementById('aiSendBtn').disabled = false;
}

// 生成用户头像 SVG
function getUserAvatarSvg() {
    return `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="url(#userGrad)"/>
        <circle cx="16" cy="12" r="5" fill="white"/>
        <path d="M8 26c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="white"/>
        <defs>
            <linearGradient id="userGrad" x1="0" y1="0" x2="32" y2="32">
                <stop offset="0%" stop-color="#667eea"/>
                <stop offset="100%" stop-color="#764ba2"/>
            </linearGradient>
        </defs>
    </svg>`;
}

// 生成 AI 助手头像 SVG
function getAiAvatarSvg() {
    return `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="url(#aiGrad)"/>
        <rect x="10" y="10" width="12" height="10" rx="2" fill="white"/>
        <circle cx="13" cy="14" r="1.5" fill="#6366f1"/>
        <circle cx="19" cy="14" r="1.5" fill="#6366f1"/>
        <path d="M13 17h6" stroke="#6366f1" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M16 8v2M12 9l1 1.5M20 9l-1 1.5" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
        <defs>
            <linearGradient id="aiGrad" x1="0" y1="0" x2="32" y2="32">
                <stop offset="0%" stop-color="#6366f1"/>
                <stop offset="100%" stop-color="#8b5cf6"/>
            </linearGradient>
        </defs>
    </svg>`;
}

// 添加 AI 消息。
function addAiMessage(role, content) {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-' + Date.now();
    
    // 处理AI流式响应
    const welcomeMsg = messagesEl.querySelector('.ai-welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }
    
    const avatar = role === 'user' ? getUserAvatarSvg() : getAiAvatarSvg();
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    
    // 保留 HTML 片段并对普通文本做转义。
    let displayContent = content;
    
    // 如果消息里包含 HTML，只处理前缀文本中的 @ 引用。
    if (content.includes('<div')) {
        // 先转义前缀文本。
        const parts = content.split('<div');
        displayContent = escapeHtml(parts[0]);
        
        // 高亮 @ 数据库引用。
        const dbMatches = [...parts[0].matchAll(/@([^\s]+)/g)];
        for (const match of dbMatches) {
            const dbName = match[1];
            displayContent = displayContent.replace(
                new RegExp(escapeHtml(`@${dbName}`), 'g'),
                `<span class="ai-db-reference">@${dbName}</span>`
            );
        }
        
        // 拼回原始 HTML 后半段。
        if (parts.length > 1) {
            displayContent += '<div' + parts.slice(1).join('<div');
        }
    } else if (role === 'assistant') {
        // 助手回复用 markdown 渲染
        displayContent = formatClusterMarkdown(content);
    } else {
        // 用户消息全部转义后再处理引用。
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

// 添加 AI 加载消息。
function addAiLoadingMessage() {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-loading-' + Date.now();
    
    const messageHtml = `
        <div class="ai-message assistant" id="${messageId}">
            <div class="ai-message-avatar">${getAiAvatarSvg()}</div>
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

// 移除 AI 消息。
function removeAiMessage(messageId) {
    const messageEl = document.getElementById(messageId);
    if (messageEl) {
        messageEl.remove();
    }
}

// 显示 AI 错误消息。
function showAiError(message) {
    const messagesEl = document.getElementById('aiChatMessages');
    const messageId = 'msg-error-' + Date.now();
    
    const messageHtml = `
        <div class="ai-message assistant" id="${messageId}">
            <div class="ai-message-avatar">${getAiAvatarSvg()}</div>
            <div class="ai-message-content">
                <div class="ai-error">${escapeHtml(message)}</div>
            </div>
        </div>
    `;
    
    messagesEl.insertAdjacentHTML('beforeend', messageHtml);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// HTML 转义。
function escapeHtml(text) {
    if (text == null) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Render gov.showTable() output as HTML table
function renderGovOutput(text) {
    if (typeof text !== 'string') return escapeHtml(String(text));

    // 先将字面量 \n 转换为真正的换行符
    text = text.replace(/\\n/g, '\n');

    const prefix = '__TABLE__:';
    const tryRender = function (jsonStr) {
        try {
            const data = JSON.parse(jsonStr);
            if (!Array.isArray(data) || data.length === 0) {
                return '<div class="gov-table-empty">暂无数据</div>';
            }
            const keys = [...new Set(data.flatMap(obj => Object.keys(obj)))];
            let html = '<div class="gov-table-wrapper"><table class="gov-table"><thead><tr>';
            keys.forEach(key => {
                html += `<th>${escapeHtml(key)}</th>`;
            });
            html += '</tr></thead><tbody>';
            data.forEach(row => {
                html += '<tr>';
                keys.forEach(key => {
                    const val = row[key];
                    html += `<td>${val !== undefined && val !== null ? escapeHtml(String(val)) : ''}</td>`;
                });
                html += '</tr>';
            });
            html += '</tbody></table></div>';
            return html;
        } catch (e) {
            return escapeHtml(prefix + jsonStr);
        }
    };

    // 处理多行文本，逐行检查是否有 __TABLE__: 标记
    const lines = text.split('\n');
    const result = lines.map(line => {
        if (line.startsWith(prefix)) {
            return tryRender(line.substring(prefix.length));
        }
        if (line.startsWith('__TABLE_ROWS__:')) {
            return tryRender(line.substring('__TABLE_ROWS__'.length));
        }
        return escapeHtml(line);
    });
    return result.join('<br>');
}

function formatAIText(text) {
    if (!text) return '';
    // 处理 <think>...</think> 标签：提取思考内容到折叠块，正文继续正常显示
    // 支持流式输出时未闭合的 <think> 标签（只有开头没有结尾）
    let thinkContent = '';
    let mainContent = text;

    // 匹配闭合的 <think>...</think>
    const closedThinkRegex = /<think>([\s\S]*?)<\/think>/g;
    let match;
    while ((match = closedThinkRegex.exec(text)) !== null) {
        thinkContent += match[1];
    }

    // 匹配未闭合的 <think>...（流式输出中）
    const openThinkRegex = /<think>([\s\S]*)$/;
    const openMatch = openThinkRegex.exec(text.replace(closedThinkRegex, ''));
    if (openMatch) {
        thinkContent += openMatch[1];
    }

    // 移除所有 think 标签及内容，得到正文
    mainContent = text.replace(closedThinkRegex, '').replace(/<think>[\s\S]*$/, '').trim();

    let result = '';
    // 渲染思考过程为折叠块
    if (thinkContent.trim()) {
        const escapedThink = escapeHtml(thinkContent.trim()).replace(/\n/g, '<br>');
        result += `<details class="ai-think-block"><summary class="ai-think-summary">💭 思考过程</summary><div class="ai-think-content">${escapedThink}</div></details>`;
    }
    // 渲染正文
    if (mainContent.trim()) {
        let escaped = escapeHtml(mainContent).trim();
        escaped = escaped.replace(/\n{2,}/g, '\n');
        escaped = escaped.replace(/\n/g, '<br>');
        result += escaped;
    }
    return result;
}

// 更新AI上下文显示
function updateAiContextDisplay() {
    const header = document.querySelector('#aiTab .ai-chat-header');
    if (!header) return;

    let contextEl = document.getElementById('aiContextDisplay');
    const input = document.getElementById('aiInput');
    const hasDbs = aiSessionContext.databases.length > 0;
    const hasMods = aiSessionContext.modules.length > 0;

    if (hasDbs || hasMods) {
        if (!contextEl) {
            contextEl = document.createElement('div');
            contextEl.id = 'aiContextDisplay';
            contextEl.className = 'ai-context-display';
            const h3 = header.querySelector('h3');
            h3.parentNode.insertBefore(contextEl, h3.nextSibling);
        }

        let tagsHtml = '';
        if (hasMods) {
            tagsHtml += aiSessionContext.modules.map(m =>
                `<span class="ai-context-tag ai-context-tag-module">${m.icon} ${escapeHtml(m.name)}</span>`
            ).join('');
        }
        if (hasDbs) {
            tagsHtml += aiSessionContext.databases.map(db => {
                const icon = dbTypeIcons[db.type] || '🗃️';
                return `<span class="ai-context-tag ai-context-tag-db">${icon} ${escapeHtml(db.name)}</span>`;
            }).join('');
        }

        contextEl.innerHTML = `
            <div class="ai-context-info">
                <span class="ai-context-label">当前上下文:</span>
                <span class="ai-context-value">${tagsHtml}</span>
                <button class="ai-context-clear" onclick="clearAiContext()" title="清空当前上下文">×</button>
            </div>
        `;

        if (input) {
            input.placeholder = '输入消息…';
        }
    } else {
        if (contextEl) {
            contextEl.remove();
        }
        if (input) {
            input.placeholder = '输入消息…';
        }
    }
}

// 清空 AI 上下文。
function clearAiContext() {
    if (confirm('确定清空当前 AI 上下文吗？')) {
        aiSessionContext.databases = [];
        aiSessionContext.modules = [];
        aiSessionContext.history = [];
        updateAiContextDisplay();

        const messagesEl = document.getElementById('aiChatMessages');
        const messageId = 'msg-clear-' + Date.now();
        const messageHtml = `
            <div class="ai-message assistant" id="${messageId}" style="opacity: 0.8;">
                <div class="ai-message-avatar">${getAiAvatarSvg()}</div>
                <div class="ai-message-content">
                    <div style="padding: 12px; background: #e6f7ff; border-left: 3px solid #1890ff; border-radius: 6px; color: #0050b3; font-size: 13px;">
                        当前上下文已清空，可继续通过 @ 选择数据库或模块。
                    </div>
                </div>
            </div>
        `;
        messagesEl.insertAdjacentHTML('beforeend', messageHtml);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }
}

// ==================== AI 配置确认 ====================

// 从 AI 生成的配置中打开编辑弹窗。
function editApiConfigFromAI(messageId, config) {
    // 切换到新增模式。
    isEditApiMode = false;
    editingApiId = null;
    document.getElementById('apiModalTitle').textContent = '新增 API';
    document.getElementById('addApiModal').classList.add('show');
    
    // 默认按 query 接口填充。
    document.getElementById('apiTypeQuery').checked = true;
    switchApiTypeFields('query');
    document.getElementById('apiNameInput').value = config.name || '';
    document.getElementById('apiPathInput').value = config.path || '';
    document.getElementById('apiMethodInput').value = config.method || 'GET';
    document.getElementById('apiSqlInput').value = config.sql || '';
    document.getElementById('apiDescInput').value = config.description || '';
    
    // 填充默认参数。
    if (config.default_params && Object.keys(config.default_params).length > 0) {
        document.getElementById('apiDefaultParamsInput').value = JSON.stringify(config.default_params, null, 2);
    } else {
        document.getElementById('apiDefaultParamsInput').value = '';
    }
    
    // 加载数据库后再选中目标库。
    loadDatabasesForSelect().then(() => {
        if (config.database_id) {
            document.getElementById('apiDbSelect').value = config.database_id;
        }
    });
    
    // 标记为 AI 生成来源。
    document.getElementById('addApiForm').dataset.fromAi = 'true';
    document.getElementById('addApiForm').dataset.aiMessageId = messageId;
    
    document.getElementById('apiFormError').classList.remove('show');
    document.getElementById('apiFormSuccess').classList.remove('show');
}

// 确认创建 AI 生成的 API。
async function confirmCreateApiFromAI(config, messageId) {
    // 显示处理中状态。
    const contentEl = document.getElementById(`${messageId}-content`);
    if (contentEl) {
        contentEl.innerHTML = '<div class="ai-loading"><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div> 处理中...</div>';
    }
    
    // 先刷新数据库下拉框。
    await loadDatabasesForSelect();
    
    const apiData = {
        name: config.name,
        path: config.path,
        method: config.method,
        type: 'query',
        database_id: config.database_id || aiSessionContext.databases[0]?.id,
        sql: config.sql,
        description: config.description || ''
    };
    
    // 复制默认参数。
    if (config.default_params) {
        apiData.default_params = config.default_params;
    }
    
    if (!apiData.database_id) {
        if (contentEl) {
            contentEl.innerHTML = '<div class="ai-error">请先选择一个数据库</div>';
        }
        return;
    }
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/openapis`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(apiData)
        });

        const data = await response.json();

        if (data.success) {
            // 生成成功后显示结果。
            if (contentEl) {
                contentEl.innerHTML = `
                    <div style="padding: 12px; background: #d4edda; border-left: 3px solid #28a745; border-radius: 6px; color: #155724; font-size: 14px;">
                        <strong>创建成功</strong><br>
                        <span style="font-size: 13px; margin-top: 4px; display: block;">
                            名称：${escapeHtml(apiData.name)}<br>
                            路径：${escapeHtml(apiData.path)}<br>
                            已同步到“API 列表”。
                        </span>
                    </div>
                `;
            }
            
            // 如果当前停留在 API 页，则刷新列表。
            if (document.querySelector('[data-tab="api"]').classList.contains('active')) {
                loadApis();
            }
        } else {
            if (contentEl) {
                contentEl.innerHTML = `<div class="ai-error">创建失败：${escapeHtml(data.message || '未知错误')}</div>`;
            }
        }
    } catch (error) {
        if (contentEl) {
            contentEl.innerHTML = `<div class="ai-error">创建失败：${escapeHtml(error.message)}</div>`;
        }
    }
}

// 取消 AI 生成的 API 创建。
function cancelCreateApiFromAI(messageId) {
    const contentEl = document.getElementById(`${messageId}-content`);
    if (contentEl) {
        contentEl.innerHTML = `
            <div style="padding: 12px; background: #f8f9fa; border-left: 3px solid #6c757d; border-radius: 6px; color: #495057; font-size: 13px;">
                已取消创建。
            </div>
        `;
    }
}

// 创建治理任务草稿并提交。
async function confirmCreateGovTaskFromAI(messageId) {
    const draft = window._aiGovDraftByMessageId && window._aiGovDraftByMessageId[messageId];
    if (!draft) return;
    const contentEl = document.getElementById(`${messageId}-content`);
    if (contentEl) {
        contentEl.innerHTML = '<div class="ai-loading"><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div> 处理中...</div>';
    }
    const taskData = {
        name: draft.name,
        type: draft.type,
        description: draft.description || '',
        js_code: draft.js_code,
        database_id: draft.database_id || '',
        cron_expr: draft.type === 'scheduled' ? (draft.cron_expr || '0 0 * * *') : '',
        enabled: draft.type === 'scheduled',
        input_type: draft.type === 'interactive' ? (draft.input_type || 'file') : '',
        accept_exts: draft.type === 'interactive' && draft.accept_exts && draft.accept_exts.length ? draft.accept_exts : []
    };
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(taskData)
        });
        const data = await response.json();
        if (data.success && contentEl) {
            contentEl.innerHTML = `
                <div style="padding: 12px; background: #e6ffed; border-left: 3px solid #52c41a; border-radius: 6px; color: #389e0d; font-size: 13px;">
                    治理任务创建成功。
                </div>
            `;
            loadGovernanceTasks();
        } else if (contentEl) {
            contentEl.innerHTML = `
                <div style="padding: 12px; background: #fff2f0; border-left: 3px solid #ff4d4f; border-radius: 6px; color: #cf1322; font-size: 13px;">
                    ${escapeHtml(data.message || '创建失败')}
                </div>
            `;
        }
    } catch (err) {
        if (contentEl) {
            contentEl.innerHTML = `
                <div style="padding: 12px; background: #fff2f0; border-left: 3px solid #ff4d4f; border-radius: 6px; color: #cf1322; font-size: 13px;">
                    ${escapeHtml('创建失败：' + err.message)}
                </div>
            `;
        }
    }
    if (window._aiGovDraftByMessageId) delete window._aiGovDraftByMessageId[messageId];
}

function cancelGovTaskDraft(messageId) {
    const contentEl = document.getElementById(`${messageId}-content`);
    if (contentEl) {
        contentEl.innerHTML = `
            <div style="padding: 12px; background: #f8f9fa; border-left: 3px solid #6c757d; border-radius: 6px; color: #495057; font-size: 13px;">
                已取消治理任务草稿。
            </div>
        `;
    }
    if (window._aiGovDraftByMessageId) delete window._aiGovDraftByMessageId[messageId];
}

// 从 AI 草稿打开治理任务编辑弹窗。
function editGovTaskDraftFromAI(messageId) {
    const draft = window._aiGovDraftByMessageId && window._aiGovDraftByMessageId[messageId];
    if (!draft) return;
    isEditGovMode = false;
    editingGovTaskId = null;
    document.getElementById('govModalTitle').textContent = '编辑治理任务';
    document.getElementById('govTaskNameInput').value = draft.name || '';
    document.getElementById('govTaskTypeInput').value = draft.type || 'interactive';
    document.getElementById('govTaskDescInput').value = draft.description || '';
    document.getElementById('govCodeInput').value = draft.js_code || '';
    document.getElementById('govCronInput').value = draft.cron_expr || '';
    document.getElementById('govEnabledInput').checked = true;
    document.getElementById('govEnabledLabel').textContent = '启用';
    document.getElementById('govInputTypeSelect').value = draft.input_type || 'file';
    document.getElementById('govAcceptExtsInput').value = (draft.accept_exts || []).join(', ');
    populateGovDbSelect();
    document.getElementById('govTaskDbSelect').value = draft.database_id || '';
    onGovTaskTypeChange();
    document.getElementById('govFormError').textContent = '';
    document.getElementById('govFormError').classList.remove('show');
    document.getElementById('govFormSuccess').textContent = '';
    document.getElementById('govFormSuccess').classList.remove('show');
    document.getElementById('govTaskModal').classList.add('show');
}

// ==================== 表结构管理 ====================

// 打开创建表弹窗。
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

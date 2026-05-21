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

// 显示 @ 联想建议。
function showDbSuggestions(searchTerm) {
    const matchedModules = aiModules.filter(m =>
        m.name.toLowerCase().includes(searchTerm) ||
        m.id.toLowerCase().includes(searchTerm) ||
        (m.aliases && m.aliases.some(a => a.toLowerCase().includes(searchTerm)))
    );
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
    } else {
        // 普通文本全部转义后再处理引用。
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


function genPhp(ctx) {
    const lines = [];
    lines.push('<?php');

    if (ctx.isBodyMethod && ctx.hasParams) {
        lines.push(`$url = '${ctx.baseUrl}';`);
        const items = Object.entries(ctx.params)
            .map(([k, v]) => `    '${k}' => ${typeof v === 'string' ? `'${v}'` : v}`)
            .join(',\n');
        lines.push(`$data = [\n${items}\n];`);
        lines.push('');
        lines.push('$ch = curl_init($url);');
        lines.push('curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);');
        lines.push(`curl_setopt($ch, CURLOPT_CUSTOMREQUEST, '${ctx.method}');`);
        lines.push('curl_setopt($ch, CURLOPT_HTTPHEADER, [');
        lines.push("    'Content-Type: application/json',");
        lines.push(`    'Authorization: Bearer ${ctx.token}'`);
        lines.push(']);');
        lines.push('curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));');
    } else {
        lines.push(`$url = '${ctx.fullUrl}';`);
        lines.push('');
        lines.push('$ch = curl_init($url);');
        lines.push('curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);');
        if (ctx.method !== 'GET') {
            lines.push(`curl_setopt($ch, CURLOPT_CUSTOMREQUEST, '${ctx.method}');`);
        }
        lines.push('curl_setopt($ch, CURLOPT_HTTPHEADER, [');
        lines.push(`    'Authorization: Bearer ${ctx.token}'`);
        lines.push(']);');
    }

    lines.push('');
    lines.push('$response = curl_exec($ch);');
    lines.push('curl_close($ch);');
    lines.push('');
    lines.push('echo $response;');
    return lines.join('\n');
}

function genCurl(ctx) {
    const lines = [];
    if (ctx.isBodyMethod && ctx.hasParams) {
        const bodyEsc = JSON.stringify(ctx.params).replace(/'/g, "'\\''");
        lines.push(`curl -X ${ctx.method} '${ctx.baseUrl}' \\`);
        lines.push(`  -H 'Content-Type: application/json' \\`);
        lines.push(`  -H 'Authorization: Bearer ${ctx.token}' \\`);
        lines.push(`  -d '${bodyEsc}'`);
    } else {
        if (ctx.method === 'GET') {
            lines.push(`curl '${ctx.fullUrl}' \\`);
        } else {
            lines.push(`curl -X ${ctx.method} '${ctx.fullUrl}' \\`);
        }
        lines.push(`  -H 'Authorization: Bearer ${ctx.token}'`);
    }
    return lines.join('\n');
}

function renderCodeExamples(api) {
    const container = document.getElementById('apiCodeExamples');
    if (!container) return;

    const languages = generateCodeExamples(api);
    const activeTab = container.dataset.activeTab || languages[0].id;

    const tabsHtml = languages.map(lang =>
        `<button class="code-tab ${lang.id === activeTab ? 'active' : ''}" data-lang="${lang.id}">${lang.label}</button>`
    ).join('');

    const panelsHtml = languages.map(lang =>
        `<div class="code-panel ${lang.id === activeTab ? 'active' : ''}" data-lang="${lang.id}"><pre><code>${escapeHtml(lang.code)}</code></pre></div>`
    ).join('');

    container.innerHTML = `
        <div class="code-tabs-header">
            <div class="code-tabs">${tabsHtml}</div>
            <button class="code-copy-btn" title="复制代码">复制</button>
        </div>
        <div class="code-panels">${panelsHtml}</div>
    `;

    container.dataset.activeTab = activeTab;

    container.querySelectorAll('.code-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const lang = tab.dataset.lang;
            container.dataset.activeTab = lang;
            container.querySelectorAll('.code-tab').forEach(t => t.classList.toggle('active', t.dataset.lang === lang));
            container.querySelectorAll('.code-panel').forEach(p => p.classList.toggle('active', p.dataset.lang === lang));
        });
    });

    container.querySelector('.code-copy-btn').addEventListener('click', () => {
        const activePanel = container.querySelector('.code-panel.active code');
        if (activePanel) {
            const text = activePanel.textContent;
            navigator.clipboard.writeText(text).then(() => {
                const btn = container.querySelector('.code-copy-btn');
                const original = btn.textContent;
                btn.textContent = '已复制';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.textContent = original;
                    btn.classList.remove('copied');
                }, 2000);
            });
        }
    });
}

// 快速修复 SQL 参数语法。
async function quickFixSql() {
    if (!currentApi) return;
    
    if (!confirm('将 SQL 中的 #{} 与 ${} 参数写法统一为合法格式吗？')) {
        return;
    }
    
    // 替换 SQL 中的参数占位符。
    const fixedSql = currentApi.sql.replace(/#\{/g, '${');
    
    // 处理API类型
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/openapis/${currentApi.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: currentApi.name,
                path: currentApi.path,
                method: currentApi.method,
                database_id: currentApi.database_id,
                sql: fixedSql,
                description: currentApi.description,
                default_params: currentApi.default_params
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('修复成功', 'success');
            loadApiDetail(currentApi.id);
        } else {
            showToast('修复失败：' + (data.message || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('修复失败：' + error.message, 'error');
    }
}

// 切换 API 类型表单字段。
function switchApiTypeFields(type) {
    const queryFields = document.getElementById('apiQueryFields');
    const forwardFields = document.getElementById('apiForwardFields');
    const dbSelect = document.getElementById('apiDbSelect');
    const sqlInput = document.getElementById('apiSqlInput');
    const forwardUrlInput = document.getElementById('apiForwardUrlInput');
    if (type === 'forward') {
        queryFields.style.display = 'none';
        forwardFields.style.display = '';
        dbSelect.required = false;
        sqlInput.required = false;
        forwardUrlInput.required = true;
    } else {
        queryFields.style.display = '';
        forwardFields.style.display = 'none';
        dbSelect.required = true;
        sqlInput.required = true;
        forwardUrlInput.required = false;
    }
}

// 打开新增 API 弹窗。
async function showAddApiModal() {
    isEditApiMode = false;
    editingApiId = null;
    document.getElementById('apiModalTitle').textContent = '新增 API';
    document.getElementById('addApiModal').classList.add('show');
    document.getElementById('addApiForm').reset();
    document.getElementById('apiFormError').classList.remove('show');
    document.getElementById('apiFormSuccess').classList.remove('show');
    // 默认选择查询接口。
    document.getElementById('apiTypeQuery').checked = true;
    switchApiTypeFields('query');
    // 填充默认参数。
    await loadDatabasesForSelect();
}

    // 加载API列表
async function loadDatabasesForSelect() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/databases`);

        const data = await response.json();

        if (data.success) {
            const selectEl = document.getElementById('apiDbSelect');
            const currentValue = selectEl.value;
            
            selectEl.innerHTML = '<option value="">请选择数据库</option>' + 
                (data.databases || []).map(db => 
                    `<option value="${db.id}">${db.name}</option>`
                ).join('');
            
            // 保留当前选中的数据库。
            if (currentValue) {
                selectEl.value = currentValue;
            }
        }
    } catch (error) {
        console.error('刷新API列表失败', error);
    }
}

// 关闭新增 API 弹窗。
function hideAddApiModal() {
    const form = document.getElementById('addApiForm');
    document.getElementById('addApiModal').classList.remove('show');
    isEditApiMode = false;
    editingApiId = null;
    
    // 清除 AI 填充标记。
    delete form.dataset.fromAi;
    delete form.dataset.aiMessageId;
    
    // 刷新API列表
    form.reset();
}

// 提交新增或编辑 API 表单。
async function handleAddApi(e) {
    e.preventDefault();

    const apiType = document.querySelector('input[name="apiType"]:checked')?.value || 'query';

    const apiData = {
        name: document.getElementById('apiNameInput').value.trim(),
        path: document.getElementById('apiPathInput').value.trim(),
        method: document.getElementById('apiMethodInput').value,
        type: apiType,
        description: document.getElementById('apiDescInput').value.trim()
    };

    // 初始化一行默认列。
    if (!apiData.name) {
        showApiFormError('请输入 API 名称');
        return;
    }

    // 删除API
    if (!apiData.path) {
        showApiFormError('请输入请求路径');
        return;
    }

    // 初始化默认列。
    if (!apiData.path.startsWith('/')) {
        showApiFormError('路径必须以 / 开头');
        return;
    }

    if (apiType === 'forward') {
        apiData.forward_url = document.getElementById('apiForwardUrlInput').value.trim();
        if (!apiData.forward_url) {
            showApiFormError('请输入转发 URL');
            return;
        }
        // URL参数解析
        try {
            new URL(apiData.forward_url);
        } catch {
            showApiFormError('请输入有效的 URL');
            return;
        }
    } else {
        apiData.database_id = document.getElementById('apiDbSelect').value;
        apiData.sql = document.getElementById('apiSqlInput').value.trim();
        
        // SQL校验
        if (!apiData.sql) {
            showApiFormError('请输入 SQL');
            return;
        }
    }

    // 解析MyBatis参数
    const defaultParamsText = document.getElementById('apiDefaultParamsInput').value.trim();
    if (defaultParamsText) {
        try {
            apiData.default_params = JSON.parse(defaultParamsText);
        } catch (error) {
            showApiFormError('默认参数必须是合法 JSON');
            return;
        }
    }

    // query类型需要校验SQL
    if (apiType !== 'forward') {
        const sqlWarnings = validateSqlSyntax(apiData.sql);
        if (sqlWarnings.length > 0) {
            const errors = sqlWarnings.filter(w => w.type === 'error');
            if (errors.length > 0) {
                showApiFormError(errors[0].message);
                return;
            }
            const warnings = sqlWarnings.filter(w => w.type === 'warning');
            if (warnings.length > 0) {
                const warningMsg = warnings.map(w => w.message).join('\n\n');
                if (!confirm('SQL 存在警告，是否仍然继续保存？\n\n' + warningMsg + '\n\n继续将按当前内容提交。')) {
                    return;
                }
            }
        }
    }

    const errorEl = document.getElementById('apiFormError');
    const successEl = document.getElementById('apiFormSuccess');
    errorEl.classList.remove('show');
    successEl.classList.remove('show');

    try {
        const url = isEditApiMode 
            ? `${API_BASE}/api/v1/openapis/${editingApiId}`
            : `${API_BASE}/api/v1/openapis`;
        
        const method = isEditApiMode ? 'PUT' : 'POST';
        
        const response = await fetchWithAuth(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(apiData)
        });

        const data = await response.json();

        if (data.success) {
            const isFromAi = e.target.dataset.fromAi === 'true';
            
            successEl.textContent = isEditApiMode ? 'API 已更新' : 'API 已创建';
            successEl.classList.add('show');
            
            setTimeout(() => {
                hideAddApiModal();
                loadApis();
                
                // 如果是 AI 生成的表单，回写成功消息。
                if (isFromAi) {
                    const messagesEl = document.getElementById('aiChatMessages');
                    const messageId = 'msg-success-' + Date.now();
                    const messageHtml = `
                        <div class="ai-message assistant" id="${messageId}">
                            <div class="ai-message-avatar">${getAiAvatarSvg()}</div>
                            <div class="ai-message-content">
                                <div style="padding: 12px; background: #d4edda; border-left: 3px solid #28a745; border-radius: 6px; color: #155724; font-size: 14px;">
                                    <strong>创建成功</strong><br>
                                    <span style="font-size: 13px; margin-top: 4px; display: block;">
                                        名称：${escapeHtml(apiData.name)}<br>
                                        路径：${escapeHtml(apiData.path)}<br>
                                        已同步到“API 列表”中。
                                    </span>
                                </div>
                            </div>
                        </div>
                    `;
                    messagesEl.insertAdjacentHTML('beforeend', messageHtml);
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                    
                    // 清理 AI 标记。
                    delete e.target.dataset.fromAi;
                    delete e.target.dataset.aiMessageId;
                }
                
                if (isEditApiMode && currentApi && currentApi.id === editingApiId) {
                    setTimeout(() => {
                        loadApiDetail(editingApiId);
                    }, 300);
                }
            }, 1000);
        } else {
            showApiFormError(data.message || (isEditApiMode ? '更新失败' : '创建失败'));
        }
    } catch (error) {
        showApiFormError((isEditApiMode ? '更新失败：' : '创建失败：') + error.message);
    }
}

// 显示 API 表单错误。
function showApiFormError(message) {
    const errorEl = document.getElementById('apiFormError');
    errorEl.textContent = message;
    errorEl.classList.add('show');
}

// 校验 SQL 语法风险。
function validateSqlSyntax(sql) {
    const warnings = [];
    
    // DDL 与参数占位符冲突时给出错误提示。
    const isDDL = /^\s*(CREATE|DROP|ALTER|TRUNCATE)\s+/i.test(sql);
    const hasPreparedParams = /#\{[^}]+\}/g.test(sql);
    
    if (isDDL && hasPreparedParams) {
        warnings.push({
            type: 'error',
            message: 'DDL 语句不应同时使用 #{} 预编译参数；请改用 ${} 或普通 SQL。'
        });
    }
    
    // 检测 ${} 风险占位符。
    const hasDirectReplace = /\$\{[^}]+\}/g.test(sql);
    if (hasDirectReplace && !isDDL) {
        warnings.push({
            type: 'warning',
            message: '检测到 ${} 直接拼接参数，若参数来自用户输入，建议改为 #{} 预编译参数。'
        });
    }
    
    return warnings;
}

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
            input.placeholder = '输入消息...（可用 @ 引用上下文）';
        }
    } else {
        if (contextEl) {
            contextEl.remove();
        }
        if (input) {
            input.placeholder = '输入消息...（输入 @ 选择上下文）';
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

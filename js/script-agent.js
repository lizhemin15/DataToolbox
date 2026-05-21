function showClusterModeGuide() {
    const messagesEl = document.getElementById('aiChatMessages');
    if (!messagesEl) return;
    
    // Remove existing guide if any
    removeClusterModeGuide();
    
    const guideEl = document.createElement('div');
    guideEl.id = 'clusterModeGuide';
    guideEl.className = 'cluster-mode-guide';
    guideEl.innerHTML = `
        <div class="cluster-guide-header">🚀 集群模式 — 多智能体自主规划执行</div>
        <div class="cluster-guide-body">
            <p>集群模式由多个AI智能体协作完成任务，具备自主规划、工具调用、深度分析能力。</p>
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
function initAgentMode() {
    initSessionSystem();
}

// Send message via cluster mode (SSE) — PicoClaw-style card UI
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
    let currentBlock = null; // 当前活跃的折叠块
    let fullText = '';

    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/agent/ai-query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message, 
                databases, 
                modules, 
                mode: 'cluster',
                session_id: currentSessionId || 'default'
            })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEventType = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const eventMatch = line.match(/^event:\s*(\w+)/);
                if (eventMatch) { currentEventType = eventMatch[1]; continue; }
                if (!line.startsWith('data: ')) continue;
                const dataStr = line.slice(6).trim();
                if (!dataStr) continue;

                try {
                    const evt = JSON.parse(dataStr);
                    if (!evt.type && currentEventType) evt.type = currentEventType;
                    const evtContent = evt.content || evt.text || evt.message || '';
                    
                    if (evt.type === 'text' && evt.partial === false && evtContent) {
                        fullText = evtContent;
                    } else if (evt.type === 'text' && evtContent) {
                        fullText += evtContent;
                    }
                    
                    currentBlock = handleClusterEventV2(evt, blocksEl, textEl, typingEl, currentBlock);
                } catch (e) {}
                currentEventType = '';
            }
        }

        // 完成：隐藏打字指示器，折叠所有块，渲染最终文本
        typingEl.style.display = 'none';
        if (fullText) {
            textEl.innerHTML = formatClusterMarkdown(fullText);
        }
        // 折叠所有 trace 块
        blocksEl.querySelectorAll('.cluster-block').forEach(b => {
            b.classList.add('collapsed');
            const body = b.querySelector('.cluster-block-body');
            if (body) body.style.display = 'none';
        });

        // 从 DOM 提取折叠块数据，用于刷新后恢复
        const blocksData = [];
        blocksEl.querySelectorAll('.cluster-block').forEach(b => {
            const titleEl = b.querySelector('.cluster-block-title');
            const bodyEl = b.querySelector('.cluster-block-body');
            blocksData.push({
                title: titleEl ? titleEl.textContent : '',
                className: b.className.replace('cluster-block ', '').replace(' collapsed', '').replace(' closed', ''),
                bodyHtml: bodyEl ? bodyEl.innerHTML : ''
            });
        });

        if (fullText || blocksData.length > 0) saveCurrentSessionMessage('assistant', fullText || '', blocksData.length > 0 ? blocksData : null);

    } catch (e) {
        console.error('Cluster query error:', e);
        typingEl.style.display = 'none';
        textEl.innerHTML = `<div class="ai-error">集群模式请求失败: ${escapeHtml(e.message)}</div>`;
    }
}

// Handle cluster SSE events — PicoClaw-style structured blocks
function handleClusterEventV2(evt, blocksEl, textEl, typingEl, currentBlock) {
    if (!evt || !evt.type) return currentBlock;
    const content = evt.content || evt.text || evt.message || '';
    const agent = evt.agent || evt.from || '';
    const tool = evt.tool || '';

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
            // 创建或追加到思考折叠块
            let thinkBlock = blocksEl.querySelector('.cluster-block-thinking:not(.closed)');
            if (!thinkBlock) {
                thinkBlock = createClusterBlock('💭 思考过程', 'cluster-block-thinking');
                blocksEl.appendChild(thinkBlock);
            }
            const body = thinkBlock.querySelector('.cluster-block-body');
            if (content) {
                body.insertAdjacentHTML('beforeend', `<div class="cluster-think-step">${escapeHtml(content.substring(0, 200))}</div>`);
            }
            currentBlock = thinkBlock;
            break;
        }

        case 'tool_call': {
            // 创建工具调用折叠块
            const toolBlock = createClusterBlock(`🔧 ${tool || '工具调用'}`, 'cluster-block-tool');
            const body = toolBlock.querySelector('.cluster-block-body');
            if (content) body.insertAdjacentHTML('beforeend', `<div class="cluster-tool-detail">${escapeHtml(content.substring(0, 500))}</div>`);
            blocksEl.appendChild(toolBlock);
            currentBlock = toolBlock;
            break;
        }

        case 'tool_result': {
            // 追加到当前工具块，或创建新块
            if (currentBlock && currentBlock.classList.contains('cluster-block-tool')) {
                const body = currentBlock.querySelector('.cluster-block-body');
                body.insertAdjacentHTML('beforeend', `<div class="cluster-tool-result">✅ ${escapeHtml(content.substring(0, 300))}</div>`);
                currentBlock.classList.add('closed');
            } else {
                const resultBlock = createClusterBlock(`📋 ${tool || '工具结果'}`, 'cluster-block-tool');
                const body = resultBlock.querySelector('.cluster-block-body');
                body.insertAdjacentHTML('beforeend', `<div class="cluster-tool-result">${escapeHtml(content.substring(0, 300))}</div>`);
                blocksEl.appendChild(resultBlock);
                resultBlock.classList.add('closed');
                currentBlock = resultBlock;
            }
            break;
        }

        case 'agent_switch': {
            const switchBlock = createClusterBlock(`🔀 ${evt.from || '?'} → ${evt.to || '?'}`, 'cluster-block-switch');
            blocksEl.appendChild(switchBlock);
            switchBlock.classList.add('closed');
            currentBlock = switchBlock;
            break;
        }

        case 'error': {
            const errBlock = createClusterBlock(`❌ 错误`, 'cluster-block-error');
            const body = errBlock.querySelector('.cluster-block-body');
            body.insertAdjacentHTML('beforeend', `<div class="cluster-error-detail">${escapeHtml(evt.message || content || '未知错误')}</div>`);
            blocksEl.appendChild(errBlock);
            currentBlock = errBlock;
            break;
        }

        case 'hitl_interaction': {
            // HITL 人在环路交互卡片
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

    // Header
    let html = `<div class="hitl-card-header">
        <span class="hitl-card-icon">${interactionType === 'confirm' ? '⚠️' : interactionType === 'form' ? '📝' : '❓'}</span>
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
        html += '<div class="hitl-options hitl-options-vertical">';
        for (const opt of options) {
            html += `<button class="hitl-option-btn hitl-option-default" onclick="hitlSubmitConfirm('${hitlId}', '${escapeHtml(opt.id)}')">${escapeHtml(opt.label)}</button>`;
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
    }

    html += '</div>'; // hitl-card-body

    // Timeout indicator
    html += `<div class="hitl-card-footer">
        <span class="hitl-timeout-hint">⏱ 等待响应中（超时 ${timeoutSeconds}s）</span>
    </div>`;

    card.innerHTML = html;
    return card;
}

// HITL submit helpers
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

function hitlSubmit(hitlId, action, values) {
    const card = document.querySelector(`.hitl-card[data-hitl-id="${hitlId}"]`);
    // Disable buttons
    if (card) {
        card.querySelectorAll('.hitl-option-btn').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
        });
        const footer = card.querySelector('.hitl-card-footer');
        if (footer) footer.innerHTML = '<span class="hitl-timeout-hint">✅ 响应已提交</span>';
    }

    const token = localStorage.getItem('dataOntologyToken') || '';
    fetch('/api/v1/agent/hitl/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ hitl_id: hitlId, action: action, values: values })
    }).then(r => r.json()).then(data => {
        if (!data.success) {
            console.error('HITL respond failed:', data.message);
            if (card) {
                const footer = card.querySelector('.hitl-card-footer');
                if (footer) footer.innerHTML = `<span class="hitl-timeout-hint" style="color:#dc2626">❌ ${escapeHtml(data.message)}</span>`;
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
        let html = escapeHtml(mainContent);
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
        if (!response.ok) throw new Error('加载失败');
        const data = await response.json();
        const apps = data.apps || [];
        
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
        
        container.innerHTML = apps.map(app => `
            <div class="app-card-item">
                <div class="app-card-icon">${app.icon || '📄'}</div>
                <h3 class="app-card-title">${escapeHtml(app.title)}</h3>
                <p class="app-card-desc">${escapeHtml(app.description || '暂无描述')}</p>
                <div class="app-card-meta">
                    <span class="app-card-slug">/a/${escapeHtml(app.slug)}</span>
                    <span>访问: ${app.view_count || 0}</span>
                </div>
                <div class="app-card-actions">
                    <button class="btn" onclick="openAppInMarketplace('${escapeHtml(app.slug)}')">打开</button>
                    <button class="btn" onclick="editAppInMarketplace('${escapeHtml(app.id)}')">编辑</button>
                    <button class="btn btn-danger" onclick="deleteAppInMarketplace('${escapeHtml(app.id)}', '${escapeHtml(app.title)}')">删除</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('加载应用列表失败:', e);
        container.innerHTML = `<div class="apps-empty-state"><div class="empty-icon">❌</div><h3>加载失败</h3><p>${escapeHtml(e.message)}</p></div>`;
    }
}

// 打开应用
function openAppInMarketplace(slug) {
    window.open(`/a/${slug}`, '_blank');
}

// 编辑应用 - 使用内置 CodePen 编辑器
function editAppInMarketplace(appId) {
    openAppEditor(appId);
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

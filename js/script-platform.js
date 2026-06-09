// ===== API纳管 =====

function getAuthHeaders() {
    const token = localStorage.getItem('dataOntologyToken');
    return token ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } : { 'Content-Type': 'application/json' };
}

let currentPlatformId = null;
let currentPlatformApiId = null;
let platformsData = [];
let platformApisData = [];
let sseAbortController = null;

// ===== 平台列表 =====

function loadPlatforms() {
    fetch('/api/v1/platforms', {headers: getAuthHeaders()})
        .then(r => r.json())
        .then(data => {
            platformsData = data.platforms || [];
            renderPlatformList();
        })
        .catch(err => console.error('加载平台列表失败:', err));
}

function renderPlatformList() {
    const listEl = document.getElementById('platformList');
    if (!listEl) return;
    if (!platformsData.length) {
        listEl.innerHTML = '<div class="col-tables-placeholder"><p>暂无平台</p></div>';
        return;
    }
    listEl.innerHTML = platformsData.map(p => {
        const isActive = p.id === currentPlatformId;
        return `<div class="db-item ${isActive ? 'active' : ''}" onclick="selectPlatform('${p.id}')">
            <div class="db-item-name">${escHtml(p.name)}</div>
            <div class="db-item-info">${escHtml(p.base_url)}</div>
        </div>`;
    }).join('');
}

function selectPlatform(id) {
    currentPlatformId = id;
    currentPlatformApiId = null;
    renderPlatformList();
    loadPlatformApis(id);
    // 显示第二列
    const sidebar = document.getElementById('platformApiSidebar');
    if (sidebar) sidebar.style.display = 'flex';
    const detailPanel = document.getElementById('platformDetailPanel');
    if (detailPanel) detailPanel.style.display = 'block';
    // 重置详情
    showPlatformApiWelcome();
    // 更新标题
    const platform = platformsData.find(p => p.id === id);
    const titleEl = document.getElementById('platformApiSidebarTitle');
    if (titleEl && platform) titleEl.textContent = platform.name + ' 接口';
}

// ===== 平台 CRUD =====

function showAddPlatformModal() {
    const modal = getOrCreateModal('platformModal');
    modal.innerHTML = `
    <div class="modal-content" style="max-width:520px;">
        <div class="modal-header"><h3>添加平台</h3><button class="modal-close" onclick="closeModal('platformModal')">&times;</button></div>
        <div class="modal-body">
            <div class="form-group"><label>名称</label><input id="pfName" type="text" placeholder="如：飞书" class="form-control"></div>
            <div class="form-group"><label>Base URL</label><input id="pfBaseUrl" type="text" placeholder="https://open.feishu.cn" class="form-control"></div>
            <div class="form-group"><label>描述</label><input id="pfDesc" type="text" placeholder="可选" class="form-control"></div>
            <div class="form-group"><label>认证方式</label>
                <select id="pfAuthType" class="form-control" onchange="onPlatformAuthTypeChange()">
                    <option value="none">无认证</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="api_key">API Key</option>
                    <option value="basic">Basic Auth</option>
                </select>
            </div>
            <div id="pfAuthFields"></div>
            <div class="form-group"><label>超时(秒)</label><input id="pfTimeout" type="number" value="30" class="form-control" style="width:100px;"></div>
            <div class="form-group"><label><input id="pfTLSVerify" type="checkbox"> TLS验证</label></div>
            <div id="pfFormError" class="form-error" style="display:none;"></div>
        </div>
        <div class="modal-footer">
            <button class="btn" onclick="closeModal('platformModal')">取消</button>
            <button class="btn btn-primary" onclick="savePlatform()">保存</button>
        </div>
    </div>`;
    modal.classList.add('show');
    onPlatformAuthTypeChange();
}

function onPlatformAuthTypeChange() {
    const type = document.getElementById('pfAuthType')?.value || 'none';
    const container = document.getElementById('pfAuthFields');
    if (!container) return;
    switch (type) {
        case 'bearer':
            container.innerHTML = '<div class="form-group"><label>Token</label><input id="pfAuthToken" type="password" class="form-control" placeholder="Bearer Token"></div>';
            break;
        case 'api_key':
            container.innerHTML = `
            <div class="form-group"><label>Header名</label><input id="pfAuthHeaderName" type="text" class="form-control" value="X-API-Key" placeholder="X-API-Key"></div>
            <div class="form-group"><label>API Key</label><input id="pfAuthApiKey" type="password" class="form-control"></div>`;
            break;
        case 'basic':
            container.innerHTML = `
            <div class="form-group"><label>用户名</label><input id="pfAuthUser" type="text" class="form-control"></div>
            <div class="form-group"><label>密码</label><input id="pfAuthPass" type="password" class="form-control"></div>`;
            break;
        default:
            container.innerHTML = '';
    }
}

function savePlatform(editId) {
    const name = document.getElementById('pfName')?.value?.trim();
    const baseUrl = document.getElementById('pfBaseUrl')?.value?.trim();
    if (!name || !baseUrl) {
        showFormError('pfFormError', '名称和Base URL必填');
        return;
    }
    const authType = document.getElementById('pfAuthType')?.value || 'none';
    const authConfig = {};
    if (authType === 'bearer') authConfig.token = document.getElementById('pfAuthToken')?.value || '';
    if (authType === 'api_key') {
        authConfig.header_name = document.getElementById('pfAuthHeaderName')?.value || 'X-API-Key';
        authConfig.api_key = document.getElementById('pfAuthApiKey')?.value || '';
    }
    if (authType === 'basic') {
        authConfig.username = document.getElementById('pfAuthUser')?.value || '';
        authConfig.password = document.getElementById('pfAuthPass')?.value || '';
    }

    const body = {
        name, base_url: baseUrl,
        description: document.getElementById('pfDesc')?.value || '',
        auth_type: authType, auth_config: authConfig,
        timeout: parseInt(document.getElementById('pfTimeout')?.value) || 30,
        tls_verify: document.getElementById('pfTLSVerify')?.checked || false,
    };

    const url = editId ? `/api/v1/platforms/${editId}` : '/api/v1/platforms';
    const method = editId ? 'PUT' : 'POST';
    fetch(url, {method, headers: getAuthHeaders(), body: JSON.stringify(body)})
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                closeModal('platformModal');
                loadPlatforms();
            } else {
                showFormError('pfFormError', data.message || '操作失败');
            }
        })
        .catch(err => showFormError('pfFormError', '请求失败: ' + err.message));
}

function editPlatform(id) {
    const p = platformsData.find(x => x.id === id);
    if (!p) return;
    showAddPlatformModal();
    setTimeout(() => {
        document.getElementById('pfName').value = p.name || '';
        document.getElementById('pfBaseUrl').value = p.base_url || '';
        document.getElementById('pfDesc').value = p.description || '';
        document.getElementById('pfAuthType').value = p.auth_type || 'none';
        document.getElementById('pfTimeout').value = p.timeout || 30;
        document.getElementById('pfTLSVerify').checked = !!p.tls_verify;
        onPlatformAuthTypeChange();
        // 修改保存按钮为更新
        const footer = document.querySelector('#platformModal .modal-footer');
        if (footer) {
            footer.innerHTML = `
                <button class="btn" onclick="closeModal('platformModal')">取消</button>
                <button class="btn btn-primary" onclick="savePlatform('${id}')">更新</button>
                <button class="btn" onclick="testPlatform('${id}')" style="margin-left:auto;">测试连通</button>`;
        }
    }, 100);
}

function deletePlatform(id) {
    if (!confirm('确定删除此平台及其所有接口？')) return;
    fetch(`/api/v1/platforms/${id}`, {method: 'DELETE', headers: getAuthHeaders()})
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                if (currentPlatformId === id) {
                    currentPlatformId = null;
                    currentPlatformApiId = null;
                    document.getElementById('platformApiSidebar').style.display = 'none';
                    document.getElementById('platformDetailPanel').style.display = 'none';
                }
                loadPlatforms();
            }
        });
}

function testPlatform(id) {
    fetch(`/api/v1/platforms/${id}/test`, {method: 'POST', headers: getAuthHeaders()})
        .then(r => r.json())
        .then(data => {
            alert(data.message || (data.success ? '连通成功' : '连通失败'));
        })
        .catch(err => alert('测试失败: ' + err.message));
}

// ===== 接口列表 =====

function loadPlatformApis(platformId) {
    fetch(`/api/v1/platforms/${platformId}/apis`, {headers: getAuthHeaders()})
        .then(r => r.json())
        .then(data => {
            platformApisData = data.apis || [];
            renderPlatformApiList();
        });
}

function renderPlatformApiList() {
    const listEl = document.getElementById('platformApiList');
    if (!listEl) return;
    if (!platformApisData.length) {
        listEl.innerHTML = '<div class="col-tables-placeholder"><p>暂无接口</p></div>';
        return;
    }
    listEl.innerHTML = platformApisData.map(a => {
        const isActive = a.id === currentPlatformApiId;
        const methodColor = getMethodColor(a.method);
        return `<div class="db-item ${isActive ? 'active' : ''}" onclick="selectPlatformApi('${a.id}')">
            <div class="db-item-name">
                <span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:600;color:#fff;background:${methodColor};margin-right:4px;">${a.method || 'GET'}</span>
                ${escHtml(a.name)}
            </div>
            <div class="db-item-info" style="font-size:11px;color:#999;word-break:break-all;">${escHtml(a.suffix || '')}</div>
        </div>`;
    }).join('');
}

function selectPlatformApi(id) {
    currentPlatformApiId = id;
    renderPlatformApiList();
    renderPlatformApiDetail(id);
}

// ===== 接口详情 =====

function renderPlatformApiDetail(apiId) {
    const api = platformApisData.find(a => a.id === apiId);
    if (!api) return;
    const detailEl = document.getElementById('platformApiDetailView');
    const welcomeEl = document.getElementById('platformApiWelcome');
    if (welcomeEl) welcomeEl.style.display = 'none';
    if (detailEl) detailEl.style.display = 'block';

    const platform = platformsData.find(p => p.id === api.platform_id);
    const methodColor = getMethodColor(api.method);
    const enabled = api.enabled !== false;

    detailEl.innerHTML = `
    <div class="detail-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <h2 style="margin:0;">${escHtml(api.name)}</h2>
        <div style="display:flex;gap:8px;align-items:center;">
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                <input type="checkbox" ${enabled ? 'checked' : ''} onchange="togglePlatformApiEnabled('${api.id}', this.checked)"> 启用
            </label>
            <button class="btn btn-sm" onclick="editPlatformApi('${api.id}')">编辑</button>
            <button class="btn btn-sm btn-danger" onclick="deletePlatformApi('${api.id}')">删除</button>
        </div>
    </div>
    <div class="db-info" style="margin-bottom:20px;">
        <div class="info-item"><span class="info-label">平台:</span><span class="info-value">${escHtml(platform?.name || '')}</span></div>
        <div class="info-item"><span class="info-label">方法:</span><span class="info-value"><span style="display:inline-block;padding:1px 8px;border-radius:3px;font-size:12px;font-weight:600;color:#fff;background:${methodColor};">${api.method || 'GET'}</span></span></div>
        <div class="info-item"><span class="info-label">后缀:</span><span class="info-value" style="word-break:break-all;">${escHtml(api.suffix || '')}</span></div>
        <div class="info-item"><span class="info-label">完整URL:</span><span class="info-value" style="word-break:break-all;">${escHtml((platform?.base_url || '') + (api.suffix || ''))}</span></div>
        ${api.description ? `<div class="info-item"><span class="info-label">描述:</span><span class="info-value">${escHtml(api.description)}</span></div>` : ''}
        ${api.body_template ? `<div class="info-item"><span class="info-label">请求体模板:</span><pre style="margin:4px 0;padding:8px;background:#f5f5f5;border-radius:4px;font-size:12px;overflow:auto;max-height:200px;">${escHtml(api.body_template)}</pre></div>` : ''}
    </div>
    <div style="border-top:1px solid #e0e0e0;padding-top:16px;">
        <h3 style="margin:0 0 12px;">接口测试</h3>
        <div class="form-group"><label>请求参数(JSON)</label>
            <textarea id="pfTestParams" rows="5" class="form-control" style="font-family:monospace;font-size:12px;" placeholder='{"user_id": "123"}'></textarea>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px;">
            <button class="btn btn-sm btn-primary" onclick="testPlatformApi('${api.id}')">发送</button>
            <button class="btn btn-sm" onclick="stopSSETest()" id="pfStopBtn" style="display:none;">停止</button>
        </div>
        <div id="pfTestResult" style="display:none;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <strong>响应</strong>
                <span id="pfTestStatus" style="font-size:12px;"></span>
            </div>
            <pre id="pfTestBody" style="max-height:400px;overflow:auto;padding:12px;background:#1e1e1e;color:#d4d4d4;border-radius:4px;font-size:12px;font-family:monospace;white-space:pre-wrap;"></pre>
        </div>
    </div>`;
}

function showPlatformApiWelcome() {
    const detailEl = document.getElementById('platformApiDetailView');
    const welcomeEl = document.getElementById('platformApiWelcome');
    if (detailEl) detailEl.style.display = 'none';
    if (welcomeEl) welcomeEl.style.display = '';
}

// ===== 接口 CRUD =====

function showAddPlatformApiModal() {
    if (!currentPlatformId) return;
    const modal = getOrCreateModal('platformApiModal');
    modal.innerHTML = `
    <div class="modal-content" style="max-width:560px;">
        <div class="modal-header"><h3>添加接口</h3><button class="modal-close" onclick="closeModal('platformApiModal')">&times;</button></div>
        <div class="modal-body">
            <div class="form-group"><label>名称</label><input id="pfaName" type="text" placeholder="如：获取用户信息" class="form-control"></div>
            <div class="form-group"><label>请求方法</label>
                <select id="pfaMethod" class="form-control">
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                    <option value="PATCH">PATCH</option>
                </select>
            </div>
            <div class="form-group"><label>路径后缀</label><input id="pfaSuffix" type="text" placeholder="/open-apis/contact/v3/users/{user_id}" class="form-control"></div>
            <div class="form-group"><label>描述</label><input id="pfaDesc" type="text" placeholder="可选" class="form-control"></div>
            <div class="form-group"><label>请求体模板(JSON)</label>
                <textarea id="pfaBody" rows="5" class="form-control" style="font-family:monospace;font-size:12px;" placeholder='{"model": "gpt-4", "messages": {{messages}}}'></textarea>
            </div>
            <div class="form-group"><label>额外请求头(JSON)</label>
                <textarea id="pfaHeaders" rows="3" class="form-control" style="font-family:monospace;font-size:12px;" placeholder='{"Content-Type": "application/json"}'></textarea>
            </div>
            <div id="pfaFormError" class="form-error" style="display:none;"></div>
        </div>
        <div class="modal-footer">
            <button class="btn" onclick="closeModal('platformApiModal')">取消</button>
            <button class="btn btn-primary" onclick="savePlatformApi()">保存</button>
        </div>
    </div>`;
    modal.classList.add('show');
}

function savePlatformApi(editId) {
    const name = document.getElementById('pfaName')?.value?.trim();
    const suffix = document.getElementById('pfaSuffix')?.value?.trim();
    if (!name || !suffix) {
        showFormError('pfaFormError', '名称和路径后缀必填');
        return;
    }
    let headers = {};
    const headersStr = document.getElementById('pfaHeaders')?.value?.trim();
    if (headersStr) {
        try { headers = JSON.parse(headersStr); } catch(e) {
            showFormError('pfaFormError', '请求头格式无效');
            return;
        }
    }

    const body = {
        name,
        method: document.getElementById('pfaMethod')?.value || 'GET',
        suffix,
        description: document.getElementById('pfaDesc')?.value || '',
        body_template: document.getElementById('pfaBody')?.value || '',
        headers,
    };

    const url = editId
        ? `/api/v1/platforms/${currentPlatformId}/apis/${editId}`
        : `/api/v1/platforms/${currentPlatformId}/apis`;
    const method = editId ? 'PUT' : 'POST';
    fetch(url, {method, headers: getAuthHeaders(), body: JSON.stringify(body)})
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                closeModal('platformApiModal');
                loadPlatformApis(currentPlatformId);
            } else {
                showFormError('pfaFormError', data.message || '操作失败');
            }
        })
        .catch(err => showFormError('pfaFormError', '请求失败: ' + err.message));
}

function editPlatformApi(id) {
    const api = platformApisData.find(a => a.id === id);
    if (!api) return;
    showAddPlatformApiModal();
    setTimeout(() => {
        document.getElementById('pfaName').value = api.name || '';
        document.getElementById('pfaMethod').value = api.method || 'GET';
        document.getElementById('pfaSuffix').value = api.suffix || '';
        document.getElementById('pfaDesc').value = api.description || '';
        document.getElementById('pfaBody').value = api.body_template || '';
        document.getElementById('pfaHeaders').value = api.headers ? JSON.stringify(api.headers, null, 2) : '';
        const footer = document.querySelector('#platformApiModal .modal-footer');
        if (footer) {
            footer.innerHTML = `
                <button class="btn" onclick="closeModal('platformApiModal')">取消</button>
                <button class="btn btn-primary" onclick="savePlatformApi('${id}')">更新</button>`;
        }
    }, 100);
}

function deletePlatformApi(id) {
    if (!confirm('确定删除此接口？')) return;
    fetch(`/api/v1/platforms/${currentPlatformId}/apis/${id}`, {method: 'DELETE', headers: getAuthHeaders()})
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                if (currentPlatformApiId === id) {
                    currentPlatformApiId = null;
                    showPlatformApiWelcome();
                }
                loadPlatformApis(currentPlatformId);
            }
        });
}

function togglePlatformApiEnabled(id, enabled) {
    fetch(`/api/v1/platforms/${currentPlatformId}/apis/${id}`, {
        method: 'PUT', headers: getAuthHeaders(),
        body: JSON.stringify({enabled})
    }).then(r => r.json()).then(data => {
        if (data.success) loadPlatformApis(currentPlatformId);
    });
}

// ===== 接口测试 =====

function testPlatformApi(apiId) {
    const api = platformApisData.find(a => a.id === apiId);
    if (!api) return;
    const platform = platformsData.find(p => p.id === api.platform_id);
    if (!platform) return;

    // 构建转发 URL
    const slug = slugify(platform.name);
    let fwdPath = api.suffix || '';
    // 替换路径参数
    const paramsStr = document.getElementById('pfTestParams')?.value?.trim();
    if (paramsStr) {
        try {
            const params = JSON.parse(paramsStr);
            for (const [k, v] of Object.entries(params)) {
                fwdPath = fwdPath.replace(`{${k}}`, String(v));
            }
        } catch(e) {}
    }

    const fwdUrl = `/api/fwd/${slug}${fwdPath}`;
    const resultEl = document.getElementById('pfTestResult');
    const statusEl = document.getElementById('pfTestStatus');
    const bodyEl = document.getElementById('pfTestBody');
    const stopBtn = document.getElementById('pfStopBtn');
    if (resultEl) resultEl.style.display = 'block';
    if (bodyEl) bodyEl.textContent = '请求中...';
    if (statusEl) statusEl.textContent = '';

    sseAbortController = new AbortController();
    if (stopBtn) stopBtn.style.display = 'inline-block';

    const fetchOpts = {
        method: api.method || 'GET',
        headers: {...getAuthHeaders(), 'Content-Type': 'application/json'},
        signal: sseAbortController.signal,
    };
    if (['POST', 'PUT', 'PATCH'].includes(fetchOpts.method) && paramsStr) {
        fetchOpts.body = paramsStr;
    }

    const startTime = Date.now();
    fetch(fwdUrl, fetchOpts).then(async resp => {
        const elapsed = Date.now() - startTime;
        if (statusEl) statusEl.textContent = `${resp.status} | ${elapsed}ms`;

        const contentType = resp.headers.get('Content-Type') || '';
        if (contentType.includes('text/event-stream')) {
            // SSE 流式显示
            if (bodyEl) bodyEl.textContent = '';
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            try {
                while (true) {
                    const {done, value} = await reader.read();
                    if (done) break;
                    const text = decoder.decode(value, {stream: true});
                    if (bodyEl) bodyEl.textContent += text;
                    bodyEl.scrollTop = bodyEl.scrollHeight;
                }
            } catch(e) {
                if (e.name !== 'AbortError') throw e;
            }
            if (statusEl) statusEl.textContent += ' | SSE 完成';
        } else {
            // 普通响应
            const text = await resp.text();
            if (bodyEl) {
                try {
                    bodyEl.textContent = JSON.stringify(JSON.parse(text), null, 2);
                } catch {
                    bodyEl.textContent = text;
                }
            }
        }
    }).catch(err => {
        if (err.name === 'AbortError') {
            if (statusEl) statusEl.textContent += ' | 已停止';
        } else {
            if (bodyEl) bodyEl.textContent = '请求失败: ' + err.message;
        }
    }).finally(() => {
        if (stopBtn) stopBtn.style.display = 'none';
        sseAbortController = null;
    });
}

function stopSSETest() {
    if (sseAbortController) {
        sseAbortController.abort();
        sseAbortController = null;
    }
}

// ===== 辅助函数 =====

function getMethodColor(method) {
    const colors = {GET:'#61affe', POST:'#49cc90', PUT:'#fca130', DELETE:'#f93e3e', PATCH:'#50e3c2'};
    return colors[(method || 'GET').toUpperCase()] || '#999';
}

function slugify(name) {
    return (name || '').toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function getOrCreateModal(id) {
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.className = 'modal';
        document.body.appendChild(el);
    }
    return el;
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
}

function showFormError(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// 页面切换时加载数据
document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.dataset.tab === 'platform') {
                loadPlatforms();
            }
        });
    });
});

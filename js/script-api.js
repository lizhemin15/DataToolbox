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
function filterApiList() {
    renderApiList();
}

// 渲染 API 列表。
function renderApiList() {
    const listEl = document.getElementById('apiList');
    const searchInput = document.getElementById('apiSearchInput');
    const keyword = (searchInput ? searchInput.value : '').trim().toLowerCase();
    
    const filtered = keyword
        ? apis.filter(api => 
            api.name.toLowerCase().includes(keyword) || 
            api.path.toLowerCase().includes(keyword) ||
            api.method.toLowerCase().includes(keyword))
        : apis;

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
        return `
            <div class="db-item api-item ${currentApi && currentApi.id === api.id ? 'active' : ''} ${enabled ? '' : 'api-disabled'}" onclick="selectApi('${safeApiId}')">
                <div class="db-item-main">
                    <div class="db-item-name">${safeApiName}</div>
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

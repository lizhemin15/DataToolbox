
// 分享任务
async function toggleShareGovTask() {
    if (!currentGovTask) return;
    const shareBtn = document.getElementById('shareGovTaskBtn');
    const originalText = shareBtn.textContent;
    shareBtn.disabled = true;
    
    try {
        const isShared = currentGovTask.share_enabled;
        const method = isShared ? 'DELETE' : 'POST';
        const response = await fetchWithAuth(
            `${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}/share`,
            { method }
        );
        const data = await response.json();
        if (data.success) {
            currentGovTask.share_enabled = !isShared;
            currentGovTask.share_token = data.share_token || '';
            showGovTaskDetail(currentGovTask);
            // 同步编辑界面的 checkbox 状态
            const openShare = document.getElementById('govOpenShare');
            if (openShare) openShare.checked = currentGovTask.share_enabled;
            // 同步编辑界面的分享配置面板显示
            const shareConfig = document.getElementById('govShareConfig');
            if (shareConfig) shareConfig.style.display = currentGovTask.share_enabled ? '' : 'none';
            showToast(isShared ? '已关闭分享' : '已开启分享', 'success');
        } else {
            showToast(data.message || '操作失败', 'error');
        }
    } catch (error) {
        console.error('分享操作失败', error);
        showToast('分享操作失败', 'error');
    } finally {
        shareBtn.disabled = false;
    }
}

function copyGovShareLink() {
    if (!currentGovTask || !currentGovTask.share_token) {
        showToast('未开启分享', 'error');
        return;
    }
    const url = `${window.location.origin}/share/${currentGovTask.share_token}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            showToast('分享链接已复制', 'success');
        }).catch(e => {
            console.error('复制失败', e);
            fallbackCopy(url);
        });
    } else {
        fallbackCopy(url);
    }
}

function fallbackCopy(text) {
    const input = document.createElement('input');
    input.value = text;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.select();
    try {
        document.execCommand('copy');
        showToast('分享链接已复制', 'success');
    } catch (e) {
        showToast('复制失败，请手动复制: ' + text, 'error');
    }
    document.body.removeChild(input);
}

async function deleteGovTask() {
    if (!currentGovTask) return;
    if (!confirm(`确定删除治理任务“${currentGovTask.name}”吗？此操作不可恢复。`)) return;
    
    const deleteBtn = document.getElementById('deleteGovTaskBtn');
    const originalText = deleteBtn ? deleteBtn.textContent : '';
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.textContent = '删除中...';
    }
    
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            currentGovTask = null;
            try { sessionStorage.removeItem('govLastSelectedTaskId'); } catch (e) {}
            document.getElementById('govTaskDetailView').style.display = 'none';
            document.getElementById('govWelcomeView').style.display = '';
            loadGovernanceTasks();
        } else {
            showToast(data.message || '删除失败', 'error');
            if (deleteBtn) {
                deleteBtn.disabled = false;
                deleteBtn.textContent = originalText;
            }
        }
    } catch (error) {
        showToast('删除失败：' + error.message, 'error');
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.textContent = originalText;
        }
    }
}

function getGovTaskRunMode(task) {
    const mode = String(task?.run_mode || task?.execution_mode || task?.exec_mode || 'backend').toLowerCase();
    if (mode === 'frontend' || mode === 'browser' || mode === 'client') return 'frontend';
    if (mode === 'backend' || mode === 'server' || mode === 'remote') return 'backend';
    return 'backend';
}

async function runGovTask() {
    if (!currentGovTask) return;

    const runMode = getGovTaskRunMode(currentGovTask);
    if (runMode === 'frontend') {
        await executeGovTaskInBrowser(currentGovTask.js_code, null, '', []);
        return;
    }

    await executeGovTaskOnBackend([], '');
}

async function toggleGovTask() {
    if (!currentGovTask) return;
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}/toggle`, {
            method: 'POST'
        });
        const data = await response.json();
        if (data.success) {
            currentGovTask.enabled = data.enabled;
            showGovTaskDetail(currentGovTask);
            renderGovTaskList();
        }
    } catch (error) {
        showToast('切换状态失败: ' + error.message, 'error');
    }
}

async function refreshGovTaskStatus() {
    if (!currentGovTask) return;
    console.log('[refreshGovTaskStatus] 开始刷新, 当前状态:', currentGovTask.status);
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}`);
        const data = await response.json();
        if (data.success && data.task) {
            console.log('[refreshGovTaskStatus] 后端返回状态:', data.task.status);
            const idx = govTasks.findIndex(t => t.id === data.task.id);
            if (idx >= 0) govTasks[idx] = data.task;
            currentGovTask = data.task;
            showGovTaskDetail(data.task);
            renderGovTaskList();
            loadGovTaskLogs();
            if (data.task.status === 'running') {
                console.log('[refreshGovTaskStatus] 状态仍为 running, 3秒后继续轮询');
                setTimeout(refreshGovTaskStatus, 3000);
            } else {
                console.log('[refreshGovTaskStatus] 任务已结束, 停止轮询');
            }
        }
    } catch (error) {
        console.error('刷新治理任务状态失败', error);
    }
}

// 处理AI流式响应
function handleGovFileSelect(event) {
    if (event.target.files.length > 0) {
        setGovFiles(event.target.files);
    }
}

function setGovFiles(fileList) {
    govSelectedFiles = Array.from(fileList || []);
    const row = document.getElementById('govSelectedFile');
    const nameEl = document.getElementById('govFileName');
    if (govSelectedFiles.length === 0) {
        row.style.display = 'none';
        return;
    }
    if (govSelectedFiles.length === 1) {
        const f = govSelectedFiles[0];
        nameEl.textContent = f.name + ' (' + formatFileSize(f.size) + ')';
    } else {
        const total = govSelectedFiles.reduce((s, f) => s + f.size, 0);
        const names = govSelectedFiles.map(f => f.name).join('、');
        const maxLen = 200;
        const showNames = names.length > maxLen ? names.slice(0, maxLen) + '…' : names;
        nameEl.textContent = `已选择 ${govSelectedFiles.length} 个文件，共 ${formatFileSize(total)}，${showNames}`;
    }
    row.style.display = 'flex';
}

function clearGovFile() {
    govSelectedFiles = [];
    document.getElementById('govFileInput').value = '';
    document.getElementById('govSelectedFile').style.display = 'none';
    document.getElementById('govInputText') && (document.getElementById('govInputText').value = '');
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function executeInteractiveTask() {
    if (!currentGovTask) return;
    const inputType = currentGovTask.input_type || 'file';
    const inputText = document.getElementById('govInputText')?.value || '';
    const files = govSelectedFiles;
    const runMode = getGovTaskRunMode(currentGovTask);

    if ((inputType === 'file' || inputType === 'both') && files.length === 0 && !inputText) {
        showToast('请输入文件或文本后再运行', 'warning');
        return;
    }
    if (inputType === 'text' && !inputText) {
        showToast('请输入文本内容后再运行', 'warning');
        return;
    }

    if (runMode === 'frontend') {
        const batchMode = currentGovTask.file_batch_mode || 'per_file';
        if (currentGovTask.type === 'interactive' && batchMode === 'single') {
            if (files.length < 2) {
                showToast('当前前端模式要求至少 2 个文件，才能一次合并处理', 'warning');
                return;
            }
            await executeGovTaskAggregateInBrowser(files, inputText);
            return;
        }
        await executeGovTaskInBrowser(currentGovTask.js_code, files[0] || null, inputText, files);
        return;
    }

    await executeGovTaskOnBackend(files, inputText);
}

async function executeGovTaskAggregateInBrowser(files, inputText) {
    if (!currentGovTask) return;
    currentGovTask.status = 'running';
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();
    const container = document.getElementById('govTaskOutput');
    container.innerHTML = '<div class="gov-log-entry"><div class="gov-log-header"><span>处理中...</span><span class="gov-log-status running">运行中</span></div></div>';

    const { status, output, errorMsg, inputDesc } = await executeGovTaskInBrowserOnce(currentGovTask.js_code, null, inputText, files);

    currentGovTask.status = status;
    currentGovTask.last_output = output;
    currentGovTask.last_error = errorMsg;
    currentGovTask.last_run_at = new Date().toISOString();
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    container.innerHTML = `
        <div class="gov-log-entry">
            <div class="gov-log-header">
                <span>${new Date().toLocaleString()}</span>
                <span class="gov-log-status ${status}">${status === 'success' ? '成功' : '失败'}</span>
            </div>
            ${inputDesc ? `<div class="gov-log-input">输入: ${escapeHtml(inputDesc)}</div>` : ''}
            ${output ? `<div class="gov-log-output">${renderGovOutput(output)}</div>` : ''}
            ${errorMsg ? `<div class="gov-log-error">${escapeHtml(errorMsg)}</div>` : ''}
        </div>
    `;

    // 前端执行完成后，通知后端保存结果并同步到分享页
    try {
        // 如果有文件且任务开启了分享，用 FormData 上传文件
        if (files && files.length > 0 && currentGovTask.share_enabled && currentGovTask.share_token) {
            const formData = new FormData();
            formData.append('status', status);
            formData.append('output', output || '');
            formData.append('error', errorMsg || '');
            formData.append('input_text', inputText || '');
            formData.append('share_enabled', 'true');
            formData.append('share_token', currentGovTask.share_token);
            // 传 input_files 文件名数组，后端需要用这个来记录
            const inputFileNames = files.map(f => f.name || f);
            formData.append('input_files', JSON.stringify(inputFileNames));
            for (const f of files) {
                if (f instanceof File) {
                    formData.append('files', f);
                }
            }
            await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}/frontend-run`, {
                method: 'POST',
                body: formData
            });
        } else {
            // 无文件或未开启分享，只传 JSON
            const inputFileNames = files ? files.map(f => f.name || f) : [];
            const shareEnabled = currentGovTask.share_enabled ? true : false;
            await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}/frontend-run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: status,
                    output: output,
                    error: errorMsg,
                    input_text: inputText,
                    input_files: inputFileNames,
                    share_enabled: shareEnabled,
                    share_token: currentGovTask.share_token || ''
                })
            });
        }
    } catch (e) {
        console.warn('同步前端执行结果到后端失败:', e);
    }
}

// 在后端执行治理任务。
async function executeGovTaskOnBackend(files, inputText) {
    if (!currentGovTask) return;

    const taskId = currentGovTask.id;

    // 更新 UI 显示运行中
    currentGovTask.status = 'running';
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    const container = document.getElementById('govTaskOutput');
    container.innerHTML = '<div class="gov-log-entry"><div class="gov-log-header"><span>后端运行中...</span></div></div>';

    try {
        // 构造 multipart 表单。
        const formData = new FormData();
        formData.append('input_text', inputText || '');

        if (files && files.length > 0) {
            for (const file of files) {
                formData.append('files', file);
            }
        }

        // 提交执行请求。
        const response = await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${taskId}/run`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || '后端执行失败');
        }

        const runId = result.run_id;
        container.innerHTML = `<div class="gov-log-entry"><div class="gov-log-header"><span>已提交后端执行，等待进度...</span><span class="gov-log-status running">运行中</span></div></div>`;

        // 在后端执行治理任务
        await pollTaskProgress(taskId, runId);

    } catch (error) {
        currentGovTask.status = 'error';
        currentGovTask.last_error = error.message;
        container.innerHTML = `<div class="gov-log-entry"><div class="gov-log-header"><span style="color:red">错误: ${escapeHtml(error.message)}</span></div></div>`;
        renderGovTaskList();
    }
}

/**
 * 轮询任务进度
 * 每 2 秒查询一次任务进度，直到完成或出错
 * @param {string} taskId - 任务 ID
 * @param {string} runId - 运行 ID
 * @returns {Promise<void>}
 */
async function pollTaskProgress(taskId, runId) {
    const container = document.getElementById('govTaskOutput');

    const pollInterval = 2000; // 2秒间隔
    let lastProcessed = 0;

    const poll = async () => {
        try {
            console.log('[pollTaskProgress] 轮询中...');
            const response = await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${taskId}/progress`);
            const data = await response.json();

            if (!data.success) {
                console.error('获取进度失败:', data.message);
                return;
            }

            const { status, percent, processed_files, total_files, current_file, last_output, last_error } = data;
            console.log('[pollTaskProgress] status:', status, 'percent:', percent);

            // 如果有文件进度，渲染进度条；否则显示 last_output（由 gov.log 输出）
            if (total_files > 0) {
                container.innerHTML = `
                    <div class="gov-log-entry">
                        <div class="gov-log-header">
                            <span>进度: ${processed_files}/${total_files} (${percent}%)</span>
                            <span class="gov-log-status ${status}">${status === 'running' ? '运行中' : status === 'success' ? '成功' : '失败'}</span>
                        </div>
                        ${current_file ? `<div class="gov-log-input">当前文件: ${escapeHtml(current_file)}</div>` : ''}
                        ${last_output ? `<div class="gov-log-output">${renderGovOutput(last_output)}</div>` : ''}
                    </div>`;
            } else {
                container.innerHTML = `
                    <div class="gov-log-entry">
                        <div class="gov-log-header">
                            <span>运行中${status === 'running' ? '...' : ''}</span>
                            <span class="gov-log-status ${status}">${status === 'running' ? '运行中' : status === 'success' ? '成功' : '失败'}</span>
                        </div>
                        ${last_output ? `<div class="gov-log-output">${renderGovOutput(last_output)}</div>` : ''}
                        ${last_error ? `<div class="gov-log-error">${escapeHtml(last_error)}</div>` : ''}
                    </div>`;
            }

            // 任务已结束，更新状态并刷新详情
            if (status !== 'running') {
                console.log('[pollTaskProgress] 任务已结束, status:', status);
                // 直接更新 currentGovTask 和 govTasks 数组，避免 loadGovernanceTasks 触发额外的轮询
                if (currentGovTask && currentGovTask.id === taskId) {
                    currentGovTask.status = status;
                    currentGovTask.percent = percent;
                    currentGovTask.last_output = last_output;
                    currentGovTask.last_error = last_error;
                    currentGovTask.last_run_at = new Date().toISOString();
                    const idx = govTasks.findIndex(t => t.id === taskId);
                    if (idx >= 0) govTasks[idx] = currentGovTask;
                    showGovTaskDetail(currentGovTask);
                    renderGovTaskList();
                }
                await loadGovTaskLogs();
                return;
            }

            // 继续轮询
            setTimeout(poll, pollInterval);

        } catch (error) {
            console.error('获取进度失败:', error);
            // 网络错误继续轮询
            setTimeout(poll, pollInterval);
        }
    };

    await poll();
}

// ==================== 治理任务执行支持 ====================

let govLibsLoaded = false;

/**
 * 动态加载治理任务所需的外部库（XLSX, PapaParse, mammoth, PizZip, docxtemplater）。
 * 仅在首次使用时加载，后续调用直接返回。
 * @returns {Promise<void>}
 */
async function ensureGovLibsLoaded() {
    if (govLibsLoaded) return;
    const libs = [
        { global: 'XLSX',    src: '../../lib/xlsx.full.min.js' },
        { global: 'Papa',    src: '../../lib/papaparse.min.js' },
        { global: 'mammoth', src: '../../lib/mammoth.browser.min.js' },
        { global: 'PizZip',  src: 'lib/pizzip.js' },
    ];
    for (const lib of libs) {
        if (!window[lib.global]) {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = lib.src;
                s.onload = resolve;
                s.onerror = () => reject(new Error(`加载失败: ${lib.src}`));
                document.head.appendChild(s);
            });
        }
    }
    if (!_govGetDocxtemplaterClass()) {
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'lib/docxtemplater.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('加载 docxtemplater 失败'));
            document.head.appendChild(s);
        });
    }
    if (!_govGetDocxtemplaterClass()) {
        throw new Error('Docxtemplater 未就绪');
    }
    govLibsLoaded = true;
}

function _govGetDocxtemplaterClass() {
    if (typeof window.Docxtemplater !== 'undefined') return window.Docxtemplater;
    const d = window.docxtemplater;
    if (d && (d.default || d.Docxtemplater)) return d.default || d.Docxtemplater;
    return null;
}

function _govShared() {
    return window.GOV_SHARED || globalThis.GOV_SHARED || {};
}

function _govExcelCellForValue(val) {
    const shared = _govShared();
    if (typeof shared.govExcelCellForValue === 'function') return shared.govExcelCellForValue(val);
    return val === null || val === undefined ? null : { t: 's', v: String(val) };
}

function _govExpandSheetRef(XLSX, ws) {
    const shared = _govShared();
    if (typeof shared.govExpandSheetRef === 'function') return shared.govExpandSheetRef(XLSX, ws);
}

function _govApplyCellMapToSheet(XLSX, ws, cellMap) {
    const shared = _govShared();
    if (typeof shared.govApplyCellMapToSheet === 'function') return shared.govApplyCellMapToSheet(XLSX, ws, cellMap);
}

function _govDataIsFlatCellMap(XLSX, data) {
    const shared = _govShared();
    if (typeof shared.govDataIsFlatCellMap === 'function') return shared.govDataIsFlatCellMap(XLSX, data);
    return false;
}

function createGovHelper(logLines, uploadedFiles) {
    const uploaded = Array.isArray(uploadedFiles) ? uploadedFiles : [];
    const dbId = currentGovTask?.database_id || '';

    async function _resolveGovTemplateFile(templateFile) {
        if (templateFile instanceof File || templateFile instanceof Blob) return templateFile;
        if (typeof templateFile === 'string') {
            const name = templateFile.trim();
            if (!name) throw new Error('模板文件名不能为空');
            const found = uploaded.find(f => f && f.name === name)
                || uploaded.find(f => f && (f.name.endsWith(name) || name.endsWith(f.name)));
            if (found) return found;
            throw new Error(`模板文件 ${name} 在上传列表中未找到，请确保 File 对象可用`);
        }
        throw new Error('templateFile 必须为 File/Blob 类型才能解析');
    }

    async function _runSQL(databaseId, sql, params = []) {
        const resp = await fetchWithAuth(`${API_BASE}/api/v1/gov/execute-sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ database_id: databaseId, sql, params })
        });
        const data = await resp.json();
        if (!data.success) throw new Error(data.message || 'SQL执行失败');
        return data;
    }

    const dbType = (() => {
        const db = (databases || []).find(d => d.id === (currentGovTask && currentGovTask.database_id));
        return db ? db.type : '';
    })();

    function _govDownloadBlob(blob, filename) {
        const shared = _govShared();
        if (typeof shared.govDownloadBlob === 'function') return shared.govDownloadBlob(blob, filename);
        const a = document.createElement('a');
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * 解析格式化文本语法
     * 支持语法：
     *   **文字** - 加粗
     *   >文字 - 首行缩进 2 字符
     *   [f:字体,s:字号] - 指定字体和字号（可选，可嵌套）
     * @param {string} str - 输入字符串
     * @param {Object} defaultFont - 默认字体配置 {name: string, size: number}
     * @returns {{text: string, bold: Array<[number, number]>, indent: boolean, fonts: Array<[number, number, string, number]>}}
     */
    function parseFormatText(str, defaultFont = null) {
        if (typeof str !== 'string') return { text: String(str ?? ''), bold: [], indent: false, fonts: [], lines: [], defaultFont: defaultFont || { name: '仿宋_GB2312', size: 16 } };

        const df = defaultFont || { name: '仿宋_GB2312', size: 16 };

        // 逐行解析（与后端 parseFormatText 一致）
        const rawLines = str.split('\n');
        const lines = [];
        const allTextParts = [];
        const allBold = [];
        const allFonts = [];
        let textOffset = 0;

        for (const rawLine of rawLines) {
            const lineResult = _parseSingleLine(rawLine, df);
            lines.push(lineResult);

            // 合并到全局结果（兼容旧版）
            allTextParts.push(lineResult.text);
            for (const [bs, be] of lineResult.bold) {
                allBold.push([textOffset + bs, textOffset + be]);
            }
            for (const [fs, fe, fn, fz] of lineResult.fonts) {
                allFonts.push([textOffset + fs, textOffset + fe, fn, fz]);
            }
            textOffset += lineResult.text.length + 1; // +1 for \n
        }

        const finalText = allTextParts.join('\n');
        const firstIndent = lines.length > 0 && lines[0].indent;

        return { text: finalText, bold: allBold, indent: firstIndent, fonts: allFonts, lines, defaultFont: df };
    }

    /**
     * 逐行解析格式化文本（与后端 parseSingleLine 一致）
     */
    function _parseSingleLine(line, defaultFont) {
        let indent = false;
        let text = line;

        // 检测首行缩进语法（行首的 >）
        if (text.startsWith('>')) {
            indent = true;
            text = text.slice(1);
        }

        // 解析字体字号标记 [f:字体,s:字号]
        const fontMarkers = [];
        const fontRegex = /\[f:([^,\]]+),s:(\d+)\]/g;
        let fontMatch;
        while ((fontMatch = fontRegex.exec(text)) !== null) {
            const fontName = fontMatch[1].trim();
            const fontSize = parseInt(fontMatch[2], 10);
            const markerStart = fontMatch.index;
            const markerLength = fontMatch[0].length;
            const afterMarker = text.slice(markerStart + markerLength);
            const nextMarker = afterMarker.search(/\[f:|$/);
            const contentLength = nextMarker === -1 ? afterMarker.length : nextMarker;
            fontMarkers.push({ markerStart, markerLength, fontName, fontSize, contentLength });
        }

        // 移除字体标记
        let textWithoutFontMarkers = text.replace(fontRegex, '');

        // 计算字体位置
        const fonts = [];
        let offsetAdjustment = 0;
        for (const marker of fontMarkers) {
            const adjustedStart = marker.markerStart - offsetAdjustment;
            fonts.push([adjustedStart, adjustedStart + marker.contentLength, marker.fontName, marker.fontSize]);
            offsetAdjustment += marker.markerLength;
        }

        // 解析加粗语法 **文字**
        const bold = [];
        const result = [];
        let i = 0;
        text = textWithoutFontMarkers;
        while (i < text.length) {
            if (text[i] === '*' && text[i + 1] === '*') {
                const end = text.indexOf('**', i + 2);
                if (end !== -1) {
                    const boldText = text.slice(i + 2, end);
                    const startOffset = result.join('').length;
                    result.push(boldText);
                    bold.push([startOffset, startOffset + boldText.length]);
                    i = end + 2;
                } else {
                    // 未配对的 ** — 保留为纯文本（整对保留，不是只保留一个 *）
                    result.push('**');
                    i += 2;
                }
            } else {
                result.push(text[i]);
                i++;
            }
        }

        const finalText = result.join('');

        // 调整字体位置（因为加粗标记被移除）
        const adjustedFonts = fonts.map(([start, end, name, size]) => {
            let boldAdjustment = 0;
            for (const [boldStart, boldEnd] of bold) {
                if (boldStart <= start) boldAdjustment += 2; // 开始的 **
                if (boldEnd <= end) boldAdjustment += 2;     // 结束的 **
            }
            return [start - boldAdjustment, end - boldAdjustment, name, size];
        });

        return { text: finalText, bold, indent, fonts: adjustedFonts };
    }

    /**
     * 检查数据中是否包含格式标记
     * @param {any} data - 数据对象
     * @returns {boolean}
     */
    function _hasFormatMarkers(data) {
        if (!data || typeof data !== 'object') return false;
        for (const value of Object.values(data)) {
            if (typeof value === 'string') {
                if (value.includes('**') || value.startsWith('>') || value.includes('[f:')) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 对 docx XML 应用格式化
     * @param {string} xmlContent - word/document.xml 内容
     * @param {Object} formatMap - 格式映射 {占位符: {text, bold, indent, fonts, defaultFont}}
     * @returns {string} - 处理后的 XML
     */
    function _escapeXml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function _unescapeXml(text) {
        return text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
    }

    /**
     * 对 docx XML 应用格式化（正则方式，与后端 applyDocxFormatting 一致）
     * 支持：加粗、字体标记、首行缩进、szCs
     * 改进：支持逐行匹配 lines 数组，解决多行文本 includes 匹配失败的问题
     */
    function _applyDocxFormatting(xmlContent, formatMap) {
        if (!formatMap || Object.keys(formatMap).length === 0) return xmlContent;

        // 构建逐行匹配索引：lineText → { format, lineFormat }
        const lineMatchIndex = new Map();
        for (const [key, format] of Object.entries(formatMap)) {
            if (format.lines && format.lines.length > 0) {
                for (const lineFormat of format.lines) {
                    if (lineFormat.text && lineFormat.text.length > 0) {
                        lineMatchIndex.set(lineFormat.text, { format, lineFormat });
                    }
                }
            }
        }

        // 查找匹配的格式规则（优先逐行匹配，降级到整体 includes）
        const findMatchedFormat = (textContent) => {
            // 优先：逐行精确匹配
            if (lineMatchIndex.has(textContent)) {
                const { format, lineFormat } = lineMatchIndex.get(textContent);
                return { ...format, _lineFormat: lineFormat };
            }
            // 降级：整体 includes（兼容无 lines 数据的旧格式）
            for (const [key, format] of Object.entries(formatMap)) {
                if (format.text && textContent.includes(format.text)) {
                    return format;
                }
            }
            return null;
        };

        // 处理每个 <w:p> 段落
        return xmlContent.replace(/<w:p[^>]*>([\s\S]*?)<\/w:p>/g, (pMatch, pContent) => {
            let modifiedP = pContent;
            let hasModification = false;
            let indentApplied = false;

            // 处理段落中的 <w:r> 元素
            modifiedP = modifiedP.replace(/<w:r>(<w:rPr(?:\/>|>[\s\S]*?<\/w:rPr>)?)?<w:t[^>]*>([^<]*)<\/w:t><\/w:r>/g, (rMatch, rPr, text) => {
                const rawText = _unescapeXml(text);
                const matchedFormat = findMatchedFormat(rawText);
                if (!matchedFormat) return rMatch;

                hasModification = true;
                const defaultFont = matchedFormat.defaultFont || { name: '仿宋_GB2312', size: 16 };

                // 使用逐行格式（如果有），否则使用整体格式
                const effectiveFormat = matchedFormat._lineFormat || matchedFormat;

                // 处理首行缩进 — 标记以便外层处理
                if (effectiveFormat.indent && !indentApplied) {
                    indentApplied = true;
                }

                const hasBold = effectiveFormat.bold && effectiveFormat.bold.length > 0;
                const hasFonts = effectiveFormat.fonts && effectiveFormat.fonts.length > 0;

                if (hasBold || hasFonts) {
                    // 拆分成多个 <w:r> 节点
                    const segments = _splitTextByFormat(rawText, effectiveFormat);
                    const runs = segments.map(seg => {
                        const fontName = seg.fontName || defaultFont.name;
                        const fontSize = (typeof seg.fontSize === 'number' && !isNaN(seg.fontSize)) ? seg.fontSize : defaultFont.size;
                        let runXml = '<w:r><w:rPr>';
                        // 字体
                        runXml += `<w:rFonts w:ascii="${fontName}" w:eastAsia="${fontName}" w:hAnsi="${fontName}"/>`;
                        // 字号
                        runXml += `<w:sz w:val="${fontSize * 2}"/>`;
                        runXml += `<w:szCs w:val="${fontSize * 2}"/>`;
                        // 加粗
                        if (seg.bold) {
                            runXml += '<w:b/>';
                        }
                        runXml += '</w:rPr>';
                        // 文本
                        runXml += `<w:t${seg.text.startsWith(' ') || seg.text.endsWith(' ') ? ' xml:space="preserve"' : ''}>${_escapeXml(seg.text)}</w:t>`;
                        runXml += '</w:r>';
                        return runXml;
                    });
                    return runs.join('');
                } else {
                    // 只设置默认字体
                    let newRPr = '<w:rPr>';
                    newRPr += `<w:rFonts w:ascii="${defaultFont.name}" w:eastAsia="${defaultFont.name}" w:hAnsi="${defaultFont.name}"/>`;
                    newRPr += `<w:sz w:val="${defaultFont.size * 2}"/>`;
                    newRPr += `<w:szCs w:val="${defaultFont.size * 2}"/>`;
                    newRPr += '</w:rPr>';
                    return `<w:r>${newRPr}<w:t${rawText.startsWith(' ') || rawText.endsWith(' ') ? ' xml:space="preserve"' : ''}>${_escapeXml(rawText)}</w:t></w:r>`;
                }
            });

            // 处理首行缩进：在 <w:pPr> 中添加 <w:ind w:firstLine="640"/>
            if (indentApplied) {
                if (modifiedP.includes('<w:pPr>') || modifiedP.includes('<w:pPr/>')) {
                    if (modifiedP.includes('<w:ind')) {
                        modifiedP = modifiedP.replace(/<w:ind([^>]*)\/?>/g, (indMatch, attrs) => {
                            if (attrs.includes('w:firstLine')) return indMatch;
                            return `<w:ind${attrs} w:firstLine="640"/>`;
                        });
                    } else if (modifiedP.includes('<w:pPr>')) {
                        modifiedP = modifiedP.replace('<w:pPr>', '<w:pPr><w:ind w:firstLine="640"/>');
                    } else {
                        // <w:pPr/> 自闭合 → 替换为 <w:pPr><w:ind.../></w:pPr>
                        modifiedP = modifiedP.replace('<w:pPr/>', '<w:pPr><w:ind w:firstLine="640"/></w:pPr>');
                    }
                } else {
                    modifiedP = `<w:pPr><w:ind w:firstLine="640"/></w:pPr>` + modifiedP;
                }
            }

            return `<w:p>${modifiedP}</w:p>`;
        });
    }

    /**
     * 根据格式信息拆分文本
     * @param {string} text - 文本内容
     * @param {Object} format - 格式信息 {bold, fonts, defaultFont}
     * @returns {Array<{text: string, bold: boolean, fontName: string, fontSize: number}>}
     */
    function _splitTextByFormat(text, format) {
        const segments = [];
        const defaultFont = format.defaultFont || { name: '仿宋_GB2312', size: 16 };

        // 创建文本位置到格式的映射
        const formatMap = new Map();

        // 映射字体信息
        if (format.fonts && format.fonts.length > 0) {
            for (const [start, end, fontName, fontSize] of format.fonts) {
                for (let i = start; i < end; i++) {
                    formatMap.set(i, { fontName, fontSize });
                }
            }
        }

        // 映射加粗信息
        const boldSet = new Set();
        if (format.bold && format.bold.length > 0) {
            for (const [start, end] of format.bold) {
                for (let i = start; i < end; i++) {
                    boldSet.add(i);
                }
            }
        }

        // 按格式变化拆分文本
        if (text.length === 0) return segments;

        let currentSegment = {
            text: '',
            bold: boldSet.has(0),
            fontName: formatMap.has(0) ? formatMap.get(0).fontName : defaultFont.name,
            fontSize: formatMap.has(0) ? formatMap.get(0).fontSize : defaultFont.size
        };

        for (let i = 0; i < text.length; i++) {
            const charBold = boldSet.has(i);
            const charFont = formatMap.has(i) ? formatMap.get(i) : defaultFont;

            // 检查格式是否变化
            if (charBold !== currentSegment.bold ||
                charFont.fontName !== currentSegment.fontName ||
                charFont.fontSize !== currentSegment.fontSize) {
                // 保存当前片段
                if (currentSegment.text.length > 0) {
                    segments.push(currentSegment);
                }
                // 开始新片段
                currentSegment = {
                    text: text[i],
                    bold: charBold,
                    fontName: charFont.fontName,
                    fontSize: charFont.fontSize
                };
            } else {
                currentSegment.text += text[i];
            }
        }

        // 保存最后一个片段
        if (currentSegment.text.length > 0) {
            segments.push(currentSegment);
        }

        return segments;
    }

    /**
     * 处理数据中的格式标记，返回处理后的数据和格式映射
     * @param {Object} data - 原始数据
     * @param {Object} defaultFont - 默认字体配置 {name: string, size: number}
     * @returns {{data: Object, formatMap: Object}}
     */
    function _processFormatData(data, defaultFont = null) {
        if (!data || typeof data !== 'object') return { data, formatMap: {} };

        const formatMap = {};
        const processedData = {};

        for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'string' && (value.includes('**') || value.startsWith('>') || value.includes('[f:'))) {
                const parsed = parseFormatText(value, defaultFont);
                processedData[key] = parsed.text;
                formatMap[key] = parsed;
            } else {
                processedData[key] = value;
            }
        }

        return { data: processedData, formatMap };
    }

    function _govCsvEscapeCell(val) {
        if (typeof window.govCsvEscapeCell === 'function') return window.govCsvEscapeCell(val);
        if (typeof globalThis.govCsvEscapeCell === 'function') return globalThis.govCsvEscapeCell(val);
        const s = val === null || val === undefined ? '' : String(val);
        if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    const showTable = (data) => {
        if (!Array.isArray(data)) {
            logLines.push('__TABLE__:[]');
            return;
        }
        try {
            const jsonStr = JSON.stringify(data);
            logLines.push(`__TABLE__:${jsonStr}`);
        } catch (e) {
            logLines.push(`__TABLE__:[] // Error serializing data: ${e.message}`);
        }
    };

    return {
        log(...args) {
            logLines.push(args.map(a => {
                if (a === null) return 'null';
                if (a === undefined) return 'undefined';
                if (typeof a === 'object') return JSON.stringify(a);
                return String(a);
            }).join(' '));
        },
        getDefaultFont() {
            // 返回默认字体配置，可在代码中覆盖：gov.fillWordTemplate(tpl, data, fn, {name:'黑体',size:18})
            return { name: '仿宋_GB2312', size: 16 };
        },
        showTable,
        table: showTable,
        getDbType() {
            return dbType;
        },
        getDatabases() {
            return (databases || []).map(d => ({ id: d.id, name: d.name, type: d.type }));
        },
        async readExcel(file) {
            if (!file) throw new Error('缺少文件');
            const arrayBuffer = await file.arrayBuffer();
            const data = new Uint8Array(arrayBuffer);
            const wb = XLSX.read(data, { type: 'array' });
            if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
                throw new Error('Excel读取失败: 未找到工作表');
            }
            return wb;
        },
        async readCSV(text) {
            if (!text) throw new Error('缺少文本内容');
            return Papa.parse(text, { header: false }).data;
        },
        async readWord(file) {
            if (!file) throw new Error('缺少文件');
            const filename = (file.name || '').toLowerCase();
            let docxFile = file;
            if (filename.endsWith('.doc') || filename.endsWith('.wps')) {
                // 通过后端 API 转换 .doc/.wps → .docx，与后端 runner 行为一致
                const formData = new FormData();
                formData.append('file', file, file.name);
                const resp = await fetchWithAuth(`${API_BASE}/api/v1/gov/convert-word`, {
                    method: 'POST',
                    body: formData
                }, 60000);
                if (!resp.ok) {
                    const errData = await resp.json().catch(() => ({}));
                    throw new Error(errData.message || '.doc/.wps 格式转换失败');
                }
                const blob = await resp.blob();
                const baseName = file.name.replace(/\.[^.]+$/, '');
                docxFile = new File([blob], baseName + '.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
            }
            const arrayBuffer = await docxFile.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer });
            return { value: result.value };
        },
        async querySQL(sql, params) {
            if (!dbId) throw new Error('请先选择治理任务关联的数据库');
            const result = await _runSQL(dbId, sql, params || []);
            return result.data || [];
        },
        async executeSQL(sql, params) {
            if (!dbId) throw new Error('请先选择治理任务关联的数据库');
            const result = await _runSQL(dbId, sql, params || []);
            return result.rows_affected || 0;
        },
        async querySQLForDb(databaseId, sql, params) {
            const result = await _runSQL(databaseId, sql, params || []);
            return result.data || [];
        },
        async executeSQLForDb(databaseId, sql, params) {
            const result = await _runSQL(databaseId, sql, params || []);
            return result.rows_affected || 0;
        },
        // 调用 AI 接口；会自动携带 AI 配置的 URL/API Key/超时等参数
        async callAI(prompt) {
            // AI 生成可能较慢，给180秒超时（与后端runner一致）
            const resp = await fetchWithAuth(`${API_BASE}/api/v1/agent/completion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            }, 180000);
            const data = await resp.json();
            if (!data.success) throw new Error(data.message || 'AI 调用失败');
            return data.content || '';
        },
        async fillWordTemplate(templateFile, data, outputFilename, defaultFont = null) {
            await ensureGovLibsLoaded();
            const effectiveDefaultFont = defaultFont || this.getDefaultFont();
            if (!window.PizZip) throw new Error('PizZip 未加载');
            const DocxCtor = _govGetDocxtemplaterClass();
            if (!DocxCtor) throw new Error('Docxtemplater 未加载');
            const fileObj = await _resolveGovTemplateFile(templateFile);
            const buf = await fileObj.arrayBuffer();
            const zip = new window.PizZip(buf);
            
            // 修复模板 XML 中的常见结构问题（WPS 生成的模板可能有嵌套/重复标签）
            const docXmlEntry = zip.file('word/document.xml');
            if (docXmlEntry) {
                let fixedXml = docXmlEntry.asText();
                // 修复1: 删除连续的 </w:p></w:p>（空嵌套段落）→ 只保留一个 </w:p>
                fixedXml = fixedXml.replace(/<\/w:p><\/w:p>/g, '</w:p>');
                // 修复2: </w:r> 后直接跟 <w:p>（内层段落嵌套在外层段落中）→ 补上 </w:p>
                fixedXml = fixedXml.replace(/<\/w:r><w:p>/g, '</w:r></w:p><w:p>');
                zip.file('word/document.xml', fixedXml);
            }
            
            // 检查是否有格式标记
            const hasFormatting = _hasFormatMarkers(data);
            let processedData = data;
            let formatMap = {};
            
            if (hasFormatting) {
                const processed = _processFormatData(data, effectiveDefaultFont);
                processedData = processed.data;
                formatMap = processed.formatMap;
            }
            
            const doc = new DocxCtor(zip, { paragraphLoop: true, linebreaks: true });
            doc.setData(processedData || {});
            doc.render();
            
            let outputZip = doc.getZip();
            
            // 如果有格式标记，后处理 XML
            if (hasFormatting && Object.keys(formatMap).length > 0) {
                const documentXml = outputZip.file('word/document.xml');
                if (documentXml) {
                    const xmlContent = documentXml.asText();
                    const formattedXml = _applyDocxFormatting(xmlContent, formatMap);
                    outputZip.file('word/document.xml', formattedXml);
                }
            }
            
            const blob = outputZip.generate({
                type: 'blob',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            });
            const base = outputFilename || 'output.docx';
            const outName = /\.docx$/i.test(base) ? base : `${base}.docx`;
            _govDownloadBlob(blob, outName);
        },
        async fillExcelTemplate(templateFile, data, outputFilename) {
            if (typeof XLSX === 'undefined' || !XLSX.utils || !XLSX.writeFile) throw new Error('XLSX 未加载');
            if (!data || typeof data !== 'object') throw new Error('data 必须为对象');
            const fileObj = await _resolveGovTemplateFile(templateFile);
            const wb = await this.readExcel(fileObj);
            const flat = _govDataIsFlatCellMap(XLSX, data);
            if (flat) {
                const sn = wb.SheetNames[0];
                _govApplyCellMapToSheet(XLSX, wb.Sheets[sn], data);
            } else {
                for (const [sheetName, cells] of Object.entries(data)) {
                    if (!cells || typeof cells !== 'object' || Array.isArray(cells)) continue;
                    const ws = wb.Sheets[sheetName];
                    if (!ws) throw new Error(`工作表不存在: ${sheetName}`);
                    _govApplyCellMapToSheet(XLSX, ws, cells);
                }
            }
            const base = outputFilename || 'output.xlsx';
            const outName = /\.xlsx?$/i.test(base) ? base : `${base}.xlsx`;
            XLSX.writeFile(wb, outName);
        },
        writeExcel(filename, data, options) {
            if (!filename) throw new Error('缺少文件名');
            if (typeof XLSX === 'undefined' || !XLSX.utils || !XLSX.writeFile) throw new Error('XLSX 未加载');
            const opts = options || {};
            const sheetName = String(opts.sheetName || 'Sheet1').slice(0, 31);
            let ws;
            if (!data || !data.length) {
                ws = XLSX.utils.aoa_to_sheet([[]]);
            } else if (Array.isArray(data[0])) {
                ws = XLSX.utils.aoa_to_sheet(data);
            } else {
                ws = XLSX.utils.json_to_sheet(data);
            }
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
            const outName = /\.xlsx?$/i.test(filename) ? filename : `${filename}.xlsx`;
            XLSX.writeFile(wb, outName);
        },
        writeCSV(filename, data) {
            if (!filename) throw new Error('缺少文件名');
            if (!Array.isArray(data)) throw new Error('data 必须为数组');
            const lines = data.map(row => {
                if (!Array.isArray(row)) throw new Error('CSV 数据必须为二维数组');
                return row.map(_govCsvEscapeCell).join(',');
            });
            const csv = lines.join('\r\n');
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
            const outName = /\.csv$/i.test(filename) ? filename : `${filename}.csv`;
            _govDownloadBlob(blob, outName);
        },
        writeText(filename, content) {
            if (!filename) throw new Error('缺少文件名');
            const text = content === undefined || content === null ? '' : String(content);
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            _govDownloadBlob(blob, filename);
        },
        writeJSON(filename, data) {
            if (!filename) throw new Error('缺少文件名');
            const text = JSON.stringify(data, null, 2);
            const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
            const outName = /\.json$/i.test(filename) ? filename : `${filename}.json`;
            _govDownloadBlob(blob, outName);
        },
        /**
         * 解析 Word 文档结构，识别公文格式的标题层级、段落、表格等。
         * @param {File|Blob} file - Word 文件对象
         * @param {Object} options - 可选配置 { maxTextLength?: number }
         * @returns {Promise<{title: string, sections: Array, tables: Array, rawText: string}>}
         */
        async parseWordStructure(file, options = {}) {
            if (!file) throw new Error('缺少文件');
            const filename = (file.name || '').toLowerCase();
            let docxFile = file;
            if (filename.endsWith('.doc') || filename.endsWith('.wps')) {
                // 通过后端 API 转换 .doc/.wps → .docx，与后端 runner 行为一致
                const formData = new FormData();
                formData.append('file', file, file.name);
                const resp = await fetchWithAuth(`${API_BASE}/api/v1/gov/convert-word`, {
                    method: 'POST',
                    body: formData
                }, 60000);
                if (!resp.ok) {
                    const errData = await resp.json().catch(() => ({}));
                    throw new Error(errData.message || '.doc/.wps 格式转换失败');
                }
                const blob = await resp.blob();
                const baseName = file.name.replace(/\.[^.]+$/, '');
                docxFile = new File([blob], baseName + '.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
            }
            const arrayBuffer = await docxFile.arrayBuffer();
            
            // 使用 PizZip 直接从 XML 提取文本（与后端 runner 一致）
            await ensureGovLibsLoaded();
            if (!window.PizZip) throw new Error('PizZip 未加载');
            const buf = new Uint8Array(arrayBuffer);
            const zip = new window.PizZip(buf);
            const docXml = zip.file('word/document.xml');
            if (!docXml) throw new Error('无效的 docx 文件: 缺少 word/document.xml');
            const xml = docXml.asText() || '';
            
            // 按段落提取文本（每个 <w:p> 对应一个段落，用换行分隔）
            const paragraphRegex = /<w:p[^>]*>([\s\S]*?)<\/w:p>/g;
            const extractedParagraphs = [];
            let pMatch;
            while ((pMatch = paragraphRegex.exec(xml)) !== null) {
                const pXml = pMatch[1];
                const tMatches = pXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
                const text = tMatches.map(m => {
                    const m2 = m.match(/<w:t[^>]*>([^<]*)<\/w:t>/);
                    return m2 ? m2[1] : '';
                }).join('');
                if (text.trim()) {
                    extractedParagraphs.push(text);
                }
            }
            const rawText = extractedParagraphs.join('\n');
            const maxLen = options.maxTextLength || 50000;
            const text = rawText.length > maxLen ? rawText.slice(0, maxLen) : rawText;

            // ===== 扩展公文标题正则模式 =====
            // 公文格式支持：
            // 1. 一级标题：一、二、三、... （中文数字+顿号）
            // 2. 二级标题：（一）（二）（三）... （中文数字+括号）
            // 3. 三级标题：1. 2. 3. ... （阿拉伯数字+点/顿号）
            // 4. 四级标题：（1）（2）（3）... （阿拉伯数字+括号）
            // 5. 五级标题：第一章、第二章、... （阿拉伯数字+章节）
            // 6. 条目式：第1条、第2条、... （第+数字+条）
            // 7. 无序列表：• xxx （项目符号）
            // 8. 其他变体：１．、(一)、(１) 等全角/半角混合
            const titlePatterns = [
                /^[一二三四五六七八九十]+、[^\n]+/,                    // 一、标题
                /^（[一二三四五六七八九十]+）[^\n]+/,                  // （一）标题
                /^\d+[\.、．：][^\n]+/,                                 // 1. 标题 或 1、标题
                /^（\d+）[^\n]+/,                                      // （1）标题
                /^[（\(][一二三四五六七八九十\d]+[）\)][^\n]+/,        // 混合括号
                /^第[一二三四五六七八九十\d]+章[^\n]*/,                // 第一章、第二章
                /^第[一二三四五六七八九十\d]+条[^\n]*/,                // 第1条、第2条
                /^[•●○◆■★][\s　][^\n]+/,                             // • xxx 无序列表
                /^[\u25A0\u25B2\u25CB\u25CF][\s　][^\n]+/,            // ■ ★ ◆ ● ○ 无序列表变体
                /^[\d]+\.[\s　]+[^\n]+/,                              // 1. xxx 数字点开头
                /^[\(（]?[a-zA-Z0-9]+[\)）]?[\.、：\s　]+[^\n]+/       // a. A. (1) 等字母数字编号
            ];

            // 无序列表符号模式（用于识别内容行）
            const bulletPattern = /^[•●○◆■★\u25A0\u25B2\u25CB\u25CF][\s　]+(.+)$/;

            // 更健壮的行分割：处理各种换行符和不可见字符
            const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            const sections = [];
            const tables = [];
            let currentSection = null;
            let title = '';

            // 尝试识别文档标题（第一个非空行，通常是大标题）
            for (let i = 0; i < Math.min(10, lines.length); i++) {
                const line = lines[i];
                if (line && line.length > 2 && line.length < 100) {
                    // 检查是否是章节标题
                    let isChapterTitle = false;
                    for (const pattern of titlePatterns) {
                        if (pattern.test(line)) {
                            isChapterTitle = true;
                            break;
                        }
                    }
                    if (!isChapterTitle) {
                        title = line;
                        break;
                    }
                }
            }

            // 解析章节和段落
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line) continue;

                let matchedLevel = 0;
                let matchedTitle = '';

                function splitInlineTitleContent(prefix, rest) {
                    const text = (rest || '').trim();
                    if (!text) {
                        return { title: prefix, paragraphs: [] };
                    }

                    const colonIndex = text.search(/[：:]/);
                    if (colonIndex > 0) {
                        const titlePart = text.slice(0, colonIndex).trim();
                        const contentPart = text.slice(colonIndex + 1).trim();
                        return {
                            title: `${prefix}${titlePart}`,
                            paragraphs: contentPart ? [contentPart] : []
                        };
                    }

                    return {
                        title: `${prefix}${text}`,
                        paragraphs: []
                    };
                }

                // 检测一级标题：一、二、三、
                const m1 = line.match(/^([一二三四五六七八九十]+)、(.*)$/);
                if (m1) {
                    if (currentSection) sections.push(currentSection);
                    currentSection = {
                        level: 1,
                        title: `${m1[1]}、${(m1[2] || '').trim()}`.trim(),
                        paragraphs: []
                    };
                    continue;
                }

                // 检测二级标题：（一）（二）
                const m2 = line.match(/^（([一二三四五六七八九十]+)）(.*)$/);
                if (m2) {
                    if (currentSection) sections.push(currentSection);
                    currentSection = {
                        level: 2,
                        title: `（${m2[1]}）${(m2[2] || '').trim()}`.trim(),
                        paragraphs: []
                    };
                    continue;
                }

                // 检测三级标题：1. 2. 或 1、2、
                const m3 = line.match(/^(\d+)([\.、．])(.*)$/);
                if (m3) {
                    if (currentSection) sections.push(currentSection);
                    const inline = splitInlineTitleContent(`${m3[1]}${m3[2]}`, m3[3]);
                    currentSection = {
                        level: 3,
                        title: inline.title,
                        paragraphs: inline.paragraphs
                    };
                    continue;
                }

                // 检测四级标题：（1）（2）
                const m4 = line.match(/^（(\d+)）(.*)$/);
                if (m4) {
                    if (currentSection) sections.push(currentSection);
                    const inline = splitInlineTitleContent(`（${m4[1]}）`, m4[2]);
                    currentSection = {
                        level: 4,
                        title: inline.title,
                        paragraphs: inline.paragraphs
                    };
                    continue;
                }

                // ===== 新增：检测更多公文标题格式 =====

                // 检测第一章、第二章...（阿拉伯数字章节）
                const mChapter = line.match(/^第(\d+)章[：:\s]*(.*)$/);
                if (mChapter) {
                    if (currentSection) sections.push(currentSection);
                    currentSection = {
                        level: 1,
                        title: `第${mChapter[1]}章 ${(mChapter[2] || '').trim()}`.trim(),
                        paragraphs: []
                    };
                    continue;
                }

                // 检测第一章、第二章...（中文数字章节）
                const mChapterCN = line.match(/^第([一二三四五六七八九十]+)章[：:\s]*(.*)$/);
                if (mChapterCN) {
                    if (currentSection) sections.push(currentSection);
                    currentSection = {
                        level: 1,
                        title: `第${mChapterCN[1]}章 ${(mChapterCN[2] || '').trim()}`.trim(),
                        paragraphs: []
                    };
                    continue;
                }

                // 检测第1条、第2条...（条目式）
                const mArticle = line.match(/^第(\d+)条[：:\s]*(.*)$/);
                if (mArticle) {
                    if (currentSection) sections.push(currentSection);
                    currentSection = {
                        level: 2,
                        title: `第${mArticle[1]}条 ${(mArticle[2] || '').trim()}`.trim(),
                        paragraphs: []
                    };
                    continue;
                }

                // 检测第一条、第二条...（中文数字条目）
                const mArticleCN = line.match(/^第([一二三四五六七八九十]+)条[：:\s]*(.*)$/);
                if (mArticleCN) {
                    if (currentSection) sections.push(currentSection);
                    currentSection = {
                        level: 2,
                        title: `第${mArticleCN[1]}条 ${(mArticleCN[2] || '').trim()}`.trim(),
                        paragraphs: []
                    };
                    continue;
                }

                // 检测无序列表：• xxx（作为内容节点，层级为5）
                const mBullet = line.match(bulletPattern);
                if (mBullet) {
                    // 无序列表作为内容节点，如果有父节点则作为子节点
                    const bulletContent = mBullet[1] || line;
                    if (currentSection) {
                        // 将无序列表项添加为独立的子节点或段落
                        currentSection.paragraphs.push(line);
                    } else {
                        // 没有父节点时，创建一个内容节点
                        if (currentSection) sections.push(currentSection);
                        currentSection = {
                            level: 5,
                            title: bulletContent.trim().slice(0, 50), // 取前50字符作为标题
                            paragraphs: [line]
                        };
                    }
                    continue;
                }

                // 检测半角括号格式：(1) (2) 或 (一) (二)
                const mParenHalf = line.match(/^\((\d+)\)[\s]*(.*)$/);
                if (mParenHalf) {
                    if (currentSection) sections.push(currentSection);
                    const inline = splitInlineTitleContent(`(${mParenHalf[1]})`, mParenHalf[2]);
                    currentSection = {
                        level: 4,
                        title: inline.title,
                        paragraphs: inline.paragraphs
                    };
                    continue;
                }

                const mParenHalfCN = line.match(/^\(([一二三四五六七八九十]+)\)[\s]*(.*)$/);
                if (mParenHalfCN) {
                    if (currentSection) sections.push(currentSection);
                    currentSection = {
                        level: 2,
                        title: `(${mParenHalfCN[1]}) ${(mParenHalfCN[2] || '').trim()}`.trim(),
                        paragraphs: []
                    };
                    continue;
                }

                // 检测字母编号：a. b. c. 或 A. B. C.
                const mLetter = line.match(/^([a-zA-Z])[\.、．：][\s]*(.*)$/);
                if (mLetter) {
                    if (currentSection) sections.push(currentSection);
                    currentSection = {
                        level: 4,
                        title: `${mLetter[1]}. ${(mLetter[2] || '').trim()}`.trim(),
                        paragraphs: []
                    };
                    continue;
                }

                // 非标题行：添加到当前段落
                if (currentSection) {
                    if (line.length > 0) {
                        currentSection.paragraphs.push(line);
                    }
                } else {
                    // 还没有遇到标题，可能是前言
                    if (!sections.find(s => s.level === 0)) {
                        sections.push({ level: 0, title: '前言', paragraphs: [line] });
                        currentSection = sections[sections.length - 1];
                    } else if (sections.length > 0) {
                        sections[sections.length - 1].paragraphs.push(line);
                    }
                }

                // 简单的表格检测：连续包含多个制表符或 | 分隔的行
                if (line.includes('\t') || line.includes('|')) {
                    const cells = line.split(/[\t|]+/).filter(c => c.trim());
                    if (cells.length >= 2) {
                        // 尝试识别表格
                        const lastTable = tables.length > 0 ? tables[tables.length - 1] : null;
                        if (lastTable && lastTable._building) {
                            lastTable.rows.push(cells);
                        } else {
                            tables.push({
                                headers: cells,
                                rows: [],
                                _building: true
                            });
                        }
                    }
                } else {
                    // 结束表格构建
                    if (tables.length > 0) {
                        const lastTable = tables[tables.length - 1];
                        if (lastTable._building) {
                            delete lastTable._building;
                        }
                    }
                }
            }

            // 保存最后一个 section
            if (currentSection) {
                sections.push(currentSection);
            }

            // 清理表格对象中的临时属性
            for (const t of tables) {
                delete t._building;
            }

            // ===== 构建树形结构 =====
            // 将扁平的 sections 数组转换为层级树
            // 支持层级跳跃容错：自动降级处理（L1→L3 变为 L1→L2，L2→L4 变为 L2→L3）
            function buildTree(flatSections) {
                const root = { level: -1, title: 'ROOT', children: [], paragraphs: [] };
                const stack = [root]; // 栈顶是当前父节点

                for (const sec of flatSections) {
                    // 计算目标层级（检测是否需要自动降级）
                    let targetLevel = sec.level;
                    const currentParentLevel = stack[stack.length - 1].level;
                    
                    // 层级自动降级规则：
                    // - L1 后直接出现 L3 → 降为 L2
                    // - L1 后直接出现 L4 → 降为 L2
                    // - L2 后直接出现 L4 → 降为 L3
                    if (targetLevel > currentParentLevel + 1) {
                        // 跳跃超过1级，自动降级到合理层级
                        targetLevel = currentParentLevel + 1;
                    }
                    
                    // 使用降级后的层级构建树
                    sec.level = targetLevel;
                    
                    // 情况1：正常层级递增或同级，弹出栈中 level >= 当前的节点
                    // 情况2：层级跳跃（如 L1 → L3），需要找到合适的父节点
                    if (targetLevel > currentParentLevel + 1) {
                        // 层级跳跃：尝试找最近的高层级节点作为父节点
                        // 例如 L1 下出现 L3，应该挂在 L1 下，而不是报错
                        // 弹出直到找到 level < targetLevel 的节点
                        while (stack.length > 1 && stack[stack.length - 1].level >= targetLevel) {
                            stack.pop();
                        }
                    } else {
                        // 正常情况：弹出栈中 level >= 当前的节点
                        while (stack.length > 1 && stack[stack.length - 1].level >= targetLevel) {
                            stack.pop();
                        }
                    }
                    
                    const parent = stack[stack.length - 1];
                    const node = {
                        level: sec.level,
                        title: sec.title,
                        paragraphs: sec.paragraphs || [],
                        children: []
                    };
                    parent.children.push(node);
                    stack.push(node);
                }

                return root.children;
            }

            const sectionTree = buildTree(sections);

            const parsedResult = {
                title,
                sections: sectionTree,  // 树形结构
                sectionsFlat: sections, // 保留扁平结构供兼容
                tables,
                rawText: text
            };

            // 输出解析结果到执行日志
            logLines.push('=== 文档结构解析结果 ===');
            logLines.push(`标题: ${title || '(未识别)'}`);
            logLines.push(`章节数: ${sections.length}`);
            logLines.push(`表格数: ${tables.length}`);
            logLines.push('');
            logLines.push('--- 章节结构（树形） ---');
            function printTree(nodes, indent = '') {
                for (const node of nodes) {
                    logLines.push(`${indent}${node.title} (${node.paragraphs.length}段, ${node.children.length}子节点)`);
                    if (node.children.length > 0) {
                        printTree(node.children, indent + '  ');
                    }
                }
            }
            printTree(sectionTree);
            if (tables.length > 0) {
                logLines.push('');
                logLines.push('--- 表格预览 ---');
                for (let i = 0; i < tables.length; i++) {
                    const t = tables[i];
                    logLines.push(`表格${i + 1}: ${t.headers.join(' | ')} (${t.rows.length}行)`);
                }
            }
            logLines.push('');
            logLines.push('--- 完整 JSON ---');
            logLines.push(JSON.stringify({ title, sections, tables }, null, 2));

            return parsedResult;
        },

        // ===== 通用公文解析辅助方法 =====

        /**
         * 解析文件名，提取单位和日期
         * @param {string} name - 文件名
         * @param {Object} options - 可选配置 { datePattern?: RegExp }
         * @returns {{unit: string, date: string}}
         * 
         * 支持格式：
         *   2024年4月15日数据中心日报 → {unit: "数据中心", date: "2024年4月15日"}
         *   04月15日运维部日报 → {unit: "运维部", date: "04月15日"}
         */
        parseFilename(name, options = {}) {
            if (!name || typeof name !== 'string') return { unit: '', date: '' };
            
            const base = name.replace(/\.(docx?|DOCX?)$/i, '');
            const datePattern = options.datePattern || /^(\d{4})年(\d{1,2})月(\d{1,2})日/;
            const m = base.match(datePattern);
            
            if (m) {
                // 带年份的完整日期
                return {
                    unit: base.replace(datePattern, '').replace(/日报$/, '').trim() || base,
                    date: `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日`
                };
            }
            
            // 尝试匹配月日格式：04月15日
            const mdMatch = base.match(/^(\d{1,2})月(\d{1,2})日/);
            if (mdMatch) {
                return {
                    unit: base.replace(/^(\d{1,2})月(\d{1,2})日/, '').replace(/日报$/, '').trim() || base,
                    date: `${parseInt(mdMatch[1])}月${parseInt(mdMatch[2])}日`
                };
            }
            
            // 无法解析日期
            return { unit: base.replace(/日报$/, '').trim() || base, date: '' };
        },

        /**
         * 将树形结构转换为模板可用的 JSON 格式
         * @param {Array} nodes - parseWordStructure 返回的 sections 树形结构
         * @param {Object} options - 可选配置 { baseIndent?: number, paragraphsKey?: string }
         * @returns {Array} - 转换后的节点数组，每个节点包含 level, title, indent, paragraphs, children
         */
        treeToJSON(nodes, options = {}) {
            const baseIndent = options.baseIndent || 0;
            const paragraphsKey = options.paragraphsKey || 'paragraphs';
            
            const convert = (nodeList, parentLevel = 0) => {
                return nodeList.map(node => {
                    // 根据层级计算缩进
                    const indent = '  '.repeat(baseIndent + Math.max(0, node.level - 1));
                    
                    // 将 paragraphs 数组转换为模板可用的对象数组格式
                    const paragraphs = (node[paragraphsKey] || []).map(p => {
                        return { paragraph: typeof p === 'string' ? p : (p.paragraph || JSON.stringify(p)) };
                    });
                    
                    return {
                        level: node.level,
                        title: node.title,
                        indent: indent,
                        paragraphs: paragraphs,
                        children: node.children && node.children.length > 0 
                            ? convert(node.children, node.level) 
                            : []
                    };
                });
            };
            
            return convert(nodes);
        },

        /**
         * 统计树形结构信息
         * @param {Array} nodes - 树形节点数组
         * @returns {{total: number, maxDepth: number}}
         */
        countTree(nodes) {
            let total = 0;
            let maxDepth = 0;
            
            function walk(nodeList, depth) {
                for (const node of nodeList) {
                    total++;
                    maxDepth = Math.max(maxDepth, depth);
                    if (node.children && node.children.length > 0) {
                        walk(node.children, depth + 1);
                    }
                }
            }
            
            walk(nodes, 1);
            return { total, maxDepth };
        },
    };
}

/** 在浏览器中执行治理任务代码一次。 */
async function executeGovTaskInBrowserOnce(code, file, inputText, allFilesOverride) {
    const logLines = [];
    let status = 'success';
    let errorMsg = '';

    try {
        await ensureGovLibsLoaded();
        const uploaded = Array.isArray(allFilesOverride) ? allFilesOverride : (file ? [file] : (govSelectedFiles || []));
        const gov = createGovHelper(logLines, uploaded);
        const DocxCtor = _govGetDocxtemplaterClass();

        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const fn = new AsyncFunction('gov', 'currentGovTask', 'INPUT_FILE', 'INPUT_TEXT', 'XLSX', 'Papa', 'mammoth', 'PizZip', 'Docxtemplater', 'INPUT_FILES', code);
        const inputFiles = uploaded;
        const taskForRun = currentGovTask;
        await fn(gov, taskForRun, file || null, inputText || '', window.XLSX, window.Papa, window.mammoth, window.PizZip, DocxCtor, inputFiles);
    } catch (err) {
        status = 'error';
        errorMsg = err.message || String(err);
        logLines.push(`[错误] ${errorMsg}`);
    }

    const output = logLines.join('\n');
    let inputDesc = '';
    if (Array.isArray(allFilesOverride) && allFilesOverride.length) {
        inputDesc = `files (${allFilesOverride.length}): ${allFilesOverride.map(f => f.name).join('、')}`;
    } else if (file) {
        inputDesc = `file: ${file.name}`;
    } else if (inputText) {
        inputDesc = `text: ${inputText.substring(0, 50)}`;
    }

    if (currentGovTask) {
        const taskId = currentGovTask.id;
        try {
            await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${taskId}/save-log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status, output, error: errorMsg, input: inputDesc })
            });
        } catch (e) {
            console.error('保存治理日志失败', e);
        }
    }

    return { status, output, errorMsg, inputDesc };
}

async function executeGovTaskBatchInBrowser(code, files, inputText) {
    if (!currentGovTask || !files || files.length < 2) return;

    currentGovTask.status = 'running';
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    const container = document.getElementById('govTaskOutput');
    const results = [];
    const startedAt = Date.now();

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        container.innerHTML = `
            <div class="gov-log-entry">
                <div class="gov-log-header">
                    <span>批量处理 ${i + 1}/${files.length}?${escapeHtml(file.name)}</span>
                    <span class="gov-log-status running">运行中</span>
                </div>
            </div>`;

        const r = await executeGovTaskInBrowserOnce(code, file, inputText, [file]);
        results.push({ fileName: file.name, ...r });
    }

    const ok = results.filter(r => r.status === 'success').length;
    const fail = results.length - ok;
    const overallStatus = fail === 0 ? 'success' : 'error';
    const summaryLines = [
        `批量完成 共 ${results.length} 个文件 成功 ${ok}个 失败 ${fail}个`,
        ...results.map(r =>
            (r.status === 'success' ? '?' : '?') + ' ' + r.fileName + (r.errorMsg ? ' ? ' + r.errorMsg : '')
        )
    ];
    const summaryText = summaryLines.join('\n');
    const combinedOutput = results.map(r => `--- ${r.fileName} ---\n${r.output || ''}`).join('\n\n');

    currentGovTask.status = overallStatus;
    currentGovTask.last_output = summaryText + (combinedOutput ? '\n\n' + combinedOutput : '');
    currentGovTask.last_error = fail > 0 ? `${fail} 个文件执行失败` : '';
    currentGovTask.last_run_at = new Date().toISOString();
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    container.innerHTML = `
        <div class="gov-log-entry">
            <div class="gov-log-header">
                <span>${new Date().toLocaleString()} 耗时 ${durationSec}s</span>
                <span class="gov-log-status ${overallStatus}">批量结果 成功 ${ok} / 失败 ${fail}</span>
            </div>
            <div class="gov-log-input">共 ${results.length} 个文件 成功${ok}个 失败${fail}个</div>
            <div class="gov-log-output">${escapeHtml(summaryText)}</div>
            ${results.map(r => `
                <div class="gov-log-entry" style="margin-top:10px;border-top:1px solid rgba(0,0,0,0.08);padding-top:8px;">
                    <div class="gov-log-header">
                        <span>${escapeHtml(r.fileName)}</span>
                        <span class="gov-log-status ${r.status}">${r.status === 'success' ? '成功' : '失败'}</span>
                    </div>
                    ${r.inputDesc ? `<div class="gov-log-input">输入: ${escapeHtml(r.inputDesc)}</div>` : ''}
                    ${r.output ? `<div class="gov-log-output">${renderGovOutput(r.output)}</div>` : ''}
                    ${r.errorMsg ? `<div class="gov-log-error">${escapeHtml(r.errorMsg)}</div>` : ''}
                </div>
            `).join('')}
        </div>`;
}

async function executeGovTaskInBrowser(code, file, inputText, files) {
    if (!currentGovTask) return;

    currentGovTask.status = 'running';
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    const container = document.getElementById('govTaskOutput');
    container.innerHTML = '<div class="gov-log-entry"><div class="gov-log-header"><span>执行中...</span><span class="gov-log-status running">运行中</span></div></div>';

    const { status, output, errorMsg, inputDesc } = await executeGovTaskInBrowserOnce(code, file, inputText, files);

    currentGovTask.status = status;
    currentGovTask.last_output = output;
    currentGovTask.last_error = errorMsg;
    currentGovTask.last_run_at = new Date().toISOString();
    showGovTaskDetail(currentGovTask);
    renderGovTaskList();

    container.innerHTML = `
        <div class="gov-log-entry">
            <div class="gov-log-header">
                <span>${new Date().toLocaleString()}</span>
                <span class="gov-log-status ${status}">${status === 'success' ? '成功' : '失败'}</span>
            </div>
            ${inputDesc ? `<div class="gov-log-input">输入: ${escapeHtml(inputDesc)}</div>` : ''}
            ${output ? `<div class="gov-log-output">${renderGovOutput(output)}</div>` : ''}
            ${errorMsg ? `<div class="gov-log-error">${escapeHtml(errorMsg)}</div>` : ''}
        </div>
    `;

    // 前端执行完成后，通知后端保存结果并同步到分享页
    try {
        // 提取文件列表（兼容单文件和文件数组）
        let filesToUpload = [];
        if (file) {
            filesToUpload = [file];
        } else if (files && files.length > 0) {
            filesToUpload = files;
        }

        // 如果有文件且任务开启了分享，用 FormData 上传文件
        if (filesToUpload.length > 0 && currentGovTask.share_enabled && currentGovTask.share_token) {
            const formData = new FormData();
            formData.append('status', status);
            formData.append('output', output || '');
            formData.append('error', errorMsg || '');
            formData.append('input_text', inputText || '');
            formData.append('share_enabled', 'true');
            formData.append('share_token', currentGovTask.share_token);
            // 传 input_files 文件名数组，后端需要用这个来记录
            const inputFileNames = filesToUpload.map(f => f.name || f);
            formData.append('input_files', JSON.stringify(inputFileNames));
            for (const f of filesToUpload) {
                if (f instanceof File) {
                    formData.append('files', f);
                }
            }
            await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}/frontend-run`, {
                method: 'POST',
                body: formData
            });
        } else {
            // 无文件或未开启分享，只传 JSON
            const inputFileNames = filesToUpload.map(f => f.name || f);
            const shareEnabled = currentGovTask.share_enabled ? true : false;
            await fetchWithAuth(`${API_BASE}/api/v1/gov/tasks/${currentGovTask.id}/frontend-run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: status,
                    output: output,
                    error: errorMsg,
                    input_text: inputText,
                    input_files: inputFileNames,
                    share_enabled: shareEnabled,
                    share_token: currentGovTask.share_token || ''
                })
            });
        }
    } catch (e) {
        console.warn('同步前端执行结果到后端失败:', e);
    }
}

// ==================== gov API 接口 ====================

// Get GOV_SHARED from window/globalThis (defined in gov-shared.js)
// Use var so repeated script evaluation does not crash on redeclaration.
var GOV_SHARED_REF = window.__GOV_SHARED_REF__ || (window.__GOV_SHARED_REF__ = (window.GOV_SHARED || globalThis.GOV_SHARED || {}));
var GOV_API_SECTIONS_LOCAL = GOV_SHARED_REF.GOV_API_SECTIONS || [];
var GOV_API_DOCS_LOCAL = GOV_SHARED_REF.GOV_API_DOCS || GOV_API_SECTIONS_LOCAL;
var governanceFunctionsLocal = GOV_SHARED_REF.governanceFunctions || GOV_API_DOCS_LOCAL;

async function openGovApiHelp() {
    const modal = document.getElementById('govApiHelpModal');
    modal.style.display = 'flex';
    document.getElementById('govApiSearchInput').value = '';
    // 确保 gov-shared.js 已加载
    await ensureGovernanceScriptsLoaded();
    // 重新获取 governanceFunctions（加载后才有值）
    // 直接从 window 获取，gov-shared.js 会设置这些全局变量
    const funcs = window.governanceFunctions || window.GOV_API_DOCS || 
                  (window.GOV_SHARED && window.GOV_SHARED.governanceFunctions) || [];
    console.log('[openGovApiHelp] loaded funcs:', funcs.length, funcs);
    window.__govApiFunctions = funcs;
    renderGovApiDocs('');
    setTimeout(() => document.getElementById('govApiSearchInput').focus(), 100);
}

function closeGovApiHelp() {
    document.getElementById('govApiHelpModal').style.display = 'none';
}

function filterGovApiHelp(query) {
    renderGovApiDocs(query.trim().toLowerCase());
}

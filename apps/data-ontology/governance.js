async function govDownloadExampleSingle(path) {
    const safe = String(path || '').trim();
    if (!safe) return;
    const filename = safe.split('/').pop();
    const url = `${API_BASE}/api/data-ontology/governance/examples/${encodeURIComponent(filename)}`;
    const response = await fetchWithAuth(url);
    if (!response.ok) {
        showToast('下载失败', 'error');
        return;
    }
    const blob = await response.blob();
    const shared = window.GOV_SHARED || globalThis.GOV_SHARED || {};
    const download = typeof shared.govDownloadBlob === 'function'
        ? shared.govDownloadBlob
        : function (blob, filename) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            URL.revokeObjectURL(a.href);
        };
    download(blob, safe.split('/').pop() || 'example.docx');
}

async function govDownloadExampleZip(files) {
    const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/examples/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: files })
    });
    const ct = response.headers.get('Content-Type') || '';
    if (!response.ok || ct.includes('application/json')) {
        try {
            const j = await response.json();
            showToast((j && j.message) || '下载失败', 'error');
        } catch (e) {
            showToast('下载失败', 'error');
        }
        return;
    }
    const blob = await response.blob();
    const shared = window.GOV_SHARED || globalThis.GOV_SHARED || {};
    const download = typeof shared.govDownloadBlob === 'function'
        ? shared.govDownloadBlob
        : function (blob, filename) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            URL.revokeObjectURL(a.href);
        };
    download(blob, 'governance-examples.zip');
}

function govNormalizeExamplePath(item) {
    if (!item) return '';
    const raw = typeof item === 'string' ? item : (item.path || item.Path || '');
    const safe = String(raw || '').trim();
    return safe ? safe.split(/[\/]/).pop() : '';
}

function govNormalizeExampleName(item) {
    if (!item) return '';
    const raw = typeof item === 'string' ? item : (item.name || item.Name || '');
    const safe = String(raw || '').trim();
    return safe ? safe.split(/[\/]/).pop() : '';
}

function govDownloadExamplesForTask(taskId) {
    const task = govTasks.find(t => t.id === taskId);
    const list = task && task.example_files;
    if (!list || !list.length) return;
    if (list.length === 1) {
        govDownloadExampleSingle(govNormalizeExamplePath(list[0]));
    } else {
        const files = list.map(item => ({
            name: govNormalizeExampleName(item) || govNormalizeExamplePath(item),
            path: govNormalizeExamplePath(item)
        })).filter(item => item.path);
        govDownloadExampleZip(files);
    }
}

async function govReloadExamplesFromEmbed() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/examples/reload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ include_js: true })
        });
        const data = await response.json();
        if (!data.success) {
            showToast(data.message || '刷新失败', 'error');
            return;
        }
        await loadGovernanceTasks();
        if (currentGovTask) {
            const t = govTasks.find(x => x.id === currentGovTask.id);
            if (t) {
                currentGovTask = t;
                showGovTaskDetail(t);
            }
        }
        const n = data.updated_tasks != null ? data.updated_tasks : 0;
        showToast(n > 0 ? `已同步 ${n} 个预置任务的示例元数据` : '已是最新，无需更新', 'success');
    } catch (e) {
        showToast('刷新失败', 'error');
    }
}

async function govDownloadExampleSingle(path) {
    const safe = String(path || '').trim();
    if (!safe) return;
    const url = `${API_BASE}/api/data-ontology/governance/examples/${encodeURIComponent(safe)}`;
    const response = await fetchWithAuth(url);
    if (!response.ok) {
        alert('下载失败');
        return;
    }
    const blob = await response.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safe.split('/').pop() || 'example.docx';
    a.click();
    URL.revokeObjectURL(a.href);
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
            alert((j && j.message) || '下载失败');
        } catch (e) {
            alert('下载失败');
        }
        return;
    }
    const blob = await response.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'governance-examples.zip';
    a.click();
    URL.revokeObjectURL(a.href);
}

function govDownloadExamplesForTask(taskId) {
    const task = govTasks.find(t => t.id === taskId);
    const list = task && task.example_files;
    if (!list || !list.length) return;
    if (list.length === 1) {
        govDownloadExampleSingle(list[0].path);
    } else {
        govDownloadExampleZip(list);
    }
}

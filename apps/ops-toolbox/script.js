// 标签切换功能
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        
        // 切换标签按钮激活状态
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // 切换面板显示
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
        document.getElementById(`${tab}-panel`).classList.add('active');
    });
});

// ===== SSH终端功能（真实 WebSocket 后端代理）=====
let sshWs = null;
let sshTerm = null;
let sshFitAddon = null;
let sshConnected = false;

function sshSetStatus(msg, cls) {
    const el = document.getElementById('ssh-connect-status');
    el.textContent = msg;
    el.className = 'connect-status' + (cls ? ' ' + cls : '');
}

function initXterm() {
    if (sshTerm) { sshTerm.dispose(); sshTerm = null; }
    const container = document.getElementById('xterm-container');
    container.innerHTML = '';
    sshTerm = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
        theme: { background: '#1a1a2e', foreground: '#e8e8f0', cursor: '#a0a0ff' },
        scrollback: 5000,
        allowTransparency: false,
    });
    sshFitAddon = new FitAddon.FitAddon();
    sshTerm.loadAddon(sshFitAddon);
    sshTerm.open(container);
    setTimeout(() => { sshFitAddon.fit(); }, 50);

    sshTerm.onData(data => {
        if (sshWs && sshWs.readyState === WebSocket.OPEN) {
            sshWs.send(data);
        }
    });
    sshTerm.onResize(({ cols, rows }) => {
        if (sshWs && sshWs.readyState === WebSocket.OPEN) {
            sshWs.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
    });

    // 窗口 resize 时自动调整终端尺寸
    const resizeObserver = new ResizeObserver(() => {
        if (sshFitAddon) sshFitAddon.fit();
    });
    resizeObserver.observe(container);
}

document.getElementById('ssh-connect').addEventListener('click', () => {
    const host = document.getElementById('ssh-host').value.trim();
    const port = document.getElementById('ssh-port').value.trim() || '22';
    const user = document.getElementById('ssh-user').value.trim();
    const password = document.getElementById('ssh-password').value;

    if (!host || !user) {
        sshSetStatus('请填写主机地址和用户名', 'error');
        return;
    }

    sshSetStatus('连接中...', '');
    document.getElementById('ssh-connect').disabled = true;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws/ops/ssh?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}&user=${encodeURIComponent(user)}&password=${encodeURIComponent(password)}`;

    document.getElementById('terminal-container').style.display = 'block';
    initXterm();
    sshTerm.writeln(`\x1b[33m正在连接 ${user}@${host}:${port} ...\x1b[0m`);

    sshWs = new WebSocket(wsUrl);
    sshWs.binaryType = 'arraybuffer';

    sshWs.onopen = () => {
        sshConnected = true;
        document.getElementById('ssh-connect').style.display = 'none';
        document.getElementById('ssh-connect').disabled = false;
        document.getElementById('ssh-disconnect').style.display = 'inline-block';
        document.getElementById('terminal-status').textContent = `● ${user}@${host}`;
        document.getElementById('terminal-status').className = 'status-connected';
        sshSetStatus('', '');
        // 发送初始终端尺寸
        const dims = sshFitAddon.proposeDimensions();
        if (dims) sshWs.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        sshTerm.focus();
    };

    sshWs.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
            sshTerm.write(new Uint8Array(event.data));
        } else {
            sshTerm.write(event.data);
        }
    };

    sshWs.onclose = () => {
        sshConnected = false;
        document.getElementById('ssh-connect').style.display = 'inline-block';
        document.getElementById('ssh-connect').disabled = false;
        document.getElementById('ssh-disconnect').style.display = 'none';
        document.getElementById('terminal-status').textContent = '● 已断开';
        document.getElementById('terminal-status').className = 'status-disconnected';
        if (sshTerm) sshTerm.writeln('\r\n\x1b[33m[连接已关闭]\x1b[0m');
    };

    sshWs.onerror = () => {
        sshSetStatus('连接失败', 'error');
        document.getElementById('ssh-connect').disabled = false;
        if (sshTerm) sshTerm.writeln('\r\n\x1b[31m[连接出错，请检查地址和凭据]\x1b[0m');
    };
});

document.getElementById('ssh-disconnect').addEventListener('click', () => {
    if (sshWs) { sshWs.close(); sshWs = null; }
});

document.getElementById('clear-terminal').addEventListener('click', () => {
    if (sshTerm) sshTerm.clear();
});

// ===== SFTP文件管理功能（真实后端 REST API）=====
let sftpConnected = false;
let sftpSessionId = null;
let sftpCurrentPath = '/';
let sftpSelectedFile = null; // 用于重命名

function sftpSetStatus(msg, cls) {
    const el = document.getElementById('sftp-connect-status');
    el.textContent = msg;
    el.className = 'connect-status' + (cls ? ' ' + cls : '');
}

document.getElementById('sftp-connect').addEventListener('click', async () => {
    const host = document.getElementById('sftp-host').value.trim();
    const port = document.getElementById('sftp-port').value.trim() || '22';
    const user = document.getElementById('sftp-user').value.trim();
    const password = document.getElementById('sftp-password').value;

    if (!host || !user) {
        sftpSetStatus('请填写主机地址和用户名', 'error');
        return;
    }

    const btn = document.getElementById('sftp-connect');
    btn.disabled = true;
    sftpSetStatus('连接中...', '');

    try {
        const res = await fetch('/api/ops/sftp/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, port, user, password })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        sftpSessionId = data.sessionId;
        sftpCurrentPath = data.currentPath || '/';
        sftpConnected = true;

        document.getElementById('sftp-connect-form').style.display = 'none';
        document.getElementById('sftp-container').style.display = 'block';
        document.getElementById('sftp-disconnect').style.display = 'inline-block';
        sftpSetStatus(`已连接 ${user}@${host}`, 'success');

        loadRemoteFiles(sftpCurrentPath);
        loadLocalFiles();
    } catch (err) {
        sftpSetStatus('连接失败: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
});

document.getElementById('sftp-disconnect').addEventListener('click', async () => {
    if (sftpSessionId) {
        await fetch('/api/ops/sftp/disconnect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session: sftpSessionId })
        }).catch(() => {});
        sftpSessionId = null;
    }
    sftpConnected = false;
    sftpCurrentPath = '/';
    document.getElementById('sftp-connect-form').style.display = 'block';
    document.getElementById('sftp-container').style.display = 'none';
    document.getElementById('sftp-disconnect').style.display = 'none';
    sftpSetStatus('', '');
    document.getElementById('sftp-connect').style.display = 'inline-block';
});

// 路径输入框按 Enter 跳转
document.getElementById('remote-path').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        loadRemoteFiles(e.target.value.trim() || '/');
    }
});

document.getElementById('refresh-remote').addEventListener('click', () => {
    if (sftpConnected) loadRemoteFiles(sftpCurrentPath);
});

// 新建文件夹
document.getElementById('sftp-mkdir').addEventListener('click', async () => {
    const name = prompt('请输入新文件夹名称:');
    if (!name || !name.trim()) return;
    const newPath = sftpCurrentPath.replace(/\/$/, '') + '/' + name.trim();
    try {
        const res = await fetch('/api/ops/sftp/mkdir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session: sftpSessionId, path: newPath })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        loadRemoteFiles(sftpCurrentPath);
    } catch (err) {
        alert('创建文件夹失败: ' + err.message);
    }
});

// 重命名（需先在列表中点选文件）
document.getElementById('sftp-rename-btn').addEventListener('click', async () => {
    if (!sftpSelectedFile) { alert('请先在文件列表中点击选中要重命名的文件'); return; }
    const newName = prompt('请输入新名称:', sftpSelectedFile);
    if (!newName || !newName.trim() || newName.trim() === sftpSelectedFile) return;
    const dir = sftpCurrentPath.replace(/\/$/, '');
    try {
        const res = await fetch('/api/ops/sftp/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session: sftpSessionId,
                oldPath: dir + '/' + sftpSelectedFile,
                newPath: dir + '/' + newName.trim()
            })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        sftpSelectedFile = null;
        loadRemoteFiles(sftpCurrentPath);
    } catch (err) {
        alert('重命名失败: ' + err.message);
    }
});

async function loadRemoteFiles(remotePath) {
    if (!sftpSessionId) return;
    sftpCurrentPath = remotePath;
    document.getElementById('remote-path').value = remotePath;

    const list = document.getElementById('remote-file-list');
    list.innerHTML = '<div class="file-empty">加载中...</div>';

    try {
        const res = await fetch(`/api/ops/sftp/list?session=${sftpSessionId}&path=${encodeURIComponent(remotePath)}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        sftpCurrentPath = data.path;
        document.getElementById('remote-path').value = sftpCurrentPath;
        list.innerHTML = '';

        if (data.files.length === 0) {
            list.innerHTML = '<div class="file-empty">空目录</div>';
            return;
        }

        data.files.forEach(file => {
            const item = createRemoteFileItem(file);
            list.appendChild(item);
        });
    } catch (err) {
        list.innerHTML = `<div class="file-empty" style="color:#e74c3c">加载失败: ${escHtml(err.message)}</div>`;
    }
}

function createRemoteFileItem(file) {
    const item = document.createElement('div');
    item.className = 'file-item';

    const main = document.createElement('div');
    main.className = 'file-item-main';
    main.innerHTML = `
        <div class="file-icon">${file.isDir ? '📁' : getFileIcon(file.name)}</div>
        <div class="file-info">
            <div class="file-name" title="${escHtml(file.name)}">${escHtml(file.name)}</div>
            <div class="file-size">${file.isDir ? '' : fmtSize(file.size)}${file.modTime ? (file.isDir ? '' : ' · ') + file.modTime : ''}</div>
        </div>`;

    main.addEventListener('click', () => {
        if (file.isDir) {
            let newPath;
            if (file.name === '..') {
                const parts = sftpCurrentPath.replace(/\/$/, '').split('/');
                parts.pop();
                newPath = parts.join('/') || '/';
            } else {
                newPath = sftpCurrentPath.replace(/\/$/, '') + '/' + file.name;
            }
            loadRemoteFiles(newPath);
        } else {
            // 点击文件 = 选中（用于重命名等操作）
            document.querySelectorAll('#remote-file-list .file-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
            sftpSelectedFile = file.name;
        }
    });

    const actions = document.createElement('div');
    actions.className = 'file-actions';

    if (!file.isDir && file.name !== '..') {
        const dlBtn = document.createElement('button');
        dlBtn.className = 'file-action-btn';
        dlBtn.textContent = '下载';
        dlBtn.onclick = (e) => { e.stopPropagation(); downloadRemoteFile(file.name); };
        actions.appendChild(dlBtn);
    }

    if (file.name !== '..') {
        const delBtn = document.createElement('button');
        delBtn.className = 'file-action-btn danger';
        delBtn.textContent = '删除';
        delBtn.onclick = (e) => { e.stopPropagation(); deleteRemoteFile(file.name, file.isDir); };
        actions.appendChild(delBtn);
    }

    item.appendChild(main);
    item.appendChild(actions);
    return item;
}

function downloadRemoteFile(filename) {
    const path = sftpCurrentPath.replace(/\/$/, '') + '/' + filename;
    window.location.href = `/api/ops/sftp/download?session=${sftpSessionId}&path=${encodeURIComponent(path)}`;
}

async function deleteRemoteFile(filename, isDir) {
    const label = isDir ? `目录 "${filename}" 及其所有内容` : `文件 "${filename}"`;
    if (!confirm(`确定要删除 ${label} 吗？`)) return;
    const path = sftpCurrentPath.replace(/\/$/, '') + '/' + filename;
    try {
        const res = await fetch('/api/ops/sftp/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session: sftpSessionId, path })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        if (sftpSelectedFile === filename) sftpSelectedFile = null;
        loadRemoteFiles(sftpCurrentPath);
    } catch (err) {
        alert('删除失败: ' + err.message);
    }
}

// 本地文件选择 & 上传
document.getElementById('upload-file').addEventListener('click', () => {
    document.getElementById('local-file-input').click();
});

document.getElementById('local-file-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    loadLocalFiles(files);
    if (!sftpConnected || !sftpSessionId) return;
    await uploadFiles(files);
    e.target.value = '';
});

function loadLocalFiles(files = null) {
    const list = document.getElementById('local-file-list');
    if (!files || !files.length) {
        list.innerHTML = '<div class="file-empty">点击"上传到远程"选择本地文件</div>';
        return;
    }
    list.innerHTML = '';
    files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
            <div class="file-item-main">
                <div class="file-icon">${getFileIcon(file.name)}</div>
                <div class="file-info">
                    <div class="file-name" title="${escHtml(file.name)}">${escHtml(file.name)}</div>
                    <div class="file-size">${fmtSize(file.size)}</div>
                </div>
            </div>`;
        list.appendChild(item);
    });
}

async function uploadFiles(files) {
    const progress = document.getElementById('sftp-upload-progress');
    const progressText = document.getElementById('sftp-progress-text');
    const progressFill = document.getElementById('sftp-progress-fill');
    progress.style.display = 'flex';

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        progressText.textContent = `上传 ${file.name} (${i + 1}/${files.length})`;
        progressFill.style.width = ((i / files.length) * 100) + '%';

        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await fetch(`/api/ops/sftp/upload?session=${sftpSessionId}&path=${encodeURIComponent(sftpCurrentPath)}`, {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (!data.success) alert(`上传 "${file.name}" 失败: ${data.message}`);
        } catch (err) {
            alert(`上传 "${file.name}" 失败: ${err.message}`);
        }
    }

    progressFill.style.width = '100%';
    setTimeout(() => { progress.style.display = 'none'; }, 600);
    loadRemoteFiles(sftpCurrentPath);
}

// 工具函数
function fmtSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1).replace(/\.0$/, '') + ' ' + sizes[i];
}

function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getFileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const icons = {
        jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
        mp4: '🎬', mov: '🎬', avi: '🎬', mkv: '🎬',
        mp3: '🎵', wav: '🎵', flac: '🎵',
        pdf: '📕', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊', ppt: '📊', pptx: '📊',
        zip: '📦', tar: '📦', gz: '📦', rar: '📦', '7z': '📦',
        sh: '⚙️', bash: '⚙️', py: '🐍', js: '📜', ts: '📜', go: '📜',
        json: '📋', yaml: '📋', yml: '📋', xml: '📋', toml: '📋',
        conf: '⚙️', config: '⚙️', env: '⚙️', ini: '⚙️',
        log: '📄', txt: '📄', md: '📄',
    };
    return icons[ext] || '📄';
}

// ===== 网络测试工具 =====

// Ping测试
document.getElementById('ping-btn').addEventListener('click', async () => {
    const host = document.getElementById('ping-host').value;
    const resultBox = document.getElementById('ping-result');
    
    if (!host) {
        resultBox.innerHTML = '<span class="result-error">请输入主机地址</span>';
        return;
    }
    
    resultBox.innerHTML = '<span class="result-info">正在Ping ' + host + '... <div class="loading"></div></span>';
    
    try {
        const startTime = Date.now();
        const response = await fetch(`https://${host}`, { method: 'HEAD', mode: 'no-cors' });
        const endTime = Date.now();
        const latency = endTime - startTime;
        
        resultBox.innerHTML = `
            <div class="result-success">主机: ${host}</div>
            <div>响应时间: ${latency}ms</div>
            <div>状态: 可达</div>
            <div style="margin-top:10px; color:#999;">注意：浏览器限制，这是简化版Ping测试</div>
        `;
    } catch (error) {
        resultBox.innerHTML = `
            <div class="result-error">无法连接到 ${host}</div>
            <div>错误: ${error.message}</div>
        `;
    }
});

// DNS查询
document.getElementById('dns-btn').addEventListener('click', async () => {
    const host = document.getElementById('dns-host').value;
    const resultBox = document.getElementById('dns-result');
    
    if (!host) {
        resultBox.innerHTML = '<span class="result-error">请输入域名</span>';
        return;
    }
    
    resultBox.innerHTML = '<span class="result-info">正在查询DNS记录... <div class="loading"></div></span>';
    
    try {
        const response = await fetch(`https://dns.google/resolve?name=${host}&type=A`);
        const data = await response.json();
        
        if (data.Answer) {
            let html = `<div class="result-success">域名: ${host}</div>`;
            data.Answer.forEach(record => {
                html += `<div>类型: ${record.type === 1 ? 'A' : 'OTHER'} | IP: ${record.data} | TTL: ${record.TTL}s</div>`;
            });
            resultBox.innerHTML = html;
        } else {
            resultBox.innerHTML = '<div class="result-error">未找到DNS记录</div>';
        }
    } catch (error) {
        resultBox.innerHTML = `<div class="result-error">DNS查询失败: ${error.message}</div>`;
    }
});

// HTTP请求测试
document.getElementById('http-btn').addEventListener('click', async () => {
    const method = document.getElementById('http-method').value;
    const url = document.getElementById('http-url').value;
    const body = document.getElementById('http-body').value;
    const resultBox = document.getElementById('http-result');
    
    if (!url) {
        resultBox.innerHTML = '<span class="result-error">请输入URL</span>';
        return;
    }
    
    resultBox.innerHTML = '<span class="result-info">正在发送请求... <div class="loading"></div></span>';
    
    try {
        const options = { method };
        if (body && (method === 'POST' || method === 'PUT')) {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = body;
        }
        
        const startTime = Date.now();
        const response = await fetch(url, options);
        const endTime = Date.now();
        const responseTime = endTime - startTime;
        
        const contentType = response.headers.get('content-type');
        let responseData = await response.text();
        
        if (contentType && contentType.includes('application/json')) {
            try {
                responseData = JSON.stringify(JSON.parse(responseData), null, 2);
            } catch (e) {}
        }
        
        resultBox.innerHTML = `
            <div class="result-success">状态码: ${response.status} ${response.statusText}</div>
            <div>响应时间: ${responseTime}ms</div>
            <div>Content-Type: ${contentType || 'N/A'}</div>
            <div style="margin-top:10px; font-weight:bold;">响应数据:</div>
            <pre style="white-space: pre-wrap; word-wrap: break-word;">${responseData.substring(0, 1000)}${responseData.length > 1000 ? '\n...(省略部分内容)' : ''}</pre>
        `;
    } catch (error) {
        resultBox.innerHTML = `<div class="result-error">请求失败: ${error.message}</div>`;
    }
});

// 端口检测
document.getElementById('port-btn').addEventListener('click', async () => {
    const host = document.getElementById('port-host').value;
    const port = document.getElementById('port-number').value;
    const resultBox = document.getElementById('port-result');
    
    if (!host || !port) {
        resultBox.innerHTML = '<span class="result-error">请输入主机和端口</span>';
        return;
    }
    
    resultBox.innerHTML = '<span class="result-info">正在检测端口... <div class="loading"></div></span>';
    
    try {
        const protocol = port == 443 ? 'https' : 'http';
        const url = `${protocol}://${host}:${port}`;
        const response = await fetch(url, { method: 'HEAD', mode: 'no-cors' });
        
        resultBox.innerHTML = `
            <div class="result-success">主机: ${host}</div>
            <div>端口: ${port}</div>
            <div>状态: 开放</div>
            <div style="margin-top:10px; color:#999;">注意：浏览器安全限制，仅能检测HTTP/HTTPS端口</div>
        `;
    } catch (error) {
        resultBox.innerHTML = `
            <div class="result-error">主机: ${host}</div>
            <div>端口: ${port}</div>
            <div>状态: 无法访问</div>
            <div>错误: ${error.message}</div>
        `;
    }
});

// IP信息查询
document.getElementById('ip-btn').addEventListener('click', async () => {
    const ip = document.getElementById('ip-address').value;
    const resultBox = document.getElementById('ip-result');
    
    resultBox.innerHTML = '<span class="result-info">正在查询IP信息... <div class="loading"></div></span>';
    
    try {
        const url = ip ? `https://ipapi.co/${ip}/json/` : 'https://ipapi.co/json/';
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error) {
            resultBox.innerHTML = `<div class="result-error">查询失败: ${data.reason || data.error}</div>`;
        } else {
            resultBox.innerHTML = `
                <div class="result-success">IP地址: ${data.ip}</div>
                <div>国家: ${data.country_name || 'N/A'} (${data.country || 'N/A'})</div>
                <div>地区: ${data.region || 'N/A'}</div>
                <div>城市: ${data.city || 'N/A'}</div>
                <div>ISP: ${data.org || 'N/A'}</div>
                <div>时区: ${data.timezone || 'N/A'}</div>
                <div>经纬度: ${data.latitude || 'N/A'}, ${data.longitude || 'N/A'}</div>
            `;
        }
    } catch (error) {
        resultBox.innerHTML = `<div class="result-error">查询失败: ${error.message}</div>`;
    }
});

// Whois查询
document.getElementById('whois-btn').addEventListener('click', async () => {
    const domain = document.getElementById('whois-domain').value;
    const resultBox = document.getElementById('whois-result');
    
    if (!domain) {
        resultBox.innerHTML = '<span class="result-error">请输入域名</span>';
        return;
    }
    
    resultBox.innerHTML = '<span class="result-info">正在查询Whois信息... <div class="loading"></div></span>';
    
    try {
        // 使用公共API查询域名信息
        const response = await fetch(`https://dns.google/resolve?name=${domain}&type=NS`);
        const data = await response.json();
        
        let html = `<div class="result-success">域名: ${domain}</div>`;
        
        if (data.Answer) {
            html += `<div style="margin-top:10px; font-weight:bold;">域名服务器:</div>`;
            data.Answer.forEach(record => {
                html += `<div>${record.data}</div>`;
            });
        }
        
        html += `<div style="margin-top:10px; color:#999;">注意：完整Whois信息需要专门的Whois服务器支持</div>`;
        resultBox.innerHTML = html;
    } catch (error) {
        resultBox.innerHTML = `<div class="result-error">查询失败: ${error.message}</div>`;
    }
});

// 网速测试
document.getElementById('speed-btn').addEventListener('click', async () => {
    const resultBox = document.getElementById('speed-result');
    resultBox.innerHTML = '<span class="result-info">正在测试网速... <div class="loading"></div></span>';
    
    try {
        // 下载速度测试
        const testUrl = 'https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png';
        const startTime = Date.now();
        const response = await fetch(testUrl + '?t=' + Date.now());
        const blob = await response.blob();
        const endTime = Date.now();
        
        const durationSeconds = (endTime - startTime) / 1000;
        const fileSizeMB = blob.size / (1024 * 1024);
        const speedMbps = (fileSizeMB * 8 / durationSeconds).toFixed(2);
        
        resultBox.innerHTML = `
            <div class="result-success">网速测试完成</div>
            <div>下载速度: ${speedMbps} Mbps</div>
            <div>测试文件大小: ${(fileSizeMB * 1024).toFixed(2)} KB</div>
            <div>耗时: ${durationSeconds.toFixed(2)} 秒</div>
            <div style="margin-top:10px; color:#999;">注意：这是简化版测试，实际网速可能有差异</div>
        `;
    } catch (error) {
        resultBox.innerHTML = `<div class="result-error">测试失败: ${error.message}</div>`;
    }
});

// SSL证书检查
document.getElementById('ssl-btn').addEventListener('click', async () => {
    const host = document.getElementById('ssl-host').value;
    const resultBox = document.getElementById('ssl-result');
    
    if (!host) {
        resultBox.innerHTML = '<span class="result-error">请输入域名</span>';
        return;
    }
    
    resultBox.innerHTML = '<span class="result-info">正在检查SSL证书... <div class="loading"></div></span>';
    
    try {
        const response = await fetch(`https://${host}`, { method: 'HEAD' });
        
        resultBox.innerHTML = `
            <div class="result-success">主机: ${host}</div>
            <div>SSL状态: 有效</div>
            <div>协议: HTTPS</div>
            <div style="margin-top:10px; color:#999;">注意：浏览器限制，无法获取详细证书信息<br>详细证书信息请使用专业工具查看</div>
        `;
    } catch (error) {
        resultBox.innerHTML = `
            <div class="result-error">SSL检查失败</div>
            <div>主机: ${host}</div>
            <div>错误: ${error.message}</div>
            <div style="margin-top:10px;">可能原因：证书无效、域名不支持HTTPS或网络问题</div>
        `;
    }
});

// ===== 实用工具 =====

// Cron表达式生成器
document.getElementById('cron-generate').addEventListener('click', () => {
    const second = document.getElementById('cron-second').value || '*';
    const minute = document.getElementById('cron-minute').value || '*';
    const hour = document.getElementById('cron-hour').value || '*';
    const day = document.getElementById('cron-day').value || '*';
    const month = document.getElementById('cron-month').value || '*';
    const week = document.getElementById('cron-week').value || '?';
    
    const cronExpression = `${second} ${minute} ${hour} ${day} ${month} ${week}`;
    
    const resultBox = document.getElementById('cron-result');
    resultBox.innerHTML = `
        <div class="result-success">Cron表达式: ${cronExpression}</div>
        <div style="margin-top:10px;">解释: 
            ${getCronDescription(second, minute, hour, day, month, week)}
        </div>
    `;
});

function getCronDescription(second, minute, hour, day, month, week) {
    let desc = [];
    if (second !== '*' && second !== '0') desc.push(`秒=${second}`);
    if (minute !== '*') desc.push(`分=${minute}`);
    if (hour !== '*') desc.push(`时=${hour}`);
    if (day !== '*') desc.push(`日=${day}`);
    if (month !== '*') desc.push(`月=${month}`);
    if (week !== '?' && week !== '*') desc.push(`周=${week}`);
    
    return desc.length > 0 ? desc.join(', ') : '每秒执行';
}

// 正则表达式测试
document.getElementById('regex-test').addEventListener('click', () => {
    const pattern = document.getElementById('regex-pattern').value;
    const text = document.getElementById('regex-text').value;
    const resultBox = document.getElementById('regex-result');
    
    if (!pattern) {
        resultBox.innerHTML = '<span class="result-error">请输入正则表达式</span>';
        return;
    }
    
    try {
        let flags = '';
        if (document.getElementById('regex-global').checked) flags += 'g';
        if (document.getElementById('regex-case').checked) flags += 'i';
        if (document.getElementById('regex-multi').checked) flags += 'm';
        
        const regex = new RegExp(pattern, flags);
        const matches = text.match(regex);
        
        if (matches) {
            resultBox.innerHTML = `
                <div class="result-success">匹配成功！找到 ${matches.length} 个结果</div>
                <div style="margin-top:10px; font-weight:bold;">匹配结果:</div>
                ${matches.map((m, i) => `<div>${i + 1}. ${m}</div>`).join('')}
            `;
        } else {
            resultBox.innerHTML = '<div class="result-error">未找到匹配项</div>';
        }
    } catch (error) {
        resultBox.innerHTML = `<div class="result-error">正则表达式错误: ${error.message}</div>`;
    }
});

// JSON格式化
document.getElementById('json-format').addEventListener('click', () => {
    const input = document.getElementById('json-input').value;
    const resultBox = document.getElementById('json-result');
    
    try {
        const obj = JSON.parse(input);
        const formatted = JSON.stringify(obj, null, 4);
        resultBox.innerHTML = `<div class="result-success">格式化成功</div><pre>${formatted}</pre>`;
    } catch (error) {
        resultBox.innerHTML = `<div class="result-error">JSON格式错误: ${error.message}</div>`;
    }
});

document.getElementById('json-compress').addEventListener('click', () => {
    const input = document.getElementById('json-input').value;
    const resultBox = document.getElementById('json-result');
    
    try {
        const obj = JSON.parse(input);
        const compressed = JSON.stringify(obj);
        resultBox.innerHTML = `<div class="result-success">压缩成功</div><pre>${compressed}</pre>`;
    } catch (error) {
        resultBox.innerHTML = `<div class="result-error">JSON格式错误: ${error.message}</div>`;
    }
});

document.getElementById('json-validate').addEventListener('click', () => {
    const input = document.getElementById('json-input').value;
    const resultBox = document.getElementById('json-result');
    
    try {
        JSON.parse(input);
        resultBox.innerHTML = '<div class="result-success">✓ JSON格式正确</div>';
    } catch (error) {
        resultBox.innerHTML = `<div class="result-error">✗ JSON格式错误: ${error.message}</div>`;
    }
});

// Base64编解码
document.getElementById('base64-encode').addEventListener('click', () => {
    const input = document.getElementById('base64-input').value;
    const resultBox = document.getElementById('base64-result');
    
    try {
        const encoded = btoa(unescape(encodeURIComponent(input)));
        resultBox.innerHTML = `<div class="result-success">编码成功</div><pre>${encoded}</pre>`;
    } catch (error) {
        resultBox.innerHTML = `<div class="result-error">编码失败: ${error.message}</div>`;
    }
});

document.getElementById('base64-decode').addEventListener('click', () => {
    const input = document.getElementById('base64-input').value;
    const resultBox = document.getElementById('base64-result');
    
    try {
        const decoded = decodeURIComponent(escape(atob(input)));
        resultBox.innerHTML = `<div class="result-success">解码成功</div><pre>${decoded}</pre>`;
    } catch (error) {
        resultBox.innerHTML = `<div class="result-error">解码失败: ${error.message}</div>`;
    }
});

// 时间戳转换
document.getElementById('timestamp-now').addEventListener('click', () => {
    const now = Date.now();
    document.getElementById('timestamp-input').value = now;
});

document.getElementById('timestamp-convert').addEventListener('click', () => {
    const input = document.getElementById('timestamp-input').value;
    const resultBox = document.getElementById('timestamp-result');
    
    if (!input) {
        resultBox.innerHTML = '<span class="result-error">请输入时间戳</span>';
        return;
    }
    
    try {
        let timestamp = parseInt(input);
        // 如果是秒级时间戳，转换为毫秒
        if (timestamp < 10000000000) {
            timestamp *= 1000;
        }
        
        const date = new Date(timestamp);
        resultBox.innerHTML = `
            <div class="result-success">转换成功</div>
            <div>时间戳(毫秒): ${timestamp}</div>
            <div>时间戳(秒): ${Math.floor(timestamp / 1000)}</div>
            <div>日期时间: ${date.toLocaleString('zh-CN')}</div>
            <div>ISO 8601: ${date.toISOString()}</div>
            <div>UTC: ${date.toUTCString()}</div>
        `;
    } catch (error) {
        resultBox.innerHTML = `<div class="result-error">转换失败: ${error.message}</div>`;
    }
});

// Hash计算
document.getElementById('hash-calculate').addEventListener('click', async () => {
    const input = document.getElementById('hash-input').value;
    const resultBox = document.getElementById('hash-result');
    
    if (!input) {
        resultBox.innerHTML = '<span class="result-error">请输入文本</span>';
        return;
    }
    
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(input);
        
        // 计算SHA-256
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const sha256 = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        // 简单的MD5模拟（实际应使用库）
        let simpleHash = 0;
        for (let i = 0; i < input.length; i++) {
            simpleHash = ((simpleHash << 5) - simpleHash) + input.charCodeAt(i);
            simpleHash = simpleHash & simpleHash;
        }
        
        resultBox.innerHTML = `
            <div class="result-success">计算完成</div>
            <div style="margin-top:10px; font-weight:bold;">SHA-256:</div>
            <div style="word-break: break-all; font-family: monospace;">${sha256}</div>
            <div style="margin-top:10px; font-weight:bold;">Simple Hash:</div>
            <div style="font-family: monospace;">${Math.abs(simpleHash).toString(16)}</div>
        `;
    } catch (error) {
        resultBox.innerHTML = `<div class="result-error">计算失败: ${error.message}</div>`;
    }
});

// 文本对比
document.getElementById('diff-compare').addEventListener('click', () => {
    const text1 = document.getElementById('diff-text1').value;
    const text2 = document.getElementById('diff-text2').value;
    const resultBox = document.getElementById('diff-result');
    
    const lines1 = text1.split('\n');
    const lines2 = text2.split('\n');
    
    let html = '<div class="result-success">对比完成</div><div style="margin-top:10px;">';
    const maxLines = Math.max(lines1.length, lines2.length);
    
    let diffCount = 0;
    for (let i = 0; i < maxLines; i++) {
        const line1 = lines1[i] || '';
        const line2 = lines2[i] || '';
        
        if (line1 !== line2) {
            diffCount++;
            html += `<div style="background:#ffe0e0; padding:5px; margin:2px 0;">
                <strong>行 ${i + 1}:</strong><br>
                <span style="color:#c00;">- ${line1}</span><br>
                <span style="color:#0c0;">+ ${line2}</span>
            </div>`;
        }
    }
    
    if (diffCount === 0) {
        html += '<div style="color:#0c0;">两段文本完全相同</div>';
    } else {
        html = `<div class="result-info">发现 ${diffCount} 处差异</div>` + html;
    }
    
    html += '</div>';
    resultBox.innerHTML = html;
});

// 密码生成器
document.getElementById('pwd-generate').addEventListener('click', () => {
    const length = parseInt(document.getElementById('pwd-length').value);
    const useUpper = document.getElementById('pwd-upper').checked;
    const useLower = document.getElementById('pwd-lower').checked;
    const useNumber = document.getElementById('pwd-number').checked;
    const useSymbol = document.getElementById('pwd-symbol').checked;
    const resultBox = document.getElementById('pwd-result');
    
    if (!useUpper && !useLower && !useNumber && !useSymbol) {
        resultBox.innerHTML = '<span class="result-error">请至少选择一种字符类型</span>';
        return;
    }
    
    let chars = '';
    if (useUpper) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (useLower) chars += 'abcdefghijklmnopqrstuvwxyz';
    if (useNumber) chars += '0123456789';
    if (useSymbol) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';
    
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    resultBox.innerHTML = `
        <div class="result-success">密码已生成</div>
        <div style="font-size:18px; font-weight:bold; margin:10px 0; font-family:monospace; user-select:all;">
            ${password}
        </div>
        <div style="color:#666; font-size:12px;">点击密码可复制</div>
    `;
});

// CIDR计算器
document.getElementById('cidr-calculate').addEventListener('click', () => {
    const cidr = document.getElementById('cidr-input').value;
    const resultBox = document.getElementById('cidr-result');
    
    if (!cidr) {
        resultBox.innerHTML = '<span class="result-error">请输入CIDR</span>';
        return;
    }
    
    try {
        const [ip, prefixStr] = cidr.split('/');
        const prefix = parseInt(prefixStr);
        
        if (!ip || isNaN(prefix) || prefix < 0 || prefix > 32) {
            throw new Error('CIDR格式错误');
        }
        
        const ipParts = ip.split('.').map(Number);
        if (ipParts.length !== 4 || ipParts.some(p => isNaN(p) || p < 0 || p > 255)) {
            throw new Error('IP地址格式错误');
        }
        
        const totalHosts = Math.pow(2, 32 - prefix);
        const usableHosts = prefix < 31 ? totalHosts - 2 : totalHosts;
        
        // 计算子网掩码
        const maskBits = '1'.repeat(prefix) + '0'.repeat(32 - prefix);
        const mask = [];
        for (let i = 0; i < 4; i++) {
            mask.push(parseInt(maskBits.substr(i * 8, 8), 2));
        }
        
        // 计算网络地址
        const network = ipParts.map((p, i) => p & mask[i]);
        
        // 计算广播地址
        const broadcast = network.map((p, i) => p | (255 - mask[i]));
        
        // 第一个和最后一个可用IP
        const firstIP = [...network];
        firstIP[3] += 1;
        const lastIP = [...broadcast];
        lastIP[3] -= 1;
        
        resultBox.innerHTML = `
            <div class="result-success">计算完成</div>
            <div>网络地址: ${network.join('.')}</div>
            <div>子网掩码: ${mask.join('.')}</div>
            <div>广播地址: ${broadcast.join('.')}</div>
            ${prefix < 31 ? `
            <div>第一个可用IP: ${firstIP.join('.')}</div>
            <div>最后一个可用IP: ${lastIP.join('.')}</div>
            <div>可用主机数: ${usableHosts}</div>
            ` : ''}
            <div>总IP数: ${totalHosts}</div>
            <div>前缀长度: /${prefix}</div>
        `;
    } catch (error) {
        resultBox.innerHTML = `<div class="result-error">计算失败: ${error.message}</div>`;
    }
});

// URL编解码
document.getElementById('url-encode').addEventListener('click', () => {
    const input = document.getElementById('url-input').value;
    const resultBox = document.getElementById('url-result');
    
    try {
        const encoded = encodeURIComponent(input);
        resultBox.innerHTML = `<div class="result-success">编码成功</div><pre style="word-break: break-all;">${encoded}</pre>`;
    } catch (error) {
        resultBox.innerHTML = `<div class="result-error">编码失败: ${error.message}</div>`;
    }
});

document.getElementById('url-decode').addEventListener('click', () => {
    const input = document.getElementById('url-input').value;
    const resultBox = document.getElementById('url-result');
    
    try {
        const decoded = decodeURIComponent(input);
        resultBox.innerHTML = `<div class="result-success">解码成功</div><pre style="word-break: break-all;">${decoded}</pre>`;
    } catch (error) {
        resultBox.innerHTML = `<div class="result-error">解码失败: ${error.message}</div>`;
    }
});

// UUID生成器
document.getElementById('uuid-generate').addEventListener('click', () => {
    const count = parseInt(document.getElementById('uuid-count').value);
    const resultBox = document.getElementById('uuid-result');
    
    const uuids = [];
    for (let i = 0; i < count; i++) {
        uuids.push(generateUUID());
    }
    
    resultBox.innerHTML = `
        <div class="result-success">已生成 ${count} 个UUID</div>
        <div style="margin-top:10px; font-family:monospace;">
            ${uuids.map(uuid => `<div style="user-select:all;">${uuid}</div>`).join('')}
        </div>
    `;
});

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ===== 主机管理 =====
let hosts = JSON.parse(localStorage.getItem('ops-hosts') || '[]');
let editingHostIndex = -1;

function renderHosts() {
    const container = document.getElementById('hosts-list');
    
    if (hosts.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:40px; color:#999;">暂无主机，点击"添加主机"开始</div>';
        return;
    }
    
    container.innerHTML = hosts.map((host, index) => `
        <div class="host-card">
            <div class="host-card-header">
                <div>
                    <div class="host-card-title">${host.name}</div>
                    <div class="host-card-address">${host.user}@${host.address}:${host.port}</div>
                </div>
                <div class="host-card-actions">
                    <button class="btn-connect" onclick="connectHost(${index})">连接</button>
                    <button class="btn-edit" onclick="editHost(${index})">编辑</button>
                    <button class="btn-delete" onclick="deleteHost(${index})">删除</button>
                </div>
            </div>
            ${host.tags ? `
            <div class="host-card-tags">
                ${host.tags.split(',').map(tag => `<span class="host-tag">${tag.trim()}</span>`).join('')}
            </div>
            ` : ''}
            ${host.notes ? `<div class="host-card-notes">${host.notes}</div>` : ''}
        </div>
    `).join('');
}

function connectHost(index) {
    const host = hosts[index];
    document.getElementById('ssh-host').value = host.address;
    document.getElementById('ssh-port').value = host.port;
    document.getElementById('ssh-user').value = host.user;
    if (host.password) document.getElementById('ssh-password').value = host.password;
    // 切换到 SSH 标签页并自动触发连接
    document.querySelector('[data-tab="ssh"]').click();
    document.getElementById('ssh-connect').click();
}

function editHost(index) {
    editingHostIndex = index;
    const host = hosts[index];
    
    document.getElementById('host-name').value = host.name;
    document.getElementById('host-address').value = host.address;
    document.getElementById('host-port').value = host.port;
    document.getElementById('host-user').value = host.user;
    document.getElementById('host-password').value = host.password || '';
    document.getElementById('host-tags').value = host.tags || '';
    document.getElementById('host-notes').value = host.notes || '';
    
    document.getElementById('host-modal').style.display = 'flex';
}

function deleteHost(index) {
    if (confirm(`确定要删除主机 "${hosts[index].name}" 吗？`)) {
        hosts.splice(index, 1);
        saveHosts();
        renderHosts();
    }
}

function saveHosts() {
    localStorage.setItem('ops-hosts', JSON.stringify(hosts));
}

document.getElementById('add-host').addEventListener('click', () => {
    editingHostIndex = -1;
    document.getElementById('host-name').value = '';
    document.getElementById('host-address').value = '';
    document.getElementById('host-port').value = '22';
    document.getElementById('host-user').value = '';
    document.getElementById('host-password').value = '';
    document.getElementById('host-tags').value = '';
    document.getElementById('host-notes').value = '';
    document.getElementById('host-modal').style.display = 'flex';
});

document.getElementById('save-host').addEventListener('click', () => {
    const host = {
        name: document.getElementById('host-name').value,
        address: document.getElementById('host-address').value,
        port: document.getElementById('host-port').value,
        user: document.getElementById('host-user').value,
        password: document.getElementById('host-password').value,
        tags: document.getElementById('host-tags').value,
        notes: document.getElementById('host-notes').value
    };
    
    if (!host.name || !host.address || !host.user) {
        alert('请填写必填项：主机名称、地址、用户名');
        return;
    }
    
    if (editingHostIndex >= 0) {
        hosts[editingHostIndex] = host;
    } else {
        hosts.push(host);
    }
    
    saveHosts();
    renderHosts();
    document.getElementById('host-modal').style.display = 'none';
});

document.getElementById('close-modal').addEventListener('click', () => {
    document.getElementById('host-modal').style.display = 'none';
});

document.getElementById('cancel-modal').addEventListener('click', () => {
    document.getElementById('host-modal').style.display = 'none';
});

// 初始化主机列表
renderHosts();

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

// ===== SSH终端功能 =====
let sshConnected = false;
let commandHistory = [];
let historyIndex = -1;

document.getElementById('ssh-connect').addEventListener('click', () => {
    const host = document.getElementById('ssh-host').value;
    const port = document.getElementById('ssh-port').value;
    const user = document.getElementById('ssh-user').value;
    const password = document.getElementById('ssh-password').value;

    if (!host || !user || !password) {
        alert('请填写完整的连接信息');
        return;
    }

    // 模拟连接
    const terminalOutput = document.getElementById('terminal-output');
    terminalOutput.innerHTML = `<div class="terminal-line result-info">正在连接到 ${user}@${host}:${port}...</div>`;
    
    setTimeout(() => {
        sshConnected = true;
        document.getElementById('terminal-container').style.display = 'block';
        document.getElementById('ssh-connect').style.display = 'none';
        document.getElementById('ssh-disconnect').style.display = 'inline-block';
        
        terminalOutput.innerHTML += `<div class="terminal-line result-success">连接成功！</div>`;
        terminalOutput.innerHTML += `<div class="terminal-line">欢迎使用SSH终端（演示模式）</div>`;
        terminalOutput.innerHTML += `<div class="terminal-line result-info">注意：这是前端演示模式，实际SSH功能需要后端WebSocket支持</div>`;
        
        document.getElementById('terminal-input').focus();
    }, 1000);
});

document.getElementById('ssh-disconnect').addEventListener('click', () => {
    sshConnected = false;
    document.getElementById('terminal-container').style.display = 'none';
    document.getElementById('ssh-connect').style.display = 'inline-block';
    document.getElementById('ssh-disconnect').style.display = 'none';
    document.getElementById('terminal-output').innerHTML = '';
});

document.getElementById('clear-terminal').addEventListener('click', () => {
    document.getElementById('terminal-output').innerHTML = '';
});

document.getElementById('terminal-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const input = e.target.value.trim();
        if (input) {
            executeCommand(input);
            commandHistory.unshift(input);
            historyIndex = -1;
            e.target.value = '';
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (historyIndex < commandHistory.length - 1) {
            historyIndex++;
            e.target.value = commandHistory[historyIndex];
        }
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex > 0) {
            historyIndex--;
            e.target.value = commandHistory[historyIndex];
        } else if (historyIndex === 0) {
            historyIndex = -1;
            e.target.value = '';
        }
    }
});

function executeCommand(cmd) {
    const output = document.getElementById('terminal-output');
    output.innerHTML += `<div class="terminal-line">$ ${cmd}</div>`;
    
    // 模拟命令执行
    const responses = {
        'ls': 'Documents  Downloads  Pictures  Videos  Music',
        'pwd': '/home/user',
        'date': new Date().toString(),
        'whoami': 'user',
        'help': '可用命令: ls, pwd, date, whoami, help, clear\n注意：这是演示模式，实际功能需要后端支持',
        'clear': ''
    };
    
    if (cmd === 'clear') {
        output.innerHTML = '';
    } else {
        const response = responses[cmd] || `命令 '${cmd}' 未找到（演示模式）`;
        output.innerHTML += `<div class="terminal-line">${response}</div>`;
    }
    
    output.scrollTop = output.scrollHeight;
}

// ===== SFTP文件管理功能 =====
let sftpConnected = false;

document.getElementById('sftp-connect').addEventListener('click', () => {
    const host = document.getElementById('sftp-host').value;
    const port = document.getElementById('sftp-port').value;
    const user = document.getElementById('sftp-user').value;
    const password = document.getElementById('sftp-password').value;

    if (!host || !user || !password) {
        alert('请填写完整的连接信息');
        return;
    }

    // 模拟连接
    setTimeout(() => {
        sftpConnected = true;
        document.getElementById('sftp-container').style.display = 'block';
        document.getElementById('sftp-connect').style.display = 'none';
        document.getElementById('sftp-disconnect').style.display = 'inline-block';
        
        loadLocalFiles();
        loadRemoteFiles();
    }, 1000);
});

document.getElementById('sftp-disconnect').addEventListener('click', () => {
    sftpConnected = false;
    document.getElementById('sftp-container').style.display = 'none';
    document.getElementById('sftp-connect').style.display = 'inline-block';
    document.getElementById('sftp-disconnect').style.display = 'none';
});

document.getElementById('upload-file').addEventListener('click', () => {
    document.getElementById('local-file-input').click();
});

document.getElementById('local-file-input').addEventListener('change', (e) => {
    loadLocalFiles(e.target.files);
});

function loadLocalFiles(files = null) {
    const list = document.getElementById('local-file-list');
    list.innerHTML = '';
    
    if (files && files.length > 0) {
        Array.from(files).forEach(file => {
            const item = createFileItem(file.name, formatFileSize(file.size), '📄');
            item.addEventListener('click', () => uploadFile(file));
            list.appendChild(item);
        });
    } else {
        list.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">点击"上传文件"选择本地文件</div>';
    }
}

function loadRemoteFiles() {
    const list = document.getElementById('remote-file-list');
    list.innerHTML = '';
    
    // 模拟远程文件列表
    const mockFiles = [
        { name: '..', size: 0, isDir: true },
        { name: 'config', size: 0, isDir: true },
        { name: 'logs', size: 0, isDir: true },
        { name: 'data', size: 0, isDir: true },
        { name: 'nginx.conf', size: 2048, isDir: false },
        { name: 'app.log', size: 51200, isDir: false },
        { name: 'README.md', size: 1024, isDir: false }
    ];
    
    mockFiles.forEach(file => {
        const icon = file.isDir ? '📁' : '📄';
        const size = file.isDir ? '' : formatFileSize(file.size);
        const item = createFileItem(file.name, size, icon);
        item.addEventListener('click', () => {
            if (file.isDir && file.name !== '..') {
                alert('目录浏览功能需要后端支持');
            } else if (!file.isDir) {
                downloadFile(file.name);
            }
        });
        list.appendChild(item);
    });
}

function createFileItem(name, size, icon) {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
        <div class="file-icon">${icon}</div>
        <div class="file-info">
            <div class="file-name">${name}</div>
            ${size ? `<div class="file-size">${size}</div>` : ''}
        </div>
    `;
    return item;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function uploadFile(file) {
    alert(`上传文件 "${file.name}" 需要后端SFTP服务支持`);
}

function downloadFile(filename) {
    alert(`下载文件 "${filename}" 需要后端SFTP服务支持`);
}

document.getElementById('refresh-remote').addEventListener('click', () => {
    if (sftpConnected) {
        loadRemoteFiles();
    }
});

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
    
    // 填充SSH连接信息
    document.getElementById('ssh-host').value = host.address;
    document.getElementById('ssh-port').value = host.port;
    document.getElementById('ssh-user').value = host.user;
    if (host.password) {
        document.getElementById('ssh-password').value = host.password;
    }
    
    // 切换到SSH标签
    document.querySelector('[data-tab="ssh"]').click();
    
    alert(`将连接到: ${host.name} (${host.address})`);
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

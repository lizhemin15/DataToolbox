// WebSocket连接
let ws = null;
let clientId = null;
let userName = '用户' + Math.floor(Math.random() * 1000);

// 文档数据
let documents = [];
let currentDoc = null;
let onlineUsers = {};

// Excel编辑器状态
let excelData = [];
let currentCell = null;

// Word编辑器
let quill = null;
let isLocalChange = false;

// 初始化
function init() {
    // 从本地存储加载用户名
    const savedName = localStorage.getItem('collab-docs-username');
    if (savedName) {
        userName = savedName;
    }
    updateUserDisplay();

    // 连接WebSocket
    connectWebSocket();

    // 绑定事件
    bindEvents();

    // 初始化Quill编辑器
    initQuillEditor();
}

// 更新用户显示
function updateUserDisplay() {
    document.getElementById('userName').textContent = userName;
    document.getElementById('userAvatar').textContent = getAvatarText(userName);
}

// 生成头像文字
function getAvatarText(name) {
    if (!name) return '?';
    // 如果是中文，取第一个字
    if (/[\u4e00-\u9fa5]/.test(name)) {
        return name.charAt(0);
    }
    // 如果是英文，取前两个字母
    return name.substring(0, 2).toUpperCase();
}

// 连接WebSocket
function connectWebSocket() {
    try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/chat`;

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('WebSocket已连接');
            hideServerModal();
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                handleMessage(msg);
            } catch (e) {
                console.error('消息解析失败:', e);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket错误:', error);
            showServerModal();
        };

        ws.onclose = () => {
            console.log('WebSocket已断开，5秒后重连...');
            setTimeout(connectWebSocket, 5000);
        };
    } catch (error) {
        console.error('WebSocket连接失败:', error);
        showServerModal();
    }
}

// 显示服务器检测提示
function showServerModal() {
    document.getElementById('serverModal').style.display = 'flex';
}

// 隐藏服务器检测提示
function hideServerModal() {
    document.getElementById('serverModal').style.display = 'none';
}

// 处理WebSocket消息
function handleMessage(msg) {
    switch (msg.type) {
        case 'registered':
            clientId = msg.id;
            // 注册用户名
            sendMessage({ type: 'register', name: userName });
            // 请求文档列表
            sendMessage({ type: 'doc-list-request' });
            break;

        case 'peer-list':
            updateOnlineUsers(msg.peers);
            break;

        case 'peer-join':
            if (msg.peer) {
                onlineUsers[msg.peer.id] = msg.peer.name;
                updateOnlineCount();
            }
            break;

        case 'peer-leave':
            if (msg.id) {
                delete onlineUsers[msg.id];
                updateOnlineCount();
                // 移除该用户的光标
                removeCursor(msg.id);
            }
            break;

        case 'doc-list':
            documents = msg.documents || [];
            renderDocumentList();
            break;

        case 'doc-created':
            // 检查文档是否已存在（避免重复添加）
            if (!documents.find(d => d.id === msg.document.id)) {
                documents.push(msg.document);
                renderDocumentList();
                console.log('文档已添加:', msg.document.title);
            }
            
            // 如果这是刚创建的文档，自动打开
            if (window._pendingDocId === msg.document.id) {
                delete window._pendingDocId;
                openDocument(msg.document.id);
            }
            break;

        case 'doc-deleted':
            documents = documents.filter(d => d.id !== msg.docId);
            renderDocumentList();
            if (currentDoc && currentDoc.id === msg.docId) {
                showListPage();
            }
            break;

        case 'doc-opened':
            // 服务器返回文档内容
            if (msg.document) {
                currentDoc = msg.document;
                showEditorPage();
                console.log('文档已打开:', currentDoc.title);
            }
            break;

        case 'doc-update':
            if (currentDoc && msg.docId === currentDoc.id) {
                applyRemoteUpdate(msg);
            }
            break;

        case 'doc-title-update':
            if (currentDoc && msg.docId === currentDoc.id) {
                currentDoc.title = msg.title;
                document.getElementById('docTitle').value = msg.title;
            }
            // 更新列表中的标题
            const doc = documents.find(d => d.id === msg.docId);
            if (doc) {
                doc.title = msg.title;
                renderDocumentList();
            }
            break;

        case 'doc-cursor':
            if (currentDoc && msg.docId === currentDoc.id && msg.from !== clientId) {
                updateCursor(msg.from, msg.cursor);
            }
            break;

        case 'doc-users':
            if (currentDoc && msg.docId === currentDoc.id) {
                updateEditorUsers(msg.users);
            }
            break;
    }
}

// 发送消息
function sendMessage(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

// 广播消息到所有在线用户（通过服务器）
function broadcastMessage(msg) {
    // 直接发送到服务器，由服务器广播给所有用户
    sendMessage(msg);
}

// 更新在线用户
function updateOnlineUsers(peers) {
    onlineUsers = {};
    peers.forEach(peer => {
        onlineUsers[peer.id] = peer.name;
    });
    updateOnlineCount();
}

// 更新在线人数
function updateOnlineCount() {
    document.getElementById('onlineCount').textContent = Object.keys(onlineUsers).length;
}

// 绑定事件
function bindEvents() {
    // 用户名点击
    document.getElementById('userName').onclick = () => {
        const newName = prompt('请输入新昵称:', userName);
        if (newName && newName.trim()) {
            const oldName = userName;
            userName = newName.trim();
            localStorage.setItem('collab-docs-username', userName);
            updateUserDisplay();
            console.log('昵称已更新:', oldName, '->', userName);
            
            // 通知服务器更新昵称
            if (ws && ws.readyState === WebSocket.OPEN) {
                sendMessage({ type: 'update-name', name: userName });
                console.log('已通知服务器更新昵称');
            }
        }
    };

    // 新建文档
    document.getElementById('newDocBtn').onclick = () => {
        showNewDocDialog();
    };

    // 文档类型选择
    document.querySelectorAll('.doc-type-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.doc-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        };
    });

    // 取消新建
    document.getElementById('cancelNewDoc').onclick = () => {
        hideNewDocDialog();
    };

    // 确认新建
    document.getElementById('confirmNewDoc').onclick = () => {
        createDocument();
    };

    // 返回按钮
    document.getElementById('backBtn').onclick = () => {
        leaveDocument();
        showListPage();
    };

    // 文档标题修改
    let titleTimeout = null;
    document.getElementById('docTitle').oninput = (e) => {
        if (!currentDoc) return;
        clearTimeout(titleTimeout);
        titleTimeout = setTimeout(() => {
            const newTitle = e.target.value.trim() || '未命名文档';
            broadcastMessage({
                type: 'doc-title-update',
                docId: currentDoc.id,
                title: newTitle
            });
        }, 500);
    };

    // 删除文档
    document.getElementById('deleteDocBtn').onclick = () => {
        if (!currentDoc) return;
        if (confirm(`确定要删除文档"${currentDoc.title}"吗？`)) {
            deleteDocument(currentDoc.id);
        }
    };

    // 过滤标签
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            filterDocuments(tab.dataset.type);
        };
    });

    // Excel工具栏
    document.getElementById('addRowBtn').onclick = () => addExcelRow();
    document.getElementById('addColBtn').onclick = () => addExcelCol();
    document.getElementById('exportExcelBtn').onclick = () => exportExcel();

    // Word工具栏
    document.getElementById('exportWordBtn').onclick = () => exportWord();
}

// 显示新建文档对话框
function showNewDocDialog() {
    document.getElementById('newDocDialog').classList.add('active');
    document.getElementById('newDocName').value = '';
    document.getElementById('newDocName').focus();
}

// 隐藏新建文档对话框
function hideNewDocDialog() {
    document.getElementById('newDocDialog').classList.remove('active');
}

// 创建文档
function createDocument() {
    const name = document.getElementById('newDocName').value.trim();
    if (!name) {
        alert('请输入文档名称');
        return;
    }

    const typeBtn = document.querySelector('.doc-type-btn.active');
    const type = typeBtn.dataset.type;

    const doc = {
        id: generateId(),
        title: name,
        type: type,
        creator: userName,
        createdAt: Date.now(),
        content: type === 'excel' ? { data: [['']] } : { ops: [] }
    };

    // 发送到服务器，服务器会存储并广播给所有用户（包括自己）
    sendMessage({
        type: 'doc-created',
        document: doc
    });

    hideNewDocDialog();

    // 注意：不在这里添加到本地列表，等待服务器确认后通过handleMessage添加
    // 临时保存文档ID，用于打开
    window._pendingDocId = doc.id;
}

// 删除文档
function deleteDocument(docId) {
    // 发送到服务器，服务器会存储并广播给所有用户
    sendMessage({
        type: 'doc-deleted',
        docId: docId
    });

    // 注意：不在这里删除，等待服务器确认后通过handleMessage删除
}

// 打开文档
function openDocument(docId) {
    const doc = documents.find(d => d.id === docId);
    if (!doc) {
        console.error('文档不存在:', docId);
        return;
    }

    // 请求服务器打开文档（服务器会返回最新的文档内容）
    sendMessage({
        type: 'doc-opened',
        docId: docId
    });

    // 注意：不在这里设置currentDoc和显示编辑器，等待服务器响应
}

// 离开文档
function leaveDocument() {
    if (!currentDoc) return;

    // 离开前保存一次完整内容
    if (currentDoc.type === 'excel' && excelData.length > 0) {
        saveExcelContent();
    } else if (currentDoc.type === 'word' && quill) {
        saveWordContent();
    }

    sendMessage({
        type: 'doc-leave',
        docId: currentDoc.id
    });

    currentDoc = null;
}

// 渲染文档列表
function renderDocumentList() {
    const listEl = document.getElementById('docList');

    if (documents.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📭</div>
                <p>暂无文档</p>
                <p class="empty-hint">点击"新建文档"创建第一个协作文档</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = documents.map((doc, index) => {
        const icon = doc.type === 'excel' ? '📊' : '📝';
        const time = formatTime(doc.createdAt);
        const creatorAvatar = getAvatarText(doc.creator);
        return `
            <div class="doc-card" data-id="${doc.id}" style="animation-delay: ${index * 0.05}s">
                <span class="doc-type-badge ${doc.type}">${doc.type === 'excel' ? 'Excel' : 'Word'}</span>
                <div class="doc-card-header">
                    <span class="doc-icon">${icon}</span>
                    <span class="doc-name">${escapeHtml(doc.title)}</span>
                </div>
                <div class="doc-meta">
                    <div class="doc-users">
                        <span class="doc-creator">
                            <span class="creator-avatar">${creatorAvatar}</span>
                            <span>${escapeHtml(doc.creator)}</span>
                        </span>
                    </div>
                    <span class="doc-time">${time}</span>
                </div>
            </div>
        `;
    }).join('');

    // 绑定点击事件
    listEl.querySelectorAll('.doc-card').forEach(card => {
        card.onclick = () => {
            const docId = card.dataset.id;
            openDocument(docId);
        };
    });
}

// 过滤文档
function filterDocuments(type) {
    const cards = document.querySelectorAll('.doc-card');
    cards.forEach(card => {
        const docId = card.dataset.id;
        const doc = documents.find(d => d.id === docId);
        if (type === 'all' || doc.type === type) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
}

// 显示列表页面
function showListPage() {
    document.getElementById('listPage').classList.add('active');
    document.getElementById('editorPage').classList.remove('active');
    currentDoc = null;
}

// 显示编辑器页面
function showEditorPage() {
    if (!currentDoc) return;

    document.getElementById('listPage').classList.remove('active');
    document.getElementById('editorPage').classList.add('active');

    // 设置标题
    document.getElementById('docTitle').value = currentDoc.title;

    // 显示对应编辑器
    if (currentDoc.type === 'excel') {
        document.getElementById('excelEditor').style.display = 'block';
        document.getElementById('wordEditor').style.display = 'none';
        initExcelEditor();
    } else {
        document.getElementById('excelEditor').style.display = 'none';
        document.getElementById('wordEditor').style.display = 'block';
        initWordEditor();
    }
}

// 初始化Excel编辑器
function initExcelEditor() {
    if (!currentDoc) return;

    excelData = currentDoc.content.data || [['']];
    renderExcelTable();
}

// 渲染Excel表格
function renderExcelTable() {
    const table = document.getElementById('excelTable');
    const rows = excelData.length;
    const cols = excelData[0]?.length || 0;

    // 生成表头
    let html = '<thead><tr><th></th>';
    for (let c = 0; c < cols; c++) {
        html += `<th>${getColumnLabel(c)}</th>`;
    }
    html += '</tr></thead><tbody>';

    // 生成数据行
    for (let r = 0; r < rows; r++) {
        html += `<tr><th>${r + 1}</th>`;
        for (let c = 0; c < cols; c++) {
            const value = excelData[r][c] || '';
            html += `<td data-row="${r}" data-col="${c}">
                <input type="text" value="${value}" />
            </td>`;
        }
        html += '</tr>';
    }
    html += '</tbody>';

    table.innerHTML = html;

    // 绑定输入事件
    table.querySelectorAll('input').forEach(input => {
        const td = input.parentElement;
        const row = parseInt(td.dataset.row);
        const col = parseInt(td.dataset.col);

        input.onfocus = () => {
            currentCell = { row, col };
            td.classList.add('editing');
            broadcastCursor({ type: 'excel', row, col });
        };

        input.onblur = () => {
            td.classList.remove('editing');
        };

        input.oninput = (e) => {
            const value = e.target.value;
            excelData[row][col] = value;

            // 广播更新
            sendMessage({
                type: 'doc-update',
                docId: currentDoc.id,
                update: {
                    type: 'excel-cell',
                    row: row,
                    col: col,
                    value: value
                }
            });
            
            // 延迟保存完整内容到服务器（防抖，1秒后）
            clearTimeout(window._excelSaveTimeout);
            window._excelSaveTimeout = setTimeout(() => {
                saveExcelContent();
            }, 1000);
        };
    });
}

// 保存Excel完整内容到服务器
function saveExcelContent() {
    if (!currentDoc) return;
    
    console.log('保存Excel完整内容到服务器');
    sendMessage({
        type: 'doc-content-save',
        docId: currentDoc.id,
        content: { data: excelData }
    });
}

// 添加Excel行
function addExcelRow() {
    const cols = excelData[0]?.length || 1;
    excelData.push(new Array(cols).fill(''));
    renderExcelTable();

    sendMessage({
        type: 'doc-update',
        docId: currentDoc.id,
        update: { type: 'excel-add-row' }
    });
    
    // 保存完整内容
    saveExcelContent();
}

// 添加Excel列
function addExcelCol() {
    excelData.forEach(row => row.push(''));
    renderExcelTable();

    sendMessage({
        type: 'doc-update',
        docId: currentDoc.id,
        update: { type: 'excel-add-col' }
    });
    
    // 保存完整内容
    saveExcelContent();
}

// 导出Excel
function exportExcel() {
    if (!currentDoc) return;

    const ws = XLSX.utils.aoa_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, `${currentDoc.title}.xlsx`);
}

// 初始化Quill编辑器
function initQuillEditor() {
    if (!document.querySelector('#quillEditor')) {
        console.log('Quill容器未找到，跳过初始化');
        return;
    }

    try {
        quill = new Quill('#quillEditor', {
            theme: 'snow',
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'color': [] }, { 'background': [] }],
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                    [{ 'align': [] }],
                    ['link', 'image'],
                    ['clean']
                ]
            }
        });

        console.log('Quill编辑器已创建');

        // 延迟绑定事件监听器，确保Quill完全初始化
        setTimeout(() => {
            bindQuillEvents();
            console.log('Quill事件监听器已绑定');
        }, 100);

    } catch (e) {
        console.error('Quill编辑器初始化失败:', e);
    }
}

// 绑定Quill事件监听器
function bindQuillEvents() {
    if (!quill) return;

    // 监听内容变化
    quill.on('text-change', (delta, oldDelta, source) => {
        try {
            // 只有用户操作且不是本地应用远程更新时才广播
            if (source === 'user' && currentDoc && !isLocalChange) {
                console.log('Word内容变化，广播更新:', delta);
                sendMessage({
                    type: 'doc-update',
                    docId: currentDoc.id,
                    update: {
                        type: 'word-delta',
                        delta: delta
                    }
                });
                
                // 延迟保存完整内容到服务器（防抖，1秒后）
                clearTimeout(window._wordSaveTimeout);
                window._wordSaveTimeout = setTimeout(() => {
                    saveWordContent();
                }, 1000);
            }
        } catch (e) {
            console.error('处理Word内容变化时出错:', e);
        }
    });

    // 监听光标位置
    quill.on('selection-change', (range, oldRange, source) => {
        try {
            if (range && currentDoc && source === 'user') {
                console.log('Word光标变化:', range);
                sendMessage({
                    type: 'doc-cursor',
                    docId: currentDoc.id,
                    cursor: { type: 'word', index: range.index, length: range.length }
                });
            }
        } catch (e) {
            console.error('处理Word光标变化时出错:', e);
        }
    });
}

// 初始化Word编辑器
function initWordEditor() {
    if (!currentDoc || !quill) {
        console.log('Word编辑器初始化跳过：文档或编辑器未就绪');
        return;
    }

    console.log('初始化Word编辑器，加载内容');
    
    isLocalChange = true;
    
    // 暂时禁用编辑器
    const wasEnabled = quill.isEnabled();
    quill.disable();
    
    try {
        const content = currentDoc.content.ops || [];
        // 使用'silent'源避免触发不必要的事件
        quill.setContents(content, 'silent');
        console.log('Word内容加载成功');
    } catch (e) {
        console.error('Word内容加载失败:', e);
    } finally {
        // 恢复编辑器状态
        if (wasEnabled) {
            quill.enable();
        } else {
            // 默认启用编辑器
            quill.enable();
        }
        isLocalChange = false;
    }
}

// 保存Word完整内容到服务器
function saveWordContent() {
    if (!currentDoc || !quill) return;
    
    try {
        const contents = quill.getContents();
        console.log('保存Word完整内容到服务器');
        
        sendMessage({
            type: 'doc-content-save',
            docId: currentDoc.id,
            content: contents
        });
    } catch (e) {
        console.error('保存Word内容失败:', e);
    }
}

// 导出Word
function exportWord() {
    if (!currentDoc || !quill) return;

    const content = quill.root.innerHTML;
    const blob = new Blob([`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>${currentDoc.title}</title>
        </head>
        <body>${content}</body>
        </html>
    `], { type: 'application/msword' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentDoc.title}.doc`;
    a.click();
    URL.revokeObjectURL(url);
}

// 应用远程更新
function applyRemoteUpdate(msg) {
    const update = msg.update;

    if (update.type === 'excel-cell') {
        excelData[update.row][update.col] = update.value;
        const input = document.querySelector(`td[data-row="${update.row}"][data-col="${update.col}"] input`);
        if (input && document.activeElement !== input) {
            input.value = update.value;
        }
    } else if (update.type === 'excel-add-row') {
        const cols = excelData[0]?.length || 1;
        excelData.push(new Array(cols).fill(''));
        renderExcelTable();
    } else if (update.type === 'excel-add-col') {
        excelData.forEach(row => row.push(''));
        renderExcelTable();
    } else if (update.type === 'word-delta' && quill) {
        console.log('应用Word远程更新:', update.delta);
        
        // 检查delta是否有效
        if (!update.delta || !update.delta.ops) {
            console.error('无效的delta:', update.delta);
            return;
        }
        
        // 检查quill是否可用
        if (!quill || typeof quill.updateContents !== 'function') {
            console.error('Quill编辑器未就绪');
            return;
        }
        
        // 应用远程更新的安全方法
        applyWordRemoteUpdate(update.delta);
    }
}

// 安全地应用Word远程更新
function applyWordRemoteUpdate(delta) {
    if (!quill || !delta) return;
    
    isLocalChange = true;
    
    // 暂时禁用编辑器，避免触发事件
    const wasEnabled = quill.isEnabled();
    
    try {
        // 禁用编辑器（这会阻止事件触发）
        quill.disable();
        
        // 应用更新
        quill.updateContents(delta, 'silent');
        
        console.log('Word更新成功');
    } catch (e) {
        console.error('Word更新失败:', e);
    } finally {
        // 恢复编辑器状态
        if (wasEnabled) {
            quill.enable();
        }
        isLocalChange = false;
    }
}

// 广播光标位置
function broadcastCursor(cursor) {
    if (!currentDoc) return;

    broadcastMessage({
        type: 'doc-cursor',
        docId: currentDoc.id,
        cursor: cursor
    });
}

// 存储Word光标
const wordCursors = {};

// 更新光标
function updateCursor(userId, cursor) {
    const name = onlineUsers[userId] || '未知用户';

    if (cursor.type === 'excel') {
        // Excel光标
        const td = document.querySelector(`td[data-row="${cursor.row}"][data-col="${cursor.col}"]`);
        if (td) {
            // 移除该用户之前的光标
            document.querySelectorAll(`.has-cursor[data-user-id="${userId}"]`).forEach(el => {
                el.classList.remove('has-cursor');
                delete el.dataset.userId;
                delete el.dataset.userName;
            });

            td.classList.add('has-cursor');
            td.dataset.userId = userId;
            td.dataset.userName = name;
            
            // 设置光标颜色（使用用户专属颜色）
            const color = getUserColorHex(userId);
            td.style.setProperty('--cursor-color', color);
        }
    } else if (cursor.type === 'word' && quill) {
        // Word光标 - 显示其他用户的光标
        updateWordCursor(userId, cursor.index, cursor.length || 0, name);
    }
}

// 更新Word光标
function updateWordCursor(userId, index, length, name) {
    if (!quill) return;
    
    const color = getUserColorHex(userId);
    
    // 移除旧光标
    if (wordCursors[userId]) {
        wordCursors[userId].clear();
    }
    
    // 创建新光标
    try {
        // 创建光标元素
        const cursorId = `cursor-${userId}`;
        
        // 移除旧的光标元素
        const oldCursor = document.getElementById(cursorId);
        if (oldCursor) {
            oldCursor.remove();
        }
        
        // 获取光标位置
        const bounds = quill.getBounds(index, length);
        
        if (bounds) {
            // 创建光标元素
            const cursorEl = document.createElement('div');
            cursorEl.id = cursorId;
            cursorEl.className = 'word-cursor';
            cursorEl.style.cssText = `
                position: absolute;
                left: ${bounds.left}px;
                top: ${bounds.top}px;
                height: ${bounds.height}px;
                width: 2px;
                background: ${color};
                pointer-events: none;
                z-index: 1000;
                animation: cursorBlink 1s infinite;
            `;
            
            // 创建用户名标签
            const label = document.createElement('div');
            label.className = 'word-cursor-label';
            label.textContent = name;
            label.style.cssText = `
                position: absolute;
                left: 0;
                top: -22px;
                background: ${color};
                color: white;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 11px;
                white-space: nowrap;
                font-weight: 600;
            `;
            
            cursorEl.appendChild(label);
            
            // 获取或创建光标容器（关键：在编辑器外部！）
            let cursorContainer = document.getElementById('word-cursors-container');
            if (!cursorContainer) {
                cursorContainer = document.createElement('div');
                cursorContainer.id = 'word-cursors-container';
                const editorWrapper = document.getElementById('quillEditor');
                if (editorWrapper) {
                    editorWrapper.appendChild(cursorContainer);
                    console.log('Word光标容器已创建');
                }
            }
            
            if (cursorContainer) {
                const editorEl = document.querySelector('#quillEditor .ql-editor');
                
                // 计算偏移（考虑工具栏和边距）
                const offsetLeft = 12;  // 左边距
                const offsetTop = 42;   // 工具栏高度
                const scrollTop = editorEl ? editorEl.scrollTop : 0;
                const scrollLeft = editorEl ? editorEl.scrollLeft : 0;
                
                cursorEl.style.left = (bounds.left - scrollLeft + offsetLeft) + 'px';
                cursorEl.style.top = (bounds.top - scrollTop + offsetTop) + 'px';
                
                // 添加到容器（不触发Quill的DOM监控）
                cursorContainer.appendChild(cursorEl);
                
                // 保存引用
                wordCursors[userId] = {
                    element: cursorEl,
                    clear: () => {
                        if (cursorEl.parentNode) {
                            cursorEl.parentNode.removeChild(cursorEl);
                        }
                    }
                };
                
                // 5秒后自动移除
                setTimeout(() => {
                    if (wordCursors[userId] && wordCursors[userId].element === cursorEl) {
                        wordCursors[userId].clear();
                        delete wordCursors[userId];
                    }
                }, 5000);
            }
        }
    } catch (e) {
        console.error('更新Word光标失败:', e);
    }
}

// 获取用户颜色（十六进制）
function getUserColorHex(userId) {
    const colors = [
        '#667eea', '#f5576c', '#00f2fe', '#38f9d7',
        '#fee140', '#330867', '#fed6e3', '#fecfef'
    ];
    
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

// 移除光标
function removeCursor(userId) {
    // 移除Excel光标
    document.querySelectorAll(`[data-user-id="${userId}"]`).forEach(el => {
        el.classList.remove('has-cursor');
        delete el.dataset.userId;
    });
    
    // 移除Word光标
    if (wordCursors[userId]) {
        wordCursors[userId].clear();
        delete wordCursors[userId];
    }
}

// 更新编辑器用户列表
function updateEditorUsers(userIds) {
    const listEl = document.getElementById('editorUsersList');
    if (!listEl) return;
    
    listEl.innerHTML = '';
    
    // 限制显示最多5个用户头像
    const maxShow = 5;
    const showCount = Math.min(userIds.length, maxShow);
    
    for (let i = 0; i < showCount; i++) {
        const userId = userIds[i];
        const name = onlineUsers[userId] || '未知用户';
        const avatarEl = document.createElement('div');
        avatarEl.className = 'editor-user-avatar';
        avatarEl.textContent = getAvatarText(name);
        avatarEl.setAttribute('data-name', name);
        avatarEl.style.background = getUserColor(userId);
        listEl.appendChild(avatarEl);
    }
    
    // 如果超过5个，显示+N
    if (userIds.length > maxShow) {
        const countEl = document.createElement('div');
        countEl.className = 'editor-user-count';
        countEl.textContent = `+${userIds.length - maxShow}`;
        listEl.appendChild(countEl);
    }
}

// 根据用户ID生成颜色
function getUserColor(userId) {
    const colors = [
        'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
        'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
        'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
        'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
        'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
    ];
    
    // 根据userId计算颜色索引
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

// 工具函数
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getColumnLabel(index) {
    let label = '';
    while (index >= 0) {
        label = String.fromCharCode(65 + (index % 26)) + label;
        index = Math.floor(index / 26) - 1;
    }
    return label;
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');

    if (now.getFullYear() === year) {
        return `${month}-${day} ${hour}:${minute}`;
    }
    return `${year}-${month}-${day}`;
}

// 启动
window.addEventListener('DOMContentLoaded', init);

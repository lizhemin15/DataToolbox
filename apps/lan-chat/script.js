// 全局状态
let ws = null;
let isServerMode = false;
let myId = null;
let myName = '用户' + Math.floor(Math.random() * 10000);
let currentChatId = null;
let peers = new Map(); // 存储所有在线用户
let messages = new Map(); // 存储每个用户的消息历史

// 表情列表
const emojis = ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾'];

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    checkServerMode();
    setupEventListeners();
    loadUserName();
});

// 检测是否为服务器模式
async function checkServerMode() {
    try {
        // 尝试连接 WebSocket
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/chat`;
        
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            isServerMode = true;
            hideServerModal();
            updateStatus('online');
            console.log('WebSocket已连接');
        };
        
        ws.onmessage = handleWebSocketMessage;
        
        ws.onerror = () => {
            showServerModal();
        };
        
        ws.onclose = () => {
            if (isServerMode) {
                updateStatus('offline');
                setTimeout(checkServerMode, 3000); // 3秒后重连
            }
        };
    } catch (error) {
        showServerModal();
    }
}

// 处理 WebSocket 消息
function handleWebSocketMessage(event) {
    try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
            case 'registered':
                myId = data.id;
                console.log('已注册，我的ID:', myId);
                
                // 立即发送register消息设置昵称
                sendWsMessage({
                    type: 'register',
                    name: myName
                });
                console.log('已发送昵称注册:', myName);
                break;
                
            case 'peer-list':
                console.log('收到用户列表:', data.peers, '我的ID:', myId);
                updatePeerList(data.peers);
                break;
                
            case 'peer-join':
                console.log('新用户加入:', data.peer);
                addPeer(data.peer);
                addSystemMessage(data.peer.id, `${data.peer.name} 上线了`);
                break;
                
            case 'peer-leave':
                removePeer(data.id);
                addSystemMessage(data.id, `用户已离线`);
                break;
                
            case 'message':
                receiveMessage(data);
                break;
                
            case 'shake':
                receiveShake(data);
                break;
                
            case 'game-invite':
                receiveGameInvite(data);
                break;
                
            case 'game-accept':
                receiveGameAccept(data);
                break;
                
            case 'game-reject':
                receiveGameReject(data);
                break;
                
            case 'game-move':
                receiveGameMove(data);
                break;
                
            case 'game-over':
                receiveGameOver(data);
                break;
                
            case 'file-offer':
                receiveFileOffer(data);
                break;
        }
    } catch (error) {
        console.error('处理消息失败:', error);
    }
}

// 发送 WebSocket 消息
function sendWsMessage(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// 更新用户列表
function updatePeerList(peerList) {
    peers.clear();
    peerList.forEach(peer => {
        if (peer.id !== myId) {
            peers.set(peer.id, peer);
        }
    });
    console.log('用户列表已更新，当前在线用户:', Array.from(peers.values()).map(p => p.name).join(', '));
    
    renderChatList();
    
    // 如果当前正在聊天，更新聊天头部显示的名字
    if (currentChatId && peers.has(currentChatId)) {
        const peer = peers.get(currentChatId);
        console.log('更新聊天头部，当前聊天对象:', peer.name);
        updateChatHeader();
    }
}

// 添加用户
function addPeer(peer) {
    if (peer.id !== myId) {
        peers.set(peer.id, peer);
        renderChatList();
    }
}

// 移除用户
function removePeer(peerId) {
    peers.delete(peerId);
    renderChatList();
    
    if (currentChatId === peerId) {
        currentChatId = null;
        showWelcomeScreen();
    }
}

// 渲染聊天列表
function renderChatList() {
    const chatList = document.getElementById('chatList');
    
    if (peers.size === 0) {
        chatList.innerHTML = '<div class="system-message">暂无在线用户</div>';
        return;
    }
    
    chatList.innerHTML = Array.from(peers.values()).map(peer => {
        const peerMessages = messages.get(peer.id) || [];
        const lastMessage = peerMessages[peerMessages.length - 1];
        const unreadCount = peerMessages.filter(m => !m.read && m.from === peer.id).length;
        
        return `
            <div class="chat-item ${currentChatId === peer.id ? 'active' : ''}" 
                 onclick="selectChat('${peer.id}')">
                <div class="avatar">${getAvatarText(peer.name)}</div>
                <div class="chat-item-content">
                    <div class="chat-item-header">
                        <div class="chat-item-name">${peer.name}</div>
                        ${lastMessage ? `<div class="chat-item-time">${formatTime(lastMessage.timestamp)}</div>` : ''}
                    </div>
                    ${lastMessage ? `<div class="chat-item-message">${getMessagePreview(lastMessage)}</div>` : '<div class="chat-item-message">开始聊天</div>'}
                </div>
                ${unreadCount > 0 ? `<div class="unread-badge">${unreadCount}</div>` : ''}
            </div>
        `;
    }).join('');
}

// 选择聊天
function selectChat(peerId) {
    currentChatId = peerId;
    
    // 标记消息已读
    const peerMessages = messages.get(peerId) || [];
    peerMessages.forEach(m => m.read = true);
    
    renderChatList();
    renderChatArea();
    document.getElementById('inputArea').style.display = 'block';
    document.getElementById('inputBox').focus();
}

// 渲染聊天区域
function renderChatArea() {
    const peer = peers.get(currentChatId);
    if (!peer) return;
    
    // 更新标题
    updateChatHeader();
    
    // 渲染消息
    renderMessages();
}

// 更新聊天头部（单独函数，用于昵称更新）
function updateChatHeader() {
    const peer = peers.get(currentChatId);
    if (!peer) return;
    
    document.getElementById('chatHeader').innerHTML = `
        <div class="chat-title">${peer.name}</div>
    `;
}

// 渲染消息列表
function renderMessages() {
    const container = document.getElementById('messageContainer');
    const peerMessages = messages.get(currentChatId) || [];
    
    if (peerMessages.length === 0) {
        container.innerHTML = '<div class="system-message">暂无消息</div>';
        return;
    }
    
    container.innerHTML = peerMessages.map(msg => {
        if (msg.type === 'system') {
            return `<div class="system-message">${msg.content}</div>`;
        }
        
        const isSelf = msg.from === myId;
        const name = isSelf ? myName : peers.get(msg.from)?.name || '未知用户';
        
        let content = '';
        if (msg.contentType === 'text') {
            content = `<div class="message-bubble">${escapeHtml(msg.content)}</div>`;
        } else if (msg.contentType === 'image') {
            content = `<img class="message-image" src="${msg.content}" onclick="viewImage('${msg.content}')">`;
        } else if (msg.contentType === 'file') {
            const fileData = JSON.parse(msg.content);
            content = `
                <div class="message-file" onclick="downloadFile('${msg.id}')">
                    <div class="file-icon">📎</div>
                    <div class="file-info">
                        <div class="file-name">${fileData.name}</div>
                        <div class="file-size">${formatFileSize(fileData.size)}</div>
                    </div>
                </div>
            `;
        }
        
        return `
            <div class="message-group ${isSelf ? 'self' : ''}">
                <div class="message-avatar">${getAvatarText(name)}</div>
                <div class="message-content-wrapper">
                    ${content}
                    <div class="message-time">${formatTime(msg.timestamp)}</div>
                </div>
            </div>
        `;
    }).join('');
    
    // 滚动到底部
    container.scrollTop = container.scrollHeight;
}

// 显示欢迎屏幕
function showWelcomeScreen() {
    document.getElementById('chatHeader').innerHTML = '<div class="chat-title">选择联系人开始聊天</div>';
    document.getElementById('messageContainer').innerHTML = `
        <div class="welcome-screen">
            <div class="welcome-icon">💬</div>
            <h2>局域网聊天</h2>
            <p>启动服务器版本后，局域网内的设备将自动发现</p>
            <p>选择左侧联系人开始聊天</p>
        </div>
    `;
    document.getElementById('inputArea').style.display = 'none';
}

// 发送消息
function sendMessage() {
    if (!currentChatId) return;
    
    const inputBox = document.getElementById('inputBox');
    const content = inputBox.textContent.trim();
    
    if (!content) return;
    
    const message = {
        type: 'message',
        to: currentChatId,
        contentType: 'text',
        content: content,
        timestamp: Date.now()
    };
    
    sendWsMessage(message);
    
    // 添加到本地消息列表
    addMessage(currentChatId, {
        id: generateId(),
        from: myId,
        contentType: 'text',
        content: content,
        timestamp: message.timestamp,
        read: true
    });
    
    inputBox.textContent = '';
    renderMessages();
    renderChatList();
}

// 接收消息
function receiveMessage(data) {
    console.log('收到消息:', data);
    
    addMessage(data.from, {
        id: data.id || generateId(),
        from: data.from,
        contentType: data.contentType,
        content: data.content,
        timestamp: data.timestamp,
        read: data.from === currentChatId
    });
    
    if (data.from === currentChatId) {
        renderMessages();
    }
    
    renderChatList();
}

// 添加消息到历史
function addMessage(peerId, message) {
    if (!messages.has(peerId)) {
        messages.set(peerId, []);
    }
    messages.get(peerId).push(message);
}

// 添加系统消息
function addSystemMessage(peerId, content) {
    addMessage(peerId, {
        type: 'system',
        content: content,
        timestamp: Date.now()
    });
    
    if (peerId === currentChatId) {
        renderMessages();
    }
}

// 发送图片
function sendImage(file) {
    if (!currentChatId) return;
    
    // 检查文件大小（建议不超过10MB）
    if (file.size > 10 * 1024 * 1024) {
        showToast('图片大小不能超过10MB', 'warning');
        return;
    }
    
    const reader = new FileReader();
    
    reader.onload = (e) => {
        const message = {
            type: 'message',
            to: currentChatId,
            contentType: 'image',
            content: e.target.result,
            timestamp: Date.now()
        };
        
        sendWsMessage(message);
        
        addMessage(currentChatId, {
            id: generateId(),
            from: myId,
            contentType: 'image',
            content: e.target.result,
            timestamp: message.timestamp,
            read: true
        });
        
        renderMessages();
        renderChatList();
        showToast('图片已发送', 'success');
    };
    
    reader.onerror = () => {
        showToast('图片读取失败', 'error');
    };
    
    reader.readAsDataURL(file);
}

// 发送文件
function sendFile(file) {
    if (!currentChatId) return;
    
    // 检查文件大小（建议不超过50MB）
    if (file.size > 50 * 1024 * 1024) {
        showToast('文件大小不能超过50MB', 'warning');
        return;
    }
    
    const reader = new FileReader();
    
    reader.onload = (e) => {
        const fileData = {
            name: file.name,
            size: file.size,
            type: file.type,
            data: e.target.result
        };
        
        const message = {
            type: 'message',
            to: currentChatId,
            contentType: 'file',
            content: JSON.stringify(fileData),
            timestamp: Date.now()
        };
        
        sendWsMessage(message);
        
        addMessage(currentChatId, {
            id: generateId(),
            from: myId,
            contentType: 'file',
            content: JSON.stringify(fileData),
            timestamp: message.timestamp,
            read: true
        });
        
        renderMessages();
        renderChatList();
        showToast(`文件"${file.name}"已发送`, 'success');
    };
    
    reader.onerror = () => {
        showToast('文件读取失败', 'error');
    };
    
    reader.readAsDataURL(file);
}

// 事件监听
function setupEventListeners() {
    const inputBox = document.getElementById('inputBox');
    const messageContainer = document.getElementById('messageContainer');
    
    // 发送按钮
    document.getElementById('sendBtn').addEventListener('click', sendMessage);
    
    // 回车发送
    inputBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // 粘贴事件 - 支持粘贴图片
    inputBox.addEventListener('paste', handlePaste);
    
    // 拖拽事件 - 支持拖拽文件
    messageContainer.addEventListener('dragover', handleDragOver);
    messageContainer.addEventListener('drop', handleDrop);
    messageContainer.addEventListener('dragleave', handleDragLeave);
    
    // 表情按钮
    document.getElementById('emojiBtn').addEventListener('click', toggleEmojiPicker);
    
    // 图片按钮
    document.getElementById('imageBtn').addEventListener('click', () => {
        document.getElementById('imageInput').click();
    });
    
    document.getElementById('imageInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            sendImage(file);
            e.target.value = '';
        }
    });
    
    // 文件按钮
    document.getElementById('fileBtn').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });
    
    document.getElementById('fileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            sendFile(file);
            e.target.value = '';
        }
    });
    
    // 抖一抖按钮
    document.getElementById('shakeBtn').addEventListener('click', () => {
        if (!currentChatId) {
            showToast('请先选择一个联系人', 'warning');
            return;
        }
        sendShake();
    });
    
    // 游戏按钮
    document.getElementById('gameBtn').addEventListener('click', () => {
        if (!currentChatId) {
            showToast('请先选择一个联系人', 'warning');
            return;
        }
        showGameMenu();
    });
    
    // 渲染表情选择器
    renderEmojiPicker();
    
    // 点击外部关闭表情选择器
    document.addEventListener('click', (e) => {
        const picker = document.getElementById('emojiPicker');
        const btn = document.getElementById('emojiBtn');
        if (!picker.contains(e.target) && e.target !== btn) {
            picker.style.display = 'none';
        }
    });
}

// 渲染表情选择器
function renderEmojiPicker() {
    const grid = document.querySelector('.emoji-grid');
    grid.innerHTML = emojis.map(emoji => 
        `<div class="emoji-item" onclick="insertEmoji('${emoji}')">${emoji}</div>`
    ).join('');
}

// 切换表情选择器
function toggleEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
}

// 插入表情
function insertEmoji(emoji) {
    const inputBox = document.getElementById('inputBox');
    inputBox.textContent += emoji;
    inputBox.focus();
    
    // 光标移到最后
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(inputBox);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
}

// 查看图片
function viewImage(src) {
    const viewer = document.createElement('div');
    viewer.className = 'image-viewer';
    viewer.innerHTML = `
        <div class="image-viewer-overlay"></div>
        <div class="image-viewer-content">
            <button class="image-viewer-close">×</button>
            <img src="${src}" alt="查看图片">
        </div>
    `;
    
    document.body.appendChild(viewer);
    
    // 动画显示
    setTimeout(() => viewer.classList.add('show'), 10);
    
    // 点击关闭按钮
    viewer.querySelector('.image-viewer-close').addEventListener('click', () => {
        viewer.classList.remove('show');
        setTimeout(() => viewer.remove(), 300);
    });
    
    // 点击背景关闭
    viewer.querySelector('.image-viewer-overlay').addEventListener('click', () => {
        viewer.classList.remove('show');
        setTimeout(() => viewer.remove(), 300);
    });
    
    // ESC键关闭
    const handleEsc = (e) => {
        if (e.key === 'Escape') {
            viewer.classList.remove('show');
            setTimeout(() => viewer.remove(), 300);
            document.removeEventListener('keydown', handleEsc);
        }
    };
    document.addEventListener('keydown', handleEsc);
}

// 下载文件
function downloadFile(messageId) {
    const peerMessages = messages.get(currentChatId) || [];
    const message = peerMessages.find(m => m.id === messageId);
    
    if (message && message.contentType === 'file') {
        const fileData = JSON.parse(message.content);
        const link = document.createElement('a');
        link.href = fileData.data;
        link.download = fileData.name;
        link.click();
    }
}

// 工具函数
function getAvatarText(name) {
    return name.charAt(0).toUpperCase();
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) {
        return '刚刚';
    } else if (diff < 3600000) {
        return Math.floor(diff / 60000) + '分钟前';
    } else if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } else {
        return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    }
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function getMessagePreview(message) {
    if (message.type === 'system') return message.content;
    if (message.contentType === 'text') return message.content;
    if (message.contentType === 'image') return '[图片]';
    if (message.contentType === 'file') {
        const fileData = JSON.parse(message.content);
        return `[文件] ${fileData.name}`;
    }
    return '';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function generateId() {
    return Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function updateStatus(status) {
    const indicator = document.getElementById('statusIndicator');
    const dot = indicator.querySelector('.status-dot');
    const text = indicator.querySelector('.status-text');
    
    if (status === 'online') {
        dot.classList.remove('offline');
        dot.classList.add('online');
        text.textContent = '在线';
    } else {
        dot.classList.remove('online');
        dot.classList.add('offline');
        text.textContent = '离线';
    }
}

function showServerModal() {
    document.getElementById('serverModal').style.display = 'flex';
}

function hideServerModal() {
    document.getElementById('serverModal').style.display = 'none';
}

function loadUserName() {
    const saved = localStorage.getItem('lan-chat-username');
    if (saved) {
        myName = saved;
    }
    document.getElementById('myName').textContent = myName;
    document.getElementById('myAvatar').textContent = getAvatarText(myName);
}

// 修改用户名
document.getElementById('myName').addEventListener('click', () => {
    const newName = prompt('请输入新昵称', myName);
    if (newName && newName.trim()) {
        const oldName = myName;
        myName = newName.trim();
        localStorage.setItem('lan-chat-username', myName);
        document.getElementById('myName').textContent = myName;
        document.getElementById('myAvatar').textContent = getAvatarText(myName);
        
        console.log('昵称已更新:', oldName, '->', myName);
        
        // 通知服务器更新昵称
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendWsMessage({
                type: 'update-name',
                name: myName
            });
            console.log('已通知服务器更新昵称');
        }
    }
});

// 处理粘贴事件
function handlePaste(e) {
    if (!currentChatId) return;
    
    const items = e.clipboardData.items;
    
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // 检测图片
        if (item.type.indexOf('image') !== -1) {
            e.preventDefault();
            const file = item.getAsFile();
            
            // 显示预览确认框
            showImagePreview(file, (confirmed) => {
                if (confirmed) {
                    sendImage(file);
                }
            });
            break;
        }
    }
}

// 处理拖拽悬停
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!currentChatId) return;
    
    // 添加拖拽样式
    const container = document.getElementById('messageContainer');
    container.classList.add('drag-over');
    
    e.dataTransfer.dropEffect = 'copy';
}

// 处理拖拽离开
function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const container = document.getElementById('messageContainer');
    
    // 只有真正离开容器时才移除样式
    if (e.target === container) {
        container.classList.remove('drag-over');
    }
}

// 处理文件拖放
function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const container = document.getElementById('messageContainer');
    container.classList.remove('drag-over');
    
    if (!currentChatId) {
        showToast('请先选择一个联系人', 'warning');
        return;
    }
    
    const files = Array.from(e.dataTransfer.files);
    
    if (files.length === 0) return;
    
    // 处理多个文件
    if (files.length > 1) {
        showMultiFileConfirm(files, (confirmed, selectedFiles) => {
            if (confirmed) {
                selectedFiles.forEach((file, index) => {
                    setTimeout(() => {
                        if (file.type.startsWith('image/')) {
                            sendImage(file);
                        } else {
                            sendFile(file);
                        }
                    }, index * 100); // 间隔100ms发送，避免阻塞
                });
            }
        });
    } else {
        const file = files[0];
        
        // 判断是图片还是其他文件
        if (file.type.startsWith('image/')) {
            showImagePreview(file, (confirmed) => {
                if (confirmed) {
                    sendImage(file);
                }
            });
        } else {
            showFileConfirm(file, (confirmed) => {
                if (confirmed) {
                    sendFile(file);
                }
            });
        }
    }
}

// 显示图片预览
function showImagePreview(file, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const preview = document.createElement('div');
        preview.className = 'file-preview-modal';
        preview.innerHTML = `
            <div class="preview-content">
                <div class="preview-header">
                    <span>发送图片</span>
                    <button class="preview-close" onclick="this.parentElement.parentElement.parentElement.remove()">×</button>
                </div>
                <div class="preview-body">
                    <img src="${e.target.result}" style="max-width: 100%; max-height: 400px; border-radius: 8px;">
                </div>
                <div class="preview-footer">
                    <button class="btn-cancel" onclick="this.parentElement.parentElement.parentElement.remove()">取消</button>
                    <button class="btn-send">发送</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(preview);
        
        preview.querySelector('.btn-send').addEventListener('click', () => {
            preview.remove();
            callback(true);
        });
        
        preview.querySelector('.btn-cancel').addEventListener('click', () => {
            preview.remove();
            callback(false);
        });
        
        preview.addEventListener('click', (e) => {
            if (e.target === preview) {
                preview.remove();
                callback(false);
            }
        });
    };
    reader.readAsDataURL(file);
}

// 显示文件确认
function showFileConfirm(file, callback) {
    const preview = document.createElement('div');
    preview.className = 'file-preview-modal';
    preview.innerHTML = `
        <div class="preview-content">
            <div class="preview-header">
                <span>发送文件</span>
                <button class="preview-close" onclick="this.parentElement.parentElement.parentElement.remove()">×</button>
            </div>
            <div class="preview-body">
                <div style="text-align: center; padding: 40px;">
                    <div style="font-size: 48px; margin-bottom: 16px;">📎</div>
                    <div style="font-size: 16px; font-weight: 500; margin-bottom: 8px;">${escapeHtml(file.name)}</div>
                    <div style="font-size: 14px; color: #999;">${formatFileSize(file.size)}</div>
                </div>
            </div>
            <div class="preview-footer">
                <button class="btn-cancel" onclick="this.parentElement.parentElement.parentElement.remove()">取消</button>
                <button class="btn-send">发送</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(preview);
    
    preview.querySelector('.btn-send').addEventListener('click', () => {
        preview.remove();
        callback(true);
    });
    
    preview.querySelector('.btn-cancel').addEventListener('click', () => {
        preview.remove();
        callback(false);
    });
    
    preview.addEventListener('click', (e) => {
        if (e.target === preview) {
            preview.remove();
            callback(false);
        }
    });
}

// 显示多文件确认
function showMultiFileConfirm(files, callback) {
    const preview = document.createElement('div');
    preview.className = 'file-preview-modal';
    
    const fileListHTML = files.map((file, index) => `
        <div class="multi-file-item">
            <div class="file-icon-small">${file.type.startsWith('image/') ? '🖼️' : '📎'}</div>
            <div class="file-info-small">
                <div class="file-name-small">${escapeHtml(file.name)}</div>
                <div class="file-size-small">${formatFileSize(file.size)}</div>
            </div>
        </div>
    `).join('');
    
    preview.innerHTML = `
        <div class="preview-content">
            <div class="preview-header">
                <span>发送 ${files.length} 个文件</span>
                <button class="preview-close" onclick="this.parentElement.parentElement.parentElement.remove()">×</button>
            </div>
            <div class="preview-body">
                <div class="multi-file-list">
                    ${fileListHTML}
                </div>
            </div>
            <div class="preview-footer">
                <button class="btn-cancel">取消</button>
                <button class="btn-send">全部发送</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(preview);
    
    preview.querySelector('.btn-send').addEventListener('click', () => {
        preview.remove();
        callback(true, files);
        showToast(`正在发送 ${files.length} 个文件...`, 'info');
    });
    
    preview.querySelector('.btn-cancel').addEventListener('click', () => {
        preview.remove();
        callback(false, []);
    });
    
    preview.querySelector('.preview-close').addEventListener('click', () => {
        preview.remove();
        callback(false, []);
    });
    
    preview.addEventListener('click', (e) => {
        if (e.target === preview) {
            preview.remove();
            callback(false, []);
        }
    });
}

// 显示提示信息
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
        info: 'ℹ️',
        success: '✅',
        warning: '⚠️',
        error: '❌'
    };
    
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${message}</span>
    `;
    
    document.body.appendChild(toast);
    
    // 动画显示
    setTimeout(() => toast.classList.add('show'), 10);
    
    // 3秒后自动关闭
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ========== 抖一抖功能 ==========

// 发送抖一抖
function sendShake() {
    if (!currentChatId) return;
    
    const message = {
        type: 'shake',
        to: currentChatId,
        timestamp: Date.now()
    };
    
    sendWsMessage(message);
    showToast('已发送抖一抖', 'success');
    
    // 添加系统消息
    addMessage(currentChatId, {
        type: 'system',
        content: '你发送了一个抖动',
        timestamp: Date.now()
    });
    renderMessages();
}

// 接收抖一抖
function receiveShake(data) {
    const peer = peers.get(data.from);
    const peerName = peer ? peer.name : '对方';
    
    // 窗口抖动效果
    shakeWindow();
    
    // 播放提示音（可选）
    playShakeSound();
    
    // 显示提示
    showToast(`${peerName} 给你发送了抖动！`, 'warning');
    
    // 添加系统消息
    addMessage(data.from, {
        type: 'system',
        content: `${peerName} 给你发送了一个抖动`,
        timestamp: data.timestamp || Date.now()
    });
    
    if (data.from === currentChatId) {
        renderMessages();
    }
    renderChatList();
}

// 窗口抖动动画
function shakeWindow() {
    const container = document.querySelector('.app-container');
    container.classList.add('shake-animation');
    
    setTimeout(() => {
        container.classList.remove('shake-animation');
    }, 500);
}

// 播放抖动音效
function playShakeSound() {
    // 使用Web Audio API生成简单的提示音
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
        console.log('无法播放音效:', e);
    }
}

// ========== 游戏功能 ==========

let currentGame = null;

// 显示游戏菜单
function showGameMenu() {
    const menu = document.createElement('div');
    menu.className = 'game-menu-modal';
    menu.innerHTML = `
        <div class="game-menu-content">
            <div class="game-menu-header">
                <span>选择游戏</span>
                <button class="game-menu-close">×</button>
            </div>
            <div class="game-menu-body">
                <div class="game-category">
                    <div class="game-category-title">🎯 策略棋类</div>
                    <div class="game-option" onclick="inviteGame('gomoku')">
                        <div class="game-icon">⚫</div>
                        <div class="game-info">
                            <div class="game-name">五子棋</div>
                            <div class="game-desc">连成五子获胜</div>
                        </div>
                    </div>
                    <div class="game-option" onclick="inviteGame('tictactoe')">
                        <div class="game-icon">⭕</div>
                        <div class="game-info">
                            <div class="game-name">井字棋</div>
                            <div class="game-desc">经典三连棋</div>
                        </div>
                    </div>
                    <div class="game-option" onclick="inviteGame('weiqi')">
                        <div class="game-icon">⚪</div>
                        <div class="game-info">
                            <div class="game-name">围棋</div>
                            <div class="game-desc">古老的策略游戏</div>
                        </div>
                    </div>
                    <div class="game-option" onclick="inviteGame('xiangqi')">
                        <div class="game-icon">♟️</div>
                        <div class="game-info">
                            <div class="game-name">象棋</div>
                            <div class="game-desc">中国传统棋类</div>
                        </div>
                    </div>
                </div>
                
                <div class="game-category">
                    <div class="game-category-title">⚡ 快速对战</div>
                    <div class="game-option" onclick="inviteGame('rps')">
                        <div class="game-icon">✊</div>
                        <div class="game-info">
                            <div class="game-name">石头剪刀布</div>
                            <div class="game-desc">经典猜拳游戏</div>
                        </div>
                    </div>
                    <div class="game-option" onclick="inviteGame('numberbomb')">
                        <div class="game-icon">💣</div>
                        <div class="game-info">
                            <div class="game-name">数字炸弹</div>
                            <div class="game-desc">猜数字避开炸弹</div>
                        </div>
                    </div>
                    <div class="game-option" onclick="inviteGame('reaction')">
                        <div class="game-icon">⚡</div>
                        <div class="game-info">
                            <div class="game-name">反应力测试</div>
                            <div class="game-desc">比拼反应速度</div>
                        </div>
                    </div>
                </div>
                
                <div class="game-category">
                    <div class="game-category-title">🎨 休闲益智</div>
                    <div class="game-option" onclick="inviteGame('drawguess')">
                        <div class="game-icon">🎨</div>
                        <div class="game-info">
                            <div class="game-name">你画我猜</div>
                            <div class="game-desc">创意绘画猜词</div>
                        </div>
                    </div>
                    <div class="game-option" onclick="inviteGame('memory')">
                        <div class="game-icon">🧠</div>
                        <div class="game-info">
                            <div class="game-name">记忆翻牌</div>
                            <div class="game-desc">考验记忆力</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(menu);
    setTimeout(() => menu.classList.add('show'), 10);
    
    menu.querySelector('.game-menu-close').addEventListener('click', () => {
        menu.classList.remove('show');
        setTimeout(() => menu.remove(), 300);
    });
    
    menu.addEventListener('click', (e) => {
        if (e.target === menu) {
            menu.classList.remove('show');
            setTimeout(() => menu.remove(), 300);
        }
    });
}

// 游戏名称映射
const gameNames = {
    'gomoku': '五子棋',
    'tictactoe': '井字棋',
    'weiqi': '围棋',
    'xiangqi': '象棋',
    'rps': '石头剪刀布',
    'numberbomb': '数字炸弹',
    'reaction': '反应力测试',
    'drawguess': '你画我猜',
    'memory': '记忆翻牌'
};

// 邀请游戏
function inviteGame(gameType) {
    document.querySelector('.game-menu-modal').remove();
    
    const message = {
        type: 'game-invite',
        to: currentChatId,
        gameType: gameType,
        timestamp: Date.now()
    };
    
    sendWsMessage(message);
    
    const gameName = gameNames[gameType] || '未知游戏';
    showToast(`已发送${gameName}邀请`, 'info');
    
    addMessage(currentChatId, {
        type: 'system',
        content: `你邀请对方玩${gameName}`,
        timestamp: Date.now()
    });
    renderMessages();
}

// 接收游戏邀请
function receiveGameInvite(data) {
    const peer = peers.get(data.from);
    const peerName = peer ? peer.name : '对方';
    const gameName = gameNames[data.gameType] || '未知游戏';
    
    const invite = document.createElement('div');
    invite.className = 'game-invite-modal';
    invite.innerHTML = `
        <div class="game-invite-content">
            <div class="game-invite-icon">🎮</div>
            <div class="game-invite-text">${peerName} 邀请你玩${gameName}</div>
            <div class="game-invite-actions">
                <button class="btn-cancel">拒绝</button>
                <button class="btn-send">接受</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(invite);
    setTimeout(() => invite.classList.add('show'), 10);
    
    invite.querySelector('.btn-send').addEventListener('click', () => {
        invite.remove();
        
        // 发送接受消息
        sendWsMessage({
            type: 'game-accept',
            to: data.from,
            gameType: data.gameType,
            timestamp: Date.now()
        });
        
        // 开始游戏（被邀请方）
        startGame(data.gameType, data.from, false);
    });
    
    invite.querySelector('.btn-cancel').addEventListener('click', () => {
        invite.remove();
        showToast('已拒绝游戏邀请', 'info');
        
        // 发送拒绝消息
        sendWsMessage({
            type: 'game-reject',
            to: data.from,
            gameType: data.gameType,
            timestamp: Date.now()
        });
    });
    
    // 10秒后自动关闭
    setTimeout(() => {
        if (document.body.contains(invite)) {
            invite.remove();
        }
    }, 10000);
    
    // 添加系统消息
    addMessage(data.from, {
        type: 'system',
        content: `${peerName} 邀请你玩${gameName}`,
        timestamp: data.timestamp
    });
    
    if (data.from === currentChatId) {
        renderMessages();
    }
    renderChatList();
}

// 接收游戏接受
function receiveGameAccept(data) {
    const peer = peers.get(data.from);
    const peerName = peer ? peer.name : '对方';
    const gameName = gameNames[data.gameType] || '未知游戏';
    
    showToast(`${peerName} 接受了${gameName}邀请`, 'success');
    
    // 开始游戏（邀请方）
    startGame(data.gameType, data.from, true);
}

// 接收游戏拒绝
function receiveGameReject(data) {
    const peer = peers.get(data.from);
    const peerName = peer ? peer.name : '对方';
    const gameName = gameNames[data.gameType] || '未知游戏';
    
    showToast(`${peerName} 拒绝了${gameName}邀请`, 'warning');
}

// 开始游戏
function startGame(gameType, opponentId, isHost) {
    currentGame = {
        type: gameType,
        opponent: opponentId,
        isHost: isHost
    };
    
    switch (gameType) {
        case 'gomoku':
            startGomoku(opponentId, isHost);
            break;
        case 'tictactoe':
            startTicTacToe(opponentId, isHost);
            break;
        case 'weiqi':
            startWeiqi(opponentId, isHost);
            break;
        case 'xiangqi':
            startXiangqi(opponentId, isHost);
            break;
        case 'rps':
            startRockPaperScissors(opponentId);
            break;
        case 'numberbomb':
            startNumberBomb(opponentId, isHost);
            break;
        case 'reaction':
            startReaction(opponentId);
            break;
        case 'drawguess':
            startDrawGuess(opponentId, isHost);
            break;
        case 'memory':
            startMemory(opponentId);
            break;
        default:
            showToast('游戏开发中...', 'info');
    }
}

// 接收游戏移动
function receiveGameMove(data) {
    if (!currentGame || currentGame.opponent !== data.from) return;
    
    // 根据游戏类型处理移动
    console.log('收到游戏移动:', data);
    
    // 根据不同游戏类型分发
    switch (currentGame.type) {
        case 'gomoku':
        case 'tictactoe':
        case 'weiqi':
        case 'xiangqi':
            handleBoardGameMove(data);
            break;
        case 'rps':
            handleRPSMove(data);
            break;
        case 'numberbomb':
            handleNumberBombMove(data);
            break;
    }
}

// 接收游戏结束
function receiveGameOver(data) {
    console.log('游戏结束:', data);
    currentGame = null;
}

// ========== 五子棋游戏 ==========
function startGomoku(opponentId, isHost) {
    const peer = peers.get(opponentId);
    const peerName = peer ? peer.name : '对方';
    const myColor = isHost ? 'black' : 'white';
    const opponentColor = isHost ? 'white' : 'black';
    const myTurn = isHost;
    
    const board = Array(15).fill(null).map(() => Array(15).fill(null));
    let currentTurn = myTurn;
    
    const game = document.createElement('div');
    game.className = 'gomoku-game-modal';
    game.innerHTML = `
        <div class="gomoku-game-content">
            <div class="gomoku-game-header">
                <span>五子棋 - 对战 ${peerName}</span>
                <button class="gomoku-game-close">×</button>
            </div>
            <div class="gomoku-game-body">
                <div class="gomoku-info">
                    <div class="gomoku-player">
                        <span class="gomoku-dot" style="background: #000"></span>
                        <span>${isHost ? myName : peerName}</span>
                    </div>
                    <div class="gomoku-status">${myTurn ? '你的回合' : '对方回合'}</div>
                    <div class="gomoku-player">
                        <span class="gomoku-dot" style="background: #fff; border: 1px solid #333"></span>
                        <span>${isHost ? peerName : myName}</span>
                    </div>
                </div>
                <canvas id="gomokuCanvas" width="600" height="600"></canvas>
            </div>
        </div>
    `;
    
    document.body.appendChild(game);
    setTimeout(() => game.classList.add('show'), 10);
    
    const canvas = game.querySelector('#gomokuCanvas');
    const ctx = canvas.getContext('2d');
    const cellSize = 40;
    
    // 绘制棋盘
    function drawBoard() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 背景
        ctx.fillStyle = '#daa520';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 网格
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        
        for (let i = 0; i < 15; i++) {
            ctx.beginPath();
            ctx.moveTo(cellSize, cellSize * (i + 1));
            ctx.lineTo(cellSize * 15, cellSize * (i + 1));
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(cellSize * (i + 1), cellSize);
            ctx.lineTo(cellSize * (i + 1), cellSize * 15);
            ctx.stroke();
        }
        
        // 天元等标记点
        const marks = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];
        marks.forEach(([x, y]) => {
            ctx.beginPath();
            ctx.arc(cellSize * (x + 1), cellSize * (y + 1), 4, 0, Math.PI * 2);
            ctx.fillStyle = '#000';
            ctx.fill();
        });
        
        // 绘制棋子
        for (let i = 0; i < 15; i++) {
            for (let j = 0; j < 15; j++) {
                if (board[i][j]) {
                    const x = cellSize * (j + 1);
                    const y = cellSize * (i + 1);
                    
                    ctx.beginPath();
                    ctx.arc(x, y, cellSize * 0.4, 0, Math.PI * 2);
                    ctx.fillStyle = board[i][j] === 'black' ? '#000' : '#fff';
                    ctx.fill();
                    
                    if (board[i][j] === 'white') {
                        ctx.strokeStyle = '#333';
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }
                }
            }
        }
    }
    
    // 检查获胜
    function checkWin(row, col, color) {
        const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
        
        for (const [dx, dy] of directions) {
            let count = 1;
            
            // 正方向
            for (let i = 1; i < 5; i++) {
                const newRow = row + dx * i;
                const newCol = col + dy * i;
                if (newRow < 0 || newRow >= 15 || newCol < 0 || newCol >= 15) break;
                if (board[newRow][newCol] === color) count++;
                else break;
            }
            
            // 反方向
            for (let i = 1; i < 5; i++) {
                const newRow = row - dx * i;
                const newCol = col - dy * i;
                if (newRow < 0 || newRow >= 15 || newCol < 0 || newCol >= 15) break;
                if (board[newRow][newCol] === color) count++;
                else break;
            }
            
            if (count >= 5) return true;
        }
        
        return false;
    }
    
    // 点击下棋
    canvas.addEventListener('click', (e) => {
        if (!currentTurn) {
            showToast('还没到你的回合', 'warning');
            return;
        }
        
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const col = Math.round(x / cellSize) - 1;
        const row = Math.round(y / cellSize) - 1;
        
        if (row < 0 || row >= 15 || col < 0 || col >= 15) return;
        if (board[row][col]) {
            showToast('这里已经有棋子了', 'warning');
            return;
        }
        
        // 落子
        board[row][col] = myColor;
        currentTurn = false;
        game.querySelector('.gomoku-status').textContent = '对方回合';
        drawBoard();
        
        // 检查胜利
        if (checkWin(row, col, myColor)) {
            setTimeout(() => {
                showToast('你赢了！🎉', 'success');
                game.querySelector('.gomoku-status').textContent = '你赢了！';
                currentTurn = false;
                
                sendWsMessage({
                    type: 'game-over',
                    to: opponentId,
                    gameType: 'gomoku',
                    winner: myId,
                    timestamp: Date.now()
                });
            }, 100);
        } else {
            // 发送移动
            sendWsMessage({
                type: 'game-move',
                to: opponentId,
                gameType: 'gomoku',
                move: { row, col, color: myColor },
                timestamp: Date.now()
            });
        }
    });
    
    // 处理棋盘游戏移动
    window.handleBoardGameMove = function(data) {
        if (!data.move) return;
        
        const { row, col, color } = data.move;
        board[row][col] = color;
        currentTurn = true;
        game.querySelector('.gomoku-status').textContent = '你的回合';
        drawBoard();
        
        // 检查对方是否获胜
        if (checkWin(row, col, color)) {
            showToast('对方赢了', 'info');
            game.querySelector('.gomoku-status').textContent = '对方赢了';
            currentTurn = false;
        }
    };
    
    // 关闭游戏
    game.querySelector('.gomoku-game-close').addEventListener('click', () => {
        game.classList.remove('show');
        setTimeout(() => game.remove(), 300);
        currentGame = null;
    });
    
    drawBoard();
}

// ========== 井字棋游戏 ==========
function startTicTacToe(opponentId, isHost) {
    showToast('井字棋游戏即将推出！', 'info');
    // TODO: 实现井字棋游戏界面
}

// ========== 石头剪刀布游戏 ==========
function startRockPaperScissors(opponentId) {
    const game = document.createElement('div');
    game.className = 'rps-game-modal';
    game.innerHTML = `
        <div class="rps-game-content">
            <div class="rps-game-header">
                <span>石头剪刀布</span>
                <button class="rps-game-close">×</button>
            </div>
            <div class="rps-game-body">
                <div class="rps-choices">
                    <button class="rps-choice" data-choice="rock">
                        <span class="rps-icon">🪨</span>
                        <span class="rps-name">石头</span>
                    </button>
                    <button class="rps-choice" data-choice="paper">
                        <span class="rps-icon">📄</span>
                        <span class="rps-name">布</span>
                    </button>
                    <button class="rps-choice" data-choice="scissors">
                        <span class="rps-icon">✂️</span>
                        <span class="rps-name">剪刀</span>
                    </button>
                </div>
                <div class="rps-status">请选择你的出招</div>
            </div>
        </div>
    `;
    
    document.body.appendChild(game);
    setTimeout(() => game.classList.add('show'), 10);
    
    const choices = game.querySelectorAll('.rps-choice');
    choices.forEach(choice => {
        choice.addEventListener('click', () => {
            const selected = choice.dataset.choice;
            game.querySelector('.rps-status').textContent = '等待对方出招...';
            choices.forEach(c => c.disabled = true);
            
            // 发送选择
            sendWsMessage({
                type: 'game-move',
                to: opponentId,
                gameType: 'rps',
                move: selected,
                timestamp: Date.now()
            });
            
            showToast('已出招，等待对方...', 'info');
        });
    });
    
    game.querySelector('.rps-game-close').addEventListener('click', () => {
        game.classList.remove('show');
        setTimeout(() => game.remove(), 300);
        currentGame = null;
    });
}

// ========== 数字炸弹游戏 ==========
function startNumberBomb(opponentId, isHost) {
    showToast('数字炸弹游戏即将推出！', 'info');
}

// 处理数字炸弹移动
function handleNumberBombMove(data) {
    console.log('数字炸弹移动:', data);
}

// ========== 反应力测试游戏 ==========
function startReaction(opponentId) {
    showToast('反应力测试即将推出！', 'info');
}

// ========== 你画我猜游戏 ==========
function startDrawGuess(opponentId, isHost) {
    showToast('你画我猜游戏即将推出！', 'info');
}

// ========== 记忆翻牌游戏 ==========
function startMemory(opponentId) {
    showToast('记忆翻牌游戏即将推出！', 'info');
}

// ========== 围棋游戏 ==========
function startWeiqi(opponentId, isHost) {
    const peer = peers.get(opponentId);
    const peerName = peer ? peer.name : '对方';
    const myColor = isHost ? 'black' : 'white';
    const myTurn = isHost;
    
    const boardSize = 19;
    const board = Array(boardSize).fill(null).map(() => Array(boardSize).fill(null));
    let currentTurn = myTurn;
    let passCount = 0;
    let capturedBlack = 0;  // 黑方提子数
    let capturedWhite = 0;  // 白方提子数
    
    const game = document.createElement('div');
    game.className = 'weiqi-game-modal';
    game.innerHTML = `
        <div class="weiqi-game-content">
            <div class="weiqi-game-header">
                <span>围棋 - 对战 ${peerName}</span>
                <button class="weiqi-game-close">×</button>
            </div>
            <div class="weiqi-game-body">
                <div class="weiqi-info">
                    <div class="weiqi-player">
                        <span class="weiqi-dot" style="background: #000"></span>
                        <span>${isHost ? myName : peerName}</span>
                        <span class="weiqi-captured">提子: ${capturedWhite}</span>
                    </div>
                    <div class="weiqi-controls">
                        <div class="weiqi-status">${myTurn ? '你的回合' : '对方回合'}</div>
                        <button class="weiqi-pass-btn" ${!myTurn ? 'disabled' : ''}>放弃</button>
                    </div>
                    <div class="weiqi-player">
                        <span class="weiqi-dot" style="background: #fff; border: 1px solid #333"></span>
                        <span>${isHost ? peerName : myName}</span>
                        <span class="weiqi-captured">提子: ${capturedBlack}</span>
                    </div>
                </div>
                <canvas id="weiqiCanvas" width="700" height="700"></canvas>
            </div>
        </div>
    `;
    
    document.body.appendChild(game);
    setTimeout(() => game.classList.add('show'), 10);
    
    const canvas = game.querySelector('#weiqiCanvas');
    const ctx = canvas.getContext('2d');
    const cellSize = 35;
    const padding = 30;
    
    // 计算一组棋子的气
    function countLiberties(row, col, color, visited = new Set()) {
        const key = `${row},${col}`;
        if (visited.has(key)) return 0;
        if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return 0;
        
        if (board[row][col] === null) return 1;
        if (board[row][col] !== color) return 0;
        
        visited.add(key);
        
        const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
        let liberties = 0;
        
        for (const [dx, dy] of directions) {
            const newRow = row + dx;
            const newCol = col + dy;
            
            if (newRow < 0 || newRow >= boardSize || newCol < 0 || newCol >= boardSize) continue;
            
            if (board[newRow][newCol] === null) {
                const libKey = `${newRow},${newCol}`;
                if (!visited.has(libKey)) {
                    visited.add(libKey);
                    liberties++;
                }
            } else if (board[newRow][newCol] === color && !visited.has(`${newRow},${newCol}`)) {
                liberties += countLiberties(newRow, newCol, color, visited);
            }
        }
        
        return liberties;
    }
    
    // 移除一组无气的棋子
    function removeDeadStones(row, col, color) {
        if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return 0;
        if (board[row][col] !== color) return 0;
        
        board[row][col] = null;
        let removed = 1;
        
        const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
        for (const [dx, dy] of directions) {
            removed += removeDeadStones(row + dx, col + dy, color);
        }
        
        return removed;
    }
    
    // 检查并提子
    function captureStones(row, col) {
        const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
        const opponentColor = myColor === 'black' ? 'white' : 'black';
        let captured = 0;
        
        for (const [dx, dy] of directions) {
            const newRow = row + dx;
            const newCol = col + dy;
            
            if (newRow < 0 || newRow >= boardSize || newCol < 0 || newCol >= boardSize) continue;
            if (board[newRow][newCol] !== opponentColor) continue;
            
            if (countLiberties(newRow, newCol, opponentColor) === 0) {
                captured += removeDeadStones(newRow, newCol, opponentColor);
            }
        }
        
        return captured;
    }
    
    // 绘制棋盘
    function drawBoard() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 背景
        ctx.fillStyle = '#daa520';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 网格
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        
        for (let i = 0; i < boardSize; i++) {
            ctx.beginPath();
            ctx.moveTo(padding, padding + cellSize * i);
            ctx.lineTo(padding + cellSize * (boardSize - 1), padding + cellSize * i);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(padding + cellSize * i, padding);
            ctx.lineTo(padding + cellSize * i, padding + cellSize * (boardSize - 1));
            ctx.stroke();
        }
        
        // 星位
        const stars = [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]];
        stars.forEach(([x, y]) => {
            ctx.beginPath();
            ctx.arc(padding + cellSize * x, padding + cellSize * y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#000';
            ctx.fill();
        });
        
        // 绘制棋子
        for (let i = 0; i < boardSize; i++) {
            for (let j = 0; j < boardSize; j++) {
                if (board[i][j]) {
                    const x = padding + cellSize * j;
                    const y = padding + cellSize * i;
                    
                    ctx.beginPath();
                    ctx.arc(x, y, cellSize * 0.45, 0, Math.PI * 2);
                    ctx.fillStyle = board[i][j] === 'black' ? '#000' : '#fff';
                    ctx.fill();
                    
                    if (board[i][j] === 'white') {
                        ctx.strokeStyle = '#333';
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }
                }
            }
        }
    }
    
    // 点击下棋
    canvas.addEventListener('click', (e) => {
        if (!currentTurn) {
            showToast('还没到你的回合', 'warning');
            return;
        }
        
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left - padding;
        const y = e.clientY - rect.top - padding;
        
        const col = Math.round(x / cellSize);
        const row = Math.round(y / cellSize);
        
        if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return;
        if (board[row][col]) {
            showToast('这里已经有棋子了', 'warning');
            return;
        }
        
        // 落子
        board[row][col] = myColor;
        
        // 检查提子
        const captured = captureStones(row, col);
        
        // 检查自杀（落子后自己无气）
        if (countLiberties(row, col, myColor) === 0 && captured === 0) {
            board[row][col] = null;
            showToast('不能下在此处（自杀）', 'warning');
            return;
        }
        
        // 更新提子数
        if (myColor === 'black') {
            capturedWhite += captured;
        } else {
            capturedBlack += captured;
        }
        
        updateCapturedDisplay();
        
        currentTurn = false;
        passCount = 0;
        game.querySelector('.weiqi-status').textContent = '对方回合';
        game.querySelector('.weiqi-pass-btn').disabled = true;
        drawBoard();
        
        // 发送移动
        sendWsMessage({
            type: 'game-move',
            to: opponentId,
            gameType: 'weiqi',
            move: { row, col, color: myColor, captured, capturedBlack, capturedWhite },
            timestamp: Date.now()
        });
    });
    
    // 放弃按钮
    game.querySelector('.weiqi-pass-btn').addEventListener('click', () => {
        if (!currentTurn) return;
        
        passCount++;
        currentTurn = false;
        game.querySelector('.weiqi-status').textContent = '对方回合';
        game.querySelector('.weiqi-pass-btn').disabled = true;
        
        if (passCount >= 2) {
            showToast('双方放弃，游戏结束', 'info');
            game.querySelector('.weiqi-status').textContent = '游戏结束';
            return;
        }
        
        sendWsMessage({
            type: 'game-move',
            to: opponentId,
            gameType: 'weiqi',
            move: { pass: true, passCount },
            timestamp: Date.now()
        });
    });
    
    // 更新提子显示
    function updateCapturedDisplay() {
        const players = game.querySelectorAll('.weiqi-player');
        if (isHost) {
            players[0].querySelector('.weiqi-captured').textContent = `提子: ${capturedWhite}`;
            players[1].querySelector('.weiqi-captured').textContent = `提子: ${capturedBlack}`;
        } else {
            players[0].querySelector('.weiqi-captured').textContent = `提子: ${capturedBlack}`;
            players[1].querySelector('.weiqi-captured').textContent = `提子: ${capturedWhite}`;
        }
    }
    
    // 处理棋盘游戏移动（围棋特殊处理）
    const originalHandler = window.handleBoardGameMove;
    window.handleBoardGameMove = function(data) {
        if (currentGame && currentGame.type === 'weiqi' && data.move) {
            if (data.move.pass) {
                passCount = data.move.passCount;
                currentTurn = true;
                game.querySelector('.weiqi-status').textContent = '你的回合';
                game.querySelector('.weiqi-pass-btn').disabled = false;
                
                if (passCount >= 2) {
                    showToast('双方放弃，游戏结束', 'info');
                    game.querySelector('.weiqi-status').textContent = '游戏结束';
                    currentTurn = false;
                }
                return;
            }
            
            const { row, col, color, captured, capturedBlack: newCapturedBlack, capturedWhite: newCapturedWhite } = data.move;
            board[row][col] = color;
            capturedBlack = newCapturedBlack;
            capturedWhite = newCapturedWhite;
            
            // 移除被提的子
            if (captured > 0) {
                const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
                const myOpponentColor = color === 'black' ? 'white' : 'black';
                
                for (const [dx, dy] of directions) {
                    const newRow = row + dx;
                    const newCol = col + dy;
                    
                    if (newRow < 0 || newRow >= boardSize || newCol < 0 || newCol >= boardSize) continue;
                    if (board[newRow][newCol] !== myOpponentColor) continue;
                    
                    if (countLiberties(newRow, newCol, myOpponentColor) === 0) {
                        removeDeadStones(newRow, newCol, myOpponentColor);
                    }
                }
            }
            
            updateCapturedDisplay();
            currentTurn = true;
            passCount = 0;
            game.querySelector('.weiqi-status').textContent = '你的回合';
            game.querySelector('.weiqi-pass-btn').disabled = false;
            drawBoard();
        } else if (originalHandler) {
            originalHandler(data);
        }
    };
    
    // 关闭游戏
    game.querySelector('.weiqi-game-close').addEventListener('click', () => {
        window.handleBoardGameMove = originalHandler;
        game.classList.remove('show');
        setTimeout(() => game.remove(), 300);
        currentGame = null;
    });
    
    drawBoard();
}

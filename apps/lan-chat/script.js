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
    renderChatList();
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
    document.getElementById('chatHeader').innerHTML = `
        <div class="chat-title">${peer.name}</div>
    `;
    
    // 渲染消息
    renderMessages();
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
    };
    reader.readAsDataURL(file);
}

// 发送文件
function sendFile(file) {
    if (!currentChatId) return;
    
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
    };
    reader.readAsDataURL(file);
}

// 事件监听
function setupEventListeners() {
    // 发送按钮
    document.getElementById('sendBtn').addEventListener('click', sendMessage);
    
    // 回车发送
    document.getElementById('inputBox').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
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
    window.open(src, '_blank');
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
        myName = newName.trim();
        localStorage.setItem('lan-chat-username', myName);
        document.getElementById('myName').textContent = myName;
        document.getElementById('myAvatar').textContent = getAvatarText(myName);
        
        // 通知服务器更新昵称
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendWsMessage({
                type: 'update-name',
                name: myName
            });
        }
    }
});

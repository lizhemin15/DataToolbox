// 数据管理
let tasks = [];
let currentTaskId = null;
let currentListView = 'all';
let timerInterval = null;
let timerState = {
    isRunning: false,
    isWorkTime: true,
    remainingSeconds: 25 * 60,
    totalSeconds: 25 * 60,
    currentTaskId: null
};
let stats = {
    completedPomodoros: 0,
    totalFocusTime: 0 // 分钟
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    initEventListeners();
    updateTaskCounts();
    renderTasks();
    updateTimerDisplay();
    updateStats();
    initDragAndDrop();
    requestNotificationPermission();
});

// 请求通知权限
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        // 不主动请求，等用户第一次使用番茄钟时再请求
    }
}

// 加载数据
function loadData() {
    const savedTasks = localStorage.getItem('tasks');
    const savedStats = localStorage.getItem('pomodoroStats');
    
    if (savedTasks) {
        tasks = JSON.parse(savedTasks);
    }
    
    if (savedStats) {
        stats = JSON.parse(savedStats);
    }
    
    // 重置今日统计（如果是新的一天）
    const lastDate = localStorage.getItem('lastStatsDate');
    const today = new Date().toDateString();
    if (lastDate !== today) {
        stats.completedPomodoros = 0;
        stats.totalFocusTime = 0;
        localStorage.setItem('lastStatsDate', today);
        saveStats();
    }
}

// 保存数据
function saveData() {
    localStorage.setItem('tasks', JSON.stringify(tasks));
}

function saveStats() {
    localStorage.setItem('pomodoroStats', JSON.stringify(stats));
}

// 事件监听
function initEventListeners() {
    // 回车添加任务
    document.getElementById('taskInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addTask();
        }
    });
    
    // 列表切换
    document.querySelectorAll('.list-item').forEach(item => {
        item.addEventListener('click', () => {
            switchList(item.dataset.list);
        });
    });
    
    // 任务详情输入监听
    document.getElementById('detailTitle').addEventListener('input', updateTaskFromDetail);
    document.getElementById('detailDate').addEventListener('change', updateTaskFromDetail);
    document.getElementById('detailPriority').addEventListener('change', updateTaskFromDetail);
    document.getElementById('detailNote').addEventListener('input', updateTaskFromDetail);
    
    // 番茄钟设置监听
    document.getElementById('workDuration').addEventListener('change', updateTimerSettings);
    document.getElementById('breakDuration').addEventListener('change', updateTimerSettings);
    
    // 键盘快捷键
    document.addEventListener('keydown', handleKeyboardShortcuts);
}

// 键盘快捷键处理
function handleKeyboardShortcuts(e) {
    // 如果正在输入，不触发快捷键
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        // ESC 键取消焦点
        if (e.key === 'Escape') {
            e.target.blur();
        }
        return;
    }
    
    // 空格键：开始/暂停番茄钟
    if (e.code === 'Space') {
        e.preventDefault();
        toggleTimer();
    }
    
    // R 键：重置番茄钟
    if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        resetTimer();
    }
    
    // N 键：聚焦到输入框
    if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        document.getElementById('taskInput').focus();
    }
    
    // ESC 键：关闭右侧面板
    if (e.key === 'Escape') {
        closeRightPanel();
    }
    
    // P 键：切换番茄钟面板显示/隐藏
    if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        toggleRightPanel();
    }
    
    // 数字键切换列表视图
    const listViews = ['all', 'today', 'important', 'completed'];
    if (e.key >= '1' && e.key <= '4') {
        const index = parseInt(e.key) - 1;
        switchList(listViews[index]);
    }
}

// 添加任务
function addTask() {
    const input = document.getElementById('taskInput');
    const title = input.value.trim();
    
    if (!title) return;
    
    const task = {
        id: Date.now().toString(),
        title: title,
        completed: false,
        priority: 'medium',
        date: null,
        note: '',
        createdAt: new Date().toISOString(),
        order: tasks.length
    };
    
    tasks.unshift(task);
    saveData();
    input.value = '';
    
    updateTaskCounts();
    renderTasks();
    
    showToast('任务已添加');
}

// 切换列表视图
function switchList(listType) {
    currentListView = listType;
    
    // 更新激活状态
    document.querySelectorAll('.list-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.list === listType) {
            item.classList.add('active');
        }
    });
    
    // 更新标题
    const titles = {
        'all': '全部任务',
        'today': '今天',
        'important': '重要',
        'completed': '已完成'
    };
    document.getElementById('currentListTitle').textContent = titles[listType];
    
    renderTasks();
}

// 渲染任务列表
function renderTasks() {
    const container = document.getElementById('tasksContainer');
    const emptyState = document.getElementById('emptyState');
    
    let filteredTasks = filterTasks();
    
    if (filteredTasks.length === 0) {
        container.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }
    
    container.style.display = 'block';
    emptyState.style.display = 'none';
    
    container.innerHTML = filteredTasks.map(task => `
        <div class="task-item ${task.completed ? 'completed' : ''}" 
             data-id="${task.id}"
             data-priority="${task.priority}"
             draggable="true"
             onclick="showTaskDetail('${task.id}')">
            <div class="task-checkbox ${task.completed ? 'checked' : ''}" 
                 onclick="event.stopPropagation(); toggleTaskComplete('${task.id}')">
            </div>
            <div class="task-content">
                <div class="task-title">${escapeHtml(task.title)}</div>
                <div class="task-meta">
                    ${task.date ? `<div class="task-meta-item">📅 ${formatDate(task.date)}</div>` : ''}
                    ${task.priority !== 'medium' ? `<div class="priority-badge priority-${task.priority}">${getPriorityText(task.priority)}</div>` : ''}
                    ${task.note ? '<div class="task-meta-item">📝 有备注</div>' : ''}
                </div>
            </div>
            <div class="task-actions">
                <button class="task-action-btn" onclick="event.stopPropagation(); startFocusFromTask('${task.id}')" title="开始专注">
                    🍅
                </button>
                <button class="task-action-btn" onclick="event.stopPropagation(); deleteTask('${task.id}')" title="删除">
                    🗑️
                </button>
            </div>
        </div>
    `).join('');
    
    // 重新初始化拖拽
    initDragAndDrop();
}

// 过滤任务
function filterTasks() {
    let filtered = [...tasks];
    
    switch (currentListView) {
        case 'today':
            const today = new Date().toDateString();
            filtered = filtered.filter(task => {
                if (!task.date) return false;
                return new Date(task.date).toDateString() === today;
            });
            break;
        case 'important':
            filtered = filtered.filter(task => task.priority === 'high');
            break;
        case 'completed':
            filtered = filtered.filter(task => task.completed);
            break;
    }
    
    // 排序：未完成在前，按优先级和创建时间排序
    filtered.sort((a, b) => {
        if (a.completed !== b.completed) {
            return a.completed ? 1 : -1;
        }
        
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        if (a.priority !== b.priority) {
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        
        return new Date(b.createdAt) - new Date(a.createdAt);
    });
    
    return filtered;
}

// 更新任务计数
function updateTaskCounts() {
    const today = new Date().toDateString();
    
    const counts = {
        all: tasks.filter(t => !t.completed).length,
        today: tasks.filter(t => t.date && new Date(t.date).toDateString() === today && !t.completed).length,
        important: tasks.filter(t => t.priority === 'high' && !t.completed).length,
        completed: tasks.filter(t => t.completed).length
    };
    
    document.querySelectorAll('.list-item').forEach(item => {
        const listType = item.dataset.list;
        const countEl = item.querySelector('.task-count');
        if (countEl && counts[listType] !== undefined) {
            countEl.textContent = counts[listType];
        }
    });
}

// 切换任务完成状态
function toggleTaskComplete(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
        task.completed = !task.completed;
        saveData();
        updateTaskCounts();
        renderTasks();
        
        if (task.completed) {
            showToast('任务已完成 ✓');
        }
    }
}

// 显示任务详情
function showTaskDetail(taskId) {
    currentTaskId = taskId;
    const task = tasks.find(t => t.id === taskId);
    
    if (!task) return;
    
    // 显示任务详情视图
    document.getElementById('taskDetailView').style.display = 'block';
    document.getElementById('pomodoroView').style.display = 'none';
    document.getElementById('panelTitle').textContent = '任务详情';
    
    // 填充数据
    document.getElementById('detailTitle').value = task.title;
    document.getElementById('detailDate').value = task.date || '';
    document.getElementById('detailPriority').value = task.priority;
    document.getElementById('detailNote').value = task.note || '';
    
    // 移动端显示面板
    if (window.innerWidth <= 768) {
        document.getElementById('rightPanel').classList.add('show');
    }
}

// 从详情更新任务
function updateTaskFromDetail() {
    if (!currentTaskId) return;
    
    const task = tasks.find(t => t.id === currentTaskId);
    if (!task) return;
    
    task.title = document.getElementById('detailTitle').value;
    task.date = document.getElementById('detailDate').value;
    task.priority = document.getElementById('detailPriority').value;
    task.note = document.getElementById('detailNote').value;
    
    saveData();
    updateTaskCounts();
    renderTasks();
}

// 删除当前任务
function deleteCurrentTask() {
    if (!currentTaskId) return;
    
    if (confirm('确定要删除这个任务吗？')) {
        deleteTask(currentTaskId);
        closeRightPanel();
    }
}

// 删除任务
function deleteTask(taskId) {
    tasks = tasks.filter(t => t.id !== taskId);
    saveData();
    updateTaskCounts();
    renderTasks();
    showToast('任务已删除');
}

// 切换右侧面板显示/隐藏
function toggleRightPanel() {
    const appContainer = document.querySelector('.app-container');
    const icon = document.getElementById('togglePanelIcon');
    
    if (appContainer.classList.contains('panel-hidden')) {
        // 显示面板
        appContainer.classList.remove('panel-hidden');
        icon.textContent = '🍅';
        showToast('番茄钟面板已显示');
    } else {
        // 隐藏面板
        appContainer.classList.add('panel-hidden');
        icon.textContent = '👁️';
        showToast('番茄钟面板已隐藏');
    }
}

// 关闭右侧面板
function closeRightPanel() {
    // 如果在任务详情视图，先切回番茄钟视图
    if (document.getElementById('taskDetailView').style.display !== 'none') {
        currentTaskId = null;
        document.getElementById('taskDetailView').style.display = 'none';
        document.getElementById('pomodoroView').style.display = 'block';
        document.getElementById('panelTitle').textContent = '番茄钟';
    }
    
    // 桌面端：隐藏整个面板
    if (window.innerWidth > 768) {
        const appContainer = document.querySelector('.app-container');
        appContainer.classList.add('panel-hidden');
        document.getElementById('togglePanelIcon').textContent = '👁️';
    } else {
        // 移动端：隐藏面板
        document.getElementById('rightPanel').classList.remove('show');
    }
}

// 从详情页开始专注
function startFocusFromDetail() {
    if (!currentTaskId) return;
    startFocusFromTask(currentTaskId);
}

// 从任务开始专注
function startFocusFromTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    timerState.currentTaskId = taskId;
    document.getElementById('pomodoroTaskName').textContent = task.title;
    
    closeRightPanel();
    showToast('已选择任务：' + task.title);
}

// 番茄钟功能
function toggleTimer() {
    if (timerState.isRunning) {
        pauseTimer();
    } else {
        startTimer();
    }
}

function startTimer() {
    timerState.isRunning = true;
    
    const btn = document.getElementById('btnStartPause');
    btn.innerHTML = '<span class="icon">⏸️</span><span>暂停</span>';
    
    // 添加运行中的视觉效果
    document.getElementById('timerRingProgress').classList.add('running');
    
    timerInterval = setInterval(() => {
        timerState.remainingSeconds--;
        
        if (timerState.remainingSeconds <= 0) {
            timerComplete();
        }
        
        updateTimerDisplay();
    }, 1000);
    
    showToast('专注开始');
}

function pauseTimer() {
    timerState.isRunning = false;
    clearInterval(timerInterval);
    
    // 移除运行中的视觉效果
    document.getElementById('timerRingProgress').classList.remove('running');
    
    const btn = document.getElementById('btnStartPause');
    btn.innerHTML = '<span class="icon">▶️</span><span>继续</span>';
    
    showToast('已暂停');
}

function resetTimer() {
    timerState.isRunning = false;
    clearInterval(timerInterval);
    
    // 移除运行中的视觉效果
    document.getElementById('timerRingProgress').classList.remove('running');
    
    const workDuration = parseInt(document.getElementById('workDuration').value) || 25;
    const breakDuration = parseInt(document.getElementById('breakDuration').value) || 5;
    
    timerState.remainingSeconds = timerState.isWorkTime ? workDuration * 60 : breakDuration * 60;
    timerState.totalSeconds = timerState.remainingSeconds;
    
    const btn = document.getElementById('btnStartPause');
    btn.innerHTML = '<span class="icon">▶️</span><span>开始</span>';
    
    updateTimerDisplay();
    showToast('已重置');
}

function timerComplete() {
    clearInterval(timerInterval);
    timerState.isRunning = false;
    
    // 移除运行中的视觉效果
    document.getElementById('timerRingProgress').classList.remove('running');
    
    if (timerState.isWorkTime) {
        // 工作时间结束
        stats.completedPomodoros++;
        const workDuration = parseInt(document.getElementById('workDuration').value) || 25;
        stats.totalFocusTime += workDuration;
        saveStats();
        updateStats();
        
        const message = '🎉 专注时间完成！休息一下吧';
        showToast(message);
        showNotification('专注完成', message);
        playNotificationSound(true);
        
        // 切换到休息时间
        timerState.isWorkTime = false;
        const breakDuration = parseInt(document.getElementById('breakDuration').value) || 5;
        timerState.remainingSeconds = breakDuration * 60;
        timerState.totalSeconds = timerState.remainingSeconds;
    } else {
        // 休息时间结束
        const message = '休息结束！准备开始新的专注';
        showToast(message);
        showNotification('休息完成', message);
        playNotificationSound(false);
        
        // 切换到工作时间
        timerState.isWorkTime = true;
        const workDuration = parseInt(document.getElementById('workDuration').value) || 25;
        timerState.remainingSeconds = workDuration * 60;
        timerState.totalSeconds = timerState.remainingSeconds;
    }
    
    const btn = document.getElementById('btnStartPause');
    btn.innerHTML = '<span class="icon">▶️</span><span>开始</span>';
    
    updateTimerDisplay();
}

function updateTimerDisplay() {
    const minutes = Math.floor(timerState.remainingSeconds / 60);
    const seconds = timerState.remainingSeconds % 60;
    
    document.getElementById('timerDisplay').textContent = 
        `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    
    document.getElementById('timerLabel').textContent = 
        timerState.isWorkTime ? '工作时间' : '休息时间';
    
    // 更新进度环
    const progress = (timerState.totalSeconds - timerState.remainingSeconds) / timerState.totalSeconds;
    const circumference = 2 * Math.PI * 85;
    const offset = circumference * (1 - progress);
    
    const progressRing = document.getElementById('timerRingProgress');
    progressRing.style.strokeDashoffset = offset;
    
    // 更改颜色
    if (timerState.isWorkTime) {
        progressRing.style.stroke = '#4A90E2';
    } else {
        progressRing.style.stroke = '#50C878';
    }
}

function updateTimerSettings() {
    if (!timerState.isRunning) {
        resetTimer();
    }
}

function updateStats() {
    document.getElementById('completedPomodoros').textContent = stats.completedPomodoros;
    
    const hours = Math.floor(stats.totalFocusTime / 60);
    const minutes = stats.totalFocusTime % 60;
    
    if (hours > 0) {
        document.getElementById('totalFocusTime').textContent = `${hours}h ${minutes}m`;
    } else {
        document.getElementById('totalFocusTime').textContent = `${minutes}m`;
    }
}

// 拖拽排序
function initDragAndDrop() {
    const taskItems = document.querySelectorAll('.task-item');
    
    taskItems.forEach(item => {
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragleave', handleDragLeave);
    });
}

let draggedElement = null;

function handleDragStart(e) {
    draggedElement = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    
    // 移除所有拖拽样式
    document.querySelectorAll('.task-item').forEach(item => {
        item.classList.remove('drag-over');
    });
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnter(e) {
    if (this !== draggedElement) {
        this.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    this.classList.remove('drag-over');
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }
    
    if (draggedElement !== this) {
        const draggedId = draggedElement.dataset.id;
        const targetId = this.dataset.id;
        
        const draggedIndex = tasks.findIndex(t => t.id === draggedId);
        const targetIndex = tasks.findIndex(t => t.id === targetId);
        
        // 交换位置
        const [draggedTask] = tasks.splice(draggedIndex, 1);
        tasks.splice(targetIndex, 0, draggedTask);
        
        saveData();
        renderTasks();
        
        showToast('已调整顺序');
    }
    
    return false;
}

// 排序功能
function toggleSort() {
    // 这里可以实现更复杂的排序逻辑
    tasks.reverse();
    saveData();
    renderTasks();
    showToast('已重新排序');
}

// 工具函数
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (date.toDateString() === today.toDateString()) {
        return '今天';
    } else if (date.toDateString() === tomorrow.toDateString()) {
        return '明天';
    } else {
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return `${month}月${day}日`;
    }
}

function getPriorityText(priority) {
    const texts = {
        high: '高优先级',
        medium: '中优先级',
        low: '低优先级'
    };
    return texts[priority] || '中优先级';
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}

function playNotificationSound(isWorkComplete = true) {
    // 创建音频上下文播放提示音
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        if (isWorkComplete) {
            // 工作完成：播放愉悦的三音符
            playTone(audioContext, 523.25, 0, 0.15); // C5
            playTone(audioContext, 659.25, 0.15, 0.15); // E5
            playTone(audioContext, 783.99, 0.3, 0.3); // G5
        } else {
            // 休息完成：播放两音符
            playTone(audioContext, 659.25, 0, 0.15); // E5
            playTone(audioContext, 523.25, 0.15, 0.2); // C5
        }
    } catch (e) {
        console.log('Audio notification not supported');
    }
}

function playTone(audioContext, frequency, startTime, duration) {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    
    const start = audioContext.currentTime + startTime;
    const end = start + duration;
    
    gainNode.gain.setValueAtTime(0, start);
    gainNode.gain.linearRampToValueAtTime(0.2, start + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.01, end);
    
    oscillator.start(start);
    oscillator.stop(end);
}

function showNotification(title, body) {
    // 显示浏览器通知
    if ('Notification' in window) {
        if (Notification.permission === 'granted') {
            new Notification(title, {
                body: body,
                icon: '🍅',
                badge: '🍅',
                tag: 'pomodoro-notification',
                requireInteraction: false
            });
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    new Notification(title, {
                        body: body,
                        icon: '🍅'
                    });
                }
            });
        }
    }
}

function goBack() {
    window.history.back();
}

// 响应式处理
window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
        document.getElementById('rightPanel').classList.remove('show');
    }
});

// 页面卸载时保存状态
window.addEventListener('beforeunload', () => {
    saveData();
    saveStats();
});

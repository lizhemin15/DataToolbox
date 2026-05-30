
// 安装全局错误处理器。
function setupGlobalErrorHandlers() {
    // 捕获 Promise 未处理拒绝。
    window.addEventListener('unhandledrejection', function(event) {
        console.error('Promise 未处理拒绝:', event.reason);
        const msg = event.reason?.message || String(event.reason) || '未知错误';
        showToast('运行异常：' + msg, 'error', 5000);
        event.preventDefault();
    });
    
    // 捕获 JavaScript 运行错误。
    window.addEventListener('error', function(event) {
        if (event.target && (event.target.tagName === 'SCRIPT' || event.target.tagName === 'LINK' || event.target.tagName === 'IMG')) {
            return;
        }
        console.error('JavaScript 错误:', event.message);
        if (event.message && !event.message.includes('Script error')) {
            showToast('页面发生异常，请稍后重试', 'error', 4000);
        }
    }, true);
}

// 初始化页面。
// 全局错误处理。
function setupGlobalErrorHandlers() {
    // 捕获 Promise 未处理拒绝。
    window.addEventListener('unhandledrejection', function(event) {
        console.error('Promise 未处理拒绝:', event.reason);
        const msg = event.reason?.message || String(event.reason) || '未知错误';
        showToast('运行异常：' + msg, 'error', 5000);
        event.preventDefault();
    });
    
    // 捕获 JavaScript 运行错误。
    window.addEventListener('error', function(event) {
        if (event.target && (event.target.tagName === 'SCRIPT' || event.target.tagName === 'LINK' || event.target.tagName === 'IMG')) {
            return;
        }
        console.error('JavaScript 错误:', event.message);
        if (event.message && !event.message.includes('Script error')) {
            showToast('页面发生异常，请稍后重试', 'error', 4000);
        }
    }, true);
}

// 初始化页面。
document.addEventListener('DOMContentLoaded', async function() {
    setupGlobalErrorHandlers();
    initToastContainer();
    restoreColumnState();
    
    if (!checkServerAvailability()) {
        return;
    }

    const token = localStorage.getItem('dataOntologyToken');
    if (token) {
        currentUser = localStorage.getItem('dataOntologyUser');
        if (currentUser) {
            showMainPage();
            loadDatabases();
            loadGovernanceTasks();
        }
    }

    initEventListeners();
});

// 检查当前运行环境。
function checkServerAvailability() {
    if (window.location.protocol === 'file:') {
        showServerError('请通过服务端访问，不要直接打开 file:// 页面。当前协议：' + window.location.protocol);
        return false;
    }

    if (!window.location.origin || window.location.origin === 'null') {
        showServerError('当前页面来源无效，请通过正式站点访问。');
        return false;
    }

    return true;
}

// 显示服务端错误页面。
function showServerError(detail) {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('mainPage').style.display = 'none';
    
    const errorPage = document.getElementById('serverErrorPage');
    errorPage.style.display = 'block';
    
    document.getElementById('serverErrorDetail').textContent = detail;
    
    const returnBtn = document.getElementById('returnToMainBtn');
    if (returnBtn) {
        returnBtn.onclick = function() {
            window.location.href = '../../index.html';
        };
    }
}

// 绑定页面事件。
function initEventListeners() {
    document.getElementById('loginForm').addEventListener('submit', handleLogin);

    // 页面状态与事件绑定。
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // 复制当前数据库信息到表单。
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            if (!this.disabled) {
                switchTab(this.dataset.tab);
            }
        });
    });

    // 回填当前 API 信息。
    document.getElementById('addDbBtn').addEventListener('click', showAddDbModal);

    // 用户管理面板。
    document.getElementById('dbTypeInput').addEventListener('change', handleDbTypeChange);

    // 显示后自动淡入。
    document.getElementById('closeAddDbModal').addEventListener('click', hideAddDbModal);
    document.getElementById('addDbModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideAddDbModal();
        }
    });

    // 重新渲染当前 API。
    document.getElementById('testConnectionBtn').addEventListener('click', testConnection);

    // 加载数据库下拉选项。
    document.getElementById('addDbForm').addEventListener('submit', handleAddDatabase);

    // 根据接口类型填充示例参数。
    document.getElementById('editDbBtn').addEventListener('click', handleEditDatabase);

    // 刷新当前数据库详情。
    document.getElementById('refreshDbBtn').addEventListener('click', function() {
        if (currentDb) {
            loadDatabaseDetail(currentDb.id);
        }
    });

    // 删除当前数据库。
    document.getElementById('deleteDbBtn').addEventListener('click', handleDeleteDatabase);

    // closePreview 在预览区后半段定义。
    
    // 创建数据表。
    document.getElementById('createTableForm').addEventListener('submit', handleCreateTable);
    document.getElementById('addColumnBtn').addEventListener('click', addTableColumn);
    document.getElementById('closeCreateTableModal').addEventListener('click', hideCreateTableModal);
    document.getElementById('createTableModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideCreateTableModal();
        }
    });

    // API 与鉴权逻辑。
    document.getElementById('apikeyTriggerBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        const popover = document.getElementById('apikeyPopover');
        const btn = document.getElementById('apikeyTriggerBtn');
        popover.classList.toggle('show');
        if (popover.classList.contains('show')) {
            var rect = btn.getBoundingClientRect();
            var popoverW = 270;
            var sidebarWidth = 330;
            // 避免弹层被左侧栏遮挡，固定到右侧安全区域。
            var targetLeft = Math.max(rect.right, sidebarWidth);
            if (targetLeft + popoverW <= window.innerWidth) {
                popover.style.left = targetLeft + 'px';
                popover.style.right = 'auto';
            } else {
                popover.style.right = '20px';
                popover.style.left = 'auto';
            }
            popover.style.top = rect.top + 'px';
        }
    });
    // API Key 弹层点击空白处自动关闭。
    if (!window._apikeyPopoverClickHandler) {
        window._apikeyPopoverClickHandler = function(e) {
            const popover = document.getElementById('apikeyPopover');
            if (popover && !popover.contains(e.target) && e.target.id !== 'apikeyTriggerBtn') {
                popover.classList.remove('show');
            }
        };
        document.addEventListener('click', window._apikeyPopoverClickHandler);
    }
    document.getElementById('generateApikeyBtn').addEventListener('click', generateApiKey);
    document.getElementById('copyApikeyBtn').addEventListener('click', copyApiKey);
    document.getElementById('deleteApikeyBtn').addEventListener('click', deleteApiKey);
    document.getElementById('addApiBtn').addEventListener('click', showAddApiModal);
    document.getElementById('closeApiModal').addEventListener('click', hideAddApiModal);
    document.getElementById('addApiModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideAddApiModal();
        }
    });
    document.getElementById('addApiForm').addEventListener('submit', handleAddApi);
    document.querySelectorAll('input[name="apiType"]').forEach(radio => {
        radio.addEventListener('change', () => switchApiTypeFields(radio.value));
    });
    document.getElementById('editApiBtn').addEventListener('click', handleEditApi);
    document.getElementById('testApiBtn').addEventListener('click', showTestApiModal);
    document.getElementById('deleteApiBtn').addEventListener('click', handleDeleteApi);

    // MCP 相关按钮。
    const mcpCopyBaseUrlBtn = document.getElementById('mcpCopyBaseUrlBtn');
    if (mcpCopyBaseUrlBtn) mcpCopyBaseUrlBtn.addEventListener('click', function() {
        copyToClipboard(API_BASE || window.location.origin, this);
    });
    const mcpCopyKeyBtn = document.getElementById('mcpCopyKeyBtn');
    if (mcpCopyKeyBtn) mcpCopyKeyBtn.addEventListener('click', function() {
        if (!currentApiKey) return;
        copyToClipboard(currentApiKey, this);
    });
    const mcpGenerateKeyBtn = document.getElementById('mcpGenerateKeyBtn');
    if (mcpGenerateKeyBtn) mcpGenerateKeyBtn.addEventListener('click', async function() {
        await generateApiKey();
        loadMcpInfo();
    });
    const mcpCopyConfigBtn = document.getElementById('mcpCopyConfigBtn');
    if (mcpCopyConfigBtn) mcpCopyConfigBtn.addEventListener('click', function() {
        const pre = document.getElementById('mcpConfigPre');
        if (!pre) return;
        copyToClipboard(pre.textContent, this, '已复制');
    });
    const mcpSavePortBtn = document.getElementById('mcpSavePortBtn');
    if (mcpSavePortBtn) mcpSavePortBtn.addEventListener('click', async function() {
        await saveMcpPort();
    });

    // 基础校验。
    document.getElementById('closeTestApiModal').addEventListener('click', hideTestApiModal);
    document.getElementById('testApiModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideTestApiModal();
        }
    });
    document.getElementById('executeTestBtn').addEventListener('click', executeApiTest);

    // 测试结果视图切换
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            switchTestResultView(this.dataset.view);
        });
    });
    
    // AI 相关按钮。
    const aiSettingsBtn = document.getElementById('aiSettingsBtn');
    if (aiSettingsBtn) aiSettingsBtn.addEventListener('click', showAiSettingsModal);
    const closeAiSettingsModal = document.getElementById('closeAiSettingsModal');
    if (closeAiSettingsModal) closeAiSettingsModal.addEventListener('click', hideAiSettingsModal);
    const aiSettingsModal = document.getElementById('aiSettingsModal');
    if (aiSettingsModal) aiSettingsModal.addEventListener('click', function(e) {
        if (e.target === this) {
            hideAiSettingsModal();
        }
    });
    const aiSettingsForm = document.getElementById('aiSettingsForm');
    if (aiSettingsForm) aiSettingsForm.addEventListener('submit', handleSaveAiSettings);
    const detectCapabilitiesBtn = document.getElementById('detectCapabilitiesBtn');
    if (detectCapabilitiesBtn) detectCapabilitiesBtn.addEventListener('click', detectAiCapabilities);
    const aiSendBtn = document.getElementById('aiSendBtn');
    if (aiSendBtn) aiSendBtn.addEventListener('click', handleSendAiMessage);
    const aiInput = document.getElementById('aiInput');
    if (aiInput) {
        aiInput.addEventListener('keydown', handleAiInputKeydown);
        aiInput.addEventListener('input', handleAiInputChange);
    }

    // 同步索引弹窗
    document.getElementById('closeSyncIndexModal').addEventListener('click', hideSyncIndexModal);
    document.getElementById('syncIndexModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideSyncIndexModal();
        }
    });
    document.getElementById('cancelSyncIndexBtn').addEventListener('click', hideSyncIndexModal);
    document.getElementById('startSyncIndexBtn').addEventListener('click', handleSyncIndex);

    // 下拉菜单切换
    document.getElementById('syncDropdownToggle').addEventListener('click', function(e) {
        e.stopPropagation();
        const menu = document.getElementById('syncDropdownMenu');
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });

    // 点击其他地方关闭下拉菜单
    document.addEventListener('click', function(e) {
        const menu = document.getElementById('syncDropdownMenu');
        if (menu && !e.target.closest('#syncDropdownToggle') && !e.target.closest('#syncDropdownMenu')) {
            menu.style.display = 'none';
        }
    });

    // 数据库操作下拉菜单
    const indexPreviewBtn = document.getElementById('indexPreviewBtn');
    if (indexPreviewBtn) {
        indexPreviewBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const menu = document.getElementById('indexPreviewMenu');
            if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });
    }

    // 点击其他地方关闭数据库操作菜单
    document.addEventListener('click', function(e) {
        const menu = document.getElementById('indexPreviewMenu');
        if (menu && !e.target.closest('#indexPreviewBtn') && !e.target.closest('#indexPreviewMenu')) {
            menu.style.display = 'none';
        }
    });

    // 设置面板按钮。
    document.getElementById('settingsBtn').addEventListener('click', showSettingsModal);
    document.getElementById('closeSettingsModal').addEventListener('click', hideSettingsModal);
    document.getElementById('settingsModal').addEventListener('click', function(e) {
        if (e.target === this) {
            hideSettingsModal();
        }
    });
    document.getElementById('saveTabSettingsBtn').addEventListener('click', saveTabSettings);
    document.getElementById('resetTabSettingsBtn').addEventListener('click', resetTabSettings);
    
    // AI 设置入口的事件绑定。

    const userMgmtHeaderBtn = document.getElementById('userMgmtHeaderBtn');
    if (userMgmtHeaderBtn) {
        userMgmtHeaderBtn.addEventListener('click', function () {
            if (currentUser !== 'admin') return;
            if (userMgmtMode) {
                closeUserMgmtPanel();
            } else {
                openUserMgmtPanel();
            }
        });
    }
    const userMgmtBackdrop = document.getElementById('userMgmtDrawerBackdrop');
    if (userMgmtBackdrop) userMgmtBackdrop.addEventListener('click', function () { closeUserMgmtPanel(); });
    const userMgmtCloseBtn = document.getElementById('userMgmtCloseBtn');
    if (userMgmtCloseBtn) userMgmtCloseBtn.addEventListener('click', function () { closeUserMgmtPanel(); });
    const createUserBtn = document.getElementById('createUserBtn');
    if (createUserBtn) createUserBtn.addEventListener('click', handleCreateUser);
    const closeUserPasswordModal = document.getElementById('closeUserPasswordModal');
    if (closeUserPasswordModal) closeUserPasswordModal.addEventListener('click', hideUserPasswordModal);
    const userPasswordModal = document.getElementById('userPasswordModal');
    if (userPasswordModal) {
        userPasswordModal.addEventListener('click', function (e) {
            if (e.target === this) hideUserPasswordModal();
        });
    }
    const submitUserPasswordBtn = document.getElementById('submitUserPasswordBtn');
    if (submitUserPasswordBtn) submitUserPasswordBtn.addEventListener('click', submitUserPasswordChange);
    const newUserPwd = document.getElementById('newUserPassword');
    const newUserPwdConfirm = document.getElementById('newUserPasswordConfirm');
    if (newUserPwd) newUserPwd.addEventListener('input', clearUserMgmtCreatePwdHint);
    if (newUserPwdConfirm) newUserPwdConfirm.addEventListener('input', clearUserMgmtCreatePwdHint);
    const editPwd = document.getElementById('editPasswordInput');
    const editPwdConfirm = document.getElementById('editPasswordConfirmInput');
    if (editPwd) editPwd.addEventListener('input', clearUserPasswordModalPwdHint);
    if (editPwdConfirm) editPwdConfirm.addEventListener('input', clearUserPasswordModalPwdHint);
    // 批量导入用户
    const downloadUserTemplateBtn = document.getElementById('downloadUserTemplateBtn');
    if (downloadUserTemplateBtn) downloadUserTemplateBtn.addEventListener('click', handleDownloadUserTemplate);
    const importUsersFile = document.getElementById('importUsersFile');
    if (importUsersFile) importUsersFile.addEventListener('change', handleImportUsers);
}

(function () {
    const API_BASE = window.location.origin;
    let links = [];
    let editMode = false;
    let adminToken = '';

    const appGrid = document.getElementById('appGrid');
    const emptyState = document.getElementById('emptyState');
    const searchInput = document.getElementById('searchInput');
    const editBtn = document.getElementById('editBtn');
    const loginModal = document.getElementById('loginModal');
    const loginForm = document.getElementById('loginForm');
    const loginCancel = document.getElementById('loginCancel');
    const linkModal = document.getElementById('linkModal');
    const linkForm = document.getElementById('linkForm');
    const linkCancel = document.getElementById('linkCancel');

    function getAuthHeader() {
        return adminToken ? { 'Authorization': 'Bearer ' + adminToken } : {};
    }

    function titleToIcon(title) {
        if (!title || !title.trim()) return { text: '?', color: '#64748b' };
        const t = title.trim();
        let text = t.length >= 2 ? t.slice(0, 2) : t.slice(0, 1);
        let hash = 0;
        for (let i = 0; i < t.length; i++) hash = ((hash << 5) - hash) + t.charCodeAt(i);
        const hue = Math.abs(hash % 360);
        const color = `hsl(${hue}, 55%, 45%)`;
        return { text, color };
    }

    function renderIcon(link) {
        if (link.icon) {
            const icon = link.icon.trim();
            if (icon.startsWith('http') || icon.startsWith('data:')) {
                const { text, color } = titleToIcon(link.title);
                return '<div class="card-icon" data-color="' + escapeHtml(color) + '" data-text="' + escapeHtml(text) + '"><img src="' + escapeHtml(icon) + '" alt="" onerror="var d=this.parentElement;d.className=\'card-icon letter-icon\';d.style.background=d.dataset.color||\'#64748b\';d.innerHTML=d.dataset.text||\'?\'"></div>';
            }
            return '<div class="card-icon">' + escapeHtml(icon) + '</div>';
        }
        const { text, color } = titleToIcon(link.title);
        return '<div class="card-icon letter-icon" style="background:' + escapeHtml(color) + '">' + escapeHtml(text) + '</div>';
    }

    function escapeHtml(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    function filterLinks() {
        const kw = searchInput.value.trim().toLowerCase();
        if (!kw) return links;
        return links.filter(l =>
            (l.title && l.title.toLowerCase().includes(kw)) ||
            (l.url && l.url.toLowerCase().includes(kw))
        );
    }

    function render() {
        const filtered = filterLinks();
        emptyState.style.display = filtered.length === 0 ? 'block' : 'none';
        appGrid.style.display = filtered.length === 0 ? 'none' : 'grid';
        appGrid.innerHTML = filtered.map(link => {
            const iconHtml = renderIcon(link);
            const isImg = link.icon && (link.icon.startsWith('http') || link.icon.startsWith('data:'));
            const iconCls = isImg ? 'card-icon' : 'card-icon letter-icon';
            const actions = editMode
                ? '<div class="card-actions"><button type="button" class="btn-edit-card" data-id="' + escapeHtml(link.id) + '" title="编辑">✎</button><button type="button" class="btn-del" data-id="' + escapeHtml(link.id) + '" title="删除">×</button></div>'
                : '';
            return '<div class="app-card' + (editMode ? ' edit-mode' : '') + '" data-id="' + escapeHtml(link.id) + '" data-url="' + escapeHtml(link.url) + '">' +
                actions +
                iconHtml +
                '<div class="card-name">' + escapeHtml(link.title) + '</div>' +
                '<div class="card-url">' + escapeHtml(link.url) + '</div>' +
                '</div>';
        }).join('');

        editBtn.classList.toggle('edit-mode', editMode);
        document.getElementById('addLinkBtn').style.display = editMode ? 'inline-block' : 'none';
        if (editMode) {
            appGrid.querySelectorAll('.btn-edit-card').forEach(btn => {
                btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openLinkModal(btn.dataset.id); });
            });
            appGrid.querySelectorAll('.btn-del').forEach(btn => {
                btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); deleteLink(btn.dataset.id); });
            });
        }
        appGrid.querySelectorAll('.app-card').forEach(card => {
            card.addEventListener('click', function (e) {
                if (editMode) return;
                const url = card.dataset.url;
                if (url) window.open(url, '_blank', 'noopener');
            });
        });
    }

    function openLinkModal(id) {
        const titleEl = document.getElementById('linkModalTitle');
        document.getElementById('linkId').value = id || '';
        document.getElementById('linkTitle').value = '';
        document.getElementById('linkUrl').value = '';
        document.getElementById('linkIcon').value = '';
        document.getElementById('linkError').textContent = '';
        if (id) {
            const link = links.find(l => l.id === id);
            if (link) {
                titleEl.textContent = '编辑链接';
                document.getElementById('linkTitle').value = link.title;
                document.getElementById('linkUrl').value = link.url;
                document.getElementById('linkIcon').value = link.icon || '';
            }
        } else {
            titleEl.textContent = '添加链接';
        }
        linkModal.style.display = 'flex';
    }

    function closeLinkModal() {
        linkModal.style.display = 'none';
    }

    function deleteLink(id) {
        if (!adminToken) return;
        fetch(API_BASE + '/api/web-nav/links/' + encodeURIComponent(id), {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() }
        })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    links = links.filter(l => l.id !== id);
                    render();
                } else {
                    alert(data.message || '删除失败');
                }
            })
            .catch(() => alert('网络错误'));
    }

    function loadLinks() {
        fetch(API_BASE + '/api/web-nav/links')
            .then(r => r.json())
            .then(data => {
                if (data.success && Array.isArray(data.links)) {
                    links = data.links;
                }
                render();
            })
            .catch(() => {
                links = [];
                render();
            });
    }

    editBtn.addEventListener('click', function () {
        if (editMode) {
            editMode = false;
            render();
            return;
        }
        if (adminToken) {
            editMode = true;
            render();
            return;
        }
        document.getElementById('loginError').textContent = '';
        document.getElementById('loginUsername').value = 'admin';
        document.getElementById('loginPassword').value = '';
        loginModal.style.display = 'flex';
    });

    loginCancel.addEventListener('click', function () {
        loginModal.style.display = 'none';
    });
    loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;
        document.getElementById('loginError').textContent = '';
        fetch(API_BASE + '/api/web-nav/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    adminToken = data.token;
                    loginModal.style.display = 'none';
                    editMode = true;
                    render();
                } else {
                    document.getElementById('loginError').textContent = data.message || '登录失败';
                }
            })
            .catch(() => {
                document.getElementById('loginError').textContent = '网络错误';
            });
    });

    linkCancel.addEventListener('click', closeLinkModal);
    linkForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const id = document.getElementById('linkId').value.trim();
        const title = document.getElementById('linkTitle').value.trim();
        const url = document.getElementById('linkUrl').value.trim();
        const icon = document.getElementById('linkIcon').value.trim();
        document.getElementById('linkError').textContent = '';
        if (!title || !url) {
            document.getElementById('linkError').textContent = '请填写标题和链接';
            return;
        }
        const payload = { title, url };
        if (icon) payload.icon = icon;
        if (id) {
            payload.id = id;
            fetch(API_BASE + '/api/web-nav/links/' + encodeURIComponent(id), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                body: JSON.stringify(payload)
            })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        const idx = links.findIndex(l => l.id === id);
                        if (idx >= 0) links[idx] = data.link;
                        closeLinkModal();
                        render();
                    } else {
                        document.getElementById('linkError').textContent = data.message || '保存失败';
                    }
                })
                .catch(() => { document.getElementById('linkError').textContent = '网络错误'; });
        } else {
            fetch(API_BASE + '/api/web-nav/links', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                body: JSON.stringify(payload)
            })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        links.push(data.link);
                        closeLinkModal();
                        render();
                    } else {
                        document.getElementById('linkError').textContent = data.message || '添加失败';
                    }
                })
                .catch(() => { document.getElementById('linkError').textContent = '网络错误'; });
        }
    });

    searchInput.addEventListener('input', render);

    document.getElementById('appGrid').addEventListener('click', function (e) {
        if (editMode) return;
        const card = e.target.closest('.app-card');
        if (card && !e.target.closest('.card-actions')) {
            const url = card.dataset.url;
            if (url) window.open(url, '_blank', 'noopener');
        }
    });

    document.getElementById('addLinkBtn').addEventListener('click', function () {
        openLinkModal(null);
    });

    loadLinks();

    window.addLink = function () {
        if (!adminToken) return;
        openLinkModal(null);
    };
})();

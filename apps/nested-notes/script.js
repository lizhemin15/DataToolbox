(function () {
    'use strict';

    const STORAGE_KEY = 'nested-notes-data';
    let data, zoomId = 'root', searchText = '', pendingFocus = null;

    // ==================== Utilities ====================

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    function createNode(text) {
        return { id: uid(), text: text || '', collapsed: false, children: [] };
    }

    function findNode(id, node) {
        if (!node) node = data;
        if (node.id === id) return node;
        for (const c of node.children) {
            const r = findNode(id, c);
            if (r) return r;
        }
        return null;
    }

    function findParent(id, node) {
        if (!node) node = data;
        for (const c of node.children) {
            if (c.id === id) return node;
            const r = findParent(id, c);
            if (r) return r;
        }
        return null;
    }

    function getPath(id) {
        const path = [];
        let cur = id;
        while (cur && cur !== data.id) {
            const n = findNode(cur);
            if (n) path.unshift(n);
            const p = findParent(cur);
            cur = p ? p.id : null;
        }
        return path;
    }

    function getVisibleNodes(node) {
        if (!node) node = findNode(zoomId);
        const result = [];
        if (!node) return result;
        for (const c of node.children) {
            if (searchText && !matchesSearch(c)) continue;
            result.push(c);
            if (!c.collapsed && c.children.length > 0) {
                result.push(...getVisibleNodes(c));
            }
        }
        return result;
    }

    function getPrevNode(id) {
        const vis = getVisibleNodes();
        const i = vis.findIndex(n => n.id === id);
        return i > 0 ? vis[i - 1] : null;
    }

    function getNextNode(id) {
        const vis = getVisibleNodes();
        const i = vis.findIndex(n => n.id === id);
        return (i >= 0 && i < vis.length - 1) ? vis[i + 1] : null;
    }

    function countAll(node) {
        let c = node.id === data.id ? 0 : 1;
        for (const ch of node.children) c += countAll(ch);
        return c;
    }

    function matchesSearch(node) {
        if (!searchText) return true;
        const q = searchText.toLowerCase();
        if (node.text.toLowerCase().includes(q)) return true;
        return node.children.some(c => matchesSearch(c));
    }

    // ==================== Storage ====================

    function save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* quota */ }
    }

    function load() {
        try {
            const s = localStorage.getItem(STORAGE_KEY);
            if (s) { data = JSON.parse(s); return; }
        } catch (e) { /* parse error */ }
        data = { id: 'root', text: '首页', collapsed: false, children: [createNode('欢迎使用无限嵌套笔记')] };
    }

    // ==================== Tree Operations ====================

    function addSiblingAfter(id) {
        const parent = findParent(id);
        if (!parent) return;
        const idx = parent.children.findIndex(c => c.id === id);
        const nn = createNode();
        parent.children.splice(idx + 1, 0, nn);
        save();
        pendingFocus = { id: nn.id, pos: 'start' };
        render();
    }

    function indentNode(id) {
        const parent = findParent(id);
        if (!parent) return;
        const idx = parent.children.findIndex(c => c.id === id);
        if (idx <= 0) return;
        const prev = parent.children[idx - 1];
        const node = parent.children.splice(idx, 1)[0];
        prev.children.push(node);
        prev.collapsed = false;
        save();
        pendingFocus = { id, pos: 'end' };
        render();
    }

    function outdentNode(id) {
        const parent = findParent(id);
        if (!parent || parent.id === zoomId) return;
        const gp = findParent(parent.id);
        if (!gp) return;
        const idx = parent.children.findIndex(c => c.id === id);
        const node = parent.children.splice(idx, 1)[0];
        const after = parent.children.splice(idx);
        node.children.push(...after);
        const pIdx = gp.children.findIndex(c => c.id === parent.id);
        gp.children.splice(pIdx + 1, 0, node);
        save();
        pendingFocus = { id, pos: 'end' };
        render();
    }

    function removeNode(id) {
        const parent = findParent(id);
        if (!parent) return;
        const idx = parent.children.findIndex(c => c.id === id);
        const node = parent.children[idx];
        parent.children.splice(idx, 1, ...node.children);
        const prev = getPrevNode(id);
        if (prev) {
            pendingFocus = { id: prev.id, pos: 'end' };
        } else if (parent.children.length > 0) {
            pendingFocus = { id: parent.children[Math.min(idx, parent.children.length - 1)].id, pos: 'start' };
        }
        save();
        render();
    }

    // ==================== Rendering ====================

    function render() {
        const zoomNode = findNode(zoomId);
        if (!zoomNode) { zoomId = 'root'; return render(); }

        if (zoomNode.children.length === 0) {
            const first = createNode();
            zoomNode.children.push(first);
            save();
        }

        renderBreadcrumbs();
        renderTree(zoomNode);
        updateCount();

        if (pendingFocus) {
            const el = document.querySelector('.item-text[data-id="' + pendingFocus.id + '"]');
            if (el) { el.focus(); setCursor(el, pendingFocus.pos); }
            pendingFocus = null;
        }
    }

    function renderBreadcrumbs() {
        const bc = document.getElementById('breadcrumbs');
        bc.innerHTML = '';
        const segments = [data];
        if (zoomId !== 'root') {
            const path = getPath(zoomId);
            segments.push(...path);
        }
        const seen = new Set();
        segments.forEach((n, i) => {
            if (seen.has(n.id)) return;
            seen.add(n.id);
            if (i > 0) {
                const sep = document.createElement('span');
                sep.className = 'bc-sep';
                sep.textContent = '›';
                bc.appendChild(sep);
            }
            const a = document.createElement('a');
            a.className = 'bc-item' + (n.id === zoomId ? ' bc-current' : '');
            a.textContent = n.id === 'root' ? '首页' : (n.text || '未命名');
            a.href = '#';
            a.onclick = function (e) { e.preventDefault(); zoomId = n.id; render(); };
            bc.appendChild(a);
        });
    }

    function renderTree(zoomNode) {
        const content = document.getElementById('content');
        content.innerHTML = '';
        const list = document.createElement('div');
        list.className = 'node-list';
        for (const child of zoomNode.children) {
            const el = renderNode(child);
            if (el) list.appendChild(el);
        }
        const addBtn = document.createElement('button');
        addBtn.className = 'add-item-btn';
        addBtn.innerHTML = '+ 新建条目';
        addBtn.onclick = function () {
            const nn = createNode();
            zoomNode.children.push(nn);
            save();
            pendingFocus = { id: nn.id, pos: 'start' };
            render();
        };
        list.appendChild(addBtn);
        content.appendChild(list);
    }

    function renderNode(node) {
        if (searchText && !matchesSearch(node)) return null;

        const item = document.createElement('div');
        item.className = 'item' + (node.collapsed ? ' collapsed' : '');
        item.dataset.id = node.id;

        const row = document.createElement('div');
        row.className = 'item-row';
        if (searchText && node.text.toLowerCase().includes(searchText.toLowerCase())) {
            row.classList.add('search-match');
        }

        const toggle = document.createElement('span');
        toggle.className = 'item-toggle' + (node.children.length > 0 ? ' has-children' : '');
        toggle.textContent = node.children.length > 0 ? (node.collapsed ? '▶' : '▼') : '';
        toggle.onclick = function () {
            node.collapsed = !node.collapsed;
            save();
            render();
        };

        const bullet = document.createElement('span');
        bullet.className = 'item-bullet' + (node.children.length > 0 ? ' parent-bullet' : '');
        bullet.innerHTML = '<span class="dot"></span>';
        if (node.children.length > 0) {
            bullet.title = '点击聚焦到此节点';
            bullet.onclick = function () { zoomId = node.id; render(); };
        }

        const text = document.createElement('div');
        text.className = 'item-text';
        text.contentEditable = 'true';
        text.dataset.id = node.id;
        text.textContent = node.text;
        text.spellcheck = false;

        text.addEventListener('input', function () {
            node.text = text.textContent;
            save();
        });

        text.addEventListener('keydown', function (e) { handleKey(e, node, text); });

        text.addEventListener('paste', function (e) {
            e.preventDefault();
            const raw = (e.clipboardData || window.clipboardData).getData('text');
            const lines = raw.split('\n').filter(function (l) { return l.trim(); });
            if (lines.length <= 1) {
                document.execCommand('insertText', false, raw);
                node.text = text.textContent;
                save();
                return;
            }
            document.execCommand('insertText', false, lines[0]);
            node.text = text.textContent;
            const parent = findParent(node.id);
            if (!parent) return;
            const idx = parent.children.findIndex(function (c) { return c.id === node.id; });
            var lastId = node.id;
            for (var i = 1; i < lines.length; i++) {
                var nn = createNode(lines[i].replace(/^[\s\-\*\•\·]+/, ''));
                var li = parent.children.findIndex(function (c) { return c.id === lastId; });
                parent.children.splice(li + 1, 0, nn);
                lastId = nn.id;
            }
            save();
            pendingFocus = { id: lastId, pos: 'end' };
            render();
        });

        row.appendChild(toggle);
        row.appendChild(bullet);
        row.appendChild(text);
        item.appendChild(row);

        if (node.children.length > 0 && !node.collapsed) {
            const cc = document.createElement('div');
            cc.className = 'item-children';
            for (const child of node.children) {
                const el = renderNode(child);
                if (el) cc.appendChild(el);
            }
            item.appendChild(cc);
        }

        return item;
    }

    function updateCount() {
        const el = document.getElementById('itemCount');
        if (el) el.textContent = countAll(data) + ' 条';
    }

    // ==================== Cursor ====================

    function setCursor(el, pos) {
        var range = document.createRange();
        var sel = window.getSelection();
        if (!el.childNodes.length) {
            range.setStart(el, 0);
            range.collapse(true);
        } else if (pos === 'start') {
            range.setStartBefore(el.firstChild);
            range.collapse(true);
        } else if (pos === 'end') {
            range.setEndAfter(el.lastChild);
            range.collapse(false);
        } else if (typeof pos === 'number') {
            var tn = el.firstChild;
            if (tn && tn.nodeType === Node.TEXT_NODE) {
                range.setStart(tn, Math.min(pos, tn.length));
                range.collapse(true);
            } else {
                range.selectNodeContents(el);
                range.collapse(false);
            }
        }
        sel.removeAllRanges();
        sel.addRange(range);
    }

    function getCursorOffset(el) {
        var sel = window.getSelection();
        if (!sel.rangeCount) return 0;
        var range = sel.getRangeAt(0);
        var pre = range.cloneRange();
        pre.selectNodeContents(el);
        pre.setEnd(range.startContainer, range.startOffset);
        return pre.toString().length;
    }

    // ==================== Keyboard ====================

    function handleKey(e, node, textEl) {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
            e.preventDefault();
            var offset = getCursorOffset(textEl);
            var full = textEl.textContent;

            if (offset >= full.length) {
                if (node.children.length > 0 && !node.collapsed) {
                    var nn = createNode();
                    node.children.unshift(nn);
                    save();
                    pendingFocus = { id: nn.id, pos: 'start' };
                    render();
                } else {
                    addSiblingAfter(node.id);
                }
            } else {
                var before = full.substring(0, offset);
                var after = full.substring(offset);
                node.text = before;
                textEl.textContent = before;
                var parent = findParent(node.id);
                if (!parent) return;
                var idx = parent.children.findIndex(function (c) { return c.id === node.id; });
                var nn2 = createNode(after);
                parent.children.splice(idx + 1, 0, nn2);
                save();
                pendingFocus = { id: nn2.id, pos: 'start' };
                render();
            }
        } else if (e.key === 'Tab') {
            e.preventDefault();
            if (e.shiftKey) {
                outdentNode(node.id);
            } else {
                indentNode(node.id);
            }
        } else if (e.key === 'Backspace') {
            var off = getCursorOffset(textEl);
            if (off !== 0) return;

            var sel = window.getSelection();
            if (sel.rangeCount && !sel.getRangeAt(0).collapsed) return;

            e.preventDefault();

            if (textEl.textContent === '') {
                var parent = findParent(node.id);
                if (!parent) return;
                if (parent.children.length > 1 || node.children.length === 0) {
                    removeNode(node.id);
                } else {
                    outdentNode(node.id);
                }
            } else {
                var prev = getPrevNode(node.id);
                if (!prev) return;
                var prevLen = prev.text.length;
                prev.text = prev.text + textEl.textContent;
                prev.children.push(...node.children);
                node.children = [];
                var parent2 = findParent(node.id);
                if (parent2) {
                    var idx2 = parent2.children.findIndex(function (c) { return c.id === node.id; });
                    parent2.children.splice(idx2, 1);
                }
                save();
                pendingFocus = { id: prev.id, pos: prevLen };
                render();
            }
        } else if (e.key === 'ArrowUp') {
            var off2 = getCursorOffset(textEl);
            if (off2 === 0) {
                e.preventDefault();
                var p = getPrevNode(node.id);
                if (p) { pendingFocus = { id: p.id, pos: 'end' }; render(); }
            }
        } else if (e.key === 'ArrowDown') {
            var off3 = getCursorOffset(textEl);
            if (off3 >= textEl.textContent.length) {
                e.preventDefault();
                var nx = getNextNode(node.id);
                if (nx) { pendingFocus = { id: nx.id, pos: 'start' }; render(); }
            }
        }
    }

    // ==================== Global API ====================

    window.goBack = function () {
        if (zoomId !== 'root') {
            var parent = findParent(zoomId);
            if (parent) { zoomId = parent.id; render(); return; }
        }
        window.location.href = '../../index.html';
    };

    window.exportData = function () {
        var json = JSON.stringify(data, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'nested-notes-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    };

    window.importData = function () {
        document.getElementById('importFile').click();
    };

    window.handleImport = function (event) {
        var file = event.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
            try {
                var imported = JSON.parse(e.target.result);
                if (imported && Array.isArray(imported.children)) {
                    if (!imported.id) imported.id = 'root';
                    data = imported;
                    zoomId = 'root';
                    save();
                    render();
                } else {
                    alert('无效的笔记数据格式：缺少 children 数组');
                }
            } catch (err) {
                alert('导入失败: ' + err.message);
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    window.handleSearch = function (value) {
        searchText = value.trim();
        render();
    };

    window.showHelp = function () {
        document.getElementById('helpModal').style.display = 'flex';
    };

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            var modal = document.getElementById('helpModal');
            if (modal.style.display === 'flex') {
                modal.style.display = 'none';
                return;
            }
            if (searchText) {
                document.getElementById('searchInput').value = '';
                searchText = '';
                render();
            }
        }
    });

    // ==================== Init ====================

    load();
    render();

    var firstText = document.querySelector('.item-text');
    if (firstText) { firstText.focus(); setCursor(firstText, 'end'); }
})();

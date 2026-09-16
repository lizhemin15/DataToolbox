// ============================================================================
// gov-code-studio.js — 治理任务「AI 代码编辑器」
//
// 入口：治理任务编辑页「任务代码 (JavaScript)」标题栏里的「✨ AI 编辑」按钮。
// 形态：占满页面的置顶弹窗，三栏布局（版本 | 代码 | AI 对话），交互参考 Cursor。
// 能力：
//   1. 版本管理 —— 每次 AI 产出/手动存盘都形成一个版本，可随时切换回滚、删除；
//   2. AI 辅助编写 —— 系统提示词固定使用「API 参考」里的内容（gov-shared.js 的
//      GOV_API_DOCS / governanceFunctions），保证生成的代码只用真实存在的 gov.* API；
//   3. 版本持久化在服务端（/api/v1/gov/tasks/{id}/code-versions），换浏览器也在。
//
// 注意：本文件可被 Node 直接 require（纯函数部分），供 tests/js 做回归测试。
// ============================================================================
(function (root) {
    'use strict';

    var PREFIX = (typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/v1/gov/tasks/';
    var SOURCE_LABEL = { seed: '⛳ 初始', ai: '🤖 AI', manual: '✍️ 手动', restore: '↩️ 回滚' };

    var state = {
        taskId: null,
        taskName: '',
        versions: [],
        chat: [],
        currentCode: '',      // 服务端当前生效代码
        editorCode: '',       // 编辑器里的代码（可能是预览某版本，尚未应用）
        previewId: null,
        activeId: null,       // 与服务端 current_code 匹配的版本
        sending: false,
        open: false
    };

    // ---------------------------------------------------------------- 纯函数区

    // 从 AI 回复里抽出代码块：优先取 ```js/```javascript，其次任意 ```，都不存在则取整段
    function extractCodeFromReply(reply) {
        if (!reply) return { code: '', fenced: false };
        var text = String(reply);
        var best = '';
        var re = /```([a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```/g;
        var m;
        while ((m = re.exec(text)) !== null) {
            var lang = (m[1] || '').toLowerCase();
            var body = m[2];
            var isJs = lang === '' || lang === 'js' || lang === 'javascript' || lang === 'node';
            var score = (isJs ? 100000 : 0) + body.length;
            if (score > (best ? best.length : 0)) best = body;
            if (isJs && body.length > 0) best = body;
        }
        if (best) return { code: String(best).replace(/^\s*\n/, '').replace(/\s+$/, '\n'), fenced: true };
        return { code: '', fenced: false };
    }

    // 把 API 参考条目格式化成系统提示词片段
    function formatApiReference(docs) {
        if (!docs || !docs.length) return '（未能读取到 API 参考，请严格只使用代码里已经出现的 gov.* 方法）';
        var lines = [];
        docs.forEach(function (d) {
            if (!d) return;
            var name = d.name || d.signature || '';
            if (!name) return;
            lines.push('- ' + name + (d.desc ? '：' + d.desc : ''));
            if (d.example) {
                String(d.example).split('\n').forEach(function (el) {
                    lines.push('    例: ' + el);
                });
            }
        });
        return lines.join('\n');
    }

    // 组装发给 AI 的完整 prompt（该接口只接受单个 prompt，故把角色/上下文都写进去）
    function buildPrompt(opts) {
        opts = opts || {};
        var task = opts.task || {};
        var docs = opts.docs || [];
        var code = opts.code || '';
        var chat = opts.chat || [];
        var userText = opts.userText || '';

        var head = [
            '你是一名 DataToolbox「数据治理任务」的 JavaScript 代码助手，负责编写和修改任务脚本。',
            '',
            '【运行环境】脚本运行在任务执行器里，可直接使用下列 gov.* API（这是官方 API 参考，务必只使用其中存在的能力，不要杜撰方法）：',
            formatApiReference(docs),
            '',
            '【硬性输出要求】',
            '1. 只输出一个 ```javascript 代码块，内容是可完整运行的整个脚本（不是片段、不是 diff）。',
            '2. 代码块之外最多写 3 行以内的中文说明，不要长篇解释。',
            '3. 保留原有能正常工作的逻辑，除非用户明确要求改写。',
            '4. 变量用 const/let；异步用 await；不要用浏览器专有 API（除非任务执行模式为 frontend）。'
        ].join('\n');

        var taskInfo = [
            '',
            '【当前任务】',
            '名称：' + (task.name || '(未命名)'),
            '描述：' + (task.description || '(无)'),
            '输入类型：' + (task.input_type || '未设置') + '　执行位置：' + ((task.run_mode || task.execution_mode || 'backend')) + '　关联数据库：' + (task.database_id || '未关联')
        ].join('\n');

        var cur = ['', '【当前生效的代码】', '```javascript', code || '// (空)', '```'].join('\n');

        var hist = '';
        if (chat.length) {
            var recent = chat.slice(-10);
            hist = '\n\n【最近对话】\n' + recent.map(function (m) {
                return (m.role === 'user' ? '用户：' : '助手：') + String(m.content || '').slice(0, 600);
            }).join('\n');
        }

        return head + taskInfo + cur + hist + '\n\n【本次请求】\n' + userText;
    }

    // ------------------------------------------------------------------ 工具

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtTime(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso).slice(11, 16);
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function toast(msg, type) {
        if (typeof showToast === 'function') { try { showToast(msg, type || 'info'); return; } catch (e) {} }
        console.log('[GovCodeStudio]', msg);
    }

    function api(path, options) {
        options = options || {};
        options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
        if (typeof fetchWithAuth === 'function') return fetchWithAuth(path, options);
        return fetch(path, options);
    }

    // 取 API 参考（与「📖 API 参考」弹窗同源）
    function collectApiDocs() {
        var shared = root.__GOV_SHARED_REF__ || root.GOV_SHARED || (root.globalThis && root.globalThis.GOV_SHARED) || {};
        var docs = root.governanceFunctions || root.GOV_API_DOCS || shared.governanceFunctions || shared.GOV_API_DOCS || shared.GOV_API_SECTIONS || [];
        if (Array.isArray(docs) && docs.length) return docs;
        // 有些版本把内容放在分区里
        var sections = shared.GOV_API_SECTIONS || (typeof GOV_API_SECTIONS_LOCAL !== 'undefined' ? GOV_API_SECTIONS_LOCAL : []);
        var flat = [];
        (sections || []).forEach(function (sec) {
            (sec.items || []).forEach(function (it) { flat.push(it); });
        });
        return flat;
    }

    // ------------------------------------------------------------------ DOM

    var el = {};

    function build() {
        if (el.overlay) return;
        var wrap = document.createElement('div');
        wrap.className = 'gcs-overlay';
        wrap.id = 'govCodeStudio';
        wrap.style.display = 'none';
        wrap.innerHTML = [
            '<div class="gcs-shell">',
            '  <div class="gcs-topbar">',
            '    <div class="gcs-title">✨ AI 代码编辑器<span class="gcs-sub" id="gcsTaskName"></span></div>',
            '    <div class="gcs-status" id="gcsStatus"></div>',
            '    <div class="gcs-actions">',
            '      <button type="button" class="gcs-btn" id="gcsSaveVersionBtn" title="把编辑器里的代码存成一个新版本">存为新版本</button>',
            '      <button type="button" class="gcs-btn gcs-btn-primary" id="gcsApplyBtn" title="写回任务表单的任务代码，保存任务后生效">应用到任务代码</button>',
            '      <button type="button" class="gcs-btn gcs-btn-ghost" id="gcsCloseBtn" title="关闭">×</button>',
            '    </div>',
            '  </div>',
            '  <div class="gcs-body">',
            '    <aside class="gcs-pane gcs-pane-versions">',
            '      <div class="gcs-pane-head"><span>版本历史</span><span class="gcs-count" id="gcsVerCount">0</span></div>',
            '      <div class="gcs-version-list" id="gcsVersionList"></div>',
            '      <div class="gcs-versions-tip">点击版本可预览；「回滚」把它设为任务当前代码。</div>',
            '    </aside>',
            '    <main class="gcs-pane gcs-pane-editor">',
            '      <div class="gcs-pane-head"><span>任务代码 (JavaScript)</span><span class="gcs-editor-hint" id="gcsEditorHint"></span></div>',
            '      <div class="gcs-code-wrap">',
            '        <pre class="gcs-gutter" id="gcsGutter"></pre>',
            '        <textarea class="gcs-code" id="gcsCode" spellcheck="false" wrap="off"></textarea>',
            '      </div>',
            '    </main>',
            '    <aside class="gcs-pane gcs-pane-chat">',
            '      <div class="gcs-pane-head"><span>AI 辅助</span><button type="button" class="gcs-mini" id="gcsClearChatBtn">清空对话</button></div>',
            '      <div class="gcs-chat-log" id="gcsChatLog"></div>',
            '      <div class="gcs-chat-input">',
            '        <textarea id="gcsChatText" rows="3" placeholder="描述你要改什么，例如：把缺失的维度补成空串，并加一行日志&#10;Enter 发送 / Shift+Enter 换行"></textarea>',
            '        <div class="gcs-chat-input-bar">',
            '          <span class="gcs-hint" id="gcsChatHint">系统提示词已注入「API 参考」内容</span>',
            '          <button type="button" class="gcs-btn gcs-btn-primary" id="gcsSendBtn">发送</button>',
            '        </div>',
            '      </div>',
            '    </aside>',
            '  </div>',
            '</div>'
        ].join('\n');
        document.body.appendChild(wrap);

        el.overlay = wrap;
        ['gcsTaskName', 'gcsStatus', 'gcsVersionList', 'gcsVerCount', 'gcsCode', 'gcsGutter', 'gcsEditorHint',
         'gcsChatLog', 'gcsChatText', 'gcsSendBtn', 'gcsApplyBtn', 'gcsSaveVersionBtn', 'gcsCloseBtn',
         'gcsClearChatBtn', 'gcsChatHint'].forEach(function (id) {
            el[id] = document.getElementById(id);
        });

        el.gcsCloseBtn.addEventListener('click', close);
        el.gcsApplyBtn.addEventListener('click', applyToForm);
        el.gcsSaveVersionBtn.addEventListener('click', function () { saveVersion('manual', '手动保存'); });
        el.gcsClearChatBtn.addEventListener('click', clearChat);
        el.gcsSendBtn.addEventListener('click', send);
        el.gcsCode.addEventListener('input', function () {
            state.editorCode = el.gcsCode.value;
            state.previewId = null;
            renderGutter();
            renderHint('（已修改，未保存为新版本）');
        });
        el.gcsCode.addEventListener('scroll', function () { el.gcsGutter.scrollTop = el.gcsCode.scrollTop; });
        el.gcsCode.addEventListener('keydown', function (e) {
            if (e.key === 'Tab') {  // 缩进
                e.preventDefault();
                var t = el.gcsCode, s = t.selectionStart, en = t.selectionEnd;
                t.value = t.value.slice(0, s) + '  ' + t.value.slice(en);
                t.selectionStart = t.selectionEnd = s + 2;
                state.editorCode = t.value;
            }
        });
        el.gcsChatText.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        });
        el.gcsVersionList.addEventListener('click', onVersionClick);
        el.overlay.addEventListener('click', function (e) { if (e.target === el.overlay) close(); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && state.open) close();
        });
    }

    function renderGutter() {
        var n = (state.editorCode || '').split('\n').length;
        var out = [];
        for (var i = 1; i <= n; i++) out.push(i);
        el.gcsGutter.textContent = out.join('\n');
    }

    function renderHint(text) {
        if (el.gcsEditorHint) el.gcsEditorHint.textContent = text || '';
    }

    function setStatus(text, kind) {
        if (!el.gcsStatus) return;
        el.gcsStatus.textContent = text || '';
        el.gcsStatus.className = 'gcs-status' + (kind ? ' gcs-status-' + kind : '');
    }

    function versionLabel(v, idx) {
        var src = SOURCE_LABEL[v.source] || v.source || '';
        return { idx: 'v' + idx, src: src, time: fmtTime(v.created_at) };
    }

    function renderVersions() {
        var list = state.versions || [];
        el.gcsVerCount.textContent = String(list.length);
        if (!list.length) {
            el.gcsVersionList.innerHTML = '<div class="gcs-empty">还没有版本。点「存为新版本」或让 AI 改一版。</div>';
            return;
        }
        var html = [];
        list.forEach(function (v, i) {
            var meta = versionLabel(v, i + 1);
            var cls = 'gcs-ver';
            if (state.activeId && v.id === state.activeId) cls += ' gcs-ver-active';
            if (state.previewId && v.id === state.previewId) cls += ' gcs-ver-preview';
            html.push(
                '<div class="' + cls + '" data-id="' + esc(v.id) + '">' +
                '  <div class="gcs-ver-top">' +
                '    <span class="gcs-ver-idx">' + esc(meta.idx) + '</span>' +
                '    <span class="gcs-ver-src">' + esc(meta.src) + '</span>' +
                '    <span class="gcs-ver-time">' + esc(meta.time) + '</span>' +
                '  </div>' +
                (v.note ? '<div class="gcs-ver-note">' + esc(String(v.note).slice(0, 80)) + '</div>' : '') +
                '  <div class="gcs-ver-actions">' +
                '    <button type="button" class="gcs-mini" data-act="preview">预览</button>' +
                '    <button type="button" class="gcs-mini gcs-mini-primary" data-act="rollback">回滚</button>' +
                '    <button type="button" class="gcs-mini gcs-mini-danger" data-act="del">删除</button>' +
                '  </div>' +
                '</div>'
            );
        });
        el.gcsVersionList.innerHTML = html.join('');
        var act = el.gcsVersionList.querySelector('.gcs-ver-active');
        if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
    }

    function renderChat() {
        var log = state.chat || [];
        if (!log.length) {
            el.gcsChatLog.innerHTML = '<div class="gcs-chat-empty">让 AI 帮你改这段代码。<br>提示：它会带着「API 参考」当系统提示词，并看到当前代码和历史对话。<br>每次产出都会自动存成一个新版本。</div>';
            return;
        }
        var html = [];
        log.forEach(function (m) {
            var who = m.role === 'user' ? '你' : 'AI';
            html.push('<div class="gcs-msg gcs-msg-' + esc(m.role) + '"><div class="gcs-msg-who">' + who + '</div><div class="gcs-msg-body">' + esc(m.content) + '</div></div>');
        });
        el.gcsChatLog.innerHTML = html.join('');
        el.gcsChatLog.scrollTop = el.gcsChatLog.scrollHeight;
    }

    function setEditorCode(code) {
        state.editorCode = code || '';
        el.gcsCode.value = state.editorCode;
        renderGutter();
    }

    // ---------------------------------------------------------------- 数据流

    function open(taskId) {
        build();
        var task = (typeof currentGovTask !== 'undefined' && currentGovTask) ? currentGovTask : null;
        // 未保存的新任务：用表单里的代码当种子
        var formCode = '';
        var formEl = document.getElementById('govCodeInput');
        if (formEl) formCode = formEl.value || '';

        state.taskId = taskId || (task && task.id) || null;
        state.taskName = (task && task.name) || (document.getElementById('govTaskNameInput') || {}).value || '(未命名任务)';
        state.previewId = null;
        state.activeId = null;
        state.open = true;
        el.overlay.style.display = 'flex';
        el.gcsTaskName.textContent = state.taskName;
        renderChat();

        if (!state.taskId) {
            state.versions = []; state.chat = [];
            setEditorCode(formCode);
            renderVersions();
            renderHint('任务尚未保存，先把代码保存成任务后再用版本管理');
            setStatus('未保存的任务：版本功能需先保存任务', 'warn');
            return;
        }
        setStatus('加载中…');
        setEditorCode(formCode);
        loadVersions();
    }

    function close() {
        state.open = false;
        if (el.overlay) el.overlay.style.display = 'none';
    }

    function loadVersions() {
        api(PREFIX + encodeURIComponent(state.taskId) + '/code-versions')
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d || !d.success) { setStatus((d && d.message) || '加载失败', 'err'); return; }
                state.versions = d.versions || [];
                state.chat = d.chat || [];
                state.currentCode = d.current_code || '';
                // 与服务端当前代码一致的版本视为「当前生效」
                state.activeId = null;
                for (var i = state.versions.length - 1; i >= 0; i--) {
                    if (state.versions[i].code === state.currentCode) { state.activeId = state.versions[i].id; break; }
                }
                if (!state.versions.length && state.currentCode) {
                    // 首次使用：把现有代码存成初始版本，后续才有对比基线
                    return postVersion(state.currentCode, 'seed', '初始版本', null).then(function () {
                        setEditorCode(state.currentCode);
                        setStatus('');
                    });
                }
                setEditorCode(state.currentCode || state.editorCode);
                renderVersions();
                setStatus('');
            })
            .catch(function (e) { setStatus('加载失败：' + e.message, 'err'); });
    }

    function postVersion(code, source, note, chat) {
        var body = { code: code, source: source, note: note };
        if (chat) body.chat = chat;
        return api(PREFIX + encodeURIComponent(state.taskId) + '/code-versions', {
            method: 'POST', body: JSON.stringify(body)
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (!d || !d.success) { toast((d && d.message) || '保存版本失败', 'error'); return d; }
            state.versions = d.versions || state.versions;
            if (d.chat) state.chat = d.chat;
            if (d.version) {
                state.activeId = d.version.id;
                state.currentCode = d.version.code;
            }
            renderVersions();
            return d;
        });
    }

    function saveVersion(source, note) {
        if (!state.taskId) { toast('请先保存任务，再存版本', 'warn'); return Promise.resolve(); }
        var code = el.gcsCode.value || '';
        if (!code.trim()) { toast('代码为空', 'warn'); return Promise.resolve(); }
        return postVersion(code, source || 'manual', note || '手动保存', null).then(function (d) {
            if (d && d.success) { toast('已存为新版本', 'success'); setStatus('已保存'); }
        });
    }

    function applyToForm() {
        var code = el.gcsCode.value || '';
        var formEl = document.getElementById('govCodeInput');
        if (!formEl) { toast('找不到任务代码输入框', 'error'); return; }
        formEl.value = code;
        formEl.dispatchEvent(new Event('input', { bubbles: true }));
        if (typeof currentGovTask !== 'undefined' && currentGovTask) currentGovTask.js_code = code;
        toast('已写回任务表单，点「保存」后生效', 'success');
        setStatus('已写回表单（记得点保存）', 'ok');
    }

    function applyVersion(id) {
        if (!state.taskId) { toast('请先保存任务', 'warn'); return; }
        api(PREFIX + encodeURIComponent(state.taskId) + '/code-versions/restore', {
            method: 'POST', body: JSON.stringify({ version_id: id })
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (!d || !d.success) { toast((d && d.message) || '回滚失败', 'error'); return; }
            state.versions = d.versions || state.versions;
            state.currentCode = d.code || '';
            state.activeId = id;
            state.previewId = null;
            setEditorCode(state.currentCode);
            // 同步任务表单，避免"界面旧代码"覆盖刚回滚的结果
            var formEl = document.getElementById('govCodeInput');
            if (formEl) {
                formEl.value = state.currentCode;
                formEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (typeof currentGovTask !== 'undefined' && currentGovTask) currentGovTask.js_code = state.currentCode;
            renderVersions();
            setStatus('已回滚并同步到任务', 'ok');
            toast('已回滚到该版本', 'success');
        }).catch(function (e) { toast('回滚失败：' + e.message, 'error'); });
    }

    function deleteVersion(id) {
        if (!confirm('删除这个版本？该操作不可恢复（不影响任务当前代码）。')) return;
        api(PREFIX + encodeURIComponent(state.taskId) + '/code-versions/' + encodeURIComponent(id), { method: 'DELETE' })
            .then(function (r) { return r.json(); }).then(function (d) {
                if (!d || !d.success) { toast((d && d.message) || '删除失败', 'error'); return; }
                state.versions = d.versions || [];
                if (state.previewId === id) state.previewId = null;
                if (state.activeId === id) state.activeId = null;
                renderVersions();
            });
    }

    function onVersionClick(e) {
        var btn = e.target.closest('button[data-act]');
        var card = e.target.closest('.gcs-ver');
        if (!card) return;
        var id = card.getAttribute('data-id');
        var v = (state.versions || []).filter(function (x) { return x.id === id; })[0];
        if (!v) return;
        if (!btn) return;
        var act = btn.getAttribute('data-act');
        if (act === 'preview') {
            state.previewId = id;
            setEditorCode(v.code);
            renderHint('预览中：' + SOURCE_LABEL[v.source] + '（未应用，点「回滚」生效）');
            renderVersions();
        } else if (act === 'rollback') {
            applyVersion(id);
        } else if (act === 'del') {
            deleteVersion(id);
        }
    }

    function clearChat() {
        if (!state.chat.length) return;
        if (!confirm('清空对话记录？（版本不受影响）')) return;
        state.chat = [];
        if (state.taskId) {
            api(PREFIX + encodeURIComponent(state.taskId) + '/code-versions', {
                method: 'POST',
                body: JSON.stringify({ code: el.gcsCode.value || state.currentCode, source: 'manual', note: '', chat: [] })
            }).then(function (r) { return r.json(); }).then(function (d) {
                if (d && d.success && d.versions) state.versions = d.versions;
                renderVersions();
            });
        }
        renderChat();
    }

    function send() {
        if (state.sending) return;
        var text = (el.gcsChatText.value || '').trim();
        if (!text) { toast('先说点什么', 'warn'); return; }

        var docs = collectApiDocs();
        var prompt = buildPrompt({
            task: (typeof currentGovTask !== 'undefined' && currentGovTask) || { name: state.taskName },
            docs: docs,
            code: el.gcsCode.value || '',
            chat: state.chat,
            userText: text
        });

        state.chat = state.chat.concat([{ role: 'user', content: text, at: new Date().toISOString() }]);
        renderChat();
        el.gcsChatText.value = '';
        state.sending = true;
        el.gcsSendBtn.disabled = true;
        setStatus('AI 正在生成…（长脚本可能要 30~90 秒）', 'busy');

        var t0 = Date.now();
        api('/api/v1/agent/completion', { method: 'POST', body: JSON.stringify({ prompt: prompt }) })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var secs = ((Date.now() - t0) / 1000).toFixed(1);
                if (!d || !d.success) throw new Error((d && d.message) || 'AI 调用失败');
                var reply = d.content || '';
                var got = extractCodeFromReply(reply);
                var note = 'AI 改版（' + secs + 's）：' + text.slice(0, 40);
                var aiMsg = { role: 'assistant', content: got.fenced ? ('已生成新版本 ' + note + '\n\n' + reply.replace(/```[\s\S]*?```/g, '```(代码已应用到编辑器，见左侧版本列表)```')) : reply, at: new Date().toISOString() };
                state.chat = state.chat.concat([aiMsg]);

                if (!got.fenced || !got.code.trim()) {
                    renderChat();
                    setStatus('AI 回复里没找到代码块，已把原文放进对话', 'warn');
                    toast('没识别到代码块，可手动复制', 'warn');
                    return null;
                }
                setEditorCode(got.code);
                renderHint('AI 产出，已自动存为版本');
                return postVersion(got.code, 'ai', note, state.chat).then(function (r2) {
                    renderChat();
                    if (r2 && r2.success) {
                        setStatus('已生成新版本（' + secs + 's）', 'ok');
                        toast('AI 已生成新版本', 'success');
                    }
                });
            })
            .catch(function (e) {
                state.chat = state.chat.concat([{ role: 'assistant', content: '⚠️ ' + e.message, at: new Date().toISOString() }]);
                renderChat();
                setStatus(e.message, 'err');
                toast('AI 调用失败：' + e.message, 'error');
            })
            .then(function () {
                state.sending = false;
                el.gcsSendBtn.disabled = false;
            });
    }

    root.GovCodeStudio = {
        open: open,
        close: close,
        // 供测试
        _state: state,
        extractCodeFromReply: extractCodeFromReply,
        formatApiReference: formatApiReference,
        buildPrompt: buildPrompt
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.GovCodeStudio;
})(typeof window !== 'undefined' ? window : globalThis);

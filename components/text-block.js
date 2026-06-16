/* 文本块 — 原子组件 */
/* config: { content, text_align, font_size } */
function renderTextBlock(config, containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var content = config.content || '';
    var align = config.text_align || 'left';
    var fontSize = config.font_size || 14;

    // Simple markdown-like rendering
    var html = content
        .replace(/^### (.+)$/gm, '<h3 style="font-size:' + (fontSize * 1.1) + 'px;font-weight:600;margin:0 0 8px;color:var(--text);">$1</h3>')
        .replace(/^## (.+)$/gm, '<h2 style="font-size:' + (fontSize * 1.3) + 'px;font-weight:600;margin:0 0 10px;color:var(--text);">$1</h2>')
        .replace(/^# (.+)$/gm, '<h1 style="font-size:' + (fontSize * 1.6) + 'px;font-weight:700;margin:0 0 12px;color:var(--text);letter-spacing:-0.02em;">$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code style="background:var(--bg-hover);padding:1px 5px;border-radius:3px;font-size:' + (fontSize * 0.9) + 'px;">$1</code>')
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');

    container.innerHTML = '<div class="text-block" style="text-align:' + align + ';font-size:' + fontSize + 'px;line-height:1.6;color:var(--text-secondary);">' + html + '</div>';
}

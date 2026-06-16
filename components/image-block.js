/* 图片 — 原子组件 */
/* config: { src, alt, fit, radius } */
function renderImageBlock(config, containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var src = config.src || '';
    var alt = config.alt || '';
    var fit = config.fit || 'cover';
    var radius = config.radius || 0;

    if (!src) {
        container.innerHTML = '<div class="widget-empty">未配置图片地址</div>';
        return;
    }

    container.innerHTML = '<img src="' + src + '" alt="' + alt + '" ' +
        'style="width:100%;height:100%;object-fit:' + fit + ';border-radius:' + radius + 'px;display:block;" ' +
        'onerror="this.parentElement.innerHTML=\'<div class=widget-empty>图片加载失败</div>\'" />';
}

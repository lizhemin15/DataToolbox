/* 共享线性图标集 —— 纯 SVG，currentColor 上色，全站零 emoji。
 *
 * 用法：
 *   uiIcon('edit')                 → 默认尺寸（14px，class=ui-ico）
 *   uiIcon('edit', 'ui-ico-lg')    → 指定尺寸 class
 *   uiIcon('database')             → 未登记的名字会 console.warn 并返回空串（不静默糊过去）
 *
 * 载入顺序：必须在 index.html 中**最先**加载（script 带 defer 会保序），
 * 其它脚本只在函数体里引用，不在顶层引用，所以顺序只影响首次调用时机。
 */
(function (global) {
    'use strict';

    // 每个键只存 <svg> 的内部标记；外层的 viewBox / stroke 统一由 build() 拼。
    var SHAPES = {
        // 状态
        check: '<path d="M5 12.5l4.6 4.6L19 7.4"/>',
        close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
        alert: '<path d="M12 4.6l8.4 14.7H3.6z"/><path d="M12 10.1v4.3"/><path d="M12 17.2h.01"/>',
        info: '<circle cx="12" cy="12" r="8.2"/><path d="M12 11.1v5"/><path d="M12 8.1h.01"/>',
        question: '<circle cx="12" cy="12" r="8.2"/><path d="M9.7 9.6a2.4 2.4 0 1 1 3.2 2.3c-.6.2-.9.7-.9 1.3v.4"/><path d="M12 16.4h.01"/>',

        // 方向
        'chevron-right': '<path d="M9.5 6l6 6-6 6"/>',
        'chevron-left': '<path d="M14.5 6l-6 6 6 6"/>',
        'chevron-down': '<path d="M6 9.5l6 6 6-6"/>',
        'chevron-up': '<path d="M6 14.5l6-6 6 6"/>',
        'arrow-right': '<path d="M4.5 12h14"/><path d="M13 6.5l5.5 5.5-5.5 5.5"/>',

        // 动作
        edit: '<path d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 16.5v3z"/><path d="M14.6 6.6l2.9 2.9"/>',
        play: '<path d="M8 5.4l10.4 6.6L8 18.6z"/>',
        stop: '<rect x="7" y="7" width="10" height="10" rx="1.6"/>',
        refresh: '<path d="M20.2 12.6A8.3 8.3 0 1 1 18.6 7"/><path d="M18.7 3.9v3.7h-3.7"/>',
        trash: '<path d="M4.6 7.2h14.8"/><path d="M9.6 7.2V5.4a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1.2 1.2v1.8"/><path d="M6.7 7.2l.8 11.2A1.7 1.7 0 0 0 9.2 20h5.6a1.7 1.7 0 0 0 1.7-1.6l.8-11.2"/><path d="M10.6 11v5"/><path d="M13.4 11v5"/>',
        copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
        share: '<circle cx="17.5" cy="6" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/><path d="M8.7 10.8l6.6-3.6"/><path d="M8.7 13.2l6.6 3.6"/>',
        link: '<path d="M10.4 13.6a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1 1"/><path d="M13.6 10.4a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1-1"/>',
        download: '<path d="M12 4.5v11"/><path d="M8 11.5l4 4 4-4"/><path d="M4.6 15.2v3.1A1.7 1.7 0 0 0 6.3 20h11.4a1.7 1.7 0 0 0 1.7-1.7v-3.1"/>',
        upload: '<path d="M12 15.5v-11"/><path d="M8 8.5l4-4 4 4"/><path d="M4.6 15.2v3.1A1.7 1.7 0 0 0 6.3 20h11.4a1.7 1.7 0 0 0 1.7-1.7v-3.1"/>',
        search: '<circle cx="11" cy="11" r="6.2"/><path d="M15.6 15.6L20 20"/>',
        plus: '<path d="M12 5.8v12.4"/><path d="M5.8 12h12.4"/>',
        filter: '<path d="M4.5 6.5h15"/><path d="M7.5 12h9"/><path d="M10.5 17.5h3"/>',
        eye: '<path d="M2.6 12S6.2 6.4 12 6.4 21.4 12 21.4 12 17.8 17.6 12 17.6 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.6"/>',
        wand: '<path d="M5 19.2l9.3-9.3"/><path d="M14.6 5.6l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z"/><path d="M19.4 13.6l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z"/>',
        sparkle: '<path d="M11.4 4.6l1.7 4.5 4.5 1.7-4.5 1.7-1.7 4.5-1.7-4.5L5.2 10.8l4.5-1.7z"/><path d="M18.2 15.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/>',
        save: '<path d="M5 5.6A1.6 1.6 0 0 1 6.6 4h9.1L20 8.3v10.1A1.6 1.6 0 0 1 18.4 20H6.6A1.6 1.6 0 0 1 5 18.4z"/><path d="M8.4 4v5h6V4"/><path d="M8.4 20v-5.4h7.2V20"/>',

        // 对象
        database: '<ellipse cx="12" cy="6.6" rx="7.2" ry="2.8"/><path d="M4.8 6.6v10.8c0 1.5 3.2 2.8 7.2 2.8s7.2-1.3 7.2-2.8V6.6"/><path d="M4.8 12c0 1.5 3.2 2.8 7.2 2.8s7.2-1.3 7.2-2.8"/>',
        table: '<rect x="3.6" y="5" width="16.8" height="14" rx="2.2"/><path d="M3.6 10h16.8"/><path d="M9.4 10v9"/>',
        file: '<path d="M7 4h7l4.2 4.2V20H7z"/><path d="M13.7 4v4.4h4.4"/>',
        folder: '<path d="M4 7.6A1.6 1.6 0 0 1 5.6 6h3.2l1.7 2.1h8A1.6 1.6 0 0 1 20 9.7v7.7A1.6 1.6 0 0 1 18.4 19H5.6A1.6 1.6 0 0 1 4 17.4z"/>',
        box: '<path d="M12 3.9l8.1 4.4v7.4L12 20.1l-8.1-4.4V8.3z"/><path d="M3.9 8.3L12 12.7l8.1-4.4"/><path d="M12 12.7V20"/>',
        clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4v5l3.3 2"/>',
        calendar: '<rect x="4" y="5.6" width="16" height="14.4" rx="2"/><path d="M4 10.2h16"/><path d="M8.6 3.9v3.4"/><path d="M15.4 3.9v3.4"/>',
        layers: '<path d="M12 4.2l8 4.2-8 4.2-8-4.2z"/><path d="M5.2 12.4L12 16l6.8-3.6"/><path d="M5.2 16.4L12 20l6.8-3.6"/>',
        sliders: '<path d="M4 8.4h9.4"/><path d="M18.2 8.4H20"/><path d="M4 15.6h3.4"/><path d="M12.2 15.6H20"/><circle cx="15.8" cy="8.4" r="2.4"/><circle cx="9.8" cy="15.6" r="2.4"/>',
        shield: '<path d="M12 3.8l7 2.6v6c0 4-2.9 6.6-7 7.8-4.1-1.2-7-3.8-7-7.8v-6z"/><path d="M9.2 12l2.1 2.1 3.7-3.9"/>',
        code: '<path d="M9 8.4L5.4 12 9 15.6"/><path d="M15 8.4L18.6 12 15 15.6"/>',
        user: '<circle cx="12" cy="8.4" r="3.6"/><path d="M5.2 19.4a6.8 6.8 0 0 1 13.6 0"/>',
        key: '<circle cx="8.4" cy="12" r="3.6"/><path d="M12 12h7.6"/><path d="M17.4 12v3"/><path d="M14.6 12v2.2"/>',
        history: '<path d="M4.4 12a7.6 7.6 0 1 0 2.4-5.5"/><path d="M4.2 4.6v4h4"/><path d="M12 8.4V12l2.8 1.7"/>',
        git: '<circle cx="6.5" cy="6.6" r="2.4"/><circle cx="6.5" cy="17.4" r="2.4"/><circle cx="17.5" cy="12" r="2.4"/><path d="M6.5 9v6"/><path d="M8.9 6.6h4.2a2.4 2.4 0 0 1 2.4 2.4v.6"/><path d="M8.9 17.4h4.2a2.4 2.4 0 0 0 2.4-2.4V14"/>',
        // 系统与配置
        gear: '<circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H2.5a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V2.5a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z"/>',
        globe: '<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/><path d="M12 3.8a13 13 0 0 1 0 16.4 13 13 0 0 1 0-16.4z"/>',
        monitor: '<rect x="3.2" y="4.6" width="17.6" height="12.4" rx="1.8"/><path d="M8.6 20.4h6.8"/><path d="M12 17v3.4"/>',
        plug: '<path d="M9.2 3.6v5"/><path d="M14.8 3.6v5"/><path d="M6.6 8.6h10.8v2.6a5.4 5.4 0 0 1-10.8 0z"/><path d="M12 16.6v3.8"/>',
        inbox: '<path d="M4 12.8l2.4-7A1.7 1.7 0 0 1 8 4.6h8a1.7 1.7 0 0 1 1.6 1.2L20 12.8v5.1A1.7 1.7 0 0 1 18.3 19.6H5.7A1.7 1.7 0 0 1 4 17.9z"/><path d="M4 12.8h4l1.2 2.2h5.6L16 12.8h4"/>',
        // 折叠指示：默认画“向右”，展开态靠 CSS 旋转 90° 变“向下”
        'chevron-right': '<path d="M9.5 6l6 6-6 6"/>',
        'chevron-down': '<path d="M6 9.5l6 6 6-6"/>',
        'chevron-left': '<path d="M14.5 6l-6 6 6 6"/>',
        'chevron-up': '<path d="M6 14.5l6-6 6 6"/>'
    };

    var DEFAULT_CLASS = 'ui-ico';
    var cache = {};

    function build(cls, inner) {
        return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
            ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"' +
            ' aria-hidden="true" focusable="false">' + inner + '</svg>';
    }

    /**
     * 取图标 SVG。未登记的名字会出声（console.warn）并返回空串，
     * 不静默降级成一个看不见的空白图标。
     */
    function uiIcon(name, cls) {
        if (!Object.prototype.hasOwnProperty.call(SHAPES, name)) {
            if (global.console && typeof global.console.warn === 'function') {
                global.console.warn('[ui-icons] 未登记的图标名: ' + name);
            }
            return '';
        }
        var key = name + '|' + (cls || '');
        if (!cache[key]) {
            cache[key] = build(cls || DEFAULT_CLASS, SHAPES[name]);
        }
        return cache[key];
    }

    global.UI_ICONS = SHAPES;
    global.uiIcon = uiIcon;

    /* 静态标记里的图标占位符自动水合：<i class="ui-ico-slot" data-ui-ico="gear"></i>
     * 好处是 SVG 只在本文件里存一份，index.html 不抄路径、不会走形。
     * data-ui-ico-class 可覆盖默认尺寸类（如 ui-ico-lg）。 */
    function hydrate(root) {
        var doc = root || global.document;
        if (!doc || typeof doc.querySelectorAll !== 'function') return 0;
        var nodes = doc.querySelectorAll('[data-ui-ico]:not([data-ui-ico-done])');
        var filled = 0;
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            var name = el.getAttribute('data-ui-ico');
            var cls = el.getAttribute('data-ui-ico-class') || DEFAULT_CLASS;
            var markup = uiIcon(name, cls);
            el.setAttribute('data-ui-ico-done', '1');
            if (!markup) {
                // 名字没登记时 uiIcon 已经 warn；这里保留元素原有内容做兜底，
                // 不要塞一个空 svg 把兜底文案也吃掉。
                continue;
            }
            el.innerHTML = markup;
            filled++;
        }
        return filled;
    }

    global.uiIconsHydrate = hydrate;

    if (global.document) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', function () { hydrate(); });
        } else {
            hydrate();
        }
    }
})(typeof window !== 'undefined' ? window : this);

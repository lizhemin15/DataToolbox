/* ============================================================
   DataToolbox 大屏编辑器 — 交互逻辑
   PPT 风格：16:9 画布、8 控制点、框选、多选、Ctrl+D、对齐辅助线
   ============================================================ */

(function() {
  'use strict';

  // ======================== 状态 ========================
  var state = {
    screenId: null,
    name: '未命名大屏',
    slug: 'my-screen',
    theme: 'linear-dark',
    showMap: false,
    mapRegion: 'china',
    gridCols: 12,
    gridRows: 8,
    widgets: [],         // { id, compId, x, y, w, h, config }
    selectedIds: [],     // 多选
    widgetCounter: 0,
    dirty: false,
    // 拖拽状态
    dragging: null,      // { mode: 'move'|'resize'|'select', widgetIds, startX, startY, origX, origY, origW, origH, handle }
    // 框选
    selecting: null,     // { startX, startY }
    // 对齐辅助线
    guides: { h: [], v: [] },
    // 地图
    mapChart: null,
    mapLoaded: false,
    mapZoom: 1,
    mapCenter: [104.07, 35.66]  // 中国中心
  };

  // ======================== 组件注册表 ========================
  var COMPONENTS = [
    { id: 'kpi-card',    name: 'KPI 卡片',   icon: '📊', cat: 'atom', defW: 16, defH: 18, defConfig: { title: '指标', value: '0', unit: '', trend: 'flat' } },
    { id: 'bar-chart',   name: '柱状图',     icon: '📊', cat: 'atom', defW: 33, defH: 35, defConfig: { title: '柱状图', xAxis: ['A','B','C'], series: [{ name: '系列1', data: [30,50,20] }] } },
    { id: 'line-chart',  name: '折线图',     icon: '📈', cat: 'atom', defW: 33, defH: 35, defConfig: { title: '折线图', xAxis: ['Mon','Tue','Wed','Thu','Fri'], series: [{ name: '系列1', data: [10,25,15,30,20] }] } },
    { id: 'pie-chart',   name: '饼图',       icon: '🥧', cat: 'atom', defW: 25, defH: 35, defConfig: { title: '饼图', data: [{ name: 'A', value: 30 }, { name: 'B', value: 20 }, { name: 'C', value: 15 }], donut: true } },
    { id: 'data-table',  name: '数据表格',   icon: '📋', cat: 'atom', defW: 33, defH: 35, defConfig: { title: '数据表格', columns: ['列1','列2','列3'], rows: [['a','b','c'],['d','e','f']] } },
    { id: 'text-block',  name: '文本块',     icon: '📝', cat: 'atom', defW: 16, defH: 10, defConfig: { content: '文本内容', text_align: 'left', font_size: 14 } },
    { id: 'image-block', name: '图片',       icon: '🖼️', cat: 'atom', defW: 16, defH: 18, defConfig: { src: '', alt: '图片', fit: 'cover' } },
    { id: 'gauge',       name: '仪表盘',     icon: '⏱️', cat: 'atom', defW: 16, defH: 18, defConfig: { title: '仪表盘', value: 65, min: 0, max: 100 } }
  ];

  // ======================== DOM 引用 ========================
  var $ = function(id) { return document.getElementById(id); };
  var el = {
    screenName: $('screenName'),
    screenSlug: $('screenSlug'),
    showMap: $('showMap'),
    mapRegion: $('mapRegion'),
    themeSwitcher: $('themeSwitcher'),
    componentList: $('componentList'),
    canvasStage: $('canvasStage'),
    canvasGrid: $('canvasGrid'),
    canvasWidgets: $('canvasWidgets'),
    selectionRect: $('selectionRect'),
    alignGuides: $('alignGuides'),
    propsContent: $('propsContent'),
    btnSave: $('btnSave'),
    btnPreview: $('btnPreview'),
    btnClear: $('btnClear')
  };

  // ======================== 初始化 ========================
  function init() {
    renderComponentList();
    updateGrid();
    bindEvents();
    var urlParams = new URLSearchParams(window.location.search);
    var screenId = urlParams.get('id');
    if (screenId) loadScreen(screenId);
    var slug = urlParams.get('slug');
    if (slug) { state.slug = slug; el.screenSlug.value = slug; }
  }

  // ======================== 组件缩略图 ========================
  function getComponentPreview(comp) {
    var w = 120, h = 80;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" style="background:var(--bg);border-radius:4px;">';
    switch (comp.id) {
      case 'kpi-card':
        svg += '<text x="' + (w/2) + '" y="28" text-anchor="middle" font-size="10" fill="var(--text-secondary)">KPI</text>';
        svg += '<text x="' + (w/2) + '" y="52" text-anchor="middle" font-size="20" font-weight="bold" fill="var(--accent)">0</text>';
        svg += '<text x="' + (w/2) + '" y="68" text-anchor="middle" font-size="9" fill="var(--text-secondary)">指标</text>';
        break;
      case 'bar-chart':
        svg += '<text x="' + (w/2) + '" y="14" text-anchor="middle" font-size="9" fill="var(--text-secondary)">柱状图</text>';
        var bars = [25, 40, 20, 50, 30];
        for (var i = 0; i < bars.length; i++) {
          var bh = bars[i] * 0.8;
          svg += '<rect x="' + (15 + i*22) + '" y="' + (70 - bh) + '" width="16" height="' + bh + '" rx="2" fill="var(--accent)" opacity="' + (0.5 + i*0.1) + '"/>';
        }
        break;
      case 'line-chart':
        svg += '<text x="' + (w/2) + '" y="14" text-anchor="middle" font-size="9" fill="var(--text-secondary)">折线图</text>';
        var pts = [[15,55],[35,35],[55,50],[75,25],[105,40]];
        svg += '<polyline points="' + pts.map(function(p){return p[0]+','+p[1];}).join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="2"/>';
        pts.forEach(function(p){ svg += '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="2" fill="var(--accent)"/>'; });
        break;
      case 'pie-chart':
        svg += '<text x="' + (w/2) + '" y="14" text-anchor="middle" font-size="9" fill="var(--text-secondary)">饼图</text>';
        svg += '<circle cx="' + (w/2) + '" cy="50" r="22" fill="none" stroke="var(--accent)" stroke-width="12" stroke-dasharray="40 100" transform="rotate(-90 ' + (w/2) + ' 50)"/>';
        svg += '<circle cx="' + (w/2) + '" cy="50" r="22" fill="none" stroke="var(--border)" stroke-width="12" stroke-dasharray="30 100" transform="rotate(54 ' + (w/2) + ' 50)"/>';
        break;
      case 'data-table':
        svg += '<text x="' + (w/2) + '" y="14" text-anchor="middle" font-size="9" fill="var(--text-secondary)">表格</text>';
        for (var r = 0; r < 3; r++) {
          svg += '<rect x="15" y="' + (22 + r*18) + '" width="90" height="16" rx="2" fill="var(--bg-hover)" opacity="0.5"/>';
          svg += '<line x1="45" y1="' + (22 + r*18) + '" x2="45" y2="' + (38 + r*18) + '" stroke="var(--border)" stroke-width="0.5"/>';
          svg += '<line x1="75" y1="' + (22 + r*18) + '" x2="75" y2="' + (38 + r*18) + '" stroke="var(--border)" stroke-width="0.5"/>';
        }
        break;
      case 'text-block':
        svg += '<text x="' + (w/2) + '" y="28" text-anchor="middle" font-size="10" fill="var(--text-secondary)">Aa</text>';
        svg += '<line x1="25" y1="40" x2="95" y2="40" stroke="var(--border)" stroke-width="1"/>';
        svg += '<line x1="25" y1="48" x2="80" y2="48" stroke="var(--border)" stroke-width="1"/>';
        svg += '<line x1="25" y1="56" x2="90" y2="56" stroke="var(--border)" stroke-width="1"/>';
        break;
      case 'image-block':
        svg += '<rect x="30" y="18" width="60" height="48" rx="3" fill="var(--bg-hover)" stroke="var(--border)" stroke-width="1"/>';
        svg += '<text x="' + (w/2) + '" y="48" text-anchor="middle" font-size="14" fill="var(--text-secondary)">🖼</text>';
        break;
      case 'gauge':
        svg += '<text x="' + (w/2) + '" y="16" text-anchor="middle" font-size="9" fill="var(--text-secondary)">仪表盘</text>';
        svg += '<path d="M25,70 A35,35 0 0,1 95,70" fill="none" stroke="var(--border)" stroke-width="8" stroke-linecap="round"/>';
        svg += '<path d="M25,70 A35,35 0 0,1 60,35" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round"/>';
        svg += '<text x="' + (w/2) + '" y="62" text-anchor="middle" font-size="12" font-weight="bold" fill="var(--accent)">65</text>';
        break;
    }
    svg += '</svg>';
    return svg;
  }

  // ======================== 组件列表 ========================
  function renderComponentList() {
    var html = '';
    COMPONENTS.forEach(function(comp) {
      html += '<div class="comp-item" draggable="true" data-comp-id="' + comp.id + '" data-def-w="' + comp.defW + '" data-def-h="' + comp.defH + '" data-def-config="' + escapeHtml(JSON.stringify(comp.defConfig)) + '">';
      html += '<div class="comp-preview">' + getComponentPreview(comp) + '</div>';
      html += '<div class="comp-info"><span class="comp-icon">' + comp.icon + '</span><span class="comp-name">' + comp.name + '</span></div>';
      html += '</div>';
    });
    el.componentList.innerHTML = html;
  }

  // ======================== 更新网格 ========================
  function updateGrid() {
    el.canvasGrid.style.backgroundSize =
      (100 / state.gridCols) + '% ' + (100 / state.gridRows) + '%';
  }

  // ======================== 渲染画布 ========================
  function renderCanvas() {
    var html = '';
    state.widgets.forEach(function(w) {
      var comp = getComponent(w.compId);
      var name = comp ? comp.name : w.compId;
      var selected = (state.selectedIds.indexOf(w.id) !== -1);
      var cls = selected ? (state.selectedIds.length > 1 ? ' multi-selected' : ' selected') : '';

      html += '<div class="screen-widget' + cls + '" data-widget-id="' + w.id + '"';
      html += ' style="left:' + w.x + '%;top:' + w.y + '%;width:' + w.w + '%;height:' + w.h + '%">';
      html += '<div class="widget-header"><span>' + name + '</span>';
      html += '<button class="widget-delete" data-action="delete" data-widget-id="' + w.id + '">×</button></div>';
      html += '<div class="widget-body">' + renderWidgetContent(w.compId, w.config) + '</div>';
      // 控制点（仅单选时显示）
      if (selected && state.selectedIds.length === 1) {
        html += '<div class="widget-control-point nw" data-handle="nw"></div>';
        html += '<div class="widget-control-point n" data-handle="n"></div>';
        html += '<div class="widget-control-point ne" data-handle="ne"></div>';
        html += '<div class="widget-control-point w" data-handle="w"></div>';
        html += '<div class="widget-control-point e" data-handle="e"></div>';
        html += '<div class="widget-control-point sw" data-handle="sw"></div>';
        html += '<div class="widget-control-point s" data-handle="s"></div>';
        html += '<div class="widget-control-point se" data-handle="se"></div>';
      }
      html += '</div>';
    });
    el.canvasWidgets.innerHTML = html;
  }

  // ======================== 事件绑定 ========================
  function bindEvents() {
    // --- 拖拽添加组件 ---
    document.addEventListener('dragstart', function(e) {
      var compItem = e.target.closest('.comp-item');
      if (!compItem) return;
      if (state.dragging) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', JSON.stringify({
        compId: compItem.dataset.compId,
        defW: parseInt(compItem.dataset.defW),
        defH: parseInt(compItem.dataset.defH),
        defConfig: compItem.dataset.defConfig
      }));
      e.dataTransfer.effectAllowed = 'copy';
    });

    el.canvasWidgets.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    el.canvasWidgets.addEventListener('drop', function(e) {
      e.preventDefault();
      var data = JSON.parse(e.dataTransfer.getData('text/plain'));
      var rect = el.canvasWidgets.getBoundingClientRect();
      var relX = e.clientX - rect.left;
      var relY = e.clientY - rect.top;
      var x = (relX / rect.width * 100);
      var y = (relY / rect.height * 100);
      var w = data.defW;
      var h = data.defH;
      x = Math.max(0, Math.min(x, 100 - w));
      y = Math.max(0, Math.min(y, 100 - h));
      addWidget(data.compId, x, y, w, h, JSON.parse(data.defConfig));
    });

    // --- 画布 mousedown ---
    el.canvasWidgets.addEventListener('mousedown', function(e) {
      // 控制点拖拽
      var handle = e.target.closest('.widget-control-point');
      if (handle) {
        e.preventDefault();
        e.stopPropagation();
        var widgetEl = handle.closest('.screen-widget');
        var widgetId = widgetEl.dataset.widgetId;
        var w = getWidget(widgetId);
        if (!w) return;
        selectWidgets([widgetId]);
        state.dragging = {
          mode: 'resize',
          widgetIds: [widgetId],
          startX: e.clientX,
          startY: e.clientY,
          origX: w.x, origY: w.y, origW: w.w, origH: w.h,
          handle: handle.dataset.handle
        };
        return;
      }

      // 删除按钮
      if (e.target.closest('[data-action="delete"]')) return;

      // Widget header 拖拽移动
      var widgetEl = e.target.closest('.screen-widget');
      if (widgetEl && e.target.closest('.widget-header')) {
        e.preventDefault();
        var widgetId = widgetEl.dataset.widgetId;
        var w = getWidget(widgetId);
        if (!w) return;

        // 如果点击的 widget 不在选中列表里，改为单选
        if (state.selectedIds.indexOf(widgetId) === -1) {
          if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
            selectWidgets([widgetId]);
          } else {
            selectWidgets(state.selectedIds.concat([widgetId]));
          }
        }

        // 记录所有选中 widget 的原始位置
        var origs = {};
        state.selectedIds.forEach(function(id) {
          var ww = getWidget(id);
          if (ww) origs[id] = { x: ww.x, y: ww.y, w: ww.w, h: ww.h };
        });

        state.dragging = {
          mode: 'move',
          widgetIds: state.selectedIds.slice(),
          startX: e.clientX,
          startY: e.clientY,
          origs: origs
        };
        return;
      }

      // 点击 widget body（非 header）— 选中
      if (widgetEl) {
        var widgetId = widgetEl.dataset.widgetId;
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          var idx = state.selectedIds.indexOf(widgetId);
          if (idx === -1) {
            selectWidgets(state.selectedIds.concat([widgetId]));
          } else {
            var newIds = state.selectedIds.slice();
            newIds.splice(idx, 1);
            selectWidgets(newIds);
          }
        } else {
          if (state.selectedIds.indexOf(widgetId) === -1) {
            selectWidgets([widgetId]);
          }
        }
        return;
      }

      // 点击空白区域 — 框选
      if (!widgetEl && !e.target.closest('.widget-control-point')) {
        selectWidgets([]);
        state.selecting = {
          startX: e.clientX,
          startY: e.clientY
        };
      }
    });

    // --- 全局 mousemove ---
    document.addEventListener('mousemove', function(e) {
      // 框选
      if (state.selecting) {
        var rect = el.canvasWidgets.getBoundingClientRect();
        var sx = state.selecting.startX;
        var sy = state.selecting.startY;
        var ex = e.clientX;
        var ey = e.clientY;

        var left = Math.min(sx, ex);
        var top = Math.min(sy, ey);
        var width = Math.abs(ex - sx);
        var height = Math.abs(ey - sy);

        el.selectionRect.style.display = 'block';
        el.selectionRect.style.left = (left - rect.left) + 'px';
        el.selectionRect.style.top = (top - rect.top) + 'px';
        el.selectionRect.style.width = width + 'px';
        el.selectionRect.style.height = height + 'px';
        return;
      }

      if (!state.dragging) return;
      var d = state.dragging;
      var rect = el.canvasWidgets.getBoundingClientRect();
      var dxPct = (e.clientX - d.startX) / rect.width * 100;
      var dyPct = (e.clientY - d.startY) / rect.height * 100;

      if (d.mode === 'move') {
        // 多选移动
        d.widgetIds.forEach(function(id) {
          var w = getWidget(id);
          var orig = d.origs[id];
          if (!w || !orig) return;
          w.x = Math.max(0, Math.min(orig.x + dxPct, 100 - w.w));
          w.y = Math.max(0, Math.min(orig.y + dyPct, 100 - w.h));
        });
        // 对齐辅助线
        computeAlignGuides(d.widgetIds);
        renderCanvas();
        markDirty();
      } else if (d.mode === 'resize') {
        var w = getWidget(d.widgetIds[0]);
        if (!w) return;
        var handle = d.handle;
        var ox = d.origX, oy = d.origY, ow = d.origW, oh = d.origH;

        switch (handle) {
          case 'se': w.w = Math.max(4, ow + dxPct); w.h = Math.max(4, oh + dyPct); break;
          case 'sw': w.x = Math.min(ox + ow, ox + dxPct); w.w = Math.max(4, ow - dxPct); w.h = Math.max(4, oh + dyPct); break;
          case 'ne': w.y = Math.min(oy + oh, oy + dyPct); w.w = Math.max(4, ow + dxPct); w.h = Math.max(4, oh - dyPct); break;
          case 'nw': w.x = Math.min(ox + ow, ox + dxPct); w.y = Math.min(oy + oh, oy + dyPct); w.w = Math.max(4, ow - dxPct); w.h = Math.max(4, oh - dyPct); break;
          case 'n':  w.y = Math.min(oy + oh, oy + dyPct); w.h = Math.max(4, oh - dyPct); break;
          case 's':  w.h = Math.max(4, oh + dyPct); break;
          case 'w':  w.x = Math.min(ox + ow, ox + dxPct); w.w = Math.max(4, ow - dxPct); break;
          case 'e':  w.w = Math.max(4, ow + dxPct); break;
        }
        // 边界裁剪
        w.x = Math.max(0, w.x);
        w.y = Math.max(0, w.y);
        w.w = Math.min(w.w, 100 - w.x);
        w.h = Math.min(w.h, 100 - w.y);

        renderCanvas();
        renderProps();
        markDirty();
      }
    });

    // --- 全局 mouseup ---
    document.addEventListener('mouseup', function(e) {
      // 框选结束
      if (state.selecting) {
        var rect = el.canvasWidgets.getBoundingClientRect();
        var sx = state.selecting.startX;
        var sy = state.selecting.startY;
        var ex = e.clientX;
        var ey = e.clientY;

        var selLeft = Math.min(sx, ex) - rect.left;
        var selTop = Math.min(sy, ey) - rect.top;
        var selRight = Math.max(sx, ex) - rect.left;
        var selBottom = Math.max(sy, ey) - rect.top;

        var selectedIds = [];
        state.widgets.forEach(function(w) {
          var wLeft = w.x / 100 * rect.width;
          var wTop = w.y / 100 * rect.height;
          var wRight = (w.x + w.w) / 100 * rect.width;
          var wBottom = (w.y + w.h) / 100 * rect.height;
          if (wLeft < selRight && wRight > selLeft && wTop < selBottom && wBottom > selTop) {
            selectedIds.push(w.id);
          }
        });

        selectWidgets(selectedIds);
        el.selectionRect.style.display = 'none';
        state.selecting = null;
        return;
      }

      if (!state.dragging) return;
      state.dragging = null;
      clearGuides();
      renderCanvas();
      renderProps();
    });

    // --- 画布点击 ---
    el.canvasWidgets.addEventListener('click', function(e) {
      if (state.dragging) return;
      var delBtn = e.target.closest('[data-action="delete"]');
      if (delBtn) {
        var widgetId = delBtn.dataset.widgetId;
        removeWidget(widgetId);
        return;
      }
    });

    // --- 主题切换 ---
    el.themeSwitcher.addEventListener('click', function(e) {
      var btn = e.target.closest('.theme-btn');
      if (!btn) return;
      setTheme(btn.dataset.theme);
    });

    // --- 名称/slug ---
    el.screenName.addEventListener('input', function() { state.name = this.value; markDirty(); });
    el.screenSlug.addEventListener('input', function() { state.slug = this.value; markDirty(); });

    // --- 地图 ---
    el.showMap.addEventListener('change', function() {
      state.showMap = this.checked;
      if (state.showMap) {
        initMap();
      } else {
        destroyMap();
      }
      markDirty();
    });
    el.mapRegion.addEventListener('change', function() {
      state.mapRegion = this.value;
      if (state.showMap) {
        destroyMap();
        initMap();
      }
      markDirty();
    });

    // --- 保存/预览/清空 ---
    el.btnSave.addEventListener('click', saveScreen);
    el.btnPreview.addEventListener('click', previewScreen);
    el.btnClear.addEventListener('click', function() {
      if (state.widgets.length === 0) return;
      if (confirm('确定清空画布上的所有组件？')) {
        state.widgets = [];
        state.selectedIds = [];
        renderCanvas();
        renderProps();
        markDirty();
      }
    });

    // --- 键盘快捷键 ---
    document.addEventListener('keydown', function(e) {
      // 在输入框中不处理
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;

      // Delete / Backspace — 删除选中
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedIds.length > 0) {
          state.selectedIds.forEach(function(id) { removeWidgetSilent(id); });
          state.selectedIds = [];
          renderCanvas();
          renderProps();
          markDirty();
        }
      }

      // Ctrl+D — 复制选中
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        duplicateSelected();
      }

      // Ctrl+A — 全选
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        selectWidgets(state.widgets.map(function(w) { return w.id; }));
      }

      // Ctrl+S — 保存
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveScreen();
      }

      // 箭头键 — 微调位置
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.key) !== -1) {
        if (state.selectedIds.length === 0) return;
        e.preventDefault();
        var step = e.shiftKey ? 5 : 1;
        state.selectedIds.forEach(function(id) {
          var w = getWidget(id);
          if (!w) return;
          if (e.key === 'ArrowUp') w.y = Math.max(0, w.y - step);
          if (e.key === 'ArrowDown') w.y = Math.min(100 - w.h, w.y + step);
          if (e.key === 'ArrowLeft') w.x = Math.max(0, w.x - step);
          if (e.key === 'ArrowRight') w.x = Math.min(100 - w.w, w.x + step);
        });
        renderCanvas();
        renderProps();
        markDirty();
      }
    });

    // --- 窗口 resize（ECharts 地图自适应）---
    window.addEventListener('resize', function() {
      if (state.mapChart) {
        try { state.mapChart.resize(); } catch(e) {}
      }
    });
  }

  // ======================== Widget 操作 ========================
  function addWidget(compId, x, y, w, h, config) {
    state.widgetCounter++;
    var widget = {
      id: 'w-' + Date.now() + '-' + state.widgetCounter,
      compId: compId,
      x: x, y: y, w: w, h: h,
      config: config || {}
    };
    state.widgets.push(widget);
    selectWidgets([widget.id]);
    renderCanvas();
    renderProps();
    markDirty();
  }

  function removeWidget(widgetId) {
    state.widgets = state.widgets.filter(function(w) { return w.id !== widgetId; });
    state.selectedIds = state.selectedIds.filter(function(id) { return id !== widgetId; });
    renderCanvas();
    renderProps();
    markDirty();
  }

  function removeWidgetSilent(widgetId) {
    state.widgets = state.widgets.filter(function(w) { return w.id !== widgetId; });
  }

  function selectWidgets(ids) {
    state.selectedIds = ids;
    renderCanvas();
    renderProps();
  }

  function getWidget(widgetId) {
    return state.widgets.find(function(w) { return w.id === widgetId; });
  }

  function getComponent(compId) {
    return COMPONENTS.find(function(c) { return c.id === compId; });
  }

  // ======================== 复制选中 ========================
  function duplicateSelected() {
    if (state.selectedIds.length === 0) return;
    var newIds = [];
    state.selectedIds.forEach(function(id) {
      var w = getWidget(id);
      if (!w) return;
      state.widgetCounter++;
      var newId = 'w-' + Date.now() + '-' + state.widgetCounter;
      var newWidget = {
        id: newId,
        compId: w.compId,
        x: Math.min(w.x + 2, 100 - w.w),
        y: Math.min(w.y + 2, 100 - w.h),
        w: w.w, h: w.h,
        config: JSON.parse(JSON.stringify(w.config))
      };
      state.widgets.push(newWidget);
      newIds.push(newId);
    });
    selectWidgets(newIds);
    renderCanvas();
    renderProps();
    markDirty();
    showToast('已复制 ' + newIds.length + ' 个组件', 'success');
  }

  // ======================== 对齐辅助线 ========================
  function computeAlignGuides(movingIds) {
    clearGuides();
    var threshold = 2; // 百分比阈值
    var guidesH = [];
    var guidesV = [];

    // 收集所有非移动 widget 的边
    var others = state.widgets.filter(function(w) { return movingIds.indexOf(w.id) === -1; });
    var movers = movingIds.map(function(id) { return getWidget(id); }).filter(Boolean);

    movers.forEach(function(mw) {
      var edges = {
        left: mw.x, right: mw.x + mw.w,
        top: mw.y, bottom: mw.y + mw.h,
        midX: mw.x + mw.w / 2, midY: mw.y + mw.h / 2
      };

      others.forEach(function(ow) {
        var oEdges = {
          left: ow.x, right: ow.x + ow.w,
          top: ow.y, bottom: ow.y + ow.h,
          midX: ow.x + ow.w / 2, midY: ow.y + ow.h / 2
        };

        // 水平对齐
        ['top', 'bottom', 'midY'].forEach(function(key) {
          if (Math.abs(edges[key] - oEdges[key]) < threshold) {
            guidesH.push(oEdges[key]);
          }
        });

        // 垂直对齐
        ['left', 'right', 'midX'].forEach(function(key) {
          if (Math.abs(edges[key] - oEdges[key]) < threshold) {
            guidesV.push(oEdges[key]);
          }
        });
      });
    });

    // 去重
    guidesH = guidesH.filter(function(v, i, a) { return a.indexOf(v) === i; });
    guidesV = guidesV.filter(function(v, i, a) { return a.indexOf(v) === i; });

    // 渲染辅助线
    var html = '';
    guidesH.forEach(function(y) {
      html += '<div class="align-guide h" style="top:' + y + '%"></div>';
    });
    guidesV.forEach(function(x) {
      html += '<div class="align-guide v" style="left:' + x + '%"></div>';
    });
    el.alignGuides.innerHTML = html;
  }

  function clearGuides() {
    el.alignGuides.innerHTML = '';
  }

  // ======================== 一键排版 ========================
  function autoLayout(mode) {
    if (state.widgets.length === 0) return;

    switch (mode) {
      case 'tile':
        var cols = Math.ceil(Math.sqrt(state.widgets.length));
        var rows = Math.ceil(state.widgets.length / cols);
        var cellW = 100 / cols;
        var cellH = 100 / rows;
        state.widgets.forEach(function(w, i) {
          var col = i % cols;
          var row = Math.floor(i / cols);
          w.x = col * cellW + cellW * 0.05;
          w.y = row * cellH + cellH * 0.05;
          w.w = cellW * 0.9;
          w.h = cellH * 0.9;
        });
        break;

      case 'masonry':
        var nCols = Math.min(3, state.widgets.length);
        var colWidth = 100 / nCols;
        var colHeights = [];
        for (var i = 0; i < nCols; i++) colHeights.push(0);
        state.widgets.forEach(function(w) {
          var minCol = 0;
          for (var c = 1; c < nCols; c++) {
            if (colHeights[c] < colHeights[minCol]) minCol = c;
          }
          w.x = minCol * colWidth + colWidth * 0.05;
          w.y = colHeights[minCol];
          w.w = colWidth * 0.9;
          w.h = Math.max(10, w.w * 0.8);
          colHeights[minCol] += w.h + 2;
        });
        break;

      case 'snap':
        var cellW = 100 / state.gridCols;
        var cellH = 100 / state.gridRows;
        state.widgets.forEach(function(w) {
          w.x = Math.round(w.x / cellW) * cellW;
          w.y = Math.round(w.y / cellH) * cellH;
          w.w = Math.max(cellW, Math.round(w.w / cellW) * cellW);
          w.h = Math.max(cellH, Math.round(w.h / cellH) * cellH);
          w.x = Math.max(0, Math.min(w.x, 100 - cellW));
          w.y = Math.max(0, Math.min(w.y, 100 - cellH));
          w.w = Math.min(w.w, 100 - w.x);
          w.h = Math.min(w.h, 100 - w.y);
        });
        break;
    }

    renderCanvas();
    markDirty();
    showToast('已排版 ✓', 'success');
  }

  // ======================== 属性面板 ========================
  function renderProps() {
    if (state.selectedIds.length === 0) {
      el.propsContent.innerHTML = '<p class="panel-hint">选择画布上的组件来编辑属性</p>';
      return;
    }

    if (state.selectedIds.length > 1) {
      el.propsContent.innerHTML = '<p class="panel-hint">已选中 ' + state.selectedIds.length + ' 个组件<br><small>多选时请使用拖拽或键盘调整</small></p>';
      return;
    }

    var widget = getWidget(state.selectedIds[0]);
    if (!widget) {
      el.propsContent.innerHTML = '<p class="panel-hint">组件不存在</p>';
      return;
    }

    var comp = getComponent(widget.compId);
    var compName = comp ? comp.name : widget.compId;

    var html = '';
    html += '<div class="prop-group"><div class="prop-label">组件</div>';
    html += '<div style="font-size:12px;font-weight:500;">' + compName + '</div></div>';

    html += '<div class="prop-group"><div class="prop-label">位置 (%)</div>';
    html += '<div class="prop-row">';
    html += '<div class="prop-group"><div class="prop-label">X</div>';
    html += '<input class="prop-input" type="number" value="' + widget.x.toFixed(1) + '" data-prop="x" min="0" max="100" step="0.1">';
    html += '</div>';
    html += '<div class="prop-group"><div class="prop-label">Y</div>';
    html += '<input class="prop-input" type="number" value="' + widget.y.toFixed(1) + '" data-prop="y" min="0" max="100" step="0.1">';
    html += '</div></div>';

    html += '<div class="prop-group"><div class="prop-label">尺寸 (%)</div>';
    html += '<div class="prop-row">';
    html += '<div class="prop-group"><div class="prop-label">宽</div>';
    html += '<input class="prop-input" type="number" value="' + widget.w.toFixed(1) + '" data-prop="w" min="4" max="100" step="0.1">';
    html += '</div>';
    html += '<div class="prop-group"><div class="prop-label">高</div>';
    html += '<input class="prop-input" type="number" value="' + widget.h.toFixed(1) + '" data-prop="h" min="4" max="100" step="0.1">';
    html += '</div></div>';

    html += '<div class="prop-group"><div class="prop-label">配置</div>';
    html += '<textarea class="prop-textarea" data-prop="config">' + JSON.stringify(widget.config, null, 2) + '</textarea>';
    html += '</div>';

    el.propsContent.innerHTML = html;

    el.propsContent.querySelectorAll('[data-prop]').forEach(function(input) {
      input.addEventListener('input', function() {
        var prop = this.dataset.prop;
        if (prop === 'config') {
          try { widget.config = JSON.parse(this.value); } catch(e) {}
        } else {
          widget[prop] = parseFloat(this.value) || 0;
          if (prop === 'x') widget.x = Math.max(0, Math.min(widget.x, 100 - widget.w));
          if (prop === 'y') widget.y = Math.max(0, Math.min(widget.y, 100 - widget.h));
          if (prop === 'w') widget.w = Math.max(4, Math.min(widget.w, 100 - widget.x));
          if (prop === 'h') widget.h = Math.max(4, Math.min(widget.h, 100 - widget.y));
        }
        renderCanvas();
        markDirty();
      });
    });
  }

  // ======================== 主题 ========================
  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    el.themeSwitcher.querySelectorAll('.theme-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });
    markDirty();
  }

  // ======================== 保存 ========================
  function saveScreen() {
    state.name = el.screenName.value || '未命名大屏';
    state.slug = el.screenSlug.value || 'my-screen';

    var payload = {
      name: state.name,
      slug: state.slug,
      title: state.name,
      theme: state.theme,
      show_map: state.showMap,
      map_region: state.mapRegion,
      grid_cols: state.gridCols,
      grid_rows: state.gridRows,
      widgets: state.widgets.map(function(w) {
        return {
          id: w.id,
          comp_id: w.compId,
          x: w.x, y: w.y, w: w.w, h: w.h,
          config: w.config
        };
      })
    };

    var method = state.screenId ? 'PUT' : 'POST';
    var url = state.screenId
      ? '/api/v1/screens/' + state.screenId
      : '/api/v1/screens';

    fetchWithAuth(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.ok) {
        state.screenId = data.data.screen ? data.data.screen.id : state.screenId;
        state.dirty = false;
        showToast('已保存 ✓', 'success');
      } else {
        showToast('保存失败: ' + (data.error || '未知错误'), 'error');
      }
    })
    .catch(function(err) {
      showToast('保存失败: ' + err.message, 'error');
    });
  }

  // ======================== 加载 ========================
  function loadScreen(screenId) {
    fetchWithAuth('/api/v1/screens/' + screenId)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.ok && data.data && data.data.blueprint) {
        var bp = data.data.blueprint;
        state.screenId = screenId;
        state.name = bp.title || '未命名大屏';
        state.slug = bp.slug || 'my-screen';
        state.theme = bp.theme || 'linear-dark';
        state.showMap = bp.show_map || false;
        state.mapRegion = bp.map_region || 'china';
        state.gridCols = bp.grid_cols || 12;
        state.gridRows = bp.grid_rows || 8;
        state.widgets = (bp.widgets || []).map(function(w) {
          return {
            id: w.id,
            compId: w.comp_id,
            x: w.x, y: w.y, w: w.w, h: w.h,
            config: w.config || {}
          };
        });
        state.dirty = false;
        state.selectedIds = [];

        el.screenName.value = state.name;
        el.screenSlug.value = state.slug;
        el.showMap.checked = state.showMap;
        el.mapRegion.value = state.mapRegion;
        setTheme(state.theme);
        updateGrid();
        renderCanvas();
        renderProps();
        if (state.showMap) { initMap(); }
        showToast('已加载: ' + state.name, 'success');
      } else {
        showToast('加载失败', 'error');
      }
    })
    .catch(function(err) {
      showToast('加载失败: ' + err.message, 'error');
    });
  }

  // ======================== 预览 ========================
  function previewScreen() {
    if (!state.screenId || state.dirty) {
      saveScreen();
      return;
    }
    var previewUrl = '/screen/' + state.slug + '?token=' + encodeURIComponent(getToken());
    window.open(previewUrl, '_blank');
  }

  // ======================== 地图底图 ========================
  function initMap() {
    var mapEl = document.getElementById('canvasMap');
    if (!mapEl) return;
    if (state.mapChart) {
      try { state.mapChart.resize(); } catch(e) {}
      return;
    }

    // 确保 ECharts 已加载
    if (typeof echarts === 'undefined') {
      console.warn('ECharts 未加载，无法渲染地图');
      return;
    }

    mapEl.style.display = 'block';
    state.mapChart = echarts.init(mapEl);

    // 加载 GeoJSON
    var geoUrl = '/assets/china.json';
    if (state.mapRegion === 'world') {
      // 世界地图暂时也用 china，后续可扩展
      geoUrl = '/assets/china.json';
    }

    fetch(geoUrl)
      .then(function(res) { return res.json(); })
      .then(function(geoJson) {
        echarts.registerMap('map', geoJson);

        var option = {
          backgroundColor: 'transparent',
          geo: {
            map: 'map',
            roam: true,
            zoom: 1.2,
            center: [104.07, 35.66],
            label: { show: false },
            emphasis: {
              label: { show: true, fontSize: 10, color: '#fff' },
              itemStyle: { areaColor: 'rgba(74, 144, 217, 0.3)' }
            },
            itemStyle: {
              areaColor: 'rgba(40, 40, 50, 0.6)',
              borderColor: 'rgba(100, 100, 120, 0.5)',
              borderWidth: 1
            }
          },
          series: []
        };

        state.mapChart.setOption(option);

        // 点击省份事件
        state.mapChart.on('click', function(params) {
          if (params.componentType === 'geo') {
            var provinceName = params.name;
            showToast('选中: ' + provinceName, 'info');
            // 可扩展：根据选中省份更新组件数据
            state.selectedProvince = provinceName;
          }
        });

        state.mapLoaded = true;
      })
      .catch(function(err) {
        console.error('加载地图 GeoJSON 失败:', err);
        showToast('地图加载失败', 'error');
      });
  }

  function destroyMap() {
    var mapEl = document.getElementById('canvasMap');
    if (mapEl) mapEl.style.display = 'none';
    if (state.mapChart) {
      try { state.mapChart.dispose(); } catch(e) {}
      state.mapChart = null;
      state.mapLoaded = false;
    }
  }

  // ======================== 画布组件内容渲染 ========================
  function renderWidgetContent(compId, config) {
    config = config || {};
    var colors = ['var(--accent)', '#4ade80', '#f87171', '#fbbf24', '#60a5fa', '#c084fc', '#fb923c'];

    switch (compId) {
      case 'kpi-card': {
        var trendIcon = '';
        if (config.trend === 'up') trendIcon = '<span style="color:#4ade80">▲</span>';
        else if (config.trend === 'down') trendIcon = '<span style="color:#f87171">▼</span>';
        else trendIcon = '<span style="color:var(--text-secondary)">—</span>';
        return '<div class="kpi-preview">' +
          '<div class="kpi-title">' + escapeHtml(config.title || '指标') + '</div>' +
          '<div class="kpi-value">' + escapeHtml(String(config.value || '0')) + '<span class="kpi-unit">' + escapeHtml(config.unit || '') + '</span></div>' +
          '<div class="kpi-trend">' + trendIcon + '</div>' +
          '</div>';
      }

      case 'bar-chart': {
        var series = config.series || [{ name: '系列1', data: [30, 50, 20, 70, 40] }];
        var xAxis = config.xAxis || ['A', 'B', 'C', 'D', 'E'];
        var maxVal = 0;
        series.forEach(function(s) { s.data.forEach(function(v) { if (v > maxVal) maxVal = v; }); });
        maxVal = maxVal || 1;
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%">';
        var barW = 60 / xAxis.length;
        var gap = barW * 0.2;
        barW = barW - gap;
        series.forEach(function(s, si) {
          s.data.forEach(function(v, vi) {
            var bh = (v / maxVal) * 60;
            var bx = 20 + vi * (barW + gap) + si * (barW / series.length);
            var by = 85 - bh;
            svg += '<rect x="' + bx + '" y="' + by + '" width="' + (barW / series.length) + '" height="' + bh + '" rx="1" fill="' + (colors[si % colors.length]) + '" opacity="0.85"/>';
          });
        });
        svg += '<line x1="20" y1="85" x2="95" y2="85" stroke="var(--border)" stroke-width="0.5"/>';
        svg += '</svg>';
        return svg;
      }

      case 'line-chart': {
        var series = config.series || [{ name: '系列1', data: [10, 25, 15, 30, 20] }];
        var xAxis = config.xAxis || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        var maxVal = 0;
        series.forEach(function(s) { s.data.forEach(function(v) { if (v > maxVal) maxVal = v; }); });
        maxVal = maxVal || 1;
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%">';
        var stepX = 70 / (xAxis.length - 1);
        series.forEach(function(s, si) {
          var pts = s.data.map(function(v, vi) {
            return (15 + vi * stepX) + ',' + (85 - (v / maxVal) * 60);
          });
          svg += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + (colors[si % colors.length]) + '" stroke-width="1.5" opacity="0.85"/>';
          s.data.forEach(function(v, vi) {
            svg += '<circle cx="' + (15 + vi * stepX) + '" cy="' + (85 - (v / maxVal) * 60) + '" r="1.5" fill="' + (colors[si % colors.length]) + '"/>';
          });
        });
        svg += '<line x1="15" y1="85" x2="95" y2="85" stroke="var(--border)" stroke-width="0.5"/>';
        svg += '</svg>';
        return svg;
      }

      case 'pie-chart': {
        var data = config.data || [{ name: 'A', value: 30 }, { name: 'B', value: 20 }, { name: 'C', value: 15 }];
        var total = 0;
        data.forEach(function(d) { total += d.value; });
        total = total || 1;
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%">';
        var cx = 50, cy = 50, r = 28;
        if (config.donut) r = 22;
        var startAngle = -90;
        data.forEach(function(d, i) {
          var angle = (d.value / total) * 360;
          var endAngle = startAngle + angle;
          var x1 = cx + r * Math.cos(startAngle * Math.PI / 180);
          var y1 = cy + r * Math.sin(startAngle * Math.PI / 180);
          var x2 = cx + r * Math.cos(endAngle * Math.PI / 180);
          var y2 = cy + r * Math.sin(endAngle * Math.PI / 180);
          var largeArc = angle > 180 ? 1 : 0;
          svg += '<path d="M' + cx + ',' + cy + ' L' + x1 + ',' + y1 + ' A' + r + ',' + r + ' 0 ' + largeArc + ' 1 ' + x2 + ',' + y2 + ' Z" fill="' + (colors[i % colors.length]) + '" opacity="0.85"/>';
          startAngle = endAngle;
        });
        if (config.donut) {
          svg += '<circle cx="' + cx + '" cy="' + cy + '" r="12" fill="var(--bg-card)"/>';
        }
        svg += '</svg>';
        return svg;
      }

      case 'data-table': {
        var columns = config.columns || ['列1', '列2', '列3'];
        var rows = config.rows || [['a', 'b', 'c'], ['d', 'e', 'f']];
        var html = '<table class="widget-table"><thead><tr>';
        columns.forEach(function(col) { html += '<th>' + escapeHtml(col) + '</th>'; });
        html += '</tr></thead><tbody>';
        rows.forEach(function(row) {
          html += '<tr>';
          row.forEach(function(cell) { html += '<td>' + escapeHtml(String(cell)) + '</td>'; });
          html += '</tr>';
        });
        html += '</tbody></table>';
        return html;
      }

      case 'text-block': {
        var content = config.content || '文本内容';
        var align = config.text_align || 'left';
        var size = config.font_size || 14;
        return '<div style="text-align:' + align + ';font-size:' + size + 'px;padding:4px;white-space:pre-wrap;">' + escapeHtml(content) + '</div>';
      }

      case 'image-block': {
        if (config.src) {
          return '<img src="' + escapeHtml(config.src) + '" alt="' + escapeHtml(config.alt || '') + '" style="width:100%;height:100%;object-fit:' + (config.fit || 'cover') + ';">';
        }
        return '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);font-size:24px;">🖼</div>';
      }

      case 'gauge': {
        var value = config.value || 65;
        var min = config.min || 0;
        var max = config.max || 100;
        var pct = (value - min) / (max - min);
        var angle = -180 + pct * 180;
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%">';
        svg += '<path d="M15,80 A35,35 0 0,1 85,80" fill="none" stroke="var(--border)" stroke-width="8" stroke-linecap="round"/>';
        var endX = 50 + 35 * Math.cos(angle * Math.PI / 180);
        var endY = 80 + 35 * Math.sin(angle * Math.PI / 180);
        svg += '<path d="M15,80 A35,35 0 0,1 ' + endX + ',' + endY + '" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round"/>';
        svg += '<text x="50" y="72" text-anchor="middle" font-size="14" font-weight="bold" fill="var(--text)">' + value + '</text>';
        svg += '<text x="50" y="85" text-anchor="middle" font-size="7" fill="var(--text-secondary)">' + escapeHtml(config.title || '') + '</text>';
        svg += '</svg>';
        return svg;
      }

      default:
        return '<div style="padding:8px;font-size:11px;color:var(--text-secondary);">' + escapeHtml(compId) + '</div>';
    }
  }

  // ======================== 工具函数 ========================
  function markDirty() { state.dirty = true; }

  function getToken() {
    if (window._appToken) return window._appToken;
    var params = new URLSearchParams(window.location.search);
    var urlToken = params.get('token');
    if (urlToken) return urlToken;
    // 尝试从 session_token cookie 读取（登录后自动设置）
    var match = document.cookie.match(/(?:^|;\s*)session_token=([^;]*)/);
    return match ? match[1] : '';
  }

  function showToast(msg, type) {
    var existing = document.querySelector('.toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'toast ' + (type || '');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function() {
      if (toast.parentNode) toast.remove();
    }, 2000);
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 注入 fetchWithAuth
  if (!window.fetchWithAuth) {
    window.fetchWithAuth = function(url, options) {
      options = options || {};
      options.headers = options.headers || {};
      var token = getToken();
      if (token) {
        options.headers['Authorization'] = 'Bearer ' + token;
      }
      return fetch(url, options);
    };
  }

  // 暴露到全局
  window.autoLayout = autoLayout;

  // ======================== 启动 ========================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

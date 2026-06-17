/* ============================================================
   DataToolbox 大屏编辑器 — 交互逻辑
   纯 JS，无框架依赖
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
    selectedId: null,
    widgetCounter: 0,
    dirty: false,
    // 拖拽移动状态
    dragging: null       // { widgetId, startX, startY, origX, origY, origW, origH, mode: 'move'|'resize' }
  };

  // ======================== 组件注册表 ========================
  var COMPONENTS = [
    { id: 'kpi-card',    name: 'KPI 卡片',   icon: '📊', cat: 'atom', defW: 2, defH: 2, defConfig: { title: '指标', value: '0', unit: '', trend: 'flat' } },
    { id: 'bar-chart',   name: '柱状图',     icon: '📊', cat: 'atom', defW: 4, defH: 3, defConfig: { title: '柱状图', xAxis: ['A','B','C'], series: [{ name: '系列1', data: [30,50,20] }] } },
    { id: 'line-chart',  name: '折线图',     icon: '📈', cat: 'atom', defW: 4, defH: 3, defConfig: { title: '折线图', xAxis: ['Mon','Tue','Wed','Thu','Fri'], series: [{ name: '系列1', data: [10,25,15,30,20] }] } },
    { id: 'pie-chart',   name: '饼图',       icon: '🥧', cat: 'atom', defW: 3, defH: 3, defConfig: { title: '饼图', data: [{ name: 'A', value: 30 }, { name: 'B', value: 20 }, { name: 'C', value: 15 }], donut: true } },
    { id: 'data-table',  name: '数据表格',   icon: '📋', cat: 'atom', defW: 4, defH: 3, defConfig: { title: '数据表格', columns: ['列1','列2','列3'], rows: [['a','b','c'],['d','e','f']] } },
    { id: 'text-block',  name: '文本块',     icon: '📝', cat: 'atom', defW: 2, defH: 1, defConfig: { content: '文本内容', text_align: 'left', font_size: 14 } },
    { id: 'image-block', name: '图片',       icon: '🖼️', cat: 'atom', defW: 2, defH: 2, defConfig: { src: '', alt: '图片', fit: 'cover' } },
    { id: 'gauge',       name: '仪表盘',     icon: '⏱️', cat: 'atom', defW: 2, defH: 2, defConfig: { title: '仪表盘', value: 65, min: 0, max: 100 } }
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
    canvasGrid: $('canvasGrid'),
    canvasWidgets: $('canvasWidgets'),
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
    if (screenId) {
      loadScreen(screenId);
    }
    var slug = urlParams.get('slug');
    if (slug) {
      state.slug = slug;
      el.screenSlug.value = slug;
    }
  }

  // ======================== 组件缩略图预览 ========================
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
      html += '<div class="comp-info">';
      html += '<span class="comp-icon">' + comp.icon + '</span>';
      html += '<span class="comp-name">' + comp.name + '</span>';
      html += '</div>';
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
      var left = (w.x / state.gridCols * 100).toFixed(2);
      var top = (w.y / state.gridRows * 100).toFixed(2);
      var width = (w.w / state.gridCols * 100).toFixed(2);
      var height = (w.h / state.gridRows * 100).toFixed(2);
      var selected = (w.id === state.selectedId) ? ' selected' : '';

      html += '<div class="screen-widget' + selected + '" data-widget-id="' + w.id + '"';
      html += ' style="left:' + left + '%;top:' + top + '%;width:' + width + '%;height:' + height + '%">';
      html += '<div class="widget-header"><span>' + name + '</span>';
      html += '<button class="widget-delete" data-action="delete" data-widget-id="' + w.id + '">×</button></div>';
      html += '<div class="widget-body">' + renderWidgetContent(w.compId, w.config) + '</div>';
      // 调整大小手柄
      html += '<div class="widget-resize-handle" data-resize="se"></div>';
      html += '</div>';
    });
    el.canvasWidgets.innerHTML = html;
  }

  // ======================== 事件绑定 ========================
  function bindEvents() {
    // --- 拖拽添加组件（从左侧面板到画布）---
    document.addEventListener('dragstart', function(e) {
      var compItem = e.target.closest('.comp-item');
      if (!compItem) return;
      // 如果正在拖拽移动 widget，阻止左侧拖拽
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
      var x = Math.floor(relX / rect.width * state.gridCols);
      var y = Math.floor(relY / rect.height * state.gridRows);
      var w = Math.min(data.defW, state.gridCols - x);
      var h = Math.min(data.defH, state.gridRows - y);

      x = Math.max(0, Math.min(x, state.gridCols - 1));
      y = Math.max(0, Math.min(y, state.gridRows - 1));

      addWidget(data.compId, x, y, w, h, JSON.parse(data.defConfig));
    });

    // --- 画布内 Widget 拖拽移动 ---
    el.canvasWidgets.addEventListener('mousedown', function(e) {
      // 删除按钮不触发拖拽
      if (e.target.closest('[data-action="delete"]')) return;
      // 调整大小手柄
      if (e.target.closest('.widget-resize-handle')) {
        var handle = e.target.closest('.widget-resize-handle');
        var widgetEl = handle.closest('.screen-widget');
        if (!widgetEl) return;
        e.preventDefault();
        e.stopPropagation();
        var widgetId = widgetEl.dataset.widgetId;
        var w = getWidget(widgetId);
        if (!w) return;
        selectWidget(widgetId);
        state.dragging = {
          widgetId: widgetId,
          startX: e.clientX,
          startY: e.clientY,
          origX: w.x,
          origY: w.y,
          origW: w.w,
          origH: w.h,
          mode: 'resize'
        };
        return;
      }

      var widgetEl = e.target.closest('.screen-widget');
      if (!widgetEl) return;
      // 只在 header 上才能拖拽移动
      if (!e.target.closest('.widget-header')) return;

      e.preventDefault();
      var widgetId = widgetEl.dataset.widgetId;
      var w = getWidget(widgetId);
      if (!w) return;

      selectWidget(widgetId);
      state.dragging = {
        widgetId: widgetId,
        startX: e.clientX,
        startY: e.clientY,
        origX: w.x,
        origY: w.y,
        origW: w.w,
        origH: w.h,
        mode: 'move'
      };
    });

    // 全局 mousemove
    document.addEventListener('mousemove', function(e) {
      if (!state.dragging) return;
      var d = state.dragging;
      var rect = el.canvasWidgets.getBoundingClientRect();
      var cellW = rect.width / state.gridCols;
      var cellH = rect.height / state.gridRows;
      var dx = Math.round((e.clientX - d.startX) / cellW);
      var dy = Math.round((e.clientY - d.startY) / cellH);

      var w = getWidget(d.widgetId);
      if (!w) return;

      if (d.mode === 'move') {
        w.x = Math.max(0, Math.min(d.origX + dx, state.gridCols - w.w));
        w.y = Math.max(0, Math.min(d.origY + dy, state.gridRows - w.h));
      } else if (d.mode === 'resize') {
        w.w = Math.max(1, Math.min(d.origW + dx, state.gridCols - w.x));
        w.h = Math.max(1, Math.min(d.origH + dy, state.gridRows - w.y));
      }
      renderCanvas();
      markDirty();
    });

    // 全局 mouseup
    document.addEventListener('mouseup', function(e) {
      if (!state.dragging) return;
      var w = getWidget(state.dragging.widgetId);
      state.dragging = null;
      if (w) {
        renderCanvas();
        renderProps();
      }
    });

    // --- 画布点击：选中/取消选中 ---
    el.canvasWidgets.addEventListener('click', function(e) {
      // 如果刚完成拖拽，不触发 click
      if (state.dragging) return;

      var delBtn = e.target.closest('[data-action="delete"]');
      if (delBtn) {
        var widgetId = delBtn.dataset.widgetId;
        removeWidget(widgetId);
        return;
      }

      var widgetEl = e.target.closest('.screen-widget');
      if (widgetEl) {
        selectWidget(widgetEl.dataset.widgetId);
      } else {
        selectWidget(null);
      }
    });

    // --- 主题切换 ---
    el.themeSwitcher.addEventListener('click', function(e) {
      var btn = e.target.closest('.theme-btn');
      if (!btn) return;
      setTheme(btn.dataset.theme);
    });

    // --- 名称/slug 变更 ---
    el.screenName.addEventListener('input', function() {
      state.name = this.value;
      markDirty();
    });
    el.screenSlug.addEventListener('input', function() {
      state.slug = this.value;
      markDirty();
    });

    // --- 地图选项 ---
    el.showMap.addEventListener('change', function() {
      state.showMap = this.checked;
      markDirty();
    });
    el.mapRegion.addEventListener('change', function() {
      state.mapRegion = this.value;
      markDirty();
    });

    // --- 保存/预览/清空 ---
    el.btnSave.addEventListener('click', saveScreen);
    el.btnPreview.addEventListener('click', previewScreen);
    el.btnClear.addEventListener('click', function() {
      if (state.widgets.length === 0) return;
      if (confirm('确定清空画布上的所有组件？')) {
        state.widgets = [];
        state.selectedId = null;
        renderCanvas();
        renderProps();
        markDirty();
      }
    });

    // --- 键盘快捷键 ---
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
        if (state.selectedId) {
          removeWidget(state.selectedId);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveScreen();
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
    state.selectedId = widget.id;
    renderCanvas();
    renderProps();
    markDirty();
  }

  function removeWidget(widgetId) {
    state.widgets = state.widgets.filter(function(w) { return w.id !== widgetId; });
    if (state.selectedId === widgetId) {
      state.selectedId = null;
      renderProps();
    }
    renderCanvas();
    markDirty();
  }

  function selectWidget(widgetId) {
    state.selectedId = widgetId;
    renderCanvas();
    renderProps();
  }

  function getWidget(widgetId) {
    return state.widgets.find(function(w) { return w.id === widgetId; });
  }

  function getComponent(compId) {
    return COMPONENTS.find(function(c) { return c.id === compId; });
  }

  // ======================== 画布组件内容渲染 ========================
  function renderWidgetContent(compId, config) {
    config = config || {};
    var colors = ['var(--accent)', '#4ade80', '#f87171', '#fbbf24', '#60a5fa', '#c084fc', '#fb923c'];
    var i, j;

    switch (compId) {
      // --- KPI 卡片 ---
      case 'kpi-card': {
        var trendIcon = '';
        if (config.trend === 'up') trendIcon = '<span style=\"color:#4ade80\">▲</span>';
        else if (config.trend === 'down') trendIcon = '<span style=\"color:#f87171\">▼</span>';
        else trendIcon = '<span style=\"color:var(--text-secondary)\">—</span>';
        return '<div class=\"kpi-preview\">' +
          '<div class=\"kpi-title\">' + escapeHtml(config.title || '指标') + '</div>' +
          '<div class=\"kpi-value\">' + escapeHtml(String(config.value || '0')) + '<span class=\"kpi-unit\">' + escapeHtml(config.unit || '') + '</span></div>' +
          '<div class=\"kpi-trend\">' + trendIcon + '</div>' +
          '</div>';
      }

      // --- 柱状图 ---
      case 'bar-chart': {
        var series = config.series || [{ name: '系列1', data: [30, 50, 20, 70, 40] }];
        var xAxis = config.xAxis || ['A', 'B', 'C', 'D', 'E'];
        var maxVal = 0;
        series.forEach(function(s) { s.data.forEach(function(v) { if (v > maxVal) maxVal = v; }); });
        maxVal = maxVal || 1;
        var svg = '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\" preserveAspectRatio=\"none\" style=\"width:100%;height:100%\">';
        var barW = 60 / xAxis.length;
        var gap = barW * 0.2;
        barW = barW - gap;
        series.forEach(function(s, si) {
          s.data.forEach(function(v, vi) {
            var bh = (v / maxVal) * 60;
            var bx = 20 + vi * (barW + gap) + si * (barW / series.length);
            var by = 85 - bh;
            svg += '<rect x=\"' + bx + '\" y=\"' + by + '\" width=\"' + (barW / series.length) + '\" height=\"' + bh + '\" rx=\"1\" fill=\"' + (colors[si % colors.length]) + '\" opacity=\"0.85\"/>';
          });
        });
        svg += '<line x1=\"20\" y1=\"85\" x2=\"95\" y2=\"85\" stroke=\"var(--border)\" stroke-width=\"0.5\"/>';
        svg += '</svg>';
        return svg;
      }

      // --- 折线图 ---
      case 'line-chart': {
        var series = config.series || [{ name: '系列1', data: [10, 25, 15, 30, 20] }];
        var xAxis = config.xAxis || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        var maxVal = 0;
        series.forEach(function(s) { s.data.forEach(function(v) { if (v > maxVal) maxVal = v; }); });
        maxVal = maxVal || 1;
        var svg = '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\" preserveAspectRatio=\"none\" style=\"width:100%;height:100%\">';
        var stepX = 70 / (xAxis.length - 1);
        series.forEach(function(s, si) {
          var pts = s.data.map(function(v, vi) {
            return (15 + vi * stepX) + ',' + (85 - (v / maxVal) * 60);
          });
          svg += '<polyline points=\"' + pts.join(' ') + '\" fill=\"none\" stroke=\"' + (colors[si % colors.length]) + '\" stroke-width=\"1.5\" opacity=\"0.85\"/>';
          s.data.forEach(function(v, vi) {
            svg += '<circle cx=\"' + (15 + vi * stepX) + '\" cy=\"' + (85 - (v / maxVal) * 60) + '\" r=\"1.5\" fill=\"' + (colors[si % colors.length]) + '\"/>';
          });
        });
        svg += '<line x1=\"15\" y1=\"85\" x2=\"95\" y2=\"85\" stroke=\"var(--border)\" stroke-width=\"0.5\"/>';
        svg += '</svg>';
        return svg;
      }

      // --- 饼图 ---
      case 'pie-chart': {
        var data = config.data || [{ name: 'A', value: 30 }, { name: 'B', value: 20 }, { name: 'C', value: 15 }];
        var total = 0;
        data.forEach(function(d) { total += d.value; });
        total = total || 1;
        var svg = '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\" preserveAspectRatio=\"none\" style=\"width:100%;height:100%\">';
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
          svg += '<path d=\"M' + cx + ',' + cy + ' L' + x1 + ',' + y1 + ' A' + r + ',' + r + ' 0 ' + largeArc + ' 1 ' + x2 + ',' + y2 + ' Z\" fill=\"' + (colors[i % colors.length]) + '\" opacity=\"0.85\"/>';
          startAngle = endAngle;
        });
        if (config.donut) {
          svg += '<circle cx=\"' + cx + '\" cy=\"' + cy + '\" r=\"12\" fill=\"var(--bg-card)\"/>';
        }
        svg += '</svg>';
        return svg;
      }

      // --- 数据表格 ---
      case 'data-table': {
        var columns = config.columns || ['列1', '列2', '列3'];
        var rows = config.rows || [['a', 'b', 'c'], ['d', 'e', 'f']];
        var html = '<table class=\"widget-table\"><thead><tr>';
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

      // --- 文本块 ---
      case 'text-block': {
        var content = config.content || '文本内容';
        var align = config.text_align || 'left';
        var size = config.font_size || 14;
        return '<div style=\"text-align:' + align + ';font-size:' + size + 'px;padding:4px;white-space:pre-wrap;\">' + escapeHtml(content) + '</div>';
      }

      // --- 图片 ---
      case 'image-block': {
        if (config.src) {
          return '<img src=\"' + escapeHtml(config.src) + '\" alt=\"' + escapeHtml(config.alt || '') + '\" style=\"width:100%;height:100%;object-fit:' + (config.fit || 'cover') + ';\">';
        }
        return '<div style=\"display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);font-size:24px;\">🖼</div>';
      }

      // --- 仪表盘 ---
      case 'gauge': {
        var value = config.value || 65;
        var min = config.min || 0;
        var max = config.max || 100;
        var pct = (value - min) / (max - min);
        var angle = -180 + pct * 180;
        var svg = '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\" preserveAspectRatio=\"none\" style=\"width:100%;height:100%\">';
        svg += '<path d=\"M15,80 A35,35 0 0,1 85,80\" fill=\"none\" stroke=\"var(--border)\" stroke-width=\"8\" stroke-linecap=\"round\"/>';
        var endX = 50 + 35 * Math.cos(angle * Math.PI / 180);
        var endY = 80 + 35 * Math.sin(angle * Math.PI / 180);
        svg += '<path d=\"M15,80 A35,35 0 0,1 ' + endX + ',' + endY + '\" fill=\"none\" stroke=\"var(--accent)\" stroke-width=\"8\" stroke-linecap=\"round\"/>';
        svg += '<text x=\"50\" y=\"72\" text-anchor=\"middle\" font-size=\"14\" font-weight=\"bold\" fill=\"var(--text)\">' + value + '</text>';
        svg += '<text x=\"50\" y=\"85\" text-anchor=\"middle\" font-size=\"7\" fill=\"var(--text-secondary)\">' + escapeHtml(config.title || '') + '</text>';
        svg += '</svg>';
        return svg;
      }

      default:
        return '<div style=\"padding:8px;font-size:11px;color:var(--text-secondary);\">' + escapeHtml(compId) + '</div>';
    }
  }

  // ======================== 属性面板 ========================
  function renderProps() {
    if (!state.selectedId) {
      el.propsContent.innerHTML = '<p class="panel-hint">选择画布上的组件来编辑属性</p>';
      return;
    }

    var widget = getWidget(state.selectedId);
    if (!widget) {
      el.propsContent.innerHTML = '<p class="panel-hint">组件不存在</p>';
      return;
    }

    var comp = getComponent(widget.compId);
    var compName = comp ? comp.name : widget.compId;

    var html = '';
    html += '<div class="prop-group"><div class="prop-label">组件</div>';
    html += '<div style="font-size:13px;font-weight:500;">' + compName + '</div></div>';

    html += '<div class="prop-group"><div class="prop-label">位置</div>';
    html += '<div class="prop-row">';
    html += '<div class="prop-group"><div class="prop-label">X (列)</div>';
    html += '<input class="prop-input" type="number" value="' + widget.x + '" data-prop="x" min="0" max="' + (state.gridCols - 1) + '">';
    html += '</div>';
    html += '<div class="prop-group"><div class="prop-label">Y (行)</div>';
    html += '<input class="prop-input" type="number" value="' + widget.y + '" data-prop="y" min="0" max="' + (state.gridRows - 1) + '">';
    html += '</div></div>';

    html += '<div class="prop-group"><div class="prop-label">尺寸</div>';
    html += '<div class="prop-row">';
    html += '<div class="prop-group"><div class="prop-label">宽 (列)</div>';
    html += '<input class="prop-input" type="number" value="' + widget.w + '" data-prop="w" min="1" max="' + state.gridCols + '">';
    html += '</div>';
    html += '<div class="prop-group"><div class="prop-label">高 (行)</div>';
    html += '<input class="prop-input" type="number" value="' + widget.h + '" data-prop="h" min="1" max="' + state.gridRows + '">';
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
          widget[prop] = parseInt(this.value) || 0;
          if (prop === 'x') widget.x = Math.max(0, Math.min(widget.x, state.gridCols - 1));
          if (prop === 'y') widget.y = Math.max(0, Math.min(widget.y, state.gridRows - 1));
          if (prop === 'w') widget.w = Math.max(1, Math.min(widget.w, state.gridCols));
          if (prop === 'h') widget.h = Math.max(1, Math.min(widget.h, state.gridRows));
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

        el.screenName.value = state.name;
        el.screenSlug.value = state.slug;
        el.showMap.checked = state.showMap;
        el.mapRegion.value = state.mapRegion;
        setTheme(state.theme);
        updateGrid();
        renderCanvas();
        renderProps();
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

  // ======================== 工具函数 ========================
  function markDirty() { state.dirty = true; }

  function getToken() {
    if (window._appToken) return window._appToken;
    var params = new URLSearchParams(window.location.search);
    return params.get('token') || '';
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

  // ======================== 启动 ========================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

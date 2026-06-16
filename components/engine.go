package components

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ComponentDef 预制组件定义（从 JSON 文件加载）
type ComponentDef struct {
	ID           string                 `json:"id"`
	Name         string                 `json:"name"`
	Category     string                 `json:"category"`
	Icon         string                 `json:"icon"`
	Description  string                 `json:"description"`
	Version      string                 `json:"version"`
	Dependencies []string               `json:"dependencies"`
	ConfigSchema map[string]ConfigField `json:"config_schema"`
}

// ConfigField 配置字段定义
type ConfigField struct {
	Type         string       `json:"type"`
	Label        string       `json:"label"`
	Default      interface{}  `json:"default"`
	Required     bool         `json:"required"`
	Hint         string       `json:"hint"`
	Options      []string     `json:"options"`
	Min          *float64     `json:"min"`
	Max          *float64     `json:"max"`
	ItemSchema   map[string]ConfigField `json:"item_schema"`
}

// ComponentInstance 页面上的组件实例（组件+配置）
type ComponentInstance struct {
	ComponentID string                 `json:"component_id"` // 规范字段
	Type        string                 `json:"type,omitempty" jsonschema:"组件ID（同 component_id，二选一即可）"` // 兼容简写（优先使用 component_id）
	Config      map[string]interface{} `json:"config"`
}

// GetID 返回组件 ID（优先 component_id，回退 type）
func (c ComponentInstance) GetID() string {
	if c.ComponentID != "" {
		return c.ComponentID
	}
	return c.Type
}

// AppBlueprint 应用蓝图（组件布局 + 配置）
type AppBlueprint struct {
	Title           string               `json:"title"`
	Slug            string               `json:"slug"`
	Description     string               `json:"description"`
	Icon            string               `json:"icon"`
	DesignDirection string               `json:"design_direction"`
	PrimaryColor    string               `json:"primary_color"`
	Components      []ComponentInstance  `json:"components"`
}

// ScreenWidget 大屏上的一个 widget 实例
type ScreenWidget struct {
	ID       string                 `json:"id"`       // widget 唯一 ID，如 "w-001"
	CompID   string                 `json:"comp_id"`  // 组件 ID，如 "kpi-card"
	X        int                    `json:"x"`        // 网格列位置
	Y        int                    `json:"y"`        // 网格行位置
	W        int                    `json:"w"`        // 网格列宽
	H        int                    `json:"h"`        // 网格行高
	Config   map[string]interface{} `json:"config"`   // 组件配置
}

// ScreenBlueprint 大屏蓝图
type ScreenBlueprint struct {
	Title       string         `json:"title"`
	Slug        string         `json:"slug"`
	Description string         `json:"description"`
	Theme       string         `json:"theme"`        // linear-dark | vercel-light | mission-control | stripe-dark
	ShowMap     bool           `json:"show_map"`      // 是否显示地图底图
	MapRegion   string         `json:"map_region"`    // 地图区域: world | china
	GridCols    int            `json:"grid_cols"`     // 网格列数
	GridRows    int            `json:"grid_rows"`     // 网格行数
	Widgets     []ScreenWidget `json:"widgets"`       // widget 列表
}

// componentRegistry 全局组件注册表
var componentRegistry = map[string]*ComponentDef{}
var componentTemplates = map[string]string{} // id → JS template content

// LoadComponents 从目录加载所有组件定义和模板
func LoadComponents(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("读取组件目录失败: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		// 加载组件定义
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}

		var def ComponentDef
		if err := json.Unmarshal(data, &def); err != nil {
			continue
		}

		componentRegistry[def.ID] = &def

		// 加载对应的 JS 模板
		jsFile := strings.Replace(entry.Name(), ".json", ".js", 1)
		jsData, err := os.ReadFile(filepath.Join(dir, jsFile))
		if err == nil {
			componentTemplates[def.ID] = string(jsData)
		}
	}

	return nil
}

// GetComponentDef 获取组件定义
func GetComponentDef(id string) (*ComponentDef, bool) {
	def, ok := componentRegistry[id]
	return def, ok
}

// ListComponents 按分类列出所有组件定义
func ListComponents() map[string][]*ComponentDef {
	result := map[string][]*ComponentDef{}
	for _, def := range componentRegistry {
		result[def.Category] = append(result[def.Category], def)
	}
	// 排序
	for cat := range result {
		sort.Slice(result[cat], func(i, j int) bool {
			return result[cat][i].Name < result[cat][j].Name
		})
	}
	return result
}

// GenerateConfigFormJSON 为 HITL ask_user 生成配置表单的 fields JSON
func GenerateConfigFormJSON(componentID string, currentConfig map[string]interface{}) ([]map[string]interface{}, error) {
	def, ok := componentRegistry[componentID]
	if !ok {
		return nil, fmt.Errorf("组件 %s 不存在", componentID)
	}

	fields := []map[string]interface{}{}
	for key, schema := range def.ConfigSchema {
		if schema.Type == "list" || schema.Type == "string_list" {
			// 复杂列表类型跳过，不适合表单编辑
			continue
		}
		field := map[string]interface{}{
			"id":           key,
			"label":        schema.Label,
			"type":         mapFieldType(schema.Type),
			"placeholder":  schema.Hint,
			"required":     schema.Required,
		}

		// 当前值作为 default_value
		if val, exists := currentConfig[key]; exists {
			field["default_value"] = val
		} else if schema.Default != nil {
			field["default_value"] = schema.Default
		}

		// number 类型的范围限制
		if schema.Min != nil {
			field["min"] = *schema.Min
		}
		if schema.Max != nil {
			field["max"] = *schema.Max
		}

		// select 类型的选项
		if len(schema.Options) > 0 {
			opts := []map[string]interface{}{}
			for _, o := range schema.Options {
				opts = append(opts, map[string]interface{}{
					"id":    o,
					"label": o,
				})
			}
			field["options"] = opts
		}

		fields = append(fields, field)
	}
	return fields, nil
}

// mapFieldType 将组件 schema 类型映射为 HITL form 字段类型
// 前端支持: text, number, color, select, boolean, checkbox
func mapFieldType(t string) string {
	switch t {
	case "string":
		return "text"
	case "number":
		return "number"
	case "boolean":
		return "boolean"
	case "select":
		return "select"
	case "color":
		return "color"
	case "color_list":
		return "text"
	case "string_list":
		return "text"
	case "api_url":
		return "text"
	case "list":
		return "text" // 复杂列表用 JSON 输入
	default:
		return "text"
	}
}

// AssembleAppPage 根据蓝图组装完整 HTML 页面
func AssembleAppPage(blueprint AppBlueprint, primaryColor string) string {
	// 收集所有依赖
	allDeps := map[string]bool{}
	for _, inst := range blueprint.Components {
		def, ok := componentRegistry[inst.GetID()]
		if !ok {
			continue
		}
		for _, dep := range def.Dependencies {
			allDeps[dep] = true
		}
	}

	// 生成依赖库的 <script> 引用
	libScripts := ""
	for dep := range allDeps {
		switch dep {
		case "echarts":
			libScripts += `<script src="/lib/echarts.min.js"></script>` + "\n"
		case "leaflet":
			libScripts += `<link rel="stylesheet" href="/lib/leaflet.min.css">` + "\n"
			libScripts += `<script src="/lib/leaflet.min.js"></script>` + "\n"
		}
	}

	// 生成 CSS 变量（含蓝图 primary_color）
	cssVars := fmt.Sprintf(":root {\n  --primary: %s;\n  --primary-light: %s;\n  --primary-dark: %s;\n",
		primaryColor, lightenColor(primaryColor), darkenColor(primaryColor))
	cssVars += "  --bg: #ffffff; --bg-secondary: #f7fafc; --text: #1a202c; --text-secondary: #4a5568;\n"
	cssVars += "  --border: #e2e8f0; --radius: 8px; --shadow: 0 1px 3px rgba(0,0,0,0.1);\n}\n"

	// 收集 HITL postMessage 用的组件配置/容器ID/渲染函数数据
	configSnapshots := []map[string]interface{}{}
	containerIDList := []string{}
	renderFuncList := []string{}
	for _, inst := range blueprint.Components {
		configSnapshots = append(configSnapshots, inst.Config)
	}
	for i, inst := range blueprint.Components {
		containerIDList = append(containerIDList, fmt.Sprintf("comp-%d", i))
		renderFuncList = append(renderFuncList, getRenderFuncName(inst.GetID()))
	}
	configsJSON, _ := json.Marshal(configSnapshots)
	containerIDsJSON, _ := json.Marshal(containerIDList)
	renderFuncsJSON, _ := json.Marshal(renderFuncList)

	// 生成组件 JS 初始化代码
	componentInits := ""
	for i, inst := range blueprint.Components {
		def, ok := componentRegistry[inst.GetID()]
		if !ok {
			continue
		}

		// 确定渲染函数名
		renderFunc := getRenderFuncName(inst.GetID())
		containerID := fmt.Sprintf("comp-%d", i)

		// 序列化 config 为 JSON
		configJSON, _ := json.Marshal(inst.Config)

		// 根据组件类型确定容器尺寸
		containerStyle := ""
		for key, schema := range def.ConfigSchema {
			if key == "height" {
				if h, ok := inst.Config["height"]; ok {
					containerStyle += fmt.Sprintf("height:%vpx;", h)
				} else if schema.Default != nil {
					containerStyle += fmt.Sprintf("height:%vpx;", schema.Default)
				}
			}
		}

		componentInits += fmt.Sprintf(`
  // 组件 %d: %s (%s)
  %s(%s, '%s');
`, i+1, def.Name, inst.GetID(), renderFunc, string(configJSON), containerID)

		// 如果组件有 api_url，自动注入 filterChange 监听
		if _, hasAPI := inst.Config["api_url"]; hasAPI {
			componentInits += fmt.Sprintf(`
  // 组件 %d: 监听筛选变化自动刷新
  (function() {
    var _baseCfg%d = JSON.parse('%s');
    var _baseApi%d = _baseCfg%d.api_url || '';
    var _compId%d = '%s';
    var _fn%d = %s;
    if (window.__appEventBus) {
      window.__appEventBus.on('filterChange', function(filters) {
        // 每次从原始 URL 重建，避免参数累积
        var url = _baseApi%d;
        if (url && filters) {
          var sep = url.indexOf('?') >= 0 ? '&' : '?';
          Object.keys(filters).forEach(function(k) {
            if (filters[k]) { url += sep + encodeURIComponent(k) + '=' + encodeURIComponent(filters[k]); sep = '&'; }
          });
        }
        var newCfg = Object.assign({}, _baseCfg%d, {api_url: url});
        var el = document.getElementById(_compId%d);
        if (el) { el.innerHTML = ''; _fn%d(newCfg, _compId%d); }
      });
    }
  })();
`, i+1, i, string(configJSON), i, i, i, containerID, i, renderFunc, i, i, i, i, i)
		}
	}

	// 生成组件容器 HTML
	componentHTML := ""
	for i, inst := range blueprint.Components {
		def, ok := componentRegistry[inst.GetID()]
		if !ok {
			continue
		}

		containerID := fmt.Sprintf("comp-%d", i)
		containerStyle := ""
		for key, schema := range def.ConfigSchema {
			if key == "height" {
				if h, ok := inst.Config["height"]; ok {
					containerStyle += fmt.Sprintf("min-height:%vpx;", h)
				} else if schema.Default != nil {
					containerStyle += fmt.Sprintf("min-height:%vpx;", schema.Default)
				}
			}
		}

		componentHTML += fmt.Sprintf(`
<section class="app-section" style="margin-bottom:16px">
  <div id="%s" style="%s"></div>
</section>`, containerID, containerStyle)
	}

	// 组装组件 JS 模板代码
	componentJSCode := ""
	for _, inst := range blueprint.Components {
		if tmpl, ok := componentTemplates[inst.GetID()]; ok {
			componentJSCode += tmpl + "\n"
		}
	}

	// 组装完整页面
	page := fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>%s - 数据工具箱</title>
  %s
  <style>
%s
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg-secondary); }
.app-container { max-width: 1200px; margin: 0 auto; padding: 20px; }
.app-header { margin-bottom: 24px; }
.app-header h1 { font-size: 22px; color: var(--text); }
.app-header p { font-size: 14px; color: var(--text-secondary); margin-top: 4px; }
.app-section { background: var(--bg); border-radius: var(--radius); padding: 16px; box-shadow: var(--shadow); }
.kpi-card { transition: transform 0.2s; }
.kpi-card:hover { transform: translateY(-2px); }
  </style>
</head>
<body>
<div class="app-container">
  <div class="app-header">
    <h1>%s %s</h1>
    <p>%s</p>
  </div>
  %s
</div>
<script>
// 注入认证 token 和基础 URL
(function() {
    const params = new URLSearchParams(window.location.search);
    window._appToken = params.get('token') || localStorage.getItem('dataOntologyToken') || '';
    // 不覆盖前端 doc.write 注入的 _appBaseURL（about:blank iframe 里 location.origin 是 "null"）
    if (!window._appBaseURL || window._appBaseURL === 'null') {
        window._appBaseURL = (window.location.origin && window.location.origin !== 'null') ? window.location.origin : (window.location.protocol + '//' + window.location.host);
    }
    window.fetchWithAuth = function(url, options) {
        options = options || {};
        options.headers = options.headers || {};
        // 将相对路径转为绝对路径（doc.write 写入的 iframe base URL 是 about:blank）
        if (url && typeof url === 'string' && url.startsWith('/') && window._appBaseURL) {
            url = window._appBaseURL + url;
        }
        if (window._appToken) {
            if (options.headers instanceof Headers) {
                options.headers.set('Authorization', 'Bearer ' + window._appToken);
            } else if (typeof options.headers === 'object') {
                options.headers['Authorization'] = 'Bearer ' + window._appToken;
            }
        }
        return fetch(url, options);
    };
})();
</script>
<script>
// 全局事件总线 — 组件间联动
(function() {
    var bus = {};
    window.__appEventBus = {
        _listeners: {},
        on: function(event, fn) {
            if (!bus[event]) bus[event] = [];
            bus[event].push(fn);
        },
        off: function(event, fn) {
            if (!bus[event]) return;
            bus[event] = bus[event].filter(function(f) { return f !== fn; });
        },
        emit: function(event, data) {
            if (!bus[event]) return;
            bus[event].forEach(function(fn) { try { fn(data); } catch(e) { console.error('EventBus error:', e); } });
        }
    };
})();
</script>
<script>
// HITL 预览配置更新 — 监听 postMessage 重新渲染组件
(function() {
    var _compConfigs = %s;  // 原始组件配置快照
    var _compIds = %s;      // 组件容器 ID 列表
    var _renderFuncs = %s;  // 渲染函数名列表

    window.addEventListener('message', function(e) {
        if (e.data && e.data.type === 'updateConfig') {
            var cfg = e.data.config || {};
            // 更新标题
            var h1 = document.querySelector('.app-header h1');
            if (h1 && cfg.comp0_title) h1.textContent = cfg.comp0_title;
            // 更新主色调
            if (cfg.comp0_primary_color) {
                document.documentElement.style.setProperty('--primary', cfg.comp0_primary_color);
            }
            // 更新各组件配置
            for (var i = 0; i < _compConfigs.length; i++) {
                var compIdx = i + 1;  // comp0 是全局，comp1 开始是组件
                var changed = false;
                var newCfg = Object.assign({}, _compConfigs[i]);
                for (var key in cfg) {
                    if (key.indexOf('comp' + compIdx + '_') === 0) {
                        var fieldKey = key.slice(('comp' + compIdx + '_').length);
                        newCfg[fieldKey] = cfg[key];
                        changed = true;
                    }
                }
                if (changed) {
                    _compConfigs[i] = newCfg;
                    var el = document.getElementById(_compIds[i]);
                    var fn = window[_renderFuncs[i]];
                    if (el && fn) {
                        // Dispose ECharts instance before re-render
                        if (typeof echarts !== 'undefined') {
                            try { echarts.getInstanceByDom(el) && echarts.getInstanceByDom(el).dispose(); } catch(e) {}
                        }
                        el.innerHTML = '';
                        try { fn(newCfg, _compIds[i]); } catch(e) { console.error('Re-render error:', e); }
                    }
                }
            }
        }
        // Handle resize events from HITL preview
        if (e.data && e.data.type === 'resize') {
            if (typeof echarts !== 'undefined') {
                setTimeout(function() {
                    var charts = document.querySelectorAll('div[_echarts_instance_]');
                    charts.forEach(function(el) {
                        var inst = echarts.getInstanceByDom(el);
                        if (inst) inst.resize();
                    });
                }, 100);
            }
        }
    });
})();
</script>
<script>
// 组件渲染函数
%s
</script>
<script>
// 组件初始化
%s
</script>
</body>
</html>`,
		blueprint.Title,
		libScripts,
		cssVars,
		blueprint.Icon, blueprint.Title,
		blueprint.Description,
		componentHTML,
		configsJSON, containerIDsJSON, renderFuncsJSON,
		componentJSCode,
		componentInits)

	return page
}

// getRenderFuncName 根据 component ID 获取渲染函数名
func getRenderFuncName(id string) string {
	switch id {
	case "chart-bar", "bar-chart":
		return "renderBarChart"
	case "chart-line", "line-chart":
		return "renderLineChart"
	case "chart-pie", "pie-chart":
		return "renderPieChart"
	case "kpi-card":
		return "renderKpiCard"
	case "data-table":
		return "renderDataTable"
	case "text-block":
		return "renderTextBlock"
	case "image-block":
		return "renderImageBlock"
	case "gauge", "chart-gauge":
		return "renderGauge"
	case "map-scatter":
		return "renderMapScatter"
	case "filter-bar":
		return "renderFilterBar"
	case "timeline":
		return "renderTimeline"
	case "chart-area":
		return "renderChartArea"
	case "chart-combo":
		return "renderComboChart"
	case "chart-heatmap":
		return "renderHeatmapChart"
	case "dashboard-summary":
		return "renderDashboardSummary"
	case "map-choropleth":
		return "renderMapChoropleth"
	default:
		return "render" + strings.Title(strings.ReplaceAll(id, "-", ""))
	}
}

// lightenColor / darkenColor — 简单的 HEX 颜色亮度调整
func lightenColor(hex string) string {
	return adjustColor(hex, 40)
}
func darkenColor(hex string) string {
	return adjustColor(hex, -30)
}

func adjustColor(hex string, amount int) string {
	hex = strings.TrimPrefix(hex, "#")
	if len(hex) != 6 {
		return "#4F46E5" // fallback
	}
	r := clamp(parseHex(hex[0:2])+amount, 0, 255)
	g := clamp(parseHex(hex[2:4])+amount, 0, 255)
	b := clamp(parseHex(hex[4:6])+amount, 0, 255)
	return fmt.Sprintf("#%02X%02X%02X", r, g, b)
}

func parseHex(s string) int {
	v := 0
	for _, c := range s {
		switch {
		case c >= '0' && c <= '9':
			v = v*16 + int(c-'0')
		case c >= 'A' && c <= 'F':
			v = v*16 + int(c-'A') + 10
		case c >= 'a' && c <= 'f':
			v = v*16 + int(c-'a') + 10
		}
	}
	return v
}

func clamp(v, min, max int) int {
	if v < min { return min }
	if v > max { return max }
	return v
}

// GeneratePreviewHTML 生成预览用的 HTML（用于 HITL iframe）
func GeneratePreviewHTML(blueprint AppBlueprint, primaryColor string) string {
	return AssembleAppPage(blueprint, primaryColor)
}

// AssembleScreenPage 根据大屏蓝图组装完整 HTML 页面
func AssembleScreenPage(bp ScreenBlueprint) string {
	// 默认值
	if bp.Theme == "" {
		bp.Theme = "linear-dark"
	}
	if bp.GridCols == 0 {
		bp.GridCols = 12
	}
	if bp.MapRegion == "" {
		bp.MapRegion = "china"
	}

	// 收集所有依赖
	allDeps := map[string]bool{}
	for _, w := range bp.Widgets {
		def, ok := componentRegistry[w.CompID]
		if !ok {
			continue
		}
		for _, dep := range def.Dependencies {
			allDeps[dep] = true
		}
	}
	// 地图依赖
	if bp.ShowMap {
		allDeps["echarts"] = true
	}

	// 依赖库
	libScripts := ""
	for dep := range allDeps {
		switch dep {
		case "echarts":
			libScripts += `<script src="/lib/echarts.min.js"></script>` + "\n"
		case "leaflet":
			libScripts += `<link rel="stylesheet" href="/lib/leaflet.min.css">` + "\n"
			libScripts += `<script src="/lib/leaflet.min.js"></script>` + "\n"
		}
	}

	// 组件 JS 代码
	componentJSCode := ""
	seen := map[string]bool{}
	for _, w := range bp.Widgets {
		if tmpl, ok := componentTemplates[w.CompID]; ok {
			if !seen[w.CompID] {
				componentJSCode += tmpl + "\n"
				seen[w.CompID] = true
			}
		}
	}

	// widget 容器 HTML（绝对定位，基于网格）
	widgetHTML := ""
	if bp.ShowMap {
		widgetHTML += `<div id="screen-map" class="screen-map"></div>` + "\n"
	}
	for _, w := range bp.Widgets {
		leftPct := float64(w.X) / float64(bp.GridCols) * 100
		topPct := float64(w.Y) / float64(bp.GridRows) * 100
		widthPct := float64(w.W) / float64(bp.GridCols) * 100
		heightPct := float64(w.H) / float64(bp.GridRows) * 100

		widgetHTML += fmt.Sprintf(`<div class="screen-widget" id="screen-w-%s" style="left:%.2f%%;top:%.2f%%;width:%.2f%%;height:%.2f%%;"></div>`+"\n",
			w.ID, leftPct, topPct, widthPct, heightPct)
	}

	// 组件初始化 JS
	componentInits := ""
	for _, w := range bp.Widgets {
		renderFunc := getRenderFuncName(w.CompID)
		configJSON, _ := json.Marshal(w.Config)
		componentInits += fmt.Sprintf("  %s(%s, 'screen-w-%s');\n", renderFunc, string(configJSON), w.ID)
	}

	// 地图初始化（ECharts geo）
	mapInit := ""
	if bp.ShowMap {
		mapJS, _ := getMapConfigJSON(bp.MapRegion)
		mapInit = fmt.Sprintf(`
  (function() {
    var mapDom = document.getElementById('screen-map');
    if (!mapDom || typeof echarts === 'undefined') return;
    var mapChart = echarts.init(mapDom);
    mapChart.setOption(%s);
    var ro = new ResizeObserver(function() { mapChart.resize(); });
    ro.observe(mapDom);
  })();`, mapJS)
	}

	// 序列化 widget 数据（给编辑器用）
	widgetsJSON, _ := json.Marshal(bp.Widgets)
	theme := bp.Theme

	page := fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh-CN" data-theme="%s">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>%s - DataToolbox</title>
  %s
  <link rel="stylesheet" href="/components/themes.css">
  <style>
    /* 大屏特定样式 */
    html, body { width: 100%%; height: 100%%; overflow: hidden; }
    #screen-canvas {
      position: relative;
      width: 100%%;
      height: 100vh;
      max-width: %dpx;
      margin: 0 auto;
    }
    .screen-map {
      position: absolute;
      left: 0; top: 0;
      width: 100%%; height: 100%%;
      z-index: 0;
      opacity: 0.4;
    }
    .screen-widget { z-index: 1; }
  </style>
</head>
<body>
<div id="screen-canvas">
  %s
</div>
<script>
// 注入认证
(function() {
    const params = new URLSearchParams(window.location.search);
    window._appToken = params.get('token') || localStorage.getItem('dataOntologyToken') || '';
    window._appBaseURL = (window.location.origin && window.location.origin !== 'null')
        ? window.location.origin
        : (window.location.protocol + '//' + window.location.host);
    window.fetchWithAuth = function(url, options) {
        options = options || {};
        options.headers = options.headers || {};
        if (url && typeof url === 'string' && url.startsWith('/') && window._appBaseURL)
            url = window._appBaseURL + url;
        if (window._appToken) {
            if (options.headers instanceof Headers)
                options.headers.set('Authorization', 'Bearer ' + window._appToken);
            else
                options.headers['Authorization'] = 'Bearer ' + window._appToken;
        }
        return fetch(url, options);
    };
})();
</script>
<script>
// 组件渲染函数
%s
</script>
<script>
// 大屏数据
window.__screenBlueprint = {
    theme: '%s',
    gridCols: %d,
    gridRows: %d,
    widgets: %s
};
</script>
<script>
// 地图 + 组件初始化
%s
%s
</script>
</body>
</html>`,
		theme,
		bp.Title,
		libScripts,
		1920, // max canvas width
		widgetHTML,
		componentJSCode,
		theme, bp.GridCols, bp.GridRows, widgetsJSON,
		mapInit,
		componentInits)

	return page
}

// getMapConfigJSON 返回 ECharts geo 地图配置
func getMapConfigJSON(region string) (string, error) {
	// 采用世界地图或中国地图的 geo 配置
	cfg := map[string]interface{}{
		"geo": map[string]interface{}{
			"map":    region,
			"roam":   true,
			"center": []int{104, 38},
			"zoom":   1.2,
			"itemStyle": map[string]interface{}{
				"areaColor":    "#1a1d24",
				"borderColor":  "#2a2d35",
				"borderWidth":  1,
			},
			"emphasis": map[string]interface{}{
				"itemStyle": map[string]interface{}{
					"areaColor": "#2a2d35",
				},
			},
		},
	}
	b, err := json.Marshal(cfg)
	if err != nil {
		return "{}", err
	}
	return string(b), nil
}
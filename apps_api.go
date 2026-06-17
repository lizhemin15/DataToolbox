package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/YOUR_USERNAME/DataToolbox/components"
)

// ============================================================
// 应用管理 REST API Handlers
// ============================================================

// handleApps 处理应用列表和创建请求
// GET /api/v1/apps - 列出用户的所有应用
// POST /api/v1/apps - 创建新应用
func handleApps(w http.ResponseWriter, r *http.Request) {
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "")
		return
	}

	switch r.Method {
	case http.MethodGet:
		handleListApps(w, r, username)
	case http.MethodPost:
		handleCreateApp(w, r, username)
	default:
		apiMethodNotAllowed(w)
	}
}

// handleListApps 列出用户的所有应用
func handleListApps(w http.ResponseWriter, r *http.Request, username string) {
	apps, err := sqlListApps(username)
	if err != nil {
		log.Printf("[应用] 查询应用列表失败: %v", err)
		apiError(w, "查询应用列表失败", http.StatusInternalServerError, "internal_error")
		return
	}

	apiSuccess(w, map[string]interface{}{
		"apps":  apps,
		"total": len(apps),
	})
}

// handleCreateApp 创建新应用
func handleCreateApp(w http.ResponseWriter, r *http.Request, username string) {
	var req struct {
		Name        string                 `json:"name"`
		Slug        string                 `json:"slug"`
		Title       string                 `json:"title"`
		Description string                 `json:"description"`
		Icon        string                 `json:"icon"`
		HTML        string                 `json:"html"`
		CSS         string                 `json:"css"`
		JS          string                 `json:"js"`
		Files       []string               `json:"files"`
		Config      map[string]interface{} `json:"config"`
		Tags        []string               `json:"tags"`
		IsPublic    bool                   `json:"is_public"`
		Components  []components.ComponentInstance `json:"components"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apiBadRequest(w, "无效的请求体")
		return
	}

	// 验证必填字段
	if req.Name == "" {
		apiBadRequest(w, "应用名称不能为空")
		return
	}
	if req.Slug == "" {
		apiBadRequest(w, "应用 slug 不能为空")
		return
	}

	// 验证 slug 格式（只允许字母、数字、下划线和连字符）
	for _, c := range req.Slug {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-') {
			apiBadRequest(w, "slug 只能包含字母、数字、下划线和连字符")
			return
		}
	}

	// 检查 slug 是否已存在
	existingApp, err := sqlGetAppBySlug(req.Slug)
	if err != nil {
		log.Printf("[应用] 检查 slug 失败: %v", err)
		apiError(w, "检查 slug 失败", http.StatusInternalServerError, "internal_error")
		return
	}
	if existingApp != nil {
		apiBadRequest(w, "slug 已被使用，请更换一个")
		return
	}

	// 生成 ID
	appID := uuid.New().String()

	// 序列化 config
	configJSON := ""
	if req.Config != nil {
		configJSON = toJSON(req.Config)
	}

	// 如果有 components，调用 AssembleAppPage 生成 HTML
	appTitle := req.Title
	if appTitle == "" {
		appTitle = req.Name
	}
	appHTML := req.HTML
	if len(req.Components) > 0 && appHTML == "" {
		blueprint := components.AppBlueprint{
			Title:       appTitle,
			Slug:        req.Slug,
			Description: req.Description,
			Components:  req.Components,
		}
		appHTML = components.AssembleAppPage(blueprint, "")
	}

	// 创建应用对象
	app := &App{
		ID:          appID,
		Owner:       username,
		Name:        req.Name,
		Slug:        req.Slug,
		Title:       appTitle,
		Description: req.Description,
		Icon:        req.Icon,
		HTML:        appHTML,
		CSS:         req.CSS,
		JS:          req.JS,
		Files:       req.Files,
		Config:      configJSON,
		Tags:        req.Tags,
		IsPublic:    req.IsPublic,
		ViewCount:   0,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	// 保存到数据库
	if err := sqlSaveApp(app); err != nil {
		log.Printf("[应用] 创建应用失败: %v", err)
		apiError(w, "创建应用失败", http.StatusInternalServerError, "internal_error")
		return
	}

	log.Printf("[应用] 用户 %s 创建应用 %s (slug: %s)", username, appID, req.Slug)

	apiSuccess(w, map[string]interface{}{
		"app": app,
	})
}

// handleAppDetail 处理单个应用的 CRUD
// GET /api/v1/apps/{id} - 获取应用详情
// PUT /api/v1/apps/{id} - 更新应用
// DELETE /api/v1/apps/{id} - 删除应用
func handleAppDetail(w http.ResponseWriter, r *http.Request) {
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "")
		return
	}

	// 从 URL 中提取 ID
	// URL 格式: /api/v1/apps/{id}
	path := r.URL.Path
	parts := strings.Split(path, "/")
	// parts = ["", "api", "v1", "apps", "{id}"]
	if len(parts) < 5 || parts[4] == "" {
		apiBadRequest(w, "缺少应用 ID")
		return
	}
	appID := parts[4]

	switch r.Method {
	case http.MethodGet:
		handleGetApp(w, r, username, appID)
	case http.MethodPut:
		handleUpdateApp(w, r, username, appID)
	case http.MethodDelete:
		handleDeleteApp(w, r, username, appID)
	default:
		apiMethodNotAllowed(w)
	}
}

// handleGetApp 获取应用详情
func handleGetApp(w http.ResponseWriter, r *http.Request, username string, appID string) {
	app, err := sqlGetApp(appID)
	if err != nil {
		log.Printf("[应用] 查询应用失败: %v", err)
		apiError(w, "查询应用失败", http.StatusInternalServerError, "internal_error")
		return
	}

	if app == nil {
		apiNotFound(w, "应用不存在")
		return
	}

	// 权限检查：只有 owner 可以查看完整内容
	if app.Owner != username {
		// 非 owner 只能看到基本信息（如果是公开应用）
		if !app.IsPublic {
			apiForbidden(w, "无权访问此应用")
			return
		}
		// 公开应用返回基本信息（不含代码）
		apiSuccess(w, map[string]interface{}{
			"app": map[string]interface{}{
				"id":          app.ID,
				"owner":       app.Owner,
				"name":        app.Name,
				"slug":        app.Slug,
				"title":       app.Title,
				"description": app.Description,
				"icon":        app.Icon,
				"is_public":   app.IsPublic,
				"view_count":  app.ViewCount,
				"created_at":  app.CreatedAt,
				"updated_at":  app.UpdatedAt,
			},
		})
		return
	}

	apiSuccess(w, map[string]interface{}{
		"app": app,
	})
}

// handleUpdateApp 更新应用
func handleUpdateApp(w http.ResponseWriter, r *http.Request, username string, appID string) {
	// 先获取应用检查权限
	app, err := sqlGetApp(appID)
	if err != nil {
		log.Printf("[应用] 查询应用失败: %v", err)
		apiError(w, "查询应用失败", http.StatusInternalServerError, "internal_error")
		return
	}

	if app == nil {
		apiNotFound(w, "应用不存在")
		return
	}

	// 权限检查：只有 owner 可以更新
	if app.Owner != username {
		apiForbidden(w, "无权修改此应用")
		return
	}

	var req struct {
		Name        string                 `json:"name"`
		Slug        string                 `json:"slug"`
		Title       string                 `json:"title"`
		Description string                 `json:"description"`
		Icon        string                 `json:"icon"`
		HTML        string                 `json:"html"`
		CSS         string                 `json:"css"`
		JS          string                 `json:"js"`
		Files       []string               `json:"files"`
		Config      map[string]interface{} `json:"config"`
		Tags        []string               `json:"tags"`
		IsPublic    *bool                  `json:"is_public"`
		Components  []components.ComponentInstance `json:"components"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apiBadRequest(w, "无效的请求体")
		return
	}

	// 如果要更新 slug，需要验证
	if req.Slug != "" && req.Slug != app.Slug {
		// 验证 slug 格式
		for _, c := range req.Slug {
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-') {
				apiBadRequest(w, "slug 只能包含字母、数字、下划线和连字符")
				return
			}
		}

		// 检查 slug 是否已被其他应用使用
		existingApp, err := sqlGetAppBySlug(req.Slug)
		if err != nil {
			log.Printf("[应用] 检查 slug 失败: %v", err)
			apiError(w, "检查 slug 失败", http.StatusInternalServerError, "internal_error")
			return
		}
		if existingApp != nil && existingApp.ID != appID {
			apiBadRequest(w, "slug 已被使用，请更换一个")
			return
		}
		app.Slug = req.Slug
	}

	// 更新字段（只更新非空字段）
	if req.Name != "" {
		app.Name = req.Name
	}
	if req.Title != "" {
		app.Title = req.Title
	}
	if req.Description != "" {
		app.Description = req.Description
	}
	if req.Icon != "" {
		app.Icon = req.Icon
	}
	if req.HTML != "" {
		app.HTML = req.HTML
	}
	if req.CSS != "" {
		app.CSS = req.CSS
	}
	if req.JS != "" {
		app.JS = req.JS
	}
	if req.Files != nil {
		app.Files = req.Files
	}
	if req.Config != nil {
		app.Config = toJSON(req.Config)
	}
	if req.Tags != nil {
		app.Tags = req.Tags
	}
	if req.IsPublic != nil {
		app.IsPublic = *req.IsPublic
	}

	// 如果传了 components，重新组装 HTML
	if len(req.Components) > 0 && req.HTML == "" {
		blueprint := components.AppBlueprint{
			Title:       app.Title,
			Slug:        app.Slug,
			Description: app.Description,
			Components:  req.Components,
		}
		app.HTML = components.AssembleAppPage(blueprint, "")
		// 同时保存 components 到 config
		if app.Config == "" {
			app.Config = "{}"
		}
	}

	app.UpdatedAt = time.Now()

	// 保存更新
	if err := sqlSaveApp(app); err != nil {
		log.Printf("[应用] 更新应用失败: %v", err)
		apiError(w, "更新应用失败", http.StatusInternalServerError, "internal_error")
		return
	}

	log.Printf("[应用] 用户 %s 更新应用 %s", username, appID)

	apiSuccess(w, map[string]interface{}{
		"app": app,
	})
}

// handleDeleteApp 删除应用
func handleDeleteApp(w http.ResponseWriter, r *http.Request, username string, appID string) {
	// 先获取应用检查权限
	app, err := sqlGetApp(appID)
	if err != nil {
		log.Printf("[应用] 查询应用失败: %v", err)
		apiError(w, "查询应用失败", http.StatusInternalServerError, "internal_error")
		return
	}

	if app == nil {
		apiNotFound(w, "应用不存在")
		return
	}

	// 权限检查：只有 owner 可以删除
	if app.Owner != username {
		apiForbidden(w, "无权删除此应用")
		return
	}

	// 删除应用
	if err := sqlDeleteApp(appID, username); err != nil {
		log.Printf("[应用] 删除应用失败: %v", err)
		apiError(w, "删除应用失败", http.StatusInternalServerError, "internal_error")
		return
	}

	log.Printf("[应用] 用户 %s 删除应用 %s", username, appID)

	apiSuccess(w, map[string]interface{}{
		"message": "应用已删除",
		"id":      appID,
	})
}

// ============================================================
// 公开访问应用 - 渲染 HTML 页面
// ============================================================

// handleAppPublic 公开访问应用页面
// GET /app/{slug} - 返回渲染后的 HTML 页面
func handleAppPublic(w http.ResponseWriter, r *http.Request) {
	// 从 URL 中提取 slug
	// URL 格式: /app/{slug}
	path := r.URL.Path
	parts := strings.Split(path, "/")
	// parts = ["", "app", "{slug}"]
	if len(parts) < 3 || parts[2] == "" {
		http.Error(w, "缺少应用 slug", http.StatusBadRequest)
		return
	}
	slug := parts[2]

	// 获取应用
	app, err := sqlGetAppBySlug(slug)
	if err != nil {
		log.Printf("[应用] 查询公开应用失败: %v", err)
		http.Error(w, "查询应用失败", http.StatusInternalServerError)
		return
	}

	if app == nil {
		http.Error(w, "应用不存在", http.StatusNotFound)
		return
	}

	// 检查是否公开；未公开时仅 owner 可访问
	if !app.IsPublic {
		username, authOK := getDataOntologyUserFromRequest(r)
		if !authOK {
			// 尝试从 query param 读 token
			if t := r.URL.Query().Get("token"); t != "" {
				r2 := r.Clone(r.Context())
				r2.Header.Set("Authorization", "Bearer "+t)
				username, authOK = getDataOntologyUserFromRequest(r2)
			}
		}
		if !authOK || username != app.Owner {
			http.Error(w, "此应用未公开", http.StatusForbidden)
			return
		}
	}

	// 增加访问计数
	go func() {
		if err := sqlIncrementAppViewCount(app.ID); err != nil {
			log.Printf("[应用] 更新访问计数失败: %v", err)
		}
	}()

	// 渲染 HTML 页面
	renderedHTML := renderAppPage(app)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(renderedHTML))
}

// renderAppPage 渲染应用页面 HTML
func renderAppPage(app *App) string {
	htmlContent := app.HTML
	if htmlContent == "" {
		// 如果 config 中有 blueprint 且有 components，重新渲染
		if blueprint := extractBlueprintFromConfig(app.Config); blueprint != nil && len(blueprint.Components) > 0 {
			primaryColor := extractPrimaryColorFromConfig(app.Config)
			htmlContent = components.AssembleAppPage(*blueprint, primaryColor)
			// 更新缓存
			app.HTML = htmlContent
			go func() {
				_ = updateAppHTML(app.ID, htmlContent)
			}()
		} else {
			htmlContent = `<div class="app-container"><h1>` + app.Title + `</h1><p>` + app.Description + `</p></div>`
		}
	}

	// 组件化应用：HTML 是完整文档（由 AssembleAppPage 生成），直接输出
	if strings.HasPrefix(strings.TrimSpace(htmlContent), "<!DOCTYPE") || strings.HasPrefix(strings.TrimSpace(htmlContent), "<html") {
		return htmlContent
	}

	// AI 生成的 HTML：清理完整文档结构，保留 script（组件需要 JS）
	// 清理 HTML 中的完整文档结构（<!DOCTYPE>, <html>, <head>, <body>）
	htmlContent = regexp.MustCompile(`(?i)<!DOCTYPE[^>]*>`).ReplaceAllString(htmlContent, "")
	htmlContent = regexp.MustCompile(`(?i)</?html[^>]*>`).ReplaceAllString(htmlContent, "")
	htmlContent = regexp.MustCompile(`(?i)<head>[\s\S]*?</head>`).ReplaceAllString(htmlContent, "")
	htmlContent = regexp.MustCompile(`(?i)</?body[^>]*>`).ReplaceAllString(htmlContent, "")

	// 从 config 中提取蓝图信息，生成 CSS 变量
	blueprintCSS := extractBlueprintCSS(app.Config)

	cssContent := app.CSS
	if cssContent == "" {
		cssContent = `
.app-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
}
.app-container h1 {
    color: #1a202c;
    font-size: 24px;
    margin-bottom: 16px;
}
.app-container p {
    color: #4a5568;
    line-height: 1.6;
}
`
	}

	jsContent := app.JS

	// 构建页面模板 — 注入 fetchWithAuth 和 token
	page := fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>%s - 数据工具箱</title>
    <style>
:root {
    --primary: #4F46E5;
    --primary-light: #818CF8;
    --primary-dark: #3730A3;
    --bg: #ffffff;
    --bg-secondary: #f7fafc;
    --text: #1a202c;
    --text-secondary: #4a5568;
    --border: #e2e8f0;
    --radius: 8px;
    --shadow: 0 1px 3px rgba(0,0,0,0.1);
%s
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg-secondary); color: var(--text); }
%s
    </style>
</head>
<body>
%s
    <script>
// 注入认证 token
(function() {
    const params = new URLSearchParams(window.location.search);
    window._appToken = params.get('token') || '';
    window.fetchWithAuth = function(url, options) {
        options = options || {};
        options.headers = options.headers || {};
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
%s
    </script>
</body>
</html>`, app.Title, blueprintCSS, cssContent, htmlContent, jsContent)

	return page
}

// extractBlueprintCSS 从 config JSON 中提取蓝图信息，生成 CSS 变量覆盖
func extractBlueprintCSS(configJSON string) string {
	if configJSON == "" || configJSON == "{}" {
		return ""
	}

	var config map[string]interface{}
	if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
		return ""
	}

	blueprint, ok := config["blueprint"].(map[string]interface{})
	if !ok {
		return ""
	}

	var cssVars []string

	// 主色调 → CSS 变量
	if primaryColor, ok := blueprint["primary_color"].(string); ok && primaryColor != "" {
		cssVars = append(cssVars,
			fmt.Sprintf("    --primary: %s;", primaryColor),
			fmt.Sprintf("    --primary-light: %s;", lightenColor(primaryColor, 30)),
			fmt.Sprintf("    --primary-dark: %s;", darkenColor(primaryColor, 20)),
		)
	}

	// 设计方向 → 背景和文字色
	if direction, ok := blueprint["design_direction"].(string); ok && direction != "" {
		switch direction {
		case "dark":
			cssVars = append(cssVars,
				"    --bg: #0f172a;",
				"    --bg-secondary: #1e293b;",
				"    --text: #f1f5f9;",
				"    --text-secondary: #94a3b8;",
				"    --border: #334155;",
			)
		case "minimal":
			cssVars = append(cssVars,
				"    --bg: #ffffff;",
				"    --bg-secondary: #fafafa;",
				"    --border: #f0f0f0;",
				"    --radius: 12px;",
			)
		case "vibrant":
			cssVars = append(cssVars,
				"    --bg: #fefce8;",
				"    --bg-secondary: #fef9c3;",
				"    --border: #fde68a;",
			)
		case "nature":
			cssVars = append(cssVars,
				"    --bg: #f0fdf4;",
				"    --bg-secondary: #dcfce7;",
				"    --border: #bbf7d0;",
			)
		case "elegant":
			cssVars = append(cssVars,
				"    --bg: #faf5ff;",
				"    --bg-secondary: #f3e8ff;",
				"    --border: #e9d5ff;",
				"    --radius: 16px;",
			)
		case "playful":
			cssVars = append(cssVars,
				"    --bg: #fff7ed;",
				"    --bg-secondary: #ffedd5;",
				"    --border: #fed7aa;",
				"    --radius: 20px;",
			)
		case "corporate":
			cssVars = append(cssVars,
				"    --bg: #ffffff;",
				"    --bg-secondary: #f8fafc;",
				"    --border: #e2e8f0;",
			)
		case "brutalist":
			cssVars = append(cssVars,
				"    --bg: #ffffff;",
				"    --bg-secondary: #f5f5f5;",
				"    --border: #000000;",
				"    --radius: 0px;",
				"    --shadow: none;",
			)
		}
	}

	if len(cssVars) == 0 {
		return ""
	}
	return "\n" + strings.Join(cssVars, "\n")
}

// lightenColor 将 HEX 颜色变亮
func lightenColor(hex string, percent int) string {
	r, g, b := hexToRGB(hex)
	factor := float64(percent) / 100.0
	r = int(float64(r) + (255-float64(r))*factor)
	g = int(float64(g) + (255-float64(g))*factor)
	b = int(float64(b) + (255-float64(b))*factor)
	return fmt.Sprintf("#%02X%02X%02X", clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255))
}

// darkenColor 将 HEX 颜色变暗
func darkenColor(hex string, percent int) string {
	r, g, b := hexToRGB(hex)
	factor := 1.0 - float64(percent)/100.0
	r = int(float64(r) * factor)
	g = int(float64(g) * factor)
	b = int(float64(b) * factor)
	return fmt.Sprintf("#%02X%02X%02X", clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255))
}

// hexToRGB 将 HEX 颜色转为 RGB
func hexToRGB(hex string) (int, int, int) {
	hex = strings.TrimPrefix(hex, "#")
	if len(hex) == 3 {
		hex = string(hex[0]) + string(hex[0]) + string(hex[1]) + string(hex[1]) + string(hex[2]) + string(hex[2])
	}
	var r, g, b int
	fmt.Sscanf(hex, "%02x%02x%02x", &r, &g, &b)
	return r, g, b
}

// clamp 限制值在 [min, max] 范围内
func clamp(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

// extractBlueprintFromConfig 从 config JSON 中提取蓝图并解析为 AppBlueprint
func extractBlueprintFromConfig(configJSON string) *components.AppBlueprint {
	if configJSON == "" || configJSON == "{}" {
		return nil
	}

	var config map[string]interface{}
	if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
		return nil
	}

	bpRaw, ok := config["blueprint"]
	if !ok {
		return nil
	}

	bpJSON, err := json.Marshal(bpRaw)
	if err != nil {
		return nil
	}

	var blueprint components.AppBlueprint
	if err := json.Unmarshal(bpJSON, &blueprint); err != nil {
		return nil
	}

	return &blueprint
}

// extractPrimaryColorFromConfig 从 config JSON 中提取主色调
func extractPrimaryColorFromConfig(configJSON string) string {
	if configJSON == "" || configJSON == "{}" {
		return ""
	}

	var config map[string]interface{}
	if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
		return ""
	}

	blueprint, ok := config["blueprint"].(map[string]interface{})
	if !ok {
		return ""
	}

	if color, ok := blueprint["primary_color"].(string); ok && color != "" {
		return color
	}

	return ""
}

// updateAppHTML 轻量更新 app 的 HTML 缓存
func updateAppHTML(appID string, html string) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()
	_, err := storeDB.Exec("UPDATE apps SET html=? WHERE id=?", html, appID)
	return err
}

// ============================================================
// 大屏管理 API
// ============================================================

// handleScreens 处理大屏列表和创建
// GET /api/v1/screens - 列出用户的大屏
// POST /api/v1/screens - 创建大屏
func handleScreens(w http.ResponseWriter, r *http.Request) {
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "")
		return
	}

	switch r.Method {
	case http.MethodGet:
		// 列出 type=screen 的应用
		apps, err := sqlListApps(username)
		if err != nil {
			apiError(w, "查询大屏列表失败", http.StatusInternalServerError, "internal_error")
			return
		}
		screens := []*App{}
		for _, app := range apps {
			if app.Config != "" {
				var cfg map[string]interface{}
				if json.Unmarshal([]byte(app.Config), &cfg) == nil {
					if t, ok := cfg["type"].(string); ok && t == "screen" {
						appCopy := app
						screens = append(screens, &appCopy)
					}
				}
			}
		}
		apiSuccess(w, map[string]interface{}{
			"screens": screens,
			"total":   len(screens),
		})
	case http.MethodPost:
		handleCreateScreen(w, r, username)
	default:
		apiMethodNotAllowed(w)
	}
}

// handleCreateScreen 创建大屏
func handleCreateScreen(w http.ResponseWriter, r *http.Request, username string) {
	var req struct {
		Name        string                   `json:"name"`
		Slug        string                   `json:"slug"`
		Title       string                   `json:"title"`
		Description string                   `json:"description"`
		Theme       string                   `json:"theme"`
		ShowMap     bool                     `json:"show_map"`
		MapRegion   string                   `json:"map_region"`
		GridCols    int                      `json:"grid_cols"`
		GridRows    int                      `json:"grid_rows"`
		Widgets     []components.ScreenWidget `json:"widgets"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apiBadRequest(w, "无效的请求体")
		return
	}

	if req.Name == "" {
		apiBadRequest(w, "大屏名称不能为空")
		return
	}
	if req.Slug == "" {
		apiBadRequest(w, "slug 不能为空")
		return
	}

	// 默认值
	if req.Theme == "" {
		req.Theme = "linear-dark"
	}
	if req.GridCols == 0 {
		req.GridCols = 12
	}
	if req.GridRows == 0 {
		req.GridRows = 8
	}
	if req.MapRegion == "" {
		req.MapRegion = "china"
	}

	// 检查 slug 唯一性
	existing, _ := sqlGetAppBySlug(req.Slug)
	if existing != nil {
		apiBadRequest(w, "slug 已被使用")
		return
	}

	appID := uuid.New().String()
	appTitle := req.Title
	if appTitle == "" {
		appTitle = req.Name
	}

	// 构建 ScreenBlueprint
	bp := components.ScreenBlueprint{
		Title:       appTitle,
		Slug:        req.Slug,
		Description: req.Description,
		Theme:       req.Theme,
		ShowMap:     req.ShowMap,
		MapRegion:   req.MapRegion,
		GridCols:    req.GridCols,
		GridRows:    req.GridRows,
		Widgets:     req.Widgets,
	}

	// 组装 HTML
	htmlContent := components.AssembleScreenPage(bp)

	// 保存 config（包含 blueprint + type）
	configMap := map[string]interface{}{
		"type":      "screen",
		"blueprint": bp,
	}
	configJSON := toJSON(configMap)

	app := &App{
		ID:          appID,
		Owner:       username,
		Name:        req.Name,
		Slug:        req.Slug,
		Title:       appTitle,
		Description: req.Description,
		HTML:        htmlContent,
		Config:      configJSON,
		IsPublic:    true, // 大屏默认公开
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := sqlSaveApp(app); err != nil {
		log.Printf("[大屏] 创建失败: %v", err)
		apiError(w, "创建大屏失败", http.StatusInternalServerError, "internal_error")
		return
	}

	log.Printf("[大屏] 用户 %s 创建大屏 %s (slug: %s)", username, appID, req.Slug)

	apiSuccess(w, map[string]interface{}{
		"screen": app,
	})
}

// handleScreenDetail 处理单个大屏的 CRUD
func handleScreenDetail(w http.ResponseWriter, r *http.Request) {
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "")
		return
	}

	path := r.URL.Path
	parts := strings.Split(path, "/")
	if len(parts) < 5 || parts[4] == "" {
		apiBadRequest(w, "缺少大屏 ID")
		return
	}
	screenID := parts[4]

	switch r.Method {
	case http.MethodGet:
		handleGetScreen(w, r, username, screenID)
	case http.MethodPut:
		handleUpdateScreen(w, r, username, screenID)
	case http.MethodDelete:
		handleDeleteApp(w, r, username, screenID) // 复用 app 删除逻辑
	default:
		apiMethodNotAllowed(w)
	}
}

func handleGetScreen(w http.ResponseWriter, r *http.Request, username string, screenID string) {
	app, err := sqlGetApp(screenID)
	if err != nil || app == nil {
		apiNotFound(w, "大屏不存在")
		return
	}

	// 解析 blueprint
	var bp *components.ScreenBlueprint
	if app.Config != "" {
		var cfg map[string]interface{}
		if json.Unmarshal([]byte(app.Config), &cfg) == nil {
			if bpRaw, ok := cfg["blueprint"]; ok {
				bpJSON, _ := json.Marshal(bpRaw)
				bp = &components.ScreenBlueprint{}
				json.Unmarshal(bpJSON, bp)
			}
		}
	}

	apiSuccess(w, map[string]interface{}{
		"screen":    app,
		"blueprint": bp,
	})
}

func handleUpdateScreen(w http.ResponseWriter, r *http.Request, username string, screenID string) {
	app, err := sqlGetApp(screenID)
	if err != nil || app == nil {
		apiNotFound(w, "大屏不存在")
		return
	}
	if app.Owner != username {
		apiForbidden(w, "无权修改此大屏")
		return
	}

	var req struct {
		Name        string                   `json:"name"`
		Slug        string                   `json:"slug"`
		Title       string                   `json:"title"`
		Description string                   `json:"description"`
		Theme       string                   `json:"theme"`
		ShowMap     *bool                    `json:"show_map"`
		MapRegion   string                   `json:"map_region"`
		GridCols    int                      `json:"grid_cols"`
		GridRows    int                      `json:"grid_rows"`
		Widgets     []components.ScreenWidget `json:"widgets"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apiBadRequest(w, "无效的请求体")
		return
	}

	// 从现有 config 解析 blueprint
	var bp components.ScreenBlueprint
	if app.Config != "" {
		var cfg map[string]interface{}
		if json.Unmarshal([]byte(app.Config), &cfg) == nil {
			if bpRaw, ok := cfg["blueprint"]; ok {
				bpJSON, _ := json.Marshal(bpRaw)
				json.Unmarshal(bpJSON, &bp)
			}
		}
	}

	if req.Name != "" {
		app.Name = req.Name
	}
	if req.Title != "" {
		app.Title = req.Title
		bp.Title = req.Title
	}
	if req.Description != "" {
		app.Description = req.Description
		bp.Description = req.Description
	}
	if req.Theme != "" {
		bp.Theme = req.Theme
	}
	if req.ShowMap != nil {
		bp.ShowMap = *req.ShowMap
	}
	if req.MapRegion != "" {
		bp.MapRegion = req.MapRegion
	}
	if req.GridCols > 0 {
		bp.GridCols = req.GridCols
	}
	if req.GridRows > 0 {
		bp.GridRows = req.GridRows
	}
	if req.Widgets != nil {
		bp.Widgets = req.Widgets
	}

	// 重新组装 HTML
	app.HTML = components.AssembleScreenPage(bp)

	// 更新 config
	configMap := map[string]interface{}{
		"type":      "screen",
		"blueprint": bp,
	}
	app.Config = toJSON(configMap)
	app.UpdatedAt = time.Now()

	if err := sqlSaveApp(app); err != nil {
		log.Printf("[大屏] 更新失败: %v", err)
		apiError(w, "更新大屏失败", http.StatusInternalServerError, "internal_error")
		return
	}

	log.Printf("[大屏] 用户 %s 更新大屏 %s", username, screenID)

	apiSuccess(w, map[string]interface{}{
		"screen": app,
	})
}

// handleScreenPreview 大屏预览（无需认证）
// GET /screen/{slug}
func handleScreenPreview(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	parts := strings.Split(path, "/")
	if len(parts) < 3 || parts[2] == "" {
		http.Error(w, "缺少大屏 slug", http.StatusBadRequest)
		return
	}
	slug := parts[2]

	app, err := sqlGetAppBySlug(slug)
	if err != nil || app == nil {
		http.Error(w, "大屏不存在", http.StatusNotFound)
		return
	}

	// 检查是否是大屏类型
	isScreen := false
	if app.Config != "" {
		var cfg map[string]interface{}
		if json.Unmarshal([]byte(app.Config), &cfg) == nil {
			if t, ok := cfg["type"].(string); ok && t == "screen" {
				isScreen = true
			}
		}
	}

	if !isScreen {
		// 不是大屏，走普通 app 逻辑
		handleAppPublic(w, r)
		return
	}

	// 如果 HTML 为空或需要重新生成
	htmlContent := app.HTML
	if htmlContent == "" {
		var bp components.ScreenBlueprint
		if app.Config != "" {
			var cfg map[string]interface{}
			if json.Unmarshal([]byte(app.Config), &cfg) == nil {
				if bpRaw, ok := cfg["blueprint"]; ok {
					bpJSON, _ := json.Marshal(bpRaw)
					json.Unmarshal(bpJSON, &bp)
				}
			}
		}
		htmlContent = components.AssembleScreenPage(bp)
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(htmlContent))
}

// handleScreenThemes 返回可用主题列表
func handleScreenThemes(w http.ResponseWriter, r *http.Request) {
	themes := []map[string]interface{}{
		{"id": "linear-dark", "name": "Linear Dark", "mode": "dark", "preview": "#0d1117"},
		{"id": "vercel-light", "name": "Vercel Light", "mode": "light", "preview": "#ffffff"},
		{"id": "mission-control", "name": "Mission Control", "mode": "dark", "preview": "#0a0e17"},
		{"id": "stripe-dark", "name": "Stripe Dark", "mode": "dark", "preview": "#0a0f1a"},
	}
	apiSuccess(w, map[string]interface{}{
		"themes": themes,
	})
}

// handleScreenEditorPage 大屏编辑器页面（页面本身公开，API 调用由 JS 端 fetchWithAuth 认证）
func handleScreenEditorPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(screenEditorHTML))
}

const screenEditorHTML = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="linear-dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>大屏编辑器 - DataToolbox</title>
  <link rel="stylesheet" href="/components/themes.css">
  <link rel="stylesheet" href="/apps/screen-editor/screen-editor.css?v=2026061701">
</head>
<body>
<!-- 顶部工具栏 -->
<header class="editor-toolbar">
  <div class="toolbar-left">
    <a href="/" class="toolbar-back" title="返回主页">← 返回</a>
    <span class="toolbar-logo">📊 大屏编辑器</span>
    <input type="text" class="toolbar-name" id="screenName" placeholder="大屏名称" value="未命名大屏">
    <span class="toolbar-slug">/screen/<input type="text" id="screenSlug" placeholder="my-screen" value=""></span>
  </div>
  <div class="toolbar-center">
    <div class="theme-switcher" id="themeSwitcher">
      <button class="theme-btn active" data-theme="linear-dark">Linear</button>
      <button class="theme-btn" data-theme="vercel-light">Vercel</button>
      <button class="theme-btn" data-theme="mission-control">Mission</button>
      <button class="theme-btn" data-theme="stripe-dark">Stripe</button>
    </div>
  </div>
  <div class="toolbar-right">
    <label class="toolbar-toggle" title="显示地图底图">
      <input type="checkbox" id="showMap">
      <span>地图</span>
    </label>
    <select id="mapRegion" class="toolbar-select">
      <option value="china">中国</option>
      <option value="world">世界</option>
    </select>
    <button class="toolbar-btn" id="btnPreview">预览</button>
    <button class="toolbar-btn primary" id="btnSave">保存</button>
  </div>
</header>

<!-- 主体三栏布局 -->
<div class="editor-layout">
  <!-- 左侧：组件面板 -->
  <aside class="editor-panel" id="componentPanel">
    <div class="panel-header">组件</div>
    <div class="panel-body" id="componentList">
      <!-- JS动态生成 -->
    </div>
  </aside>

  <!-- 中间：画布 -->
  <main class="editor-canvas-wrapper">
    <div class="canvas-controls">
      <span class="canvas-label">画布 12×8</span>
      <button class="canvas-btn layout-btn" onclick="autoLayout('tile')" title="等宽网格排列">▦</button>
      <button class="canvas-btn layout-btn" onclick="autoLayout('masonry')" title="瀑布流">▥</button>
      <button class="canvas-btn layout-btn" onclick="autoLayout('snap')" title="吸附网格">⌸</button>
      <button class="canvas-btn" id="btnClear" title="清空画布">清空</button>
    </div>
    <div class="editor-canvas" id="screenCanvas">
      <!-- JS 动态生成网格 + widget -->
      <div class="canvas-grid" id="canvasGrid"></div>
      <div class="canvas-widgets" id="canvasWidgets"></div>
    </div>
  </main>

  <!-- 右侧：属性面板 -->
  <aside class="editor-panel" id="propsPanel">
    <div class="panel-header">属性</div>
    <div class="panel-body" id="propsContent">
      <p class="panel-hint">选择画布上的组件来编辑属性</p>
    </div>
  </aside>
</div>

<script src="/components/themes.css"></script>
<script src="/apps/screen-editor/screen-editor.js?v=2026061701"></script>
</body>
</html>`

package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

// ==================== V1 版本 Handler ====================

// handleLogout 登出
func handleLogout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "已登出",
	})
}

// handleDatabaseDetailV1 数据库详情（V1）
func handleDatabaseDetailV1(w http.ResponseWriter, r *http.Request) {
	// 提取 ID
	path := r.URL.Path
	id := strings.TrimPrefix(path, "/api/v1/databases/")
	if id == "" {
		http.Error(w, "缺少数据库 ID", http.StatusBadRequest)
		return
	}
	
	// 调用原有 handler（复用逻辑）
	r.URL.Path = "/api/v1/databases/" + id
	handleDatabaseDetail(w, r)
}

// handleOpenAPIDetail 开放接口详情
func handleOpenAPIDetail(w http.ResponseWriter, r *http.Request) {
	// 提取 ID
	path := r.URL.Path
	id := strings.TrimPrefix(path, "/api/v1/openapis/")
	if id == "" {
		http.Error(w, "缺少接口 ID", http.StatusBadRequest)
		return
	}
	
	// 调用原有 handler（复用逻辑）
	r.URL.Path = "/api/v1/openapis/" + id
	handleApiDetail(w, r)
}

// handleMCPTools MCP 工具列表
func handleMCPTools(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	tools := GetMCPToolsList()
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    tools,
	})
}

// handleMCPToolDetail MCP 工具详情
func handleMCPToolDetail(w http.ResponseWriter, r *http.Request) {
	// 提取工具名
	path := r.URL.Path
	name := strings.TrimPrefix(path, "/api/v1/mcp/tools/")
	if name == "" {
		http.Error(w, "缺少工具名", http.StatusBadRequest)
		return
	}
	
	tool := GetMCPToolDetail(name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    tool,
	})
}

// handleGovernanceTaskDetailV1 治理任务详情（V1）
func handleGovernanceTaskDetailV1(w http.ResponseWriter, r *http.Request) {
	// 提取 ID
	path := r.URL.Path
	id := strings.TrimPrefix(path, "/api/v1/gov/tasks/")
	if id == "" {
		http.Error(w, "缺少任务 ID", http.StatusBadRequest)
		return
	}
	
	// 调用原有 handler
	r.URL.Path = "/api/v1/gov/tasks/" + id
	handleGovernanceTaskDetail(w, r)
}

// handleGovernancePresets 治理预设列表
func handleGovernancePresets(w http.ResponseWriter, r *http.Request) {
	presets := governancePresetDefinitions()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    presets,
	})
}

// handleGovernanceShareV1 分享 API（V1）
func handleGovernanceShareV1(w http.ResponseWriter, r *http.Request) {
	// 提取 token
	path := r.URL.Path
	token := strings.TrimPrefix(path, "/api/v1/share/")
	if token == "" {
		http.Error(w, "缺少分享 token", http.StatusBadRequest)
		return
	}
	
	// 调用原有 handler
	r.URL.Path = "/api/v1/share/" + token
	handleGovernanceShare(w, r)
}

// GetMCPToolsList 获取 MCP 工具列表
func GetMCPToolsList() []map[string]interface{} {
	return []map[string]interface{}{
		{"name": "list_databases", "description": "列出所有数据库"},
		{"name": "get_tables", "description": "获取数据库表列表"},
		{"name": "describe_table", "description": "获取表结构"},
		{"name": "execute_sql", "description": "执行 SQL"},
		{"name": "list_apis", "description": "列出开放接口"},
		{"name": "create_api", "description": "创建开放接口"},
		{"name": "ask_user", "description": "询问用户"},
		{"name": "list_apps", "description": "列出应用广场所有应用"},
		{"name": "get_app", "description": "获取应用详情（含代码）"},
		{"name": "design_theme", "description": "查询可用设计方向和配色方案。创建应用前先调用此工具获取设计灵感"},
		{"name": "create_app", "description": "【重要】创建应用前必须先调用 ask_user 工具让用户确认！创建纯前端应用（HTML+CSS+JS），发布后可通过 /app/{slug} 访问"},
		{"name": "update_app", "description": "更新应用：修改标题/网址/代码等"},
		{"name": "delete_app", "description": "删除应用"},
	}
}

// GetMCPToolDetail 获取 MCP 工具详情
func GetMCPToolDetail(name string) map[string]interface{} {
	tools := GetMCPToolsList()
	for _, t := range tools {
		if t["name"] == name {
			return t
		}
	}
	return nil
}
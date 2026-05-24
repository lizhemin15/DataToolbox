// Agent 服务：
//   HTTP 模式（推荐）：MCP 服务内嵌在 HTTP 服务器中，使用 go-sdk StreamableHTTPHandler，
//     PicoClaw 通过 streamable-http transport 连接，自动发现工具。
//   Stdio 模式（备用）：DATA_ONTOLOGY_BASE_URL=http://... DATA_ONTOLOGY_API_KEY=dok_xxx ./datatoolbox-server mcp

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/YOUR_USERNAME/DataToolbox/agent"
	"github.com/YOUR_USERNAME/DataToolbox/components"
	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// mcpLoopbackAddr 由 server.go 的 main() 在监听前设置
var mcpLoopbackAddr = "http://127.0.0.1:8080"

const mcpServerName = "data-ontology"
const mcpServerVersion = "1.0.0"

// ─── SQL 安全检查 ───────────────────────────────────────────────────────────

// 默认危险 SQL 关键词
var defaultDangerousKeywords = []string{
	"DROP", "DELETE", "TRUNCATE", "ALTER", "GRANT", "REVOKE",
	"CREATE USER", "DROP USER", "CREATE ROLE", "DROP ROLE",
	"SHUTDOWN", "KILL", "EXEC", "EXECUTE",
}

// checkSQLSafety 检查 SQL 是否符合安全配置
// 返回 (是否允许, 错误信息)
func checkSQLSafety(sql string) (bool, string) {
	dataOntologyMu.RLock()
	config := dataOntologyMCPSafeConfig
	dataOntologyMu.RUnlock()

	if config == nil {
		return true, "" // 无配置则允许
	}

	upperSQL := strings.ToUpper(sql)

	// 1. 检查只读模式
	if config.ReadOnlyMode {
		// 只允许 SELECT, SHOW, DESCRIBE, EXPLAIN
		allowed := []string{"SELECT", "SHOW", "DESCRIBE", "DESC ", "EXPLAIN"}
		isAllowed := false
		for _, prefix := range allowed {
			if strings.HasPrefix(strings.TrimSpace(upperSQL), prefix) {
				isAllowed = true
				break
			}
		}
		if !isAllowed {
			return false, "只读模式已启用，仅允许 SELECT/SHOW/DESCRIBE/EXPLAIN 查询"
		}
	}

	// 2. 检查危险操作阻止
	if config.BlockDangerous {
		for _, keyword := range defaultDangerousKeywords {
			if strings.Contains(upperSQL, keyword) {
				return false, fmt.Sprintf("危险操作已被阻止: 包含关键词 %s", keyword)
			}
		}
	}

	// 3. 检查自定义阻止关键词
	for _, keyword := range config.BlockedKeywords {
		if keyword != "" && strings.Contains(upperSQL, strings.ToUpper(keyword)) {
			return false, fmt.Sprintf("SQL 包含被阻止的关键词: %s", keyword)
		}
	}

	// 4. 检查表白名单（如果有配置）
	if len(config.AllowedTables) > 0 {
		// 简单检查：从 SQL 中提取表名并验证
		// 这里使用简单的正则匹配，实际生产环境可能需要更复杂的 SQL 解析
		for _, table := range config.AllowedTables {
			if table != "" && strings.Contains(upperSQL, strings.ToUpper(table)) {
				return true, "" // 表在白名单中
			}
		}
		// 如果有白名单但没匹配到任何表，检查是否是系统查询
		systemPrefixes := []string{"SHOW", "DESCRIBE", "DESC ", "EXPLAIN", "SELECT 1", "SELECT NOW", "SELECT VERSION"}
		for _, prefix := range systemPrefixes {
			if strings.HasPrefix(strings.TrimSpace(upperSQL), prefix) {
				return true, "" // 允许系统查询
			}
		}
		return false, "SQL 涉及的表不在允许的白名单中"
	}

	return true, ""
}

// ─── HTTP 客户端（供 HTTP 模式和 Stdio 模式共用） ────────────────────────────

type mcpClient struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

func newMCPClient() (*mcpClient, error) {
	baseURL := os.Getenv("DATA_ONTOLOGY_BASE_URL")
	if baseURL == "" {
		baseURL = mcpLoopbackAddr // 使用服务实际监听地址
	}
	baseURL = strings.TrimSuffix(baseURL, "/")
	
	// 优先使用环境变量，其次自动获取 admin 用户的 API Key
	apiKey := os.Getenv("DATA_ONTOLOGY_API_KEY")
	if apiKey == "" {
		// 自动获取 admin 用户的 API Key（开箱即用）
		dataOntologyMu.Lock()
		adminUser, ok := dataOntologyUsers["admin"]
		if ok && adminUser != nil && adminUser.ApiKey != "" {
			apiKey = adminUser.ApiKey
		}
		dataOntologyMu.Unlock()
	}
	if apiKey == "" {
		// 如果 admin 没有 API Key，自动生成一个
		dataOntologyMu.Lock()
		adminUser, ok := dataOntologyUsers["admin"]
		if ok && adminUser != nil {
			adminUser.ApiKey = "dok_" + uuid.New().String()
			apiKey = adminUser.ApiKey
			dataOntologyMu.Unlock()
			saveDataOntologyStore()
			log.Printf("[MCP] 自动生成 admin API Key: %s", apiKey[:12]+"...")
		} else {
			dataOntologyMu.Unlock()
			return nil, fmt.Errorf("无法获取 API Key：admin 用户不存在")
		}
	}
	return &mcpClient{
		baseURL: baseURL,
		apiKey:  apiKey,
		client:  &http.Client{Timeout: HTTPClientTimeout},
	}, nil
}

func (c *mcpClient) do(method, path string, body []byte) ([]byte, error) {
	reqURL := c.baseURL + path
	log.Printf("[MCP] 请求: %s %s", method, reqURL)
	var req *http.Request
	var err error
	if body != nil {
		req, err = http.NewRequest(method, reqURL, bytes.NewReader(body))
	} else {
		req, err = http.NewRequest(method, reqURL, nil)
	}
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Call", "datatoolbox-agent")
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API 返回 %d: %s", resp.StatusCode, string(data))
	}
	return data, nil
}

// newLoopbackMCPClient 创建回环 MCP 客户端（用于 HTTP 模式的工具处理函数）
func newLoopbackMCPClient(apiKey string) *mcpClient {
	return &mcpClient{
		baseURL: strings.TrimSuffix(mcpLoopbackAddr, "/"),
		apiKey:  apiKey,
		client:  &http.Client{Timeout: HTTPClientTimeout},
	}
}

// ─── HTTP 模式：使用 go-sdk StreamableHTTPHandler ────────────────────────────
// 替换旧的手写 JSON-RPC 端点，使用 go-sdk 标准实现，兼容 PicoClaw 的 streamable-http transport。
// 使用 Stateless + JSONResponse 模式：每个请求创建临时会话，返回 application/json 响应。

// mcpOutput 已废弃 — 改用 any + nil 避免 go-sdk 双层序列化
// 旧: (*mcp.CallToolResult, any, error) → 新: (*mcp.CallToolResult, any, error)

// mcpTextResult 创建包含纯文本内容的 CallToolResult
// go-sdk AddTool 看到 out=nil 时不再序列化到 structuredContent
func mcpTextResult(text string) *mcp.CallToolResult {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: text}},
	}
}

// ─── 工具输入类型定义 ─────────────────────────────────────────────────────────

type listDatabasesIn struct{}

type getTablesIn struct {
	DatabaseID string `json:"database_id" jsonschema:"数据库 ID"`
}

type describeTableIn struct {
	DatabaseID string `json:"database_id" jsonschema:"数据库 ID"`
	TableName  string `json:"table_name" jsonschema:"表名"`
}

type executeSQLIn struct {
	DatabaseID string        `json:"database_id" jsonschema:"数据库 ID"`
	SQL        string        `json:"sql" jsonschema:"要执行的 SQL 语句"`
	Params     []interface{} `json:"params,omitempty" jsonschema:"SQL 占位符参数（可选）"`
}

type listApisIn struct{}

type getApiDetailIn struct {
	ApiID string `json:"api_id" jsonschema:"接口 ID"`
}

type callApiIn struct {
	ApiID  string                 `json:"api_id" jsonschema:"接口 ID"`
	Params map[string]interface{} `json:"params,omitempty" jsonschema:"请求参数，与接口 SQL 中占位符对应"`
}

type searchTablesIn struct {
	Query    string `json:"query" jsonschema:"搜索关键词"`
	Database string `json:"database,omitempty" jsonschema:"数据库名称（可选，用于限定搜索范围）"`
}

type getDbSchemaIn struct {
	DatabaseID string `json:"database_id" jsonschema:"数据库 ID"`
}

type getDbSQLHintsIn struct {
	DatabaseID string `json:"database_id" jsonschema:"数据库 ID"`
}

type createApiIn struct {
	Name          string                 `json:"name" jsonschema:"接口名称"`
	Path          string                 `json:"path" jsonschema:"接口路径（如 /api/users）"`
	Method        string                 `json:"method" jsonschema:"HTTP 方法（GET/POST 等）"`
	SQL           string                 `json:"sql" jsonschema:"接口关联的 SQL 语句"`
	Description   string                 `json:"description,omitempty" jsonschema:"接口描述"`
	Database      string                 `json:"database" jsonschema:"数据库名称"`
	DefaultParams map[string]interface{} `json:"default_params,omitempty" jsonschema:"默认参数定义"`
}

type executeApiIn struct {
	Path   string                 `json:"path" jsonschema:"接口路径（如 /users）"`
	Params map[string]interface{} `json:"params,omitempty" jsonschema:"查询参数"`
}

// ─── 预制组件工具输入类型 ─────────────────────────────────────────────────

type listComponentsIn struct {
	Category string `json:"category,omitempty" jsonschema:"按分类筛选（chart/kpi/table/map/filter），不传则返回全部"`
}

type previewAppIn struct {
	Title           string                   `json:"title" jsonschema:"required,应用标题"`
	Slug            string                   `json:"slug" jsonschema:"required,URL 标识"`
	Description     string                   `json:"description,omitempty" jsonschema:"应用描述"`
	Icon            string                   `json:"icon,omitempty" jsonschema:"图标 emoji"`
	DesignDirection string                   `json:"design_direction,omitempty" jsonschema:"设计方向"`
	PrimaryColor    string                   `json:"primary_color,omitempty" jsonschema:"主色调 HEX 值"`
	Components      []components.ComponentInstance `json:"components" jsonschema:"required,组件实例列表，每个包含 component_id 和 config"`
}

type createAppFromBlueprintIn struct {
	Title           string                   `json:"title" jsonschema:"required,应用标题"`
	Slug            string                   `json:"slug" jsonschema:"required,URL 标识（如 sales-dashboard），只能含字母数字中划线"`
	Description     string                   `json:"description,omitempty" jsonschema:"应用描述"`
	Icon            string                   `json:"icon,omitempty" jsonschema:"图标 emoji（如 📊、🗺️）"`
	DesignDirection string                   `json:"design_direction,omitempty" jsonschema:"设计方向：minimal/corporate/vibrant/elegant/playful/dark/nature/brutalist"`
	PrimaryColor    string                   `json:"primary_color,omitempty" jsonschema:"主色调 HEX（如 #4F46E5）"`
	IsPublic        bool                     `json:"is_public,omitempty" jsonschema:"是否公开"`
	Confirmed       bool                     `json:"confirmed,omitempty" jsonschema:"用户确认后设为 true 正式创建应用；未确认时调用只生成预览"`
	Components      []components.ComponentInstance `json:"components" jsonschema:"required,组件实例列表，每个含 component_id 和 config。可用组件ID：chart-bar(柱状图)、chart-line(折线图)、chart-pie(饼图)、chart-area(面积图)、chart-gauge(仪表盘)、data-table(数据表格)、filter-bar(筛选栏)、kpi-card(KPI卡片)、map-scatter(地图散点)、timeline(时间线)"`
}

// ─── 应用管理工具输入类型 ─────────────────────────────────────────────────────

type listAppsIn struct{}

type designThemeIn struct {
	Direction string `json:"direction,omitempty" jsonschema:"查询指定设计方向的详细信息（可选），不传则返回所有设计方向列表"`
}

type updateAppIn struct {
	ID              string                 `json:"id" jsonschema:"应用 ID"`
	Title           string                 `json:"title,omitempty" jsonschema:"新的显示标题"`
	Slug            string                 `json:"slug,omitempty" jsonschema:"新的 URL 标识"`
	Description     string                 `json:"description,omitempty" jsonschema:"新的描述"`
	DesignDirection string                 `json:"design_direction,omitempty" jsonschema:"新的设计方向"`
	PrimaryColor    string                 `json:"primary_color,omitempty" jsonschema:"新的主色调 HEX 值"`
	Style           string                 `json:"style,omitempty" jsonschema:"新的视觉风格"`
	Visuals         string                 `json:"visuals,omitempty" jsonschema:"新的视觉资产规划"`
	HTML            string                 `json:"html,omitempty" jsonschema:"新的 HTML 代码"`
	CSS             string                 `json:"css,omitempty" jsonschema:"新的 CSS 代码"`
	JS              string                 `json:"js,omitempty" jsonschema:"新的 JavaScript 代码"`
	Files           map[string]interface{} `json:"files,omitempty" jsonschema:"新的附加文件列表"`
	IsPublic        *bool                  `json:"is_public,omitempty" jsonschema:"是否公开"`
}

type deleteAppIn struct {
	ID string `json:"id" jsonschema:"应用 ID"`
}

// ─── 工具处理函数（HTTP 模式和 Stdio 模式共用） ──────────────────────────────

func mcpListDatabases(ctx context.Context, req *mcp.CallToolRequest, _ listDatabasesIn) (*mcp.CallToolResult, any, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}
	data, err := cli.do(http.MethodGet, "/api/v1/databases", nil)
	if err != nil {
		return nil, nil, err
	}
	return mcpTextResult(string(data)), nil, nil
}

func mcpGetTables(ctx context.Context, req *mcp.CallToolRequest, in getTablesIn) (*mcp.CallToolResult, any, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}
	data, err := cli.do(http.MethodGet, "/api/v1/databases/"+in.DatabaseID, nil)
	if err != nil {
		return nil, nil, err
	}
	return mcpTextResult(string(data)), nil, nil
}

func mcpDescribeTable(ctx context.Context, req *mcp.CallToolRequest, in describeTableIn) (*mcp.CallToolResult, any, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}
	
	// 先获取数据库类型
	dbData, err := cli.do(http.MethodGet, "/api/v1/databases/"+in.DatabaseID, nil)
	if err != nil {
		return nil, nil, err
	}
	var dbInfo struct {
		Success bool `json:"success"`
		Data    struct {
			Type string `json:"type"`
		} `json:"data"`
	}
	if err := json.Unmarshal(dbData, &dbInfo); err != nil {
		return nil, nil, err
	}
	
	// 根据数据库类型选择表结构查询 SQL
	var sql string
	tableName := strings.Trim(in.TableName, "\"`'") // 去掉可能的引号
	switch dbInfo.Data.Type {
	case "dm", "DM", "达梦":
		// 达梦数据库使用 USER_TAB_COLUMNS
		sql = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_DEFAULT FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", tableName)
	case "mysql", "MySQL":
		sql = "DESCRIBE `" + tableName + "`"
	case "postgres", "postgresql", "PostgreSQL":
		sql = fmt.Sprintf("SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = '%s' ORDER BY ordinal_position", tableName)
	default:
		// 默认尝试 DESCRIBE
		sql = "DESCRIBE `" + tableName + "`"
	}
	
	body, _ := json.Marshal(map[string]interface{}{
		"database_id": in.DatabaseID,
		"sql":         sql,
	})
	data, err := cli.do(http.MethodPost, "/api/v1/gov/execute-sql", body)
	if err != nil {
		return nil, nil, err
	}
	return mcpTextResult(string(data)), nil, nil
}

func mcpExecuteSQL(ctx context.Context, req *mcp.CallToolRequest, in executeSQLIn) (*mcp.CallToolResult, any, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}
	// SQL 安全检查
	if allowed, reason := checkSQLSafety(in.SQL); !allowed {
		return nil, nil, fmt.Errorf("SQL 安全检查失败: %s", reason)
	}
	body, _ := json.Marshal(map[string]interface{}{
		"database_id": in.DatabaseID,
		"sql":         in.SQL,
		"params":      in.Params,
	})
	data, err := cli.do(http.MethodPost, "/api/v1/gov/execute-sql", body)
	if err != nil {
		return nil, nil, err
	}
	return mcpTextResult(string(data)), nil, nil
}

func mcpListApis(ctx context.Context, req *mcp.CallToolRequest, _ listApisIn) (*mcp.CallToolResult, any, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}
	data, err := cli.do(http.MethodGet, "/api/v1/openapis", nil)
	if err != nil {
		return nil, nil, err
	}
	return mcpTextResult(string(data)), nil, nil
}

func mcpGetApiDetail(ctx context.Context, req *mcp.CallToolRequest, in getApiDetailIn) (*mcp.CallToolResult, any, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}
	data, err := cli.do(http.MethodGet, "/api/v1/openapis/"+in.ApiID, nil)
	if err != nil {
		return nil, nil, err
	}
	return mcpTextResult(string(data)), nil, nil
}

func mcpCallApi(ctx context.Context, req *mcp.CallToolRequest, in callApiIn) (*mcp.CallToolResult, any, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}
	body, _ := json.Marshal(map[string]interface{}{"params": in.Params})
	if body == nil {
		body = []byte(`{"params":{}}`)
	}
	data, err := cli.do(http.MethodPost, "/api/v1/openapis/"+in.ApiID+"/test", body)
	if err != nil {
		return nil, nil, err
	}
	return mcpTextResult(string(data)), nil, nil
}

func mcpSearchTables(ctx context.Context, req *mcp.CallToolRequest, in searchTablesIn) (*mcp.CallToolResult, any, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}
	reqBody, _ := json.Marshal(map[string]interface{}{
		"query":    in.Query,
		"database": in.Database,
	})
	data, err := cli.do(http.MethodPost, "/api/v1/retrieval/search", reqBody)
	if err != nil {
		return nil, nil, err
	}
	return mcpTextResult(string(data)), nil, nil
}

func mcpGetDbSchema(ctx context.Context, req *mcp.CallToolRequest, in getDbSchemaIn) (*mcp.CallToolResult, any, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}
	data, err := cli.do(http.MethodGet, "/api/v1/databases/"+in.DatabaseID, nil)
	if err != nil {
		return nil, nil, err
	}
	return mcpTextResult(string(data)), nil, nil
}

func mcpGetDbSQLHints(ctx context.Context, req *mcp.CallToolRequest, in getDbSQLHintsIn) (*mcp.CallToolResult, any, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}
	// 先获取数据库信息以提取类型
	data, err := cli.do(http.MethodGet, "/api/v1/databases/"+in.DatabaseID, nil)
	if err != nil {
		return nil, nil, err
	}
	// 从返回数据中提取数据库类型，生成方言提示
	var dbInfo struct {
		Data struct {
			Type string `json:"type"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &dbInfo); err != nil {
		return nil, nil, fmt.Errorf("解析数据库信息失败: %w", err)
	}
	dbType := strings.ToLower(dbInfo.Data.Type)
	hints := buildSQLDialectHints(dbType, dbInfo.Data.Name)
	hintsData, _ := json.Marshal(hints)
	return mcpTextResult(string(hintsData)), nil, nil
}

func mcpCreateApi(ctx context.Context, req *mcp.CallToolRequest, in createApiIn) (*mcp.CallToolResult, any, error) {
	// 强制 HITL 确认：创建接口前必须先调用 ask_user 让用户确认配置
	if !agent.IsHITLConfirmed("default") {
		confirmMsg := fmt.Sprintf("⚠️ 创建接口前必须先让用户确认！请先调用 ask_user 工具（interaction_type=\"form\"），让用户审核以下配置后再创建：\n- 名称: %s\n- 路径: %s\n- 方法: %s\n- SQL: %s\n- 数据库: %s\n- 描述: %s", in.Name, in.Path, in.Method, in.SQL, in.Database, in.Description)
		return mcpTextResult(confirmMsg), nil, fmt.Errorf("HITL确认缺失: 必须先调用ask_user工具让用户确认")
	}

	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}
	// 通过数据库名称查找 database_id
	dbsData, err := cli.do(http.MethodGet, "/api/v1/databases", nil)
	if err != nil {
		return nil, nil, fmt.Errorf("获取数据库列表失败: %w", err)
	}
	var dbsResp struct {
		Databases []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"databases"`
	}
	if err := json.Unmarshal(dbsData, &dbsResp); err != nil {
		return nil, nil, fmt.Errorf("解析数据库列表失败: %w", err)
	}
	var databaseID string
	for _, db := range dbsResp.Databases {
		if db.Name == in.Database {
			databaseID = db.ID
			break
		}
	}
	if databaseID == "" {
		return nil, nil, fmt.Errorf("未找到名为 %q 的数据库", in.Database)
	}
	reqBody, _ := json.Marshal(map[string]interface{}{
		"name":           in.Name,
		"path":           in.Path,
		"method":         in.Method,
		"sql":            in.SQL,
		"description":    in.Description,
		"database_id":    databaseID,
		"default_params": in.DefaultParams,
	})
	data, err := cli.do(http.MethodPost, "/api/v1/openapis", reqBody)
	if err != nil {
		return nil, nil, err
	}
	return mcpTextResult(string(data)), nil, nil
}

func mcpExecuteApi(ctx context.Context, req *mcp.CallToolRequest, in executeApiIn) (*mcp.CallToolResult, any, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}
	// 构建带查询参数的 URL
	apiPath := in.Path
	if !strings.HasPrefix(apiPath, "/") {
		apiPath = "/" + apiPath
	}
	if len(in.Params) > 0 {
		params := url.Values{}
		for k, v := range in.Params {
			params.Set(k, fmt.Sprintf("%v", v))
		}
		apiPath += "?" + params.Encode()
	}
	data, err := cli.do(http.MethodGet, apiPath, nil)
	if err != nil {
		return nil, nil, err
	}
	return mcpTextResult(string(data)), nil, nil
}

// ─── 应用管理工具处理函数 ─────────────────────────────────────────────────────

// designThemes 内置设计方向配置
var designThemes = map[string]map[string]interface{}{
	"minimal": {
		"name": "极简留白", "icon": "⬜",
		"description": "大量留白，极少元素，内容即设计。适合信息展示、个人作品集。",
		"primary_colors": []string{"#1a1a1a", "#4a5568", "#2d3748"},
		"css_vars": map[string]string{"--bg": "#ffffff", "--bg-secondary": "#fafafa", "--text": "#1a1a1a", "--border": "#f0f0f0", "--radius": "12px"},
		"style_keywords": []string{"whitespace-heavy", "monochrome", "thin-typography", "minimal-shadows"},
	},
	"corporate": {
		"name": "商务专业", "icon": "🏢",
		"description": "稳重配色，清晰层级，数据驱动。适合企业后台、数据仪表盘、管理系统。",
		"primary_colors": []string{"#2563EB", "#0891B2", "#4F46E5"},
		"css_vars": map[string]string{"--bg": "#ffffff", "--bg-secondary": "#f8fafc", "--text": "#1e293b", "--border": "#e2e8f0", "--radius": "8px"},
		"style_keywords": []string{"clean-layout", "card-grid", "table-focused", "status-badges"},
	},
	"vibrant": {
		"name": "活力多彩", "icon": "🎨",
		"description": "明亮色彩，渐变装饰，动态元素。适合营销页面、活动推广、创意展示。",
		"primary_colors": []string{"#F59E0B", "#EC4899", "#8B5CF6"},
		"css_vars": map[string]string{"--bg": "#fefce8", "--bg-secondary": "#fef9c3", "--text": "#1a1a1a", "--border": "#fde68a"},
		"style_keywords": []string{"gradient-hero", "bold-cta", "animated-elements", "color-blocks"},
	},
	"elegant": {
		"name": "优雅精致", "icon": "✨",
		"description": "柔和色调，精致排版，微妙动效。适合品牌展示、产品目录、高端内容。",
		"primary_colors": []string{"#7C3AED", "#BE185D", "#6D28D9"},
		"css_vars": map[string]string{"--bg": "#faf5ff", "--bg-secondary": "#f3e8ff", "--text": "#1e1b4b", "--border": "#e9d5ff", "--radius": "16px"},
		"style_keywords": []string{"glassmorphism", "subtle-gradients", "serif-headings", "refined-spacing"},
	},
	"playful": {
		"name": "趣味卡通", "icon": "🎮",
		"description": "圆角元素，趣味图标，明亮配色。适合教育应用、儿童产品、游戏化界面。",
		"primary_colors": []string{"#F97316", "#10B981", "#3B82F6"},
		"css_vars": map[string]string{"--bg": "#fff7ed", "--bg-secondary": "#ffedd5", "--text": "#1a1a1a", "--border": "#fed7aa", "--radius": "20px"},
		"style_keywords": []string{"bouncy-animations", "emoji-rich", "rounded-everything", "bright-palette"},
	},
	"dark": {
		"name": "暗色科技", "icon": "🌙",
		"description": "深色背景，霓虹强调，科技感强。适合开发者工具、数据监控、技术产品。",
		"primary_colors": []string{"#22D3EE", "#A78BFA", "#34D399"},
		"css_vars": map[string]string{"--bg": "#0f172a", "--bg-secondary": "#1e293b", "--text": "#f1f5f9", "--border": "#334155", "--radius": "8px"},
		"style_keywords": []string{"neon-accents", "glow-effects", "monospace-code", "terminal-aesthetic"},
	},
	"nature": {
		"name": "自然有机", "icon": "🌿",
		"description": "绿色基调，有机形状，自然纹理。适合环保项目、健康产品、生活方式。",
		"primary_colors": []string{"#059669", "#16A34A", "#0D9488"},
		"css_vars": map[string]string{"--bg": "#f0fdf4", "--bg-secondary": "#dcfce7", "--text": "#1a2e1a", "--border": "#bbf7d0"},
		"style_keywords": []string{"organic-shapes", "leaf-patterns", "soft-textures", "earth-tones"},
	},
	"brutalist": {
		"name": "粗野主义", "icon": "🧱",
		"description": "大胆排版，原始边框，反传统审美。适合艺术项目、实验性网站、创意工作室。",
		"primary_colors": []string{"#DC2626", "#000000", "#FACC15"},
		"css_vars": map[string]string{"--bg": "#ffffff", "--bg-secondary": "#f5f5f5", "--text": "#000000", "--border": "#000000", "--radius": "0px", "--shadow": "none"},
		"style_keywords": []string{"thick-borders", "raw-typography", "no-border-radius", "high-contrast"},
	},
}

// ─── 预制组件 MCP 工具 ───────────────────────────────────────────────────────

func mcpListComponents(ctx context.Context, req *mcp.CallToolRequest, in listComponentsIn) (*mcp.CallToolResult, any, error) {
	allComps := components.ListComponents()

	if in.Category != "" {
		if catComps, ok := allComps[in.Category]; ok {
			allComps = map[string][]*components.ComponentDef{in.Category: catComps}
		} else {
			return mcpTextResult(fmt.Sprintf("分类 %q 不存在，可用分类: chart, kpi, table, map, filter", in.Category)), nil, nil
		}
	}

	// 精简输出 — 包含配置概要
	type configFieldSummary struct {
		Key     string   `json:"key"`
		Label   string   `json:"label"`
		Type    string   `json:"type"`
		Default string   `json:"default,omitempty"`
		Options []string `json:"options,omitempty"`
	}
	type compSummary struct {
		ID          string               `json:"id"`
		Name        string               `json:"name"`
		Icon        string               `json:"icon"`
		Description string               `json:"description"`
		ConfigKeys  []configFieldSummary `json:"config_keys"`
	}
	result := map[string][]compSummary{}
	for cat, comps := range allComps {
		sums := []compSummary{}
		for _, c := range comps {
			keys := []configFieldSummary{}
			for k, s := range c.ConfigSchema {
				if s.Type == "list" {
					keys = append(keys, configFieldSummary{Key: k, Label: s.Label, Type: s.Type})
					continue
				}
				defVal := ""
				if s.Default != nil {
					defVal = fmt.Sprintf("%v", s.Default)
				}
				keys = append(keys, configFieldSummary{Key: k, Label: s.Label, Type: s.Type, Default: defVal, Options: s.Options})
			}
			sums = append(sums, compSummary{ID: c.ID, Name: c.Name, Icon: c.Icon, Description: c.Description, ConfigKeys: keys})
		}
		result[cat] = sums
	}

	data, _ := json.Marshal(result)
	return mcpTextResult(string(data)), nil, nil
}

func mcpPreviewApp(ctx context.Context, req *mcp.CallToolRequest, in previewAppIn) (*mcp.CallToolResult, any, error) {
	if len(in.Components) == 0 {
		return mcpTextResult("错误: components 列表不能为空，请至少添加一个组件"), nil, nil
	}

	// 验证组件 ID
	for i, c := range in.Components {
		def, ok := components.GetComponentDef(c.ComponentID)
		if !ok {
			return mcpTextResult(fmt.Sprintf("错误: 组件 %q 不存在（第 %d 个），请先调用 list_components 查看可用组件", c.ComponentID, i+1)), nil, nil
		}
		// 填充默认值
		if c.Config == nil {
			c.Config = map[string]interface{}{}
		}
		for k, schema := range def.ConfigSchema {
			if _, exists := c.Config[k]; !exists && schema.Default != nil {
				c.Config[k] = schema.Default
			}
		}
		in.Components[i] = c
	}

	primaryColor := in.PrimaryColor
	if primaryColor == "" {
		primaryColor = "#4F46E5"
	}
	// 注意：preview_html 由 ask_user 后端从 blueprint 自动生成，不在 tool_result 中返回（太大，会卡 LLM）

	// 构建组件描述列表
	compDescs := []string{}
	for i, c := range in.Components {
		def, _ := components.GetComponentDef(c.ComponentID)
		name := c.ComponentID
		if def != nil {
			name = fmt.Sprintf("%s %s", def.Icon, def.Name)
		}
		compDescs = append(compDescs, fmt.Sprintf("%d. %s", i+1, name))
	}

	result := map[string]interface{}{
		"preview_available": true,
		"preview_type":      "iframe",
		"components":        compDescs,
		"title":             in.Title,
		"primary_color":     primaryColor,
		"message":           "预览已生成。接下来请调用 ask_user 工具（interaction_type=\"preview\"），传入 blueprint 和 config_fields。不要传 preview_html，服务器会自动从 blueprint 生成预览",
	}

	// 构建 config_fields — 按组件分组的嵌套格式
	// 格式: [{component_id, component_name, fields: [{id, label, type, default_value, ...}]}]
	configFields := []map[string]interface{}{}

	// 全局配置作为一个特殊组件
	globalFields := []map[string]interface{}{
		{"id": "title", "label": "应用标题", "type": "text", "default_value": in.Title, "required": false},
		{"id": "primary_color", "label": "主色调", "type": "color", "default_value": primaryColor},
	}
	configFields = append(configFields, map[string]interface{}{
		"component_id":   "_global",
		"component_name": "📐 全局配置",
		"fields":         globalFields,
	})

	// 每个组件的配置
	for _, c := range in.Components {
		def, _ := components.GetComponentDef(c.ComponentID)
		if def == nil {
			continue
		}
		compFields := []map[string]interface{}{}
		for key, schema := range def.ConfigSchema {
			if schema.Type == "list" || schema.Type == "string_list" {
				// list 类型太复杂，跳过
				continue
			}
			fieldType := "text"
			switch schema.Type {
			case "number":
				fieldType = "number"
			case "color":
				fieldType = "color"
			case "select":
				fieldType = "select"
			case "boolean":
				fieldType = "boolean"
			case "api_url":
				fieldType = "text"
			}
			field := map[string]interface{}{
				"id":            key,
				"label":         schema.Label,
				"type":          fieldType,
				"default_value": c.Config[key],
				"required":      schema.Required,
			}
			if schema.Min != nil {
				field["min"] = *schema.Min
			}
			if schema.Max != nil {
				field["max"] = *schema.Max
			}
			if schema.Type == "select" && len(schema.Options) > 0 {
				opts := []map[string]string{}
				for _, o := range schema.Options {
					opts = append(opts, map[string]string{"id": o, "label": o})
				}
				field["options"] = opts
			}
			if schema.Hint != "" {
				field["placeholder"] = schema.Hint
			}
			compFields = append(compFields, field)
		}
		configFields = append(configFields, map[string]interface{}{
			"component_id":   c.ComponentID,
			"component_name": fmt.Sprintf("%s %s", def.Icon, def.Name),
			"fields":         compFields,
		})
	}
	result["config_fields"] = configFields

	// 输出 blueprint 供 ask_user 传递给前端，用于刷新预览时重建
	result["blueprint"] = map[string]interface{}{
		"title":            in.Title,
		"slug":             in.Slug,
		"description":      in.Description,
		"icon":             in.Icon,
		"design_direction": in.DesignDirection,
		"primary_color":    in.PrimaryColor,
		"components":       in.Components,
	}

	data, _ := json.Marshal(result)
	return mcpTextResult(string(data)), nil, nil
}

func mcpCreateAppFromBlueprint(ctx context.Context, req *mcp.CallToolRequest, in createAppFromBlueprintIn) (*mcp.CallToolResult, any, error) {
	// 组装蓝图
	blueprint := components.AppBlueprint{
		Title:           in.Title,
		Slug:            in.Slug,
		Description:     in.Description,
		Icon:            in.Icon,
		DesignDirection: in.DesignDirection,
		PrimaryColor:    in.PrimaryColor,
		Components:      in.Components,
	}

	// 首次调用（confirmed=false）：生成预览，返回给 AI 让它调用 ask_user(preview) 展示
	if !in.Confirmed {
		primaryColor := in.PrimaryColor
		if primaryColor == "" {
			primaryColor = "#4F46E5"
		}
		// 注意：preview_html 由 ask_user 后端从 blueprint 自动生成，不在 tool_result 中返回（太大，会卡 LLM）

		// 生成配置字段
		configFields := []map[string]interface{}{}
		for _, c := range in.Components {
			def, _ := components.GetComponentDef(c.ComponentID)
			if def == nil {
				continue
			}
			fields, _ := components.GenerateConfigFormJSON(c.ComponentID, c.Config)
			componentName := def.Name
			componentIcon := def.Icon
			configFields = append(configFields, map[string]interface{}{
				"component_id":   c.ComponentID,
				"component_name": fmt.Sprintf("%s %s", componentIcon, componentName),
				"fields":         fields,
			})
		}

		result := map[string]interface{}{
			"action":        "preview",
			"config_fields": configFields,
			"blueprint":     blueprint,
			"message":       fmt.Sprintf("📱 预览已生成！请立即调用 ask_user 工具（interaction_type=\"preview\"），传入 blueprint 和 config_fields。不要传 preview_html，服务器会自动从 blueprint 生成预览。用户确认后再次调用 create_app(confirmed=true) 即可正式创建。"),
		}
		data, _ := json.Marshal(result)
		return mcpTextResult(string(data)), nil, nil
	}

	// HITL 已确认：正式创建应用
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}

	primaryColor := in.PrimaryColor
	if primaryColor == "" {
		primaryColor = "#4F46E5"
	}
	html := components.AssembleAppPage(blueprint, primaryColor)

	reqBody := map[string]interface{}{
		"name":        in.Title,
		"title":       in.Title,
		"slug":        in.Slug,
		"description": in.Description,
		"icon":        in.Icon,
		"html":        html,
		"is_public":   in.IsPublic,
		"config": map[string]interface{}{
			"blueprint": map[string]interface{}{
				"design_direction": in.DesignDirection,
				"primary_color":    in.PrimaryColor,
				"components":       in.Components,
			},
		},
	}

	body, _ := json.Marshal(reqBody)
	apiURL := fmt.Sprintf("%s/api/v1/apps", mcpLoopbackAddr)
	httpReq, _ := http.NewRequest("POST", apiURL, bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+cli.apiKey)

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, nil, fmt.Errorf("创建应用请求失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return nil, nil, fmt.Errorf("创建应用失败 (%d): %s", resp.StatusCode, string(respBody))
	}

	return mcpTextResult(fmt.Sprintf("✅ 应用 %q 已创建！访问地址: /app/%s\n组件: %d 个", in.Title, in.Slug, len(in.Components))), nil, nil
}

func mcpDesignTheme(ctx context.Context, req *mcp.CallToolRequest, in designThemeIn) (*mcp.CallToolResult, any, error) {
	if in.Direction != "" {
		// 返回指定设计方向的详细信息
		theme, ok := designThemes[in.Direction]
		if !ok {
			return nil, nil, fmt.Errorf("未知设计方向: %s，可选值: minimal, corporate, vibrant, elegant, playful, dark, nature, brutalist", in.Direction)
		}
		result := map[string]interface{}{
			"direction": in.Direction,
			"theme":     theme,
		}
		data, _ := json.Marshal(result)
		return mcpTextResult(string(data)), nil, nil
	}

	// 返回所有设计方向概览
	type themeOverview struct {
		Direction     string   `json:"direction"`
		Name          string   `json:"name"`
		Icon          string   `json:"icon"`
		Description   string   `json:"description"`
		PrimaryColors []string `json:"primary_colors"`
	}
	var overview []themeOverview
	for dir, theme := range designThemes {
		colors, _ := theme["primary_colors"].([]string)
		overview = append(overview, themeOverview{
			Direction:     dir,
			Name:          theme["name"].(string),
			Icon:          theme["icon"].(string),
			Description:   theme["description"].(string),
			PrimaryColors: colors,
		})
	}
	result := map[string]interface{}{
		"themes": overview,
		"usage":  "调用 create_app 时将 direction 值填入 design_direction 字段，推荐配色填入 primary_color 字段",
	}
	data, _ := json.Marshal(result)
	return mcpTextResult(string(data)), nil, nil
}

func mcpListApps(ctx context.Context, req *mcp.CallToolRequest, _ listAppsIn) (*mcp.CallToolResult, any, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}
	data, err := cli.do(http.MethodGet, "/api/v1/apps", nil)
	if err != nil {
		return nil, nil, err
	}
	return mcpTextResult(string(data)), nil, nil
}

func mcpUpdateApp(ctx context.Context, req *mcp.CallToolRequest, in updateAppIn) (*mcp.CallToolResult, any, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}

	if in.ID == "" {
		return nil, nil, fmt.Errorf("缺少应用 ID")
	}

	// 构建请求体（只包含非空字段）
	reqBody := map[string]interface{}{}
	if in.Title != "" {
		reqBody["title"] = in.Title
	}
	if in.Slug != "" {
		reqBody["slug"] = in.Slug
	}
	if in.Description != "" {
		reqBody["description"] = in.Description
	}
	if in.HTML != "" {
		reqBody["html"] = in.HTML
	}
	if in.CSS != "" {
		reqBody["css"] = in.CSS
	}
	if in.JS != "" {
		reqBody["js"] = in.JS
	}
	if in.Files != nil {
		reqBody["files"] = in.Files
	}
	if in.IsPublic != nil {
		reqBody["is_public"] = *in.IsPublic
	}
	// 蓝图信息存入 config
	if in.DesignDirection != "" || in.PrimaryColor != "" || in.Style != "" || in.Visuals != "" {
		reqBody["config"] = map[string]interface{}{
			"blueprint": map[string]interface{}{
				"design_direction": in.DesignDirection,
				"primary_color":    in.PrimaryColor,
				"style":            in.Style,
				"visuals":          in.Visuals,
			},
		}
	}

	body, _ := json.Marshal(reqBody)
	data, err := cli.do(http.MethodPut, "/api/v1/apps/"+in.ID, body)
	if err != nil {
		return nil, nil, err
	}
	return mcpTextResult(string(data)), nil, nil
}

func mcpDeleteApp(ctx context.Context, req *mcp.CallToolRequest, in deleteAppIn) (*mcp.CallToolResult, any, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}

	if in.ID == "" {
		return nil, nil, fmt.Errorf("缺少应用 ID")
	}

	data, err := cli.do(http.MethodDelete, "/api/v1/apps/"+in.ID, nil)
	if err != nil {
		return nil, nil, err
	}
	return mcpTextResult(string(data)), nil, nil
}

// ─── MCP 客户端上下文传递 ────────────────────────────────────────────────────

type mcpClientContextKey struct{}

// getMCPClientFromContext 从请求上下文中获取 MCP 客户端
// HTTP 模式：从 context 中获取（由 mcpMiddleware 注入）
// Stdio 模式：创建新的客户端
func getMCPClientFromContext(ctx context.Context) (*mcpClient, error) {
	if cli, ok := ctx.Value(mcpClientContextKey{}).(*mcpClient); ok && cli != nil {
		return cli, nil
	}
	// 回退：创建新的客户端（Stdio 模式）
	return newMCPClient()
}

// ─── buildSQLDialectHints 根据数据库类型生成 SQL 方言提示 ─────────────────────

func buildSQLDialectHints(dbType, dbName string) map[string]interface{} {
	dialectMap := map[string]map[string]string{
		"mysql": {
			"dialect":          "MySQL",
			"quote_char":       "`",
			"param_style":      "?",
			"concat_operator":  "CONCAT()",
			"limit_syntax":     "LIMIT n OFFSET m",
			"auto_increment":   "AUTO_INCREMENT",
			"string_concat":    "CONCAT_WS()",
			"date_function":    "NOW(), CURDATE(), DATE_FORMAT()",
			"json_support":     "JSON_EXTRACT(), JSON_ARRAY(), JSON_OBJECT()",
			"fulltext_search":  "MATCH() AGAINST()",
			"common_hints":     "MySQL 使用反引号(`)引用标识符，占位符为?，字符串用单引号",
		},
		"postgresql": {
			"dialect":          "PostgreSQL",
			"quote_char":       "\"",
			"param_style":      "$1, $2, ...",
			"concat_operator":  "||",
			"limit_syntax":     "LIMIT n OFFSET m",
			"auto_increment":   "SERIAL / BIGSERIAL",
			"string_concat":    "|| 运算符",
			"date_function":    "NOW(), CURRENT_DATE, TO_CHAR()",
			"json_support":     "->, ->>, jsonb_each(), json_build_object()",
			"fulltext_search":  "to_tsvector() @@ to_tsquery()",
			"common_hints":     "PostgreSQL 使用双引号(\")引用标识符，占位符为$1/$2，字符串用单引号",
		},
		"sqlite": {
			"dialect":          "SQLite",
			"quote_char":       "\"",
			"param_style":      "? 或 :name",
			"concat_operator":  "||",
			"limit_syntax":     "LIMIT n OFFSET m",
			"auto_increment":   "AUTOINCREMENT",
			"string_concat":    "|| 运算符",
			"date_function":    "date(), datetime(), strftime()",
			"json_support":     "json_extract(), json_array(), json_object()",
			"fulltext_search":  "FTS5 扩展",
			"common_hints":     "SQLite 使用双引号(\")或方括号([])引用标识符，占位符为?，字符串用单引号",
		},
		"clickhouse": {
			"dialect":          "ClickHouse",
			"quote_char":       "`",
			"param_style":      "{name:Type}",
			"concat_operator":  "concat()",
			"limit_syntax":     "LIMIT n OFFSET m",
			"auto_increment":   "无（使用 UUID 或序列）",
			"string_concat":    "concat()",
			"date_function":    "now(), today(), formatDateTime()",
			"json_support":     "JSONExtract(), JSONExtractString()",
			"fulltext_search":  "全文索引（实验性）",
			"common_hints":     "ClickHouse 使用反引号(`)引用标识符，参数使用{name:Type}格式，列式存储优化聚合查询",
		},
		"sqlserver": {
			"dialect":          "SQL Server",
			"quote_char":       "[ ]",
			"param_style":      "@param",
			"concat_operator":  "+",
			"limit_syntax":     "OFFSET n ROWS FETCH NEXT m ROWS ONLY",
			"auto_increment":   "IDENTITY(1,1)",
			"string_concat":    "+ 运算符",
			"date_function":    "GETDATE(), DATEADD(), CONVERT()",
			"json_support":     "JSON_VALUE(), JSON_QUERY()",
			"fulltext_search":  "CONTAINS(), FREETEXT()",
			"common_hints":     "SQL Server 使用方括号([])引用标识符，参数使用@param格式，分页使用OFFSET-FETCH",
		},
		"oracle": {
			"dialect":          "Oracle",
			"quote_char":       "\"",
			"param_style":      ":param",
			"concat_operator":  "||",
			"limit_syntax":     "ROWNUM <= n 或 FETCH FIRST n ROWS ONLY",
			"auto_increment":   "SEQUENCE + TRIGGER",
			"string_concat":    "|| 运算符",
			"date_function":    "SYSDATE, TO_CHAR(), TO_DATE()",
			"json_support":     "JSON_OBJECT(), JSON_ARRAY() (12c+)",
			"fulltext_search":  "CTXSYS.CONTEXT",
			"common_hints":     "Oracle 使用双引号(\")引用标识符，参数使用:param格式，没有LIMIT关键字",
		},
		"dm": {
			"dialect":          "达梦(DM)",
			"quote_char":       "\"",
			"param_style":      ":param",
			"concat_operator":  "||",
			"limit_syntax":     "LIMIT n OFFSET m 或 ROWNUM",
			"auto_increment":   "IDENTITY(1,1)",
			"string_concat":    "|| 运算符",
			"date_function":    "SYSDATE, TO_CHAR(), TO_DATE()",
			"json_support":     "有限支持",
			"fulltext_search":  "全文索引",
			"common_hints":     "达梦兼容Oracle语法，使用双引号(\")引用标识符，参数使用:param格式",
		},
	}

	hints, ok := dialectMap[dbType]
	if !ok {
		hints = map[string]string{
			"dialect":      dbType,
			"common_hints": "未知数据库类型，请参考标准 SQL 语法",
		}
	}

	return map[string]interface{}{
		"database_name": dbName,
		"database_type": dbType,
		"sql_hints":     hints,
	}
}

// ─── HTTP 模式：go-sdk StreamableHTTPHandler ─────────────────────────────────

// mcpHTTPHandler 全局 MCP HTTP handler（在 initMCPHTTPHandler 中创建）
var mcpHTTPHandler *mcp.StreamableHTTPHandler

// initMCPHTTPHandler 创建并注册所有工具的 MCP StreamableHTTPHandler
func initMCPHTTPHandler() {
	getServer := func(r *http.Request) *mcp.Server {
		server := mcp.NewServer(&mcp.Implementation{
			Name:    mcpServerName,
			Version: mcpServerVersion,
		}, nil)

		// 注册所有 16 个工具
		mcp.AddTool(server, &mcp.Tool{Name: "list_databases", Description: "列出数据本体池中已配置的数据库（不含密码）"}, mcpListDatabases)
		mcp.AddTool(server, &mcp.Tool{Name: "get_tables", Description: "获取指定数据库的表列表及连接状态"}, mcpGetTables)
		mcp.AddTool(server, &mcp.Tool{Name: "describe_table", Description: "获取指定数据库中某张表的列结构（字段名、类型、是否可空、默认值、键信息等）"}, mcpDescribeTable)
		mcp.AddTool(server, &mcp.Tool{Name: "execute_sql", Description: "在指定数据库上执行 SQL 语句。SELECT/SHOW/DESCRIBE/EXPLAIN 返回查询结果；INSERT/UPDATE/DELETE/CREATE/DROP 等返回影响行数。请谨慎使用写操作。"}, mcpExecuteSQL)
		mcp.AddTool(server, &mcp.Tool{Name: "list_apis", Description: "列出数据本体池中已配置的接口（path、method、关联数据库）"}, mcpListApis)
		mcp.AddTool(server, &mcp.Tool{Name: "get_api_detail", Description: "获取指定接口的完整详情，包括 SQL 语句、参数定义、描述、关联数据库等"}, mcpGetApiDetail)
		mcp.AddTool(server, &mcp.Tool{Name: "call_api", Description: "调用已配置的接口，传入接口 ID 和 params 执行并返回数据"}, mcpCallApi)
		mcp.AddTool(server, &mcp.Tool{Name: "search_tables", Description: "根据关键词搜索数据库中的表，支持指定数据库范围"}, mcpSearchTables)
		mcp.AddTool(server, &mcp.Tool{Name: "get_db_schema", Description: "获取指定数据库的完整 schema 信息，包括所有表结构、列定义、索引等"}, mcpGetDbSchema)
		mcp.AddTool(server, &mcp.Tool{Name: "get_db_sql_hints", Description: "获取指定数据库的 SQL 方言提示，包括数据库类型和方言特性说明"}, mcpGetDbSQLHints)
		mcp.AddTool(server, &mcp.Tool{Name: "create_api", Description: "【重要】创建接口前必须先调用 ask_user 工具让用户确认配置！创建新的数据接口，定义接口路径、方法、SQL 和参数等"}, mcpCreateApi)
		mcp.AddTool(server, &mcp.Tool{Name: "execute_api", Description: "通过接口路径直接调用已配置的数据接口，传入查询参数获取数据"}, mcpExecuteApi)

		// 应用管理工具（create_app 已内含组件列表和设计方向，无需单独调用 list_components/design_theme）
		mcp.AddTool(server, &mcp.Tool{Name: "create_app", Description: `基于预制组件创建可视化应用（一步完成预览+创建）。

【工作流】首次调用(confirmed=false)→返回preview_html+blueprint→立即调用ask_user(interaction_type="preview")传入blueprint和config_fields（不要传preview_html）→用户确认后再次调用本工具(confirmed=true)→正式创建。

【可用组件】
- 图表类：chart-bar(柱状图)、chart-line(折线图)、chart-pie(饼图)、chart-area(面积图)、chart-gauge(仪表盘)
- 数据类：data-table(数据表格)、kpi-card(KPI卡片)
- 交互类：filter-bar(筛选栏，联动其他组件刷新数据)
- 地图类：map-scatter(地图散点)
- 其他类：timeline(时间线)

【设计方向】minimal/corporate/vibrant/elegant/playful/dark/nature/brutalist

组件config示例：{"component_id":"chart-bar","config":{"title":"销售额","data_source":"/api/v1/data/sales","x_field":"month","y_fields":["revenue"]}}`}, mcpCreateAppFromBlueprint)
		mcp.AddTool(server, &mcp.Tool{Name: "list_apps", Description: "列出所有应用"}, mcpListApps)
		mcp.AddTool(server, &mcp.Tool{Name: "update_app", Description: "更新已有应用"}, mcpUpdateApp)
		mcp.AddTool(server, &mcp.Tool{Name: "delete_app", Description: "删除指定应用"}, mcpDeleteApp)

		return server
	}

	mcpHTTPHandler = mcp.NewStreamableHTTPHandler(getServer, &mcp.StreamableHTTPOptions{
		Stateless:    true,
		JSONResponse: true,
	})
}

// handleMCPHTTP 是内嵌在 HTTP 服务器中的 MCP 端点。
// 使用 go-sdk StreamableHTTPHandler 实现，兼容 PicoClaw 的 streamable-http transport。
func handleMCPHTTP(w http.ResponseWriter, r *http.Request) {
	// 检查 MCP 是否启用
	dataOntologyMu.RLock()
	enabled := dataOntologyMCPEnabled == nil || *dataOntologyMCPEnabled
	dataOntologyMu.RUnlock()
	if !enabled {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":"Agent 服务已关闭，请开启后使用"}`))
		return
	}

	// 鉴权：验证 API Key 或 X-Internal-Call
	if !verifyToken(r) && r.Header.Get("X-Internal-Call") != "datatoolbox-agent" {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"未授权，请在 Authorization 头中提供有效的 API Key"}`))
		return
	}

	// 对于 X-Internal-Call 请求，注入 admin API Key 到 context
	apiKey := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if r.Header.Get("X-Internal-Call") == "datatoolbox-agent" {
		dataOntologyMu.RLock()
		if user, ok := dataOntologyUsers["admin"]; ok && user.ApiKey != "" {
			apiKey = user.ApiKey
		}
		dataOntologyMu.RUnlock()
	}

	// 将 MCP 客户端注入到请求上下文中，供工具处理函数使用
	cli := newLoopbackMCPClient(apiKey)
	ctx := context.WithValue(r.Context(), mcpClientContextKey{}, cli)

	// 委托给 go-sdk StreamableHTTPHandler
	mcpHTTPHandler.ServeHTTP(w, r.WithContext(ctx))
}

// ─── Stdio 模式入口 ──────────────────────────────────────────────────────────

func runMCPServer() {
	cli, err := newMCPClient()
	if err != nil {
		fmt.Fprintf(os.Stderr, "MCP 启动失败: %v\n", err)
		os.Exit(1)
	}
	data, err := cli.do(http.MethodGet, "/api/v1/mcp/config", nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "MCP 无法连接服务端: %v\n", err)
		os.Exit(1)
	}
	var configResp struct {
		Success bool `json:"success"`
		Enabled bool `json:"enabled"`
	}
	if err := json.Unmarshal(data, &configResp); err != nil || !configResp.Success || !configResp.Enabled {
		fmt.Fprintf(os.Stderr, "Agent 服务已在服务端关闭，请开启后使用\n")
		os.Exit(1)
	}

	server := mcp.NewServer(&mcp.Implementation{Name: mcpServerName, Version: mcpServerVersion}, nil)
	// Stdio 模式注册所有 16 个工具（与 HTTP 模式一致）
	mcp.AddTool(server, &mcp.Tool{Name: "list_databases", Description: "列出数据本体池中已配置的数据库（不含密码）"}, mcpListDatabases)
	mcp.AddTool(server, &mcp.Tool{Name: "get_tables", Description: "获取指定数据库的表列表及连接状态"}, mcpGetTables)
	mcp.AddTool(server, &mcp.Tool{Name: "describe_table", Description: "获取指定数据库中某张表的列结构"}, mcpDescribeTable)
	mcp.AddTool(server, &mcp.Tool{Name: "execute_sql", Description: "在指定数据库上执行 SQL 语句"}, mcpExecuteSQL)
	mcp.AddTool(server, &mcp.Tool{Name: "list_apis", Description: "列出数据本体池中已配置的接口"}, mcpListApis)
	mcp.AddTool(server, &mcp.Tool{Name: "get_api_detail", Description: "获取指定接口的完整详情"}, mcpGetApiDetail)
	mcp.AddTool(server, &mcp.Tool{Name: "call_api", Description: "调用已配置的接口"}, mcpCallApi)
	mcp.AddTool(server, &mcp.Tool{Name: "search_tables", Description: "根据关键词搜索数据库中的表"}, mcpSearchTables)
	mcp.AddTool(server, &mcp.Tool{Name: "get_db_schema", Description: "获取指定数据库的完整 schema"}, mcpGetDbSchema)
	mcp.AddTool(server, &mcp.Tool{Name: "get_db_sql_hints", Description: "获取指定数据库的 SQL 方言提示"}, mcpGetDbSQLHints)
	mcp.AddTool(server, &mcp.Tool{Name: "create_api", Description: "创建新的数据接口"}, mcpCreateApi)
	mcp.AddTool(server, &mcp.Tool{Name: "execute_api", Description: "通过接口路径直接调用已配置的数据接口"}, mcpExecuteApi)

	// 应用管理工具
	mcp.AddTool(server, &mcp.Tool{Name: "create_app", Description: `基于预制组件创建可视化应用（一步完成预览+创建）。首次调用自动生成预览，请立即调用ask_user展示给用户，确认后再次调用正式创建。可用组件：chart-bar/chart-line/chart-pie/chart-area/chart-gauge/data-table/filter-bar/kpi-card/map-scatter/timeline`}, mcpCreateAppFromBlueprint)
	mcp.AddTool(server, &mcp.Tool{Name: "list_apps", Description: "列出所有应用"}, mcpListApps)
	mcp.AddTool(server, &mcp.Tool{Name: "update_app", Description: "更新已有应用"}, mcpUpdateApp)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_app", Description: "删除指定应用"}, mcpDeleteApp)

	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		fmt.Fprintf(os.Stderr, "MCP 运行错误: %v\n", err)
		os.Exit(1)
	}
}

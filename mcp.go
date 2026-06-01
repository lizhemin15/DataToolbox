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
	"time"

	"github.com/YOUR_USERNAME/DataToolbox/agent"
	"github.com/YOUR_USERNAME/DataToolbox/components"
	"github.com/YOUR_USERNAME/DataToolbox/templates"
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

// trimMCPResult 对MCP工具返回结果做上下文安全裁剪，避免大载荷撑爆LLM上下文
// toolName: 工具名称，用于选择裁剪策略
// data: 原始JSON字节数组
func trimMCPResult(toolName string, data []byte) []byte {
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return data // 解析失败，返回原始数据
	}

	switch toolName {
	case "list_databases":
		// 只返回 id, name, type, connected — 去掉 host/port/password 等敏感信息
		if dbs, ok := m["databases"].([]any); ok {
			trimmed := make([]map[string]any, 0, len(dbs))
			for _, db := range dbs {
				if dbMap, ok := db.(map[string]any); ok {
					trimmed = append(trimmed, map[string]any{
						"id":        dbMap["id"],
						"name":      dbMap["name"],
						"type":      dbMap["type"],
						"connected": dbMap["connected"],
					})
				}
			}
			m["databases"] = trimmed
			m["hint"] = "Use get_database(id) for full details"
		}

	case "get_tables", "get_db_schema":
		// 只返回表名+注释列表，不返回columns（太大了）
		if db, ok := m["database"].(map[string]any); ok {
			if tables, ok := db["tables"].([]any); ok {
				tableNames := make([]map[string]any, 0, len(tables))
				for _, tbl := range tables {
					if tblMap, ok := tbl.(map[string]any); ok {
						entry := map[string]any{"name": tblMap["name"]}
						if comment, ok := tblMap["comment"].(string); ok && comment != "" {
							entry["comment"] = comment
						}
						tableNames = append(tableNames, entry)
					}
				}
				m = map[string]any{
					"database_id":   db["id"],
					"database_name": db["name"],
					"database_type": db["type"],
					"total_tables":  len(tableNames),
					"tables":        tableNames,
					"hint":          "Use describe_table(database_id, table_name) for column details",
				}
			}
		}

	case "list_apis":
		// 只返回 id, name, path, type, method, description — 去掉 sql/forward_url 等大字段
		if apis, ok := m["apis"].([]any); ok {
			trimmed := make([]map[string]any, 0, len(apis))
			for _, api := range apis {
				if apiMap, ok := api.(map[string]any); ok {
					trimmed = append(trimmed, map[string]any{
						"id":          apiMap["id"],
						"name":        apiMap["name"],
						"path":        apiMap["path"],
						"type":        apiMap["type"],
						"method":      apiMap["method"],
						"description": apiMap["description"],
						"enabled":     apiMap["enabled"],
					})
				}
			}
			m["apis"] = trimmed
			m["hint"] = "Use get_api_detail(id) for full SQL/params"
		}

	case "execute_sql":
		// 截断过大的结果集，保护上下文
		if data, ok := m["data"].([]any); ok && len(data) > 100 {
			m["data"] = data[:100]
			m["truncated"] = true
			m["total_rows"] = len(data)
			m["returned_rows"] = 100
			m["hint"] = "Result truncated. Use LIMIT/FETCH FIRST for specific slices."
		}
	}

	result, err := json.Marshal(m)
	if err != nil {
		return data
	}
	return result
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

type profileTableIn struct {
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
	Query      string `json:"query" jsonschema:"搜索关键词"`
	DatabaseID string `json:"database_id,omitempty" jsonschema:"数据库ID（可选，用于限定搜索范围）"`
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

type createDashboardIn struct {
	DatabaseID      string `json:"database_id" jsonschema:"required,数据库 ID"`
	TableName       string `json:"table_name" jsonschema:"required,表名"`
	DashboardName   string `json:"dashboard_name,omitempty" jsonschema:"看板名称（可选，默认用表名+看板）"`
	DesignDirection string `json:"design_direction,omitempty" jsonschema:"设计方向：minimal/corporate/vibrant/elegant/playful/dark/nature/brutalist，默认 minimal"`
	Confirmed       bool   `json:"confirmed,omitempty" jsonschema:"用户确认后设为 true 正式创建看板；未确认时调用只生成预览"`
}

// ─── 应用模板工具输入类型 ─────────────────────────────────────────────────────

type listTemplatesIn struct {
	Category string `json:"category,omitempty" jsonschema:"按分类筛选：dashboard(看板)/single(单组件)，不传则返回全部"`
}

type createAppFromTemplateIn struct {
	TemplateID      string            `json:"template_id" jsonschema:"required,模板ID，如 dashboard-sales/dashboard-operations/dashboard-geographic/dashboard-timeline/dashboard-comparison/single-kpi/single-datatable/single-chart"`
	DatabaseID      string            `json:"database_id" jsonschema:"required,数据库 ID"`
	TableNameMap    map[string]string `json:"table_name_map" jsonschema:"required,模板表名→实际表名映射，如 {\"sales\":\"ORDER_DETAILS\",\"data\":\"MY_TABLE\"}。模板ID含required_tables字段说明需要哪些表"`
	Variant         string            `json:"variant,omitempty" jsonschema:"图表变体（仅 single-chart 模板有效）：bar/line/pie/area"`
	Title           string            `json:"title,omitempty" jsonschema:"应用标题（可选，默认用模板名称）"`
	DesignDirection string            `json:"design_direction,omitempty" jsonschema:"设计方向（可选，默认用模板预设）"`
	PrimaryColor    string            `json:"primary_color,omitempty" jsonschema:"主色调 HEX（可选，默认用模板预设）"`
	IsPublic        bool              `json:"is_public,omitempty" jsonschema:"是否公开"`
	Confirmed       bool              `json:"confirmed,omitempty" jsonschema:"用户确认后设为 true 正式创建应用；未确认时调用只生成预览"`
}

// ─── ask_user HITL 工具输入类型 ─────────────────────────────────────────────────

type askUserOption struct {
	ID          string `json:"id" jsonschema:"required,选项ID"`
	Label       string `json:"label" jsonschema:"required,选项显示文本"`
	Description string `json:"description,omitempty" jsonschema:"选项描述"`
	Style       string `json:"style,omitempty" jsonschema:"选项样式,enum=default,enum=primary,enum=danger,enum=warning"`
}

type askUserField struct {
	ID           string           `json:"id" jsonschema:"required,字段ID"`
	Label        string           `json:"label" jsonschema:"required,字段显示名"`
	Type         string           `json:"type,omitempty" jsonschema:"字段类型,enum=text,enum=number,enum=select,enum=textarea"`
	Placeholder  string           `json:"placeholder,omitempty" jsonschema:"占位提示文本"`
	Required     bool             `json:"required,omitempty" jsonschema:"是否必填"`
	DefaultValue string           `json:"default_value,omitempty" jsonschema:"默认值"`
	Options      []askUserOption  `json:"options,omitempty" jsonschema:"select类型的选项列表"`
}

type askUserIn struct {
	InteractionType string          `json:"interaction_type" jsonschema:"required,交互类型,enum=confirm,enum=single_select,enum=multi_select,enum=input,enum=form"`
	Title           string          `json:"title" jsonschema:"required,交互标题"`
	Description     string          `json:"description,omitempty" jsonschema:"交互描述"`
	Options         []askUserOption `json:"options,omitempty" jsonschema:"选项列表,description=用于confirm/single_select/multi_select类型"`
	Fields          []askUserField  `json:"fields,omitempty" jsonschema:"表单字段列表,description=用于input/form类型"`
	TimeoutSeconds  int             `json:"timeout_seconds,omitempty" jsonschema:"超时秒数,description=默认86400即24小时"`
	SessionID       string          `json:"session_id,omitempty" jsonschema:"会话ID,description=默认default"`
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
	return mcpTextResult(string(trimMCPResult("list_databases", data))), nil, nil
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
	return mcpTextResult(string(trimMCPResult("get_tables", data))), nil, nil
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
		// 达梦数据库使用 USER_TAB_COLUMNS，需要大写表名
		sql = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_DEFAULT FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", strings.ToUpper(tableName))
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

// ─── profile_table：数据概览 ──────────────────────────────────────────────

// isNumericType 判断数据库字段类型是否为数值类型
func isNumericType(dbType, dataType string) bool {
	t := strings.ToUpper(dataType)
	// 通用数值类型关键词
	numericKeywords := []string{"INT", "BIGINT", "SMALLINT", "TINYINT", "FLOAT", "DOUBLE", "DECIMAL", "NUMERIC", "NUMBER", "REAL", "MONEY"}
	for _, kw := range numericKeywords {
		if strings.Contains(t, kw) {
			return true
		}
	}
	// 达梦/Oracle 的 NUMBER 类型
	if strings.ToLower(dbType) == "dm" && t == "NUMBER" {
		return true
	}
	return false
}

// isDateType 判断数据库字段类型是否为日期类型
func isDateType(dataType string) bool {
	t := strings.ToUpper(dataType)
	dateKeywords := []string{"DATE", "TIME", "TIMESTAMP", "DATETIME"}
	for _, kw := range dateKeywords {
		if strings.Contains(t, kw) {
			return true
		}
	}
	return false
}

// isStringType 判断数据库字段类型是否为字符串类型
func isStringType(dataType string) bool {
	t := strings.ToUpper(dataType)
	stringKeywords := []string{"CHAR", "TEXT", "CLOB", "VARCHAR", "NVARCHAR", "NCHAR", "NCLOB", "STRING", "ENUM"}
	for _, kw := range stringKeywords {
		if strings.Contains(t, kw) {
			return true
		}
	}
	return false
}

// quoteIdentifier 根据数据库类型引用标识符
func quoteIdentifier(dbType, name string) string {
	switch strings.ToLower(dbType) {
	case "mysql":
		return "`" + strings.ReplaceAll(name, "`", "``") + "`"
	case "dm", "oracle":
		return "\"" + strings.ReplaceAll(name, "\"", "\"\"") + "\""
	case "postgresql", "postgres", "sqlite":
		return "\"" + strings.ReplaceAll(name, "\"", "\"\"") + "\""
	case "sqlserver":
		return "[" + strings.ReplaceAll(name, "]", "]]") + "]"
	default:
		return "`" + strings.ReplaceAll(name, "`", "``") + "`"
	}
}

// topValuesSQL 根据数据库类型生成 TOP N 高频值查询 SQL
func topValuesSQL(dbType, quotedCol, quotedTable string, n int) string {
	switch strings.ToLower(dbType) {
	case "oracle":
		// Oracle 不支持 LIMIT，使用 ROWNUM
		return fmt.Sprintf(
			"SELECT %s, COUNT(*) AS cnt FROM %s WHERE %s IS NOT NULL GROUP BY %s ORDER BY cnt DESC",
			quotedCol, quotedTable, quotedCol, quotedCol,
		) // Oracle 调用方需自行加 ROWNUM 过滤
	case "sqlserver":
		return fmt.Sprintf(
			"SELECT TOP %d %s, COUNT(*) AS cnt FROM %s WHERE %s IS NOT NULL GROUP BY %s ORDER BY cnt DESC",
			n, quotedCol, quotedTable, quotedCol, quotedCol,
		)
	default:
		// MySQL, PostgreSQL, 达梦, SQLite 等支持 LIMIT
		return fmt.Sprintf(
			"SELECT %s, COUNT(*) AS cnt FROM %s WHERE %s IS NOT NULL GROUP BY %s ORDER BY cnt DESC LIMIT %d",
			quotedCol, quotedTable, quotedCol, quotedCol, n,
		)
	}
}

func mcpProfileTable(ctx context.Context, req *mcp.CallToolRequest, in profileTableIn) (*mcp.CallToolResult, any, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}

	// 1. 获取数据库类型
	dbData, err := cli.do(http.MethodGet, "/api/v1/databases/"+in.DatabaseID, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("获取数据库信息失败: %w", err)
	}
	var dbInfo struct {
		Success bool `json:"success"`
		Data    struct {
			Type string `json:"type"`
		} `json:"data"`
	}
	if err := json.Unmarshal(dbData, &dbInfo); err != nil {
		return nil, nil, fmt.Errorf("解析数据库信息失败: %w", err)
	}
	dbType := dbInfo.Data.Type

	tableName := strings.Trim(in.TableName, "\"`'")
	quotedTable := quoteIdentifier(dbType, tableName)

	// 2. 获取行数
	countSQL := fmt.Sprintf("SELECT COUNT(*) AS row_count FROM %s", quotedTable)
	countBody, _ := json.Marshal(map[string]interface{}{
		"database_id": in.DatabaseID,
		"sql":         countSQL,
	})
	countData, err := cli.do(http.MethodPost, "/api/v1/gov/execute-sql", countBody)
	if err != nil {
		return nil, nil, fmt.Errorf("获取行数失败: %w", err)
	}
	var countResp struct {
		Rows []map[string]interface{} `json:"rows"`
	}
	if err := json.Unmarshal(countData, &countResp); err != nil {
		return nil, nil, fmt.Errorf("解析行数结果失败: %w", err)
	}
	var rowCount float64
	if len(countResp.Rows) > 0 {
		if v, ok := countResp.Rows[0]["row_count"]; ok {
			rowCount, _ = v.(float64)
		} else if v, ok := countResp.Rows[0]["ROW_COUNT"]; ok {
			rowCount, _ = v.(float64)
		}
	}

	// 3. 获取表结构（列名和类型）
	var descSQL string
	switch strings.ToLower(dbType) {
	case "dm":
		descSQL = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", strings.ToUpper(tableName))
	case "mysql":
		descSQL = "DESCRIBE `" + tableName + "`"
	case "postgres", "postgresql":
		descSQL = fmt.Sprintf("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '%s' ORDER BY ordinal_position", tableName)
	default:
		descSQL = "DESCRIBE `" + tableName + "`"
	}
	descBody, _ := json.Marshal(map[string]interface{}{
		"database_id": in.DatabaseID,
		"sql":         descSQL,
	})
	descData, err := cli.do(http.MethodPost, "/api/v1/gov/execute-sql", descBody)
	if err != nil {
		return nil, nil, fmt.Errorf("获取表结构失败: %w", err)
	}
	var descResp struct {
		Rows []map[string]interface{} `json:"rows"`
	}
	if err := json.Unmarshal(descData, &descResp); err != nil {
		return nil, nil, fmt.Errorf("解析表结构失败: %w", err)
	}

	// 4. 对每个字段执行统计查询
	type columnProfile struct {
		Name      string                   `json:"name"`
		Type      string                   `json:"type"`
		NullRate  float64                  `json:"null_rate"`
		Min       interface{}              `json:"min,omitempty"`
		Max       interface{}              `json:"max,omitempty"`
		Avg       interface{}              `json:"avg,omitempty"`
		TopValues []map[string]interface{} `json:"top_values,omitempty"`
		Error     string                   `json:"error,omitempty"`
	}

	columns := []columnProfile{}
	for _, row := range descResp.Rows {
		// 提取列名和类型（兼容不同数据库返回格式）
		colName := ""
		colType := ""
		for _, key := range []string{"COLUMN_NAME", "column_name", "Field", "COLUMN_NAME "} {
			if v, ok := row[key]; ok && v != nil {
				colName = fmt.Sprintf("%v", v)
				break
			}
		}
		for _, key := range []string{"DATA_TYPE", "data_type", "Type", "DATA_TYPE "} {
			if v, ok := row[key]; ok && v != nil {
				colType = fmt.Sprintf("%v", v)
				break
			}
		}
		if colName == "" {
			continue
		}

		quotedCol := quoteIdentifier(dbType, colName)
		prof := columnProfile{
			Name: colName,
			Type: colType,
		}

		// 空值率查询
		nullSQL := fmt.Sprintf("SELECT COUNT(*) - COUNT(%s) AS null_count FROM %s", quotedCol, quotedTable)
		nullBody, _ := json.Marshal(map[string]interface{}{
			"database_id": in.DatabaseID,
			"sql":         nullSQL,
		})
		nullData, nullErr := cli.do(http.MethodPost, "/api/v1/gov/execute-sql", nullBody)
		if nullErr != nil {
			prof.Error = fmt.Sprintf("空值率查询失败: %v", nullErr)
			columns = append(columns, prof)
			continue
		}
		var nullResp struct {
			Rows []map[string]interface{} `json:"rows"`
		}
		if err := json.Unmarshal(nullData, &nullResp); err == nil && len(nullResp.Rows) > 0 {
			var nullCount float64
			for _, key := range []string{"null_count", "NULL_COUNT"} {
				if v, ok := nullResp.Rows[0][key]; ok && v != nil {
					nullCount, _ = v.(float64)
					break
				}
			}
			if rowCount > 0 {
				prof.NullRate = nullCount / rowCount
			}
		}

		// 根据类型执行不同的统计查询
		if isNumericType(dbType, colType) {
			// 数值字段：min, max, avg
			statSQL := fmt.Sprintf(
				"SELECT MIN(%s) AS min_val, MAX(%s) AS max_val, AVG(%s) AS avg_val FROM %s",
				quotedCol, quotedCol, quotedCol, quotedTable,
			)
			statBody, _ := json.Marshal(map[string]interface{}{
				"database_id": in.DatabaseID,
				"sql":         statSQL,
			})
			statData, statErr := cli.do(http.MethodPost, "/api/v1/gov/execute-sql", statBody)
			if statErr != nil {
				if prof.Error != "" {
					prof.Error += "; "
				}
				prof.Error += fmt.Sprintf("数值统计查询失败: %v", statErr)
			} else {
				var statResp struct {
					Rows []map[string]interface{} `json:"rows"`
				}
				if err := json.Unmarshal(statData, &statResp); err == nil && len(statResp.Rows) > 0 {
					for _, key := range []string{"min_val", "MIN_VAL"} {
						if v, ok := statResp.Rows[0][key]; ok && v != nil {
							prof.Min = v
							break
						}
					}
					for _, key := range []string{"max_val", "MAX_VAL"} {
						if v, ok := statResp.Rows[0][key]; ok && v != nil {
							prof.Max = v
							break
						}
					}
					for _, key := range []string{"avg_val", "AVG_VAL"} {
						if v, ok := statResp.Rows[0][key]; ok && v != nil {
							prof.Avg = v
							break
						}
					}
				}
			}
		} else if isDateType(colType) {
			// 日期字段：min, max
			statSQL := fmt.Sprintf(
				"SELECT MIN(%s) AS min_val, MAX(%s) AS max_val FROM %s",
				quotedCol, quotedCol, quotedTable,
			)
			statBody, _ := json.Marshal(map[string]interface{}{
				"database_id": in.DatabaseID,
				"sql":         statSQL,
			})
			statData, statErr := cli.do(http.MethodPost, "/api/v1/gov/execute-sql", statBody)
			if statErr != nil {
				if prof.Error != "" {
					prof.Error += "; "
				}
				prof.Error += fmt.Sprintf("日期统计查询失败: %v", statErr)
			} else {
				var statResp struct {
					Rows []map[string]interface{} `json:"rows"`
				}
				if err := json.Unmarshal(statData, &statResp); err == nil && len(statResp.Rows) > 0 {
					for _, key := range []string{"min_val", "MIN_VAL"} {
						if v, ok := statResp.Rows[0][key]; ok && v != nil {
							prof.Min = v
							break
						}
					}
					for _, key := range []string{"max_val", "MAX_VAL"} {
						if v, ok := statResp.Rows[0][key]; ok && v != nil {
							prof.Max = v
							break
						}
					}
				}
			}
		} else if isStringType(colType) {
			// 字符串字段：TOP5 高频值
			topSQL := topValuesSQL(dbType, quotedCol, quotedTable, 5)
			topBody, _ := json.Marshal(map[string]interface{}{
				"database_id": in.DatabaseID,
				"sql":         topSQL,
			})
			topData, topErr := cli.do(http.MethodPost, "/api/v1/gov/execute-sql", topBody)
			if topErr != nil {
				if prof.Error != "" {
					prof.Error += "; "
				}
				prof.Error += fmt.Sprintf("高频值查询失败: %v", topErr)
			} else {
				var topResp struct {
					Rows []map[string]interface{} `json:"rows"`
				}
				if err := json.Unmarshal(topData, &topResp); err == nil {
					topVals := []map[string]interface{}{}
					limit := 5
					for i, r := range topResp.Rows {
						if i >= limit {
							break
						}
						val := ""
						cnt := float64(0)
						for _, key := range []string{colName, strings.ToUpper(colName), strings.ToLower(colName), quotedCol} {
							if v, ok := r[key]; ok && v != nil {
								val = fmt.Sprintf("%v", v)
								break
							}
						}
						// 如果列名没匹配到，尝试取第一个非 cnt 字段
						if val == "" {
							for k, v := range r {
								if strings.ToUpper(k) != "CNT" && strings.ToLower(k) != "cnt" && v != nil {
									val = fmt.Sprintf("%v", v)
									break
								}
							}
						}
						for _, key := range []string{"cnt", "CNT", "count", "COUNT"} {
							if v, ok := r[key]; ok && v != nil {
								cnt, _ = v.(float64)
								break
							}
						}
						if val != "" {
							topVals = append(topVals, map[string]interface{}{
								"value": val,
								"count": int(cnt),
							})
						}
					}
					prof.TopValues = topVals
				}
			}
		}

		columns = append(columns, prof)
	}

	// 5. 组装返回 JSON
	result := map[string]interface{}{
		"table_name": tableName,
		"row_count":  int(rowCount),
		"columns":    columns,
	}
	resultData, _ := json.Marshal(result)
	return mcpTextResult(string(resultData)), nil, nil
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
	return mcpTextResult(string(trimMCPResult("execute_sql", data))), nil, nil
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
	return mcpTextResult(string(trimMCPResult("list_apis", data))), nil, nil
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
	// 后端 retrieval/search 只接受 GET + query + database_id 参数
	searchURL := "/api/v1/retrieval/search?query=" + url.QueryEscape(in.Query)
	if in.DatabaseID != "" {
		searchURL += "&database_id=" + url.QueryEscape(in.DatabaseID)
	}
	data, err := cli.do(http.MethodGet, searchURL, nil)
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
	return mcpTextResult(string(trimMCPResult("get_db_schema", data))), nil, nil
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

// ─── create_dashboard：一键生成数据看板 ────────────────────────────────────

// fieldSemantic 根据字段名推断语义类型：numeric/date/category/geo/text
func fieldSemantic(colName, colType string) string {
	lower := strings.ToLower(colName)

	// 地理坐标字段
	geoHints := []string{"lat", "lng", "lon", "latitude", "longitude", "geo", "coords", "coord"}
	for _, h := range geoHints {
		if strings.Contains(lower, h) {
			return "geo"
		}
	}

	// 日期/时间字段（按名称推断）
	dateNameHints := []string{"date", "time", "created_at", "updated_at", "timestamp", "datetime", "_at", "_date", "_time", "year", "month", "week"}
	for _, h := range dateNameHints {
		if strings.Contains(lower, h) {
			return "date"
		}
	}
	// 按类型推断
	if isDateType(colType) {
		return "date"
	}

	// 数值字段（按名称推断）
	numNameHints := []string{"amount", "price", "total", "cost", "revenue", "sales", "profit", "quantity", "qty", "count", "sum", "avg", "rate", "score", "salary", "budget", "fee", "value", "num", "income", "expense", "discount", "margin", "weight", "age"}
	for _, h := range numNameHints {
		if strings.Contains(lower, h) {
			return "numeric"
		}
	}
	// 按类型推断
	if isNumericType("", colType) {
		return "numeric"
	}

	// 分类字段（按名称推断）
	catNameHints := []string{"name", "category", "type", "status", "region", "country", "city", "province", "state", "department", "group", "level", "grade", "class", "label", "tag", "brand", "source", "channel", "priority"}
	for _, h := range catNameHints {
		if strings.Contains(lower, h) {
			return "category"
		}
	}
	// 字符串类型默认视为分类
	if isStringType(colType) {
		return "category"
	}

	return "text"
}

// selectComponents 根据表字段语义自动选择 3-5 个组件，返回组件实例列表
func selectComponents(tableName string, columns []map[string]interface{}) []components.ComponentInstance {
	// 分类字段
	var numericFields []string
	var dateFields []string
	var categoryFields []string
	var geoFields []string
	var allFields []string

	for _, col := range columns {
		name, _ := col["name"].(string)
		colType, _ := col["type"].(string)
		if name == "" {
			continue
		}
		allFields = append(allFields, name)
		sem := fieldSemantic(name, colType)
		switch sem {
		case "numeric":
			numericFields = append(numericFields, name)
		case "date":
			dateFields = append(dateFields, name)
		case "category":
			categoryFields = append(categoryFields, name)
		case "geo":
			geoFields = append(geoFields, name)
		}
	}

	// 构建 API URL
	apiURL := fmt.Sprintf("/api/v1/gov/execute-sql?database_id={{database_id}}&sql=SELECT+*+FROM+%s+LIMIT+1000", tableName)

	var comps []components.ComponentInstance

	// 1. 有数值字段 + 时间字段 → chart-line（趋势图）
	if len(numericFields) > 0 && len(dateFields) > 0 {
		yFields := numericFields
		if len(yFields) > 3 {
			yFields = yFields[:3]
		}
		yFieldsStr := strings.Join(yFields, ",")
		comps = append(comps, components.ComponentInstance{
			ComponentID: "chart-line",
			Config: map[string]interface{}{
				"title":       "趋势分析",
				"data_source": apiURL,
				"x_field":     dateFields[0],
				"y_fields":    yFieldsStr,
				"smooth":      true,
				"height":      350,
			},
		})
	}

	// 2. 有数值字段 + 分类字段 → chart-bar（柱状图）
	if len(numericFields) > 0 && len(categoryFields) > 0 {
		yFields := numericFields
		if len(yFields) > 3 {
			yFields = yFields[:3]
		}
		yFieldsStr := strings.Join(yFields, ",")
		comps = append(comps, components.ComponentInstance{
			ComponentID: "chart-bar",
			Config: map[string]interface{}{
				"title":       "分类统计",
				"data_source": apiURL,
				"x_field":     categoryFields[0],
				"y_fields":    yFieldsStr,
				"mode":        "grouped",
				"height":      350,
			},
		})

		// 2b. 如果有分类字段，且分类值 ≤ 10，加一个饼图
		if len(categoryFields) > 0 && len(numericFields) > 0 {
			comps = append(comps, components.ComponentInstance{
				ComponentID: "chart-pie",
				Config: map[string]interface{}{
					"title":       "占比分析",
					"data_source": apiURL,
					"name_field":  categoryFields[0],
					"value_field": numericFields[0],
					"ring":        true,
					"height":      350,
				},
			})
		}
	}

	// 3. 有数值字段 → kpi-card（KPI 卡片）
	if len(numericFields) > 0 {
		metrics := []map[string]interface{}{}
		displayFields := numericFields
		if len(displayFields) > 4 {
			displayFields = displayFields[:4]
		}
		colors := []string{"#4F46E5", "#10B981", "#F59E0B", "#EF4444"}
		for i, f := range displayFields {
			metric := map[string]interface{}{
				"label": f,
				"field": f,
				"color": colors[i%len(colors)],
			}
			// 推断后缀
			lower := strings.ToLower(f)
			if strings.Contains(lower, "price") || strings.Contains(lower, "cost") || strings.Contains(lower, "revenue") || strings.Contains(lower, "amount") {
				metric["prefix"] = "¥"
			}
			if strings.Contains(lower, "rate") || strings.Contains(lower, "percent") || strings.Contains(lower, "ratio") {
				metric["suffix"] = "%"
			}
			metrics = append(metrics, metric)
		}
		comps = append(comps, components.ComponentInstance{
			ComponentID: "kpi-card",
			Config: map[string]interface{}{
				"title":       "关键指标",
				"data_source": apiURL,
				"metrics":     metrics,
				"columns":     fmt.Sprintf("%d", len(displayFields)),
			},
		})
	}

	// 4. 总是有 → data-table（明细表）
	tableColumns := []map[string]interface{}{}
	displayAll := allFields
	if len(displayAll) > 10 {
		displayAll = displayAll[:10]
	}
	for _, f := range displayAll {
		col := map[string]interface{}{
			"field": f,
			"label": f,
			"width": "auto",
		}
		// 数值列右对齐 + 可排序
		for _, nf := range numericFields {
			if nf == f {
				col["align"] = "right"
				col["sortable"] = true
				col["render"] = "number"
				break
			}
		}
		tableColumns = append(tableColumns, col)
	}
	comps = append(comps, components.ComponentInstance{
		ComponentID: "data-table",
		Config: map[string]interface{}{
			"title":       "数据明细",
			"data_source": apiURL,
			"columns":     tableColumns,
			"page_size":   20,
			"show_search": true,
			"stripe":      true,
		},
	})

	// 5. 有地理坐标字段 → map-scatter
	if len(geoFields) > 0 {
		latField := ""
		lngField := ""
		for _, g := range geoFields {
			lower := strings.ToLower(g)
			if strings.Contains(lower, "lat") && latField == "" {
				latField = g
			}
			if (strings.Contains(lower, "lng") || strings.Contains(lower, "lon")) && lngField == "" {
				lngField = g
			}
		}
		if latField != "" && lngField != "" {
			comps = append(comps, components.ComponentInstance{
				ComponentID: "map-scatter",
				Config: map[string]interface{}{
					"title":       "地理分布",
					"data_source": apiURL,
					"lat_field":   latField,
					"lng_field":   lngField,
					"height":      400,
				},
			})
		}
	}

	// 限制最多 5 个组件
	if len(comps) > 5 {
		comps = comps[:5]
	}

	return comps
}

func mcpCreateDashboard(ctx context.Context, req *mcp.CallToolRequest, in createDashboardIn) (*mcp.CallToolResult, any, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, nil, err
	}

	// 1. 调用 profile_table 获取表结构
	tableName := strings.Trim(in.TableName, "\"`'")

	// 获取数据库类型
	dbData, err := cli.do(http.MethodGet, "/api/v1/databases/"+in.DatabaseID, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("获取数据库信息失败: %w", err)
	}
	var dbInfo struct {
		Success bool `json:"success"`
		Data    struct {
			Type string `json:"type"`
		} `json:"data"`
	}
	if err := json.Unmarshal(dbData, &dbInfo); err != nil {
		return nil, nil, fmt.Errorf("解析数据库信息失败: %w", err)
	}
	dbType := dbInfo.Data.Type

	// 获取行数
	quotedTable := quoteIdentifier(dbType, tableName)
	countSQL := fmt.Sprintf("SELECT COUNT(*) AS row_count FROM %s", quotedTable)
	countBody, _ := json.Marshal(map[string]interface{}{
		"database_id": in.DatabaseID,
		"sql":         countSQL,
	})
	countData, err := cli.do(http.MethodPost, "/api/v1/gov/execute-sql", countBody)
	if err != nil {
		return nil, nil, fmt.Errorf("获取行数失败: %w", err)
	}
	var countResp struct {
		Rows []map[string]interface{} `json:"rows"`
	}
	if err := json.Unmarshal(countData, &countResp); err != nil {
		return nil, nil, fmt.Errorf("解析行数结果失败: %w", err)
	}
	var rowCount float64
	if len(countResp.Rows) > 0 {
		for _, key := range []string{"row_count", "ROW_COUNT"} {
			if v, ok := countResp.Rows[0][key]; ok && v != nil {
				rowCount, _ = v.(float64)
				break
			}
		}
	}

	// 获取表结构（列名和类型）
	var descSQL string
	switch strings.ToLower(dbType) {
	case "dm":
		descSQL = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", strings.ToUpper(tableName))
	case "mysql":
		descSQL = "DESCRIBE `" + tableName + "`"
	case "postgres", "postgresql":
		descSQL = fmt.Sprintf("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '%s' ORDER BY ordinal_position", tableName)
	default:
		descSQL = "DESCRIBE `" + tableName + "`"
	}
	descBody, _ := json.Marshal(map[string]interface{}{
		"database_id": in.DatabaseID,
		"sql":         descSQL,
	})
	descData, err := cli.do(http.MethodPost, "/api/v1/gov/execute-sql", descBody)
	if err != nil {
		return nil, nil, fmt.Errorf("获取表结构失败: %w", err)
	}
	var descResp struct {
		Rows []map[string]interface{} `json:"rows"`
	}
	if err := json.Unmarshal(descData, &descResp); err != nil {
		return nil, nil, fmt.Errorf("解析表结构失败: %w", err)
	}

	// 提取列信息
	columns := []map[string]interface{}{}
	for _, row := range descResp.Rows {
		colName := ""
		colType := ""
		for _, key := range []string{"COLUMN_NAME", "column_name", "Field", "COLUMN_NAME "} {
			if v, ok := row[key]; ok && v != nil {
				colName = fmt.Sprintf("%v", v)
				break
			}
		}
		for _, key := range []string{"DATA_TYPE", "data_type", "Type", "DATA_TYPE "} {
			if v, ok := row[key]; ok && v != nil {
				colType = fmt.Sprintf("%v", v)
				break
			}
		}
		if colName == "" {
			continue
		}
		columns = append(columns, map[string]interface{}{
			"name": colName,
			"type": colType,
		})
	}

	if len(columns) == 0 {
		return nil, nil, fmt.Errorf("表 %s 无可用字段", tableName)
	}

	// 2. 根据字段自动选择组件
	comps := selectComponents(tableName, columns)

	if len(comps) == 0 {
		return nil, nil, fmt.Errorf("无法为表 %s 自动选择组件", tableName)
	}

	// 3. 确定看板名称和 slug
	dashboardName := in.DashboardName
	if dashboardName == "" {
		dashboardName = tableName + " 看板"
	}
	// 生成 slug：只保留字母数字中划线
	slug := strings.ToLower(tableName)
	slug = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			return r
		}
		if r == '_' || r == ' ' {
			return '-'
		}
		return -1
	}, slug)
	slug = slug + "-dashboard"
	// 去除连续的 -
	for strings.Contains(slug, "--") {
		slug = strings.ReplaceAll(slug, "--", "-")
	}
	slug = strings.Trim(slug, "-")

	designDirection := in.DesignDirection
	if designDirection == "" {
		designDirection = "minimal"
	}

	// 4. 组装蓝图
	blueprint := components.AppBlueprint{
		Title:           dashboardName,
		Slug:            slug,
		Description:     fmt.Sprintf("自动生成的 %s 数据看板，共 %d 行数据，%d 个组件", tableName, int(rowCount), len(comps)),
		Icon:            "📊",
		DesignDirection: designDirection,
		Components:      comps,
	}

	// 首次调用（confirmed=false）：生成预览
	if !in.Confirmed {
		// 生成配置字段
		configFields := []map[string]interface{}{}
		for _, c := range comps {
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

		// 列出选中的组件摘要
		componentSummary := []map[string]interface{}{}
		for _, c := range comps {
			def, _ := components.GetComponentDef(c.ComponentID)
			name := c.ComponentID
			icon := "📦"
			if def != nil {
				name = def.Name
				icon = def.Icon
			}
			componentSummary = append(componentSummary, map[string]interface{}{
				"component_id":   c.ComponentID,
				"component_name": name,
				"icon":           icon,
			})
		}

		result := map[string]interface{}{
			"action": "preview",
			"dashboard_info": map[string]interface{}{
				"table_name":      tableName,
				"row_count":       int(rowCount),
				"column_count":    len(columns),
				"columns":         columns,
				"component_count": len(comps),
				"components":      componentSummary,
			},
			"config_fields": configFields,
			"blueprint":     blueprint,
			"message":       fmt.Sprintf("📊 看板预览已生成！表 %s 共 %d 行 %d 列，自动选择 %d 个组件。请立即调用 ask_user 工具（interaction_type=\"preview\"），传入 blueprint 和 config_fields。用户确认后再次调用 create_dashboard(confirmed=true) 即可正式创建。", tableName, int(rowCount), len(columns), len(comps)),
		}
		data, _ := json.Marshal(result)
		return mcpTextResult(string(data)), nil, nil
	}

	// HITL 已确认：正式创建看板应用
	primaryColor := "#4F46E5"
	if designDirection == "dark" {
		primaryColor = "#818CF8"
	} else if designDirection == "nature" {
		primaryColor = "#059669"
	}
	html := components.AssembleAppPage(blueprint, primaryColor)

	reqBody := map[string]interface{}{
		"name":        dashboardName,
		"title":       dashboardName,
		"slug":        slug,
		"description": blueprint.Description,
		"icon":        "📊",
		"html":        html,
		"is_public":   true,
		"config": map[string]interface{}{
			"blueprint": map[string]interface{}{
				"design_direction": designDirection,
				"primary_color":    primaryColor,
				"components":       comps,
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
		return nil, nil, fmt.Errorf("创建看板应用请求失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return nil, nil, fmt.Errorf("创建看板应用失败 (%d): %s", resp.StatusCode, string(respBody))
	}

	return mcpTextResult(fmt.Sprintf("✅ 看板 %q 已创建！访问地址: /app/%s\n组件: %d 个 | 数据行数: %d | 设计: %s", dashboardName, slug, len(comps), int(rowCount), designDirection)), nil, nil
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

// ─── ask_user HITL 工具 ─────────────────────────────────────────────────────────

// mcpAskUser 实现 MCP 版本的 ask_user 工具
// 通过创建虚拟 agent run + HITLManager 注册请求，让前端能通过轮询机制看到 HITL 交互
// 阻塞等待用户响应后返回结果
func mcpAskUser(ctx context.Context, req *mcp.CallToolRequest, in askUserIn) (*mcp.CallToolResult, any, error) {
	if globalHITLManager == nil {
		return nil, nil, fmt.Errorf("HITL 管理器未初始化")
	}

	sessionID := in.SessionID
	if sessionID == "" {
		sessionID = "default"
	}

	// 1. 创建虚拟 agent run（让前端轮询能发现）
	runID := uuid.New().String()
	run := &AgentRun{
		ID:        runID,
		SessionID: sessionID,
		Username:  "mcp",
		Status:    "waiting_hitl",
	}
	if err := sqlCreateAgentRun(run); err != nil {
		log.Printf("[mcp-ask_user] 创建虚拟 agent run 失败: %v", err)
		// 不阻断，继续执行
	}

	// 2. 转换选项和字段
	var hitlOptions []agent.HITLOption
	for _, o := range in.Options {
		hitlOptions = append(hitlOptions, agent.HITLOption{
			ID:          o.ID,
			Label:       o.Label,
			Description: o.Description,
			Style:       o.Style,
		})
	}

	var hitlFields []agent.HITLField
	for _, f := range in.Fields {
		var fieldOpts []agent.HITLOption
		for _, o := range f.Options {
			fieldOpts = append(fieldOpts, agent.HITLOption{
				ID:          o.ID,
				Label:       o.Label,
				Description: o.Description,
				Style:       o.Style,
			})
		}
		hitlFields = append(hitlFields, agent.HITLField{
			ID:           f.ID,
			Label:        f.Label,
			Type:         f.Type,
			Placeholder:  f.Placeholder,
			Required:     f.Required,
			DefaultValue: f.DefaultValue,
			Options:      fieldOpts,
		})
	}

	timeoutSeconds := in.TimeoutSeconds
	if timeoutSeconds <= 0 {
		timeoutSeconds = 86400 // 默认 24 小时
	}

	// 3. 注册 HITL 请求
	hitlID := uuid.New().String()
	hitlReq := agent.HITLRequest{
		ID:              hitlID,
		SessionID:       sessionID,
		InteractionType: agent.HITLInteractionType(in.InteractionType),
		Title:           in.Title,
		Description:     in.Description,
		Options:         hitlOptions,
		Fields:          hitlFields,
		TimeoutSeconds:  timeoutSeconds,
		CreatedAt:       time.Now(),
	}
	respCh := globalHITLManager.RegisterRequest(hitlReq)

	// 4. 写入 hitl_interaction 事件到 DB（前端轮询能看到）
	evtData := map[string]interface{}{
		"hitl_id":         hitlID,
		"session_id":      sessionID,
		"interaction_type": in.InteractionType,
		"title":           in.Title,
		"description":     in.Description,
		"options":         hitlOptions,
		"fields":          hitlFields,
		"timeout_seconds": timeoutSeconds,
		"request_json":    mustMarshal(hitlReq),
	}
	evtDataJSON, _ := json.Marshal(evtData)
	_ = sqlAppendAgentEvent(runID, 0, "hitl_interaction", string(evtDataJSON))

	log.Printf("[mcp-ask_user] HITL 请求已注册: hitl_id=%s, session=%s, type=%s, run_id=%s", hitlID, sessionID, in.InteractionType, runID)

	// 5. 阻塞等待用户响应
	select {
	case resp := <-respCh:
		log.Printf("[mcp-ask_user] 收到用户响应: hitl_id=%s, action=%s", hitlID, resp.Action)

		// 更新 agent run 状态
		if resp.Action == "submit" {
			_ = sqlUpdateAgentRunStatus(runID, "completed", "")
		} else if resp.Action == "cancel" {
			_ = sqlUpdateAgentRunStatus(runID, "cancelled", "")
		} else {
			_ = sqlUpdateAgentRunStatus(runID, "error", resp.Action)
		}
		doneData, _ := json.Marshal(map[string]interface{}{"action": resp.Action})
		_ = sqlAppendAgentEvent(runID, 1, "done", string(doneData))

		if resp.Action == "cancel" {
			return mcpTextResult(fmt.Sprintf("User cancelled the request.")), nil, nil
		}
		if resp.Action == "timeout" {
			return mcpTextResult(fmt.Sprintf("Request timed out after %d seconds.", timeoutSeconds)), nil, nil
		}

		// 正常提交 — 返回用户响应
		respJSON, _ := json.MarshalIndent(resp, "", "  ")
		return mcpTextResult(fmt.Sprintf("User responded:\n%s", string(respJSON))), nil, nil

	case <-ctx.Done():
		log.Printf("[mcp-ask_user] 上下文取消: hitl_id=%s, err=%v", hitlID, ctx.Err())
		_ = sqlUpdateAgentRunStatus(runID, "error", "context cancelled")
		return mcpTextResult(fmt.Sprintf("Request cancelled: %v", ctx.Err())), nil, nil
	}
}

// mustMarshal 将对象序列化为 JSON 字符串，失败返回空字符串
func mustMarshal(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

// ─── 应用模板工具 ────────────────────────────────────────────────────────────

func mcpListTemplates(ctx context.Context, req *mcp.CallToolRequest, in listTemplatesIn) (*mcp.CallToolResult, any, error) {
	list := templates.ListTemplatesFlat()

	// 按分类筛选
	if in.Category != "" {
		filtered := make([]*templates.AppTemplate, 0)
		for _, t := range list {
			if t.Category == in.Category {
				filtered = append(filtered, t)
			}
		}
		list = filtered
	}

	// 构建精简摘要（不返回完整 JSON，避免 token 浪费）
	type templateSummary struct {
		ID              string            `json:"id"`
		Name            string            `json:"name"`
		Category        string            `json:"category"`
		Icon            string            `json:"icon"`
		Description     string            `json:"description"`
		Tags            []string          `json:"tags"`
		RequiredTables  map[string]string `json:"required_tables"`
		Variants        []string          `json:"variants,omitempty"`
	}

	summaries := make([]templateSummary, 0, len(list))
	for _, t := range list {
		s := templateSummary{
			ID:         t.ID,
			Name:       t.Name,
			Category:   t.Category,
			Icon:       t.Icon,
			Description: t.Description,
			Tags:       t.Tags,
		}
		// 简化 required_tables：只保留表名和描述
		s.RequiredTables = make(map[string]string)
		for k, v := range t.RequiredTables {
			s.RequiredTables[k] = v.Description + " (需要: " + strings.Join(v.RequiredColumns, ", ") + ")"
		}
		// 图表变体
		if t.ChartVariants != nil {
			for k := range t.ChartVariants {
				s.Variants = append(s.Variants, k)
			}
		}
		summaries = append(summaries, s)
	}

	data, _ := json.Marshal(summaries)
	return mcpTextResult(string(data)), nil, nil
}

func mcpCreateAppFromTemplate(ctx context.Context, req *mcp.CallToolRequest, in createAppFromTemplateIn) (*mcp.CallToolResult, any, error) {
	// 实例化模板
	blueprint, err := templates.Instantiate(in.TemplateID, in.DatabaseID, in.TableNameMap, in.Variant)
	if err != nil {
		return nil, nil, err
	}

	// 用户自定义覆盖
	if in.Title != "" {
		blueprint.Title = in.Title
	}
	if in.DesignDirection != "" {
		blueprint.DesignDirection = in.DesignDirection
	}
	if in.PrimaryColor != "" {
		blueprint.PrimaryColor = in.PrimaryColor
	}

	// 转为 createAppFromBlueprintIn 复用已有创建逻辑
	compInstances := make([]components.ComponentInstance, 0, len(blueprint.Components))
	for _, c := range blueprint.Components {
		compInstances = append(compInstances, components.ComponentInstance{
			ComponentID: c.ComponentID,
			Config:      c.Config,
		})
	}

	appIn := createAppFromBlueprintIn{
		Title:           blueprint.Title,
		Slug:            blueprint.Slug,
		Description:     blueprint.Description,
		Icon:            blueprint.Icon,
		DesignDirection: blueprint.DesignDirection,
		PrimaryColor:    blueprint.PrimaryColor,
		IsPublic:        in.IsPublic,
		Confirmed:       in.Confirmed,
		Components:      compInstances,
	}

	// 复用 create_app 的完整逻辑（预览 + HITL + 创建）
	return mcpCreateAppFromBlueprint(ctx, req, appIn)
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

		// 注册所有 18 个工具
		mcp.AddTool(server, &mcp.Tool{Name: "list_databases", Description: "列出数据本体池中已配置的数据库（不含密码）"}, mcpListDatabases)
		mcp.AddTool(server, &mcp.Tool{Name: "get_tables", Description: "获取指定数据库的表列表及连接状态"}, mcpGetTables)
		mcp.AddTool(server, &mcp.Tool{Name: "describe_table", Description: "获取表的列结构（字段名、类型、键信息）"}, mcpDescribeTable)
		mcp.AddTool(server, &mcp.Tool{Name: "profile_table", Description: "获取表的数据概览：行数、空值率、数值统计、高频值等"}, mcpProfileTable)
		mcp.AddTool(server, &mcp.Tool{Name: "execute_sql", Description: "执行SQL。SELECT返回结果；写操作返回影响行数，谨慎使用"}, mcpExecuteSQL)
		mcp.AddTool(server, &mcp.Tool{Name: "list_apis", Description: "列出已配置的接口"}, mcpListApis)
		mcp.AddTool(server, &mcp.Tool{Name: "get_api_detail", Description: "获取接口详情（SQL、参数、描述）"}, mcpGetApiDetail)
		mcp.AddTool(server, &mcp.Tool{Name: "call_api", Description: "调用接口，传入ID和params"}, mcpCallApi)
		mcp.AddTool(server, &mcp.Tool{Name: "search_tables", Description: "关键词搜索表"}, mcpSearchTables)
		mcp.AddTool(server, &mcp.Tool{Name: "get_db_schema", Description: "获取数据库完整schema"}, mcpGetDbSchema)
		mcp.AddTool(server, &mcp.Tool{Name: "get_db_sql_hints", Description: "获取数据库SQL方言提示"}, mcpGetDbSQLHints)
		mcp.AddTool(server, &mcp.Tool{Name: "create_api", Description: "创建数据接口（需先ask_user确认）"}, mcpCreateApi)
		mcp.AddTool(server, &mcp.Tool{Name: "execute_api", Description: "通过路径调用接口"}, mcpExecuteApi)

		// 应用管理工具（create_app 已内含组件列表和设计方向，无需单独调用 list_components/design_theme）
		mcp.AddTool(server, &mcp.Tool{Name: "create_app", Description: `基于预制组件创建可视化应用。confirmed=false预览→ask_user(preview)→confirmed=true正式创建。组件:chart-bar/line/pie/area/gauge/combo/heatmap,data-table,kpi-card,dashboard-summary,filter-bar,map-scatter/map-choropleth,timeline。设计:minimal/corporate/vibrant/elegant/playful/dark/nature/brutalist`}, mcpCreateAppFromBlueprint)
		mcp.AddTool(server, &mcp.Tool{Name: "create_dashboard", Description: `一键生成数据看板：自动根据表结构选择组件，组合成完整看板页面。confirmed=false预览→ask_user(preview)→confirmed=true正式创建。设计:minimal/corporate/vibrant/elegant/playful/dark/nature/brutalist`}, mcpCreateDashboard)
		mcp.AddTool(server, &mcp.Tool{Name: "list_templates", Description: `列出预制应用模板。模板是预配置的组件组合，智能助手只需指定模板ID和表名映射即可生成高质量应用，无需逐个配置组件。分类：dashboard(看板)/single(单组件)`}, mcpListTemplates)
		mcp.AddTool(server, &mcp.Tool{Name: "create_app_from_template", Description: `从预制模板创建应用。只需指定模板ID+数据库ID+表名映射，自动填充组件配置。confirmed=false预览→ask_user(preview)→confirmed=true正式创建。模板ID见list_templates返回`}, mcpCreateAppFromTemplate)
		mcp.AddTool(server, &mcp.Tool{Name: "list_apps", Description: "列出所有应用"}, mcpListApps)
		mcp.AddTool(server, &mcp.Tool{Name: "update_app", Description: "更新已有应用"}, mcpUpdateApp)
		mcp.AddTool(server, &mcp.Tool{Name: "delete_app", Description: "删除指定应用"}, mcpDeleteApp)
		mcp.AddTool(server, &mcp.Tool{Name: "ask_user", Description: `向用户提问并等待响应。交互类型：confirm(是/否确认)/single_select(单选)/multi_select(多选)/input(填空)/form(多字段表单)。危险操作前必须用confirm确认；需要用户选择时用single_select/multi_select；需要多个输入时用form。工具会阻塞直到用户响应或超时`}, mcpAskUser)

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
	// Stdio 模式注册所有 18 个工具（与 HTTP 模式一致）
	mcp.AddTool(server, &mcp.Tool{Name: "list_databases", Description: "列出已配置的数据库"}, mcpListDatabases)
	mcp.AddTool(server, &mcp.Tool{Name: "get_tables", Description: "获取指定数据库的表列表"}, mcpGetTables)
	mcp.AddTool(server, &mcp.Tool{Name: "describe_table", Description: "获取表的列结构"}, mcpDescribeTable)
	mcp.AddTool(server, &mcp.Tool{Name: "profile_table", Description: "获取表的数据概览：行数、空值率、数值统计、高频值等"}, mcpProfileTable)
	mcp.AddTool(server, &mcp.Tool{Name: "execute_sql", Description: "执行SQL语句"}, mcpExecuteSQL)
	mcp.AddTool(server, &mcp.Tool{Name: "list_apis", Description: "列出已配置的接口"}, mcpListApis)
	mcp.AddTool(server, &mcp.Tool{Name: "get_api_detail", Description: "获取接口详情"}, mcpGetApiDetail)
	mcp.AddTool(server, &mcp.Tool{Name: "call_api", Description: "调用接口"}, mcpCallApi)
	mcp.AddTool(server, &mcp.Tool{Name: "search_tables", Description: "关键词搜索表"}, mcpSearchTables)
	mcp.AddTool(server, &mcp.Tool{Name: "get_db_schema", Description: "获取数据库完整schema"}, mcpGetDbSchema)
	mcp.AddTool(server, &mcp.Tool{Name: "get_db_sql_hints", Description: "获取数据库SQL方言提示"}, mcpGetDbSQLHints)
	mcp.AddTool(server, &mcp.Tool{Name: "create_api", Description: "创建数据接口"}, mcpCreateApi)
	mcp.AddTool(server, &mcp.Tool{Name: "execute_api", Description: "通过路径调用接口"}, mcpExecuteApi)

	// 应用管理工具
	mcp.AddTool(server, &mcp.Tool{Name: "create_app", Description: `基于预制组件创建可视化应用。confirmed=false预览→ask_user(preview)→confirmed=true正式创建。组件:chart-bar/line/pie/area/gauge/combo/heatmap,data-table,kpi-card,dashboard-summary,filter-bar,map-scatter/map-choropleth,timeline。设计:minimal/corporate/vibrant/elegant/playful/dark/nature/brutalist`}, mcpCreateAppFromBlueprint)
	mcp.AddTool(server, &mcp.Tool{Name: "create_dashboard", Description: `一键生成数据看板：自动根据表结构选择组件，组合成完整看板页面。confirmed=false预览→ask_user(preview)→confirmed=true正式创建。设计:minimal/corporate/vibrant/elegant/playful/dark/nature/brutalist`}, mcpCreateDashboard)
	mcp.AddTool(server, &mcp.Tool{Name: "list_apps", Description: "列出所有应用"}, mcpListApps)
	mcp.AddTool(server, &mcp.Tool{Name: "update_app", Description: "更新已有应用"}, mcpUpdateApp)
	mcp.AddTool(server, &mcp.Tool{Name: "delete_app", Description: "删除指定应用"}, mcpDeleteApp)
	mcp.AddTool(server, &mcp.Tool{Name: "ask_user", Description: `向用户提问并等待响应。交互类型：confirm(是/否确认)/single_select(单选)/multi_select(多选)/input(填空)/form(多字段表单)。危险操作前必须用confirm确认；需要用户选择时用single_select/multi_select；需要多个输入时用form。工具会阻塞直到用户响应或超时`}, mcpAskUser)

	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		fmt.Fprintf(os.Stderr, "MCP 运行错误: %v\n", err)
		os.Exit(1)
	}
}

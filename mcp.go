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
	"net/http"
	"net/url"
	"os"
	"strings"

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
		baseURL = "http://127.0.0.1:8080"
	}
	baseURL = strings.TrimSuffix(baseURL, "/")
	apiKey := os.Getenv("DATA_ONTOLOGY_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("请设置环境变量 DATA_ONTOLOGY_API_KEY（在数据本体池中生成 API Key）")
	}
	return &mcpClient{
		baseURL: baseURL,
		apiKey:  apiKey,
		client:  &http.Client{Timeout: HTTPClientTimeout},
	}, nil
}

func (c *mcpClient) do(method, path string, body []byte) ([]byte, error) {
	reqURL := c.baseURL + path
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
		baseURL: mcpLoopbackAddr,
		apiKey:  apiKey,
		client:  &http.Client{Timeout: HTTPClientTimeout},
	}
}

// ─── HTTP 模式：使用 go-sdk StreamableHTTPHandler ────────────────────────────
// 替换旧的手写 JSON-RPC 端点，使用 go-sdk 标准实现，兼容 PicoClaw 的 streamable-http transport。
// 使用 Stateless + JSONResponse 模式：每个请求创建临时会话，返回 application/json 响应。

// mcpOutput 是工具函数的输出类型
type mcpOutput struct {
	Result string `json:"result"`
}

// ─── 工具输入类型定义 ─────────────────────────────────────────────────────────

type listDatabasesIn struct{}

type getTablesIn struct {
	DatabaseID string `json:"database_id" jsonschema:"required,description=数据库 ID"`
}

type describeTableIn struct {
	DatabaseID string `json:"database_id" jsonschema:"required,description=数据库 ID"`
	TableName  string `json:"table_name" jsonschema:"required,description=表名"`
}

type executeSQLIn struct {
	DatabaseID string        `json:"database_id" jsonschema:"required,description=数据库 ID"`
	SQL        string        `json:"sql" jsonschema:"required,description=要执行的 SQL 语句"`
	Params     []interface{} `json:"params" jsonschema:"description=SQL 占位符参数（可选）"`
}

type listApisIn struct{}

type getApiDetailIn struct {
	ApiID string `json:"api_id" jsonschema:"required,description=接口 ID"`
}

type callApiIn struct {
	ApiID  string                 `json:"api_id" jsonschema:"required,description=接口 ID"`
	Params map[string]interface{} `json:"params" jsonschema:"description=请求参数，与接口 SQL 中占位符对应"`
}

type searchTablesIn struct {
	Query    string `json:"query" jsonschema:"required,description=搜索关键词"`
	Database string `json:"database" jsonschema:"description=数据库名称（可选，用于限定搜索范围）"`
}

type getDbSchemaIn struct {
	DatabaseID string `json:"database_id" jsonschema:"required,description=数据库 ID"`
}

type getDbSQLHintsIn struct {
	DatabaseID string `json:"database_id" jsonschema:"required,description=数据库 ID"`
}

type createApiIn struct {
	Name          string                 `json:"name" jsonschema:"required,description=接口名称"`
	Path          string                 `json:"path" jsonschema:"required,description=接口路径（如 /api/users）"`
	Method        string                 `json:"method" jsonschema:"required,description=HTTP 方法（GET/POST 等）"`
	SQL           string                 `json:"sql" jsonschema:"required,description=接口关联的 SQL 语句"`
	Description   string                 `json:"description" jsonschema:"description=接口描述"`
	Database      string                 `json:"database" jsonschema:"required,description=数据库名称"`
	DefaultParams map[string]interface{} `json:"default_params" jsonschema:"description=默认参数定义"`
}

type executeApiIn struct {
	Path   string                 `json:"path" jsonschema:"required,description=接口路径（如 /users）"`
	Params map[string]interface{} `json:"params" jsonschema:"description=查询参数"`
}

// ─── 工具处理函数（HTTP 模式和 Stdio 模式共用） ──────────────────────────────

func mcpListDatabases(ctx context.Context, req *mcp.CallToolRequest, _ listDatabasesIn) (*mcp.CallToolResult, mcpOutput, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	data, err := cli.do(http.MethodGet, "/api/databases", nil)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	return nil, mcpOutput{Result: string(data)}, nil
}

func mcpGetTables(ctx context.Context, req *mcp.CallToolRequest, in getTablesIn) (*mcp.CallToolResult, mcpOutput, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	data, err := cli.do(http.MethodGet, "/api/databases/"+in.DatabaseID, nil)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	return nil, mcpOutput{Result: string(data)}, nil
}

func mcpDescribeTable(ctx context.Context, req *mcp.CallToolRequest, in describeTableIn) (*mcp.CallToolResult, mcpOutput, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	body, _ := json.Marshal(map[string]interface{}{
		"database_id": in.DatabaseID,
		"sql":         "DESCRIBE `" + in.TableName + "`",
	})
	data, err := cli.do(http.MethodPost, "/api/governance/execute-sql", body)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	return nil, mcpOutput{Result: string(data)}, nil
}

func mcpExecuteSQL(ctx context.Context, req *mcp.CallToolRequest, in executeSQLIn) (*mcp.CallToolResult, mcpOutput, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	// SQL 安全检查
	if allowed, reason := checkSQLSafety(in.SQL); !allowed {
		return nil, mcpOutput{}, fmt.Errorf("SQL 安全检查失败: %s", reason)
	}
	body, _ := json.Marshal(map[string]interface{}{
		"database_id": in.DatabaseID,
		"sql":         in.SQL,
		"params":      in.Params,
	})
	data, err := cli.do(http.MethodPost, "/api/governance/execute-sql", body)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	return nil, mcpOutput{Result: string(data)}, nil
}

func mcpListApis(ctx context.Context, req *mcp.CallToolRequest, _ listApisIn) (*mcp.CallToolResult, mcpOutput, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	data, err := cli.do(http.MethodGet, "/api/apis", nil)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	return nil, mcpOutput{Result: string(data)}, nil
}

func mcpGetApiDetail(ctx context.Context, req *mcp.CallToolRequest, in getApiDetailIn) (*mcp.CallToolResult, mcpOutput, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	data, err := cli.do(http.MethodGet, "/api/apis/"+in.ApiID, nil)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	return nil, mcpOutput{Result: string(data)}, nil
}

func mcpCallApi(ctx context.Context, req *mcp.CallToolRequest, in callApiIn) (*mcp.CallToolResult, mcpOutput, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	body, _ := json.Marshal(map[string]interface{}{"params": in.Params})
	if body == nil {
		body = []byte(`{"params":{}}`)
	}
	data, err := cli.do(http.MethodPost, "/api/apis/"+in.ApiID+"/test", body)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	return nil, mcpOutput{Result: string(data)}, nil
}

func mcpSearchTables(ctx context.Context, req *mcp.CallToolRequest, in searchTablesIn) (*mcp.CallToolResult, mcpOutput, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	reqBody, _ := json.Marshal(map[string]interface{}{
		"query":    in.Query,
		"database": in.Database,
	})
	data, err := cli.do(http.MethodPost, "/api/table-retrieval/search", reqBody)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	return nil, mcpOutput{Result: string(data)}, nil
}

func mcpGetDbSchema(ctx context.Context, req *mcp.CallToolRequest, in getDbSchemaIn) (*mcp.CallToolResult, mcpOutput, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	data, err := cli.do(http.MethodGet, "/api/databases/"+in.DatabaseID, nil)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	return nil, mcpOutput{Result: string(data)}, nil
}

func mcpGetDbSQLHints(ctx context.Context, req *mcp.CallToolRequest, in getDbSQLHintsIn) (*mcp.CallToolResult, mcpOutput, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	// 先获取数据库信息以提取类型
	data, err := cli.do(http.MethodGet, "/api/databases/"+in.DatabaseID, nil)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	// 从返回数据中提取数据库类型，生成方言提示
	var dbInfo struct {
		Data struct {
			Type string `json:"type"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &dbInfo); err != nil {
		return nil, mcpOutput{}, fmt.Errorf("解析数据库信息失败: %w", err)
	}
	dbType := strings.ToLower(dbInfo.Data.Type)
	hints := buildSQLDialectHints(dbType, dbInfo.Data.Name)
	hintsData, _ := json.Marshal(hints)
	return nil, mcpOutput{Result: string(hintsData)}, nil
}

func mcpCreateApi(ctx context.Context, req *mcp.CallToolRequest, in createApiIn) (*mcp.CallToolResult, mcpOutput, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	// 通过数据库名称查找 database_id
	dbsData, err := cli.do(http.MethodGet, "/api/databases", nil)
	if err != nil {
		return nil, mcpOutput{}, fmt.Errorf("获取数据库列表失败: %w", err)
	}
	var dbsResp struct {
		Data []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(dbsData, &dbsResp); err != nil {
		return nil, mcpOutput{}, fmt.Errorf("解析数据库列表失败: %w", err)
	}
	var databaseID string
	for _, db := range dbsResp.Data {
		if db.Name == in.Database {
			databaseID = db.ID
			break
		}
	}
	if databaseID == "" {
		return nil, mcpOutput{}, fmt.Errorf("未找到名为 %q 的数据库", in.Database)
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
	data, err := cli.do(http.MethodPost, "/api/apis", reqBody)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	return nil, mcpOutput{Result: string(data)}, nil
}

func mcpExecuteApi(ctx context.Context, req *mcp.CallToolRequest, in executeApiIn) (*mcp.CallToolResult, mcpOutput, error) {
	cli, err := getMCPClientFromContext(ctx)
	if err != nil {
		return nil, mcpOutput{}, err
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
		return nil, mcpOutput{}, err
	}
	return nil, mcpOutput{Result: string(data)}, nil
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

		// 注册所有 12 个工具
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
		mcp.AddTool(server, &mcp.Tool{Name: "create_api", Description: "创建新的数据接口，定义接口路径、方法、SQL 和参数等"}, mcpCreateApi)
		mcp.AddTool(server, &mcp.Tool{Name: "execute_api", Description: "通过接口路径直接调用已配置的数据接口，传入查询参数获取数据"}, mcpExecuteApi)

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

	// 对于 X-Internal-Call 请求，注入 admin token 到 context
	apiKey := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if r.Header.Get("X-Internal-Call") == "datatoolbox-agent" {
		dataOntologyMu.RLock()
		if user, ok := dataOntologyUsers["admin"]; ok {
			apiKey = user.Token
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
	data, err := cli.do(http.MethodGet, "/api/mcp/config", nil)
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
	// Stdio 模式注册所有 12 个工具（与 HTTP 模式一致）
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

	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		fmt.Fprintf(os.Stderr, "MCP 运行错误: %v\n", err)
		os.Exit(1)
	}
}

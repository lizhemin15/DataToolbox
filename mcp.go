// Agent 服务：
//   HTTP 模式（推荐）：MCP 服务内嵌在 HTTP 服务器中，客户端通过 URL 直接连接，无需本地二进制。
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
const mcpProtocolVersion = "2024-11-05"

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
	url := c.baseURL + path
	var req *http.Request
	var err error
	if body != nil {
		req, err = http.NewRequest(method, url, bytes.NewReader(body))
	} else {
		req, err = http.NewRequest(method, url, nil)
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

// ─── HTTP 模式：自定义 JSON-RPC over HTTP MCP 端点 ───────────────────────────
// 不使用 go-sdk 的 HTTP handler，完全手写，避免底层 transport 的不兼容问题。

type mcpRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      interface{}     `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type mcpRPCResponse struct {
	JSONRPC string        `json:"jsonrpc"`
	ID      interface{}   `json:"id"`
	Result  interface{}   `json:"result,omitempty"`
	Error   *mcpRPCError  `json:"error,omitempty"`
}

type mcpRPCError struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

func mcpSendResult(w http.ResponseWriter, id interface{}, result interface{}) {
	json.NewEncoder(w).Encode(mcpRPCResponse{JSONRPC: "2.0", ID: id, Result: result})
}

func mcpSendError(w http.ResponseWriter, id interface{}, code int, msg string) {
	w.WriteHeader(http.StatusOK) // MCP spec: errors still return 200
	json.NewEncoder(w).Encode(mcpRPCResponse{
		JSONRPC: "2.0", ID: id,
		Error: &mcpRPCError{Code: code, Message: msg},
	})
}

func mcpToolsList() []interface{} {
	return []interface{}{
		map[string]interface{}{
			"name":        "list_databases",
			"description": "列出数据本体池中已配置的数据库（不含密码）",
			"inputSchema": map[string]interface{}{
				"type": "object", "properties": map[string]interface{}{},
			},
		},
		map[string]interface{}{
			"name":        "get_tables",
			"description": "获取指定数据库的表列表及连接状态",
			"inputSchema": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"database_id": map[string]interface{}{"type": "string", "description": "数据库 ID"},
				},
				"required": []string{"database_id"},
			},
		},
		map[string]interface{}{
			"name":        "describe_table",
			"description": "获取指定数据库中某张表的列结构（字段名、类型、是否可空、默认值、键信息等）",
			"inputSchema": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"database_id": map[string]interface{}{"type": "string", "description": "数据库 ID"},
					"table_name":  map[string]interface{}{"type": "string", "description": "表名"},
				},
				"required": []string{"database_id", "table_name"},
			},
		},
		map[string]interface{}{
			"name":        "execute_sql",
			"description": "在指定数据库上执行 SQL 语句。SELECT/SHOW/DESCRIBE/EXPLAIN 返回查询结果；INSERT/UPDATE/DELETE/CREATE/DROP 等返回影响行数。请谨慎使用写操作。",
			"inputSchema": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"database_id": map[string]interface{}{"type": "string", "description": "数据库 ID"},
					"sql":         map[string]interface{}{"type": "string", "description": "要执行的 SQL 语句"},
					"params":      map[string]interface{}{"type": "array", "description": "SQL 占位符参数（可选）", "items": map[string]interface{}{"type": "string"}},
				},
				"required": []string{"database_id", "sql"},
			},
		},
		map[string]interface{}{
			"name":        "list_apis",
			"description": "列出数据本体池中已配置的接口（path、method、关联数据库）",
			"inputSchema": map[string]interface{}{
				"type": "object", "properties": map[string]interface{}{},
			},
		},
		map[string]interface{}{
			"name":        "get_api_detail",
			"description": "获取指定接口的完整详情，包括 SQL 语句、参数定义、描述、关联数据库等",
			"inputSchema": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"api_id": map[string]interface{}{"type": "string", "description": "接口 ID"},
				},
				"required": []string{"api_id"},
			},
		},
		map[string]interface{}{
			"name":        "call_api",
			"description": "调用已配置的接口，传入接口 ID 和 params 执行并返回数据",
			"inputSchema": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"api_id": map[string]interface{}{"type": "string", "description": "接口 ID"},
					"params": map[string]interface{}{"type": "object", "description": "请求参数，与接口 SQL 中占位符对应"},
				},
				"required": []string{"api_id"},
			},
		},
		map[string]interface{}{
			"name":        "search_tables",
			"description": "根据关键词搜索数据库中的表，支持指定数据库范围",
			"inputSchema": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"query":    map[string]interface{}{"type": "string", "description": "搜索关键词"},
					"database": map[string]interface{}{"type": "string", "description": "数据库名称（可选，用于限定搜索范围）"},
				},
				"required": []string{"query"},
			},
		},
		map[string]interface{}{
			"name":        "get_db_schema",
			"description": "获取指定数据库的完整 schema 信息，包括所有表结构、列定义、索引等",
			"inputSchema": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"database_id": map[string]interface{}{"type": "string", "description": "数据库 ID"},
				},
				"required": []string{"database_id"},
			},
		},
		map[string]interface{}{
			"name":        "get_db_sql_hints",
			"description": "获取指定数据库的 SQL 方言提示，包括数据库类型和方言特性说明",
			"inputSchema": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"database_id": map[string]interface{}{"type": "string", "description": "数据库 ID"},
				},
				"required": []string{"database_id"},
			},
		},
		map[string]interface{}{
			"name":        "create_api",
			"description": "创建新的数据接口，定义接口路径、方法、SQL 和参数等",
			"inputSchema": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"name":          map[string]interface{}{"type": "string", "description": "接口名称"},
					"path":          map[string]interface{}{"type": "string", "description": "接口路径（如 /api/users）"},
					"method":        map[string]interface{}{"type": "string", "description": "HTTP 方法（GET/POST 等）"},
					"sql":           map[string]interface{}{"type": "string", "description": "接口关联的 SQL 语句"},
					"description":   map[string]interface{}{"type": "string", "description": "接口描述"},
					"database":      map[string]interface{}{"type": "string", "description": "数据库名称"},
					"default_params": map[string]interface{}{"type": "object", "description": "默认参数定义"},
				},
				"required": []string{"name", "path", "method", "sql", "database"},
			},
		},
		map[string]interface{}{
			"name":        "execute_api",
			"description": "通过接口路径直接调用已配置的数据接口，传入查询参数获取数据",
			"inputSchema": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"path":   map[string]interface{}{"type": "string", "description": "接口路径（如 /users）"},
					"params": map[string]interface{}{"type": "object", "description": "查询参数"},
				},
				"required": []string{"path"},
			},
		},
	}
}

// buildSQLDialectHints 根据数据库类型生成 SQL 方言提示
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

func mcpCallTool(cli *mcpClient, name string, argsRaw json.RawMessage) (interface{}, error) {
	textResult := func(data []byte) interface{} {
		return map[string]interface{}{
			"content": []interface{}{map[string]interface{}{"type": "text", "text": string(data)}},
		}
	}
	switch name {
	case "list_databases":
		data, err := cli.do(http.MethodGet, "/api/databases", nil)
		if err != nil {
			return nil, err
		}
		return textResult(data), nil

	case "get_tables":
		var args struct {
			DatabaseID string `json:"database_id"`
		}
		json.Unmarshal(argsRaw, &args)
		if args.DatabaseID == "" {
			return nil, fmt.Errorf("database_id 不能为空")
		}
		data, err := cli.do(http.MethodGet, "/api/databases/"+args.DatabaseID, nil)
		if err != nil {
			return nil, err
		}
		return textResult(data), nil

	case "describe_table":
		var args struct {
			DatabaseID string `json:"database_id"`
			TableName  string `json:"table_name"`
		}
		json.Unmarshal(argsRaw, &args)
		if args.DatabaseID == "" || args.TableName == "" {
			return nil, fmt.Errorf("database_id 和 table_name 不能为空")
		}
		body, _ := json.Marshal(map[string]interface{}{
			"database_id": args.DatabaseID,
			"sql":         "DESCRIBE `" + args.TableName + "`",
		})
		data, err := cli.do(http.MethodPost, "/api/governance/execute-sql", body)
		if err != nil {
			return nil, err
		}
		return textResult(data), nil

	case "execute_sql":
		var args struct {
			DatabaseID string        `json:"database_id"`
			SQL        string        `json:"sql"`
			Params     []interface{} `json:"params"`
		}
		json.Unmarshal(argsRaw, &args)
		if args.DatabaseID == "" || args.SQL == "" {
			return nil, fmt.Errorf("database_id 和 sql 不能为空")
		}
		// SQL 安全检查
		if allowed, reason := checkSQLSafety(args.SQL); !allowed {
			return nil, fmt.Errorf("SQL 安全检查失败: %s", reason)
		}
		body, _ := json.Marshal(map[string]interface{}{
			"database_id": args.DatabaseID,
			"sql":         args.SQL,
			"params":      args.Params,
		})
		data, err := cli.do(http.MethodPost, "/api/governance/execute-sql", body)
		if err != nil {
			return nil, err
		}
		return textResult(data), nil

	case "list_apis":
		data, err := cli.do(http.MethodGet, "/api/apis", nil)
		if err != nil {
			return nil, err
		}
		return textResult(data), nil

	case "get_api_detail":
		var args struct {
			ApiID string `json:"api_id"`
		}
		json.Unmarshal(argsRaw, &args)
		if args.ApiID == "" {
			return nil, fmt.Errorf("api_id 不能为空")
		}
		data, err := cli.do(http.MethodGet, "/api/apis/"+args.ApiID, nil)
		if err != nil {
			return nil, err
		}
		return textResult(data), nil

	case "call_api":
		var args struct {
			ApiID  string                 `json:"api_id"`
			Params map[string]interface{} `json:"params"`
		}
		json.Unmarshal(argsRaw, &args)
		if args.ApiID == "" {
			return nil, fmt.Errorf("api_id 不能为空")
		}
		body, _ := json.Marshal(map[string]interface{}{"params": args.Params})
		data, err := cli.do(http.MethodPost, "/api/apis/"+args.ApiID+"/test", body)
		if err != nil {
			return nil, err
		}
		return textResult(data), nil

	case "search_tables":
		var args struct {
			Query    string `json:"query"`
			Database string `json:"database"`
		}
		json.Unmarshal(argsRaw, &args)
		if args.Query == "" {
			return nil, fmt.Errorf("query 不能为空")
		}
		reqBody, _ := json.Marshal(map[string]interface{}{
			"query":    args.Query,
			"database": args.Database,
		})
		data, err := cli.do(http.MethodPost, "/api/table-retrieval/search", reqBody)
		if err != nil {
			return nil, err
		}
		return textResult(data), nil

	case "get_db_schema":
		var args struct {
			DatabaseID string `json:"database_id"`
		}
		json.Unmarshal(argsRaw, &args)
		if args.DatabaseID == "" {
			return nil, fmt.Errorf("database_id 不能为空")
		}
		data, err := cli.do(http.MethodGet, "/api/databases/"+args.DatabaseID, nil)
		if err != nil {
			return nil, err
		}
		return textResult(data), nil

	case "get_db_sql_hints":
		var args struct {
			DatabaseID string `json:"database_id"`
		}
		json.Unmarshal(argsRaw, &args)
		if args.DatabaseID == "" {
			return nil, fmt.Errorf("database_id 不能为空")
		}
		// 先获取数据库信息以提取类型
		data, err := cli.do(http.MethodGet, "/api/databases/"+args.DatabaseID, nil)
		if err != nil {
			return nil, err
		}
		// 从返回数据中提取数据库类型，生成方言提示
		var dbInfo struct {
			Data struct {
				Type string `json:"type"`
				Name string `json:"name"`
			} `json:"data"`
		}
		if err := json.Unmarshal(data, &dbInfo); err != nil {
			return nil, fmt.Errorf("解析数据库信息失败: %w", err)
		}
		dbType := strings.ToLower(dbInfo.Data.Type)
		hints := buildSQLDialectHints(dbType, dbInfo.Data.Name)
		hintsData, _ := json.Marshal(hints)
		return textResult(hintsData), nil

	case "create_api":
		var args struct {
			Name          string                 `json:"name"`
			Path          string                 `json:"path"`
			Method        string                 `json:"method"`
			SQL           string                 `json:"sql"`
			Description   string                 `json:"description"`
			Database      string                 `json:"database"`
			DefaultParams map[string]interface{} `json:"default_params"`
		}
		json.Unmarshal(argsRaw, &args)
		if args.Name == "" || args.Path == "" || args.Method == "" || args.SQL == "" || args.Database == "" {
			return nil, fmt.Errorf("name, path, method, sql, database 不能为空")
		}
		// 通过数据库名称查找 database_id
		dbsData, err := cli.do(http.MethodGet, "/api/databases", nil)
		if err != nil {
			return nil, fmt.Errorf("获取数据库列表失败: %w", err)
		}
		var dbsResp struct {
			Data []struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"data"`
		}
		if err := json.Unmarshal(dbsData, &dbsResp); err != nil {
			return nil, fmt.Errorf("解析数据库列表失败: %w", err)
		}
		var databaseID string
		for _, db := range dbsResp.Data {
			if db.Name == args.Database {
				databaseID = db.ID
				break
			}
		}
		if databaseID == "" {
			return nil, fmt.Errorf("未找到名为 %q 的数据库", args.Database)
		}
		reqBody, _ := json.Marshal(map[string]interface{}{
			"name":           args.Name,
			"path":           args.Path,
			"method":         args.Method,
			"sql":            args.SQL,
			"description":    args.Description,
			"database_id":    databaseID,
			"default_params": args.DefaultParams,
		})
		data, err := cli.do(http.MethodPost, "/api/apis", reqBody)
		if err != nil {
			return nil, err
		}
		return textResult(data), nil

	case "execute_api":
		var args struct {
			Path   string                 `json:"path"`
			Params map[string]interface{} `json:"params"`
		}
		json.Unmarshal(argsRaw, &args)
		if args.Path == "" {
			return nil, fmt.Errorf("path 不能为空")
		}
		// 构建带查询参数的 URL
		apiPath := args.Path
		if !strings.HasPrefix(apiPath, "/") {
			apiPath = "/" + apiPath
		}
		if len(args.Params) > 0 {
			params := url.Values{}
			for k, v := range args.Params {
				params.Set(k, fmt.Sprintf("%v", v))
			}
			apiPath += "?" + params.Encode()
		}
		data, err := cli.do(http.MethodGet, apiPath, nil)
		if err != nil {
			return nil, err
		}
		return textResult(data), nil

	default:
		return nil, fmt.Errorf("未知工具: %s", name)
	}
}

// handleMCPHTTP 是内嵌在 HTTP 服务器中的 MCP 端点（JSON-RPC over HTTP）。
// 仅处理 POST，不依赖 go-sdk HTTP transport，避免 SSE/session 复杂性。
func handleMCPHTTP(w http.ResponseWriter, r *http.Request) {
	dataOntologyMu.RLock()
	enabled := dataOntologyMCPEnabled == nil || *dataOntologyMCPEnabled
	dataOntologyMu.RUnlock()
	if !enabled {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":"Agent 服务已关闭，请开启后使用"}`))
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !verifyToken(r) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"未授权，请在 Authorization 头中提供有效的 API Key"}`))
		return
	}

	var rpcReq mcpRPCRequest
	if err := json.NewDecoder(r.Body).Decode(&rpcReq); err != nil {
		mcpSendError(w, nil, -32700, "解析错误")
		return
	}

	apiKey := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	cli := &mcpClient{
		baseURL: mcpLoopbackAddr,
		apiKey:  apiKey,
		client:  &http.Client{Timeout: HTTPClientTimeout},
	}

	switch rpcReq.Method {
	case "initialize":
		mcpSendResult(w, rpcReq.ID, map[string]interface{}{
			"protocolVersion": mcpProtocolVersion,
			"capabilities": map[string]interface{}{
				"tools": map[string]interface{}{},
			},
			"serverInfo": map[string]interface{}{
				"name":    mcpServerName,
				"version": mcpServerVersion,
			},
		})
	case "notifications/initialized":
		w.WriteHeader(http.StatusNoContent)
	case "ping":
		mcpSendResult(w, rpcReq.ID, map[string]interface{}{})
	case "tools/list":
		mcpSendResult(w, rpcReq.ID, map[string]interface{}{
			"tools": mcpToolsList(),
		})
	case "tools/call":
		var params struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(rpcReq.Params, &params); err != nil {
			mcpSendError(w, rpcReq.ID, -32602, "参数解析错误")
			return
		}
		result, err := mcpCallTool(cli, params.Name, params.Arguments)
		if err != nil {
			mcpSendError(w, rpcReq.ID, -32000, safeErrorMessage(err, "工具调用失败"))
			return
		}
		mcpSendResult(w, rpcReq.ID, result)
	default:
		mcpSendError(w, rpcReq.ID, -32601, "方法不存在: "+rpcReq.Method)
	}
}

// ─── Stdio 模式工具函数（供 runMCPServer 使用） ──────────────────────────────

type mcpOutput struct {
	Result string `json:"result"`
}

type listDatabasesIn struct{}

func mcpListDatabases(ctx context.Context, req *mcp.CallToolRequest, _ listDatabasesIn) (*mcp.CallToolResult, mcpOutput, error) {
	cli, err := newMCPClient()
	if err != nil {
		return nil, mcpOutput{}, err
	}
	data, err := cli.do(http.MethodGet, "/api/databases", nil)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	return nil, mcpOutput{Result: string(data)}, nil
}

type getTablesIn struct {
	DatabaseID string `json:"database_id" jsonschema:"required,description=数据库 ID"`
}

func mcpGetTables(ctx context.Context, req *mcp.CallToolRequest, in getTablesIn) (*mcp.CallToolResult, mcpOutput, error) {
	cli, err := newMCPClient()
	if err != nil {
		return nil, mcpOutput{}, err
	}
	data, err := cli.do(http.MethodGet, "/api/databases/"+in.DatabaseID, nil)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	return nil, mcpOutput{Result: string(data)}, nil
}

type listApisIn struct{}

func mcpListApis(ctx context.Context, req *mcp.CallToolRequest, _ listApisIn) (*mcp.CallToolResult, mcpOutput, error) {
	cli, err := newMCPClient()
	if err != nil {
		return nil, mcpOutput{}, err
	}
	data, err := cli.do(http.MethodGet, "/api/apis", nil)
	if err != nil {
		return nil, mcpOutput{}, err
	}
	return nil, mcpOutput{Result: string(data)}, nil
}

type callApiIn struct {
	ApiID  string                `json:"api_id" jsonschema:"required,description=接口 ID"`
	Params map[string]interface{} `json:"params" jsonschema:"description=请求参数，与接口 SQL 中占位符对应"`
}

func mcpCallApi(ctx context.Context, req *mcp.CallToolRequest, in callApiIn) (*mcp.CallToolResult, mcpOutput, error) {
	cli, err := newMCPClient()
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
	mcp.AddTool(server, &mcp.Tool{Name: "list_databases", Description: "列出数据本体池中已配置的数据库（不含密码）"}, mcpListDatabases)
	mcp.AddTool(server, &mcp.Tool{Name: "get_tables", Description: "获取指定数据库的表列表及连接状态"}, mcpGetTables)
	mcp.AddTool(server, &mcp.Tool{Name: "list_apis", Description: "列出数据本体池中已配置的接口（path、method、关联数据库）"}, mcpListApis)
	mcp.AddTool(server, &mcp.Tool{Name: "call_api", Description: "调用已配置的接口，传入接口 ID 和 params 执行并返回数据"}, mcpCallApi)

	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		fmt.Fprintf(os.Stderr, "MCP 运行错误: %v\n", err)
		os.Exit(1)
	}
}

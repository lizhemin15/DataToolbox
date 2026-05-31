package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/tools"
)

// DataToolboxAPITool 让 PicoClaw agent 能调用 DataToolbox 内部 API
// 深度耦合的关键 — agent 直接调用服务内部 API，共享鉴权和数据库连接

const dataToolboxAPIDesc = `Call DataToolbox internal API endpoints to interact with databases, execute SQL, manage APIs, governance tasks, and query data ontology.

Available endpoints:
- list_databases: List all configured databases (no params)
- get_database: Get database details (params: name)
- get_db_schema: Get full database schema (all tables + columns) for AI SQL generation (params: database)
- get_db_sql_hints: Get SQL dialect hints and documentation for a database (params: database)
- execute_sql: Execute SQL query with result truncation for LLM context safety (params: database, sql)
- list_tables: List tables in a database (params: database)
- get_table_schema: Get table schema details (params: database, table)
- search_tables: Search tables by keyword with optional database filter (params: query, database?)
- list_apis: List all existing API endpoints with descriptions, types, and parameters (no params). Each API has a type: "query" (SQL-based) or "forward" (HTTP proxy to external service). Forward APIs have a forward_url and description explaining what they do and what parameters they accept.
- get_api_detail: Get detailed info about a specific API including full description, parameters, and forward_url (params: name or path)
- create_api: Create a new API endpoint (params: name, path, method, type, sql, description, database, forward_url, default_params). For forward type, provide forward_url instead of sql/database.
- execute_api: Call an existing dynamic API endpoint to get real data (params: path, plus any query parameters). Works for both query and forward type APIs — forward APIs will proxy the request to the external service.
- governance_tasks: List governance tasks (no params)
- ontology_query: Query data ontology (params: query)

Recommended workflows:
For database queries:
1. search_tables(query="user requirement") → find relevant tables
2. get_db_schema(database="db") → understand full table/column structure
3. get_db_sql_hints(database="db") → get dialect-specific SQL tips
4. execute_sql(database="db", sql="...") → run the generated SQL

For using existing APIs (especially forward/proxy APIs):
1. list_apis() → see all available APIs with descriptions
2. get_api_detail(name="API名称") → get full details and parameters
3. execute_api(path="/api/xxx", param1="value1") → call the API

IMPORTANT: When a user asks something that might be served by an existing API (especially forward type), ALWAYS check list_apis first before trying to write SQL. Forward APIs connect to external services and may provide data not available in local databases.

This tool calls DataToolbox APIs via internal HTTP, sharing the same auth token.`

type DataToolboxAPITool struct {
	serverURL string
	authToken string
}

func NewDataToolboxAPITool(serverURL, authToken string) *DataToolboxAPITool {
	return &DataToolboxAPITool{
		serverURL: strings.TrimRight(serverURL, "/"),
		authToken: authToken,
	}
}

func (t *DataToolboxAPITool) Name() string        { return "datatoolbox_api" }
func (t *DataToolboxAPITool) Description() string  { return dataToolboxAPIDesc }
func (t *DataToolboxAPITool) Parameters() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"endpoint": map[string]any{
				"type":        "string",
			"description": "The API endpoint to call. One of: list_databases, get_database, get_db_schema, get_db_sql_hints, execute_sql, list_tables, get_table_schema, search_tables, list_apis, create_api, execute_api, governance_tasks, ontology_query",
			"enum": []string{
				"list_databases", "get_database", "get_db_schema", "get_db_sql_hints",
				"execute_sql", "list_tables", "get_table_schema", "search_tables",
				"list_apis", "get_api_detail", "create_api", "execute_api", "governance_tasks", "ontology_query",
				},
			},
			"params": map[string]any{
				"type":        "object",
				"description": "Parameters for the endpoint. Common params: database (name or ID), query (search text), sql (SQL statement), table (table name)",
				"properties": map[string]any{
					"database": map[string]any{
						"type":        "string",
						"description": "Database name or ID (used by: get_db_schema, get_db_sql_hints, execute_sql, list_tables, get_table_schema, search_tables, create_api)",
					},
					"query": map[string]any{
						"type":        "string",
						"description": "Search query text (used by: search_tables, ontology_query)",
					},
					"sql": map[string]any{
						"type":        "string",
						"description": "SQL statement to execute (used by: execute_sql, create_api)",
					},
					"table": map[string]any{
						"type":        "string",
						"description": "Table name (used by: get_table_schema)",
					},
					"name": map[string]any{
						"type":        "string",
						"description": "Database name for get_database, or API name for create_api",
					},
				},
			},
		},
		"required": []string{"endpoint"},
	}
}

// resolveDatabaseID 将数据库名称转换为 ID（如果已经是 ID 则直接返回）
func (t *DataToolboxAPITool) resolveDatabaseID(ctx context.Context, nameOrID string) (string, error) {
	if nameOrID == "" {
		return "", fmt.Errorf("database name or id required")
	}
	// 先尝试直接用 ID 查
	result, err := t.httpGet(ctx, "/api/v1/databases/"+nameOrID)
	if err == nil {
		if m, ok := result.(map[string]any); ok {
			if success, _ := m["success"].(bool); success {
				return nameOrID, nil
			}
		}
	}
	// ID 查不到，通过 list_databases 匹配 name
	listResult, listErr := t.httpGet(ctx, "/api/v1/databases")
	if listErr != nil {
		return "", fmt.Errorf("database %q not found (list failed: %v)", nameOrID, listErr)
	}
	listMap, ok := listResult.(map[string]any)
	if !ok {
		return "", fmt.Errorf("database %q not found (unexpected list format)", nameOrID)
	}
	dbs, ok := listMap["databases"].([]any)
	if !ok {
		return "", fmt.Errorf("database %q not found (no databases list)", nameOrID)
	}
	nameLower := strings.ToLower(nameOrID)
	for _, db := range dbs {
		if dbMap, ok := db.(map[string]any); ok {
			dbName, _ := dbMap["name"].(string)
			dbID, _ := dbMap["id"].(string)
			if strings.ToLower(dbName) == nameLower && dbID != "" {
				return dbID, nil
			}
		}
	}
	return "", fmt.Errorf("database %q not found", nameOrID)
}

func (t *DataToolboxAPITool) Execute(ctx context.Context, args map[string]any) *tools.ToolResult {
	endpoint, _ := args["endpoint"].(string)
	params, _ := args["params"].(map[string]any)

	// 处理 LLM 把参数包在 "raw" 字段里的情况（Qwen3 等模型常见）
	// 递归解析嵌套的 raw 字段
	if endpoint == "" {
		log.Printf("[datatoolbox_api] Execute: endpoint is empty, args keys=%v", func() []string {
			keys := make([]string, 0, len(args))
			for k := range args {
				keys = append(keys, k)
			}
			return keys
		}())
		current := args
		for i := 0; i < 5; i++ { // 最多递归5层
			raw, ok := current["raw"].(string)
			if !ok || raw == "" {
				log.Printf("[datatoolbox_api] Execute: no raw field at depth %d, current keys=%v", i, func() []string {
					keys := make([]string, 0, len(current))
					for k := range current {
						keys = append(keys, k)
					}
					return keys
				}())
				break
			}
			log.Printf("[datatoolbox_api] Execute: raw at depth %d, len=%d, first_50_bytes=%q", i, len(raw), func() string {
				if len(raw) > 50 {
					return raw[:50]
				}
				return raw
			}())
			var parsed map[string]any
			if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
				// SiliconFlow/Qwen3 经常截断 tool_call arguments JSON
				// 尝试修复：补上缺失的引号、括号
				fixed := raw
				// 计算未闭合的括号和引号
				openBraces := 0
				inString := false
				for _, ch := range fixed {
					if ch == '"' {
						inString = !inString
					} else if !inString {
						if ch == '{' {
							openBraces++
						} else if ch == '}' {
							openBraces--
						}
					}
				}
				// 补上缺失的闭合括号
				for i := 0; i < openBraces; i++ {
					fixed += "}"
				}
				// 如果在字符串中间截断，先闭合字符串
				if inString {
					fixed += "\""
				}
				// 再补一次括号（因为闭合字符串后可能还需要括号）
				openBraces2 := 0
				inString2 := false
				for _, ch := range fixed {
					if ch == '"' {
						inString2 = !inString2
					} else if !inString2 {
						if ch == '{' {
							openBraces2++
						} else if ch == '}' {
							openBraces2--
						}
					}
				}
				for i := 0; i < openBraces2; i++ {
					fixed += "}"
				}
				log.Printf("[datatoolbox_api] Execute: attempting JSON repair, original=%d bytes, fixed=%d bytes", len(raw), len(fixed))
				if err2 := json.Unmarshal([]byte(fixed), &parsed); err2 != nil {
					log.Printf("[datatoolbox_api] Execute: JSON repair also failed: %v", err2)
					break
				}
				log.Printf("[datatoolbox_api] Execute: JSON repair succeeded!")
			}
			if e, ok := parsed["endpoint"].(string); ok {
				endpoint = e
			}
			if p, ok := parsed["params"].(map[string]any); ok {
				params = p
			}
			if endpoint != "" {
				log.Printf("[datatoolbox_api] Execute: resolved endpoint=%s, params=%v", endpoint, params)
				break
			}
			current = parsed // 继续解析下一层 raw
		}
	}

	if endpoint == "" {
		return tools.ErrorResult("endpoint is required. Available: list_databases, get_database, get_db_schema, get_db_sql_hints, execute_sql, list_tables, get_table_schema, search_tables, list_apis, get_api_detail, create_api, execute_api, governance_tasks, ontology_query")
	}

	if params == nil {
		params = map[string]any{}
	}

	result, err := t.callAPI(ctx, endpoint, params)
	if err != nil {
		return tools.ErrorResult(fmt.Sprintf("API call failed: %v", err))
	}

	resultJSON, _ := json.MarshalIndent(result, "", "  ")
	return tools.NewToolResult(string(resultJSON))
}

func (t *DataToolboxAPITool) callAPI(ctx context.Context, endpoint string, params map[string]any) (interface{}, error) {
	switch endpoint {
	case "list_databases":
		return t.httpGet(ctx, "/api/v1/databases")
	case "get_database":
		nameOrID, ok := params["name"].(string)
		if !ok || nameOrID == "" {
			nameOrID, _ = params["id"].(string)
		}
		if nameOrID == "" {
			return nil, fmt.Errorf("name or id parameter required")
		}
		dbID, err := t.resolveDatabaseID(ctx, nameOrID)
		if err != nil {
			return nil, err
		}
		return t.httpGet(ctx, "/api/v1/databases/"+dbID)
	case "execute_sql":
		return t.httpPost(ctx, "/api/v1/gov/execute-sql", params)
	case "list_tables":
		db, ok := params["database"].(string)
		if !ok || db == "" {
			return nil, fmt.Errorf("database parameter required")
		}
		dbID, err := t.resolveDatabaseID(ctx, db)
		if err != nil {
			return nil, err
		}
		return t.httpGet(ctx, fmt.Sprintf("/api/v1/databases/%s/tables", dbID))
	case "get_table_schema":
		db, _ := params["database"].(string)
		tbl, _ := params["table"].(string)
		if db == "" || tbl == "" {
			return nil, fmt.Errorf("database and table parameters required")
		}
		dbID, err := t.resolveDatabaseID(ctx, db)
		if err != nil {
			return nil, err
		}
		return t.httpGet(ctx, fmt.Sprintf("/api/v1/databases/%s/tables/%s/schema", dbID, tbl))
	case "get_db_schema":
		db, ok := params["database"].(string)
		if !ok || db == "" {
			return nil, fmt.Errorf("database parameter required")
		}
		dbID, err := t.resolveDatabaseID(ctx, db)
		if err != nil {
			return nil, err
		}
		// 获取数据库详情（包含所有表和字段）
		dbDetail, err := t.httpGet(ctx, "/api/v1/databases/"+dbID)
		if err != nil {
			return nil, err
		}
		// 提取schema信息，格式化为AI友好的结构
		if m, ok := dbDetail.(map[string]any); ok {
			result := map[string]any{
				"database_id":   dbID,
				"database_name": db,
				"tables":        m["tables"],
				"columns":       m["columns"],
			}
			return result, nil
		}
		return dbDetail, nil
	case "get_db_sql_hints":
		db, ok := params["database"].(string)
		if !ok || db == "" {
			return nil, fmt.Errorf("database parameter required")
		}
		dbID, err := t.resolveDatabaseID(ctx, db)
		if err != nil {
			return nil, err
		}
		// 获取数据库类型
		dbDetail, err := t.httpGet(ctx, "/api/v1/databases/"+dbID)
		if err != nil {
			return nil, err
		}
		dbType := "mysql"
		if m, ok := dbDetail.(map[string]any); ok {
			if nested, ok := m["database"].(map[string]any); ok {
				if dt, ok := nested["type"].(string); ok && dt != "" {
					dbType = dt
				}
			}
			if dt, ok := m["type"].(string); ok && dt != "" {
				dbType = dt
			}
		}
		// 返回SQL方言提示
		hints := map[string]any{
			"database_type": dbType,
			"sql_dialect":   getSQLDialectHints(dbType),
		}
		return hints, nil
	case "search_tables":
		return t.httpPost(ctx, "/api/v1/retrieval/search", params)
	case "list_apis":
		return t.httpGet(ctx, "/api/v1/openapis")
	case "get_api_detail":
		// 获取单个API详情（支持name或path查询）
		nameOrPath, _ := params["name"].(string)
		if nameOrPath == "" {
			nameOrPath, _ = params["path"].(string)
		}
		if nameOrPath == "" {
			return nil, fmt.Errorf("name or path parameter required")
		}
		// 先获取列表，再匹配
		listResult, err := t.httpGet(ctx, "/api/v1/openapis")
		if err != nil {
			return nil, err
		}
		if m, ok := listResult.(map[string]any); ok {
			if apis, ok := m["apis"].([]interface{}); ok {
				for _, api := range apis {
					if apiMap, ok := api.(map[string]any); ok {
						if apiMap["name"] == nameOrPath || apiMap["path"] == nameOrPath {
							return apiMap, nil
						}
					}
				}
			}
		}
		return nil, fmt.Errorf("API not found: %s", nameOrPath)
	case "create_api":
		// 参数预处理：database → database_id 转换，字段名映射
		apiParams := make(map[string]interface{})
		for k, v := range params {
			apiParams[k] = v
		}
		// database name → database_id (UUID)
		if dbName, ok := apiParams["database"].(string); ok && dbName != "" {
			dbID, err := t.resolveDatabaseID(ctx, dbName)
			if err != nil {
				return nil, fmt.Errorf("resolve database '%s' failed: %w", dbName, err)
			}
			apiParams["database_id"] = dbID
			delete(apiParams, "database")
		}
		// 确保路径以 /api/ 开头
		if path, ok := apiParams["path"].(string); ok && path != "" {
			path = strings.TrimSpace(path)
			if !strings.HasPrefix(path, "/api/") {
				path = "/api/" + strings.TrimPrefix(path, "/")
			}
			apiParams["path"] = path
		}
		// 确保方法大写
		if method, ok := apiParams["method"].(string); ok {
			apiParams["method"] = strings.ToUpper(strings.TrimSpace(method))
		}
		// 确保有 type 字段
		if _, ok := apiParams["type"]; !ok {
			apiParams["type"] = "query"
		}
		return t.httpPost(ctx, "/api/v1/openapis", apiParams)
	case "execute_api":
		// 调用已创建的动态接口
		path, _ := params["path"].(string)
		if path == "" {
			return nil, fmt.Errorf("path parameter required (e.g. /api/employee/query)")
		}
		// 确保路径以 /api/ 开头
		if !strings.HasPrefix(path, "/api/") {
			path = "/api/" + strings.TrimPrefix(path, "/")
		}
		// 提取查询参数（除 path 外的其他参数作为查询条件）
		queryParams := make(map[string]any)
		for k, v := range params {
			if k != "path" && k != "endpoint" {
				queryParams[k] = v
			}
		}
		// 检查API类型：forward且method=POST时用POST，否则用GET
		apiDetail, _ := t.callAPI(ctx, "get_api_detail", map[string]any{"path": path})
		if apiMap, ok := apiDetail.(map[string]any); ok {
			apiMethod, _ := apiMap["method"].(string)
			apiType, _ := apiMap["type"].(string)
			if apiType == "forward" && (apiMethod == "POST" || apiMethod == "PUT" || apiMethod == "PATCH") && len(queryParams) > 0 {
				return t.httpPost(ctx, path, queryParams)
			}
		}
		if len(queryParams) > 0 {
			return t.httpGetWithParams(ctx, path, queryParams)
		}
		return t.httpGet(ctx, path)
	case "governance_tasks":
		return t.httpGet(ctx, "/api/v1/gov/tasks")
	case "ontology_query":
		return t.httpPost(ctx, "/api/v1/ontology/query", params)
	default:
		return nil, fmt.Errorf("unknown endpoint: %s", endpoint)
	}
}

func (t *DataToolboxAPITool) httpGet(ctx context.Context, path string) (interface{}, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", t.serverURL+path, nil)
	if err != nil {
		return nil, err
	}
	return t.doRequest(req)
}

func (t *DataToolboxAPITool) httpGetWithParams(ctx context.Context, path string, params map[string]any) (interface{}, error) {
	values := url.Values{}
	for k, v := range params {
		values.Set(k, fmt.Sprintf("%v", v))
	}
	fullURL := t.serverURL + path + "?" + values.Encode()
	req, err := http.NewRequestWithContext(ctx, "GET", fullURL, nil)
	if err != nil {
		return nil, err
	}
	return t.doRequest(req)
}

func (t *DataToolboxAPITool) httpPost(ctx context.Context, path string, body interface{}) (interface{}, error) {
	bodyJSON, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, "POST", t.serverURL+path, strings.NewReader(string(bodyJSON)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return t.doRequest(req)
}

func (t *DataToolboxAPITool) doRequest(req *http.Request) (interface{}, error) {
	// 内部调用标识 — getDataOntologyUserFromRequest 会识别此 header，以 admin 身份通过鉴权
	req.Header.Set("X-Internal-Call", "datatoolbox-agent")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}

	var result interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return map[string]string{"raw": string(body)}, nil
	}
	return result, nil
}

// getSQLDialectHints 返回数据库方言的SQL提示
func getSQLDialectHints(dbType string) map[string]any {
	switch strings.ToLower(dbType) {
	case "dm", "dameng":
		return map[string]any{
			"limit_syntax":     "FETCH FIRST N ROWS ONLY 或 ROWNUM <= N",
			"quote_identifier": `双引号 "表名" 或不加引号`,
			"sample_query":     `SELECT * FROM "SCHEMA"."TABLE" FETCH FIRST 10 ROWS ONLY`,
			"notes":            "达梦数据库：表名需要带SCHEMA前缀，如 SCHEMA.TABLE；字符串用单引号；LIMIT用FETCH FIRST",
		}
	case "oracle":
		return map[string]any{
			"limit_syntax":     "ROWNUM <= N 或 FETCH FIRST N ROWS ONLY (12c+)",
			"quote_identifier": `双引号 "表名" 或不加引号`,
			"sample_query":     `SELECT * FROM "SCHEMA"."TABLE" WHERE ROWNUM <= 10`,
			"notes":            "Oracle：表名需要带SCHEMA前缀；字符串用单引号；分页用ROWNUM或OFFSET-FETCH",
		}
	case "postgresql", "postgres", "pg":
		return map[string]any{
			"limit_syntax":     "LIMIT N",
			"quote_identifier": `双引号 "表名"`,
			"sample_query":     `SELECT * FROM "schema"."table" LIMIT 10`,
			"notes":            "PostgreSQL：LIMIT语法标准；表名可选双引号；支持JSON操作",
		}
	case "mysql":
		return map[string]any{
			"limit_syntax":     "LIMIT N",
			"quote_identifier": "反引号 `表名` 或不加引号",
			"sample_query":     "SELECT * FROM `table` LIMIT 10",
			"notes":            "MySQL：LIMIT语法标准；字符串用单引号；支持GROUP_CONCAT",
		}
	case "sqlserver", "mssql":
		return map[string]any{
			"limit_syntax":     "TOP N 或 OFFSET N ROWS FETCH NEXT M ROWS ONLY",
			"quote_identifier": `方括号 [表名] 或双引号`,
			"sample_query":     "SELECT TOP 10 * FROM [table]",
			"notes":            "SQL Server：TOP关键字分页；方括号引用标识符",
		}
	default:
		return map[string]any{
			"limit_syntax":     "LIMIT N",
			"quote_identifier": "不加引号或双引号",
			"sample_query":     "SELECT * FROM table LIMIT 10",
			"notes":            "通用SQL：使用标准LIMIT语法；字符串用单引号",
		}
	}
}

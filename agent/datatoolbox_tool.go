package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/tools"
)

// DataToolboxAPITool 让 PicoClaw agent 能调用 DataToolbox 内部 API
// 深度耦合的关键 — agent 直接调用服务内部 API，共享鉴权和数据库连接

const dataToolboxAPIDesc = `Call DataToolbox internal API endpoints to interact with databases, execute SQL, manage APIs, governance tasks, and query data ontology.

CRITICAL RULES to avoid context explosion:
- ALWAYS use search_tables(query="user requirement") FIRST to find relevant tables. Do NOT call get_db_schema unless you know exactly which tables you need.
- Use list_apis/list_databases sparingly — they return summaries only. Use get_api_detail/get_database for details.
- execute_sql auto-truncates at 100 rows. Add LIMIT/FETCH FIRST for specific slices.

Available endpoints:
- list_databases: List all configured databases — returns summary (name, type, id) only (no params)
- get_database: Get full database details (params: name)
- get_db_schema: Get database schema. Use query param to filter tables by keyword, or omit for table-name-only list (params: database, query?)
- get_db_sql_hints: Get SQL dialect hints for a database — essential before writing SQL (params: database)
- execute_sql: Execute SQL with auto-truncation (max 100 rows) (params: database, sql)
- list_tables: List table names in a database (params: database)
- get_table_schema: Get single table schema — use after search_tables narrows scope (params: database, table)
- search_tables: RAG-powered table search — ALWAYS use this first to find relevant tables (params: query, database?). Returns top-15 most relevant tables with relevance scores.
- list_apis: List all APIs — returns summary (name, path, type, description) only (no params)
- get_api_detail: Get full API details including SQL/forward_url/params (params: name or path)
- create_api: Create a new API endpoint (params: name, path, method, type, sql, description, database, forward_url, default_params)
- execute_api: Call an existing API to get real data (params: path, plus any query parameters)
- governance_tasks: List governance tasks — returns summary (id, name, type, status) only (no params)
- get_governance_task: Get full governance task details including config (params: id)
- ontology_query: Query data ontology (params: query)

Recommended workflows:
For database queries (ALWAYS follow this order):
1. search_tables(query="user requirement", database="db") → find relevant tables (top-15)
2. get_table_schema(database="db", table="table_name") → get column details for specific tables
3. get_db_sql_hints(database="db") → get dialect-specific SQL tips (especially for DM/Oracle)
4. execute_sql(database="db", sql="...") → run the SQL

For using existing APIs (especially forward/proxy APIs):
1. list_apis() → see available APIs (summary only)
2. get_api_detail(name="API名称") → get full details and parameters
3. execute_api(path="/api/xxx", param1="value1") → call the API

IMPORTANT: 
- When a user asks something that might be served by an existing API (especially forward type), ALWAYS check list_apis first.
- For DM (达梦) databases: use FETCH FIRST N ROWS ONLY instead of LIMIT, and quote identifiers with double quotes.
- This tool calls DataToolbox APIs via internal HTTP, sharing the same auth token.`

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
				"description": "The API endpoint to call. One of: list_databases, get_database, get_db_schema, get_db_sql_hints, execute_sql, list_tables, get_table_schema, search_tables, list_apis, get_api_detail, create_api, execute_api, governance_tasks, get_governance_task, ontology_query",
				"enum": []string{
					"list_databases", "get_database", "get_db_schema", "get_db_sql_hints",
					"execute_sql", "list_tables", "get_table_schema", "search_tables",
					"list_apis", "get_api_detail", "create_api", "execute_api",
					"governance_tasks", "get_governance_task", "ontology_query",
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
						"description": "Search query text (used by: search_tables, ontology_query, get_db_schema)",
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
						"description": "Database name for get_database, API name for get_api_detail/create_api",
					},
					"path": map[string]any{
						"type":        "string",
						"description": "API path for get_api_detail/execute_api (e.g. /api/employee/query)",
					},
					"id": map[string]any{
						"type":        "string",
						"description": "Task ID for get_governance_task",
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
	endpoint, _ := args["endpoint"].((string))
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
				break
			}
			var parsed map[string]any
			if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
				// SiliconFlow/Qwen3 经常截断 tool_call arguments JSON
				// 尝试修复：补上缺失的引号、括号
				fixed := raw
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
				for i := 0; i < openBraces; i++ {
					fixed += "}"
				}
				if inString {
					fixed += "\""
				}
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
		return tools.ErrorResult("endpoint is required. Available: list_databases, get_database, get_db_schema, get_db_sql_hints, execute_sql, list_tables, get_table_schema, search_tables, list_apis, get_api_detail, create_api, execute_api, governance_tasks, get_governance_task, ontology_query")
	}

	if params == nil {
		params = map[string]any{}
	}

	result, err := t.callAPI(ctx, endpoint, params)
	if err != nil {
		return tools.ErrorResult(fmt.Sprintf("API call failed: %v", err))
	}

	// 对结果做上下文安全裁剪
	result = t.trimForContext(result, endpoint)

	resultJSON, _ := json.MarshalIndent(result, "", "  ")
	return tools.NewToolResult(string(resultJSON))
}

// trimForContext 对API返回结果做上下文安全裁剪，避免大载荷撑爆LLM上下文
func (t *DataToolboxAPITool) trimForContext(result interface{}, endpoint string) interface{} {
	m, ok := result.(map[string]any)
	if !ok {
		return result
	}

	switch endpoint {
	case "list_databases":
		// 只返回 name, type, id, connected
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
			m["hint"] = "Use get_database(name) for full details including schema"
		}

	case "list_apis":
		// 只返回 name, path, type, method, description — 去掉 sql/forward_url/default_params 等大字段
		if apis, ok := m["apis"].([]any); ok {
			trimmed := make([]map[string]any, 0, len(apis))
			for _, api := range apis {
				if apiMap, ok := api.(map[string]any); ok {
					trimmed = append(trimmed, map[string]any{
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
			m["hint"] = "Use get_api_detail(name) for full details including SQL/forward_url/params"
		}

	case "governance_tasks":
		// 只返回 id, name, type, status, enabled — 去掉 js_code 等大字段
		if tasks, ok := m["tasks"].([]any); ok {
			trimmed := make([]map[string]any, 0, len(tasks))
			for _, task := range tasks {
				if taskMap, ok := task.(map[string]any); ok {
					trimmed = append(trimmed, map[string]any{
						"id":      taskMap["id"],
						"name":    taskMap["name"],
						"type":    taskMap["type"],
						"status":  taskMap["status"],
						"enabled": taskMap["enabled"],
					})
				}
			}
			m["tasks"] = trimmed
			m["hint"] = "Use get_governance_task(id) for full task config"
		}

	case "get_db_schema":
		// 如果有 query 参数，只返回匹配的表；否则只返回表名+注释列表
		if dbDetail, ok := m["database"].(map[string]any); ok {
			if tables, ok := dbDetail["tables"].([]any); ok {
				tableNames := make([]map[string]any, 0, len(tables))
				for _, tbl := range tables {
					if tblMap, ok := tbl.(map[string]any); ok {
						entry := map[string]any{
							"name": tblMap["name"],
						}
						if comment, ok := tblMap["comment"].(string); ok && comment != "" {
							entry["comment"] = comment
						}
						tableNames = append(tableNames, entry)
					}
				}
				// 返回精简的表名列表，不返回 columns（太大了）
				return map[string]any{
					"database_id":   dbDetail["id"],
					"database_name": dbDetail["name"],
					"database_type": dbDetail["type"],
					"total_tables":  len(tableNames),
					"tables":        tableNames,
					"hint":          "Use get_table_schema(database, table) to get column details for specific tables",
				}
			}
		}

	case "execute_sql":
		// 截断过大的结果集，保护上下文
		if data, ok := m["data"].([]any); ok {
			maxRows := 100
			if len(data) > maxRows {
				m["data"] = data[:maxRows]
				m["truncated"] = true
				m["total_rows"] = len(data)
				m["returned_rows"] = maxRows
				m["hint"] = "Result truncated. Use LIMIT/FETCH FIRST for specific slices."
			}
		}
	}

	return m
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
		// 后端没有单表schema API，从数据库详情中提取
		dbDetail, err := t.httpGet(ctx, "/api/v1/databases/"+dbID)
		if err != nil {
			return nil, err
		}
		return t.extractTableSchema(dbDetail, tbl)
	case "get_db_schema":
		db, ok := params["database"].(string)
		if !ok || db == "" {
			return nil, fmt.Errorf("database parameter required")
		}
		dbID, err := t.resolveDatabaseID(ctx, db)
		if err != nil {
			return nil, err
		}
		// 如果有 query 参数，先用 search_tables 筛选，只返回匹配的表
		query, _ := params["query"].(string)
		if query != "" {
			return t.searchAndFilterSchema(ctx, dbID, db, query)
		}
		// 无 query：返回完整数据库详情（trimForContext 会裁剪为表名列表）
		return t.httpGet(ctx, "/api/v1/databases/"+dbID)
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
		// search_tables 后端用 GET 请求，需要 database_id + query
		query, _ := params["query"].(string)
		if query == "" {
			return nil, fmt.Errorf("query parameter required for search_tables")
		}
		db, _ := params["database"].(string)
		dbID, _ := params["database_id"].(string)
		if db != "" && dbID == "" {
			resolved, err := t.resolveDatabaseID(ctx, db)
			if err != nil {
				return nil, err
			}
			dbID = resolved
		}
		if dbID == "" {
			return nil, fmt.Errorf("database parameter required for search_tables")
		}
		strategy, _ := params["strategy"].(string)
		if strategy == "" {
			strategy = "keyword" // 默认用关键词搜索，比 full 更精准
		}
		searchURL := fmt.Sprintf("/api/v1/retrieval/search?database_id=%s&query=%s&strategy=%s",
			dbID, url.QueryEscape(query), strategy)
		return t.httpGet(ctx, searchURL)
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
				nameLower := strings.ToLower(nameOrPath)
				for _, api := range apis {
					if apiMap, ok := api.(map[string]any); ok {
						apiName, _ := apiMap["name"].(string)
						apiPath, _ := apiMap["path"].(string)
						if apiName == nameOrPath || apiPath == nameOrPath ||
							strings.ToLower(apiName) == nameLower || strings.ToLower(apiPath) == nameLower {
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
	case "get_governance_task":
		// 获取单个治理任务详情
		taskID, _ := params["id"].(string)
		if taskID == "" {
			return nil, fmt.Errorf("id parameter required")
		}
		// 先获取列表，再匹配
		listResult, err := t.httpGet(ctx, "/api/v1/gov/tasks")
		if err != nil {
			return nil, err
		}
		if m, ok := listResult.(map[string]any); ok {
			if tasks, ok := m["tasks"].([]interface{}); ok {
				for _, task := range tasks {
					if taskMap, ok := task.(map[string]any); ok {
						if taskID == taskMap["id"] {
							return taskMap, nil
						}
					}
				}
			}
		}
		return nil, fmt.Errorf("governance task not found: %s", taskID)
	case "ontology_query":
		return t.httpPost(ctx, "/api/v1/ontology/query", params)
	default:
		return nil, fmt.Errorf("unknown endpoint: %s", endpoint)
	}
}

// searchAndFilterSchema 用 search_tables 搜索相关表，再获取匹配表的 schema
func (t *DataToolboxAPITool) searchAndFilterSchema(ctx context.Context, dbID, dbName, query string) (interface{}, error) {
	// 调用 search_tables 获取相关表
	searchURL := fmt.Sprintf("/api/v1/retrieval/search?database_id=%s&query=%s&strategy=keyword",
		dbID, url.QueryEscape(query))
	searchResult, err := t.httpGet(ctx, searchURL)
	if err != nil {
		// search 失败时 fallback 到全量
		return t.httpGet(ctx, "/api/v1/databases/"+dbID)
	}

	// 提取匹配的表名
	matchedTables := []string{}
	if m, ok := searchResult.(map[string]any); ok {
		if results, ok := m["results"].([]any); ok {
			for _, r := range results {
				if rMap, ok := r.(map[string]any); ok {
					if tableName, ok := rMap["table_name"].(string); ok {
						matchedTables = append(matchedTables, tableName)
					}
				}
			}
		}
	}

	if len(matchedTables) == 0 {
		return map[string]any{
			"database_name": dbName,
			"query":         query,
			"matched_tables": []string{},
			"hint":          "No tables matched. Try different keywords or use search_tables directly.",
		}, nil
	}

	// 获取完整 schema，只保留匹配的表
	dbDetail, err := t.httpGet(ctx, "/api/v1/databases/"+dbID)
	if err != nil {
		return nil, err
	}

	if m, ok := dbDetail.(map[string]any); ok {
		if dbObj, ok := m["database"].(map[string]any); ok {
			if tables, ok := dbObj["tables"].([]any); ok {
				// 构建 table_name → columns 映射
				tableColumns := map[string][]any{}
				if columns, ok := dbObj["columns"].([]any); ok {
					for _, col := range columns {
						if colMap, ok := col.(map[string]any); ok {
							if tblName, ok := colMap["table_name"].(string); ok {
								tableColumns[tblName] = append(tableColumns[tblName], colMap)
							}
						}
					}
				}

				// 筛选匹配的表
				matchedSet := map[string]bool{}
				for _, name := range matchedTables {
					matchedSet[name] = true
				}

				filteredTables := []map[string]any{}
				filteredColumns := []map[string]any{}
				for _, tbl := range tables {
					if tblMap, ok := tbl.(map[string]any); ok {
						tblName, _ := tblMap["name"].(string)
						if matchedSet[tblName] {
							filteredTables = append(filteredTables, tblMap)
							if cols, ok := tableColumns[tblName]; ok {
								for _, c := range cols {
									if cMap, ok := c.(map[string]any); ok {
										filteredColumns = append(filteredColumns, cMap)
									}
								}
							}
						}
					}
				}

				return map[string]any{
					"database_name": dbName,
					"query":         query,
					"total_matched": len(filteredTables),
					"tables":        filteredTables,
					"columns":       filteredColumns,
					"hint":          "Use get_table_schema(database, table) for more details on a specific table",
				}, nil
			}
		}
	}

	return dbDetail, nil
}

// extractTableSchema 从数据库详情中提取单张表的 schema
func (t *DataToolboxAPITool) extractTableSchema(dbDetail interface{}, tableName string) (interface{}, error) {
	m, ok := dbDetail.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("unexpected database detail format")
	}

	dbObj, ok := m["database"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("database detail missing 'database' field")
	}

	dbName, _ := dbObj["name"].(string)
	dbType, _ := dbObj["type"].(string)

	// 查找目标表
	tables, _ := dbObj["tables"].([]any)
	var targetTable map[string]any
	for _, tbl := range tables {
		if tblMap, ok := tbl.(map[string]any); ok {
			if name, _ := tblMap["name"].(string); name == tableName {
				targetTable = tblMap
				break
			}
		}
	}
	if targetTable == nil {
		// 模糊匹配
		tableNameLower := strings.ToLower(tableName)
		for _, tbl := range tables {
			if tblMap, ok := tbl.(map[string]any); ok {
				if name, _ := tblMap["name"].(string); strings.ToLower(name) == tableNameLower {
					targetTable = tblMap
					break
				}
			}
		}
	}
	if targetTable == nil {
		return nil, fmt.Errorf("table %q not found in database %q", tableName, dbName)
	}

	// 提取该表的 columns
	var tableColumns []any
	if columns, ok := dbObj["columns"].([]any); ok {
		for _, col := range columns {
			if colMap, ok := col.(map[string]any); ok {
				if colTable, _ := colMap["table_name"].(string); colTable == tableName {
					tableColumns = append(tableColumns, colMap)
				}
			}
		}
	}

	return map[string]any{
		"database_name": dbName,
		"database_type": dbType,
		"table":         targetTable,
		"columns":       tableColumns,
		"column_count":  len(tableColumns),
		"sql_hints":     getSQLDialectHints(dbType),
	}, nil
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
			"notes": []string{
				"达梦数据库表名需要带SCHEMA前缀，如 SCHEMA.TABLE 或 \"SCHEMA\".\"TABLE\"",
				"字符串用单引号，标识符用双引号",
				"LIMIT不支持，用 FETCH FIRST N ROWS ONLY 代替",
				"ROWNUM <= N 也可用于分页",
				"达梦兼容Oracle语法，序列用 NEXTVAL/CURRVAL",
				"日期函数: SYSDATE, TO_DATE(), TO_CHAR()",
				"字符串拼接用 || 运算符",
				"达梦默认SCHEMA为用户名，如 SYSDBA.TABLE",
			},
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

// fuzzyMatchTableNames 对表名做模糊匹配，返回匹配的表名列表
func fuzzyMatchTableNames(tables []any, query string) []string {
	queryLower := strings.ToLower(query)
	var matches []string
	for _, tbl := range tables {
		if tblMap, ok := tbl.(map[string]any); ok {
			name, _ := tblMap["name"].(string)
			comment, _ := tblMap["comment"].(string)
			if strings.Contains(strings.ToLower(name), queryLower) ||
				strings.Contains(strings.ToLower(comment), queryLower) {
				matches = append(matches, name)
			}
		}
	}
	// 按匹配度排序：名称匹配优先于注释匹配
	sort.Slice(matches, func(i, j int) bool {
		iName := strings.Contains(strings.ToLower(matches[i]), queryLower)
		jName := strings.Contains(strings.ToLower(matches[j]), queryLower)
		if iName != jName {
			return iName
		}
		return matches[i] < matches[j]
	})
	return matches
}

package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/tools"
)

// DataToolboxAPITool 让 PicoClaw agent 能调用 DataToolbox 内部 API
// 深度耦合的关键 — agent 直接调用服务内部 API，共享鉴权和数据库连接

const dataToolboxAPIDesc = `Call DataToolbox internal API endpoints to interact with databases, execute SQL, manage APIs, governance tasks, and query data ontology.

Available endpoints:
- list_databases: List all configured databases (no params)
- get_database: Get database details (params: name)
- execute_sql: Execute SQL query (params: database, sql)
- list_tables: List tables in a database (params: database)
- get_table_schema: Get table schema details (params: database, table)
- search_tables: Search tables by keyword (params: query, database?)
- list_apis: List all existing API endpoints (no params)
- create_api: Create a new API endpoint (params: name, path, method, sql, description, database, default_params)
- governance_tasks: List governance tasks (no params)
- ontology_query: Query data ontology (params: query)

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
				"description": "The API endpoint to call (e.g. list_databases, execute_sql)",
			},
			"params": map[string]any{
				"type":        "object",
				"description": "Parameters for the endpoint",
			},
		},
		"required": []string{"endpoint"},
	}
}

func (t *DataToolboxAPITool) Execute(ctx context.Context, args map[string]any) *tools.ToolResult {
	endpoint, _ := args["endpoint"].(string)
	params, _ := args["params"].(map[string]any)

	// 处理 LLM 把参数包在 "raw" 字段里的情况（Qwen3 等模型常见）
	// 递归解析嵌套的 raw 字段
	if endpoint == "" {
		current := args
		for i := 0; i < 5; i++ { // 最多递归5层
			raw, ok := current["raw"].(string)
			if !ok || raw == "" {
				break
			}
			var parsed map[string]any
			if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
				break
			}
			if e, ok := parsed["endpoint"].(string); ok {
				endpoint = e
			}
			if p, ok := parsed["params"].(map[string]any); ok {
				params = p
			}
			if endpoint != "" {
				break
			}
			current = parsed // 继续解析下一层 raw
		}
	}

	if endpoint == "" {
		return tools.ErrorResult("endpoint is required. Available: list_databases, get_database, list_tables, get_table_schema, execute_sql, list_apis, create_api, search_tables, governance_tasks, ontology_query")
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
		return t.httpGet(ctx, "/api/data-ontology/databases")
	case "get_database":
		// 支持用 name 或 id 查询；如果用 name，先通过 list_databases 找到 ID
		nameOrID, ok := params["name"].(string)
		if !ok || nameOrID == "" {
			nameOrID, _ = params["id"].(string)
		}
		if nameOrID == "" {
			return nil, fmt.Errorf("name or id parameter required")
		}
		// 先尝试直接用 ID 查
		result, err := t.httpGet(ctx, "/api/data-ontology/databases/"+nameOrID)
		if err == nil {
			if m, ok := result.(map[string]any); ok {
				if success, ok := m["success"].(bool); ok && success {
					return result, nil
				}
				log.Printf("[datatoolbox_api] get_database %q: direct lookup success=false, falling back to name search", nameOrID)
			} else {
				log.Printf("[datatoolbox_api] get_database %q: result is not map[string]any, type=%T", nameOrID, result)
			}
		} else {
			log.Printf("[datatoolbox_api] get_database %q: direct lookup error: %v", nameOrID, err)
		}
		// ID 查不到，尝试通过 list_databases 匹配 name
		listResult, listErr := t.httpGet(ctx, "/api/data-ontology/databases")
		if listErr != nil {
			log.Printf("[datatoolbox_api] list_databases error: %v", listErr)
			return nil, fmt.Errorf("database %q not found (list failed: %v)", nameOrID, listErr)
		}
		listMap, ok := listResult.(map[string]any)
		if !ok {
			log.Printf("[datatoolbox_api] list_databases result is not map, type=%T", listResult)
			return nil, fmt.Errorf("database %q not found (unexpected list format)", nameOrID)
		}
		dbs, ok := listMap["databases"].([]any)
		if !ok {
			log.Printf("[datatoolbox_api] list_databases: 'databases' field not []any, type=%T", listMap["databases"])
			return nil, fmt.Errorf("database %q not found (no databases list)", nameOrID)
		}
		nameLower := strings.ToLower(nameOrID)
		for _, db := range dbs {
			if dbMap, ok := db.(map[string]any); ok {
				dbName, _ := dbMap["name"].(string)
				dbID, _ := dbMap["id"].(string)
				if strings.ToLower(dbName) == nameLower && dbID != "" {
					log.Printf("[datatoolbox_api] get_database: matched name %q -> id %s", nameOrID, dbID)
					return t.httpGet(ctx, "/api/data-ontology/databases/"+dbID)
				}
			}
		}
		return nil, fmt.Errorf("database %q not found", nameOrID)
	case "execute_sql":
		return t.httpPost(ctx, "/api/data-ontology/governance/execute-sql", params)
	case "list_tables":
		db, ok := params["database"].(string)
		if !ok || db == "" {
			return nil, fmt.Errorf("database parameter required")
		}
		return t.httpGet(ctx, fmt.Sprintf("/api/data-ontology/databases/%s/tables", db))
	case "get_table_schema":
		db, _ := params["database"].(string)
		tbl, _ := params["table"].(string)
		if db == "" || tbl == "" {
			return nil, fmt.Errorf("database and table parameters required")
		}
		return t.httpGet(ctx, fmt.Sprintf("/api/data-ontology/databases/%s/tables/%s/schema", db, tbl))
	case "search_tables":
		return t.httpPost(ctx, "/api/data-ontology/table-retrieval/search", params)
	case "list_apis":
		return t.httpGet(ctx, "/api/data-ontology/apis")
	case "create_api":
		return t.httpPost(ctx, "/api/data-ontology/apis", params)
	case "governance_tasks":
		return t.httpGet(ctx, "/api/data-ontology/governance/tasks")
	case "ontology_query":
		return t.httpPost(ctx, "/api/data-ontology/ontology/query", params)
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

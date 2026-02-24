// MCP 模块：
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
	"os"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// mcpLoopbackAddr 由 server.go 的 main() 在监听前设置
var mcpLoopbackAddr = "http://127.0.0.1:8080"

const mcpServerName = "data-ontology"
const mcpServerVersion = "1.0.0"
const mcpProtocolVersion = "2024-11-05"

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
		client:  &http.Client{Timeout: 30 * time.Second},
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
			"name":        "list_apis",
			"description": "列出数据本体池中已配置的接口（path、method、关联数据库）",
			"inputSchema": map[string]interface{}{
				"type": "object", "properties": map[string]interface{}{},
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
		data, err := cli.do(http.MethodGet, "/api/data-ontology/databases", nil)
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
		data, err := cli.do(http.MethodGet, "/api/data-ontology/databases/"+args.DatabaseID, nil)
		if err != nil {
			return nil, err
		}
		return textResult(data), nil
	case "list_apis":
		data, err := cli.do(http.MethodGet, "/api/data-ontology/apis", nil)
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
		data, err := cli.do(http.MethodPost, "/api/data-ontology/apis/"+args.ApiID+"/test", body)
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
		w.Write([]byte(`{"error":"MCP 已关闭，请在数据本体池中开启 MCP 模块"}`))
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
		mcpSendError(w, nil, -32700, "解析错误: "+err.Error())
		return
	}

	apiKey := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	cli := &mcpClient{
		baseURL: mcpLoopbackAddr,
		apiKey:  apiKey,
		client:  &http.Client{Timeout: 30 * time.Second},
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
			mcpSendError(w, rpcReq.ID, -32602, "参数解析错误: "+err.Error())
			return
		}
		result, err := mcpCallTool(cli, params.Name, params.Arguments)
		if err != nil {
			mcpSendError(w, rpcReq.ID, -32000, err.Error())
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
	data, err := cli.do(http.MethodGet, "/api/data-ontology/databases", nil)
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
	data, err := cli.do(http.MethodGet, "/api/data-ontology/databases/"+in.DatabaseID, nil)
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
	data, err := cli.do(http.MethodGet, "/api/data-ontology/apis", nil)
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
	data, err := cli.do(http.MethodPost, "/api/data-ontology/apis/"+in.ApiID+"/test", body)
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
	data, err := cli.do(http.MethodGet, "/api/data-ontology/mcp/config", nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "MCP 无法连接服务端: %v\n", err)
		os.Exit(1)
	}
	var configResp struct {
		Success bool `json:"success"`
		Enabled bool `json:"enabled"`
	}
	if err := json.Unmarshal(data, &configResp); err != nil || !configResp.Success || !configResp.Enabled {
		fmt.Fprintf(os.Stderr, "MCP 已在服务端关闭，请在数据本体池中开启 MCP 模块\n")
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

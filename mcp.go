// MCP 模块：
//   HTTP 模式（推荐）：MCP 服务以 HTTP 端点内嵌在服务器中，客户端通过 URL 直接连接，无需本地二进制。
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

// mcpLoopbackAddr 由 server.go 的 main() 在监听前设置，供 HTTP 模式工具调用本服务内部 API 使用
var mcpLoopbackAddr = "http://127.0.0.1:8080"

type mcpCtxKeyType string

const mcpCtxApiKey mcpCtxKeyType = "mcp_api_key"

// mcpStreamableHandler 和 mcpSSEHandler 在服务启动时初始化一次，整个生命周期复用。
// 每次新 session 由 callback 调用 buildMCPServer，通过 context 取得该 session 的 API Key。
var (
	mcpStreamableHandler http.Handler
	mcpSSEHandler        http.Handler
)

func initMCPHandlers() {
	mcpStreamableHandler = mcp.NewStreamableHTTPHandler(func(req *http.Request) *mcp.Server {
		apiKey, _ := req.Context().Value(mcpCtxApiKey).(string)
		return buildMCPServer(apiKey)
	}, nil)
	mcpSSEHandler = mcp.NewSSEHandler(func(req *http.Request) *mcp.Server {
		apiKey, _ := req.Context().Value(mcpCtxApiKey).(string)
		return buildMCPServer(apiKey)
	}, nil)
}

const mcpServerName = "data-ontology"
const mcpServerVersion = "1.0.0"

// mcpClient 通过 HTTP 调用数据本体池 API
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

// MCP 工具统一返回：把 API 原始 JSON 放在 result 里
type mcpOutput struct {
	Result string `json:"result"`
}

// list_databases
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

// get_tables
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

// list_apis
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

// call_api
type callApiIn struct {
	ApiID  string                 `json:"api_id" jsonschema:"required,description=接口 ID"`
	Params map[string]interface{}  `json:"params" jsonschema:"description=请求参数，与接口 SQL 中占位符对应"`
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

// buildMCPServer 创建一个 MCP 服务实例，工具函数通过 apiKey 回调本服务内部 API。
// 每个 HTTP 会话独立一个实例，apiKey 通过闭包绑定，不共享状态。
func buildMCPServer(apiKey string) *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: mcpServerName, Version: mcpServerVersion}, nil)
	cli := &mcpClient{
		baseURL: mcpLoopbackAddr,
		apiKey:  apiKey,
		client:  &http.Client{Timeout: 30 * time.Second},
	}
	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_databases",
		Description: "列出数据本体池中已配置的数据库（不含密码）",
	}, func(ctx context.Context, req *mcp.CallToolRequest, _ listDatabasesIn) (*mcp.CallToolResult, mcpOutput, error) {
		data, err := cli.do(http.MethodGet, "/api/data-ontology/databases", nil)
		if err != nil {
			return nil, mcpOutput{}, err
		}
		return nil, mcpOutput{Result: string(data)}, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name:        "get_tables",
		Description: "获取指定数据库的表列表及连接状态",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in getTablesIn) (*mcp.CallToolResult, mcpOutput, error) {
		data, err := cli.do(http.MethodGet, "/api/data-ontology/databases/"+in.DatabaseID, nil)
		if err != nil {
			return nil, mcpOutput{}, err
		}
		return nil, mcpOutput{Result: string(data)}, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_apis",
		Description: "列出数据本体池中已配置的接口（path、method、关联数据库）",
	}, func(ctx context.Context, req *mcp.CallToolRequest, _ listApisIn) (*mcp.CallToolResult, mcpOutput, error) {
		data, err := cli.do(http.MethodGet, "/api/data-ontology/apis", nil)
		if err != nil {
			return nil, mcpOutput{}, err
		}
		return nil, mcpOutput{Result: string(data)}, nil
	})
	mcp.AddTool(s, &mcp.Tool{
		Name:        "call_api",
		Description: "调用已配置的接口，传入接口 ID 和 params 执行并返回数据",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in callApiIn) (*mcp.CallToolResult, mcpOutput, error) {
		body, _ := json.Marshal(map[string]interface{}{"params": in.Params})
		if body == nil {
			body = []byte(`{"params":{}}`)
		}
		data, err := cli.do(http.MethodPost, "/api/data-ontology/apis/"+in.ApiID+"/test", body)
		if err != nil {
			return nil, mcpOutput{}, err
		}
		return nil, mcpOutput{Result: string(data)}, nil
	})
	return s
}

// handleMCPHTTP 是内嵌在 HTTP 服务器中的 MCP 端点。
// 路由规则：
//   - /mcp        → Streamable HTTP Transport（Cursor/Claude 首选）
//   - /mcp/sse    → SSE Transport（Cursor 降级 fallback）
//   - /mcp/...    → SSE Transport（消息端点等）
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
	// OPTIONS preflight 在 CORS 中间件已处理，这里不需要 auth 检查
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if !verifyToken(r) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"未授权，请在 Authorization 头中提供有效的 API Key"}`))
		return
	}
	apiKey := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	ctx := context.WithValue(r.Context(), mcpCtxApiKey, apiKey)
	r = r.WithContext(ctx)

	path := r.URL.Path
	if path == "/mcp" || path == "/mcp/" {
		// Streamable HTTP Transport：POST 发送消息，GET 接收 SSE 流
		mcpStreamableHandler.ServeHTTP(w, r)
	} else {
		// SSE Transport fallback（/mcp/sse、/mcp/message 等）
		http.StripPrefix("/mcp", mcpSSEHandler).ServeHTTP(w, r)
	}
}

func runMCPServer() {
	cli, err := newMCPClient()
	if err != nil {
		fmt.Fprintf(os.Stderr, "MCP 启动失败: %v\n", err)
		os.Exit(1)
	}
	// 检查服务端 MCP 总开关
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
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_databases",
		Description: "列出数据本体池中已配置的数据库（不含密码）",
	}, mcpListDatabases)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_tables",
		Description: "获取指定数据库的表列表及连接状态",
	}, mcpGetTables)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_apis",
		Description: "列出数据本体池中已配置的接口（path、method、关联数据库）",
	}, mcpListApis)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "call_api",
		Description: "调用已配置的接口，传入接口 ID 和 params 执行并返回数据",
	}, mcpCallApi)

	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		fmt.Fprintf(os.Stderr, "MCP 运行错误: %v\n", err)
		os.Exit(1)
	}
}

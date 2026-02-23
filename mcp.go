// MCP 模块：通过 stdio 暴露数据本体池能力，供 Cursor 等客户端调用。
// 使用方式：DATA_ONTOLOGY_BASE_URL=http://... DATA_ONTOLOGY_API_KEY=dok_xxx ./datatoolbox-server mcp

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

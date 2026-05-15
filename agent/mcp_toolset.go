package agent

import (
	"context"
	"fmt"
	"log"
	"os/exec"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"google.golang.org/adk/tool"
	"google.golang.org/adk/tool/mcptoolset"
)

// BuildMCPToolsets 从 MCP Server 配置列表构建 adk-go MCPToolset 列表
// 每个启用的 MCP Server → mcptoolset.New() → tool.Toolset
func BuildMCPToolsets(ctx context.Context, configs []MCPServerConfig) ([]tool.Toolset, error) {
	var toolsets []tool.Toolset

	for _, cfg := range configs {
		if !cfg.Enabled {
			log.Printf("[mcp-toolset] skipping disabled: %s (%s)", cfg.ID, cfg.Name)
			continue
		}

		ts, err := buildSingleMCPToolset(ctx, cfg)
		if err != nil {
			log.Printf("[mcp-toolset] WARNING: failed to create toolset for %s (%s): %v", cfg.ID, cfg.Name, err)
			continue // 单个失败不阻塞其他
		}

		toolsets = append(toolsets, ts)
		log.Printf("[mcp-toolset] created toolset: %s (%s)", cfg.ID, cfg.Name)
	}

	return toolsets, nil
}

// buildSingleMCPToolset 为单个 MCP Server 配置创建 adk-go MCPToolset
func buildSingleMCPToolset(ctx context.Context, cfg MCPServerConfig) (tool.Toolset, error) {
	if cfg.Command == "" {
		return nil, fmt.Errorf("MCP server %q: command is required (stdio mode)", cfg.ID)
	}

	// 构建 exec.Command
	cmd := exec.Command(cfg.Command, cfg.Args...)

	// 设置环境变量
	if len(cfg.Env) > 0 {
		env := make([]string, 0, len(cfg.Env))
		for k, v := range cfg.Env {
			env = append(env, fmt.Sprintf("%s=%s", k, v))
		}
		cmd.Env = env
	}

	// 使用 go-sdk v1.4.1 的 CommandTransport
	transport := &mcp.CommandTransport{Command: cmd}

	ts, err := mcptoolset.New(mcptoolset.Config{
		Transport: transport,
	})
	if err != nil {
		return nil, fmt.Errorf("create MCP toolset for %q: %w", cfg.ID, err)
	}

	return ts, nil
}

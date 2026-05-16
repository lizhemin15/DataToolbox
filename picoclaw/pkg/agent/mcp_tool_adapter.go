package agent

import (
	"context"
	"encoding/json"
	"fmt"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	mcppkg "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/mcp"
	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/logger"
	toolshared "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/tools/shared"
)

// mcpToolAdapter wraps an MCP tool discovered from a connected MCP server
// and adapts it to the PicoClaw Tool interface so it can be registered in
// the ToolRegistry and called directly by the LLM.
type mcpToolAdapter struct {
	serverName string
	tool       *mcpsdk.Tool
	manager    *mcppkg.Manager
}

func newMCPToolAdapter(serverName string, tool *mcpsdk.Tool, manager *mcppkg.Manager) *mcpToolAdapter {
	return &mcpToolAdapter{
		serverName: serverName,
		tool:       tool,
		manager:    manager,
	}
}

func (t *mcpToolAdapter) Name() string {
	return t.tool.Name
}

func (t *mcpToolAdapter) Description() string {
	return t.tool.Description
}

func (t *mcpToolAdapter) Parameters() map[string]any {
	if t.tool.InputSchema == nil {
		return map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		}
	}
	switch v := t.tool.InputSchema.(type) {
	case map[string]any:
		return v
	default:
		data, err := json.Marshal(v)
		if err != nil {
			logger.WarnCF("agent", "Failed to marshal MCP tool InputSchema",
				map[string]any{"tool": t.tool.Name, "error": err.Error()})
			return map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			}
		}
		var result map[string]any
		if err := json.Unmarshal(data, &result); err != nil {
			logger.WarnCF("agent", "Failed to unmarshal MCP tool InputSchema",
				map[string]any{"tool": t.tool.Name, "error": err.Error()})
			return map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			}
		}
		return result
	}
}

func (t *mcpToolAdapter) Execute(ctx context.Context, args map[string]any) *toolshared.ToolResult {
	// LLMs sometimes wrap arguments in a "raw" field (legacy datatoolbox_api format).
	// Unwrap it so MCP tools receive proper flat arguments.
	if raw, ok := args["raw"]; ok {
		switch v := raw.(type) {
		case string:
			var parsed map[string]any
			if err := json.Unmarshal([]byte(v), &parsed); err == nil {
				args = parsed
			}
		case map[string]any:
			args = v
		}
	}

	logger.InfoCF("agent", "MCP tool call",
		map[string]any{
			"server": t.serverName,
			"tool":   t.tool.Name,
			"args":   args,
		})

	result, err := t.manager.CallTool(ctx, t.serverName, t.tool.Name, args)
	if err != nil {
		logger.ErrorCF("agent", "MCP tool call failed",
			map[string]any{
				"server": t.serverName,
				"tool":   t.tool.Name,
				"error":  err.Error(),
			})
		return toolshared.ErrorResult(fmt.Sprintf("MCP tool %q call failed: %v", t.tool.Name, err))
	}

	// Extract text content from the result
	var content string
	for _, item := range result.Content {
		switch v := item.(type) {
		case *mcpsdk.TextContent:
			content += v.Text
		default:
			// Try JSON serialization for unknown content types
			data, _ := json.Marshal(v)
			content += string(data)
		}
	}

	if content == "" {
		data, _ := json.Marshal(result)
		content = string(data)
	}

	if result.IsError {
		return toolshared.ErrorResult(content)
	}

	return toolshared.NewToolResult(content)
}

// PromptMetadata returns metadata for prompt layering.
func (t *mcpToolAdapter) PromptMetadata() toolshared.PromptMetadata {
	return toolshared.PromptMetadata{
		Layer:  toolshared.ToolPromptSlotMCP,
		Slot:   toolshared.ToolPromptSlotMCP,
		Source: "tool_registry:mcp",
	}
}
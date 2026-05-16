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
	// LLMs sometimes wrap arguments in nested "raw" fields (legacy datatoolbox_api format).
	// Unwrap ALL layers so MCP tools receive proper flat arguments.
	// e.g. {"raw":"{\"raw\":\"{\\\"path\\\":...}\"}"} → {"path":...}
	logger.DebugCF("agent", "MCP tool raw unwrap: before",
		map[string]any{"tool": t.tool.Name, "args_keys": func() []string {
			keys := make([]string, 0, len(args))
			for k := range args { keys = append(keys, k) }
			return keys
		}()})

	for {
		raw, ok := args["raw"]
		if !ok {
			break
		}
		switch v := raw.(type) {
		case string:
			// Try direct parse first
			var parsed map[string]any
			if err := json.Unmarshal([]byte(v), &parsed); err == nil {
				args = parsed
				continue // check for another layer
			}
			// LLM sometimes returns truncated JSON (missing closing braces).
			// Try to fix by appending closing braces.
			fixed := v
			for i := 0; i < 5; i++ {
				fixed += "}"
				if err := json.Unmarshal([]byte(fixed), &parsed); err == nil {
					logger.InfoCF("agent", "MCP tool raw unwrap: fixed truncated JSON",
						map[string]any{"tool": t.tool.Name, "original_len": len(v), "added_braces": i + 1})
					args = parsed
					break
				}
			}
			if len(parsed) > 0 {
				continue // successfully fixed and parsed
			}
			logger.WarnCF("agent", "MCP tool raw unwrap: string parse failed",
				map[string]any{"tool": t.tool.Name, "raw_len": len(v)})
		case map[string]any:
			args = v
			continue // check for another layer
		}
		break // raw field exists but not unwappable
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
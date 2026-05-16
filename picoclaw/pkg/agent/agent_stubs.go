package agent

import (
	"context"
	"sync"

	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/config"
	mcppkg "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/mcp"
	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/providers"
	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/providers/protocoltypes"
)

// mcpRuntime manages the MCP Manager lifecycle for an AgentLoop.
// It is thread-safe: the Manager is created once and protected by a mutex.
type mcpRuntime struct {
	mu      sync.RWMutex
	manager *mcppkg.Manager
}

// getManager returns the current *mcp.Manager (or nil if not initialized).
// The return type is interface{} for compatibility with agent_command.go callers.
func (m *mcpRuntime) getManager() interface{} {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.manager == nil {
		return nil
	}
	return m.manager
}

// takeManager atomically takes ownership of the *mcp.Manager, removing it from
// the runtime so that subsequent getManager calls return nil.
// Returns the old *mcp.Manager (or nil) as interface{}.
// The caller is responsible for calling Close() on the returned Manager.
func (m *mcpRuntime) takeManager() interface{} {
	m.mu.Lock()
	defer m.mu.Unlock()
	mgr := m.manager
	m.manager = nil
	if mgr == nil {
		return nil
	}
	return mgr
}

// reset atomically replaces the Manager with nil and returns the old Manager
// as interface{}. The caller should Close() the returned Manager.
func (m *mcpRuntime) reset() interface{} {
	return m.takeManager()
}

// ensureMCPInitialized creates the MCP Manager and connects all configured
// MCP servers. It is safe to call multiple times; initialization happens only
// once. On subsequent calls it is a no-op if a Manager already exists.
func (al *AgentLoop) ensureMCPInitialized(ctx context.Context) error {
	// Fast path: already initialized.
	al.mcp.mu.RLock()
	if al.mcp.manager != nil {
		al.mcp.mu.RUnlock()
		return nil
	}
	al.mcp.mu.RUnlock()

	// Slow path: create and connect.
	al.mcp.mu.Lock()
	defer al.mcp.mu.Unlock()

	// Double-check after acquiring write lock.
	if al.mcp.manager != nil {
		return nil
	}

	cfg := al.GetConfig()
	if cfg == nil {
		return nil
	}

	// If MCP is disabled or no servers configured, nothing to do.
	if !cfg.Tools.MCP.Enabled || len(cfg.Tools.MCP.Servers) == 0 {
		return nil
	}

	mgr := mcppkg.NewManager()

	// Connect all configured servers from the config.
	if err := mgr.LoadFromConfig(ctx, cfg); err != nil {
		// If all servers failed, close the manager and return the error.
		_ = mgr.Close()
		return err
	}

	al.mcp.manager = mgr
	return nil
}

// GetRegistry returns the agent registry (thread-safe).
func (al *AgentLoop) GetRegistry() *AgentRegistry {
	al.mu.RLock()
	defer al.mu.RUnlock()
	return al.registry
}

// GetConfig returns the current config (thread-safe).
func (al *AgentLoop) GetConfig() *config.Config {
	al.mu.RLock()
	defer al.mu.RUnlock()
	return al.cfg
}

// RecordLastChannel records the last channel key for the agent.
func (al *AgentLoop) RecordLastChannel(channelKey string) string {
	return channelKey
}

// maybePublishError publishes an error response unless the error is context.Canceled.
func (al *AgentLoop) maybePublishError(ctx context.Context, channel, chatID, sessionKey string, err error) {
	if err == context.Canceled {
		return
	}
	// no-op: publishing not wired yet
}

// PublishResponseIfNeeded publishes the response if SendResponse is true.
func (al *AgentLoop) PublishResponseIfNeeded(ctx context.Context, channel, chatID, sessionKey, content string) {
	// no-op: publishing not wired yet
}

// serverIsDeferred is a stub for MCP deferred check.
func serverIsDeferred(name string, enabled bool, serverCfg config.MCPServerConfig) bool {
	return false
}

// evolutionBridge stub — evolution is not needed for DataToolbox integration.
type evolutionBridge struct{}

func (b *evolutionBridge) Close() error { return nil }
func (b *evolutionBridge) handleRuntimeTurnEnd(evt interface{}) bool { return false }
func (b *evolutionBridge) subscribeRuntimeEvents(ch interface{}) error { return nil }
func (b *evolutionBridge) setCurrentCheck(fn func(*evolutionBridge) bool) {}

// newEvolutionBridge returns nil (stub).
func newEvolutionBridge(registry *AgentRegistry, cfg *config.Config, provider providers.LLMProvider) (*evolutionBridge, error) {
	return nil, nil
}

// evolutionDirectDeliveryAttr is a stub constant.
const evolutionDirectDeliveryAttr = "evolution_direct_delivery"

// agentHasDiscoverableMCPServers checks if any MCP servers are configured and discoverable.
func agentHasDiscoverableMCPServers(cfg *config.Config, allowlist map[string]struct{}) bool {
	if cfg == nil || cfg.Tools.MCP.Servers == nil {
		return false
	}
	for name, serverCfg := range cfg.Tools.MCP.Servers {
		if !serverCfg.Enabled {
			continue
		}
		if len(allowlist) > 0 {
			if _, ok := allowlist[name]; !ok {
				continue
			}
		}
		// A server with a URL (streamable-http/sse) or Command (stdio) is discoverable
		if serverCfg.URL != "" || serverCfg.Command != "" {
			return true
		}
	}
	return false
}

// publishPicoReasoning is a stub.
func (al *AgentLoop) publishPicoReasoning(ctx context.Context, content, chatID string) {}

// handleReasoning is a stub.
func (al *AgentLoop) handleReasoning(ctx context.Context, content, channel, targetChannelID string) {}

// targetReasoningChannelID is a stub.
func (al *AgentLoop) targetReasoningChannelID(channel string) string { return "" }

// publishPicoToolCallInterim is a stub.
func (al *AgentLoop) publishPicoToolCallInterim(ctx context.Context, ts *turnState, reasoning, content string, toolCalls []protocoltypes.ToolCall) {}

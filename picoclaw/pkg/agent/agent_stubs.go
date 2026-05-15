package agent

import (
	"context"

	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/config"
	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/providers"
	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/providers/protocoltypes"
)

// mcpRuntime stub — MCP runtime is not needed for DataToolbox integration.
type mcpRuntime struct{}

func (m *mcpRuntime) takeManager() interface{} { return nil }
func (m *mcpRuntime) reset() interface{}       { return nil }
func (m *mcpRuntime) getManager() interface{}  { return nil }

// ensureMCPInitialized is a no-op stub.
func (al *AgentLoop) ensureMCPInitialized(ctx context.Context) error {
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

// agentHasDiscoverableMCPServers is a stub.
func agentHasDiscoverableMCPServers(cfg *config.Config, allowlist map[string]struct{}) bool {
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

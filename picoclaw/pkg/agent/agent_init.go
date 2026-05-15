// PicoClaw - Ultra-lightweight personal AI agent
// Simplified for DataToolbox integration — only core tools.

package agent

import (
	"context"

	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/agent/interfaces"
	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/bus"
	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/commands"
	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/config"
	runtimeevents "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/events"
	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/logger"
	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/providers"
	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/state"
	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/tools"
)

func NewAgentLoop(
	cfg *config.Config,
	msgBus *bus.MessageBus,
	provider providers.LLMProvider,
	opts ...AgentLoopOption,
) *AgentLoop {
	registry := NewAgentRegistry(cfg, provider)

	cooldown := providers.NewCooldownTracker()
	rl := providers.NewRateLimiterRegistry()
	for _, agentID := range registry.ListAgentIDs() {
		if agent, ok := registry.GetAgent(agentID); ok {
			rl.RegisterCandidates(agent.Candidates)
			rl.RegisterCandidates(agent.LightCandidates)
		}
	}
	fallbackChain := providers.NewFallbackChain(cooldown, rl)

	defaultAgent := registry.GetDefaultAgent()
	var stateManager *state.Manager
	if defaultAgent != nil {
		stateManager = state.NewManager(defaultAgent.Workspace)
	}

	bridge, err := newEvolutionBridge(registry, cfg, provider)
	if err != nil {
		logger.WarnCF("agent", "Failed to initialize evolution bridge", map[string]any{
			"error": err.Error(),
		})
	}

	workerPoolSize := cfg.Agents.Defaults.MaxParallelTurns
	if workerPoolSize <= 0 {
		workerPoolSize = 1
	}

	al := &AgentLoop{
		bus:               msgBus,
		cfg:               cfg,
		registry:          registry,
		state:             stateManager,
		fallback:          fallbackChain,
		cmdRegistry:       commands.NewRegistry(commands.BuiltinDefinitions()),
		evolution:         bridge,
		steering:          newSteeringQueue(parseSteeringMode(cfg.Agents.Defaults.SteeringMode)),
		workerSem:         make(chan struct{}, workerPoolSize),
		ownsRuntimeEvents: true,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(al)
		}
	}
	if al.runtimeEvents == nil {
		al.runtimeEvents = runtimeevents.NewBus()
		al.ownsRuntimeEvents = true
	}
	if bridge != nil {
		bridge.setCurrentCheck(al.isCurrentEvolutionBridge)
		if err := bridge.subscribeRuntimeEvents(al.runtimeEvents.Channel()); err != nil {
			logger.WarnCF("agent", "Failed to subscribe evolution bridge to runtime events", map[string]any{
				"error": err.Error(),
			})
		}
	}
	al.refreshRuntimeEventLogger(cfg)
	al.providerFactory = providers.CreateProviderFromConfig
	al.hooks = NewHookManager(al.runtimeEvents.Channel())
	configureHookManagerFromConfig(al.hooks, cfg)
	al.contextManager = al.resolveContextManager()

	registerSharedTools(al, cfg, msgBus, registry, provider)

	return al
}

func registerSharedTools(
	al *AgentLoop,
	cfg *config.Config,
	msgBus interfaces.MessageBus,
	registry *AgentRegistry,
	provider providers.LLMProvider,
) {
	for _, agentID := range registry.ListAgentIDs() {
		agent, ok := registry.GetAgent(agentID)
		if !ok {
			continue
		}

		// Spawn/subagent tools — core multi-agent capability
		spawnEnabled := cfg.Tools.IsToolEnabled("spawn")
		spawnStatusEnabled := cfg.Tools.IsToolEnabled("spawn_status")
		if (spawnEnabled || spawnStatusEnabled) && cfg.Tools.IsToolEnabled("subagent") {
			subagentManager := tools.NewSubagentManager(provider, agent.Model, agent.Workspace)
			subagentManager.SetLLMOptions(agent.MaxTokens, agent.Temperature)

			subagentManager.SetSpawner(func(
				ctx context.Context,
				task, label, targetAgentID string,
				tls *tools.ToolRegistry,
				maxTokens int,
				temperature float64,
				hasMaxTokens, hasTemperature bool,
			) (*tools.ToolResult, error) {
				parentTS := turnStateFromContext(ctx)
				if parentTS == nil {
					parentTS = &turnState{
						ctx:            ctx,
						turnID:         "adhoc-root",
						depth:          0,
						pendingResults: make(chan *tools.ToolResult, 16),
						concurrencySem: make(chan struct{}, 5),
					}
				}

				var tlSlice []tools.Tool
				for _, name := range tls.List() {
					if t, ok := tls.Get(name); ok {
						tlSlice = append(tlSlice, t)
					}
				}

			systemPrompt := "你是一个子智能体，独立完成指定任务并报告结果。\n" +
				"你可以使用工具来完成任务。\n" +
				"完成后，请用中文提供清晰的总结。\n\n" +
				"任务: " + task

				modelToUse := agent.Model
				if targetAgentID != "" {
					if targetAgent, ok := al.GetRegistry().GetAgent(targetAgentID); ok {
						modelToUse = targetAgent.Model
					}
				}

				subCfg := SubTurnConfig{
					Model:        modelToUse,
					Tools:        tlSlice,
					SystemPrompt: systemPrompt,
				}
				if hasMaxTokens {
					subCfg.MaxTokens = maxTokens
				}

				return spawnSubTurn(ctx, al, parentTS, subCfg)
			})

			subagentManager.SetTools(agent.Tools.Clone())
			if spawnEnabled {
				spawnTool := tools.NewSpawnTool(subagentManager)
				spawnTool.SetSpawner(NewSubTurnSpawner(al))
				currentAgentID := agentID
				spawnTool.SetAllowlistChecker(func(targetAgentID string) bool {
					return registry.CanSpawnSubagent(currentAgentID, targetAgentID)
				})
				agent.Tools.Register(spawnTool)

				subagentTool := tools.NewSubagentTool(subagentManager)
				subagentTool.SetSpawner(NewSubTurnSpawner(al))
				agent.Tools.Register(subagentTool)
			}
			if spawnStatusEnabled {
				agent.Tools.Register(tools.NewSpawnStatusTool(subagentManager))
			}
		}

		// Delegate tool — multi-agent delegation
		if len(registry.ListAgentIDs()) > 1 {
			delegateTool := tools.NewDelegateTool()
			delegateTool.SetSpawner(NewSubTurnSpawner(al))
			currentAgentID := agentID
			delegateTool.SetSelfAgentID(currentAgentID)
			delegateTool.SetAllowlistChecker(func(targetAgentID string) bool {
				return registry.CanSpawnSubagent(currentAgentID, targetAgentID)
			})
			agent.Tools.Register(delegateTool)
		}
	}
}

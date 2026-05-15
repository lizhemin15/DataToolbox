package agent

import (
	"fmt"

	adkagent "google.golang.org/adk/agent"
	"google.golang.org/adk/agent/llmagent"
	"google.golang.org/adk/agent/workflowagents/loopagent"
	"google.golang.org/adk/agent/workflowagents/parallelagent"
	"google.golang.org/adk/agent/workflowagents/sequentialagent"
	"google.golang.org/adk/model"
	"google.golang.org/adk/tool"
)

// ---------------------------------------------------------------------------
// Configuration types (declarative, JSON-friendly)
// ---------------------------------------------------------------------------

// AgentConfig describes a single agent node in the cluster tree.
// All JSON field names use snake_case.
type AgentConfig struct {
	// Name must be unique within the agent tree.
	Name string `json:"name"`
	// Description is a one-line capability summary used by the LLM for routing.
	Description string `json:"description"`
	// Instruction is the system prompt / instruction template for LLMAgents.
	Instruction string `json:"instruction,omitempty"`
	// Model is the LLM implementation. Not serialisable — set at runtime.
	Model model.LLM `json:"-"`
	// Mode determines how sub-agents are composed.
	// single  → a standalone LLMAgent (default).
	// sequential → SequentialAgent wrapping SubAgents.
	// parallel   → ParallelAgent wrapping SubAgents.
	// loop       → LoopAgent wrapping SubAgents.
	Mode Mode `json:"mode,omitempty"`
	// SubAgents are child agent configurations (recursively built).
	SubAgents []AgentConfig `json:"sub_agents,omitempty"`
	// Tools are pre-constructed tool instances. Not serialisable — set at runtime.
	Tools []tool.Tool `json:"-"`
	// Toolsets are pre-constructed toolset instances. Not serialisable — set at runtime.
	Toolsets []tool.Toolset `json:"-"`
	// MaxIterations is only meaningful when Mode == ModeLoop.
	MaxIterations uint `json:"max_iterations,omitempty"`
	// OutputKey optionally stores the agent's text output in session state.
	OutputKey string `json:"output_key,omitempty"`
	// DisallowTransferToParent prevents the agent from transferring back up.
	DisallowTransferToParent bool `json:"disallow_transfer_to_parent,omitempty"`
	// DisallowTransferToPeers prevents lateral agent transfers.
	DisallowTransferToPeers bool `json:"disallow_transfer_to_peers,omitempty"`
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

// Factory builds adk-go Agent trees from AgentConfig declarations.
type Factory struct {
	// defaultModel is used when an AgentConfig does not specify its own Model.
	defaultModel model.LLM
}

// NewFactory creates a Factory with the given default LLM model.
func NewFactory(defaultModel model.LLM) *Factory {
	return &Factory{defaultModel: defaultModel}
}

// Build constructs an adk-go Agent tree from the given config.
// It recursively creates sub-agents bottom-up, then wraps them in the
// appropriate workflow agent (or returns a bare LLMAgent for ModeSingle).
func (f *Factory) Build(cfg AgentConfig) (adkagent.Agent, error) {
	return f.build(cfg)
}

// build is the recursive implementation.
func (f *Factory) build(cfg AgentConfig) (adkagent.Agent, error) {
	if cfg.Name == "" {
		return nil, fmt.Errorf("agent name is required")
	}

	// Resolve model: prefer per-agent model, fall back to factory default.
	m := cfg.Model
	if m == nil {
		m = f.defaultModel
	}

	// Recursively build sub-agents.
	subAgents := make([]adkagent.Agent, 0, len(cfg.SubAgents))
	for i, subCfg := range cfg.SubAgents {
		sub, err := f.build(subCfg)
		if err != nil {
			return nil, fmt.Errorf("sub_agent[%d] %q: %w", i, subCfg.Name, err)
		}
		subAgents = append(subAgents, sub)
	}

	// Choose construction strategy based on Mode.
	switch cfg.Mode {
	case ModeSingle, "":
		return f.buildLLMAgent(cfg, m, subAgents)
	case ModeSequential:
		return f.buildSequentialAgent(cfg, subAgents)
	case ModeParallel:
		return f.buildParallelAgent(cfg, subAgents)
	case ModeLoop:
		return f.buildLoopAgent(cfg, subAgents)
	default:
		return nil, fmt.Errorf("unknown agent mode %q for agent %q", cfg.Mode, cfg.Name)
	}
}

// buildLLMAgent creates a single LLMAgent. If subAgents are provided they
// become child agents that the LLM can transfer to.
func (f *Factory) buildLLMAgent(cfg AgentConfig, m model.LLM, subAgents []adkagent.Agent) (adkagent.Agent, error) {
	if m == nil {
		return nil, fmt.Errorf("model is required for LLMAgent %q", cfg.Name)
	}
	a, err := llmagent.New(llmagent.Config{
		Name:                     cfg.Name,
		Description:              cfg.Description,
		Model:                    m,
		Instruction:              cfg.Instruction,
		Tools:                    cfg.Tools,
		Toolsets:                 cfg.Toolsets,
		SubAgents:                subAgents,
		OutputKey:                cfg.OutputKey,
		DisallowTransferToParent: cfg.DisallowTransferToParent,
		DisallowTransferToPeers:  cfg.DisallowTransferToPeers,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create LLMAgent %q: %w", cfg.Name, err)
	}
	return a, nil
}

// buildSequentialAgent wraps sub-agents in a SequentialAgent.
func (f *Factory) buildSequentialAgent(cfg AgentConfig, subAgents []adkagent.Agent) (adkagent.Agent, error) {
	if len(subAgents) == 0 {
		return nil, fmt.Errorf("SequentialAgent %q requires at least one sub_agent", cfg.Name)
	}
	a, err := sequentialagent.New(sequentialagent.Config{
		AgentConfig: adkagent.Config{
			Name:        cfg.Name,
			Description: cfg.Description,
			SubAgents:   subAgents,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create SequentialAgent %q: %w", cfg.Name, err)
	}
	return a, nil
}

// buildParallelAgent wraps sub-agents in a ParallelAgent.
func (f *Factory) buildParallelAgent(cfg AgentConfig, subAgents []adkagent.Agent) (adkagent.Agent, error) {
	if len(subAgents) == 0 {
		return nil, fmt.Errorf("ParallelAgent %q requires at least one sub_agent", cfg.Name)
	}
	a, err := parallelagent.New(parallelagent.Config{
		AgentConfig: adkagent.Config{
			Name:        cfg.Name,
			Description: cfg.Description,
			SubAgents:   subAgents,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create ParallelAgent %q: %w", cfg.Name, err)
	}
	return a, nil
}

// buildLoopAgent wraps sub-agents in a LoopAgent.
func (f *Factory) buildLoopAgent(cfg AgentConfig, subAgents []adkagent.Agent) (adkagent.Agent, error) {
	if len(subAgents) == 0 {
		return nil, fmt.Errorf("LoopAgent %q requires at least one sub_agent", cfg.Name)
	}
	a, err := loopagent.New(loopagent.Config{
		AgentConfig: adkagent.Config{
			Name:        cfg.Name,
			Description: cfg.Description,
			SubAgents:   subAgents,
		},
		MaxIterations: cfg.MaxIterations,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create LoopAgent %q: %w", cfg.Name, err)
	}
	return a, nil
}

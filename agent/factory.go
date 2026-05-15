package agent

import (
	"context"
	"fmt"
	"log"

	"google.golang.org/adk/agent"
	"google.golang.org/adk/agent/llmagent"
	"google.golang.org/adk/agent/workflowagents/loopagent"
	"google.golang.org/adk/agent/workflowagents/parallelagent"
	"google.golang.org/adk/agent/workflowagents/sequentialagent"
	"google.golang.org/adk/model"
	"google.golang.org/adk/tool"
)

// AgentMode 定义Agent树的编排模式
type AgentMode string

const (
	// ModeSingle 单Agent模式（根Agent直接处理）
	ModeSingle AgentMode = "single"
	// ModeSequential 顺序执行模式（子Agent依次执行）
	ModeSequential AgentMode = "sequential"
	// ModeParallel 并行执行模式（子Agent同时执行）
	ModeParallel AgentMode = "parallel"
	// ModeLoop 循环执行模式（子Agent循环执行直到条件满足）
	ModeLoop AgentMode = "loop"
)

// AgentConfig 定义单个Agent的配置
type AgentConfig struct {
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Instruction string     `json:"instruction"`
	Model       model.LLM   `json:"-"` // 不序列化
	Mode        AgentMode  `json:"mode"`
	Tools       []tool.Tool `json:"-"` // 不序列化
	Toolsets    []tool.Toolset `json:"-"` // 不序列化
	OutputKey   string     `json:"output_key,omitempty"` // 用于sequential模式传递中间结果
	SubAgents   []AgentConfig `json:"sub_agents,omitempty"`
	MaxIterations int       `json:"max_iterations,omitempty"` // 用于loop模式
}

// Factory 负责根据配置递归构建 adk-go Agent 树
type Factory struct{}

// NewFactory 创建Agent工厂
func NewFactory() *Factory {
	return &Factory{}
}

// Build 递归构建Agent树，返回 adk-go Agent 接口
func (f *Factory) Build(ctx context.Context, cfg AgentConfig) (agent.Agent, error) {
	switch cfg.Mode {
	case ModeSingle:
		return f.buildSingle(ctx, cfg)
	case ModeSequential:
		return f.buildSequential(ctx, cfg)
	case ModeParallel:
		return f.buildParallel(ctx, cfg)
	case ModeLoop:
		return f.buildLoop(ctx, cfg)
	default:
		return f.buildSingle(ctx, cfg)
	}
}

// buildSingle 构建单个LLM Agent
func (f *Factory) buildSingle(ctx context.Context, cfg AgentConfig) (agent.Agent, error) {
	if cfg.Model == nil {
		return nil, fmt.Errorf("agent %q: model is required for single mode", cfg.Name)
	}

	a, err := llmagent.New(llmagent.Config{
		Name:        cfg.Name,
		Model:       cfg.Model,
		Description: cfg.Description,
		Instruction: cfg.Instruction,
		Tools:       cfg.Tools,
		Toolsets:    cfg.Toolsets,
		OutputKey:   cfg.OutputKey,
	})
	if err != nil {
		return nil, fmt.Errorf("create llmagent %q: %w", cfg.Name, err)
	}

	log.Printf("[factory] built single agent: %s", cfg.Name)
	return a, nil
}

// buildSequential 构建顺序执行Agent
func (f *Factory) buildSequential(ctx context.Context, cfg AgentConfig) (agent.Agent, error) {
	subAgents, err := f.buildSubAgents(ctx, cfg.SubAgents)
	if err != nil {
		return nil, err
	}

	if len(subAgents) == 0 {
		return nil, fmt.Errorf("agent %q: sequential mode requires at least one sub_agent", cfg.Name)
	}

	a, err := sequentialagent.New(sequentialagent.Config{
		AgentConfig: agent.Config{
			Name:        cfg.Name,
			Description: cfg.Description,
			SubAgents:   subAgents,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("create sequentialagent %q: %w", cfg.Name, err)
	}

	log.Printf("[factory] built sequential agent: %s with %d sub-agents", cfg.Name, len(subAgents))
	return a, nil
}

// buildParallel 构建并行执行Agent
func (f *Factory) buildParallel(ctx context.Context, cfg AgentConfig) (agent.Agent, error) {
	subAgents, err := f.buildSubAgents(ctx, cfg.SubAgents)
	if err != nil {
		return nil, err
	}

	if len(subAgents) == 0 {
		return nil, fmt.Errorf("agent %q: parallel mode requires at least one sub_agent", cfg.Name)
	}

	a, err := parallelagent.New(parallelagent.Config{
		AgentConfig: agent.Config{
			Name:        cfg.Name,
			Description: cfg.Description,
			SubAgents:   subAgents,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("create parallelagent %q: %w", cfg.Name, err)
	}

	log.Printf("[factory] built parallel agent: %s with %d sub-agents", cfg.Name, len(subAgents))
	return a, nil
}

// buildLoop 构建循环执行Agent
func (f *Factory) buildLoop(ctx context.Context, cfg AgentConfig) (agent.Agent, error) {
	subAgents, err := f.buildSubAgents(ctx, cfg.SubAgents)
	if err != nil {
		return nil, err
	}

	if len(subAgents) == 0 {
		return nil, fmt.Errorf("agent %q: loop mode requires at least one sub_agent", cfg.Name)
	}

	maxIter := uint(cfg.MaxIterations)
	if maxIter <= 0 {
		maxIter = 3 // 默认最多循环3次
	}

	a, err := loopagent.New(loopagent.Config{
		MaxIterations: maxIter,
		AgentConfig: agent.Config{
			Name:        cfg.Name,
			Description: cfg.Description,
			SubAgents:   subAgents,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("create loopagent %q: %w", cfg.Name, err)
	}

	log.Printf("[factory] built loop agent: %s with %d sub-agents, max_iterations=%d", cfg.Name, len(subAgents), maxIter)
	return a, nil
}

// buildSubAgents 递归构建子Agent列表
func (f *Factory) buildSubAgents(ctx context.Context, configs []AgentConfig) ([]agent.Agent, error) {
	var agents []agent.Agent
	for _, subCfg := range configs {
		a, err := f.Build(ctx, subCfg)
		if err != nil {
			return nil, fmt.Errorf("sub-agent %q: %w", subCfg.Name, err)
		}
		agents = append(agents, a)
	}
	return agents, nil
}
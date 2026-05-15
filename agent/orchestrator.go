package agent

import (
	"context"
	"fmt"
	"log"
	"sync"

	"google.golang.org/adk/agent"
	"google.golang.org/adk/runner"
	"google.golang.org/adk/session"
	"google.golang.org/genai"
)

// OrchestratorConfig 编排器配置
type OrchestratorConfig struct {
	AppName   string      `json:"app_name"`
	AgentTree AgentConfig `json:"agent_tree"`
}

// OrchestratorStatus 编排器状态
type OrchestratorStatus struct {
	Ready       bool   `json:"ready"`
	AppName     string `json:"app_name"`
	AgentName   string `json:"agent_name"`
	SessionCount int   `json:"session_count"`
}

// Orchestrator 集群模式编排器 — 管理 Agent 执行、Session、Tool 注册
type Orchestrator struct {
	cfg     OrchestratorConfig
	factory *Factory

	mu        sync.RWMutex
	rootAgent agent.Agent      // 缓存的 Agent 树
	sessSvc   session.Service  // 缓存的 Session Service
	runner    *runner.Runner   // 缓存的 Runner
	sessCount int              // session 计数
}

// NewOrchestrator 创建编排器
func NewOrchestrator(cfg OrchestratorConfig) (*Orchestrator, error) {
	o := &Orchestrator{
		cfg:     cfg,
		factory: NewFactory(),
	}
	// 初始化 Session Service（全局共享，支持多轮对话）
	o.sessSvc = session.InMemoryService()
	return o, nil
}

// Initialize 构建 Agent 树和 Runner（启动时调用一次）
func (o *Orchestrator) Initialize(ctx context.Context) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.rebuildLocked(ctx)
}

// InitializeWithAgent 用已设置的 rootAgent 创建 Runner（跳过 Factory.Build）
func (o *Orchestrator) InitializeWithAgent(ctx context.Context) error {
	o.mu.Lock()
	defer o.mu.Unlock()

	if o.rootAgent == nil {
		return fmt.Errorf("rootAgent not set — call SetRootAgent() first")
	}

	// 直接用 rootAgent 创建 Runner，不调用 rebuildLocked
	r, err := runner.New(runner.Config{
		AppName:           o.cfg.AppName,
		Agent:             o.rootAgent,
		SessionService:    o.sessSvc,
		AutoCreateSession: true,
	})
	if err != nil {
		return fmt.Errorf("create runner: %w", err)
	}
	o.runner = r

	log.Printf("[orchestrator] initialized with agent: app=%s, agent=%s", o.cfg.AppName, o.rootAgent.Name())
	return nil
}

// rebuildLocked 重建 Agent 树和 Runner（调用者需持有锁）
func (o *Orchestrator) rebuildLocked(ctx context.Context) error {
	// 1. 构建 Agent 树
	rootAgent, err := o.factory.Build(ctx, o.cfg.AgentTree)
	if err != nil {
		return fmt.Errorf("build agent tree: %w", err)
	}
	o.rootAgent = rootAgent

	// 2. 创建 Runner
	r, err := runner.New(runner.Config{
		AppName:           o.cfg.AppName,
		Agent:             rootAgent,
		SessionService:    o.sessSvc,
		AutoCreateSession: true,
	})
	if err != nil {
		return fmt.Errorf("create runner: %w", err)
	}
	o.runner = r

	log.Printf("[orchestrator] initialized: app=%s, agent=%s", o.cfg.AppName, rootAgent.Name())
	return nil
}

// Run 执行集群模式查询，通过 channel 流式返回事件
func (o *Orchestrator) Run(ctx context.Context, userID, sessionID, message string) (<-chan Event, error) {
	o.mu.RLock()
	r := o.runner
	o.mu.RUnlock()

	if r == nil {
		return nil, fmt.Errorf("orchestrator not initialized — call Initialize() first")
	}

	// 构建用户消息
	msg := genai.NewContentFromText(message, genai.RoleUser)

	// 启动流式执行
	eventCh := make(chan Event, 64)

	go func() {
		defer close(eventCh)

		// runner.Run() 返回 iter.Seq2[*session.Event, error]
		for evt, err := range r.Run(ctx, userID, sessionID, msg, agent.RunConfig{StreamingMode: agent.StreamingModeSSE}) {
			if err != nil {
				eventCh <- NewErrorEvent(fmt.Sprintf("agent error: %v", err))
				return
			}

			if evt == nil {
				continue
			}

			// 将 adk-go 的 session.Event 转换为我们的 Event
			agentEvts := convertEvent(evt)
			for _, ae := range agentEvts {
				if ae.Type != "" {
					eventCh <- ae
				}
			}
		}

		eventCh <- NewDoneEvent()
	}()

	o.mu.Lock()
	o.sessCount++
	o.mu.Unlock()

	return eventCh, nil
}

// convertEvent 将 adk-go 的 session.Event 转换为我们的 Event 列表
// session.Event 内嵌了 model.LLMResponse，所以 Content/Partial 等字段直接在 Event 上访问
func convertEvent(evt *session.Event) []Event {
	if evt == nil {
		return nil
	}

	var events []Event

	// 1. Agent Transfer 事件
	if evt.Actions.TransferToAgent != "" {
		events = append(events, Event{
			Type: EventTypeAgentSwitch,
			Data: map[string]string{
				"from":   evt.Author,
				"to":     evt.Actions.TransferToAgent,
				"reason": "transfer",
			},
		})
	}

	// 2. Escalate 事件（LoopAgent 终止）
	if evt.Actions.Escalate {
		events = append(events, Event{
			Type: EventTypeAgentSwitch,
			Data: map[string]string{
				"from":   evt.Author,
				"to":     "parent",
				"reason": "escalate",
			},
		})
	}

	// 3. 从 Content.Parts 提取内容（session.Event 内嵌 model.LLMResponse）
	if evt.Content != nil {
		for _, part := range evt.Content.Parts {
			if part == nil {
				continue
			}

			// 文本内容
			if part.Text != "" {
				evtType := EventTypeText
				if part.Thought {
					evtType = EventTypeThinking
				}
				events = append(events, Event{
					Type: evtType,
					Data: map[string]interface{}{
						"content": part.Text,
						"partial": evt.Partial,
						"agent":   evt.Author,
					},
				})
			}

			// Function Call
			if part.FunctionCall != nil {
				events = append(events, Event{
					Type: EventTypeToolCall,
					Data: map[string]interface{}{
						"tool":  part.FunctionCall.Name,
						"args":  part.FunctionCall.Args,
						"agent": evt.Author,
					},
				})
			}

			// Function Response
			if part.FunctionResponse != nil {
				events = append(events, Event{
					Type: EventTypeToolResult,
					Data: map[string]interface{}{
						"tool":   part.FunctionResponse.Name,
						"result": part.FunctionResponse.Response,
						"agent":  evt.Author,
					},
				})
			}
		}
	}

	return events
}

// Rebuild 热重建 Agent 树（配置变更后调用）
func (o *Orchestrator) Rebuild(ctx context.Context, newCfg AgentConfig) error {
	o.mu.Lock()
	defer o.mu.Unlock()

	o.cfg.AgentTree = newCfg
	return o.rebuildLocked(ctx)
}

// RebuildWithModel 用新 Model 重建 Agent 树
func (o *Orchestrator) RebuildWithModel(ctx context.Context, newCfg AgentConfig, model interface{}) error {
	o.mu.Lock()
	defer o.mu.Unlock()

	o.cfg.AgentTree = newCfg
	// model 已在 newCfg 中设置
	return o.rebuildLocked(ctx)
}

// Status 返回编排器状态
func (o *Orchestrator) Status() OrchestratorStatus {
	o.mu.RLock()
	defer o.mu.RUnlock()

	status := OrchestratorStatus{
		Ready:        o.runner != nil,
		AppName:      o.cfg.AppName,
		SessionCount: o.sessCount,
	}
	if o.rootAgent != nil {
		status.AgentName = o.rootAgent.Name()
	}
	return status
}

// GetConfig 返回当前配置
func (o *Orchestrator) GetConfig() OrchestratorConfig {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.cfg
}

// SetRootAgent 直接设置预构建的 Agent 树（跳过 Factory.Build）
func (o *Orchestrator) SetRootAgent(a agent.Agent) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.rootAgent = a
}

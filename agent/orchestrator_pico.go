package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	picoclawagent "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/agent"
	picoclawbus "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/bus"
	picoclawcfg "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/config"
	picoclawproviders "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/providers"
	runtimeevents "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/events"
)

// OrchestratorConfig 编排器配置
type OrchestratorConfig struct {
	AppName string `json:"app_name"`
}

// OrchestratorStatus 编排器状态
type OrchestratorStatus struct {
	Ready        bool     `json:"ready"`
	AppName      string   `json:"app_name"`
	AgentIDs     []string `json:"agent_ids"`
	SessionCount int      `json:"session_count"`
}

// Orchestrator 集群模式编排器 — 基于 PicoClaw AgentLoop
// 替换旧的 adk-go Runner，用 AgentRegistry + SubTurn 实现多智能体调度
type Orchestrator struct {
	cfg      OrchestratorConfig
	loop     *picoclawagent.AgentLoop
	provider picoclawproviders.LLMProvider
	picoCfg  *picoclawcfg.Config

	// HITL 人在环路管理器
	hitlMgr *HITLManager

	// PicoClaw 事件总线（用于 HITL 等自定义事件推送）
	eventBus runtimeevents.Bus

	mu        sync.RWMutex
	sessCount int
}

// NewOrchestrator 创建编排器
func NewOrchestrator(cfg OrchestratorConfig) (*Orchestrator, error) {
	return &Orchestrator{
		cfg: cfg,
	}, nil
}

// InitializeWithProvider 用 LLM provider 初始化 PicoClaw AgentLoop
// 并注册 HITL 等工具（DataToolbox 系统工具通过 MCP 协议注册）
func (o *Orchestrator) InitializeWithProvider(ctx context.Context, provider picoclawproviders.LLMProvider, picoCfg *picoclawcfg.Config) error {
	o.mu.Lock()
	defer o.mu.Unlock()

	msgBus := picoclawbus.NewMessageBus()
	loop := picoclawagent.NewAgentLoop(picoCfg, msgBus, provider)

	o.loop = loop
	o.provider = provider
	o.picoCfg = picoCfg

	// 注册 HITL 等工具到所有 agent（DataToolbox 系统工具通过 MCP 注册）
	o.registerDataToolboxTools()

	agentIDs := loop.GetRegistry().ListAgentIDs()
	log.Printf("[orchestrator] initialized with PicoClaw: agents=%v", agentIDs)
	return nil
}

// SetHITLManager 设置 HITL 管理器和事件总线（在 InitializeWithProvider 之前调用）
func (o *Orchestrator) SetHITLManager(mgr *HITLManager, eventBus runtimeevents.Bus) {
	o.hitlMgr = mgr
	o.eventBus = eventBus
}

// registerDataToolboxTools 将 AskUserTool 注册到所有 agent 的 ToolRegistry
// DataToolbox 系统工具通过 MCP 协议注册，不再使用 DataToolboxAPITool
func (o *Orchestrator) registerDataToolboxTools() {
	if o.loop == nil {
		return
	}

	registry := o.loop.GetRegistry()
	for _, agentID := range registry.ListAgentIDs() {
		agent, ok := registry.GetAgent(agentID)
		if !ok {
			continue
		}

		// 注册 AskUserTool（如果 HITLManager 已设置）
		if o.hitlMgr != nil {
			askUserTool := NewAskUserTool(o.hitlMgr, o.pushHITLEvent, func() { SetHITLConfirmed("default") })
			agent.Tools.Register(askUserTool)
			log.Printf("[orchestrator] registered ask_user tool for agent=%s", agentID)
		}
	}
}

// pushHITLEvent 创建 HITL 事件推送回调
// 通过 PicoClaw EventBus 发布自定义事件，由 Run() 中的 runtimeEvtCh 订阅接收
func (o *Orchestrator) pushHITLEvent(evt Event) {
	if o.eventBus != nil {
		runtimeEvt := runtimeevents.Event{
			Kind:    runtimeevents.Kind("agent.hitl_interaction"),
			Payload: evt.Data,
			Source:  runtimeevents.Source{Component: "datatoolbox", Name: "ask_user"},
		}
		result := o.eventBus.PublishNonBlocking(runtimeEvt)
		log.Printf("[orchestrator] HITL event published to EventBus: type=%s, matched=%d, delivered=%d, dropped=%d, blocked=%d",
			evt.Type, result.Matched, result.Delivered, result.Dropped, result.Blocked)
	} else {
		log.Printf("[orchestrator] HITL event skipped (no EventBus): type=%s", evt.Type)
	}
}

// Run 执行集群模式查询，通过 channel 流式返回事件
// 订阅 PicoClaw RuntimeEvents 实时推送工具调用、思考过程、子代理调度等
func (o *Orchestrator) Run(ctx context.Context, userID, sessionID, message string) (<-chan Event, error) {
	o.mu.RLock()
	loop := o.loop
	o.mu.RUnlock()

	if loop == nil {
		return nil, fmt.Errorf("orchestrator not initialized")
	}

	eventCh := make(chan Event, 64)

	go func() {
		defer close(eventCh)

		// 订阅 PicoClaw RuntimeEvents — 只关注 agent 相关事件
		runtimeCh := loop.RuntimeEvents()
		var sub runtimeevents.Subscription
		var runtimeEvtCh <-chan runtimeevents.Event

		if runtimeCh != nil {
			// 过滤出 agent 事件（LLM delta、工具调用、子代理调度等）
			agentCh := runtimeCh.KindPrefix("agent.")
			var err error
			sub, runtimeEvtCh, err = agentCh.SubscribeChan(ctx, runtimeevents.SubscribeOptions{
				Name:   "datatoolbox-sse-" + sessionID,
				Buffer: 64,
			})
			if err != nil {
				log.Printf("[orchestrator] subscribe runtime events failed: %v", err)
			} else {
				defer sub.Close()
			}
		}

		// 启动 PicoClaw 处理（在另一个 goroutine 中）
		type result struct {
			response string
			err      error
		}
		resultCh := make(chan result, 1)
		go func() {
			resp, err := loop.ProcessDirectWithChannel(ctx, message, sessionID, "datatoolbox", sessionID)
			resultCh <- result{response: resp, err: err}
		}()

		// 实时转发 PicoClaw 运行时事件到 SSE
		done := false
		for !done {
			select {
			case evt, ok := <-runtimeEvtCh:
				if !ok {
					runtimeEvtCh = nil
					continue
				}
				translateRuntimeEvent(evt, eventCh)

			case res := <-resultCh:
				if res.err != nil {
					eventCh <- NewErrorEvent(fmt.Sprintf("agent error: %v", res.err))
				} else if res.response != "" {
					// 最终文本（如果 runtime events 没有覆盖到最终文本）
					eventCh <- Event{
						Type: EventTypeText,
						Data: map[string]interface{}{
							"content": res.response,
							"agent":   "orchestrator",
						},
					}
				}
				done = true

			case <-ctx.Done():
				eventCh <- NewErrorEvent("请求超时")
				done = true
			}
		}

		eventCh <- NewDoneEvent()
	}()

	o.mu.Lock()
	o.sessCount++
	o.mu.Unlock()

	return eventCh, nil
}

// translateRuntimeEvent 将 PicoClaw RuntimeEvent 翻译为 DataToolbox SSE Event
func translateRuntimeEvent(evt runtimeevents.Event, out chan<- Event) {
	kind := evt.Kind
	payload := evt.Payload

	switch kind {
	case runtimeevents.KindAgentLLMDelta:
		// LLM 流式文本增量
		if p, ok := payload.(picoclawagent.LLMDeltaPayload); ok {
			if p.ReasoningDeltaLen > 0 {
				out <- Event{Type: EventTypeThinking, Data: map[string]interface{}{
					"content": fmt.Sprintf("推理中... (+%d tokens)", p.ReasoningDeltaLen),
					"agent":   evt.Source.Name,
				}}
			}
			if p.ContentDeltaLen > 0 {
				out <- Event{Type: EventTypeThinking, Data: map[string]interface{}{
					"content": fmt.Sprintf("生成中... (+%d tokens)", p.ContentDeltaLen),
					"agent":   evt.Source.Name,
				}}
			}
		}

	case runtimeevents.KindAgentLLMRequest:
		// LLM 请求开始
		if p, ok := payload.(picoclawagent.LLMRequestPayload); ok {
			out <- Event{Type: EventTypeThinking, Data: map[string]interface{}{
				"content": fmt.Sprintf("正在调用 %s 生成回复...", p.Model),
				"agent":   evt.Source.Name,
			}}
		}

	case runtimeevents.KindAgentToolExecStart:
		// 工具调用开始 — 转发为 tool_call
		if p, ok := payload.(picoclawagent.ToolExecStartPayload); ok {
			argsJSON, _ := json.Marshal(p.Arguments)
			contentStr := string(argsJSON)
			// 无参数工具: json.Marshal(nil) → "null"，前端显示为"空调用"，改为空对象
			if contentStr == "null" {
				contentStr = "{}"
			}
			out <- Event{Type: EventTypeToolCall, Data: map[string]interface{}{
				"tool":    p.Tool,
				"content": contentStr,
				"agent":   evt.Source.Name,
			}}
		}

	case runtimeevents.KindAgentToolExecEnd:
		// 工具调用结束 — 转发为 tool_result
		if p, ok := payload.(picoclawagent.ToolExecEndPayload); ok {
			status := "✅ 完成"
			if p.IsError {
				status = "❌ 失败"
			}
			out <- Event{Type: EventTypeToolResult, Data: map[string]interface{}{
				"tool":    p.Tool,
				"content": fmt.Sprintf("%s (耗时 %v, 结果 %d 字符)", status, p.Duration.Round(time.Millisecond), p.ForLLMLen),
				"agent":   evt.Source.Name,
			}}
		}

	case runtimeevents.KindAgentSubTurnSpawn:
		// 子代理调度 — 转发为 agent_switch
		if p, ok := payload.(picoclawagent.SubTurnSpawnPayload); ok {
			out <- Event{Type: EventTypeAgentSwitch, Data: map[string]interface{}{
				"from":    evt.Source.Name,
				"to":      p.AgentID,
				"content": fmt.Sprintf("调度子智能体: %s", p.Label),
			}}
		}

	case runtimeevents.KindAgentSubTurnEnd:
		// 子代理完成
		if p, ok := payload.(picoclawagent.SubTurnEndPayload); ok {
			out <- Event{Type: EventTypeAgentSwitch, Data: map[string]interface{}{
				"from":    p.AgentID,
				"to":      evt.Source.Name,
				"content": fmt.Sprintf("子智能体 %s 完成 (%s)", p.AgentID, p.Status),
			}}
		}

	case runtimeevents.KindAgentTurnStart:
		out <- Event{Type: EventTypeThinking, Data: map[string]interface{}{
			"content": "智能体开始处理任务...",
			"agent":   evt.Source.Name,
		}}

	case runtimeevents.KindAgentTurnEnd:
		// Turn 结束：将 AI 的最终正文输出作为 text 事件发送
		if p, ok := payload.(picoclawagent.TurnEndPayload); ok {
			if p.FinalContent != "" {
				out <- Event{Type: EventTypeText, Data: map[string]interface{}{
					"content": p.FinalContent,
					"agent":   evt.Source.Name,
					"partial": false,
				}}
			}
		}

	case runtimeevents.KindAgentLLMRetry:
		// LLM 请求重试（429 限速、网络错误、超时等）
		if p, ok := payload.(picoclawagent.LLMRetryPayload); ok {
			reasonMap := map[string]string{
				"rate_limit":        "速率限制",
				"timeout":           "请求超时",
				"network":           "网络错误",
				"context_limit":     "上下文溢出",
				"vision_unsupported": "视觉不支持",
			}
			reasonText := reasonMap[p.Reason]
			if reasonText == "" {
				reasonText = p.Reason
			}
			out <- Event{Type: EventTypeThinking, Data: map[string]interface{}{
				"content": fmt.Sprintf("⚠️ %s，第 %d/%d 次重试，等待 %v...", reasonText, p.Attempt, p.MaxRetries, p.Backoff.Round(time.Second)),
				"agent":   evt.Source.Name,
			}}
		}

	case runtimeevents.KindAgentError:
		if p, ok := payload.(picoclawagent.ErrorPayload); ok {
			out <- Event{Type: EventTypeError, Data: map[string]interface{}{
				"message": fmt.Sprintf("[%s] %s", p.Stage, p.Message),
			}}
		}

	case runtimeevents.Kind("agent.hitl_interaction"):
		// HITL 人在环路交互事件 — 转发为 hitl_interaction SSE 事件
		out <- Event{Type: EventTypeHITL, Data: payload}
	}
}

// Status 返回编排器状态
func (o *Orchestrator) Status() OrchestratorStatus {
	o.mu.RLock()
	defer o.mu.RUnlock()

	status := OrchestratorStatus{
		Ready:        o.loop != nil,
		AppName:      o.cfg.AppName,
		SessionCount: o.sessCount,
	}

	if o.loop != nil {
		status.AgentIDs = o.loop.GetRegistry().ListAgentIDs()
	}

	return status
}

// GetLoop 返回 PicoClaw AgentLoop
func (o *Orchestrator) GetLoop() *picoclawagent.AgentLoop {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.loop
}

// GetConfig 返回当前配置
func (o *Orchestrator) GetConfig() OrchestratorConfig {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.cfg
}

// RebuildWithProvider 用新 provider 重建 AgentLoop
func (o *Orchestrator) RebuildWithProvider(ctx context.Context, provider picoclawproviders.LLMProvider, picoCfg *picoclawcfg.Config) error {
	return o.InitializeWithProvider(ctx, provider, picoCfg)
}

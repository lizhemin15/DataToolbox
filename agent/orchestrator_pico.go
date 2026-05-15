package agent

import (
	"context"
	"fmt"
	"log"
	"sync"

	picoclaw "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/agent"
	picoclawbus "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/bus"
	picoclawcfg "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/config"
	picoclawproviders "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/providers"
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
	loop     *picoclaw.AgentLoop
	provider picoclawproviders.LLMProvider
	picoCfg  *picoclawcfg.Config

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
func (o *Orchestrator) InitializeWithProvider(ctx context.Context, provider picoclawproviders.LLMProvider, picoCfg *picoclawcfg.Config) error {
	o.mu.Lock()
	defer o.mu.Unlock()

	msgBus := picoclawbus.NewMessageBus()
	loop := picoclaw.NewAgentLoop(picoCfg, msgBus, provider)

	o.loop = loop
	o.provider = provider
	o.picoCfg = picoCfg

	agentIDs := loop.GetRegistry().ListAgentIDs()
	log.Printf("[orchestrator] initialized with PicoClaw: agents=%v", agentIDs)
	return nil
}

// Run 执行集群模式查询，通过 channel 流式返回事件
// 保持与旧 Orchestrator 相同的接口，方便 server.go 无缝切换
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

		// 使用 PicoClaw 的 ProcessDirectWithChannel
		response, err := loop.ProcessDirectWithChannel(ctx, message, sessionID, "datatoolbox", sessionID)
		if err != nil {
			eventCh <- NewErrorEvent(fmt.Sprintf("agent error: %v", err))
			return
		}

		// 发送最终文本响应
		if response != "" {
			eventCh <- Event{
				Type: EventTypeText,
				Data: map[string]interface{}{
					"content": response,
					"agent":   "orchestrator",
				},
			}
		}

		eventCh <- NewDoneEvent()
	}()

	o.mu.Lock()
	o.sessCount++
	o.mu.Unlock()

	return eventCh, nil
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

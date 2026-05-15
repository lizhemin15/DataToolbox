package agent

import (
	"context"
	"fmt"
	"log"
	"sync"

	adkagent "google.golang.org/adk/agent"
	"google.golang.org/adk/runner"
	"google.golang.org/adk/session"
	"google.golang.org/adk/tool"
	"google.golang.org/genai"
)

// Orchestrator manages agent lifecycle, sessions, and execution.
type Orchestrator struct {
	mu           sync.RWMutex
	factory      *Factory
	sessionSvc   session.Service
	rootAgent    adkagent.Agent
	agentTree    AgentConfig
	toolRegistry map[string]tool.Tool
	toolsetReg   map[string]tool.Toolset
	runner       *runner.Runner
	appName      string
}

// OrchestratorConfig holds the configuration for creating an Orchestrator.
type OrchestratorConfig struct {
	AppName       string          `json:"app_name"`
	AgentTree     AgentConfig     `json:"agent_tree"`
	SessionService session.Service `json:"-"`
}

// NewOrchestrator creates a new Orchestrator from the given config.
func NewOrchestrator(cfg OrchestratorConfig) (*Orchestrator, error) {
	if cfg.AppName == "" {
		cfg.AppName = "datatoolbox"
	}

	factory := NewFactory(nil)

	svc := cfg.SessionService
	if svc == nil {
		svc = session.InMemoryService()
	}

	o := &Orchestrator{
		factory:      factory,
		sessionSvc:   svc,
		agentTree:    cfg.AgentTree,
		toolRegistry: make(map[string]tool.Tool),
		toolsetReg:   make(map[string]tool.Toolset),
		appName:      cfg.AppName,
	}

	if cfg.AgentTree.Name != "" {
		root, err := factory.Build(cfg.AgentTree)
		if err != nil {
			return nil, fmt.Errorf("build agent tree: %w", err)
		}
		o.rootAgent = root

		r, err := runner.New(runner.Config{
			AppName:        cfg.AppName,
			Agent:          root,
			SessionService: svc,
		})
		if err != nil {
			return nil, fmt.Errorf("create runner: %w", err)
		}
		o.runner = r
	}

	return o, nil
}

// RegisterTool adds a tool to the registry.
func (o *Orchestrator) RegisterTool(t tool.Tool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.toolRegistry[t.Name()] = t
}

// RegisterToolset adds a toolset to the registry.
func (o *Orchestrator) RegisterToolset(ts tool.Toolset) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.toolsetReg[ts.Name()] = ts
}

// UnregisterTool removes a tool by name.
func (o *Orchestrator) UnregisterTool(name string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	delete(o.toolRegistry, name)
}

// UnregisterToolset removes a toolset by name.
func (o *Orchestrator) UnregisterToolset(name string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	delete(o.toolsetReg, name)
}

// ListTools returns all registered tool names.
func (o *Orchestrator) ListTools() []string {
	o.mu.RLock()
	defer o.mu.RUnlock()
	names := make([]string, 0, len(o.toolRegistry))
	for n := range o.toolRegistry {
		names = append(names, n)
	}
	return names
}

// ListToolsets returns all registered toolset names.
func (o *Orchestrator) ListToolsets() []string {
	o.mu.RLock()
	defer o.mu.RUnlock()
	names := make([]string, 0, len(o.toolsetReg))
	for n := range o.toolsetReg {
		names = append(names, n)
	}
	return names
}

// Run executes the agent tree for a given user message and streams events.
func (o *Orchestrator) Run(ctx context.Context, userID, sessionID, message string) (<-chan Event, error) {
	o.mu.RLock()
	r := o.runner
	o.mu.RUnlock()

	if r == nil {
		return nil, fmt.Errorf("orchestrator not initialized: no agent tree")
	}

	eventCh := make(chan Event, 64)

	go func() {
		defer close(eventCh)

		msg := genai.NewContentFromText(message, genai.RoleUser)

		for evt, err := range r.Run(ctx, userID, sessionID, msg, adkagent.RunConfig{}) {
			if err != nil {
				eventCh <- NewErrorEvent(fmt.Sprintf("agent execution error: %v", err), "RUNTIME")
				eventCh <- NewDoneEvent(false)
				return
			}
			if converted := o.convertEvent(evt); converted != nil {
				eventCh <- *converted
			}
		}

		eventCh <- NewDoneEvent(true)
	}()

	return eventCh, nil
}

// convertEvent translates an adk-go session.Event into our streaming Event.
func (o *Orchestrator) convertEvent(evt *session.Event) *Event {
	if evt == nil || evt.Content == nil {
		return nil
	}

	for _, part := range evt.Content.Parts {
		if part.Text != "" {
			e := NewTextEvent(evt.Author, part.Text, evt.Partial)
			return &e
		}
		if part.FunctionCall != nil {
			e := NewToolCallEvent(
				evt.Author,
				part.FunctionCall.Name,
				part.FunctionCall.ID,
				part.FunctionCall.Args,
			)
			return &e
		}
		if part.FunctionResponse != nil {
			e := NewToolResultEvent(
				evt.Author,
				part.FunctionResponse.Name,
				part.FunctionResponse.ID,
				part.FunctionResponse.Response,
				false,
			)
			return &e
		}
	}

	return nil
}

// Rebuild reconstructs the agent tree after tool registration changes.
func (o *Orchestrator) Rebuild() error {
	o.mu.Lock()
	defer o.mu.Unlock()

	cfg := o.agentTree
	cfg.Tools = make([]tool.Tool, 0, len(o.toolRegistry))
	for _, t := range o.toolRegistry {
		cfg.Tools = append(cfg.Tools, t)
	}
	cfg.Toolsets = make([]tool.Toolset, 0, len(o.toolsetReg))
	for _, ts := range o.toolsetReg {
		cfg.Toolsets = append(cfg.Toolsets, ts)
	}

	root, err := o.factory.Build(cfg)
	if err != nil {
		return fmt.Errorf("rebuild agent tree: %w", err)
	}
	o.rootAgent = root

	r, err := runner.New(runner.Config{
		AppName:        o.appName,
		Agent:          root,
		SessionService: o.sessionSvc,
	})
	if err != nil {
		return fmt.Errorf("rebuild runner: %w", err)
	}
	o.runner = r

	logf("agent tree rebuilt with %d tools, %d toolsets", len(cfg.Tools), len(cfg.Toolsets))
	return nil
}

// RootAgent returns the root agent of the tree.
func (o *Orchestrator) RootAgent() adkagent.Agent {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.rootAgent
}

// AgentTree returns a copy of the current agent tree config.
func (o *Orchestrator) AgentTree() AgentConfig {
	o.mu.RLock()
	defer o.mu.RUnlock()
	return o.agentTree
}

// AppName returns the application name.
func (o *Orchestrator) AppName() string { return o.appName }

func logf(format string, args ...interface{}) {
	log.Printf("[agent-orchestrator] "+format, args...)
}

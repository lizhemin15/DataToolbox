package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// MCP Server configuration and lifecycle management
// ---------------------------------------------------------------------------

// MCPTransportType defines how the MCP server communicates.
type MCPTransportType string

const (
	MCPTransportStdio         MCPTransportType = "stdio"
	MCPTransportSSE           MCPTransportType = "sse"
	MCPTransportStreamableHTTP MCPTransportType = "streamable_http"
)

// MCPServerStatus is the runtime status of an MCP server process.
type MCPServerStatus string

const (
	MCPStatusStopped  MCPServerStatus = "stopped"
	MCPStatusStarting MCPServerStatus = "starting"
	MCPStatusRunning  MCPServerStatus = "running"
	MCPStatusError    MCPServerStatus = "error"
)

// MCPServerConfig describes a single MCP server connection.
type MCPServerConfig struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Description string           `json:"description,omitempty"`
	Transport   MCPTransportType `json:"transport"`
	// Stdio fields
	Command string   `json:"command,omitempty"`
	Args    []string `json:"args,omitempty"`
	Env     []string `json:"env,omitempty"`
	// HTTP fields
	URL     string            `json:"url,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
	// Lifecycle
	Enabled  bool             `json:"enabled"`
	AutoStart bool            `json:"auto_start"`
	Status   MCPServerStatus  `json:"status"`
	PID      int             `json:"pid,omitempty"`
	// Metadata
	LastStartedAt string `json:"last_started_at,omitempty"`
	LastError    string `json:"last_error,omitempty"`
	ToolsCache   string `json:"tools_cache,omitempty"` // JSON-serialized tool list
}

// MCPSupervisor manages MCP server process lifecycles.
type MCPSupervisor struct {
	mu      sync.RWMutex
	servers map[string]*mcpProcess
	configs map[string]MCPServerConfig
}

type mcpProcess struct {
	cmd    *exec.Cmd
	cancel context.CancelFunc
	done   chan struct{}
}

// NewMCPSupervisor creates a new supervisor.
func NewMCPSupervisor() *MCPSupervisor {
	return &MCPSupervisor{
		servers: make(map[string]*mcpProcess),
		configs: make(map[string]MCPServerConfig),
	}
}

// LoadConfig loads MCP server configs from a JSON file.
func (s *MCPSupervisor) LoadConfig(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // no config file = no MCP servers
		}
		return fmt.Errorf("read mcp config: %w", err)
	}

	var configs []MCPServerConfig
	if err := json.Unmarshal(data, &configs); err != nil {
		return fmt.Errorf("parse mcp config: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for _, cfg := range configs {
		s.configs[cfg.ID] = cfg
	}
	return nil
}

// SaveConfig saves MCP server configs to a JSON file.
func (s *MCPSupervisor) SaveConfig(path string) error {
	s.mu.RLock()
	configs := make([]MCPServerConfig, 0, len(s.configs))
	for _, cfg := range s.configs {
		configs = append(configs, cfg)
	}
	s.mu.RUnlock()

	data, err := json.MarshalIndent(configs, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal mcp config: %w", err)
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// AddConfig adds or updates an MCP server config.
func (s *MCPSupervisor) AddConfig(cfg MCPServerConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.configs[cfg.ID] = cfg
}

// RemoveConfig removes an MCP server config (stops process first).
func (s *MCPSupervisor) RemoveConfig(id string) error {
	if err := s.Stop(id); err != nil {
		// Log but don't fail — process might not be running.
		_ = err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.configs, id)
	return nil
}

// ListConfigs returns all MCP server configs.
func (s *MCPSupervisor) ListConfigs() []MCPServerConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]MCPServerConfig, 0, len(s.configs))
	for _, cfg := range s.configs {
		out = append(out, cfg)
	}
	return out
}

// GetConfig returns a single MCP server config.
func (s *MCPSupervisor) GetConfig(id string) (MCPServerConfig, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cfg, ok := s.configs[id]
	return cfg, ok
}

// Start launches an MCP server process (stdio transport only for now).
func (s *MCPSupervisor) Start(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	cfg, ok := s.configs[id]
	if !ok {
		return fmt.Errorf("mcp server %q not found", id)
	}
	if !cfg.Enabled {
		return fmt.Errorf("mcp server %q is disabled", id)
	}
	if cfg.Transport != MCPTransportStdio {
		return fmt.Errorf("only stdio transport is supported for process management; use URL for %s", cfg.Transport)
	}

	// Already running?
	if proc, exists := s.servers[id]; exists && proc.cmd.Process != nil {
		return nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, cfg.Command, cfg.Args...)
	setSysProcAttr(cmd) // platform-specific process group setup

	// Set environment.
	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env, cfg.Env...)

	if err := cmd.Start(); err != nil {
		cancel()
		cfg.Status = MCPStatusError
		cfg.LastError = err.Error()
		s.configs[id] = cfg
		return fmt.Errorf("start mcp server %q: %w", id, err)
	}

	s.servers[id] = &mcpProcess{
		cmd:    cmd,
		cancel: cancel,
		done:   make(chan struct{}),
	}

	cfg.Status = MCPStatusRunning
	cfg.PID = cmd.Process.Pid
	cfg.LastStartedAt = time.Now().UTC().Format(time.RFC3339)
	cfg.LastError = ""
	s.configs[id] = cfg

	// Reap zombie on exit.
	go func() {
		_ = cmd.Wait()
		close(s.servers[id].done)
		s.mu.Lock()
		if c, ok := s.configs[id]; ok && c.Status == MCPStatusRunning {
			c.Status = MCPStatusStopped
			c.PID = 0
			s.configs[id] = c
		}
		s.mu.Unlock()
	}()

	return nil
}

// Stop terminates an MCP server process.
func (s *MCPSupervisor) Stop(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	proc, ok := s.servers[id]
	if !ok || proc.cmd.Process == nil {
		return nil // not running
	}

	proc.cancel()
	// Kill the process group to ensure all children are terminated.
	_ = killProcessGroup(proc.cmd.Process.Pid, nil)

	// Wait briefly for graceful shutdown.
	select {
	case <-proc.done:
	case <-time.After(5 * time.Second):
		_ = killProcessGroup(proc.cmd.Process.Pid, "kill")
	}

	delete(s.servers, id)

	if cfg, ok := s.configs[id]; ok {
		cfg.Status = MCPStatusStopped
		cfg.PID = 0
		s.configs[id] = cfg
	}

	return nil
}

// StartAll starts all auto-start enabled MCP servers.
func (s *MCPSupervisor) StartAll() {
	s.mu.RLock()
	ids := make([]string, 0)
	for id, cfg := range s.configs {
		if cfg.Enabled && cfg.AutoStart {
			ids = append(ids, id)
		}
	}
	s.mu.RUnlock()

	for _, id := range ids {
		if err := s.Start(id); err != nil {
			logf("auto-start mcp server %q failed: %v", id, err)
		}
	}
}

// StopAll stops all running MCP servers.
func (s *MCPSupervisor) StopAll() {
	s.mu.RLock()
	ids := make([]string, 0)
	for id, proc := range s.servers {
		if proc.cmd.Process != nil {
			ids = append(ids, id)
		}
	}
	s.mu.RUnlock()

	for _, id := range ids {
		_ = s.Stop(id)
	}
}

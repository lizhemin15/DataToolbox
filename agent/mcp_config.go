package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

// MCPServerConfig MCP Server 配置
type MCPServerConfig struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Command     string            `json:"command"`
	Args        []string          `json:"args"`
	Env         map[string]string `json:"env,omitempty"`
	Enabled     bool              `json:"enabled"`
	Description string            `json:"description,omitempty"`
}

// MCPSupervisor 管理 MCP Server 进程生命周期
type MCPSupervisor struct {
	mu      sync.RWMutex
	configs map[string]MCPServerConfig
	procs   map[string]*mcpProcess
	dir     string // 配置持久化目录
}

type mcpProcess struct {
	cmd    *exec.Cmd
	config MCPServerConfig
}

// NewMCPSupervisor 创建 MCP 进程管理器
func NewMCPSupervisor() *MCPSupervisor {
	dir := "/opt/datatoolbox/agent-config"
	return &MCPSupervisor{
		configs: make(map[string]MCPServerConfig),
		procs:   make(map[string]*mcpProcess),
		dir:     dir,
	}
}

// AddConfig 添加 MCP Server 配置
func (s *MCPSupervisor) AddConfig(cfg MCPServerConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.configs[cfg.ID] = cfg
	s.saveLocked()
	log.Printf("[mcp] config added: %s (%s)", cfg.ID, cfg.Name)
}

// RemoveConfig 移除 MCP Server 配置（先停止进程）
func (s *MCPSupervisor) RemoveConfig(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if proc, ok := s.procs[id]; ok {
		s.stopProcessLocked(proc)
		delete(s.procs, id)
	}
	delete(s.configs, id)
	s.saveLocked()
	return nil
}

// ListConfigs 列出所有 MCP Server 配置
func (s *MCPSupervisor) ListConfigs() []MCPServerConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []MCPServerConfig
	for _, cfg := range s.configs {
		result = append(result, cfg)
	}
	return result
}

// Start 启动指定 MCP Server 进程
func (s *MCPSupervisor) Start(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	cfg, ok := s.configs[id]
	if !ok {
		return fmt.Errorf("MCP server %q not found", id)
	}
	if !cfg.Enabled {
		return fmt.Errorf("MCP server %q is disabled", id)
	}

	cmd := exec.CommandContext(ctx, cfg.Command, cfg.Args...)
	setSysProcAttr(cmd)

	// 设置环境变量
	cmd.Env = os.Environ()
	for k, v := range cfg.Env {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start MCP server %q: %w", id, err)
	}

	s.procs[id] = &mcpProcess{cmd: cmd, config: cfg}
	log.Printf("[mcp] started: %s (pid=%d)", id, cmd.Process.Pid)

	// 后台回收进程
	go func() {
		err := cmd.Wait()
		s.mu.Lock()
		delete(s.procs, id)
		s.mu.Unlock()
		if err != nil {
			log.Printf("[mcp] process exited: %s, err=%v", id, err)
		}
	}()

	return nil
}

// Stop 停止指定 MCP Server 进程
func (s *MCPSupervisor) Stop(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	proc, ok := s.procs[id]
	if !ok {
		return nil // 没在运行
	}
	s.stopProcessLocked(proc)
	delete(s.procs, id)
	return nil
}

// StartAll 启动所有已启用的 MCP Server
func (s *MCPSupervisor) StartAll() {
	s.mu.RLock()
	configs := make([]MCPServerConfig, 0)
	for _, cfg := range s.configs {
		if cfg.Enabled {
			configs = append(configs, cfg)
		}
	}
	s.mu.RUnlock()

	for _, cfg := range configs {
		if err := s.Start(context.Background(), cfg.ID); err != nil {
			log.Printf("[mcp] failed to start %s: %v", cfg.ID, err)
		}
	}
}

// StopAll 停止所有 MCP Server 进程
func (s *MCPSupervisor) StopAll() {
	s.mu.Lock()
	defer s.mu.Unlock()

	for id, proc := range s.procs {
		s.stopProcessLocked(proc)
		delete(s.procs, id)
	}
}

// stopProcessLocked 停止进程（调用者需持有锁）
func (s *MCPSupervisor) stopProcessLocked(proc *mcpProcess) {
	if proc.cmd == nil || proc.cmd.Process == nil {
		return
	}

	// 优雅关闭
	proc.cmd.Process.Signal(os.Interrupt)
	done := make(chan error, 1)
	go func() { done <- proc.cmd.Wait() }()

	select {
	case <-done:
		log.Printf("[mcp] stopped gracefully: %s", proc.config.ID)
	case <-time.After(5 * time.Second):
		// 强制杀掉
		_ = killProcessGroup(proc.cmd)
		proc.cmd.Process.Kill()
		log.Printf("[mcp] force killed: %s", proc.config.ID)
	}
}

// saveLocked 持久化配置到磁盘（调用者需持有锁）
func (s *MCPSupervisor) saveLocked() {
	os.MkdirAll(s.dir, 0755)
	data, _ := json.MarshalIndent(s.configs, "", "  ")
	os.WriteFile(filepath.Join(s.dir, "mcp_servers.json"), data, 0644)
}

// Load 从磁盘加载配置
func (s *MCPSupervisor) Load() error {
	path := filepath.Join(s.dir, "mcp_servers.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // 首次运行，无配置文件
		}
		return err
	}

	var configs map[string]MCPServerConfig
	if err := json.Unmarshal(data, &configs); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.configs = configs
	log.Printf("[mcp] loaded %d configs from disk", len(configs))
	return nil
}

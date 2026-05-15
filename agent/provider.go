package agent

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"

	"github.com/sashabaranov/go-openai"
	"google.golang.org/adk/model"
	"google.golang.org/adk/model/gemini"
	"google.golang.org/genai"
)

// ProviderType LLM Provider 类型
type ProviderType string

const (
	ProviderTypeGemini    ProviderType = "gemini"
	ProviderTypeOpenAI    ProviderType = "openai"
	ProviderTypeAnthropic ProviderType = "anthropic"
)

// ProviderConfig LLM Provider 配置
type ProviderConfig struct {
	ID        string       `json:"id"`
	Name      string       `json:"name"`
	Type      ProviderType `json:"type"`
	APIKey    string       `json:"api_key"`
	BaseURL   string       `json:"base_url,omitempty"`
	ModelID   string       `json:"model_id"`
	Enabled   bool         `json:"enabled"`
	IsDefault bool         `json:"is_default"`
}

// ProviderRegistry 管理 LLM Provider 配置和创建 Model 实例
type ProviderRegistry struct {
	mu      sync.RWMutex
	configs map[string]ProviderConfig
}

// NewProviderRegistry 创建 Provider 注册表
func NewProviderRegistry() *ProviderRegistry {
	return &ProviderRegistry{
		configs: make(map[string]ProviderConfig),
	}
}

// Add 添加 Provider 配置
func (r *ProviderRegistry) Add(cfg ProviderConfig) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.configs[cfg.ID] = cfg
	log.Printf("[provider] added: %s (%s/%s)", cfg.ID, cfg.Type, cfg.ModelID)
}

// List 列出所有 Provider 配置
func (r *ProviderRegistry) List() []ProviderConfig {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []ProviderConfig
	for _, cfg := range r.configs {
		result = append(result, cfg)
	}
	return result
}

// CreateModel 根据 Provider 配置创建 adk-go Model 实例
func (r *ProviderRegistry) CreateModel(ctx context.Context, cfg ProviderConfig) (model.LLM, error) {
	switch cfg.Type {
	case ProviderTypeGemini:
		return createGeminiModel(ctx, cfg)
	case ProviderTypeOpenAI:
		return createOpenAIModel(cfg)
	case ProviderTypeAnthropic:
		return nil, fmt.Errorf("Anthropic provider not yet implemented — use OpenAI-compatible endpoint")
	default:
		return nil, fmt.Errorf("unknown provider type: %s", cfg.Type)
	}
}

// createGeminiModel 创建 Gemini 模型实例
func createGeminiModel(ctx context.Context, cfg ProviderConfig) (model.LLM, error) {
	clientCfg := &genai.ClientConfig{
		APIKey: cfg.APIKey,
	}

	m, err := gemini.NewModel(ctx, cfg.ModelID, clientCfg)
	if err != nil {
		return nil, fmt.Errorf("create gemini model %q: %w", cfg.ModelID, err)
	}

	log.Printf("[provider] created gemini model: %s", cfg.ModelID)
	return m, nil
}

// createOpenAIModel 创建 OpenAI 兼容模型实例
func createOpenAIModel(cfg ProviderConfig) (model.LLM, error) {
	ocfg := openai.DefaultConfig(cfg.APIKey)
	if cfg.BaseURL != "" {
		// OpenAI SDK 会自动拼接 /chat/completions，所以 BaseURL 只需要到 /v1
		baseURL := cfg.BaseURL
		baseURL = strings.TrimSuffix(baseURL, "/chat/completions")
		baseURL = strings.TrimSuffix(baseURL, "/completions")
		ocfg.BaseURL = baseURL
	}

	m := NewOpenAIModel(cfg.ModelID, ocfg)
	log.Printf("[provider] created openai model: %s (base_url=%s)", cfg.ModelID, ocfg.BaseURL)
	return m, nil
}

// GetDefault 获取默认 Provider 配置
func (r *ProviderRegistry) GetDefault() (ProviderConfig, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, cfg := range r.configs {
		if cfg.IsDefault && cfg.Enabled {
			return cfg, true
		}
	}
	return ProviderConfig{}, false
}

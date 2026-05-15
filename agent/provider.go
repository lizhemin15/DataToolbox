package agent

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"

	picoclawproviders "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/providers"
	picoclawcfg "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/config"
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

// ProviderRegistry 管理 LLM Provider 配置和创建 PicoClaw LLMProvider 实例
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

// CreatePicoProvider 根据 Provider 配置创建 PicoClaw LLMProvider
func (r *ProviderRegistry) CreatePicoProvider(ctx context.Context, cfg ProviderConfig) (picoclawproviders.LLMProvider, error) {
	switch cfg.Type {
	case ProviderTypeOpenAI, ProviderTypeAnthropic:
		return createPicoOpenAIProvider(cfg)
	case ProviderTypeGemini:
		return nil, fmt.Errorf("Gemini provider not yet supported in PicoClaw mode — use OpenAI-compatible endpoint")
	default:
		return nil, fmt.Errorf("unknown provider type: %s", cfg.Type)
	}
}

// createPicoOpenAIProvider 创建 PicoClaw OpenAI 兼容 provider
func createPicoOpenAIProvider(cfg ProviderConfig) (picoclawproviders.LLMProvider, error) {
	baseURL := cfg.BaseURL
	if baseURL != "" {
		baseURL = strings.TrimSuffix(baseURL, "/chat/completions")
		baseURL = strings.TrimSuffix(baseURL, "/completions")
	}

	// 构建 PicoClaw ModelConfig
	modelCfg := &picoclawcfg.ModelConfig{
		ModelName: cfg.Name,
		Provider:  "openai",
		Model:     cfg.ModelID,
		APIBase:   baseURL,
		APIKeys:   picoclawcfg.SecureStrings{picoclawcfg.NewSecureString(cfg.APIKey)},
		Enabled:   true,
	}

	provider, _, err := picoclawproviders.CreateProviderFromConfig(modelCfg)
	if err != nil {
		return nil, fmt.Errorf("create pico openai provider %q: %w", cfg.ModelID, err)
	}

	log.Printf("[provider] created pico openai provider: %s (base_url=%s)", cfg.ModelID, baseURL)
	return provider, nil
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
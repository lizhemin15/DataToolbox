package agent

import (
	"context"
	"fmt"
	"sync"

	"google.golang.org/adk/model"
	"google.golang.org/adk/model/gemini"
	"google.golang.org/genai"
)

// ---------------------------------------------------------------------------
// Provider — LLM provider configuration and registry
// ---------------------------------------------------------------------------

// ProviderType identifies the LLM backend.
type ProviderType string

const (
	ProviderTypeGemini    ProviderType = "gemini"
	ProviderTypeOpenAI    ProviderType = "openai"
	ProviderTypeAnthropic ProviderType = "anthropic"
)

// ProviderConfig describes an LLM provider. Stored in JSON config.
type ProviderConfig struct {
	ID        string       `json:"id"`
	Name      string       `json:"name"`
	Type      ProviderType `json:"type"`
	APIKey    string       `json:"api_key,omitempty"`
	BaseURL   string       `json:"base_url,omitempty"`
	ModelID   string       `json:"model_id"`
	Enabled   bool         `json:"enabled"`
	IsDefault bool         `json:"is_default"`
}

// ProviderRegistry manages available LLM providers.
type ProviderRegistry struct {
	mu       sync.RWMutex
	providers map[string]ProviderConfig
}

// NewProviderRegistry creates an empty registry.
func NewProviderRegistry() *ProviderRegistry {
	return &ProviderRegistry{
		providers: make(map[string]ProviderConfig),
	}
}

// Add registers a provider config.
func (r *ProviderRegistry) Add(cfg ProviderConfig) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.providers[cfg.ID] = cfg
}

// Remove removes a provider by ID.
func (r *ProviderRegistry) Remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.providers, id)
}

// Get returns a provider config by ID.
func (r *ProviderRegistry) Get(id string) (ProviderConfig, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	cfg, ok := r.providers[id]
	return cfg, ok
}

// List returns all provider configs.
func (r *ProviderRegistry) List() []ProviderConfig {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]ProviderConfig, 0, len(r.providers))
	for _, cfg := range r.providers {
		out = append(out, cfg)
	}
	return out
}

// Default returns the default provider config.
func (r *ProviderRegistry) Default() (ProviderConfig, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, cfg := range r.providers {
		if cfg.IsDefault && cfg.Enabled {
			return cfg, true
		}
	}
	// Fallback to first enabled provider.
	for _, cfg := range r.providers {
		if cfg.Enabled {
			return cfg, true
		}
	}
	return ProviderConfig{}, false
}

// CreateModel builds an adk-go model.LLM from a provider config.
// Currently only Gemini is natively supported by adk-go.
// OpenAI/Anthropic will be supported via adapter packages later.
func (r *ProviderRegistry) CreateModel(ctx context.Context, cfg ProviderConfig) (model.LLM, error) {
	switch cfg.Type {
	case ProviderTypeGemini:
		return gemini.NewModel(ctx, cfg.ModelID, &genai.ClientConfig{
			APIKey: cfg.APIKey,
		})
	case ProviderTypeOpenAI:
		return nil, fmt.Errorf("openai provider not yet implemented; use gemini for now")
	case ProviderTypeAnthropic:
		return nil, fmt.Errorf("anthropic provider not yet implemented; use gemini for now")
	default:
		return nil, fmt.Errorf("unknown provider type: %s", cfg.Type)
	}
}

// CreateDefaultModel creates a model from the default provider.
func (r *ProviderRegistry) CreateDefaultModel(ctx context.Context) (model.LLM, error) {
	cfg, ok := r.Default()
	if !ok {
		return nil, fmt.Errorf("no default provider configured")
	}
	return r.CreateModel(ctx, cfg)
}

// LoadFromMap bulk-loads provider configs from a map (e.g. JSON file).
func (r *ProviderRegistry) LoadFromMap(m map[string]ProviderConfig) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.providers = m
}

// ToMap exports provider configs as a map for JSON serialization.
func (r *ProviderRegistry) ToMap() map[string]ProviderConfig {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make(map[string]ProviderConfig, len(r.providers))
	for k, v := range r.providers {
		out[k] = v
	}
	return out
}

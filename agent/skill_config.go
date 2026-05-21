package agent

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Skill configuration and management
// ---------------------------------------------------------------------------

// SkillConfig describes a single skill (SKILL.md-based).
type SkillConfig struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Description     string    `json:"description,omitempty"`
	SourcePath      string    `json:"source_path"`       // file or directory path
	Content         string    `json:"content,omitempty"` // raw SKILL.md content
	Enabled         bool      `json:"enabled"`
	Validated       bool      `json:"validated"`
	ValidationError string    `json:"validation_error,omitempty"`
	LoadedAt        string    `json:"loaded_at,omitempty"`
}

// SkillRegistry manages skill configurations.
type SkillRegistry struct {
	mu     sync.RWMutex
	skills map[string]SkillConfig
}

// NewSkillRegistry creates an empty registry.
func NewSkillRegistry() *SkillRegistry {
	return &SkillRegistry{
		skills: make(map[string]SkillConfig),
	}
}

// LoadFromDir scans a directory for SKILL.md files and loads them.
func (r *SkillRegistry) LoadFromDir(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read skill dir %s: %w", dir, err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		skillPath := filepath.Join(dir, entry.Name(), "SKILL.md")
		data, err := os.ReadFile(skillPath)
		if err != nil {
			continue // not every dir has SKILL.md
		}

		name, desc := parseSkillFrontmatter(string(data))
		cfg := SkillConfig{
			ID:         entry.Name(),
			Name:       name,
			Description: desc,
			SourcePath: skillPath,
			Content:    string(data),
			Enabled:    true,
			Validated:  true,
			LoadedAt:   time.Now().UTC().Format(time.RFC3339),
		}
		if name == "" {
			cfg.Name = entry.Name()
		}

		r.mu.Lock()
		r.skills[entry.Name()] = cfg
		r.mu.Unlock()
	}

	return nil
}

// LoadFromConfigFile loads skill configs from a JSON file.
func (r *SkillRegistry) LoadFromConfigFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read skill config: %w", err)
	}

	var configs []SkillConfig
	if err := json.Unmarshal(data, &configs); err != nil {
		return fmt.Errorf("parse skill config: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	for _, cfg := range configs {
		r.skills[cfg.ID] = cfg
	}
	return nil
}

// SaveConfigFile saves skill configs to a JSON file.
func (r *SkillRegistry) SaveConfigFile(path string) error {
	r.mu.RLock()
	configs := make([]SkillConfig, 0, len(r.skills))
	for _, cfg := range r.skills {
		configs = append(configs, cfg)
	}
	r.mu.RUnlock()

	data, err := json.MarshalIndent(configs, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal skill config: %w", err)
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// Add adds or updates a skill config.
func (r *SkillRegistry) Add(cfg SkillConfig) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.skills[cfg.ID] = cfg
}

// Remove removes a skill by ID.
func (r *SkillRegistry) Remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.skills, id)
}

// Get returns a skill config by ID.
func (r *SkillRegistry) Get(id string) (SkillConfig, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	cfg, ok := r.skills[id]
	return cfg, ok
}

// List returns all skill configs.
func (r *SkillRegistry) List() []SkillConfig {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]SkillConfig, 0, len(r.skills))
	for _, cfg := range r.skills {
		out = append(out, cfg)
	}
	return out
}

// ListEnabled returns only enabled skills.
func (r *SkillRegistry) ListEnabled() []SkillConfig {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]SkillConfig, 0)
	for _, cfg := range r.skills {
		if cfg.Enabled {
			out = append(out, cfg)
		}
	}
	return out
}

// Reload reloads a skill from its source file.
func (r *SkillRegistry) Reload(id string) error {
	r.mu.RLock()
	cfg, ok := r.skills[id]
	r.mu.RUnlock()
	if !ok {
		return fmt.Errorf("skill %q not found", id)
	}

	if cfg.SourcePath == "" {
		return fmt.Errorf("skill %q has no source path", id)
	}

	data, err := os.ReadFile(cfg.SourcePath)
	if err != nil {
		return fmt.Errorf("read skill %s: %w", id, err)
	}

	name, desc := parseSkillFrontmatter(string(data))
	cfg.Content = string(data)
	cfg.Name = name
	cfg.Description = desc
	cfg.LoadedAt = time.Now().UTC().Format(time.RFC3339)
	cfg.Validated = true
	cfg.ValidationError = ""

	r.mu.Lock()
	r.skills[id] = cfg
	r.mu.Unlock()
	return nil
}

// parseSkillFrontmatter extracts name and description from YAML frontmatter.
// Format: ---\nname: xxx\ndescription: yyy\n---
func parseSkillFrontmatter(content string) (name, description string) {
	if !strings.HasPrefix(content, "---") {
		return "", ""
	}
	end := strings.Index(content[3:], "---")
	if end < 0 {
		return "", ""
	}
	fm := content[3 : end+3]
	for _, line := range strings.Split(fm, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "name:") {
			name = strings.TrimSpace(strings.TrimPrefix(line, "name:"))
		}
		if strings.HasPrefix(line, "description:") {
			description = strings.TrimSpace(strings.TrimPrefix(line, "description:"))
		}
	}
	return name, description
}

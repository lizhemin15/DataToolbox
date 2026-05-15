package skills

import "context"

// SkillsLoader loads skills (stub).
type SkillsLoader struct{}

// RegistryManager manages skill registries (stub).
type RegistryManager struct{}

// SearchCache caches skill search results (stub).
type SearchCache struct{}

// SkillRegistry represents a skill registry (stub).
type SkillRegistry struct {
	name string
}

// SearchResult is a skill search result (stub).
type SearchResult struct {
	Name         string
	DisplayName  string
	Description  string
	Slug         string
	Version      string
	RegistryName string
	Score        float64
	Summary      string
	Source       string
	Path         string
	Registry     *SkillRegistry
}

// NewSkillsLoader creates a new skills loader (stub).
func NewSkillsLoader(workspace, globalSkillsDir, builtinSkillsDir string) *SkillsLoader {
	return &SkillsLoader{}
}

// NewRegistryManagerFromToolsConfig creates a registry manager from tools config (stub).
func NewRegistryManagerFromToolsConfig(cfg interface{}) *RegistryManager {
	return &RegistryManager{}
}

// NewSearchCache creates a new search cache (stub).
func NewSearchCache(ttl interface{}) *SearchCache {
	return &SearchCache{}
}

// BuildInstallMetadataForRegistryInstance builds install metadata (stub).
func BuildInstallMetadataForRegistryInstance(registry *SkillRegistry, slug, version string) (string, string) {
	return "", ""
}

// GetRegistry returns a registry by name (stub).
func (rm *RegistryManager) GetRegistry(name string) (*SkillRegistry, bool) {
	return &SkillRegistry{name: name}, true
}

// SearchAll searches all registries (stub).
func (rm *RegistryManager) SearchAll(ctx context.Context, query string, limit int) ([]SearchResult, error) {
	return nil, nil
}

// Name returns the registry name.
func (sr *SkillRegistry) Name() string {
	return sr.name
}

// Get returns a cached result (stub).
func (sc *SearchCache) Get(key string) ([]SearchResult, bool) {
	return nil, false
}

// Put stores a result in cache (stub).
func (sc *SearchCache) Put(key string, results []SearchResult) {}

// ListSkills lists installed skills (stub).
func (sl *SkillsLoader) ListSkills() []SearchResult {
	return nil
}

// BuildSkillsSummary builds a summary of installed skills (stub).
func (sl *SkillsLoader) BuildSkillsSummary() string {
	return ""
}

// SkillRoots returns skill directory roots (stub).
func (sl *SkillsLoader) SkillRoots() []string {
	return nil
}

// LoadSkillsForContext loads skill content for context (stub).
func (sl *SkillsLoader) LoadSkillsForContext(names []string) string {
	return ""
}

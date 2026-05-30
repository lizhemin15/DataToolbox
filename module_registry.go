package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"sync"
)

// ImportableModule 可导入导出的模块接口
// 新增模块只需实现此接口并调用 RegisterModule() 注册，导入导出自动适配
type ImportableModule interface {
	// ModuleName 模块唯一标识，如 "users", "governance_task_logs"
	ModuleName() string
	// ModuleLabel 模块中文标签，如 "用户数据", "治理任务日志"
	ModuleLabel() string
	// Count 当前内存中的记录数
	Count() int
	// LoadFromDB 从外部 DB 读取该模块数据（导入时调用）
	LoadFromDB(otherDB *sql.DB) (interface{}, error)
	// MergeToMemory 将数据合并到当前内存（仅新增，不覆盖已有）
	MergeToMemory(data interface{}) (int, error)
	// SetFromMemory 从当前内存读取数据（导出时调用，用于 JSON 兼容模式）
	SetFromMemory() interface{}
	// ApplyToMemory 从外部数据覆盖当前内存（overwrite 模式用）
	ApplyToMemory(data interface{})
	// ExtractFromJSONStore 从 JSON Store 提取该模块数据（JSON 导入时调用）
	ExtractFromJSONStore(store *DataOntologyStore) interface{}
}

// ============================================================
// 模块注册表
// ============================================================

var (
	moduleRegistry     []ImportableModule
	moduleRegistryOnce sync.Once
)

// RegisterModule 注册一个模块到全局注册表（init 时调用）
func RegisterModule(m ImportableModule) {
	moduleRegistry = append(moduleRegistry, m)
}

// GetModules 获取所有已注册模块（懒初始化）
func GetModules() []ImportableModule {
	moduleRegistryOnce.Do(func() {
		// 注册顺序决定 manifest 中的显示顺序
		RegisterModule(&UsersModule{})
		RegisterModule(&DatabasesModule{})
		RegisterModule(&ApisModule{})
		RegisterModule(&GovernanceTasksModule{})
		RegisterModule(&GovernanceTaskLogsModule{})
		RegisterModule(&AIConfigModule{})
		RegisterModule(&AICapabilitiesModule{})
		RegisterModule(&MCPConfigModule{})
		RegisterModule(&LLMModelsModule{})
		RegisterModule(&SmallModelsModule{})
		RegisterModule(&ShareRunsModule{})
		RegisterModule(&QualityAuditModule{})
	})
	return moduleRegistry
}

// AllModuleNames 返回所有模块名列表
func AllModuleNames() []string {
	names := make([]string, 0, len(GetModules()))
	for _, m := range GetModules() {
		names = append(names, m.ModuleName())
	}
	return names
}

// BuildManifestFromRegistry 从注册表构建备份清单
func BuildManifestFromRegistry() map[string]*BackupModuleInfo {
	modules := make(map[string]*BackupModuleInfo)
	for _, m := range GetModules() {
		count := m.Count()
		if count > 0 {
			modules[m.ModuleName()] = &BackupModuleInfo{Count: count, Label: m.ModuleLabel()}
		}
	}
	return modules
}

// MergeFromDBByRegistry 从外部 DB 按模块选择性合并
func MergeFromDBByRegistry(otherDB *sql.DB, selectedModules map[string]bool, importAll bool) (map[string]interface{}, error) {
	stats := map[string]interface{}{
		"skipped_modules": []string{},
	}

	moduleSelected := func(module string) bool {
		return importAll || selectedModules[module]
	}

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	for _, m := range GetModules() {
		if !moduleSelected(m.ModuleName()) {
			continue
		}
		data, err := m.LoadFromDB(otherDB)
		if err != nil {
			log.Printf("[存储] 加载模块 %s 失败: %v", m.ModuleName(), err)
			continue
		}
		if data == nil {
			continue
		}
		added, err := m.MergeToMemory(data)
		if err != nil {
			log.Printf("[存储] 合并模块 %s 失败: %v", m.ModuleName(), err)
			continue
		}
		stats[m.ModuleName()+"_added"] = added
	}

	// 记录跳过的模块
	if !importAll {
		skipped := []string{}
		for _, m := range GetModules() {
			if !selectedModules[m.ModuleName()] {
				skipped = append(skipped, m.ModuleName())
			}
		}
		stats["skipped_modules"] = skipped
	}

	log.Printf("[存储] 选择性合并完成: %+v", stats)
	return stats, nil
}

// MergeFromJSONByRegistry 从 JSON Store 按模块选择性合并
func MergeFromJSONByRegistry(newStore *DataOntologyStore, selectedModules map[string]bool, importAll bool) map[string]interface{} {
	stats := map[string]interface{}{
		"skipped_modules": []string{},
	}

	moduleSelected := func(module string) bool {
		return importAll || selectedModules[module]
	}

	for _, m := range GetModules() {
		if !moduleSelected(m.ModuleName()) {
			continue
		}
		// 从 JSON Store 提取该模块的数据
		data := m.ExtractFromJSONStore(newStore)
		if data == nil {
			continue
		}
		added, err := m.MergeToMemory(data)
		if err != nil {
			log.Printf("[存储] JSON合并模块 %s 失败: %v", m.ModuleName(), err)
			continue
		}
		stats[m.ModuleName()+"_added"] = added
	}

	if !importAll {
		skipped := []string{}
		for _, m := range GetModules() {
			if !selectedModules[m.ModuleName()] {
				skipped = append(skipped, m.ModuleName())
			}
		}
		stats["skipped_modules"] = skipped
	}

	return stats
}

// OverwriteFromJSONByRegistry 从 JSON Store 覆盖当前内存
func OverwriteFromJSONByRegistry(newStore *DataOntologyStore, selectedModules map[string]bool, importAll bool) map[string]interface{} {
	stats := map[string]interface{}{}

	moduleSelected := func(module string) bool {
		return importAll || selectedModules[module]
	}

	for _, m := range GetModules() {
		if !moduleSelected(m.ModuleName()) {
			continue
		}
		data := m.ExtractFromJSONStore(newStore)
		if data == nil {
			continue
		}
		m.ApplyToMemory(data)
		stats[m.ModuleName()+"_count"] = m.Count()
	}

	return stats
}

// ============================================================
// 各模块实现
// ============================================================

// --- UsersModule ---

type UsersModule struct{}

func (m *UsersModule) ModuleName() string  { return "users" }
func (m *UsersModule) ModuleLabel() string { return "用户数据" }
func (m *UsersModule) Count() int          { return len(dataOntologyUsers) }

func (m *UsersModule) LoadFromDB(otherDB *sql.DB) (interface{}, error) {
	rows, err := otherDB.Query("SELECT username, password, token, tokens, token_entries, api_key, settings FROM users")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]*User)
	for rows.Next() {
		var u User
		var token, tokensJSON, tokenEntriesJSON, apiKey, settingsJSON sql.NullString
		rows.Scan(&u.Username, &u.Password, &token, &tokensJSON, &tokenEntriesJSON, &apiKey, &settingsJSON)
		u.Token = token.String
		if tokensJSON.Valid && tokensJSON.String != "" {
			json.Unmarshal([]byte(tokensJSON.String), &u.Tokens)
		}
		if tokenEntriesJSON.Valid && tokenEntriesJSON.String != "" {
			json.Unmarshal([]byte(tokenEntriesJSON.String), &u.TokenEntries)
		}
		u.ApiKey = apiKey.String
		if settingsJSON.Valid && settingsJSON.String != "" {
			json.Unmarshal([]byte(settingsJSON.String), &u.Settings)
		}
		result[u.Username] = &u
	}
	return result, nil
}

func (m *UsersModule) MergeToMemory(data interface{}) (int, error) {
	users, ok := data.(map[string]*User)
	if !ok {
		return 0, fmt.Errorf("invalid data type for users")
	}
	added := 0
	for k, v := range users {
		if _, exists := dataOntologyUsers[k]; !exists {
			if v != nil && v.Password != "" && !isBcryptHash(v.Password) {
				v.Password = hashPassword(v.Password)
			}
			dataOntologyUsers[k] = v
			added++
		}
	}
	return added, nil
}

func (m *UsersModule) SetFromMemory() interface{} {
	return dataOntologyUsers
}

func (m *UsersModule) ApplyToMemory(data interface{}) {
	if users, ok := data.(map[string]*User); ok {
		for _, v := range users {
			if v != nil && v.Password != "" && !isBcryptHash(v.Password) {
				v.Password = hashPassword(v.Password)
			}
		}
		dataOntologyUsers = users
	}
}

func (m *UsersModule) ExtractFromJSONStore(store *DataOntologyStore) interface{} {
	return store.Users
}

// --- DatabasesModule ---

type DatabasesModule struct{}

func (m *DatabasesModule) ModuleName() string  { return "databases" }
func (m *DatabasesModule) ModuleLabel() string { return "数据库配置" }
func (m *DatabasesModule) Count() int          { return len(dataOntologyDatabases) }

func (m *DatabasesModule) LoadFromDB(otherDB *sql.DB) (interface{}, error) {
	rows, err := otherDB.Query("SELECT id, owner, type, name, host, port, user, password, database, path, options, relations FROM databases")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]*DatabaseConfig)
	for rows.Next() {
		var db DatabaseConfig
		var owner, optionsJSON, relationsJSON sql.NullString
		rows.Scan(&db.ID, &owner, &db.Type, &db.Name, &db.Host, &db.Port, &db.User, &db.Password, &db.Database, &db.Path, &optionsJSON, &relationsJSON)
		db.Owner = owner.String
		if relationsJSON.Valid && relationsJSON.String != "" {
			json.Unmarshal([]byte(relationsJSON.String), &db.Relations)
		}
		result[db.ID] = &db
	}
	return result, nil
}

func (m *DatabasesModule) MergeToMemory(data interface{}) (int, error) {
	dbs, ok := data.(map[string]*DatabaseConfig)
	if !ok {
		return 0, fmt.Errorf("invalid data type for databases")
	}
	added := 0
	for k, v := range dbs {
		if _, exists := dataOntologyDatabases[k]; !exists {
			dataOntologyDatabases[k] = v
			added++
		}
	}
	return added, nil
}

func (m *DatabasesModule) SetFromMemory() interface{} { return dataOntologyDatabases }
func (m *DatabasesModule) ApplyToMemory(data interface{}) {
	if dbs, ok := data.(map[string]*DatabaseConfig); ok {
		dataOntologyDatabases = dbs
	}
}
func (m *DatabasesModule) ExtractFromJSONStore(store *DataOntologyStore) interface{} { return store.Databases }

// --- ApisModule ---

type ApisModule struct{}

func (m *ApisModule) ModuleName() string  { return "apis" }
func (m *ApisModule) ModuleLabel() string { return "接口分发" }
func (m *ApisModule) Count() int          { return len(dataOntologyApis) }

func (m *ApisModule) LoadFromDB(otherDB *sql.DB) (interface{}, error) {
	rows, err := otherDB.Query("SELECT id, name, database_id, config FROM apis")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]*ApiConfig)
	for rows.Next() {
		var id, name, dbID string
		var configJSON sql.NullString
		rows.Scan(&id, &name, &dbID, &configJSON)
		api := &ApiConfig{ID: id, Name: name, DatabaseID: dbID}
		if configJSON.Valid && configJSON.String != "" {
			json.Unmarshal([]byte(configJSON.String), api)
		}
		api.ID = id
		api.Name = name
		api.DatabaseID = dbID
		result[id] = api
	}
	return result, nil
}

func (m *ApisModule) MergeToMemory(data interface{}) (int, error) {
	apis, ok := data.(map[string]*ApiConfig)
	if !ok {
		return 0, fmt.Errorf("invalid data type for apis")
	}
	added := 0
	for k, v := range apis {
		if _, exists := dataOntologyApis[k]; !exists {
			dataOntologyApis[k] = v
			added++
		}
	}
	return added, nil
}

func (m *ApisModule) SetFromMemory() interface{} { return dataOntologyApis }
func (m *ApisModule) ApplyToMemory(data interface{}) {
	if apis, ok := data.(map[string]*ApiConfig); ok {
		dataOntologyApis = apis
	}
}
func (m *ApisModule) ExtractFromJSONStore(store *DataOntologyStore) interface{} { return store.Apis }

// --- GovernanceTasksModule ---

type GovernanceTasksModule struct{}

func (m *GovernanceTasksModule) ModuleName() string  { return "governance_tasks" }
func (m *GovernanceTasksModule) ModuleLabel() string { return "治理任务" }
func (m *GovernanceTasksModule) Count() int          { return len(governanceTasks) }

func (m *GovernanceTasksModule) LoadFromDB(otherDB *sql.DB) (interface{}, error) {
	rows, err := otherDB.Query("SELECT id, name, config FROM governance_tasks")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]*GovernanceTask)
	for rows.Next() {
		var id, name string
		var configJSON sql.NullString
		rows.Scan(&id, &name, &configJSON)
		task := &GovernanceTask{ID: id, Name: name}
		if configJSON.Valid && configJSON.String != "" {
			json.Unmarshal([]byte(configJSON.String), task)
		}
		task.ID = id
		task.Name = name
		result[id] = task
	}
	return result, nil
}

func (m *GovernanceTasksModule) MergeToMemory(data interface{}) (int, error) {
	tasks, ok := data.(map[string]*GovernanceTask)
	if !ok {
		return 0, fmt.Errorf("invalid data type for governance_tasks")
	}
	added := 0
	for k, v := range tasks {
		if _, exists := governanceTasks[k]; !exists {
			governanceTasks[k] = v
			added++
		}
	}
	return added, nil
}

func (m *GovernanceTasksModule) SetFromMemory() interface{} { return governanceTasks }
func (m *GovernanceTasksModule) ApplyToMemory(data interface{}) {
	if tasks, ok := data.(map[string]*GovernanceTask); ok {
		governanceTasks = tasks
	}
}
func (m *GovernanceTasksModule) ExtractFromJSONStore(store *DataOntologyStore) interface{} { return store.Tasks }

// --- GovernanceTaskLogsModule ---

type GovernanceTaskLogsModule struct{}

func (m *GovernanceTaskLogsModule) ModuleName() string  { return "governance_task_logs" }
func (m *GovernanceTaskLogsModule) ModuleLabel() string { return "治理任务日志" }
func (m *GovernanceTaskLogsModule) Count() int          { return len(governanceTaskLogs) }

func (m *GovernanceTaskLogsModule) LoadFromDB(otherDB *sql.DB) (interface{}, error) {
	rows, err := otherDB.Query("SELECT task_id, run_id, log_data FROM governance_task_logs")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string][]*GovernanceTaskLog)
	for rows.Next() {
		var taskID, runID, logDataJSON string
		if err := rows.Scan(&taskID, &runID, &logDataJSON); err != nil {
			continue
		}
		if result[taskID] == nil {
			result[taskID] = []*GovernanceTaskLog{}
		}
		var logEntry GovernanceTaskLog
		if logDataJSON != "" && logDataJSON != "{}" {
			json.Unmarshal([]byte(logDataJSON), &logEntry)
		}
		if logEntry.ID == "" {
			logEntry.ID = runID
		}
		if logEntry.RunID == "" {
			logEntry.RunID = runID
		}
		result[taskID] = append(result[taskID], &logEntry)
	}
	return result, nil
}

func (m *GovernanceTaskLogsModule) MergeToMemory(data interface{}) (int, error) {
	logs, ok := data.(map[string][]*GovernanceTaskLog)
	if !ok {
		return 0, fmt.Errorf("invalid data type for governance_task_logs")
	}
	added := 0
	for k, v := range logs {
		if _, exists := governanceTaskLogs[k]; !exists {
			governanceTaskLogs[k] = v
			added += len(v)
		}
	}
	return added, nil
}

func (m *GovernanceTaskLogsModule) SetFromMemory() interface{} { return governanceTaskLogs }
func (m *GovernanceTaskLogsModule) ApplyToMemory(data interface{}) {
	if logs, ok := data.(map[string][]*GovernanceTaskLog); ok {
		governanceTaskLogs = logs
	}
}
func (m *GovernanceTaskLogsModule) ExtractFromJSONStore(store *DataOntologyStore) interface{} { return store.TaskLogs }

// --- AIConfigModule ---

type AIConfigModule struct{}

func (m *AIConfigModule) ModuleName() string  { return "ai_config" }
func (m *AIConfigModule) ModuleLabel() string { return "AI配置" }
func (m *AIConfigModule) Count() int {
	if dataOntologyAIConfig != nil {
		return 1
	}
	return 0
}

func (m *AIConfigModule) LoadFromDB(otherDB *sql.DB) (interface{}, error) {
	var baseURL, apiKey, model sql.NullString
	var timeout int
	var enableFC, enableThinking, enableStreaming, enableJSON sql.NullString
	var ctxWindow int
	var tableRetrieval, embeddingJSON sql.NullString
	row := otherDB.QueryRow("SELECT base_url, api_key, model, timeout, enable_function_call, enable_thinking, enable_streaming, enable_json_mode, context_window_override, table_retrieval, embedding FROM ai_config WHERE id = 1")
	if err := row.Scan(&baseURL, &apiKey, &model, &timeout, &enableFC, &enableThinking, &enableStreaming, &enableJSON, &ctxWindow, &tableRetrieval, &embeddingJSON); err != nil {
		return nil, nil // no data
	}
	if baseURL.String == "" && apiKey.String == "" && model.String == "" {
		return nil, nil
	}
	cfg := &AIConfig{
		URL:     baseURL.String,
		APIKey:  apiKey.String,
		Model:   model.String,
		Timeout: timeout,
	}
	if enableFC.Valid && enableFC.String != "" {
		if b := parseBoolString(enableFC.String); b != nil {
			cfg.EnableFunctionCall = b
		}
	}
	if enableThinking.Valid && enableThinking.String != "" {
		if b := parseBoolString(enableThinking.String); b != nil {
			cfg.EnableThinking = b
		}
	}
	if enableStreaming.Valid && enableStreaming.String != "" {
		if b := parseBoolString(enableStreaming.String); b != nil {
			cfg.EnableStreaming = b
		}
	}
	if enableJSON.Valid && enableJSON.String != "" {
		if b := parseBoolString(enableJSON.String); b != nil {
			cfg.EnableJSONMode = b
		}
	}
	cfg.ContextWindowOverride = ctxWindow
	if tableRetrieval.Valid && tableRetrieval.String != "" {
		json.Unmarshal([]byte(tableRetrieval.String), &cfg.TableRetrieval)
	}
	if embeddingJSON.Valid && embeddingJSON.String != "" {
		json.Unmarshal([]byte(embeddingJSON.String), &cfg.Embedding)
	}
	return cfg, nil
}

func (m *AIConfigModule) MergeToMemory(data interface{}) (int, error) {
	cfg, ok := data.(*AIConfig)
	if !ok || cfg == nil {
		return 0, nil
	}
	if dataOntologyAIConfig == nil {
		dataOntologyAIConfig = cfg
		return 1, nil
	}
	return 0, nil
}

func (m *AIConfigModule) SetFromMemory() interface{} { return dataOntologyAIConfig }
func (m *AIConfigModule) ApplyToMemory(data interface{}) {
	if cfg, ok := data.(*AIConfig); ok {
		dataOntologyAIConfig = cfg
	}
}
func (m *AIConfigModule) ExtractFromJSONStore(store *DataOntologyStore) interface{} { return store.AIConfig }

// --- AICapabilitiesModule ---

type AICapabilitiesModule struct{}

func (m *AICapabilitiesModule) ModuleName() string  { return "ai_capabilities" }
func (m *AICapabilitiesModule) ModuleLabel() string { return "AI能力检测" }
func (m *AICapabilitiesModule) Count() int {
	if dataOntologyAICapabilities != nil {
		return 1
	}
	return 0
}

func (m *AICapabilitiesModule) LoadFromDB(otherDB *sql.DB) (interface{}, error) {
	var capJSON sql.NullString
	row := otherDB.QueryRow("SELECT capabilities FROM ai_capabilities WHERE id = 1")
	if err := row.Scan(&capJSON); err != nil {
		return nil, nil
	}
	if !capJSON.Valid || capJSON.String == "" {
		return nil, nil
	}
	var cap AICapabilities
	if err := json.Unmarshal([]byte(capJSON.String), &cap); err != nil {
		return nil, err
	}
	return &cap, nil
}

func (m *AICapabilitiesModule) MergeToMemory(data interface{}) (int, error) {
	cap, ok := data.(*AICapabilities)
	if !ok || cap == nil {
		return 0, nil
	}
	if dataOntologyAICapabilities == nil {
		dataOntologyAICapabilities = cap
		return 1, nil
	}
	return 0, nil
}

func (m *AICapabilitiesModule) SetFromMemory() interface{} { return dataOntologyAICapabilities }
func (m *AICapabilitiesModule) ApplyToMemory(data interface{}) {
	if cap, ok := data.(*AICapabilities); ok {
		dataOntologyAICapabilities = cap
	}
}
func (m *AICapabilitiesModule) ExtractFromJSONStore(store *DataOntologyStore) interface{} { return store.AICapabilities }

// --- MCPConfigModule ---

type MCPConfigModule struct{}

func (m *MCPConfigModule) ModuleName() string  { return "mcp_config" }
func (m *MCPConfigModule) ModuleLabel() string { return "MCP配置" }
func (m *MCPConfigModule) Count() int {
	if dataOntologyMCPEnabled != nil {
		return 1
	}
	return 0
}

func (m *MCPConfigModule) LoadFromDB(otherDB *sql.DB) (interface{}, error) {
	var enabledInt int
	var safeConfigJSON sql.NullString
	row := otherDB.QueryRow("SELECT enabled, safe_config FROM mcp_config WHERE id = 1")
	if err := row.Scan(&enabledInt, &safeConfigJSON); err != nil {
		return nil, nil
	}
	enabled := enabledInt != 0
	result := &struct {
		Enabled     *bool          `json:"enabled"`
		SafeConfig  *MCPSafeConfig `json:"safe_config"`
	}{
		Enabled: &enabled,
	}
	if safeConfigJSON.Valid && safeConfigJSON.String != "" {
		var cfg MCPSafeConfig
		if json.Unmarshal([]byte(safeConfigJSON.String), &cfg) == nil {
			result.SafeConfig = &cfg
		}
	}
	return result, nil
}

func (m *MCPConfigModule) MergeToMemory(data interface{}) (int, error) {
	d, ok := data.(*struct {
		Enabled    *bool          `json:"enabled"`
		SafeConfig *MCPSafeConfig `json:"safe_config"`
	})
	if !ok || d == nil {
		return 0, nil
	}
	if dataOntologyMCPEnabled == nil && d.Enabled != nil {
		dataOntologyMCPEnabled = d.Enabled
	}
	if dataOntologyMCPSafeConfig == nil && d.SafeConfig != nil {
		dataOntologyMCPSafeConfig = d.SafeConfig
		dataOntologyMCPPort = d.SafeConfig.Port
	}
	return 1, nil
}

func (m *MCPConfigModule) SetFromMemory() interface{} { return dataOntologyMCPEnabled }
func (m *MCPConfigModule) ApplyToMemory(data interface{}) {
	d, ok := data.(*struct {
		Enabled    *bool          `json:"enabled"`
		SafeConfig *MCPSafeConfig `json:"safe_config"`
	})
	if ok && d != nil {
		if d.Enabled != nil {
			dataOntologyMCPEnabled = d.Enabled
		}
		if d.SafeConfig != nil {
			dataOntologyMCPSafeConfig = d.SafeConfig
			dataOntologyMCPPort = d.SafeConfig.Port
		}
	}
}
func (m *MCPConfigModule) ExtractFromJSONStore(store *DataOntologyStore) interface{} {
	return &struct {
		Enabled    *bool          `json:"enabled"`
		SafeConfig *MCPSafeConfig `json:"safe_config"`
	}{
		Enabled:    store.MCPEnabled,
		SafeConfig: store.MCPSafeConfig,
	}
}

// --- LLMModelsModule ---

type LLMModelsModule struct{}

func (m *LLMModelsModule) ModuleName() string  { return "llm_models" }
func (m *LLMModelsModule) ModuleLabel() string { return "大模型配置" }
func (m *LLMModelsModule) Count() int          { return len(llmModels) }

func (m *LLMModelsModule) LoadFromDB(otherDB *sql.DB) (interface{}, error) {
	rows, err := otherDB.Query("SELECT id, name, type, provider, url, api_key, model, description, enabled, created_at, updated_at FROM llm_models")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]*LLMModelConfig)
	for rows.Next() {
		var mod LLMModelConfig
		var createdAt, updatedAt sql.NullString
		rows.Scan(&mod.ID, &mod.Name, &mod.Type, &mod.Provider, &mod.URL, &mod.APIKey, &mod.Model, &mod.Description, &mod.Enabled, &createdAt, &updatedAt)
		mod.CreatedAt = createdAt.String
		mod.UpdatedAt = updatedAt.String
		result[mod.ID] = &mod
	}
	return result, nil
}

func (m *LLMModelsModule) MergeToMemory(data interface{}) (int, error) {
	models, ok := data.(map[string]*LLMModelConfig)
	if !ok {
		return 0, fmt.Errorf("invalid data type for llm_models")
	}
	added := 0
	for k, v := range models {
		if _, exists := llmModels[k]; !exists {
			llmModels[k] = v
			added++
		}
	}
	return added, nil
}

func (m *LLMModelsModule) SetFromMemory() interface{} { return llmModels }
func (m *LLMModelsModule) ApplyToMemory(data interface{}) {
	if models, ok := data.(map[string]*LLMModelConfig); ok {
		llmModels = models
	}
}
func (m *LLMModelsModule) ExtractFromJSONStore(store *DataOntologyStore) interface{} { return store.LLMModels }

// --- SmallModelsModule ---

type SmallModelsModule struct{}

func (m *SmallModelsModule) ModuleName() string  { return "small_models" }
func (m *SmallModelsModule) ModuleLabel() string { return "小模型配置" }
func (m *SmallModelsModule) Count() int          { return len(smallModels) }

func (m *SmallModelsModule) LoadFromDB(otherDB *sql.DB) (interface{}, error) {
	rows, err := otherDB.Query("SELECT id, name, description, js_code, database_id, input_type, accept_exts, output_type, enabled, created_at, updated_at FROM small_models")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]*SmallModelConfig)
	for rows.Next() {
		var mod SmallModelConfig
		var createdAt, updatedAt sql.NullString
		rows.Scan(&mod.ID, &mod.Name, &mod.Description, &mod.JsCode, &mod.DatabaseID, &mod.InputType, &mod.AcceptExts, &mod.OutputType, &mod.Enabled, &createdAt, &updatedAt)
		mod.CreatedAt = createdAt.String
		mod.UpdatedAt = updatedAt.String
		result[mod.ID] = &mod
	}
	return result, nil
}

func (m *SmallModelsModule) MergeToMemory(data interface{}) (int, error) {
	models, ok := data.(map[string]*SmallModelConfig)
	if !ok {
		return 0, fmt.Errorf("invalid data type for small_models")
	}
	added := 0
	for k, v := range models {
		if _, exists := smallModels[k]; !exists {
			smallModels[k] = v
			added++
		}
	}
	return added, nil
}

func (m *SmallModelsModule) SetFromMemory() interface{} { return smallModels }
func (m *SmallModelsModule) ApplyToMemory(data interface{}) {
	if models, ok := data.(map[string]*SmallModelConfig); ok {
		smallModels = models
	}
}
func (m *SmallModelsModule) ExtractFromJSONStore(store *DataOntologyStore) interface{} { return store.SmallModels }

// --- ShareRunsModule ---

type ShareRunsModule struct{}

func (m *ShareRunsModule) ModuleName() string  { return "share_runs" }
func (m *ShareRunsModule) ModuleLabel() string { return "分享任务记录" }
func (m *ShareRunsModule) Count() int {
	governanceShareRunsMu.RLock()
	n := len(governanceShareRuns)
	governanceShareRunsMu.RUnlock()
	return n
}

func (m *ShareRunsModule) LoadFromDB(otherDB *sql.DB) (interface{}, error) {
	rows, err := otherDB.Query("SELECT share_token, run_id, run_data FROM share_runs")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]*GovernanceShareRun)
	for rows.Next() {
		var shareToken, runID, runDataJSON string
		if err := rows.Scan(&shareToken, &runID, &runDataJSON); err != nil {
			continue
		}
		key := shareToken + "/" + runID
		var sr GovernanceShareRun
		if runDataJSON != "" && runDataJSON != "{}" {
			json.Unmarshal([]byte(runDataJSON), &sr)
		}
		if sr.ShareToken == "" {
			sr.ShareToken = shareToken
		}
		if sr.ID == "" {
			sr.ID = runID
		}
		result[key] = &sr
	}
	return result, nil
}

func (m *ShareRunsModule) MergeToMemory(data interface{}) (int, error) {
	runs, ok := data.(map[string]*GovernanceShareRun)
	if !ok {
		return 0, fmt.Errorf("invalid data type for share_runs")
	}
	governanceShareRunsMu.Lock()
	defer governanceShareRunsMu.Unlock()
	added := 0
	for k, v := range runs {
		if _, exists := governanceShareRuns[k]; !exists {
			governanceShareRuns[k] = v
			added++
		}
	}
	return added, nil
}

func (m *ShareRunsModule) SetFromMemory() interface{} {
	governanceShareRunsMu.RLock()
	result := make(map[string]*GovernanceShareRun)
	for k, v := range governanceShareRuns {
		result[k] = v
	}
	governanceShareRunsMu.RUnlock()
	return result
}

func (m *ShareRunsModule) ApplyToMemory(data interface{}) {
	governanceShareRunsMu.Lock()
	defer governanceShareRunsMu.Unlock()
	if runs, ok := data.(map[string]*GovernanceShareRun); ok {
		governanceShareRuns = runs
	}
}

func (m *ShareRunsModule) ExtractFromJSONStore(store *DataOntologyStore) interface{} {
	if store.ShareRuns == nil {
		return nil
	}
	// JSON Store 用 shareToken -> runID -> run 格式，转为 key -> run
	result := make(map[string]*GovernanceShareRun)
	for _, runs := range store.ShareRuns {
		for runID, run := range runs {
			result[runID] = run
		}
	}
	return result
}

// --- QualityAuditModule ---
// quality_audit 使用独立的 quality-audit.db，不走 data-store.db
// 导出时直接打包 db 文件，导入时直接替换

type QualityAuditModule struct{}

func (m *QualityAuditModule) ModuleName() string  { return "quality_audit" }
func (m *QualityAuditModule) ModuleLabel() string { return "质量审计规则" }
func (m *QualityAuditModule) Count() int {
	if storeDB == nil {
		return 0
	}
	var count int
	storeDB.QueryRow("SELECT COUNT(*) FROM rules").Scan(&count)
	return count
}

func (m *QualityAuditModule) LoadFromDB(otherDB *sql.DB) (interface{}, error) {
	// quality_audit 不在 data-store.db 中，无法从 otherDB 读取
	// 它有独立的 quality-audit.db，由 ZIP 文件直接处理
	return nil, nil
}

func (m *QualityAuditModule) MergeToMemory(data interface{}) (int, error) {
	// quality_audit 的合并由 ZIP 文件级别处理（直接替换 db 文件）
	return 0, nil
}

func (m *QualityAuditModule) SetFromMemory() interface{} { return nil }
func (m *QualityAuditModule) ApplyToMemory(data interface{})  {}
func (m *QualityAuditModule) ExtractFromJSONStore(store *DataOntologyStore) interface{} { return nil }

package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// ============================================================
// SQLite 存储层 — 替代 JSON 文件存储
// 纯 Go 实现 (modernc.org/sqlite)，保持 CGO_ENABLED=0 交叉编译
// ============================================================

// StoreDB 全局 SQLite 数据库实例
var storeDB *sql.DB
var storeDBOnce sync.Once
var storeDBMu sync.Mutex // 保护 storeDB 写操作（WAL 模式下读不互斥，但写仍需要串行化）

// getStoreDBPath 获取 SQLite 数据库文件路径
func getStoreDBPath() string {
	exePath, err := os.Executable()
	if err != nil {
		log.Printf("[存储] 获取可执行文件路径失败: %v", err)
		return "data/data-store.db"
	}
	return filepath.Join(filepath.Dir(exePath), "data", "data-store.db")
}

// initStoreDB 初始化 SQLite 数据库，创建表结构
func initStoreDB() error {
	dbPath := getStoreDBPath()

	// 确保目录存在
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("[存储] 创建目录失败: %v", err)
	}

	// WAL 模式 + busy_timeout + synchronous=NORMAL
	dsn := dbPath + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)"

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return fmt.Errorf("[存储] 打开 SQLite 失败: %v", err)
	}

	// WAL 模式允许并发读写，写者串行化
	db.SetMaxOpenConns(2) // 1 写 + 1 读
	db.SetMaxIdleConns(2)

	// 初始化表结构
	if err := createStoreTables(db); err != nil {
		db.Close()
		return fmt.Errorf("[存储] 初始化表结构失败: %v", err)
	}

	storeDB = db
	log.Printf("[存储] SQLite 数据库初始化成功: %s", dbPath)
	return nil
}

// createStoreTables 创建所有业务表
func createStoreTables(db *sql.DB) error {
	stmts := []string{
		// 用户表
		`CREATE TABLE IF NOT EXISTS users (
			username TEXT PRIMARY KEY,
            password TEXT NOT NULL,
            token TEXT DEFAULT '',
            tokens TEXT DEFAULT '[]',
            token_entries TEXT DEFAULT '[]',
            api_key TEXT DEFAULT '',
            settings TEXT DEFAULT '{}',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// 数据库连接配置
		`CREATE TABLE IF NOT EXISTS databases (
            id TEXT PRIMARY KEY,
            owner TEXT DEFAULT 'admin',
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            host TEXT DEFAULT '',
            port INTEGER DEFAULT 0,
            user TEXT DEFAULT '',
            password TEXT DEFAULT '',
            database TEXT DEFAULT '',
            path TEXT DEFAULT '',
            options TEXT DEFAULT '{}',
            relations TEXT DEFAULT '[]',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// API 接口配置
		`CREATE TABLE IF NOT EXISTS apis (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT DEFAULT '',
            method TEXT DEFAULT 'GET',
            type TEXT DEFAULT 'query',
            database_id TEXT DEFAULT '',
            sql TEXT DEFAULT '',
            forward_url TEXT DEFAULT '',
            description TEXT DEFAULT '',
            default_params TEXT DEFAULT '{}',
            enabled INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// AI 配置（单行表）
		`CREATE TABLE IF NOT EXISTS ai_config (
            id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            base_url TEXT DEFAULT '',
            api_key TEXT DEFAULT '',
            model TEXT DEFAULT '',
            timeout INTEGER DEFAULT 60,
            enable_function_call TEXT DEFAULT '',
            enable_thinking TEXT DEFAULT '',
            enable_streaming TEXT DEFAULT '',
            enable_json_mode TEXT DEFAULT '',
            context_window_override INTEGER DEFAULT 0,
            table_retrieval TEXT DEFAULT '{}',
            embedding TEXT DEFAULT '{}',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// AI 能力检测（单行表）
		`CREATE TABLE IF NOT EXISTS ai_capabilities (
            id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            capabilities TEXT DEFAULT '{}',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// MCP 配置（单行表）
		`CREATE TABLE IF NOT EXISTS mcp_config (
            id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            enabled INTEGER DEFAULT 0,
            safe_config TEXT DEFAULT '{}',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,

		// LLM 模型配置
		`CREATE TABLE IF NOT EXISTS llm_models (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT DEFAULT 'llm',
            provider TEXT DEFAULT '',
            url TEXT DEFAULT '',
            api_key TEXT DEFAULT '',
            model TEXT DEFAULT '',
            description TEXT DEFAULT '',
            enabled INTEGER DEFAULT 1,
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT '',
            extra TEXT DEFAULT '{}'
		)`,

		// 小模型配置
		`CREATE TABLE IF NOT EXISTS small_models (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            js_code TEXT DEFAULT '',
            database_id TEXT DEFAULT '',
            input_type TEXT DEFAULT 'text',
            accept_exts TEXT DEFAULT '',
            output_type TEXT DEFAULT 'text',
            enabled INTEGER DEFAULT 1,
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT '',
            extra TEXT DEFAULT '{}'
		)`,

		// 治理任务
		`CREATE TABLE IF NOT EXISTS governance_tasks (
            id TEXT PRIMARY KEY,
            owner TEXT DEFAULT 'admin',
            name TEXT NOT NULL,
            type TEXT DEFAULT 'interactive',
            description TEXT DEFAULT '',
            database_id TEXT DEFAULT '',
            cron_expr TEXT DEFAULT '',
            enabled INTEGER DEFAULT 0,
            input_type TEXT DEFAULT '',
            accept_exts TEXT DEFAULT '[]',
            register_as_api INTEGER DEFAULT 0,
            api_path TEXT DEFAULT '',
            api_method TEXT DEFAULT '',
            file_batch_mode TEXT DEFAULT '',
            runtime TEXT DEFAULT '',
            run_mode TEXT DEFAULT '',
            execution_mode TEXT DEFAULT '',
            example_files TEXT DEFAULT '[]',
            js_code TEXT DEFAULT '',
            config TEXT DEFAULT '{}',
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT '',
            share_enabled INTEGER DEFAULT 0,
            share_token TEXT DEFAULT ''
		)`,

		// 治理任务日志
		`CREATE TABLE IF NOT EXISTS governance_task_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            run_id TEXT DEFAULT '',
            log_data TEXT DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_task_logs_task ON governance_task_logs(task_id)`,

		// 分享执行记录
		`CREATE TABLE IF NOT EXISTS share_runs (
            share_token TEXT NOT NULL,
            run_id TEXT NOT NULL,
            run_data TEXT DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (share_token, run_id)
		)`,

		// 迁移标记表
		`CREATE TABLE IF NOT EXISTS migration_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
		)`,

		// AI 会话记录（账号持久化）
		`CREATE TABLE IF NOT EXISTS ai_sessions (
            id TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            title TEXT DEFAULT '',
            mode TEXT DEFAULT 'cluster',
            messages TEXT DEFAULT '[]',
            databases TEXT DEFAULT '[]',
            modules TEXT DEFAULT '[]',
            history TEXT DEFAULT '[]',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_ai_sessions_owner ON ai_sessions(owner)`,

		// 应用广场
		`CREATE TABLE IF NOT EXISTS apps (
            id TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            title TEXT DEFAULT '',
            description TEXT DEFAULT '',
            icon TEXT DEFAULT '',
            html TEXT DEFAULT '',
            css TEXT DEFAULT '',
            js TEXT DEFAULT '',
            files TEXT DEFAULT '[]',
            config TEXT DEFAULT '{}',
            tags TEXT DEFAULT '[]',
            is_public INTEGER DEFAULT 0,
            view_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_apps_owner ON apps(owner)`,
		`CREATE INDEX IF NOT EXISTS idx_apps_slug ON apps(slug)`,

		// Agent 运行记录
		`CREATE TABLE IF NOT EXISTS agent_runs (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            username TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running',
            error_message TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id)`,
		`CREATE INDEX IF NOT EXISTS idx_agent_runs_username ON agent_runs(username)`,

		// Agent 事件流
		`CREATE TABLE IF NOT EXISTS agent_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            event_data TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_agent_events_run_seq ON agent_events(run_id, seq)`,
	}

	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("[存储] 创建表失败: %s\n语句: %s", err, stmt)
		}
	}
	return nil
}

// ============================================================
// 辅助函数
// ============================================================

// boolToText *bool → TEXT (""/true/false)
func boolToText(b *bool) string {
	if b == nil {
		return ""
	}
	if *b {
		return "true"
	}
	return "false"
}

// textToBool TEXT → *bool
func textToBool(s string) *bool {
	switch s {
	case "true":
		v := true
		return &v
	case "false":
		v := false
		return &v
	default:
		return nil
	}
}

// toJSON 将任意值序列化为 JSON 字符串
func toJSON(v interface{}) string {
	if v == nil {
		return ""
	}
	b, err := json.Marshal(v)
	if err != nil {
		log.Printf("[存储] JSON 序列化失败: %v", err)
		return ""
	}
	return string(b)
}

// ============================================================
// Users CRUD
// ============================================================

func sqlSaveUsers(users map[string]*User) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	tx, err := storeDB.Begin()
	if err != nil {
		return fmt.Errorf("[存储] 开启事务失败: %v", err)
	}
	defer tx.Rollback()

	// 清空后全量写入
	if _, err := tx.Exec("DELETE FROM users"); err != nil {
		return fmt.Errorf("[存储] 清空 users 失败: %v", err)
	}

	for _, u := range users {
		if u == nil {
			continue
		}
		_, err := tx.Exec(`INSERT OR REPLACE INTO users (username, password, token, tokens, token_entries, api_key, settings) VALUES (?,?,?,?,?,?,?)`,
			u.Username, u.Password, u.Token, toJSON(u.Tokens), toJSON(u.TokenEntries), u.ApiKey, toJSON(u.Settings))
		if err != nil {
			log.Printf("[存储] 写入用户 %s 失败: %v", u.Username, err)
		}
	}
	return tx.Commit()
}

func sqlLoadUsers() (map[string]*User, error) {
	rows, err := storeDB.Query(`SELECT username, password, token, tokens, token_entries, api_key, settings FROM users`)
	if err != nil {
		return nil, fmt.Errorf("[存储] 查询 users 失败: %v", err)
	}
	defer rows.Close()

	result := make(map[string]*User)
	for rows.Next() {
		u := &User{}
		var tokensJSON, tokenEntriesJSON, settingsJSON string
		if err := rows.Scan(&u.Username, &u.Password, &u.Token, &tokensJSON, &tokenEntriesJSON, &u.ApiKey, &settingsJSON); err != nil {
			log.Printf("[存储] 扫描用户行失败: %v", err)
			continue
		}
		if tokensJSON != "" && tokensJSON != "[]" {
			json.Unmarshal([]byte(tokensJSON), &u.Tokens)
		}
		if tokenEntriesJSON != "" && tokenEntriesJSON != "[]" {
			json.Unmarshal([]byte(tokenEntriesJSON), &u.TokenEntries)
		}
		if settingsJSON != "" && settingsJSON != "{}" {
			json.Unmarshal([]byte(settingsJSON), &u.Settings)
		}
		result[u.Username] = u
	}
	return result, nil
}

// ============================================================
// Databases CRUD
// ============================================================

func sqlSaveDatabases(dbs map[string]*DatabaseConfig) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	tx, err := storeDB.Begin()
	if err != nil {
		return fmt.Errorf("[存储] 开启事务失败: %v", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM databases"); err != nil {
		return fmt.Errorf("[存储] 清空 databases 失败: %v", err)
	}

	for _, d := range dbs {
		if d == nil {
			continue
		}
		_, err := tx.Exec(`INSERT OR REPLACE INTO databases (id, owner, type, name, host, port, user, password, database, path, options, relations) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
			d.ID, d.Owner, d.Type, d.Name, d.Host, d.Port, d.User, d.Password, d.Database, d.Path, "{}", toJSON(d.Relations))
		if err != nil {
			log.Printf("[存储] 写入数据库配置 %s 失败: %v", d.ID, err)
		}
	}
	return tx.Commit()
}

func sqlLoadDatabases() (map[string]*DatabaseConfig, error) {
	rows, err := storeDB.Query(`SELECT id, owner, type, name, host, port, user, password, database, path, options, relations FROM databases`)
	if err != nil {
		return nil, fmt.Errorf("[存储] 查询 databases 失败: %v", err)
	}
	defer rows.Close()

	result := make(map[string]*DatabaseConfig)
	for rows.Next() {
		d := &DatabaseConfig{}
		var relationsJSON string
		if err := rows.Scan(&d.ID, &d.Owner, &d.Type, &d.Name, &d.Host, &d.Port, &d.User, &d.Password, &d.Database, &d.Path, new(string), &relationsJSON); err != nil {
			log.Printf("[存储] 扫描数据库行失败: %v", err)
			continue
		}
		if relationsJSON != "" && relationsJSON != "[]" {
			json.Unmarshal([]byte(relationsJSON), &d.Relations)
		}
		result[d.ID] = d
	}
	return result, nil
}

// ============================================================
// Apis CRUD
// ============================================================

func sqlSaveApis(apis map[string]*ApiConfig) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	tx, err := storeDB.Begin()
	if err != nil {
		return fmt.Errorf("[存储] 开启事务失败: %v", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM apis"); err != nil {
		return fmt.Errorf("[存储] 清空 apis 失败: %v", err)
	}

	for _, a := range apis {
		if a == nil {
			continue
		}
		enabledInt := 1
		if a.Enabled != nil && !*a.Enabled {
			enabledInt = 0
		}
		_, err := tx.Exec(`INSERT OR REPLACE INTO apis (id, name, path, method, type, database_id, sql, forward_url, description, default_params, enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
			a.ID, a.Name, a.Path, a.Method, a.Type, a.DatabaseID, a.SQL, a.ForwardURL, a.Description, toJSON(a.DefaultParams), enabledInt)
		if err != nil {
			log.Printf("[存储] 写入接口 %s 失败: %v", a.ID, err)
		}
	}
	return tx.Commit()
}

func sqlLoadApis() (map[string]*ApiConfig, error) {
	rows, err := storeDB.Query(`SELECT id, name, path, method, type, database_id, sql, forward_url, description, default_params, enabled FROM apis`)
	if err != nil {
		return nil, fmt.Errorf("[存储] 查询 apis 失败: %v", err)
	}
	defer rows.Close()

	result := make(map[string]*ApiConfig)
	for rows.Next() {
		a := &ApiConfig{}
		var enabledInt int
		var paramsJSON string
		if err := rows.Scan(&a.ID, &a.Name, &a.Path, &a.Method, &a.Type, &a.DatabaseID, &a.SQL, &a.ForwardURL, &a.Description, &paramsJSON, &enabledInt); err != nil {
			log.Printf("[存储] 扫描接口行失败: %v", err)
			continue
		}
		if paramsJSON != "" && paramsJSON != "{}" {
			json.Unmarshal([]byte(paramsJSON), &a.DefaultParams)
		}
		if enabledInt == 0 {
			f := false
			a.Enabled = &f
		} else if enabledInt == 1 {
			t := true
			a.Enabled = &t
		}
		result[a.ID] = a
	}
	return result, nil
}

// ============================================================
// AIConfig CRUD（单行表）
// ============================================================

func sqlSaveAIConfig(cfg *AIConfig) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	if cfg == nil {
		return nil
	}
	_, err := storeDB.Exec(`INSERT OR REPLACE INTO ai_config (id, base_url, api_key, model, timeout, enable_function_call, enable_thinking, enable_streaming, enable_json_mode, context_window_override, table_retrieval, embedding) VALUES (1,?,?,?,?,?,?,?,?,?,?,?)`,
		cfg.URL, cfg.APIKey, cfg.Model, cfg.Timeout,
		boolToText(cfg.EnableFunctionCall), boolToText(cfg.EnableThinking), boolToText(cfg.EnableStreaming), boolToText(cfg.EnableJSONMode),
		cfg.ContextWindowOverride, toJSON(cfg.TableRetrieval), toJSON(cfg.Embedding))
	if err != nil {
		return fmt.Errorf("[存储] 写入 ai_config 失败: %v", err)
	}
	return nil
}

func sqlLoadAIConfig() (*AIConfig, error) {
	row := storeDB.QueryRow(`SELECT base_url, api_key, model, timeout, enable_function_call, enable_thinking, enable_streaming, enable_json_mode, context_window_override, table_retrieval, embedding FROM ai_config WHERE id = 1`)

	var cfg AIConfig
	var baseURL, apiKey, model string
	var timeout int
	var enableFC, enableThink, enableStream, enableJSON string
	var ctxWindowOverride int
	var tableRetrievalJSON, embeddingJSON string

	err := row.Scan(&baseURL, &apiKey, &model, &timeout, &enableFC, &enableThink, &enableStream, &enableJSON, &ctxWindowOverride, &tableRetrievalJSON, &embeddingJSON)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("[存储] 查询 ai_config 失败: %v", err)
	}

	cfg.URL = baseURL
	cfg.APIKey = apiKey
	cfg.Model = model
	cfg.Timeout = timeout
	cfg.EnableFunctionCall = textToBool(enableFC)
	cfg.EnableThinking = textToBool(enableThink)
	cfg.EnableStreaming = textToBool(enableStream)
	cfg.EnableJSONMode = textToBool(enableJSON)
	cfg.ContextWindowOverride = ctxWindowOverride
	if tableRetrievalJSON != "" && tableRetrievalJSON != "{}" {
		json.Unmarshal([]byte(tableRetrievalJSON), &cfg.TableRetrieval)
	}
	if embeddingJSON != "" && embeddingJSON != "{}" {
		json.Unmarshal([]byte(embeddingJSON), &cfg.Embedding)
	}
	return &cfg, nil
}

// ============================================================
// AICapabilities CRUD（单行表）
// ============================================================

func sqlSaveAICapabilities(cap *AICapabilities) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	if cap == nil {
		return nil
	}
	_, err := storeDB.Exec(`INSERT OR REPLACE INTO ai_capabilities (id, capabilities) VALUES (1, ?)`, toJSON(cap))
	if err != nil {
		return fmt.Errorf("[存储] 写入 ai_capabilities 失败: %v", err)
	}
	return nil
}

func sqlLoadAICapabilities() (*AICapabilities, error) {
	row := storeDB.QueryRow(`SELECT capabilities FROM ai_capabilities WHERE id = 1`)
	var capJSON string
	err := row.Scan(&capJSON)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("[存储] 查询 ai_capabilities 失败: %v", err)
	}
	var cap AICapabilities
	if capJSON != "" && capJSON != "{}" {
		if err := json.Unmarshal([]byte(capJSON), &cap); err != nil {
			log.Printf("[存储] 解析 ai_capabilities JSON 失败: %v", err)
			return nil, nil
		}
	}
	return &cap, nil
}

// ============================================================
// MCPConfig CRUD（单行表）
// ============================================================

func sqlSaveMCPConfig(enabled *bool, safeConfig *MCPSafeConfig) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	// *bool → INTEGER: nil(默认true)→0, &true→1, &false→-1
	enabledInt := 0 // nil → 默认启用
	if enabled != nil {
		if *enabled {
			enabledInt = 1
		} else {
			enabledInt = -1
		}
	}

	_, err := storeDB.Exec(`INSERT OR REPLACE INTO mcp_config (id, enabled, safe_config) VALUES (1, ?, ?)`, enabledInt, toJSON(safeConfig))
	if err != nil {
		return fmt.Errorf("[存储] 写入 mcp_config 失败: %v", err)
	}
	return nil
}

func sqlLoadMCPConfig() (*bool, *MCPSafeConfig, error) {
	row := storeDB.QueryRow(`SELECT enabled, safe_config FROM mcp_config WHERE id = 1`)
	var enabledInt int
	var safeConfigJSON string
	err := row.Scan(&enabledInt, &safeConfigJSON)
	if err == sql.ErrNoRows {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("[存储] 查询 mcp_config 失败: %v", err)
	}

	// INTEGER → *bool: 0→nil(默认true), 1→&true, -1→&false
	var mcpEnabled *bool
	switch enabledInt {
	case 1:
		v := true
		mcpEnabled = &v
	case -1:
		v := false
		mcpEnabled = &v
	default:
		mcpEnabled = nil // nil 视为 true
	}

	var safeConfig MCPSafeConfig
	if safeConfigJSON != "" && safeConfigJSON != "{}" {
		json.Unmarshal([]byte(safeConfigJSON), &safeConfig)
	}
	return mcpEnabled, &safeConfig, nil
}

// ============================================================
// LLMModels CRUD
// ============================================================

func sqlSaveLLMModels(models map[string]*LLMModelConfig) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	tx, err := storeDB.Begin()
	if err != nil {
		return fmt.Errorf("[存储] 开启事务失败: %v", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM llm_models"); err != nil {
		return fmt.Errorf("[存储] 清空 llm_models 失败: %v", err)
	}

	for _, m := range models {
		if m == nil {
			continue
		}
		enabledInt := 0
		if m.Enabled {
			enabledInt = 1
		}
		_, err := tx.Exec(`INSERT OR REPLACE INTO llm_models (id, name, type, provider, url, api_key, model, description, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
			m.ID, m.Name, m.Type, m.Provider, m.URL, m.APIKey, m.Model, m.Description, enabledInt, m.CreatedAt, m.UpdatedAt)
		if err != nil {
			log.Printf("[存储] 写入大模型 %s 失败: %v", m.ID, err)
		}
	}
	return tx.Commit()
}

func sqlLoadLLMModels() (map[string]*LLMModelConfig, error) {
	rows, err := storeDB.Query(`SELECT id, name, type, provider, url, api_key, model, description, enabled, created_at, updated_at FROM llm_models`)
	if err != nil {
		return nil, fmt.Errorf("[存储] 查询 llm_models 失败: %v", err)
	}
	defer rows.Close()

	result := make(map[string]*LLMModelConfig)
	for rows.Next() {
		m := &LLMModelConfig{}
		var enabledInt int
		if err := rows.Scan(&m.ID, &m.Name, &m.Type, &m.Provider, &m.URL, &m.APIKey, &m.Model, &m.Description, &enabledInt, &m.CreatedAt, &m.UpdatedAt); err != nil {
			log.Printf("[存储] 扫描大模型行失败: %v", err)
			continue
		}
		m.Enabled = enabledInt == 1
		result[m.ID] = m
	}
	return result, nil
}

// ============================================================
// SmallModels CRUD
// ============================================================

func sqlSaveSmallModels(models map[string]*SmallModelConfig) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	tx, err := storeDB.Begin()
	if err != nil {
		return fmt.Errorf("[存储] 开启事务失败: %v", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM small_models"); err != nil {
		return fmt.Errorf("[存储] 清空 small_models 失败: %v", err)
	}

	for _, m := range models {
		if m == nil {
			continue
		}
		enabledInt := 0
		if m.Enabled {
			enabledInt = 1
		}
		_, err := tx.Exec(`INSERT OR REPLACE INTO small_models (id, name, description, js_code, database_id, input_type, accept_exts, output_type, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
			m.ID, m.Name, m.Description, m.JsCode, m.DatabaseID, m.InputType, m.AcceptExts, m.OutputType, enabledInt, m.CreatedAt, m.UpdatedAt)
		if err != nil {
			log.Printf("[存储] 写入小模型 %s 失败: %v", m.ID, err)
		}
	}
	return tx.Commit()
}

func sqlLoadSmallModels() (map[string]*SmallModelConfig, error) {
	rows, err := storeDB.Query(`SELECT id, name, description, js_code, database_id, input_type, accept_exts, output_type, enabled, created_at, updated_at FROM small_models`)
	if err != nil {
		return nil, fmt.Errorf("[存储] 查询 small_models 失败: %v", err)
	}
	defer rows.Close()

	result := make(map[string]*SmallModelConfig)
	for rows.Next() {
		m := &SmallModelConfig{}
		var enabledInt int
		if err := rows.Scan(&m.ID, &m.Name, &m.Description, &m.JsCode, &m.DatabaseID, &m.InputType, &m.AcceptExts, &m.OutputType, &enabledInt, &m.CreatedAt, &m.UpdatedAt); err != nil {
			log.Printf("[存储] 扫描小模型行失败: %v", err)
			continue
		}
		m.Enabled = enabledInt == 1
		result[m.ID] = m
	}
	return result, nil
}

// ============================================================
// GovernanceTasks CRUD
// ============================================================

// governanceTaskConfig 运行时状态，存为 JSON 列
type governanceTaskConfig struct {
	Status        string `json:"status,omitempty"`
	LastOutput    string `json:"last_output,omitempty"`
	LastError     string `json:"last_error,omitempty"`
	LastRunAt     string `json:"last_run_at,omitempty"`
	RunID         string `json:"run_id,omitempty"`
	TotalFiles    int    `json:"total_files,omitempty"`
	ProcessedFiles int   `json:"processed_files,omitempty"`
	Percent       int    `json:"percent,omitempty"`
	CurrentFile   string `json:"current_file,omitempty"`
	StartedAt     string `json:"started_at,omitempty"`
}

func sqlSaveGovernanceTasks(tasks map[string]*GovernanceTask) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	tx, err := storeDB.Begin()
	if err != nil {
		return fmt.Errorf("[存储] 开启事务失败: %v", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM governance_tasks"); err != nil {
		return fmt.Errorf("[存储] 清空 governance_tasks 失败: %v", err)
	}

	for _, t := range tasks {
		if t == nil {
			continue
		}
		enabledInt := 0
		if t.Enabled {
			enabledInt = 1
		}
		registerAsAPIInt := 0
		if t.RegisterAsAPI {
			registerAsAPIInt = 1
		}
		shareEnabledInt := 0
		if t.ShareEnabled {
			shareEnabledInt = 1
		}
		// 运行时状态打包为 JSON
		config := governanceTaskConfig{
			Status:        t.Status,
			LastOutput:    t.LastOutput,
			LastError:     t.LastError,
			LastRunAt:     t.LastRunAt,
			RunID:         t.RunID,
			TotalFiles:    t.TotalFiles,
			ProcessedFiles: t.ProcessedFiles,
			Percent:       t.Percent,
			CurrentFile:   t.CurrentFile,
			StartedAt:     t.StartedAt,
		}

		_, err := tx.Exec(`INSERT OR REPLACE INTO governance_tasks (id, owner, name, type, description, database_id, cron_expr, enabled, input_type, accept_exts, register_as_api, api_path, api_method, file_batch_mode, runtime, run_mode, execution_mode, example_files, js_code, config, created_at, updated_at, share_enabled, share_token) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			t.ID, t.Owner, t.Name, t.Type, t.Description, t.DatabaseID, t.CronExpr, enabledInt,
			t.InputType, toJSON(t.AcceptExts), registerAsAPIInt, t.APIPath, t.APIMethod, t.FileBatchMode,
			t.Runtime, t.RunMode, t.ExecutionMode, toJSON(t.ExampleFiles), t.JsCode, toJSON(config),
			t.CreatedAt, t.UpdatedAt, shareEnabledInt, t.ShareToken)
		if err != nil {
			log.Printf("[存储] 写入治理任务 %s 失败: %v", t.ID, err)
		}
	}
	return tx.Commit()
}

func sqlLoadGovernanceTasks() (map[string]*GovernanceTask, error) {
	rows, err := storeDB.Query(`SELECT id, owner, name, type, description, database_id, cron_expr, enabled, input_type, accept_exts, register_as_api, api_path, api_method, file_batch_mode, runtime, run_mode, execution_mode, example_files, js_code, config, created_at, updated_at, share_enabled, share_token FROM governance_tasks`)
	if err != nil {
		return nil, fmt.Errorf("[存储] 查询 governance_tasks 失败: %v", err)
	}
	defer rows.Close()

	result := make(map[string]*GovernanceTask)
	for rows.Next() {
		t := &GovernanceTask{}
		var enabledInt, registerAsAPIInt, shareEnabledInt int
		var acceptExtsJSON, exampleFilesJSON, configJSON string

		if err := rows.Scan(&t.ID, &t.Owner, &t.Name, &t.Type, &t.Description, &t.DatabaseID, &t.CronExpr, &enabledInt,
			&t.InputType, &acceptExtsJSON, &registerAsAPIInt, &t.APIPath, &t.APIMethod, &t.FileBatchMode,
			&t.Runtime, &t.RunMode, &t.ExecutionMode, &exampleFilesJSON, &t.JsCode, &configJSON,
			&t.CreatedAt, &t.UpdatedAt, &shareEnabledInt, &t.ShareToken); err != nil {
			log.Printf("[存储] 扫描治理任务行失败: %v", err)
			continue
		}

		t.Enabled = enabledInt == 1
		t.RegisterAsAPI = registerAsAPIInt == 1
		t.ShareEnabled = shareEnabledInt == 1

		if acceptExtsJSON != "" && acceptExtsJSON != "[]" {
			json.Unmarshal([]byte(acceptExtsJSON), &t.AcceptExts)
		}
		if exampleFilesJSON != "" && exampleFilesJSON != "[]" {
			json.Unmarshal([]byte(exampleFilesJSON), &t.ExampleFiles)
		}
		// 解析运行时状态
		if configJSON != "" && configJSON != "{}" {
			var config governanceTaskConfig
			if err := json.Unmarshal([]byte(configJSON), &config); err == nil {
				t.Status = config.Status
				t.LastOutput = config.LastOutput
				t.LastError = config.LastError
				t.LastRunAt = config.LastRunAt
				t.RunID = config.RunID
				t.TotalFiles = config.TotalFiles
				t.ProcessedFiles = config.ProcessedFiles
				t.Percent = config.Percent
				t.CurrentFile = config.CurrentFile
				t.StartedAt = config.StartedAt
			}
		}
		result[t.ID] = t
	}
	return result, nil
}

// ============================================================
// GovernanceTaskLogs CRUD
// ============================================================

func sqlSaveGovernanceTaskLogs(logs map[string][]*GovernanceTaskLog) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	tx, err := storeDB.Begin()
	if err != nil {
		return fmt.Errorf("[存储] 开启事务失败: %v", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM governance_task_logs"); err != nil {
		return fmt.Errorf("[存储] 清空 governance_task_logs 失败: %v", err)
	}

	for taskID, taskLogs := range logs {
		for _, l := range taskLogs {
			if l == nil {
				continue
			}
			_, err := tx.Exec(`INSERT INTO governance_task_logs (task_id, run_id, log_data) VALUES (?,?,?)`,
				taskID, l.RunID, toJSON(l))
			if err != nil {
				log.Printf("[存储] 写入任务日志 %s/%s 失败: %v", taskID, l.ID, err)
			}
		}
	}
	return tx.Commit()
}

func sqlLoadGovernanceTaskLogs() (map[string][]*GovernanceTaskLog, error) {
	rows, err := storeDB.Query(`SELECT task_id, log_data FROM governance_task_logs`)
	if err != nil {
		return nil, fmt.Errorf("[存储] 查询 governance_task_logs 失败: %v", err)
	}
	defer rows.Close()

	result := make(map[string][]*GovernanceTaskLog)
	for rows.Next() {
		var taskID, logDataJSON string
		if err := rows.Scan(&taskID, &logDataJSON); err != nil {
			log.Printf("[存储] 扫描任务日志行失败: %v", err)
			continue
		}
		var l GovernanceTaskLog
		if logDataJSON != "" && logDataJSON != "{}" {
			if err := json.Unmarshal([]byte(logDataJSON), &l); err != nil {
				log.Printf("[存储] 解析任务日志 JSON 失败: %v", err)
				continue
			}
		}
		result[taskID] = append(result[taskID], &l)
	}
	return result, nil
}

// ============================================================
// ShareRuns CRUD
// ============================================================

func sqlSaveShareRuns(runs map[string]*GovernanceShareRun) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	tx, err := storeDB.Begin()
	if err != nil {
		return fmt.Errorf("[存储] 开启事务失败: %v", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM share_runs"); err != nil {
		return fmt.Errorf("[存储] 清空 share_runs 失败: %v", err)
	}

	for _, r := range runs {
		if r == nil {
			continue
		}
		_, err := tx.Exec(`INSERT OR REPLACE INTO share_runs (share_token, run_id, run_data) VALUES (?,?,?)`,
			r.ShareToken, r.ID, toJSON(r))
		if err != nil {
			log.Printf("[存储] 写入分享记录 %s/%s 失败: %v", r.ShareToken, r.ID, err)
		}
	}
	return tx.Commit()
}

func sqlLoadShareRuns() (map[string]*GovernanceShareRun, error) {
	rows, err := storeDB.Query(`SELECT share_token, run_id, run_data FROM share_runs`)
	if err != nil {
		return nil, fmt.Errorf("[存储] 查询 share_runs 失败: %v", err)
	}
	defer rows.Close()

	result := make(map[string]*GovernanceShareRun)
	for rows.Next() {
		var shareToken, runID, runDataJSON string
		if err := rows.Scan(&shareToken, &runID, &runDataJSON); err != nil {
			log.Printf("[存储] 扫描分享记录行失败: %v", err)
			continue
		}
		var r GovernanceShareRun
		if runDataJSON != "" && runDataJSON != "{}" {
			if err := json.Unmarshal([]byte(runDataJSON), &r); err != nil {
				log.Printf("[存储] 解析分享记录 JSON 失败: %v", err)
				continue
			}
		}
		result[runID] = &r
	}
	return result, nil
}

// ============================================================
// 全量保存 / 加载（替代 saveDataOntologyStore / loadDataOntologyStore）
// ============================================================

// sqlSaveAll 将内存中所有全局变量写入 SQLite
func sqlSaveAll() error {
	if storeDB == nil {
		return fmt.Errorf("[存储] SQLite 未初始化")
	}

	dataOntologyMu.RLock()
	governanceShareRunsMu.RLock()

	// 快照当前内存数据
	users := dataOntologyUsers
	dbs := dataOntologyDatabases
	apis := dataOntologyApis
	aiCfg := dataOntologyAIConfig
	aiCap := dataOntologyAICapabilities
	tasks := governanceTasks
	taskLogs := governanceTaskLogs
	mcpEnabled := dataOntologyMCPEnabled
	mcpSafeConfig := dataOntologyMCPSafeConfig
	llms := llmModels
	sms := smallModels
	shareRuns := governanceShareRuns

	governanceShareRunsMu.RUnlock()
	dataOntologyMu.RUnlock()

	// 依次写入各表（每个表内部有自己的锁和事务）
	if err := sqlSaveUsers(users); err != nil {
		log.Printf("[存储] 保存 users 失败: %v", err)
	}
	if err := sqlSaveDatabases(dbs); err != nil {
		log.Printf("[存储] 保存 databases 失败: %v", err)
	}
	if err := sqlSaveApis(apis); err != nil {
		log.Printf("[存储] 保存 apis 失败: %v", err)
	}
	if err := sqlSaveAIConfig(aiCfg); err != nil {
		log.Printf("[存储] 保存 ai_config 失败: %v", err)
	}
	if err := sqlSaveAICapabilities(aiCap); err != nil {
		log.Printf("[存储] 保存 ai_capabilities 失败: %v", err)
	}
	if err := sqlSaveMCPConfig(mcpEnabled, mcpSafeConfig); err != nil {
		log.Printf("[存储] 保存 mcp_config 失败: %v", err)
	}
	if err := sqlSaveLLMModels(llms); err != nil {
		log.Printf("[存储] 保存 llm_models 失败: %v", err)
	}
	if err := sqlSaveSmallModels(sms); err != nil {
		log.Printf("[存储] 保存 small_models 失败: %v", err)
	}
	if err := sqlSaveGovernanceTasks(tasks); err != nil {
		log.Printf("[存储] 保存 governance_tasks 失败: %v", err)
	}
	if err := sqlSaveGovernanceTaskLogs(taskLogs); err != nil {
		log.Printf("[存储] 保存 governance_task_logs 失败: %v", err)
	}
	if err := sqlSaveShareRuns(shareRuns); err != nil {
		log.Printf("[存储] 保存 share_runs 失败: %v", err)
	}

	log.Printf("[存储] 全量保存完成")
	return nil
}

// sqlLoadAll 从 SQLite 加载所有数据到内存全局变量
func sqlLoadAll() error {
	if storeDB == nil {
		return fmt.Errorf("[存储] SQLite 未初始化")
	}

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	users, err := sqlLoadUsers()
	if err != nil {
		return fmt.Errorf("[存储] 加载 users 失败: %v", err)
	}
	if users != nil {
		dataOntologyUsers = users
		log.Printf("[存储] 已加载 %d 个用户", len(users))
	}

	dbs, err := sqlLoadDatabases()
	if err != nil {
		return fmt.Errorf("[存储] 加载 databases 失败: %v", err)
	}
	if dbs != nil {
		dataOntologyDatabases = dbs
		log.Printf("[存储] 已加载 %d 个数据库配置", len(dbs))
	}

	apis, err := sqlLoadApis()
	if err != nil {
		return fmt.Errorf("[存储] 加载 apis 失败: %v", err)
	}
	if apis != nil {
		dataOntologyApis = apis
		log.Printf("[存储] 已加载 %d 个接口配置", len(apis))
	}

	aiCfg, err := sqlLoadAIConfig()
	if err != nil {
		return fmt.Errorf("[存储] 加载 ai_config 失败: %v", err)
	}
	if aiCfg != nil {
		dataOntologyAIConfig = aiCfg
		log.Printf("[存储] 已加载 AI 配置")
	}

	aiCap, err := sqlLoadAICapabilities()
	if err != nil {
		return fmt.Errorf("[存储] 加载 ai_capabilities 失败: %v", err)
	}
	if aiCap != nil {
		dataOntologyAICapabilities = aiCap
		log.Printf("[存储] 已加载 AI 能力检测结果")
	}

	mcpEnabled, mcpSafeConfig, err := sqlLoadMCPConfig()
	if err != nil {
		return fmt.Errorf("[存储] 加载 mcp_config 失败: %v", err)
	}
	dataOntologyMCPEnabled = mcpEnabled
	if mcpSafeConfig != nil {
		dataOntologyMCPSafeConfig = mcpSafeConfig
		dataOntologyMCPPort = mcpSafeConfig.Port
		log.Printf("[存储] 已加载 MCP 安全配置: port=%d", mcpSafeConfig.Port)
	}

	llms, err := sqlLoadLLMModels()
	if err != nil {
		return fmt.Errorf("[存储] 加载 llm_models 失败: %v", err)
	}
	if llms != nil {
		llmModels = llms
		log.Printf("[存储] 已加载 %d 个大模型配置", len(llms))
	}

	sms, err := sqlLoadSmallModels()
	if err != nil {
		return fmt.Errorf("[存储] 加载 small_models 失败: %v", err)
	}
	if sms != nil {
		smallModels = sms
		log.Printf("[存储] 已加载 %d 个小模型配置", len(sms))
	}

	tasks, err := sqlLoadGovernanceTasks()
	if err != nil {
		return fmt.Errorf("[存储] 加载 governance_tasks 失败: %v", err)
	}
	if tasks != nil {
		governanceTasks = tasks
		log.Printf("[存储] 已加载 %d 个治理任务", len(tasks))
	}

	taskLogs, err := sqlLoadGovernanceTaskLogs()
	if err != nil {
		return fmt.Errorf("[存储] 加载 governance_task_logs 失败: %v", err)
	}
	if taskLogs != nil {
		governanceTaskLogs = taskLogs
		log.Printf("[存储] 已加载治理任务日志")
	}

	governanceShareRunsMu.Lock()
	shareRuns, err := sqlLoadShareRuns()
	if err != nil {
		governanceShareRunsMu.Unlock()
		return fmt.Errorf("[存储] 加载 share_runs 失败: %v", err)
	}
	if shareRuns != nil {
		governanceShareRuns = shareRuns
		log.Printf("[存储] 已加载 %d 条分享任务执行记录", len(shareRuns))
	}
	governanceShareRunsMu.Unlock()

	// 向后兼容：Owner 为空时设为 admin
	for _, c := range dataOntologyDatabases {
		if c != nil && c.Owner == "" {
			c.Owner = "admin"
		}
	}
	for _, t := range governanceTasks {
		if t != nil && t.Owner == "" {
			t.Owner = "admin"
		}
	}
	// 向后兼容：旧 Token 迁移到 Tokens
	for _, user := range dataOntologyUsers {
		if user != nil && user.Token != "" {
			found := false
			for _, t := range user.Tokens {
				if t == user.Token {
					found = true
					break
				}
			}
			if !found {
				user.Tokens = append(user.Tokens, user.Token)
			}
		}
	}

	return nil
}

// ============================================================
// JSON → SQLite 自动迁移
// ============================================================

// isSQLiteEmpty 检查 SQLite 是否为空（没有任何业务数据）
func isSQLiteEmpty() bool {
	var count int
	row := storeDB.QueryRow("SELECT COUNT(*) FROM users")
	row.Scan(&count)
	if count > 0 {
		return false
	}
	row = storeDB.QueryRow("SELECT COUNT(*) FROM databases")
	row.Scan(&count)
	if count > 0 {
		return false
	}
	row = storeDB.QueryRow("SELECT COUNT(*) FROM governance_tasks")
	row.Scan(&count)
	return count == 0
}

// isJSONMigrated 检查是否已完成 JSON 迁移
func isJSONMigrated() bool {
	var value string
	row := storeDB.QueryRow("SELECT value FROM migration_meta WHERE key = 'json_migrated'")
	err := row.Scan(&value)
	if err != nil {
		return false
	}
	return value == "done"
}

// markJSONMigrated 标记 JSON 迁移完成
func markJSONMigrated() {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()
	storeDB.Exec("INSERT OR REPLACE INTO migration_meta (key, value) VALUES ('json_migrated', 'done')")
}

// migrateFromJSON 从 JSON 文件迁移数据到 SQLite
func migrateFromJSON() error {
	jsonPath := getDataOntologyStorePathFn()

	// 检查 JSON 文件是否存在
	if _, err := os.Stat(jsonPath); os.IsNotExist(err) {
		log.Printf("[存储] JSON 文件不存在，跳过迁移: %s", jsonPath)
		return nil
	}

	// 检查是否已迁移
	if isJSONMigrated() {
		log.Printf("[存储] JSON 迁移已完成，跳过")
		return nil
	}

	// 检查 SQLite 是否已有数据
	if !isSQLiteEmpty() {
		log.Printf("[存储] SQLite 已有数据，跳过 JSON 迁移")
		markJSONMigrated()
		return nil
	}

	log.Printf("[存储] 开始 JSON → SQLite 迁移: %s", jsonPath)

	// 读取 JSON 文件
	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return fmt.Errorf("[存储] 读取 JSON 文件失败: %v", err)
	}

	// 解析 JSON
	var store DataOntologyStore
	if err := json.Unmarshal(data, &store); err != nil {
		return fmt.Errorf("[存储] 解析 JSON 数据失败: %v", err)
	}

	// 写入 SQLite
	if store.Users != nil {
		if err := sqlSaveUsers(store.Users); err != nil {
			log.Printf("[存储] 迁移 users 失败: %v", err)
		}
		log.Printf("[存储] 迁移 %d 个用户", len(store.Users))
	}
	if store.Databases != nil {
		if err := sqlSaveDatabases(store.Databases); err != nil {
			log.Printf("[存储] 迁移 databases 失败: %v", err)
		}
		log.Printf("[存储] 迁移 %d 个数据库配置", len(store.Databases))
	}
	if store.Apis != nil {
		if err := sqlSaveApis(store.Apis); err != nil {
			log.Printf("[存储] 迁移 apis 失败: %v", err)
		}
		log.Printf("[存储] 迁移 %d 个接口配置", len(store.Apis))
	}
	if store.AIConfig != nil {
		if err := sqlSaveAIConfig(store.AIConfig); err != nil {
			log.Printf("[存储] 迁移 ai_config 失败: %v", err)
		}
	}
	if store.AICapabilities != nil {
		if err := sqlSaveAICapabilities(store.AICapabilities); err != nil {
			log.Printf("[存储] 迁移 ai_capabilities 失败: %v", err)
		}
	}
	if store.MCPEnabled != nil || store.MCPSafeConfig != nil {
		if err := sqlSaveMCPConfig(store.MCPEnabled, store.MCPSafeConfig); err != nil {
			log.Printf("[存储] 迁移 mcp_config 失败: %v", err)
		}
	}
	if store.LLMModels != nil {
		if err := sqlSaveLLMModels(store.LLMModels); err != nil {
			log.Printf("[存储] 迁移 llm_models 失败: %v", err)
		}
		log.Printf("[存储] 迁移 %d 个大模型配置", len(store.LLMModels))
	}
	if store.SmallModels != nil {
		if err := sqlSaveSmallModels(store.SmallModels); err != nil {
			log.Printf("[存储] 迁移 small_models 失败: %v", err)
		}
		log.Printf("[存储] 迁移 %d 个小模型配置", len(store.SmallModels))
	}
	if store.Tasks != nil {
		if err := sqlSaveGovernanceTasks(store.Tasks); err != nil {
			log.Printf("[存储] 迁移 governance_tasks 失败: %v", err)
		}
		log.Printf("[存储] 迁移 %d 个治理任务", len(store.Tasks))
	}
	if store.TaskLogs != nil {
		if err := sqlSaveGovernanceTaskLogs(store.TaskLogs); err != nil {
			log.Printf("[存储] 迁移 governance_task_logs 失败: %v", err)
		}
	}
	if store.ShareRuns != nil {
		// ShareRuns 是 map[shareToken]map[runID]*GovernanceShareRun，需要展平
		flatRuns := make(map[string]*GovernanceShareRun)
		for _, runs := range store.ShareRuns {
			for runID, run := range runs {
				flatRuns[runID] = run
			}
		}
		if err := sqlSaveShareRuns(flatRuns); err != nil {
			log.Printf("[存储] 迁移 share_runs 失败: %v", err)
		}
		log.Printf("[存储] 迁移 %d 条分享记录", len(flatRuns))
	}

	// 标记迁移完成
	markJSONMigrated()

	// 保留 JSON 文件作为备份（不删除）
	log.Printf("[存储] JSON → SQLite 迁移完成（JSON 文件保留作为备份）")
	return nil
}

// ============================================================
// 启动入口：初始化 SQLite + 自动迁移 + 加载数据
// ============================================================

// initStore 初始化存储层（在 main 中调用，替代原来的 loadDataOntologyStore）
func initStore() error {
	// 1. 初始化 SQLite
	if err := initStoreDB(); err != nil {
		return fmt.Errorf("[存储] 初始化 SQLite 失败: %v", err)
	}

	// 2. 自动迁移 JSON → SQLite（如果需要）
	if err := migrateFromJSON(); err != nil {
		log.Printf("[存储] JSON 迁移失败，尝试从 JSON 加载: %v", err)
		// 迁移失败，回退到 JSON 加载
		return loadDataOntologyStore()
	}

	// 3. 从 SQLite 加载数据到内存
	if err := sqlLoadAll(); err != nil {
		log.Printf("[存储] SQLite 加载失败，尝试从 JSON 加载: %v", err)
		return loadDataOntologyStore()
	}

	log.Printf("[存储] 数据加载完成（SQLite 模式）")
	return nil
}

// closeStore 关闭 SQLite 数据库
func closeStore() {
	if storeDB != nil {
		storeDB.Close()
		log.Printf("[存储] SQLite 数据库已关闭")
	}
}

// mergeFromDB 从另一个 SQLite 数据库读取数据合并到当前内存
// 用于 merge 模式的恢复操作
func mergeFromDB(otherDB *sql.DB) (map[string]interface{}, error) {
	stats := map[string]interface{}{
		"users_added":     0,
		"databases_added": 0,
		"apis_added":      0,
		"tasks_added":     0,
	}

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	// 合并用户
	rows, err := otherDB.Query("SELECT username, password, token, tokens, token_entries, api_key, settings FROM users")
	if err == nil {
		defer rows.Close()
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
			if _, exists := dataOntologyUsers[u.Username]; !exists {
				if u.Password != "" && !isBcryptHash(u.Password) {
					u.Password = hashPassword(u.Password)
				}
				dataOntologyUsers[u.Username] = &u
				stats["users_added"] = stats["users_added"].(int) + 1
			}
		}
	}

	// 合并数据库配置
	rows, err = otherDB.Query("SELECT id, owner, type, name, host, port, user, password, database, path, options, relations FROM databases")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var db DatabaseConfig
			var owner, optionsJSON, relationsJSON sql.NullString
			rows.Scan(&db.ID, &owner, &db.Type, &db.Name, &db.Host, &db.Port, &db.User, &db.Password, &db.Database, &db.Path, &optionsJSON, &relationsJSON)
			db.Owner = owner.String
			if relationsJSON.Valid && relationsJSON.String != "" {
				json.Unmarshal([]byte(relationsJSON.String), &db.Relations)
			}
			if _, exists := dataOntologyDatabases[db.ID]; !exists {
				dataOntologyDatabases[db.ID] = &db
				stats["databases_added"] = stats["databases_added"].(int) + 1
			}
		}
	}

	// 合并接口
	rows, err = otherDB.Query("SELECT id, name, database_id, config FROM apis")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, name, dbID string
			var configJSON sql.NullString
			rows.Scan(&id, &name, &dbID, &configJSON)
			if _, exists := dataOntologyApis[id]; !exists {
				api := &ApiConfig{ID: id, Name: name, DatabaseID: dbID}
				if configJSON.Valid && configJSON.String != "" {
					json.Unmarshal([]byte(configJSON.String), api)
				}
				api.ID = id
				api.Name = name
				api.DatabaseID = dbID
				dataOntologyApis[id] = api
				stats["apis_added"] = stats["apis_added"].(int) + 1
			}
		}
	}

	// 合并治理任务
	rows, err = otherDB.Query("SELECT id, name, config FROM governance_tasks")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, name string
			var configJSON sql.NullString
			rows.Scan(&id, &name, &configJSON)
			if _, exists := governanceTasks[id]; !exists {
				task := &GovernanceTask{ID: id, Name: name}
				if configJSON.Valid && configJSON.String != "" {
					json.Unmarshal([]byte(configJSON.String), task)
				}
				task.ID = id
				task.Name = name
				governanceTasks[id] = task
				stats["tasks_added"] = stats["tasks_added"].(int) + 1
			}
		}
	}

	log.Printf("[存储] 合并完成: %+v", stats)
	return stats, nil
}

// mergeFromDBWithModules 从另一个 SQLite 数据库读取数据合并到当前内存（支持模块过滤）
func mergeFromDBWithModules(otherDB *sql.DB, selectedModules map[string]bool, importAll bool) (map[string]interface{}, error) {
	stats := map[string]interface{}{
		"users_added":     0,
		"databases_added": 0,
		"apis_added":      0,
		"tasks_added":     0,
		"llm_models_added": 0,
		"small_models_added": 0,
		"share_runs_added": 0,
		"skipped_modules": []string{},
	}

	// 辅助函数：判断模块是否被选中
	moduleSelected := func(module string) bool {
		return importAll || selectedModules[module]
	}

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	// 合并用户
	if moduleSelected("users") {
		rows, err := otherDB.Query("SELECT username, password, token, tokens, token_entries, api_key, settings FROM users")
		if err == nil {
			defer rows.Close()
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
				if _, exists := dataOntologyUsers[u.Username]; !exists {
					if u.Password != "" && !isBcryptHash(u.Password) {
						u.Password = hashPassword(u.Password)
					}
					dataOntologyUsers[u.Username] = &u
					stats["users_added"] = stats["users_added"].(int) + 1
				}
			}
		}
	}

	// 合并数据库配置
	if moduleSelected("databases") {
		rows, err := otherDB.Query("SELECT id, owner, type, name, host, port, user, password, database, path, options, relations FROM databases")
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var db DatabaseConfig
				var owner, optionsJSON, relationsJSON sql.NullString
				rows.Scan(&db.ID, &owner, &db.Type, &db.Name, &db.Host, &db.Port, &db.User, &db.Password, &db.Database, &db.Path, &optionsJSON, &relationsJSON)
				db.Owner = owner.String
				if relationsJSON.Valid && relationsJSON.String != "" {
					json.Unmarshal([]byte(relationsJSON.String), &db.Relations)
				}
				if _, exists := dataOntologyDatabases[db.ID]; !exists {
					dataOntologyDatabases[db.ID] = &db
					stats["databases_added"] = stats["databases_added"].(int) + 1
				}
			}
		}
	}

	// 合并接口
	if moduleSelected("apis") {
		rows, err := otherDB.Query("SELECT id, name, database_id, config FROM apis")
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id, name, dbID string
				var configJSON sql.NullString
				rows.Scan(&id, &name, &dbID, &configJSON)
				if _, exists := dataOntologyApis[id]; !exists {
					api := &ApiConfig{ID: id, Name: name, DatabaseID: dbID}
					if configJSON.Valid && configJSON.String != "" {
						json.Unmarshal([]byte(configJSON.String), api)
					}
					api.ID = id
					api.Name = name
					api.DatabaseID = dbID
					dataOntologyApis[id] = api
					stats["apis_added"] = stats["apis_added"].(int) + 1
				}
			}
		}
	}

	// 合并治理任务
	if moduleSelected("governance_tasks") {
		rows, err := otherDB.Query("SELECT id, name, config FROM governance_tasks")
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id, name string
				var configJSON sql.NullString
				rows.Scan(&id, &name, &configJSON)
				if _, exists := governanceTasks[id]; !exists {
					task := &GovernanceTask{ID: id, Name: name}
					if configJSON.Valid && configJSON.String != "" {
						json.Unmarshal([]byte(configJSON.String), task)
					}
					task.ID = id
					task.Name = name
					governanceTasks[id] = task
					stats["tasks_added"] = stats["tasks_added"].(int) + 1
				}
			}
		}
	}

	// 合并 AI 配置
	if moduleSelected("ai_config") {
		var baseURL, apiKey, model sql.NullString
		var timeout, enableFC, enableThinking, enableStreaming, enableJSON, ctxWindow int
		var tableRetrieval, embeddingJSON sql.NullString
		row := otherDB.QueryRow("SELECT base_url, api_key, model, timeout, enable_function_call, enable_thinking, enable_streaming, enable_json_mode, context_window_override, table_retrieval, embedding FROM ai_config WHERE id = 1")
		if err := row.Scan(&baseURL, &apiKey, &model, &timeout, &enableFC, &enableThinking, &enableStreaming, &enableJSON, &ctxWindow, &tableRetrieval, &embeddingJSON); err == nil {
			if baseURL.String != "" || apiKey.String != "" || model.String != "" {
				dataOntologyAIConfig = &AIConfig{
					BaseURL: baseURL.String, ApiKey: apiKey.String, Model: model.String,
					Timeout: timeout, EnableFunctionCall: enableFC != 0, EnableThinking: enableThinking != 0,
					EnableStreaming: enableStreaming != 0, EnableJSONMode: enableJSON != 0,
					ContextWindowOverride: ctxWindow,
				}
				if tableRetrieval.Valid && tableRetrieval.String != "" {
					json.Unmarshal([]byte(tableRetrieval.String), &dataOntologyAIConfig.TableRetrieval)
				}
				if embeddingJSON.Valid && embeddingJSON.String != "" {
					json.Unmarshal([]byte(embeddingJSON.String), &dataOntologyAIConfig.Embedding)
				}
			}
		}
	}

	// 合并 AI 能力
	if moduleSelected("ai_capabilities") {
		var capJSON sql.NullString
		row := otherDB.QueryRow("SELECT capabilities FROM ai_capabilities WHERE id = 1")
		if err := row.Scan(&capJSON); err == nil && capJSON.Valid && capJSON.String != "" {
			var cap AICapabilities
			if json.Unmarshal([]byte(capJSON.String), &cap) == nil {
				dataOntologyAICapabilities = &cap
			}
		}
	}

	// 合并 MCP 配置
	if moduleSelected("mcp_config") {
		var enabledInt int
		var safeConfigJSON sql.NullString
		row := otherDB.QueryRow("SELECT enabled, safe_config FROM mcp_config WHERE id = 1")
		if err := row.Scan(&enabledInt, &safeConfigJSON); err == nil {
			enabled := enabledInt != 0
			dataOntologyMCPEnabled = &enabled
			if safeConfigJSON.Valid && safeConfigJSON.String != "" {
				var cfg MCPSafeConfig
				if json.Unmarshal([]byte(safeConfigJSON.String), &cfg) == nil {
					dataOntologyMCPSafeConfig = &cfg
					dataOntologyMCPPort = cfg.Port
				}
			}
		}
	}

	// 合并大模型配置
	if moduleSelected("llm_models") {
		rows, err := otherDB.Query("SELECT id, name, type, provider, url, api_key, model, description, enabled, created_at, updated_at FROM llm_models")
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var m LLMModelConfig
				var createdAt, updatedAt sql.NullString
				rows.Scan(&m.ID, &m.Name, &m.Type, &m.Provider, &m.URL, &m.ApiKey, &m.Model, &m.Description, &m.Enabled, &createdAt, &updatedAt)
				if _, exists := llmModels[m.ID]; !exists {
					m.CreatedAt = createdAt.String
					m.UpdatedAt = updatedAt.String
					llmModels[m.ID] = &m
					stats["llm_models_added"] = stats["llm_models_added"].(int) + 1
				}
			}
		}
	}

	// 合并小模型配置
	if moduleSelected("small_models") {
		rows, err := otherDB.Query("SELECT id, name, type, provider, url, api_key, model, description, enabled, created_at, updated_at FROM small_models")
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var m SmallModelConfig
				var createdAt, updatedAt sql.NullString
				rows.Scan(&m.ID, &m.Name, &m.Type, &m.Provider, &m.URL, &m.ApiKey, &m.Model, &m.Description, &m.Enabled, &createdAt, &updatedAt)
				if _, exists := smallModels[m.ID]; !exists {
					m.CreatedAt = createdAt.String
					m.UpdatedAt = updatedAt.String
					smallModels[m.ID] = &m
					stats["small_models_added"] = stats["small_models_added"].(int) + 1
				}
			}
		}
	}

	// 合并分享任务记录
	if moduleSelected("share_runs") {
		governanceShareRunsMu.Lock()
		rows, err := otherDB.Query("SELECT id, share_token, task_id, task_name, status, result, created_at, updated_at FROM share_runs")
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var sr GovernanceShareRun
				var updatedAt sql.NullString
				rows.Scan(&sr.ID, &sr.ShareToken, &sr.TaskID, &sr.TaskName, &sr.Status, &sr.Result, &sr.CreatedAt, &updatedAt)
				if _, exists := governanceShareRuns[sr.ID]; !exists {
					governanceShareRuns[sr.ID] = &sr
					stats["share_runs_added"] = stats["share_runs_added"].(int) + 1
				}
			}
		}
		governanceShareRunsMu.Unlock()
	}

	// 记录跳过的模块
	if !importAll {
		skipped := []string{}
		allModules := []string{"users", "databases", "apis", "governance_tasks", "ai_config", "ai_capabilities", "mcp_config", "llm_models", "small_models", "share_runs"}
		for _, m := range allModules {
			if !selectedModules[m] {
				skipped = append(skipped, m)
			}
		}
		stats["skipped_modules"] = skipped
	}

	log.Printf("[存储] 选择性合并完成: %+v", stats)
	return stats, nil
}

// ============================================================
// AI Sessions CRUD（账号持久化会话）
// ============================================================

type AISession struct {
	ID        string        `json:"id"`
	Owner     string        `json:"owner"`
	Title     string        `json:"title"`
	Mode      string        `json:"mode"`
	Messages  []AIMessage   `json:"messages"`
	Databases []string      `json:"databases"`
	Modules   []string      `json:"modules"`
	History   []HistoryEntry `json:"history"`
	CreatedAt time.Time     `json:"created_at"`
	UpdatedAt time.Time     `json:"updated_at"`
}

type AIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Mode    string `json:"mode,omitempty"` // cluster/fast
	Blocks  []AIMessageBlock `json:"blocks,omitempty"`
}

type AIMessageBlock struct {
	Type      string `json:"type"`               // text/code/api/sql
	Title     string `json:"title,omitempty"`     // 折叠块标题
	ClassName string `json:"className,omitempty"` // CSS class
	BodyHtml  string `json:"bodyHtml,omitempty"`  // 折叠块HTML内容
	Content   string `json:"content"`
	Status    string `json:"status,omitempty"`
}

type HistoryEntry struct {
	Role      string   `json:"role"`
	Content   string   `json:"content"`
	Databases []string `json:"databases,omitempty"`
	Modules   []string `json:"modules,omitempty"`
}

// sqlListAISessions 获取用户的所有会话
func sqlListAISessions(owner string) ([]AISession, error) {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	rows, err := storeDB.Query("SELECT id, title, mode, messages, databases, modules, history, created_at, updated_at FROM ai_sessions WHERE owner = ? ORDER BY updated_at DESC", owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []AISession
	for rows.Next() {
		var s AISession
		var messagesJSON, databasesJSON, modulesJSON, historyJSON sql.NullString
		var createdAt, updatedAt sql.NullString
		rows.Scan(&s.ID, &s.Title, &s.Mode, &messagesJSON, &databasesJSON, &modulesJSON, &historyJSON, &createdAt, &updatedAt)
		s.Owner = owner
		if messagesJSON.Valid && messagesJSON.String != "" {
			json.Unmarshal([]byte(messagesJSON.String), &s.Messages)
		}
		if databasesJSON.Valid && databasesJSON.String != "" {
			json.Unmarshal([]byte(databasesJSON.String), &s.Databases)
		}
		if modulesJSON.Valid && modulesJSON.String != "" {
			json.Unmarshal([]byte(modulesJSON.String), &s.Modules)
		}
		if historyJSON.Valid && historyJSON.String != "" {
			json.Unmarshal([]byte(historyJSON.String), &s.History)
		}
		if createdAt.Valid {
			s.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt.String)
		}
		if updatedAt.Valid {
			s.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt.String)
		}
		sessions = append(sessions, s)
	}
	return sessions, nil
}

// sqlGetAISession 获取单个会话
func sqlGetAISession(id, owner string) (*AISession, error) {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	var s AISession
	var messagesJSON, databasesJSON, modulesJSON, historyJSON sql.NullString
	var createdAt, updatedAt sql.NullString
	err := storeDB.QueryRow("SELECT id, title, mode, messages, databases, modules, history, created_at, updated_at FROM ai_sessions WHERE id = ? AND owner = ?", id, owner).Scan(&s.ID, &s.Title, &s.Mode, &messagesJSON, &databasesJSON, &modulesJSON, &historyJSON, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	s.Owner = owner
	if messagesJSON.Valid && messagesJSON.String != "" {
		json.Unmarshal([]byte(messagesJSON.String), &s.Messages)
	}
	if databasesJSON.Valid && databasesJSON.String != "" {
		json.Unmarshal([]byte(databasesJSON.String), &s.Databases)
	}
	if modulesJSON.Valid && modulesJSON.String != "" {
		json.Unmarshal([]byte(modulesJSON.String), &s.Modules)
	}
	if historyJSON.Valid && historyJSON.String != "" {
		json.Unmarshal([]byte(historyJSON.String), &s.History)
	}
	if createdAt.Valid {
		s.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt.String)
	}
	if updatedAt.Valid {
		s.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt.String)
	}
	return &s, nil
}

// sqlSaveAISession 创建或更新会话
func sqlSaveAISession(s *AISession) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	messagesJSON := toJSON(s.Messages)
	databasesJSON := toJSON(s.Databases)
	modulesJSON := toJSON(s.Modules)
	historyJSON := toJSON(s.History)
	now := time.Now().Format("2006-01-02 15:04:05")

	// 先尝试更新
	result, err := storeDB.Exec("UPDATE ai_sessions SET title=?, mode=?, messages=?, databases=?, modules=?, history=?, updated_at=? WHERE id=? AND owner=?",
		s.Title, s.Mode, messagesJSON, databasesJSON, modulesJSON, historyJSON, now, s.ID, s.Owner)
	if err != nil {
		return err
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		// 不存在则插入
		_, err = storeDB.Exec("INSERT INTO ai_sessions (id, owner, title, mode, messages, databases, modules, history, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			s.ID, s.Owner, s.Title, s.Mode, messagesJSON, databasesJSON, modulesJSON, historyJSON, now, now)
		if err != nil {
			return err
		}
	}
	return nil
}

// sqlDeleteAISession 删除会话
func sqlDeleteAISession(id, owner string) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	_, err := storeDB.Exec("DELETE FROM ai_sessions WHERE id = ? AND owner = ?", id, owner)
	return err
}

// ============================================================
// 应用广场
// ============================================================

type App struct {
	ID          string    `json:"id"`
	Owner       string    `json:"owner"`
	Name        string    `json:"name"`
	Slug        string    `json:"slug"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Icon        string    `json:"icon"`
	HTML        string    `json:"html"`
	CSS         string    `json:"css"`
	JS          string    `json:"js"`
	Files       []string  `json:"files"`
	Config      string    `json:"config"`
	Tags        []string  `json:"tags"`
	IsPublic    bool      `json:"is_public"`
	ViewCount   int       `json:"view_count"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// sqlListApps 获取用户的所有应用
func sqlListApps(owner string) ([]App, error) {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	rows, err := storeDB.Query("SELECT id, name, slug, title, description, icon, is_public, view_count, created_at, updated_at FROM apps WHERE owner = ? ORDER BY updated_at DESC", owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var apps []App
	for rows.Next() {
		var a App
		var createdAt, updatedAt sql.NullString
		var isPublic int
		rows.Scan(&a.ID, &a.Name, &a.Slug, &a.Title, &a.Description, &a.Icon, &isPublic, &a.ViewCount, &createdAt, &updatedAt)
		a.Owner = owner
		a.IsPublic = isPublic == 1
		if createdAt.Valid {
			a.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt.String)
		}
		if updatedAt.Valid {
			a.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt.String)
		}
		apps = append(apps, a)
	}
	return apps, nil
}

// sqlGetApp 获取单个应用（完整内容）
func sqlGetApp(id string) (*App, error) {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	var a App
	var filesJSON, tagsJSON sql.NullString
	var createdAt, updatedAt sql.NullString
	var isPublic int
	err := storeDB.QueryRow("SELECT id, owner, name, slug, title, description, icon, html, css, js, files, config, tags, is_public, view_count, created_at, updated_at FROM apps WHERE id = ?", id).Scan(
		&a.ID, &a.Owner, &a.Name, &a.Slug, &a.Title, &a.Description, &a.Icon, &a.HTML, &a.CSS, &a.JS, &filesJSON, &a.Config, &tagsJSON, &isPublic, &a.ViewCount, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	a.IsPublic = isPublic == 1
	if filesJSON.Valid && filesJSON.String != "" {
		json.Unmarshal([]byte(filesJSON.String), &a.Files)
	}
	if tagsJSON.Valid && tagsJSON.String != "" {
		json.Unmarshal([]byte(tagsJSON.String), &a.Tags)
	}
	if createdAt.Valid {
		a.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt.String)
	}
	if updatedAt.Valid {
		a.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt.String)
	}
	return &a, nil
}

// sqlGetAppBySlug 通过 slug 获取应用
func sqlGetAppBySlug(slug string) (*App, error) {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	var a App
	var filesJSON, tagsJSON sql.NullString
	var createdAt, updatedAt sql.NullString
	var isPublic int
	err := storeDB.QueryRow("SELECT id, owner, name, slug, title, description, icon, html, css, js, files, config, tags, is_public, view_count, created_at, updated_at FROM apps WHERE slug = ?", slug).Scan(
		&a.ID, &a.Owner, &a.Name, &a.Slug, &a.Title, &a.Description, &a.Icon, &a.HTML, &a.CSS, &a.JS, &filesJSON, &a.Config, &tagsJSON, &isPublic, &a.ViewCount, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	a.IsPublic = isPublic == 1
	if filesJSON.Valid && filesJSON.String != "" {
		json.Unmarshal([]byte(filesJSON.String), &a.Files)
	}
	if tagsJSON.Valid && tagsJSON.String != "" {
		json.Unmarshal([]byte(tagsJSON.String), &a.Tags)
	}
	if createdAt.Valid {
		a.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt.String)
	}
	if updatedAt.Valid {
		a.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt.String)
	}
	return &a, nil
}

// sqlSaveApp 创建或更新应用
func sqlSaveApp(a *App) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	filesJSON := toJSON(a.Files)
	tagsJSON := toJSON(a.Tags)
	now := time.Now().Format("2006-01-02 15:04:05")
	isPublic := 0
	if a.IsPublic {
		isPublic = 1
	}

	// 先尝试更新
	result, err := storeDB.Exec("UPDATE apps SET name=?, slug=?, title=?, description=?, icon=?, html=?, css=?, js=?, files=?, config=?, tags=?, is_public=?, updated_at=? WHERE id=? AND owner=?",
		a.Name, a.Slug, a.Title, a.Description, a.Icon, a.HTML, a.CSS, a.JS, filesJSON, a.Config, tagsJSON, isPublic, now, a.ID, a.Owner)
	if err != nil {
		return err
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		// 不存在则插入
		_, err = storeDB.Exec("INSERT INTO apps (id, owner, name, slug, title, description, icon, html, css, js, files, config, tags, is_public, view_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
			a.ID, a.Owner, a.Name, a.Slug, a.Title, a.Description, a.Icon, a.HTML, a.CSS, a.JS, filesJSON, a.Config, tagsJSON, isPublic, now, now)
		if err != nil {
			return err
		}
	}
	return nil
}

// sqlDeleteApp 删除应用
func sqlDeleteApp(id, owner string) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	_, err := storeDB.Exec("DELETE FROM apps WHERE id = ? AND owner = ?", id, owner)
	return err
}

// sqlIncrementAppViewCount 增加访问计数
func sqlIncrementAppViewCount(id string) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	_, err := storeDB.Exec("UPDATE apps SET view_count = view_count + 1 WHERE id = ?", id)
	return err
}

// ============================================================
// Agent Runs & Events CRUD
// ============================================================

// AgentRun 模型
type AgentRun struct {
	ID           string    `json:"id"`
	SessionID    string    `json:"session_id"`
	Username     string    `json:"username"`
	Status       string    `json:"status"` // running/completed/error/waiting_hitl
	ErrorMessage string    `json:"error_message,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// AgentEvent 模型
type AgentEvent struct {
	ID        int64     `json:"id"`
	RunID     string    `json:"run_id"`
	Seq       int       `json:"seq"`
	EventType string    `json:"event_type"`
	EventData string    `json:"event_data"` // JSON string
	CreatedAt time.Time `json:"created_at"`
}

// sqlCreateAgentRun 创建 Agent 运行记录
func sqlCreateAgentRun(run *AgentRun) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := storeDB.Exec(
		"INSERT INTO agent_runs (id, session_id, username, status, error_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		run.ID, run.SessionID, run.Username, run.Status, run.ErrorMessage, now, now,
	)
	if err != nil {
		log.Printf("[存储] 创建 AgentRun 失败: %v", err)
		return err
	}
	return nil
}

// sqlUpdateAgentRunStatus 更新 Agent 运行状态
func sqlUpdateAgentRunStatus(id, status, errorMessage string) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := storeDB.Exec(
		"UPDATE agent_runs SET status=?, error_message=?, updated_at=? WHERE id=?",
		status, errorMessage, now, id,
	)
	if err != nil {
		log.Printf("[存储] 更新 AgentRun 状态失败: %v", err)
		return err
	}
	return nil
}

// sqlAppendAgentEvent 追加 Agent 事件
func sqlAppendAgentEvent(runID string, seq int, eventType string, eventData string) error {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	_, err := storeDB.Exec(
		"INSERT INTO agent_events (run_id, seq, event_type, event_data) VALUES (?, ?, ?, ?)",
		runID, seq, eventType, eventData,
	)
	if err != nil {
		log.Printf("[存储] 追加 AgentEvent 失败: %v", err)
		return err
	}
	return nil
}

// sqlGetAgentRun 获取单个 Agent 运行记录
func sqlGetAgentRun(id string) (*AgentRun, error) {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	var run AgentRun
	var createdAt, updatedAt sql.NullString
	err := storeDB.QueryRow(
		"SELECT id, session_id, username, status, error_message, created_at, updated_at FROM agent_runs WHERE id = ?",
		id,
	).Scan(&run.ID, &run.SessionID, &run.Username, &run.Status, &run.ErrorMessage, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if createdAt.Valid {
		run.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt.String)
	}
	if updatedAt.Valid {
		run.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt.String)
	}
	return &run, nil
}

// sqlGetAgentEvents 获取指定 run 的事件列表（afterSeq 之后的）
func sqlGetAgentEvents(runID string, afterSeq int) ([]AgentEvent, error) {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	rows, err := storeDB.Query(
		"SELECT id, run_id, seq, event_type, event_data, created_at FROM agent_events WHERE run_id = ? AND seq > ? ORDER BY seq",
		runID, afterSeq,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []AgentEvent
	for rows.Next() {
		var evt AgentEvent
		var createdAt sql.NullString
		if err := rows.Scan(&evt.ID, &evt.RunID, &evt.Seq, &evt.EventType, &evt.EventData, &createdAt); err != nil {
			log.Printf("[存储] 扫描 AgentEvent 行失败: %v", err)
			continue
		}
		if createdAt.Valid {
			evt.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt.String)
		}
		events = append(events, evt)
	}
	return events, nil
}

// sqlListAgentRuns 列出 Agent 运行记录（按 session_id 和 status 过滤）
func sqlListAgentRuns(sessionID, status string) ([]AgentRun, error) {
	storeDBMu.Lock()
	defer storeDBMu.Unlock()

	query := "SELECT id, session_id, username, status, error_message, created_at, updated_at FROM agent_runs WHERE 1=1"
	var args []interface{}
	if sessionID != "" {
		query += " AND session_id = ?"
		args = append(args, sessionID)
	}
	if status != "" {
		// 支持逗号分隔的多状态查询
		statuses := strings.Split(status, ",")
		if len(statuses) > 1 {
			query += " AND status IN (?" + strings.Repeat(",?", len(statuses)-1) + ")"
			for _, s := range statuses {
				args = append(args, s)
			}
		} else {
			query += " AND status = ?"
			args = append(args, status)
		}
	}
	query += " ORDER BY created_at DESC LIMIT 50"

	rows, err := storeDB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var runs []AgentRun
	for rows.Next() {
		var run AgentRun
		var createdAt, updatedAt sql.NullString
		if err := rows.Scan(&run.ID, &run.SessionID, &run.Username, &run.Status, &run.ErrorMessage, &createdAt, &updatedAt); err != nil {
			log.Printf("[存储] 扫描 AgentRun 行失败: %v", err)
			continue
		}
		if createdAt.Valid {
			run.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt.String)
		}
		if updatedAt.Valid {
			run.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt.String)
		}
		runs = append(runs, run)
	}
	return runs, nil
}

package main

import (
	"database/sql"
	"github.com/YOUR_USERNAME/DataToolbox/agent"
	"github.com/gorilla/websocket"
	"net/http"
	"sync"
	"time"
)

var Version = "dev"

// 条件编译：仅在支持CGO时导入这些驱动
// SQLite, DuckDB, ClickHouse, Neo4j, Godror 需要CGO或特殊编译环境

// 应用配置常量

const (
	// WebSocket 配置
	WebSocketReadTimeout  = 60 * time.Second // WebSocket 读取超时
	WebSocketWriteTimeout = 10 * time.Second // WebSocket 写入超时
	WebSocketPingInterval = 54 * time.Second // WebSocket Ping 间隔

	// HTTP 客户端配置
	HTTPClientTimeout = 30 * time.Second // HTTP 客户端默认超时

	// SSH 配置
	SSHConnectTimeout  = 15 * time.Second // SSH 连接超时
	SFTPSessionTTL     = 30 * time.Minute // SFTP 会话过期时间
	SFTPCleanInterval  = 5 * time.Minute  // SFTP 会话清理间隔
	TokenCleanInterval = 1 * time.Hour    // 登录 token 清理间隔

	// 治理任务配置
	GovernanceSchedulerInterval = 30 * time.Second // 治理任务调度器检查间隔
	GovernanceJobQueueSize      = 100              // 治理任务队列大小

	// 数据库连接池默认配置
	DefaultDBMaxOpenConns = 10
	DefaultDBMaxIdleConns = 5
)

// Config 服务器配置

type Config struct {
	Port int    `json:"port"`
	Host string `json:"host"`
}

// WebSocket升级器

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // 允许所有来源
	},
}

// Client 客户端连接

type Client struct {
	ID   string
	Name string
	Conn *websocket.Conn
	Send chan []byte
}

// Hub 管理所有客户端连接

type Hub struct {
	clients    map[string]*Client
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

// Message WebSocket消息结构

type Message struct {
	Type        string      `json:"type"`
	ID          string      `json:"id,omitempty"`
	From        string      `json:"from,omitempty"`
	To          string      `json:"to,omitempty"`
	Name        string      `json:"name,omitempty"`
	Content     string      `json:"content,omitempty"`
	ContentType string      `json:"contentType,omitempty"`
	Timestamp   int64       `json:"timestamp,omitempty"`
	Peer        interface{} `json:"peer,omitempty"`
	Peers       interface{} `json:"peers,omitempty"`
	GameType    string      `json:"gameType,omitempty"`
	Move        interface{} `json:"move,omitempty"`
	Winner      string      `json:"winner,omitempty"`
}

var hub = &Hub{
	clients:    make(map[string]*Client),
	broadcast:  make(chan []byte),
	register:   make(chan *Client),
	unregister: make(chan *Client),
}

// ============================================================
// 数据库连接池管理器
// 用于复用数据库连接，避免每次请求都创建新连接
// ============================================================

// dbPool 全局数据库连接池

var dbPool = struct {
	sync.RWMutex
	connections map[string]*sql.DB // key: 数据库配置ID
}{
	connections: make(map[string]*sql.DB),
}

// columnCache 列信息缓存，避免每次查询都查两次表元信息
// key: "{dbID}:{tableName}" → cached column info
var columnCache = struct {
	sync.RWMutex
	entries map[string]*cachedColumns
}{
	entries: make(map[string]*cachedColumns),
}

type cachedColumns struct {
	BlobColumns map[string]bool // BLOB 列名
	AllColumns  []string        // 所有列名
	UpdatedAt   time.Time
}

const columnCacheTTL = 5 * time.Minute

// dbPoolConfig 连接池配置

const (
	maxOpenConns    = 10               // 最大打开连接数
	maxIdleConns    = 5                // 最大空闲连接数
	connMaxLifetime = 30 * time.Minute // 连接最大生命周期
	connMaxIdleTime = 5 * time.Minute  // 空闲连接最大存活时间
)

// getDBFromPool 从连接池获取数据库连接，如果不存在则创建

type TokenEntry struct {
	Token     string `json:"token"`
	CreatedAt int64  `json:"created_at"` // Unix 时间戳
}

// User 用户

type User struct {
	Username     string                 `json:"username"`
	Password     string                 `json:"password"`
	Token        string                 `json:"token,omitempty"`         // 已废弃：保留用于向后兼容，新登录会迁移到 Tokens
	Tokens       []string               `json:"tokens,omitempty"`        // 支持多 token 同时有效，避免新登录顶掉旧登录（简化版，不带时间戳）
	TokenEntries []TokenEntry           `json:"token_entries,omitempty"` // 可选：带时间戳的 token，支持过期清理
	ApiKey       string                 `json:"api_key,omitempty"`
	Settings     map[string]interface{} `json:"settings,omitempty"` // 用户设置（嵌入模式等）
}

// DatabaseConfig 数据库配置

type DatabaseConfig struct {
	ID        string             `json:"id"`
	Owner     string             `json:"owner,omitempty"` // 所属用户名
	Type      string             `json:"type"`            // mysql, postgresql, oracle, dm, sqlite, mongodb, elasticsearch, influxdb
	Name      string             `json:"name"`
	Host      string             `json:"host,omitempty"`
	Port      int                `json:"port,omitempty"`
	User      string             `json:"user,omitempty"`
	Password  string             `json:"password,omitempty"`
	Database  string             `json:"database,omitempty"`
	Path      string             `json:"path,omitempty"`      // for sqlite
	Relations []OntologyRelation `json:"relations,omitempty"` // 本体关系
}

// DatabaseInfo 数据库信息（不包含敏感信息）
// TableInfo 表信息（包含表名和备注）

type TableInfo struct {
	Name        string       `json:"name"`
	Schema      string       `json:"schema,omitempty"`      // 模式名（达梦/Oracle 等）
	Comment     string       `json:"comment,omitempty"`
	ColumnNames []string     `json:"column_names,omitempty"` // 用于表检索
	Columns     []ColumnInfo `json:"columns,omitempty"`      // 增强的字段信息（包含类型、注释、主键、外键）
}

type ColumnInfo struct {
	Name    string `json:"name"`
	Type    string `json:"type,omitempty"`
	Comment string `json:"comment,omitempty"`
	IsPK    bool   `json:"is_pk,omitempty"`
	IsFK    bool   `json:"is_fk,omitempty"`
	FKTable string `json:"fk_table,omitempty"` // 外键关联的表名
}

type DatabaseInfo struct {
	ID        string      `json:"id"`
	Owner     string      `json:"owner,omitempty"`
	Type      string      `json:"type"`
	Name      string      `json:"name"`
	Host      string      `json:"host,omitempty"`
	Port      int         `json:"port,omitempty"`
	User      string      `json:"user,omitempty"`
	Database  string      `json:"database,omitempty"`
	Path      string      `json:"path,omitempty"`
	Connected bool        `json:"connected"`
	Tables    []TableInfo `json:"tables,omitempty"`
}

// ApiConfig 接口配置

type ApiConfig struct {
	ID            string                 `json:"id"`
	Name          string                 `json:"name"`
	Path          string                 `json:"path"`
	Method        string                 `json:"method"`                // GET, POST, PUT, DELETE
	Type          string                 `json:"type,omitempty"`        // "query"(默认) | "forward"
	DatabaseID    string                 `json:"database_id,omitempty"` // query类型：关联的数据库ID
	SQL           string                 `json:"sql,omitempty"`         // query类型：MyBatis风格的SQL语句
	ForwardURL    string                 `json:"forward_url,omitempty"` // forward类型：转发目标URL
	Description   string                 `json:"description,omitempty"`
	DefaultParams map[string]interface{} `json:"default_params,omitempty"` // 默认参数值
	Enabled       *bool                  `json:"enabled,omitempty"`        // 是否启用，nil 视为 true
}

// ApiInfo 接口信息（包含数据库名称）

type ApiInfo struct {
	ID            string                 `json:"id"`
	Name          string                 `json:"name"`
	Path          string                 `json:"path"`
	Method        string                 `json:"method"`
	Type          string                 `json:"type"`
	DatabaseID    string                 `json:"database_id,omitempty"`
	DatabaseName  string                 `json:"database_name,omitempty"`
	SQL           string                 `json:"sql,omitempty"`
	ForwardURL    string                 `json:"forward_url,omitempty"`
	Description   string                 `json:"description,omitempty"`
	DefaultParams map[string]interface{} `json:"default_params,omitempty"`
	Enabled       bool                   `json:"enabled"` // 是否启用，供前端展示与开关
}

// Platform 平台定义（API 纳管）
type Platform struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	BaseURL     string            `json:"base_url"`
	Headers     map[string]string `json:"headers,omitempty"`
	AuthType    string            `json:"auth_type,omitempty"`   // "none" | "bearer" | "api_key" | "basic" | "custom"
	AuthConfig  map[string]string `json:"auth_config,omitempty"` // 认证配置
	Timeout     int               `json:"timeout,omitempty"`     // 超时秒数，默认30
	TLSVerify   *bool             `json:"tls_verify,omitempty"`  // TLS验证，默认false
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
}

// ParamDef 参数定义
type ParamDef struct {
	Name        string `json:"name"`
	Type        string `json:"type,omitempty"`        // "string" | "number" | "boolean"
	In          string `json:"in,omitempty"`          // "path" | "query" | "body" | "header"
	Required    bool   `json:"required,omitempty"`
	Description string `json:"description,omitempty"`
	Default     string `json:"default,omitempty"`
}

// ForwardApiConfig 转发接口定义（挂载在平台下）
type ForwardApiConfig struct {
	ID           string            `json:"id"`
	PlatformID   string            `json:"platform_id"`
	Name         string            `json:"name"`
	Method       string            `json:"method"`                // GET/POST/PUT/DELETE/PATCH
	Suffix       string            `json:"suffix"`                // 平台路径后缀，如 /open-apis/contact/v3/users/{user_id}
	Headers      map[string]string `json:"headers,omitempty"`     // 接口级别额外请求头
	Params       []ParamDef        `json:"params,omitempty"`      // 参数定义
	BodyTemplate string            `json:"body_template,omitempty"` // 请求体模板（JSON，支持 {{param}} 占位符）
	Description  string            `json:"description,omitempty"`
	Enabled      *bool             `json:"enabled,omitempty"`
}

// AIConfig AI配置

type AIConfig struct {
	URL                   string `json:"url"`
	APIKey                string `json:"api_key"`
	Model                 string `json:"model"`
	Timeout               int    `json:"timeout"`                           // 超时时间（秒），默认60
	EnableFunctionCall    *bool  `json:"enable_function_call,omitempty"`    // 手动开关：是否启用 function call（nil 表示自动检测）
	EnableThinking        *bool  `json:"enable_thinking,omitempty"`         // 手动开关：是否启用 thinking 模式（nil 表示自动检测）
	EnableStreaming       *bool  `json:"enable_streaming,omitempty"`        // 手动开关：是否启用流式输出（nil 表示自动检测）
	EnableJSONMode        *bool  `json:"enable_json_mode,omitempty"`        // 手动开关：是否启用 JSON 模式（nil 表示自动检测）
	ContextWindowOverride int    `json:"context_window_override,omitempty"` // 手动指定上下文窗口大小（0 表示自动检测）
	// 表检索配置（用于 AI 创建接口时筛选相关表）
	TableRetrieval *TableRetrievalConfig `json:"table_retrieval,omitempty"`
	// Embedding 配置（用于向量检索）
	Embedding EmbeddingRetrievalConfig `json:"embedding"`
}

// TableRetrievalConfig 表检索配置

type TableRetrievalConfig struct {
	// 检索策略: "full" | "keyword" | "embedding" | "graph" | "hybrid"
	Strategy string `json:"strategy,omitempty"` // 默认 keyword
	// 返回表数量上限
	MaxTables int `json:"max_tables,omitempty"` // 默认 15
	// 最小相关度阈值（0-1）
	MinRelevanceScore float64 `json:"min_relevance_score,omitempty"` // 默认 0.3
	// 关键词策略参数
	KeywordConfig *KeywordRetrievalConfig `json:"keyword_config,omitempty"`
	// Embedding 策略参数
	EmbeddingConfig *EmbeddingRetrievalConfig `json:"embedding_config,omitempty"`
	// Graph 策略参数
	GraphConfig *GraphRetrievalConfig `json:"graph_config,omitempty"`
	// 是否包含字段信息（字段多时可关闭以节省 token）
	IncludeFields bool `json:"include_fields,omitempty"` // 默认 true
	// 字段数量上限（每张表最多返回多少字段）
	MaxFieldsPerTable int `json:"max_fields_per_table,omitempty"` // 默认 50
	// 向量检索权重（hybrid 策略时使用）
	VectorWeight float64 `json:"vector_weight,omitempty"` // 默认 0.5
	// 关键词检索权重（hybrid 策略时使用）
	KeywordWeight float64 `json:"keyword_weight,omitempty"` // 默认 0.5
	// Graph 关系检索权重（hybrid 策略时使用）
	GraphWeight float64 `json:"graph_weight,omitempty"` // 默认 0.3
}

// KeywordRetrievalConfig 关键词检索配置

type KeywordRetrievalConfig struct {
	// 匹配字段: ["name", "comment", "column_names"]
	MatchFields []string `json:"match_fields,omitempty"` // 默认 ["name", "comment", "column_names"]
}

// EmbeddingRetrievalConfig Embedding 检索配置

type EmbeddingRetrievalConfig struct {
	URL       string `json:"url,omitempty"`       // embedding API 地址
	APIKey    string `json:"api_key,omitempty"`   // API key
	Model     string `json:"model,omitempty"`     // 模型名，如 "BAAI/bge-large-zh-v1.5"
	Dimension int    `json:"dimension,omitempty"` // 向量维度，默认 1024
	Enabled   bool   `json:"enabled,omitempty"`   // 是否启用向量检索
}

// GraphRetrievalConfig Graph 关系检索配置

type GraphRetrievalConfig struct {
	MaxDepth int `json:"max_depth,omitempty"` // 关系扩展最大深度，默认 2
}

// TableRelevanceResult 表检索结果

type TableRelevanceResult struct {
	TableName      string  `json:"table_name"`
	RelevanceScore float64 `json:"relevance_score"`
	MatchReason    string  `json:"match_reason,omitempty"` // 匹配原因说明
}

// AICapabilities AI模型能力检测结果

type AICapabilities struct {
	SupportsFunctionCall bool  `json:"supports_function_call"` // 是否支持 function call / tool use
	SupportsThinking     bool  `json:"supports_thinking"`      // 是否支持 extended thinking / reasoning
	SupportsStreaming    bool  `json:"supports_streaming"`     // 是否支持流式输出
	ContextWindow        int   `json:"context_window"`         // 上下文窗口大小（tokens）
	SupportsJSONMode     bool  `json:"supports_json_mode"`     // 是否支持 JSON 输出模式
	DetectedAt           int64 `json:"detected_at"`            // 检测时间戳
}

// LLMModelConfig 大模型配置

type LLMModelConfig struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"`     // "llm" | "rerank" | "embedding" | "asr" | "tts"
	Provider    string `json:"provider"` // "openai" | "anthropic" | "ollama" | "custom"
	URL         string `json:"url"`
	APIKey      string `json:"api_key,omitempty"`
	Model       string `json:"model,omitempty"`
	Description string `json:"description,omitempty"`
	Enabled     bool   `json:"enabled"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at,omitempty"`
}

// SmallModelConfig 小模型配置（JS 代码运行）

type SmallModelConfig struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	JsCode      string `json:"js_code"`
	DatabaseID  string `json:"database_id,omitempty"`
	InputType   string `json:"input_type,omitempty"`  // "text" | "file" | "both"
	AcceptExts  string `json:"accept_exts,omitempty"` // ".csv,.txt,.json"
	OutputType  string `json:"output_type,omitempty"` // "text" | "json" | "file"
	Enabled     bool   `json:"enabled"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at,omitempty"`
}

// FieldRef 字段引用

type FieldRef struct {
	DatabaseID string `json:"database_id"`
	TableName  string `json:"table_name"`
	FieldName  string `json:"field_name"`
	FieldType  string `json:"field_type,omitempty"`
}

// OntologyRelation 本体关系

type OntologyRelation struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	Source      FieldRef  `json:"source"`
	Target      FieldRef  `json:"target"`
	MatchType   string    `json:"match_type"` // exact, case_insensitive, naming_style, type_keyword
	Owner       string    `json:"owner,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// RelationCandidate 关系候选

type RelationCandidate struct {
	Name        string   `json:"name"`
	Source      FieldRef `json:"source"`
	Target      FieldRef `json:"target"`
	MatchType   string   `json:"match_type"`
	MatchScore  float64  `json:"match_score"`
	Description string   `json:"description,omitempty"`
}

// AIQueryRequest AI查询请求

type AIQueryRequest struct {
	Message    string                   `json:"message"`
	Databases  []string                 `json:"databases"`
	Modules    []string                 `json:"modules,omitempty"`
	History    []map[string]interface{} `json:"history,omitempty"`
	Mode       string                   `json:"mode,omitempty"`      // "fast"(默认) 或 "cluster"
	SessionID  string                   `json:"session_id,omitempty"` // 会话ID，用于隔离不同会话的记忆
}

// AICodegenRequest 数据治理入库代码 AI 生成请求（与 AI 助手共用 url/api_key/model）

type AICodegenRequest struct {
	DatabaseID   string            `json:"database_id"`
	DatabaseName string            `json:"database_name"`
	DBType       string            `json:"db_type"`
	TableName    string            `json:"table_name"`
	SourceType   string            `json:"source_type"` // excel | csv_file | csv_text
	Columns      []AICodegenColumn `json:"columns"`
	UserHint     string            `json:"user_hint,omitempty"`
}

// AICodegenColumn 列映射

type AICodegenColumn struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	SourceIndex int    `json:"source_index"`
}

// GovernanceExampleFile 预置任务示例文件（供下载，path 为 examples/governance 下相对路径）

type GovernanceExampleFile struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// GovernanceTask 数据治理任务

type GovernanceTask struct {
	ID            string                  `json:"id"`
	Owner         string                  `json:"owner,omitempty"` // 所属用户名
	Name          string                  `json:"name"`
	Type          string                  `json:"type"` // "scheduled" | "interactive"
	Description   string                  `json:"description,omitempty"`
	JsCode        string                  `json:"js_code"`
	DatabaseID    string                  `json:"database_id"` // 去掉 omitempty，确保空字符串也能序列化
	CronExpr      string                  `json:"cron_expr,omitempty"` // "分 时 日 月 周" e.g. "0 2 * * *"
	Enabled       bool                    `json:"enabled"`
	InputType     string                  `json:"input_type,omitempty"`      // "file" | "text" | "both"
	AcceptExts    []string                `json:"accept_exts,omitempty"`     // [".xlsx",".csv",".docx"]
	RegisterAsAPI bool                    `json:"register_as_api"`           // 是否注册为 API 接口
	APIPath       string                  `json:"api_path,omitempty"`        // API 路径（如 /api/tasks/my-task）
	APIMethod     string                  `json:"api_method,omitempty"`      // API 方法（GET/POST）
	FileBatchMode string                  `json:"file_batch_mode,omitempty"` // "" | "per_file" | "single"（多文件一次执行）
	Runtime       string                  `json:"runtime,omitempty"`         // "backend" | "frontend"（执行环境，旧字段）
	RunMode       string                  `json:"run_mode,omitempty"`        // "backend" | "frontend"（前端新字段）
	ExecutionMode string                  `json:"execution_mode,omitempty"`  // 兼容前端/后端两种命名
	ExampleFiles  []GovernanceExampleFile `json:"example_files,omitempty"`
	CreatedAt     string                  `json:"created_at"`
	UpdatedAt     string                  `json:"updated_at,omitempty"`
	Status        string                  `json:"status"` // "idle" | "running" | "success" | "error"
	LastOutput    string                  `json:"last_output,omitempty"`
	LastError     string                  `json:"last_error,omitempty"`
	LastRunAt     string                  `json:"last_run_at,omitempty"`
	// 异步执行进度追踪
	RunID          string `json:"run_id,omitempty"`          // 当前运行 ID
	TotalFiles     int    `json:"total_files,omitempty"`     // 总文件数
	ProcessedFiles int    `json:"processed_files,omitempty"` // 已处理文件数
	Percent        int    `json:"percent,omitempty"`         // 进度百分比
	CurrentFile    string `json:"current_file,omitempty"`    // 当前处理的文件
	StartedAt      string `json:"started_at,omitempty"`      // 开始时间
	// 分享功能
	ShareEnabled bool   `json:"share_enabled"` // 是否开启分享
	ShareToken   string `json:"share_token"`   // 分享token（UUID）
}

// GovernanceTaskLog 任务执行日志

type GovernanceTaskLog struct {
	ID          string   `json:"id"`
	TaskID      string   `json:"task_id"`
	RunID       string   `json:"run_id,omitempty"` // 与 GovernanceJob.RunID 对应，用于异步执行更新同一条日志
	StartTime   string   `json:"start_time"`
	EndTime     string   `json:"end_time,omitempty"`
	Status      string   `json:"status"` // "running" | "success" | "error"
	Output      string   `json:"output,omitempty"`
	Error       string   `json:"error,omitempty"`
	Input       string   `json:"input,omitempty"`
	InputFiles  []string `json:"input_files,omitempty"`  // 输入文件列表（文件名）
	ResultFiles []string `json:"result_files,omitempty"` // 输出文件列表（文件名）
}

// 数据本体池存储

var (
	dataOntologyUsers          = make(map[string]*User)
	dataOntologyDatabases      = make(map[string]*DatabaseConfig)
	dataOntologyApis           = make(map[string]*ApiConfig)
	dataOntologyPlatforms      = make(map[string]*Platform)
	dataOntologyForwardApis    = make(map[string]*ForwardApiConfig)
	dataOntologyAIConfig       *AIConfig
	dataOntologyAICapabilities *AICapabilities // AI模型能力检测结果
	governanceTasks            = make(map[string]*GovernanceTask)
	governanceTaskLogs         = make(map[string][]*GovernanceTaskLog)
	dataOntologyMCPEnabled     *bool              // MCP 总开关，nil 视为 true
	dataOntologyMCPSafeConfig  *MCPSafeConfig     // MCP 安全配置
	dataOntologyMCPPort        int            = 0 // MCP 服务端口，0 表示使用主服务器端口
	// 模型管理
	llmModels      = make(map[string]*LLMModelConfig)
	smallModels    = make(map[string]*SmallModelConfig)
	dataOntologyMu sync.RWMutex
	// 集群模式（Agent）
	agentProviderRegistry *agent.ProviderRegistry
	agentMCPSupervisor    *agent.MCPSupervisor
	agentSkillRegistry    *agent.SkillRegistry
	agentOrchestrators    = make(map[string]*agent.Orchestrator) // username → Orchestrator（每用户独立workspace）
	agentOrchestratorMu   sync.RWMutex
	agentSessionModes     = make(map[string]string) // sessionID → "fast"|"cluster"
	// HITL 人在环路
	globalHITLManager *agent.HITLManager
)

// 数据治理任务队列

type GovernanceJob struct {
	TaskID     string
	RunID      string
	Token      string
	InputFiles []string // 文件路径列表
	InputText  string
	ShareToken string // 如果是分享执行的，记录分享token
}

// GovernanceShareRun 分享执行记录

type GovernanceShareRun struct {
	ID          string    `json:"id"`
	TaskID      string    `json:"task_id"`
	ShareToken  string    `json:"share_token"`
	Status      string    `json:"status"`       // pending/running/completed/failed
	Progress    int       `json:"progress"`     // 0-100
	Output      string    `json:"output"`       // 执行日志
	InputFiles  []string  `json:"input_files"`  // 输入文件列表
	ResultFiles []string  `json:"result_files"` // 结果文件列表
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

var (
	governanceJobQueue = make(chan *GovernanceJob, 100) // 任务队列
	govRunnerPath      = "gov-runner"                   // 未嵌入时从可执行文件旁查找
	govRunnerAPIBase   string                           // 供 gov-runner 回调本机 API，在 main 中设置
	// 分享执行记录存储
	governanceShareRuns   = make(map[string]*GovernanceShareRun) // runID -> run
	governanceShareRunsMu sync.RWMutex
)

// 网页导航

var (
	webNavLinks      []WebNavLink
	webNavMu         sync.RWMutex
	webNavAdminToken string // 管理员登录后的 token
)

// WebNavLink 网页导航项

type WebNavLink struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	URL   string `json:"url"`
	Icon  string `json:"icon,omitempty"` // 可选，空则用标题生成图标
}

// WebNavStore 网页导航持久化结构

type WebNavStore struct {
	Links []WebNavLink `json:"links"`
}

// MCPSafeConfig MCP 安全配置

type MCPSafeConfig struct {
	ReadOnlyMode    bool     `json:"read_only_mode"`   // 只读模式，禁止所有写操作
	BlockDangerous  bool     `json:"block_dangerous"`  // 阻止危险操作（DROP, DELETE, TRUNCATE 等）
	BlockedKeywords []string `json:"blocked_keywords"` // 自定义阻止的关键词列表
	AllowedTables   []string `json:"allowed_tables"`   // 允许操作的表白名单（空则不限制）
	Port            int      `json:"port"`             // MCP 服务端口，0 表示使用主服务器端口
}

// DataOntologyStore 持久化存储结构

type DataOntologyStore struct {
	Users          map[string]*User                `json:"users"`
	Databases      map[string]*DatabaseConfig      `json:"databases"`
	Apis           map[string]*ApiConfig           `json:"apis"`
	Platforms      map[string]*Platform            `json:"platforms,omitempty"`
	ForwardApis    map[string]*ForwardApiConfig    `json:"forward_apis,omitempty"`
	AIConfig       *AIConfig                       `json:"ai_config,omitempty"`
	AICapabilities *AICapabilities                 `json:"ai_capabilities,omitempty"`
	Tasks          map[string]*GovernanceTask      `json:"governance_tasks,omitempty"`
	TaskLogs       map[string][]*GovernanceTaskLog `json:"governance_task_logs,omitempty"`
	MCPEnabled     *bool                           `json:"mcp_enabled,omitempty"`     // MCP 总开关，nil 视为 true
	MCPSafeConfig  *MCPSafeConfig                  `json:"mcp_safe_config,omitempty"` // MCP 安全配置
	// 模型管理
	LLMModels   map[string]*LLMModelConfig   `json:"llm_models,omitempty"`
	SmallModels map[string]*SmallModelConfig `json:"small_models,omitempty"`
	// 分享任务执行记录（按 shareToken 索引）
	ShareRuns map[string]map[string]*GovernanceShareRun `json:"share_runs,omitempty"` // shareToken -> runID -> run
}

var getDataOntologyStorePathFn = getDataOntologyStorePath

// 获取持久化文件路径

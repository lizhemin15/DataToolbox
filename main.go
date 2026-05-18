package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
)

func main() {
	// 子命令 mcp：以 stdio 运行 MCP 服务，供 Cursor 等连接（需设置 DATA_ONTOLOGY_BASE_URL、DATA_ONTOLOGY_API_KEY）
	if len(os.Args) >= 2 && os.Args[1] == "mcp" {
		runMCPServer()
		return
	}

	// 命令行参数
	portFlag := flag.Int("port", 0, "服务器端口")
	flag.Parse()

	// 加载配置
	config := loadConfig()
	port := config.Port

	// 命令行参数优先
	if *portFlag != 0 {
		port = *portFlag
	}

	// MCP 回环与 gov-runner 回调本机 API（需在 init 之前，避免非默认端口时回调错误）
	mcpLoopbackAddr = fmt.Sprintf("http://127.0.0.1:%d", port)
	govRunnerAPIBase = mcpLoopbackAddr

	// 初始化数据本体池
	initDataOntology()
	// 初始化网页导航
	initWebNav()
	// 初始化集群模式（Agent）子系统
	initAgentSubsystem()
	// 初始化 MCP StreamableHTTPHandler（需在 initAgentSubsystem 之后，依赖 dataOntology 配置）
	initMCPHTTPHandler()

	// 初始化表检索 SQLite FTS5 索引并异步同步所有数据库
	if manager := getFTS5Manager(); manager != nil {
		go func() {
			if err := manager.syncAllDatabases(); err != nil {
				log.Printf("[表检索] 初始同步失败: %v", err)
			}
		}()
	}

	// 启动Hub
	go hub.run()

	// 启动 SFTP 会话定期清理
	startSFTPSessionCleaner()

	// 启动登录 token 定期清理
	startTokenCleaner()

	// 创建路由
	mux := http.NewServeMux()

	// WebSocket路由
	mux.HandleFunc("/ws/chat", handleWebSocket)
	mux.HandleFunc("/ws/ops/ssh", handleSSHWebSocket)


	// 版本号 API（无需鉴权）
	mux.HandleFunc("/api/version", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"version": Version})
	})

	// 数据本体池API路由
	mux.HandleFunc("/api/login", handleDataOntologyLogin)
	mux.HandleFunc("/api/users", handleDataOntologyUsers)
	mux.HandleFunc("/api/users/batch", handleDataOntologyUsersBatch)
	mux.HandleFunc("/api/users/", handleDataOntologyUsersDetail)
	mux.HandleFunc("/api/apikey", handleApiKey)
	mux.HandleFunc("/api/settings", handleUserSettings)
	mux.HandleFunc("/api/test-connection", handleTestConnection)
	mux.HandleFunc("/api/databases", handleDatabases)
	mux.HandleFunc("/api/table-retrieval/sync", handleTableRetrievalSync)
	mux.HandleFunc("/api/table-retrieval/status", handleTableRetrievalStatus)
	mux.HandleFunc("/api/table-retrieval/embedding-status", handleTableRetrievalEmbeddingStatus)
	mux.HandleFunc("/api/table-retrieval/relation-status", handleTableRetrievalRelationStatus)
	mux.HandleFunc("/api/table-retrieval/embedding-sync", handleTableRetrievalEmbeddingSync)
	mux.HandleFunc("/api/table-retrieval/relation-scan", handleTableRetrievalRelationScan)
	mux.HandleFunc("/api/table-retrieval/relation-confirm", handleTableRetrievalRelationConfirm)
	mux.HandleFunc("/api/table-retrieval/embedding-preview", handleTableRetrievalEmbeddingPreview)
	mux.HandleFunc("/api/table-retrieval/relation-preview", handleTableRetrievalRelationPreview)
	mux.HandleFunc("/api/table-retrieval/search", handleTableRetrievalSearch)
	mux.HandleFunc("/api/table-retrieval/vectors", handleTableRetrievalVectorList)
	mux.HandleFunc("/api/table-retrieval/relations", handleTableRetrievalRelationList)
	mux.HandleFunc("/api/databases/", func(w http.ResponseWriter, r *http.Request) {
		trimPath := strings.Trim(r.URL.Path, "/")
		parts := strings.Split(trimPath, "/")
		// Handle ontology endpoints: /api/databases/{id}/ontology/...
		if len(parts) >= 5 && parts[1] == "databases" && parts[3] == "ontology" {
			switch parts[4] {
			case "scan":
				handleDatabaseOntologyScan(w, r)
				return
			case "relations":
				if len(parts) == 5 {
					handleDatabaseOntologyRelations(w, r)
					return
				} else if len(parts) == 6 {
					handleDatabaseOntologyRelationDetail(w, r)
					return
				}
			}
		}
		// Handle lineage endpoint
		if len(parts) == 4 && parts[1] == "databases" && parts[3] == "lineage" {
			handleDatabaseLineage(w, r)
			return
		}
		path := r.URL.Path
		if strings.Contains(path, "/tables/") || strings.HasSuffix(path, "/tables") {
			handleTableData(w, r)
		} else {
			handleDatabaseDetail(w, r)
		}
	})

	// MCP 配置（总开关）
	mux.HandleFunc("/api/mcp/config", handleMCPConfig)
	mux.HandleFunc("/api/mcp/safe-config", handleMCPSafeConfig)
	mux.HandleFunc("/api/mcp/port", handleMCPPort)
	mux.Handle("/mcp", http.HandlerFunc(handleMCPHTTP))
	mux.Handle("/mcp/", http.HandlerFunc(handleMCPHTTP))
	// Skills 技能导出
	mux.HandleFunc("/api/skills/export", handleSkillsExport)
	// 接口管理API路由
	mux.HandleFunc("/api/apis", handleApis)
	mux.HandleFunc("/api/apis/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if strings.HasSuffix(path, "/test") {
			handleApiTest(w, r)
		} else {
			handleApiDetail(w, r)
		}
	})

	// AI助手API路由
	mux.HandleFunc("/api/ai/config", handleAIConfig)
	mux.HandleFunc("/api/ai/embedding-config", handleAIEmbeddingConfig)
	mux.HandleFunc("/api/ai/table-retrieval-config", handleTableRetrievalConfig)
	mux.HandleFunc("/api/ai/capabilities", handleAICapabilities)
	mux.HandleFunc("/api/ai/query", handleAIQuery)
	mux.HandleFunc("/api/ai/confirm-execute", handleAIConfirmExecute)
	mux.HandleFunc("/api/ai/codegen", handleAICodegen)
	mux.HandleFunc("/api/ai/completion", handleAICompletion)

	// 集群模式（Agent）API路由
	mux.HandleFunc("/api/agent/cluster/query", handleAgentClusterQuery)
	mux.HandleFunc("/api/agent/mcp", handleAgentMCP)
	mux.HandleFunc("/api/agent/skill", handleAgentSkill)
	mux.HandleFunc("/api/agent/mode", handleAgentMode)
	mux.HandleFunc("/api/agent/status", handleAgentStatus)

	// HITL 人在环路 API路由
	mux.HandleFunc("/api/hitl/respond", handleHITLRespond)
	mux.HandleFunc("/api/hitl/pending", handleHITLPending)

	// 模型管理API路由
	mux.HandleFunc("/api/models/llm", handleLLMModels)
	mux.HandleFunc("/api/models/llm/", handleLLMModelDetail)
	mux.HandleFunc("/api/models/small", handleSmallModels)
	mux.HandleFunc("/api/models/small/", handleSmallModelDetail)

	// 本体论API路由
	mux.HandleFunc("/api/ontology/extract", handleOntologyExtract)
	mux.HandleFunc("/api/ontology/query", handleOntologySemanticQuery)

	// 数据治理API路由
	mux.HandleFunc("/api/governance/tasks", handleGovernanceTasks)
	mux.HandleFunc("/api/governance/tasks/", handleGovernanceTaskDetail)
	mux.HandleFunc("/api/governance/download-output", handleGovernanceDownloadOutput)
	mux.HandleFunc("/api/governance/download-api-output", handleGovernanceDownloadAPIOutput)
	mux.HandleFunc("/api/governance/execute-sql", handleGovernanceExecuteSQL)
	mux.HandleFunc("/api/governance/examples/", handleGovernanceExampleDownload)
	mux.HandleFunc("/api/tasks/", handleGovernanceTaskAPI) // 治理任务 API 调用
	mux.HandleFunc("/api/quality-audit/", handleQualityAuditAPI)

	// 分享API路由（免鉴权）
	mux.HandleFunc("/api/share/", handleGovernanceShare)

	// 文本结构化解析API路由
	mux.HandleFunc("/api/gov/parse-text", handleGovParseText)

	// 数据备份与恢复API路由
	mux.HandleFunc("/api/backup", handleDataOntologyBackup)
	mux.HandleFunc("/api/restore", handleDataOntologyRestore)
	mux.HandleFunc("/api/restore-upload", handleDataOntologyRestoreUpload)


	// 静态资源（嵌入二进制，无需外置 apps/css/js/lib）
	mux.Handle("/", newStaticFileHandler())

	// 分享页面路由
	mux.HandleFunc("/share/", handleSharePage)

	handler := loggingMiddleware(corsMiddleware(handleApiDispatch(mux)))

	// 启动服务器
	addr := fmt.Sprintf("%s:%d", config.Host, port)
	localIP := getLocalIP()

	fmt.Println("============================================================")
	fmt.Println("DataToolbox 服务器已启动")
	fmt.Println("============================================================")
	fmt.Printf("本地访问: http://localhost:%d\n", port)
	fmt.Printf("局域网访问: http://%s:%d\n", localIP, port)
	if config.Host == "0.0.0.0" {
		fmt.Printf("外网访问: http://<your-public-ip>:%d\n", port)
	}
	fmt.Println("============================================================")
	fmt.Println("功能: 文件服务器 + 局域网聊天")
	fmt.Println("============================================================")
	fmt.Println("按 Ctrl+C 停止服务器")
	fmt.Println("============================================================")

	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatalf("启动服务器失败: %v", err)
	}
}

// ============================================================
// FTS5 表检索管理器 - 支持 3 万+ 表的高效关键词检索
// ============================================================

// FTS5Manager SQLite FTS5 表检索管理器

type FTS5Manager struct {
	dbPath string
	db     *sql.DB
	mu     sync.Mutex // 改为互斥锁，读写都需要独占（SQLite 单写要求）
}

var (
	fts5Manager     *FTS5Manager
	fts5ManagerOnce sync.Once
)

// getFTS5Manager 获取 FTS5 管理器单例

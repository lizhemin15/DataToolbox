package main

import (
	"database/sql"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/YOUR_USERNAME/DataToolbox/components"
	"github.com/YOUR_USERNAME/DataToolbox/templates"
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
	// 加载预制组件库
	if err := components.LoadComponents("components"); err != nil {
		log.Printf("[组件] 加载预制组件失败: %v（将使用空组件库）", err)
	} else {
		comps := components.ListComponents()
		total := 0
		for _, c := range comps { total += len(c) }
		log.Printf("[组件] 已加载 %d 个预制组件", total)
	}
	// 加载应用模板库
	if err := templates.LoadTemplates("templates"); err != nil {
		log.Printf("[模板] 加载应用模板失败: %v（将使用空模板库）", err)
	} else {
		tmplList := templates.ListTemplatesFlat()
		log.Printf("[模板] 已加载 %d 个应用模板", len(tmplList))
	}
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

	// ==================== API v1 路由（唯一版本）====================
	registerAPIV1Routes(mux)

	// ==================== WebSocket 路由 ====================
	mux.HandleFunc("/ws/chat", handleWebSocket)
	mux.HandleFunc("/ws/ops/ssh", handleSSHWebSocket)

	// ==================== MCP 协议入口 ====================
	mux.Handle("/mcp", http.HandlerFunc(handleMCPHTTP))
	mux.Handle("/mcp/", http.HandlerFunc(handleMCPHTTP))

	// ==================== 分享页面（HTML）====================
	mux.HandleFunc("/share/", handleSharePage)

	// ==================== 静态资源 ====================
	mux.Handle("/", newStaticFileHandler())

	// 中间件包装
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
	fmt.Println("API 版本: v1")
	fmt.Println("路由格式: /api/v1/{domain}/{resource}")
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
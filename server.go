package main

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"embed"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	_ "gitee.com/chunanyong/dm"
	_ "github.com/denisenkom/go-mssqldb"
	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	_ "github.com/lib/pq"
	"github.com/pkg/sftp"
	_ "github.com/sijms/go-ora/v2"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"golang.org/x/crypto/bcrypt"
	gossh "golang.org/x/crypto/ssh"
	_ "modernc.org/sqlite"
)

//go:embed examples/governance scripts
var governanceExamplesFS embed.FS

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

// dbPoolConfig 连接池配置
const (
	maxOpenConns    = 10               // 最大打开连接数
	maxIdleConns    = 5                // 最大空闲连接数
	connMaxLifetime = 30 * time.Minute // 连接最大生命周期
	connMaxIdleTime = 5 * time.Minute  // 空闲连接最大存活时间
)

// getDBFromPool 从连接池获取数据库连接，如果不存在则创建
func getDBFromPool(config *DatabaseConfig) (*sql.DB, error) {
	// 先尝试读锁获取
	dbPool.RLock()
	if db, ok := dbPool.connections[config.ID]; ok {
		dbPool.RUnlock()
		// 验证连接是否有效
		if err := db.Ping(); err == nil {
			return db, nil
		}
		// 连接无效，需要重建
	} else {
		dbPool.RUnlock()
	}

	// 需要创建新连接
	dbPool.Lock()
	defer dbPool.Unlock()

	// 双重检查
	if db, ok := dbPool.connections[config.ID]; ok {
		if err := db.Ping(); err == nil {
			return db, nil
		}
		// 关闭无效连接
		db.Close()
		delete(dbPool.connections, config.ID)
	}

	// 创建新连接
	driver, dsn, err := buildDSN(config)
	if err != nil {
		return nil, err
	}

	db, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, err
	}

	// 设置连接池参数
	db.SetMaxOpenConns(maxOpenConns)
	db.SetMaxIdleConns(maxIdleConns)
	db.SetConnMaxLifetime(connMaxLifetime)
	db.SetConnMaxIdleTime(connMaxIdleTime)

	// 验证连接
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}

	dbPool.connections[config.ID] = db
	log.Printf("[DBPool] 创建新连接: id=%s, type=%s, host=%s", config.ID, config.Type, config.Host)
	return db, nil
}

// closeDBPool 关闭所有数据库连接池
func closeDBPool() {
	dbPool.Lock()
	defer dbPool.Unlock()
	for id, db := range dbPool.connections {
		if err := db.Close(); err != nil {
			log.Printf("[DBPool] 关闭连接失败: id=%s, err=%v", id, err)
		}
	}
	dbPool.connections = make(map[string]*sql.DB)
	log.Printf("[DBPool] 所有连接已关闭")
}

// removeDBFromPool 从连接池移除指定数据库连接
func removeDBFromPool(dbID string) {
	dbPool.Lock()
	defer dbPool.Unlock()
	if db, ok := dbPool.connections[dbID]; ok {
		db.Close()
		delete(dbPool.connections, dbID)
		log.Printf("[DBPool] 移除连接: id=%s", dbID)
	}
}

// loadConfig 加载配置文件
func loadConfig() Config {
	defaultConfig := Config{
		Port: 8080,
		Host: "0.0.0.0",
	}

	configFile := "server.config.json"
	data, err := os.ReadFile(configFile)
	if err != nil {
		// 配置文件不存在，创建默认配置
		configData, _ := json.MarshalIndent(defaultConfig, "", "  ")
		os.WriteFile(configFile, configData, 0644)
		return defaultConfig
	}

	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		log.Printf("配置文件解析失败，使用默认配置: %v\n", err)
		return defaultConfig
	}

	return config
}

// getLocalIP 获取本机IP
func getLocalIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "127.0.0.1"
	}
	defer conn.Close()

	localAddr := conn.LocalAddr().(*net.UDPAddr)
	return localAddr.IP.String()
}

// isValidIdentifier 检查标识符（表名、列名）是否安全
// 防止 SQL 注入：只允许字母、数字、下划线，且不能以数字开头
var validIdentifierRegex = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// sanitizeFilename 清理文件名，防止路径遍历攻击
// 返回清理后的安全文件名，如果文件名不合法则返回错误
func sanitizeFilename(filename string) (string, error) {
	if filename == "" {
		return "", fmt.Errorf("文件名不能为空")
	}
	// 限制文件名长度
	if len(filename) > 255 {
		filename = filename[:255]
	}
	// 移除路径分隔符和危险字符
	filename = filepath.Base(filename)
	// 检查是否包含路径遍历
	if strings.Contains(filename, "..") {
		return "", fmt.Errorf("文件名包含非法字符")
	}
	// 移除控制字符
	cleaned := strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, filename)
	if cleaned == "" {
		return "", fmt.Errorf("文件名无效")
	}
	return cleaned, nil
}

func isValidIdentifier(name string) bool {
	if name == "" || len(name) > 128 {
		return false
	}
	return validIdentifierRegex.MatchString(name)
}

// isValidIdentifierWithSchema 检查带 schema 的标识符（如 owner.table）
func isValidIdentifierWithSchema(name string) bool {
	if name == "" || len(name) > 256 {
		return false
	}
	// 允许 schema.table 格式
	parts := strings.Split(name, ".")
	for _, part := range parts {
		if !isValidIdentifier(part) {
			return false
		}
	}
	return true
}

// safeQuoteIdentifier 安全地引用标识符，防止 SQL 注入
// 如果标识符合法，返回带引号的标识符；否则返回空字符串和错误
func safeQuoteIdentifier(name, dbType string) (string, error) {
	// 先验证标识符合法性
	if !isValidIdentifierWithSchema(name) {
		return "", fmt.Errorf("无效的标识符: %s", name)
	}

	switch dbType {
	case "postgresql", "timescaledb", "cockroachdb":
		return `"` + name + `"`, nil
	case "sqlserver":
		return "[" + name + "]", nil
	case "oracle", "dm":
		// Oracle/DM 通常不需要引号，直接返回大写形式
		return strings.ToUpper(name), nil
	default:
		// MySQL, SQLite, DuckDB, ClickHouse 等
		return "`" + name + "`", nil
	}
}

// mustSafeQuote 安全引用标识符，如果无效则返回空字符串和错误
// 注意：调用方应处理错误情况，不要忽略返回的错误
func mustSafeQuote(name, dbType string) (string, error) {
	quoted, err := safeQuoteIdentifier(name, dbType)
	if err != nil {
		return "", err
	}
	return quoted, nil
}

// ============================================================
// API 响应辅助函数
// 统一 API 响应格式，确保一致性
// ============================================================

// APIResponse 标准 API 响应结构
type APIResponse struct {
	Success   bool        `json:"success"`
	Message   string      `json:"message,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	Error     string      `json:"error,omitempty"`
	ErrorCode string      `json:"error_code,omitempty"` // 错误码，便于前端国际化
}

// 标准错误码定义
const (
	ErrCodeBadRequest       = "BAD_REQUEST"
	ErrCodeUnauthorized     = "UNAUTHORIZED"
	ErrCodeForbidden        = "FORBIDDEN"
	ErrCodeNotFound         = "NOT_FOUND"
	ErrCodeMethodNotAllowed = "METHOD_NOT_ALLOWED"
	ErrCodeInternalError    = "INTERNAL_ERROR"
	ErrCodeInvalidInput     = "INVALID_INPUT"
)

// jsonResponse 写入 JSON 响应（内部函数）
func jsonResponse(w http.ResponseWriter, data interface{}, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	if statusCode > 0 {
		w.WriteHeader(statusCode)
	}
	json.NewEncoder(w).Encode(data)
}

// jsonSuccess 写入成功 JSON 响应
func jsonSuccess(w http.ResponseWriter, data map[string]interface{}) {
	result := map[string]interface{}{"success": true}
	for k, v := range data {
		result[k] = v
	}
	jsonResponse(w, result, 0)
}

// jsonError 写入错误 JSON 响应
func jsonError(w http.ResponseWriter, message string, errorCode string) {
	jsonResponse(w, map[string]interface{}{"success": false, "message": message, "errorCode": errorCode}, 0)
}

// jsonErrorWithLog 写入错误 JSON 响应并记录日志
func jsonErrorWithLog(w http.ResponseWriter, message string, errorCode string, logMsg string, logArgs ...interface{}) {
	if logMsg != "" {
		log.Printf(logMsg, logArgs...)
	}
	jsonError(w, message, errorCode)
}

// apiSuccess 返回成功响应（标准格式）
func apiSuccess(w http.ResponseWriter, data interface{}) {
	jsonResponse(w, APIResponse{
		Success: true,
		Data:    data,
	}, 0)
}

// apiSuccessWithMessage 返回带消息的成功响应
func apiSuccessWithMessage(w http.ResponseWriter, message string, data interface{}) {
	jsonResponse(w, APIResponse{
		Success: true,
		Message: message,
		Data:    data,
	}, 0)
}

// apiError 返回错误响应（标准格式）
func apiError(w http.ResponseWriter, message string, statusCode int, errorCode string) {
	jsonResponse(w, APIResponse{
		Success:   false,
		Message:   message,
		ErrorCode: errorCode,
	}, statusCode)
}

// apiBadRequest 返回 400 错误
func apiBadRequest(w http.ResponseWriter, message string) {
	apiError(w, message, http.StatusBadRequest, ErrCodeBadRequest)
}

// apiUnauthorized 返回 401 错误
func apiUnauthorized(w http.ResponseWriter, message string) {
	if message == "" {
		message = "未授权"
	}
	apiError(w, message, http.StatusUnauthorized, ErrCodeUnauthorized)
}

// apiForbidden 返回 403 错误
func apiForbidden(w http.ResponseWriter, message string) {
	if message == "" {
		message = "权限不足"
	}
	apiError(w, message, http.StatusForbidden, ErrCodeForbidden)
}

// apiNotFound 返回 404 错误
func apiNotFound(w http.ResponseWriter, message string) {
	if message == "" {
		message = "资源不存在"
	}
	apiError(w, message, http.StatusNotFound, ErrCodeNotFound)
}

// apiMethodNotAllowed 返回 405 错误
func apiMethodNotAllowed(w http.ResponseWriter, message ...string) {
	msg := "方法不允许"
	if len(message) > 0 && message[0] != "" {
		msg = message[0]
	}
	apiError(w, msg, http.StatusMethodNotAllowed, ErrCodeMethodNotAllowed)
}

// apiInternalError 返回 500 错误
func apiInternalError(w http.ResponseWriter, message string) {
	if message == "" {
		message = "服务器内部错误"
	}
	apiError(w, message, http.StatusInternalServerError, ErrCodeInternalError)
}

// apiInvalidInput 返回输入验证错误
func apiInvalidInput(w http.ResponseWriter, message string) {
	apiError(w, message, http.StatusBadRequest, ErrCodeInvalidInput)
}

// loggingMiddleware 日志中间件 - 记录请求方法和响应时间
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		// 使用自定义 ResponseWriter 捕获状态码
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		duration := time.Since(start)
		log.Printf("[HTTP] %s %s %s - %d (%v)", r.RemoteAddr, r.Method, r.URL.Path, wrapped.statusCode, duration)
	})
}

// responseWriter 包装 http.ResponseWriter 以捕获状态码
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// Flush 实现 http.Flusher 接口，支持流式传输
func (rw *responseWriter) Flush() {
	if flusher, ok := rw.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// corsMiddleware CORS中间件
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id")
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// Hub运行逻辑
func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.ID] = client
			h.mu.Unlock()

			// 发送注册成功消息
			msg := Message{
				Type: "registered",
				ID:   client.ID,
			}
			data, _ := json.Marshal(msg)
			client.Send <- data

			// 发送当前在线用户列表
			h.sendPeerList(client)

			// 不在这里广播peer-join，等客户端发送register消息设置昵称后再广播

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.ID]; ok {
				delete(h.clients, client.ID)
				close(client.Send)
			}
			h.mu.Unlock()

			// 通知其他用户有用户离开
			h.broadcastPeerLeave(client.ID)

		case message := <-h.broadcast:
			h.mu.RLock()
			for _, client := range h.clients {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(h.clients, client.ID)
				}
			}
			h.mu.RUnlock()
		}
	}
}

// 发送在线用户列表
func (h *Hub) sendPeerList(client *Client) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	peers := []map[string]string{}
	for _, c := range h.clients {
		peers = append(peers, map[string]string{
			"id":   c.ID,
			"name": c.Name,
		})
	}

	msg := Message{
		Type:  "peer-list",
		Peers: peers,
	}
	data, _ := json.Marshal(msg)
	client.Send <- data
}

// 向所有客户端广播用户列表
func (h *Hub) broadcastPeerListToAll() {
	h.mu.RLock()
	defer h.mu.RUnlock()

	peers := []map[string]string{}
	for _, c := range h.clients {
		peers = append(peers, map[string]string{
			"id":   c.ID,
			"name": c.Name,
		})
	}

	msg := Message{
		Type:  "peer-list",
		Peers: peers,
	}
	data, _ := json.Marshal(msg)

	for _, c := range h.clients {
		select {
		case c.Send <- data:
		default:
		}
	}
}

// 广播新用户加入
func (h *Hub) broadcastPeerJoin(client *Client) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	msg := Message{
		Type: "peer-join",
		Peer: map[string]string{
			"id":   client.ID,
			"name": client.Name,
		},
	}
	data, _ := json.Marshal(msg)

	log.Printf("广播用户加入: %s (%s) 给 %d 个其他用户", client.Name, client.ID, len(h.clients)-1)

	for _, c := range h.clients {
		if c.ID != client.ID {
			select {
			case c.Send <- data:
				log.Printf("  -> 发送给: %s", c.ID)
			default:
				log.Printf("  -> 发送失败: %s (通道已满)", c.ID)
			}
		}
	}
}

// 广播用户离开
func (h *Hub) broadcastPeerLeave(clientID string) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	msg := Message{
		Type: "peer-leave",
		ID:   clientID,
	}
	data, _ := json.Marshal(msg)

	for _, c := range h.clients {
		select {
		case c.Send <- data:
		default:
		}
	}
}

// WebSocket连接处理
func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket升级失败: %v", err)
		return
	}

	client := &Client{
		ID:   generateClientID(),
		Name: "用户" + time.Now().Format("150405"),
		Conn: conn,
		Send: make(chan []byte, 256),
	}

	hub.register <- client

	// 启动发送和接收协程
	go client.writePump()
	go client.readPump()
}

// 生成客户端ID
func generateClientID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}

// 读取客户端消息
func (c *Client) readPump() {
	defer func() {
		hub.unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadDeadline(time.Now().Add(WebSocketReadTimeout))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(WebSocketReadTimeout))
		return nil
	})

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			break
		}

		var msg Message
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "register":
			if msg.Name != "" {
				c.Name = msg.Name
				log.Printf("客户端 %s 注册昵称: %s", c.ID, c.Name)
				// 通知其他用户有新用户加入
				hub.broadcastPeerJoin(c)
				// 给所有用户发送更新后的用户列表
				hub.broadcastPeerListToAll()
			}

		case "update-name":
			if msg.Name != "" {
				oldName := c.Name
				c.Name = msg.Name
				log.Printf("客户端 %s 更新昵称: %s -> %s", c.ID, oldName, c.Name)
				// 给所有用户广播更新后的用户列表
				hub.broadcastPeerListToAll()
			}

		case "message", "shake", "game-invite", "game-accept", "game-reject", "game-move", "game-over":
			// 转发消息到目标客户端（包括普通消息、抖一抖、游戏相关）
			msg.From = c.ID
			data, _ := json.Marshal(msg)

			hub.mu.RLock()
			if targetClient, ok := hub.clients[msg.To]; ok {
				select {
				case targetClient.Send <- data:
					log.Printf("%s已发送: %s -> %s", msg.Type, c.ID, msg.To)
				default:
					log.Printf("%s发送失败: %s -> %s (通道已满)", msg.Type, c.ID, msg.To)
				}
			} else {
				log.Printf("目标客户端不存在: %s", msg.To)
			}
			hub.mu.RUnlock()

		}
	}
}

// 向客户端写入消息
func (c *Client) writePump() {
	ticker := time.NewTicker(WebSocketPingInterval)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(WebSocketWriteTimeout))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// 发送消息
			if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(WebSocketWriteTimeout))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// 数据本体池相关结构

// TokenEntry 带时间戳的 token（支持过期清理）
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
	Name        string   `json:"name"`
	Comment     string   `json:"comment,omitempty"`
	ColumnNames []string `json:"column_names,omitempty"` // 用于表检索
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
	// 检索策略: "keyword" | "embedding" | "graph" | "hybrid"
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
	URL       string `json:"url,omitempty"`        // embedding API 地址
	APIKey    string `json:"api_key,omitempty"`    // API key
	Model     string `json:"model,omitempty"`       // 模型名，如 "BAAI/bge-large-zh-v1.5"
	Dimension int    `json:"dimension,omitempty"`   // 向量维度，默认 1024
	Enabled   bool   `json:"enabled,omitempty"`     // 是否启用向量检索
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
	Message   string                   `json:"message"`
	Databases []string                 `json:"databases"`
	Modules   []string                 `json:"modules,omitempty"`
	History   []map[string]interface{} `json:"history,omitempty"`
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
	DatabaseID    string                  `json:"database_id,omitempty"`
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
	ID        string `json:"id"`
	TaskID    string `json:"task_id"`
	RunID     string `json:"run_id,omitempty"` // 与 GovernanceJob.RunID 对应，用于异步执行更新同一条日志
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time,omitempty"`
	Status    string `json:"status"` // "running" | "success" | "error"
	Output    string `json:"output,omitempty"`
	Error     string `json:"error,omitempty"`
	Input     string `json:"input,omitempty"`
}

// 数据本体池存储
var (
	dataOntologyUsers          = make(map[string]*User)
	dataOntologyDatabases      = make(map[string]*DatabaseConfig)
	dataOntologyApis           = make(map[string]*ApiConfig)
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
func getDataOntologyStorePath() string {
	// 获取可执行文件所在目录
	exePath, err := os.Executable()
	if err != nil {
		log.Printf("获取可执行文件路径失败: %v", err)
		return "apps/data-ontology/data-store.json"
	}
	rootDir := filepath.Dir(exePath)
	return filepath.Join(rootDir, "apps", "data-ontology", "data-store.json")
}

// 加载持久化数据
func loadDataOntologyStore() error {
	storePath := getDataOntologyStorePathFn()

	// 检查文件是否存在
	if _, err := os.Stat(storePath); os.IsNotExist(err) {
		log.Printf("持久化文件不存在，将创建新文件: %s", storePath)
		return nil
	}

	// 读取文件
	data, err := os.ReadFile(storePath)
	if err != nil {
		return fmt.Errorf("读取持久化文件失败: %v", err)
	}

	// 解析JSON
	var store DataOntologyStore
	if err := json.Unmarshal(data, &store); err != nil {
		return fmt.Errorf("解析持久化数据失败: %v", err)
	}

	// 加载数据到内存
	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	if store.Users != nil {
		dataOntologyUsers = store.Users
		log.Printf("已加载 %d 个用户", len(dataOntologyUsers))
	}

	if store.Databases != nil {
		dataOntologyDatabases = store.Databases
		log.Printf("已加载 %d 个数据库配置", len(dataOntologyDatabases))
	}

	if store.Apis != nil {
		dataOntologyApis = store.Apis
		log.Printf("已加载 %d 个接口配置", len(dataOntologyApis))
		// 调试：打印每个接口的 default_params
		for id, api := range dataOntologyApis {
			if api.DefaultParams != nil {
				log.Printf("[DEBUG] API %s (%s) default_params: %v", id, api.Name, api.DefaultParams)
			}
		}
	}

	if store.AIConfig != nil {
		dataOntologyAIConfig = store.AIConfig
		log.Printf("已加载AI配置")
	}

	if store.AICapabilities != nil {
		dataOntologyAICapabilities = store.AICapabilities
		log.Printf("已加载AI能力检测结果")
	}

	if store.Tasks != nil {
		governanceTasks = store.Tasks
		log.Printf("已加载 %d 个治理任务", len(governanceTasks))
	}

	if store.TaskLogs != nil {
		governanceTaskLogs = store.TaskLogs
		log.Printf("已加载治理任务日志")
	}
	if store.MCPEnabled != nil {
		dataOntologyMCPEnabled = store.MCPEnabled
	}
	if store.MCPSafeConfig != nil {
		dataOntologyMCPSafeConfig = store.MCPSafeConfig
		dataOntologyMCPPort = store.MCPSafeConfig.Port
		log.Printf("已加载 MCP 安全配置: read_only=%v, block_dangerous=%v, port=%d", store.MCPSafeConfig.ReadOnlyMode, store.MCPSafeConfig.BlockDangerous, store.MCPSafeConfig.Port)
	}
	// 模型管理
	if store.LLMModels != nil {
		llmModels = store.LLMModels
		log.Printf("已加载 %d 个大模型配置", len(llmModels))
	}
	if store.SmallModels != nil {
		smallModels = store.SmallModels
		log.Printf("已加载 %d 个小模型配置", len(smallModels))
	}
	// 加载分享任务执行记录
	if store.ShareRuns != nil {
		governanceShareRunsMu.Lock()
		for _, runs := range store.ShareRuns {
			for runID, run := range runs {
				governanceShareRuns[runID] = run
			}
		}
		governanceShareRunsMu.Unlock()
		totalRuns := 0
		for _, runs := range store.ShareRuns {
			totalRuns += len(runs)
		}
		log.Printf("已加载 %d 条分享任务执行记录（%d 个分享）", totalRuns, len(store.ShareRuns))
	}
	// 历史数据无 Owner 时视为管理员资源，避免泄露给普通用户
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
	// 向后兼容：将旧的 Token 字段迁移到 Tokens 列表
	for _, user := range dataOntologyUsers {
		if user != nil && user.Token != "" {
			// 将旧 Token 迁移到 Tokens 列表（避免重复）
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
			// 注意：不立即清空 user.Token，避免影响未更新的客户端
		}
	}
	return nil
}

// 保存持久化数据
func saveDataOntologyStore() error {
	storePath := getDataOntologyStorePathFn()

	// 确保目录存在
	storeDir := filepath.Dir(storePath)
	if err := os.MkdirAll(storeDir, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %v", err)
	}

	// 构建存储结构
	dataOntologyMu.RLock()
	// 构建分享执行记录索引（shareToken -> runID -> run）
	governanceShareRunsMu.RLock()
	shareRunsByToken := make(map[string]map[string]*GovernanceShareRun)
	for runID, run := range governanceShareRuns {
		if _, ok := shareRunsByToken[run.ShareToken]; !ok {
			shareRunsByToken[run.ShareToken] = make(map[string]*GovernanceShareRun)
		}
		shareRunsByToken[run.ShareToken][runID] = run
	}
	governanceShareRunsMu.RUnlock()

	store := DataOntologyStore{
		Users:          dataOntologyUsers,
		Databases:      dataOntologyDatabases,
		Apis:           dataOntologyApis,
		AIConfig:       dataOntologyAIConfig,
		AICapabilities: dataOntologyAICapabilities,
		Tasks:          governanceTasks,
		TaskLogs:       governanceTaskLogs,
		MCPEnabled:     dataOntologyMCPEnabled,
		MCPSafeConfig:  dataOntologyMCPSafeConfig,
		LLMModels:      llmModels,
		SmallModels:    smallModels,
		ShareRuns:      shareRunsByToken,
	}
	dataOntologyMu.RUnlock()

	// 序列化为JSON
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化数据失败: %v", err)
	}

	// 写入文件
	if err := os.WriteFile(storePath, data, 0644); err != nil {
		return fmt.Errorf("写入文件失败: %v", err)
	}

	log.Printf("数据已保存到: %s", storePath)
	return nil
}

// saveDataOntologyStoreNoLock 保存持久化数据（不加锁版本，供已持有锁的函数调用）
func saveDataOntologyStoreNoLock() error {
	storePath := getDataOntologyStorePathFn()

	// 确保目录存在
	storeDir := filepath.Dir(storePath)
	if err := os.MkdirAll(storeDir, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %v", err)
	}

	// 构建分享执行记录索引（shareToken -> runID -> run）
	governanceShareRunsMu.RLock()
	shareRunsByToken := make(map[string]map[string]*GovernanceShareRun)
	for runID, run := range governanceShareRuns {
		if _, ok := shareRunsByToken[run.ShareToken]; !ok {
			shareRunsByToken[run.ShareToken] = make(map[string]*GovernanceShareRun)
		}
		shareRunsByToken[run.ShareToken][runID] = run
	}
	governanceShareRunsMu.RUnlock()

	store := DataOntologyStore{
		Users:          dataOntologyUsers,
		Databases:      dataOntologyDatabases,
		Apis:           dataOntologyApis,
		AIConfig:       dataOntologyAIConfig,
		AICapabilities: dataOntologyAICapabilities,
		Tasks:          governanceTasks,
		TaskLogs:       governanceTaskLogs,
		MCPEnabled:     dataOntologyMCPEnabled,
		MCPSafeConfig:  dataOntologyMCPSafeConfig,
		LLMModels:      llmModels,
		SmallModels:    smallModels,
		ShareRuns:      shareRunsByToken,
	}

	// 序列化为JSON
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化数据失败: %v", err)
	}

	// 写入文件
	if err := os.WriteFile(storePath, data, 0644); err != nil {
		return fmt.Errorf("写入文件失败: %v", err)
	}

	log.Printf("数据已保存到: %s", storePath)
	return nil
}

// ====== 数据备份与恢复 API ======

// handleDataOntologyBackup 导出备份（ZIP 格式，包含所有持久化数据）
func handleDataOntologyBackup(w http.ResponseWriter, r *http.Request) {
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method != http.MethodGet {
		apiMethodNotAllowed(w, "只支持GET请求")
		return
	}

	// 仅管理员可备份
	if username != "admin" {
		apiForbidden(w, "仅管理员可执行备份")
		return
	}

	dataOntologyMu.RLock()
	governanceShareRunsMu.RLock()
	shareRunsByToken := make(map[string]map[string]*GovernanceShareRun)
	for runID, run := range governanceShareRuns {
		if _, ok := shareRunsByToken[run.ShareToken]; !ok {
			shareRunsByToken[run.ShareToken] = make(map[string]*GovernanceShareRun)
		}
		shareRunsByToken[run.ShareToken][runID] = run
	}
	governanceShareRunsMu.RUnlock()

	store := DataOntologyStore{
		Users:          dataOntologyUsers,
		Databases:      dataOntologyDatabases,
		Apis:           dataOntologyApis,
		AIConfig:       dataOntologyAIConfig,
		AICapabilities: dataOntologyAICapabilities,
		Tasks:          governanceTasks,
		TaskLogs:       governanceTaskLogs,
		MCPEnabled:     dataOntologyMCPEnabled,
		MCPSafeConfig:  dataOntologyMCPSafeConfig,
		LLMModels:      llmModels,
		SmallModels:    smallModels,
		ShareRuns:      shareRunsByToken,
	}
	dataOntologyMu.RUnlock()

	backupData := map[string]interface{}{
		"metadata": map[string]interface{}{
			"version":     2,
			"export_time": time.Now().Format("2006-01-02T15:04:05Z07:00"),
			"source":      "DataToolbox",
		},
		"data": store,
	}

	// 序列化 JSON 数据
	jsonData, err := json.MarshalIndent(backupData, "", "  ")
	if err != nil {
		apiInternalError(w, "序列化备份数据失败")
		return
	}

	// 创建 ZIP 压缩包
	now := time.Now()
	filename := fmt.Sprintf("datatoolbox-backup-%s.zip", now.Format("20060102"))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))

	// 获取数据目录
	dataDir := filepath.Dir(getDataOntologyStorePath())
	baseDir := "datatoolbox-backup"

	zipWriter := zip.NewWriter(w)
	defer zipWriter.Close()

	// 1. 写入 data-store.json
	jsonFile, err := zipWriter.Create(filepath.Join(baseDir, "data-store.json"))
	if err != nil {
		log.Printf("创建 ZIP 条目失败: %v", err)
		apiInternalError(w, "创建ZIP条目失败")
		return
	}
	if _, err := jsonFile.Write(jsonData); err != nil {
		log.Printf("写入 data-store.json 到 ZIP 失败: %v", err)
		apiInternalError(w, "写入ZIP失败")
		return
	}

	// 2. 写入 quality-audit.db（如果存在）
	qaDBPath := getQualityAuditDBPath()
	if _, err := os.Stat(qaDBPath); err == nil {
		dbFile, err := zipWriter.Create(filepath.Join(baseDir, "quality-audit.db"))
		if err == nil {
			f, err := os.Open(qaDBPath)
			if err == nil {
				written, _ := io.Copy(dbFile, f)
				log.Printf("备份 quality-audit.db: %d bytes", written)
				f.Close()
			}
		}
	}

	// 3. 递归写入目录的辅助函数
	addDirToZip := func(dirPath, zipSubDir string) {
		if fi, err := os.Stat(dirPath); err != nil || !fi.IsDir() {
			return
		}
		filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return nil
			}
			relPath, _ := filepath.Rel(dataDir, path)
			zipPath := filepath.Join(baseDir, relPath)
			f, err := zipWriter.Create(zipPath)
			if err != nil {
				return nil
			}
			src, err := os.Open(path)
			if err != nil {
				return nil
			}
			defer src.Close()
			written, _ := io.Copy(f, src)
			log.Printf("备份 %s: %d bytes", relPath, written)
			return nil
		})
	}

	// 写入 share-outputs/ 目录（如果存在）
	addDirToZip(filepath.Join(dataDir, "share-outputs"), "share-outputs")

	// 写入 share-uploads/ 目录（如果存在）
	addDirToZip(filepath.Join(dataDir, "share-uploads"), "share-uploads")

	// 写入 example_files/ 目录（如果存在）
	addDirToZip(filepath.Join(dataDir, "example_files"), "example_files")

	log.Printf("备份 ZIP 已生成: %s", filename)
}

// handleDataOntologyRestore 导入恢复（支持 ZIP 和 JSON 两种格式）
func handleDataOntologyRestore(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method != http.MethodPost {
		apiMethodNotAllowed(w, "只支持POST请求")
		return
	}

	// 仅管理员可恢复
	if username != "admin" {
		apiForbidden(w, "仅管理员可执行恢复")
		return
	}

	// 解析请求体
	var req struct {
		Mode string `json:"mode"` // "overwrite" 或 "merge"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "请求格式错误: "+err.Error(), ErrCodeBadRequest)
		return
	}

	if req.Mode != "overwrite" && req.Mode != "merge" {
		jsonError(w, "模式必须为 overwrite 或 merge", ErrCodeInvalidInput)
		return
	}

	jsonError(w, "新的恢复接口需要通过 multipart/form-data 上传 ZIP 文件", ErrCodeBadRequest)
}

// handleDataOntologyRestoreUpload 处理 ZIP 文件上传恢复
func handleDataOntologyRestoreUpload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method != http.MethodPost {
		apiMethodNotAllowed(w, "只支持POST请求")
		return
	}

	// 仅管理员可恢复
	if username != "admin" {
		apiForbidden(w, "仅管理员可执行恢复")
		return
	}

	// 解析 multipart 表单（最大 1GB）
	maxSize := int64(1 << 30)
	if err := r.ParseMultipartForm(maxSize); err != nil {
		jsonError(w, "解析表单失败: "+err.Error(), ErrCodeBadRequest)
		return
	}

	mode := r.FormValue("mode")
	if mode == "" {
		mode = "merge" // 默认使用合并模式
	}
	if mode != "overwrite" && mode != "merge" {
		jsonError(w, "模式必须为 overwrite 或 merge", ErrCodeInvalidInput)
		return
	}

	// 获取上传的文件
	file, header, err := r.FormFile("backup")
	if err != nil {
		jsonError(w, "获取上传文件失败: "+err.Error(), ErrCodeBadRequest)
		return
	}
	defer file.Close()

	// 创建临时目录
	tmpDir, err := ioutil.TempDir("", "datatoolbox-restore-")
	if err != nil {
		jsonError(w, "创建临时目录失败: "+err.Error(), ErrCodeInternalError)
		return
	}
	defer os.RemoveAll(tmpDir)

	// 保存上传的文件到临时目录
	tmpFile := filepath.Join(tmpDir, header.Filename)
	dst, err := os.Create(tmpFile)
	if err != nil {
		jsonError(w, "创建临时文件失败: "+err.Error(), ErrCodeInternalError)
		return
	}
	if _, err := io.Copy(dst, file); err != nil {
		dst.Close()
		jsonError(w, "保存上传文件失败: "+err.Error(), ErrCodeInternalError)
		return
	}
	dst.Close()

	// 判断文件类型（ZIP 或 JSON）
	var stats map[string]interface{}
	if strings.HasSuffix(strings.ToLower(header.Filename), ".zip") {
		// ZIP 格式
		stats, err = restoreFromZIP(tmpFile, mode)
	} else if strings.HasSuffix(strings.ToLower(header.Filename), ".json") {
		// JSON 格式（向后兼容）
		stats, err = restoreFromJSON(tmpFile, mode)
	} else {
		jsonError(w, "不支持的文件格式，仅支持 .zip 或 .json", ErrCodeInvalidInput)
		return
	}

	if err != nil {
		jsonError(w, err.Error(), ErrCodeInternalError)
		return
	}

	stats["mode"] = mode
	jsonSuccess(w, stats)
}

// restoreFromZIP 从 ZIP 文件恢复
func restoreFromZIP(zipPath, mode string) (map[string]interface{}, error) {
	dataDir := filepath.Dir(getDataOntologyStorePath())

	// 打开 ZIP 文件
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("打开 ZIP 文件失败: %v", err)
	}
	defer r.Close()

	// 查找 data-store.json
	var dataStoreFile *zip.File
	for _, f := range r.File {
		if strings.HasSuffix(f.Name, "data-store.json") {
			dataStoreFile = f
			break
		}
	}

	if dataStoreFile == nil {
		return nil, fmt.Errorf("ZIP 文件中未找到 data-store.json")
	}

	// 读取 data-store.json
	rc, err := dataStoreFile.Open()
	if err != nil {
		return nil, fmt.Errorf("打开 data-store.json 失败: %v", err)
	}
	jsonData, err := ioutil.ReadAll(rc)
	rc.Close()
	if err != nil {
		return nil, fmt.Errorf("读取 data-store.json 失败: %v", err)
	}

	// 解析 JSON
	var rawBackup map[string]json.RawMessage
	if err := json.Unmarshal(jsonData, &rawBackup); err != nil {
		return nil, fmt.Errorf("解析备份数据失败: %v", err)
	}

	var storeData json.RawMessage
	if md, ok := rawBackup["metadata"]; ok && md != nil {
		if data, ok2 := rawBackup["data"]; ok2 {
			storeData = data
		} else {
			return nil, fmt.Errorf("备份数据缺少 data 字段")
		}
	} else {
		storeData = jsonData
	}

	var newStore DataOntologyStore
	if err := json.Unmarshal(storeData, &newStore); err != nil {
		return nil, fmt.Errorf("解析备份数据失败: %v", err)
	}

	// 应用数据恢复
	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	var stats map[string]interface{}

	if mode == "overwrite" {
		// 覆盖模式：完全替换
		// 安全处理：确保密码是 bcrypt hash 格式
		if newStore.Users != nil {
			for _, v := range newStore.Users {
				if v != nil && v.Password != "" && !isBcryptHash(v.Password) {
					v.Password = hashPassword(v.Password)
				}
			}
		}
		dataOntologyUsers = newStore.Users
		dataOntologyDatabases = newStore.Databases
		dataOntologyApis = newStore.Apis
		dataOntologyAIConfig = newStore.AIConfig
		dataOntologyAICapabilities = newStore.AICapabilities
		governanceTasks = newStore.Tasks
		governanceTaskLogs = newStore.TaskLogs
		dataOntologyMCPEnabled = newStore.MCPEnabled
		dataOntologyMCPSafeConfig = newStore.MCPSafeConfig
		llmModels = newStore.LLMModels
		smallModels = newStore.SmallModels

		governanceShareRunsMu.Lock()
		governanceShareRuns = make(map[string]*GovernanceShareRun)
		if newStore.ShareRuns != nil {
			for _, runs := range newStore.ShareRuns {
				for runID, run := range runs {
					governanceShareRuns[runID] = run
				}
			}
		}
		governanceShareRunsMu.Unlock()

		stats = map[string]interface{}{
			"users_count":        len(dataOntologyUsers),
			"databases_count":    len(dataOntologyDatabases),
			"apis_count":         len(dataOntologyApis),
			"tasks_count":        len(governanceTasks),
			"llm_models_count":   len(llmModels),
			"small_models_count": len(smallModels),
		}
	} else {
		// 合并模式
		mergedStats := map[string]int{"users_added": 0, "databases_added": 0, "apis_added": 0, "tasks_added": 0}

		if newStore.Users != nil {
			for k, v := range newStore.Users {
				if _, exists := dataOntologyUsers[k]; !exists {
					// 安全处理：确保密码是 bcrypt hash 格式
					if v != nil && v.Password != "" && !isBcryptHash(v.Password) {
						v.Password = hashPassword(v.Password)
					}
					dataOntologyUsers[k] = v
					mergedStats["users_added"]++
				}
			}
		}
		if newStore.Databases != nil {
			for k, v := range newStore.Databases {
				if _, exists := dataOntologyDatabases[k]; !exists {
					dataOntologyDatabases[k] = v
					mergedStats["databases_added"]++
				}
			}
		}
		if newStore.Apis != nil {
			for k, v := range newStore.Apis {
				if _, exists := dataOntologyApis[k]; !exists {
					dataOntologyApis[k] = v
					mergedStats["apis_added"]++
				}
			}
		}
		if newStore.Tasks != nil {
			for k, v := range newStore.Tasks {
				if _, exists := governanceTasks[k]; !exists {
					governanceTasks[k] = v
					mergedStats["tasks_added"]++
				}
			}
		}
		if newStore.AIConfig != nil && dataOntologyAIConfig == nil {
			dataOntologyAIConfig = newStore.AIConfig
		}
		if newStore.AICapabilities != nil && dataOntologyAICapabilities == nil {
			dataOntologyAICapabilities = newStore.AICapabilities
		}
		if newStore.TaskLogs != nil {
			if governanceTaskLogs == nil {
				governanceTaskLogs = newStore.TaskLogs
			} else {
				for k, v := range newStore.TaskLogs {
					if _, exists := governanceTaskLogs[k]; !exists {
						governanceTaskLogs[k] = v
					}
				}
			}
		}
		if newStore.MCPEnabled != nil && dataOntologyMCPEnabled == nil {
			dataOntologyMCPEnabled = newStore.MCPEnabled
		}
		if newStore.MCPSafeConfig != nil && dataOntologyMCPSafeConfig == nil {
			dataOntologyMCPSafeConfig = newStore.MCPSafeConfig
			dataOntologyMCPPort = newStore.MCPSafeConfig.Port
		}
		if newStore.LLMModels != nil {
			for k, v := range newStore.LLMModels {
				if _, exists := llmModels[k]; !exists {
					llmModels[k] = v
				}
			}
		}
		if newStore.SmallModels != nil {
			for k, v := range newStore.SmallModels {
				if _, exists := smallModels[k]; !exists {
					smallModels[k] = v
				}
			}
		}
		if newStore.ShareRuns != nil {
			governanceShareRunsMu.Lock()
			for _, runs := range newStore.ShareRuns {
				for runID, run := range runs {
					if _, exists := governanceShareRuns[runID]; !exists {
						governanceShareRuns[runID] = run
					}
				}
			}
			governanceShareRunsMu.Unlock()
		}

		stats = map[string]interface{}{
			"users_added":        mergedStats["users_added"],
			"databases_added":    mergedStats["databases_added"],
			"apis_added":         mergedStats["apis_added"],
			"tasks_added":        mergedStats["tasks_added"],
			"total_users":        len(dataOntologyUsers),
			"total_databases":    len(dataOntologyDatabases),
			"total_apis":         len(dataOntologyApis),
			"total_tasks":        len(governanceTasks),
			"total_llm_models":   len(llmModels),
			"total_small_models": len(smallModels),
		}
	}

	// 保存数据（已持有 dataOntologyMu.Lock，使用无锁版本避免死锁）
	if err := saveDataOntologyStoreNoLock(); err != nil {
		log.Printf("恢复数据保存失败: %v", err)
		return nil, fmt.Errorf("保存恢复数据失败: %v", err)
	}

	// 恢复文件（ZIP 中的其他文件）
	fileCount := 0
	for _, f := range r.File {
		// 跳过 data-store.json
		if strings.HasSuffix(f.Name, "data-store.json") {
			continue
		}

		// 提取相对路径（去掉 datatoolbox-backup/ 前缀）
		relPath := f.Name
		if idx := strings.Index(relPath, "/"); idx >= 0 {
			relPath = relPath[idx+1:]
		}
		if relPath == "" {
			continue
		}

		// 安全检查：防止路径遍历攻击
		targetPath := filepath.Join(dataDir, relPath)
		absTarget, err := filepath.Abs(targetPath)
		if err != nil {
			log.Printf("获取绝对路径失败 %s: %v", targetPath, err)
			continue
		}
		absDataDir, _ := filepath.Abs(dataDir)
		if !strings.HasPrefix(absTarget, absDataDir+string(filepath.Separator)) && absTarget != absDataDir {
			log.Printf("安全警告：跳过路径遍历文件 %s (目标: %s)", f.Name, absTarget)
			continue
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(targetPath, 0755)
			continue
		}

		// 创建目录
		if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
			log.Printf("创建目录失败 %s: %v", filepath.Dir(targetPath), err)
			continue
		}

		// 覆盖模式下直接覆盖，合并模式下跳过已存在的文件
		if mode == "merge" {
			if _, err := os.Stat(targetPath); err == nil {
				continue // 文件已存在，跳过
			}
		}

		// 解压文件
		rc, err := f.Open()
		if err != nil {
			log.Printf("打开 ZIP 条目失败 %s: %v", f.Name, err)
			continue
		}

		dst, err := os.Create(targetPath)
		if err != nil {
			rc.Close()
			log.Printf("创建文件失败 %s: %v", targetPath, err)
			continue
		}

		_, err = io.Copy(dst, rc)
		dst.Close()
		rc.Close()

		if err != nil {
			log.Printf("解压文件失败 %s: %v", targetPath, err)
			continue
		}

		fileCount++
	}

	stats["files_restored"] = fileCount
	log.Printf("恢复完成，共恢复 %d 个文件", fileCount)

	return stats, nil
}

// restoreFromJSON 从 JSON 文件恢复（向后兼容）
func restoreFromJSON(jsonPath, mode string) (map[string]interface{}, error) {
	jsonData, err := ioutil.ReadFile(jsonPath)
	if err != nil {
		return nil, fmt.Errorf("读取 JSON 文件失败: %v", err)
	}

	var rawBackup map[string]json.RawMessage
	if err := json.Unmarshal(jsonData, &rawBackup); err != nil {
		return nil, fmt.Errorf("解析备份数据失败: %v", err)
	}

	var storeData json.RawMessage
	if md, ok := rawBackup["metadata"]; ok && md != nil {
		if data, ok2 := rawBackup["data"]; ok2 {
			storeData = data
		} else {
			return nil, fmt.Errorf("备份数据缺少 data 字段")
		}
	} else {
		storeData = jsonData
	}

	var newStore DataOntologyStore
	if err := json.Unmarshal(storeData, &newStore); err != nil {
		return nil, fmt.Errorf("解析备份数据失败: %v", err)
	}

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	var stats map[string]interface{}

	if mode == "overwrite" {
		// 安全处理：确保密码是 bcrypt hash 格式
		if newStore.Users != nil {
			for _, v := range newStore.Users {
				if v != nil && v.Password != "" && !isBcryptHash(v.Password) {
					v.Password = hashPassword(v.Password)
				}
			}
		}
		dataOntologyUsers = newStore.Users
		dataOntologyDatabases = newStore.Databases
		dataOntologyApis = newStore.Apis
		dataOntologyAIConfig = newStore.AIConfig
		dataOntologyAICapabilities = newStore.AICapabilities
		governanceTasks = newStore.Tasks
		governanceTaskLogs = newStore.TaskLogs
		dataOntologyMCPEnabled = newStore.MCPEnabled
		dataOntologyMCPSafeConfig = newStore.MCPSafeConfig
		llmModels = newStore.LLMModels
		smallModels = newStore.SmallModels

		governanceShareRunsMu.Lock()
		governanceShareRuns = make(map[string]*GovernanceShareRun)
		if newStore.ShareRuns != nil {
			for _, runs := range newStore.ShareRuns {
				for runID, run := range runs {
					governanceShareRuns[runID] = run
				}
			}
		}
		governanceShareRunsMu.Unlock()

		stats = map[string]interface{}{
			"users_count":        len(dataOntologyUsers),
			"databases_count":    len(dataOntologyDatabases),
			"apis_count":         len(dataOntologyApis),
			"tasks_count":        len(governanceTasks),
			"llm_models_count":   len(llmModels),
			"small_models_count": len(smallModels),
		}
	} else {
		mergedStats := map[string]int{"users_added": 0, "databases_added": 0, "apis_added": 0, "tasks_added": 0}

		if newStore.Users != nil {
			for k, v := range newStore.Users {
				if _, exists := dataOntologyUsers[k]; !exists {
					// 安全处理：确保密码是 bcrypt hash 格式
					if v != nil && v.Password != "" && !isBcryptHash(v.Password) {
						v.Password = hashPassword(v.Password)
					}
					dataOntologyUsers[k] = v
					mergedStats["users_added"]++
				}
			}
		}
		if newStore.Databases != nil {
			for k, v := range newStore.Databases {
				if _, exists := dataOntologyDatabases[k]; !exists {
					dataOntologyDatabases[k] = v
					mergedStats["databases_added"]++
				}
			}
		}
		if newStore.Apis != nil {
			for k, v := range newStore.Apis {
				if _, exists := dataOntologyApis[k]; !exists {
					dataOntologyApis[k] = v
					mergedStats["apis_added"]++
				}
			}
		}
		if newStore.Tasks != nil {
			for k, v := range newStore.Tasks {
				if _, exists := governanceTasks[k]; !exists {
					governanceTasks[k] = v
					mergedStats["tasks_added"]++
				}
			}
		}
		if newStore.AIConfig != nil && dataOntologyAIConfig == nil {
			dataOntologyAIConfig = newStore.AIConfig
		}
		if newStore.AICapabilities != nil && dataOntologyAICapabilities == nil {
			dataOntologyAICapabilities = newStore.AICapabilities
		}
		if newStore.TaskLogs != nil {
			if governanceTaskLogs == nil {
				governanceTaskLogs = newStore.TaskLogs
			} else {
				for k, v := range newStore.TaskLogs {
					if _, exists := governanceTaskLogs[k]; !exists {
						governanceTaskLogs[k] = v
					}
				}
			}
		}
		if newStore.MCPEnabled != nil && dataOntologyMCPEnabled == nil {
			dataOntologyMCPEnabled = newStore.MCPEnabled
		}
		if newStore.MCPSafeConfig != nil && dataOntologyMCPSafeConfig == nil {
			dataOntologyMCPSafeConfig = newStore.MCPSafeConfig
			dataOntologyMCPPort = newStore.MCPSafeConfig.Port
		}
		if newStore.LLMModels != nil {
			for k, v := range newStore.LLMModels {
				if _, exists := llmModels[k]; !exists {
					llmModels[k] = v
				}
			}
		}
		if newStore.SmallModels != nil {
			for k, v := range newStore.SmallModels {
				if _, exists := smallModels[k]; !exists {
					smallModels[k] = v
				}
			}
		}
		if newStore.ShareRuns != nil {
			governanceShareRunsMu.Lock()
			for _, runs := range newStore.ShareRuns {
				for runID, run := range runs {
					if _, exists := governanceShareRuns[runID]; !exists {
						governanceShareRuns[runID] = run
					}
				}
			}
			governanceShareRunsMu.Unlock()
		}

		stats = map[string]interface{}{
			"users_added":        mergedStats["users_added"],
			"databases_added":    mergedStats["databases_added"],
			"apis_added":         mergedStats["apis_added"],
			"tasks_added":        mergedStats["tasks_added"],
			"total_users":        len(dataOntologyUsers),
			"total_databases":    len(dataOntologyDatabases),
			"total_apis":         len(dataOntologyApis),
			"total_tasks":        len(governanceTasks),
			"total_llm_models":   len(llmModels),
			"total_small_models": len(smallModels),
		}
	}

	// 保存数据（已持有 dataOntologyMu.Lock，使用无锁版本避免死锁）
	if err := saveDataOntologyStoreNoLock(); err != nil {
		log.Printf("恢复数据保存失败: %v", err)
		return nil, fmt.Errorf("保存恢复数据失败: %v", err)
	}

	return stats, nil
}

// 获取网页导航持久化文件路径（存于 app 目录下）
func getWebNavStorePath() string {
	exePath, err := os.Executable()
	if err != nil {
		log.Printf("获取可执行文件路径失败: %v", err)
		return "apps/web-nav/links-store.json"
	}
	rootDir := filepath.Dir(exePath)
	return filepath.Join(rootDir, "apps", "web-nav", "links-store.json")
}

func loadWebNavStore() error {
	storePath := getWebNavStorePath()
	if _, err := os.Stat(storePath); os.IsNotExist(err) {
		return nil
	}
	data, err := os.ReadFile(storePath)
	if err != nil {
		return fmt.Errorf("读取网页导航数据失败: %v", err)
	}
	var store WebNavStore
	if err := json.Unmarshal(data, &store); err != nil {
		return fmt.Errorf("解析网页导航数据失败: %v", err)
	}
	webNavMu.Lock()
	if store.Links != nil {
		webNavLinks = store.Links
	}
	webNavMu.Unlock()
	return nil
}

func saveWebNavStore() error {
	storePath := getWebNavStorePath()
	storeDir := filepath.Dir(storePath)
	if err := os.MkdirAll(storeDir, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %v", err)
	}
	webNavMu.RLock()
	store := WebNavStore{Links: append([]WebNavLink(nil), webNavLinks...)}
	webNavMu.RUnlock()
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化网页导航数据失败: %v", err)
	}
	if err := os.WriteFile(storePath, data, 0644); err != nil {
		return fmt.Errorf("写入网页导航数据失败: %v", err)
	}
	return nil
}

func initWebNav() {
	if err := loadWebNavStore(); err != nil {
		log.Printf("加载网页导航数据失败: %v", err)
	}
}

// 网页导航默认管理员 admin / admin1234
// 预生成的 bcrypt 哈希（admin1234）
const webNavAdminPasswordHash = "$2a$10$Hxx7DcpNAlReSHjolH9otuCsoIHrMZxY8gCZ4R3OFk0oKqP5C6IT2"

func checkWebNavAdmin(username, password string) bool {
	if username != "admin" {
		return false
	}
	return verifyPassword(password, webNavAdminPasswordHash)
}

func handleWebNavLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		apiMethodNotAllowed(w, "只支持POST")
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apiBadRequest(w, "请求格式错误")
		return
	}
	if !checkWebNavAdmin(req.Username, req.Password) {
		apiUnauthorized(w, "用户名或密码错误")
		return
	}
	token := generateToken()
	webNavMu.Lock()
	webNavAdminToken = token
	webNavMu.Unlock()
	jsonSuccess(w, map[string]interface{}{"token": token})
}

func checkWebNavAuth(r *http.Request) bool {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return false
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(auth, prefix) {
		return false
	}
	token := strings.TrimSpace(auth[len(prefix):])
	webNavMu.RLock()
	ok := token != "" && token == webNavAdminToken
	webNavMu.RUnlock()
	return ok
}

func handleWebNavLinks(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	switch r.Method {
	case http.MethodGet:
		webNavMu.RLock()
		links := append([]WebNavLink(nil), webNavLinks...)
		webNavMu.RUnlock()
		jsonSuccess(w, map[string]interface{}{"links": links})
		return
	case http.MethodPost:
		if !checkWebNavAuth(r) {
			apiUnauthorized(w, "需要管理员权限")
			return
		}
		var link WebNavLink
		if err := json.NewDecoder(r.Body).Decode(&link); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		if link.Title == "" || link.URL == "" {
			apiBadRequest(w, "标题和链接不能为空")
			return
		}
		link.ID = uuid.New().String()
		webNavMu.Lock()
		webNavLinks = append(webNavLinks, link)
		webNavMu.Unlock()
		if err := saveWebNavStore(); err != nil {
			log.Printf("保存网页导航失败: %v", err)
		}
		jsonSuccess(w, map[string]interface{}{"link": link})
		return
	default:
		apiMethodNotAllowed(w, "方法不允许")
		return
	}
}

func handleWebNavLinkByID(w http.ResponseWriter, r *http.Request, id string) {
	w.Header().Set("Content-Type", "application/json")
	if !checkWebNavAuth(r) {
		apiUnauthorized(w, "需要管理员权限")
		return
	}
	webNavMu.Lock()
	idx := -1
	for i := range webNavLinks {
		if webNavLinks[i].ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		webNavMu.Unlock()
		apiBadRequest(w, "链接不存在")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var link WebNavLink
		webNavMu.Unlock()
		if err := json.NewDecoder(r.Body).Decode(&link); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		if link.Title == "" || link.URL == "" {
			apiBadRequest(w, "标题和链接不能为空")
			return
		}
		link.ID = id
		webNavMu.Lock()
		webNavLinks[idx] = link
		webNavMu.Unlock()
		if err := saveWebNavStore(); err != nil {
			log.Printf("保存网页导航失败: %v", err)
		}
		jsonSuccess(w, map[string]interface{}{"link": link})
	case http.MethodDelete:
		webNavLinks = append(webNavLinks[:idx], webNavLinks[idx+1:]...)
		webNavMu.Unlock()
		if err := saveWebNavStore(); err != nil {
			log.Printf("保存网页导航失败: %v", err)
		}
		jsonSuccess(w, nil)
	default:
		webNavMu.Unlock()
		apiMethodNotAllowed(w, "方法不允许")
	}
}

func loadGovernanceAggregateDailyReportJS() string {
	b, err := governanceExamplesFS.ReadFile("scripts/aggregate-daily-report.js")
	if err != nil {
		log.Printf("读取 aggregate-daily-report.js 失败: %v", err)
		return ""
	}
	return string(b)
}

func loadGovernancePresetJS(name string) string {
	b, err := governanceExamplesFS.ReadFile("scripts/" + name)
	if err != nil {
		log.Printf("读取治理预置脚本 %s 失败: %v", name, err)
		return ""
	}
	return string(b)
}

// governancePresetDefinitions returns the canonical embedded preset definitions used to refresh persisted preset metadata.
func governancePresetDefinitions() map[string]GovernanceTask {
	now := time.Now().Format(time.RFC3339)
	return map[string]GovernanceTask{
		"数据库表行数统计": {
			Owner:       "admin",
			Name:        "数据库表行数统计",
			Type:        "scheduled",
			Description: "查询所有表的行数，输出统计报告（需关联数据库）",
			JsCode:      loadGovernancePresetJS("database-table-row-count.js"),
			CronExpr:    "0 2 * * *",
			Enabled:     false,
			CreatedAt:   now,
			Status:      "idle",
		},
		"Excel数据解析入库": {
			Owner:       "admin",
			Name:        "Excel数据解析入库",
			Type:        "interactive",
			Description: "上传Excel文件，解析内容预览，可选入库",
			JsCode:      loadGovernancePresetJS("excel-data-import.js"),
			InputType:   "file",
			AcceptExts:  []string{".xlsx", ".xls"},
			CreatedAt:   now,
			Status:      "idle",
		},
		"CSV文本解析": {
			Owner:       "admin",
			Name:        "CSV文本解析",
			Type:        "interactive",
			Description: "输入CSV格式文本，解析并展示结构化结果",
			JsCode:      loadGovernancePresetJS("csv-text-parser.js"),
			InputType:   "text",
			CreatedAt:   now,
			Status:      "idle",
		},
		"数据完整性检查": {
			Owner:       "admin",
			Name:        "数据完整性检查",
			Type:        "scheduled",
			Description: "检查数据库表的空值情况（需关联数据库）",
			JsCode:      loadGovernancePresetJS("data-integrity-check.js"),
			CronExpr:    "30 1 * * *",
			Enabled:     false,
			CreatedAt:   now,
			Status:      "idle",
		},
		"Word文档内容提取": {
			Owner:        "admin",
			Name:         "Word文档内容提取",
			Type:         "interactive",
			Description:  "上传Word，提取文本后经AI结构化并入库（AI使用「AI助手」的URL/API Key/模型）",
			JsCode:       loadGovernancePresetJS("word-content-extract.js"),
			InputType:    "file",
			ExampleFiles: []GovernanceExampleFile{{Name: "国际新闻与运输情况通报_模拟数据.docx", Path: "国际新闻与运输情况通报_模拟数据.docx"}},
			Status:       "idle",
		},
		"综合日报生成器": {
			Owner:         "admin",
			Name:          "综合日报生成器",
			Type:          "interactive",
			Description:   "上传综合日报 Word 模板 + 多份单位日报（.docx），按文件名解析日期与单位，AI 整合后生成综合日报",
			JsCode:        loadGovernanceAggregateDailyReportJS(),
			InputType:     "file",
			AcceptExts:    []string{".docx"},
			FileBatchMode: "single",
			ExampleFiles: []GovernanceExampleFile{
				{Name: "综合日报模板.docx", Path: "综合日报模板.docx"},
				{Name: "2024年4月12日单位A日报.docx", Path: "2024年4月12日单位A日报.docx"},
				{Name: "2024年4月12日单位B日报.docx", Path: "2024年4月12日单位B日报.docx"},
				{Name: "2024年4月12日单位C日报.docx", Path: "2024年4月12日单位C日报.docx"},
				{Name: "2024年4月12日单位D日报.docx", Path: "2024年4月12日单位D日报.docx"},
				{Name: "2024年4月12日单位E日报.docx", Path: "2024年4月12日单位E日报.docx"},
			},
			CreatedAt: now,
			Status:    "idle",
		},
		"国际新闻入库": {
			Owner:         "admin",
			Name:          "国际新闻入库",
			Type:          "interactive",
			Description:   "上传国际新闻与运输情况通报 Word 文档，提取结构化数据入库",
			JsCode:        loadGovernancePresetJS("international-news-import.js"),
			InputType:     "file",
			AcceptExts:    []string{".docx"},
			FileBatchMode: "single",
			ExampleFiles: []GovernanceExampleFile{
				{Name: "19990101_国际新闻与运输情况通报_模拟数据.docx", Path: "19990101_国际新闻与运输情况通报_模拟数据.docx"},
				{Name: "19990102_国际新闻与运输情况通报_模拟数据.docx", Path: "19990102_国际新闻与运输情况通报_模拟数据.docx"},
				{Name: "19990103_国际新闻与运输情况通报_模拟数据.docx", Path: "19990103_国际新闻与运输情况通报_模拟数据.docx"},
			},
			CreatedAt: now,
			Status:    "idle",
		},
	}
}

// syncGovernancePresetExamplesFromEmbed 将 embed 中的预置示例元数据同步到内存中的任务并写入 data-store。
// 仅处理名称与内置预置完全一致的任务，不会修改用户自建任务。
// includeJS 为 true 时，将「综合日报生成器」的 js_code 替换为 embed 内最新脚本（慎用：会覆盖用户对该任务的代码修改）。
func syncGovernancePresetExamplesFromEmbed(includeJS bool) int {
	now := time.Now().Format(time.RFC3339)
	updated := 0
	presetDefs := governancePresetDefinitions()
	for _, t := range governanceTasks {
		if t == nil {
			continue
		}
		def, ok := presetDefs[t.Name]
		if !ok {
			continue
		}
		changed := false
		if t.Owner != def.Owner {
			t.Owner = def.Owner
			changed = true
		}
		if t.Name != def.Name {
			t.Name = def.Name
			changed = true
		}
		if t.Type != def.Type {
			t.Type = def.Type
			changed = true
		}
		if t.Description != def.Description {
			t.Description = def.Description
			changed = true
		}
		if t.InputType != def.InputType {
			t.InputType = def.InputType
			changed = true
		}
		if !reflect.DeepEqual(t.AcceptExts, def.AcceptExts) {
			t.AcceptExts = append([]string(nil), def.AcceptExts...)
			changed = true
		}
		if t.RegisterAsAPI != def.RegisterAsAPI {
			t.RegisterAsAPI = def.RegisterAsAPI
			changed = true
		}
		if t.APIPath != def.APIPath {
			t.APIPath = def.APIPath
			changed = true
		}
		if t.APIMethod != def.APIMethod {
			t.APIMethod = def.APIMethod
			changed = true
		}
		if t.FileBatchMode != def.FileBatchMode {
			t.FileBatchMode = def.FileBatchMode
			changed = true
		}
		if t.Runtime != def.Runtime {
			t.Runtime = def.Runtime
			changed = true
		}
		if t.RunMode != def.RunMode {
			t.RunMode = def.RunMode
			changed = true
		}
		if t.ExecutionMode != def.ExecutionMode {
			t.ExecutionMode = def.ExecutionMode
			changed = true
		}
		if !reflect.DeepEqual(t.ExampleFiles, def.ExampleFiles) {
			t.ExampleFiles = append([]GovernanceExampleFile(nil), def.ExampleFiles...)
			changed = true
		}
		if t.CronExpr != def.CronExpr {
			t.CronExpr = def.CronExpr
			changed = true
		}
		if t.Enabled != def.Enabled {
			t.Enabled = def.Enabled
			changed = true
		}
		if includeJS && def.JsCode != "" {
			if t.JsCode != def.JsCode {
				t.JsCode = def.JsCode
				changed = true
			}
		}
		if changed {
			t.UpdatedAt = now
			updated++
		}
	}
	return updated
}

// ensureGovernanceExampleFiles 为已持久化的预置任务补全示例文件元数据（兼容旧数据，逻辑已由 syncGovernancePresetExamplesFromEmbed 覆盖）
func ensureGovernanceExampleFiles() {
	if n := syncGovernancePresetExamplesFromEmbed(false); n > 0 {
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存示例文件元数据失败: %v", err)
		}
	}
}

// 初始化默认管理员账号
func initDataOntology() {
	// 先尝试加载持久化数据
	if err := loadDataOntologyStore(); err != nil {
		log.Printf("加载持久化数据失败: %v", err)
	}
	ensureGovernanceExampleFiles()

	// 如果没有用户，创建默认管理员账号
	dataOntologyMu.Lock()
	if len(dataOntologyUsers) == 0 {
		hashedPassword := hashPassword("admin1234")
		dataOntologyUsers["admin"] = &User{
			Username: "admin",
			Password: hashedPassword,
		}
		log.Println("已创建默认管理员账号: admin/admin1234")

		// 保存初始数据
		dataOntologyMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存初始数据失败: %v", err)
		}
		dataOntologyMu.Lock()
	}
	dataOntologyMu.Unlock()

	// 如果没有治理任务，创建示例任务
	dataOntologyMu.Lock()
	if len(governanceTasks) == 0 {
		now := time.Now().Format(time.RFC3339)

		// 示例1: 定时任务 - 数据库表统计
		scheduledID := uuid.New().String()
		governanceTasks[scheduledID] = &GovernanceTask{
			ID:          scheduledID,
			Owner:       "admin",
			Name:        "数据库表行数统计",
			Type:        "scheduled",
			Description: "查询所有表的行数，输出统计报告（需关联数据库）",
			JsCode:      "// 定时任务：统计数据库所有表的行数（支持 MySQL / 达梦等）\nconst dbType = gov.getDbType();\nlet tableList = [];\nif (dbType === 'dm') {\n  const rows = await gov.querySQL('SELECT TABLE_NAME FROM USER_TABLES');\n  tableList = rows.map(r => r.TABLE_NAME != null ? r.TABLE_NAME : r.table_name);\n} else {\n  const rows = await gov.querySQL('SHOW TABLES');\n  tableList = rows.map(r => Object.values(r)[0]);\n}\nconst q = (t) => { if (dbType === 'oracle') return '\"' + String(t).replace(/\"/g, '\"\"') + '\"'; if (dbType === 'dm') return String(t); if (dbType === 'mysql' || dbType === 'mariadb' || dbType === 'tidb') return '`' + String(t).replace(/`/g, '``') + '`'; return t; };\ngov.log('='.repeat(40));\ngov.log(`共 ${tableList.length} 张表`);\ngov.log('='.repeat(40));\nfor (const tableName of tableList) {\n  const result = await gov.querySQL(`SELECT COUNT(*) as cnt FROM ${q(tableName)}`);\n  const cnt = result && result[0] ? (result[0].cnt ?? result[0].CNT ?? 0) : 0;\n  gov.log(`  ${String(tableName).padEnd(30)} ${cnt} 行`);\n}\ngov.log('='.repeat(40));\ngov.log('统计完成');",
			CronExpr:    "0 2 * * *",
			Enabled:     false,
			CreatedAt:   now,
			Status:      "idle",
		}

		// 示例2: 交互任务 - Excel数据导入
		interactiveID := uuid.New().String()
		governanceTasks[interactiveID] = &GovernanceTask{
			ID:          interactiveID,
			Owner:       "admin",
			Name:        "Excel数据解析入库",
			Type:        "interactive",
			Description: "上传Excel文件，解析内容预览，可选入库",
			JsCode:      "// Excel 数据解析预览 + 入「当前关联的单个库」的指定表\n\nconst workbook = await gov.readExcel(INPUT_FILE);\nconst sheetName = workbook.SheetNames[0];\nconst data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });\nconst headers = data[0];\nconst rows = data.slice(1);\n\ngov.log(`工作表: ${sheetName}`);\ngov.log(`总行数: ${rows.length}, 列数: ${headers.length}`);\ngov.log(`表头: ${headers.join(', ')}`);\n\ngov.log('\\n--- 数据预览 (前5行) ---');\nfor (let i = 0; i < Math.min(5, rows.length); i++) {\n    gov.log(`  行${i + 1}: ${rows[i].join(' | ')}`);\n}\n\n// 入当前任务关联的单个库的某张表（编辑任务时可选择关联数据库）\nconst tableName = 'your_table';\nconst insertCols = ['col1', 'col2', 'col3'];\nlet n = 0;\ntry {\n  for (let i = 0; i < rows.length; i++) {\n    const row = rows[i];\n    await gov.executeSQL(`INSERT INTO ${tableName} (${insertCols.join(',')}) VALUES (?,?,?)`, [row[0], row[1], row[2] ?? null]);\n    n++;\n  }\n  gov.log(`\\n入库完成: ${tableName} 写入 ${n} 行`);\n} catch (e) {\n  gov.log('\\n入库失败: ' + e.message);\n  gov.log('请编辑任务：1) 关联一个数据库 2) 修改上面 tableName、insertCols 与列数');\n}\n",
			InputType:   "file",
			AcceptExts:  []string{".xlsx", ".xls"},
			CreatedAt:   now,
			Status:      "idle",
		}

		// 示例3: 交互任务 - CSV文本解析
		textTaskID := uuid.New().String()
		governanceTasks[textTaskID] = &GovernanceTask{
			ID:          textTaskID,
			Owner:       "admin",
			Name:        "CSV文本解析",
			Type:        "interactive",
			Description: "输入CSV格式文本，解析并展示结构化结果",
			JsCode:      "// CSV 文本解析预览\n\nconst result = Papa.parse(INPUT_TEXT, { header: true });\n\ngov.log(`列数: ${result.meta.fields.length}`);\ngov.log(`表头: ${result.meta.fields.join(', ')}`);\ngov.log(`数据行数: ${result.data.length}`);\n\ngov.log('\\n--- 数据预览 (前5行) ---');\nfor (let i = 0; i < Math.min(5, result.data.length); i++) {\n    const row = result.data[i];\n    gov.log(`行 ${i + 1}: ${Object.values(row).join(' | ')}`);\n}\ngov.log(`\\n提示: 使用\"入库代码生成助手\"可快速生成入库代码`);",
			InputType:   "text",
			CreatedAt:   now,
			Status:      "idle",
		}

		// 示例4: 定时任务 - 数据完整性检查
		syncCheckID := uuid.New().String()
		governanceTasks[syncCheckID] = &GovernanceTask{
			ID:          syncCheckID,
			Owner:       "admin",
			Name:        "数据完整性检查",
			Type:        "scheduled",
			Description: "检查数据库表的空值情况（需关联数据库）",
			JsCode:      "// 定时任务：检查各表的数据完整性（支持 MySQL / 达梦等）\nconst dbType = gov.getDbType();\nlet tableList = [];\nif (dbType === 'dm') {\n  const rows = await gov.querySQL('SELECT TABLE_NAME FROM USER_TABLES');\n  tableList = rows.map(r => r.TABLE_NAME != null ? r.TABLE_NAME : r.table_name);\n} else {\n  const rows = await gov.querySQL('SHOW TABLES');\n  tableList = rows.map(r => Object.values(r)[0]);\n}\nconst q = (t) => { if (dbType === 'oracle') return '\"' + String(t).replace(/\"/g, '\"\"') + '\"'; if (dbType === 'dm') return String(t); if (dbType === 'mysql' || dbType === 'mariadb' || dbType === 'tidb') return '`' + String(t).replace(/`/g, '``') + '`'; return t; };\nconst now = new Date().toLocaleString();\ngov.log(`数据完整性检查报告 - ${now}`);\ngov.log('='.repeat(50));\nfor (const tableName of tableList) {\n  gov.log(`\\n[${tableName}]`);\n  let columns = [];\n  if (dbType === 'dm') {\n    const rows = await gov.querySQL(`SELECT COLUMN_NAME, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '${String(tableName).replace(/'/g, \"''\").toUpperCase()}' ORDER BY COLUMN_ID`);\n    columns = rows.map(r => ({ name: r.COLUMN_NAME ?? r.column_name, nullable: (r.NULLABLE ?? r.nullable) === 'Y' }));\n  } else {\n    const rows = await gov.querySQL(`SHOW COLUMNS FROM ${q(tableName)}`);\n    columns = rows.map(r => ({ name: r.Field, nullable: r.Null === 'YES' }));\n  }\n  const countResult = await gov.querySQL(`SELECT COUNT(*) as cnt FROM ${q(tableName)}`);\n  const totalCnt = countResult && countResult[0] ? (countResult[0].cnt ?? countResult[0].CNT ?? 0) : 0;\n  for (const col of columns) {\n    if (col.nullable) {\n      const colQ = q(col.name);\n      const nullResult = await gov.querySQL(`SELECT COUNT(*) as cnt FROM ${q(tableName)} WHERE ${colQ} IS NULL`);\n      const n = nullResult && nullResult[0] ? (nullResult[0].cnt ?? nullResult[0].CNT ?? 0) : 0;\n      if (n > 0) gov.log(`  ⚠ ${col.name}: ${n} 个空值`);\n    }\n  }\n  gov.log(`  总行数: ${totalCnt}, 列数: ${columns.length}`);\n}\ngov.log('='.repeat(50));\ngov.log('检查完成');",
			CronExpr:    "30 1 * * *",
			Enabled:     false,
			CreatedAt:   now,
			Status:      "idle",
		}

		// 示例5: 交互任务 - Word文档解析
		docTaskID := uuid.New().String()
		governanceTasks[docTaskID] = &GovernanceTask{
			ID:          docTaskID,
			Owner:       "admin",
			Name:        "Word文档内容提取",
			Type:        "interactive",
			Description: "上传Word，提取文本后经AI结构化并入库（AI使用「AI助手」的URL/API Key/模型）",
			JsCode:      "// 1. 读取 Word 得到非结构化文本\nconst result = await gov.readWord(INPUT_FILE);\nconst rawText = result.value || '';\ngov.log('Word 原文长度: ' + rawText.length + ' 字符');\nif (result.messages && result.messages.length > 0) {\n  result.messages.forEach(m => gov.log(`  ${m.type}: ${m.message}`));\n}\n\n// 2. 使用 AI（与 AI 助手相同的 API URL / API Key / Model）将非结构化文本整理为结构化数据\nconst prompt = `你是一个文本结构化助手。请将下面从 Word 文档提取的非结构化文本，整理为结构化数据。\n要求：只输出一个 JSON 数组，每项为对象，包含字段 title（标题）、summary（摘要）、content（对应段落或条目的正文）。若原文无明确标题/摘要，可据内容归纳。不要输出任何 markdown 或解释，仅输出 JSON 数组。\n\n原文：\n${rawText.slice(0, 6000)}`;\n\nlet structured = [];\ntry {\n  const aiText = await gov.callAI(prompt);\n  const jsonMatch = aiText.match(/\\[([\\s\\S]*)\\]/);\n  const jsonStr = jsonMatch ? '[' + jsonMatch[1] + ']' : aiText;\n  structured = JSON.parse(jsonStr);\n  gov.log('AI 结构化得到 ' + structured.length + ' 条');\n} catch (e) {\n  gov.log('AI 结构化失败: ' + e.message);\n  gov.log('原文前 500 字: ' + rawText.slice(0, 500));\n}\n\n// 3. 若关联了数据库，则写入表（请按实际表结构修改表名和列）\nconst tableName = 'doc_extracts';\nconst dbType = gov.getDbType();\nif (structured.length > 0 && dbType) {\n  let n = 0;\n  for (const row of structured) {\n    try {\n      await gov.executeSQL(\n        'INSERT INTO ' + tableName + ' (title, summary, content) VALUES (?, ?, ?)',\n        [row.title || '', row.summary || '', row.content || '']\n      );\n      n++;\n    } catch (e) {\n      gov.log('写入失败: ' + e.message);\n    }\n  }\ngov.log('入库完成: ' + tableName + ' 写入 ' + n + ' 条');\n} else if (structured.length > 0) {\n  gov.log('未关联数据库，仅展示结构化结果（关联数据库后可自动入库）');\n  structured.slice(0, 5).forEach((r, i) => gov.log(`  [${i+1}] ${(r.title || '').slice(0, 30)}`));\n}\ngov.log('文档处理完成');",
			InputType:   "file",
			AcceptExts:  []string{".docx"},
			ExampleFiles: []GovernanceExampleFile{
				{Name: "国际新闻与运输情况通报_模拟数据.docx", Path: "国际新闻与运输情况通报_模拟数据.docx"},
			},
			CreatedAt: now,
			Status:    "idle",
		}

		// 示例6: 交互任务 - 综合日报生成器（多文件一次执行 + LLM + docxtemplater）
		reportTaskID := uuid.New().String()
		governanceTasks[reportTaskID] = &GovernanceTask{
			ID:            reportTaskID,
			Owner:         "admin",
			Name:          "综合日报生成器",
			Type:          "interactive",
			Description:   "上传综合日报 Word 模板 + 多份单位日报（.docx），按文件名解析日期与单位，AI 整合后生成综合日报",
			JsCode:        loadGovernanceAggregateDailyReportJS(),
			InputType:     "file",
			AcceptExts:    []string{".docx"},
			FileBatchMode: "single",
			ExampleFiles: []GovernanceExampleFile{
				{Name: "综合日报模板.docx", Path: "综合日报模板.docx"},
				{Name: "2024年4月12日单位A日报.docx", Path: "2024年4月12日单位A日报.docx"},
				{Name: "2024年4月12日单位B日报.docx", Path: "2024年4月12日单位B日报.docx"},
				{Name: "2024年4月12日单位C日报.docx", Path: "2024年4月12日单位C日报.docx"},
				{Name: "2024年4月12日单位D日报.docx", Path: "2024年4月12日单位D日报.docx"},
				{Name: "2024年4月12日单位E日报.docx", Path: "2024年4月12日单位E日报.docx"},
			},
			CreatedAt: now,
			Status:    "idle",
		}

		// 示例7: 交互任务 - 国际新闻入库
		newsTaskID := uuid.New().String()
		governanceTasks[newsTaskID] = &GovernanceTask{
			ID:          newsTaskID,
			Owner:       "admin",
			Name:        "国际新闻入库",
			Type:        "interactive",
			Description: "上传国际新闻与运输情况通报 Word 文档，提取结构化数据入库",
			JsCode: `* 国际新闻入库脚本 — DataToolbox Gov Task
 *
 * 三张表：
 *   1. intl_news        国际新闻动态  (新闻内码, 时间, 区域, 事件)
 *   2. transport_support 运输保障情况  (运保内码, 时间, 区域, 运输情况)
 *   3. dispatch_force    保障力量出动  (出动内码, 运保内码, 装备型号, 架次, 批次)
 *
 * 流程：原始新闻文本 → gov.callAI 分块结构化解析 → gov.executeSQL 批量入库
 * 数据库：达梦(DM)，绑定到任务即可使用
 */

// ============================================================
// 1. DDL — 达梦建表语句（在任务中执行一次即可）
// ============================================================

const DDL = [
    '-- 国际新闻动态',
    'CREATE TABLE IF NOT EXISTS intl_news (',
    '    news_id       VARCHAR(64)   NOT NULL,',
    '    news_time     TIMESTAMP,',
    '    region        VARCHAR(128),',
    '    event         TEXT,',
    '    PRIMARY KEY (news_id)',
    ');',
    '',
    '-- 运输保障情况',
    'CREATE TABLE IF NOT EXISTS transport_support (',
    '    support_id    VARCHAR(64)   NOT NULL,',
    '    support_time  TIMESTAMP,',
    '    region        VARCHAR(128),',
    '    transport_info TEXT,',
    '    PRIMARY KEY (support_id)',
    ');',
    '',
    '-- 保障力量出动情况',
    'CREATE TABLE IF NOT EXISTS dispatch_force (',
    '    dispatch_id   VARCHAR(64)   NOT NULL,',
    '    support_id    VARCHAR(64),',
    '    equip_model   VARCHAR(128),',
    '    sorties       INT,',
    '    batches       INT,',
    '    PRIMARY KEY (dispatch_id)',
    ');',
].join('\n');

// ============================================================
// 2. AI Prompt 模板
// ============================================================

/**
 * 核心 Prompt：要求 LLM 从新闻文本中提取三张表的结构化数据
 * 输出严格 JSON，方便后续直接解析入库
 */
const EXTRACT_PROMPT = [
    '',
    '要求：',
    '1. 提取所有新闻事件，每条事件包含：时间、区域、事件描述',
    '2. 提取所有运输保障相关信息，每条包含：时间、区域、运输情况描述',
    '3. 对每条运输保障，提取对应的保障力量出动信息：装备型号、架次、批次',
    '',
    '输出格式（严格遵守，不要输出任何其他内容）：',
    '{',
    '  "news": [',
    '    {',
    '      "news_id": "NWS_yyyyMMdd_HHmmss_序号",',
    '      "news_time": "2025-01-15 08:30:00",',
    '      "region": "某某区域",',
    '      "event": "事件描述"',
    '    }',
    '  ],',
    '  "transport_support": [',
    '    {',
    '      "support_id": "TRS_yyyyMMdd_HHmmss_序号",',
    '      "support_time": "2025-01-15 10:00:00",',
    '      "region": "某某区域",',
    '      "transport_info": "运输情况描述",',
    '      "dispatch_force": [',
    '        {',
    '          "dispatch_id": "DSP_yyyyMMdd_HHmmss_序号",',
    '          "equip_model": "运-20",',
    '          "sorties": 3,',
    '          "batches": 1',
    '        }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '',
    '规则：',
    '- news_id 格式：NWS_时间戳_序号，时间取事件发生时间，序号从1开始',
    '- support_id 格式：TRS_时间戳_序号',
    '- dispatch_id 格式：DSP_时间戳_序号',
    '- 时间格式：yyyy-MM-dd HH:mm:ss，无法确定具体时间的用新闻发布时间',
    '- 如果某条新闻没有运输保障信息，transport_support 数组为空即可',
    '- dispatch_force 中的 support_id 必须与上层 transport_support 的 support_id 一致',
    '- sorties（架次）和 batches（批次）必须为整数，无法提取则为 null',
].join('\n');

/**
 * 分块 Prompt：当新闻文本过长时，先拆分为多个分块分别提取
 */
const CHUNK_EXTRACT_PROMPT = [
    '',
    '{base_prompt}',
    '',
].join('\n');

// ============================================================
// 3. 核心逻辑
// ============================================================

/**
 * 生成唯一 ID
 */
function generateId(prefix, index = 1) {
    const now = new Date();
    const ts = now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') +
        '_' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
    return prefix + '_' + ts + '_' + String(index).padStart(3, '0');
}

/**
 * 分块：将长文本拆分为多段
 * @param {string} text - 原始文本
 * @param {number} maxChars - 每块最大字符数（默认 3000，预留 prompt 空间）
 * @returns {string[]} 文本块数组
 */
function chunkText(text, maxChars = 3000) {
    if (text.length <= maxChars) return [text];

    const chunks = [];
    // 按段落分割，尽量在段落边界断开
    const paragraphs = text.split(/\\n+/);
    let current = '';

    for (const para of paragraphs) {
        if (current.length + para.length + 1 > maxChars && current.length > 0) {
            chunks.push(current.trim());
            current = '';
        }
        current += (current ? '\\n' : '') + para;
    }
    if (current.trim()) chunks.push(current.trim());

    // 如果某块仍然超长，强制截断
    return chunks.map(c => c.length > maxChars * 1.5 ? c.slice(0, maxChars * 1.5) : c);
}

/**
 * 从 AI 返回文本中解析 JSON（兼容 markdown 代码块包裹的情况）
 */
function parseAIResponse(text) {
    // 去掉可能的 markdown 代码块包裹
    const BACKTICK3 = String.fromCharCode(96,96,96);
    let cleaned = text.trim();
    if (cleaned.startsWith(BACKTICK3 + 'json')) {
        cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith(BACKTICK3)) {
        cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith(BACKTICK3)) {
        cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        // 尝试从文本中找到 JSON 对象
        const startIdx = cleaned.indexOf('{');
        const lastIdx = cleaned.lastIndexOf('}');
        if (startIdx >= 0 && lastIdx > startIdx) {
            const jsonStr = cleaned.slice(startIdx, lastIdx + 1);
            try {
                return JSON.parse(jsonStr);
            } catch (e2) {
        throw new Error('JSON 解析失败: ' + e2.message + '\\\\n原始文本: ' + cleaned.slice(0, 200));
            }
        }
        throw new Error('AI 返回内容中未找到有效 JSON: ' + cleaned.slice(0, 200));
    }
}

/**
 * 合并多个分块的提取结果，去重并修正 ID
 */
function mergeChunkResults(results) {
    const merged = { news: [], transport_support: [] };

    for (const result of results) {
        if (result.news) merged.news.push(...result.news);
        if (result.transport_support) {
            for (const ts of result.transport_support) {
                merged.transport_support.push(ts);
            }
        }
    }

    // 重新生成 ID 去重
    let newsIdx = 1;
    const idMap = {}; // old_id -> new_id 映射
    for (const item of merged.news) {
        const newId = generateId('NWS', newsIdx++);
        idMap[item.news_id] = newId;
        item.news_id = newId;
    }

    let supportIdx = 1;
    for (const ts of merged.transport_support) {
        const oldSupportId = ts.support_id;
        const newSupportId = generateId('TRS', supportIdx++);
        idMap[oldSupportId] = newSupportId;
        ts.support_id = newSupportId;

        if (ts.dispatch_force) {
            let dispatchIdx = 1;
            for (const df of ts.dispatch_force) {
                df.support_id = newSupportId; // 关联上层
                df.dispatch_id = generateId('DSP', dispatchIdx++);
            }
        }
    }

    return merged;
}

/**
 * 简单去重：按 (时间+区域+事件描述) 去重新闻
 */
function deduplicateNews(newsList) {
    const seen = new Set();
    return newsList.filter(item => {
        const key = (item.news_time + '|' + item.region + '|' + item.event).slice(0, 200);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * 入库：将解析结果写入达梦数据库
 */
async function insertToDatabase(data) {
    const results = { news: 0, transport_support: 0, dispatch_force: 0, errors: [] };

    // 1. 入库国际新闻
    for (const item of data.news) {
        try {
            const sql = 'INSERT INTO intl_news (news_id, news_time, region, event) VALUES (?, ?, ?, ?)';
            const affected = await gov.executeSQL(sql, [
                item.news_id,
                item.news_time,
                item.region || '',
                item.event || ''
            ]);
            results.news += affected;
        } catch (e) {
            results.errors.push('新闻入库失败 [' + item.news_id + ']: ' + e.message);
            gov.log('⚠ 新闻入库失败 [' + item.news_id + ']: ' + e.message);
        }
    }

    // 2. 入库运输保障 + 保障力量出动
    for (const item of data.transport_support) {
        try {
            const sql = 'INSERT INTO transport_support (support_id, support_time, region, transport_info) VALUES (?, ?, ?, ?)';
            const affected = await gov.executeSQL(sql, [
                item.support_id,
                item.support_time,
                item.region || '',
                item.transport_info || ''
            ]);
            results.transport_support += affected;
        } catch (e) {
            results.errors.push('运保入库失败 [' + item.support_id + ']: ' + e.message);
            gov.log('⚠ 运保入库失败 [' + item.support_id + ']: ' + e.message);
            continue; // 运保失败则跳过对应的出动
        }

        // 3. 入库保障力量出动
        if (item.dispatch_force) {
            for (const df of item.dispatch_force) {
                try {
                    const sql = 'INSERT INTO dispatch_force (dispatch_id, support_id, equip_model, sorties, batches) VALUES (?, ?, ?, ?, ?)';
                    const affected = await gov.executeSQL(sql, [
                        df.dispatch_id,
                        df.support_id,
                        df.equip_model || '',
                        df.sorties != null ? df.sorties : 0,
                        df.batches != null ? df.batches : 0
                    ]);
                    results.dispatch_force += affected;
                } catch (e) {
            results.errors.push('动出入库失败 [' + df.dispatch_id + ']: ' + e.message);
                    gov.log('⚠ 动出入库失败 [' + df.dispatch_id + ']: ' + e.message);
                }
            }
        }
    }

    return results;
}

/**
 * 查询已有数据量（用于幂等判断）
 */
async function checkExistingData() {
    try {
        const newsCount = await gov.querySQL('SELECT COUNT(*) AS CNT FROM intl_news');
        const supportCount = await gov.querySQL('SELECT COUNT(*) AS CNT FROM transport_support');
        const dispatchCount = await gov.querySQL('SELECT COUNT(*) AS CNT FROM dispatch_force');
        return {
            news: newsCount[0]?.CNT || 0,
            transport_support: supportCount[0]?.CNT || 0,
            dispatch_force: dispatchCount[0]?.CNT || 0
        };
    } catch (e) {
        gov.log('查询已有数据失败（表可能不存在）: ' + e.message);
        return null;
    }
}

// ============================================================
// 4. 主入口
// ============================================================

/**
 * 主处理流程
 * INPUT_TEXT: 任务输入的原始新闻文本
 *
 * 使用方式：
 *   在 DataToolbox 数据治理任务中，粘贴新闻文本作为输入，
 *   关联达梦数据库，运行此脚本即可自动解析入库。
 */
async function main() {
    gov.log('=== 国际新闻入库流程启动 ===');

    // -- Step 0: 初始化数据库表 --
    try {
        // 达梦建表（IF NOT EXISTS 保证幂等）
        const ddlStatements = DDL.split(';').map(s => s.trim()).filter(s => s && !s.startsWith('--'));
        for (const stmt of ddlStatements) {
            if (stmt) {
                await gov.executeSQL(stmt);
            }
        }
        gov.log('✓ 数据库表初始化完成');
    } catch (e) {
        gov.log('⚠ 建表可能已存在，跳过: ' + e.message);
    }

    // -- Step 1: 获取输入 --
    const rawText = typeof INPUT_TEXT !== 'undefined' ? INPUT_TEXT : '';
    if (!rawText || rawText.trim().length === 0) {
        gov.log('✗ 未提供新闻文本输入（INPUT_TEXT 为空）');
        return;
    }
    gov.log('✓ 获取输入文本，共 ' + rawText.length + ' 字符');

    // -- Step 2: 分块 + AI 提取 --
    const chunks = chunkText(rawText);
    gov.log('✓ 文本分为 ' + chunks.length + ' 块进行处理');

    const extractResults = [];
    for (let i = 0; i < chunks.length; i++) {
        const chunkIndex = i + 1;
        gov.log('→ 正在处理第 ' + chunkIndex + '/' + chunks.length + ' 块...');

        let prompt;
        if (chunks.length === 1) {
            prompt = EXTRACT_PROMPT + '\\n\\n---\\n新闻文本：\\n' + chunks[i];
        } else {
            prompt = CHUNK_EXTRACT_PROMPT
                .replace('{chunk_index}', chunkIndex)
                .replace('{total_chunks}', chunks.length)
                .replace('{base_prompt}', EXTRACT_PROMPT)
                + '\\n\\n---\\n新闻文本：\\n' + chunks[i];
        }

        try {
            const aiResponse = await gov.callAI(prompt);
            const parsed = parseAIResponse(aiResponse);
            extractResults.push(parsed);
            gov.log('  ✓ 第 ' + chunkIndex + ' 块提取完成: ' + parsed.news?.length || 0 + ' 条新闻, ' + parsed.transport_support?.length || 0 + ' 条运保');
        } catch (e) {
            gov.log('  ✗ 第 ' + chunkIndex + ' 块 AI 提取失败: ' + e.message);
            // 继续下一块
        }
    }

    if (extractResults.length === 0) {
        gov.log('✗ 所有分块提取均失败，流程终止');
        return;
    }

    // -- Step 3: 合并结果 + 去重 --
    const merged = mergeChunkResults(extractResults);
    merged.news = deduplicateNews(merged.news);

    gov.log('✓ 合并后共: ' + merged.news.length + ' 条新闻, ' + merged.transport_support.length + ' 条运保');

    // 展示提取结果
    gov.showTable(merged.news.map(n => ({
        新闻内码: n.news_id,
        时间: n.news_time,
        区域: n.region,
        事件: n.event?.slice(0, 50) + '...'
    })));

    // -- Step 4: 入库 --
    gov.log('→ 开始入库...');
    const insertResult = await insertToDatabase(merged);

    gov.log('=== 入库结果 ===');
    gov.log('  国际新闻: ' + insertResult.news + ' 条');
    gov.log('  运输保障: ' + insertResult.transport_support + ' 条');
    gov.log('  保障力量出动: ' + insertResult.dispatch_force + ' 条');
    if (insertResult.errors.length > 0) {
        gov.log('  ⚠ 错误: ' + insertResult.errors.length + ' 条');
        insertResult.errors.forEach(e => gov.log('    - ' + e));
    }

    // -- Step 5: 验证 --
    const finalCount = await checkExistingData();
    if (finalCount) {
        gov.log('=== 数据库当前数据量 ===');
        gov.showTable([{
            国际新闻: finalCount.news,
            运输保障: finalCount.transport_support,
            保障力量出动: finalCount.dispatch_force
        }]);
    }

    gov.log('=== 国际新闻入库流程完成 ===');
}

// 执行
main().catch(e => {
    gov.log('✗ 流程异常: ' + e.message);`,
			InputType:     "file",
			AcceptExts:    []string{".docx"},
			FileBatchMode: "single",
			ExampleFiles: []GovernanceExampleFile{
				{Name: "19990101_国际新闻与运输情况通报_模拟数据.docx", Path: "19990101_国际新闻与运输情况通报_模拟数据.docx"},
				{Name: "19990102_国际新闻与运输情况通报_模拟数据.docx", Path: "19990102_国际新闻与运输情况通报_模拟数据.docx"},
				{Name: "19990103_国际新闻与运输情况通报_模拟数据.docx", Path: "19990103_国际新闻与运输情况通报_模拟数据.docx"},
			},
			CreatedAt: now,
			Status:    "idle",
		}

		log.Printf("已创建 %d 个示例治理任务", len(governanceTasks))

		dataOntologyMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存示例治理任务失败: %v", err)
		}
		dataOntologyMu.Lock()
	}
	dataOntologyMu.Unlock()

	log.Printf("数据本体池初始化完成 - 用户数: %d, 数据库配置数: %d, 治理任务数: %d",
		len(dataOntologyUsers), len(dataOntologyDatabases), len(governanceTasks))

	initQualityAuditDB()

	// 进程重启后内存队列已清空，持久化仍为「运行中」的任务无法继续，需收尾以免状态与日志长期不一致
	reconcileStuckGovernanceRuns()

	// 启动治理任务 worker（后台执行器）
	go governanceWorker()

	// 启动治理任务调度器
	go governanceScheduler()
}

// 密码哈希 - 使用 bcrypt
func isBcryptHash(s string) bool {
	return strings.HasPrefix(s, "$2a$") || strings.HasPrefix(s, "$2b$") || strings.HasPrefix(s, "$2y$")
}

func hashPassword(password string) string {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		// bcrypt 失败时回退到简单哈希（不应发生）
		log.Printf("bcrypt 哈希失败: %v", err)
		return ""
	}
	return string(hash)
}

// 验证密码 - 支持 bcrypt 和旧的 MD5 哈希（向后兼容）
func verifyPassword(password, hashedPassword string) bool {
	// 检查是否是 bcrypt 哈希（以 $2a$、$2b$ 或 $2y$ 开头）
	if strings.HasPrefix(hashedPassword, "$2a$") || strings.HasPrefix(hashedPassword, "$2b$") || strings.HasPrefix(hashedPassword, "$2y$") {
		err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password))
		return err == nil
	}
	// 旧的 MD5 哈希（向后兼容）- 已弃用，仅用于迁移
	return false
}

// safeErrorMessage 返回安全的错误消息，避免泄露敏感信息
// 对于数据库错误、连接错误等，返回通用消息；对于用户输入错误，返回具体提示
func safeErrorMessage(err error, defaultMsg string) string {
	if err == nil {
		return defaultMsg
	}
	errStr := err.Error()

	// 检测敏感关键词，返回通用错误消息
	sensitivePatterns := []string{
		"password", "passwd", "secret", "token", "key", "credential",
		"connection string", "dsn", "sql:", "driver:",
		"access denied", "authentication", "permission",
	}
	lowerErr := strings.ToLower(errStr)
	for _, pattern := range sensitivePatterns {
		if strings.Contains(lowerErr, pattern) {
			log.Printf("安全过滤错误消息: %s", errStr)
			return defaultMsg
		}
	}

	// 对于已知的安全错误类型，可以返回具体消息
	// 如：唯一约束冲突、外键约束等
	if strings.Contains(errStr, "UNIQUE constraint") ||
		strings.Contains(errStr, "duplicate key") ||
		strings.Contains(errStr, "already exists") {
		return "记录已存在"
	}
	if strings.Contains(errStr, "FOREIGN KEY constraint") ||
		strings.Contains(errStr, "foreign key") {
		return "关联数据不存在"
	}
	if strings.Contains(errStr, "NOT NULL constraint") ||
		strings.Contains(errStr, "cannot be null") {
		return "必填字段不能为空"
	}

	// 其他错误返回默认消息，但记录详细日志
	log.Printf("错误详情: %s", errStr)
	return defaultMsg
}

// 生成Token
func generateToken() string {
	return uuid.New().String()
}

// 构建数据库连接字符串
func buildDSN(config *DatabaseConfig) (string, string, error) {
	switch config.Type {
	case "mysql", "mariadb":
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=True&loc=Local&timeout=10s&readTimeout=30s&writeTimeout=30s",
			config.User, config.Password, config.Host, config.Port, config.Database)
		return "mysql", dsn, nil

	case "postgresql", "timescaledb":
		dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=disable connect_timeout=10",
			config.Host, config.Port, config.User, config.Password, config.Database)
		return "postgres", dsn, nil

	case "sqlserver":
		dsn := fmt.Sprintf("sqlserver://%s:%s@%s:%d?database=%s&connection+timeout=10",
			config.User, config.Password, config.Host, config.Port, config.Database)
		return "sqlserver", dsn, nil

	case "oracle":
		// 使用 go-ora 驶动，必须提供 SID 或服务名
		if config.Database == "" {
			return "", "", fmt.Errorf("Oracle 连接需要填写 SID 或服务名（在「SID/服务名」中填写，例如 ORCL、XE）")
		}
		dsn := fmt.Sprintf("oracle://%s:%s@%s:%d/%s?TIMEOUT=10",
			config.User, config.Password, config.Host, config.Port, config.Database)
		return "oracle", dsn, nil

	case "dm":
		// 达梦数据库连接字符串
		// 格式: dm://username:password@host:port/schema
		// 需要对用户名和密码进行 URL 编码，避免特殊字符导致解析错误
		log.Printf("DM配置: 原始Host='%s', 原始Port=%d", config.Host, config.Port)

		host := config.Host
		if host == "" {
			host = "localhost"
			log.Printf("DM: Host为空，使用默认值 localhost")
		}
		port := config.Port
		if port == 0 {
			port = 5236
			log.Printf("DM: Port为0，使用默认值 5236")
		}

		// URL 编码用户名和密码，避免特殊字符（如 @、:、/ 等）导致 DSN 解析错误
		encodedUser := url.QueryEscape(config.User)
		encodedPassword := url.QueryEscape(config.Password)

		dsn := fmt.Sprintf("dm://%s:%s@%s:%d?timeout=10",
			encodedUser, encodedPassword, host, port)
		if config.Database != "" {
			dsn = fmt.Sprintf("dm://%s:%s@%s:%d/%s?timeout=10",
				encodedUser, encodedPassword, host, port, config.Database)
		}

		// 安全：不在日志中输出包含密码的 DSN
		log.Printf("DM最终DSN(已编码): driver=dm, host=%s, port=%d, database=%s", host, port, config.Database)
		return "dm", dsn, nil

	case "sqlite":
		path := strings.TrimSpace(config.Path)
		if path == "" {
			path = strings.TrimSpace(config.Database)
		}
		if path == "" {
			return "", "", fmt.Errorf("SQLite 需要配置数据库文件路径（path 或 database）")
		}
		// modernc.org/sqlite 注册的驱动名为 "sqlite"（非 mattn/go-sqlite3 的 sqlite3）
		return "sqlite", path, nil

	case "duckdb":
		// DuckDB 需要CGO支持
		return "", "", fmt.Errorf("DuckDB 支持需要CGO编译，当前构建版本不支持。请使用支持CGO的版本")

	case "tidb":
		// TiDB 兼容 MySQL 协议
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=True&timeout=10s&readTimeout=30s&writeTimeout=30s",
			config.User, config.Password, config.Host, config.Port, config.Database)
		return "mysql", dsn, nil

	case "cockroachdb":
		// CockroachDB 兼容 PostgreSQL 协议
		dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=disable connect_timeout=10",
			config.Host, config.Port, config.User, config.Password, config.Database)
		return "postgres", dsn, nil

	case "clickhouse":
		// ClickHouse 在某些构建环境中可能不可用
		return "", "", fmt.Errorf("ClickHouse 支持在当前构建版本中不可用。请使用完整版本")

	default:
		return "", "", fmt.Errorf("不支持的数据库类型: %s", config.Type)
	}
}

// 获取表列表的SQL（Oracle 使用 ALL_TABLES 排除 SYS/SYSTEM，从源头不查系统 schema，避免黑名单永远不全且驱动可能只返回部分行）
func getTablesQuery(config *DatabaseConfig) string {
	switch config.Type {
	case "mysql", "mariadb", "tidb":
		return "SHOW TABLES"
	case "postgresql", "timescaledb", "cockroachdb":
		return "SELECT tablename FROM pg_tables WHERE schemaname='public'"
	case "sqlserver":
		return "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'"
	case "oracle":
		// 排除系统 schema，但始终包含当前连接用户的 schema（OR owner = USER），这样新建的表能立即出现在列表中
		systemOwners := "'SYS','SYSTEM','OUTLN','DBSNMP','WMSYS','MDSYS','CTXSYS','XDB','EXFSYS','ORDSYS','OLAPSYS','ORACLE_OCM','OJVMSYS','LBACSYS','ANONYMOUS','APEX_PUBLIC_USER','FLOWS_FILES','OWBSYS','DIP','APPQOSSYS','DBSFWUSER','DVSYS','DVF','GSMADMIN_INTERNAL','GSMUSER','GSMROOTUSER','REMOTE_SCHEDULER_AGENT','SI_INFORMTN_SCHEMA'"
		return "SELECT owner||'.'||table_name FROM all_tables WHERE (owner NOT IN (" + systemOwners + ") OR owner = USER) " +
			"AND table_name NOT LIKE '%$%' ORDER BY owner, table_name"
	case "dm":
		// 达梦：使用 USER_TABLES 只返回当前用户的表，与 USER_TAB_COMMENTS 保持一致
		return "SELECT TABLE_NAME FROM USER_TABLES"
	case "sqlite":
		return "SELECT name FROM sqlite_master WHERE type='table'"
	case "duckdb":
		return "SELECT name FROM sqlite_master WHERE type='table'"
	case "clickhouse":
		return "SHOW TABLES"
	default:
		return "SHOW TABLES"
	}
}

// getTableComments 获取表备注（MySQL 和 SQLite 支持）
func getTableComments(db *sql.DB, config *DatabaseConfig, tableNames []string) map[string]string {
	comments := make(map[string]string)
	if len(tableNames) == 0 {
		return comments
	}

	switch config.Type {
	case "mysql", "mariadb", "tidb":
		// MySQL: 从 information_schema.TABLES 获取表备注
		query := `
			SELECT TABLE_NAME, TABLE_COMMENT
			FROM information_schema.TABLES
			WHERE TABLE_SCHEMA = ?`
		rows, err := db.Query(query, config.Database)
		if err != nil {
			log.Printf("查询 MySQL 表备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var tableName, tableComment string
			if err := rows.Scan(&tableName, &tableComment); err == nil {
				if tableComment != "" {
					comments[tableName] = tableComment
				}
			}
		}
	case "sqlite", "duckdb":
		// SQLite: 从 sqlite_master 的 sql 字段解析备注
		// SQLite 本身不支持表备注，但可以解析 CREATE TABLE 语句中的注释
		for _, tableName := range tableNames {
			quotedTable, _ := safeQuoteIdentifier(tableName, config.Type)
			query := fmt.Sprintf("SELECT sql FROM sqlite_master WHERE type='table' AND name=%s", quotedTable)
			var sqlStr string
			err := db.QueryRow(query).Scan(&sqlStr)
			if err == nil && sqlStr != "" {
				// 尝试从 SQL 中提取注释（如果有）
				comment := extractSQLiteComment(sqlStr)
				if comment != "" {
					comments[tableName] = comment
				}
			}
		}
	case "postgresql", "timescaledb", "cockroachdb":
		// PostgreSQL: 从 pg_class 和 pg_description 获取表备注
		query := `
			SELECT c.relname, d.description
			FROM pg_class c
			JOIN pg_namespace n ON c.relnamespace = n.oid
			LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = 0
			WHERE n.nspname = 'public' AND c.relkind = 'r'`
		rows, err := db.Query(query)
		if err != nil {
			log.Printf("查询 PostgreSQL 表备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var tableName, tableComment string
			if err := rows.Scan(&tableName, &tableComment); err == nil {
				if tableComment != "" {
					comments[tableName] = tableComment
				}
			}
		}
	case "oracle":
		// Oracle: 从 ALL_TAB_COMMENTS 获取表备注
		query := "SELECT TABLE_NAME, COMMENTS FROM USER_TAB_COMMENTS WHERE TABLE_TYPE = 'TABLE'"
		rows, err := db.Query(query)
		if err != nil {
			log.Printf("查询 Oracle 表备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var tableName, tableComment sql.NullString
			if err := rows.Scan(&tableName, &tableComment); err == nil {
				if tableName.Valid && tableComment.Valid && tableComment.String != "" {
					comments[tableName.String] = tableComment.String
				}
			}
		}
	case "dm":
		// 达梦: 从 USER_TAB_COMMENTS 获取表备注
		query := "SELECT TABLE_NAME, COMMENTS FROM USER_TAB_COMMENTS"
		rows, err := db.Query(query)
		if err != nil {
			log.Printf("查询达梦表备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var tableName, tableComment sql.NullString
			if err := rows.Scan(&tableName, &tableComment); err == nil {
				if tableName.Valid && tableComment.Valid && tableComment.String != "" {
					comments[tableName.String] = tableComment.String
				}
			}
		}
	case "sqlserver":
		// SQL Server: 从 sys.extended_properties 获取表备注
		query := `
			SELECT OBJECT_NAME(t.object_id) AS table_name, ep.value AS table_comment
			FROM sys.tables t
			LEFT JOIN sys.extended_properties ep ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
			WHERE SCHEMA_NAME(t.schema_id) = 'dbo'`
		rows, err := db.Query(query)
		if err != nil {
			log.Printf("查询 SQL Server 表备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var tableName, tableComment sql.NullString
			if err := rows.Scan(&tableName, &tableComment); err == nil {
				if tableName.Valid && tableComment.Valid && tableComment.String != "" {
					comments[tableName.String] = tableComment.String
				}
			}
		}
	}
	return comments
}

// extractSQLiteComment 从 SQLite CREATE TABLE 语句中提取注释
func extractSQLiteComment(sqlStr string) string {
	// 查找 /* */ 格式的注释
	if idx := strings.Index(sqlStr, "/*"); idx != -1 {
		if endIdx := strings.Index(sqlStr[idx:], "*/"); endIdx != -1 {
			comment := strings.TrimSpace(sqlStr[idx+2 : idx+endIdx])
			return comment
		}
	}
	// 查找 -- 格式的注释
	lines := strings.Split(sqlStr, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "--") {
			return strings.TrimSpace(line[2:])
		}
	}
	return ""
}

// getTableInfoList 获取数据库所有表的信息（表名、注释、字段名列表），用于检索
func getTableInfoList(dbConfig *DatabaseConfig) ([]TableInfo, error) {
	// 获取表名列表
	tableNames, err := getTablesList(dbConfig)
	if err != nil {
		return nil, err
	}

	if len(tableNames) == 0 {
		return []TableInfo{}, nil
	}

	// 获取数据库连接（用于获取表注释）
	db, err := getDBFromPool(dbConfig)
	if err != nil {
		return nil, err
	}

	// 获取表注释
	tableComments := getTableComments(db, dbConfig, tableNames)

	// 构建表信息列表
	var tableInfos []TableInfo
	for _, tableName := range tableNames {
		info := TableInfo{
			Name:    tableName,
			Comment: tableComments[tableName],
		}

		// 获取字段名列表
		columns, err := getTableColumns(dbConfig, tableName)
		if err == nil {
			var colNames []string
			for _, col := range columns {
				if colName, ok := col["name"].(string); ok {
					colNames = append(colNames, colName)
				}
			}
			info.ColumnNames = colNames
		}

		tableInfos = append(tableInfos, info)
	}

	return tableInfos, nil
}

// tokenizeQuery 对查询字符串进行简单分词（空格分隔 + 中文字符单独提取）
func tokenizeQuery(query string) []string {
	var tokens []string
	var chineseBuf strings.Builder

	// 先按空格分割
	parts := strings.Fields(query)

	for _, part := range parts {
		// 对每个部分，提取中文字符
		for _, r := range part {
			if unicode.Is(unicode.Han, r) {
				chineseBuf.WriteRune(r)
			}
		}
		// 如果有中文字符，添加为单独的 token
		if chineseBuf.Len() > 0 {
			tokens = append(tokens, chineseBuf.String())
			chineseBuf.Reset()
		}
		// 非中文部分也作为 token（转小写）
		partLower := strings.ToLower(part)
		if partLower != "" && !isAllChinese(partLower) {
			tokens = append(tokens, partLower)
		}
	}

	// 去重
	seen := make(map[string]bool)
	var result []string
	for _, t := range tokens {
		if !seen[t] {
			seen[t] = true
			result = append(result, t)
		}
	}

	return result
}

// isAllChinese 检查字符串是否全是中文字符
func isAllChinese(s string) bool {
	for _, r := range s {
		if !unicode.Is(unicode.Han, r) {
			return false
		}
	}
	return len(s) > 0
}

// keywordRetrieveTables 关键词检索算法
func keywordRetrieveTables(query string, tables []TableInfo, config *KeywordRetrievalConfig) []TableRelevanceResult {
	// 分词
	keywords := tokenizeQuery(query)
	if len(keywords) == 0 {
		return []TableRelevanceResult{}
	}

	// 默认匹配字段
	matchFields := []string{"name", "comment", "column_names"}
	if config != nil && len(config.MatchFields) > 0 {
		matchFields = config.MatchFields
	}

	// 检查是否匹配各字段
	matchName := false
	matchComment := false
	matchColumns := false
	for _, f := range matchFields {
		switch f {
		case "name":
			matchName = true
		case "comment":
			matchComment = true
		case "column_names":
			matchColumns = true
		}
	}

	var results []TableRelevanceResult

	for _, table := range tables {
		tableNameLower := strings.ToLower(table.Name)
		tableCommentLower := strings.ToLower(table.Comment)

		// 记录每个关键词的最高分数
		keywordScores := make([]float64, len(keywords))
		matchReasons := make([]string, len(keywords))

		for i, keyword := range keywords {
			keywordLower := strings.ToLower(keyword)
			var maxScore float64
			var reason string

			// 表名完全匹配
			if matchName && tableNameLower == keywordLower {
				maxScore = 1.0
				reason = fmt.Sprintf("表名完全匹配 '%s'", keyword)
			}

			// 表名包含关键词
			if matchName && maxScore < 0.8 && strings.Contains(tableNameLower, keywordLower) {
				maxScore = 0.8
				reason = fmt.Sprintf("表名包含 '%s'", keyword)
			}

			// 注释包含关键词
			if matchComment && maxScore < 0.6 && tableCommentLower != "" && strings.Contains(tableCommentLower, keywordLower) {
				maxScore = 0.6
				reason = fmt.Sprintf("表注释包含 '%s'", keyword)
			}

			// 字段名包含关键词
			if matchColumns && maxScore < 0.4 {
				for _, colName := range table.ColumnNames {
					if strings.Contains(strings.ToLower(colName), keywordLower) {
						maxScore = 0.4
						reason = fmt.Sprintf("字段名包含 '%s'", keyword)
						break
					}
				}
			}

			keywordScores[i] = maxScore
			matchReasons[i] = reason
		}

		// 计算最终分数：最大匹配分 * 关键词覆盖率
		var maxScore float64
		var matchedCount int
		var bestReason string

		for i, score := range keywordScores {
			if score > 0 {
				matchedCount++
				if score > maxScore {
					maxScore = score
					bestReason = matchReasons[i]
				}
			}
		}

		if maxScore > 0 {
			coverage := float64(matchedCount) / float64(len(keywords))
			finalScore := maxScore * (0.5 + 0.5*coverage) // 基础分 + 覆盖率加成

			results = append(results, TableRelevanceResult{
				TableName:      table.Name,
				RelevanceScore: finalScore,
				MatchReason:    bestReason,
			})
		}
	}

	// 按分数降序排序
	sort.Slice(results, func(i, j int) bool {
		return results[i].RelevanceScore > results[j].RelevanceScore
	})

	return results
}

// mergeRetrievalResults 合并关键词和向量检索结果（加权平均）
func mergeRetrievalResults(keywordResults, vectorResults []TableRelevanceResult, keywordWeight, vectorWeight float64) []TableRelevanceResult {
	// 用 map 存储每个表的加权分数
	scoreMap := make(map[string]float64)

	// 加权关键词结果
	for _, r := range keywordResults {
		scoreMap[r.TableName] += r.RelevanceScore * keywordWeight
	}

	// 加权向量结果
	for _, r := range vectorResults {
		scoreMap[r.TableName] += r.RelevanceScore * vectorWeight
	}

	// 转换为结果列表
	results := make([]TableRelevanceResult, 0, len(scoreMap))
	for tableName, score := range scoreMap {
		results = append(results, TableRelevanceResult{
			TableName:      tableName,
			RelevanceScore: score,
			MatchReason:    "混合检索",
		})
	}

	// 按分数降序排序
	sort.Slice(results, func(i, j int) bool {
		return results[i].RelevanceScore > results[j].RelevanceScore
	})

	return results
}

// mergeRetrievalResults3 三路合并检索结果（关键词 + 向量 + Graph，加权平均）
func mergeRetrievalResults3(keywordResults, vectorResults, graphResults []TableRelevanceResult, keywordWeight, vectorWeight, graphWeight float64) []TableRelevanceResult {
	// 用 map 存储每个表的加权分数和来源
	type scoreEntry struct {
		score   float64
		sources []string
	}
	scoreMap := make(map[string]*scoreEntry)

	ensure := func(tableName string) {
		if _, ok := scoreMap[tableName]; !ok {
			scoreMap[tableName] = &scoreEntry{sources: []string{}}
		}
	}

	// 加权关键词结果
	for _, r := range keywordResults {
		ensure(r.TableName)
		scoreMap[r.TableName].score += r.RelevanceScore * keywordWeight
		scoreMap[r.TableName].sources = append(scoreMap[r.TableName].sources, "关键词")
	}

	// 加权向量结果
	for _, r := range vectorResults {
		ensure(r.TableName)
		scoreMap[r.TableName].score += r.RelevanceScore * vectorWeight
		scoreMap[r.TableName].sources = append(scoreMap[r.TableName].sources, "向量")
	}

	// 加权 Graph 结果
	for _, r := range graphResults {
		ensure(r.TableName)
		scoreMap[r.TableName].score += r.RelevanceScore * graphWeight
		scoreMap[r.TableName].sources = append(scoreMap[r.TableName].sources, "关系扩展")
	}

	// 转换为结果列表
	results := make([]TableRelevanceResult, 0, len(scoreMap))
	for tableName, entry := range scoreMap {
		reason := strings.Join(uniqueStrings(entry.sources), "+")
		results = append(results, TableRelevanceResult{
			TableName:      tableName,
			RelevanceScore: entry.score,
			MatchReason:    reason,
		})
	}

	// 按分数降序排序
	sort.Slice(results, func(i, j int) bool {
		return results[i].RelevanceScore > results[j].RelevanceScore
	})

	return results
}

// uniqueStrings 去重字符串切片
func uniqueStrings(ss []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0)
	for _, s := range ss {
		if !seen[s] {
			seen[s] = true
			result = append(result, s)
		}
	}
	return result
}

// retrieveRelevantTables 主检索函数
func retrieveRelevantTables(query string, dbConfig *DatabaseConfig, config *TableRetrievalConfig) ([]TableRelevanceResult, error) {
	// 默认配置
	strategy := "keyword"
	maxTables := 15
	minRelevanceScore := 0.3
	var keywordConfig *KeywordRetrievalConfig
	vectorWeight := 0.5
	keywordWeight := 0.5

	if config != nil {
		if config.Strategy != "" {
			strategy = config.Strategy
		}
		if config.MaxTables > 0 {
			maxTables = config.MaxTables
		}
		if config.MinRelevanceScore > 0 {
			minRelevanceScore = config.MinRelevanceScore
		}
		keywordConfig = config.KeywordConfig
		if config.VectorWeight > 0 {
			vectorWeight = config.VectorWeight
		}
		if config.KeywordWeight > 0 {
			keywordWeight = config.KeywordWeight
		}
	}

	// 获取 embedding 配置
	var embeddingConfig EmbeddingRetrievalConfig
	if dataOntologyAIConfig != nil {
		embeddingConfig = dataOntologyAIConfig.Embedding
	}

	manager := getFTS5Manager()

	// 尝试使用 FTS5 检索（优先使用 SQLite FTS5 索引，大幅提升 3 万+表检索性能）
	if manager != nil {
		// 根据策略选择检索方法
		var results []TableRelevanceResult

		switch strategy {
		case "embedding":
			// 纯向量检索
			if embeddingConfig.Enabled && embeddingConfig.URL != "" {
				vectorResults, err := manager.vectorRetrieveTables(query, dbConfig.ID, maxTables*2, embeddingConfig)
				if err == nil && len(vectorResults) > 0 {
					results = vectorResults
				} else {
					log.Printf("[表检索] 向量检索失败，降级为 FTS5 关键词检索: %v", err)
					ftsResults, err := manager.fts5RetrieveTables(query, dbConfig.ID, maxTables*2)
					if err == nil && len(ftsResults) > 0 {
						results = ftsResults
					}
				}
			} else {
				log.Printf("[表检索] embedding 未配置，降级为 FTS5 关键词检索")
				ftsResults, err := manager.fts5RetrieveTables(query, dbConfig.ID, maxTables*2)
				if err == nil && len(ftsResults) > 0 {
					results = ftsResults
				}
			}

		case "graph":
			// 纯 Graph 关系扩展：先用关键词找种子表，再沿关系图扩展
			graphMaxDepth := 2 // 默认深度
			if config != nil && config.GraphConfig != nil && config.GraphConfig.MaxDepth > 0 {
				graphMaxDepth = config.GraphConfig.MaxDepth
			}
			ftsResults, _ := manager.fts5RetrieveTables(query, dbConfig.ID, maxTables)
			seedTables := make([]string, 0, len(ftsResults))
			for _, r := range ftsResults {
				seedTables = append(seedTables, r.TableName)
			}
			if len(seedTables) > 0 {
				graphResults, err := manager.graphRetrieveTables(seedTables, dbConfig.ID, graphMaxDepth, maxTables)
				if err == nil && len(graphResults) > 0 {
					results = graphResults
				} else {
					results = ftsResults
				}
			} else {
				results = ftsResults
			}

		case "hybrid":
			// 混合检索：关键词 + 向量 + Graph
			ftsResults, _ := manager.fts5RetrieveTables(query, dbConfig.ID, maxTables*2)
			var vectorResults []TableRelevanceResult
			if embeddingConfig.Enabled && embeddingConfig.URL != "" {
				vectorResults, _ = manager.vectorRetrieveTables(query, dbConfig.ID, maxTables*2, embeddingConfig)
			}

			// 从关键词和向量结果中取种子，用 Graph 扩展关联表
			seedTables := make(map[string]bool)
			graphWeight := 0.3 // Graph 默认权重
			graphMaxDepth := 2 // Graph 默认深度
			if config != nil {
				if config.GraphWeight > 0 {
					graphWeight = config.GraphWeight
				}
				if config.GraphConfig != nil && config.GraphConfig.MaxDepth > 0 {
					graphMaxDepth = config.GraphConfig.MaxDepth
				}
			}
			for _, r := range ftsResults {
				seedTables[r.TableName] = true
			}
			for _, r := range vectorResults {
				seedTables[r.TableName] = true
			}
			var graphResults []TableRelevanceResult
			seedList := make([]string, 0, len(seedTables))
			for t := range seedTables {
				seedList = append(seedList, t)
			}
			if len(seedList) > 0 {
				graphResults, _ = manager.graphRetrieveTables(seedList, dbConfig.ID, graphMaxDepth, maxTables*2)
			}

			// 三路合并（加权平均）
			results = mergeRetrievalResults3(ftsResults, vectorResults, graphResults, keywordWeight, vectorWeight, graphWeight)

		default: // "keyword"
			ftsResults, err := manager.fts5RetrieveTables(query, dbConfig.ID, maxTables*2)
			if err == nil && len(ftsResults) > 0 {
				results = ftsResults
			}
		}

		// 过滤低分结果
		var filteredResults []TableRelevanceResult
		for _, r := range results {
			if r.RelevanceScore >= minRelevanceScore {
				filteredResults = append(filteredResults, r)
			}
		}
		// 限制返回数量
		if len(filteredResults) > maxTables {
			filteredResults = filteredResults[:maxTables]
		}
		return filteredResults, nil
	}

	// 降级方案：从数据库实时获取所有表信息，使用内存检索
	tableInfos, err := getTableInfoList(dbConfig)
	if err != nil {
		return nil, err
	}

	// 根据策略选择检索方法
	var results []TableRelevanceResult

	switch strategy {
	case "embedding":
		log.Printf("[表检索] embedding 策略需要 FTS5Manager，降级为 keyword 策略")
		results = keywordRetrieveTables(query, tableInfos, keywordConfig)
	case "graph":
		log.Printf("[表检索] graph 策略需要 FTS5Manager，降级为 keyword 策略")
		results = keywordRetrieveTables(query, tableInfos, keywordConfig)
	case "hybrid":
		log.Printf("[表检索] hybrid 策略需要 FTS5Manager，降级为 keyword 策略")
		results = keywordRetrieveTables(query, tableInfos, keywordConfig)
	default: // "keyword"
		results = keywordRetrieveTables(query, tableInfos, keywordConfig)
	}

	// 过滤低分结果
	var filteredResults []TableRelevanceResult
	for _, r := range results {
		if r.RelevanceScore >= minRelevanceScore {
			filteredResults = append(filteredResults, r)
		}
	}

	// 限制返回数量
	if len(filteredResults) > maxTables {
		filteredResults = filteredResults[:maxTables]
	}

	return filteredResults, nil
}

// getColumnComments 获取字段备注
func getColumnComments(db *sql.DB, config *DatabaseConfig, tableName string) map[string]string {
	comments := make(map[string]string)

	switch config.Type {
	case "mysql", "mariadb", "tidb":
		// MySQL: 从 information_schema.COLUMNS 获取字段备注
		query := `
			SELECT COLUMN_NAME, COLUMN_COMMENT
			FROM information_schema.COLUMNS
			WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`
		rows, err := db.Query(query, config.Database, tableName)
		if err != nil {
			log.Printf("查询 MySQL 字段备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var colName, colComment string
			if err := rows.Scan(&colName, &colComment); err == nil {
				if colComment != "" {
					comments[colName] = colComment
				}
			}
		}
	case "postgresql", "timescaledb", "cockroachdb":
		// PostgreSQL: 从 pg_description 获取字段备注
		query := `
			SELECT a.attname, d.description
			FROM pg_attribute a
			JOIN pg_class c ON a.attrelid = c.oid
			JOIN pg_namespace n ON c.relnamespace = n.oid
			LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
			WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped`
		rows, err := db.Query(query, tableName)
		if err != nil {
			log.Printf("查询 PostgreSQL 字段备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var colName, colComment string
			if err := rows.Scan(&colName, &colComment); err == nil {
				if colComment != "" {
					comments[colName] = colComment
				}
			}
		}
	case "oracle":
		// Oracle: 从 USER_COL_COMMENTS 获取字段备注
		query := "SELECT COLUMN_NAME, COMMENTS FROM USER_COL_COMMENTS WHERE TABLE_NAME = :1"
		rows, err := db.Query(query, strings.ToUpper(tableName))
		if err != nil {
			log.Printf("查询 Oracle 字段备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var colName, colComment sql.NullString
			if err := rows.Scan(&colName, &colComment); err == nil {
				if colName.Valid && colComment.Valid && colComment.String != "" {
					comments[colName.String] = colComment.String
				}
			}
		}
	case "dm":
		// 达梦: 从 USER_COL_COMMENTS 获取字段备注
		query := "SELECT COLUMN_NAME, COMMENTS FROM USER_COL_COMMENTS WHERE TABLE_NAME = ?"
		rows, err := db.Query(query, strings.ToUpper(tableName))
		if err != nil {
			log.Printf("查询达梦字段备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var colName, colComment sql.NullString
			if err := rows.Scan(&colName, &colComment); err == nil {
				if colName.Valid && colComment.Valid && colComment.String != "" {
					comments[colName.String] = colComment.String
				}
			}
		}
	case "sqlserver":
		// SQL Server: 从 sys.extended_properties 获取字段备注
		query := `
			SELECT c.name AS column_name, ep.value AS column_comment
			FROM sys.columns c
			JOIN sys.tables t ON c.object_id = t.object_id
			LEFT JOIN sys.extended_properties ep ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
			WHERE SCHEMA_NAME(t.schema_id) = 'dbo' AND t.name = @p1`
		rows, err := db.Query(query, tableName)
		if err != nil {
			log.Printf("查询 SQL Server 字段备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var colName, colComment sql.NullString
			if err := rows.Scan(&colName, &colComment); err == nil {
				if colName.Valid && colComment.Valid && colComment.String != "" {
					comments[colName.String] = colComment.String
				}
			}
		}
	}
	return comments
}

// buildMongoURI 构建 MongoDB 连接 URI，自动检测是否为 Atlas
func buildMongoURI(config *DatabaseConfig) string {
	// 检查是否为 MongoDB Atlas（包含 .mongodb.net）
	if strings.Contains(config.Host, ".mongodb.net") {
		// MongoDB Atlas 使用 SRV 连接格式，不需要端口号
		uri := fmt.Sprintf("mongodb+srv://%s:%s@%s/%s?retryWrites=true&w=majority",
			url.QueryEscape(config.User),
			url.QueryEscape(config.Password),
			config.Host,
			config.Database)
		return uri
	}
	// 标准 MongoDB 连接格式
	return fmt.Sprintf("mongodb://%s:%s@%s:%d/%s",
		url.QueryEscape(config.User),
		url.QueryEscape(config.Password),
		config.Host,
		config.Port,
		config.Database)
}

// getTablesList 获取数据库表列表
func getTablesList(config *DatabaseConfig) ([]string, error) {
	var tables []string

	// MongoDB 特殊处理
	if config.Type == "mongodb" {
		uri := buildMongoURI(config)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
		if err != nil {
			return nil, err
		}
		defer client.Disconnect(ctx)

		db := client.Database(config.Database)
		collections, err := db.ListCollectionNames(ctx, bson.M{})
		if err != nil {
			return nil, err
		}
		return collections, nil
	}

	// Redis 不支持表列表
	if config.Type == "redis" {
		return []string{"DB 0", "DB 1", "DB 2", "DB 3", "DB 4", "DB 5"}, nil
	}

	// 其他NoSQL数据库暂不支持
	if config.Type == "neo4j" || config.Type == "elasticsearch" ||
		config.Type == "influxdb" || config.Type == "memcached" ||
		config.Type == "cassandra" || config.Type == "hbase" {
		return []string{}, nil
	}

	// SQL数据库通用处理 - 使用连接池
	db, err := getDBFromPool(config)
	if err != nil {
		return nil, err
	}
	// 注意：不再 defer db.Close()，因为连接池管理连接生命周期

	// 获取表列表
	query := getTablesQuery(config)
	rows, err := db.Query(query)
	if err != nil && config.Type == "oracle" {
		// 无 ALL_TABLES 权限时回退到 USER_TABLES（仅当前 schema，加表名过滤）
		fallback := "SELECT table_name FROM user_tables WHERE table_name NOT LIKE '%$%' " +
			"AND table_name NOT LIKE 'ALL\\_%' ESCAPE '\\' AND table_name NOT LIKE 'DBA\\_%' ESCAPE '\\' " +
			"AND table_name NOT LIKE 'AQ\\_%' ESCAPE '\\' AND table_name NOT LIKE 'DBMS\\_%' ESCAPE '\\' " +
			"AND table_name <> 'DUAL' ORDER BY table_name"
		rows, err = db.Query(fallback)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err == nil {
			tables = append(tables, tableName)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// 达梦：过滤系统表，只保留用户表
	if config.Type == "dm" {
		filtered := make([]string, 0, len(tables))
		for _, t := range tables {
			if strings.HasPrefix(t, "##") || strings.HasPrefix(t, "AQ$_") || strings.HasPrefix(t, "SYS$") ||
				strings.HasPrefix(t, "DBMS_") || strings.HasPrefix(t, "REG$") || t == "POLICIES" || strings.HasPrefix(t, "POLICY_") {
				continue
			}
			filtered = append(filtered, t)
		}
		tables = filtered
	}

	if tables == nil {
		tables = []string{}
	}

	return tables, nil
}

// oracleEscapeIdentifier 安全转义 Oracle/DM 标识符用于 SQL 字符串字面量
// 标识符已通过 isValidIdentifierWithSchema 验证，这里只需转义单引号
func oracleEscapeIdentifier(name string) string {
	return strings.ReplaceAll(strings.ToUpper(name), "'", "''")
}

// oracleTableColumnsSQL 返回 Oracle 查询表列的 SQL，支持 owner.table 形式
func oracleTableColumnsSQL(tableName string, withDefault bool) string {
	sel := "SELECT COLUMN_NAME, DATA_TYPE, NULLABLE"
	if withDefault {
		sel = "SELECT COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_DEFAULT"
	}
	// 处理 owner.table 形式
	if idx := strings.Index(tableName, "."); idx >= 0 {
		owner := oracleEscapeIdentifier(tableName[:idx])
		tblPart := oracleEscapeIdentifier(tableName[idx+1:])
		return fmt.Sprintf("%s FROM ALL_TAB_COLUMNS WHERE OWNER = '%s' AND TABLE_NAME = '%s' ORDER BY COLUMN_ID", sel, owner, tblPart)
	}
	tableEsc := oracleEscapeIdentifier(tableName)
	return fmt.Sprintf("%s FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", sel, tableEsc)
}

// getTableColumns 获取表的字段信息
func getTableColumns(config *DatabaseConfig, tableName string) ([]map[string]interface{}, error) {
	var columns []map[string]interface{}

	// 安全验证：检查表名是否合法，防止 SQL 注入
	if !isValidIdentifierWithSchema(tableName) {
		return nil, fmt.Errorf("无效的表名: %s", tableName)
	}

	// MongoDB 特殊处理 - 通过采样文档推断字段
	if config.Type == "mongodb" {
		uri := buildMongoURI(config)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
		if err != nil {
			return nil, err
		}
		defer client.Disconnect(ctx)

		collection := client.Database(config.Database).Collection(tableName)

		// 采样一个文档来推断字段
		var sample bson.M
		err = collection.FindOne(ctx, bson.M{}).Decode(&sample)
		if err != nil {
			if err == mongo.ErrNoDocuments {
				return []map[string]interface{}{}, nil
			}
			return nil, err
		}

		for key, value := range sample {
			columns = append(columns, map[string]interface{}{
				"name": key,
				"type": fmt.Sprintf("%T", value),
			})
		}
		return columns, nil
	}

	// Redis、Neo4j等NoSQL不支持
	if config.Type == "redis" || config.Type == "neo4j" || config.Type == "elasticsearch" ||
		config.Type == "influxdb" || config.Type == "memcached" ||
		config.Type == "cassandra" || config.Type == "hbase" {
		return []map[string]interface{}{}, nil
	}

	// SQL数据库通用处理 - 使用连接池
	db, err := getDBFromPool(config)
	if err != nil {
		return nil, err
	}

	var query string
	switch config.Type {
	case "mysql", "mariadb", "tidb":
		quotedTable, _ := safeQuoteIdentifier(tableName, config.Type)
		query = fmt.Sprintf("SHOW COLUMNS FROM %s", quotedTable)
	case "postgresql", "timescaledb", "cockroachdb":
		// 使用参数化查询代替字符串拼接
		query = "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position"
	case "sqlserver":
		query = "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @p1 ORDER BY ORDINAL_POSITION"
	case "sqlite", "duckdb":
		quotedTable, _ := safeQuoteIdentifier(tableName, config.Type)
		query = fmt.Sprintf("PRAGMA table_info(%s)", quotedTable)
	case "oracle":
		// Oracle DATA_DEFAULT 是 LONG 类型，go-ora 无法 Scan，只查 3 列
		tbl := tableName
		if idx := strings.Index(tbl, "."); idx >= 0 {
			tbl = tbl[idx+1:]
		}
		query = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", oracleEscapeIdentifier(tbl))
	case "dm":
		query = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", oracleEscapeIdentifier(tableName))
	case "clickhouse":
		quotedTable, _ := safeQuoteIdentifier(tableName, config.Type)
		query = fmt.Sprintf("DESCRIBE TABLE %s", quotedTable)
	default:
		return nil, fmt.Errorf("不支持的数据库类型: %s", config.Type)
	}

	var rows *sql.Rows
	if config.Type == "postgresql" || config.Type == "timescaledb" || config.Type == "cockroachdb" {
		rows, err = db.Query(query, tableName)
	} else if config.Type == "sqlserver" {
		rows, err = db.Query(query, tableName)
	} else {
		rows, err = db.Query(query)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// 获取列信息
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	for rows.Next() {
		values := make([]interface{}, len(cols))
		valuePtrs := make([]interface{}, len(cols))
		for i := range values {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			continue
		}

		var colName, colType string

		// 根据不同数据库类型解析列信息
		switch config.Type {
		case "mysql", "mariadb", "tidb":
			// SHOW COLUMNS: Field, Type, Null, Key, Default, Extra
			if len(values) >= 2 {
				if v, ok := values[0].([]byte); ok {
					colName = string(v)
				}
				if v, ok := values[1].([]byte); ok {
					colType = string(v)
				}
			}
			// 提取 Extra 字段中的 auto_increment 标记
			if len(values) >= 6 {
				extra := ""
				if v, ok := values[5].([]byte); ok {
					extra = string(v)
				} else if v, ok := values[5].(string); ok {
					extra = v
				}
				if strings.Contains(strings.ToLower(extra), "auto_increment") {
					colType += " [AUTO_INCREMENT]"
				}
			}
		case "sqlite", "duckdb":
			// PRAGMA table_info: cid, name, type, notnull, dflt_value, pk
			if len(values) >= 3 {
				if v, ok := values[1].(string); ok {
					colName = v
				} else if v, ok := values[1].([]byte); ok {
					colName = string(v)
				}
				if v, ok := values[2].(string); ok {
					colType = v
				} else if v, ok := values[2].([]byte); ok {
					colType = string(v)
				}
			}
		default:
			// information_schema.columns / user_tab_columns
			if len(values) >= 2 {
				if v, ok := values[0].(string); ok {
					colName = v
				} else if v, ok := values[0].([]byte); ok {
					colName = string(v)
				}
				if v, ok := values[1].(string); ok {
					colType = v
				} else if v, ok := values[1].([]byte); ok {
					colType = string(v)
				}
			}
		}

		if colName != "" {
			colInfo := map[string]interface{}{
				"name": colName,
				"type": colType,
			}
			// 解析 nullable（第3列，DM/Oracle 返回 'Y'/'N'）
			if len(values) >= 3 {
				nullable := ""
				if v, ok := values[2].(string); ok {
					nullable = v
				} else if v, ok := values[2].([]byte); ok {
					nullable = string(v)
				}
				if nullable != "" {
					colInfo["nullable"] = nullable
				}
			}
			columns = append(columns, colInfo)
		}
	}

	if columns == nil {
		columns = []map[string]interface{}{}
	}

	return columns, nil
}

// getDataOntologyUserFromRequest 从 Authorization Bearer 解析 token/apiKey，返回用户名（users map 的 key）
func getDataOntologyUserFromRequest(r *http.Request) (username string, ok bool) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return "", false
	}
	token := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	if token == "" {
		return "", false
	}
	dataOntologyMu.RLock()
	defer dataOntologyMu.RUnlock()
	for uname, user := range dataOntologyUsers {
		if userHasToken(user, token) || (user.ApiKey != "" && user.ApiKey == token) {
			return uname, true
		}
	}
	return "", false
}

// dataOntologyResourceVisible 非 admin 仅可见 Owner 与本人一致的资源；Owner 为空视为仅 admin 可见
func dataOntologyResourceVisible(owner, username string) bool {
	if username == "admin" {
		return true
	}
	return owner != "" && owner == username
}

// requireGovernanceTaskAccess 校验当前用户对治理任务的访问权，失败时写入 JSON 响应
func requireGovernanceTaskAccess(w http.ResponseWriter, r *http.Request, taskID string) (*GovernanceTask, string, bool) {
	username, ok := getDataOntologyUserFromRequest(r)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return nil, "", false
	}
	dataOntologyMu.RLock()
	task, exists := governanceTasks[taskID]
	dataOntologyMu.RUnlock()
	if !exists || !dataOntologyResourceVisible(task.Owner, username) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务不存在"})
		return nil, "", false
	}
	return task, username, true
}

const dataOntologyTokenTTL = 7 * 24 * time.Hour

// userHasToken 检查用户的 Tokens 列表、TokenEntries 或旧 Token 字段中是否包含指定 token
func userHasToken(user *User, token string) bool {
	now := time.Now().Unix()
	// 优先检查带时间戳的 TokenEntries，并过滤过期 token
	for _, entry := range user.TokenEntries {
		if entry.Token == token && now-entry.CreatedAt <= int64(dataOntologyTokenTTL.Seconds()) {
			return true
		}
	}
	// 兼容不带时间戳的 Tokens 列表
	for _, t := range user.Tokens {
		if t == token {
			return true
		}
	}
	// 向后兼容旧 Token 字段
	return user.Token == token
}

// 验证Token（同时支持登录Token和ApiKey）
func verifyToken(r *http.Request) bool {
	_, ok := getDataOntologyUserFromRequest(r)
	return ok
}

// 登录处理
func handleDataOntologyLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		jsonError(w, "只支持POST请求", ErrCodeMethodNotAllowed)
		return
	}

	var loginReq struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&loginReq); err != nil {
		jsonError(w, "请求格式错误", ErrCodeBadRequest)
		return
	}

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	user, exists := dataOntologyUsers[loginReq.Username]
	// 使用 verifyPassword 比较 bcrypt 哈希（bcrypt 每次生成不同的哈希，不能用 == 比较）
	if !exists || !verifyPassword(loginReq.Password, user.Password) {
		log.Printf("[Auth] 登录失败: username=%s, reason=%v", loginReq.Username, map[bool]string{true: "密码错误", false: "用户不存在"}[exists])
		jsonError(w, "用户名或密码错误", ErrCodeUnauthorized)
		return
	}

	// 生成新Token并立即持久化，避免重启后 token 丢失或偶发回退。
	token := generateToken()
	// 支持多 token：追加到 Tokens 列表和 TokenEntries，不覆盖旧 token
	user.Tokens = append(user.Tokens, token)
	user.TokenEntries = append(user.TokenEntries, TokenEntry{Token: token, CreatedAt: time.Now().Unix()})
	// 向后兼容：如果旧数据有 Token 字段，迁移到 Tokens 后清空
	if user.Token != "" {
		user.Tokens = append(user.Tokens, user.Token)
		user.Token = "" // 清空旧字段，避免重复
	}
	dataOntologyMu.Unlock()
	if err := saveDataOntologyStore(); err != nil {
		log.Printf("[Auth] 保存登录 token 失败: username=%s, err=%v", loginReq.Username, err)
	}
	dataOntologyMu.Lock()

	log.Printf("[Auth] 登录成功: username=%s", loginReq.Username)
	jsonSuccess(w, map[string]interface{}{"success": true, "token": token})
}

// handleApiKey 管理ApiKey（GET获取/POST生成/DELETE删除）
func handleApiKey(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		apiUnauthorized(w, "未授权")
		return
	}
	loginToken := strings.TrimPrefix(authHeader, "Bearer ")

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	var currentUser *User
	for _, u := range dataOntologyUsers {
		if userHasToken(u, loginToken) {
			currentUser = u
			break
		}
	}
	if currentUser == nil {
		apiUnauthorized(w, "未授权")
		return
	}

	switch r.Method {
	case http.MethodGet:
		jsonSuccess(w, map[string]interface{}{"success": true, "api_key": currentUser.ApiKey})
	case http.MethodPost:
		var target *User = currentUser
		var body struct {
			Username string `json:"username"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		targetName := strings.TrimSpace(body.Username)
		log.Printf("[APIKey] POST body.Username=%q targetName=%q currentUser=%s", body.Username, targetName, currentUser.Username)
		if targetName != "" && currentUser.Username == "admin" {
			if u, ok := dataOntologyUsers[targetName]; ok && u != nil {
				target = u
				log.Printf("[APIKey] target switched to %s", target.Username)
			} else {
				log.Printf("[APIKey] user %q not found in map, keeping currentUser", targetName)
			}
		}
		target.ApiKey = "dok_" + uuid.New().String()
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		dataOntologyMu.Lock()
		log.Printf("[APIKey] 生成新API Key: user=%s", target.Username)
		jsonSuccess(w, map[string]interface{}{"success": true, "api_key": target.ApiKey})
	case http.MethodDelete:
		currentUser.ApiKey = ""
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		dataOntologyMu.Lock()
		log.Printf("[APIKey] 删除API Key: user=%s", currentUser.Username)
		jsonSuccess(w, map[string]interface{}{"success": true})
	default:
		apiMethodNotAllowed(w, "不支持的方法")
	}
}

// handleUserSettings 管理用户设置（GET获取/POST保存）
func handleUserSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		apiUnauthorized(w, "未授权")
		return
	}
	loginToken := strings.TrimPrefix(authHeader, "Bearer ")

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	var currentUser *User
	for _, u := range dataOntologyUsers {
		if userHasToken(u, loginToken) {
			currentUser = u
			break
		}
	}
	if currentUser == nil {
		apiUnauthorized(w, "未授权")
		return
	}

	switch r.Method {
	case http.MethodGet:
		settings := currentUser.Settings
		if settings == nil {
			settings = map[string]interface{}{}
		}
		// 设置默认值（如果用户没有设置过）
		if _, ok := settings["embedMode"]; !ok {
			settings["embedMode"] = true
		}
		if _, ok := settings["tabVisibility"]; !ok {
			settings["tabVisibility"] = map[string]interface{}{
				"database":   true,
				"governance": true,
				"api":        true,
				"ai":         true,
				"ontology":   false,
				"lineage":    false,
				"mcp":        false,
				"models":     false,
				"quality":    false,
			}
		}
		if _, ok := settings["tabOrder"]; !ok {
			settings["tabOrder"] = []string{"database", "governance", "api", "ai", "ontology", "lineage", "mcp", "models", "quality"}
		}
		if _, ok := settings["tabNames"]; !ok {
			settings["tabNames"] = map[string]interface{}{}
		}
		if _, ok := settings["govTaskOrder"]; !ok {
			settings["govTaskOrder"] = []string{}
		}
		jsonSuccess(w, map[string]interface{}{"success": true, "settings": settings})
	case http.MethodPost:
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apiBadRequest(w, "无效的请求体")
			return
		}
		// 直接用 body 替换设置，避免嵌套
		currentUser.Settings = body
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		dataOntologyMu.Lock()
		log.Printf("[Settings] 保存用户设置: user=%s", currentUser.Username)
		jsonSuccess(w, map[string]interface{}{"success": true})
	default:
		apiMethodNotAllowed(w, "不支持的方法")
	}
}

// requireDataOntologyAdmin 当前用户须为 admin
func requireDataOntologyAdmin(w http.ResponseWriter, r *http.Request) (string, bool) {
	u, ok := getDataOntologyUserFromRequest(r)
	if !ok {
		apiUnauthorized(w, "未授权")
		return "", false
	}
	if u != "admin" {
		apiForbidden(w, "需要管理员权限")
		return "", false
	}
	return u, true
}

// UserPublic 用户列表展示（不含密码）
type UserPublic struct {
	Username string `json:"username"`
	ApiKey   string `json:"api_key,omitempty"`
}

// handleDataOntologyUsers GET 列出用户 / POST 创建用户（仅 admin）
func handleDataOntologyUsers(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		if _, ok := requireDataOntologyAdmin(w, r); !ok {
			return
		}
		dataOntologyMu.RLock()
		list := make([]UserPublic, 0, len(dataOntologyUsers))
		for name, u := range dataOntologyUsers {
			if u == nil {
				continue
			}
			apiKey := ""
			if u.ApiKey != "" {
				apiKey = u.ApiKey
			}
			list = append(list, UserPublic{Username: name, ApiKey: apiKey})
		}
		dataOntologyMu.RUnlock()
		sort.Slice(list, func(i, j int) bool { return list[i].Username < list[j].Username })
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "users": list})

	case http.MethodPost:
		if _, ok := requireDataOntologyAdmin(w, r); !ok {
			return
		}
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
			return
		}
		name := strings.TrimSpace(body.Username)
		if name == "" || body.Password == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "用户名和密码不能为空"})
			return
		}
		dataOntologyMu.Lock()
		if _, exists := dataOntologyUsers[name]; exists {
			dataOntologyMu.Unlock()
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "用户名已存在"})
			return
		}
		dataOntologyUsers[name] = &User{
			Username: name,
			Password: hashPassword(body.Password),
		}
		dataOntologyMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存用户失败: %v", err)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
	}
}

// handleDataOntologyUsersDetail DELETE /users/{username} / PUT /users/{username}/password
func handleDataOntologyUsersDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	base := "/api/data-ontology/users/"
	if !strings.HasPrefix(r.URL.Path, base) {
		http.NotFound(w, r)
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, base)
	rest = strings.TrimSuffix(rest, "/")
	if rest == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "无效路径"})
		return
	}
	parts := strings.Split(rest, "/")
	targetName := parts[0]
	if u, err := url.PathUnescape(targetName); err == nil && u != "" {
		targetName = u
	}

	if len(parts) == 1 {
		if r.Method != http.MethodDelete {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
			return
		}
		if _, ok := requireDataOntologyAdmin(w, r); !ok {
			return
		}
		if targetName == "admin" {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不能删除管理员账号"})
			return
		}
		dataOntologyMu.Lock()
		if _, exists := dataOntologyUsers[targetName]; !exists {
			dataOntologyMu.Unlock()
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "用户不存在"})
			return
		}
		delete(dataOntologyUsers, targetName)
		dataOntologyMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存用户失败: %v", err)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
		return
	}

	if len(parts) == 2 && parts[1] == "password" && r.Method == http.MethodPut {
		caller, ok := getDataOntologyUserFromRequest(r)
		if !ok {
			apiUnauthorized(w, "未授权")
			return
		}
		if caller != "admin" && caller != targetName {
			apiForbidden(w, "只能修改自己的密码")
			return
		}
		var body struct {
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		if strings.TrimSpace(body.Password) == "" {
			apiInvalidInput(w, "密码不能为空")
			return
		}
		dataOntologyMu.Lock()
		user, exists := dataOntologyUsers[targetName]
		if !exists || user == nil {
			dataOntologyMu.Unlock()
			apiNotFound(w, "用户不存在")
			return
		}
		user.Password = hashPassword(body.Password)
		dataOntologyMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("[User] 保存用户密码失败: user=%s, err=%v", targetName, err)
		}
		log.Printf("[User] 密码已更新: user=%s, by=%s", targetName, caller)
		jsonSuccess(w, map[string]interface{}{"success": true})
		return
	}

	apiNotFound(w, "无效路径")
}

// handleMCPConfig MCP 总开关：GET 返回当前状态，PUT 更新（需授权）
func handleMCPConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}
	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		enabled := dataOntologyMCPEnabled == nil || *dataOntologyMCPEnabled
		port := dataOntologyMCPPort
		dataOntologyMu.RUnlock()
		jsonSuccess(w, map[string]interface{}{"success": true, "enabled": enabled, "port": port})
	case http.MethodPut:
		var body struct {
			Enabled *bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		dataOntologyMu.Lock()
		dataOntologyMCPEnabled = body.Enabled
		dataOntologyMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("[MCP] 保存配置失败: err=%v", err)
		}
		enabled := dataOntologyMCPEnabled == nil || *dataOntologyMCPEnabled
		log.Printf("[MCP] 配置已更新: enabled=%v", enabled)
		jsonSuccess(w, map[string]interface{}{"success": true, "enabled": enabled})
	default:
		apiMethodNotAllowed(w)
	}
}

// handleMCPSafeConfig MCP 安全配置：GET 返回当前配置，PUT 更新（需授权）
func handleMCPSafeConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}
	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		config := dataOntologyMCPSafeConfig
		if config == nil {
			config = &MCPSafeConfig{} // 返回默认值
		}
		dataOntologyMu.RUnlock()
		jsonSuccess(w, map[string]interface{}{"success": true, "config": config})
	case http.MethodPut:
		var body struct {
			Config MCPSafeConfig `json:"config"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		dataOntologyMu.Lock()
		dataOntologyMCPSafeConfig = &body.Config
		dataOntologyMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("[MCP] 保存安全配置失败: err=%v", err)
		}
		log.Printf("[MCP] 安全配置已更新: read_only=%v, block_dangerous=%v, blocked_keywords=%v, allowed_tables=%v, port=%d",
			body.Config.ReadOnlyMode, body.Config.BlockDangerous, body.Config.BlockedKeywords, body.Config.AllowedTables, body.Config.Port)
		jsonSuccess(w, map[string]interface{}{"success": true, "config": dataOntologyMCPSafeConfig})
	default:
		apiMethodNotAllowed(w)
	}
}

// MCP 端口配置
func handleMCPPort(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}
	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		port := dataOntologyMCPPort
		dataOntologyMu.RUnlock()
		jsonSuccess(w, map[string]interface{}{"success": true, "port": port})
	case http.MethodPut:
		var body struct {
			Port int `json:"port"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		// 验证端口范围
		if body.Port < 0 || body.Port > 65535 {
			apiBadRequest(w, "端口号必须在 0-65535 范围内")
			return
		}
		dataOntologyMu.Lock()
		dataOntologyMCPPort = body.Port
		// 同时更新 MCPSafeConfig 中的 Port 字段
		if dataOntologyMCPSafeConfig == nil {
			dataOntologyMCPSafeConfig = &MCPSafeConfig{}
		}
		dataOntologyMCPSafeConfig.Port = body.Port
		dataOntologyMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("[MCP] 保存端口配置失败: err=%v", err)
		}
		log.Printf("[MCP] 端口配置已更新: port=%d (需重启服务生效)", body.Port)
		jsonSuccess(w, map[string]interface{}{"success": true, "port": body.Port, "message": "端口配置已保存，重启服务后生效"})
	default:
		apiMethodNotAllowed(w)
	}
}

// 测试数据库连接
func handleTestConnection(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method != http.MethodPost {
		apiBadRequest(w, "只支持POST请求")
		return
	}

	var config DatabaseConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		apiBadRequest(w, "请求格式错误")
		return
	}

	// 调试日志：打印接收到的配置
	log.Printf("[DB] 测试连接: type=%s, host=%s, port=%d, user=%s, database=%s",
		config.Type, config.Host, config.Port, config.User, config.Database)

	// MongoDB 特殊处理
	if config.Type == "mongodb" {
		uri := buildMongoURI(&config)
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
		if err != nil {
			log.Printf("[DB] MongoDB 连接失败: err=%v", err)
			jsonError(w, "连接失败: "+err.Error(), "")
			return
		}
		defer client.Disconnect(ctx)

		if err := client.Ping(ctx, nil); err != nil {
			log.Printf("[DB] MongoDB Ping 失败: err=%v", err)
			jsonError(w, "连接失败: "+err.Error(), "")
			return
		}

		log.Printf("[DB] MongoDB 连接成功: host=%s", config.Host)
		jsonSuccess(w, map[string]interface{}{"success": true, "message": "连接成功"})
		return
	}

	// Elasticsearch 特殊处理
	if config.Type == "elasticsearch" {
		url := fmt.Sprintf("http://%s:%d", config.Host, config.Port)
		resp, err := http.Get(url)
		if err != nil {
			log.Printf("[DB] Elasticsearch 连接失败: err=%v", err)
			jsonError(w, "连接失败: "+err.Error(), "")
			return
		}
		defer resp.Body.Close()

		log.Printf("[DB] Elasticsearch 连接成功: host=%s", config.Host)
		jsonSuccess(w, map[string]interface{}{"success": true, "message": "连接成功"})
		return
	}

	// InfluxDB 特殊处理
	if config.Type == "influxdb" {
		url := fmt.Sprintf("http://%s:%d/ping", config.Host, config.Port)
		resp, err := http.Get(url)
		if err != nil {
			log.Printf("[DB] InfluxDB 连接失败: err=%v", err)
			jsonError(w, "连接失败: "+err.Error(), "")
			return
		}
		defer resp.Body.Close()

		log.Printf("[DB] InfluxDB 连接成功: host=%s", config.Host)
		jsonSuccess(w, map[string]interface{}{"success": true, "message": "连接成功"})
		return
	}

	// Redis 特殊处理
	if config.Type == "redis" {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", config.Host, config.Port), 5*time.Second)
		if err != nil {
			log.Printf("[DB] Redis 连接失败: err=%v", err)
			jsonError(w, "连接失败: "+err.Error(), "")
			return
		}
		defer conn.Close()

		log.Printf("[DB] Redis 连接成功: host=%s", config.Host)
		jsonSuccess(w, map[string]interface{}{"success": true, "message": "连接成功"})
		return
	}

	// Memcached 特殊处理
	if config.Type == "memcached" {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", config.Host, config.Port), 5*time.Second)
		if err != nil {
			log.Printf("[DB] Memcached 连接失败: err=%v", err)
			jsonError(w, "连接失败: "+err.Error(), "")
			return
		}
		defer conn.Close()

		log.Printf("[DB] Memcached 连接成功: host=%s", config.Host)
		jsonSuccess(w, map[string]interface{}{"success": true, "message": "连接成功"})
		return
	}

	// Neo4j 特殊处理
	if config.Type == "neo4j" {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", config.Host, config.Port), 5*time.Second)
		if err != nil {
			log.Printf("[DB] Neo4j 连接失败: err=%v", err)
			jsonError(w, "连接失败: "+err.Error(), "")
			return
		}
		defer conn.Close()

		log.Printf("[DB] Neo4j 连接成功: host=%s", config.Host)
		jsonSuccess(w, map[string]interface{}{"success": true, "message": "连接成功 (基础端口测试)"})
		return
	}

	// Cassandra, HBase 等通过 TCP 简单测试
	if config.Type == "cassandra" || config.Type == "hbase" {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", config.Host, config.Port), 5*time.Second)
		if err != nil {
			log.Printf("[DB] %s 连接失败: err=%v", config.Type, err)
			jsonError(w, "连接失败: "+err.Error(), "")
			return
		}
		defer conn.Close()

		log.Printf("[DB] %s 连接成功: host=%s", config.Type, config.Host)
		jsonSuccess(w, map[string]interface{}{"success": true, "message": "连接成功 (基础端口测试)"})
		return
	}

	// SQL数据库通用处理 - 使用连接池
	log.Printf("[DB] 连接数据库: host=%s, port=%d, database=%s", config.Host, config.Port, config.Database)

	db, err := getDBFromPool(&config)
	if err != nil {
		log.Printf("[DB] SQL数据库连接失败: type=%s, err=%v", config.Type, err)
		jsonError(w, "连接失败: "+err.Error(), "")
		return
	}

	if err := db.Ping(); err != nil {
		log.Printf("[DB] SQL数据库Ping失败: type=%s, err=%v", config.Type, err)
		jsonError(w, "连接失败: "+err.Error(), "")
		return
	}

	log.Printf("[DB] SQL数据库连接成功: type=%s, host=%s", config.Type, config.Host)
	jsonSuccess(w, map[string]interface{}{"success": true, "message": "连接成功"})
}

// 数据库管理
func handleDatabases(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "未授权")
		return
	}

	switch r.Method {
	case http.MethodGet:
		// 获取数据库列表
		dataOntologyMu.RLock()
		defer dataOntologyMu.RUnlock()

		databases := make([]DatabaseInfo, 0)
		for _, config := range dataOntologyDatabases {
			if !dataOntologyResourceVisible(config.Owner, username) {
				continue
			}
			databases = append(databases, DatabaseInfo{
				ID:       config.ID,
				Owner:    config.Owner,
				Type:     config.Type,
				Name:     config.Name,
				Host:     config.Host,
				Port:     config.Port,
				Path:     config.Path,
				User:     config.User,
				Database: config.Database,
				// 不返回密码
			})
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":   true,
			"databases": databases,
		})

	case http.MethodPost:
		// 添加数据库
		var config DatabaseConfig
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		// 测试连接（简化版，实际连接测试已在前端完成）
		// 这里只做基本验证
		if config.Type == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "数据库类型不能为空",
			})
			return
		}

		// 保存配置
		config.ID = uuid.New().String()
		config.Owner = username
		dataOntologyMu.Lock()
		dataOntologyDatabases[config.ID] = &config
		dataOntologyMu.Unlock()

		// 持久化保存
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存数据库配置失败: %v", err)
		}

		// 异步同步表信息到 SQLite FTS5 索引
		if manager := getFTS5Manager(); manager != nil {
			go func() {
				if err := manager.syncTablesToSQLite(&config); err != nil {
					log.Printf("[表检索] 同步新数据库 %s 表信息失败: %v", config.Name, err)
				}
			}()
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"id":      config.ID,
		})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
	}
}

// 获取数据库详情
func handleDatabaseDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	// 从URL中提取数据库ID
	path := r.URL.Path
	parts := strings.Split(path, "/")
	if len(parts) < 5 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的请求路径",
		})
		return
	}
	dbID := parts[4]

	dataOntologyMu.RLock()
	config, exists := dataOntologyDatabases[dbID]
	dataOntologyMu.RUnlock()

	if !exists || !dataOntologyResourceVisible(config.Owner, username) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在",
		})
		return
	}

	switch r.Method {
	case http.MethodGet:
		var tables []string
		var connected bool

		// MongoDB 特殊处理
		if config.Type == "mongodb" {
			uri := buildMongoURI(config)
			log.Printf("MongoDB 连接数据库: %s", config.Database)
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()

			client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
			if err == nil {
				defer client.Disconnect(ctx)
				if err := client.Ping(ctx, nil); err == nil {
					db := client.Database(config.Database)
					collections, err := db.ListCollectionNames(ctx, bson.M{})
					if err == nil {
						log.Printf("MongoDB 获取到 %d 个集合: %v", len(collections), collections)
						tables = collections
						connected = true
					} else {
						log.Printf("MongoDB 获取集合列表失败: %v", err)
					}
				} else {
					log.Printf("MongoDB Ping 失败: %v", err)
				}
			} else {
				log.Printf("MongoDB 连接失败: %v", err)
			}
		} else if config.Type == "redis" {
			// Redis 不支持表列表，显示数据库索引
			conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", config.Host, config.Port), 5*time.Second)
			if err == nil {
				conn.Close()
				connected = true
				tables = []string{"DB 0", "DB 1", "DB 2", "DB 3", "DB 4", "DB 5", "DB 6", "DB 7", "DB 8", "DB 9", "DB 10", "DB 11", "DB 12", "DB 13", "DB 14", "DB 15"}
			}
		} else if config.Type == "neo4j" || config.Type == "elasticsearch" || config.Type == "influxdb" || config.Type == "memcached" || config.Type == "cassandra" || config.Type == "hbase" {
			// 这些数据库暂不获取详细表列表
			conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", config.Host, config.Port), 5*time.Second)
			if err == nil {
				conn.Close()
				connected = true
				tables = []string{}
			}
		} else {
			// SQL数据库通用处理 - 使用连接池
			db, err := getDBFromPool(config)
			if err == nil {
				if err := db.Ping(); err == nil {
					connected = true
					// 获取表列表
					query := getTablesQuery(config)
					log.Printf("执行查询表列表: %s", query)
					rows, err := db.Query(query)
					if err != nil {
						log.Printf("查询表列表失败: %v", err)
					} else {
						defer rows.Close()
						for rows.Next() {
							var tableName string
							if err := rows.Scan(&tableName); err == nil {
								tables = append(tables, tableName)
								log.Printf("找到表: %s", tableName)
							} else {
								log.Printf("扫描表名失败: %v", err)
							}
						}
						log.Printf("共找到 %d 个表", len(tables))
					}
				}
			}
		}

		// 达梦：左侧表列表只显示用户表，隐藏系统表
		if config.Type == "dm" && len(tables) > 0 {
			filtered := make([]string, 0, len(tables))
			for _, t := range tables {
				if strings.HasPrefix(t, "##") || strings.HasPrefix(t, "AQ$_") || strings.HasPrefix(t, "SYS$") ||
					strings.HasPrefix(t, "DBMS_") || strings.HasPrefix(t, "REG$") || t == "POLICIES" || strings.HasPrefix(t, "POLICY_") {
					continue
				}
				filtered = append(filtered, t)
			}
			tables = filtered
		}

		if tables == nil {
			tables = []string{}
		}

		// 转换为 TableInfo 数组，并获取表备注
		tableInfos := make([]TableInfo, len(tables))
		var tableComments map[string]string

		// 对于 SQL 数据库，获取表备注
		if connected && config.Type != "mongodb" && config.Type != "redis" &&
			config.Type != "neo4j" && config.Type != "elasticsearch" &&
			config.Type != "influxdb" && config.Type != "memcached" &&
			config.Type != "cassandra" && config.Type != "hbase" {
			db, err := getDBFromPool(config)
			if err == nil {
				tableComments = getTableComments(db, config, tables)
			}
		}

		for i, tableName := range tables {
			tableInfos[i] = TableInfo{
				Name:    tableName,
				Comment: tableComments[tableName],
			}
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"database": DatabaseInfo{
				ID:        config.ID,
				Owner:     config.Owner,
				Type:      config.Type,
				Name:      config.Name,
				Host:      config.Host,
				Port:      config.Port,
				Database:  config.Database,
				Path:      config.Path,
				Connected: connected,
				Tables:    tableInfos,
			},
		})

	case "PUT":
		// 更新数据库配置
		var updateConfig DatabaseConfig
		if err := json.NewDecoder(r.Body).Decode(&updateConfig); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		dataOntologyMu.Lock()
		// 保留原ID和类型
		updateConfig.ID = config.ID
		updateConfig.Type = config.Type
		updateConfig.Owner = config.Owner

		// 如果密码为空，保留原密码
		if updateConfig.Password == "" {
			updateConfig.Password = config.Password
		}

		dataOntologyDatabases[dbID] = &updateConfig
		dataOntologyMu.Unlock()

		// 持久化保存
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存数据库配置更新失败: %v", err)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "更新成功",
		})

	case http.MethodDelete:
		// 删除数据库配置
		dataOntologyMu.Lock()
		delete(dataOntologyDatabases, dbID)
		dataOntologyMu.Unlock()

		// 持久化保存
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存数据库配置删除失败: %v", err)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
		})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
	}
}

// LineageEdge 外键血缘边：from 表的外键列引用 to 表的主键/唯一列（数据从 to 流向 from）
type LineageEdge struct {
	FromTable  string `json:"fromTable"`
	FromColumn string `json:"fromColumn"`
	ToTable    string `json:"toTable"`
	ToColumn   string `json:"toColumn"`
	Constraint string `json:"constraint,omitempty"`
}

func dedupeLineageEdges(edges []LineageEdge) []LineageEdge {
	seen := make(map[string]struct{}, len(edges))
	out := make([]LineageEdge, 0, len(edges))
	for _, e := range edges {
		k := e.FromTable + "\x00" + e.FromColumn + "\x00" + e.ToTable + "\x00" + e.ToColumn
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, e)
	}
	return out
}

func handleDatabaseLineage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}
	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}
	path := strings.Trim(r.URL.Path, "/")
	parts := strings.Split(path, "/")
	// api / data-ontology / databases / {id} / lineage
	if len(parts) != 5 || parts[0] != "api" || parts[1] != "data-ontology" || parts[2] != "databases" || parts[4] != "lineage" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的请求路径",
		})
		return
	}
	dbID := parts[3]
	dataOntologyMu.RLock()
	config, exists := dataOntologyDatabases[dbID]
	dataOntologyMu.RUnlock()
	if !exists || !dataOntologyResourceVisible(config.Owner, username) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在",
		})
		return
	}

	if config.Type == "mongodb" || config.Type == "redis" || config.Type == "neo4j" ||
		config.Type == "elasticsearch" || config.Type == "influxdb" || config.Type == "memcached" ||
		config.Type == "cassandra" || config.Type == "hbase" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"tables":  []string{},
			"edges":   []LineageEdge{},
			"message": "当前数据库类型不支持基于外键的血缘分析",
		})
		return
	}

	tables, err := getTablesList(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "获取表列表失败: " + err.Error(),
		})
		return
	}

	// 使用连接池
	db, err := getDBFromPool(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接失败: " + err.Error(),
		})
		return
	}

	edges, warn := queryForeignKeyLineage(db, config, tables)
	edges = dedupeLineageEdges(edges)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"dbType":    config.Type,
		"tables":    tables,
		"edges":     edges,
		"edgeCount": len(edges),
		"message":   warn,
	})
}

// handleTableRetrievalSync 同步表检索索引
func handleTableRetrievalSync(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	_, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}

	// 解析请求
	var req struct {
		DatabaseID    string `json:"database_id,omitempty"`    // 可选：指定数据库ID，不指定则同步所有
		SyncTables    *bool  `json:"sync_tables,omitempty"`    // 是否同步表数据，默认 true
		SyncVectors   *bool  `json:"sync_vectors,omitempty"`   // 是否同步向量，默认 true
		SyncRelations *bool  `json:"sync_relations,omitempty"` // 是否同步关系，默认 true
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求格式错误",
		})
		return
	}

	// 默认值：如果未指定参数，则全部同步（向后兼容）
	syncTables := req.SyncTables == nil || *req.SyncTables
	syncVectors := req.SyncVectors == nil || *req.SyncVectors
	syncRelations := req.SyncRelations == nil || *req.SyncRelations

	manager := getFTS5Manager()
	if manager == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "表检索系统未初始化",
		})
		return
	}

	// 异步执行同步
	go func() {
		if req.DatabaseID != "" {
			// 同步指定数据库
			dataOntologyMu.RLock()
			dbConfig, exists := dataOntologyDatabases[req.DatabaseID]
			dataOntologyMu.RUnlock()

			if !exists {
				log.Printf("[表检索] 数据库不存在: %s", req.DatabaseID)
				return
			}

			// 同步表数据
			if syncTables {
				if err := manager.syncTablesToSQLite(dbConfig); err != nil {
					log.Printf("[表检索] 同步表数据失败: %v", err)
				}
			}
			// 同步向量到 SQLite（如果 embedding 配置启用）
			if syncVectors && dataOntologyAIConfig != nil && dataOntologyAIConfig.Embedding.Enabled && dataOntologyAIConfig.Embedding.URL != "" {
				if err := manager.syncVectorsToSQLite(dbConfig, dataOntologyAIConfig.Embedding); err != nil {
					log.Printf("[表检索] 同步向量数据失败: %v", err)
				}
			}
			// 同步关系到 SQLite
			if syncRelations {
				if err := manager.syncRelationsToSQLite(dbConfig); err != nil {
					log.Printf("[表检索] 同步关系数据失败: %v", err)
				}
			}
		} else {
			// 同步所有数据库
			// 同步表数据
			if syncTables {
				if err := manager.syncAllDatabases(); err != nil {
					log.Printf("[表检索] 同步表数据失败: %v", err)
				}
			}
			// 同步所有数据库的向量
			if syncVectors && dataOntologyAIConfig != nil && dataOntologyAIConfig.Embedding.Enabled && dataOntologyAIConfig.Embedding.URL != "" {
				dataOntologyMu.RLock()
				dbs := make(map[string]*DatabaseConfig)
				for k, v := range dataOntologyDatabases {
					dbs[k] = v
				}
				dataOntologyMu.RUnlock()
				for _, dbConfig := range dbs {
					if err := manager.syncVectorsToSQLite(dbConfig, dataOntologyAIConfig.Embedding); err != nil {
						log.Printf("[表检索] 同步向量数据失败 (%s): %v", dbConfig.Name, err)
					}
				}
			}
			// 同步所有数据库的关系
			if syncRelations {
				dataOntologyMu.RLock()
				dbs := make(map[string]*DatabaseConfig)
				for k, v := range dataOntologyDatabases {
					dbs[k] = v
				}
				dataOntologyMu.RUnlock()
				for _, dbConfig := range dbs {
					if err := manager.syncRelationsToSQLite(dbConfig); err != nil {
						log.Printf("[表检索] 同步关系数据失败 (%s): %v", dbConfig.Name, err)
					}
				}
			}
		}
	}()

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "同步任务已启动",
	})
}

// handleTableRetrievalStatus 获取表检索索引状态
func handleTableRetrievalStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	_, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}

	manager := getFTS5Manager()
	if manager == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "表检索系统未初始化",
		})
		return
	}

	// 查询索引状态
	totalCount, dbStats, err := manager.getStats()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询索引状态失败",
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"total_tables": totalCount,
		"database_stats": dbStats,
	})
}

// handleTableRetrievalEmbeddingStatus 查询向量同步状态
func handleTableRetrievalEmbeddingStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	_, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}

	manager := getFTS5Manager()
	if manager == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "表检索系统未初始化",
		})
		return
	}

	// 查询向量状态
	totalVectors, dbVectorStats, err := manager.getVectorStats()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询向量状态失败: " + err.Error(),
		})
		return
	}

	// 获取 embedding 配置信息
	dataOntologyMu.RLock()
	aiConfig := dataOntologyAIConfig
	dataOntologyMu.RUnlock()

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"total_vectors":  totalVectors,
		"database_stats": dbVectorStats,
		"embedding_config": map[string]interface{}{
			"enabled":   aiConfig.Embedding.Enabled,
			"model":     aiConfig.Embedding.Model,
			"dimension": aiConfig.Embedding.Dimension,
		},
	})
}

// handleTableRetrievalRelationStatus 查询关系索引状态
func handleTableRetrievalRelationStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	_, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}

	manager := getFTS5Manager()
	if manager == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "表检索系统未初始化",
		})
		return
	}

	// 查询关系状态
	totalRelations, dbRelationStats, err := manager.getRelationStats()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询关系状态失败: " + err.Error(),
		})
		return
	}

	// 获取各数据库的关系数量
	dataOntologyMu.RLock()
	dbRelationCounts := make(map[string]int)
	for id, count := range dbRelationStats {
		if cfg, ok := dataOntologyDatabases[id]; ok {
			dbRelationCounts[cfg.Name] = count
		}
	}
	dataOntologyMu.RUnlock()

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"total_relations": totalRelations,
		"database_stats":  dbRelationCounts,
	})
}

// handleTableRetrievalSearch 表检索搜索接口
func handleTableRetrievalSearch(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	_, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}

	// 解析参数
	databaseID := r.URL.Query().Get("database_id")
	query := r.URL.Query().Get("query")
	strategy := r.URL.Query().Get("strategy")
	if strategy == "" {
		strategy = "hybrid"
	}

	if databaseID == "" || query == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "缺少必要参数: database_id 或 query",
		})
		return
	}

	// 获取数据库配置
	dataOntologyMu.RLock()
	dbConfig, exists := dataOntologyDatabases[databaseID]
	dataOntologyMu.RUnlock()

	if !exists {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在",
		})
		return
	}

	// 构建检索配置
	config := &TableRetrievalConfig{
		Strategy:      strategy,
		MaxTables:     15,
		VectorWeight:  0.3,
		KeywordWeight: 0.4,
		GraphWeight:   0.3,
	}

	// 从全局 AI 配置获取权重
	if dataOntologyAIConfig != nil && dataOntologyAIConfig.TableRetrieval != nil {
		config.VectorWeight = dataOntologyAIConfig.TableRetrieval.VectorWeight
		config.KeywordWeight = dataOntologyAIConfig.TableRetrieval.KeywordWeight
		config.GraphWeight = dataOntologyAIConfig.TableRetrieval.GraphWeight
		if dataOntologyAIConfig.TableRetrieval.GraphConfig != nil {
			config.GraphConfig = dataOntologyAIConfig.TableRetrieval.GraphConfig
		}
	}

	// 执行检索
	results, err := retrieveRelevantTables(query, dbConfig, config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("检索失败: %v", err),
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"query":    query,
		"strategy": strategy,
		"results":  results,
		"count":    len(results),
	})
}

func queryForeignKeyLineage(db *sql.DB, config *DatabaseConfig, tables []string) ([]LineageEdge, string) {
	var edges []LineageEdge
	var warn string

	switch config.Type {
	case "mysql", "mariadb", "tidb":
		q := `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME
			FROM information_schema.KEY_COLUMN_USAGE
			WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
			ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`
		rows, err := db.Query(q, config.Database)
		if err != nil {
			return nil, "查询外键失败: " + err.Error()
		}
		defer rows.Close()
		for rows.Next() {
			var fromT, fromC, toT, toC, cname string
			if err := rows.Scan(&fromT, &fromC, &toT, &toC, &cname); err == nil {
				edges = append(edges, LineageEdge{FromTable: fromT, FromColumn: fromC, ToTable: toT, ToColumn: toC, Constraint: cname})
			}
		}

	case "postgresql", "timescaledb", "cockroachdb":
		q := `
			SELECT con.conname::text,
			       nsp.nspname || '.' || rel.relname,
			       att.attname::text,
			       fnsp.nspname || '.' || frel.relname,
			       fatt.attname::text
			FROM pg_catalog.pg_constraint con
			INNER JOIN pg_catalog.pg_class rel ON rel.oid = con.conrelid
			INNER JOIN pg_catalog.pg_namespace nsp ON nsp.oid = rel.relnamespace
			INNER JOIN pg_catalog.pg_class frel ON frel.oid = con.confrelid
			INNER JOIN pg_catalog.pg_namespace fnsp ON fnsp.oid = frel.relnamespace
			CROSS JOIN LATERAL unnest(con.conkey, con.confkey) AS u(attnum, refattnum)
			INNER JOIN pg_catalog.pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.attnum AND NOT att.attisdropped
			INNER JOIN pg_catalog.pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = u.refattnum AND NOT fatt.attisdropped
			WHERE con.contype = 'f'
			  AND nsp.nspname NOT IN ('pg_catalog', 'information_schema')`
		rows, err := db.Query(q)
		if err != nil {
			return nil, "查询外键失败: " + err.Error()
		}
		defer rows.Close()
		for rows.Next() {
			var cname, fromT, fromC, toT, toC string
			if err := rows.Scan(&cname, &fromT, &fromC, &toT, &toC); err == nil {
				edges = append(edges, LineageEdge{FromTable: fromT, FromColumn: fromC, ToTable: toT, ToColumn: toC, Constraint: cname})
			}
		}

	case "sqlserver":
		q := `
			SELECT OBJECT_SCHEMA_NAME(fkc.parent_object_id) + '.' + OBJECT_NAME(fkc.parent_object_id),
			       col1.name,
			       OBJECT_SCHEMA_NAME(fkc.referenced_object_id) + '.' + OBJECT_NAME(fkc.referenced_object_id),
			       col2.name,
			       fk.name
			FROM sys.foreign_key_columns fkc
			INNER JOIN sys.foreign_keys fk ON fkc.constraint_object_id = fk.object_id
			INNER JOIN sys.columns col1 ON fkc.parent_object_id = col1.object_id AND fkc.parent_column_id = col1.column_id
			INNER JOIN sys.columns col2 ON fkc.referenced_object_id = col2.object_id AND fkc.referenced_column_id = col2.column_id`
		rows, err := db.Query(q)
		if err != nil {
			return nil, "查询外键失败: " + err.Error()
		}
		defer rows.Close()
		for rows.Next() {
			var fromT, fromC, toT, toC, cname string
			if err := rows.Scan(&fromT, &fromC, &toT, &toC, &cname); err == nil {
				edges = append(edges, LineageEdge{FromTable: fromT, FromColumn: fromC, ToTable: toT, ToColumn: toC, Constraint: cname})
			}
		}

	case "oracle":
		q := `SELECT a.owner || '.' || a.table_name, a.column_name,
		         b.owner || '.' || b.table_name, b.column_name,
		         c.constraint_name
		      FROM all_cons_columns a
		      JOIN all_constraints c ON a.owner = c.owner AND a.constraint_name = c.constraint_name
		      JOIN all_constraints c_pk ON c.r_owner = c_pk.owner AND c.r_constraint_name = c_pk.constraint_name
		      JOIN all_cons_columns b ON c_pk.owner = b.owner AND c_pk.constraint_name = b.constraint_name
		        AND a.position = b.position
		      WHERE c.constraint_type = 'R'
		        AND a.owner NOT IN ('SYS','SYSTEM','OUTLN','DBSNMP','MDSYS','CTXSYS','XDB')`
		rows, err := db.Query(q)
		if err != nil {
			return nil, "查询外键失败: " + err.Error()
		}
		defer rows.Close()
		for rows.Next() {
			var fromT, fromC, toT, toC, cname string
			if err := rows.Scan(&fromT, &fromC, &toT, &toC, &cname); err == nil {
				edges = append(edges, LineageEdge{FromTable: fromT, FromColumn: fromC, ToTable: toT, ToColumn: toC, Constraint: cname})
			}
		}

	case "dm":
		q := `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME
			FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
			WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
			ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`
		rows, err := db.Query(q, config.Database)
		if err != nil {
			// 达梦部分版本元数据字段不同，返回空边并提示
			warn = "达梦库未返回标准 information_schema 外键信息: " + err.Error()
			return []LineageEdge{}, warn
		}
		defer rows.Close()
		for rows.Next() {
			var fromT, fromC, toT, toC, cname string
			if err := rows.Scan(&fromT, &fromC, &toT, &toC, &cname); err == nil {
				edges = append(edges, LineageEdge{FromTable: fromT, FromColumn: fromC, ToTable: toT, ToColumn: toC, Constraint: cname})
			}
		}

	case "sqlite":
		sqliteQuote := func(name string) string {
			return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
		}
		for _, t := range tables {
			prag := fmt.Sprintf("PRAGMA foreign_key_list(%s)", sqliteQuote(t))
			rows, err := db.Query(prag)
			if err != nil {
				continue
			}
			for rows.Next() {
				var id, seq int
				var refTable, fromCol, toCol string
				var onUpdate, onDelete, match string
				if err := rows.Scan(&id, &seq, &refTable, &fromCol, &toCol, &onUpdate, &onDelete, &match); err != nil {
					continue
				}
				if toCol == "" {
					toCol = fromCol
				}
				edges = append(edges, LineageEdge{
					FromTable: t, FromColumn: fromCol, ToTable: refTable, ToColumn: toCol,
					Constraint: fmt.Sprintf("fk_%d", id),
				})
			}
			rows.Close()
		}

	case "duckdb":
		warn = "DuckDB 在当前环境可能不可用；若已连接，暂不支持自动外键血缘"
		return []LineageEdge{}, warn

	default:
		warn = "该数据库类型未实现外键血缘采集"
	}

	return edges, warn
}

// 获取表数据
func handleTableData(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	log.Printf("[handleTableData] path=%s, parts=%v, len=%d", r.URL.Path, strings.Split(r.URL.Path, "/"), len(strings.Split(r.URL.Path, "/")))
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	// 从URL中提取数据库ID和表名
	path := r.URL.Path
	parts := strings.Split(path, "/")

	// 路径格式: /api/data-ontology/databases/{id}/tables 或 /api/data-ontology/databases/{id}/tables/{name}
	if len(parts) < 6 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的请求路径",
		})
		return
	}

	dbID := parts[4]

	dataOntologyMu.RLock()
	config, exists := dataOntologyDatabases[dbID]
	dataOntologyMu.RUnlock()

	if !exists || !dataOntologyResourceVisible(config.Owner, username) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在",
		})
		return
	}

	// 如果路径以 /tables 结尾
	if strings.HasSuffix(path, "/tables") {
		if r.Method == http.MethodGet {
			// 获取表列表
			handleDatabaseTablesList(w, r, config)
			return
		} else if r.Method == http.MethodPost {
			// 创建表
			handleTableCreate(w, r, config)
			return
		}
	}

	// 其他情况需要表名
	if len(parts) < 7 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的请求路径",
		})
		return
	}

	tableName := parts[6]

	// 安全验证：检查表名是否合法，防止 SQL 注入
	if !isValidIdentifierWithSchema(tableName) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的表名",
		})
		return
	}

	// 检查是否是特殊路径
	if strings.HasSuffix(path, "/structure") {
		// 获取表结构
		handleTableStructure(w, r, config, tableName)
		return
	}

	if strings.HasSuffix(path, "/rename") && (r.Method == http.MethodPut || r.Method == http.MethodPost) {
		handleTableRename(w, r, config, tableName)
		return
	}

	if strings.HasSuffix(path, "/data") {
		// 数据操作路径
		if r.Method == http.MethodPost {
			handleTableDataSave(w, r, config, tableName)
		} else {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "不支持的请求方法",
			})
		}
		return
	}

	// 处理不同的HTTP方法
	switch r.Method {
	case http.MethodGet:
		// 处理数据查询
		handleTableDataQuery(w, r, config, tableName)
		return
	case http.MethodDelete:
		// 删除表
		handleTableDrop(w, r, config, tableName)
		return
	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}
}

// TableDataSaveRequest 保存表格数据的请求体
type TableDataSaveRequest struct {
	Updates []struct {
		Index int                    `json:"index"`
		Data  map[string]interface{} `json:"data"`
	} `json:"updates"`
	Inserts []map[string]interface{} `json:"inserts"`
	Deletes []int                    `json:"deletes"`
}

// handleTableDataSave 处理表格数据保存（更新、插入、删除）
func handleTableDataSave(w http.ResponseWriter, r *http.Request, config *DatabaseConfig, tableName string) {
	// 安全验证：检查表名是否合法，防止 SQL 注入
	if !isValidIdentifierWithSchema(tableName) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的表名: " + tableName,
		})
		return
	}

	// 解析请求体
	var req TableDataSaveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求格式错误: " + err.Error(),
		})
		return
	}

	log.Printf("收到保存请求: 表=%s, 更新=%d条, 插入=%d条, 删除=%d条",
		tableName, len(req.Updates), len(req.Inserts), len(req.Deletes))

	// 只支持SQL数据库的数据修改
	if config.Type == "mongodb" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "MongoDB暂不支持此功能",
		})
		return
	}

	// 建立数据库连接 - 使用连接池
	db, err := getDBFromPool(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接失败: " + err.Error(),
		})
		return
	}

	// 首先查询所有数据以获取主键
	quotedTable, _ := safeQuoteIdentifier(tableName, config.Type)
	query := fmt.Sprintf("SELECT * FROM %s", quotedTable)

	rows, err := db.Query(query)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询失败: " + err.Error(),
		})
		return
	}

	// 获取列名
	columns, err := rows.Columns()
	if err != nil {
		rows.Close()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "获取列名失败: " + err.Error(),
		})
		return
	}

	// 读取所有数据
	allData := make([]map[string]interface{}, 0)
	for rows.Next() {
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range values {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			continue
		}

		row := make(map[string]interface{})
		for i, col := range columns {
			val := values[i]
			if b, ok := val.([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = val
			}
		}
		allData = append(allData, row)
	}
	rows.Close()

	log.Printf("查询到 %d 行数据", len(allData))

	// 根据数据库类型确定标识符引用符和是否支持 LIMIT
	var quoteChar string
	var supportsLimit bool
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb", "dm":
		quoteChar = `"`
		supportsLimit = config.Type != "dm" // 达梦不支持 LIMIT
	case "sqlserver":
		quoteChar = "["
		supportsLimit = false
	case "oracle":
		quoteChar = ""
		supportsLimit = false
	default:
		quoteChar = "`"
		supportsLimit = true
	}

	quoteIdentifier := func(name string) string {
		// 安全验证：检查标识符是否合法
		if !isValidIdentifier(name) {
			log.Printf("警告：无效的标识符被拒绝: %s", name)
			return "INVALID_IDENTIFIER"
		}
		if quoteChar == "[" {
			return "[" + name + "]"
		} else if quoteChar == "" {
			return name
		}
		return quoteChar + name + quoteChar
	}

	// Oracle 使用 :1, :2, ... 占位符，其他数据库用 ?
	oraclize := func(query string) string {
		if config.Type != "oracle" {
			return query
		}
		i := 0
		var buf strings.Builder
		for _, ch := range query {
			if ch == '?' {
				i++
				buf.WriteString(fmt.Sprintf(":%d", i))
			} else {
				buf.WriteRune(ch)
			}
		}
		return buf.String()
	}

	updated := 0
	inserted := 0
	deleted := 0

	// 1. 处理删除（从后往前删，避免索引混乱）
	if len(req.Deletes) > 0 {
		// 排序删除索引（从大到小）
		sort.Sort(sort.Reverse(sort.IntSlice(req.Deletes)))
		log.Printf("处理删除: %v", req.Deletes)

		for _, index := range req.Deletes {
			if index < 0 || index >= len(allData) {
				log.Printf("跳过无效索引: %d", index)
				continue
			}

			rowData := allData[index]

			// 构建WHERE条件（使用所有列匹配）
			whereClauses := make([]string, 0)
			whereValues := make([]interface{}, 0)
			for col, val := range rowData {
				if val == nil {
					whereClauses = append(whereClauses, fmt.Sprintf("%s IS NULL", quoteIdentifier(col)))
				} else {
					whereClauses = append(whereClauses, fmt.Sprintf("%s = ?", quoteIdentifier(col)))
					whereValues = append(whereValues, val)
				}
			}

			var deleteQuery string
			if supportsLimit {
				deleteQuery = fmt.Sprintf("DELETE FROM %s WHERE %s LIMIT 1",
					quoteIdentifier(tableName), strings.Join(whereClauses, " AND "))
			} else {
				// 达梦、Oracle、SQL Server 不支持 DELETE ... LIMIT
				// WHERE 条件已包含所有列匹配，理论上只会删除一行
				deleteQuery = fmt.Sprintf("DELETE FROM %s WHERE %s",
					quoteIdentifier(tableName), strings.Join(whereClauses, " AND "))
			}

			deleteQuery = oraclize(deleteQuery)
			log.Printf("执行删除SQL: %s", deleteQuery)
			result, err := db.Exec(deleteQuery, whereValues...)
			if err != nil {
				log.Printf("删除失败: %v", err)
				continue
			}

			affected, _ := result.RowsAffected()
			deleted += int(affected)
			log.Printf("删除成功，影响行数: %d", affected)
		}
	}

	// 2. 处理更新
	for _, update := range req.Updates {
		if update.Index < 0 || update.Index >= len(allData) {
			continue
		}

		oldRow := allData[update.Index]

		// 构建UPDATE语句
		setClauses := make([]string, 0)
		setValues := make([]interface{}, 0)
		for col, val := range update.Data {
			setClauses = append(setClauses, fmt.Sprintf("%s = ?", quoteIdentifier(col)))
			setValues = append(setValues, val)
		}

		// 构建WHERE条件（使用旧数据匹配）
		whereClauses := make([]string, 0)
		whereValues := make([]interface{}, 0)
		for col, val := range oldRow {
			if val == nil {
				whereClauses = append(whereClauses, fmt.Sprintf("%s IS NULL", quoteIdentifier(col)))
			} else {
				whereClauses = append(whereClauses, fmt.Sprintf("%s = ?", quoteIdentifier(col)))
				whereValues = append(whereValues, val)
			}
		}

		var updateQuery string
		if supportsLimit {
			updateQuery = fmt.Sprintf("UPDATE %s SET %s WHERE %s LIMIT 1",
				quoteIdentifier(tableName), strings.Join(setClauses, ", "), strings.Join(whereClauses, " AND "))
		} else {
			// 达梦、Oracle、SQL Server 不支持 UPDATE ... LIMIT
			// WHERE 条件已包含所有列匹配，理论上只会更新一行
			updateQuery = fmt.Sprintf("UPDATE %s SET %s WHERE %s",
				quoteIdentifier(tableName), strings.Join(setClauses, ", "), strings.Join(whereClauses, " AND "))
		}

		allValues := append(setValues, whereValues...)
		updateQuery = oraclize(updateQuery)
		log.Printf("执行更新SQL: %s", updateQuery)
		result, err := db.Exec(updateQuery, allValues...)
		if err != nil {
			log.Printf("更新失败: %v, SQL: %s", err, updateQuery)
			continue
		}

		affected, _ := result.RowsAffected()
		updated += int(affected)
		log.Printf("更新成功，影响行数: %d", affected)
	}

	// 3. 处理插入
	// 对于达梦/Oracle 数据库，需要先查询自增列并排除
	identityColumns := make(map[string]bool)
	if config.Type == "dm" {
		// 安全验证已确保 tableName 合法
		identQuery := fmt.Sprintf(`
			SELECT a.NAME
			FROM SYS.SYSCOLUMNS a, sys.sysobjects b
			WHERE b.id = a.id AND b.name = '%s' AND (a.INFO2 & 0x01) = 0x01
		`, oracleEscapeIdentifier(tableName))
		identRows, err := db.Query(identQuery)
		if err == nil {
			defer identRows.Close()
			for identRows.Next() {
				var colName string
				if err := identRows.Scan(&colName); err == nil {
					identityColumns[colName] = true
					log.Printf("发现自增列: %s", colName)
				}
			}
		}
	}
	if config.Type == "oracle" {
		tbl := tableName
		if idx := strings.Index(tbl, "."); idx >= 0 {
			tbl = tbl[idx+1:]
		}
		// 安全验证已确保表名合法
		identQuery := fmt.Sprintf("SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' AND IDENTITY_COLUMN = 'YES'", oracleEscapeIdentifier(tbl))
		identRows, err := db.Query(identQuery)
		if err == nil {
			defer identRows.Close()
			for identRows.Next() {
				var colName string
				if err := identRows.Scan(&colName); err == nil {
					identityColumns[colName] = true
					log.Printf("发现Oracle自增列: %s", colName)
				}
			}
		}
	}

	for _, insertData := range req.Inserts {
		cols := make([]string, 0)
		placeholders := make([]string, 0)
		values := make([]interface{}, 0)

		for col, val := range insertData {
			// 达梦/Oracle：跳过自增列
			if (config.Type == "dm" || config.Type == "oracle") && identityColumns[col] {
				log.Printf("跳过自增列 %s", col)
				continue
			}

			cols = append(cols, quoteIdentifier(col))
			placeholders = append(placeholders, "?")
			values = append(values, val)
		}

		var insertQuery string
		var result sql.Result
		var err error

		// 如果所有列都被跳过（只有自增列），使用 DEFAULT VALUES
		if len(cols) == 0 {
			insertQuery = fmt.Sprintf("INSERT INTO %s DEFAULT VALUES", quoteIdentifier(tableName))
			log.Printf("执行插入SQL (默认值): %s", insertQuery)
			result, err = db.Exec(insertQuery)
		} else {
			insertQuery = fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
				quoteIdentifier(tableName), strings.Join(cols, ", "), strings.Join(placeholders, ", "))
			insertQuery = oraclize(insertQuery)
			log.Printf("执行插入SQL: %s", insertQuery)
			result, err = db.Exec(insertQuery, values...)
		}

		if err != nil {
			log.Printf("插入失败: %v, SQL: %s", err, insertQuery)
			continue
		}

		affected, _ := result.RowsAffected()
		inserted += int(affected)
		log.Printf("插入成功，影响行数: %d", affected)
	}

	log.Printf("保存完成: 更新=%d, 插入=%d, 删除=%d", updated, inserted, deleted)

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"updated":  updated,
		"inserted": inserted,
		"deleted":  deleted,
	})
}

// handleTableDataQuery 处理表格数据查询
func handleTableDataQuery(w http.ResponseWriter, r *http.Request, config *DatabaseConfig, tableName string) {
	var data []map[string]interface{}

	// MongoDB 特殊处理
	if config.Type == "mongodb" {
		uri := buildMongoURI(config)
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "连接失败: " + err.Error(),
			})
			return
		}
		defer client.Disconnect(ctx)

		collection := client.Database(config.Database).Collection(tableName)
		cursor, err := collection.Find(ctx, bson.M{}, options.Find().SetLimit(100))
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "查询失败: " + err.Error(),
			})
			return
		}
		defer cursor.Close(ctx)

		data = make([]map[string]interface{}, 0)
		for cursor.Next(ctx) {
			var result map[string]interface{}
			if err := cursor.Decode(&result); err == nil {
				data = append(data, result)
			}
		}
	} else {
		// SQL数据库通用处理 - 使用连接池
		db, err := getDBFromPool(config)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "连接失败: " + err.Error(),
			})
			return
		}

		// 查询数据（限制100条）
		var query string
		switch config.Type {
		case "postgresql", "timescaledb", "cockroachdb":
			query = fmt.Sprintf(`SELECT * FROM "%s" LIMIT 100`, tableName)
		case "oracle", "dm":
			query = fmt.Sprintf("SELECT * FROM %s WHERE ROWNUM <= 100", tableName)
		case "sqlserver":
			query = fmt.Sprintf("SELECT TOP 100 * FROM [%s]", tableName)
		case "duckdb":
			query = fmt.Sprintf("SELECT * FROM %s LIMIT 100", tableName)
		case "clickhouse":
			query = fmt.Sprintf("SELECT * FROM `%s` LIMIT 100", tableName)
		default:
			// mysql, mariadb, tidb, sqlite
			query = fmt.Sprintf("SELECT * FROM `%s` LIMIT 100", tableName)
		}

		rows, err := db.Query(query)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "查询失败: " + err.Error(),
			})
			return
		}
		defer rows.Close()

		// 获取列名
		columns, err := rows.Columns()
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "获取列名失败: " + err.Error(),
			})
			return
		}

		// 读取数据
		data = make([]map[string]interface{}, 0)
		for rows.Next() {
			values := make([]interface{}, len(columns))
			valuePtrs := make([]interface{}, len(columns))
			for i := range values {
				valuePtrs[i] = &values[i]
			}

			if err := rows.Scan(valuePtrs...); err != nil {
				continue
			}

			row := make(map[string]interface{})
			for i, col := range columns {
				val := values[i]
				if b, ok := val.([]byte); ok {
					row[col] = string(b)
				} else {
					row[col] = val
				}
			}
			data = append(data, row)
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    data,
	})
}

// handleTableStructure 获取或修改表结构
func handleTableStructure(w http.ResponseWriter, r *http.Request, config *DatabaseConfig, tableName string) {
	// 安全验证：检查表名是否合法，防止 SQL 注入
	if !isValidIdentifierWithSchema(tableName) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的表名",
		})
		return
	}

	// 只支持SQL数据库
	if config.Type == "mongodb" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "MongoDB暂不支持此功能",
		})
		return
	}

	// 根据HTTP方法分发
	if r.Method == http.MethodPut {
		handleTableStructureUpdate(w, r, config, tableName)
		return
	} else if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}

	// 使用连接池
	db, err := getDBFromPool(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接失败: " + err.Error(),
		})
		return
	}

	// 根据数据库类型查询表结构
	var query string
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb":
		query = fmt.Sprintf(`
			SELECT column_name, data_type, is_nullable, column_default
			FROM information_schema.columns
			WHERE table_name = '%s'
			ORDER BY ordinal_position
		`, tableName)
	case "mysql", "mariadb", "tidb":
		query = fmt.Sprintf("DESCRIBE `%s`", tableName)
	case "sqlite", "duckdb":
		query = fmt.Sprintf("PRAGMA table_info(`%s`)", tableName)
	case "sqlserver":
		query = fmt.Sprintf(`
			SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
			FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_NAME = '%s'
			ORDER BY ORDINAL_POSITION
		`, tableName)
	case "dm":
		query = fmt.Sprintf(`
			SELECT COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_DEFAULT
			FROM USER_TAB_COLUMNS
			WHERE TABLE_NAME = '%s'
			ORDER BY COLUMN_ID
		`, tableName)
	case "oracle":
		// Oracle DATA_DEFAULT 是 LONG 类型，go-ora 无法 Scan，只查 3 列
		// owner.table 时只用表名部分查 USER_TAB_COLUMNS（避免需要 ALL_TAB_COLUMNS 权限）
		if idx := strings.Index(tableName, "."); idx >= 0 {
			tblPart := oracleEscapeIdentifier(tableName[idx+1:])
			query = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", tblPart)
		} else {
			query = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", oracleEscapeIdentifier(tableName))
		}
	default:
		query = fmt.Sprintf("DESCRIBE `%s`", tableName)
	}

	rows, err := db.Query(query)
	// Oracle：查询失败时回退（不含 DATA_DEFAULT，避免 LONG 类型 Scan 问题）
	if err != nil && config.Type == "oracle" {
		tbl := tableName
		if idx := strings.Index(tbl, "."); idx >= 0 {
			tbl = tbl[idx+1:]
		}
		fallbackQuery := fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", oracleEscapeIdentifier(tbl))
		rows, err = db.Query(fallbackQuery)
	}
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询表结构失败: " + err.Error(),
		})
		return
	}
	defer rows.Close()

	columns := make([]map[string]interface{}, 0)
	for rows.Next() {
		var colName, colType string
		var nullable, extra interface{}

		// 根据不同数据库类型处理不同的返回格式
		switch config.Type {
		case "mysql", "mariadb", "tidb":
			// Field, Type, Null, Key, Default, Extra
			var key, defaultVal interface{}
			if err := rows.Scan(&colName, &colType, &nullable, &key, &defaultVal, &extra); err == nil {
				columns = append(columns, map[string]interface{}{
					"name":     colName,
					"type":     colType,
					"nullable": nullable != "NO",
				})
			}
		case "postgresql", "timescaledb", "cockroachdb", "sqlserver":
			var defaultVal interface{}
			if err := rows.Scan(&colName, &colType, &nullable, &defaultVal); err == nil {
				columns = append(columns, map[string]interface{}{
					"name":     colName,
					"type":     colType,
					"nullable": nullable != "NO",
				})
			}
		case "dm":
			// COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_DEFAULT
			var nullableStr string
			var defaultVal interface{}
			if err := rows.Scan(&colName, &colType, &nullableStr, &defaultVal); err == nil {
				columns = append(columns, map[string]interface{}{
					"name":     colName,
					"type":     colType,
					"nullable": nullableStr == "Y",
				})
			}
		case "oracle":
			// Oracle DATA_DEFAULT 是 LONG 类型无法 Scan，只扫 3 列
			var nullableStr string
			if err := rows.Scan(&colName, &colType, &nullableStr); err == nil {
				columns = append(columns, map[string]interface{}{
					"name":     colName,
					"type":     colType,
					"nullable": nullableStr == "Y",
				})
			}
		case "sqlite", "duckdb":
			// cid, name, type, notnull, dflt_value, pk
			var cid, notnull, pk int
			var dfltValue interface{}
			if err := rows.Scan(&cid, &colName, &colType, &notnull, &dfltValue, &pk); err == nil {
				columns = append(columns, map[string]interface{}{
					"name":     colName,
					"type":     colType,
					"nullable": notnull == 0,
				})
			}
		}
	}

	// Oracle：若初次查询返回 0 行，用 USER_TAB_COLUMNS 再试（不含 LONG 类型 DATA_DEFAULT）
	if config.Type == "oracle" && len(columns) == 0 {
		rows.Close()
		tbl := tableName
		if idx := strings.Index(tbl, "."); idx >= 0 {
			tbl = tbl[idx+1:]
		}
		fallbackQuery := fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", oracleEscapeIdentifier(tbl))
		rows2, err2 := db.Query(fallbackQuery)
		if err2 == nil {
			defer rows2.Close()
			for rows2.Next() {
				var colName, colType string
				var nullableStr string
				if err := rows2.Scan(&colName, &colType, &nullableStr); err == nil {
					columns = append(columns, map[string]interface{}{
						"name":     colName,
						"type":     colType,
						"nullable": nullableStr == "Y",
					})
				}
			}
		}
	}

	// 获取字段备注并添加到 columns 中
	colComments := getColumnComments(db, config, tableName)
	for i := range columns {
		if colName, ok := columns[i]["name"].(string); ok {
			if comment, exists := colComments[colName]; exists {
				columns[i]["comment"] = comment
			}
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"columns": columns,
	})
}

// TableStructureUpdateRequest 修改表结构请求
type TableStructureUpdateRequest struct {
	Columns []struct {
		Name     string `json:"name"`
		Type     string `json:"type"`
		Size     string `json:"size"`
		Nullable bool   `json:"nullable"`
	} `json:"columns"`
}

// handleTableStructureUpdate 修改表结构
func handleTableStructureUpdate(w http.ResponseWriter, r *http.Request, config *DatabaseConfig, tableName string) {
	// 解析请求
	var req TableStructureUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求格式错误: " + err.Error(),
		})
		return
	}

	if len(req.Columns) == 0 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "至少需要一个列",
		})
		return
	}

	// 使用连接池
	db, err := getDBFromPool(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接失败: " + err.Error(),
		})
		return
	}

	// 获取当前表结构
	var query string
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb":
		query = fmt.Sprintf(`
			SELECT column_name, data_type, is_nullable
			FROM information_schema.columns
			WHERE table_name = '%s'
			ORDER BY ordinal_position
		`, tableName)
	case "mysql", "mariadb", "tidb":
		query = fmt.Sprintf("DESCRIBE `%s`", tableName)
	case "sqlite", "duckdb":
		query = fmt.Sprintf("PRAGMA table_info(`%s`)", tableName)
	case "sqlserver":
		query = fmt.Sprintf(`
			SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
			FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_NAME = '%s'
			ORDER BY ORDINAL_POSITION
		`, tableName)
	case "dm", "oracle":
		if config.Type == "oracle" {
			query = oracleTableColumnsSQL(tableName, false)
		} else {
			query = fmt.Sprintf(`
			SELECT COLUMN_NAME, DATA_TYPE, NULLABLE
			FROM USER_TAB_COLUMNS
			WHERE TABLE_NAME = '%s'
			ORDER BY COLUMN_ID
		`, oracleEscapeIdentifier(tableName))
		}
	default:
		query = fmt.Sprintf("DESCRIBE `%s`", tableName)
	}

	rows, err := db.Query(query)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询表结构失败: " + err.Error(),
		})
		return
	}

	// 获取现有列
	existingColumns := make(map[string]bool)
	for rows.Next() {
		var colName string

		switch config.Type {
		case "mysql", "mariadb", "tidb":
			var colType, nullable interface{}
			var key, defaultVal, extra interface{}
			if err := rows.Scan(&colName, &colType, &nullable, &key, &defaultVal, &extra); err == nil {
				existingColumns[colName] = true
			}
		case "postgresql", "timescaledb", "cockroachdb", "sqlserver":
			var colType, nullable interface{}
			var defaultVal interface{}
			if err := rows.Scan(&colName, &colType, &nullable, &defaultVal); err == nil {
				existingColumns[colName] = true
			}
		case "dm", "oracle":
			var colType, nullable interface{}
			if err := rows.Scan(&colName, &colType, &nullable); err == nil {
				existingColumns[colName] = true
			}
		case "sqlite", "duckdb":
			var cid, notnull, pk int
			var colType string
			var dfltValue interface{}
			if err := rows.Scan(&cid, &colName, &colType, &notnull, &dfltValue, &pk); err == nil {
				existingColumns[colName] = true
			}
		}
	}
	rows.Close()

	// 达梦：查询自增列，修改表结构时不得 MODIFY 自增列（否则报 -2664）
	identityColumns := make(map[string]bool)
	if config.Type == "dm" {
		tblUpper := oracleEscapeIdentifier(tableName)
		identQuery := fmt.Sprintf(`
			SELECT a.NAME FROM SYS.SYSCOLUMNS a, SYS.SYSOBJECTS b
			WHERE b.ID = a.ID AND b.NAME = '%s' AND (a.INFO2 & 0x01) = 0x01
		`, tblUpper)
		identRows, err := db.Query(identQuery)
		if err == nil {
			for identRows.Next() {
				var colName string
				if err := identRows.Scan(&colName); err == nil {
					identityColumns[strings.ToUpper(colName)] = true
				}
			}
			identRows.Close()
		}
	}

	// SQLite需要重建表（不支持ALTER COLUMN）
	if config.Type == "sqlite" || config.Type == "duckdb" {
		err = rebuildTableForSQLite(db, tableName, req.Columns)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "修改表结构失败: " + err.Error(),
			})
			return
		}
	} else {
		// MySQL等数据库使用ALTER TABLE
		alterStatements := make([]string, 0)
		newColumns := make(map[string]bool)

		// 收集新列名
		for _, col := range req.Columns {
			newColumns[col.Name] = true
		}

		// 添加新列或修改现有列
		for _, col := range req.Columns {
			colDef := col.Type
			if col.Size != "" && (col.Type == "VARCHAR" || col.Type == "CHAR") {
				colDef = fmt.Sprintf("%s(%s)", col.Type, col.Size)
			}

			nullClause := ""
			if !col.Nullable {
				nullClause = " NOT NULL"
			}

			tblUpper := strings.ToUpper(tableName)
			colUpper := strings.ToUpper(col.Name)
			var alterSQL string
			if existingColumns[col.Name] {
				// 达梦不允许修改自增列，跳过
				if config.Type == "dm" && identityColumns[colUpper] {
					continue
				}
				// 修改现有列
				switch config.Type {
				case "postgresql", "timescaledb", "cockroachdb":
					alterSQL = fmt.Sprintf(`ALTER TABLE "%s" ALTER COLUMN "%s" TYPE %s`, tableName, col.Name, colDef)
					if !col.Nullable {
						alterSQL += fmt.Sprintf(`, ALTER COLUMN "%s" SET NOT NULL`, col.Name)
					} else {
						alterSQL += fmt.Sprintf(`, ALTER COLUMN "%s" DROP NOT NULL`, col.Name)
					}
				case "sqlserver":
					alterSQL = fmt.Sprintf("ALTER TABLE [%s] ALTER COLUMN [%s] %s%s", tableName, col.Name, colDef, nullClause)
				case "dm", "oracle":
					// 达梦语法：MODIFY 后直接跟列名，不加 COLUMN 关键字（避免 -2007 语法解析错误）
					alterSQL = fmt.Sprintf("ALTER TABLE %s MODIFY %s %s%s", tblUpper, colUpper, colDef, nullClause)
				default: // MySQL
					alterSQL = fmt.Sprintf("ALTER TABLE `%s` MODIFY COLUMN `%s` %s%s", tableName, col.Name, colDef, nullClause)
				}
			} else {
				// 添加新列
				switch config.Type {
				case "postgresql", "timescaledb", "cockroachdb":
					alterSQL = fmt.Sprintf(`ALTER TABLE "%s" ADD COLUMN "%s" %s%s`, tableName, col.Name, colDef, nullClause)
				case "sqlserver":
					alterSQL = fmt.Sprintf("ALTER TABLE [%s] ADD [%s] %s%s", tableName, col.Name, colDef, nullClause)
				case "dm", "oracle":
					alterSQL = fmt.Sprintf("ALTER TABLE %s ADD %s %s%s", tblUpper, colUpper, colDef, nullClause)
				default: // MySQL
					alterSQL = fmt.Sprintf("ALTER TABLE `%s` ADD COLUMN `%s` %s%s", tableName, col.Name, colDef, nullClause)
				}
			}
			alterStatements = append(alterStatements, alterSQL)
		}

		// 删除不存在的列
		for colName := range existingColumns {
			if !newColumns[colName] {
				var dropSQL string
				switch config.Type {
				case "postgresql", "timescaledb", "cockroachdb":
					dropSQL = fmt.Sprintf(`ALTER TABLE "%s" DROP COLUMN "%s"`, tableName, colName)
				case "sqlserver":
					dropSQL = fmt.Sprintf("ALTER TABLE [%s] DROP COLUMN [%s]", tableName, colName)
				case "dm", "oracle":
					dropSQL = fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", strings.ToUpper(tableName), strings.ToUpper(colName))
				default: // MySQL
					dropSQL = fmt.Sprintf("ALTER TABLE `%s` DROP COLUMN `%s`", tableName, colName)
				}
				alterStatements = append(alterStatements, dropSQL)
			}
		}

		// 执行所有ALTER语句
		for _, stmt := range alterStatements {
			log.Printf("执行: %s", stmt)
			if _, err := db.Exec(stmt); err != nil {
				json.NewEncoder(w).Encode(map[string]interface{}{
					"success": false,
					"message": "修改表结构失败: " + err.Error() + " (SQL: " + stmt + ")",
				})
				return
			}
		}
	}

	log.Printf("表 %s 结构修改成功", tableName)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "表结构修改成功",
	})
}

// rebuildTableForSQLite SQLite重建表以修改结构
func rebuildTableForSQLite(db *sql.DB, tableName string, columns []struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Size     string `json:"size"`
	Nullable bool   `json:"nullable"`
}) error {
	// 创建新表
	newTableName := tableName + "_new"
	columnDefs := make([]string, 0)

	for _, col := range columns {
		colDef := fmt.Sprintf("`%s` %s", col.Name, col.Type)
		if col.Size != "" && (col.Type == "VARCHAR" || col.Type == "CHAR" || col.Type == "TEXT") {
			colDef = fmt.Sprintf("`%s` %s(%s)", col.Name, col.Type, col.Size)
		}
		if !col.Nullable {
			colDef += " NOT NULL"
		}
		columnDefs = append(columnDefs, colDef)
	}

	createSQL := fmt.Sprintf("CREATE TABLE `%s` (\n    %s\n)", newTableName, strings.Join(columnDefs, ",\n    "))
	log.Printf("创建新表: %s", createSQL)
	if _, err := db.Exec(createSQL); err != nil {
		return fmt.Errorf("创建新表失败: %w", err)
	}

	// 复制数据（只复制存在的列）
	columnNames := make([]string, len(columns))
	for i, col := range columns {
		columnNames[i] = fmt.Sprintf("`%s`", col.Name)
	}
	copySQL := fmt.Sprintf("INSERT INTO `%s` (%s) SELECT %s FROM `%s`",
		newTableName, strings.Join(columnNames, ", "), strings.Join(columnNames, ", "), tableName)
	log.Printf("复制数据: %s", copySQL)
	if _, err := db.Exec(copySQL); err != nil {
		log.Printf("警告: 复制数据失败（可能是列不匹配）: %v", err)
		// 不返回错误，允许继续
	}

	// 删除旧表
	dropSQL := fmt.Sprintf("DROP TABLE `%s`", tableName)
	log.Printf("删除旧表: %s", dropSQL)
	if _, err := db.Exec(dropSQL); err != nil {
		return fmt.Errorf("删除旧表失败: %w", err)
	}

	// 重命名新表
	renameSQL := fmt.Sprintf("ALTER TABLE `%s` RENAME TO `%s`", newTableName, tableName)
	log.Printf("重命名表: %s", renameSQL)
	if _, err := db.Exec(renameSQL); err != nil {
		return fmt.Errorf("重命名表失败: %w", err)
	}

	return nil
}

// TableRenameRequest 重命名表请求
type TableRenameRequest struct {
	NewName string `json:"new_name"`
}

// handleTableRename 重命名表
func handleTableRename(w http.ResponseWriter, r *http.Request, config *DatabaseConfig, tableName string) {
	w.Header().Set("Content-Type", "application/json")
	if config.Type == "mongodb" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "MongoDB 暂不支持重命名表"})
		return
	}
	var req TableRenameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}
	newName := strings.TrimSpace(req.NewName)
	if newName == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "新表名不能为空"})
		return
	}
	// 安全验证：检查新表名是否合法
	if !isValidIdentifier(newName) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "无效的新表名"})
		return
	}
	if newName == tableName {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "新表名与当前表名相同"})
		return
	}
	// 使用连接池
	db, err := getDBFromPool(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "连接失败"})
		return
	}

	var renameSQL string
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb":
		renameSQL = fmt.Sprintf(`ALTER TABLE "%s" RENAME TO "%s"`, tableName, newName)
	case "sqlserver":
		renameSQL = fmt.Sprintf("EXEC sp_rename '%s', '%s'", tableName, newName)
	case "dm", "oracle":
		renameSQL = fmt.Sprintf("ALTER TABLE %s RENAME TO %s", strings.ToUpper(tableName), strings.ToUpper(newName))
	case "mysql", "mariadb", "tidb":
		renameSQL = fmt.Sprintf("ALTER TABLE `%s` RENAME TO `%s`", tableName, newName)
	case "sqlite", "duckdb":
		renameSQL = fmt.Sprintf("ALTER TABLE \"%s\" RENAME TO \"%s\"", tableName, newName)
	default:
		renameSQL = fmt.Sprintf("ALTER TABLE `%s` RENAME TO `%s`", tableName, newName)
	}
	if _, err := db.Exec(renameSQL); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "重命名失败: " + err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "表已重命名", "new_name": newName})
}

// handleTableDrop 删除表
func handleTableDrop(w http.ResponseWriter, r *http.Request, config *DatabaseConfig, tableName string) {
	// 只支持SQL数据库
	if config.Type == "mongodb" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "MongoDB暂不支持此功能",
		})
		return
	}

	// 使用连接池
	db, err := getDBFromPool(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接失败: " + err.Error(),
		})
		return
	}

	// 构建DROP TABLE语句
	var dropQuery string
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb":
		dropQuery = fmt.Sprintf(`DROP TABLE IF EXISTS "%s"`, tableName)
	case "oracle", "dm":
		dropQuery = fmt.Sprintf("DROP TABLE %s", tableName)
	case "sqlserver":
		dropQuery = fmt.Sprintf("DROP TABLE IF EXISTS [%s]", tableName)
	default:
		dropQuery = fmt.Sprintf("DROP TABLE IF EXISTS `%s`", tableName)
	}

	log.Printf("执行删除表: %s", dropQuery)
	_, err = db.Exec(dropQuery)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "删除表失败: " + err.Error(),
		})
		return
	}

	log.Printf("表 %s 删除成功", tableName)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "表删除成功",
	})
}

// TableCreateRequest 创建表请求
type TableCreateRequest struct {
	Name    string `json:"name"`
	Columns []struct {
		Name          string `json:"name"`
		Type          string `json:"type"`
		Size          string `json:"size"`
		NotNull       bool   `json:"not_null"`
		PrimaryKey    bool   `json:"primary_key"`
		AutoIncrement bool   `json:"auto_increment"`
	} `json:"columns"`
}

// handleTableCreate 创建表
func handleTableCreate(w http.ResponseWriter, r *http.Request, config *DatabaseConfig) {
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "只支持POST请求",
		})
		return
	}

	// 只支持SQL数据库
	if config.Type == "mongodb" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "MongoDB暂不支持此功能",
		})
		return
	}

	var req TableCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求格式错误: " + err.Error(),
		})
		return
	}

	if req.Name == "" || len(req.Columns) == 0 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "表名和字段不能为空",
		})
		return
	}

	// 安全验证：检查表名是否合法
	if !isValidIdentifier(req.Name) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的表名",
		})
		return
	}

	// 安全验证：检查列名是否合法
	for _, col := range req.Columns {
		if !isValidIdentifier(col.Name) {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "无效的列名: " + col.Name,
			})
			return
		}
	}

	// 使用连接池
	db, err := getDBFromPool(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接失败: " + err.Error(),
		})
		return
	}

	// 构建CREATE TABLE语句
	// 根据数据库类型选择标识符引用符
	var quoteChar string
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb", "dm":
		quoteChar = `"`
	case "sqlserver":
		quoteChar = "["
	case "oracle":
		quoteChar = "" // Oracle 不使用引用符或使用双引号
	default:
		quoteChar = "`"
	}

	quoteIdentifier := func(name string) string {
		// 安全验证：检查标识符是否合法
		if !isValidIdentifier(name) {
			log.Printf("警告：无效的标识符被拒绝: %s", name)
			return "INVALID_IDENTIFIER"
		}
		if quoteChar == "[" {
			return "[" + name + "]"
		} else if quoteChar == "" {
			return name
		}
		return quoteChar + name + quoteChar
	}

	columnDefs := make([]string, 0)
	primaryKeys := make([]string, 0)

	for _, col := range req.Columns {
		colDef := fmt.Sprintf("%s %s", quoteIdentifier(col.Name), col.Type)

		// 添加长度
		if col.Size != "" && (col.Type == "VARCHAR" || col.Type == "CHAR") {
			colDef = fmt.Sprintf("%s %s(%s)", quoteIdentifier(col.Name), col.Type, col.Size)
		}

		// 添加NOT NULL
		if col.NotNull {
			colDef += " NOT NULL"
		}

		// 添加AUTO_INCREMENT
		if col.AutoIncrement {
			switch config.Type {
			case "postgresql", "timescaledb", "cockroachdb":
				colDef = fmt.Sprintf(`"%s" SERIAL`, col.Name)
			case "sqlserver":
				colDef = fmt.Sprintf("[%s] %s IDENTITY(1,1)", col.Name, col.Type)
			case "dm":
				colDef = fmt.Sprintf(`"%s" %s IDENTITY(1,1)`, col.Name, col.Type)
			case "oracle":
				// Oracle 使用序列，这里简化处理
				colDef = fmt.Sprintf("%s %s GENERATED ALWAYS AS IDENTITY", col.Name, col.Type)
			default:
				colDef += " AUTO_INCREMENT"
			}
		}

		columnDefs = append(columnDefs, colDef)

		// 收集主键
		if col.PrimaryKey {
			primaryKeys = append(primaryKeys, quoteIdentifier(col.Name))
		}
	}

	// 添加主键约束
	if len(primaryKeys) > 0 {
		columnDefs = append(columnDefs, fmt.Sprintf("PRIMARY KEY (%s)", strings.Join(primaryKeys, ", ")))
	}

	createQuery := fmt.Sprintf("CREATE TABLE %s (\n    %s\n)",
		quoteIdentifier(req.Name), strings.Join(columnDefs, ",\n    "))

	log.Printf("执行创建表: %s", createQuery)
	_, err = db.Exec(createQuery)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "创建表失败: " + err.Error(),
		})
		return
	}

	log.Printf("表 %s 创建成功", req.Name)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "表创建成功",
	})
}

// ==================== 接口管理功能 ====================

// handleApis 处理接口列表的GET和POST请求
func handleApis(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	switch r.Method {
	case http.MethodGet:
		// 获取接口列表
		dataOntologyMu.RLock()
		defer dataOntologyMu.RUnlock()

		apiList := make([]*ApiInfo, 0, len(dataOntologyApis))
		for _, api := range dataOntologyApis {
			enabled := api.Enabled == nil || *api.Enabled
			apiType := api.Type
			if apiType == "" {
				apiType = "query"
			}
			apiInfo := &ApiInfo{
				ID:         api.ID,
				Name:       api.Name,
				Path:       api.Path,
				Method:     api.Method,
				Type:       apiType,
				DatabaseID: api.DatabaseID,
				ForwardURL: api.ForwardURL,
				Enabled:    enabled,
			}
			if db, exists := dataOntologyDatabases[api.DatabaseID]; exists {
				apiInfo.DatabaseName = db.Name
			}
			apiList = append(apiList, apiInfo)
		}

		jsonSuccess(w, map[string]interface{}{"apis": apiList})

	case http.MethodPost:
		// 添加新接口
		var apiConfig ApiConfig
		if err := json.NewDecoder(r.Body).Decode(&apiConfig); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}

		// 标准化接口类型
		if apiConfig.Type == "" {
			apiConfig.Type = "query"
		}

		// 标准化 path 和 method
		apiConfig.Path = strings.ToLower(strings.TrimSpace(apiConfig.Path))
		apiConfig.Method = strings.ToUpper(strings.TrimSpace(apiConfig.Method))

		// 验证必填字段
		if apiConfig.Name == "" || apiConfig.Path == "" || apiConfig.Method == "" {
			apiInvalidInput(w, "缺少必填字段")
			return
		}

		// 验证路径格式：必须是 /api/xxx/yyy（两级路径）
		if !isValidApiPath(apiConfig.Path) {
			apiInvalidInput(w, "接口路径格式错误，必须是 /api/xxx/yyy 格式（两级路径）")
			return
		}

		// 验证 path+method 唯一性
		dataOntologyMu.RLock()
		for _, existingApi := range dataOntologyApis {
			if existingApi.Path == apiConfig.Path && strings.EqualFold(existingApi.Method, apiConfig.Method) {
				dataOntologyMu.RUnlock()
				apiInvalidInput(w, fmt.Sprintf("接口路径 %s (%s) 已存在", apiConfig.Path, apiConfig.Method))
				return
			}
		}
		dataOntologyMu.RUnlock()

		if apiConfig.Type == "forward" {
			if apiConfig.ForwardURL == "" {
				apiInvalidInput(w, "转发类型接口必须填写转发URL")
				return
			}
		} else {
			if apiConfig.DatabaseID == "" || apiConfig.SQL == "" {
				apiInvalidInput(w, "缺少必填字段")
				return
			}
			// 验证数据库是否存在
			dataOntologyMu.RLock()
			_, dbExists := dataOntologyDatabases[apiConfig.DatabaseID]
			dataOntologyMu.RUnlock()
			if !dbExists {
				apiNotFound(w, "数据库不存在")
				return
			}
		}

		// 生成ID
		apiConfig.ID = uuid.New().String()

		// 保存接口配置
		dataOntologyMu.Lock()
		dataOntologyApis[apiConfig.ID] = &apiConfig
		dataOntologyMu.Unlock()

		// 持久化
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存接口配置失败: %v", err)
		}

		jsonSuccess(w, map[string]interface{}{"api": apiConfig})

	default:
		apiMethodNotAllowed(w, "不支持的请求方法")
	}
}

// handleApiDetail 处理单个接口的GET、PUT、DELETE请求
func handleApiDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	// 提取接口ID
	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/data-ontology/apis/"), "/")
	if len(pathParts) == 0 || pathParts[0] == "" {
		apiBadRequest(w, "缺少接口ID")
		return
	}
	apiID := pathParts[0]

	switch r.Method {
	case http.MethodGet:
		// 获取接口详情
		dataOntologyMu.RLock()
		api, exists := dataOntologyApis[apiID]
		if !exists {
			dataOntologyMu.RUnlock()
			apiNotFound(w, "接口不存在")
			return
		}

		apiType := api.Type
		if apiType == "" {
			apiType = "query"
		}
		apiInfo := &ApiInfo{
			ID:            api.ID,
			Name:          api.Name,
			Path:          api.Path,
			Method:        api.Method,
			Type:          apiType,
			DatabaseID:    api.DatabaseID,
			SQL:           api.SQL,
			ForwardURL:    api.ForwardURL,
			Description:   api.Description,
			DefaultParams: api.DefaultParams,
			Enabled:       api.Enabled == nil || *api.Enabled,
		}
		if db, dbExists := dataOntologyDatabases[api.DatabaseID]; dbExists {
			apiInfo.DatabaseName = db.Name
		}
		dataOntologyMu.RUnlock()

		jsonSuccess(w, map[string]interface{}{"api": apiInfo})

	case http.MethodPut:
		// 更新接口
		var apiUpdate ApiConfig
		if err := json.NewDecoder(r.Body).Decode(&apiUpdate); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}

		dataOntologyMu.Lock()
		api, exists := dataOntologyApis[apiID]
		if !exists {
			dataOntologyMu.Unlock()
			apiNotFound(w, "接口不存在")
			return
		}

		// 标准化接口类型
		updateType := apiUpdate.Type
		if updateType == "" {
			updateType = api.Type
		}
		if updateType == "" {
			updateType = "query"
		}

		// query类型才需要验证数据库
		if updateType == "query" && apiUpdate.DatabaseID != "" {
			if _, dbExists := dataOntologyDatabases[apiUpdate.DatabaseID]; !dbExists {
				dataOntologyMu.Unlock()
				apiNotFound(w, "数据库不存在")
				return
			}
		}

		// 更新字段
		newPath := api.Path
		newMethod := api.Method
		if apiUpdate.Path != "" {
			// 标准化路径
			normalizedPath := strings.ToLower(strings.TrimSpace(apiUpdate.Path))
			// 验证路径格式
			if !isValidApiPath(normalizedPath) {
				dataOntologyMu.Unlock()
				apiInvalidInput(w, "接口路径格式错误，必须是 /api/xxx/yyy 格式（两级路径）")
				return
			}
			newPath = normalizedPath
			api.Path = normalizedPath
		}
		if apiUpdate.Method != "" {
			// 标准化方法
			normalizedMethod := strings.ToUpper(strings.TrimSpace(apiUpdate.Method))
			newMethod = normalizedMethod
			api.Method = normalizedMethod
		}
		// 验证新的 path+method 唯一性（排除自身）
		for _, existingApi := range dataOntologyApis {
			if existingApi.ID != apiID && existingApi.Path == newPath && strings.EqualFold(existingApi.Method, newMethod) {
				dataOntologyMu.Unlock()
				apiInvalidInput(w, fmt.Sprintf("接口路径 %s (%s) 已存在", newPath, newMethod))
				return
			}
		}
		if apiUpdate.Name != "" {
			api.Name = apiUpdate.Name
		}
		api.Type = updateType
		if updateType == "query" {
			if apiUpdate.DatabaseID != "" {
				api.DatabaseID = apiUpdate.DatabaseID
			}
			if apiUpdate.SQL != "" {
				api.SQL = apiUpdate.SQL
			}
			api.ForwardURL = ""
		} else {
			api.ForwardURL = apiUpdate.ForwardURL
			api.DatabaseID = ""
			api.SQL = ""
		}
		api.Description = apiUpdate.Description
		api.DefaultParams = apiUpdate.DefaultParams
		if apiUpdate.Enabled != nil {
			api.Enabled = apiUpdate.Enabled
		}
		dataOntologyMu.Unlock()

		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存接口配置失败: %v", err)
		}
		jsonSuccess(w, map[string]interface{}{"api": api})

	case http.MethodDelete:
		// 删除接口
		dataOntologyMu.Lock()
		if _, exists := dataOntologyApis[apiID]; !exists {
			dataOntologyMu.Unlock()
			apiNotFound(w, "接口不存在")
			return
		}

		delete(dataOntologyApis, apiID)
		dataOntologyMu.Unlock()

		// 持久化
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存接口配置失败: %v", err)
		}

		jsonSuccess(w, nil)

	default:
		apiMethodNotAllowed(w, "不支持的请求方法")
	}
}

// handleApiDispatch 处理用户定义路径的外部API调用
func handleApiDispatch(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqPath := r.URL.Path
		reqMethod := r.Method

		if reqMethod == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}

		// 先检查是否有匹配的数据治理任务 API
		dataOntologyMu.RLock()
		var matchedTask *GovernanceTask
		for _, task := range governanceTasks {
			if task.RegisterAsAPI && task.APIPath == reqPath && strings.EqualFold(task.APIMethod, reqMethod) {
				matchedTask = task
				break
			}
		}
		dataOntologyMu.RUnlock()

		if matchedTask != nil {
			// 找到匹配的任务，执行任务
			if !matchedTask.Enabled {
				apiForbidden(w, "该任务已禁用")
				return
			}

			if !verifyToken(r) {
				apiUnauthorized(w, "未授权，请提供有效的 API Key 或 Token")
				return
			}

			// 解析请求参数
			params := make(map[string]interface{})
			isBodyMethod := reqMethod == http.MethodPost || reqMethod == http.MethodPut || reqMethod == http.MethodPatch
			if isBodyMethod && r.Body != nil {
				json.NewDecoder(r.Body).Decode(&params)
			}
			for k, v := range r.URL.Query() {
				if _, exists := params[k]; !exists {
					if len(v) == 1 {
						params[k] = v[0]
					} else {
						params[k] = v
					}
				}
			}

			// 执行任务
			result, err := executeGovernanceTaskForAPI(matchedTask, params)
			w.Header().Set("Content-Type", "application/json")
			if err != nil {
				log.Printf("[API] 任务执行失败: task=%s, err=%v", matchedTask.Name, err)
				jsonError(w, "任务执行失败: "+err.Error(), "")
				return
			}
			log.Printf("[API] 任务执行成功: task=%s, path=%s", matchedTask.Name, reqPath)
			jsonSuccess(w, map[string]interface{}{"success": true, "data": result})
			return
		}

		dataOntologyMu.RLock()
		var matchedApi *ApiConfig
		var matchedDb *DatabaseConfig
		for _, api := range dataOntologyApis {
			if api.Path == reqPath && strings.EqualFold(api.Method, reqMethod) {
				matchedApi = api
				apiType := api.Type
				if apiType == "" {
					apiType = "query"
				}
				if apiType == "query" {
					if db, ok := dataOntologyDatabases[api.DatabaseID]; ok {
						matchedDb = db
					}
				}
				break
			}
		}
		dataOntologyMu.RUnlock()

		if matchedApi == nil {
			next.ServeHTTP(w, r)
			return
		}

		apiType := matchedApi.Type
		if apiType == "" {
			apiType = "query"
		}

		// query类型需要数据库
		if apiType == "query" && matchedDb == nil {
			next.ServeHTTP(w, r)
			return
		}

		if matchedApi.Enabled != nil && !*matchedApi.Enabled {
			apiForbidden(w, "该接口已关闭")
			return
		}

		if !verifyToken(r) {
			apiUnauthorized(w, "未授权，请提供有效的 API Key 或 Token")
			return
		}

		if apiType == "forward" {
			executeForwardRequest(w, r, matchedApi.ForwardURL)
			return
		}

		// query类型：执行SQL查询
		w.Header().Set("Content-Type", "application/json")

		// 先用默认参数初始化
		params := make(map[string]interface{})
		if matchedApi.DefaultParams != nil {
			log.Printf("[API] 使用默认参数: api=%s, default_params=%v", matchedApi.Name, matchedApi.DefaultParams)
			for k, v := range matchedApi.DefaultParams {
				params[k] = v
			}
		} else {
			log.Printf("[API] 无默认参数: api=%s", matchedApi.Name)
		}
		// 再合并请求参数（覆盖默认值）
		isBodyMethod := reqMethod == http.MethodPost || reqMethod == http.MethodPut || reqMethod == http.MethodPatch
		if isBodyMethod && r.Body != nil {
			json.NewDecoder(r.Body).Decode(&params)
		}
		for k, v := range r.URL.Query() {
			// 请求参数覆盖默认值
			if len(v) == 1 {
				params[k] = v[0]
			} else {
				params[k] = v
			}
		}

		finalSQL, args, err := parseMyBatisSQL(matchedApi.SQL, params)
		if err != nil {
			log.Printf("[API] SQL解析失败: api=%s, err=%v", matchedApi.Name, err)
			jsonError(w, "SQL解析失败: "+err.Error(), "")
			return
		}

		result, err := executeSQLQuery(matchedDb, finalSQL, args)
		if err != nil {
			log.Printf("[API] 查询失败: api=%s, db=%s, err=%v", matchedApi.Name, matchedDb.Name, err)
			jsonError(w, "查询失败: "+err.Error(), "")
			return
		}

		log.Printf("[API] 查询成功: api=%s, path=%s", matchedApi.Name, reqPath)
		jsonSuccess(w, map[string]interface{}{"success": true, "data": result})
	})
}

// executeForwardRequest 将请求原样转发到目标URL并回写响应
func executeForwardRequest(w http.ResponseWriter, r *http.Request, targetURL string) {
	var bodyBytes []byte
	if r.Body != nil {
		var err error
		bodyBytes, err = io.ReadAll(r.Body)
		if err != nil {
			apiBadRequest(w, "读取请求体失败")
			return
		}
	}

	proxyReq, err := http.NewRequest(r.Method, targetURL, bytes.NewReader(bodyBytes))
	if err != nil {
		log.Printf("[API] 构建转发请求失败: target=%s, err=%v", targetURL, err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		jsonError(w, "构建转发请求失败: "+err.Error(), "")
		return
	}

	// 透传 query string
	proxyReq.URL.RawQuery = r.URL.RawQuery

	// 透传请求头（排除 Authorization，避免将内部 Token 泄露给目标服务）
	for key, vals := range r.Header {
		if strings.EqualFold(key, "Authorization") {
			continue
		}
		for _, v := range vals {
			proxyReq.Header.Add(key, v)
		}
	}

	client := &http.Client{Timeout: HTTPClientTimeout}
	resp, err := client.Do(proxyReq)
	if err != nil {
		log.Printf("[API] 转发请求失败: target=%s, err=%v", targetURL, err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		jsonError(w, "转发请求失败: "+err.Error(), "")
		return
	}
	defer resp.Body.Close()

	// 回写响应头和状态码
	for key, vals := range resp.Header {
		for _, v := range vals {
			w.Header().Add(key, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// handleApiTest 处理接口测试请求
func handleApiTest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method != http.MethodPost {
		apiMethodNotAllowed(w, "只支持POST请求")
		return
	}

	// 提取接口ID
	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/data-ontology/apis/"), "/")
	if len(pathParts) < 2 || pathParts[0] == "" {
		apiBadRequest(w, "缺少接口ID")
		return
	}
	apiID := pathParts[0]

	// 解析测试参数
	var testReq struct {
		Params map[string]interface{} `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&testReq); err != nil {
		apiBadRequest(w, "请求格式错误")
		return
	}

	// 获取接口配置
	dataOntologyMu.RLock()
	api, exists := dataOntologyApis[apiID]
	if !exists {
		dataOntologyMu.RUnlock()
		apiNotFound(w, "接口不存在")
		return
	}
	if api.Enabled != nil && !*api.Enabled {
		dataOntologyMu.RUnlock()
		apiBadRequest(w, "该接口已关闭")
		return
	}
	apiType := api.Type
	if apiType == "" {
		apiType = "query"
	}

	if apiType == "forward" {
		forwardURL := api.ForwardURL
		apiMethod := api.Method
		dataOntologyMu.RUnlock()

		// 构建转发URL，将测试参数作为 query string 或 body 传递
		targetURL := forwardURL
		if apiMethod == http.MethodGet || apiMethod == http.MethodDelete {
			// GET/DELETE 将参数拼到 query string
			if len(testReq.Params) > 0 {
				q := url.Values{}
				for k, v := range testReq.Params {
					q.Set(k, fmt.Sprintf("%v", v))
				}
				if strings.Contains(targetURL, "?") {
					targetURL += "&" + q.Encode()
				} else {
					targetURL += "?" + q.Encode()
				}
			}
			proxyReq, err := http.NewRequest(apiMethod, targetURL, nil)
			if err != nil {
				apiInternalError(w, "构建转发请求失败: "+err.Error())
				return
			}
			client := &http.Client{Timeout: HTTPClientTimeout}
			resp, err := client.Do(proxyReq)
			if err != nil {
				apiInternalError(w, "转发请求失败: "+err.Error())
				return
			}
			defer resp.Body.Close()
			respBody, _ := io.ReadAll(resp.Body)
			var respData interface{}
			if err := json.Unmarshal(respBody, &respData); err != nil {
				respData = string(respBody)
			}
			jsonSuccess(w, map[string]interface{}{"status_code": resp.StatusCode, "data": respData})
		} else {
			// POST/PUT/PATCH 将参数作为 JSON body 传递
			bodyBytes, _ := json.Marshal(testReq.Params)
			proxyReq, err := http.NewRequest(apiMethod, targetURL, bytes.NewReader(bodyBytes))
			if err != nil {
				apiInternalError(w, "构建转发请求失败: "+err.Error())
				return
			}
			proxyReq.Header.Set("Content-Type", "application/json")
			client := &http.Client{Timeout: HTTPClientTimeout}
			resp, err := client.Do(proxyReq)
			if err != nil {
				apiInternalError(w, "转发请求失败: "+err.Error())
				return
			}
			defer resp.Body.Close()
			respBody, _ := io.ReadAll(resp.Body)
			var respData interface{}
			if err := json.Unmarshal(respBody, &respData); err != nil {
				respData = string(respBody)
			}
			jsonSuccess(w, map[string]interface{}{"status_code": resp.StatusCode, "data": respData})
		}
		return
	}

	// query类型：获取数据库配置
	dbConfig, dbExists := dataOntologyDatabases[api.DatabaseID]
	if !dbExists {
		dataOntologyMu.RUnlock()
		apiNotFound(w, "数据库不存在")
		return
	}
	dataOntologyMu.RUnlock()

	// 解析MyBatis风格的SQL并替换参数
	finalSQL, args, err := parseMyBatisSQL(api.SQL, testReq.Params)
	if err != nil {
		apiBadRequest(w, "SQL解析失败: "+err.Error())
		return
	}

	// 执行SQL查询
	result, err := executeSQLQuery(dbConfig, finalSQL, args)
	if err != nil {
		apiInternalError(w, "查询失败: "+err.Error())
		return
	}

	jsonSuccess(w, map[string]interface{}{"data": result})
}

// parseMyBatisSQL 解析MyBatis风格的SQL语句
// 支持 #{param} 预编译参数和 ${param} 直接替换
func parseMyBatisSQL(sqlTemplate string, params map[string]interface{}) (string, []interface{}, error) {
	var args []interface{}
	finalSQL := sqlTemplate
	var missingParams []string

	// 首先处理 ${param} - 直接替换
	dollarPattern := `\$\{([^}]+)\}`
	finalSQL = replaceWithRegex(finalSQL, dollarPattern, func(match string) string {
		paramName := strings.TrimSpace(match[2 : len(match)-1])
		// 支持参数名:默认值格式
		defaultValue := ""
		if colonIdx := strings.Index(paramName, ":"); colonIdx != -1 {
			defaultValue = strings.TrimSpace(paramName[colonIdx+1:])
			paramName = strings.TrimSpace(paramName[:colonIdx])
		}
		if val, exists := params[paramName]; exists {
			return fmt.Sprintf("%v", val)
		}
		// 如果参数不存在但有默认值，使用默认值
		if defaultValue != "" {
			return defaultValue
		}
		missingParams = append(missingParams, paramName)
		return match
	})

	// 然后处理 #{param} - 预编译参数
	hashPattern := `#\{([^}]+)\}`
	finalSQL = replaceWithRegex(finalSQL, hashPattern, func(match string) string {
		paramName := strings.TrimSpace(match[2 : len(match)-1])
		// 支持参数名:默认值格式
		defaultValue := ""
		if colonIdx := strings.Index(paramName, ":"); colonIdx != -1 {
			defaultValue = strings.TrimSpace(paramName[colonIdx+1:])
			paramName = strings.TrimSpace(paramName[:colonIdx])
		}
		if val, exists := params[paramName]; exists {
			args = append(args, val)
			return "?"
		}
		// 如果参数不存在但有默认值，使用默认值
		if defaultValue != "" {
			args = append(args, defaultValue)
			return "?"
		}
		missingParams = append(missingParams, paramName)
		return match
	})

	// 检查是否有缺失的参数
	if len(missingParams) > 0 {
		return "", nil, fmt.Errorf("缺少必需的参数: %s", strings.Join(missingParams, ", "))
	}

	return finalSQL, args, nil
}

// replaceWithRegex 使用正则表达式替换字符串
func replaceWithRegex(input, pattern string, replacer func(string) string) string {
	result := input
	start := 0
	for {
		// 查找下一个匹配
		idx := -1
		matchLen := 0

		if strings.Contains(pattern, `\$\{`) {
			// 查找 ${...}
			idx = strings.Index(result[start:], "${")
			if idx >= 0 {
				idx += start
				end := strings.Index(result[idx:], "}")
				if end >= 0 {
					matchLen = end + 1
				}
			}
		} else if strings.Contains(pattern, `#\{`) {
			// 查找 #{...}
			idx = strings.Index(result[start:], "#{")
			if idx >= 0 {
				idx += start
				end := strings.Index(result[idx:], "}")
				if end >= 0 {
					matchLen = end + 1
				}
			}
		}

		if idx < 0 || matchLen == 0 {
			break
		}

		match := result[idx : idx+matchLen]
		replacement := replacer(match)
		result = result[:idx] + replacement + result[idx+matchLen:]
		start = idx + len(replacement)
	}
	return result
}

// isWriteOperation 检测SQL是否为写操作（INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/TRUNCATE等）
func isWriteOperation(sql string) bool {
	trimmed := strings.TrimSpace(strings.ToUpper(sql))
	writeKeywords := []string{"INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "TRUNCATE", "REPLACE", "MERGE", "GRANT", "REVOKE", "RENAME"}
	for _, kw := range writeKeywords {
		if strings.HasPrefix(trimmed, kw) {
			return true
		}
	}
	return false
}

// executeSQLQuery 执行SQL查询并返回结果
func executeSQLQuery(dbConfig *DatabaseConfig, sqlQuery string, args []interface{}) ([]map[string]interface{}, error) {
	// MongoDB 特殊处理
	if dbConfig.Type == "mongodb" {
		return nil, fmt.Errorf("MongoDB 暂不支持SQL查询")
	}

	// 其他NoSQL数据库
	if dbConfig.Type == "elasticsearch" || dbConfig.Type == "redis" ||
		dbConfig.Type == "memcached" || dbConfig.Type == "neo4j" ||
		dbConfig.Type == "cassandra" || dbConfig.Type == "hbase" {
		return nil, fmt.Errorf("%s 暂不支持SQL查询", dbConfig.Type)
	}

	// SQL数据库 - 使用连接池
	db, err := getDBFromPool(dbConfig)
	if err != nil {
		return nil, err
	}

	// 写操作使用 Exec
	if isWriteOperation(sqlQuery) {
		result, err := db.Exec(sqlQuery, args...)
		if err != nil {
			return nil, err
		}
		affected, _ := result.RowsAffected()
		return []map[string]interface{}{
			{"affected_rows": affected},
		}, nil
	}

	// 读操作使用 Query
	rows, err := db.Query(sqlQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	var results []map[string]interface{}
	for rows.Next() {
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range values {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, err
		}

		row := make(map[string]interface{})
		for i, col := range columns {
			val := values[i]
			if b, ok := val.([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = val
			}
		}
		results = append(results, row)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return results, nil
}

// ==================== AI助手功能 ====================

// sendSSE 发送Server-Sent Events消息
func sendSSE(w http.ResponseWriter, eventType string, data interface{}) {
	jsonData, _ := json.Marshal(data)
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventType, jsonData)
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
}

// handleAIConfig 处理AI配置
func handleAIConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method == http.MethodGet {
		// 获取AI配置
		dataOntologyMu.RLock()
		config := dataOntologyAIConfig
		dataOntologyMu.RUnlock()

		jsonSuccess(w, map[string]interface{}{
			"config": config,
		})
		return
	}

	if r.Method == http.MethodPost {
		// 保存AI配置
		var config AIConfig
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}

		// 验证配置
		if config.URL == "" || config.APIKey == "" || config.Model == "" {
			apiInvalidInput(w, "请填写完整的配置信息")
			return
		}

		// 保留已有的 embedding 和 table_retrieval 配置（前端可能未传）
		dataOntologyMu.RLock()
		if dataOntologyAIConfig != nil {
			if config.Embedding.URL == "" && dataOntologyAIConfig.Embedding.URL != "" {
				config.Embedding = dataOntologyAIConfig.Embedding
			}
			if config.TableRetrieval == nil && dataOntologyAIConfig.TableRetrieval != nil {
				config.TableRetrieval = dataOntologyAIConfig.TableRetrieval
			}
		}
		dataOntologyMu.RUnlock()

		// 检测AI模型能力
		capabilities, err := detectAICapabilities(&config)
		if err != nil {
			log.Printf("检测AI能力失败: %v", err)
			// 继续保存配置，使用默认能力
		}

		// 保存配置和能力
		dataOntologyMu.Lock()
		dataOntologyAIConfig = &config
		dataOntologyAICapabilities = capabilities
		dataOntologyMu.Unlock()

		// 持久化
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存AI配置失败: %v", err)
			apiInternalError(w, "保存失败")
			return
		}

		jsonSuccess(w, map[string]interface{}{
			"message":      "配置保存成功",
			"capabilities": capabilities,
		})
		return
	}

	apiMethodNotAllowed(w, "不支持的请求方法")
}

// handleAICapabilities 获取AI模型能力
// handleAIEmbeddingConfig 处理 Embedding 配置的读写
func handleAIEmbeddingConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method == http.MethodGet {
		// 获取 Embedding 配置
		dataOntologyMu.RLock()
		var embConfig EmbeddingRetrievalConfig
		if dataOntologyAIConfig != nil {
			embConfig = dataOntologyAIConfig.Embedding
		}
		dataOntologyMu.RUnlock()

		jsonSuccess(w, map[string]interface{}{
			"config": embConfig,
		})
		return
	}

	if r.Method == http.MethodPost {
		// 保存 Embedding 配置
		var embConfig EmbeddingRetrievalConfig
		if err := json.NewDecoder(r.Body).Decode(&embConfig); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}

		dataOntologyMu.Lock()
		if dataOntologyAIConfig == nil {
			dataOntologyAIConfig = &AIConfig{}
		}
		dataOntologyAIConfig.Embedding = embConfig
		dataOntologyMu.Unlock()

		// 持久化
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存 Embedding 配置失败: %v", err)
			apiInternalError(w, "保存失败")
			return
		}

		log.Printf("[表检索] Embedding 配置已更新: enabled=%v, model=%s, dimension=%d", embConfig.Enabled, embConfig.Model, embConfig.Dimension)
		jsonSuccess(w, map[string]interface{}{
			"message": "Embedding 配置保存成功",
			"config":  embConfig,
		})
		return
	}

	apiMethodNotAllowed(w, "不支持的请求方法")
}

// handleTableRetrievalConfig 处理表检索配置的读写
func handleTableRetrievalConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method == http.MethodGet {
		// 获取表检索配置
		dataOntologyMu.RLock()
		var trConfig *TableRetrievalConfig
		if dataOntologyAIConfig != nil {
			trConfig = dataOntologyAIConfig.TableRetrieval
		}
		dataOntologyMu.RUnlock()

		jsonSuccess(w, map[string]interface{}{
			"config": trConfig,
		})
		return
	}

	if r.Method == http.MethodPost {
		// 保存表检索配置
		var trConfig TableRetrievalConfig
		if err := json.NewDecoder(r.Body).Decode(&trConfig); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}

		dataOntologyMu.Lock()
		if dataOntologyAIConfig == nil {
			dataOntologyAIConfig = &AIConfig{}
		}
		dataOntologyAIConfig.TableRetrieval = &trConfig
		dataOntologyMu.Unlock()

		// 持久化
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存表检索配置失败: %v", err)
			apiInternalError(w, "保存失败")
			return
		}

		log.Printf("[表检索] 表检索配置已更新: strategy=%s, keyword_weight=%.2f, vector_weight=%.2f, graph_weight=%.2f",
			trConfig.Strategy, trConfig.KeywordWeight, trConfig.VectorWeight, trConfig.GraphWeight)
		jsonSuccess(w, map[string]interface{}{
			"message": "表检索配置保存成功",
			"config":  trConfig,
		})
		return
	}

	apiMethodNotAllowed(w, "不支持的请求方法")
}

func handleAICapabilities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method != http.MethodGet {
		apiMethodNotAllowed(w, "只支持GET请求")
		return
	}

	dataOntologyMu.RLock()
	capabilities := dataOntologyAICapabilities
	config := dataOntologyAIConfig
	dataOntologyMu.RUnlock()

	// 如果能力未检测或配置已更新，重新检测
	if capabilities == nil && config != nil {
		var err error
		capabilities, err = detectAICapabilities(config)
		if err != nil {
			log.Printf("检测AI能力失败: %v", err)
			apiInternalError(w, "检测AI能力失败")
			return
		}

		// 保存检测结果
		dataOntologyMu.Lock()
		dataOntologyAICapabilities = capabilities
		dataOntologyMu.Unlock()
	}

	jsonSuccess(w, map[string]interface{}{
		"capabilities": capabilities,
	})
}

// ========== 大模型管理 API ==========

// handleLLMModels 处理大模型列表和创建
func handleLLMModels(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		list := make([]*LLMModelConfig, 0, len(llmModels))
		for _, m := range llmModels {
			list = append(list, m)
		}
		dataOntologyMu.RUnlock()
		jsonSuccess(w, map[string]interface{}{"models": list})

	case http.MethodPost:
		var model LLMModelConfig
		if err := json.NewDecoder(r.Body).Decode(&model); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		if model.Name == "" || model.Type == "" || model.URL == "" {
			apiInvalidInput(w, "名称、类型和URL不能为空")
			return
		}
		model.ID = uuid.New().String()
		model.CreatedAt = time.Now().Format(time.RFC3339)
		dataOntologyMu.Lock()
		llmModels[model.ID] = &model
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		jsonSuccess(w, map[string]interface{}{"model": model})

	default:
		apiMethodNotAllowed(w, "不支持的方法")
	}
}

// handleLLMModelDetail 处理单个大模型的 GET/PUT/DELETE
func handleLLMModelDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/data-ontology/models/llm/"), "/")
	if len(pathParts) == 0 || pathParts[0] == "" {
		apiBadRequest(w, "缺少模型ID")
		return
	}
	modelID := pathParts[0]

	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		model, exists := llmModels[modelID]
		dataOntologyMu.RUnlock()
		if !exists {
			apiNotFound(w, "模型不存在")
			return
		}
		jsonSuccess(w, map[string]interface{}{"model": model})

	case http.MethodPut:
		var update LLMModelConfig
		if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		dataOntologyMu.Lock()
		model, exists := llmModels[modelID]
		if !exists {
			dataOntologyMu.Unlock()
			apiNotFound(w, "模型不存在")
			return
		}
		if update.Name != "" {
			model.Name = update.Name
		}
		if update.Type != "" {
			model.Type = update.Type
		}
		if update.Provider != "" {
			model.Provider = update.Provider
		}
		if update.URL != "" {
			model.URL = update.URL
		}
		model.APIKey = update.APIKey
		if update.Model != "" {
			model.Model = update.Model
		}
		model.Description = update.Description
		model.Enabled = update.Enabled
		model.UpdatedAt = time.Now().Format(time.RFC3339)
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		jsonSuccess(w, map[string]interface{}{"model": model})

	case http.MethodDelete:
		dataOntologyMu.Lock()
		delete(llmModels, modelID)
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		jsonSuccess(w, map[string]interface{}{"message": "删除成功"})

	default:
		apiMethodNotAllowed(w, "不支持的方法")
	}
}

// ========== 小模型管理 API ==========

// handleSmallModels 处理小模型列表和创建
func handleSmallModels(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		list := make([]*SmallModelConfig, 0, len(smallModels))
		for _, m := range smallModels {
			list = append(list, m)
		}
		dataOntologyMu.RUnlock()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "models": list})

	case http.MethodPost:
		var model SmallModelConfig
		if err := json.NewDecoder(r.Body).Decode(&model); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
			return
		}
		if model.Name == "" || model.JsCode == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "名称和代码不能为空"})
			return
		}
		model.ID = uuid.New().String()
		model.CreatedAt = time.Now().Format(time.RFC3339)
		dataOntologyMu.Lock()
		smallModels[model.ID] = &model
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "model": model})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
	}
}

// handleSmallModelDetail 处理单个小模型的 GET/PUT/DELETE/Run
func handleSmallModelDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}

	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/data-ontology/models/small/"), "/")
	if len(pathParts) == 0 || pathParts[0] == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "缺少模型ID"})
		return
	}
	modelID := pathParts[0]

	// 运行小模型
	if len(pathParts) >= 2 && pathParts[1] == "run" {
		handleSmallModelRun(w, r, modelID)
		return
	}

	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		model, exists := smallModels[modelID]
		dataOntologyMu.RUnlock()
		if !exists {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "模型不存在"})
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "model": model})

	case http.MethodPut:
		var update SmallModelConfig
		if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
			return
		}
		dataOntologyMu.Lock()
		model, exists := smallModels[modelID]
		if !exists {
			dataOntologyMu.Unlock()
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "模型不存在"})
			return
		}
		if update.Name != "" {
			model.Name = update.Name
		}
		model.Description = update.Description
		if update.JsCode != "" {
			model.JsCode = update.JsCode
		}
		model.DatabaseID = update.DatabaseID
		model.InputType = update.InputType
		model.AcceptExts = update.AcceptExts
		model.OutputType = update.OutputType
		model.Enabled = update.Enabled
		model.UpdatedAt = time.Now().Format(time.RFC3339)
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "model": model})

	case http.MethodDelete:
		dataOntologyMu.Lock()
		delete(smallModels, modelID)
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "删除成功"})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
	}
}

// handleSmallModelRun 运行小模型
func handleSmallModelRun(w http.ResponseWriter, r *http.Request, modelID string) {
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}

	dataOntologyMu.RLock()
	model, exists := smallModels[modelID]
	if !exists {
		dataOntologyMu.RUnlock()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "模型不存在"})
		return
	}
	dbID := model.DatabaseID
	dbType := ""
	if db, ok := dataOntologyDatabases[dbID]; ok {
		dbType = db.Type
	}
	code := model.JsCode
	dataOntologyMu.RUnlock()

	// 解析输入参数
	var req struct {
		InputText string `json:"input_text"`
		InputFile string `json:"input_file"` // base64
		FileName  string `json:"file_name"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	// 准备任务参数
	taskData := map[string]interface{}{
		"code":        code,
		"token":       "",
		"database_id": dbID,
		"db_type":     dbType,
		"input_text":  req.InputText,
		"file_base64": req.InputFile,
		"file_name":   req.FileName,
	}

	// 执行
	result := callGovRunner(taskData)
	if !result.Success {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": result.Error})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"output":  result.Output,
	})
}

// handleAIQuery 处理AI查询（流式响应）
func handleAIQuery(w http.ResponseWriter, r *http.Request) {
	// 设置流式响应头
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	log.Printf("[handleTableData] path=%s, parts=%v, len=%d", r.URL.Path, strings.Split(r.URL.Path, "/"), len(strings.Split(r.URL.Path, "/")))
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		sendSSE(w, "error", map[string]interface{}{
			"message": "未授权",
		})
		return
	}

	if r.Method != http.MethodPost {
		sendSSE(w, "error", map[string]interface{}{
			"message": "只支持POST请求",
		})
		return
	}

	// 确保支持流式传输
	flusher, ok := w.(http.Flusher)
	if !ok {
		sendSSE(w, "error", map[string]interface{}{
			"message": "不支持流式传输",
		})
		return
	}

	// 解析请求
	var queryReq AIQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&queryReq); err != nil {
		sendSSE(w, "error", map[string]interface{}{
			"message": "请求格式错误",
		})
		return
	}

	// 发送开始事件
	sendSSE(w, "start", map[string]interface{}{
		"message": "开始处理您的问题...",
	})
	flusher.Flush()

	// 检查AI配置
	dataOntologyMu.RLock()
	aiConfig := dataOntologyAIConfig
	aiCapabilities := dataOntologyAICapabilities
	dataOntologyMu.RUnlock()

	if aiConfig == nil {
		sendSSE(w, "error", map[string]interface{}{
			"message": "请先配置AI设置",
		})
		return
	}

	// 如果能力未检测，进行检测
	if aiCapabilities == nil {
		var err error
		aiCapabilities, err = detectAICapabilities(aiConfig)
		if err != nil {
			log.Printf("检测AI能力失败: %v", err)
			// 使用默认能力继续
			aiCapabilities = &AICapabilities{
				SupportsFunctionCall: false,
				SupportsThinking:     false,
				SupportsStreaming:    true,
				ContextWindow:        4096,
				SupportsJSONMode:     false,
			}
		}
	}

	// 发送读取表结构事件
	sendSSE(w, "thinking", map[string]interface{}{
		"message": "正在读取数据库表结构信息...",
	})
	flusher.Flush()

	// 如果没有指定数据库，返回数据库选择卡片
	if len(queryReq.Databases) == 0 {
		// 获取用户可访问的数据库列表
		dataOntologyMu.RLock()
		var availableDBs []map[string]interface{}
		for id, db := range dataOntologyDatabases {
			if dataOntologyResourceVisible(db.Owner, username) {
				availableDBs = append(availableDBs, map[string]interface{}{
					"id":   id,
					"name": db.Name,
					"type": db.Type,
				})
			}
		}
		dataOntologyMu.RUnlock()

		if len(availableDBs) == 0 {
			sendSSE(w, "error", map[string]interface{}{
				"message": "没有可用的数据库，请先添加数据库配置",
			})
			sendSSE(w, "done", map[string]interface{}{})
			flusher.Flush()
			return
		}

		// 返回数据库选择卡片
		sendSSE(w, "database_selection_required", map[string]interface{}{
			"message":    "请选择要操作的数据库",
			"databases":  availableDBs,
			"user_query": queryReq.Message,
		})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	// 获取数据库配置和表结构（含字段信息）
	dataOntologyMu.RLock()
	var dbSchemas []map[string]interface{}
	for _, dbID := range queryReq.Databases {
		dbConfig, exists := dataOntologyDatabases[dbID]
		if !exists || !dataOntologyResourceVisible(dbConfig.Owner, username) {
			continue
		}

		tables, err := getTablesList(dbConfig)
		if err != nil {
			log.Printf("获取数据库 %s 表列表失败: %v", dbConfig.Name, err)
			continue
		}

		// 使用表检索逻辑筛选相关表
		var tablesWithColumns []map[string]interface{}
		defaultMaxTables := 15
		
		retrievalConfig := aiConfig.TableRetrieval
		relevantTables, err := retrieveRelevantTables(queryReq.Message, dbConfig, retrievalConfig)
		if err != nil {
			log.Printf("表检索失败: %v, 使用前 %d 张表", err, defaultMaxTables)
			// 降级：截取前 N 张表
			if len(tables) > defaultMaxTables {
				tables = tables[:defaultMaxTables]
			}
			for _, tableName := range tables {
				columns, err := getTableColumns(dbConfig, tableName)
				if err != nil {
					log.Printf("获取表 %s 字段失败: %v", tableName, err)
					tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
						"name":    tableName,
						"columns": []map[string]interface{}{},
					})
					continue
				}
				tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
					"name":    tableName,
					"columns": columns,
				})
			}
		} else {
			// 使用检索结果
			log.Printf("[表检索] 检索到 %d 张相关表", len(relevantTables))
			for _, result := range relevantTables {
				tableName := result.TableName
				columns, err := getTableColumns(dbConfig, tableName)
				if err != nil {
					log.Printf("获取表 %s 字段失败: %v", tableName, err)
					tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
						"name":    tableName,
						"columns": []map[string]interface{}{},
					})
					continue
				}
				tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
					"name":    tableName,
					"columns": columns,
				})
			}
		}

		// 获取本体关系
		var relations []OntologyRelation
		if dbConfig.Relations != nil {
			for _, rel := range dbConfig.Relations {
				relations = append(relations, rel)
			}
		}

		dbSchemas = append(dbSchemas, map[string]interface{}{
			"name":      dbConfig.Name,
			"type":      dbConfig.Type,
			"tables":    tablesWithColumns,
			"relations": relations,
			"id":        dbID,
		})
	}
	dataOntologyMu.RUnlock()

	if len(dbSchemas) == 0 {
		sendSSE(w, "error", map[string]interface{}{
			"message": "未找到有效的数据库",
		})
		return
	}

	// 根据模块上下文路由
	moduleSet := make(map[string]bool)
	for _, m := range queryReq.Modules {
		moduleSet[m] = true
	}

	// 如果没有明确指定模块，进行意图检测
	if len(moduleSet) == 0 {
		intent := detectUserIntent(queryReq.Message)
		log.Printf("[AI Query] 关键词意图检测: module=%s, confidence=%.2f, reason=%s", intent.DetectedModule, intent.Confidence, intent.Reason)

		// 关键词置信度足够高，直接路由
		if intent.Confidence >= 0.7 && intent.DetectedModule != "" {
			moduleSet[intent.DetectedModule] = true
			sendSSE(w, "thinking", map[string]interface{}{
				"message": fmt.Sprintf("检测到意图: %s，正在处理...", intent.Reason),
			})
			flusher.Flush()
		} else {
			// 关键词置信度不足，调用 AI 进行意图分类
			sendSSE(w, "thinking", map[string]interface{}{
				"message": "正在分析您的意图...",
			})
			flusher.Flush()

			aiIntent := detectIntentWithAI(aiConfig, aiCapabilities, queryReq.Message)
			log.Printf("[AI Query] AI 意图分类: module=%s, confidence=%.2f, reason=%s", aiIntent.DetectedModule, aiIntent.Confidence, aiIntent.Reason)

			// 合并：取置信度更高的结果
			finalIntent := intent
			if aiIntent.Confidence > intent.Confidence && aiIntent.DetectedModule != "" {
				finalIntent = aiIntent
			}

			// 如果最终置信度 >= 0.7，自动路由
			if finalIntent.Confidence >= 0.7 && finalIntent.DetectedModule != "" {
				moduleSet[finalIntent.DetectedModule] = true
				sendSSE(w, "thinking", map[string]interface{}{
					"message": fmt.Sprintf("识别意图: %s，正在处理...", finalIntent.Reason),
				})
				flusher.Flush()
			} else {
				// AI 也不确定，返回意图选择卡片
				intentOptions := []map[string]interface{}{
					{"id": "db-manage", "name": "通用提问", "description": "查询数据、统计信息、了解表结构等", "icon": "💬"},
					{"id": "api-dispatch", "name": "接口制作", "description": "创建 API 接口、生成数据服务", "icon": "🔌"},
					{"id": "data-governance", "name": "数据治理", "description": "创建定时任务、数据导入导出", "icon": "⚙️"},
					{"id": "quality-audit", "name": "质量审计", "description": "数据质量检查、校验规则", "icon": "✅"},
					{"id": "ontology", "name": "本体查询", "description": "概念关系、语义分析", "icon": "🧠"},
				}

				sendSSE(w, "intent_selection_required", map[string]interface{}{
					"message":    "我不太确定您想要做什么，请选择一个操作类型：",
					"intents":    intentOptions,
					"user_query": queryReq.Message,
					"detected":   finalIntent,
				})
				sendSSE(w, "done", map[string]interface{}{})
				flusher.Flush()
				return
			}
		}
	}

	if moduleSet["api-dispatch"] {
		handleAICreateApi(w, flusher, &queryReq, dbSchemas, aiConfig, aiCapabilities)
		return
	}

	if moduleSet["data-governance"] {
		handleAIGovernanceTask(w, flusher, &queryReq, dbSchemas, aiConfig)
		return
	}

	if moduleSet["quality-audit"] {
		handleAIQualityRule(w, flusher, &queryReq, dbSchemas, aiConfig)
		return
	}

	if moduleSet["small-model"] {
		handleAISmallModel(w, flusher, &queryReq, dbSchemas, aiConfig)
		return
	}

	if moduleSet["ontology"] {
		handleAIOntologyQuery(w, flusher, &queryReq, dbSchemas, aiConfig)
		return
	}

	// 最多重试3次
	maxRetries := 3
	var lastError string
	var lastSQL string
	var attempts []map[string]interface{}
	var normalizedSQLs []string

	for retry := 0; retry < maxRetries; retry++ {
		// 发送生成SQL事件
		if retry == 0 {
			sendSSE(w, "thinking", map[string]interface{}{
				"message": "正在分析您的问题并生成SQL...",
				"attempt": retry + 1,
			})
		} else {
			sendSSE(w, "retry", map[string]interface{}{
				"message": fmt.Sprintf("第%d次重试，正在根据错误调整SQL...", retry+1),
				"attempt": retry + 1,
				"error":   lastError,
			})
		}
		flusher.Flush()

		// 根据上下文窗口大小截断历史
		if aiCapabilities != nil && aiCapabilities.ContextWindow > 0 {
			// 为当前prompt和响应预留一半的上下文空间
			maxHistoryTokens := aiCapabilities.ContextWindow / 2
			queryReq.History = truncateHistoryForContext(queryReq.History, maxHistoryTokens)
		}
		// 构建AI提示词（如果是重试，添加错误信息）
		var prompt string
		if retry == 0 {
			prompt = buildAIPrompt(queryReq.Message, dbSchemas, queryReq.Modules)
		} else {
			prompt = buildRetryPrompt(queryReq.Message, dbSchemas, lastError, attempts, queryReq.Modules)
		}

		// 调用AI服务生成SQL
		aiResponse, err := callAIServiceWithCapabilities(aiConfig, aiCapabilities, prompt)
		log.Printf("[AI Query] AI响应: %q, 错误: %v", aiResponse, err)
		if err != nil {
			lastError = "AI服务调用失败: " + err.Error()
			attempts = append(attempts, map[string]interface{}{
				"attempt":  retry + 1,
				"error":    lastError,
				"response": "",
				"sql":      "",
			})
			sendSSE(w, "attempt_failed", map[string]interface{}{
				"attempt": retry + 1,
				"error":   lastError,
			})
			flusher.Flush()
			continue
		}

		// 解析AI返回的SQL和回复文本
		aiResponse = cleanAIResponse(aiResponse)
		sqlQuery, targetDBID, responseText := parseAIResponse(aiResponse, dbSchemas)
		if sqlQuery == "" {
			lastError = "AI未能生成有效的SQL查询"
			attempts = append(attempts, map[string]interface{}{
				"attempt":  retry + 1,
				"error":    lastError,
				"response": aiResponse,
				"sql":      "",
			})
			sendSSE(w, "attempt_failed", map[string]interface{}{
				"attempt": retry + 1,
				"error":   lastError,
			})
			flusher.Flush()
			continue
		}

		// 检测是否生成了已执行失败过的相同 SQL
		normalizedSQL := strings.ReplaceAll(strings.ReplaceAll(sqlQuery, " ", ""), "\n", "")
		dup := false
		for _, prev := range normalizedSQLs {
			if normalizedSQL == prev {
				dup = true
				break
			}
		}
		if dup {
			lastError = "AI重复生成已尝试过的SQL，无法修复问题"
			attempts = append(attempts, map[string]interface{}{
				"attempt":  retry + 1,
				"error":    lastError,
				"response": responseText,
				"sql":      sqlQuery,
			})
			sendSSE(w, "attempt_failed", map[string]interface{}{
				"attempt": retry + 1,
				"error":   lastError,
				"sql":     sqlQuery,
			})
			flusher.Flush()
			break
		}
		normalizedLastSQL := strings.ReplaceAll(strings.ReplaceAll(lastSQL, " ", ""), "\n", "")
		if retry > 0 && normalizedSQL == normalizedLastSQL {
			lastError = "AI重复生成相同的SQL，无法修复问题"
			attempts = append(attempts, map[string]interface{}{
				"attempt":  retry + 1,
				"error":    lastError,
				"response": responseText,
				"sql":      sqlQuery,
			})
			sendSSE(w, "attempt_failed", map[string]interface{}{
				"attempt": retry + 1,
				"error":   lastError,
				"sql":     sqlQuery,
			})
			flusher.Flush()
			break
		}
		lastSQL = sqlQuery

		// 发送SQL生成完成事件
		if responseText == "" {
			responseText = "已为您执行查询"
		}
		sendSSE(w, "sql_generated", map[string]interface{}{
			"attempt":  retry + 1,
			"response": responseText,
			"sql":      sqlQuery,
		})
		flusher.Flush()

		// 检测写操作，需要用户确认
		if isWriteOperation(sqlQuery) {
			sendSSE(w, "confirm_write", map[string]interface{}{
				"response": responseText,
				"sql":      sqlQuery,
				"dbId":     targetDBID,
				"attempts": attempts,
				"retries":  retry,
			})
			sendSSE(w, "done", map[string]interface{}{})
			flusher.Flush()
			return
		}

		// 发送执行SQL事件
		sendSSE(w, "executing", map[string]interface{}{
			"message": "正在执行SQL查询...",
		})
		flusher.Flush()

		// 执行SQL查询
		dataOntologyMu.RLock()
		dbConfig, exists := dataOntologyDatabases[targetDBID]
		dataOntologyMu.RUnlock()

		if !exists || !dataOntologyResourceVisible(dbConfig.Owner, username) {
			lastError = "数据库不存在"
			attempts = append(attempts, map[string]interface{}{
				"attempt":  retry + 1,
				"error":    lastError,
				"response": responseText,
				"sql":      sqlQuery,
			})
			sendSSE(w, "attempt_failed", map[string]interface{}{
				"attempt": retry + 1,
				"error":   lastError,
				"sql":     sqlQuery,
			})
			flusher.Flush()
			continue
		}

		results, err := executeSQLQuery(dbConfig, sqlQuery, []interface{}{})
		if err != nil {
			lastError = "SQL执行失败: " + err.Error()
			errorClass := classifySQLError(err, dbConfig.Type)
			if errorClass == ErrorClassPermission {
				attempts = append(attempts, map[string]interface{}{
					"attempt":  retry + 1,
					"error":    lastError,
					"response": responseText,
					"sql":      sqlQuery,
				})
				sendSSE(w, "attempt_failed", map[string]interface{}{
					"attempt": retry + 1,
					"error":   lastError,
					"sql":     sqlQuery,
				})
				flusher.Flush()
				sendSSE(w, "error", map[string]interface{}{
					"message":  "权限不足，请联系 DBA 授权。错误：" + lastError,
					"no_retry": true,
				})
				sendSSE(w, "done", map[string]interface{}{})
				flusher.Flush()
				return
			}
			normalizedSQLs = append(normalizedSQLs, normalizedSQL)
			if errorClass == ErrorClassTimeout {
				lastError += "（请简化查询：限制行数、减少关联、避免 SELECT *）"
			}
			attempts = append(attempts, map[string]interface{}{
				"attempt":  retry + 1,
				"error":    lastError,
				"response": responseText,
				"sql":      sqlQuery,
			})
			sendSSE(w, "attempt_failed", map[string]interface{}{
				"attempt": retry + 1,
				"error":   lastError,
				"sql":     sqlQuery,
			})
			flusher.Flush()

			if retry < maxRetries-1 {
				continue
			}
		} else {
			// 成功了，返回结果（含反思洞察）
			insight := ""
			confidence := 0.0

			resultsSummary := truncateResultsForAI(results, 20, 2000)
			reflectionPrompt := buildReflectionPrompt(queryReq.Message, sqlQuery, resultsSummary, dbConfig.Type)
			reflectionResponse, refErr := callAIServiceWithCapabilities(aiConfig, aiCapabilities, reflectionPrompt)
			if refErr != nil {
				log.Printf("反思失败: %v", refErr)
			} else {
				reflection := parseReflectionResponse(reflectionResponse)
				if !reflection.AnswersQuestion && reflection.Suggestion != "" && retry < maxRetries-1 {
					log.Printf("反思建议: %s", reflection.Suggestion)
				}
				insight = reflection.Insight
				confidence = reflection.Confidence
			}

			sendSSE(w, "success", map[string]interface{}{
				"response":   responseText,
				"sql":        sqlQuery,
				"results":    results,
				"insight":    insight,
				"confidence": confidence,
				"attempts":   attempts,
				"retries":    retry,
			})
			sendSSE(w, "done", map[string]interface{}{})
			flusher.Flush()
			return
		}
	}

	// 所有重试都失败了
	sendSSE(w, "error", map[string]interface{}{
		"message":  lastError,
		"attempts": attempts,
	})
	sendSSE(w, "done", map[string]interface{}{})
	flusher.Flush()
}

// handleAIConfirmExecute 处理用户确认后的写操作执行
func handleAIConfirmExecute(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "只支持POST请求",
		})
		return
	}

	var req struct {
		SQL  string `json:"sql"`
		DBID string `json:"dbId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求格式错误",
		})
		return
	}

	if req.SQL == "" || req.DBID == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "缺少必要参数",
		})
		return
	}

	if !isWriteOperation(req.SQL) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "该SQL不是写操作，无需确认",
		})
		return
	}

	dataOntologyMu.RLock()
	dbConfig, exists := dataOntologyDatabases[req.DBID]
	dataOntologyMu.RUnlock()

	if !exists || !dataOntologyResourceVisible(dbConfig.Owner, username) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在",
		})
		return
	}

	results, err := executeSQLQuery(dbConfig, req.SQL, []interface{}{})
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "SQL执行失败: " + err.Error(),
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"results": results,
		"message": "执行成功",
	})
}

// getDBSQLHints 根据数据库类型返回对应的 SQL 语法提示
func getDBSQLHints(dbType string) (queryColumns, limitSyntax, sampleQuery string) {
	switch dbType {
	case "dm":
		queryColumns = "  SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, NULLABLE\n" +
			"  FROM USER_TAB_COLUMNS\n" +
			"  WHERE TABLE_NAME IN ('TABLE1', 'TABLE2')\n" +
			"  ORDER BY TABLE_NAME, COLUMN_ID"
		limitSyntax = "SELECT * FROM table_name WHERE ROWNUM <= 10"
		sampleQuery = "SELECT * FROM table_name WHERE ROWNUM <= 10"
	case "oracle":
		queryColumns = "  SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, NULLABLE\n" +
			"  FROM USER_TAB_COLUMNS\n" +
			"  WHERE TABLE_NAME IN ('TABLE1', 'TABLE2')\n" +
			"  ORDER BY TABLE_NAME, COLUMN_ID"
		limitSyntax = "SELECT * FROM table_name WHERE ROWNUM <= 10"
		sampleQuery = "SELECT * FROM table_name WHERE ROWNUM <= 10"
	case "postgresql", "timescaledb", "cockroachdb":
		queryColumns = "  SELECT table_name, column_name, data_type, is_nullable\n" +
			"  FROM information_schema.columns\n" +
			"  WHERE table_schema = 'public' AND table_name IN ('table1', 'table2')\n" +
			"  ORDER BY table_name, ordinal_position"
		limitSyntax = "SELECT * FROM table_name LIMIT 10"
		sampleQuery = "SELECT * FROM table_name LIMIT 10"
	case "sqlserver":
		queryColumns = "  SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE\n" +
			"  FROM INFORMATION_SCHEMA.COLUMNS\n" +
			"  WHERE TABLE_NAME IN ('table1', 'table2')\n" +
			"  ORDER BY TABLE_NAME, ORDINAL_POSITION"
		limitSyntax = "SELECT TOP 10 * FROM table_name"
		sampleQuery = "SELECT TOP 10 * FROM table_name"
	default:
		queryColumns = "  SELECT table_name, column_name, data_type, column_comment\n" +
			"  FROM information_schema.columns\n" +
			"  WHERE table_schema = DATABASE() AND table_name IN ('table1', 'table2')\n" +
			"  ORDER BY table_name, ordinal_position"
		limitSyntax = "SELECT * FROM table_name LIMIT 10"
		sampleQuery = "SELECT * FROM table_name LIMIT 10"
	}
	return
}

// getDBSpecificWarnings 根据数据库类型返回特定的语法警告
func getDBSpecificWarnings(dbType string) string {
	switch dbType {
	case "dm":
		return "⚠️ 达梦数据库语法注意事项：\n" +
			"- 【禁止】不要使用 LIMIT，用 WHERE ROWNUM <= N 限制行数\n" +
			"- 【禁止】不要使用 information_schema，用 USER_TAB_COLUMNS、USER_TABLES 等数据字典视图\n" +
			"- 【禁止】不要使用 DATABASE() 函数\n" +
			"- 【禁止】INSERT时不要向自增/IDENTITY列插入值，跳过标记为[自增主键]的列\n" +
			"- 表名和列名默认大写\n" +
			"- 字符串用单引号\n" +
			"- 支持 ROWNUM 伪列来限制结果集\n\n"
	case "oracle":
		return "⚠️ Oracle 语法注意事项：\n" +
			"- 不要使用 LIMIT，用 WHERE ROWNUM <= N\n" +
			"- 不要使用 information_schema，用 USER_TAB_COLUMNS 等数据字典视图\n" +
			"- 表名和列名默认大写\n\n"
	case "sqlserver":
		return "⚠️ SQL Server 语法注意事项：\n" +
			"- 不要使用 LIMIT，用 SELECT TOP N\n" +
			"- 使用 INFORMATION_SCHEMA.COLUMNS 查询字段信息\n\n"
	default:
		return ""
	}
}

// ErrorClass 错误类型枚举
type ErrorClass string

const (
	ErrorClassSyntax         ErrorClass = "syntax"
	ErrorClassObjectNotFound ErrorClass = "object_not_found"
	ErrorClassPermission     ErrorClass = "permission"
	ErrorClassTimeout        ErrorClass = "timeout"
	ErrorClassAmbiguous      ErrorClass = "ambiguous"
	ErrorClassUnknown        ErrorClass = "unknown"
)

// classifySQLError 根据错误信息分类
func classifySQLError(err error, dbType string) ErrorClass {
	_ = dbType
	errStr := strings.ToLower(err.Error())

	if strings.Contains(errStr, "-2007") ||
		strings.Contains(errStr, "1064") ||
		strings.Contains(errStr, "ora-00933") ||
		strings.Contains(errStr, "语法分析") ||
		strings.Contains(errStr, "syntax") ||
		strings.Contains(errStr, "near") {
		return ErrorClassSyntax
	}

	if strings.Contains(errStr, "doesn't exist") ||
		strings.Contains(errStr, "不存在") ||
		strings.Contains(errStr, "-2106") ||
		strings.Contains(errStr, "invalid object") {
		return ErrorClassObjectNotFound
	}

	if strings.Contains(errStr, "permission") ||
		strings.Contains(errStr, "拒绝") ||
		strings.Contains(errStr, "ora-01031") ||
		strings.Contains(errStr, "-5512") {
		return ErrorClassPermission
	}

	if strings.Contains(errStr, "timeout") ||
		strings.Contains(errStr, "超时") ||
		strings.Contains(errStr, "deadline") {
		return ErrorClassTimeout
	}

	if strings.Contains(errStr, "ambiguous") {
		return ErrorClassAmbiguous
	}

	return ErrorClassUnknown
}

var sqlDocsCache = make(map[string]string)
var sqlDocsOnce sync.Once

// loadSQLDoc 加载 SQL 文档（带缓存）
func loadSQLDoc(dbType string) string {
	sqlDocsOnce.Do(func() {
		docs := map[string]string{
			"dm":     "docs/sql/dm.md",
			"oracle": "docs/sql/oracle.md",
		}
		for t, path := range docs {
			content, err := os.ReadFile(path)
			if err == nil {
				s := string(content)
				if len(s) > 8000 {
					s = s[:8000] + "\n... (文档已截断)"
				}
				sqlDocsCache[t] = s
			}
		}
	})

	if doc, ok := sqlDocsCache[dbType]; ok {
		return doc
	}
	return ""
}

// formatDBSchemaForPrompt 将数据库结构格式化为提示词文本，返回格式化文本和主数据库类型
func formatDBSchemaForPrompt(dbSchemas []map[string]interface{}) (string, string) {
	var sb strings.Builder
	var primaryDBType string

	for _, schema := range dbSchemas {
		sb.WriteString(fmt.Sprintf("\n数据库: %s (类型: %s)\n", schema["name"], schema["type"]))
		sb.WriteString(strings.Repeat("=", 50) + "\n")

		if primaryDBType == "" {
			if t, ok := schema["type"].(string); ok {
				primaryDBType = t
			}
		}

		// 新格式：带字段信息的表结构
		if tables, ok := schema["tables"].([]map[string]interface{}); ok {
			for _, table := range tables {
				tableName, _ := table["name"].(string)
				sb.WriteString(fmt.Sprintf("\n表: %s\n", tableName))
				if columns, ok := table["columns"].([]map[string]interface{}); ok && len(columns) > 0 {
					sb.WriteString("  字段:\n")
					for i, col := range columns {
						colName, _ := col["name"].(string)
						colType, _ := col["type"].(string)
						tags := ""

						// 检测自增列：类型中显式标记，或第一个整数类型的 ID 列
						isAutoInc := strings.Contains(colType, "AUTO_INCREMENT")
						if !isAutoInc && i == 0 {
							upperName := strings.ToUpper(colName)
							upperType := strings.ToUpper(colType)
							if (upperName == "ID" || strings.HasSuffix(upperName, "_ID")) &&
								(strings.Contains(upperType, "INT") || strings.Contains(upperType, "NUMBER") || strings.Contains(upperType, "NUMERIC")) {
								isAutoInc = true
							}
						}

						if isAutoInc {
							tags += " [自增主键,INSERT时跳过]"
						} else {
							if n, ok := col["nullable"].(string); ok && n == "N" {
								tags += " [NOT NULL]"
							}
						}
						sb.WriteString(fmt.Sprintf("    - %s (%s)%s\n", colName, colType, tags))
					}
				} else {
					sb.WriteString("  （字段信息不可用）\n")
				}
			}
		} else if tables, ok := schema["tables"].([]string); ok {
			// 旧格式：仅表名列表
			sb.WriteString("表列表: " + strings.Join(tables, ", ") + "\n")
		}

		// 添加本体关系信息
		if relations, ok := schema["relations"].([]OntologyRelation); ok && len(relations) > 0 {
			sb.WriteString("\n本体关系（字段间语义关联）:\n")
			sb.WriteString(strings.Repeat("-", 40) + "\n")
			for _, rel := range relations {
				sb.WriteString(fmt.Sprintf("  • %s\n", rel.Name))
				sb.WriteString(fmt.Sprintf("    %s.%s ↔ %s.%s\n",
					rel.Source.TableName, rel.Source.FieldName,
					rel.Target.TableName, rel.Target.FieldName))
				if rel.Description != "" {
					sb.WriteString(fmt.Sprintf("    说明: %s\n", rel.Description))
				}
			}
			sb.WriteString("\n提示：上述关系表示不同表之间字段的语义关联，可在 JOIN 或分析时参考。\n")
		}
	}
	return sb.String(), primaryDBType
}

func getModulePromptPrefix(modules []string) string {
	moduleSet := make(map[string]bool)
	for _, m := range modules {
		moduleSet[m] = true
	}

	if moduleSet["db-manage"] {
		return "你是一个专业的数据库管理助手。你必须优先生成可执行、最小化、单条 SQL，并严格遵守数据库方言。若信息不足，只保留最核心的查询意图，不要扩写。\n\n"
	}
	return "你是一个专业的数据库助手。你必须优先生成可执行、最小化、单条 SQL，并严格遵守数据库方言。若信息不足，只保留最核心的查询意图，不要扩写。\n\n"
}

// ReflectionResult 反思结果
type ReflectionResult struct {
	AnswersQuestion bool    `json:"answers_question"`
	Confidence      float64 `json:"confidence"`
	Issue           string  `json:"issue"`
	Insight         string  `json:"insight"`
	Suggestion      string  `json:"suggestion"`
}

var reflectionJSONRegexp = regexp.MustCompile(`\{[\s\S]*\}`)

// parseReflectionResponse 解析反思响应
func parseReflectionResponse(response string) ReflectionResult {
	result := ReflectionResult{
		AnswersQuestion: true,
		Confidence:      0.5,
		Issue:           "ok",
		Insight:         "",
		Suggestion:      "",
	}

	jsonMatch := reflectionJSONRegexp.FindString(response)
	if jsonMatch == "" {
		return result
	}

	if err := json.Unmarshal([]byte(jsonMatch), &result); err != nil {
		log.Printf("解析反思结果失败: %v", err)
	}

	return result
}

// truncateResultsForAI 裁剪结果供 AI 分析
func truncateResultsForAI(results []map[string]interface{}, maxRows int, maxChars int) map[string]interface{} {
	if len(results) == 0 {
		return map[string]interface{}{
			"row_count": 0,
			"columns":   []string{},
			"sample":    []map[string]interface{}{},
		}
	}

	columns := make([]string, 0, len(results[0]))
	for k := range results[0] {
		columns = append(columns, k)
	}
	sort.Strings(columns)

	sample := results
	if len(results) > maxRows {
		sample = results[:maxRows]
	}

	totalChars := 0
	truncatedSample := []map[string]interface{}{}
	for _, row := range sample {
		newRow := make(map[string]interface{})
		for _, k := range columns {
			v, ok := row[k]
			if !ok {
				continue
			}
			str := fmt.Sprintf("%v", v)
			if len(str) > 200 {
				str = str[:200] + "..."
			}
			newRow[k] = str
			totalChars += len(str)
		}
		truncatedSample = append(truncatedSample, newRow)
		if totalChars > maxChars {
			break
		}
	}

	return map[string]interface{}{
		"row_count": len(results),
		"columns":   columns,
		"sample":    truncatedSample,
	}
}

// buildReflectionPrompt 构建反思提示词
func buildReflectionPrompt(userMessage string, sqlQuery string, resultsSummary map[string]interface{}, dbType string) string {
	var sb strings.Builder

	sb.WriteString("你是一个数据分析专家。请分析以下 SQL 查询结果是否回答了用户的问题。\n\n")

	sb.WriteString("## 用户问题\n")
	sb.WriteString(userMessage + "\n\n")

	sb.WriteString("## 数据库类型\n")
	sb.WriteString(dbType + "\n\n")

	sb.WriteString("## 执行的 SQL\n")
	sb.WriteString(sqlQuery + "\n\n")

	sb.WriteString("## 查询结果摘要\n")
	sb.WriteString(fmt.Sprintf("- 总行数: %v\n", resultsSummary["row_count"]))
	sb.WriteString(fmt.Sprintf("- 列名: %v\n", resultsSummary["columns"]))
	sb.WriteString("- 样本数据（前几行）:\n")

	sampleJSON, err := json.MarshalIndent(resultsSummary["sample"], "", "  ")
	if err != nil {
		sb.WriteString("[]\n\n")
	} else {
		sb.WriteString(string(sampleJSON) + "\n\n")
	}

	sb.WriteString("## 请输出 JSON 格式的分析\n")
	sb.WriteString("要求：只输出一个 JSON 对象，不要输出其他内容。\n\n")
	sb.WriteString("JSON 字段说明：\n")
	sb.WriteString("- answers_question: boolean，查询结果是否在实质上回答了用户问题\n")
	sb.WriteString("- confidence: number，0~1，你对上述判断的置信度\n")
	sb.WriteString("- issue: string，若有问题简要说明，否则 \"ok\"\n")
	sb.WriteString("- insight: string，面向用户的中文结论与数据解读（简洁）\n")
	sb.WriteString("- suggestion: string，若未充分回答，给出改进 SQL 或下一步建议；否则可为空字符串\n")

	return sb.String()
}

// buildAIPrompt 构建AI提示词
func buildAIPrompt(userMessage string, dbSchemas []map[string]interface{}, modules []string) string {
	prompt := getModulePromptPrefix(modules)
	prompt += "【重要】以下是真实的数据库结构信息，请严格基于这些表和字段生成SQL，不要编造不存在的列名或表名：\n"

	schemaText, primaryDBType := formatDBSchemaForPrompt(dbSchemas)
	prompt += schemaText

	queryColumns, _, sampleQuery := getDBSQLHints(primaryDBType)

	prompt += "\n用户问题：" + userMessage + "\n\n"

	prompt += getDBSpecificWarnings(primaryDBType)

	prompt += "⚠️ 重要规则：\n"
	prompt += "1. 【必须】只生成一条SQL语句！不能生成多条SQL语句！\n"
	prompt += "2. 【必须】只使用上面列出的真实表名和字段名，绝对不要编造列名！\n"
	prompt += "3. 【禁止】不要使用 UNION ALL 合并不同表的数据（列数和类型不同会报错）\n"
	prompt += "4. 对于INSERT操作：必须使用表中实际存在的字段名；标记为[自增主键,INSERT时跳过]的列绝对不要包含在INSERT语句中；根据字段类型填入合理的示例数据\n"
	prompt += "5. 使用子查询或聚合函数来统计多个表的信息\n"
	prompt += "6. 如果问题信息不足，只能基于已知结构给出最小可执行查询，必要时先返回最相关的表或字段\n\n"
	prompt += "📚 根据问题类型选择正确的SQL：\n\n"
	prompt += "🔍 查询表结构/字段信息：\n"
	prompt += queryColumns + "\n\n"
	prompt += "📊 分析/统计多个表的数据：\n"
	prompt += "  SELECT \n"
	prompt += "    'products' as table_name, COUNT(*) as row_count FROM products\n"
	prompt += "  UNION ALL\n"
	prompt += "  SELECT 'users' as table_name, COUNT(*) as row_count FROM users\n\n"
	prompt += "📋 查看表的样本数据：\n"
	prompt += "  " + sampleQuery + "\n\n"
	prompt += "✏️ 写入数据时：\n"
	prompt += "  必须先参考上方的表结构，使用实际存在的字段名，根据数据类型生成合理的值\n\n"
	prompt += "❌ 错误示例（不要这样做）：\n"
	prompt += "  SELECT * FROM table1 UNION ALL SELECT * FROM table2  -- 错误！不同表结构无法合并\n"
	prompt += "  INSERT INTO table1 (column1, column2) VALUES (...)  -- 错误！不要编造字段名\n\n"
	prompt += "🎯 理解用户意图：\n"
	prompt += "- 如果问\"有哪些字段/列\"：根据上方提供的表结构直接回答，或查询数据字典\n"
	prompt += "- 如果问\"分析数据/统计\"：使用 COUNT(*), SUM(), AVG() 等聚合函数\n"
	prompt += "- 如果问\"查看数据/内容\"：使用 " + sampleQuery + "\n"
	prompt += "- 如果要求\"写入/插入数据\"：根据上方表结构中的真实字段名生成INSERT语句\n"
	prompt += "- 如果涉及多个表：用子查询或统计，不要用 UNION ALL 合并不同结构的数据\n\n"
	prompt += "请按以下格式回复：\n"
	prompt += "1. 用一句话说明你将要做什么（例如：\"我将统计各表的数据量\"）\n"
	prompt += "2. 提供SQL语句（只能有一条）：\n"
	prompt += "```sql\n"
	prompt += "SELECT ... FROM ... ;\n"
	prompt += "```\n\n"
	prompt += "注意：\n"
	prompt += "- 回复要简洁友好\n"
	prompt += "- 只生成一条可执行的SQL语句\n"
	prompt += "- 严格使用上面提供的真实字段名，不要猜测或编造\n"
	prompt += "- 不要包含过多的技术解释"

	return prompt
}

// buildRetryPrompt 构建重试提示词
func buildRetryPrompt(userMessage string, dbSchemas []map[string]interface{}, lastError string, attempts []map[string]interface{}, modules []string) string {
	primaryDBType := "mysql"
	if len(dbSchemas) > 0 {
		if t, ok := dbSchemas[0]["type"].(string); ok && t != "" {
			primaryDBType = t
		}
	}
	errorClass := classifySQLError(errors.New(lastError), primaryDBType)

	var sb strings.Builder
	sb.WriteString(getModulePromptPrefix(modules))
	sb.WriteString("上一次查询失败，请根据错误信息修正。\n\n")

	switch errorClass {
	case ErrorClassSyntax:
		sb.WriteString("【语法错误】\n")
		sb.WriteString("1. 检查 SQL 语法是否符合 " + primaryDBType + " 规范\n")
		sb.WriteString("2. 注意：DM/Oracle 不支持 LIMIT，请用 ROWNUM\n")
		sb.WriteString("3. 确保关键字拼写正确\n")
		if doc := loadSQLDoc(primaryDBType); doc != "" {
			sb.WriteString("\n## " + primaryDBType + " 参考文档\n")
			sb.WriteString(doc)
			sb.WriteString("\n")
		}
	case ErrorClassObjectNotFound:
		sb.WriteString("【对象不存在】\n")
		sb.WriteString("1. 只能使用以下表：\n")
		for _, db := range dbSchemas {
			if tables, ok := db["tables"].([]map[string]interface{}); ok {
				for _, t := range tables {
					sb.WriteString("  - " + fmt.Sprintf("%v", t["name"]) + "\n")
				}
			}
		}
		sb.WriteString("2. 检查表名大小写\n")
	case ErrorClassPermission:
		sb.WriteString("【权限不足】\n")
		sb.WriteString("此错误无法通过修改 SQL 解决，请联系 DBA 授权。\n")
		sb.WriteString("不要重试生成 SQL。\n")
	case ErrorClassTimeout:
		sb.WriteString("【查询超时】\n")
		sb.WriteString("1. 添加 ROWNUM <= 100 限制行数\n")
		sb.WriteString("2. 减少关联表数量\n")
		sb.WriteString("3. 只查询必要字段，避免 SELECT *\n")
	case ErrorClassAmbiguous:
		sb.WriteString("【列名歧义】\n")
		sb.WriteString("请为所有列添加表别名，如：t1.column_name\n")
	}

	sb.WriteString("\n历史尝试：\n")
	for _, a := range attempts {
		sb.WriteString(fmt.Sprintf("第%v次: SQL=%v, 错误=%v\n",
			a["attempt"], a["sql"], a["error"]))
	}

	schemaText, pdb := formatDBSchemaForPrompt(dbSchemas)
	if pdb != "" {
		primaryDBType = pdb
	}
	sb.WriteString("\n【重要】以下是真实的数据库结构信息，请严格基于这些表和字段生成SQL，不要编造不存在的列名或表名：\n")
	sb.WriteString(schemaText)

	queryColumns, _, sampleQuery := getDBSQLHints(primaryDBType)

	sb.WriteString("\n用户问题：" + userMessage + "\n\n")

	sb.WriteString(getDBSpecificWarnings(primaryDBType))

	sb.WriteString("⚠️ 重要注意事项：\n")
	sb.WriteString("1. 【必须】只生成一条SQL语句，不要生成多条语句！\n")
	sb.WriteString("2. 如果错误信息包含'near'关键字，说明SQL语法有问题，请仔细检查：\n")
	sb.WriteString("   - 是否有多条SQL语句？如果有，只保留一条或合并为一条\n")
	sb.WriteString("   - 是否有语法错误的关键字？\n")
	sb.WriteString("   - 是否缺少或多余了分号、引号等符号？\n")
	sb.WriteString("3. 如果错误信息包含'Table doesn't exist'或'对象不存在'，请使用正确的表名\n")
	sb.WriteString("4. 如果错误信息包含'Column doesn't exist'或'列不存在'，请使用正确的字段名\n")
	sb.WriteString("5. 如果错误信息包含'different number of columns'，说明UNION的表结构不同：\n")
	sb.WriteString("   ❌ 不要用：SELECT * FROM table1 UNION ALL SELECT * FROM table2\n")
	sb.WriteString("   ✅ 改用统计：SELECT 'table1' as name, COUNT(*) as count FROM table1 UNION ALL SELECT 'table2', COUNT(*) FROM table2\n")
	sb.WriteString("   ✅ 或用子查询：SELECT (SELECT COUNT(*) FROM table1) as table1_count, (SELECT COUNT(*) FROM table2) as table2_count\n\n")

	sb.WriteString("📚 正确的SQL参考示例：\n")
	sb.WriteString("🔍 查询表结构：\n" + queryColumns + "\n")
	sb.WriteString("📋 查看样本数据：" + sampleQuery + "\n\n")

	if strings.Contains(lastError, "near") && strings.Contains(lastError, "at line 2") {
		sb.WriteString("🔍 根据错误分析：你生成了多条SQL语句，但系统只能执行一条！\n")
		sb.WriteString("请修改为只生成一条SQL语句。\n\n")
	}

	if strings.Contains(lastError, "different number of columns") {
		sb.WriteString("🔍 根据错误分析：你使用UNION ALL合并了列数不同的表！\n")
		sb.WriteString("解决方案：\n")
		sb.WriteString("1. 如果是统计数据，使用：SELECT 'table1' as table_name, COUNT(*) as count FROM table1 UNION ALL SELECT 'table2', COUNT(*) FROM table2\n")
		sb.WriteString("2. 如果是查询字段，使用：\n" + queryColumns + "\n")
		sb.WriteString("3. 不要直接合并不同结构的表数据！\n\n")
	}

	if strings.Contains(lastError, "connectex") || strings.Contains(lastError, "connection") {
		sb.WriteString("🔍 根据错误分析：数据库连接超时或失败！\n")
		sb.WriteString("请生成简单的SQL语句，避免复杂查询导致超时。\n\n")
	}

	if strings.Contains(lastError, "LIMIT") || strings.Contains(lastError, "语法分析") {
		sb.WriteString("🔍 根据错误分析：SQL语法不兼容当前数据库！\n")
		sb.WriteString("请严格使用当前数据库（" + primaryDBType + "）支持的SQL语法。\n\n")
	}

	sb.WriteString("请按以下格式回复：\n")
	sb.WriteString("1. 简单说明你发现的问题和修正方案（一句话）\n")
	sb.WriteString("2. 提供修正后的SQL（只能有一条SQL语句）：\n")
	sb.WriteString("```sql\n")
	sb.WriteString("SELECT ... FROM ...;\n")
	sb.WriteString("```\n\n")
	sb.WriteString("❗ 再次强调：只生成一条SQL语句！")

	return sb.String()
}

// cleanAIResponse 清洗模型输出，去掉 think、代码块和多余空白
func cleanAIResponse(response string) string {
	response = strings.TrimSpace(response)
	response = strings.ReplaceAll(response, "\r\n", "\n")
	response = strings.ReplaceAll(response, "\r", "\n")

	for _, marker := range []string{"<think>", "</think>", "<analysis>", "</analysis>"} {
		response = strings.ReplaceAll(response, marker, "")
	}

	response = strings.TrimSpace(response)

	// 处理代码块标记
	// 优先处理 ```json 和 ```sql，它们会包含结束的 ```
	hasCodeBlock := false
	if idx := strings.Index(response, "```json"); idx >= 0 {
		response = response[idx+len("```json"):]
		hasCodeBlock = true
	} else if idx := strings.Index(response, "```sql"); idx >= 0 {
		response = response[idx+len("```sql"):]
		hasCodeBlock = true
	} else if idx := strings.Index(response, "```"); idx >= 0 {
		// 只有在没有 ```json 或 ```sql 时才处理普通的 ```
		response = response[idx+len("```"):]
		hasCodeBlock = true
	}

	response = strings.TrimSpace(response)

	// 如果有代码块开始标记，找结束标记
	if hasCodeBlock {
		if idx := strings.LastIndex(response, "```"); idx >= 0 {
			response = response[:idx]
		}
	}

	return strings.TrimSpace(response)
}

func extractJSONObject(s string) string {
	s = cleanAIResponse(s)
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start >= 0 && end > start {
		return strings.TrimSpace(s[start : end+1])
	}
	return ""
}

// callAIService 调用AI服务
func callAIService(config *AIConfig, prompt string) (string, error) {
	return callAIServiceWithCapabilities(config, nil, prompt)
}

// callAIServiceWithCapabilities 根据能力自适应调用AI服务
func callAIServiceWithCapabilities(config *AIConfig, capabilities *AICapabilities, prompt string) (string, error) {
	// 构建请求体
	requestBody := map[string]interface{}{
		"model": config.Model,
		"messages": []map[string]string{
			{
				"role":    "user",
				"content": prompt,
			},
		},
		"temperature": 0.1,
	}

	// 如果支持JSON模式且需要结构化输出，启用JSON模式
	if capabilities != nil && capabilities.SupportsJSONMode {
		// 检查prompt是否要求JSON输出
		if strings.Contains(prompt, "JSON") || strings.Contains(prompt, "json") ||
			strings.Contains(prompt, "返回JSON") || strings.Contains(prompt, "格式如下") {
			requestBody["response_format"] = map[string]string{"type": "json_object"}
		}
	}

	// 如果支持Extended Thinking，可以添加thinking参数（针对支持的模型）
	// 注意：这需要API支持，目前先预留
	if capabilities != nil && capabilities.SupportsThinking {
		// 可以在这里添加thinking相关的参数
		// 例如对于某些模型可以添加: requestBody["thinking"] = map[string]interface{}{...}
	}

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return "", fmt.Errorf("构建请求失败: %v", err)
	}

	// 创建HTTP请求
	req, err := http.NewRequest("POST", config.URL, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.APIKey)

	// 使用配置的超时时间，默认120秒，避免大模型首次响应过慢导致超时
	timeout := config.Timeout
	if timeout <= 0 {
		timeout = 120
	}
	client := &http.Client{
		Timeout: time.Duration(timeout) * time.Second,
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 读取响应
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("解析响应失败: %v", err)
	}

	// 检查响应状态
	if resp.StatusCode != http.StatusOK {
		if errMsg, ok := result["error"].(map[string]interface{}); ok {
			if msg, ok := errMsg["message"].(string); ok {
				return "", fmt.Errorf("AI服务错误: %s", msg)
			}
		}
		return "", fmt.Errorf("AI服务返回错误状态: %d", resp.StatusCode)
	}

	// 提取响应内容
	if choices, ok := result["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if message, ok := choice["message"].(map[string]interface{}); ok {
				if content, ok := message["content"].(string); ok {
					return content, nil
				}
			}
		}
	}

	return "", fmt.Errorf("无法解析AI响应")
}

// AICapabilityTestResult 单项能力测试结果
type AICapabilityTestResult struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// AICapabilitiesDetectionDetails 详细检测结果
type AICapabilitiesDetectionDetails struct {
	Connectivity AICapabilityTestResult `json:"connectivity"`
	FunctionCall AICapabilityTestResult `json:"function_call"`
	Streaming    AICapabilityTestResult `json:"streaming"`
	JSONMode     AICapabilityTestResult `json:"json_mode"`
}

// detectAICapabilities 检测AI模型的能力（通过实际API调用测试）
func detectAICapabilities(config *AIConfig) (*AICapabilities, error) {
	if config == nil || config.URL == "" || config.APIKey == "" || config.Model == "" {
		return nil, fmt.Errorf("AI配置不完整")
	}

	log.Printf("[AI能力检测] 开始检测模型: %s, URL: %s", config.Model, config.URL)

	capabilities := &AICapabilities{
		SupportsFunctionCall: false,
		SupportsThinking:     false,
		SupportsStreaming:    true, // 默认支持流式，大多数模型都支持
		ContextWindow:        4096, // 默认上下文窗口
		SupportsJSONMode:     false,
		DetectedAt:           time.Now().Unix(),
	}

	// 优先使用手动设置
	if config.EnableFunctionCall != nil {
		capabilities.SupportsFunctionCall = *config.EnableFunctionCall
		log.Printf("[AI能力检测] Function Call 已手动设置: %v", capabilities.SupportsFunctionCall)
	}
	if config.EnableThinking != nil {
		capabilities.SupportsThinking = *config.EnableThinking
		log.Printf("[AI能力检测] Thinking 已手动设置: %v", capabilities.SupportsThinking)
	}
	if config.EnableStreaming != nil {
		capabilities.SupportsStreaming = *config.EnableStreaming
		log.Printf("[AI能力检测] Streaming 已手动设置: %v", capabilities.SupportsStreaming)
	}
	if config.EnableJSONMode != nil {
		capabilities.SupportsJSONMode = *config.EnableJSONMode
		log.Printf("[AI能力检测] JSON Mode 已手动设置: %v", capabilities.SupportsJSONMode)
	}
	if config.ContextWindowOverride > 0 {
		capabilities.ContextWindow = config.ContextWindowOverride
		log.Printf("[AI能力检测] Context Window 已手动设置: %d", capabilities.ContextWindow)
	}

	// 如果所有能力都已手动设置，直接返回
	if config.EnableFunctionCall != nil && config.EnableThinking != nil &&
		config.EnableStreaming != nil && config.EnableJSONMode != nil &&
		config.ContextWindowOverride > 0 {
		log.Printf("[AI能力检测] 所有能力已手动设置，跳过自动检测")
		return capabilities, nil
	}

	// 创建HTTP客户端（10秒超时）
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// 1. 测试基本连通性
	log.Printf("[AI能力检测] 测试基本连通性...")
	connectivityOK, connectivityErr := testBasicConnectivity(client, config)
	if connectivityOK {
		log.Printf("[AI能力检测] ✓ 基本连通性测试成功")
	} else {
		log.Printf("[AI能力检测] ✗ 基本连通性测试失败: %v", connectivityErr)
	}

	// 2. 测试 Function Call（如果未手动设置）
	if config.EnableFunctionCall == nil && connectivityOK {
		log.Printf("[AI能力检测] 测试 Function Call 支持...")
		supported, err := testFunctionCall(client, config)
		capabilities.SupportsFunctionCall = supported
		if supported {
			log.Printf("[AI能力检测] ✓ 支持 Function Call")
		} else {
			log.Printf("[AI能力检测] ✗ 不支持 Function Call: %v", err)
		}
	}

	// 3. 测试 Streaming（如果未手动设置）
	if config.EnableStreaming == nil && connectivityOK {
		log.Printf("[AI能力检测] 测试 Streaming 支持...")
		supported, err := testStreaming(client, config)
		capabilities.SupportsStreaming = supported
		if supported {
			log.Printf("[AI能力检测] ✓ 支持 Streaming")
		} else {
			log.Printf("[AI能力检测] ✗ 不支持 Streaming: %v", err)
		}
	}

	// 4. 测试 JSON Mode（如果未手动设置）
	if config.EnableJSONMode == nil && connectivityOK {
		log.Printf("[AI能力检测] 测试 JSON Mode 支持...")
		supported, err := testJSONMode(client, config)
		capabilities.SupportsJSONMode = supported
		if supported {
			log.Printf("[AI能力检测] ✓ 支持 JSON Mode")
		} else {
			log.Printf("[AI能力检测] ✗ 不支持 JSON Mode: %v", err)
		}
	}

	// 5. 根据模型名称推断上下文窗口大小（如果未手动设置）
	if config.ContextWindowOverride == 0 {
		capabilities.ContextWindow = inferContextWindow(config.Model)
		log.Printf("[AI能力检测] 推断上下文窗口大小: %d", capabilities.ContextWindow)
	}

	// 6. 根据模型名称推断是否支持 Thinking（如果未手动设置）
	if config.EnableThinking == nil {
		capabilities.SupportsThinking = inferThinkingSupport(config.Model)
		log.Printf("[AI能力检测] 推断 Thinking 支持: %v", capabilities.SupportsThinking)
	}

	log.Printf("[AI能力检测] 检测完成: FunctionCall=%v, Streaming=%v, JSONMode=%v, Thinking=%v, ContextWindow=%d",
		capabilities.SupportsFunctionCall, capabilities.SupportsStreaming,
		capabilities.SupportsJSONMode, capabilities.SupportsThinking,
		capabilities.ContextWindow)

	return capabilities, nil
}

// testBasicConnectivity 测试基本连通性
func testBasicConnectivity(client *http.Client, config *AIConfig) (bool, error) {
	requestBody := map[string]interface{}{
		"model": config.Model,
		"messages": []map[string]string{
			{"role": "user", "content": "hello"},
		},
		"max_tokens": 10,
	}

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return false, fmt.Errorf("构建请求失败: %v", err)
	}

	req, err := http.NewRequest("POST", config.URL, bytes.NewBuffer(jsonData))
	if err != nil {
		return false, fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.APIKey)

	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := ioutil.ReadAll(resp.Body)
		return false, fmt.Errorf("HTTP状态码: %d, 响应: %s", resp.StatusCode, string(bodyBytes))
	}

	return true, nil
}

// testFunctionCall 测试 Function Call 支持
func testFunctionCall(client *http.Client, config *AIConfig) (bool, error) {
	// 定义一个简单的测试工具
	requestBody := map[string]interface{}{
		"model": config.Model,
		"messages": []map[string]string{
			{"role": "user", "content": "What's the weather in Beijing?"},
		},
		"tools": []map[string]interface{}{
			{
				"type": "function",
				"function": map[string]interface{}{
					"name":        "get_weather",
					"description": "Get the current weather for a location",
					"parameters": map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"location": map[string]interface{}{
								"type":        "string",
								"description": "The city name",
							},
						},
						"required": []string{"location"},
					},
				},
			},
		},
		"tool_choice": "auto",
		"max_tokens":  100,
	}

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return false, fmt.Errorf("构建请求失败: %v", err)
	}

	req, err := http.NewRequest("POST", config.URL, bytes.NewBuffer(jsonData))
	if err != nil {
		return false, fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.APIKey)

	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := ioutil.ReadAll(resp.Body)
		return false, fmt.Errorf("HTTP状态码: %d, 响应: %s", resp.StatusCode, string(bodyBytes))
	}

	// 解析响应，检查是否包含 tool_calls
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("解析响应失败: %v", err)
	}

	// 检查是否有 tool_calls
	if choices, ok := result["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if message, ok := choice["message"].(map[string]interface{}); ok {
				if _, hasToolCalls := message["tool_calls"]; hasToolCalls {
					return true, nil
				}
			}
		}
	}

	return false, fmt.Errorf("响应中未包含 tool_calls 字段")
}

// testStreaming 测试流式输出支持
func testStreaming(client *http.Client, config *AIConfig) (bool, error) {
	requestBody := map[string]interface{}{
		"model": config.Model,
		"messages": []map[string]string{
			{"role": "user", "content": "hi"},
		},
		"stream":     true,
		"max_tokens": 10,
	}

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return false, fmt.Errorf("构建请求失败: %v", err)
	}

	req, err := http.NewRequest("POST", config.URL, bytes.NewBuffer(jsonData))
	if err != nil {
		return false, fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.APIKey)

	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := ioutil.ReadAll(resp.Body)
		return false, fmt.Errorf("HTTP状态码: %d, 响应: %s", resp.StatusCode, string(bodyBytes))
	}

	// 检查是否返回 SSE 流
	contentType := resp.Header.Get("Content-Type")
	if strings.Contains(contentType, "text/event-stream") ||
		strings.Contains(contentType, "application/stream+json") {
		return true, nil
	}

	return false, fmt.Errorf("Content-Type 不是流式类型: %s", contentType)
}

// testJSONMode 测试 JSON 输出模式支持
func testJSONMode(client *http.Client, config *AIConfig) (bool, error) {
	requestBody := map[string]interface{}{
		"model": config.Model,
		"messages": []map[string]string{
			{"role": "user", "content": "Return a JSON object with a 'status' field set to 'ok'"},
		},
		"response_format": map[string]string{"type": "json_object"},
		"max_tokens":      50,
	}

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return false, fmt.Errorf("构建请求失败: %v", err)
	}

	req, err := http.NewRequest("POST", config.URL, bytes.NewBuffer(jsonData))
	if err != nil {
		return false, fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.APIKey)

	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 如果返回 400 或其他错误，可能不支持 JSON mode
	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := ioutil.ReadAll(resp.Body)
		return false, fmt.Errorf("HTTP状态码: %d, 响应: %s", resp.StatusCode, string(bodyBytes))
	}

	// 解析响应，检查是否返回有效 JSON
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("解析响应失败: %v", err)
	}

	if choices, ok := result["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if message, ok := choice["message"].(map[string]interface{}); ok {
				if content, ok := message["content"].(string); ok {
					// 尝试解析返回的内容是否为有效 JSON
					var jsonContent interface{}
					if err := json.Unmarshal([]byte(content), &jsonContent); err != nil {
						return false, fmt.Errorf("返回内容不是有效JSON: %v", err)
					}
					return true, nil
				}
			}
		}
	}

	return false, fmt.Errorf("无法从响应中提取内容")
}

// inferContextWindow 根据模型名称推断上下文窗口大小
func inferContextWindow(model string) int {
	modelLower := strings.ToLower(model)

	if strings.Contains(modelLower, "gpt-4-turbo") || strings.Contains(modelLower, "gpt-4o") {
		return 128000
	} else if strings.Contains(modelLower, "gpt-4-32k") {
		return 32768
	} else if strings.Contains(modelLower, "gpt-4") {
		return 8192
	} else if strings.Contains(modelLower, "gpt-3.5-turbo-16k") {
		return 16384
	} else if strings.Contains(modelLower, "gpt-3.5") {
		return 4096
	} else if strings.Contains(modelLower, "claude-3") || strings.Contains(modelLower, "claude-sonnet") || strings.Contains(modelLower, "claude-opus") {
		return 200000
	} else if strings.Contains(modelLower, "claude-2") {
		return 100000
	} else if strings.Contains(modelLower, "claude-instant") {
		return 100000
	} else if strings.Contains(modelLower, "qwen") {
		// Qwen 系列上下文窗口
		if strings.Contains(modelLower, "32b") || strings.Contains(modelLower, "30b") {
			return 32768
		} else if strings.Contains(modelLower, "72b") || strings.Contains(modelLower, "70b") {
			return 32768
		} else if strings.Contains(modelLower, "7b") || strings.Contains(modelLower, "14b") {
			return 32768
		}
		return 32768
	}

	return 4096
}

// inferThinkingSupport 根据模型名称推断是否支持 Extended Thinking
func inferThinkingSupport(model string) bool {
	modelLower := strings.ToLower(model)
	return strings.Contains(modelLower, "claude-3.5") ||
		strings.Contains(modelLower, "claude-sonnet-3.5") ||
		strings.Contains(modelLower, "o1") ||
		strings.Contains(modelLower, "deepseek-reasoner")
}

// truncateHistoryForContext 根据上下文窗口大小截断对话历史
func truncateHistoryForContext(history []map[string]interface{}, maxTokens int) []map[string]interface{} {
	if len(history) <= 1 {
		return history
	}

	// 估算每个消息的平均token数（粗略估计：1 token ≈ 4 字符）
	// 保留最近的消息，删除最早的消息
	maxChars := maxTokens * 4
	totalChars := 0

	// 从后向前计算
	result := make([]map[string]interface{}, 0, len(history))
	for i := len(history) - 1; i >= 0; i-- {
		msg := history[i]
		content, _ := msg["content"].(string)
		msgChars := len(content) + 50 // 额外50字符用于role等元数据

		if totalChars+msgChars > maxChars {
			break
		}

		result = append([]map[string]interface{}{msg}, result...)
		totalChars += msgChars
	}

	// 至少保留最后一条消息
	if len(result) == 0 && len(history) > 0 {
		result = append(result, history[len(history)-1])
	}

	return result
}

// callAIWithCapabilities 根据模型能力自适应调用AI服务
func callAIWithCapabilities(config *AIConfig, capabilities *AICapabilities, prompt string, useStreaming bool) (string, error) {
	// 如果支持流式输出且请求流式，使用流式调用
	if capabilities.SupportsStreaming && useStreaming {
		return callAIService(config, prompt) // 暂时使用非流式，后续可扩展
	}

	// 降级到普通调用
	return callAIService(config, prompt)
}

// extractCodeFromAIResponse 从 AI 返回中提取代码（去掉 ```js 等包裹）
func extractCodeFromAIResponse(s string) string {
	s = cleanAIResponse(s)
	if idx := strings.Index(s, "function "); idx >= 0 {
		return strings.TrimSpace(s[idx:])
	}
	if idx := strings.Index(s, "const "); idx >= 0 {
		return strings.TrimSpace(s[idx:])
	}
	return strings.TrimSpace(s)
}

// handleAICodegen 处理数据治理入库代码 AI 生成（使用与 AI 助手相同的 api url / api_key / model）
func handleAICodegen(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "只支持 POST",
		})
		return
	}
	var req AICodegenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求格式错误",
		})
		return
	}
	if req.DatabaseID != "" {
		dataOntologyMu.RLock()
		dc, ok := dataOntologyDatabases[req.DatabaseID]
		dataOntologyMu.RUnlock()
		if !ok || !dataOntologyResourceVisible(dc.Owner, username) {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "数据库不存在",
			})
			return
		}
	}
	if req.TableName == "" || len(req.Columns) == 0 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请选择目标表并配置列映射",
		})
		return
	}

	dataOntologyMu.RLock()
	aiConfig := dataOntologyAIConfig
	dataOntologyMu.RUnlock()
	if aiConfig == nil || aiConfig.URL == "" || aiConfig.APIKey == "" || aiConfig.Model == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请先在 AI 助手中配置 AI 设置（URL、API Key、模型）",
		})
		return
	}

	// 构建 prompt：与前端模板一致的约定（gov.*、INPUT_FILE/INPUT_TEXT、XLSX、Papa、mammoth）
	var colLines []string
	for _, c := range req.Columns {
		colLines = append(colLines, fmt.Sprintf("  - 列 %s (%s) ← 源数据第 %d 列(0-based)", c.Name, c.Type, c.SourceIndex))
	}
	sourceDesc := map[string]string{
		"excel":    "Excel 文件 (.xlsx)，使用 INPUT_FILE，gov.readExcel(INPUT_FILE) 与 XLSX.utils.sheet_to_json",
		"csv_file": "CSV 文件，使用 INPUT_FILE.text() 与 Papa.parse",
		"csv_text": "CSV 文本，使用 INPUT_TEXT 与 Papa.parse(INPUT_TEXT)",
	}[req.SourceType]
	if sourceDesc == "" {
		sourceDesc = "Excel 文件"
	}

	prompt := fmt.Sprintf(`你是一个数据治理任务代码生成器。请根据以下配置生成一段可运行的 JavaScript 代码，用于将数据导入到数据库。要求：
1. 使用环境提供的全局对象：gov（含 gov.log、gov.readExcel、gov.readCSV、gov.querySQL、gov.executeSQL）、INPUT_FILE（文件上传时）、INPUT_TEXT（文本输入时）、XLSX、Papa、mammoth。
2. 数据库类型为 %s，表名为 %s（注意引号：MySQL/MariaDB 用反引号，其他可用双引号）。
3. 数据源：%s。
4. 列映射（目标表列 ← 源数据行数组索引 0-based）：
%s
5. 只输出可执行的 JavaScript 代码，不要用 markdown 代码块包裹，不要解释。代码应解析数据后逐行 INSERT，并统计成功/失败行数、用 gov.log 输出。`,
		req.DBType, req.TableName, sourceDesc, strings.Join(colLines, "\n"))
	if req.UserHint != "" {
		prompt += "\n6. 用户补充说明：" + req.UserHint
	}

	aiResponse, err := callAIService(aiConfig, prompt)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "AI 调用失败: " + err.Error(),
		})
		return
	}
	code := extractCodeFromAIResponse(aiResponse)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"code":    code,
	})
}

// AICompletionRequest 通用 AI 文本补全请求（与 AI 助手共用 url/api_key/model）
type AICompletionRequest struct {
	Prompt string `json:"prompt"`
}

// OntologyExtractRequest 本体论提取请求
type OntologyExtractRequest struct {
	Databases []string `json:"databases"`
}

// OntologyQueryRequest 本体论语义查询请求
type OntologyQueryRequest struct {
	Query    string                 `json:"query"`
	Ontology map[string]interface{} `json:"ontology"`
}

// handleOntologyExtract 从数据库结构中AI提取本体论知识图谱（SSE流式）
func handleOntologyExtract(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		sendSSE(w, "onto-error", map[string]interface{}{"message": "未授权"})
		return
	}
	if r.Method != http.MethodPost {
		sendSSE(w, "onto-error", map[string]interface{}{"message": "只支持POST"})
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		sendSSE(w, "onto-error", map[string]interface{}{"message": "不支持流式传输"})
		return
	}

	var req OntologyExtractRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendSSE(w, "onto-error", map[string]interface{}{"message": "请求格式错误"})
		return
	}

	sendSSE(w, "onto-start", map[string]interface{}{"message": "开始分析数据库结构..."})
	flusher.Flush()

	dataOntologyMu.RLock()
	aiConfig := dataOntologyAIConfig
	dataOntologyMu.RUnlock()
	if aiConfig == nil || aiConfig.URL == "" {
		sendSSE(w, "onto-error", map[string]interface{}{"message": "请先在AI助手中配置AI设置"})
		return
	}

	// 收集数据库 schema
	sendSSE(w, "onto-thinking", map[string]interface{}{"message": "正在读取数据库表结构..."})
	flusher.Flush()

	dataOntologyMu.RLock()
	var dbSchemas []map[string]interface{}
	for _, dbID := range req.Databases {
		dbConfig, exists := dataOntologyDatabases[dbID]
		if !exists || !dataOntologyResourceVisible(dbConfig.Owner, username) {
			continue
		}
		tables, err := getTablesList(dbConfig)
		if err != nil {
			continue
		}
		var tablesWithCols []map[string]interface{}
		maxTables := 20
		if len(tables) > maxTables {
			tables = tables[:maxTables]
		}
		for _, tName := range tables {
			cols, err := getTableColumns(dbConfig, tName)
			if err != nil {
				cols = []map[string]interface{}{}
			}
			tablesWithCols = append(tablesWithCols, map[string]interface{}{"name": tName, "columns": cols})
		}
		dbSchemas = append(dbSchemas, map[string]interface{}{
			"id": dbID, "name": dbConfig.Name, "type": dbConfig.Type, "tables": tablesWithCols,
		})
	}
	dataOntologyMu.RUnlock()

	if len(dbSchemas) == 0 {
		sendSSE(w, "onto-error", map[string]interface{}{"message": "未找到有效的数据库或无法获取表结构"})
		return
	}

	sendSSE(w, "onto-thinking", map[string]interface{}{"message": "AI正在理解业务语义，构建本体论图谱..."})
	flusher.Flush()

	prompt := buildOntologyExtractionPrompt(dbSchemas)
	aiResp, err := callAIService(aiConfig, prompt)
	if err != nil {
		sendSSE(w, "onto-error", map[string]interface{}{"message": "AI调用失败: " + err.Error()})
		return
	}

	// 解析 JSON
	cleaned := extractJSONObject(aiResp)
	if cleaned == "" {
		cleaned = cleanAIResponse(aiResp)
	}
	cleaned = extractJSONObject(cleaned)

	var ontology map[string]interface{}
	if err := json.Unmarshal([]byte(cleaned), &ontology); err != nil {
		sendSSE(w, "onto-error", map[string]interface{}{"message": "AI返回格式解析失败，请重试"})
		return
	}

	// 流式推送节点（带微小延迟营造动画效果）
	sendSSE(w, "onto-thinking", map[string]interface{}{"message": "正在构建知识图谱..."})
	flusher.Flush()

	sendSSE(w, "onto-result", ontology)
	flusher.Flush()

	sendSSE(w, "onto-done", map[string]interface{}{"message": "本体论提取完成"})
	flusher.Flush()
}

// buildOntologyExtractionPrompt 构建本体论提取的AI提示词
func buildOntologyExtractionPrompt(dbSchemas []map[string]interface{}) string {
	schemaJSON, _ := json.MarshalIndent(dbSchemas, "", "  ")
	prompt := `你是一位数据本体论（Ontology）专家，擅长从数据库结构中提取业务语义知识图谱。

请分析以下数据库表结构，识别业务实体、概念、事件、规则，及其语义关系，同时发现数据治理问题。

要求：
1. 输出一个严格的 JSON 对象（不要 markdown 代码块包裹，不要任何解释）
2. JSON 结构如下：
{
  "concepts": [
    {
      "id": "英文小写下划线唯一标识",
      "label": "中文业务名称",
      "category": "entity|event|concept|rule|conflict",
      "description": "业务含义描述（2-3句话）",
      "tables": ["对应的数据库表名"],
      "importance": 0.0到1.0的重要性权重,
      "attributes": ["核心字段名"],
      "governance_issues": ["存在的数据治理问题（若无则为空数组）"]
    }
  ],
  "relations": [
    {
      "source": "源概念id",
      "target": "目标概念id",
      "label": "关系中文名称",
      "type": "has-one|has-many|many-to-many|many-to-one|conflict|inherits",
      "description": "关系说明"
    }
  ],
  "insights": [
    {
      "type": "conflict|missing|quality|governance|performance",
      "title": "洞察标题",
      "description": "详细说明",
      "severity": "high|medium|low|info",
      "affectedConcepts": ["相关概念id"]
    }
  ]
}

重要规则：
- concepts 数量控制在 8-15 个，聚焦核心业务概念
- relations 覆盖所有主要业务关联
- insights 必须包含至少1个命名/冲突类问题（若存在）和1个治理建议
- conflict 类 concept 专门描述发现的问题实体

数据库结构：
` + string(schemaJSON)
	return prompt
}

// handleAIOntologyQuery 处理AI助手中的本体论语义查询
func handleAIOntologyQuery(w http.ResponseWriter, flusher http.Flusher, queryReq *AIQueryRequest, dbSchemas []map[string]interface{}, aiConfig *AIConfig) {
	sendSSE(w, "thinking", map[string]interface{}{"message": "正在进行语义分析..."})
	flusher.Flush()

	schemaJSON, _ := json.MarshalIndent(dbSchemas, "", "  ")
	prompt := fmt.Sprintf(`你是一位数据本体论专家。用户正在询问关于数据库数据的语义问题。
请基于以下数据库结构，从本体论角度分析并回答用户的问题。
关注业务语义、实体关系、数据治理角度给出深度分析。

数据库结构：
%s

用户问题：%s

请用中文给出详细的语义分析和治理建议。最后一行输出 HIGHLIGHT:concept_id1,concept_id2，列出应高亮的概念id。`, string(schemaJSON), queryReq.Message)

	aiResp, err := callAIService(aiConfig, prompt)
	if err != nil {
		sendSSE(w, "error", map[string]interface{}{"message": "AI调用失败: " + err.Error()})
		return
	}

	answer := aiResp
	highlighted := []string{}
	if idx := strings.LastIndex(aiResp, "HIGHLIGHT:"); idx >= 0 {
		answer = strings.TrimSpace(aiResp[:idx])
		ids := strings.TrimSpace(aiResp[idx+10:])
		for _, id := range strings.Split(ids, ",") {
			if id = strings.TrimSpace(id); id != "" {
				highlighted = append(highlighted, id)
			}
		}
	}
	sendSSE(w, "answer", map[string]interface{}{"text": answer, "highlighted": highlighted})
	sendSSE(w, "done", map[string]interface{}{})
	flusher.Flush()
}

// handleOntologySemanticQuery 本体论自然语言语义查询
func handleOntologySemanticQuery(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}
	var req OntologyQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}
	if req.Query == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "查询内容不能为空"})
		return
	}
	dataOntologyMu.RLock()
	aiConfig := dataOntologyAIConfig
	dataOntologyMu.RUnlock()
	if aiConfig == nil || aiConfig.URL == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请先配置AI设置"})
		return
	}

	ontologyJSON, _ := json.MarshalIndent(req.Ontology, "", "  ")
	prompt := fmt.Sprintf(`你是一位数据本体论专家。用户正在查询一个业务知识图谱。

当前知识图谱：
%s

用户问题：%s

请用中文回答，要求：
1. 直接回答问题，基于知识图谱中的实际数据
2. 指出相关的核心概念（用【概念名】标注）
3. 如有治理风险，重点说明
4. 回答简洁有深度，100-200字

最后输出一行，格式为：HIGHLIGHT:concept_id1,concept_id2（列出回答中涉及的概念id，逗号分隔）`, string(ontologyJSON), req.Query)

	content, err := callAIService(aiConfig, prompt)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "AI调用失败: " + err.Error()})
		return
	}

	// 解析 HIGHLIGHT 行
	answer := content
	var highlighted []string
	if idx := strings.LastIndex(content, "HIGHLIGHT:"); idx >= 0 {
		answer = strings.TrimSpace(content[:idx])
		ids := strings.TrimSpace(content[idx+10:])
		for _, id := range strings.Split(ids, ",") {
			id = strings.TrimSpace(id)
			if id != "" {
				highlighted = append(highlighted, id)
			}
		}
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"answer":      answer,
		"highlighted": highlighted,
	})
}

// handleAICompletion 通用 AI 补全，供治理任务等调用（使用与 AI 助手相同的配置）
func handleAICompletion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持 POST"})
		return
	}
	var req AICompletionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}
	if req.Prompt == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "prompt 不能为空"})
		return
	}
	dataOntologyMu.RLock()
	aiConfig := dataOntologyAIConfig
	dataOntologyMu.RUnlock()
	if aiConfig == nil || aiConfig.URL == "" || aiConfig.APIKey == "" || aiConfig.Model == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请先在 AI 助手中配置 AI 设置（URL、API Key、模型）"})
		return
	}
	content, err := callAIService(aiConfig, req.Prompt)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "AI 调用失败: " + err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "content": content})
}

// handleGovernanceShareAICompletion 分享任务专用 AI 调用（免授权）
func handleGovernanceShareAICompletion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	// 分享任务通过 URL 中的 share_token 验证，无需用户 token
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持 POST"})
		return
	}
	var req AICompletionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}
	if req.Prompt == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "prompt 不能为空"})
		return
	}
	dataOntologyMu.RLock()
	aiConfig := dataOntologyAIConfig
	dataOntologyMu.RUnlock()
	if aiConfig == nil || aiConfig.URL == "" || aiConfig.APIKey == "" || aiConfig.Model == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请先在 AI 助手中配置 AI 设置（URL、API Key、模型）"})
		return
	}
	content, err := callAIService(aiConfig, req.Prompt)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "AI 调用失败: " + err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "content": content})
}

// isCreateApiRequest 检测是否是创建接口的请求
func isCreateApiRequest(message string) bool {
	keywords := []string{"创建接口", "新建接口", "生成接口", "添加接口", "帮我写接口", "帮我创建", "生成API", "创建API"}
	lowerMessage := strings.ToLower(message)
	for _, keyword := range keywords {
		if strings.Contains(lowerMessage, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}

// isValidApiPath 验证 API 路径格式：必须是 /api/xxx/yyy（两级路径）
func isValidApiPath(path string) bool {
	// 去除首尾空格
	path = strings.TrimSpace(path)

	// 拒绝路径中包含空格
	if strings.Contains(path, " ") {
		return false
	}

	// 路径必须以 /api/ 开头
	if !strings.HasPrefix(path, "/api/") {
		return false
	}
	// 去掉 /api/ 前缀后，必须有两级路径（xxx/yyy）
	rest := strings.TrimPrefix(path, "/api/")
	parts := strings.Split(rest, "/")
	// 必须有两部分，且每部分不为空
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return false
	}
	return true
}

// IntentInfo 意图检测结果
type IntentInfo struct {
	DetectedModule string  `json:"detected_module,omitempty"`
	Confidence     float64 `json:"confidence"`
	Reason         string  `json:"reason"`
}

// detectUserIntent 检测用户意图，返回意图信息和置信度
func detectUserIntent(message string) IntentInfo {
	lowerMsg := strings.ToLower(message)

	// 接口创建关键词（高置信度）
	apiKeywords := []string{"创建接口", "新建接口", "生成接口", "添加接口", "帮我写接口", "生成api", "创建api", "添加api"}
	for _, kw := range apiKeywords {
		if strings.Contains(lowerMsg, strings.ToLower(kw)) {
			return IntentInfo{DetectedModule: "api-dispatch", Confidence: 0.95, Reason: "包含接口创建关键词: " + kw}
		}
	}

	// 数据治理关键词
	governanceKeywords := []string{"创建任务", "新建任务", "生成任务", "定时任务", "交互任务", "数据治理", "定时执行", "文件导入"}
	for _, kw := range governanceKeywords {
		if strings.Contains(lowerMsg, strings.ToLower(kw)) {
			return IntentInfo{DetectedModule: "data-governance", Confidence: 0.9, Reason: "包含数据治理关键词: " + kw}
		}
	}

	// 质量审计关键词
	qualityKeywords := []string{"质量规则", "数据质量", "质量检查", "质量审计", "校验规则"}
	for _, kw := range qualityKeywords {
		if strings.Contains(lowerMsg, strings.ToLower(kw)) {
			return IntentInfo{DetectedModule: "quality-audit", Confidence: 0.9, Reason: "包含质量审计关键词: " + kw}
		}
	}

	// 本体查询关键词
	ontologyKeywords := []string{"本体", "概念", "实体关系", "语义"}
	for _, kw := range ontologyKeywords {
		if strings.Contains(lowerMsg, strings.ToLower(kw)) {
			return IntentInfo{DetectedModule: "ontology", Confidence: 0.85, Reason: "包含本体相关关键词: " + kw}
		}
	}

	// 小模型关键词
	smallModelKeywords := []string{"小模型", "本地模型", "离线模型"}
	for _, kw := range smallModelKeywords {
		if strings.Contains(lowerMsg, strings.ToLower(kw)) {
			return IntentInfo{DetectedModule: "small-model", Confidence: 0.85, Reason: "包含小模型关键词: " + kw}
		}
	}

	// 询问数据库信息（中等置信度）
	dbInfoKeywords := []string{"有哪些表", "什么表", "表结构", "字段有哪些", "数据库里有什么"}
	for _, kw := range dbInfoKeywords {
		if strings.Contains(lowerMsg, strings.ToLower(kw)) {
			return IntentInfo{DetectedModule: "db-manage", Confidence: 0.8, Reason: "包含数据库查询关键词: " + kw}
		}
	}

	// 通用查询关键词（低置信度）
	queryKeywords := []string{"查询", "统计", "有多少", "列出", "显示", "查找", "搜索"}
	for _, kw := range queryKeywords {
		if strings.Contains(lowerMsg, strings.ToLower(kw)) {
			return IntentInfo{DetectedModule: "db-manage", Confidence: 0.5, Reason: "包含通用查询关键词: " + kw}
		}
	}

	// 未检测到明确意图
	return IntentInfo{DetectedModule: "", Confidence: 0.0, Reason: "未检测到明确意图"}
}

// detectIntentWithAI 使用 AI 进行意图分类
func detectIntentWithAI(config *AIConfig, capabilities *AICapabilities, message string) IntentInfo {
	prompt := `你是一个意图分类助手。分析用户消息，判断用户想要做什么操作。

可选操作类型：
1. api-dispatch - 创建 API 接口、生成数据服务
2. data-governance - 创建定时任务、数据导入导出、数据处理
3. quality-audit - 数据质量检查、校验规则
4. ontology - 本体查询、概念关系、语义分析
5. small-model - 小模型相关、本地模型、离线推理
6. db-manage - 通用数据查询、统计、了解表结构

用户消息：` + message + `

请只返回一个 JSON 对象，格式如下：
{"module": "操作类型ID", "confidence": 0.95, "reason": "判断理由"}

confidence 范围 0-1，表示置信度。如果不确定，confidence 设为较低值。`

	// 调用 AI
	response, err := callAIServiceWithCapabilities(config, capabilities, prompt)
	if err != nil {
		log.Printf("[AI Intent] AI 调用失败: %v", err)
		return IntentInfo{DetectedModule: "", Confidence: 0.0, Reason: "AI 调用失败: " + err.Error()}
	}

	// 解析 JSON
	response = strings.TrimSpace(response)
	// 去除可能的 markdown 代码块
	if strings.HasPrefix(response, "```") {
		lines := strings.Split(response, "\n")
		var jsonLines []string
		inBlock := false
		for _, line := range lines {
			if strings.HasPrefix(line, "```") {
				inBlock = !inBlock
				continue
			}
			if inBlock {
				jsonLines = append(jsonLines, line)
			}
		}
		response = strings.Join(jsonLines, "\n")
	}

	var result struct {
		Module     string  `json:"module"`
		Confidence float64 `json:"confidence"`
		Reason     string  `json:"reason"`
	}

	if err := json.Unmarshal([]byte(response), &result); err != nil {
		log.Printf("[AI Intent] JSON 解析失败: %v, response: %s", err, response)
		return IntentInfo{DetectedModule: "", Confidence: 0.0, Reason: "JSON 解析失败"}
	}

	// 验证模块是否有效
	validModules := map[string]bool{
		"api-dispatch":    true,
		"data-governance": true,
		"quality-audit":   true,
		"ontology":        true,
		"small-model":     true,
		"db-manage":       true,
	}

	if !validModules[result.Module] {
		log.Printf("[AI Intent] 无效模块: %s", result.Module)
		return IntentInfo{DetectedModule: "", Confidence: 0.0, Reason: "无效模块: " + result.Module}
	}

	log.Printf("[AI Intent] AI 分类结果: module=%s, confidence=%.2f, reason=%s", result.Module, result.Confidence, result.Reason)
	return IntentInfo{
		DetectedModule: result.Module,
		Confidence:     result.Confidence,
		Reason:         result.Reason,
	}
}

// isGovernanceTaskRequest 检测是否是数据治理任务相关请求（创建/生成/修改 定时或交互任务）
func isGovernanceTaskRequest(message string) bool {
	keywords := []string{
		"创建任务", "新建任务", "生成任务", "添加任务", "帮我创建任务", "帮我生成任务",
		"定时任务", "交互任务", "定时执行", "按计划执行", "上传文件处理", "文件导入",
		"修改任务", "更新任务", "改一下任务",
	}
	lowerMessage := strings.ToLower(message)
	for _, keyword := range keywords {
		if strings.Contains(lowerMessage, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}

// governanceTaskDraft 供前端确认的数据治理任务草稿（与 GovernanceTask 字段对齐，无 id/created_at 等）
type governanceTaskDraft struct {
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	Description string   `json:"description,omitempty"`
	JsCode      string   `json:"js_code"`
	DatabaseID  string   `json:"database_id,omitempty"`
	CronExpr    string   `json:"cron_expr,omitempty"`
	InputType   string   `json:"input_type,omitempty"`
	AcceptExts  []string `json:"accept_exts,omitempty"`
	IsUpdate    bool     `json:"is_update,omitempty"`
	TaskID      string   `json:"task_id,omitempty"`
}

// buildGovernanceTaskPrompt 构建数据治理任务生成的提示词，包含任务约束
func buildGovernanceTaskPrompt(userMessage string, dbSchemas []map[string]interface{}) string {
	constraint := "\n【数据治理任务约束】你必须严格按以下规则生成任务，并只输出一个 JSON 对象（不要用 markdown 代码块包裹），不要其他解释。\n\n"
	constraint += "1. 任务类型 type 只能是 \"scheduled\"（定时任务）或 \"interactive\"（交互任务）。\n"
	constraint += "2. 定时任务：必须包含 cron_expr，格式为 \"分 时 日 月 周\"（五段，空格分隔），例如 \"0 2 * * *\" 表示每天凌晨2点，\"30 8 * * 1-5\" 表示工作日 8:30。\n"
	constraint += "3. 交互任务：必须包含 input_type（\"file\" | \"text\" | \"both\"）和 accept_exts（数组，如 [\".xlsx\", \".csv\", \".docx\"]）。\n"
	constraint += "4. js_code 必须是可运行的 JavaScript 代码。运行环境提供：\n"
	constraint += "   - gov.log(msg)、gov.readExcel(file)、gov.readCSV(csvText)、gov.querySQL(sql)、gov.executeSQL(sql)\n"
	constraint += "   - INPUT_FILE（File 对象，交互任务文件上传时）、INPUT_TEXT（字符串，交互任务文本输入时）\n"
	constraint += "   - XLSX、Papa、mammoth 等库。只输出代码，不要用 ``` 包裹。\n"
	constraint += "5. 输出 JSON 字段：name（必填）、type（必填）、description（可选）、js_code（必填）、database_id（可选，从下面数据库 id 中选）、cron_expr（定时必填）、input_type（交互必填）、accept_exts（交互可选）。\n"
	prompt := "你是一个数据治理任务设计专家。用户希望根据需求生成或修改数据治理任务（定时任务或交互任务）。\n"
	prompt += constraint
	if len(dbSchemas) > 0 {
		prompt += "\n【可选数据库】当前对话关联的数据库 id 与名称：\n"
		for _, s := range dbSchemas {
			id, _ := s["id"].(string)
			name, _ := s["name"].(string)
			prompt += fmt.Sprintf("  - id: %q, name: %s\n", id, name)
		}
		prompt += "若任务需要写库或查库，请将 database_id 设为上述之一。\n"
	}
	prompt += "\n用户需求：\n" + userMessage
	prompt += "\n\n请只输出一个 JSON 对象，包含 name, type, description, js_code, database_id（如需）, cron_expr（定时任务）, input_type 与 accept_exts（交互任务）。不要 markdown，不要解释。"
	return prompt
}

// parseGovernanceTaskDraft 从 AI 回复中解析任务草稿并做约束校验
func parseGovernanceTaskDraft(aiResponse string, defaultDBID string) (*governanceTaskDraft, string) {
	// 提取 JSON：去除 markdown 代码块
	s := strings.TrimSpace(aiResponse)
	for _, prefix := range []string{"```json", "```javascript", "```js", "```"} {
		if strings.HasPrefix(s, prefix) {
			s = s[len(prefix):]
			break
		}
	}
	if idx := strings.Index(s, "```"); idx >= 0 {
		s = s[:idx]
	}
	s = strings.TrimSpace(s)

	var draft governanceTaskDraft
	if err := json.Unmarshal([]byte(s), &draft); err != nil {
		return nil, "JSON 解析失败: " + err.Error()
	}
	if draft.Name == "" {
		return nil, "任务名称 name 不能为空"
	}
	if draft.Type != "scheduled" && draft.Type != "interactive" {
		return nil, "type 必须是 scheduled 或 interactive"
	}
	if draft.JsCode == "" {
		return nil, "js_code 不能为空"
	}
	if draft.Type == "scheduled" {
		parts := strings.Fields(draft.CronExpr)
		if len(parts) != 5 {
			return nil, "定时任务 cron_expr 必须为五段：分 时 日 月 周"
		}
	}
	if draft.Type == "interactive" {
		if draft.InputType != "file" && draft.InputType != "text" && draft.InputType != "both" {
			draft.InputType = "file"
		}
		if draft.AcceptExts == nil {
			draft.AcceptExts = []string{".xlsx", ".csv"}
		}
	}
	if draft.DatabaseID == "" && defaultDBID != "" {
		draft.DatabaseID = defaultDBID
	}
	return &draft, ""
}

// handleAIGovernanceTask 处理 @数据治理 时的 AI 生成任务草稿，供用户确认后创建或更新
func handleAIGovernanceTask(w http.ResponseWriter, flusher http.Flusher, queryReq *AIQueryRequest, dbSchemas []map[string]interface{}, aiConfig *AIConfig) {
	if !isGovernanceTaskRequest(queryReq.Message) {
		sendSSE(w, "error", map[string]interface{}{
			"message": "请说明要创建或修改的数据治理任务需求，例如：创建定时任务每天凌晨导入、或创建一个上传 Excel 的交互任务。",
		})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	sendSSE(w, "thinking", map[string]interface{}{
		"message": "正在根据您的需求生成数据治理任务草稿（已加入任务约束）...",
	})
	flusher.Flush()

	prompt := buildGovernanceTaskPrompt(queryReq.Message, dbSchemas)
	aiResponse, err := callAIService(aiConfig, prompt)
	if err != nil {
		sendSSE(w, "error", map[string]interface{}{
			"message": "AI 服务调用失败: " + err.Error(),
		})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	defaultDBID := ""
	if len(queryReq.Databases) > 0 {
		defaultDBID = queryReq.Databases[0]
	}
	draft, parseErr := parseGovernanceTaskDraft(aiResponse, defaultDBID)
	if draft == nil {
		sendSSE(w, "error", map[string]interface{}{
			"message":  "未能生成有效任务草稿。" + parseErr,
			"response": aiResponse,
		})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	sendSSE(w, "governance_task_draft", map[string]interface{}{
		"message": "已根据您的需求生成任务草稿，请确认或编辑后再创建/更新。",
		"task":    draft,
	})
	sendSSE(w, "done", map[string]interface{}{})
	flusher.Flush()
}

// handleAIQualityRule 处理AI创建数据质量审核规则
func handleAIQualityRule(w http.ResponseWriter, flusher http.Flusher, queryReq *AIQueryRequest, dbSchemas []map[string]interface{}, aiConfig *AIConfig) {
	sendSSE(w, "thinking", map[string]interface{}{
		"message": "正在根据您的需求生成数据质量审核规则...",
	})
	flusher.Flush()

	prompt := "你是数据质量审核专家。用户需要创建数据质量审核规则，请根据用户需求和以下数据库结构生成规则配置。\n\n"
	prompt += "数据库结构：\n"
	for _, schema := range dbSchemas {
		prompt += fmt.Sprintf("- 数据库: %s (类型: %s)\n", schema["name"], schema["type"])
		if tables, ok := schema["tables"].([]map[string]interface{}); ok {
			for _, t := range tables {
				prompt += fmt.Sprintf("  - 表: %s\n", t["name"])
			}
		}
	}
	prompt += "\n用户需求：" + queryReq.Message + "\n\n"
	prompt += "请生成规则配置，JSON格式：\n"
	prompt += "```json\n"
	prompt += "{\n"
	prompt += "  \"nm\": \"010101\",\n"
	prompt += "  \"xh\": \"0101\",\n"
	prompt += "  \"name\": \"规则名称\",\n"
	prompt += "  \"category\": \"完整性\",\n"
	prompt += "  \"sql\": \"SELECT * FROM table WHERE field IS NULL\"\n"
	prompt += "}\n"
	prompt += "```\n\n"
	prompt += "规则说明：\n"
	prompt += "- nm: 6位规则编号\n"
	prompt += "- xh: 层级编码\n"
	prompt += "- sql: 查询违规数据的SQL（返回违规记录）\n"

	aiResponse, err := callAIService(aiConfig, prompt)
	if err != nil {
		sendSSE(w, "error", map[string]interface{}{"message": "AI服务调用失败: " + err.Error()})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	jsonStart := strings.Index(aiResponse, "{")
	jsonEnd := strings.LastIndex(aiResponse, "}")
	if jsonStart == -1 || jsonEnd == -1 || jsonEnd <= jsonStart {
		sendSSE(w, "error", map[string]interface{}{"message": "未能解析规则配置", "response": aiResponse})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	jsonStr := extractJSONObject(aiResponse[jsonStart : jsonEnd+1])
	if jsonStr == "" {
		jsonStr = cleanAIResponse(aiResponse[jsonStart : jsonEnd+1])
	}
	jsonStr = extractJSONObject(jsonStr)
	var rule map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &rule); err != nil {
		sendSSE(w, "error", map[string]interface{}{"message": "JSON解析失败: " + err.Error(), "response": aiResponse})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	sendSSE(w, "quality_rule_draft", map[string]interface{}{
		"message": "已生成数据质量审核规则，请确认后创建。",
		"rule":    rule,
	})
	sendSSE(w, "done", map[string]interface{}{})
	flusher.Flush()
}

// handleAISmallModel 处理AI创建小模型
func handleAISmallModel(w http.ResponseWriter, flusher http.Flusher, queryReq *AIQueryRequest, dbSchemas []map[string]interface{}, aiConfig *AIConfig) {
	sendSSE(w, "thinking", map[string]interface{}{
		"message": "正在根据您的需求生成小模型配置...",
	})
	flusher.Flush()

	prompt := "你是数据处理专家。用户需要创建一个小模型（JavaScript 数据处理函数），请根据用户需求生成配置。\n\n"
	prompt += "用户需求：" + queryReq.Message + "\n\n"
	prompt += "请生成小模型配置，JSON格式：\n"
	prompt += "```json\n"
	prompt += "{\n"
	prompt += "  \"name\": \"模型名称\",\n"
	prompt += "  \"description\": \"模型描述\",\n"
	prompt += "  \"input_type\": \"json\",\n"
	prompt += "  \"output_type\": \"json\",\n"
	prompt += "  \"js_code\": \"async function run(input) { return input; }\"\n"
	prompt += "}\n"
	prompt += "```\n\n"
	prompt += "说明：\n"
	prompt += "- js_code: 异步函数，接收 input 参数，返回处理结果\n"
	prompt += "- input_type/output_type: json/text/number\n"

	aiResponse, err := callAIService(aiConfig, prompt)
	if err != nil {
		sendSSE(w, "error", map[string]interface{}{"message": "AI服务调用失败: " + err.Error()})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	jsonStart := strings.Index(aiResponse, "{")
	jsonEnd := strings.LastIndex(aiResponse, "}")
	if jsonStart == -1 || jsonEnd == -1 {
		sendSSE(w, "error", map[string]interface{}{"message": "未能解析配置", "response": aiResponse})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	jsonStr := extractJSONObject(aiResponse[jsonStart : jsonEnd+1])
	if jsonStr == "" {
		jsonStr = cleanAIResponse(aiResponse[jsonStart : jsonEnd+1])
	}
	var model map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &model); err != nil {
		sendSSE(w, "error", map[string]interface{}{"message": "JSON解析失败: " + err.Error(), "response": aiResponse})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	sendSSE(w, "small_model_draft", map[string]interface{}{
		"message": "已生成小模型配置，请确认后创建。",
		"model":   model,
	})
	sendSSE(w, "done", map[string]interface{}{})
	flusher.Flush()
}

// handleAICreateApi 处理AI创建接口请求
func handleAICreateApi(w http.ResponseWriter, flusher http.Flusher, queryReq *AIQueryRequest, dbSchemas []map[string]interface{}, aiConfig *AIConfig, aiCapabilities *AICapabilities) {

	// 如果 dbSchemas 尚未增强（tables 还是 []string），则获取字段信息
	needEnhance := false
	if len(dbSchemas) > 0 {
		if _, ok := dbSchemas[0]["tables"].([]string); ok {
			needEnhance = true
		}
	}

	if needEnhance {
		sendSSE(w, "thinking", map[string]interface{}{
			"message": "正在读取数据库表结构信息...",
		})
		flusher.Flush()

		dataOntologyMu.RLock()
		for i, schema := range dbSchemas {
			dbID, _ := schema["id"].(string)
			dbConfig, exists := dataOntologyDatabases[dbID]
			if !exists {
				continue
			}

			tables, _ := schema["tables"].([]string)
			var tablesWithColumns []map[string]interface{}

			// 使用表检索逻辑筛选相关表
			defaultMaxTables := 10
			retrievalConfig := aiConfig.TableRetrieval
			relevantTables, err := retrieveRelevantTables(queryReq.Message, dbConfig, retrievalConfig)
			if err != nil {
				log.Printf("表检索失败: %v, 使用前 %d 张表", err, defaultMaxTables)
				// 降级：截取前 N 张表
				if len(tables) > defaultMaxTables {
					tables = tables[:defaultMaxTables]
				}
				for _, tableName := range tables {
					columns, err := getTableColumns(dbConfig, tableName)
					if err != nil {
						log.Printf("获取表 %s 字段失败: %v", tableName, err)
						tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
							"name":    tableName,
							"columns": []map[string]interface{}{},
						})
						continue
					}

					tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
						"name":    tableName,
						"columns": columns,
					})
				}
			} else {
				// 使用检索结果
				log.Printf("[表检索] 检索到 %d 张相关表", len(relevantTables))
				for _, result := range relevantTables {
					tableName := result.TableName
					columns, err := getTableColumns(dbConfig, tableName)
					if err != nil {
						log.Printf("获取表 %s 字段失败: %v", tableName, err)
						tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
							"name":    tableName,
							"columns": []map[string]interface{}{},
						})
						continue
					}

					tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
						"name":    tableName,
						"columns": columns,
					})
				}
			}

			dbSchemas[i]["tables"] = tablesWithColumns
		}
		dataOntologyMu.RUnlock()
	}

	sendSSE(w, "thinking", map[string]interface{}{
		"message": "正在分析您的需求并生成接口配置...",
	})
	flusher.Flush()

	// 获取已有接口列表，用于路径唯一性校验和分类参考
	dataOntologyMu.RLock()
	existingApis := make([]map[string]interface{}, 0, len(dataOntologyApis))
	for _, api := range dataOntologyApis {
		existingApis = append(existingApis, map[string]interface{}{
			"name":   api.Name,
			"path":   api.Path,
			"method": api.Method,
		})
	}
	dataOntologyMu.RUnlock()

	// 构建创建接口的提示词
	prompt := buildCreateApiPrompt(queryReq.Message, dbSchemas, existingApis)

	// 重试机制：最多重试3次
	maxRetries := 3
	var apiConfig map[string]interface{}

	for attempt := 1; attempt <= maxRetries; attempt++ {
		// 调用AI服务
		aiResponse, err := callAIServiceWithCapabilities(aiConfig, aiCapabilities, prompt)
		if err != nil {
			sendSSE(w, "error", map[string]interface{}{
				"message": "AI服务调用失败: " + err.Error(),
			})
			sendSSE(w, "done", map[string]interface{}{})
			flusher.Flush()
			return
		}

		// 解析AI返回的接口配置
		var parseError string
		apiConfig, parseError = parseApiConfigFromAI(aiResponse, dbSchemas)
		if apiConfig == nil {
			log.Printf("解析接口配置失败（第%d次尝试），AI响应: %s", attempt, aiResponse)
			if parseError != "" {
				log.Printf("解析错误: %s", parseError)
			}
			// 解析失败，构建重试提示词
			if attempt < maxRetries {
				prompt = buildCreateApiRetryPrompt(queryReq.Message, dbSchemas, existingApis, "无法解析接口配置: "+parseError, aiResponse)
				continue
			}
			// 最后一次尝试仍然失败
			sendSSE(w, "error", map[string]interface{}{
				"message":  "AI未能生成有效的接口配置。" + parseError,
				"response": aiResponse,
			})
			sendSSE(w, "done", map[string]interface{}{})
			flusher.Flush()
			return
		}

		// 校验 path 格式和 path+method 唯一性
		pathStr, _ := apiConfig["path"].(string)
		methodStr, _ := apiConfig["method"].(string)

		// 校验路径格式
		if !isValidApiPath(pathStr) {
			log.Printf("路径格式校验失败（第%d次尝试）: %s 不是有效的两级路径", attempt, pathStr)
			if attempt < maxRetries {
				prompt = buildCreateApiRetryPrompt(queryReq.Message, dbSchemas, existingApis,
					fmt.Sprintf("接口路径格式错误: '%s' 不是有效的两级路径格式。必须是 /api/xxx/yyy 格式，例如 /api/users/list", pathStr), aiResponse)
				continue
			}
			sendSSE(w, "error", map[string]interface{}{
				"message":  fmt.Sprintf("路径格式校验失败（已重试%d次）: %s 不是有效的两级路径格式", maxRetries, pathStr),
				"response": aiResponse,
			})
			sendSSE(w, "done", map[string]interface{}{})
			flusher.Flush()
			return
		}

		// 校验 path+method 唯一性
		pathConflict := false
		var conflictApiName string
		for _, existingApi := range existingApis {
			existingPath, _ := existingApi["path"].(string)
			existingMethod, _ := existingApi["method"].(string)
			if existingPath == pathStr && strings.EqualFold(existingMethod, methodStr) {
				pathConflict = true
				conflictApiName, _ = existingApi["name"].(string)
				break
			}
		}
		if pathConflict {
			log.Printf("路径唯一性校验失败（第%d次尝试）: %s %s 与已有接口 '%s' 冲突", attempt, methodStr, pathStr, conflictApiName)
			if attempt < maxRetries {
				prompt = buildCreateApiRetryPrompt(queryReq.Message, dbSchemas, existingApis,
					fmt.Sprintf("接口路径冲突: %s %s 已被接口 '%s' 使用，请使用不同的路径或方法", methodStr, pathStr, conflictApiName), aiResponse)
				continue
			}
			sendSSE(w, "error", map[string]interface{}{
				"message":  fmt.Sprintf("路径唯一性校验失败（已重试%d次）: %s %s 已存在", maxRetries, methodStr, pathStr),
				"response": aiResponse,
			})
			sendSSE(w, "done", map[string]interface{}{})
			flusher.Flush()
			return
		}

		log.Printf("路径校验成功（第%d次尝试）: %s %s", attempt, methodStr, pathStr)

		// 校验SQL中的表名和字段名是否存在
		sqlStr, _ := apiConfig["sql"].(string)
		if sqlStr != "" && len(dbSchemas) > 0 {
			// 静态校验：检查表名和字段名
			valid, validationError := validateSQLTablesAndFields(sqlStr, dbSchemas)
			if !valid {
				log.Printf("SQL静态校验失败（第%d次尝试）: %s", attempt, validationError)
				// 验证失败，构建重试提示词
				if attempt < maxRetries {
					prompt = buildCreateApiRetryPrompt(queryReq.Message, dbSchemas, existingApis, validationError, aiResponse)
					continue
				}
				// 最后一次尝试仍然失败
				sendSSE(w, "sql_validation_error", map[string]interface{}{
					"message":  "SQL静态校验失败（已重试" + fmt.Sprintf("%d", maxRetries) + "次）: " + validationError,
					"sql":      sqlStr,
					"response": aiResponse,
				})
				sendSSE(w, "done", map[string]interface{}{})
				flusher.Flush()
				return
			}
			log.Printf("SQL静态校验成功（第%d次尝试）", attempt)

			// 执行校验：在目标数据库上实际执行SQL，检查语法、权限、函数等运行时问题
			dbID, _ := dbSchemas[0]["id"].(string)
			if dbID != "" {
				sendSSE(w, "thinking", map[string]interface{}{
					"message": "正在执行SQL校验...",
				})
				flusher.Flush()

				validExec, execError := validateSQLByExecution(sqlStr, dbID)
				if !validExec {
					log.Printf("SQL执行校验失败（第%d次尝试）: %s", attempt, execError)
					// 执行校验失败，构建重试提示词
					if attempt < maxRetries {
						prompt = buildCreateApiRetryPrompt(queryReq.Message, dbSchemas, existingApis, execError, aiResponse)
						continue
					}
					// 最后一次尝试仍然失败
					sendSSE(w, "sql_validation_error", map[string]interface{}{
						"message":  "SQL执行校验失败（已重试" + fmt.Sprintf("%d", maxRetries) + "次）: " + execError,
						"sql":      sqlStr,
						"response": aiResponse,
					})
					sendSSE(w, "done", map[string]interface{}{})
					flusher.Flush()
					return
				}
				log.Printf("SQL执行校验成功（第%d次尝试）", attempt)
			}
		}

		// 验证成功，跳出重试循环
		break
	}

	// 从数据库表中查询实际值填充 default_params
	if len(dbSchemas) > 0 {
		dbID, _ := dbSchemas[0]["id"].(string)
		populateDefaultParamsFromDB(apiConfig, dbID)
	}

	// 返回接口配置供用户确认
	sendSSE(w, "api_config_generated", map[string]interface{}{
		"message": "已生成接口配置，请确认后创建",
		"config":  apiConfig,
	})
	sendSSE(w, "done", map[string]interface{}{})
	flusher.Flush()
}

// buildCreateApiPrompt 构建创建接口的提示词
func buildCreateApiPrompt(userMessage string, dbSchemas []map[string]interface{}, existingApis []map[string]interface{}) string {
	prompt := "你是一个API接口设计专家。用户需要创建一个数据库查询接口，请根据用户需求和以下真实数据库结构生成接口配置。\n\n"
	prompt += "【重要】以下是真实的数据库结构信息，请严格基于这些表和字段生成SQL：\n\n"

	for _, schema := range dbSchemas {
		prompt += fmt.Sprintf("数据库: %s (类型: %s)\n", schema["name"], schema["type"])
		prompt += "=" + strings.Repeat("=", 60) + "\n"

		// 处理新格式（包含字段信息）
		if tables, ok := schema["tables"].([]map[string]interface{}); ok {
			for _, table := range tables {
				tableName := table["name"].(string)
				prompt += fmt.Sprintf("\n表名: %s\n", tableName)

				if columns, ok := table["columns"].([]map[string]interface{}); ok && len(columns) > 0 {
					prompt += "字段列表:\n"
					for _, col := range columns {
						colName := col["name"]
						colType := col["type"]
						prompt += fmt.Sprintf("  - %s (%s)\n", colName, colType)
					}
				} else {
					prompt += "  （无法获取字段信息）\n"
				}
			}
		} else if tables, ok := schema["tables"].([]string); ok {
			// 兼容旧格式（只有表名）
			prompt += "表列表: " + strings.Join(tables, ", ") + "\n"
		}
		prompt += "\n"
	}

	// 添加已有接口信息
	if len(existingApis) > 0 {
		prompt += "\n【已有接口列表】\n"
		prompt += "以下是系统中已存在的接口，供您参考：\n\n"
		for i, api := range existingApis {
			name, _ := api["name"].(string)
			path, _ := api["path"].(string)
			method, _ := api["method"].(string)
			prompt += fmt.Sprintf("%d. %s - %s %s\n", i+1, name, method, path)
		}
		prompt += "\n【重要提示】\n"
		prompt += "1. 新接口的 path + method 组合不能与已有接口重复\n"
		prompt += "2. 请分析新接口是否属于某个已有的一级分类（path中的 /api/xxx/ 部分）\n"
		prompt += "   - 如果属于已有分类，请使用相同的一级分类路径\n"
		prompt += "   - 如果不属于已有分类，可以创建新的一级分类\n"
		prompt += "3. 例如：已有 /api/users/list，新接口可以是 /api/users/detail（属于同一分类）\n"
		prompt += "         或创建新分类 /api/products/list（属于不同分类）\n\n"
	} else {
		prompt += "\n【已有接口列表】\n"
		prompt += "当前系统中暂无已有接口，您可以创建第一个接口。\n\n"
	}

	prompt += "\n用户需求：" + userMessage + "\n\n"
	prompt += "请生成接口配置，必须包含以下信息：\n"
	prompt += "1. name: 接口名称（中文，简洁明了）\n"
	prompt += "2. path: 接口路径（以/api/开头，使用RESTful风格，全部小写）\n"
	prompt += "3. method: 请求方法（GET/POST/PUT/DELETE，全部大写）\n"
	prompt += "4. sql: SQL查询语句（支持MyBatis语法，使用#{param}表示参数）\n"
	prompt += "5. description: 接口描述\n"
	prompt += "6. default_params: 默认参数值（用于测试，JSON对象）\n\n"
	prompt += "请按以下JSON格式返回：\n"
	prompt += "```json\n"
	prompt += "{\n"
	prompt += "  \"name\": \"获取用户列表\",\n"
	prompt += "  \"path\": \"/api/users\",\n"
	prompt += "  \"method\": \"GET\",\n"
	prompt += "  \"sql\": \"SELECT * FROM users WHERE status = #{status} LIMIT #{limit}\",\n"
	prompt += "  \"description\": \"查询指定状态的用户列表\",\n"
	prompt += "  \"default_params\": {\n"
	prompt += "    \"status\": \"active\",\n"
	prompt += "    \"limit\": 10\n"
	prompt += "  }\n"
	prompt += "}\n"
	prompt += "```\n\n"
	prompt += "【重要规则】：\n"
	prompt += "1. SQL只能有一条语句\n"
	prompt += "2. 使用#{参数名}表示预编译参数（推荐），使用${参数名}表示直接替换\n"
	prompt += "3. 接口路径要符合RESTful规范（如 /api/users, /api/products/list）\n"
	prompt += "4. 根据操作类型选择正确的HTTP方法（查询用GET，创建用POST，更新用PUT，删除用DELETE）\n"
	prompt += "5. **必须使用上面列出的真实表名和字段名**，不要使用不存在的表或字段\n"
	prompt += "6. 必须为SQL中的每个参数提供合理的默认值用于测试\n"
	prompt += "7. 默认值要符合字段类型和实际使用场景：\n"
	prompt += "   - 数字类型(int/bigint)：id一般为1，limit一般为10，page一般为1\n"
	prompt += "   - 字符串类型(varchar/text)：status一般为\"active\"，keyword为\"test\"\n"
	prompt += "   - 日期类型：使用\"2024-01-01\"格式\n"
	prompt += "8. 如果用户需求模糊，选择最相关的表和字段生成合理的查询"

	return prompt
}

// buildCreateApiRetryPrompt 构建重试提示词，告知AI之前的错误
func buildCreateApiRetryPrompt(userMessage string, dbSchemas []map[string]interface{}, existingApis []map[string]interface{}, errorMsg string, lastResponse string) string {
	prompt := "你之前的接口配置存在问题，请根据以下错误信息重新生成。\n\n"
	prompt += "【错误信息】\n"
	prompt += errorMsg + "\n\n"
	prompt += "【你之前的响应】\n"
	prompt += lastResponse + "\n\n"
	prompt += "【重要】以下是真实的数据库结构信息，请严格基于这些表和字段重新生成SQL：\n\n"

	for _, schema := range dbSchemas {
		prompt += fmt.Sprintf("数据库: %s (类型: %s)\n", schema["name"], schema["type"])
		prompt += "=" + strings.Repeat("=", 60) + "\n"

		// 处理新格式（包含字段信息）
		if tables, ok := schema["tables"].([]map[string]interface{}); ok {
			for _, table := range tables {
				tableName := table["name"].(string)
				prompt += fmt.Sprintf("\n表名: %s\n", tableName)

				if columns, ok := table["columns"].([]map[string]interface{}); ok && len(columns) > 0 {
					prompt += "字段列表:\n"
					for _, col := range columns {
						colName := col["name"]
						colType := col["type"]
						prompt += fmt.Sprintf("  - %s (%s)\n", colName, colType)
					}
				} else {
					prompt += "  （无法获取字段信息）\n"
				}
			}
		} else if tables, ok := schema["tables"].([]string); ok {
			// 兼容旧格式（只有表名）
			prompt += "表列表: " + strings.Join(tables, ", ") + "\n"
		}
		prompt += "\n"
	}

	// 添加已有接口信息
	if len(existingApis) > 0 {
		prompt += "\n【已有接口列表】\n"
		prompt += "以下是系统中已存在的接口，供您参考：\n\n"
		for i, api := range existingApis {
			name, _ := api["name"].(string)
			path, _ := api["path"].(string)
			method, _ := api["method"].(string)
			prompt += fmt.Sprintf("%d. %s - %s %s\n", i+1, name, method, path)
		}
		prompt += "\n【重要提示】\n"
		prompt += "1. 新接口的 path + method 组合不能与已有接口重复\n"
		prompt += "2. 请分析新接口是否属于某个已有的一级分类（path中的 /api/xxx/ 部分）\n"
		prompt += "   - 如果属于已有分类，请使用相同的一级分类路径\n"
		prompt += "   - 如果不属于已有分类，可以创建新的一级分类\n"
		prompt += "3. 例如：已有 /api/users/list，新接口可以是 /api/users/detail（属于同一分类）\n"
		prompt += "         或创建新分类 /api/products/list（属于不同分类）\n\n"
	} else {
		prompt += "\n【已有接口列表】\n"
		prompt += "当前系统中暂无已有接口，您可以创建第一个接口。\n\n"
	}

	prompt += "\n原始用户需求：" + userMessage + "\n\n"
	prompt += "请修正错误，重新生成接口配置，必须包含以下信息：\n"
	prompt += "1. name: 接口名称（中文，简洁明了）\n"
	prompt += "2. path: 接口路径（以/api/开头，使用RESTful风格，全部小写）\n"
	prompt += "3. method: 请求方法（GET/POST/PUT/DELETE，全部大写）\n"
	prompt += "4. sql: SQL查询语句（支持MyBatis语法，使用#{param}表示参数）\n"
	prompt += "5. description: 接口描述\n"
	prompt += "6. default_params: 默认参数值（用于测试，JSON对象）\n\n"
	prompt += "请按以下JSON格式返回：\n"
	prompt += "```json\n"
	prompt += "{\n"
	prompt += "  \"name\": \"获取用户列表\",\n"
	prompt += "  \"path\": \"/api/users\",\n"
	prompt += "  \"method\": \"GET\",\n"
	prompt += "  \"sql\": \"SELECT * FROM users WHERE status = #{status} LIMIT #{limit}\",\n"
	prompt += "  \"description\": \"查询指定状态的用户列表\",\n"
	prompt += "  \"default_params\": {\n"
	prompt += "    \"status\": \"active\",\n"
	prompt += "    \"limit\": 10\n"
	prompt += "  }\n"
	prompt += "}\n"
	prompt += "```\n\n"
	prompt += "【重要规则】：\n"
	prompt += "1. SQL只能有一条语句\n"
	prompt += "2. 使用#{参数名}表示预编译参数（推荐），使用${参数名}表示直接替换\n"
	prompt += "3. 接口路径要符合RESTful规范（如 /api/users, /api/products/list）\n"
	prompt += "4. 根据操作类型选择正确的HTTP方法（查询用GET，创建用POST，更新用PUT，删除用DELETE）\n"
	prompt += "5. **必须使用上面列出的真实表名和字段名**，不要使用不存在的表或字段\n"
	prompt += "6. 必须为SQL中的每个参数提供合理的默认值用于测试\n"
	prompt += "7. 默认值要符合字段类型和实际使用场景：\n"
	prompt += "   - 数字类型(int/bigint)：id一般为1，limit一般为10，page一般为1\n"
	prompt += "   - 字符串类型(varchar/text)：status一般为\"active\"，keyword为\"test\"\n"
	prompt += "   - 日期类型：使用\"2024-01-01\"格式\n"
	prompt += "8. 如果用户需求模糊，选择最相关的表和字段生成合理的查询\n"
	prompt += "9. **仔细检查你的SQL，确保所有表名和字段名都存在于上面的列表中**"

	return prompt
}

// parseApiConfigFromAI 从AI响应中解析接口配置
func parseApiConfigFromAI(response string, dbSchemas []map[string]interface{}) (map[string]interface{}, string) {
	// 提取JSON代码块
	jsonStart := strings.Index(response, "```json")
	jsonBlockOffset := 0
	if jsonStart != -1 {
		jsonBlockOffset = len("```json")
	} else {
		jsonStart = strings.Index(response, "```")
		if jsonStart != -1 {
			jsonBlockOffset = len("```")
		}
	}

	if jsonStart == -1 {
		// 尝试直接解析整个响应作为JSON
		var config map[string]interface{}
		if err := json.Unmarshal([]byte(response), &config); err == nil {
			// 添加数据库ID
			if len(dbSchemas) > 0 {
				if id, ok := dbSchemas[0]["id"].(string); ok {
					config["database_id"] = id
				}
			}
			return config, ""
		}
		// 尝试提取 { } 包裹的 JSON 对象
		objStart := strings.Index(response, "{")
		objEnd := strings.LastIndex(response, "}")
		if objStart != -1 && objEnd != -1 && objEnd > objStart {
			jsonStr := response[objStart : objEnd+1]
			if err := json.Unmarshal([]byte(jsonStr), &config); err == nil {
				if len(dbSchemas) > 0 {
					if id, ok := dbSchemas[0]["id"].(string); ok {
						config["database_id"] = id
					}
				}
				return config, ""
			}
		}
		return nil, "未找到JSON代码块，且响应内容无法直接解析为JSON"
	}

	// 找到代码块起始位置后的换行符
	newlineIdx := strings.Index(response[jsonStart+jsonBlockOffset:], "\n")
	if newlineIdx == -1 {
		return nil, "找到代码块标记但格式不正确"
	}
	contentStart := jsonStart + jsonBlockOffset + newlineIdx + 1

	// 找到代码块结束标记
	jsonEnd := strings.Index(response[contentStart:], "```")
	if jsonEnd == -1 {
		// 没有结束标记，尝试从 contentStart 解析到结尾
		jsonStr := strings.TrimSpace(response[contentStart:])
		var config map[string]interface{}
		if err := json.Unmarshal([]byte(jsonStr), &config); err == nil {
			if len(dbSchemas) > 0 {
				if id, ok := dbSchemas[0]["id"].(string); ok {
					config["database_id"] = id
				}
			}
			return config, ""
		}
		return nil, "找到代码块开始标记但未找到结束标记"
	}

	jsonStr := cleanAIResponse(strings.TrimSpace(response[contentStart : contentStart+jsonEnd]))
	jsonStr = extractJSONObject(jsonStr)
	if jsonStr == "" {
		jsonStr = strings.TrimSpace(response[contentStart : contentStart+jsonEnd])
	}

	var config map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &config); err != nil {
		return nil, fmt.Sprintf("JSON解析失败: %v，JSON内容: %s", err, jsonStr)
	}

	// 验证必需字段
	requiredFields := []string{"name", "path", "method", "sql"}
	for _, field := range requiredFields {
		if _, exists := config[field]; !exists {
			return nil, fmt.Sprintf("缺少必需字段: %s", field)
		}
	}

	// 标准化 path 和 method
	if path, ok := config["path"].(string); ok {
		config["path"] = strings.ToLower(strings.TrimSpace(path))
	}
	if method, ok := config["method"].(string); ok {
		config["method"] = strings.ToUpper(strings.TrimSpace(method))
	}

	// 添加数据库ID
	if len(dbSchemas) > 0 {
		if id, ok := dbSchemas[0]["id"].(string); ok {
			config["database_id"] = id
		}
	}

	return config, ""
}

// extractTablesFromSQL 从 SQL 中提取所有表名
// 支持 FROM table, JOIN table, FROM schema.table 等格式
func extractTablesFromSQL(sql string) []string {
	var tables []string
	seen := make(map[string]bool)

	// 匹配 FROM table_name
	fromPattern := regexp.MustCompile(`(?i)\bFROM\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)`)
	fromMatches := fromPattern.FindAllStringSubmatch(sql, -1)
	for _, match := range fromMatches {
		if len(match) > 1 {
			table := strings.Trim(match[1], `"`)
			if !seen[table] {
				tables = append(tables, table)
				seen[table] = true
			}
		}
	}

	// 匹配 JOIN table_name
	joinPattern := regexp.MustCompile(`(?i)\bJOIN\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)`)
	joinMatches := joinPattern.FindAllStringSubmatch(sql, -1)
	for _, match := range joinMatches {
		if len(match) > 1 {
			table := strings.Trim(match[1], `"`)
			if !seen[table] {
				tables = append(tables, table)
				seen[table] = true
			}
		}
	}

	// 匹配 UPDATE table_name
	updatePattern := regexp.MustCompile(`(?i)\bUPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)`)
	updateMatches := updatePattern.FindAllStringSubmatch(sql, -1)
	for _, match := range updateMatches {
		if len(match) > 1 {
			table := strings.Trim(match[1], `"`)
			if !seen[table] {
				tables = append(tables, table)
				seen[table] = true
			}
		}
	}

	// 匹配 INSERT INTO table_name
	insertPattern := regexp.MustCompile(`(?i)\bINSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)`)
	insertMatches := insertPattern.FindAllStringSubmatch(sql, -1)
	for _, match := range insertMatches {
		if len(match) > 1 {
			table := strings.Trim(match[1], `"`)
			if !seen[table] {
				tables = append(tables, table)
				seen[table] = true
			}
		}
	}

	// 匹配 DELETE FROM table_name
	deletePattern := regexp.MustCompile(`(?i)\bDELETE\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)`)
	deleteMatches := deletePattern.FindAllStringSubmatch(sql, -1)
	for _, match := range deleteMatches {
		if len(match) > 1 {
			table := strings.Trim(match[1], `"`)
			if !seen[table] {
				tables = append(tables, table)
				seen[table] = true
			}
		}
	}

	return tables
}

// extractFieldsFromSQL 从 SQL 中提取所有字段名
// 支持 table.field, field, "field" 等格式
// 返回字段名列表（可能包含 table.field 格式）
func extractFieldsFromSQL(sql string) []string {
	var fields []string
	seen := make(map[string]bool)

	// 移除字符串常量，避免误匹配
	cleanedSQL := removeStringLiterals(sql)

	// 匹配 SELECT ... FROM 之间的字段
	selectPattern := regexp.MustCompile(`(?i)\bSELECT\s+(.+?)\s+FROM`)
	selectMatch := selectPattern.FindStringSubmatch(cleanedSQL)
	if len(selectMatch) > 1 {
		selectClause := selectMatch[1]
		// 分割字段（考虑逗号分隔）
		fieldParts := splitSelectFields(selectClause)
		for _, part := range fieldParts {
			part = strings.TrimSpace(part)
			// 跳过 *
			if part == "*" {
				continue
			}
			// 提取字段名（去掉别名 AS xxx）
			field := extractFieldName(part)
			if field != "" && !seen[field] {
				fields = append(fields, field)
				seen[field] = true
			}
		}
	}

	// 匹配 WHERE 子句中的字段
	wherePattern := regexp.MustCompile(`(?i)\bWHERE\s+(.+?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|\bOFFSET\b|$)`)
	whereMatch := wherePattern.FindStringSubmatch(cleanedSQL)
	if len(whereMatch) > 1 {
		whereClause := whereMatch[1]
		extractFieldsFromClause(whereClause, &fields, seen)
	}

	// 匹配 ORDER BY 子句中的字段
	orderByPattern := regexp.MustCompile(`(?i)\bORDER\s+BY\s+(.+?)(?:\bLIMIT\b|\bOFFSET\b|$)`)
	orderByMatch := orderByPattern.FindStringSubmatch(cleanedSQL)
	if len(orderByMatch) > 1 {
		orderClause := orderByMatch[1]
		extractFieldsFromClause(orderClause, &fields, seen)
	}

	// 匹配 GROUP BY 子句中的字段
	groupByPattern := regexp.MustCompile(`(?i)\bGROUP\s+BY\s+(.+?)(?:\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|\bOFFSET\b|$)`)
	groupByMatch := groupByPattern.FindStringSubmatch(cleanedSQL)
	if len(groupByMatch) > 1 {
		groupClause := groupByMatch[1]
		extractFieldsFromClause(groupClause, &fields, seen)
	}

	// 匹配 HAVING 子句中的字段
	havingPattern := regexp.MustCompile(`(?i)\bHAVING\s+(.+?)(?:\bORDER\s+BY\b|\bLIMIT\b|\bOFFSET\b|$)`)
	havingMatch := havingPattern.FindStringSubmatch(cleanedSQL)
	if len(havingMatch) > 1 {
		havingClause := havingMatch[1]
		extractFieldsFromClause(havingClause, &fields, seen)
	}

	// 匹配 JOIN ON 子句中的字段
	joinOnPattern := regexp.MustCompile(`(?i)\bON\s+(.+?)(?:\bWHERE\b|\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|$)`)
	joinOnMatches := joinOnPattern.FindAllStringSubmatch(cleanedSQL, -1)
	for _, match := range joinOnMatches {
		if len(match) > 1 {
			onClause := match[1]
			extractFieldsFromClause(onClause, &fields, seen)
		}
	}

	return fields
}

// removeStringLiterals 移除 SQL 中的字符串常量，避免误匹配字段
func removeStringLiterals(sql string) string {
	// 移除 MyBatis 占位符 #{xxx} 和 ${xxx}，避免被当作字段名
	result := regexp.MustCompile(`#\{[^}]+\}`).ReplaceAllString(sql, "?")
	result = regexp.MustCompile(`\$\{[^}]+\}`).ReplaceAllString(result, "?")
	// 移除单引号字符串
	result = regexp.MustCompile(`'[^']*'`).ReplaceAllString(result, "''")
	// 移除双引号字符串（某些数据库使用双引号）
	result = regexp.MustCompile(`"[^"]*"`).ReplaceAllString(result, `""`)
	return result
}

// splitSelectFields 分割 SELECT 字段列表（考虑括号嵌套）
func splitSelectFields(selectClause string) []string {
	var fields []string
	var current strings.Builder
	depth := 0

	for _, ch := range selectClause {
		switch ch {
		case '(':
			depth++
			current.WriteRune(ch)
		case ')':
			depth--
			current.WriteRune(ch)
		case ',':
			if depth == 0 {
				fields = append(fields, current.String())
				current.Reset()
			} else {
				current.WriteRune(ch)
			}
		default:
			current.WriteRune(ch)
		}
	}

	if current.Len() > 0 {
		fields = append(fields, current.String())
	}

	return fields
}

// extractFieldName 从字段表达式中提取字段名
// 支持: field, table.field, schema.table.field, field AS alias
func extractFieldName(expr string) string {
	expr = strings.TrimSpace(expr)

	// 移除别名 (AS alias 或 空格 alias)
	if idx := strings.Index(strings.ToUpper(expr), " AS "); idx != -1 {
		expr = strings.TrimSpace(expr[:idx])
	} else {
		// 处理空格别名（如 "field alias"）
		parts := strings.Fields(expr)
		if len(parts) >= 2 && !isSQLKeyword(parts[len(parts)-1]) {
			// 最后一个词可能是别名，取前面的部分
			expr = strings.Join(parts[:len(parts)-1], " ")
		}
	}

	// 如果是函数调用或表达式，返回空（不校验）
	if strings.Contains(expr, "(") || strings.Contains(expr, "+") ||
		strings.Contains(expr, "-") || strings.Contains(expr, "*") && !strings.Contains(expr, ".") ||
		strings.Contains(expr, "/") || strings.Contains(expr, "DISTINCT") {
		return ""
	}

	// 移除引号
	expr = strings.Trim(expr, `"`)

	return expr
}

// isSQLKeyword 判断是否是 SQL 关键字
func isSQLKeyword(word string) bool {
	keywords := map[string]bool{
		"FROM": true, "WHERE": true, "AND": true, "OR": true, "NOT": true,
		"IN": true, "LIKE": true, "BETWEEN": true, "IS": true, "NULL": true,
		"ASC": true, "DESC": true, "LIMIT": true, "OFFSET": true,
	}
	return keywords[strings.ToUpper(word)]
}

// extractFieldsFromClause 从子句中提取字段名
func extractFieldsFromClause(clause string, fields *[]string, seen map[string]bool) {
	// 匹配 table.field 或 field（标识符）
	// 排除函数调用、数字常量、字符串常量
	fieldPattern := regexp.MustCompile(`([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)`)
	matches := fieldPattern.FindAllString(clause, -1)

	for _, match := range matches {
		// 跳过 SQL 关键字
		if isSQLKeyword(match) {
			continue
		}
		// 跳过函数名（后面紧跟左括号的）
		if strings.Contains(clause, match+"(") {
			continue
		}
		// 跳过参数占位符
		if strings.HasPrefix(match, "#{") || strings.HasPrefix(match, "${") {
			continue
		}

		// 移除引号
		field := strings.Trim(match, `"`)
		if field != "" && !seen[field] {
			*fields = append(*fields, field)
			seen[field] = true
		}
	}
}

// validateSQLTablesAndFields 校验 SQL 中的表名和字段名是否存在
// 返回校验结果和错误信息
func validateSQLTablesAndFields(sql string, dbSchemas []map[string]interface{}) (bool, string) {
	// 提取表名
	tables := extractTablesFromSQL(sql)
	if len(tables) == 0 {
		// 没有提取到表名，可能是非标准 SQL，跳过校验
		return true, ""
	}

	log.Printf("SQL校验 - 提取到的表名: %v", tables)

	// 构建表名到字段列表的映射
	tableColumnsMap := make(map[string][]string)
	tableExistsMap := make(map[string]bool)

	// 从 dbSchemas 中构建表信息
	for _, schema := range dbSchemas {
		if tablesWithColumns, ok := schema["tables"].([]map[string]interface{}); ok {
			for _, table := range tablesWithColumns {
				tableName, _ := table["name"].(string)
				tableNameLower := strings.ToLower(tableName)
				tableExistsMap[tableNameLower] = true

				// 提取字段名列表
				var columnNames []string
				if columns, ok := table["columns"].([]map[string]interface{}); ok {
					for _, col := range columns {
						if colName, ok := col["name"].(string); ok {
							columnNames = append(columnNames, colName)
						}
					}
				}
				tableColumnsMap[tableNameLower] = columnNames
			}
		}
	}

	log.Printf("SQL校验 - 数据库中的表: %v", tableExistsMap)

	// 校验表名是否存在
	var missingTables []string
	for _, table := range tables {
		// 处理 schema.table 格式
		tableName := table
		if idx := strings.Index(table, "."); idx >= 0 {
			tableName = table[idx+1:]
		}
		tableNameLower := strings.ToLower(tableName)

		if !tableExistsMap[tableNameLower] {
			missingTables = append(missingTables, table)
		}
	}

	if len(missingTables) > 0 {
		errMsg := fmt.Sprintf("SQL中引用的表不存在: %s", strings.Join(missingTables, ", "))
		log.Printf("SQL校验失败 - %s", errMsg)
		return false, errMsg
	}

	// 提取字段名
	fields := extractFieldsFromSQL(sql)
	if len(fields) == 0 {
		// 没有提取到字段名，可能是 SELECT *，跳过字段校验
		log.Printf("SQL校验 - 未提取到字段名，跳过字段校验")
		return true, ""
	}

	log.Printf("SQL校验 - 提取到的字段名: %v", fields)

	// 校验字段名是否存在
	var missingFields []string
	for _, field := range fields {
		// 处理 table.field 格式
		var tableName, fieldName string
		if idx := strings.Index(field, "."); idx >= 0 {
			tableName = field[:idx]
			fieldName = field[idx+1:]
		} else {
			// 没有 table 前缀，需要检查所有表
			fieldName = field
			found := false
			for _, columns := range tableColumnsMap {
				for _, col := range columns {
					if strings.EqualFold(col, fieldName) {
						found = true
						break
					}
				}
				if found {
					break
				}
			}
			if !found {
				missingFields = append(missingFields, field)
			}
			continue
		}

		// 有 table 前缀，检查指定表的字段
		tableNameLower := strings.ToLower(tableName)
		columns, exists := tableColumnsMap[tableNameLower]
		if !exists {
			// 表名不存在（前面已校验过，这里应该不会发生）
			continue
		}

		found := false
		for _, col := range columns {
			if strings.EqualFold(col, fieldName) {
				found = true
				break
			}
		}
		if !found {
			missingFields = append(missingFields, field)
		}
	}

	if len(missingFields) > 0 {
		// 构建可用字段列表，帮助 AI 修正
		var availableFieldsHint strings.Builder
		availableFieldsHint.WriteString(fmt.Sprintf("SQL中引用的字段不存在: %s\n\n", strings.Join(missingFields, ", ")))
		availableFieldsHint.WriteString("【可用字段列表】\n")
		for _, table := range tables {
			tableName := table
			if idx := strings.Index(table, "."); idx >= 0 {
				tableName = table[idx+1:]
			}
			tableNameLower := strings.ToLower(tableName)
			if columns, exists := tableColumnsMap[tableNameLower]; exists && len(columns) > 0 {
				availableFieldsHint.WriteString(fmt.Sprintf("表 %s 的字段: %s\n", tableName, strings.Join(columns, ", ")))
			}
		}
		availableFieldsHint.WriteString("\n请使用上述字段重新生成SQL，不要编造不存在的字段名。")
		errMsg := availableFieldsHint.String()
		log.Printf("SQL校验失败 - %s", errMsg)
		return false, errMsg
	}

	log.Printf("SQL校验成功 - 所有表名和字段名均有效")
	return true, ""
}

// validateSQLByExecution 通过实际执行SQL来校验语法、权限和运行时错误
// 返回 (bool, string) 表示校验结果和错误信息
func validateSQLByExecution(sqlStr string, dbID string) (bool, string) {
	// 获取数据库配置
	dataOntologyMu.RLock()
	dbConfig, exists := dataOntologyDatabases[dbID]
	dataOntologyMu.RUnlock()

	if !exists {
		return false, "数据库配置不存在"
	}

	// 获取数据库连接
	db, err := getDBFromPool(dbConfig)
	if err != nil {
		return false, fmt.Sprintf("数据库连接失败: %v", err)
	}

	// 处理 MyBatis 参数占位符：将 #{param} 和 ${param} 替换为占位符或默认值
	validationSQL := replaceMyBatisParamsForValidation(sqlStr)

	// 判断SQL类型
	isWrite := isWriteOperation(validationSQL)

	var validationErr error

	if isWrite {
		// 写操作：使用事务 + ROLLBACK 或 PREPARE
		validationErr = validateWriteSQL(db, dbConfig, validationSQL)
	} else {
		// 读操作：使用 EXPLAIN 或 LIMIT 0
		validationErr = validateReadSQL(db, dbConfig, validationSQL)
	}

	if validationErr != nil {
		return false, fmt.Sprintf("执行校验失败: %v", validationErr)
	}

	return true, ""
}

// replaceMyBatisParamsForValidation 将 MyBatis 参数占位符替换为校验用的占位符
func replaceMyBatisParamsForValidation(sqlStr string) string {
	result := sqlStr

	// 替换 ${param} 为空字符串或默认值
	dollarPattern := `\$\{([^}]+)\}`
	result = replaceWithRegex(result, dollarPattern, func(match string) string {
		paramName := strings.TrimSpace(match[2 : len(match)-1])
		// 支持参数名:默认值格式
		if colonIdx := strings.Index(paramName, ":"); colonIdx != -1 {
			defaultValue := strings.TrimSpace(paramName[colonIdx+1:])
			return defaultValue
		}
		// 没有默认值，返回空字符串
		return ""
	})

	// 替换 #{param} 为 ? 占位符
	hashPattern := `#\{([^}]+)\}`
	result = replaceWithRegex(result, hashPattern, func(match string) string {
		paramName := strings.TrimSpace(match[2 : len(match)-1])
		// 支持参数名:默认值格式
		if colonIdx := strings.Index(paramName, ":"); colonIdx != -1 {
			defaultValue := strings.TrimSpace(paramName[colonIdx+1:])
			// 根据默认值类型返回适当的占位符
			if defaultValue != "" {
				return fmt.Sprintf("'%s'", defaultValue)
			}
		}
		// 没有默认值，返回 NULL
		return "NULL"
	})

	return result
}

// validateReadSQL 校验读操作SQL（SELECT）
func validateReadSQL(db *sql.DB, dbConfig *DatabaseConfig, sqlStr string) error {
	var validationSQL string

	switch dbConfig.Type {
	case "mysql", "mariadb", "tidb":
		// MySQL: 使用 EXPLAIN
		validationSQL = "EXPLAIN " + sqlStr
	case "postgresql", "timescaledb", "cockroachdb":
		// PostgreSQL: 使用 EXPLAIN
		validationSQL = "EXPLAIN " + sqlStr
	case "sqlserver":
		// SQL Server: 使用 SET SHOWPLAN_TEXT ON 或 EXPLAIN
		validationSQL = "SET SHOWPLAN_TEXT ON; " + sqlStr
	case "oracle":
		// Oracle: 使用 EXPLAIN PLAN FOR
		validationSQL = "EXPLAIN PLAN FOR " + sqlStr
	case "dm":
		// 达梦: 使用 EXPLAIN
		validationSQL = "EXPLAIN " + sqlStr
	case "sqlite", "duckdb":
		// SQLite/DuckDB: 使用 EXPLAIN QUERY PLAN
		validationSQL = "EXPLAIN QUERY PLAN " + sqlStr
	case "clickhouse":
		// ClickHouse: 使用 EXPLAIN
		validationSQL = "EXPLAIN " + sqlStr
	default:
		// 默认：尝试 LIMIT 0 方式
		validationSQL = sqlStr
		// 如果SQL已有LIMIT，尝试替换为 LIMIT 0
		if !strings.Contains(strings.ToUpper(sqlStr), "LIMIT") {
			validationSQL = strings.TrimSuffix(sqlStr, ";") + " LIMIT 0"
		}
	}

	// 执行校验SQL
	_, err := db.Exec(validationSQL)
	if err != nil {
		return fmt.Errorf("SQL语法或权限错误: %v", err)
	}

	return nil
}

// validateWriteSQL 校验写操作SQL（INSERT/UPDATE/DELETE）
func validateWriteSQL(db *sql.DB, dbConfig *DatabaseConfig, sqlStr string) error {
	// 方案1：使用事务 + ROLLBACK（适用于大多数数据库）
	// 方案2：使用 PREPARE（部分数据库支持）

	// 优先使用事务方式
	tx, err := db.Begin()
	if err != nil {
		// 如果无法开启事务，尝试 PREPARE 方式
		return validateWithPrepare(db, dbConfig, sqlStr)
	}
	defer tx.Rollback()

	// 在事务中执行SQL（不会真正提交）
	_, err = tx.Exec(sqlStr)
	if err != nil {
		return fmt.Errorf("SQL语法或权限错误: %v", err)
	}

	// 成功执行，事务会自动 ROLLBACK
	return nil
}

// validateWithPrepare 使用 PREPARE 方式校验SQL
func validateWithPrepare(db *sql.DB, dbConfig *DatabaseConfig, sqlStr string) error {
	// 不同数据库的 PREPARE 语法
	var prepareSQL string
	var cleanupSQL string

	switch dbConfig.Type {
	case "mysql", "mariadb", "tidb":
		prepareSQL = "PREPARE stmt FROM ?"
		cleanupSQL = "DEALLOCATE PREPARE stmt"
	case "postgresql", "timescaledb", "cockroachdb":
		prepareSQL = "PREPARE stmt AS " + sqlStr
		cleanupSQL = "DEALLOCATE stmt"
	case "oracle":
		// Oracle 不支持标准 PREPARE，直接返回错误
		return fmt.Errorf("Oracle 数据库不支持预编译校验，请检查SQL语法")
	case "dm":
		// 达梦支持 PREPARE
		prepareSQL = "PREPARE stmt FROM ?"
		cleanupSQL = "DEALLOCATE PREPARE stmt"
	case "sqlserver":
		// SQL Server 使用 sp_prepare
		return fmt.Errorf("SQL Server 暂不支持预编译校验，请检查SQL语法")
	default:
		// 其他数据库尝试通用方式
		prepareSQL = "PREPARE stmt FROM ?"
		cleanupSQL = "DEALLOCATE PREPARE stmt"
	}

	// 执行 PREPARE
	if strings.Contains(prepareSQL, "?") {
		// MySQL 风格：PREPARE stmt FROM ?
		_, err := db.Exec(prepareSQL, sqlStr)
		if err != nil {
			return fmt.Errorf("SQL语法错误: %v", err)
		}
	} else {
		// PostgreSQL 风格：PREPARE stmt AS sql
		_, err := db.Exec(prepareSQL)
		if err != nil {
			return fmt.Errorf("SQL语法错误: %v", err)
		}
	}

	// 清理 PREPARE
	if cleanupSQL != "" {
		db.Exec(cleanupSQL)
	}

	return nil
}

// isNonConditionParam 判断参数是否出现在 SQL 的非条件子句位置（LIMIT/OFFSET/ORDER BY/GROUP BY）
// 这些位置的参数不应从数据库取样本值，应保留原始默认值
func isNonConditionParam(sqlStr, paramName string) bool {
	paramPatterns := []string{
		"#{" + paramName + "}",
		"${" + paramName + "}",
	}

	for _, pattern := range paramPatterns {
		idx := strings.Index(sqlStr, pattern)
		if idx == -1 {
			continue
		}

		// 检查参数前面紧跟的关键字（忽略空白）
		beforeParam := strings.TrimSpace(sqlStr[:idx])
		upperBefore := strings.ToUpper(beforeParam)

		// LIMIT #{limit} / LIMIT #{size}
		if strings.HasSuffix(upperBefore, "LIMIT") {
			return true
		}
		// OFFSET #{offset}
		if strings.HasSuffix(upperBefore, "OFFSET") {
			return true
		}
		// ORDER BY #{orderBy}
		if strings.HasSuffix(upperBefore, "BY") && strings.Contains(upperBefore, "ORDER") {
			return true
		}
		// GROUP BY #{groupBy}
		if strings.HasSuffix(upperBefore, "BY") && strings.Contains(upperBefore, "GROUP") {
			return true
		}
	}

	return false
}

// populateDefaultParamsFromDB 从数据库表中查询实际值填充 default_params
func populateDefaultParamsFromDB(apiConfig map[string]interface{}, dbID string) {
	sqlStr, ok := apiConfig["sql"].(string)
	if !ok || sqlStr == "" {
		return
	}

	defaultParams, ok := apiConfig["default_params"].(map[string]interface{})
	if !ok || len(defaultParams) == 0 {
		return
	}

	// 获取数据库配置
	dataOntologyMu.RLock()
	dbConfig, exists := dataOntologyDatabases[dbID]
	dataOntologyMu.RUnlock()

	if !exists {
		log.Printf("未找到数据库配置: %s", dbID)
		return
	}

	// 提取 SQL 中的表名
	tableNames := extractTableNamesFromSQL(sqlStr)
	if len(tableNames) == 0 {
		log.Printf("未能从 SQL 中提取表名: %s", sqlStr)
		return
	}

	log.Printf("从 SQL 中提取的表: %v", tableNames)

	// 对每个参数，尝试从对应的表中查询实际值
	for paramName, paramValue := range defaultParams {
		// 检查参数是否出现在非条件子句（LIMIT/OFFSET/ORDER BY/GROUP BY）中
		if isNonConditionParam(sqlStr, paramName) {
			log.Printf("参数 %s 出现在 LIMIT/OFFSET/ORDER BY/GROUP BY 等非条件位置，保留默认值: %v", paramName, paramValue)
			continue
		}

		// 查找参数对应的表和字段
		tableName, fieldName := findParamTableAndField(sqlStr, paramName, tableNames)
		if tableName == "" || fieldName == "" {
			log.Printf("参数 %s 未找到对应的表或字段，保留默认值: %v", paramName, paramValue)
			continue
		}

		// 从表中查询实际值
		actualValue, err := queryActualValueFromTable(dbConfig, tableName, fieldName)
		if err != nil {
			log.Printf("查询参数 %s 的实际值失败 (表: %s, 字段: %s): %v，保留默认值: %v", paramName, tableName, fieldName, err, paramValue)
			continue
		}

		if actualValue != nil {
			defaultParams[paramName] = actualValue
			log.Printf("参数 %s 已填充实际值: %v (表: %s, 字段: %s)", paramName, actualValue, tableName, fieldName)
		}
	}
}

// extractTableNamesFromSQL 从 SQL 中提取表名
func extractTableNamesFromSQL(sqlStr string) []string {
	var tableNames []string
	upperSQL := strings.ToUpper(sqlStr)

	// 提取 FROM 后面的表名
	fromIdx := strings.Index(upperSQL, " FROM ")
	if fromIdx != -1 {
		afterFrom := sqlStr[fromIdx+6:]
		tableName := extractFirstTableName(afterFrom)
		if tableName != "" {
			tableNames = append(tableNames, tableName)
		}
	}

	// 提取 JOIN 后面的表名
	joinPattern := regexp.MustCompile(`(?i)\bJOIN\s+([^\s,]+)`)
	joinMatches := joinPattern.FindAllStringSubmatch(sqlStr, -1)
	for _, match := range joinMatches {
		if len(match) > 1 {
			tableName := strings.Trim(match[1], "\"`[]")
			tableNames = append(tableNames, tableName)
		}
	}

	// 去重
	seen := make(map[string]bool)
	var uniqueTables []string
	for _, t := range tableNames {
		if !seen[t] {
			seen[t] = true
			uniqueTables = append(uniqueTables, t)
		}
	}

	return uniqueTables
}

// extractFirstTableName 从 SQL 片段中提取第一个表名
func extractFirstTableName(sqlFragment string) string {
	// 去除前导空格
	sqlFragment = strings.TrimSpace(sqlFragment)

	// 处理带引号、反引号、方括号的表名
	if len(sqlFragment) > 0 {
		quoteChars := []string{"\"", "`", "["}
		for _, quote := range quoteChars {
			if strings.HasPrefix(sqlFragment, quote) {
				endQuote := quote
				if quote == "[" {
					endQuote = "]"
				}
				endIdx := strings.Index(sqlFragment[1:], endQuote)
				if endIdx != -1 {
					return sqlFragment[1 : endIdx+1]
				}
			}
		}
	}

	// 提取第一个单词作为表名（可能包含 schema.table 格式）
	parts := strings.Fields(sqlFragment)
	if len(parts) > 0 {
		tableName := parts[0]
		// 去除可能的别名（AS 关键字）
		if strings.ToUpper(tableName) == "AS" && len(parts) > 1 {
			tableName = parts[1]
		}
		// 去除尾部逗号
		tableName = strings.TrimRight(tableName, ",")
		return tableName
	}

	return ""
}

// findParamTableAndField 查找参数对应的表名和字段名
func findParamTableAndField(sqlStr, paramName string, tableNames []string) (string, string) {
	// 在 SQL 中查找参数出现的位置
	paramPatterns := []string{
		"#{" + paramName + "}",
		"${" + paramName + "}",
	}

	for _, pattern := range paramPatterns {
		paramIdx := strings.Index(sqlStr, pattern)
		if paramIdx == -1 {
			continue
		}

		// 向前查找字段名（通常在 = 或 LIKE 等操作符之前）
		beforeParam := sqlStr[:paramIdx]
		fieldName := extractFieldNameBeforeParam(beforeParam)
		if fieldName != "" {
			// 返回第一个表名（简化处理，实际可能需要更精确的表名匹配）
			if len(tableNames) > 0 {
				return tableNames[0], fieldName
			}
		}
	}

	// 如果在 SQL 中找不到字段名，尝试使用参数名作为字段名
	if len(tableNames) > 0 {
		return tableNames[0], paramName
	}

	return "", ""
}

// extractFieldNameBeforeParam 从参数前的 SQL 片段中提取字段名
func extractFieldNameBeforeParam(sqlFragment string) string {
	// 去除尾部空格
	sqlFragment = strings.TrimSpace(sqlFragment)

	// 常见操作符：=, LIKE, IN, >, <, >=, <=, !=
	operators := []string{"=", "LIKE", "IN", ">", "<", ">=", "<=", "!="}

	for _, op := range operators {
		// 查找操作符位置
		upperFragment := strings.ToUpper(sqlFragment)
		opIdx := strings.LastIndex(upperFragment, op)
		if opIdx == -1 {
			continue
		}

		// 提取操作符之前的部分
		beforeOp := strings.TrimSpace(sqlFragment[:opIdx])

		// 从后向前提取字段名
		// 处理带引号、反引号、方括号的字段名
		if len(beforeOp) > 0 {
			lastChar := beforeOp[len(beforeOp)-1]
			if lastChar == '"' || lastChar == '`' || lastChar == ']' {
				quoteChar := string(lastChar)
				if lastChar == ']' {
					quoteChar = "["
				}
				// 向前查找匹配的引号
				for i := len(beforeOp) - 2; i >= 0; i-- {
					if string(beforeOp[i]) == quoteChar {
						return beforeOp[i+1 : len(beforeOp)-1]
					}
				}
			}
		}

		// 提取最后一个单词作为字段名
		parts := strings.Fields(beforeOp)
		if len(parts) > 0 {
			fieldName := parts[len(parts)-1]
			// 去除可能的表名前缀 (table.field 格式)
			if dotIdx := strings.LastIndex(fieldName, "."); dotIdx != -1 {
				fieldName = fieldName[dotIdx+1:]
			}
			return fieldName
		}
	}

	return ""
}

// queryActualValueFromTable 从表中查询字段的实际值
func queryActualValueFromTable(dbConfig *DatabaseConfig, tableName, fieldName string) (interface{}, error) {
	// 验证表名和字段名合法性
	if !isValidIdentifierWithSchema(tableName) {
		return nil, fmt.Errorf("无效的表名: %s", tableName)
	}
	if !isValidIdentifier(fieldName) {
		return nil, fmt.Errorf("无效的字段名: %s", fieldName)
	}

	// MongoDB 特殊处理
	if dbConfig.Type == "mongodb" {
		uri := buildMongoURI(dbConfig)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
		if err != nil {
			return nil, err
		}
		defer client.Disconnect(ctx)

		collection := client.Database(dbConfig.Database).Collection(tableName)

		var sample bson.M
		err = collection.FindOne(ctx, bson.M{}).Decode(&sample)
		if err != nil {
			return nil, err
		}

		if value, exists := sample[fieldName]; exists {
			return value, nil
		}
		return nil, fmt.Errorf("字段 %s 不存在", fieldName)
	}

	// NoSQL 数据库不支持
	if dbConfig.Type == "redis" || dbConfig.Type == "neo4j" || dbConfig.Type == "elasticsearch" ||
		dbConfig.Type == "influxdb" || dbConfig.Type == "memcached" ||
		dbConfig.Type == "cassandra" || dbConfig.Type == "hbase" {
		return nil, fmt.Errorf("不支持的数据库类型: %s", dbConfig.Type)
	}

	// SQL 数据库通用处理
	db, err := getDBFromPool(dbConfig)
	if err != nil {
		return nil, err
	}

	// 构建查询 SQL
	quotedTable, err := safeQuoteIdentifier(tableName, dbConfig.Type)
	if err != nil {
		return nil, err
	}

	quotedField, err := safeQuoteIdentifier(fieldName, dbConfig.Type)
	if err != nil {
		return nil, err
	}

	// 根据数据库类型构建不同的查询语句
	var querySQL string
	switch dbConfig.Type {
	case "oracle", "dm":
		querySQL = fmt.Sprintf("SELECT %s FROM %s WHERE %s IS NOT NULL AND ROWNUM = 1", quotedField, quotedTable, quotedField)
	case "sqlserver":
		querySQL = fmt.Sprintf("SELECT TOP 1 %s FROM %s WHERE %s IS NOT NULL", quotedField, quotedTable, quotedField)
	default:
		querySQL = fmt.Sprintf("SELECT %s FROM %s WHERE %s IS NOT NULL LIMIT 1", quotedField, quotedTable, quotedField)
	}

	var value interface{}
	err = db.QueryRow(querySQL).Scan(&value)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("表中没有数据")
		}
		return nil, err
	}

	return value, nil
}

// parseAIResponse 解析AI响应提取SQL和回复文本
func parseAIResponse(response string, dbSchemas []map[string]interface{}) (string, string, string) {
	var sql string
	var responseText string
	var dbID string

	// 提取SQL代码块
	sqlStart := strings.Index(response, "```sql")
	codeBlockStart := sqlStart
	if sqlStart == -1 {
		sqlStart = strings.Index(response, "```")
		codeBlockStart = sqlStart
	}

	if sqlStart != -1 {
		// 提取代码块之前的文本作为回复
		if codeBlockStart > 0 {
			responseText = strings.TrimSpace(response[:codeBlockStart])
		}

		sqlStart = strings.Index(response[sqlStart:], "\n")
		if sqlStart != -1 {
			sqlEnd := strings.Index(response[codeBlockStart+sqlStart+1:], "```")
			if sqlEnd != -1 {
				sql = strings.TrimSpace(response[codeBlockStart+sqlStart+1 : codeBlockStart+sqlStart+1+sqlEnd])
				// 返回第一个数据库ID
				if len(dbSchemas) > 0 {
					if id, ok := dbSchemas[0]["id"].(string); ok {
						dbID = id
					}
				}
				return sql, dbID, responseText
			}
		}
	}

	// 如果没有代码块，尝试直接查找SQL语句
	lines := strings.Split(response, "\n")
	var beforeSQL []string
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToUpper(line), "SELECT") ||
			strings.HasPrefix(strings.ToUpper(line), "INSERT") ||
			strings.HasPrefix(strings.ToUpper(line), "UPDATE") ||
			strings.HasPrefix(strings.ToUpper(line), "DELETE") {
			// 收集多行SQL，直到遇到空行或非SQL行
			var sqlLines []string
			sqlLines = append(sqlLines, line)
			for j := i + 1; j < len(lines); j++ {
				nextLine := strings.TrimSpace(lines[j])
				if nextLine == "" {
					break
				}
				// 检查是否是SQL续行（以SQL关键字开头或是明显的SQL片段）
				upperLine := strings.ToUpper(nextLine)
				if strings.HasPrefix(upperLine, "FROM") ||
					strings.HasPrefix(upperLine, "WHERE") ||
					strings.HasPrefix(upperLine, "AND") ||
					strings.HasPrefix(upperLine, "OR") ||
					strings.HasPrefix(upperLine, "ORDER") ||
					strings.HasPrefix(upperLine, "GROUP") ||
					strings.HasPrefix(upperLine, "HAVING") ||
					strings.HasPrefix(upperLine, "LIMIT") ||
					strings.HasPrefix(upperLine, "JOIN") ||
					strings.HasPrefix(upperLine, "LEFT") ||
					strings.HasPrefix(upperLine, "RIGHT") ||
					strings.HasPrefix(upperLine, "INNER") ||
					strings.HasPrefix(upperLine, "ON") ||
					strings.HasPrefix(upperLine, "SET") ||
					strings.HasPrefix(upperLine, "VALUES") ||
					strings.Contains(nextLine, ",") ||
					strings.HasSuffix(line, ",") {
					sqlLines = append(sqlLines, nextLine)
					line = nextLine
				} else {
					break
				}
			}
			sql = strings.Join(sqlLines, " ")
			// SQL之前的行作为回复文本
			if i > 0 {
				responseText = strings.TrimSpace(strings.Join(beforeSQL, " "))
			}
			if len(dbSchemas) > 0 {
				if id, ok := dbSchemas[0]["id"].(string); ok {
					dbID = id
				}
			}
			return sql, dbID, responseText
		}
		if line != "" {
			beforeSQL = append(beforeSQL, line)
		}
	}

	return "", "", ""
}

// ==================== 数据治理模块 ====================

// handleGovernanceTasks 处理治理任务列表和创建
func handleGovernanceTasks(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		defer dataOntologyMu.RUnlock()

		taskList := make([]*GovernanceTask, 0, len(governanceTasks))
		for _, t := range governanceTasks {
			if !dataOntologyResourceVisible(t.Owner, username) {
				continue
			}
			taskList = append(taskList, t)
		}

		// 读取用户设置中的任务顺序
		var govTaskOrder []string
		if user, ok := dataOntologyUsers[username]; ok && user.Settings != nil {
			if order, ok := user.Settings["govTaskOrder"].([]string); ok {
				govTaskOrder = order
			} else if orderInterface, ok := user.Settings["govTaskOrder"].([]interface{}); ok {
				// JSON 反序列化可能产生 []interface{}
				for _, id := range orderInterface {
					if idStr, ok := id.(string); ok {
						govTaskOrder = append(govTaskOrder, idStr)
					}
				}
			}
		}

		// 如果有自定义排序，按该顺序排序
		if len(govTaskOrder) > 0 {
			orderMap := make(map[string]int)
			for i, id := range govTaskOrder {
				orderMap[id] = i
			}
			sort.Slice(taskList, func(i, j int) bool {
				iIdx, iOk := orderMap[taskList[i].ID]
				jIdx, jOk := orderMap[taskList[j].ID]
				// 如果两个任务都在排序中，按排序顺序
				if iOk && jOk {
					return iIdx < jIdx
				}
				// 如果只有一个在排序中，排序中的排前面
				if iOk {
					return true
				}
				if jOk {
					return false
				}
				// 如果都不在排序中，按创建时间降序
				if taskList[i].CreatedAt != taskList[j].CreatedAt {
					return taskList[i].CreatedAt > taskList[j].CreatedAt
				}
				return taskList[i].Name < taskList[j].Name
			})
		} else {
			// 如果没有自定义排序，按创建时间降序 + 名称升序
			sort.Slice(taskList, func(i, j int) bool {
				if taskList[i].CreatedAt != taskList[j].CreatedAt {
					return taskList[i].CreatedAt > taskList[j].CreatedAt
				}
				return taskList[i].Name < taskList[j].Name
			})
		}

		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "tasks": taskList})

	case http.MethodPost:
		var task GovernanceTask
		if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
			return
		}
		if task.Name == "" || task.Type == "" || task.JsCode == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务名称、类型和Go代码不能为空"})
			return
		}
		if task.DatabaseID != "" {
			dataOntologyMu.RLock()
			dc, dbOk := dataOntologyDatabases[task.DatabaseID]
			dataOntologyMu.RUnlock()
			if !dbOk || !dataOntologyResourceVisible(dc.Owner, username) {
				json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "数据库不存在"})
				return
			}
		}
		task.ExampleFiles = nil
		task.ID = uuid.New().String()
		task.Owner = username
		task.CreatedAt = time.Now().Format(time.RFC3339)
		task.Status = "idle"
		if task.Type == "scheduled" && task.Enabled {
			task.Enabled = true
		}
		if task.RunMode == "" {
			task.RunMode = task.Runtime
		}
		if task.ExecutionMode == "" {
			task.ExecutionMode = task.RunMode
		}

		dataOntologyMu.Lock()
		governanceTasks[task.ID] = &task
		dataOntologyMu.Unlock()

		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存治理任务失败: %v", err)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "task": task})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
	}
}

// handleGovernanceTaskDetail 处理单个治理任务的 GET/PUT/DELETE
func handleGovernanceTaskDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/data-ontology/governance/tasks/"), "/")
	if len(pathParts) == 0 || pathParts[0] == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "缺少任务ID"})
		return
	}
	taskID := pathParts[0]

	// 子路由分发
	if len(pathParts) >= 2 {
		switch pathParts[1] {
		case "run":
			handleGovernanceTaskRun(w, r, taskID)
			return
		case "toggle":
			handleGovernanceTaskToggle(w, r, taskID)
			return
		case "logs":
			if len(pathParts) > 2 {
				// DELETE /api/data-ontology/governance/tasks/{taskID}/logs/{logID}
				handleGovernanceTaskLogDelete(w, r, taskID, pathParts[2])
				return
			}
			handleGovernanceTaskLogs(w, r, taskID)
			return
		case "logs-clear":
			handleGovernanceTaskLogsClear(w, r, taskID)
			return
		case "upload":
			handleGovernanceTaskUpload(w, r, taskID)
			return
		case "save-log":
			handleGovernanceTaskSaveLog(w, r, taskID)
			return
		case "progress":
			handleGovernanceTaskProgress(w, r, taskID)
			return
		case "share":
			// 分享相关操作
			if len(pathParts) >= 3 {
				switch pathParts[2] {
				case "enable":
					handleGovernanceTaskShareEnable(w, r, taskID)
					return
				case "disable":
					handleGovernanceTaskShareDisable(w, r, taskID)
					return
				}
			}
			// POST /api/data-ontology/governance/tasks/{id}/share - 开启分享
			// DELETE /api/data-ontology/governance/tasks/{id}/share - 关闭分享
			if r.Method == http.MethodPost {
				handleGovernanceTaskShareEnable(w, r, taskID)
			} else if r.Method == http.MethodDelete {
				handleGovernanceTaskShareDisable(w, r, taskID)
			} else {
				json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
			}
			return
		}
	}

	switch r.Method {
	case http.MethodGet:
		task, _, ok := requireGovernanceTaskAccess(w, r, taskID)
		if !ok {
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "task": task})

	case http.MethodPut:
		_, username, ok := requireGovernanceTaskAccess(w, r, taskID)
		if !ok {
			return
		}
		var update GovernanceTask
		if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
			return
		}
		dataOntologyMu.Lock()
		task, exists := governanceTasks[taskID]
		if !exists {
			dataOntologyMu.Unlock()
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务不存在"})
			return
		}
		// Direct assignments - frontend always sends all fields, including empty strings
		task.Name = update.Name
		task.Type = update.Type
		task.Description = update.Description
		task.JsCode = update.JsCode
		// DatabaseID needs validation - only update if non-empty and valid
		if update.DatabaseID != "" {
			dc, dcOk := dataOntologyDatabases[update.DatabaseID]
			if !dcOk || !dataOntologyResourceVisible(dc.Owner, username) {
				dataOntologyMu.Unlock()
				json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "数据库不存在"})
				return
			}
			task.DatabaseID = update.DatabaseID
		}
		task.Runtime = update.Runtime
		task.RunMode = update.RunMode
		task.ExecutionMode = update.ExecutionMode
		// Backfill run_mode/execution_mode only if BOTH are empty (legacy compatibility)
		if task.RunMode == "" && task.ExecutionMode == "" {
			task.RunMode = task.Runtime
			task.ExecutionMode = task.RunMode
		}
		task.CronExpr = update.CronExpr
		task.InputType = update.InputType
		task.AcceptExts = update.AcceptExts
		task.FileBatchMode = update.FileBatchMode
		task.Enabled = update.Enabled
		// API 注册字段
		task.RegisterAsAPI = update.RegisterAsAPI
		if update.APIPath != "" {
			task.APIPath = update.APIPath
		}
		if update.APIMethod != "" {
			task.APIMethod = update.APIMethod
		}
		// 分享字段
		task.ShareEnabled = update.ShareEnabled
		if update.ShareEnabled && task.ShareToken == "" {
			task.ShareToken = uuid.New().String()
		}
		if !update.ShareEnabled {
			task.ShareToken = ""
		}
		task.UpdatedAt = time.Now().Format(time.RFC3339)
		dataOntologyMu.Unlock()

		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存治理任务更新失败: %v", err)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "task": task})

	case http.MethodDelete:
		_, _, ok := requireGovernanceTaskAccess(w, r, taskID)
		if !ok {
			return
		}
		dataOntologyMu.Lock()
		delete(governanceTasks, taskID)
		delete(governanceTaskLogs, taskID)
		dataOntologyMu.Unlock()

		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存治理任务删除失败: %v", err)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "删除成功"})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
	}
}

// handleGovernanceTaskToggle 启用/禁用定时任务
func handleGovernanceTaskToggle(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}
	_, _, ok := requireGovernanceTaskAccess(w, r, taskID)
	if !ok {
		return
	}
	dataOntologyMu.Lock()
	task, exists := governanceTasks[taskID]
	if !exists {
		dataOntologyMu.Unlock()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务不存在"})
		return
	}
	task.Enabled = !task.Enabled
	task.UpdatedAt = time.Now().Format(time.RFC3339)
	dataOntologyMu.Unlock()

	if err := saveDataOntologyStore(); err != nil {
		log.Printf("保存治理任务状态失败: %v", err)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "enabled": task.Enabled})
}

// handleGovernanceTaskLogs 获取或删除任务执行日志
func handleGovernanceTaskLogs(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")
	_, _, ok := requireGovernanceTaskAccess(w, r, taskID)
	if !ok {
		return
	}

	// DELETE: 删除指定日志
	if r.Method == http.MethodDelete {
		var req struct {
			LogID string `json:"log_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "解析请求失败"})
			return
		}
		if req.LogID == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "缺少 log_id"})
			return
		}
		dataOntologyMu.Lock()
		logs := governanceTaskLogs[taskID]
		newLogs := make([]*GovernanceTaskLog, 0, len(logs))
		for _, l := range logs {
			if l != nil && l.ID != req.LogID {
				newLogs = append(newLogs, l)
			}
		}
		governanceTaskLogs[taskID] = newLogs
		saveDataOntologyStore()
		dataOntologyMu.Unlock()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "日志已删除"})
		return
	}

	// GET: 获取日志
	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET和DELETE"})
		return
	}
	dataOntologyMu.RLock()
	logs := governanceTaskLogs[taskID]
	task, hasTask := governanceTasks[taskID]
	dataOntologyMu.RUnlock()

	if logs == nil {
		logs = make([]*GovernanceTaskLog, 0)
	}
	// 运行中任务：把 last_output 合并进「运行中」日志条目；若尚无日志行（竞态或历史数据），则合成一条便于展示
	if hasTask && task != nil && task.Status == "running" {
		if len(logs) == 0 {
			st := task.StartedAt
			if st == "" {
				st = time.Now().Format(time.RFC3339)
			}
			in := "（无输入）"
			if task.TotalFiles > 0 {
				in = fmt.Sprintf("文件: %d 个", task.TotalFiles)
			}
			logs = []*GovernanceTaskLog{{
				ID:        uuid.New().String(),
				TaskID:    taskID,
				RunID:     task.RunID,
				StartTime: st,
				Status:    "running",
				Output:    task.LastOutput,
				Input:     in,
			}}
		} else if strings.TrimSpace(task.LastOutput) != "" {
			out := make([]*GovernanceTaskLog, 0, len(logs))
			for _, l := range logs {
				if l == nil {
					continue
				}
				cp := *l
				if cp.Status == "running" && (cp.RunID == "" || cp.RunID == task.RunID) {
					cp.Output = task.LastOutput
				}
				out = append(out, &cp)
			}
			logs = out
		}
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "logs": logs})
}

// handleGovernanceTaskLogDelete 删除单条任务执行日志
func handleGovernanceTaskLogDelete(w http.ResponseWriter, r *http.Request, taskID string, logID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodDelete {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持DELETE"})
		return
	}
	_, _, ok := requireGovernanceTaskAccess(w, r, taskID)
	if !ok {
		return
	}

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	logs := governanceTaskLogs[taskID]
	if logs == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "日志不存在"})
		return
	}

	// 找到并删除指定日志
	found := false
	newLogs := make([]*GovernanceTaskLog, 0, len(logs))
	for _, l := range logs {
		if l != nil && l.ID == logID {
			found = true
			continue // 跳过要删除的
		}
		newLogs = append(newLogs, l)
	}

	if !found {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "日志ID不存在"})
		return
	}

	governanceTaskLogs[taskID] = newLogs

	// 持久化
	store := DataOntologyStore{
		Users:       dataOntologyUsers,
		Databases:   dataOntologyDatabases,
		Apis:        dataOntologyApis,
		AIConfig:    dataOntologyAIConfig,
		Tasks:       governanceTasks,
		TaskLogs:    governanceTaskLogs,
		MCPEnabled:  dataOntologyMCPEnabled,
		LLMModels:   llmModels,
		SmallModels: smallModels,
	}
	storePath := getDataOntologyStorePathFn()
	storeData, _ := json.MarshalIndent(store, "", "  ")
	os.WriteFile(storePath, storeData, 0644)

	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "日志已删除"})
}

// handleGovernanceTaskLogsClear 清空任务所有执行日志
func handleGovernanceTaskLogsClear(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodDelete {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持DELETE"})
		return
	}
	_, _, ok := requireGovernanceTaskAccess(w, r, taskID)
	if !ok {
		return
	}

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	governanceTaskLogs[taskID] = []*GovernanceTaskLog{}

	// 持久化
	store := DataOntologyStore{
		Users:       dataOntologyUsers,
		Databases:   dataOntologyDatabases,
		Apis:        dataOntologyApis,
		AIConfig:    dataOntologyAIConfig,
		Tasks:       governanceTasks,
		TaskLogs:    governanceTaskLogs,
		MCPEnabled:  dataOntologyMCPEnabled,
		LLMModels:   llmModels,
		SmallModels: smallModels,
	}
	storePath := getDataOntologyStorePathFn()
	storeData, _ := json.MarshalIndent(store, "", "  ")
	os.WriteFile(storePath, storeData, 0644)

	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "日志已清空"})
}

// handleGovernanceTaskRun 执行治理任务（后端异步执行）
func handleGovernanceTaskRun(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}

	task, _, ok := requireGovernanceTaskAccess(w, r, taskID)
	if !ok {
		return
	}
	token := ""
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		token = strings.TrimPrefix(auth, "Bearer ")
	}
	if token == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	// 解析请求（支持 multipart 和 JSON）
	var inputText string
	var filePaths []string

	contentType := r.Header.Get("Content-Type")
	if strings.Contains(contentType, "multipart/form-data") {
		// multipart 上传
		maxSize := int64(100 * 1024 * 1024) // 100MB
		r.Body = http.MaxBytesReader(w, r.Body, maxSize)
		if err := r.ParseMultipartForm(maxSize); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "解析表单失败: " + err.Error()})
			return
		}
		inputText = r.FormValue("input_text")

		// 保存上传的文件（须在循环内立即 Close，勿 defer：否则返回响应后才会刷盘，
		// 后台 governanceWorker 可能先读到未落盘的空/截断文件）
		files := r.MultipartForm.File["files"]
		for _, fileHeader := range files {
			// 安全验证：清理文件名，防止路径遍历攻击
			safeFilename, err := sanitizeFilename(fileHeader.Filename)
			if err != nil {
				log.Printf("[Governance] 文件名无效: %v", err)
				continue
			}
			file, err := fileHeader.Open()
			if err != nil {
				continue
			}
			tmpDir := filepath.Join(os.TempDir(), "gov-tasks", taskID)
			if err := os.MkdirAll(tmpDir, 0755); err != nil {
				file.Close()
				continue
			}
			tmpPath := filepath.Join(tmpDir, safeFilename)
			dst, err := os.Create(tmpPath)
			if err != nil {
				file.Close()
				continue
			}
			_, copyErr := io.Copy(dst, file)
			file.Close()
			closeErr := dst.Close()
			if copyErr != nil {
				os.Remove(tmpPath)
				continue
			}
			if closeErr != nil {
				os.Remove(tmpPath)
				continue
			}
			filePaths = append(filePaths, tmpPath)
		}
	} else {
		// JSON 请求
		var req struct {
			InputText string `json:"input_text"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		inputText = req.InputText
	}

	// 创建任务
	runID := uuid.New().String()
	startedAt := time.Now().Format(time.RFC3339)
	job := &GovernanceJob{
		TaskID:     taskID,
		RunID:      runID,
		Token:      token,
		InputFiles: filePaths,
		InputText:  inputText,
	}

	// 更新任务状态
	dataOntologyMu.Lock()
	task.Status = "running"
	task.RunID = runID
	task.StartedAt = startedAt
	task.TotalFiles = len(filePaths)
	task.ProcessedFiles = 0
	task.Percent = 0
	task.CurrentFile = ""
	dataOntologyMu.Unlock()

	// 先入队前写入「运行中」日志并落库；勿在日志落库之前单独 save 任务，否则刷新页面可能只见 running 而无执行记录
	governanceAppendRunningLog(taskID, job, startedAt)

	// 入队
	select {
	case governanceJobQueue <- job:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"run_id":  runID,
			"message": "任务已入队，正在后台执行",
		})
	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "任务队列已满，请稍后重试",
		})
	}
}

// handleGovernanceTaskProgress 获取任务执行进度
func handleGovernanceTaskProgress(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")
	_, _, ok := requireGovernanceTaskAccess(w, r, taskID)
	if !ok {
		return
	}
	dataOntologyMu.RLock()
	task, exists := governanceTasks[taskID]
	dataOntologyMu.RUnlock()

	if !exists {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务不存在"})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"status":          task.Status,
		"run_id":          task.RunID,
		"total_files":     task.TotalFiles,
		"processed_files": task.ProcessedFiles,
		"percent":         task.Percent,
		"current_file":    task.CurrentFile,
		"started_at":      task.StartedAt,
		"last_output":     task.LastOutput,
		"last_error":      task.LastError,
	})
}

// handleGovernanceTaskUpload 不再需要，交互任务在前端直接处理文件
func handleGovernanceTaskUpload(w http.ResponseWriter, r *http.Request, taskID string) {
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "请在前端直接处理文件"})
}

// handleGovernanceTaskSaveLog 保存客户端执行日志
func handleGovernanceTaskSaveLog(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}
	_, _, ok := requireGovernanceTaskAccess(w, r, taskID)
	if !ok {
		return
	}

	var req struct {
		Status string `json:"status"`
		Output string `json:"output"`
		Error  string `json:"error"`
		Input  string `json:"input"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}

	now := time.Now().Format(time.RFC3339)
	logEntry := &GovernanceTaskLog{
		ID:        uuid.New().String(),
		TaskID:    taskID,
		StartTime: now,
		EndTime:   now,
		Status:    req.Status,
		Output:    req.Output,
		Error:     req.Error,
		Input:     req.Input,
	}

	dataOntologyMu.Lock()
	task, exists := governanceTasks[taskID]
	if !exists {
		dataOntologyMu.Unlock()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务不存在"})
		return
	}
	task.Status = req.Status
	task.LastRunAt = now
	task.LastOutput = req.Output
	task.LastError = req.Error

	governanceTaskLogs[taskID] = append(governanceTaskLogs[taskID], logEntry)
	if len(governanceTaskLogs[taskID]) > 50 {
		governanceTaskLogs[taskID] = governanceTaskLogs[taskID][len(governanceTaskLogs[taskID])-50:]
	}
	dataOntologyMu.Unlock()

	if err := saveDataOntologyStore(); err != nil {
		log.Printf("保存治理任务执行日志失败: %v", err)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// sanitizeGovernanceExampleFilename 仅允许治理示例目录下的单个文件名（无路径穿越）
func sanitizeGovernanceExampleFilename(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	// 允许前端/历史数据传入相对路径，但最终必须归一化为纯文件名。
	base := filepath.Base(s)
	if base == "." || base == string(filepath.Separator) || base == "" {
		return ""
	}
	if base != s {
		// 只接受纯 basename；任何目录穿越/子目录都拒绝。
		return ""
	}
	if strings.Contains(base, "..") || strings.Contains(base, "/") || strings.Contains(base, "\\") {
		return ""
	}
	return base
}

// handleGovernanceExamplesList GET …/examples 返回示例文件列表
func handleGovernanceExamplesList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	_ = username

	// 从 embed.FS 读取示例文件列表
	entries, err := governanceExamplesFS.ReadDir("examples/governance")
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "读取示例目录失败"})
		return
	}

	type ExampleFile struct {
		Name string `json:"name"`
		Size int64  `json:"size"`
	}

	var examples []ExampleFile
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".docx") {
			info, err := entry.Info()
			size := int64(0)
			if err == nil {
				size = info.Size()
			}
			examples = append(examples, ExampleFile{
				Name: entry.Name(),
				Size: size,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"examples": examples,
	})
}

// handleGovernanceExampleDownload GET …/examples/{filename}；POST …/examples/reload 为预置示例热更新
func handleGovernanceExampleDownload(w http.ResponseWriter, r *http.Request) {
	rawPath := strings.TrimPrefix(r.URL.Path, "/api/data-ontology/governance/examples/")
	if rawPath == r.URL.Path {
		rawPath = strings.TrimPrefix(r.URL.Path, "/api/governance/examples/")
	}
	rawPath = strings.TrimPrefix(rawPath, "/")
	if r.Method == http.MethodPost && rawPath == "reload" {
		handleGovernanceExamplesReload(w, r)
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	_ = username
	raw := rawPath
	if raw == "download" {
		http.NotFound(w, r)
		return
	}
	// 空路径返回示例文件列表
	if raw == "" {
		handleGovernanceExamplesList(w, r)
		return
	}
	safe := sanitizeGovernanceExampleFilename(raw)
	if safe == "" {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	data, err := governanceExamplesFS.ReadFile("examples/governance/" + safe)
	if err != nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	w.Header().Set("Content-Disposition", `attachment; filename="`+safe+`"`)
	w.Write(data)
}

// handleGovernanceExamplesZipDownload POST body: {"paths":["a.docx","b.docx"]}
func handleGovernanceExamplesZipDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	_ = username
	var req struct {
		Paths []string `json:"paths"`
		Files []struct {
			Name string `json:"name"`
			Path string `json:"path"`
		} `json:"files"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}
	type zipItem struct {
		entryName string
		diskPath  string
	}
	var items []zipItem
	if len(req.Files) > 0 {
		for _, it := range req.Files {
			pathInput := strings.TrimSpace(it.Path)
			if pathInput == "" {
				pathInput = strings.TrimSpace(it.Name)
			}
			safe := sanitizeGovernanceExampleFilename(pathInput)
			if safe == "" {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "非法路径"})
				return
			}
			name := strings.TrimSpace(it.Name)
			if name == "" {
				name = safe
			}
			if strings.Contains(name, "/") || strings.Contains(name, "\\") || strings.Contains(name, "..") {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "非法文件名"})
				return
			}
			items = append(items, zipItem{entryName: name, diskPath: safe})
		}
	} else {
		for _, p := range req.Paths {
			safe := sanitizeGovernanceExampleFilename(p)
			if safe == "" {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "非法路径"})
				return
			}
			items = append(items, zipItem{entryName: safe, diskPath: safe})
		}
	}
	if len(items) == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "paths 或 files 不能为空"})
		return
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, it := range items {
		data, err := governanceExamplesFS.ReadFile("examples/governance/" + it.diskPath)
		if err != nil {
			zw.Close()
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "文件不存在"})
			return
		}
		f, err := zw.Create(it.entryName)
		if err != nil {
			zw.Close()
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
			return
		}
		if _, err := f.Write(data); err != nil {
			zw.Close()
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
			return
		}
	}
	if err := zw.Close(); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="governance-examples.zip"`)
	w.Write(buf.Bytes())
}

// handleGovernanceExamplesReload POST /api/data-ontology/governance/examples/reload
// 从当前进程内的 embed FS 将预置任务的 example_files（及可选的「综合日报生成器」js_code）同步到 data-store.json。
// 仅匹配内置任务名称，不修改用户自建任务。需管理员。
func handleGovernanceExamplesReload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}
	if _, ok := requireDataOntologyAdmin(w, r); !ok {
		return
	}
	var body struct {
		IncludeJS bool `json:"include_js"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	dataOntologyMu.Lock()
	n := syncGovernancePresetExamplesFromEmbed(body.IncludeJS)
	if n > 0 {
		if err := saveDataOntologyStore(); err != nil {
			dataOntologyMu.Unlock()
			log.Printf("保存治理预置示例同步失败: %v", err)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "保存失败"})
			return
		}
	}
	dataOntologyMu.Unlock()

	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "updated_tasks": n})
}

// handleGovernanceExecuteSQL 治理任务执行SQL（供前端JS调用）
// handleGovernanceDownloadOutput 下载单次任务生成的输出文件（gov-runner output_files）
func handleGovernanceDownloadOutput(w http.ResponseWriter, r *http.Request) {
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}
	runID := r.URL.Query().Get("run_id")
	safeName := sanitizeGovOutputFilename(r.URL.Query().Get("name"))
	if runID == "" || safeName == "" {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	dataOntologyMu.RLock()
	var owner string
	var found bool
	for _, t := range governanceTasks {
		if t.RunID == runID {
			owner = t.Owner
			found = true
			break
		}
	}
	dataOntologyMu.RUnlock()
	if !found || !dataOntologyResourceVisible(owner, username) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	path := filepath.Join(os.TempDir(), "gov-output-downloads", runID, safeName)
	if _, err := os.Stat(path); err != nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	w.Header().Set("Content-Disposition", `attachment; filename="`+safeName+`"`)
	http.ServeFile(w, r, path)
}

func handleGovernanceExecuteSQL(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}

	var req struct {
		DatabaseID string        `json:"database_id"`
		SQL        string        `json:"sql"`
		Params     []interface{} `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}
	if req.DatabaseID == "" || req.SQL == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "database_id 和 sql 不能为空"})
		return
	}

	dataOntologyMu.RLock()
	dbConfig, exists := dataOntologyDatabases[req.DatabaseID]
	dataOntologyMu.RUnlock()
	if !exists || !dataOntologyResourceVisible(dbConfig.Owner, username) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "数据库不存在"})
		return
	}

	// 使用连接池
	db, err := getDBFromPool(dbConfig)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "连接失败: " + err.Error()})
		return
	}

	sqlUpper := strings.TrimSpace(strings.ToUpper(req.SQL))
	if strings.HasPrefix(sqlUpper, "SELECT") || strings.HasPrefix(sqlUpper, "SHOW") || strings.HasPrefix(sqlUpper, "DESCRIBE") || strings.HasPrefix(sqlUpper, "EXPLAIN") {
		rows, err := db.Query(req.SQL, req.Params...)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "查询失败: " + err.Error()})
			return
		}
		defer rows.Close()

		columns, _ := rows.Columns()
		var results []map[string]interface{}
		for rows.Next() {
			values := make([]interface{}, len(columns))
			valuePtrs := make([]interface{}, len(columns))
			for i := range values {
				valuePtrs[i] = &values[i]
			}
			rows.Scan(valuePtrs...)
			row := make(map[string]interface{})
			for i, col := range columns {
				val := values[i]
				if b, ok := val.([]byte); ok {
					row[col] = string(b)
				} else {
					row[col] = val
				}
			}
			results = append(results, row)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"data":    results,
			"columns": columns,
			"count":   len(results),
		})
	} else {
		result, err := db.Exec(req.SQL, req.Params...)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "执行失败: " + err.Error()})
			return
		}
		affected, _ := result.RowsAffected()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":       true,
			"rows_affected": affected,
		})
	}
}

// ==================== 治理任务调度器 ====================

// reconcileStuckGovernanceRuns 服务启动时将仍处于 running 的任务视为已中断（队列与工作者状态不会在重启后保留）
func reconcileStuckGovernanceRuns() {
	dataOntologyMu.Lock()
	changed := false
	for id, t := range governanceTasks {
		if t == nil || t.Status != "running" {
			continue
		}
		t.Status = "idle"
		if t.LastError == "" {
			t.LastError = "上次执行未正常结束（服务重启或进程退出）"
		}
		rid := t.RunID
		t.RunID = ""
		t.TotalFiles = 0
		t.ProcessedFiles = 0
		t.Percent = 0
		t.CurrentFile = ""
		for _, l := range governanceTaskLogs[id] {
			if l != nil && l.Status == "running" && (rid == "" || l.RunID == rid) {
				l.Status = "error"
				l.Error = "执行中断（服务重启或进程退出）"
				l.EndTime = time.Now().Format(time.RFC3339)
				changed = true
				break
			}
		}
		changed = true
	}
	dataOntologyMu.Unlock()
	if changed {
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("收尾中断中的治理任务失败: %v", err)
		}
	}
}

// governanceJobInputSummary 生成异步任务输入摘要（供执行日志展示）
func governanceJobInputSummary(job *GovernanceJob) string {
	var parts []string
	if strings.TrimSpace(job.InputText) != "" {
		t := strings.TrimSpace(job.InputText)
		runes := []rune(t)
		if len(runes) > 200 {
			t = string(runes[:200]) + "…"
		}
		parts = append(parts, "文本: "+t)
	}
	if len(job.InputFiles) > 0 {
		names := make([]string, 0, len(job.InputFiles))
		for _, p := range job.InputFiles {
			names = append(names, filepath.Base(p))
		}
		parts = append(parts, "文件: "+strings.Join(names, ", "))
	}
	if len(parts) == 0 {
		return "（无输入）"
	}
	return strings.Join(parts, "；")
}

// governanceAppendRunningLog 异步任务开始时写入一条「运行中」日志（便于刷新页面后仍能看到执行记录）
func governanceAppendRunningLog(taskID string, job *GovernanceJob, startedAt string) {
	if startedAt == "" {
		startedAt = time.Now().Format(time.RFC3339)
	}
	dataOntologyMu.Lock()
	logEntry := &GovernanceTaskLog{
		ID:        uuid.New().String(),
		TaskID:    taskID,
		RunID:     job.RunID,
		StartTime: startedAt,
		Status:    "running",
		Input:     governanceJobInputSummary(job),
	}
	governanceTaskLogs[taskID] = append(governanceTaskLogs[taskID], logEntry)
	if len(governanceTaskLogs[taskID]) > 50 {
		governanceTaskLogs[taskID] = governanceTaskLogs[taskID][len(governanceTaskLogs[taskID])-50:]
	}
	dataOntologyMu.Unlock()
	if err := saveDataOntologyStore(); err != nil {
		log.Printf("保存治理任务运行中日志失败: %v", err)
	}
}

// governanceFinalizeRunLog 将对应 run_id 的「运行中」日志更新为结束状态；若无则追加一条完成记录
func governanceFinalizeRunLog(taskID, runID, status, output, errStr string) {
	if runID == "" {
		runID = uuid.New().String()
	}
	now := time.Now().Format(time.RFC3339)
	dataOntologyMu.Lock()
	logs := governanceTaskLogs[taskID]
	found := false
	for _, l := range logs {
		if l.RunID == runID && l.Status == "running" {
			l.Status = status
			l.Output = output
			l.Error = errStr
			l.EndTime = now
			found = true
			break
		}
	}
	if !found {
		governanceTaskLogs[taskID] = append(governanceTaskLogs[taskID], &GovernanceTaskLog{
			ID:        uuid.New().String(),
			TaskID:    taskID,
			RunID:     runID,
			StartTime: now,
			EndTime:   now,
			Status:    status,
			Output:    output,
			Error:     errStr,
		})
	}
	if len(governanceTaskLogs[taskID]) > 50 {
		governanceTaskLogs[taskID] = governanceTaskLogs[taskID][len(governanceTaskLogs[taskID])-50:]
	}
	dataOntologyMu.Unlock()
	if err := saveDataOntologyStore(); err != nil {
		log.Printf("保存治理任务完成日志失败: %v", err)
	}
}

// governanceFinalizeRunLogFromTask 根据任务当前状态将本次 run 的执行日志落库
func governanceFinalizeRunLogFromTask(taskID, runID string) {
	dataOntologyMu.RLock()
	var outStr, errStr string
	status := "error"
	if t, ok := governanceTasks[taskID]; ok {
		if t.Status == "success" {
			status = "success"
		}
		outStr = t.LastOutput
		errStr = t.LastError
	}
	dataOntologyMu.RUnlock()
	if status == "success" {
		governanceFinalizeRunLog(taskID, runID, "success", outStr, "")
	} else {
		governanceFinalizeRunLog(taskID, runID, "error", outStr, errStr)
	}
}

// governanceWorker 任务执行器，从队列取出任务并执行
func governanceWorker() {
	for job := range governanceJobQueue {
		executeGovernanceJob(job)
	}
}

// executeGovernanceTaskForAPI 为 API 调用执行任务（同步返回结果）
func executeGovernanceTaskForAPI(task *GovernanceTask, params map[string]interface{}) (interface{}, error) {
	// 获取任务信息
	dataOntologyMu.RLock()
	dbID := task.DatabaseID
	dbType := ""
	if db, ok := dataOntologyDatabases[dbID]; ok {
		dbType = db.Type
	}
	// 构建数据库列表
	var databases []map[string]string
	for id, db := range dataOntologyDatabases {
		if !dataOntologyResourceVisible(db.Owner, task.Owner) {
			continue
		}
		databases = append(databases, map[string]string{
			"id":   id,
			"name": db.Name,
			"type": db.Type,
		})
	}
	dataOntologyMu.RUnlock()

	// 准备任务参数
	taskData := map[string]interface{}{
		"code":        task.JsCode,
		"token":       "", // API 调用不需要 token
		"database_id": dbID,
		"db_type":     dbType,
		"databases":   databases,
		"input_text":  "",
		"api_params":  params, // 传入 API 参数
	}

	// 处理文件参数（如果有的话）
	if fileBase64, ok := params["file_base64"].(string); ok {
		taskData["file_base64"] = fileBase64
	}
	if fileName, ok := params["file_name"].(string); ok {
		taskData["file_name"] = fileName
	}
	if inputText, ok := params["input_text"].(string); ok {
		taskData["input_text"] = inputText
	}

	// 执行任务
	result := callGovRunner(taskData)
	if !result.Success {
		return nil, fmt.Errorf(result.Error)
	}

	// 返回结果
	if len(result.Output) == 1 {
		return result.Output[0], nil
	}
	return result.Output, nil
}

// GovOutputFile gov-runner 生成的二进制输出
type GovOutputFile struct {
	Name          string `json:"name"`
	ContentBase64 string `json:"content_base64"`
}

// GovRunnerResult gov-runner 执行结果
type GovRunnerResult struct {
	Success     bool            `json:"success"`
	Output      []string        `json:"output"`
	Error       string          `json:"error"`
	OutputFiles []GovOutputFile `json:"output_files,omitempty"`
}

func sanitizeGovOutputFilename(name string) string {
	base := filepath.Base(name)
	if base == "." || base == "" {
		return "output.docx"
	}
	return base
}

// governanceWriteOutputFilesForShare 将分享任务的输出文件落盘到 share-outputs 目录
func governanceWriteOutputFilesForShare(shareToken string, runID string, files []GovOutputFile) []string {
	if shareToken == "" || runID == "" || len(files) == 0 {
		return nil
	}
	dir := filepath.Join("apps", "data-ontology", "share-outputs", shareToken, runID)
	_ = os.MkdirAll(dir, 0755)
	var lines []string
	for _, f := range files {
		if f.Name == "" || f.ContentBase64 == "" {
			continue
		}
		safe := sanitizeGovOutputFilename(f.Name)
		data, err := base64.StdEncoding.DecodeString(f.ContentBase64)
		if err != nil {
			continue
		}
		path := filepath.Join(dir, safe)
		if err := os.WriteFile(path, data, 0644); err != nil {
			continue
		}
		lines = append(lines, fmt.Sprintf("输出文件: %s", safe))
	}
	return lines
}

// governanceWriteOutputFiles 将 gov-runner 输出的文件落盘并返回日志行（含下载路径）
func governanceWriteOutputFiles(runID string, files []GovOutputFile) []string {
	if runID == "" || len(files) == 0 {
		return nil
	}
	dir := filepath.Join(os.TempDir(), "gov-output-downloads", runID)
	_ = os.MkdirAll(dir, 0755)
	var lines []string
	for _, f := range files {
		if f.Name == "" || f.ContentBase64 == "" {
			continue
		}
		safe := sanitizeGovOutputFilename(f.Name)
		data, err := base64.StdEncoding.DecodeString(f.ContentBase64)
		if err != nil {
			continue
		}
		path := filepath.Join(dir, safe)
		if err := os.WriteFile(path, data, 0644); err != nil {
			continue
		}
		q := url.Values{}
		q.Set("run_id", runID)
		q.Set("name", safe)
		lines = append(lines, fmt.Sprintf("输出文件 %s — 下载: /api/data-ontology/governance/download-output?%s", safe, q.Encode()))
	}
	return lines
}

// executeGovernanceJob 执行单个治理任务
func executeGovernanceJob(job *GovernanceJob) {
	taskID := job.TaskID
	runID := job.RunID
	isShare := job.ShareToken != ""

	// 获取任务信息
	dataOntologyMu.RLock()
	task, exists := governanceTasks[taskID]
	if !exists {
		dataOntologyMu.RUnlock()
		if isShare {
			updateShareRun(runID, "failed", 0, "任务不存在", nil)
		}
		return
	}
	code := task.JsCode
	dbID := task.DatabaseID
	batchMode := task.FileBatchMode
	if batchMode == "" {
		batchMode = "per_file"
	}
	dbType := ""
	if db, ok := dataOntologyDatabases[dbID]; ok {
		dbType = db.Type
	}
	// 构建数据库列表（仅包含任务所属用户可见的配置，避免泄露他人连接信息）
	var databases []map[string]string
	for id, db := range dataOntologyDatabases {
		if !dataOntologyResourceVisible(db.Owner, task.Owner) {
			continue
		}
		databases = append(databases, map[string]string{
			"id":   id,
			"name": db.Name,
			"type": db.Type,
		})
	}
	dataOntologyMu.RUnlock()

	// 如果是分享任务，初始化执行记录
	if isShare {
		updateShareRun(runID, "running", 0, "开始执行...", nil)
	}

	// 准备任务参数
	taskData := map[string]interface{}{
		"code":        code,
		"token":       job.Token,
		"database_id": dbID,
		"db_type":     dbType,
		"databases":   databases,
		"input_text":  job.InputText,
	}
	// 如果是分享任务，传入 share_token 让 runner 使用免鉴权端点
	if isShare {
		taskData["share_token"] = job.ShareToken
	}

	// 如果有文件，读取并转为 base64
	if len(job.InputFiles) > 0 {
		if batchMode == "single" {
			var filePayloads []map[string]interface{}
			for _, filePath := range job.InputFiles {
				data, err := os.ReadFile(filePath)
				if err != nil {
					log.Printf("读取文件失败: %v", err)
					errMsg := "读取文件失败: " + err.Error()
					if isShare {
						updateShareRun(runID, "failed", 100, errMsg, nil)
					} else {
						dataOntologyMu.Lock()
						if t, ok := governanceTasks[taskID]; ok {
							t.Status = "error"
							t.LastError = errMsg
							t.LastRunAt = time.Now().Format(time.RFC3339)
							t.ProcessedFiles = len(job.InputFiles)
							t.Percent = 100
						}
						dataOntologyMu.Unlock()
						saveDataOntologyStore()
						governanceFinalizeRunLogFromTask(taskID, runID)
					}
					tmpDir := filepath.Join(os.TempDir(), "gov-tasks", taskID)
					os.RemoveAll(tmpDir)
					return
				}
				filePayloads = append(filePayloads, map[string]interface{}{
					"file_name":   filepath.Base(filePath),
					"file_base64": base64.StdEncoding.EncodeToString(data),
				})
			}
			// 分享任务保留输入文件供用户下载，普通任务读取后删除节省空间
			if !isShare {
				for _, filePath := range job.InputFiles {
					os.Remove(filePath)
				}
			}
			taskData["files"] = filePayloads

			if isShare {
				updateShareRun(runID, "running", 50, "合并执行...", nil)
			} else {
				dataOntologyMu.Lock()
				if t, ok := governanceTasks[taskID]; ok {
					t.ProcessedFiles = 0
					t.Percent = 50
					t.CurrentFile = "合并执行"
				}
				dataOntologyMu.Unlock()
				saveDataOntologyStore()
			}

			result := callGovRunner(taskData)
			var extraLines []string
			if len(result.OutputFiles) > 0 {
				if isShare {
					// 分享任务：写入到 share-outputs 目录
					extraLines = governanceWriteOutputFilesForShare(job.ShareToken, runID, result.OutputFiles)
				} else {
					extraLines = governanceWriteOutputFiles(job.RunID, result.OutputFiles)
				}
			}
			if !result.Success {
				log.Printf("任务 %s 合并执行失败: %s", taskID, result.Error)
			} else {
				log.Printf("任务 %s 合并执行成功", taskID)
			}

			if isShare {
				var resultFiles []string
				for _, f := range result.OutputFiles {
					resultFiles = append(resultFiles, f.Name)
				}
				status := "completed"
				output := strings.Join(result.Output, "\n")
				if len(extraLines) > 0 {
					output += "\n" + strings.Join(extraLines, "\n")
				}
				if !result.Success {
					status = "failed"
					output = result.Error + "\n" + output
				}
				updateShareRun(runID, status, 100, output, resultFiles)
			} else {
				dataOntologyMu.Lock()
				if t, ok := governanceTasks[taskID]; ok {
					if result.Success {
						t.Status = "success"
						out := strings.Join(result.Output, "\n")
						if len(extraLines) > 0 {
							out += "\n" + strings.Join(extraLines, "\n")
						}
						t.LastOutput = out
					} else {
						t.Status = "error"
						t.LastError = result.Error
						if len(result.Output) > 0 {
							t.LastOutput = strings.Join(result.Output, "\n")
						}
					}
					t.LastRunAt = time.Now().Format(time.RFC3339)
					t.ProcessedFiles = len(job.InputFiles)
					t.Percent = 100
					t.CurrentFile = ""
				}
				dataOntologyMu.Unlock()
				saveDataOntologyStore()
				governanceFinalizeRunLogFromTask(taskID, runID)
			}
		} else {
			var allOutput []string
			var lastError string

			for i, filePath := range job.InputFiles {
				data, err := os.ReadFile(filePath)
				if err != nil {
					log.Printf("读取文件失败: %v", err)
					lastError = "读取文件失败: " + err.Error()
					continue
				}
				taskData["file_base64"] = base64.StdEncoding.EncodeToString(data)
				taskData["file_name"] = filepath.Base(filePath)

				// 更新进度
				progress := (i * 100) / len(job.InputFiles)
				if isShare {
					updateShareRun(runID, "running", progress, fmt.Sprintf("处理文件: %s", filepath.Base(filePath)), nil)
				} else {
					dataOntologyMu.Lock()
					if t, ok := governanceTasks[taskID]; ok {
						t.ProcessedFiles = i
						t.Percent = progress
						t.CurrentFile = filepath.Base(filePath)
					}
					dataOntologyMu.Unlock()
					saveDataOntologyStore()
				}

				// 执行单个文件
				result := callGovRunner(taskData)
				var extraLines []string
				if len(result.OutputFiles) > 0 {
					if isShare {
						extraLines = governanceWriteOutputFilesForShare(job.ShareToken, runID, result.OutputFiles)
					} else {
						extraLines = governanceWriteOutputFiles(job.RunID, result.OutputFiles)
					}
				}
				if !result.Success {
					log.Printf("任务 %s 文件 %s 执行失败: %s", taskID, filePath, result.Error)
					lastError = result.Error
					if len(result.Output) > 0 {
						allOutput = append(allOutput, result.Output...)
					}
					if len(extraLines) > 0 {
						allOutput = append(allOutput, extraLines...)
					}
				} else {
					log.Printf("任务 %s 文件 %s 执行成功", taskID, filePath)
					allOutput = append(allOutput, result.Output...)
					if len(extraLines) > 0 {
						allOutput = append(allOutput, extraLines...)
					}
				}

				// 清理临时文件
				os.Remove(filePath)

				// 每处理完一个文件更新输出
				if isShare {
					updateShareRun(runID, "running", progress, strings.Join(allOutput, "\n"), nil)
				} else {
					dataOntologyMu.Lock()
					if t, ok := governanceTasks[taskID]; ok {
						if len(allOutput) > 0 {
							t.LastOutput = strings.Join(allOutput, "\n")
						}
						if lastError != "" {
							t.LastError = lastError
						}
					}
					dataOntologyMu.Unlock()
					saveDataOntologyStore()
				}
			}

			// 更新最终状态
			if isShare {
				var resultFiles []string
				// 收集所有输出文件名
				outputDir := filepath.Join("apps", "data-ontology", "share-outputs", job.ShareToken, runID)
				if files, err := os.ReadDir(outputDir); err == nil {
					for _, f := range files {
						if !f.IsDir() {
							resultFiles = append(resultFiles, f.Name())
						}
					}
				}
				status := "completed"
				output := strings.Join(allOutput, "\n")
				if lastError != "" {
					status = "failed"
					output = lastError + "\n" + output
				}
				updateShareRun(runID, status, 100, output, resultFiles)
			} else {
				dataOntologyMu.Lock()
				if t, ok := governanceTasks[taskID]; ok {
					if lastError == "" {
						t.Status = "success"
						t.LastOutput = strings.Join(allOutput, "\n")
					} else {
						t.Status = "error"
						t.LastError = lastError
						if len(allOutput) > 0 {
							t.LastOutput = strings.Join(allOutput, "\n")
						}
					}
					t.LastRunAt = time.Now().Format(time.RFC3339)
					t.ProcessedFiles = len(job.InputFiles)
					t.Percent = 100
				}
				dataOntologyMu.Unlock()
				saveDataOntologyStore()
				governanceFinalizeRunLogFromTask(taskID, runID)
			}
		}
	} else {
		// 无文件，直接执行
		result := callGovRunner(taskData)
		if !result.Success {
			log.Printf("任务 %s 执行失败: %s", taskID, result.Error)
		} else {
			log.Printf("任务 %s 执行成功，输出: %v", taskID, result.Output)
		}

		// 更新任务状态
		if isShare {
			var resultFiles []string
			var extraLines []string
			if len(result.OutputFiles) > 0 {
				extraLines = governanceWriteOutputFilesForShare(job.ShareToken, runID, result.OutputFiles)
				for _, f := range result.OutputFiles {
					resultFiles = append(resultFiles, f.Name)
				}
			}
			status := "completed"
			output := strings.Join(result.Output, "\n")
			if len(extraLines) > 0 {
				output += "\n" + strings.Join(extraLines, "\n")
			}
			if !result.Success {
				status = "failed"
				output = result.Error + "\n" + output
			}
			updateShareRun(runID, status, 100, output, resultFiles)
		} else {
			dataOntologyMu.Lock()
			if t, ok := governanceTasks[taskID]; ok {
				if result.Success {
					t.Status = "success"
					t.LastOutput = strings.Join(result.Output, "\n")
				} else {
					t.Status = "error"
					t.LastError = result.Error
				}
				t.LastRunAt = time.Now().Format(time.RFC3339)
			}
			dataOntologyMu.Unlock()
			saveDataOntologyStore()
			governanceFinalizeRunLogFromTask(taskID, runID)
		}
	}

	// 清理临时目录
	if len(job.InputFiles) > 0 {
		tmpDir := filepath.Join(os.TempDir(), "gov-tasks", taskID)
		os.RemoveAll(tmpDir)
	}
}

// callGovRunner 调用 gov-runner 执行任务
func callGovRunner(taskData map[string]interface{}) *GovRunnerResult {
	runnerPath, err := resolveGovRunnerPath()
	if err != nil {
		return &GovRunnerResult{
			Success: false,
			Error:   err.Error(),
		}
	}

	// 写入临时任务文件
	taskJSON, _ := json.Marshal(taskData)
	tmpFile := filepath.Join(os.TempDir(), fmt.Sprintf("gov-task-%d.json", time.Now().UnixNano()))
	if err := os.WriteFile(tmpFile, taskJSON, 0644); err != nil {
		return &GovRunnerResult{
			Success: false,
			Error:   "写入任务文件失败: " + err.Error(),
		}
	}
	defer os.Remove(tmpFile)

	// 执行 gov-runner
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, runnerPath, tmpFile)
	apiBase := govRunnerAPIBase
	if apiBase == "" {
		apiBase = "http://127.0.0.1:8080"
	}
	cmd.Env = append(os.Environ(), "GOV_RUNNER_CLI=true", "API_BASE="+apiBase)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	outBytes := bytes.TrimSpace(stdout.Bytes())
	errBytes := bytes.TrimSpace(stderr.Bytes())

	if len(outBytes) == 0 {
		if runErr != nil {
			errMsg := runErr.Error()
			if len(errBytes) > 0 {
				errMsg += " | stderr: " + string(errBytes)
			}
			return &GovRunnerResult{Success: false, Error: "执行失败: " + errMsg}
		}
		errMsg := "gov-runner 无输出"
		if len(errBytes) > 0 {
			errMsg += " | stderr: " + string(errBytes)
		}
		return &GovRunnerResult{Success: false, Error: errMsg}
	}

	var result GovRunnerResult
	if err := json.Unmarshal(outBytes, &result); err != nil {
		return &GovRunnerResult{
			Success: false,
			Error:   "解析结果失败: " + err.Error(),
		}
	}
	return &result
}

func governanceScheduler() {
	for {
		time.Sleep(30 * time.Second)
		now := time.Now()

		dataOntologyMu.RLock()
		var tasksToRun []struct {
			id   string
			code string
			dbID string
		}
		for _, task := range governanceTasks {
			if task.Type == "scheduled" && task.Enabled && task.Status != "running" {
				if cronMatch(task.CronExpr, now) {
					tasksToRun = append(tasksToRun, struct {
						id   string
						code string
						dbID string
					}{task.ID, task.JsCode, task.DatabaseID})
				}
			}
		}
		dataOntologyMu.RUnlock()

		for _, t := range tasksToRun {
			log.Printf("定时任务触发: %s (需在前端执行)", t.id)
			_ = t.code
			_ = t.dbID
		}
	}
}

// cronMatch 简易 cron 表达式匹配 "分 时 日 月 周"
func cronMatch(expr string, t time.Time) bool {
	if expr == "" {
		return false
	}
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return false
	}
	values := []int{t.Minute(), t.Hour(), t.Day(), int(t.Month()), int(t.Weekday())}
	for i, field := range fields {
		if !cronFieldMatch(field, values[i]) {
			return false
		}
	}
	return true
}

func cronFieldMatch(field string, value int) bool {
	if field == "*" {
		return true
	}
	// 支持逗号分隔
	for _, part := range strings.Split(field, ",") {
		part = strings.TrimSpace(part)
		// 支持 */n 步进
		if strings.HasPrefix(part, "*/") {
			step, err := strconv.Atoi(strings.TrimPrefix(part, "*/"))
			if err == nil && step > 0 && value%step == 0 {
				return true
			}
			continue
		}
		// 支持 a-b 范围
		if strings.Contains(part, "-") {
			rangeParts := strings.Split(part, "-")
			if len(rangeParts) == 2 {
				low, err1 := strconv.Atoi(rangeParts[0])
				high, err2 := strconv.Atoi(rangeParts[1])
				if err1 == nil && err2 == nil && value >= low && value <= high {
					return true
				}
			}
			continue
		}
		// 精确匹配
		v, err := strconv.Atoi(part)
		if err == nil && v == value {
			return true
		}
	}
	return false
}

// ===== SSH/SFTP 运维支持 =====

// SFTPSession 保存一个 SFTP 会话的 SSH+SFTP 客户端
type SFTPSession struct {
	ID         string
	SSHClient  *gossh.Client
	SFTPClient *sftp.Client
	LastUsed   time.Time
}

var (
	sftpSessionsMu  sync.RWMutex
	sftpSessionsMap = make(map[string]*SFTPSession)
)

// getSFTPSession 线程安全地获取并刷新会话最后使用时间
func getSFTPSession(id string) *SFTPSession {
	sftpSessionsMu.Lock()
	defer sftpSessionsMu.Unlock()
	s := sftpSessionsMap[id]
	if s != nil {
		s.LastUsed = time.Now()
	}
	return s
}

// startSFTPSessionCleaner 定期清理未使用的 SFTP 会话
func startSFTPSessionCleaner() {
	go func() {
		ticker := time.NewTicker(SFTPCleanInterval)
		defer ticker.Stop()
		for range ticker.C {
			sftpSessionsMu.Lock()
			for id, s := range sftpSessionsMap {
				if time.Since(s.LastUsed) > SFTPSessionTTL {
					s.SFTPClient.Close()
					s.SSHClient.Close()
					delete(sftpSessionsMap, id)
				}
			}
			sftpSessionsMu.Unlock()
		}
	}()
}

// startTokenCleaner 定期清理过期的登录 token
func startTokenCleaner() {
	go func() {
		ticker := time.NewTicker(TokenCleanInterval)
		defer ticker.Stop()
		for range ticker.C {
			dataOntologyMu.Lock()
			now := time.Now().Unix()
			cleaned := 0
			for _, user := range dataOntologyUsers {
				if user == nil {
					continue
				}
				// 清理过期的 TokenEntries
				validEntries := make([]TokenEntry, 0)
				for _, entry := range user.TokenEntries {
					if now-entry.CreatedAt <= int64(dataOntologyTokenTTL.Seconds()) {
						validEntries = append(validEntries, entry)
					} else {
						cleaned++
					}
				}
				user.TokenEntries = validEntries
				// 同步更新 Tokens 列表（移除过期的）
				validTokens := make([]string, 0)
				for _, entry := range validEntries {
					validTokens = append(validTokens, entry.Token)
				}
				user.Tokens = validTokens
			}
			if cleaned > 0 {
				log.Printf("[TokenCleaner] 清理了 %d 个过期 token", cleaned)
				dataOntologyMu.Unlock()
				saveDataOntologyStore()
				dataOntologyMu.Lock()
			}
			dataOntologyMu.Unlock()
		}
	}()
}

// opsSSHWriter 将 io.Write 调用转发到回调函数（用于 SSH stdout/stderr → WebSocket）
type opsSSHWriter struct {
	fn func([]byte)
}

func (w *opsSSHWriter) Write(p []byte) (n int, err error) {
	b := make([]byte, len(p))
	copy(b, p)
	w.fn(b)
	return len(p), nil
}

// handleSSHWebSocket 通过 WebSocket 代理 SSH 终端
// 连接参数通过 URL Query 传入：host, port, user, password
func handleSSHWebSocket(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	host := q.Get("host")
	portStr := q.Get("port")
	user := q.Get("user")
	password := q.Get("password")

	if host == "" || user == "" {
		http.Error(w, "missing host or user", http.StatusBadRequest)
		return
	}
	if portStr == "" {
		portStr = "22"
	}

	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer wsConn.Close()

	var wsMu sync.Mutex
	writeWS := func(data []byte) {
		wsMu.Lock()
		defer wsMu.Unlock()
		wsConn.WriteMessage(websocket.BinaryMessage, data)
	}
	writeWSText := func(text string) {
		wsMu.Lock()
		defer wsMu.Unlock()
		wsConn.WriteMessage(websocket.TextMessage, []byte(text))
	}

	sshConfig := &gossh.ClientConfig{
		User:            user,
		Auth:            []gossh.AuthMethod{gossh.Password(password)},
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
		Timeout:         SSHConnectTimeout,
	}

	sshClient, err := gossh.Dial("tcp", host+":"+portStr, sshConfig)
	if err != nil {
		writeWSText("\r\n\x1b[31m[连接失败] " + err.Error() + "\x1b[0m\r\n")
		return
	}
	defer sshClient.Close()

	session, err := sshClient.NewSession()
	if err != nil {
		writeWSText("\r\n\x1b[31m[会话创建失败] " + err.Error() + "\x1b[0m\r\n")
		return
	}
	defer session.Close()

	stdinPipe, err := session.StdinPipe()
	if err != nil {
		writeWSText("\r\n\x1b[31m[stdin 管道失败] " + err.Error() + "\x1b[0m\r\n")
		return
	}

	session.Stdout = &opsSSHWriter{fn: writeWS}
	session.Stderr = &opsSSHWriter{fn: writeWS}

	modes := gossh.TerminalModes{
		gossh.ECHO:          1,
		gossh.TTY_OP_ISPEED: 38400,
		gossh.TTY_OP_OSPEED: 38400,
	}
	if err := session.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		writeWSText("\r\n\x1b[31m[PTY 请求失败] " + err.Error() + "\x1b[0m\r\n")
		return
	}
	if err := session.Shell(); err != nil {
		writeWSText("\r\n\x1b[31m[Shell 启动失败] " + err.Error() + "\x1b[0m\r\n")
		return
	}

	// 读取浏览器键盘输入，转发到 SSH stdin
	go func() {
		for {
			_, msg, err := wsConn.ReadMessage()
			if err != nil {
				session.Close()
				return
			}
			// 处理终端尺寸调整消息 {"type":"resize","cols":80,"rows":24}
			if len(msg) > 1 && msg[0] == '{' {
				var rm struct {
					Type string `json:"type"`
					Cols int    `json:"cols"`
					Rows int    `json:"rows"`
				}
				if json.Unmarshal(msg, &rm) == nil && rm.Type == "resize" {
					session.WindowChange(rm.Rows, rm.Cols)
					continue
				}
			}
			stdinPipe.Write(msg)
		}
	}()

	session.Wait()
	writeWSText("\r\n\x1b[33m[会话已结束]\x1b[0m\r\n")
}

// handleSFTPConnect POST /api/ops/sftp/connect
func handleSFTPConnect(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}
	if r.Method != http.MethodPost {
		apiMethodNotAllowed(w, "仅支持 POST")
		return
	}
	var req struct {
		Host     string `json:"host"`
		Port     string `json:"port"`
		User     string `json:"user"`
		Password string `json:"password"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Host == "" || req.User == "" {
		apiBadRequest(w, "host 和 user 不能为空")
		return
	}
	if req.Port == "" {
		req.Port = "22"
	}

	sshConfig := &gossh.ClientConfig{
		User:            req.User,
		Auth:            []gossh.AuthMethod{gossh.Password(req.Password)},
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
		Timeout:         SSHConnectTimeout,
	}
	sshClient, err := gossh.Dial("tcp", req.Host+":"+req.Port, sshConfig)
	if err != nil {
		log.Printf("[SFTP] SSH连接失败: host=%s, err=%v", req.Host, err)
		apiBadRequest(w, "SSH 连接失败")
		return
	}
	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		sshClient.Close()
		log.Printf("[SFTP] SFTP初始化失败: host=%s, err=%v", req.Host, err)
		apiBadRequest(w, "SFTP 初始化失败")
		return
	}

	sessionID := uuid.New().String()
	sftpSessionsMu.Lock()
	sftpSessionsMap[sessionID] = &SFTPSession{
		ID:         sessionID,
		SSHClient:  sshClient,
		SFTPClient: sftpClient,
		LastUsed:   time.Now(),
	}
	sftpSessionsMu.Unlock()

	homePath := "/"
	if wd, err := sftpClient.Getwd(); err == nil {
		homePath = wd
	}

	log.Printf("[SFTP] 连接成功: host=%s, user=%s, session=%s", req.Host, req.User, sessionID)
	jsonSuccess(w, map[string]interface{}{
		"success":     true,
		"sessionId":   sessionID,
		"currentPath": homePath,
	})
}

// handleSFTPList GET /api/ops/sftp/list?session=xxx&path=/
func handleSFTPList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}
	sessionID := r.URL.Query().Get("session")
	remotePath := r.URL.Query().Get("path")
	if remotePath == "" {
		remotePath = "/"
	}
	s := getSFTPSession(sessionID)
	if s == nil {
		apiBadRequest(w, "会话不存在或已过期，请重新连接")
		return
	}
	entries, err := s.SFTPClient.ReadDir(remotePath)
	if err != nil {
		log.Printf("[SFTP] 读取目录失败: session=%s, path=%s, err=%v", sessionID, remotePath, err)
		apiBadRequest(w, "读取目录失败")
		return
	}
	files := make([]map[string]interface{}, 0, len(entries)+1)
	if remotePath != "/" {
		files = append(files, map[string]interface{}{
			"name": "..", "size": int64(0), "isDir": true, "modTime": "", "permissions": "drwxr-xr-x",
		})
	}
	for _, e := range entries {
		files = append(files, map[string]interface{}{
			"name":        e.Name(),
			"size":        e.Size(),
			"isDir":       e.IsDir(),
			"modTime":     e.ModTime().Format("2006-01-02 15:04"),
			"permissions": e.Mode().String(),
		})
	}
	jsonSuccess(w, map[string]interface{}{"success": true, "path": remotePath, "files": files})
}

// handleSFTPUpload POST /api/ops/sftp/upload?session=xxx&path=/remote/dir
func handleSFTPUpload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}
	if r.Method != http.MethodPost {
		apiMethodNotAllowed(w, "仅支持 POST")
		return
	}
	sessionID := r.URL.Query().Get("session")
	remotePath := r.URL.Query().Get("path")
	s := getSFTPSession(sessionID)
	if s == nil {
		apiBadRequest(w, "会话不存在或已过期")
		return
	}
	r.ParseMultipartForm(200 << 20) // 200MB
	file, header, err := r.FormFile("file")
	if err != nil {
		apiBadRequest(w, "读取上传文件失败")
		return
	}
	defer file.Close()

	// 安全验证：清理文件名，防止路径遍历攻击
	safeFilename, err := sanitizeFilename(header.Filename)
	if err != nil {
		apiBadRequest(w, "文件名无效: "+err.Error())
		return
	}

	// 使用正斜杠拼接远程路径
	remoteFilePath := strings.TrimRight(remotePath, "/") + "/" + safeFilename
	dst, err := s.SFTPClient.Create(remoteFilePath)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "创建远程文件失败: " + err.Error()})
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, file); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "写入文件失败: " + err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "path": remoteFilePath})
}

// handleSFTPDownload GET /api/ops/sftp/download?session=xxx&path=/file
func handleSFTPDownload(w http.ResponseWriter, r *http.Request) {
	if !verifyToken(r) {
		http.Error(w, "未授权", http.StatusUnauthorized)
		return
	}
	sessionID := r.URL.Query().Get("session")
	remotePath := r.URL.Query().Get("path")
	s := getSFTPSession(sessionID)
	if s == nil {
		http.Error(w, "会话不存在或已过期", http.StatusBadRequest)
		return
	}
	src, err := s.SFTPClient.Open(remotePath)
	if err != nil {
		http.Error(w, "打开远程文件失败: "+err.Error(), http.StatusBadRequest)
		return
	}
	defer src.Close()
	if stat, err := src.Stat(); err == nil {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", stat.Size()))
	}
	// 提取文件名（远程路径使用正斜杠）
	parts := strings.Split(strings.TrimRight(remotePath, "/"), "/")
	filename := parts[len(parts)-1]
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Content-Type", "application/octet-stream")
	io.Copy(w, src)
}

// handleSFTPDisconnect POST /api/ops/sftp/disconnect
func handleSFTPDisconnect(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	var sessionID string
	sessionID = r.URL.Query().Get("session")
	if sessionID == "" {
		var req struct {
			Session string `json:"session"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		sessionID = req.Session
	}
	sftpSessionsMu.Lock()
	if s, ok := sftpSessionsMap[sessionID]; ok {
		s.SFTPClient.Close()
		s.SSHClient.Close()
		delete(sftpSessionsMap, sessionID)
	}
	sftpSessionsMu.Unlock()
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// handleSFTPMkdir POST /api/ops/sftp/mkdir  body: {session, path}
func handleSFTPMkdir(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var req struct {
		Session string `json:"session"`
		Path    string `json:"path"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	s := getSFTPSession(req.Session)
	if s == nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "会话不存在或已过期"})
		return
	}
	if err := sftpMkdirAll(s.SFTPClient, req.Path); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "创建目录失败: " + err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// handleSFTPDelete POST /api/ops/sftp/delete  body: {session, path}
func handleSFTPDelete(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var req struct {
		Session string `json:"session"`
		Path    string `json:"path"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	s := getSFTPSession(req.Session)
	if s == nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "会话不存在或已过期"})
		return
	}
	if err := sftpRemoveAll(s.SFTPClient, req.Path); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "删除失败: " + err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// handleSFTPRename POST /api/ops/sftp/rename  body: {session, oldPath, newPath}
func handleSFTPRename(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var req struct {
		Session string `json:"session"`
		OldPath string `json:"oldPath"`
		NewPath string `json:"newPath"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	s := getSFTPSession(req.Session)
	if s == nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "会话不存在或已过期"})
		return
	}
	if err := s.SFTPClient.Rename(req.OldPath, req.NewPath); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "重命名失败: " + err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// sftpMkdirAll 递归创建远程目录（POSIX 路径）
func sftpMkdirAll(client *sftp.Client, remotePath string) error {
	if _, err := client.Stat(remotePath); err == nil {
		return nil
	}
	// 计算父目录（手动处理正斜杠）
	clean := strings.TrimRight(remotePath, "/")
	lastSlash := strings.LastIndex(clean, "/")
	if lastSlash > 0 {
		parent := clean[:lastSlash]
		if err := sftpMkdirAll(client, parent); err != nil {
			return err
		}
	}
	return client.Mkdir(remotePath)
}

// sftpRemoveAll 递归删除远程文件或目录
func sftpRemoveAll(client *sftp.Client, remotePath string) error {
	stat, err := client.Stat(remotePath)
	if err != nil {
		return err
	}
	if !stat.IsDir() {
		return client.Remove(remotePath)
	}
	entries, err := client.ReadDir(remotePath)
	if err != nil {
		return err
	}
	for _, e := range entries {
		child := strings.TrimRight(remotePath, "/") + "/" + e.Name()
		if err := sftpRemoveAll(client, child); err != nil {
			return err
		}
	}
	return client.RemoveDirectory(remotePath)
}

// handleDatabaseTablesList 获取数据库表列表
func handleDatabaseTablesList(w http.ResponseWriter, r *http.Request, config *DatabaseConfig) {
	w.Header().Set("Content-Type", "application/json")

	if config.Type == "mongodb" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "MongoDB 暂不支持",
		})
		return
	}

	// SQL 数据库
	db, err := getDBFromPool(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接数据库失败",
		})
		return
	}

	// 获取表列表
	var query string
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb":
		query = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
	case "mysql", "mariadb", "tidb":
		query = "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()"
	case "sqlserver":
		query = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'"
	case "sqlite", "duckdb":
		query = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
	case "oracle":
		query = "SELECT table_name FROM user_tables"
	case "dm":
		query = "SELECT table_name FROM user_tables"
	default:
		query = "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()"
	}

	rows, err := db.Query(query)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询表列表失败",
		})
		return
	}

	var tables []string
	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err == nil {
			tables = append(tables, tableName)
		}
	}
	rows.Close()

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"tables":  tables,
	})
}

// handleOntologyScan 扫描所有数据库表结构，返回候选关系
func handleDatabaseOntologyScan(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}

	// 从URL中提取数据库ID
	pathParts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(pathParts) < 5 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的请求路径",
		})
		return
	}
	dbID := pathParts[3]

	// 检查数据库是否存在及权限
	dataOntologyMu.RLock()
	config, exists := dataOntologyDatabases[dbID]
	dataOntologyMu.RUnlock()

	if !exists || !dataOntologyResourceVisible(config.Owner, username) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在或无权限",
		})
		return
	}

	// 解析请求体，获取可选的表列表
	var requestBody struct {
		Tables []string `json:"tables"`
	}
	if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
		// 如果解析失败，使用空列表（扫描所有表）
		requestBody.Tables = nil
	}

	// 收集该数据库的字段信息
	type TableField struct {
		DatabaseID string
		TableName  string
		FieldName  string
		FieldType  string
	}

	allFields := make([]TableField, 0)

	if config.Type == "mongodb" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "MongoDB 暂不支持",
		})
		return
	}

	// SQL 数据库
	db, err := getDBFromPool(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接数据库失败",
		})
		return
	}

	// 获取表列表
	var query string
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb":
		query = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
	case "mysql", "mariadb", "tidb":
		query = "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()"
	case "sqlserver":
		query = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'"
	case "sqlite", "duckdb":
		query = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
	case "oracle":
		query = "SELECT table_name FROM user_tables"
	case "dm":
		query = "SELECT table_name FROM user_tables"
	default:
		query = "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()"
	}

	rows, err := db.Query(query)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询表列表失败",
		})
		return
	}

	var tables []string
	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err == nil {
			tables = append(tables, tableName)
		}
	}
	rows.Close()

	// 如果请求中指定了表列表，则只处理这些表
	if len(requestBody.Tables) > 0 {
		tableSet := make(map[string]bool)
		for _, t := range requestBody.Tables {
			tableSet[t] = true
		}
		var filteredTables []string
		for _, t := range tables {
			if tableSet[t] {
				filteredTables = append(filteredTables, t)
			}
		}
		tables = filteredTables
	}

	// 获取每个表的字段
	for _, tableName := range tables {
		var fieldQuery string
		switch config.Type {
		case "postgresql", "timescaledb", "cockroachdb":
			fieldQuery = fmt.Sprintf("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '%s'", tableName)
		case "mysql", "mariadb", "tidb":
			fieldQuery = fmt.Sprintf("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '%s' AND table_schema = DATABASE()", tableName)
		case "sqlite", "duckdb":
			fieldQuery = fmt.Sprintf("PRAGMA table_info(`%s`)", tableName)
		case "sqlserver":
			fieldQuery = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '%s'", tableName)
		case "oracle":
			fieldQuery = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s'", tableName)
		case "dm":
			fieldQuery = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s'", tableName)
		default:
			continue
		}

		fieldRows, err := db.Query(fieldQuery)
		if err != nil {
			continue
		}

		for fieldRows.Next() {
			var fieldName, fieldType string

			if config.Type == "sqlite" || config.Type == "duckdb" {
				var cid, notnull, pk int
				var dfltValue interface{}
				if err := fieldRows.Scan(&cid, &fieldName, &fieldType, &notnull, &dfltValue, &pk); err == nil {
					allFields = append(allFields, TableField{
						DatabaseID: dbID,
						TableName:  tableName,
						FieldName:  fieldName,
						FieldType:  fieldType,
					})
				}
			} else {
				if err := fieldRows.Scan(&fieldName, &fieldType); err == nil {
					allFields = append(allFields, TableField{
						DatabaseID: dbID,
						TableName:  tableName,
						FieldName:  fieldName,
						FieldType:  fieldType,
					})
				}
			}
		}
		fieldRows.Close()
	}

	// 扫描候选关系
	candidates := make([]RelationCandidate, 0)
	seenPairs := make(map[string]bool)

	for i, field1 := range allFields {
		for j, field2 := range allFields {
			if i >= j {
				continue
			}

			// 同一个表的字段跳过
			if field1.TableName == field2.TableName {
				continue
			}

			// 检查是否已经处理过这对字段
			pairKey := fmt.Sprintf("%s:%s|%s:%s",
				field1.TableName, field1.FieldName,
				field2.TableName, field2.FieldName)
			reversePairKey := fmt.Sprintf("%s:%s|%s:%s",
				field2.TableName, field2.FieldName,
				field1.TableName, field1.FieldName)

			if seenPairs[pairKey] || seenPairs[reversePairKey] {
				continue
			}
			seenPairs[pairKey] = true

			// 匹配策略
			matchType := ""
			matchScore := 0.0

			// 1. 精确匹配
			if field1.FieldName == field2.FieldName {
				matchType = "exact"
				matchScore = 1.0
			}

			// 2. 大小写不敏感匹配
			if matchType == "" && strings.EqualFold(field1.FieldName, field2.FieldName) {
				matchType = "case_insensitive"
				matchScore = 0.9
			}

			// 3. 命名风格转换匹配
			if matchType == "" {
				name1 := toSnakeCase(field1.FieldName)
				name2 := toSnakeCase(field2.FieldName)
				if name1 == name2 {
					matchType = "naming_style"
					matchScore = 0.8
				}
			}

			// 4. 类型+关键词匹配
			if matchType == "" && field1.FieldType == field2.FieldType {
				keyword1 := extractKeyword(field1.FieldName)
				keyword2 := extractKeyword(field2.FieldName)
				if keyword1 != "" && keyword1 == keyword2 {
					matchType = "type_keyword"
					matchScore = 0.7
				}
			}

			// 如果匹配成功，添加候选
			if matchType != "" {
				candidate := RelationCandidate{
					Name: fmt.Sprintf("%s.%s ↔ %s.%s",
						field1.TableName, field1.FieldName,
						field2.TableName, field2.FieldName),
					Source: FieldRef{
						DatabaseID: field1.DatabaseID,
						TableName:  field1.TableName,
						FieldName:  field1.FieldName,
						FieldType:  field1.FieldType,
					},
					Target: FieldRef{
						DatabaseID: field2.DatabaseID,
						TableName:  field2.TableName,
						FieldName:  field2.FieldName,
						FieldType:  field2.FieldType,
					},
					MatchType:   matchType,
					MatchScore:  matchScore,
					Description: fmt.Sprintf("匹配类型: %s, 得分: %.2f", matchType, matchScore),
				}
				candidates = append(candidates, candidate)
			}
		}
	}

	// 按匹配得分排序
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].MatchScore > candidates[j].MatchScore
	})

	// 限制返回数量
	if len(candidates) > 100 {
		candidates = candidates[:100]
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"candidates": candidates,
		"total":      len(candidates),
	})
}

// handleDatabaseOntologyRelations 处理数据库级别的本体关系CRUD
func handleDatabaseOntologyRelations(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "未授权")
		return
	}

	// 从URL中提取数据库ID
	pathParts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(pathParts) < 5 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的请求路径",
		})
		return
	}
	dbID := pathParts[3]

	// 检查数据库是否存在及权限
	dataOntologyMu.RLock()
	config, exists := dataOntologyDatabases[dbID]
	dataOntologyMu.RUnlock()

	if !exists || !dataOntologyResourceVisible(config.Owner, username) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在或无权限",
		})
		return
	}

	switch r.Method {
	case http.MethodGet:
		// 获取该数据库的关系列表
		dataOntologyMu.RLock()
		relations := make([]OntologyRelation, 0)
		if config.Relations != nil {
			for _, rel := range config.Relations {
				relations = append(relations, rel)
			}
		}
		dataOntologyMu.RUnlock()

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":   true,
			"relations": relations,
		})

	case http.MethodPost:
		// 创建关系
		var rel OntologyRelation
		if err := json.NewDecoder(r.Body).Decode(&rel); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		// 验证必填字段
		if rel.Name == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "关系名称不能为空",
			})
			return
		}

		if rel.Source.FieldName == "" || rel.Target.FieldName == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "源字段和目标字段不能为空",
			})
			return
		}

		// 保存关系
		rel.ID = uuid.New().String()
		rel.Owner = username
		rel.CreatedAt = time.Now()

		dataOntologyMu.Lock()
		if config.Relations == nil {
			config.Relations = make([]OntologyRelation, 0)
		}
		config.Relations = append(config.Relations, rel)
		dataOntologyMu.Unlock()

		// 持久化保存
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存本体关系失败: %v", err)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"id":      rel.ID,
		})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
	}
}

// toSnakeCase 将驼峰命名转换为下划线命名
func toSnakeCase(s string) string {
	var result []rune
	for i, r := range s {
		if i > 0 && unicode.IsUpper(r) {
			result = append(result, '_')
		}
		result = append(result, unicode.ToLower(r))
	}
	return string(result)
}

// extractKeyword 提取字段名关键词
func extractKeyword(fieldName string) string {
	// 去除常见前缀
	prefixes := []string{"fk_", "id_", "ref_", "is_", "has_", "can_", "should_"}
	name := strings.ToLower(fieldName)
	for _, prefix := range prefixes {
		if strings.HasPrefix(name, prefix) {
			name = strings.TrimPrefix(name, prefix)
			break
		}
	}

	// 去除常见后缀
	suffixes := []string{"_id", "_code", "_key", "_no", "_num"}
	for _, suffix := range suffixes {
		if strings.HasSuffix(name, suffix) {
			name = strings.TrimSuffix(name, suffix)
			break
		}
	}

	return name
}

// handleDatabaseOntologyRelationDetail 处理数据库级别的单个本体关系
func handleDatabaseOntologyRelationDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "未授权")
		return
	}

	// 从URL中提取数据库ID和关系ID
	pathParts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(pathParts) < 7 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的请求路径",
		})
		return
	}
	dbID := pathParts[3]
	relID := pathParts[6]

	// 检查数据库是否存在及权限
	dataOntologyMu.RLock()
	config, exists := dataOntologyDatabases[dbID]
	dataOntologyMu.RUnlock()

	if !exists || !dataOntologyResourceVisible(config.Owner, username) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在或无权限",
		})
		return
	}

	// 查找关系
	dataOntologyMu.RLock()
	var rel *OntologyRelation
	var relIndex int = -1
	if config.Relations != nil {
		for i, r := range config.Relations {
			if r.ID == relID {
				rel = &config.Relations[i]
				relIndex = i
				break
			}
		}
	}
	dataOntologyMu.RUnlock()

	if rel == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "关系不存在",
		})
		return
	}

	switch r.Method {
	case http.MethodGet:
		// 获取关系详情
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":  true,
			"relation": rel,
		})

	case http.MethodDelete:
		// 删除关系
		dataOntologyMu.Lock()
		if relIndex >= 0 && relIndex < len(config.Relations) {
			config.Relations = append(config.Relations[:relIndex], config.Relations[relIndex+1:]...)
		}
		dataOntologyMu.Unlock()

		// 持久化保存
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("删除本体关系失败: %v", err)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
		})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
	}
}

// TextSection 文本结构化解析的节点
type TextSection struct {
	Level    int           `json:"level"`
	Number   string        `json:"number"`
	Title    string        `json:"title"`
	Content  string        `json:"content"`
	Children []TextSection `json:"children"`
}

// TextParseRequest 文本解析请求
type TextParseRequest struct {
	Text    string                 `json:"text"`
	Format  string                 `json:"format"`
	Options map[string]interface{} `json:"options"`
}

// parseOfficialDocument 解析公文格式文本
func parseOfficialDocument(text string, minLevel, maxLevel int, detectNumbering, includeContent bool) ([]TextSection, map[string]interface{}) {
	// 定义各级标题的正则表达式
	levelPatterns := []struct {
		level   int
		pattern *regexp.Regexp
	}{
		{1, regexp.MustCompile(`^[一二三四五六七八九十]+、`)},        // 一、二、三、
		{2, regexp.MustCompile(`^[（(][一二三四五六七八九十]+[)）]`)}, // （一）（二）或 (一)(二)
		{3, regexp.MustCompile(`^\d+[.、]`)},               // 1. 2. 或 1、2、
		{4, regexp.MustCompile(`^[（(]\d+[)）]`)},           // （1）（2）或 (1)(2)
		{5, regexp.MustCompile(`^[①②③④⑤⑥⑦⑧⑨⑩]|^\d+\)`)},   // ①②③ 或 1) 2)
	}

	lines := strings.Split(text, "\n")
	var sections []TextSection
	var stack []*TextSection // 用于构建树形结构的栈

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// 检测标题
		detectedLevel := 0
		var number, title string

		for _, lp := range levelPatterns {
			if lp.level < minLevel || lp.level > maxLevel {
				continue
			}

			if match := lp.pattern.FindString(line); match != "" {
				detectedLevel = lp.level
				number = match
				title = strings.TrimSpace(strings.TrimPrefix(line, match))

				// 如果不检测编号标题，跳过
				if !detectNumbering {
					continue
				}
				break
			}
		}

		if detectedLevel > 0 {
			// 这是一个标题行
			section := TextSection{
				Level:   detectedLevel,
				Number:  number,
				Title:   title,
				Content: "",
			}

			// 构建树形结构
			// 弹出栈中所有级别 >= 当前级别的节点
			for len(stack) > 0 && stack[len(stack)-1].Level >= detectedLevel {
				stack = stack[:len(stack)-1]
			}

			if len(stack) == 0 {
				// 顶级节点
				sections = append(sections, section)
				stack = append(stack, &sections[len(sections)-1])
			} else {
				// 子节点
				parent := stack[len(stack)-1]
				parent.Children = append(parent.Children, section)
				stack = append(stack, &parent.Children[len(parent.Children)-1])
			}
		} else if includeContent && len(stack) > 0 {
			// 这是正文内容，添加到当前栈顶节点
			current := stack[len(stack)-1]
			if current.Content != "" {
				current.Content += "\n"
			}
			current.Content += line
		}
	}

	// 计算元数据
	totalSections := 0
	maxDepth := 0

	var countSections func([]TextSection, int)
	countSections = func(sections []TextSection, depth int) {
		if depth > maxDepth {
			maxDepth = depth
		}
		for i := range sections {
			totalSections++
			countSections(sections[i].Children, depth+1)
		}
	}
	countSections(sections, 1)

	metadata := map[string]interface{}{
		"total_sections":  totalSections,
		"max_depth":       maxDepth,
		"format_detected": "official",
	}

	return sections, metadata
}

// handleGovParseText 处理文本结构化解析 API
func handleGovParseText(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "仅支持 POST 请求",
		})
		return
	}

	var req TextParseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求体解析失败: " + err.Error(),
		})
		return
	}

	if req.Text == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "文本内容不能为空",
		})
		return
	}

	// 解析选项
	minLevel := 1
	maxLevel := 5
	detectNumbering := true
	includeContent := true

	if req.Options != nil {
		if v, ok := req.Options["min_level"].(float64); ok {
			minLevel = int(v)
		}
		if v, ok := req.Options["max_level"].(float64); ok {
			maxLevel = int(v)
		}
		if v, ok := req.Options["detect_numbering"].(bool); ok {
			detectNumbering = v
		}
		if v, ok := req.Options["include_content"].(bool); ok {
			includeContent = v
		}
	}

	// 根据格式选择解析器
	format := req.Format
	if format == "" {
		format = "official"
	}

	var sections []TextSection
	var metadata map[string]interface{}

	switch format {
	case "official":
		sections, metadata = parseOfficialDocument(req.Text, minLevel, maxLevel, detectNumbering, includeContent)
	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的格式类型: " + format,
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"sections": sections,
			"metadata": metadata,
		},
	})
}

// updateShareRun 更新分享执行记录
func updateShareRun(runID string, status string, progress int, output string, resultFiles []string) {
	needSave := false
	var shareRun *GovernanceShareRun
	governanceShareRunsMu.Lock()
	if run, exists := governanceShareRuns[runID]; exists {
		run.Status = status
		run.Progress = progress
		if output != "" {
			run.Output += output + "\n"
		}
		if resultFiles != nil {
			run.ResultFiles = resultFiles
		}
		run.UpdatedAt = time.Now()
		// 只在任务完成或失败时持久化，避免频繁IO
		if status == "completed" || status == "failed" {
			needSave = true
			shareRun = run
		}
	}
	governanceShareRunsMu.Unlock()

	// 持久化到文件
	if needSave {
		// 同步更新主任务的历史记录
		if shareRun != nil && shareRun.TaskID != "" {
			now := time.Now().Format(time.RFC3339)
			dataOntologyMu.Lock()
			if t, ok := governanceTasks[shareRun.TaskID]; ok {
				if status == "completed" {
					t.Status = "success"
					t.LastOutput = shareRun.Output
				} else {
					t.Status = "error"
					t.LastError = shareRun.Output
					if shareRun.Output != "" {
						t.LastOutput = shareRun.Output
					}
				}
				t.LastRunAt = now
				t.ProcessedFiles = 0
				t.Percent = 100
				t.CurrentFile = ""
			}
			// 创建任务执行日志
			logStatus := "success"
			if status == "failed" {
				logStatus = "error"
			}
			logEntry := &GovernanceTaskLog{
				ID:        uuid.New().String(),
				TaskID:    shareRun.TaskID,
				RunID:     runID,
				StartTime: shareRun.CreatedAt.Format(time.RFC3339),
				EndTime:   now,
				Status:    logStatus,
				Output:    shareRun.Output,
				Input:     strings.Join(shareRun.InputFiles, ", "),
			}
			governanceTaskLogs[shareRun.TaskID] = append(governanceTaskLogs[shareRun.TaskID], logEntry)
			if len(governanceTaskLogs[shareRun.TaskID]) > 50 {
				governanceTaskLogs[shareRun.TaskID] = governanceTaskLogs[shareRun.TaskID][len(governanceTaskLogs[shareRun.TaskID])-50:]
			}
			dataOntologyMu.Unlock()
		}
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("[ShareRun] 保存分享执行记录失败: %v", err)
		}
	}
}

// handleSharePage 处理分享页面请求
func handleSharePage(w http.ResponseWriter, r *http.Request) {
	// 提取 token
	token := strings.TrimPrefix(r.URL.Path, "/share/")
	if token == "" {
		http.NotFound(w, r)
		return
	}

	// 提供分享页面
	http.ServeFile(w, r, "apps/data-ontology/share.html")
}

// handleGovernanceShare 处理分享任务请求（免鉴权）
func handleGovernanceShare(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// 解析路径: /api/data-ontology/share/{token}[/run[/run_id[/download]]]
	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/data-ontology/share/"), "/")
	if len(pathParts) == 0 || pathParts[0] == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "缺少分享token"})
		return
	}
	shareToken := pathParts[0]

	// 查找对应的任务
	dataOntologyMu.RLock()
	var task *GovernanceTask
	for _, t := range governanceTasks {
		if t.ShareToken == shareToken && t.ShareEnabled {
			task = t
			break
		}
	}
	dataOntologyMu.RUnlock()

	if task == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "分享链接无效或已关闭"})
		return
	}

	// 路由分发
	// GET /api/data-ontology/share/{token}/examples/{filename} - 免鉴权下载示例文件
	if len(pathParts) >= 3 && pathParts[1] == "examples" {
		filename := pathParts[2]
		handleGovernanceShareExampleDownload(w, r, task, filename)
		return
	}

	if len(pathParts) >= 2 && pathParts[1] == "run" {
		if len(pathParts) >= 3 && pathParts[2] != "" {
			runID := pathParts[2]
			if len(pathParts) >= 4 && pathParts[3] == "download" {
				// GET /api/data-ontology/share/{token}/run/{run_id}/download
				handleGovernanceShareRunDownload(w, r, task, runID)
				return
			}
			// GET /api/data-ontology/share/{token}/run/{run_id}
			handleGovernanceShareRunStatus(w, r, task, runID)
			return
		}
		// POST /api/data-ontology/share/{token}/run
		handleGovernanceShareRun(w, r, task, shareToken)
		return
	}

	// GET /api/data-ontology/share/{token}/runs - 列出所有执行记录
	if len(pathParts) >= 2 && pathParts[1] == "runs" {
		handleGovernanceShareRuns(w, r, task)
		return
	}

	// POST /api/data-ontology/share/{token}/ai/completion - 免授权 AI 调用
	if len(pathParts) >= 3 && pathParts[1] == "ai" && pathParts[2] == "completion" {
		handleGovernanceShareAICompletion(w, r)
		return
	}

	// GET /api/data-ontology/share/{token}
	handleGovernanceShareInfo(w, r, task)
}

// handleGovernanceShareInfo 获取分享任务信息
func handleGovernanceShareInfo(w http.ResponseWriter, r *http.Request, task *GovernanceTask) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"name":          task.Name,
		"description":   task.Description,
		"input_type":    task.InputType,
		"accept_exts":   task.AcceptExts,
		"example_files": task.ExampleFiles,
	})
}

// handleGovernanceShareExampleDownload 免鉴权下载分享任务的示例文件
func handleGovernanceShareExampleDownload(w http.ResponseWriter, r *http.Request, task *GovernanceTask, filename string) {
	if r.Method != http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}

	// URL 解码文件名
	decodedFilename, err := url.PathUnescape(filename)
	if err != nil {
		decodedFilename = filename
	}

	// 验证文件名在任务的 example_files 中
	found := false
	var actualPath string
	for _, ef := range task.ExampleFiles {
		if ef.Path == decodedFilename || ef.Name == decodedFilename {
			found = true
			actualPath = ef.Path
			break
		}
	}
	if !found {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}

	// 安全检查
	safe := sanitizeGovernanceExampleFilename(actualPath)
	if safe == "" {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	// 从 embed FS 读取文件
	data, err := governanceExamplesFS.ReadFile("examples/governance/" + safe)
	if err != nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}

	// 设置响应头
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	w.Header().Set("Content-Disposition", `attachment; filename="`+safe+`"`)
	w.Write(data)
}

// handleGovernanceShareRun 执行分享任务
func handleGovernanceShareRun(w http.ResponseWriter, r *http.Request, task *GovernanceTask, shareToken string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}

	// 解析上传的文件
	var filePaths []string
	var inputFileNames []string
	contentType := r.Header.Get("Content-Type")
	if strings.Contains(contentType, "multipart/form-data") {
		maxSize := int64(100 * 1024 * 1024) // 100MB
		r.Body = http.MaxBytesReader(w, r.Body, maxSize)
		if err := r.ParseMultipartForm(maxSize); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "解析表单失败: " + err.Error()})
			return
		}

		// 先生成 runID，所有文件保存到同一个目录
		runID := uuid.New().String()
		uploadDir := filepath.Join("apps", "data-ontology", "share-uploads", shareToken, runID)
		if err := os.MkdirAll(uploadDir, 0755); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "创建上传目录失败"})
			return
		}

		files := r.MultipartForm.File["files"]
		for _, fileHeader := range files {
			safeFilename, err := sanitizeFilename(fileHeader.Filename)
			if err != nil {
				log.Printf("[GovernanceShare] 文件名无效: %v", err)
				continue
			}
			file, err := fileHeader.Open()
			if err != nil {
				continue
			}

			tmpPath := filepath.Join(uploadDir, safeFilename)
			dst, err := os.Create(tmpPath)
			if err != nil {
				file.Close()
				continue
			}
			_, copyErr := io.Copy(dst, file)
			file.Close()
			closeErr := dst.Close()
			if copyErr != nil || closeErr != nil {
				os.Remove(tmpPath)
				continue
			}
			filePaths = append(filePaths, tmpPath)
			inputFileNames = append(inputFileNames, safeFilename)
		}

		// 保存 runID 供后续使用
		r.URL.RawQuery = r.URL.RawQuery + "&_runID=" + runID
	}

	if len(filePaths) == 0 {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未上传文件"})
		return
	}

	// 获取 runID（从上面保存的参数中提取）
	runID := r.URL.Query().Get("_runID")
	if runID == "" {
		runID = uuid.New().String()
	}

	// 创建执行记录
	now := time.Now()
	shareRun := &GovernanceShareRun{
		ID:          runID,
		TaskID:      task.ID,
		ShareToken:  shareToken,
		Status:      "pending",
		Progress:    0,
		Output:      "",
		InputFiles:  inputFileNames,
		ResultFiles: []string{},
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	governanceShareRunsMu.Lock()
	governanceShareRuns[runID] = shareRun
	governanceShareRunsMu.Unlock()

	// 持久化新创建的执行记录
	if err := saveDataOntologyStore(); err != nil {
		log.Printf("保存分享执行记录失败: %v", err)
	}

	// 创建任务并入队（分享任务不依赖用户 token，AI 调用走免鉴权端点）
	job := &GovernanceJob{
		TaskID:     task.ID,
		RunID:      runID,
		Token:      "", // 分享任务不需要用户 token
		InputFiles: filePaths,
		InputText:  "",
		ShareToken: shareToken,
	}

	select {
	case governanceJobQueue <- job:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"run_id":  runID,
			"message": "任务已入队，正在后台执行",
		})
	default:
		governanceShareRunsMu.Lock()
		delete(governanceShareRuns, runID)
		governanceShareRunsMu.Unlock()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "任务队列已满，请稍后重试",
		})
	}
}

// handleGovernanceShareRunStatus 查询分享任务执行状态
func handleGovernanceShareRunStatus(w http.ResponseWriter, r *http.Request, task *GovernanceTask, runID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}

	governanceShareRunsMu.RLock()
	run, exists := governanceShareRuns[runID]
	governanceShareRunsMu.RUnlock()

	if !exists {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "执行记录不存在"})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"status":       run.Status,
		"progress":     run.Progress,
		"output":       run.Output,
		"input_files":  run.InputFiles,
		"result_files": run.ResultFiles,
		"created_at":   run.CreatedAt,
		"updated_at":   run.UpdatedAt,
	})
}

// handleGovernanceShareRuns 列出分享任务的所有执行记录
func handleGovernanceShareRuns(w http.ResponseWriter, r *http.Request, task *GovernanceTask) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}

	governanceShareRunsMu.RLock()
	defer governanceShareRunsMu.RUnlock()

	// 收集该 task_id 下的所有执行记录（按 task_id 查询，而非 share_token）
	var runs []*GovernanceShareRun
	for _, run := range governanceShareRuns {
		if run.TaskID == task.ID {
			runs = append(runs, run)
		}
	}

	// 按创建时间倒序排列
	sort.Slice(runs, func(i, j int) bool {
		return runs[i].CreatedAt.After(runs[j].CreatedAt)
	})

	// 转换为前端需要的格式
	result := make([]map[string]interface{}, len(runs))
	for i, run := range runs {
		result[i] = map[string]interface{}{
			"id":           run.ID,
			"status":       run.Status,
			"progress":     run.Progress,
			"input_files":  run.InputFiles,
			"result_files": run.ResultFiles,
			"created_at":   run.CreatedAt,
			"updated_at":   run.UpdatedAt,
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"runs":    result,
	})
}

// handleGovernanceShareRunDownload 下载分享任务文件（输入/输出）
func handleGovernanceShareRunDownload(w http.ResponseWriter, r *http.Request, task *GovernanceTask, runID string) {
	if r.Method != http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}

	governanceShareRunsMu.RLock()
	run, exists := governanceShareRuns[runID]
	governanceShareRunsMu.RUnlock()

	if !exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "执行记录不存在"})
		return
	}

	// 确定下载类型：input 或 output（默认 output）
	downloadType := r.URL.Query().Get("type")
	if downloadType == "" {
		downloadType = "output"
	}

	// 根据类型选择目录
	var baseDir string
	if downloadType == "input" {
		baseDir = filepath.Join("apps", "data-ontology", "share-uploads", run.ShareToken, runID)
	} else {
		baseDir = filepath.Join("apps", "data-ontology", "share-outputs", run.ShareToken, runID)
	}

	// 获取要下载的文件名
	filename := r.URL.Query().Get("file")
	if filename == "" {
		// 无 file 参数 — 返回错误，前端应逐个下载
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请指定 file 参数"})
		return
	}

	// 安全检查：防止路径遍历
	safeName, err := sanitizeFilename(filename)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "文件名无效"})
		return
	}

	filePath := filepath.Join(baseDir, safeName)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "文件不存在"})
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, safeName))
	http.ServeFile(w, r, filePath)
}

// handleGovernanceTaskShareEnable 开启任务分享
func handleGovernanceTaskShareEnable(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}

	dataOntologyMu.Lock()
	task, exists := governanceTasks[taskID]
	if !exists {
		dataOntologyMu.Unlock()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务不存在"})
		return
	}

	task.ShareEnabled = true
	if task.ShareToken == "" {
		task.ShareToken = uuid.New().String()
	}
	dataOntologyMu.Unlock()

	if err := saveDataOntologyStore(); err != nil {
		log.Printf("保存分享设置失败: %v", err)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"share_token": task.ShareToken,
		"message":     "分享已开启",
	})
}

// handleGovernanceTaskShareDisable 关闭任务分享
func handleGovernanceTaskShareDisable(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodDelete {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持DELETE"})
		return
	}

	dataOntologyMu.Lock()
	task, exists := governanceTasks[taskID]
	if !exists {
		dataOntologyMu.Unlock()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务不存在"})
		return
	}

	task.ShareEnabled = false
	task.ShareToken = ""
	dataOntologyMu.Unlock()

	if err := saveDataOntologyStore(); err != nil {
		log.Printf("保存分享设置失败: %v", err)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "分享已关闭",
	})
}

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

	// SSH/SFTP 运维 API 路由
	mux.HandleFunc("/api/ops/sftp/connect", handleSFTPConnect)
	mux.HandleFunc("/api/ops/sftp/list", handleSFTPList)
	mux.HandleFunc("/api/ops/sftp/upload", handleSFTPUpload)
	mux.HandleFunc("/api/ops/sftp/download", handleSFTPDownload)
	mux.HandleFunc("/api/ops/sftp/disconnect", handleSFTPDisconnect)
	mux.HandleFunc("/api/ops/sftp/mkdir", handleSFTPMkdir)
	mux.HandleFunc("/api/ops/sftp/delete", handleSFTPDelete)
	mux.HandleFunc("/api/ops/sftp/rename", handleSFTPRename)

	// 数据本体池API路由
	mux.HandleFunc("/api/data-ontology/login", handleDataOntologyLogin)
	mux.HandleFunc("/api/data-ontology/users", handleDataOntologyUsers)
	mux.HandleFunc("/api/data-ontology/users/", handleDataOntologyUsersDetail)
	mux.HandleFunc("/api/data-ontology/apikey", handleApiKey)
	mux.HandleFunc("/api/data-ontology/settings", handleUserSettings)
	mux.HandleFunc("/api/data-ontology/test-connection", handleTestConnection)
	mux.HandleFunc("/api/data-ontology/databases", handleDatabases)
	mux.HandleFunc("/api/data-ontology/table-retrieval/sync", handleTableRetrievalSync)
	mux.HandleFunc("/api/data-ontology/table-retrieval/status", handleTableRetrievalStatus)
	mux.HandleFunc("/api/data-ontology/table-retrieval/embedding-status", handleTableRetrievalEmbeddingStatus)
	mux.HandleFunc("/api/data-ontology/table-retrieval/relation-status", handleTableRetrievalRelationStatus)
	mux.HandleFunc("/api/data-ontology/table-retrieval/search", handleTableRetrievalSearch)
	mux.HandleFunc("/api/data-ontology/databases/", func(w http.ResponseWriter, r *http.Request) {
		trimPath := strings.Trim(r.URL.Path, "/")
		parts := strings.Split(trimPath, "/")
		// Handle ontology endpoints: /api/data-ontology/databases/{id}/ontology/...
		if len(parts) >= 6 && parts[2] == "databases" && parts[4] == "ontology" {
			switch parts[5] {
			case "scan":
				handleDatabaseOntologyScan(w, r)
				return
			case "relations":
				if len(parts) == 6 {
					handleDatabaseOntologyRelations(w, r)
					return
				} else if len(parts) == 7 {
					handleDatabaseOntologyRelationDetail(w, r)
					return
				}
			}
		}
		// Handle lineage endpoint
		if len(parts) == 5 && parts[2] == "databases" && parts[4] == "lineage" {
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
	mux.HandleFunc("/api/data-ontology/mcp/config", handleMCPConfig)
	mux.HandleFunc("/api/data-ontology/mcp/safe-config", handleMCPSafeConfig)
	mux.HandleFunc("/api/data-ontology/mcp/port", handleMCPPort)
	mux.Handle("/mcp", http.HandlerFunc(handleMCPHTTP))
	mux.Handle("/mcp/", http.HandlerFunc(handleMCPHTTP))
	// 接口管理API路由
	mux.HandleFunc("/api/data-ontology/apis", handleApis)
	mux.HandleFunc("/api/data-ontology/apis/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if strings.HasSuffix(path, "/test") {
			handleApiTest(w, r)
		} else {
			handleApiDetail(w, r)
		}
	})

	// AI助手API路由
	mux.HandleFunc("/api/data-ontology/ai/config", handleAIConfig)
	mux.HandleFunc("/api/data-ontology/ai/embedding-config", handleAIEmbeddingConfig)
	mux.HandleFunc("/api/data-ontology/ai/table-retrieval-config", handleTableRetrievalConfig)
	mux.HandleFunc("/api/data-ontology/ai/capabilities", handleAICapabilities)
	mux.HandleFunc("/api/data-ontology/ai/query", handleAIQuery)
	mux.HandleFunc("/api/data-ontology/ai/confirm-execute", handleAIConfirmExecute)
	mux.HandleFunc("/api/data-ontology/ai/codegen", handleAICodegen)
	mux.HandleFunc("/api/data-ontology/ai/completion", handleAICompletion)

	// 模型管理API路由
	mux.HandleFunc("/api/data-ontology/models/llm", handleLLMModels)
	mux.HandleFunc("/api/data-ontology/models/llm/", handleLLMModelDetail)
	mux.HandleFunc("/api/data-ontology/models/small", handleSmallModels)
	mux.HandleFunc("/api/data-ontology/models/small/", handleSmallModelDetail)

	// 本体论API路由
	mux.HandleFunc("/api/data-ontology/ontology/extract", handleOntologyExtract)
	mux.HandleFunc("/api/data-ontology/ontology/query", handleOntologySemanticQuery)

	// 数据治理API路由
	mux.HandleFunc("/api/data-ontology/governance/tasks", handleGovernanceTasks)
	mux.HandleFunc("/api/data-ontology/governance/tasks/", handleGovernanceTaskDetail)
	mux.HandleFunc("/api/data-ontology/governance/examples/download", handleGovernanceExamplesZipDownload)
	mux.HandleFunc("/api/data-ontology/governance/examples/", handleGovernanceExampleDownload)
	mux.HandleFunc("/api/governance/examples/download", handleGovernanceExamplesZipDownload)
	mux.HandleFunc("/api/governance/examples/", handleGovernanceExampleDownload)
	mux.HandleFunc("/api/data-ontology/governance/download-output", handleGovernanceDownloadOutput)
	mux.HandleFunc("/api/data-ontology/governance/execute-sql", handleGovernanceExecuteSQL)
	mux.HandleFunc("/api/data-ontology/quality-audit/", handleQualityAuditAPI)

	// 分享API路由（免鉴权）
	mux.HandleFunc("/api/data-ontology/share/", handleGovernanceShare)

	// 文本结构化解析API路由
	mux.HandleFunc("/api/data-ontology/gov/parse-text", handleGovParseText)

	// 数据备份与恢复API路由
	mux.HandleFunc("/api/data-ontology/backup", handleDataOntologyBackup)
	mux.HandleFunc("/api/data-ontology/restore", handleDataOntologyRestore)
	mux.HandleFunc("/api/data-ontology/restore-upload", handleDataOntologyRestoreUpload)

	// 网页导航 API
	mux.HandleFunc("/api/web-nav/login", handleWebNavLogin)
	mux.HandleFunc("/api/web-nav/links", handleWebNavLinks)
	mux.HandleFunc("/api/web-nav/links/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/web-nav/links/")
		if id == "" {
			http.NotFound(w, r)
			return
		}
		handleWebNavLinkByID(w, r, id)
	})

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
	mu     sync.RWMutex
}

var (
	fts5Manager     *FTS5Manager
	fts5ManagerOnce sync.Once
)

// getFTS5Manager 获取 FTS5 管理器单例
func getFTS5Manager() *FTS5Manager {
	fts5ManagerOnce.Do(func() {
		// 数据库路径：服务工作目录下的 data-store.db
		dbPath := filepath.Join(".", "apps", "data-ontology", "data-store.db")
		
		// 确保目录存在
		dir := filepath.Dir(dbPath)
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Printf("[表检索] 创建数据库目录失败: %v", err)
			return
		}

		db, err := sql.Open("sqlite", dbPath)
		if err != nil {
			log.Printf("[表检索] 打开 SQLite 失败: %v", err)
			return
		}

		// 设置连接池
		db.SetMaxOpenConns(5)
		db.SetMaxIdleConns(2)

		manager := &FTS5Manager{
			dbPath: dbPath,
			db:     db,
		}

		// 初始化表结构
		if err := manager.initSchema(); err != nil {
			log.Printf("[表检索] 初始化表结构失败: %v", err)
			return
		}

		fts5Manager = manager
		log.Printf("[表检索] FTS5 管理器初始化成功: %s", dbPath)
	})
	return fts5Manager
}

// initSchema 初始化数据库表结构
func (m *FTS5Manager) initSchema() error {
	// 主表：存储表元信息
	_, err := m.db.Exec(`
		CREATE TABLE IF NOT EXISTS tables (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			database_id TEXT NOT NULL,
			table_name TEXT NOT NULL,
			table_comment TEXT,
			column_names TEXT,
			column_comments TEXT,
			row_count INTEGER DEFAULT 0,
			updated_at INTEGER NOT NULL,
			UNIQUE(database_id, table_name)
		);
		CREATE INDEX IF NOT EXISTS idx_tables_database ON tables(database_id);
	`)
	if err != nil {
		return err
	}

	// FTS5 虚拟表：全文索引
	_, err = m.db.Exec(`
		CREATE VIRTUAL TABLE IF NOT EXISTS tables_fts USING fts5(
			table_name,
			table_comment,
			column_names,
			content='tables',
			content_rowid='id',
			tokenize='unicode61'
		);
	`)
	if err != nil {
		return err
	}

	// 向量表：存储 embedding 向量
	_, err = m.db.Exec(`
		CREATE TABLE IF NOT EXISTS vectors (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			database_id TEXT NOT NULL,
			table_name TEXT NOT NULL,
			embedding BLOB NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(database_id, table_name)
		);
		CREATE INDEX IF NOT EXISTS idx_vectors_database ON vectors(database_id);
	`)
	if err != nil {
		return err
	}

	// 关系表：存储表间关系（用于 Graph 检索）
	_, err = m.db.Exec(`
		CREATE TABLE IF NOT EXISTS relations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			database_id TEXT NOT NULL,
			source_table TEXT NOT NULL,
			source_field TEXT NOT NULL,
			target_table TEXT NOT NULL,
			target_field TEXT NOT NULL,
			match_type TEXT NOT NULL,
			relation_name TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_relations_database ON relations(database_id);
		CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(database_id, source_table);
		CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(database_id, target_table);
	`)
	if err != nil {
		return err
	}

	// 触发器：保持 FTS 索引同步
	triggers := []string{
		`CREATE TRIGGER IF NOT EXISTS tables_ai AFTER INSERT ON tables BEGIN
			INSERT INTO tables_fts(rowid, table_name, table_comment, column_names)
			VALUES (new.id, new.table_name, new.table_comment, new.column_names);
		END;`,
		`CREATE TRIGGER IF NOT EXISTS tables_ad AFTER DELETE ON tables BEGIN
			INSERT INTO tables_fts(tables_fts, rowid, table_name, table_comment, column_names)
			VALUES ('delete', old.id, old.table_name, old.table_comment, old.column_names);
		END;`,
		`CREATE TRIGGER IF NOT EXISTS tables_au AFTER UPDATE ON tables BEGIN
			INSERT INTO tables_fts(tables_fts, rowid, table_name, table_comment, column_names)
			VALUES ('delete', old.id, old.table_name, old.table_comment, old.column_names);
			INSERT INTO tables_fts(rowid, table_name, table_comment, column_names)
			VALUES (new.id, new.table_name, new.table_comment, new.column_names);
		END;`,
	}
	for _, trigger := range triggers {
		if _, err := m.db.Exec(trigger); err != nil {
			return err
		}
	}

	return nil
}

// fts5RetrieveTables 使用 FTS5 进行关键词检索
func (m *FTS5Manager) fts5RetrieveTables(query string, databaseID string, limit int) ([]TableRelevanceResult, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.db == nil {
		return nil, sql.ErrConnDone
	}

	// 构建搜索条件：表名、注释、字段名任一匹配，使用 BM25 排序
	sqlStr := `
		SELECT 
			t.table_name,
			t.table_comment,
			bm25(tables_fts) as score
		FROM tables_fts f
		JOIN tables t ON f.rowid = t.id
		WHERE tables_fts MATCH ? AND t.database_id = ?
		ORDER BY score ASC
		LIMIT ?
	`

	rows, err := m.db.Query(sqlStr, query, databaseID, limit)
	if err != nil {
		// FTS5 MATCH 失败（如中文分词问题），降级为 LIKE 模糊匹配
		log.Printf("[表检索] FTS5 MATCH 失败，降级为 LIKE 匹配: %v", err)
		return m.likeRetrieveTables(query, databaseID, limit)
	}
	defer rows.Close()

	var results []TableRelevanceResult
	for rows.Next() {
		var tableName, tableComment string
		var score float64
		if err := rows.Scan(&tableName, &tableComment, &score); err != nil {
			continue
		}

		// 将 BM25 分数转换为 0-1 的相关度分数
		relevance := 1.0 / (1.0 + (-score)/10.0)
		if relevance > 1.0 {
			relevance = 1.0
		}

		results = append(results, TableRelevanceResult{
			TableName:      tableName,
			RelevanceScore: relevance,
			MatchReason:    "关键词匹配",
		})
	}

	// 如果 FTS5 没有结果，降级为 LIKE 匹配
	if len(results) == 0 {
		log.Printf("[表检索] FTS5 无结果，降级为 LIKE 匹配")
		return m.likeRetrieveTables(query, databaseID, limit)
	}

	return results, nil
}

// likeRetrieveTables LIKE 模糊匹配检索（FTS5 降级方案）
func (m *FTS5Manager) likeRetrieveTables(query string, databaseID string, limit int) ([]TableRelevanceResult, error) {
	// 使用 LIKE 模糊匹配表名、注释、字段名
	sqlStr := `
		SELECT 
			table_name,
			table_comment
		FROM tables
		WHERE database_id = ? AND (
			table_name LIKE ? OR
			table_comment LIKE ? OR
			column_names LIKE ?
		)
		LIMIT ?
	`

	likePattern := "%" + query + "%"
	rows, err := m.db.Query(sqlStr, databaseID, likePattern, likePattern, likePattern, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []TableRelevanceResult
	for rows.Next() {
		var tableName, tableComment string
		if err := rows.Scan(&tableName, &tableComment); err != nil {
			continue
		}

		// LIKE 匹配给固定相关度分数
		results = append(results, TableRelevanceResult{
			TableName:      tableName,
			RelevanceScore: 0.5,
			MatchReason:    "模糊匹配",
		})
	}

	return results, nil
}

// syncTablesToSQLite 同步单个数据库的表信息到 SQLite
func (m *FTS5Manager) syncTablesToSQLite(dbConfig *DatabaseConfig) error {
	if m == nil || m.db == nil {
		return nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// 获取表列表
	tableInfos, err := getTableInfoList(dbConfig)
	if err != nil {
		return err
	}

	// 1. 获取已有的表记录
	existingTables := make(map[string]int64)
	rows, err := m.db.Query("SELECT table_name, updated_at FROM tables WHERE database_id = ?", dbConfig.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var tableName string
		var updatedAt int64
		if err := rows.Scan(&tableName, &updatedAt); err != nil {
			continue
		}
		existingTables[tableName] = updatedAt
	}
	rows.Close()

	// 2. 构建当前表名集合
	currentTables := make(map[string]bool)
	for _, ti := range tableInfos {
		currentTables[ti.Name] = true
	}

	// 3. 找出需要删除的表
	var toDelete []string
	for tableName := range existingTables {
		if !currentTables[tableName] {
			toDelete = append(toDelete, tableName)
		}
	}

	// 4. 找出需要新增/更新的表
	type tableToSync struct {
		name        string
		comment     string
		columnNames []string
	}
	var toSync []tableToSync
	for _, ti := range tableInfos {
		if _, exists := existingTables[ti.Name]; !exists {
			comment := ti.Comment
			if comment == "" {
				comment = ti.Name
			}
			toSync = append(toSync, tableToSync{name: ti.Name, comment: comment, columnNames: ti.ColumnNames})
		}
	}

	if len(toDelete) == 0 && len(toSync) == 0 {
		log.Printf("[表检索] 数据库 %s 表数据已是最新，无需同步", dbConfig.Name)
		return nil
	}

	log.Printf("[表检索] 数据库 %s 增量同步表: 删除 %d 个, 新增 %d 个", dbConfig.Name, len(toDelete), len(toSync))

	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().Unix()

	// 删除已不存在的表
	if len(toDelete) > 0 {
		stmt, err := tx.Prepare("DELETE FROM tables WHERE database_id = ? AND table_name = ?")
		if err != nil {
			return err
		}
		for _, tableName := range toDelete {
			if _, err := stmt.Exec(dbConfig.ID, tableName); err != nil {
				log.Printf("[表检索] 删除表 %s 失败: %v", tableName, err)
			}
		}
		stmt.Close()
	}

	// 新增/更新表
	if len(toSync) > 0 {
		stmt, err := tx.Prepare(`
			INSERT OR REPLACE INTO tables (database_id, table_name, table_comment, column_names, column_comments, row_count, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`)
		if err != nil {
			return err
		}
		defer stmt.Close()

		for _, ts := range toSync {
			columnNamesJSON, _ := json.Marshal(ts.columnNames)
			if _, err := stmt.Exec(
				dbConfig.ID,
				ts.name,
				ts.comment,
				string(columnNamesJSON),
				"{}",
				0,
				now,
			); err != nil {
				log.Printf("[表检索] 插入表 %s 失败: %v", ts.name, err)
			}
		}
	}

	return tx.Commit()
}

// syncAllDatabases 同步所有数据库的表信息
func (m *FTS5Manager) syncAllDatabases() error {
	if m == nil {
		return nil
	}

	dataOntologyMu.RLock()
	configs := make([]*DatabaseConfig, 0, len(dataOntologyDatabases))
	for _, db := range dataOntologyDatabases {
		configs = append(configs, db)
	}
	embeddingConfig := EmbeddingRetrievalConfig{}
	if dataOntologyAIConfig != nil {
		embeddingConfig = dataOntologyAIConfig.Embedding
	}
	dataOntologyMu.RUnlock()

	for _, dbConfig := range configs {
		if err := m.syncTablesToSQLite(dbConfig); err != nil {
			log.Printf("[表检索] 同步数据库 %s 失败: %v", dbConfig.Name, err)
		}
		// 如果 embedding 启用，同步向量
		if embeddingConfig.Enabled && embeddingConfig.URL != "" {
			if err := m.syncVectorsToSQLite(dbConfig, embeddingConfig); err != nil {
				log.Printf("[表检索] 同步数据库 %s 向量失败: %v", dbConfig.Name, err)
			}
		}
	}

	return nil
}

// getStats 获取索引统计信息
func (m *FTS5Manager) getStats() (int, map[string]int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.db == nil {
		return 0, nil, sql.ErrConnDone
	}

	var totalCount int
	if err := m.db.QueryRow("SELECT COUNT(*) FROM tables").Scan(&totalCount); err != nil {
		return 0, nil, err
	}

	rows, err := m.db.Query("SELECT database_id, COUNT(*) as count FROM tables GROUP BY database_id")
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()

	dbStats := make(map[string]int)
	for rows.Next() {
		var dbID string
		var count int
		if err := rows.Scan(&dbID, &count); err == nil {
			dbStats[dbID] = count
		}
	}

	return totalCount, dbStats, nil
}

// ============================================================
// 向量检索（余弦相似度）- Phase 2
// ============================================================

// generateEmbedding 调用 embedding API 生成向量
func generateEmbedding(text string, config EmbeddingRetrievalConfig) ([]float32, error) {
	if !config.Enabled || config.URL == "" {
		return nil, fmt.Errorf("embedding 未启用或未配置")
	}

	// 构建请求 payload（兼容 OpenAI/SiliconFlow 格式）
	payload := map[string]interface{}{
		"model": config.Model,
		"input": text,
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("序列化请求失败: %w", err)
	}

	req, err := http.NewRequest("POST", config.URL, bytes.NewReader(payloadBytes))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+config.APIKey)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求 embedding API 失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("embedding API 返回错误 %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Data []struct {
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("解析 embedding 响应失败: %w", err)
	}

	if result.Error.Message != "" {
		return nil, fmt.Errorf("embedding API 错误: %s", result.Error.Message)
	}

	if len(result.Data) == 0 || len(result.Data[0].Embedding) == 0 {
		return nil, fmt.Errorf("embedding API 返回空向量")
	}

	// 转换 float64 -> float32
	embedding := make([]float32, len(result.Data[0].Embedding))
	for i, v := range result.Data[0].Embedding {
		embedding[i] = float32(v)
	}

	return embedding, nil
}

// float32SliceToBytes 将 float32 切片序列化为字节
func float32SliceToBytes(vec []float32) []byte {
	buf := new(bytes.Buffer)
	for _, v := range vec {
		binary.Write(buf, binary.LittleEndian, v)
	}
	return buf.Bytes()
}

// bytesToFloat32Slice 将字节反序列化为 float32 切片
func bytesToFloat32Slice(data []byte) ([]float32, error) {
	if len(data)%4 != 0 {
		return nil, fmt.Errorf("无效的向量数据长度: %d", len(data))
	}
	vec := make([]float32, len(data)/4)
	buf := bytes.NewReader(data)
	for i := range vec {
		if err := binary.Read(buf, binary.LittleEndian, &vec[i]); err != nil {
			return nil, err
		}
	}
	return vec, nil
}

// cosineSimilarity 计算余弦相似度
func cosineSimilarity(a, b []float32) float64 {
	if len(a) != len(b) {
		return 0
	}
	var dotProduct, normA, normB float64
	for i := range a {
		af := float64(a[i])
		bf := float64(b[i])
		dotProduct += af * bf
		normA += af * af
		normB += bf * bf
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return dotProduct / (math.Sqrt(normA) * math.Sqrt(normB))
}

// syncVectorsToSQLite 增量同步向量到 SQLite
func (m *FTS5Manager) syncVectorsToSQLite(dbConfig *DatabaseConfig, embeddingConfig EmbeddingRetrievalConfig) error {
	if m == nil || m.db == nil {
		return nil
	}
	if !embeddingConfig.Enabled || embeddingConfig.URL == "" {
		return nil
	}

	// 获取表列表
	tableInfos, err := getTableInfoList(dbConfig)
	if err != nil {
		return fmt.Errorf("获取表列表失败: %w", err)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// 1. 获取已有的向量记录
	existingVectors := make(map[string]time.Time)
	rows, err := m.db.Query("SELECT table_name, updated_at FROM vectors WHERE database_id = ?", dbConfig.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var tableName string
		var updatedAt time.Time
		if err := rows.Scan(&tableName, &updatedAt); err != nil {
			continue
		}
		existingVectors[tableName] = updatedAt
	}
	rows.Close()

	// 2. 构建当前表名集合
	currentTables := make(map[string]bool)
	for _, ti := range tableInfos {
		currentTables[ti.Name] = true
	}

	// 3. 找出需要删除的表（存在于向量表但不在当前表中）
	var toDelete []string
	for tableName := range existingVectors {
		if !currentTables[tableName] {
			toDelete = append(toDelete, tableName)
		}
	}

	// 4. 找出需要新增/更新的表
	type tableToSync struct {
		name    string
		comment string
	}
	var toSync []tableToSync
	for _, ti := range tableInfos {
		// 检查是否需要同步：新表 或 表结构可能变化（这里简化为检查是否存在）
		if _, exists := existingVectors[ti.Name]; !exists {
			toSync = append(toSync, tableToSync{name: ti.Name, comment: ti.Comment})
		}
	}

	if len(toDelete) == 0 && len(toSync) == 0 {
		log.Printf("[表检索] 数据库 %s 向量已是最新，无需同步", dbConfig.Name)
		return nil
	}

	log.Printf("[表检索] 数据库 %s 增量同步: 删除 %d 个, 新增 %d 个", dbConfig.Name, len(toDelete), len(toSync))

	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 删除已不存在的表
	if len(toDelete) > 0 {
		stmt, err := tx.Prepare("DELETE FROM vectors WHERE database_id = ? AND table_name = ?")
		if err != nil {
			return err
		}
		for _, tableName := range toDelete {
			if _, err := stmt.Exec(dbConfig.ID, tableName); err != nil {
				log.Printf("[表检索] 删除向量失败 (%s): %v", tableName, err)
			}
		}
		stmt.Close()
	}

	// 新增/更新向量
	if len(toSync) > 0 {
		stmt, err := tx.Prepare(`
			INSERT OR REPLACE INTO vectors (database_id, table_name, embedding, updated_at)
			VALUES (?, ?, ?, CURRENT_TIMESTAMP)
		`)
		if err != nil {
			return err
		}
		defer stmt.Close()

		successCount := 0
		for _, ts := range toSync {
			// 构建 embedding 文本：表名 + 注释
			text := ts.name
			if ts.comment != "" {
				text = ts.name + " " + ts.comment
			}

			embedding, err := generateEmbedding(text, embeddingConfig)
			if err != nil {
				log.Printf("[表检索] 生成 embedding 失败 (%s): %v", ts.name, err)
				continue
			}

			embeddingBytes := float32SliceToBytes(embedding)
			if _, err := stmt.Exec(dbConfig.ID, ts.name, embeddingBytes); err != nil {
				log.Printf("[表检索] 插入向量失败 (%s): %v", ts.name, err)
				continue
			}
			successCount++
		}
		log.Printf("[表检索] 数据库 %s 新增向量: %d/%d", dbConfig.Name, successCount, len(toSync))
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	log.Printf("[表检索] 数据库 %s 增量同步完成", dbConfig.Name)
	return nil
}

// vectorRetrieveTables 向量检索表
func (m *FTS5Manager) vectorRetrieveTables(query string, databaseID string, limit int, embeddingConfig EmbeddingRetrievalConfig) ([]TableRelevanceResult, error) {
	if m == nil || m.db == nil {
		return nil, sql.ErrConnDone
	}
	if !embeddingConfig.Enabled || embeddingConfig.URL == "" {
		return nil, fmt.Errorf("embedding 未启用或未配置")
	}

	// 1. 生成 query 的 embedding
	queryEmbedding, err := generateEmbedding(query, embeddingConfig)
	if err != nil {
		return nil, fmt.Errorf("生成查询向量失败: %w", err)
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	// 2. 从 vectors 表读取所有向量（按 dbID 过滤）
	rows, err := m.db.Query("SELECT table_name, embedding FROM vectors WHERE database_id = ?", databaseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// 3. 计算余弦相似度
	type candidate struct {
		tableName string
		score     float64
	}
	var candidates []candidate

	for rows.Next() {
		var tableName string
		var embeddingBytes []byte
		if err := rows.Scan(&tableName, &embeddingBytes); err != nil {
			continue
		}

		vec, err := bytesToFloat32Slice(embeddingBytes)
		if err != nil {
			log.Printf("[表检索] 反序列化向量失败 (%s): %v", tableName, err)
			continue
		}

		similarity := cosineSimilarity(queryEmbedding, vec)
		candidates = append(candidates, candidate{tableName: tableName, score: similarity})
	}

	// 4. 按相似度排序
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].score > candidates[j].score
	})

	// 5. 返回 topK
	if limit > len(candidates) {
		limit = len(candidates)
	}

	results := make([]TableRelevanceResult, 0, limit)
	for i := 0; i < limit; i++ {
		results = append(results, TableRelevanceResult{
			TableName:      candidates[i].tableName,
			RelevanceScore: candidates[i].score,
			MatchReason:    "向量相似度",
		})
	}

	return results, nil
}

// getVectorStats 获取向量索引统计信息
func (m *FTS5Manager) getVectorStats() (int, map[string]int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.db == nil {
		return 0, nil, sql.ErrConnDone
	}

	var totalCount int
	if err := m.db.QueryRow("SELECT COUNT(*) FROM vectors").Scan(&totalCount); err != nil {
		return 0, nil, err
	}

	rows, err := m.db.Query("SELECT database_id, COUNT(*) as count FROM vectors GROUP BY database_id")
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()

	dbStats := make(map[string]int)
	for rows.Next() {
		var dbID string
		var count int
		if err := rows.Scan(&dbID, &count); err == nil {
			dbStats[dbID] = count
		}
	}

	return totalCount, dbStats, nil
}

// syncRelationsToSQLite 增量同步关系到 SQLite
func (m *FTS5Manager) syncRelationsToSQLite(dbConfig *DatabaseConfig) error {
	if m == nil || m.db == nil {
		return nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// 1. 获取已有的关系记录
	existingRels := make(map[string]bool)
	rows, err := m.db.Query("SELECT source_table, source_field, target_table, target_field FROM relations WHERE database_id = ?", dbConfig.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var srcTable, srcField, tgtTable, tgtField string
		if err := rows.Scan(&srcTable, &srcField, &tgtTable, &tgtField); err != nil {
			continue
		}
		key := srcTable + "." + srcField + "->" + tgtTable + "." + tgtField
		existingRels[key] = true
	}
	rows.Close()

	// 2. 构建当前关系的 key 集合
	currentRels := make(map[string]bool)
	type relEntry struct {
		key          string
		sourceTable  string
		sourceField  string
		targetTable  string
		targetField  string
		matchType    string
		relationName string
	}
	var toSync []relEntry
	for _, rel := range dbConfig.Relations {
		key := rel.Source.TableName + "." + rel.Source.FieldName + "->" + rel.Target.TableName + "." + rel.Target.FieldName
		currentRels[key] = true
		if !existingRels[key] {
			toSync = append(toSync, relEntry{
				key:          key,
				sourceTable:  rel.Source.TableName,
				sourceField:  rel.Source.FieldName,
				targetTable:  rel.Target.TableName,
				targetField:  rel.Target.FieldName,
				matchType:    rel.MatchType,
				relationName: rel.Name,
			})
		}
	}

	// 3. 找出需要删除的关系
	var toDelete []string
	for key := range existingRels {
		if !currentRels[key] {
			toDelete = append(toDelete, key)
		}
	}

	if len(toDelete) == 0 && len(toSync) == 0 {
		log.Printf("[表检索] 数据库 %s 关系已是最新，无需同步", dbConfig.Name)
		return nil
	}

	log.Printf("[表检索] 数据库 %s 增量同步关系: 删除 %d 个, 新增 %d 个", dbConfig.Name, len(toDelete), len(toSync))

	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 删除已不存在的关系
	if len(toDelete) > 0 {
		stmt, err := tx.Prepare("DELETE FROM relations WHERE database_id = ? AND source_table = ? AND source_field = ? AND target_table = ? AND target_field = ?")
		if err != nil {
			return err
		}
		for _, key := range toDelete {
			// key format: srcTable.srcField->tgtTable.tgtField
			arrowIdx := strings.Index(key, "->")
			if arrowIdx < 0 {
				continue
			}
			left := key[:arrowIdx]
			right := key[arrowIdx+2:]
			dotLeft := strings.Index(left, ".")
			dotRight := strings.Index(right, ".")
			if dotLeft < 0 || dotRight < 0 {
				continue
			}
			srcTable := left[:dotLeft]
			srcField := left[dotLeft+1:]
			tgtTable := right[:dotRight]
			tgtField := right[dotRight+1:]
			if _, err := stmt.Exec(dbConfig.ID, srcTable, srcField, tgtTable, tgtField); err != nil {
				log.Printf("[表检索] 删除关系失败 (%s): %v", key, err)
			}
		}
		stmt.Close()
	}

	// 新增关系
	if len(toSync) > 0 {
		stmt, err := tx.Prepare(`
			INSERT INTO relations (database_id, source_table, source_field, target_table, target_field, match_type, relation_name)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`)
		if err != nil {
			return err
		}
		defer stmt.Close()

		successCount := 0
		for _, rel := range toSync {
			if _, err := stmt.Exec(
				dbConfig.ID,
				rel.sourceTable,
				rel.sourceField,
				rel.targetTable,
				rel.targetField,
				rel.matchType,
				rel.relationName,
			); err != nil {
				log.Printf("[表检索] 插入关系失败 (%s): %v", rel.key, err)
				continue
			}
			successCount++
		}
		log.Printf("[表检索] 数据库 %s 新增关系: %d/%d", dbConfig.Name, successCount, len(toSync))
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	log.Printf("[表检索] 数据库 %s 关系增量同步完成", dbConfig.Name)
	return nil
}

// graphRetrieveTables Graph 关系检索（基于已匹配表扩展关联表）
func (m *FTS5Manager) graphRetrieveTables(seedTables []string, databaseID string, maxDepth int, limit int) ([]TableRelevanceResult, error) {
	if m == nil || m.db == nil {
		return nil, sql.ErrConnDone
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	// 已访问表集合
	visited := make(map[string]bool)
	// 结果表及其关系分数
	tableScores := make(map[string]float64)

	// BFS 扩展
	currentLevel := seedTables
	depth := 0
	baseScore := 1.0 // 种子表分数为 1.0

	// 先把种子表加入结果
	for _, t := range seedTables {
		visited[t] = true
		tableScores[t] = baseScore
	}

	for depth < maxDepth && len(currentLevel) > 0 {
		nextLevel := make([]string, 0)
		decay := 0.5 / float64(depth+1) // 每层衰减

		for _, sourceTable := range currentLevel {
			// 查找以该表为源的关系
			rows, err := m.db.Query(`
				SELECT target_table, relation_name 
				FROM relations 
				WHERE database_id = ? AND source_table = ?
			`, databaseID, sourceTable)
			if err != nil {
				continue
			}

			for rows.Next() {
				var targetTable, relationName string
				if err := rows.Scan(&targetTable, &relationName); err != nil {
					continue
				}
				_ = relationName

				if !visited[targetTable] {
					visited[targetTable] = true
					tableScores[targetTable] = baseScore * decay
					nextLevel = append(nextLevel, targetTable)
				}
			}
			rows.Close()

			// 查找以该表为目标的关系（反向关联）
			rows2, err := m.db.Query(`
				SELECT source_table, relation_name 
				FROM relations 
				WHERE database_id = ? AND target_table = ?
			`, databaseID, sourceTable)
			if err != nil {
				continue
			}

			for rows2.Next() {
				var srcTable, relationName string
				if err := rows2.Scan(&srcTable, &relationName); err != nil {
					continue
				}
				_ = relationName

				if !visited[srcTable] {
					visited[srcTable] = true
					tableScores[srcTable] = baseScore * decay
					nextLevel = append(nextLevel, srcTable)
				}
			}
			rows2.Close()
		}

		currentLevel = nextLevel
		depth++
	}

	// 按分数排序
	results := make([]TableRelevanceResult, 0, len(tableScores))
	for tableName, score := range tableScores {
		results = append(results, TableRelevanceResult{
			TableName:      tableName,
			RelevanceScore: score,
			MatchReason:    "Graph 关系扩展",
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].RelevanceScore > results[j].RelevanceScore
	})

	// 限制返回数量
	if limit > len(results) {
		limit = len(results)
	}

	return results[:limit], nil
}

// getRelationStats 获取关系索引统计信息
func (m *FTS5Manager) getRelationStats() (int, map[string]int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.db == nil {
		return 0, nil, sql.ErrConnDone
	}

	var totalCount int
	if err := m.db.QueryRow("SELECT COUNT(*) FROM relations").Scan(&totalCount); err != nil {
		return 0, nil, err
	}

	rows, err := m.db.Query("SELECT database_id, COUNT(*) as count FROM relations GROUP BY database_id")
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()

	dbStats := make(map[string]int)
	for rows.Next() {
		var dbID string
		var count int
		if err := rows.Scan(&dbID, &count); err == nil {
			dbStats[dbID] = count
		}
	}

	return totalCount, dbStats, nil
}

package main

import (
	"bytes"
	"context"
	"crypto/md5"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "github.com/denisenkom/go-mssqldb"
	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	_ "github.com/lib/pq"
	_ "github.com/sijms/go-ora/v2"
	_ "gitee.com/chunanyong/dm"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// 条件编译：仅在支持CGO时导入这些驱动
// SQLite, DuckDB, ClickHouse, Neo4j, Godror 需要CGO或特殊编译环境

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
	// 协作文档数据
	documents    map[string]interface{}
	docUsers     map[string]map[string]bool // docId -> userId -> bool
	docMu        sync.RWMutex
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
	// 协作文档相关字段
	DocId      string      `json:"docId,omitempty"`
	Document   interface{} `json:"document,omitempty"`
	Documents  interface{} `json:"documents,omitempty"`
	Update     interface{} `json:"update,omitempty"`
	Cursor     interface{} `json:"cursor,omitempty"`
	Users      interface{} `json:"users,omitempty"`
	Title      string      `json:"title,omitempty"`
	DocContent interface{} `json:"docContent,omitempty"`
}

var hub = &Hub{
	clients:    make(map[string]*Client),
	broadcast:  make(chan []byte),
	register:   make(chan *Client),
	unregister: make(chan *Client),
	documents:  make(map[string]interface{}),
	docUsers:   make(map[string]map[string]bool),
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

// loggingMiddleware 日志中间件
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s - %s %s", r.RemoteAddr, r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

// corsMiddleware CORS中间件
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
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

	c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
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

		case "doc-list-request":
			// 请求文档列表
			hub.docMu.RLock()
			docs := make([]interface{}, 0)
			for _, doc := range hub.documents {
				docs = append(docs, doc)
			}
			hub.docMu.RUnlock()

			response := Message{
				Type:      "doc-list",
				Documents: docs,
			}
			data, _ := json.Marshal(response)
			c.Send <- data
			log.Printf("发送文档列表给客户端 %s", c.ID)

		case "doc-created":
			// 创建文档
			if msg.Document != nil {
				docMap, ok := msg.Document.(map[string]interface{})
				if ok {
					docId := docMap["id"].(string)
					hub.docMu.Lock()
					hub.documents[docId] = msg.Document
					hub.docMu.Unlock()

					// 广播给所有客户端（包括创建者，用于确认）
					data, _ := json.Marshal(msg)
					hub.mu.RLock()
					for _, client := range hub.clients {
						select {
						case client.Send <- data:
							log.Printf("文档创建消息已发送给: %s", client.ID)
						default:
							log.Printf("文档创建消息发送失败: %s (通道已满)", client.ID)
						}
					}
					hub.mu.RUnlock()
					log.Printf("文档已创建并存储: %s (总共%d个文档)", docId, len(hub.documents))
				}
			}

		case "doc-deleted":
			// 删除文档
			if msg.DocId != "" {
				hub.docMu.Lock()
				delete(hub.documents, msg.DocId)
				delete(hub.docUsers, msg.DocId)
				hub.docMu.Unlock()

				// 广播给所有客户端（包括删除者）
				data, _ := json.Marshal(msg)
				hub.mu.RLock()
				for _, client := range hub.clients {
					select {
					case client.Send <- data:
					default:
					}
				}
				hub.mu.RUnlock()
				log.Printf("文档已删除: %s (剩余%d个文档)", msg.DocId, len(hub.documents))
			}

		case "doc-opened":
			// 打开文档
			if msg.DocId != "" {
				// 从服务器获取文档内容
				hub.docMu.RLock()
				doc, exists := hub.documents[msg.DocId]
				hub.docMu.RUnlock()

				if !exists {
					log.Printf("文档不存在: %s", msg.DocId)
					break
				}

				// 记录用户打开文档
				hub.docMu.Lock()
				if hub.docUsers[msg.DocId] == nil {
					hub.docUsers[msg.DocId] = make(map[string]bool)
				}
				hub.docUsers[msg.DocId][c.ID] = true
				users := make([]string, 0)
				for userId := range hub.docUsers[msg.DocId] {
					users = append(users, userId)
				}
				hub.docMu.Unlock()

				// 返回文档内容给请求者
				openResponse := Message{
					Type:     "doc-opened",
					DocId:    msg.DocId,
					Document: doc,
				}
				responseData, _ := json.Marshal(openResponse)
				c.Send <- responseData
				log.Printf("用户 %s 打开文档: %s，已返回文档内容", c.ID, msg.DocId)

				// 通知文档内所有用户更新在线列表
				usersMsg := Message{
					Type:  "doc-users",
					DocId: msg.DocId,
					Users: users,
				}
				usersData, _ := json.Marshal(usersMsg)
				hub.docMu.RLock()
				for userId := range hub.docUsers[msg.DocId] {
					hub.mu.RLock()
					if client, ok := hub.clients[userId]; ok {
						select {
						case client.Send <- usersData:
						default:
						}
					}
					hub.mu.RUnlock()
				}
				hub.docMu.RUnlock()
			}

		case "doc-leave":
			// 离开文档
			if msg.DocId != "" {
				hub.docMu.Lock()
				if hub.docUsers[msg.DocId] != nil {
					delete(hub.docUsers[msg.DocId], c.ID)
				}
				hub.docMu.Unlock()
				log.Printf("用户 %s 离开文档: %s", c.ID, msg.DocId)
			}

		case "doc-title-update":
			// 更新文档标题
			if msg.DocId != "" && msg.Title != "" {
				hub.docMu.Lock()
				if doc, ok := hub.documents[msg.DocId]; ok {
					if docMap, ok := doc.(map[string]interface{}); ok {
						docMap["title"] = msg.Title
						hub.documents[msg.DocId] = docMap
						log.Printf("文档标题已更新: %s -> %s", msg.DocId, msg.Title)
					}
				}
				hub.docMu.Unlock()
			}

			// 转发给所有用户
			msg.From = c.ID
			data, _ := json.Marshal(msg)
			hub.mu.RLock()
			for _, client := range hub.clients {
				if client.ID != c.ID {
					select {
					case client.Send <- data:
					default:
					}
				}
			}
			hub.mu.RUnlock()

		case "doc-update":
			// 更新文档内容
			if msg.DocId != "" && msg.Update != nil {
				hub.docMu.Lock()
				if doc, ok := hub.documents[msg.DocId]; ok {
					if docMap, ok := doc.(map[string]interface{}); ok {
						if updateMap, ok := msg.Update.(map[string]interface{}); ok {
							updateType, _ := updateMap["type"].(string)
							content, _ := docMap["content"].(map[string]interface{})
							
							switch updateType {
							case "excel-cell":
								// 更新Excel单元格
								if data, ok := content["data"].([]interface{}); ok {
									if row, ok := updateMap["row"].(float64); ok {
										if col, ok := updateMap["col"].(float64); ok {
											if value, ok := updateMap["value"].(string); ok {
												rowInt := int(row)
												colInt := int(col)
												if rowInt < len(data) {
													if rowData, ok := data[rowInt].([]interface{}); ok {
														if colInt < len(rowData) {
															rowData[colInt] = value
														}
													}
												}
											}
										}
									}
								}
							case "excel-add-row":
								// 添加Excel行
								if data, ok := content["data"].([]interface{}); ok {
									cols := 0
									if len(data) > 0 {
										if firstRow, ok := data[0].([]interface{}); ok {
											cols = len(firstRow)
										}
									}
									newRow := make([]interface{}, cols)
									for i := range newRow {
										newRow[i] = ""
									}
									content["data"] = append(data, newRow)
								}
							case "excel-add-col":
								// 添加Excel列
								if data, ok := content["data"].([]interface{}); ok {
									for i := range data {
										if rowData, ok := data[i].([]interface{}); ok {
											data[i] = append(rowData, "")
										}
									}
								}
							case "word-delta":
								// Word更新使用Quill delta，这里简化处理
								// 实际应该应用delta到ops数组
								log.Printf("Word delta更新: %s", msg.DocId)
							}
							
							docMap["content"] = content
							hub.documents[msg.DocId] = docMap
						}
					}
				}
				hub.docMu.Unlock()
			}

			// 转发给所有用户
			msg.From = c.ID
			data, _ := json.Marshal(msg)
			hub.mu.RLock()
			for _, client := range hub.clients {
				if client.ID != c.ID {
					select {
					case client.Send <- data:
					default:
					}
				}
			}
			hub.mu.RUnlock()

		case "doc-cursor":
			// 转发光标位置到所有在线用户
			msg.From = c.ID
			data, _ := json.Marshal(msg)

			hub.mu.RLock()
			for _, client := range hub.clients {
				if client.ID != c.ID {
					select {
					case client.Send <- data:
					default:
					}
				}
			}
			hub.mu.RUnlock()

		case "doc-content-save":
			// 保存文档完整内容（用于Word）
			if msg.DocId != "" && msg.DocContent != nil {
				hub.docMu.Lock()
				if doc, ok := hub.documents[msg.DocId]; ok {
					if docMap, ok := doc.(map[string]interface{}); ok {
						// 更新文档内容
						docMap["content"] = msg.DocContent
						hub.documents[msg.DocId] = docMap
						log.Printf("文档内容已保存: %s", msg.DocId)
					}
				}
				hub.docMu.Unlock()
			}
		}
	}
}

// 向客户端写入消息
func (c *Client) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// 发送消息
			if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// 数据本体池相关结构

// User 用户
type User struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Token    string `json:"token"`
	ApiKey   string `json:"api_key,omitempty"`
}

// DatabaseConfig 数据库配置
type DatabaseConfig struct {
	ID       string `json:"id"`
	Type     string `json:"type"`     // mysql, postgresql, oracle, dm, sqlite, mongodb, elasticsearch, influxdb
	Name     string `json:"name"`
	Host     string `json:"host,omitempty"`
	Port     int    `json:"port,omitempty"`
	User     string `json:"user,omitempty"`
	Password string `json:"password,omitempty"`
	Database string `json:"database,omitempty"`
	Path     string `json:"path,omitempty"` // for sqlite
}

// DatabaseInfo 数据库信息（不包含敏感信息）
type DatabaseInfo struct {
	ID        string   `json:"id"`
	Type      string   `json:"type"`
	Name      string   `json:"name"`
	Host      string   `json:"host,omitempty"`
	Port      int      `json:"port,omitempty"`
	User      string   `json:"user,omitempty"`
	Database  string   `json:"database,omitempty"`
	Path      string   `json:"path,omitempty"`
	Connected bool     `json:"connected"`
	Tables    []string `json:"tables,omitempty"`
}

// ApiConfig 接口配置
type ApiConfig struct {
	ID            string                 `json:"id"`
	Name          string                 `json:"name"`
	Path          string                 `json:"path"`
	Method        string                 `json:"method"`        // GET, POST, PUT, DELETE
	DatabaseID    string                 `json:"database_id"`   // 关联的数据库ID
	SQL           string                 `json:"sql"`           // MyBatis风格的SQL语句
	Description   string                 `json:"description,omitempty"`
	DefaultParams map[string]interface{} `json:"default_params,omitempty"` // 默认参数值
}

// ApiInfo 接口信息（包含数据库名称）
type ApiInfo struct {
	ID            string                 `json:"id"`
	Name          string                 `json:"name"`
	Path          string                 `json:"path"`
	Method        string                 `json:"method"`
	DatabaseID    string                 `json:"database_id"`
	DatabaseName  string                 `json:"database_name,omitempty"`
	SQL           string                 `json:"sql"`
	Description   string                 `json:"description,omitempty"`
	DefaultParams map[string]interface{} `json:"default_params,omitempty"`
}

// AIConfig AI配置
type AIConfig struct {
	URL    string `json:"url"`
	APIKey string `json:"api_key"`
	Model  string `json:"model"`
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
	DatabaseID   string             `json:"database_id"`
	DatabaseName string             `json:"database_name"`
	DBType       string             `json:"db_type"`
	TableName    string             `json:"table_name"`
	SourceType   string             `json:"source_type"` // excel | csv_file | csv_text
	Columns      []AICodegenColumn  `json:"columns"`
	UserHint     string             `json:"user_hint,omitempty"`
}

// AICodegenColumn 列映射
type AICodegenColumn struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	SourceIndex int    `json:"source_index"`
}

// GovernanceTask 数据治理任务
type GovernanceTask struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Type        string   `json:"type"`                    // "scheduled" | "interactive"
	Description string   `json:"description,omitempty"`
	JsCode      string   `json:"js_code"`
	DatabaseID  string   `json:"database_id,omitempty"`
	CronExpr    string   `json:"cron_expr,omitempty"`     // "分 时 日 月 周" e.g. "0 2 * * *"
	Enabled     bool     `json:"enabled"`
	InputType   string   `json:"input_type,omitempty"`    // "file" | "text" | "both"
	AcceptExts  []string `json:"accept_exts,omitempty"`   // [".xlsx",".csv",".docx"]
	CreatedAt   string   `json:"created_at"`
	UpdatedAt   string   `json:"updated_at,omitempty"`
	Status      string   `json:"status"`                  // "idle" | "running" | "success" | "error"
	LastOutput  string   `json:"last_output,omitempty"`
	LastError   string   `json:"last_error,omitempty"`
	LastRunAt   string   `json:"last_run_at,omitempty"`
}

// GovernanceTaskLog 任务执行日志
type GovernanceTaskLog struct {
	ID        string `json:"id"`
	TaskID    string `json:"task_id"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time,omitempty"`
	Status    string `json:"status"` // "running" | "success" | "error"
	Output    string `json:"output,omitempty"`
	Error     string `json:"error,omitempty"`
	Input     string `json:"input,omitempty"`
}

// 数据本体池存储
var (
	dataOntologyUsers     = make(map[string]*User)
	dataOntologyDatabases = make(map[string]*DatabaseConfig)
	dataOntologyApis      = make(map[string]*ApiConfig)
	dataOntologyAIConfig  *AIConfig
	governanceTasks       = make(map[string]*GovernanceTask)
	governanceTaskLogs    = make(map[string][]*GovernanceTaskLog)
	dataOntologyMu        sync.RWMutex
)

// DataOntologyStore 持久化存储结构
type DataOntologyStore struct {
	Users     map[string]*User                  `json:"users"`
	Databases map[string]*DatabaseConfig        `json:"databases"`
	Apis      map[string]*ApiConfig             `json:"apis"`
	AIConfig  *AIConfig                         `json:"ai_config,omitempty"`
	Tasks     map[string]*GovernanceTask        `json:"governance_tasks,omitempty"`
	TaskLogs  map[string][]*GovernanceTaskLog   `json:"governance_task_logs,omitempty"`
}

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
	storePath := getDataOntologyStorePath()
	
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
	}
	
	if store.AIConfig != nil {
		dataOntologyAIConfig = store.AIConfig
		log.Printf("已加载AI配置")
	}
	
	if store.Tasks != nil {
		governanceTasks = store.Tasks
		log.Printf("已加载 %d 个治理任务", len(governanceTasks))
	}
	
	if store.TaskLogs != nil {
		governanceTaskLogs = store.TaskLogs
		log.Printf("已加载治理任务日志")
	}
	
	return nil
}

// 保存持久化数据
func saveDataOntologyStore() error {
	storePath := getDataOntologyStorePath()
	
	// 确保目录存在
	storeDir := filepath.Dir(storePath)
	if err := os.MkdirAll(storeDir, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %v", err)
	}
	
	// 构建存储结构
	dataOntologyMu.RLock()
	store := DataOntologyStore{
		Users:     dataOntologyUsers,
		Databases: dataOntologyDatabases,
		Apis:      dataOntologyApis,
		AIConfig:  dataOntologyAIConfig,
		Tasks:     governanceTasks,
		TaskLogs:  governanceTaskLogs,
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

// 初始化默认管理员账号
func initDataOntology() {
	// 先尝试加载持久化数据
	if err := loadDataOntologyStore(); err != nil {
		log.Printf("加载持久化数据失败: %v", err)
	}
	
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
			Name:        "数据库表行数统计",
			Type:        "scheduled",
			Description: "查询所有表的行数，输出统计报告（需关联数据库）",
			JsCode: "// 定时任务：统计数据库所有表的行数\n// 需要关联一个数据库才能运行\n\nconst tables = await gov.querySQL('SHOW TABLES');\ngov.log('=' .repeat(40));\ngov.log(`共 ${tables.length} 张表`);\ngov.log('='.repeat(40));\n\nfor (const row of tables) {\n    const tableName = Object.values(row)[0];\n    const result = await gov.querySQL(`SELECT COUNT(*) as cnt FROM ${tableName}`);\n    gov.log(`  ${tableName.padEnd(30)} ${result[0].cnt} 行`);\n}\ngov.log('='.repeat(40));\ngov.log('统计完成');",
			CronExpr:   "0 2 * * *",
			Enabled:    false,
			CreatedAt:  now,
			Status:     "idle",
		}

		// 示例2: 交互任务 - Excel数据导入
		interactiveID := uuid.New().String()
		governanceTasks[interactiveID] = &GovernanceTask{
			ID:          interactiveID,
			Name:        "Excel数据解析入库",
			Type:        "interactive",
			Description: "上传Excel文件，解析内容预览，可选入库",
			JsCode: "// Excel 数据解析预览\n\nconst workbook = await gov.readExcel(INPUT_FILE);\nconst sheetName = workbook.SheetNames[0];\nconst data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });\nconst headers = data[0];\nconst rows = data.slice(1);\n\ngov.log(`工作表: ${sheetName}`);\ngov.log(`总行数: ${rows.length}, 列数: ${headers.length}`);\ngov.log(`表头: ${headers.join(', ')}`);\n\ngov.log('\\n--- 数据预览 (前5行) ---');\nfor (let i = 0; i < Math.min(5, rows.length); i++) {\n    gov.log(`  行${i + 1}: ${rows[i].join(' | ')}`);\n}\ngov.log(`\\n提示: 使用\"入库代码生成助手\"可快速生成入库代码`);",
			InputType:  "file",
			AcceptExts: []string{".xlsx", ".xls"},
			CreatedAt:  now,
			Status:     "idle",
		}

		// 示例3: 交互任务 - CSV文本解析
		textTaskID := uuid.New().String()
		governanceTasks[textTaskID] = &GovernanceTask{
			ID:          textTaskID,
			Name:        "CSV文本解析",
			Type:        "interactive",
			Description: "输入CSV格式文本，解析并展示结构化结果",
			JsCode: "// CSV 文本解析预览\n\nconst result = Papa.parse(INPUT_TEXT, { header: true });\n\ngov.log(`列数: ${result.meta.fields.length}`);\ngov.log(`表头: ${result.meta.fields.join(', ')}`);\ngov.log(`数据行数: ${result.data.length}`);\n\ngov.log('\\n--- 数据预览 (前5行) ---');\nfor (let i = 0; i < Math.min(5, result.data.length); i++) {\n    const row = result.data[i];\n    gov.log(`行 ${i + 1}: ${Object.values(row).join(' | ')}`);\n}\ngov.log(`\\n提示: 使用\"入库代码生成助手\"可快速生成入库代码`);",
			InputType:  "text",
			CreatedAt:  now,
			Status:     "idle",
		}

		// 示例4: 定时任务 - 数据完整性检查
		syncCheckID := uuid.New().String()
		governanceTasks[syncCheckID] = &GovernanceTask{
			ID:          syncCheckID,
			Name:        "数据完整性检查",
			Type:        "scheduled",
			Description: "检查数据库表的空值情况（需关联数据库）",
			JsCode: "// 定时任务：检查各表的数据完整性\n\nconst now = new Date().toLocaleString();\ngov.log(`数据完整性检查报告 - ${now}`);\ngov.log('='.repeat(50));\n\nconst tables = await gov.querySQL('SHOW TABLES');\nfor (const row of tables) {\n    const tableName = Object.values(row)[0];\n    gov.log(`\\n[${tableName}]`);\n\n    const columns = await gov.querySQL(`SHOW COLUMNS FROM ${tableName}`);\n    const countResult = await gov.querySQL(`SELECT COUNT(*) as cnt FROM ${tableName}`);\n\n    for (const col of columns) {\n        if (col.Null === 'YES') {\n            const nullResult = await gov.querySQL(\n                `SELECT COUNT(*) as cnt FROM ${tableName} WHERE ${col.Field} IS NULL`\n            );\n            if (nullResult[0].cnt > 0) {\n                gov.log(`  ⚠ ${col.Field}: ${nullResult[0].cnt} 个空值`);\n            }\n        }\n    }\n    gov.log(`  总行数: ${countResult[0].cnt}, 列数: ${columns.length}`);\n}\ngov.log('='.repeat(50));\ngov.log('检查完成');",
			CronExpr:   "30 1 * * *",
			Enabled:    false,
			CreatedAt:  now,
			Status:     "idle",
		}

		// 示例5: 交互任务 - Word文档解析
		docTaskID := uuid.New().String()
		governanceTasks[docTaskID] = &GovernanceTask{
			ID:          docTaskID,
			Name:        "Word文档内容提取",
			Type:        "interactive",
			Description: "上传Word文档(.docx)，提取文本内容",
			JsCode: "// 交互任务：提取Word文档的文本内容\n// 使用 Mammoth 库将docx转为文本\n\nconst result = await gov.readWord(INPUT_FILE);\ngov.log('='.repeat(40));\ngov.log('Word文档内容：');\ngov.log('='.repeat(40));\ngov.log(result.value);\nif (result.messages && result.messages.length > 0) {\n    gov.log('\\n--- 转换消息 ---');\n    result.messages.forEach(m => gov.log(`  ${m.type}: ${m.message}`));\n}\ngov.log('='.repeat(40));\ngov.log('文档内容提取完成');",
			InputType:  "file",
			AcceptExts: []string{".docx"},
			CreatedAt:  now,
			Status:     "idle",
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
	
	// 启动治理任务调度器
	go governanceScheduler()
}

// 密码哈希
func hashPassword(password string) string {
	hash := md5.Sum([]byte(password))
	return hex.EncodeToString(hash[:])
}

// 生成Token
func generateToken() string {
	return uuid.New().String()
}

// 构建数据库连接字符串
func buildDSN(config *DatabaseConfig) (string, string, error) {
	switch config.Type {
	case "mysql", "mariadb":
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=True&loc=Local",
			config.User, config.Password, config.Host, config.Port, config.Database)
		return "mysql", dsn, nil

	case "postgresql", "timescaledb":
		dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=disable",
			config.Host, config.Port, config.User, config.Password, config.Database)
		return "postgres", dsn, nil

	case "sqlserver":
		dsn := fmt.Sprintf("sqlserver://%s:%s@%s:%d?database=%s",
			config.User, config.Password, config.Host, config.Port, config.Database)
		return "sqlserver", dsn, nil

	case "oracle":
		// 使用 go-ora 驱动
		dsn := fmt.Sprintf("oracle://%s:%s@%s:%d/%s",
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
		
		dsn := fmt.Sprintf("dm://%s:%s@%s:%d",
			encodedUser, encodedPassword, host, port)
		if config.Database != "" {
			dsn = fmt.Sprintf("dm://%s:%s@%s:%d/%s",
				encodedUser, encodedPassword, host, port, config.Database)
		}
		
		log.Printf("DM最终DSN(已编码): %s", dsn)
		return "dm", dsn, nil

	case "sqlite":
		// SQLite 需要CGO支持，在某些构建环境中可能不可用
		return "", "", fmt.Errorf("SQLite 支持需要CGO编译，当前构建版本不支持。请使用支持CGO的版本")

	case "duckdb":
		// DuckDB 需要CGO支持
		return "", "", fmt.Errorf("DuckDB 支持需要CGO编译，当前构建版本不支持。请使用支持CGO的版本")

	case "tidb":
		// TiDB 兼容 MySQL 协议
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=True",
			config.User, config.Password, config.Host, config.Port, config.Database)
		return "mysql", dsn, nil

	case "cockroachdb":
		// CockroachDB 兼容 PostgreSQL 协议
		dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=disable",
			config.Host, config.Port, config.User, config.Password, config.Database)
		return "postgres", dsn, nil

	case "clickhouse":
		// ClickHouse 在某些构建环境中可能不可用
		return "", "", fmt.Errorf("ClickHouse 支持在当前构建版本中不可用。请使用完整版本")

	default:
		return "", "", fmt.Errorf("不支持的数据库类型: %s", config.Type)
	}
}

// 获取表列表的SQL
func getTablesQuery(dbType string) string {
	switch dbType {
	case "mysql", "mariadb", "tidb":
		return "SHOW TABLES"
	case "postgresql", "timescaledb", "cockroachdb":
		return "SELECT tablename FROM pg_tables WHERE schemaname='public'"
	case "sqlserver":
		return "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'"
	case "oracle":
		return "SELECT table_name FROM user_tables"
	case "dm":
		// 达梦兼容：用 SYSOBJECTS 避免 USER_TABLES 语法解析问题（-2007）
		return "SELECT NAME FROM SYSOBJECTS WHERE TYPE$='SCHOBJ' AND SUBTYPE$='UTAB' AND PID=-1"
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

	// SQL数据库通用处理
	driver, dsn, err := buildDSN(config)
	if err != nil {
		return nil, err
	}

	db, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		return nil, err
	}

	// 获取表列表
	query := getTablesQuery(config.Type)
	rows, err := db.Query(query)
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

	if tables == nil {
		tables = []string{}
	}

	return tables, nil
}

// getTableColumns 获取表的字段信息
func getTableColumns(config *DatabaseConfig, tableName string) ([]map[string]interface{}, error) {
	var columns []map[string]interface{}

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

	// SQL数据库通用处理
	driver, dsn, err := buildDSN(config)
	if err != nil {
		return nil, err
	}

	db, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	var query string
	switch config.Type {
	case "mysql", "mariadb", "tidb":
		query = fmt.Sprintf("SHOW COLUMNS FROM `%s`", tableName)
	case "postgresql", "timescaledb", "cockroachdb":
		query = fmt.Sprintf("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '%s' ORDER BY ordinal_position", tableName)
	case "sqlserver":
		query = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '%s' ORDER BY ORDINAL_POSITION", tableName)
	case "sqlite", "duckdb":
		query = fmt.Sprintf("PRAGMA table_info(%s)", tableName)
	case "oracle":
		query = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", tableName)
	case "dm":
		query = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", tableName)
	case "clickhouse":
		query = fmt.Sprintf("DESCRIBE TABLE %s", tableName)
	default:
		return nil, fmt.Errorf("不支持的数据库类型: %s", config.Type)
	}

	rows, err := db.Query(query)
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

// 验证Token（同时支持登录Token和ApiKey）
func verifyToken(r *http.Request) bool {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return false
	}

	token := strings.TrimPrefix(authHeader, "Bearer ")
	dataOntologyMu.RLock()
	defer dataOntologyMu.RUnlock()

	for _, user := range dataOntologyUsers {
		if user.Token == token || (user.ApiKey != "" && user.ApiKey == token) {
			return true
		}
	}
	return false
}

// 登录处理
func handleDataOntologyLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "只支持POST请求",
		})
		return
	}

	var loginReq struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&loginReq); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求格式错误",
		})
		return
	}

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	user, exists := dataOntologyUsers[loginReq.Username]
	if !exists || user.Password != hashPassword(loginReq.Password) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "用户名或密码错误",
		})
		return
	}

	// 生成新Token
	token := generateToken()
	user.Token = token

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"token":   token,
	})
}

// handleApiKey 管理ApiKey（GET获取/POST生成/DELETE删除）
func handleApiKey(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	loginToken := strings.TrimPrefix(authHeader, "Bearer ")

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	var currentUser *User
	for _, u := range dataOntologyUsers {
		if u.Token == loginToken {
			currentUser = u
			break
		}
	}
	if currentUser == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"api_key": currentUser.ApiKey,
		})
	case http.MethodPost:
		currentUser.ApiKey = "dok_" + uuid.New().String()
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		dataOntologyMu.Lock()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"api_key": currentUser.ApiKey,
		})
	case http.MethodDelete:
		currentUser.ApiKey = ""
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		dataOntologyMu.Lock()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
		})
	default:
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
	}
}

// 测试数据库连接
func handleTestConnection(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
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

	var config DatabaseConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求格式错误",
		})
		return
	}

	// 调试日志：打印接收到的配置
	log.Printf("测试连接配置: Type=%s, Host=%s, Port=%d, User=%s, Database=%s", 
		config.Type, config.Host, config.Port, config.User, config.Database)

	// MongoDB 特殊处理
	if config.Type == "mongodb" {
		uri := buildMongoURI(&config)
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

		if err := client.Ping(ctx, nil); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "连接失败: " + err.Error(),
			})
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "连接成功",
		})
		return
	}

	// Elasticsearch 特殊处理
	if config.Type == "elasticsearch" {
		url := fmt.Sprintf("http://%s:%d", config.Host, config.Port)
		resp, err := http.Get(url)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "连接失败: " + err.Error(),
			})
			return
		}
		defer resp.Body.Close()

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "连接成功",
		})
		return
	}

	// InfluxDB 特殊处理
	if config.Type == "influxdb" {
		url := fmt.Sprintf("http://%s:%d/ping", config.Host, config.Port)
		resp, err := http.Get(url)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "连接失败: " + err.Error(),
			})
			return
		}
		defer resp.Body.Close()

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "连接成功",
		})
		return
	}

	// Redis 特殊处理
	if config.Type == "redis" {
		// Redis 连接测试 - 简化处理，使用tcp连接
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", config.Host, config.Port), 5*time.Second)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "连接失败: " + err.Error(),
			})
			return
		}
		defer conn.Close()

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "连接成功",
		})
		return
	}

	// Memcached 特殊处理
	if config.Type == "memcached" {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", config.Host, config.Port), 5*time.Second)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "连接失败: " + err.Error(),
			})
			return
		}
		defer conn.Close()

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "连接成功",
		})
		return
	}

	// Neo4j 特殊处理
	if config.Type == "neo4j" {
		// Neo4j 驱动在某些构建版本中可能不可用
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", config.Host, config.Port), 5*time.Second)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "连接失败: " + err.Error(),
			})
			return
		}
		defer conn.Close()

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "连接成功 (基础端口测试)",
		})
		return
	}

	// Cassandra, HBase 等通过 TCP 简单测试
	if config.Type == "cassandra" || config.Type == "hbase" {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", config.Host, config.Port), 5*time.Second)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "连接失败: " + err.Error(),
			})
			return
		}
		defer conn.Close()

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "连接成功 (基础端口测试)",
		})
		return
	}

	// SQL数据库通用处理
	driver, dsn, err := buildDSN(&config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	// 调试日志：打印生成的 DSN
	log.Printf("生成的 DSN: driver=%s, dsn=%s", driver, dsn)

	db, err := sql.Open(driver, dsn)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接失败: " + err.Error(),
		})
		return
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接失败: " + err.Error(),
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "连接成功",
	})
}

// 数据库管理
func handleDatabases(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	switch r.Method {
	case http.MethodGet:
		// 获取数据库列表
		dataOntologyMu.RLock()
		defer dataOntologyMu.RUnlock()

		databases := make([]DatabaseInfo, 0)
		for _, config := range dataOntologyDatabases {
			databases = append(databases, DatabaseInfo{
				ID:       config.ID,
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
		dataOntologyMu.Lock()
		dataOntologyDatabases[config.ID] = &config
		dataOntologyMu.Unlock()

		// 持久化保存
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存数据库配置失败: %v", err)
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

	if !verifyToken(r) {
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

	if !exists {
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
			// SQL数据库通用处理
			driver, dsn, err := buildDSN(config)
			if err == nil {
				db, err := sql.Open(driver, dsn)
				if err == nil {
					defer db.Close()
					if err := db.Ping(); err == nil {
						connected = true
						// 获取表列表
						query := getTablesQuery(config.Type)
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
		}

		if tables == nil {
			tables = []string{}
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"database": DatabaseInfo{
				ID:        config.ID,
				Type:      config.Type,
				Name:      config.Name,
				Host:      config.Host,
				Port:      config.Port,
				Database:  config.Database,
				Path:      config.Path,
				Connected: connected,
				Tables:    tables,
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

// 获取表数据
func handleTableData(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
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

	if !exists {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在",
		})
		return
	}

	// 如果路径以 /tables 结尾（创建表）
	if strings.HasSuffix(path, "/tables") && r.Method == http.MethodPost {
		handleTableCreate(w, r, config)
		return
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

	// 检查是否是特殊路径
	if strings.HasSuffix(path, "/structure") {
		// 获取表结构
		handleTableStructure(w, r, config, tableName)
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

	// 建立数据库连接
	driver, dsn, err := buildDSN(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	db, err := sql.Open(driver, dsn)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接失败: " + err.Error(),
		})
		return
	}
	defer db.Close()

	// 首先查询所有数据以获取主键
	var query string
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb":
		query = fmt.Sprintf(`SELECT * FROM "%s"`, tableName)
	case "oracle", "dm":
		query = fmt.Sprintf("SELECT * FROM %s", tableName)
	case "sqlserver":
		query = fmt.Sprintf("SELECT * FROM [%s]", tableName)
	case "duckdb":
		query = fmt.Sprintf("SELECT * FROM %s", tableName)
	case "clickhouse":
		query = fmt.Sprintf("SELECT * FROM `%s`", tableName)
	default:
		query = fmt.Sprintf("SELECT * FROM `%s`", tableName)
	}

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
		if quoteChar == "[" {
			return "[" + name + "]"
		} else if quoteChar == "" {
			return name
		}
		return quoteChar + name + quoteChar
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
	// 对于达梦数据库，需要先查询自增列并排除
	identityColumns := make(map[string]bool)
	if config.Type == "dm" {
		identQuery := fmt.Sprintf(`
			SELECT a.NAME
			FROM SYS.SYSCOLUMNS a, sys.sysobjects b
			WHERE b.id = a.id AND b.name = '%s' AND (a.INFO2 & 0x01) = 0x01
		`, tableName)
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
	
	for _, insertData := range req.Inserts {
		cols := make([]string, 0)
		placeholders := make([]string, 0)
		values := make([]interface{}, 0)

		for col, val := range insertData {
			// 达梦数据库：跳过自增列
			if config.Type == "dm" && identityColumns[col] {
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
		"success": true,
		"updated": updated,
		"inserted": inserted,
		"deleted": deleted,
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
		// SQL数据库通用处理
		driver, dsn, err := buildDSN(config)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": err.Error(),
			})
			return
		}

		db, err := sql.Open(driver, dsn)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "连接失败: " + err.Error(),
			})
			return
		}
		defer db.Close()

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

	driver, dsn, err := buildDSN(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	db, err := sql.Open(driver, dsn)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接失败: " + err.Error(),
		})
		return
	}
	defer db.Close()

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
		query = fmt.Sprintf(`
			SELECT COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_DEFAULT
			FROM USER_TAB_COLUMNS
			WHERE TABLE_NAME = '%s'
			ORDER BY COLUMN_ID
		`, tableName)
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
		case "dm", "oracle":
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

	driver, dsn, err := buildDSN(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	db, err := sql.Open(driver, dsn)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接失败: " + err.Error(),
		})
		return
	}
	defer db.Close()

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
		query = fmt.Sprintf(`
			SELECT COLUMN_NAME, DATA_TYPE, NULLABLE
			FROM USER_TAB_COLUMNS
			WHERE TABLE_NAME = '%s'
			ORDER BY COLUMN_ID
		`, tableName)
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

			var alterSQL string
			if existingColumns[col.Name] {
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

	driver, dsn, err := buildDSN(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	db, err := sql.Open(driver, dsn)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接失败: " + err.Error(),
		})
		return
	}
	defer db.Close()

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

	driver, dsn, err := buildDSN(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	db, err := sql.Open(driver, dsn)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接失败: " + err.Error(),
		})
		return
	}
	defer db.Close()

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
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	switch r.Method {
	case http.MethodGet:
		// 获取接口列表
		dataOntologyMu.RLock()
		defer dataOntologyMu.RUnlock()

		apiList := make([]*ApiInfo, 0, len(dataOntologyApis))
		for _, api := range dataOntologyApis {
			apiInfo := &ApiInfo{
				ID:         api.ID,
				Name:       api.Name,
				Path:       api.Path,
				Method:     api.Method,
				DatabaseID: api.DatabaseID,
			}

			// 获取数据库名称
			if db, exists := dataOntologyDatabases[api.DatabaseID]; exists {
				apiInfo.DatabaseName = db.Name
			}

			apiList = append(apiList, apiInfo)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"apis":    apiList,
		})

	case http.MethodPost:
		// 添加新接口
		var apiConfig ApiConfig
		if err := json.NewDecoder(r.Body).Decode(&apiConfig); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		// 验证必填字段
		if apiConfig.Name == "" || apiConfig.Path == "" || apiConfig.Method == "" ||
			apiConfig.DatabaseID == "" || apiConfig.SQL == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "缺少必填字段",
			})
			return
		}

		// 验证数据库是否存在
		dataOntologyMu.RLock()
		_, dbExists := dataOntologyDatabases[apiConfig.DatabaseID]
		dataOntologyMu.RUnlock()

		if !dbExists {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "数据库不存在",
			})
			return
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

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"api":     apiConfig,
		})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
	}
}

// handleApiDetail 处理单个接口的GET、PUT、DELETE请求
func handleApiDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	// 提取接口ID
	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/data-ontology/apis/"), "/")
	if len(pathParts) == 0 || pathParts[0] == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "缺少接口ID",
		})
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
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "接口不存在",
			})
			return
		}

		apiInfo := &ApiInfo{
			ID:           api.ID,
			Name:         api.Name,
			Path:         api.Path,
			Method:       api.Method,
			DatabaseID:   api.DatabaseID,
			SQL:          api.SQL,
			Description:  api.Description,
			DefaultParams: api.DefaultParams,
		}

		// 获取数据库名称
		if db, dbExists := dataOntologyDatabases[api.DatabaseID]; dbExists {
			apiInfo.DatabaseName = db.Name
		}

		dataOntologyMu.RUnlock()

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"api":     apiInfo,
		})

	case http.MethodPut:
		// 更新接口
		var apiUpdate ApiConfig
		if err := json.NewDecoder(r.Body).Decode(&apiUpdate); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		dataOntologyMu.Lock()
		api, exists := dataOntologyApis[apiID]
		if !exists {
			dataOntologyMu.Unlock()
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "接口不存在",
			})
			return
		}

		// 验证数据库是否存在
		if apiUpdate.DatabaseID != "" {
			if _, dbExists := dataOntologyDatabases[apiUpdate.DatabaseID]; !dbExists {
				dataOntologyMu.Unlock()
				json.NewEncoder(w).Encode(map[string]interface{}{
					"success": false,
					"message": "数据库不存在",
				})
				return
			}
		}

		// 更新字段
		if apiUpdate.Name != "" {
			api.Name = apiUpdate.Name
		}
		if apiUpdate.Path != "" {
			api.Path = apiUpdate.Path
		}
		if apiUpdate.Method != "" {
			api.Method = apiUpdate.Method
		}
		if apiUpdate.DatabaseID != "" {
			api.DatabaseID = apiUpdate.DatabaseID
		}
		if apiUpdate.SQL != "" {
			api.SQL = apiUpdate.SQL
		}
		api.Description = apiUpdate.Description
		api.DefaultParams = apiUpdate.DefaultParams

		dataOntologyMu.Unlock()

		// 持久化
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存接口配置失败: %v", err)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"api":     api,
		})

	case http.MethodDelete:
		// 删除接口
		dataOntologyMu.Lock()
		if _, exists := dataOntologyApis[apiID]; !exists {
			dataOntologyMu.Unlock()
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "接口不存在",
			})
			return
		}

		delete(dataOntologyApis, apiID)
		dataOntologyMu.Unlock()

		// 持久化
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存接口配置失败: %v", err)
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

// handleApiDispatch 处理用户定义路径的外部API调用
func handleApiDispatch(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqPath := r.URL.Path
		reqMethod := r.Method

		if reqMethod == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}

		dataOntologyMu.RLock()
		var matchedApi *ApiConfig
		var matchedDb *DatabaseConfig
		for _, api := range dataOntologyApis {
			if api.Path == reqPath && strings.EqualFold(api.Method, reqMethod) {
				matchedApi = api
				if db, ok := dataOntologyDatabases[api.DatabaseID]; ok {
					matchedDb = db
				}
				break
			}
		}
		dataOntologyMu.RUnlock()

		if matchedApi == nil || matchedDb == nil {
			next.ServeHTTP(w, r)
			return
		}

		w.Header().Set("Content-Type", "application/json")

		if !verifyToken(r) {
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "未授权，请提供有效的 API Key 或 Token",
			})
			return
		}

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

		finalSQL, args, err := parseMyBatisSQL(matchedApi.SQL, params)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "SQL解析失败: " + err.Error(),
			})
			return
		}

		result, err := executeSQLQuery(matchedDb, finalSQL, args)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "查询失败: " + err.Error(),
			})
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"data":    result,
		})
	})
}

// handleApiTest 处理接口测试请求
func handleApiTest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
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

	// 提取接口ID
	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/data-ontology/apis/"), "/")
	if len(pathParts) < 2 || pathParts[0] == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "缺少接口ID",
		})
		return
	}
	apiID := pathParts[0]

	// 解析测试参数
	var testReq struct {
		Params map[string]interface{} `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&testReq); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求格式错误",
		})
		return
	}

	// 获取接口配置
	dataOntologyMu.RLock()
	api, exists := dataOntologyApis[apiID]
	if !exists {
		dataOntologyMu.RUnlock()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "接口不存在",
		})
		return
	}

	// 获取数据库配置
	dbConfig, dbExists := dataOntologyDatabases[api.DatabaseID]
	if !dbExists {
		dataOntologyMu.RUnlock()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在",
		})
		return
	}
	dataOntologyMu.RUnlock()

	// 解析MyBatis风格的SQL并替换参数
	finalSQL, args, err := parseMyBatisSQL(api.SQL, testReq.Params)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "SQL解析失败: " + err.Error(),
		})
		return
	}

	// 执行SQL查询
	result, err := executeSQLQuery(dbConfig, finalSQL, args)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询失败: " + err.Error(),
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    result,
	})
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
		if val, exists := params[paramName]; exists {
			return fmt.Sprintf("%v", val)
		}
		missingParams = append(missingParams, paramName)
		return match
	})

	// 然后处理 #{param} - 预编译参数
	hashPattern := `#\{([^}]+)\}`
	finalSQL = replaceWithRegex(finalSQL, hashPattern, func(match string) string {
		paramName := strings.TrimSpace(match[2 : len(match)-1])
		if val, exists := params[paramName]; exists {
			args = append(args, val)
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

	// SQL数据库
	driver, dsn, err := buildDSN(dbConfig)
	if err != nil {
		return nil, err
	}

	db, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, err
	}
	defer db.Close()

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
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	if r.Method == http.MethodGet {
		// 获取AI配置
		dataOntologyMu.RLock()
		config := dataOntologyAIConfig
		dataOntologyMu.RUnlock()

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"config":  config,
		})
		return
	}

	if r.Method == http.MethodPost {
		// 保存AI配置
		var config AIConfig
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		// 验证配置
		if config.URL == "" || config.APIKey == "" || config.Model == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请填写完整的配置信息",
			})
			return
		}

		// 保存配置
		dataOntologyMu.Lock()
		dataOntologyAIConfig = &config
		dataOntologyMu.Unlock()

		// 持久化
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存AI配置失败: %v", err)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "保存失败",
			})
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "配置保存成功",
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": false,
		"message": "不支持的请求方法",
	})
}

// handleAIQuery 处理AI查询（流式响应）
func handleAIQuery(w http.ResponseWriter, r *http.Request) {
	// 设置流式响应头
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if !verifyToken(r) {
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
	dataOntologyMu.RUnlock()

	if aiConfig == nil {
		sendSSE(w, "error", map[string]interface{}{
			"message": "请先配置AI设置",
		})
		return
	}

	// 发送读取表结构事件
	sendSSE(w, "thinking", map[string]interface{}{
		"message": "正在读取数据库表结构信息...",
	})
	flusher.Flush()

	// 获取数据库配置和表结构（含字段信息）
	dataOntologyMu.RLock()
	var dbSchemas []map[string]interface{}
	for _, dbID := range queryReq.Databases {
		dbConfig, exists := dataOntologyDatabases[dbID]
		if !exists {
			continue
		}

		tables, err := getTablesList(dbConfig)
		if err != nil {
			log.Printf("获取数据库 %s 表列表失败: %v", dbConfig.Name, err)
			continue
		}

		// 获取每张表的字段信息
		var tablesWithColumns []map[string]interface{}
		maxTables := 15
		if len(tables) > maxTables {
			tables = tables[:maxTables]
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

		dbSchemas = append(dbSchemas, map[string]interface{}{
			"name":   dbConfig.Name,
			"type":   dbConfig.Type,
			"tables": tablesWithColumns,
			"id":     dbID,
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

	if moduleSet["api-dispatch"] {
		handleAICreateApi(w, flusher, &queryReq, dbSchemas, aiConfig)
		return
	}

	if moduleSet["data-governance"] || moduleSet["ontology"] {
		sendSSE(w, "error", map[string]interface{}{
			"message": "该模块功能正在开发中，敬请期待",
		})
		return
	}

	// 无模块时保留关键词检测兜底
	if !moduleSet["db-manage"] && isCreateApiRequest(queryReq.Message) {
		handleAICreateApi(w, flusher, &queryReq, dbSchemas, aiConfig)
		return
	}

	// 最多重试3次
	maxRetries := 3
	var lastError string
	var lastSQL string
	var attempts []map[string]interface{}

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

		// 构建AI提示词（如果是重试，添加错误信息）
		var prompt string
		if retry == 0 {
			prompt = buildAIPrompt(queryReq.Message, dbSchemas, queryReq.Modules)
		} else {
			prompt = buildRetryPrompt(queryReq.Message, dbSchemas, lastError, attempts, queryReq.Modules)
		}

		// 调用AI服务生成SQL
		aiResponse, err := callAIService(aiConfig, prompt)
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
		
		// 检测是否生成了相同的SQL
		normalizedSQL := strings.ReplaceAll(strings.ReplaceAll(sqlQuery, " ", ""), "\n", "")
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

		if !exists {
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
			// 成功了，返回结果
			sendSSE(w, "success", map[string]interface{}{
				"response": responseText,
				"sql":      sqlQuery,
				"results":  results,
				"attempts": attempts,
				"retries":  retry,
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

	if !verifyToken(r) {
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

	if !exists {
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
	}
	return sb.String(), primaryDBType
}

func getModulePromptPrefix(modules []string) string {
	moduleSet := make(map[string]bool)
	for _, m := range modules {
		moduleSet[m] = true
	}

	if moduleSet["db-manage"] {
		return "你是一个专业的数据库管理助手，聚焦于SQL查询、数据写入、表结构操作。请根据用户的问题和数据库结构生成SQL语句。\n\n"
	}
	return "你是一个专业的数据库助手。用户想要查询数据库，请根据用户的问题和数据库结构生成SQL查询语句。\n\n"
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
	prompt += "5. 使用子查询或聚合函数来统计多个表的信息\n\n"
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
	prompt := getModulePromptPrefix(modules)
	prompt += "之前的SQL查询执行失败了，请根据错误信息重新生成正确的SQL。\n\n"
	prompt += "【重要】以下是真实的数据库结构信息，请严格基于这些表和字段生成SQL，不要编造不存在的列名或表名：\n"

	schemaText, primaryDBType := formatDBSchemaForPrompt(dbSchemas)
	prompt += schemaText

	queryColumns, _, sampleQuery := getDBSQLHints(primaryDBType)

	prompt += "\n用户问题：" + userMessage + "\n\n"
	prompt += "之前失败的尝试：\n"
	for _, attempt := range attempts {
		if sql, ok := attempt["sql"].(string); ok && sql != "" {
			prompt += fmt.Sprintf("尝试 %d:\n", attempt["attempt"])
			prompt += fmt.Sprintf("SQL: %s\n", sql)
			prompt += fmt.Sprintf("错误: %s\n\n", attempt["error"])
		}
	}

	prompt += getDBSpecificWarnings(primaryDBType)

	prompt += "⚠️ 重要注意事项：\n"
	prompt += "1. 【必须】只生成一条SQL语句，不要生成多条语句！\n"
	prompt += "2. 如果错误信息包含'near'关键字，说明SQL语法有问题，请仔细检查：\n"
	prompt += "   - 是否有多条SQL语句？如果有，只保留一条或合并为一条\n"
	prompt += "   - 是否有语法错误的关键字？\n"
	prompt += "   - 是否缺少或多余了分号、引号等符号？\n"
	prompt += "3. 如果错误信息包含'Table doesn't exist'或'对象不存在'，请使用正确的表名\n"
	prompt += "4. 如果错误信息包含'Column doesn't exist'或'列不存在'，请使用正确的字段名\n"
	prompt += "5. 如果错误信息包含'different number of columns'，说明UNION的表结构不同：\n"
	prompt += "   ❌ 不要用：SELECT * FROM table1 UNION ALL SELECT * FROM table2\n"
	prompt += "   ✅ 改用统计：SELECT 'table1' as name, COUNT(*) as count FROM table1 UNION ALL SELECT 'table2', COUNT(*) FROM table2\n"
	prompt += "   ✅ 或用子查询：SELECT (SELECT COUNT(*) FROM table1) as table1_count, (SELECT COUNT(*) FROM table2) as table2_count\n\n"

	prompt += "📚 正确的SQL参考示例：\n"
	prompt += "🔍 查询表结构：\n" + queryColumns + "\n"
	prompt += "📋 查看样本数据：" + sampleQuery + "\n\n"

	if strings.Contains(lastError, "near") && strings.Contains(lastError, "at line 2") {
		prompt += "🔍 根据错误分析：你生成了多条SQL语句，但系统只能执行一条！\n"
		prompt += "请修改为只生成一条SQL语句。\n\n"
	}

	if strings.Contains(lastError, "different number of columns") {
		prompt += "🔍 根据错误分析：你使用UNION ALL合并了列数不同的表！\n"
		prompt += "解决方案：\n"
		prompt += "1. 如果是统计数据，使用：SELECT 'table1' as table_name, COUNT(*) as count FROM table1 UNION ALL SELECT 'table2', COUNT(*) FROM table2\n"
		prompt += "2. 如果是查询字段，使用：\n" + queryColumns + "\n"
		prompt += "3. 不要直接合并不同结构的表数据！\n\n"
	}

	if strings.Contains(lastError, "connectex") || strings.Contains(lastError, "connection") {
		prompt += "🔍 根据错误分析：数据库连接超时或失败！\n"
		prompt += "请生成简单的SQL语句，避免复杂查询导致超时。\n\n"
	}

	if strings.Contains(lastError, "LIMIT") || strings.Contains(lastError, "语法分析") {
		prompt += "🔍 根据错误分析：SQL语法不兼容当前数据库！\n"
		prompt += "请严格使用当前数据库（" + primaryDBType + "）支持的SQL语法。\n\n"
	}

	prompt += "请按以下格式回复：\n"
	prompt += "1. 简单说明你发现的问题和修正方案（一句话）\n"
	prompt += "2. 提供修正后的SQL（只能有一条SQL语句）：\n"
	prompt += "```sql\n"
	prompt += "SELECT ... FROM ...;\n"
	prompt += "```\n\n"
	prompt += "❗ 再次强调：只生成一条SQL语句！"

	return prompt
}

// callAIService 调用AI服务
func callAIService(config *AIConfig, prompt string) (string, error) {
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

	// 发送请求
	client := &http.Client{
		Timeout: 30 * time.Second,
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

// extractCodeFromAIResponse 从 AI 返回中提取代码（去掉 ```js 等包裹）
func extractCodeFromAIResponse(s string) string {
	s = strings.TrimSpace(s)
	for _, prefix := range []string{"```javascript", "```js", "```"} {
		if strings.HasPrefix(s, prefix) {
			s = s[len(prefix):]
			break
		}
	}
	if idx := strings.Index(s, "```"); idx >= 0 {
		s = s[:idx]
	}
	return strings.TrimSpace(s)
}

// handleAICodegen 处理数据治理入库代码 AI 生成（使用与 AI 助手相同的 api url / api_key / model）
func handleAICodegen(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
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
		"excel":     "Excel 文件 (.xlsx)，使用 INPUT_FILE，gov.readExcel(INPUT_FILE) 与 XLSX.utils.sheet_to_json",
		"csv_file":  "CSV 文件，使用 INPUT_FILE.text() 与 Papa.parse",
		"csv_text":  "CSV 文本，使用 INPUT_TEXT 与 Papa.parse(INPUT_TEXT)",
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

// handleAICreateApi 处理AI创建接口请求
func handleAICreateApi(w http.ResponseWriter, flusher http.Flusher, queryReq *AIQueryRequest, dbSchemas []map[string]interface{}, aiConfig *AIConfig) {
	
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

			maxTables := 10
			if len(tables) > maxTables {
				tables = tables[:maxTables]
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

			dbSchemas[i]["tables"] = tablesWithColumns
		}
		dataOntologyMu.RUnlock()
	}

	sendSSE(w, "thinking", map[string]interface{}{
		"message": "正在分析您的需求并生成接口配置...",
	})
	flusher.Flush()
	
	// 构建创建接口的提示词
	prompt := buildCreateApiPrompt(queryReq.Message, dbSchemas)
	
	// 调用AI服务
	aiResponse, err := callAIService(aiConfig, prompt)
	if err != nil {
		sendSSE(w, "error", map[string]interface{}{
			"message": "AI服务调用失败: " + err.Error(),
		})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}
	
	// 解析AI返回的接口配置
	apiConfig, parseError := parseApiConfigFromAI(aiResponse, dbSchemas)
	if apiConfig == nil {
		log.Printf("解析接口配置失败，AI响应: %s", aiResponse)
		if parseError != "" {
			log.Printf("解析错误: %s", parseError)
		}
		sendSSE(w, "error", map[string]interface{}{
			"message": "AI未能生成有效的接口配置。" + parseError,
			"response": aiResponse,
		})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
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
func buildCreateApiPrompt(userMessage string, dbSchemas []map[string]interface{}) string {
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
	
	prompt += "\n用户需求：" + userMessage + "\n\n"
	prompt += "请生成接口配置，必须包含以下信息：\n"
	prompt += "1. name: 接口名称（中文，简洁明了）\n"
	prompt += "2. path: 接口路径（以/api/开头，使用RESTful风格）\n"
	prompt += "3. method: 请求方法（GET/POST/PUT/DELETE）\n"
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

// parseApiConfigFromAI 从AI响应中解析接口配置
func parseApiConfigFromAI(response string, dbSchemas []map[string]interface{}) (map[string]interface{}, string) {
	// 提取JSON代码块
	jsonStart := strings.Index(response, "```json")
	if jsonStart == -1 {
		jsonStart = strings.Index(response, "```")
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
		return nil, "未找到JSON代码块，且响应内容无法直接解析为JSON"
	}
	
	jsonStart = strings.Index(response[jsonStart:], "\n")
	if jsonStart == -1 {
		return nil, "找到代码块标记但格式不正确"
	}
	
	jsonEnd := strings.Index(response[jsonStart+1:], "```")
	if jsonEnd == -1 {
		return nil, "找到代码块开始标记但未找到结束标记"
	}
	
	jsonStr := strings.TrimSpace(response[jsonStart+1 : jsonStart+1+jsonEnd])
	
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
	
	// 添加数据库ID
	if len(dbSchemas) > 0 {
		if id, ok := dbSchemas[0]["id"].(string); ok {
			config["database_id"] = id
		}
	}
	
	return config, ""
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
			sql = line
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
	if !verifyToken(r) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		defer dataOntologyMu.RUnlock()

		taskList := make([]*GovernanceTask, 0, len(governanceTasks))
		for _, t := range governanceTasks {
			taskList = append(taskList, t)
		}
		sort.Slice(taskList, func(i, j int) bool {
			return taskList[i].CreatedAt > taskList[j].CreatedAt
		})
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
		task.ID = uuid.New().String()
		task.CreatedAt = time.Now().Format(time.RFC3339)
		task.Status = "idle"
		if task.Type == "scheduled" && task.Enabled {
			task.Enabled = true
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
	if !verifyToken(r) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}

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
			handleGovernanceTaskLogs(w, r, taskID)
			return
		case "upload":
			handleGovernanceTaskUpload(w, r, taskID)
			return
		case "save-log":
			handleGovernanceTaskSaveLog(w, r, taskID)
			return
		}
	}

	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		task, exists := governanceTasks[taskID]
		dataOntologyMu.RUnlock()
		if !exists {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务不存在"})
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "task": task})

	case http.MethodPut:
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
		if update.Name != "" {
			task.Name = update.Name
		}
		if update.Description != "" {
			task.Description = update.Description
		}
		if update.JsCode != "" {
			task.JsCode = update.JsCode
		}
		if update.DatabaseID != "" {
			task.DatabaseID = update.DatabaseID
		}
		if update.CronExpr != "" {
			task.CronExpr = update.CronExpr
		}
		if update.InputType != "" {
			task.InputType = update.InputType
		}
		if update.AcceptExts != nil {
			task.AcceptExts = update.AcceptExts
		}
		task.Enabled = update.Enabled
		task.UpdatedAt = time.Now().Format(time.RFC3339)
		dataOntologyMu.Unlock()

		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存治理任务更新失败: %v", err)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "task": task})

	case http.MethodDelete:
		dataOntologyMu.Lock()
		if _, exists := governanceTasks[taskID]; !exists {
			dataOntologyMu.Unlock()
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务不存在"})
			return
		}
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
	task.Enabled = !task.Enabled
	task.UpdatedAt = time.Now().Format(time.RFC3339)
	dataOntologyMu.Unlock()

	if err := saveDataOntologyStore(); err != nil {
		log.Printf("保存治理任务状态失败: %v", err)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "enabled": task.Enabled})
}

// handleGovernanceTaskLogs 获取任务执行日志
func handleGovernanceTaskLogs(w http.ResponseWriter, r *http.Request, taskID string) {
	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}
	dataOntologyMu.RLock()
	logs := governanceTaskLogs[taskID]
	dataOntologyMu.RUnlock()

	if logs == nil {
		logs = make([]*GovernanceTaskLog, 0)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "logs": logs})
}

// handleGovernanceTaskRun 不再服务端执行，仅用于更新任务状态（前端执行完回调）
func handleGovernanceTaskRun(w http.ResponseWriter, r *http.Request, taskID string) {
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "请在前端执行"})
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

// handleGovernanceExecuteSQL 治理任务执行SQL（供前端JS调用）
func handleGovernanceExecuteSQL(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
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
	if !exists {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "数据库不存在"})
		return
	}

	driver, dsn, dsnErr := buildDSN(dbConfig)
	if dsnErr != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的数据库类型: " + dbConfig.Type})
		return
	}

	db, err := sql.Open(driver, dsn)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "连接失败: " + err.Error()})
		return
	}
	defer db.Close()

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

func governanceScheduler() {
	for {
		time.Sleep(30 * time.Second)
		now := time.Now()

		dataOntologyMu.RLock()
		var tasksToRun []struct {
			id     string
			code   string
			dbID   string
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

func main() {
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

	// 获取当前目录
	exePath, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}
	rootDir := filepath.Dir(exePath)

	// 初始化数据本体池
	initDataOntology()

	// 启动Hub
	go hub.run()

	// 创建路由
	mux := http.NewServeMux()
	
	// WebSocket路由
	mux.HandleFunc("/ws/chat", handleWebSocket)
	
	// 数据本体池API路由
	mux.HandleFunc("/api/data-ontology/login", handleDataOntologyLogin)
	mux.HandleFunc("/api/data-ontology/apikey", handleApiKey)
	mux.HandleFunc("/api/data-ontology/test-connection", handleTestConnection)
	mux.HandleFunc("/api/data-ontology/databases", handleDatabases)
	mux.HandleFunc("/api/data-ontology/databases/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if strings.Contains(path, "/tables/") || strings.HasSuffix(path, "/tables") {
			handleTableData(w, r)
		} else {
			handleDatabaseDetail(w, r)
		}
	})
	
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
	mux.HandleFunc("/api/data-ontology/ai/query", handleAIQuery)
	mux.HandleFunc("/api/data-ontology/ai/confirm-execute", handleAIConfirmExecute)
	mux.HandleFunc("/api/data-ontology/ai/codegen", handleAICodegen)
	
	// 数据治理API路由
	mux.HandleFunc("/api/data-ontology/governance/tasks", handleGovernanceTasks)
	mux.HandleFunc("/api/data-ontology/governance/tasks/", handleGovernanceTaskDetail)
	mux.HandleFunc("/api/data-ontology/governance/execute-sql", handleGovernanceExecuteSQL)
	
	// 文件服务器
	fs := http.FileServer(http.Dir(rootDir))
	mux.Handle("/", fs)
	
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


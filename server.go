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
	"os/exec"
	"path/filepath"
	"sort"
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
	DocContent interface{} `json:"content,omitempty"`
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
	History   []map[string]interface{} `json:"history,omitempty"`
}

// 数据本体池存储
var (
	dataOntologyUsers     = make(map[string]*User)
	dataOntologyDatabases = make(map[string]*DatabaseConfig)
	dataOntologyApis      = make(map[string]*ApiConfig)
	dataOntologyAIConfig  *AIConfig
	dataOntologyMu        sync.RWMutex
)

// DataOntologyStore 持久化存储结构
type DataOntologyStore struct {
	Users     map[string]*User             `json:"users"`
	Databases map[string]*DatabaseConfig   `json:"databases"`
	Apis      map[string]*ApiConfig        `json:"apis"`
	AIConfig  *AIConfig                    `json:"ai_config,omitempty"`
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
	
	log.Printf("数据本体池初始化完成 - 用户数: %d, 数据库配置数: %d", 
		len(dataOntologyUsers), len(dataOntologyDatabases))
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
		return "SELECT NAME FROM SYSOBJECTS WHERE TYPE='SCHOBJ' AND SUBTYPE='UTAB'"
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
		query = fmt.Sprintf("SELECT column_name, data_type FROM user_tab_columns WHERE table_name = '%s' ORDER BY column_id", tableName)
	case "dm":
		query = fmt.Sprintf("SELECT column_name, data_type FROM user_tab_columns WHERE table_name = '%s' ORDER BY column_id", tableName)
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
			// information_schema.columns: column_name, data_type
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
			columns = append(columns, map[string]interface{}{
				"name": colName,
				"type": colType,
			})
		}
	}

	if columns == nil {
		columns = []map[string]interface{}{}
	}

	return columns, nil
}

// 验证Token
func verifyToken(r *http.Request) bool {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return false
	}

	token := strings.TrimPrefix(authHeader, "Bearer ")
	dataOntologyMu.RLock()
	defer dataOntologyMu.RUnlock()

	for _, user := range dataOntologyUsers {
		if user.Token == token {
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
						rows, err := db.Query(query)
						if err == nil {
							defer rows.Close()
							for rows.Next() {
								var tableName string
								if err := rows.Scan(&tableName); err == nil {
									tables = append(tables, tableName)
								}
							}
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
					whereClauses = append(whereClauses, fmt.Sprintf("`%s` IS NULL", col))
				} else {
					whereClauses = append(whereClauses, fmt.Sprintf("`%s` = ?", col))
					whereValues = append(whereValues, val)
				}
			}

			deleteQuery := fmt.Sprintf("DELETE FROM `%s` WHERE %s LIMIT 1", 
				tableName, strings.Join(whereClauses, " AND "))
			
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
			setClauses = append(setClauses, fmt.Sprintf("`%s` = ?", col))
			setValues = append(setValues, val)
		}

		// 构建WHERE条件（使用旧数据匹配）
		whereClauses := make([]string, 0)
		whereValues := make([]interface{}, 0)
		for col, val := range oldRow {
			if val == nil {
				whereClauses = append(whereClauses, fmt.Sprintf("`%s` IS NULL", col))
			} else {
				whereClauses = append(whereClauses, fmt.Sprintf("`%s` = ?", col))
				whereValues = append(whereValues, val)
			}
		}

		updateQuery := fmt.Sprintf("UPDATE `%s` SET %s WHERE %s LIMIT 1",
			tableName, strings.Join(setClauses, ", "), strings.Join(whereClauses, " AND "))
		
		allValues := append(setValues, whereValues...)
		result, err := db.Exec(updateQuery, allValues...)
		if err != nil {
			log.Printf("更新失败: %v", err)
			continue
		}

		affected, _ := result.RowsAffected()
		updated += int(affected)
	}

	// 3. 处理插入
	for _, insertData := range req.Inserts {
		cols := make([]string, 0)
		placeholders := make([]string, 0)
		values := make([]interface{}, 0)

		for col, val := range insertData {
			cols = append(cols, fmt.Sprintf("`%s`", col))
			placeholders = append(placeholders, "?")
			values = append(values, val)
		}

		insertQuery := fmt.Sprintf("INSERT INTO `%s` (%s) VALUES (%s)",
			tableName, strings.Join(cols, ", "), strings.Join(placeholders, ", "))
		
		result, err := db.Exec(insertQuery, values...)
		if err != nil {
			log.Printf("插入失败: %v", err)
			continue
		}

		affected, _ := result.RowsAffected()
		inserted += int(affected)
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
	columnDefs := make([]string, 0)
	primaryKeys := make([]string, 0)

	for _, col := range req.Columns {
		colDef := fmt.Sprintf("`%s` %s", col.Name, col.Type)
		
		// 添加长度
		if col.Size != "" && (col.Type == "VARCHAR" || col.Type == "CHAR") {
			colDef = fmt.Sprintf("`%s` %s(%s)", col.Name, col.Type, col.Size)
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
			default:
				colDef += " AUTO_INCREMENT"
			}
		}
		
		columnDefs = append(columnDefs, colDef)
		
		// 收集主键
		if col.PrimaryKey {
			primaryKeys = append(primaryKeys, fmt.Sprintf("`%s`", col.Name))
		}
	}

	// 添加主键约束
	if len(primaryKeys) > 0 {
		columnDefs = append(columnDefs, fmt.Sprintf("PRIMARY KEY (%s)", strings.Join(primaryKeys, ", ")))
	}

	createQuery := fmt.Sprintf("CREATE TABLE `%s` (\n    %s\n)", 
		req.Name, strings.Join(columnDefs, ",\n    "))

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

// RunGoRequest 运行Go代码的请求
type RunGoRequest struct {
	Code string `json:"code"`
}

// RunGoResponse 运行Go代码的响应
type RunGoResponse struct {
	Success bool   `json:"success"`
	Output  string `json:"output"`
	Error   string `json:"error"`
}

// handleRunGo 处理运行Go代码的请求
func handleRunGo(w http.ResponseWriter, r *http.Request) {
	// 设置响应头
	w.Header().Set("Content-Type", "application/json")

	// 只接受POST请求
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(RunGoResponse{
			Success: false,
			Error:   "只支持POST请求",
		})
		return
	}

	// 解析请求
	var req RunGoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(RunGoResponse{
			Success: false,
			Error:   "请求格式错误",
		})
		return
	}

	// 创建临时文件
	tmpFile, err := os.CreateTemp("", "go-learn-*.go")
	if err != nil {
		json.NewEncoder(w).Encode(RunGoResponse{
			Success: false,
			Error:   "创建临时文件失败: " + err.Error(),
		})
		return
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	// 写入代码
	if _, err := tmpFile.WriteString(req.Code); err != nil {
		json.NewEncoder(w).Encode(RunGoResponse{
			Success: false,
			Error:   "写入代码失败: " + err.Error(),
		})
		return
	}
	tmpFile.Close()

	// 执行代码
	cmd := exec.Command("go", "run", tmpFile.Name())
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// 设置超时
	timer := time.AfterFunc(10*time.Second, func() {
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
	})
	defer timer.Stop()

	err = cmd.Run()

	// 检查是否有错误
	if err != nil {
		errorMsg := stderr.String()
		if errorMsg == "" {
			errorMsg = err.Error()
		}
		json.NewEncoder(w).Encode(RunGoResponse{
			Success: false,
			Error:   errorMsg,
		})
		return
	}

	// 返回成功结果
	json.NewEncoder(w).Encode(RunGoResponse{
		Success: true,
		Output:  stdout.String(),
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

	// 执行查询
	rows, err := db.Query(sqlQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// 获取列名
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	// 读取结果
	var results []map[string]interface{}
	for rows.Next() {
		// 创建扫描目标
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range values {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, err
		}

		// 构建结果行
		row := make(map[string]interface{})
		for i, col := range columns {
			val := values[i]
			// 处理字节数组
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

	// 获取数据库配置和表结构
	dataOntologyMu.RLock()
	var dbSchemas []map[string]interface{}
	for _, dbID := range queryReq.Databases {
		dbConfig, exists := dataOntologyDatabases[dbID]
		if !exists {
			continue
		}

		// 获取表结构
		tables, err := getTablesList(dbConfig)
		if err != nil {
			log.Printf("获取数据库 %s 表列表失败: %v", dbConfig.Name, err)
			continue
		}

		dbSchemas = append(dbSchemas, map[string]interface{}{
			"name":   dbConfig.Name,
			"type":   dbConfig.Type,
			"tables": tables,
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
	
	// 检测是否是创建接口的请求
	if isCreateApiRequest(queryReq.Message) {
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
			prompt = buildAIPrompt(queryReq.Message, dbSchemas)
		} else {
			prompt = buildRetryPrompt(queryReq.Message, dbSchemas, lastError, attempts)
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

// buildAIPrompt 构建AI提示词
func buildAIPrompt(userMessage string, dbSchemas []map[string]interface{}) string {
	prompt := "你是一个专业的数据库助手。用户想要查询数据库，请根据用户的问题和数据库结构生成SQL查询语句。\n\n"
	prompt += "数据库结构：\n"

	for _, schema := range dbSchemas {
		prompt += fmt.Sprintf("\n数据库: %s (类型: %s)\n", schema["name"], schema["type"])
		prompt += "表列表: "
		if tables, ok := schema["tables"].([]string); ok {
			prompt += strings.Join(tables, ", ")
		}
		prompt += "\n"
	}

	prompt += "\n用户问题：" + userMessage + "\n\n"
	prompt += "⚠️ 重要规则：\n"
	prompt += "1. 【必须】只生成一条SQL语句！不能生成多条SQL语句！\n"
	prompt += "2. 【禁止】不要使用 UNION ALL 合并不同表的数据（列数和类型不同会报错）\n"
	prompt += "3. 使用子查询或聚合函数来统计多个表的信息\n\n"
	prompt += "📚 根据问题类型选择正确的SQL：\n\n"
	prompt += "🔍 查询表结构/字段信息：\n"
	prompt += "  SELECT table_name, column_name, data_type, column_comment\n"
	prompt += "  FROM information_schema.columns\n"
	prompt += "  WHERE table_schema = DATABASE() AND table_name IN ('table1', 'table2')\n"
	prompt += "  ORDER BY table_name, ordinal_position\n\n"
	prompt += "📊 分析/统计多个表的数据：\n"
	prompt += "  SELECT \n"
	prompt += "    'products' as table_name, COUNT(*) as row_count FROM products\n"
	prompt += "  UNION ALL\n"
	prompt += "  SELECT 'users' as table_name, COUNT(*) as row_count FROM users\n\n"
	prompt += "📋 查看表的样本数据：\n"
	prompt += "  SELECT * FROM table_name LIMIT 10\n\n"
	prompt += "❌ 错误示例（不要这样做）：\n"
	prompt += "  SELECT * FROM table1 UNION ALL SELECT * FROM table2  -- 错误！不同表结构无法合并\n\n"
	prompt += "🎯 理解用户意图：\n"
	prompt += "- 如果问\"有哪些字段/列\"：查询 information_schema.columns\n"
	prompt += "- 如果问\"分析数据/统计\"：使用 COUNT(*), SUM(), AVG() 等聚合函数\n"
	prompt += "- 如果问\"查看数据/内容\"：使用 SELECT * FROM ... LIMIT 10\n"
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
	prompt += "- 优先使用统计和聚合，不要直接合并不同表的数据\n"
	prompt += "- 不要包含过多的技术解释"

	return prompt
}

// buildRetryPrompt 构建重试提示词
func buildRetryPrompt(userMessage string, dbSchemas []map[string]interface{}, lastError string, attempts []map[string]interface{}) string {
	prompt := "你是一个专业的数据库助手。之前的SQL查询执行失败了，请根据错误信息重新生成正确的SQL。\n\n"
	prompt += "数据库结构：\n"

	for _, schema := range dbSchemas {
		prompt += fmt.Sprintf("\n数据库: %s (类型: %s)\n", schema["name"], schema["type"])
		prompt += "表列表: "
		if tables, ok := schema["tables"].([]string); ok {
			prompt += strings.Join(tables, ", ")
		}
		prompt += "\n"
	}

	prompt += "\n用户问题：" + userMessage + "\n\n"
	prompt += "之前失败的尝试：\n"
	for _, attempt := range attempts {
		if sql, ok := attempt["sql"].(string); ok && sql != "" {
			prompt += fmt.Sprintf("尝试 %d:\n", attempt["attempt"])
			prompt += fmt.Sprintf("SQL: %s\n", sql)
			prompt += fmt.Sprintf("错误: %s\n\n", attempt["error"])
		}
	}

	prompt += "⚠️ 重要注意事项：\n"
	prompt += "1. 【必须】只生成一条SQL语句，不要生成多条语句！\n"
	prompt += "2. 如果错误信息包含'near'关键字，说明SQL语法有问题，请仔细检查：\n"
	prompt += "   - 是否有多条SQL语句？如果有，只保留一条或合并为一条\n"
	prompt += "   - 是否有语法错误的关键字？\n"
	prompt += "   - 是否缺少或多余了分号、引号等符号？\n"
	prompt += "3. 如果错误信息包含'Table doesn't exist'，请使用正确的表名\n"
	prompt += "4. 如果错误信息包含'Column doesn't exist'，请使用正确的字段名\n"
	prompt += "5. 如果错误信息包含'different number of columns'，说明UNION的表结构不同：\n"
	prompt += "   ❌ 不要用：SELECT * FROM table1 UNION ALL SELECT * FROM table2\n"
	prompt += "   ✅ 改用统计：SELECT 'table1' as name, COUNT(*) as count FROM table1 UNION ALL SELECT 'table2', COUNT(*) FROM table2\n"
	prompt += "   ✅ 或用子查询：SELECT (SELECT COUNT(*) FROM table1) as table1_count, (SELECT COUNT(*) FROM table2) as table2_count\n\n"

	// 分析最常见的错误类型
	if strings.Contains(lastError, "near") && strings.Contains(lastError, "at line 2") {
		prompt += "🔍 根据错误分析：你生成了多条SQL语句，但系统只能执行一条！\n"
		prompt += "请修改为只生成一条SQL语句。\n\n"
	}
	
	if strings.Contains(lastError, "different number of columns") {
		prompt += "🔍 根据错误分析：你使用UNION ALL合并了列数不同的表！\n"
		prompt += "解决方案：\n"
		prompt += "1. 如果是统计数据，使用：SELECT 'table1' as table_name, COUNT(*) as count FROM table1 UNION ALL SELECT 'table2', COUNT(*) FROM table2\n"
		prompt += "2. 如果是查询字段，使用：SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('table1','table2')\n"
		prompt += "3. 不要直接合并不同结构的表数据！\n\n"
	}
	
	if strings.Contains(lastError, "connectex") || strings.Contains(lastError, "connection") {
		prompt += "🔍 根据错误分析：数据库连接超时或失败！\n"
		prompt += "请生成简单的SQL语句，避免复杂查询导致超时。\n\n"
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
	
	sendSSE(w, "thinking", map[string]interface{}{
		"message": "正在读取数据库表结构信息...",
	})
	flusher.Flush()
	
	// 增强 dbSchemas - 为每个表获取详细的字段信息
	dataOntologyMu.RLock()
	for i, schema := range dbSchemas {
		dbID, _ := schema["id"].(string)
		dbConfig, exists := dataOntologyDatabases[dbID]
		if !exists {
			continue
		}
		
		tables, _ := schema["tables"].([]string)
		var tablesWithColumns []map[string]interface{}
		
		// 限制表数量，避免请求过大（最多读取前10个表）
		maxTables := 10
		if len(tables) > maxTables {
			tables = tables[:maxTables]
		}
		
		for _, tableName := range tables {
			columns, err := getTableColumns(dbConfig, tableName)
			if err != nil {
				log.Printf("获取表 %s 字段失败: %v", tableName, err)
				// 即使失败也添加表信息，只是没有字段
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
	
	// API路由
	mux.HandleFunc("/api/run-go", handleRunGo)
	
	// 数据本体池API路由
	mux.HandleFunc("/api/data-ontology/login", handleDataOntologyLogin)
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
	
	// 文件服务器
	fs := http.FileServer(http.Dir(rootDir))
	mux.Handle("/", fs)
	
	handler := loggingMiddleware(corsMiddleware(mux))

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


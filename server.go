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
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "github.com/denisenkom/go-mssqldb"
	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	_ "github.com/lib/pq"
	_ "github.com/sijms/go-ora/v2"
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
	ID          string `json:"id"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	Method      string `json:"method"`      // GET, POST, PUT, DELETE
	DatabaseID  string `json:"database_id"` // 关联的数据库ID
	SQL         string `json:"sql"`         // MyBatis风格的SQL语句
	Description string `json:"description,omitempty"`
}

// ApiInfo 接口信息（包含数据库名称）
type ApiInfo struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Path         string `json:"path"`
	Method       string `json:"method"`
	DatabaseID   string `json:"database_id"`
	DatabaseName string `json:"database_name,omitempty"`
	SQL          string `json:"sql"`
	Description  string `json:"description,omitempty"`
}

// 数据本体池存储
var (
	dataOntologyUsers     = make(map[string]*User)
	dataOntologyDatabases = make(map[string]*DatabaseConfig)
	dataOntologyApis      = make(map[string]*ApiConfig)
	dataOntologyMu        sync.RWMutex
)

// DataOntologyStore 持久化存储结构
type DataOntologyStore struct {
	Users     map[string]*User             `json:"users"`
	Databases map[string]*DatabaseConfig   `json:"databases"`
	Apis      map[string]*ApiConfig        `json:"apis"`
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
		dsn := fmt.Sprintf("dm://%s:%s@%s:%d?schema=%s",
			config.User, config.Password, config.Host, config.Port, config.Database)
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

	// MongoDB 特殊处理
	if config.Type == "mongodb" {
		uri := fmt.Sprintf("mongodb://%s:%s@%s:%d/%s",
			config.User, config.Password, config.Host, config.Port, config.Database)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
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
			uri := fmt.Sprintf("mongodb://%s:%s@%s:%d/%s",
				config.User, config.Password, config.Host, config.Port, config.Database)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
			if err == nil {
				defer client.Disconnect(ctx)
				db := client.Database(config.Database)
				collections, err := db.ListCollectionNames(ctx, bson.M{})
				if err == nil {
					tables = collections
					connected = true
				}
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
	if len(parts) < 7 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的请求路径",
		})
		return
	}
	dbID := parts[4]
	tableName := parts[6]

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

	var data []map[string]interface{}

	// MongoDB 特殊处理
	if config.Type == "mongodb" {
		uri := fmt.Sprintf("mongodb://%s:%s@%s:%d/%s",
			config.User, config.Password, config.Host, config.Port, config.Database)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
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
			ID:          api.ID,
			Name:        api.Name,
			Path:        api.Path,
			Method:      api.Method,
			DatabaseID:  api.DatabaseID,
			SQL:         api.SQL,
			Description: api.Description,
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

	// 首先处理 ${param} - 直接替换
	dollarPattern := `\$\{([^}]+)\}`
	finalSQL = replaceWithRegex(finalSQL, dollarPattern, func(match string) string {
		paramName := strings.TrimSpace(match[2 : len(match)-1])
		if val, exists := params[paramName]; exists {
			return fmt.Sprintf("%v", val)
		}
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
		return match
	})

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
		if strings.Contains(path, "/tables/") {
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


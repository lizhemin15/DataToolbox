package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gorilla/websocket"
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
}

var hub = &Hub{
	clients:    make(map[string]*Client),
	broadcast:  make(chan []byte),
	register:   make(chan *Client),
	unregister: make(chan *Client),
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
				c.Name = msg.Name
				hub.sendPeerList(c)
			}

		case "message":
			// 转发消息到目标客户端
			msg.From = c.ID
			data, _ := json.Marshal(msg)

			hub.mu.RLock()
			if targetClient, ok := hub.clients[msg.To]; ok {
				select {
				case targetClient.Send <- data:
					log.Printf("消息已发送: %s -> %s", c.ID, msg.To)
				default:
					log.Printf("消息发送失败: %s -> %s (通道已满)", c.ID, msg.To)
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

	// 启动Hub
	go hub.run()

	// 创建路由
	mux := http.NewServeMux()
	
	// WebSocket路由
	mux.HandleFunc("/ws/chat", handleWebSocket)
	
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


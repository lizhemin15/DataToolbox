package main

import (
	"encoding/json"
	"fmt"
	"github.com/gorilla/websocket"
	"log"
	"net/http"
	"time"
)

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

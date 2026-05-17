package agent

import (
	"fmt"
	"sync"
	"time"
)

// ============================================================
// HITL (Human-in-the-Loop) 数据结构
// ============================================================

// HITLInteractionType 交互类型
type HITLInteractionType string

const (
	HITLTypeConfirm      HITLInteractionType = "confirm"       // 二次确认（是/否）
	HITLTypeSingleSelect HITLInteractionType = "single_select" // 单选
	HITLTypeMultiSelect  HITLInteractionType = "multi_select"  // 多选
	HITLTypeInput        HITLInteractionType = "input"          // 填空
	HITLTypeForm         HITLInteractionType = "form"           // 表单（多字段组合）
)

// HITLOption 选项（用于 single_select / multi_select / confirm 类型）
type HITLOption struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	Style       string `json:"style,omitempty"` // default | primary | danger | warning
}

// HITLField 表单字段（用于 input / form 类型）
type HITLField struct {
	ID           string      `json:"id"`
	Label        string      `json:"label"`
	Type         string      `json:"type"`                    // text | number | select | textarea
	Placeholder  string      `json:"placeholder,omitempty"`
	Required     bool        `json:"required,omitempty"`
	Options      []HITLOption `json:"options,omitempty"`       // type=select 时的选项
	DefaultValue string      `json:"default_value,omitempty"`
}

// HITLRequest 人在环路请求
type HITLRequest struct {
	ID              string               `json:"id"`
	SessionID       string               `json:"session_id"`
	InteractionType HITLInteractionType  `json:"interaction_type"`
	Title           string               `json:"title"`
	Description     string               `json:"description,omitempty"`
	Options         []HITLOption         `json:"options,omitempty"`
	Fields          []HITLField          `json:"fields,omitempty"`
	TimeoutSeconds  int                  `json:"timeout_seconds"`
	CreatedAt       time.Time            `json:"created_at"`
}

// HITLResponse 人在环路响应
type HITLResponse struct {
	HitlID    string         `json:"hitl_id"`
	Action    string         `json:"action"` // submit | cancel | timeout
	Values    map[string]any `json:"values,omitempty"`
	Timestamp time.Time       `json:"timestamp"`
}

// hitlPendingEntry 挂起请求条目（包含响应 channel）
type hitlPendingEntry struct {
	Request  HITLRequest
	Response chan HITLResponse
}

// ============================================================
// HITLManager — 管理所有 HITL 请求和响应
// ============================================================

// HITLManager 管理人在环路请求的生命周期
// 全局单例，API 端点通过它提交响应
type HITLManager struct {
	mu       sync.RWMutex
	pending  map[string]*hitlPendingEntry // hitlID → entry
	sessions map[string][]string          // sessionID → []hitlID（快速查询某 session 的所有挂起请求）
}

// NewHITLManager 创建 HITL 管理器
func NewHITLManager() *HITLManager {
	return &HITLManager{
		pending:  make(map[string]*hitlPendingEntry),
		sessions: make(map[string][]string),
	}
}

// RegisterRequest 注册一个 HITL 请求，返回响应 channel
// 调用方（AskUserTool）通过 channel 等待用户响应
func (m *HITLManager) RegisterRequest(req HITLRequest) <-chan HITLResponse {
	m.mu.Lock()
	defer m.mu.Unlock()

	ch := make(chan HITLResponse, 1)
	entry := &hitlPendingEntry{
		Request:  req,
		Response: ch,
	}
	m.pending[req.ID] = entry
	m.sessions[req.SessionID] = append(m.sessions[req.SessionID], req.ID)

	// 超时自动取消
	if req.TimeoutSeconds > 0 {
		go func() {
			time.Sleep(time.Duration(req.TimeoutSeconds) * time.Second)
			m.SubmitResponse(req.ID, HITLResponse{
				HitlID:    req.ID,
				Action:    "timeout",
				Timestamp: time.Now(),
			})
		}()
	}

	return ch
}

// SubmitResponse 用户提交 HITL 响应，唤醒阻塞的 Tool
// 返回 error 如果 hitlID 不存在或已响应
func (m *HITLManager) SubmitResponse(hitlID string, resp HITLResponse) error {
	m.mu.Lock()
	entry, exists := m.pending[hitlID]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("HITL request %s not found or already responded", hitlID)
	}

	// 从 pending 中移除（一次性响应）
	delete(m.pending, hitlID)

	// 从 sessions 索引中移除
	sessionID := entry.Request.SessionID
	if ids, ok := m.sessions[sessionID]; ok {
		filtered := make([]string, 0, len(ids))
		for _, id := range ids {
			if id != hitlID {
				filtered = append(filtered, id)
			}
		}
		if len(filtered) > 0 {
			m.sessions[sessionID] = filtered
		} else {
			delete(m.sessions, sessionID)
		}
	}

	m.mu.Unlock()

	// 发送响应到等待的 channel（非阻塞）
	select {
	case entry.Response <- resp:
	default:
		// channel 已满或已关闭，忽略
	}

	return nil
}

// GetPendingRequests 查询指定 session 的所有挂起请求（页面刷新恢复用）
func (m *HITLManager) GetPendingRequests(sessionID string) []HITLRequest {
	m.mu.RLock()
	defer m.mu.RUnlock()

	ids, ok := m.sessions[sessionID]
	if !ok {
		return nil
	}

	requests := make([]HITLRequest, 0, len(ids))
	for _, id := range ids {
		if entry, exists := m.pending[id]; exists {
			requests = append(requests, entry.Request)
		}
	}
	return requests
}

// Cleanup 清理 session 的所有请求（session 结束时调用）
func (m *HITLManager) Cleanup(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	ids, ok := m.sessions[sessionID]
	if !ok {
		return
	}

	for _, id := range ids {
		if entry, exists := m.pending[id]; exists {
			// 发送超时/取消响应，让等待的 goroutine 退出
			select {
			case entry.Response <- HITLResponse{
				HitlID:    id,
				Action:    "cancel",
				Timestamp: time.Now(),
			}:
			default:
			}
			delete(m.pending, id)
		}
	}
	delete(m.sessions, sessionID)
}
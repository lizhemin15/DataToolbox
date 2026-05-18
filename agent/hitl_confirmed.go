package agent

import (
	"log"
	"sync"
)

// hitlConfirmedSessions 记录已通过 ask_user 确认的 session
// key: sessionID, value: true 表示已确认
var hitlConfirmedSessions = struct {
	sync.RWMutex
	m map[string]bool
}{m: make(map[string]bool)}

// SetHITLConfirmed 标记 session 已通过 HITL 确认（由 ask_user 工具调用）
func SetHITLConfirmed(sessionID string) {
	hitlConfirmedSessions.Lock()
	hitlConfirmedSessions.m[sessionID] = true
	hitlConfirmedSessions.Unlock()
	log.Printf("[agent] HITL confirmed for session=%s", sessionID)
}

// IsHITLConfirmed 检查 session 是否已通过 HITL 确认
func IsHITLConfirmed(sessionID string) bool {
	hitlConfirmedSessions.RLock()
	defer hitlConfirmedSessions.RUnlock()
	return hitlConfirmedSessions.m[sessionID]
}

// ClearHITLConfirmed 清除 HITL 确认标记（每次查询结束后调用）
func ClearHITLConfirmed(sessionID string) {
	hitlConfirmedSessions.Lock()
	delete(hitlConfirmedSessions.m, sessionID)
	hitlConfirmedSessions.Unlock()
}

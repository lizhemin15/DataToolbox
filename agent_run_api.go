package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/YOUR_USERNAME/DataToolbox/agent"
	"github.com/google/uuid"
)

// ============================================================
// Agent Run API — 异步执行 + 事件轮询
// ============================================================

// AgentRunRequest 创建运行请求
type AgentRunRequest struct {
	Message   string   `json:"message"`
	SessionID string   `json:"session_id"`
	Databases []string `json:"databases,omitempty"`
	Modules   []string `json:"modules,omitempty"`
}

// handleAgentRuns POST /api/v1/agent/runs — 创建异步运行
func handleAgentRuns(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		apiBadRequest(w, "仅支持 POST 方法")
		return
	}

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	username := getUsernameFromRequest(r)
	if username == "" {
		apiUnauthorized(w, "无法识别用户")
		return
	}

	var req AgentRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apiBadRequest(w, "请求体解析失败")
		return
	}

	if req.Message == "" {
		apiBadRequest(w, "消息内容不能为空")
		return
	}

	sessionID := req.SessionID
	if sessionID == "" {
		sessionID = "default"
	}

	// 创建 AgentRun 记录
	runID := uuid.New().String()
	run := &AgentRun{
		ID:        runID,
		SessionID: sessionID,
		Username:  username,
		Status:    "running",
	}
	if err := sqlCreateAgentRun(run); err != nil {
		log.Printf("[agent-run] 创建运行记录失败: %v", err)
		apiServerError(w, "创建运行记录失败")
		return
	}

	// 启动异步 goroutine
	go runAgentAsync(runID, username, sessionID, req.Message, req.Databases, req.Modules)

	// 立即返回 run_id
	apiSuccess(w, map[string]interface{}{
		"run_id": runID,
		"status": "running",
	})
}

// runAgentAsync 异步执行 agent，事件写入 DB
func runAgentAsync(runID, username, sessionID, message string, databases, modules []string) {
	log.Printf("[agent-run] 异步运行启动: run=%s, user=%s, session=%s", runID, username, sessionID)

	// 获取 orchestrator（懒初始化）
	orch := getOrchestratorForSession(username, sessionID)
	if orch == nil {
		errMsg := "请先配置AI设置（API Key、模型）"
		_ = sqlUpdateAgentRunStatus(runID, "error", errMsg)
		log.Printf("[agent-run] 无 orchestrator: %s", errMsg)
		return
	}

	// 构建增强消息（复用现有逻辑）
	enhancedMessage := message
	var contextParts []string

	// 意图检测
	intentInfo := detectUserIntent(message)
	if intentInfo.DetectedModule != "" {
		intentDesc := fmt.Sprintf("- 检测到意图: %s (置信度: %.0f%%, 原因: %s)", intentInfo.DetectedModule, intentInfo.Confidence*100, intentInfo.Reason)
		contextParts = append(contextParts, "系统意图检测结果:\n"+intentDesc)
		log.Printf("[agent-run] intent detected: module=%s, confidence=%.2f", intentInfo.DetectedModule, intentInfo.Confidence)
	}

	// 注入数据库上下文
	if len(databases) > 0 {
		dataOntologyMu.RLock()
		var dbInfos []string
		for _, dbID := range databases {
			if db, ok := dataOntologyDatabases[dbID]; ok {
				dbInfos = append(dbInfos, fmt.Sprintf("- 数据库: %s (类型: %s, ID: %s)", db.Name, db.Type, dbID))
			}
		}
		dataOntologyMu.RUnlock()
		if len(dbInfos) > 0 {
			contextParts = append(contextParts, "用户通过 @命令 指定了以下数据库:\n"+strings.Join(dbInfos, "\n"))
		}
	}

	// 注入模块上下文
	if len(modules) > 0 {
		moduleNames := map[string]string{
			"db-manage":        "通用提问 — 查询数据、统计信息、了解表结构",
			"api-dispatch":     "接口制作 — 创建 API 接口、生成数据服务",
			"data-governance":  "数据治理 — 创建定时任务、数据导入导出",
			"quality-audit":    "质量审计 — 数据质量检查、校验规则",
			"ontology":         "本体查询 — 概念关系、语义分析",
			"small-model":      "小模型 — 本地模型、离线推理",
		}
		var modInfos []string
		for _, modID := range modules {
			if desc, ok := moduleNames[modID]; ok {
				modInfos = append(modInfos, fmt.Sprintf("- 模块: %s (%s)", modID, desc))
			}
		}
		if len(modInfos) > 0 {
			contextParts = append(contextParts, "用户通过 @命令 指定了以下操作模块:\n"+strings.Join(modInfos, "\n"))
		}
	}

	if len(contextParts) > 0 {
		enhancedMessage = strings.Join(contextParts, "\n\n") + "\n\n用户问题: " + message
	}

	// 使用 24h 超时（异步模式下不依赖 HTTP context，HITL 等待不受限）
	ctx, cancel := context.WithTimeout(context.Background(), 24*time.Hour)
	defer cancel()

	// 写入 start 事件
	seq := 0
	startData, _ := json.Marshal(map[string]interface{}{"message": "🤖 智能助手已启动，正在规划任务..."})
	_ = sqlAppendAgentEvent(runID, seq, "start", string(startData))
	seq++

	// 调用 Orchestrator.Run()
	eventCh, err := orch.Run(ctx, username, sessionID, enhancedMessage)
	if err != nil {
		errMsg := fmt.Sprintf("Agent执行失败: %v", err)
		errData, _ := json.Marshal(map[string]interface{}{"message": errMsg})
		_ = sqlAppendAgentEvent(runID, seq, "error", string(errData))
		_ = sqlUpdateAgentRunStatus(runID, "error", errMsg)
		log.Printf("[agent-run] 执行失败: %v", err)
		return
	}

	// 遍历事件，写入 DB
	eventCount := 0
	for evt := range eventCh {
		eventCount++
		evtDataJSON, _ := json.Marshal(evt.Data)
		eventType := string(evt.Type)
		_ = sqlAppendAgentEvent(runID, seq, eventType, string(evtDataJSON))
		seq++

		// 状态更新：HITL 等待
		if eventType == "hitl_interaction" {
			_ = sqlUpdateAgentRunStatus(runID, "waiting_hitl", "")
		} else if eventType != "start" && eventType != "done" {
			// 非 HITL 事件到来，说明 HITL 已确认或继续执行，恢复 running 状态
			_ = sqlUpdateAgentRunStatus(runID, "running", "")
		}

		log.Printf("[agent-run] event #%d: type=%s, seq=%d", eventCount, eventType, seq-1)
	}

	// 完成
	doneData, _ := json.Marshal(map[string]interface{}{})
	_ = sqlAppendAgentEvent(runID, seq, "done", string(doneData))
	_ = sqlUpdateAgentRunStatus(runID, "completed", "")

	// 清除 HITL 确认标记
	agent.ClearHITLConfirmed(sessionID)

	log.Printf("[agent-run] 完成: run=%s, user=%s, events=%d", runID, username, eventCount)
}

// handleAgentRunDetail GET /api/v1/agent/runs/{id} — 查询运行状态
// GET /api/v1/agent/runs/{id}/events?after_seq=N — 轮询事件
func handleAgentRunDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodGet {
		apiBadRequest(w, "仅支持 GET 方法")
		return
	}

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	// 解析 URL: /api/v1/agent/runs/{id} 或 /api/v1/agent/runs/{id}/events
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/agent/runs/")
	parts := strings.SplitN(path, "/", 2)

	runID := parts[0]
	if runID == "" {
		apiBadRequest(w, "缺少 run_id")
		return
	}

	// 查询运行记录
	run, err := sqlGetAgentRun(runID)
	if err != nil {
		apiServerError(w, "查询运行记录失败")
		return
	}
	if run == nil {
		apiBadRequest(w, "运行记录不存在")
		return
	}

	// 如果只是查询状态（无 /events 后缀）
	if len(parts) == 1 || parts[1] == "" {
		apiSuccess(w, run)
		return
	}

	// /events — 轮询事件
	if parts[1] == "events" {
		afterSeq := 0
		if as := r.URL.Query().Get("after_seq"); as != "" {
			if n, err := fmt.Sscanf(as, "%d", &afterSeq); err != nil || n != 1 {
				afterSeq = 0
			}
		}

		events, err := sqlGetAgentEvents(runID, afterSeq)
		if err != nil {
			apiServerError(w, "查询事件失败")
			return
		}

		lastSeq := afterSeq
		for _, evt := range events {
			if evt.Seq > lastSeq {
				lastSeq = evt.Seq
			}
		}

		apiSuccess(w, map[string]interface{}{
			"events":     events,
			"last_seq":   lastSeq,
			"run_status": run.Status,
		})
		return
	}

	apiBadRequest(w, "未知路径")
}

// handleAgentRunList GET /api/v1/agent/runs?session_id=&status= — 列出运行（断线重连用）
func handleAgentRunList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodGet {
		apiBadRequest(w, "仅支持 GET 方法")
		return
	}

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	sessionID := r.URL.Query().Get("session_id")
	status := r.URL.Query().Get("status")

	runs, err := sqlListAgentRuns(sessionID, status)
	if err != nil {
		apiServerError(w, "查询运行列表失败")
		return
	}

	apiSuccess(w, map[string]interface{}{
		"runs": runs,
	})
}
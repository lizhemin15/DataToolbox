package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

// handleAISessions GET /api/v1/agent/sessions - 获取当前用户所有会话
// POST /api/v1/agent/sessions - 创建新会话
func handleAISessions(w http.ResponseWriter, r *http.Request) {
	username := getUsernameFromRequest(r)
	if username == "" {
		apiUnauthorized(w, "未登录")
		return
	}

	switch r.Method {
	case http.MethodGet:
		sessions, err := sqlListAISessions(username)
		if err != nil {
			apiServerError(w, "获取会话失败: "+err.Error())
			return
		}
		if sessions == nil {
			sessions = []AISession{}
		}
		apiSuccess(w, sessions)

	case http.MethodPost:
		var req AISession
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		req.Owner = username
		if req.ID == "" {
			apiBadRequest(w, "缺少会话 ID")
			return
		}
		if err := sqlSaveAISession(&req); err != nil {
			apiServerError(w, "保存会话失败: "+err.Error())
			return
		}
		apiSuccess(w, req)

	default:
		apiMethodNotAllowed(w)
	}
}

// handleAISessionDetail GET/PUT/DELETE /api/v1/agent/sessions/{id}
func handleAISessionDetail(w http.ResponseWriter, r *http.Request) {
	username := getUsernameFromRequest(r)
	if username == "" {
		apiUnauthorized(w, "未登录")
		return
	}

	// 提取 ID
	path := r.URL.Path
	prefix := "/api/v1/agent/sessions/"
	if !strings.HasPrefix(path, prefix) {
		apiBadRequest(w, "无效路径")
		return
	}
	id := strings.TrimPrefix(path, prefix)
	if id == "" {
		apiBadRequest(w, "缺少会话 ID")
		return
	}

	switch r.Method {
	case http.MethodGet:
		session, err := sqlGetAISession(id, username)
		if err != nil {
			apiServerError(w, "获取会话失败: "+err.Error())
			return
		}
		if session == nil {
			apiNotFound(w, "会话不存在")
			return
		}
		apiSuccess(w, session)

	case http.MethodPut:
		var req AISession
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		req.ID = id
		req.Owner = username
		if err := sqlSaveAISession(&req); err != nil {
			apiServerError(w, "保存会话失败: "+err.Error())
			return
		}
		apiSuccess(w, req)

	case http.MethodDelete:
		if err := sqlDeleteAISession(id, username); err != nil {
			apiServerError(w, "删除会话失败: "+err.Error())
			return
		}
		apiSuccess(w, map[string]string{"message": "已删除"})

	default:
		apiMethodNotAllowed(w)
	}
}

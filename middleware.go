package main

import (
	"encoding/json"
	"log"
	"net/http"
)

// deprecationMiddleware 为旧版 API 添加弃用警告
func deprecationMiddleware(handler http.HandlerFunc, newEndpoint string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 添加弃用警告响应头
		w.Header().Set("Deprecation", "true")
		w.Header().Set("Sunset", "Sat, 01 Nov 2025 00:00:00 GMT") // 6个月后移除
		w.Header().Set("Link", `<`+newEndpoint+`>; rel="successor-version"`)
		
		// 调用原始 handler
		handler(w, r)
	}
}

// corsMiddleware CORS 中间件
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Internal-Call")
		
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		
		next.ServeHTTP(w, r)
	})
}

// authMiddleware 鉴权中间件
func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 检查是否是内部调用
		if r.Header.Get("X-Internal-Call") == "true" {
			next.ServeHTTP(w, r)
			return
		}
		
		// 检查 session token
		token := r.Header.Get("Authorization")
		if token == "" {
			cookie, err := r.Cookie("session_token")
			if err == nil {
				token = cookie.Value
			}
		}
		
		if token == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   "未授权访问",
			})
			return
		}
		
		// 验证 token
		if !verifyToken(r) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   "无效的会话令牌",
			})
			return
		}
		
		// 从请求中获取用户名
		username := r.Header.Get("X-Username")
		if username == "" {
			username = "admin" // 默认用户
		}
		
		// 将用户名添加到请求上下文
		r.Header.Set("X-Username", username)
		next.ServeHTTP(w, r)
	})
}

// loggingMiddleware 日志中间件
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[API] %s %s %s", r.Method, r.URL.Path, r.RemoteAddr)
		next.ServeHTTP(w, r)
	})
}

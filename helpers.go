package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

func getDBFromPool(config *DatabaseConfig) (*sql.DB, error) {
	// 先尝试读锁获取
	dbPool.RLock()
	if db, ok := dbPool.connections[config.ID]; ok {
		dbPool.RUnlock()
		// 验证连接是否有效
		if err := db.Ping(); err == nil {
			return db, nil
		}
		// 连接无效，需要重建
	} else {
		dbPool.RUnlock()
	}

	// 需要创建新连接
	dbPool.Lock()
	defer dbPool.Unlock()

	// 双重检查
	if db, ok := dbPool.connections[config.ID]; ok {
		if err := db.Ping(); err == nil {
			return db, nil
		}
		// 关闭无效连接
		db.Close()
		delete(dbPool.connections, config.ID)
	}

	// 创建新连接
	driver, dsn, err := buildDSN(config)
	if err != nil {
		return nil, err
	}

	db, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, err
	}

	// 设置连接池参数
	db.SetMaxOpenConns(maxOpenConns)
	db.SetMaxIdleConns(maxIdleConns)
	db.SetConnMaxLifetime(connMaxLifetime)
	db.SetConnMaxIdleTime(connMaxIdleTime)

	// 验证连接
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}

	dbPool.connections[config.ID] = db
	log.Printf("[DBPool] 创建新连接: id=%s, type=%s, host=%s", config.ID, config.Type, config.Host)
	return db, nil
}

// closeDBPool 关闭所有数据库连接池

func closeDBPool() {
	dbPool.Lock()
	defer dbPool.Unlock()
	for id, db := range dbPool.connections {
		if err := db.Close(); err != nil {
			log.Printf("[DBPool] 关闭连接失败: id=%s, err=%v", id, err)
		}
	}
	dbPool.connections = make(map[string]*sql.DB)
	log.Printf("[DBPool] 所有连接已关闭")
}

// removeDBFromPool 从连接池移除指定数据库连接

func removeDBFromPool(dbID string) {
	dbPool.Lock()
	defer dbPool.Unlock()
	if db, ok := dbPool.connections[dbID]; ok {
		db.Close()
		delete(dbPool.connections, dbID)
		log.Printf("[DBPool] 移除连接: id=%s", dbID)
	}
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

// isValidIdentifier 检查标识符（表名、列名）是否安全
// 防止 SQL 注入：只允许字母、数字、下划线，且不能以数字开头

var validIdentifierRegex = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// sanitizeFilename 清理文件名，防止路径遍历攻击
// 返回清理后的安全文件名，如果文件名不合法则返回错误

func sanitizeFilename(filename string) (string, error) {
	if filename == "" {
		return "", fmt.Errorf("文件名不能为空")
	}
	// 限制文件名长度
	if len(filename) > 255 {
		filename = filename[:255]
	}
	// 移除路径分隔符和危险字符
	filename = filepath.Base(filename)
	// 检查是否包含路径遍历
	if strings.Contains(filename, "..") {
		return "", fmt.Errorf("文件名包含非法字符")
	}
	// 移除控制字符
	cleaned := strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, filename)
	if cleaned == "" {
		return "", fmt.Errorf("文件名无效")
	}
	return cleaned, nil
}

func isValidIdentifier(name string) bool {
	if name == "" || len(name) > 128 {
		return false
	}
	return validIdentifierRegex.MatchString(name)
}

// isValidIdentifierWithSchema 检查带 schema 的标识符（如 owner.table）

func isValidIdentifierWithSchema(name string) bool {
	if name == "" || len(name) > 256 {
		return false
	}
	// 允许 schema.table 格式
	parts := strings.Split(name, ".")
	for _, part := range parts {
		if !isValidIdentifier(part) {
			return false
		}
	}
	return true
}

// safeQuoteIdentifier 安全地引用标识符，防止 SQL 注入
// 如果标识符合法，返回带引号的标识符；否则返回空字符串和错误

func safeQuoteIdentifier(name, dbType string) (string, error) {
	// 先验证标识符合法性
	if !isValidIdentifierWithSchema(name) {
		return "", fmt.Errorf("无效的标识符: %s", name)
	}

	switch dbType {
	case "postgresql", "timescaledb", "cockroachdb":
		return `"` + name + `"`, nil
	case "sqlserver":
		return "[" + name + "]", nil
	case "oracle", "dm":
		// Oracle/DM 通常不需要引号，直接返回大写形式
		return strings.ToUpper(name), nil
	default:
		// MySQL, SQLite, DuckDB, ClickHouse 等
		return "`" + name + "`", nil
	}
}

// mustSafeQuote 安全引用标识符，如果无效则返回空字符串和错误
// 注意：调用方应处理错误情况，不要忽略返回的错误

func mustSafeQuote(name, dbType string) (string, error) {
	quoted, err := safeQuoteIdentifier(name, dbType)
	if err != nil {
		return "", err
	}
	return quoted, nil
}

// ============================================================
// API 响应辅助函数
// 统一 API 响应格式，确保一致性
// ============================================================

// APIResponse 标准 API 响应结构

type APIResponse struct {
	Success   bool        `json:"success"`
	Message   string      `json:"message,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	Error     string      `json:"error,omitempty"`
	ErrorCode string      `json:"error_code,omitempty"` // 错误码，便于前端国际化
}

// 标准错误码定义

const (
	ErrCodeBadRequest       = "BAD_REQUEST"
	ErrCodeUnauthorized     = "UNAUTHORIZED"
	ErrCodeForbidden        = "FORBIDDEN"
	ErrCodeNotFound         = "NOT_FOUND"
	ErrCodeMethodNotAllowed = "METHOD_NOT_ALLOWED"
	ErrCodeInternalError    = "INTERNAL_ERROR"
	ErrCodeInvalidInput     = "INVALID_INPUT"
)

// jsonResponse 写入 JSON 响应（内部函数）

func jsonResponse(w http.ResponseWriter, data interface{}, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	if statusCode > 0 {
		w.WriteHeader(statusCode)
	}
	json.NewEncoder(w).Encode(data)
}

// jsonSuccess 写入成功 JSON 响应

func jsonSuccess(w http.ResponseWriter, data map[string]interface{}) {
	result := map[string]interface{}{"success": true}
	for k, v := range data {
		result[k] = v
	}
	jsonResponse(w, result, 0)
}

// jsonError 写入错误 JSON 响应

func jsonError(w http.ResponseWriter, message string, errorCode string) {
	jsonResponse(w, map[string]interface{}{"success": false, "message": message, "error_code": errorCode}, 0)
}

// jsonErrorWithLog 写入错误 JSON 响应并记录日志

func jsonErrorWithLog(w http.ResponseWriter, message string, errorCode string, logMsg string, logArgs ...interface{}) {
	if logMsg != "" {
		log.Printf(logMsg, logArgs...)
	}
	jsonError(w, message, errorCode)
}

// apiSuccess 返回成功响应（标准格式）

func apiSuccess(w http.ResponseWriter, data interface{}) {
	jsonResponse(w, APIResponse{
		Success: true,
		Data:    data,
	}, 0)
}

// apiSuccessWithMessage 返回带消息的成功响应

func apiSuccessWithMessage(w http.ResponseWriter, message string, data interface{}) {
	jsonResponse(w, APIResponse{
		Success: true,
		Message: message,
		Data:    data,
	}, 0)
}

// apiError 返回错误响应（标准格式）

func apiError(w http.ResponseWriter, message string, statusCode int, errorCode string) {
	jsonResponse(w, APIResponse{
		Success:   false,
		Message:   message,
		ErrorCode: errorCode,
	}, statusCode)
}

// apiBadRequest 返回 400 错误

func apiBadRequest(w http.ResponseWriter, message string) {
	apiError(w, message, http.StatusBadRequest, ErrCodeBadRequest)
}

// apiUnauthorized 返回 401 错误

func apiUnauthorized(w http.ResponseWriter, message string) {
	if message == "" {
		message = "未授权"
	}
	apiError(w, message, http.StatusUnauthorized, ErrCodeUnauthorized)
}

// apiForbidden 返回 403 错误

func apiForbidden(w http.ResponseWriter, message string) {
	if message == "" {
		message = "权限不足"
	}
	apiError(w, message, http.StatusForbidden, ErrCodeForbidden)
}

// apiNotFound 返回 404 错误

func apiNotFound(w http.ResponseWriter, message string) {
	if message == "" {
		message = "资源不存在"
	}
	apiError(w, message, http.StatusNotFound, ErrCodeNotFound)
}

// apiMethodNotAllowed 返回 405 错误

func apiMethodNotAllowed(w http.ResponseWriter, message ...string) {
	msg := "方法不允许"
	if len(message) > 0 && message[0] != "" {
		msg = message[0]
	}
	apiError(w, msg, http.StatusMethodNotAllowed, ErrCodeMethodNotAllowed)
}

// apiInternalError 返回 500 错误
func apiInternalError(w http.ResponseWriter, message string) {
	if message == "" {
		message = "服务器内部错误"
	}
	apiError(w, message, http.StatusInternalServerError, ErrCodeInternalError)
}

// apiServerError 返回 500 错误（别名）
func apiServerError(w http.ResponseWriter, message string) {
	apiInternalError(w, message)
}

// getUsernameFromRequest 从请求中获取当前用户名
func getUsernameFromRequest(r *http.Request) string {
	// 从 cookie 获取
	cookie, err := r.Cookie("auth_token")
	if err == nil && cookie.Value != "" {
		// 解析 token 获取用户名
		username := getUsernameFromToken(cookie.Value)
		if username != "" {
			return username
		}
	}
	
	// 从 Authorization header 获取
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") {
		token := strings.TrimPrefix(authHeader, "Bearer ")
		return getUsernameFromToken(token)
	}
	
	return ""
}

// apiInvalidInput 返回输入验证错误

func apiInvalidInput(w http.ResponseWriter, message string) {
	apiError(w, message, http.StatusBadRequest, ErrCodeInvalidInput)
}

// loggingMiddleware 日志中间件 - 记录请求方法和响应时间

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

// handleExportQuery 导出SQL查询结果（返回JSON，前端用XLSX库生成Excel）
// POST /api/v1/agent/export-query
// Body: { "database_id": "...", "database": "DM", "sql": "SELECT ..." }
// 支持数据库名称或ID，复用execute-sql逻辑
func handleExportQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}

	var req struct {
		DatabaseID string `json:"database_id"`
		Database   string `json:"database"`
		SQL        string `json:"sql"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}
	if (req.DatabaseID == "" && req.Database == "") || req.SQL == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "database/database_id 和 sql 不能为空"})
		return
	}

	// 如果传的是名称，解析为ID
	dbID := req.DatabaseID
	if dbID == "" && req.Database != "" {
		dataOntologyMu.RLock()
		for _, db := range dataOntologyDatabases {
			if strings.EqualFold(db.Name, req.Database) {
				dbID = db.ID
				break
			}
		}
		dataOntologyMu.RUnlock()
		if dbID == "" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "数据库 " + req.Database + " 不存在"})
			return
		}
	}

	// 验证只允许SELECT查询
	sqlUpper := strings.TrimSpace(strings.ToUpper(req.SQL))
	if !strings.HasPrefix(sqlUpper, "SELECT") && !strings.HasPrefix(sqlUpper, "SHOW") && !strings.HasPrefix(sqlUpper, "DESCRIBE") {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "导出仅支持SELECT查询"})
		return
	}

	// 获取数据库配置
	dataOntologyMu.RLock()
	dbConfig, exists := dataOntologyDatabases[dbID]
	dataOntologyMu.RUnlock()
	if !exists || !dataOntologyResourceVisible(dbConfig.Owner, username) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "数据库不存在"})
		return
	}

	// 执行查询
	db, err := getDBFromPool(dbConfig)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "连接失败: " + err.Error()})
		return
	}

	rows, err := db.Query(req.SQL)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "查询失败: " + err.Error()})
		return
	}
	defer rows.Close()

	columns, _ := rows.Columns()
	var results []map[string]interface{}
	for rows.Next() {
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		rows.Scan(valuePtrs...)
		row := make(map[string]interface{})
		for i, col := range columns {
			val := values[i]
			if b, ok := val.([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = val
			}
		}
		results = append(results, row)
	}

	log.Printf("[export-query] user=%s db=%s rows=%d sql=%s", username, dbID, len(results), req.SQL[:min(50, len(req.SQL))])

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    results,
		"columns": columns,
		"count":   len(results),
	})
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

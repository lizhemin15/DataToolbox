package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

// handleExportQuery 导出SQL查询结果为CSV文件
// POST /api/v1/agent/export-query
// Body: { "database_id": "...", "sql": "SELECT ...", "format": "csv" }
func handleExportQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "仅支持POST"})
		return
	}

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}

	var req struct {
		DatabaseID string `json:"database_id"`
		SQL        string `json:"sql"`
		Format     string `json:"format"` // csv (default)
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}
	if req.DatabaseID == "" || req.SQL == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "database_id 和 sql 不能为空"})
		return
	}

	// 验证只允许SELECT查询
	sqlUpper := strings.TrimSpace(strings.ToUpper(req.SQL))
	if !strings.HasPrefix(sqlUpper, "SELECT") && !strings.HasPrefix(sqlUpper, "SHOW") && !strings.HasPrefix(sqlUpper, "DESCRIBE") {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "导出仅支持SELECT查询"})
		return
	}

	// 获取数据库配置
	dataOntologyMu.RLock()
	dbConfig, exists := dataOntologyDatabases[req.DatabaseID]
	dataOntologyMu.RUnlock()
	if !exists || !dataOntologyResourceVisible(dbConfig.Owner, username) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "数据库不存在"})
		return
	}

	// 执行查询
	db, err := getDBFromPool(dbConfig)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "连接失败: " + err.Error()})
		return
	}

	rows, err := db.Query(req.SQL)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "查询失败: " + err.Error()})
		return
	}
	defer rows.Close()

	columns, _ := rows.Columns()
	var results [][]string
	for rows.Next() {
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		rows.Scan(valuePtrs...)
		row := make([]string, len(columns))
		for i, val := range values {
			if val == nil {
				row[i] = ""
			} else if b, ok := val.([]byte); ok {
				row[i] = string(b)
			} else {
				row[i] = fmt.Sprintf("%v", val)
			}
		}
		results = append(results, row)
	}

	// 生成文件名
	dbName := dbConfig.Name
	if dbName == "" {
		dbName = req.DatabaseID[:8]
	}
	timestamp := time.Now().Format("20060102_150405")
	filename := fmt.Sprintf("%s_query_%s.csv", dbName, timestamp)

	// 写CSV
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	// BOM for Excel UTF-8 compatibility
	w.Write([]byte{0xEF, 0xBB, 0xBF})

	cw := csv.NewWriter(w)
	cw.Write(columns)
	for _, row := range results {
		cw.Write(row)
	}
	cw.Flush()

	log.Printf("[export-query] %s exported %d rows from %s", username, len(results), dbName)
}

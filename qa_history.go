package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

func qaHistoryGET(w http.ResponseWriter, r *http.Request, username string) {
	_ = username
	db, err := openQualityAuditDB()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}

	// 解析查询参数
	query := r.URL.Query()
	databaseID := strings.TrimSpace(query.Get("database_id"))
	limit := 20
	if l := query.Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 100 {
			limit = v
		}
	}

	// 构建查询
	var rows *sql.Rows
	if databaseID != "" {
		rows, err = db.Query(`SELECT id, database_id, database_type, executed_at, duration_ms, summary, created_by FROM audit_history WHERE database_id = ? ORDER BY executed_at DESC LIMIT ?`, databaseID, limit)
	} else {
		rows, err = db.Query(`SELECT id, database_id, database_type, executed_at, duration_ms, summary, created_by FROM audit_history ORDER BY executed_at DESC LIMIT ?`, limit)
	}
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	defer rows.Close()

	var history []map[string]interface{}
	for rows.Next() {
		var id int
		var dbID, dbType, executedAt, summary, createdBy sql.NullString
		var durationMs sql.NullInt64
		if err := rows.Scan(&id, &dbID, &dbType, &executedAt, &durationMs, &summary, &createdBy); err != nil {
			continue
		}
		entry := map[string]interface{}{
			"id":           id,
			"database_id":  dbID.String,
			"database_type": dbType.String,
			"executed_at":  executedAt.String,
			"duration_ms":  durationMs.Int64,
			"summary":      summary.String,
			"created_by":   createdBy.String,
		}
		history = append(history, entry)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "history": history})
}

func qaErrorsGET(w http.ResponseWriter, r *http.Request, username string) {
	_ = username
	db, err := openQualityAuditDB()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}

	// 解析查询参数
	query := r.URL.Query()
	databaseID := strings.TrimSpace(query.Get("database_id"))
	limit := 20
	if l := query.Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 100 {
			limit = v
		}
	}

	// 构建查询
	var rows *sql.Rows
	if databaseID != "" {
		rows, err = db.Query(`SELECT id, database_id, rule_nm, rule_name, error_message, executed_at, created_by FROM audit_errors WHERE database_id = ? ORDER BY executed_at DESC LIMIT ?`, databaseID, limit)
	} else {
		rows, err = db.Query(`SELECT id, database_id, rule_nm, rule_name, error_message, executed_at, created_by FROM audit_errors ORDER BY executed_at DESC LIMIT ?`, limit)
	}
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	defer rows.Close()

	var errors []map[string]interface{}
	for rows.Next() {
		var id int
		var dbID, ruleNm, ruleName, errorMessage, executedAt, createdBy sql.NullString
		if err := rows.Scan(&id, &dbID, &ruleNm, &ruleName, &errorMessage, &executedAt, &createdBy); err != nil {
			continue
		}
		entry := map[string]interface{}{
			"id":            id,
			"database_id":   dbID.String,
			"rule_nm":       ruleNm.String,
			"rule_name":     ruleName.String,
			"error_message": errorMessage.String,
			"executed_at":   executedAt.String,
			"created_by":    createdBy.String,
		}
		errors = append(errors, entry)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "errors": errors})
}

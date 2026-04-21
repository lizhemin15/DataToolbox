package main

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
)

func qaHistoryGET(w http.ResponseWriter, r *http.Request, username string) {
	_ = username
	db, err := openQualityAuditDB()
	if err != nil {
		apiInternalError(w, err.Error())
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
		apiInternalError(w, err.Error())
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

	jsonSuccess(w, map[string]interface{}{"history": history})
}

func qaErrorsGET(w http.ResponseWriter, r *http.Request, username string) {
	_ = username
	db, err := openQualityAuditDB()
	if err != nil {
		apiInternalError(w, err.Error())
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
		apiInternalError(w, err.Error())
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

	jsonSuccess(w, map[string]interface{}{"errors": errors})
}

func qaRuleVersionsGET(w http.ResponseWriter, r *http.Request) {
	db, err := openQualityAuditDB()
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}

	// 解析查询参数
	query := r.URL.Query()
	nm := strings.TrimSpace(query.Get("nm"))
	limit := 20
	if l := query.Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 100 {
			limit = v
		}
	}

	// 构建查询
	var rows *sql.Rows
	if nm != "" {
		rows, err = db.Query(`SELECT id, nm, xh, name, sql, category, version, changed_at, changed_by, change_reason FROM rule_versions WHERE nm = ? ORDER BY version DESC LIMIT ?`, nm, limit)
	} else {
		rows, err = db.Query(`SELECT id, nm, xh, name, sql, category, version, changed_at, changed_by, change_reason FROM rule_versions ORDER BY changed_at DESC LIMIT ?`, limit)
	}
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	defer rows.Close()

	var versions []map[string]interface{}
	for rows.Next() {
		var id, version int
		var nm, xh, name, sqlStr, category, changedAt, changedBy, changeReason sql.NullString
		if err := rows.Scan(&id, &nm, &xh, &name, &sqlStr, &category, &version, &changedAt, &changedBy, &changeReason); err != nil {
			continue
		}
		entry := map[string]interface{}{
			"id":            id,
			"nm":            nm.String,
			"xh":            xh.String,
			"name":          name.String,
			"sql":           sqlStr.String,
			"category":      category.String,
			"version":       version,
			"changed_at":    changedAt.String,
			"changed_by":    changedBy.String,
			"change_reason": changeReason.String,
		}
		versions = append(versions, entry)
	}

	jsonSuccess(w, map[string]interface{}{"versions": versions})
}

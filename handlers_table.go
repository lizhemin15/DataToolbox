package main

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

func handleTableRetrievalSearch(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	_, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}

	// 解析参数
	databaseID := r.URL.Query().Get("database_id")
	query := r.URL.Query().Get("query")
	strategy := r.URL.Query().Get("strategy")
	
	// 如果 URL 没有指定策略，从全局配置读取
	if strategy == "" {
		if dataOntologyAIConfig != nil && dataOntologyAIConfig.TableRetrieval != nil && dataOntologyAIConfig.TableRetrieval.Strategy != "" {
			strategy = dataOntologyAIConfig.TableRetrieval.Strategy
		} else {
			strategy = "full" // 默认使用全量检索
		}
	}

	if databaseID == "" || query == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "缺少必要参数: database_id 或 query",
		})
		return
	}

	// 获取数据库配置
	dataOntologyMu.RLock()
	dbConfig, exists := dataOntologyDatabases[databaseID]
	dataOntologyMu.RUnlock()

	if !exists {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在",
		})
		return
	}

	// 构建检索配置
	config := &TableRetrievalConfig{
		Strategy:      strategy,
		MaxTables:     15,
		VectorWeight:  0.3,
		KeywordWeight: 0.4,
		GraphWeight:   0.3,
	}

	// 从全局 AI 配置获取权重
	if dataOntologyAIConfig != nil && dataOntologyAIConfig.TableRetrieval != nil {
		config.VectorWeight = dataOntologyAIConfig.TableRetrieval.VectorWeight
		config.KeywordWeight = dataOntologyAIConfig.TableRetrieval.KeywordWeight
		config.GraphWeight = dataOntologyAIConfig.TableRetrieval.GraphWeight
		if dataOntologyAIConfig.TableRetrieval.GraphConfig != nil {
			config.GraphConfig = dataOntologyAIConfig.TableRetrieval.GraphConfig
		}
	}

	// 执行检索
	results, err := retrieveRelevantTables(query, dbConfig, config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("检索失败: %v", err),
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"query":    query,
		"strategy": strategy,
		"results":  results,
		"count":    len(results),
	})
}

// handleTableRetrievalVectorList 获取向量索引列表（预览）

func handleTableRetrievalVectorList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	_, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	switch r.Method {
	case http.MethodGet:
		// 获取向量列表
		databaseID := r.URL.Query().Get("database_id")
		page := 1
		pageSize := 50
		if p := r.URL.Query().Get("page"); p != "" {
			if pv, err := strconv.Atoi(p); err == nil && pv > 0 {
				page = pv
			}
		}
		if ps := r.URL.Query().Get("page_size"); ps != "" {
			if psv, err := strconv.Atoi(ps); err == nil && psv > 0 && psv <= 200 {
				pageSize = psv
			}
		}

		manager := getFTS5Manager()
		if manager == nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "表检索系统未初始化",
			})
			return
		}

		vectors, total, err := manager.listVectors(databaseID, page, pageSize)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "获取向量列表失败: " + err.Error(),
			})
			return
		}

		// 补充元数据：按 database_id 分组，批量查询表信息
		dataOntologyMu.RLock()
		databasesCopy := make(map[string]DatabaseConfig)
		for k, v := range dataOntologyDatabases {
			databasesCopy[k] = *v
		}
		dataOntologyMu.RUnlock()

		// 按 database_id 分组向量
		vectorsByDB := make(map[string][]int) // database_id -> vector indices
		for i, v := range vectors {
			vectorsByDB[v.DatabaseID] = append(vectorsByDB[v.DatabaseID], i)
		}

		// 为每个数据库补充元数据
		for dbID, indices := range vectorsByDB {
			dbConfig, ok := databasesCopy[dbID]
			if !ok {
				continue // 数据库配置不存在，跳过
			}

			// 获取该数据库的表信息
			tableInfos, err := getTableInfoList(&dbConfig)
			if err != nil {
				continue // 查询失败，跳过
			}

			// 构建表名 -> TableInfo 映射
			tableMap := make(map[string]TableInfo)
			for _, ti := range tableInfos {
				tableMap[ti.Name] = ti
			}

			// 补充元数据到对应的向量
			for _, idx := range indices {
				ti, found := tableMap[vectors[idx].TableName]
				if !found {
					continue
				}

				// 填充字段
				vectors[idx].Comment = ti.Comment
				vectors[idx].ColumnCount = len(ti.Columns)
				if vectors[idx].ColumnCount == 0 {
					vectors[idx].ColumnCount = len(ti.ColumnNames)
				}

				// 提取主键字段
				var pkFields []string
				for _, col := range ti.Columns {
					if col.IsPK {
						pkFields = append(pkFields, col.Name)
					}
				}
				if len(pkFields) > 0 {
					vectors[idx].PKFields = strings.Join(pkFields, ",")
				}

				// 提取外键信息
				var fkFields []string
				for _, col := range ti.Columns {
					if col.IsFK && col.FKTable != "" {
						fkFields = append(fkFields, col.Name+"->"+col.FKTable)
					}
				}
				if len(fkFields) > 0 {
					vectors[idx].FKFields = strings.Join(fkFields, ",")
				}
			}
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":   true,
			"vectors":   vectors,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		})

	case http.MethodDelete:
		// 删除向量（支持批量）
		var req struct {
			DatabaseID string   `json:"database_id"`
			TableNames []string `json:"table_names"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		if req.DatabaseID == "" || len(req.TableNames) == 0 {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "database_id 和 table_names 不能为空",
			})
			return
		}

		manager := getFTS5Manager()
		if manager == nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "表检索系统未初始化",
			})
			return
		}

		if err := manager.deleteVectors(req.DatabaseID, req.TableNames); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "删除向量失败: " + err.Error(),
			})
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":       true,
			"deleted_count": len(req.TableNames),
		})

	case http.MethodPost:
		// 创建向量（同步指定表的向量）
		var req struct {
			DatabaseID string   `json:"database_id"`
			Tables     []string `json:"tables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		if req.DatabaseID == "" || len(req.Tables) == 0 {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "database_id 和 tables 不能为空",
			})
			return
		}

		manager := getFTS5Manager()
		if manager == nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "表检索系统未初始化",
			})
			return
		}

		dataOntologyMu.RLock()
		dbConfig, ok := dataOntologyDatabases[req.DatabaseID]
		aiConfig := dataOntologyAIConfig
		dataOntologyMu.RUnlock()

		if !ok {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "数据库不存在",
			})
			return
		}

		if !aiConfig.Embedding.Enabled || aiConfig.Embedding.URL == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "Embedding 未启用或未配置",
			})
			return
		}

		// 获取表信息列表
		tableInfos, err := getTableInfoList(dbConfig)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "获取表信息失败: " + err.Error(),
			})
			return
		}

		// 构建表名集合过滤
		tableSet := make(map[string]bool)
		for _, t := range req.Tables {
			tableSet[t] = true
		}

		var filteredInfos []TableInfo
		for _, ti := range tableInfos {
			if tableSet[ti.Name] {
				filteredInfos = append(filteredInfos, ti)
			}
		}

		// 同步指定表的向量
		synced, vectors, err := syncSpecificVectors(manager, dbConfig, filteredInfos, aiConfig.Embedding)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "创建向量失败: " + err.Error(),
			})
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"synced":  synced,
			"vectors": vectors,
			"tables":  req.Tables,
		})

	case http.MethodPut:
		// 更新向量（删除旧向量并重新生成）
		var req struct {
			DatabaseID string   `json:"database_id"`
			Tables     []string `json:"tables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		if req.DatabaseID == "" || len(req.Tables) == 0 {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "database_id 和 tables 不能为空",
			})
			return
		}

		manager := getFTS5Manager()
		if manager == nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "表检索系统未初始化",
			})
			return
		}

		dataOntologyMu.RLock()
		dbConfig, ok := dataOntologyDatabases[req.DatabaseID]
		aiConfig := dataOntologyAIConfig
		dataOntologyMu.RUnlock()

		if !ok {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "数据库不存在",
			})
			return
		}

		if !aiConfig.Embedding.Enabled || aiConfig.Embedding.URL == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "Embedding 未启用或未配置",
			})
			return
		}

		// 先删除旧向量
		if err := manager.deleteVectors(req.DatabaseID, req.Tables); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "删除旧向量失败: " + err.Error(),
			})
			return
		}

		// 获取表信息列表
		tableInfos, err := getTableInfoList(dbConfig)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "获取表信息失败: " + err.Error(),
			})
			return
		}

		// 构建表名集合过滤
		tableSet := make(map[string]bool)
		for _, t := range req.Tables {
			tableSet[t] = true
		}

		var filteredInfos []TableInfo
		for _, ti := range tableInfos {
			if tableSet[ti.Name] {
				filteredInfos = append(filteredInfos, ti)
			}
		}

		// 重新同步向量
		synced, vectors, err := syncSpecificVectors(manager, dbConfig, filteredInfos, aiConfig.Embedding)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "更新向量失败: " + err.Error(),
			})
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"synced":  synced,
			"vectors": vectors,
			"tables":  req.Tables,
		})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
	}
}

// handleTableRetrievalRelationList 获取关系索引列表（预览）

func handleTableRetrievalRelationList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	_, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	switch r.Method {
	case http.MethodGet:
		// 解析查询参数
		params := listRelationsParams{
			DatabaseID: r.URL.Query().Get("database_id"),
			Keyword:    r.URL.Query().Get("keyword"),
			MatchType:  r.URL.Query().Get("match_type"),
		}

		// 分页参数
		if p := r.URL.Query().Get("page"); p != "" {
			if pv, err := strconv.Atoi(p); err == nil && pv > 0 {
				params.Page = pv
			}
		}
		if ps := r.URL.Query().Get("page_size"); ps != "" {
			if psv, err := strconv.Atoi(ps); err == nil && psv > 0 && psv <= 200 {
				params.PageSize = psv
			}
		}

		// 只看源表
		if r.URL.Query().Get("source_only") == "true" {
			params.SourceOnly = true
		}

		manager := getFTS5Manager()
		if manager == nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "表检索系统未初始化",
			})
			return
		}

		relations, total, err := manager.listRelations(params)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "获取关系列表失败: " + err.Error(),
			})
			return
		}

		// 获取所有匹配类型（用于筛选下拉）
		matchTypes, _ := manager.getMatchTypes(params.DatabaseID)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":     true,
			"relations":   relations,
			"total":       total,
			"page":        params.Page,
			"page_size":   params.PageSize,
			"match_types": matchTypes,
		})

	case http.MethodDelete:
		// 删除关系（支持批量）
		var req struct {
			DatabaseID  string `json:"database_id"`
			RelationIDs []int  `json:"relation_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		if req.DatabaseID == "" || len(req.RelationIDs) == 0 {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "database_id 和 relation_ids 不能为空",
			})
			return
		}

		manager := getFTS5Manager()
		if manager == nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "表检索系统未初始化",
			})
			return
		}

		if err := manager.deleteRelations(req.DatabaseID, req.RelationIDs); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "删除关系失败: " + err.Error(),
			})
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":       true,
			"deleted_count": len(req.RelationIDs),
		})

	case http.MethodPost:
		// 添加关系
		var req struct {
			DatabaseID   string `json:"database_id"`
			SourceTable  string `json:"source_table"`
			SourceField  string `json:"source_field"`
			TargetTable  string `json:"target_table"`
			TargetField  string `json:"target_field"`
			MatchType    string `json:"match_type"`
			RelationName string `json:"relation_name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		if req.DatabaseID == "" || req.SourceTable == "" || req.TargetTable == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "database_id、source_table、target_table 不能为空",
			})
			return
		}

		manager := getFTS5Manager()
		if manager == nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "表检索系统未初始化",
			})
			return
		}

		id, err := manager.addRelation(req.DatabaseID, req.SourceTable, req.SourceField, req.TargetTable, req.TargetField, req.MatchType, req.RelationName)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "添加关系失败: " + err.Error(),
			})
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":     true,
			"relation_id": id,
		})

	case http.MethodPut:
		// 更新关系
		var req struct {
			DatabaseID   string `json:"database_id"`
			RelationID   int    `json:"relation_id"`
			SourceTable  string `json:"source_table"`
			SourceField  string `json:"source_field"`
			TargetTable  string `json:"target_table"`
			TargetField  string `json:"target_field"`
			MatchType    string `json:"match_type"`
			RelationName string `json:"relation_name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		if req.DatabaseID == "" || req.RelationID == 0 {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "database_id 和 relation_id 不能为空",
			})
			return
		}

		manager := getFTS5Manager()
		if manager == nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "表检索系统未初始化",
			})
			return
		}

		if err := manager.updateRelation(req.DatabaseID, req.RelationID, req.SourceTable, req.SourceField, req.TargetTable, req.TargetField, req.MatchType, req.RelationName); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "更新关系失败: " + err.Error(),
			})
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
		})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
	}
}

func queryForeignKeyLineage(db *sql.DB, config *DatabaseConfig, tables []string) ([]LineageEdge, string) {
	var edges []LineageEdge
	var warn string

	switch config.Type {
	case "mysql", "mariadb", "tidb":
		q := `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME
			FROM information_schema.KEY_COLUMN_USAGE
			WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
			ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`
		rows, err := db.Query(q, config.Database)
		if err != nil {
			return nil, "查询外键失败: " + err.Error()
		}
		defer rows.Close()
		for rows.Next() {
			var fromT, fromC, toT, toC, cname string
			if err := rows.Scan(&fromT, &fromC, &toT, &toC, &cname); err == nil {
				edges = append(edges, LineageEdge{FromTable: fromT, FromColumn: fromC, ToTable: toT, ToColumn: toC, Constraint: cname})
			}
		}

	case "postgresql", "timescaledb", "cockroachdb":
		q := `
			SELECT con.conname::text,
			       nsp.nspname || '.' || rel.relname,
			       att.attname::text,
			       fnsp.nspname || '.' || frel.relname,
			       fatt.attname::text
			FROM pg_catalog.pg_constraint con
			INNER JOIN pg_catalog.pg_class rel ON rel.oid = con.conrelid
			INNER JOIN pg_catalog.pg_namespace nsp ON nsp.oid = rel.relnamespace
			INNER JOIN pg_catalog.pg_class frel ON frel.oid = con.confrelid
			INNER JOIN pg_catalog.pg_namespace fnsp ON fnsp.oid = frel.relnamespace
			CROSS JOIN LATERAL unnest(con.conkey, con.confkey) AS u(attnum, refattnum)
			INNER JOIN pg_catalog.pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.attnum AND NOT att.attisdropped
			INNER JOIN pg_catalog.pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = u.refattnum AND NOT fatt.attisdropped
			WHERE con.contype = 'f'
			  AND nsp.nspname NOT IN ('pg_catalog', 'information_schema')`
		rows, err := db.Query(q)
		if err != nil {
			return nil, "查询外键失败: " + err.Error()
		}
		defer rows.Close()
		for rows.Next() {
			var cname, fromT, fromC, toT, toC string
			if err := rows.Scan(&cname, &fromT, &fromC, &toT, &toC); err == nil {
				edges = append(edges, LineageEdge{FromTable: fromT, FromColumn: fromC, ToTable: toT, ToColumn: toC, Constraint: cname})
			}
		}

	case "sqlserver":
		q := `
			SELECT OBJECT_SCHEMA_NAME(fkc.parent_object_id) + '.' + OBJECT_NAME(fkc.parent_object_id),
			       col1.name,
			       OBJECT_SCHEMA_NAME(fkc.referenced_object_id) + '.' + OBJECT_NAME(fkc.referenced_object_id),
			       col2.name,
			       fk.name
			FROM sys.foreign_key_columns fkc
			INNER JOIN sys.foreign_keys fk ON fkc.constraint_object_id = fk.object_id
			INNER JOIN sys.columns col1 ON fkc.parent_object_id = col1.object_id AND fkc.parent_column_id = col1.column_id
			INNER JOIN sys.columns col2 ON fkc.referenced_object_id = col2.object_id AND fkc.referenced_column_id = col2.column_id`
		rows, err := db.Query(q)
		if err != nil {
			return nil, "查询外键失败: " + err.Error()
		}
		defer rows.Close()
		for rows.Next() {
			var fromT, fromC, toT, toC, cname string
			if err := rows.Scan(&fromT, &fromC, &toT, &toC, &cname); err == nil {
				edges = append(edges, LineageEdge{FromTable: fromT, FromColumn: fromC, ToTable: toT, ToColumn: toC, Constraint: cname})
			}
		}

	case "oracle":
		q := `SELECT a.owner || '.' || a.table_name, a.column_name,
		         b.owner || '.' || b.table_name, b.column_name,
		         c.constraint_name
		      FROM all_cons_columns a
		      JOIN all_constraints c ON a.owner = c.owner AND a.constraint_name = c.constraint_name
		      JOIN all_constraints c_pk ON c.r_owner = c_pk.owner AND c.r_constraint_name = c_pk.constraint_name
		      JOIN all_cons_columns b ON c_pk.owner = b.owner AND c_pk.constraint_name = b.constraint_name
		        AND a.position = b.position
		      WHERE c.constraint_type = 'R'
		        AND a.owner NOT IN ('SYS','SYSTEM','OUTLN','DBSNMP','MDSYS','CTXSYS','XDB')`
		rows, err := db.Query(q)
		if err != nil {
			return nil, "查询外键失败: " + err.Error()
		}
		defer rows.Close()
		for rows.Next() {
			var fromT, fromC, toT, toC, cname string
			if err := rows.Scan(&fromT, &fromC, &toT, &toC, &cname); err == nil {
				edges = append(edges, LineageEdge{FromTable: fromT, FromColumn: fromC, ToTable: toT, ToColumn: toC, Constraint: cname})
			}
		}

	case "dm":
		q := `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME
			FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
			WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
			ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`
		rows, err := db.Query(q, config.Database)
		if err != nil {
			// 达梦部分版本元数据字段不同，返回空边并提示
			warn = "达梦库未返回标准 information_schema 外键信息: " + err.Error()
			return []LineageEdge{}, warn
		}
		defer rows.Close()
		for rows.Next() {
			var fromT, fromC, toT, toC, cname string
			if err := rows.Scan(&fromT, &fromC, &toT, &toC, &cname); err == nil {
				edges = append(edges, LineageEdge{FromTable: fromT, FromColumn: fromC, ToTable: toT, ToColumn: toC, Constraint: cname})
			}
		}

	case "sqlite":
		sqliteQuote := func(name string) string {
			return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
		}
		for _, t := range tables {
			prag := fmt.Sprintf("PRAGMA foreign_key_list(%s)", sqliteQuote(t))
			rows, err := db.Query(prag)
			if err != nil {
				continue
			}
			for rows.Next() {
				var id, seq int
				var refTable, fromCol, toCol string
				var onUpdate, onDelete, match string
				if err := rows.Scan(&id, &seq, &refTable, &fromCol, &toCol, &onUpdate, &onDelete, &match); err != nil {
					continue
				}
				if toCol == "" {
					toCol = fromCol
				}
				edges = append(edges, LineageEdge{
					FromTable: t, FromColumn: fromCol, ToTable: refTable, ToColumn: toCol,
					Constraint: fmt.Sprintf("fk_%d", id),
				})
			}
			rows.Close()
		}

	case "duckdb":
		warn = "DuckDB 在当前环境可能不可用；若已连接，暂不支持自动外键血缘"
		return []LineageEdge{}, warn

	default:
		warn = "该数据库类型未实现外键血缘采集"
	}

	return edges, warn
}

// 获取表数据

func handleTableData(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	log.Printf("[handleTableData] path=%s, parts=%v, len=%d", r.URL.Path, strings.Split(r.URL.Path, "/"), len(strings.Split(r.URL.Path, "/")))
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	// 从URL中提取数据库ID和表名
	path := r.URL.Path
	parts := strings.Split(path, "/")

	// 路径格式: /api/databases/{id}/tables 或 /api/databases/{id}/tables/{name}
	if len(parts) < 5 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的请求路径",
		})
		return
	}

	dbID := parts[3]

	dataOntologyMu.RLock()
	config, exists := dataOntologyDatabases[dbID]
	dataOntologyMu.RUnlock()

	if !exists || !dataOntologyResourceVisible(config.Owner, username) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在",
		})
		return
	}

	// 如果路径以 /tables 结尾
	if strings.HasSuffix(path, "/tables") {
		if r.Method == http.MethodGet {
			// 获取表列表
			handleDatabaseTablesList(w, r, config)
			return
		} else if r.Method == http.MethodPost {
			// 创建表
			handleTableCreate(w, r, config)
			return
		}
	}

	// 其他情况需要表名
	if len(parts) < 7 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的请求路径",
		})
		return
	}

	tableName := parts[5]

	// 安全验证：检查表名是否合法，防止 SQL 注入
	if !isValidIdentifierWithSchema(tableName) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的表名",
		})
		return
	}

	// 检查是否是特殊路径
	if strings.HasSuffix(path, "/structure") {
		// 获取表结构
		handleTableStructure(w, r, config, tableName)
		return
	}

	if strings.HasSuffix(path, "/rename") && (r.Method == http.MethodPut || r.Method == http.MethodPost) {
		handleTableRename(w, r, config, tableName)
		return
	}

	if strings.HasSuffix(path, "/data") {
		// 数据操作路径
		if r.Method == http.MethodPost {
			handleTableDataSave(w, r, config, tableName)
		} else {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "不支持的请求方法",
			})
		}
		return
	}

	// 处理不同的HTTP方法
	switch r.Method {
	case http.MethodGet:
		// 处理数据查询
		handleTableDataQuery(w, r, config, tableName)
		return
	case http.MethodDelete:
		// 删除表
		handleTableDrop(w, r, config, tableName)
		return
	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}
}

// TableDataSaveRequest 保存表格数据的请求体

type TableDataSaveRequest struct {
	Updates []struct {
		Index int                    `json:"index"`
		Data  map[string]interface{} `json:"data"`
	} `json:"updates"`
	Inserts []map[string]interface{} `json:"inserts"`
	Deletes []int                    `json:"deletes"`
}

// handleTableDataSave 处理表格数据保存（更新、插入、删除）

func handleTableDataSave(w http.ResponseWriter, r *http.Request, config *DatabaseConfig, tableName string) {
	// 安全验证：检查表名是否合法，防止 SQL 注入
	if !isValidIdentifierWithSchema(tableName) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的表名: " + tableName,
		})
		return
	}

	// 解析请求体
	var req TableDataSaveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求格式错误: " + err.Error(),
		})
		return
	}

	log.Printf("收到保存请求: 表=%s, 更新=%d条, 插入=%d条, 删除=%d条",
		tableName, len(req.Updates), len(req.Inserts), len(req.Deletes))

	// 只支持SQL数据库的数据修改
	if config.Type == "mongodb" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "MongoDB暂不支持此功能",
		})
		return
	}

	// 建立数据库连接 - 使用连接池
	db, err := getDBFromPool(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接失败: " + err.Error(),
		})
		return
	}

	// 首先查询所有数据以获取主键
	quotedTable, _ := safeQuoteIdentifier(tableName, config.Type)
	query := fmt.Sprintf("SELECT * FROM %s", quotedTable)

	rows, err := db.Query(query)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询失败: " + err.Error(),
		})
		return
	}

	// 获取列名
	columns, err := rows.Columns()
	if err != nil {
		rows.Close()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "获取列名失败: " + err.Error(),
		})
		return
	}

	// 读取所有数据
	allData := make([]map[string]interface{}, 0)
	for rows.Next() {
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range values {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			continue
		}

		row := make(map[string]interface{})
		for i, col := range columns {
			val := values[i]
			if b, ok := val.([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = val
			}
		}
		allData = append(allData, row)
	}
	rows.Close()

	log.Printf("查询到 %d 行数据", len(allData))

	// 根据数据库类型确定标识符引用符和是否支持 LIMIT
	var quoteChar string
	var supportsLimit bool
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb", "dm":
		quoteChar = `"`
		supportsLimit = config.Type != "dm" // 达梦不支持 LIMIT
	case "sqlserver":
		quoteChar = "["
		supportsLimit = false
	case "oracle":
		quoteChar = ""
		supportsLimit = false
	default:
		quoteChar = "`"
		supportsLimit = true
	}

	quoteIdentifier := func(name string) string {
		// 安全验证：检查标识符是否合法
		if !isValidIdentifier(name) {
			log.Printf("警告：无效的标识符被拒绝: %s", name)
			return "INVALID_IDENTIFIER"
		}
		if quoteChar == "[" {
			return "[" + name + "]"
		} else if quoteChar == "" {
			return name
		}
		return quoteChar + name + quoteChar
	}

	// Oracle 使用 :1, :2, ... 占位符，其他数据库用 ?
	oraclize := func(query string) string {
		if config.Type != "oracle" {
			return query
		}
		i := 0
		var buf strings.Builder
		for _, ch := range query {
			if ch == '?' {
				i++
				buf.WriteString(fmt.Sprintf(":%d", i))
			} else {
				buf.WriteRune(ch)
			}
		}
		return buf.String()
	}

	updated := 0
	inserted := 0
	deleted := 0

	// 1. 处理删除（从后往前删，避免索引混乱）
	if len(req.Deletes) > 0 {
		// 排序删除索引（从大到小）
		sort.Sort(sort.Reverse(sort.IntSlice(req.Deletes)))
		log.Printf("处理删除: %v", req.Deletes)

		for _, index := range req.Deletes {
			if index < 0 || index >= len(allData) {
				log.Printf("跳过无效索引: %d", index)
				continue
			}

			rowData := allData[index]

			// 构建WHERE条件（使用所有列匹配）
			whereClauses := make([]string, 0)
			whereValues := make([]interface{}, 0)
			for col, val := range rowData {
				if val == nil {
					whereClauses = append(whereClauses, fmt.Sprintf("%s IS NULL", quoteIdentifier(col)))
				} else {
					whereClauses = append(whereClauses, fmt.Sprintf("%s = ?", quoteIdentifier(col)))
					whereValues = append(whereValues, val)
				}
			}

			var deleteQuery string
			if supportsLimit {
				deleteQuery = fmt.Sprintf("DELETE FROM %s WHERE %s LIMIT 1",
					quoteIdentifier(tableName), strings.Join(whereClauses, " AND "))
			} else {
				// 达梦、Oracle、SQL Server 不支持 DELETE ... LIMIT
				// WHERE 条件已包含所有列匹配，理论上只会删除一行
				deleteQuery = fmt.Sprintf("DELETE FROM %s WHERE %s",
					quoteIdentifier(tableName), strings.Join(whereClauses, " AND "))
			}

			deleteQuery = oraclize(deleteQuery)
			log.Printf("执行删除SQL: %s", deleteQuery)
			result, err := db.Exec(deleteQuery, whereValues...)
			if err != nil {
				log.Printf("删除失败: %v", err)
				continue
			}

			affected, _ := result.RowsAffected()
			deleted += int(affected)
			log.Printf("删除成功，影响行数: %d", affected)
		}
	}

	// 2. 处理更新
	for _, update := range req.Updates {
		if update.Index < 0 || update.Index >= len(allData) {
			continue
		}

		oldRow := allData[update.Index]

		// 构建UPDATE语句
		setClauses := make([]string, 0)
		setValues := make([]interface{}, 0)
		for col, val := range update.Data {
			setClauses = append(setClauses, fmt.Sprintf("%s = ?", quoteIdentifier(col)))
			setValues = append(setValues, val)
		}

		// 构建WHERE条件（使用旧数据匹配）
		whereClauses := make([]string, 0)
		whereValues := make([]interface{}, 0)
		for col, val := range oldRow {
			if val == nil {
				whereClauses = append(whereClauses, fmt.Sprintf("%s IS NULL", quoteIdentifier(col)))
			} else {
				whereClauses = append(whereClauses, fmt.Sprintf("%s = ?", quoteIdentifier(col)))
				whereValues = append(whereValues, val)
			}
		}

		var updateQuery string
		if supportsLimit {
			updateQuery = fmt.Sprintf("UPDATE %s SET %s WHERE %s LIMIT 1",
				quoteIdentifier(tableName), strings.Join(setClauses, ", "), strings.Join(whereClauses, " AND "))
		} else {
			// 达梦、Oracle、SQL Server 不支持 UPDATE ... LIMIT
			// WHERE 条件已包含所有列匹配，理论上只会更新一行
			updateQuery = fmt.Sprintf("UPDATE %s SET %s WHERE %s",
				quoteIdentifier(tableName), strings.Join(setClauses, ", "), strings.Join(whereClauses, " AND "))
		}

		allValues := append(setValues, whereValues...)
		updateQuery = oraclize(updateQuery)
		log.Printf("执行更新SQL: %s", updateQuery)
		result, err := db.Exec(updateQuery, allValues...)
		if err != nil {
			log.Printf("更新失败: %v, SQL: %s", err, updateQuery)
			continue
		}

		affected, _ := result.RowsAffected()
		updated += int(affected)
		log.Printf("更新成功，影响行数: %d", affected)
	}

	// 3. 处理插入
	// 对于达梦/Oracle 数据库，需要先查询自增列并排除
	identityColumns := make(map[string]bool)
	if config.Type == "dm" {
		// 安全验证已确保 tableName 合法
		identQuery := fmt.Sprintf(`
			SELECT a.NAME
			FROM SYS.SYSCOLUMNS a, sys.sysobjects b
			WHERE b.id = a.id AND b.name = '%s' AND (a.INFO2 & 0x01) = 0x01
		`, oracleEscapeIdentifier(tableName))
		identRows, err := db.Query(identQuery)
		if err == nil {
			defer identRows.Close()
			for identRows.Next() {
				var colName string
				if err := identRows.Scan(&colName); err == nil {
					identityColumns[colName] = true
					log.Printf("发现自增列: %s", colName)
				}
			}
		}
	}
	if config.Type == "oracle" {
		tbl := tableName
		if idx := strings.Index(tbl, "."); idx >= 0 {
			tbl = tbl[idx+1:]
		}
		// 安全验证已确保表名合法
		identQuery := fmt.Sprintf("SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' AND IDENTITY_COLUMN = 'YES'", oracleEscapeIdentifier(tbl))
		identRows, err := db.Query(identQuery)
		if err == nil {
			defer identRows.Close()
			for identRows.Next() {
				var colName string
				if err := identRows.Scan(&colName); err == nil {
					identityColumns[colName] = true
					log.Printf("发现Oracle自增列: %s", colName)
				}
			}
		}
	}

	for _, insertData := range req.Inserts {
		cols := make([]string, 0)
		placeholders := make([]string, 0)
		values := make([]interface{}, 0)

		for col, val := range insertData {
			// 达梦/Oracle：跳过自增列
			if (config.Type == "dm" || config.Type == "oracle") && identityColumns[col] {
				log.Printf("跳过自增列 %s", col)
				continue
			}

			cols = append(cols, quoteIdentifier(col))
			placeholders = append(placeholders, "?")
			values = append(values, val)
		}

		var insertQuery string
		var result sql.Result
		var err error

		// 如果所有列都被跳过（只有自增列），使用 DEFAULT VALUES
		if len(cols) == 0 {
			insertQuery = fmt.Sprintf("INSERT INTO %s DEFAULT VALUES", quoteIdentifier(tableName))
			log.Printf("执行插入SQL (默认值): %s", insertQuery)
			result, err = db.Exec(insertQuery)
		} else {
			insertQuery = fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
				quoteIdentifier(tableName), strings.Join(cols, ", "), strings.Join(placeholders, ", "))
			insertQuery = oraclize(insertQuery)
			log.Printf("执行插入SQL: %s", insertQuery)
			result, err = db.Exec(insertQuery, values...)
		}

		if err != nil {
			log.Printf("插入失败: %v, SQL: %s", err, insertQuery)
			continue
		}

		affected, _ := result.RowsAffected()
		inserted += int(affected)
		log.Printf("插入成功，影响行数: %d", affected)
	}

	log.Printf("保存完成: 更新=%d, 插入=%d, 删除=%d", updated, inserted, deleted)

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"updated":  updated,
		"inserted": inserted,
		"deleted":  deleted,
	})
}

// handleTableDataQuery 处理表格数据查询

func handleTableDataQuery(w http.ResponseWriter, r *http.Request, config *DatabaseConfig, tableName string) {
	var data []map[string]interface{}

	// 解析分页参数 ?page=1&size=50
	page := 1
	size := 100
	if p, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && p > 0 {
		page = p
	}
	if s, err := strconv.Atoi(r.URL.Query().Get("size")); err == nil && s > 0 && s <= 500 {
		size = s
	}
	offset := (page - 1) * size

	// MongoDB 特殊处理
	if config.Type == "mongodb" {
		uri := buildMongoURI(config)
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "连接失败: " + err.Error(),
			})
			return
		}
		defer client.Disconnect(ctx)

		collection := client.Database(config.Database).Collection(tableName)
		cursor, err := collection.Find(ctx, bson.M{}, options.Find().SetLimit(int64(size)).SetSkip(int64(offset)))
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "查询失败: " + err.Error(),
			})
			return
		}
		defer cursor.Close(ctx)

		data = make([]map[string]interface{}, 0)
		for cursor.Next(ctx) {
			var result map[string]interface{}
			if err := cursor.Decode(&result); err == nil {
				// 安全处理 Binary 数据：替换为元信息，避免 base64 巨型字符串
				for k, v := range result {
					if bin, ok := v.(primitive.Binary); ok {
						result[k] = map[string]interface{}{
							"_blob": true,
							"_size": len(bin.Data),
							"_type": "BINARY",
						}
					}
				}
				data = append(data, result)
			}
		}
	} else {
		// SQL数据库通用处理 - 使用连接池
		startTime := time.Now()
		db, err := getDBFromPool(config)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "连接失败: " + err.Error(),
			})
			return
		}

		// 使用列信息缓存
		blobColNames := getCachedBlobColumns(config.ID, tableName, db)

		// 构建 SELECT 列表：非 BLOB 列正常选，BLOB 列用 LENGTH 函数替代
		var selectCols []string

		if len(blobColNames) == 0 {
			selectCols = []string{"*"}
		} else {
			allCols := getCachedAllColumns(config.ID, tableName, db)
			if len(allCols) > 0 {
				for _, colName := range allCols {
					quotedCol := quoteIdentifier(config.Type, colName)
					if blobColNames[colName] {
						lengthExpr := getBlobLengthExpr(config.Type, quotedCol)
						selectCols = append(selectCols, fmt.Sprintf("%s AS %s", lengthExpr, quotedCol))
					} else {
						selectCols = append(selectCols, quotedCol)
					}
				}
			}
			if len(selectCols) == 0 {
				selectCols = []string{"*"}
			}
		}

		selectClause := strings.Join(selectCols, ", ")

		// 查询数据（带分页）
		var query string
		switch config.Type {
		case "postgresql", "timescaledb", "cockroachdb":
			query = fmt.Sprintf(`SELECT %s FROM "%s" LIMIT %d OFFSET %d`, selectClause, tableName, size, offset)
		case "oracle", "dm":
			query = fmt.Sprintf("SELECT %s FROM (SELECT a.*, ROWNUM rn FROM (SELECT %s FROM %s) a WHERE ROWNUM <= %d) WHERE rn > %d",
				selectClause, selectClause, tableName, offset+size, offset)
		case "sqlserver":
			query = fmt.Sprintf("SELECT %s FROM [%s] ORDER BY (SELECT NULL) OFFSET %d ROWS FETCH NEXT %d ROWS ONLY",
				selectClause, tableName, offset, size)
		case "duckdb":
			query = fmt.Sprintf("SELECT %s FROM %s LIMIT %d OFFSET %d", selectClause, tableName, size, offset)
		case "clickhouse":
			query = fmt.Sprintf("SELECT %s FROM `%s` LIMIT %d OFFSET %d", selectClause, tableName, size, offset)
		default:
			query = fmt.Sprintf("SELECT %s FROM `%s` LIMIT %d OFFSET %d", selectClause, tableName, size, offset)
		}

		rows, err := db.Query(query)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "查询失败: " + err.Error(),
			})
			return
		}
		defer rows.Close()

		// 获取列名
		columns, err := rows.Columns()
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "获取列名失败: " + err.Error(),
			})
			return
		}

		// 读取数据
		data = make([]map[string]interface{}, 0)

		// 获取列类型信息，用于识别大文本列
		colTypes, _ := rows.ColumnTypes()
		textCols := make(map[string]bool)
		for _, ct := range colTypes {
			dbType := strings.ToUpper(ct.DatabaseTypeName())
			if isTextTypeDB(dbType) {
				textCols[ct.Name()] = true
			}
		}

		for rows.Next() {
			values := make([]interface{}, len(columns))
			valuePtrs := make([]interface{}, len(columns))
			for i := range values {
				valuePtrs[i] = &values[i]
			}

			if err := rows.Scan(valuePtrs...); err != nil {
				continue
			}

			row := make(map[string]interface{})
			for i, col := range columns {
				val := values[i]
				if val == nil {
					row[col] = nil
				} else if blobColNames[col] {
					var size int64
					switch v := val.(type) {
					case int64:
						size = v
					case float64:
						size = int64(v)
					case []byte:
						size = int64(len(v))
					case string:
						fmt.Sscanf(v, "%d", &size)
					}
					row[col] = map[string]interface{}{
						"_blob": true,
						"_size": size,
						"_type": "BLOB",
					}
				} else if b, ok := val.([]byte); ok {
					// 运行时安全检测：不依赖预识别的两层兜底
					if len(b) > 256 {
						// 超过 256 字节直接当作 BLOB 处理
						row[col] = map[string]interface{}{
							"_blob": true,
							"_size": len(b),
							"_type": "BLOB",
						}
					} else if isBinaryData(b[:min(len(b), 512)]) {
						// 小数据但检测为二进制
						row[col] = map[string]interface{}{
							"_blob": true,
							"_size": len(b),
							"_type": "BLOB",
						}
					} else if len(b) > 1024 {
						row[col] = string(b[:1024]) + "..."
					} else {
						row[col] = string(b)
					}
				} else if s, ok := val.(string); ok && len(s) > 1024 {
					row[col] = s[:1024] + "..."
				} else {
					row[col] = val
				}
			}
			data = append(data, row)
		}

		elapsed := time.Since(startTime).Milliseconds()
		w.Header().Set("X-Elapsed", fmt.Sprintf("%dms", elapsed))
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    data,
	})
}

// handleTableStructure 获取或修改表结构

func handleTableStructure(w http.ResponseWriter, r *http.Request, config *DatabaseConfig, tableName string) {
	// 安全验证：检查表名是否合法，防止 SQL 注入
	if !isValidIdentifierWithSchema(tableName) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的表名",
		})
		return
	}

	// 只支持SQL数据库
	if config.Type == "mongodb" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "MongoDB暂不支持此功能",
		})
		return
	}

	// 根据HTTP方法分发
	if r.Method == http.MethodPut {
		handleTableStructureUpdate(w, r, config, tableName)
		return
	} else if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}

	// 使用连接池
	db, err := getDBFromPool(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接失败: " + err.Error(),
		})
		return
	}

	// 根据数据库类型查询表结构
	var query string
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb":
		query = fmt.Sprintf(`
			SELECT column_name, data_type, is_nullable, column_default
			FROM information_schema.columns
			WHERE table_name = '%s'
			ORDER BY ordinal_position
		`, tableName)
	case "mysql", "mariadb", "tidb":
		query = fmt.Sprintf("DESCRIBE `%s`", tableName)
	case "sqlite", "duckdb":
		query = fmt.Sprintf("PRAGMA table_info(`%s`)", tableName)
	case "sqlserver":
		query = fmt.Sprintf(`
			SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
			FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_NAME = '%s'
			ORDER BY ORDINAL_POSITION
		`, tableName)
	case "dm":
		// 达梦 USER_TAB_COLUMNS 要求大写表名
		dmTableName := strings.ToUpper(tableName)
		query = fmt.Sprintf(`
			SELECT COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_DEFAULT
			FROM USER_TAB_COLUMNS
			WHERE TABLE_NAME = '%s'
			ORDER BY COLUMN_ID
		`, dmTableName)
	case "oracle":
		// Oracle DATA_DEFAULT 是 LONG 类型，go-ora 无法 Scan，只查 3 列
		// owner.table 时只用表名部分查 USER_TAB_COLUMNS（避免需要 ALL_TAB_COLUMNS 权限）
		if idx := strings.Index(tableName, "."); idx >= 0 {
			tblPart := oracleEscapeIdentifier(tableName[idx+1:])
			query = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", tblPart)
		} else {
			query = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", oracleEscapeIdentifier(tableName))
		}
	default:
		query = fmt.Sprintf("DESCRIBE `%s`", tableName)
	}

	rows, err := db.Query(query)
	// Oracle：查询失败时回退（不含 DATA_DEFAULT，避免 LONG 类型 Scan 问题）
	if err != nil && config.Type == "oracle" {
		tbl := tableName
		if idx := strings.Index(tbl, "."); idx >= 0 {
			tbl = tbl[idx+1:]
		}
		fallbackQuery := fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", oracleEscapeIdentifier(tbl))
		rows, err = db.Query(fallbackQuery)
	}
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询表结构失败: " + err.Error(),
		})
		return
	}
	defer rows.Close()

	columns := make([]map[string]interface{}, 0)
	for rows.Next() {
		var colName, colType string
		var nullable, extra interface{}

		// 根据不同数据库类型处理不同的返回格式
		switch config.Type {
		case "mysql", "mariadb", "tidb":
			// Field, Type, Null, Key, Default, Extra
			var key, defaultVal interface{}
			if err := rows.Scan(&colName, &colType, &nullable, &key, &defaultVal, &extra); err == nil {
				columns = append(columns, map[string]interface{}{
					"name":     colName,
					"type":     colType,
					"nullable": nullable != "NO",
				})
			}
		case "postgresql", "timescaledb", "cockroachdb", "sqlserver":
			var defaultVal interface{}
			if err := rows.Scan(&colName, &colType, &nullable, &defaultVal); err == nil {
				columns = append(columns, map[string]interface{}{
					"name":     colName,
					"type":     colType,
					"nullable": nullable != "NO",
				})
			}
		case "dm":
			// COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_DEFAULT
			var nullableStr string
			var defaultVal interface{}
			if err := rows.Scan(&colName, &colType, &nullableStr, &defaultVal); err == nil {
				columns = append(columns, map[string]interface{}{
					"name":     colName,
					"type":     colType,
					"nullable": nullableStr == "Y",
				})
			}
		case "oracle":
			// Oracle DATA_DEFAULT 是 LONG 类型无法 Scan，只扫 3 列
			var nullableStr string
			if err := rows.Scan(&colName, &colType, &nullableStr); err == nil {
				columns = append(columns, map[string]interface{}{
					"name":     colName,
					"type":     colType,
					"nullable": nullableStr == "Y",
				})
			}
		case "sqlite", "duckdb":
			// cid, name, type, notnull, dflt_value, pk
			var cid, notnull, pk int
			var dfltValue interface{}
			if err := rows.Scan(&cid, &colName, &colType, &notnull, &dfltValue, &pk); err == nil {
				columns = append(columns, map[string]interface{}{
					"name":     colName,
					"type":     colType,
					"nullable": notnull == 0,
				})
			}
		}
	}

	// Oracle：若初次查询返回 0 行，用 USER_TAB_COLUMNS 再试（不含 LONG 类型 DATA_DEFAULT）
	if config.Type == "oracle" && len(columns) == 0 {
		rows.Close()
		tbl := tableName
		if idx := strings.Index(tbl, "."); idx >= 0 {
			tbl = tbl[idx+1:]
		}
		fallbackQuery := fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", oracleEscapeIdentifier(tbl))
		rows2, err2 := db.Query(fallbackQuery)
		if err2 == nil {
			defer rows2.Close()
			for rows2.Next() {
				var colName, colType string
				var nullableStr string
				if err := rows2.Scan(&colName, &colType, &nullableStr); err == nil {
					columns = append(columns, map[string]interface{}{
						"name":     colName,
						"type":     colType,
						"nullable": nullableStr == "Y",
					})
				}
			}
		}
	}

	// 获取字段备注并添加到 columns 中
	colComments := getColumnComments(db, config, tableName)
	for i := range columns {
		if colName, ok := columns[i]["name"].(string); ok {
			if comment, exists := colComments[colName]; exists {
				columns[i]["comment"] = comment
			}
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"columns": columns,
	})
}

// TableStructureUpdateRequest 修改表结构请求

type TableStructureUpdateRequest struct {
	Columns []struct {
		Name     string `json:"name"`
		Type     string `json:"type"`
		Size     string `json:"size"`
		Nullable bool   `json:"nullable"`
	} `json:"columns"`
}

// handleTableStructureUpdate 修改表结构

// ============================================================
// BLOB 列处理辅助函数
// ============================================================

// isBlobTypeDB 判断数据库类型字符串是否为 BLOB/二进制类型
func isBlobTypeDB(dbType string) bool {
	dbType = strings.ToUpper(dbType)
	switch {
	case strings.Contains(dbType, "BLOB"),
		strings.Contains(dbType, "BINARY"),
		strings.Contains(dbType, "BYTEA"),
		strings.Contains(dbType, "RAW"),
		strings.Contains(dbType, "IMAGE"),
		strings.Contains(dbType, "VARBINARY"),
		strings.Contains(dbType, "TINYBLOB"),
		strings.Contains(dbType, "MEDIUMBLOB"),
		strings.Contains(dbType, "LONGBLOB"),
		dbType == "BYTE":
		return true
	}
	return false
}

// isTextTypeDB 判断数据库类型字符串是否为大文本类型
func isTextTypeDB(dbType string) bool {
	dbType = strings.ToUpper(dbType)
	switch {
	case strings.Contains(dbType, "TEXT"),
		strings.Contains(dbType, "CLOB"),
		strings.Contains(dbType, "MEMO"),
		strings.Contains(dbType, "LONGVARCHAR"),
		strings.Contains(dbType, "NTEXT"),
		strings.Contains(dbType, "NCLOB"):
		return true
	}
	return false
}

// getBlobLengthExpr 返回获取 BLOB 大小的 SQL 表达式
func getBlobLengthExpr(dbType, quotedCol string) string {
	switch strings.ToLower(dbType) {
	case "postgresql", "timescaledb", "cockroachdb":
		return fmt.Sprintf("COALESCE(octet_length(%s), 0)", quotedCol)
	case "mysql", "mariadb", "tidb":
		return fmt.Sprintf("COALESCE(LENGTH(%s), 0)", quotedCol)
	case "oracle":
		return fmt.Sprintf("NVL(DBMS_LOB.GETLENGTH(%s), 0)", quotedCol)
	case "dm":
		return fmt.Sprintf("NVL(DBMS_LOB.GETLENGTH(%s), 0)", quotedCol)
	case "sqlserver":
		return fmt.Sprintf("COALESCE(DATALENGTH(%s), 0)", quotedCol)
	case "sqlite":
		return fmt.Sprintf("COALESCE(LENGTH(%s), 0)", quotedCol)
	default:
		return fmt.Sprintf("COALESCE(LENGTH(%s), 0)", quotedCol)
	}
}

// getColumnInfoQuery 返回查询列名和类型的 SQL（用于预识别 BLOB 列）
func getColumnInfoQuery(config *DatabaseConfig, tableName string) string {
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb":
		return fmt.Sprintf(`
			SELECT column_name, data_type
			FROM information_schema.columns
			WHERE table_name = '%s'
			ORDER BY ordinal_position
		`, tableName)
	case "mysql", "mariadb", "tidb":
		return fmt.Sprintf(`
			SELECT COLUMN_NAME, DATA_TYPE
			FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_NAME = '%s' AND TABLE_SCHEMA = DATABASE()
		`, tableName)
	case "sqlserver":
		return fmt.Sprintf(`
			SELECT COLUMN_NAME, DATA_TYPE
			FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_NAME = '%s'
			ORDER BY ORDINAL_POSITION
		`, tableName)
	case "dm":
		dmTableName := strings.ToUpper(tableName)
		return fmt.Sprintf(`
			SELECT COLUMN_NAME, DATA_TYPE
			FROM USER_TAB_COLUMNS
			WHERE TABLE_NAME = '%s'
			ORDER BY COLUMN_ID
		`, dmTableName)
	case "oracle":
		tbl := tableName
		if idx := strings.Index(tableName, "."); idx >= 0 {
			tbl = tableName[idx+1:]
		}
		return fmt.Sprintf(`
			SELECT COLUMN_NAME, DATA_TYPE
			FROM USER_TAB_COLUMNS
			WHERE TABLE_NAME = '%s'
			ORDER BY COLUMN_ID
		`, strings.ToUpper(tbl))
	case "sqlite":
		return fmt.Sprintf("SELECT name, type FROM pragma_table_info('%s')", tableName)
	default:
		return ""
	}
}

// getAllColumnsQuery 返回查询所有列名的 SQL
func getAllColumnsQuery(config *DatabaseConfig, tableName string) string {
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb":
		return fmt.Sprintf(`
			SELECT column_name
			FROM information_schema.columns
			WHERE table_name = '%s'
			ORDER BY ordinal_position
		`, tableName)
	case "mysql", "mariadb", "tidb":
		return fmt.Sprintf(`
			SELECT COLUMN_NAME
			FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_NAME = '%s' AND TABLE_SCHEMA = DATABASE()
			ORDER BY ORDINAL_POSITION
		`, tableName)
	case "sqlserver":
		return fmt.Sprintf(`
			SELECT COLUMN_NAME
			FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_NAME = '%s'
			ORDER BY ORDINAL_POSITION
		`, tableName)
	case "dm":
		dmTableName := strings.ToUpper(tableName)
		return fmt.Sprintf(`
			SELECT COLUMN_NAME
			FROM USER_TAB_COLUMNS
			WHERE TABLE_NAME = '%s'
			ORDER BY COLUMN_ID
		`, dmTableName)
	case "oracle":
		tbl := tableName
		if idx := strings.Index(tableName, "."); idx >= 0 {
			tbl = tableName[idx+1:]
		}
		return fmt.Sprintf(`
			SELECT COLUMN_NAME
			FROM USER_TAB_COLUMNS
			WHERE TABLE_NAME = '%s'
			ORDER BY COLUMN_ID
		`, strings.ToUpper(tbl))
	case "sqlite":
		return fmt.Sprintf("SELECT name FROM pragma_table_info('%s') ORDER BY cid", tableName)
	default:
		return ""
	}
}

// handleDatabaseSQL SQL 工作台：执行任意 SQL
func handleDatabaseSQL(w http.ResponseWriter, r *http.Request, config *DatabaseConfig) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		apiMethodNotAllowed(w, "只支持 POST")
		return
	}

	var req struct {
		SQL    string        `json:"sql"`
		Params []interface{} `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apiInvalidInput(w, "请求格式错误")
		return
	}
	if req.SQL == "" {
		apiInvalidInput(w, "SQL 不能为空")
		return
	}

	// 危险操作拦截
	sqlUpper := strings.TrimSpace(strings.ToUpper(req.SQL))
	dangerousOps := []string{"DROP DATABASE", "DROP SCHEMA", "TRUNCATE", "ALTER DATABASE"}
	for _, op := range dangerousOps {
		if strings.HasPrefix(sqlUpper, op) {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false, "message": fmt.Sprintf("禁止执行危险操作: %s", op),
			})
			return
		}
	}

	startTime := time.Now()
	db, err := getDBFromPool(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false, "message": "连接失败: " + err.Error(),
		})
		return
	}

	if strings.HasPrefix(sqlUpper, "SELECT") || strings.HasPrefix(sqlUpper, "SHOW") ||
		strings.HasPrefix(sqlUpper, "DESCRIBE") || strings.HasPrefix(sqlUpper, "EXPLAIN") ||
		strings.HasPrefix(sqlUpper, "DESC") || strings.HasPrefix(sqlUpper, "WITH") {
		rows, err := db.Query(req.SQL, req.Params...)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false, "message": "查询失败: " + err.Error(),
			})
			return
		}
		defer rows.Close()

		columns, _ := rows.Columns()
		var results []map[string]interface{}
		blobColumns := make(map[int]bool)

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
				if val == nil {
					row[col] = nil
					continue
				}
				switch v := val.(type) {
				case []byte:
					// 检测 BLOB — 非文本字节
					if isBinaryData(v) {
						blobColumns[i] = true
						previewLen := 64
						if len(v) < previewLen {
							previewLen = len(v)
						}
						row[col] = map[string]interface{}{
							"_blob":    true,
							"_size":    len(v),
							"_type":    "BLOB",
							"_preview": hex.EncodeToString(v[:previewLen]),
						}
					} else {
						// 文本类 []byte，截断大内容防 JSON 卡死
						if len(v) > 2048 {
							row[col] = string(v[:2048]) + "..."
						} else {
							row[col] = string(v)
						}
					}
				case time.Time:
					row[col] = v.Format("2006-01-02 15:04:05")
				default:
					row[col] = v
				}
			}
			results = append(results, row)
		}

		elapsed := time.Since(startTime).Milliseconds()

		resp := map[string]interface{}{
			"success": true,
			"columns": columns,
			"data":    results,
			"count":   len(results),
			"elapsed": elapsed,
		}
		if len(blobColumns) > 0 {
			blobIdx := make([]int, 0, len(blobColumns))
			for i := range blobColumns {
				blobIdx = append(blobIdx, i)
			}
			resp["blob_columns"] = blobIdx
		}
		json.NewEncoder(w).Encode(resp)
	} else {
		result, err := db.Exec(req.SQL, req.Params...)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false, "message": "执行失败: " + err.Error(),
			})
			return
		}
		affected, _ := result.RowsAffected()
		lastID, _ := result.LastInsertId()
		elapsed := time.Since(startTime).Milliseconds()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":       true,
			"type":          "exec",
			"rows_affected": affected,
			"last_insert_id": lastID,
			"elapsed":       elapsed,
		})
	}
}

// isBinaryData 检测字节是否包含大量二进制/非文本数据
func isBinaryData(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	// 检查前 512 字节，如果有超过 30% 的非可打印字符 + null 字节，视为二进制
	checkLen := len(data)
	if checkLen > 512 {
		checkLen = 512
	}
	nonPrintable := 0
	for i := 0; i < checkLen; i++ {
		b := data[i]
		if b == 0 || (b < 32 && b != '\t' && b != '\n' && b != '\r') || b >= 0x80 {
			nonPrintable++
		}
	}
	return float64(nonPrintable)/float64(checkLen) > 0.3
}

// getCachedBlobColumns 获取表的 BLOB 列名（带缓存）
func getCachedBlobColumns(dbID, tableName string, db *sql.DB) map[string]bool {
	cacheKey := dbID + ":" + tableName

	columnCache.RLock()
	if entry, ok := columnCache.entries[cacheKey]; ok && time.Since(entry.UpdatedAt) < columnCacheTTL {
		columnCache.RUnlock()
		return entry.BlobColumns
	}
	columnCache.RUnlock()

	// 缓存未命中，查询数据库
	blobCols := make(map[string]bool)
	allCols := []string{}

	// 尝试通过 information_schema 获取列信息
	dbType := getDBTypeForCache(db)
	if dbType == "" {
		return blobCols
	}

	// 获取列类型
	colQuery := getColumnInfoQueryByType(dbType, tableName)
	if colQuery != "" {
		rows, err := db.Query(colQuery)
		if err == nil {
			for rows.Next() {
				var colName, colType string
				if scanErr := rows.Scan(&colName, &colType); scanErr == nil {
					allCols = append(allCols, colName)
					if isBlobTypeDB(colType) {
						blobCols[colName] = true
					}
				}
			}
			rows.Close()
		}
	}

	// 写入缓存
	columnCache.Lock()
	columnCache.entries[cacheKey] = &cachedColumns{
		BlobColumns: blobCols,
		AllColumns:  allCols,
		UpdatedAt:   time.Now(),
	}
	columnCache.Unlock()

	return blobCols
}

// getCachedAllColumns 获取表的所有列名（带缓存）
func getCachedAllColumns(dbID, tableName string, db *sql.DB) []string {
	cacheKey := dbID + ":" + tableName

	columnCache.RLock()
	if entry, ok := columnCache.entries[cacheKey]; ok && time.Since(entry.UpdatedAt) < columnCacheTTL {
		columnCache.RUnlock()
		return entry.AllColumns
	}
	columnCache.RUnlock()

	// 缓存未命中，触发完整加载
	getCachedBlobColumns(dbID, tableName, db)

	columnCache.RLock()
	if entry, ok := columnCache.entries[cacheKey]; ok {
		columnCache.RUnlock()
		return entry.AllColumns
	}
	columnCache.RUnlock()

	return nil
}

// getDBTypeForCache 获取数据库类型用于缓存查询
func getDBTypeForCache(db *sql.DB) string {
	// 通过连接池反向查找
	dbPool.RLock()
	defer dbPool.RUnlock()
	for id, conn := range dbPool.connections {
		if conn == db {
			dataOntologyMu.RLock()
			if cfg, ok := dataOntologyDatabases[id]; ok {
				dataOntologyMu.RUnlock()
				return cfg.Type
			}
			dataOntologyMu.RUnlock()
		}
	}
	return ""
}

// getColumnInfoQueryByType 根据数据库类型获取列信息查询
func getColumnInfoQueryByType(dbType, tableName string) string {
	switch dbType {
	case "postgresql", "timescaledb", "cockroachdb":
		return fmt.Sprintf("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='%s' AND table_schema='public'", tableName)
	case "mysql", "mariadb", "tidb":
		return fmt.Sprintf("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='%s' AND table_schema=DATABASE()", tableName)
	case "sqlserver":
		return fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='%s'", tableName)
	case "oracle", "dm":
		return fmt.Sprintf("SELECT column_name, data_type FROM user_tab_columns WHERE table_name=UPPER('%s')", tableName)
	case "sqlite":
		return fmt.Sprintf("PRAGMA table_info('%s')", tableName)
	case "duckdb":
		return fmt.Sprintf("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='%s'", tableName)
	case "clickhouse":
		return fmt.Sprintf("SELECT name, type FROM system.columns WHERE table='%s'", tableName)
	default:
		return fmt.Sprintf("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='%s' AND table_schema=DATABASE()", tableName)
	}
}

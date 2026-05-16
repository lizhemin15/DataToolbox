package main

import (
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

func handleTableRetrievalSync(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	_, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}

	// 解析请求
	var req struct {
		DatabaseID    string `json:"database_id,omitempty"`    // 可选：指定数据库ID，不指定则同步所有
		SyncTables    *bool  `json:"sync_tables,omitempty"`    // 是否同步表数据，默认 true
		SyncVectors   *bool  `json:"sync_vectors,omitempty"`   // 是否同步向量，默认 true
		SyncRelations *bool  `json:"sync_relations,omitempty"` // 是否同步关系，默认 true
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求格式错误",
		})
		return
	}

	// 默认值：如果未指定参数，则全部同步（向后兼容）
	syncTables := req.SyncTables == nil || *req.SyncTables
	syncVectors := req.SyncVectors == nil || *req.SyncVectors
	syncRelations := req.SyncRelations == nil || *req.SyncRelations

	manager := getFTS5Manager()
	if manager == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "表检索系统未初始化",
		})
		return
	}

	// 异步执行同步
	go func() {
		if req.DatabaseID != "" {
			// 同步指定数据库
			dataOntologyMu.RLock()
			dbConfig, exists := dataOntologyDatabases[req.DatabaseID]
			dataOntologyMu.RUnlock()

			if !exists {
				log.Printf("[表检索] 数据库不存在: %s", req.DatabaseID)
				return
			}

			// 同步表数据
			if syncTables {
				if err := manager.syncTablesToSQLite(dbConfig); err != nil {
					log.Printf("[表检索] 同步表数据失败: %v", err)
				}
			}
			// 同步向量到 SQLite（如果 embedding 配置启用）
			if syncVectors && dataOntologyAIConfig != nil && dataOntologyAIConfig.Embedding.Enabled && dataOntologyAIConfig.Embedding.URL != "" {
				if _, _, err := manager.syncVectorsToSQLite(dbConfig, dataOntologyAIConfig.Embedding); err != nil {
					log.Printf("[表检索] 同步向量数据失败: %v", err)
				}
			}
			// 同步关系到 SQLite
			if syncRelations {
				if err := manager.syncRelationsToSQLite(dbConfig); err != nil {
					log.Printf("[表检索] 同步关系数据失败: %v", err)
				}
			}
		} else {
			// 同步所有数据库
			// 同步表数据
			if syncTables {
				if err := manager.syncAllDatabases(); err != nil {
					log.Printf("[表检索] 同步表数据失败: %v", err)
				}
			}
			// 同步所有数据库的向量
			if syncVectors && dataOntologyAIConfig != nil && dataOntologyAIConfig.Embedding.Enabled && dataOntologyAIConfig.Embedding.URL != "" {
				dataOntologyMu.RLock()
				dbs := make(map[string]*DatabaseConfig)
				for k, v := range dataOntologyDatabases {
					dbs[k] = v
				}
				dataOntologyMu.RUnlock()
				for _, dbConfig := range dbs {
					if _, _, err := manager.syncVectorsToSQLite(dbConfig, dataOntologyAIConfig.Embedding); err != nil {
						log.Printf("[表检索] 同步向量数据失败 (%s): %v", dbConfig.Name, err)
					}
				}
			}
			// 同步所有数据库的关系
			if syncRelations {
				dataOntologyMu.RLock()
				dbs := make(map[string]*DatabaseConfig)
				for k, v := range dataOntologyDatabases {
					dbs[k] = v
				}
				dataOntologyMu.RUnlock()
				for _, dbConfig := range dbs {
					if err := manager.syncRelationsToSQLite(dbConfig); err != nil {
						log.Printf("[表检索] 同步关系数据失败 (%s): %v", dbConfig.Name, err)
					}
				}
			}
		}
	}()

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "同步任务已启动",
	})
}

// handleTableRetrievalStatus 获取表检索索引状态

func handleTableRetrievalStatus(w http.ResponseWriter, r *http.Request) {
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

	manager := getFTS5Manager()
	if manager == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "表检索系统未初始化",
		})
		return
	}

	// 查询索引状态
	totalCount, dbStats, err := manager.getStats()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询索引状态失败",
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"total_tables":   totalCount,
		"database_stats": dbStats,
	})
}

// handleTableRetrievalEmbeddingStatus 查询向量同步状态

func handleTableRetrievalEmbeddingStatus(w http.ResponseWriter, r *http.Request) {
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

	manager := getFTS5Manager()
	if manager == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "表检索系统未初始化",
		})
		return
	}

	// 查询向量状态
	totalVectors, dbVectorStats, err := manager.getVectorStats()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询向量状态失败: " + err.Error(),
		})
		return
	}

	// 获取 embedding 配置信息
	dataOntologyMu.RLock()
	aiConfig := dataOntologyAIConfig
	dataOntologyMu.RUnlock()

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"total_vectors":  totalVectors,
		"database_stats": dbVectorStats,
		"embedding_config": map[string]interface{}{
			"enabled":   aiConfig.Embedding.Enabled,
			"model":     aiConfig.Embedding.Model,
			"dimension": aiConfig.Embedding.Dimension,
		},
	})
}

// handleTableRetrievalRelationStatus 查询关系索引状态

func handleTableRetrievalRelationStatus(w http.ResponseWriter, r *http.Request) {
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

	manager := getFTS5Manager()
	if manager == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "表检索系统未初始化",
		})
		return
	}

	// 查询关系状态
	totalRelations, dbRelationStats, err := manager.getRelationStats()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询关系状态失败: " + err.Error(),
		})
		return
	}

	// 获取各数据库的关系数量
	dataOntologyMu.RLock()
	dbRelationCounts := make(map[string]int)
	for id, count := range dbRelationStats {
		if cfg, ok := dataOntologyDatabases[id]; ok {
			dbRelationCounts[cfg.Name] = count
		}
	}
	dataOntologyMu.RUnlock()

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"total_relations": totalRelations,
		"database_stats":  dbRelationCounts,
	})
}

// matchWildcardPattern 检查字符串是否匹配通配符模式
// * 匹配任意字符，? 匹配单个字符

func matchWildcardPattern(pattern, str string) bool {
	// 如果模式为空，匹配所有
	if pattern == "" {
		return true
	}

	// 将通配符模式转换为正则表达式
	regexPattern := "^"
	for _, ch := range pattern {
		switch ch {
		case '*':
			regexPattern += ".*"
		case '?':
			regexPattern += "."
		case '.', '+', '(', ')', '[', ']', '{', '}', '^', '$', '|', '\\':
			// 转义正则特殊字符
			regexPattern += "\\" + string(ch)
		default:
			regexPattern += string(ch)
		}
	}
	regexPattern += "$"

	matched, err := regexp.MatchString(regexPattern, str)
	if err != nil {
		log.Printf("[通配符匹配] 正则表达式错误: %v", err)
		return false
	}
	return matched
}

// deleteAllVectorsForDatabase 删除指定数据库的所有向量

func deleteAllVectorsForDatabase(manager *FTS5Manager, dbID string) error {
	if manager == nil || manager.db == nil {
		return nil
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()

	result, err := manager.db.Exec("DELETE FROM vectors WHERE database_id = ?", dbID)
	if err != nil {
		return fmt.Errorf("删除向量失败: %w", err)
	}

	rowsAffected, _ := result.RowsAffected()
	log.Printf("[向量同步] 删除数据库 %s 的所有向量，共 %d 条", dbID, rowsAffected)

	return nil
}

// handleTableRetrievalEmbeddingSync 向量索引建立接口

func handleTableRetrievalEmbeddingSync(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	_, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}

	// 解析请求体
	var req struct {
		DbID        string   `json:"db_id"`
		Tables      []string `json:"tables"`       // 已有：指定表列表
		SyncMode    string   `json:"sync_mode"`    // 新增：incremental 或 full
		TableFilter string   `json:"table_filter"` // 新增：表名过滤模式
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "解析请求失败: " + err.Error(),
		})
		return
	}

	if req.DbID == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "缺少 db_id 参数",
		})
		return
	}

	// 获取数据库配置
	dataOntologyMu.RLock()
	dbConfig, ok := dataOntologyDatabases[req.DbID]
	dataOntologyMu.RUnlock()

	if !ok {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在",
		})
		return
	}

	// 获取 embedding 配置
	dataOntologyMu.RLock()
	aiConfig := dataOntologyAIConfig
	dataOntologyMu.RUnlock()

	if !aiConfig.Embedding.Enabled || aiConfig.Embedding.URL == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "Embedding 未启用或未配置",
		})
		return
	}

	// 获取 FTS5 管理器
	manager := getFTS5Manager()
	if manager == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "表检索系统未初始化",
		})
		return
	}

	// 设置默认同步模式
	syncMode := req.SyncMode
	if syncMode == "" {
		syncMode = "incremental"
	}

	// 验证同步模式
	if syncMode != "incremental" && syncMode != "full" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的 sync_mode，必须是 incremental 或 full",
		})
		return
	}

	// 如果指定了表列表，优先使用 tables 参数（忽略 table_filter）
	if len(req.Tables) > 0 {
		// 获取表信息列表
		tableInfos, err := getTableInfoList(dbConfig)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "获取表信息失败: " + err.Error(),
			})
			return
		}

		// 构建表名集合
		tableSet := make(map[string]bool)
		for _, t := range req.Tables {
			tableSet[t] = true
		}

		// 过滤表信息
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
				"message": "同步向量失败: " + err.Error(),
			})
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"synced":  synced,
			"vectors": vectors,
			"mode":    "tables",
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

	// 应用表名过滤（如果提供了 table_filter）
	if req.TableFilter != "" {
		var filteredInfos []TableInfo
		for _, ti := range tableInfos {
			if matchWildcardPattern(req.TableFilter, ti.Name) {
				filteredInfos = append(filteredInfos, ti)
			}
		}
		tableInfos = filteredInfos
	}

	// 根据同步模式处理
	if syncMode == "full" {
		// 全量重建：先删除该数据库的所有现有向量
		if err := deleteAllVectorsForDatabase(manager, req.DbID); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "删除现有向量失败: " + err.Error(),
			})
			return
		}

		// 重新同步所有表（或过滤后的表）
		synced, vectors, err := syncSpecificVectors(manager, dbConfig, tableInfos, aiConfig.Embedding)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "同步向量失败: " + err.Error(),
			})
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"synced":  synced,
			"vectors": vectors,
			"mode":    "full",
		})
		return
	}

	// 增量同步模式（默认）
	// 如果有 table_filter，只同步过滤后的表
	if req.TableFilter != "" {
		synced, vectors, err := syncSpecificVectors(manager, dbConfig, tableInfos, aiConfig.Embedding)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "同步向量失败: " + err.Error(),
			})
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"synced":  synced,
			"vectors": vectors,
			"mode":    "incremental",
		})
		return
	}

	// 同步整个数据库的向量（增量模式）
	added, _, err := manager.syncVectorsToSQLite(dbConfig, aiConfig.Embedding)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "同步向量失败: " + err.Error(),
		})
		return
	}

	// 统计结果
	totalVectors, dbVectorStats, err := manager.getVectorStats()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "统计向量失败: " + err.Error(),
		})
		return
	}

	synced := added
	_ = dbVectorStats // 不再需要从统计中获取

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"synced":  synced,
		"vectors": totalVectors,
		"mode":    "incremental",
	})
}

// handleTableRetrievalRelationScan 关系索引扫描接口

func handleTableRetrievalRelationScan(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	_, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}

	// 解析请求体
	var req struct {
		DbID  string   `json:"db_id"`
		Rules []string `json:"rules"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "解析请求失败: " + err.Error(),
		})
		return
	}

	if req.DbID == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "缺少 db_id 参数",
		})
		return
	}

	// 获取数据库配置
	dataOntologyMu.RLock()
	dbConfig, ok := dataOntologyDatabases[req.DbID]
	dataOntologyMu.RUnlock()

	if !ok {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在",
		})
		return
	}

	// 如果未指定规则，使用所有规则
	rules := req.Rules
	if len(rules) == 0 {
		rules = []string{"exact", "naming_style", "type_keyword", "prefix_consistency"}
	}

	// 扫描关系候选
	candidates, err := scanRelationCandidates(dbConfig, rules)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "扫描关系失败: " + err.Error(),
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"candidates": candidates,
	})
}

// handleTableRetrievalRelationConfirm 关系确认接口

func handleTableRetrievalRelationConfirm(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	_, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}

	// 解析请求体
	var req struct {
		DbID      string `json:"db_id"`
		Relations []int  `json:"relations"` // candidate ids
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "解析请求失败: " + err.Error(),
		})
		return
	}

	if req.DbID == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "缺少 db_id 参数",
		})
		return
	}

	// 获取数据库配置
	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	dbConfig, ok := dataOntologyDatabases[req.DbID]
	if !ok {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在",
		})
		return
	}

	// 从临时存储中获取候选关系并确认
	confirmed := 0
	for _, candidateID := range req.Relations {
		if rel, ok := tempRelationCandidates[candidateID]; ok && rel.DatabaseID == req.DbID {
			// 添加到数据库配置的关系列表
			newRelation := OntologyRelation{
				ID:          uuid.New().String(),
				Name:        rel.TableName1 + "." + rel.FieldName1 + " ↔ " + rel.TableName2 + "." + rel.FieldName2,
				Description: rel.Reason,
				Source: FieldRef{
					DatabaseID: req.DbID,
					TableName:  rel.TableName1,
					FieldName:  rel.FieldName1,
					FieldType:  rel.FieldType1,
				},
				Target: FieldRef{
					DatabaseID: req.DbID,
					TableName:  rel.TableName2,
					FieldName:  rel.FieldName2,
					FieldType:  rel.FieldType2,
				},
				MatchType: rel.MatchType,
				Owner:     "admin",
				CreatedAt: time.Now(),
			}
			dbConfig.Relations = append(dbConfig.Relations, newRelation)
			confirmed++
		}
	}

	// 保存配置（已持有锁，使用 NoLock 版本）
	if err := saveDataOntologyStoreNoLock(); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "保存配置失败: " + err.Error(),
		})
		return
	}

	// 同步到 SQLite
	manager := getFTS5Manager()
	if manager != nil {
		go manager.syncRelationsToSQLite(dbConfig)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"confirmed": confirmed,
	})
}

// handleTableRetrievalEmbeddingPreview 向量预览接口

func handleTableRetrievalEmbeddingPreview(w http.ResponseWriter, r *http.Request) {
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

	dbID := r.URL.Query().Get("db_id")
	if dbID == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "缺少 db_id 参数",
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

	// 查询向量列表
	tables, err := manager.getVectorList(dbID)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询向量列表失败: " + err.Error(),
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"tables":  tables,
	})
}

// handleTableRetrievalRelationPreview 关系预览接口（支持CRUD）

func handleTableRetrievalRelationPreview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	_, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	// 校验 match_type 的有效值
	validMatchTypes := map[string]bool{
		"exact":            true,
		"case_insensitive": true,
		"naming_style":     true,
		"type_keyword":     true,
	}

	switch r.Method {
	case http.MethodGet:
		dbID := r.URL.Query().Get("db_id")
		if dbID == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "缺少 db_id 参数",
			})
			return
		}

		// 获取数据库配置
		dataOntologyMu.RLock()
		dbConfig, ok := dataOntologyDatabases[dbID]
		dataOntologyMu.RUnlock()

		if !ok {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "数据库不存在",
			})
			return
		}

		// 构建关系列表（添加 ID 以便 CRUD 操作）
		relations := make([]map[string]interface{}, 0)
		for idx, rel := range dbConfig.Relations {
			relations = append(relations, map[string]interface{}{
				"id":     idx, // 使用数组索引作为 ID
				"table1": rel.Source.TableName,
				"col1":   rel.Source.FieldName,
				"table2": rel.Target.TableName,
				"col2":   rel.Target.FieldName,
				"type":   rel.MatchType,
			})
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":   true,
			"relations": relations,
		})

	case http.MethodPost:
		// 创建关系
		var req struct {
			DatabaseID string `json:"database_id"`
			Table1     string `json:"table1"`
			Col1       string `json:"col1"`
			Table2     string `json:"table2"`
			Col2       string `json:"col2"`
			MatchType  string `json:"match_type"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		if req.DatabaseID == "" || req.Table1 == "" || req.Col1 == "" || req.Table2 == "" || req.Col2 == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "缺少必要参数",
			})
			return
		}

		// 校验 match_type
		if !validMatchTypes[req.MatchType] {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "无效的 match_type，支持的值: exact, case_insensitive, naming_style, type_keyword",
			})
			return
		}

		// 获取数据库配置
		dataOntologyMu.Lock()
		dbConfig, ok := dataOntologyDatabases[req.DatabaseID]
		dataOntologyMu.Unlock()

		if !ok {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "数据库不存在",
			})
			return
		}

		// 创建新关系
		newRel := OntologyRelation{
			ID:        uuid.New().String(),
			MatchType: req.MatchType,
			Source: FieldRef{
				DatabaseID: req.DatabaseID,
				TableName:  req.Table1,
				FieldName:  req.Col1,
			},
			Target: FieldRef{
				DatabaseID: req.DatabaseID,
				TableName:  req.Table2,
				FieldName:  req.Col2,
			},
			CreatedAt: time.Now(),
		}

		dataOntologyMu.Lock()
		dbConfig.Relations = append(dbConfig.Relations, newRel)
		// 保存配置
		if err := saveDataOntologyStoreNoLock(); err != nil {
			dataOntologyMu.Unlock()
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "保存配置失败: " + err.Error(),
			})
			return
		}
		dataOntologyMu.Unlock()

		// 同步到 SQLite
		manager := getFTS5Manager()
		if manager != nil {
			go manager.syncRelationsToSQLite(dbConfig)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"id":      len(dbConfig.Relations) - 1,
			"message": "关系创建成功",
		})

	case http.MethodPut:
		// 更新关系
		var req struct {
			DatabaseID string `json:"database_id"`
			ID         int    `json:"id"`
			Table1     string `json:"table1"`
			Col1       string `json:"col1"`
			Table2     string `json:"table2"`
			Col2       string `json:"col2"`
			MatchType  string `json:"match_type"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		if req.DatabaseID == "" || req.ID < 0 || req.Table1 == "" || req.Col1 == "" || req.Table2 == "" || req.Col2 == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "缺少必要参数",
			})
			return
		}

		// 校验 match_type
		if !validMatchTypes[req.MatchType] {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "无效的 match_type，支持的值: exact, case_insensitive, naming_style, type_keyword",
			})
			return
		}

		// 获取数据库配置
		dataOntologyMu.Lock()
		dbConfig, ok := dataOntologyDatabases[req.DatabaseID]
		dataOntologyMu.Unlock()

		if !ok {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "数据库不存在",
			})
			return
		}

		// 检查索引是否越界
		if req.ID >= len(dbConfig.Relations) {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "关系不存在",
			})
			return
		}

		// 更新关系
		dataOntologyMu.Lock()
		dbConfig.Relations[req.ID].MatchType = req.MatchType
		dbConfig.Relations[req.ID].Source = FieldRef{
			DatabaseID: req.DatabaseID,
			TableName:  req.Table1,
			FieldName:  req.Col1,
		}
		dbConfig.Relations[req.ID].Target = FieldRef{
			DatabaseID: req.DatabaseID,
			TableName:  req.Table2,
			FieldName:  req.Col2,
		}
		// 保存配置
		if err := saveDataOntologyStoreNoLock(); err != nil {
			dataOntologyMu.Unlock()
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "保存配置失败: " + err.Error(),
			})
			return
		}
		dataOntologyMu.Unlock()

		// 同步到 SQLite
		manager := getFTS5Manager()
		if manager != nil {
			go manager.syncRelationsToSQLite(dbConfig)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "关系更新成功",
		})

	case http.MethodDelete:
		// 删除关系（支持批量）
		var req struct {
			DatabaseID string `json:"database_id"`
			IDs        []int  `json:"ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		if req.DatabaseID == "" || len(req.IDs) == 0 {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "缺少必要参数",
			})
			return
		}

		// 获取数据库配置
		dataOntologyMu.Lock()
		dbConfig, ok := dataOntologyDatabases[req.DatabaseID]
		dataOntologyMu.Unlock()

		if !ok {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "数据库不存在",
			})
			return
		}

		// 检查所有 ID 是否有效
		var invalidIDs []int
		for _, id := range req.IDs {
			if id < 0 || id >= len(dbConfig.Relations) {
				invalidIDs = append(invalidIDs, id)
			}
		}
		if len(invalidIDs) > 0 {
			// 手动构建 ID 列表字符串
			var idStrs []string
			for _, id := range invalidIDs {
				idStrs = append(idStrs, fmt.Sprintf("%d", id))
			}
			msg := "Relation ID not found: " + strings.Join(idStrs, ", ")
			resp := map[string]interface{}{
				"success": false,
				"message": msg,
			}
			data, _ := json.Marshal(resp)
			w.Write(data)
			return
		}

		// 删除关系（从后往前删除，避免索引变化）
		dataOntologyMu.Lock()
		sort.Ints(req.IDs)
		for i := len(req.IDs) - 1; i >= 0; i-- {
			id := req.IDs[i]
			dbConfig.Relations = append(dbConfig.Relations[:id], dbConfig.Relations[id+1:]...)
		}
		// 保存配置
		if err := saveDataOntologyStoreNoLock(); err != nil {
			dataOntologyMu.Unlock()
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "保存配置失败: " + err.Error(),
			})
			return
		}
		dataOntologyMu.Unlock()

		// 同步到 SQLite
		manager := getFTS5Manager()
		if manager != nil {
			go manager.syncRelationsToSQLite(dbConfig)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":       true,
			"deleted_count": len(req.IDs),
			"message":       "关系删除成功",
		})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
	}
}

// handleTableRetrievalSearch 表检索搜索接口

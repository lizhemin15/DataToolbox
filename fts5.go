package main

import (
	"bytes"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func getFTS5Manager() *FTS5Manager {
	fts5ManagerOnce.Do(func() {
		// 数据库路径：服务工作目录下的 data-store.db
		dbPath := filepath.Join(".", "data", "data-store.db")

		// 确保目录存在
		dir := filepath.Dir(dbPath)
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Printf("[表检索] 创建数据库目录失败: %v", err)
			return
		}

		db, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)")
		if err != nil {
			log.Printf("[表检索] 打开 SQLite 失败: %v", err)
			return
		}

		// SQLite 单写模型：限制最大连接数为 1，避免并发写入导致损坏
		// WAL 模式允许同时有一个写者和多个读者，但 Go 的 sql.DB 连接池
		// 在多连接时可能交叉使用连接，导致事务状态混乱
		db.SetMaxOpenConns(1)
		db.SetMaxIdleConns(1)

		manager := &FTS5Manager{
			dbPath: dbPath,
			db:     db,
		}

		// 初始化表结构
		if err := manager.initSchema(); err != nil {
			log.Printf("[表检索] 初始化表结构失败: %v", err)
			return
		}

		fts5Manager = manager
		log.Printf("[表检索] FTS5 管理器初始化成功: %s", dbPath)
	})
	return fts5Manager
}

// initSchema 初始化数据库表结构

func (m *FTS5Manager) initSchema() error {
	// 主表：存储表元信息
	_, err := m.db.Exec(`
		CREATE TABLE IF NOT EXISTS tables (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			database_id TEXT NOT NULL,
			table_name TEXT NOT NULL,
			table_comment TEXT,
			column_names TEXT,
			column_comments TEXT,
			row_count INTEGER DEFAULT 0,
			updated_at INTEGER NOT NULL,
			UNIQUE(database_id, table_name)
		);
		CREATE INDEX IF NOT EXISTS idx_tables_database ON tables(database_id);
	`)
	if err != nil {
		return err
	}

	// FTS5 虚拟表：全文索引
	// 检查当前 FTS5 表结构是否包含 column_comments，如果不包含则重建
	// 也检查 tokenizer 是否为 trigram（支持中文），如果还是 unicode61 则重建
	var ftsNeedsRebuild bool
	var ftsColCount int
	err = m.db.QueryRow(`SELECT count(*) FROM pragma_table_info('tables_fts') WHERE name = 'column_comments'`).Scan(&ftsColCount)
	if err != nil {
		// 表可能不存在，标记需要重建
		ftsNeedsRebuild = true
	} else if ftsColCount == 0 {
		// FTS5 表存在但缺少 column_comments 列，需要重建
		ftsNeedsRebuild = true
	}

	// 检查 tokenizer 是否为 trigram（支持中文搜索）
	if !ftsNeedsRebuild {
		var ftsSQL string
		err2 := m.db.QueryRow("SELECT sql FROM sqlite_master WHERE name = 'tables_fts'").Scan(&ftsSQL)
		if err2 == nil && strings.Contains(ftsSQL, "unicode61") {
			log.Printf("[FTS5] 检测到 tokenizer 为 unicode61（不支持中文），需要重建为 trigram")
			ftsNeedsRebuild = true
		}
	}

	if ftsNeedsRebuild {
		// SQLite FTS5 不支持 ALTER TABLE 添加列，必须 DROP 后重建
		log.Printf("[FTS5] 检测到 FTS5 索引需要重建（缺少列或 tokenizer 过时）...")
		_, _ = m.db.Exec(`DROP TABLE IF EXISTS tables_fts`)
		_, _ = m.db.Exec(`DROP TRIGGER IF EXISTS tables_ai`)
		_, _ = m.db.Exec(`DROP TRIGGER IF EXISTS tables_ad`)
		_, _ = m.db.Exec(`DROP TRIGGER IF EXISTS tables_au`)
	}

	// 创建 FTS5 虚拟表（不使用 content= 同步模式，避免触发器与 INSERT OR REPLACE 冲突导致索引损坏）
	// 改为独立内容模式：FTS5 自己存储数据，由 syncTablesToSQLite 手动重建索引
	_, err = m.db.Exec(`
		CREATE VIRTUAL TABLE IF NOT EXISTS tables_fts USING fts5(
			table_name,
			table_comment,
			column_names,
			column_comments,
			tokenize='trigram'
		);
	`)
	if err != nil {
		return err
	}

	// 如果重建了 FTS5 表，需要从 tables 表重新填充数据
	if ftsNeedsRebuild {
		log.Printf("[FTS5] 正在从 tables 表重新填充 FTS5 索引...")
		_, err = m.db.Exec(`
			INSERT INTO tables_fts(rowid, table_name, table_comment, column_names, column_comments)
			SELECT id, table_name, table_comment, column_names, column_comments FROM tables;
		`)
		if err != nil {
			log.Printf("[FTS5] 重新填充 FTS5 索引失败: %v", err)
			// 不返回错误，继续执行，后续同步会逐步修复
		} else {
			log.Printf("[FTS5] FTS5 索引重建并填充完成")
		}
	}

	// 向量表：存储 embedding 向量
	_, err = m.db.Exec(`
		CREATE TABLE IF NOT EXISTS vectors (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			database_id TEXT NOT NULL,
			table_name TEXT NOT NULL,
			embedding BLOB NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(database_id, table_name)
		);
		CREATE INDEX IF NOT EXISTS idx_vectors_database ON vectors(database_id);
	`)
	if err != nil {
		return err
	}

	// 关系表：存储表间关系（用于 Graph 检索）
	_, err = m.db.Exec(`
		CREATE TABLE IF NOT EXISTS relations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			database_id TEXT NOT NULL,
			source_table TEXT NOT NULL,
			source_field TEXT NOT NULL,
			target_table TEXT NOT NULL,
			target_field TEXT NOT NULL,
			match_type TEXT NOT NULL,
			relation_name TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_relations_database ON relations(database_id);
		CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(database_id, source_table);
		CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(database_id, target_table);
	`)
	if err != nil {
		return err
	}

	// 移除旧的 FTS5 content 同步触发器（不再需要，改为手动重建索引）
	// 旧版使用 content='tables' + 触发器同步，INSERT OR REPLACE 与触发器冲突导致 FTS5 索引损坏
	_, _ = m.db.Exec(`DROP TRIGGER IF EXISTS tables_ai`)
	_, _ = m.db.Exec(`DROP TRIGGER IF EXISTS tables_ad`)
	_, _ = m.db.Exec(`DROP TRIGGER IF EXISTS tables_au`)

	// 检查是否需要从 content= 模式迁移到独立内容模式
	var ftsSQL string
	err2 := m.db.QueryRow("SELECT sql FROM sqlite_master WHERE name = 'tables_fts'").Scan(&ftsSQL)
	if err2 == nil && strings.Contains(ftsSQL, "content='tables'") {
		// 旧版 content= 模式，需要重建为独立内容模式
		log.Printf("[FTS5] 检测到旧版 content= 同步模式，正在迁移为独立内容模式...")
		_, _ = m.db.Exec(`DROP TABLE IF EXISTS tables_fts`)
		_, err = m.db.Exec(`
			CREATE VIRTUAL TABLE tables_fts USING fts5(
				table_name,
				table_comment,
				column_names,
				column_comments,
				tokenize='trigram'
			);
		`)
		if err != nil {
			log.Printf("[FTS5] 迁移 FTS5 表失败: %v", err)
		} else {
			_, err = m.db.Exec(`
				INSERT INTO tables_fts(rowid, table_name, table_comment, column_names, column_comments)
				SELECT id, table_name, table_comment, column_names, column_comments FROM tables;
			`)
			if err != nil {
				log.Printf("[FTS5] 迁移后填充数据失败: %v", err)
			} else {
				log.Printf("[FTS5] 迁移完成，已从 content= 模式切换为独立内容模式")
			}
		}
	}

	return nil
}

// fts5RetrieveTables 使用 FTS5 进行关键词检索

func (m *FTS5Manager) fts5RetrieveTables(query string, databaseID string, limit int) ([]TableRelevanceResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.db == nil {
		return nil, sql.ErrConnDone
	}

	// 清理查询：去掉 @ 引用标记、模块名等非搜索内容
	cleanedQuery := query
	// 去掉 @xxx 引用（如 @接口制作）
	if atIdx := strings.Index(cleanedQuery, "@"); atIdx >= 0 {
		// 找到 @ 后面的词（到空格为止）
		rest := cleanedQuery[atIdx+1:]
		if spaceIdx := strings.Index(rest, " "); spaceIdx >= 0 {
			cleanedQuery = cleanedQuery[:atIdx] + rest[spaceIdx+1:]
		} else {
			cleanedQuery = cleanedQuery[:atIdx]
		}
	}
	cleanedQuery = strings.TrimSpace(cleanedQuery)

	// trigram tokenizer 要求查询至少3个字符，短查询直接降级到 LIKE
	if len(cleanedQuery) < 3 {
		return m.likeRetrieveTables(cleanedQuery, databaseID, limit)
	}

	// 构建搜索条件：表名、注释、字段名任一匹配，使用 BM25 排序
	// 独立内容模式下 FTS5 自存数据，仍通过 rowid JOIN tables 获取 database_id 过滤
	sqlStr := `
		SELECT 
			t.table_name,
			t.table_comment,
			bm25(tables_fts) as score
		FROM tables_fts f
		JOIN tables t ON f.rowid = t.id
		WHERE tables_fts MATCH ? AND t.database_id = ?
		ORDER BY score ASC
		LIMIT ?
	`

	rows, err := m.db.Query(sqlStr, cleanedQuery, databaseID, limit)
	if err != nil {
		// FTS5 MATCH 失败（如中文分词问题），降级为 LIKE 模糊匹配
		log.Printf("[表检索] FTS5 MATCH 失败，降级为 LIKE 匹配: %v", err)
		return m.likeRetrieveTables(cleanedQuery, databaseID, limit)
	}
	defer rows.Close()

	var results []TableRelevanceResult
	for rows.Next() {
		var tableName, tableComment string
		var score float64
		if err := rows.Scan(&tableName, &tableComment, &score); err != nil {
			continue
		}

		// 将 BM25 分数转换为 0-1 的相关度分数
		relevance := 1.0 / (1.0 + (-score)/10.0)
		if relevance > 1.0 {
			relevance = 1.0
		}

		results = append(results, TableRelevanceResult{
			TableName:      tableName,
			RelevanceScore: relevance,
			MatchReason:    "关键词匹配",
		})
	}

	// 如果 FTS5 没有结果，降级为 LIKE 匹配
	if len(results) == 0 {
		log.Printf("[表检索] FTS5 无结果，降级为 LIKE 匹配")
		return m.likeRetrieveTables(query, databaseID, limit)
	}

	return results, nil
}

// likeRetrieveTables LIKE 模糊匹配检索（FTS5 降级方案）

func (m *FTS5Manager) likeRetrieveTables(query string, databaseID string, limit int) ([]TableRelevanceResult, error) {
	// 使用 LIKE 模糊匹配表名、注释、字段名
	// 将查询拆分为关键词，每个关键词单独匹配，取并集
	keywords := extractSearchKeywords(query)
	if len(keywords) == 0 {
		return nil, nil
	}

	// 构建动态 SQL：每个关键词匹配一次，取并集
	// 使用子查询去重
	placeholderParts := make([]string, len(keywords))
	args := []interface{}{}
	for i, kw := range keywords {
		placeholderParts[i] = "SELECT table_name, table_comment FROM tables WHERE database_id = ? AND (table_name LIKE ? OR table_comment LIKE ? OR column_names LIKE ? OR column_comments LIKE ?)"
		likePattern := "%" + kw + "%"
		args = append(args, databaseID, likePattern, likePattern, likePattern, likePattern)
	}

	sqlStr := "SELECT DISTINCT table_name, table_comment FROM (" + strings.Join(placeholderParts, " UNION ") + ") LIMIT ?"
	args = append(args, limit)

	rows, err := m.db.Query(sqlStr, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []TableRelevanceResult
	for rows.Next() {
		var tableName, tableComment string
		if err := rows.Scan(&tableName, &tableComment); err != nil {
			continue
		}

		// LIKE 匹配给固定相关度分数
		results = append(results, TableRelevanceResult{
			TableName:      tableName,
			RelevanceScore: 0.5,
			MatchReason:    "模糊匹配",
		})
	}

	return results, nil
}

// extractSearchKeywords 从查询中提取搜索关键词

func extractSearchKeywords(query string) []string {
	// 去掉常见动词/助词
	stopWords := map[string]bool{
		"查询": true, "获取": true, "查找": true, "搜索": true, "列出": true,
		"统计": true, "计算": true, "分析": true, "展示": true, "显示": true,
		"的": true, "了": true, "和": true, "与": true, "或": true,
		"所有": true, "全部": true, "各个": true, "每个": true,
		"请": true, "帮": true, "我": true, "要": true, "想": true,
	}

	// 简单分词：尝试2-4字滑动窗口
	var keywords []string
	seen := make(map[string]bool)

	// 先尝试整体
	if len(query) >= 2 && len(query) <= 8 && !stopWords[query] {
		if !seen[query] {
			keywords = append(keywords, query)
			seen[query] = true
		}
	}

	// 2字窗口
	for i := 0; i <= len(query)-2; i++ {
		w := query[i : i+2]
		if !stopWords[w] && !seen[w] {
			keywords = append(keywords, w)
			seen[w] = true
		}
	}

	// 3字窗口
	for i := 0; i <= len(query)-3; i++ {
		w := query[i : i+3]
		if !stopWords[w] && !seen[w] {
			keywords = append(keywords, w)
			seen[w] = true
		}
	}

	// 4字窗口
	for i := 0; i <= len(query)-4; i++ {
		w := query[i : i+4]
		if !stopWords[w] && !seen[w] {
			keywords = append(keywords, w)
			seen[w] = true
		}
	}

	return keywords
}

// syncTablesToSQLite 同步单个数据库的表信息到 SQLite

func (m *FTS5Manager) syncTablesToSQLite(dbConfig *DatabaseConfig) error {
	if m == nil || m.db == nil {
		return nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// 获取表列表
	tableInfos, err := getTableInfoList(dbConfig)
	if err != nil {
		return err
	}

	// 1. 获取已有的表记录
	existingTables := make(map[string]int64)
	rows, err := m.db.Query("SELECT table_name, updated_at FROM tables WHERE database_id = ?", dbConfig.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var tableName string
		var updatedAt int64
		if err := rows.Scan(&tableName, &updatedAt); err != nil {
			continue
		}
		existingTables[tableName] = updatedAt
	}
	rows.Close()

	// 2. 构建当前表名集合
	currentTables := make(map[string]bool)
	for _, ti := range tableInfos {
		currentTables[ti.Name] = true
	}

	// 3. 找出需要删除的表
	var toDelete []string
	for tableName := range existingTables {
		if !currentTables[tableName] {
			toDelete = append(toDelete, tableName)
		}
	}

	// 4. 找出需要新增/更新的表（包括注释变更的已有表）
	type tableToSync struct {
		name           string
		comment        string
		columnNames    []string
		columnComments map[string]string
	}
	var toSync []tableToSync
	for _, ti := range tableInfos {
		comment := ti.Comment
		if comment == "" {
			comment = ti.Name
		}
		columnComments := make(map[string]string)
		for _, col := range ti.Columns {
			if col.Comment != "" {
				columnComments[col.Name] = col.Comment
			}
		}
		if _, exists := existingTables[ti.Name]; !exists {
			// 新表，需要同步
			toSync = append(toSync, tableToSync{name: ti.Name, comment: comment, columnNames: ti.ColumnNames, columnComments: columnComments})
		} else {
			// 已有表，检查注释是否变更，如果变更也需要更新
			toSync = append(toSync, tableToSync{name: ti.Name, comment: comment, columnNames: ti.ColumnNames, columnComments: columnComments})
		}
	}

	if len(toDelete) == 0 && len(toSync) == 0 {
		log.Printf("[表检索] 数据库 %s 表数据已是最新，无需同步", dbConfig.Name)
		return nil
	}

	log.Printf("[表检索] 数据库 %s 增量同步表: 删除 %d 个, 新增/更新 %d 个", dbConfig.Name, len(toDelete), len(toSync))

	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().Unix()

	// 删除已不存在的表
	if len(toDelete) > 0 {
		stmt, err := tx.Prepare("DELETE FROM tables WHERE database_id = ? AND table_name = ?")
		if err != nil {
			return err
		}
		for _, tableName := range toDelete {
			if _, err := stmt.Exec(dbConfig.ID, tableName); err != nil {
				log.Printf("[表检索] 删除表 %s 失败: %v", tableName, err)
			}
		}
		stmt.Close()
	}

	// 新增/更新表
	// 使用 INSERT ... ON CONFLICT DO UPDATE 替代 INSERT OR REPLACE
	// INSERT OR REPLACE 会先 DELETE 再 INSERT，导致 rowid 变化，破坏 FTS5 rowid 映射
	if len(toSync) > 0 {
		stmt, err := tx.Prepare(`
			INSERT INTO tables (database_id, table_name, table_comment, column_names, column_comments, row_count, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(database_id, table_name) DO UPDATE SET
				table_comment = excluded.table_comment,
				column_names = excluded.column_names,
				column_comments = excluded.column_comments,
				row_count = excluded.row_count,
				updated_at = excluded.updated_at
		`)
		if err != nil {
			return err
		}
		defer stmt.Close()

		for _, ts := range toSync {
			columnNamesJSON, _ := json.Marshal(ts.columnNames)
			columnCommentsJSON, _ := json.Marshal(ts.columnComments)
			if _, err := stmt.Exec(
				dbConfig.ID,
				ts.name,
				ts.comment,
				string(columnNamesJSON),
				string(columnCommentsJSON),
				0,
				now,
			); err != nil {
				log.Printf("[表检索] 插入表 %s 失败: %v", ts.name, err)
			}
		}
	}

	// 提交 tables 表事务
	if err := tx.Commit(); err != nil {
		return err
	}

	// 事务提交后，重建该数据库的 FTS5 索引
	// 独立内容模式下不使用触发器同步，改为删除旧索引后重新填充
	if len(toDelete) > 0 || len(toSync) > 0 {
		if err := m.rebuildFTS5ForDatabase(dbConfig.ID); err != nil {
			log.Printf("[表检索] 重建数据库 %s 的 FTS5 索引失败: %v", dbConfig.Name, err)
			// 不返回错误，FTS5 索引缺失不影响主流程，下次同步会重试
		}
	}

	return nil
}

// rebuildFTS5ForDatabase 重建指定数据库的 FTS5 索引

func (m *FTS5Manager) rebuildFTS5ForDatabase(databaseID string) error {
	// 先删除该数据库对应的旧 FTS5 条目
	_, err := m.db.Exec(`
		DELETE FROM tables_fts WHERE rowid IN (
			SELECT id FROM tables WHERE database_id = ?
		)
	`, databaseID)
	if err != nil {
		return fmt.Errorf("删除旧 FTS5 索引失败: %w", err)
	}

	// 重新从 tables 表填充 FTS5 索引
	_, err = m.db.Exec(`
		INSERT INTO tables_fts(rowid, table_name, table_comment, column_names, column_comments)
		SELECT id, table_name, table_comment, column_names, column_comments FROM tables WHERE database_id = ?
	`, databaseID)
	if err != nil {
		return fmt.Errorf("填充 FTS5 索引失败: %w", err)
	}

	return nil
}

// syncAllDatabases 同步所有数据库的表信息

func (m *FTS5Manager) syncAllDatabases() error {
	if m == nil {
		return nil
	}

	dataOntologyMu.RLock()
	configs := make([]*DatabaseConfig, 0, len(dataOntologyDatabases))
	for _, db := range dataOntologyDatabases {
		configs = append(configs, db)
	}
	embeddingConfig := EmbeddingRetrievalConfig{}
	if dataOntologyAIConfig != nil {
		embeddingConfig = dataOntologyAIConfig.Embedding
	}
	dataOntologyMu.RUnlock()

	for _, dbConfig := range configs {
		if err := m.syncTablesToSQLite(dbConfig); err != nil {
			log.Printf("[表检索] 同步数据库 %s 失败: %v", dbConfig.Name, err)
		}
		// 如果 embedding 启用，同步向量
		if embeddingConfig.Enabled && embeddingConfig.URL != "" {
			if _, _, err := m.syncVectorsToSQLite(dbConfig, embeddingConfig); err != nil {
				log.Printf("[表检索] 同步数据库 %s 向量失败: %v", dbConfig.Name, err)
			}
		}
	}

	return nil
}

// getStats 获取索引统计信息

func (m *FTS5Manager) getStats() (int, map[string]int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.db == nil {
		return 0, nil, sql.ErrConnDone
	}

	var totalCount int
	if err := m.db.QueryRow("SELECT COUNT(*) FROM tables").Scan(&totalCount); err != nil {
		return 0, nil, err
	}

	rows, err := m.db.Query("SELECT database_id, COUNT(*) as count FROM tables GROUP BY database_id")
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()

	dbStats := make(map[string]int)
	for rows.Next() {
		var dbID string
		var count int
		if err := rows.Scan(&dbID, &count); err == nil {
			dbStats[dbID] = count
		}
	}

	return totalCount, dbStats, nil
}

// ============================================================
// 向量检索（余弦相似度）- Phase 2
// ============================================================

// generateEmbedding 调用 embedding API 生成向量

func generateEmbedding(text string, config EmbeddingRetrievalConfig) ([]float32, error) {
	if !config.Enabled || config.URL == "" {
		return nil, fmt.Errorf("embedding 未启用或未配置")
	}

	// 构建请求 payload（兼容 OpenAI/SiliconFlow 格式）
	payload := map[string]interface{}{
		"model": config.Model,
		"input": text,
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("序列化请求失败: %w", err)
	}

	req, err := http.NewRequest("POST", getEmbeddingEndpoint(config.URL), bytes.NewReader(payloadBytes))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+config.APIKey)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求 embedding API 失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("embedding API 返回错误 %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Data []struct {
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("解析 embedding 响应失败: %w", err)
	}

	if result.Error.Message != "" {
		return nil, fmt.Errorf("embedding API 错误: %s", result.Error.Message)
	}

	if len(result.Data) == 0 || len(result.Data[0].Embedding) == 0 {
		return nil, fmt.Errorf("embedding API 返回空向量")
	}

	// 转换 float64 -> float32
	embedding := make([]float32, len(result.Data[0].Embedding))
	for i, v := range result.Data[0].Embedding {
		embedding[i] = float32(v)
	}

	return embedding, nil
}

// float32SliceToBytes 将 float32 切片序列化为字节

func float32SliceToBytes(vec []float32) []byte {
	buf := new(bytes.Buffer)
	for _, v := range vec {
		binary.Write(buf, binary.LittleEndian, v)
	}
	return buf.Bytes()
}

// bytesToFloat32Slice 将字节反序列化为 float32 切片

func bytesToFloat32Slice(data []byte) ([]float32, error) {
	if len(data)%4 != 0 {
		return nil, fmt.Errorf("无效的向量数据长度: %d", len(data))
	}
	vec := make([]float32, len(data)/4)
	buf := bytes.NewReader(data)
	for i := range vec {
		if err := binary.Read(buf, binary.LittleEndian, &vec[i]); err != nil {
			return nil, err
		}
	}
	return vec, nil
}

// cosineSimilarity 计算余弦相似度

func cosineSimilarity(a, b []float32) float64 {
	if len(a) != len(b) {
		return 0
	}
	var dotProduct, normA, normB float64
	for i := range a {
		af := float64(a[i])
		bf := float64(b[i])
		dotProduct += af * bf
		normA += af * af
		normB += bf * bf
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return dotProduct / (math.Sqrt(normA) * math.Sqrt(normB))
}

// 临时存储关系候选

var (
	tempRelationCandidates     = make(map[int]*RelationCandidateEntry)
	tempRelationCandidateIDGen = 0
)

// RelationCandidateEntry 关系候选条目（用于临时存储）

type RelationCandidateEntry struct {
	ID         int     `json:"id"`
	DatabaseID string  `json:"database_id"`
	TableName1 string  `json:"table1"`
	FieldName1 string  `json:"col1"`
	FieldType1 string  `json:"field_type1"`
	TableName2 string  `json:"table2"`
	FieldName2 string  `json:"col2"`
	FieldType2 string  `json:"field_type2"`
	Confidence float64 `json:"confidence"`
	Reason     string  `json:"reason"`
	MatchType  string  `json:"match_type"`
}

// syncSpecificVectors 同步指定表的向量

func syncSpecificVectors(manager *FTS5Manager, dbConfig *DatabaseConfig, tableInfos []TableInfo, embeddingConfig EmbeddingRetrievalConfig) (int, int, error) {
	if manager == nil || manager.db == nil {
		return 0, 0, nil
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()

	synced := 0
	totalVectors := 0

	for _, ti := range tableInfos {
		// 构建增强文本：表名 + 表描述 + 字段详情（类型、注释、主键、外键）
		text := ti.Name
		if ti.Comment != "" {
			text += " " + ti.Comment
		}

		// 如果有增强的字段信息，使用详细信息生成向量
		if len(ti.Columns) > 0 {
			for _, col := range ti.Columns {
				text += " " + col.Name
				if col.Type != "" {
					text += " " + col.Type
				}
				if col.Comment != "" {
					text += " " + col.Comment
				}
				if col.IsPK {
					text += " PK 主键"
				}
				if col.IsFK && col.FKTable != "" {
					text += " FK " + col.FKTable
				}
			}
		} else if len(ti.ColumnNames) > 0 {
			// 兼容旧数据：只有字段名列表
			text += " " + strings.Join(ti.ColumnNames, " ")
		}

		// 生成向量
		embedding, err := generateEmbedding(text, embeddingConfig)
		if err != nil {
			log.Printf("[向量同步] 表 %s 生成向量失败: %v", ti.Name, err)
			continue
		}

		// 序列化向量
		embeddingBytes := float32SliceToBytes(embedding)

		// 插入或更新向量
		_, err = manager.db.Exec(`
			INSERT INTO vectors (database_id, table_name, embedding, updated_at)
			VALUES (?, ?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(database_id, table_name) DO UPDATE SET
				embedding = excluded.embedding,
				updated_at = CURRENT_TIMESTAMP
		`, dbConfig.ID, ti.Name, embeddingBytes)
		if err != nil {
			log.Printf("[向量同步] 表 %s 存储向量失败: %v", ti.Name, err)
			continue
		}

		synced++
		totalVectors += len(embedding)
	}

	return synced, totalVectors, nil
}

// scanRelationCandidates 扫描关系候选

func scanRelationCandidates(dbConfig *DatabaseConfig, rules []string) ([]RelationCandidateEntry, error) {
	// 获取数据库连接
	db, err := getDBFromPool(dbConfig)
	if err != nil {
		return nil, fmt.Errorf("获取数据库连接失败: %w", err)
	}
	defer db.Close()

	// 从 FTS5Manager 获取已存在的关系列表
	existingRelationsMap := make(map[string]bool)
	manager := getFTS5Manager()
	if manager != nil {
		relations, _, err := manager.listRelations(listRelationsParams{
			DatabaseID: dbConfig.ID,
			Page:       1,
			PageSize:   10000,
		})
		if err == nil {
			for _, rel := range relations {
				// 正向关系 key
				key1 := fmt.Sprintf("%s:%s:%s:%s", rel.SourceTable, rel.SourceField, rel.TargetTable, rel.TargetField)
				// 反向关系 key
				key2 := fmt.Sprintf("%s:%s:%s:%s", rel.TargetTable, rel.TargetField, rel.SourceTable, rel.SourceField)
				existingRelationsMap[key1] = true
				existingRelationsMap[key2] = true
			}
		}
	}

	// 获取所有表和字段信息
	tableColumnsMap := make(map[string][]map[string]interface{})
	tableNames, err := getTablesList(dbConfig)
	if err != nil {
		return nil, fmt.Errorf("获取表列表失败: %w", err)
	}

	for _, tableName := range tableNames {
		columns, err := getTableColumns(dbConfig, tableName)
		if err != nil {
			continue
		}
		tableColumnsMap[tableName] = columns
	}

	// 扫描关系候选
	candidates := make([]RelationCandidateEntry, 0)
	candidateID := 1

	// 遍历所有表的字段
	for table1, cols1 := range tableColumnsMap {
		for _, col1 := range cols1 {
			col1Name, _ := col1["name"].(string)
			col1Type, _ := col1["type"].(string)

			// 只考虑 INT/BIGINT/VARCHAR 类型的字段
			if !isFieldTypeMatchable(col1Type) {
				continue
			}

			// 查找可能的关联字段
			for table2, cols2 := range tableColumnsMap {
				if table2 == table1 {
					continue // 不考虑同一表内的关联
				}

				for _, col2 := range cols2 {
					col2Name, _ := col2["name"].(string)
					col2Type, _ := col2["type"].(string)

					if !isFieldTypeMatchable(col2Type) {
						continue
					}

					// 检测关联
					confidence, reason, matchType := detectRelation(table1, col1Name, col1Type, table2, col2Name, col2Type, rules)
					if confidence > 0.5 {
						// 检查关系是否已存在（考虑双向性）
						relationKey := fmt.Sprintf("%s:%s:%s:%s", table1, col1Name, table2, col2Name)
						relationExists := existingRelationsMap[relationKey]

						// 只添加不存在的关系候选
						if !relationExists {
							candidate := RelationCandidateEntry{
								ID:         candidateID,
								DatabaseID: dbConfig.ID,
								TableName1: table1,
								FieldName1: col1Name,
								FieldType1: col1Type,
								TableName2: table2,
								FieldName2: col2Name,
								FieldType2: col2Type,
								Confidence: confidence,
								Reason:     reason,
								MatchType:  matchType,
							}
							candidates = append(candidates, candidate)

							// 临时存储候选关系
							tempRelationCandidates[candidateID] = &candidate
							candidateID++
						}
					}
				}
			}
		}
	}

	return candidates, nil
}

// isFieldTypeMatchable 检查字段类型是否可关联

func isFieldTypeMatchable(fieldType string) bool {
	ft := strings.ToUpper(fieldType)
	return strings.Contains(ft, "INT") || strings.Contains(ft, "BIGINT") || strings.Contains(ft, "VARCHAR") || strings.Contains(ft, "CHAR")
}

// detectRelation 检测两个字段之间的关联关系

func detectRelation(table1, col1Name, col1Type, table2, col2Name, col2Type string, rules []string) (float64, string, string) {
	// 辅助函数：检查规则是否启用
	ruleEnabled := func(ruleName string) bool {
		for _, r := range rules {
			if r == ruleName {
				return true
			}
		}
		return false
	}

	// 1. 精确匹配：字段名完全相同
	if ruleEnabled("exact") && col1Name == col2Name {
		confidence := 1.0
		reason := fmt.Sprintf("字段名完全匹配: %s", col1Name)

		// 应用前缀一致性加成
		if ruleEnabled("prefix_consistency") {
			prefixBonus := calculatePrefixConsistency(table1, table2)
			if prefixBonus > 0 {
				confidence = confidence * (1 + prefixBonus*0.3)
				if confidence > 1.0 {
					confidence = 1.0
				}
			}
		}

		return confidence, reason, "exact"
	}

	// 2. 前缀/后缀匹配：A.id ↔ B.a_id / B.aid
	if ruleEnabled("naming_style") {
		col1Lower := strings.ToLower(col1Name)
		col2Lower := strings.ToLower(col2Name)
		table1Lower := strings.ToLower(table1)

		// 检查 col2 是否是 col1 的前缀/后缀形式
		if col1Lower == "id" {
			// col1 是 id，检查 col2 是否是 table_id 或 tableid
			if col2Lower == table1Lower+"_id" || col2Lower == table1Lower+"id" {
				confidence := 0.95
				reason := fmt.Sprintf("字段名匹配: %s ↔ %s (命名风格)", col1Name, col2Name)

				// 应用前缀一致性加成
				if ruleEnabled("prefix_consistency") {
					prefixBonus := calculatePrefixConsistency(table1, table2)
					if prefixBonus > 0 {
						confidence = confidence * (1 + prefixBonus*0.3)
						if confidence > 1.0 {
							confidence = 1.0
						}
					}
				}

				return confidence, reason, "naming_style"
			}
		}

		// 反向检查
		if col2Lower == "id" {
			if col1Lower == strings.ToLower(table2)+"_id" || col1Lower == strings.ToLower(table2)+"id" {
				confidence := 0.95
				reason := fmt.Sprintf("字段名匹配: %s ↔ %s (命名风格)", col1Name, col2Name)

				// 应用前缀一致性加成
				if ruleEnabled("prefix_consistency") {
					prefixBonus := calculatePrefixConsistency(table1, table2)
					if prefixBonus > 0 {
						confidence = confidence * (1 + prefixBonus*0.3)
						if confidence > 1.0 {
							confidence = 1.0
						}
					}
				}

				return confidence, reason, "naming_style"
			}
		}
	}

	// 3. 类型匹配：都是 INT/BIGINT
	if ruleEnabled("type_keyword") && strings.Contains(strings.ToUpper(col1Type), "INT") && strings.Contains(strings.ToUpper(col2Type), "INT") {
		// 检查是否有部分名称匹配
		col1Lower := strings.ToLower(col1Name)
		col2Lower := strings.ToLower(col2Name)
		if strings.Contains(col2Lower, col1Lower) || strings.Contains(col1Lower, col2Lower) {
			confidence := 0.7
			reason := fmt.Sprintf("类型匹配 + 名称相似: %s(%s) ↔ %s(%s)", col1Name, col1Type, col2Name, col2Type)

			// 应用前缀一致性加成
			if ruleEnabled("prefix_consistency") {
				prefixBonus := calculatePrefixConsistency(table1, table2)
				if prefixBonus > 0 {
					confidence = confidence * (1 + prefixBonus*0.3)
					if confidence > 1.0 {
						confidence = 1.0
					}
				}
			}

			return confidence, reason, "type_keyword"
		}
	}

	return 0, "", ""
}

// calculatePrefixConsistency 计算两个表名的前缀一致性

func calculatePrefixConsistency(table1, table2 string) float64 {
	// 转换为小写
	t1 := strings.ToLower(table1)
	t2 := strings.ToLower(table2)

	// 找到公共前缀长度
	minLen := len(t1)
	if len(t2) < minLen {
		minLen = len(t2)
	}

	commonPrefixLen := 0
	for i := 0; i < minLen; i++ {
		if t1[i] == t2[i] {
			commonPrefixLen++
		} else {
			break
		}
	}

	// 如果没有公共前缀，返回 0
	if commonPrefixLen == 0 {
		return 0
	}

	// 计算前缀重合比例（占较长表名的比例）
	maxLen := len(t1)
	if len(t2) > maxLen {
		maxLen = len(t2)
	}

	return float64(commonPrefixLen) / float64(maxLen)
}

// getVectorList 获取向量列表

func (m *FTS5Manager) getVectorList(databaseID string) ([]map[string]interface{}, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.db == nil {
		return nil, sql.ErrConnDone
	}

	rows, err := m.db.Query(`
		SELECT table_name, LENGTH(embedding) as vector_size, created_at, updated_at
		FROM vectors
		WHERE database_id = ?
		ORDER BY table_name
	`, databaseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tables := make([]map[string]interface{}, 0)
	for rows.Next() {
		var tableName string
		var vectorSize int
		var createdAt, updatedAt string
		if err := rows.Scan(&tableName, &vectorSize, &createdAt, &updatedAt); err != nil {
			continue
		}

		// 计算向量维度（每个 float32 占 4 字节）
		dimension := vectorSize / 4

		tables = append(tables, map[string]interface{}{
			"name":       tableName,
			"dimension":  dimension,
			"created_at": createdAt,
			"updated_at": updatedAt,
		})
	}

	return tables, nil
}

// syncVectorsToSQLite 增量同步向量到 SQLite

func (m *FTS5Manager) syncVectorsToSQLite(dbConfig *DatabaseConfig, embeddingConfig EmbeddingRetrievalConfig) (added int, deleted int, err error) {
	if m == nil || m.db == nil {
		return 0, 0, nil
	}
	if !embeddingConfig.Enabled || embeddingConfig.URL == "" {
		return 0, 0, nil
	}

	// 获取表列表
	tableInfos, err := getTableInfoList(dbConfig)
	if err != nil {
		return 0, 0, fmt.Errorf("获取表列表失败: %w", err)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// 1. 获取已有的向量记录
	existingVectors := make(map[string]time.Time)
	rows, err := m.db.Query("SELECT table_name, updated_at FROM vectors WHERE database_id = ?", dbConfig.ID)
	if err != nil {
		return 0, 0, err
	}
	for rows.Next() {
		var tableName string
		var updatedAt time.Time
		if err := rows.Scan(&tableName, &updatedAt); err != nil {
			continue
		}
		existingVectors[tableName] = updatedAt
	}
	rows.Close()

	// 2. 构建当前表名集合
	currentTables := make(map[string]bool)
	for _, ti := range tableInfos {
		currentTables[ti.Name] = true
	}

	// 3. 找出需要删除的表（存在于向量表但不在当前表中）
	var toDelete []string
	for tableName := range existingVectors {
		if !currentTables[tableName] {
			toDelete = append(toDelete, tableName)
		}
	}

	// 4. 找出需要新增/更新的表
	type tableToSync struct {
		name    string
		comment string
	}
	var toSync []tableToSync
	for _, ti := range tableInfos {
		// 检查是否需要同步：新表 或 表结构可能变化（这里简化为检查是否存在）
		if _, exists := existingVectors[ti.Name]; !exists {
			toSync = append(toSync, tableToSync{name: ti.Name, comment: ti.Comment})
		}
	}

	if len(toDelete) == 0 && len(toSync) == 0 {
		log.Printf("[表检索] 数据库 %s 向量已是最新，无需同步", dbConfig.Name)
		return 0, 0, nil
	}

	log.Printf("[表检索] 数据库 %s 增量同步: 删除 %d 个, 新增 %d 个", dbConfig.Name, len(toDelete), len(toSync))

	tx, err := m.db.Begin()
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback()

	// 删除已不存在的表
	if len(toDelete) > 0 {
		stmt, err := tx.Prepare("DELETE FROM vectors WHERE database_id = ? AND table_name = ?")
		if err != nil {
			return 0, 0, err
		}
		for _, tableName := range toDelete {
			if _, err := stmt.Exec(dbConfig.ID, tableName); err != nil {
				log.Printf("[表检索] 删除向量失败 (%s): %v", tableName, err)
			}
		}
		stmt.Close()
		deleted = len(toDelete)
	}

	// 新增/更新向量
	var errors []string
	if len(toSync) > 0 {
		stmt, err := tx.Prepare(`
			INSERT OR REPLACE INTO vectors (database_id, table_name, embedding, updated_at)
			VALUES (?, ?, ?, CURRENT_TIMESTAMP)
		`)
		if err != nil {
			return 0, 0, err
		}
		defer stmt.Close()

		successCount := 0
		for _, ts := range toSync {
			// 构建 embedding 文本：表名 + 注释
			text := ts.name
			if ts.comment != "" {
				text = ts.name + " " + ts.comment
			}

			embedding, err := generateEmbedding(text, embeddingConfig)
			if err != nil {
				errMsg := fmt.Sprintf("%s: %v", ts.name, err)
				errors = append(errors, errMsg)
				log.Printf("[表检索] 生成 embedding 失败 (%s): %v", ts.name, err)
				continue
			}

			embeddingBytes := float32SliceToBytes(embedding)
			if _, err := stmt.Exec(dbConfig.ID, ts.name, embeddingBytes); err != nil {
				log.Printf("[表检索] 插入向量失败 (%s): %v", ts.name, err)
				continue
			}
			successCount++
		}
		log.Printf("[表检索] 数据库 %s 新增向量: %d/%d", dbConfig.Name, successCount, len(toSync))
		added = successCount
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, err
	}

	log.Printf("[表检索] 数据库 %s 增量同步完成", dbConfig.Name)

	// 如果有错误，返回错误信息
	if len(errors) > 0 {
		return added, deleted, fmt.Errorf("部分表生成向量失败: %s", strings.Join(errors, "; "))
	}
	return added, deleted, nil
}

// vectorRetrieveTables 向量检索表

func (m *FTS5Manager) vectorRetrieveTables(query string, databaseID string, limit int, embeddingConfig EmbeddingRetrievalConfig) ([]TableRelevanceResult, error) {
	if m == nil || m.db == nil {
		return nil, sql.ErrConnDone
	}
	if !embeddingConfig.Enabled || embeddingConfig.URL == "" {
		return nil, fmt.Errorf("embedding 未启用或未配置")
	}

	// 1. 生成 query 的 embedding
	queryEmbedding, err := generateEmbedding(query, embeddingConfig)
	if err != nil {
		return nil, fmt.Errorf("生成查询向量失败: %w", err)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// 2. 从 vectors 表读取所有向量（按 dbID 过滤）
	rows, err := m.db.Query("SELECT table_name, embedding FROM vectors WHERE database_id = ?", databaseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// 3. 计算余弦相似度
	type candidate struct {
		tableName string
		score     float64
	}
	var candidates []candidate

	for rows.Next() {
		var tableName string
		var embeddingBytes []byte
		if err := rows.Scan(&tableName, &embeddingBytes); err != nil {
			continue
		}

		vec, err := bytesToFloat32Slice(embeddingBytes)
		if err != nil {
			log.Printf("[表检索] 反序列化向量失败 (%s): %v", tableName, err)
			continue
		}

		similarity := cosineSimilarity(queryEmbedding, vec)
		candidates = append(candidates, candidate{tableName: tableName, score: similarity})
	}

	// 4. 按相似度排序
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].score > candidates[j].score
	})

	// 5. 返回 topK
	if limit > len(candidates) {
		limit = len(candidates)
	}

	results := make([]TableRelevanceResult, 0, limit)
	for i := 0; i < limit; i++ {
		results = append(results, TableRelevanceResult{
			TableName:      candidates[i].tableName,
			RelevanceScore: candidates[i].score,
			MatchReason:    "向量相似度",
		})
	}

	return results, nil
}

// getVectorStats 获取向量索引统计信息

func (m *FTS5Manager) getVectorStats() (int, map[string]int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.db == nil {
		return 0, nil, sql.ErrConnDone
	}

	var totalCount int
	if err := m.db.QueryRow("SELECT COUNT(*) FROM vectors").Scan(&totalCount); err != nil {
		return 0, nil, err
	}

	rows, err := m.db.Query("SELECT database_id, COUNT(*) as count FROM vectors GROUP BY database_id")
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()

	dbStats := make(map[string]int)
	for rows.Next() {
		var dbID string
		var count int
		if err := rows.Scan(&dbID, &count); err == nil {
			dbStats[dbID] = count
		}
	}

	return totalCount, dbStats, nil
}

// syncRelationsToSQLite 增量同步关系到 SQLite

func (m *FTS5Manager) syncRelationsToSQLite(dbConfig *DatabaseConfig) error {
	if m == nil || m.db == nil {
		return nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// 1. 获取已有的关系记录
	existingRels := make(map[string]bool)
	rows, err := m.db.Query("SELECT source_table, source_field, target_table, target_field FROM relations WHERE database_id = ?", dbConfig.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var srcTable, srcField, tgtTable, tgtField string
		if err := rows.Scan(&srcTable, &srcField, &tgtTable, &tgtField); err != nil {
			continue
		}
		key := srcTable + "." + srcField + "->" + tgtTable + "." + tgtField
		existingRels[key] = true
	}
	rows.Close()

	// 2. 构建当前关系的 key 集合
	currentRels := make(map[string]bool)
	type relEntry struct {
		key          string
		sourceTable  string
		sourceField  string
		targetTable  string
		targetField  string
		matchType    string
		relationName string
	}
	var toSync []relEntry
	for _, rel := range dbConfig.Relations {
		key := rel.Source.TableName + "." + rel.Source.FieldName + "->" + rel.Target.TableName + "." + rel.Target.FieldName
		currentRels[key] = true
		if !existingRels[key] {
			toSync = append(toSync, relEntry{
				key:          key,
				sourceTable:  rel.Source.TableName,
				sourceField:  rel.Source.FieldName,
				targetTable:  rel.Target.TableName,
				targetField:  rel.Target.FieldName,
				matchType:    rel.MatchType,
				relationName: rel.Name,
			})
		}
	}

	// 3. 找出需要删除的关系
	var toDelete []string
	for key := range existingRels {
		if !currentRels[key] {
			toDelete = append(toDelete, key)
		}
	}

	if len(toDelete) == 0 && len(toSync) == 0 {
		log.Printf("[表检索] 数据库 %s 关系已是最新，无需同步", dbConfig.Name)
		return nil
	}

	log.Printf("[表检索] 数据库 %s 增量同步关系: 删除 %d 个, 新增 %d 个", dbConfig.Name, len(toDelete), len(toSync))

	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 删除已不存在的关系
	if len(toDelete) > 0 {
		stmt, err := tx.Prepare("DELETE FROM relations WHERE database_id = ? AND source_table = ? AND source_field = ? AND target_table = ? AND target_field = ?")
		if err != nil {
			return err
		}
		for _, key := range toDelete {
			// key format: srcTable.srcField->tgtTable.tgtField
			arrowIdx := strings.Index(key, "->")
			if arrowIdx < 0 {
				continue
			}
			left := key[:arrowIdx]
			right := key[arrowIdx+2:]
			dotLeft := strings.Index(left, ".")
			dotRight := strings.Index(right, ".")
			if dotLeft < 0 || dotRight < 0 {
				continue
			}
			srcTable := left[:dotLeft]
			srcField := left[dotLeft+1:]
			tgtTable := right[:dotRight]
			tgtField := right[dotRight+1:]
			if _, err := stmt.Exec(dbConfig.ID, srcTable, srcField, tgtTable, tgtField); err != nil {
				log.Printf("[表检索] 删除关系失败 (%s): %v", key, err)
			}
		}
		stmt.Close()
	}

	// 新增关系
	if len(toSync) > 0 {
		stmt, err := tx.Prepare(`
			INSERT INTO relations (database_id, source_table, source_field, target_table, target_field, match_type, relation_name)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`)
		if err != nil {
			return err
		}
		defer stmt.Close()

		successCount := 0
		for _, rel := range toSync {
			if _, err := stmt.Exec(
				dbConfig.ID,
				rel.sourceTable,
				rel.sourceField,
				rel.targetTable,
				rel.targetField,
				rel.matchType,
				rel.relationName,
			); err != nil {
				log.Printf("[表检索] 插入关系失败 (%s): %v", rel.key, err)
				continue
			}
			successCount++
		}
		log.Printf("[表检索] 数据库 %s 新增关系: %d/%d", dbConfig.Name, successCount, len(toSync))
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	log.Printf("[表检索] 数据库 %s 关系增量同步完成", dbConfig.Name)
	return nil
}

// graphRetrieveTables Graph 关系检索（基于已匹配表扩展关联表）

func (m *FTS5Manager) graphRetrieveTables(seedTables []string, databaseID string, maxDepth int, limit int) ([]TableRelevanceResult, error) {
	if m == nil || m.db == nil {
		return nil, sql.ErrConnDone
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// 已访问表集合
	visited := make(map[string]bool)
	// 结果表及其关系分数
	tableScores := make(map[string]float64)

	// BFS 扩展
	currentLevel := seedTables
	depth := 0
	baseScore := 1.0 // 种子表分数为 1.0

	// 先把种子表加入结果
	for _, t := range seedTables {
		visited[t] = true
		tableScores[t] = baseScore
	}

	for depth < maxDepth && len(currentLevel) > 0 {
		nextLevel := make([]string, 0)
		decay := 0.5 / float64(depth+1) // 每层衰减

		for _, sourceTable := range currentLevel {
			// 查找以该表为源的关系
			rows, err := m.db.Query(`
				SELECT target_table, relation_name 
				FROM relations 
				WHERE database_id = ? AND source_table = ?
			`, databaseID, sourceTable)
			if err != nil {
				continue
			}

			for rows.Next() {
				var targetTable, relationName string
				if err := rows.Scan(&targetTable, &relationName); err != nil {
					continue
				}
				_ = relationName

				if !visited[targetTable] {
					visited[targetTable] = true
					tableScores[targetTable] = baseScore * decay
					nextLevel = append(nextLevel, targetTable)
				}
			}
			rows.Close()

			// 查找以该表为目标的关系（反向关联）
			rows2, err := m.db.Query(`
				SELECT source_table, relation_name 
				FROM relations 
				WHERE database_id = ? AND target_table = ?
			`, databaseID, sourceTable)
			if err != nil {
				continue
			}

			for rows2.Next() {
				var srcTable, relationName string
				if err := rows2.Scan(&srcTable, &relationName); err != nil {
					continue
				}
				_ = relationName

				if !visited[srcTable] {
					visited[srcTable] = true
					tableScores[srcTable] = baseScore * decay
					nextLevel = append(nextLevel, srcTable)
				}
			}
			rows2.Close()
		}

		currentLevel = nextLevel
		depth++
	}

	// 按分数排序
	results := make([]TableRelevanceResult, 0, len(tableScores))
	for tableName, score := range tableScores {
		results = append(results, TableRelevanceResult{
			TableName:      tableName,
			RelevanceScore: score,
			MatchReason:    "Graph 关系扩展",
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].RelevanceScore > results[j].RelevanceScore
	})

	// 限制返回数量
	if limit > len(results) {
		limit = len(results)
	}

	return results[:limit], nil
}

// getRelationStats 获取关系索引统计信息

func (m *FTS5Manager) getRelationStats() (int, map[string]int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.db == nil {
		return 0, nil, sql.ErrConnDone
	}

	var totalCount int
	if err := m.db.QueryRow("SELECT COUNT(*) FROM relations").Scan(&totalCount); err != nil {
		return 0, nil, err
	}

	rows, err := m.db.Query("SELECT database_id, COUNT(*) as count FROM relations GROUP BY database_id")
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()

	dbStats := make(map[string]int)
	for rows.Next() {
		var dbID string
		var count int
		if err := rows.Scan(&dbID, &count); err == nil {
			dbStats[dbID] = count
		}
	}

	return totalCount, dbStats, nil
}

// VectorInfo 向量信息（用于预览）

type VectorInfo struct {
	DatabaseID  string `json:"database_id"`
	TableName   string `json:"table_name"`
	Dimension   int    `json:"dimension"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
	Comment     string `json:"comment,omitempty"`      // 表注释
	ColumnCount int    `json:"column_count,omitempty"` // 字段数量
	PKFields    string `json:"pk_fields,omitempty"`    // 主键字段（逗号分隔）
	FKFields    string `json:"fk_fields,omitempty"`    // 外键信息（格式：字段->目标表）
}

// RelationInfo 关系信息（用于预览）

type RelationInfo struct {
	ID           int    `json:"id"`
	DatabaseID   string `json:"database_id"`
	SourceTable  string `json:"source_table"`
	SourceField  string `json:"source_field"`
	TargetTable  string `json:"target_table"`
	TargetField  string `json:"target_field"`
	MatchType    string `json:"match_type"`
	RelationName string `json:"relation_name"`
	CreatedAt    string `json:"created_at"`
}

// listVectors 获取向量列表（分页）

func (m *FTS5Manager) listVectors(databaseID string, page, pageSize int) ([]VectorInfo, int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.db == nil {
		return nil, 0, sql.ErrConnDone
	}

	// 获取总数
	var total int
	countQuery := "SELECT COUNT(*) FROM vectors"
	countArgs := []interface{}{}
	if databaseID != "" {
		countQuery += " WHERE database_id = ?"
		countArgs = append(countArgs, databaseID)
	}
	if err := m.db.QueryRow(countQuery, countArgs...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// 分页查询
	offset := (page - 1) * pageSize
	query := "SELECT database_id, table_name, LENGTH(embedding)/4 as dimension, created_at, updated_at FROM vectors"
	args := []interface{}{}
	if databaseID != "" {
		query += " WHERE database_id = ?"
		args = append(args, databaseID)
	}
	query += " ORDER BY updated_at DESC LIMIT ? OFFSET ?"
	args = append(args, pageSize, offset)

	rows, err := m.db.Query(query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var vectors []VectorInfo
	for rows.Next() {
		var v VectorInfo
		if err := rows.Scan(&v.DatabaseID, &v.TableName, &v.Dimension, &v.CreatedAt, &v.UpdatedAt); err == nil {
			vectors = append(vectors, v)
		}
	}

	return vectors, total, nil
}

// listRelations 获取关系列表（分页）
// listRelationsParams 关系列表查询参数

type listRelationsParams struct {
	DatabaseID string // 数据库ID（必填）
	Page       int    // 页码（默认1）
	PageSize   int    // 每页数量（默认50）
	Keyword    string // 关键词（搜索源表名、目标表名、源字段、目标字段）
	MatchType  string // 匹配类型过滤
	SourceOnly bool   // 只看源表
}

// listRelations 获取关系列表（支持筛选）

func (m *FTS5Manager) listRelations(params listRelationsParams) ([]RelationInfo, int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.db == nil {
		return nil, 0, sql.ErrConnDone
	}

	// 默认值
	if params.Page < 1 {
		params.Page = 1
	}
	if params.PageSize < 1 || params.PageSize > 200 {
		params.PageSize = 50
	}

	// 构建 WHERE 条件
	whereClause := "WHERE database_id = ?"
	countArgs := []interface{}{params.DatabaseID}
	queryArgs := []interface{}{params.DatabaseID}

	if params.Keyword != "" {
		keyword := "%" + params.Keyword + "%"
		whereClause += " AND (source_table LIKE ? OR source_field LIKE ? OR target_table LIKE ? OR target_field LIKE ?)"
		countArgs = append(countArgs, keyword, keyword, keyword, keyword)
		queryArgs = append(queryArgs, keyword, keyword, keyword, keyword)
	}
	if params.MatchType != "" {
		whereClause += " AND match_type = ?"
		countArgs = append(countArgs, params.MatchType)
		queryArgs = append(queryArgs, params.MatchType)
	}
	if params.SourceOnly {
		whereClause += " AND source_table = target_table"
	}

	// 获取总数
	var total int
	countQuery := "SELECT COUNT(*) FROM relations " + whereClause
	if err := m.db.QueryRow(countQuery, countArgs...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// 分页查询
	offset := (params.Page - 1) * params.PageSize
	query := fmt.Sprintf(`SELECT id, database_id, source_table, source_field, target_table, target_field, match_type, relation_name, created_at 
		FROM relations %s ORDER BY created_at DESC LIMIT ? OFFSET ?`, whereClause)
	queryArgs = append(queryArgs, params.PageSize, offset)

	rows, err := m.db.Query(query, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var relations []RelationInfo
	for rows.Next() {
		var r RelationInfo
		if err := rows.Scan(&r.ID, &r.DatabaseID, &r.SourceTable, &r.SourceField, &r.TargetTable, &r.TargetField, &r.MatchType, &r.RelationName, &r.CreatedAt); err == nil {
			relations = append(relations, r)
		}
	}

	return relations, total, nil
}

// getMatchTypes 获取所有匹配类型（用于筛选下拉）

func (m *FTS5Manager) getMatchTypes(databaseID string) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.db == nil {
		return nil, sql.ErrConnDone
	}

	query := "SELECT DISTINCT match_type FROM relations WHERE database_id = ? ORDER BY match_type"
	rows, err := m.db.Query(query, databaseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var types []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err == nil && t != "" {
			types = append(types, t)
		}
	}
	return types, nil
}

// deleteVectors 删除向量（支持批量）

func (m *FTS5Manager) deleteVectors(databaseID string, tableNames []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.db == nil {
		return sql.ErrConnDone
	}

	if len(tableNames) == 0 {
		return nil
	}

	// 构建批量删除 SQL
	placeholders := make([]string, len(tableNames))
	args := []interface{}{databaseID}
	for i, tn := range tableNames {
		placeholders[i] = "?"
		args = append(args, tn)
	}

	query := fmt.Sprintf("DELETE FROM vectors WHERE database_id = ? AND table_name IN (%s)", strings.Join(placeholders, ","))
	_, err := m.db.Exec(query, args...)
	return err
}

// deleteRelations 删除关系（支持批量）

func (m *FTS5Manager) deleteRelations(databaseID string, relationIDs []int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.db == nil {
		return sql.ErrConnDone
	}

	if len(relationIDs) == 0 {
		return nil
	}

	// 构建批量删除 SQL
	placeholders := make([]string, len(relationIDs))
	args := []interface{}{databaseID}
	for i, id := range relationIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}

	query := fmt.Sprintf("DELETE FROM relations WHERE database_id = ? AND id IN (%s)", strings.Join(placeholders, ","))
	_, err := m.db.Exec(query, args...)
	return err
}

// addRelation 添加关系

func (m *FTS5Manager) addRelation(databaseID, sourceTable, sourceField, targetTable, targetField, matchType, relationName string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.db == nil {
		return 0, sql.ErrConnDone
	}

	result, err := m.db.Exec(`
		INSERT INTO relations (database_id, source_table, source_field, target_table, target_field, match_type, relation_name)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, databaseID, sourceTable, sourceField, targetTable, targetField, matchType, relationName)
	if err != nil {
		return 0, err
	}

	return result.LastInsertId()
}

// updateRelation 更新关系

func (m *FTS5Manager) updateRelation(databaseID string, relationID int, sourceTable, sourceField, targetTable, targetField, matchType, relationName string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.db == nil {
		return sql.ErrConnDone
	}

	_, err := m.db.Exec(`
		UPDATE relations 
		SET source_table = ?, source_field = ?, target_table = ?, target_field = ?, match_type = ?, relation_name = ?
		WHERE database_id = ? AND id = ?
	`, sourceTable, sourceField, targetTable, targetField, matchType, relationName, databaseID, relationID)
	return err
}

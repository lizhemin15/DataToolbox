package main

import (
	"database/sql"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// SQLiteFTS5Manager 管理 SQLite FTS5 表检索
type SQLiteFTS5Manager struct {
	db   *sql.DB
	path string
	mu   sync.RWMutex
}

var (
	fts5Manager     *SQLiteFTS5Manager
	fts5ManagerOnce sync.Once
)

// getFTS5Manager 获取单例 FTS5 管理器
func getFTS5Manager() *SQLiteFTS5Manager {
	fts5ManagerOnce.Do(func() {
		// SQLite 数据库路径：与 data-store.json 同目录
		dbPath := filepath.Join("apps/data-ontology", "table-retrieval.db")

		manager, err := initTableRetrievalDB(dbPath)
		if err != nil {
			log.Printf("初始化表检索数据库失败: %v", err)
			return
		}

		fts5Manager = manager
		log.Printf("表检索数据库已初始化: %s", dbPath)
	})
	return fts5Manager
}

// initTableRetrievalDB 初始化 SQLite 数据库和 FTS5 表
func initTableRetrievalDB(dbPath string) (*SQLiteFTS5Manager, error) {
	// 确保目录存在
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("创建目录失败: %w", err)
	}

	// 打开 SQLite 数据库
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("打开数据库失败: %w", err)
	}

	// 设置连接池参数
	db.SetMaxOpenConns(1) // SQLite 单写多读
	db.SetMaxIdleConns(1)

	// 创建表元数据表
	createTablesSQL := `
	CREATE TABLE IF NOT EXISTS tables (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		table_id TEXT NOT NULL,
		database_id TEXT NOT NULL,
		name TEXT NOT NULL,
		comment TEXT,
		column_names TEXT,
		updated_at INTEGER NOT NULL,
		UNIQUE(database_id, table_id)
	);
	CREATE INDEX IF NOT EXISTS idx_tables_database_id ON tables(database_id);
	CREATE INDEX IF NOT EXISTS idx_tables_name ON tables(name);
	`

	if _, err := db.Exec(createTablesSQL); err != nil {
		db.Close()
		return nil, fmt.Errorf("创建表失败: %w", err)
	}

	// 创建 FTS5 虚拟表（支持中英文混合检索）
	// tokenize="unicode61" 支持：
	// - Unicode61（支持中文等 Unicode 字符，按字符分词）
	// 注意：不使用 porter，因为会影响中文分词效果
	createFTS5SQL := `
	CREATE VIRTUAL TABLE IF NOT EXISTS tables_fts USING fts5(
		table_id,
		database_id,
		name,
		comment,
		column_names,
		content='tables',
		content_rowid='id',
		tokenize="unicode61"
	);
	`

	if _, err := db.Exec(createFTS5SQL); err != nil {
		db.Close()
		return nil, fmt.Errorf("创建 FTS5 表失败: %w", err)
	}

	// 创建触发器：自动同步 FTS5 索引
	triggers := []string{
		`CREATE TRIGGER IF NOT EXISTS tables_ai AFTER INSERT ON tables BEGIN
			INSERT INTO tables_fts(rowid, table_id, database_id, name, comment, column_names)
			VALUES (new.id, new.table_id, new.database_id, new.name, new.comment, new.column_names);
		END;`,
		`CREATE TRIGGER IF NOT EXISTS tables_ad AFTER DELETE ON tables BEGIN
			INSERT INTO tables_fts(tables_fts, rowid, table_id, database_id, name, comment, column_names)
			VALUES ('delete', old.id, old.table_id, old.database_id, old.name, old.comment, old.column_names);
		END;`,
		`CREATE TRIGGER IF NOT EXISTS tables_au AFTER UPDATE ON tables BEGIN
			INSERT INTO tables_fts(tables_fts, rowid, table_id, database_id, name, comment, column_names)
			VALUES ('delete', old.id, old.table_id, old.database_id, old.name, old.comment, old.column_names);
			INSERT INTO tables_fts(rowid, table_id, database_id, name, comment, column_names)
			VALUES (new.id, new.table_id, new.database_id, new.name, new.comment, new.column_names);
		END;`,
	}

	for _, trigger := range triggers {
		if _, err := db.Exec(trigger); err != nil {
			db.Close()
			return nil, fmt.Errorf("创建触发器失败: %w", err)
		}
	}

	return &SQLiteFTS5Manager{
		db:   db,
		path: dbPath,
	}, nil
}

// syncTablesToSQLite 同步表信息到 SQLite
func (m *SQLiteFTS5Manager) syncTablesToSQLite(dbConfig *DatabaseConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 获取表列表
	tableNames, err := getTablesList(dbConfig)
	if err != nil {
		return fmt.Errorf("获取表列表失败: %w", err)
	}

	if len(tableNames) == 0 {
		return nil
	}

	// 获取数据库连接（用于获取表注释）
	db, err := getDBFromPool(dbConfig)
	if err != nil {
		return fmt.Errorf("获取数据库连接失败: %w", err)
	}

	// 获取表注释
	tableComments := getTableComments(db, dbConfig, tableNames)

	// 开始事务
	tx, err := m.db.Begin()
	if err != nil {
		return fmt.Errorf("开始事务失败: %w", err)
	}
	defer tx.Rollback()

	now := time.Now().Unix()

	// 删除该数据库的所有旧数据
	if _, err := tx.Exec("DELETE FROM tables WHERE database_id = ?", dbConfig.ID); err != nil {
		return fmt.Errorf("删除旧数据失败: %w", err)
	}

	// 准备插入语句
	stmt, err := tx.Prepare(`
		INSERT INTO tables (table_id, database_id, name, comment, column_names, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("准备插入语句失败: %w", err)
	}
	defer stmt.Close()

	// 批量插入表信息
	for _, tableName := range tableNames {
		// 获取字段名列表
		columns, err := getTableColumns(dbConfig, tableName)
		if err != nil {
			log.Printf("获取表 %s 的字段失败: %v", tableName, err)
			continue
		}

		var colNames []string
		for _, col := range columns {
			if colName, ok := col["name"].(string); ok {
				colNames = append(colNames, colName)
			}
		}

		// 将字段名列表转换为逗号分隔的字符串
		columnNamesStr := strings.Join(colNames, ",")

		// table_id 使用 database_id + table_name 作为唯一标识
		tableID := fmt.Sprintf("%s:%s", dbConfig.ID, tableName)

		if _, err := stmt.Exec(tableID, dbConfig.ID, tableName, tableComments[tableName], columnNamesStr, now); err != nil {
			log.Printf("插入表 %s 失败: %v", tableName, err)
			continue
		}
	}

	// 提交事务
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("提交事务失败: %w", err)
	}

	log.Printf("[表检索] 已同步数据库 %s 的 %d 张表到 SQLite", dbConfig.Name, len(tableNames))
	return nil
}

// fts5RetrieveTables 使用 FTS5 进行表检索
func (m *SQLiteFTS5Manager) fts5RetrieveTables(query string, dbID string, maxTables int) ([]TableRelevanceResult, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// 分词
	keywords := tokenizeQuery(query)
	if len(keywords) == 0 {
		return []TableRelevanceResult{}, nil
	}

	// 构建 FTS5 查询
	// 使用 BM25 排序，支持中英文混合检索
	// 查询格式：name:keyword1 OR comment:keyword1 OR column_names:keyword1 ...
	var conditions []string
	for _, keyword := range keywords {
		// 对每个关键词，在 name、comment、column_names 中搜索
		keyword = strings.ToLower(keyword)
		conditions = append(conditions,
			fmt.Sprintf("name:%s", keyword),
			fmt.Sprintf("comment:%s", keyword),
			fmt.Sprintf("column_names:%s", keyword),
		)
	}

	ftsQuery := strings.Join(conditions, " OR ")

	// 构建SQL查询
	sqlQuery := `
		SELECT
			table_id,
			database_id,
			name,
			comment,
			bm25(tables_fts) as score
		FROM tables_fts
		WHERE tables_fts MATCH ?
	`
	args := []interface{}{ftsQuery}

	// 如果指定了数据库ID，添加过滤条件
	if dbID != "" {
		sqlQuery += " AND database_id = ?"
		args = append(args, dbID)
	}

	// 按 BM25 分数排序（分数越低越好，BM25 返回负数）
	sqlQuery += " ORDER BY score LIMIT ?"
	args = append(args, maxTables)

	rows, err := m.db.Query(sqlQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("查询失败: %w", err)
	}
	defer rows.Close()

	var results []TableRelevanceResult
	for rows.Next() {
		var tableID, databaseID, name, comment string
		var score float64

		if err := rows.Scan(&tableID, &databaseID, &name, &comment, &score); err != nil {
			log.Printf("扫描结果失败: %v", err)
			continue
		}

		// 将 BM25 分数转换为 0-1 的相关度分数
		// BM25 分数是负数，越接近 0 越相关（例如 -5 比 -15 更好）
		// 使用 sigmoid 函数进行归一化: score -> -score -> sigmoid
		// 例如: -5 -> 5 -> sigmoid(5) ≈ 0.99
		relevanceScore := sigmoid(-score)

		// 确定匹配原因
		matchReason := determineMatchReason(keywords, name, comment)

		results = append(results, TableRelevanceResult{
			TableName:      name,
			RelevanceScore:  relevanceScore,
			MatchReason:    matchReason,
		})
	}

	return results, nil
}

// sigmoid 计算 sigmoid 函数: 1 / (1 + e^-x)
func sigmoid(x float64) float64 {
	return 1.0 / (1.0 + math.Exp(-x))
}

// determineMatchReason 确定匹配原因
func determineMatchReason(keywords []string, tableName, comment string) string {
	tableNameLower := strings.ToLower(tableName)
	commentLower := strings.ToLower(comment)

	for _, keyword := range keywords {
		keywordLower := strings.ToLower(keyword)

		// 表名完全匹配
		if tableNameLower == keywordLower {
			return fmt.Sprintf("表名完全匹配 '%s'", keyword)
		}

		// 表名包含关键词
		if strings.Contains(tableNameLower, keywordLower) {
			return fmt.Sprintf("表名包含 '%s'", keyword)
		}

		// 注释包含关键词
		if commentLower != "" && strings.Contains(commentLower, keywordLower) {
			return fmt.Sprintf("表注释包含 '%s'", keyword)
		}
	}

	return "关键词匹配"
}

// syncAllDatabases 同步所有数据库的表信息到 SQLite
func (m *SQLiteFTS5Manager) syncAllDatabases() error {
	dataOntologyMu.RLock()
	databases := make([]*DatabaseConfig, 0, len(dataOntologyDatabases))
	for _, db := range dataOntologyDatabases {
		databases = append(databases, db)
	}
	dataOntologyMu.RUnlock()

	log.Printf("[表检索] 开始同步 %d 个数据库的表信息", len(databases))

	var errors []error
	for _, db := range databases {
		if err := m.syncTablesToSQLite(db); err != nil {
			errors = append(errors, fmt.Errorf("同步数据库 %s 失败: %w", db.Name, err))
		}
	}

	if len(errors) > 0 {
		return fmt.Errorf("同步过程中发生 %d 个错误: %v", len(errors), errors)
	}

	log.Printf("[表检索] 所有数据库表信息同步完成")
	return nil
}

// close 关闭数据库连接
func (m *SQLiteFTS5Manager) close() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.db != nil {
		return m.db.Close()
	}
	return nil
}
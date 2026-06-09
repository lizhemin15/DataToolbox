package main

import (
	"context"
	"database/sql"
	"fmt"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"log"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode"
)

func buildDSN(config *DatabaseConfig) (string, string, error) {
	switch config.Type {
	case "mysql", "mariadb":
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=True&loc=Local&timeout=10s&readTimeout=30s&writeTimeout=30s",
			config.User, config.Password, config.Host, config.Port, config.Database)
		return "mysql", dsn, nil

	case "postgresql", "timescaledb":
		dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=disable connect_timeout=10",
			config.Host, config.Port, config.User, config.Password, config.Database)
		return "postgres", dsn, nil

	case "sqlserver":
		dsn := fmt.Sprintf("sqlserver://%s:%s@%s:%d?database=%s&connection+timeout=10",
			config.User, config.Password, config.Host, config.Port, config.Database)
		return "sqlserver", dsn, nil

	case "oracle":
		// 使用 go-ora 驶动，必须提供 SID 或服务名
		if config.Database == "" {
			return "", "", fmt.Errorf("Oracle 连接需要填写 SID 或服务名（在「SID/服务名」中填写，例如 ORCL、XE）")
		}
		dsn := fmt.Sprintf("oracle://%s:%s@%s:%d/%s?TIMEOUT=10",
			config.User, config.Password, config.Host, config.Port, config.Database)
		return "oracle", dsn, nil

	case "dm":
		// 达梦数据库连接字符串
		// 格式: dm://username:password@host:port/schema
		// 需要对用户名和密码进行 URL 编码，避免特殊字符导致解析错误
		log.Printf("DM配置: 原始Host='%s', 原始Port=%d", config.Host, config.Port)

		host := config.Host
		if host == "" {
			host = "localhost"
			log.Printf("DM: Host为空，使用默认值 localhost")
		}
		port := config.Port
		if port == 0 {
			port = 5236
			log.Printf("DM: Port为0，使用默认值 5236")
		}

		// DM 驱动自行解析 DSN，不做 URL 编码（编码后密码中的特殊字符会被当作编码值，导致认证失败）
		dsn := fmt.Sprintf("dm://%s:%s@%s:%d?timeout=10",
			config.User, config.Password, host, port)
		if config.Database != "" {
			dsn = fmt.Sprintf("dm://%s:%s@%s:%d/%s?timeout=10",
				config.User, config.Password, host, port, config.Database)
		}

		// 安全：不在日志中输出包含密码的 DSN
		log.Printf("DM最终DSN(已编码): driver=dm, host=%s, port=%d, database=%s", host, port, config.Database)
		return "dm", dsn, nil

	case "sqlite":
		path := strings.TrimSpace(config.Path)
		if path == "" {
			path = strings.TrimSpace(config.Database)
		}
		if path == "" {
			return "", "", fmt.Errorf("SQLite 需要配置数据库文件路径（path 或 database）")
		}
		// modernc.org/sqlite 注册的驱动名为 "sqlite"（非 mattn/go-sqlite3 的 sqlite3）
		return "sqlite", path, nil

	case "duckdb":
		// DuckDB 需要CGO支持
		return "", "", fmt.Errorf("DuckDB 支持需要CGO编译，当前构建版本不支持。请使用支持CGO的版本")

	case "tidb":
		// TiDB 兼容 MySQL 协议
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=True&timeout=10s&readTimeout=30s&writeTimeout=30s",
			config.User, config.Password, config.Host, config.Port, config.Database)
		return "mysql", dsn, nil

	case "cockroachdb":
		// CockroachDB 兼容 PostgreSQL 协议
		dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=disable connect_timeout=10",
			config.Host, config.Port, config.User, config.Password, config.Database)
		return "postgres", dsn, nil

	case "clickhouse":
		// ClickHouse 在某些构建环境中可能不可用
		return "", "", fmt.Errorf("ClickHouse 支持在当前构建版本中不可用。请使用完整版本")

	default:
		return "", "", fmt.Errorf("不支持的数据库类型: %s", config.Type)
	}
}

// 获取表列表的SQL（Oracle 使用 ALL_TABLES 排除 SYS/SYSTEM，从源头不查系统 schema，避免黑名单永远不全且驱动可能只返回部分行）

func getTablesQuery(config *DatabaseConfig) string {
	switch config.Type {
	case "mysql", "mariadb", "tidb":
		return "SHOW TABLES"
	case "postgresql", "timescaledb", "cockroachdb":
		return "SELECT tablename FROM pg_tables WHERE schemaname='public'"
	case "sqlserver":
		return "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'"
	case "oracle":
		// 排除系统 schema，但始终包含当前连接用户的 schema（OR owner = USER），这样新建的表能立即出现在列表中
		systemOwners := "'SYS','SYSTEM','OUTLN','DBSNMP','WMSYS','MDSYS','CTXSYS','XDB','EXFSYS','ORDSYS','OLAPSYS','ORACLE_OCM','OJVMSYS','LBACSYS','ANONYMOUS','APEX_PUBLIC_USER','FLOWS_FILES','OWBSYS','DIP','APPQOSSYS','DBSFWUSER','DVSYS','DVF','GSMADMIN_INTERNAL','GSMUSER','GSMROOTUSER','REMOTE_SCHEDULER_AGENT','SI_INFORMTN_SCHEMA'"
		return "SELECT owner||'.'||table_name FROM all_tables WHERE (owner NOT IN (" + systemOwners + ") OR owner = USER) " +
			"AND table_name NOT LIKE '%$%' ORDER BY owner, table_name"
	case "dm":
		// 达梦：使用 ALL_TABLES 返回所有有权限访问的模式下的表
		// 排除达梦内置系统模式，保留用户创建的模式（如 SYSDBA 等）
		return "SELECT OWNER, TABLE_NAME FROM ALL_TABLES WHERE OWNER NOT IN ('SYS','SYSSSO','SYSAUDITOR') ORDER BY OWNER, TABLE_NAME"
	case "sqlite":
		return "SELECT name FROM sqlite_master WHERE type='table'"
	case "duckdb":
		return "SELECT name FROM sqlite_master WHERE type='table'"
	case "clickhouse":
		return "SHOW TABLES"
	default:
		return "SHOW TABLES"
	}
}

// getTableComments 获取表备注（MySQL 和 SQLite 支持）

func getTableComments(db *sql.DB, config *DatabaseConfig, tableNames []string) map[string]string {
	comments := make(map[string]string)
	if len(tableNames) == 0 {
		return comments
	}

	switch config.Type {
	case "mysql", "mariadb", "tidb":
		// MySQL: 从 information_schema.TABLES 获取表备注
		query := `
			SELECT TABLE_NAME, TABLE_COMMENT
			FROM information_schema.TABLES
			WHERE TABLE_SCHEMA = ?`
		rows, err := db.Query(query, config.Database)
		if err != nil {
			log.Printf("查询 MySQL 表备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var tableName, tableComment string
			if err := rows.Scan(&tableName, &tableComment); err == nil {
				if tableComment != "" {
					comments[tableName] = tableComment
				}
			}
		}
	case "sqlite", "duckdb":
		// SQLite: 从 sqlite_master 的 sql 字段解析备注
		// SQLite 本身不支持表备注，但可以解析 CREATE TABLE 语句中的注释
		for _, tableName := range tableNames {
			quotedTable, _ := safeQuoteIdentifier(tableName, config.Type)
			query := fmt.Sprintf("SELECT sql FROM sqlite_master WHERE type='table' AND name=%s", quotedTable)
			var sqlStr string
			err := db.QueryRow(query).Scan(&sqlStr)
			if err == nil && sqlStr != "" {
				// 尝试从 SQL 中提取注释（如果有）
				comment := extractSQLiteComment(sqlStr)
				if comment != "" {
					comments[tableName] = comment
				}
			}
		}
	case "postgresql", "timescaledb", "cockroachdb":
		// PostgreSQL: 从 pg_class 和 pg_description 获取表备注
		query := `
			SELECT c.relname, d.description
			FROM pg_class c
			JOIN pg_namespace n ON c.relnamespace = n.oid
			LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = 0
			WHERE n.nspname = 'public' AND c.relkind = 'r'`
		rows, err := db.Query(query)
		if err != nil {
			log.Printf("查询 PostgreSQL 表备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var tableName, tableComment string
			if err := rows.Scan(&tableName, &tableComment); err == nil {
				if tableComment != "" {
					comments[tableName] = tableComment
				}
			}
		}
	case "oracle":
		// Oracle: 从 ALL_TAB_COMMENTS 获取表备注
		query := "SELECT TABLE_NAME, COMMENTS FROM USER_TAB_COMMENTS WHERE TABLE_TYPE = 'TABLE'"
		rows, err := db.Query(query)
		if err != nil {
			log.Printf("查询 Oracle 表备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var tableName, tableComment sql.NullString
			if err := rows.Scan(&tableName, &tableComment); err == nil {
				if tableName.Valid && tableComment.Valid && tableComment.String != "" {
					comments[tableName.String] = tableComment.String
				}
			}
		}
	case "dm":
		// 达梦: 从 USER_TAB_COMMENTS 获取表备注
		query := "SELECT TABLE_NAME, COMMENTS FROM USER_TAB_COMMENTS"
		rows, err := db.Query(query)
		if err != nil {
			log.Printf("查询达梦表备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var tableName, tableComment sql.NullString
			if err := rows.Scan(&tableName, &tableComment); err == nil {
				if tableName.Valid && tableComment.Valid && tableComment.String != "" {
					comments[tableName.String] = tableComment.String
				}
			}
		}
	case "sqlserver":
		// SQL Server: 从 sys.extended_properties 获取表备注
		query := `
			SELECT OBJECT_NAME(t.object_id) AS table_name, ep.value AS table_comment
			FROM sys.tables t
			LEFT JOIN sys.extended_properties ep ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
			WHERE SCHEMA_NAME(t.schema_id) = 'dbo'`
		rows, err := db.Query(query)
		if err != nil {
			log.Printf("查询 SQL Server 表备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var tableName, tableComment sql.NullString
			if err := rows.Scan(&tableName, &tableComment); err == nil {
				if tableName.Valid && tableComment.Valid && tableComment.String != "" {
					comments[tableName.String] = tableComment.String
				}
			}
		}
	}
	return comments
}

// extractSQLiteComment 从 SQLite CREATE TABLE 语句中提取注释

func extractSQLiteComment(sqlStr string) string {
	// 查找 /* */ 格式的注释
	if idx := strings.Index(sqlStr, "/*"); idx != -1 {
		if endIdx := strings.Index(sqlStr[idx:], "*/"); endIdx != -1 {
			comment := strings.TrimSpace(sqlStr[idx+2 : idx+endIdx])
			return comment
		}
	}
	// 查找 -- 格式的注释
	lines := strings.Split(sqlStr, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "--") {
			return strings.TrimSpace(line[2:])
		}
	}
	return ""
}

// getTablePKs 获取表的主键字段

func getTablePKs(db *sql.DB, config *DatabaseConfig, tableName string) []string {
	var pkColumns []string

	switch config.Type {
	case "dm", "oracle":
		// 达梦/Oracle: 从 USER_CONSTRAINTS + USER_CONS_COLUMNS 获取主键
		query := `
			SELECT cc.COLUMN_NAME
			FROM USER_CONSTRAINTS c
			JOIN USER_CONS_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
			WHERE c.TABLE_NAME = ? AND c.CONSTRAINT_TYPE = 'P'
			ORDER BY cc.POSITION`
		rows, err := db.Query(query, tableName)
		if err != nil {
			log.Printf("查询主键失败: %v", err)
			return pkColumns
		}
		defer rows.Close()
		for rows.Next() {
			var colName string
			if err := rows.Scan(&colName); err == nil {
				pkColumns = append(pkColumns, colName)
			}
		}
	case "mysql", "mariadb", "tidb":
		// MySQL: SHOW COLUMNS 的 Key 列包含 PRI
		quotedTable, _ := safeQuoteIdentifier(tableName, config.Type)
		query := fmt.Sprintf("SHOW COLUMNS FROM %s", quotedTable)
		rows, err := db.Query(query)
		if err != nil {
			return pkColumns
		}
		defer rows.Close()
		for rows.Next() {
			var field, typeStr, null, key, defaultVal, extra sql.NullString
			if err := rows.Scan(&field, &typeStr, &null, &key, &defaultVal, &extra); err == nil {
				if key.Valid && key.String == "PRI" && field.Valid {
					pkColumns = append(pkColumns, field.String)
				}
			}
		}
	}
	return pkColumns
}

// getTableFKs 获取表的外键信息

func getTableFKs(db *sql.DB, config *DatabaseConfig, tableName string) map[string]string {
	fkMap := make(map[string]string) // column_name -> referenced_table

	switch config.Type {
	case "dm", "oracle":
		// 达梦/Oracle: 从 USER_CONSTRAINTS + USER_CONS_COLUMNS 获取外键
		// 需要两次 JOIN: 第一次获取外键列，第二次通过 R_CONSTRAINT_NAME 获取被引用表名
		query := `
			SELECT cc.COLUMN_NAME, r.TABLE_NAME
			FROM USER_CONSTRAINTS c
			JOIN USER_CONS_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
			JOIN USER_CONSTRAINTS r ON c.R_CONSTRAINT_NAME = r.CONSTRAINT_NAME
			WHERE c.TABLE_NAME = ? AND c.CONSTRAINT_TYPE = 'R'`
		rows, err := db.Query(query, tableName)
		if err != nil {
			log.Printf("查询外键失败: %v", err)
			return fkMap
		}
		defer rows.Close()
		for rows.Next() {
			var colName, refTable sql.NullString
			if err := rows.Scan(&colName, &refTable); err == nil {
				if colName.Valid && refTable.Valid {
					fkMap[colName.String] = refTable.String
				}
			}
		}
	}
	return fkMap
}

// getTableInfoList 获取数据库所有表的信息（表名、注释、字段名列表），用于检索

func getTableInfoList(dbConfig *DatabaseConfig) ([]TableInfo, error) {
	// 获取表名列表
	tableNames, err := getTablesList(dbConfig)
	if err != nil {
		return nil, err
	}

	if len(tableNames) == 0 {
		return []TableInfo{}, nil
	}

	// 获取数据库连接（用于获取表注释）
	db, err := getDBFromPool(dbConfig)
	if err != nil {
		return nil, err
	}

	// 获取表注释
	tableComments := getTableComments(db, dbConfig, tableNames)

	// 构建表信息列表
	var tableInfos []TableInfo
	for _, tableName := range tableNames {
		info := TableInfo{
			Name:    tableName,
			Comment: tableComments[tableName],
		}

		// 获取字段完整信息
		columns, err := getTableColumns(dbConfig, tableName)
		if err == nil {
			var colNames []string
			var colInfos []ColumnInfo

			// 获取字段注释、主键、外键信息
			colComments := getColumnComments(db, dbConfig, tableName)
			pkColumns := getTablePKs(db, dbConfig, tableName)
			fkMap := getTableFKs(db, dbConfig, tableName)
			pkSet := make(map[string]bool)
			for _, pk := range pkColumns {
				pkSet[pk] = true
			}

			for _, col := range columns {
				if colName, ok := col["name"].(string); ok {
					colNames = append(colNames, colName)
					colInfo := ColumnInfo{
						Name:    colName,
						Comment: colComments[colName],
						IsPK:    pkSet[colName],
					}
					if colType, ok := col["type"].(string); ok {
						colInfo.Type = colType
					}
					if fkTable, exists := fkMap[colName]; exists {
						colInfo.IsFK = true
						colInfo.FKTable = fkTable
					}
					colInfos = append(colInfos, colInfo)
				}
			}
			info.ColumnNames = colNames
			info.Columns = colInfos
		}

		tableInfos = append(tableInfos, info)
	}

	return tableInfos, nil
}

// tokenizeQuery 对查询字符串进行简单分词（空格分隔 + 中文字符单独提取）

func tokenizeQuery(query string) []string {
	var tokens []string
	var chineseBuf strings.Builder

	// 先按空格分割
	parts := strings.Fields(query)

	for _, part := range parts {
		// 对每个部分，提取中文字符
		for _, r := range part {
			if unicode.Is(unicode.Han, r) {
				chineseBuf.WriteRune(r)
			}
		}
		// 如果有中文字符，添加为单独的 token
		if chineseBuf.Len() > 0 {
			tokens = append(tokens, chineseBuf.String())
			chineseBuf.Reset()
		}
		// 非中文部分也作为 token（转小写）
		partLower := strings.ToLower(part)
		if partLower != "" && !isAllChinese(partLower) {
			tokens = append(tokens, partLower)
		}
	}

	// 去重
	seen := make(map[string]bool)
	var result []string
	for _, t := range tokens {
		if !seen[t] {
			seen[t] = true
			result = append(result, t)
		}
	}

	return result
}

// isAllChinese 检查字符串是否全是中文字符

func isAllChinese(s string) bool {
	for _, r := range s {
		if !unicode.Is(unicode.Han, r) {
			return false
		}
	}
	return len(s) > 0
}

// keywordRetrieveTables 关键词检索算法

func keywordRetrieveTables(query string, tables []TableInfo, config *KeywordRetrievalConfig) []TableRelevanceResult {
	// 分词
	keywords := tokenizeQuery(query)
	if len(keywords) == 0 {
		return []TableRelevanceResult{}
	}

	// 默认匹配字段
	matchFields := []string{"name", "comment", "column_names"}
	if config != nil && len(config.MatchFields) > 0 {
		matchFields = config.MatchFields
	}

	// 检查是否匹配各字段
	matchName := false
	matchComment := false
	matchColumns := false
	for _, f := range matchFields {
		switch f {
		case "name":
			matchName = true
		case "comment":
			matchComment = true
		case "column_names":
			matchColumns = true
		}
	}

	var results []TableRelevanceResult

	for _, table := range tables {
		tableNameLower := strings.ToLower(table.Name)
		tableCommentLower := strings.ToLower(table.Comment)

		// 记录每个关键词的最高分数
		keywordScores := make([]float64, len(keywords))
		matchReasons := make([]string, len(keywords))

		for i, keyword := range keywords {
			keywordLower := strings.ToLower(keyword)
			var maxScore float64
			var reason string

			// 表名完全匹配
			if matchName && tableNameLower == keywordLower {
				maxScore = 1.0
				reason = fmt.Sprintf("表名完全匹配 '%s'", keyword)
			}

			// 表名包含关键词
			if matchName && maxScore < 0.8 && strings.Contains(tableNameLower, keywordLower) {
				maxScore = 0.8
				reason = fmt.Sprintf("表名包含 '%s'", keyword)
			}

			// 注释包含关键词
			if matchComment && maxScore < 0.6 && tableCommentLower != "" && strings.Contains(tableCommentLower, keywordLower) {
				maxScore = 0.6
				reason = fmt.Sprintf("表注释包含 '%s'", keyword)
			}

			// 字段名包含关键词
			if matchColumns && maxScore < 0.4 {
				for _, colName := range table.ColumnNames {
					if strings.Contains(strings.ToLower(colName), keywordLower) {
						maxScore = 0.4
						reason = fmt.Sprintf("字段名包含 '%s'", keyword)
						break
					}
				}
			}

			keywordScores[i] = maxScore
			matchReasons[i] = reason
		}

		// 计算最终分数：最大匹配分 * 关键词覆盖率
		var maxScore float64
		var matchedCount int
		var bestReason string

		for i, score := range keywordScores {
			if score > 0 {
				matchedCount++
				if score > maxScore {
					maxScore = score
					bestReason = matchReasons[i]
				}
			}
		}

		if maxScore > 0 {
			coverage := float64(matchedCount) / float64(len(keywords))
			finalScore := maxScore * (0.5 + 0.5*coverage) // 基础分 + 覆盖率加成

			results = append(results, TableRelevanceResult{
				TableName:      table.Name,
				RelevanceScore: finalScore,
				MatchReason:    bestReason,
			})
		}
	}

	// 按分数降序排序
	sort.Slice(results, func(i, j int) bool {
		return results[i].RelevanceScore > results[j].RelevanceScore
	})

	return results
}

// mergeRetrievalResults 合并关键词和向量检索结果（加权平均）

func mergeRetrievalResults(keywordResults, vectorResults []TableRelevanceResult, keywordWeight, vectorWeight float64) []TableRelevanceResult {
	// 用 map 存储每个表的加权分数
	scoreMap := make(map[string]float64)

	// 加权关键词结果
	for _, r := range keywordResults {
		scoreMap[r.TableName] += r.RelevanceScore * keywordWeight
	}

	// 加权向量结果
	for _, r := range vectorResults {
		scoreMap[r.TableName] += r.RelevanceScore * vectorWeight
	}

	// 转换为结果列表
	results := make([]TableRelevanceResult, 0, len(scoreMap))
	for tableName, score := range scoreMap {
		results = append(results, TableRelevanceResult{
			TableName:      tableName,
			RelevanceScore: score,
			MatchReason:    "混合检索",
		})
	}

	// 按分数降序排序
	sort.Slice(results, func(i, j int) bool {
		return results[i].RelevanceScore > results[j].RelevanceScore
	})

	return results
}

// mergeRetrievalResults3 三路合并检索结果（关键词 + 向量 + Graph，加权平均）

func mergeRetrievalResults3(keywordResults, vectorResults, graphResults []TableRelevanceResult, keywordWeight, vectorWeight, graphWeight float64) []TableRelevanceResult {
	// 用 map 存储每个表的加权分数和来源
	type scoreEntry struct {
		score   float64
		sources []string
	}
	scoreMap := make(map[string]*scoreEntry)

	ensure := func(tableName string) {
		if _, ok := scoreMap[tableName]; !ok {
			scoreMap[tableName] = &scoreEntry{sources: []string{}}
		}
	}

	// 加权关键词结果
	for _, r := range keywordResults {
		ensure(r.TableName)
		scoreMap[r.TableName].score += r.RelevanceScore * keywordWeight
		scoreMap[r.TableName].sources = append(scoreMap[r.TableName].sources, "关键词")
	}

	// 加权向量结果
	for _, r := range vectorResults {
		ensure(r.TableName)
		scoreMap[r.TableName].score += r.RelevanceScore * vectorWeight
		scoreMap[r.TableName].sources = append(scoreMap[r.TableName].sources, "向量")
	}

	// 加权 Graph 结果
	for _, r := range graphResults {
		ensure(r.TableName)
		scoreMap[r.TableName].score += r.RelevanceScore * graphWeight
		scoreMap[r.TableName].sources = append(scoreMap[r.TableName].sources, "关系扩展")
	}

	// 转换为结果列表
	results := make([]TableRelevanceResult, 0, len(scoreMap))
	for tableName, entry := range scoreMap {
		reason := strings.Join(uniqueStrings(entry.sources), "+")
		results = append(results, TableRelevanceResult{
			TableName:      tableName,
			RelevanceScore: entry.score,
			MatchReason:    reason,
		})
	}

	// 按分数降序排序
	sort.Slice(results, func(i, j int) bool {
		return results[i].RelevanceScore > results[j].RelevanceScore
	})

	return results
}

// uniqueStrings 去重字符串切片

func uniqueStrings(ss []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0)
	for _, s := range ss {
		if !seen[s] {
			seen[s] = true
			result = append(result, s)
		}
	}
	return result
}

// retrieveRelevantTables 主检索函数

func retrieveRelevantTables(query string, dbConfig *DatabaseConfig, config *TableRetrievalConfig) ([]TableRelevanceResult, error) {
	// 默认配置
	strategy := "keyword"
	maxTables := 15
	minRelevanceScore := 0.3
	var keywordConfig *KeywordRetrievalConfig
	vectorWeight := 0.5
	keywordWeight := 0.5

	if config != nil {
		if config.Strategy != "" {
			strategy = config.Strategy
		}
		if config.MaxTables > 0 {
			maxTables = config.MaxTables
		}
		if config.MinRelevanceScore > 0 {
			minRelevanceScore = config.MinRelevanceScore
		}
		keywordConfig = config.KeywordConfig
		if config.VectorWeight > 0 {
			vectorWeight = config.VectorWeight
		}
		if config.KeywordWeight > 0 {
			keywordWeight = config.KeywordWeight
		}
	}

	// 获取 embedding 配置
	var embeddingConfig EmbeddingRetrievalConfig
	if dataOntologyAIConfig != nil {
		embeddingConfig = dataOntologyAIConfig.Embedding
	}

	manager := getFTS5Manager()

	// 尝试使用 FTS5 检索（优先使用 SQLite FTS5 索引，大幅提升 3 万+表检索性能）
	if manager != nil {
		// 根据策略选择检索方法
		var results []TableRelevanceResult

		switch strategy {
		case "embedding":
			// 纯向量检索
			if embeddingConfig.Enabled && embeddingConfig.URL != "" {
				vectorResults, err := manager.vectorRetrieveTables(query, dbConfig.ID, maxTables*2, embeddingConfig)
				if err == nil && len(vectorResults) > 0 {
					results = vectorResults
				} else {
					log.Printf("[表检索] 向量检索失败，降级为 FTS5 关键词检索: %v", err)
					ftsResults, err := manager.fts5RetrieveTables(query, dbConfig.ID, maxTables*2)
					if err == nil && len(ftsResults) > 0 {
						results = ftsResults
					}
				}
			} else {
				log.Printf("[表检索] embedding 未配置，降级为 FTS5 关键词检索")
				ftsResults, err := manager.fts5RetrieveTables(query, dbConfig.ID, maxTables*2)
				if err == nil && len(ftsResults) > 0 {
					results = ftsResults
				}
			}

		case "graph":
			// 纯 Graph 关系扩展：先用关键词找种子表，再沿关系图扩展
			graphMaxDepth := 2 // 默认深度
			if config != nil && config.GraphConfig != nil && config.GraphConfig.MaxDepth > 0 {
				graphMaxDepth = config.GraphConfig.MaxDepth
			}
			ftsResults, _ := manager.fts5RetrieveTables(query, dbConfig.ID, maxTables)
			seedTables := make([]string, 0, len(ftsResults))
			for _, r := range ftsResults {
				seedTables = append(seedTables, r.TableName)
			}
			if len(seedTables) > 0 {
				graphResults, err := manager.graphRetrieveTables(seedTables, dbConfig.ID, graphMaxDepth, maxTables)
				if err == nil && len(graphResults) > 0 {
					results = graphResults
				} else {
					results = ftsResults
				}
			} else {
				results = ftsResults
			}

		case "hybrid":
			// 混合检索：关键词 + 向量 + Graph
			ftsResults, _ := manager.fts5RetrieveTables(query, dbConfig.ID, maxTables*2)
			var vectorResults []TableRelevanceResult
			if embeddingConfig.Enabled && embeddingConfig.URL != "" {
				vectorResults, _ = manager.vectorRetrieveTables(query, dbConfig.ID, maxTables*2, embeddingConfig)
			}

			// 从关键词和向量结果中取种子，用 Graph 扩展关联表
			seedTables := make(map[string]bool)
			graphWeight := 0.3 // Graph 默认权重
			graphMaxDepth := 2 // Graph 默认深度
			if config != nil {
				if config.GraphWeight > 0 {
					graphWeight = config.GraphWeight
				}
				if config.GraphConfig != nil && config.GraphConfig.MaxDepth > 0 {
					graphMaxDepth = config.GraphConfig.MaxDepth
				}
			}
			for _, r := range ftsResults {
				seedTables[r.TableName] = true
			}
			for _, r := range vectorResults {
				seedTables[r.TableName] = true
			}
			var graphResults []TableRelevanceResult
			seedList := make([]string, 0, len(seedTables))
			for t := range seedTables {
				seedList = append(seedList, t)
			}
			if len(seedList) > 0 {
				graphResults, _ = manager.graphRetrieveTables(seedList, dbConfig.ID, graphMaxDepth, maxTables*2)
			}

			// 三路合并（加权平均）
			results = mergeRetrievalResults3(ftsResults, vectorResults, graphResults, keywordWeight, vectorWeight, graphWeight)

		case "full":
			// 全量检索：返回所有表，不进行筛选
			tableInfos, err := getTableInfoList(dbConfig)
			if err != nil {
				return nil, err
			}
			results = make([]TableRelevanceResult, len(tableInfos))
			for i, t := range tableInfos {
				results[i] = TableRelevanceResult{
					TableName:      t.Name,
					RelevanceScore: 1.0, // 全量检索时所有表都相关
					MatchReason:    "全量检索",
				}
			}
			return results, nil

		default: // "keyword"
			ftsResults, err := manager.fts5RetrieveTables(query, dbConfig.ID, maxTables*2)
			if err == nil && len(ftsResults) > 0 {
				results = ftsResults
			}
		}

		// 过滤低分结果
		var filteredResults []TableRelevanceResult
		for _, r := range results {
			if r.RelevanceScore >= minRelevanceScore {
				filteredResults = append(filteredResults, r)
			}
		}
		// 限制返回数量
		if len(filteredResults) > maxTables {
			filteredResults = filteredResults[:maxTables]
		}
		return filteredResults, nil
	}

	// 降级方案：从数据库实时获取所有表信息，使用内存检索
	tableInfos, err := getTableInfoList(dbConfig)
	if err != nil {
		return nil, err
	}

	// 根据策略选择检索方法
	var results []TableRelevanceResult

	switch strategy {
	case "embedding":
		log.Printf("[表检索] embedding 策略需要 FTS5Manager，降级为 keyword 策略")
		results = keywordRetrieveTables(query, tableInfos, keywordConfig)
	case "graph":
		log.Printf("[表检索] graph 策略需要 FTS5Manager，降级为 keyword 策略")
		results = keywordRetrieveTables(query, tableInfos, keywordConfig)
	case "hybrid":
		log.Printf("[表检索] hybrid 策略需要 FTS5Manager，降级为 keyword 策略")
		results = keywordRetrieveTables(query, tableInfos, keywordConfig)
	default: // "keyword"
		results = keywordRetrieveTables(query, tableInfos, keywordConfig)
	}

	// 过滤低分结果
	var filteredResults []TableRelevanceResult
	for _, r := range results {
		if r.RelevanceScore >= minRelevanceScore {
			filteredResults = append(filteredResults, r)
		}
	}

	// 限制返回数量
	if len(filteredResults) > maxTables {
		filteredResults = filteredResults[:maxTables]
	}

	return filteredResults, nil
}

// getColumnComments 获取字段备注

func getColumnComments(db *sql.DB, config *DatabaseConfig, tableName string) map[string]string {
	comments := make(map[string]string)

	switch config.Type {
	case "mysql", "mariadb", "tidb":
		// MySQL: 从 information_schema.COLUMNS 获取字段备注
		query := `
			SELECT COLUMN_NAME, COLUMN_COMMENT
			FROM information_schema.COLUMNS
			WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`
		rows, err := db.Query(query, config.Database, tableName)
		if err != nil {
			log.Printf("查询 MySQL 字段备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var colName, colComment string
			if err := rows.Scan(&colName, &colComment); err == nil {
				if colComment != "" {
					comments[colName] = colComment
				}
			}
		}
	case "postgresql", "timescaledb", "cockroachdb":
		// PostgreSQL: 从 pg_description 获取字段备注
		query := `
			SELECT a.attname, d.description
			FROM pg_attribute a
			JOIN pg_class c ON a.attrelid = c.oid
			JOIN pg_namespace n ON c.relnamespace = n.oid
			LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
			WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped`
		rows, err := db.Query(query, tableName)
		if err != nil {
			log.Printf("查询 PostgreSQL 字段备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var colName, colComment string
			if err := rows.Scan(&colName, &colComment); err == nil {
				if colComment != "" {
					comments[colName] = colComment
				}
			}
		}
	case "oracle":
		// Oracle: 从 USER_COL_COMMENTS 获取字段备注
		query := "SELECT COLUMN_NAME, COMMENTS FROM USER_COL_COMMENTS WHERE TABLE_NAME = :1"
		rows, err := db.Query(query, strings.ToUpper(tableName))
		if err != nil {
			log.Printf("查询 Oracle 字段备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var colName, colComment sql.NullString
			if err := rows.Scan(&colName, &colComment); err == nil {
				if colName.Valid && colComment.Valid && colComment.String != "" {
					comments[colName.String] = colComment.String
				}
			}
		}
	case "dm":
		// 达梦: 从 USER_COL_COMMENTS 获取字段备注
		query := "SELECT COLUMN_NAME, COMMENTS FROM USER_COL_COMMENTS WHERE TABLE_NAME = ?"
		rows, err := db.Query(query, strings.ToUpper(tableName))
		if err != nil {
			log.Printf("查询达梦字段备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var colName, colComment sql.NullString
			if err := rows.Scan(&colName, &colComment); err == nil {
				if colName.Valid && colComment.Valid && colComment.String != "" {
					comments[colName.String] = colComment.String
				}
			} else {
			}
		}
	case "sqlserver":
		// SQL Server: 从 sys.extended_properties 获取字段备注
		query := `
			SELECT c.name AS column_name, ep.value AS column_comment
			FROM sys.columns c
			JOIN sys.tables t ON c.object_id = t.object_id
			LEFT JOIN sys.extended_properties ep ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'
			WHERE SCHEMA_NAME(t.schema_id) = 'dbo' AND t.name = @p1`
		rows, err := db.Query(query, tableName)
		if err != nil {
			log.Printf("查询 SQL Server 字段备注失败: %v", err)
			return comments
		}
		defer rows.Close()
		for rows.Next() {
			var colName, colComment sql.NullString
			if err := rows.Scan(&colName, &colComment); err == nil {
				if colName.Valid && colComment.Valid && colComment.String != "" {
					comments[colName.String] = colComment.String
				}
			}
		}
	}
	return comments
}

// buildMongoURI 构建 MongoDB 连接 URI，自动检测是否为 Atlas

func buildMongoURI(config *DatabaseConfig) string {
	// 检查是否为 MongoDB Atlas（包含 .mongodb.net）
	if strings.Contains(config.Host, ".mongodb.net") {
		// MongoDB Atlas 使用 SRV 连接格式，不需要端口号
		uri := fmt.Sprintf("mongodb+srv://%s:%s@%s/%s?retryWrites=true&w=majority",
			url.QueryEscape(config.User),
			url.QueryEscape(config.Password),
			config.Host,
			config.Database)
		return uri
	}
	// 标准 MongoDB 连接格式
	return fmt.Sprintf("mongodb://%s:%s@%s:%d/%s",
		url.QueryEscape(config.User),
		url.QueryEscape(config.Password),
		config.Host,
		config.Port,
		config.Database)
}

// getTablesList 获取数据库表列表

func getTablesList(config *DatabaseConfig) ([]string, error) {
	var tables []string

	// MongoDB 特殊处理
	if config.Type == "mongodb" {
		uri := buildMongoURI(config)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
		if err != nil {
			return nil, err
		}
		defer client.Disconnect(ctx)

		db := client.Database(config.Database)
		collections, err := db.ListCollectionNames(ctx, bson.M{})
		if err != nil {
			return nil, err
		}
		return collections, nil
	}

	// Redis 不支持表列表
	if config.Type == "redis" {
		return []string{"DB 0", "DB 1", "DB 2", "DB 3", "DB 4", "DB 5"}, nil
	}

	// 其他NoSQL数据库暂不支持
	if config.Type == "neo4j" || config.Type == "elasticsearch" ||
		config.Type == "influxdb" || config.Type == "memcached" ||
		config.Type == "cassandra" || config.Type == "hbase" {
		return []string{}, nil
	}

	// SQL数据库通用处理 - 使用连接池
	db, err := getDBFromPool(config)
	if err != nil {
		return nil, err
	}
	// 注意：不再 defer db.Close()，因为连接池管理连接生命周期

	// 获取表列表
	query := getTablesQuery(config)
	rows, err := db.Query(query)
	if err != nil && config.Type == "oracle" {
		// 无 ALL_TABLES 权限时回退到 USER_TABLES（仅当前 schema，加表名过滤）
		fallback := "SELECT table_name FROM user_tables WHERE table_name NOT LIKE '%$%' " +
			"AND table_name NOT LIKE 'ALL\\_%' ESCAPE '\\' AND table_name NOT LIKE 'DBA\\_%' ESCAPE '\\' " +
			"AND table_name NOT LIKE 'AQ\\_%' ESCAPE '\\' AND table_name NOT LIKE 'DBMS\\_%' ESCAPE '\\' " +
			"AND table_name <> 'DUAL' ORDER BY table_name"
		rows, err = db.Query(fallback)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err == nil {
			tables = append(tables, tableName)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// 达梦：过滤系统表，只保留用户表
	if config.Type == "dm" {
		filtered := make([]string, 0, len(tables))
		for _, t := range tables {
			if strings.HasPrefix(t, "##") || strings.HasPrefix(t, "AQ$_") || strings.HasPrefix(t, "SYS$") ||
				strings.HasPrefix(t, "DBMS_") || strings.HasPrefix(t, "REG$") || t == "POLICIES" || strings.HasPrefix(t, "POLICY_") {
				continue
			}
			filtered = append(filtered, t)
		}
		tables = filtered
	}

	if tables == nil {
		tables = []string{}
	}

	return tables, nil
}

// oracleEscapeIdentifier 安全转义 Oracle/DM 标识符用于 SQL 字符串字面量
// 标识符已通过 isValidIdentifierWithSchema 验证，这里只需转义单引号

func oracleEscapeIdentifier(name string) string {
	return strings.ReplaceAll(strings.ToUpper(name), "'", "''")
}

// oracleTableColumnsSQL 返回 Oracle 查询表列的 SQL，支持 owner.table 形式

func oracleTableColumnsSQL(tableName string, withDefault bool) string {
	sel := "SELECT COLUMN_NAME, DATA_TYPE, NULLABLE"
	if withDefault {
		sel = "SELECT COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_DEFAULT"
	}
	// 处理 owner.table 形式
	if idx := strings.Index(tableName, "."); idx >= 0 {
		owner := oracleEscapeIdentifier(tableName[:idx])
		tblPart := oracleEscapeIdentifier(tableName[idx+1:])
		return fmt.Sprintf("%s FROM ALL_TAB_COLUMNS WHERE OWNER = '%s' AND TABLE_NAME = '%s' ORDER BY COLUMN_ID", sel, owner, tblPart)
	}
	tableEsc := oracleEscapeIdentifier(tableName)
	return fmt.Sprintf("%s FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", sel, tableEsc)
}

// getTableColumns 获取表的字段信息

func getTableColumns(config *DatabaseConfig, tableName string) ([]map[string]interface{}, error) {
	var columns []map[string]interface{}

	// 安全验证：检查表名是否合法，防止 SQL 注入
	if !isValidIdentifierWithSchema(tableName) {
		return nil, fmt.Errorf("无效的表名: %s", tableName)
	}

	// MongoDB 特殊处理 - 通过采样文档推断字段
	if config.Type == "mongodb" {
		uri := buildMongoURI(config)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
		if err != nil {
			return nil, err
		}
		defer client.Disconnect(ctx)

		collection := client.Database(config.Database).Collection(tableName)

		// 采样一个文档来推断字段
		var sample bson.M
		err = collection.FindOne(ctx, bson.M{}).Decode(&sample)
		if err != nil {
			if err == mongo.ErrNoDocuments {
				return []map[string]interface{}{}, nil
			}
			return nil, err
		}

		for key, value := range sample {
			columns = append(columns, map[string]interface{}{
				"name": key,
				"type": fmt.Sprintf("%T", value),
			})
		}
		return columns, nil
	}

	// Redis、Neo4j等NoSQL不支持
	if config.Type == "redis" || config.Type == "neo4j" || config.Type == "elasticsearch" ||
		config.Type == "influxdb" || config.Type == "memcached" ||
		config.Type == "cassandra" || config.Type == "hbase" {
		return []map[string]interface{}{}, nil
	}

	// SQL数据库通用处理 - 使用连接池
	db, err := getDBFromPool(config)
	if err != nil {
		return nil, err
	}

	var query string
	switch config.Type {
	case "mysql", "mariadb", "tidb":
		quotedTable, _ := safeQuoteIdentifier(tableName, config.Type)
		query = fmt.Sprintf("SHOW FULL COLUMNS FROM %s", quotedTable)
	case "postgresql", "timescaledb", "cockroachdb":
		// 使用参数化查询代替字符串拼接，包含注释
		query = "SELECT column_name, data_type, col_description((SELECT oid FROM pg_class WHERE relname = $1), ordinal_position) AS comment FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position"
	case "sqlserver":
		query = "SELECT COLUMN_NAME, DATA_TYPE, CAST(ep.value AS NVARCHAR(500)) AS COMMENT FROM INFORMATION_SCHEMA.COLUMNS c LEFT JOIN sys.extended_properties ep ON ep.major_id = OBJECT_ID(c.TABLE_NAME) AND ep.minor_id = c.ORDINAL_POSITION AND ep.name = 'MS_Description' WHERE c.TABLE_NAME = @p1 ORDER BY c.ORDINAL_POSITION"
	case "sqlite", "duckdb":
		quotedTable, _ := safeQuoteIdentifier(tableName, config.Type)
		query = fmt.Sprintf("PRAGMA table_info(%s)", quotedTable)
	case "oracle":
		// Oracle DATA_DEFAULT 是 LONG 类型，go-ora 无法 Scan，只查 3 列；注释从 ALL_COL_COMMENTS 获取
		tbl := tableName
		if idx := strings.Index(tbl, "."); idx >= 0 {
			tbl = tbl[idx+1:]
		}
		query = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", oracleEscapeIdentifier(tbl))
	case "dm":
		query = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s' ORDER BY COLUMN_ID", oracleEscapeIdentifier(tableName))
	case "clickhouse":
		quotedTable, _ := safeQuoteIdentifier(tableName, config.Type)
		query = fmt.Sprintf("DESCRIBE TABLE %s", quotedTable)
	default:
		return nil, fmt.Errorf("不支持的数据库类型: %s", config.Type)
	}

	var rows *sql.Rows
	if config.Type == "postgresql" || config.Type == "timescaledb" || config.Type == "cockroachdb" {
		rows, err = db.Query(query, tableName)
	} else if config.Type == "sqlserver" {
		rows, err = db.Query(query, tableName)
	} else {
		rows, err = db.Query(query)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// 获取列信息
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	for rows.Next() {
		values := make([]interface{}, len(cols))
		valuePtrs := make([]interface{}, len(cols))
		for i := range values {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			continue
		}

		var colName, colType, colComment string

		// 根据不同数据库类型解析列信息
		switch config.Type {
		case "mysql", "mariadb", "tidb":
			// SHOW FULL COLUMNS: Field, Type, Collation, Null, Key, Default, Extra, Privileges, Comment
			if len(values) >= 2 {
				if v, ok := values[0].([]byte); ok {
					colName = string(v)
				}
				if v, ok := values[1].([]byte); ok {
					colType = string(v)
				}
			}
			// 提取 Extra 字段中的 auto_increment 标记
			if len(values) >= 7 {
				extra := ""
				if v, ok := values[6].([]byte); ok {
					extra = string(v)
				} else if v, ok := values[6].(string); ok {
					extra = v
				}
				if strings.Contains(strings.ToLower(extra), "auto_increment") {
					colType += " [AUTO_INCREMENT]"
				}
			}
			// 提取 Comment 字段（SHOW FULL COLUMNS 第9列，索引8）
			if len(values) >= 9 {
				if v, ok := values[8].([]byte); ok {
					colComment = string(v)
				} else if v, ok := values[8].(string); ok {
					colComment = v
				}
			}
		case "sqlite", "duckdb":
			// PRAGMA table_info: cid, name, type, notnull, dflt_value, pk
			if len(values) >= 3 {
				if v, ok := values[1].(string); ok {
					colName = v
				} else if v, ok := values[1].([]byte); ok {
					colName = string(v)
				}
				if v, ok := values[2].(string); ok {
					colType = v
				} else if v, ok := values[2].([]byte); ok {
					colType = string(v)
				}
			}
		case "clickhouse":
			// DESCRIBE TABLE: name, type, default_type, default_expression, comment, codec_expression, ttl_expression
			if len(values) >= 2 {
				if v, ok := values[0].(string); ok {
					colName = v
				} else if v, ok := values[0].([]byte); ok {
					colName = string(v)
				}
				if v, ok := values[1].(string); ok {
					colType = v
				} else if v, ok := values[1].([]byte); ok {
					colType = string(v)
				}
			}
			// 提取 comment 字段（第5列，索引4）
			if len(values) >= 5 {
				if v, ok := values[4].(string); ok {
					colComment = v
				} else if v, ok := values[4].([]byte); ok {
					colComment = string(v)
				}
			}
		default:
			// information_schema.columns / user_tab_columns（可能含第3列 comment）
			if len(values) >= 2 {
				if v, ok := values[0].(string); ok {
					colName = v
				} else if v, ok := values[0].([]byte); ok {
					colName = string(v)
				}
				if v, ok := values[1].(string); ok {
					colType = v
				} else if v, ok := values[1].([]byte); ok {
					colType = string(v)
				}
			}
			// 提取 comment 字段（PostgreSQL/SQLServer 查询的第3列）
			if len(values) >= 3 {
				if v, ok := values[2].(string); ok {
					colComment = v
				} else if v, ok := values[2].([]byte); ok {
					colComment = string(v)
				}
			}
		}

		if colName != "" {
			colInfo := map[string]interface{}{
				"name": colName,
				"type": colType,
			}
			if colComment != "" {
				colInfo["comment"] = colComment
			}
			// 解析 nullable（Oracle/DM 返回 'Y'/'N'，但含 comment 时 nullable 位置会变）
			// 仅对 Oracle/DM 且不含 comment 列的情况解析 nullable
			if (config.Type == "oracle" || config.Type == "dm") && len(values) >= 3 && colComment == "" {
				nullable := ""
				if v, ok := values[2].(string); ok {
					nullable = v
				} else if v, ok := values[2].([]byte); ok {
					nullable = string(v)
				}
				if nullable != "" {
					colInfo["nullable"] = nullable
				}
			}
			columns = append(columns, colInfo)
		}
	}

	if columns == nil {
		columns = []map[string]interface{}{}
	}

	// Oracle/DM: 单独查询列注释并合并
	if config.Type == "oracle" || config.Type == "dm" {
		tbl := tableName
		if idx := strings.Index(tbl, "."); idx >= 0 {
			tbl = tbl[idx+1:]
		}
		commentQuery := fmt.Sprintf("SELECT COLUMN_NAME, COMMENTS FROM USER_COL_COMMENTS WHERE TABLE_NAME = '%s'", oracleEscapeIdentifier(tbl))
		commentRows, err := db.Query(commentQuery)
		if err == nil {
			defer commentRows.Close()
			commentMap := make(map[string]string)
			for commentRows.Next() {
				var colName, comment string
				if err := commentRows.Scan(&colName, &comment); err == nil && comment != "" {
					commentMap[colName] = comment
				}
			}
			for i, col := range columns {
				if name, ok := col["name"].(string); ok {
					if c, ok := commentMap[name]; ok {
						col["comment"] = c
						columns[i] = col
					}
				}
			}
		}
	}

	return columns, nil
}

// getDataOntologyUserFromRequest 从 Authorization Bearer 解析 token/apiKey，返回用户名（users map 的 key）

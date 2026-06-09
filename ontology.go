package main

import (
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"log"
	"net/http"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
)

func handleDatabaseTablesList(w http.ResponseWriter, r *http.Request, config *DatabaseConfig) {
	w.Header().Set("Content-Type", "application/json")

	if config.Type == "mongodb" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "MongoDB 暂不支持",
		})
		return
	}

	// SQL 数据库
	db, err := getDBFromPool(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接数据库失败",
		})
		return
	}

	// 获取表列表
	var query string
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb":
		query = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
	case "mysql", "mariadb", "tidb":
		query = "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()"
	case "sqlserver":
		query = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'"
	case "sqlite", "duckdb":
		query = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
	case "oracle":
		query = "SELECT table_name FROM user_tables"
	case "dm":
		query = "SELECT table_name FROM user_tables"
	default:
		query = "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()"
	}

	rows, err := db.Query(query)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询表列表失败",
		})
		return
	}

	var tables []string
	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err == nil {
			tables = append(tables, tableName)
		}
	}
	rows.Close()

	// 快速估算行数（使用系统表，避免逐表 COUNT(*)）
	rowCounts := make(map[string]int64)
	switch config.Type {
	case "dm", "oracle":
		countQuery := "SELECT table_name, num_rows FROM user_tables"
		if cr, err := db.Query(countQuery); err == nil {
			defer cr.Close()
			for cr.Next() {
				var tn string
				var cnt int64
				if cr.Scan(&tn, &cnt) == nil {
					rowCounts[strings.ToUpper(tn)] = cnt
				}
			}
		}
	case "postgresql":
		countQuery := "SELECT relname, n_live_tup FROM pg_stat_user_tables"
		if cr, err := db.Query(countQuery); err == nil {
			defer cr.Close()
			for cr.Next() {
				var tn string
				var cnt int64
				if cr.Scan(&tn, &cnt) == nil {
					rowCounts[tn] = cnt
				}
			}
		}
	// MySQL/SQLite 等不做行数估算，太快了没必要在列表页展示
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"tables":     tables,
		"row_counts": rowCounts,
	})
}

// handleOntologyScan 扫描所有数据库表结构，返回候选关系

func handleDatabaseOntologyScan(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
		return
	}

	// 从URL中提取数据库ID
	pathParts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(pathParts) < 4 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的请求路径",
		})
		return
	}
	dbID := pathParts[2]

	// 检查数据库是否存在及权限
	dataOntologyMu.RLock()
	config, exists := dataOntologyDatabases[dbID]
	dataOntologyMu.RUnlock()

	if !exists || !dataOntologyResourceVisible(config.Owner, username) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在或无权限",
		})
		return
	}

	// 解析请求体，获取可选的表列表
	var requestBody struct {
		Tables []string `json:"tables"`
	}
	if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
		// 如果解析失败，使用空列表（扫描所有表）
		requestBody.Tables = nil
	}

	// 收集该数据库的字段信息
	type TableField struct {
		DatabaseID string
		TableName  string
		FieldName  string
		FieldType  string
	}

	allFields := make([]TableField, 0)

	if config.Type == "mongodb" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "MongoDB 暂不支持",
		})
		return
	}

	// SQL 数据库
	db, err := getDBFromPool(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "连接数据库失败",
		})
		return
	}

	// 获取表列表
	var query string
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb":
		query = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
	case "mysql", "mariadb", "tidb":
		query = "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()"
	case "sqlserver":
		query = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'"
	case "sqlite", "duckdb":
		query = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
	case "oracle":
		query = "SELECT table_name FROM user_tables"
	case "dm":
		query = "SELECT table_name FROM user_tables"
	default:
		query = "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()"
	}

	rows, err := db.Query(query)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询表列表失败",
		})
		return
	}

	var tables []string
	for rows.Next() {
		var tableName string
		if err := rows.Scan(&tableName); err == nil {
			tables = append(tables, tableName)
		}
	}
	rows.Close()

	// 如果请求中指定了表列表，则只处理这些表
	if len(requestBody.Tables) > 0 {
		tableSet := make(map[string]bool)
		for _, t := range requestBody.Tables {
			tableSet[t] = true
		}
		var filteredTables []string
		for _, t := range tables {
			if tableSet[t] {
				filteredTables = append(filteredTables, t)
			}
		}
		tables = filteredTables
	}

	// 获取每个表的字段
	for _, tableName := range tables {
		var fieldQuery string
		switch config.Type {
		case "postgresql", "timescaledb", "cockroachdb":
			fieldQuery = fmt.Sprintf("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '%s'", tableName)
		case "mysql", "mariadb", "tidb":
			fieldQuery = fmt.Sprintf("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '%s' AND table_schema = DATABASE()", tableName)
		case "sqlite", "duckdb":
			fieldQuery = fmt.Sprintf("PRAGMA table_info(`%s`)", tableName)
		case "sqlserver":
			fieldQuery = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '%s'", tableName)
		case "oracle":
			fieldQuery = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s'", tableName)
		case "dm":
			// 达梦 USER_TAB_COLUMNS 要求大写表名
			fieldQuery = fmt.Sprintf("SELECT COLUMN_NAME, DATA_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '%s'", strings.ToUpper(tableName))
		default:
			continue
		}

		fieldRows, err := db.Query(fieldQuery)
		if err != nil {
			continue
		}

		for fieldRows.Next() {
			var fieldName, fieldType string

			if config.Type == "sqlite" || config.Type == "duckdb" {
				var cid, notnull, pk int
				var dfltValue interface{}
				if err := fieldRows.Scan(&cid, &fieldName, &fieldType, &notnull, &dfltValue, &pk); err == nil {
					allFields = append(allFields, TableField{
						DatabaseID: dbID,
						TableName:  tableName,
						FieldName:  fieldName,
						FieldType:  fieldType,
					})
				}
			} else {
				if err := fieldRows.Scan(&fieldName, &fieldType); err == nil {
					allFields = append(allFields, TableField{
						DatabaseID: dbID,
						TableName:  tableName,
						FieldName:  fieldName,
						FieldType:  fieldType,
					})
				}
			}
		}
		fieldRows.Close()
	}

	// 扫描候选关系
	candidates := make([]RelationCandidate, 0)
	seenPairs := make(map[string]bool)

	for i, field1 := range allFields {
		for j, field2 := range allFields {
			if i >= j {
				continue
			}

			// 同一个表的字段跳过
			if field1.TableName == field2.TableName {
				continue
			}

			// 检查是否已经处理过这对字段
			pairKey := fmt.Sprintf("%s:%s|%s:%s",
				field1.TableName, field1.FieldName,
				field2.TableName, field2.FieldName)
			reversePairKey := fmt.Sprintf("%s:%s|%s:%s",
				field2.TableName, field2.FieldName,
				field1.TableName, field1.FieldName)

			if seenPairs[pairKey] || seenPairs[reversePairKey] {
				continue
			}
			seenPairs[pairKey] = true

			// 匹配策略
			matchType := ""
			matchScore := 0.0

			// 1. 精确匹配
			if field1.FieldName == field2.FieldName {
				matchType = "exact"
				matchScore = 1.0
			}

			// 2. 大小写不敏感匹配
			if matchType == "" && strings.EqualFold(field1.FieldName, field2.FieldName) {
				matchType = "case_insensitive"
				matchScore = 0.9
			}

			// 3. 命名风格转换匹配
			if matchType == "" {
				name1 := toSnakeCase(field1.FieldName)
				name2 := toSnakeCase(field2.FieldName)
				if name1 == name2 {
					matchType = "naming_style"
					matchScore = 0.8
				}
			}

			// 4. 类型+关键词匹配
			if matchType == "" && field1.FieldType == field2.FieldType {
				keyword1 := extractKeyword(field1.FieldName)
				keyword2 := extractKeyword(field2.FieldName)
				if keyword1 != "" && keyword1 == keyword2 {
					matchType = "type_keyword"
					matchScore = 0.7
				}
			}

			// 如果匹配成功，添加候选
			if matchType != "" {
				candidate := RelationCandidate{
					Name: fmt.Sprintf("%s.%s ↔ %s.%s",
						field1.TableName, field1.FieldName,
						field2.TableName, field2.FieldName),
					Source: FieldRef{
						DatabaseID: field1.DatabaseID,
						TableName:  field1.TableName,
						FieldName:  field1.FieldName,
						FieldType:  field1.FieldType,
					},
					Target: FieldRef{
						DatabaseID: field2.DatabaseID,
						TableName:  field2.TableName,
						FieldName:  field2.FieldName,
						FieldType:  field2.FieldType,
					},
					MatchType:   matchType,
					MatchScore:  matchScore,
					Description: fmt.Sprintf("匹配类型: %s, 得分: %.2f", matchType, matchScore),
				}
				candidates = append(candidates, candidate)
			}
		}
	}

	// 按匹配得分排序
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].MatchScore > candidates[j].MatchScore
	})

	// 限制返回数量
	if len(candidates) > 100 {
		candidates = candidates[:100]
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"candidates": candidates,
		"total":      len(candidates),
	})
}

// handleDatabaseOntologyRelations 处理数据库级别的本体关系CRUD

func handleDatabaseOntologyRelations(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "未授权")
		return
	}

	// 从URL中提取数据库ID
	pathParts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(pathParts) < 4 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的请求路径",
		})
		return
	}
	dbID := pathParts[2]

	// 检查数据库是否存在及权限
	dataOntologyMu.RLock()
	config, exists := dataOntologyDatabases[dbID]
	dataOntologyMu.RUnlock()

	if !exists || !dataOntologyResourceVisible(config.Owner, username) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在或无权限",
		})
		return
	}

	switch r.Method {
	case http.MethodGet:
		// 获取该数据库的关系列表
		dataOntologyMu.RLock()
		relations := make([]OntologyRelation, 0)
		if config.Relations != nil {
			for _, rel := range config.Relations {
				relations = append(relations, rel)
			}
		}
		dataOntologyMu.RUnlock()

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":   true,
			"relations": relations,
		})

	case http.MethodPost:
		// 创建关系
		var rel OntologyRelation
		if err := json.NewDecoder(r.Body).Decode(&rel); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		// 验证必填字段
		if rel.Name == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "关系名称不能为空",
			})
			return
		}

		if rel.Source.FieldName == "" || rel.Target.FieldName == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "源字段和目标字段不能为空",
			})
			return
		}

		// 保存关系
		rel.ID = uuid.New().String()
		rel.Owner = username
		rel.CreatedAt = time.Now()

		dataOntologyMu.Lock()
		if config.Relations == nil {
			config.Relations = make([]OntologyRelation, 0)
		}
		config.Relations = append(config.Relations, rel)
		dataOntologyMu.Unlock()

		// 持久化保存
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存本体关系失败: %v", err)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"id":      rel.ID,
		})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
	}
}

// toSnakeCase 将驼峰命名转换为下划线命名

func toSnakeCase(s string) string {
	var result []rune
	for i, r := range s {
		if i > 0 && unicode.IsUpper(r) {
			result = append(result, '_')
		}
		result = append(result, unicode.ToLower(r))
	}
	return string(result)
}

// extractKeyword 提取字段名关键词

func extractKeyword(fieldName string) string {
	// 去除常见前缀
	prefixes := []string{"fk_", "id_", "ref_", "is_", "has_", "can_", "should_"}
	name := strings.ToLower(fieldName)
	for _, prefix := range prefixes {
		if strings.HasPrefix(name, prefix) {
			name = strings.TrimPrefix(name, prefix)
			break
		}
	}

	// 去除常见后缀
	suffixes := []string{"_id", "_code", "_key", "_no", "_num"}
	for _, suffix := range suffixes {
		if strings.HasSuffix(name, suffix) {
			name = strings.TrimSuffix(name, suffix)
			break
		}
	}

	return name
}

// handleDatabaseOntologyRelationDetail 处理数据库级别的单个本体关系

func handleDatabaseOntologyRelationDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "未授权")
		return
	}

	// 从URL中提取数据库ID和关系ID
	pathParts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(pathParts) < 6 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的请求路径",
		})
		return
	}
	dbID := pathParts[2]
	relID := pathParts[5]

	// 检查数据库是否存在及权限
	dataOntologyMu.RLock()
	config, exists := dataOntologyDatabases[dbID]
	dataOntologyMu.RUnlock()

	if !exists || !dataOntologyResourceVisible(config.Owner, username) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在或无权限",
		})
		return
	}

	// 查找关系
	dataOntologyMu.RLock()
	var rel *OntologyRelation
	var relIndex int = -1
	if config.Relations != nil {
		for i, r := range config.Relations {
			if r.ID == relID {
				rel = &config.Relations[i]
				relIndex = i
				break
			}
		}
	}
	dataOntologyMu.RUnlock()

	if rel == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "关系不存在",
		})
		return
	}

	switch r.Method {
	case http.MethodGet:
		// 获取关系详情
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":  true,
			"relation": rel,
		})

	case http.MethodDelete:
		// 删除关系
		dataOntologyMu.Lock()
		if relIndex >= 0 && relIndex < len(config.Relations) {
			config.Relations = append(config.Relations[:relIndex], config.Relations[relIndex+1:]...)
		}
		dataOntologyMu.Unlock()

		// 持久化保存
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("删除本体关系失败: %v", err)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
		})

	case http.MethodPut:
		// 更新关系
		var updateReq OntologyRelation
		if err := json.NewDecoder(r.Body).Decode(&updateReq); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		// 验证必填字段
		if updateReq.Source.FieldName == "" || updateReq.Target.FieldName == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "源字段和目标字段不能为空",
			})
			return
		}

		// 更新关系字段（保留 ID、Owner、CreatedAt）
		dataOntologyMu.Lock()
		rel.Name = updateReq.Name
		rel.Description = updateReq.Description
		rel.Source = updateReq.Source
		rel.Target = updateReq.Target
		rel.MatchType = updateReq.MatchType
		dataOntologyMu.Unlock()

		// 持久化保存
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("更新本体关系失败: %v", err)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":  true,
			"relation": rel,
		})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
	}
}

// TextSection 文本结构化解析的节点

type TextSection struct {
	Level    int           `json:"level"`
	Number   string        `json:"number"`
	Title    string        `json:"title"`
	Content  string        `json:"content"`
	Children []TextSection `json:"children"`
}

// TextParseRequest 文本解析请求

type TextParseRequest struct {
	Text    string                 `json:"text"`
	Format  string                 `json:"format"`
	Options map[string]interface{} `json:"options"`
}

// parseOfficialDocument 解析公文格式文本

func parseOfficialDocument(text string, minLevel, maxLevel int, detectNumbering, includeContent bool) ([]TextSection, map[string]interface{}) {
	// 定义各级标题的正则表达式
	levelPatterns := []struct {
		level   int
		pattern *regexp.Regexp
	}{
		{1, regexp.MustCompile(`^[一二三四五六七八九十]+、`)},        // 一、二、三、
		{2, regexp.MustCompile(`^[（(][一二三四五六七八九十]+[)）]`)}, // （一）（二）或 (一)(二)
		{3, regexp.MustCompile(`^\d+[.、]`)},               // 1. 2. 或 1、2、
		{4, regexp.MustCompile(`^[（(]\d+[)）]`)},           // （1）（2）或 (1)(2)
		{5, regexp.MustCompile(`^[①②③④⑤⑥⑦⑧⑨⑩]|^\d+\)`)},   // ①②③ 或 1) 2)
	}

	lines := strings.Split(text, "\n")
	var sections []TextSection
	var stack []*TextSection // 用于构建树形结构的栈

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// 检测标题
		detectedLevel := 0
		var number, title string

		for _, lp := range levelPatterns {
			if lp.level < minLevel || lp.level > maxLevel {
				continue
			}

			if match := lp.pattern.FindString(line); match != "" {
				detectedLevel = lp.level
				number = match
				title = strings.TrimSpace(strings.TrimPrefix(line, match))

				// 如果不检测编号标题，跳过
				if !detectNumbering {
					continue
				}
				break
			}
		}

		if detectedLevel > 0 {
			// 这是一个标题行
			section := TextSection{
				Level:   detectedLevel,
				Number:  number,
				Title:   title,
				Content: "",
			}

			// 构建树形结构
			// 弹出栈中所有级别 >= 当前级别的节点
			for len(stack) > 0 && stack[len(stack)-1].Level >= detectedLevel {
				stack = stack[:len(stack)-1]
			}

			if len(stack) == 0 {
				// 顶级节点
				sections = append(sections, section)
				stack = append(stack, &sections[len(sections)-1])
			} else {
				// 子节点
				parent := stack[len(stack)-1]
				parent.Children = append(parent.Children, section)
				stack = append(stack, &parent.Children[len(parent.Children)-1])
			}
		} else if includeContent && len(stack) > 0 {
			// 这是正文内容，添加到当前栈顶节点
			current := stack[len(stack)-1]
			if current.Content != "" {
				current.Content += "\n"
			}
			current.Content += line
		}
	}

	// 计算元数据
	totalSections := 0
	maxDepth := 0

	var countSections func([]TextSection, int)
	countSections = func(sections []TextSection, depth int) {
		if depth > maxDepth {
			maxDepth = depth
		}
		for i := range sections {
			totalSections++
			countSections(sections[i].Children, depth+1)
		}
	}
	countSections(sections, 1)

	metadata := map[string]interface{}{
		"total_sections":  totalSections,
		"max_depth":       maxDepth,
		"format_detected": "official",
	}

	return sections, metadata
}

// handleGovParseText 处理文本结构化解析 API

func handleGovParseText(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "仅支持 POST 请求",
		})
		return
	}

	var req TextParseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求体解析失败: " + err.Error(),
		})
		return
	}

	if req.Text == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "文本内容不能为空",
		})
		return
	}

	// 解析选项
	minLevel := 1
	maxLevel := 5
	detectNumbering := true
	includeContent := true

	if req.Options != nil {
		if v, ok := req.Options["min_level"].(float64); ok {
			minLevel = int(v)
		}
		if v, ok := req.Options["max_level"].(float64); ok {
			maxLevel = int(v)
		}
		if v, ok := req.Options["detect_numbering"].(bool); ok {
			detectNumbering = v
		}
		if v, ok := req.Options["include_content"].(bool); ok {
			includeContent = v
		}
	}

	// 根据格式选择解析器
	format := req.Format
	if format == "" {
		format = "official"
	}

	var sections []TextSection
	var metadata map[string]interface{}

	switch format {
	case "official":
		sections, metadata = parseOfficialDocument(req.Text, minLevel, maxLevel, detectNumbering, includeContent)
	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的格式类型: " + format,
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"sections": sections,
			"metadata": metadata,
		},
	})
}

// updateShareRun 更新分享执行记录

func updateShareRun(runID string, status string, progress int, output string, inputFiles []string, resultFiles []string) {
	needSave := false
	var shareRun *GovernanceShareRun
	governanceShareRunsMu.Lock()
	if run, exists := governanceShareRuns[runID]; exists {
		run.Status = status
		run.Progress = progress
		if output != "" {
			run.Output += output + "\n"
		}
		if inputFiles != nil {
			run.InputFiles = inputFiles
		}
		if resultFiles != nil {
			run.ResultFiles = resultFiles
		}
		run.UpdatedAt = time.Now()
		// 只在任务完成或失败时持久化，避免频繁IO
		if status == "completed" || status == "failed" {
			needSave = true
			shareRun = run
		}
	}
	governanceShareRunsMu.Unlock()

	// 持久化到文件
	if needSave {
		// 同步更新主任务的历史记录
		if shareRun != nil && shareRun.TaskID != "" {
			now := time.Now().Format(time.RFC3339)
			dataOntologyMu.Lock()
			if t, ok := governanceTasks[shareRun.TaskID]; ok {
				if status == "completed" {
					t.Status = "success"
					t.LastOutput = shareRun.Output
				} else {
					t.Status = "error"
					t.LastError = shareRun.Output
					if shareRun.Output != "" {
						t.LastOutput = shareRun.Output
					}
				}
				t.LastRunAt = now
				t.ProcessedFiles = 0
				t.Percent = 100
				t.CurrentFile = ""
			}
		// 创建任务执行日志
		logStatus := "success"
		if status == "failed" {
			logStatus = "error"
		}
		// 提取文件名（不含路径）
		var inputFileNames []string
		for _, f := range shareRun.InputFiles {
			inputFileNames = append(inputFileNames, filepath.Base(f))
		}
		var resultFileNames []string
		for _, f := range shareRun.ResultFiles {
			resultFileNames = append(resultFileNames, filepath.Base(f))
		}
		logEntry := &GovernanceTaskLog{
			ID:          uuid.New().String(),
			TaskID:      shareRun.TaskID,
			RunID:       runID,
			StartTime:   shareRun.CreatedAt.Format(time.RFC3339),
			EndTime:     now,
			Status:      logStatus,
			Output:      shareRun.Output,
			Input:       strings.Join(shareRun.InputFiles, ", "),
			InputFiles:  inputFileNames,
			ResultFiles: resultFileNames,
		}
			governanceTaskLogs[shareRun.TaskID] = append(governanceTaskLogs[shareRun.TaskID], logEntry)
			if len(governanceTaskLogs[shareRun.TaskID]) > 50 {
				governanceTaskLogs[shareRun.TaskID] = governanceTaskLogs[shareRun.TaskID][len(governanceTaskLogs[shareRun.TaskID])-50:]
			}
			dataOntologyMu.Unlock()
		}
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("[ShareRun] 保存分享执行记录失败: %v", err)
		}
	}
}

// handleSharePage 处理分享页面请求

func handleSharePage(w http.ResponseWriter, r *http.Request) {
	// 提取 token
	token := strings.TrimPrefix(r.URL.Path, "/share/")
	if token == "" {
		http.NotFound(w, r)
		return
	}

	// 提供分享页面
	http.ServeFile(w, r, "share.html")
}

// handleGovernanceShare 处理分享任务请求（免鉴权）

func handleGovernanceShare(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// 解析路径: /api/share/{token}[/run[/run_id[/download]]]
	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/v1/share/"), "/")
	if len(pathParts) == 0 || pathParts[0] == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "缺少分享token"})
		return
	}
	shareToken := pathParts[0]

	// 查找对应的任务
	dataOntologyMu.RLock()
	var task *GovernanceTask
	for _, t := range governanceTasks {
		if t.ShareToken == shareToken && t.ShareEnabled {
			task = t
			break
		}
	}
	dataOntologyMu.RUnlock()

	if task == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "分享链接无效或已关闭"})
		return
	}

	// 路由分发
	// GET /api/share/{token}/examples/{filename} - 免鉴权下载示例文件
	if len(pathParts) >= 3 && pathParts[1] == "examples" {
		filename := pathParts[2]
		handleGovernanceShareExampleDownload(w, r, task, filename)
		return
	}

	if len(pathParts) >= 2 && pathParts[1] == "run" {
		if len(pathParts) >= 3 && pathParts[2] != "" {
			runID := pathParts[2]
			if len(pathParts) >= 4 && pathParts[3] == "download" {
				// GET /api/share/{token}/run/{run_id}/download
				handleGovernanceShareRunDownload(w, r, task, runID)
				return
			}
			// GET /api/share/{token}/run/{run_id}
			handleGovernanceShareRunStatus(w, r, task, runID)
			return
		}
		// POST /api/share/{token}/run
		handleGovernanceShareRun(w, r, task, shareToken)
		return
	}

	// GET /api/share/{token}/runs - 列出所有执行记录
	if len(pathParts) >= 2 && pathParts[1] == "runs" {
		handleGovernanceShareRuns(w, r, task)
		return
	}

	// POST /api/share/{token}/ai/completion - 免授权 AI 调用
	if len(pathParts) >= 3 && pathParts[1] == "ai" && pathParts[2] == "completion" {
		handleGovernanceShareAICompletion(w, r)
		return
	}

	// GET /api/share/{token}
	handleGovernanceShareInfo(w, r, task)
}

// handleGovernanceShareInfo 获取分享任务信息

package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/YOUR_USERNAME/DataToolbox/agent"
	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

func buildCreateApiRetryPrompt(userMessage string, dbSchemas []map[string]interface{}, existingApis []map[string]interface{}, errorMsg string, lastResponse string) string {
	prompt := "你之前的接口配置存在问题，请根据以下错误信息重新生成。\n\n"

	// 检测是否为E2E验证失败（默认参数返回空结果）
	isE2EFailure := strings.Contains(errorMsg, "端到端验证失败") || strings.Contains(errorMsg, "返回空结果") || strings.Contains(errorMsg, "default_params") || strings.Contains(errorMsg, "参数值在数据库中不存在")

	if isE2EFailure {
		prompt += "【严重错误 — E2E验证失败】\n"
		prompt += "你之前生成的 default_params 在数据库中查不到数据！\n"
		prompt += "系统用你提供的 default_params 实际执行了SQL，结果返回0行数据。\n"
		prompt += "这意味着你的 default_params 中的参数值在数据库中不存在。\n\n"
		prompt += "【必须采取的修正措施】：\n"
		prompt += "1. 使用更宽松的默认值 — 选择数据库中最可能存在的值\n"
		prompt += "2. 去掉过于严格的 WHERE 条件 — 如果某个条件导致查不到数据，考虑移除该条件或改为可选参数\n"
		prompt += "3. 不要使用假设值 — default_params 必须是数据库中真实存在的数据\n"
		prompt += "4. 优先减少 WHERE 条件数量 — 条件越少，越容易匹配到数据\n"
		prompt += "5. 如果必须保留 WHERE 条件，使用最通用的值（如 status 用最常见的状态，日期用最近的日期）\n\n"
	}

	prompt += "【错误信息】\n"
	prompt += errorMsg + "\n\n"

	// 检测是否为字段不存在错误（执行校验失败且包含缺失字段信息）
	isMissingFieldsError := strings.Contains(errorMsg, "不存在的字段") || strings.Contains(errorMsg, "无效的列名")
	if isMissingFieldsError {
		prompt += "【严重错误 — 字段不存在】\n"
		prompt += "你使用的某些字段在数据库表中不存在！这是最严重的错误，必须修正！\n"
		prompt += "请仔细查看上方【错误信息】中列出的不存在的字段名，以及各表的实际字段列表。\n"
		prompt += "你只能使用【各表的实际字段列表】中列出的字段名，绝对不能编造或猜测字段名！\n"
		prompt += "如果不确定某个字段名，宁可不使用该字段，也不要编造一个可能不存在的字段名。\n\n"
	}

	prompt += "【你之前的响应】\n"
	prompt += lastResponse + "\n\n"

	// 收集数据库类型信息，生成语法提示
	dbTypes := make(map[string]bool)
	for _, schema := range dbSchemas {
		if t, ok := schema["type"].(string); ok && t != "" {
			dbTypes[t] = true
		}
	}
	if len(dbTypes) > 0 {
		prompt += "【数据库类型与SQL语法要点】\n"
		prompt += "请根据以下数据库类型注意SQL语法差异，特别是分页写法：\n"
		for dbType := range dbTypes {
			switch strings.ToUpper(dbType) {
			case "DM", "ORACLE", "ORACLE12C":
				prompt += fmt.Sprintf("- 当前数据库类型为 %s，分页请使用 WHERE ROWNUM <= N 或 FETCH FIRST N ROWS ONLY，不要使用 LIMIT\n", dbType)
				prompt += "  注意: DM/Oracle 不支持 LIMIT 语法，使用 LIMIT 会导致SQL执行失败\n"
			case "MYSQL", "MARIADB":
				prompt += fmt.Sprintf("- 当前数据库类型为 %s，分页使用 LIMIT N OFFSET M 语法\n", dbType)
			case "POSTGRESQL", "PG":
				prompt += fmt.Sprintf("- 当前数据库类型为 %s，分页使用 LIMIT N OFFSET M 语法\n", dbType)
			case "SQLSERVER", "MSSQL":
				prompt += fmt.Sprintf("- 当前数据库类型为 %s，分页使用 TOP N 或 OFFSET-FETCH 语法\n", dbType)
			case "CLICKHOUSE":
				prompt += fmt.Sprintf("- 当前数据库类型为 %s，分页使用 LIMIT N 语法\n", dbType)
			default:
				prompt += fmt.Sprintf("- 当前数据库类型为 %s，请使用该数据库兼容的分页语法\n", dbType)
			}
		}
		prompt += "\n"
	}

	prompt += "【重要】以下是真实的数据库结构信息，请严格基于这些表和字段重新生成SQL：\n\n"

	for _, schema := range dbSchemas {
		prompt += fmt.Sprintf("数据库: %s (类型: %s)\n", schema["name"], schema["type"])
		prompt += "=" + strings.Repeat("=", 60) + "\n"

		// 处理新格式（包含字段信息）
		if tables, ok := schema["tables"].([]map[string]interface{}); ok {
			for _, table := range tables {
				tableName := table["name"].(string)
				prompt += fmt.Sprintf("\n表名: %s\n", tableName)

				if columns, ok := table["columns"].([]map[string]interface{}); ok && len(columns) > 0 {
					prompt += "字段列表:\n"
					for _, col := range columns {
						colName := col["name"]
						colType := col["type"]
						if colComment, ok := col["comment"].(string); ok && colComment != "" {
							prompt += fmt.Sprintf("  - %s (%s) — %s\n", colName, colType, colComment)
						} else {
							prompt += fmt.Sprintf("  - %s (%s)\n", colName, colType)
						}
					}
				} else {
					prompt += "  （无法获取字段信息）\n"
				}
			}
		} else if tables, ok := schema["tables"].([]string); ok {
			// 兼容旧格式（只有表名）
			prompt += "表列表: " + strings.Join(tables, ", ") + "\n"
		}

		// 添加关系信息
		if relations, ok := schema["relations"].([]OntologyRelation); ok && len(relations) > 0 {
			prompt += "\n表间关系（可用于JOIN参考）:\n"
			prompt += strings.Repeat("-", 40) + "\n"
			for _, rel := range relations {
				prompt += fmt.Sprintf("  • %s\n", rel.Name)
				prompt += fmt.Sprintf("    %s.%s ↔ %s.%s\n",
					rel.Source.TableName, rel.Source.FieldName,
					rel.Target.TableName, rel.Target.FieldName)
				if rel.Description != "" {
					prompt += fmt.Sprintf("    说明: %s\n", rel.Description)
				}
			}
			prompt += "提示：上述关系表示不同表之间字段的关联关系，可在生成JOIN SQL时参考。\n"
		}
		prompt += "\n"
	}

	// 添加已有接口信息
	if len(existingApis) > 0 {
		prompt += "\n【已有接口列表】\n"
		prompt += "以下是系统中已存在的接口，供您参考：\n\n"
		for i, api := range existingApis {
			name, _ := api["name"].(string)
			path, _ := api["path"].(string)
			method, _ := api["method"].(string)
			prompt += fmt.Sprintf("%d. %s - %s %s\n", i+1, name, method, path)
		}
		prompt += "\n【重要提示】\n"
		prompt += "1. 新接口的 path + method 组合不能与已有接口重复\n"
		prompt += "2. 请分析新接口是否属于某个已有的一级分类（path中的 /api/xxx/ 部分）\n"
		prompt += "   - 如果属于已有分类，请使用相同的一级分类路径\n"
		prompt += "   - 如果不属于已有分类，可以创建新的一级分类\n"
		prompt += "3. 例如：已有 /api/users/list，新接口可以是 /api/users/detail（属于同一分类）\n"
		prompt += "         或创建新分类 /api/products/list（属于不同分类）\n\n"
	} else {
		prompt += "\n【已有接口列表】\n"
		prompt += "当前系统中暂无已有接口，您可以创建第一个接口。\n\n"
	}

	prompt += "\n原始用户需求：" + userMessage + "\n\n"
	prompt += "请修正错误，重新生成接口配置，必须包含以下信息：\n"
	prompt += "1. name: 接口名称（中文，简洁明了）\n"
	prompt += "2. path: 接口路径（以/api/开头，使用RESTful风格，全部小写）\n"
	prompt += "3. method: 请求方法（GET/POST/PUT/DELETE，全部大写）\n"
	prompt += "4. sql: SQL查询语句（支持MyBatis语法，使用#{param}表示参数，必须使用与数据库类型匹配的语法）\n"
	prompt += "5. description: 接口描述\n"
	prompt += "6. default_params: 默认参数值（用于测试，JSON对象，值必须是数据库中实际存在的数据）\n\n"
	prompt += "请按以下JSON格式返回：\n"
	prompt += "```json\n"
	prompt += "{\n"
	prompt += "  \"name\": \"查询员工薪资\",\n"
	prompt += "  \"path\": \"/api/v1/openapis/hr/salary\",\n"
	prompt += "  \"method\": \"GET\",\n"
	prompt += "  \"sql\": \"SELECT he.EMP_NAME, hsr.BASE_SALARY, hsr.BONUS, hsr.ACTUAL_PAY FROM HR_EMPLOYEE he JOIN HR_SALARY_RECORD hsr ON he.EMP_ID = hsr.EMP_ID WHERE hsr.YEAR_MONTH = #{year_month}\",\n"
	prompt += "  \"description\": \"查询指定月份的员工薪资信息\",\n"
	prompt += "  \"default_params\": {\n"
	prompt += "    \"year_month\": \"2024-01\"\n"
	prompt += "  }\n"
	prompt += "}\n"
	prompt += "```\n\n"
	prompt += "【重要规则】：\n"
	prompt += "1. SQL只能有一条语句\n"
	prompt += "2. 使用#{参数名}表示预编译参数（推荐），使用${参数名}表示直接替换\n"
	prompt += "3. 接口路径要符合RESTful规范（如 /api/users, /api/products/list）\n"
	prompt += "4. 根据操作类型选择正确的HTTP方法（查询用GET，创建用POST，更新用PUT，删除用DELETE）\n"
	prompt += "5. **必须使用上面列出的真实表名和字段名**，不要使用不存在的表或字段\n"
	prompt += "6. **SQL语法必须与数据库类型匹配**，特别是分页语法（见上方【数据库类型与SQL语法要点】）\n"
	prompt += "7. 必须为SQL中的每个参数提供默认值用于测试\n"
	prompt += "8. **仔细检查你的SQL，确保所有表名和字段名都存在于上面的列表中**\n\n"
	prompt += "【default_params 规则 — 极其重要】：\n"
	prompt += "default_params 的值必须是数据库中实际存在的数据值，不能是假设值或随意编造的值！\n"
	prompt += "系统会用 default_params 实际执行SQL来验证，如果查不到数据则验证失败。\n"
	prompt += "- 对于 WHERE 条件中的参数，必须使用表中真实存在的值（如字段有注释说明取值范围，按注释选择）\n"
	prompt += "- 对于 id 类参数，使用最小的 id 值（通常是1）\n"
	prompt += "- 对于 status/类型 类参数，使用最常见的状态值（如状态字段有注释，按注释选择最通用的值）\n"
	prompt += "- 对于日期参数，使用最近的日期（如 \"2024-01-01\" 或 \"2024-01\"）\n"
	prompt += "- 对于 limit/count 类参数，使用较小的值（如 10）\n"
	prompt += "- 如果不确定某个参数的实际值，宁可去掉该 WHERE 条件，也不要使用可能不存在的值\n"
	prompt += "- 优先选择范围更宽的默认值（如不限定 status 比限定某个具体 status 更安全）\n"

	if isE2EFailure {
		prompt += "\n【再次强调 — E2E验证失败修正要点】：\n"
		prompt += "你之前的 default_params 导致SQL查询返回0行数据！请务必：\n"
		prompt += "- 减少不必要的 WHERE 条件，让查询更容易匹配到数据\n"
		prompt += "- 使用更宽松、更通用的默认参数值\n"
		prompt += "- 如果某个 WHERE 条件过于严格，直接移除它\n"
	}

	return prompt
}

// parseApiConfigFromAI 从AI响应中解析接口配置

func parseApiConfigFromAI(response string, dbSchemas []map[string]interface{}) (map[string]interface{}, string) {
	// 提取JSON代码块
	jsonStart := strings.Index(response, "```json")
	jsonBlockOffset := 0
	if jsonStart != -1 {
		jsonBlockOffset = len("```json")
	} else {
		jsonStart = strings.Index(response, "```")
		if jsonStart != -1 {
			jsonBlockOffset = len("```")
		}
	}

	if jsonStart == -1 {
		// 尝试直接解析整个响应作为JSON
		var config map[string]interface{}
		if err := json.Unmarshal([]byte(response), &config); err == nil {
			// 添加数据库ID
			if len(dbSchemas) > 0 {
				if id, ok := dbSchemas[0]["id"].(string); ok {
					config["database_id"] = id
				}
			}
			return config, ""
		}
		// 尝试提取 { } 包裹的 JSON 对象
		objStart := strings.Index(response, "{")
		objEnd := strings.LastIndex(response, "}")
		if objStart != -1 && objEnd != -1 && objEnd > objStart {
			jsonStr := response[objStart : objEnd+1]
			if err := json.Unmarshal([]byte(jsonStr), &config); err == nil {
				if len(dbSchemas) > 0 {
					if id, ok := dbSchemas[0]["id"].(string); ok {
						config["database_id"] = id
					}
				}
				return config, ""
			}
		}
		return nil, "未找到JSON代码块，且响应内容无法直接解析为JSON"
	}

	// 找到代码块起始位置后的换行符
	newlineIdx := strings.Index(response[jsonStart+jsonBlockOffset:], "\n")
	if newlineIdx == -1 {
		return nil, "找到代码块标记但格式不正确"
	}
	contentStart := jsonStart + jsonBlockOffset + newlineIdx + 1

	// 找到代码块结束标记
	jsonEnd := strings.Index(response[contentStart:], "```")
	if jsonEnd == -1 {
		// 没有结束标记，尝试从 contentStart 解析到结尾
		jsonStr := strings.TrimSpace(response[contentStart:])
		var config map[string]interface{}
		if err := json.Unmarshal([]byte(jsonStr), &config); err == nil {
			if len(dbSchemas) > 0 {
				if id, ok := dbSchemas[0]["id"].(string); ok {
					config["database_id"] = id
				}
			}
			return config, ""
		}
		return nil, "找到代码块开始标记但未找到结束标记"
	}

	jsonStr := cleanAIResponse(strings.TrimSpace(response[contentStart : contentStart+jsonEnd]))
	jsonStr = extractJSONObject(jsonStr)
	if jsonStr == "" {
		jsonStr = strings.TrimSpace(response[contentStart : contentStart+jsonEnd])
	}

	var config map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &config); err != nil {
		return nil, fmt.Sprintf("JSON解析失败: %v，JSON内容: %s", err, jsonStr)
	}

	// 验证必需字段
	requiredFields := []string{"name", "path", "method", "sql"}
	for _, field := range requiredFields {
		if _, exists := config[field]; !exists {
			return nil, fmt.Sprintf("缺少必需字段: %s", field)
		}
	}

	// 标准化 path 和 method
	if path, ok := config["path"].(string); ok {
		config["path"] = strings.ToLower(strings.TrimSpace(path))
	}
	if method, ok := config["method"].(string); ok {
		config["method"] = strings.ToUpper(strings.TrimSpace(method))
	}

	// 添加数据库ID
	if len(dbSchemas) > 0 {
		if id, ok := dbSchemas[0]["id"].(string); ok {
			config["database_id"] = id
		}
	}

	return config, ""
}

// extractTablesFromSQL 从 SQL 中提取所有表名
// 支持 FROM table, JOIN table, FROM schema.table 等格式

func extractTablesFromSQL(sql string) []string {
	var tables []string
	seen := make(map[string]bool)

	// 匹配 FROM table_name
	fromPattern := regexp.MustCompile(`(?i)\bFROM\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)`)
	fromMatches := fromPattern.FindAllStringSubmatch(sql, -1)
	for _, match := range fromMatches {
		if len(match) > 1 {
			table := strings.Trim(match[1], `"`)
			if !seen[table] {
				tables = append(tables, table)
				seen[table] = true
			}
		}
	}

	// 匹配 JOIN table_name
	joinPattern := regexp.MustCompile(`(?i)\bJOIN\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)`)
	joinMatches := joinPattern.FindAllStringSubmatch(sql, -1)
	for _, match := range joinMatches {
		if len(match) > 1 {
			table := strings.Trim(match[1], `"`)
			if !seen[table] {
				tables = append(tables, table)
				seen[table] = true
			}
		}
	}

	// 匹配 UPDATE table_name
	updatePattern := regexp.MustCompile(`(?i)\bUPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)`)
	updateMatches := updatePattern.FindAllStringSubmatch(sql, -1)
	for _, match := range updateMatches {
		if len(match) > 1 {
			table := strings.Trim(match[1], `"`)
			if !seen[table] {
				tables = append(tables, table)
				seen[table] = true
			}
		}
	}

	// 匹配 INSERT INTO table_name
	insertPattern := regexp.MustCompile(`(?i)\bINSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)`)
	insertMatches := insertPattern.FindAllStringSubmatch(sql, -1)
	for _, match := range insertMatches {
		if len(match) > 1 {
			table := strings.Trim(match[1], `"`)
			if !seen[table] {
				tables = append(tables, table)
				seen[table] = true
			}
		}
	}

	// 匹配 DELETE FROM table_name
	deletePattern := regexp.MustCompile(`(?i)\bDELETE\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)`)
	deleteMatches := deletePattern.FindAllStringSubmatch(sql, -1)
	for _, match := range deleteMatches {
		if len(match) > 1 {
			table := strings.Trim(match[1], `"`)
			if !seen[table] {
				tables = append(tables, table)
				seen[table] = true
			}
		}
	}

	return tables
}

// extractFieldsFromSQL 从 SQL 中提取所有字段名
// 支持 table.field, field, "field" 等格式
// 返回字段名列表（可能包含 table.field 格式）

func extractFieldsFromSQL(sql string) []string {
	var fields []string
	seen := make(map[string]bool)

	// 移除字符串常量，避免误匹配
	cleanedSQL := removeStringLiterals(sql)

	// 移除 FETCH FIRST N ROWS ONLY 子句（避免关键字被误识别为字段名）
	cleanedSQL = regexp.MustCompile(`(?i)\bFETCH\s+FIRST\s+\d+\s+ROWS\s+ONLY\b`).ReplaceAllString(cleanedSQL, "")

	// 匹配 SELECT ... FROM 之间的字段
	selectPattern := regexp.MustCompile(`(?i)\bSELECT\s+(.+?)\s+FROM`)
	selectMatch := selectPattern.FindStringSubmatch(cleanedSQL)
	if len(selectMatch) > 1 {
		selectClause := selectMatch[1]
		// 分割字段（考虑逗号分隔）
		fieldParts := splitSelectFields(selectClause)
		for _, part := range fieldParts {
			part = strings.TrimSpace(part)
			// 跳过 *
			if part == "*" {
				continue
			}
			// 提取字段名（去掉别名 AS xxx）
			field := extractFieldName(part)
			if field != "" && !seen[field] {
				fields = append(fields, field)
				seen[field] = true
			}
		}
	}

	// 匹配 WHERE 子句中的字段
	wherePattern := regexp.MustCompile(`(?i)\bWHERE\s+(.+?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|\bOFFSET\b|$)`)
	whereMatch := wherePattern.FindStringSubmatch(cleanedSQL)
	if len(whereMatch) > 1 {
		whereClause := whereMatch[1]
		extractFieldsFromClause(whereClause, &fields, seen)
	}

	// 匹配 ORDER BY 子句中的字段
	orderByPattern := regexp.MustCompile(`(?i)\bORDER\s+BY\s+(.+?)(?:\bLIMIT\b|\bOFFSET\b|$)`)
	orderByMatch := orderByPattern.FindStringSubmatch(cleanedSQL)
	if len(orderByMatch) > 1 {
		orderClause := orderByMatch[1]
		extractFieldsFromClause(orderClause, &fields, seen)
	}

	// 匹配 GROUP BY 子句中的字段
	groupByPattern := regexp.MustCompile(`(?i)\bGROUP\s+BY\s+(.+?)(?:\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|\bOFFSET\b|$)`)
	groupByMatch := groupByPattern.FindStringSubmatch(cleanedSQL)
	if len(groupByMatch) > 1 {
		groupClause := groupByMatch[1]
		extractFieldsFromClause(groupClause, &fields, seen)
	}

	// 匹配 HAVING 子句中的字段
	havingPattern := regexp.MustCompile(`(?i)\bHAVING\s+(.+?)(?:\bORDER\s+BY\b|\bLIMIT\b|\bOFFSET\b|$)`)
	havingMatch := havingPattern.FindStringSubmatch(cleanedSQL)
	if len(havingMatch) > 1 {
		havingClause := havingMatch[1]
		extractFieldsFromClause(havingClause, &fields, seen)
	}

	// 匹配 JOIN ON 子句中的字段
	joinOnPattern := regexp.MustCompile(`(?i)\bON\s+(.+?)(?:\bWHERE\b|\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|$)`)
	joinOnMatches := joinOnPattern.FindAllStringSubmatch(cleanedSQL, -1)
	for _, match := range joinOnMatches {
		if len(match) > 1 {
			onClause := match[1]
			extractFieldsFromClause(onClause, &fields, seen)
		}
	}

	return fields
}

// removeStringLiterals 移除 SQL 中的字符串常量，避免误匹配字段

func removeStringLiterals(sql string) string {
	// 移除 MyBatis 占位符 #{xxx} 和 ${xxx}，避免被当作字段名
	result := regexp.MustCompile(`#\{[^}]+\}`).ReplaceAllString(sql, "?")
	result = regexp.MustCompile(`\$\{[^}]+\}`).ReplaceAllString(result, "?")
	// 移除单引号字符串
	result = regexp.MustCompile(`'[^']*'`).ReplaceAllString(result, "''")
	// 移除双引号字符串（某些数据库使用双引号）
	result = regexp.MustCompile(`"[^"]*"`).ReplaceAllString(result, `""`)
	return result
}

// splitSelectFields 分割 SELECT 字段列表（考虑括号嵌套）

func splitSelectFields(selectClause string) []string {
	var fields []string
	var current strings.Builder
	depth := 0

	for _, ch := range selectClause {
		switch ch {
		case '(':
			depth++
			current.WriteRune(ch)
		case ')':
			depth--
			current.WriteRune(ch)
		case ',':
			if depth == 0 {
				fields = append(fields, current.String())
				current.Reset()
			} else {
				current.WriteRune(ch)
			}
		default:
			current.WriteRune(ch)
		}
	}

	if current.Len() > 0 {
		fields = append(fields, current.String())
	}

	return fields
}

// extractFieldName 从字段表达式中提取字段名
// 支持: field, table.field, schema.table.field, field AS alias

func extractFieldName(expr string) string {
	expr = strings.TrimSpace(expr)

	// 移除别名 (AS alias 或 空格 alias)
	if idx := strings.Index(strings.ToUpper(expr), " AS "); idx != -1 {
		expr = strings.TrimSpace(expr[:idx])
	} else {
		// 处理空格别名（如 "field alias"）
		parts := strings.Fields(expr)
		if len(parts) >= 2 && !isSQLKeyword(parts[len(parts)-1]) {
			// 最后一个词可能是别名，取前面的部分
			expr = strings.Join(parts[:len(parts)-1], " ")
		}
	}

	// 如果是函数调用或表达式，返回空（不校验）
	if strings.Contains(expr, "(") || strings.Contains(expr, "+") ||
		strings.Contains(expr, "-") || strings.Contains(expr, "*") && !strings.Contains(expr, ".") ||
		strings.Contains(expr, "/") || strings.Contains(expr, "DISTINCT") {
		return ""
	}

	// 移除引号
	expr = strings.Trim(expr, `"`)

	return expr
}

// isSQLKeyword 判断是否是 SQL 关键字

func isSQLKeyword(word string) bool {
	keywords := map[string]bool{
		// 基本关键字
		"SELECT": true, "FROM": true, "WHERE": true, "AND": true, "OR": true, "NOT": true,
		"IN": true, "LIKE": true, "BETWEEN": true, "IS": true, "NULL": true,
		"ASC": true, "DESC": true, "LIMIT": true, "OFFSET": true,
		"AS": true, "ON": true, "SET": true, "INTO": true, "VALUES": true,
		"DISTINCT": true, "ALL": true, "EXISTS": true, "CASE": true, "WHEN": true, "THEN": true, "ELSE": true, "END": true,
		// JOIN 关键字
		"JOIN": true, "LEFT": true, "RIGHT": true, "INNER": true, "OUTER": true, "CROSS": true, "FULL": true, "NATURAL": true,
		// GROUP/ORDER/HAVING
		"GROUP": true, "ORDER": true, "BY": true, "HAVING": true,
		// UNION
		"UNION": true, "INTERSECT": true, "EXCEPT": true,
		// FETCH FIRST ROWS ONLY (DM/Oracle/PG 分页)
		"FETCH": true, "FIRST": true, "ROWS": true, "ONLY": true, "NEXT": true,
		// ROWNUM/TOP
		"ROWNUM": true, "TOP": true,
		// 聚合函数
		"COUNT": true, "SUM": true, "AVG": true, "MIN": true, "MAX": true,
		// 日期/时间关键字
		"INTERVAL": true, "DAY": true, "MONTH": true, "YEAR": true, "HOUR": true, "MINUTE": true, "SECOND": true,
		"DATE": true, "TIME": true, "TIMESTAMP": true, "DATETIME": true,
		// 其他常见关键字
		"WITH": true, "RECURSIVE": true, "OVER": true, "PARTITION": true, "WINDOW": true,
		"CAST": true, "CONVERT": true, "COALESCE": true, "IFNULL": true, "ISNULL": true,
		"TRUE": true, "FALSE": true, "DEFAULT": true, "PRIMARY": true, "KEY": true,
		"CREATE": true, "DROP": true, "ALTER": true, "INSERT": true, "UPDATE": true, "DELETE": true,
		"TABLE": true, "INDEX": true, "VIEW": true, "TRIGGER": true, "PROCEDURE": true, "FUNCTION": true,
		"GRANT": true, "REVOKE": true, "COMMIT": true, "ROLLBACK": true, "BEGIN": true, "TRANSACTION": true,
		"FOR": true, "TO": true, "OF": true, "AT": true, "USING": true, "RETURN": true, "RETURNS": true,
	}
	return keywords[strings.ToUpper(word)]
}

// extractFieldsFromClause 从子句中提取字段名

func extractFieldsFromClause(clause string, fields *[]string, seen map[string]bool) {
	// 匹配 table.field 或 field（标识符）
	// 排除函数调用、数字常量、字符串常量
	fieldPattern := regexp.MustCompile(`([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)`)
	matches := fieldPattern.FindAllString(clause, -1)

	for _, match := range matches {
		// 跳过 SQL 关键字
		if isSQLKeyword(match) {
			continue
		}
		// 跳过函数名（后面紧跟左括号的）
		if strings.Contains(clause, match+"(") {
			continue
		}
		// 跳过参数占位符
		if strings.HasPrefix(match, "#{") || strings.HasPrefix(match, "${") {
			continue
		}

		// 移除引号
		field := strings.Trim(match, `"`)
		if field != "" && !seen[field] {
			*fields = append(*fields, field)
			seen[field] = true
		}
	}
}

// validateSQLTablesAndFields 校验 SQL 中的表名和字段名是否存在
// 返回校验结果和错误信息

func validateSQLTablesAndFields(sql string, dbSchemas []map[string]interface{}) (bool, string) {
	// 提取表名
	tables := extractTablesFromSQL(sql)
	if len(tables) == 0 {
		// 没有提取到表名，可能是非标准 SQL，跳过校验
		return true, ""
	}

	log.Printf("SQL校验 - 提取到的表名: %v", tables)

	// 构建表名到字段列表的映射
	tableColumnsMap := make(map[string][]string)
	tableExistsMap := make(map[string]bool)

	// 从 dbSchemas 中构建表信息
	for _, schema := range dbSchemas {
		if tablesWithColumns, ok := schema["tables"].([]map[string]interface{}); ok {
			for _, table := range tablesWithColumns {
				tableName, _ := table["name"].(string)
				tableNameLower := strings.ToLower(tableName)
				tableExistsMap[tableNameLower] = true

				// 提取字段名列表
				var columnNames []string
				if columns, ok := table["columns"].([]map[string]interface{}); ok {
					for _, col := range columns {
						if colName, ok := col["name"].(string); ok {
							columnNames = append(columnNames, colName)
						}
					}
				}
				tableColumnsMap[tableNameLower] = columnNames
			}
		}
	}

	log.Printf("SQL校验 - 数据库中的表: %v", tableExistsMap)

	// 校验表名是否存在
	var missingTables []string
	for _, table := range tables {
		// 处理 schema.table 格式
		tableName := table
		if idx := strings.Index(table, "."); idx >= 0 {
			tableName = table[idx+1:]
		}
		tableNameLower := strings.ToLower(tableName)

		if !tableExistsMap[tableNameLower] {
			missingTables = append(missingTables, table)
		}
	}

	if len(missingTables) > 0 {
		errMsg := fmt.Sprintf("SQL中引用的表不存在: %s", strings.Join(missingTables, ", "))
		log.Printf("SQL校验失败 - %s", errMsg)
		return false, errMsg
	}

	// 提取字段名
	fields := extractFieldsFromSQL(sql)
	if len(fields) == 0 {
		// 没有提取到字段名，可能是 SELECT *，跳过字段校验
		log.Printf("SQL校验 - 未提取到字段名，跳过字段校验")
		return true, ""
	}

	log.Printf("SQL校验 - 提取到的字段名: %v", fields)

	// 校验字段名是否存在（排除数据库伪列）
	pseudoColumns := map[string]bool{
		"ROWNUM": true, "ROWID": true, "OID": true, "CTID": true,
		"XMIN": true, "XMAX": true, "TABLEOID": true,
		"_ROWID_": true, "DB_ROW_ID": true,
	}
	var missingFields []string
	for _, field := range fields {
		// 处理 table.field 格式
		var tableName, fieldName string
		if idx := strings.Index(field, "."); idx >= 0 {
			tableName = field[:idx]
			fieldName = field[idx+1:]
		} else {
			// 没有 table 前缀，检查SQL中使用的表是否有该字段
			fieldName = field
			// 跳过伪列
			if pseudoColumns[strings.ToUpper(fieldName)] {
				continue
			}
			found := false
			// 只检查SQL中实际使用的表，而不是所有表
			for _, tbl := range tables {
				tblName := tbl
				if idx := strings.Index(tbl, "."); idx >= 0 {
					tblName = tbl[idx+1:]
				}
				if columns, ok := tableColumnsMap[strings.ToLower(tblName)]; ok {
					for _, col := range columns {
						if strings.EqualFold(col, fieldName) {
							found = true
							break
						}
					}
				}
				if found {
					break
				}
			}
			if !found {
				missingFields = append(missingFields, field)
			}
			continue
		}

		// 有 table 前缀，检查指定表的字段
		tableNameLower := strings.ToLower(tableName)
		// 跳过伪列
		if pseudoColumns[strings.ToUpper(fieldName)] {
			continue
		}
		columns, exists := tableColumnsMap[tableNameLower]
		if !exists {
			// 表名不存在（前面已校验过，这里应该不会发生）
			continue
		}

		found := false
		for _, col := range columns {
			if strings.EqualFold(col, fieldName) {
				found = true
				break
			}
		}
		if !found {
			missingFields = append(missingFields, field)
		}
	}

	if len(missingFields) > 0 {
		// 构建可用字段列表，帮助 AI 修正
		var availableFieldsHint strings.Builder
		availableFieldsHint.WriteString(fmt.Sprintf("SQL中引用的字段不存在: %s\n\n", strings.Join(missingFields, ", ")))
		availableFieldsHint.WriteString("【可用字段列表】\n")
		for _, table := range tables {
			tableName := table
			if idx := strings.Index(table, "."); idx >= 0 {
				tableName = table[idx+1:]
			}
			tableNameLower := strings.ToLower(tableName)
			if columns, exists := tableColumnsMap[tableNameLower]; exists && len(columns) > 0 {
				availableFieldsHint.WriteString(fmt.Sprintf("表 %s 的字段: %s\n", tableName, strings.Join(columns, ", ")))
			}
		}
		availableFieldsHint.WriteString("\n请使用上述字段重新生成SQL，不要编造不存在的字段名。")
		errMsg := availableFieldsHint.String()
		log.Printf("SQL校验失败 - %s", errMsg)
		return false, errMsg
	}

	log.Printf("SQL校验成功 - 所有表名和字段名均有效")
	return true, ""
}

// extractInvalidColumnsFromError 从数据库执行错误信息中提取不存在的字段名
// 支持的格式：
//   - DM: "无效的列名[FIELDNAME]" 或 "无效的列名 [FIELDNAME]"
//   - 通用: "column 'FIELDNAME' does not exist" / "Unknown column 'FIELDNAME'"
//   - Oracle: "invalid identifier" 后跟字段名

func extractInvalidColumnsFromError(errMsg string) []string {
	var invalidColumns []string
	seen := make(map[string]bool)

	// DM格式: 无效的列名[FIELDNAME]
	dmPattern := regexp.MustCompile(`无效的列名\s*\[([^\]]+)\]`)
	for _, match := range dmPattern.FindAllStringSubmatch(errMsg, -1) {
		col := strings.TrimSpace(match[1])
		if col != "" && !seen[strings.ToUpper(col)] {
			invalidColumns = append(invalidColumns, col)
			seen[strings.ToUpper(col)] = true
		}
	}

	// 通用格式: column "FIELDNAME" does not exist / Unknown column 'FIELDNAME'
	genericPatterns := []string{
		`column ["']([^"']+)["'] does not exist`,
		`Unknown column ["']([^"']+)["']`,
		`invalid identifier.*?["'](\w+)["']`,
		`列名\s*["']([^"']+)["']\s*无效`,
	}
	for _, pat := range genericPatterns {
		re := regexp.MustCompile(pat)
		for _, match := range re.FindAllStringSubmatch(errMsg, -1) {
			col := strings.TrimSpace(match[1])
			if col != "" && !seen[strings.ToUpper(col)] {
				invalidColumns = append(invalidColumns, col)
				seen[strings.ToUpper(col)] = true
			}
		}
	}

	return invalidColumns
}

// findTableColumnsFromDBSchemas 从dbSchemas中查找指定表的字段列表
// 返回 map[tableName][]columnName

func findTableColumnsFromDBSchemas(dbSchemas []map[string]interface{}, tableNames []string) map[string][]string {
	result := make(map[string][]string)
	tableNameSet := make(map[string]bool)
	for _, t := range tableNames {
		tableNameSet[strings.ToLower(t)] = true
	}

	for _, schema := range dbSchemas {
		if tablesWithColumns, ok := schema["tables"].([]map[string]interface{}); ok {
			for _, table := range tablesWithColumns {
				tableName, _ := table["name"].(string)
				// 如果指定了表名列表，只查找这些表；否则查找所有表
				if len(tableNameSet) > 0 && !tableNameSet[strings.ToLower(tableName)] {
					continue
				}
				var columnNames []string
				if columns, ok := table["columns"].([]map[string]interface{}); ok {
					for _, col := range columns {
						if colName, ok := col["name"].(string); ok {
							columnNames = append(columnNames, colName)
						}
					}
				}
				if len(columnNames) > 0 {
					result[tableName] = columnNames
				}
			}
		}
	}
	return result
}

// buildMissingFieldsErrorMessage 构建包含缺失字段和可用字段列表的详细错误信息

func buildMissingFieldsErrorMessage(execError string, sqlStr string, dbSchemas []map[string]interface{}) string {
	msg := execError

	// 从错误信息中提取不存在的字段名
	invalidColumns := extractInvalidColumnsFromError(execError)
	if len(invalidColumns) == 0 {
		// 无法从错误信息中提取字段名，返回原始错误
		return msg
	}

	// 提取SQL中使用的表名
	tables := extractTablesFromSQL(sqlStr)

	// 查找这些表的字段列表
	tableColumns := findTableColumnsFromDBSchemas(dbSchemas, tables)

	// 构建详细的错误信息
	msg += "\n\n【不存在的字段】\n"
	for _, col := range invalidColumns {
		// 尝试找到该字段可能属于哪个表
		foundInTable := ""
		for _, t := range tables {
			tableName := t
			if idx := strings.Index(t, "."); idx >= 0 {
				tableName = t[idx+1:]
			}
			if cols, ok := tableColumns[tableName]; ok {
				for _, c := range cols {
					if strings.EqualFold(c, col) {
						foundInTable = tableName
						break
					}
				}
			}
			if foundInTable != "" {
				break
			}
		}
		if foundInTable != "" {
			msg += fmt.Sprintf("- 字段 %s 不存在于表 %s 中\n", col, foundInTable)
		} else {
			msg += fmt.Sprintf("- 字段 %s 在所有相关表中均不存在\n", col)
		}
	}

	// 添加可用字段列表
	if len(tableColumns) > 0 {
		msg += "\n【各表的实际字段列表（请只使用这些字段）】\n"
		for tableName, cols := range tableColumns {
			msg += fmt.Sprintf("表 %s 的字段: %s\n", tableName, strings.Join(cols, ", "))
		}
	}

	return msg
}

// validateSQLByExecution 通过实际执行SQL来校验语法、权限和运行时错误
// 返回 (bool, string) 表示校验结果和错误信息

func validateSQLByExecution(sqlStr string, dbID string) (bool, string) {
	// 获取数据库配置
	dataOntologyMu.RLock()
	dbConfig, exists := dataOntologyDatabases[dbID]
	dataOntologyMu.RUnlock()

	if !exists {
		return false, "数据库配置不存在"
	}

	// 获取数据库连接
	db, err := getDBFromPool(dbConfig)
	if err != nil {
		return false, fmt.Sprintf("数据库连接失败: %v", err)
	}

	// 处理 MyBatis 参数占位符：将 #{param} 和 ${param} 替换为占位符或默认值
	validationSQL := replaceMyBatisParamsForValidation(sqlStr)

	// 判断SQL类型
	isWrite := isWriteOperation(validationSQL)

	var validationErr error

	if isWrite {
		// 写操作：使用事务 + ROLLBACK 或 PREPARE
		validationErr = validateWriteSQL(db, dbConfig, validationSQL)
	} else {
		// 读操作：使用 EXPLAIN 或 LIMIT 0
		validationErr = validateReadSQL(db, dbConfig, validationSQL)
	}

	if validationErr != nil {
		return false, fmt.Sprintf("执行校验失败: %v", validationErr)
	}

	return true, ""
}

// replaceMyBatisParamsForValidation 将 MyBatis 参数占位符替换为校验用的占位符

func replaceMyBatisParamsForValidation(sqlStr string) string {
	result := sqlStr

	// 替换 ${param} 为空字符串或默认值
	dollarPattern := `\$\{([^}]+)\}`
	result = replaceWithRegex(result, dollarPattern, func(match string) string {
		paramName := strings.TrimSpace(match[2 : len(match)-1])
		// 支持参数名:默认值格式
		if colonIdx := strings.Index(paramName, ":"); colonIdx != -1 {
			defaultValue := strings.TrimSpace(paramName[colonIdx+1:])
			return defaultValue
		}
		// 没有默认值，返回空字符串
		return ""
	})

	// 替换 #{param} 为 ? 占位符
	hashPattern := `#\{([^}]+)\}`
	result = replaceWithRegex(result, hashPattern, func(match string) string {
		paramName := strings.TrimSpace(match[2 : len(match)-1])
		// 支持参数名:默认值格式
		if colonIdx := strings.Index(paramName, ":"); colonIdx != -1 {
			defaultValue := strings.TrimSpace(paramName[colonIdx+1:])
			// 根据默认值类型返回适当的占位符
			if defaultValue != "" {
				return fmt.Sprintf("'%s'", defaultValue)
			}
		}
		// 没有默认值，返回 NULL
		return "NULL"
	})

	return result
}

// validateReadSQL 校验读操作SQL（SELECT）

func validateReadSQL(db *sql.DB, dbConfig *DatabaseConfig, sqlStr string) error {
	var validationSQL string

	switch dbConfig.Type {
	case "mysql", "mariadb", "tidb":
		// MySQL: 使用 EXPLAIN
		validationSQL = "EXPLAIN " + sqlStr
	case "postgresql", "timescaledb", "cockroachdb":
		// PostgreSQL: 使用 EXPLAIN
		validationSQL = "EXPLAIN " + sqlStr
	case "sqlserver":
		// SQL Server: 使用 SET SHOWPLAN_TEXT ON 或 EXPLAIN
		validationSQL = "SET SHOWPLAN_TEXT ON; " + sqlStr
	case "oracle":
		// Oracle: 使用 EXPLAIN PLAN FOR
		validationSQL = "EXPLAIN PLAN FOR " + sqlStr
	case "dm":
		// 达梦: 使用 EXPLAIN
		validationSQL = "EXPLAIN " + sqlStr
	case "sqlite", "duckdb":
		// SQLite/DuckDB: 使用 EXPLAIN QUERY PLAN
		validationSQL = "EXPLAIN QUERY PLAN " + sqlStr
	case "clickhouse":
		// ClickHouse: 使用 EXPLAIN
		validationSQL = "EXPLAIN " + sqlStr
	default:
		// 默认：尝试 LIMIT 0 方式
		validationSQL = sqlStr
		// 如果SQL已有LIMIT，尝试替换为 LIMIT 0
		if !strings.Contains(strings.ToUpper(sqlStr), "LIMIT") {
			validationSQL = strings.TrimSuffix(sqlStr, ";") + " LIMIT 0"
		}
	}

	// 执行校验SQL
	_, err := db.Exec(validationSQL)
	if err != nil {
		return fmt.Errorf("SQL语法或权限错误: %v", err)
	}

	return nil
}

// validateWriteSQL 校验写操作SQL（INSERT/UPDATE/DELETE）

func validateWriteSQL(db *sql.DB, dbConfig *DatabaseConfig, sqlStr string) error {
	// 方案1：使用事务 + ROLLBACK（适用于大多数数据库）
	// 方案2：使用 PREPARE（部分数据库支持）

	// 优先使用事务方式
	tx, err := db.Begin()
	if err != nil {
		// 如果无法开启事务，尝试 PREPARE 方式
		return validateWithPrepare(db, dbConfig, sqlStr)
	}
	defer tx.Rollback()

	// 在事务中执行SQL（不会真正提交）
	_, err = tx.Exec(sqlStr)
	if err != nil {
		return fmt.Errorf("SQL语法或权限错误: %v", err)
	}

	// 成功执行，事务会自动 ROLLBACK
	return nil
}

// validateWithPrepare 使用 PREPARE 方式校验SQL

func validateWithPrepare(db *sql.DB, dbConfig *DatabaseConfig, sqlStr string) error {
	// 不同数据库的 PREPARE 语法
	var prepareSQL string
	var cleanupSQL string

	switch dbConfig.Type {
	case "mysql", "mariadb", "tidb":
		prepareSQL = "PREPARE stmt FROM ?"
		cleanupSQL = "DEALLOCATE PREPARE stmt"
	case "postgresql", "timescaledb", "cockroachdb":
		prepareSQL = "PREPARE stmt AS " + sqlStr
		cleanupSQL = "DEALLOCATE stmt"
	case "oracle":
		// Oracle 不支持标准 PREPARE，直接返回错误
		return fmt.Errorf("Oracle 数据库不支持预编译校验，请检查SQL语法")
	case "dm":
		// 达梦支持 PREPARE
		prepareSQL = "PREPARE stmt FROM ?"
		cleanupSQL = "DEALLOCATE PREPARE stmt"
	case "sqlserver":
		// SQL Server 使用 sp_prepare
		return fmt.Errorf("SQL Server 暂不支持预编译校验，请检查SQL语法")
	default:
		// 其他数据库尝试通用方式
		prepareSQL = "PREPARE stmt FROM ?"
		cleanupSQL = "DEALLOCATE PREPARE stmt"
	}

	// 执行 PREPARE
	if strings.Contains(prepareSQL, "?") {
		// MySQL 风格：PREPARE stmt FROM ?
		_, err := db.Exec(prepareSQL, sqlStr)
		if err != nil {
			return fmt.Errorf("SQL语法错误: %v", err)
		}
	} else {
		// PostgreSQL 风格：PREPARE stmt AS sql
		_, err := db.Exec(prepareSQL)
		if err != nil {
			return fmt.Errorf("SQL语法错误: %v", err)
		}
	}

	// 清理 PREPARE
	if cleanupSQL != "" {
		db.Exec(cleanupSQL)
	}

	return nil
}

// isNonConditionParam 判断参数是否出现在 SQL 的非条件子句位置（LIMIT/OFFSET/ORDER BY/GROUP BY）
// 这些位置的参数不应从数据库取样本值，应保留原始默认值

func isNonConditionParam(sqlStr, paramName string) bool {
	paramPatterns := []string{
		"#{" + paramName + "}",
		"${" + paramName + "}",
	}

	for _, pattern := range paramPatterns {
		idx := strings.Index(sqlStr, pattern)
		if idx == -1 {
			continue
		}

		// 检查参数前面紧跟的关键字（忽略空白）
		beforeParam := strings.TrimSpace(sqlStr[:idx])
		upperBefore := strings.ToUpper(beforeParam)

		// LIMIT #{limit} / LIMIT #{size}
		if strings.HasSuffix(upperBefore, "LIMIT") {
			return true
		}
		// OFFSET #{offset}
		if strings.HasSuffix(upperBefore, "OFFSET") {
			return true
		}
		// ORDER BY #{orderBy}
		if strings.HasSuffix(upperBefore, "BY") && strings.Contains(upperBefore, "ORDER") {
			return true
		}
		// GROUP BY #{groupBy}
		if strings.HasSuffix(upperBefore, "BY") && strings.Contains(upperBefore, "GROUP") {
			return true
		}
	}

	return false
}

// populateDefaultParamsFromDB 从数据库表中查询实际值填充 default_params

func populateDefaultParamsFromDB(apiConfig map[string]interface{}, dbID string) {
	sqlStr, ok := apiConfig["sql"].(string)
	if !ok || sqlStr == "" {
		return
	}

	defaultParams, ok := apiConfig["default_params"].(map[string]interface{})
	if !ok || len(defaultParams) == 0 {
		return
	}

	// 获取数据库配置
	dataOntologyMu.RLock()
	dbConfig, exists := dataOntologyDatabases[dbID]
	dataOntologyMu.RUnlock()

	if !exists {
		log.Printf("未找到数据库配置: %s", dbID)
		return
	}

	// 提取 SQL 中的表名
	tableNames := extractTableNamesFromSQL(sqlStr)
	if len(tableNames) == 0 {
		log.Printf("未能从 SQL 中提取表名: %s", sqlStr)
		return
	}

	log.Printf("从 SQL 中提取的表: %v", tableNames)

	// 对每个参数，尝试从对应的表中查询实际值
	for paramName, paramValue := range defaultParams {
		// 检查参数是否出现在非条件子句（LIMIT/OFFSET/ORDER BY/GROUP BY）中
		if isNonConditionParam(sqlStr, paramName) {
			log.Printf("参数 %s 出现在 LIMIT/OFFSET/ORDER BY/GROUP BY 等非条件位置，保留默认值: %v", paramName, paramValue)
			continue
		}

		// 查找参数对应的表和字段
		tableName, fieldName := findParamTableAndField(sqlStr, paramName, tableNames)
		if tableName == "" || fieldName == "" {
			log.Printf("参数 %s 未找到对应的表或字段，保留默认值: %v", paramName, paramValue)
			continue
		}

		// 从表中查询实际值
		actualValue, err := queryActualValueFromTable(dbConfig, tableName, fieldName)
		if err != nil {
			log.Printf("查询参数 %s 的实际值失败 (表: %s, 字段: %s): %v，保留默认值: %v", paramName, tableName, fieldName, err, paramValue)
			continue
		}

		if actualValue != nil {
			defaultParams[paramName] = actualValue
			log.Printf("参数 %s 已填充实际值: %v (表: %s, 字段: %s)", paramName, actualValue, tableName, fieldName)
		}
	}
}

// validateSQLWithDefaultParams 用 default_params 实际执行 SQL，验证能否返回数据
// 返回 (是否成功, 错误信息, 查询结果)

func validateSQLWithDefaultParams(sqlStr string, defaultParams map[string]interface{}, dbID string) (bool, string, []map[string]interface{}) {
	// 获取数据库配置
	dataOntologyMu.RLock()
	dbConfig, exists := dataOntologyDatabases[dbID]
	dataOntologyMu.RUnlock()

	if !exists {
		return false, "数据库配置不存在", nil
	}

	// NoSQL 数据库不支持端到端验证
	if dbConfig.Type == "mongodb" || dbConfig.Type == "redis" || dbConfig.Type == "neo4j" ||
		dbConfig.Type == "elasticsearch" || dbConfig.Type == "influxdb" || dbConfig.Type == "memcached" ||
		dbConfig.Type == "cassandra" || dbConfig.Type == "hbase" {
		log.Printf("端到端验证：数据库类型 %s 不支持，跳过验证", dbConfig.Type)
		return true, "", nil
	}

	// 获取数据库连接
	db, err := getDBFromPool(dbConfig)
	if err != nil {
		return false, fmt.Sprintf("数据库连接失败: %v", err), nil
	}

	// 将 #{param} 和 ${param} 替换为 default_params 中的实际值
	execSQL := replaceMyBatisParamsWithValues(sqlStr, defaultParams)

	// 如果 SQL 中没有 LIMIT，添加 LIMIT 1（避免返回大量数据）
	upperSQL := strings.ToUpper(execSQL)
	if !strings.Contains(upperSQL, " LIMIT ") && !strings.Contains(upperSQL, "ROWNUM") && !strings.Contains(upperSQL, "TOP ") {
		switch dbConfig.Type {
		case "oracle", "dm":
			// Oracle/DM: 使用 ROWNUM <= 1
			upperExec := strings.ToUpper(execSQL)
			if strings.Contains(upperExec, " WHERE ") {
				// 有 WHERE 子句，在 WHERE 后添加 ROWNUM 条件
				// 使用大小写不敏感的替换
				whereRegex := regexp.MustCompile(`(?i)\bWHERE\b`)
				execSQL = whereRegex.ReplaceAllStringFunc(execSQL, func(match string) string {
					return match + " ROWNUM <= 1 AND"
				})
			} else {
				// 没有 WHERE 子句，需要添加 WHERE ROWNUM <= 1
				// 在 ORDER BY / GROUP BY / HAVING 之前插入，或在末尾添加
				inserted := false
				for _, keyword := range []string{" ORDER ", " GROUP ", " HAVING "} {
					if idx := strings.LastIndex(upperExec, keyword); idx != -1 {
						execSQL = execSQL[:idx] + " WHERE ROWNUM <= 1" + execSQL[idx:]
						inserted = true
						break
					}
				}
				if !inserted {
					execSQL += " WHERE ROWNUM <= 1"
				}
			}
		case "sqlserver":
			// SQL Server: 使用 TOP 1
			execSQL = regexp.MustCompile(`(?i)^\s*SELECT\s+`).ReplaceAllString(execSQL, "SELECT TOP 1 ")
		default:
			execSQL += " LIMIT 1"
		}
	}

	log.Printf("端到端验证SQL: %s", execSQL)

	// 执行查询
	rows, err := db.Query(execSQL)
	if err != nil {
		return false, fmt.Sprintf("SQL执行失败: %v", err), nil
	}
	defer rows.Close()

	// 读取列信息
	columns, err := rows.Columns()
	if err != nil {
		return false, fmt.Sprintf("读取列信息失败: %v", err), nil
	}

	// 读取结果
	var results []map[string]interface{}
	for rows.Next() {
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range columns {
			valuePtrs[i] = &values[i]
		}
		if err := rows.Scan(valuePtrs...); err != nil {
			return false, fmt.Sprintf("读取数据失败: %v", err), nil
		}
		row := make(map[string]interface{})
		for i, col := range columns {
			val := values[i]
			// 处理 []byte 类型，转为字符串
			if b, ok := val.([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = val
			}
		}
		results = append(results, row)
	}

	if err := rows.Err(); err != nil {
		return false, fmt.Sprintf("遍历结果集失败: %v", err), nil
	}

	if len(results) == 0 {
		return false, "使用默认参数执行SQL返回空结果，请检查default_params中的参数值是否在数据库中存在", nil
	}

	log.Printf("端到端验证成功，返回 %d 行数据", len(results))
	return true, "", results
}

// replaceMyBatisParamsWithValues 将 MyBatis 参数占位符替换为 default_params 中的实际值

func replaceMyBatisParamsWithValues(sqlStr string, defaultParams map[string]interface{}) string {
	result := sqlStr

	// 替换 ${param} 为实际值（直接替换，不加引号）
	dollarPattern := `\$\{([^}]+)\}`
	result = replaceWithRegex(result, dollarPattern, func(match string) string {
		paramName := strings.TrimSpace(match[2 : len(match)-1])
		// 支持参数名:默认值格式
		if colonIdx := strings.Index(paramName, ":"); colonIdx != -1 {
			paramName = strings.TrimSpace(paramName[:colonIdx])
		}
		if val, ok := defaultParams[paramName]; ok {
			return fmt.Sprintf("%v", val)
		}
		return ""
	})

	// 替换 #{param} 为实际值（字符串加引号，数字直接用）
	hashPattern := `#\{([^}]+)\}`
	result = replaceWithRegex(result, hashPattern, func(match string) string {
		paramName := strings.TrimSpace(match[2 : len(match)-1])
		// 支持参数名:默认值格式
		if colonIdx := strings.Index(paramName, ":"); colonIdx != -1 {
			paramName = strings.TrimSpace(paramName[:colonIdx])
		}
		if val, ok := defaultParams[paramName]; ok {
			return formatParamValue(val)
		}
		return "NULL"
	})

	return result
}

// formatParamValue 将参数值格式化为 SQL 值（字符串加引号，数字直接用）

func formatParamValue(val interface{}) string {
	switch v := val.(type) {
	case float64:
		// JSON 数字默认解析为 float64，如果是整数则去掉小数点
		if v == float64(int64(v)) {
			return fmt.Sprintf("%d", int64(v))
		}
		return fmt.Sprintf("%v", v)
	case int, int64, int32, int16, int8:
		return fmt.Sprintf("%d", v)
	case bool:
		if v {
			return "1"
		}
		return "0"
	case nil:
		return "NULL"
	default:
		// 字符串类型加引号
		strVal := fmt.Sprintf("%v", v)
		// 转义单引号，防止 SQL 注入
		strVal = strings.ReplaceAll(strVal, "'", "''")
		return fmt.Sprintf("'%s'", strVal)
	}
}

// extractTableNamesFromSQL 从 SQL 中提取表名

func extractTableNamesFromSQL(sqlStr string) []string {
	var tableNames []string
	upperSQL := strings.ToUpper(sqlStr)

	// 提取 FROM 后面的表名
	fromIdx := strings.Index(upperSQL, " FROM ")
	if fromIdx != -1 {
		afterFrom := sqlStr[fromIdx+6:]
		tableName := extractFirstTableName(afterFrom)
		if tableName != "" {
			tableNames = append(tableNames, tableName)
		}
	}

	// 提取 JOIN 后面的表名
	joinPattern := regexp.MustCompile(`(?i)\bJOIN\s+([^\s,]+)`)
	joinMatches := joinPattern.FindAllStringSubmatch(sqlStr, -1)
	for _, match := range joinMatches {
		if len(match) > 1 {
			tableName := strings.Trim(match[1], "\"`[]")
			tableNames = append(tableNames, tableName)
		}
	}

	// 去重
	seen := make(map[string]bool)
	var uniqueTables []string
	for _, t := range tableNames {
		if !seen[t] {
			seen[t] = true
			uniqueTables = append(uniqueTables, t)
		}
	}

	return uniqueTables
}

// extractFirstTableName 从 SQL 片段中提取第一个表名

func extractFirstTableName(sqlFragment string) string {
	// 去除前导空格
	sqlFragment = strings.TrimSpace(sqlFragment)

	// 处理带引号、反引号、方括号的表名
	if len(sqlFragment) > 0 {
		quoteChars := []string{"\"", "`", "["}
		for _, quote := range quoteChars {
			if strings.HasPrefix(sqlFragment, quote) {
				endQuote := quote
				if quote == "[" {
					endQuote = "]"
				}
				endIdx := strings.Index(sqlFragment[1:], endQuote)
				if endIdx != -1 {
					return sqlFragment[1 : endIdx+1]
				}
			}
		}
	}

	// 提取第一个单词作为表名（可能包含 schema.table 格式）
	parts := strings.Fields(sqlFragment)
	if len(parts) > 0 {
		tableName := parts[0]
		// 去除可能的别名（AS 关键字）
		if strings.ToUpper(tableName) == "AS" && len(parts) > 1 {
			tableName = parts[1]
		}
		// 去除尾部逗号
		tableName = strings.TrimRight(tableName, ",")
		return tableName
	}

	return ""
}

// findParamTableAndField 查找参数对应的表名和字段名

func findParamTableAndField(sqlStr, paramName string, tableNames []string) (string, string) {
	// 在 SQL 中查找参数出现的位置
	paramPatterns := []string{
		"#{" + paramName + "}",
		"${" + paramName + "}",
	}

	for _, pattern := range paramPatterns {
		paramIdx := strings.Index(sqlStr, pattern)
		if paramIdx == -1 {
			continue
		}

		// 向前查找字段名（通常在 = 或 LIKE 等操作符之前）
		beforeParam := sqlStr[:paramIdx]
		fieldName := extractFieldNameBeforeParam(beforeParam)
		if fieldName != "" {
			// 返回第一个表名（简化处理，实际可能需要更精确的表名匹配）
			if len(tableNames) > 0 {
				return tableNames[0], fieldName
			}
		}
	}

	// 如果在 SQL 中找不到字段名，尝试使用参数名作为字段名
	if len(tableNames) > 0 {
		return tableNames[0], paramName
	}

	return "", ""
}

// extractFieldNameBeforeParam 从参数前的 SQL 片段中提取字段名

func extractFieldNameBeforeParam(sqlFragment string) string {
	// 去除尾部空格
	sqlFragment = strings.TrimSpace(sqlFragment)

	// 常见操作符：=, LIKE, IN, >, <, >=, <=, !=
	operators := []string{"=", "LIKE", "IN", ">", "<", ">=", "<=", "!="}

	for _, op := range operators {
		// 查找操作符位置
		upperFragment := strings.ToUpper(sqlFragment)
		opIdx := strings.LastIndex(upperFragment, op)
		if opIdx == -1 {
			continue
		}

		// 提取操作符之前的部分
		beforeOp := strings.TrimSpace(sqlFragment[:opIdx])

		// 从后向前提取字段名
		// 处理带引号、反引号、方括号的字段名
		if len(beforeOp) > 0 {
			lastChar := beforeOp[len(beforeOp)-1]
			if lastChar == '"' || lastChar == '`' || lastChar == ']' {
				quoteChar := string(lastChar)
				if lastChar == ']' {
					quoteChar = "["
				}
				// 向前查找匹配的引号
				for i := len(beforeOp) - 2; i >= 0; i-- {
					if string(beforeOp[i]) == quoteChar {
						return beforeOp[i+1 : len(beforeOp)-1]
					}
				}
			}
		}

		// 提取最后一个单词作为字段名
		parts := strings.Fields(beforeOp)
		if len(parts) > 0 {
			fieldName := parts[len(parts)-1]
			// 去除可能的表名前缀 (table.field 格式)
			if dotIdx := strings.LastIndex(fieldName, "."); dotIdx != -1 {
				fieldName = fieldName[dotIdx+1:]
			}
			return fieldName
		}
	}

	return ""
}

// queryActualValueFromTable 从表中查询字段的实际值

func queryActualValueFromTable(dbConfig *DatabaseConfig, tableName, fieldName string) (interface{}, error) {
	// 验证表名和字段名合法性
	if !isValidIdentifierWithSchema(tableName) {
		return nil, fmt.Errorf("无效的表名: %s", tableName)
	}
	if !isValidIdentifier(fieldName) {
		return nil, fmt.Errorf("无效的字段名: %s", fieldName)
	}

	// MongoDB 特殊处理
	if dbConfig.Type == "mongodb" {
		uri := buildMongoURI(dbConfig)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
		if err != nil {
			return nil, err
		}
		defer client.Disconnect(ctx)

		collection := client.Database(dbConfig.Database).Collection(tableName)

		var sample bson.M
		err = collection.FindOne(ctx, bson.M{}).Decode(&sample)
		if err != nil {
			return nil, err
		}

		if value, exists := sample[fieldName]; exists {
			return value, nil
		}
		return nil, fmt.Errorf("字段 %s 不存在", fieldName)
	}

	// NoSQL 数据库不支持
	if dbConfig.Type == "redis" || dbConfig.Type == "neo4j" || dbConfig.Type == "elasticsearch" ||
		dbConfig.Type == "influxdb" || dbConfig.Type == "memcached" ||
		dbConfig.Type == "cassandra" || dbConfig.Type == "hbase" {
		return nil, fmt.Errorf("不支持的数据库类型: %s", dbConfig.Type)
	}

	// SQL 数据库通用处理
	db, err := getDBFromPool(dbConfig)
	if err != nil {
		return nil, err
	}

	// 构建查询 SQL
	quotedTable, err := safeQuoteIdentifier(tableName, dbConfig.Type)
	if err != nil {
		return nil, err
	}

	quotedField, err := safeQuoteIdentifier(fieldName, dbConfig.Type)
	if err != nil {
		return nil, err
	}

	// 根据数据库类型构建不同的查询语句
	var querySQL string
	switch dbConfig.Type {
	case "oracle", "dm":
		querySQL = fmt.Sprintf("SELECT %s FROM %s WHERE %s IS NOT NULL AND ROWNUM = 1", quotedField, quotedTable, quotedField)
	case "sqlserver":
		querySQL = fmt.Sprintf("SELECT TOP 1 %s FROM %s WHERE %s IS NOT NULL", quotedField, quotedTable, quotedField)
	default:
		querySQL = fmt.Sprintf("SELECT %s FROM %s WHERE %s IS NOT NULL LIMIT 1", quotedField, quotedTable, quotedField)
	}

	var value interface{}
	err = db.QueryRow(querySQL).Scan(&value)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("表中没有数据")
		}
		return nil, err
	}

	return value, nil
}

// parseAIResponse 解析AI响应提取SQL和回复文本

func parseAIResponse(response string, dbSchemas []map[string]interface{}) (string, string, string) {
	var sql string
	var responseText string
	var dbID string

	// 提取SQL代码块
	sqlStart := strings.Index(response, "```sql")
	codeBlockStart := sqlStart
	if sqlStart == -1 {
		sqlStart = strings.Index(response, "```")
		codeBlockStart = sqlStart
	}

	if sqlStart != -1 {
		// 提取代码块之前的文本作为回复
		if codeBlockStart > 0 {
			responseText = strings.TrimSpace(response[:codeBlockStart])
		}

		sqlStart = strings.Index(response[sqlStart:], "\n")
		if sqlStart != -1 {
			sqlEnd := strings.Index(response[codeBlockStart+sqlStart+1:], "```")
			if sqlEnd != -1 {
				sql = strings.TrimSpace(response[codeBlockStart+sqlStart+1 : codeBlockStart+sqlStart+1+sqlEnd])
				// 返回第一个数据库ID
				if len(dbSchemas) > 0 {
					if id, ok := dbSchemas[0]["id"].(string); ok {
						dbID = id
					}
				}
				return sql, dbID, responseText
			}
		}
	}

	// 如果没有代码块，尝试直接查找SQL语句
	lines := strings.Split(response, "\n")
	var beforeSQL []string
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToUpper(line), "SELECT") ||
			strings.HasPrefix(strings.ToUpper(line), "INSERT") ||
			strings.HasPrefix(strings.ToUpper(line), "UPDATE") ||
			strings.HasPrefix(strings.ToUpper(line), "DELETE") {
			// 收集多行SQL，直到遇到空行或非SQL行
			var sqlLines []string
			sqlLines = append(sqlLines, line)
			for j := i + 1; j < len(lines); j++ {
				nextLine := strings.TrimSpace(lines[j])
				if nextLine == "" {
					break
				}
				// 检查是否是SQL续行（以SQL关键字开头或是明显的SQL片段）
				upperLine := strings.ToUpper(nextLine)
				if strings.HasPrefix(upperLine, "FROM") ||
					strings.HasPrefix(upperLine, "WHERE") ||
					strings.HasPrefix(upperLine, "AND") ||
					strings.HasPrefix(upperLine, "OR") ||
					strings.HasPrefix(upperLine, "ORDER") ||
					strings.HasPrefix(upperLine, "GROUP") ||
					strings.HasPrefix(upperLine, "HAVING") ||
					strings.HasPrefix(upperLine, "LIMIT") ||
					strings.HasPrefix(upperLine, "JOIN") ||
					strings.HasPrefix(upperLine, "LEFT") ||
					strings.HasPrefix(upperLine, "RIGHT") ||
					strings.HasPrefix(upperLine, "INNER") ||
					strings.HasPrefix(upperLine, "ON") ||
					strings.HasPrefix(upperLine, "SET") ||
					strings.HasPrefix(upperLine, "VALUES") ||
					strings.Contains(nextLine, ",") ||
					strings.HasSuffix(line, ",") {
					sqlLines = append(sqlLines, nextLine)
					line = nextLine
				} else {
					break
				}
			}
			sql = strings.Join(sqlLines, " ")
			// SQL之前的行作为回复文本
			if i > 0 {
				responseText = strings.TrimSpace(strings.Join(beforeSQL, " "))
			}
			if len(dbSchemas) > 0 {
				if id, ok := dbSchemas[0]["id"].(string); ok {
					dbID = id
				}
			}
			return sql, dbID, responseText
		}
		if line != "" {
			beforeSQL = append(beforeSQL, line)
		}
	}

	return "", "", ""
}

// ==================== 数据治理模块 ====================

// handleGovernanceTasks 处理治理任务列表和创建

func handleGovernanceTasks(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		defer dataOntologyMu.RUnlock()

		taskList := make([]*GovernanceTask, 0, len(governanceTasks))
		for _, t := range governanceTasks {
			if !dataOntologyResourceVisible(t.Owner, username) {
				continue
			}
			taskList = append(taskList, t)
		}

		// 读取用户设置中的任务顺序
		var govTaskOrder []string
		if user, ok := dataOntologyUsers[username]; ok && user.Settings != nil {
			if order, ok := user.Settings["govTaskOrder"].([]string); ok {
				govTaskOrder = order
			} else if orderInterface, ok := user.Settings["govTaskOrder"].([]interface{}); ok {
				// JSON 反序列化可能产生 []interface{}
				for _, id := range orderInterface {
					if idStr, ok := id.(string); ok {
						govTaskOrder = append(govTaskOrder, idStr)
					}
				}
			}
		}

		// 如果有自定义排序，按该顺序排序
		if len(govTaskOrder) > 0 {
			orderMap := make(map[string]int)
			for i, id := range govTaskOrder {
				orderMap[id] = i
			}
			sort.Slice(taskList, func(i, j int) bool {
				iIdx, iOk := orderMap[taskList[i].ID]
				jIdx, jOk := orderMap[taskList[j].ID]
				// 如果两个任务都在排序中，按排序顺序
				if iOk && jOk {
					return iIdx < jIdx
				}
				// 如果只有一个在排序中，排序中的排前面
				if iOk {
					return true
				}
				if jOk {
					return false
				}
				// 如果都不在排序中，按创建时间降序
				if taskList[i].CreatedAt != taskList[j].CreatedAt {
					return taskList[i].CreatedAt > taskList[j].CreatedAt
				}
				return taskList[i].Name < taskList[j].Name
			})
		} else {
			// 如果没有自定义排序，按创建时间降序 + 名称升序
			sort.Slice(taskList, func(i, j int) bool {
				if taskList[i].CreatedAt != taskList[j].CreatedAt {
					return taskList[i].CreatedAt > taskList[j].CreatedAt
				}
				return taskList[i].Name < taskList[j].Name
			})
		}

		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "tasks": taskList})

	case http.MethodPost:
		var task GovernanceTask
		if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
			return
		}
		if task.Name == "" || task.Type == "" || task.JsCode == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务名称、类型和Go代码不能为空"})
			return
		}
		if task.DatabaseID != "" {
			dataOntologyMu.RLock()
			dc, dbOk := dataOntologyDatabases[task.DatabaseID]
			dataOntologyMu.RUnlock()
			if !dbOk || !dataOntologyResourceVisible(dc.Owner, username) {
				json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "数据库不存在"})
				return
			}
		}
		task.ExampleFiles = nil
		task.ID = uuid.New().String()
		task.Owner = username
		task.CreatedAt = time.Now().Format(time.RFC3339)
		task.Status = "idle"
		if task.Type == "scheduled" && task.Enabled {
			task.Enabled = true
		}
		if task.RunMode == "" {
			task.RunMode = task.Runtime
		}
		if task.ExecutionMode == "" {
			// scheduled 类型默认使用 backend 执行模式
			if task.Type == "scheduled" {
				task.ExecutionMode = "backend"
			} else {
				task.ExecutionMode = task.RunMode
			}
		}
		// 处理分享：如果前端传了 share_enabled=true，使用前端传的 token 或自动生成
		if task.ShareEnabled {
			if task.ShareToken == "" {
				task.ShareToken = uuid.New().String()
			} else {
				// 检查 share_token 是否冲突
				for id, existing := range governanceTasks {
					if id == task.ID {
						continue
					}
					if existing.ShareToken == task.ShareToken {
						// 冲突，自动重新生成
						task.ShareToken = uuid.New().String()
						log.Printf("[治理任务] share_token 冲突，自动重新生成: %s", task.ShareToken)
						break
					}
				}
			}
		}
		// 处理 API 注册：如果 register_as_api=true，自动启用任务（否则 API 无法调用）
		if task.RegisterAsAPI {
			task.Enabled = true
			// 检查 api_path 是否冲突
			if task.APIPath != "" {
				for id, existing := range governanceTasks {
					if id == task.ID {
						continue
					}
					if existing.APIPath == task.APIPath {
						// 冲突，自动重新生成
						task.APIPath = task.APIPath + "-" + uuid.New().String()[:8]
						log.Printf("[治理任务] api_path 冲突，自动重新生成: %s", task.APIPath)
						break
					}
				}
			}
		}

		dataOntologyMu.Lock()
		governanceTasks[task.ID] = &task
		dataOntologyMu.Unlock()

		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存治理任务失败: %v", err)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "task": task})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
	}
}

// handleGovernanceTaskDetail 处理单个治理任务的 GET/PUT/DELETE

// ==================== HITL (Human-in-the-Loop) API Handlers ====================

// hitlRespondRequest HITL 响应提交请求
type hitlRespondRequest struct {
	HitlID string         `json:"hitl_id"`
	Action string         `json:"action"` // submit | cancel
	Values map[string]any `json:"values,omitempty"`
}

// handleHITLRespond 处理用户提交 HITL 响应
// POST /api/hitl/respond
func handleHITLRespond(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}

	var req hitlRespondRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}

	if req.HitlID == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "hitl_id 不能为空"})
		return
	}
	if req.Action == "" {
		req.Action = "submit"
	}
	if req.Action != "submit" && req.Action != "cancel" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "action 必须是 submit 或 cancel"})
		return
	}

	// 获取全局 HITLManager
	if globalHITLManager == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "HITL 系统未初始化"})
		return
	}

	resp := agent.HITLResponse{
		HitlID:    req.HitlID,
		Action:    req.Action,
		Values:    req.Values,
		Timestamp: time.Now(),
	}

	if err := globalHITLManager.SubmitResponse(req.HitlID, resp); err != nil {
		// 幂等处理：entry 不存在可能是服务器重启、agent已超时消费、重复提交
		// 这些都是正常场景，不应阻止前端 UI 更新
		log.Printf("[hitl] SubmitResponse idempotent: hitl_id=%s, err=%v", req.HitlID, err)
	}

	log.Printf("[hitl] response submitted: hitl_id=%s, action=%s", req.HitlID, req.Action)
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "响应已提交"})
}

// handleHITLPending 查询指定 session 的挂起 HITL 请求
// GET /api/hitl/pending?session_id=xxx
func handleHITLPending(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}

	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "session_id 参数不能为空"})
		return
	}

	// 获取全局 HITLManager
	if globalHITLManager == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "HITL 系统未初始化"})
		return
	}

	requests := globalHITLManager.GetPendingRequests(sessionID)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"requests": requests,
		"count":    len(requests),
	})
}

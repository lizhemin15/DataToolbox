package main

import (
	"bytes"
	"crypto/tls"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

func handleTableStructureUpdate(w http.ResponseWriter, r *http.Request, config *DatabaseConfig, tableName string) {
	// 解析请求
	var req TableStructureUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求格式错误: " + err.Error(),
		})
		return
	}

	if len(req.Columns) == 0 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "至少需要一个列",
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

	// 获取当前表结构
	var query string
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb":
		query = fmt.Sprintf(`
			SELECT column_name, data_type, is_nullable
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
			SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
			FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_NAME = '%s'
			ORDER BY ORDINAL_POSITION
		`, tableName)
	case "dm", "oracle":
		if config.Type == "oracle" {
			query = oracleTableColumnsSQL(tableName, false)
		} else {
			query = fmt.Sprintf(`
			SELECT COLUMN_NAME, DATA_TYPE, NULLABLE
			FROM USER_TAB_COLUMNS
			WHERE TABLE_NAME = '%s'
			ORDER BY COLUMN_ID
		`, oracleEscapeIdentifier(tableName))
		}
	default:
		query = fmt.Sprintf("DESCRIBE `%s`", tableName)
	}

	rows, err := db.Query(query)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "查询表结构失败: " + err.Error(),
		})
		return
	}

	// 获取现有列
	existingColumns := make(map[string]bool)
	for rows.Next() {
		var colName string

		switch config.Type {
		case "mysql", "mariadb", "tidb":
			var colType, nullable interface{}
			var key, defaultVal, extra interface{}
			if err := rows.Scan(&colName, &colType, &nullable, &key, &defaultVal, &extra); err == nil {
				existingColumns[colName] = true
			}
		case "postgresql", "timescaledb", "cockroachdb", "sqlserver":
			var colType, nullable interface{}
			var defaultVal interface{}
			if err := rows.Scan(&colName, &colType, &nullable, &defaultVal); err == nil {
				existingColumns[colName] = true
			}
		case "dm", "oracle":
			var colType, nullable interface{}
			if err := rows.Scan(&colName, &colType, &nullable); err == nil {
				existingColumns[colName] = true
			}
		case "sqlite", "duckdb":
			var cid, notnull, pk int
			var colType string
			var dfltValue interface{}
			if err := rows.Scan(&cid, &colName, &colType, &notnull, &dfltValue, &pk); err == nil {
				existingColumns[colName] = true
			}
		}
	}
	rows.Close()

	// 达梦：查询自增列，修改表结构时不得 MODIFY 自增列（否则报 -2664）
	identityColumns := make(map[string]bool)
	if config.Type == "dm" {
		tblUpper := oracleEscapeIdentifier(tableName)
		identQuery := fmt.Sprintf(`
			SELECT a.NAME FROM SYS.SYSCOLUMNS a, SYS.SYSOBJECTS b
			WHERE b.ID = a.ID AND b.NAME = '%s' AND (a.INFO2 & 0x01) = 0x01
		`, tblUpper)
		identRows, err := db.Query(identQuery)
		if err == nil {
			for identRows.Next() {
				var colName string
				if err := identRows.Scan(&colName); err == nil {
					identityColumns[strings.ToUpper(colName)] = true
				}
			}
			identRows.Close()
		}
	}

	// SQLite需要重建表（不支持ALTER COLUMN）
	if config.Type == "sqlite" || config.Type == "duckdb" {
		err = rebuildTableForSQLite(db, tableName, req.Columns)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "修改表结构失败: " + err.Error(),
			})
			return
		}
	} else {
		// MySQL等数据库使用ALTER TABLE
		alterStatements := make([]string, 0)
		newColumns := make(map[string]bool)

		// 收集新列名
		for _, col := range req.Columns {
			newColumns[col.Name] = true
		}

		// 添加新列或修改现有列
		for _, col := range req.Columns {
			colDef := col.Type
			if col.Size != "" && (col.Type == "VARCHAR" || col.Type == "CHAR") {
				colDef = fmt.Sprintf("%s(%s)", col.Type, col.Size)
			}

			nullClause := ""
			if !col.Nullable {
				nullClause = " NOT NULL"
			}

			tblUpper := strings.ToUpper(tableName)
			colUpper := strings.ToUpper(col.Name)
			var alterSQL string
			if existingColumns[col.Name] {
				// 达梦不允许修改自增列，跳过
				if config.Type == "dm" && identityColumns[colUpper] {
					continue
				}
				// 修改现有列
				switch config.Type {
				case "postgresql", "timescaledb", "cockroachdb":
					alterSQL = fmt.Sprintf(`ALTER TABLE "%s" ALTER COLUMN "%s" TYPE %s`, tableName, col.Name, colDef)
					if !col.Nullable {
						alterSQL += fmt.Sprintf(`, ALTER COLUMN "%s" SET NOT NULL`, col.Name)
					} else {
						alterSQL += fmt.Sprintf(`, ALTER COLUMN "%s" DROP NOT NULL`, col.Name)
					}
				case "sqlserver":
					alterSQL = fmt.Sprintf("ALTER TABLE [%s] ALTER COLUMN [%s] %s%s", tableName, col.Name, colDef, nullClause)
				case "dm", "oracle":
					// 达梦语法：MODIFY 后直接跟列名，不加 COLUMN 关键字（避免 -2007 语法解析错误）
					alterSQL = fmt.Sprintf("ALTER TABLE %s MODIFY %s %s%s", tblUpper, colUpper, colDef, nullClause)
				default: // MySQL
					alterSQL = fmt.Sprintf("ALTER TABLE `%s` MODIFY COLUMN `%s` %s%s", tableName, col.Name, colDef, nullClause)
				}
			} else {
				// 添加新列
				switch config.Type {
				case "postgresql", "timescaledb", "cockroachdb":
					alterSQL = fmt.Sprintf(`ALTER TABLE "%s" ADD COLUMN "%s" %s%s`, tableName, col.Name, colDef, nullClause)
				case "sqlserver":
					alterSQL = fmt.Sprintf("ALTER TABLE [%s] ADD [%s] %s%s", tableName, col.Name, colDef, nullClause)
				case "dm", "oracle":
					alterSQL = fmt.Sprintf("ALTER TABLE %s ADD %s %s%s", tblUpper, colUpper, colDef, nullClause)
				default: // MySQL
					alterSQL = fmt.Sprintf("ALTER TABLE `%s` ADD COLUMN `%s` %s%s", tableName, col.Name, colDef, nullClause)
				}
			}
			alterStatements = append(alterStatements, alterSQL)
		}

		// 删除不存在的列
		for colName := range existingColumns {
			if !newColumns[colName] {
				var dropSQL string
				switch config.Type {
				case "postgresql", "timescaledb", "cockroachdb":
					dropSQL = fmt.Sprintf(`ALTER TABLE "%s" DROP COLUMN "%s"`, tableName, colName)
				case "sqlserver":
					dropSQL = fmt.Sprintf("ALTER TABLE [%s] DROP COLUMN [%s]", tableName, colName)
				case "dm", "oracle":
					dropSQL = fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", strings.ToUpper(tableName), strings.ToUpper(colName))
				default: // MySQL
					dropSQL = fmt.Sprintf("ALTER TABLE `%s` DROP COLUMN `%s`", tableName, colName)
				}
				alterStatements = append(alterStatements, dropSQL)
			}
		}

		// 执行所有ALTER语句
		for _, stmt := range alterStatements {
			log.Printf("执行: %s", stmt)
			if _, err := db.Exec(stmt); err != nil {
				json.NewEncoder(w).Encode(map[string]interface{}{
					"success": false,
					"message": "修改表结构失败: " + err.Error() + " (SQL: " + stmt + ")",
				})
				return
			}
		}
	}

	log.Printf("表 %s 结构修改成功", tableName)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "表结构修改成功",
	})
}

// rebuildTableForSQLite SQLite重建表以修改结构

func rebuildTableForSQLite(db *sql.DB, tableName string, columns []struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Size     string `json:"size"`
	Nullable bool   `json:"nullable"`
}) error {
	// 创建新表
	newTableName := tableName + "_new"
	columnDefs := make([]string, 0)

	for _, col := range columns {
		colDef := fmt.Sprintf("`%s` %s", col.Name, col.Type)
		if col.Size != "" && (col.Type == "VARCHAR" || col.Type == "CHAR" || col.Type == "TEXT") {
			colDef = fmt.Sprintf("`%s` %s(%s)", col.Name, col.Type, col.Size)
		}
		if !col.Nullable {
			colDef += " NOT NULL"
		}
		columnDefs = append(columnDefs, colDef)
	}

	createSQL := fmt.Sprintf("CREATE TABLE `%s` (\n    %s\n)", newTableName, strings.Join(columnDefs, ",\n    "))
	log.Printf("创建新表: %s", createSQL)
	if _, err := db.Exec(createSQL); err != nil {
		return fmt.Errorf("创建新表失败: %w", err)
	}

	// 复制数据（只复制存在的列）
	columnNames := make([]string, len(columns))
	for i, col := range columns {
		columnNames[i] = fmt.Sprintf("`%s`", col.Name)
	}
	copySQL := fmt.Sprintf("INSERT INTO `%s` (%s) SELECT %s FROM `%s`",
		newTableName, strings.Join(columnNames, ", "), strings.Join(columnNames, ", "), tableName)
	log.Printf("复制数据: %s", copySQL)
	if _, err := db.Exec(copySQL); err != nil {
		log.Printf("警告: 复制数据失败（可能是列不匹配）: %v", err)
		// 不返回错误，允许继续
	}

	// 删除旧表
	dropSQL := fmt.Sprintf("DROP TABLE `%s`", tableName)
	log.Printf("删除旧表: %s", dropSQL)
	if _, err := db.Exec(dropSQL); err != nil {
		return fmt.Errorf("删除旧表失败: %w", err)
	}

	// 重命名新表
	renameSQL := fmt.Sprintf("ALTER TABLE `%s` RENAME TO `%s`", newTableName, tableName)
	log.Printf("重命名表: %s", renameSQL)
	if _, err := db.Exec(renameSQL); err != nil {
		return fmt.Errorf("重命名表失败: %w", err)
	}

	return nil
}

// TableRenameRequest 重命名表请求

type TableRenameRequest struct {
	NewName string `json:"new_name"`
}

// handleTableRename 重命名表

func handleTableRename(w http.ResponseWriter, r *http.Request, config *DatabaseConfig, tableName string) {
	w.Header().Set("Content-Type", "application/json")
	if config.Type == "mongodb" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "MongoDB 暂不支持重命名表"})
		return
	}
	var req TableRenameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}
	newName := strings.TrimSpace(req.NewName)
	if newName == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "新表名不能为空"})
		return
	}
	// 安全验证：检查新表名是否合法
	if !isValidIdentifier(newName) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "无效的新表名"})
		return
	}
	if newName == tableName {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "新表名与当前表名相同"})
		return
	}
	// 使用连接池
	db, err := getDBFromPool(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "连接失败"})
		return
	}

	var renameSQL string
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb":
		renameSQL = fmt.Sprintf(`ALTER TABLE "%s" RENAME TO "%s"`, tableName, newName)
	case "sqlserver":
		renameSQL = fmt.Sprintf("EXEC sp_rename '%s', '%s'", tableName, newName)
	case "dm", "oracle":
		renameSQL = fmt.Sprintf("ALTER TABLE %s RENAME TO %s", strings.ToUpper(tableName), strings.ToUpper(newName))
	case "mysql", "mariadb", "tidb":
		renameSQL = fmt.Sprintf("ALTER TABLE `%s` RENAME TO `%s`", tableName, newName)
	case "sqlite", "duckdb":
		renameSQL = fmt.Sprintf("ALTER TABLE \"%s\" RENAME TO \"%s\"", tableName, newName)
	default:
		renameSQL = fmt.Sprintf("ALTER TABLE `%s` RENAME TO `%s`", tableName, newName)
	}
	if _, err := db.Exec(renameSQL); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "重命名失败: " + err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "表已重命名", "new_name": newName})
}

// handleTableDrop 删除表

func handleTableDrop(w http.ResponseWriter, r *http.Request, config *DatabaseConfig, tableName string) {
	// 只支持SQL数据库
	if config.Type == "mongodb" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "MongoDB暂不支持此功能",
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

	// 构建DROP TABLE语句
	var dropQuery string
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb":
		dropQuery = fmt.Sprintf(`DROP TABLE IF EXISTS "%s"`, tableName)
	case "oracle", "dm":
		dropQuery = fmt.Sprintf("DROP TABLE %s", tableName)
	case "sqlserver":
		dropQuery = fmt.Sprintf("DROP TABLE IF EXISTS [%s]", tableName)
	default:
		dropQuery = fmt.Sprintf("DROP TABLE IF EXISTS `%s`", tableName)
	}

	log.Printf("执行删除表: %s", dropQuery)
	_, err = db.Exec(dropQuery)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "删除表失败: " + err.Error(),
		})
		return
	}

	log.Printf("表 %s 删除成功", tableName)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "表删除成功",
	})
}

// TableCreateRequest 创建表请求

type TableCreateRequest struct {
	Name    string `json:"name"`
	Columns []struct {
		Name          string `json:"name"`
		Type          string `json:"type"`
		Size          string `json:"size"`
		NotNull       bool   `json:"not_null"`
		PrimaryKey    bool   `json:"primary_key"`
		AutoIncrement bool   `json:"auto_increment"`
	} `json:"columns"`
}

// handleTableCreate 创建表

func handleTableCreate(w http.ResponseWriter, r *http.Request, config *DatabaseConfig) {
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "只支持POST请求",
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

	var req TableCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求格式错误: " + err.Error(),
		})
		return
	}

	if req.Name == "" || len(req.Columns) == 0 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "表名和字段不能为空",
		})
		return
	}

	// 安全验证：检查表名是否合法
	if !isValidIdentifier(req.Name) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的表名",
		})
		return
	}

	// 安全验证：检查列名是否合法
	for _, col := range req.Columns {
		if !isValidIdentifier(col.Name) {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "无效的列名: " + col.Name,
			})
			return
		}
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

	// 构建CREATE TABLE语句
	// 根据数据库类型选择标识符引用符
	var quoteChar string
	switch config.Type {
	case "postgresql", "timescaledb", "cockroachdb", "dm":
		quoteChar = `"`
	case "sqlserver":
		quoteChar = "["
	case "oracle":
		quoteChar = "" // Oracle 不使用引用符或使用双引号
	default:
		quoteChar = "`"
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

	columnDefs := make([]string, 0)
	primaryKeys := make([]string, 0)

	for _, col := range req.Columns {
		colDef := fmt.Sprintf("%s %s", quoteIdentifier(col.Name), col.Type)

		// 添加长度
		if col.Size != "" && (col.Type == "VARCHAR" || col.Type == "CHAR") {
			colDef = fmt.Sprintf("%s %s(%s)", quoteIdentifier(col.Name), col.Type, col.Size)
		}

		// 添加NOT NULL
		if col.NotNull {
			colDef += " NOT NULL"
		}

		// 添加AUTO_INCREMENT
		if col.AutoIncrement {
			switch config.Type {
			case "postgresql", "timescaledb", "cockroachdb":
				colDef = fmt.Sprintf(`"%s" SERIAL`, col.Name)
			case "sqlserver":
				colDef = fmt.Sprintf("[%s] %s IDENTITY(1,1)", col.Name, col.Type)
			case "dm":
				colDef = fmt.Sprintf(`"%s" %s IDENTITY(1,1)`, col.Name, col.Type)
			case "oracle":
				// Oracle 使用序列，这里简化处理
				colDef = fmt.Sprintf("%s %s GENERATED ALWAYS AS IDENTITY", col.Name, col.Type)
			default:
				colDef += " AUTO_INCREMENT"
			}
		}

		columnDefs = append(columnDefs, colDef)

		// 收集主键
		if col.PrimaryKey {
			primaryKeys = append(primaryKeys, quoteIdentifier(col.Name))
		}
	}

	// 添加主键约束
	if len(primaryKeys) > 0 {
		columnDefs = append(columnDefs, fmt.Sprintf("PRIMARY KEY (%s)", strings.Join(primaryKeys, ", ")))
	}

	createQuery := fmt.Sprintf("CREATE TABLE %s (\n    %s\n)",
		quoteIdentifier(req.Name), strings.Join(columnDefs, ",\n    "))

	log.Printf("执行创建表: %s", createQuery)
	_, err = db.Exec(createQuery)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "创建表失败: " + err.Error(),
		})
		return
	}

	log.Printf("表 %s 创建成功", req.Name)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "表创建成功",
	})
}

// ==================== 接口管理功能 ====================

// handleApis 处理接口列表的GET和POST请求

func handleApis(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	switch r.Method {
	case http.MethodGet:
		// 获取接口列表
		dataOntologyMu.RLock()
		defer dataOntologyMu.RUnlock()

		apiList := make([]*ApiInfo, 0, len(dataOntologyApis))
		for _, api := range dataOntologyApis {
			enabled := api.Enabled == nil || *api.Enabled
			apiType := api.Type
			if apiType == "" {
				apiType = "query"
			}
			apiInfo := &ApiInfo{
				ID:            api.ID,
				Name:          api.Name,
				Path:          api.Path,
				Method:        api.Method,
				Type:          apiType,
				DatabaseID:    api.DatabaseID,
				ForwardURL:    api.ForwardURL,
				Description:   api.Description,
				DefaultParams: api.DefaultParams,
				Enabled:       enabled,
			}
			if db, exists := dataOntologyDatabases[api.DatabaseID]; exists {
				apiInfo.DatabaseName = db.Name
			}
			apiList = append(apiList, apiInfo)
		}

		jsonSuccess(w, map[string]interface{}{"apis": apiList})

	case http.MethodPost:
		// 添加新接口
		var apiConfig ApiConfig
		if err := json.NewDecoder(r.Body).Decode(&apiConfig); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}

		// 标准化接口类型
		if apiConfig.Type == "" {
			apiConfig.Type = "query"
		}

		// 标准化 path 和 method
		apiConfig.Path = strings.ToLower(strings.TrimSpace(apiConfig.Path))
		apiConfig.Method = strings.ToUpper(strings.TrimSpace(apiConfig.Method))

		// 验证必填字段
		if apiConfig.Name == "" || apiConfig.Path == "" || apiConfig.Method == "" {
			apiInvalidInput(w, "缺少必填字段")
			return
		}

		// 验证路径格式：必须是 /api/xxx/yyy（两级路径）
		if !isValidApiPath(apiConfig.Path) {
			apiInvalidInput(w, "接口路径格式错误，必须是 /api/xxx/yyy 格式（两级路径）")
			return
		}

		// 验证 path+method 唯一性
		dataOntologyMu.RLock()
		for _, existingApi := range dataOntologyApis {
			if existingApi.Path == apiConfig.Path && strings.EqualFold(existingApi.Method, apiConfig.Method) {
				dataOntologyMu.RUnlock()
				apiInvalidInput(w, fmt.Sprintf("接口路径 %s (%s) 已存在", apiConfig.Path, apiConfig.Method))
				return
			}
		}
		dataOntologyMu.RUnlock()

		if apiConfig.Type == "forward" {
			if apiConfig.ForwardURL == "" {
				apiInvalidInput(w, "转发类型接口必须填写转发URL")
				return
			}
		} else {
			if apiConfig.DatabaseID == "" || apiConfig.SQL == "" {
				apiInvalidInput(w, "缺少必填字段")
				return
			}
			// 验证数据库是否存在
			dataOntologyMu.RLock()
			_, dbExists := dataOntologyDatabases[apiConfig.DatabaseID]
			dataOntologyMu.RUnlock()
			if !dbExists {
				apiNotFound(w, "数据库不存在")
				return
			}
		}

		// 生成ID
		apiConfig.ID = uuid.New().String()

		// 保存接口配置
		dataOntologyMu.Lock()
		dataOntologyApis[apiConfig.ID] = &apiConfig
		dataOntologyMu.Unlock()

		// 持久化
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存接口配置失败: %v", err)
		}

		jsonSuccess(w, map[string]interface{}{"api": apiConfig})

	default:
		apiMethodNotAllowed(w, "不支持的请求方法")
	}
}

// handleApiDetail 处理单个接口的GET、PUT、DELETE请求

func handleApiDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	// 提取接口ID
	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/v1/openapis/"), "/")
	if len(pathParts) == 0 || pathParts[0] == "" {
		apiBadRequest(w, "缺少接口ID")
		return
	}
	apiID := pathParts[0]

	switch r.Method {
	case http.MethodGet:
		// 获取接口详情
		dataOntologyMu.RLock()
		api, exists := dataOntologyApis[apiID]
		if !exists {
			dataOntologyMu.RUnlock()
			apiNotFound(w, "接口不存在")
			return
		}

		apiType := api.Type
		if apiType == "" {
			apiType = "query"
		}
		apiInfo := &ApiInfo{
			ID:            api.ID,
			Name:          api.Name,
			Path:          api.Path,
			Method:        api.Method,
			Type:          apiType,
			DatabaseID:    api.DatabaseID,
			SQL:           api.SQL,
			ForwardURL:    api.ForwardURL,
			Description:   api.Description,
			DefaultParams: api.DefaultParams,
			Enabled:       api.Enabled == nil || *api.Enabled,
		}
		if db, dbExists := dataOntologyDatabases[api.DatabaseID]; dbExists {
			apiInfo.DatabaseName = db.Name
		}
		dataOntologyMu.RUnlock()

		jsonSuccess(w, map[string]interface{}{"api": apiInfo})

	case http.MethodPut:
		// 更新接口
		var apiUpdate ApiConfig
		if err := json.NewDecoder(r.Body).Decode(&apiUpdate); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}

		dataOntologyMu.Lock()
		api, exists := dataOntologyApis[apiID]
		if !exists {
			dataOntologyMu.Unlock()
			apiNotFound(w, "接口不存在")
			return
		}

		// 标准化接口类型
		updateType := apiUpdate.Type
		if updateType == "" {
			updateType = api.Type
		}
		if updateType == "" {
			updateType = "query"
		}

		// query类型才需要验证数据库
		if updateType == "query" && apiUpdate.DatabaseID != "" {
			if _, dbExists := dataOntologyDatabases[apiUpdate.DatabaseID]; !dbExists {
				dataOntologyMu.Unlock()
				apiNotFound(w, "数据库不存在")
				return
			}
		}

		// 更新字段
		newPath := api.Path
		newMethod := api.Method
		if apiUpdate.Path != "" {
			// 标准化路径
			normalizedPath := strings.ToLower(strings.TrimSpace(apiUpdate.Path))
			// 验证路径格式
			if !isValidApiPath(normalizedPath) {
				dataOntologyMu.Unlock()
				apiInvalidInput(w, "接口路径格式错误，必须是 /api/xxx/yyy 格式（两级路径）")
				return
			}
			newPath = normalizedPath
			api.Path = normalizedPath
		}
		if apiUpdate.Method != "" {
			// 标准化方法
			normalizedMethod := strings.ToUpper(strings.TrimSpace(apiUpdate.Method))
			newMethod = normalizedMethod
			api.Method = normalizedMethod
		}
		// 验证新的 path+method 唯一性（排除自身）
		for _, existingApi := range dataOntologyApis {
			if existingApi.ID != apiID && existingApi.Path == newPath && strings.EqualFold(existingApi.Method, newMethod) {
				dataOntologyMu.Unlock()
				apiInvalidInput(w, fmt.Sprintf("接口路径 %s (%s) 已存在", newPath, newMethod))
				return
			}
		}
		if apiUpdate.Name != "" {
			api.Name = apiUpdate.Name
		}
		api.Type = updateType
		if updateType == "query" {
			if apiUpdate.DatabaseID != "" {
				api.DatabaseID = apiUpdate.DatabaseID
			}
			if apiUpdate.SQL != "" {
				api.SQL = apiUpdate.SQL
			}
			api.ForwardURL = ""
		} else {
			api.ForwardURL = apiUpdate.ForwardURL
			api.DatabaseID = ""
			api.SQL = ""
		}
		api.Description = apiUpdate.Description
		api.DefaultParams = apiUpdate.DefaultParams
		if apiUpdate.Enabled != nil {
			api.Enabled = apiUpdate.Enabled
		}
		dataOntologyMu.Unlock()

		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存接口配置失败: %v", err)
		}
		jsonSuccess(w, map[string]interface{}{"api": api})

	case http.MethodDelete:
		// 删除接口
		dataOntologyMu.Lock()
		if _, exists := dataOntologyApis[apiID]; !exists {
			dataOntologyMu.Unlock()
			apiNotFound(w, "接口不存在")
			return
		}

		delete(dataOntologyApis, apiID)
		dataOntologyMu.Unlock()

		// 持久化
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存接口配置失败: %v", err)
		}

		jsonSuccess(w, nil)

	default:
		apiMethodNotAllowed(w, "不支持的请求方法")
	}
}

// handleApiDispatch 处理用户定义路径的外部API调用

func handleApiDispatch(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqPath := r.URL.Path
		reqMethod := r.Method

		if reqMethod == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}

		// 先检查是否有匹配的数据治理任务 API
		dataOntologyMu.RLock()
		var matchedTask *GovernanceTask
		for _, task := range governanceTasks {
			if task.RegisterAsAPI && task.APIPath == reqPath && strings.EqualFold(task.APIMethod, reqMethod) {
				matchedTask = task
				break
			}
		}
		dataOntologyMu.RUnlock()

		if matchedTask != nil {
			// 找到匹配的任务，执行任务
			if !matchedTask.Enabled {
				apiForbidden(w, "该任务已禁用")
				return
			}

			// 治理任务 API 调用免鉴权

			// 解析请求参数
			params := make(map[string]interface{})
			isBodyMethod := reqMethod == http.MethodPost || reqMethod == http.MethodPut || reqMethod == http.MethodPatch

			// 支持 multipart/form-data 文件上传
			contentType := r.Header.Get("Content-Type")
			if isBodyMethod && strings.Contains(contentType, "multipart/form-data") {
				maxSize := int64(100 * 1024 * 1024) // 100MB
				r.Body = http.MaxBytesReader(w, r.Body, maxSize)
				if err := r.ParseMultipartForm(maxSize); err != nil {
					jsonError(w, "解析表单失败: "+err.Error(), "")
					return
				}
				// 读取表单字段
				for k, v := range r.MultipartForm.Value {
					if len(v) == 1 {
						params[k] = v[0]
					} else {
						params[k] = v
					}
				}
				// 读取上传文件
				var files []map[string]interface{}
				for _, fh := range r.MultipartForm.File["files"] {
					f, err := fh.Open()
					if err != nil {
						continue
					}
					data, err := io.ReadAll(f)
					f.Close()
					if err != nil {
						continue
					}
					files = append(files, map[string]interface{}{
						"file_name":   fh.Filename,
						"file_base64": base64.StdEncoding.EncodeToString(data),
					})
				}
				if len(files) > 0 {
					params["files"] = files
				}
			} else if isBodyMethod && r.Body != nil {
				json.NewDecoder(r.Body).Decode(&params)
			}
			for k, v := range r.URL.Query() {
				if _, exists := params[k]; !exists {
					if len(v) == 1 {
						params[k] = v[0]
					} else {
						params[k] = v
					}
				}
			}

			// 执行任务
			result, err := executeGovernanceTaskForAPI(matchedTask, params)
			w.Header().Set("Content-Type", "application/json")
			if err != nil {
				log.Printf("[API] 任务执行失败: task=%s, err=%v", matchedTask.Name, err)
				jsonError(w, "任务执行失败: "+err.Error(), "")
				return
			}
			log.Printf("[API] 任务执行成功: task=%s, path=%s", matchedTask.Name, reqPath)
			jsonSuccess(w, map[string]interface{}{"success": true, "data": result})
			return
		}

		dataOntologyMu.RLock()
		var matchedApi *ApiConfig
		var matchedDb *DatabaseConfig
		for _, api := range dataOntologyApis {
			if api.Path == reqPath && strings.EqualFold(api.Method, reqMethod) {
				matchedApi = api
				apiType := api.Type
				if apiType == "" {
					apiType = "query"
				}
				if apiType == "query" {
					if db, ok := dataOntologyDatabases[api.DatabaseID]; ok {
						matchedDb = db
					}
				}
				break
			}
		}
		dataOntologyMu.RUnlock()

		if matchedApi == nil {
			next.ServeHTTP(w, r)
			return
		}

		apiType := matchedApi.Type
		if apiType == "" {
			apiType = "query"
		}

		// query类型需要数据库
		if apiType == "query" && matchedDb == nil {
			next.ServeHTTP(w, r)
			return
		}

		if matchedApi.Enabled != nil && !*matchedApi.Enabled {
			apiForbidden(w, "该接口已关闭")
			return
		}

		if !verifyToken(r) {
			apiUnauthorized(w, "未授权，请提供有效的 API Key 或 Token")
			return
		}

		if apiType == "forward" {
			executeForwardRequest(w, r, matchedApi.ForwardURL)
			return
		}

		// query类型：执行SQL查询
		w.Header().Set("Content-Type", "application/json")

		// 先用默认参数初始化
		params := make(map[string]interface{})
		if matchedApi.DefaultParams != nil {
			log.Printf("[API] 使用默认参数: api=%s, default_params=%v", matchedApi.Name, matchedApi.DefaultParams)
			for k, v := range matchedApi.DefaultParams {
				params[k] = v
			}
		} else {
			log.Printf("[API] 无默认参数: api=%s", matchedApi.Name)
		}
		// 再合并请求参数（覆盖默认值）
		isBodyMethod := reqMethod == http.MethodPost || reqMethod == http.MethodPut || reqMethod == http.MethodPatch
		if isBodyMethod && r.Body != nil {
			json.NewDecoder(r.Body).Decode(&params)
		}
		for k, v := range r.URL.Query() {
			// 请求参数覆盖默认值
			if len(v) == 1 {
				params[k] = v[0]
			} else {
				params[k] = v
			}
		}

		finalSQL, args, err := parseMyBatisSQL(matchedApi.SQL, params)
		if err != nil {
			log.Printf("[API] SQL解析失败: api=%s, err=%v", matchedApi.Name, err)
			jsonError(w, "SQL解析失败: "+err.Error(), "")
			return
		}

		result, err := executeSQLQuery(matchedDb, finalSQL, args)
		if err != nil {
			log.Printf("[API] 查询失败: api=%s, db=%s, err=%v", matchedApi.Name, matchedDb.Name, err)
			jsonError(w, "查询失败: "+err.Error(), "")
			return
		}

		log.Printf("[API] 查询成功: api=%s, path=%s", matchedApi.Name, reqPath)
		jsonSuccess(w, map[string]interface{}{"success": true, "data": result})
	})
}

// executeForwardRequest 将请求原样转发到目标URL并回写响应

func executeForwardRequest(w http.ResponseWriter, r *http.Request, targetURL string) {
	var bodyBytes []byte
	if r.Body != nil {
		var err error
		bodyBytes, err = io.ReadAll(r.Body)
		if err != nil {
			apiBadRequest(w, "读取请求体失败")
			return
		}
	}

	proxyReq, err := http.NewRequest(r.Method, targetURL, bytes.NewReader(bodyBytes))
	if err != nil {
		log.Printf("[API] 构建转发请求失败: target=%s, err=%v", targetURL, err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		jsonError(w, "构建转发请求失败: "+err.Error(), "")
		return
	}

	// 透传 query string
	proxyReq.URL.RawQuery = r.URL.RawQuery

	// 透传请求头（排除 Authorization，避免将内部 Token 泄露给目标服务）
	for key, vals := range r.Header {
		if strings.EqualFold(key, "Authorization") {
			continue
		}
		for _, v := range vals {
			proxyReq.Header.Add(key, v)
		}
	}

	// 转发请求跳过TLS证书验证（目标可能是自签名证书或IP无SAN）
	insecureTransport := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{Timeout: HTTPClientTimeout, Transport: insecureTransport}
	resp, err := client.Do(proxyReq)
	if err != nil {
		log.Printf("[API] 转发请求失败: target=%s, err=%v", targetURL, err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		jsonError(w, "转发请求失败: "+err.Error(), "")
		return
	}
	defer resp.Body.Close()

	// 回写响应头和状态码
	for key, vals := range resp.Header {
		for _, v := range vals {
			w.Header().Add(key, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// handleApiTest 处理接口测试请求

func handleApiTest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method != http.MethodPost {
		apiMethodNotAllowed(w, "只支持POST请求")
		return
	}

	// 提取接口ID
	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/v1/openapis/"), "/")
	if len(pathParts) < 2 || pathParts[0] == "" {
		apiBadRequest(w, "缺少接口ID")
		return
	}
	apiID := pathParts[0]

	// 解析测试参数
	var testReq struct {
		Params map[string]interface{} `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&testReq); err != nil {
		apiBadRequest(w, "请求格式错误")
		return
	}

	// 获取接口配置
	dataOntologyMu.RLock()
	api, exists := dataOntologyApis[apiID]
	if !exists {
		dataOntologyMu.RUnlock()
		apiNotFound(w, "接口不存在")
		return
	}
	if api.Enabled != nil && !*api.Enabled {
		dataOntologyMu.RUnlock()
		apiBadRequest(w, "该接口已关闭")
		return
	}
	apiType := api.Type
	if apiType == "" {
		apiType = "query"
	}

	if apiType == "forward" {
		forwardURL := api.ForwardURL
		apiMethod := api.Method
		dataOntologyMu.RUnlock()

		// 构建转发URL，将测试参数作为 query string 或 body 传递
		targetURL := forwardURL
		if apiMethod == http.MethodGet || apiMethod == http.MethodDelete {
			// GET/DELETE 将参数拼到 query string
			if len(testReq.Params) > 0 {
				q := url.Values{}
				for k, v := range testReq.Params {
					q.Set(k, fmt.Sprintf("%v", v))
				}
				if strings.Contains(targetURL, "?") {
					targetURL += "&" + q.Encode()
				} else {
					targetURL += "?" + q.Encode()
				}
			}
			proxyReq, err := http.NewRequest(apiMethod, targetURL, nil)
			if err != nil {
				apiInternalError(w, "构建转发请求失败: "+err.Error())
				return
			}
			client := &http.Client{Timeout: HTTPClientTimeout}
			resp, err := client.Do(proxyReq)
			if err != nil {
				apiInternalError(w, "转发请求失败: "+err.Error())
				return
			}
			defer resp.Body.Close()
			respBody, _ := io.ReadAll(resp.Body)
			var respData interface{}
			if err := json.Unmarshal(respBody, &respData); err != nil {
				respData = string(respBody)
			}
			jsonSuccess(w, map[string]interface{}{"status_code": resp.StatusCode, "data": respData})
		} else {
			// POST/PUT/PATCH 将参数作为 JSON body 传递
			bodyBytes, _ := json.Marshal(testReq.Params)
			proxyReq, err := http.NewRequest(apiMethod, targetURL, bytes.NewReader(bodyBytes))
			if err != nil {
				apiInternalError(w, "构建转发请求失败: "+err.Error())
				return
			}
			proxyReq.Header.Set("Content-Type", "application/json")
			client := &http.Client{Timeout: HTTPClientTimeout}
			resp, err := client.Do(proxyReq)
			if err != nil {
				apiInternalError(w, "转发请求失败: "+err.Error())
				return
			}
			defer resp.Body.Close()
			respBody, _ := io.ReadAll(resp.Body)
			var respData interface{}
			if err := json.Unmarshal(respBody, &respData); err != nil {
				respData = string(respBody)
			}
			jsonSuccess(w, map[string]interface{}{"status_code": resp.StatusCode, "data": respData})
		}
		return
	}

	// query类型：获取数据库配置
	dbConfig, dbExists := dataOntologyDatabases[api.DatabaseID]
	if !dbExists {
		dataOntologyMu.RUnlock()
		apiNotFound(w, "数据库不存在")
		return
	}
	dataOntologyMu.RUnlock()

	// 解析MyBatis风格的SQL并替换参数
	finalSQL, args, err := parseMyBatisSQL(api.SQL, testReq.Params)
	if err != nil {
		apiBadRequest(w, "SQL解析失败: "+err.Error())
		return
	}

	// 执行SQL查询
	result, err := executeSQLQuery(dbConfig, finalSQL, args)
	if err != nil {
		apiInternalError(w, "查询失败: "+err.Error())
		return
	}

	jsonSuccess(w, map[string]interface{}{"data": result})
}

// parseMyBatisSQL 解析MyBatis风格的SQL语句
// 支持 #{param} 预编译参数、${param} 直接替换、#if(param)...#end 条件块

func parseMyBatisSQL(sqlTemplate string, params map[string]interface{}) (string, []interface{}, error) {
	var args []interface{}
	finalSQL := sqlTemplate
	var missingParams []string

	// 首先处理 #if(param)...#end 条件块
	// 如果参数存在则保留条件体内容，否则移除整个条件块
	ifRe := regexp.MustCompile(`#if\(([^)]+)\)([\s\S]*?)#end`)
	finalSQL = ifRe.ReplaceAllStringFunc(finalSQL, func(match string) string {
		submatch := ifRe.FindStringSubmatch(match)
		if len(submatch) < 3 {
			return match
		}
		paramName := strings.TrimSpace(submatch[1])
		condBody := submatch[2]
		// 检查参数是否存在（非空）
		if val, exists := params[paramName]; exists && val != nil && val != "" {
			return condBody
		}
		// 参数不存在，移除整个条件块
		return ""
	})

	// 然后处理 ${param} - 直接替换
	dollarPattern := `\$\{([^}]+)\}`
	finalSQL = replaceWithRegex(finalSQL, dollarPattern, func(match string) string {
		paramName := strings.TrimSpace(match[2 : len(match)-1])
		// 支持参数名:默认值格式
		defaultValue := ""
		if colonIdx := strings.Index(paramName, ":"); colonIdx != -1 {
			defaultValue = strings.TrimSpace(paramName[colonIdx+1:])
			paramName = strings.TrimSpace(paramName[:colonIdx])
		}
		if val, exists := params[paramName]; exists {
			return fmt.Sprintf("%v", val)
		}
		// 如果参数不存在但有默认值，使用默认值
		if defaultValue != "" {
			return defaultValue
		}
		missingParams = append(missingParams, paramName)
		return match
	})

	// 然后处理 #{param} - 预编译参数
	hashPattern := `#\{([^}]+)\}`
	finalSQL = replaceWithRegex(finalSQL, hashPattern, func(match string) string {
		paramName := strings.TrimSpace(match[2 : len(match)-1])
		// 支持参数名:默认值格式
		defaultValue := ""
		if colonIdx := strings.Index(paramName, ":"); colonIdx != -1 {
			defaultValue = strings.TrimSpace(paramName[colonIdx+1:])
			paramName = strings.TrimSpace(paramName[:colonIdx])
		}
		if val, exists := params[paramName]; exists {
			args = append(args, val)
			return "?"
		}
		// 如果参数不存在但有默认值，使用默认值
		if defaultValue != "" {
			args = append(args, defaultValue)
			return "?"
		}
		missingParams = append(missingParams, paramName)
		return match
	})

	// 检查是否有缺失的参数
	if len(missingParams) > 0 {
		return "", nil, fmt.Errorf("缺少必需的参数: %s", strings.Join(missingParams, ", "))
	}

	return finalSQL, args, nil
}

// replaceWithRegex 使用正则表达式替换字符串

func replaceWithRegex(input, pattern string, replacer func(string) string) string {
	result := input
	start := 0
	for {
		// 查找下一个匹配
		idx := -1
		matchLen := 0

		if strings.Contains(pattern, `\$\{`) {
			// 查找 ${...}
			idx = strings.Index(result[start:], "${")
			if idx >= 0 {
				idx += start
				end := strings.Index(result[idx:], "}")
				if end >= 0 {
					matchLen = end + 1
				}
			}
		} else if strings.Contains(pattern, `#\{`) {
			// 查找 #{...}
			idx = strings.Index(result[start:], "#{")
			if idx >= 0 {
				idx += start
				end := strings.Index(result[idx:], "}")
				if end >= 0 {
					matchLen = end + 1
				}
			}
		}

		if idx < 0 || matchLen == 0 {
			break
		}

		match := result[idx : idx+matchLen]
		replacement := replacer(match)
		result = result[:idx] + replacement + result[idx+matchLen:]
		start = idx + len(replacement)
	}
	return result
}

// isWriteOperation 检测SQL是否为写操作（INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/TRUNCATE等）

func isWriteOperation(sql string) bool {
	trimmed := strings.TrimSpace(strings.ToUpper(sql))
	writeKeywords := []string{"INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "TRUNCATE", "REPLACE", "MERGE", "GRANT", "REVOKE", "RENAME", "COMMENT"}
	for _, kw := range writeKeywords {
		if strings.HasPrefix(trimmed, kw) {
			return true
		}
	}
	return false
}

// executeSQLQuery 执行SQL查询并返回结果

func executeSQLQuery(dbConfig *DatabaseConfig, sqlQuery string, args []interface{}) ([]map[string]interface{}, error) {
	// MongoDB 特殊处理
	if dbConfig.Type == "mongodb" {
		return nil, fmt.Errorf("MongoDB 暂不支持SQL查询")
	}

	// 其他NoSQL数据库
	if dbConfig.Type == "elasticsearch" || dbConfig.Type == "redis" ||
		dbConfig.Type == "memcached" || dbConfig.Type == "neo4j" ||
		dbConfig.Type == "cassandra" || dbConfig.Type == "hbase" {
		return nil, fmt.Errorf("%s 暂不支持SQL查询", dbConfig.Type)
	}

	// SQL数据库 - 使用连接池
	db, err := getDBFromPool(dbConfig)
	if err != nil {
		return nil, err
	}

	// 写操作使用 Exec
	if isWriteOperation(sqlQuery) {
		result, err := db.Exec(sqlQuery, args...)
		if err != nil {
			return nil, err
		}
		affected, _ := result.RowsAffected()
		return []map[string]interface{}{
			{"affected_rows": affected},
		}, nil
	}

	// 读操作使用 Query
	rows, err := db.Query(sqlQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	var results []map[string]interface{}
	for rows.Next() {
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range values {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, err
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
		results = append(results, row)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return results, nil
}

// ==================== AI助手功能 ====================

// sendSSE 发送Server-Sent Events消息

func sendSSE(w http.ResponseWriter, eventType string, data interface{}) {
	jsonData, _ := json.Marshal(data)
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventType, jsonData)
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
}

// handleAIConfig 处理AI配置

func handleAIConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method == http.MethodGet {
		// 获取AI配置
		dataOntologyMu.RLock()
		config := dataOntologyAIConfig
		dataOntologyMu.RUnlock()

		jsonSuccess(w, map[string]interface{}{
			"config": config,
		})
		return
	}

	if r.Method == http.MethodPost {
		// 保存AI配置
		var config AIConfig
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}

		// 验证配置
		if config.URL == "" || config.APIKey == "" || config.Model == "" {
			apiInvalidInput(w, "请填写完整的配置信息")
			return
		}

		// 保留已有的 table_retrieval 配置（前端可能未传）
		dataOntologyMu.RLock()
		if dataOntologyAIConfig != nil {
			if config.TableRetrieval == nil && dataOntologyAIConfig.TableRetrieval != nil {
				config.TableRetrieval = dataOntologyAIConfig.TableRetrieval
			}
			// 保留已有的 Embedding 配置（前端可能未传）
			if config.Embedding.URL == "" && dataOntologyAIConfig.Embedding.URL != "" {
				config.Embedding = dataOntologyAIConfig.Embedding
			}
		}
		dataOntologyMu.RUnlock()

		// 检测AI模型能力
		capabilities, err := detectAICapabilities(&config)
		if err != nil {
			log.Printf("检测AI能力失败: %v", err)
			// 继续保存配置，使用默认能力
		}

		// 保存配置和能力
		dataOntologyMu.Lock()
		dataOntologyAIConfig = &config
		dataOntologyAICapabilities = capabilities
		dataOntologyMu.Unlock()

		// 持久化
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存AI配置失败: %v", err)
			apiInternalError(w, "保存失败")
			return
		}

		jsonSuccess(w, map[string]interface{}{
			"message":      "配置保存成功",
			"capabilities": capabilities,
		})
		return
	}

	apiMethodNotAllowed(w, "不支持的请求方法")
}

// handleAICapabilities 获取AI模型能力
// handleAIEmbeddingConfig 处理 Embedding 配置的读写

func handleAIEmbeddingConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method == http.MethodGet {
		// 获取 Embedding 配置
		dataOntologyMu.RLock()
		var embConfig EmbeddingRetrievalConfig
		if dataOntologyAIConfig != nil {
			embConfig = dataOntologyAIConfig.Embedding
		}
		dataOntologyMu.RUnlock()

		jsonSuccess(w, map[string]interface{}{
			"config": embConfig,
		})
		return
	}

	if r.Method == http.MethodPost {
		// 保存 Embedding 配置
		var embConfig EmbeddingRetrievalConfig
		if err := json.NewDecoder(r.Body).Decode(&embConfig); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}

		dataOntologyMu.Lock()
		if dataOntologyAIConfig == nil {
			dataOntologyAIConfig = &AIConfig{}
		}
		dataOntologyAIConfig.Embedding = embConfig
		dataOntologyMu.Unlock()

		// 持久化
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存 Embedding 配置失败: %v", err)
			apiInternalError(w, "保存失败")
			return
		}

		log.Printf("[表检索] Embedding 配置已更新: enabled=%v, model=%s, dimension=%d", embConfig.Enabled, embConfig.Model, embConfig.Dimension)
		jsonSuccess(w, map[string]interface{}{
			"message": "Embedding 配置保存成功",
			"config":  embConfig,
		})
		return
	}

	apiMethodNotAllowed(w, "不支持的请求方法")
}

// handleTableRetrievalConfig 处理表检索配置的读写

func handleTableRetrievalConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method == http.MethodGet {
		// 获取表检索配置
		dataOntologyMu.RLock()
		var trConfig *TableRetrievalConfig
		if dataOntologyAIConfig != nil {
			trConfig = dataOntologyAIConfig.TableRetrieval
		}
		dataOntologyMu.RUnlock()

		jsonSuccess(w, map[string]interface{}{
			"config": trConfig,
		})
		return
	}

	if r.Method == http.MethodPost {
		// 保存表检索配置
		var trConfig TableRetrievalConfig
		if err := json.NewDecoder(r.Body).Decode(&trConfig); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}

		dataOntologyMu.Lock()
		if dataOntologyAIConfig == nil {
			dataOntologyAIConfig = &AIConfig{}
		}
		dataOntologyAIConfig.TableRetrieval = &trConfig
		dataOntologyMu.Unlock()

		// 持久化
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存表检索配置失败: %v", err)
			apiInternalError(w, "保存失败")
			return
		}

		log.Printf("[表检索] 表检索配置已更新: strategy=%s, keyword_weight=%.2f, vector_weight=%.2f, graph_weight=%.2f",
			trConfig.Strategy, trConfig.KeywordWeight, trConfig.VectorWeight, trConfig.GraphWeight)
		jsonSuccess(w, map[string]interface{}{
			"message": "表检索配置保存成功",
			"config":  trConfig,
		})
		return
	}

	apiMethodNotAllowed(w, "不支持的请求方法")
}

func handleAICapabilities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method != http.MethodGet {
		apiMethodNotAllowed(w, "只支持GET请求")
		return
	}

	dataOntologyMu.RLock()
	capabilities := dataOntologyAICapabilities
	config := dataOntologyAIConfig
	dataOntologyMu.RUnlock()

	// 如果能力未检测或配置已更新，重新检测
	if capabilities == nil && config != nil {
		var err error
		capabilities, err = detectAICapabilities(config)
		if err != nil {
			log.Printf("检测AI能力失败: %v", err)
			apiInternalError(w, "检测AI能力失败")
			return
		}

		// 保存检测结果
		dataOntologyMu.Lock()
		dataOntologyAICapabilities = capabilities
		dataOntologyMu.Unlock()
	}

	jsonSuccess(w, map[string]interface{}{
		"capabilities": capabilities,
	})
}

// ========== 大模型管理 API ==========

// handleLLMModels 处理大模型列表和创建

func handleLLMModels(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		list := make([]*LLMModelConfig, 0, len(llmModels))
		for _, m := range llmModels {
			list = append(list, m)
		}
		dataOntologyMu.RUnlock()
		jsonSuccess(w, map[string]interface{}{"models": list})

	case http.MethodPost:
		var model LLMModelConfig
		if err := json.NewDecoder(r.Body).Decode(&model); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		if model.Name == "" || model.Type == "" || model.URL == "" {
			apiInvalidInput(w, "名称、类型和URL不能为空")
			return
		}
		model.ID = uuid.New().String()
		model.CreatedAt = time.Now().Format(time.RFC3339)
		dataOntologyMu.Lock()
		llmModels[model.ID] = &model
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		jsonSuccess(w, map[string]interface{}{"model": model})

	default:
		apiMethodNotAllowed(w, "不支持的方法")
	}
}

// handleLLMModelDetail 处理单个大模型的 GET/PUT/DELETE

func handleLLMModelDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/v1/models/llm/"), "/")
	if len(pathParts) == 0 || pathParts[0] == "" {
		apiBadRequest(w, "缺少模型ID")
		return
	}
	modelID := pathParts[0]

	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		model, exists := llmModels[modelID]
		dataOntologyMu.RUnlock()
		if !exists {
			apiNotFound(w, "模型不存在")
			return
		}
		jsonSuccess(w, map[string]interface{}{"model": model})

	case http.MethodPut:
		var update LLMModelConfig
		if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		dataOntologyMu.Lock()
		model, exists := llmModels[modelID]
		if !exists {
			dataOntologyMu.Unlock()
			apiNotFound(w, "模型不存在")
			return
		}
		if update.Name != "" {
			model.Name = update.Name
		}
		if update.Type != "" {
			model.Type = update.Type
		}
		if update.Provider != "" {
			model.Provider = update.Provider
		}
		if update.URL != "" {
			model.URL = update.URL
		}
		model.APIKey = update.APIKey
		if update.Model != "" {
			model.Model = update.Model
		}
		model.Description = update.Description
		model.Enabled = update.Enabled
		model.UpdatedAt = time.Now().Format(time.RFC3339)
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		jsonSuccess(w, map[string]interface{}{"model": model})

	case http.MethodDelete:
		dataOntologyMu.Lock()
		delete(llmModels, modelID)
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		jsonSuccess(w, map[string]interface{}{"message": "删除成功"})

	default:
		apiMethodNotAllowed(w, "不支持的方法")
	}
}

// ========== 小模型管理 API ==========

// handleSmallModels 处理小模型列表和创建

func handleSmallModels(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		list := make([]*SmallModelConfig, 0, len(smallModels))
		for _, m := range smallModels {
			list = append(list, m)
		}
		dataOntologyMu.RUnlock()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "models": list})

	case http.MethodPost:
		var model SmallModelConfig
		if err := json.NewDecoder(r.Body).Decode(&model); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
			return
		}
		if model.Name == "" || model.JsCode == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "名称和代码不能为空"})
			return
		}
		model.ID = uuid.New().String()
		model.CreatedAt = time.Now().Format(time.RFC3339)
		dataOntologyMu.Lock()
		smallModels[model.ID] = &model
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "model": model})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
	}
}

// handleSmallModelDetail 处理单个小模型的 GET/PUT/DELETE/Run

func handleSmallModelDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}

	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/v1/models/small/"), "/")
	if len(pathParts) == 0 || pathParts[0] == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "缺少模型ID"})
		return
	}
	modelID := pathParts[0]

	// 运行小模型
	if len(pathParts) >= 2 && pathParts[1] == "run" {
		handleSmallModelRun(w, r, modelID)
		return
	}

	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		model, exists := smallModels[modelID]
		dataOntologyMu.RUnlock()
		if !exists {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "模型不存在"})
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "model": model})

	case http.MethodPut:
		var update SmallModelConfig
		if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
			return
		}
		dataOntologyMu.Lock()
		model, exists := smallModels[modelID]
		if !exists {
			dataOntologyMu.Unlock()
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "模型不存在"})
			return
		}
		if update.Name != "" {
			model.Name = update.Name
		}
		model.Description = update.Description
		if update.JsCode != "" {
			model.JsCode = update.JsCode
		}
		model.DatabaseID = update.DatabaseID
		model.InputType = update.InputType
		model.AcceptExts = update.AcceptExts
		model.OutputType = update.OutputType
		model.Enabled = update.Enabled
		model.UpdatedAt = time.Now().Format(time.RFC3339)
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "model": model})

	case http.MethodDelete:
		dataOntologyMu.Lock()
		delete(smallModels, modelID)
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "删除成功"})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
	}
}

// handleSmallModelRun 运行小模型



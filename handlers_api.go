package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"log"
	"net"
	"net/http"
	"strings"
	"time"
)

func generateDataToolboxSkill(platform, mcpEndpoint string) string {
	skillContent := `---
name: datatoolbox
description: DataToolbox 数据工具箱 - 数据库查询、数据治理、接口分发
version: 1.0.0
author: DataToolbox Team
---

# DataToolbox MCP Skill

通过 MCP (Model Context Protocol) 使用 DataToolbox 进行数据库操作、数据治理和接口调用。

## MCP 连接配置

` + "```" + `json
{
  "mcpServers": {
    "datatoolbox": {
      "url": "` + mcpEndpoint + `"
    }
  }
}
` + "```" + `

## 可用工具

### 数据库操作

#### list_databases
列出所有已配置的数据库连接。

**用途**: 查看当前有哪些数据库可用，获取数据库 ID 用于后续操作。

**示例**:
` + "```" + `
用户: 我有哪些数据库？
AI: [调用 list_databases] 您有以下数据库：
- MySQL生产库 (id: db_001)
- PostgreSQL测试库 (id: db_002)
` + "```" + `

#### get_tables
获取指定数据库的表列表。

**参数**:
- database_id: 数据库 ID

**用途**: 查看某个数据库中有哪些表。

**示例**:
` + "```" + `
用户: 查看 MySQL生产库 有哪些表
AI: [调用 get_tables(database_id="db_001")] 该数据库有以下表：
- users (用户表)
- orders (订单表)
- products (商品表)
` + "```" + `

#### describe_table
获取表的结构信息（字段名、类型、键信息等）。

**参数**:
- database_id: 数据库 ID
- table_name: 表名

**用途**: 了解表结构，为编写 SQL 做准备。

**示例**:
` + "```" + `
用户: users 表有哪些字段？
AI: [调用 describe_table] users 表结构：
- id: INT, PRIMARY KEY
- username: VARCHAR(50)
- email: VARCHAR(100)
- created_at: DATETIME
` + "```" + `

#### execute_sql
在指定数据库上执行 SQL 语句。

**参数**:
- database_id: 数据库 ID
- sql: SQL 语句
- params: 参数（可选，用于参数化查询）

**用途**: 执行查询或写操作。

**示例**:
` + "```" + `
用户: 查询最近 10 条订单
AI: [调用 execute_sql(database_id="db_001", sql="SELECT * FROM orders ORDER BY created_at DESC LIMIT 10")]

用户: 统计每个用户的订单数量
AI: [调用 execute_sql(database_id="db_001", sql="SELECT user_id, COUNT(*) as order_count FROM orders GROUP BY user_id")]
` + "```" + `

**注意事项**:
- SELECT 语句返回数据
- INSERT/UPDATE/DELETE 返回影响行数
- DDL 语句（CREATE/ALTER/DROP）也可以执行，请谨慎使用

### 接口调用

#### list_apis
列出所有已配置的接口。

**用途**: 查看有哪些可调用的接口。

#### get_api_detail
获取接口的详细信息（SQL、参数定义、描述）。

**参数**:
- api_id: 接口 ID

**用途**: 了解接口需要哪些参数。

#### call_api
调用已配置的接口。

**参数**:
- api_id: 接口 ID
- params: 接口参数

**用途**: 执行预定义的接口，获取数据。

## 使用场景

### 场景 1: 数据探索
` + "```" + `
用户: 帮我看看数据库里有什么数据
AI: 
1. [list_databases] 先看看有哪些数据库
2. [get_tables] 选择一个数据库，查看表列表
3. [describe_table] 查看感兴趣的表结构
4. [execute_sql] 执行查询获取数据
` + "```" + `

### 场景 2: 数据分析
` + "```" + `
用户: 分析一下用户增长趋势
AI:
1. [execute_sql] 查询用户注册时间分布
   SELECT DATE(created_at) as date, COUNT(*) as count 
   FROM users 
   GROUP BY DATE(created_at) 
   ORDER BY date
2. 根据数据生成分析报告
` + "```" + `

### 场景 3: 数据治理
` + "```" + `
用户: 帮我清理重复的用户记录
AI:
1. [execute_sql] 先查找重复记录
   SELECT email, COUNT(*) as cnt FROM users GROUP BY email HAVING cnt > 1
2. [execute_sql] 确认后删除重复记录（需用户确认）
   DELETE FROM users WHERE id NOT IN (SELECT MIN(id) FROM users GROUP BY email)
` + "```" + `

## 最佳实践

1. **先探索后操作**: 使用 list_databases → get_tables → describe_table 了解数据结构，再执行 SQL
2. **参数化查询**: 对于用户输入的值，使用参数化查询防止 SQL 注入
3. **确认写操作**: 执行 INSERT/UPDATE/DELETE 前先展示影响范围，让用户确认
4. **分页查询**: 大数据量查询使用 LIMIT 分页，避免一次性返回过多数据

## 错误处理

- 数据库连接失败: 检查数据库配置和网络连接
- SQL 语法错误: 检查 SQL 语句，注意不同数据库的语法差异
- 权限不足: 检查数据库用户权限

## 支持的数据库类型

- MySQL
- PostgreSQL
- Oracle
- SQL Server
- 达梦 (DM)
- MongoDB
- SQLite
`

	return skillContent
}

func handleSkillsExport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}
	if r.Method != http.MethodGet {
		apiMethodNotAllowed(w)
		return
	}

	skillType := r.URL.Query().Get("type")
	if skillType == "" {
		apiBadRequest(w, "缺少 type 参数")
		return
	}

	// 获取当前服务地址作为 MCP endpoint
	host := r.Host
	if host == "" {
		host = "localhost:8080"
	}
	scheme := "http"
	if r.TLS != nil || strings.HasPrefix(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	mcpEndpoint := fmt.Sprintf("%s://%s/mcp", scheme, host)

	// 根据类型生成配置
	var title, description string
	var config interface{}
	var steps []string

	switch skillType {
	case "claude-code":
		title = "DataToolbox MCP Skill"
		description = "教 AI 如何使用 DataToolbox 的 MCP 工具进行数据库查询、数据治理等操作"
		config = generateDataToolboxSkill("claude-code", mcpEndpoint)
		steps = []string{
			"创建技能目录: mkdir -p ~/.claude/skills/datatoolbox",
			"将上方 SKILL.md 内容保存到: ~/.claude/skills/datatoolbox/SKILL.md",
			"在 Claude Code 中使用 /skills 命令加载技能",
			"或重启 Claude Code 自动加载",
		}
	case "cursor":
		title = "DataToolbox MCP Skill"
		description = "教 AI 如何使用 DataToolbox 的 MCP 工具进行数据库查询、数据治理等操作"
		config = generateDataToolboxSkill("cursor", mcpEndpoint)
		steps = []string{
			"创建技能目录: mkdir -p ~/.cursor/skills/datatoolbox",
			"将上方 SKILL.md 内容保存到: ~/.cursor/skills/datatoolbox/SKILL.md",
			"在 Cursor 设置中启用该技能",
			"重启 Cursor 即可使用",
		}
	case "openai-gpts":
		title = "DataToolbox MCP Skill"
		description = "教 AI 如何使用 DataToolbox 的 MCP 工具进行数据库查询、数据治理等操作"
		config = generateDataToolboxSkill("openai-gpts", mcpEndpoint)
		steps = []string{
			"进入 OpenAI GPT 编辑页面",
			"在 Instructions 区域粘贴上方 SKILL.md 内容",
			"在 Actions 区域配置 MCP 连接（见下方配置）",
			"保存 GPT 即可使用",
		}
	case "doubao":
		title = "DataToolbox MCP Skill"
		description = "教 AI 如何使用 DataToolbox 的 MCP 工具进行数据库查询、数据治理等操作"
		config = generateDataToolboxSkill("doubao", mcpEndpoint)
		steps = []string{
			"创建技能目录: mkdir -p ~/.doubao/skills/datatoolbox",
			"将上方 SKILL.md 内容保存到: ~/.doubao/skills/datatoolbox/SKILL.md",
			"在豆包设置中启用该技能",
			"重启豆包即可使用",
		}
	case "opencode":
		title = "DataToolbox MCP Skill"
		description = "教 AI 如何使用 DataToolbox 的 MCP 工具进行数据库查询、数据治理等操作"
		config = generateDataToolboxSkill("opencode", mcpEndpoint)
		steps = []string{
			"创建技能目录: mkdir -p ~/.opencode/skills/datatoolbox",
			"将上方 SKILL.md 内容保存到: ~/.opencode/skills/datatoolbox/SKILL.md",
			"在 OpenCode 中使用 /skills 命令加载技能",
			"或重启 OpenCode 自动加载",
		}
	case "windsurf":
		title = "DataToolbox MCP Skill"
		description = "教 AI 如何使用 DataToolbox 的 MCP 工具进行数据库查询、数据治理等操作"
		config = generateDataToolboxSkill("windsurf", mcpEndpoint)
		steps = []string{
			"打开 Windsurf 设置 (Ctrl/Cmd + ,)",
			"进入 Features > MCP Servers",
			"添加新的 MCP Server，URL 填入: " + mcpEndpoint,
			"将上方 SKILL.md 内容保存到 ~/.windsurf/skills/datatoolbox/SKILL.md",
			"重启 Windsurf 即可使用",
		}
	case "zed":
		title = "DataToolbox MCP Skill"
		description = "教 AI 如何使用 DataToolbox 的 MCP 工具进行数据库查询、数据治理等操作"
		config = generateDataToolboxSkill("zed", mcpEndpoint)
		steps = []string{
			"打开 Zed 设置 (Ctrl/Cmd + ,)",
			"进入 MCP Servers 设置",
			"添加新的 MCP Server，URL 填入: " + mcpEndpoint,
			"将上方 SKILL.md 内容保存到 ~/.zed/skills/datatoolbox/SKILL.md",
			"重启 Zed 即可使用",
		}
	case "copilot":
		title = "DataToolbox MCP Skill"
		description = "教 AI 如何使用 DataToolbox 的 MCP 工具进行数据库查询、数据治理等操作"
		config = generateDataToolboxSkill("copilot", mcpEndpoint)
		steps = []string{
			"在 VS Code 中打开设置 (Ctrl/Cmd + ,)",
			"搜索 'GitHub Copilot Chat'",
			"在 MCP Servers 配置中添加: " + mcpEndpoint,
			"将上方 SKILL.md 内容保存到 ~/.copilot/skills/datatoolbox/SKILL.md",
			"重启 VS Code 即可使用",
		}
	case "cline":
		title = "DataToolbox MCP Skill"
		description = "教 AI 如何使用 DataToolbox 的 MCP 工具进行数据库查询、数据治理等操作"
		config = generateDataToolboxSkill("cline", mcpEndpoint)
		steps = []string{
			"在 VS Code 中打开 Cline 扩展",
			"进入 Cline 设置 > MCP Servers",
			"添加新的 MCP Server，URL 填入: " + mcpEndpoint,
			"将上方 SKILL.md 内容保存到 ~/.cline/skills/datatoolbox/SKILL.md",
			"重启 VS Code 即可使用",
		}
	case "openclaw":
		title = "DataToolbox MCP Skill"
		description = "教 OpenClaw / DataToolbox 智能体如何使用 MCP 工具进行数据库查询、数据治理等操作"
		config = generateDataToolboxSkill("openclaw", mcpEndpoint)
		steps = []string{
			"打开 OpenClaw 智能体配置界面",
			"新增技能或系统提示词",
			"将上方 SKILL.md 内容粘贴到技能说明中",
			"将 MCP 服务地址配置为: " + mcpEndpoint,
			"保存后即可在 OpenClaw 智能体中使用",
		}
	case "hermes":
		title = "DataToolbox MCP Skill"
		description = "教 Hermes Agent 如何使用 DataToolbox 的 MCP 工具进行数据库查询、数据治理等操作"
		config = generateDataToolboxSkill("hermes", mcpEndpoint)
		steps = []string{
			"在 Hermes skills 目录中创建 datatoolbox 技能",
			"将上方 SKILL.md 内容保存到 ~/.hermes/skills/datatoolbox/SKILL.md",
			"在 Hermes 配置 MCP Server，地址填入: " + mcpEndpoint,
			"重启 Hermes 或重新加载 skills",
			"之后即可直接调用 DataToolbox MCP 工具",
		}
	default:
		apiBadRequest(w, "不支持的技能类型: "+skillType)
		return
	}

	// 将 config 转为格式化的 JSON 字符串
	configJSON, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		apiError(w, "配置序列化失败", 500, "SERIALIZE_ERROR")
		return
	}

	jsonSuccess(w, map[string]interface{}{
		"success":     true,
		"title":       title,
		"description": description,
		"config":      string(configJSON),
		"steps":       steps,
	})
}

// handleMCPSafeConfig MCP 安全配置：GET 返回当前配置，PUT 更新（需授权）

func handleMCPSafeConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}
	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		config := dataOntologyMCPSafeConfig
		if config == nil {
			config = &MCPSafeConfig{} // 返回默认值
		}
		dataOntologyMu.RUnlock()
		jsonSuccess(w, map[string]interface{}{"success": true, "config": config})
	case http.MethodPut:
		var body struct {
			Config MCPSafeConfig `json:"config"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		dataOntologyMu.Lock()
		dataOntologyMCPSafeConfig = &body.Config
		dataOntologyMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("[MCP] 保存安全配置失败: err=%v", err)
		}
		log.Printf("[MCP] 安全配置已更新: read_only=%v, block_dangerous=%v, blocked_keywords=%v, allowed_tables=%v, port=%d",
			body.Config.ReadOnlyMode, body.Config.BlockDangerous, body.Config.BlockedKeywords, body.Config.AllowedTables, body.Config.Port)
		jsonSuccess(w, map[string]interface{}{"success": true, "config": dataOntologyMCPSafeConfig})
	default:
		apiMethodNotAllowed(w)
	}
}

// MCP 端口配置

func handleMCPPort(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}
	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		port := dataOntologyMCPPort
		dataOntologyMu.RUnlock()
		jsonSuccess(w, map[string]interface{}{"success": true, "port": port})
	case http.MethodPut:
		var body struct {
			Port int `json:"port"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		// 验证端口范围
		if body.Port < 0 || body.Port > 65535 {
			apiBadRequest(w, "端口号必须在 0-65535 范围内")
			return
		}
		dataOntologyMu.Lock()
		dataOntologyMCPPort = body.Port
		// 同时更新 MCPSafeConfig 中的 Port 字段
		if dataOntologyMCPSafeConfig == nil {
			dataOntologyMCPSafeConfig = &MCPSafeConfig{}
		}
		dataOntologyMCPSafeConfig.Port = body.Port
		dataOntologyMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("[MCP] 保存端口配置失败: err=%v", err)
		}
		log.Printf("[MCP] 端口配置已更新: port=%d (需重启服务生效)", body.Port)
		jsonSuccess(w, map[string]interface{}{"success": true, "port": body.Port, "message": "端口配置已保存，重启服务后生效"})
	default:
		apiMethodNotAllowed(w)
	}
}

// 测试数据库连接

func handleTestConnection(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method != http.MethodPost {
		apiBadRequest(w, "只支持POST请求")
		return
	}

	var config DatabaseConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		apiBadRequest(w, "请求格式错误")
		return
	}

	// 调试日志：打印接收到的配置
	log.Printf("[DB] 测试连接: type=%s, host=%s, port=%d, user=%s, database=%s",
		config.Type, config.Host, config.Port, config.User, config.Database)

	// MongoDB 特殊处理
	if config.Type == "mongodb" {
		uri := buildMongoURI(&config)
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
		if err != nil {
			log.Printf("[DB] MongoDB 连接失败: err=%v", err)
			jsonError(w, "连接失败: "+err.Error(), "")
			return
		}
		defer client.Disconnect(ctx)

		if err := client.Ping(ctx, nil); err != nil {
			log.Printf("[DB] MongoDB Ping 失败: err=%v", err)
			jsonError(w, "连接失败: "+err.Error(), "")
			return
		}

		log.Printf("[DB] MongoDB 连接成功: host=%s", config.Host)
		jsonSuccess(w, map[string]interface{}{"success": true, "message": "连接成功"})
		return
	}

	// Elasticsearch 特殊处理
	if config.Type == "elasticsearch" {
		url := fmt.Sprintf("http://%s:%d", config.Host, config.Port)
		resp, err := http.Get(url)
		if err != nil {
			log.Printf("[DB] Elasticsearch 连接失败: err=%v", err)
			jsonError(w, "连接失败: "+err.Error(), "")
			return
		}
		defer resp.Body.Close()

		log.Printf("[DB] Elasticsearch 连接成功: host=%s", config.Host)
		jsonSuccess(w, map[string]interface{}{"success": true, "message": "连接成功"})
		return
	}

	// InfluxDB 特殊处理
	if config.Type == "influxdb" {
		url := fmt.Sprintf("http://%s:%d/ping", config.Host, config.Port)
		resp, err := http.Get(url)
		if err != nil {
			log.Printf("[DB] InfluxDB 连接失败: err=%v", err)
			jsonError(w, "连接失败: "+err.Error(), "")
			return
		}
		defer resp.Body.Close()

		log.Printf("[DB] InfluxDB 连接成功: host=%s", config.Host)
		jsonSuccess(w, map[string]interface{}{"success": true, "message": "连接成功"})
		return
	}

	// Redis 特殊处理
	if config.Type == "redis" {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", config.Host, config.Port), 5*time.Second)
		if err != nil {
			log.Printf("[DB] Redis 连接失败: err=%v", err)
			jsonError(w, "连接失败: "+err.Error(), "")
			return
		}
		defer conn.Close()

		log.Printf("[DB] Redis 连接成功: host=%s", config.Host)
		jsonSuccess(w, map[string]interface{}{"success": true, "message": "连接成功"})
		return
	}

	// Memcached 特殊处理
	if config.Type == "memcached" {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", config.Host, config.Port), 5*time.Second)
		if err != nil {
			log.Printf("[DB] Memcached 连接失败: err=%v", err)
			jsonError(w, "连接失败: "+err.Error(), "")
			return
		}
		defer conn.Close()

		log.Printf("[DB] Memcached 连接成功: host=%s", config.Host)
		jsonSuccess(w, map[string]interface{}{"success": true, "message": "连接成功"})
		return
	}

	// Neo4j 特殊处理
	if config.Type == "neo4j" {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", config.Host, config.Port), 5*time.Second)
		if err != nil {
			log.Printf("[DB] Neo4j 连接失败: err=%v", err)
			jsonError(w, "连接失败: "+err.Error(), "")
			return
		}
		defer conn.Close()

		log.Printf("[DB] Neo4j 连接成功: host=%s", config.Host)
		jsonSuccess(w, map[string]interface{}{"success": true, "message": "连接成功 (基础端口测试)"})
		return
	}

	// Cassandra, HBase 等通过 TCP 简单测试
	if config.Type == "cassandra" || config.Type == "hbase" {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", config.Host, config.Port), 5*time.Second)
		if err != nil {
			log.Printf("[DB] %s 连接失败: err=%v", config.Type, err)
			jsonError(w, "连接失败: "+err.Error(), "")
			return
		}
		defer conn.Close()

		log.Printf("[DB] %s 连接成功: host=%s", config.Type, config.Host)
		jsonSuccess(w, map[string]interface{}{"success": true, "message": "连接成功 (基础端口测试)"})
		return
	}

	// SQL数据库通用处理 - 使用连接池
	log.Printf("[DB] 连接数据库: host=%s, port=%d, database=%s", config.Host, config.Port, config.Database)

	db, err := getDBFromPool(&config)
	if err != nil {
		log.Printf("[DB] SQL数据库连接失败: type=%s, err=%v", config.Type, err)
		jsonError(w, "连接失败: "+err.Error(), "")
		return
	}

	if err := db.Ping(); err != nil {
		log.Printf("[DB] SQL数据库Ping失败: type=%s, err=%v", config.Type, err)
		jsonError(w, "连接失败: "+err.Error(), "")
		return
	}

	log.Printf("[DB] SQL数据库连接成功: type=%s, host=%s", config.Type, config.Host)
	jsonSuccess(w, map[string]interface{}{"success": true, "message": "连接成功"})
}

// 数据库管理

func handleDatabases(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "未授权")
		return
	}

	switch r.Method {
	case http.MethodGet:
		// 获取数据库列表
		dataOntologyMu.RLock()
		defer dataOntologyMu.RUnlock()

		databases := make([]DatabaseInfo, 0)
		for _, config := range dataOntologyDatabases {
			if !dataOntologyResourceVisible(config.Owner, username) {
				continue
			}
			databases = append(databases, DatabaseInfo{
				ID:       config.ID,
				Owner:    config.Owner,
				Type:     config.Type,
				Name:     config.Name,
				Host:     config.Host,
				Port:     config.Port,
				Path:     config.Path,
				User:     config.User,
				Database: config.Database,
				// 不返回密码
			})
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":   true,
			"databases": databases,
		})

	case http.MethodPost:
		// 添加数据库
		var config DatabaseConfig
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		// 测试连接（简化版，实际连接测试已在前端完成）
		// 这里只做基本验证
		if config.Type == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "数据库类型不能为空",
			})
			return
		}

		// 保存配置
		config.ID = uuid.New().String()
		config.Owner = username
		dataOntologyMu.Lock()
		dataOntologyDatabases[config.ID] = &config
		dataOntologyMu.Unlock()

		// 持久化保存
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存数据库配置失败: %v", err)
		}

		// 异步同步表信息到 SQLite FTS5 索引
		if manager := getFTS5Manager(); manager != nil {
			go func() {
				if err := manager.syncTablesToSQLite(&config); err != nil {
					log.Printf("[表检索] 同步新数据库 %s 表信息失败: %v", config.Name, err)
				}
			}()
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"id":      config.ID,
		})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "不支持的请求方法",
		})
	}
}

// 获取数据库详情

func handleDatabaseDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "未授权",
		})
		return
	}

	// 从URL中提取数据库ID
	path := r.URL.Path
	parts := strings.Split(path, "/")
	// 兼容 /api/v1/databases/{id} 和 /api/databases/{id}
	dbID := ""
	for i, p := range parts {
		if p == "databases" && i+1 < len(parts) && parts[i+1] != "" {
			dbID = parts[i+1]
			break
		}
	}
	if dbID == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的请求路径",
		})
		return
	}

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

	switch r.Method {
	case http.MethodGet:
		var tables []string
		var connected bool

		// MongoDB 特殊处理
		if config.Type == "mongodb" {
			uri := buildMongoURI(config)
			log.Printf("MongoDB 连接数据库: %s", config.Database)
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()

			client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
			if err == nil {
				defer client.Disconnect(ctx)
				if err := client.Ping(ctx, nil); err == nil {
					db := client.Database(config.Database)
					collections, err := db.ListCollectionNames(ctx, bson.M{})
					if err == nil {
						log.Printf("MongoDB 获取到 %d 个集合: %v", len(collections), collections)
						tables = collections
						connected = true
					} else {
						log.Printf("MongoDB 获取集合列表失败: %v", err)
					}
				} else {
					log.Printf("MongoDB Ping 失败: %v", err)
				}
			} else {
				log.Printf("MongoDB 连接失败: %v", err)
			}
		} else if config.Type == "redis" {
			// Redis 不支持表列表，显示数据库索引
			conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", config.Host, config.Port), 5*time.Second)
			if err == nil {
				conn.Close()
				connected = true
				tables = []string{"DB 0", "DB 1", "DB 2", "DB 3", "DB 4", "DB 5", "DB 6", "DB 7", "DB 8", "DB 9", "DB 10", "DB 11", "DB 12", "DB 13", "DB 14", "DB 15"}
			}
		} else if config.Type == "neo4j" || config.Type == "elasticsearch" || config.Type == "influxdb" || config.Type == "memcached" || config.Type == "cassandra" || config.Type == "hbase" {
			// 这些数据库暂不获取详细表列表
			conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", config.Host, config.Port), 5*time.Second)
			if err == nil {
				conn.Close()
				connected = true
				tables = []string{}
			}
		} else {
			// SQL数据库通用处理 - 使用连接池
			db, err := getDBFromPool(config)
			if err == nil {
				if err := db.Ping(); err == nil {
					connected = true
					// 获取表列表
					query := getTablesQuery(config)
					log.Printf("执行查询表列表: %s", query)
					rows, err := db.Query(query)
					if err != nil {
						log.Printf("查询表列表失败: %v", err)
					} else {
						defer rows.Close()
						for rows.Next() {
							var tableName string
							if err := rows.Scan(&tableName); err == nil {
								tables = append(tables, tableName)
								log.Printf("找到表: %s", tableName)
							} else {
								log.Printf("扫描表名失败: %v", err)
							}
						}
						log.Printf("共找到 %d 个表", len(tables))
					}
				}
			}
		}

		// 达梦：左侧表列表只显示用户表，隐藏系统表
		if config.Type == "dm" && len(tables) > 0 {
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

		// 转换为 TableInfo 数组，并获取表备注
		tableInfos := make([]TableInfo, len(tables))
		var tableComments map[string]string

		// 对于 SQL 数据库，获取表备注
		if connected && config.Type != "mongodb" && config.Type != "redis" &&
			config.Type != "neo4j" && config.Type != "elasticsearch" &&
			config.Type != "influxdb" && config.Type != "memcached" &&
			config.Type != "cassandra" && config.Type != "hbase" {
			db, err := getDBFromPool(config)
			if err == nil {
				tableComments = getTableComments(db, config, tables)
			}
		}

		for i, tableName := range tables {
			tableInfos[i] = TableInfo{
				Name:    tableName,
				Comment: tableComments[tableName],
			}
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"database": DatabaseInfo{
				ID:        config.ID,
				Owner:     config.Owner,
				Type:      config.Type,
				Name:      config.Name,
				Host:      config.Host,
				Port:      config.Port,
				Database:  config.Database,
				Path:      config.Path,
				Connected: connected,
				Tables:    tableInfos,
			},
		})

	case "PUT":
		// 更新数据库配置
		var updateConfig DatabaseConfig
		if err := json.NewDecoder(r.Body).Decode(&updateConfig); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "请求格式错误",
			})
			return
		}

		dataOntologyMu.Lock()
		// 保留原ID和类型
		updateConfig.ID = config.ID
		updateConfig.Type = config.Type
		updateConfig.Owner = config.Owner

		// 如果密码为空，保留原密码
		if updateConfig.Password == "" {
			updateConfig.Password = config.Password
		}

		dataOntologyDatabases[dbID] = &updateConfig
		dataOntologyMu.Unlock()

		// 持久化保存
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存数据库配置更新失败: %v", err)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "更新成功",
		})

	case http.MethodDelete:
		// 删除数据库配置
		dataOntologyMu.Lock()
		delete(dataOntologyDatabases, dbID)
		dataOntologyMu.Unlock()

		// 持久化保存
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存数据库配置删除失败: %v", err)
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

// LineageEdge 外键血缘边：from 表的外键列引用 to 表的主键/唯一列（数据从 to 流向 from）

type LineageEdge struct {
	FromTable  string `json:"fromTable"`
	FromColumn string `json:"fromColumn"`
	ToTable    string `json:"toTable"`
	ToColumn   string `json:"toColumn"`
	Constraint string `json:"constraint,omitempty"`
}

func dedupeLineageEdges(edges []LineageEdge) []LineageEdge {
	seen := make(map[string]struct{}, len(edges))
	out := make([]LineageEdge, 0, len(edges))
	for _, e := range edges {
		k := e.FromTable + "\x00" + e.FromColumn + "\x00" + e.ToTable + "\x00" + e.ToColumn
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, e)
	}
	return out
}

func handleDatabaseLineage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	username, authOK := getDataOntologyUserFromRequest(r)
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
	path := strings.Trim(r.URL.Path, "/")
	parts := strings.Split(path, "/")
	// api / databases / {id} / lineage
	if len(parts) != 4 || parts[0] != "api" || parts[1] != "databases" || parts[3] != "lineage" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "无效的请求路径",
		})
		return
	}
	dbID := parts[2]
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

	if config.Type == "mongodb" || config.Type == "redis" || config.Type == "neo4j" ||
		config.Type == "elasticsearch" || config.Type == "influxdb" || config.Type == "memcached" ||
		config.Type == "cassandra" || config.Type == "hbase" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"tables":  []string{},
			"edges":   []LineageEdge{},
			"message": "当前数据库类型不支持基于外键的血缘分析",
		})
		return
	}

	tables, err := getTablesList(config)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "获取表列表失败: " + err.Error(),
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

	edges, warn := queryForeignKeyLineage(db, config, tables)
	edges = dedupeLineageEdges(edges)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"db_type":     config.Type,
		"tables":      tables,
		"edges":       edges,
		"edge_count":  len(edges),
		"message":     warn,
	})
}

// handleTableRetrievalSync 同步表检索索引

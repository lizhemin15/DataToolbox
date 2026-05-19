package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	_ "gitee.com/chunanyong/dm"
)

func handleSmallModelRun(w http.ResponseWriter, r *http.Request, modelID string) {
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}

	dataOntologyMu.RLock()
	model, exists := smallModels[modelID]
	if !exists {
		dataOntologyMu.RUnlock()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "模型不存在"})
		return
	}
	dbID := model.DatabaseID
	dbType := ""
	if db, ok := dataOntologyDatabases[dbID]; ok {
		dbType = db.Type
	}
	code := model.JsCode
	dataOntologyMu.RUnlock()

	// 解析输入参数
	var req struct {
		InputText string `json:"input_text"`
		InputFile string `json:"input_file"` // base64
		FileName  string `json:"file_name"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	// 准备任务参数
	taskData := map[string]interface{}{
		"code":        code,
		"token":       "",
		"database_id": dbID,
		"db_type":     dbType,
		"input_text":  req.InputText,
		"file_base64": req.InputFile,
		"file_name":   req.FileName,
	}

	// 执行
	result := callGovRunner(taskData)
	if !result.Success {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": result.Error})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"output":  result.Output,
	})
}

// handleAIQuery 处理AI查询（流式响应）

func handleAIQuery(w http.ResponseWriter, r *http.Request) {
	// 设置流式响应头
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	log.Printf("[handleTableData] path=%s, parts=%v, len=%d", r.URL.Path, strings.Split(r.URL.Path, "/"), len(strings.Split(r.URL.Path, "/")))
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		sendSSE(w, "error", map[string]interface{}{
			"message": "未授权",
		})
		return
	}

	if r.Method != http.MethodPost {
		sendSSE(w, "error", map[string]interface{}{
			"message": "只支持POST请求",
		})
		return
	}

	// 确保支持流式传输
	flusher, ok := w.(http.Flusher)
	if !ok {
		sendSSE(w, "error", map[string]interface{}{
			"message": "不支持流式传输",
		})
		return
	}

	// 解析请求
	var queryReq AIQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&queryReq); err != nil {
		sendSSE(w, "error", map[string]interface{}{
			"message": "请求格式错误",
		})
		return
	}

	// 直接走集群模式（不再有 mode 分支，极速模式代码保留但不再走）
	log.Printf("[handleAIQuery] → routing to cluster mode (default)")
	handleAgentClusterQueryWithReq(w, r, flusher, &queryReq, username)
	return

	// === 极速模式（默认） ===
	// 发送开始事件
	sendSSE(w, "start", map[string]interface{}{
		"message": "开始处理您的问题...",
	})
	flusher.Flush()

	// 检查AI配置
	dataOntologyMu.RLock()
	aiConfig := dataOntologyAIConfig
	aiCapabilities := dataOntologyAICapabilities
	dataOntologyMu.RUnlock()

	if aiConfig == nil {
		sendSSE(w, "error", map[string]interface{}{
			"message": "请先配置AI设置",
		})
		return
	}

	// 如果能力未检测，进行检测
	if aiCapabilities == nil {
		var err error
		aiCapabilities, err = detectAICapabilities(aiConfig)
		if err != nil {
			log.Printf("检测AI能力失败: %v", err)
			// 使用默认能力继续
			aiCapabilities = &AICapabilities{
				SupportsFunctionCall: false,
				SupportsThinking:     false,
				SupportsStreaming:    true,
				ContextWindow:        4096,
				SupportsJSONMode:     false,
			}
		}
	}

	// 发送读取表结构事件
	sendSSE(w, "thinking", map[string]interface{}{
		"message": "正在读取数据库表结构信息...",
	})
	flusher.Flush()

	// 如果没有指定数据库，返回数据库选择卡片
	if len(queryReq.Databases) == 0 {
		// 获取用户可访问的数据库列表
		dataOntologyMu.RLock()
		var availableDBs []map[string]interface{}
		for id, db := range dataOntologyDatabases {
			if dataOntologyResourceVisible(db.Owner, username) {
				availableDBs = append(availableDBs, map[string]interface{}{
					"id":   id,
					"name": db.Name,
					"type": db.Type,
				})
			}
		}
		dataOntologyMu.RUnlock()

		if len(availableDBs) == 0 {
			sendSSE(w, "error", map[string]interface{}{
				"message": "没有可用的数据库，请先添加数据库配置",
			})
			sendSSE(w, "done", map[string]interface{}{})
			flusher.Flush()
			return
		}

		// 返回数据库选择卡片
		sendSSE(w, "database_selection_required", map[string]interface{}{
			"message":    "请选择要操作的数据库",
			"databases":  availableDBs,
			"user_query": queryReq.Message,
		})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	// 获取数据库配置和表结构（含字段信息）
	dataOntologyMu.RLock()
	var dbSchemas []map[string]interface{}
	for _, dbID := range queryReq.Databases {
		dbConfig, exists := dataOntologyDatabases[dbID]
		if !exists || !dataOntologyResourceVisible(dbConfig.Owner, username) {
			continue
		}

		tables, err := getTablesList(dbConfig)
		if err != nil {
			log.Printf("获取数据库 %s 表列表失败: %v", dbConfig.Name, err)
			continue
		}

		// 使用表检索逻辑筛选相关表
		var tablesWithColumns []map[string]interface{}
		defaultMaxTables := 15

		retrievalConfig := aiConfig.TableRetrieval
		relevantTables, err := retrieveRelevantTables(queryReq.Message, dbConfig, retrievalConfig)
		if err != nil {
			log.Printf("表检索失败: %v, 使用前 %d 张表", err, defaultMaxTables)
			// 降级：截取前 N 张表
			if len(tables) > defaultMaxTables {
				tables = tables[:defaultMaxTables]
			}
			for _, tableName := range tables {
				columns, err := getTableColumns(dbConfig, tableName)
				if err != nil {
					log.Printf("获取表 %s 字段失败: %v", tableName, err)
					tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
						"name":    tableName,
						"columns": []map[string]interface{}{},
					})
					continue
				}
				tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
					"name":    tableName,
					"columns": columns,
				})
			}
		} else {
			// 使用检索结果
			if len(relevantTables) == 0 {
				// 检索结果为空，降级使用所有表
				log.Printf("[表检索] 未检索到相关表，降级使用前 %d 张表", defaultMaxTables)
				if len(tables) > defaultMaxTables {
					tables = tables[:defaultMaxTables]
				}
				for _, tableName := range tables {
					columns, err := getTableColumns(dbConfig, tableName)
					if err != nil {
						log.Printf("获取表 %s 字段失败: %v", tableName, err)
						tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
							"name":    tableName,
							"columns": []map[string]interface{}{},
						})
						continue
					}
					tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
						"name":    tableName,
						"columns": columns,
					})
				}
			} else {
				log.Printf("[表检索] 检索到 %d 张相关表", len(relevantTables))
				for _, result := range relevantTables {
					tableName := result.TableName
					columns, err := getTableColumns(dbConfig, tableName)
					if err != nil {
						log.Printf("获取表 %s 字段失败: %v", tableName, err)
						tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
							"name":    tableName,
							"columns": []map[string]interface{}{},
						})
						continue
					}
					tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
						"name":    tableName,
						"columns": columns,
					})
				}
			}
		}

		// 获取本体关系
		var relations []OntologyRelation
		if dbConfig.Relations != nil {
			for _, rel := range dbConfig.Relations {
				relations = append(relations, rel)
			}
		}

		dbSchemas = append(dbSchemas, map[string]interface{}{
			"name":      dbConfig.Name,
			"type":      dbConfig.Type,
			"tables":    tablesWithColumns,
			"relations": relations,
			"id":        dbID,
		})
	}
	dataOntologyMu.RUnlock()

	if len(dbSchemas) == 0 {
		sendSSE(w, "error", map[string]interface{}{
			"message": "未找到有效的数据库",
		})
		return
	}

	// 根据模块上下文路由
	moduleSet := make(map[string]bool)
	for _, m := range queryReq.Modules {
		moduleSet[m] = true
	}

	// 如果没有明确指定模块，进行意图检测
	if len(moduleSet) == 0 {
		intent := detectUserIntent(queryReq.Message)
		log.Printf("[AI Query] 关键词意图检测: module=%s, confidence=%.2f, reason=%s", intent.DetectedModule, intent.Confidence, intent.Reason)

		// 关键词置信度足够高，直接路由
		if intent.Confidence >= 0.7 && intent.DetectedModule != "" {
			moduleSet[intent.DetectedModule] = true
			sendSSE(w, "thinking", map[string]interface{}{
				"message": fmt.Sprintf("检测到意图: %s，正在处理...", intent.Reason),
			})
			flusher.Flush()
		} else {
			// 关键词置信度不足，调用 AI 进行意图分类
			sendSSE(w, "thinking", map[string]interface{}{
				"message": "正在分析您的意图...",
			})
			flusher.Flush()

			aiIntent := detectIntentWithAI(aiConfig, aiCapabilities, queryReq.Message)
			log.Printf("[AI Query] AI 意图分类: module=%s, confidence=%.2f, reason=%s", aiIntent.DetectedModule, aiIntent.Confidence, aiIntent.Reason)

			// 合并：取置信度更高的结果
			finalIntent := intent
			if aiIntent.Confidence > intent.Confidence && aiIntent.DetectedModule != "" {
				finalIntent = aiIntent
			}

			// 如果最终置信度 >= 0.7，自动路由
			if finalIntent.Confidence >= 0.7 && finalIntent.DetectedModule != "" {
				moduleSet[finalIntent.DetectedModule] = true
				sendSSE(w, "thinking", map[string]interface{}{
					"message": fmt.Sprintf("识别意图: %s，正在处理...", finalIntent.Reason),
				})
				flusher.Flush()
			} else {
				// AI 也不确定，返回意图选择卡片
				intentOptions := []map[string]interface{}{
					{"id": "db-manage", "name": "通用提问", "description": "查询数据、统计信息、了解表结构等", "icon": "💬"},
					{"id": "api-dispatch", "name": "接口制作", "description": "创建 API 接口、生成数据服务", "icon": "🔌"},
					{"id": "data-governance", "name": "数据治理", "description": "创建定时任务、数据导入导出", "icon": "⚙️"},
					{"id": "quality-audit", "name": "质量审计", "description": "数据质量检查、校验规则", "icon": "✅"},
					{"id": "ontology", "name": "本体查询", "description": "概念关系、语义分析", "icon": "🧠"},
					{"id": "small-model", "name": "小模型", "description": "小模型相关、本地模型、离线推理", "icon": "🤖"},
				}

				sendSSE(w, "intent_selection_required", map[string]interface{}{
					"message":    "我不太确定您想要做什么，请选择一个操作类型：",
					"intents":    intentOptions,
					"user_query": queryReq.Message,
					"detected":   finalIntent,
				})
				sendSSE(w, "done", map[string]interface{}{})
				flusher.Flush()
				return
			}
		}
	}

	if moduleSet["api-dispatch"] {
		handleAICreateApi(w, flusher, &queryReq, dbSchemas, aiConfig, aiCapabilities)
		return
	}

	if moduleSet["data-governance"] {
		handleAIGovernanceTask(w, flusher, &queryReq, dbSchemas, aiConfig)
		return
	}

	if moduleSet["quality-audit"] {
		handleAIQualityRule(w, flusher, &queryReq, dbSchemas, aiConfig)
		return
	}

	if moduleSet["small-model"] {
		handleAISmallModel(w, flusher, &queryReq, dbSchemas, aiConfig)
		return
	}

	if moduleSet["ontology"] {
		handleAIOntologyQuery(w, flusher, &queryReq, dbSchemas, aiConfig)
		return
	}

	// 最多重试3次
	maxRetries := 3
	var lastError string
	var lastSQL string
	var attempts []map[string]interface{}
	var normalizedSQLs []string

	for retry := 0; retry < maxRetries; retry++ {
		// 发送生成SQL事件
		if retry == 0 {
			sendSSE(w, "thinking", map[string]interface{}{
				"message": "正在分析您的问题并生成SQL...",
				"attempt": retry + 1,
			})
		} else {
			sendSSE(w, "retry", map[string]interface{}{
				"message": fmt.Sprintf("第%d次重试，正在根据错误调整SQL...", retry+1),
				"attempt": retry + 1,
				"error":   lastError,
			})
		}
		flusher.Flush()

		// 根据上下文窗口大小截断历史
		if aiCapabilities != nil && aiCapabilities.ContextWindow > 0 {
			// 为当前prompt和响应预留一半的上下文空间
			maxHistoryTokens := aiCapabilities.ContextWindow / 2
			queryReq.History = truncateHistoryForContext(queryReq.History, maxHistoryTokens)
		}
		// 构建AI提示词（如果是重试，添加错误信息）
		var prompt string
		if retry == 0 {
			prompt = buildAIPrompt(queryReq.Message, dbSchemas, queryReq.Modules)
		} else {
			prompt = buildRetryPrompt(queryReq.Message, dbSchemas, lastError, attempts, queryReq.Modules)
		}

		// 调用AI服务生成SQL
		aiResponse, err := callAIServiceWithCapabilities(aiConfig, aiCapabilities, prompt)
		log.Printf("[AI Query] AI响应: %q, 错误: %v", aiResponse, err)
		if err != nil {
			lastError = "AI服务调用失败: " + err.Error()
			attempts = append(attempts, map[string]interface{}{
				"attempt":  retry + 1,
				"error":    lastError,
				"response": "",
				"sql":      "",
			})
			sendSSE(w, "attempt_failed", map[string]interface{}{
				"attempt": retry + 1,
				"error":   lastError,
			})
			flusher.Flush()
			continue
		}

		// 解析AI返回的SQL和回复文本
		aiResponse = cleanAIResponse(aiResponse)
		sqlQuery, targetDBID, responseText := parseAIResponse(aiResponse, dbSchemas)
		if sqlQuery == "" {
			lastError = "AI未能生成有效的SQL查询"
			attempts = append(attempts, map[string]interface{}{
				"attempt":  retry + 1,
				"error":    lastError,
				"response": aiResponse,
				"sql":      "",
			})
			sendSSE(w, "attempt_failed", map[string]interface{}{
				"attempt": retry + 1,
				"error":   lastError,
			})
			flusher.Flush()
			continue
		}

		// 检测是否生成了已执行失败过的相同 SQL
		normalizedSQL := strings.ReplaceAll(strings.ReplaceAll(sqlQuery, " ", ""), "\n", "")
		dup := false
		for _, prev := range normalizedSQLs {
			if normalizedSQL == prev {
				dup = true
				break
			}
		}
		if dup {
			lastError = "AI重复生成已尝试过的SQL，无法修复问题"
			attempts = append(attempts, map[string]interface{}{
				"attempt":  retry + 1,
				"error":    lastError,
				"response": responseText,
				"sql":      sqlQuery,
			})
			sendSSE(w, "attempt_failed", map[string]interface{}{
				"attempt": retry + 1,
				"error":   lastError,
				"sql":     sqlQuery,
			})
			flusher.Flush()
			break
		}
		normalizedLastSQL := strings.ReplaceAll(strings.ReplaceAll(lastSQL, " ", ""), "\n", "")
		if retry > 0 && normalizedSQL == normalizedLastSQL {
			lastError = "AI重复生成相同的SQL，无法修复问题"
			attempts = append(attempts, map[string]interface{}{
				"attempt":  retry + 1,
				"error":    lastError,
				"response": responseText,
				"sql":      sqlQuery,
			})
			sendSSE(w, "attempt_failed", map[string]interface{}{
				"attempt": retry + 1,
				"error":   lastError,
				"sql":     sqlQuery,
			})
			flusher.Flush()
			break
		}
		lastSQL = sqlQuery

		// 发送SQL生成完成事件
		if responseText == "" {
			responseText = "已为您执行查询"
		}
		sendSSE(w, "sql_generated", map[string]interface{}{
			"attempt":  retry + 1,
			"response": responseText,
			"sql":      sqlQuery,
		})
		flusher.Flush()

		// 检测写操作，需要用户确认
		if isWriteOperation(sqlQuery) {
			sendSSE(w, "confirm_write", map[string]interface{}{
				"response": responseText,
				"sql":      sqlQuery,
				"db_id":    targetDBID,
				"attempts": attempts,
				"retries":  retry,
			})
			sendSSE(w, "done", map[string]interface{}{})
			flusher.Flush()
			return
		}

		// 发送执行SQL事件
		sendSSE(w, "executing", map[string]interface{}{
			"message": "正在执行SQL查询...",
		})
		flusher.Flush()

		// 执行SQL查询
		dataOntologyMu.RLock()
		dbConfig, exists := dataOntologyDatabases[targetDBID]
		dataOntologyMu.RUnlock()

		if !exists || !dataOntologyResourceVisible(dbConfig.Owner, username) {
			lastError = "数据库不存在"
			attempts = append(attempts, map[string]interface{}{
				"attempt":  retry + 1,
				"error":    lastError,
				"response": responseText,
				"sql":      sqlQuery,
			})
			sendSSE(w, "attempt_failed", map[string]interface{}{
				"attempt": retry + 1,
				"error":   lastError,
				"sql":     sqlQuery,
			})
			flusher.Flush()
			continue
		}

		results, err := executeSQLQuery(dbConfig, sqlQuery, []interface{}{})
		if err != nil {
			lastError = "SQL执行失败: " + err.Error()
			errorClass := classifySQLError(err, dbConfig.Type)
			if errorClass == ErrorClassPermission {
				attempts = append(attempts, map[string]interface{}{
					"attempt":  retry + 1,
					"error":    lastError,
					"response": responseText,
					"sql":      sqlQuery,
				})
				sendSSE(w, "attempt_failed", map[string]interface{}{
					"attempt": retry + 1,
					"error":   lastError,
					"sql":     sqlQuery,
				})
				flusher.Flush()
				sendSSE(w, "error", map[string]interface{}{
					"message":  "权限不足，请联系 DBA 授权。错误：" + lastError,
					"no_retry": true,
				})
				sendSSE(w, "done", map[string]interface{}{})
				flusher.Flush()
				return
			}
			normalizedSQLs = append(normalizedSQLs, normalizedSQL)
			if errorClass == ErrorClassTimeout {
				lastError += "（请简化查询：限制行数、减少关联、避免 SELECT *）"
			}
			attempts = append(attempts, map[string]interface{}{
				"attempt":  retry + 1,
				"error":    lastError,
				"response": responseText,
				"sql":      sqlQuery,
			})
			sendSSE(w, "attempt_failed", map[string]interface{}{
				"attempt": retry + 1,
				"error":   lastError,
				"sql":     sqlQuery,
			})
			flusher.Flush()

			if retry < maxRetries-1 {
				continue
			}
		} else {
			// 成功了，返回结果（含反思洞察）
			insight := ""
			confidence := 0.0

			resultsSummary := truncateResultsForAI(results, 20, 2000)
			reflectionPrompt := buildReflectionPrompt(queryReq.Message, sqlQuery, resultsSummary, dbConfig.Type)
			reflectionResponse, refErr := callAIServiceWithCapabilities(aiConfig, aiCapabilities, reflectionPrompt)
			if refErr != nil {
				log.Printf("反思失败: %v", refErr)
			} else {
				reflection := parseReflectionResponse(reflectionResponse)
				if !reflection.AnswersQuestion && reflection.Suggestion != "" && retry < maxRetries-1 {
					log.Printf("反思建议: %s", reflection.Suggestion)
				}
				insight = reflection.Insight
				confidence = reflection.Confidence
			}

			sendSSE(w, "success", map[string]interface{}{
				"response":   responseText,
				"sql":        sqlQuery,
				"results":    results,
				"insight":    insight,
				"confidence": confidence,
				"attempts":   attempts,
				"retries":    retry,
			})
			sendSSE(w, "done", map[string]interface{}{})
			flusher.Flush()
			return
		}
	}

	// 所有重试都失败了
	sendSSE(w, "error", map[string]interface{}{
		"message":  lastError,
		"attempts": attempts,
	})
	sendSSE(w, "done", map[string]interface{}{})
	flusher.Flush()
}

// handleAIConfirmExecute 处理用户确认后的写操作执行

func handleAIConfirmExecute(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username, authOK := getDataOntologyUserFromRequest(r)
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
			"message": "只支持POST请求",
		})
		return
	}

	var req struct {
		SQL  string `json:"sql"`
		DBID string `json:"db_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求格式错误",
		})
		return
	}

	if req.SQL == "" || req.DBID == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "缺少必要参数",
		})
		return
	}

	if !isWriteOperation(req.SQL) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "该SQL不是写操作，无需确认",
		})
		return
	}

	dataOntologyMu.RLock()
	dbConfig, exists := dataOntologyDatabases[req.DBID]
	dataOntologyMu.RUnlock()

	if !exists || !dataOntologyResourceVisible(dbConfig.Owner, username) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "数据库不存在",
		})
		return
	}

	results, err := executeSQLQuery(dbConfig, req.SQL, []interface{}{})
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "SQL执行失败: " + err.Error(),
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"results": results,
		"message": "执行成功",
	})
}

// getDBSQLHints 根据数据库类型返回对应的 SQL 语法提示

func getDBSQLHints(dbType string) (queryColumns, limitSyntax, sampleQuery string) {
	switch dbType {
	case "dm":
		queryColumns = "  SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, NULLABLE\n" +
			"  FROM USER_TAB_COLUMNS\n" +
			"  WHERE TABLE_NAME IN ('TABLE1', 'TABLE2')\n" +
			"  ORDER BY TABLE_NAME, COLUMN_ID"
		limitSyntax = "SELECT * FROM table_name WHERE ROWNUM <= 10"
		sampleQuery = "SELECT * FROM table_name WHERE ROWNUM <= 10"
	case "oracle":
		queryColumns = "  SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, NULLABLE\n" +
			"  FROM USER_TAB_COLUMNS\n" +
			"  WHERE TABLE_NAME IN ('TABLE1', 'TABLE2')\n" +
			"  ORDER BY TABLE_NAME, COLUMN_ID"
		limitSyntax = "SELECT * FROM table_name WHERE ROWNUM <= 10"
		sampleQuery = "SELECT * FROM table_name WHERE ROWNUM <= 10"
	case "postgresql", "timescaledb", "cockroachdb":
		queryColumns = "  SELECT table_name, column_name, data_type, is_nullable\n" +
			"  FROM information_schema.columns\n" +
			"  WHERE table_schema = 'public' AND table_name IN ('table1', 'table2')\n" +
			"  ORDER BY table_name, ordinal_position"
		limitSyntax = "SELECT * FROM table_name LIMIT 10"
		sampleQuery = "SELECT * FROM table_name LIMIT 10"
	case "sqlserver":
		queryColumns = "  SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE\n" +
			"  FROM INFORMATION_SCHEMA.COLUMNS\n" +
			"  WHERE TABLE_NAME IN ('table1', 'table2')\n" +
			"  ORDER BY TABLE_NAME, ORDINAL_POSITION"
		limitSyntax = "SELECT TOP 10 * FROM table_name"
		sampleQuery = "SELECT TOP 10 * FROM table_name"
	default:
		queryColumns = "  SELECT table_name, column_name, data_type, column_comment\n" +
			"  FROM information_schema.columns\n" +
			"  WHERE table_schema = DATABASE() AND table_name IN ('table1', 'table2')\n" +
			"  ORDER BY table_name, ordinal_position"
		limitSyntax = "SELECT * FROM table_name LIMIT 10"
		sampleQuery = "SELECT * FROM table_name LIMIT 10"
	}
	return
}

// getDBSpecificWarnings 根据数据库类型返回特定的语法警告

func getDBSpecificWarnings(dbType string) string {
	switch dbType {
	case "dm":
		return "⚠️ 达梦数据库语法注意事项：\n" +
			"- 【禁止】不要使用 LIMIT，用 WHERE ROWNUM <= N 限制行数\n" +
			"- 【禁止】不要使用 information_schema，用 USER_TAB_COLUMNS、USER_TABLES 等数据字典视图\n" +
			"- 【禁止】不要使用 DATABASE() 函数\n" +
			"- 【禁止】INSERT时不要向自增/IDENTITY列插入值，跳过标记为[自增主键]的列\n" +
			"- 表名和列名默认大写\n" +
			"- 字符串用单引号\n" +
			"- 支持 ROWNUM 伪列来限制结果集\n\n"
	case "oracle":
		return "⚠️ Oracle 语法注意事项：\n" +
			"- 不要使用 LIMIT，用 WHERE ROWNUM <= N\n" +
			"- 不要使用 information_schema，用 USER_TAB_COLUMNS 等数据字典视图\n" +
			"- 表名和列名默认大写\n\n"
	case "sqlserver":
		return "⚠️ SQL Server 语法注意事项：\n" +
			"- 不要使用 LIMIT，用 SELECT TOP N\n" +
			"- 使用 INFORMATION_SCHEMA.COLUMNS 查询字段信息\n\n"
	default:
		return ""
	}
}

// ErrorClass 错误类型枚举

type ErrorClass string

const (
	ErrorClassSyntax         ErrorClass = "syntax"
	ErrorClassObjectNotFound ErrorClass = "object_not_found"
	ErrorClassPermission     ErrorClass = "permission"
	ErrorClassTimeout        ErrorClass = "timeout"
	ErrorClassAmbiguous      ErrorClass = "ambiguous"
	ErrorClassUnknown        ErrorClass = "unknown"
)

// classifySQLError 根据错误信息分类

func classifySQLError(err error, dbType string) ErrorClass {
	_ = dbType
	errStr := strings.ToLower(err.Error())

	if strings.Contains(errStr, "-2007") ||
		strings.Contains(errStr, "1064") ||
		strings.Contains(errStr, "ora-00933") ||
		strings.Contains(errStr, "语法分析") ||
		strings.Contains(errStr, "syntax") ||
		strings.Contains(errStr, "near") {
		return ErrorClassSyntax
	}

	if strings.Contains(errStr, "doesn't exist") ||
		strings.Contains(errStr, "不存在") ||
		strings.Contains(errStr, "-2106") ||
		strings.Contains(errStr, "invalid object") {
		return ErrorClassObjectNotFound
	}

	if strings.Contains(errStr, "permission") ||
		strings.Contains(errStr, "拒绝") ||
		strings.Contains(errStr, "ora-01031") ||
		strings.Contains(errStr, "-5512") {
		return ErrorClassPermission
	}

	if strings.Contains(errStr, "timeout") ||
		strings.Contains(errStr, "超时") ||
		strings.Contains(errStr, "deadline") {
		return ErrorClassTimeout
	}

	if strings.Contains(errStr, "ambiguous") {
		return ErrorClassAmbiguous
	}

	return ErrorClassUnknown
}

var sqlDocsCache = make(map[string]string)

var sqlDocsOnce sync.Once

// loadSQLDoc 加载 SQL 文档（带缓存）

func loadSQLDoc(dbType string) string {
	sqlDocsOnce.Do(func() {
		docs := map[string]string{
			"dm":     "docs/sql/dm.md",
			"oracle": "docs/sql/oracle.md",
		}
		for t, path := range docs {
			content, err := os.ReadFile(path)
			if err == nil {
				s := string(content)
				if len(s) > 8000 {
					s = s[:8000] + "\n... (文档已截断)"
				}
				sqlDocsCache[t] = s
			}
		}
	})

	if doc, ok := sqlDocsCache[dbType]; ok {
		return doc
	}
	return ""
}

// formatDBSchemaForPrompt 将数据库结构格式化为提示词文本，返回格式化文本和主数据库类型

func formatDBSchemaForPrompt(dbSchemas []map[string]interface{}) (string, string) {
	var sb strings.Builder
	var primaryDBType string

	for _, schema := range dbSchemas {
		sb.WriteString(fmt.Sprintf("\n数据库: %s (类型: %s)\n", schema["name"], schema["type"]))
		sb.WriteString(strings.Repeat("=", 50) + "\n")

		if primaryDBType == "" {
			if t, ok := schema["type"].(string); ok {
				primaryDBType = t
			}
		}

		// 新格式：带字段信息的表结构
		if tables, ok := schema["tables"].([]map[string]interface{}); ok {
			for _, table := range tables {
				tableName, _ := table["name"].(string)
				sb.WriteString(fmt.Sprintf("\n表: %s\n", tableName))
				if columns, ok := table["columns"].([]map[string]interface{}); ok && len(columns) > 0 {
					sb.WriteString("  字段:\n")
					for i, col := range columns {
						colName, _ := col["name"].(string)
						colType, _ := col["type"].(string)
						tags := ""

						// 检测自增列：类型中显式标记，或第一个整数类型的 ID 列
						isAutoInc := strings.Contains(colType, "AUTO_INCREMENT")
						if !isAutoInc && i == 0 {
							upperName := strings.ToUpper(colName)
							upperType := strings.ToUpper(colType)
							if (upperName == "ID" || strings.HasSuffix(upperName, "_ID")) &&
								(strings.Contains(upperType, "INT") || strings.Contains(upperType, "NUMBER") || strings.Contains(upperType, "NUMERIC")) {
								isAutoInc = true
							}
						}

						if isAutoInc {
							tags += " [自增主键,INSERT时跳过]"
						} else {
							if n, ok := col["nullable"].(string); ok && n == "N" {
								tags += " [NOT NULL]"
							}
						}
						sb.WriteString(fmt.Sprintf("    - %s (%s)%s\n", colName, colType, tags))
					}
				} else {
					sb.WriteString("  （字段信息不可用）\n")
				}
			}
		} else if tables, ok := schema["tables"].([]string); ok {
			// 旧格式：仅表名列表
			sb.WriteString("表列表: " + strings.Join(tables, ", ") + "\n")
		}

		// 添加本体关系信息
		if relations, ok := schema["relations"].([]OntologyRelation); ok && len(relations) > 0 {
			sb.WriteString("\n本体关系（字段间语义关联）:\n")
			sb.WriteString(strings.Repeat("-", 40) + "\n")
			for _, rel := range relations {
				sb.WriteString(fmt.Sprintf("  • %s\n", rel.Name))
				sb.WriteString(fmt.Sprintf("    %s.%s ↔ %s.%s\n",
					rel.Source.TableName, rel.Source.FieldName,
					rel.Target.TableName, rel.Target.FieldName))
				if rel.Description != "" {
					sb.WriteString(fmt.Sprintf("    说明: %s\n", rel.Description))
				}
			}
			sb.WriteString("\n提示：上述关系表示不同表之间字段的语义关联，可在 JOIN 或分析时参考。\n")
		}
	}
	return sb.String(), primaryDBType
}

func getModulePromptPrefix(modules []string) string {
	moduleSet := make(map[string]bool)
	for _, m := range modules {
		moduleSet[m] = true
	}

	if moduleSet["db-manage"] {
		return "你是一个专业的数据库管理助手。你必须优先生成可执行、最小化、单条 SQL，并严格遵守数据库方言。若信息不足，只保留最核心的查询意图，不要扩写。\n\n"
	}
	return "你是一个专业的数据库助手。你必须优先生成可执行、最小化、单条 SQL，并严格遵守数据库方言。若信息不足，只保留最核心的查询意图，不要扩写。\n\n"
}

// ReflectionResult 反思结果

type ReflectionResult struct {
	AnswersQuestion bool    `json:"answers_question"`
	Confidence      float64 `json:"confidence"`
	Issue           string  `json:"issue"`
	Insight         string  `json:"insight"`
	Suggestion      string  `json:"suggestion"`
}

var reflectionJSONRegexp = regexp.MustCompile(`\{[\s\S]*\}`)

// parseReflectionResponse 解析反思响应

func parseReflectionResponse(response string) ReflectionResult {
	result := ReflectionResult{
		AnswersQuestion: true,
		Confidence:      0.5,
		Issue:           "ok",
		Insight:         "",
		Suggestion:      "",
	}

	jsonMatch := reflectionJSONRegexp.FindString(response)
	if jsonMatch == "" {
		return result
	}

	if err := json.Unmarshal([]byte(jsonMatch), &result); err != nil {
		log.Printf("解析反思结果失败: %v", err)
	}

	return result
}

// truncateResultsForAI 裁剪结果供 AI 分析

func truncateResultsForAI(results []map[string]interface{}, maxRows int, maxChars int) map[string]interface{} {
	if len(results) == 0 {
		return map[string]interface{}{
			"row_count": 0,
			"columns":   []string{},
			"sample":    []map[string]interface{}{},
		}
	}

	columns := make([]string, 0, len(results[0]))
	for k := range results[0] {
		columns = append(columns, k)
	}
	sort.Strings(columns)

	sample := results
	if len(results) > maxRows {
		sample = results[:maxRows]
	}

	totalChars := 0
	truncatedSample := []map[string]interface{}{}
	for _, row := range sample {
		newRow := make(map[string]interface{})
		for _, k := range columns {
			v, ok := row[k]
			if !ok {
				continue
			}
			str := fmt.Sprintf("%v", v)
			if len(str) > 200 {
				str = str[:200] + "..."
			}
			newRow[k] = str
			totalChars += len(str)
		}
		truncatedSample = append(truncatedSample, newRow)
		if totalChars > maxChars {
			break
		}
	}

	return map[string]interface{}{
		"row_count": len(results),
		"columns":   columns,
		"sample":    truncatedSample,
	}
}

// buildReflectionPrompt 构建反思提示词

func buildReflectionPrompt(userMessage string, sqlQuery string, resultsSummary map[string]interface{}, dbType string) string {
	var sb strings.Builder

	sb.WriteString("你是一个数据分析专家。请分析以下 SQL 查询结果是否回答了用户的问题。\n\n")

	sb.WriteString("## 用户问题\n")
	sb.WriteString(userMessage + "\n\n")

	sb.WriteString("## 数据库类型\n")
	sb.WriteString(dbType + "\n\n")

	sb.WriteString("## 执行的 SQL\n")
	sb.WriteString(sqlQuery + "\n\n")

	sb.WriteString("## 查询结果摘要\n")
	sb.WriteString(fmt.Sprintf("- 总行数: %v\n", resultsSummary["row_count"]))
	sb.WriteString(fmt.Sprintf("- 列名: %v\n", resultsSummary["columns"]))
	sb.WriteString("- 样本数据（前几行）:\n")

	sampleJSON, err := json.MarshalIndent(resultsSummary["sample"], "", "  ")
	if err != nil {
		sb.WriteString("[]\n\n")
	} else {
		sb.WriteString(string(sampleJSON) + "\n\n")
	}

	sb.WriteString("## 请输出 JSON 格式的分析\n")
	sb.WriteString("要求：只输出一个 JSON 对象，不要输出其他内容。\n\n")
	sb.WriteString("JSON 字段说明：\n")
	sb.WriteString("- answers_question: boolean，查询结果是否在实质上回答了用户问题\n")
	sb.WriteString("- confidence: number，0~1，你对上述判断的置信度\n")
	sb.WriteString("- issue: string，若有问题简要说明，否则 \"ok\"\n")
	sb.WriteString("- insight: string，面向用户的中文结论与数据解读（简洁）\n")
	sb.WriteString("- suggestion: string，若未充分回答，给出改进 SQL 或下一步建议；否则可为空字符串\n")

	return sb.String()
}

// buildAIPrompt 构建AI提示词

func buildAIPrompt(userMessage string, dbSchemas []map[string]interface{}, modules []string) string {
	prompt := getModulePromptPrefix(modules)
	prompt += "【重要】以下是真实的数据库结构信息，请严格基于这些表和字段生成SQL，不要编造不存在的列名或表名：\n"

	schemaText, primaryDBType := formatDBSchemaForPrompt(dbSchemas)
	prompt += schemaText

	queryColumns, _, sampleQuery := getDBSQLHints(primaryDBType)

	prompt += "\n用户问题：" + userMessage + "\n\n"

	prompt += getDBSpecificWarnings(primaryDBType)

	prompt += "⚠️ 重要规则：\n"
	prompt += "1. 【必须】只生成一条SQL语句！不能生成多条SQL语句！\n"
	prompt += "2. 【必须】只使用上面列出的真实表名和字段名，绝对不要编造列名！\n"
	prompt += "3. 【禁止】不要使用 UNION ALL 合并不同表的数据（列数和类型不同会报错）\n"
	prompt += "4. 对于INSERT操作：必须使用表中实际存在的字段名；标记为[自增主键,INSERT时跳过]的列绝对不要包含在INSERT语句中；根据字段类型填入合理的示例数据\n"
	prompt += "5. 使用子查询或聚合函数来统计多个表的信息\n"
	prompt += "6. 如果问题信息不足，只能基于已知结构给出最小可执行查询，必要时先返回最相关的表或字段\n\n"
	prompt += "📚 根据问题类型选择正确的SQL：\n\n"
	prompt += "🔍 查询表结构/字段信息：\n"
	prompt += queryColumns + "\n\n"
	prompt += "📊 分析/统计多个表的数据：\n"
	prompt += "  SELECT \n"
	prompt += "    'products' as table_name, COUNT(*) as row_count FROM products\n"
	prompt += "  UNION ALL\n"
	prompt += "  SELECT 'users' as table_name, COUNT(*) as row_count FROM users\n\n"
	prompt += "📋 查看表的样本数据：\n"
	prompt += "  " + sampleQuery + "\n\n"
	prompt += "✏️ 写入数据时：\n"
	prompt += "  必须先参考上方的表结构，使用实际存在的字段名，根据数据类型生成合理的值\n\n"
	prompt += "❌ 错误示例（不要这样做）：\n"
	prompt += "  SELECT * FROM table1 UNION ALL SELECT * FROM table2  -- 错误！不同表结构无法合并\n"
	prompt += "  INSERT INTO table1 (column1, column2) VALUES (...)  -- 错误！不要编造字段名\n\n"
	prompt += "🎯 理解用户意图：\n"
	prompt += "- 如果问\"有哪些字段/列\"：根据上方提供的表结构直接回答，或查询数据字典\n"
	prompt += "- 如果问\"分析数据/统计\"：使用 COUNT(*), SUM(), AVG() 等聚合函数\n"
	prompt += "- 如果问\"查看数据/内容\"：使用 " + sampleQuery + "\n"
	prompt += "- 如果要求\"写入/插入数据\"：根据上方表结构中的真实字段名生成INSERT语句\n"
	prompt += "- 如果涉及多个表：用子查询或统计，不要用 UNION ALL 合并不同结构的数据\n\n"
	prompt += "请按以下格式回复：\n"
	prompt += "1. 用一句话说明你将要做什么（例如：\"我将统计各表的数据量\"）\n"
	prompt += "2. 提供SQL语句（只能有一条）：\n"
	prompt += "```sql\n"
	prompt += "SELECT ... FROM ... ;\n"
	prompt += "```\n\n"
	prompt += "注意：\n"
	prompt += "- 回复要简洁友好\n"
	prompt += "- 只生成一条可执行的SQL语句\n"
	prompt += "- 严格使用上面提供的真实字段名，不要猜测或编造\n"
	prompt += "- 不要包含过多的技术解释"

	return prompt
}

// buildRetryPrompt 构建重试提示词

func buildRetryPrompt(userMessage string, dbSchemas []map[string]interface{}, lastError string, attempts []map[string]interface{}, modules []string) string {
	primaryDBType := "mysql"
	if len(dbSchemas) > 0 {
		if t, ok := dbSchemas[0]["type"].(string); ok && t != "" {
			primaryDBType = t
		}
	}
	errorClass := classifySQLError(errors.New(lastError), primaryDBType)

	var sb strings.Builder
	sb.WriteString(getModulePromptPrefix(modules))
	sb.WriteString("上一次查询失败，请根据错误信息修正。\n\n")

	switch errorClass {
	case ErrorClassSyntax:
		sb.WriteString("【语法错误】\n")
		sb.WriteString("1. 检查 SQL 语法是否符合 " + primaryDBType + " 规范\n")
		sb.WriteString("2. 注意：DM/Oracle 不支持 LIMIT，请用 ROWNUM\n")
		sb.WriteString("3. 确保关键字拼写正确\n")
		if doc := loadSQLDoc(primaryDBType); doc != "" {
			sb.WriteString("\n## " + primaryDBType + " 参考文档\n")
			sb.WriteString(doc)
			sb.WriteString("\n")
		}
	case ErrorClassObjectNotFound:
		sb.WriteString("【对象不存在】\n")
		sb.WriteString("1. 只能使用以下表：\n")
		for _, db := range dbSchemas {
			if tables, ok := db["tables"].([]map[string]interface{}); ok {
				for _, t := range tables {
					sb.WriteString("  - " + fmt.Sprintf("%v", t["name"]) + "\n")
				}
			}
		}
		sb.WriteString("2. 检查表名大小写\n")
	case ErrorClassPermission:
		sb.WriteString("【权限不足】\n")
		sb.WriteString("此错误无法通过修改 SQL 解决，请联系 DBA 授权。\n")
		sb.WriteString("不要重试生成 SQL。\n")
	case ErrorClassTimeout:
		sb.WriteString("【查询超时】\n")
		sb.WriteString("1. 添加 ROWNUM <= 100 限制行数\n")
		sb.WriteString("2. 减少关联表数量\n")
		sb.WriteString("3. 只查询必要字段，避免 SELECT *\n")
	case ErrorClassAmbiguous:
		sb.WriteString("【列名歧义】\n")
		sb.WriteString("请为所有列添加表别名，如：t1.column_name\n")
	}

	sb.WriteString("\n历史尝试：\n")
	for _, a := range attempts {
		sb.WriteString(fmt.Sprintf("第%v次: SQL=%v, 错误=%v\n",
			a["attempt"], a["sql"], a["error"]))
	}

	schemaText, pdb := formatDBSchemaForPrompt(dbSchemas)
	if pdb != "" {
		primaryDBType = pdb
	}
	sb.WriteString("\n【重要】以下是真实的数据库结构信息，请严格基于这些表和字段生成SQL，不要编造不存在的列名或表名：\n")
	sb.WriteString(schemaText)

	queryColumns, _, sampleQuery := getDBSQLHints(primaryDBType)

	sb.WriteString("\n用户问题：" + userMessage + "\n\n")

	sb.WriteString(getDBSpecificWarnings(primaryDBType))

	sb.WriteString("⚠️ 重要注意事项：\n")
	sb.WriteString("1. 【必须】只生成一条SQL语句，不要生成多条语句！\n")
	sb.WriteString("2. 如果错误信息包含'near'关键字，说明SQL语法有问题，请仔细检查：\n")
	sb.WriteString("   - 是否有多条SQL语句？如果有，只保留一条或合并为一条\n")
	sb.WriteString("   - 是否有语法错误的关键字？\n")
	sb.WriteString("   - 是否缺少或多余了分号、引号等符号？\n")
	sb.WriteString("3. 如果错误信息包含'Table doesn't exist'或'对象不存在'，请使用正确的表名\n")
	sb.WriteString("4. 如果错误信息包含'Column doesn't exist'或'列不存在'，请使用正确的字段名\n")
	sb.WriteString("5. 如果错误信息包含'different number of columns'，说明UNION的表结构不同：\n")
	sb.WriteString("   ❌ 不要用：SELECT * FROM table1 UNION ALL SELECT * FROM table2\n")
	sb.WriteString("   ✅ 改用统计：SELECT 'table1' as name, COUNT(*) as count FROM table1 UNION ALL SELECT 'table2', COUNT(*) FROM table2\n")
	sb.WriteString("   ✅ 或用子查询：SELECT (SELECT COUNT(*) FROM table1) as table1_count, (SELECT COUNT(*) FROM table2) as table2_count\n\n")

	sb.WriteString("📚 正确的SQL参考示例：\n")
	sb.WriteString("🔍 查询表结构：\n" + queryColumns + "\n")
	sb.WriteString("📋 查看样本数据：" + sampleQuery + "\n\n")

	if strings.Contains(lastError, "near") && strings.Contains(lastError, "at line 2") {
		sb.WriteString("🔍 根据错误分析：你生成了多条SQL语句，但系统只能执行一条！\n")
		sb.WriteString("请修改为只生成一条SQL语句。\n\n")
	}

	if strings.Contains(lastError, "different number of columns") {
		sb.WriteString("🔍 根据错误分析：你使用UNION ALL合并了列数不同的表！\n")
		sb.WriteString("解决方案：\n")
		sb.WriteString("1. 如果是统计数据，使用：SELECT 'table1' as table_name, COUNT(*) as count FROM table1 UNION ALL SELECT 'table2', COUNT(*) FROM table2\n")
		sb.WriteString("2. 如果是查询字段，使用：\n" + queryColumns + "\n")
		sb.WriteString("3. 不要直接合并不同结构的表数据！\n\n")
	}

	if strings.Contains(lastError, "connectex") || strings.Contains(lastError, "connection") {
		sb.WriteString("🔍 根据错误分析：数据库连接超时或失败！\n")
		sb.WriteString("请生成简单的SQL语句，避免复杂查询导致超时。\n\n")
	}

	if strings.Contains(lastError, "LIMIT") || strings.Contains(lastError, "语法分析") {
		sb.WriteString("🔍 根据错误分析：SQL语法不兼容当前数据库！\n")
		sb.WriteString("请严格使用当前数据库（" + primaryDBType + "）支持的SQL语法。\n\n")
	}

	sb.WriteString("请按以下格式回复：\n")
	sb.WriteString("1. 简单说明你发现的问题和修正方案（一句话）\n")
	sb.WriteString("2. 提供修正后的SQL（只能有一条SQL语句）：\n")
	sb.WriteString("```sql\n")
	sb.WriteString("SELECT ... FROM ...;\n")
	sb.WriteString("```\n\n")
	sb.WriteString("❗ 再次强调：只生成一条SQL语句！")

	return sb.String()
}

// cleanAIResponse 清洗模型输出，去掉 think、代码块和多余空白

func cleanAIResponse(response string) string {
	response = strings.TrimSpace(response)
	response = strings.ReplaceAll(response, "\r\n", "\n")
	response = strings.ReplaceAll(response, "\r", "\n")

	// 处理 think 标签：删除标签及其内容，保留标签外的内容
	// 如果只有开标签没有闭标签，保留开标签后面的内容（流式输出可能还没收到闭标签）
	for strings.Contains(response, "<think>") {
		start := strings.Index(response, "<think>")
		endTag := strings.Index(response[start:], "</think>")
		if endTag < 0 {
			// 只有开标签，没有闭标签：保留开标签后面的内容
			response = response[start:]
			break
		}
		// 有完整的 think 标签，删除标签及其内容
		response = response[:start] + response[start+endTag+8:]
	}

	// 处理其他标记
	for _, marker := range []string{"<analysis>", "</analysis>"} {
		response = strings.ReplaceAll(response, marker, "")
	}

	response = strings.TrimSpace(response)

	// 处理代码块标记
	// 优先处理 ```json 和 ```sql，它们会包含结束的 ```
	hasCodeBlock := false
	if idx := strings.Index(response, "```json"); idx >= 0 {
		response = response[idx+len("```json"):]
		hasCodeBlock = true
	} else if idx := strings.Index(response, "```sql"); idx >= 0 {
		response = response[idx+len("```sql"):]
		hasCodeBlock = true
	} else if idx := strings.Index(response, "```"); idx >= 0 {
		// 只有在没有 ```json 或 ```sql 时才处理普通的 ```
		response = response[idx+len("```"):]
		hasCodeBlock = true
	}

	response = strings.TrimSpace(response)

	// 如果有代码块开始标记，找结束标记
	if hasCodeBlock {
		if idx := strings.LastIndex(response, "```"); idx >= 0 {
			response = response[:idx]
		}
	}

	return strings.TrimSpace(response)
}

func extractJSONObject(s string) string {
	s = cleanAIResponse(s)
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start >= 0 && end > start {
		return strings.TrimSpace(s[start : end+1])
	}
	return ""
}

// callAIService 调用AI服务

func callAIService(config *AIConfig, prompt string) (string, error) {
	return callAIServiceWithCapabilities(config, nil, prompt)
}

// callAIServiceWithCapabilities 根据能力自适应调用AI服务
// getAIEndpoint 确保 AI 服务 URL 包含 /chat/completions 路径

func getAIEndpoint(url string) string {
	url = strings.TrimSpace(url)
	if strings.HasSuffix(url, "/chat/completions") {
		return url
	}
	// 移除末尾斜杠后拼接
	url = strings.TrimRight(url, "/")
	return url + "/chat/completions"
}

// getEmbeddingEndpoint 确保 embedding 服务 URL 包含 /embeddings 路径

func getEmbeddingEndpoint(url string) string {
	url = strings.TrimSpace(url)
	if strings.HasSuffix(url, "/embeddings") {
		return url
	}
	url = strings.TrimRight(url, "/")
	return url + "/embeddings"
}

func callAIServiceWithCapabilities(config *AIConfig, capabilities *AICapabilities, prompt string) (string, error) {
	// 构建请求体
	requestBody := map[string]interface{}{
		"model": config.Model,
		"messages": []map[string]string{
			{
				"role":    "user",
				"content": prompt,
			},
		},
		"temperature": 0.1,
	}

	// 如果支持JSON模式且需要结构化输出，启用JSON模式
	if capabilities != nil && capabilities.SupportsJSONMode {
		// 检查prompt是否要求JSON输出
		if strings.Contains(prompt, "JSON") || strings.Contains(prompt, "json") ||
			strings.Contains(prompt, "返回JSON") || strings.Contains(prompt, "格式如下") {
			requestBody["response_format"] = map[string]string{"type": "json_object"}
		}
	}

	// 如果支持Extended Thinking，可以添加thinking参数（针对支持的模型）
	// 注意：这需要API支持，目前先预留
	if capabilities != nil && capabilities.SupportsThinking {
		// 可以在这里添加thinking相关的参数
		// 例如对于某些模型可以添加: requestBody["thinking"] = map[string]interface{}{...}
	}

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return "", fmt.Errorf("构建请求失败: %v", err)
	}

	// 创建HTTP请求
	req, err := http.NewRequest("POST", getAIEndpoint(config.URL), bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.APIKey)

	// 使用配置的超时时间，默认120秒，避免大模型首次响应过慢导致超时
	timeout := config.Timeout
	if timeout <= 0 {
		timeout = 120
	}
	client := &http.Client{
		Timeout: time.Duration(timeout) * time.Second,
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 读取响应（容错解析：先读取原始字节，再尝试多种解析方式）
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取响应失败: %v", err)
	}

	// 尝试解析为 OpenAI 格式的 JSON 对象
	var result map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &result); err != nil {
		// 如果顶层不是对象，尝试解析为数组（某些 API 可能返回数组）
		var arrResult []interface{}
		if arrErr := json.Unmarshal(bodyBytes, &arrResult); arrErr == nil && len(arrResult) > 0 {
			// 数组第一个元素作为结果
			if first, ok := arrResult[0].(map[string]interface{}); ok {
				result = first
			} else {
				// 数组元素不是对象，返回原始文本
				return string(bodyBytes), nil
			}
		} else {
			// 既不是对象也不是数组，返回原始文本让后续逻辑处理
			log.Printf("[AI Service] JSON 解析失败: %v, 原始响应: %s", err, string(bodyBytes[:min(len(bodyBytes), 500)]))
			return string(bodyBytes), nil
		}
	}

	// 检查响应状态
	if resp.StatusCode != http.StatusOK {
		if errMsg, ok := result["error"].(map[string]interface{}); ok {
			if msg, ok := errMsg["message"].(string); ok {
				return "", fmt.Errorf("AI服务错误: %s", msg)
			}
		}
		return "", fmt.Errorf("AI服务返回错误状态: %d", resp.StatusCode)
	}

	// 提取响应内容
	if choices, ok := result["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if message, ok := choice["message"].(map[string]interface{}); ok {
				if content, ok := message["content"].(string); ok {
					return content, nil
				}
			}
		}
	}

	return "", fmt.Errorf("无法解析AI响应")
}

// AICapabilityTestResult 单项能力测试结果

type AICapabilityTestResult struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// AICapabilitiesDetectionDetails 详细检测结果

type AICapabilitiesDetectionDetails struct {
	Connectivity AICapabilityTestResult `json:"connectivity"`
	FunctionCall AICapabilityTestResult `json:"function_call"`
	Streaming    AICapabilityTestResult `json:"streaming"`
	JSONMode     AICapabilityTestResult `json:"json_mode"`
}

// detectAICapabilities 检测AI模型的能力（通过实际API调用测试）

func detectAICapabilities(config *AIConfig) (*AICapabilities, error) {
	if config == nil || config.URL == "" || config.APIKey == "" || config.Model == "" {
		return nil, fmt.Errorf("AI配置不完整")
	}

	log.Printf("[AI能力检测] 开始检测模型: %s, URL: %s", config.Model, config.URL)

	capabilities := &AICapabilities{
		SupportsFunctionCall: false,
		SupportsThinking:     false,
		SupportsStreaming:    true, // 默认支持流式，大多数模型都支持
		ContextWindow:        4096, // 默认上下文窗口
		SupportsJSONMode:     false,
		DetectedAt:           time.Now().Unix(),
	}

	// 优先使用手动设置
	if config.EnableFunctionCall != nil {
		capabilities.SupportsFunctionCall = *config.EnableFunctionCall
		log.Printf("[AI能力检测] Function Call 已手动设置: %v", capabilities.SupportsFunctionCall)
	}
	if config.EnableThinking != nil {
		capabilities.SupportsThinking = *config.EnableThinking
		log.Printf("[AI能力检测] Thinking 已手动设置: %v", capabilities.SupportsThinking)
	}
	if config.EnableStreaming != nil {
		capabilities.SupportsStreaming = *config.EnableStreaming
		log.Printf("[AI能力检测] Streaming 已手动设置: %v", capabilities.SupportsStreaming)
	}
	if config.EnableJSONMode != nil {
		capabilities.SupportsJSONMode = *config.EnableJSONMode
		log.Printf("[AI能力检测] JSON Mode 已手动设置: %v", capabilities.SupportsJSONMode)
	}
	if config.ContextWindowOverride > 0 {
		capabilities.ContextWindow = config.ContextWindowOverride
		log.Printf("[AI能力检测] Context Window 已手动设置: %d", capabilities.ContextWindow)
	}

	// 如果所有能力都已手动设置，直接返回
	if config.EnableFunctionCall != nil && config.EnableThinking != nil &&
		config.EnableStreaming != nil && config.EnableJSONMode != nil &&
		config.ContextWindowOverride > 0 {
		log.Printf("[AI能力检测] 所有能力已手动设置，跳过自动检测")
		return capabilities, nil
	}

	// 创建HTTP客户端（10秒超时）
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// 1. 测试基本连通性
	log.Printf("[AI能力检测] 测试基本连通性...")
	connectivityOK, connectivityErr := testBasicConnectivity(client, config)
	if connectivityOK {
		log.Printf("[AI能力检测] ✓ 基本连通性测试成功")
	} else {
		log.Printf("[AI能力检测] ✗ 基本连通性测试失败: %v", connectivityErr)
	}

	// 2. 测试 Function Call（如果未手动设置）
	if config.EnableFunctionCall == nil && connectivityOK {
		log.Printf("[AI能力检测] 测试 Function Call 支持...")
		supported, err := testFunctionCall(client, config)
		capabilities.SupportsFunctionCall = supported
		if supported {
			log.Printf("[AI能力检测] ✓ 支持 Function Call")
		} else {
			log.Printf("[AI能力检测] ✗ 不支持 Function Call: %v", err)
		}
	}

	// 3. 测试 Streaming（如果未手动设置）
	if config.EnableStreaming == nil && connectivityOK {
		log.Printf("[AI能力检测] 测试 Streaming 支持...")
		supported, err := testStreaming(client, config)
		capabilities.SupportsStreaming = supported
		if supported {
			log.Printf("[AI能力检测] ✓ 支持 Streaming")
		} else {
			log.Printf("[AI能力检测] ✗ 不支持 Streaming: %v", err)
		}
	}

	// 4. 测试 JSON Mode（如果未手动设置）
	if config.EnableJSONMode == nil && connectivityOK {
		log.Printf("[AI能力检测] 测试 JSON Mode 支持...")
		supported, err := testJSONMode(client, config)
		capabilities.SupportsJSONMode = supported
		if supported {
			log.Printf("[AI能力检测] ✓ 支持 JSON Mode")
		} else {
			log.Printf("[AI能力检测] ✗ 不支持 JSON Mode: %v", err)
		}
	}

	// 5. 根据模型名称推断上下文窗口大小（如果未手动设置）
	if config.ContextWindowOverride == 0 {
		capabilities.ContextWindow = inferContextWindow(config.Model)
		log.Printf("[AI能力检测] 推断上下文窗口大小: %d", capabilities.ContextWindow)
	}

	// 6. 根据模型名称推断是否支持 Thinking（如果未手动设置）
	if config.EnableThinking == nil {
		capabilities.SupportsThinking = inferThinkingSupport(config.Model)
		log.Printf("[AI能力检测] 推断 Thinking 支持: %v", capabilities.SupportsThinking)
	}

	log.Printf("[AI能力检测] 检测完成: FunctionCall=%v, Streaming=%v, JSONMode=%v, Thinking=%v, ContextWindow=%d",
		capabilities.SupportsFunctionCall, capabilities.SupportsStreaming,
		capabilities.SupportsJSONMode, capabilities.SupportsThinking,
		capabilities.ContextWindow)

	return capabilities, nil
}

// testBasicConnectivity 测试基本连通性

func testBasicConnectivity(client *http.Client, config *AIConfig) (bool, error) {
	requestBody := map[string]interface{}{
		"model": config.Model,
		"messages": []map[string]string{
			{"role": "user", "content": "hello"},
		},
		"max_tokens": 10,
	}

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return false, fmt.Errorf("构建请求失败: %v", err)
	}

	req, err := http.NewRequest("POST", getAIEndpoint(config.URL), bytes.NewBuffer(jsonData))
	if err != nil {
		return false, fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.APIKey)

	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := ioutil.ReadAll(resp.Body)
		return false, fmt.Errorf("HTTP状态码: %d, 响应: %s", resp.StatusCode, string(bodyBytes))
	}

	return true, nil
}

// testFunctionCall 测试 Function Call 支持

func testFunctionCall(client *http.Client, config *AIConfig) (bool, error) {
	// 定义一个简单的测试工具
	requestBody := map[string]interface{}{
		"model": config.Model,
		"messages": []map[string]string{
			{"role": "user", "content": "What's the weather in Beijing?"},
		},
		"tools": []map[string]interface{}{
			{
				"type": "function",
				"function": map[string]interface{}{
					"name":        "get_weather",
					"description": "Get the current weather for a location",
					"parameters": map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"location": map[string]interface{}{
								"type":        "string",
								"description": "The city name",
							},
						},
						"required": []string{"location"},
					},
				},
			},
		},
		"tool_choice": "auto",
		"max_tokens":  100,
	}

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return false, fmt.Errorf("构建请求失败: %v", err)
	}

	req, err := http.NewRequest("POST", getAIEndpoint(config.URL), bytes.NewBuffer(jsonData))
	if err != nil {
		return false, fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.APIKey)

	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := ioutil.ReadAll(resp.Body)
		return false, fmt.Errorf("HTTP状态码: %d, 响应: %s", resp.StatusCode, string(bodyBytes))
	}

	// 解析响应，检查是否包含 tool_calls
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("解析响应失败: %v", err)
	}

	// 检查是否有 tool_calls
	if choices, ok := result["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if message, ok := choice["message"].(map[string]interface{}); ok {
				if _, hasToolCalls := message["tool_calls"]; hasToolCalls {
					return true, nil
				}
			}
		}
	}

	return false, fmt.Errorf("响应中未包含 tool_calls 字段")
}

// testStreaming 测试流式输出支持

func testStreaming(client *http.Client, config *AIConfig) (bool, error) {
	requestBody := map[string]interface{}{
		"model": config.Model,
		"messages": []map[string]string{
			{"role": "user", "content": "hi"},
		},
		"stream":     true,
		"max_tokens": 10,
	}

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return false, fmt.Errorf("构建请求失败: %v", err)
	}

	req, err := http.NewRequest("POST", getAIEndpoint(config.URL), bytes.NewBuffer(jsonData))
	if err != nil {
		return false, fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.APIKey)

	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := ioutil.ReadAll(resp.Body)
		return false, fmt.Errorf("HTTP状态码: %d, 响应: %s", resp.StatusCode, string(bodyBytes))
	}

	// 检查是否返回 SSE 流
	contentType := resp.Header.Get("Content-Type")
	if strings.Contains(contentType, "text/event-stream") ||
		strings.Contains(contentType, "application/stream+json") {
		return true, nil
	}

	return false, fmt.Errorf("Content-Type 不是流式类型: %s", contentType)
}

// testJSONMode 测试 JSON 输出模式支持

func testJSONMode(client *http.Client, config *AIConfig) (bool, error) {
	requestBody := map[string]interface{}{
		"model": config.Model,
		"messages": []map[string]string{
			{"role": "user", "content": "Return a JSON object with a 'status' field set to 'ok'"},
		},
		"response_format": map[string]string{"type": "json_object"},
		"max_tokens":      50,
	}

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return false, fmt.Errorf("构建请求失败: %v", err)
	}

	req, err := http.NewRequest("POST", getAIEndpoint(config.URL), bytes.NewBuffer(jsonData))
	if err != nil {
		return false, fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.APIKey)

	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 如果返回 400 或其他错误，可能不支持 JSON mode
	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := ioutil.ReadAll(resp.Body)
		return false, fmt.Errorf("HTTP状态码: %d, 响应: %s", resp.StatusCode, string(bodyBytes))
	}

	// 解析响应，检查是否返回有效 JSON
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("解析响应失败: %v", err)
	}

	if choices, ok := result["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if message, ok := choice["message"].(map[string]interface{}); ok {
				if content, ok := message["content"].(string); ok {
					// 尝试解析返回的内容是否为有效 JSON
					var jsonContent interface{}
					if err := json.Unmarshal([]byte(content), &jsonContent); err != nil {
						return false, fmt.Errorf("返回内容不是有效JSON: %v", err)
					}
					return true, nil
				}
			}
		}
	}

	return false, fmt.Errorf("无法从响应中提取内容")
}

// inferContextWindow 根据模型名称推断上下文窗口大小

func inferContextWindow(model string) int {
	modelLower := strings.ToLower(model)

	if strings.Contains(modelLower, "gpt-4-turbo") || strings.Contains(modelLower, "gpt-4o") {
		return 128000
	} else if strings.Contains(modelLower, "gpt-4-32k") {
		return 32768
	} else if strings.Contains(modelLower, "gpt-4") {
		return 8192
	} else if strings.Contains(modelLower, "gpt-3.5-turbo-16k") {
		return 16384
	} else if strings.Contains(modelLower, "gpt-3.5") {
		return 4096
	} else if strings.Contains(modelLower, "claude-3") || strings.Contains(modelLower, "claude-sonnet") || strings.Contains(modelLower, "claude-opus") {
		return 200000
	} else if strings.Contains(modelLower, "claude-2") {
		return 100000
	} else if strings.Contains(modelLower, "claude-instant") {
		return 100000
	} else if strings.Contains(modelLower, "qwen") {
		// Qwen 系列上下文窗口
		if strings.Contains(modelLower, "32b") || strings.Contains(modelLower, "30b") {
			return 32768
		} else if strings.Contains(modelLower, "72b") || strings.Contains(modelLower, "70b") {
			return 32768
		} else if strings.Contains(modelLower, "7b") || strings.Contains(modelLower, "14b") {
			return 32768
		}
		return 32768
	}

	return 4096
}

// inferThinkingSupport 根据模型名称推断是否支持 Extended Thinking

func inferThinkingSupport(model string) bool {
	modelLower := strings.ToLower(model)
	return strings.Contains(modelLower, "claude-3.5") ||
		strings.Contains(modelLower, "claude-sonnet-3.5") ||
		strings.Contains(modelLower, "o1") ||
		strings.Contains(modelLower, "deepseek-reasoner")
}

// truncateHistoryForContext 根据上下文窗口大小截断对话历史

func truncateHistoryForContext(history []map[string]interface{}, maxTokens int) []map[string]interface{} {
	if len(history) <= 1 {
		return history
	}

	// 估算每个消息的平均token数（粗略估计：1 token ≈ 4 字符）
	// 保留最近的消息，删除最早的消息
	maxChars := maxTokens * 4
	totalChars := 0

	// 从后向前计算
	result := make([]map[string]interface{}, 0, len(history))
	for i := len(history) - 1; i >= 0; i-- {
		msg := history[i]
		content, _ := msg["content"].(string)
		msgChars := len(content) + 50 // 额外50字符用于role等元数据

		if totalChars+msgChars > maxChars {
			break
		}

		result = append([]map[string]interface{}{msg}, result...)
		totalChars += msgChars
	}

	// 至少保留最后一条消息
	if len(result) == 0 && len(history) > 0 {
		result = append(result, history[len(history)-1])
	}

	return result
}

// callAIWithCapabilities 根据模型能力自适应调用AI服务

func callAIWithCapabilities(config *AIConfig, capabilities *AICapabilities, prompt string, useStreaming bool) (string, error) {
	// 如果支持流式输出且请求流式，使用流式调用
	if capabilities.SupportsStreaming && useStreaming {
		return callAIService(config, prompt) // 暂时使用非流式，后续可扩展
	}

	// 降级到普通调用
	return callAIService(config, prompt)
}

// extractCodeFromAIResponse 从 AI 返回中提取代码（去掉 ```js 等包裹）

func extractCodeFromAIResponse(s string) string {
	s = cleanAIResponse(s)
	if idx := strings.Index(s, "function "); idx >= 0 {
		return strings.TrimSpace(s[idx:])
	}
	if idx := strings.Index(s, "const "); idx >= 0 {
		return strings.TrimSpace(s[idx:])
	}
	return strings.TrimSpace(s)
}

// handleAICodegen 处理数据治理入库代码 AI 生成（使用与 AI 助手相同的 api url / api_key / model）

func handleAICodegen(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	username, authOK := getDataOntologyUserFromRequest(r)
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
			"message": "只支持 POST",
		})
		return
	}
	var req AICodegenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请求格式错误",
		})
		return
	}
	if req.DatabaseID != "" {
		dataOntologyMu.RLock()
		dc, ok := dataOntologyDatabases[req.DatabaseID]
		dataOntologyMu.RUnlock()
		if !ok || !dataOntologyResourceVisible(dc.Owner, username) {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": "数据库不存在",
			})
			return
		}
	}
	aiConfig := dataOntologyAIConfig
	if aiConfig == nil || aiConfig.URL == "" || aiConfig.APIKey == "" || aiConfig.Model == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "请先在 AI 助手中配置 AI 设置（URL、API Key、模型）",
		})
		return
	}

	// 构建 prompt：与前端模板一致的约定（gov.*、INPUT_FILE/INPUT_TEXT、XLSX、Papa、mammoth）
	var colLines []string
	for _, c := range req.Columns {
		colLines = append(colLines, fmt.Sprintf("  - 列 %s (%s) ← 源数据第 %d 列(0-based)", c.Name, c.Type, c.SourceIndex))
	}
	sourceDesc := map[string]string{
		"excel":    "Excel 文件 (.xlsx)，使用 INPUT_FILE，gov.readExcel(INPUT_FILE) 与 XLSX.utils.sheet_to_json",
		"csv_file": "CSV 文件，使用 INPUT_FILE.text() 与 Papa.parse",
		"csv_text": "CSV 文本，使用 INPUT_TEXT 与 Papa.parse(INPUT_TEXT)",
	}[req.SourceType]
	if sourceDesc == "" {
		sourceDesc = "Excel 文件"
	}

	prompt := fmt.Sprintf(`你是一个数据治理任务代码生成器。请根据以下配置生成一段可运行的 JavaScript 代码，用于将数据导入到数据库。要求：
1. 使用环境提供的全局对象：gov（含 gov.log、gov.readExcel、gov.readCSV、gov.querySQL、gov.executeSQL）、INPUT_FILE（文件上传时）、INPUT_TEXT（文本输入时）、XLSX、Papa、mammoth。
2. 数据库类型为 %s，表名为 %s（注意引号：MySQL/MariaDB 用反引号，其他可用双引号）。
3. 数据源：%s。
4. 列映射（目标表列 ← 源数据行数组索引 0-based）：
%s
5. 只输出可执行的 JavaScript 代码，不要用 markdown 代码块包裹，不要解释。代码应解析数据后逐行 INSERT，并统计成功/失败行数、用 gov.log 输出。`,
		req.DBType, req.TableName, sourceDesc, strings.Join(colLines, "\n"))
	if req.UserHint != "" {
		prompt += "\n6. 用户补充说明：" + req.UserHint
	}

	aiResponse, err := callAIService(aiConfig, prompt)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "AI 调用失败: " + err.Error(),
		})
		return
	}
	code := extractCodeFromAIResponse(aiResponse)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"code":    code,
	})
}

// AICompletionRequest 通用 AI 文本补全请求（与 AI 助手共用 url/api_key/model）

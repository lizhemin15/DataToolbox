     1|package main
     2|
     3|import (
     4|	"bytes"
     5|	"encoding/json"
     6|	"errors"
     7|	"fmt"
     8|	"io"
     9|	"io/ioutil"
    10|	"log"
    11|	"net/http"
    12|	"os"
    13|	"regexp"
    14|	"sort"
    15|	"strings"
    16|	"sync"
    17|	"time"
    18|	_ "gitee.com/chunanyong/dm"
    19|)
    20|
    21|func handleSmallModelRun(w http.ResponseWriter, r *http.Request, modelID string) {
    22|	if r.Method != http.MethodPost {
    23|		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
    24|		return
    25|	}
    26|
    27|	dataOntologyMu.RLock()
    28|	model, exists := smallModels[modelID]
    29|	if !exists {
    30|		dataOntologyMu.RUnlock()
    31|		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "模型不存在"})
    32|		return
    33|	}
    34|	dbID := model.DatabaseID
    35|	dbType := ""
    36|	if db, ok := dataOntologyDatabases[dbID]; ok {
    37|		dbType = db.Type
    38|	}
    39|	code := model.JsCode
    40|	dataOntologyMu.RUnlock()
    41|
    42|	// 解析输入参数
    43|	var req struct {
    44|		InputText string `json:"input_text"`
    45|		InputFile string `json:"input_file"` // base64
    46|		FileName  string `json:"file_name"`
    47|	}
    48|	json.NewDecoder(r.Body).Decode(&req)
    49|
    50|	// 准备任务参数
    51|	taskData := map[string]interface{}{
    52|		"code":        code,
    53|		"token":       "",
    54|		"database_id": dbID,
    55|		"db_type":     dbType,
    56|		"input_text":  req.InputText,
    57|		"file_base64": req.InputFile,
    58|		"file_name":   req.FileName,
    59|	}
    60|
    61|	// 执行
    62|	result := callGovRunner(taskData)
    63|	if !result.Success {
    64|		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": result.Error})
    65|		return
    66|	}
    67|
    68|	json.NewEncoder(w).Encode(map[string]interface{}{
    69|		"success": true,
    70|		"output":  result.Output,
    71|	})
    72|}
    73|
    74|// handleAIQuery 处理AI查询（流式响应）
    75|
    76|func handleAIQuery(w http.ResponseWriter, r *http.Request) {
    77|	// 设置流式响应头
    78|	w.Header().Set("Content-Type", "text/event-stream")
    79|	w.Header().Set("Cache-Control", "no-cache")
    80|	w.Header().Set("Connection", "keep-alive")
    81|	w.Header().Set("Access-Control-Allow-Origin", "*")
    82|
    83|	log.Printf("[handleTableData] path=%s, parts=%v, len=%d", r.URL.Path, strings.Split(r.URL.Path, "/"), len(strings.Split(r.URL.Path, "/")))
    84|	username, authOK := getDataOntologyUserFromRequest(r)
    85|	if !authOK {
    86|		sendSSE(w, "error", map[string]interface{}{
    87|			"message": "未授权",
    88|		})
    89|		return
    90|	}
    91|
    92|	if r.Method != http.MethodPost {
    93|		sendSSE(w, "error", map[string]interface{}{
    94|			"message": "只支持POST请求",
    95|		})
    96|		return
    97|	}
    98|
    99|	// 确保支持流式传输
   100|	flusher, ok := w.(http.Flusher)
   101|	if !ok {
   102|		sendSSE(w, "error", map[string]interface{}{
   103|			"message": "不支持流式传输",
   104|		})
   105|		return
   106|	}
   107|
   108|	// 解析请求
   109|	var queryReq AIQueryRequest
   110|	if err := json.NewDecoder(r.Body).Decode(&queryReq); err != nil {
   111|		sendSSE(w, "error", map[string]interface{}{
   112|			"message": "请求格式错误",
   113|		})
   114|		return
   115|	}
   116|
   117|	// 直接走集群模式（不再有 mode 分支，极速模式代码保留但不再走）
   118|	log.Printf("[handleAIQuery] → routing to cluster mode (default)")
   119|	handleAgentClusterQueryWithReq(w, r, flusher, &queryReq, username)
   120|	return
   121|
   122|	// === 极速模式（默认） ===
   123|	// 发送开始事件
   124|	sendSSE(w, "start", map[string]interface{}{
   125|		"message": "开始处理您的问题...",
   126|	})
   127|	flusher.Flush()
   128|
   129|	// 检查AI配置
   130|	dataOntologyMu.RLock()
   131|	aiConfig := dataOntologyAIConfig
   132|	aiCapabilities := dataOntologyAICapabilities
   133|	dataOntologyMu.RUnlock()
   134|
   135|	if aiConfig == nil {
   136|		sendSSE(w, "error", map[string]interface{}{
   137|			"message": "请先配置AI设置",
   138|		})
   139|		return
   140|	}
   141|
   142|	// 如果能力未检测，进行检测
   143|	if aiCapabilities == nil {
   144|		var err error
   145|		aiCapabilities, err = detectAICapabilities(aiConfig)
   146|		if err != nil {
   147|			log.Printf("检测AI能力失败: %v", err)
   148|			// 使用默认能力继续
   149|			aiCapabilities = &AICapabilities{
   150|				SupportsFunctionCall: false,
   151|				SupportsThinking:     false,
   152|				SupportsStreaming:    true,
   153|				ContextWindow:        4096,
   154|				SupportsJSONMode:     false,
   155|			}
   156|		}
   157|	}
   158|
   159|	// 发送读取表结构事件
   160|	sendSSE(w, "thinking", map[string]interface{}{
   161|		"message": "正在读取数据库表结构信息...",
   162|	})
   163|	flusher.Flush()
   164|
   165|	// 如果没有指定数据库，返回数据库选择卡片
   166|	if len(queryReq.Databases) == 0 {
   167|		// 获取用户可访问的数据库列表
   168|		dataOntologyMu.RLock()
   169|		var availableDBs []map[string]interface{}
   170|		for id, db := range dataOntologyDatabases {
   171|			if dataOntologyResourceVisible(db.Owner, username) {
   172|				availableDBs = append(availableDBs, map[string]interface{}{
   173|					"id":   id,
   174|					"name": db.Name,
   175|					"type": db.Type,
   176|				})
   177|			}
   178|		}
   179|		dataOntologyMu.RUnlock()
   180|
   181|		if len(availableDBs) == 0 {
   182|			sendSSE(w, "error", map[string]interface{}{
   183|				"message": "没有可用的数据库，请先添加数据库配置",
   184|			})
   185|			sendSSE(w, "done", map[string]interface{}{})
   186|			flusher.Flush()
   187|			return
   188|		}
   189|
   190|		// 返回数据库选择卡片
   191|		sendSSE(w, "database_selection_required", map[string]interface{}{
   192|			"message":    "请选择要操作的数据库",
   193|			"databases":  availableDBs,
   194|			"user_query": queryReq.Message,
   195|		})
   196|		sendSSE(w, "done", map[string]interface{}{})
   197|		flusher.Flush()
   198|		return
   199|	}
   200|
   201|	// 获取数据库配置和表结构（含字段信息）
   202|	dataOntologyMu.RLock()
   203|	var dbSchemas []map[string]interface{}
   204|	for _, dbID := range queryReq.Databases {
   205|		dbConfig, exists := dataOntologyDatabases[dbID]
   206|		if !exists || !dataOntologyResourceVisible(dbConfig.Owner, username) {
   207|			continue
   208|		}
   209|
   210|		tables, err := getTablesList(dbConfig)
   211|		if err != nil {
   212|			log.Printf("获取数据库 %s 表列表失败: %v", dbConfig.Name, err)
   213|			continue
   214|		}
   215|
   216|		// 使用表检索逻辑筛选相关表
   217|		var tablesWithColumns []map[string]interface{}
   218|		defaultMaxTables := 15
   219|
   220|		retrievalConfig := aiConfig.TableRetrieval
   221|		relevantTables, err := retrieveRelevantTables(queryReq.Message, dbConfig, retrievalConfig)
   222|		if err != nil {
   223|			log.Printf("表检索失败: %v, 使用前 %d 张表", err, defaultMaxTables)
   224|			// 降级：截取前 N 张表
   225|			if len(tables) > defaultMaxTables {
   226|				tables = tables[:defaultMaxTables]
   227|			}
   228|			for _, tableName := range tables {
   229|				columns, err := getTableColumns(dbConfig, tableName)
   230|				if err != nil {
   231|					log.Printf("获取表 %s 字段失败: %v", tableName, err)
   232|					tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
   233|						"name":    tableName,
   234|						"columns": []map[string]interface{}{},
   235|					})
   236|					continue
   237|				}
   238|				tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
   239|					"name":    tableName,
   240|					"columns": columns,
   241|				})
   242|			}
   243|		} else {
   244|			// 使用检索结果
   245|			if len(relevantTables) == 0 {
   246|				// 检索结果为空，降级使用所有表
   247|				log.Printf("[表检索] 未检索到相关表，降级使用前 %d 张表", defaultMaxTables)
   248|				if len(tables) > defaultMaxTables {
   249|					tables = tables[:defaultMaxTables]
   250|				}
   251|				for _, tableName := range tables {
   252|					columns, err := getTableColumns(dbConfig, tableName)
   253|					if err != nil {
   254|						log.Printf("获取表 %s 字段失败: %v", tableName, err)
   255|						tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
   256|							"name":    tableName,
   257|							"columns": []map[string]interface{}{},
   258|						})
   259|						continue
   260|					}
   261|					tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
   262|						"name":    tableName,
   263|						"columns": columns,
   264|					})
   265|				}
   266|			} else {
   267|				log.Printf("[表检索] 检索到 %d 张相关表", len(relevantTables))
   268|				for _, result := range relevantTables {
   269|					tableName := result.TableName
   270|					columns, err := getTableColumns(dbConfig, tableName)
   271|					if err != nil {
   272|						log.Printf("获取表 %s 字段失败: %v", tableName, err)
   273|						tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
   274|							"name":    tableName,
   275|							"columns": []map[string]interface{}{},
   276|						})
   277|						continue
   278|					}
   279|					tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
   280|						"name":    tableName,
   281|						"columns": columns,
   282|					})
   283|				}
   284|			}
   285|		}
   286|
   287|		// 获取本体关系
   288|		var relations []OntologyRelation
   289|		if dbConfig.Relations != nil {
   290|			for _, rel := range dbConfig.Relations {
   291|				relations = append(relations, rel)
   292|			}
   293|		}
   294|
   295|		dbSchemas = append(dbSchemas, map[string]interface{}{
   296|			"name":      dbConfig.Name,
   297|			"type":      dbConfig.Type,
   298|			"tables":    tablesWithColumns,
   299|			"relations": relations,
   300|			"id":        dbID,
   301|		})
   302|	}
   303|	dataOntologyMu.RUnlock()
   304|
   305|	if len(dbSchemas) == 0 {
   306|		sendSSE(w, "error", map[string]interface{}{
   307|			"message": "未找到有效的数据库",
   308|		})
   309|		return
   310|	}
   311|
   312|	// 根据模块上下文路由
   313|	moduleSet := make(map[string]bool)
   314|	for _, m := range queryReq.Modules {
   315|		moduleSet[m] = true
   316|	}
   317|
   318|	// 如果没有明确指定模块，进行意图检测
   319|	if len(moduleSet) == 0 {
   320|		intent := detectUserIntent(queryReq.Message)
   321|		log.Printf("[AI Query] 关键词意图检测: module=%s, confidence=%.2f, reason=%s", intent.DetectedModule, intent.Confidence, intent.Reason)
   322|
   323|		// 关键词置信度足够高，直接路由
   324|		if intent.Confidence >= 0.7 && intent.DetectedModule != "" {
   325|			moduleSet[intent.DetectedModule] = true
   326|			sendSSE(w, "thinking", map[string]interface{}{
   327|				"message": fmt.Sprintf("检测到意图: %s，正在处理...", intent.Reason),
   328|			})
   329|			flusher.Flush()
   330|		} else {
   331|			// 关键词置信度不足，调用 AI 进行意图分类
   332|			sendSSE(w, "thinking", map[string]interface{}{
   333|				"message": "正在分析您的意图...",
   334|			})
   335|			flusher.Flush()
   336|
   337|			aiIntent := detectIntentWithAI(aiConfig, aiCapabilities, queryReq.Message)
   338|			log.Printf("[AI Query] AI 意图分类: module=%s, confidence=%.2f, reason=%s", aiIntent.DetectedModule, aiIntent.Confidence, aiIntent.Reason)
   339|
   340|			// 合并：取置信度更高的结果
   341|			finalIntent := intent
   342|			if aiIntent.Confidence > intent.Confidence && aiIntent.DetectedModule != "" {
   343|				finalIntent = aiIntent
   344|			}
   345|
   346|			// 如果最终置信度 >= 0.7，自动路由
   347|			if finalIntent.Confidence >= 0.7 && finalIntent.DetectedModule != "" {
   348|				moduleSet[finalIntent.DetectedModule] = true
   349|				sendSSE(w, "thinking", map[string]interface{}{
   350|					"message": fmt.Sprintf("识别意图: %s，正在处理...", finalIntent.Reason),
   351|				})
   352|				flusher.Flush()
   353|			} else {
   354|				// AI 也不确定，返回意图选择卡片
   355|				intentOptions := []map[string]interface{}{
   356|					{"id": "db-manage", "name": "通用提问", "description": "查询数据、统计信息、了解表结构等", "icon": "💬"},
   357|					{"id": "api-dispatch", "name": "接口制作", "description": "创建 API 接口、生成数据服务", "icon": "🔌"},
   358|					{"id": "data-governance", "name": "数据治理", "description": "创建定时任务、数据导入导出", "icon": "⚙️"},
   359|					{"id": "quality-audit", "name": "质量审计", "description": "数据质量检查、校验规则", "icon": "✅"},
   360|					{"id": "ontology", "name": "本体查询", "description": "概念关系、语义分析", "icon": "🧠"},
   361|					{"id": "small-model", "name": "小模型", "description": "小模型相关、本地模型、离线推理", "icon": "🤖"},
   362|				}
   363|
   364|				sendSSE(w, "intent_selection_required", map[string]interface{}{
   365|					"message":    "我不太确定您想要做什么，请选择一个操作类型：",
   366|					"intents":    intentOptions,
   367|					"user_query": queryReq.Message,
   368|					"detected":   finalIntent,
   369|				})
   370|				sendSSE(w, "done", map[string]interface{}{})
   371|				flusher.Flush()
   372|				return
   373|			}
   374|		}
   375|	}
   376|
   377|	if moduleSet["api-dispatch"] {
   378|		handleAICreateApi(w, flusher, &queryReq, dbSchemas, aiConfig, aiCapabilities)
   379|		return
   380|	}
   381|
   382|	if moduleSet["data-governance"] {
   383|		handleAIGovernanceTask(w, flusher, &queryReq, dbSchemas, aiConfig)
   384|		return
   385|	}
   386|
   387|	if moduleSet["quality-audit"] {
   388|		handleAIQualityRule(w, flusher, &queryReq, dbSchemas, aiConfig)
   389|		return
   390|	}
   391|
   392|	if moduleSet["small-model"] {
   393|		handleAISmallModel(w, flusher, &queryReq, dbSchemas, aiConfig)
   394|		return
   395|	}
   396|
   397|	if moduleSet["ontology"] {
   398|		handleAIOntologyQuery(w, flusher, &queryReq, dbSchemas, aiConfig)
   399|		return
   400|	}
   401|
   402|	// 最多重试3次
   403|	maxRetries := 3
   404|	var lastError string
   405|	var lastSQL string
   406|	var attempts []map[string]interface{}
   407|	var normalizedSQLs []string
   408|
   409|	for retry := 0; retry < maxRetries; retry++ {
   410|		// 发送生成SQL事件
   411|		if retry == 0 {
   412|			sendSSE(w, "thinking", map[string]interface{}{
   413|				"message": "正在分析您的问题并生成SQL...",
   414|				"attempt": retry + 1,
   415|			})
   416|		} else {
   417|			sendSSE(w, "retry", map[string]interface{}{
   418|				"message": fmt.Sprintf("第%d次重试，正在根据错误调整SQL...", retry+1),
   419|				"attempt": retry + 1,
   420|				"error":   lastError,
   421|			})
   422|		}
   423|		flusher.Flush()
   424|
   425|		// 根据上下文窗口大小截断历史
   426|		if aiCapabilities != nil && aiCapabilities.ContextWindow > 0 {
   427|			// 为当前prompt和响应预留一半的上下文空间
   428|			maxHistoryTokens := aiCapabilities.ContextWindow / 2
   429|			queryReq.History = truncateHistoryForContext(queryReq.History, maxHistoryTokens)
   430|		}
   431|		// 构建AI提示词（如果是重试，添加错误信息）
   432|		var prompt string
   433|		if retry == 0 {
   434|			prompt = buildAIPrompt(queryReq.Message, dbSchemas, queryReq.Modules)
   435|		} else {
   436|			prompt = buildRetryPrompt(queryReq.Message, dbSchemas, lastError, attempts, queryReq.Modules)
   437|		}
   438|
   439|		// 调用AI服务生成SQL
   440|		aiResponse, err := callAIServiceWithCapabilities(aiConfig, aiCapabilities, prompt)
   441|		log.Printf("[AI Query] AI响应: %q, 错误: %v", aiResponse, err)
   442|		if err != nil {
   443|			lastError = "AI服务调用失败: " + err.Error()
   444|			attempts = append(attempts, map[string]interface{}{
   445|				"attempt":  retry + 1,
   446|				"error":    lastError,
   447|				"response": "",
   448|				"sql":      "",
   449|			})
   450|			sendSSE(w, "attempt_failed", map[string]interface{}{
   451|				"attempt": retry + 1,
   452|				"error":   lastError,
   453|			})
   454|			flusher.Flush()
   455|			continue
   456|		}
   457|
   458|		// 解析AI返回的SQL和回复文本
   459|		aiResponse = cleanAIResponse(aiResponse)
   460|		sqlQuery, targetDBID, responseText := parseAIResponse(aiResponse, dbSchemas)
   461|		if sqlQuery == "" {
   462|			lastError = "AI未能生成有效的SQL查询"
   463|			attempts = append(attempts, map[string]interface{}{
   464|				"attempt":  retry + 1,
   465|				"error":    lastError,
   466|				"response": aiResponse,
   467|				"sql":      "",
   468|			})
   469|			sendSSE(w, "attempt_failed", map[string]interface{}{
   470|				"attempt": retry + 1,
   471|				"error":   lastError,
   472|			})
   473|			flusher.Flush()
   474|			continue
   475|		}
   476|
   477|		// 检测是否生成了已执行失败过的相同 SQL
   478|		normalizedSQL := strings.ReplaceAll(strings.ReplaceAll(sqlQuery, " ", ""), "\n", "")
   479|		dup := false
   480|		for _, prev := range normalizedSQLs {
   481|			if normalizedSQL == prev {
   482|				dup = true
   483|				break
   484|			}
   485|		}
   486|		if dup {
   487|			lastError = "AI重复生成已尝试过的SQL，无法修复问题"
   488|			attempts = append(attempts, map[string]interface{}{
   489|				"attempt":  retry + 1,
   490|				"error":    lastError,
   491|				"response": responseText,
   492|				"sql":      sqlQuery,
   493|			})
   494|			sendSSE(w, "attempt_failed", map[string]interface{}{
   495|				"attempt": retry + 1,
   496|				"error":   lastError,
   497|				"sql":     sqlQuery,
   498|			})
   499|			flusher.Flush()
   500|			break
   501// cleanAIResponse 清洗模型输出，去掉 think、代码块和多余空白

func cleanAIResponse(response string) string {
	response = strings.TrimSpace(response)
	response = strings.ReplaceAll(response, "\r\n", "\n")
	response = strings.ReplaceAll(response, "\r", "\n")

	// 处理 <think> 标签：删除标签及其内容，保留标签外的内容
	for strings.Contains(response, "<think>") {
		start := strings.Index(response, "<think>")
		end := strings.Index(response[start:], "</think>")
		if end < 0 {
			// 没有 </think>，删除从 <think> 开始的所有内容
			response = response[:start]
			break
		}
		end += start + len("</think>")
		response = response[:start] + response[end:]
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

|
# DataToolbox AI 助手完整架构文档

## 1. 完整实现的功能清单

### 1.1 数据库查询功能
**实现路径**: 自然语言 → SQL 生成 → 执行 → 结果展示

**核心流程**:
1. 用户输入自然语言查询（如"查询所有活跃用户"）
2. AI 根据数据库 schema 和表结构生成 SQL
3. 系统自动执行 SQL 并返回结果
4. 结果以表格形式展示（最多显示 10 条，支持滚动）

**关键代码位置**:
- 后端: `server.go:6885` - `handleAIQuery` 函数
- 前端: `script.js:5118` - `handleSendAiMessage` 函数

**特色功能**:
- 支持多数据库上下文（通过 @数据库 切换）
- 自动获取表结构信息（字段名、类型）
- 结果自动格式化为 HTML 表格
- 支持空结果集友好提示

### 1.2 接口创建功能
**实现路径**: 自然语言 → API 配置生成 → SQL 校验 → 确认创建

**核心流程**:
1. 用户描述需求（如"创建一个查询用户列表的接口"）
2. AI 生成完整的 API 配置（名称、路径、方法、SQL、描述、默认参数）
3. 系统进行 SQL 硬性校验（验证表名和字段名真实存在）
4. 从数据库表中查询实际值填充 `default_params`
5. 用户确认后创建接口，可直接调用

**关键代码位置**:
- 后端: `server.go:9239` - `handleAICreateApi` 函数
- 前端: `script.js:5895` - `api_config_generated` 事件处理

**特色功能**:
- **SQL 硬性校验**: 验证生成的 SQL 中的表名和字段名在数据库中真实存在
- **default_params 自动填充**: 从实际表中查询真实数据作为默认参数值
- **智能参数推断**: 根据字段类型自动推断合理的默认值
- **RESTful 规范**: 自动生成符合 RESTful 风格的接口路径

**SQL 校验机制** (`server.go:9334`):
```go
valid, validationError := validateSQLTablesAndFields(sqlStr, dbSchemas)
if !valid {
    sendSSE(w, "sql_validation_error", map[string]interface{}{
        "message":  "SQL校验失败: " + validationError,
        "sql":      sqlStr,
        "response": aiResponse,
    })
    return
}
```

**default_params 自动填充机制** (`server.go:9963`):
```go
// 从数据库表中查询实际值填充 default_params
if len(dbSchemas) > 0 {
    dbID, _ := dbSchemas[0]["id"].(string)
    populateDefaultParamsFromDB(apiConfig, dbID)
}
```

**填充逻辑**:
1. 从 SQL 中提取表名（支持 FROM、JOIN 子句）
2. 识别参数对应的表和字段
3. 从表中查询实际值（SELECT field FROM table LIMIT 1）
4. 跳过 LIMIT/OFFSET/ORDER BY/GROUP BY 等非条件参数
5. 保留无法匹配的参数的默认值

### 1.3 数据治理任务草稿生成
**实现路径**: 自然语言 → 治理任务配置生成 → 用户确认

**核心流程**:
1. 用户描述治理需求（如"创建一个每日数据清洗任务"）
2. AI 生成治理任务配置（名称、类型、Cron 表达式、JS 脚本、输入类型等）
3. 用户可编辑草稿或直接确认创建

**关键代码位置**:
- 后端: `server.go:9058` - `handleAIGovernanceTask` 函数
- 前端: `script.js:5968` - `governance_task_draft` 事件处理

**支持的任务类型**:
- **定时任务**: 需要设置 Cron 表达式
- **交互任务**: 需要设置输入类型（文件/文本/两者）和允许的文件扩展名

### 1.4 质量规则草稿生成
**实现路径**: 自然语言 → 质量规则配置生成 → 用户确认

**核心流程**:
1. 用户描述质量检查需求（如"检查用户表中是否有重复邮箱"）
2. AI 生成质量规则配置（编号、序号、名称、分类、SQL）
3. 用户确认后保存规则

**关键代码位置**:
- 后端: `server.go:9108` - `handleAIQualityRule` 函数
- 前端: `script.js:6016` - `quality_rule_draft` 事件处理

### 1.5 写入操作确认机制
**实现目的**: 防止误执行 DELETE、UPDATE、INSERT 等写操作

**核心流程**:
1. 系统检测 SQL 是否为写操作（通过关键词检测）
2. 如果是写操作，发送 `confirm_write` 事件
3. 前端显示确认对话框，包含待执行的 SQL
4. 用户点击"执行"或"取消"按钮
5. 确认后才真正执行 SQL

**关键代码位置**:
- 后端: `server.go:7198` - 写操作检测
- 前端: `script.js:5751` - `confirm_write` 事件处理

**写操作检测逻辑**:
```go
if isWriteOperation(sqlQuery) {
    sendSSE(w, "confirm_write", map[string]interface{}{
        "response": responseText,
        "sql":      sqlQuery,
        "dbId":     targetDBID,
        "attempts": attempts,
        "retries":  retry,
    })
    return
}
```

### 1.6 重试机制
**实现目的**: SQL 执行失败时自动重试，根据错误信息调整 SQL

**核心流程**:
1. 最多重试 3 次
2. 每次失败后，将错误信息反馈给 AI
3. AI 根据错误调整 SQL（如修正语法、更换函数、简化查询）
4. 检测重复 SQL，避免无限循环
5. 显示所有尝试记录，方便用户排查

**关键代码位置**:
- 后端: `server.go:7074` - 重试循环
- 前端: `script.js:5704` - `retry` 事件处理

**重试策略**:
- **错误分类**: 区分权限错误、超时错误、语法错误
- **权限错误**: 直接终止，不重试（需要 DBA 授权）
- **超时错误**: 提示简化查询（限制行数、减少关联、避免 SELECT *）
- **语法错误**: AI 自动修正

**重复 SQL 检测**:
```go
normalizedSQL := strings.ReplaceAll(strings.ReplaceAll(sqlQuery, " ", ""), "\n", "")
for _, prev := range normalizedSQLs {
    if normalizedSQL == prev {
        lastError = "AI重复生成已尝试过的SQL，无法修复问题"
        break
    }
}
```

### 1.7 AI 反思机制
**实现目的**: 评估 AI 生成的 SQL 是否真正回答了用户问题

**核心流程**:
1. SQL 执行成功后，将结果摘要发送给 AI
2. AI 分析结果是否回答了用户问题
3. 如果未回答，提供改进建议
4. 显示置信度和洞察信息

**关键代码位置**:
- 后端: `server.go:7289` - 反思调用
- 前端: `script.js:5751` - 反思结果展示

**反思提示词结构**:
```go
reflectionPrompt := buildReflectionPrompt(queryReq.Message, sqlQuery, resultsSummary, dbConfig.Type)
reflectionResponse, refErr := callAIServiceWithCapabilities(aiConfig, aiCapabilities, reflectionPrompt)
reflection := parseReflectionResponse(reflectionResponse)
```

**反思结果字段**:
- `answers_question`: 布尔值，是否回答了问题
- `confidence`: 置信度（0-1）
- `insight`: 洞察信息（展示给用户）
- `suggestion`: 改进建议（用于重试）

### 1.8 本体关系信息注入
**实现目的**: 帮助 AI 理解表间字段关联，生成更准确的 SQL

**核心流程**:
1. 从数据库配置中读取本体关系（`dbConfig.Relations`）
2. 将关系信息注入到 AI 提示词中
3. AI 根据关系信息推断 JOIN 条件

**关键代码位置**:
- 后端: `server.go:7006` - 获取本体关系
- 前端: `script.js:10363` - 本体关系管理界面

**本体关系结构**:
```go
type OntologyRelation struct {
    ID          string `json:"id"`
    SourceTable string `json:"source_table"`
    SourceField string `json:"source_field"`
    TargetTable string `json:"target_table"`
    TargetField string `json:"target_field"`
    RelationType string `json:"relation_type"` // one_to_one, one_to_many, many_to_many
    Description string `json:"description"`
}
```

**注入到提示词**:
```go
dbSchemas = append(dbSchemas, map[string]interface{}{
    "name":      dbConfig.Name,
    "type":      dbConfig.Type,
    "tables":    tablesWithColumns,
    "relations": relations, // 注入本体关系
    "id":        dbID,
})
```

---

## 2. 技术架构

### 2.1 前端架构

#### 2.1.1 aiModules - AI 模块定义
**位置**: `script.js:60`

```javascript
const aiModules = [
    { id: 'db-manage', name: '数据库管理', icon: '🗄️', description: '管理数据库连接与表结构' },
    { id: 'api-dispatch', name: '接口分发', icon: '🔌', description: '统一分发和调用数据接口' },
    { id: 'data-governance', name: '数据治理', icon: '🧽', description: '治理规则、质量与权限管理' },
    { id: 'ontology', name: '本体论抽象', icon: '📐', description: '从数据中抽象业务本体' },
];
```

**作用**: 定义 AI 助手可用的功能模块，用户通过 @模块名 切换上下文。

#### 2.1.2 aiSessionContext - 会话上下文
**位置**: `script.js:67`

```javascript
let aiSessionContext = {
    databases: [],  // 当前上下文的数据库列表
    modules: [],    // 当前上下文的模块列表
    history: []     // 对话历史（最近 5 条）
}
```

**作用**: 维护 AI 会话的上下文信息，实现多轮对话和上下文切换。

#### 2.1.3 handleSendAiMessage - 发送消息主流程
**位置**: `script.js:5118`

**核心逻辑**:
1. 提取消息中的 @ 引用（数据库和模块）
2. 更新会话上下文（`aiSessionContext`）
3. 记录用户消息到历史
4. 发送 POST 请求到 `/api/data-ontology/ai/query`
5. 使用 SSE 流式读取响应
6. 调用 `handleStreamEvent` 处理每个事件

**关键代码片段**:
```javascript
// 提取 @ 引用
const allMatches = [...message.matchAll(/@([^\s]+)/g)];
const dbReferences = [];
const moduleReferences = [];

for (const match of allMatches) {
    const refName = match[1];
    const mod = aiModules.find(m => m.name === refName);
    if (mod) {
        moduleReferences.push(mod);
        continue;
    }
    const db = databases.find(d => d.name === refName);
    if (db) {
        dbReferences.push(db);
    }
}

// 更新上下文
aiSessionContext.modules = moduleReferences;
aiSessionContext.databases = dbReferences;
```

#### 2.1.4 handleStreamEvent - SSE 事件处理
**位置**: `script.js:5671`

**支持的事件类型**:
- `start`: 开始处理
- `thinking`: AI 思考中
- `retry`: 重试中
- `sql_generated`: SQL 生成完成
- `executing`: 执行 SQL
- `attempt_failed`: 尝试失败
- `success`: 成功（包含结果）
- `confirm_write`: 写操作确认
- `error`: 错误
- `api_config_generated`: API 配置生成完成
- `governance_task_draft`: 治理任务草稿生成
- `quality_rule_draft`: 质量规则草稿生成
- `small_model_draft`: 小模型草稿生成
- `answer`: 直接回答（本体论查询）
- `done`: 处理完成

**事件处理示例**:
```javascript
case 'success':
    statusEl.innerHTML = '';

    let resultHtml = `<div style="margin-bottom: 6px;">${formatAIText(data.response)}</div>`;

    // 显示反思洞察
    if (data.insight != null && String(data.insight).trim() !== '') {
        resultHtml += `
            <div class="ai-reflection-insight">
                <div>AI 反思结果</div>
                <div>${formatAIText(data.insight)}</div>
                <div>置信度: ${Math.round(data.confidence * 100)}%</div>
            </div>`;
    }

    // 显示 SQL
    resultHtml += `<div class="ai-sql-block">${escapeHtml(data.sql)}</div>`;

    // 显示结果表格
    if (data.results && data.results.length > 0) {
        resultHtml += `
            <div class="ai-result-table">
                <table>
                    <thead><tr>${Object.keys(data.results[0]).map(col => `<th>${escapeHtml(col)}</th>`).join('')}</tr></thead>
                    <tbody>
                        ${data.results.slice(0, 10).map(row => `
                            <tr>${Object.keys(data.results[0]).map(col => `<td>${escapeHtml(String(row[col]))}</td>`).join('')}</tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`;
    }

    contentEl.innerHTML = resultHtml;
    finalizeAiProcess(messageId);
    break;
```

#### 2.1.5 finalizeAiProcess - 完成处理
**位置**: `script.js:5664`

**作用**: AI 处理完成后，显示折叠按钮，自动折叠时间线。

```javascript
function finalizeAiProcess(messageId) {
    const toggle = document.getElementById(`${messageId}-toggle`);
    if (toggle) toggle.style.display = 'inline-flex';
    setAiProcessCollapsed(messageId, true);
}
```

### 2.2 后端架构

#### 2.2.1 handleAIConfig - AI 配置管理
**位置**: `server.go:6492`

**功能**:
- GET: 获取当前 AI 配置
- POST: 保存 AI 配置并自动检测能力

**关键逻辑**:
```go
if r.Method == http.MethodPost {
    // 保存配置
    var config AIConfig
    if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
        apiBadRequest(w, "请求格式错误")
        return
    }

    // 检测AI模型能力
    capabilities, err := detectAICapabilities(&config)
    if err != nil {
        log.Printf("检测AI能力失败: %v", err)
    }

    // 保存配置和能力
    dataOntologyMu.Lock()
    dataOntologyAIConfig = &config
    dataOntologyAICapabilities = capabilities
    dataOntologyMu.Unlock()

    // 持久化
    saveDataOntologyStore()
}
```

#### 2.2.2 handleAICapabilities - 获取 AI 能力
**位置**: `server.go:6557`

**功能**: 返回已检测的 AI 模型能力（Function Call、Streaming、JSON Mode、Thinking、上下文窗口大小）。

#### 2.2.3 handleAIQuery - AI 查询主流程
**位置**: `server.go:6885`

**核心流程**:
1. 设置 SSE 响应头
2. 解析请求（消息、数据库列表、模块列表、历史）
3. 获取数据库配置和表结构（含字段信息）
4. 获取本体关系信息
5. 根据模块上下文路由到不同的处理器
6. 如果无模块，执行数据库查询流程（含重试、反思）

**模块路由逻辑**:
```go
moduleSet := make(map[string]bool)
for _, m := range queryReq.Modules {
    moduleSet[m] = true
}

if moduleSet["api-dispatch"] {
    handleAICreateApi(w, flusher, &queryReq, dbSchemas, aiConfig)
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

if moduleSet["ontology"] {
    handleAIOntologyQuery(w, flusher, &queryReq, dbSchemas, aiConfig)
    return
}
```

#### 2.2.4 detectAICapabilities - AI 能力检测
**位置**: `server.go:8083`

**检测方式**: 通过实际 API 调用测试

**检测项目**:
1. **基本连通性**: 发送简单请求测试连接
2. **Function Call**: 发送带工具定义的请求，检查是否返回 `tool_calls`
3. **Streaming**: 发送 `stream: true` 的请求，检查 Content-Type 是否为 `text/event-stream`
4. **JSON Mode**: 发送 `response_format: {type: "json_object"}` 的请求，检查是否返回有效 JSON
5. **Thinking**: 根据模型名称推断（Claude 3.5、o1、DeepSeek Reasoner）
6. **上下文窗口**: 根据模型名称推断（GPT-4 Turbo: 128K, Claude 3: 200K, Qwen: 32K）

**手动覆盖**:
用户可以手动设置能力，跳过自动检测：
```go
if config.EnableFunctionCall != nil {
    capabilities.SupportsFunctionCall = *config.EnableFunctionCall
}
if config.EnableStreaming != nil {
    capabilities.SupportsStreaming = *config.EnableStreaming
}
if config.ContextWindowOverride > 0 {
    capabilities.ContextWindow = config.ContextWindowOverride
}
```

#### 2.2.5 handleAICreateApi - AI 创建接口
**位置**: `server.go:9239`

**核心流程**:
1. 如果表结构未增强（只有表名），获取字段信息
2. 构建创建接口的提示词（包含真实的表名和字段名）
3. 调用 AI 服务生成配置
4. 解析 AI 返回的 JSON 配置
5. **SQL 硬性校验**: 验证表名和字段名真实存在
6. **default_params 自动填充**: 从表中查询实际值
7. 返回配置供用户确认

**SQL 校验函数** (`validateSQLTablesAndFields`):
- 提取 SQL 中的表名（FROM、JOIN 子句）
- 提取字段名（SELECT、WHERE、ORDER BY、GROUP BY 子句）
- 检查表名是否在 schema 中存在
- 检查字段名是否在对应表中存在
- 返回详细的错误信息（如"表 users 不存在"、"字段 email 在表 users 中不存在"）

**default_params 填充函数** (`populateDefaultParamsFromDB`):
```go
// 对每个参数，尝试从对应的表中查询实际值
for paramName, paramValue := range defaultParams {
    // 检查参数是否出现在非条件子句（LIMIT/OFFSET/ORDER BY/GROUP BY）中
    if isNonConditionParam(sqlStr, paramName) {
        log.Printf("参数 %s 出现在 LIMIT/OFFSET/ORDER BY/GROUP BY 等非条件位置，保留默认值: %v", paramName, paramValue)
        continue
    }

    // 查找参数对应的表和字段
    tableName, fieldName := findParamTableAndField(sqlStr, paramName, tableNames)

    // 从表中查询实际值
    actualValue, err := queryActualValueFromTable(dbConfig, tableName, fieldName)
    if err == nil && actualValue != nil {
        defaultParams[paramName] = actualValue
    }
}
```

### 2.3 SSE 流式通信机制

#### 2.3.1 后端 SSE 发送
**位置**: `server.go:6482`

```go
func sendSSE(w http.ResponseWriter, eventType string, data interface{}) {
    jsonData, _ := json.Marshal(data)
    fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventType, jsonData)
    if flusher, ok := w.(http.Flusher); ok {
        flusher.Flush()
    }
}
```

**SSE 格式**:
```
event: thinking
data: {"message":"正在分析您的问题并生成SQL..."}

event: sql_generated
data: {"attempt":1,"response":"已为您执行查询","sql":"SELECT * FROM users WHERE status = 'active'"}

event: success
data: {"response":"已为您执行查询","sql":"SELECT * FROM users WHERE status = 'active'","results":[...],"insight":"查询返回了所有活跃用户","confidence":0.95}
```

#### 2.3.2 前端 SSE 接收
**位置**: `script.js:5214`

```javascript
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
    const {done, value} = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, {stream: true});
    const chunks = buffer.split(/\n\n+/);
    buffer = chunks.pop() || '';

    for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        const eventLines = chunk.split('\n');
        let eventType = '';
        const dataLines = [];
        for (const line of eventLines) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (!eventType || dataLines.length === 0) continue;
        try {
            const data = JSON.parse(dataLines.join('\n'));
            handleStreamEvent(streamMessageId, eventType, data, message);
        } catch (err) {
            console.warn('SSE JSON parse failed', eventType, dataLines.join('\n'), err);
        }
    }
}
```

**SSE 优势**:
- 实时反馈，用户可以看到 AI 的思考过程
- 支持长时间操作（如 SQL 执行、重试）
- 前端可以逐步渲染结果，提升用户体验

### 2.4 AI 能力检测机制

#### 2.4.1 检测流程
**位置**: `server.go:8083`

```go
func detectAICapabilities(config *AIConfig) (*AICapabilities, error) {
    // 1. 优先使用手动设置
    if config.EnableFunctionCall != nil {
        capabilities.SupportsFunctionCall = *config.EnableFunctionCall
    }
    // ... 其他手动设置

    // 如果所有能力都已手动设置，跳过自动检测
    if allManuallySet {
        return capabilities, nil
    }

    // 2. 测试基本连通性
    connectivityOK, _ := testBasicConnectivity(client, config)

    // 3. 测试 Function Call
    if config.EnableFunctionCall == nil && connectivityOK {
        supported, _ := testFunctionCall(client, config)
        capabilities.SupportsFunctionCall = supported
    }

    // 4. 测试 Streaming
    if config.EnableStreaming == nil && connectivityOK {
        supported, _ := testStreaming(client, config)
        capabilities.SupportsStreaming = supported
    }

    // 5. 测试 JSON Mode
    if config.EnableJSONMode == nil && connectivityOK {
        supported, _ := testJSONMode(client, config)
        capabilities.SupportsJSONMode = supported
    }

    // 6. 根据模型名称推断上下文窗口和 Thinking 支持
    capabilities.ContextWindow = inferContextWindow(config.Model)
    capabilities.SupportsThinking = inferThinkingSupport(config.Model)

    return capabilities, nil
}
```

#### 2.4.2 Function Call 测试
**位置**: `server.go:8202`

```go
func testFunctionCall(client *http.Client, config *AIConfig) (bool, error) {
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

    // 发送请求并检查响应中是否包含 tool_calls
    // ...
}
```

#### 2.4.3 Streaming 测试
**位置**: `server.go:8346`

```go
func testStreaming(client *http.Client, config *AIConfig) (bool, error) {
    requestBody := map[string]interface{}{
        "model": config.Model,
        "messages": []map[string]string{
            {"role": "user", "content": "hi"},
        },
        "stream":     true,
        "max_tokens": 10,
    }

    resp, err := client.Do(req)
    // ...

    // 检查是否返回 SSE 流
    contentType := resp.Header.Get("Content-Type")
    if strings.Contains(contentType, "text/event-stream") ||
        strings.Contains(contentType, "application/stream+json") {
        return true, nil
    }

    return false, fmt.Errorf("Content-Type 不是流式类型: %s", contentType)
}
```

### 2.5 SQL 硬性校验机制

#### 2.5.1 校验流程
**位置**: `server.go:9334`

```go
// 校验SQL中的表名和字段名是否存在
sqlStr, _ := apiConfig["sql"].(string)
if sqlStr != "" && len(dbSchemas) > 0 {
    valid, validationError := validateSQLTablesAndFields(sqlStr, dbSchemas)
    if !valid {
        log.Printf("SQL校验失败: %s", validationError)
        sendSSE(w, "sql_validation_error", map[string]interface{}{
            "message":  "SQL校验失败: " + validationError,
            "sql":      sqlStr,
            "response": aiResponse,
        })
        return
    }
    log.Printf("SQL校验成功")
}
```

#### 2.5.2 校验函数实现
**核心逻辑**:
1. 提取 SQL 中的所有表名（FROM、JOIN 子句）
2. 提取 SQL 中的所有字段名（SELECT、WHERE、ORDER BY、GROUP BY 子句）
3. 检查表名是否在 schema 中存在
4. 检查字段名是否在对应表中存在
5. 返回详细的错误信息

**示例错误信息**:
- "表 users 不存在"
- "字段 email 在表 users 中不存在"
- "字段 created_at 在表 orders 中不存在，但在表 users 中存在"

### 2.6 default_params 自动填充机制

#### 2.6.1 填充流程
**位置**: `server.go:9963`

```go
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
    dbConfig, exists := dataOntologyDatabases[dbID]
    if !exists {
        return
    }

    // 提取 SQL 中的表名
    tableNames := extractTableNamesFromSQL(sqlStr)

    // 对每个参数，尝试从对应的表中查询实际值
    for paramName, paramValue := range defaultParams {
        // 检查参数是否出现在非条件子句中
        if isNonConditionParam(sqlStr, paramName) {
            continue
        }

        // 查找参数对应的表和字段
        tableName, fieldName := findParamTableAndField(sqlStr, paramName, tableNames)

        // 从表中查询实际值
        actualValue, err := queryActualValueFromTable(dbConfig, tableName, fieldName)
        if err == nil && actualValue != nil {
            defaultParams[paramName] = actualValue
        }
    }
}
```

#### 2.6.2 表名提取
**位置**: `server.go:10017`

```go
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

    return uniqueTables
}
```

#### 2.6.3 参数-字段映射
**核心逻辑**:
1. 在 SQL 中查找 `#{paramName}` 或 `${paramName}`
2. 分析参数所在的子句（WHERE、SET 等）
3. 提取参数对应的字段名（如 `WHERE status = #{status}` → 字段 `status`）
4. 根据字段名和表名，从数据库中查询实际值

#### 2.6.4 实际值查询
**位置**: `server.go:10185`

```go
func queryActualValueFromTable(dbConfig *DatabaseConfig, tableName, fieldName string) (interface{}, error) {
    // 构建查询 SQL
    querySQL := fmt.Sprintf("SELECT %s FROM %s LIMIT 1", fieldName, tableName)

    // 执行查询
    results, err := executeSQLQuery(dbConfig, querySQL, []interface{}{})
    if err != nil {
        return nil, err
    }

    if len(results) > 0 {
        if value, ok := results[0][fieldName]; ok {
            return value, nil
        }
    }

    return nil, fmt.Errorf("未找到数据")
}
```

#### 2.6.5 非条件参数识别
**目的**: LIMIT、OFFSET、ORDER BY、GROUP BY 等参数不应从表中查询实际值

```go
func isNonConditionParam(sqlStr, paramName string) bool {
    upperSQL := strings.ToUpper(sqlStr)

    // 检查是否在 LIMIT 子句中
    if strings.Contains(upperSQL, "LIMIT #{"+strings.ToUpper(paramName)+"}") ||
       strings.Contains(upperSQL, "LIMIT ${"+strings.ToUpper(paramName)+"}") {
        return true
    }

    // 检查是否在 OFFSET 子句中
    if strings.Contains(upperSQL, "OFFSET #{"+strings.ToUpper(paramName)+"}") ||
       strings.Contains(upperSQL, "OFFSET ${"+strings.ToUpper(paramName)+"}") {
        return true
    }

    // 检查是否在 ORDER BY 子句中
    if strings.Contains(upperSQL, "ORDER BY") {
        orderByIdx := strings.Index(upperSQL, "ORDER BY")
        afterOrderBy := sqlStr[orderByIdx:]
        if strings.Contains(strings.ToUpper(afterOrderBy), strings.ToUpper(paramName)) {
            return true
        }
    }

    // 检查是否在 GROUP BY 子句中
    if strings.Contains(upperSQL, "GROUP BY") {
        groupByIdx := strings.Index(upperSQL, "GROUP BY")
        afterGroupBy := sqlStr[groupByIdx:]
        if strings.Contains(strings.ToUpper(afterGroupBy), strings.ToUpper(paramName)) {
            return true
        }
    }

    return false
}
```

---

## 3. 与其他模块的联动

### 3.1 数据库管理模块联动

#### 3.1.1 Schema 获取
**联动方式**: AI 助手从数据库管理模块获取数据库配置和表结构

**关键代码** (`server.go:6948`):
```go
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

    // 获取每张表的字段信息
    var tablesWithColumns []map[string]interface{}
    for _, tableName := range tables {
        columns, err := getTableColumns(dbConfig, tableName)
        if err != nil {
            log.Printf("获取表 %s 字段失败: %v", tableName, err)
            continue
        }
        tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
            "name":    tableName,
            "columns": columns,
        })
    }

    dbSchemas = append(dbSchemas, map[string]interface{}{
        "name":      dbConfig.Name,
        "type":      dbConfig.Type,
        "tables":    tablesWithColumns,
        "id":        dbID,
    })
}
dataOntologyMu.RUnlock()
```

**获取的信息**:
- 数据库类型（MySQL、PostgreSQL、MongoDB 等）
- 表名列表
- 每张表的字段信息（字段名、类型、是否可空、默认值等）

#### 3.1.2 本体关系获取
**联动方式**: AI 助手从数据库配置中读取本体关系信息

**关键代码** (`server.go:7006`):
```go
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
    "relations": relations, // 注入本体关系
    "id":        dbID,
})
```

**本体关系的作用**:
- 帮助 AI 理解表间字段关联
- 自动推断 JOIN 条件
- 生成更准确的 SQL

**示例**:
如果本体关系中定义了 `users.id = orders.user_id`，AI 会自动在 SQL 中添加 `JOIN orders ON users.id = orders.user_id`。

### 3.2 接口分发模块联动

#### 3.2.1 接口创建
**联动方式**: AI 助手生成的接口配置保存到接口分发模块的数据存储中

**关键代码** (`script.js:6290`):
```javascript
async function confirmCreateApiFromAI(config, messageId) {
    const apiData = {
        name: config.name,
        path: config.path,
        method: config.method,
        sql: config.sql,
        description: config.description,
        database_id: config.database_id || aiSessionContext.databases[0]?.id,
        default_params: config.default_params || {},
    };

    const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/apis`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(apiData),
    });

    const result = await response.json();
    if (result.success) {
        showAiMessage('success', `接口 "${config.name}" 创建成功！`);
        loadApis(); // 刷新接口列表
    }
}
```

#### 3.2.2 接口调用
**联动方式**: 创建的接口可以直接通过接口分发模块调用

**调用流程**:
1. 用户在接口管理界面点击"测试"按钮
2. 系统自动填充 `default_params` 中的默认值
3. 发送请求到 `/api/data-ontology/apis/{id}/test`
4. 后端执行 SQL 并返回结果

**关键代码** (`server.go:6057`):
```go
// 使用默认参数
if matchedApi.DefaultParams != nil {
    log.Printf("[API] 使用默认参数: api=%s, default_params=%v", matchedApi.Name, matchedApi.DefaultParams)
    for key, value := range matchedApi.DefaultParams {
        if _, exists := params[key]; !exists {
            params[key] = value
        }
    }
}
```

### 3.3 数据治理模块联动

#### 3.3.1 任务草稿生成
**联动方式**: AI 助手生成的治理任务配置保存到数据治理模块

**关键代码** (`script.js:6381`):
```javascript
async function confirmCreateGovTaskFromAI(messageId) {
    const draft = window._aiGovDraftByMessageId[messageId];
    if (!draft) {
        showAiMessage('error', '草稿数据丢失，请重新生成');
        return;
    }

    const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/governance/tasks`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(draft),
    });

    const result = await response.json();
    if (result.success) {
        showAiMessage('success', `治理任务 "${draft.name}" 创建成功！`);
        loadGovernanceTasks(); // 刷新任务列表
    }
}
```

#### 3.3.2 任务执行
**联动方式**: 创建的任务可以在数据治理模块中执行

**执行流程**:
1. 用户在治理任务界面点击"运行"按钮
2. 系统调用 `/api/data-ontology/governance/tasks/{id}/run`
3. 后端执行 JS 脚本（支持数据库操作、文件处理等）
4. 返回执行结果和日志

### 3.4 本体论抽象模块联动

#### 3.4.1 本体关系管理
**联动方式**: 用户可以在本体论模块中管理本体关系，AI 助手自动使用这些关系

**关键代码** (`script.js:10363`):
```javascript
async function showOntologyRelationModal() {
    document.getElementById('ontologyRelationModal').style.display = 'block';

    const loading = document.getElementById('relationTableLoading');
    const tbody = document.getElementById('relationTableBody');

    loading.style.display = 'block';
    tbody.innerHTML = '';

    const res = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/ontology/relations`, {
        headers: {'Authorization': 'Bearer ' + localStorage.getItem('token')}
    });
    const data = await res.json();

    loading.style.display = 'none';
    if (data.success) {
        const relations = data.relations || [];
        renderDbRelationTable(relations);
    }
}
```

#### 3.4.2 本体关系扫描
**联动方式**: 系统可以自动扫描数据库，发现潜在的本体关系

**关键代码** (`script.js:10484`):
```javascript
async function scanOntologyRelations() {
    const res = await fetch(`${API_BASE}/api/data-ontology/databases/${currentDb.id}/ontology/scan`, {
        headers: {'Authorization': 'Bearer ' + localStorage.getItem('token')}
    });
    const data = await res.json();

    if (data.success && data.suggestions) {
        // 显示建议的关系列表，用户可以选择保存
        showRelationSuggestions(data.suggestions);
    }
}
```

**扫描逻辑**:
1. 分析表结构，查找主键和外键
2. 根据字段名推断关系（如 `user_id` 可能关联 `users.id`）
3. 生成关系建议列表
4. 用户确认后保存到数据库配置中

#### 3.4.3 本体论语义查询
**联动方式**: 用户可以用自然语言查询本体论知识图谱

**关键代码** (`server.go:8797`):
```go
func handleAIOntologyQuery(w http.ResponseWriter, flusher http.Flusher, queryReq *AIQueryRequest, dbSchemas []map[string]interface{}, aiConfig *AIConfig) {
    sendSSE(w, "thinking", map[string]interface{}{"message": "正在进行语义分析..."})

    // 构建提示词
    prompt := buildOntologyQueryPrompt(queryReq.Message, dbSchemas)

    // 调用 AI 服务
    aiResponse, err := callAIService(aiConfig, prompt)
    if err != nil {
        sendSSE(w, "error", map[string]interface{}{"message": "AI调用失败: " + err.Error()})
        return
    }

    // 解析回答
    answer, highlighted := parseOntologyAnswer(aiResponse)

    sendSSE(w, "answer", map[string]interface{}{"text": answer, "highlighted": highlighted})
    sendSSE(w, "done", map[string]interface{}{})
}
```

**查询示例**:
- 用户: "哪些表包含用户信息？"
- AI: "users 表包含用户基本信息，user_profiles 表包含用户详细资料，orders 表包含用户订单信息。"
- 系统会高亮相关的概念节点。

---

## 4. 技术亮点总结

### 4.1 智能化特性
1. **自然语言理解**: 用户无需学习 SQL，直接用自然语言描述需求
2. **上下文感知**: 支持多轮对话，自动维护会话上下文
3. **智能推断**: 根据本体关系自动推断 JOIN 条件
4. **反思机制**: AI 自我评估结果质量，提供改进建议

### 4.2 安全性特性
1. **写入操作确认**: 防止误执行 DELETE、UPDATE、INSERT 等危险操作
2. **SQL 硬性校验**: 验证生成的 SQL 中的表名和字段名真实存在
3. **权限控制**: 根据数据库所有者进行访问控制
4. **错误分类**: 区分权限错误、超时错误、语法错误，采取不同策略

### 4.3 可靠性特性
1. **自动重试**: SQL 执行失败时自动重试，根据错误调整 SQL
2. **重复检测**: 检测重复 SQL，避免无限循环
3. **能力检测**: 自动检测 AI 模型能力，适配不同模型
4. **降级策略**: 如果能力检测失败，使用默认能力继续

### 4.4 用户体验特性
1. **SSE 流式响应**: 实时反馈 AI 处理进度
2. **时间线展示**: 清晰展示每个步骤的状态
3. **自动折叠**: 处理完成后自动折叠时间线，节省空间
4. **结果可视化**: 表格化展示查询结果，支持滚动
5. **上下文提示**: 显示当前上下文（数据库、模块）

### 4.5 可扩展性特性
1. **模块化设计**: 通过 `aiModules` 定义功能模块，易于扩展
2. **插件化架构**: 新增功能只需添加新的处理器函数
3. **配置化**: AI 配置、能力检测均可配置
4. **多模型支持**: 支持多种 AI 模型（OpenAI、Claude、Qwen 等）

---

## 5. 未来优化方向

### 5.1 性能优化
1. **缓存机制**: 缓存数据库 schema，减少重复查询
2. **并发控制**: 限制并发 AI 请求，避免资源耗尽
3. **流式优化**: 优化 SSE 流式传输，减少延迟

### 5.2 功能增强
1. **多表关联**: 支持更复杂的多表关联查询
2. **子查询优化**: 优化子查询生成逻辑
3. **SQL 优化建议**: AI 分析 SQL 性能，提供优化建议
4. **数据可视化**: 支持图表化展示查询结果

### 5.3 安全增强
1. **SQL 注入防护**: 增强参数化查询，防止 SQL 注入
2. **敏感数据脱敏**: 自动识别敏感字段，进行脱敏处理
3. **审计日志**: 记录所有 AI 生成的 SQL 和执行结果

### 5.4 智能化提升
1. **Few-shot 学习**: 提供示例 SQL，提升生成质量
2. **用户反馈**: 收集用户反馈，持续优化提示词
3. **知识库**: 构建领域知识库，提升专业领域查询准确性
4. **多轮对话优化**: 优化多轮对话的上下文管理

---

## 6. 总结

DataToolbox 的 AI 助手模块是一个功能完善、架构清晰、用户体验优秀的智能数据查询系统。通过自然语言理解、SSE 流式通信、智能重试、反思机制等技术，实现了从自然语言到 SQL 执行的完整闭环。同时，通过与数据库管理、接口分发、数据治理、本体论抽象等模块的深度联动，形成了一个完整的数据管理生态系统。

核心亮点包括：
- **完整的 AI 能力检测机制**（实际 API 调用试错）
- **SQL 硬性校验机制**（验证表名和字段名真实存在）
- **default_params 自动填充机制**（从表中取实际值）
- **本体关系信息注入**（帮助 AI 理解表间字段关联）
- **智能重试和反思机制**（提升 SQL 生成质量）

这些特性使得 DataToolbox 的 AI 助手不仅易用，而且可靠、安全、智能，为用户提供了一站式的数据查询和管理体验。

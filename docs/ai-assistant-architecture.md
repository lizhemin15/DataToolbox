# DataToolbox AI 助手模块架构文档

## 目录
1. [功能概览](#功能概览)
2. [技术架构](#技术架构)
3. [核心实现](#核心实现)
4. [模块联动](#模块联动)
5. [数据流与调用链](#数据流与调用链)

---

## 功能概览

### 已实现功能

#### 1. 自然语言转 SQL 查询
- **用途**: 用户通过自然语言描述查询需求，AI 自动生成 SQL 并执行
- **触发方式**:
  - `@数据库名 查询问题`
  - 后续对话自动使用上下文数据库
- **特性**:
  - 支持查询、统计、分析等多种场景
  - 自动检测写入操作，需用户确认后执行
  - 支持多轮对话上下文记忆
  - 失败自动重试，最多 3 次
  - 反思机制：AI 分析结果是否回答了用户问题
- **前端界面**: AI 助手 Tab 页聊天界面
- **API 端点**: `POST /api/data-ontology/ai/query`

#### 2. 创建 API 接口配置
- **用途**: 通过自然语言描述需求，自动生成 RESTful API 接口配置
- **触发方式**:
  - `@接口分发 创建一个查询用户的接口`
  - 或关键词触发：创建接口、新建接口、生成接口、创建 API 等
- **生成内容**:
  - 接口名称、路径、HTTP 方法
  - SQL 语句（支持 MyBatis 参数语法 `#{param}`）
  - 接口描述
  - 默认参数值（用于测试）
- **流程**: AI 生成配置 → 用户预览/编辑 → 确认创建
- **前端界面**: AI 聊天界面中显示配置预览卡片
- **后端处理**: `handleAICreateApi()`

#### 3. 创建数据治理任务
- **用途**: 通过自然语言描述，生成定时任务或交互任务的配置草稿
- **触发方式**:
  - `@数据治理 @数据库名 创建一个定时任务每天凌晨 2 点导入数据`
  - 或 `@数据治理 生成一个交互任务：上传 Excel 后写入指定表`
- **生成内容**:
  - 任务名称、类型（定时/交互）
  - Cron 表达式（定时任务）
  - JavaScript 处理代码
  - 输入类型、允许的文件扩展名（交互任务）
- **流程**: AI 生成草稿 → 用户预览/编辑 → 确认创建
- **前端界面**: AI 聊天界面中显示任务草稿卡片
- **后端处理**: `handleAIGovernanceTask()`

#### 4. 创建数据质量审核规则
- **用途**: 生成数据质量审核规则配置
- **触发方式**: `@质量审核 创建规则检查用户表的必填字段`
- **生成内容**:
  - 规则编号、层级编码
  - 规则名称、分类
  - SQL 语句（查询违规数据）
- **流程**: AI 生成规则 → 用户确认 → 创建规则
- **前端界面**: AI 聊天界面中显示规则预览
- **后端处理**: `handleAIQualityRule()`

#### 5. 创建小模型
- **用途**: 生成 JavaScript 数据处理函数（小模型）
- **触发方式**: `@小模型 创建一个数据清洗函数`
- **生成内容**:
  - 模型名称、描述
  - JavaScript 异步处理代码
  - 输入/输出类型定义
- **流程**: AI 生成配置 → 用户确认 → 创建小模型
- **前端界面**: AI 聊天界面中显示配置预览
- **后端处理**: `handleAISmallModel()`

#### 6. 本体论语义查询
- **用途**: 基于知识图谱进行语义分析和数据治理建议
- **触发方式**: `@本体论 分析用户表和订单表的关系`
- **特性**:
  - 从本体论角度分析业务语义
  - 提供数据治理建议
  - 自动高亮相关概念
- **前端界面**: AI 聊天界面中显示分析结果
- **后端处理**: `handleAIOntologyQuery()`

---

## 技术架构

### 代码结构

```
DataToolbox/
├── server.go                      # 后端主文件（AI 核心逻辑）
│   ├── 数据结构定义 (行 890-933)
│   │   ├── AIConfig              # AI 服务配置
│   │   ├── AIQueryRequest        # AI 查询请求
│   │   ├── LLMModelConfig        # 大模型配置
│   │   └── SmallModelConfig      # 小模型配置
│   ├── API 处理函数 (行 6392-9038)
│   │   ├── handleAIConfig        # AI 配置管理
│   │   ├── handleAIQuery         # AI 查询主入口
│   │   ├── handleAIOntologyQuery # 本体论查询
│   │   ├── handleAIGovernanceTask# 治理任务生成
│   │   ├── handleAIQualityRule   # 质量规则生成
│   │   ├── handleAISmallModel    # 小模型生成
│   │   └── handleAICreateApi     # API 配置生成
│   ├── AI 服务调用 (行 7563-7846)
│   │   ├── buildAIPrompt         # 构建提示词
│   │   ├── buildRetryPrompt      # 构建重试提示词
│   │   ├── callAIService         # 调用 LLM API
│   │   ├── formatDBSchemaForPrompt# 格式化数据库结构
│   │   └── getModulePromptPrefix # 获取模块提示词前缀
│   └── 辅助函数
│       ├── sendSSE               # 发送 SSE 事件
│       ├── cleanAIResponse       # 清理 AI 响应
│       └── parseReflectionResponse# 解析反思结果
│
├── apps/data-ontology/
│   ├── index.html (1741 行)      # 前端 HTML
│   │   └── AI 助手 Tab (行 725-778)
│   │       ├── 聊天消息区域
│   │       ├── 输入框和发送按钮
│   │       └── AI 配置按钮
│   ├── script.js (9968 行)       # 前端主脚本
│   │   ├── AI 会话上下文 (行 66-70)
│   │   ├── AI 模块定义 (行 59-64)
│   │   ├── AI 配置管理 (行 4090-4110)
│   │   ├── 消息发送处理 (行 4750-4873)
│   │   ├── 流式事件处理 (行 5303-5653)
│   │   ├── SQL 确认执行 (行 5030-5217)
│   │   └── 辅助函数
│   │       ├── addAiMessage      # 添加消息
│   │       ├── formatAIText      # 格式化 AI 文本
│   │       └── updateAiContextDisplay# 更新上下文显示
│   └── style.css (6213 行)       # 样式文件
│       └── AI 相关样式 (约 1500 行)
│
└── go.mod                         # Go 依赖管理
```

### 技术栈

#### 后端技术
- **语言**: Go 1.21+
- **核心依赖**:
  - `net/http` - HTTP 服务器
  - `encoding/json` - JSON 处理
  - `github.com/google/uuid` - UUID 生成
  - `github.com/go-sql-driver/mysql` - MySQL 驱动
  - `github.com/lib/pq` - PostgreSQL 驱动
  - `github.com/mattn/go-oci8` - Oracle 驱动
  - 其他数据库驱动（达梦、SQLite、MongoDB、Redis 等）

#### 前端技术
- **技术**: 原生 JavaScript (无框架依赖)
- **特性**:
  - Server-Sent Events (SSE) - 流式响应
  - Fetch API - HTTP 请求
  - LocalStorage - 本地存储
  - 动态脚本加载 - 按需加载模块脚本

#### AI 服务集成
- **协议**: OpenAI API 兼容格式
- **支持的服务**:
  - OpenAI (GPT-3.5/GPT-4)
  - Claude (通过兼容接口)
  - Ollama (本地部署)
  - 其他兼容 OpenAI 格式的服务
- **配置项**:
  - URL: AI 服务端点
  - API Key: 认证密钥
  - Model: 模型名称
  - Timeout: 超时时间（默认 120 秒）

### 核心类与函数设计

#### 后端核心函数

```go
// 1. AI 配置管理
func handleAIConfig(w http.ResponseWriter, r *http.Request)
    - GET: 获取当前 AI 配置
    - POST: 保存 AI 配置（URL、API Key、Model、Timeout）

// 2. AI 查询主入口
func handleAIQuery(w http.ResponseWriter, r *http.Request)
    - 解析请求（消息、数据库、模块、历史）
    - 获取数据库表结构
    - 根据模块路由到不同处理函数
    - 返回 SSE 流式响应

// 3. 模块处理函数
func handleAIOntologyQuery(...)    // 本体论语义查询
func handleAIGovernanceTask(...)   // 生成数据治理任务
func handleAIQualityRule(...)      // 生成质量审核规则
func handleAISmallModel(...)       // 生成小模型配置
func handleAICreateApi(...)        // 生成 API 配置

// 4. AI 服务调用
func callAIService(config *AIConfig, prompt string) (string, error)
    - 构建请求体（model、messages、temperature=0.1）
    - 发送 HTTP POST 请求
    - 解析响应，提取 content
    - 超时控制（默认 120 秒）

// 5. 提示词构建
func buildAIPrompt(userMessage string, dbSchemas []map[string]interface{}, modules []string) string
    - 获取模块前缀提示词
    - 格式化数据库结构信息
    - 添加数据库特定警告
    - 添加 SQL 生成规则

func buildRetryPrompt(...) string
    - 分析错误类型（语法、对象不存在、权限、超时）
    - 加载对应数据库的 SQL 文档
    - 构建重试提示词

// 6. 辅助函数
func sendSSE(w http.ResponseWriter, eventType string, data interface{})
    - 发送 SSE 事件：event: xxx\ndata: {...}\n\n

func formatDBSchemaForPrompt(dbSchemas []map[string]interface{}) (string, string)
    - 格式化数据库结构为文本
    - 标记自增主键、NOT NULL 约束
    - 返回格式化文本和主数据库类型
```

#### 前端核心函数

```javascript
// 1. 会话上下文管理
let aiSessionContext = {
    databases: [],  // 当前上下文数据库
    modules: [],    // 当前上下文模块
    history: []     // 对话历史（最近 5 轮）
};

// 2. 消息发送
async function handleSendAiMessage()
    - 提取 @ 引用（数据库、模块）
    - 合并上下文
    - 发送 POST 请求到 /api/data-ontology/ai/query
    - 处理 SSE 流式响应

// 3. 流式事件处理
function handleStreamEvent(messageId, eventType, data, userMessage)
    - start: 显示开始处理
    - thinking: 显示思考中
    - sql_generated: 显示生成的 SQL
    - executing: 执行 SQL
    - success: 显示成功结果
    - confirm_write: 显示写入确认
    - error: 显示错误信息
    - api_config_generated: 显示 API 配置预览
    - governance_task_draft: 显示治理任务草稿
    - quality_rule_draft: 显示质量规则草稿
    - small_model_draft: 显示小模型配置

// 4. SQL 确认执行
async function executeConfirmedSQLFromElement(confirmId, messageId)
    - 解析待执行的 SQL
    - 发送 POST 到 /api/data-ontology/ai/confirm-execute
    - 显示执行结果

// 5. 辅助函数
function addAiMessage(role, content)          // 添加消息到聊天界面
function addAiStreamMessage()                 // 创建流式消息卡片
function appendAiProcessStep(...)             // 添加处理步骤
function formatAIText(text)                   // 格式化 AI 文本（Markdown 转 HTML）
function updateAiContextDisplay()             // 更新上下文标签显示
```

---

## 核心实现

### 1. 流式响应机制

#### SSE 事件类型

```javascript
// 后端发送的事件类型
event: start              // 开始处理
event: thinking           // 思考中
event: retry              // 重试
event: sql_generated      // SQL 已生成
event: executing          // 执行 SQL
event: attempt_failed     // 尝试失败
event: success            // 成功完成
event: confirm_write      // 待确认的写入操作
event: error              // 错误
event: api_config_generated        // API 配置已生成
event: governance_task_draft       // 治理任务草稿
event: quality_rule_draft          // 质量规则草稿
event: small_model_draft           // 小模型配置
event: answer             // 本体论查询答案
event: done               // 完成
```

#### 前端处理流程

```javascript
// 1. 创建流式消息卡片
const streamMessageId = addAiStreamMessage();

// 2. 读取 SSE 流
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
        // 解析 event 和 data
        const eventLines = chunk.split('\n');
        let eventType = '';
        const dataLines = [];

        for (const line of eventLines) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }

        const data = JSON.parse(dataLines.join('\n'));
        handleStreamEvent(streamMessageId, eventType, data, message);
    }
}
```

### 2. 上下文管理

#### 会话上下文结构

```javascript
let aiSessionContext = {
    databases: [  // 当前上下文数据库
        { id: 'db-uuid', name: 'MySQL-Test', type: 'mysql', ... }
    ],
    modules: [    // 当前上下文模块
        { id: 'data-governance', name: '数据治理' }
    ],
    history: [    // 对话历史（最近 5 轮）
        {
            role: 'user',
            content: '查询用户表前 10 条',
            databases: ['db-uuid'],
            modules: []
        },
        {
            role: 'assistant',
            content: '已查询到 10 条记录...',
            databases: ['db-uuid'],
            modules: []
        }
    ]
};
```

#### 上下文更新逻辑

```javascript
// 1. 提取 @ 引用
const allMatches = [...message.matchAll(/@([^\s]+)/g)];
const dbReferences = [];
const moduleReferences = [];

for (const match of allMatches) {
    const refName = match[1];
    const mod = aiModules.find(m => m.name === refName);
    if (mod) {
        moduleReferences.push(mod);  // 模块引用
        continue;
    }
    const db = databases.find(d => d.name === refName);
    if (db) {
        dbReferences.push(db);       // 数据库引用
    }
}

// 2. 更新上下文
if (moduleReferences.length > 0) {
    aiSessionContext.modules = moduleReferences;  // 新模块覆盖旧模块
}
if (dbReferences.length > 0) {
    aiSessionContext.databases = dbReferences;    // 新数据库覆盖旧数据库
} else if (aiSessionContext.databases.length > 0) {
    dbReferences.push(...aiSessionContext.databases);  // 使用上下文数据库
}

// 3. 记录历史
aiSessionContext.history.push({
    role: 'user',
    content: message,
    databases: dbReferences.map(db => db.id),
    modules: aiSessionContext.modules.map(m => m.id)
});

// 4. 发送请求时携带历史（最近 5 轮）
body: JSON.stringify({
    message: message,
    databases: dbReferences.map(db => db.id),
    modules: aiSessionContext.modules.map(m => m.id),
    history: aiSessionContext.history.slice(-5)
})
```

### 3. SQL 生成与执行

#### 提示词构建策略

```go
func buildAIPrompt(userMessage string, dbSchemas []map[string]interface{}, modules []string) string {
    prompt := getModulePromptPrefix(modules)  // 模块前缀

    // 1. 数据库结构信息
    prompt += "【重要】以下是真实的数据库结构信息，请严格基于这些表和字段生成SQL：\n"
    schemaText, primaryDBType := formatDBSchemaForPrompt(dbSchemas)
    prompt += schemaText

    // 2. 用户问题
    prompt += "\n用户问题：" + userMessage + "\n\n"

    // 3. 数据库特定警告
    prompt += getDBSpecificWarnings(primaryDBType)

    // 4. 重要规则
    prompt += "⚠️ 重要规则：\n"
    prompt += "1. 【必须】只生成一条SQL语句！\n"
    prompt += "2. 【必须】只使用上面列出的真实表名和字段名\n"
    prompt += "3. 【禁止】不要使用 UNION ALL 合并不同表的数据\n"
    prompt += "4. 对于INSERT操作：必须使用表中实际存在的字段名\n"
    // ... 更多规则

    // 5. 示例 SQL
    prompt += "📚 根据问题类型选择正确的SQL：\n"
    prompt += "🔍 查询表结构/字段信息：\n"
    prompt += queryColumns + "\n\n"
    // ... 更多示例

    return prompt
}
```

#### 重试机制

```go
// 最多重试 3 次
maxRetries := 3
for attempt := 1; attempt <= maxRetries; attempt++ {
    // 1. 构建提示词
    if attempt == 1 {
        prompt = buildAIPrompt(userMessage, dbSchemas, modules)
    } else {
        prompt = buildRetryPrompt(userMessage, dbSchemas, lastError, attempts, modules)
    }

    // 2. 调用 AI
    aiResponse, err := callAIService(aiConfig, prompt)

    // 3. 提取 SQL
    sql := extractSQLFromAIResponse(aiResponse)

    // 4. 检测写入操作
    if isWriteOperation(sql) {
        // 返回待确认状态
        sendSSE(w, "confirm_write", map[string]interface{}{
            "response": aiResponse,
            "sql":      sql,
            "dbId":     dbID,
        })
        return
    }

    // 5. 执行 SQL
    sendSSE(w, "executing", map[string]interface{}{
        "message": "正在执行 SQL...",
    })

    results, err := executeSQL(dbConfig, sql)
    if err != nil {
        // 记录失败尝试
        attempts = append(attempts, map[string]interface{}{
            "attempt": attempt,
            "error":   err.Error(),
            "sql":     sql,
        })

        // 发送失败事件
        sendSSE(w, "attempt_failed", map[string]interface{}{
            "attempt": attempt,
            "error":   err.Error(),
            "sql":     sql,
        })

        lastError = err.Error()
        continue  // 继续重试
    }

    // 6. 成功
    sendSSE(w, "success", map[string]interface{}{
        "response": aiResponse,
        "sql":      sql,
        "results":  results,
        "attempts": attempts,
        "retries":  attempt - 1,
    })
    return
}

// 7. 所有尝试失败
sendSSE(w, "error", map[string]interface{}{
    "message":  "多次尝试后仍失败",
    "attempts": attempts,
})
```

#### 反思机制

```go
// AI 分析查询结果是否回答了用户问题
func buildReflectionPrompt(userMessage string, sqlQuery string, resultsSummary map[string]interface{}, dbType string) string {
    var sb strings.Builder

    sb.WriteString("你是一个数据分析专家。请分析以下 SQL 查询结果是否回答了用户的问题。\n\n")
    sb.WriteString(fmt.Sprintf("用户问题：%s\n\n", userMessage))
    sb.WriteString(fmt.Sprintf("执行的 SQL：%s\n\n", sqlQuery))
    sb.WriteString(fmt.Sprintf("查询结果摘要：%s\n\n", toJSON(resultsSummary)))

    sb.WriteString("请以 JSON 格式回答：\n")
    sb.WriteString("{\n")
    sb.WriteString("  \"answers_question\": true/false,\n")
    sb.WriteString("  \"confidence\": 0.0-1.0,\n")
    sb.WriteString("  \"issue\": \"问题描述（如果有）\",\n")
    sb.WriteString("  \"insight\": \"对结果的洞察分析\",\n")
    sb.WriteString("  \"suggestion\": \"改进建议\"\n")
    sb.WriteString("}\n")

    return sb.String()
}

// 调用反思
reflectionPrompt := buildReflectionPrompt(userMessage, sql, resultsSummary, dbType)
reflectionResponse, err := callAIService(aiConfig, reflectionPrompt)
reflection := parseReflectionResponse(reflectionResponse)

// 返回结果时包含反思
sendSSE(w, "success", map[string]interface{}{
    "response":  aiResponse,
    "sql":       sql,
    "results":   results,
    "insight":   reflection.Insight,
    "confidence": reflection.Confidence,
})
```

### 4. 写入操作确认

#### 检测写入操作

```go
func isWriteOperation(sql string) bool {
    upperSQL := strings.ToUpper(strings.TrimSpace(sql))
    return strings.HasPrefix(upperSQL, "INSERT") ||
           strings.HasPrefix(upperSQL, "UPDATE") ||
           strings.HasPrefix(upperSQL, "DELETE") ||
           strings.HasPrefix(upperSQL, "DROP") ||
           strings.HasPrefix(upperSQL, "CREATE") ||
           strings.HasPrefix(upperSQL, "ALTER") ||
           strings.HasPrefix(upperSQL, "TRUNCATE")
}
```

#### 前端确认流程

```javascript
// 1. 显示确认界面
case 'confirm_write':
    statusEl.innerHTML = '';
    const confirmId = 'confirm-' + messageId;
    confirmHtml = `
        <div style="margin-bottom: 6px;">${formatAIText(data.response)}</div>
        <div style="margin-top: 6px;">
            <div style="font-size: 12px; font-weight: 600; color: #4a5568;">待确认 SQL</div>
            <div class="ai-sql-block">${escapeHtml(data.sql)}</div>
        </div>
        <div class="ai-confirm-write" id="${confirmId}">
            <div class="ai-confirm-warning">
                <span class="ai-confirm-icon">⚠️</span>
                <span>检测到写入操作，请确认后再执行。</span>
            </div>
            <div class="ai-confirm-actions">
                <button class="btn ai-confirm-btn-yes" onclick="executeConfirmedSQLFromElement('${confirmId}', '${messageId}')">执行</button>
                <button class="btn ai-confirm-btn-no" onclick="cancelConfirmedSQL('${confirmId}', '${messageId}')">取消</button>
            </div>
        </div>
    `;
    contentEl.innerHTML = confirmHtml;
    break;

// 2. 用户确认后执行
async function executeConfirmedSQLFromElement(confirmId, messageId) {
    const confirmEl = document.getElementById(confirmId);
    const sql = JSON.parse(decodeURIComponent(confirmEl.dataset.sql));
    const dbId = JSON.parse(decodeURIComponent(confirmEl.dataset.dbId));

    const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/ai/confirm-execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, db_id: dbId })
    });

    const result = await response.json();
    // 显示执行结果
}
```

---

## 模块联动

### 与数据治理模块的联动

#### 创建定时任务

**用户输入**:
```
@数据治理 @MySQL-Test 创建一个定时任务，每天凌晨 2 点从 users 表导出数据到 CSV 文件
```

**AI 生成的配置**:
```json
{
  "name": "用户数据每日导出",
  "type": "scheduled",
  "description": "每天凌晨 2 点导出 users 表数据到 CSV",
  "cron_expr": "0 2 * * *",
  "js_code": "async function run() {\n  const db = await getDatabase('MySQL-Test');\n  const results = await db.query('SELECT * FROM users');\n  await exportCSV(results, 'users_export.csv');\n  return { success: true, count: results.length };\n}",
  "database_id": "db-uuid"
}
```

**流程**:
1. AI 生成任务草稿
2. 前端显示预览卡片，用户可编辑
3. 用户确认后，调用 `POST /api/data-ontology/governance/tasks` 创建任务
4. 任务自动加入调度队列

#### 创建交互任务

**用户输入**:
```
@数据治理 @PostgreSQL-Prod 创建一个交互任务，上传 Excel 后写入 orders 表
```

**AI 生成的配置**:
```json
{
  "name": "订单数据导入",
  "type": "interactive",
  "description": "上传 Excel 文件后导入到 orders 表",
  "input_type": "file",
  "accept_exts": [".xlsx", ".xls"],
  "js_code": "async function run(file) {\n  const data = await parseExcel(file);\n  const db = await getDatabase('PostgreSQL-Prod');\n  await db.insertBatch('orders', data);\n  return { success: true, imported: data.length };\n}",
  "database_id": "db-uuid"
}
```

### 与接口分发模块的联动

**用户输入**:
```
@接口分发 @MySQL-Test 创建一个查询用户列表的接口，支持按状态筛选，每页 20 条
```

**AI 生成的配置**:
```json
{
  "name": "获取用户列表",
  "path": "/api/users",
  "method": "GET",
  "description": "查询用户列表，支持状态筛选和分页",
  "sql": "SELECT * FROM users WHERE status = #{status} ORDER BY created_at DESC LIMIT #{limit} OFFSET #{offset}",
  "database_id": "db-uuid",
  "default_params": {
    "status": "active",
    "limit": 20,
    "offset": 0
  }
}
```

**流程**:
1. AI 生成 API 配置
2. 前端显示预览卡片，用户可编辑
3. 用户确认后，调用 `POST /api/data-ontology/apis` 创建接口
4. 接口立即可用：`GET /api/data-ontology/dispatch/api/users?status=active&limit=20&offset=0`

### 与数据质量审核模块的联动

**用户输入**:
```
@质量审核 @MySQL-Test 创建规则检查 users 表的 email 字段格式
```

**AI 生成的配置**:
```json
{
  "nm": "010101",
  "xh": "0101",
  "name": "用户邮箱格式检查",
  "category": "完整性",
  "sql": "SELECT * FROM users WHERE email IS NOT NULL AND email NOT REGEXP '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,4}$'"
}
```

**流程**:
1. AI 生成质量规则
2. 用户确认后创建规则
3. 规则可在质量审核模块中执行，生成审核报告

### 与小模型模块的联动

**用户输入**:
```
@小模型 创建一个数据清洗函数，去除字符串两端的空格，并转换为大写
```

**AI 生成的配置**:
```json
{
  "name": "字符串清洗-去空格转大写",
  "description": "去除字符串两端空格并转换为大写",
  "input_type": "text",
  "output_type": "text",
  "js_code": "async function run(input) {\n  if (typeof input !== 'string') {\n    throw new Error('输入必须是字符串');\n  }\n  return input.trim().toUpperCase();\n}"
}
```

**使用场景**:
- 数据治理任务中调用小模型
- API 接口中调用小模型进行数据转换
- 独立测试小模型功能

### 与本体论模块的联动

**用户输入**:
```
@本体论 @MySQL-Test 分析 users 表和 orders 表的业务关系
```

**AI 分析结果**:
```
从本体论角度分析，users 表和 orders 表之间存在典型的"一对多"关系：

【核心概念】
- 用户（User）：业务主体，具有唯一标识和属性
- 订单（Order）：业务行为，关联到具体用户

【实体关系】
- 一个用户可以拥有多个订单（1:N）
- 订单通过 user_id 外键关联到用户表
- 这种关系体现了"客户-交易"的经典业务模式

【数据治理建议】
1. 确保 user_id 外键约束完整性
2. 考虑在 orders.user_id 上建立索引以提升查询性能
3. 建议添加级联删除策略，防止孤立订单
4. 可考虑添加订单状态机，规范业务流程

【高亮概念】
用户、订单、外键约束、索引优化
```

---

## 数据流与调用链

### 完整调用链

```
用户输入
  ↓
前端 handleSendAiMessage()
  ↓
提取 @ 引用（数据库、模块）
  ↓
合并上下文（aiSessionContext）
  ↓
POST /api/data-ontology/ai/query
  ↓
后端 handleAIQuery()
  ├─ 检查 AI 配置
  ├─ 获取数据库表结构
  ├─ 根据模块路由
  │   ├─ db-manage → handleAIOntologyQuery()
  │   ├─ api-dispatch → handleAICreateApi()
  │   ├─ data-governance → handleAIGovernanceTask()
  │   ├─ quality-audit → handleAIQualityRule()
  │   ├─ small-model → handleAISmallModel()
  │   └─ ontology → handleAIOntologyQuery()
  │
  ├─ 构建提示词
  │   ├─ getModulePromptPrefix()
  │   ├─ formatDBSchemaForPrompt()
  │   └─ buildAIPrompt() / buildRetryPrompt()
  │
  ├─ 调用 AI 服务
  │   └─ callAIService()
  │       ├─ 构建 HTTP 请求
  │       ├─ 发送到 LLM API
  │       └─ 解析响应
  │
  ├─ 处理 AI 响应
  │   ├─ 提取 SQL / 配置
  │   ├─ 检测写入操作
  │   └─ 执行 SQL（如需要）
  │
  └─ 返回 SSE 流式事件
      ├─ start
      ├─ thinking
      ├─ sql_generated / api_config_generated / ...
      ├─ executing（如需执行）
      ├─ success / confirm_write / error
      └─ done
  ↓
前端 handleStreamEvent()
  ├─ 更新 UI 显示
  ├─ 显示 SQL / 配置预览
  ├─ 显示执行结果
  └─ 等待用户确认（写入操作）
  ↓
用户确认（如需要）
  ↓
POST /api/data-ontology/ai/confirm-execute
  ↓
执行 SQL
  ↓
返回结果
  ↓
前端显示最终结果
```

### 数据结构流转

#### 请求结构

```javascript
// 前端发送
{
  "message": "查询 users 表前 10 条",
  "databases": ["db-uuid-1", "db-uuid-2"],
  "modules": ["data-governance"],
  "history": [
    {
      "role": "user",
      "content": "有哪些表？",
      "databases": ["db-uuid-1"],
      "modules": []
    },
    {
      "role": "assistant",
      "content": "数据库包含以下表：users, orders, products",
      "databases": ["db-uuid-1"],
      "modules": []
    }
  ]
}
```

#### 后端处理

```go
// 1. 获取数据库结构
dbSchemas := []map[string]interface{}{
  {
    "name": "MySQL-Test",
    "type": "mysql",
    "id": "db-uuid-1",
    "tables": []map[string]interface{}{
      {
        "name": "users",
        "columns": []map[string]interface{}{
          {"name": "id", "type": "INT AUTO_INCREMENT"},
          {"name": "name", "type": "VARCHAR(100) NOT NULL"},
          {"name": "email", "type": "VARCHAR(255)"},
        },
      },
    },
  },
}

// 2. 构建提示词
prompt := buildAIPrompt(queryReq.Message, dbSchemas, queryReq.Modules)

// 3. 调用 AI
aiResponse := callAIService(aiConfig, prompt)

// 4. 提取 SQL
sql := extractSQLFromAIResponse(aiResponse)

// 5. 执行 SQL
results := executeSQL(dbConfig, sql)

// 6. 返回结果
sendSSE(w, "success", map[string]interface{}{
  "response": aiResponse,
  "sql": sql,
  "results": results,
})
```

#### 响应结构

```javascript
// SSE 事件数据
{
  "event": "success",
  "data": {
    "response": "我将查询 users 表的前 10 条记录。",
    "sql": "SELECT * FROM users LIMIT 10",
    "results": [
      {"id": 1, "name": "Alice", "email": "alice@example.com"},
      {"id": 2, "name": "Bob", "email": "bob@example.com"},
      // ... 8 more rows
    ],
    "insight": "查询返回了 10 条用户记录，数据完整。",
    "confidence": 0.95,
    "attempts": [],
    "retries": 0
  }
}
```

---

## 总结

### 核心特性

1. **智能 SQL 生成**
   - 基于真实数据库结构生成 SQL
   - 支持多种数据库类型（MySQL、PostgreSQL、Oracle、达梦等）
   - 自动检测写入操作，需用户确认
   - 失败自动重试，最多 3 次
   - 反思机制分析结果质量

2. **多模块协同**
   - 统一的 AI 助手入口
   - 通过 @模块名 路由到不同处理逻辑
   - 支持跨模块配置生成

3. **流式响应**
   - SSE 实时推送处理进度
   - 用户可看到 AI 思考过程
   - 提升用户体验

4. **上下文记忆**
   - 记住对话历史（最近 5 轮）
   - 记住数据库和模块上下文
   - 减少重复输入

5. **安全可控**
   - 写入操作需用户确认
   - 权限验证
   - SQL 注入防护

### 技术亮点

1. **提示词工程**
   - 结构化的数据库信息注入
   - 数据库特定规则和警告
   - 错误分类和针对性重试
   - 反思机制提升结果质量

2. **前后端分离**
   - 后端提供 RESTful API
   - 前端无框架依赖
   - SSE 流式通信
   - 易于扩展和维护

3. **模块化设计**
   - 清晰的函数职责划分
   - 可扩展的模块路由
   - 统一的配置管理

### 未来优化方向

1. **性能优化**
   - 缓存数据库结构信息
   - 并行获取多个数据库的结构
   - 优化提示词长度

2. **功能增强**
   - 支持多 SQL 语句执行
   - 支持事务操作
   - 支持更复杂的业务逻辑

3. **用户体验**
   - SQL 编辑器集成
   - 历史查询收藏
   - 查询模板库

4. **安全增强**
   - SQL 审计日志
   - 敏感数据脱敏
   - 细粒度权限控制

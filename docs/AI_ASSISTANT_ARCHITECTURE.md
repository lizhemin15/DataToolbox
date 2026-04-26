# DataToolbox AI 助手模块架构分析文档

> 文档生成日期：2026-04-26
> 代码版本：main 分支（最新提交：fd67479）

---

## 目录

1. [完整实现的功能清单](#1-完整实现的功能清单)
2. [技术架构](#2-技术架构)
3. [与其他模块的联动](#3-与其他模块的联动)
4. [关键函数清单](#4-关键函数清单)
5. [SSE 事件流设计](#5-sse-事件流设计)
6. [AI 能力自适应机制](#6-ai-能力自适应机制)

---

## 1. 完整实现的功能清单

### 1.1 AI 查询（自然语言转 SQL）

**功能描述**：用户通过自然语言提问，AI 自动生成 SQL 并执行查询。

**核心能力**：
- ✅ 自然语言理解与 SQL 生成
- ✅ 多数据库类型支持（MySQL、PostgreSQL、Oracle、达梦、SQLite、SQL Server、MongoDB、ClickHouse、Neo4j 等）
- ✅ 智能重试机制（最多 3 次）
- ✅ SQL 执行错误自动修复
- ✅ 写操作确认机制（INSERT/UPDATE/DELETE 需用户确认）
- ✅ AI 反思与洞察生成
- ✅ 上下文历史管理（最近 5 轮对话）
- ✅ @数据库引用支持
- ✅ 本体关系信息注入

**实现位置**：
- 后端：`server.go:6885-7413` (`handleAIQuery`)
- 前端：`script.js:5118-5250` (`handleSendAiMessage`)

**核心流程**：
```
用户输入 → 意图检测 → 获取表结构 → AI生成SQL → 执行SQL → 返回结果 → AI反思
```

---

### 1.2 AI 接口创建

**功能描述**：通过自然语言描述需求，AI 自动生成 API 配置并创建接口。

**核心能力**：
- ✅ 自然语言转 API 配置（路径、方法、SQL、参数）
- ✅ 智能参数推断与默认值生成
- ✅ SQL 表字段自动提取
- ✅ MyBatis 参数占位符支持（`#{param}` 和 `${param}`）
- ✅ SQL 硬性校验（验证表名和字段名真实存在）
- ✅ SQL 执行校验（实际执行验证语法、权限）
- ✅ default_params 自动填充（从表中查询实际值）
- ✅ 配置预览与编辑
- ✅ 一键创建接口

**实现位置**：
- 后端：`server.go:9490-9662` (`handleAICreateApi`)
- 前端：`script.js:6396-6471` (`confirmCreateApiFromAI`)

**核心流程**：
```
用户描述需求 → AI生成配置 → SQL静态校验 → SQL执行校验 → 填充默认参数 → 用户确认 → 创建接口
```

---

### 1.3 AI 数据治理任务

**功能描述**：通过自然语言创建定时任务或交互任务，自动生成 JavaScript 执行脚本。

**核心能力**：
- ✅ 定时任务创建（Cron 表达式）
- ✅ 交互任务创建（文件上传、文本输入）
- ✅ JavaScript 代码自动生成
- ✅ 任务类型智能识别
- ✅ 数据库关联自动推断
- ✅ 任务草稿预览与编辑

**实现位置**：
- 后端：`server.go:9309-9359` (`handleAIGovernanceTask`)
- 前端：`script.js:6483-6534` (`confirmCreateGovTaskFromAI`)

**支持的任务类型**：
- `scheduled`：定时任务，需设置 `cron_expr`
- `interactive`：交互任务，需设置 `input_type` 和 `accept_exts`

---

### 1.4 AI 质量审核规则

**功能描述**：通过自然语言创建数据质量审核规则。

**核心能力**：
- ✅ 规则编号、名称、描述自动生成
- ✅ SQL 校验语句生成
- ✅ 规则类型识别
- ✅ 规则草稿预览

**实现位置**：
- 后端：`server.go:9359-9430` (`handleAIQualityRule`)
- 前端：`script.js:6092-6157` (quality_rule_draft 事件处理)

---

### 1.5 AI 小模型创建

**功能描述**：创建基于 JavaScript 的小模型任务，用于本地数据处理。

**核心能力**：
- ✅ 小模型配置生成
- ✅ 输入/输出类型推断
- ✅ 数据库关联
- ✅ JS 代码生成

**实现位置**：
- 后端：`server.go:9430-9490` (`handleAISmallModel`)
- 前端：`script.js:6158-6190` (small_model_draft 事件处理)

---

### 1.6 AI 本体论查询

**功能描述**：基于本体论知识图谱进行语义查询。

**核心能力**：
- ✅ 本体关系查询
- ✅ 概念实体关联分析
- ✅ 语义理解与推理
- ✅ 概念高亮标记

**实现位置**：
- 后端：`server.go:8898-8934` (`handleAIOntologyQuery`)

---

### 1.7 AI 代码生成

**功能描述**：为数据治理任务生成入库代码。

**核心能力**：
- ✅ Excel/CSV 数据导入代码生成
- ✅ 列映射自动推断
- ✅ 数据库类型适配
- ✅ 支持多种数据源（Excel、CSV文件、CSV文本）

**实现位置**：
- 后端：`server.go:8619-8714` (`handleAICodegen`)
- 前端：`script.js:8149-8226` (`generateImportCodeWithAI`)

---

### 1.8 AI 通用补全

**功能描述**：供治理任务等模块调用的通用 AI 补全接口。

**核心能力**：
- ✅ 文本补全
- ✅ 结构化数据生成
- ✅ 多场景适配

**实现位置**：
- 后端：`server.go:9007-9042` (`handleAICompletion`)

---

### 1.9 意图检测与路由

**功能描述**：自动识别用户意图并路由到相应处理模块。

**核心能力**：
- ✅ 关键词意图检测（高置信度）
- ✅ AI 意图分类（低置信度场景）
- ✅ 双重检测机制（关键词 + AI）
- ✅ 意图选择卡片交互

**支持的操作类型**：
| 模块 ID | 名称 | 描述 |
|---------|------|------|
| `db-manage` | 通用提问 | 查询数据、统计信息、了解表结构等 |
| `api-dispatch` | 接口制作 | 创建 API 接口、生成数据服务 |
| `data-governance` | 数据治理 | 创建定时任务、数据导入导出 |
| `quality-audit` | 质量审计 | 数据质量检查、校验规则 |
| `ontology` | 本体查询 | 概念关系、语义分析 |
| `small-model` | 小模型 | 本地模型、离线推理 |

**实现位置**：
- 后端：`server.go:9061-9201` (`detectUserIntent`, `detectIntentWithAI`)
- 前端：`script.js:5966-6010` (intent_selection_required 事件处理)

---

### 1.10 功能依赖关系

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI 查询核心流程                           │
│                     handleAIQuery (6885)                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
            ▼               ▼               ▼
    ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
    │ 意图检测       │ │ 表结构获取     │ │ AI调用        │
    │ detectUser    │ │ getTablesList  │ │ callAIService │
    │ Intent (9061) │ │ getTableColumns│ │ WithCapabili- │
    │ detectIntent  │ │ (7004-7057)    │ │ ties (8082)   │
    │ WithAI (9125) │ │               │ │               │
    └───────┬───────┘ └───────┬───────┘ └───────┬───────┘
            │                 │                 │
            └─────────────────┼─────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
            ▼                 ▼                 ▼
    ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
    │ 接口创建       │ │ 数据治理       │ │ 质量规则      │
    │ handleAI      │ │ handleAI      │ │ handleAI      │
    │ CreateApi     │ │ Governance    │ │ QualityRule   │
    │ (9490)        │ │ Task (9309)   │ │ (9359)        │
    └───────────────┘ └───────────────┘ └───────────────┘
```

---

## 2. 技术架构

### 2.1 后端架构

#### 2.1.1 核心数据结构

```go
// AIConfig AI配置 (server.go:892-903)
type AIConfig struct {
    URL                   string `json:"url"`
    APIKey                string `json:"api_key"`
    Model                 string `json:"model"`
    Timeout               int    `json:"timeout"`                           // 超时时间（秒），默认120
    EnableFunctionCall    *bool  `json:"enable_function_call,omitempty"`    // 手动开关
    EnableThinking        *bool  `json:"enable_thinking,omitempty"`         // 手动开关
    EnableStreaming       *bool  `json:"enable_streaming,omitempty"`        // 手动开关
    EnableJSONMode        *bool  `json:"enable_json_mode,omitempty"`        // 手动开关
    ContextWindowOverride int    `json:"context_window_override,omitempty"` // 手动指定上下文窗口
}

// AICapabilities AI模型能力检测结果 (server.go:905-915)
type AICapabilities struct {
    SupportsFunctionCall bool  `json:"supports_function_call"` // 是否支持 function call
    SupportsThinking     bool  `json:"supports_thinking"`      // 是否支持 extended thinking
    SupportsStreaming    bool  `json:"supports_streaming"`     // 是否支持流式输出
    ContextWindow        int   `json:"context_window"`         // 上下文窗口大小
    SupportsJSONMode     bool  `json:"supports_json_mode"`     // 是否支持 JSON 输出模式
    DetectedAt           int64 `json:"detected_at"`            // 检测时间戳
}

// AIQueryRequest AI查询请求 (server.go:917-922)
type AIQueryRequest struct {
    Message   string                   `json:"message"`
    Databases []string                 `json:"databases"`
    Modules   []string                 `json:"modules,omitempty"`
    History   []map[string]interface{} `json:"history,omitempty"`
}

// IntentInfo 意图检测结果 (server.go:9055-9059)
type IntentInfo struct {
    DetectedModule string  `json:"detected_module"`
    Confidence     float64 `json:"confidence"`
    Reason         string  `json:"reason"`
}
```

#### 2.1.2 后端模块路由

```
HTTP 请求
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ handleAIQuery (6885)                                        │
│ - 设置 SSE 响应头                                            │
│ - 检查 AI 配置                                               │
│ - 检测 AI 能力                                               │
│ - 获取数据库表结构                                           │
│ - 意图检测与路由                                             │
└───────────────────────────┬─────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ api-dispatch  │   │data-governance│   │ quality-audit │
│ handleAI      │   │ handleAI      │   │ handleAI      │
│ CreateApi     │   │ Governance    │   │ QualityRule   │
│ (9490)        │   │ Task (9309)   │   │ (9359)        │
└───────────────┘   └───────────────┘   └───────────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ small-model   │   │ ontology      │   │ db-manage     │
│ handleAI      │   │ handleAI      │   │ SQL生成执行   │
│ SmallModel    │   │ OntologyQuery │   │ (7155-7403)   │
│ (9430)        │   │ (8898)        │   │               │
└───────────────┘   └───────────────┘   └───────────────┘
```

#### 2.1.3 SQL 生成与执行流程

```
buildAIPrompt (7851)
    │
    │ 构建包含表结构信息的提示词
    │
    ▼
callAIServiceWithCapabilities (8082)
    │
    │ 调用 AI 服务
    │
    ▼
cleanAIResponse (8028)
    │
    │ 清理 AI 响应（去除代码块标记）
    │
    ▼
parseAIResponse (10858)
    │
    │ 解析 SQL、目标数据库、回复文本
    │
    ▼
isWriteOperation (6394)
    │
    │ 检测是否为写操作
    │
    ├── 是 → sendSSE("confirm_write") → 用户确认
    │
    └── 否 → executeSQLQuery → 返回结果
                                        │
                                        ▼
                              buildReflectionPrompt (7812)
                                        │
                                        │ AI 反思
                                        │
                                        ▼
                              parseReflectionResponse (7740)
                                        │
                                        ▼
                              sendSSE("success")
```

---

### 2.2 前端架构

#### 2.2.1 核心数据结构

```javascript
// AI 配置 (script.js:54)
let aiConfig = null;

// AI 能力检测结果 (script.js:55)
let aiCapabilities = null;

// AI 模块列表 (script.js:60-65)
const aiModules = [
    { id: 'db-manage', name: '数据库管理', icon: '🗄️', description: '管理数据库连接与表结构' },
    { id: 'api-dispatch', name: '接口分发', icon: '🔌', description: '统一分发和调用数据接口' },
    { id: 'data-governance', name: '数据治理', icon: '🧽', description: '治理规则、质量与权限管理' },
    { id: 'ontology', name: '本体论抽象', icon: '📐', description: '从数据中抽象业务本体' },
];

// AI 会话上下文 (script.js:67-71)
let aiSessionContext = {
    databases: [],  // 当前上下文数据库
    modules: [],    // 当前上下文模块
    history: []     // 对话历史（最近 5 条）
};
```

#### 2.2.2 前端事件流

```
用户输入消息
    │
    ▼
handleSendAiMessage (5118)
    │
    ├── 提取 @ 引用（数据库、模块）
    │
    ├── 更新 aiSessionContext
    │
    ├── 记录历史
    │
    └── 建立 SSE 连接
            │
            ▼
    流式读取响应
            │
            ├── 解析 SSE 事件
            │
            └── handleStreamEvent (5680)
                    │
                    ├── start → 显示加载动画
                    ├── thinking → 显示思考状态
                    ├── sql_generated → 显示 SQL
                    ├── executing → 显示执行状态
                    ├── success → 显示结果
                    ├── confirm_write → 显示确认对话框
                    ├── error → 显示错误
                    ├── database_selection_required → 显示数据库选择卡片
                    ├── intent_selection_required → 显示意图选择卡片
                    ├── api_config_generated → 显示 API 配置预览
                    ├── governance_task_draft → 显示治理任务草稿
                    ├── quality_rule_draft → 显示质量规则草稿
                    └── done → 完成处理
```

#### 2.2.3 前端状态管理

```
┌─────────────────────────────────────────────────────────────┐
│                    aiSessionContext                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ databases   │  │ modules     │  │ history             │  │
│  │ [db1, db2]  │  │ [module1]   │  │ [msg1, msg2, ...]   │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │                   │                   │
         │                   │                   │
         ▼                   ▼                   ▼
    数据库选择          模块路由           多轮对话上下文
    (10876)            (意图检测)          (最近5轮)
```

---

### 2.3 AI 调用机制

#### 2.3.1 AI 能力检测流程

```
detectAICapabilities (8184)
    │
    ├── 优先使用手动设置
    │   ├── EnableFunctionCall
    │   ├── EnableThinking
    │   ├── EnableStreaming
    │   ├── EnableJSONMode
    │   └── ContextWindowOverride
    │
    ├── 测试基本连通性
    │
    ├── 测试 Function Call 支持
    │   └── 发送带 tools 定义的请求
    │
    ├── 测试 Streaming 支持
    │   └── 发送 stream: true 的请求
    │
    ├── 测试 JSON Mode 支持
    │   └── 发送 response_format: {type: "json_object"} 的请求
    │
    ├── 推断上下文窗口大小
    │   ├── GPT-4-Turbo/GPT-4o: 128000
    │   ├── GPT-4-32k: 32768
    │   ├── GPT-4: 8192
    │   ├── Claude-3: 200000
    │   ├── Claude-2: 100000
    │   └── Qwen: 32768
    │
    └── 推断 Thinking 支持
        └── Claude-3.5, O1, DeepSeek-Reasoner
```

#### 2.3.2 AI 服务调用流程

```
callAIServiceWithCapabilities (8082)
    │
    ├── 构建请求体
    │   ├── model
    │   ├── messages
    │   ├── temperature: 0.1
    │   │
    │   ├── 如果支持 JSON Mode 且需要 JSON 输出
    │   │   └── response_format: {type: "json_object"}
    │   │
    │   └── 如果支持 Thinking
    │       └── 预留 thinking 参数
    │
    ├── 设置请求头
    │   ├── Content-Type: application/json
    │   └── Authorization: Bearer {api_key}
    │
    ├── 发送 HTTP 请求（超时：配置值或 120 秒）
    │
    └── 解析响应
        ├── 检查状态码
        ├── 提取 choices[0].message.content
        └── 返回内容
```

---

### 2.4 SSE 流式传输实现

#### 2.4.1 后端 SSE 发送

```go
// sendSSE 发送 SSE 事件 (server.go:6483)
func sendSSE(w http.ResponseWriter, eventType string, data interface{}) {
    jsonData, _ := json.Marshal(data)
    fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventType, jsonData)
    if flusher, ok := w.(http.Flusher); ok {
        flusher.Flush()
    }
}
```

**SSE 格式示例**：
```
event: thinking
data: {"message":"正在分析您的问题并生成SQL..."}

event: sql_generated
data: {"attempt":1,"response":"已为您执行查询","sql":"SELECT * FROM users WHERE status = 'active'"}

event: success
data: {"response":"已为您执行查询","sql":"SELECT * FROM users WHERE status = 'active'","results":[...],"insight":"查询返回了所有活跃用户","confidence":0.95}
```

#### 2.4.2 前端 SSE 接收

```javascript
// script.js:5214-5250
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

---

## 3. 与其他模块的联动

### 3.1 与数据库管理模块的联动

**联动方式**：
1. **数据库选择**：AI 查询时自动获取用户可访问的数据库列表
2. **表结构读取**：AI 生成 SQL 时读取表结构信息（表名、字段、类型、注释）
3. **SQL 执行**：AI 生成的 SQL 在指定数据库上执行
4. **权限控制**：AI 只能访问用户有权限的数据库

**关键函数**：
| 函数 | 位置 | 说明 |
|------|------|------|
| `getTablesList` | server.go | 获取表列表 |
| `getTableColumns` | server.go | 获取表字段信息 |
| `executeSQLQuery` | server.go | 执行 SQL 查询 |

**数据流**：
```
AI 查询请求
    │
    ▼
获取用户可访问的数据库列表
    │
    ▼
读取表结构信息（最多 15 张表）
    │
    ▼
构建 AI Prompt（包含表结构）
    │
    ▼
AI 生成 SQL
    │
    ▼
在指定数据库上执行 SQL
    │
    ▼
返回结果
```

**本体关系注入** (server.go:7041-7047)：
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

---

### 3.2 与接口分发模块的联动

**联动方式**：
1. **API 配置生成**：AI 根据自然语言生成 API 配置
2. **SQL 验证**：验证 AI 生成的 SQL 是否有效
3. **参数推断**：从 SQL 中提取参数并推断默认值
4. **一键创建**：用户确认后直接创建 API

**关键函数**：
| 函数 | 位置 | 说明 |
|------|------|------|
| `handleAICreateApi` | server.go:9490 | AI 创建接口 |
| `parseApiConfigFromAI` | server.go:9812 | 解析 AI 生成的配置 |
| `validateSQLTablesAndFields` | server.go:10175 | 验证 SQL 表和字段 |
| `validateSQLByExecution` | server.go:10320 | 执行校验 SQL |
| `populateDefaultParamsFromDB` | server.go:10554 | 从数据库填充默认参数 |

**SQL 校验机制** (server.go:9591-9643)：
```go
// 校验SQL中的表名和字段名是否存在
sqlStr, _ := apiConfig["sql"].(string)
if sqlStr != "" && len(dbSchemas) > 0 {
    // 静态校验：检查表名和字段名
    valid, validationError := validateSQLTablesAndFields(sqlStr, dbSchemas)
    if !valid {
        // 验证失败，构建重试提示词
        if attempt < maxRetries {
            prompt = buildCreateApiRetryPrompt(queryReq.Message, dbSchemas, validationError, aiResponse)
            continue
        }
        // 最后一次尝试仍然失败
        sendSSE(w, "sql_validation_error", map[string]interface{}{...})
        return
    }

    // 执行校验：在目标数据库上实际执行SQL
    validExec, execError := validateSQLByExecution(sqlStr, dbID)
    if !validExec {
        // 执行校验失败，构建重试提示词
        ...
    }
}
```

**default_params 自动填充** (server.go:9649-9653)：
```go
// 从数据库表中查询实际值填充 default_params
if len(dbSchemas) > 0 {
    dbID, _ := dbSchemas[0]["id"].(string)
    populateDefaultParamsFromDB(apiConfig, dbID)
}
```

---

### 3.3 与数据治理模块的联动

**联动方式**：
1. **任务创建**：AI 根据自然语言创建定时任务或交互任务
2. **代码生成**：AI 生成 JavaScript 执行脚本
3. **Cron 推断**：AI 推断定时任务的 Cron 表达式
4. **数据库关联**：AI 自动关联任务与数据库

**关键函数**：
| 函数 | 位置 | 说明 |
|------|------|------|
| `handleAIGovernanceTask` | server.go:9309 | AI 创建治理任务 |
| `buildGovernanceTaskPrompt` | server.go:9234 | 构建治理任务提示词 |
| `parseGovernanceTaskDraft` | server.go:9261 | 解析治理任务草稿 |

**治理任务约束** (server.go:9235-9243)：
```
【数据治理任务约束】
1. 任务类型 type 只能是 "scheduled"（定时任务）或 "interactive"（交互任务）
2. 定时任务：必须包含 cron_expr，格式为 "分 时 日 月 周"
3. 交互任务：必须包含 input_type（"file" | "text" | "both"）和 accept_exts
4. js_code 必须是可运行的 JavaScript 代码
5. 输出 JSON 字段：name、type、description、js_code、database_id、cron_expr、input_type、accept_exts
```

---

### 3.4 与质量审核模块的联动

**联动方式**：
1. **规则创建**：AI 根据自然语言创建质量审核规则
2. **SQL 生成**：AI 生成校验 SQL
3. **规则类型识别**：AI 识别规则类型

**关键函数**：
| 函数 | 位置 | 说明 |
|------|------|------|
| `handleAIQualityRule` | server.go:9359 | AI 创建质量规则 |

---

### 3.5 与本体论模块的联动

**联动方式**：
1. **本体关系管理**：用户可以在本体论模块中管理本体关系
2. **AI 自动使用**：AI 助手自动使用这些关系生成更准确的 SQL
3. **语义查询**：用户可以用自然语言查询本体论知识图谱

**关键函数**：
| 函数 | 位置 | 说明 |
|------|------|------|
| `handleAIOntologyQuery` | server.go:8898 | AI 本体论查询 |
| `handleOntologySemanticQuery` | server.go:8936 | 本体论语义查询 |

---

## 4. 关键函数清单

### 4.1 后端核心函数

#### 4.1.1 AI 查询相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `handleAIQuery` | server.go:6885-7413 | AI 查询主处理函数 |
| `handleAIConfirmExecute` | server.go:7416-7739 | 用户确认后的写操作执行 |
| `buildAIPrompt` | server.go:7851-7905 | 构建 AI 提示词 |
| `buildRetryPrompt` | server.go:7907-8027 | 构建重试提示词 |
| `cleanAIResponse` | server.go:8028-8064 | 清理 AI 响应 |
| `extractJSONObject` | server.go:8066-8074 | 提取 JSON 对象 |
| `parseAIResponse` | server.go:10858-10958 | 解析 AI 响应 |

#### 4.1.2 AI 能力检测相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `detectAICapabilities` | server.go:8184-8561 | 检测 AI 模型能力 |
| `callAIService` | server.go:8077-8079 | 调用 AI 服务 |
| `callAIServiceWithCapabilities` | server.go:8082-8167 | 根据能力自适应调用 AI 服务 |
| `testBasicConnectivity` | server.go | 测试基本连通性 |
| `testFunctionCall` | server.go | 测试 Function Call 支持 |
| `testStreaming` | server.go | 测试 Streaming 支持 |
| `testJSONMode` | server.go | 测试 JSON Mode 支持 |

#### 4.1.3 意图检测相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `detectUserIntent` | server.go:9061-9122 | 关键词意图检测 |
| `detectIntentWithAI` | server.go:9125-9201 | AI 意图分类 |

#### 4.1.4 接口创建相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `handleAICreateApi` | server.go:9490-9662 | AI 创建接口 |
| `buildCreateApiPrompt` | server.go:9664-9733 | 构建创建接口的提示词 |
| `buildCreateApiRetryPrompt` | server.go:9735-9808 | 构建重试提示词 |
| `parseApiConfigFromAI` | server.go:9812-9908 | 解析 AI 生成的配置 |
| `validateSQLTablesAndFields` | server.go:10175-10319 | 验证 SQL 表和字段 |
| `validateSQLByExecution` | server.go:10320-10515 | 执行校验 SQL |
| `populateDefaultParamsFromDB` | server.go:10554-10613 | 从数据库填充默认参数 |
| `extractTableNamesFromSQL` | server.go:10614-10689 | 从 SQL 中提取表名 |
| `findParamTableAndField` | server.go:10690-10774 | 查找参数对应的表和字段 |
| `queryActualValueFromTable` | server.go:10775-10857 | 从表中查询实际值 |
| `isNonConditionParam` | server.go:10516-10553 | 检查是否为非条件参数 |

#### 4.1.5 数据治理相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `handleAIGovernanceTask` | server.go:9309-9359 | AI 创建治理任务 |
| `buildGovernanceTaskPrompt` | server.go:9234-9260 | 构建治理任务提示词 |
| `parseGovernanceTaskDraft` | server.go:9261-9308 | 解析治理任务草稿 |

#### 4.1.6 质量规则相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `handleAIQualityRule` | server.go:9359-9430 | AI 创建质量规则 |

#### 4.1.7 小模型相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `handleAISmallModel` | server.go:9430-9490 | AI 创建小模型 |

#### 4.1.8 本体论相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `handleAIOntologyQuery` | server.go:8898-8934 | AI 本体论查询 |
| `handleOntologySemanticQuery` | server.go:8936-9004 | 本体论语义查询 |

#### 4.1.9 代码生成相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `handleAICodegen` | server.go:8619-8714 | AI 代码生成 |

#### 4.1.10 通用补全相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `handleAICompletion` | server.go:9007-9042 | AI 通用补全 |

#### 4.1.11 反思机制相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `buildReflectionPrompt` | server.go:7812-7850 | 构建反思提示词 |
| `parseReflectionResponse` | server.go:7740-7761 | 解析反思响应 |

#### 4.1.12 工具函数

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `sendSSE` | server.go:6483-6491 | 发送 SSE 事件 |
| `isWriteOperation` | server.go:6394-6482 | 检测是否为写操作 |
| `truncateResultsForAI` | server.go:7762-7811 | 截断结果用于 AI |
| `truncateHistoryForContext` | server.go:8562-8595 | 根据上下文窗口截断历史 |

---

### 4.2 前端核心函数

#### 4.2.1 消息发送相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `handleSendAiMessage` | script.js:5118-5250 | 发送 AI 消息 |
| `handleStreamEvent` | script.js:5680-6190 | 处理 SSE 流式事件 |

#### 4.2.2 数据库选择相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `selectDatabaseAndRetry` | script.js:10876-10960 | 选择数据库并重试 |

#### 4.2.3 意图选择相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `selectIntentAndRetry` | script.js:10961-11050 | 选择意图并重试 |

#### 4.2.4 接口创建相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `confirmCreateApiFromAI` | script.js:6396-6471 | 确认创建 API |
| `cancelCreateApiFromAI` | script.js:6471-6482 | 取消创建 API |

#### 4.2.5 治理任务相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `confirmCreateGovTaskFromAI` | script.js:6483-6534 | 确认创建治理任务 |
| `cancelGovTaskDraft` | script.js:6534-6545 | 取消治理任务草稿 |

#### 4.2.6 SQL 执行相关

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `executeConfirmedSQL` | script.js:5555-5602 | 执行确认的 SQL |
| `cancelConfirmedSQL` | script.js:5596-5615 | 取消确认的 SQL |

#### 4.2.7 工具函数

| 函数名 | 位置 | 说明 |
|--------|------|------|
| `formatAIText` | script.js:6269-6395 | 格式化 AI 文本 |
| `finalizeAiProcess` | script.js:5673-5679 | 完成 AI 处理 |
| `setAiProcessCollapsed` | script.js:5659-5672 | 设置折叠状态 |
| `generateImportCodeWithAI` | script.js:8149-8226 | 使用 AI 生成导入代码 |

---

## 5. SSE 事件流设计

### 5.1 事件类型详解

| 事件类型 | 说明 | 数据字段 |
|---------|------|---------|
| `start` | 开始处理 | `message` |
| `thinking` | 思考中 | `message` |
| `sql_generated` | SQL 已生成 | `attempt`, `response`, `sql` |
| `executing` | 执行中 | `message` |
| `success` | 成功 | `response`, `sql`, `results`, `insight`, `confidence`, `attempts`, `retries` |
| `confirm_write` | 确认写操作 | `response`, `sql`, `dbId`, `attempts`, `retries` |
| `error` | 错误 | `message`, `response`, `attempts` |
| `retry` | 重试 | `message`, `attempt`, `error` |
| `attempt_failed` | 尝试失败 | `attempt`, `error`, `sql` |
| `database_selection_required` | 需要选择数据库 | `message`, `databases`, `user_query` |
| `intent_selection_required` | 需要选择意图 | `message`, `intents`, `user_query`, `detected` |
| `api_config_generated` | API 配置已生成 | `message`, `config` |
| `governance_task_draft` | 治理任务草稿 | `message`, `task` |
| `quality_rule_draft` | 质量规则草稿 | `message`, `rule` |
| `small_model_draft` | 小模型草稿 | `message`, `model` |
| `sql_validation_error` | SQL 校验失败 | `message`, `sql`, `response` |
| `answer` | 直接回答（本体论查询） | `text`, `highlighted` |
| `done` | 完成 | 无 |

### 5.2 事件流程图

```
用户发送消息
    │
    ▼
[start] 开始处理
    │
    ▼
[thinking] 正在读取数据库表结构信息
    │
    ▼
[thinking] 正在分析您的问题并生成SQL
    │
    ▼
[sql_generated] SQL 已生成
    │
    ├── 写操作？
    │   │
    │   └── [confirm_write] 检测到写入操作，请确认
    │           │
    │           └── 用户确认 → [executing] → [success]
    │
    └── 读操作
        │
        ▼
[executing] 正在执行SQL查询
    │
    ├── 成功
    │   │
    │   └── [success] 查询成功，返回结果
    │           │
    │           └── [done] 完成
    │
    └── 失败
        │
        ▼
[attempt_failed] 第N次失败：SQL执行失败
    │
    ▼
[retry] 第N次重试，正在根据错误调整SQL
    │
    └── 返回 sql_generated
```

### 5.3 重试流程

```
[sql_generated] SQL 已生成
    │
    ▼
[executing] 正在执行SQL查询
    │
    ▼
[attempt_failed] 第1次失败：SQL执行失败
    │
    ▼
[retry] 第2次重试，正在根据错误调整SQL
    │
    ▼
[sql_generated] SQL 已生成
    │
    ▼
[executing] 正在执行SQL查询
    │
    ▼
[success] 查询成功
```

---

## 6. AI 能力自适应机制

### 6.1 自适应策略

#### 6.1.1 JSON Mode 自适应

```go
// 如果支持 JSON Mode 且 prompt 要求 JSON 输出，启用 JSON Mode
if capabilities != nil && capabilities.SupportsJSONMode {
    if strings.Contains(prompt, "JSON") || strings.Contains(prompt, "json") ||
        strings.Contains(prompt, "返回JSON") || strings.Contains(prompt, "格式如下") {
        requestBody["response_format"] = map[string]string{"type": "json_object"}
    }
}
```

#### 6.1.2 上下文窗口自适应

```go
// 根据上下文窗口大小截断对话历史
if aiCapabilities != nil && aiCapabilities.ContextWindow > 0 {
    // 为当前prompt和响应预留一半的上下文空间
    maxHistoryTokens := aiCapabilities.ContextWindow / 2
    queryReq.History = truncateHistoryForContext(queryReq.History, maxHistoryTokens)
}
```

#### 6.1.3 Thinking 自适应

```go
// 如果支持 Extended Thinking，预留参数
if capabilities != nil && capabilities.SupportsThinking {
    // 可以在这里添加thinking相关的参数
    // 例如对于某些模型可以添加: requestBody["thinking"] = map[string]interface{}{...}
}
```

### 6.2 模型兼容性

| 模型 | 上下文窗口 | Function Call | Streaming | JSON Mode | Thinking |
|------|-----------|---------------|-----------|-----------|----------|
| GPT-4-Turbo | 128K | ✓ | ✓ | ✓ | ✗ |
| GPT-4o | 128K | ✓ | ✓ | ✓ | ✗ |
| GPT-4 | 8K | ✓ | ✓ | ✓ | ✗ |
| GPT-3.5-Turbo | 4K/16K | ✓ | ✓ | ✓ | ✗ |
| Claude-3 | 200K | ✓ | ✓ | ✓ | ✓ (3.5) |
| Claude-2 | 100K | ✓ | ✓ | ✓ | ✗ |
| Qwen | 32K | ✓ | ✓ | ✓ | ✗ |
| O1 | - | ✓ | ✓ | ✓ | ✓ |
| DeepSeek-Reasoner | - | ✓ | ✓ | ✓ | ✓ |

### 6.3 降级策略

#### 6.3.1 能力检测失败降级

```go
aiCapabilities = &AICapabilities{
    SupportsFunctionCall: false,
    SupportsThinking:     false,
    SupportsStreaming:    true,
    ContextWindow:        4096,
    SupportsJSONMode:     false,
}
```

#### 6.3.2 AI 调用失败降级

1. **重试机制**：最多重试 3 次
2. **错误反馈**：将错误信息反馈给 AI，让其调整 SQL
3. **重复检测**：检测 AI 是否生成已失败的相同 SQL，避免无限循环

#### 6.3.3 JSON Mode 降级

```go
func extractJSONObject(s string) string {
    s = cleanAIResponse(s)
    start := strings.Index(s, "{")
    end := strings.LastIndex(s, "}")
    if start >= 0 && end > start {
        return strings.TrimSpace(s[start : end+1])
    }
    return ""
}
```

---

## 附录

### A. API 端点列表

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/data-ontology/ai/config` | GET/POST | AI 配置管理 |
| `/api/data-ontology/ai/capabilities` | GET | 获取 AI 能力 |
| `/api/data-ontology/ai/query` | POST | AI 查询（SSE） |
| `/api/data-ontology/ai/confirm-execute` | POST | 确认执行写操作 |
| `/api/data-ontology/ai/codegen` | POST | AI 代码生成 |
| `/api/data-ontology/ai/completion` | POST | AI 通用补全 |

### B. 错误码说明

| 错误类型 | 说明 | 处理方式 |
|---------|------|---------|
| `AI配置不完整` | URL/API Key/Model 未配置 | 提示用户配置 |
| `AI服务调用失败` | 网络错误或 API 错误 | 重试或降级 |
| `SQL执行失败` | SQL 语法错误或权限错误 | AI 重试生成 |
| `权限不足` | 数据库权限错误 | 停止重试，提示用户 |
| `超时` | 查询超时 | 提示简化查询 |
| `未找到有效的数据库` | 数据库不存在或无权限 | 提示用户检查 |

### C. 配置示例

#### C.1 OpenAI 配置

```json
{
  "url": "https://api.openai.com/v1/chat/completions",
  "api_key": "sk-...",
  "model": "gpt-4-turbo",
  "timeout": 120
}
```

#### C.2 Claude 配置

```json
{
  "url": "https://api.anthropic.com/v1/messages",
  "api_key": "sk-ant-...",
  "model": "claude-3-sonnet-20240229",
  "timeout": 120
}
```

#### C.3 Ollama 配置

```json
{
  "url": "http://localhost:11434/v1/chat/completions",
  "api_key": "ollama",
  "model": "qwen2.5:32b",
  "timeout": 120
}
```

---

## 总结

DataToolbox 的 AI 助手模块是一个功能完整、架构清晰、扩展性强的智能数据管理助手。通过自然语言交互，用户可以轻松完成数据查询、接口创建、数据治理等复杂任务，大大降低了数据管理的门槛。

**核心优势**：
1. **智能化**：自动意图检测、SQL 生成、错误修复
2. **自适应**：根据模型能力自动调整调用策略
3. **安全性**：写操作确认、权限控制、SQL 验证
4. **易用性**：自然语言交互、流式响应、实时反馈
5. **扩展性**：模块化设计、易于添加新功能

**核心亮点**：
- **完整的 AI 能力检测机制**（实际 API 调用试错）
- **SQL 硬性校验机制**（验证表名和字段名真实存在）
- **default_params 自动填充机制**（从表中取实际值）
- **本体关系信息注入**（帮助 AI 理解表间字段关联）
- **智能重试和反思机制**（提升 SQL 生成质量）
- **双重意图检测**（关键词 + AI 分类）

**适用场景**：
- 数据分析师：快速查询数据，无需编写复杂 SQL
- 开发人员：快速创建 API 接口
- DBA：创建定时任务，进行数据治理
- 业务人员：了解数据结构，进行数据质量审核

---

**文档维护**：本文档基于代码分析生成，如有更新请同步修改。

# DataToolbox AI 助手模块技术文档

> 文档生成日期：2026-04-26
> 代码版本：main 分支（最新提交：fd67479）

---

## 目录

1. [功能清单](#1-功能清单)
2. [技术架构](#2-技术架构)
3. [与其他模块的联动](#3-与其他模块的联动)
4. [关键配置项](#4-关键配置项)
5. [SSE 事件流设计](#5-sse-事件流设计)
6. [AI 能力自适应机制](#6-ai-能力自适应机制)

---

## 1. 功能清单

### 1.1 AI 查询（自然语言转 SQL）

**功能描述**：用户通过自然语言提问，AI 自动生成 SQL 并执行查询。

**核心能力**：
- ✅ 自然语言理解与 SQL 生成
- ✅ 多数据库类型支持（MySQL、PostgreSQL、Oracle、达梦、SQLite、SQL Server、MongoDB）
- ✅ 智能重试机制（最多 3 次）
- ✅ SQL 执行错误自动修复
- ✅ 写操作确认机制（INSERT/UPDATE/DELETE 需用户确认）
- ✅ AI 反思与洞察生成
- ✅ 上下文历史管理（最近 5 轮对话）
- ✅ @数据库引用支持

**实现位置**：
- 后端：`server.go:6885-7416` (`handleAIQuery`)
- 前端：`script.js:5118-5250` (`handleSendAiMessage`)

---

### 1.2 AI 接口创建

**功能描述**：通过自然语言描述需求，AI 自动生成 API 配置并创建接口。

**核心能力**：
- ✅ 自然语言转 API 配置（路径、方法、SQL、参数）
- ✅ 智能参数推断与默认值生成
- ✅ SQL 表字段自动提取
- ✅ MyBatis 参数占位符支持
- ✅ 配置预览与编辑
- ✅ 一键创建接口

**实现位置**：
- 后端：`server.go:9490-9665` (`handleAICreateApi`)
- 前端：`script.js:6357-6481` (`confirmCreateApiFromAI`)

**示例请求**：
```
用户：帮我创建一个查询用户信息的接口，根据用户ID查询
AI：生成接口配置 → 路径: /api/user/{id}, 方法: GET, SQL: SELECT * FROM users WHERE id = ?
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
- 前端：`script.js:6483-6581` (`confirmCreateGovTaskFromAI`)

**示例请求**：
```
用户：创建一个定时任务，每天凌晨2点统计所有表的行数
AI：生成任务配置 → 类型: scheduled, Cron: 0 2 * * *, JS代码: ...
```

---

### 1.4 AI 质量审核规则

**功能描述**：通过自然语言创建数据质量审核规则。

**核心能力**：
- ✅ 规则编号、名称、描述自动生成
- ✅ SQL 校验语句生成
- ✅ 规则类型识别
- ✅ 规则草稿预览

**实现位置**：
- 后端：`server.go:9359-9429` (`handleAIQualityRule`)
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
- 后端：`server.go:9430-9489` (`handleAISmallModel`)
- 前端：`script.js:6158-6190` (small_model_draft 事件处理)

---

### 1.6 AI 本体论查询

**功能描述**：基于本体论知识图谱进行语义查询。

**核心能力**：
- ✅ 本体关系查询
- ✅ 概念实体关联分析
- ✅ 语义理解与推理

**实现位置**：
- 后端：`server.go:8898-8936` (`handleAIOntologyQuery`)

---

### 1.7 AI 代码生成

**功能描述**：为数据治理任务生成入库代码。

**核心能力**：
- ✅ Excel/CSV 数据导入代码生成
- ✅ 列映射自动推断
- ✅ 数据库类型适配

**实现位置**：
- 后端：`server.go:8619-8733` (`handleAICodegen`)
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
1. `api-dispatch` - 接口创建
2. `data-governance` - 数据治理
3. `quality-audit` - 质量审计
4. `ontology` - 本体查询
5. `small-model` - 小模型
6. `db-manage` - 通用查询

**实现位置**：
- 后端：`server.go:9061-9201` (`detectUserIntent`, `detectIntentWithAI`)
- 前端：`script.js:5966-6010` (intent_selection_required 事件处理)

---

## 2. 技术架构

### 2.1 后端实现

#### 2.1.1 核心数据结构

```go
// AIConfig AI配置
type AIConfig struct {
    URL                   string `json:"url"`
    APIKey                string `json:"api_key"`
    Model                 string `json:"model"`
    Timeout               int    `json:"timeout"`                           // 超时时间（秒），默认60
    EnableFunctionCall    *bool  `json:"enable_function_call,omitempty"`    // 手动开关
    EnableThinking        *bool  `json:"enable_thinking,omitempty"`         // 手动开关
    EnableStreaming       *bool  `json:"enable_streaming,omitempty"`        // 手动开关
    EnableJSONMode        *bool  `json:"enable_json_mode,omitempty"`        // 手动开关
    ContextWindowOverride int    `json:"context_window_override,omitempty"` // 手动指定上下文窗口
}

// AICapabilities AI模型能力检测结果
type AICapabilities struct {
    SupportsFunctionCall bool  `json:"supports_function_call"` // 是否支持 function call
    SupportsThinking     bool  `json:"supports_thinking"`      // 是否支持 extended thinking
    SupportsStreaming    bool  `json:"supports_streaming"`     // 是否支持流式输出
    ContextWindow        int   `json:"context_window"`         // 上下文窗口大小
    SupportsJSONMode     bool  `json:"supports_json_mode"`     // 是否支持 JSON 输出模式
    DetectedAt           int64 `json:"detected_at"`            // 检测时间戳
}

// AIQueryRequest AI查询请求
type AIQueryRequest struct {
    Message   string                   `json:"message"`
    Databases []string                 `json:"databases"`
    Modules   []string                 `json:"modules,omitempty"`
    History   []map[string]interface{} `json:"history,omitempty"`
}
```

**位置**：`server.go:892-1000`

---

#### 2.1.2 关键函数

##### `handleAIQuery` - AI 查询主处理函数

**功能**：处理 AI 查询请求，返回 SSE 流式响应。

**核心流程**：
1. 检查 AI 配置
2. 检测 AI 能力（如未检测）
3. 如果未指定数据库，返回数据库选择卡片
4. 获取数据库表结构（含字段信息）
5. 意图检测与路由
6. 根据意图调用相应处理函数
7. SQL 生成与执行（最多 3 次重试）
8. AI 反思与洞察生成
9. 返回结果

**代码位置**：`server.go:6885-7416`

**关键代码片段**：
```go
// 意图检测
if len(moduleSet) == 0 {
    intent := detectUserIntent(queryReq.Message)

    if intent.Confidence >= 0.7 && intent.DetectedModule != "" {
        moduleSet[intent.DetectedModule] = true
    } else {
        // 调用 AI 进行意图分类
        aiIntent := detectIntentWithAI(aiConfig, aiCapabilities, queryReq.Message)

        // 合并结果，取置信度更高的
        finalIntent := intent
        if aiIntent.Confidence > intent.Confidence && aiIntent.DetectedModule != "" {
            finalIntent = aiIntent
        }

        if finalIntent.Confidence >= 0.7 {
            moduleSet[finalIntent.DetectedModule] = true
        } else {
            // 返回意图选择卡片
            sendSSE(w, "intent_selection_required", map[string]interface{}{...})
            return
        }
    }
}

// 路由到相应处理函数
if moduleSet["api-dispatch"] {
    handleAICreateApi(w, flusher, &queryReq, dbSchemas, aiConfig, aiCapabilities)
    return
}
```

---

##### `detectAICapabilities` - AI 能力检测

**功能**：自动检测 AI 模型的各项能力。

**检测项**：
1. 基本连通性测试
2. Function Call 支持测试
3. Streaming 支持测试
4. JSON Mode 支持测试
5. 上下文窗口推断
6. Thinking 支持推断

**代码位置**：`server.go:8184-8298`

**检测策略**：
- 优先使用手动设置（如果配置中已指定）
- 自动检测通过实际 API 调用验证
- 根据模型名称推断上下文窗口和 Thinking 支持

**支持的模型推断**：
```go
// 上下文窗口推断
GPT-4-Turbo/GPT-4o: 128000 tokens
GPT-4-32k: 32768 tokens
GPT-4: 8192 tokens
Claude-3: 200000 tokens
Claude-2: 100000 tokens
Qwen: 32768 tokens

// Thinking 支持推断
Claude-3.5, Claude-Sonnet-3.5, O1, DeepSeek-Reasoner
```

---

##### `callAIServiceWithCapabilities` - AI 服务调用

**功能**：根据模型能力自适应调用 AI 服务。

**自适应策略**：
1. 如果支持 JSON Mode 且 prompt 要求 JSON 输出，启用 JSON Mode
2. 如果支持 Thinking，预留 Thinking 参数
3. 使用配置的超时时间（默认 120 秒）

**代码位置**：`server.go:8082-8184`

---

##### `buildAIPrompt` - 构建 AI 提示词

**功能**：构建包含数据库表结构信息的 AI 提示词。

**提示词结构**：
```
你是一个数据库查询助手。根据用户的问题和数据库表结构，生成 SQL 查询语句。

数据库类型: {dbType}
表结构:
{表名}
  - 字段1 (类型, 注释)
  - 字段2 (类型, 注释)
  ...

用户问题: {userMessage}

请返回 JSON 格式:
{
  "sql": "SQL语句",
  "target_db": "数据库名称",
  "response": "回复文本"
}
```

**代码位置**：`server.go:7851-7908`

---

##### `parseAIResponse` - 解析 AI 响应

**功能**：解析 AI 返回的 JSON，提取 SQL、目标数据库、回复文本。

**处理逻辑**：
1. 清理 AI 响应（去除 Markdown 代码块）
2. 提取 JSON 对象
3. 解析字段
4. 验证 SQL 表和字段是否存在

**代码位置**：`server.go:10858-10958`

---

### 2.2 前端实现

#### 2.2.1 核心数据结构

```javascript
// AI 配置
let aiConfig = null;

// AI 能力
let aiCapabilities = null;

// AI 会话上下文
let aiSessionContext = {
    databases: [],  // 当前上下文数据库
    modules: [],    // 当前上下文模块
    history: []     // 对话历史
};

// AI 模块列表
const aiModules = [
    { id: 'api-dispatch', name: '接口制作', icon: '🔌' },
    { id: 'data-governance', name: '数据治理', icon: '⚙️' },
    { id: 'quality-audit', name: '质量审计', icon: '✅' },
    { id: 'ontology', name: '本体查询', icon: '🧠' },
    { id: 'small-model', name: '小模型', icon: '🤖' }
];
```

---

#### 2.2.2 关键函数

##### `handleSendAiMessage` - 发送 AI 消息

**功能**：处理用户发送的 AI 消息，建立 SSE 连接。

**核心流程**：
1. 检查 AI 配置
2. 提取 @ 引用（数据库、模块）
3. 合并上下文
4. 记录历史
5. 建立 SSE 连接
6. 流式读取响应
7. 分发事件处理

**代码位置**：`script.js:5118-5250`

**关键代码片段**：
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
    // 数据库匹配（精确匹配、忽略大小写、部分匹配、ID匹配）
    const db = databases.find(d =>
        d.name === refName ||
        d.name.toLowerCase() === refName.toLowerCase() ||
        d.name.toLowerCase().includes(refName.toLowerCase()) ||
        d.id === refName
    );
    if (db) {
        dbReferences.push(db);
    }
}

// 建立 SSE 连接
const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/ai/query`, {
    method: 'POST',
    body: JSON.stringify({
        message: message,
        databases: dbReferences.map(db => db.id),
        modules: aiSessionContext.modules.map(m => m.id),
        history: aiSessionContext.history.slice(-5)
    })
});

// 流式读取
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
        // 解析 SSE 事件
        const eventLines = chunk.split('\n');
        let eventType = '';
        const dataLines = [];

        for (const line of eventLines) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }

        if (!eventType || dataLines.length === 0) continue;

        const data = JSON.parse(dataLines.join('\n'));
        handleStreamEvent(streamMessageId, eventType, data, message);
    }
}
```

---

##### `handleStreamEvent` - 处理流式事件

**功能**：处理 SSE 流式事件，更新 UI。

**支持的事件类型**：
- `start` - 开始处理
- `thinking` - 思考中
- `sql_generated` - SQL 已生成
- `executing` - 执行中
- `success` - 成功
- `confirm_write` - 确认写操作
- `error` - 错误
- `retry` - 重试
- `attempt_failed` - 尝试失败
- `database_selection_required` - 需要选择数据库
- `intent_selection_required` - 需要选择意图
- `api_config_generated` - API 配置已生成
- `governance_task_draft` - 治理任务草稿
- `quality_rule_draft` - 质量规则草稿
- `small_model_draft` - 小模型草稿

**代码位置**：`script.js:5679-6190`

---

##### `selectDatabaseAndRetry` - 选择数据库并重试

**功能**：用户选择数据库后，重新发送请求。

**代码位置**：`script.js:10876-10960`

---

##### `selectIntentAndRetry` - 选择意图并重试

**功能**：用户选择意图后，重新发送请求。

**代码位置**：`script.js:10961-11050`

---

##### `confirmCreateApiFromAI` - 确认创建 API

**功能**：确认 AI 生成的 API 配置，创建接口。

**代码位置**：`script.js:6396-6471`

---

##### `confirmCreateGovTaskFromAI` - 确认创建治理任务

**功能**：确认 AI 生成的治理任务配置，创建任务。

**代码位置**：`script.js:6483-6534`

---

##### `executeConfirmedSQL` - 执行确认的 SQL

**功能**：用户确认后执行写操作 SQL。

**代码位置**：`script.js:5555-5602`

---

### 2.3 SSE 事件流设计

#### 2.3.1 事件格式

```
event: {eventType}
data: {jsonPayload}

```

#### 2.3.2 事件流程图

```
用户发送消息
    ↓
[start] 开始处理
    ↓
[thinking] 正在读取数据库表结构信息
    ↓
[thinking] 正在分析您的问题并生成SQL
    ↓
[sql_generated] SQL 已生成
    ↓
[executing] 正在执行SQL查询
    ↓
[success] 查询成功，返回结果
    ↓
[done] 完成
```

#### 2.3.3 重试流程

```
[sql_generated] SQL 已生成
    ↓
[executing] 正在执行SQL查询
    ↓
[attempt_failed] 第1次失败：SQL执行失败
    ↓
[retry] 第2次重试，正在根据错误调整SQL
    ↓
[sql_generated] SQL 已生成
    ↓
[executing] 正在执行SQL查询
    ↓
[success] 查询成功
```

#### 2.3.4 写操作确认流程

```
[sql_generated] SQL 已生成
    ↓
[confirm_write] 检测到写入操作，请确认
    ↓
用户点击"执行"
    ↓
前端调用 /api/data-ontology/ai/confirm-execute
    ↓
[success] 执行成功
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
- `getTablesList` - 获取表列表
- `getTableColumns` - 获取表字段信息
- `executeSQLQuery` - 执行 SQL 查询

**数据流**：
```
AI 查询请求
    ↓
获取用户可访问的数据库列表
    ↓
读取表结构信息（最多 15 张表）
    ↓
构建 AI Prompt（包含表结构）
    ↓
AI 生成 SQL
    ↓
在指定数据库上执行 SQL
    ↓
返回结果
```

---

### 3.2 与接口分发模块的联动

**联动方式**：
1. **API 配置生成**：AI 根据自然语言生成 API 配置
2. **SQL 验证**：验证 AI 生成的 SQL 是否有效
3. **参数推断**：从 SQL 中提取参数并推断默认值
4. **一键创建**：用户确认后直接创建 API

**关键函数**：
- `handleAICreateApi` - AI 创建接口
- `parseApiConfigFromAI` - 解析 AI 生成的配置
- `validateSQLTablesAndFields` - 验证 SQL 表和字段
- `populateDefaultParamsFromDB` - 从数据库填充默认参数

**数据流**：
```
用户：帮我创建一个查询用户信息的接口
    ↓
AI 分析需求
    ↓
生成 API 配置（路径、方法、SQL、参数）
    ↓
验证 SQL（表、字段是否存在）
    ↓
推断参数默认值（从数据库查询实际值）
    ↓
返回配置预览
    ↓
用户确认
    ↓
创建 API
```

---

### 3.3 与数据治理模块的联动

**联动方式**：
1. **任务创建**：AI 根据自然语言创建定时任务或交互任务
2. **代码生成**：AI 生成 JavaScript 执行脚本
3. **Cron 推断**：AI 推断定时任务的 Cron 表达式
4. **数据库关联**：AI 自动关联任务与数据库

**关键函数**：
- `handleAIGovernanceTask` - AI 创建治理任务
- `buildGovernanceTaskPrompt` - 构建治理任务提示词
- `parseGovernanceTaskDraft` - 解析治理任务草稿

**数据流**：
```
用户：创建一个定时任务，每天凌晨2点统计所有表的行数
    ↓
AI 分析需求
    ↓
识别任务类型（定时/交互）
    ↓
生成任务配置（名称、类型、Cron、JS代码）
    ↓
返回任务草稿
    ↓
用户确认
    ↓
创建任务
```

---

### 3.4 与质量审核模块的联动

**联动方式**：
1. **规则创建**：AI 根据自然语言创建质量审核规则
2. **SQL 生成**：AI 生成校验 SQL
3. **规则类型识别**：AI 识别规则类型

**关键函数**：
- `handleAIQualityRule` - AI 创建质量规则

**数据流**：
```
用户：创建一个规则，检查用户表的邮箱字段是否有效
    ↓
AI 分析需求
    ↓
生成规则配置（编号、名称、SQL）
    ↓
返回规则草稿
    ↓
用户确认
    ↓
创建规则
```

---

## 4. 关键配置项

### 4.1 AI 配置存储位置

**存储文件**：`apps/data-ontology/data-store.json`

**存储结构**：
```json
{
  "ai_config": {
    "url": "https://api.openai.com/v1/chat/completions",
    "api_key": "sk-...",
    "model": "gpt-4-turbo",
    "timeout": 120,
    "enable_function_call": true,
    "enable_thinking": false,
    "enable_streaming": true,
    "enable_json_mode": true,
    "context_window_override": 0
  },
  "ai_capabilities": {
    "supports_function_call": true,
    "supports_thinking": false,
    "supports_streaming": true,
    "context_window": 128000,
    "supports_json_mode": true,
    "detected_at": 1714099200
  }
}
```

**加载与保存**：
- 加载：`server.go:1137-1221` (`loadDataOntologyStore`)
- 保存：`server.go:1246-1287` (`saveDataOntologyStore`)

---

### 4.2 模型能力检测机制

#### 4.2.1 检测时机

1. **首次配置**：用户保存 AI 配置时自动检测
2. **配置更新**：用户修改配置后重新检测
3. **手动检测**：用户点击"自动检测模型能力"按钮

#### 4.2.2 检测流程

```
开始检测
    ↓
测试基本连通性
    ↓ (成功)
测试 Function Call 支持
    ↓
测试 Streaming 支持
    ↓
测试 JSON Mode 支持
    ↓
推断上下文窗口大小
    ↓
推断 Thinking 支持
    ↓
保存检测结果
```

#### 4.2.3 检测方法

**Function Call 测试**：
```go
requestBody := map[string]interface{}{
    "model": config.Model,
    "messages": []map[string]string{
        {"role": "user", "content": "What's the weather in Beijing?"},
    },
    "tools": []map[string]interface{}{...},
    "tool_choice": "auto",
}
// 检查响应中是否包含 tool_calls
```

**Streaming 测试**：
```go
requestBody := map[string]interface{}{
    "model": config.Model,
    "messages": []map[string]string{...},
    "stream": true,
}
// 检查是否返回流式响应
```

**JSON Mode 测试**：
```go
requestBody := map[string]interface{}{
    "model": config.Model,
    "messages": []map[string]string{...},
    "response_format": map[string]string{"type": "json_object"},
}
// 检查是否返回有效 JSON
```

---

### 4.3 降级策略

#### 4.3.1 能力检测失败降级

如果能力检测失败，使用默认能力：
```go
aiCapabilities = &AICapabilities{
    SupportsFunctionCall: false,
    SupportsThinking:     false,
    SupportsStreaming:    true,
    ContextWindow:        4096,
    SupportsJSONMode:     false,
}
```

#### 4.3.2 AI 调用失败降级

1. **重试机制**：最多重试 3 次
2. **错误反馈**：将错误信息反馈给 AI，让其调整 SQL
3. **重复检测**：检测 AI 是否生成已失败的相同 SQL，避免无限循环

#### 4.3.3 JSON Mode 降级

如果模型不支持 JSON Mode，使用正则表达式提取 JSON：
```go
func extractJSONObject(s string) string {
    // 查找第一个 { 和最后一个 }
    first := strings.Index(s, "{")
    last := strings.LastIndex(s, "}")
    if first == -1 || last == -1 || first > last {
        return s
    }
    return s[first : last+1]
}
```

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
| `done` | 完成 | 无 |

---

### 5.2 前端事件处理

```javascript
function handleStreamEvent(messageId, eventType, data, userMessage) {
    switch (eventType) {
        case 'start':
            // 显示加载动画
            statusEl.innerHTML = `<div class="ai-loading">...</div>`;
            break;

        case 'thinking':
            // 显示思考状态
            statusEl.innerHTML = `<div class="ai-status-thinking">${data.message}</div>`;
            break;

        case 'sql_generated':
            // 显示生成的 SQL
            contentEl.innerHTML = `
                <div>${formatAIText(data.response)}</div>
                <div class="ai-sql-block">${escapeHtml(data.sql)}</div>
            `;
            break;

        case 'success':
            // 显示成功结果
            contentEl.innerHTML = `
                <div>${formatAIText(data.response)}</div>
                <div class="ai-sql-block">${escapeHtml(data.sql)}</div>
                <div class="ai-result-table">...</div>
            `;
            break;

        case 'confirm_write':
            // 显示确认对话框
            contentEl.innerHTML = `
                <div>${formatAIText(data.response)}</div>
                <div class="ai-sql-block">${escapeHtml(data.sql)}</div>
                <div class="ai-confirm-write">
                    <button onclick="executeConfirmedSQL(...)">执行</button>
                    <button onclick="cancelConfirmedSQL(...)">取消</button>
                </div>
            `;
            break;

        case 'error':
            // 显示错误信息
            contentEl.innerHTML = `<div class="ai-error">${data.message}</div>`;
            break;

        case 'database_selection_required':
            // 显示数据库选择卡片
            contentEl.innerHTML = `
                <div class="ai-db-selection-card">
                    ${data.databases.map(db => `
                        <div onclick="selectDatabaseAndRetry('${db.id}', ...)">
                            ${db.name}
                        </div>
                    `).join('')}
                </div>
            `;
            break;

        case 'intent_selection_required':
            // 显示意图选择卡片
            contentEl.innerHTML = `
                <div class="ai-db-selection-card">
                    ${data.intents.map(intent => `
                        <div onclick="selectIntentAndRetry('${intent.id}', ...)">
                            ${intent.icon} ${intent.name}
                        </div>
                    `).join('')}
                </div>
            `;
            break;

        case 'api_config_generated':
            // 显示 API 配置预览
            contentEl.innerHTML = `
                <div class="ai-api-config-preview">
                    <div>名称: ${data.config.name}</div>
                    <div>路径: ${data.config.path}</div>
                    <div>方法: ${data.config.method}</div>
                    <div>SQL: ${data.config.sql}</div>
                    <button onclick="confirmCreateApiFromAI(...)">创建</button>
                    <button onclick="cancelCreateApiFromAI(...)">取消</button>
                </div>
            `;
            break;

        case 'governance_task_draft':
            // 显示治理任务草稿
            contentEl.innerHTML = `
                <div class="ai-gov-draft-preview">
                    <div>名称: ${data.task.name}</div>
                    <div>类型: ${data.task.type}</div>
                    <div>脚本: ${data.task.js_code}</div>
                    <button onclick="confirmCreateGovTaskFromAI(...)">确认创建</button>
                    <button onclick="cancelGovTaskDraft(...)">取消</button>
                </div>
            `;
            break;
    }
}
```

---

## 6. AI 能力自适应机制

### 6.1 自适应策略

#### 6.1.1 JSON Mode 自适应

```go
// 如果支持 JSON Mode 且 prompt 要求 JSON 输出，启用 JSON Mode
if capabilities.SupportsJSONMode {
    if strings.Contains(prompt, "JSON") || strings.Contains(prompt, "json") {
        requestBody["response_format"] = map[string]string{"type": "json_object"}
    }
}
```

#### 6.1.2 上下文窗口自适应

```go
// 根据上下文窗口大小截断对话历史
if aiCapabilities.ContextWindow > 0 {
    maxHistoryTokens := aiCapabilities.ContextWindow / 2
    queryReq.History = truncateHistoryForContext(queryReq.History, maxHistoryTokens)
}
```

#### 6.1.3 Thinking 自适应

```go
// 如果支持 Extended Thinking，预留参数
if capabilities.SupportsThinking {
    // 可以添加 thinking 相关参数
    // requestBody["thinking"] = map[string]interface{}{...}
}
```

---

### 6.2 模型兼容性

#### 6.2.1 支持的模型

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

#### 6.2.2 兼容性处理

1. **OpenAI 兼容 API**：支持所有 OpenAI 兼容的 API（如 Ollama、vLLM）
2. **自定义 API**：支持自定义 API 端点
3. **降级处理**：不支持某些能力时自动降级

---

### 6.3 性能优化

#### 6.3.1 表结构限制

```go
// 最多读取 15 张表的字段信息
maxTables := 15
if len(tables) > maxTables {
    tables = tables[:maxTables]
}
```

#### 6.3.2 结果截断

```go
// 截断查询结果，避免返回过多数据
resultsSummary := truncateResultsForAI(results, 20, 2000)
```

#### 6.3.3 历史管理

```go
// 只保留最近 5 轮对话
history: aiSessionContext.history.slice(-5)
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

---

### B. 错误码说明

| 错误类型 | 说明 | 处理方式 |
|---------|------|---------|
| `AI配置不完整` | URL/API Key/Model 未配置 | 提示用户配置 |
| `AI服务调用失败` | 网络错误或 API 错误 | 重试或降级 |
| `SQL执行失败` | SQL 语法错误或权限错误 | AI 重试生成 |
| `权限不足` | 数据库权限错误 | 停止重试，提示用户 |
| `超时` | 查询超时 | 提示简化查询 |
| `未找到有效的数据库` | 数据库不存在或无权限 | 提示用户检查 |

---

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

### D. 开发指南

#### D.1 添加新的意图类型

1. 在 `detectUserIntent` 函数中添加关键词检测
2. 在 `detectIntentWithAI` 函数中添加意图描述
3. 创建对应的处理函数（如 `handleAINewIntent`）
4. 在 `handleAIQuery` 中添加路由逻辑
5. 在前端添加事件处理（如 `new_intent_draft`）

#### D.2 添加新的 SSE 事件

1. 后端：在处理函数中调用 `sendSSE(w, "new_event", data)`
2. 前端：在 `handleStreamEvent` 中添加 `case 'new_event'` 处理

#### D.3 自定义 AI Prompt

1. 修改 `buildAIPrompt` 函数
2. 添加数据库特定的提示信息
3. 调整 temperature 等参数

---

## 总结

DataToolbox 的 AI 助手模块是一个功能完整、架构清晰、扩展性强的智能数据管理助手。通过自然语言交互，用户可以轻松完成数据查询、接口创建、数据治理等复杂任务，大大降低了数据管理的门槛。

**核心优势**：
1. **智能化**：自动意图检测、SQL 生成、错误修复
2. **自适应**：根据模型能力自动调整调用策略
3. **安全性**：写操作确认、权限控制、SQL 验证
4. **易用性**：自然语言交互、流式响应、实时反馈
5. **扩展性**：模块化设计、易于添加新功能

**适用场景**：
- 数据分析师：快速查询数据，无需编写复杂 SQL
- 开发人员：快速创建 API 接口
- DBA：创建定时任务，进行数据治理
- 业务人员：了解数据结构，进行数据质量审核

---

**文档维护**：本文档基于代码自动生成，如有更新请同步修改。
**联系方式**：如有问题，请提交 Issue 或 Pull Request。

# DataToolbox AI 助手模块完整架构文档

## 目录
1. [已实现功能清单](#已实现功能清单)
2. [技术架构](#技术架构)
3. [与其他模块的联动](#与其他模块的联动)
4. [模型适配策略](#模型适配策略)
5. [核心实现细节](#核心实现细节)
6. [数据流与调用链](#数据流与调用链)

---

## 已实现功能清单

### 1. AI 对话功能

#### 1.1 自然语言转 SQL 查询
- **用途**: 用户通过自然语言描述查询需求，AI 自动生成 SQL 并执行
- **触发方式**:
  - `@数据库名 查询问题`
  - 后续对话自动使用上下文数据库
- **核心特性**:
  - 支持查询、统计、分析等多种场景
  - 自动检测写入操作（INSERT/UPDATE/DELETE），需用户确认后执行
  - 支持多轮对话上下文记忆（最近 5 轮）
  - 失败自动重试，最多 3 次，每次根据错误类型调整提示词
  - 反思机制：AI 分析结果是否回答了用户问题，提供置信度
  - 支持多种数据库：MySQL、PostgreSQL、Oracle、达梦、SQLite、MongoDB、Redis 等
- **前端界面**: AI 助手 Tab 页聊天界面
- **API 端点**: `POST /api/data-ontology/ai/query`
- **实现位置**:
  - 后端: `server.go:6886-7318` (`handleAIQuery`)
  - 前端: `apps/data-ontology/script.js:5118-5241` (`handleSendAiMessage`)

#### 1.2 多模块智能路由
- **用途**: 根据 @模块名 自动路由到不同的处理逻辑
- **支持的模块**:
  - `@数据库管理` - 数据库连接与表结构管理
  - `@接口分发` - 创建 RESTful API 接口
  - `@数据治理` - 创建定时任务和交互任务
  - `@质量审核` - 创建数据质量审核规则
  - `@小模型` - 创建 JavaScript 数据处理函数
  - `@本体论` - 业务语义分析和知识图谱
- **实现位置**: `server.go:7021-7056`

### 2. 接口创建功能

#### 2.1 自然语言创建 API 接口
- **用途**: 通过自然语言描述需求，自动生成 RESTful API 接口配置
- **触发方式**:
  - `@接口分发 创建一个查询用户的接口`
  - 或关键词触发：创建接口、新建接口、生成接口、创建 API 等
- **生成内容**:
  - 接口名称、路径、HTTP 方法（GET/POST/PUT/DELETE）
  - SQL 语句（支持 MyBatis 参数语法 `#{param}`）
  - 接口描述
  - 默认参数值（用于测试）
- **流程**: AI 生成配置 → 用户预览/编辑 → 确认创建 → 立即可用
- **前端界面**: AI 聊天界面中显示配置预览卡片
- **后端处理**: `server.go:9214-9311` (`handleAICreateApi`)
- **API 端点**: 创建后可通过 `GET /api/data-ontology/dispatch{path}` 调用

#### 2.2 接口配置解析
- **实现位置**: `server.go:9385-9480` (`parseApiConfigFromAI`)
- **解析内容**:
  - 从 AI 响应中提取 JSON 配置
  - 验证必填字段（name、path、method、sql）
  - 自动生成接口 ID 和时间戳
  - 设置默认启用状态

### 3. 数据治理任务创建

#### 3.1 创建定时任务
- **用途**: 通过自然语言描述，生成定时执行的数据处理任务
- **触发方式**: `@数据治理 @数据库名 创建一个定时任务每天凌晨 2 点导入数据`
- **生成内容**:
  - 任务名称、类型（scheduled）
  - Cron 表达式（如 `0 2 * * *` 表示每天凌晨 2 点）
  - JavaScript 处理代码
  - 关联的数据库 ID
- **流程**: AI 生成草稿 → 用户预览/编辑 → 确认创建 → 自动加入调度队列
- **后端处理**: `server.go:9034-9212` (`handleAIGovernanceTask`)

#### 3.2 创建交互任务
- **用途**: 生成上传文件后执行的数据处理任务
- **触发方式**: `@数据治理 生成一个交互任务：上传 Excel 后写入指定表`
- **生成内容**:
  - 任务名称、类型（interactive）
  - 输入类型（file/text/both）
  - 允许的文件扩展名（如 .xlsx、.csv、.docx）
  - JavaScript 处理代码
  - 文件批处理模式（per_file/single）
- **特性**:
  - 支持多文件一次执行
  - 支持注册为 API 接口
  - 实时进度追踪

#### 3.3 AI 生成入库代码
- **用途**: AI 自动生成数据导入代码
- **触发方式**: 在数据治理任务详情页点击"AI 生成代码"
- **实现位置**: `server.go:8494-8772` (`handleAICodegen`)
- **生成内容**:
  - 根据表结构生成 INSERT 语句
  - 根据数据源类型（Excel/CSV）生成解析代码
  - 支持字段映射和类型转换

### 4. 数据质量审核规则创建

#### 4.1 创建审核规则
- **用途**: 生成数据质量审核规则配置
- **触发方式**: `@质量审核 创建规则检查用户表的必填字段`
- **生成内容**:
  - 规则编号（NM，6 位数字）
  - 层级编码（XH）
  - 规则名称、分类
  - SQL 语句（查询违规数据）
- **流程**: AI 生成规则 → 用户确认 → 创建规则 → 可执行审核
- **后端处理**: `server.go` 中的 `handleAIQualityRule`

### 5. 小模型创建

#### 5.1 创建 JavaScript 数据处理函数
- **用途**: 生成可复用的数据处理逻辑
- **触发方式**: `@小模型 创建一个数据清洗函数`
- **生成内容**:
  - 模型名称、描述
  - JavaScript 异步处理代码
  - 输入类型（text/file/both）
  - 输出类型（text/json/file）
  - 关联的数据库（可选）
- **使用场景**:
  - 数据治理任务中调用
  - API 接口中调用进行数据转换
  - 独立测试
- **后端处理**: `server.go` 中的 `handleAISmallModel`

### 6. 本体论语义分析

#### 6.1 业务语义分析
- **用途**: 基于知识图谱进行语义分析和数据治理建议
- **触发方式**: `@本体论 分析用户表和订单表的关系`
- **特性**:
  - 从本体论角度分析业务语义
  - 识别实体关系（一对一、一对多、多对多）
  - 提供数据治理建议（索引优化、外键约束等）
  - 自动高亮相关概念
- **前端界面**: AI 聊天界面中显示分析结果
- **后端处理**: `server.go:8773-8881` (`handleAIOntologyQuery`)

### 7. 其他已实现功能

#### 7.1 AI 配置管理
- **功能**: 配置 AI 服务的 URL、API Key、模型名称、超时时间
- **API 端点**: `GET/POST /api/data-ontology/ai/config`
- **实现位置**: `server.go:6493-6555` (`handleAIConfig`)
- **配置项**:
  - URL: AI 服务端点（兼容 OpenAI 格式）
  - API Key: 认证密钥
  - Model: 模型名称
  - Timeout: 超时时间（默认 120 秒）
  - 手动开关：Function Call、Thinking、Streaming、JSON Mode
  - 上下文窗口覆盖值

#### 7.2 AI 能力检测
- **功能**: 自动检测 AI 模型支持的能力
- **API 端点**: `GET /api/data-ontology/ai/capabilities`
- **实现位置**: `server.go:6558-6595` (`handleAICapabilities`)
- **检测项**:
  - Function Call / Tool Use 支持
  - Extended Thinking / Reasoning 支持
  - 流式输出支持
  - JSON 输出模式支持
  - 上下文窗口大小
- **检测方式**: 通过实际 API 调用测试（详见 `server.go:8059-8470`）

#### 7.3 大模型管理
- **功能**: 配置多个 LLM、Rerank、Embedding、ASR、TTS 服务
- **API 端点**: `GET/POST /api/data-ontology/llm-models`
- **实现位置**: `server.go:6600-6638` (`handleLLMModels`)
- **支持的模型类型**:
  - LLM（大语言模型）
  - Rerank（重排序模型）
  - Embedding（向量化模型）
  - ASR（语音识别）
  - TTS（语音合成）

#### 7.4 小模型管理
- **功能**: 管理 JavaScript 数据处理函数
- **API 端点**: `GET/POST/PUT/DELETE /api/data-ontology/small-models`
- **实现位置**: `server.go:6758-6885` (`handleSmallModelDetail`)

---

## 技术架构

### 代码结构

```
DataToolbox/
├── server.go                          # 后端主文件（12408 行）
│   ├── 数据结构定义 (行 891-999)
│   │   ├── AIConfig                   # AI 服务配置
│   │   ├── AICapabilities             # AI 能力检测结果
│   │   ├── AIQueryRequest             # AI 查询请求
│   │   ├── AICodegenRequest           # AI 代码生成请求
│   │   ├── LLMModelConfig             # 大模型配置
│   │   └── SmallModelConfig           # 小模型配置
│   │
│   ├── API 处理函数 (行 6493-9577)
│   │   ├── handleAIConfig             # AI 配置管理
│   │   ├── handleAICapabilities       # AI 能力检测
│   │   ├── handleAIQuery              # AI 查询主入口
│   │   ├── handleAIOntologyQuery      # 本体论查询
│   │   ├── handleAIGovernanceTask     # 治理任务生成
│   │   ├── handleAIQualityRule        # 质量规则生成
│   │   ├── handleAISmallModel         # 小模型生成
│   │   ├── handleAICreateApi          # API 配置生成
│   │   ├── handleAICodegen            # 入库代码生成
│   │   ├── handleAIConfirmExecute     # SQL 确认执行
│   │   ├── handleLLMModels            # 大模型管理
│   │   └── handleSmallModelDetail     # 小模型管理
│   │
│   ├── AI 服务调用 (行 7738-8470)
│   │   ├── buildAIPrompt              # 构建提示词
│   │   ├── buildRetryPrompt           # 构建重试提示词
│   │   ├── buildReflectionPrompt      # 构建反思提示词
│   │   ├── buildCreateApiPrompt       # 构建创建接口提示词
│   │   ├── callAIService              # 调用 LLM API
│   │   ├── callAIServiceWithCapabilities # 根据能力自适应调用
│   │   ├── detectAICapabilities       # 检测 AI 能力
│   │   ├── testBasicConnectivity      # 测试基础连接
│   │   ├── testFunctionCall           # 测试 Function Call
│   │   ├── testStreaming              # 测试流式输出
│   │   ├── testJSONMode               # 测试 JSON 模式
│   │   ├── formatDBSchemaForPrompt    # 格式化数据库结构
│   │   └── getModulePromptPrefix      # 获取模块提示词前缀
│   │
│   └── 辅助函数
│       ├── sendSSE                    # 发送 SSE 事件
│       ├── cleanAIResponse            # 清理 AI 响应
│       ├── parseAIResponse            # 解析 AI 响应提取 SQL
│       ├── parseApiConfigFromAI       # 解析接口配置
│       ├── truncateResultsForAI       # 截断结果供 AI 分析
│       └── truncateHistoryForContext  # 截断对话历史
│
├── mcp.go                             # MCP 协议支持（供 Cursor 等 IDE 集成）
│
├── apps/data-ontology/
│   ├── index.html (1876 行)           # 前端 HTML
│   │   ├── AI 助手 Tab (行 731-784)
│   │   │   ├── 聊天消息区域
│   │   │   ├── 输入框和发送按钮
│   │   │   └── AI 配置按钮
│   │   └── 模型管理 Tab (行 786-826)
│   │       ├── 大模型管理面板
│   │       └── 小模型管理面板
│   │
│   ├── script.js (10536 行)           # 前端主脚本
│   │   ├── AI 会话上下文 (行 67-71)
│   │   ├── AI 模块定义 (行 60-65)
│   │   ├── AI 配置管理 (行 4290-4330)
│   │   ├── 消息发送处理 (行 5118-5241)
│   │   ├── 流式事件处理 (行 5671-6148)
│   │   ├── SQL 确认执行 (行 6236-6350)
│   │   ├── API 配置确认 (行 6275-6350)
│   │   └── 辅助函数
│   │       ├── addAiMessage           # 添加消息
│   │       ├── addAiStreamMessage     # 创建流式消息卡片
│   │       ├── appendAiProcessStep    # 添加处理步骤
│   │       ├── formatAIText           # 格式化 AI 文本
│   │       └── updateAiContextDisplay # 更新上下文显示
│   │
│   └── style.css (127147 行)          # 样式文件
│       └── AI 相关样式 (约 2000 行)
│
├── apps/llm-learn/                    # 大模型使用教程应用
│   ├── index.html                     # 教程界面
│   └── script.js                      # 闯关式学习逻辑
│
├── apps/ai-structurer/                # AI 结构化提取应用
│   └── style.css                      # 样式文件
│
└── docs/
    └── ai-assistant-architecture.md   # 本文档
```

### 技术栈

#### 后端技术
- **语言**: Go 1.21+
- **核心依赖**:
  - `net/http` - HTTP 服务器和客户端
  - `encoding/json` - JSON 处理
  - `github.com/google/uuid` - UUID 生成
  - `github.com/go-sql-driver/mysql` - MySQL 驱动
  - `github.com/lib/pq` - PostgreSQL 驱动
  - `github.com/mattn/go-oci8` - Oracle 驱动
  - `github.com/dmbs/dm` - 达梦数据库驱动
  - `github.com/mattn/go-sqlite3` - SQLite 驱动
  - `go.mongodb.org/mongo-driver` - MongoDB 驱动
  - `github.com/redis/go-redis` - Redis 驱动
  - `github.com/modelcontextprotocol/go-sdk/mcp` - MCP 协议支持

#### 前端技术
- **技术**: 原生 JavaScript (无框架依赖)
- **特性**:
  - Server-Sent Events (SSE) - 流式响应
  - Fetch API - HTTP 请求
  - LocalStorage - 本地存储（token、用户信息）
  - 动态脚本加载 - 按需加载模块脚本（governance.js、quality-audit.js）
  - Markdown 渲染 - AI 文本格式化

#### AI 服务集成
- **协议**: OpenAI API 兼容格式
- **支持的服务**:
  - OpenAI (GPT-3.5/GPT-4/GPT-4o)
  - Claude (通过兼容接口)
  - DeepSeek (deepseek-chat/deepseek-reasoner)
  - 通义千问 (qwen-max/qwen-plus/qwen-turbo)
  - 智谱 GLM (glm-4-plus/glm-4-flash)
  - 文心一言 (ERNIE-4.0-8K)
  - Moonshot (moonshot-v1-8k)
  - 豆包 (doubao-pro-32k)
  - Ollama (本地部署)
  - 其他兼容 OpenAI 格式的服务
- **配置项**:
  - URL: AI 服务端点
  - API Key: 认证密钥
  - Model: 模型名称
  - Timeout: 超时时间（默认 120 秒）

---

## 与其他模块的联动

### 1. 与数据源模块的联动

#### 1.1 获取数据库结构
- **场景**: AI 生成 SQL 前需要了解表结构
- **实现**:
  ```go
  // server.go:6968-7012
  for _, dbID := range queryReq.Databases {
      dbConfig := dataOntologyDatabases[dbID]
      tables := getTablesList(dbConfig)  // 获取表列表

      for _, tableName := range tables {
          columns := getTableColumns(dbConfig, tableName)  // 获取字段信息
          tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
              "name":    tableName,
              "columns": columns,
          })
      }

      dbSchemas = append(dbSchemas, map[string]interface{}{
          "name":   dbConfig.Name,
          "type":   dbConfig.Type,
          "tables": tablesWithColumns,
          "id":     dbID,
      })
  }
  ```
- **支持的信息**:
  - 表名、字段名、字段类型
  - 自增主键标记
  - NOT NULL 约束
  - 外键关系

#### 1.2 执行 SQL 查询
- **场景**: AI 生成 SQL 后执行查询
- **实现**: `server.go:7180-7280`
- **支持的操作**:
  - SELECT - 查询数据
  - INSERT - 插入数据（需确认）
  - UPDATE - 更新数据（需确认）
  - DELETE - 删除数据（需确认）
  - DDL 操作（需确认）

#### 1.3 数据库类型适配
- **场景**: 不同数据库的 SQL 方言差异
- **实现**: `server.go:7690-7730`
- **适配内容**:
  - 分页语法：MySQL `LIMIT` vs Oracle `ROWNUM` vs PostgreSQL `LIMIT/OFFSET`
  - 引号风格：MySQL `` ` `` vs Oracle `"` vs PostgreSQL `"`
  - 数据类型：INT vs NUMBER vs SERIAL
  - 函数差异：NOW() vs SYSDATE

### 2. 与接口分发模块的联动

#### 2.1 创建 API 接口
- **场景**: AI 生成接口配置后创建实际的 RESTful API
- **流程**:
  1. AI 生成配置（`handleAICreateApi`）
  2. 前端显示预览，用户可编辑
  3. 用户确认后，调用 `POST /api/data-ontology/apis`
  4. 接口立即可用：`GET /api/data-ontology/dispatch{path}`

#### 2.2 接口调用示例
```bash
# AI 创建的接口
GET /api/data-ontology/dispatch/api/users?status=active&limit=20&offset=0

# 实际执行的 SQL
SELECT * FROM users WHERE status = 'active' ORDER BY created_at DESC LIMIT 20 OFFSET 0
```

#### 2.3 参数绑定
- **支持**: MyBatis 风格参数语法 `#{param}`
- **实现**: `server.go:5793-5900` (`handleApiDispatch`)
- **特性**:
  - 自动类型转换
  - SQL 注入防护
  - 默认参数值

### 3. 与数据治理模块的联动

#### 3.1 创建定时任务
- **场景**: AI 生成定时任务配置
- **流程**:
  1. AI 生成任务草稿（`handleAIGovernanceTask`）
  2. 前端显示预览，用户可编辑
  3. 用户确认后，调用 `POST /api/data-ontology/governance/tasks`
  4. 任务自动加入调度队列（Cron 调度器）

#### 3.2 创建交互任务
- **场景**: AI 生成交互任务配置
- **流程**:
  1. AI 生成任务草稿
  2. 用户确认后创建任务
  3. 任务可通过上传文件触发执行
  4. 支持多文件批处理
  5. 实时进度追踪

#### 3.3 AI 生成入库代码
- **场景**: 用户上传 Excel/CSV，AI 自动生成导入代码
- **实现**: `server.go:8494-8772` (`handleAICodegen`)
- **生成内容**:
  - Excel/CSV 解析代码
  - 字段映射逻辑
  - INSERT 语句生成
  - 错误处理

#### 3.4 治理任务中调用 AI
- **场景**: 治理任务的 JavaScript 代码中调用 AI
- **实现**: `apps/data-ontology/gov-api.js:7738` (`gov.callAI`)
- **示例**:
  ```javascript
  // 在治理任务中调用 AI
  const prompt = "将以下文本结构化为 JSON：\n" + rawText;
  const aiText = await gov.callAI(prompt);
  const structured = JSON.parse(aiText);
  ```

### 4. 与本体关系模块的联动

#### 4.1 本体论语义分析
- **场景**: AI 分析表之间的业务关系
- **实现**: `server.go:8773-8881` (`handleAIOntologyQuery`)
- **分析内容**:
  - 实体识别（用户、订单、产品等）
  - 关系识别（一对一、一对多、多对多）
  - 业务语义（客户-交易、商品-库存等）
  - 治理建议（索引优化、外键约束、级联策略）

#### 4.2 本体提取
- **场景**: 从数据库结构中提取业务本体
- **实现**: `apps/data-ontology/script.js` 中的本体提取功能
- **特性**:
  - AI 识别业务实体和事件
  - 自动生成知识图谱
  - 可视化展示

#### 4.3 本体关系表
- **场景**: 扫描等价字段聚类
- **实现**: `server.go` 中的本体关系管理
- **功能**:
  - 自动发现字段关系（如 user_id → users.id）
  - 支持多种匹配类型（精确、大小写不敏感、命名风格、类型关键字）
  - 生成关系候选列表

---

## 模型适配策略

### 1. 支持的模型类型

#### 1.1 大语言模型 (LLM)
- **用途**: 自然语言理解、SQL 生成、代码生成
- **支持的模型**:
  - **OpenAI 系列**:
    - GPT-4o (最新多模态模型)
    - GPT-4-turbo (高性能)
    - GPT-3.5-turbo (高性价比)
  - **Claude 系列**:
    - Claude-3.5-sonnet (通过兼容接口)
  - **国产模型**:
    - DeepSeek (deepseek-chat, deepseek-reasoner)
    - 通义千问 (qwen-max, qwen-plus, qwen-turbo)
    - 智谱 GLM (glm-4-plus, glm-4-flash)
    - 文心一言 (ERNIE-4.0-8K)
    - Moonshot (moonshot-v1-8k)
    - 豆包 (doubao-pro-32k)
  - **本地部署**:
    - Ollama (支持 LLaMA、Mistral 等)

#### 1.2 其他模型类型
- **Rerank 模型**: 搜索结果重排序
- **Embedding 模型**: 文本向量化（用于语义搜索）
- **ASR 模型**: 语音识别
- **TTS 模型**: 语音合成

### 2. 能力检测机制

#### 2.1 自动检测流程
- **触发时机**:
  - 首次配置 AI 时
  - 配置更新时
  - 手动请求检测时

- **实现位置**: `server.go:8059-8470` (`detectAICapabilities`)

- **检测步骤**:
  ```go
  // 1. 基础连接测试
  success, err := testBasicConnectivity(client, config)

  // 2. Function Call 测试
  if config.EnableFunctionCall == nil {  // 未手动设置
      supportsFC, err := testFunctionCall(client, config)
      capabilities.SupportsFunctionCall = supportsFC
  }

  // 3. 流式输出测试
  if config.EnableStreaming == nil {
      supportsStream, err := testStreaming(client, config)
      capabilities.SupportsStreaming = supportsStream
  }

  // 4. JSON 模式测试
  if config.EnableJSONMode == nil {
      supportsJSON, err := testJSONMode(client, config)
      capabilities.SupportsJSONMode = supportsJSON
  }

  // 5. 上下文窗口检测
  if config.ContextWindowOverride == 0 {
      capabilities.ContextWindow = detectContextWindow(config.Model)
  }
  ```

#### 2.2 Function Call 检测
- **实现**: `server.go:8213-8285` (`testFunctionCall`)
- **测试方法**:
  ```go
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
  }

  // 检查响应中是否包含 tool_calls
  if _, hasToolCalls := message["tool_calls"]; hasToolCalls {
      return true, nil
  }
  ```

#### 2.3 流式输出检测
- **实现**: `server.go:8288-8330` (`testStreaming`)
- **测试方法**:
  ```go
  requestBody := map[string]interface{}{
      "model": config.Model,
      "messages": []map[string]string{
          {"role": "user", "content": "hi"},
      },
      "stream":     true,
      "max_tokens": 10,
  }

  // 检查 Content-Type 是否为流式类型
  contentType := resp.Header.Get("Content-Type")
  if strings.Contains(contentType, "text/event-stream") ||
     strings.Contains(contentType, "application/stream+json") {
      return true, nil
  }
  ```

#### 2.4 JSON 模式检测
- **实现**: `server.go:8333-8470` (`testJSONMode`)
- **测试方法**:
  ```go
  requestBody := map[string]interface{}{
      "model": config.Model,
      "messages": []map[string]string{
          {"role": "user", "content": "Return a JSON object with a 'status' field set to 'ok'"},
      },
      "response_format": map[string]string{"type": "json_object"},
      "max_tokens":      50,
  }

  // 检查是否成功返回 JSON
  var result map[string]interface{}
  if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
      return true, nil
  }
  ```

#### 2.5 上下文窗口检测
- **实现**: 根据模型名称推断
- **默认值**:
  ```go
  // 常见模型的上下文窗口
  contextWindows := map[string]int{
      "gpt-4o":           128000,
      "gpt-4-turbo":      128000,
      "gpt-4":            8192,
      "gpt-3.5-turbo":    16385,
      "claude-3-5-sonnet": 200000,
      "deepseek-chat":    64000,
      "qwen-max":         32768,
  }
  ```

### 3. 手动开关实现

#### 3.1 配置结构
```go
type AIConfig struct {
    URL                   string `json:"url"`
    APIKey                string `json:"api_key"`
    Model                 string `json:"model"`
    Timeout               int    `json:"timeout"`

    // 手动开关（nil 表示自动检测）
    EnableFunctionCall    *bool  `json:"enable_function_call,omitempty"`
    EnableThinking        *bool  `json:"enable_thinking,omitempty"`
    EnableStreaming       *bool  `json:"enable_streaming,omitempty"`
    EnableJSONMode        *bool  `json:"enable_json_mode,omitempty"`

    // 上下文窗口覆盖（0 表示自动检测）
    ContextWindowOverride int    `json:"context_window_override,omitempty"`
}
```

#### 3.2 前端配置界面
- **位置**: `apps/data-ontology/index.html` 中的 AI 配置弹窗
- **配置项**:
  - API URL
  - API Key
  - Model（下拉选择 + 手动输入）
  - Timeout
  - Enable Function Call（复选框）
  - Enable Thinking（复选框）
  - Enable Streaming（复选框）
  - Enable JSON Mode（复选框）
  - Context Window Override（输入框）

#### 3.3 使用逻辑
```go
// server.go:8076-8095
// 优先使用手动设置
if config.EnableFunctionCall != nil {
    capabilities.SupportsFunctionCall = *config.EnableFunctionCall
    log.Printf("[AI能力检测] Function Call 已手动设置: %v", capabilities.SupportsFunctionCall)
}
if config.EnableThinking != nil {
    capabilities.SupportsThinking = *config.EnableThinking
}
if config.EnableStreaming != nil {
    capabilities.SupportsStreaming = *config.EnableStreaming
}
if config.EnableJSONMode != nil {
    capabilities.SupportsJSONMode = *config.EnableJSONMode
}
if config.ContextWindowOverride > 0 {
    capabilities.ContextWindow = config.ContextWindowOverride
}

// 如果所有能力都已手动设置，跳过自动检测
if config.EnableFunctionCall != nil && config.EnableThinking != nil &&
   config.EnableStreaming != nil && config.EnableJSONMode != nil &&
   config.ContextWindowOverride > 0 {
    log.Printf("[AI能力检测] 所有能力已手动设置，跳过自动检测")
    return capabilities, nil
}
```

### 4. 自适应调用策略

#### 4.1 根据能力调整请求
```go
// server.go:7957-8042
func callAIServiceWithCapabilities(config *AIConfig, capabilities *AICapabilities, prompt string) (string, error) {
    requestBody := map[string]interface{}{
        "model": config.Model,
        "messages": []map[string]string{
            {"role": "user", "content": prompt},
        },
        "temperature": 0.1,
    }

    // 如果支持 JSON 模式且需要结构化输出
    if capabilities != nil && capabilities.SupportsJSONMode {
        if strings.Contains(prompt, "JSON") || strings.Contains(prompt, "json") {
            requestBody["response_format"] = map[string]string{"type": "json_object"}
        }
    }

    // 如果支持 Extended Thinking
    if capabilities != nil && capabilities.SupportsThinking {
        // 可以添加 thinking 相关参数
    }

    // 发送请求...
}
```

#### 4.2 上下文窗口管理
```go
// server.go:7083-7087
// 根据上下文窗口大小截断历史
if aiCapabilities != nil && aiCapabilities.ContextWindow > 0 {
    // 为当前 prompt 和响应预留一半的上下文空间
    maxHistoryTokens := aiCapabilities.ContextWindow / 2
    queryReq.History = truncateHistoryForContext(queryReq.History, maxHistoryTokens)
}
```

#### 4.3 结果截断
```go
// server.go:7649-7737
// 截断结果供 AI 分析（避免超出上下文窗口）
resultsSummary := truncateResultsForAI(results, 20, 2000)
// maxRows: 最多 20 行
// maxChars: 每个字段最多 2000 字符
```

---

## 核心实现细节

### 1. 流式响应机制 (SSE)

#### 1.1 后端发送 SSE 事件
```go
// server.go 中的 sendSSE 函数
func sendSSE(w http.ResponseWriter, eventType string, data interface{}) {
    fmt.Fprintf(w, "event: %s\n", eventType)
    jsonData, _ := json.Marshal(data)
    fmt.Fprintf(w, "data: %s\n\n", jsonData)
}

// 使用示例
sendSSE(w, "thinking", map[string]interface{}{
    "message": "正在分析您的问题并生成SQL...",
})
flusher.Flush()  // 立即推送
```

#### 1.2 前端接收 SSE 流
```javascript
// apps/data-ontology/script.js:5193-5235
const response = await fetchWithAuth(`${API_BASE}/api/data-ontology/ai/query`, {
    method: 'POST',
    body: JSON.stringify({ message, databases, modules, history })
});

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
            console.warn('SSE JSON parse failed', err);
        }
    }
}
```

#### 1.3 SSE 事件类型
```javascript
// 后端发送的事件类型
event: start                    // 开始处理
event: thinking                 // 思考中
event: retry                    // 重试
event: sql_generated            // SQL 已生成
event: executing                // 执行 SQL
event: attempt_failed           // 尝试失败
event: success                  // 成功完成
event: confirm_write            // 待确认的写入操作
event: error                    // 错误
event: api_config_generated     // API 配置已生成
event: governance_task_draft    // 治理任务草稿
event: quality_rule_draft       // 质量规则草稿
event: small_model_draft        // 小模型配置
event: answer                   // 本体论查询答案
event: done                     // 完成
```

### 2. 上下文管理

#### 2.1 会话上下文结构
```javascript
// apps/data-ontology/script.js:67-71
let aiSessionContext = {
    databases: [],  // 当前上下文数据库
    modules: [],    // 当前上下文模块
    history: []     // 对话历史（最近 5 轮）
};
```

#### 2.2 上下文更新逻辑
```javascript
// apps/data-ontology/script.js:5130-5171
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

#### 3.1 提示词构建策略
```go
// server.go:7738-7792
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

#### 3.2 重试机制
```go
// server.go:7058-7318
// 最多重试 3 次
maxRetries := 3
for retry := 0; retry < maxRetries; retry++ {
    // 1. 构建提示词
    if retry == 0 {
        prompt = buildAIPrompt(userMessage, dbSchemas, modules)
    } else {
        prompt = buildRetryPrompt(userMessage, dbSchemas, lastError, attempts, modules)
    }

    // 2. 调用 AI
    aiResponse, err := callAIServiceWithCapabilities(aiConfig, aiCapabilities, prompt)

    // 3. 提取 SQL
    sql, dbID, responseText := parseAIResponse(aiResponse, dbSchemas)

    // 4. 检测写入操作
    if isWriteOperation(sql) {
        // 返回待确认状态
        sendSSE(w, "confirm_write", map[string]interface{}{
            "response": responseText,
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
            "attempt": retry + 1,
            "error":   err.Error(),
            "sql":     sql,
        })

        sendSSE(w, "attempt_failed", map[string]interface{}{
            "attempt": retry + 1,
            "error":   err.Error(),
            "sql":     sql,
        })

        lastError = err.Error()
        continue  // 继续重试
    }

    // 6. 成功
    sendSSE(w, "success", map[string]interface{}{
        "response": responseText,
        "sql":      sql,
        "results":  results,
        "attempts": attempts,
        "retries":  retry,
    })
    return
}

// 7. 所有尝试失败
sendSSE(w, "error", map[string]interface{}{
    "message":  "多次尝试后仍失败",
    "attempts": attempts,
})
```

#### 3.3 反思机制
```go
// server.go:7280-7318
// AI 分析查询结果是否回答了用户问题
if len(results) > 0 {
    // 截断结果供 AI 分析
    resultsSummary := truncateResultsForAI(results, 20, 2000)

    // 构建反思提示词
    reflectionPrompt := buildReflectionPrompt(userMessage, sql, resultsSummary, dbType)

    // 调用 AI 进行反思
    reflectionResponse, err := callAIService(aiConfig, reflectionPrompt)
    if err == nil {
        reflection := parseReflectionResponse(reflectionResponse)

        // 返回结果时包含反思
        sendSSE(w, "success", map[string]interface{}{
            "response":   responseText,
            "sql":        sql,
            "results":    results,
            "insight":    reflection.Insight,
            "confidence": reflection.Confidence,
            "attempts":   attempts,
            "retries":    retry,
        })
        return
    }
}
```

### 4. 写入操作确认

#### 4.1 检测写入操作
```go
// server.go
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

#### 4.2 前端确认流程
```javascript
// apps/data-ontology/script.js:5826-5900
case 'confirm_write':
    statusEl.innerHTML = '';
    const confirmId = 'confirm-' + messageId;
    contentEl.innerHTML = `
        <div style="margin-bottom: 6px;">${formatAIText(data.response)}</div>
        <div style="margin-top: 6px;">
            <div style="font-size: 12px; font-weight: 600; color: #4a5568;">待确认 SQL</div>
            <div class="ai-sql-block">${escapeHtml(data.sql)}</div>
        </div>
        <div class="ai-confirm-write" id="${confirmId}"
             data-sql="${encodeURIComponent(JSON.stringify(data.sql))}"
             data-db-id="${encodeURIComponent(JSON.stringify(data.dbId))}">
            <div class="ai-confirm-warning">
                <span class="ai-confirm-icon">⚠️</span>
                <span>检测到写入操作，请确认后再执行。</span>
            </div>
            <div class="ai-confirm-actions">
                <button class="btn ai-confirm-btn-yes"
                        onclick="executeConfirmedSQLFromElement('${confirmId}', '${messageId}')">
                    执行
                </button>
                <button class="btn ai-confirm-btn-no"
                        onclick="cancelConfirmedSQL('${confirmId}', '${messageId}')">
                    取消
                </button>
            </div>
        </div>
    `;
    break;
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
  │   ├─ db-manage → 默认 SQL 生成
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
  │   └─ callAIServiceWithCapabilities()
  │       ├─ 检查 AI 能力
  │       ├─ 构建请求体（根据能力调整）
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

6. **模型自适应**
   - 自动检测 AI 能力
   - 手动开关覆盖
   - 上下文窗口管理
   - 支持多种 LLM 服务

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

4. **能力检测**
   - 实际 API 调用测试
   - 自动适配不同模型
   - 手动开关灵活控制

### 未来优化方向

1. **性能优化**
   - 缓存数据库结构信息
   - 并行获取多个数据库的结构
   - 优化提示词长度

2. **功能增强**
   - 支持多 SQL 语句执行
   - 支持事务操作
   - 支持更复杂的业务逻辑
   - Function Call 深度集成

3. **用户体验**
   - SQL 编辑器集成
   - 历史查询收藏
   - 查询模板库
   - 可视化查询构建

4. **安全增强**
   - SQL 审计日志
   - 敏感数据脱敏
   - 细粒度权限控制
   - 速率限制

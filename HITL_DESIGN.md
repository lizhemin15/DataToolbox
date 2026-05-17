# HITL 人在环路架构设计

## 概述

在智能助手（集群模式）中，AI 智能体遇到不确定的情况时，通过 Tool 调用发起人在环路请求，前端渲染美观的交互卡片，用户操作后结果返回给智能体继续执行。

## 数据流

```
AI Agent → AskUserTool.Execute() → HITLManager.RegisterRequest()
                                       ↓ (SSE event: hitl_interaction)
                                   前端渲染交互卡片
                                       ↓ (用户操作)
                                   POST /api/ai/hitl/respond
                                       ↓
                                   HITLManager.SubmitResponse()
                                       ↓ (channel)
                                   AskUserTool 收到响应 → 返回 ToolResult
                                   AI Agent 继续执行
```

## 后端组件

### 1. HITLManager (已有: agent/hitl_manager.go)
- 全局单例，管理 HITL 请求生命周期
- RegisterRequest: 注册请求，返回 <-chan HITLResponse
- SubmitResponse: 用户提交响应，唤醒阻塞的 Tool
- GetPendingRequests: 查询挂起请求（页面刷新恢复）
- Cleanup: session 结束时清理

### 2. AskUserTool (新增: agent/ask_user_tool.go)
- 实现 PicoClaw Tool 接口
- Name: "ask_user"
- AI 自行决定何时调用（如：需要确认、需要选择数据库、需要补充信息）
- Execute 流程:
  1. 构建 HITLRequest
  2. 通过 HITLManager.RegisterRequest 注册
  3. 通过 SSE 推送 hitl_interaction 事件到前端
  4. 阻塞等待 channel 响应（带超时）
  5. 将用户响应序列化为 JSON 返回给 AI

### 3. HITL API 端点 (新增: ai_api_handlers.go)
- POST /api/hitl/respond — 用户提交响应
- GET /api/hitl/pending?session_id=xxx — 查询挂起请求

### 4. SSE 事件类型 (新增: agent/agent.go)
- EventTypeHITL = "hitl_interaction" — 人在环路交互请求

### 5. Orchestrator 集成
- AskUserTool 持有 HITLManager 引用
- 注册到所有 agent 的 ToolRegistry
- AGENT.md tools 列表添加 ask_user

## 前端组件

### 1. HITL 交互卡片 (script.js)
- handleClusterEventV2 新增 case 'hitl_interaction'
- 根据 interaction_type 渲染不同卡片:
  - confirm: 确认/取消按钮
  - single_select: 单选列表
  - multi_select: 多选 checkbox 列表
  - input: 文本输入框
  - form: 多字段表单

### 2. 卡片样式 (style.css)
- .hitl-card: 卡片容器
- .hitl-title / .hitl-description: 标题描述
- .hitl-option: 选项按钮
- .hitl-input: 输入框
- .hitl-actions: 操作按钮区
- 毛玻璃 + 渐变 + 微动画

### 3. 响应提交
- 用户操作后 POST /api/ai/hitl/respond
- 卡片变为"已响应"状态

## 交互类型详细设计

### confirm (二次确认)
```json
{
  "interaction_type": "confirm",
  "title": "确认执行写入操作",
  "description": "即将执行 DELETE FROM users WHERE id = 1",
  "options": [
    {"id": "yes", "label": "确认执行", "style": "primary"},
    {"id": "no", "label": "取消", "style": "danger"}
  ]
}
```

### single_select (单选)
```json
{
  "interaction_type": "single_select",
  "title": "请选择数据库",
  "description": "检测到多个数据库，请选择要操作的数据库",
  "options": [
    {"id": "db1", "label": "生产库", "description": "MySQL, 128张表"},
    {"id": "db2", "label": "测试库", "description": "PostgreSQL, 45张表"}
  ]
}
```

### multi_select (多选)
```json
{
  "interaction_type": "multi_select",
  "title": "选择要包含的表",
  "description": "以下表与您的查询相关，请选择需要查询的表",
  "options": [
    {"id": "users", "label": "users", "description": "用户表, 15列"},
    {"id": "orders", "label": "orders", "description": "订单表, 22列"}
  ]
}
```

### input (填空)
```json
{
  "interaction_type": "input",
  "title": "补充查询条件",
  "description": "请输入要查询的用户ID",
  "fields": [
    {"id": "user_id", "label": "用户ID", "type": "text", "placeholder": "例如: 10001", "required": true}
  ]
}
```

### form (表单)
```json
{
  "interaction_type": "form",
  "title": "创建API接口",
  "description": "请确认接口参数",
  "fields": [
    {"id": "name", "label": "接口名称", "type": "text", "required": true},
    {"id": "method", "label": "请求方法", "type": "select", "options": [{"id": "GET", "label": "GET"}, {"id": "POST", "label": "POST"}]},
    {"id": "description", "label": "接口描述", "type": "textarea", "placeholder": "可选"}
  ]
}
```

---
name: create-api-with-mcp
description: 使用 MCP 工具快速创建数据接口的最佳实践（含人在环路交互）
tags: [mcp, api, create, best-practice, hitl]
version: 2.0.0
---

# 使用 MCP 创建数据接口

## 核心原则

**关键决策必须与用户确认！** 在执行不可逆操作前，使用 `ask_user` 工具让用户审核和修改。

## 触发条件

用户要求创建数据接口/API，或提到"创建接口"、"新增接口"、"添加接口"。

## 工作流程

### 1. 确认数据库和表

调用 `get_tables` 确认目标数据库有连接：

```
调用: get_tables
参数: {"database_id": "<数据库名或ID>"}
```

如果返回错误，先检查数据库配置。

### 2. 了解表结构

调用 `describe_table` 获取字段信息：

```
调用: describe_table
参数: {"database_id": "<数据库ID>", "table_name": "<表名>"}
```

### 3. 设计接口方案

根据表结构，设计接口的：
- 名称
- 路径（如 `/api/users`）
- 方法（GET/POST）
- SQL 语句
- 参数定义

### 4. ⚠️ 关键步骤：用户确认（必须执行）

**在创建接口之前，必须使用 `ask_user` 工具让用户确认方案！**

```
调用: ask_user
参数: {
  "interaction_type": "form",
  "title": "确认接口配置",
  "description": "请审核以下接口配置，确认无误后提交，或修改需要调整的字段。",
  "fields": [
    {
      "id": "name",
      "label": "接口名称",
      "type": "text",
      "default_value": "<设计的名称>",
      "required": true
    },
    {
      "id": "path",
      "label": "接口路径",
      "type": "text",
      "default_value": "<设计的路径>",
      "required": true
    },
    {
      "id": "method",
      "label": "HTTP 方法",
      "type": "select",
      "default_value": "GET",
      "options": [
        {"id": "GET", "label": "GET"},
        {"id": "POST", "label": "POST"}
      ],
      "required": true
    },
    {
      "id": "sql",
      "label": "SQL 语句",
      "type": "textarea",
      "default_value": "<设计的 SQL>",
      "required": true
    },
    {
      "id": "description",
      "label": "接口描述",
      "type": "text",
      "default_value": "<设计的描述>",
      "required": false
    }
  ]
}
```

**用户响应处理**：
- 用户点击"提交" → 使用用户修改后的值创建接口
- 用户点击"取消" → 不创建接口，询问用户需要什么调整
- 超时 → 提示用户响应超时，等待用户重新发起请求

### 5. 创建接口

使用用户确认后的参数调用 `create_api`：

```
调用: create_api
参数: {
  "name": "<用户确认的名称>",
  "path": "<用户确认的路径>",
  "method": "<用户确认的方法>",
  "sql": "<用户确认的 SQL>",
  "database": "<数据库名>",
  "description": "<用户确认的描述>"
}
```

### 6. 测试接口

创建后调用 `execute_api` 测试：

```
调用: execute_api
参数: {"path": "<接口路径>", "params": {"参数名": "测试值"}}
```

### 7. 汇报结果

向用户汇报：
- 接口已创建成功
- 测试结果（返回的数据样例）
- 如何使用该接口

## SQL 参数占位符规则

使用 `:param_name` 格式（冒号+参数名），例如：

```sql
SELECT * FROM users WHERE status = :status AND name LIKE :name
```

## 常见错误

### ❌ 错误：直接创建不确认

```
错误: 没有让用户审核，直接调用 create_api
原因: 用户可能对接口名称、路径、SQL 有不同意见
后果: 创建了不符合用户预期的接口，需要删除重建
```

### ❌ 错误：SQL 参数格式错误

```
错误: 使用 ? 或 $1 作为占位符
正确: 使用 :param_name 格式
```

### ❌ 错误：不检查表结构

```
错误: 凭记忆写字段名
原因: 没有先调用 describe_table
后果: SQL 执行报错，字段不存在
```

## 人机交互（HITL）使用场景

| 场景 | interaction_type | 说明 |
|------|-----------------|------|
| 确认接口配置 | form | 让用户审核和修改所有字段 |
| 选择表 | single_select | 多个候选表时让用户选择 |
| 确认危险操作 | confirm | 删除接口、执行写操作前确认 |
| 输入自定义参数 | input | 用户需要提供特定参数值 |

## 示例对话

```
用户: 帮我创建一个查询用户列表的接口

智能体:
1. 调用 get_tables 确认数据库连接
2. 调用 describe_table 获取 users 表结构
3. 发现字段: id, name, email, status, created_at
4. 设计接口方案：
   - name: 用户列表查询
   - path: /api/users
   - method: GET
   - sql: SELECT id, name, email, status FROM users WHERE status = :status LIMIT 100
5. ⚠️ 调用 ask_user 让用户确认方案（form 类型）
6. 用户审核后点击提交（可能修改了 SQL 或名称）
7. 使用用户确认的值调用 create_api
8. 调用 execute_api 测试接口
9. 汇报结果给用户
```

## 注意事项

- **永远先检查表结构**，不要凭记忆或猜测写字段名
- **SQL 使用冒号参数**，不是问号或美元符号
- **创建前必须让用户确认**，这是不可逆操作
- **创建后必须测试**，确保接口可用
- **遇到错误分析原因**，不要重复相同操作
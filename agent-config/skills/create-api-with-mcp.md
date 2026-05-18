---
name: create-api-with-mcp
description: 使用 MCP 工具快速创建数据接口的最佳实践
tags: [mcp, api, create, best-practice]
version: 1.0.0
---

# 使用 MCP 创建数据接口

## 触发条件

用户要求创建数据接口/API，或提到"创建接口"、"新增接口"、"添加接口"。

## 工作流程

### 1. 确认数据库和表

**先调用 `get_tables` 确认目标数据库有连接**，不要直接写 SQL：

```
调用: get_tables
参数: {"database_id": "<数据库名或ID>"}

期望结果: 返回表列表，确认数据库可连接
```

如果返回错误，先检查数据库配置。

### 2. 了解表结构

**调用 `describe_table` 获取字段信息**，不要猜测字段名：

```
调用: describe_table
参数: {"database_id": "<数据库ID>", "table_name": "<表名>"}

期望结果: 返回列名、类型、是否可空等信息
```

### 3. 编写 SQL 并创建接口

**根据表结构编写 SQL**，然后调用 `create_api`：

```
调用: create_api
参数: {
  "name": "<接口名称>",
  "path": "<接口路径，如 /api/users>",
  "method": "GET 或 POST",
  "sql": "<SQL 语句，使用 :param 作为参数占位符>",
  "database": "<数据库名>",
  "description": "<接口描述>"
}
```

**SQL 参数占位符规则**：
- 使用 `:param_name` 格式（冒号+参数名）
- 例如：`SELECT * FROM users WHERE status = :status AND name LIKE :name`

### 4. 测试接口

**创建后立即调用 `execute_api` 测试**：

```
调用: execute_api
参数: {"path": "<接口路径>", "params": {"参数名": "值"}}
```

## 常见错误

### ❌ 错误：直接写 SQL 不检查表结构

```
错误: 字段名拼写错误、类型不匹配
原因: 没有先调用 describe_table 确认字段
```

### ❌ 错误：SQL 参数格式错误

```
错误: 使用 ? 或 $1 作为占位符
正确: 使用 :param_name 格式
```

### ❌ 错误：创建后不测试

```
错误: 接口创建成功但实际执行报错
原因: 没有调用 execute_api 验证
```

## 人机交互（HITL）卡片

当需要用户确认或输入时，系统会弹出交互卡片。智能体应：

1. **等待用户响应** - 不要假设用户的选择
2. **根据用户输入调整** - 用户可能修改 SQL 或参数
3. **遇到错误主动重试** - 不要卡在错误上，尝试修复

## 示例对话

```
用户: 帮我创建一个查询用户列表的接口

智能体: 
1. 调用 get_tables 确认数据库连接
2. 调用 describe_table 获取 users 表结构
3. 发现字段: id, name, email, status, created_at
4. 调用 create_api 创建接口
5. 调用 execute_api 测试接口
6. 返回结果给用户
```

## 注意事项

- **永远先检查表结构**，不要凭记忆或猜测写字段名
- **SQL 使用冒号参数**，不是问号或美元符号
- **创建后必须测试**，确保接口可用
- **遇到错误分析原因**，不要重复相同操作

---
name: query-database-with-mcp
description: 使用 MCP 工具查询数据库的最佳实践
tags: [mcp, database, query, sql]
version: 1.0.0
---

# 使用 MCP 查询数据库

## 触发条件

用户要求查询数据、执行 SQL、查看表数据等。

## 工作流程

### 1. 确认数据库

```
调用: list_databases
期望结果: 返回可用数据库列表
```

### 2. 查看表列表

```
调用: get_tables
参数: {"database_id": "<数据库ID>"}

期望结果: 返回该数据库的所有表
```

### 3. 查看表结构

```
调用: describe_table
参数: {"database_id": "<数据库ID>", "table_name": "<表名>"}
```

或获取完整 schema：

```
调用: get_db_schema
参数: {"database_id": "<数据库ID>"}
```

### 4. 执行查询

```
调用: execute_sql
参数: {
  "database_id": "<数据库ID>",
  "sql": "<SELECT 语句>",
  "params": []  // 可选参数
}
```

## 安全提示

- **写操作需谨慎**（INSERT/UPDATE/DELETE），建议先确认
- **使用 LIMIT** 限制返回行数，避免大量数据传输
- **复杂查询先 EXPLAIN** 确认执行计划

## SQL 方言提示

不同数据库语法不同，调用 `get_db_sql_hints` 获取：

```
调用: get_db_sql_hints
参数: {"database_id": "<数据库ID>"}

返回: 数据库类型和方言特性说明
```

## 示例

```
用户: 查询最近 10 条订单

智能体:
1. get_tables 确认 orders 表存在
2. describe_table 确认字段名
3. execute_sql 执行: SELECT * FROM orders ORDER BY created_at DESC LIMIT 10
4. 格式化结果返回用户
```

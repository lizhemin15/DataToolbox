# DataToolbox MCP工具极端测试案例设计

## 一、上下文爆炸场景

### 1. 大量数据库
- **场景**: 配置100+数据库连接
- **问题**: `list_databases` 返回完整列表，上下文爆炸
- **测试**: 创建100个数据库配置，调用list_databases

### 2. 大量表
- **场景**: 达梦数据库有500+张表
- **问题**: `get_db_schema` 返回所有表和字段，可能几十KB
- **测试**: 模拟500张表的schema

### 3. 大量API
- **场景**: 创建200+个动态API
- **问题**: `list_apis` 返回完整列表
- **测试**: 批量创建200个API

### 4. 大量治理任务
- **场景**: 50+治理任务，每个任务配置很长
- **问题**: `governance_tasks` 返回完整配置
- **测试**: 创建50个任务

### 5. 大量查询结果
- **场景**: SQL返回10000行
- **问题**: `execute_sql` 返回全部数据
- **测试**: SELECT * FROM 大表

## 二、达梦数据库特有场景

### 1. SCHEMA前缀问题
- **场景**: 表名需要带SCHEMA前缀
- **测试**: 
  - `SELECT * FROM "SCHEMA"."TABLE"` ✓
  - `SELECT * FROM TABLE` ✗ (可能失败)

### 2. FETCH FIRST语法
- **场景**: 达梦不支持LIMIT，用FETCH FIRST
- **测试**:
  - `SELECT * FROM T FETCH FIRST 10 ROWS ONLY` ✓
  - `SELECT * FROM T LIMIT 10` ✗

### 3. 双引号标识符
- **场景**: 表名/字段名含特殊字符或关键字
- **测试**:
  - `SELECT "USER", "ORDER" FROM "PUBLIC"."TABLE"` ✓

### 4. ROWNUM分页
- **场景**: 老版本达梦用ROWNUM
- **测试**:
  - `SELECT * FROM T WHERE ROWNUM <= 10` ✓

### 5. 空表查询
- **场景**: 表存在但无数据
- **测试**: 返回空数组，不报错

### 6. 特殊字符数据
- **场景**: 数据含emoji、中文、特殊符号
- **测试**: 确保编码正确

### 7. NULL值处理
- **场景**: 字段值为NULL
- **测试**: 返回null而非空字符串

### 8. 大字段(CLOB/BLOB)
- **场景**: 达梦CLOB字段
- **测试**: 截断或特殊处理

### 9. 超长表名/字段名
- **场景**: 达梦支持128字符标识符
- **测试**: 极限长度名称

### 10. 事务隔离
- **场景**: 并发查询
- **测试**: 多个execute_sql同时执行

## 三、工具调用边界

### 1. 参数缺失
- `execute_sql` 无database参数
- `get_table_schema` 无table参数
- `create_api` 缺少必要字段

### 2. 参数类型错误
- database传数字而非字符串
- sql传对象而非字符串

### 3. 不存在的资源
- 查询不存在的数据库
- 查询不存在的表
- 执行不存在的API

### 4. SQL注入尝试
- `SELECT * FROM users WHERE id = '1; DROP TABLE users;--'`
- 应被拦截或安全处理

### 5. 超大SQL
- 100KB的SQL语句
- 应拒绝或截断

### 6. 并发调用
- 同时调用10个工具
- 检查资源竞争

## 四、优化方案

### 1. 列表类返回优化

#### list_databases
```go
// 返回摘要而非完整信息
{
  "total": 100,
  "databases": [
    {"id": "xxx", "name": "DM", "type": "dm"},  // 只返回核心字段
    ...
  ],
  "hint": "Use get_database(name) for full details"
}
```

#### list_apis
```go
// 按类型分组 + 摘要
{
  "total": 200,
  "by_type": {
    "query": 150,
    "forward": 50
  },
  "apis": [
    {"name": "...", "path": "...", "type": "query", "description": "..."},  // 不返回sql/forward_url
  ],
  "hint": "Use get_api_detail(name) for full config"
}
```

#### list_tables
```go
// 支持分页 + 搜索
{
  "total": 500,
  "page": 1,
  "page_size": 50,
  "tables": [...],  // 只返回当前页
  "hint": "Use search_tables(query) to find specific tables"
}
```

#### get_db_schema
```go
// 支持选择性返回
{
  "database": "DM",
  "total_tables": 500,
  "total_columns": 5000,
  // 选项1: 只返回表名列表
  "table_names": ["T1", "T2", ...],
  // 选项2: 返回匹配的表（RAG）
  "matched_tables": [...],  // 根据query参数筛选
  "hint": "Use get_table_schema(table) for column details"
}
```

#### governance_tasks
```go
// 返回摘要列表
{
  "total": 50,
  "tasks": [
    {"id": "xxx", "name": "...", "status": "pending"},  // 不返回完整配置
  ],
  "hint": "Use get_governance_task(id) for full config"
}
```

### 2. RAG增强

#### search_tables增强
```go
// 语义搜索表名+注释
POST /api/v1/retrieval/search
{
  "query": "用户相关的表",
  "database": "DM",
  "mode": "semantic",  // 新增：语义搜索模式
  "top_k": 10
}
// 返回: 按相关度排序的表，附带匹配原因
```

#### get_db_schema增强
```go
// 支持query参数，只返回相关表
GET /api/v1/databases/{id}?query=用户
// 返回: 只包含名称匹配的表的schema
```

### 3. execute_sql安全

```go
// 自动限制返回行数
{
  "success": true,
  "data": [...],  // 最多100行
  "columns": [...],
  "total_rows": 10000,  // 告知实际总数
  "truncated": true,
  "hint": "Add LIMIT/FETCH FIRST to get specific rows"
}
```

### 4. 工具描述优化

更新工具描述，引导AI正确使用：
- 先用search_tables缩小范围
- 再用get_table_schema获取详情
- 避免直接调用get_db_schema（除非必要）

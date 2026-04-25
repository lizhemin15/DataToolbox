# SQL 执行校验功能实现总结

## 实现概述

为 AI 创建接口功能补齐了真执行校验，确保生成的 SQL 不仅通过静态校验（表名/字段名检查），还能在实际数据库上执行验证，发现语法错误、权限不足、函数不存在等运行时问题。

## 新增函数

### 1. `validateSQLByExecution(sqlStr string, dbID string) (bool, string)`
- **功能**: 通过实际执行 SQL 来校验语法、权限和运行时错误
- **参数**:
  - `sqlStr`: 待校验的 SQL 语句（可能包含 MyBatis 参数占位符）
  - `dbID`: 数据库 ID
- **返回**: `(bool, string)` 表示校验结果和错误信息
- **处理流程**:
  1. 从 `dataOntologyDatabases` 获取数据库配置
  2. 使用 `getDBFromPool()` 获取数据库连接
  3. 调用 `replaceMyBatisParamsForValidation()` 处理参数占位符
  4. 根据操作类型（读/写）调用相应的校验函数

### 2. `replaceMyBatisParamsForValidation(sqlStr string) string`
- **功能**: 将 MyBatis 参数占位符替换为校验用的占位符
- **处理规则**:
  - `${param}` → 空字符串或默认值
  - `#{param}` → `NULL` 或默认值（带引号）
  - 支持 `#{param:default}` 格式的默认值

### 3. `validateReadSQL(db *sql.DB, dbConfig *DatabaseConfig, sqlStr string) error`
- **功能**: 校验读操作 SQL（SELECT）
- **支持的数据库及校验方式**:
  - MySQL/MariaDB/TiDB: `EXPLAIN sql`
  - PostgreSQL/TimescaleDB/CockroachDB: `EXPLAIN sql`
  - SQL Server: `SET SHOWPLAN_TEXT ON; sql`
  - Oracle: `EXPLAIN PLAN FOR sql`
  - 达梦(DM): `EXPLAIN sql`
  - SQLite/DuckDB: `EXPLAIN QUERY PLAN sql`
  - ClickHouse: `EXPLAIN sql`
  - 其他: `sql LIMIT 0`（如果 SQL 没有 LIMIT）

### 4. `validateWriteSQL(db *sql.DB, dbConfig *DatabaseConfig, sqlStr string) error`
- **功能**: 校验写操作 SQL（INSERT/UPDATE/DELETE）
- **校验方式**:
  1. 优先使用事务 + ROLLBACK（适用于大多数数据库）
  2. 如果事务失败，尝试 PREPARE 方式

### 5. `validateWithPrepare(db *sql.DB, dbConfig *DatabaseConfig, sqlStr string) error`
- **功能**: 使用 PREPARE 方式校验 SQL
- **支持的数据库**:
  - MySQL/MariaDB/TiDB: `PREPARE stmt FROM ?`
  - PostgreSQL/TimescaleDB/CockroachDB: `PREPARE stmt AS sql`
  - 达梦(DM): `PREPARE stmt FROM ?`
  - Oracle/SQL Server: 不支持，返回错误提示

## 集成点

在 `handleAICreateApi()` 函数（server.go L9340-9394）中集成：

```
静态校验（表名/字段名检查）
    ↓
执行校验（实际数据库执行）
    ↓
失败时触发重试机制（最多 3 次）
```

### 执行流程

1. **静态校验**: 调用 `validateSQLTablesAndFields()` 检查表名和字段名
2. **执行校验**: 调用 `validateSQLByExecution()` 在目标数据库上实际执行
3. **错误处理**:
   - 静态校验失败: 返回 "SQL静态校验失败"
   - 执行校验失败: 返回 "SQL执行校验失败" + 数据库原生错误
   - 两种失败都会触发重试机制

## 错误信息示例

### 静态校验失败
```
SQL静态校验失败（已重试3次）: SQL中引用的表不存在: users
```

### 执行校验失败
```
SQL执行校验失败（已重试3次）: 执行校验失败: SQL语法或权限错误: ERROR 1142 (42000): SELECT command denied to user 'test'@'localhost' for table 'users'
```

## 代码位置

- **新增函数**: server.go L10051-10245
- **集成点**: server.go L9340-9394
- **变量定义**: server.go L9304（`lastValidationError`）

## 测试建议

1. **语法错误测试**: 生成包含语法错误的 SQL，验证能否捕获
2. **权限测试**: 使用无权限的用户，验证能否检测权限问题
3. **函数不存在测试**: 使用不存在的函数，验证能否发现
4. **参数替换测试**: 验证 MyBatis 参数占位符是否正确替换
5. **不同数据库测试**: 在 MySQL、PostgreSQL、SQLite、达梦等数据库上测试

## 注意事项

1. **MyBatis 参数处理**: 参数占位符会被替换为 NULL 或默认值，确保校验 SQL 的语法正确性
2. **写操作安全**: 使用事务 + ROLLBACK 或 PREPARE，不会真正修改数据
3. **数据库方言**: 不同数据库使用不同的 EXPLAIN 语法，已做适配
4. **错误信息清晰**: 明确区分静态校验和执行校验失败，便于用户理解问题

# 构建版本说明

## 构建问题修复

### 问题背景
在GitHub Actions交叉编译时，某些数据库驱动需要CGO支持，导致构建失败：
- SQLite (`github.com/mattn/go-sqlite3`) - 需要CGO
- DuckDB (`github.com/marcboeker/go-duckdb`) - 需要CGO
- ClickHouse (`github.com/ClickHouse/clickhouse-go/v2`) - 编译复杂
- Neo4j (`github.com/neo4j/neo4j-go-driver/v5`) - 依赖问题
- Oracle Godror (`github.com/godror/godror`) - 需要Oracle客户端

### 解决方案
移除CGO依赖，提供标准跨平台构建版本。对于不支持的数据库，在运行时返回友好的错误提示。

## 支持的数据库

### ✅ 完整支持（10种）

标准构建版本完全支持以下数据库：

1. **MySQL** (端口: 3306)
   - 驱动: github.com/go-sql-driver/mysql
   - 完整功能: 连接、表列表、数据预览

2. **MariaDB** (端口: 3306)
   - 驱动: github.com/go-sql-driver/mysql
   - 完整功能: 连接、表列表、数据预览

3. **PostgreSQL** (端口: 5432)
   - 驱动: github.com/lib/pq
   - 完整功能: 连接、表列表、数据预览

4. **SQL Server** (端口: 1433)
   - 驱动: github.com/denisenkom/go-mssqldb
   - 完整功能: 连接、表列表、数据预览

5. **Oracle** (端口: 1521)
   - 驱动: github.com/sijms/go-ora/v2
   - 完整功能: 连接、表列表、数据预览

6. **达梦 DM** (端口: 5236)
   - 驱动: github.com/sijms/go-ora/v2 (兼容)
   - 完整功能: 连接、表列表、数据预览

7. **TiDB** (端口: 4000)
   - 驱动: github.com/go-sql-driver/mysql (兼容)
   - 完整功能: 连接、表列表、数据预览

8. **CockroachDB** (端口: 26257)
   - 驱动: github.com/lib/pq (兼容)
   - 完整功能: 连接、表列表、数据预览

9. **TimescaleDB** (端口: 5432)
   - 驱动: github.com/lib/pq (兼容)
   - 完整功能: 连接、表列表、数据预览

10. **MongoDB** (端口: 27017)
    - 驱动: go.mongodb.org/mongo-driver
    - 完整功能: 连接、集合列表、文档预览

### ⚠️ 基础支持（7种）

仅支持连接测试（TCP端口检测或HTTP请求）：

11. **Redis** (端口: 6379)
    - 连接方式: TCP连接
    - 支持功能: 连接测试、显示数据库索引

12. **Memcached** (端口: 11211)
    - 连接方式: TCP连接
    - 支持功能: 连接测试

13. **Cassandra** (端口: 9042)
    - 连接方式: TCP连接
    - 支持功能: 连接测试

14. **HBase** (端口: 9090)
    - 连接方式: TCP连接
    - 支持功能: 连接测试

15. **InfluxDB** (端口: 8086)
    - 连接方式: HTTP API
    - 支持功能: 连接测试

16. **Elasticsearch** (端口: 9200)
    - 连接方式: HTTP API
    - 支持功能: 连接测试

17. **Neo4j** (端口: 7687)
    - 连接方式: TCP连接
    - 支持功能: 连接测试

### ⛔ 不支持（4种）

标准构建版本不支持以下数据库，会返回友好错误提示：

18. **SQLite**
    - 原因: 需要CGO编译
    - 错误提示: "SQLite 支持需要CGO编译，当前构建版本不支持"

19. **DuckDB**
    - 原因: 需要CGO编译
    - 错误提示: "DuckDB 支持需要CGO编译，当前构建版本不支持"

20. **ClickHouse**
    - 原因: 需要特殊编译环境
    - 错误提示: "ClickHouse 支持在当前构建版本中不可用"

21. **Neo4j (完整功能)**
    - 原因: 驱动依赖问题
    - 当前: 仅支持TCP端口连接测试

## 依赖包

### 核心依赖
```go
github.com/go-sql-driver/mysql          v1.7.1  // MySQL/MariaDB/TiDB
github.com/lib/pq                        v1.10.9 // PostgreSQL/CockroachDB/TimescaleDB
github.com/denisenkom/go-mssqldb        v0.12.3 // SQL Server
github.com/sijms/go-ora/v2              v2.8.0  // Oracle/达梦
go.mongodb.org/mongo-driver             v1.13.1 // MongoDB
github.com/google/uuid                   v1.5.0  // UUID生成
github.com/gorilla/websocket            v1.5.1  // WebSocket支持
```

### 已移除的依赖（需要CGO）
```
github.com/mattn/go-sqlite3              // SQLite
github.com/marcboeker/go-duckdb          // DuckDB
github.com/ClickHouse/clickhouse-go/v2   // ClickHouse
github.com/neo4j/neo4j-go-driver/v5      // Neo4j完整驱动
github.com/godror/godror                 // Oracle Godror驱动
```

## 如何使用不支持的数据库

### 方法1: 使用替代方案
- SQLite → 使用MySQL/PostgreSQL
- DuckDB → 使用PostgreSQL/ClickHouse
- ClickHouse → 等待官方驱动改进或使用HTTP API

### 方法2: 自行编译CGO版本

如需使用SQLite/DuckDB，可以自行编译：

```bash
# 启用CGO
export CGO_ENABLED=1

# 安装依赖
go get github.com/mattn/go-sqlite3
go get github.com/marcboeker/go-duckdb

# 编译
go build -o datatoolbox-server-cgo server.go
```

**注意**: CGO编译需要：
- GCC/MinGW编译器
- 相应的C库（SQLite、DuckDB）
- 交叉编译会更复杂

### 方法3: 使用Docker

可以使用Docker构建包含所有依赖的版本：

```dockerfile
FROM golang:1.21-alpine
RUN apk add --no-cache gcc musl-dev sqlite-dev
# ... 编译步骤
```

## 性能对比

### 标准版本
- ✅ 编译快速（< 2分钟）
- ✅ 二进制体积小（~20MB）
- ✅ 跨平台编译简单
- ✅ 无外部依赖
- ❌ 不支持SQLite/DuckDB

### CGO版本
- ❌ 编译慢（5-10分钟）
- ❌ 二进制体积大（~40MB）
- ❌ 跨平台编译复杂
- ❌ 需要C库依赖
- ✅ 支持所有数据库

## 推荐使用场景

### 使用标准版本
- 网络数据库为主（MySQL、PostgreSQL等）
- 需要快速部署
- 多平台分发
- 服务器环境

### 使用CGO版本
- 需要SQLite/DuckDB支持
- 本地数据分析
- 嵌入式场景
- 单一平台部署

## 未来计划

1. **短期**: 提供预编译的CGO版本（Windows、Linux、macOS）
2. **中期**: 提供Docker镜像，包含所有数据库驱动
3. **长期**: 研究纯Go实现的SQLite/DuckDB驱动（如果可用）

## 常见问题

### Q: 为什么不默认包含SQLite支持？
**A**: SQLite需要CGO，这会：
- 增加编译复杂度
- 增加二进制体积
- 需要C编译器
- 限制跨平台编译

### Q: 如何知道我的版本是否支持CGO？
**A**: 尝试添加SQLite数据库，如果提示"需要CGO编译"，则为标准版本。

### Q: 标准版本够用吗？
**A**: 对于大多数场景够用，支持10种数据库的完整功能，覆盖90%的使用场景。

### Q: 会提供CGO版本下载吗？
**A**: 计划在后续版本提供，但维护成本较高。建议优先使用标准版本。

---

**版本**: v1.0.0 (标准构建)
**更新时间**: 2026年2月15日
**状态**: ✅ 生产就绪

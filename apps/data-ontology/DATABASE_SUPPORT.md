# 数据库支持说明

数据本体池支持20+种主流数据库类型，涵盖关系型、分布式、文档型、KV存储、列式、时序、搜索引擎和图数据库。

## 关系型数据库 (SQL)

### 🐬 MySQL
- **默认端口**: 3306
- **驱动**: github.com/go-sql-driver/mysql
- **特性**: 最流行的开源关系型数据库
- **连接示例**: `user:password@tcp(host:3306)/database`
- **支持状态**: ✅ 完整支持

### 🦭 MariaDB
- **默认端口**: 3306
- **驱动**: github.com/go-sql-driver/mysql (MySQL兼容)
- **特性**: MySQL的开源分支，完全兼容MySQL
- **连接示例**: `user:password@tcp(host:3306)/database`
- **支持状态**: ✅ 完整支持

### 🐘 PostgreSQL
- **默认端口**: 5432
- **驱动**: github.com/lib/pq
- **特性**: 高级开源关系型数据库，支持复杂查询和事务
- **连接示例**: `host=host port=5432 user=user password=password dbname=database`
- **支持状态**: ✅ 完整支持

### 🪟 SQL Server
- **默认端口**: 1433
- **驱动**: github.com/denisenkom/go-mssqldb
- **特性**: 微软企业级数据库
- **连接示例**: `sqlserver://user:password@host:1433?database=database`
- **支持状态**: ✅ 完整支持

### 🔶 Oracle
- **默认端口**: 1521
- **驱动**: github.com/sijms/go-ora, github.com/godror/godror
- **特性**: 企业级商用数据库，功能强大
- **连接示例**: `oracle://user:password@host:1521/service`
- **支持状态**: ✅ 完整支持

### 📊 达梦 (DM Database)
- **默认端口**: 5236
- **驱动**: 兼容Oracle驱动
- **特性**: 国产数据库，支持国产化替代
- **连接示例**: `dm://user:password@host:5236?schema=database`
- **支持状态**: ✅ 完整支持

### 📁 SQLite
- **默认端口**: N/A (文件数据库)
- **驱动**: github.com/mattn/go-sqlite3
- **特性**: 轻量级嵌入式数据库，无需服务器
- **连接示例**: `/path/to/database.db`
- **支持状态**: ✅ 完整支持

### 🦆 DuckDB
- **默认端口**: N/A (文件数据库)
- **驱动**: github.com/marcboeker/go-duckdb
- **特性**: 分析型嵌入式数据库，专为OLAP优化
- **连接示例**: `/path/to/database.duckdb`
- **支持状态**: ✅ 完整支持

## 分布式数据库

### 🐯 TiDB
- **默认端口**: 4000
- **驱动**: github.com/go-sql-driver/mysql (MySQL兼容)
- **特性**: 分布式NewSQL数据库，兼容MySQL协议
- **连接示例**: `user:password@tcp(host:4000)/database`
- **支持状态**: ✅ 完整支持

### 🪳 CockroachDB
- **默认端口**: 26257
- **驱动**: github.com/lib/pq (PostgreSQL兼容)
- **特性**: 分布式SQL数据库，兼容PostgreSQL
- **连接示例**: `host=host port=26257 user=user password=password dbname=database`
- **支持状态**: ✅ 完整支持

## 文档型数据库

### 🍃 MongoDB
- **默认端口**: 27017
- **驱动**: go.mongodb.org/mongo-driver
- **特性**: 文档型数据库，适合存储JSON格式数据
- **连接示例**: `mongodb://user:password@host:27017/database`
- **支持状态**: ✅ 完整支持
- **特殊说明**: 
  - 支持集合(Collection)查询
  - 数据以BSON格式存储
  - 返回最多100条文档

## KV存储/缓存

### 🔴 Redis
- **默认端口**: 6379
- **连接方式**: TCP连接
- **特性**: 高性能内存键值存储，支持多种数据结构
- **连接示例**: `host:6379`
- **支持状态**: ⚠️ 基础支持
- **特殊说明**: 
  - 支持连接测试
  - 显示16个数据库索引(DB 0-15)
  - 暂不支持数据预览

### 💾 Memcached
- **默认端口**: 11211
- **连接方式**: TCP连接
- **特性**: 简单高效的分布式内存缓存系统
- **连接示例**: `host:11211`
- **支持状态**: ⚠️ 基础支持
- **特殊说明**: 
  - 支持连接测试
  - 暂不支持数据预览

## 列式数据库

### ⚡ ClickHouse
- **默认端口**: 9000
- **驱动**: github.com/ClickHouse/clickhouse-go/v2
- **特性**: 高性能列式数据库，适合OLAP场景
- **连接示例**: `tcp://host:9000?username=user&password=password&database=database`
- **支持状态**: ✅ 完整支持

### 💍 Cassandra
- **默认端口**: 9042
- **连接方式**: TCP连接
- **特性**: 分布式NoSQL数据库，高可用性
- **连接示例**: `host:9042`
- **支持状态**: ⚠️ 基础支持
- **特殊说明**: 
  - 支持连接测试(TCP端口检测)
  - 需要专门的CQL驱动进行完整支持

### 🏔️ HBase
- **默认端口**: 9090
- **连接方式**: TCP连接
- **特性**: Hadoop生态系统的列式数据库
- **连接示例**: `host:9090`
- **支持状态**: ⚠️ 基础支持
- **特殊说明**: 
  - 支持连接测试(TCP端口检测)
  - 需要Thrift客户端进行完整支持

## 时序数据库

### ⏱️ InfluxDB
- **默认端口**: 8086
- **连接方式**: HTTP REST API
- **特性**: 时序数据库，适合存储和查询时间序列数据
- **连接示例**: `http://host:8086`
- **支持状态**: ⚠️ 基础支持
- **特殊说明**: 
  - 通过HTTP API连接
  - 专为时间序列数据优化
  - 适合监控和物联网场景

### ⏰ TimescaleDB
- **默认端口**: 5432
- **驱动**: github.com/lib/pq (PostgreSQL扩展)
- **特性**: PostgreSQL扩展的时序数据库
- **连接示例**: `host=host port=5432 user=user password=password dbname=database`
- **支持状态**: ✅ 完整支持

## 搜索引擎

### 🔍 Elasticsearch
- **默认端口**: 9200
- **连接方式**: HTTP REST API
- **特性**: 分布式搜索和分析引擎
- **连接示例**: `http://host:9200`
- **支持状态**: ⚠️ 基础支持
- **特殊说明**: 
  - 通过HTTP API连接
  - 支持全文搜索
  - 适合日志分析和搜索场景

## 图数据库

### 🕸️ Neo4j
- **默认端口**: 7687
- **驱动**: github.com/neo4j/neo4j-go-driver/v5
- **特性**: 原生图数据库，使用Cypher查询语言
- **连接示例**: `neo4j://host:7687`
- **支持状态**: ⚠️ 基础支持
- **特殊说明**: 
  - 支持连接测试
  - 显示节点标签和关系类型
  - 需要Cypher查询进行完整支持

## 功能支持矩阵

| 数据库类型 | 连接测试 | 表/集合列表 | 数据预览 | 备注 |
|-----------|---------|-----------|---------|------|
| MySQL | ✅ | ✅ | ✅ | 完整支持 |
| MariaDB | ✅ | ✅ | ✅ | 完整支持 |
| PostgreSQL | ✅ | ✅ | ✅ | 完整支持 |
| SQL Server | ✅ | ✅ | ✅ | 完整支持 |
| Oracle | ✅ | ✅ | ✅ | 完整支持 |
| 达梦 | ✅ | ✅ | ✅ | 完整支持 |
| SQLite | ✅ | ✅ | ✅ | 完整支持 |
| DuckDB | ✅ | ✅ | ✅ | 完整支持 |
| TiDB | ✅ | ✅ | ✅ | 完整支持 |
| CockroachDB | ✅ | ✅ | ✅ | 完整支持 |
| MongoDB | ✅ | ✅ | ✅ | 完整支持 |
| Redis | ✅ | ✅ | ❌ | 基础支持 |
| Memcached | ✅ | ❌ | ❌ | 基础支持 |
| ClickHouse | ✅ | ✅ | ✅ | 完整支持 |
| Cassandra | ✅ | ❌ | ❌ | 基础支持 |
| HBase | ✅ | ❌ | ❌ | 基础支持 |
| InfluxDB | ✅ | ❌ | ❌ | 基础支持 |
| TimescaleDB | ✅ | ✅ | ✅ | 完整支持 |
| Elasticsearch | ✅ | ❌ | ❌ | 基础支持 |
| Neo4j | ✅ | ✅ | ❌ | 基础支持 |

## 注意事项

### 通用
- 所有数据预览默认限制100条记录
- 密码在服务器端内存加密存储
- 建议在生产环境使用只读账号

### SQL数据库
- 支持标准SQL查询
- 自动检测表结构
- 支持NULL值显示
- 不同数据库使用不同的SQL方言

### NoSQL数据库
- MongoDB支持完整的集合操作
- Redis显示数据库索引但暂不支持键值预览
- Elasticsearch和InfluxDB需要根据实际场景调整查询方式
- 返回数据格式可能与SQL数据库不同

### 文件数据库
- SQLite和DuckDB无需网络连接
- 需要有文件系统访问权限
- 适合本地数据分析和嵌入式场景

## 开发计划

未来将支持的功能：
- [ ] Redis键值数据预览
- [ ] Cassandra CQL查询支持
- [ ] HBase Thrift客户端集成
- [ ] Elasticsearch索引查询
- [ ] InfluxDB时序数据查询
- [ ] Neo4j Cypher查询界面
- [ ] 自定义SQL/查询编辑器
- [ ] 数据导出功能（CSV、Excel、JSON）
- [ ] 数据统计分析
- [ ] 跨数据库数据迁移
- [ ] 数据库性能监控

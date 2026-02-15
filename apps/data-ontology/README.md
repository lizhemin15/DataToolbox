# 数据本体池

数据库管理、数据治理、本体论抽象、接口分发、AI助手的一体化数据平台。

## 支持的数据库类型

### 关系型数据库 (SQL)
- 🐬 **MySQL** - 最流行的开源关系型数据库
- 🦭 **MariaDB** - MySQL的开源分支
- 🐘 **PostgreSQL** - 高级开源关系型数据库
- 🪟 **SQL Server** - 微软企业级数据库
- 🔶 **Oracle** - 企业级商用数据库
- 📊 **达梦(DM)** - 国产数据库
- 📁 **SQLite** - 轻量级嵌入式数据库
- 🦆 **DuckDB** - 分析型嵌入式数据库

### 分布式数据库
- 🐯 **TiDB** - 分布式NewSQL数据库
- 🪳 **CockroachDB** - 分布式SQL数据库

### 文档型数据库
- 🍃 **MongoDB** - 文档型数据库

### KV存储/缓存
- 🔴 **Redis** - 高性能内存键值存储
- 💾 **Memcached** - 分布式内存缓存系统

### 列式数据库
- ⚡ **ClickHouse** - 高性能列式OLAP数据库
- 💍 **Cassandra** - 分布式NoSQL数据库
- 🏔️ **HBase** - Hadoop列式数据库

### 时序数据库
- ⏱️ **InfluxDB** - 时序数据库
- ⏰ **TimescaleDB** - PostgreSQL时序扩展

### 搜索引擎
- 🔍 **Elasticsearch** - 分布式搜索引擎

### 图数据库
- 🕸️ **Neo4j** - 原生图数据库

**共支持 20+ 种数据库类型！**

## 功能模块

### 已实现

1. **用户鉴权**
   - 登录系统
   - Token认证
   - 默认管理员账号：admin / admin1234

2. **数据库管理**
   - 多种数据库类型支持
   - 连接测试
   - 保存数据库配置
   - 查看数据库表/集合列表
   - 预览表数据（最多100条）

### 待实现

3. **数据治理**
4. **本体论抽象**
5. **接口分发**
6. **AI助手**

## 使用说明

### 1. 登录系统

首次使用请使用默认管理员账号登录：
- 用户名：`admin`
- 密码：`admin1234`

### 2. 添加数据库

1. 点击左侧"+ 添加"按钮
2. 选择数据库类型（20+种数据库可选）：
   - **关系型**: MySQL, MariaDB, PostgreSQL, SQL Server, Oracle, 达梦, SQLite, DuckDB
   - **分布式**: TiDB, CockroachDB
   - **文档型**: MongoDB
   - **KV存储**: Redis, Memcached
   - **列式**: ClickHouse, Cassandra, HBase
   - **时序**: InfluxDB, TimescaleDB
   - **搜索**: Elasticsearch
   - **图**: Neo4j
3. 填写数据库配置信息：
   - 连接名称：自定义名称（用于识别）
   - 主机地址：如 localhost 或 IP地址（网络数据库）
   - 文件路径：数据库文件路径（SQLite/DuckDB）
   - 端口：根据数据库类型自动填充
   - 用户名：数据库用户名
   - 密码：数据库密码
   - 数据库名：要连接的数据库（部分数据库类型需要）
4. 点击"测试连接"验证配置
5. 点击"保存"保存配置

### 3. 查看数据库

1. 在左侧列表中点击已添加的数据库
2. 右侧将显示：
   - 数据库基本信息
   - 连接状态
   - 数据表列表

### 4. 预览表数据

1. 在数据表列表中点击要查看的表
2. 下方将显示表的前100条数据

## 技术架构

### 前端
- HTML5 + CSS3 + JavaScript
- 纯原生实现，无额外依赖

### 后端
- Go 语言
- 数据库驱动：
  - **关系型**: 
    - MySQL/MariaDB/TiDB: github.com/go-sql-driver/mysql
    - PostgreSQL/CockroachDB/TimescaleDB: github.com/lib/pq
    - SQL Server: github.com/denisenkom/go-mssqldb
    - Oracle: github.com/sijms/go-ora, github.com/godror/godror
    - 达梦: (兼容Oracle驱动)
    - SQLite: github.com/mattn/go-sqlite3
    - DuckDB: github.com/marcboeker/go-duckdb
  - **NoSQL**: 
    - MongoDB: go.mongodb.org/mongo-driver
    - Neo4j: github.com/neo4j/neo4j-go-driver/v5
  - **列式**:
    - ClickHouse: github.com/ClickHouse/clickhouse-go/v2
  - **其他**: Redis, Memcached, Cassandra, HBase, InfluxDB, Elasticsearch (TCP/HTTP连接)
- UUID生成：github.com/google/uuid

## 安全说明

- 密码使用MD5哈希存储
- API使用Token进行身份验证
- 数据库密码加密存储在服务器内存中
- 建议在生产环境中修改默认管理员密码

## 后续开发计划

1. 数据治理模块
2. 本体论抽象功能
3. RESTful接口自动生成
4. AI数据分析助手
5. 多用户管理
6. 角色权限控制

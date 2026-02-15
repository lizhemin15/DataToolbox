# 数据本体池

数据库管理、数据治理、本体论抽象、接口分发、AI助手的一体化数据平台。

## 数据持久化

所有配置数据（用户信息、数据库配置等）使用 **SQLite 数据库**进行本地持久化存储：
- 📁 **数据库文件位置**：`apps/data-ontology/data-ontology.db`
- 🔄 **自动初始化**：首次启动时自动创建数据库和默认管理员账号
- 💾 **实时保存**：所有配置修改实时保存到数据库
- 🚀 **一键迁移**：只需复制 `.db` 文件即可完整迁移所有配置

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
   - SQLite持久化存储

2. **数据库管理**
   - 多种数据库类型支持（20+种）
   - 连接测试
   - 添加数据库配置
   - 编辑数据库配置
   - 删除数据库配置
   - 查看数据库表/集合列表
   - 预览表数据（最多100条）
   - SQLite持久化存储

### 待实现

3. **数据治理**
4. **本体论抽象**
5. **接口分发**
6. **AI助手**

## 使用说明

### 1. 首次启动

首次启动服务器时，系统会自动：
- 创建 `apps/data-ontology/` 目录
- 初始化 SQLite 数据库文件 `data-ontology.db`
- 创建默认管理员账号：
  - 用户名：`admin`
  - 密码：`admin1234`

### 2. 登录系统

使用默认管理员账号登录：
- 用户名：`admin`
- 密码：`admin1234`

### 3. 添加数据库

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

### 4. 查看数据库

1. 在左侧列表中点击已添加的数据库
2. 右侧将显示：
   - 数据库基本信息
   - 连接状态
   - 数据表列表

### 5. 预览表数据

1. 在数据表列表中点击要查看的表
2. 下方将显示表的前100条数据

### 6. 编辑数据库配置

1. 在左侧列表中选择要编辑的数据库
2. 点击右上角"✏️ 编辑"按钮
3. 在弹窗中修改配置信息：
   - 连接名称、主机地址、端口等可以修改
   - 数据库类型不可修改
   - 密码如果不修改请留空（会保留原密码）
4. 点击"测试连接"验证新配置（需要输入密码）
5. 点击"保存"保存修改

### 7. 配置迁移

要将所有配置迁移到另一台服务器：

1. **备份配置**：复制 `apps/data-ontology/data-ontology.db` 文件
2. **迁移配置**：将 `.db` 文件复制到新服务器的相同路径 `apps/data-ontology/`
3. **重启服务**：重启 DataToolbox 服务器
4. **验证**：登录系统，所有用户和数据库配置自动恢复

💡 **提示**：定期备份 `data-ontology.db` 文件可防止配置丢失。

## 技术架构

### 前端
- HTML5 + CSS3 + JavaScript
- 纯原生实现，无额外依赖

### 后端
- Go 语言
- **持久化存储**: 
  - SQLite (modernc.org/sqlite) - 纯Go实现，无CGO依赖
  - 存储用户信息和数据库配置
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

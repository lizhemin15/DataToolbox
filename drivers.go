package main

// 数据库驱动注册（空导入，仅用于注册 driver 名称）。
//
// 背景：buildDSN() 会按数据库类型返回 driver 名（mysql / postgres / oracle /
// sqlserver / dm / sqlite），如果对应驱动没有被导入注册，sql.Open 会直接报
// "sql: unknown driver xxx"，表现为「数据库无 xx 驱动」。
//
// 历史上的这次导入在 1c587b9ff（拆分 server.go 为 20 个模块文件）时被误删，
// 导致 MySQL / PostgreSQL / SQL Server / Oracle 全部不可用，这里显式恢复。
// 全部选用纯 Go 驱动（无 CGO、无 Oracle Instant Client 依赖），
// 便于在离线环境的一键安装包里直接使用。
import (
	// Oracle：纯 Go 实现，驱动名 "oracle"，DSN 形如 oracle://user:pass@host:port/service
	_ "github.com/sijms/go-ora/v2"

	// MySQL / MariaDB / TiDB，驱动名 "mysql"
	_ "github.com/go-sql-driver/mysql"

	// PostgreSQL / TimescaleDB / CockroachDB，驱动名 "postgres"
	_ "github.com/lib/pq"

	// SQL Server，驱动名 "sqlserver"
	_ "github.com/denisenkom/go-mssqldb"
)

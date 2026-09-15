package main

import (
	"database/sql"
	"sort"
	"testing"
)

// TestSQLDriversRegistered 防止驱动注册再次被误删。
// buildDSN() 按类型返回的 driver 名，必须都能在 database/sql 中注册并可打开，
// 否则运行期会报 "sql: unknown driver"（即「数据库无 xx 驱动」）。
func TestSQLDriversRegistered(t *testing.T) {
	// buildDSN 可能返回的驱动名 -> {说明, 可被驱动解析的假 DSN（不会真连库）}
	required := map[string]struct {
		desc string
		dsn  string
	}{
		"mysql":     {"MySQL / MariaDB / TiDB", "u:p@tcp(127.0.0.1:3306)/db"},
		"postgres":  {"PostgreSQL / TimescaleDB / CockroachDB", "host=127.0.0.1 port=5432"},
		"oracle":    {"Oracle", "oracle://u:p@127.0.0.1:1521/XE"},
		"sqlserver": {"SQL Server", "sqlserver://u:p@127.0.0.1:1433"},
		"dm":        {"达梦 DM", "dm://u:p@127.0.0.1:5236"},
		"sqlite":    {"SQLite", ":memory:"},
	}

	registered := map[string]bool{}
	for _, name := range sql.Drivers() {
		registered[name] = true
	}

	var missing []string
	for driver, info := range required {
		if !registered[driver] {
			missing = append(missing, driver+"("+info.desc+")")
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		t.Fatalf("以下驱动未注册，连库会报 unknown driver: %v；已注册: %v", missing, sql.Drivers())
	}

	// sql.Open 只做驱动查找与 DSN 解析，不会真连库
	for driver, info := range required {
		db, err := sql.Open(driver, info.dsn)
		if err != nil {
			t.Fatalf("sql.Open(%q) 失败，驱动未正确注册: %v", driver, err)
		}
		_ = db.Close()
	}
}

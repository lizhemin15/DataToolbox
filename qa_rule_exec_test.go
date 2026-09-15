package main

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// 规则执行链路：渲染参数 → 方言转换 → 真实执行（集成级）
// ---------------------------------------------------------------------------

func newSQLiteTargetDB(t *testing.T, ddl string, seed string) *sql.DB {
	t.Helper()
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "target.db"))
	if err != nil {
		t.Fatalf("打开目标库失败: %v", err)
	}
	if _, err := db.Exec(ddl); err != nil {
		t.Fatalf("建表失败: %v", err)
	}
	if seed != "" {
		if _, err := db.Exec(seed); err != nil {
			t.Fatalf("写入数据失败: %v", err)
		}
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// 填好参数的规则：能真正跑出违规数据（旧版空壳 SQL 只会得到 -2007）
func TestQAPrepareRuleExecutionSQLRunsWithParams(t *testing.T) {
	target := newSQLiteTargetDB(t,
		`CREATE TABLE T_ORDER (ORDER_ID TEXT, CUSTOMER_ID TEXT)`,
		`INSERT INTO T_ORDER (ORDER_ID, CUSTOMER_ID) VALUES ('A','c1'), (NULL,'c2'), ('B','c3')`)
	rule := qaRule{
		NM: "010100", Name: "主键非空检查",
		SQL:    `SELECT * FROM {{表名}} WHERE {{字段名}} IS NULL`,
		Params: map[string]string{"表名": "T_ORDER", "字段名": "ORDER_ID"},
	}
	execSQL, err := qaPrepareRuleExecutionSQL(rule, "sqlite")
	if err != nil {
		t.Fatalf("准备 SQL 失败: %v", err)
	}
	if execSQL != `SELECT * FROM T_ORDER WHERE ORDER_ID IS NULL` {
		t.Errorf("最终 SQL 不符: %q", execSQL)
	}
	cnt, sample, err := executeRuleQuery(target, execSQL)
	if err != nil {
		t.Fatalf("执行失败: %v", err)
	}
	if cnt != 1 {
		t.Errorf("违规行数应为 1，实际 %d（样例 %v）", cnt, sample)
	}
}

// 外键规则的多个占位符也要能正确渲染
func TestQAPrepareRuleExecutionSQLForeignKeyTemplate(t *testing.T) {
	target := newSQLiteTargetDB(t,
		`CREATE TABLE T_ORDER (ORDER_ID TEXT, CUSTOMER_ID TEXT);
		 CREATE TABLE T_CUSTOMER (CUSTOMER_ID TEXT)`,
		`INSERT INTO T_CUSTOMER VALUES ('c1');
		 INSERT INTO T_ORDER VALUES ('A','c1'), ('B','c9')`)
	rule := qaRule{
		NM: "010200", Name: "外键完整性检查",
		SQL: `SELECT a.* FROM {{表名}} a LEFT JOIN {{关联表}} b ON a.{{字段名}} = b.{{关联字段}} WHERE b.{{关联字段}} IS NULL`,
		Params: map[string]string{
			"表名": "T_ORDER", "字段名": "CUSTOMER_ID",
			"关联表": "T_CUSTOMER", "关联字段": "CUSTOMER_ID",
		},
	}
	execSQL, err := qaPrepareRuleExecutionSQL(rule, "sqlite")
	if err != nil {
		t.Fatalf("准备 SQL 失败: %v", err)
	}
	cnt, _, err := executeRuleQuery(target, execSQL)
	if err != nil {
		t.Fatalf("执行失败（SQL=%s）: %v", execSQL, err)
	}
	if cnt != 1 {
		t.Errorf("孤儿记录应为 1 条，实际 %d", cnt)
	}
}

// 没填参数的规则：必须给出可读报错，且不能带着空壳 SQL 去执行
func TestQAPrepareRuleExecutionSQLBlocksMissingParams(t *testing.T) {
	rule := qaRule{
		NM: "010100", Name: "主键非空检查",
		SQL: `SELECT * FROM {{表名}} WHERE {{字段名}} IS NULL`,
	}
	execSQL, err := qaPrepareRuleExecutionSQL(rule, "dm")
	if err == nil {
		t.Fatalf("缺参数必须报错，实际返回 SQL=%q", execSQL)
	}
	if execSQL != "" {
		t.Errorf("报错时不应返回可执行 SQL，实际 %q", execSQL)
	}
	msg := err.Error()
	if !strings.Contains(msg, "参数未配置") || !strings.Contains(msg, "{{表名}}") {
		t.Errorf("报错不可读: %s", msg)
	}
	if strings.Contains(msg, "-2007") {
		t.Errorf("不应再是数据库语法错误: %s", msg)
	}
}

// 参数值里的注入尝试必须被拦下
func TestQAPrepareRuleExecutionSQLRejectsInjection(t *testing.T) {
	rule := qaRule{
		NM: "010100", Name: "主键非空检查",
		SQL:    `SELECT * FROM {{表名}} WHERE {{字段名}} IS NULL`,
		Params: map[string]string{"表名": "T; DROP TABLE X", "字段名": "ID"},
	}
	if _, err := qaPrepareRuleExecutionSQL(rule, "mysql"); err == nil {
		t.Fatal("带分号的参数值必须被拒绝")
	}
}

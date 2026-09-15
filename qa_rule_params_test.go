package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestQARulePlaceholdersOrderAndDedupe(t *testing.T) {
	sql := `SELECT a.* FROM {{表名}} a LEFT JOIN {{ 关联表 }} b ON a.{{字段名}} = b.{{关联字段}} WHERE b.{{字段名}} IS NULL`
	got := qaRulePlaceholders(sql)
	want := []string{"表名", "关联表", "字段名", "关联字段"}
	if len(got) != len(want) {
		t.Fatalf("占位符数量不符：got=%v want=%v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("占位符顺序不符：got=%v want=%v", got, want)
		}
	}
	if qaHasPlaceholders(`SELECT 1 FROM T`) {
		t.Error("无占位符的 SQL 不应判定为含占位符")
	}
}

func TestQARenderRuleSQL(t *testing.T) {
	params := map[string]string{"表名": "HR_EMPLOYEE", "字段名": "EMP_ID"}
	out, missing := qaRenderRuleSQL(`SELECT * FROM {{表名}} WHERE {{字段名}} IS NULL`, params)
	if len(missing) != 0 {
		t.Fatalf("不应缺失参数，实际 %v", missing)
	}
	if out != `SELECT * FROM HR_EMPLOYEE WHERE EMP_ID IS NULL` {
		t.Errorf("渲染结果错误: %q", out)
	}

	// 缺一个参数：原样保留并报告
	out2, missing2 := qaRenderRuleSQL(`SELECT * FROM {{表名}} WHERE {{字段名}} IS NULL`, map[string]string{"表名": "T"})
	if len(missing2) != 1 || missing2[0] != "字段名" {
		t.Fatalf("缺失参数判定错误: %v", missing2)
	}
	if !strings.Contains(out2, "{{字段名}}") {
		t.Errorf("缺参数时应原样保留占位符，实际 %q", out2)
	}
}

func TestQARenderRuleSQLErrMessage(t *testing.T) {
	_, err := qaRenderRuleSQLErr(`SELECT * FROM {{表名}} WHERE {{字段名}} IS NULL`, map[string]string{}, `规则 010100（主键非空检查）`)
	if err == nil {
		t.Fatal("缺参数时必须报错")
	}
	msg := err.Error()
	for _, want := range []string{"010100", "参数未配置", "{{表名}}", "{{字段名}}"} {
		if !strings.Contains(msg, want) {
			t.Errorf("报错信息缺少 %q：%s", want, msg)
		}
	}
}

func TestQAValidateParamValue(t *testing.T) {
	bad := map[string]string{
		"分号":  "T; DROP TABLE X",
		"行注释": "T -- x",
		"块注释": "T /* x */",
		"换行":  "T\nX",
	}
	for name, v := range bad {
		if err := qaValidateParamValue(name, v); err == nil {
			t.Errorf("%s：应被拒绝，实际通过（值=%q）", name, v)
		}
	}
	if err := qaValidateParamValue("表名", "HR_EMPLOYEE"); err != nil {
		t.Errorf("合法值被拒: %v", err)
	}
	// 枚举值里的引号是正常用法（NOT IN ('A','B')），不能被误杀
	if err := qaValidateParamValue("枚举值", "'已完成','已取消'"); err != nil {
		t.Errorf("枚举值引号不应被拒: %v", err)
	}
}

func TestQAPruneRuleParams(t *testing.T) {
	got := qaPruneRuleParams(`SELECT * FROM {{表名}}`, map[string]string{"表名": "T", "残留": "X", "空值": "  "})
	if len(got) != 1 || got["表名"] != "T" {
		t.Errorf("参数裁剪错误: %v", got)
	}
}

func TestQAValidateRuleParamsMissing(t *testing.T) {
	missing, err := qaValidateRuleParams(`SELECT * FROM {{表名}} WHERE {{字段名}} IS NULL`, map[string]string{"表名": "T"})
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if len(missing) != 1 || missing[0] != "字段名" {
		t.Errorf("缺失参数判定错误: %v", missing)
	}
}

// ---------------------------------------------------------------------------
// 迁移：老库补 PARAMS 列 + 空壳模板升级为占位符版本
// ---------------------------------------------------------------------------

func newTestQualityDB(t *testing.T, schemaHasParams bool, seeds map[string]string) *sql.DB {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "rules.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("打开测试库失败: %v", err)
	}
	schema := `CREATE TABLE rules (
		NM TEXT PRIMARY KEY, XH TEXT NOT NULL, NAME TEXT NOT NULL,
		SQL TEXT, CATEGORY TEXT, UPDATED_AT TEXT NOT NULL);`
	if schemaHasParams {
		schema = `CREATE TABLE rules (
			NM TEXT PRIMARY KEY, XH TEXT NOT NULL, NAME TEXT NOT NULL,
			SQL TEXT, CATEGORY TEXT, PARAMS TEXT DEFAULT '', UPDATED_AT TEXT NOT NULL);`
	}
	if _, err := db.Exec(schema); err != nil {
		t.Fatalf("建表失败: %v", err)
	}
	for nm, s := range seeds {
		if _, err := db.Exec(`INSERT INTO rules (NM, XH, NAME, SQL, CATEGORY, UPDATED_AT) VALUES (?,?,?,?,'','2026-01-01T00:00:00+08:00')`,
			nm, "0101", "测试规则", s); err != nil {
			t.Fatalf("插入种子失败: %v", err)
		}
	}
	t.Cleanup(func() { _ = db.Close(); _ = os.RemoveAll(dir) })
	return db
}

func TestQAMigrateRuleParamsUpgradesLegacyTemplates(t *testing.T) {
	db := newTestQualityDB(t, false, map[string]string{
		"010100": `SELECT * FROM  WHERE  IS NULL`,
		"010200": `SELECT a.* FROM  a LEFT JOIN  b ON a.=b. WHERE b. IS NULL`,
		"020100": `SELECT , COUNT(*) as cnt FROM  GROUP BY  HAVING COUNT(*) > 1`,
		"030100": `SELECT COUNT(*) as null_count FROM  WHERE  IS NULL`,
		"030200": `SELECT * FROM  WHERE  NOT IN ()`,
		"099999": `SELECT * FROM MY_TABLE WHERE ID IS NULL`, // 用户自己写好的规则，不能被改
	})
	migrateQualityAuditRuleParams(db)

	if !qaTableHasColumn(db, "rules", "params") {
		t.Fatal("PARAMS 列未补上")
	}
	for nm, s := range map[string]string{
		"010100": `SELECT * FROM {{表名}} WHERE {{字段名}} IS NULL`,
		"010200": `SELECT a.* FROM {{表名}} a LEFT JOIN {{关联表}} b ON a.{{字段名}} = b.{{关联字段}} WHERE b.{{关联字段}} IS NULL`,
		"020100": `SELECT {{字段名}}, COUNT(*) AS cnt FROM {{表名}} GROUP BY {{字段名}} HAVING COUNT(*) > 1`,
		"030100": `SELECT COUNT(*) AS null_count FROM {{表名}} WHERE {{字段名}} IS NULL`,
		"030200": `SELECT * FROM {{表名}} WHERE {{字段名}} NOT IN ({{枚举值}})`,
	} {
		var got string
		if err := db.QueryRow(`SELECT SQL FROM rules WHERE NM=?`, nm).Scan(&got); err != nil {
			t.Fatalf("查询 %s 失败: %v", nm, err)
		}
		if got != s {
			t.Errorf("%s 模板未升级：\n got=%q\nwant=%q", nm, got, s)
		}
	}
	var custom string
	if err := db.QueryRow(`SELECT SQL FROM rules WHERE NM='099999'`).Scan(&custom); err != nil {
		t.Fatalf("查询自定义规则失败: %v", err)
	}
	if custom != `SELECT * FROM MY_TABLE WHERE ID IS NULL` {
		t.Errorf("用户自定义规则被误改: %q", custom)
	}
}

func TestQAMigrateRuleParamsIdempotent(t *testing.T) {
	db := newTestQualityDB(t, true, map[string]string{
		"010100": `SELECT * FROM {{表名}} WHERE {{字段名}} IS NULL`,
	})
	// 已填好参数的规则：迁移不应把参数清掉
	if _, err := db.Exec(`UPDATE rules SET params='{"表名":"T","字段名":"C"}' WHERE NM='010100'`); err != nil {
		t.Fatalf("准备数据失败: %v", err)
	}
	migrateQualityAuditRuleParams(db)
	migrateQualityAuditRuleParams(db) // 再跑一次，幂等
	var got string
	if err := db.QueryRow(`SELECT COALESCE(PARAMS,'') FROM rules WHERE NM='010100'`).Scan(&got); err != nil {
		t.Fatalf("查询失败: %v", err)
	}
	if got != `{"表名":"T","字段名":"C"}` {
		t.Errorf("已有参数被改坏: %q", got)
	}
}

package main

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

/* ===========================================================================
 * qa_schedules 读路径回归防线
 *
 * 背景（这是真在网上复现过的事故，不是假想的）：
 *   给 qa_schedules 补 report_overrides 列后，把该列置为 NULL 的行会让
 *   qaScanSchedule 直接报
 *     sql: Scan error on column index 17, name "report_overrides":
 *     converting NULL to string is unsupported
 *   而 qaLoadSchedules 是「一行出错整个接口失败」，于是一条坏行就把
 *   任务列表整页打成 500。用户侧看到的是「任务列表打不开了」，
 *   根本联想不到是某个任务的一列数据。
 *
 * 所以这里钉两个不变量：
 *   ① 老库补列后，老任务必须默认「纯跟随模板」（overrides = nil），
 *      报告内容与升级前逐字一致 —— 不做任何隐式改写。
 *   ② 不管这列是 ''、NULL、还是 'null' 字面量，读任务都不能出错。
 *      读取路径的健壮性不能用「反正 DEFAULT 是 ''」来赌。
 * ========================================================================= */

const qaScanTestTable = `CREATE TABLE qa_schedules (
	id TEXT PRIMARY KEY, name TEXT, database_id TEXT, cron_expr TEXT,
	enabled INTEGER, rule_nms TEXT, ai_check_nms TEXT, ai_prompt TEXT,
	report_template_id TEXT, fill_enabled INTEGER DEFAULT 1,
	ai_check_enabled INTEGER DEFAULT 1, last_run_at TEXT, last_run_status TEXT,
	next_run_at TEXT, created_by TEXT, created_at TEXT, updated_at TEXT,
	report_overrides TEXT DEFAULT '');`

// qaOpenScanTestDB 建一个带 qa_schedules 的真测试库（真驱动真 SQL，不用假 scanner：
// 假 scanner 是照着实现写的，改坏了它也不会红，等于没测）。
func qaOpenScanTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "sched.db"))
	if err != nil {
		t.Fatalf("打开测试库失败: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := db.Exec(qaScanTestTable); err != nil {
		t.Fatalf("建表失败: %v", err)
	}
	return db
}

// qaInsertScheduleRow 只关心 overrides 的三种落库形态，其余列给合法值。
// overrideExpr 是直接拼进 SQL 的表达式（如 "''" / "NULL" / "'null'"），
// 测试自己控制字面量，故意不用参数绑定 —— 参数绑定没法表达 NULL 与 'null' 的区别。
func qaInsertScheduleRow(t *testing.T, db *sql.DB, id, overrideExpr string) {
	t.Helper()
	q := `INSERT INTO qa_schedules
		(id,name,database_id,cron_expr,enabled,rule_nms,ai_check_nms,ai_prompt,report_template_id,
		 fill_enabled,ai_check_enabled,last_run_at,last_run_status,next_run_at,created_by,created_at,updated_at,report_overrides)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,` + overrideExpr + `)`
	if _, err := db.Exec(q, id, "任务"+id, "", "0 8 * * *", 1, "[]", "[]", "", "default",
		1, 1, "", "", "", "tester", "2026-09-01 00:00:00", "2026-09-01 00:00:00"); err != nil {
		t.Fatalf("插入失败(%s): %v", overrideExpr, err)
	}
}

// qaSelectScheduleViaScan 走真实 SQL 列序 + qaScanSchedule，模拟 qaLoadSchedules 的读法。
func qaSelectScheduleViaScan(db *sql.DB, id string) (*qaSchedule, error) {
	row := db.QueryRow(`SELECT id, name, database_id, cron_expr, enabled, rule_nms, ai_check_nms,
		ai_prompt, report_template_id, fill_enabled, ai_check_enabled, last_run_at, last_run_status,
		next_run_at, created_by, created_at, updated_at, report_overrides
		FROM qa_schedules WHERE id=?`, id)
	return qaScanSchedule(row)
}

/* ── ② NULL 不能炸：一条坏行不许拖垮整个任务列表 ─────────────────────── */

func TestQAScanScheduleToleratesNullReportOverrides(t *testing.T) {
	db := qaOpenScanTestDB(t)
	qaInsertScheduleRow(t, db, "null-row", "NULL")

	s, err := qaSelectScheduleViaScan(db, "null-row")
	if err != nil {
		t.Fatalf("report_overrides 为 NULL 时读取必须成功，实际报错: %v\n"+
			"（这条错误会让整个 GET /quality-audit/schedules 返回 500）", err)
	}
	if s.ReportOverrides != nil {
		t.Errorf("NULL 应视为「没配覆盖」= 纯跟随模板，实际: %+v", s.ReportOverrides)
	}
	if !s.FillEnabled || !s.AICheckEnabled {
		t.Errorf("其它布尔列不应受 overrides 影响: fill=%v ai=%v", s.FillEnabled, s.AICheckEnabled)
	}
}

func TestQAScanScheduleToleratesEmptyAndNullLiteral(t *testing.T) {
	db := qaOpenScanTestDB(t)
	// '' 是 ALTER ADD COLUMN DEFAULT 的正常产物；'null' 是前端 JSON.stringify(null) 落库的形态。
	// 两者都必须读得出来且等于「没配覆盖」。
	qaInsertScheduleRow(t, db, "empty-row", "''")
	qaInsertScheduleRow(t, db, "null-literal-row", "'null'")

	for _, id := range []string{"empty-row", "null-literal-row"} {
		s, err := qaSelectScheduleViaScan(db, id)
		if err != nil {
			t.Fatalf("%s 读取失败: %v", id, err)
		}
		if s.ReportOverrides != nil {
			t.Errorf("%s 应视为没配覆盖，实际: %+v", id, s.ReportOverrides)
		}
	}
}

/* ── ① 老库补列：迁移幂等 + 老任务默认纯跟随模板 ──────────────────────── */

func TestQAMigrateScheduleReportOverridesColumn(t *testing.T) {
	db := qaOpenScanTestDB(t)

	// 先模拟「老库」：把新列删掉（SQLite 3.35+ 支持 DROP COLUMN，驱动版本足够）。
	// 这样才真的在测迁移路径，而不是测一个已经带新列的表。
	if _, err := db.Exec(`ALTER TABLE qa_schedules DROP COLUMN report_overrides`); err != nil {
		t.Fatalf("构造老库失败: %v", err)
	}
	if qaTableHasColumn(db, "qa_schedules", "report_overrides") {
		t.Fatal("构造老库失败：新列还在")
	}
	qaInsertScheduleRowOld(t, db, "legacy-1")

	migrateQualityAuditScheduleReportOverrides(db)

	if !qaTableHasColumn(db, "qa_schedules", "report_overrides") {
		t.Fatal("report_overrides 列未补上")
	}

	// 老任务读出来必须是「纯跟随模板」：nil 而不是某个空结构体。
	// 空结构体虽然也等价，但 nil 语义更明确，也更方便上层判断。
	s, err := qaSelectScheduleViaScan(db, "legacy-1")
	if err != nil {
		t.Fatalf("老任务迁移后读取失败: %v", err)
	}
	if s.ReportOverrides != nil {
		t.Errorf("老任务补列后应为 nil（纯跟随模板），实际: %+v", s.ReportOverrides)
	}
	if !s.ReportOverrides.empty() {
		t.Error("nil 覆盖必须被 empty() 判为「没配」")
	}

	// 幂等：重复迁移不报错（服务每次启动都会跑一遍）
	migrateQualityAuditScheduleReportOverrides(db)
	migrateQualityAuditScheduleReportOverrides(db)
}

// qaInsertScheduleRowOld 模拟「老库」的行：不带 report_overrides 列。
func qaInsertScheduleRowOld(t *testing.T, db *sql.DB, id string) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO qa_schedules
		(id,name,database_id,cron_expr,enabled,rule_nms,ai_check_nms,ai_prompt,report_template_id,
		 fill_enabled,ai_check_enabled,last_run_at,last_run_status,next_run_at,created_by,created_at,updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		id, "老任务"+id, "", "0 8 * * *", 1, "[]", "[]", "", "default",
		1, 1, "", "", "", "tester", "2026-09-01 00:00:00", "2026-09-01 00:00:00"); err != nil {
		t.Fatalf("插入老库行失败: %v", err)
	}
}

/* ── 迁移里那句 DEFAULT '' 不能变成「什么都不默认」 ───────────────────── */

func TestQAMigrateScheduleReportOverridesDefaultIsEmptyNotNull(t *testing.T) {
	db := qaOpenScanTestDB(t)
	if _, err := db.Exec(`ALTER TABLE qa_schedules DROP COLUMN report_overrides`); err != nil {
		t.Fatalf("构造老库失败: %v", err)
	}
	qaInsertScheduleRowOld(t, db, "legacy-2")
	migrateQualityAuditScheduleReportOverrides(db)

	var typ string
	if err := db.QueryRow(`SELECT typeof(report_overrides) FROM qa_schedules WHERE id='legacy-2'`).Scan(&typ); err != nil {
		t.Fatalf("读取 typeof 失败: %v", err)
	}
	if strings.EqualFold(typ, "null") {
		t.Errorf("补列后老行不该是 NULL（应为 text ''），实际 typeof=%s", typ)
	}
}

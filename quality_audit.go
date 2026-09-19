package main

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	qualityAuditDB   *sql.DB
	qualityAuditOpen sync.Once
	qualityAuditErr  error

	// 审核结果缓存
	qaCacheMu  sync.RWMutex
	qaCache    = make(map[string]qaCacheEntry)
	qaCacheTTL = 10 * time.Minute // 缓存有效期

	// 审核取消控制
	qaCancelMu    sync.Mutex
	qaCancelFuncs = make(map[string]context.CancelFunc)
)

// 取消正在执行的审核
func qaCancel(databaseID string) {
	qaCancelMu.Lock()
	defer qaCancelMu.Unlock()
	if cancel, ok := qaCancelFuncs[databaseID]; ok {
		cancel()
		delete(qaCancelFuncs, databaseID)
	}
}

// 注册取消函数
func qaRegisterCancel(databaseID string, cancel context.CancelFunc) {
	qaCancelMu.Lock()
	defer qaCancelMu.Unlock()
	qaCancelFuncs[databaseID] = cancel
}

// 清理取消函数
func qaClearCancel(databaseID string) {
	qaCancelMu.Lock()
	defer qaCancelMu.Unlock()
	delete(qaCancelFuncs, databaseID)
}

type qaCacheEntry struct {
	result    []map[string]interface{}
	timestamp time.Time
}

// 生成缓存 key: database_id + 规则列表 hash
func qaCacheKey(databaseID string, ruleNMs []string) string {
	h := databaseID + "|"
	for _, nm := range ruleNMs {
		h += nm + ","
	}
	return h
}

// 从缓存获取结果
func qaCacheGet(key string) ([]map[string]interface{}, bool) {
	qaCacheMu.RLock()
	defer qaCacheMu.RUnlock()
	entry, ok := qaCache[key]
	if !ok {
		return nil, false
	}
	if time.Since(entry.timestamp) > qaCacheTTL {
		return nil, false
	}
	return entry.result, true
}

// 写入缓存
func qaCacheSet(key string, result []map[string]interface{}) {
	qaCacheMu.Lock()
	defer qaCacheMu.Unlock()
	qaCache[key] = qaCacheEntry{
		result:    result,
		timestamp: time.Now(),
	}
}

func getQualityAuditDBPath() string {
	storePath := getDataOntologyStorePath()
	return filepath.Join(filepath.Dir(storePath), "quality-audit.db")
}

func openQualityAuditDB() (*sql.DB, error) {
	qualityAuditOpen.Do(func() {
		p := getQualityAuditDBPath()
		dir := filepath.Dir(p)
		if err := os.MkdirAll(dir, 0755); err != nil {
			qualityAuditErr = err
			return
		}
		dsn := "file:" + filepath.ToSlash(p) + "?_pragma=busy_timeout(5000)"
		db, err := sql.Open("sqlite", dsn)
		if err != nil {
			qualityAuditErr = err
			return
		}
		db.SetMaxOpenConns(1)
		if _, err = db.Exec(`
CREATE TABLE IF NOT EXISTS rules (
  NM TEXT PRIMARY KEY,
  XH TEXT NOT NULL,
  NAME TEXT NOT NULL,
  SQL TEXT,
  CATEGORY TEXT,
  PARAMS TEXT DEFAULT '',
  AI_REVIEW_PROMPT TEXT DEFAULT '',
  UPDATED_AT TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rule_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nm TEXT NOT NULL,
  xh TEXT NOT NULL,
  name TEXT NOT NULL,
  sql TEXT,
  category TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  changed_at TEXT NOT NULL,
  changed_by TEXT,
  change_reason TEXT
);
CREATE TABLE IF NOT EXISTS item_fill_rate (
  TABLE_NAME TEXT NOT NULL,
  FIELD_NAME TEXT NOT NULL,
  NUMERATOR TEXT NOT NULL,
  DENOMINATOR TEXT NOT NULL,
  CHECKED INTEGER NOT NULL DEFAULT 1,
  UPDATED_AT TEXT NOT NULL,
  PRIMARY KEY (TABLE_NAME, FIELD_NAME)
);
CREATE TABLE IF NOT EXISTS record_fill_rate (
  TABLE_NAME TEXT NOT NULL,
  FIELD_NAME TEXT NOT NULL,
  NUMERATOR TEXT NOT NULL,
  DENOMINATOR TEXT NOT NULL,
  CHECKED INTEGER NOT NULL DEFAULT 1,
  UPDATED_AT TEXT NOT NULL,
  PRIMARY KEY (TABLE_NAME, FIELD_NAME)
);
CREATE TABLE IF NOT EXISTS report_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template_type TEXT NOT NULL DEFAULT 'html',
  content TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  database_id TEXT NOT NULL,
  database_type TEXT,
  executed_at TEXT NOT NULL,
  duration_ms INTEGER,
  summary TEXT,
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS audit_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  database_id TEXT NOT NULL,
  rule_nm TEXT NOT NULL,
  rule_name TEXT,
  error_message TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_rules_xh ON rules(XH);
CREATE INDEX IF NOT EXISTS idx_audit_history_db ON audit_history(database_id);
CREATE INDEX IF NOT EXISTS idx_audit_history_time ON audit_history(executed_at);
CREATE INDEX IF NOT EXISTS idx_audit_errors_db ON audit_errors(database_id);
CREATE INDEX IF NOT EXISTS idx_audit_errors_time ON audit_errors(executed_at);
CREATE INDEX IF NOT EXISTS idx_rule_versions_nm ON rule_versions(nm);
CREATE INDEX IF NOT EXISTS idx_rule_versions_time ON rule_versions(changed_at);
CREATE TABLE IF NOT EXISTS qa_schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  database_id TEXT NOT NULL,
  cron_expr TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  rule_nms TEXT DEFAULT '[]',
  ai_check_nms TEXT DEFAULT '[]',
  ai_prompt TEXT DEFAULT '',
  report_template_id TEXT DEFAULT '',
  fill_enabled INTEGER DEFAULT 1,
  ai_check_enabled INTEGER DEFAULT 1,
  last_run_at TEXT DEFAULT '',
  last_run_status TEXT DEFAULT '',
  next_run_at TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS qa_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT DEFAULT '',
  schedule_name TEXT DEFAULT '',
  trigger_type TEXT DEFAULT 'cron',
  database_id TEXT DEFAULT '',
  started_at TEXT DEFAULT '',
  finished_at TEXT DEFAULT '',
  duration_ms INTEGER DEFAULT 0,
  status TEXT DEFAULT '',
  total_rules INTEGER DEFAULT 0,
  passed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  ai_flagged INTEGER DEFAULT 0,
  report_file TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  error TEXT DEFAULT '',
  created_by TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_qa_runs_schedule ON qa_runs(schedule_id);
CREATE INDEX IF NOT EXISTS idx_qa_runs_time ON qa_runs(started_at);
`); err != nil {
			_ = db.Close()
			qualityAuditErr = err
			return
		}
		migrateQualityAuditFillChecked(db)
		migrateQualityAuditReportTemplates(db)
		migrateQualityAuditRuleParams(db)
		migrateQualityAuditScheduleFillEnabled(db)
		migrateQualityAuditRuleAiReview(db)
		migrateQualityAuditScheduleAiEnabled(db)
		qualityAuditDB = db
	})
	if qualityAuditErr != nil {
		return nil, qualityAuditErr
	}
	return qualityAuditDB, nil
}

func initQualityAuditDB() {
	db, err := openQualityAuditDB()
	if err != nil {
		log.Printf("数据质量审核库初始化失败: %v", err)
		return
	}
	seedQualityAuditSampleData(db)
	seedQualityAuditReportTemplates(db)
	qaSchedulerStart()
}

func migrateQualityAuditReportTemplates(db *sql.DB) {
	rows, err := db.Query(`PRAGMA table_info(report_templates)`)
	if err != nil {
		return
	}
	defer rows.Close()
	hasTemplateType := false
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return
		}
		if strings.EqualFold(name, "template_type") {
			hasTemplateType = true
			break
		}
	}
	if hasTemplateType {
		return
	}
	_, _ = db.Exec(`DROP TABLE IF EXISTS report_templates__legacy`)
	if _, err := db.Exec(`ALTER TABLE report_templates RENAME TO report_templates__legacy`); err != nil {
		_, _ = db.Exec(`DROP TABLE IF EXISTS report_templates`)
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS report_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template_type TEXT NOT NULL DEFAULT 'html',
  content TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`); err != nil {
		log.Printf("quality-audit report_templates 迁移创建失败: %v", err)
		return
	}
	_, _ = db.Exec(`DROP TABLE IF EXISTS report_templates__legacy`)
}

func nmFromXH(xh string) string {
	xh = strings.TrimSpace(xh)
	if xh == "" {
		return ""
	}
	if len(xh) >= 6 {
		return xh[:6]
	}
	return xh + strings.Repeat("0", 6-len(xh))
}

func seedQualityAuditReportTemplates(db *sql.DB) {
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM report_templates`).Scan(&n); err != nil || n > 0 {
		return
	}
	now := time.Now().Format(time.RFC3339)
	def := defaultQATemplateContentJSON()
	_, err := db.Exec(`INSERT INTO report_templates (id, name, template_type, content, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
		"default", "默认报告模板", "html", def, 1, now, now)
	if err != nil {
		log.Printf("quality-audit 插入默认报告模板失败: %v", err)
	}
}

func defaultQATemplateContentJSON() string {
	m := map[string]interface{}{
		"doc_title": "数据质量审核报告",
		// 页面设置（公文格式）
		"page": map[string]string{
			"paper_size":    "A4",
			"margin_top":    "3.7cm",
			"margin_bottom": "3.5cm",
			"margin_left":   "2.8cm",
			"margin_right":  "2.6cm",
		},
		// 报告标题（方正小标宋，居中，二号字）
		"title": map[string]string{
			"font_family": "FZXiaoBiaoSong-B05S, FangSong, SimSun, serif",
			"font_size":   "22pt",
			"font_weight": "normal",
			"color":       "#000000",
			"align":       "center",
			"line_height": "1.5",
		},
		// 一级标题（黑体，三号字）
		"h1": map[string]string{
			"font_family": "SimHei, Heiti SC, sans-serif",
			"font_size":   "16pt",
			"font_weight": "normal",
			"color":       "#000000",
			"margin_top":  "0.8em",
		},
		// 二级标题（楷体，三号字，加粗）
		"h2": map[string]string{
			"font_family": "KaiTi, KaiTi_GB2312, STKaiti, serif",
			"font_size":   "16pt",
			"font_weight": "bold",
			"color":       "#000000",
			"margin_top":  "0.6em",
		},
		// 正文（仿宋，三号字，首行缩进2字符）
		"body": map[string]string{
			"font_family": "FangSong, FangSong_GB2312, STFangsong, serif",
			"font_size":   "16pt",
			"line_height": "28pt",
			"text_indent": "2em",
			"color":       "#000000",
		},
		// 章节标题（兼容旧字段）
		"section": map[string]string{
			"font_family": "SimHei, Heiti SC, sans-serif",
			"font_size":   "16pt",
			"color":       "#2d3748",
		},
		// 表格样式
		"table": map[string]string{
			"border":          "1px solid #000000",
			"border_collapse": "collapse",
			"header_bg":       "#f0f0f0",
			"header_weight":   "bold",
			"row_alt":         "#fafafa",
			"cell_padding":    "8px",
		},
		// 页眉页脚（宋体，小五号）
		"header_footer": map[string]string{
			"font_family": "SimSun, Songti SC, serif",
			"font_size":   "9pt",
			"align":       "center",
		},
		"page_header": "",
		"page_footer": "",
		// 编号格式
		"numbering": map[string]string{
			"h1_style": "一、二、三、",
			"h2_style": "（一）（二）（三）",
			"h3_style": "1. 2. 3.",
		},
	}
	b, _ := json.Marshal(m)
	return string(b)
}

func seedQualityAuditSampleData(db *sql.DB) {
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM rules`).Scan(&n); err != nil {
		log.Printf("quality-audit 检查 rules 表: %v", err)
		return
	}
	if n > 0 {
		return
	}
	now := time.Now().Format(time.RFC3339)
	tx, err := db.Begin()
	if err != nil {
		log.Printf("quality-audit 示例数据事务开始失败: %v", err)
		return
	}
	rollback := func() { _ = tx.Rollback() }

	ruleRows := []struct {
		xh, name string
		sql      interface{}
	}{
		{"01", "完整性规则", nil},
		{"0101", "主键非空检查", `SELECT * FROM {{表名}} WHERE {{字段名}} IS NULL`},
		{"0102", "外键完整性检查", `SELECT a.* FROM {{表名}} a LEFT JOIN {{关联表}} b ON a.{{字段名}} = b.{{关联字段}} WHERE b.{{关联字段}} IS NULL`},
		{"02", "唯一性规则", nil},
		{"0201", "重复记录检查", `SELECT {{字段名}}, COUNT(*) AS cnt FROM {{表名}} GROUP BY {{字段名}} HAVING COUNT(*) > 1`},
		{"03", "值域规则", nil},
		{"0301", "空值率检查", `SELECT COUNT(*) AS null_count FROM {{表名}} WHERE {{字段名}} IS NULL`},
		{"0302", "枚举值检查", `SELECT * FROM {{表名}} WHERE {{字段名}} NOT IN ({{枚举值}})`},
	}
	for _, r := range ruleRows {
		nm := nmFromXH(r.xh)
		if _, err := tx.Exec(`INSERT OR IGNORE INTO rules (NM, XH, NAME, SQL, CATEGORY, UPDATED_AT) VALUES (?,?,?,?,?,?)`,
			nm, r.xh, r.name, r.sql, "", now); err != nil {
			rollback()
			log.Printf("quality-audit 插入规则示例失败: %v", err)
			return
		}
	}

	itemRows := []struct{ tableName, fieldName, num, den string }{
		{"用户信息表", "姓名", `SELECT COUNT(*) FROM 用户信息表 WHERE 姓名 IS NOT NULL`, `SELECT COUNT(*) FROM 用户信息表`},
		{"订单表", "订单号", `SELECT COUNT(*) FROM 订单表 WHERE 订单号 IS NOT NULL`, `SELECT COUNT(*) FROM 订单表`},
	}
	for _, r := range itemRows {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO item_fill_rate (TABLE_NAME, FIELD_NAME, NUMERATOR, DENOMINATOR, CHECKED, UPDATED_AT) VALUES (?,?,?,?,?,?)`,
			r.tableName, r.fieldName, r.num, r.den, 1, now); err != nil {
			rollback()
			log.Printf("quality-audit 插入 item_fill_rate 示例失败: %v", err)
			return
		}
	}

	recRows := []struct{ tableName, fieldName, num, den string }{
		{"用户信息表", "姓名", `SELECT COUNT(DISTINCT 用户ID) FROM 用户信息表 WHERE 姓名 IS NOT NULL`, `SELECT COUNT(DISTINCT 用户ID) FROM 用户信息表`},
		{"订单表", "状态", `SELECT COUNT(*) FROM 订单表 WHERE 状态 = '已完成'`, `SELECT COUNT(*) FROM 订单表`},
	}
	for _, r := range recRows {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO record_fill_rate (TABLE_NAME, FIELD_NAME, NUMERATOR, DENOMINATOR, CHECKED, UPDATED_AT) VALUES (?,?,?,?,?,?)`,
			r.tableName, r.fieldName, r.num, r.den, 1, now); err != nil {
			rollback()
			log.Printf("quality-audit 插入 record_fill_rate 示例失败: %v", err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		rollback()
		log.Printf("quality-audit 示例数据提交失败: %v", err)
	}
}

// qaLegacyRuleTemplates 是历史版本里「表名/字段名为空」的空壳模板 → 带占位符的新模板。
// 迁移时逐字节精确匹配才替换，避免误伤用户已经填好的规则。
var qaLegacyRuleTemplates = map[string]string{
	`SELECT * FROM  WHERE  IS NULL`:                                `SELECT * FROM {{表名}} WHERE {{字段名}} IS NULL`,
	`SELECT a.* FROM  a LEFT JOIN  b ON a.=b. WHERE b. IS NULL`:    `SELECT a.* FROM {{表名}} a LEFT JOIN {{关联表}} b ON a.{{字段名}} = b.{{关联字段}} WHERE b.{{关联字段}} IS NULL`,
	`SELECT , COUNT(*) as cnt FROM  GROUP BY  HAVING COUNT(*) > 1`: `SELECT {{字段名}}, COUNT(*) AS cnt FROM {{表名}} GROUP BY {{字段名}} HAVING COUNT(*) > 1`,
	`SELECT COUNT(*) as null_count FROM  WHERE  IS NULL`:           `SELECT COUNT(*) AS null_count FROM {{表名}} WHERE {{字段名}} IS NULL`,
	`SELECT * FROM  WHERE  NOT IN ()`:                              `SELECT * FROM {{表名}} WHERE {{字段名}} NOT IN ({{枚举值}})`,
}

// migrateQualityAuditRuleParams 幂等迁移：
//  1. rules 表补 PARAMS 列（老库）
//  2. 把历史空壳模板改写成带占位符的版本（只改精确匹配的内置模板）
func migrateQualityAuditRuleParams(db *sql.DB) {
	if !qaTableHasColumn(db, "rules", "params") {
		if _, err := db.Exec(`ALTER TABLE rules ADD COLUMN PARAMS TEXT DEFAULT ''`); err != nil {
			log.Printf("quality-audit migrate rules.PARAMS: %v", err)
		}
	}
	rows, err := db.Query(`SELECT NM, COALESCE(SQL,'') FROM rules WHERE COALESCE(PARAMS,'') = ''`)
	if err != nil {
		log.Printf("quality-audit 迁移规则模板查询失败: %v", err)
		return
	}
	type pending struct{ nm, sql string }
	var todo []pending
	for rows.Next() {
		var nm, s string
		if err := rows.Scan(&nm, &s); err != nil {
			continue
		}
		if _, ok := qaLegacyRuleTemplates[strings.TrimSpace(s)]; ok {
			todo = append(todo, pending{nm, strings.TrimSpace(s)})
		}
	}
	_ = rows.Close()
	for _, p := range todo {
		if _, err := db.Exec(`UPDATE rules SET SQL=?, UPDATED_AT=? WHERE NM=?`,
			qaLegacyRuleTemplates[p.sql], time.Now().Format(time.RFC3339), p.nm); err != nil {
			log.Printf("quality-audit 迁移规则模板 %s 失败: %v", p.nm, err)
			continue
		}
		log.Printf("quality-audit 规则模板已升级为占位符版本: %s", p.nm)
	}
}

// qaTableHasColumn 判断表是否已有某列（SQLite：PRAGMA table_info）
func qaTableHasColumn(db *sql.DB, table, column string) bool {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return false
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			continue
		}
		if strings.EqualFold(name, column) {
			return true
		}
	}
	return false
}

func migrateQualityAuditFillChecked(db *sql.DB) {
	for _, t := range []string{"item_fill_rate", "record_fill_rate"} {
		_, err := db.Exec(`ALTER TABLE ` + t + ` ADD COLUMN CHECKED INTEGER NOT NULL DEFAULT 1`)
		if err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
			log.Printf("quality-audit migrate %s CHECKED: %v", t, err)
		}
	}
}

// migrateQualityAuditScheduleFillEnabled 给老库的 qa_schedules 补 fill_enabled 列（默认 1=执行填报率审核）
func migrateQualityAuditScheduleFillEnabled(db *sql.DB) {
	if qaTableHasColumn(db, "qa_schedules", "fill_enabled") {
		return
	}
	if _, err := db.Exec(`ALTER TABLE qa_schedules ADD COLUMN fill_enabled INTEGER DEFAULT 1`); err != nil &&
		!strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
		log.Printf("quality-audit migrate qa_schedules.fill_enabled: %v", err)
	}
}

// migrateQualityAuditRuleAiReview 规则新增「AI 复核原则」列（空 = 不做 AI 复核）。
func migrateQualityAuditRuleAiReview(db *sql.DB) {
	if qaTableHasColumn(db, "rules", "ai_review_prompt") {
		return
	}
	if _, err := db.Exec(`ALTER TABLE rules ADD COLUMN ai_review_prompt TEXT DEFAULT ''`); err != nil &&
		!strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
		log.Printf("quality-audit migrate rules.ai_review_prompt: %v", err)
	}
}

// migrateQualityAuditScheduleAiEnabled 定时任务新增「启用 AI 校核」开关：
// 默认 1（勾选），但真正是否调用 AI 由规则自身是否填了复核原则决定，不会产生额外开销。
func migrateQualityAuditScheduleAiEnabled(db *sql.DB) {
	if qaTableHasColumn(db, "qa_schedules", "ai_check_enabled") {
		return
	}
	if _, err := db.Exec(`ALTER TABLE qa_schedules ADD COLUMN ai_check_enabled INTEGER DEFAULT 1`); err != nil &&
		!strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
		log.Printf("quality-audit migrate qa_schedules.ai_check_enabled: %v", err)
	}
}

// --- SQL 安全校验（只允许 SELECT 查询） ---

var qaAllowedSQLPrefixes = []string{"SELECT", "WITH"}

func validateQASQL(sqlStr string) error {
	s := strings.ToUpper(strings.TrimSpace(sqlStr))
	if s == "" {
		return nil // 空SQL允许（分类节点）
	}
	for _, prefix := range qaAllowedSQLPrefixes {
		if strings.HasPrefix(s, prefix) {
			// 额外检查：禁止多语句注入
			if strings.Contains(s, ";") && !strings.HasSuffix(strings.TrimSpace(s), ";") {
				return fmt.Errorf("SQL 不允许包含分号（防止多语句注入）")
			}
			return nil
		}
	}
	return fmt.Errorf("只允许 SELECT 或 WITH 查询，禁止 INSERT/UPDATE/DELETE/DDL")
}

func sanitizeSQLForQA(sqlStr string) (string, error) {
	if err := validateQASQL(sqlStr); err != nil {
		return "", err
	}
	// 移除尾部多余分号
	s := strings.TrimRight(strings.TrimSpace(sqlStr), ";")
	return s, nil
}

// --- Oracle 方言转换为目标库（规则 SQL 默认按 Oracle 书写） ---

func normalizeQualityDialect(dbType string) string {
	switch dbType {
	case "mysql", "mariadb", "tidb":
		return "mysql"
	case "postgresql", "timescaledb", "cockroachdb":
		return "postgresql"
	case "sqlserver":
		return "sqlserver"
	case "dm":
		return "dm"
	case "sqlite":
		return "sqlite"
	case "oracle":
		return "oracle"
	default:
		return "mysql"
	}
}

func convertOracleSQLForDialect(sql, dialect string) string {
	s := strings.TrimSpace(sql)
	if s == "" || dialect == "oracle" {
		return s
	}

	// NVL / NVL2 → COALESCE（各库普遍支持）
	reNVL := regexp.MustCompile(`(?i)\bNVL\s*\(`)
	s = reNVL.ReplaceAllString(s, "COALESCE(")

	// SYSDATE / SYSTIMESTAMP
	switch dialect {
	case "mysql":
		reSys := regexp.MustCompile(`(?i)\bSYSDATE\b`)
		s = reSys.ReplaceAllString(s, "NOW()")
		s = regexp.MustCompile(`(?i)\bSYSTIMESTAMP\b`).ReplaceAllString(s, "NOW()")
	case "postgresql":
		s = regexp.MustCompile(`(?i)\bSYSDATE\b`).ReplaceAllString(s, "CURRENT_TIMESTAMP")
		s = regexp.MustCompile(`(?i)\bSYSTIMESTAMP\b`).ReplaceAllString(s, "CURRENT_TIMESTAMP")
	case "sqlserver":
		s = regexp.MustCompile(`(?i)\bSYSDATE\b`).ReplaceAllString(s, "GETDATE()")
		s = regexp.MustCompile(`(?i)\bSYSTIMESTAMP\b`).ReplaceAllString(s, "SYSDATETIME()")
	case "sqlite":
		s = regexp.MustCompile(`(?i)\bSYSDATE\b`).ReplaceAllString(s, "datetime('now')")
		s = regexp.MustCompile(`(?i)\bSYSTIMESTAMP\b`).ReplaceAllString(s, "datetime('now')")
	case "dm":
		// 达梦兼容 Oracle 语法较多，按需仅替换双竖线
	default: // dm 保留 SYSDATE
	}

	// FROM DUAL
	reDual := regexp.MustCompile(`(?i)\s+FROM\s+DUAL\b`)
	if dialect == "postgresql" || dialect == "mysql" || dialect == "sqlite" {
		s = reDual.ReplaceAllString(s, "")
	} else if dialect == "sqlserver" {
		s = reDual.ReplaceAllString(s, "")
	}

	// ROWNUM
	s = applyOracleRowNum(s, dialect)

	return strings.TrimSpace(s)
}

func applyOracleRowNum(sql, dialect string) string {
	s := sql
	reWhere := regexp.MustCompile(`(?i)\bWHERE\s+ROWNUM\s*<=\s*(\d+)`)
	if m := reWhere.FindStringSubmatch(s); len(m) == 2 {
		n := m[1]
		s = reWhere.ReplaceAllString(s, "")
		return appendLimitForDialect(strings.TrimSpace(s), dialect, n)
	}
	reAnd := regexp.MustCompile(`(?i)\s+AND\s+ROWNUM\s*<=\s*(\d+)`)
	if m := reAnd.FindStringSubmatch(s); len(m) == 2 {
		n := m[1]
		s = reAnd.ReplaceAllString(s, "")
		return appendLimitForDialect(strings.TrimSpace(s), dialect, n)
	}
	return s
}

func appendLimitForDialect(sql, dialect, n string) string {
	if hasTopLevelLimit(sql) {
		return sql
	}
	switch dialect {
	case "mysql", "postgresql", "sqlite", "dm", "oracle":
		return sql + " LIMIT " + n
	case "sqlserver":
		return sql + " OFFSET 0 ROWS FETCH NEXT " + n + " ROWS ONLY"
	default:
		return sql + " LIMIT " + n
	}
}

func hasTopLevelLimit(s string) bool {
	return regexp.MustCompile(`(?i)\bLIMIT\s+\d+\s*$`).MatchString(strings.TrimSpace(s)) ||
		regexp.MustCompile(`(?i)\bFETCH\s+NEXT\s+\d+\s+ROWS\s+ONLY\s*$`).MatchString(strings.TrimSpace(s))
}

type qaRule struct {
	NM        string            `json:"nm"`
	XH        string            `json:"xh"`
	Name      string            `json:"name"`
	SQL       string            `json:"sql"`
	Category  string            `json:"category"`
	Params    map[string]string `json:"params,omitempty"`
	UpdatedAt string            `json:"updated_at"`
	// AIReviewPrompt 该规则的 AI 复核原则（可选）：
	// 填了 → 审核不通过时按这段文字让 AI 复核；留空 → 以 SQL 审核结果为最终结果，不调用 AI。
	AIReviewPrompt string `json:"ai_review_prompt,omitempty"`
}

// qaRuleTree 规则树节点，用于构建层级结构的规则显示
type qaRuleTree struct {
	qaRule
	Children []*qaRuleTree `json:"children,omitempty"`
}

// MarshalJSON 自定义 JSON 序列化，仅在有子节点时输出 children 字段
func (n *qaRuleTree) MarshalJSON() ([]byte, error) {
	m := map[string]interface{}{
		"nm": n.NM, "xh": n.XH, "name": n.Name, "sql": n.SQL, "category": n.Category, "updated_at": n.UpdatedAt,
	}
	if len(n.Params) > 0 {
		m["params"] = n.Params
	}
	if len(n.Children) > 0 {
		m["children"] = n.Children
	}
	return json.Marshal(m)
}

// padNM 将 NM 补齐为 6 位数字，不足前面补 0，超过则截取前 6 位
// 例如: "1" -> "000001", "1234567" -> "123456"
func padNM(nm string) string {
	nm = strings.TrimSpace(nm)
	if nm == "" {
		return ""
	}
	if len(nm) > 6 {
		return nm[:6]
	}
	for len(nm) < 6 {
		nm = "0" + nm
	}
	return nm
}

// parentXH 根据当前序号获取父级序号
// 例如: "0102" -> "01", "01" -> ""
func parentXH(xh string) string {
	xh = strings.TrimSpace(xh)
	if len(xh) <= 2 {
		return ""
	}
	return xh[:len(xh)-2]
}

func loadRulesFlat() ([]qaRule, error) {
	db, err := openQualityAuditDB()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(`SELECT NM, XH, NAME, COALESCE(SQL,''), CATEGORY, COALESCE(PARAMS,''), UPDATED_AT, COALESCE(ai_review_prompt,'') FROM rules ORDER BY XH`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []qaRule
	for rows.Next() {
		var r qaRule
		var paramsJSON string
		if err := rows.Scan(&r.NM, &r.XH, &r.Name, &r.SQL, &r.Category, &paramsJSON, &r.UpdatedAt, &r.AIReviewPrompt); err != nil {
			return nil, err
		}
		if strings.TrimSpace(paramsJSON) != "" {
			var p map[string]string
			if err := json.Unmarshal([]byte(paramsJSON), &p); err == nil && len(p) > 0 {
				r.Params = p
			}
		}
		list = append(list, r)
	}
	return list, rows.Err()
}

func buildRuleTree(list []qaRule) []*qaRuleTree {
	byXH := make(map[string]*qaRuleTree)
	for _, r := range list {
		rr := r
		byXH[r.XH] = &qaRuleTree{qaRule: rr, Children: nil}
	}
	childOfParent := map[string]bool{}
	for _, r := range list {
		p := parentXH(r.XH)
		if p != "" {
			if par, ok := byXH[p]; ok {
				par.Children = append(par.Children, byXH[r.XH])
				childOfParent[r.XH] = true
			}
		}
	}
	var roots []*qaRuleTree
	for _, r := range list {
		if childOfParent[r.XH] {
			continue
		}
		roots = append(roots, byXH[r.XH])
	}
	var sortFn func(nodes []*qaRuleTree)
	sortFn = func(nodes []*qaRuleTree) {
		sort.Slice(nodes, func(i, j int) bool { return nodes[i].XH < nodes[j].XH })
		for _, n := range nodes {
			sortFn(n.Children)
		}
	}
	sortFn(roots)
	return roots
}

// qaRespondSuccess 返回与数据工具箱其它接口一致的成功 JSON（含 success: true）。
// jsonSuccess 仅序列化传入 map，历史上未写入 success，前端按 !d.success 会误判为失败。
func qaRespondSuccess(w http.ResponseWriter, data map[string]interface{}) {
	if data == nil {
		jsonSuccess(w, map[string]interface{}{"success": true})
		return
	}
	if _, ok := data["success"]; ok {
		jsonSuccess(w, data)
		return
	}
	out := make(map[string]interface{}, len(data)+1)
	for k, v := range data {
		out[k] = v
	}
	out["success"] = true
	jsonSuccess(w, out)
}

func handleQualityAuditAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "")
		return
	}

	prefix := "/api/v1/quality-audit"
	path := strings.TrimPrefix(r.URL.Path, prefix)
	path = strings.Trim(path, "/")
	parts := strings.Split(path, "/")

	switch {
	case path == "rules" && r.Method == http.MethodGet:
		qaRulesGET(w, username)
	case path == "rules" && r.Method == http.MethodPost:
		qaRulesPOST(w, r, username)
	case len(parts) == 2 && parts[0] == "rules" && parts[1] == "import" && r.Method == http.MethodPost:
		qaRulesImport(w, r, username)
	case len(parts) == 2 && parts[0] == "rules" && r.Method == http.MethodDelete:
		qaRulesDELETE(w, parts[1], username)
	case path == "fill-rates" && (r.Method == http.MethodGet || r.Method == http.MethodPost):
		qaFillRates(w, r, username)
	case path == "execute" && r.Method == http.MethodPost:
		qaExecute(w, r, username)
	case path == "execute/stream" && r.Method == http.MethodPost:
		qaExecuteStream(w, r, username)
	case len(parts) == 2 && parts[0] == "execute" && parts[1] == "cancel" && r.Method == http.MethodPost:
		qaExecuteCancel(w, r, username)
	case path == "export" && r.Method == http.MethodGet:
		qaExportReport(w, r, username)
	case path == "schedules" && r.Method == http.MethodGet:
		qaSchedulesGET(w, r, username)
	case path == "schedules" && r.Method == http.MethodPost:
		qaSchedulesPOST(w, r, username)
	case len(parts) == 2 && parts[0] == "schedules" && r.Method == http.MethodDelete:
		qaScheduleDELETE(w, parts[1], username)
	case len(parts) == 3 && parts[0] == "schedules" && parts[2] == "run" && r.Method == http.MethodPost:
		qaScheduleRun(w, r, parts[1], username)
	case path == "runs" && r.Method == http.MethodGet:
		qaRunsGET(w, r, username)
	case len(parts) == 2 && parts[0] == "runs" && r.Method == http.MethodGet:
		qaRunGET(w, r, parts[1], username)
	case len(parts) == 3 && parts[0] == "runs" && parts[2] == "report" && r.Method == http.MethodGet:
		qaRunReportGET(w, r, parts[1], username)
	case len(parts) == 3 && parts[0] == "runs" && parts[2] == "progress" && r.Method == http.MethodGet:
		qaRunProgressGET(w, parts[1], username)
	case path == "progress/active" && r.Method == http.MethodGet:
		qaProgressActiveGET(w, username)
	case path == "overview" && r.Method == http.MethodGet:
		qaOverviewGET(w, r, username)
	case path == "schedule":
		// 旧版单数 schedule 接口已废弃（前端从未调用），改用 /schedules
		apiNotFound(w, "接口不存在，请使用 /api/v1/quality-audit/schedules")
	case path == "stats" && r.Method == http.MethodGet:
		qaStats(w, r, username)
	case path == "report" && r.Method == http.MethodPost:
		qaReport(w, r, username)
	case path == "preview" && r.Method == http.MethodPost:
		qaPreviewPOST(w, r, username)
	case path == "templates" && r.Method == http.MethodGet:
		qaTemplatesGET(w, username)
	case path == "templates" && r.Method == http.MethodPost:
		qaTemplatesPOST(w, r, username)
	case len(parts) == 2 && parts[0] == "templates" && r.Method == http.MethodDelete:
		qaTemplatesDELETE(w, parts[1], username)
	case path == "history" && r.Method == http.MethodGet:
		qaHistoryGET(w, r, username)
	case path == "errors" && r.Method == http.MethodGet:
		qaErrorsGET(w, r, username)
	case len(parts) == 2 && parts[0] == "rules" && parts[1] == "versions" && r.Method == http.MethodGet:
		qaRuleVersionsGET(w, r)
	default:
		apiNotFound(w, "接口不存在")
	}
}

func qaRulesGET(w http.ResponseWriter, username string) {
	_ = username
	list, err := loadRulesFlat()
	if err != nil {
		log.Printf("加载规则列表失败: %v", err)
		apiInternalError(w, "加载规则列表失败")
		return
	}
	tree := buildRuleTree(list)
	qaRespondSuccess(w, map[string]interface{}{"tree": tree, "flat": list})
}

func qaRulesPOST(w http.ResponseWriter, r *http.Request, username string) {
	var body struct {
		NM           string            `json:"nm"`
		XH           string            `json:"xh"`
		Name         string            `json:"name"`
		SQL          string            `json:"sql"`
		Category     string            `json:"category"`
		Params       map[string]string `json:"params"`
		AIReview     string            `json:"ai_review_prompt"`
		ChangeReason string            `json:"change_reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apiBadRequest(w, "JSON 解析失败")
		return
	}
	body.NM = padNM(body.NM)
	if body.NM == "" || strings.TrimSpace(body.XH) == "" || strings.TrimSpace(body.Name) == "" {
		apiInvalidInput(w, "nm、xh、name 不能为空")
		return
	}
	// 参数与 SQL 占位符必须匹配：缺参数直接拒绝保存，别等执行时才炸
	if missing, verr := qaValidateRuleParams(body.SQL, body.Params); verr != nil {
		apiInvalidInput(w, verr.Error())
		return
	} else if len(missing) > 0 {
		apiInvalidInput(w, fmt.Sprintf("SQL 中的占位符未填参数：%s（在「规则参数」里填写）", "{{"+strings.Join(missing, "}}、{{")+"}}"))
		return
	}
	params := qaPruneRuleParams(body.SQL, body.Params)
	paramsJSON := "{}"
	if len(params) > 0 {
		if b, err := json.Marshal(params); err == nil {
			paramsJSON = string(b)
		}
	}
	now := time.Now().Format(time.RFC3339)
	db, err := openQualityAuditDB()
	if err != nil {
		log.Printf("打开数据库失败: %v", err)
		apiInternalError(w, "数据库连接失败")
		return
	}

	// 检查是否已存在，获取当前版本
	var currentVersion int
	var oldSQL, oldName, oldCategory sql.NullString
	err = db.QueryRow(`SELECT COALESCE((SELECT MAX(version) FROM rule_versions WHERE nm = ?), 0), 
		(SELECT sql FROM rules WHERE nm = ?),
		(SELECT name FROM rules WHERE nm = ?),
		(SELECT category FROM rules WHERE nm = ?)`, body.NM, body.NM, body.NM, body.NM).Scan(&currentVersion, &oldSQL, &oldName, &oldCategory)
	if err != nil && err != sql.ErrNoRows {
		log.Printf("查询规则版本失败: %v", err)
		apiInternalError(w, "查询规则失败")
		return
	}

	// 保存规则
	_, err = db.Exec(`INSERT INTO rules (NM, XH, NAME, SQL, CATEGORY, PARAMS, AI_REVIEW_PROMPT, UPDATED_AT) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(NM) DO UPDATE SET XH=excluded.XH, NAME=excluded.NAME, SQL=excluded.SQL, CATEGORY=excluded.CATEGORY, PARAMS=excluded.PARAMS, AI_REVIEW_PROMPT=excluded.AI_REVIEW_PROMPT, UPDATED_AT=excluded.UPDATED_AT`,
		body.NM, strings.TrimSpace(body.XH), strings.TrimSpace(body.Name), body.SQL, strings.TrimSpace(body.Category), paramsJSON, strings.TrimSpace(body.AIReview), now)
	if err != nil {
		log.Printf("保存规则失败: %v", err)
		apiInternalError(w, "保存规则失败")
		return
	}

	// 记录版本历史（仅当 SQL 或名称变更时）
	if oldSQL.String != body.SQL || oldName.String != strings.TrimSpace(body.Name) {
		newVersion := currentVersion + 1
		_, _ = db.Exec(`INSERT INTO rule_versions (nm, xh, name, sql, category, version, changed_at, changed_by, change_reason) VALUES (?,?,?,?,?,?,?,?,?)`,
			body.NM, strings.TrimSpace(body.XH), strings.TrimSpace(body.Name), body.SQL, strings.TrimSpace(body.Category), newVersion, now, username, body.ChangeReason)
	}

	qaRespondSuccess(w, nil)
}

func qaRulesDELETE(w http.ResponseWriter, nm string, username string) {
	_ = username
	nm = padNM(nm)
	if nm == "" {
		apiInvalidInput(w, "nm 无效")
		return
	}
	db, err := openQualityAuditDB()
	if err != nil {
		log.Printf("打开数据库失败: %v", err)
		apiInternalError(w, "数据库连接失败")
		return
	}
	_, err = db.Exec(`DELETE FROM rules WHERE NM=?`, nm)
	if err != nil {
		log.Printf("删除规则失败: %v", err)
		apiInternalError(w, "删除规则失败")
		return
	}
	qaRespondSuccess(w, nil)
}

func qaRulesImport(w http.ResponseWriter, r *http.Request, username string) {
	_ = username
	var body struct {
		Rules []struct {
			NM         string            `json:"nm"`
			XH         string            `json:"xh"`
			Name       string            `json:"name"`
			SQL        string            `json:"sql"`
			Category   string            `json:"category"`
			Params     map[string]string `json:"params"`
			AIReview   string            `json:"ai_review_prompt"`
		} `json:"rules"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Rules) == 0 {
		apiInvalidInput(w, "请提供 rules 数组")
		return
	}
	db, err := openQualityAuditDB()
	if err != nil {
		log.Printf("打开数据库失败: %v", err)
		apiInternalError(w, "数据库连接失败")
		return
	}
	tx, err := db.Begin()
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	now := time.Now().Format(time.RFC3339)
	n := 0
	for _, row := range body.Rules {
		nm := padNM(row.NM)
		if nm == "" || strings.TrimSpace(row.XH) == "" || strings.TrimSpace(row.Name) == "" {
			continue
		}
		if _, verr := qaValidateRuleParams(row.SQL, row.Params); verr != nil {
			_ = tx.Rollback()
			apiInvalidInput(w, fmt.Sprintf("规则 %s：%s", nm, verr.Error()))
			return
		}
		params := qaPruneRuleParams(row.SQL, row.Params)
		paramsJSON := "{}"
		if len(params) > 0 {
			if b, jerr := json.Marshal(params); jerr == nil {
				paramsJSON = string(b)
			}
		}
		_, err = tx.Exec(`INSERT INTO rules (NM, XH, NAME, SQL, CATEGORY, PARAMS, AI_REVIEW_PROMPT, UPDATED_AT) VALUES (?,?,?,?,?,?,?,?)
ON CONFLICT(NM) DO UPDATE SET XH=excluded.XH, NAME=excluded.NAME, SQL=excluded.SQL, CATEGORY=excluded.CATEGORY, PARAMS=excluded.PARAMS, AI_REVIEW_PROMPT=excluded.AI_REVIEW_PROMPT, UPDATED_AT=excluded.UPDATED_AT`,
			nm, strings.TrimSpace(row.XH), strings.TrimSpace(row.Name), row.SQL, strings.TrimSpace(row.Category), paramsJSON, strings.TrimSpace(row.AIReview), now)
		if err != nil {
			_ = tx.Rollback()
			apiInternalError(w, err.Error())
			return
		}
		n++
	}
	if err := tx.Commit(); err != nil {
		apiInternalError(w, err.Error())
		return
	}
	qaRespondSuccess(w, map[string]interface{}{"imported": n})
}

type fillRow struct {
	TableName   string `json:"table_name"`
	FieldName   string `json:"field_name"`
	Numerator   string `json:"numerator"`
	Denominator string `json:"denominator"`
	Checked     bool   `json:"checked"`
	UpdatedAt   string `json:"updated_at"`
}

type fillRowIn struct {
	TableName   string `json:"table_name"`
	FieldName   string `json:"field_name"`
	Numerator   string `json:"numerator"`
	Denominator string `json:"denominator"`
	Checked     *bool  `json:"checked"`
}

func coalesceFillChecked(p *bool) bool {
	if p == nil {
		return true
	}
	return *p
}

func qaFillRates(w http.ResponseWriter, r *http.Request, username string) {
	_ = username
	db, err := openQualityAuditDB()
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	if r.Method == http.MethodGet {
		item, _ := scanFillTable(db, `SELECT TABLE_NAME, FIELD_NAME, NUMERATOR, DENOMINATOR, CHECKED, UPDATED_AT FROM item_fill_rate ORDER BY TABLE_NAME, FIELD_NAME`)
		rec, _ := scanFillTable(db, `SELECT TABLE_NAME, FIELD_NAME, NUMERATOR, DENOMINATOR, CHECKED, UPDATED_AT FROM record_fill_rate ORDER BY TABLE_NAME, FIELD_NAME`)
		qaRespondSuccess(w, map[string]interface{}{
			"item_fill_rate":   item,
			"record_fill_rate": rec,
		})
		return
	}
	var body struct {
		ItemFill   []fillRowIn `json:"item_fill_rate"`
		RecordFill []fillRowIn `json:"record_fill_rate"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apiBadRequest(w, "JSON 解析失败")
		return
	}
	tx, err := db.Begin()
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	_, _ = tx.Exec(`DELETE FROM item_fill_rate`)
	_, _ = tx.Exec(`DELETE FROM record_fill_rate`)
	now := time.Now().Format(time.RFC3339)
	for _, row := range body.ItemFill {
		if strings.TrimSpace(row.TableName) == "" {
			continue
		}
		ch := 0
		if coalesceFillChecked(row.Checked) {
			ch = 1
		}
		_, err = tx.Exec(`INSERT INTO item_fill_rate (TABLE_NAME, FIELD_NAME, NUMERATOR, DENOMINATOR, CHECKED, UPDATED_AT) VALUES (?,?,?,?,?,?)`,
			strings.TrimSpace(row.TableName), strings.TrimSpace(row.FieldName), row.Numerator, row.Denominator, ch, now)
		if err != nil {
			_ = tx.Rollback()
			apiInternalError(w, err.Error())
			return
		}
	}
	for _, row := range body.RecordFill {
		if strings.TrimSpace(row.TableName) == "" {
			continue
		}
		ch := 0
		if coalesceFillChecked(row.Checked) {
			ch = 1
		}
		_, err = tx.Exec(`INSERT INTO record_fill_rate (TABLE_NAME, FIELD_NAME, NUMERATOR, DENOMINATOR, CHECKED, UPDATED_AT) VALUES (?,?,?,?,?,?)`,
			strings.TrimSpace(row.TableName), strings.TrimSpace(row.FieldName), row.Numerator, row.Denominator, ch, now)
		if err != nil {
			_ = tx.Rollback()
			apiInternalError(w, err.Error())
			return
		}
	}
	if err := tx.Commit(); err != nil {
		apiInternalError(w, err.Error())
		return
	}
	qaRespondSuccess(w, nil)
}

func scanFillTable(db *sql.DB, q string) ([]fillRow, error) {
	rows, err := db.Query(q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []fillRow
	for rows.Next() {
		var r fillRow
		var ch int
		if err := rows.Scan(&r.TableName, &r.FieldName, &r.Numerator, &r.Denominator, &ch, &r.UpdatedAt); err != nil {
			return nil, err
		}
		r.Checked = ch != 0
		out = append(out, r)
	}
	return out, rows.Err()
}

// qaExecuteRules 并行执行指定规则的审核查询，供 qaExecute 与定时任务复用。
// 返回每条规则的结果、通过数、不通过数；执行错误会写入 audit_errors。
// qaCountAIFlagged 统计本次 AI 复核里被判为「疑似误判」的规则条数。
func qaCountAIFlagged(ruleResults []map[string]interface{}) int {
	n := 0
	for _, row := range ruleResults {
		if mis, _ := row["ai_misjudged"].(bool); mis {
			n++
		}
	}
	return n
}

func qaExecuteRules(databaseID string, targetDB *sql.DB, dialect string, ruleNMs []string, username string, t0 time.Time, onDone func(nm, name string)) ([]map[string]interface{}, int, int, error) {
	flat, err := loadRulesFlat()
	if err != nil {
		return nil, 0, 0, err
	}
	byNM := map[string]qaRule{}
	for _, x := range flat {
		byNM[x.NM] = x
	}

	metaDB, _ := openQualityAuditDB()

	type ruleResult struct {
		nm    string
		entry map[string]interface{}
	}

	resultChan := make(chan ruleResult, len(ruleNMs))
	var wg sync.WaitGroup

	// 限制并发数，避免数据库连接耗尽
	semaphore := make(chan struct{}, 5) // 最多 5 个并发

	for _, nm := range ruleNMs {
		nm = padNM(nm)
		rule, exists := byNM[nm]
		if !exists {
			continue
		}

		wg.Add(1)
		go func(r qaRule) {
			defer wg.Done()
			semaphore <- struct{}{}        // 获取信号量
			defer func() { <-semaphore }() // 释放信号量

			orig := strings.TrimSpace(r.SQL)
			if orig == "" {
				resultChan <- ruleResult{nm: r.NM, entry: map[string]interface{}{
					"nm": r.NM, "xh": r.XH, "name": r.Name, "skipped": true, "message": "分类节点无 SQL",
				}}
				return
			}

			// 渲染参数（占位符）→ 安全校验 → 方言转换；任一步失败都给出可读报错，
			// 不把空壳 SQL 丢给数据库（旧行为会换来一条 -2007 语法错误）
			execSQL, prepErr := qaPrepareRuleExecutionSQL(r, dialect)
			if prepErr != nil {
				entry := map[string]interface{}{
					"nm": r.NM, "xh": r.XH, "name": r.Name, "category": r.Category,
					"sql_original": orig, "error": prepErr.Error(), "passed": false,
					"violation_count": 0, "ai_review_prompt": r.AIReviewPrompt,
				}
				if metaDB != nil {
					_, _ = metaDB.Exec(`INSERT INTO audit_errors (database_id, rule_nm, rule_name, error_message, executed_at, created_by) VALUES (?,?,?,?,?,?)`,
						databaseID, r.NM, r.Name, prepErr.Error(), t0.Format(time.RFC3339), username)
				}
				resultChan <- ruleResult{nm: r.NM, entry: entry}
				return
			}
			cnt, sample, errExec := executeRuleQuery(targetDB, execSQL)
			entry := map[string]interface{}{
				"nm":               r.NM,
				"xh":               r.XH,
				"name":             r.Name,
				"category":         r.Category,
				"sql_original":     orig,
				"sql_executed":     execSQL,
				"violation_count":  cnt,
				"sample_rows":      sample,
				"ai_review_prompt": r.AIReviewPrompt,
			}
			if errExec != nil {
				entry["error"] = errExec.Error()
				entry["passed"] = false
				if metaDB != nil {
					_, _ = metaDB.Exec(`INSERT INTO audit_errors (database_id, rule_nm, rule_name, error_message, executed_at, created_by) VALUES (?,?,?,?,?,?)`,
						databaseID, r.NM, r.Name, errExec.Error(), t0.Format(time.RFC3339), username)
				}
			} else {
				entry["passed"] = cnt == 0
			}
			resultChan <- ruleResult{nm: r.NM, entry: entry}
		}(rule)
	}

	// 等待所有 goroutine 完成后关闭 channel
	go func() {
		wg.Wait()
		close(resultChan)
	}()

	// 收集结果
	var ruleResults []map[string]interface{}
	passed, failed := 0, 0
	for result := range resultChan {
		if passedRule, ok := result.entry["passed"].(bool); ok {
			if passedRule {
				passed++
			} else {
				failed++
			}
		}
		ruleResults = append(ruleResults, result.entry)
		if onDone != nil {
			name, _ := result.entry["name"].(string)
			onDone(result.nm, name)
		}
	}
	return ruleResults, passed, failed, nil
}

func qaExecute(w http.ResponseWriter, r *http.Request, username string) {
	var req struct {
		DatabaseID string   `json:"database_id"`
		RuleNMs    []string `json:"rule_nms"`
		// AICheckEnabled 本次是否启用 AI 复核（nil = 默认启用）。
		// 真正是否调用 AI 由规则自身是否填了「AI 复核原则」决定。
		AICheckEnabled *bool `json:"ai_check_enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apiBadRequest(w, "JSON 解析失败")
		return
	}
	if req.DatabaseID == "" || len(req.RuleNMs) == 0 {
		apiInvalidInput(w, "database_id 与 rule_nms 必填")
		return
	}
	aiEnabled := true
	if req.AICheckEnabled != nil {
		aiEnabled = *req.AICheckEnabled
	}
	dataOntologyMu.RLock()
	dbConfig, ok := dataOntologyDatabases[req.DatabaseID]
	dataOntologyMu.RUnlock()
	if !ok || !dataOntologyResourceVisible(dbConfig.Owner, username) {
		apiNotFound(w, "数据库不存在或无权访问")
		return
	}
	switch dbConfig.Type {
	case "mysql", "mariadb", "tidb", "postgresql", "timescaledb", "cockroachdb", "sqlserver", "oracle", "dm", "sqlite":
	default:
		apiBadRequest(w, "该数据库类型不支持 SQL 审核")
		return
	}
	dialect := normalizeQualityDialect(dbConfig.Type)

	// 使用连接池获取数据库连接
	targetDB, err := getDBFromPool(dbConfig)
	if err != nil {
		apiInternalError(w, "连接失败")
		return
	}
	// 注意：不关闭连接，由连接池管理

	// 检查缓存（缓存只存纯 SQL 审核结果，AI 复核每次现场跑，避免过期结论被复用）
	cacheKey := qaCacheKey(req.DatabaseID, req.RuleNMs)
	if cached, hit := qaCacheGet(cacheKey); hit {
		reviewed, aiModel, aiSkipReason := qaAttachAIReview(cached, aiEnabled)
		resp := map[string]interface{}{
			"cached":      true,
			"message":     "结果来自缓存 (10分钟内有效)",
			"rules":       cached,
			"database_id": req.DatabaseID,
			"summary": map[string]interface{}{
				"total_rules":  len(cached),
				"ai_reviewed":  reviewed,
				"ai_flagged":   qaCountAIFlagged(cached),
				"ai_model":     aiModel,
				"ai_skipped":   aiSkipReason != "",
				"ai_skip_reason": aiSkipReason,
			},
		}
		qaRespondSuccess(w, resp)
		return
	}

	t0 := time.Now()

	ruleResults, passed, failed, err := qaExecuteRules(req.DatabaseID, targetDB, dialect, req.RuleNMs, username, t0, nil)
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}

	metaDB, _ := openQualityAuditDB()

	// 写入缓存
	qaCacheSet(cacheKey, ruleResults)

	itemRows, _ := scanFillTable(metaDB, `SELECT TABLE_NAME, FIELD_NAME, NUMERATOR, DENOMINATOR, CHECKED, UPDATED_AT FROM item_fill_rate WHERE CHECKED = 1`)
	recRows, _ := scanFillTable(metaDB, `SELECT TABLE_NAME, FIELD_NAME, NUMERATOR, DENOMINATOR, CHECKED, UPDATED_AT FROM record_fill_rate WHERE CHECKED = 1`)

	itemStats := runFillStats(targetDB, dialect, itemRows)
	recStats := runFillStats(targetDB, dialect, recRows)

	// 保存审核历史
	summaryJSON, _ := json.Marshal(map[string]interface{}{
		"total_rules": passed + failed,
		"passed":      passed,
		"failed":      failed,
	})
	duration := time.Since(t0).Milliseconds()
	if metaDB != nil {
		_, _ = metaDB.Exec(`INSERT INTO audit_history (database_id, database_type, executed_at, duration_ms, summary, created_by) VALUES (?,?,?,?,?,?)`,
			req.DatabaseID, dbConfig.Type, t0.Format(time.RFC3339), duration, string(summaryJSON), username)
	}

	// AI 复核（默认启用；只有填了复核原则的未通过规则才会真正调用模型）
	aiReviewed, aiModel, aiSkipReason := qaAttachAIReview(ruleResults, aiEnabled)
	summaryOut := map[string]interface{}{
		"total_rules": passed + failed,
		"passed":      passed,
		"failed":      failed,
		"ai_reviewed": aiReviewed,
		"ai_flagged":  qaCountAIFlagged(ruleResults),
	}
	if aiModel != "" {
		summaryOut["ai_model"] = aiModel
	}
	if aiSkipReason != "" {
		summaryOut["ai_skipped"] = true
		summaryOut["ai_skip_reason"] = aiSkipReason
	} else {
		summaryOut["ai_skipped"] = false
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":           true,
		"database_id":       req.DatabaseID,
		"database_type":     dbConfig.Type,
		"dialect":           dialect,
		"started_at":        t0.Format(time.RFC3339),
		"finished_at":       time.Now().Format(time.RFC3339),
		"duration_ms":       duration,
		"rules":             ruleResults,
		"item_fill_rates":   itemStats,
		"record_fill_rates": recStats,
		"ai_model":          aiModel,
		"summary":           summaryOut,
	})
}

// SSE 实时进度反馈
func qaExecuteStream(w http.ResponseWriter, r *http.Request, username string) {
	var req struct {
		DatabaseID string   `json:"database_id"`
		RuleNMs    []string `json:"rule_nms"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apiBadRequest(w, "JSON 解析失败")
		return
	}
	if req.DatabaseID == "" || len(req.RuleNMs) == 0 {
		apiBadRequest(w, "database_id 与 rule_nms 必填")
		return
	}

	// 设置 SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		apiInternalError(w, "SSE 不支持")
		return
	}

	// 发送 SSE 事件
	sendEvent := func(event string, data map[string]interface{}) {
		dataJSON, _ := json.Marshal(data)
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, string(dataJSON))
		flusher.Flush()
	}

	dataOntologyMu.RLock()
	dbConfig, ok := dataOntologyDatabases[req.DatabaseID]
	dataOntologyMu.RUnlock()
	if !ok || !dataOntologyResourceVisible(dbConfig.Owner, username) {
		sendEvent("error", map[string]interface{}{"message": "数据库不存在或无权访问"})
		return
	}

	sendEvent("start", map[string]interface{}{
		"database_id": req.DatabaseID,
		"total_rules": len(req.RuleNMs),
		"started_at":  time.Now().Format(time.RFC3339),
	})

	// 使用连接池获取数据库连接
	targetDB, err := getDBFromPool(dbConfig)
	if err != nil {
		sendEvent("error", map[string]interface{}{"message": "连接失败"})
		return
	}
	// 注意：不关闭连接，由连接池管理

	flat, _ := loadRulesFlat()
	byNM := map[string]qaRule{}
	for _, x := range flat {
		byNM[x.NM] = x
	}

	t0 := time.Now()
	dialect := normalizeQualityDialect(dbConfig.Type)
	metaDB, _ := openQualityAuditDB()

	var ruleResults []map[string]interface{}
	passed, failed := 0, 0

	for i, nm := range req.RuleNMs {
		nm = padNM(nm)
		rule, exists := byNM[nm]
		if !exists {
			continue
		}

		// 发送进度
		sendEvent("progress", map[string]interface{}{
			"current":   i + 1,
			"total":     len(req.RuleNMs),
			"rule_nm":   nm,
			"rule_name": rule.Name,
		})

		orig := strings.TrimSpace(rule.SQL)
		if orig == "" {
			ruleResults = append(ruleResults, map[string]interface{}{
				"nm": rule.NM, "xh": rule.XH, "name": rule.Name, "skipped": true, "message": "分类节点无 SQL",
			})
			continue
		}

		safeSQL, sqlErr := sanitizeSQLForQA(orig)
		if sqlErr != nil {
			entry := map[string]interface{}{
				"nm": rule.NM, "xh": rule.XH, "name": rule.Name, "error": sqlErr.Error(), "passed": false,
			}
			ruleResults = append(ruleResults, entry)
			failed++
			continue
		}

		execSQL := convertOracleSQLForDialect(safeSQL, dialect)
		cnt, sample, errExec := executeRuleQuery(targetDB, execSQL)
		entry := map[string]interface{}{
			"nm":              rule.NM,
			"xh":              rule.XH,
			"name":            rule.Name,
			"category":        rule.Category,
			"violation_count": cnt,
			"sample_rows":     sample,
		}
		if errExec != nil {
			entry["error"] = errExec.Error()
			entry["passed"] = false
			failed++
		} else {
			entry["passed"] = cnt == 0
			if entry["passed"].(bool) {
				passed++
			} else {
				failed++
			}
		}
		ruleResults = append(ruleResults, entry)

		// 发送规则完成事件
		sendEvent("rule_done", entry)
	}

	// 保存历史
	summaryJSON, _ := json.Marshal(map[string]interface{}{
		"total_rules": passed + failed,
		"passed":      passed,
		"failed":      failed,
	})
	duration := time.Since(t0).Milliseconds()
	if metaDB != nil {
		_, _ = metaDB.Exec(`INSERT INTO audit_history (database_id, database_type, executed_at, duration_ms, summary, created_by) VALUES (?,?,?,?,?,?)`,
			req.DatabaseID, dbConfig.Type, t0.Format(time.RFC3339), duration, string(summaryJSON), username)
	}

	// 发送完成事件
	sendEvent("done", map[string]interface{}{
		"success":     true,
		"database_id": req.DatabaseID,
		"duration_ms": duration,
		"summary": map[string]interface{}{
			"total_rules": passed + failed,
			"passed":      passed,
			"failed":      failed,
		},
		"rules": ruleResults,
	})
}

// 取消审核
func qaExecuteCancel(w http.ResponseWriter, r *http.Request, username string) {
	var req struct {
		DatabaseID string `json:"database_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apiBadRequest(w, "JSON 解析失败")
		return
	}
	if req.DatabaseID == "" {
		apiBadRequest(w, "database_id 必填")
		return
	}

	qaCancel(req.DatabaseID)
	qaRespondSuccess(w, map[string]interface{}{
		"message":     "已发送取消信号",
		"database_id": req.DatabaseID,
	})
}

// 审核统计
func qaStats(w http.ResponseWriter, r *http.Request, username string) {
	databaseID := r.URL.Query().Get("database_id")
	days := r.URL.Query().Get("days")
	if days == "" {
		days = "7"
	}
	daysInt, _ := strconv.Atoi(days)
	if daysInt < 1 {
		daysInt = 7
	}

	metaDB, _ := openQualityAuditDB()
	if metaDB == nil {
		apiInternalError(w, "数据库错误")
		return
	}

	// 总审核次数
	var totalAudits int
	metaDB.QueryRow(`
		SELECT COUNT(*) FROM audit_history 
		WHERE database_id = ? AND executed_at >= datetime('now', ?)`,
		databaseID, fmt.Sprintf("-%d days", daysInt)).Scan(&totalAudits)

	// 总错误次数
	var totalErrors int
	metaDB.QueryRow(`
		SELECT COUNT(*) FROM audit_errors 
		WHERE database_id = ? AND executed_at >= datetime('now', ?)`,
		databaseID, fmt.Sprintf("-%d days", daysInt)).Scan(&totalErrors)

	// 平均执行时间
	var avgDuration float64
	metaDB.QueryRow(`
		SELECT AVG(duration_ms) FROM audit_history 
		WHERE database_id = ? AND executed_at >= datetime('now', ?)`,
		databaseID, fmt.Sprintf("-%d days", daysInt)).Scan(&avgDuration)

	// 每日审核次数
	dailyRows, _ := metaDB.Query(`
		SELECT date(executed_at) as day, COUNT(*) as count
		FROM audit_history 
		WHERE database_id = ? AND executed_at >= datetime('now', ?)
		GROUP BY day ORDER BY day`,
		databaseID, fmt.Sprintf("-%d days", daysInt))
	var dailyStats []map[string]interface{}
	if dailyRows != nil {
		defer dailyRows.Close()
		for dailyRows.Next() {
			var day string
			var count int
			if err := dailyRows.Scan(&day, &count); err == nil {
				dailyStats = append(dailyStats, map[string]interface{}{
					"date":  day,
					"count": count,
				})
			}
		}
	}

	// 错误规则 Top 5
	errorRuleRows, _ := metaDB.Query(`
		SELECT rule_nm, rule_name, COUNT(*) as count
		FROM audit_errors 
		WHERE database_id = ? AND executed_at >= datetime('now', ?)
		GROUP BY rule_nm ORDER BY count DESC LIMIT 5`,
		databaseID, fmt.Sprintf("-%d days", daysInt))
	var topErrorRules []map[string]interface{}
	if errorRuleRows != nil {
		defer errorRuleRows.Close()
		for errorRuleRows.Next() {
			var ruleNm, ruleName string
			var count int
			if err := errorRuleRows.Scan(&ruleNm, &ruleName, &count); err == nil {
				topErrorRules = append(topErrorRules, map[string]interface{}{
					"rule_nm":   ruleNm,
					"rule_name": ruleName,
					"count":     count,
				})
			}
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"database_id":     databaseID,
		"days":            daysInt,
		"total_audits":    totalAudits,
		"total_errors":    totalErrors,
		"avg_duration_ms": avgDuration,
		"daily_stats":     dailyStats,
		"top_error_rules": topErrorRules,
	})
}

// 导出审核报告
func qaExportReport(w http.ResponseWriter, r *http.Request, username string) {
	databaseID := r.URL.Query().Get("database_id")
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "json"
	}

	if databaseID == "" {
		apiBadRequest(w, "database_id 必填")
		return
	}

	// 获取最近的审核历史
	metaDB, _ := openQualityAuditDB()
	if metaDB == nil {
		apiInternalError(w, "数据库错误")
		return
	}

	var historyID int
	var executedAt, summaryJSON string
	var durationMs int
	err := metaDB.QueryRow(`
		SELECT id, executed_at, duration_ms, summary 
		FROM audit_history 
		WHERE database_id = ? 
		ORDER BY executed_at DESC LIMIT 1`,
		databaseID).Scan(&historyID, &executedAt, &durationMs, &summaryJSON)
	if err != nil {
		apiBadRequest(w, "未找到审核记录")
		return
	}

	var summary map[string]interface{}
	json.Unmarshal([]byte(summaryJSON), &summary)

	// 获取错误记录
	errorRows, _ := metaDB.Query(`
		SELECT rule_nm, rule_name, error_message, executed_at 
		FROM audit_errors 
		WHERE database_id = ? 
		ORDER BY executed_at DESC`,
		databaseID)
	var errors []map[string]interface{}
	if errorRows != nil {
		defer errorRows.Close()
		for errorRows.Next() {
			var ruleNm, ruleName, errorMsg, errTime string
			if err := errorRows.Scan(&ruleNm, &ruleName, &errorMsg, &errTime); err == nil {
				errors = append(errors, map[string]interface{}{
					"rule_nm":     ruleNm,
					"rule_name":   ruleName,
					"error":       errorMsg,
					"executed_at": errTime,
				})
			}
		}
	}

	report := map[string]interface{}{
		"database_id": databaseID,
		"executed_at": executedAt,
		"duration_ms": durationMs,
		"summary":     summary,
		"errors":      errors,
		"exported_at": time.Now().Format(time.RFC3339),
		"exported_by": username,
	}

	switch format {
	case "csv":
		// CSV 格式导出
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=audit_report_%s_%s.csv", databaseID, executedAt))
		fmt.Fprintf(w, "规则编号,规则名称,状态,违规数,错误信息\n")
		if rules, ok := summary["rules"].([]map[string]interface{}); ok {
			for _, rule := range rules {
				status := "通过"
				if passed, ok := rule["passed"].(bool); ok && !passed {
					status = "失败"
				}
				violationCount := 0
				if vc, ok := rule["violation_count"].(int); ok {
					violationCount = vc
				}
				errorMsg := ""
				if e, ok := rule["error"].(string); ok {
					errorMsg = e
				}
				fmt.Fprintf(w, "%s,%s,%s,%d,%s\n",
					rule["nm"], rule["name"], status, violationCount, errorMsg)
			}
		}
	default:
		// JSON 格式导出
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=audit_report_%s_%s.json", databaseID, executedAt))
		json.NewEncoder(w).Encode(report)
	}
}

func runFillStats(db *sql.DB, dialect string, rows []fillRow) []map[string]interface{} {
	return runFillStatsWithProgress(db, dialect, rows, nil)
}

// runFillStatsWithProgress 与 runFillStats 相同，额外在每行算完后回调 onDone（用于进度条）。
func runFillStatsWithProgress(db *sql.DB, dialect string, rows []fillRow, onDone func()) []map[string]interface{} {
	type fillResult struct {
		idx   int
		entry map[string]interface{}
	}

	resultChan := make(chan fillResult, len(rows))
	var wg sync.WaitGroup

	for i, row := range rows {
		wg.Add(1)
		go func(idx int, r fillRow) {
			defer wg.Done()

			numSQLRaw := strings.TrimSpace(r.Numerator)
			denSQLRaw := strings.TrimSpace(r.Denominator)

			// SQL 安全校验
			numSQL, e0 := sanitizeSQLForQA(numSQLRaw)
			if e0 != nil {
				resultChan <- fillResult{idx: idx, entry: map[string]interface{}{
					"table_name": r.TableName, "field_name": r.FieldName, "numerator_error": e0.Error(),
				}}
				return
			}
			denSQL, e0 := sanitizeSQLForQA(denSQLRaw)
			if e0 != nil {
				resultChan <- fillResult{idx: idx, entry: map[string]interface{}{
					"table_name": r.TableName, "field_name": r.FieldName, "denominator_error": e0.Error(),
				}}
				return
			}

			numSQL = convertOracleSQLForDialect(numSQL, dialect)
			denSQL = convertOracleSQLForDialect(denSQL, dialect)
			n, e1 := execScalarFloat(db, numSQL)
			d, e2 := execScalarFloat(db, denSQL)

			m := map[string]interface{}{
				"table_name":  r.TableName,
				"field_name":  r.FieldName,
				"numerator":   n,
				"denominator": d,
			}
			if e1 != nil {
				m["numerator_error"] = e1.Error()
			}
			if e2 != nil {
				m["denominator_error"] = e2.Error()
			}
			// 表不存在时单独标记：报告里直接写「没有这个表」，不再显示分子/分母的原始报错
			if qaFillMissingTableError(e1) || qaFillMissingTableError(e2) {
				m["no_such_table"] = true
				delete(m, "numerator_error")
				delete(m, "denominator_error")
			}
			if e1 == nil && e2 == nil && d != 0 {
				m["rate_percent"] = (n / d) * 100
			}
			resultChan <- fillResult{idx: idx, entry: m}
		}(i, row)
	}

	// 等待所有 goroutine 完成
	go func() {
		wg.Wait()
		close(resultChan)
	}()

	// 收集结果并保持顺序
	results := make([]map[string]interface{}, len(rows))
	for res := range resultChan {
		results[res.idx] = res.entry
		if onDone != nil {
			onDone()
		}
	}
	return results
}

// qaFillMissingTableError 判断填报率 SQL 的执行错误是否为「表不存在」。
// 覆盖 MySQL / PostgreSQL / SQLite / SQLServer / Oracle / 达梦 等常见方言的报错文案。
// 注意：泛化的 "does not exist" 也可能是「列不存在」，这类不算表不存在，避免误报。
func qaFillMissingTableError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	strong := []string{
		"no such table", "unknown table", "invalid object name", "undefined table",
		"ora-00942", "sqlstate 42p01", "42p01",
		"无效的表", "表或视图不存在", "关系不存在", "表不存在",
	}
	for _, kw := range strong {
		if strings.Contains(msg, kw) {
			return true
		}
	}
	if strings.Contains(msg, "doesn't exist") || strings.Contains(msg, "does not exist") || strings.Contains(msg, "不存在") {
		if strings.Contains(msg, "column") || strings.Contains(msg, "字段") || strings.Contains(msg, "列") {
			return false
		}
		return true
	}
	return false
}

// qaFillCellText 取填报率行的单元格文本；nil / <nil> 统一返回空串，避免报告里出现 <nil>。
func qaFillCellText(v interface{}) string {
	if v == nil {
		return ""
	}
	s := strings.TrimSpace(fmt.Sprint(v))
	if s == "<nil>" {
		return ""
	}
	return s
}

// qaFillRateText 填报率文案：表不存在 → 「没有这个表」；算不出 → 「—」。
func qaFillRateText(m map[string]interface{}) string {
	if b, _ := m["no_such_table"].(bool); b {
		return "没有这个表"
	}
	if v, ok := m["rate_percent"]; ok && v != nil {
		if f, err := ifaceToFloat(v); err == nil {
			return fmt.Sprintf("%.2f%%", f)
		}
	}
	return "—"
}

// qaFillDocxLine 生成一条填报率文字。
// withField=true（项填报率）：表 X 字段 Y：填报率 Z%；字段为空时退化成「表 X：填报率 Z%」。
// withField=false（记录填报率）：表 X：填报率 Z%，不带字段项。
// 表不存在时统一输出「表 X：没有这个表」。
func qaFillDocxLine(m map[string]interface{}, withField bool) string {
	table := qaFillCellText(m["table_name"])
	if table == "" {
		table = "（未填写表名）"
	}
	if b, _ := m["no_such_table"].(bool); b {
		return fmt.Sprintf("表 %s：没有这个表", table)
	}
	rate := qaFillRateText(m)
	if withField {
		if f := qaFillCellText(m["field_name"]); f != "" {
			return fmt.Sprintf("表 %s 字段 %s：填报率 %s", table, f, rate)
		}
	}
	return fmt.Sprintf("表 %s：填报率 %s", table, rate)
}

func execScalarFloat(db *sql.DB, sqlStr string) (float64, error) {
	// 添加超时控制
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	row := db.QueryRowContext(ctx, sqlStr)
	var v interface{}
	if err := row.Scan(&v); err != nil {
		return 0, err
	}
	return ifaceToFloat(v)
}

func ifaceToFloat(v interface{}) (float64, error) {
	if v == nil {
		return 0, fmt.Errorf("值为 NULL")
	}
	switch t := v.(type) {
	case float64:
		return t, nil
	case float32:
		return float64(t), nil
	case int64:
		return float64(t), nil
	case int32:
		return float64(t), nil
	case int:
		return float64(t), nil
	case []byte:
		return strconv.ParseFloat(string(t), 64)
	case string:
		return strconv.ParseFloat(strings.TrimSpace(t), 64)
	case json.Number:
		return t.Float64()
	default:
		return 0, fmt.Errorf("无法转为数字: %v", v)
	}
}

func executeRuleQuery(db *sql.DB, sqlStr string) (int, []map[string]interface{}, error) {
	// 设置 30 秒超时
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	rows, err := db.QueryContext(ctx, sqlStr)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	var sample []map[string]interface{}
	n := 0
	raw := make([]interface{}, len(cols))
	ptr := make([]interface{}, len(cols))
	for rows.Next() {
		n++
		for i := range raw {
			ptr[i] = &raw[i]
		}
		if err := rows.Scan(ptr...); err != nil {
			return n - 1, sample, err
		}
		if len(sample) < 100 { // 增加到 100 行示例数据
			rowMap := map[string]interface{}{}
			for i, col := range cols {
				val := raw[i]
				if b, ok := val.([]byte); ok {
					rowMap[col] = string(b)
				} else {
					rowMap[col] = val
				}
			}
			sample = append(sample, rowMap)
		}
		if n >= 100000 {
			for rows.Next() {
				n++
				for i := range raw {
					ptr[i] = &raw[i]
				}
				_ = rows.Scan(ptr...)
			}
			break
		}
	}
	return n, sample, rows.Err()
}

func qaReport(w http.ResponseWriter, r *http.Request, username string) {
	_ = username
	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apiBadRequest(w, "JSON 解析失败")
		return
	}
	audit, _ := body["audit"].(map[string]interface{})
	if audit == nil {
		audit = body
	}
	tid, _ := body["template_id"].(string)
	doc, err := qaBuildReportDocx(audit, tid)
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	w.Header().Set("Content-Disposition", `attachment; filename="quality-audit-report.docx"`)
	_, _ = io.Copy(w, bytes.NewReader(doc))
}

// qaBuildReportDocx 按模板生成审核报告 docx 二进制，供手动报告与定时任务复用。
// templateID 为空时回退到默认模板。qaReport 的对外行为保持不变。
func qaBuildReportDocx(audit map[string]interface{}, templateID string) ([]byte, error) {
	tid := strings.TrimSpace(templateID)
	var styles *qaTemplateStyles
	if tid != "" {
		if row, err := loadReportTemplateByID(tid); err == nil && row != nil {
			styles = parseQATemplateContent(row.Content)
		}
	}
	if styles == nil {
		if row, err := loadDefaultReportTemplate(); err == nil && row != nil {
			styles = parseQATemplateContent(row.Content)
		}
	}
	if styles == nil {
		styles = parseQATemplateContent("{}")
	}
	return buildQualityAuditDocx(audit, styles)
}

type qaReportTemplateRow struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	TemplateType string `json:"template_type"`
	Content      string `json:"content"`
	IsDefault    bool   `json:"is_default"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

type qaTemplateStyles struct {
	DocTitle   string            `json:"doc_title"`
	Title      qaTemplateTextSt  `json:"title"`
	Section    qaTemplateTextSt  `json:"section"`
	Table      qaTemplateTableSt `json:"table"`
	PageHeader string            `json:"page_header"`
	PageFooter string            `json:"page_footer"`
}

type qaTemplateTextSt struct {
	FontFamily string `json:"font_family"`
	FontSize   string `json:"font_size"`
	Color      string `json:"color"`
}

type qaTemplateTableSt struct {
	Border   string `json:"border"`
	HeaderBg string `json:"header_bg"`
	RowAlt   string `json:"row_alt"`
}

func parseQATemplateContent(raw string) *qaTemplateStyles {
	out := &qaTemplateStyles{
		DocTitle: "数据质量审核报告",
		Title: qaTemplateTextSt{
			FontFamily: "Microsoft YaHei, SimHei, sans-serif",
			FontSize:   "24px",
			Color:      "#1a202c",
		},
		Section: qaTemplateTextSt{
			FontFamily: "Microsoft YaHei, SimHei, sans-serif",
			FontSize:   "16px",
			Color:      "#2d3748",
		},
		Table: qaTemplateTableSt{
			Border:   "1px solid #cbd5e1",
			HeaderBg: "#edf2f7",
			RowAlt:   "#f8fafc",
		},
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return out
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return out
	}
	if v, ok := m["doc_title"]; ok {
		var s string
		if json.Unmarshal(v, &s) == nil {
			out.DocTitle = s
		}
	}
	if v, ok := m["title"]; ok {
		_ = json.Unmarshal(v, &out.Title)
	}
	if v, ok := m["section"]; ok {
		_ = json.Unmarshal(v, &out.Section)
	}
	if v, ok := m["table"]; ok {
		_ = json.Unmarshal(v, &out.Table)
	}
	if v, ok := m["page_header"]; ok {
		var s string
		if json.Unmarshal(v, &s) == nil {
			out.PageHeader = s
		}
	}
	if v, ok := m["page_footer"]; ok {
		var s string
		if json.Unmarshal(v, &s) == nil {
			out.PageFooter = s
		}
	}
	return out
}

func wordColorVal(hex string) string {
	hex = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(hex), "#"))
	if len(hex) != 6 {
		return ""
	}
	// Word w:color uses RRGGBB
	return strings.ToUpper(hex)
}

func wordFontSizeHalfPoints(cssSize string) string {
	raw := strings.TrimSpace(cssSize)
	if raw == "" {
		return "48"
	}
	low := strings.ToLower(raw)
	isPt := strings.HasSuffix(low, "pt")
	s := strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(low, "px"), "pt"))
	n, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return "48"
	}
	if isPt {
		return fmt.Sprintf("%.0f", n*2)
	}
	h := int(n*1.5*2 + 0.5)
	if h < 8 {
		h = 8
	}
	return strconv.Itoa(h)
}

func wordFirstFontFamily(ff string) string {
	ff = strings.TrimSpace(ff)
	if ff == "" {
		return ""
	}
	if i := strings.IndexByte(ff, ','); i >= 0 {
		ff = strings.TrimSpace(ff[:i])
	}
	return ff
}

func wordRPrXML(st qaTemplateTextSt) string {
	var b strings.Builder
	b.WriteString(`<w:rPr>`)
	if ff := wordFirstFontFamily(st.FontFamily); ff != "" {
		xf := xmlEscapeQA(ff)
		b.WriteString(`<w:rFonts w:ascii="`)
		b.WriteString(xf)
		b.WriteString(`" w:hAnsi="`)
		b.WriteString(xf)
		b.WriteString(`"/>`)
	}
	if cv := wordColorVal(st.Color); cv != "" {
		b.WriteString(`<w:color w:val="`)
		b.WriteString(cv)
		b.WriteString(`"/>`)
	}
	b.WriteString(`<w:sz w:val="`)
	b.WriteString(wordFontSizeHalfPoints(st.FontSize))
	b.WriteString(`"/>`)
	b.WriteString(`<w:szCs w:val="`)
	b.WriteString(wordFontSizeHalfPoints(st.FontSize))
	b.WriteString(`"/>`)
	b.WriteString(`</w:rPr>`)
	return b.String()
}

func buildQualityAuditDocx(audit map[string]interface{}, styles *qaTemplateStyles) ([]byte, error) {
	if styles == nil {
		styles = parseQATemplateContent("{}")
	}
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	sb.WriteString(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`)
	sb.WriteString(`<w:body>`)

	addPara := func(text string) {
		sb.WriteString(`<w:p><w:r><w:rPr/><w:t xml:space="preserve">`)
		sb.WriteString(xmlEscapeQA(text))
		sb.WriteString(`</w:t></w:r></w:p>`)
	}
	addParaStyled := func(text string, st qaTemplateTextSt) {
		sb.WriteString(`<w:p><w:r>`)
		sb.WriteString(wordRPrXML(st))
		sb.WriteString(`<w:t xml:space="preserve">`)
		sb.WriteString(xmlEscapeQA(text))
		sb.WriteString(`</w:t></w:r></w:p>`)
	}

	// 添加表格函数
	addTable := func(headers []string, rows []map[string]interface{}) {
		sb.WriteString(`<w:tbl>`)
		sb.WriteString(`<w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>`)
		sb.WriteString(`<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
		sb.WriteString(`<w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
		sb.WriteString(`<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
		sb.WriteString(`<w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
		sb.WriteString(`<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
		sb.WriteString(`<w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
		sb.WriteString(`</w:tblBorders></w:tblPr>`)
		// 表头
		sb.WriteString(`<w:tr>`)
		for _, h := range headers {
			sb.WriteString(`<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="E0E0E0"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>`)
			sb.WriteString(xmlEscapeQA(h))
			sb.WriteString(`</w:t></w:r></w:p></w:tc>`)
		}
		sb.WriteString(`</w:tr>`)
		// 数据行
		for _, row := range rows {
			sb.WriteString(`<w:tr>`)
			for _, h := range headers {
				val := ""
				if v, ok := row[h]; ok {
					switch vv := v.(type) {
					case string:
						val = vv
					case float64:
						val = fmt.Sprintf("%.0f", vv)
					case int, int64:
						val = fmt.Sprintf("%d", vv)
					default:
						val = fmt.Sprintf("%v", vv)
					}
				}
				sb.WriteString(`<w:tc><w:p><w:r><w:t>`)
				sb.WriteString(xmlEscapeQA(val))
				sb.WriteString(`</w:t></w:r></w:p></w:tc>`)
			}
			sb.WriteString(`</w:tr>`)
		}
		sb.WriteString(`</w:tbl>`)
	}

	if strings.TrimSpace(styles.PageHeader) != "" {
		addPara(styles.PageHeader)
	}
	title := styles.DocTitle
	if strings.TrimSpace(title) == "" {
		title = "数据质量审核报告"
	}
	addParaStyled(title, styles.Title)
	addPara("生成时间：" + time.Now().Format("2006-01-02 15:04:05"))

	summary, _ := audit["summary"].(map[string]interface{})
	if summary != nil {
		summaryLine := fmt.Sprintf("总规则数：%v   通过：%v   不通过：%v", summary["total_rules"], summary["passed"], summary["failed"])
		if n, ok := summary["ai_reviewed"]; ok && n != nil && fmt.Sprint(n) != "0" && fmt.Sprint(n) != "" {
			summaryLine += fmt.Sprintf("   AI 复核：%v 条（须人类专家最终校核）", n)
		}
		addPara(summaryLine)
	}

	addPara("")
	cnSec := []string{"一", "二", "三", "四", "五", "六", "七", "八"}
	secIdx := 0
	nextSection := func(name string) {
		label := "、" + name
		if secIdx < len(cnSec) {
			label = cnSec[secIdx] + "、" + name
		}
		secIdx++
		addParaStyled(label, styles.Section)
	}
	nextSection("规则明细")
	rules, _ := audit["rules"].([]interface{})
	for i, x := range rules {
		row, _ := x.(map[string]interface{})
		if row == nil {
			continue
		}
		addPara(fmt.Sprintf("%d. %v（%v）", i+1, row["name"], row["nm"]))
		addPara(fmt.Sprintf("结果：违规数 %v   通过：%v", row["violation_count"], row["passed"]))
		if e, ok := row["error"].(string); ok && e != "" {
			addPara("错误：" + e)
		}
		// 用表格展示违规数据
		sr := ifaceSlice(row["sample_rows"])
		if len(sr) > 0 {
			addPara(fmt.Sprintf("违规数据（共 %d 条）：", len(sr)))
			// 收集所有字段名
			fieldSet := make(map[string]bool)
			tableRows := make([]map[string]interface{}, 0, len(sr))
			for _, item := range sr {
				if m, ok := item.(map[string]interface{}); ok {
					tableRows = append(tableRows, m)
					for k := range m {
						fieldSet[k] = true
					}
				}
			}
			// 转为有序列表
			headers := make([]string, 0, len(fieldSet))
			for k := range fieldSet {
				headers = append(headers, k)
			}
			// 按字段名排序
			for i := 0; i < len(headers)-1; i++ {
				for j := i + 1; j < len(headers); j++ {
					if headers[i] > headers[j] {
						headers[i], headers[j] = headers[j], headers[i]
					}
				}
			}
			if len(headers) > 0 && len(tableRows) > 0 {
				addTable(headers, tableRows)
			}
		}
	}

	// AI 复核结论：仅当规则行里带 AI 结果（ai_reason/ai_misjudged）时输出。
	// 纯 SQL 审核的规则不在此段出现，其报告内容与旧版本保持一致。
	aiRows := make([]map[string]interface{}, 0)
	for _, x := range rules {
		row, _ := x.(map[string]interface{})
		if row == nil {
			continue
		}
		_, hasReason := row["ai_reason"]
		_, hasMis := row["ai_misjudged"]
		if !hasReason && !hasMis {
			continue
		}
		aiRows = append(aiRows, row)
	}
	if len(aiRows) > 0 {
		addPara("")
		nextSection("AI 复核（仅供参考，须人类专家最终校核）")
		addPara("说明：以下规则在执行 SQL 审核不通过后，按其自带的复核原则交由 AI 复核。AI 结论仅供参考，不构成最终判定，须由人类专家最终校核确认。")
		if m, _ := audit["ai_model"].(string); strings.TrimSpace(m) != "" {
			addPara("AI 模型：" + strings.TrimSpace(m))
		}
		for _, row := range aiRows {
			addPara(fmt.Sprintf("%v（%v）", row["name"], row["nm"]))
			// 先给 SQL 审核结果，再给 AI 复核结论，两者并列供人类专家对照
			if e, _ := row["error"].(string); strings.TrimSpace(e) != "" {
				addPara(fmt.Sprintf("SQL 审核结果：执行错误 —— %s", e))
			} else {
				passedText := "不通过"
				if b, _ := row["passed"].(bool); b {
					passedText = "通过"
				}
				addPara(fmt.Sprintf("SQL 审核结果：%s（违规行数 %v）", passedText, row["violation_count"]))
			}
			mis := "否"
			if b, _ := row["ai_misjudged"].(bool); b {
				mis = "是（疑似规则过严导致的误判）"
			}
			conf := ""
			if c, ok := row["ai_confidence"]; ok && c != nil {
				if f, ok2 := c.(float64); ok2 {
					conf = fmt.Sprintf("   置信度：%.2f", f)
				}
			}
			addPara("AI 复核结论：是否误判 —— " + mis + conf)
			if r, _ := row["ai_reason"].(string); strings.TrimSpace(r) != "" {
				addPara("理由：" + r)
			}
			if sg, _ := row["ai_suggestion"].(string); strings.TrimSpace(sg) != "" {
				addPara("建议：" + sg)
			}
			addPara("※ 本条须由人类专家最终校核。")
		}
	}

	addPara("")
	nextSection("项填报率")
	itemFillRates := ifaceSlice(audit["item_fill_rates"])
	recordFillRates := ifaceSlice(audit["record_fill_rates"])
	fillSkipped, _ := audit["fill_skipped"].(bool)
	fillNote := ""
	if fillSkipped {
		fillNote = "本次未执行填报率审核"
	} else if len(itemFillRates) == 0 && len(recordFillRates) == 0 {
		fillNote = "未配置填报率"
	}
	if fillNote != "" {
		addPara(fillNote)
	} else {
		for _, x := range itemFillRates {
			m, _ := x.(map[string]interface{})
			if m == nil {
				continue
			}
			addPara(qaFillDocxLine(m, true))
		}
	}
	addPara("")
	nextSection("记录填报率")
	if fillNote != "" {
		addPara(fillNote)
	} else {
		for _, x := range recordFillRates {
			m, _ := x.(map[string]interface{})
			if m == nil {
				continue
			}
			// 记录填报率按表统计整行，不涉及具体字段，报告里不再输出字段项
			addPara(qaFillDocxLine(m, false))
		}
	}

	if strings.TrimSpace(styles.PageFooter) != "" {
		addPara("")
		addPara(styles.PageFooter)
	}

	sb.WriteString(`</w:body></w:document>`)
	docXML := sb.String()

	buf := new(bytes.Buffer)
	z := zip.NewWriter(buf)
	now := time.Now().UTC().Format(time.RFC3339)

	wDoc, _ := z.Create("word/document.xml")
	_, _ = io.WriteString(wDoc, docXML)

	ct := `[Content_Types].xml`
	wct, _ := z.Create(ct)
	_, _ = io.WriteString(wct, `<?xml version="1.0" encoding="UTF-8"?>`+
		`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`+
		`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`+
		`<Default Extension="xml" ContentType="application/xml"/>`+
		`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`+
		`<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`+
		`</Types>`)

	wr, _ := z.Create("_rels/.rels")
	_, _ = io.WriteString(wr, `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`+
		`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`+
		`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`+
		`</Relationships>`)

	wwr, _ := z.Create("word/_rels/document.xml.rels")
	_, _ = io.WriteString(wwr, `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`)

	coreTitle := styles.DocTitle
	if strings.TrimSpace(coreTitle) == "" {
		coreTitle = "数据质量审核报告"
	}
	wc, _ := z.Create("docProps/core.xml")
	_, _ = fmt.Fprintf(wc, `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties">`+
		`<dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">%s</dc:title><dcterms:created xmlns:dcterms="http://purl.org/dc/terms/">%s</dcterms:created></cp:coreProperties>`, xmlEscapeQA(coreTitle), xmlEscapeQA(now))

	_ = z.Close()
	return buf.Bytes(), nil
}

func ifaceSlice(v interface{}) []interface{} {
	if v == nil {
		return nil
	}
	if a, ok := v.([]interface{}); ok {
		return a
	}
	return nil
}

func xmlEscapeQA(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	return s
}

func loadReportTemplateByID(id string) (*qaReportTemplateRow, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, nil
	}
	db, err := openQualityAuditDB()
	if err != nil {
		return nil, err
	}
	var out qaReportTemplateRow
	var isDef int
	err = db.QueryRow(`SELECT id, name, template_type, content, is_default, created_at, updated_at FROM report_templates WHERE id=?`, id).
		Scan(&out.ID, &out.Name, &out.TemplateType, &out.Content, &isDef, &out.CreatedAt, &out.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	out.IsDefault = isDef != 0
	return &out, nil
}

func loadDefaultReportTemplate() (*qaReportTemplateRow, error) {
	db, err := openQualityAuditDB()
	if err != nil {
		return nil, err
	}
	var out qaReportTemplateRow
	var isDef int
	err = db.QueryRow(`SELECT id, name, template_type, content, is_default, created_at, updated_at FROM report_templates WHERE is_default=1 ORDER BY updated_at DESC LIMIT 1`).
		Scan(&out.ID, &out.Name, &out.TemplateType, &out.Content, &isDef, &out.CreatedAt, &out.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	out.IsDefault = isDef != 0
	return &out, nil
}

func qaTemplatesGET(w http.ResponseWriter, username string) {
	_ = username
	db, err := openQualityAuditDB()
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	rows, err := db.Query(`SELECT id, name, template_type, content, is_default, created_at, updated_at FROM report_templates ORDER BY is_default DESC, updated_at DESC`)
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	defer rows.Close()
	var list []qaReportTemplateRow
	for rows.Next() {
		var r qaReportTemplateRow
		var isDef int
		if err := rows.Scan(&r.ID, &r.Name, &r.TemplateType, &r.Content, &isDef, &r.CreatedAt, &r.UpdatedAt); err != nil {
			apiInternalError(w, err.Error())
			return
		}
		r.IsDefault = isDef != 0
		list = append(list, r)
	}
	qaRespondSuccess(w, map[string]interface{}{"templates": list})
}

func qaTemplatesPOST(w http.ResponseWriter, r *http.Request, username string) {
	_ = username
	var body struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		TemplateType string `json:"template_type"`
		Content      string `json:"content"`
		IsDefault    *bool  `json:"is_default"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apiBadRequest(w, "JSON 解析失败")
		return
	}
	id := strings.TrimSpace(body.ID)
	if id == "" {
		apiBadRequest(w, "id 不能为空")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		apiBadRequest(w, "name 不能为空")
		return
	}
	ttyp := strings.TrimSpace(body.TemplateType)
	if ttyp == "" {
		ttyp = "html"
	}
	content := strings.TrimSpace(body.Content)
	if content == "" {
		content = defaultQATemplateContentJSON()
	}
	now := time.Now().Format(time.RFC3339)
	db, err := openQualityAuditDB()
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	var createdAt string
	_ = db.QueryRow(`SELECT created_at FROM report_templates WHERE id=?`, id).Scan(&createdAt)
	if strings.TrimSpace(createdAt) == "" {
		createdAt = now
	}
	isDef := 0
	if body.IsDefault != nil && *body.IsDefault {
		isDef = 1
	}
	tx, err := db.Begin()
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	if isDef == 1 {
		if _, err := tx.Exec(`UPDATE report_templates SET is_default=0`); err != nil {
			_ = tx.Rollback()
			apiInternalError(w, err.Error())
			return
		}
	}
	_, err = tx.Exec(`INSERT INTO report_templates (id, name, template_type, content, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET name=excluded.name, template_type=excluded.template_type, content=excluded.content, is_default=excluded.is_default, updated_at=excluded.updated_at`,
		id, name, ttyp, content, isDef, createdAt, now)
	if err != nil {
		_ = tx.Rollback()
		apiInternalError(w, err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		apiInternalError(w, err.Error())
		return
	}
	qaRespondSuccess(w, nil)
}

func qaTemplatesDELETE(w http.ResponseWriter, id string, username string) {
	_ = username
	id = strings.TrimSpace(id)
	if id == "" {
		apiBadRequest(w, "id 无效")
		return
	}
	db, err := openQualityAuditDB()
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	if _, err := db.Exec(`DELETE FROM report_templates WHERE id=?`, id); err != nil {
		apiInternalError(w, err.Error())
		return
	}
	qaRespondSuccess(w, nil)
}

func qaPreviewPOST(w http.ResponseWriter, r *http.Request, username string) {
	_ = username
	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apiBadRequest(w, "JSON 解析失败")
		return
	}
	audit, _ := body["audit"].(map[string]interface{})
	if audit == nil {
		audit = body
	}
	var styles *qaTemplateStyles
	if c, ok := body["content"]; ok && c != nil {
		switch v := c.(type) {
		case string:
			if strings.TrimSpace(v) != "" {
				styles = parseQATemplateContent(v)
			}
		default:
			b, err := json.Marshal(v)
			if err == nil && len(b) > 0 {
				styles = parseQATemplateContent(string(b))
			}
		}
	}
	if styles == nil {
		if tid, _ := body["template_id"].(string); strings.TrimSpace(tid) != "" {
			if row, err := loadReportTemplateByID(strings.TrimSpace(tid)); err == nil && row != nil {
				styles = parseQATemplateContent(row.Content)
			}
		}
	}
	if styles == nil {
		styles = parseQATemplateContent("{}")
	}
	htmlDoc := buildQualityAuditHTML(audit, styles)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(htmlDoc))
}

func buildQualityAuditHTML(audit map[string]interface{}, styles *qaTemplateStyles) string {
	if styles == nil {
		styles = parseQATemplateContent("{}")
	}
	title := styles.DocTitle
	if strings.TrimSpace(title) == "" {
		title = "数据质量审核报告"
	}
	tFont := html.EscapeString(styles.Title.FontFamily)
	tSize := html.EscapeString(styles.Title.FontSize)
	tCol := html.EscapeString(styles.Title.Color)
	sFont := html.EscapeString(styles.Section.FontFamily)
	sSize := html.EscapeString(styles.Section.FontSize)
	sCol := html.EscapeString(styles.Section.Color)
	tbBorder := html.EscapeString(styles.Table.Border)
	tbHead := html.EscapeString(styles.Table.HeaderBg)
	tbAlt := html.EscapeString(styles.Table.RowAlt)
	var b strings.Builder
	b.WriteString("<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>")
	b.WriteString(html.EscapeString(title))
	b.WriteString(`</title><style>
body{font-family:system-ui,sans-serif;margin:24px;color:#1a202c;}
.qa-ph{margin-bottom:12px;color:#64748b;font-size:13px;}
.qa-doc-title{font-family:` + tFont + `;font-size:` + tSize + `;color:` + tCol + `;margin:0 0 8px;}
.qa-time{color:#64748b;font-size:14px;margin-bottom:20px;}
.qa-sec{font-family:` + sFont + `;font-size:` + sSize + `;color:` + sCol + `;margin:20px 0 10px;}
table.qa-tbl{border-collapse:collapse;width:100%;font-size:13px;}
table.qa-tbl th,table.qa-tbl td{border:` + tbBorder + `;padding:8px;text-align:left;}
table.qa-tbl thead th{background:` + tbHead + `;}
table.qa-tbl tbody tr:nth-child(even){background:` + tbAlt + `;}
.qa-rule{margin:10px 0;padding-left:12px;border-left:3px solid #e2e8f0;}
.qa-empty{color:#64748b;font-size:13px;padding:4px 0;}
.qa-mono{white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px;background:#f8fafc;padding:8px;border-radius:4px;}
</style></head><body>`)
	if strings.TrimSpace(styles.PageHeader) != "" {
		b.WriteString(`<div class="qa-ph">`)
		b.WriteString(html.EscapeString(styles.PageHeader))
		b.WriteString(`</div>`)
	}
	b.WriteString(`<h1 class="qa-doc-title">`)
	b.WriteString(html.EscapeString(title))
	b.WriteString(`</h1><div class="qa-time">生成时间：`)
	b.WriteString(html.EscapeString(time.Now().Format("2006-01-02 15:04:05")))
	b.WriteString(`</div>`)
	if summary, ok := audit["summary"].(map[string]interface{}); ok && summary != nil {
		b.WriteString(`<p>总规则数：`)
		b.WriteString(html.EscapeString(fmt.Sprint(summary["total_rules"])))
		b.WriteString(`　通过：`)
		b.WriteString(html.EscapeString(fmt.Sprint(summary["passed"])))
		b.WriteString(`　不通过：`)
		b.WriteString(html.EscapeString(fmt.Sprint(summary["failed"])))
		if n, ok := summary["ai_reviewed"]; ok && n != nil && fmt.Sprint(n) != "0" && fmt.Sprint(n) != "" {
			b.WriteString(`　AI 复核：`)
			b.WriteString(html.EscapeString(fmt.Sprint(n)))
			b.WriteString(` 条（须人类专家最终校核）`)
		}
		b.WriteString(`</p>`)
	}
	b.WriteString(`<h2 class="qa-sec">一、规则明细</h2>`)
	rules, _ := audit["rules"].([]interface{})
	for i, x := range rules {
		row, _ := x.(map[string]interface{})
		if row == nil {
			continue
		}
		b.WriteString(`<div class="qa-rule"><strong>`)
		b.WriteString(html.EscapeString(fmt.Sprintf("%d. %v（%v）", i+1, row["name"], row["nm"])))
		b.WriteString(`</strong>`)
		if s, ok := row["sql_executed"].(string); ok && s != "" {
			b.WriteString(`<div>执行 SQL：</div><div class="qa-mono">`)
			b.WriteString(html.EscapeString(s))
			b.WriteString(`</div>`)
		}
		b.WriteString(`<div>结果：违规数 `)
		b.WriteString(html.EscapeString(fmt.Sprint(row["violation_count"])))
		b.WriteString(`　通过：`)
		b.WriteString(html.EscapeString(fmt.Sprint(row["passed"])))
		b.WriteString(`</div>`)
		if e, ok := row["error"].(string); ok && e != "" {
			b.WriteString(`<div style="color:#c53030;">错误：` + html.EscapeString(e) + `</div>`)
		}
		if sr, ok := row["sample_rows"].([]interface{}); ok && len(sr) > 0 {
			jb, _ := json.MarshalIndent(sr, "", "  ")
			b.WriteString(`<div class="qa-mono">`)
			b.WriteString(html.EscapeString(string(jb)))
			b.WriteString(`</div>`)
		}
		b.WriteString(`</div>`)
	}
	itemFillRates := ifaceSlice(audit["item_fill_rates"])
	recordFillRates := ifaceSlice(audit["record_fill_rates"])
	fillSkipped, _ := audit["fill_skipped"].(bool)
	fillNote := ""
	if fillSkipped {
		fillNote = "本次未执行填报率审核"
	} else if len(itemFillRates) == 0 && len(recordFillRates) == 0 {
		fillNote = "未配置填报率"
	}
	b.WriteString(`<h2 class="qa-sec">二、项填报率</h2>`)
	if fillNote != "" {
		b.WriteString(`<div class="qa-empty">` + html.EscapeString(fillNote) + `</div>`)
	} else {
		b.WriteString(`<table class="qa-tbl"><thead><tr><th>表名</th><th>字段名</th><th>填报率</th></tr></thead><tbody>`)
		for _, x := range itemFillRates {
			m, _ := x.(map[string]interface{})
			if m == nil {
				continue
			}
			b.WriteString(`<tr><td>`)
			b.WriteString(html.EscapeString(qaFillCellText(m["table_name"])))
			b.WriteString(`</td><td>`)
			b.WriteString(html.EscapeString(qaFillCellText(m["field_name"])))
			b.WriteString(`</td><td>`)
			b.WriteString(html.EscapeString(qaFillRateText(m)))
			b.WriteString(`</td></tr>`)
		}
		b.WriteString(`</tbody></table>`)
	}
	b.WriteString(`<h2 class="qa-sec">三、记录填报率</h2>`)
	if fillNote != "" {
		b.WriteString(`<div class="qa-empty">` + html.EscapeString(fillNote) + `</div>`)
	} else {
		// 记录填报率按表统计整行，不涉及具体字段，表头不再输出「字段名」列
		b.WriteString(`<table class="qa-tbl"><thead><tr><th>表名</th><th>填报率</th></tr></thead><tbody>`)
		for _, x := range recordFillRates {
			m, _ := x.(map[string]interface{})
			if m == nil {
				continue
			}
			b.WriteString(`<tr><td>`)
			b.WriteString(html.EscapeString(qaFillCellText(m["table_name"])))
			b.WriteString(`</td><td>`)
			b.WriteString(html.EscapeString(qaFillRateText(m)))
			b.WriteString(`</td></tr>`)
		}
		b.WriteString(`</tbody></table>`)
	}
	// AI 复核段：只有真正跑过 AI 复核的规则才出现（纯 SQL 审核的报告保持不变）
	aiRows := make([]map[string]interface{}, 0)
	for _, x := range rules {
		row, _ := x.(map[string]interface{})
		if row == nil {
			continue
		}
		if _, ok := row["ai_reason"]; !ok {
			if _, ok2 := row["ai_misjudged"]; !ok2 {
				continue
			}
		}
		aiRows = append(aiRows, row)
	}
	if len(aiRows) > 0 {
		b.WriteString(`<h2 class="qa-sec">四、AI 复核（仅供参考，须人类专家最终校核）</h2>`)
		b.WriteString(`<div class="qa-empty">AI 结论仅作参考，不构成最终判定，须由人类专家最终校核确认。</div>`)
		for _, row := range aiRows {
			b.WriteString(`<div class="qa-rule"><strong>`)
			b.WriteString(html.EscapeString(fmt.Sprintf("%v（%v）", row["name"], row["nm"])))
			b.WriteString(`</strong><div>SQL 审核结果：违规数 `)
			b.WriteString(html.EscapeString(fmt.Sprint(row["violation_count"])))
			b.WriteString(`　通过：`)
			b.WriteString(html.EscapeString(fmt.Sprint(row["passed"])))
			b.WriteString(`</div><div>AI 复核结论：是否误判 ——  `)
			b.WriteString(html.EscapeString(fmt.Sprint(row["ai_misjudged"])))
			b.WriteString(`</div><div>理由：`)
			b.WriteString(html.EscapeString(fmt.Sprint(row["ai_reason"])))
			b.WriteString(`</div><div>建议：`)
			b.WriteString(html.EscapeString(fmt.Sprint(row["ai_suggestion"])))
			b.WriteString(`</div><div>※ 本条须由人类专家最终校核。</div></div>`)
		}
	}
	if strings.TrimSpace(styles.PageFooter) != "" {
		b.WriteString(`<div class="qa-ph" style="margin-top:32px;">`)
		b.WriteString(html.EscapeString(styles.PageFooter))
		b.WriteString(`</div>`)
	}
	b.WriteString(`</body></html>`)
	return b.String()
}

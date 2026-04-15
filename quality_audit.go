package main

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
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
)

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
  UPDATED_AT TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS item_fill_rate (
  TABLE_NAME TEXT PRIMARY KEY,
  NUMERATOR TEXT NOT NULL,
  DENOMINATOR TEXT NOT NULL,
  UPDATED_AT TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS record_fill_rate (
  TABLE_NAME TEXT PRIMARY KEY,
  NUMERATOR TEXT NOT NULL,
  DENOMINATOR TEXT NOT NULL,
  UPDATED_AT TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rules_xh ON rules(XH);
`); err != nil {
			_ = db.Close()
			qualityAuditErr = err
			return
		}
		qualityAuditDB = db
	})
	if qualityAuditErr != nil {
		return nil, qualityAuditErr
	}
	return qualityAuditDB, nil
}

func initQualityAuditDB() {
	if _, err := openQualityAuditDB(); err != nil {
		log.Printf("数据质量审核库初始化失败: %v", err)
	}
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
	NM        string `json:"nm"`
	XH        string `json:"xh"`
	Name      string `json:"name"`
	SQL       string `json:"sql"`
	Category  string `json:"category"`
	UpdatedAt string `json:"updated_at"`
}

type qaRuleTree struct {
	qaRule
	Children []*qaRuleTree `json:"children,omitempty"`
}

func (n *qaRuleTree) MarshalJSON() ([]byte, error) {
	m := map[string]interface{}{
		"nm": n.NM, "xh": n.XH, "name": n.Name, "sql": n.SQL, "category": n.Category, "updated_at": n.UpdatedAt,
	}
	if len(n.Children) > 0 {
		m["children"] = n.Children
	}
	return json.Marshal(m)
}

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
	rows, err := db.Query(`SELECT NM, XH, NAME, COALESCE(SQL,''), CATEGORY, UPDATED_AT FROM rules ORDER BY XH`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []qaRule
	for rows.Next() {
		var r qaRule
		if err := rows.Scan(&r.NM, &r.XH, &r.Name, &r.SQL, &r.Category, &r.UpdatedAt); err != nil {
			return nil, err
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

func handleQualityAuditAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}

	prefix := "/api/data-ontology/quality-audit"
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
	case path == "report" && r.Method == http.MethodPost:
		qaReport(w, r, username)
	default:
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "接口不存在"})
	}
}

func qaRulesGET(w http.ResponseWriter, username string) {
	_, _ = username
	list, err := loadRulesFlat()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	tree := buildRuleTree(list)
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "tree": tree, "flat": list})
}

func qaRulesPOST(w http.ResponseWriter, r *http.Request, username string) {
	_, _ = username
	var body struct {
		NM       string `json:"nm"`
		XH       string `json:"xh"`
		Name     string `json:"name"`
		SQL      string `json:"sql"`
		Category string `json:"category"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "JSON 解析失败"})
		return
	}
	body.NM = padNM(body.NM)
	if body.NM == "" || strings.TrimSpace(body.XH) == "" || strings.TrimSpace(body.Name) == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "nm、xh、name 不能为空"})
		return
	}
	now := time.Now().Format(time.RFC3339)
	db, err := openQualityAuditDB()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	_, err = db.Exec(`INSERT INTO rules (NM, XH, NAME, SQL, CATEGORY, UPDATED_AT) VALUES (?,?,?,?,?,?)
    ON CONFLICT(NM) DO UPDATE SET XH=excluded.XH, NAME=excluded.NAME, SQL=excluded.SQL, CATEGORY=excluded.CATEGORY, UPDATED_AT=excluded.UPDATED_AT`,
		body.NM, strings.TrimSpace(body.XH), strings.TrimSpace(body.Name), body.SQL, strings.TrimSpace(body.Category), now)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func qaRulesDELETE(w http.ResponseWriter, nm string, username string) {
	_, _ = username
	nm = padNM(nm)
	if nm == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "nm 无效"})
		return
	}
	db, err := openQualityAuditDB()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	_, err = db.Exec(`DELETE FROM rules WHERE NM=?`, nm)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func qaRulesImport(w http.ResponseWriter, r *http.Request, username string) {
	_, _ = username
	var body struct {
		Rules []struct {
			NM       string `json:"nm"`
			XH       string `json:"xh"`
			Name     string `json:"name"`
			SQL      string `json:"sql"`
			Category string `json:"category"`
		} `json:"rules"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Rules) == 0 {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请提供 rules 数组"})
		return
	}
	db, err := openQualityAuditDB()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	tx, err := db.Begin()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	now := time.Now().Format(time.RFC3339)
	n := 0
	for _, row := range body.Rules {
		nm := padNM(row.NM)
		if nm == "" || strings.TrimSpace(row.XH) == "" || strings.TrimSpace(row.Name) == "" {
			continue
		}
		_, err = tx.Exec(`INSERT INTO rules (NM, XH, NAME, SQL, CATEGORY, UPDATED_AT) VALUES (?,?,?,?,?,?)
ON CONFLICT(NM) DO UPDATE SET XH=excluded.XH, NAME=excluded.NAME, SQL=excluded.SQL, CATEGORY=excluded.CATEGORY, UPDATED_AT=excluded.UPDATED_AT`,
			nm, strings.TrimSpace(row.XH), strings.TrimSpace(row.Name), row.SQL, strings.TrimSpace(row.Category), now)
		if err != nil {
			_ = tx.Rollback()
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
			return
		}
		n++
	}
	if err := tx.Commit(); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "imported": n})
}

type fillRow struct {
	TableName   string `json:"table_name"`
	Numerator   string `json:"numerator"`
	Denominator string `json:"denominator"`
	UpdatedAt   string `json:"updated_at"`
}

func qaFillRates(w http.ResponseWriter, r *http.Request, username string) {
	_, _ = username
	db, err := openQualityAuditDB()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	if r.Method == http.MethodGet {
		item, _ := scanFillTable(db, `SELECT TABLE_NAME, NUMERATOR, DENOMINATOR, UPDATED_AT FROM item_fill_rate ORDER BY TABLE_NAME`)
		rec, _ := scanFillTable(db, `SELECT TABLE_NAME, NUMERATOR, DENOMINATOR, UPDATED_AT FROM record_fill_rate ORDER BY TABLE_NAME`)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":             true,
			"item_fill_rate":      item,
			"record_fill_rate":    rec,
		})
		return
	}
	var body struct {
		ItemFill   []fillRow `json:"item_fill_rate"`
		RecordFill []fillRow `json:"record_fill_rate"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "JSON 解析失败"})
		return
	}
	tx, err := db.Begin()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	_, _ = tx.Exec(`DELETE FROM item_fill_rate`)
	_, _ = tx.Exec(`DELETE FROM record_fill_rate`)
	now := time.Now().Format(time.RFC3339)
	for _, row := range body.ItemFill {
		if strings.TrimSpace(row.TableName) == "" {
			continue
		}
		_, err = tx.Exec(`INSERT INTO item_fill_rate (TABLE_NAME, NUMERATOR, DENOMINATOR, UPDATED_AT) VALUES (?,?,?,?)`,
			strings.TrimSpace(row.TableName), row.Numerator, row.Denominator, now)
		if err != nil {
			_ = tx.Rollback()
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
			return
		}
	}
	for _, row := range body.RecordFill {
		if strings.TrimSpace(row.TableName) == "" {
			continue
		}
		_, err = tx.Exec(`INSERT INTO record_fill_rate (TABLE_NAME, NUMERATOR, DENOMINATOR, UPDATED_AT) VALUES (?,?,?,?)`,
			strings.TrimSpace(row.TableName), row.Numerator, row.Denominator, now)
		if err != nil {
			_ = tx.Rollback()
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
			return
		}
	}
	if err := tx.Commit(); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
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
		if err := rows.Scan(&r.TableName, &r.Numerator, &r.Denominator, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func qaExecute(w http.ResponseWriter, r *http.Request, username string) {
	var req struct {
		DatabaseID string   `json:"database_id"`
		RuleNMs    []string `json:"rule_nms"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "JSON 解析失败"})
		return
	}
	if req.DatabaseID == "" || len(req.RuleNMs) == 0 {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "database_id 与 rule_nms 必填"})
		return
	}
	dataOntologyMu.RLock()
	dbConfig, ok := dataOntologyDatabases[req.DatabaseID]
	dataOntologyMu.RUnlock()
	if !ok || !dataOntologyResourceVisible(dbConfig.Owner, username) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "数据库不存在或无权访问"})
		return
	}
	switch dbConfig.Type {
	case "mysql", "mariadb", "tidb", "postgresql", "timescaledb", "cockroachdb", "sqlserver", "oracle", "dm", "sqlite":
	default:
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "该数据库类型不支持 SQL 审核"})
		return
	}
	dialect := normalizeQualityDialect(dbConfig.Type)

	driver, dsn, dsnErr := buildDSN(dbConfig)
	if dsnErr != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": dsnErr.Error()})
		return
	}
	targetDB, err := sql.Open(driver, dsn)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "连接失败: " + err.Error()})
		return
	}
	defer targetDB.Close()

	flat, err := loadRulesFlat()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	byNM := map[string]qaRule{}
	for _, x := range flat {
		byNM[x.NM] = x
	}

	t0 := time.Now()
	var ruleResults []map[string]interface{}
	passed, failed := 0, 0

	for _, nm := range req.RuleNMs {
		nm = padNM(nm)
		rule, exists := byNM[nm]
		if !exists {
			continue
		}
		orig := strings.TrimSpace(rule.SQL)
		if orig == "" {
			ruleResults = append(ruleResults, map[string]interface{}{
				"nm": rule.NM, "xh": rule.XH, "name": rule.Name, "skipped": true, "message": "分类节点无 SQL",
			})
			continue
		}
		execSQL := convertOracleSQLForDialect(orig, dialect)
		cnt, sample, errExec := executeRuleQuery(targetDB, execSQL)
		entry := map[string]interface{}{
			"nm":              rule.NM,
			"xh":              rule.XH,
			"name":            rule.Name,
			"category":        rule.Category,
			"sql_original":    orig,
			"sql_executed":    execSQL,
			"violation_count": cnt,
			"sample_rows":     sample,
		}
		if errExec != nil {
			entry["error"] = errExec.Error()
			entry["passed"] = false
			failed++
		} else {
			passedRule := cnt == 0
			entry["passed"] = passedRule
			if passedRule {
				passed++
			} else {
				failed++
			}
		}
		ruleResults = append(ruleResults, entry)
	}

	metaDB, _ := openQualityAuditDB()
	itemRows, _ := scanFillTable(metaDB, `SELECT TABLE_NAME, NUMERATOR, DENOMINATOR, UPDATED_AT FROM item_fill_rate`)
	recRows, _ := scanFillTable(metaDB, `SELECT TABLE_NAME, NUMERATOR, DENOMINATOR, UPDATED_AT FROM record_fill_rate`)

	itemStats := runFillStats(targetDB, dialect, itemRows)
	recStats := runFillStats(targetDB, dialect, recRows)

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":           true,
		"database_id":       req.DatabaseID,
		"database_type":     dbConfig.Type,
		"dialect":           dialect,
		"started_at":        t0.Format(time.RFC3339),
		"finished_at":       time.Now().Format(time.RFC3339),
		"rules":             ruleResults,
		"item_fill_rates":   itemStats,
		"record_fill_rates": recStats,
		"summary": map[string]interface{}{
			"total_rules": passed + failed,
			"passed":      passed,
			"failed":      failed,
		},
	})
}

func runFillStats(db *sql.DB, dialect string, rows []fillRow) []map[string]interface{} {
	var out []map[string]interface{}
	for _, row := range rows {
		numSQL := convertOracleSQLForDialect(strings.TrimSpace(row.Numerator), dialect)
		denSQL := convertOracleSQLForDialect(strings.TrimSpace(row.Denominator), dialect)
		n, e1 := execScalarFloat(db, numSQL)
		d, e2 := execScalarFloat(db, denSQL)
		m := map[string]interface{}{
			"table_name":  row.TableName,
			"numerator":   n,
			"denominator": d,
		}
		if e1 != nil {
			m["numerator_error"] = e1.Error()
		}
		if e2 != nil {
			m["denominator_error"] = e2.Error()
		}
		if e1 == nil && e2 == nil && d != 0 {
			m["rate_percent"] = (n / d) * 100
		}
		out = append(out, m)
	}
	return out
}

func execScalarFloat(db *sql.DB, sqlStr string) (float64, error) {
	row := db.QueryRow(sqlStr)
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
	default:
		return 0, fmt.Errorf("无法转为数字: %v", v)
	}
}

func executeRuleQuery(db *sql.DB, sqlStr string) (int, []map[string]interface{}, error) {
	rows, err := db.Query(sqlStr)
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
		if len(sample) < 5 {
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
	_, _ = username
	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "JSON 解析失败"})
		return
	}
	audit, _ := body["audit"].(map[string]interface{})
	if audit == nil {
		audit = body
	}
	doc, err := buildQualityAuditDocx(audit)
	if err != nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	w.Header().Set("Content-Disposition", `attachment; filename="quality-audit-report.docx"`)
	_, _ = io.Copy(w, bytes.NewReader(doc))
}

func buildQualityAuditDocx(audit map[string]interface{}) ([]byte, error) {
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	sb.WriteString(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`)
	sb.WriteString(`<w:body>`)

	addPara := func(text string) {
		sb.WriteString(`<w:p><w:r><w:rPr/><w:t xml:space="preserve">`)
		sb.WriteString(xmlEscapeQA(text))
		sb.WriteString(`</w:t></w:r></w:p>`)
	}

	addPara("数据质量审核报告")
	addPara("生成时间：" + time.Now().Format("2006-01-02 15:04:05"))

	summary, _ := audit["summary"].(map[string]interface{})
	if summary != nil {
		addPara(fmt.Sprintf("总规则数：%v   通过：%v   不通过：%v", summary["total_rules"], summary["passed"], summary["failed"]))
	}

	addPara("")
	addPara("一、规则明细")
	rules, _ := audit["rules"].([]interface{})
	for i, x := range rules {
		row, _ := x.(map[string]interface{})
		if row == nil {
			continue
		}
		addPara(fmt.Sprintf("%d. %v（%v）", i+1, row["name"], row["nm"]))
		if s, ok := row["sql_executed"].(string); ok && s != "" {
			addPara("执行 SQL：" + s)
		}
		addPara(fmt.Sprintf("结果：违规数 %v   通过：%v", row["violation_count"], row["passed"]))
		if e, ok := row["error"].(string); ok && e != "" {
			addPara("错误：" + e)
		}
		if sr, ok := row["sample_rows"].([]interface{}); ok && len(sr) > 0 {
			b, _ := json.Marshal(sr)
			addPara("违规示例（最多5行）：" + string(b))
		}
	}

	addPara("")
	addPara("二、项填报率")
	for _, x := range ifaceSlice(audit["item_fill_rates"]) {
		m, _ := x.(map[string]interface{})
		if m == nil {
			continue
		}
		addPara(fmt.Sprintf("表 %v：填报率 %v%%（分子 %v / 分母 %v）", m["table_name"], m["rate_percent"], m["numerator"], m["denominator"]))
	}
	addPara("")
	addPara("三、记录填报率")
	for _, x := range ifaceSlice(audit["record_fill_rates"]) {
		m, _ := x.(map[string]interface{})
		if m == nil {
			continue
		}
		addPara(fmt.Sprintf("表 %v：填报率 %v%%（分子 %v / 分母 %v）", m["table_name"], m["rate_percent"], m["numerator"], m["denominator"]))
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

	wc, _ := z.Create("docProps/core.xml")
	_, _ = fmt.Fprintf(wc, `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties">`+
		`<dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">数据质量审核报告</dc:title><dcterms:created xmlns:dcterms="http://purl.org/dc/terms/">%s</dcterms:created></cp:coreProperties>`, xmlEscapeQA(now))

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

package main

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// 需求：规则级「AI 复核原则」+ 定时任务「启用 AI 校核」总开关
//
//	① 老库（无 ai_review_prompt 列）自动补列
//	② 只有「未通过 + 自带复核原则」的规则才交给 AI 复核
//	③ 总开关关闭时不挑模型、不产生任何调用
// ---------------------------------------------------------------------------

func TestQAMigrateRuleAIReviewPromptColumn(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "rules.db"))
	if err != nil {
		t.Fatalf("打开测试库失败: %v", err)
	}
	defer db.Close()
	// 老库：没有 ai_review_prompt 列
	if _, err := db.Exec(`CREATE TABLE rules (
		NM TEXT PRIMARY KEY, XH TEXT NOT NULL, NAME TEXT NOT NULL,
		SQL TEXT, CATEGORY TEXT, PARAMS TEXT DEFAULT '', UPDATED_AT TEXT NOT NULL);`); err != nil {
		t.Fatalf("建表失败: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO rules (NM, XH, NAME, SQL, CATEGORY, PARAMS, UPDATED_AT) VALUES ('010100','0101','老规则','SELECT 1','','','2026-01-01T00:00:00+08:00')`); err != nil {
		t.Fatalf("插入失败: %v", err)
	}

	migrateQualityAuditRuleAiReview(db)

	if !qaTableHasColumn(db, "rules", "ai_review_prompt") {
		t.Fatal("ai_review_prompt 列未补上")
	}
	// 老数据补列后默认空串 → 不做 AI 复核，行为不倒退
	var v string
	if err := db.QueryRow(`SELECT COALESCE(ai_review_prompt,'') FROM rules WHERE NM='010100'`).Scan(&v); err != nil {
		t.Fatalf("读取失败: %v", err)
	}
	if strings.TrimSpace(v) != "" {
		t.Errorf("老规则补列后应为空，实际 %q", v)
	}
	// 幂等：重复执行不报错
	migrateQualityAuditRuleAiReview(db)
}

func TestQAMigrateScheduleAIEnabledColumn(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "sched.db"))
	if err != nil {
		t.Fatalf("打开测试库失败: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE qa_schedules (
		id TEXT PRIMARY KEY, name TEXT, database_id TEXT, cron_expr TEXT,
		enabled INTEGER, rule_nms TEXT, ai_check_nms TEXT, ai_prompt TEXT,
		report_template_id TEXT, fill_enabled INTEGER DEFAULT 1,
		last_run_at TEXT, last_run_status TEXT, next_run_at TEXT,
		created_by TEXT, created_at TEXT, updated_at TEXT);`); err != nil {
		t.Fatalf("建表失败: %v", err)
	}
	// 老任务：勾过 AI 校核项、但库里没有新列
	if _, err := db.Exec(`INSERT INTO qa_schedules (id,name,cron_expr,enabled,rule_nms,ai_check_nms,ai_prompt) VALUES ('s1','老任务','0 8 * * *',1,'["010100"]','["010100"]','老原则')`); err != nil {
		t.Fatalf("插入失败: %v", err)
	}

	migrateQualityAuditScheduleAiEnabled(db)

	if !qaTableHasColumn(db, "qa_schedules", "ai_check_enabled") {
		t.Fatal("ai_check_enabled 列未补上")
	}
	var got sql.NullInt64
	if err := db.QueryRow(`SELECT ai_check_enabled FROM qa_schedules WHERE id='s1'`).Scan(&got); err != nil {
		t.Fatalf("读取失败: %v", err)
	}
	// 默认 1（开启）：真正是否调用 AI 由规则自带原则决定
	if !got.Valid || got.Int64 != 1 {
		t.Errorf("老任务补列后应默认开启(1)，实际 %+v", got)
	}
	migrateQualityAuditScheduleAiEnabled(db)
}

func TestQAAIReviewTargetsSelection(t *testing.T) {
	rules := []map[string]interface{}{
		{"nm": "010100", "name": "填了原则且没过", "passed": false, "ai_review_prompt": "允许为空则属误判"},
		{"nm": "010200", "name": "填了原则但通过", "passed": true, "ai_review_prompt": "允许为空则属误判"},
		{"nm": "010300", "name": "没填原则且没过", "passed": false, "ai_review_prompt": ""},
		{"nm": "010400", "name": "没填原则且通过", "passed": true, "ai_review_prompt": "   "},
		{"nm": "010500", "name": "没带该字段", "passed": false},
	}
	got := qaAIReviewTargets(rules)
	if len(got) != 1 {
		names := make([]string, 0, len(got))
		for _, r := range got {
			names = append(names, r["name"].(string))
		}
		t.Fatalf("应只命中 1 条（未通过 + 填了原则），实际 %d 条：%v", len(got), names)
	}
	if got[0]["nm"] != "010100" {
		t.Errorf("命中规则错误：%v", got[0]["nm"])
	}

	// 全部通过 / 都没原则 → 无目标
	if n := len(qaAIReviewTargets([]map[string]interface{}{
		{"nm": "020100", "passed": true, "ai_review_prompt": "x"},
		{"nm": "020200", "passed": false, "ai_review_prompt": ""},
	})); n != 0 {
		t.Errorf("不应有复核目标，实际 %d", n)
	}
}

func TestQAAIVerifySkippedWhenDisabled(t *testing.T) {
	rules := []map[string]interface{}{
		{"nm": "010100", "name": "填了原则且没过", "passed": false, "ai_review_prompt": "允许为空则属误判"},
	}
	out, model, reason := qaAIVerifyWithProgress(rules, false, nil)
	if len(out) != 0 {
		t.Errorf("关闭总开关时不应产生复核结论，实际 %v", out)
	}
	if model != "" {
		t.Errorf("关闭总开关时不应挑模型，实际 %q", model)
	}
	if reason == "" || !strings.Contains(reason, "未启用") {
		t.Errorf("关闭时应给出跳过原因，实际 %q", reason)
	}

	// 开启但无目标规则 → 明确说明原因，同样不挑模型
	rules[0]["passed"] = true
	out2, model2, reason2 := qaAIVerifyWithProgress(rules, true, nil)
	if len(out2) != 0 || model2 != "" {
		t.Errorf("无目标时不应有结论/模型：%v %q", out2, model2)
	}
	if !strings.Contains(reason2, "复核原则") {
		t.Errorf("无目标时应提示规则未填写复核原则，实际 %q", reason2)
	}
}

func TestQABuildAIVerifyPromptUsesPerRulePrinciple(t *testing.T) {
	row := map[string]interface{}{
		"nm": "010100", "name": "手机号格式", "category": "规范性",
		"sql_original": "SELECT * FROM {{表名}}", "sql_executed": "SELECT * FROM T_USER",
		"violation_count": 3,
	}
	prompt := qaBuildAIVerifyPrompt(row, "若该字段业务上允许为空，则判定为规则过严")
	if !strings.Contains(prompt, "复核原则（必须按此原则判断）") {
		t.Error("提示词应带「按此原则判断」说明")
	}
	if !strings.Contains(prompt, "若该字段业务上允许为空，则判定为规则过严") {
		t.Error("提示词应包含规则级复核原则原文")
	}
	if strings.Contains(prompt, "用户自定义校核原则") {
		t.Error("不应再使用旧的任务级「用户自定义校核原则」文案")
	}
}

func TestQACountAIFlagged(t *testing.T) {
	rows := []map[string]interface{}{
		{"nm": "1", "ai_misjudged": true},
		{"nm": "2", "ai_misjudged": false},
		{"nm": "3"},
	}
	if n := qaCountAIFlagged(rows); n != 1 {
		t.Errorf("疑似误判统计应为 1，实际 %d", n)
	}
}

// 缓存只能存纯 SQL 审核结果：否则关掉 AI 开关后，缓存命中还会显示上一轮的 AI 结论。
func TestQAStripAIRowsRemovesStaleAI(t *testing.T) {
	rows := []map[string]interface{}{
		{"nm": "010100", "name": "规则甲", "passed": false, "violation_count": 1,
			"ai_misjudged": true, "ai_confidence": 0.9, "ai_reason": "旧结论", "ai_suggestion": "旧建议", "ai_need_human": true},
	}
	clean := qaStripAIRows(rows)
	if len(clean) != 1 {
		t.Fatalf("条数不对：%d", len(clean))
	}
	for _, k := range []string{"ai_misjudged", "ai_confidence", "ai_reason", "ai_suggestion", "ai_need_human"} {
		if _, ok := clean[0][k]; ok {
			t.Errorf("缓存副本不应包含 %s", k)
		}
	}
	// 纯 SQL 字段必须原样保留
	if clean[0]["nm"] != "010100" || clean[0]["violation_count"] != 1 {
		t.Errorf("纯 SQL 结果被破坏：%v", clean[0])
	}
	// 不得改动原行（响应里仍要用 AI 结论）
	if _, ok := rows[0]["ai_reason"]; !ok {
		t.Error("剥副本不应影响原行")
	}
	// 剥完再跑一次：关闭开关时不应产生任何 AI 字段
	out, model, reason := qaAIVerifyWithProgress(clean, false, nil)
	if len(out) != 0 || model != "" || reason == "" {
		t.Errorf("关闭开关应零调用：out=%v model=%q reason=%q", out, model, reason)
	}
}

// 规则树：同一 XH 的多条规则不能互相覆盖（历史实现按 XH 建节点，会丢规则）。
func TestQABuildRuleTreeKeepsDuplicateXH(t *testing.T) {
	list := []qaRule{
		{NM: "010000", XH: "01", Name: "分组"},
		{NM: "010100", XH: "0101", Name: "子规则甲"},
		{NM: "010200", XH: "0102", Name: "子规则乙"},
		{NM: "990001", XH: "99", Name: "同 XH 甲", SQL: "SELECT 1"},
		{NM: "990002", XH: "99", Name: "同 XH 乙", SQL: "SELECT 1"},
	}
	tree := buildRuleTree(list)
	seen := map[string]int{}
	var walk func(ns []*qaRuleTree)
	walk = func(ns []*qaRuleTree) {
		for _, n := range ns {
			seen[n.NM]++
			walk(n.Children)
		}
	}
	walk(tree)
	for _, nm := range []string{"010000", "010100", "010200", "990001", "990002"} {
		if seen[nm] != 1 {
			t.Errorf("规则 %s 在树中应恰好出现 1 次，实际 %d 次", nm, seen[nm])
		}
	}
	// 正常层级关系不能被改坏
	if seen["010100"] == 0 || len(tree) == 0 {
		t.Fatal("规则树为空")
	}
	var group *qaRuleTree
	for _, n := range tree {
		if n.NM == "010000" {
			group = n
		}
	}
	if group == nil || len(group.Children) != 2 {
		t.Errorf("分组 010000 应有 2 个子节点，实际 %v", group)
	}
}

// 规则树的 JSON 必须带上 ai_review_prompt：否则前端「AI 复核」标识永远不显示。
func TestQARuleTreeJSONCarriesAIReviewPrompt(t *testing.T) {
	tree := buildRuleTree([]qaRule{
		{NM: "010100", XH: "0101", Name: "有原则", SQL: "SELECT 1", AIReviewPrompt: "允许为空则属误判"},
		{NM: "010200", XH: "0102", Name: "无原则", SQL: "SELECT 1"},
	})
	b, err := json.Marshal(tree)
	if err != nil {
		t.Fatalf("序列化失败: %v", err)
	}
	if !strings.Contains(string(b), `"ai_review_prompt":"允许为空则属误判"`) {
		t.Errorf("规则树 JSON 缺少 ai_review_prompt：%s", string(b))
	}
	if strings.Count(string(b), "ai_review_prompt") != 1 {
		t.Errorf("未填写原则的规则不应输出该字段：%s", string(b))
	}
}

// 缓存 key 必须随规则内容变化：否则改了规则 SQL 后，TTL 内重新审核仍命中旧结果。
func TestQACacheKeyChangesWithRuleContent(t *testing.T) {
	base := qaRule{NM: "010100", Name: "非空检查", SQL: "SELECT 1 FROM DUAL", Params: map[string]string{"表名": "T"}, UpdatedAt: "2026-09-19T10:00:00+08:00"}
	k1 := qaCacheKey("db1", []qaRule{base})

	// 1) 改 SQL → key 必须变
	changedSQL := base
	changedSQL.SQL = "SELECT 1 FROM DUAL WHERE 1=2"
	if k2 := qaCacheKey("db1", []qaRule{changedSQL}); k2 == k1 {
		t.Error("改了 SQL 后缓存 key 未变化")
	}
	// 2) 改参数 → key 必须变
	changedParams := base
	changedParams.Params = map[string]string{"表名": "T2"}
	if k := qaCacheKey("db1", []qaRule{changedParams}); k == k1 {
		t.Error("改了参数后缓存 key 未变化")
	}
	// 3) 参数顺序不影响 key
	reordered := base
	reordered.Params = map[string]string{"字段名": "C", "表名": "T"}
	k3 := qaCacheKey("db1", []qaRule{reordered})
	if k3 == k1 {
		t.Error("参数集合变了，key 应该变")
	}
	sameSet := base
	sameSet.Params = map[string]string{"表名": "T"}
	if k := qaCacheKey("db1", []qaRule{sameSet}); k != k1 {
		t.Error("规则内容未变时 key 不应变化（会导致缓存形同失效）")
	}
	// 4) 内容完全不变 → key 稳定（缓存仍可用）
	if k := qaCacheKey("db1", []qaRule{base}); k != k1 {
		t.Error("规则未变但 key 不稳定")
	}
	// 5) 换库或换规则集合 → key 必须变
	if qaCacheKey("db2", []qaRule{base}) == k1 {
		t.Error("换库后 key 未变化")
	}
	mix := []qaRule{base, {NM: "010200", Name: "唯一性", SQL: "SELECT 1"}}
	if qaCacheKey("db1", mix) == k1 {
		t.Error("规则集合变化后 key 未变化")
	}
}

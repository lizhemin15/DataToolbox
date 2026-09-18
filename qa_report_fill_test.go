package main

import (
	"strings"
	"testing"
)

// 项填报率要真的把字段名渲染出来（历史上 runFillStats 没塞 field_name，报告里全是 <nil>）；
// 记录填报率按整表统计，报告里不应再出现「字段」字样。
func TestQABuildReportDocxFillRatesFieldRules(t *testing.T) {
	audit := map[string]interface{}{
		"summary": map[string]interface{}{"total_rules": 0, "passed": 0, "failed": 0},
		"item_fill_rates": []interface{}{
			map[string]interface{}{"table_name": "T_USER", "field_name": "PHONE", "rate_percent": 96.12},
			map[string]interface{}{"table_name": "T_ORDER", "field_name": "AMOUNT", "rate_percent": 88.5},
		},
		"record_fill_rates": []interface{}{
			map[string]interface{}{"table_name": "T_DETAIL", "field_name": "不该出现", "rate_percent": 72.33},
		},
	}
	doc, err := qaBuildReportDocx(audit, "")
	if err != nil {
		t.Fatalf("生成报告失败: %v", err)
	}
	txt := docxText(t, doc)

	if strings.Contains(txt, "<nil>") {
		t.Errorf("报告里出现 <nil>：%s", txt)
	}
	if !strings.Contains(txt, "表 T_USER 字段 PHONE：填报率 96.12%") {
		t.Errorf("项填报率字段名没渲染出来：%s", txt)
	}
	if !strings.Contains(txt, "表 T_ORDER 字段 AMOUNT：填报率 88.50%") {
		t.Errorf("项填报率字段名没渲染出来：%s", txt)
	}

	idx := strings.Index(txt, "三、记录填报率")
	if idx < 0 {
		t.Fatalf("报告缺少「三、记录填报率」：%s", txt)
	}
	rec := txt[idx:]
	if strings.Contains(rec, "字段") {
		t.Errorf("记录填报率不应出现字段项：%s", rec)
	}
	if !strings.Contains(rec, "表 T_DETAIL：填报率 72.33%") {
		t.Errorf("记录填报率文案不对：%s", rec)
	}
}

// 表不存在时报告直接写「没有这个表」，不再输出 nil/原始 SQL 报错。
func TestQABuildReportDocxFillRatesMissingTable(t *testing.T) {
	audit := map[string]interface{}{
		"summary": map[string]interface{}{"total_rules": 0, "passed": 0, "failed": 0},
		"item_fill_rates": []interface{}{
			map[string]interface{}{"table_name": "T_GONE", "field_name": "F1", "no_such_table": true},
		},
		"record_fill_rates": []interface{}{
			map[string]interface{}{"table_name": "T_GONE_TOO", "no_such_table": true},
		},
	}
	doc, err := qaBuildReportDocx(audit, "")
	if err != nil {
		t.Fatalf("生成报告失败: %v", err)
	}
	txt := docxText(t, doc)
	for _, want := range []string{"表 T_GONE：没有这个表", "表 T_GONE_TOO：没有这个表"} {
		if !strings.Contains(txt, want) {
			t.Errorf("报告缺少 %q：%s", want, txt)
		}
	}
}

// HTML 报告：记录填报率表头只有 表名/填报率 两列；缺表时单元格写「没有这个表」。
func TestQABuildReportHTMLRecordFillRatesNoFieldColumn(t *testing.T) {
	audit := map[string]interface{}{
		"summary": map[string]interface{}{"total_rules": 0, "passed": 0, "failed": 0},
		"item_fill_rates": []interface{}{
			map[string]interface{}{"table_name": "T_USER", "field_name": "PHONE", "rate_percent": 96.12},
		},
		"record_fill_rates": []interface{}{
			map[string]interface{}{"table_name": "T_DETAIL", "field_name": "不该出现", "rate_percent": 72.33},
			map[string]interface{}{"table_name": "T_MISSING", "no_such_table": true},
		},
	}
	html := buildQualityAuditHTML(audit, parseQATemplateContent("{}"))

	recIdx := strings.Index(html, "三、记录填报率")
	if recIdx < 0 {
		t.Fatalf("HTML 报告缺少「三、记录填报率」")
	}
	rec := html[recIdx:]
	if strings.Contains(rec, "字段名") {
		t.Errorf("记录填报率表头不应有字段名列：%s", rec)
	}
	if strings.Contains(rec, "不该出现") {
		t.Errorf("记录填报率不应渲染字段名：%s", rec)
	}
	if !strings.Contains(rec, "没有这个表") {
		t.Errorf("表不存在时 HTML 报告应写「没有这个表」：%s", rec)
	}
	if strings.Contains(html, "<nil>") {
		t.Errorf("HTML 报告出现 <nil>")
	}
	if !strings.Contains(html, "PHONE") {
		t.Errorf("项填报率字段名没渲染出来")
	}
}

// 定时任务关掉「填报率审核」时（fill_skipped），报告里明确写「本次未执行填报率审核」，
// 不能因为空数组就渲染出空表头，让人误以为数据是 0。
func TestQABuildReportFillSkippedNote(t *testing.T) {
	audit := map[string]interface{}{
		"summary":           map[string]interface{}{"total_rules": 0, "passed": 0, "failed": 0},
		"item_fill_rates":   []interface{}{},
		"record_fill_rates": []interface{}{},
		"fill_skipped":      true,
	}
	doc, err := qaBuildReportDocx(audit, "")
	if err != nil {
		t.Fatalf("生成报告失败: %v", err)
	}
	txt := docxText(t, doc)
	if c := strings.Count(txt, "本次未执行填报率审核"); c != 2 {
		t.Errorf("docx 报告应在项/记录填报率两处都写「本次未执行填报率审核」，实际 %d 次：%s", c, txt)
	}
	if strings.Contains(txt, "未配置填报率") {
		t.Errorf("fill_skipped 时不应再写「未配置填报率」：%s", txt)
	}

	html := buildQualityAuditHTML(audit, parseQATemplateContent("{}"))
	if c := strings.Count(html, "本次未执行填报率审核"); c != 2 {
		t.Errorf("HTML 报告应在项/记录填报率两处都写「本次未执行填报率审核」，实际 %d 次", c)
	}
}

// 完全没有配置填报率（且本次执行了填报率审核）时，报告要显式写「未配置填报率」。
func TestQABuildReportNoFillConfigNote(t *testing.T) {
	audit := map[string]interface{}{
		"summary":           map[string]interface{}{"total_rules": 0, "passed": 0, "failed": 0},
		"item_fill_rates":   []interface{}{},
		"record_fill_rates": []interface{}{},
		"fill_skipped":      false,
	}
	doc, err := qaBuildReportDocx(audit, "")
	if err != nil {
		t.Fatalf("生成报告失败: %v", err)
	}
	txt := docxText(t, doc)
	if c := strings.Count(txt, "未配置填报率"); c != 2 {
		t.Errorf("docx 报告应在项/记录填报率两处都写「未配置填报率」，实际 %d 次：%s", c, txt)
	}

	html := buildQualityAuditHTML(audit, parseQATemplateContent("{}"))
	if c := strings.Count(html, "未配置填报率"); c != 2 {
		t.Errorf("HTML 报告应在项/记录填报率两处都写「未配置填报率」，实际 %d 次", c)
	}
	// 从「二、项填报率」到下一个标题之间不应再渲染空的填报率表格
	start := strings.Index(html, "二、项填报率")
	if start < 0 {
		t.Fatalf("HTML 报告缺少填报率小节：%s", html)
	}
	sec := html[start:]
	if next := strings.Index(sec[len("二、项填报率"):], "<h2"); next >= 0 {
		sec = sec[:len("二、项填报率")+next]
	}
	if strings.Contains(sec, "<table") {
		t.Errorf("没有填报率时不应渲染空表格：%s", sec)
	}
}

// 各库「表不存在」报错都要能认出来。
func TestQAFillMissingTableError(t *testing.T) {
	yes := []string{
		"Error 1146 (42S02): Table 'db.t' doesn't exist",
		`ERROR: relation "t" does not exist (SQLSTATE 42P01)`,
		"no such table: t",
		"Invalid object name 't'.",
		"ORA-00942: table or view does not exist",
		"无效的表或视图名",
	}
	for _, s := range yes {
		if !qaFillMissingTableError(errString(s)) {
			t.Errorf("应识别为表不存在：%s", s)
		}
	}
	no := []string{
		"syntax error at or near \"from\"",
		"division by zero",
		"context deadline exceeded",
		"column \"amount\" does not exist",
		"no such column: AMOUNT",
		"Unknown column 'AMOUNT' in 'field list'",
	}
	for _, s := range no {
		if qaFillMissingTableError(errString(s)) {
			t.Errorf("不应识别为表不存在：%s", s)
		}
	}
	if qaFillMissingTableError(nil) {
		t.Error("nil 错误不应识别为表不存在")
	}
}

type errString string

func (e errString) Error() string { return string(e) }

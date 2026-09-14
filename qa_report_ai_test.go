package main

import (
	"archive/zip"
	"bytes"
	"io"
	"regexp"
	"strings"
	"testing"
)

// docxText 抽取 docx 纯文本用于断言。
func docxText(t *testing.T, b []byte) string {
	t.Helper()
	z, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatalf("docx 不是合法 zip: %v", err)
	}
	for _, f := range z.File {
		if f.Name != "word/document.xml" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("打开 document.xml 失败: %v", err)
		}
		defer rc.Close()
		raw, _ := io.ReadAll(rc)
		txt := regexp.MustCompile(`<[^>]+>`).ReplaceAllString(string(raw), "")
		return strings.ReplaceAll(txt, "&amp;", "&")
	}
	t.Fatal("docx 缺少 word/document.xml")
	return ""
}

// 带 AI 结果的规则行 → 报告必须含「AI 校核」段、模型名、结论、理由与建议。
func TestQABuildReportDocxIncludesAISection(t *testing.T) {
	audit := map[string]interface{}{
		"ai_model": "Qwen/Qwen3-30B-A3B-Instruct-2507",
		"summary":  map[string]interface{}{"total_rules": 1, "passed": 0, "failed": 1},
		"rules": []interface{}{
			map[string]interface{}{
				"nm": "010100", "name": "主键非空检查", "passed": false,
				"violation_count": 0,
				"error":           "Error -2007",
				"ai_misjudged":    true,
				"ai_confidence":   0.95,
				"ai_reason":       "规则 SQL 表名/字段名为空，无法执行",
				"ai_suggestion":   "补全表名与字段名",
			},
		},
	}
	doc, err := qaBuildReportDocx(audit, "")
	if err != nil {
		t.Fatalf("生成报告失败: %v", err)
	}
	txt := docxText(t, doc)
	for _, want := range []string{"AI 校核（误判判定）", "Qwen/Qwen3-30B-A3B-Instruct-2507", "是否误判：是", "0.95", "规则 SQL 表名/字段名为空", "补全表名与字段名"} {
		if !strings.Contains(txt, want) {
			t.Errorf("报告缺少 %q\n实际文本：%s", want, txt)
		}
	}
	// 段落编号仍连续
	if !strings.Contains(txt, "一、规则明细") {
		t.Errorf("报告缺少「一、规则明细」: %s", txt)
	}
}

// 无 AI 结果时不应出现 AI 段，且后续段落编号不应错位。
func TestQABuildReportDocxOmitsAISectionWhenAbsent(t *testing.T) {
	audit := map[string]interface{}{
		"summary": map[string]interface{}{"total_rules": 1, "passed": 1, "failed": 0},
		"rules": []interface{}{
			map[string]interface{}{"nm": "010100", "name": "主键非空检查", "passed": true, "violation_count": 0},
		},
		"item_fill_rates": []interface{}{map[string]interface{}{"table_name": "T1", "field_name": "F1", "rate_percent": 90}},
	}
	doc, err := qaBuildReportDocx(audit, "")
	if err != nil {
		t.Fatalf("生成报告失败: %v", err)
	}
	txt := docxText(t, doc)
	if strings.Contains(txt, "AI 校核") {
		t.Errorf("无 AI 结果时不应输出 AI 段：%s", txt)
	}
	if !strings.Contains(txt, "二、项填报率") {
		t.Errorf("段落编号错位，期望「二、项填报率」：%s", txt)
	}
	if !strings.Contains(txt, "三、记录填报率") {
		t.Errorf("段落编号错位，期望「三、记录填报率」：%s", txt)
	}
}

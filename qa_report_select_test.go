package main

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"
)

/* ===========================================================================
 * 报告模板「可视化编辑 + 选择性生成」回归防线
 *
 * 两个不变量是这块功能的核心，别让它们被改回去：
 *   ① 预览 = 导出：同一份模板，HTML 预览与 Word 导出的章节集合、顺序、呈现方式必须一致
 *      （历史 bug：预览是表格、导出是文字行，章节顺序也不同）
 *   ② 选择性生成真的生效：不出的章节不出现、没选的规则不上报告、概览统计跟着所选规则重算
 *      （否则会出现「概览说 3 条、明细只列 1 条」的自相矛盾）
 * =========================================================================== */

func qaTestAudit() map[string]interface{} {
	return map[string]interface{}{
		"summary":  map[string]interface{}{"total_rules": 3, "passed": 1, "failed": 2, "ai_reviewed": 1},
		"ai_model": "demo-model",
		"rules": []interface{}{
			map[string]interface{}{"nm": "0000000001", "name": "主键非空", "passed": true, "violation_count": 0},
			map[string]interface{}{
				"nm": "0000000002", "name": "手机号格式", "passed": false, "violation_count": 2,
				"sql_executed": "select * from t_user where phone not like '1%'",
				"sample_rows": []interface{}{
					map[string]interface{}{"ID": 1, "PHONE": "abc"},
					map[string]interface{}{"ID": 2, "PHONE": "def"},
				},
				"ai_reason": "测试数据里的手机号为测试值", "ai_misjudged": true,
				"ai_confidence": 0.9, "ai_suggestion": "测试期加白名单",
			},
			map[string]interface{}{"nm": "0000000003", "name": "金额非负", "passed": false, "violation_count": 1, "error": "表 T_ORDER 不存在"},
		},
		"item_fill_rates": []interface{}{
			map[string]interface{}{"table_name": "T_USER", "field_name": "PHONE", "rate_percent": 96.12},
			map[string]interface{}{"table_name": "T_ORDER", "field_name": "AMOUNT", "rate_percent": 88.5},
			map[string]interface{}{"table_name": "T_GONE", "field_name": "X", "no_such_table": true},
		},
		"record_fill_rates": []interface{}{
			map[string]interface{}{"table_name": "T_DETAIL", "rate_percent": 72.33},
		},
	}
}

// qaTestTemplate 造一份「显式声明章节」的模板（等价于可视化编辑器保存后的形态）。
func qaTestTemplate(numberMode string, mut func([]qaTemplateSection) []qaTemplateSection) string {
	secs := materializeQASections(nil)
	if mut != nil {
		secs = mut(secs)
	}
	doc := qaTemplateContentDoc{
		DocTitle:      "数据质量审核报告",
		Title:         qaTemplateTextSt{FontFamily: "FZXiaoBiaoSong, serif", FontSize: "22pt", Color: "#000000"},
		Section:       qaTemplateTextSt{FontFamily: "SimHei, sans-serif", FontSize: "16pt", Color: "#222222"},
		Table:         qaTemplateTableSt{Border: "1px solid #000000", HeaderBg: "#f0f0f0", RowAlt: "#fafafa"},
		PageHeader:    "某某单位数据质量审核",
		PageFooter:    "第 1 页",
		SectionNumber: numberMode,
		Sections:      secs,
	}
	b, _ := json.Marshal(doc)
	return string(b)
}

func qaTestSetSection(secs []qaTemplateSection, key string, fn func(*qaTemplateSection)) {
	for i := range secs {
		if secs[i].Key == key {
			fn(&secs[i])
			return
		}
	}
}

var qaTagRe = regexp.MustCompile(`<[^>]+>`)
var qaStyleRe = regexp.MustCompile(`(?s)<style.*?</style>`)

func qaStripHTML(s string) string {
	s = qaStyleRe.ReplaceAllString(s, "")
	return qaTagRe.ReplaceAllString(s, "")
}

// qaRenderBoth 用同一模板渲染 docx 与 html（纯文本形态，便于比对）。
func qaRenderBoth(t *testing.T, content string, audit map[string]interface{}, sel *qaSelection) (string, string) {
	t.Helper()
	st := parseQATemplateContent(content)
	doc, err := qaRenderDocxBlocks(qaBuildReportBlocks(audit, st, sel, "docx"), st)
	if err != nil {
		t.Fatalf("生成 docx 失败: %v", err)
	}
	h := qaRenderHTMLBlocks(qaBuildReportBlocks(audit, st, sel, "html"), st, false, 0)
	return docxText(t, doc), qaStripHTML(h)
}

func qaCheckOrder(t *testing.T, label, text string, items []string) {
	t.Helper()
	last := -1
	for _, it := range items {
		i := strings.Index(text, it)
		if i < 0 {
			t.Fatalf("%s 里缺少「%s」", label, it)
		}
		if i < last {
			t.Fatalf("%s 里「%s」顺序不对（出现在前一项之前）", label, it)
		}
		last = i
	}
}

/* ── ① 章节：顺序 / 启停 / 改名 / 编号 ─────────────────────────────────── */

func TestQAReportSectionOrderAndDisable(t *testing.T) {
	// 把「记录填报率」挪到「项填报率」前面，并关掉「项填报率」
	content := qaTestTemplate("cn", func(secs []qaTemplateSection) []qaTemplateSection {
		out := make([]qaTemplateSection, 0, len(secs))
		for _, s := range secs {
			if s.Key == qaSecItemFill {
				s.Enabled = false
			}
			out = append(out, s)
		}
		// 记录填报率插到规则明细之后（显式重建切片，别用 append 覆盖底层数组）
		moved := make([]qaTemplateSection, 0, len(out))
		for _, s := range out {
			moved = append(moved, s)
			if s.Key == qaSecRules {
				for _, r := range out {
					if r.Key == qaSecRecordFill {
						moved = append(moved, r)
					}
				}
			}
		}
		final := make([]qaTemplateSection, 0, len(moved))
		for _, s := range moved {
			if s.Key == qaSecRecordFill && len(final) > 2 {
				continue // 已提前插入
			}
			final = append(final, s)
		}
		return final
	})
	doc, htm := qaRenderBoth(t, content, qaTestAudit(), nil)
	for _, txt := range []struct{ name, s string }{{"docx", doc}, {"html", htm}} {
		if strings.Contains(txt.s, "项填报率") {
			t.Fatalf("%s：已关闭的「项填报率」仍出现在报告里", txt.name)
		}
		// 编号按实际输出的章节重新排：记录填报率被挪到第二位
		qaCheckOrder(t, txt.name, txt.s, []string{"一、规则明细", "二、记录填报率", "三、AI 复核"})
	}
}

// TestQAReportSectionDragOrder 可视化编辑器拖拽排序后的顺序必须被渲染层尊重。
// 两个真实入口都要走一遍：
//   - 导出走「保存原样」的 content（qaBuildReportDocxSel 直接 parseQATemplateContent）
//   - 预览会先 qaNormalizeTemplateContent 再渲染（qaPreviewPOST 第 2671 行）
//
// 曾出过 bug：materializeQASections 强制回到标准顺序，拖拽只改了编辑器，
// 预览（经规范化）悄悄变回标准序，导出又是另一个顺序 —— 预览与导出不一致。
func TestQAReportSectionDragOrder(t *testing.T) {
	// 把「记录填报率」拖到最前面（排在「规则明细」之前）
	dragged := qaTestTemplate("cn", func(secs []qaTemplateSection) []qaTemplateSection {
		var drag, rest []qaTemplateSection
		for _, s := range secs {
			if s.Key == qaSecRecordFill {
				drag = append(drag, s)
				continue
			}
			rest = append(rest, s)
		}
		return append(drag, rest...)
	})
	// 夹具自检：拖拽后的 content 里首段确实是记录填报率（否则这个测试本身就是假绿）
	if order := parseQATemplateContent(dragged).Sections; order[0].Key != qaSecRecordFill {
		t.Fatalf("夹具没有改序，测试自身失效：首段=%s", order[0].Key)
	}
	cases := []struct{ name, content string }{
		{"导出路径(保存原样)", dragged},
		{"预览路径(规范化后)", qaNormalizeTemplateContent(dragged)},
	}
	for _, c := range cases {
		doc, htm := qaRenderBoth(t, c.content, qaTestAudit(), nil)
		for _, txt := range []struct{ name, s string }{{"docx", doc}, {"html", htm}} {
			qaCheckOrder(t, c.name+"/"+txt.name, txt.s, []string{"一、记录填报率", "二、规则明细", "三、项填报率"})
		}
	}
}

func TestQAReportSectionRenameAndNumberMode(t *testing.T) {
	content := qaTestTemplate("none", func(secs []qaTemplateSection) []qaTemplateSection {
		qaTestSetSection(secs, qaSecRules, func(s *qaTemplateSection) { s.Title = "审核明细" })
		return secs
	})
	doc, htm := qaRenderBoth(t, content, qaTestAudit(), nil)
	for _, txt := range []struct{ name, s string }{{"docx", doc}, {"html", htm}} {
		if !strings.Contains(txt.s, "审核明细") {
			t.Fatalf("%s：自定义章节标题「审核明细」没生效", txt.name)
		}
		if strings.Contains(txt.s, "规则明细") {
			t.Fatalf("%s：改名后仍出现旧标题「规则明细」", txt.name)
		}
		if strings.Contains(txt.s, "一、审核明细") {
			t.Fatalf("%s：编号方式设为 none，不该再出现「一、」前缀", txt.name)
		}
	}
}

/* ── ② 预览 = 导出（核心不变量）────────────────────────────────────────── */

func TestQAReportPreviewMatchesDocx(t *testing.T) {
	for _, mode := range []string{"line", "table"} {
		content := qaTestTemplate("cn", func(secs []qaTemplateSection) []qaTemplateSection {
			for _, k := range []string{qaSecItemFill, qaSecRecordFill} {
				qaTestSetSection(secs, k, func(s *qaTemplateSection) { s.Opts.Layout = mode })
			}
			return secs
		})
		doc, htm := qaRenderBoth(t, content, qaTestAudit(), nil)

		// (a) 章节集合与顺序一致
		titles := []string{"一、规则明细", "二、项填报率", "三、记录填报率", "四、AI 复核"}
		qaCheckOrder(t, "docx", doc, titles)
		qaCheckOrder(t, "html", htm, titles)

		// (b) 填报率呈现方式一致：要么两边都是表格，要么两边都是文字行
		lineSentinel := "表 T_ORDER 字段 AMOUNT：填报率 88.50%"
		tableSentinel := "表名"
		hasLine := func(s string) bool { return strings.Contains(s, lineSentinel) }
		hasTable := func(s string) bool { return strings.Contains(s, tableSentinel) }
		if hasLine(doc) != hasLine(htm) || hasTable(doc) != hasTable(htm) {
			t.Fatalf("layout=%s 时预览与导出的填报率呈现方式不一致：docx(line=%v table=%v) html(line=%v table=%v)",
				mode, hasLine(doc), hasTable(doc), hasLine(htm), hasTable(htm))
		}
		if mode == "table" && (!hasTable(doc) || !hasTable(htm)) {
			t.Fatalf("layout=table 时应当两边都出现表头「表名」")
		}
		if mode == "line" && (!hasLine(doc) || !hasLine(htm)) {
			t.Fatalf("layout=line 时应当两边都是文字行")
		}

		// (c) 页眉页脚两边都在
		for _, s := range []string{"某某单位数据质量审核", "第 1 页"} {
			if !strings.Contains(doc, s) || !strings.Contains(htm, s) {
				t.Fatalf("页眉页脚「%s」没有同时出现在预览与导出里", s)
			}
		}
	}
}

// 老模板（content 只有样式、没声明章节）必须保持既有行为：
// 导出=文字行、预览=表格。这是 qa_report_fill_test.go 钉住的旧契约，不许被"顺手统一"掉。
func TestQALegacyTemplateKeepsPerRendererDefault(t *testing.T) {
	legacy := qaTemplateContentJSON(parseQATemplateContent("{}")) // 无 sections
	st := parseQATemplateContent(legacy)
	if len(st.Sections) != 0 {
		t.Fatalf("老模板不应凭空多出 sections")
	}
	doc, err := qaRenderDocxBlocks(qaBuildReportBlocks(qaTestAudit(), st, nil, "docx"), st)
	if err != nil {
		t.Fatalf("docx 渲染失败: %v", err)
	}
	docTxt := docxText(t, doc)
	htmTxt := qaStripHTML(qaRenderHTMLBlocks(qaBuildReportBlocks(qaTestAudit(), st, nil, "html"), st, false, 0))
	if !strings.Contains(docTxt, "表 T_USER 字段 PHONE：填报率 96.12%") {
		t.Fatalf("老模板的 docx 应仍用文字行呈现填报率")
	}
	if !strings.Contains(htmTxt, "表名") {
		t.Fatalf("老模板的 html 预览应仍用表格呈现填报率")
	}
}

/* ── ③ 选择性生成 ──────────────────────────────────────────────────────── */

func TestQAReportSelectionSectionsAndRules(t *testing.T) {
	content := qaTestTemplate("cn", nil)
	// 前端生成弹窗默认全选章节，这里模拟「只勾概览 + 规则明细」+「只选一条规则」
	sel := &qaSelection{Sections: []string{qaSecOverview, qaSecRules}, RuleNMs: []string{"0000000002"}}
	doc, htm := qaRenderBoth(t, content, qaTestAudit(), sel)
	for _, txt := range []struct{ name, s string }{{"docx", doc}, {"html", htm}} {
		if strings.Contains(txt.s, "项填报率") || strings.Contains(txt.s, "记录填报率") {
			t.Fatalf("%s：只选了规则明细，却还输出了填报率章节", txt.name)
		}
		if !strings.Contains(txt.s, "手机号格式") {
			t.Fatalf("%s：选中的规则没有出现在报告里", txt.name)
		}
		if strings.Contains(txt.s, "主键非空") || strings.Contains(txt.s, "金额非负") {
			t.Fatalf("%s：没选中的规则出现在了报告里", txt.name)
		}
		// 概览统计必须跟着所选规则重算，不能还是全量 3 条
		if !strings.Contains(txt.s, "总规则数：1") {
			t.Fatalf("%s：概览统计没有按所选规则重算（应显示总规则数：1）", txt.name)
		}
		// AI 复核段：所选规则带 AI 结果 → 仍然保留
		if !strings.Contains(txt.s, "AI 复核") {
			t.Fatalf("%s：所选规则带 AI 结论，AI 复核段不该消失", txt.name)
		}
	}
}

/* ── ④ 每段选项 ────────────────────────────────────────────────────────── */

func TestQAReportSectionOpts(t *testing.T) {
	// 规则明细：只列不通过 + 每条最多 1 行违规数据 + 附 SQL
	content := qaTestTemplate("cn", func(secs []qaTemplateSection) []qaTemplateSection {
		qaTestSetSection(secs, qaSecRules, func(s *qaTemplateSection) {
			s.Opts.OnlyFailed = true
			s.Opts.MaxRows = 1
			s.Opts.ShowSQL = true
		})
		qaTestSetSection(secs, qaSecAIReview, func(s *qaTemplateSection) { s.Opts.OnlyMisjudged = true })
		qaTestSetSection(secs, qaSecItemFill, func(s *qaTemplateSection) { s.Opts.OnlyBelow = 90 })
		return secs
	})
	doc, htm := qaRenderBoth(t, content, qaTestAudit(), nil)
	for _, txt := range []struct{ name, s string }{{"docx", doc}, {"html", htm}} {
		if strings.Contains(txt.s, "主键非空") {
			t.Fatalf("%s：only_failed 打开了，通过的规则不该出现", txt.name)
		}
		if !strings.Contains(txt.s, "（此处仅展示前 1 条，共 2 条）") {
			t.Fatalf("%s：max_rows=1 的截断提示没出现", txt.name)
		}
		if strings.Contains(txt.s, "PHONEabc") && strings.Contains(txt.s, "PHONEdef") {
			t.Fatalf("%s：max_rows=1 却渲染了多行违规数据", txt.name)
		}
		if !strings.Contains(txt.s, "执行 SQL：") {
			t.Fatalf("%s：show_sql 打开了却没输出 SQL", txt.name)
		}
		// item_fill：only_below=90 → 96.12 被过滤，88.5 与"表不存在"保留
		if strings.Contains(txt.s, "T_USER") {
			t.Fatalf("%s：only_below=90 时高于阈值的 T_USER 不该出现", txt.name)
		}
		if !strings.Contains(txt.s, "T_ORDER") {
			t.Fatalf("%s：低于阈值的 T_ORDER 应当出现", txt.name)
		}
		if !strings.Contains(txt.s, "T_GONE") {
			t.Fatalf("%s：表不存在的异常项属于问题项，不该被阈值过滤掉", txt.name)
		}
	}
}

func TestQAReportAIReviewOptionalSection(t *testing.T) {
	content := qaTestTemplate("cn", nil)
	// (a) 有 AI 结果 → 出现
	doc, _ := qaRenderBoth(t, content, qaTestAudit(), nil)
	if !strings.Contains(doc, "AI 复核（仅供参考，须人类专家最终校核）") {
		t.Fatalf("有 AI 结果时 AI 复核章节应当出现")
	}
	// (b) 无 AI 结果 → 整段（含标题）不出现，且不占章节编号
	audit := qaTestAudit()
	audit["summary"] = map[string]interface{}{"total_rules": 3, "passed": 1, "failed": 2}
	rules := audit["rules"].([]interface{})
	for _, x := range rules {
		row := x.(map[string]interface{})
		delete(row, "ai_reason")
		delete(row, "ai_misjudged")
		delete(row, "ai_confidence")
		delete(row, "ai_suggestion")
	}
	doc2, htm2 := qaRenderBoth(t, content, audit, nil)
	for _, txt := range []struct{ name, s string }{{"docx", doc2}, {"html", htm2}} {
		if strings.Contains(txt.s, "AI 复核") {
			t.Fatalf("%s：没有 AI 数据时 AI 复核段不该出现", txt.name)
		}
		if strings.Contains(txt.s, "四、") {
			t.Fatalf("%s：AI 段没出现，就不该占用「四、」这个编号", txt.name)
		}
	}
}

/* ── ⑤ 模板规范化 ──────────────────────────────────────────────────────── */

func TestQATemplateNormalize(t *testing.T) {
	// 老模板（只有样式）→ 补全为显式章节 + 显式选项，样式不许丢
	legacy := `{"doc_title":"老报告","title":{"font_family":"A","font_size":"20pt","color":"#111111"},
		"section":{"font_family":"B","font_size":"14pt","color":"#222222"},
		"table":{"border":"1px solid #333","header_bg":"#eee","row_alt":"#fafafa"},
		"page_header":"页眉X","page_footer":"页脚Y"}`
	norm := qaNormalizeTemplateContent(legacy)
	st := parseQATemplateContent(norm)
	if st.DocTitle != "老报告" || st.Title.FontSize != "20pt" || st.Section.Color != "#222222" ||
		st.Table.Border != "1px solid #333" || st.PageHeader != "页眉X" || st.PageFooter != "页脚Y" {
		t.Fatalf("规范化把样式改坏了: %+v", st)
	}
	if st.SectionNumber != "cn" {
		t.Fatalf("缺省编号方式应为 cn，实际 %q", st.SectionNumber)
	}
	if len(st.Sections) != len(qaSectionOrder()) {
		t.Fatalf("规范化后应补齐全部章节，实际 %d 段", len(st.Sections))
	}
	for _, s := range st.Sections {
		if !s.Enabled {
			t.Fatalf("老模板补齐的章节应当默认启用：%s", s.Key)
		}
	}
	for _, s := range st.Sections {
		if s.Key == qaSecItemFill && s.Opts.Layout != "line" {
			t.Fatalf("补齐的填报率默认应与 Word 导出一致（line），实际 %q", s.Opts.Layout)
		}
	}
	// 幂等：再规范化一次结果不变
	if again := qaNormalizeTemplateContent(norm); again != norm {
		t.Fatalf("规范化不是幂等的：\n第一次=%s\n第二次=%s", norm, again)
	}

	// 未知章节键要被丢掉，缺失的补回标准顺序
	weird := `{"sections":[{"key":"rules","title":"我的规则","enabled":true},{"key":"不存在","title":"x","enabled":true}]}`
	st2 := parseQATemplateContent(qaNormalizeTemplateContent(weird))
	if len(st2.Sections) != len(qaSectionOrder()) {
		t.Fatalf("未知键应当被丢弃并补齐标准章节，实际 %d 段", len(st2.Sections))
	}
	// 已知章节保持调用方给出的顺序（拖拽排序的结果），未知键丢弃，缺失的按标准顺序补在后面
	if st2.Sections[0].Key != qaSecRules {
		t.Fatalf("规范化应保留模板里显式声明的章节顺序，首段应为 rules，实际 %q", st2.Sections[0].Key)
	}
	wantTail := []string{qaSecOverview, qaSecItemFill, qaSecRecordFill, qaSecAIReview}
	gotTail := make([]string, 0, len(wantTail))
	for _, s := range st2.Sections[1:] {
		gotTail = append(gotTail, s.Key)
	}
	if strings.Join(gotTail, ",") != strings.Join(wantTail, ",") {
		t.Fatalf("补齐的章节应按标准顺序跟在后面，实际 %v", gotTail)
	}
	kept := false
	for _, s := range st2.Sections {
		if s.Key == qaSecRules {
			kept = true
			if s.Title != "我的规则" {
				t.Fatalf("用户自定义标题被覆盖成 %q", s.Title)
			}
		}
	}
	if !kept {
		t.Fatalf("rules 章节被规范化弄丢了")
	}
}

// 选择性生成：章节选择遇到模板里已关闭的章节时，不能被"选回来"
func TestQAReportSelectionCannotResurrectDisabledSection(t *testing.T) {
	content := qaTestTemplate("cn", func(secs []qaTemplateSection) []qaTemplateSection {
		qaTestSetSection(secs, qaSecRecordFill, func(s *qaTemplateSection) { s.Enabled = false })
		return secs
	})
	sel := &qaSelection{Sections: []string{qaSecRules, qaSecRecordFill}}
	doc, htm := qaRenderBoth(t, content, qaTestAudit(), sel)
	for _, txt := range []struct{ name, s string }{{"docx", doc}, {"html", htm}} {
		if strings.Contains(txt.s, "记录填报率") {
			t.Fatalf("%s：模板里已关闭的章节被本次选择「复活」了", txt.name)
		}
	}
}

package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"sort"
	"strings"
	"time"
)

/* ===========================================================================
 * 数据质量审核报告：统一渲染层（章节 IR）
 * ---------------------------------------------------------------------------
 * 背景：导出（docx）与在线预览（html）此前是两套独立硬编码逻辑 —— 章节顺序不同
 * （docx：规则/AI/项/记录；html：规则/项/记录/AI）、填报率呈现方式不同（docx 文字行
 * /html 表格）、html 还多输出 SQL 与 JSON dump。结果就是「预览所见 ≠ 导出所得」，
 * 而报告模板又只能改字体颜色，改不了章节结构。
 *
 * 本文件把报告内容抽成一层与格式无关的中间表示（IR：[]qaBlock），docx 与 html 两个
 * 渲染器都只消费 IR：
 *
 *     qaBuildReportBlocks(audit, styles, sel, mode) → []qaBlock
 *            ├── qaRenderDocxBlocks(blocks, styles) → .docx 字节
 *            └── qaRenderHTMLBlocks(blocks, styles, interactive, scroll) → 预览 HTML
 *
 * 章节顺序 / 是否启用 / 标题 / 每段选项（opts）全部由模板 content.sections 驱动，
 * 前端可视化编辑器直接编辑这份 JSON，于是「编辑 → 预览 → 导出」三者同源。
 *
 * 兼容性约定（重要）：
 *   - 老模板 content 里没有 sections / 没有 opts 时，走「老行为」：章节顺序取标准顺序、
 *     opts 取各渲染器原有的默认（填报率 docx=文字行、html=表格，show_table/show_confidence
 *     默认 true）。qa_report_fill_test.go / qa_report_ai_test.go 钉的就是这些老行为。
 *   - 只要模板里显式写了 sections（可视化编辑器保存 / 新版默认模板 / 老模板迁移补全），
 *     两个渲染器就完全一致：预览即导出。
 * =========================================================================== */

/* ── 1. 章节模型 ─────────────────────────────────────────────────────────── */

const (
	qaSecOverview   = "overview"
	qaSecRules      = "rules"
	qaSecItemFill   = "item_fill"
	qaSecRecordFill = "record_fill"
	qaSecAIReview   = "ai_review"
)

// qaSectionOpts 每段的可选行为。布尔/数字的零值即「未设置」，只有
// show_table / show_confidence 是「默认开」，所以用指针区分「未设置」与「显式关」。
type qaSectionOpts struct {
	OnlyFailed     bool    `json:"only_failed,omitempty"`     // 规则明细：只列不通过的
	OnlyMisjudged  bool    `json:"only_misjudged,omitempty"`  // AI 复核：只列疑似误判
	ShowTable      *bool   `json:"show_table,omitempty"`      // 规则明细：附违规数据表（默认 true）
	ShowSQL        bool    `json:"show_sql,omitempty"`        // 规则明细：附执行 SQL（默认 false）
	MaxRows        int     `json:"max_rows,omitempty"`        // 规则明细：每条最多展示行数，0=全部
	OnlyBelow      float64 `json:"only_below,omitempty"`      // 填报率：只列低于该百分比的项，0=全部
	Layout         string  `json:"layout,omitempty"`          // 填报率：line 文字行 / table 表格
	ShowConfidence *bool   `json:"show_confidence,omitempty"` // AI 复核：显示置信度（默认 true）
	EmptyNote      string  `json:"empty_note,omitempty"`      // 过滤后无数据时的提示语
}

func (o qaSectionOpts) showTable() bool {
	return o.ShowTable == nil || *o.ShowTable
}

func (o qaSectionOpts) showConfidence() bool {
	return o.ShowConfidence == nil || *o.ShowConfidence
}

// fillLayout 填报率呈现方式。opts.Layout 为空时按渲染器取老默认值：
// docx=文字行（老导出行为）、html=表格（老预览行为）。
func (o qaSectionOpts) fillLayout(mode string) string {
	switch strings.TrimSpace(o.Layout) {
	case "line", "table":
		return strings.TrimSpace(o.Layout)
	}
	if mode == "docx" {
		return "line"
	}
	return "table"
}

type qaTemplateSection struct {
	Key     string        `json:"key"`
	Title   string        `json:"title"`
	Enabled bool          `json:"enabled"`
	Opts    qaSectionOpts `json:"opts"`
}

/* ── 2. 章节目录（前端控件按此自动生成，新增选项无需改前端）─────────────── */

type qaOptChoice struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type qaOptSpec struct {
	Key     string        `json:"key"`
	Label   string        `json:"label"`
	Type    string        `json:"type"` // bool | number | percent | enum
	Hint    string        `json:"hint,omitempty"`
	Choices []qaOptChoice `json:"choices,omitempty"`
	Default interface{}   `json:"default"`
}

type qaSectionSpec struct {
	Key       string      `json:"key"`
	Label     string      `json:"label"`
	Title     string      `json:"title"`     // 默认标题
	Hint      string      `json:"hint,omitempty"`
	Optional  bool        `json:"optional"`  // 本次无数据时整段不出现（AI 复核）
	AllowTitle bool       `json:"allow_title"` // 是否允许自定义标题（概览默认留空=不出标题）
	Opts      []qaOptSpec `json:"opts"`
}

func boolPtrQA(b bool) *bool { return &b }

func qaSectionCatalog() []qaSectionSpec {
	return []qaSectionSpec{
		{
			Key: qaSecOverview, Label: "审核概览", Title: "", AllowTitle: true,
			Hint: "报告开头的总体统计（总规则数 / 通过 / 不通过）。标题留空则只输出统计，且不占章节编号。",
		},
		{
			Key: qaSecRules, Label: "规则明细", Title: "规则明细", AllowTitle: true,
			Hint: "逐条列出审核结果，可附违规数据表与执行 SQL。",
			Opts: []qaOptSpec{
				{Key: "only_failed", Label: "只列不通过的规则", Type: "bool", Default: false},
				{Key: "show_table", Label: "附违规数据表", Type: "bool", Default: true, Hint: "关掉后报告只留结论文字，文件会小很多。"},
				{Key: "max_rows", Label: "违规数据最多展示", Type: "number", Default: 0, Hint: "每条规则最多渲染多少行违规数据，0 = 不限（总条数仍如实标注）。"},
				{Key: "show_sql", Label: "附执行 SQL", Type: "bool", Default: false},
			},
		},
		{
			Key: qaSecItemFill, Label: "项填报率", Title: "项填报率", AllowTitle: true,
			Hint: "字段级填报率（表 + 字段 + 填报率）。",
			Opts: []qaOptSpec{
				{Key: "layout", Label: "呈现方式", Type: "enum", Default: "line", Choices: []qaOptChoice{
					{Value: "line", Label: "文字行"}, {Value: "table", Label: "表格"},
				}, Hint: "文字行是 Word 导出的原有样式；表格更紧凑，预览与导出始终一致。"},
				{Key: "only_below", Label: "只列低于该填报率的项", Type: "percent", Default: 0, Hint: "填 0 表示不限；例如填 100 就只列未填报完整的项。"},
			},
		},
		{
			Key: qaSecRecordFill, Label: "记录填报率", Title: "记录填报率", AllowTitle: true,
			Hint: "整表记录级填报率（表 + 填报率）。",
			Opts: []qaOptSpec{
				{Key: "layout", Label: "呈现方式", Type: "enum", Default: "line", Choices: []qaOptChoice{
					{Value: "line", Label: "文字行"}, {Value: "table", Label: "表格"},
				}},
				{Key: "only_below", Label: "只列低于该填报率的项", Type: "percent", Default: 0, Hint: "填 0 表示不限。"},
			},
		},
		{
			Key: qaSecAIReview, Label: "AI 复核", Title: "AI 复核（仅供参考，须人类专家最终校核）",
			Optional: true, AllowTitle: true,
			Hint: "仅在本次确实跑过 AI 复核时出现；没有 AI 结果时整段不出现。",
			Opts: []qaOptSpec{
				{Key: "only_misjudged", Label: "只列疑似误判的规则", Type: "bool", Default: false},
				{Key: "show_confidence", Label: "显示 AI 置信度", Type: "bool", Default: true},
			},
		},
	}
}

func qaSectionSpecOf(key string) (qaSectionSpec, bool) {
	for _, s := range qaSectionCatalog() {
		if s.Key == key {
			return s, true
		}
	}
	return qaSectionSpec{}, false
}

func qaSectionKnown(key string) bool {
	_, ok := qaSectionSpecOf(key)
	return ok
}

// qaSectionOrder 章节标准顺序：概览 → 规则明细 → 项填报率 → 记录填报率 → AI 复核。
func qaSectionOrder() []string {
	out := make([]string, 0, 5)
	for _, s := range qaSectionCatalog() {
		out = append(out, s.Key)
	}
	return out
}

// defaultQATemplateSections 全部启用、标准顺序、默认标题（老模板在渲染时用它兜底）。
func defaultQATemplateSections() []qaTemplateSection {
	out := make([]qaTemplateSection, 0, 5)
	for _, s := range qaSectionCatalog() {
		out = append(out, qaTemplateSection{Key: s.Key, Title: s.Title, Enabled: true})
	}
	return out
}

// materializeQASections 把章节列表补全为显式形态：未知键丢弃、缺失键按标准顺序补上、
// 每个选项都用目录里的默认值填实。用于「可视化编辑器打开模板时」与「老模板迁移」。
// 保留调用方给出的顺序（可视化编辑器拖拽排序后的顺序），缺失的键按标准顺序补在后面。
func materializeQASections(in []qaTemplateSection) []qaTemplateSection {
	out := make([]qaTemplateSection, 0, 5)
	seen := map[string]bool{}
	for _, s := range in {
		if !qaSectionKnown(s.Key) || seen[s.Key] {
			continue
		}
		seen[s.Key] = true
		spec, _ := qaSectionSpecOf(s.Key)
		s.Opts = materializeQAOpts(spec, s.Opts)
		out = append(out, s)
	}
	for _, spec := range qaSectionCatalog() {
		if seen[spec.Key] {
			continue
		}
		out = append(out, qaTemplateSection{
			Key: spec.Key, Title: spec.Title, Enabled: true, Opts: materializeQAOpts(spec, qaSectionOpts{}),
		})
	}
	return out
}

func materializeQAOpts(spec qaSectionSpec, o qaSectionOpts) qaSectionOpts {
	for _, opt := range spec.Opts {
		switch opt.Key {
		case "show_table":
			if o.ShowTable == nil {
				o.ShowTable = boolPtrQA(true)
			}
		case "show_confidence":
			if o.ShowConfidence == nil {
				o.ShowConfidence = boolPtrQA(true)
			}
		case "layout":
			if strings.TrimSpace(o.Layout) == "" {
				o.Layout = "line"
			}
		}
	}
	return o
}

// parseQATemplateSections 解析 content.sections。返回 nil 表示「老模板，未声明章节」。
func parseQATemplateSections(raw json.RawMessage) []qaTemplateSection {
	if len(raw) == 0 {
		return nil
	}
	var arr []qaTemplateSection
	if err := json.Unmarshal(raw, &arr); err != nil || len(arr) == 0 {
		return nil
	}
	var out []qaTemplateSection
	for _, s := range arr {
		s.Key = strings.TrimSpace(s.Key)
		if !qaSectionKnown(s.Key) {
			continue
		}
		out = append(out, s)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

/* ── 3. 选择性生成：章节过滤 + 规则子集 ────────────────────────────────── */

type qaSelection struct {
	Sections []string `json:"sections"` // 本次要出的章节（空 = 按模板）
	RuleNMs  []string `json:"rule_nms"` // 本次要出的规则（空 = 全部）
}

func parseQASelection(v interface{}) *qaSelection {
	m, _ := v.(map[string]interface{})
	if m == nil {
		return nil
	}
	sel := &qaSelection{}
	sel.Sections = qaStringList(m["sections"])
	sel.RuleNMs = qaStringList(m["rule_nms"])
	if len(sel.Sections) == 0 && len(sel.RuleNMs) == 0 {
		return nil
	}
	return sel
}

func qaStringList(v interface{}) []string {
	arr := ifaceSlice(v)
	out := make([]string, 0, len(arr))
	for _, x := range arr {
		if s := strings.TrimSpace(fmt.Sprint(x)); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// qaSelectedRules 取本次要出现在报告里的规则行（保持审核结果里的原始顺序）。
func qaSelectedRules(audit map[string]interface{}, sel *qaSelection) []map[string]interface{} {
	rows := make([]map[string]interface{}, 0)
	for _, x := range ifaceSlice(audit["rules"]) {
		if row, ok := x.(map[string]interface{}); ok && row != nil {
			rows = append(rows, row)
		}
	}
	if sel == nil || len(sel.RuleNMs) == 0 {
		return rows
	}
	want := map[string]bool{}
	for _, nm := range sel.RuleNMs {
		want[nm] = true
	}
	out := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		nm := strings.TrimSpace(fmt.Sprint(row["nm"]))
		// NM 不在选中集合里的规则不出现；NM 为空的（异常数据）保留，避免整段消失。
		if nm == "" || want[nm] {
			out = append(out, row)
		}
	}
	return out
}

// qaReportSummary 报告开头的统计。只选了部分规则时按所选规则重算，
// 避免出现「概览说 12 条、明细只列 3 条」的自相矛盾。
func qaReportSummary(audit map[string]interface{}, rules []map[string]interface{}, sel *qaSelection) map[string]interface{} {
	orig, _ := audit["summary"].(map[string]interface{})
	if sel == nil || len(sel.RuleNMs) == 0 {
		return orig
	}
	total, passed, aiN := 0, 0, 0
	for _, row := range rules {
		total++
		if b, _ := row["passed"].(bool); b {
			passed++
		}
		if _, ok := row["ai_reason"]; ok {
			aiN++
		} else if _, ok2 := row["ai_misjudged"]; ok2 {
			aiN++
		}
	}
	out := map[string]interface{}{}
	for k, v := range orig {
		out[k] = v
	}
	out["total_rules"] = total
	out["passed"] = passed
	out["failed"] = total - passed
	if aiN > 0 {
		out["ai_reviewed"] = aiN
	} else {
		delete(out, "ai_reviewed")
	}
	return out
}

/* ── 4. 中间表示（IR）────────────────────────────────────────────────────── */

type qaBlockKind string

const (
	qaBlkHeading qaBlockKind = "heading" // 章节标题（带编号）
	qaBlkPara    qaBlockKind = "para"    // 普通段落
	qaBlkBold    qaBlockKind = "bold"    // 小标题（如规则名）
	qaBlkEmpty   qaBlockKind = "empty"   // 弱化提示（无数据说明）
	qaBlkTable   qaBlockKind = "table"   // 表格
	qaBlkMono    qaBlockKind = "mono"    // 等宽块（SQL 等）
	qaBlkSpacer  qaBlockKind = "spacer"  // 段落间距
)

type qaBlock struct {
	Kind    qaBlockKind
	Sec     string
	Text    string
	Headers []string
	Rows    [][]string
}

func qaNumLabel(i int, mode string) string {
	switch mode {
	case "arabic":
		return fmt.Sprintf("%d. ", i+1)
	case "none":
		return ""
	default: // cn（一、二、三…）
		cn := []string{"一", "二", "三", "四", "五", "六", "七", "八", "九", "十"}
		if i < len(cn) {
			return cn[i] + "、"
		}
		return fmt.Sprintf("%d、", i+1)
	}
}

// qaBuildReportBlocks 生成报告 IR。mode ∈ {"docx","html"}，只影响老模板下填报率的默认呈现方式。
func qaBuildReportBlocks(audit map[string]interface{}, styles *qaTemplateStyles, sel *qaSelection, mode string) []qaBlock {
	if styles == nil {
		styles = parseQATemplateContent("{}")
	}
	secs := styles.Sections
	if len(secs) == 0 {
		secs = defaultQATemplateSections()
	}
	var onlySec map[string]bool
	if sel != nil && len(sel.Sections) > 0 {
		onlySec = map[string]bool{}
		for _, k := range sel.Sections {
			onlySec[strings.TrimSpace(k)] = true
		}
	}
	rules := qaSelectedRules(audit, sel)
	summary := qaReportSummary(audit, rules, sel)
	aiRows := qaAIRows(rules)

	out := make([]qaBlock, 0, 32)
	first := true
	numIdx := 0
	for _, s := range secs {
		if !s.Enabled {
			continue
		}
		if onlySec != nil && !onlySec[s.Key] {
			continue
		}
		spec, _ := qaSectionSpecOf(s.Key)
		var body []qaBlock
		switch s.Key {
		case qaSecOverview:
			body = qaOverviewBlocks(summary)
		case qaSecRules:
			body = qaRuleBlocks(rules, s.Opts, mode)
		case qaSecItemFill:
			body = qaFillBlocks(audit, "item_fill_rates", true, s.Opts, mode)
		case qaSecRecordFill:
			body = qaFillBlocks(audit, "record_fill_rates", false, s.Opts, mode)
		case qaSecAIReview:
			body = qaAIBlocks(aiRows, audit, s.Opts)
		}
		// AI 段是「可选段」：本次没有 AI 数据时整段（含标题）不出现，老行为如此。
		if spec.Optional && len(body) == 0 {
			continue
		}
		if !first {
			out = append(out, qaBlock{Kind: qaBlkSpacer})
		}
		first = false
		if title := strings.TrimSpace(s.Title); title != "" {
			out = append(out, qaBlock{
				Kind: qaBlkHeading, Sec: s.Key,
				Text: qaNumLabel(numIdx, styles.SectionNumber) + title,
			})
			numIdx++
		}
		for i := range body {
			if body[i].Sec == "" {
				body[i].Sec = s.Key
			}
		}
		out = append(out, body...)
	}
	return out
}

func qaOverviewBlocks(summary map[string]interface{}) []qaBlock {
	if summary == nil {
		return nil
	}
	line := fmt.Sprintf("总规则数：%v   通过：%v   不通过：%v", summary["total_rules"], summary["passed"], summary["failed"])
	if n, ok := summary["ai_reviewed"]; ok && n != nil && fmt.Sprint(n) != "0" && fmt.Sprint(n) != "" {
		line += fmt.Sprintf("   AI 复核：%v 条（须人类专家最终校核）", n)
	}
	return []qaBlock{{Kind: qaBlkPara, Text: line}}
}

func qaRuleBlocks(rules []map[string]interface{}, opts qaSectionOpts, mode string) []qaBlock {
	out := make([]qaBlock, 0, len(rules)*2)
	shown := 0
	for _, row := range rules {
		if opts.OnlyFailed {
			if b, _ := row["passed"].(bool); b {
				continue
			}
		}
		shown++
		out = append(out, qaBlock{Kind: qaBlkBold, Text: fmt.Sprintf("%d. %v（%v）", shown, row["name"], row["nm"])})
		out = append(out, qaBlock{Kind: qaBlkPara, Text: fmt.Sprintf("结果：违规数 %v   通过：%v", row["violation_count"], row["passed"])})
		if e, ok := row["error"].(string); ok && strings.TrimSpace(e) != "" {
			out = append(out, qaBlock{Kind: qaBlkPara, Text: "错误：" + e})
		}
		if opts.ShowSQL {
			if s, ok := row["sql_executed"].(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, qaBlock{Kind: qaBlkPara, Text: "执行 SQL："})
				out = append(out, qaBlock{Kind: qaBlkMono, Text: s})
			}
		}
		if !opts.showTable() {
			continue
		}
		headers, rows := qaSampleRowsTable(row["sample_rows"])
		if len(rows) == 0 {
			continue
		}
		total := len(rows)
		out = append(out, qaBlock{Kind: qaBlkPara, Text: fmt.Sprintf("违规数据（共 %d 条）：", total)})
		if opts.MaxRows > 0 && len(rows) > opts.MaxRows {
			rows = rows[:opts.MaxRows]
			out = append(out, qaBlock{Kind: qaBlkEmpty, Text: fmt.Sprintf("（此处仅展示前 %d 条，共 %d 条）", opts.MaxRows, total)})
		}
		out = append(out, qaBlock{Kind: qaBlkTable, Headers: headers, Rows: rows})
	}
	if shown == 0 && len(rules) > 0 {
		note := strings.TrimSpace(opts.EmptyNote)
		if note == "" {
			note = "（本次没有不通过的规则）"
		}
		out = append(out, qaBlock{Kind: qaBlkEmpty, Text: note})
	}
	return out
}

// qaSampleRowsTable 违规数据 → 表头（字段名升序）+ 行。
func qaSampleRowsTable(v interface{}) ([]string, [][]string) {
	sr := ifaceSlice(v)
	if len(sr) == 0 {
		return nil, nil
	}
	fieldSet := map[string]bool{}
	maps := make([]map[string]interface{}, 0, len(sr))
	for _, item := range sr {
		if m, ok := item.(map[string]interface{}); ok && m != nil {
			maps = append(maps, m)
			for k := range m {
				fieldSet[k] = true
			}
		}
	}
	if len(maps) == 0 {
		return nil, nil
	}
	headers := make([]string, 0, len(fieldSet))
	for k := range fieldSet {
		headers = append(headers, k)
	}
	sort.Strings(headers)
	rows := make([][]string, 0, len(maps))
	for _, m := range maps {
		line := make([]string, 0, len(headers))
		for _, h := range headers {
			line = append(line, qaCellText(m[h]))
		}
		rows = append(rows, line)
	}
	return headers, rows
}

func qaCellText(v interface{}) string {
	switch vv := v.(type) {
	case nil:
		return ""
	case string:
		return vv
	case float64:
		return fmt.Sprintf("%.0f", vv)
	case int:
		return fmt.Sprintf("%d", vv)
	case int64:
		return fmt.Sprintf("%d", vv)
	case bool:
		return fmt.Sprint(vv)
	default:
		return fmt.Sprintf("%v", vv)
	}
}

// qaFillBlocks 填报率段落（项填报率 / 记录填报率共用）。
func qaFillBlocks(audit map[string]interface{}, key string, withField bool, opts qaSectionOpts, mode string) []qaBlock {
	raw := ifaceSlice(audit[key])
	other := "record_fill_rates"
	if key == "record_fill_rates" {
		other = "item_fill_rates"
	}
	fillSkipped, _ := audit["fill_skipped"].(bool)
	note := ""
	if fillSkipped {
		note = "本次未执行填报率审核"
	} else if len(raw) == 0 && len(ifaceSlice(audit[other])) == 0 {
		note = "未配置填报率"
	}
	if note != "" {
		return []qaBlock{{Kind: qaBlkEmpty, Text: note}}
	}

	rows := make([]map[string]interface{}, 0, len(raw))
	for _, x := range raw {
		if m, ok := x.(map[string]interface{}); ok && m != nil {
			rows = append(rows, m)
		}
	}
	if opts.OnlyBelow > 0 {
		kept := make([]map[string]interface{}, 0, len(rows))
		for _, m := range rows {
			if v, err := ifaceToFloat(m["rate_percent"]); err == nil {
				if v < opts.OnlyBelow {
					kept = append(kept, m)
				}
				continue
			}
			// 表不存在 / 算不出填报率：属于异常项，阈值过滤时保留，别把问题藏起来
			kept = append(kept, m)
		}
		rows = kept
	}
	if len(rows) == 0 {
		n := strings.TrimSpace(opts.EmptyNote)
		if n == "" {
			n = fmt.Sprintf("（没有低于 %.2f%% 的填报率数据）", opts.OnlyBelow)
		}
		return []qaBlock{{Kind: qaBlkEmpty, Text: n}}
	}

	if opts.fillLayout(mode) == "table" {
		headers := []string{"表名", "填报率"}
		if withField {
			headers = []string{"表名", "字段名", "填报率"}
		}
		out := make([][]string, 0, len(rows))
		for _, m := range rows {
			if withField {
				out = append(out, []string{qaFillCellText(m["table_name"]), qaFillCellText(m["field_name"]), qaFillRateText(m)})
			} else {
				out = append(out, []string{qaFillCellText(m["table_name"]), qaFillRateText(m)})
			}
		}
		return []qaBlock{{Kind: qaBlkTable, Headers: headers, Rows: out}}
	}

	out := make([]qaBlock, 0, len(rows))
	for _, m := range rows {
		out = append(out, qaBlock{Kind: qaBlkPara, Text: qaFillDocxLine(m, withField)})
	}
	return out
}

func qaAIRows(rules []map[string]interface{}) []map[string]interface{} {
	out := make([]map[string]interface{}, 0)
	for _, row := range rules {
		_, hasReason := row["ai_reason"]
		_, hasMis := row["ai_misjudged"]
		if !hasReason && !hasMis {
			continue
		}
		out = append(out, row)
	}
	return out
}

func qaAIBlocks(aiRows []map[string]interface{}, audit map[string]interface{}, opts qaSectionOpts) []qaBlock {
	rows := aiRows
	if opts.OnlyMisjudged {
		kept := make([]map[string]interface{}, 0, len(rows))
		for _, row := range rows {
			if b, _ := row["ai_misjudged"].(bool); b {
				kept = append(kept, row)
			}
		}
		rows = kept
	}
	if len(rows) == 0 {
		if opts.OnlyMisjudged && len(aiRows) > 0 {
			return []qaBlock{{Kind: qaBlkEmpty, Text: "（本次没有疑似误判的规则）"}}
		}
		return nil
	}
	out := make([]qaBlock, 0, len(rows)*4)
	out = append(out, qaBlock{Kind: qaBlkPara, Text: "说明：以下规则在执行 SQL 审核不通过后，按其自带的复核原则交由 AI 复核。AI 结论仅供参考，不构成最终判定，须由人类专家最终校核确认。"})
	if m, _ := audit["ai_model"].(string); strings.TrimSpace(m) != "" {
		out = append(out, qaBlock{Kind: qaBlkPara, Text: "AI 模型：" + strings.TrimSpace(m)})
	}
	for _, row := range rows {
		out = append(out, qaBlock{Kind: qaBlkBold, Text: fmt.Sprintf("%v（%v）", row["name"], row["nm"])})
		if e, _ := row["error"].(string); strings.TrimSpace(e) != "" {
			out = append(out, qaBlock{Kind: qaBlkPara, Text: fmt.Sprintf("SQL 审核结果：执行错误 —— %s", e)})
		} else {
			passedText := "不通过"
			if b, _ := row["passed"].(bool); b {
				passedText = "通过"
			}
			out = append(out, qaBlock{Kind: qaBlkPara, Text: fmt.Sprintf("SQL 审核结果：%s（违规行数 %v）", passedText, row["violation_count"])})
		}
		mis := "否"
		if b, _ := row["ai_misjudged"].(bool); b {
			mis = "是（疑似规则过严导致的误判）"
		}
		conf := ""
		if opts.showConfidence() {
			if c, ok := row["ai_confidence"]; ok && c != nil {
				if f, err := ifaceToFloat(c); err == nil {
					conf = fmt.Sprintf("   置信度：%.2f", f)
				}
			}
		}
		out = append(out, qaBlock{Kind: qaBlkPara, Text: "AI 复核结论：是否误判 —— " + mis + conf})
		if r, _ := row["ai_reason"].(string); strings.TrimSpace(r) != "" {
			out = append(out, qaBlock{Kind: qaBlkPara, Text: "理由：" + r})
		}
		if sg, _ := row["ai_suggestion"].(string); strings.TrimSpace(sg) != "" {
			out = append(out, qaBlock{Kind: qaBlkPara, Text: "建议：" + sg})
		}
		out = append(out, qaBlock{Kind: qaBlkPara, Text: "※ 本条须由人类专家最终校核。"})
	}
	return out
}

/* ── 5. docx 渲染 ────────────────────────────────────────────────────────── */

// buildQualityAuditDocx 保持原签名（测试与定时任务在用）：不带选择性参数。
func buildQualityAuditDocx(audit map[string]interface{}, styles *qaTemplateStyles) ([]byte, error) {
	blocks := qaBuildReportBlocks(audit, styles, nil, "docx")
	return qaRenderDocxBlocks(blocks, styles)
}

func qaRenderDocxBlocks(blocks []qaBlock, styles *qaTemplateStyles) ([]byte, error) {
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
	addParaBold := func(text string) {
		sb.WriteString(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">`)
		sb.WriteString(xmlEscapeQA(text))
		sb.WriteString(`</w:t></w:r></w:p>`)
	}
	addTableFn := func(headers []string, rows [][]string) {
		sb.WriteString(`<w:tbl>`)
		sb.WriteString(`<w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>`)
		sb.WriteString(`<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
		sb.WriteString(`<w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
		sb.WriteString(`<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
		sb.WriteString(`<w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
		sb.WriteString(`<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
		sb.WriteString(`<w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
		sb.WriteString(`</w:tblBorders></w:tblPr>`)
		sb.WriteString(`<w:tr>`)
		for _, h := range headers {
			sb.WriteString(`<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="E0E0E0"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>`)
			sb.WriteString(xmlEscapeQA(h))
			sb.WriteString(`</w:t></w:r></w:p></w:tc>`)
		}
		sb.WriteString(`</w:tr>`)
		for _, row := range rows {
			sb.WriteString(`<w:tr>`)
			for _, cell := range row {
				sb.WriteString(`<w:tc><w:p><w:r><w:t xml:space="preserve">`)
				sb.WriteString(xmlEscapeQA(cell))
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

	for _, b := range blocks {
		switch b.Kind {
		case qaBlkHeading:
			addParaStyled(b.Text, styles.Section)
		case qaBlkBold:
			addParaBold(b.Text)
		case qaBlkTable:
			addTableFn(b.Headers, b.Rows)
		case qaBlkSpacer, qaBlkPara, qaBlkEmpty, qaBlkMono:
			addPara(b.Text)
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

	wct, _ := z.Create(`[Content_Types].xml`)
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

/* ── 6. HTML 渲染（预览 / 可视化编辑）───────────────────────────────────── */

func buildQualityAuditHTML(audit map[string]interface{}, styles *qaTemplateStyles) string {
	blocks := qaBuildReportBlocks(audit, styles, nil, "html")
	return qaRenderHTMLBlocks(blocks, styles, false, 0)
}

// qaRenderHTMLBlocks interactive=true 时注入「点选章节 / 双击改标题」脚本，
// 并保留 scroll 指定的滚动位置，使可视化编辑器刷新预览时不跳回顶部。
func qaRenderHTMLBlocks(blocks []qaBlock, styles *qaTemplateStyles, interactive bool, scroll int) string {
	if styles == nil {
		styles = parseQATemplateContent("{}")
	}
	title := styles.DocTitle
	if strings.TrimSpace(title) == "" {
		title = "数据质量审核报告"
	}
	esc := html.EscapeString
	tFont, tSize, tCol := esc(styles.Title.FontFamily), esc(styles.Title.FontSize), esc(styles.Title.Color)
	sFont, sSize, sCol := esc(styles.Section.FontFamily), esc(styles.Section.FontSize), esc(styles.Section.Color)
	tbBorder, tbHead, tbAlt := esc(styles.Table.Border), esc(styles.Table.HeaderBg), esc(styles.Table.RowAlt)

	var b strings.Builder
	b.WriteString("<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>")
	b.WriteString(esc(title))
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
.qa-blk{position:relative;border-radius:4px;}
`)

	// 预览态（非编辑态）不加任何交互样式，保证「预览＝导出」
	b.WriteString(`</style>`)
	if interactive {
		b.WriteString(`<style>
.qa-blk:hover{outline:1px dashed #94a3b8;outline-offset:2px;}
.qa-blk.qa-sel{outline:2px solid #2563eb;outline-offset:2px;}
.qa-sec[contenteditable="true"]{outline:1px solid #2563eb;background:#eff6ff;}
body{user-select:text;}
</style>`)
	}
	b.WriteString(`</head><body>`)

	if strings.TrimSpace(styles.PageHeader) != "" {
		b.WriteString(`<div class="qa-ph">` + esc(styles.PageHeader) + `</div>`)
	}
	b.WriteString(`<h1 class="qa-doc-title">` + esc(title) + `</h1>`)
	b.WriteString(`<div class="qa-time">生成时间：` + esc(time.Now().Format("2006-01-02 15:04:05")) + `</div>`)

	for _, blk := range blocks {
		secAttr := ""
		if interactive && blk.Sec != "" {
			secAttr = ` data-qa-sec="` + esc(blk.Sec) + `"`
		}
		openWrap, closeWrap := "", ""
		if interactive && blk.Sec != "" && blk.Kind != qaBlkSpacer {
			openWrap = `<section class="qa-blk"` + secAttr + `>`
			closeWrap = `</section>`
		}
		switch blk.Kind {
		case qaBlkHeading:
			b.WriteString(openWrap + `<h2 class="qa-sec"` + secAttr + `>` + esc(blk.Text) + `</h2>` + closeWrap)
		case qaBlkBold:
			b.WriteString(openWrap + `<div class="qa-rule"><strong>` + esc(blk.Text) + `</strong></div>` + closeWrap)
		case qaBlkEmpty:
			b.WriteString(openWrap + `<div class="qa-empty">` + esc(blk.Text) + `</div>` + closeWrap)
		case qaBlkMono:
			b.WriteString(openWrap + `<div class="qa-mono">` + esc(blk.Text) + `</div>` + closeWrap)
		case qaBlkSpacer:
			b.WriteString(`<div style="height:10px"></div>`)
		case qaBlkTable:
			b.WriteString(openWrap + `<table class="qa-tbl"><thead><tr>`)
			for _, h := range blk.Headers {
				b.WriteString(`<th>` + esc(h) + `</th>`)
			}
			b.WriteString(`</tr></thead><tbody>`)
			for _, row := range blk.Rows {
				b.WriteString(`<tr>`)
				for _, cell := range row {
					b.WriteString(`<td>` + esc(cell) + `</td>`)
				}
				b.WriteString(`</tr>`)
			}
			b.WriteString(`</tbody></table>` + closeWrap)
		default: // qaBlkPara
			b.WriteString(openWrap + `<p>` + esc(blk.Text) + `</p>` + closeWrap)
		}
	}

	if strings.TrimSpace(styles.PageFooter) != "" {
		b.WriteString(`<div class="qa-ph" style="margin-top:32px;">` + esc(styles.PageFooter) + `</div>`)
	}

	if interactive {
		b.WriteString(qaPreviewBridgeScript(scroll))
	}
	b.WriteString(`</body></html>`)
	return b.String()
}

// qaPreviewBridgeScript 预览 iframe 与宿主页面（报告模板可视化编辑器）之间的桥：
// 点选章节 → 通知宿主高亮/切换左栏；双击标题 → 行内改名 → 通知宿主写回模板。
func qaPreviewBridgeScript(scroll int) string {
	var sb strings.Builder
	sb.WriteString(`<script>(function(){
function post(o){ try{ parent.postMessage(o,'*'); }catch(e){} }
document.addEventListener('click', function(e){
  var el = e.target && e.target.closest ? e.target.closest('[data-qa-sec]') : null;
  post({type:'qa-pick', key: el ? el.getAttribute('data-qa-sec') : ''});
}, true);
document.addEventListener('dblclick', function(e){
  var h = e.target && e.target.closest ? e.target.closest('.qa-sec[data-qa-sec]') : null;
  if(!h) return;
  h.setAttribute('contenteditable','true');
  h.focus();
  var r=document.createRange(); r.selectNodeContents(h);
  var s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
});
document.addEventListener('keydown', function(e){
  var t=e.target;
  if(!t || t.getAttribute('contenteditable')!=='true') return;
  if(e.key==='Enter'||e.key==='Escape'){ e.preventDefault(); t.blur(); }
});
document.addEventListener('blur', function(e){
  var t=e.target;
  if(!t || !t.getAttribute || t.getAttribute('contenteditable')!=='true') return;
  t.setAttribute('contenteditable','false');
  post({type:'qa-title', key:t.getAttribute('data-qa-sec'), title:(t.textContent||'').replace(/^\s*[一二三四五六七八九十\d]+[、.]\s*/,'').trim()});
}, true);
window.addEventListener('message', function(ev){
  var d=ev.data||{};
  if(d.type!=='qa-highlight') return;
  var all=document.querySelectorAll('.qa-sel');
  for(var i=0;i<all.length;i++) all[i].classList.remove('qa-sel');
  if(!d.key) return;
  var n=document.querySelector('[data-qa-sec="'+d.key+'"]');
  if(n && n.classList) n.classList.add('qa-sel');
});
`)
	sb.WriteString(fmt.Sprintf("var __qaScroll=%d;\n", scroll))
	sb.WriteString(`if(__qaScroll>0){ requestAnimationFrame(function(){ window.scrollTo(0,__qaScroll); }); }
})();</script>`)
	return sb.String()
}

/* ── 7. 模板 content 规范化（可视化编辑器 / 老模板迁移共用）────────────── */

// qaNormalizeTemplateContent 把模板内容补全成「显式样式 + 显式章节 + 显式选项」的
// 规范形态。可视化编辑器打开模板时先调它，于是编辑器里的所见即渲染器的所得；
// 老模板（只有样式）也靠它一次性对齐两个渲染器。
func qaNormalizeTemplateContent(raw string) string {
	st := parseQATemplateContent(raw)
	secs := materializeQASections(st.Sections)
	mode := strings.TrimSpace(st.SectionNumber)
	if mode != "cn" && mode != "arabic" && mode != "none" {
		mode = "cn"
	}
	out := qaTemplateContentDoc{
		DocTitle:      st.DocTitle,
		Title:         st.Title,
		Section:       st.Section,
		Table:         st.Table,
		PageHeader:    st.PageHeader,
		PageFooter:    st.PageFooter,
		SectionNumber: mode,
		Sections:      secs,
	}
	buf, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return raw
	}
	return string(buf)
}

type qaTemplateContentDoc struct {
	DocTitle      string             `json:"doc_title"`
	Title         qaTemplateTextSt   `json:"title"`
	Section       qaTemplateTextSt   `json:"section"`
	Table         qaTemplateTableSt  `json:"table"`
	PageHeader    string             `json:"page_header"`
	PageFooter    string             `json:"page_footer"`
	SectionNumber string             `json:"section_number"`
	Sections      []qaTemplateSection `json:"sections"`
}

package main

import (
	"fmt"
	"strings"
	"testing"
)

/* ===========================================================================
 * 任务级 / 单次「报告内容」覆盖层 回归防线
 *
 * 这块功能的核心不变量（别让它们被改回去）：
 *   ① 覆盖层为空 = 完全不动：报告必须和「没有覆盖层」逐字一致。
 *      否则「老任务行为不变」这条承诺就是假的。
 *   ② 局部覆盖真的局部：只改被显式提到的字段，同章节的其它选项、
 *      其它章节全部保持模板原样。模板以后升级要能自动传导到任务，
 *      靠的就是这一点（任务里只存 diff，不存整份快照）。
 *   ③ 「显式关掉」与「没配」必须区分开：三态语义靠指针实现，
 *      显式 false 不能被当成零值吃掉。
 *   ④ 层次：模板 ← 任务覆盖 ← 单次覆盖，后面的盖前面的。
 *   ⑤ 只配了章节覆盖、没筛规则的报告，规则必须保持全量（不能空报告）。
 * =========================================================================== */

func qaOvFromJSON(t *testing.T, raw string) *qaReportOverride {
	t.Helper()
	return parseQAReportOverride(raw)
}

/* ── ① 空覆盖 = 逐字不动 ───────────────────────────────────────────────── */

func TestQAReportOverrideEmptyIsNoop(t *testing.T) {
	content := qaTestTemplate("cn", nil)
	audit := qaTestAudit()
	baseDocx, baseHTML := qaRenderBoth(t, content, audit, nil)

	// 各种「等价于没配」的形态都要落到 noop 上
	for _, raw := range []string{
		"", "{}", "null", "  ",
		`{"sections":[]}`,
		`{"sections":[{"key":"rules"}]}`,                          // 全字段为空 = 没说任何事
		`{"sections":[{"key":"no_such_section","enabled":true}]}`, // 未知章节键
	} {
		ov := qaOvFromJSON(t, raw)
		if !ov.empty() {
			t.Fatalf("覆盖 %q 应被判定为空（等价于「完全跟随模板」）", raw)
		}
		docx, html := qaRenderBoth(t, content, audit, &qaSelection{Override: ov})
		if docx != baseDocx {
			t.Fatalf("空覆盖 %q 改变了 Word 内容\n--- 期望 ---\n%s\n--- 实际 ---\n%s", raw, baseDocx, docx)
		}
		if html != baseHTML {
			t.Fatalf("空覆盖 %q 改变了 HTML 内容\n--- 期望 ---\n%s\n--- 实际 ---\n%s", raw, baseHTML, html)
		}
	}
}

/* ── ② 章节开关：任务能关掉模板开着的，也能打开模板关着的 ─────────────── */

func TestQAReportOverrideToggleSections(t *testing.T) {
	// 模板：主动关掉「项填报率」，并保留其余章节
	content := qaTestTemplate("cn", func(secs []qaTemplateSection) []qaTemplateSection {
		qaTestSetSection(secs, qaSecItemFill, func(s *qaTemplateSection) { s.Enabled = false })
		return secs
	})
	audit := qaTestAudit()

	_, base := qaRenderBoth(t, content, audit, nil)
	if strings.Contains(base, "项填报率") {
		t.Fatal("前置条件不成立：模板已关掉项填报率，报告里不该出现这一节")
	}
	if !strings.Contains(base, "规则明细") {
		t.Fatal("前置条件不成立：模板里规则明细应是开着的")
	}

	// 任务 A：把模板关掉的章节强制打开
	on := qaOvFromJSON(t, `{"sections":[{"key":"item_fill","enabled":true}]}`)
	_, htmlOn := qaRenderBoth(t, content, audit, &qaSelection{Override: on})
	if !strings.Contains(htmlOn, "项填报率") {
		t.Fatal("任务把 item_fill 设为 enabled=true，报告里却还是没有这一节")
	}

	// 任务 B：把模板开着的章节关掉，同时必须不影响其它章节（局部覆盖的核心）
	off := qaOvFromJSON(t, `{"sections":[{"key":"rules","enabled":false}]}`)
	_, htmlOff := qaRenderBoth(t, content, audit, &qaSelection{Override: off})
	if strings.Contains(htmlOff, "规则明细") {
		t.Fatal("任务把 rules 设为 enabled=false，报告里还有「规则明细」")
	}
	if strings.Contains(htmlOff, "项填报率") {
		t.Fatal("任务只关了规则明细，项填报率却被顺手打开了 —— 覆盖层必须是局部的")
	}
	if !strings.Contains(htmlOff, "记录填报率") {
		t.Fatal("任务只关了规则明细，记录填报率也被带走了 —— 只应影响被显式提到的章节")
	}
}

/* ── ③ 标题覆盖：能改，也能清空（「这一节不要标题」是合法用法）────────── */

func TestQAReportOverrideTitle(t *testing.T) {
	content := qaTestTemplate("cn", nil)
	audit := qaTestAudit()

	renamed := qaOvFromJSON(t, `{"sections":[{"key":"rules","title":"异常明细"}]}`)
	_, html := qaRenderBoth(t, content, audit, &qaSelection{Override: renamed})
	if !strings.Contains(html, "异常明细") {
		t.Fatal("任务改了章节标题，报告里没生效")
	}
	if strings.Contains(html, "规则明细") {
		t.Fatal("章节标题被覆盖后，模板里的旧标题还在")
	}

	// 清空标题：显式给空串，不能被当成「没配」而回落到模板标题
	blank := qaOvFromJSON(t, `{"sections":[{"key":"rules","title":""}]}`)
	if blank.empty() {
		t.Fatal("只有 title 置空 的覆盖被当成空配置丢掉了")
	}
	_, htmlBlank := qaRenderBoth(t, content, audit, &qaSelection{Override: blank})
	if strings.Contains(htmlBlank, "规则明细") {
		t.Fatal("title 显式置空后，模板标题又冒出来了（空串应被当作「不要标题」而非「未配置」）")
	}
}

/* ── ④ 选项：只改一个键，同章节其它选项保持模板值 ──────────────────────── */

func TestQAReportOverrideOptsPartialMerge(t *testing.T) {
	content := qaTestTemplate("cn", func(secs []qaTemplateSection) []qaTemplateSection {
		qaTestSetSection(secs, qaSecRules, func(s *qaTemplateSection) {
			s.Opts.OnlyFailed = false
			s.Opts.ShowTable = boolPtrQA(true)
			s.Opts.ShowSQL = false
		})
		return secs
	})
	audit := qaTestAudit()

	_, base := qaRenderBoth(t, content, audit, nil)
	if !strings.Contains(base, "主键非空") {
		t.Fatal("前置条件不成立：模板 only_failed=false，通过的规则也该列出来")
	}
	if !strings.Contains(base, "abc") {
		t.Fatal("前置条件不成立：模板 show_table=true，违规样例数据该在报告里")
	}

	// 只把「只列不通过」改成 true
	ov := qaOvFromJSON(t, `{"sections":[{"key":"rules","opts":{"only_failed":true}}]}`)
	_, html := qaRenderBoth(t, content, audit, &qaSelection{Override: ov})
	if strings.Contains(html, "主键非空") {
		t.Fatal("only_failed=true 后，通过的规则还在报告里")
	}
	if !strings.Contains(html, "手机号格式") {
		t.Fatal("only_failed=true 后，不通过的规则必须还在")
	}
	if !strings.Contains(html, "abc") {
		t.Fatal("只改了 only_failed，模板的 show_table=true 被顺手改掉了 —— 局部覆盖必须逐字段生效")
	}

	// 显式把模板开着的 show_table 关掉
	ov2 := qaOvFromJSON(t, `{"sections":[{"key":"rules","opts":{"show_table":false}}]}`)
	_, html2 := qaRenderBoth(t, content, audit, &qaSelection{Override: ov2})
	if strings.Contains(html2, "abc") {
		t.Fatal("show_table=false 后，违规样例数据还在报告里")
	}
	if !strings.Contains(html2, "主键非空") {
		t.Fatal("只关了 show_table，only_failed=false 被顺手改掉了")
	}
}

/* ── ⑤ 不得原地改模板切片（否则同一份模板被多个任务共用时会串味）──────── */

func TestQAReportOverrideDoesNotMutateTemplate(t *testing.T) {
	content := qaTestTemplate("cn", nil)
	before := parseQATemplateContent(content)
	snapshot := qaDebugSections(before.Sections)

	ov := qaOvFromJSON(t, `{"sections":[{"key":"rules","enabled":false,"title":"X","opts":{"only_failed":true,"max_rows":3}}]}`)
	_ = qaApplyReportOverride(before.Sections, ov)

	after := qaDebugSections(before.Sections)
	if after != snapshot {
		t.Fatalf("覆盖层原地改了模板章节\n--- 之前 ---\n%s\n--- 之后 ---\n%s", snapshot, after)
	}
}

// qaDebugSections 把章节列表打平成可比较文本（仅测试用）。
func qaDebugSections(secs []qaTemplateSection) string {
	var b strings.Builder
	for _, s := range secs {
		b.WriteString(s.Key)
		b.WriteString("|")
		b.WriteString(s.Title)
		b.WriteString("|enabled=")
		if s.Enabled {
			b.WriteString("1")
		} else {
			b.WriteString("0")
		}
		fmt.Fprintf(&b, "|opts=%+v\n", s.Opts)
	}
	return b.String()
}

/* ── ⑥ 层次：模板 ← 任务覆盖 ← 单次覆盖 ───────────────────────────────── */

func TestQAReportOverrideRunLayerBeatsTaskLayer(t *testing.T) {
	content := qaTestTemplate("cn", nil)
	audit := qaTestAudit()
	st := parseQATemplateContent(content)

	// 任务层：规则明细只列不通过的
	taskOV := qaOvFromJSON(t, `{"sections":[{"key":"rules","opts":{"only_failed":true}}]}`)
	st.Sections = qaApplyReportOverride(st.Sections, taskOV)

	// 单次层：这次生成要全列（盖过任务层）
	runOV := qaOvFromJSON(t, `{"sections":[{"key":"rules","opts":{"only_failed":false}}]}`)
	sel := &qaSelection{Override: runOV}
	html := qaStripHTML(qaRenderHTMLBlocks(qaBuildReportBlocks(audit, st, sel, "html"), st, false, 0))
	if !strings.Contains(html, "主键非空") {
		t.Fatal("单次运行的覆盖没有盖过任务级覆盖 —— 层次应是 模板 ← 任务 ← 单次")
	}
}

/* ── ⑦ 调度器侧：没配覆盖就必须是 nil，保证老任务行为与升级前一致 ──────── */

func TestQAScheduleReportSelection(t *testing.T) {
	if sel := qaScheduleReportSelection(nil); sel != nil {
		t.Fatal("nil 任务不该产生选择")
	}
	if sel := qaScheduleReportSelection(&qaSchedule{}); sel != nil {
		t.Fatal("任务没配 report_overrides 时必须返回 nil（= 纯用模板），否则老任务行为会漂移")
	}
	if sel := qaScheduleReportSelection(&qaSchedule{ReportOverrides: qaOvFromJSON(t, `{"sections":[]}`)}); sel != nil {
		t.Fatal("空覆盖也要落回 nil")
	}

	s := &qaSchedule{ReportOverrides: qaOvFromJSON(t, `{"sections":[{"key":"rules","enabled":false}]}`)}
	sel := qaScheduleReportSelection(s)
	if sel == nil || sel.Override == nil || len(sel.Override.Sections) != 1 {
		t.Fatalf("任务覆盖没有传到渲染层: %+v", sel)
	}
	// 只配了章节覆盖、没筛规则时，规则必须保持全量 —— 否则报告会变成空的
	if got := len(qaSelectedRules(qaTestAudit(), sel)); got != 3 {
		t.Fatalf("只配章节覆盖时规则应保持全量 3 条，实际 %d 条（报告会缺数据）", got)
	}
}

/* ── ⑧ 三态语义：显式关闭 / 显式打开 / 没提 ───────────────────────────── */

func TestQAReportOverrideTriState(t *testing.T) {
	ov := qaOvFromJSON(t, `{"sections":[{"key":"rules","enabled":false}]}`)
	if len(ov.Sections) != 1 {
		t.Fatalf("显式 enabled=false 的章节被丢掉了: %+v", ov)
	}
	if ov.Sections[0].Enabled == nil || *ov.Sections[0].Enabled {
		t.Fatalf("显式 false 被当成零值吃掉了（会退化成「跟随模板」）: %+v", ov.Sections[0])
	}

	// 只写 opts 的章节要保留（它表达了「跟随开关、只改选项」）
	ov2 := qaOvFromJSON(t, `{"sections":[{"key":"rules","opts":{"max_rows":5}}]}`)
	if ov2.empty() || ov2.Sections[0].Opts == nil || ov2.Sections[0].Opts.MaxRows == nil || *ov2.Sections[0].Opts.MaxRows != 5 {
		t.Fatalf("opts 覆盖没被解析出来: %+v", ov2)
	}
	if ov2.Sections[0].Enabled != nil {
		t.Fatal("没写 enabled 时不该凭空给它设值（会破坏「跟随模板」语义）")
	}
}

/* ── ⑨ 覆盖层提到、模板里没有的章节：按目录补出来（不能静默失效）────────
   正常情况下 parseQATemplateContent 会把章节补齐，所以模板里「缺章节」只会
   出现在老库 / 手工改过的 content 上。这条防线盯的是函数本身：
   任务明确说要用，就一定要用得上，而不是被静默忽略。 */

func TestQAReportOverrideCanEnableSectionMissingFromTemplate(t *testing.T) {
	// 造一份「只剩概览 + 规则明细」的残缺章节表（模拟老模板）
	base := []qaTemplateSection{
		{Key: qaSecOverview, Title: "", Enabled: true},
		{Key: qaSecRules, Title: "规则明细", Enabled: true},
	}
	// 前置校验：这时候确实没有 AI 复核
	for _, s := range base {
		if s.Key == qaSecAIReview {
			t.Fatal("前置条件不成立：构造的模板里不该有 AI 复核")
		}
	}

	ov := qaOvFromJSON(t, `{"sections":[{"key":"ai_review","enabled":true}]}`)
	out := qaApplyReportOverride(base, ov)

	var keys []string
	for _, s := range out {
		keys = append(keys, s.Key)
	}
	ai := -1
	for i, s := range out {
		if s.Key == qaSecAIReview {
			ai = i
		}
	}
	if ai < 0 {
		t.Fatalf("任务要求输出 AI 复核，模板里没有这一节时被静默忽略了（实际章节：%v）", keys)
	}
	// 按目录补出来的章节要带上默认标题与默认选项，不能是空壳
	if out[ai].Title == "" {
		t.Fatal("补出来的 AI 复核没有默认标题")
	}
	if out[ai].Opts.ShowConfidence == nil {
		t.Fatal("补出来的 AI 复核没有默认选项（show_confidence 应为目录默认 true）")
	}
	// 概览是报告抬头统计，补出来的章节不能插到它前面
	if out[0].Key != qaSecOverview {
		t.Fatalf("补出来的章节插到了概览之前，报告开头结构被破坏（首节=%s）", out[0].Key)
	}
	// 原有章节不能被搞丢
	if len(out) != len(base)+1 {
		t.Fatalf("补章节时丢了原有章节：期望 %d 节，实际 %d 节（%v）", len(base)+1, len(out), keys)
	}
}

/* ── ⑩ 模板整体关掉某章节后，任务仍能把它要回来（走渲染层）──────────── */

func TestQAReportOverrideResurrectsDisabledTemplateSection(t *testing.T) {
	// 给这一节换个只可能是它自己的标题：概览里本来就有「AI 复核：N 条」这类
	// 统计字样，拿默认标题做断言会误判。
	const marker = "智能复核小节"
	content := qaTestTemplate("cn", func(secs []qaTemplateSection) []qaTemplateSection {
		qaTestSetSection(secs, qaSecAIReview, func(s *qaTemplateSection) {
			s.Enabled = false
			s.Title = marker
		})
		return secs
	})
	audit := qaTestAudit()

	_, base := qaRenderBoth(t, content, audit, nil)
	if strings.Contains(base, marker) {
		t.Fatal("前置条件不成立：模板已关掉这一节")
	}

	ov := qaOvFromJSON(t, `{"sections":[{"key":"ai_review","enabled":true}]}`)
	_, html := qaRenderBoth(t, content, audit, &qaSelection{Override: ov})
	if !strings.Contains(html, marker) {
		t.Fatal("任务把模板关掉的章节打开了，报告里还是没有这一节")
	}
	if strings.Index(html, "总规则数") > strings.Index(html, marker) {
		t.Fatal("这一节出现在概览之前，报告开头结构被破坏")
	}

	// 反向：模板开着，任务关掉
	content2 := qaTestTemplate("cn", func(secs []qaTemplateSection) []qaTemplateSection {
		qaTestSetSection(secs, qaSecAIReview, func(s *qaTemplateSection) { s.Title = marker })
		return secs
	})
	_, base2 := qaRenderBoth(t, content2, audit, nil)
	if !strings.Contains(base2, marker) {
		t.Fatal("前置条件不成立：模板里这一节应是开着的")
	}
	off := qaOvFromJSON(t, `{"sections":[{"key":"ai_review","enabled":false}]}`)
	_, html2 := qaRenderBoth(t, content2, audit, &qaSelection{Override: off})
	if strings.Contains(html2, marker) {
		t.Fatal("任务把这一节关掉了，报告里还有它")
	}
}

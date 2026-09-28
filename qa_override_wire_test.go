package main

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

/* ===========================================================================
 * 任务级报告覆盖层 —— 真实入口类型防线
 *
 * 事故背景（端到端实操抓出来的，Go 单测全绿但线上功能不通）：
 *   POST /api/v1/quality-audit/schedules 的请求字段 report_overrides 是
 *   json.RawMessage。而 parseQAReportOverride 的 type switch 只认
 *   string / map[string]interface{} / *qaReportOverride，漏了 json.RawMessage
 *   → 不匹配任何 case → 静默 return nil。
 *
 *   表现：前端提示「这份任务对 1 个章节做了单独设置」、保存也回成功，
 *   但落库 report_overrides 为空，任务执行出的报告照旧按模板出。
 *   旧单测只喂 string/map/struct，所以全绿——测了逻辑，没测接线。
 *
 * 本文件专门钉住「handler 真正传进来的那个类型」。
 * =========================================================================== */

func qaResolveRaw(t *testing.T, payload string) *qaReportOverride {
	t.Helper()
	ov, err := qaResolveReportOverride(json.RawMessage(payload))
	if err != nil {
		t.Fatalf("解析 %s 失败: %v", payload, err)
	}
	return ov
}

// 核心防线：json.RawMessage 入口必须能解析出覆盖层。
func TestQAResolveReportOverrideAcceptsRawMessage(t *testing.T) {
	ov := qaResolveRaw(t, `{"sections":[{"key":"item_fill","enabled":false}]}`)
	if ov == nil || ov.empty() {
		t.Fatal("json.RawMessage 入口解析为空 —— 任务级覆盖会在保存时被静默丢弃（历史事故根因）")
	}
	if len(ov.Sections) != 1 || ov.Sections[0].Key != qaSecItemFill {
		t.Fatalf("章节没解析对: %+v", ov.Sections)
	}
	if ov.Sections[0].Enabled == nil {
		t.Fatal("enabled 丢了：三态语义被破坏")
	}
	if *ov.Sections[0].Enabled {
		t.Fatal("enabled=false 被当成 true（显式关闭失效）")
	}
}

// 落库往返：解析出来的覆盖层序列化后必须非空，且能再读回同样的内容。
func TestQAResolveReportOverrideSurvivesPersistRoundTrip(t *testing.T) {
	ov := qaResolveRaw(t, `{"sections":[{"key":"item_fill","enabled":false},{"key":"rules","title":"核查明细"}]}`)
	stored := qaReportOverrideString(ov)
	if strings.TrimSpace(stored) == "" {
		t.Fatal("序列化落库为空 —— 报告生成时读不到覆盖")
	}
	if !strings.Contains(stored, qaSecItemFill) {
		t.Fatalf("落库 JSON 丢了章节键: %s", stored)
	}
	// 读路径：老库/新库都是 TEXT 列，读回来再解析
	back := parseQAReportOverride(stored)
	if !reflect.DeepEqual(ov, back) {
		t.Fatalf("往返不一致:\n 写=%+v\n 读=%+v", ov, back)
	}
}

// null / 空串 / {} 一律语义 = 清空覆盖，回到「完全跟随模板」，不能报错。
func TestQAResolveReportOverrideNullMeansFollowTemplate(t *testing.T) {
	for _, payload := range []string{"null", "{}", `{"sections":[]}`} {
		ov, err := qaResolveReportOverride(json.RawMessage(payload))
		if err != nil {
			t.Fatalf("%s 不该报错: %v", payload, err)
		}
		if !ov.empty() {
			t.Fatalf("%s 应该解析为「无覆盖」，得到 %+v", payload, ov)
		}
	}
	// 完全没有该键（老前端 / 老任务）
	ov, err := qaResolveReportOverride(nil)
	if err != nil || !ov.empty() {
		t.Fatalf("缺键应视作无覆盖，得到 ov=%+v err=%v", ov, err)
	}
	// 空字符串（老库补列后的默认值）
	ov2 := parseQAReportOverride("")
	if !ov2.empty() {
		t.Fatalf("空字符串应视作无覆盖，得到 %+v", ov2)
	}
}

// 各入口类型对同一 payload 必须给出一致结果（string / []byte / RawMessage / map）。
func TestParseQAReportOverrideEntryTypeParity(t *testing.T) {
	const payload = `{"sections":[{"key":"item_fill","enabled":false}]}`
	var asMap map[string]interface{}
	if err := json.Unmarshal([]byte(payload), &asMap); err != nil {
		t.Fatal(err)
	}
	want := qaResolveRaw(t, payload)
	got := []struct {
		name string
		ov   *qaReportOverride
	}{
		{"[]byte", parseQAReportOverride([]byte(payload))},
		{"string", parseQAReportOverride(payload)},
		{"map[string]interface{}", parseQAReportOverride(asMap)},
	}
	for _, g := range got {
		if !reflect.DeepEqual(want, g.ov) {
			t.Errorf("%s 入口与 json.RawMessage 结果不一致:\n want=%+v\n got =%+v", g.name, want, g.ov)
		}
	}
}

// 未知章节键必须被 compact 丢掉（否则前端笔误会污染报告），但不能整份覆盖都丢。
func TestQAResolveReportOverrideDropsUnknownSectionOnly(t *testing.T) {
	ov := qaResolveRaw(t, `{"sections":[{"key":"no_such_section","enabled":false},{"key":"item_fill","enabled":false}]}`)
	if ov == nil {
		t.Fatal("整份覆盖被丢光了：未知章节不该带走已知章节（RawMessage 入口回归？）")
	}
	if len(ov.Sections) != 1 || ov.Sections[0].Key != qaSecItemFill {
		t.Fatalf("未知章节应被丢掉、已知章节应保留，得到 %+v", ov.Sections)
	}
}

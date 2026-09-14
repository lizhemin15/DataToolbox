package main

import (
	"testing"
	"time"
)

func qaMustTime(s string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", s, time.Local)
	if err != nil {
		panic(err)
	}
	return t
}

func TestQACronParseInvalid(t *testing.T) {
	cases := []string{
		"",
		"* * * *",
		"* * * * * *",
		"60 * * * *",
		"* 24 * * *",
		"* * 0 * *",
		"* * * 13 *",
		"* * * * 8",
		"*/0 * * * *",
		"a * * * *",
	}
	for _, c := range cases {
		if _, err := qaCronParse(c); err == nil {
			t.Errorf("qaCronParse(%q) 期望报错，实际通过", c)
		}
	}
}

func TestQACronNextBasic(t *testing.T) {
	// 跨天：每天 08:30，从当天 08:31 跳到次日 08:30
	spec, err := qaCronParse("30 8 * * *")
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	got := spec.Next(qaMustTime("2026-03-10 08:31"))
	want := qaMustTime("2026-03-11 08:30")
	if !got.Equal(want) {
		t.Errorf("跨天 Next = %v, 期望 %v", got, want)
	}

	// 同一天内：当前 08:00，下一个 08:30
	got = spec.Next(qaMustTime("2026-03-10 08:00"))
	want = qaMustTime("2026-03-10 08:30")
	if !got.Equal(want) {
		t.Errorf("同日 Next = %v, 期望 %v", got, want)
	}
}

func TestQACronNextCrossMonth(t *testing.T) {
	// 每月 1 日 00:00，从 3 月 15 日跳到 4 月 1 日
	spec, err := qaCronParse("0 0 1 * *")
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	got := spec.Next(qaMustTime("2026-03-15 10:00"))
	want := qaMustTime("2026-04-01 00:00")
	if !got.Equal(want) {
		t.Errorf("跨月 Next = %v, 期望 %v", got, want)
	}

	// 月份字段受限：每年 4 月 1 日，从 3 月跳
	spec2, err := qaCronParse("0 0 1 4 *")
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	got = spec2.Next(qaMustTime("2026-03-15 10:00"))
	want = qaMustTime("2026-04-01 00:00")
	if !got.Equal(want) {
		t.Errorf("跨月(限月) Next = %v, 期望 %v", got, want)
	}
}

func TestQACronNextWeekday(t *testing.T) {
	// 每周一 02:30。2026-03-10 是周二，下一个周一应为 2026-03-16
	spec, err := qaCronParse("30 2 * * 1")
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	got := spec.Next(qaMustTime("2026-03-10 10:00"))
	want := qaMustTime("2026-03-16 02:30")
	if !got.Equal(want) {
		t.Errorf("星期匹配 Next = %v, 期望 %v", got, want)
	}

	// 周日既可用 0 也可用 7
	spec7, err := qaCronParse("0 9 * * 7")
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	spec0, err := qaCronParse("0 9 * * 0")
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	a := spec7.Next(qaMustTime("2026-03-10 10:00"))
	b := spec0.Next(qaMustTime("2026-03-10 10:00"))
	if !a.Equal(b) {
		t.Errorf("周日 7 与 0 结果不一致: %v vs %v", a, b)
	}
	if a.Weekday() != time.Sunday {
		t.Errorf("周日匹配结果星期错误: %v", a.Weekday())
	}
}

func TestQACronNextStep(t *testing.T) {
	// 每 6 小时：0 */6 * * *，从 07:00 下一个 12:00
	spec, err := qaCronParse("0 */6 * * *")
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	got := spec.Next(qaMustTime("2026-03-10 07:00"))
	want := qaMustTime("2026-03-10 12:00")
	if !got.Equal(want) {
		t.Errorf("*/n 小时 Next = %v, 期望 %v", got, want)
	}

	// 每 30 分钟
	spec2, err := qaCronParse("*/30 * * * *")
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	got = spec2.Next(qaMustTime("2026-03-10 07:10"))
	want = qaMustTime("2026-03-10 07:30")
	if !got.Equal(want) {
		t.Errorf("每 30 分钟 Next = %v, 期望 %v", got, want)
	}

	// 每分钟
	spec3, err := qaCronParse("* * * * *")
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	got = spec3.Next(qaMustTime("2026-03-10 07:10"))
	want = qaMustTime("2026-03-10 07:11")
	if !got.Equal(want) {
		t.Errorf("每分钟 Next = %v, 期望 %v", got, want)
	}
}

func TestQACronNextRangeAndList(t *testing.T) {
	// 工作日（周一至周五）09:00，周五执行后应跳到下周一
	spec, err := qaCronParse("0 9 * * 1-5")
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	// 2026-03-13 是周五
	got := spec.Next(qaMustTime("2026-03-13 09:30"))
	want := qaMustTime("2026-03-16 09:00")
	if !got.Equal(want) {
		t.Errorf("工作日 Next = %v, 期望 %v", got, want)
	}

	// 列表：每天 6 点和 18 点
	spec2, err := qaCronParse("0 6,18 * * *")
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	got = spec2.Next(qaMustTime("2026-03-10 10:00"))
	want = qaMustTime("2026-03-10 18:00")
	if !got.Equal(want) {
		t.Errorf("列表 Next = %v, 期望 %v", got, want)
	}
}

func TestQACronDescribe(t *testing.T) {
	cases := []struct {
		expr string
		want string
	}{
		{"* * * * *", "每分钟"},
		{"*/30 * * * *", "每 30 分钟"},
		{"0 */6 * * *", "每 6 小时"},
		{"0 8 * * *", "每天 08:00"},
		{"30 2 * * 1", "每周一 02:30"},
		{"0 9 * * 1-5", "每周一至周五 09:00"},
		{"0 6,18 * * *", "0 6,18 * * *"}, // 列表形态兜底原样
		{"0 0 1 * *", "每月 1 日 00:00"},
		{"0 0 1 4 *", "每年 4 月 1 日 00:00"},
		{"0 * * * *", "每小时整点"},
	}
	for _, c := range cases {
		got := qaCronDescribe(c.expr)
		if got != c.want {
			t.Errorf("qaCronDescribe(%q) = %q, 期望 %q", c.expr, got, c.want)
		}
	}
}

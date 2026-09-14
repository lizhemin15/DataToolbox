package main

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// 本文件自行实现标准 5 段 cron 解析（分 时 日 月 周），不引入第三方依赖。
// 支持语法：*、n、a-b、*/n、a-b/n、a/n 以及逗号列表；周日可用 0 或 7。
// 时区统一按 time.Local（服务器通常为 Asia/Shanghai）。

type qaCronField struct {
	min    int    // 该字段允许的最小值
	values []bool // values[v-min] == true 表示 v 命中
	star   bool   // 字段是否恰为 "*"（用于「日/周」的 OR 语义判断）
}

func (f *qaCronField) match(v int) bool {
	if v < f.min {
		return false
	}
	idx := v - f.min
	if idx < 0 || idx >= len(f.values) {
		return false
	}
	return f.values[idx]
}

// count 返回命中的取值个数；single 在恰好命中一个取值时返回其值。
func (f *qaCronField) count() int {
	n := 0
	for _, b := range f.values {
		if b {
			n++
		}
	}
	return n
}

func (f *qaCronField) single() (int, bool) {
	if f.count() != 1 {
		return 0, false
	}
	for i, b := range f.values {
		if b {
			return i + f.min, true
		}
	}
	return 0, false
}

// qaCronSpec 解析后的 cron 表达式
type qaCronSpec struct {
	raw   string
	minute qaCronField
	hour   qaCronField
	dom    qaCronField
	month  qaCronField
	dow    qaCronField
}

func qaCronParseField(s string, min, max int) (qaCronField, error) {
	f := qaCronField{min: min, values: make([]bool, max-min+1)}
	s = strings.TrimSpace(s)
	if s == "" {
		return f, fmt.Errorf("字段为空")
	}
	if s == "*" {
		f.star = true
		for i := range f.values {
			f.values[i] = true
		}
		return f, nil
	}
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			return f, fmt.Errorf("列表中存在空项")
		}

		step := 1
		rangePart := part
		hasStep := false
		if idx := strings.Index(part, "/"); idx >= 0 {
			hasStep = true
			rangePart = strings.TrimSpace(part[:idx])
			stepStr := strings.TrimSpace(part[idx+1:])
			st, err := strconv.Atoi(stepStr)
			if err != nil || st <= 0 {
				return f, fmt.Errorf("步长无效: %s", part)
			}
			step = st
		}

		start, end := min, max
		switch {
		case rangePart == "*":
			// 全范围（可带步长）
		case strings.Contains(rangePart, "-"):
			idx := strings.Index(rangePart, "-")
			a, err1 := strconv.Atoi(strings.TrimSpace(rangePart[:idx]))
			b, err2 := strconv.Atoi(strings.TrimSpace(rangePart[idx+1:]))
			if err1 != nil || err2 != nil {
				return f, fmt.Errorf("范围无效: %s", part)
			}
			start, end = a, b
		default:
			n, err := strconv.Atoi(rangePart)
			if err != nil {
				return f, fmt.Errorf("取值无效: %s", part)
			}
			if hasStep {
				start, end = n, max
			} else {
				start, end = n, n
			}
		}

		if start < min || end > max || start > end {
			return f, fmt.Errorf("取值超出范围 [%d,%d]: %s", min, max, part)
		}
		for v := start; v <= end; v += step {
			f.values[v-min] = true
		}
	}
	return f, nil
}

// qaCronParse 解析 5 段 cron 表达式
func qaCronParse(expr string) (*qaCronSpec, error) {
	fields := strings.Fields(strings.TrimSpace(expr))
	if len(fields) != 5 {
		return nil, fmt.Errorf("cron 表达式需为 5 段（分 时 日 月 周）")
	}
	spec := &qaCronSpec{raw: strings.TrimSpace(expr)}
	var err error
	if spec.minute, err = qaCronParseField(fields[0], 0, 59); err != nil {
		return nil, fmt.Errorf("分钟字段: %v", err)
	}
	if spec.hour, err = qaCronParseField(fields[1], 0, 23); err != nil {
		return nil, fmt.Errorf("小时字段: %v", err)
	}
	if spec.dom, err = qaCronParseField(fields[2], 1, 31); err != nil {
		return nil, fmt.Errorf("日字段: %v", err)
	}
	if spec.month, err = qaCronParseField(fields[3], 1, 12); err != nil {
		return nil, fmt.Errorf("月字段: %v", err)
	}
	if spec.dow, err = qaCronParseField(fields[4], 0, 7); err != nil {
		return nil, fmt.Errorf("周字段: %v", err)
	}
	// 周日既可为 0 也可为 7，统一映射到 0
	if len(spec.dow.values) > 7 && spec.dow.values[7] {
		spec.dow.values[0] = true
	}
	return spec, nil
}

// dayMatches 标准 cron 语义：日、周字段都受限时取「或」，否则取「与」。
func (s *qaCronSpec) dayMatches(t time.Time) bool {
	domOK := s.dom.match(t.Day())
	dowOK := s.dow.match(int(t.Weekday()))
	if !s.dom.star && !s.dow.star {
		return domOK || dowOK
	}
	return domOK && dowOK
}

// Next 返回 strictly greater than from 的下一个命中时间（精确到分钟，按 time.Local）。
// 若 10 年内无命中（如 2 月 30 日）返回零值。
func (s *qaCronSpec) Next(from time.Time) time.Time {
	if s == nil {
		return time.Time{}
	}
	t := from.Truncate(time.Minute).Add(time.Minute)
	limit := from.AddDate(10, 0, 0)
	for t.Before(limit) {
		if !s.month.match(int(t.Month())) {
			t = time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, t.Location()).AddDate(0, 1, 0)
			continue
		}
		if !s.dayMatches(t) {
			t = time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location()).AddDate(0, 0, 1)
			continue
		}
		if !s.hour.match(t.Hour()) {
			t = time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), 0, 0, 0, t.Location()).Add(time.Hour)
			continue
		}
		if !s.minute.match(t.Minute()) {
			t = t.Add(time.Minute)
			continue
		}
		return t
	}
	return time.Time{}
}

var qaCronWeekdayNames = []string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}

func qaCronWeekdayName(v int) string {
	if v == 7 {
		v = 0
	}
	if v < 0 || v >= len(qaCronWeekdayNames) {
		return ""
	}
	return qaCronWeekdayNames[v]
}

func qaCronFixedPrefix(field string) (string, bool) {
	field = strings.TrimSpace(field)
	if strings.HasPrefix(field, "*/") {
		return field, true
	}
	return "", false
}

// qaCronDescribe 返回中文可读描述；无法识别的形态兜底返回原表达式。
func qaCronDescribe(expr string) string {
	raw := strings.TrimSpace(expr)
	spec, err := qaCronParse(raw)
	if err != nil {
		return raw
	}
	f := strings.Fields(raw)
	restStar := f[1] == "*" && f[2] == "*" && f[3] == "*" && f[4] == "*"

	// 每分钟 / 每 N 分钟
	if f[0] == "*" && restStar {
		return "每分钟"
	}
	if step, ok := qaCronFixedPrefix(f[0]); ok && restStar {
		return "每 " + step[2:] + " 分钟"
	}

	// 每 N 小时（分固定时）
	if f[2] == "*" && f[3] == "*" && f[4] == "*" {
		if step, ok := qaCronFixedPrefix(f[1]); ok {
			m, _ := spec.minute.single()
			if m == 0 {
				return "每 " + step[2:] + " 小时"
			}
			return fmt.Sprintf("每 %s 小时的第 %d 分", step[2:], m)
		}
		if f[1] == "*" {
			if m, ok := spec.minute.single(); ok {
				if m == 0 {
					return "每小时整点"
				}
				return fmt.Sprintf("每小时第 %d 分", m)
			}
		}
	}

	m, mOK := spec.minute.single()
	h, hOK := spec.hour.single()
	if mOK && hOK {
		timeText := fmt.Sprintf("%02d:%02d", h, m)

		// 每周 / 每周一至周五
		if f[2] == "*" && f[3] == "*" && f[4] != "*" {
			if w, ok := spec.dow.single(); ok {
				return "每" + qaCronWeekdayName(w) + " " + timeText
			}
			if a, b, ok := qaCronDowRange(f[4]); ok {
				return "每" + qaCronWeekdayName(a) + "至" + qaCronWeekdayName(b) + " " + timeText
			}
		}
		// 每天
		if f[2] == "*" && f[3] == "*" && f[4] == "*" {
			return "每天 " + timeText
		}
		// 每月 D 日
		if d, ok := spec.dom.single(); ok && f[3] == "*" && f[4] == "*" {
			return fmt.Sprintf("每月 %d 日 %s", d, timeText)
		}
		// 每年 M 月 D 日
		if d, ok := spec.dom.single(); ok {
			if mo, ok2 := spec.month.single(); ok2 && f[4] == "*" {
				return fmt.Sprintf("每年 %d 月 %d 日 %s", mo, d, timeText)
			}
		}
		// 每月最后一天之外的常见形态兜底：日期+周同时受限
	}
	return raw
}

// qaCronDowRange 解析形如 "1-5" 的周范围，返回起止值（0-7）。
func qaCronDowRange(field string) (int, int, bool) {
	field = strings.TrimSpace(field)
	if !strings.Contains(field, "-") || strings.Contains(field, ",") || strings.Contains(field, "/") {
		return 0, 0, false
	}
	idx := strings.Index(field, "-")
	a, err1 := strconv.Atoi(strings.TrimSpace(field[:idx]))
	b, err2 := strconv.Atoi(strings.TrimSpace(field[idx+1:]))
	if err1 != nil || err2 != nil || a < 0 || a > 7 || b < 0 || b > 7 || a > b {
		return 0, 0, false
	}
	return a, b, true
}

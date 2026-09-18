package main

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// 流式 AI 补全的报错必须是人话：历史上前端会把 http.Client 的
// 「context deadline exceeded」原样弹给用户，既看不懂也不知道怎么办。
func TestFriendlyAIStreamError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"空错误", nil, ""},
		{"context 超时", context.DeadlineExceeded, "AI 响应超时，可重试或换更快的模型"},
		{"字符串形式的超时", errors.New("Post \"http://x\": context deadline exceeded"), "AI 响应超时，可重试或换更快的模型"},
		{"客户端超时", errors.New("net/http: Client.Timeout exceeded while awaiting headers"), "AI 响应超时，可重试或换更快的模型"},
		{"用户取消", context.Canceled, "AI 调用已取消"},
		{"其它错误带原文", errors.New("connection refused"), "AI 调用失败: connection refused"},
	}
	for _, c := range cases {
		got := friendlyAIStreamError(c.err)
		if got != c.want {
			t.Errorf("%s: 期望 %q，实际 %q", c.name, c.want, got)
		}
		if c.err != nil && strings.Contains(got, "context deadline exceeded") {
			t.Errorf("%s: 原始超时报错泄漏到前端提示：%q", c.name, got)
		}
	}
}

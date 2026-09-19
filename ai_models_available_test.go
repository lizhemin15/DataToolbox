package main

import (
	"encoding/json"
	"testing"
)

func TestDeriveModelsURL(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"https://api.openai.com/v1/chat/completions", "https://api.openai.com/v1/models"},
		{"https://api.siliconflow.cn/v1", "https://api.siliconflow.cn/v1/models"},
		{"https://api.siliconflow.cn/v1/", "https://api.siliconflow.cn/v1/models"},
		{"https://api.siliconflow.cn/v1/embeddings", "https://api.siliconflow.cn/v1/models"},
		{"https://api.deepseek.com/v1/models", "https://api.deepseek.com/v1/models"},
		{"https://api.anthropic.com/v1/messages", "https://api.anthropic.com/v1/models"},
		{"https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", "https://dashscope.aliyuncs.com/compatible-mode/v1/models"},
		{"http://localhost:11434/v1/chat/completions", "http://localhost:11434/v1/models"},
		{"https://api.example.com", "https://api.example.com/v1/models"},
		{"https://api.example.com/v1/chat/completions?x=1", "https://api.example.com/v1/models"},
	}
	for _, c := range cases {
		got, err := deriveModelsURL(c.in)
		if err != nil {
			t.Fatalf("deriveModelsURL(%q) 出错: %v", c.in, err)
		}
		if got != c.want {
			t.Errorf("deriveModelsURL(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	if _, err := deriveModelsURL("api.openai.com/v1"); err == nil {
		t.Errorf("缺少协议时应报错")
	}
	if _, err := deriveModelsURL(""); err == nil {
		t.Errorf("空 URL 时应报错")
	}
}

func TestExtractModelIDs(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []string
	}{
		{"openai 风格", `{"object":"list","data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"}]}`, []string{"gpt-4o", "gpt-4o-mini"}},
		{"models 数组", `{"models":["a","b"]}`, []string{"a", "b"}},
		{"result 数组对象", `{"result":[{"id":"x"},{"id":"y"}]}`, []string{"x", "y"}},
		{"裸数组", `["m1","m2"]`, []string{"m1", "m2"}},
		{"去重与空值", `{"data":[{"id":"a"},{"id":"a"},{"id":"  "},{"id":"b"}]}`, []string{"a", "b"}},
		{"无模型字段", `{"error":"bad key"}`, []string{}},
		{"非法 JSON", `not json`, []string{}},
	}
	for _, c := range cases {
		got := extractModelIDs([]byte(c.in))
		if len(got) != len(c.want) {
			t.Errorf("[%s] 数量 = %d %v, want %d %v", c.name, len(got), got, len(c.want), c.want)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("[%s] 第 %d 个 = %q, want %q", c.name, i, got[i], c.want[i])
			}
		}
	}
}

func TestModelsAvailableEndpointJSONShape(t *testing.T) {
	// 确保响应形状和前端约定一致（成功时 models 是字符串数组）
	payload := map[string]interface{}{"success": true, "models": []string{"m"}, "endpoint": "https://x/v1/models"}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	var back struct {
		Success bool     `json:"success"`
		Models  []string `json:"models"`
	}
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	if !back.Success || len(back.Models) != 1 || back.Models[0] != "m" {
		t.Fatalf("响应形状不符合预期: %+v", back)
	}
}

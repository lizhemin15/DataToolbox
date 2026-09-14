package main

import (
	"strings"
	"testing"
)

// qaWithLLMGlobals 临时替换全局模型配置，测试结束后恢复。
func qaWithLLMGlobals(t *testing.T, models map[string]*LLMModelConfig, ai *AIConfig, fn func()) {
	t.Helper()
	oldModels, oldAI := llmModels, dataOntologyAIConfig
	defer func() { llmModels, dataOntologyAIConfig = oldModels, oldAI }()
	llmModels = models
	dataOntologyAIConfig = ai
	fn()
}

// 未单独配置 llm_models 时，回退复用智能助手（ai_config）的模型。
func TestQAPickLLMModelFallsBackToAssistant(t *testing.T) {
	qaWithLLMGlobals(t, map[string]*LLMModelConfig{}, &AIConfig{
		URL:    "https://api.siliconflow.cn/v1",
		APIKey: "sk-test-key",
		Model:  "Qwen/Qwen3-30B-A3B-Instruct-2507",
	}, func() {
		got := qaPickLLMModel()
		if got == nil {
			t.Fatal("期望回退到智能助手模型，实际为 nil")
		}
		if got.URL != "https://api.siliconflow.cn/v1" {
			t.Errorf("URL 错误: %q", got.URL)
		}
		if got.APIKey != "sk-test-key" {
			t.Errorf("APIKey 未透传: %q", got.APIKey)
		}
		if got.Model != "Qwen/Qwen3-30B-A3B-Instruct-2507" {
			t.Errorf("Model 错误: %q", got.Model)
		}
		if got.Name == "" {
			t.Error("Name 不应为空（报告/摘要里要显示模型名）")
		}
		if !got.Enabled {
			t.Error("回退模型应为 enabled，否则会被后续逻辑过滤")
		}
	})
}

// 已单独配置 llm_models 时，优先级高于智能助手配置（不回归）。
func TestQAPickLLMModelPrefersConfiguredModels(t *testing.T) {
	models := map[string]*LLMModelConfig{
		"m1": {
			ID: "m1", Name: "自建模型", Type: "llm",
			URL: "https://self.example.com/v1", APIKey: "k1",
			Model: "self-model", Enabled: true, CreatedAt: "2026-01-01T00:00:00+08:00",
		},
	}
	qaWithLLMGlobals(t, models, &AIConfig{
		URL: "https://api.siliconflow.cn/v1", APIKey: "sk-ai", Model: "assistant-model",
	}, func() {
		got := qaPickLLMModel()
		if got == nil {
			t.Fatal("期望返回已配置模型，实际为 nil")
		}
		if got.ID != "m1" {
			t.Errorf("应优先使用 llm_models，实际 ID=%q", got.ID)
		}
	})
}

// 已停用的 llm_models 不应被选中，此时回退智能助手。
func TestQAPickLLMModelSkipsDisabled(t *testing.T) {
	models := map[string]*LLMModelConfig{
		"off": {
			ID: "off", Name: "停用模型", Type: "llm",
			URL: "https://off.example.com/v1", APIKey: "k", Model: "off", Enabled: false,
		},
	}
	qaWithLLMGlobals(t, models, &AIConfig{
		URL: "https://api.siliconflow.cn/v1", APIKey: "sk-ai", Model: "assistant-model",
	}, func() {
		got := qaPickLLMModel()
		if got == nil {
			t.Fatal("期望回退到智能助手模型，实际为 nil")
		}
		if got.ID != "assistant-ai-config" {
			t.Errorf("应跳过停用模型，实际 ID=%q", got.ID)
		}
	})
}

// 两者都没有（或智能助手配置不完整）时返回 nil，由调用方给出跳过原因。
func TestQAPickLLMModelNilWhenNothingUsable(t *testing.T) {
	cases := []struct {
		name string
		ai   *AIConfig
	}{
		{"智能助手未配置", nil},
		{"缺 URL", &AIConfig{APIKey: "k", Model: "m"}},
		{"缺 APIKey", &AIConfig{URL: "https://x/v1", Model: "m"}},
		{"缺 Model", &AIConfig{URL: "https://x/v1", APIKey: "k"}},
	}
	for _, c := range cases {
		qaWithLLMGlobals(t, map[string]*LLMModelConfig{}, c.ai, func() {
			if got := qaPickLLMModel(); got != nil {
				t.Errorf("%s: 期望 nil，实际 %+v", c.name, got)
			}
		})
	}
}

func TestQAGuessLLMProvider(t *testing.T) {
	cases := map[string]string{
		"https://api.siliconflow.cn/v1":                          "openai",
		"https://api.openai.com/v1":                              "openai",
		"https://generativelanguage.googleapis.com/v1beta":       "gemini",
		"https://api.anthropic.com/v1":                           "anthropic",
		"HTTPS://GENERATIVELANGUAGE.GOOGLEAPIS.COM/v1beta":       "gemini",
	}
	for url, want := range cases {
		if got := qaGuessLLMProvider(url); got != want {
			t.Errorf("qaGuessLLMProvider(%q) = %q, 期望 %q", url, got, want)
		}
	}
}

// 回退模型能真正驱动 qaCallLLMChat 的请求构造（模型名取自 Model 字段）。
func TestQAQaCallLLMRequestShape(t *testing.T) {
	qaWithLLMGlobals(t, map[string]*LLMModelConfig{}, &AIConfig{
		URL: "https://api.siliconflow.cn/v1/", APIKey: "sk-ai", Model: "Qwen/Qwen3-30B",
	}, func() {
		cfg := qaPickLLMModel()
		if cfg == nil {
			t.Fatal("期望回退模型非空")
		}
		if endpoint := getAIEndpoint(cfg.URL); endpoint != "https://api.siliconflow.cn/v1/chat/completions" {
			t.Errorf("endpoint 拼接错误: %q", endpoint)
		}
		if strings.TrimSpace(cfg.Model) == "" {
			t.Error("Model 不能为空，否则请求体会用空 model")
		}
	})
}

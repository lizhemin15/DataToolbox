package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// handleAIModelsAvailable 拉取上游「OpenAI 兼容」的模型列表，供前端「自动获取模型」用。
//
//	POST /api/v1/agent/models/available
//	body: {"url":"https://api.siliconflow.cn/v1", "api_key":"sk-..."}   // 都可省略，省略时用已保存的 AI 配置
//
// 说明：不同厂商的模型清单接口路径不统一，这里做兼容推导：
//   - .../v1/chat/completions  → .../v1/models
//   - .../v1/embeddings        → .../v1/models
//   - .../v1                   → .../v1/models
//
// 返回 {"success":true,"models":["Qwen/Qwen3-30B-A3B-Instruct-2507", ...]}
func handleAIModelsAvailable(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	writeErr := func(msg string) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": msg})
	}
	if r.Method != http.MethodPost {
		writeErr("不支持的方法")
		return
	}
	if _, ok := getDataOntologyUserFromRequest(r); !ok {
		writeErr("未授权")
		return
	}

	var body struct {
		URL    string `json:"url"`
		APIKey string `json:"api_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr("请求格式错误")
		return
	}

	rawURL := strings.TrimSpace(body.URL)
	apiKey := strings.TrimSpace(body.APIKey)
	// 没传的字段回退到已保存的 AI 配置（例如向量模型留空 Key 时沿用主 Key）
	if dataOntologyAIConfig != nil {
		if rawURL == "" {
			rawURL = strings.TrimSpace(dataOntologyAIConfig.URL)
		}
		if apiKey == "" {
			apiKey = strings.TrimSpace(dataOntologyAIConfig.APIKey)
		}
	}
	if rawURL == "" {
		writeErr("请先填写 AI 服务 URL")
		return
	}

	modelsURL, err := deriveModelsURL(rawURL)
	if err != nil {
		writeErr("URL 格式不正确：" + err.Error())
		return
	}

	req, err := http.NewRequest(http.MethodGet, modelsURL, nil)
	if err != nil {
		writeErr("构造请求失败：" + err.Error())
		return
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeErr("拉取模型列表失败：" + err.Error())
		return
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeErr("上游返回 HTTP " + resp.Status + "：" + truncateForMsg(string(raw), 200))
		return
	}

	models := extractModelIDs(raw)
	if len(models) == 0 {
		writeErr("上游没有返回可用模型（响应：" + truncateForMsg(string(raw), 200) + "）")
		return
	}
	log.Printf("[AI] 拉取模型列表成功：%s（%d 个）", modelsURL, len(models))
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "models": models, "endpoint": modelsURL})
}

// deriveModelsURL 把各种「对话/向量/基础」地址推导成 models 列表地址
func deriveModelsURL(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", err
	}
	if u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("缺少协议或主机名（例如 https://api.openai.com/v1）")
	}
	p := strings.TrimRight(u.Path, "/")
	for _, suffix := range []string{"/chat/completions", "/completions", "/embeddings", "/messages"} {
		if strings.HasSuffix(p, suffix) {
			p = strings.TrimSuffix(p, suffix)
			break
		}
	}
	if strings.HasSuffix(p, "/models") {
		// 已经是 models 地址
	} else if p == "" {
		p = "/v1/models"
	} else {
		p = p + "/models"
	}
	u.Path = p
	u.RawQuery = ""
	u.Fragment = ""
	return u.String(), nil
}

// extractModelIDs 兼容多种响应形状：{data:[{id}]} / {models:[...]} / ["a","b"] / {data:["a"]}
func extractModelIDs(raw []byte) []string {
	out := []string{}
	seen := map[string]bool{}
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		out = append(out, id)
	}

	var generic interface{}
	if err := json.Unmarshal(raw, &generic); err != nil {
		return out
	}
	var walk func(v interface{})
	walk = func(v interface{}) {
		switch t := v.(type) {
		case []interface{}:
			for _, item := range t {
				walk(item)
			}
		case map[string]interface{}:
			for _, key := range []string{"data", "models", "result", "items"} {
				if v2, ok := t[key]; ok {
					walk(v2)
				}
			}
			if id, ok := t["id"].(string); ok {
				add(id)
			}
		case string:
			add(t)
		}
	}
	walk(generic)
	return out
}

func truncateForMsg(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

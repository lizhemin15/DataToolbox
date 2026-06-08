package main

import (
	"bytes"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ============================================================
// 平台管理 CRUD
// ============================================================

// handlePlatforms 处理 /api/v1/platforms 请求
func handlePlatforms(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		listPlatforms(w, r)
	case http.MethodPost:
		createPlatform(w, r)
	default:
		jsonError(w, "不支持的请求方法", "")
	}
}

// handlePlatformDetail 处理 /api/v1/platforms/{id} 请求
func handlePlatformDetail(w http.ResponseWriter, r *http.Request) {
	id := extractPlatformPathSuffix(r.URL.Path)
	if id == "" {
		jsonError(w, "缺少平台 ID", "")
		return
	}

	// 处理 /platforms/{id}/test
	if strings.HasSuffix(id, "/test") {
		id = strings.TrimSuffix(id, "/test")
		if r.Method == http.MethodPost {
			testPlatform(w, r, id)
			return
		}
		jsonError(w, "不支持的请求方法", "")
		return
	}

	switch r.Method {
	case http.MethodGet:
		getPlatform(w, r, id)
	case http.MethodPut:
		updatePlatform(w, r, id)
	case http.MethodDelete:
		deletePlatform(w, r, id)
	default:
		jsonError(w, "不支持的请求方法", "")
	}
}

// handlePlatformApis 处理 /api/v1/platforms/{id}/apis 请求
func handlePlatformApis(w http.ResponseWriter, r *http.Request) {
	pathSuffix := extractPlatformPathSuffix(r.URL.Path)
	parts := strings.SplitN(pathSuffix, "/", 3)
	if len(parts) < 1 || parts[0] == "" {
		jsonError(w, "缺少平台 ID", "")
		return
	}

	platformID := parts[0]

	dataOntologyMu.RLock()
	_, exists := dataOntologyPlatforms[platformID]
	dataOntologyMu.RUnlock()

	if !exists {
		jsonError(w, "平台不存在", "")
		return
	}

	// 判断是 /apis 还是 /apis/{apiId}
	if len(parts) >= 2 && parts[1] == "apis" {
		if len(parts) >= 3 && parts[2] != "" {
			apiID := parts[2]
			handlePlatformApiDetail(w, r, platformID, apiID)
			return
		}
		switch r.Method {
		case http.MethodGet:
			listPlatformApis(w, r, platformID)
		case http.MethodPost:
			createPlatformApi(w, r, platformID)
		default:
			jsonError(w, "不支持的请求方法", "")
		}
		return
	}

	jsonError(w, "无效的路径", "")
}

// ============================================================
// 平台 CRUD 实现
// ============================================================

func listPlatforms(w http.ResponseWriter, r *http.Request) {
	dataOntologyMu.RLock()
	list := make([]*Platform, 0, len(dataOntologyPlatforms))
	for _, p := range dataOntologyPlatforms {
		list = append(list, p)
	}
	dataOntologyMu.RUnlock()

	jsonSuccess(w, map[string]interface{}{
		"success":   true,
		"platforms": list,
	})
}

func createPlatform(w http.ResponseWriter, r *http.Request) {
	var platform Platform
	if err := json.NewDecoder(r.Body).Decode(&platform); err != nil {
		jsonError(w, "解析请求失败: "+err.Error(), "")
		return
	}

	if platform.Name == "" {
		jsonError(w, "平台名称不能为空", "")
		return
	}
	if platform.BaseURL == "" {
		jsonError(w, "Base URL 不能为空", "")
		return
	}
	if _, err := url.Parse(platform.BaseURL); err != nil {
		jsonError(w, "Base URL 格式无效: "+err.Error(), "")
		return
	}

	platform.ID = uuid.New().String()
	now := time.Now()
	platform.CreatedAt = now
	platform.UpdatedAt = now

	if platform.Timeout == 0 {
		platform.Timeout = 30
	}
	if platform.AuthType == "" {
		platform.AuthType = "none"
	}
	if platform.Headers == nil {
		platform.Headers = make(map[string]string)
	}
	if platform.AuthConfig == nil {
		platform.AuthConfig = make(map[string]string)
	}

	applyPlatformAuth(&platform)

	dataOntologyMu.Lock()
	dataOntologyPlatforms[platform.ID] = &platform
	dataOntologyMu.Unlock()

	if err := saveDataOntologyStore(); err != nil {
		log.Printf("[Platform] 保存失败: %v", err)
	}

	log.Printf("[Platform] 创建平台: id=%s name=%s base_url=%s", platform.ID, platform.Name, platform.BaseURL)
	jsonSuccess(w, map[string]interface{}{
		"success":  true,
		"platform": platform,
	})
}

func getPlatform(w http.ResponseWriter, r *http.Request, id string) {
	dataOntologyMu.RLock()
	platform, exists := dataOntologyPlatforms[id]
	dataOntologyMu.RUnlock()

	if !exists {
		jsonError(w, "平台不存在", "")
		return
	}

	dataOntologyMu.RLock()
	apis := make([]*ForwardApiConfig, 0)
	for _, api := range dataOntologyForwardApis {
		if api.PlatformID == id {
			apis = append(apis, api)
		}
	}
	dataOntologyMu.RUnlock()

	jsonSuccess(w, map[string]interface{}{
		"success":  true,
		"platform": platform,
		"apis":     apis,
	})
}

func updatePlatform(w http.ResponseWriter, r *http.Request, id string) {
	dataOntologyMu.Lock()
	platform, exists := dataOntologyPlatforms[id]
	if !exists {
		dataOntologyMu.Unlock()
		jsonError(w, "平台不存在", "")
		return
	}

	var update Platform
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		dataOntologyMu.Unlock()
		jsonError(w, "解析请求失败: "+err.Error(), "")
		return
	}

	if update.Name != "" {
		platform.Name = update.Name
	}
	if update.Description != "" {
		platform.Description = update.Description
	}
	if update.BaseURL != "" {
		if _, err := url.Parse(update.BaseURL); err != nil {
			dataOntologyMu.Unlock()
			jsonError(w, "Base URL 格式无效: "+err.Error(), "")
			return
		}
		platform.BaseURL = update.BaseURL
	}
	if update.AuthType != "" {
		platform.AuthType = update.AuthType
	}
	if update.AuthConfig != nil {
		platform.AuthConfig = update.AuthConfig
	}
	if update.Headers != nil {
		platform.Headers = update.Headers
	}
	if update.Timeout > 0 {
		platform.Timeout = update.Timeout
	}
	if update.TLSVerify != nil {
		platform.TLSVerify = update.TLSVerify
	}

	applyPlatformAuth(platform)
	platform.UpdatedAt = time.Now()
	dataOntologyMu.Unlock()

	if err := saveDataOntologyStore(); err != nil {
		log.Printf("[Platform] 保存失败: %v", err)
	}

	log.Printf("[Platform] 更新平台: id=%s name=%s", platform.ID, platform.Name)
	jsonSuccess(w, map[string]interface{}{
		"success":  true,
		"platform": platform,
	})
}

func deletePlatform(w http.ResponseWriter, r *http.Request, id string) {
	dataOntologyMu.Lock()
	_, exists := dataOntologyPlatforms[id]
	if !exists {
		dataOntologyMu.Unlock()
		jsonError(w, "平台不存在", "")
		return
	}

	// 删除平台下的所有接口
	for apiID, api := range dataOntologyForwardApis {
		if api.PlatformID == id {
			delete(dataOntologyForwardApis, apiID)
		}
	}

	delete(dataOntologyPlatforms, id)
	dataOntologyMu.Unlock()

	if err := saveDataOntologyStore(); err != nil {
		log.Printf("[Platform] 保存失败: %v", err)
	}

	log.Printf("[Platform] 删除平台: id=%s", id)
	jsonSuccess(w, map[string]interface{}{
		"success": true,
		"message": "平台已删除",
	})
}

func testPlatform(w http.ResponseWriter, r *http.Request, id string) {
	dataOntologyMu.RLock()
	platform, exists := dataOntologyPlatforms[id]
	dataOntologyMu.RUnlock()

	if !exists {
		jsonError(w, "平台不存在", "")
		return
	}

	timeout := time.Duration(platform.Timeout) * time.Second
	if timeout == 0 {
		timeout = 10 * time.Second
	}

	testURL := platform.BaseURL
	req, err := http.NewRequest(http.MethodHead, testURL, nil)
	if err != nil {
		jsonSuccess(w, map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("构建请求失败: %v", err),
		})
		return
	}

	for k, v := range platform.Headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{
		Timeout:   timeout,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
	}
	resp, err := client.Do(req)
	if err != nil {
		jsonSuccess(w, map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("连接失败: %v", err),
		})
		return
	}
	resp.Body.Close()

	jsonSuccess(w, map[string]interface{}{
		"success":     true,
		"message":     fmt.Sprintf("连接成功，状态码: %d", resp.StatusCode),
		"status_code": resp.StatusCode,
	})
}

// applyPlatformAuth 根据 auth_type 自动注入 headers
func applyPlatformAuth(p *Platform) {
	if p.Headers == nil {
		p.Headers = make(map[string]string)
	}
	switch p.AuthType {
	case "bearer":
		if token, ok := p.AuthConfig["token"]; ok && token != "" {
			p.Headers["Authorization"] = "Bearer " + token
		}
	case "api_key":
		headerName := "X-API-Key"
		if h, ok := p.AuthConfig["header_name"]; ok && h != "" {
			headerName = h
		}
		if key, ok := p.AuthConfig["api_key"]; ok && key != "" {
			p.Headers[headerName] = key
		}
	case "basic":
		if user, ok := p.AuthConfig["username"]; ok {
			if pass, ok2 := p.AuthConfig["password"]; ok2 {
				p.Headers["Authorization"] = "Basic " + base64.StdEncoding.EncodeToString([]byte(user+":"+pass))
			}
		}
	}
}

// ============================================================
// 转发接口 CRUD 实现
// ============================================================

func listPlatformApis(w http.ResponseWriter, r *http.Request, platformID string) {
	dataOntologyMu.RLock()
	list := make([]*ForwardApiConfig, 0)
	for _, api := range dataOntologyForwardApis {
		if api.PlatformID == platformID {
			list = append(list, api)
		}
	}
	dataOntologyMu.RUnlock()

	jsonSuccess(w, map[string]interface{}{
		"success": true,
		"apis":    list,
	})
}

func createPlatformApi(w http.ResponseWriter, r *http.Request, platformID string) {
	var api ForwardApiConfig
	if err := json.NewDecoder(r.Body).Decode(&api); err != nil {
		jsonError(w, "解析请求失败: "+err.Error(), "")
		return
	}

	if api.Name == "" {
		jsonError(w, "接口名称不能为空", "")
		return
	}
	if api.Suffix == "" {
		jsonError(w, "路径后缀不能为空", "")
		return
	}
	if api.Method == "" {
		api.Method = "GET"
	}

	api.ID = uuid.New().String()
	api.PlatformID = platformID

	if api.Headers == nil {
		api.Headers = make(map[string]string)
	}
	if api.Enabled == nil {
		enabled := true
		api.Enabled = &enabled
	}

	dataOntologyMu.Lock()
	dataOntologyForwardApis[api.ID] = &api
	dataOntologyMu.Unlock()

	if err := saveDataOntologyStore(); err != nil {
		log.Printf("[PlatformAPI] 保存失败: %v", err)
	}

	log.Printf("[PlatformAPI] 创建接口: id=%s name=%s platform=%s suffix=%s", api.ID, api.Name, platformID, api.Suffix)
	jsonSuccess(w, map[string]interface{}{
		"success": true,
		"api":     api,
	})
}

func handlePlatformApiDetail(w http.ResponseWriter, r *http.Request, platformID, apiID string) {
	// 处理 /apis/{apiId}/test
	if strings.HasSuffix(apiID, "/test") {
		apiID = strings.TrimSuffix(apiID, "/test")
		if r.Method == http.MethodPost {
			testPlatformApi(w, r, platformID, apiID)
			return
		}
		jsonError(w, "不支持的请求方法", "")
		return
	}
	switch r.Method {
	case http.MethodGet:
		getPlatformApi(w, r, platformID, apiID)
	case http.MethodPut:
		updatePlatformApi(w, r, platformID, apiID)
	case http.MethodDelete:
		deletePlatformApi(w, r, platformID, apiID)
	default:
		jsonError(w, "不支持的请求方法", "")
	}
}

func getPlatformApi(w http.ResponseWriter, r *http.Request, platformID, apiID string) {
	dataOntologyMu.RLock()
	api, exists := dataOntologyForwardApis[apiID]
	dataOntologyMu.RUnlock()

	if !exists || api.PlatformID != platformID {
		jsonError(w, "接口不存在", "")
		return
	}

	jsonSuccess(w, map[string]interface{}{
		"success": true,
		"api":     api,
	})
}

func updatePlatformApi(w http.ResponseWriter, r *http.Request, platformID, apiID string) {
	dataOntologyMu.Lock()
	api, exists := dataOntologyForwardApis[apiID]
	if !exists || api.PlatformID != platformID {
		dataOntologyMu.Unlock()
		jsonError(w, "接口不存在", "")
		return
	}

	var update ForwardApiConfig
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		dataOntologyMu.Unlock()
		jsonError(w, "解析请求失败: "+err.Error(), "")
		return
	}

	if update.Name != "" {
		api.Name = update.Name
	}
	if update.Suffix != "" {
		api.Suffix = update.Suffix
	}
	if update.Method != "" {
		api.Method = update.Method
	}
	if update.Headers != nil {
		api.Headers = update.Headers
	}
	if update.Params != nil {
		api.Params = update.Params
	}
	if update.BodyTemplate != "" {
		api.BodyTemplate = update.BodyTemplate
	}
	if update.Description != "" {
		api.Description = update.Description
	}
	if update.Enabled != nil {
		api.Enabled = update.Enabled
	}
	dataOntologyMu.Unlock()

	if err := saveDataOntologyStore(); err != nil {
		log.Printf("[PlatformAPI] 保存失败: %v", err)
	}

	log.Printf("[PlatformAPI] 更新接口: id=%s name=%s", api.ID, api.Name)
	jsonSuccess(w, map[string]interface{}{
		"success": true,
		"api":     api,
	})
}

func deletePlatformApi(w http.ResponseWriter, r *http.Request, platformID, apiID string) {
	dataOntologyMu.Lock()
	api, exists := dataOntologyForwardApis[apiID]
	if !exists || api.PlatformID != platformID {
		dataOntologyMu.Unlock()
		jsonError(w, "接口不存在", "")
		return
	}

	delete(dataOntologyForwardApis, apiID)
	dataOntologyMu.Unlock()

	if err := saveDataOntologyStore(); err != nil {
		log.Printf("[PlatformAPI] 保存失败: %v", err)
	}

	log.Printf("[PlatformAPI] 删除接口: id=%s name=%s", apiID, api.Name)
	jsonSuccess(w, map[string]interface{}{
		"success": true,
		"message": "接口已删除",
	})
}

// testPlatformApi 测试转发接口
func testPlatformApi(w http.ResponseWriter, r *http.Request, platformID, apiID string) {
	dataOntologyMu.RLock()
	platform, pExists := dataOntologyPlatforms[platformID]
	api, aExists := dataOntologyForwardApis[apiID]
	dataOntologyMu.RUnlock()

	if !pExists {
		jsonError(w, "平台不存在", "")
		return
	}
	if !aExists || api.PlatformID != platformID {
		jsonError(w, "接口不存在", "")
		return
	}

	// 解析请求参数
	var reqBody struct {
		Params map[string]interface{} `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
		reqBody.Params = map[string]interface{}{}
	}

	// 构建目标 URL
	targetURL := strings.TrimRight(platform.BaseURL, "/") + api.Suffix
	// 替换路径参数
	targetURL = replacePathParams(targetURL, reqBody.Params)

	// 构建请求体
	var bodyReader io.Reader
	if api.BodyTemplate != "" {
		bodyStr := replaceTemplateParams(api.BodyTemplate, reqBody.Params)
		bodyReader = bytes.NewReader([]byte(bodyStr))
	} else if len(reqBody.Params) > 0 && (api.Method == "POST" || api.Method == "PUT" || api.Method == "PATCH") {
		bodyBytes, _ := json.Marshal(reqBody.Params)
		bodyReader = bytes.NewReader(bodyBytes)
	}

	// 构建转发请求
	proxyReq, err := http.NewRequest(api.Method, targetURL, bodyReader)
	if err != nil {
		jsonSuccess(w, map[string]interface{}{"success": false, "error": "构建请求失败: " + err.Error()})
		return
	}

	// 注入平台级 headers
	for k, v := range platform.Headers {
		proxyReq.Header.Set(k, v)
	}
	// 注入接口级 headers（覆盖平台级）
	for k, v := range api.Headers {
		proxyReq.Header.Set(k, v)
	}
	// Content-Type
	if api.BodyTemplate != "" || (api.Method != "GET" && len(reqBody.Params) > 0) {
		proxyReq.Header.Set("Content-Type", "application/json")
	}

	// 执行请求
	timeout := time.Duration(platform.Timeout) * time.Second
	if timeout == 0 {
		timeout = 30 * time.Second
	}
	transport := &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}
	if platform.TLSVerify != nil && *platform.TLSVerify {
		transport = &http.Transport{}
	}
	client := &http.Client{Timeout: timeout, Transport: transport}

	log.Printf("[PlatformAPI] 测试接口: %s %s → %s", api.Method, api.Suffix, targetURL)
	resp, err := client.Do(proxyReq)
	if err != nil {
		jsonSuccess(w, map[string]interface{}{"success": false, "error": "请求失败: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	contentType := resp.Header.Get("Content-Type")
	isSSE := strings.Contains(contentType, "text/event-stream")

	// 尝试解析为 JSON
	var result interface{}
	if json.Unmarshal(respBody, &result) == nil {
		jsonSuccess(w, map[string]interface{}{
			"success":     true,
			"status_code": resp.StatusCode,
			"content_type": contentType,
			"is_sse":      isSSE,
			"data":        result,
		})
	} else {
		// 非 JSON 响应
		bodyStr := string(respBody)
		if len(bodyStr) > 10000 {
			bodyStr = bodyStr[:10000] + "...(truncated)"
		}
		jsonSuccess(w, map[string]interface{}{
			"success":      true,
			"status_code":  resp.StatusCode,
			"content_type": contentType,
			"is_sse":       isSSE,
			"data":         bodyStr,
		})
	}
}

// ============================================================
// 转发执行（核心逻辑）
// ============================================================

// handleForwardDispatch 处理 /api/fwd/** 转发请求
func handleForwardDispatch(w http.ResponseWriter, r *http.Request) {
	pathSuffix := strings.TrimPrefix(r.URL.Path, "/api/fwd/")
	if pathSuffix == "" {
		jsonError(w, "缺少平台标识", "")
		return
	}

	parts := strings.SplitN(pathSuffix, "/", 2)
	platformKey := parts[0]
	remainingPath := ""
	if len(parts) > 1 {
		remainingPath = parts[1]
	}

	// 查找平台（支持 ID 和名称 slug 匹配）
	dataOntologyMu.RLock()
	var platform *Platform
	for _, p := range dataOntologyPlatforms {
		if p.ID == platformKey || slugify(p.Name) == platformKey {
			platform = p
			break
		}
	}

	if platform == nil {
		dataOntologyMu.RUnlock()
		jsonError(w, "平台不存在: "+platformKey, "")
		return
	}

	// 查找匹配的接口配置
	fullSuffix := "/" + remainingPath
	var matchedApi *ForwardApiConfig
	for _, api := range dataOntologyForwardApis {
		if api.PlatformID == platform.ID && strings.EqualFold(api.Method, r.Method) && matchSuffix(api.Suffix, fullSuffix) {
			matchedApi = api
			break
		}
	}
	dataOntologyMu.RUnlock()

	// 检查接口是否启用
	if matchedApi != nil && matchedApi.Enabled != nil && !*matchedApi.Enabled {
		jsonError(w, "接口已禁用", "")
		return
	}

	// 构建目标 URL
	targetURL := strings.TrimRight(platform.BaseURL, "/")
	suffix := fullSuffix
	if matchedApi != nil {
		suffix = matchedApi.Suffix
	}
	targetURL += suffix

	// 收集参数并替换路径参数
	params := collectRequestParams(r, matchedApi)
	targetURL = replacePathParams(targetURL, params)

	// 透传 query string
	if r.URL.RawQuery != "" {
		if strings.Contains(targetURL, "?") {
			targetURL += "&" + r.URL.RawQuery
		} else {
			targetURL += "?" + r.URL.RawQuery
		}
	}

	// 构建请求体
	var bodyReader io.Reader
	if r.Body != nil && (r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch) {
		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			jsonError(w, "读取请求体失败", "")
			return
		}
		r.Body.Close()

		if matchedApi != nil && matchedApi.BodyTemplate != "" {
			// 使用模板构建请求体，但也将原始 body 参数合并
			var bodyParams map[string]interface{}
			if len(bodyBytes) > 0 && json.Unmarshal(bodyBytes, &bodyParams) == nil {
				for k, v := range bodyParams {
					if _, exists := params[k]; !exists {
						params[k] = v
					}
				}
			}
			bodyStr := replaceTemplateParams(matchedApi.BodyTemplate, params)
			bodyReader = bytes.NewReader([]byte(bodyStr))
		} else {
			// 透传原始请求体
			if len(bodyBytes) > 0 {
				bodyReader = bytes.NewReader(bodyBytes)
			}
		}
	}

	// 构建转发请求
	proxyReq, err := http.NewRequest(r.Method, targetURL, bodyReader)
	if err != nil {
		log.Printf("[Forward] 构建请求失败: target=%s, err=%v", targetURL, err)
		jsonError(w, "构建转发请求失败: "+err.Error(), "")
		return
	}

	// 注入平台级 headers
	for k, v := range platform.Headers {
		proxyReq.Header.Set(k, v)
	}

	// 注入接口级 headers（覆盖平台级）
	if matchedApi != nil {
		for k, v := range matchedApi.Headers {
			proxyReq.Header.Set(k, v)
		}
	}

	// 透传客户端 headers（排除内部 headers）
	for key, vals := range r.Header {
		lower := strings.ToLower(key)
		if lower == "authorization" || lower == "host" || lower == "x-internal-call" {
			continue
		}
		for _, v := range vals {
			proxyReq.Header.Add(key, v)
		}
	}

	// 设置 Content-Type
	if matchedApi != nil && matchedApi.BodyTemplate != "" {
		proxyReq.Header.Set("Content-Type", "application/json")
	} else if r.Header.Get("Content-Type") != "" {
		proxyReq.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	}

	// 执行转发
	timeout := time.Duration(platform.Timeout) * time.Second
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	transport := &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}
	if platform.TLSVerify != nil && *platform.TLSVerify {
		transport = &http.Transport{} // 使用默认 TLS 验证
	}

	client := &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	log.Printf("[Forward] %s %s → %s", r.Method, r.URL.Path, targetURL)
	resp, err := client.Do(proxyReq)
	if err != nil {
		log.Printf("[Forward] 请求失败: target=%s, err=%v", targetURL, err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		w.Write([]byte(fmt.Sprintf(`{"success":false,"message":"转发请求失败: %s"}`, err.Error())))
		return
	}
	defer resp.Body.Close()

	// 检查是否为 SSE 响应
	contentType := resp.Header.Get("Content-Type")
	isSSE := strings.Contains(contentType, "text/event-stream")

	if isSSE {
		handleSSEForward(w, resp)
		return
	}

	// 普通响应：回写 headers + status + body
	for key, vals := range resp.Header {
		for _, v := range vals {
			w.Header().Add(key, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// handleSSEForward SSE 流式转发
func handleSSEForward(w http.ResponseWriter, resp *http.Response) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	flusher, canFlush := w.(http.Flusher)

	buf := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			w.Write(buf[:n])
			if canFlush {
				flusher.Flush()
			}
		}
		if err != nil {
			if err != io.EOF {
				log.Printf("[SSE Forward] 读取错误: %v", err)
			}
			break
		}
	}
}

// ============================================================
// 辅助函数
// ============================================================

// collectRequestParams 从请求中收集所有参数
func collectRequestParams(r *http.Request, api *ForwardApiConfig) map[string]interface{} {
	params := make(map[string]interface{})

	// URL query 参数
	for k, v := range r.URL.Query() {
		if len(v) == 1 {
			params[k] = v[0]
		} else {
			params[k] = v
		}
	}

	// Body 参数（JSON）
	if r.Body != nil && (r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch) {
		contentType := r.Header.Get("Content-Type")
		if strings.Contains(contentType, "application/json") {
			bodyBytes, err := io.ReadAll(r.Body)
			if err == nil && len(bodyBytes) > 0 {
				var bodyParams map[string]interface{}
				if json.Unmarshal(bodyBytes, &bodyParams) == nil {
					for k, v := range bodyParams {
						params[k] = v
					}
				}
				// 恢复 body 供后续读取
				r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
			}
		}
	}

	return params
}

// replacePathParams 替换路径中的 {param} 占位符
func replacePathParams(path string, params map[string]interface{}) string {
	for k, v := range params {
		placeholder := "{" + k + "}"
		if strings.Contains(path, placeholder) {
			path = strings.ReplaceAll(path, placeholder, fmt.Sprintf("%v", v))
		}
	}
	return path
}

// replaceTemplateParams 替换模板中的 {{param}} 占位符
func replaceTemplateParams(template string, params map[string]interface{}) string {
	result := template
	for k, v := range params {
		placeholder := "{{" + k + "}}"
		result = strings.ReplaceAll(result, placeholder, fmt.Sprintf("%v", v))
	}
	return result
}

// matchSuffix 检查请求路径是否匹配接口后缀（支持 {param} 通配符）
func matchSuffix(pattern, path string) bool {
	patternParts := strings.Split(pattern, "/")
	pathParts := strings.Split(path, "/")

	if len(patternParts) != len(pathParts) {
		return false
	}

	for i := range patternParts {
		if strings.HasPrefix(patternParts[i], "{") && strings.HasSuffix(patternParts[i], "}") {
			continue
		}
		if patternParts[i] != pathParts[i] {
			return false
		}
	}
	return true
}

// slugify 将名称转为 URL 安全的 slug
func slugify(name string) string {
	s := strings.ToLower(name)
	s = strings.ReplaceAll(s, " ", "-")
	s = strings.ReplaceAll(s, "_", "-")
	var result strings.Builder
	for _, c := range s {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' {
			result.WriteRune(c)
		}
	}
	return result.String()
}

// extractPlatformPathSuffix 提取 /api/v1/platforms/ 后的路径
func extractPlatformPathSuffix(fullPath string) string {
	prefix := "/api/v1/platforms/"
	if !strings.HasPrefix(fullPath, prefix) {
		return ""
	}
	return strings.TrimPrefix(fullPath, prefix)
}

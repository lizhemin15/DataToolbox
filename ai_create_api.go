package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/YOUR_USERNAME/DataToolbox/agent"
	"github.com/google/uuid"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	picoclawcfg "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/config"
)

type AICompletionRequest struct {
	Prompt string `json:"prompt"`
}

// OntologyExtractRequest 本体论提取请求

type OntologyExtractRequest struct {
	Databases []string `json:"databases"`
}

// OntologyQueryRequest 本体论语义查询请求

type OntologyQueryRequest struct {
	Query    string                 `json:"query"`
	Ontology map[string]interface{} `json:"ontology"`
}

// handleOntologyExtract 从数据库结构中AI提取本体论知识图谱（SSE流式）

func handleOntologyExtract(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		sendSSE(w, "onto-error", map[string]interface{}{"message": "未授权"})
		return
	}
	if r.Method != http.MethodPost {
		sendSSE(w, "onto-error", map[string]interface{}{"message": "只支持POST"})
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		sendSSE(w, "onto-error", map[string]interface{}{"message": "不支持流式传输"})
		return
	}

	var req OntologyExtractRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendSSE(w, "onto-error", map[string]interface{}{"message": "请求格式错误"})
		return
	}

	sendSSE(w, "onto-start", map[string]interface{}{"message": "开始分析数据库结构..."})
	flusher.Flush()

	dataOntologyMu.RLock()
	aiConfig := dataOntologyAIConfig
	dataOntologyMu.RUnlock()
	if aiConfig == nil || aiConfig.URL == "" {
		sendSSE(w, "onto-error", map[string]interface{}{"message": "请先在AI助手中配置AI设置"})
		return
	}

	// 收集数据库 schema
	sendSSE(w, "onto-thinking", map[string]interface{}{"message": "正在读取数据库表结构..."})
	flusher.Flush()

	dataOntologyMu.RLock()
	var dbSchemas []map[string]interface{}
	for _, dbID := range req.Databases {
		dbConfig, exists := dataOntologyDatabases[dbID]
		if !exists || !dataOntologyResourceVisible(dbConfig.Owner, username) {
			continue
		}
		tables, err := getTablesList(dbConfig)
		if err != nil {
			continue
		}
		var tablesWithCols []map[string]interface{}
		maxTables := 20
		if len(tables) > maxTables {
			tables = tables[:maxTables]
		}
		for _, tName := range tables {
			cols, err := getTableColumns(dbConfig, tName)
			if err != nil {
				cols = []map[string]interface{}{}
			}
			tablesWithCols = append(tablesWithCols, map[string]interface{}{"name": tName, "columns": cols})
		}
		dbSchemas = append(dbSchemas, map[string]interface{}{
			"id": dbID, "name": dbConfig.Name, "type": dbConfig.Type, "tables": tablesWithCols,
		})
	}
	dataOntologyMu.RUnlock()

	if len(dbSchemas) == 0 {
		sendSSE(w, "onto-error", map[string]interface{}{"message": "未找到有效的数据库或无法获取表结构"})
		return
	}

	sendSSE(w, "onto-thinking", map[string]interface{}{"message": "AI正在理解业务语义，构建本体论图谱..."})
	flusher.Flush()

	prompt := buildOntologyExtractionPrompt(dbSchemas)
	aiResp, err := callAIService(aiConfig, prompt)
	if err != nil {
		sendSSE(w, "onto-error", map[string]interface{}{"message": "AI调用失败: " + err.Error()})
		return
	}

	// 解析 JSON
	cleaned := extractJSONObject(aiResp)
	if cleaned == "" {
		cleaned = cleanAIResponse(aiResp)
	}
	cleaned = extractJSONObject(cleaned)

	var ontology map[string]interface{}
	if err := json.Unmarshal([]byte(cleaned), &ontology); err != nil {
		sendSSE(w, "onto-error", map[string]interface{}{"message": "AI返回格式解析失败，请重试"})
		return
	}

	// 流式推送节点（带微小延迟营造动画效果）
	sendSSE(w, "onto-thinking", map[string]interface{}{"message": "正在构建知识图谱..."})
	flusher.Flush()

	sendSSE(w, "onto-result", ontology)
	flusher.Flush()

	sendSSE(w, "onto-done", map[string]interface{}{"message": "本体论提取完成"})
	flusher.Flush()
}

// buildOntologyExtractionPrompt 构建本体论提取的AI提示词

func buildOntologyExtractionPrompt(dbSchemas []map[string]interface{}) string {
	schemaJSON, _ := json.MarshalIndent(dbSchemas, "", "  ")
	prompt := `你是一位数据本体论（Ontology）专家，擅长从数据库结构中提取业务语义知识图谱。

请分析以下数据库表结构，识别业务实体、概念、事件、规则，及其语义关系，同时发现数据治理问题。

要求：
1. 输出一个严格的 JSON 对象（不要 markdown 代码块包裹，不要任何解释）
2. JSON 结构如下：
{
  "concepts": [
    {
      "id": "英文小写下划线唯一标识",
      "label": "中文业务名称",
      "category": "entity|event|concept|rule|conflict",
      "description": "业务含义描述（2-3句话）",
      "tables": ["对应的数据库表名"],
      "importance": 0.0到1.0的重要性权重,
      "attributes": ["核心字段名"],
      "governance_issues": ["存在的数据治理问题（若无则为空数组）"]
    }
  ],
  "relations": [
    {
      "source": "源概念id",
      "target": "目标概念id",
      "label": "关系中文名称",
      "type": "has-one|has-many|many-to-many|many-to-one|conflict|inherits",
      "description": "关系说明"
    }
  ],
  "insights": [
    {
      "type": "conflict|missing|quality|governance|performance",
      "title": "洞察标题",
      "description": "详细说明",
      "severity": "high|medium|low|info",
      "affectedConcepts": ["相关概念id"]
    }
  ]
}

重要规则：
- concepts 数量控制在 8-15 个，聚焦核心业务概念
- relations 覆盖所有主要业务关联
- insights 必须包含至少1个命名/冲突类问题（若存在）和1个治理建议
- conflict 类 concept 专门描述发现的问题实体

数据库结构：
` + string(schemaJSON)
	return prompt
}

// handleAIOntologyQuery 处理AI助手中的本体论语义查询

func handleAIOntologyQuery(w http.ResponseWriter, flusher http.Flusher, queryReq *AIQueryRequest, dbSchemas []map[string]interface{}, aiConfig *AIConfig) {
	sendSSE(w, "thinking", map[string]interface{}{"message": "正在进行语义分析..."})
	flusher.Flush()

	schemaJSON, _ := json.MarshalIndent(dbSchemas, "", "  ")
	prompt := fmt.Sprintf(`你是一位数据本体论专家。用户正在询问关于数据库数据的语义问题。
请基于以下数据库结构，从本体论角度分析并回答用户的问题。
关注业务语义、实体关系、数据治理角度给出深度分析。

数据库结构：
%s

用户问题：%s

请用中文给出详细的语义分析和治理建议。最后一行输出 HIGHLIGHT:concept_id1,concept_id2，列出应高亮的概念id。`, string(schemaJSON), queryReq.Message)

	aiResp, err := callAIService(aiConfig, prompt)
	if err != nil {
		sendSSE(w, "error", map[string]interface{}{"message": "AI调用失败: " + err.Error()})
		return
	}

	answer := aiResp
	highlighted := []string{}
	if idx := strings.LastIndex(aiResp, "HIGHLIGHT:"); idx >= 0 {
		answer = strings.TrimSpace(aiResp[:idx])
		ids := strings.TrimSpace(aiResp[idx+10:])
		for _, id := range strings.Split(ids, ",") {
			if id = strings.TrimSpace(id); id != "" {
				highlighted = append(highlighted, id)
			}
		}
	}
	sendSSE(w, "answer", map[string]interface{}{"text": answer, "highlighted": highlighted})
	sendSSE(w, "done", map[string]interface{}{})
	flusher.Flush()
}

// handleOntologySemanticQuery 本体论自然语言语义查询

func handleOntologySemanticQuery(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}
	var req OntologyQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}
	if req.Query == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "查询内容不能为空"})
		return
	}
	dataOntologyMu.RLock()
	aiConfig := dataOntologyAIConfig
	dataOntologyMu.RUnlock()
	if aiConfig == nil || aiConfig.URL == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请先配置AI设置"})
		return
	}

	ontologyJSON, _ := json.MarshalIndent(req.Ontology, "", "  ")
	prompt := fmt.Sprintf(`你是一位数据本体论专家。用户正在查询一个业务知识图谱。

当前知识图谱：
%s

用户问题：%s

请用中文回答，要求：
1. 直接回答问题，基于知识图谱中的实际数据
2. 指出相关的核心概念（用【概念名】标注）
3. 如有治理风险，重点说明
4. 回答简洁有深度，100-200字

最后输出一行，格式为：HIGHLIGHT:concept_id1,concept_id2（列出回答中涉及的概念id，逗号分隔）`, string(ontologyJSON), req.Query)

	content, err := callAIService(aiConfig, prompt)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "AI调用失败: " + err.Error()})
		return
	}

	// 解析 HIGHLIGHT 行
	answer := content
	var highlighted []string
	if idx := strings.LastIndex(content, "HIGHLIGHT:"); idx >= 0 {
		answer = strings.TrimSpace(content[:idx])
		ids := strings.TrimSpace(content[idx+10:])
		for _, id := range strings.Split(ids, ",") {
			id = strings.TrimSpace(id)
			if id != "" {
				highlighted = append(highlighted, id)
			}
		}
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"answer":      answer,
		"highlighted": highlighted,
	})
}

// handleAICompletion 通用 AI 补全，供治理任务等调用（使用与 AI 助手相同的配置）

func handleAICompletion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持 POST"})
		return
	}
	var req AICompletionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}
	if req.Prompt == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "prompt 不能为空"})
		return
	}
	dataOntologyMu.RLock()
	aiConfig := dataOntologyAIConfig
	dataOntologyMu.RUnlock()
	if aiConfig == nil || aiConfig.URL == "" || aiConfig.APIKey == "" || aiConfig.Model == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请先在 AI 助手中配置 AI 设置（URL、API Key、模型）"})
		return
	}
	content, err := callAIService(aiConfig, req.Prompt)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "AI 调用失败: " + err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "content": content})
}

// ==================== 集群模式（Agent）Handler ====================

// agentClusterConfigJSON 是 agent-config.json 的顶层结构

type agentClusterConfigJSON struct {
	Providers []agent.ProviderConfig `json:"providers"`
	MCP       []agent.MCPServerConfig `json:"mcp_servers"`
	Skills    []agent.SkillConfig     `json:"skills"`
}

// agentConfigPath 返回 agent 配置文件路径（基于可执行文件位置）

func agentConfigPath() string {
	exePath, _ := os.Executable()
	return filepath.Join(filepath.Dir(exePath), "agent-config.json")
}

// loadAgentConfig 从 agent-config.json 加载集群模式配置

func loadAgentConfig() {
	data, err := os.ReadFile(agentConfigPath())
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[agent] 读取配置文件失败: %v", err)
		}
	} else {
		var cfg agentClusterConfigJSON
		if err := json.Unmarshal(data, &cfg); err != nil {
			log.Printf("[agent] 解析配置文件失败: %v", err)
		} else {
			// 加载 providers
			for _, p := range cfg.Providers {
				agentProviderRegistry.Add(p)
			}
			// 加载 MCP
			for _, m := range cfg.MCP {
				agentMCPSupervisor.AddConfig(m)
			}
			// 加载 skills
			for _, s := range cfg.Skills {
				agentSkillRegistry.Add(s)
			}
			log.Printf("[agent] 已加载配置: %d providers, %d mcp_servers, %d skills",
				len(cfg.Providers), len(cfg.MCP), len(cfg.Skills))
		}
	}

	// 从 skills 目录加载内置 skills
	exePath, _ := os.Executable()
	skillsDir := filepath.Join(filepath.Dir(exePath), "agent-config", "skills")
	if err := agentSkillRegistry.LoadFromDir(skillsDir); err != nil {
		log.Printf("[agent] 加载 skills 目录失败: %v", err)
	} else {
		log.Printf("[agent] 已从目录加载 skills: %s", skillsDir)
	}
}

// saveAgentConfig 保存集群模式配置到 agent-config.json

func saveAgentConfig() error {
	providers := agentProviderRegistry.List()
	mcpConfigs := agentMCPSupervisor.ListConfigs()
	skills := agentSkillRegistry.List()
	cfg := agentClusterConfigJSON{
		Providers: providers,
		MCP:       mcpConfigs,
		Skills:    skills,
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal agent config: %w", err)
	}
	dir := filepath.Dir(agentConfigPath())
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	return os.WriteFile(agentConfigPath(), data, 0644)
}

// initAgentSubsystem 初始化集群模式子系统
// initAgentSubsystem 初始化集群模式子系统
func initAgentSubsystem() {
	agentProviderRegistry = agent.NewProviderRegistry()
	agentMCPSupervisor = agent.NewMCPSupervisor()
	agentSkillRegistry = agent.NewSkillRegistry()

	// 初始化全局 HITL 管理器
	globalHITLManager = agent.NewHITLManager()

	loadAgentConfig()

	// Orchestrator 改为懒初始化（每用户首次查询时创建），无需启动时预创建
}

// getOrchestratorForUser 获取指定用户的 Orchestrator（懒初始化）

func getOrchestratorForUser(username string) *agent.Orchestrator {
	agentOrchestratorMu.RLock()
	orch, exists := agentOrchestrators[username]
	agentOrchestratorMu.RUnlock()
	if exists && orch != nil {
		return orch
	}

	// 懒初始化：为该用户创建独立 Orchestrator
	agentOrchestratorMu.Lock()
	defer agentOrchestratorMu.Unlock()

	// double-check
	if agentOrchestrators[username] != nil {
		return agentOrchestrators[username]
	}

	dataOntologyMu.RLock()
	aiConfig := dataOntologyAIConfig
	dataOntologyMu.RUnlock()

	if aiConfig == nil || aiConfig.APIKey == "" || aiConfig.Model == "" {
		log.Printf("[agent] AI config not ready for user=%s", username)
		return nil
	}

	ctx := context.Background()

	// 1. 创建 PicoClaw LLMProvider
	providerType := agent.ProviderTypeOpenAI
	if aiConfig.URL != "" && strings.Contains(aiConfig.URL, "generativelanguage.googleapis.com") {
		providerType = agent.ProviderTypeGemini
	}

	providerCfg := agent.ProviderConfig{
		ID:        "default",
		Name:      "Default",
		Type:      providerType,
		APIKey:    aiConfig.APIKey,
		BaseURL:   aiConfig.URL,
		ModelID:   aiConfig.Model,
		Enabled:   true,
		IsDefault: true,
	}

	picoProvider, err := agentProviderRegistry.CreatePicoProvider(ctx, providerCfg)
	if err != nil {
		log.Printf("[agent] failed to create PicoClaw provider for user=%s: %v", username, err)
		return nil
	}

	// 2. 构建 PicoClaw Config（每用户独立 workspace）
	picoCfg := buildPicoClawConfig(aiConfig, username)

	// 3. 创建 Orchestrator 并初始化
	orch, err = agent.NewOrchestrator(agent.OrchestratorConfig{
		AppName: "datatoolbox",
	})
	if err != nil {
		log.Printf("[agent] failed to create orchestrator for user=%s: %v", username, err)
		return nil
	}

	// 4. 工具通过 MCP 注册（不再使用 DataToolboxAPITool，避免重复）

	// 5. 注入 HITL 管理器到 Orchestrator
	if globalHITLManager != nil {
		// 先传入 HITLManager，eventBus 在 InitializeWithProvider 后补充
		orch.SetHITLManager(globalHITLManager, nil)
	}

	if err := orch.InitializeWithProvider(ctx, picoProvider, picoCfg); err != nil {
		log.Printf("[agent] failed to initialize orchestrator for user=%s: %v", username, err)
		return nil
	}

	// 6. InitializeWithProvider 后，使用 PicoClaw 的 RuntimeEvents 作为 HITL 事件总线
	// AskUserTool → loop.RuntimeEventBus() → Run() 中的订阅者 → SSE
	if globalHITLManager != nil && orch.GetLoop() != nil {
		runtimeEventBus := orch.GetLoop().RuntimeEventBus()
		if runtimeEventBus != nil {
			orch.SetHITLManager(globalHITLManager, runtimeEventBus)
			log.Printf("[agent] HITL event bus connected to PicoClaw RuntimeEvents for user=%s", username)
		}
	}

	// 写入中文 AGENT.md 到用户 workspace（每次都更新，确保最新指令生效）
	agentWorkspace := picoCfg.Agents.Defaults.Workspace
	agentMDPath := filepath.Join(agentWorkspace, "AGENT.md")
		agentMDContent := `---
name: 数据智能助手
description: 数据智能助手 — 数据库管理、查询、接口创建、治理与洞察
tools:
  - delegate
  - subagent
  - spawn
  - read_file
  - write_file
  - list_dir
  - exec
  - ask_user
---

# 数据智能助手

你是数据智能助手，负责帮助用户管理数据库、查询数据、创建API接口、执行数据治理任务、洞察数据价值。

## ⚠️ 强制规则 — 必须遵守

**禁止用文字询问用户！** 当需要用户输入、确认或选择时，必须调用 ask_user 工具弹出交互卡片。

示例：用户说"帮我创建一个接口"
1. 调用 list_databases 获取数据库列表
2. 调用 get_tables 获取表列表
3. **调用 ask_user 工具**（interaction_type="form"）让用户选择数据库、表、填写接口名称和 SQL
4. 用户确认后调用 create_api 创建

**错误做法**：写"请告诉我您想查询哪个数据库？"
**正确做法**：调用 ask_user 工具，让用户通过交互卡片选择

## 核心能力

- **数据库查询**: 使用 list_databases、list_tables、execute_sql、get_table_schema、search_tables 工具
- **接口调用**: 使用 list_apis 查看已有接口，使用 execute_api 直接调用已有接口获取真实数据（参数: path, 以及接口所需的查询参数）
- **接口创建**: 使用 create_api 创建新接口（仅在接口不存在时创建）
- **数据治理**: 使用 governance_tasks 端点管理治理任务
- **数据本体**: 使用 ontology_query 查询概念关系
- **多智能体协作**: 可以通过 delegate/subagent/spawn 工具委派任务给其他智能体
- **人在环路交互**: 使用 ask_user 工具向用户发起确认、选择、填空等交互请求

## 用户意图识别

根据用户消息和系统注入的意图检测结果判断意图：
- "调用接口"/"试试接口"/"看看接口返回什么" → 先 list_apis 查看接口列表，再用 execute_api 调用
- "创建接口"/"做个API"/"接口制作" → 创建接口流程（先 list_apis 检查是否已存在）
- "查询数据"/"看看有哪些表" → 数据库查询
- "数据治理"/"定时任务" → 治理任务
- 用户用 @数据库名 指定了数据库时，必须使用该数据库
- 用户用 @接口制作 指定了模块时，进入创建接口流程
- 系统会在消息中注入意图检测结果（模块、置信度、原因），优先参考该结果

## 人在环路交互（HITL）— 关键决策必须确认

**重要：在执行不可逆操作前，必须使用 ask_user 工具让用户确认！**

必须使用 ask_user 的场景：
1. **创建接口前** — 让用户审核接口配置（名称、路径、SQL、描述），用户可能需要修改
2. **删除操作前** — 确认是否删除
3. **执行写操作前** — INSERT/UPDATE/DELETE 等修改数据的操作
4. **选择不明确时** — 多个候选表/字段时让用户选择
5. **用户输入缺失时** — 需要用户提供关键参数

**禁止用文字询问用户！** 当需要用户输入或确认时，必须使用 ask_user 工具弹出交互卡片：
- 不要写"请告诉我您想查询哪个数据库"
- 必须调用 ask_user 工具，让用户通过交互卡片选择或输入

ask_user 使用示例：
- 确认型：interaction_type="confirm"，提供 options: [{id:"yes",label:"确认"},{id:"no",label:"取消"}]
- 选择型：interaction_type="single_select"，提供 options 列表
- 表单型：interaction_type="form"，提供 fields 让用户填写/修改

示例：用户说"帮我创建一个接口"
1. 先调用 list_databases 和 get_tables 获取可用资源
2. 调用 ask_user（form 类型）让用户选择数据库、表、填写接口名称和 SQL
3. 用户确认后调用 create_api 创建

## RAG 检索流程（SQL 查询必读）

当用户需要查询数据时，必须按以下 RAG 流程操作，不要跳步：

1. **search_tables** — 用用户需求关键词搜索相关表（参数: query, database?）
2. **get_table_schema** — 获取相关表的字段详情（参数: database, table）
3. **get_db_sql_hints** — 获取该数据库的 SQL 方言提示和文档（参数: database）
4. **生成 SQL** — 基于表结构和方言提示生成准确的 SQL
5. **execute_sql** — 执行生成的 SQL（参数: database, sql）

重要：不要凭记忆猜测表名或字段名，必须先通过 search_tables 和 get_table_schema 获取真实信息。

## SQL 生成最佳实践

1. **先获取方言提示** — 不同数据库（MySQL/PostgreSQL/DM/Oracle等）语法有差异，生成 SQL 前先调用 get_db_sql_hints 获取方言提示
2. **使用真实表名和字段名** — 从 get_table_schema 获取，不要猜测
3. **合理使用 LIMIT** — 查询数据时默认加 LIMIT，避免返回过多数据
4. **避免 SELECT *** — 只查询需要的字段
5. **参数化查询** — 接口 SQL 使用 #{参数名} 格式
6. **注意数据类型** — 字符串加引号，数字不加，日期按方言格式

## 反思流程（执行后验证）

执行 SQL 后必须检查结果是否合理：

1. **检查结果是否为空** — 如果返回空结果，思考是否 SQL 条件过于严格，考虑放宽条件重试
2. **检查结果数量** — 如果返回行数异常多或异常少，思考是否符合预期
3. **检查字段值** — 如果结果中包含 NULL 或异常值，向用户说明
4. **错误重试** — 如果 SQL 执行失败，分析错误信息，修正 SQL 后重试（最多重试 3 次）
5. **结果解释** — 用中文向用户解释查询结果的含义，不要只返回原始数据

## 写操作安全

遇到 INSERT、UPDATE、DELETE、DROP、ALTER、TRUNCATE 等写操作时：

1. **必须先确认** — 向用户展示即将执行的 SQL，等待用户确认后再执行
2. **说明影响范围** — 告知用户该操作会影响多少行数据
3. **建议备份** — 对于重要数据的修改，建议用户先备份
4. **禁止危险操作** — 不要执行 DROP TABLE、TRUNCATE 等不可逆操作，除非用户明确要求
5. **事务建议** — 对于批量修改，建议使用事务以便回滚

## 创建接口流程

当用户要求创建接口时，必须按以下步骤操作：
1. 用 list_databases 确认可用的数据库
2. 用 list_tables 获取指定数据库的表列表
3. 用 get_table_schema 获取相关表的字段信息
4. 用 list_apis 查看已有接口，如果接口已存在则用 execute_api 调用并返回结果，不要重复创建
5. 如果接口不存在，根据用户需求生成接口配置，调用 create_api 创建
6. 创建后用 execute_api 调用新接口验证数据正确性
7. 告知用户接口路径和测试方法

## 创建接口的 SQL 规则

- SQL 只能有一条语句
- 使用 #{参数名} 表示预编译参数
- 接口路径以 /api/ 开头，使用 RESTful 风格
- 必须使用真实的表名和字段名（从 get_table_schema 获取）
- 必须为每个参数提供 default_params 默认值
- default_params 的值必须是数据库中实际存在的数据

## 行为准则

1. **用中文回复** — 所有输出使用中文
2. **先查后答** — 涉及数据库信息时，先用工具查询实时数据，不要凭记忆回答
3. **主动使用工具** — 不要只是描述你会做什么，要实际调用工具
4. **主动调用接口验证** — 用户要求"看看接口"/"调用接口"/"试试接口"时，必须用 execute_api 实际调用接口并返回真实数据，不要只列出接口列表
5. **简洁准确** — 回答要直接了当，不要废话
6. **遇到错误要报告** — 如果工具调用失败，如实告知用户错误信息
7. **尊重用户上下文** — 用户通过 @ 指定的数据库和模块必须使用
8. **反思验证** — 执行 SQL 后检查结果合理性，不合理则修正重试
9. **写操作确认** — 任何写操作必须先向用户确认
10. **数据是真实的** — 通过工具获取的数据来自真实数据库连接，不要声称数据是模拟的或数据库是断开的，除非工具返回明确的连接错误
`
		os.MkdirAll(agentWorkspace, 0755)
	if err := os.WriteFile(agentMDPath, []byte(agentMDContent), 0644); err != nil {
		log.Printf("[agent] failed to write AGENT.md for user=%s: %v", username, err)
	} else {
		log.Printf("[agent] wrote AGENT.md for user=%s at %s", username, agentMDPath)
	}

	agentOrchestrators[username] = orch
	log.Printf("[agent] orchestrator initialized for user=%s with workspace=%s", username, picoCfg.Agents.Defaults.Workspace)
	return orch
}

// sanitizePathName 清理用户名用于路径，防止路径注入

func sanitizePathName(name string) string {
	// 只保留字母、数字、下划线、横线
	var b strings.Builder
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			b.WriteRune(r)
		}
	}
	result := b.String()
	if result == "" {
		return "default"
	}
	return result
}

// buildPicoClawConfig 构建 PicoClaw 配置（每用户独立 workspace）

func buildPicoClawConfig(aiConfig *AIConfig, username string) *picoclawcfg.Config {
	cfg := &picoclawcfg.Config{}

	// 默认 agent 配置
	cfg.Agents.Defaults.ModelName = aiConfig.Model
	cfg.Agents.Defaults.MaxTokens = 8192
	temp := 0.7
	cfg.Agents.Defaults.Temperature = &temp
	cfg.Agents.Defaults.MaxParallelTurns = 1

	// 沙箱隔离 — 每用户独立 workspace，限制在安装目录/agent-workspace/username/
	// 路径从可执行文件位置推导，不硬编码
	exePath, _ := os.Executable()
	installDir := filepath.Dir(exePath)
	safeUsername := sanitizePathName(username)
	agentWorkspace := filepath.Join(installDir, "agent-workspace", safeUsername)
	cfg.Agents.Defaults.Workspace = agentWorkspace
	cfg.Agents.Defaults.RestrictToWorkspace = true
	cfg.Agents.Defaults.SubTurn.MaxDepth = 3
	cfg.Agents.Defaults.SubTurn.MaxConcurrent = 5
	cfg.Agents.Defaults.SubTurn.DefaultTimeoutMinutes = 5
	cfg.Agents.Defaults.SubTurn.ConcurrencyTimeoutSec = 30

	// Agent 列表 — DataToolbox 的多智能体配置
	cfg.Agents.List = []picoclawcfg.AgentConfig{
		{
			ID:      "data_query_agent",
			Name:    "数据查询助手",
			Default: true,
		},
		{
			ID:   "db_admin_agent",
			Name: "数据库管理助手",
		},
	}

	// 工具配置 — 启用 delegate/subagent/spawn 用于多智能体调度
	cfg.Tools.Spawn.Enabled = true
	cfg.Tools.Subagent.Enabled = true
	cfg.Tools.Exec.Enabled = true
	cfg.Tools.ReadFile.Enabled = true
	cfg.Tools.ListDir.Enabled = true
	cfg.Tools.WriteFile.Enabled = true
	cfg.Tools.AppendFile.Enabled = true

	// MCP 配置 — DataToolbox 自身作为 MCP server（streamable-http）
	mcpEnabled := dataOntologyMCPEnabled == nil || *dataOntologyMCPEnabled
	if mcpEnabled {
		cfg.Tools.MCP.Enabled = true
		cfg.Tools.MCP.Servers = map[string]picoclawcfg.MCPServerConfig{
			"datatoolbox": {
				Enabled: true,
				Type:    "streamable-http",
				URL:     mcpLoopbackAddr + "/mcp",
				Headers: map[string]string{
					"X-Internal-Call": "datatoolbox-agent",
				},
			},
		}
		// 合并用户通过 /api/agent/mcp 添加的外部 MCP server 配置
		externalServers := agentMCPSupervisor.ListConfigs()
		for _, srv := range externalServers {
			if !srv.Enabled {
				continue
			}
			serverType := srv.Type
			if serverType == "" {
				if srv.Command != "" {
					serverType = "stdio"
				} else if srv.URL != "" {
					serverType = "sse"
				}
			}
			sanitizedName := sanitizePathName(srv.Name)
			cfg.Tools.MCP.Servers[sanitizedName] = picoclawcfg.MCPServerConfig{
				Enabled: true,
				Type:    serverType,
				Command: srv.Command,
				Args:    srv.Args,
				Env:     srv.Env,
				URL:     srv.URL,
				Headers: srv.Headers,
			}
		}
	}

	// 模型列表 — 必须注册，否则 ParseModelRef 会把 "Qwen/xxx" 拆成 provider=Qwen
	cfg.ModelList = []*picoclawcfg.ModelConfig{
		{
			ModelName: "default",
			Provider:  "openai",
			Model:     aiConfig.Model,
			APIBase:   strings.TrimSuffix(strings.TrimSuffix(aiConfig.URL, "/chat/completions"), "/completions"),
			APIKeys:   picoclawcfg.SecureStrings{picoclawcfg.NewSecureString(aiConfig.APIKey)},
			Enabled:   true,
		},
	}

	return cfg
}

// handleAgentClusterQuery 集群模式查询入口（SSE流式响应）
// 统一走 handleAIQuery，自动设置 mode=cluster

func handleAgentClusterQuery(w http.ResponseWriter, r *http.Request) {
	// 读取请求体，注入 mode=cluster，然后转发给 handleAIQuery
	if r.Method == http.MethodPost {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "读取请求失败", 400)
			return
		}
		r.Body.Close()
		// 注入 mode 字段
		var reqMap map[string]interface{}
		if err := json.Unmarshal(body, &reqMap); err == nil {
			reqMap["mode"] = "cluster"
			newBody, _ := json.Marshal(reqMap)
			r.Body = io.NopCloser(bytes.NewReader(newBody))
			r.ContentLength = int64(len(newBody))
		} else {
			r.Body = io.NopCloser(bytes.NewReader(body))
		}
	}
	handleAIQuery(w, r)
}

// handleAgentClusterQueryWithReq 从 handleAIQuery 分发过来的集群模式处理
// 已完成鉴权和请求解析，直接进入核心逻辑

func handleAgentClusterQueryWithReq(w http.ResponseWriter, r *http.Request, flusher http.Flusher, queryReq *AIQueryRequest, username string) {
	// 发送开始事件
	sendSSE(w, "start", map[string]interface{}{"message": "🤖 集群模式已启动，智能体正在规划任务..."})
	flusher.Flush()

	// 懒初始化：获取该用户的 Orchestrator（每用户独立 workspace）
	orch := getOrchestratorForUser(username)
	if orch == nil {
		sendSSE(w, "error", map[string]interface{}{"message": "请先配置AI设置（API Key、模型）"})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	// 获取超时配置（HITL 交互需要更长时间，取配置超时和 HITL 默认超时的较大值）
	dataOntologyMu.RLock()
	aiConfig := dataOntologyAIConfig
	dataOntologyMu.RUnlock()

	timeout := 120
	if aiConfig != nil && aiConfig.Timeout > 0 {
		timeout = aiConfig.Timeout
	}
	// HITL 交互默认超时 300s，确保整体超时不小于此值，否则用户来不及响应
	if timeout < 300 {
		timeout = 300
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(timeout)*time.Second)
	defer cancel()

	sessionID := fmt.Sprintf("cluster-%s", username)

	// 构建增强消息：注入意图检测、数据库和模块上下文
	enhancedMessage := queryReq.Message
	var contextParts []string

	// 意图检测：在注入上下文前，先调用 detectUserIntent 做意图检测
	intentInfo := detectUserIntent(queryReq.Message)
	if intentInfo.DetectedModule != "" {
		intentDesc := fmt.Sprintf("- 检测到意图: %s (置信度: %.0f%%, 原因: %s)", intentInfo.DetectedModule, intentInfo.Confidence*100, intentInfo.Reason)
		contextParts = append(contextParts, "系统意图检测结果:\n"+intentDesc)
		log.Printf("[agent] intent detected: module=%s, confidence=%.2f, reason=%s", intentInfo.DetectedModule, intentInfo.Confidence, intentInfo.Reason)
	}

	// 注入数据库上下文
	if len(queryReq.Databases) > 0 {
		dataOntologyMu.RLock()
		var dbInfos []string
		for _, dbID := range queryReq.Databases {
			if db, ok := dataOntologyDatabases[dbID]; ok {
				dbInfos = append(dbInfos, fmt.Sprintf("- 数据库: %s (类型: %s, ID: %s)", db.Name, db.Type, dbID))
			}
		}
		dataOntologyMu.RUnlock()
		if len(dbInfos) > 0 {
			contextParts = append(contextParts, "用户通过 @命令 指定了以下数据库:\n"+strings.Join(dbInfos, "\n"))
		}
	}

	// 注入模块上下文
	if len(queryReq.Modules) > 0 {
		moduleNames := make(map[string]string)
		moduleNames["db-manage"] = "通用提问 — 查询数据、统计信息、了解表结构"
		moduleNames["api-dispatch"] = "接口制作 — 创建 API 接口、生成数据服务"
		moduleNames["data-governance"] = "数据治理 — 创建定时任务、数据导入导出"
		moduleNames["quality-audit"] = "质量审计 — 数据质量检查、校验规则"
		moduleNames["ontology"] = "本体查询 — 概念关系、语义分析"
		moduleNames["small-model"] = "小模型 — 本地模型、离线推理"

		var modInfos []string
		for _, modID := range queryReq.Modules {
			if desc, ok := moduleNames[modID]; ok {
				modInfos = append(modInfos, fmt.Sprintf("- 模块: %s (%s)", modID, desc))
			}
		}
		if len(modInfos) > 0 {
			contextParts = append(contextParts, "用户通过 @命令 指定了以下操作模块:\n"+strings.Join(modInfos, "\n"))
		}
	}

	if len(contextParts) > 0 {
		enhancedMessage = strings.Join(contextParts, "\n\n") + "\n\n用户问题: " + queryReq.Message
	}

	// 调用 Orchestrator.Run()
	eventCh, err := orch.Run(ctx, username, sessionID, enhancedMessage)
	if err != nil {
		sendSSE(w, "error", map[string]interface{}{"message": fmt.Sprintf("Agent执行失败: %v", err)})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	// 遍历事件channel，推送到前端
	eventCount := 0
	for evt := range eventCh {
		eventCount++
		log.Printf("[agent] SSE event #%d: type=%s, data=%v", eventCount, evt.Type, evt.Data)
		sendSSE(w, string(evt.Type), evt.Data)
		flusher.Flush()
	}

	log.Printf("[agent] 集群模式查询完成: user=%s, session=%s, events=%d", username, sessionID, eventCount)

	// 清除 HITL 确认标记，下次查询需要重新确认
	agent.ClearHITLConfirmed(sessionID)
}

// handleAgentMCP MCP Server配置管理 (CRUD)

func handleAgentMCP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	switch r.Method {
	case http.MethodGet:
		// 列出所有 MCP 配置，添加 transport/status 字段供前端渲染
		configs := agentMCPSupervisor.ListConfigs()
		type mcpServerView struct {
			agent.MCPServerConfig
			Transport string `json:"transport"`
			Status    string `json:"status"`
			Builtin   bool   `json:"builtin"` // 标识内置 MCP（不可删除）
		}
		views := make([]mcpServerView, 0, len(configs)+1)

		// 首先添加内置的 DataToolbox MCP（如果启用）
		dataOntologyMu.RLock()
		mcpEnabled := dataOntologyMCPEnabled == nil || *dataOntologyMCPEnabled
		dataOntologyMu.RUnlock()
		if mcpEnabled {
			views = append(views, mcpServerView{
				MCPServerConfig: agent.MCPServerConfig{
					ID:          "builtin-datatoolbox",
					Name:        "DataToolbox MCP (内置)",
					Type:        "streamable-http",
					URL:         mcpLoopbackAddr + "/mcp",
					Headers:     map[string]string{"X-Internal-Call": "datatoolbox-agent"},
					Enabled:     true,
					Description: "DataToolbox 内置 MCP 服务，提供数据库查询、接口调用等 12 个工具",
				},
				Transport: "streamable-http",
				Status:    "running", // 内置 MCP 总是 running（随主服务启动）
				Builtin:   true,
			})
		}

		// 然后添加用户配置的外部 MCP
		for _, cfg := range configs {
			transport := "stdio"
			if cfg.Type != "" {
				transport = cfg.Type
			} else if cfg.URL != "" {
				transport = "sse"
			} else if len(cfg.Args) > 0 {
				transport = "stdio"
			}
			status := "stopped"
			// 检查进程是否在运行
			if agentMCPSupervisor.IsRunning(cfg.ID) {
				status = "running"
			}
			views = append(views, mcpServerView{
				MCPServerConfig: cfg,
				Transport:       transport,
				Status:          status,
				Builtin:         false,
			})
		}
		apiSuccess(w, map[string]interface{}{"mcp_servers": views})

	case http.MethodPost:
		// 新增 MCP 配置
		var cfg agent.MCPServerConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		if cfg.ID == "" {
			cfg.ID = uuid.New().String()
		}
		agentMCPSupervisor.AddConfig(cfg)
		if err := saveAgentConfig(); err != nil {
			log.Printf("[agent] 保存配置失败: %v", err)
		}
		apiSuccess(w, cfg)

	case http.MethodPut:
		// 更新 MCP 配置
		var cfg agent.MCPServerConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		if cfg.ID == "" {
			apiBadRequest(w, "缺少 id 字段")
			return
		}
		agentMCPSupervisor.AddConfig(cfg)
		if err := saveAgentConfig(); err != nil {
			log.Printf("[agent] 保存配置失败: %v", err)
		}
		apiSuccess(w, cfg)

	case http.MethodDelete:
		// 删除 MCP 配置
		var req struct {
			ID string `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		if req.ID == "" {
			apiBadRequest(w, "缺少 id 字段")
			return
		}
		if err := agentMCPSupervisor.RemoveConfig(req.ID); err != nil {
			apiInternalError(w, fmt.Sprintf("删除MCP配置失败: %v", err))
			return
		}
		if err := saveAgentConfig(); err != nil {
			log.Printf("[agent] 保存配置失败: %v", err)
		}
		apiSuccess(w, map[string]interface{}{"deleted": true})

	default:
		apiMethodNotAllowed(w, "不支持的请求方法")
	}
}

// handleAgentSkill Skill配置管理 (CRUD)

func handleAgentSkill(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	switch r.Method {
	case http.MethodGet:
		// 列出所有 Skill
		skills := agentSkillRegistry.List()
		apiSuccess(w, skills)

	case http.MethodPost:
		// 新增 Skill
		var cfg agent.SkillConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		if cfg.ID == "" {
			cfg.ID = uuid.New().String()
		}
		cfg.LoadedAt = time.Now().UTC().Format(time.RFC3339)
		agentSkillRegistry.Add(cfg)
		if err := saveAgentConfig(); err != nil {
			log.Printf("[agent] 保存配置失败: %v", err)
		}
		apiSuccess(w, cfg)

	case http.MethodPut:
		// 更新 Skill
		var cfg agent.SkillConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		if cfg.ID == "" {
			apiBadRequest(w, "缺少 id 字段")
			return
		}
		cfg.LoadedAt = time.Now().UTC().Format(time.RFC3339)
		agentSkillRegistry.Add(cfg)
		if err := saveAgentConfig(); err != nil {
			log.Printf("[agent] 保存配置失败: %v", err)
		}
		apiSuccess(w, cfg)

	case http.MethodDelete:
		// 删除 Skill
		var req struct {
			ID string `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		if req.ID == "" {
			apiBadRequest(w, "缺少 id 字段")
			return
		}
		agentSkillRegistry.Remove(req.ID)
		if err := saveAgentConfig(); err != nil {
			log.Printf("[agent] 保存配置失败: %v", err)
		}
		apiSuccess(w, map[string]interface{}{"deleted": true})

	default:
		apiMethodNotAllowed(w, "不支持的请求方法")
	}
}

// handleAgentMode 获取/设置当前会话模式

func handleAgentMode(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	switch r.Method {
	case http.MethodGet:
		// 获取当前模式 — 始终返回 cluster
		apiSuccess(w, map[string]interface{}{
			"mode": "cluster",
		})

	case http.MethodPost:
		// 设置当前模式 — 忽略请求，始终设为 cluster
		username, _ := getDataOntologyUserFromRequest(r)
		key := username
		if key == "" {
			key = "default"
		}
		agentSessionModes[key] = "cluster"
		log.Printf("[agent] mode set: user=%s, mode=cluster (forced)", key)
		apiSuccess(w, map[string]interface{}{
			"mode": "cluster",
		})

	default:
		apiMethodNotAllowed(w, "不支持的请求方法")
	}
}

// handleAgentStatus 集群模式状态

func handleAgentStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method != http.MethodGet {
		apiMethodNotAllowed(w, "只支持GET请求")
		return
	}

	providers := agentProviderRegistry.List()
	mcpConfigs := agentMCPSupervisor.ListConfigs()
	skills := agentSkillRegistry.List()

	// 统计活跃 agent 数量
	activeAgents := 0
	for _, p := range providers {
		if p.Enabled {
			activeAgents++
		}
	}

	apiSuccess(w, map[string]interface{}{
		"mode":           "cluster",
		"active_agents":  activeAgents,
		"providers":      providers,
		"mcp_servers":    mcpConfigs,
		"skills":         skills,
		"tools_count":    len(skills),
		"toolsets_count": len(mcpConfigs),
	})
}

// handleGovernanceShareAICompletion 分享任务专用 AI 调用（免授权）

func handleGovernanceShareAICompletion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	// 分享任务通过 URL 中的 share_token 验证，无需用户 token
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持 POST"})
		return
	}
	var req AICompletionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}
	if req.Prompt == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "prompt 不能为空"})
		return
	}
	dataOntologyMu.RLock()
	aiConfig := dataOntologyAIConfig
	dataOntologyMu.RUnlock()
	if aiConfig == nil || aiConfig.URL == "" || aiConfig.APIKey == "" || aiConfig.Model == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请先在 AI 助手中配置 AI 设置（URL、API Key、模型）"})
		return
	}
	content, err := callAIService(aiConfig, req.Prompt)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "AI 调用失败: " + err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "content": content})
}

// isCreateApiRequest 检测是否是创建接口的请求

func isCreateApiRequest(message string) bool {
	keywords := []string{"创建接口", "新建接口", "生成接口", "添加接口", "帮我写接口", "帮我创建", "生成API", "创建API"}
	lowerMessage := strings.ToLower(message)
	for _, keyword := range keywords {
		if strings.Contains(lowerMessage, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}

// isValidApiPath 验证 API 路径格式：必须是 /api/xxx/yyy（两级路径）

func isValidApiPath(path string) bool {
	// 去除首尾空格
	path = strings.TrimSpace(path)

	// 拒绝路径中包含空格
	if strings.Contains(path, " ") {
		return false
	}

	// 路径必须以 /api/ 开头
	if !strings.HasPrefix(path, "/api/") {
		return false
	}
	// 去掉 /api/ 前缀后，必须有2-3级路径（xxx/yyy 或 xxx/yyy/zzz）
	rest := strings.TrimPrefix(path, "/api/")
	parts := strings.Split(rest, "/")
	// 必须有2-3部分，且每部分不为空
	if len(parts) < 2 || len(parts) > 3 {
		return false
	}
	for _, p := range parts {
		if p == "" {
			return false
		}
	}
	return true
}

// IntentInfo 意图检测结果

type IntentInfo struct {
	DetectedModule string  `json:"detected_module,omitempty"`
	Confidence     float64 `json:"confidence"`
	Reason         string  `json:"reason"`
}

// detectUserIntent 检测用户意图，返回意图信息和置信度

func detectUserIntent(message string) IntentInfo {
	lowerMsg := strings.ToLower(message)

	// 检测 @ 模块引用（最高优先级，直接路由）
	moduleNames := map[string]string{
		"通用提问": "db-manage", "数据库管理": "db-manage", "接口制作": "api-dispatch", "接口分发": "api-dispatch",
		"数据治理": "data-governance", "质量审计": "quality-audit", "本体查询": "ontology", "本体论": "ontology",
		"小模型": "small-model",
	}
	moduleIDs := map[string]string{
		"db-manage": "db-manage", "api-dispatch": "api-dispatch", "data-governance": "data-governance",
		"quality-audit": "quality-audit", "ontology": "ontology", "small-model": "small-model",
	}
	// 合并别名
	moduleAliases := map[string]string{
		"接口": "api-dispatch", "api": "api-dispatch", "创建接口": "api-dispatch",
		"治理": "data-governance", "定时任务": "data-governance", "导入": "data-governance",
		"质量": "quality-audit", "审计": "quality-audit", "校验": "quality-audit",
		"本体": "ontology", "语义": "ontology", "概念": "ontology",
		"本地模型": "small-model", "离线": "small-model",
		"查询": "db-manage", "提问": "db-manage", "问答": "db-manage",
	}
	atMatches := regexp.MustCompile(`@(\S+)`).FindAllStringSubmatch(message, -1)
	for _, m := range atMatches {
		if len(m) < 2 {
			continue
		}
		ref := m[1]
		refLower := strings.ToLower(ref)
		// 精确匹配模块名
		if mod, ok := moduleNames[ref]; ok {
			return IntentInfo{DetectedModule: mod, Confidence: 0.99, Reason: "用户通过 @" + ref + " 明确指定意图"}
		}
		// 匹配模块 ID
		if mod, ok := moduleIDs[refLower]; ok {
			return IntentInfo{DetectedModule: mod, Confidence: 0.99, Reason: "用户通过 @" + ref + " 明确指定意图"}
		}
		// 匹配别名（忽略大小写）
		if mod, ok := moduleAliases[ref]; ok {
			return IntentInfo{DetectedModule: mod, Confidence: 0.99, Reason: "用户通过 @" + ref + " 明确指定意图"}
		}
		if mod, ok := moduleAliases[refLower]; ok {
			return IntentInfo{DetectedModule: mod, Confidence: 0.99, Reason: "用户通过 @" + ref + " 明确指定意图"}
		}
		// 别名包含匹配
		for alias, mod := range moduleAliases {
			if strings.Contains(strings.ToLower(alias), refLower) || strings.Contains(refLower, strings.ToLower(alias)) {
				return IntentInfo{DetectedModule: mod, Confidence: 0.95, Reason: "用户通过 @" + ref + " 指定意图（别名匹配）"}
			}
		}
		// 模糊匹配模块名（忽略大小写）
		for name, mod := range moduleNames {
			if strings.Contains(strings.ToLower(name), refLower) {
				return IntentInfo{DetectedModule: mod, Confidence: 0.95, Reason: "用户通过 @" + ref + " 指定意图（模糊匹配）"}
			}
		}
	}

	// 接口调用关键词（高置信度）
	apiCallKeywords := []string{"调用接口", "试试接口", "测试接口", "调用一下", "试试看", "接口调用", "调用api", "测试api", "接口测试", "看看接口返回什么", "接口返回什么数据", "接口数据", "看看接口"}
	for _, kw := range apiCallKeywords {
		if strings.Contains(lowerMsg, strings.ToLower(kw)) {
			return IntentInfo{DetectedModule: "api-dispatch", Confidence: 0.95, Reason: "包含接口调用关键词: " + kw}
		}
	}

	// 接口创建关键词（高置信度）
	apiKeywords := []string{"创建接口", "新建接口", "生成接口", "添加接口", "帮我写接口", "生成api", "创建api", "添加api", "写接口", "做接口", "制作接口"}
	for _, kw := range apiKeywords {
		if strings.Contains(lowerMsg, strings.ToLower(kw)) {
			return IntentInfo{DetectedModule: "api-dispatch", Confidence: 0.95, Reason: "包含接口创建关键词: " + kw}
		}
	}

	// "接口" 单独出现（中等偏高置信度，优先于通用查询关键词）
	if strings.Contains(lowerMsg, "接口") || strings.Contains(lowerMsg, "api") {
		return IntentInfo{DetectedModule: "api-dispatch", Confidence: 0.85, Reason: "包含接口/API关键词"}
	}

	// 数据治理关键词
	governanceKeywords := []string{"创建任务", "新建任务", "生成任务", "定时任务", "交互任务", "数据治理", "定时执行", "文件导入"}
	for _, kw := range governanceKeywords {
		if strings.Contains(lowerMsg, strings.ToLower(kw)) {
			return IntentInfo{DetectedModule: "data-governance", Confidence: 0.9, Reason: "包含数据治理关键词: " + kw}
		}
	}

	// 质量审计关键词
	qualityKeywords := []string{"质量规则", "数据质量", "质量检查", "质量审计", "校验规则"}
	for _, kw := range qualityKeywords {
		if strings.Contains(lowerMsg, strings.ToLower(kw)) {
			return IntentInfo{DetectedModule: "quality-audit", Confidence: 0.9, Reason: "包含质量审计关键词: " + kw}
		}
	}

	// 本体查询关键词
	ontologyKeywords := []string{"本体", "概念", "实体关系", "语义"}
	for _, kw := range ontologyKeywords {
		if strings.Contains(lowerMsg, strings.ToLower(kw)) {
			return IntentInfo{DetectedModule: "ontology", Confidence: 0.85, Reason: "包含本体相关关键词: " + kw}
		}
	}

	// 小模型关键词
	smallModelKeywords := []string{"小模型", "本地模型", "离线模型"}
	for _, kw := range smallModelKeywords {
		if strings.Contains(lowerMsg, strings.ToLower(kw)) {
			return IntentInfo{DetectedModule: "small-model", Confidence: 0.85, Reason: "包含小模型关键词: " + kw}
		}
	}

	// 询问数据库信息（中等置信度）
	dbInfoKeywords := []string{"有哪些表", "什么表", "表结构", "字段有哪些", "数据库里有什么"}
	for _, kw := range dbInfoKeywords {
		if strings.Contains(lowerMsg, strings.ToLower(kw)) {
			return IntentInfo{DetectedModule: "db-manage", Confidence: 0.8, Reason: "包含数据库查询关键词: " + kw}
		}
	}

	// 通用查询关键词（低置信度）
	queryKeywords := []string{"查询", "统计", "有多少", "列出", "显示", "查找", "搜索"}
	for _, kw := range queryKeywords {
		if strings.Contains(lowerMsg, strings.ToLower(kw)) {
			return IntentInfo{DetectedModule: "db-manage", Confidence: 0.5, Reason: "包含通用查询关键词: " + kw}
		}
	}

	// 未检测到明确意图
	return IntentInfo{DetectedModule: "", Confidence: 0.0, Reason: "未检测到明确意图"}
}

// detectIntentWithAI 使用 AI 进行意图分类

func detectIntentWithAI(config *AIConfig, capabilities *AICapabilities, message string) IntentInfo {
	prompt := `你是一个意图分类助手。分析用户消息，判断用户想要做什么操作。

可选操作类型：
1. api-dispatch - 创建 API 接口、生成数据服务
2. data-governance - 创建定时任务、数据导入导出、数据处理
3. quality-audit - 数据质量检查、校验规则
4. ontology - 本体查询、概念关系、语义分析
5. small-model - 小模型相关、本地模型、离线推理
6. db-manage - 通用数据查询、统计、了解表结构

用户消息：` + message + `

请只返回一个 JSON 对象，格式如下：
{"module": "操作类型ID", "confidence": 0.95, "reason": "判断理由"}

confidence 范围 0-1，表示置信度。如果不确定，confidence 设为较低值。`

	// 调用 AI
	response, err := callAIServiceWithCapabilities(config, capabilities, prompt)
	if err != nil {
		log.Printf("[AI Intent] AI 调用失败: %v", err)
		return IntentInfo{DetectedModule: "", Confidence: 0.0, Reason: "AI 调用失败: " + err.Error()}
	}

	// 解析 JSON
	response = strings.TrimSpace(response)
	// 去除可能的 markdown 代码块
	if strings.HasPrefix(response, "```") {
		lines := strings.Split(response, "\n")
		var jsonLines []string
		inBlock := false
		for _, line := range lines {
			if strings.HasPrefix(line, "```") {
				inBlock = !inBlock
				continue
			}
			if inBlock {
				jsonLines = append(jsonLines, line)
			}
		}
		response = strings.Join(jsonLines, "\n")
	}

	var result struct {
		Module     string      `json:"module"`
		Confidence interface{} `json:"confidence"`
		Reason     string      `json:"reason"`
	}

	if err := json.Unmarshal([]byte(response), &result); err != nil {
		// 尝试提取 JSON 对象
		objStart := strings.Index(response, "{")
		objEnd := strings.LastIndex(response, "}")
		if objStart != -1 && objEnd > objStart {
			if err2 := json.Unmarshal([]byte(response[objStart:objEnd+1]), &result); err2 != nil {
				log.Printf("[AI Intent] JSON 解析失败: %v, response: %s", err2, response)
				return IntentInfo{DetectedModule: "", Confidence: 0.0, Reason: "JSON 解析失败"}
			}
		} else {
			log.Printf("[AI Intent] JSON 解析失败: %v, response: %s", err, response)
			return IntentInfo{DetectedModule: "", Confidence: 0.0, Reason: "JSON 解析失败"}
		}
	}

	// 将 confidence 转换为 float64（容错：可能是字符串、整数等）
	var confidence float64
	switch v := result.Confidence.(type) {
	case float64:
		confidence = v
	case string:
		confidence, _ = strconv.ParseFloat(v, 64)
	case int:
		confidence = float64(v)
	default:
		confidence = 0.5
	}

	// 验证模块是否有效
	validModules := map[string]bool{
		"api-dispatch":    true,
		"data-governance": true,
		"quality-audit":   true,
		"ontology":        true,
		"small-model":     true,
		"db-manage":       true,
	}

	if !validModules[result.Module] {
		log.Printf("[AI Intent] 无效模块: %s", result.Module)
		return IntentInfo{DetectedModule: "", Confidence: 0.0, Reason: "无效模块: " + result.Module}
	}

	log.Printf("[AI Intent] AI 分类结果: module=%s, confidence=%.2f, reason=%s", result.Module, confidence, result.Reason)
	return IntentInfo{
		DetectedModule: result.Module,
		Confidence:     confidence,
		Reason:         result.Reason,
	}
}

// isGovernanceTaskRequest 检测是否是数据治理任务相关请求（创建/生成/修改 定时或交互任务）

func isGovernanceTaskRequest(message string) bool {
	keywords := []string{
		"创建任务", "新建任务", "生成任务", "添加任务", "帮我创建任务", "帮我生成任务",
		"定时任务", "交互任务", "定时执行", "按计划执行", "上传文件处理", "文件导入",
		"修改任务", "更新任务", "改一下任务",
	}
	lowerMessage := strings.ToLower(message)
	for _, keyword := range keywords {
		if strings.Contains(lowerMessage, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}

// governanceTaskDraft 供前端确认的数据治理任务草稿（与 GovernanceTask 字段对齐，无 id/created_at 等）

type governanceTaskDraft struct {
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	Description string   `json:"description,omitempty"`
	JsCode      string   `json:"js_code"`
	DatabaseID  string   `json:"database_id,omitempty"`
	CronExpr    string   `json:"cron_expr,omitempty"`
	InputType   string   `json:"input_type,omitempty"`
	AcceptExts  []string `json:"accept_exts,omitempty"`
	IsUpdate    bool     `json:"is_update,omitempty"`
	TaskID      string   `json:"task_id,omitempty"`
}

// buildGovernanceTaskPrompt 构建数据治理任务生成的提示词，包含任务约束

func buildGovernanceTaskPrompt(userMessage string, dbSchemas []map[string]interface{}) string {
	constraint := "\n【数据治理任务约束】你必须严格按以下规则生成任务，并只输出一个 JSON 对象（不要用 markdown 代码块包裹），不要其他解释。\n\n"
	constraint += "1. 任务类型 type 只能是 \"scheduled\"（定时任务）或 \"interactive\"（交互任务）。\n"
	constraint += "2. 定时任务：必须包含 cron_expr，格式为 \"分 时 日 月 周\"（五段，空格分隔），例如 \"0 2 * * *\" 表示每天凌晨2点，\"30 8 * * 1-5\" 表示工作日 8:30。\n"
	constraint += "3. 交互任务：必须包含 input_type（\"file\" | \"text\" | \"both\"）和 accept_exts（数组，如 [\".xlsx\", \".csv\", \".docx\"]）。\n"
	constraint += "4. js_code 必须是可运行的 JavaScript 代码。运行环境提供：\n"
	constraint += "   - gov.log(msg)、gov.readExcel(file)、gov.readCSV(csvText)、gov.querySQL(sql)、gov.executeSQL(sql)\n"
	constraint += "   - INPUT_FILE（File 对象，交互任务文件上传时）、INPUT_TEXT（字符串，交互任务文本输入时）\n"
	constraint += "   - XLSX、Papa、mammoth 等库。只输出代码，不要用 ``` 包裹。\n"
	constraint += "5. 输出 JSON 字段：name（必填）、type（必填）、description（可选）、js_code（必填）、database_id（可选，从下面数据库 id 中选）、cron_expr（定时必填）、input_type（交互必填）、accept_exts（交互可选）。\n"
	prompt := "你是一个数据治理任务设计专家。用户希望根据需求生成或修改数据治理任务（定时任务或交互任务）。\n"
	prompt += constraint
	if len(dbSchemas) > 0 {
		prompt += "\n【可选数据库】当前对话关联的数据库 id 与名称：\n"
		for _, s := range dbSchemas {
			id, _ := s["id"].(string)
			name, _ := s["name"].(string)
			prompt += fmt.Sprintf("  - id: %q, name: %s\n", id, name)
		}
		prompt += "若任务需要写库或查库，请将 database_id 设为上述之一。\n"
	}
	prompt += "\n用户需求：\n" + userMessage
	prompt += "\n\n请只输出一个 JSON 对象，包含 name, type, description, js_code, database_id（如需）, cron_expr（定时任务）, input_type 与 accept_exts（交互任务）。不要 markdown，不要解释。"
	return prompt
}

// parseGovernanceTaskDraft 从 AI 回复中解析任务草稿并做约束校验

func parseGovernanceTaskDraft(aiResponse string, defaultDBID string) (*governanceTaskDraft, string) {
	// 提取 JSON：去除 markdown 代码块
	s := strings.TrimSpace(aiResponse)
	for _, prefix := range []string{"```json", "```javascript", "```js", "```"} {
		if strings.HasPrefix(s, prefix) {
			s = s[len(prefix):]
			break
		}
	}
	if idx := strings.Index(s, "```"); idx >= 0 {
		s = s[:idx]
	}
	s = strings.TrimSpace(s)

	var draft governanceTaskDraft
	if err := json.Unmarshal([]byte(s), &draft); err != nil {
		return nil, "JSON 解析失败: " + err.Error()
	}
	if draft.Name == "" {
		return nil, "任务名称 name 不能为空"
	}
	if draft.Type != "scheduled" && draft.Type != "interactive" {
		return nil, "type 必须是 scheduled 或 interactive"
	}
	if draft.JsCode == "" {
		return nil, "js_code 不能为空"
	}
	if draft.Type == "scheduled" {
		parts := strings.Fields(draft.CronExpr)
		if len(parts) != 5 {
			return nil, "定时任务 cron_expr 必须为五段：分 时 日 月 周"
		}
	}
	if draft.Type == "interactive" {
		if draft.InputType != "file" && draft.InputType != "text" && draft.InputType != "both" {
			draft.InputType = "file"
		}
		if draft.AcceptExts == nil {
			draft.AcceptExts = []string{".xlsx", ".csv"}
		}
	}
	if draft.DatabaseID == "" && defaultDBID != "" {
		draft.DatabaseID = defaultDBID
	}
	return &draft, ""
}

// handleAIGovernanceTask 处理 @数据治理 时的 AI 生成任务草稿，供用户确认后创建或更新

func handleAIGovernanceTask(w http.ResponseWriter, flusher http.Flusher, queryReq *AIQueryRequest, dbSchemas []map[string]interface{}, aiConfig *AIConfig) {
	if !isGovernanceTaskRequest(queryReq.Message) {
		sendSSE(w, "error", map[string]interface{}{
			"message": "请说明要创建或修改的数据治理任务需求，例如：创建定时任务每天凌晨导入、或创建一个上传 Excel 的交互任务。",
		})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	sendSSE(w, "thinking", map[string]interface{}{
		"message": "正在根据您的需求生成数据治理任务草稿（已加入任务约束）...",
	})
	flusher.Flush()

	prompt := buildGovernanceTaskPrompt(queryReq.Message, dbSchemas)
	aiResponse, err := callAIService(aiConfig, prompt)
	if err != nil {
		sendSSE(w, "error", map[string]interface{}{
			"message": "AI 服务调用失败: " + err.Error(),
		})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	defaultDBID := ""
	if len(queryReq.Databases) > 0 {
		defaultDBID = queryReq.Databases[0]
	}
	draft, parseErr := parseGovernanceTaskDraft(aiResponse, defaultDBID)
	if draft == nil {
		sendSSE(w, "error", map[string]interface{}{
			"message":  "未能生成有效任务草稿。" + parseErr,
			"response": aiResponse,
		})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	sendSSE(w, "governance_task_draft", map[string]interface{}{
		"message": "已根据您的需求生成任务草稿，请确认或编辑后再创建/更新。",
		"task":    draft,
	})
	sendSSE(w, "done", map[string]interface{}{})
	flusher.Flush()
}

// handleAIQualityRule 处理AI创建数据质量审核规则

func handleAIQualityRule(w http.ResponseWriter, flusher http.Flusher, queryReq *AIQueryRequest, dbSchemas []map[string]interface{}, aiConfig *AIConfig) {
	sendSSE(w, "thinking", map[string]interface{}{
		"message": "正在根据您的需求生成数据质量审核规则...",
	})
	flusher.Flush()

	prompt := "你是数据质量审核专家。用户需要创建数据质量审核规则，请根据用户需求和以下数据库结构生成规则配置。\n\n"
	prompt += "数据库结构：\n"
	for _, schema := range dbSchemas {
		prompt += fmt.Sprintf("- 数据库: %s (类型: %s)\n", schema["name"], schema["type"])
		if tables, ok := schema["tables"].([]map[string]interface{}); ok {
			for _, t := range tables {
				prompt += fmt.Sprintf("  - 表: %s\n", t["name"])
			}
		}
	}
	prompt += "\n用户需求：" + queryReq.Message + "\n\n"
	prompt += "请生成规则配置，JSON格式：\n"
	prompt += "```json\n"
	prompt += "{\n"
	prompt += "  \"nm\": \"010101\",\n"
	prompt += "  \"xh\": \"0101\",\n"
	prompt += "  \"name\": \"规则名称\",\n"
	prompt += "  \"category\": \"完整性\",\n"
	prompt += "  \"sql\": \"SELECT * FROM table WHERE field IS NULL\"\n"
	prompt += "}\n"
	prompt += "```\n\n"
	prompt += "规则说明：\n"
	prompt += "- nm: 6位规则编号\n"
	prompt += "- xh: 层级编码\n"
	prompt += "- sql: 查询违规数据的SQL（返回违规记录）\n"

	aiResponse, err := callAIService(aiConfig, prompt)
	if err != nil {
		sendSSE(w, "error", map[string]interface{}{"message": "AI服务调用失败: " + err.Error()})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	jsonStart := strings.Index(aiResponse, "{")
	jsonEnd := strings.LastIndex(aiResponse, "}")
	if jsonStart == -1 || jsonEnd == -1 || jsonEnd <= jsonStart {
		sendSSE(w, "error", map[string]interface{}{"message": "未能解析规则配置", "response": aiResponse})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	jsonStr := extractJSONObject(aiResponse[jsonStart : jsonEnd+1])
	if jsonStr == "" {
		jsonStr = cleanAIResponse(aiResponse[jsonStart : jsonEnd+1])
	}
	jsonStr = extractJSONObject(jsonStr)
	var rule map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &rule); err != nil {
		sendSSE(w, "error", map[string]interface{}{"message": "JSON解析失败: " + err.Error(), "response": aiResponse})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	sendSSE(w, "quality_rule_draft", map[string]interface{}{
		"message": "已生成数据质量审核规则，请确认后创建。",
		"rule":    rule,
	})
	sendSSE(w, "done", map[string]interface{}{})
	flusher.Flush()
}

// handleAISmallModel 处理AI创建小模型

func handleAISmallModel(w http.ResponseWriter, flusher http.Flusher, queryReq *AIQueryRequest, dbSchemas []map[string]interface{}, aiConfig *AIConfig) {
	sendSSE(w, "thinking", map[string]interface{}{
		"message": "正在根据您的需求生成小模型配置...",
	})
	flusher.Flush()

	prompt := "你是数据处理专家。用户需要创建一个小模型（JavaScript 数据处理函数），请根据用户需求生成配置。\n\n"
	prompt += "用户需求：" + queryReq.Message + "\n\n"
	prompt += "请生成小模型配置，JSON格式：\n"
	prompt += "```json\n"
	prompt += "{\n"
	prompt += "  \"name\": \"模型名称\",\n"
	prompt += "  \"description\": \"模型描述\",\n"
	prompt += "  \"input_type\": \"json\",\n"
	prompt += "  \"output_type\": \"json\",\n"
	prompt += "  \"js_code\": \"async function run(input) { return input; }\"\n"
	prompt += "}\n"
	prompt += "```\n\n"
	prompt += "说明：\n"
	prompt += "- js_code: 异步函数，接收 input 参数，返回处理结果\n"
	prompt += "- input_type/output_type: json/text/number\n"

	aiResponse, err := callAIService(aiConfig, prompt)
	if err != nil {
		sendSSE(w, "error", map[string]interface{}{"message": "AI服务调用失败: " + err.Error()})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	jsonStart := strings.Index(aiResponse, "{")
	jsonEnd := strings.LastIndex(aiResponse, "}")
	if jsonStart == -1 || jsonEnd == -1 {
		sendSSE(w, "error", map[string]interface{}{"message": "未能解析配置", "response": aiResponse})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	jsonStr := extractJSONObject(aiResponse[jsonStart : jsonEnd+1])
	if jsonStr == "" {
		jsonStr = cleanAIResponse(aiResponse[jsonStart : jsonEnd+1])
	}
	var model map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &model); err != nil {
		sendSSE(w, "error", map[string]interface{}{"message": "JSON解析失败: " + err.Error(), "response": aiResponse})
		sendSSE(w, "done", map[string]interface{}{})
		flusher.Flush()
		return
	}

	sendSSE(w, "small_model_draft", map[string]interface{}{
		"message": "已生成小模型配置，请确认后创建。",
		"model":   model,
	})
	sendSSE(w, "done", map[string]interface{}{})
	flusher.Flush()
}

// handleAICreateApi 处理AI创建接口请求

func handleAICreateApi(w http.ResponseWriter, flusher http.Flusher, queryReq *AIQueryRequest, dbSchemas []map[string]interface{}, aiConfig *AIConfig, aiCapabilities *AICapabilities) {

	// 如果 dbSchemas 尚未增强（tables 还是 []string），则获取字段信息
	needEnhance := false
	if len(dbSchemas) > 0 {
		if _, ok := dbSchemas[0]["tables"].([]string); ok {
			needEnhance = true
		}
	}

	if needEnhance {
		sendSSE(w, "thinking", map[string]interface{}{
			"message": "正在读取数据库表结构信息...",
		})
		flusher.Flush()

		dataOntologyMu.RLock()
		for i, schema := range dbSchemas {
			dbID, _ := schema["id"].(string)
			dbConfig, exists := dataOntologyDatabases[dbID]
			if !exists {
				continue
			}

			tables, _ := schema["tables"].([]string)
			var tablesWithColumns []map[string]interface{}

			// 使用表检索逻辑筛选相关表
			defaultMaxTables := 10
			retrievalConfig := aiConfig.TableRetrieval
			relevantTables, err := retrieveRelevantTables(queryReq.Message, dbConfig, retrievalConfig)
			if err != nil {
				log.Printf("表检索失败: %v, 使用前 %d 张表", err, defaultMaxTables)
				// 降级：截取前 N 张表
				if len(tables) > defaultMaxTables {
					tables = tables[:defaultMaxTables]
				}
				for _, tableName := range tables {
					columns, err := getTableColumns(dbConfig, tableName)
					if err != nil {
						log.Printf("获取表 %s 字段失败: %v", tableName, err)
						tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
							"name":    tableName,
							"columns": []map[string]interface{}{},
						})
						continue
					}

					tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
						"name":    tableName,
						"columns": columns,
					})
				}
			} else {
				// 使用检索结果
				if len(relevantTables) == 0 {
					// 检索结果为空，降级使用所有表
					log.Printf("[表检索] 未检索到相关表，降级使用前 %d 张表", defaultMaxTables)
					if len(tables) > defaultMaxTables {
						tables = tables[:defaultMaxTables]
					}
					for _, tableName := range tables {
						columns, err := getTableColumns(dbConfig, tableName)
						if err != nil {
							log.Printf("获取表 %s 字段失败: %v", tableName, err)
							tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
								"name":    tableName,
								"columns": []map[string]interface{}{},
							})
							continue
						}
						tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
							"name":    tableName,
							"columns": columns,
						})
					}
				} else {
					log.Printf("[表检索] 检索到 %d 张相关表", len(relevantTables))
					for _, result := range relevantTables {
						tableName := result.TableName
						columns, err := getTableColumns(dbConfig, tableName)
						if err != nil {
							log.Printf("获取表 %s 字段失败: %v", tableName, err)
							tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
								"name":    tableName,
								"columns": []map[string]interface{}{},
							})
							continue
						}

						tablesWithColumns = append(tablesWithColumns, map[string]interface{}{
							"name":    tableName,
							"columns": columns,
						})
					}
				}
			}

			dbSchemas[i]["tables"] = tablesWithColumns
		}
		dataOntologyMu.RUnlock()
	}

	sendSSE(w, "thinking", map[string]interface{}{
		"message": "正在分析您的需求并生成接口配置...",
	})
	flusher.Flush()

	// 获取已有接口列表，用于路径唯一性校验和分类参考
	dataOntologyMu.RLock()
	existingApis := make([]map[string]interface{}, 0, len(dataOntologyApis))
	for _, api := range dataOntologyApis {
		existingApis = append(existingApis, map[string]interface{}{
			"name":   api.Name,
			"path":   api.Path,
			"method": api.Method,
		})
	}
	dataOntologyMu.RUnlock()

	// 构建创建接口的提示词
	prompt := buildCreateApiPrompt(queryReq.Message, dbSchemas, existingApis)

	// 重试机制：最多重试3次
	maxRetries := 3
	var apiConfig map[string]interface{}

	for attempt := 1; attempt <= maxRetries; attempt++ {
		// 调用AI服务
		aiResponse, err := callAIServiceWithCapabilities(aiConfig, aiCapabilities, prompt)
		if err != nil {
			sendSSE(w, "error", map[string]interface{}{
				"message": "AI服务调用失败: " + err.Error(),
			})
			sendSSE(w, "done", map[string]interface{}{})
			flusher.Flush()
			return
		}

		// 解析AI返回的接口配置
		var parseError string
		apiConfig, parseError = parseApiConfigFromAI(aiResponse, dbSchemas)
		if apiConfig == nil {
			log.Printf("解析接口配置失败（第%d次尝试），AI响应: %s", attempt, aiResponse)
			if parseError != "" {
				log.Printf("解析错误: %s", parseError)
			}
			// 解析失败，构建重试提示词
			if attempt < maxRetries {
				prompt = buildCreateApiRetryPrompt(queryReq.Message, dbSchemas, existingApis, "无法解析接口配置: "+parseError, aiResponse)
				continue
			}
			// 最后一次尝试仍然失败
			sendSSE(w, "error", map[string]interface{}{
				"message":  "AI未能生成有效的接口配置。" + parseError,
				"response": aiResponse,
			})
			sendSSE(w, "done", map[string]interface{}{})
			flusher.Flush()
			return
		}

		// 校验 path 格式和 path+method 唯一性
		pathStr, _ := apiConfig["path"].(string)
		methodStr, _ := apiConfig["method"].(string)

		// 校验路径格式
		if !isValidApiPath(pathStr) {
			log.Printf("路径格式校验失败（第%d次尝试）: %s 不是有效路径", attempt, pathStr)
			if attempt < maxRetries {
				prompt = buildCreateApiRetryPrompt(queryReq.Message, dbSchemas, existingApis,
					fmt.Sprintf("接口路径格式错误: '%s' 不是有效的路径格式。必须是 /api/xxx/yyy 或 /api/xxx/yyy/zzz 格式，例如 /api/users/list 或 /api/logistics/shipment/status", pathStr), aiResponse)
				continue
			}
			sendSSE(w, "error", map[string]interface{}{
				"message":  fmt.Sprintf("路径格式校验失败（已重试%d次）: %s 不是有效的两级路径格式", maxRetries, pathStr),
				"response": aiResponse,
			})
			sendSSE(w, "done", map[string]interface{}{})
			flusher.Flush()
			return
		}

		// 校验 path+method 唯一性
		pathConflict := false
		var conflictApiName string
		for _, existingApi := range existingApis {
			existingPath, _ := existingApi["path"].(string)
			existingMethod, _ := existingApi["method"].(string)
			if existingPath == pathStr && strings.EqualFold(existingMethod, methodStr) {
				pathConflict = true
				conflictApiName, _ = existingApi["name"].(string)
				break
			}
		}
		if pathConflict {
			log.Printf("路径唯一性校验失败（第%d次尝试）: %s %s 与已有接口 '%s' 冲突", attempt, methodStr, pathStr, conflictApiName)
			if attempt < maxRetries {
				prompt = buildCreateApiRetryPrompt(queryReq.Message, dbSchemas, existingApis,
					fmt.Sprintf("接口路径冲突: %s %s 已被接口 '%s' 使用，请使用不同的路径或方法", methodStr, pathStr, conflictApiName), aiResponse)
				continue
			}
			sendSSE(w, "error", map[string]interface{}{
				"message":  fmt.Sprintf("路径唯一性校验失败（已重试%d次）: %s %s 已存在", maxRetries, methodStr, pathStr),
				"response": aiResponse,
			})
			sendSSE(w, "done", map[string]interface{}{})
			flusher.Flush()
			return
		}

		log.Printf("路径校验成功（第%d次尝试）: %s %s", attempt, methodStr, pathStr)

		// 校验SQL中的表名和字段名是否存在
		sqlStr, _ := apiConfig["sql"].(string)
		if sqlStr != "" && len(dbSchemas) > 0 {
			// 静态校验：检查表名和字段名
			valid, validationError := validateSQLTablesAndFields(sqlStr, dbSchemas)
			if !valid {
				log.Printf("SQL静态校验失败（第%d次尝试）: %s", attempt, validationError)
				// 验证失败，构建重试提示词
				if attempt < maxRetries {
					prompt = buildCreateApiRetryPrompt(queryReq.Message, dbSchemas, existingApis, validationError, aiResponse)
					continue
				}
				// 最后一次尝试仍然失败
				sendSSE(w, "sql_validation_error", map[string]interface{}{
					"message":  "SQL静态校验失败（已重试" + fmt.Sprintf("%d", maxRetries) + "次）: " + validationError,
					"sql":      sqlStr,
					"response": aiResponse,
				})
				sendSSE(w, "done", map[string]interface{}{})
				flusher.Flush()
				return
			}
			log.Printf("SQL静态校验成功（第%d次尝试）", attempt)

			// 执行校验：在目标数据库上实际执行SQL，检查语法、权限、函数等运行时问题
			dbID, _ := dbSchemas[0]["id"].(string)
			if dbID != "" {
				sendSSE(w, "thinking", map[string]interface{}{
					"message": "正在执行SQL校验...",
				})
				flusher.Flush()

				validExec, execError := validateSQLByExecution(sqlStr, dbID)
				if !validExec {
					log.Printf("SQL执行校验失败（第%d次尝试）: %s", attempt, execError)
					// 执行校验失败，构建增强的错误信息（包含不存在的字段名和可用字段列表）
					enhancedError := buildMissingFieldsErrorMessage(execError, sqlStr, dbSchemas)
					// 执行校验失败，构建重试提示词
					if attempt < maxRetries {
						prompt = buildCreateApiRetryPrompt(queryReq.Message, dbSchemas, existingApis, enhancedError, aiResponse)
						continue
					}
					// 最后一次尝试仍然失败
					sendSSE(w, "sql_validation_error", map[string]interface{}{
						"message":  "SQL执行校验失败（已重试" + fmt.Sprintf("%d", maxRetries) + "次）: " + enhancedError,
						"sql":      sqlStr,
						"response": aiResponse,
					})
					sendSSE(w, "done", map[string]interface{}{})
					flusher.Flush()
					return
				}
				log.Printf("SQL执行校验成功（第%d次尝试）", attempt)
			}
		}

		// 从数据库表中查询实际值填充 default_params
		if len(dbSchemas) > 0 {
			dbID, _ := dbSchemas[0]["id"].(string)
			populateDefaultParamsFromDB(apiConfig, dbID)

			// 端到端验证：用 default_params 实际执行 SQL，验证能否返回数据
			sqlStr, _ := apiConfig["sql"].(string)
			defaultParams, _ := apiConfig["default_params"].(map[string]interface{})
			if sqlStr != "" && len(defaultParams) > 0 {
				sendSSE(w, "thinking", map[string]interface{}{
					"message": "正在验证默认参数是否能返回数据...",
				})
				flusher.Flush()

				e2eValid, e2eError, e2eResults := validateSQLWithDefaultParams(sqlStr, defaultParams, dbID)
				if !e2eValid {
					log.Printf("端到端验证失败（第%d次尝试）: %s", attempt, e2eError)
					// 端到端验证失败，构建重试提示词
					if attempt < maxRetries {
						// 构建更详细的错误信息，包含查询结果示例
						retryMsg := fmt.Sprintf("端到端验证失败: %s。你生成的SQL使用default_params执行后没有返回数据，这意味着default_params中的参数值在数据库中不存在。请调整SQL或default_params，确保使用数据库中实际存在的值。", e2eError)
						// 如果有部分结果（虽然当前为空），可以附加提示
						if e2eResults != nil && len(e2eResults) > 0 {
							retryMsg += fmt.Sprintf(" 部分查询结果: %v", e2eResults)
						}
						prompt = buildCreateApiRetryPrompt(queryReq.Message, dbSchemas, existingApis, retryMsg, aiResponse)
						continue
					}
					// 最后一次尝试仍然失败，仍然返回配置（但标记警告）
					log.Printf("端到端验证失败（已重试%d次），仍返回配置", maxRetries)
					// 在配置中添加警告信息
					if apiConfig != nil {
						apiConfig["_e2e_warning"] = e2eError
					}
				} else {
					log.Printf("端到端验证成功（第%d次尝试），返回 %d 行数据", attempt, len(e2eResults))
					// 将验证结果存入配置，供前端展示
					if apiConfig != nil && len(e2eResults) > 0 {
						apiConfig["_e2e_sample"] = e2eResults[0]
					}
				}
			}
		}

		// 验证成功，跳出重试循环
		break
	}

	// 返回接口配置供用户确认
	sendSSE(w, "api_config_generated", map[string]interface{}{
		"message": "已生成接口配置，请确认后创建",
		"config":  apiConfig,
	})
	sendSSE(w, "done", map[string]interface{}{})
	flusher.Flush()
}

// buildCreateApiPrompt 构建创建接口的提示词

func buildCreateApiPrompt(userMessage string, dbSchemas []map[string]interface{}, existingApis []map[string]interface{}) string {
	prompt := "你是一个API接口设计专家。用户需要创建一个数据库查询接口，请根据用户需求和以下真实数据库结构生成接口配置。\n\n"

	// 收集数据库类型信息，生成语法提示
	dbTypes := make(map[string]bool)
	for _, schema := range dbSchemas {
		if t, ok := schema["type"].(string); ok && t != "" {
			dbTypes[t] = true
		}
	}
	if len(dbTypes) > 0 {
		prompt += "【数据库类型与SQL语法要点】\n"
		prompt += "请根据以下数据库类型注意SQL语法差异，特别是分页写法：\n"
		for dbType := range dbTypes {
			switch strings.ToUpper(dbType) {
			case "DM", "ORACLE", "ORACLE12C":
				prompt += fmt.Sprintf("- 当前数据库类型为 %s，分页请使用 WHERE ROWNUM <= N 或 FETCH FIRST N ROWS ONLY，不要使用 LIMIT\n", dbType)
				prompt += "  示例: SELECT * FROM TABLE_NAME WHERE ROWNUM <= 10\n"
				prompt += "  示例: SELECT * FROM TABLE_NAME FETCH FIRST 10 ROWS ONLY\n"
				prompt += "  注意: DM/Oracle 不支持 LIMIT 语法，使用 LIMIT 会导致SQL执行失败\n"
			case "MYSQL", "MARIADB":
				prompt += fmt.Sprintf("- 当前数据库类型为 %s，分页使用 LIMIT N OFFSET M 语法\n", dbType)
				prompt += "  示例: SELECT * FROM TABLE_NAME LIMIT 10 OFFSET 0\n"
			case "POSTGRESQL", "PG":
				prompt += fmt.Sprintf("- 当前数据库类型为 %s，分页使用 LIMIT N OFFSET M 语法\n", dbType)
				prompt += "  示例: SELECT * FROM TABLE_NAME LIMIT 10 OFFSET 0\n"
			case "SQLSERVER", "MSSQL":
				prompt += fmt.Sprintf("- 当前数据库类型为 %s，分页使用 TOP N 或 OFFSET-FETCH 语法\n", dbType)
				prompt += "  示例: SELECT TOP 10 * FROM TABLE_NAME\n"
				prompt += "  示例: SELECT * FROM TABLE_NAME ORDER BY ID OFFSET 0 ROWS FETCH FIRST 10 ROWS ONLY\n"
			case "CLICKHOUSE":
				prompt += fmt.Sprintf("- 当前数据库类型为 %s，分页使用 LIMIT N 语法\n", dbType)
				prompt += "  示例: SELECT * FROM TABLE_NAME LIMIT 10\n"
			default:
				prompt += fmt.Sprintf("- 当前数据库类型为 %s，请使用该数据库兼容的分页语法\n", dbType)
			}
		}
		prompt += "\n"
	}

	prompt += "【重要】以下是真实的数据库结构信息，请严格基于这些表和字段生成SQL：\n\n"

	for _, schema := range dbSchemas {
		prompt += fmt.Sprintf("数据库: %s (类型: %s)\n", schema["name"], schema["type"])
		prompt += "=" + strings.Repeat("=", 60) + "\n"

		// 处理新格式（包含字段信息）
		if tables, ok := schema["tables"].([]map[string]interface{}); ok {
			for _, table := range tables {
				tableName := table["name"].(string)
				prompt += fmt.Sprintf("\n表名: %s\n", tableName)

				if columns, ok := table["columns"].([]map[string]interface{}); ok && len(columns) > 0 {
					prompt += "字段列表:\n"
					for _, col := range columns {
						colName := col["name"]
						colType := col["type"]
						if colComment, ok := col["comment"].(string); ok && colComment != "" {
							prompt += fmt.Sprintf("  - %s (%s) — %s\n", colName, colType, colComment)
						} else {
							prompt += fmt.Sprintf("  - %s (%s)\n", colName, colType)
						}
					}
				} else {
					prompt += "  （无法获取字段信息）\n"
				}
			}
		} else if tables, ok := schema["tables"].([]string); ok {
			// 兼容旧格式（只有表名）
			prompt += "表列表: " + strings.Join(tables, ", ") + "\n"
		}

		// 添加关系信息
		if relations, ok := schema["relations"].([]OntologyRelation); ok && len(relations) > 0 {
			prompt += "\n表间关系（可用于JOIN参考）:\n"
			prompt += strings.Repeat("-", 40) + "\n"
			for _, rel := range relations {
				prompt += fmt.Sprintf("  • %s\n", rel.Name)
				prompt += fmt.Sprintf("    %s.%s ↔ %s.%s\n",
					rel.Source.TableName, rel.Source.FieldName,
					rel.Target.TableName, rel.Target.FieldName)
				if rel.Description != "" {
					prompt += fmt.Sprintf("    说明: %s\n", rel.Description)
				}
			}
			prompt += "提示：上述关系表示不同表之间字段的关联关系，可在生成JOIN SQL时参考。\n"
		}
		prompt += "\n"
	}

	// 添加已有接口信息
	if len(existingApis) > 0 {
		prompt += "\n【已有接口列表】\n"
		prompt += "以下是系统中已存在的接口，供您参考：\n\n"
		for i, api := range existingApis {
			name, _ := api["name"].(string)
			path, _ := api["path"].(string)
			method, _ := api["method"].(string)
			prompt += fmt.Sprintf("%d. %s - %s %s\n", i+1, name, method, path)
		}
		prompt += "\n【重要提示】\n"
		prompt += "1. 新接口的 path + method 组合不能与已有接口重复\n"
		prompt += "2. 请分析新接口是否属于某个已有的一级分类（path中的 /api/xxx/ 部分）\n"
		prompt += "   - 如果属于已有分类，请使用相同的一级分类路径\n"
		prompt += "   - 如果不属于已有分类，可以创建新的一级分类\n"
		prompt += "3. 例如：已有 /api/users/list，新接口可以是 /api/users/detail（属于同一分类）\n"
		prompt += "         或创建新分类 /api/products/list（属于不同分类）\n\n"
	} else {
		prompt += "\n【已有接口列表】\n"
		prompt += "当前系统中暂无已有接口，您可以创建第一个接口。\n\n"
	}

	prompt += "\n用户需求：" + userMessage + "\n\n"
	prompt += "请生成接口配置，必须包含以下信息：\n"
	prompt += "1. name: 接口名称（中文，简洁明了）\n"
	prompt += "2. path: 接口路径（以/api/开头，使用RESTful风格，全部小写）\n"
	prompt += "3. method: 请求方法（GET/POST/PUT/DELETE，全部大写）\n"
	prompt += "4. sql: SQL查询语句（支持MyBatis语法，使用#{param}表示参数，必须使用与数据库类型匹配的语法）\n"
	prompt += "5. description: 接口描述\n"
	prompt += "6. default_params: 默认参数值（用于测试，JSON对象，值必须是数据库中实际存在的数据）\n\n"
	prompt += "请按以下JSON格式返回：\n"
	prompt += "```json\n"
	prompt += "{\n"
	prompt += "  \"name\": \"查询员工薪资\",\n"
	prompt += "  \"path\": \"/api/hr/salary\",\n"
	prompt += "  \"method\": \"GET\",\n"
	prompt += "  \"sql\": \"SELECT he.EMP_NAME, hsr.BASE_SALARY, hsr.BONUS, hsr.ACTUAL_PAY FROM HR_EMPLOYEE he JOIN HR_SALARY_RECORD hsr ON he.EMP_ID = hsr.EMP_ID WHERE hsr.YEAR_MONTH = #{year_month}\",\n"
	prompt += "  \"description\": \"查询指定月份的员工薪资信息\",\n"
	prompt += "  \"default_params\": {\n"
	prompt += "    \"year_month\": \"2024-01\"\n"
	prompt += "  }\n"
	prompt += "}\n"
	prompt += "```\n\n"
	prompt += "【重要规则】：\n"
	prompt += "1. SQL只能有一条语句\n"
	prompt += "2. 使用#{参数名}表示预编译参数（推荐），使用${参数名}表示直接替换\n"
	prompt += "3. 接口路径要符合RESTful规范（如 /api/users, /api/products/list）\n"
	prompt += "4. 根据操作类型选择正确的HTTP方法（查询用GET，创建用POST，更新用PUT，删除用DELETE）\n"
	prompt += "5. **必须使用上面列出的真实表名和字段名**，不要使用不存在的表或字段\n"
	prompt += "6. **SQL语法必须与数据库类型匹配**，特别是分页语法（见上方【数据库类型与SQL语法要点】）\n"
	prompt += "7. 必须为SQL中的每个参数提供默认值用于测试\n\n"
	prompt += "【default_params 规则 — 极其重要】：\n"
	prompt += "default_params 的值必须是数据库中实际存在的数据值，不能是假设值或随意编造的值！\n"
	prompt += "系统会用 default_params 实际执行SQL来验证，如果查不到数据则验证失败。\n"
	prompt += "- 对于 WHERE 条件中的参数，必须使用表中真实存在的值（如字段有注释说明取值范围，按注释选择）\n"
	prompt += "- 对于 id 类参数，使用最小的 id 值（通常是1）\n"
	prompt += "- 对于 status/类型 类参数，使用最常见的状态值（如状态字段有注释，按注释选择最通用的值）\n"
	prompt += "- 对于日期参数，使用最近的日期（如 \"2024-01-01\" 或 \"2024-01\"）\n"
	prompt += "- 对于 limit/count 类参数，使用较小的值（如 10）\n"
	prompt += "- 如果不确定某个参数的实际值，宁可去掉该 WHERE 条件，也不要使用可能不存在的值\n"
	prompt += "- 优先选择范围更宽的默认值（如不限定 status 比限定某个具体 status 更安全）\n"
	prompt += "8. 如果用户需求模糊，选择最相关的表和字段生成合理的查询"

	return prompt
}

// buildCreateApiRetryPrompt 构建重试提示词，告知AI之前的错误

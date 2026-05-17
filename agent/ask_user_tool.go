package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	toolshared "github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/tools/shared"
	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/tools"
)

// ============================================================
// AskUserTool — PicoClaw Tool 接口的 ask_user 工具
// ============================================================

const askUserToolDesc = `Ask the user a question and wait for their response. Use this tool when you need human input, confirmation, or decision-making before proceeding.

Supported interaction types:
1. **confirm** — Binary yes/no confirmation. Use before executing dangerous operations (DROP TABLE, TRUNCATE, bulk UPDATE/DELETE, etc.). Options will be rendered as confirm/cancel buttons.
   Example: Ask "确认要删除表 users 吗？" with options [yes, no]

2. **single_select** — Choose one option from a list. Use when the user needs to pick one specific choice among several alternatives.
   Example: Ask "请选择要查询的数据库" with options listing available databases.

3. **multi_select** — Choose multiple options from a list. Use when the user can select several items simultaneously.
   Example: Ask "请选择要包含在报表中的字段" with options listing table columns.

4. **input** — Free-form text input. Use when you need a short text answer from the user (a name, a value, a query, etc.). Fields define the input placeholder.
   Example: Ask "请输入要搜索的关键词" with a text field.

5. **form** — Multi-field structured form. Use when you need several pieces of information from the user at once. Each field can be text, number, select, or textarea.
   Example: Ask "请填写接口配置" with fields for name, path, method, and description.

Usage guidelines:
- Always use **confirm** before any destructive database operation (DROP, TRUNCATE, bulk DELETE/UPDATE).
- Use **single_select** or **multi_select** when options are known and finite.
- Use **input** for simple free-text responses.
- Use **form** when you need multiple structured inputs at once.
- Set timeout_seconds appropriately (default 300 = 5 minutes). For confirm actions, shorter timeouts (60-120) are usually sufficient.
- The tool will block until the user responds or the timeout expires. The user's response will be returned as JSON for you to process.

Response format:
- For confirm: {"action": "submit", "values": {"confirm": "yes"}} or {"action": "cancel"}
- For single_select: {"action": "submit", "values": {"selected": "option_id"}}
- For multi_select: {"action": "submit", "values": {"selected": ["id1", "id2"]}}
- For input: {"action": "submit", "values": {"input_field_id": "user text"}}
- For form: {"action": "submit", "values": {"field_id_1": "value1", "field_id_2": "value2"}}
- Timeout: {"action": "timeout"}
`

// AskUserTool 让 AI agent 能向用户发起人在环路交互请求
type AskUserTool struct {
	hitlMgr   *HITLManager
	pushEvent func(Event) // 回调：推送 SSE 事件到前端
}

// NewAskUserTool 创建 ask_user 工具
func NewAskUserTool(hitlMgr *HITLManager, pushEvent func(Event)) *AskUserTool {
	return &AskUserTool{
		hitlMgr:   hitlMgr,
		pushEvent: pushEvent,
	}
}

func (t *AskUserTool) Name() string { return "ask_user" }
func (t *AskUserTool) Description() string { return askUserToolDesc }

func (t *AskUserTool) Parameters() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"interaction_type": map[string]any{
				"type":        "string",
				"description": "Type of interaction: confirm (yes/no), single_select (pick one), multi_select (pick multiple), input (free text), form (multi-field)",
				"enum":        []string{"confirm", "single_select", "multi_select", "input", "form"},
			},
			"title": map[string]any{
				"type":        "string",
				"description": "Short title of the question or confirmation request (displayed prominently to the user)",
			},
			"description": map[string]any{
				"type":        "string",
				"description": "Detailed description or context for the question (optional, shown below the title)",
			},
			"options": map[string]any{
				"type":        "array",
				"description": "Available choices (required for confirm, single_select, multi_select). Each option has id, label, description (optional), style (optional: default|primary|danger|warning)",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"id":          map[string]any{"type": "string", "description": "Unique option identifier"},
						"label":       map[string]any{"type": "string", "description": "Display text for this option"},
						"description": map[string]any{"type": "string", "description": "Optional detail text"},
						"style":       map[string]any{"type": "string", "description": "Visual style: default|primary|danger|warning", "enum": []string{"default", "primary", "danger", "warning"}},
					},
					"required": []string{"id", "label"},
				},
			},
			"fields": map[string]any{
				"type":        "array",
				"description": "Form fields (required for input and form types). Each field has id, label, type, placeholder (optional), required (optional), options (for select type), default_value (optional)",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"id":            map[string]any{"type": "string", "description": "Unique field identifier"},
						"label":         map[string]any{"type": "string", "description": "Display label for this field"},
						"type":          map[string]any{"type": "string", "description": "Field input type: text|number|select|textarea", "enum": []string{"text", "number", "select", "textarea"}},
						"placeholder":   map[string]any{"type": "string", "description": "Placeholder text (optional)"},
						"required":      map[string]any{"type": "boolean", "description": "Whether this field is required (optional, default false)"},
						"default_value": map[string]any{"type": "string", "description": "Default value (optional)"},
						"options": map[string]any{
							"type":        "array",
							"description": "Options for select type fields",
							"items": map[string]any{
								"type": "object",
								"properties": map[string]any{
									"id":          map[string]any{"type": "string"},
									"label":       map[string]any{"type": "string"},
									"description": map[string]any{"type": "string"},
									"style":       map[string]any{"type": "string"},
								},
							},
						},
					},
					"required": []string{"id", "label", "type"},
				},
			},
			"timeout_seconds": map[string]any{
				"type":        "number",
				"description": "Timeout in seconds for user response (default 300 = 5 minutes). After timeout, the tool returns action=timeout.",
			},
		},
		"required": []string{"interaction_type", "title"},
	}
}

func (t *AskUserTool) Execute(ctx context.Context, args map[string]any) *tools.ToolResult {
	// 1. 提取参数
	interactionType, _ := args["interaction_type"].(string)
	title, _ := args["title"].(string)
	description, _ := args["description"].(string)

	if interactionType == "" {
		return tools.ErrorResult("interaction_type is required (confirm, single_select, multi_select, input, form)")
	}
	if title == "" {
		return tools.ErrorResult("title is required")
	}

	// 验证交互类型
	validTypes := map[string]bool{
		"confirm": true, "single_select": true, "multi_select": true,
		"input": true, "form": true,
	}
	if !validTypes[interactionType] {
		return tools.ErrorResult(fmt.Sprintf("invalid interaction_type: %s (must be confirm, single_select, multi_select, input, form)", interactionType))
	}

	// 解析 options
	var options []HITLOption
	if rawOpts, ok := args["options"].([]any); ok {
		for _, raw := range rawOpts {
			if optMap, ok := raw.(map[string]any); ok {
				opt := HITLOption{
					ID:          strVal(optMap["id"]),
					Label:       strVal(optMap["label"]),
					Description: strVal(optMap["description"]),
					Style:       strVal(optMap["style"]),
				}
				if opt.ID == "" || opt.Label == "" {
					continue
				}
				options = append(options, opt)
			}
		}
	}

	// 解析 fields
	var fields []HITLField
	if rawFields, ok := args["fields"].([]any); ok {
		for _, raw := range rawFields {
			if fieldMap, ok := raw.(map[string]any); ok {
				field := HITLField{
					ID:           strVal(fieldMap["id"]),
					Label:        strVal(fieldMap["label"]),
					Type:         strVal(fieldMap["type"]),
					Placeholder:  strVal(fieldMap["placeholder"]),
					Required:     boolVal(fieldMap["required"]),
					DefaultValue: strVal(fieldMap["default_value"]),
				}
				// 解析 field 内的 options（select 类型）
				if rawFieldOpts, ok := fieldMap["options"].([]any); ok {
					for _, rawFO := range rawFieldOpts {
						if foMap, ok := rawFO.(map[string]any); ok {
							field.Options = append(field.Options, HITLOption{
								ID:          strVal(foMap["id"]),
								Label:       strVal(foMap["label"]),
								Description: strVal(foMap["description"]),
								Style:       strVal(foMap["style"]),
							})
						}
					}
				}
				if field.ID == "" || field.Label == "" {
					continue
				}
				fields = append(fields, field)
			}
		}
	}

	// 解析 timeout
	timeoutSeconds := 300 // 默认 5 分钟
	if ts, ok := args["timeout_seconds"].(float64); ok && ts > 0 {
		timeoutSeconds = int(ts)
	}
	if ts, ok := args["timeout_seconds"].(int); ok && ts > 0 {
		timeoutSeconds = ts
	}

	// 2. 从 ctx 获取 sessionID
	sessionID := toolshared.ToolSessionKey(ctx)
	if sessionID == "" {
		// fallback: 从 args 取
		sessionID, _ = args["session_id"].(string)
	}
	if sessionID == "" {
		sessionID = "default"
	}

	// 3. 生成 hitlID
	hitlID := uuid.New().String()

	// 4. 构建 HITLRequest
	req := HITLRequest{
		ID:              hitlID,
		SessionID:       sessionID,
		InteractionType: HITLInteractionType(interactionType),
		Title:           title,
		Description:     description,
		Options:         options,
		Fields:          fields,
		TimeoutSeconds:  timeoutSeconds,
		CreatedAt:       time.Now(),
	}

	// 5. 注册到 HITLManager
	respCh := t.hitlMgr.RegisterRequest(req)

	// 6. 推送 hitl_interaction SSE 事件到前端
	if t.pushEvent != nil {
		reqJSON, _ := json.Marshal(req)
		t.pushEvent(Event{
			Type: EventTypeHITL,
			Data: map[string]interface{}{
				"hitl_id":         hitlID,
				"session_id":      sessionID,
				"interaction_type": interactionType,
				"title":           title,
				"description":     description,
				"options":         options,
				"fields":          fields,
				"timeout_seconds": timeoutSeconds,
				"request_json":    string(reqJSON),
			},
		})
		log.Printf("[ask_user] pushed hitl_interaction event: hitl_id=%s, type=%s", hitlID, interactionType)
	}

	// 7. 阻塞等待用户响应（带 ctx 超时）
	log.Printf("[ask_user] waiting for user response: hitl_id=%s, session=%s, timeout=%ds", hitlID, sessionID, timeoutSeconds)

	select {
	case resp := <-respCh:
		// 用户响应到达
		respJSON, _ := json.MarshalIndent(resp, "", "  ")
		log.Printf("[ask_user] received user response: hitl_id=%s, action=%s", hitlID, resp.Action)

		if resp.Action == "cancel" {
			return tools.NewToolResult(fmt.Sprintf("User cancelled the request. Response: %s", string(respJSON)))
		}
		if resp.Action == "timeout" {
			return tools.NewToolResult(fmt.Sprintf("Request timed out after %d seconds. No user response received.", timeoutSeconds))
		}

		// 正常提交 — 将用户响应序列化为 JSON 返回给 AI
		return tools.NewToolResult(fmt.Sprintf("User responded:\n%s", string(respJSON)))

	case <-ctx.Done():
		// 上下文超时或取消
		log.Printf("[ask_user] context cancelled: hitl_id=%s, err=%v", hitlID, ctx.Err())
		// 清理 HITL 请求
		t.hitlMgr.SubmitResponse(hitlID, HITLResponse{
			HitlID:    hitlID,
			Action:    "cancel",
			Timestamp: time.Now(),
		})
		return tools.NewToolResult(fmt.Sprintf("Request cancelled due to context timeout: %v", ctx.Err()))
	}
}

// strVal 从 map[string]any 中提取字符串值
func strVal(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// boolVal 从 map[string]any 中提取布尔值
func boolVal(v any) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return false
}
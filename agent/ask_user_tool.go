package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
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

6. **preview** — Interactive preview with configurable form. Use after preview_app to show the user an iframe preview of the generated application alongside configuration fields they can adjust. Provide preview_html from the preview_app tool output, and config_fields for adjustable settings (supports color type).
   Example: Show a dashboard preview with fields to change the title, color scheme, and chart type.

Usage guidelines:
- Always use **confirm** before any destructive database operation (DROP, TRUNCATE, bulk DELETE/UPDATE).
- Use **single_select** or **multi_select** when options are known and finite.
- Use **input** for simple free-text responses.
- Use **form** when you need multiple structured inputs at once.
- Set timeout_seconds appropriately (default 86400 = 24 hours in async mode). User can respond at any time — no rush.
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
	hitlMgr     *HITLManager
	pushEvent   func(Event) // 回调：推送 SSE 事件到前端
	onConfirmed func()      // 回调：用户确认后调用，用于标记 HITL 已确认
}

// NewAskUserTool 创建 ask_user 工具
func NewAskUserTool(hitlMgr *HITLManager, pushEvent func(Event), onConfirmed func()) *AskUserTool {
	return &AskUserTool{
		hitlMgr:     hitlMgr,
		pushEvent:   pushEvent,
		onConfirmed: onConfirmed,
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
				"description": "Type of interaction: confirm (yes/no), single_select (pick one), multi_select (pick multiple), input (free text), form (multi-field), preview (iframe preview + config form)",
				"enum":        []string{"confirm", "single_select", "multi_select", "input", "form", "preview"},
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
				"description": "Timeout in seconds for user response (default 86400 = 24 hours in async mode). User can respond at any time.",
			},
			"preview_html": map[string]any{
				"type":        "string",
				"description": "(preview type only) HTML content to render in the preview iframe. Generate this from preview_app tool output.",
			},
			"preview_width": map[string]any{
				"type":        "string",
				"description": "(preview type only) Iframe width, default '100%'",
			},
			"preview_height": map[string]any{
				"type":        "string",
				"description": "(preview type only) Iframe height, default '420px'",
			},
			"config_fields": map[string]any{
				"type":        "array",
				"description": "(preview type only) Configurable fields shown alongside the preview. Same format as 'fields' but supports additional type 'color'.",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"id":            map[string]any{"type": "string", "description": "Unique field identifier"},
						"label":         map[string]any{"type": "string", "description": "Display label for this field"},
						"type":          map[string]any{"type": "string", "description": "Field input type: text|number|select|textarea|color", "enum": []string{"text", "number", "select", "textarea", "color"}},
						"placeholder":   map[string]any{"type": "string", "description": "Placeholder text (optional)"},
						"required":      map[string]any{"type": "boolean", "description": "Whether this field is required (optional, default false)"},
						"default_value": map[string]any{"type": "string", "description": "Default value (optional)"},
						"options": map[string]any{
							"type":        "array",
							"description": "Options for select type fields",
							"items": map[string]any{
								"type": "object",
								"properties": map[string]any{
									"id":    map[string]any{"type": "string"},
									"label": map[string]any{"type": "string"},
								},
							},
						},
					},
					"required": []string{"id", "label", "type"},
				},
			},
		},
		"required": []string{"interaction_type", "title"},
	}
}

func (t *AskUserTool) Execute(ctx context.Context, args map[string]any) *tools.ToolResult {
	// 0. 解包 raw 字段（某些 provider 会把参数包装成 {"raw": "..."} 格式）
	for {
		raw, ok := args["raw"]
		if !ok {
			break
		}
		switch v := raw.(type) {
		case string:
			var parsed map[string]any
			if err := json.Unmarshal([]byte(v), &parsed); err == nil {
				args = parsed
				continue
			}
			// Try to fix truncated JSON
			fixed := v
			for i := 0; i < 5; i++ {
				fixed += "}"
				if err := json.Unmarshal([]byte(fixed), &parsed); err == nil {
					log.Printf("[ask_user] fixed truncated JSON: added %d closing braces, original_len=%d", i+1, len(v))
					args = parsed
					break
				}
			}
			if len(parsed) > 0 {
				continue
			}
			// Try adding both } and ]
			fixed = v
			for i := 0; i < 10; i++ {
				fixed += "}"
				fixed += "]"
				if err := json.Unmarshal([]byte(fixed), &parsed); err == nil {
					log.Printf("[ask_user] fixed truncated JSON with mixed braces: added %d pairs, original_len=%d", i+1, len(v))
					args = parsed
					break
				}
			}
			if len(parsed) > 0 {
				continue
			}
			log.Printf("[ask_user] failed to parse raw field: len=%d, first_200=%s", len(v), v[:min(200, len(v))])
		case map[string]any:
			args = v
			continue
		}
		break
	}

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
		"input": true, "form": true, "preview": true,
	}
	if !validTypes[interactionType] {
		return tools.ErrorResult(fmt.Sprintf("invalid interaction_type: %s (must be confirm, single_select, multi_select, input, form, preview)", interactionType))
	}

	// 强制规则：创建接口的 form 必须包含从数据库获取的真实数据
	// 如果 form 的 title 包含"接口"/"创建"/"API"，但所有 fields 的 default_value 都为空，
	// 说明 AI 跳过了 list_databases → get_tables → describe_table 的数据探索步骤
	if interactionType == "form" {
		titleLower := strings.ToLower(title)
		isApiCreation := strings.Contains(titleLower, "接口") || strings.Contains(titleLower, "创建") ||
			strings.Contains(titleLower, "api") || strings.Contains(titleLower, "确认")
		if isApiCreation {
			// 检查是否有真实数据（两种格式都支持）
			// 格式1: fields[].default_value
			// 格式2: 顶层 default_params (某些模型如 Qwen3-32B 使用这种格式)
			hasAnyDefault := false
			
			// 检查 fields[].default_value
			if rawFields, ok := args["fields"].([]any); ok {
				for _, raw := range rawFields {
					if fieldMap, ok := raw.(map[string]any); ok {
						dv := strVal(fieldMap["default_value"])
						if dv != "" {
							hasAnyDefault = true
							break
						}
					}
				}
			}
			
			// 检查顶层 default_params
			if !hasAnyDefault {
				if defaultParams, ok := args["default_params"].(map[string]any); ok {
					for _, v := range defaultParams {
						if strVal(v) != "" {
							hasAnyDefault = true
							break
						}
					}
				}
			}
			
			if !hasAnyDefault {
				errMsg := `⚠️ 数据探索步骤缺失！你跳过了 list_databases → get_tables → describe_table 步骤。

创建接口前必须先获取真实数据：
1. 立即调用 list_databases 工具获取可用数据库列表
2. 立即调用 get_tables 工具获取表列表（参数: database_id）
3. 立即调用 describe_table 工具获取表字段信息（参数: database_id, table_name）
4. 根据获取的真实数据设计接口方案
5. 然后再调用 ask_user（form 类型），fields 中必须填入从数据库获取的真实 default_value

现在请立即调用 list_databases 工具开始数据探索！不要再次调用 ask_user！`
				log.Printf("[ask_user] rejected empty form: title=%s, no default_values found — AI skipped data exploration", title)
				return tools.ErrorResult(errMsg)
			}
		}
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

	// 解析 timeout（异步模式下默认 24h，前端不再超时断开）
	timeoutSeconds := 86400 // 默认 24 小时
	if ts, ok := args["timeout_seconds"].(float64); ok && ts > 0 {
		timeoutSeconds = int(ts)
	}
	if ts, ok := args["timeout_seconds"].(int); ok && ts > 0 {
		timeoutSeconds = ts
	}

	// 解析 preview 类型参数
	previewHTML, _ := args["preview_html"].(string)
	previewWidth, _ := args["preview_width"].(string)
	previewHeight, _ := args["preview_height"].(string)

	// 解析 config_fields（preview 类型专用，与 fields 格式相同但支持 color 类型）
	var configFields []HITLField
	if rawConfigFields, ok := args["config_fields"].([]any); ok {
		for _, raw := range rawConfigFields {
			if fieldMap, ok := raw.(map[string]any); ok {
				field := HITLField{
					ID:           strVal(fieldMap["id"]),
					Label:        strVal(fieldMap["label"]),
					Type:         strVal(fieldMap["type"]),
					Placeholder:  strVal(fieldMap["placeholder"]),
					Required:     boolVal(fieldMap["required"]),
					DefaultValue: strVal(fieldMap["default_value"]),
				}
				if rawFieldOpts, ok := fieldMap["options"].([]any); ok {
					for _, rawFO := range rawFieldOpts {
						if foMap, ok := rawFO.(map[string]any); ok {
							field.Options = append(field.Options, HITLOption{
								ID:    strVal(foMap["id"]),
								Label: strVal(foMap["label"]),
							})
						}
					}
				}
				if field.ID != "" && field.Label != "" {
					configFields = append(configFields, field)
				}
			}
		}
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
		evtData := map[string]interface{}{
			"hitl_id":         hitlID,
			"session_id":      sessionID,
			"interaction_type": interactionType,
			"title":           title,
			"description":     description,
			"options":         options,
			"fields":          fields,
			"timeout_seconds": timeoutSeconds,
			"request_json":    string(reqJSON),
		}
		// preview 类型额外字段
		if interactionType == "preview" {
			evtData["preview_html"] = previewHTML
			if previewWidth != "" {
				evtData["preview_width"] = previewWidth
			}
			if previewHeight != "" {
				evtData["preview_height"] = previewHeight
			}
			if len(configFields) > 0 {
				evtData["config_fields"] = configFields
			}
		}
		t.pushEvent(Event{
			Type: EventTypeHITL,
			Data: evtData,
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
		// 标记 session 已通过 HITL 确认，允许后续 create_api 调用
		if t.onConfirmed != nil {
			t.onConfirmed()
		}
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
# adk-go v1.2.0 model.LLM 接口分析与 OpenAI/Anthropic 适配器实现方案

## 一、model.LLM 接口完整签名

**文件**: `model/llm.go`

```go
package model

import (
    "context"
    "iter"
    "google.golang.org/genai"
)

// LLM provides the access to the underlying LLM.
type LLM interface {
    Name() string
    GenerateContent(ctx context.Context, req *LLMRequest, stream bool) iter.Seq2[*LLMResponse, error]
}
```

### 接口方法说明

| 方法 | 签名 | 说明 |
|------|------|------|
| `Name()` | `() string` | 返回模型名称标识符 |
| `GenerateContent()` | `(ctx context.Context, req *LLMRequest, stream bool) iter.Seq2[*LLMResponse, error]` | 生成内容，通过 Go 1.23+ 的 `iter.Seq2` 迭代器模式支持流式/非流式统一返回 |

### 核心数据结构

#### LLMRequest
```go
type LLMRequest struct {
    Model    string                        // 模型名（可覆盖构造时指定的名称）
    Contents []*genai.Content              // 对话历史（多轮消息）
    Config   *genai.GenerateContentConfig  // 生成配置
    Tools    map[string]any `json:"-"`     // 工具映射（非序列化）
}
```

#### LLMResponse
```go
type LLMResponse struct {
    Content           *genai.Content                                    // 响应内容（含 Parts）
    CitationMetadata  *genai.CitationMetadata                           // 引用元数据
    GroundingMetadata *genai.GroundingMetadata                          // 搜索 grounding 元数据
    UsageMetadata     *genai.GenerateContentResponseUsageMetadata       // Token 用量
    CustomMetadata    map[string]any                                    // 自定义元数据
    LogprobsResult    *genai.LogprobsResult                             // Logprobs 结果
    ModelVersion      string                                            // 模型版本

    // 流式控制字段
    Partial       bool                // 是否为部分内容（流式中间帧，仅文本时使用）
    TurnComplete  bool                // 本轮对话是否完成（仅流式模式）
    Interrupted   bool                // 是否被中断（bidi streaming 中用户打断）
    ErrorCode     string              // 错误码
    ErrorMessage  string              // 错误消息
    FinishReason  genai.FinishReason  // 结束原因（Stop/MaxTokens/Safety 等）
    AvgLogprobs   float64             // 平均 logprobs
}
```

### genai.Content 与 genai.Part（关键中间类型）

ADK 使用 `google.golang.org/genai` 包作为统一的数据模型：

```go
// Content = 一条消息（角色 + 零或多个 Part）
type Content struct {
    Role  string   // "user" | "model" | "system"
    Parts []*Part
}

// Part = 消息中的一个原子内容单元（文本/函数调用/函数响应/内联数据等）
type Part struct {
    Text             string            // 文本内容
    Thought          bool              // 是否为思考/推理内容
    ThoughtSignature []byte
    FunctionCall     *FunctionCall     // 函数调用
    FunctionResponse *FunctionResponse // 函数响应
    InlineData       *Blob             // 内联二进制（图片/音频等）
    FileData         *FileData         // 文件引用
    // ... 其他字段
}

type FunctionCall struct {
    ID   string
    Name string
    Args map[string]any
}

type FunctionResponse struct {
    ID       string
    Name     string
    Response map[string]any
}
```

---

## 二、iter.Seq2 迭代器模式详解

Go 1.23+ 引入的 `iter.Seq2[*LLMResponse, error]` 是 ADK 的核心流式抽象：

```go
// 类型定义
type Seq2[V1, V2 any] func(yield func(V1, V2) bool)

// 使用方式
for resp, err := range model.GenerateContent(ctx, req, true) {
    if err != nil { ... }
    // 处理 resp
}
```

**关键语义**：
- `yield(resp, nil)` → 产生一个响应帧
- `yield(nil, err)` → 产生一个错误，迭代终止
- `yield` 返回 `false` → 消费者停止迭代，生产者应立即 return
- **非流式模式**：迭代器 yield 一次完整响应
- **流式模式**：迭代器 yield 多次 `Partial=true` 的中间帧，最后一次 `TurnComplete=true`

---

## 三、官方 Gemini 适配器实现参考

**文件**: `model/gemini/gemini.go`

### 结构体
```go
type geminiModel struct {
    client             *genai.Client
    name               string
    versionHeaderValue string
}
```

### 非流式实现
```go
func (m *geminiModel) generate(ctx context.Context, req *model.LLMRequest) (*model.LLMResponse, error) {
    resp, err := m.client.Models.GenerateContent(ctx, m.modelName(req), req.Contents, req.Config)
    if err != nil {
        return nil, fmt.Errorf("failed to call model: %w", err)
    }
    return converters.Genai2LLMResponse(resp), nil
}
```

### 流式实现（使用 StreamingResponseAggregator）
```go
func (m *geminiModel) generateStream(ctx context.Context, req *model.LLMRequest) iter.Seq2[*model.LLMResponse, error] {
    aggregator := llminternal.NewStreamingResponseAggregator()
    return func(yield func(*model.LLMResponse, error) bool) {
        for resp, err := range m.client.Models.GenerateContentStream(ctx, m.modelName(req), req.Contents, req.Config) {
            if err != nil {
                yield(nil, err)
                return
            }
            for llmResponse, err := range aggregator.ProcessResponse(ctx, resp) {
                if !yield(llmResponse, err) {
                    return
                }
            }
        }
        if closeResult := aggregator.Close(); closeResult != nil {
            yield(closeResult, nil)
        }
    }
}
```

### StreamingResponseAggregator 的作用
Gemini 适配器使用内部的 `StreamingResponseAggregator` 来：
1. 聚合流式文本片段（合并连续文本到 buffer）
2. 处理流式函数调用（`PartialArgs` 逐步构建完整参数）
3. 跟踪 `finishReason`、`usageMetadata`、`groundingMetadata` 等跨帧状态
4. `Close()` 时产出最终聚合响应（`TurnComplete=true`，`Partial=false`）

---

## 四、OpenAI 适配器实现方案（基于 byebyebruce/adk-go-openai）

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    ADK Framework                      │
│  (LLMRequest → OpenAI适配器 → LLMResponse)           │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────▼────────────┐
          │     OpenAIModel         │
          │  ┌───────────────────┐  │
          │  │ toOpenAIRequest() │  │  ← genai.Content → openai.ChatCompletionMessage
          │  └───────┬───────────┘  │
          │          │              │
          │  ┌───────▼───────────┐  │
          │  │ OpenAI API Call   │  │  ← stream ? CreateChatCompletionStream : CreateChatCompletion
          │  └───────┬───────────┘  │
          │          │              │
          │  ┌───────▼───────────┐  │
          │  │ toLLMResponse()   │  │  ← openai response → model.LLMResponse
          │  └───────────────────┘  │
          └─────────────────────────┘
```

### 4.2 核心结构体

```go
package openai

import (
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "io"
    "iter"

    "github.com/sashabaranov/go-openai"
    "google.golang.org/adk/model"
    "google.golang.org/genai"
)

type OpenAIModel struct {
    Client    *openai.Client
    ModelName string
}

var _ model.LLM = &OpenAIModel{}
```

### 4.3 接口实现

```go
func (o *OpenAIModel) Name() string {
    return o.ModelName
}

func (o *OpenAIModel) GenerateContent(ctx context.Context, req *model.LLMRequest, stream bool) iter.Seq2[*model.LLMResponse, error] {
    if stream {
        return o.generateStream(ctx, req)
    }
    return o.generate(ctx, req)
}
```

### 4.4 非流式实现

```go
func (o *OpenAIModel) generate(ctx context.Context, req *model.LLMRequest) iter.Seq2[*model.LLMResponse, error] {
    return func(yield func(*model.LLMResponse, error) bool) {
        openaiReq, err := toOpenAIChatCompletionRequest(req, o.ModelName)
        if err != nil {
            yield(nil, err)
            return
        }

        resp, err := o.Client.CreateChatCompletion(ctx, openaiReq)
        if err != nil {
            yield(nil, err)
            return
        }

        llmResp, err := convertChatCompletionResponse(&resp)
        if err != nil {
            yield(nil, err)
            return
        }

        yield(llmResp, nil)
    }
}
```

### 4.5 流式实现（核心难点）

```go
func (o *OpenAIModel) generateStream(ctx context.Context, req *model.LLMRequest) iter.Seq2[*model.LLMResponse, error] {
    return func(yield func(*model.LLMResponse, error) bool) {
        openaiReq, err := toOpenAIChatCompletionRequest(req, o.ModelName)
        if err != nil {
            yield(nil, err)
            return
        }
        openaiReq.Stream = true

        stream, err := o.Client.CreateChatCompletionStream(ctx, openaiReq)
        if err != nil {
            yield(nil, err)
            return
        }
        defer stream.Close()

        // 聚合状态
        aggregatedContent := &genai.Content{
            Role:  "model",
            Parts: []*genai.Part{},
        }
        var finishReason genai.FinishReason
        var usageMetadata *genai.GenerateContentResponseUsageMetadata
        toolCallsMap := make(map[int]*toolCallBuilder)  // 按 index 聚合 tool calls
        lastPartIsText := false

        for {
            chunk, err := stream.Recv()
            if err != nil {
                if errors.Is(err, io.EOF) {
                    break
                }
                yield(nil, err)
                return
            }

            if len(chunk.Choices) == 0 {
                continue
            }
            choice := chunk.Choices[0]

            // ① 处理文本 delta → yield 部分帧
            if choice.Delta.Content != "" {
                part := &genai.Part{Text: choice.Delta.Content}
                if lastPartIsText {
                    aggregatedContent.Parts[len(aggregatedContent.Parts)-1].Text += part.Text
                } else {
                    aggregatedContent.Parts = append(aggregatedContent.Parts, part)
                }
                lastPartIsText = true

                // 向下游 yield 部分帧
                llmResp := &model.LLMResponse{
                    Content:      &genai.Content{Role: "model", Parts: []*genai.Part{part}},
                    Partial:      true,
                    TurnComplete: false,
                }
                if !yield(llmResp, nil) {
                    return  // 消费者停止
                }
            } else {
                lastPartIsText = false
            }

            // ② 处理 tool calls delta → 聚合（不立即 yield）
            if len(choice.Delta.ToolCalls) > 0 {
                for _, toolCall := range choice.Delta.ToolCalls {
                    idx := 0
                    if toolCall.Index != nil {
                        idx = *toolCall.Index
                    }
                    builder, exists := toolCallsMap[idx]
                    if !exists {
                        builder = &toolCallBuilder{
                            id:   toolCall.ID,
                            name: toolCall.Function.Name,
                            args: "",
                        }
                        toolCallsMap[idx] = builder
                    }
                    if toolCall.ID != "" {
                        builder.id = toolCall.ID
                    }
                    if toolCall.Function.Name != "" {
                        builder.name = toolCall.Function.Name
                    }
                    if toolCall.Function.Arguments != "" {
                        builder.args += toolCall.Function.Arguments
                    }
                }
            }

            // ③ 捕获 finish reason
            if choice.FinishReason != "" {
                finishReason = convertFinishReason(string(choice.FinishReason))
            }

            // ④ 捕获 usage metadata
            if chunk.Usage != nil {
                usageMetadata = &genai.GenerateContentResponseUsageMetadata{
                    PromptTokenCount:     int32(chunk.Usage.PromptTokens),
                    CandidatesTokenCount: int32(chunk.Usage.CompletionTokens),
                    TotalTokenCount:      int32(chunk.Usage.TotalTokens),
                }
            }
        }

        // ⑤ 流结束：将聚合的 tool calls 转为 Parts
        if len(toolCallsMap) > 0 {
            indices := sortedKeys(toolCallsMap)
            for _, idx := range indices {
                builder := toolCallsMap[idx]
                part := &genai.Part{
                    FunctionCall: &genai.FunctionCall{
                        ID:   builder.id,
                        Name: builder.name,
                        Args: parseJSONArgs(builder.args),
                    },
                }
                aggregatedContent.Parts = append(aggregatedContent.Parts, part)
            }
        }

        // ⑥ yield 最终完整帧
        finalResp := &model.LLMResponse{
            Content:       aggregatedContent,
            UsageMetadata: usageMetadata,
            FinishReason:  finishReason,
            Partial:       false,
            TurnComplete:  true,
        }
        yield(finalResp, nil)
    }
}

type toolCallBuilder struct {
    id   string
    name string
    args string  // 逐步拼接的 JSON 字符串
}
```

### 4.6 请求转换：genai → OpenAI

```go
func toOpenAIChatCompletionRequest(req *model.LLMRequest, modelName string) (openai.ChatCompletionRequest, error) {
    // 1. 转换消息
    openaiMessages := make([]openai.ChatCompletionMessage, 0, len(req.Contents))
    for _, content := range req.Contents {
        msgs, err := toOpenAIChatCompletionMessage(content)
        if err != nil {
            return openai.ChatCompletionRequest{}, err
        }
        openaiMessages = append(openaiMessages, msgs...)
    }

    openaiReq := openai.ChatCompletionRequest{
        Model:    modelName,
        Messages: openaiMessages,
    }

    // 2. 转换配置
    if req.Config != nil {
        // System Instruction → system message
        if req.Config.SystemInstruction != nil {
            systemMsg := openai.ChatCompletionMessage{
                Role:    openai.ChatMessageRoleSystem,
                Content: extractTextFromContent(req.Config.SystemInstruction),
            }
            openaiReq.Messages = append([]openai.ChatCompletionMessage{systemMsg}, openaiMessages...)
        }

        // Temperature / TopP / MaxTokens / StopSequences
        if req.Config.Temperature != nil {
            openaiReq.Temperature = *req.Config.Temperature
        }
        if req.Config.MaxOutputTokens > 0 {
            openaiReq.MaxTokens = int(req.Config.MaxOutputTokens)
        }
        if req.Config.TopP != nil {
            openaiReq.TopP = *req.Config.TopP
        }
        if len(req.Config.StopSequences) > 0 {
            openaiReq.Stop = req.Config.StopSequences
        }

        // ThinkingConfig → ReasoningEffort
        if req.Config.ThinkingConfig != nil {
            switch req.Config.ThinkingConfig.ThinkingLevel {
            case genai.ThinkingLevelLow:
                openaiReq.ReasoningEffort = "low"
            case genai.ThinkingLevelHigh:
                openaiReq.ReasoningEffort = "high"
            default:
                openaiReq.ReasoningEffort = "medium"
            }
        }

        // ResponseSchema → JSON Schema response format
        if req.Config.ResponseSchema != nil {
            openaiSchema, err := genaiSchemaToOpenaiSchema(req.Config.ResponseSchema)
            if err != nil {
                return openai.ChatCompletionRequest{}, err
            }
            openaiReq.ResponseFormat = &openai.ChatCompletionResponseFormat{
                Type:       openai.ChatCompletionResponseFormatTypeJSONObject,
                JSONSchema: openaiSchema,
            }
        }

        // ResponseMIMEType = "application/json" → JSON mode
        if req.Config.ResponseMIMEType == "application/json" {
            openaiReq.ResponseFormat = &openai.ChatCompletionResponseFormat{
                Type: openai.ChatCompletionResponseFormatTypeJSONObject,
            }
        }

        // Tools → Function tools
        if len(req.Config.Tools) > 0 {
            tools, err := convertTools(req.Config.Tools)
            if err != nil {
                return openai.ChatCompletionRequest{}, err
            }
            openaiReq.Tools = tools
        }
    }

    return openaiReq, nil
}
```

### 4.7 消息转换：genai.Content → openai.ChatCompletionMessage

```go
func toOpenAIChatCompletionMessage(content *genai.Content) ([]openai.ChatCompletionMessage, error) {
    var toolRespMessages []openai.ChatCompletionMessage
    var nonFuncRespParts []*genai.Part

    // 分离 FunctionResponse parts（每个需要独立 tool message）
    for _, part := range content.Parts {
        if part.FunctionResponse != nil {
            responseJSON, _ := json.Marshal(part.FunctionResponse.Response)
            toolRespMessages = append(toolRespMessages, openai.ChatCompletionMessage{
                Role:       openai.ChatMessageRoleTool,
                Content:    string(responseJSON),
                ToolCallID: part.FunctionResponse.ID,
            })
        } else {
            nonFuncRespParts = append(nonFuncRespParts, part)
        }
    }

    if len(nonFuncRespParts) == 0 {
        return toolRespMessages, nil
    }

    openaiMsg := openai.ChatCompletionMessage{
        Role: convertRoleToOpenAI(content.Role),  // "user"→user, "model"→assistant
    }

    // 单一文本 → 简单 content
    // 多 part → MultiContent (text + image_url)
    // FunctionCall → ToolCalls
    // InlineData (image) → base64 data URL in MultiContent

    // ... 详细转换逻辑见完整代码

    return append(toolRespMessages, openaiMsg), nil
}
```

### 4.8 角色与 FinishReason 映射

```go
func convertRoleToOpenAI(role string) string {
    switch role {
    case "user":   return openai.ChatMessageRoleUser
    case "model":  return openai.ChatMessageRoleAssistant
    case "system": return openai.ChatMessageRoleSystem
    default:       return openai.ChatMessageRoleUser
    }
}

func convertFinishReason(reason string) genai.FinishReason {
    switch reason {
    case "stop":          return genai.FinishReasonStop
    case "length":        return genai.FinishReasonMaxTokens
    case "tool_calls":    return genai.FinishReasonStop      // tool_calls 视为正常结束
    case "content_filter": return genai.FinishReasonSafety
    default:              return genai.FinishReasonUnspecified
    }
}
```

---

## 五、Anthropic 适配器实现方案

基于 OpenAI 适配器的模式，Anthropic 适配器需要处理以下差异：

### 5.1 核心差异

| 维度 | OpenAI | Anthropic |
|------|--------|-----------|
| API 格式 | Chat Completion | Messages API |
| System Prompt | 放在 messages 中 (role=system) | 独立的 `system` 字段 |
| Tool Use 格式 | `tool_calls` 在 assistant message 中 | `tool_use` content block |
| Tool Result | `role=tool` message | `tool_result` content block in user message |
| 流式格式 | SSE `data: {delta}` | SSE `event: content_block_delta` |
| 思考/推理 | `reasoning_content` (o-series) | `thinking` content block |
| 图片输入 | base64 data URL 或 URL | `source.type=base64` in content block |

### 5.2 结构体设计

```go
package anthropic

import (
    "context"
    "iter"
    "google.golang.org/adk/model"
    "google.golang.org/genai"
)

type AnthropicModel struct {
    Client    *anthropic.Client  // 或自定义 HTTP client
    ModelName string
    APIKey    string
    BaseURL   string             // 支持自定义 endpoint
}

var _ model.LLM = &AnthropicModel{}
```

### 5.3 请求转换：genai → Anthropic Messages API

```go
type anthropicRequest struct {
    Model     string              `json:"model"`
    System    string              `json:"system,omitempty"`
    Messages  []anthropicMessage  `json:"messages"`
    MaxTokens int                 `json:"max_tokens"`
    // 可选
    Temperature  *float32         `json:"temperature,omitempty"`
    TopP         *float32         `json:"top_p,omitempty"`
    StopSequences []string        `json:"stop_sequences,omitempty"`
    Tools        []anthropicTool  `json:"tools,omitempty"`
    Stream       bool             `json:"stream,omitempty"`
}

type anthropicMessage struct {
    Role    string               `json:"role"`     // "user" | "assistant"
    Content []anthropicContentBlock `json:"content"`
}

type anthropicContentBlock struct {
    Type string `json:"type"`  // "text" | "image" | "tool_use" | "tool_result" | "thinking"
    // text
    Text string `json:"text,omitempty"`
    // image
    Source *anthropicImageSource `json:"source,omitempty"`
    // tool_use
    ID   string         `json:"id,omitempty"`
    Name string         `json:"name,omitempty"`
    Input map[string]any `json:"input,omitempty"`
    // tool_result
    ToolUseID string         `json:"tool_use_id,omitempty"`
    Content   any            `json:"content,omitempty"`
    // thinking
    Thinking string `json:"thinking,omitempty"`
}

func toAnthropicRequest(req *model.LLMRequest, modelName string) (*anthropicRequest, error) {
    result := &anthropicRequest{
        Model:     modelName,
        MaxTokens: 8192,  // 默认值
    }

    // 1. System Instruction → 独立 system 字段
    if req.Config != nil && req.Config.SystemInstruction != nil {
        result.System = extractTextFromContent(req.Config.SystemInstruction)
    }

    // 2. 转换消息
    for _, content := range req.Contents {
        msg, err := toAnthropicMessage(content)
        if err != nil {
            return nil, err
        }
        // Anthropic 要求 user/assistant 交替，可能需要合并连续同角色消息
        result.Messages = append(result.Messages, msg)
    }

    // 3. 配置映射
    if req.Config != nil {
        if req.Config.Temperature != nil {
            result.Temperature = req.Config.Temperature
        }
        if req.Config.MaxOutputTokens > 0 {
            result.MaxTokens = int(req.Config.MaxOutputTokens)
        }
        if req.Config.TopP != nil {
            result.TopP = req.Config.TopP
        }
        if len(req.Config.StopSequences) > 0 {
            result.StopSequences = req.Config.StopSequences
        }

        // 4. Tools 转换
        if len(req.Config.Tools) > 0 {
            tools, err := convertAnthropicTools(req.Config.Tools)
            if err != nil {
                return nil, err
            }
            result.Tools = tools
        }
    }

    return result, nil
}
```

### 5.4 消息转换关键差异

```go
func toAnthropicMessage(content *genai.Content) (anthropicMessage, error) {
    msg := anthropicMessage{
        Role: convertRoleToAnthropic(content.Role),  // "model"→"assistant"
    }

    for _, part := range content.Parts {
        switch {
        case part.Text != "":
            // Anthropic 的 FunctionResponse (tool_result) 必须放在 user 消息中
            // 需要特殊处理
            msg.Content = append(msg.Content, anthropicContentBlock{
                Type: "text",
                Text: part.Text,
            })

        case part.FunctionCall != nil:
            msg.Content = append(msg.Content, anthropicContentBlock{
                Type:  "tool_use",
                ID:    part.FunctionCall.ID,
                Name:  part.FunctionCall.Name,
                Input: part.FunctionCall.Args,
            })

        case part.FunctionResponse != nil:
            // ⚠️ Anthropic 中 tool_result 必须在 user 角色消息中
            msg.Role = "user"  // 强制角色为 user
            msg.Content = append(msg.Content, anthropicContentBlock{
                Type:      "tool_result",
                ToolUseID: part.FunctionResponse.ID,
                Content:   part.FunctionResponse.Response,
            })

        case part.InlineData != nil && isImageMIME(part.InlineData.MIMEType):
            msg.Content = append(msg.Content, anthropicContentBlock{
                Type: "image",
                Source: &anthropicImageSource{
                    Type:      "base64",
                    MediaType: part.InlineData.MIMEType,
                    Data:      base64.StdEncoding.EncodeToString(part.InlineData.Data),
                },
            })
        }
    }

    return msg, nil
}
```

### 5.5 流式响应处理

Anthropic 使用 SSE 事件类型区分流式帧：

```
event: message_start       → 消息开始（含 model 信息）
event: content_block_start → 新 content block 开始
event: content_block_delta → content block 增量数据
event: content_block_stop  → content block 结束
event: message_delta       → 消息级更新（stop_reason, usage）
event: message_stop        → 消息结束
```

```go
func (a *AnthropicModel) generateStream(ctx context.Context, req *model.LLMRequest) iter.Seq2[*model.LLMResponse, error] {
    return func(yield func(*model.LLMResponse, error) bool) {
        anthropicReq, err := toAnthropicRequest(req, a.ModelName)
        if err != nil {
            yield(nil, err)
            return
        }
        anthropicReq.Stream = true

        // 发起 SSE 流式请求
        stream, err := a.createStream(ctx, anthropicReq)
        if err != nil {
            yield(nil, err)
            return
        }
        defer stream.Close()

        // 聚合状态
        var aggregatedParts []*genai.Part
        var finishReason genai.FinishReason
        var usageMetadata *genai.GenerateContentResponseUsageMetadata

        // Tool call 聚合（Anthropic 的 tool input 是流式 JSON）
        currentToolID   := ""
        currentToolName := ""
        currentToolArgs := ""

        for event := range stream.Events() {
            switch event.Type {

            case "content_block_delta":
                delta := event.Delta
                if delta.Type == "text_delta" {
                    // 文本增量 → yield 部分帧
                    part := &genai.Part{Text: delta.Text}
                    aggregatedParts = append(aggregatedParts, part)

                    llmResp := &model.LLMResponse{
                        Content:      &genai.Content{Role: "model", Parts: []*genai.Part{part}},
                        Partial:      true,
                        TurnComplete: false,
                    }
                    if !yield(llmResp, nil) {
                        return
                    }

                } else if delta.Type == "input_json_delta" {
                    // Tool input 增量 → 聚合
                    currentToolArgs += delta.PartialJSON

                } else if delta.Type == "thinking_delta" {
                    // 思考增量 → yield 部分帧（Thought=true）
                    part := &genai.Part{Text: delta.Thinking, Thought: true}
                    llmResp := &model.LLMResponse{
                        Content:      &genai.Content{Role: "model", Parts: []*genai.Part{part}},
                        Partial:      true,
                        TurnComplete: false,
                    }
                    if !yield(llmResp, nil) {
                        return
                    }
                }

            case "content_block_start":
                if contentBlock := event.ContentBlock; contentBlock != nil {
                    if contentBlock.Type == "tool_use" {
                        currentToolID = contentBlock.ID
                        currentToolName = contentBlock.Name
                        currentToolArgs = ""
                    }
                }

            case "content_block_stop":
                if currentToolName != "" {
                    // Tool call 完成 → 加入聚合
                    aggregatedParts = append(aggregatedParts, &genai.Part{
                        FunctionCall: &genai.FunctionCall{
                            ID:   currentToolID,
                            Name: currentToolName,
                            Args: parseJSONArgs(currentToolArgs),
                        },
                    })
                    currentToolID = ""
                    currentToolName = ""
                    currentToolArgs = ""
                }

            case "message_delta":
                if event.Delta != nil && event.Delta.StopReason != "" {
                    finishReason = convertAnthropicFinishReason(event.Delta.StopReason)
                }
                if event.Usage != nil {
                    usageMetadata = &genai.GenerateContentResponseUsageMetadata{
                        PromptTokenCount:     int32(event.Usage.InputTokens),
                        CandidatesTokenCount: int32(event.Usage.OutputTokens),
                        TotalTokenCount:      int32(event.Usage.InputTokens + event.Usage.OutputTokens),
                    }
                }

            case "message_stop":
                // 流结束 → yield 最终帧
                finalResp := &model.LLMResponse{
                    Content: &genai.Content{
                        Role:  "model",
                        Parts: aggregatedParts,
                    },
                    UsageMetadata: usageMetadata,
                    FinishReason:  finishReason,
                    Partial:       false,
                    TurnComplete:  true,
                }
                yield(finalResp, nil)
                return
            }
        }
    }
}

func convertAnthropicFinishReason(reason string) genai.FinishReason {
    switch reason {
    case "end_turn":      return genai.FinishReasonStop
    case "max_tokens":    return genai.FinishReasonMaxTokens
    case "stop_sequence": return genai.FinishReasonStop
    case "tool_use":      return genai.FinishReasonStop
    default:              return genai.FinishReasonUnspecified
    }
}
```

---

## 六、流式响应处理对比总结

| 方面 | Gemini | OpenAI | Anthropic |
|------|--------|--------|-----------|
| 流式协议 | gRPC/gemini SSE | SSE (`data: {delta}`) | SSE (`event: type`) |
| 文本增量 | `Part.Text` in partial response | `delta.content` | `content_block_delta.text_delta` |
| Tool 增量 | `PartialArgs` (结构化) | `delta.tool_calls[].function.arguments` (JSON 字符串拼接) | `input_json_delta.partial_json` (JSON 字符串拼接) |
| 思考/推理 | `Part.Thought=true` | `delta.reasoning_content` (o-series) | `thinking_delta` content block |
| 结束信号 | `FinishReason != ""` | `finish_reason` in choice | `message_delta.stop_reason` + `message_stop` event |
| 聚合器 | `StreamingResponseAggregator` (内置) | 自定义 `toolCallBuilder` + 手动聚合 | 自定义 `currentTool*` 状态 + 手动聚合 |
| Usage | 在最终帧 | `chunk.Usage` (stream_options) | `message_delta.usage` |

---

## 七、实现注意事项

### 7.1 通用要点
1. **编译时接口检查**: 使用 `var _ model.LLM = &OpenAIModel{}` 确保实现正确
2. **yield 退出检查**: 始终检查 `yield` 返回值，消费者可能随时停止迭代
3. **错误处理**: `yield(nil, err)` 后立即 `return`，不再继续
4. **资源清理**: 流式模式下使用 `defer stream.Close()` 确保连接释放

### 7.2 OpenAI 特有
1. **Tool Calls 聚合**: OpenAI 流式返回 tool calls 时，`id`、`name`、`arguments` 分布在不同 chunk 中，需要按 `Index` 聚合
2. **Reasoning Content**: o-series模型的 `reasoning_content` 需映射到 `Part.Thought=true`（当前 adk-go-openai 标记为 TODO）
3. **Base URL**: 支持自定义 Base URL 以兼容 Azure OpenAI、DeepSeek 等

### 7.3 Anthropic 特有
1. **角色交替约束**: Anthropic 要求 user/assistant 消息严格交替，需合并连续同角色消息
2. **tool_result 在 user 消息中**: `FunctionResponse` 必须转换为 `role=user` 的 `tool_result` content block
3. **System Prompt 独立字段**: 不能放在 messages 中，必须提取到 `system` 参数
4. **MaxTokens 必填**: Anthropic API 要求 `max_tokens` 参数
5. **Thinking blocks**: Claude 的 extended thinking 需映射到 `Part.Thought=true`

### 7.4 不支持的特性
- `GroundingMetadata` / `CitationMetadata`: OpenAI/Anthropic 无对应概念
- `GoogleSearch` / `CodeExecution` / `FileSearch`: Gemini 专有工具
- `FileData`: OpenAI/Anthropic 不支持文件引用，需下载后转 inline
- 音频/视频输入: OpenAI 仅支持部分音频，Anthropic 不支持

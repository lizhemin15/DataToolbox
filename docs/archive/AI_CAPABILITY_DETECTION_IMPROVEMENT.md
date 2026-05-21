# AI 模型能力检测功能改进说明

## 改进概述

改进了 `detectAICapabilities()` 函数，从基于模型名称的推断改为使用实际 API 调用进行试错检测，提高检测准确性。

## 主要改进

### 1. 实际 API 调用测试

新增四个测试函数，通过实际 API 调用检测模型能力：

#### testBasicConnectivity()
- **目的**: 测试基本连通性
- **方法**: 发送简单请求 `"hello"`
- **超时**: 10秒
- **返回**: (bool, error) - 是否成功及错误信息

#### testFunctionCall()
- **目的**: 测试 Function Call 支持
- **方法**: 发送带 `tools` 参数的请求，检查响应中是否包含 `tool_calls`
- **测试工具**: 定义了一个简单的 `get_weather` 函数
- **返回**: (bool, error) - 是否支持及错误信息

#### testStreaming()
- **目的**: 测试流式输出支持
- **方法**: 发送 `stream=true` 的请求，检查响应头 `Content-Type`
- **检查类型**: `text/event-stream` 或 `application/stream+json`
- **返回**: (bool, error) - 是否支持及错误信息

#### testJSONMode()
- **目的**: 测试 JSON 输出模式支持
- **方法**: 发送带 `response_format={"type": "json_object"}` 的请求
- **验证**: 检查返回内容是否为有效 JSON
- **返回**: (bool, error) - 是否支持及错误信息

### 2. 详细日志记录

在检测过程中添加了详细的日志记录，方便调试：

```
[AI能力检测] 开始检测模型: gpt-4, URL: https://api.openai.com/v1/chat/completions
[AI能力检测] 测试基本连通性...
[AI能力检测] ✓ 基本连通性测试成功
[AI能力检测] 测试 Function Call 支持...
[AI能力检测] ✓ 支持 Function Call
[AI能力检测] 测试 Streaming 支持...
[AI能力检测] ✓ 支持 Streaming
[AI能力检测] 测试 JSON Mode 支持...
[AI能力检测] ✓ 支持 JSON Mode
[AI能力检测] 推断上下文窗口大小: 8192
[AI能力检测] 推断 Thinking 支持: false
[AI能力检测] 检测完成: FunctionCall=true, Streaming=true, JSONMode=true, Thinking=false, ContextWindow=8192
```

### 3. 错误信息记录

每个测试函数都返回详细的错误信息：

- 构建请求失败
- 创建请求失败
- 请求失败（网络错误）
- HTTP 状态码错误（包含响应体）
- 解析响应失败
- 功能不支持的具体原因

### 4. 超时处理

- 所有测试使用 10 秒超时的 HTTP 客户端
- 避免某个测试长时间阻塞
- 如果超时，返回超时错误信息

### 5. 智能检测流程

检测流程优化：

1. **手动设置优先**: 如果用户手动设置了某项能力，直接使用手动设置值
2. **连通性测试先行**: 先测试基本连通性，失败则跳过后续测试
3. **逐项测试**: 对未手动设置的能力逐项进行 API 测试
4. **推断补充**: 上下文窗口和 Thinking 支持仍使用模型名称推断（难以通过 API 测试）

### 6. 兼容性处理

- 使用标准 OpenAI API 格式发送请求
- 兼容不同提供商（OpenAI、Anthropic、本地模型等）
- 如果某项测试失败，不中断，继续测试其他能力
- 记录每项测试的错误信息

## 代码结构

### 新增类型

```go
// AICapabilityTestResult 单项能力测试结果
type AICapabilityTestResult struct {
    Success bool   `json:"success"`
    Error   string `json:"error,omitempty"`
}

// AICapabilitiesDetectionDetails 详细检测结果
type AICapabilitiesDetectionDetails struct {
    Connectivity   AICapabilityTestResult `json:"connectivity"`
    FunctionCall   AICapabilityTestResult `json:"function_call"`
    Streaming      AICapabilityTestResult `json:"streaming"`
    JSONMode       AICapabilityTestResult `json:"json_mode"`
}
```

### 新增函数

```go
func testBasicConnectivity(client *http.Client, config *AIConfig) (bool, error)
func testFunctionCall(client *http.Client, config *AIConfig) (bool, error)
func testStreaming(client *http.Client, config *AIConfig) (bool, error)
func testJSONMode(client *http.Client, config *AIConfig) (bool, error)
func inferContextWindow(model string) int
func inferThinkingSupport(model string) bool
```

### 改进函数

```go
func detectAICapabilities(config *AIConfig) (*AICapabilities, error)
```

## 使用示例

### 场景 1: 完全自动检测

```go
config := &AIConfig{
    URL:    "https://api.openai.com/v1/chat/completions",
    APIKey: "sk-xxx",
    Model:  "gpt-4",
}

capabilities, err := detectAICapabilities(config)
// 将通过 API 测试检测所有能力
```

### 场景 2: 部分手动设置

```go
enableFC := true
config := &AIConfig{
    URL:                "https://api.openai.com/v1/chat/completions",
    APIKey:             "sk-xxx",
    Model:              "gpt-4",
    EnableFunctionCall: &enableFC, // 手动设置
}

capabilities, err := detectAICapabilities(config)
// Function Call 使用手动设置，其他能力通过 API 测试
```

### 场景 3: 全部手动设置

```go
enableFC := true
enableThinking := false
enableStreaming := true
enableJSON := true

config := &AIConfig{
    URL:                   "https://api.openai.com/v1/chat/completions",
    APIKey:                "sk-xxx",
    Model:                 "gpt-4",
    EnableFunctionCall:    &enableFC,
    EnableThinking:        &enableThinking,
    EnableStreaming:       &enableStreaming,
    EnableJSONMode:        &enableJSON,
    ContextWindowOverride: 8192,
}

capabilities, err := detectAICapabilities(config)
// 所有能力使用手动设置，跳过 API 测试
```

## 性能影响

- 每次检测最多进行 4 次 API 调用（连通性 + 3 项能力测试）
- 每次调用超时 10 秒，最坏情况耗时 40 秒
- 实际使用中，大多数模型会在 5-10 秒内完成所有测试
- 建议在配置保存时触发检测，而非每次调用时检测

## 错误处理

### 连通性失败

如果基本连通性测试失败，将跳过后续所有测试，返回默认值：

```go
capabilities := &AICapabilities{
    SupportsFunctionCall: false,
    SupportsThinking:     false,
    SupportsStreaming:    true,  // 默认支持
    ContextWindow:        4096,  // 默认值
    SupportsJSONMode:     false,
}
```

### 单项测试失败

如果某项测试失败（如不支持或出错），不影响其他测试继续进行。

## 日志查看

启动服务后，可以在日志中查看详细的检测过程：

```bash
# 查看检测日志
tail -f /var/log/datatoolbox.log | grep "AI能力检测"
```

## 注意事项

1. **API 调用成本**: 每次检测会产生少量 API 调用成本（约 4 次简单请求）
2. **网络依赖**: 需要能够访问 AI 服务的 API 端点
3. **超时设置**: 当前设置为 10 秒，可根据网络情况调整
4. **手动优先**: 手动设置的能力不会被 API 测试覆盖
5. **Thinking 推断**: Extended Thinking 能力仍使用模型名称推断（难以通过 API 测试）

## 未来改进方向

1. 缓存检测结果，避免重复测试
2. 支持自定义测试超时时间
3. 添加更多能力测试（如 vision、audio 等）
4. 支持批量检测多个模型
5. 提供检测报告导出功能

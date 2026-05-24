// PicoClaw - Ultra-lightweight personal AI agent
// License: MIT
//
// Copyright (c) 2026 PicoClaw contributors

// Package common provides shared utilities used by multiple LLM provider
// implementations (openai_compat, azure, etc.).
package common

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/YOUR_USERNAME/DataToolbox/picoclaw/pkg/providers/protocoltypes"
)

// Re-export protocol types used across providers.
type (
	ToolCall               = protocoltypes.ToolCall
	FunctionCall           = protocoltypes.FunctionCall
	LLMResponse            = protocoltypes.LLMResponse
	UsageInfo              = protocoltypes.UsageInfo
	Message                = protocoltypes.Message
	ToolDefinition         = protocoltypes.ToolDefinition
	ToolFunctionDefinition = protocoltypes.ToolFunctionDefinition
	ExtraContent           = protocoltypes.ExtraContent
	GoogleExtra            = protocoltypes.GoogleExtra
	ReasoningDetail        = protocoltypes.ReasoningDetail
)

const DefaultRequestTimeout = 180 * time.Second

// NewHTTPClient creates an *http.Client with an optional proxy and the default timeout.
func NewHTTPClient(proxy string) *http.Client {
	client := &http.Client{
		Timeout: DefaultRequestTimeout,
	}
	if proxy != "" {
		parsed, err := url.Parse(proxy)
		if err == nil {
			// Preserve http.DefaultTransport settings (TLS, HTTP/2, timeouts, etc.)
			if base, ok := http.DefaultTransport.(*http.Transport); ok {
				tr := base.Clone()
				tr.Proxy = http.ProxyURL(parsed)
				client.Transport = tr
			} else {
				// Fallback: minimal transport if DefaultTransport is not *http.Transport.
				client.Transport = &http.Transport{
					Proxy: http.ProxyURL(parsed),
				}
			}
		} else {
			log.Printf("common: invalid proxy URL %q: %v", proxy, err)
		}
	}
	return client
}

// --- Message serialization ---

// openaiMessage is the wire-format message for OpenAI-compatible APIs.
// It mirrors protocoltypes.Message but omits SystemParts, which is an
// internal field that would be unknown to third-party endpoints.
type openaiMessage struct {
	Role             string           `json:"role"`
	Content          string           `json:"content"`
	ReasoningContent string           `json:"reasoning_content,omitempty"`
	ToolCalls        []openaiToolCall `json:"tool_calls,omitempty"`
	ToolCallID       string           `json:"tool_call_id,omitempty"`
}

type openaiToolCall struct {
	ID       string              `json:"id"`
	Type     string              `json:"type,omitempty"`
	Function *openaiFunctionCall `json:"function,omitempty"`
}

type openaiFunctionCall struct {
	Name             string `json:"name"`
	Arguments        string `json:"arguments"`
	ThoughtSignature string `json:"thought_signature,omitempty"`
}

// SerializeMessages converts internal Message structs to the OpenAI wire format.
//   - Strips SystemParts (unknown to third-party endpoints)
//   - Converts messages with Media to multipart content format (text + image_url parts)
//   - Preserves ToolCallID, ToolCalls, and ReasoningContent for all messages
func SerializeMessages(messages []Message) []any {
	out := make([]any, 0, len(messages))
	for _, m := range messages {
		toolCalls := serializeToolCalls(m.ToolCalls)
		if len(m.Media) == 0 {
			out = append(out, openaiMessage{
				Role:             m.Role,
				Content:          m.Content,
				ReasoningContent: m.ReasoningContent,
				ToolCalls:        toolCalls,
				ToolCallID:       m.ToolCallID,
			})
			continue
		}

		// Multipart content format for messages with media
		parts := make([]map[string]any, 0, 1+len(m.Media))
		if m.Content != "" {
			parts = append(parts, map[string]any{
				"type": "text",
				"text": m.Content,
			})
		}
		for _, mediaURL := range m.Media {
			if strings.HasPrefix(mediaURL, "data:image/") {
				parts = append(parts, map[string]any{
					"type": "image_url",
					"image_url": map[string]any{
						"url": mediaURL,
					},
				})
				continue
			}

			if format, data, ok := ParseDataAudioURL(mediaURL); ok {
				parts = append(parts, map[string]any{
					"type": "input_audio",
					"input_audio": map[string]any{
						"data":   data,
						"format": format,
					},
				})
			}
		}

		msg := map[string]any{
			"role":    m.Role,
			"content": parts,
		}
		if m.ToolCallID != "" {
			msg["tool_call_id"] = m.ToolCallID
		}
		if len(toolCalls) > 0 {
			msg["tool_calls"] = toolCalls
		}
		if m.ReasoningContent != "" {
			msg["reasoning_content"] = m.ReasoningContent
		}
		out = append(out, msg)
	}
	return out
}

func serializeToolCalls(toolCalls []ToolCall) []openaiToolCall {
	if len(toolCalls) == 0 {
		return nil
	}

	out := make([]openaiToolCall, 0, len(toolCalls))
	for _, tc := range toolCalls {
		wireCall := openaiToolCall{
			ID:   tc.ID,
			Type: tc.Type,
		}

		if tc.Function != nil {
			thoughtSignature := tc.Function.ThoughtSignature
			if thoughtSignature == "" {
				thoughtSignature = tc.ThoughtSignature
			}
			if thoughtSignature == "" && tc.ExtraContent != nil && tc.ExtraContent.Google != nil {
				thoughtSignature = tc.ExtraContent.Google.ThoughtSignature
			}
			wireCall.Function = &openaiFunctionCall{
				Name:             tc.Function.Name,
				Arguments:        tc.Function.Arguments,
				ThoughtSignature: thoughtSignature,
			}
		} else if tc.Name != "" || len(tc.Arguments) > 0 || tc.ThoughtSignature != "" {
			thoughtSignature := tc.ThoughtSignature
			if thoughtSignature == "" && tc.ExtraContent != nil && tc.ExtraContent.Google != nil {
				thoughtSignature = tc.ExtraContent.Google.ThoughtSignature
			}
			argsJSON := "{}"
			if len(tc.Arguments) > 0 {
				if encoded, err := json.Marshal(tc.Arguments); err == nil {
					argsJSON = string(encoded)
				}
			}
			wireCall.Function = &openaiFunctionCall{
				Name:             tc.Name,
				Arguments:        argsJSON,
				ThoughtSignature: thoughtSignature,
			}
		}

		out = append(out, wireCall)
	}

	return out
}

// ParseDataAudioURL extracts the format and base64 data from a data:audio/... URL.
func ParseDataAudioURL(mediaURL string) (format, data string, ok bool) {
	if !strings.HasPrefix(mediaURL, "data:audio/") {
		return "", "", false
	}

	payload := strings.TrimPrefix(mediaURL, "data:audio/")
	meta, data, found := strings.Cut(payload, ",")
	if !found {
		return "", "", false
	}

	format, _, _ = strings.Cut(meta, ";")
	format = strings.TrimSpace(format)
	data = strings.TrimSpace(data)
	if format == "" || data == "" {
		return "", "", false
	}
	return format, data, true
}

// --- Response parsing ---

// ParseResponse parses a JSON chat completion response body into an LLMResponse.
func ParseResponse(body io.Reader) (*LLMResponse, error) {
	var apiResponse struct {
		Choices []struct {
			Message struct {
				Content          string            `json:"content"`
				ReasoningContent string            `json:"reasoning_content"`
				Reasoning        string            `json:"reasoning"`
				ReasoningDetails []ReasoningDetail `json:"reasoning_details"`
				ToolCalls        []struct {
					ID       string `json:"id"`
					Type     string `json:"type"`
					Function *struct {
						Name             string          `json:"name"`
						Arguments        json.RawMessage `json:"arguments"`
						ThoughtSignature string          `json:"thought_signature"`
					} `json:"function"`
					ExtraContent *struct {
						Google *struct {
							ThoughtSignature string `json:"thought_signature"`
						} `json:"google"`
						ToolFeedbackExplanation string `json:"tool_feedback_explanation"`
					} `json:"extra_content"`
				} `json:"tool_calls"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Usage *UsageInfo `json:"usage"`
	}

	if err := json.NewDecoder(body).Decode(&apiResponse); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if len(apiResponse.Choices) == 0 {
		return &LLMResponse{
			Content:      "",
			FinishReason: "stop",
		}, nil
	}

	choice := apiResponse.Choices[0]
	toolCalls := make([]ToolCall, 0, len(choice.Message.ToolCalls))
	for _, tc := range choice.Message.ToolCalls {
		arguments := make(map[string]any)
		name := ""

		thoughtSignature := ""
		if tc.Function != nil {
			thoughtSignature = tc.Function.ThoughtSignature
		}
		if thoughtSignature == "" && tc.ExtraContent != nil && tc.ExtraContent.Google != nil {
			thoughtSignature = tc.ExtraContent.Google.ThoughtSignature
		}

		if tc.Function != nil {
			name = tc.Function.Name
			arguments = DecodeToolCallArguments(tc.Function.Arguments, name)
		}

		toolCall := ToolCall{
			ID:               tc.ID,
			Name:             name,
			Arguments:        arguments,
			ThoughtSignature: thoughtSignature,
		}

		if thoughtSignature != "" || tc.ExtraContent != nil {
			extraContent := &ExtraContent{
				ToolFeedbackExplanation: "",
			}
			if tc.ExtraContent != nil {
				extraContent.ToolFeedbackExplanation = tc.ExtraContent.ToolFeedbackExplanation
			}
			if thoughtSignature != "" {
				extraContent.Google = &GoogleExtra{
					ThoughtSignature: thoughtSignature,
				}
			}
			if extraContent.Google != nil || strings.TrimSpace(extraContent.ToolFeedbackExplanation) != "" {
				toolCall.ExtraContent = extraContent
			}
		}

		toolCalls = append(toolCalls, toolCall)
	}

	return &LLMResponse{
		Content:          choice.Message.Content,
		ReasoningContent: choice.Message.ReasoningContent,
		Reasoning:        choice.Message.Reasoning,
		ReasoningDetails: choice.Message.ReasoningDetails,
		ToolCalls:        toolCalls,
		FinishReason:     normalizeFinishReason(choice.FinishReason),
		Usage:            apiResponse.Usage,
	}, nil
}

// normalizeFinishReason normalizes finish_reason values across providers.
// Converts "length" to "truncated" for consistent handling.
func normalizeFinishReason(reason string) string {
	if reason == "length" {
		return "truncated"
	}
	return reason
}

// FixTruncatedJSON attempts to repair truncated JSON by closing unclosed
// strings and adding missing closing brackets. This handles the common case
// where an LLM's tool-call arguments are cut off mid-stream (e.g. by a
// token limit or a dropped SSE chunk).
//
// Strategy:
//  1. Walk the raw bytes tracking whether we are inside a JSON string.
//  2. If the input ends while inside a string, close it with '"'.
//  3. Count unmatched '[' and '{' and append the corresponding ']' / '}'.
//  4. Try json.Unmarshal; if it still fails, progressively strip the last
//     key/value pair from objects and retry.
func FixTruncatedJSON(raw string) string {
	if raw == "" {
		return raw
	}
	// Quick check — maybe it's already valid.
	if json.Valid([]byte(raw)) {
		return raw
	}

	// --- Phase 1: close unclosed string ---
	inStr := false
	escape := false
	for i := 0; i < len(raw); i++ {
		ch := raw[i]
		if escape {
			escape = false
			continue
		}
		if ch == '\\' {
			if inStr {
				escape = true
			}
			continue
		}
		if ch == '"' {
			inStr = !inStr
		}
	}

	fixed := raw
	if inStr {
		// We're inside an unclosed string. Close it.
		fixed = fixed + "\""
	}

	// --- Phase 2: count unmatched brackets (outside strings) ---
	inStr = false
	escape = false
	openSquare := 0
	openCurly := 0
	for i := 0; i < len(fixed); i++ {
		ch := fixed[i]
		if escape {
			escape = false
			continue
		}
		if ch == '\\' {
			if inStr {
				escape = true
			}
			continue
		}
		if ch == '"' {
			inStr = !inStr
			continue
		}
		if inStr {
			continue
		}
		switch ch {
		case '[':
			openSquare++
		case ']':
			openSquare--
		case '{':
			openCurly++
		case '}':
			openCurly--
		}
	}

	// Append closing brackets (inner first: ] before })
	for i := 0; i < openSquare; i++ {
		fixed += "]"
	}
	for i := 0; i < openCurly; i++ {
		fixed += "}"
	}

	if json.Valid([]byte(fixed)) {
		log.Printf("common: FixTruncatedJSON repaired JSON (closed_string=%v, added_]=%d }=%d, orig_len=%d)",
			inStr, openSquare, openCurly, len(raw))
		return fixed
	}

	// --- Phase 3: progressive truncation of last key/value ---
	// Find the last comma at the object level and truncate after it.
	for attempt := 0; attempt < 5; attempt++ {
		lastComma := -1
		depth := 0
		inStr2 := false
		esc := false
		for i := 0; i < len(fixed); i++ {
			ch := fixed[i]
			if esc {
				esc = false
				continue
			}
			if ch == '\\' && inStr2 {
				esc = true
				continue
			}
			if ch == '"' {
				inStr2 = !inStr2
				continue
			}
			if inStr2 {
				continue
			}
			switch ch {
			case '[', '{':
				depth++
			case ']', '}':
				depth--
			case ',':
				if depth <= 1 {
					lastComma = i
				}
			}
		}
		if lastComma <= 0 {
			break
		}
		// Truncate after the comma, then re-close brackets.
		truncated := fixed[:lastComma]
		// Re-count brackets in truncated string
		inStr2 = false
		esc = false
		os, oc := 0, 0
		for i := 0; i < len(truncated); i++ {
			ch := truncated[i]
			if esc {
				esc = false
				continue
			}
			if ch == '\\' && inStr2 {
				esc = true
				continue
			}
			if ch == '"' {
				inStr2 = !inStr2
				continue
			}
			if inStr2 {
				continue
			}
			switch ch {
			case '[':
				os++
			case ']':
				os--
			case '{':
				oc++
			case '}':
				oc--
			}
		}
		for j := 0; j < os; j++ {
			truncated += "]"
		}
		for j := 0; j < oc; j++ {
			truncated += "}"
		}
		if json.Valid([]byte(truncated)) {
			log.Printf("common: FixTruncatedJSON repaired JSON via progressive truncation (attempt=%d, orig_len=%d, fixed_len=%d)",
				attempt+1, len(raw), len(truncated))
			return truncated
		}
		fixed = truncated
	}

	log.Printf("common: FixTruncatedJSON failed to repair JSON (orig_len=%d)", len(raw))
	return raw
}

// DecodeToolCallArguments decodes a tool call's arguments from raw JSON.
func DecodeToolCallArguments(raw json.RawMessage, name string) map[string]any {
	arguments := make(map[string]any)
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return arguments
	}

	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		// Try fixing truncated JSON before giving up
		fixed := FixTruncatedJSON(string(raw))
		if fixed != string(raw) {
			if err2 := json.Unmarshal([]byte(fixed), &decoded); err2 == nil {
				goto decoded
			}
		}
		log.Printf("common: failed to decode tool call arguments payload for %q: %v", name, err)
		arguments["raw"] = string(raw)
		return arguments
	}

decoded:
	switch v := decoded.(type) {
	case string:
		if strings.TrimSpace(v) == "" {
			return arguments
		}
		if err := json.Unmarshal([]byte(v), &arguments); err != nil {
			// Try fixing truncated JSON
			fixed := FixTruncatedJSON(v)
			if fixed != v {
				if err2 := json.Unmarshal([]byte(fixed), &arguments); err2 == nil {
					return arguments
				}
			}
			log.Printf("common: failed to decode tool call arguments for %q: %v", name, err)
			arguments["raw"] = v
		}
		return arguments
	case map[string]any:
		return v
	default:
		log.Printf("common: unsupported tool call arguments type for %q: %T", name, decoded)
		arguments["raw"] = string(raw)
		return arguments
	}
}

// --- HTTP response helpers ---

// HandleErrorResponse reads a non-200 response body and returns an appropriate error.
func HandleErrorResponse(resp *http.Response, apiBase string) error {
	contentType := resp.Header.Get("Content-Type")
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, 256))
	if readErr != nil {
		return fmt.Errorf("failed to read response: %w", readErr)
	}
	if LooksLikeHTML(body, contentType) {
		return WrapHTMLResponseError(resp.StatusCode, body, contentType, apiBase)
	}
	return fmt.Errorf(
		"API request failed:\n  Status: %d\n  Body:   %s",
		resp.StatusCode,
		ResponsePreview(body, 128),
	)
}

// ReadAndParseResponse peeks at the response body to detect HTML errors,
// then parses the JSON response into an LLMResponse.
func ReadAndParseResponse(resp *http.Response, apiBase string) (*LLMResponse, error) {
	contentType := resp.Header.Get("Content-Type")
	reader := bufio.NewReader(resp.Body)
	prefix, err := reader.Peek(256)
	if err != nil && err != io.EOF && err != bufio.ErrBufferFull {
		return nil, fmt.Errorf("failed to inspect response: %w", err)
	}
	if LooksLikeHTML(prefix, contentType) {
		return nil, WrapHTMLResponseError(resp.StatusCode, prefix, contentType, apiBase)
	}
	out, err := ParseResponse(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to parse JSON response: %w", err)
	}
	return out, nil
}

// LooksLikeHTML checks if the response body appears to be HTML.
func LooksLikeHTML(body []byte, contentType string) bool {
	contentType = strings.ToLower(strings.TrimSpace(contentType))
	if strings.Contains(contentType, "text/html") || strings.Contains(contentType, "application/xhtml+xml") {
		return true
	}
	prefix := bytes.ToLower(leadingTrimmedPrefix(body, 128))
	return bytes.HasPrefix(prefix, []byte("<!doctype html")) ||
		bytes.HasPrefix(prefix, []byte("<html")) ||
		bytes.HasPrefix(prefix, []byte("<head")) ||
		bytes.HasPrefix(prefix, []byte("<body"))
}

// WrapHTMLResponseError creates a descriptive error for HTML responses.
func WrapHTMLResponseError(statusCode int, body []byte, contentType, apiBase string) error {
	respPreview := ResponsePreview(body, 128)
	return fmt.Errorf(
		"API request failed: %s returned HTML instead of JSON (content-type: %s); check api_base or proxy configuration.\n  Status: %d\n  Body:   %s",
		apiBase,
		contentType,
		statusCode,
		respPreview,
	)
}

// ResponsePreview returns a truncated preview of response body for error messages.
func ResponsePreview(body []byte, maxLen int) string {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return "<empty>"
	}
	if len(trimmed) <= maxLen {
		return string(trimmed)
	}
	return string(trimmed[:maxLen]) + "..."
}

func leadingTrimmedPrefix(body []byte, maxLen int) []byte {
	i := 0
	for i < len(body) {
		switch body[i] {
		case ' ', '\t', '\n', '\r', '\f', '\v':
			i++
		default:
			end := i + maxLen
			if end > len(body) {
				end = len(body)
			}
			return body[i:end]
		}
	}
	return nil
}

// --- Numeric helpers ---

// AsInt converts various numeric types to int.
func AsInt(v any) (int, bool) {
	switch val := v.(type) {
	case int:
		return val, true
	case int64:
		return int(val), true
	case float64:
		return int(val), true
	case float32:
		return int(val), true
	default:
		return 0, false
	}
}

// AsFloat converts various numeric types to float64.
func AsFloat(v any) (float64, bool) {
	switch val := v.(type) {
	case float64:
		return val, true
	case float32:
		return float64(val), true
	case int:
		return float64(val), true
	case int64:
		return float64(val), true
	default:
		return 0, false
	}
}

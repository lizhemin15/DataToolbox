// Package agent defines the cluster-mode core abstractions for DataToolbox.
//
// It wraps the Google Agent Development Kit (adk-go) and provides:
//   - Event types for streaming agent output to clients
//   - Configuration types for building agent trees
//   - A Factory that constructs adk Agent trees from declarative configs
//   - An Orchestrator that manages sessions, tool registration, and execution
package agent

import (
	"encoding/json"
	"fmt"
	"time"
)

// ---------------------------------------------------------------------------
// Cluster mode constants
// ---------------------------------------------------------------------------

// Mode defines the top-level agent composition pattern.
type Mode string

const (
	// ModeSingle creates a single LLMAgent with no workflow wrapper.
	ModeSingle Mode = "single"
	// ModeSequential wraps sub-agents in a SequentialAgent.
	ModeSequential Mode = "sequential"
	// ModeParallel wraps sub-agents in a ParallelAgent.
	ModeParallel Mode = "parallel"
	// ModeLoop wraps sub-agents in a LoopAgent.
	ModeLoop Mode = "loop"
)

// ---------------------------------------------------------------------------
// Streaming event types (sent to clients over WebSocket / SSE)
// ---------------------------------------------------------------------------

// EventType identifies the kind of streaming event.
type EventType string

const (
	EventTypeText        EventType = "text"
	EventTypeToolCall    EventType = "tool_call"
	EventTypeToolResult  EventType = "tool_result"
	EventTypeAgentSwitch EventType = "agent_switch"
	EventTypeError       EventType = "error"
	EventTypeDone        EventType = "done"
)

// Event is the universal envelope for every message streamed to a client.
// All JSON field names use snake_case.
type Event struct {
	Type      EventType   `json:"type"`
	Timestamp string      `json:"timestamp"`
	AgentName string      `json:"agent_name,omitempty"`
	Data      interface{} `json:"data,omitempty"`
}

// TextData carries a text chunk from an LLM response.
type TextData struct {
	Content string `json:"content"`
	Partial bool   `json:"partial"`
}

// ToolCallData carries a function-call request issued by the LLM.
type ToolCallData struct {
	ToolName string                 `json:"tool_name"`
	CallID   string                 `json:"call_id"`
	Args     map[string]interface{} `json:"args,omitempty"`
}

// ToolResultData carries the result of a tool execution.
type ToolResultData struct {
	ToolName string      `json:"tool_name"`
	CallID   string      `json:"call_id"`
	Result   interface{} `json:"result"`
	IsError  bool        `json:"is_error"`
}

// AgentSwitchData signals that control has transferred to a different agent.
type AgentSwitchData struct {
	FromAgent string `json:"from_agent"`
	ToAgent   string `json:"to_agent"`
}

// ErrorData carries an error description.
type ErrorData struct {
	Message string `json:"message"`
	Code    string `json:"code,omitempty"`
}

// DoneData signals that the invocation has completed.
type DoneData struct {
	Success bool `json:"success"`
}

// NewEvent creates an Event with the current UTC timestamp.
func NewEvent(typ EventType) Event {
	return Event{
		Type:      typ,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
}

// NewTextEvent creates a text streaming event.
func NewTextEvent(agentName, content string, partial bool) Event {
	return Event{
		Type:      EventTypeText,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentName: agentName,
		Data: TextData{
			Content: content,
			Partial: partial,
		},
	}
}

// NewToolCallEvent creates a tool-call event.
func NewToolCallEvent(agentName, toolName, callID string, args map[string]interface{}) Event {
	return Event{
		Type:      EventTypeToolCall,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentName: agentName,
		Data: ToolCallData{
			ToolName: toolName,
			CallID:   callID,
			Args:     args,
		},
	}
}

// NewToolResultEvent creates a tool-result event.
func NewToolResultEvent(agentName, toolName, callID string, result interface{}, isError bool) Event {
	return Event{
		Type:      EventTypeToolResult,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		AgentName: agentName,
		Data: ToolResultData{
			ToolName: toolName,
			CallID:   callID,
			Result:   result,
			IsError:  isError,
		},
	}
}

// NewAgentSwitchEvent creates an agent-switch event.
func NewAgentSwitchEvent(fromAgent, toAgent string) Event {
	return Event{
		Type:      EventTypeAgentSwitch,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Data: AgentSwitchData{
			FromAgent: fromAgent,
			ToAgent:   toAgent,
		},
	}
}

// NewErrorEvent creates an error event.
func NewErrorEvent(message string, code ...string) Event {
	data := ErrorData{
		Message: message,
	}
	if len(code) > 0 {
		data.Code = code[0]
	}
	return Event{
		Type:      EventTypeError,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Data:      data,
	}
}

// NewDoneEvent creates a done event.
func NewDoneEvent(success bool) Event {
	return Event{
		Type:      EventTypeDone,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Data: DoneData{
			Success: success,
		},
	}
}

// String returns the JSON representation of an Event.
func (e Event) String() string {
	b, err := json.Marshal(e)
	if err != nil {
		return fmt.Sprintf(`{"type":"error","data":{"message":"marshal error: %s"}}`, err)
	}
	return string(b)
}

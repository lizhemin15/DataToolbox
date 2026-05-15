package agent

// EventType 集群模式事件类型
type EventType string

const (
	EventTypeText        EventType = "text"
	EventTypeToolCall    EventType = "tool_call"
	EventTypeToolResult  EventType = "tool_result"
	EventTypeThinking     EventType = "thinking"
	EventTypeAgentSwitch EventType = "agent_switch"
	EventTypeError       EventType = "error"
	EventTypeDone        EventType = "done"
)

// Mode 常量
const (
	ModeFast    = "fast"
	ModeCluster = "cluster"
)

// Event 集群模式事件
type Event struct {
	Type EventType     `json:"type"`
	Data interface{}   `json:"data"`
}

// NewTextEvent 创建文本事件
func NewTextEvent(text string) Event {
	return Event{Type: EventTypeText, Data: map[string]string{"text": text}}
}

// NewErrorEvent 创建错误事件
func NewErrorEvent(msg string) Event {
	return Event{Type: EventTypeError, Data: map[string]string{"message": msg}}
}

// NewDoneEvent 创建完成事件
func NewDoneEvent() Event {
	return Event{Type: EventTypeDone, Data: map[string]string{"status": "completed"}}
}

// NewToolCallEvent 创建工具调用事件
func NewToolCallEvent(name, args string) Event {
	return Event{Type: EventTypeToolCall, Data: map[string]string{"tool": name, "args": args}}
}

// NewToolResultEvent 创建工具结果事件
func NewToolResultEvent(name, result string) Event {
	return Event{Type: EventTypeToolResult, Data: map[string]string{"tool": name, "result": result}}
}

// NewAgentSwitchEvent 创建Agent切换事件
func NewAgentSwitchEvent(from, to string) Event {
	return Event{Type: EventTypeAgentSwitch, Data: map[string]string{"from": from, "to": to}}
}

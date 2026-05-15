package seahorse

import "context"

// Engine is the seahorse context management engine (stub).
type Engine struct{}

// Config configures the seahorse engine (stub).
type Config struct {
	DBPath       string
	Provider     interface{}
	Model        string
	MaxTokens    int
}

// Message represents a seahorse message (stub).
type Message struct {
	Role  string
	Parts []MessagePart
}

// MessagePart represents a part of a message (stub).
type MessagePart struct {
	Type string
	Text string
}

// AssembleInput is input for assembly (stub).
type AssembleInput struct {
	MaxTokens int
}

// AssembleResult is the result of assembly (stub).
type AssembleResult struct {
	Content   string
	TokenCount int
}

// CompactInput is input for compaction (stub).
type CompactInput struct{}

// CompleteFn is a function that completes a prompt (stub).
type CompleteFn func(ctx context.Context, prompt string, opts CompleteOptions) (string, error)

// CompleteOptions are options for completion (stub).
type CompleteOptions struct{}

// NewEngine creates a new seahorse engine (stub).
func NewEngine(cfg Config) (*Engine, error) {
	return &Engine{}, nil
}

// NewGrepTool creates a grep tool (stub).
func NewGrepTool(retrieval interface{}) interface{} {
	return nil
}

// NewExpandTool creates an expand tool (stub).
func NewExpandTool(retrieval interface{}) interface{} {
	return nil
}

// Assemble assembles context (stub).
func (e *Engine) Assemble(ctx context.Context, sessionKey string, input AssembleInput) (*AssembleResult, error) {
	return &AssembleResult{}, nil
}

// Compact compacts context (stub).
func (e *Engine) Compact(ctx context.Context, sessionKey string, input CompactInput) (interface{}, error) {
	return nil, nil
}

// Ingest ingests messages (stub).
func (e *Engine) Ingest(ctx context.Context, sessionKey string, messages []Message) (interface{}, error) {
	return nil, nil
}

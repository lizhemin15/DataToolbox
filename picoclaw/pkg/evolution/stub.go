package evolution

// Runtime manages evolution patterns (stub).
type Runtime struct{}

// RuntimeOptions configures the evolution runtime.
type RuntimeOptions struct {
	PatternClusterer  interface{}
	GeneratorFactory  func(workspace string) DraftGenerator
	SuccessJudgeFactory func(workspace string) SuccessJudge
	ApplierFactory    func(workspace string) *Applier
	MinTaskCount      int
}

// ColdPathRunner runs evolution cold paths (stub).
type ColdPathRunner struct{}

// DraftGenerator generates evolution drafts (stub).
type DraftGenerator interface{}

// SuccessJudge judges task success (stub).
type SuccessJudge interface{}

// Applier applies evolution changes (stub).
type Applier struct{}

// Paths holds evolution file paths (stub).
type Paths struct{}

// SkillContextSnapshot captures skill context for evolution (stub).
type SkillContextSnapshot struct {
	SkillName string
	Context   string
}

// ToolExecutionRecord records a tool execution for evolution (stub).
type ToolExecutionRecord struct {
	ToolName string
	Input    string
	Output   string
	Success  bool
}

// TurnCaseInput is input for a turn case (stub).
type TurnCaseInput struct {
	UserMessage      string
	AssistantMessage string
	ToolExecutions   []ToolExecutionRecord
	SkillContexts    []SkillContextSnapshot
}

// HeuristicPatternClusterer clusters patterns heuristically (stub).
type HeuristicPatternClusterer struct{}

// LLMPatternClusterer clusters patterns using LLM (stub).
type LLMPatternClusterer struct{}

// NewRuntime creates a new evolution runtime (stub).
func NewRuntime(opts RuntimeOptions) (*Runtime, error) {
	return &Runtime{}, nil
}

// NewColdPathRunnerWithErrorHandler creates a cold path runner (stub).
func NewColdPathRunnerWithErrorHandler(runtime *Runtime, errorHandler func(error)) *ColdPathRunner {
	return &ColdPathRunner{}
}

// NewHeuristicPatternClusterer creates a heuristic pattern clusterer (stub).
func NewHeuristicPatternClusterer(minCount int, logger interface{}) *HeuristicPatternClusterer {
	return &HeuristicPatternClusterer{}
}

// NewLLMPatternClusterer creates an LLM pattern clusterer (stub).
func NewLLMPatternClusterer(provider interface{}, modelID string) *LLMPatternClusterer {
	return &LLMPatternClusterer{}
}

// NewDraftGeneratorForWorkspace creates a draft generator (stub).
func NewDraftGeneratorForWorkspace(workspace string, provider interface{}, modelID string) DraftGenerator {
	return nil
}

// NewLLMTaskSuccessJudge creates an LLM success judge (stub).
func NewLLMTaskSuccessJudge(provider interface{}, modelID string, fallback SuccessJudge) SuccessJudge {
	return nil
}

// NewApplier creates an applier (stub).
func NewApplier(paths *Paths, logger interface{}) *Applier {
	return &Applier{}
}

// NewPaths creates evolution paths (stub).
func NewPaths(workspace, stateDir string) *Paths {
	return &Paths{}
}

// Close cleans up the runtime (stub).
func (r *Runtime) Close() error { return nil }

// handleRuntimeTurnEnd handles a runtime turn end (stub).
func handleRuntimeTurnEnd(evt interface{}) bool { return false }

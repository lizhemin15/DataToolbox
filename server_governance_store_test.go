package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestGovernanceStoreSaveAndLoadRoundTrip(t *testing.T) {
	restore := withGovernanceTestState()
	defer restore()

	tmpDir := t.TempDir()
	storePath := filepath.Join(tmpDir, "data-store.json")
	getDataOntologyStorePathFn = func() string { return storePath }

	dataOntologyUsers = map[string]*User{
		"admin": {Username: "admin", Token: "token-admin"},
	}
	dataOntologyDatabases = map[string]*DatabaseConfig{}
	dataOntologyApis = map[string]*ApiConfig{}
	dataOntologyAIConfig = &AIConfig{URL: "http://ai.local", APIKey: "key", Model: "model", Timeout: 60}
	mcp := true
	dataOntologyMCPEnabled = &mcp
	llmModels = map[string]*LLMModelConfig{}
	smallModels = map[string]*SmallModelConfig{}
	governanceTasks = map[string]*GovernanceTask{
		"task-1": {
			ID:            "task-1",
			Owner:         "admin",
			Name:          "demo",
			Type:          "interactive",
			JsCode:        "gov.log('x')",
			Runtime:       "backend",
			RunMode:       "frontend",
			ExecutionMode: "frontend",
			FileBatchMode: "single",
			Status:        "idle",
			CreatedAt:     "2026-04-22T00:00:00Z",
		},
	}
	governanceTaskLogs = map[string][]*GovernanceTaskLog{
		"task-1": {{ID: "log-1", TaskID: "task-1", StartTime: "2026-04-22T00:00:00Z", Status: "running"}},
	}

	if err := saveDataOntologyStore(); err != nil {
		t.Fatalf("save store: %v", err)
	}
	if _, err := os.Stat(storePath); err != nil {
		t.Fatalf("expected store file to exist: %v", err)
	}

	content, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatalf("read store file: %v", err)
	}
	text := string(content)
	for _, want := range []string{"\"governance_tasks\"", "\"governance_task_logs\"", "\"run_mode\"", "\"execution_mode\"", "\"file_batch_mode\""} {
		if !containsString(text, want) {
			t.Fatalf("expected saved JSON to contain %s", want)
		}
	}

	governanceTasks = map[string]*GovernanceTask{}
	governanceTaskLogs = map[string][]*GovernanceTaskLog{}
	dataOntologyUsers = map[string]*User{}
	dataOntologyDatabases = map[string]*DatabaseConfig{}
	dataOntologyApis = map[string]*ApiConfig{}
	dataOntologyAIConfig = nil
	dataOntologyMCPEnabled = nil
	llmModels = map[string]*LLMModelConfig{}
	smallModels = map[string]*SmallModelConfig{}

	if err := loadDataOntologyStore(); err != nil {
		t.Fatalf("load store: %v", err)
	}
	got := governanceTasks["task-1"]
	if got == nil {
		t.Fatal("expected task to be loaded")
	}
	if got.RunMode != "frontend" || got.ExecutionMode != "frontend" || got.FileBatchMode != "single" {
		t.Fatalf("loaded task lost fields: %+v", got)
	}
	if len(governanceTaskLogs["task-1"]) != 1 {
		t.Fatalf("expected one task log after reload, got %d", len(governanceTaskLogs["task-1"]))
	}
	if dataOntologyAIConfig == nil || dataOntologyAIConfig.URL != "http://ai.local" {
		t.Fatalf("expected AI config to reload, got %+v", dataOntologyAIConfig)
	}
}

func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || filepath.Base(s) != "" && stringIndex(s, substr) >= 0)
}

func stringIndex(s, substr string) int {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

var _ = json.Marshal

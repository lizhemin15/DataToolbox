package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGovernanceTaskRunSetsRunningStateAndProgress(t *testing.T) {
	restore := withGovernanceTestState()
	defer restore()

	dataOntologyUsers = map[string]*User{
		"admin": {Username: "admin", Token: "token-admin"},
	}
	governanceTasks = map[string]*GovernanceTask{
		"task-1": {
			ID:            "task-1",
			Owner:         "admin",
			Name:          "demo",
			Type:          "interactive",
			JsCode:        "gov.log('x')",
			InputType:     "text",
			Status:        "idle",
			Runtime:       "backend",
			RunMode:       "backend",
			ExecutionMode: "backend",
			CreatedAt:     "2026-04-22T00:00:00Z",
		},
	}
	governanceTaskLogs = map[string][]*GovernanceTaskLog{}
	governanceJobQueue = make(chan *GovernanceJob, 1)

	req := httptest.NewRequest(http.MethodPost, "/api/data-ontology/governance/tasks/task-1/run", bytes.NewReader([]byte(`{"input_text":"hello"}`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer token-admin")
	w := httptest.NewRecorder()

	handleGovernanceTaskRun(w, req, "task-1")

	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool   `json:"success"`
		RunID   string `json:"run_id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if !resp.Success || resp.RunID == "" {
		t.Fatalf("unexpected run response: %s", w.Body.String())
	}

	task := governanceTasks["task-1"]
	if task == nil {
		t.Fatal("task missing after run")
	}
	if task.Status != "running" || task.RunID != resp.RunID || task.TotalFiles != 0 || task.ProcessedFiles != 0 || task.Percent != 0 {
		t.Fatalf("task state not updated correctly: %+v", task)
	}
	if len(governanceTaskLogs["task-1"]) == 0 {
		t.Fatal("expected running log entry to be created")
	}

	progressReq := httptest.NewRequest(http.MethodGet, "/api/data-ontology/governance/tasks/task-1/progress", nil)
	progressReq.Header.Set("Authorization", "Bearer token-admin")
	progressW := httptest.NewRecorder()
	handleGovernanceTaskProgress(progressW, progressReq, "task-1")
	if progressW.Code != http.StatusOK {
		t.Fatalf("unexpected progress status %d: %s", progressW.Code, progressW.Body.String())
	}
	var progress struct {
		Success        bool   `json:"success"`
		Status         string `json:"status"`
		RunID          string `json:"run_id"`
		TotalFiles     int    `json:"total_files"`
		ProcessedFiles int    `json:"processed_files"`
		Percent        int    `json:"percent"`
	}
	if err := json.Unmarshal(progressW.Body.Bytes(), &progress); err != nil {
		t.Fatalf("unmarshal progress response: %v", err)
	}
	if !progress.Success || progress.Status != "running" || progress.RunID != resp.RunID {
		t.Fatalf("unexpected progress response: %s", progressW.Body.String())
	}
}

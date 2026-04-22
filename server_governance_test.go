package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGovernanceTaskRoundTripPreservesRunModeFields(t *testing.T) {
	restore := withGovernanceTestState()
	defer restore()

	dataOntologyUsers = map[string]*User{
		"admin": {Username: "admin", Token: "token-admin"},
	}

	task := &GovernanceTask{
		ID:            "task-1",
		Owner:         "admin",
		Name:          "demo",
		Type:          "interactive",
		JsCode:        "gov.log('x')",
		DatabaseID:    "db-1",
		InputType:     "file",
		AcceptExts:    []string{".csv"},
		FileBatchMode: "single",
		Runtime:       "backend",
		RunMode:       "frontend",
		ExecutionMode: "frontend",
		Status:        "idle",
		CreatedAt:     "2026-04-22T00:00:00Z",
	}
	governanceTasks[task.ID] = task

	body := map[string]any{
		"name":            "demo-updated",
		"type":            "interactive",
		"js_code":         "gov.log('y')",
		"database_id":     "db-1",
		"input_type":      "text",
		"accept_exts":     []string{".txt"},
		"file_batch_mode": "per_file",
		"register_as_api": true,
		"api_path":        "/api/tasks/demo",
		"api_method":      "POST",
		"runtime":         "frontend",
		"run_mode":        "frontend",
		"execution_mode":  "frontend",
	}
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPut, "/api/data-ontology/governance/tasks/task-1", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer token-admin")
	w := httptest.NewRecorder()

	handleGovernanceTaskDetail(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool           `json:"success"`
		Task    GovernanceTask `json:"task"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if !resp.Success {
		t.Fatalf("expected success, got %s", w.Body.String())
	}
	if resp.Task.RunMode != "frontend" || resp.Task.ExecutionMode != "frontend" {
		t.Fatalf("run mode not preserved: %+v", resp.Task)
	}
	if got := governanceTasks["task-1"]; got == nil || got.RunMode != "frontend" || got.ExecutionMode != "frontend" {
		t.Fatalf("stored task not updated: %+v", got)
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/data-ontology/governance/tasks/task-1", nil)
	getReq.Header.Set("Authorization", "Bearer token-admin")
	getW := httptest.NewRecorder()
	handleGovernanceTaskDetail(getW, getReq)
	if getW.Code != http.StatusOK {
		t.Fatalf("unexpected get status %d: %s", getW.Code, getW.Body.String())
	}
	var getResp struct {
		Success bool           `json:"success"`
		Task    GovernanceTask `json:"task"`
	}
	if err := json.Unmarshal(getW.Body.Bytes(), &getResp); err != nil {
		t.Fatalf("unmarshal get response: %v", err)
	}
	if !getResp.Success || getResp.Task.Name != "demo-updated" {
		t.Fatalf("round trip readback failed: %s", getW.Body.String())
	}
	if getResp.Task.RunMode != "frontend" || getResp.Task.ExecutionMode != "frontend" {
		t.Fatalf("round trip lost run mode fields: %+v", getResp.Task)
	}
}

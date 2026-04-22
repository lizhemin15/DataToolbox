package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGovernanceTaskDeleteRemovesTaskAndLogs(t *testing.T) {
	restore := withGovernanceTestState()
	defer restore()

	dataOntologyUsers = map[string]*User{
		"admin": {Username: "admin", Token: "token-admin"},
	}
	governanceTasks = map[string]*GovernanceTask{
		"task-del": {
			ID:     "task-del",
			Owner:  "admin",
			Name:   "to-delete",
			Type:   "interactive",
			JsCode: "gov.log('x')",
			Status: "idle",
		},
	}
	governanceTaskLogs = map[string][]*GovernanceTaskLog{
		"task-del": {{ID: "log-1", TaskID: "task-del", Status: "success"}},
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/data-ontology/governance/tasks/task-del", bytes.NewReader(nil))
	req.Header.Set("Authorization", "Bearer token-admin")
	w := httptest.NewRecorder()

	handleGovernanceTaskDetail(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if !resp.Success {
		t.Fatalf("expected delete success, got %s", w.Body.String())
	}
	if _, ok := governanceTasks["task-del"]; ok {
		t.Fatal("task was not deleted from memory")
	}
	if _, ok := governanceTaskLogs["task-del"]; ok {
		t.Fatal("task logs were not deleted from memory")
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/data-ontology/governance/tasks/task-del", nil)
	getReq.Header.Set("Authorization", "Bearer token-admin")
	getW := httptest.NewRecorder()
	handleGovernanceTaskDetail(getW, getReq)
	if getW.Code != http.StatusOK {
		t.Fatalf("unexpected get status %d: %s", getW.Code, getW.Body.String())
	}
	var getResp struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(getW.Body.Bytes(), &getResp); err != nil {
		t.Fatalf("unmarshal get response: %v", err)
	}
	if getResp.Success {
		t.Fatalf("expected deleted task to be inaccessible, got %s", getW.Body.String())
	}
}

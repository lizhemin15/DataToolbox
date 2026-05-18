
package common

import (
	"encoding/json"
	"testing"
)

func TestFixTruncatedJSON(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantOK  bool  // should the fixed JSON be valid?
	}{
		{
			name:   "valid JSON passthrough",
			input:  `{"interaction_type": "form", "title": "test"}`,
			wantOK: true,
		},
		{
			name:   "truncated in string value - the real bug",
			input:  `{"interaction_type": "form", "title": "创建接口配置", "description": "请填写接口创建所需的信息", "fields": [{"id": "name", "label": "接口名称", "type": "text", "placeholder": "请输入接口名称，如'员工查询'"}, {"id": "path", "label": "接口路径", "type": "text", "placeholder": "请输入接口路径，如/api/employee/query"}, {"id": "method", "label": "HTTP方法", "type": "select", "options": [{"id": "GET", "label": "GET"}, {"id": "POST", "label": "POST"}]}, {"id": "sql`,
			wantOK: true,
		},
		{
			name:   "truncated mid-object",
			input:  `{"key": "value", "nested": {"a": 1, "b":`,
			wantOK: true,
		},
		{
			name:   "truncated mid-array",
			input:  `{"items": [1, 2, 3`,
			wantOK: true,
		},
		{
			name:   "empty string",
			input:  ``,
			wantOK: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fixed := FixTruncatedJSON(tt.input)
			if tt.input == "" {
				if fixed != "" {
					t.Errorf("empty input should return empty, got %q", fixed)
				}
				return
			}
			if !json.Valid([]byte(fixed)) {
				t.Errorf("FixTruncatedJSON(%q) = %q, not valid JSON", tt.input[:min(len(tt.input), 50)], fixed[:min(len(fixed), 50)])
				return
			}
			// Verify we can unmarshal it
			var result map[string]any
			if err := json.Unmarshal([]byte(fixed), &result); err != nil {
				t.Errorf("Fixed JSON unmarshal failed: %v", err)
			}
		})
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

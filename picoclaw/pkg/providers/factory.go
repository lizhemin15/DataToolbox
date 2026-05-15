package providers

import "fmt"

// getCredential stub — auth package removed for DataToolbox
func getCredential(key string) (interface{}, error) {
	return nil, fmt.Errorf("auth not available in DataToolbox mode")
}

// createClaudeAuthProvider stub
func createClaudeAuthProvider() (LLMProvider, error) {
	return nil, fmt.Errorf("claude auth not available in DataToolbox mode")
}

// createCodexAuthProvider stub
func createCodexAuthProvider() (LLMProvider, error) {
	return nil, fmt.Errorf("codex auth not available in DataToolbox mode")
}

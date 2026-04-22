package main

func withGovernanceTestState() func() {
	oldTasks := governanceTasks
	oldLogs := governanceTaskLogs
	oldUsers := dataOntologyUsers
	oldDatabases := dataOntologyDatabases
	oldApis := dataOntologyApis
	oldAIConfig := dataOntologyAIConfig
	oldMCP := dataOntologyMCPEnabled
	oldLLM := llmModels
	oldSmall := smallModels
	oldPathFn := getDataOntologyStorePathFn

	governanceTasks = map[string]*GovernanceTask{}
	governanceTaskLogs = map[string][]*GovernanceTaskLog{}
	dataOntologyUsers = map[string]*User{}
	dataOntologyDatabases = map[string]*DatabaseConfig{}
	dataOntologyApis = map[string]*ApiConfig{}
	dataOntologyAIConfig = nil
	dataOntologyMCPEnabled = nil
	llmModels = map[string]*LLMModelConfig{}
	smallModels = map[string]*SmallModelConfig{}
	getDataOntologyStorePathFn = getDataOntologyStorePath

	return func() {
		governanceTasks = oldTasks
		governanceTaskLogs = oldLogs
		dataOntologyUsers = oldUsers
		dataOntologyDatabases = oldDatabases
		dataOntologyApis = oldApis
		dataOntologyAIConfig = oldAIConfig
		dataOntologyMCPEnabled = oldMCP
		llmModels = oldLLM
		smallModels = oldSmall
		getDataOntologyStorePathFn = oldPathFn
	}
}

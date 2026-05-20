package main

import (
	"encoding/json"
	"net/http"
)

// registerAPIV1Routes 注册 v1 版本 API 路由
func registerAPIV1Routes(mux *http.ServeMux) {
	// ==================== 系统 API ====================
	// 认证
	mux.HandleFunc("/api/v1/system/auth/login", handleDataOntologyLogin)
	mux.HandleFunc("/api/v1/system/auth/logout", handleLogout)
	
	// 用户管理
	mux.HandleFunc("/api/v1/system/users", handleDataOntologyUsers)
	mux.HandleFunc("/api/v1/system/users/batch", handleDataOntologyUsersBatch)
	mux.HandleFunc("/api/v1/system/users/", handleDataOntologyUsersDetail)
	
	// API Key
	mux.HandleFunc("/api/v1/system/apikeys", handleApiKey)
	
	// 设置
	mux.HandleFunc("/api/v1/system/settings", handleUserSettings)
	
	// 备份恢复
	mux.HandleFunc("/api/v1/system/backup", handleDataOntologyBackup)
	mux.HandleFunc("/api/v1/system/restore", handleDataOntologyRestore)
	mux.HandleFunc("/api/v1/system/restore-upload", handleDataOntologyRestoreUpload)
	
	// 版本号
	mux.HandleFunc("/api/v1/system/version", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"version": Version})
	})
	
	// ==================== 数据库 API ====================
	mux.HandleFunc("/api/v1/databases", handleDatabases)
	mux.HandleFunc("/api/v1/databases/", handleDatabaseDetailV1)
	mux.HandleFunc("/api/v1/databases/test-connection", handleTestConnection)
	
	// ==================== 开放接口 API ====================
	mux.HandleFunc("/api/v1/openapis", handleApis)
	mux.HandleFunc("/api/v1/openapis/", handleOpenAPIDetail)
	
	// ==================== MCP API ====================
	mux.HandleFunc("/api/v1/mcp/tools", handleMCPTools)
	mux.HandleFunc("/api/v1/mcp/tools/", handleMCPToolDetail)
	mux.HandleFunc("/api/v1/mcp/config", handleMCPConfig)
	mux.HandleFunc("/api/v1/mcp/safe-config", handleMCPSafeConfig)
	mux.HandleFunc("/api/v1/mcp/port", handleMCPPort)
	
	// ==================== 数据治理 API ====================
	mux.HandleFunc("/api/v1/gov/tasks", handleGovernanceTasks)
	mux.HandleFunc("/api/v1/gov/tasks/", handleGovernanceTaskDetailV1)
	mux.HandleFunc("/api/v1/gov/presets", handleGovernancePresets)
	mux.HandleFunc("/api/v1/gov/examples/", handleGovernanceExampleDownload)
	mux.HandleFunc("/api/v1/gov/download-output", handleGovernanceDownloadOutput)
	mux.HandleFunc("/api/v1/gov/download-api-output", handleGovernanceDownloadAPIOutput)
	mux.HandleFunc("/api/v1/gov/execute-sql", handleGovernanceExecuteSQL)
	mux.HandleFunc("/api/v1/gov/parse-text", handleGovParseText)
	mux.HandleFunc("/api/v1/gov/task-api/", handleGovernanceTaskAPI)
	
	// ==================== 分享 API ====================
	mux.HandleFunc("/api/v1/share/", handleGovernanceShareV1)
	
	// ==================== AI Agent API ====================
	mux.HandleFunc("/api/v1/agent/query", handleAgentClusterQuery)
	mux.HandleFunc("/api/v1/agent/cluster/query", handleAgentClusterQuery)
	mux.HandleFunc("/api/v1/agent/mcp", handleAgentMCP)
	mux.HandleFunc("/api/v1/agent/skill", handleAgentSkill)
	mux.HandleFunc("/api/v1/agent/mode", handleAgentMode)
	mux.HandleFunc("/api/v1/agent/status", handleAgentStatus)
	
	// AI 配置
	mux.HandleFunc("/api/v1/agent/config", handleAIConfig)
	mux.HandleFunc("/api/v1/agent/embedding-config", handleAIEmbeddingConfig)
	mux.HandleFunc("/api/v1/agent/table-retrieval-config", handleTableRetrievalConfig)
	mux.HandleFunc("/api/v1/agent/capabilities", handleAICapabilities)
	mux.HandleFunc("/api/v1/agent/ai-query", handleAIQuery)
	mux.HandleFunc("/api/v1/agent/confirm-execute", handleAIConfirmExecute)
	mux.HandleFunc("/api/v1/agent/codegen", handleAICodegen)
	mux.HandleFunc("/api/v1/agent/completion", handleAICompletion)
	
	// HITL
	mux.HandleFunc("/api/v1/agent/hitl/respond", handleHITLRespond)
	mux.HandleFunc("/api/v1/agent/hitl/pending", handleHITLPending)
	
	// ==================== 表检索 API ====================
	mux.HandleFunc("/api/v1/retrieval/sync", handleTableRetrievalSync)
	mux.HandleFunc("/api/v1/retrieval/status", handleTableRetrievalStatus)
	mux.HandleFunc("/api/v1/retrieval/embedding-status", handleTableRetrievalEmbeddingStatus)
	mux.HandleFunc("/api/v1/retrieval/relation-status", handleTableRetrievalRelationStatus)
	mux.HandleFunc("/api/v1/retrieval/embedding-sync", handleTableRetrievalEmbeddingSync)
	mux.HandleFunc("/api/v1/retrieval/relation-scan", handleTableRetrievalRelationScan)
	mux.HandleFunc("/api/v1/retrieval/relation-confirm", handleTableRetrievalRelationConfirm)
	mux.HandleFunc("/api/v1/retrieval/embedding-preview", handleTableRetrievalEmbeddingPreview)
	mux.HandleFunc("/api/v1/retrieval/relation-preview", handleTableRetrievalRelationPreview)
	mux.HandleFunc("/api/v1/retrieval/search", handleTableRetrievalSearch)
	mux.HandleFunc("/api/v1/retrieval/vectors", handleTableRetrievalVectorList)
	mux.HandleFunc("/api/v1/retrieval/relations", handleTableRetrievalRelationList)
	mux.HandleFunc("/api/v1/retrieval/config", handleTableRetrievalConfig)
	
	// ==================== 模型管理 API ====================
	mux.HandleFunc("/api/v1/models/llm", handleLLMModels)
	mux.HandleFunc("/api/v1/models/llm/", handleLLMModelDetail)
	mux.HandleFunc("/api/v1/models/small", handleSmallModels)
	mux.HandleFunc("/api/v1/models/small/", handleSmallModelDetail)
	
	// ==================== 本体 API ====================
	mux.HandleFunc("/api/v1/ontology/extract", handleOntologyExtract)
	mux.HandleFunc("/api/v1/ontology/query", handleOntologySemanticQuery)
	
	// ==================== Skills API ====================
	mux.HandleFunc("/api/v1/skills/export", handleSkillsExport)
	
	// ==================== 质量审计 API ====================
	mux.HandleFunc("/api/v1/quality-audit/", handleQualityAuditAPI)
}

package agent

import (
	"context"
	"log"

	"google.golang.org/adk/agent"
	"google.golang.org/adk/agent/llmagent"
	"google.golang.org/adk/agent/workflowagents/loopagent"
	"google.golang.org/adk/agent/workflowagents/parallelagent"
	"google.golang.org/adk/agent/workflowagents/sequentialagent"
	"google.golang.org/adk/model"
	"google.golang.org/adk/tool"
)

// BuildDataToolboxAgentTree 构建 DataToolbox 多智能体 Agent 树
// Root(LLM Transfer) → 5个领域Agent → 各自的Workflow编排
func BuildDataToolboxAgentTree(ctx context.Context, m model.LLM, toolsets []tool.Toolset) (agent.Agent, error) {
	// ========== 1. Data Query Agent (Sequential: SQL生成→审查) ==========
	sqlGenerator, err := llmagent.New(llmagent.Config{
		Name:        "sql_generator",
		Model:       m,
		Description: "Generates SQL queries based on user requirements.",
		Instruction: "你是SQL生成专家。根据用户需求生成SQL查询语句。\n注意：只读取当前登录账号对应的模式（schema）下的表。\n输出SQL代码块。",
		OutputKey:   "sql_draft",
		Toolsets:    toolsets,
	})
	if err != nil {
		return nil, err
	}

	sqlReviewer, err := llmagent.New(llmagent.Config{
		Name:        "sql_reviewer",
		Model:       m,
		Description: "Reviews and optimizes SQL queries.",
		Instruction: "你是SQL审查专家。审查以下SQL的安全性和性能：\n```sql\n{sql_draft}\n```\n如有问题请给出修改建议，否则回复\"SQL审查通过\"。",
		OutputKey:   "temp:sql_review",
		Toolsets:    toolsets,
	})
	if err != nil {
		return nil, err
	}

	sqlPipeline, err := sequentialagent.New(sequentialagent.Config{
		AgentConfig: agent.Config{
			Name:      "sql_pipeline",
			SubAgents: []agent.Agent{sqlGenerator, sqlReviewer},
		},
	})
	if err != nil {
		return nil, err
	}

	dataQueryAgent, err := llmagent.New(llmagent.Config{
		Name:        "data_query_agent",
		Model:       m,
		Description: "处理数据查询和SQL生成。适用于：查数据、写SQL、数据检索。",
		Instruction: "你是数据查询专家。根据用户需求，委派给SQL流水线处理。",
		SubAgents:   []agent.Agent{sqlPipeline},
	})
	if err != nil {
		return nil, err
	}

	// ========== 2. Data Analysis Agent (Sequential: 统计→洞察) ==========
	statAnalyzer, err := llmagent.New(llmagent.Config{
		Name:        "stat_analyzer",
		Model:       m,
		Description: "Performs statistical analysis on data.",
		Instruction: "你是数据分析专家。对数据进行统计分析，计算关键指标，识别趋势和模式。",
		OutputKey:   "stats_result",
		Toolsets:    toolsets,
	})
	if err != nil {
		return nil, err
	}

	insightSummarizer, err := llmagent.New(llmagent.Config{
		Name:        "insight_summarizer",
		Model:       m,
		Description: "Summarizes analysis insights.",
		Instruction: "总结以下分析结果的关键洞察：\n{stats_result}",
		OutputKey:   "insight_summary",
		Toolsets:    toolsets,
	})
	if err != nil {
		return nil, err
	}

	analysisPipeline, err := sequentialagent.New(sequentialagent.Config{
		AgentConfig: agent.Config{
			Name:      "analysis_pipeline",
			SubAgents: []agent.Agent{statAnalyzer, insightSummarizer},
		},
	})
	if err != nil {
		return nil, err
	}

	dataAnalysisAgent, err := llmagent.New(llmagent.Config{
		Name:        "data_analysis_agent",
		Model:       m,
		Description: "处理数据分析和洞察提取。适用于：统计分析、趋势识别、数据可视化建议。",
		Instruction: "你是数据分析专家。委派给分析流水线处理。",
		SubAgents:   []agent.Agent{analysisPipeline},
	})
	if err != nil {
		return nil, err
	}

	// ========== 3. Data Quality Agent (Parallel: Schema+Anomaly+Completeness) ==========
	schemaValidator, err := llmagent.New(llmagent.Config{
		Name:        "schema_validator",
		Model:       m,
		Description: "Validates data schema compliance.",
		Instruction: "检查数据是否符合预期的Schema规范。报告违规项。",
		OutputKey:   "schema_check",
		Toolsets:    toolsets,
	})
	if err != nil {
		return nil, err
	}

	anomalyDetector, err := llmagent.New(llmagent.Config{
		Name:        "anomaly_detector",
		Model:       m,
		Description: "Detects data anomalies and outliers.",
		Instruction: "检测数据中的异常值和离群点。报告发现。",
		OutputKey:   "anomaly_check",
		Toolsets:    toolsets,
	})
	if err != nil {
		return nil, err
	}

	completenessChecker, err := llmagent.New(llmagent.Config{
		Name:        "completeness_checker",
		Model:       m,
		Description: "Checks data completeness and missing values.",
		Instruction: "检查数据完整性和缺失值。报告缺口。",
		OutputKey:   "completeness_check",
		Toolsets:    toolsets,
	})
	if err != nil {
		return nil, err
	}

	qualityParallel, err := parallelagent.New(parallelagent.Config{
		AgentConfig: agent.Config{
			Name:      "quality_parallel",
			SubAgents: []agent.Agent{schemaValidator, anomalyDetector, completenessChecker},
		},
	})
	if err != nil {
		return nil, err
	}

	dataQualityAgent, err := llmagent.New(llmagent.Config{
		Name:        "data_quality_agent",
		Model:       m,
		Description: "执行数据质量检查。适用于：质量审计、异常检测、完整性验证。",
		Instruction: "你是数据质量专家。并行执行Schema、异常和完整性检查。",
		SubAgents:   []agent.Agent{qualityParallel},
	})
	if err != nil {
		return nil, err
	}

	// ========== 4. Data Pipeline Agent (Loop: Ingest→Transform→Validate) ==========
	dataIngest, err := llmagent.New(llmagent.Config{
		Name:        "data_ingest",
		Model:       m,
		Description: "Ingests data from specified sources.",
		Instruction: "从指定数据源采集数据。报告采集状态。",
		OutputKey:   "ingestion_status",
		Toolsets:    toolsets,
	})
	if err != nil {
		return nil, err
	}

	dataTransform, err := llmagent.New(llmagent.Config{
		Name:        "data_transform",
		Model:       m,
		Description: "Transforms and cleans data.",
		Instruction: "根据需求对采集的数据进行转换和清洗。\n采集状态：{ingestion_status?}",
		OutputKey:   "transform_result",
		Toolsets:    toolsets,
	})
	if err != nil {
		return nil, err
	}

	dataValidate, err := llmagent.New(llmagent.Config{
		Name:        "data_validate",
		Model:       m,
		Description: "Validates data quality after transformation.",
		Instruction: "验证转换后的数据质量。\n转换结果：{transform_result?}\n\n如果验证通过，回复 VALIDATION_PASSED。否则列出问题。",
		OutputKey:   "validation_result",
		Toolsets:    toolsets,
	})
	if err != nil {
		return nil, err
	}

	etlLoop, err := loopagent.New(loopagent.Config{
		MaxIterations: 3,
		AgentConfig: agent.Config{
			Name:      "etl_loop",
			SubAgents: []agent.Agent{dataIngest, dataTransform, dataValidate},
		},
	})
	if err != nil {
		return nil, err
	}

	dataPipelineAgent, err := llmagent.New(llmagent.Config{
		Name:        "data_pipeline_agent",
		Model:       m,
		Description: "处理ETL数据管道。适用于：数据采集、清洗转换、迭代验证。",
		Instruction: "你是数据管道专家。委派给ETL循环处理采集-转换-验证。",
		SubAgents:   []agent.Agent{etlLoop},
	})
	if err != nil {
		return nil, err
	}

	// ========== 5. Data Doc Agent (Sequential: SchemaDoc→Dictionary) ==========
	schemaDocWriter, err := llmagent.New(llmagent.Config{
		Name:        "schema_doc_writer",
		Model:       m,
		Description: "Generates schema documentation.",
		Instruction: "生成数据Schema的完整文档。",
		OutputKey:   "schema_doc",
		Toolsets:    toolsets,
	})
	if err != nil {
		return nil, err
	}

	dictUpdater, err := llmagent.New(llmagent.Config{
		Name:        "dictionary_updater",
		Model:       m,
		Description: "Updates the data dictionary.",
		Instruction: "根据以下Schema文档更新数据字典：\n{schema_doc}",
		OutputKey:   "dictionary_update",
		Toolsets:    toolsets,
	})
	if err != nil {
		return nil, err
	}

	docPipeline, err := sequentialagent.New(sequentialagent.Config{
		AgentConfig: agent.Config{
			Name:      "doc_pipeline",
			SubAgents: []agent.Agent{schemaDocWriter, dictUpdater},
		},
	})
	if err != nil {
		return nil, err
	}

	dataDocAgent, err := llmagent.New(llmagent.Config{
		Name:        "data_doc_agent",
		Model:       m,
		Description: "处理数据文档和数据字典。适用于：文档生成、字典更新、元数据管理。",
		Instruction: "你是数据文档专家。委派给文档流水线处理。",
		SubAgents:   []agent.Agent{docPipeline},
	})
	if err != nil {
		return nil, err
	}

	// ========== Root Agent (LLM Transfer 动态路由) ==========
	rootAgent, err := llmagent.New(llmagent.Config{
		Name:  "datatoolbox",
		Model: m,
		Description: "DataToolbox智能助手，处理数据查询、分析、管道、质量、文档等任务。",
		Instruction: `你是 DataToolbox 的智能路由助手。根据用户请求，委派给最合适的子Agent：

- data_query_agent: 数据查询、SQL生成、数据检索
- data_analysis_agent: 统计分析、趋势识别、数据洞察
- data_pipeline_agent: ETL管道、数据采集、清洗转换
- data_quality_agent: 质量审计、异常检测、完整性验证
- data_doc_agent: 文档生成、数据字典、元数据管理

如果请求简单，直接回答。否则，转交给最合适的Agent处理。
请用中文回答。`,
		SubAgents: []agent.Agent{
			dataQueryAgent,
			dataAnalysisAgent,
			dataPipelineAgent,
			dataQualityAgent,
			dataDocAgent,
		},
		Toolsets: toolsets,
	})
	if err != nil {
		return nil, err
	}

	log.Printf("[presets] built DataToolbox agent tree: %s (5 sub-agents)", rootAgent.Name())
	return rootAgent, nil
}

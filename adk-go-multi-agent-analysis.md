# ADK-Go v1.2.0 多智能体编排完整 API 分析

> 源码路径: `/tmp/adk-go/` (module: `google.golang.org/adk`, Go 1.25)

---

## 一、核心接口与类型体系

### 1.1 Agent 接口 (`agent.Agent`)

```go
// agent/agent.go
type Agent interface {
    Name() string
    Description() string
    Run(InvocationContext) iter.Seq2[*session.Event, error]
    SubAgents() []Agent
    FindAgent(name string) Agent
    FindSubAgent(name string) Agent
    internal() *agent
}
```

所有 Agent 类型（LLMAgent、SequentialAgent、ParallelAgent、LoopAgent、CustomAgent）均实现此接口。

### 1.2 Agent 树与父子关系

- `SubAgents []Agent` 构成树形结构
- Runner 初始化时通过 `parentmap.New(rootAgent)` 构建全局 parent map
- 子 agent 可通过 Transfer 机制向父/兄弟 agent 转交控制权

### 1.3 InvocationContext (`agent.InvocationContext`)

```go
type InvocationContext interface {
    context.Context
    Agent() Agent
    Artifacts() Artifacts
    Memory() Memory
    Session() session.Session
    InvocationID() string
    Branch() string           // 并行 agent 隔离用
    UserContent() *genai.Content
    RunConfig() *RunConfig
    EndInvocation()
    Ended() bool
    WithContext(ctx context.Context) InvocationContext
}
```

### 1.4 EventActions（关键控制字段）

```go
// session/session.go
type EventActions struct {
    StateDelta                 map[string]any
    ArtifactDelta              map[string]int64
    SkipSummarization          bool
    TransferToAgent            string   // Agent Transfer 目标
    Escalate                   bool     // LoopAgent 终止信号
    RequestedToolConfirmations map[string]toolconfirmation.ToolConfirmation
}
```

---

## 二、SequentialAgent — 顺序编排

### 2.1 API

```go
// agent/workflowagents/sequentialagent/agent.go
type Config struct {
    AgentConfig agent.Config  // 内嵌基础配置
}

func New(cfg Config) (agent.Agent, error)
```

### 2.2 行为

- **严格按 SubAgents 列表顺序执行**，每个 sub-agent 的所有 event yield 完毕后才启动下一个
- 不允许自定义 Run（`Config.AgentConfig.Run != nil` 会报错）
- SubAgents 之间通过 **session state** 传递数据（`OutputKey` + `{key}` 模板注入）

### 2.3 完整示例：代码生成→审查→重构流水线

```go
package main

import (
    "context"
    "log"
    "os"

    "google.golang.org/genai"
    "google.golang.org/adk/agent"
    "google.golang.org/adk/agent/llmagent"
    "google.golang.org/adk/agent/workflowagents/sequentialagent"
    "google.golang.org/adk/cmd/launcher"
    "google.golang.org/adk/cmd/launcher/full"
    "google.golang.org/adk/model/gemini"
)

func main() {
    ctx := context.Background()

    model, err := gemini.NewModel(ctx, "gemini-2.5-flash", &genai.ClientConfig{})
    if err != nil {
        log.Fatalf("failed to create model: %s", err)
    }

    // Step 1: 代码生成 Agent
    codeWriter, err := llmagent.New(llmagent.Config{
        Name:  "CodeWriter",
        Model: model,
        Instruction: `You are a Python Code Generator.
Based on the user's request, write Python code.
Output ONLY the complete Python code block, enclosed in triple backticks.`,
        Description: "Writes initial Python code based on a specification.",
        OutputKey:   "generated_code", // 输出存入 state["generated_code"]
    })
    if err != nil {
        log.Fatal(err)
    }

    // Step 2: 代码审查 Agent — 通过 {generated_code} 模板读取上一步输出
    codeReviewer, err := llmagent.New(llmagent.Config{
        Name:  "CodeReviewer",
        Model: model,
        Instruction: `You are an expert Python Code Reviewer.
Review the following code:

'''python
{generated_code}
'''

Provide constructive feedback as a concise, bulleted list.
If the code is excellent, state: "No major issues found."`,
        Description: "Reviews code and provides feedback.",
        OutputKey:   "temp:review_comments", // temp: 前缀表示仅当前 invocation 有效
    })
    if err != nil {
        log.Fatal(err)
    }

    // Step 3: 代码重构 Agent — 读取前两步的输出
    codeRefactorer, err := llmagent.New(llmagent.Config{
        Name:  "CodeRefactorer",
        Model: model,
        Instruction: `You are a Python Code Refactoring AI.
Improve the code based on review comments.

**Original Code:**
'''python
{generated_code}
'''

**Review Comments:**
{temp:review_comments}

Output ONLY the final, refactored Python code block.`,
        Description: "Refactors code based on review comments.",
        OutputKey:   "refactored_code",
    })
    if err != nil {
        log.Fatal(err)
    }

    // 顺序编排
    pipeline, err := sequentialagent.New(sequentialagent.Config{
        AgentConfig: agent.Config{
            Name:        "CodePipeline",
            Description: "Executes a code writing, reviewing, and refactoring pipeline.",
            SubAgents:   []agent.Agent{codeWriter, codeReviewer, codeRefactorer},
        },
    })
    if err != nil {
        log.Fatal(err)
    }

    config := &launcher.Config{
        AgentLoader: agent.NewSingleLoader(pipeline),
    }
    l := full.NewLauncher()
    if err = l.Execute(ctx, config, os.Args[1:]); err != nil {
        log.Fatalf("Run failed: %v", err)
    }
}
```

### 2.4 关键设计要点

| 特性 | 说明 |
|------|------|
| 数据传递 | `OutputKey` 写入 state → `{key}` 模板注入 Instruction |
| State 作用域 | `temp:` 前缀 = 仅当前 invocation；无前缀 = 持久化；`app:` 前缀 = 全应用共享 |
| 执行模型 | 严格顺序，前一个完成后才执行下一个 |
| 错误处理 | 任一 sub-agent 出错，迭代器终止 |

---

## 三、ParallelAgent — 并行编排

### 3.1 API

```go
// agent/workflowagents/parallelagent/agent.go
type Config struct {
    AgentConfig agent.Config
}

func New(cfg Config) (agent.Agent, error)
```

### 3.2 行为

- 使用 `errgroup` 并发启动所有 SubAgents
- 每个 sub-agent 运行在**独立 Branch** 中（格式: `{parent}.{subagent}`）
- Event 通过 channel 汇聚，按到达顺序 yield
- 每个 sub-agent 的 event 处理完成后才继续（ackChan 机制保证顺序写入 session）

### 3.3 完整示例：多视角并行分析

```go
package main

import (
    "context"
    "fmt"
    "iter"
    "log"
    "os"

    "google.golang.org/genai"
    "google.golang.org/adk/agent"
    "google.golang.org/adk/agent/llmagent"
    "google.golang.org/adk/agent/workflowagents/parallelagent"
    "google.golang.org/adk/cmd/launcher"
    "google.golang.org/adk/cmd/launcher/full"
    "google.golang.org/adk/model"
    "google.golang.org/adk/model/gemini"
    "google.golang.org/adk/session"
)

func main() {
    ctx := context.Background()

    model, err := gemini.NewModel(ctx, "gemini-2.5-flash", &genai.ClientConfig{})
    if err != nil {
        log.Fatal(err)
    }

    // 视角1: 安全分析
    securityAnalyst, err := llmagent.New(llmagent.Config{
        Name:        "SecurityAnalyst",
        Model:       model,
        Description: "Analyzes code from a security perspective.",
        Instruction: "You are a security analyst. Review the given code for security vulnerabilities, injection risks, and authentication issues. Be concise.",
        OutputKey:   "security_review",
    })
    if err != nil {
        log.Fatal(err)
    }

    // 视角2: 性能分析
    performanceAnalyst, err := llmagent.New(llmagent.Config{
        Name:        "PerformanceAnalyst",
        Model:       model,
        Description: "Analyzes code from a performance perspective.",
        Instruction: "You are a performance analyst. Review the given code for performance bottlenecks, memory leaks, and optimization opportunities. Be concise.",
        OutputKey:   "performance_review",
    })
    if err != nil {
        log.Fatal(err)
    }

    // 视角3: 可维护性分析
    maintainabilityAnalyst, err := llmagent.New(llmagent.Config{
        Name:        "MaintainabilityAnalyst",
        Model:       model,
        Description: "Analyzes code from a maintainability perspective.",
        Instruction: "You are a code quality analyst. Review the given code for readability, testability, and adherence to best practices. Be concise.",
        OutputKey:   "maintainability_review",
    })
    if err != nil {
        log.Fatal(err)
    }

    // 并行编排
    parallelReview, err := parallelagent.New(parallelagent.Config{
        AgentConfig: agent.Config{
            Name:        "ParallelCodeReview",
            Description: "Runs multiple code review perspectives in parallel.",
            SubAgents:   []agent.Agent{securityAnalyst, performanceAnalyst, maintainabilityAnalyst},
        },
    })
    if err != nil {
        log.Fatal(err)
    }

    config := &launcher.Config{
        AgentLoader: agent.NewSingleLoader(parallelReview),
    }
    l := full.NewLauncher()
    if err = l.Execute(ctx, config, os.Args[1:]); err != nil {
        log.Fatalf("Run failed: %v", err)
    }
}
```

### 3.4 关键设计要点

| 特性 | 说明 |
|------|------|
| 并发模型 | `errgroup.Group` + channel |
| Branch 隔离 | 每个 sub-agent 独立 branch，互不可见对话历史 |
| Event 顺序 | 按到达顺序 yield，不保证 sub-agent 间的顺序 |
| 适用场景 | 多视角分析、多算法竞赛、多候选生成 |

---

## 四、LoopAgent — 循环编排

### 4.1 API

```go
// agent/workflowagents/loopagent/agent.go
type Config struct {
    AgentConfig agent.Config
    MaxIterations uint  // 0 = 无限循环，直到 Escalate
}

func New(cfg Config) (agent.Agent, error)
```

### 4.2 行为

- 每轮循环按顺序执行所有 SubAgents
- 终止条件（二选一）：
  1. **MaxIterations** 达到上限
  2. 任一 sub-agent 产生 `event.Actions.Escalate == true`
- `MaxIterations == 0` 时必须依赖 Escalate 退出，否则无限循环

### 4.3 完整示例：迭代代码优化

```go
package main

import (
    "context"
    "log"
    "os"

    "google.golang.org/genai"
    "google.golang.org/adk/agent"
    "google.golang.org/adk/agent/llmagent"
    "google.golang.org/adk/agent/workflowagents/loopagent"
    "google.golang.org/adk/cmd/launcher"
    "google.golang.org/adk/cmd/launcher/full"
    "google.golang.org/adk/model/gemini"
)

func main() {
    ctx := context.Background()

    model, err := gemini.NewModel(ctx, "gemini-2.5-flash", &genai.ClientConfig{})
    if err != nil {
        log.Fatal(err)
    }

    // 循环体 Agent: 代码优化器
    optimizer, err := llmagent.New(llmagent.Config{
        Name:  "CodeOptimizer",
        Model: model,
        Instruction: `You are a code optimization AI.
Given the current code (or user request if no code exists yet), improve it.
Focus on one improvement per iteration.

Current code state:
{current_code?}

If the code is already optimal and no further improvements are needed,
respond with the final code and include "OPTIMIZATION_COMPLETE" in your response.`,
        Description: "Optimizes code iteratively.",
        OutputKey:   "current_code",
    })
    if err != nil {
        log.Fatal(err)
    }

    // 循环编排 — 最多 5 轮
    loopAgent, err := loopagent.New(loopagent.Config{
        MaxIterations: 5,
        AgentConfig: agent.Config{
            Name:        "IterativeOptimizer",
            Description: "Iteratively optimizes code until convergence.",
            SubAgents:   []agent.Agent{optimizer},
        },
    })
    if err != nil {
        log.Fatal(err)
    }

    config := &launcher.Config{
        AgentLoader: agent.NewSingleLoader(loopAgent),
    }
    l := full.NewLauncher()
    if err = l.Execute(ctx, config, os.Args[1:]); err != nil {
        log.Fatalf("Run failed: %v", err)
    }
}
```

### 4.4 关键设计要点

| 特性 | 说明 |
|------|------|
| 终止条件 | `MaxIterations` 或 `Escalate` |
| Escalate 信号 | sub-agent 在 EventActions 中设置 `Escalate = true` |
| 状态传递 | 同 SequentialAgent，通过 `OutputKey` + state 模板 |
| 典型场景 | 代码迭代优化、文章反复修订、直到收敛的推理 |

---

## 五、LLM Agent Transfer — 智能路由转交

### 5.1 机制概述

Transfer 是 ADK 最核心的多智能体协作机制。LLM Agent 在运行时自动注入 `transfer_to_agent` 工具，LLM 可根据用户意图**自主决定**将控制权转交给其他 agent。

### 5.2 Transfer 方向

```
          Parent (LLMAgent)
         /        \
    SubAgentA    SubAgentB

方向1: Parent → SubAgent (下放)
方向2: SubAgent → Parent (上交)  [需 DisallowTransferToParent=false]
方向3: SubAgent ↔ Peer   (平级) [需 DisallowTransferToPeers=false 且 Parent 也是 LLMAgent]
```

### 5.3 控制字段

```go
// llmagent.Config
DisallowTransferToParent bool  // 默认 false = 允许转交回父 agent
DisallowTransferToPeers  bool  // 默认 false = 允许转交给兄弟 agent
```

### 5.4 Transfer 工作流程

1. **预处理阶段** (`AgentTransferRequestProcessor`):
   - 检测当前 agent 是否应使用 AutoFlow（有 SubAgents 或允许 Transfer）
   - 计算可转交目标: `transferTargets(agent, parent)` → SubAgents + Parent + Peers
   - 注入 `transfer_to_agent` 工具到 LLM Request
   - 注入 Transfer 指令到 System Instruction（包含目标 agent 列表和描述）

2. **LLM 决策**: LLM 根据指令决定是否调用 `transfer_to_agent(agent_name="xxx")`

3. **工具执行** (`TransferToAgentTool.Run`):
   - 设置 `ctx.Actions().TransferToAgent = agentName`

4. **Flow 处理** (`base_flow.go runOneStep`):
   - 检测 `ev.Actions.TransferToAgent != ""`
   - 调用 `f.agentToRun()` 查找目标 agent
   - 执行 `nextAgent.Run(ctx)` 并 yield 所有 event

5. **Runner 层面** (`runner.go findAgentToRun`):
   - 下次用户消息时，根据 session 历史找到最后活跃的 agent
   - 检查 `isTransferableAcrossAgentTree` 确认可路由

### 5.5 完整示例：多领域路由助手

```go
package main

import (
    "context"
    "log"
    "os"

    "google.golang.org/genai"

    "google.golang.org/adk/agent"
    "google.golang.org/adk/agent/llmagent"
    "google.golang.org/adk/cmd/launcher"
    "google.golang.org/adk/cmd/launcher/full"
    "google.golang.org/adk/model/gemini"
    "google.golang.org/adk/tool"
    "google.golang.org/adk/tool/functiontool"
    "google.golang.org/adk/tool/geminitool"
)

// ---- 工具定义 ----

type WeatherArgs struct {
    City string `json:"city"`
}

type WeatherResult struct {
    City        string `json:"city"`
    Temperature int    `json:"temperature"`
    Condition   string `json:"condition"`
}

func GetWeather(ctx tool.Context, args WeatherArgs) (WeatherResult, error) {
    return WeatherResult{City: args.City, Temperature: 22, Condition: "Sunny"}, nil
}

type StockArgs struct {
    Symbol string `json:"symbol"`
}

type StockResult struct {
    Symbol string  `json:"symbol"`
    Price  float64 `json:"price"`
    Change float64 `json:"change"`
}

func GetStockPrice(ctx tool.Context, args StockArgs) (StockResult, error) {
    return StockResult{Symbol: args.Symbol, Price: 150.25, Change: 2.5}, nil
}

func main() {
    ctx := context.Background()

    model, err := gemini.NewModel(ctx, "gemini-2.5-flash", &genai.ClientConfig{})
    if err != nil {
        log.Fatal(err)
    }

    // Sub-Agent 1: 天气专家
    weatherAgent, err := llmagent.New(llmagent.Config{
        Name:        "weather_agent",
        Model:       model,
        Description: "Handles questions about weather in any city.",
        Instruction: "You are a weather specialist. Use the get_weather tool to answer weather questions. If the question is not about weather, transfer to the parent agent.",
        Tools: []tool.Tool{
            mustTool(functiontool.New(functiontool.Config{
                Name:        "get_weather",
                Description: "Gets the current weather for a city",
            }, GetWeather)),
        },
        // 默认允许 TransferToParent 和 TransferToPeers
    })
    if err != nil {
        log.Fatal(err)
    }

    // Sub-Agent 2: 股票专家
    stockAgent, err := llmagent.New(llmagent.Config{
        Name:        "stock_agent",
        Model:       model,
        Description: "Handles questions about stock prices and financial data.",
        Instruction: "You are a financial specialist. Use the get_stock_price tool to answer stock questions. If the question is not about stocks, transfer to the parent agent.",
        Tools: []tool.Tool{
            mustTool(functiontool.New(functiontool.Config{
                Name:        "get_stock_price",
                Description: "Gets the current stock price for a symbol",
            }, GetStockPrice)),
        },
    })
    if err != nil {
        log.Fatal(err)
    }

    // Sub-Agent 3: 通用搜索专家
    searchAgent, err := llmagent.New(llmagent.Config{
        Name:        "search_agent",
        Model:       model,
        Description: "Handles general knowledge questions using web search.",
        Instruction: "You are a general knowledge assistant. Use Google Search to find answers. If the question is about weather or stocks, transfer to the appropriate agent.",
        Tools: []tool.Tool{
            geminitool.GoogleSearch{},
        },
    })
    if err != nil {
        log.Fatal(err)
    }

    // Root Agent: 路由协调器
    // SubAgents 声明在此，ADK 自动构建 Transfer 关系
    rootAgent, err := llmagent.New(llmagent.Config{
        Name:        "router_agent",
        Model:       model,
        Description: "A router agent that delegates to specialized sub-agents.",
        Instruction: "You are a helpful assistant. Delegate to the most appropriate sub-agent based on the user's question. You can also answer simple questions yourself.",
        SubAgents:   []agent.Agent{weatherAgent, stockAgent, searchAgent},
    })
    if err != nil {
        log.Fatal(err)
    }

    config := &launcher.Config{
        AgentLoader: agent.NewSingleLoader(rootAgent),
    }
    l := full.NewLauncher()
    if err = l.Execute(ctx, config, os.Args[1:]); err != nil {
        log.Fatalf("Run failed: %v", err)
    }
}

func mustTool(t tool.Tool, err error) tool.Tool {
    if err != nil {
        panic(err)
    }
    return t
}
```

### 5.6 Transfer vs SubAgents 对比

| 维度 | Transfer (AutoFlow) | SubAgents (Workflow) |
|------|---------------------|---------------------|
| 决策者 | LLM 自主决定 | 开发者硬编码 |
| 灵活性 | 动态路由 | 固定流程 |
| 适用场景 | 开放域对话、多技能 | 流水线、并行、迭代 |
| 控制粒度 | `DisallowTransferTo*` | 代码结构 |
| 状态共享 | 同一 session | 同一 session + Branch 隔离 |

---

## 六、AgentTool — Agent 作为工具调用

### 6.1 API

```go
// tool/agenttool/agent_tool.go
func New(agent agent.Agent, cfg *Config) tool.Tool

type Config struct {
    SkipSummarization bool  // 跳过子 agent 执行后的 LLM 摘要
}
```

### 6.2 行为

- 将 Agent 包装为 `tool.Tool`，可被其他 LLMAgent 作为工具调用
- 执行时创建**独立 session**，运行子 agent，返回最终文本结果
- 支持 `InputSchema` / `OutputSchema` 验证
- 与 Transfer 不同：调用方保持控制权，被调用方是"工具"

### 6.3 完整示例

```go
package main

import (
    "context"
    "log"
    "os"

    "google.golang.org/genai"

    "google.golang.org/adk/agent"
    "google.golang.org/adk/agent/llmagent"
    "google.golang.org/adk/cmd/launcher"
    "google.golang.org/adk/cmd/launcher/full"
    "google.golang.org/adk/model/gemini"
    "google.golang.org/adk/tool"
    "google.golang.org/adk/tool/agenttool"
)

func main() {
    ctx := context.Background()

    model, err := gemini.NewModel(ctx, "gemini-2.5-flash", &genai.ClientConfig{})
    if err != nil {
        log.Fatal(err)
    }

    // 子 Agent: 翻译器
    translatorAgent, err := llmagent.New(llmagent.Config{
        Name:        "translator",
        Model:       model,
        Description: "Translates text to a target language.",
        Instruction: "Translate the given text to the language specified by the user. Output only the translation.",
    })
    if err != nil {
        log.Fatal(err)
    }

    // 主 Agent: 将 translator 包装为工具使用
    mainAgent, err := llmagent.New(llmagent.Config{
        Name:        "multilingual_assistant",
        Model:       model,
        Description: "An assistant that can translate text using a sub-agent tool.",
        Instruction: "You are a helpful assistant. When the user asks for translation, use the translator tool.",
        Tools: []tool.Tool{
            agenttool.New(translatorAgent, nil),  // Agent 作为 Tool
        },
    })
    if err != nil {
        log.Fatal(err)
    }

    config := &launcher.Config{
        AgentLoader: agent.NewSingleLoader(mainAgent),
    }
    l := full.NewLauncher()
    if err = l.Execute(ctx, config, os.Args[1:]); err != nil {
        log.Fatalf("Run failed: %v", err)
    }
}
```

---

## 七、混合编排：组合所有模式

### 7.1 示例：SequentialAgent 内嵌 LLMAgent（含 Transfer）

```go
// LLM Auditor 模式: Critic → Reviser 顺序执行
// 来源: examples/web/agents/llmauditor.go

criticAgent, _ := llmagent.New(llmagent.Config{
    Name:        "critic_agent",
    Model:       model,
    Instruction: CriticPrompt,
    AfterModelCallbacks: []llmagent.AfterModelCallback{afterCritic},
})

reviserAgent, _ := llmagent.New(llmagent.Config{
    Name:        "reviser_agent",
    Model:       model,
    Instruction: ReviserPrompt,
    AfterModelCallbacks: []llmagent.AfterModelCallback{afterReviser},
})

rootAgent, _ := sequentialagent.New(sequentialagent.Config{
    AgentConfig: agent.Config{
        Name:        "llm_auditor",
        Description: "Evaluates and revises LLM-generated answers.",
        SubAgents:   []agent.Agent{criticAgent, reviserAgent},
    },
})
```

### 7.2 示例：LoopAgent + SequentialAgent 嵌套

```go
// 每轮循环: Writer → Reviewer 顺序执行，直到 Reviewer 满意
writerAgent, _ := llmagent.New(llmagent.Config{
    Name:        "writer",
    Model:       model,
    Instruction: "Write or revise the article based on feedback: {review_feedback?}",
    OutputKey:   "draft",
})

reviewerAgent, _ := llmagent.New(llmagent.Config{
    Name:        "reviewer",
    Model:       model,
    Instruction: "Review this draft: {draft}. If good, say APPROVED. Otherwise provide feedback.",
    OutputKey:   "review_feedback",
})

// 内层: 顺序执行 Writer → Reviewer
innerSeq, _ := sequentialagent.New(sequentialagent.Config{
    AgentConfig: agent.Config{
        Name:      "write_and_review",
        SubAgents: []agent.Agent{writerAgent, reviewerAgent},
    },
})

// 外层: 循环执行，最多 3 轮
loopAgent, _ := loopagent.New(loopagent.Config{
    MaxIterations: 3,
    AgentConfig: agent.Config{
        Name:      "iterative_writing",
        SubAgents: []agent.Agent{innerSeq},
    },
})
```

---

## 八、推荐 DataToolbox Agent 树结构设计

### 8.1 设计原则

1. **单一职责**: 每个 Agent 专注一个数据领域/操作类型
2. **Transfer 路由**: 顶层 Router 用 LLM Transfer 动态分派
3. **Workflow 编排**: 复杂流水线用 Sequential/Loop 编排
4. **状态隔离**: 并行操作用 ParallelAgent + Branch
5. **可扩展**: 新增数据源只需添加 SubAgent

### 8.2 推荐树结构

```
DataToolboxRouter (LLMAgent, root)
├── DataQueryAgent (LLMAgent) — 自然语言→SQL 查询
│   ├── SQLGenerator (LLMAgent) — 生成 SQL
│   └── SQLReviewer (LLMAgent) — 审查 SQL 安全性/正确性
│       [SequentialAgent: SQLGenerator → SQLReviewer]
├── DataAnalysisAgent (LLMAgent) — 数据分析与可视化
│   ├── StatAnalyzer (LLMAgent) — 统计分析
│   ├── ChartGenerator (LLMAgent) — 图表生成
│   └── InsightSummarizer (LLMAgent) — 洞察总结
│       [SequentialAgent: StatAnalyzer → ChartGenerator → InsightSummarizer]
├── DataPipelineAgent (LLMAgent) — ETL 流水线
│   ├── DataIngestion (LLMAgent) — 数据摄取
│   ├── DataTransform (LLMAgent) — 数据转换
│   └── DataValidation (LLMAgent) — 数据校验
│       [LoopAgent: Ingestion → Transform → Validation (max 3 iterations)]
├── DataQualityAgent (LLMAgent) — 数据质量检查
│   ├── SchemaValidator (LLMAgent) — Schema 校验
│   ├── AnomalyDetector (LLMAgent) — 异常检测
│   └── CompletenessChecker (LLMAgent) — 完整性检查
│       [ParallelAgent: Schema + Anomaly + Completeness 并行]
└── DataDocAgent (LLMAgent) — 数据文档与知识管理
    ├── SchemaDocWriter (LLMAgent) — Schema 文档生成
    └── DataDictionaryUpdater (LLMAgent) — 数据字典更新
        [SequentialAgent: SchemaDoc → DictionaryUpdate]
```

### 8.3 Go 代码骨架

```go
package main

import (
    "context"
    "log"
    "os"

    "google.golang.org/genai"

    "google.golang.org/adk/agent"
    "google.golang.org/adk/agent/llmagent"
    "google.golang.org/adk/agent/workflowagents/loopagent"
    "google.golang.org/adk/agent/workflowagents/parallelagent"
    "google.golang.org/adk/agent/workflowagents/sequentialagent"
    "google.golang.org/adk/cmd/launcher"
    "google.golang.org/adk/cmd/launcher/full"
    "google.golang.org/adk/model/gemini"
    "google.golang.org/adk/tool"
    "google.golang.org/adk/tool/functiontool"
)

func main() {
    ctx := context.Background()
    model, err := gemini.NewModel(ctx, "gemini-2.5-flash", &genai.ClientConfig{})
    if err != nil {
        log.Fatal(err)
    }

    // ========== 1. Data Query Agent (Sequential: SQL Gen → Review) ==========
    sqlGen, _ := llmagent.New(llmagent.Config{
        Name:         "sql_generator",
        Model:        model,
        Description:  "Generates SQL queries from natural language.",
        Instruction:  "Generate a safe, optimized SQL query for the user's request. Output only the SQL.\n\nSchema context:\n{schema_context?}",
        OutputKey:    "generated_sql",
    })

    sqlReview, _ := llmagent.New(llmagent.Config{
        Name:         "sql_reviewer",
        Model:        model,
        Description:  "Reviews SQL for safety and correctness.",
        Instruction:  "Review this SQL query for injection risks, performance issues, and correctness:\n\n{generated_sql}\n\nIf approved, respond with the final SQL. If not, provide corrections.",
        OutputKey:    "final_sql",
    })

    queryPipeline, _ := sequentialagent.New(sequentialagent.Config{
        AgentConfig: agent.Config{
            Name:      "query_pipeline",
            SubAgents: []agent.Agent{sqlGen, sqlReview},
        },
    })

    dataQueryAgent, _ := llmagent.New(llmagent.Config{
        Name:         "data_query_agent",
        Model:        model,
        Description:  "Handles natural language data queries. Generates and validates SQL.",
        Instruction:  "You handle data querying. Use the query_pipeline to generate safe SQL, then execute it.",
        SubAgents:    []agent.Agent{queryPipeline},
        // Tools: []tool.Tool{ sqlExecutionTool },
    })

    // ========== 2. Data Analysis Agent (Sequential: Stats → Chart → Insight) ==========
    statAnalyzer, _ := llmagent.New(llmagent.Config{
        Name:        "stat_analyzer",
        Model:       model,
        Description: "Performs statistical analysis on data.",
        Instruction: "Analyze the data and produce statistical summaries. Output key metrics.",
        OutputKey:   "stats_result",
    })

    chartGenerator, _ := llmagent.New(llmagent.Config{
        Name:        "chart_generator",
        Model:       model,
        Description: "Generates chart specifications from analysis results.",
        Instruction: "Based on these statistics:\n{stats_result}\n\nGenerate appropriate chart specifications.",
        OutputKey:   "chart_spec",
    })

    insightSummarizer, _ := llmagent.New(llmagent.Config{
        Name:        "insight_summarizer",
        Model:       model,
        Description: "Summarizes analysis insights.",
        Instruction: "Summarize the key insights from:\n{stats_result}\n\nCharts: {chart_spec}",
        OutputKey:   "insight_summary",
    })

    analysisPipeline, _ := sequentialagent.New(sequentialagent.Config{
        AgentConfig: agent.Config{
            Name:      "analysis_pipeline",
            SubAgents: []agent.Agent{statAnalyzer, chartGenerator, insightSummarizer},
        },
    })

    dataAnalysisAgent, _ := llmagent.New(llmagent.Config{
        Name:         "data_analysis_agent",
        Model:        model,
        Description:  "Handles data analysis, visualization, and insight extraction.",
        Instruction:  "You handle data analysis tasks. Delegate to the analysis pipeline.",
        SubAgents:    []agent.Agent{analysisPipeline},
    })

    // ========== 3. Data Pipeline Agent (Loop: Ingest → Transform → Validate) ==========
    dataIngest, _ := llmagent.New(llmagent.Config{
        Name:        "data_ingestion",
        Model:       model,
        Description: "Ingests data from specified sources.",
        Instruction: "Ingest data from the specified source. Report ingestion status.",
        OutputKey:   "ingestion_status",
    })

    dataTransform, _ := llmagent.New(llmagent.Config{
        Name:        "data_transform",
        Model:       model,
        Description: "Transforms and cleans data.",
        Instruction: "Transform the ingested data based on requirements.\nIngestion: {ingestion_status?}",
        OutputKey:   "transform_result",
    })

    dataValidate, _ := llmagent.New(llmagent.Config{
        Name:        "data_validation",
        Model:       model,
        Description: "Validates data quality after transformation.",
        Instruction: "Validate the transformed data.\nTransform: {transform_result?}\n\nIf validation passes, say VALIDATION_PASSED. Otherwise list issues.",
        OutputKey:   "validation_result",
    })

    etlLoop, _ := loopagent.New(loopagent.Config{
        MaxIterations: 3,
        AgentConfig: agent.Config{
            Name:      "etl_loop",
            SubAgents: []agent.Agent{dataIngest, dataTransform, dataValidate},
        },
    })

    dataPipelineAgent, _ := llmagent.New(llmagent.Config{
        Name:         "data_pipeline_agent",
        Model:        model,
        Description:  "Handles ETL pipelines with iterative validation.",
        Instruction:  "You manage data pipelines. Delegate to the ETL loop for ingest-transform-validate cycles.",
        SubAgents:    []agent.Agent{etlLoop},
    })

    // ========== 4. Data Quality Agent (Parallel: Schema + Anomaly + Completeness) ==========
    schemaValidator, _ := llmagent.New(llmagent.Config{
        Name:        "schema_validator",
        Model:       model,
        Description: "Validates data schema compliance.",
        Instruction: "Check if the data conforms to the expected schema. Report violations.",
        OutputKey:   "schema_check",
    })

    anomalyDetector, _ := llmagent.New(llmagent.Config{
        Name:        "anomaly_detector",
        Model:       model,
        Description: "Detects data anomalies and outliers.",
        Instruction: "Detect anomalies and outliers in the data. Report findings.",
        OutputKey:   "anomaly_check",
    })

    completenessChecker, _ := llmagent.New(llmagent.Config{
        Name:        "completeness_checker",
        Model:       model,
        Description: "Checks data completeness and missing values.",
        Instruction: "Check for missing values and data completeness. Report gaps.",
        OutputKey:   "completeness_check",
    })

    qualityParallel, _ := parallelagent.New(parallelagent.Config{
        AgentConfig: agent.Config{
            Name:      "quality_parallel",
            SubAgents: []agent.Agent{schemaValidator, anomalyDetector, completenessChecker},
        },
    })

    dataQualityAgent, _ := llmagent.New(llmagent.Config{
        Name:         "data_quality_agent",
        Model:        model,
        Description:  "Performs parallel data quality checks.",
        Instruction:  "You handle data quality. Run parallel checks for schema, anomalies, and completeness.",
        SubAgents:    []agent.Agent{qualityParallel},
    })

    // ========== 5. Data Doc Agent (Sequential: SchemaDoc → Dictionary) ==========
    schemaDocWriter, _ := llmagent.New(llmagent.Config{
        Name:        "schema_doc_writer",
        Model:       model,
        Description: "Generates schema documentation.",
        Instruction: "Generate comprehensive schema documentation for the data.",
        OutputKey:   "schema_doc",
    })

    dictUpdater, _ := llmagent.New(llmagent.Config{
        Name:        "dictionary_updater",
        Model:       model,
        Description: "Updates the data dictionary.",
        Instruction: "Update the data dictionary based on:\n{schema_doc}",
        OutputKey:   "dictionary_update",
    })

    docPipeline, _ := sequentialagent.New(sequentialagent.Config{
        AgentConfig: agent.Config{
            Name:      "doc_pipeline",
            SubAgents: []agent.Agent{schemaDocWriter, dictUpdater},
        },
    })

    dataDocAgent, _ := llmagent.New(llmagent.Config{
        Name:         "data_doc_agent",
        Model:        model,
        Description:  "Manages data documentation and data dictionary.",
        Instruction:  "You handle data documentation. Delegate to the doc pipeline.",
        SubAgents:    []agent.Agent{docPipeline},
    })

    // ========== Root: DataToolbox Router ==========
    rootAgent, err := llmagent.New(llmagent.Config{
        Name:  "datatoolbox",
        Model: model,
        Description: "A comprehensive data toolbox that handles querying, analysis, pipelines, quality, and documentation.",
        Instruction: `You are the DataToolbox router. Based on the user's request, delegate to the most appropriate sub-agent:

- data_query_agent: For SQL queries and data retrieval
- data_analysis_agent: For statistical analysis and visualization
- data_pipeline_agent: For ETL and data processing pipelines
- data_quality_agent: For data quality checks and validation
- data_doc_agent: For documentation and data dictionary

If the request is simple, answer directly. Otherwise, transfer to the best-fit agent.`,
        SubAgents: []agent.Agent{
            dataQueryAgent,
            dataAnalysisAgent,
            dataPipelineAgent,
            dataQualityAgent,
            dataDocAgent,
        },
    })
    if err != nil {
        log.Fatal(err)
    }

    config := &launcher.Config{
        AgentLoader: agent.NewSingleLoader(rootAgent),
    }
    l := full.NewLauncher()
    if err = l.Execute(ctx, config, os.Args[1:]); err != nil {
        log.Fatalf("Run failed: %v", err)
    }
}
```

### 8.4 设计决策总结

| 层级 | 编排模式 | 理由 |
|------|----------|------|
| Root → L2 | **LLM Transfer** | 用户意图不确定，需 LLM 动态路由 |
| L2 → L3 | **Workflow (Seq/Par/Loop)** | 子任务流程固定，无需 LLM 决策 |
| Query 内部 | **Sequential** | SQL 生成→审查有严格依赖 |
| Analysis 内部 | **Sequential** | 统计→图表→洞察有数据依赖 |
| Pipeline 内部 | **Loop** | ETL 需要迭代验证直到通过 |
| Quality 内部 | **Parallel** | 三种检查互不依赖，可并行加速 |
| Doc 内部 | **Sequential** | 文档→字典更新有因果依赖 |

---

## 九、API 速查表

| 类型 | 包路径 | 构造函数 | 核心配置 |
|------|--------|----------|----------|
| Custom Agent | `agent` | `agent.New(cfg)` | `Config{Name, Description, SubAgents, Run}` |
| LLM Agent | `llmagent` | `llmagent.New(cfg)` | `Config{Name, Model, Instruction, SubAgents, Tools, OutputKey, DisallowTransferTo*}` |
| Sequential | `sequentialagent` | `sequentialagent.New(cfg)` | `Config{AgentConfig}` |
| Parallel | `parallelagent` | `parallelagent.New(cfg)` | `Config{AgentConfig}` |
| Loop | `loopagent` | `loopagent.New(cfg)` | `Config{AgentConfig, MaxIterations}` |
| Agent Tool | `agenttool` | `agenttool.New(agent, cfg)` | `Config{SkipSummarization}` |
| Function Tool | `functiontool` | `functiontool.New(cfg, handler)` | `Config{Name, Description, IsLongRunning}` |
| Runner | `runner` | `runner.New(cfg)` | `Config{AppName, Agent, SessionService}` |

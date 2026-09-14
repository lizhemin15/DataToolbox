# 任务规格：数据质量审核 —— 定时任务 + AI 校核 + 历史统计

> 交付给编码 Agent 的完整规格。请严格按此实现，不要扩大范围。

## 0. 硬性约束

- **不要动** `quality-audit.js` 里刚修好的 `qaHex6FromCssColor` 代理函数（报告模板弹窗 bug 已修复）。
- **不新增任何 go.mod 依赖**（cron 表达式解析自己实现）。
- 沿用现有代码风格：`quality_audit.go` 的 handler 函数、`qaRespondSuccess` / `apiBadRequest` / `apiInternalError` / `apiNotFound`、JSON 字段一律 snake_case、中文 UI 文案。
- 新表一律 `CREATE TABLE IF NOT EXISTS`，并追加到 `openQualityAuditDB()` 内的初始化 SQL 里（与 rules/audit_history 等并列）。
- 前端是 **vanilla JS + IIFE**（`quality-audit.js`），没有框架、没有构建步骤。样式加到 `css/style-models-quality.css`。
- 前端脚本按 `<script>` 直出，`quality-audit.js` 是懒加载（`js/script-core.js` 里有 `loadLazyScript('quality-audit.js?v=x.y.z...')`）。**修改 `quality-audit.js` 或 `index.html` 或 css 后，必须 bump 对应版本号**（css 在 index.html 的 `<link>` 上 `?v=`；quality-audit.js 在 script-core.js 的字符串里把 `1.3.81` 改成 `1.3.82`）。
- 本地可以编译：`export PATH=/usr/local/go1.25/bin:$PATH && go build ./...`。**必须编译通过并跑通自测脚本再提交。**
- 完成后 `git add -A && git commit`，**不要 push**，不要打 tag。
- 不要修改 `/opt/datatoolbox`（那是部署目录，由外部流程同步）。

## 1. 现状（必读，省得你重新摸索）

### 后端 `quality_audit.go`（单文件，2700 行）
- 元数据库：`openQualityAuditDB()` → sqlite，表：`rules` / `rule_versions` / `item_fill_rate` / `record_fill_rate` / `report_templates` / `audit_history` / `audit_errors`
- 规则模型：`qaRule{NM, XH, Name, SQL, Category, UpdatedAt}`，NM 6 位补零，XH 是层级编码（`01/0101/010101`），SQL 按 Oracle 方言书写，执行时 `convertOracleSQLForDialect(sql, dialect)` 转换
- 审核执行：`qaExecute(w, r, username)`，请求 `{database_id, rule_nms[]}`；内部用连接池 `getDBFromPool(dbConfig)`、`loadRulesFlat()`、`sanitizeSQLForQA()`、`executeRuleQuery()`，结果含 `summary{total_rules,passed,failed}` / `rules[]` / `item_fill_rates[]` / `record_fill_rates[]`，并把历史写进 `audit_history`
- 报告：`qaReport(w, r, username)`，请求 `{audit, template_id}` → **返回 docx 二进制**（`Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`）
- 模板：`qaTemplatesGET/POST/DELETE`，表 `report_templates(id,name,template_type,content,is_default)`
- 统计：`qaStats(w, r, username)`，按 `database_id` + `days` 聚合 `audit_history`/`audit_errors`
- **已有的旧调度器（要替换掉）**：`qaScheduleJob` / `qaRunScheduledAudit` / `qaStopScheduleJob` / `qaListScheduleJobs`，只支持「每 N 分钟」、纯内存、重启即丢，没有 AI 校核、没有报告落盘、没有执行记录表。相关 handler：`qaScheduleList` / `qaScheduleCreate` / `qaScheduleDelete`（**接口契约要升级，见 §2**）
- 路由：`handleQualityAuditAPI` 里的 switch，路径前缀 `/api/v1/quality-audit/`

### 前端
- `index.html` 的 `#qualityTab`：`报告模板` 按钮 / `规则树`（`#qaTree`，含 `#qaTreeSelectAll`、`#qaExpandAll`、`#qaBatchDelete`、批量导入三件套 `#qaDownloadTemplate` `#qaPasteExcel` `#qaXlsxFile`）/ `规则编辑`（`#qaNm` `#qaXh` `#qaName` `#qaCategory` `#qaSql` `#qaSaveRule` `#qaDelRule`）/ `填报率配置`（`#qaFillItemTree` `#qaFillRecordTree` 两个 tab）/ 底部 `#qaDbSelect` + `#qaRun`（一键审核）+ `#qaReport`（生成报告）/ 结果区 `#qaAuditResult`
- `quality-audit.js`：IIFE，已绑定上述所有元素；`loadRules()` 拿 `{tree, flat}` 并 `renderTree()`；`selectedNms` 存勾选；`showMsg(text, isErr)` 提示；`fetchWithAuth(url, {method, body})` 发请求；`API_BASE` 全局；`escapeHtml` 有
- 数据库下拉数据来自 `GET /api/v1/databases`，`databases[]` 元素含 `{id, name, type, host, port}`；`dbTypeIcons` / `dbTypeDefaults` 里有类型图标

### LLM
- `llm_models` 表字段：`id,name,type,provider,url,api_key,model,description,enabled,extra`
- `agent/provider.go` 里有 `ProviderRegistry`（`AgentProviderRegistry`? 见 `agent/` 包），可 `CreatePicoProvider(ctx, ProviderConfig)` 返回 `picoclawproviders.LLMProvider`
- 目标：**优先用 `llm_models` 里第一个 `enabled=1` 的模型**（`provider='openai'` 兼容 OpenAI `/chat/completions`；`url` 字段可能已带或不带 `/chat/completions`，参考 `ai_ontology.go:getAIEndpoint()` 的归一化逻辑），直接发一次非流式 HTTP 请求即可，**不要**依赖 agent cluster 那套复杂流程。
- 没有可用模型时：AI 校核这一步跳过，并在结果里标注 `ai_skipped: true` + 原因，不要报错中断。

## 2. 设计

### 2.1 数据表（加到 `openQualityAuditDB()` 初始化 SQL）

```sql
CREATE TABLE IF NOT EXISTS qa_schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  database_id TEXT NOT NULL,
  cron_expr TEXT NOT NULL,               -- 5 段标准 cron: 分 时 日 月 周
  enabled INTEGER DEFAULT 1,
  rule_nms TEXT DEFAULT '[]',            -- JSON 数组
  ai_check_nms TEXT DEFAULT '[]',        -- JSON 数组，rule_nms 的子集
  ai_prompt TEXT DEFAULT '',             -- AI 校核原则，可空
  report_template_id TEXT DEFAULT '',
  last_run_at TEXT DEFAULT '',
  last_run_status TEXT DEFAULT '',
  next_run_at TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS qa_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT DEFAULT '',           -- '' 表示手动触发
  schedule_name TEXT DEFAULT '',
  trigger_type TEXT DEFAULT 'cron',      -- cron | manual
  database_id TEXT DEFAULT '',
  started_at TEXT DEFAULT '',
  finished_at TEXT DEFAULT '',
  duration_ms INTEGER DEFAULT 0,
  status TEXT DEFAULT '',                -- success | failed
  total_rules INTEGER DEFAULT 0,
  passed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  ai_flagged INTEGER DEFAULT 0,          -- AI 判定「疑似规则过严误判」的条数
  report_file TEXT DEFAULT '',           -- 相对 qa 数据目录的文件名
  summary TEXT DEFAULT '',               -- JSON
  detail TEXT DEFAULT '',                -- JSON：每条规则结果 + ai_suggestion
  error TEXT DEFAULT '',
  created_by TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_qa_runs_schedule ON qa_runs(schedule_id);
CREATE INDEX IF NOT EXISTS idx_qa_runs_time ON qa_runs(started_at);
```

### 2.2 接口（全部挂在 `/api/v1/quality-audit/`，改动加到 `handleQualityAuditAPI` 的 switch）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `schedules` | 列表。返回 `{success, schedules:[{id,name,database_id,cron_expr,cron_text,enabled,rule_nms,ai_check_nms,ai_prompt,report_template_id,last_run_at,last_run_status,next_run_at,created_at}]}`，`cron_text` 是人话描述（如「每天 08:30」） |
| POST | `schedules` | 新建/更新（带 `id` 即更新）。请求 `{id?,name,database_id,cron_expr,enabled,rule_nms,ai_check_nms,ai_prompt,report_template_id}`；校验：name 非空、database_id 存在、rule_nms 非空、`ai_check_nms ⊆ rule_nms`、cron_expr 能被解析 |
| DELETE | `schedules/{id}` | 删除 |
| POST | `schedules/{id}/run` | 立即执行一次，**同步**跑完并返回 `{success, run_id}`（或异步+轮询，但必须保证 run 记录写入 `qa_runs`） |
| GET | `runs` | 执行记录列表。query: `schedule_id?`、`limit`（默认 50）、`status?`。返回 `{success, runs:[{id,schedule_id,schedule_name,trigger_type,database_id,started_at,duration_ms,status,total_rules,passed,failed,ai_flagged,has_report}]}` |
| GET | `runs/{id}` | 单次详情：完整 `detail`（每条规则：`nm,name,category,sql_executed,passed,violation_count,sample_rows?`，以及 AI 校核字段 `ai_misjudged`,`ai_confidence`,`ai_reason`,`ai_suggestion`） |
| GET | `runs/{id}/report` | 下载该次生成的 docx（`Content-Disposition: attachment; filename=...docx`），文件不存在时 404 |
| GET | `overview` | 概览统计（供界面卡片+趋势图）：`{success, schedules_total, schedules_enabled, runs_today, success_rate_30d, ai_flagged_30d, daily:[{date,passed,failed}](近14天，补齐没有数据的日期), top_failed_rules:[{nm,name,count}](近30天 top5), next_run:{schedule_id,name,next_run_at}?}` |
| POST | `report` | **保持现状**（手动生成报告） |

**兼容**：旧 `schedule`（单数）接口没有前端调用方（前端从未实现），可以直接替换成 `schedules`；但为了保险，`schedule` 路径可以保留一个 410/提示，或直接删掉并在代码注释说明。`qaStats` 保留不动。

### 2.3 cron 解析（自己实现，约 120 行）

- 支持 5 段：`分 时 日 月 周`，取值 `*`、`n`、`a-b`、`*/n`、`a-b/n`、逗号列表；周日 = 0 或 7
- API：`qaCronParse(expr string) (*qaCronSpec, error)`、`(spec *qaCronSpec) Next(from time.Time) time.Time`
- `qaCronDescribe(expr) string` → 中文描述，覆盖常见形态（`0 8 * * *`→「每天 08:00」、`30 2 * * 1`→「每周一 02:30」、`0 */6 * * *`→「每 6 小时」、`*/30 * * * *`→「每 30 分钟」），兜底返回原表达式
- 时区：按 `time.Local`（服务器 `Asia/Shanghai`，DB 里时间统一 `time.Now().Format(time.RFC3339)`）
- 单测：写 `qa_cron_test.go`，`go test ./ -run TestQACron` 必须通过（覆盖 Next 的几种边界：跨天、跨月、星期匹配、`*/n`）

### 2.4 调度器（替换旧实现）

- 启动一个后台 goroutine（`sync.Once` 保证只启动一次，可在第一次访问 `schedules` 接口或 `main()` 里调用 `qaSchedulerStart()`），**每 30 秒**轮询一次：读 `qa_schedules` 里 `enabled=1` 的记录，用 cron 计算 `next_run_at`，到点就执行并写 `qa_runs`
- 执行内容（复用现有执行逻辑，尽量抽公共函数，别复制粘贴大段代码）：
  1. 用规则 SQL 对目标库执行审核（同 `qaExecute`）
  2. 生成 docx 报告（复用 `qaReport` 的渲染函数 —— 把它的核心逻辑抽成 `qaBuildReportDocx(audit map[string]interface{}, templateID string) ([]byte, error)` 之类的可复用函数，`qaReport` handler 改为调用它，**不要改变其对外行为**），落盘到 `getQualityAuditDBPath()` 同级的 `qa-reports/<run_id>.docx`，记到 `qa_runs.report_file`
  3. **AI 校核**：只对 `ai_check_nms` 里的规则、且本次 `failed`（或 `violation_count>0`）的做。prompt 大致：
     - system: 「你是数据质量审核专家。判断给定 SQL 审核规则的失败结果是否属于『规则本身过严导致的误判』，给出结论与修改建议。」
     - user: 规则编号/名称/类别、规则 SQL、本次执行 SQL、违规行数、前 5 行样本(`sample_rows` 如果有)、以及用户自定义原则（`ai_prompt`，为空则不加这段，让模型依据「字段名 + SQL + 常识」判断）
     - 要求模型**只输出 JSON**：`{"misjudged": true|false, "confidence": 0.0-1.0, "reason": "...", "suggestion": "..."}`；解析失败要容错（保留原文到 `ai_reason`）
     - 逐条调用，串行 + 每条之间 300ms 间隔，避免打爆；单条超时 30s；整体失败不影响审核主流程
- 手动触发（`schedules/{id}/run`）走同一个执行函数，`trigger_type=manual`
- 任务并发保护：同一 `schedule_id` 正在跑时跳过本轮（记一条 log 即可）

### 2.5 前端 UI

在 `#qualityTab` 顶部加一层子 tab：**「规则配置」/「定时任务」/「执行记录」**（复用现有 `.qa-tab` 风格或新建 `.qa-subtab`，默认「规则配置」）。原内容整体归入「规则配置」。

**定时任务面板**
- 顶部：`+ 新建任务` 按钮
- 列表（表格）：任务名 / 目标数据库 / 执行时间(cron_text) / 规则数 / AI 校核数 / 状态(启用开关 `#qaSchedToggle`) / 上次执行(时间+通过/不通过+状态色) / 下次执行 / 操作（`立即执行` `编辑` `删除`）
- 新建/编辑弹窗（复用 `#qaTplModal` 的 modal 样式套路）：
  - 任务名称
  - 目标数据库（下拉，取自 `/api/v1/databases`）
  - 执行时间：**「常用」选择器**（每天 / 每周 / 每月 / 每 N 小时 / 自定义）→ 生成 cron，并显示「cron_text + 下次执行时间」实时预览；自定义时给输入框 + 语法提示
  - 审核项：规则树勾选（复用 `renderTree`，多选，含全选/展开）
  - **AI 校核项**：同一棵树，第二列复选框；面板底部一个 `textarea`「AI 校核原则（可选）」+ 说明文案：「勾选的规则在审核失败时，将交由 AI 判断是否为规则过严误判并给出修改建议；不填原则则让 AI 结合字段名、SQL 与常识自行判断」
  - 报告模板（下拉，取自 `templates`）
  - 保存/取消

**执行记录面板**
- 顶部统计卡片：任务总数 / 已启用 / 今日执行 / 近 30 天成功率 / 近 30 天 AI 提示误判数
- 近 14 天趋势：**纯 CSS 柱状图**（不引第三方图表库），通过/不通过两段着色，hover 显示数字
- 记录表格：开始时间 / 任务 / 触发方式 / 数据库 / 通过-不通过 / AI 误判 / 耗时 / 状态 / 操作（`详情` `下载报告`）
- `详情` 弹窗：本次所有规则结果表（编号/名称/类别/结果/违规数），**AI 校核过的行**额外显示徽标与「AI 建议」（`ai_misjudged=true` 高亮成警示色）；顶部显示概览与「下载报告 docx」按钮
- 列表支持按任务过滤 + 手动刷新

### 2.6 自测（必须做，并把命令写进提交信息或 PR 说明）

1. `export PATH=/usr/local/go1.25/bin:$PATH && go build ./... && go vet ./... `（vet 报的既有问题可忽略，新代码不能有）
2. `go test ./ -run TestQACron -v` 通过
3. 起后端本地跑一遍（可选）：
   `cd /root/projects/DataToolbox && PORT=8099 ./DataToolbox 或 go run . `（看 `main.go` 的启动方式），然后
   - `POST /api/v1/system/auth/login {admin/admin1234}` 拿 token
   - `POST /api/v1/quality-audit/schedules` 建一个「每分钟」任务（cron `* * * * *`），等 70 秒，`GET runs` 应能看到记录且 `has_report=true`
   - `GET runs/{id}` 详情、`GET runs/{id}/report` 能下到 docx、`GET overview` 数字合理
   - 数据库用已存在的达梦库（`GET /api/v1/databases` 拿 id）
   - 测完清理测试任务
4. 把自测输出贴到提交信息里

## 3. 交付

- 一个 git commit（不要 push），消息形如：
  `feat(qa): 定时任务支持 cron/持久化 + AI 校核误判 + 执行记录与统计面板`
  正文列出：新增表 / 新增或变更接口 / 前端新增面板 / 自测命令与结果
- 改动文件预期：`quality_audit.go`、`qa_schedule.go`（新）、`qa_cron.go`（新）、`qa_cron_test.go`（新）、`index.html`、`quality-audit.js`、`js/script-core.js`（版本号）、`css/style-models-quality.css`
- 完成后回复：改了哪些文件、自测结果、遗留问题

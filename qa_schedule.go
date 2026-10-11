package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// ============================================================================
// 数据质量审核 —— 定时任务 / 执行记录 / AI 校核
//
// 本文件实现 SPEC_QA_SCHEDULE.md §2.2（接口）、§2.4（调度器 + AI 校核）。
// cron 解析见 qa_cron.go。表结构与 qaExecute/qaReport 的公共逻辑见 quality_audit.go。
// ============================================================================

// ---------------------------------------------------------------------------
// 模型与常量
// ---------------------------------------------------------------------------

type qaSchedule struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	DatabaseID       string   `json:"database_id"`
	CronExpr         string   `json:"cron_expr"`
	Enabled          bool     `json:"enabled"`
	RuleNMs          []string `json:"rule_nms"`
	AICheckNMs       []string `json:"ai_check_nms"`
	AIPrompt         string   `json:"ai_prompt"`
	AICheckEnabled   bool     `json:"ai_check_enabled"`
	ReportTemplateID string   `json:"report_template_id"`
	FillEnabled      bool     `json:"fill_enabled"`
	// ReportOverrides 任务级「报告内容」覆盖层：在模板之上局部改章节开关/标题/选项。
	// nil（或空）= 完全跟随所选模板。落库为 JSON 文本。
	ReportOverrides *qaReportOverride `json:"report_overrides,omitempty"`
	LastRunAt       string            `json:"last_run_at"`
	LastRunStatus   string            `json:"last_run_status"`
	NextRunAt       string            `json:"next_run_at"`
	CreatedBy       string            `json:"created_by"`
	CreatedAt       string            `json:"created_at"`
	UpdatedAt       string            `json:"updated_at"`
}

// qaScheduleReportSelection 把任务上的「报告内容」覆盖层打包成一次选择，
// 交给报告渲染层在模板之上叠加。任务没配覆盖时返回 nil（等价于纯用模板）。
func qaScheduleReportSelection(s *qaSchedule) *qaSelection {
	if s == nil || s.ReportOverrides.empty() {
		return nil
	}
	return &qaSelection{Override: s.ReportOverrides}
}

var (
	qaSchedulerOnce sync.Once

	qaRunningMu        sync.Mutex
	qaRunningSchedules = map[string]bool{}

	errQAScheduleBusy = errors.New("定时任务正在执行中")
)

func qaReportsDir() string {
	return filepath.Join(filepath.Dir(getQualityAuditDBPath()), "qa-reports")
}

func qaTryLockSchedule(id string) bool {
	qaRunningMu.Lock()
	defer qaRunningMu.Unlock()
	if qaRunningSchedules[id] {
		return false
	}
	qaRunningSchedules[id] = true
	return true
}

func qaUnlockSchedule(id string) {
	qaRunningMu.Lock()
	defer qaRunningMu.Unlock()
	delete(qaRunningSchedules, id)
}

// ---------------------------------------------------------------------------
// 调度器（§2.4）
// ---------------------------------------------------------------------------

// qaSchedulerStart 启动后台调度 goroutine，仅启动一次。
func qaSchedulerStart() {
	qaSchedulerOnce.Do(func() {
		go qaSchedulerLoop()
	})
}

func qaSchedulerLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		qaSchedulerTick()
		<-ticker.C
	}
}

// qaSchedulerTick 轮询一次：计算 next_run_at，到点则执行。
func qaSchedulerTick() {
	schedules, err := qaLoadSchedules(true)
	if err != nil {
		log.Printf("qa 调度器：读取定时任务失败: %v", err)
		return
	}
	now := time.Now()
	for i := range schedules {
		s := schedules[i]
		spec, perr := qaCronParse(s.CronExpr)
		if perr != nil {
			continue
		}

		due := false
		if strings.TrimSpace(s.NextRunAt) == "" {
			// 首次：只补齐下次执行时间，不立即触发
			if n := spec.Next(now); !n.IsZero() {
				qaUpdateScheduleNextRun(s.ID, n)
			}
			continue
		}
		nextTime, terr := time.Parse(time.RFC3339, s.NextRunAt)
		if terr != nil {
			if n := spec.Next(now); !n.IsZero() {
				qaUpdateScheduleNextRun(s.ID, n)
			}
			continue
		}
		if !now.Before(nextTime) {
			due = true
		}
		if !due {
			continue
		}

		if _, _, err := qaRunSchedule(&s, "cron", s.CreatedBy); err != nil {
			if errors.Is(err, errQAScheduleBusy) {
				log.Printf("qa 调度器：任务「%s」正在执行，跳过本轮", s.Name)
			} else {
				log.Printf("qa 调度器：任务「%s」执行失败: %v", s.Name, err)
			}
		}
		// 无论成功与否都推进下一次执行时间，避免到点后反复重试
		if n := spec.Next(now); !n.IsZero() {
			qaUpdateScheduleNextRun(s.ID, n)
		}
	}
}

func qaUpdateScheduleNextRun(id string, t time.Time) {
	db, err := openQualityAuditDB()
	if err != nil {
		return
	}
	_, _ = db.Exec(`UPDATE qa_schedules SET next_run_at=? WHERE id=?`, t.Format(time.RFC3339), id)
}

// ---------------------------------------------------------------------------
// 定时任务读取
// ---------------------------------------------------------------------------

func qaDecodeNMs(raw string) []string {
	out := []string{}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return out
	}
	_ = json.Unmarshal([]byte(raw), &out)
	if out == nil {
		out = []string{}
	}
	return out
}

func qaLoadSchedules(enabledOnly bool) ([]qaSchedule, error) {
	db, err := openQualityAuditDB()
	if err != nil {
		return nil, err
	}
	q := `SELECT id, name, database_id, cron_expr, enabled, rule_nms, ai_check_nms, ai_prompt, report_template_id, fill_enabled, ai_check_enabled, last_run_at, last_run_status, next_run_at, created_by, created_at, updated_at, report_overrides FROM qa_schedules`
	if enabledOnly {
		q += ` WHERE enabled=1`
	}
	q += ` ORDER BY created_at DESC`
	rows, err := db.Query(q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []qaSchedule{}
	for rows.Next() {
		s, err := qaScanSchedule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

func qaLoadSchedule(id string) (*qaSchedule, error) {
	db, err := openQualityAuditDB()
	if err != nil {
		return nil, err
	}
	row := db.QueryRow(`SELECT id, name, database_id, cron_expr, enabled, rule_nms, ai_check_nms, ai_prompt, report_template_id, fill_enabled, ai_check_enabled, last_run_at, last_run_status, next_run_at, created_by, created_at, updated_at, report_overrides FROM qa_schedules WHERE id=?`, id)
	s, err := qaScanSchedule(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s, nil
}

type qaRowScanner interface {
	Scan(dest ...interface{}) error
}

func qaScanSchedule(sc qaRowScanner) (*qaSchedule, error) {
	var s qaSchedule
	var enabled int
	var fillEnabled sql.NullInt64
	var aiEnabled sql.NullInt64
	var ruleNMs, aiNMs string
	// overrides 必须用 NullString 兜底。老库 ALTER 补列后 DEFAULT 只保证新写入是 ''，
	// 但重建库 / 人工 UPDATE / 从别处恢复的库都可能留 NULL。裸 string 会在 Scan 阶段直接
	// 报 "converting NULL to string is unsupported"——而这是一条坏行拖垮整个任务列表接口。
	var overrides sql.NullString
	if err := sc.Scan(&s.ID, &s.Name, &s.DatabaseID, &s.CronExpr, &enabled, &ruleNMs, &aiNMs, &s.AIPrompt, &s.ReportTemplateID, &fillEnabled, &aiEnabled, &s.LastRunAt, &s.LastRunStatus, &s.NextRunAt, &s.CreatedBy, &s.CreatedAt, &s.UpdatedAt, &overrides); err != nil {
		return nil, err
	}
	// overrides.String 对 NULL 返回 ""，parseQAReportOverride("") = nil = 纯跟随模板，
	// 因此老库/坏行一起兜住，行为与升级前一致。
	s.ReportOverrides = parseQAReportOverride(overrides.String)
	s.Enabled = enabled != 0
	// 老库补列后可能为 NULL，按默认开启处理
	s.FillEnabled = !fillEnabled.Valid || fillEnabled.Int64 != 0
	// AI 校核总开关默认开启：真正是否调用 AI 由规则自身是否填了复核原则决定
	s.AICheckEnabled = !aiEnabled.Valid || aiEnabled.Int64 != 0
	s.RuleNMs = qaDecodeNMs(ruleNMs)
	s.AICheckNMs = qaDecodeNMs(aiNMs)
	return &s, nil
}

func qaScheduleToMap(s qaSchedule) map[string]interface{} {
	rules := s.RuleNMs
	if rules == nil {
		rules = []string{}
	}
	aiNMs := s.AICheckNMs
	if aiNMs == nil {
		aiNMs = []string{}
	}
	nextRun := s.NextRunAt
	if strings.TrimSpace(nextRun) == "" {
		if spec, err := qaCronParse(s.CronExpr); err == nil {
			if n := spec.Next(time.Now()); !n.IsZero() {
				nextRun = n.Format(time.RFC3339)
			}
		}
	}
	return map[string]interface{}{
		"id":                 s.ID,
		"name":               s.Name,
		"database_id":        s.DatabaseID,
		"cron_expr":          s.CronExpr,
		"cron_text":          qaCronDescribe(s.CronExpr),
		"enabled":            s.Enabled,
		"rule_nms":           rules,
		"ai_check_nms":       aiNMs,
		"ai_prompt":          s.AIPrompt,
		"ai_check_enabled":   s.AICheckEnabled,
		"report_template_id": s.ReportTemplateID,
		"fill_enabled":       s.FillEnabled,
		"report_overrides":   qaReportOverrideMap(s.ReportOverrides),
		"last_run_at":        s.LastRunAt,
		"last_run_status":    s.LastRunStatus,
		"next_run_at":        nextRun,
		"created_by":         s.CreatedBy,
		"created_at":         s.CreatedAt,
	}
}

// ---------------------------------------------------------------------------
// 接口：schedules
// ---------------------------------------------------------------------------

func qaSchedulesGET(w http.ResponseWriter, r *http.Request, username string) {
	_ = r
	_ = username
	schedules, err := qaLoadSchedules(false)
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	list := make([]map[string]interface{}, 0, len(schedules))
	for _, s := range schedules {
		list = append(list, qaScheduleToMap(s))
	}
	qaRespondSuccess(w, map[string]interface{}{"schedules": list})
}

// qaResolveReportOverride 把请求里的 report_overrides 原始 JSON 解析成覆盖层并做校验。
//
// 单独抽成函数是为了让「真实入口类型」可被单测覆盖：handler 里的字段是 json.RawMessage，
// 它既不匹配 string 也不匹配 map[string]interface{}。曾经因为 parseQAReportOverride 的
// type switch 漏了 RawMessage，任务保存时覆盖层被静默丢弃（前端发得对、落库为空、
// 报告照旧按模板出）。这里保持唯一入口，测试直接钉这个函数。
func qaResolveReportOverride(raw json.RawMessage) (*qaReportOverride, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	ov := parseQAReportOverride(raw)
	if err := qaValidateReportOverride(ov); err != nil {
		return nil, err
	}
	return ov, nil
}

func qaSchedulesPOST(w http.ResponseWriter, r *http.Request, username string) {
	var req struct {
		ID               string   `json:"id"`
		Name             string   `json:"name"`
		DatabaseID       string   `json:"database_id"`
		CronExpr         string   `json:"cron_expr"`
		Enabled          *bool    `json:"enabled"`
		RuleNMs          []string `json:"rule_nms"`
		AICheckNMs       []string `json:"ai_check_nms"`
		AIPrompt         string   `json:"ai_prompt"`
		AICheckEnabled   *bool    `json:"ai_check_enabled"`
		ReportTemplateID string   `json:"report_template_id"`
		FillEnabled      *bool    `json:"fill_enabled"`
		// ReportOverrides 任务级「报告内容」覆盖：前端传对象或 JSON 串；传 null = 清空（跟随模板）
		ReportOverrides json.RawMessage `json:"report_overrides"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apiBadRequest(w, "JSON 解析失败")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.DatabaseID = strings.TrimSpace(req.DatabaseID)
	req.CronExpr = strings.TrimSpace(req.CronExpr)

	if req.Name == "" {
		apiInvalidInput(w, "任务名称不能为空")
		return
	}
	if req.DatabaseID == "" {
		apiInvalidInput(w, "请选择目标数据库")
		return
	}
	dataOntologyMu.RLock()
	_, dbOK := dataOntologyDatabases[req.DatabaseID]
	dataOntologyMu.RUnlock()
	if !dbOK {
		apiInvalidInput(w, "目标数据库不存在")
		return
	}
	if len(req.RuleNMs) == 0 {
		apiInvalidInput(w, "请至少勾选一条审核规则")
		return
	}
	spec, err := qaCronParse(req.CronExpr)
	if err != nil {
		apiInvalidInput(w, "cron 表达式无效: "+err.Error())
		return
	}

	// 规则编号统一补零
	ruleNMs := make([]string, 0, len(req.RuleNMs))
	ruleSet := map[string]bool{}
	for _, nm := range req.RuleNMs {
		p := padNM(nm)
		if p == "" || ruleSet[p] {
			continue
		}
		ruleSet[p] = true
		ruleNMs = append(ruleNMs, p)
	}
	if len(ruleNMs) == 0 {
		apiInvalidInput(w, "请至少勾选一条审核规则")
		return
	}
	aiNMs := []string{}
	for _, nm := range req.AICheckNMs {
		p := padNM(nm)
		if !ruleSet[p] {
			apiInvalidInput(w, fmt.Sprintf("AI 校核项 %s 不在审核项范围内", nm))
			return
		}
		aiNMs = append(aiNMs, p)
	}

	rulesJSON, _ := json.Marshal(ruleNMs)
	aiJSON, _ := json.Marshal(aiNMs)
	// 任务级报告覆盖：请求里带了这个键就整体替换（传 {} / null = 清空回「跟随模板」）
	reportOverride, rerr := qaResolveReportOverride(req.ReportOverrides)
	if rerr != nil {
		apiInvalidInput(w, rerr.Error())
		return
	}
	overrideJSON := qaReportOverrideString(reportOverride)
	now := time.Now().Format(time.RFC3339)
	nextRun := ""
	if n := spec.Next(time.Now()); !n.IsZero() {
		nextRun = n.Format(time.RFC3339)
	}

	db, err := openQualityAuditDB()
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}

	if strings.TrimSpace(req.ID) != "" {
		existing, err := qaLoadSchedule(req.ID)
		if err != nil {
			apiInternalError(w, err.Error())
			return
		}
		if existing == nil {
			apiNotFound(w, "定时任务不存在")
			return
		}
		enabled := existing.Enabled
		if req.Enabled != nil {
			enabled = *req.Enabled
		}
		en := 0
		if enabled {
			en = 1
		}
		fillEnabled := existing.FillEnabled
		if req.FillEnabled != nil {
			fillEnabled = *req.FillEnabled
		}
		fe := 0
		if fillEnabled {
			fe = 1
		}
		aiEnabled := existing.AICheckEnabled
		if req.AICheckEnabled != nil {
			aiEnabled = *req.AICheckEnabled
		}
		ae := 0
		if aiEnabled {
			ae = 1
		}
		if _, err := db.Exec(`UPDATE qa_schedules SET name=?, database_id=?, cron_expr=?, enabled=?, rule_nms=?, ai_check_nms=?, ai_prompt=?, report_template_id=?, fill_enabled=?, ai_check_enabled=?, report_overrides=?, next_run_at=?, updated_at=? WHERE id=?`,
			req.Name, req.DatabaseID, req.CronExpr, en, string(rulesJSON), string(aiJSON), req.AIPrompt, strings.TrimSpace(req.ReportTemplateID), fe, ae, overrideJSON, nextRun, now, req.ID); err != nil {
			apiInternalError(w, err.Error())
			return
		}
		out := *existing
		out.Name = req.Name
		out.DatabaseID = req.DatabaseID
		out.CronExpr = req.CronExpr
		out.Enabled = enabled
		out.RuleNMs = ruleNMs
		out.AICheckNMs = aiNMs
		out.AIPrompt = req.AIPrompt
		out.AICheckEnabled = aiEnabled
		out.ReportTemplateID = strings.TrimSpace(req.ReportTemplateID)
		out.FillEnabled = fillEnabled
		out.ReportOverrides = reportOverride
		out.NextRunAt = nextRun
		out.UpdatedAt = now
		qaRespondSuccess(w, map[string]interface{}{"schedule": qaScheduleToMap(out)})
		return
	}

	id := uuid.New().String()
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	en := 0
	if enabled {
		en = 1
	}
	fillEnabled := true
	if req.FillEnabled != nil {
		fillEnabled = *req.FillEnabled
	}
	fe := 0
	if fillEnabled {
		fe = 1
	}
	aiEnabled := true
	if req.AICheckEnabled != nil {
		aiEnabled = *req.AICheckEnabled
	}
	ae := 0
	if aiEnabled {
		ae = 1
	}
	if _, err := db.Exec(`INSERT INTO qa_schedules (id, name, database_id, cron_expr, enabled, rule_nms, ai_check_nms, ai_prompt, report_template_id, fill_enabled, ai_check_enabled, report_overrides, last_run_at, last_run_status, next_run_at, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		id, req.Name, req.DatabaseID, req.CronExpr, en, string(rulesJSON), string(aiJSON), req.AIPrompt, strings.TrimSpace(req.ReportTemplateID), fe, ae, overrideJSON, "", "", nextRun, username, now, now); err != nil {
		apiInternalError(w, err.Error())
		return
	}
	qaRespondSuccess(w, map[string]interface{}{"schedule": qaScheduleToMap(qaSchedule{
		ID:               id,
		Name:             req.Name,
		DatabaseID:       req.DatabaseID,
		CronExpr:         req.CronExpr,
		Enabled:          enabled,
		RuleNMs:          ruleNMs,
		AICheckNMs:       aiNMs,
		AIPrompt:         req.AIPrompt,
		AICheckEnabled:   aiEnabled,
		ReportTemplateID: strings.TrimSpace(req.ReportTemplateID),
		FillEnabled:      fillEnabled,
		ReportOverrides:  reportOverride,
		NextRunAt:        nextRun,
		CreatedBy:        username,
		CreatedAt:        now,
		UpdatedAt:        now,
	})})
}

func qaScheduleDELETE(w http.ResponseWriter, id string, username string) {
	_ = username
	db, err := openQualityAuditDB()
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	res, err := db.Exec(`DELETE FROM qa_schedules WHERE id=?`, id)
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		apiNotFound(w, "定时任务不存在")
		return
	}
	qaRespondSuccess(w, map[string]interface{}{"id": id})
}

// qaScheduleRun 「立即执行」接口：立刻返回 run_id，真正的执行放到后台 goroutine，
// 因此前端不需要再提示「请勿离开页面」，离开后可用 /progress 接口继续看进度。
func qaScheduleRun(w http.ResponseWriter, r *http.Request, id string, username string) {
	_ = r
	s, err := qaLoadSchedule(id)
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	if s == nil {
		apiNotFound(w, "定时任务不存在")
		return
	}
	if !qaTryLockSchedule(s.ID) {
		apiBadRequest(w, "该任务正在执行中，请稍后再试")
		return
	}

	runID := uuid.New().String()
	pr := qaProgressStart(runID, s.ID, s.Name, "manual")

	go func() {
		defer qaUnlockSchedule(s.ID)
		_, status, runErr := qaRunGuarded(s, "manual", username, runID, pr)
		if runErr != nil {
			pr.finish("failed", runErr.Error())
			log.Printf("qa 定时任务「%s」手动执行失败: %v", s.Name, runErr)
			return
		}
		pr.finish(status, "")
		log.Printf("qa 定时任务「%s」手动执行完成（run=%s）", s.Name, runID)
	}()

	qaRespondSuccess(w, map[string]interface{}{
		"run_id":     runID,
		"status":     "running",
		"background": true,
		"message":    "任务已在后台执行，可离开页面",
	})
}

// ---------------------------------------------------------------------------
// 执行（§2.4）
// ---------------------------------------------------------------------------

// qaRunSchedule 同步执行（调度器内部使用），带进度登记。
func qaRunSchedule(s *qaSchedule, triggerType, username string) (string, string, error) {
	if !qaTryLockSchedule(s.ID) {
		return "", "", errQAScheduleBusy
	}
	defer qaUnlockSchedule(s.ID)
	runID := uuid.New().String()
	pr := qaProgressStart(runID, s.ID, s.Name, triggerType)
	_, status, err := qaRunGuarded(s, triggerType, username, runID, pr)
	if err != nil {
		pr.finish("failed", err.Error())
	} else {
		pr.finish(status, "")
	}
	return runID, status, err
}

func qaRunScheduleCore(s *qaSchedule, triggerType, username string) (string, string, error) {
	return qaRunSchedule(s, triggerType, username)
}

// qaRunScheduleCoreWithProgress 执行一次审核：跑规则 → 填报率 → AI 校核 → 报告落盘 → 写 qa_runs。
// 无论成功失败都会写入执行记录。pr 可为 nil（不关心进度时）。

// ---------------------------------------------------------------------------
// 执行超时 / 取消的公共设施
// ---------------------------------------------------------------------------

// qaCtxErr 把 ctx 的结束原因翻译成给用户看的中文文案；ctx 还在跑就返回 nil。
func qaCtxErr(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	switch ctx.Err() {
	case context.DeadlineExceeded:
		return errors.New("执行超时，已自动中止（已完成的规则结果仍可在执行记录中查看）")
	case context.Canceled:
		return errors.New("执行已被取消")
	}
	return nil
}

// qaRunStage 跑一个「可能长时间不返回」的步骤，并给它两道保险：
//  1. stageMS 单步超时（<=0 表示只受整体 ctx 约束）
//  2. 外层 ctx（整体执行超时 / 用户点取消）
//
// 为什么必须在外面再套一层 goroutine，而不是只靠被调用方自己检查 ctx：
// 数据库驱动和 docx 渲染都不保证响应取消（部分国产库驱动完全忽略 ctx），
// 一旦它们不返回，主流程就会永远等下去 —— 那正是用户报的「卡死」。
// 这里选择「放弃等待」而不是「等它跑完」：宁可留一个泄漏的 goroutine，
// 也不能让执行锁和界面状态一直挂着（锁不释放 = 用户再也点不动这个任务）。
//
// 注意：超时分支不得读取 fn 写入的结果变量，否则和仍在跑的 goroutine 形成数据竞争。
func qaRunStage(ctx context.Context, stageMS int64, fn func(context.Context) error) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := qaCtxErr(ctx); err != nil {
		return err
	}
	stageCtx := ctx
	if stageMS > 0 {
		var cancel context.CancelFunc
		stageCtx, cancel = context.WithTimeout(ctx, time.Duration(stageMS)*time.Millisecond)
		defer cancel()
	}
	done := make(chan error, 1)
	go func() { done <- fn(stageCtx) }()
	select {
	case err := <-done:
		return err
	case <-stageCtx.Done():
		if err := qaCtxErr(ctx); err != nil {
			return err
		}
		return fmt.Errorf("步骤超时（超过 %d 秒未返回），已中止", stageMS/1000)
	}
}

// qaRunRecord 一次执行的落库内容。抽出来是因为卡死时执行方可能回不来，
// 只能由看门狗代写一条失败记录 —— 两条路径必须写出同样结构的记录。
type qaRunRecord struct {
	RunID        string
	ScheduleID   string
	ScheduleName string
	TriggerType  string
	DatabaseID   string
	StartedAt    time.Time
	FinishedAt   time.Time
	Status       string
	TotalRules   int
	Passed       int
	Failed       int
	AIFlagged    int
	ReportFile   string
	Summary      string
	Detail       string
	ErrMsg       string
	Username     string
}

// qaWriteRunRecord 写入执行记录并更新任务的「上次执行」。SQL 只有这一份，避免两处漂移。
func qaWriteRunRecord(rec qaRunRecord) {
	duration := rec.FinishedAt.Sub(rec.StartedAt).Milliseconds()
	if duration < 0 {
		duration = 0
	}
	if rec.Summary == "" {
		rec.Summary = "{}"
	}
	if rec.Detail == "" {
		rec.Detail = "[]"
	}
	finished := rec.FinishedAt.Format(time.RFC3339)
	db, err := openQualityAuditDB()
	if err != nil {
		log.Printf("qa 写执行记录失败（打开元数据库）: %v", err)
		return
	}
	_, _ = db.Exec(`INSERT INTO qa_runs (id, schedule_id, schedule_name, trigger_type, database_id, started_at, finished_at, duration_ms, status, total_rules, passed, failed, ai_flagged, report_file, summary, detail, error, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		rec.RunID, rec.ScheduleID, rec.ScheduleName, rec.TriggerType, rec.DatabaseID,
		rec.StartedAt.Format(time.RFC3339), finished, duration, rec.Status,
		rec.TotalRules, rec.Passed, rec.Failed, rec.AIFlagged, rec.ReportFile,
		rec.Summary, rec.Detail, rec.ErrMsg, rec.Username)
	_, _ = db.Exec(`UPDATE qa_schedules SET last_run_at=?, last_run_status=?, updated_at=? WHERE id=?`,
		finished, rec.Status, finished, rec.ScheduleID)
}

// qaWatchdog 独立看门狗：兜住「连 qaRunStage 都回不来」的极端情况。
//
// 为什么在整体 ctx 超时之外还要这一层：qaRunStage 能兜住「某一步不返回」，
// 但兜不住执行 goroutine 自己卡在锁、元数据库打开、日志写入这类地方 ——
// 那时整体 ctx 到期也没人处理，任务永久锁死。看门狗是最后一个保险：
// 到点就宣布失败、释放执行锁、代写一条执行记录，让用户至少能重新点执行。
//
// 返回的 stop 必须在执行结束时调用（正常路径下看门狗就什么都没做）。
func qaWatchdog(runID string, s *qaSchedule, pr *qaRunProgress, triggerType, username string, startedAt time.Time) func() {
	stop := make(chan struct{})
	// 宽限期比整体超时再长一点：正常情况下整体 ctx 会先中止并落库，
	// 看门狗只在「连那一步都没走到」时才出手，避免抢跑把正常执行判成失败。
	grace := time.Duration(qaRunTimeoutMS()+qaReportTimeoutMS()+60*1000) * time.Millisecond
	go func() {
		timer := time.NewTimer(grace)
		defer timer.Stop()
		select {
		case <-stop:
			return
		case <-timer.C:
		}
		// 到这里说明执行方已经彻底失联。
		msg := fmt.Sprintf("执行超过 %d 分钟没有任何响应，已强制终止（进程内看门狗）", grace/time.Minute)
		pr.fail(msg)
		qaUnlockSchedule(s.ID)
		log.Printf("qa 看门狗：run=%s 任务「%s」超时无响应，已强制终止并释放执行锁", runID, s.Name)
		if pr.tryMarkRecorded() {
			qaWriteRunRecord(qaRunRecord{
				RunID:        runID,
				ScheduleID:   s.ID,
				ScheduleName: s.Name,
				TriggerType:  triggerType,
				DatabaseID:   s.DatabaseID,
				StartedAt:    startedAt,
				FinishedAt:   time.Now(),
				Status:       "failed",
				Summary:      "{}",
				Detail:       "[]",
				ErrMsg:       msg,
				Username:     username,
			})
		}
	}()
	var once sync.Once
	return func() { once.Do(func() { close(stop) }) }
}

// qaRunGuarded 是执行入口的统一包装：挂上整体超时、注册取消、登记数据库、起看门狗。
//
// 为什么统一在这里做：手动执行和定时执行必须有一模一样的行为 ——
// 以前手动入口有进度、定时入口没有，取消更是两边都没有，用户遇到卡死时完全没辙。
func qaRunGuarded(s *qaSchedule, triggerType, username, runID string, pr *qaRunProgress) (string, string, error) {
	startedAt := time.Now()
	runCtx, cancel := context.WithTimeout(context.Background(), time.Duration(qaRunTimeoutMS())*time.Millisecond)
	defer cancel()
	pr.setDatabase(s.DatabaseID)
	// 把取消函数登记到这次执行的进度对象上，前端点「取消」才真的能停下来。
	pr.setCancel(cancel)
	defer pr.clearCancel()
	stopWatchdog := qaWatchdog(runID, s, pr, triggerType, username, startedAt)
	defer stopWatchdog()
	return qaRunScheduleCoreWithProgress(runCtx, s, triggerType, username, runID, pr)
}

// ctx 用来兜住「卡死」：整体超时与用户点取消都在这里生效，每个阶段结束都检查一次。
// 历史教训：这个函数原本没有任何超时/取消入口，一旦某一步不返回（数据库驱动忽略 ctx、
// docx 渲染卡住…），执行锁就永远不会释放，界面上却还是「正在跑最后一项」——
// 用户看到的现象就是卡死又停不掉，只能重启进程。
func qaRunScheduleCoreWithProgress(ctx context.Context, s *qaSchedule, triggerType, username, runID string, pr *qaRunProgress) (string, string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	startedAt := time.Now()
	pr.setPhase("prepare", "准备执行")

	status := "success"
	runErrMsg := ""
	reportFile := ""
	passed, failed, aiFlagged, aiReviewed := 0, 0, 0, 0
	summaryMap := map[string]interface{}{"total_rules": 0, "passed": 0, "failed": 0, "ai_flagged": 0}
	detailJSON := []byte("[]")

	dataOntologyMu.RLock()
	dbConfig, dbOK := dataOntologyDatabases[s.DatabaseID]
	dataOntologyMu.RUnlock()

	// abortErr 只在「整体超时 / 用户取消 / 单步超时」时被赋值。
	// 这类错误必须硬中止：后面的步骤已经没有意义，继续跑只会让「卡死」看起来更像正常执行。
	var abortErr error

	// runBody 把执行主干包成闭包，好处是每个阶段都能用一句 return 硬中止，
	// 不必在 switch 里层层面包、也不必用 goto。
	runBody := func() {
		dialect := normalizeQualityDialect(dbConfig.Type)
		pr.setPhase("connect", "连接数据库")
		// 先把规则条数报上去：数据库连接慢的时候进度条不至于一直显示 0/0
		pr.addTotal(len(s.RuleNMs))
		var targetDB *sql.DB
		// 连接也放进 qaRunStage：连接池满 / 网络半开时，建立连接本身就能卡住整个任务。
		if err := qaRunStage(ctx, qaConnectTimeoutMS(), func(c context.Context) error {
			db, derr := getDBFromPool(dbConfig)
			if derr != nil {
				return fmt.Errorf("连接失败: %w", derr)
			}
			targetDB = db
			return nil
		}); err != nil {
			status = "failed"
			runErrMsg = err.Error()
			abortErr = err
			return
		}

		pr.setPhase("rules", "执行审核规则")
		var ruleResults []map[string]interface{}
		var ruleExecErr error
		if err := qaRunStage(ctx, 0, func(c context.Context) error {
			res, p, f, exErr := qaExecuteRules(c, s.DatabaseID, targetDB, dialect, s.RuleNMs, username, startedAt, func(nm, name string) {
				if name == "" {
					name = nm
				}
				pr.tick(name)
			})
			// 单条规则报错不算硬中止（旧行为：把错误写进报告，继续往下走），
			// 但要记下来，最后作为 runErrMsg 落库。
			ruleResults, passed, failed, ruleExecErr = res, p, f, exErr
			return nil
		}); err != nil {
			status = "failed"
			runErrMsg = err.Error()
			abortErr = err
			return
		}
		if ruleExecErr != nil {
			status = "failed"
			runErrMsg = ruleExecErr.Error()
			pr.fail(ruleExecErr.Error())
		}
		if ruleResults == nil {
			ruleResults = []map[string]interface{}{}
		}

		// 填报率统计（与手动审核保持一致，报告里才会有项/记录填报率）。
		// fill_enabled=0 的定时任务跳过统计，报告里会标注「本次未执行填报率审核」。
		itemStats := []map[string]interface{}{}
		recStats := []map[string]interface{}{}
		if s.FillEnabled {
			metaDB, _ := openQualityAuditDB()
			itemRows, _ := scanFillTable(metaDB, `SELECT TABLE_NAME, FIELD_NAME, NUMERATOR, DENOMINATOR, CHECKED, UPDATED_AT FROM item_fill_rate WHERE CHECKED = 1`)
			recRows, _ := scanFillTable(metaDB, `SELECT TABLE_NAME, FIELD_NAME, NUMERATOR, DENOMINATOR, CHECKED, UPDATED_AT FROM record_fill_rate WHERE CHECKED = 1`)
			pr.setPhase("fill", "统计填报率")
			pr.addTotal(len(itemRows) + len(recRows))
			if err := qaRunStage(ctx, 0, func(c context.Context) error {
				itemStats = runFillStatsWithProgress(c, targetDB, dialect, itemRows, func() { pr.tick("") })
				recStats = runFillStatsWithProgress(c, targetDB, dialect, recRows, func() { pr.tick("") })
				return nil
			}); err != nil {
				status = "failed"
				runErrMsg = err.Error()
				abortErr = err
				return
			}
		}

		// AI 复核：只对「本次未通过且规则自带复核原则」的规则；总开关在任务上
		pr.setPhase("ai", "AI 复核")
		var aiMap map[string]map[string]interface{}
		var aiModel, aiSkipReason string
		if err := qaRunStage(ctx, 0, func(c context.Context) error {
			aiMap, aiModel, aiSkipReason = qaAIVerifyWithProgress(c, ruleResults, s.AICheckEnabled, pr)
			return nil
		}); err != nil {
			status = "failed"
			runErrMsg = err.Error()
			abortErr = err
			return
		}
		for _, row := range ruleResults {
			nm, _ := row["nm"].(string)
			ai, ok := aiMap[nm]
			if !ok {
				continue
			}
			row["ai_misjudged"] = ai["misjudged"]
			row["ai_confidence"] = ai["confidence"]
			row["ai_reason"] = ai["reason"]
			row["ai_suggestion"] = ai["suggestion"]
			row["ai_need_human"] = true
			aiReviewed++
			if mis, _ := ai["misjudged"].(bool); mis {
				aiFlagged++
			}
		}

		if b, err := json.Marshal(ruleResults); err == nil {
			detailJSON = b
		}

		// 生成报告并落盘。
		// 单独给一个上限（默认 3 分钟）：用户报的卡死就高度疑似发生在这里 ——
		// docx 模板渲染 + 写入本地文件，出问题时既不报错也不返回。
		pr.setPhase("report", "生成报告")
		pr.addTotal(1)
		if err := qaRunStage(ctx, qaReportTimeoutMS(), func(c context.Context) error {
			doc, derr := qaBuildReportDocxSel(qaNormalizeAuditJSON(map[string]interface{}{
				"database_id":       s.DatabaseID,
				"database_type":     dbConfig.Type,
				"dialect":           dialect,
				"started_at":        startedAt.Format(time.RFC3339),
				"ai_model":          aiModel,
				"rules":             ruleResults,
				"item_fill_rates":   itemStats,
				"record_fill_rates": recStats,
				"fill_skipped":      !s.FillEnabled,
				"summary": map[string]interface{}{
					"total_rules": passed + failed,
					"passed":      passed,
					"failed":      failed,
				},
			}), s.ReportTemplateID, qaScheduleReportSelection(s))
			if derr != nil {
				// 保留旧行为：报告生成失败不改变执行状态，只是没有报告文件。
				log.Printf("qa 报告生成失败（run=%s）: %v", runID, derr)
				return nil
			}
			if err := os.MkdirAll(qaReportsDir(), 0755); err != nil {
				return nil
			}
			name := runID + ".docx"
			if werr := os.WriteFile(filepath.Join(qaReportsDir(), name), doc, 0644); werr == nil {
				reportFile = name
			}
			return nil
		}); err != nil {
			status = "failed"
			runErrMsg = err.Error()
			abortErr = err
			return
		}
		pr.tick("报告已生成")

		summaryMap = map[string]interface{}{
			"total_rules": passed + failed,
			"passed":      passed,
			"failed":      failed,
			"ai_flagged":  aiFlagged,
			"ai_reviewed": aiReviewed,
		}
		if aiModel != "" {
			summaryMap["ai_model"] = aiModel
		}
		if aiSkipReason != "" {
			summaryMap["ai_skipped"] = true
			summaryMap["ai_skip_reason"] = aiSkipReason
		} else {
			summaryMap["ai_skipped"] = false
		}
	}

	switch {
	case !dbOK:
		status = "failed"
		runErrMsg = "目标数据库不存在"
		abortErr = errors.New("目标数据库不存在")
	default:
		runBody()
	}

	if abortErr != nil {
		status = "failed"
		runErrMsg = abortErr.Error()
		pr.fail(runErrMsg)
	}

	finishedAt := time.Now()
	summaryJSON, _ := json.Marshal(summaryMap)

	// 落库前先抢「写入资格」：卡死时看门狗可能已经代写过一条失败记录，
	// 这种情况下执行方（僵尸 goroutine）恢复后不得再写第二条，否则一次执行两条记录。
	if pr.tryMarkRecorded() {
		qaWriteRunRecord(qaRunRecord{
			RunID:        runID,
			ScheduleID:   s.ID,
			ScheduleName: s.Name,
			TriggerType:  triggerType,
			DatabaseID:   s.DatabaseID,
			StartedAt:    startedAt,
			FinishedAt:   finishedAt,
			Status:       status,
			TotalRules:   passed + failed,
			Passed:       passed,
			Failed:       failed,
			AIFlagged:    aiFlagged,
			ReportFile:   reportFile,
			Summary:      string(summaryJSON),
			Detail:       string(detailJSON),
			ErrMsg:       runErrMsg,
			Username:     username,
		})
	}

	if runErrMsg != "" {
		return runID, status, errors.New(runErrMsg)
	}
	return runID, status, nil
}

// qaNormalizeAuditJSON 通过 JSON 往返把 []map 等类型规范化为 []interface{}，
// 因为 buildQualityAuditDocx 内部按 []interface{} 断言 rules。
func qaNormalizeAuditJSON(m map[string]interface{}) map[string]interface{} {
	b, err := json.Marshal(m)
	if err != nil {
		return m
	}
	var out map[string]interface{}
	if err := json.Unmarshal(b, &out); err != nil {
		return m
	}
	return out
}

// ---------------------------------------------------------------------------
// AI 校核（§2.4）
// ---------------------------------------------------------------------------

// qaPickLLMModel 选第一个已启用的 llm 模型（确定性：按创建时间/ID 排序）。
// qaPickLLMModel 选取 AI 校核所用的大模型：
//  1. 优先使用 llm_models 中已启用的 LLM 模型（创建时间最早者优先，保持既有行为）
//  2. 未单独配置时，回退复用「智能助手」的大模型配置（ai_config）
func qaPickLLMModel() *LLMModelConfig {
	dataOntologyMu.RLock()
	defer dataOntologyMu.RUnlock()
	var cands []*LLMModelConfig
	for _, m := range llmModels {
		if m == nil || !m.Enabled {
			continue
		}
		if strings.TrimSpace(m.URL) == "" {
			continue
		}
		if t := strings.ToLower(strings.TrimSpace(m.Type)); t != "" && t != "llm" {
			continue
		}
		cp := *m
		cands = append(cands, &cp)
	}
	if len(cands) == 0 {
		return qaAssistantLLMModel()
	}
	sort.Slice(cands, func(i, j int) bool {
		if cands[i].CreatedAt != cands[j].CreatedAt {
			return cands[i].CreatedAt < cands[j].CreatedAt
		}
		return cands[i].ID < cands[j].ID
	})
	return cands[0]
}

// qaAssistantLLMModel 复用「智能助手」的大模型配置（ai_config）。
// 调用方必须已持有 dataOntologyMu 读锁。
func qaAssistantLLMModel() *LLMModelConfig {
	cfg := dataOntologyAIConfig
	if cfg == nil {
		return nil
	}
	url := strings.TrimSpace(cfg.URL)
	key := strings.TrimSpace(cfg.APIKey)
	model := strings.TrimSpace(cfg.Model)
	if url == "" || key == "" || model == "" {
		return nil
	}
	return &LLMModelConfig{
		ID:          "assistant-ai-config",
		Name:        model,
		Type:        "llm",
		Provider:    qaGuessLLMProvider(url),
		URL:         url,
		APIKey:      key,
		Model:       model,
		Description: "复用智能助手模型配置（ai_config）",
		Enabled:     true,
	}
}

// qaGuessLLMProvider 从 URL 猜测 provider（仅用于展示，不影响调用）
func qaGuessLLMProvider(url string) string {
	u := strings.ToLower(url)
	switch {
	case strings.Contains(u, "generativelanguage.googleapis.com"):
		return "gemini"
	case strings.Contains(u, "anthropic.com"):
		return "anthropic"
	default:
		return "openai"
	}
}

// qaAIVerify 对 aiNMs 中本次未通过的规则逐条做 AI 误判判断。
// 返回 nm → {misjudged,confidence,reason,suggestion}、使用的模型名、跳过原因（空=未跳过）。
// qaAIReviewTargets 取「本次需要 AI 复核」的规则：
// 只有 ①本次未通过 ②规则自带 AI 复核原则（ai_review_prompt 非空）两条都满足才复核。
func qaAIReviewTargets(ruleResults []map[string]interface{}) []map[string]interface{} {
	out := []map[string]interface{}{}
	for _, row := range ruleResults {
		if p, ok := row["passed"].(bool); ok && p {
			continue
		}
		if strings.TrimSpace(ifaceString(row["ai_review_prompt"])) == "" {
			continue
		}
		out = append(out, row)
	}
	return out
}

func ifaceString(v interface{}) string {
	s, _ := v.(string)
	return s
}

// qaAIVerifyWithProgress 对「未通过且自带复核原则」的规则逐条 AI 复核。
// enabled=false 时直接跳过（连模型都不挑，避免无谓开销）。
// ctx 用于用户取消 / 整体超时：AI 复核是逐条串行的，每条都检查一次，避免「点了取消还在等模型」。
// 返回：nm → 复核结论、使用的模型名、跳过原因。
func qaAIVerifyWithProgress(ctx context.Context, ruleResults []map[string]interface{}, enabled bool, pr *qaRunProgress) (map[string]map[string]interface{}, string, string) {
	if ctx == nil {
		ctx = context.Background()
	}
	out := map[string]map[string]interface{}{}
	if !enabled {
		return out, "", "本次未启用 AI 校核"
	}
	targets := qaAIReviewTargets(ruleResults)
	if len(targets) == 0 {
		return out, "", "本次没有需要 AI 复核的规则（规则未填写 AI 复核原则）"
	}
	cfg := qaPickLLMModel()
	if cfg == nil {
		return out, "", "未配置可用的大模型（llm_models 中无已启用的 llm 模型，且「智能助手」未配置模型）"
	}
	modelName := strings.TrimSpace(cfg.Model)
	if modelName == "" {
		modelName = cfg.Name
	}

	if pr != nil {
		pr.addTotal(len(targets))
	}

	const systemPrompt = "你是数据质量审核专家。请严格按照用户给定的复核原则，判断这条 SQL 审核规则的失败结果是否属于误判，并给出结论与修改建议。"
	first := true
	for _, row := range targets {
		if ctx.Err() != nil {
			// 取消/超时：不再继续喂模型，剩下的规则留空（上层按 ctx 错误收尾）
			break
		}
		nm, _ := row["nm"].(string)
		if nm == "" {
			continue
		}
		if !first {
			time.Sleep(300 * time.Millisecond)
		}
		first = false

		name, _ := row["name"].(string)
		if name == "" {
			name = nm
		}
		if pr != nil {
			pr.tick("AI 复核：" + name)
		}

		prompt := ifaceString(row["ai_review_prompt"])
		content, err := qaCallLLMChat(cfg, systemPrompt, qaBuildAIVerifyPrompt(row, prompt), 30*time.Second)
		if err != nil {
			out[nm] = map[string]interface{}{
				"misjudged":  false,
				"confidence": 0.0,
				"reason":     "AI 调用失败: " + err.Error(),
				"suggestion": "",
			}
			continue
		}
		mis, conf, reason, suggestion, _ := qaParseAIResult(content)
		out[nm] = map[string]interface{}{
			"misjudged":  mis,
			"confidence": conf,
			"reason":     reason,
			"suggestion": suggestion,
		}
	}
	return out, modelName, ""
}

// qaAttachAIReview 把 AI 复核结论写回规则结果行；返回复核条数与模型名、跳过原因。
func qaAttachAIReview(ruleResults []map[string]interface{}, enabled bool) (int, string, string) {
	aiMap, aiModel, skipReason := qaAIVerifyWithProgress(context.Background(), ruleResults, enabled, nil)
	reviewed := 0
	for _, row := range ruleResults {
		nm, _ := row["nm"].(string)
		ai, ok := aiMap[nm]
		if !ok {
			continue
		}
		row["ai_misjudged"] = ai["misjudged"]
		row["ai_confidence"] = ai["confidence"]
		row["ai_reason"] = ai["reason"]
		row["ai_suggestion"] = ai["suggestion"]
		// AI 结论只是参考，必须由人类专家最终校核
		row["ai_need_human"] = true
		reviewed++
	}
	return reviewed, aiModel, skipReason
}

func qaBuildAIVerifyPrompt(row map[string]interface{}, aiPrompt string) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "规则编号：%v\n", row["nm"])
	fmt.Fprintf(&sb, "规则名称：%v\n", row["name"])
	fmt.Fprintf(&sb, "规则类别：%v\n", row["category"])
	fmt.Fprintf(&sb, "规则原始 SQL：\n%v\n", row["sql_original"])
	fmt.Fprintf(&sb, "本次实际执行 SQL：\n%v\n", row["sql_executed"])
	fmt.Fprintf(&sb, "本次违规行数：%v\n", row["violation_count"])
	if sr := ifaceSlice(row["sample_rows"]); len(sr) > 0 {
		n := len(sr)
		if n > 5 {
			n = 5
		}
		samples := make([]string, 0, n)
		for _, item := range sr[:n] {
			if b, err := json.Marshal(item); err == nil {
				samples = append(samples, string(b))
			}
		}
		if len(samples) > 0 {
			sb.WriteString("违规样本（前若干行）：\n")
			sb.WriteString(strings.Join(samples, "\n"))
			sb.WriteString("\n")
		}
	}
	if strings.TrimSpace(aiPrompt) != "" {
		sb.WriteString("\n复核原则（必须按此原则判断）：\n")
		sb.WriteString(strings.TrimSpace(aiPrompt))
		sb.WriteString("\n")
	}
	sb.WriteString("\n请只输出 JSON，不要输出其它内容：{\"misjudged\": true 或 false, \"confidence\": 0.0-1.0, \"reason\": \"判断理由\", \"suggestion\": \"规则修改建议\"}")
	return sb.String()
}

func qaCallLLMChat(cfg *LLMModelConfig, systemPrompt, userPrompt string, timeout time.Duration) (string, error) {
	modelName := strings.TrimSpace(cfg.Model)
	if modelName == "" {
		modelName = cfg.Name
	}
	payload, err := json.Marshal(map[string]interface{}{
		"model": modelName,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userPrompt},
		},
		"temperature": 0.1,
		"chat_type":   "normal",
	})
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, getAIEndpoint(cfg.URL), bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if k := strings.TrimSpace(cfg.APIKey); k != "" {
		req.Header.Set("Authorization", "Bearer "+k)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, qaTruncate(strings.TrimSpace(string(raw)), 300))
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", err
	}
	choices, _ := parsed["choices"].([]interface{})
	if len(choices) == 0 {
		return "", errors.New("响应缺少 choices")
	}
	c0, _ := choices[0].(map[string]interface{})
	msg, _ := c0["message"].(map[string]interface{})
	content, _ := msg["content"].(string)
	if strings.TrimSpace(content) == "" {
		return "", errors.New("响应内容为空")
	}
	return content, nil
}

func qaExtractJSONObject(s string) string {
	i := strings.Index(s, "{")
	j := strings.LastIndex(s, "}")
	if i >= 0 && j > i {
		return s[i : j+1]
	}
	return ""
}

// qaParseAIResult 容错解析模型输出；解析失败时把原文保留为 reason。
func qaParseAIResult(content string) (misjudged bool, confidence float64, reason, suggestion string, ok bool) {
	obj := qaExtractJSONObject(content)
	if obj == "" {
		return false, 0, qaTruncate(strings.TrimSpace(content), 2000), "", false
	}
	var r struct {
		Misjudged  *bool    `json:"misjudged"`
		Confidence *float64 `json:"confidence"`
		Reason     string   `json:"reason"`
		Suggestion string   `json:"suggestion"`
	}
	if err := json.Unmarshal([]byte(obj), &r); err != nil {
		return false, 0, qaTruncate(strings.TrimSpace(content), 2000), "", false
	}
	if r.Misjudged != nil {
		misjudged = *r.Misjudged
	}
	if r.Confidence != nil {
		confidence = *r.Confidence
	}
	if confidence < 0 {
		confidence = 0
	}
	if confidence > 1 {
		confidence = 1
	}
	return misjudged, confidence, r.Reason, r.Suggestion, true
}

func qaTruncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// ---------------------------------------------------------------------------
// 接口：runs
// ---------------------------------------------------------------------------

func qaRunsGET(w http.ResponseWriter, r *http.Request, username string) {
	_ = username
	q := r.URL.Query()
	scheduleID := strings.TrimSpace(q.Get("schedule_id"))
	statusFilter := strings.TrimSpace(q.Get("status"))
	limit := 50
	if v := strings.TrimSpace(q.Get("limit")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}

	db, err := openQualityAuditDB()
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	sqlText := `SELECT id, schedule_id, schedule_name, trigger_type, database_id, started_at, duration_ms, status, total_rules, passed, failed, ai_flagged, report_file FROM qa_runs`
	var where []string
	var args []interface{}
	if scheduleID != "" {
		where = append(where, `schedule_id=?`)
		args = append(args, scheduleID)
	}
	if statusFilter != "" {
		where = append(where, `status=?`)
		args = append(args, statusFilter)
	}
	if len(where) > 0 {
		sqlText += ` WHERE ` + strings.Join(where, ` AND `)
	}
	sqlText += ` ORDER BY started_at DESC LIMIT ?`
	args = append(args, limit)

	rows, err := db.Query(sqlText, args...)
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	defer rows.Close()
	list := []map[string]interface{}{}
	for rows.Next() {
		var id, schedID, schedName, triggerType, databaseID, startedAt, status, reportFile string
		var duration int64
		var totalRules, passed, failed, aiFlagged int
		if err := rows.Scan(&id, &schedID, &schedName, &triggerType, &databaseID, &startedAt, &duration, &status, &totalRules, &passed, &failed, &aiFlagged, &reportFile); err != nil {
			apiInternalError(w, err.Error())
			return
		}
		list = append(list, map[string]interface{}{
			"id":            id,
			"schedule_id":   schedID,
			"schedule_name": schedName,
			"trigger_type":  triggerType,
			"database_id":   databaseID,
			"started_at":    startedAt,
			"duration_ms":   duration,
			"status":        status,
			"total_rules":   totalRules,
			"passed":        passed,
			"failed":        failed,
			"ai_flagged":    aiFlagged,
			"has_report":    strings.TrimSpace(reportFile) != "",
		})
	}
	if err := rows.Err(); err != nil {
		apiInternalError(w, err.Error())
		return
	}

	// 正在后台执行的任务还没写 qa_runs，这里补在列表最前面，界面上显示「进行中 + 进度」。
	// 只在没有按状态过滤（或过滤 running）时补。
	if statusFilter == "" || statusFilter == "running" {
		active := qaProgressActive()
		prepended := []map[string]interface{}{}
		for _, pr := range active {
			if scheduleID != "" && asString(pr["schedule_id"]) != scheduleID {
				continue
			}
			prepended = append(prepended, map[string]interface{}{
				"id":            pr["run_id"],
				"schedule_id":   pr["schedule_id"],
				"schedule_name": pr["schedule_name"],
				"trigger_type":  pr["trigger_type"],
				"database_id":   "",
				"started_at":    pr["started_at"],
				"duration_ms":   pr["elapsed_ms"],
				"status":        "running",
				"running":       true,
				"progress":      pr,
				"total_rules":   0,
				"passed":        0,
				"failed":        0,
				"ai_flagged":    0,
				"has_report":    false,
			})
		}
		list = append(prepended, list...)
	}

	qaRespondSuccess(w, map[string]interface{}{"runs": list})
}

// qaRunProgressGET 查询某次执行（含后台执行中）的进度。
func qaRunProgressGET(w http.ResponseWriter, runID, username string) {
	_ = username
	if p := qaProgressGet(runID); p != nil {
		qaRespondSuccess(w, map[string]interface{}{"progress": p.snapshot()})
		return
	}
	// 内存里没有：可能早已结束、或服务重启过 —— 从 qa_runs 兜底返回终态
	if db, err := openQualityAuditDB(); err == nil {
		var status, errMsg string
		var duration int64
		var startedAt, finishedAt sql.NullString
		row := db.QueryRow(`SELECT status, COALESCE(error,''), COALESCE(started_at,''), COALESCE(finished_at,''), COALESCE(duration_ms,0) FROM qa_runs WHERE id=?`, runID)
		if err := row.Scan(&status, &errMsg, &startedAt, &finishedAt, &duration); err == nil {
			qaRespondSuccess(w, map[string]interface{}{"progress": map[string]interface{}{
				"run_id":     runID,
				"status":     status,
				"finished":   true,
				"percent":    100.0,
				"eta_ms":     int64(0),
				"elapsed_ms": duration,
				"error":      errMsg,
				"started_at": startedAt.String,
			}})
			return
		}
	}
	apiNotFound(w, "执行记录不存在或进度已过期")
}

// qaProgressActiveGET 列出当前所有后台执行中的任务（页面刷新后靠它恢复进度条）。
func qaProgressActiveGET(w http.ResponseWriter, username string) {
	_ = username
	items := qaProgressActive()
	qaRespondSuccess(w, map[string]interface{}{
		"active": items,
		"count":  len(items),
	})
}

func qaRunGET(w http.ResponseWriter, r *http.Request, id string, username string) {
	_ = r
	_ = username
	db, err := openQualityAuditDB()
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	var runID, schedID, schedName, triggerType, databaseID, startedAt, finishedAt, status, reportFile, summaryRaw, detailRaw, errMsg, createdBy string
	var duration int64
	var totalRules, passed, failed, aiFlagged int
	err = db.QueryRow(`SELECT id, schedule_id, schedule_name, trigger_type, database_id, started_at, finished_at, duration_ms, status, total_rules, passed, failed, ai_flagged, report_file, summary, detail, error, created_by FROM qa_runs WHERE id=?`, id).
		Scan(&runID, &schedID, &schedName, &triggerType, &databaseID, &startedAt, &finishedAt, &duration, &status, &totalRules, &passed, &failed, &aiFlagged, &reportFile, &summaryRaw, &detailRaw, &errMsg, &createdBy)
	if err == sql.ErrNoRows {
		apiNotFound(w, "执行记录不存在")
		return
	}
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}

	var detail interface{} = []interface{}{}
	if strings.TrimSpace(detailRaw) != "" {
		var parsed interface{}
		if json.Unmarshal([]byte(detailRaw), &parsed) == nil {
			detail = parsed
		}
	}
	var summary interface{} = map[string]interface{}{}
	if strings.TrimSpace(summaryRaw) != "" {
		var parsed interface{}
		if json.Unmarshal([]byte(summaryRaw), &parsed) == nil {
			summary = parsed
		}
	}

	qaRespondSuccess(w, map[string]interface{}{"run": map[string]interface{}{
		"id":            runID,
		"schedule_id":   schedID,
		"schedule_name": schedName,
		"trigger_type":  triggerType,
		"database_id":   databaseID,
		"started_at":    startedAt,
		"finished_at":   finishedAt,
		"duration_ms":   duration,
		"status":        status,
		"total_rules":   totalRules,
		"passed":        passed,
		"failed":        failed,
		"ai_flagged":    aiFlagged,
		"has_report":    strings.TrimSpace(reportFile) != "",
		"summary":       summary,
		"detail":        detail,
		"error":         errMsg,
		"created_by":    createdBy,
	}})
}

func qaRunReportGET(w http.ResponseWriter, r *http.Request, id string, username string) {
	_ = r
	_ = username
	db, err := openQualityAuditDB()
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	var reportFile string
	err = db.QueryRow(`SELECT report_file FROM qa_runs WHERE id=?`, id).Scan(&reportFile)
	if err == sql.ErrNoRows {
		apiNotFound(w, "执行记录不存在")
		return
	}
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	if strings.TrimSpace(reportFile) == "" {
		apiNotFound(w, "该次执行未生成报告")
		return
	}
	// filepath.Base 防止路径穿越
	path := filepath.Join(qaReportsDir(), filepath.Base(reportFile))
	f, err := os.Open(path)
	if err != nil {
		apiNotFound(w, "报告文件不存在")
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="qa-run-%s.docx"`, filepath.Base(id)))
	_, _ = io.Copy(w, f)
}

// ---------------------------------------------------------------------------
// 接口：overview
// ---------------------------------------------------------------------------

func qaOverviewGET(w http.ResponseWriter, r *http.Request, username string) {
	_ = r
	_ = username
	db, err := openQualityAuditDB()
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}

	schedulesTotal, schedulesEnabled := 0, 0
	_ = db.QueryRow(`SELECT COUNT(*) FROM qa_schedules`).Scan(&schedulesTotal)
	_ = db.QueryRow(`SELECT COUNT(*) FROM qa_schedules WHERE enabled=1`).Scan(&schedulesEnabled)

	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	cutoff := now.AddDate(0, 0, -30).Format(time.RFC3339)

	type runAgg struct {
		startedAt string
		status    string
		passed    int
		failed    int
		aiFlagged int
		detail    string
	}
	var runs []runAgg
	rows, err := db.Query(`SELECT started_at, status, passed, failed, ai_flagged, detail FROM qa_runs WHERE started_at >= ? ORDER BY started_at DESC`, cutoff)
	if err != nil {
		apiInternalError(w, err.Error())
		return
	}
	for rows.Next() {
		var a runAgg
		if err := rows.Scan(&a.startedAt, &a.status, &a.passed, &a.failed, &a.aiFlagged, &a.detail); err != nil {
			rows.Close()
			apiInternalError(w, err.Error())
			return
		}
		runs = append(runs, a)
	}
	rows.Close()

	// 近 14 天趋势，补齐无数据日期
	daily := make([]map[string]interface{}, 0, 14)
	dayIndex := map[string]int{}
	for i := 13; i >= 0; i-- {
		d := today.AddDate(0, 0, -i)
		key := d.Format("2006-01-02")
		dayIndex[key] = len(daily)
		daily = append(daily, map[string]interface{}{"date": key, "passed": 0, "failed": 0})
	}

	runsToday := 0
	success30 := 0
	aiFlagged30 := 0
	type ruleAgg struct {
		nm    string
		name  string
		count int
	}
	ruleCounts := map[string]*ruleAgg{}

	for _, a := range runs {
		aiFlagged30 += a.aiFlagged
		if a.status == "success" {
			success30++
		}
		day := ""
		if t, err := time.Parse(time.RFC3339, a.startedAt); err == nil {
			day = t.Format("2006-01-02")
			if day == today.Format("2006-01-02") {
				runsToday++
			}
		}
		if idx, ok := dayIndex[day]; ok {
			daily[idx]["passed"] = daily[idx]["passed"].(int) + a.passed
			daily[idx]["failed"] = daily[idx]["failed"].(int) + a.failed
		}
		if strings.TrimSpace(a.detail) == "" {
			continue
		}
		var entries []interface{}
		if json.Unmarshal([]byte(a.detail), &entries) != nil {
			continue
		}
		for _, e := range entries {
			m, ok := e.(map[string]interface{})
			if !ok {
				continue
			}
			p, ok := m["passed"].(bool)
			if !ok || p {
				continue
			}
			nm, _ := m["nm"].(string)
			if nm == "" {
				continue
			}
			agg, ok := ruleCounts[nm]
			if !ok {
				name, _ := m["name"].(string)
				agg = &ruleAgg{nm: nm, name: name}
				ruleCounts[nm] = agg
			}
			agg.count++
		}
	}

	successRate := 0.0
	if len(runs) > 0 {
		successRate = float64(success30) / float64(len(runs)) * 100
		successRate = float64(int(successRate*10+0.5)) / 10
	}

	top := make([]*ruleAgg, 0, len(ruleCounts))
	for _, agg := range ruleCounts {
		top = append(top, agg)
	}
	sort.Slice(top, func(i, j int) bool {
		if top[i].count != top[j].count {
			return top[i].count > top[j].count
		}
		return top[i].nm < top[j].nm
	})
	if len(top) > 5 {
		top = top[:5]
	}
	topRules := make([]map[string]interface{}, 0, len(top))
	for _, agg := range top {
		topRules = append(topRules, map[string]interface{}{
			"nm":    agg.nm,
			"name":  agg.name,
			"count": agg.count,
		})
	}

	var nextRun map[string]interface{}
	var nrID, nrName, nrAt string
	if err := db.QueryRow(`SELECT id, name, next_run_at FROM qa_schedules WHERE enabled=1 AND next_run_at<>'' ORDER BY next_run_at ASC LIMIT 1`).Scan(&nrID, &nrName, &nrAt); err == nil {
		nextRun = map[string]interface{}{
			"schedule_id": nrID,
			"name":        nrName,
			"next_run_at": nrAt,
		}
	}

	qaRespondSuccess(w, map[string]interface{}{
		"schedules_total":   schedulesTotal,
		"schedules_enabled": schedulesEnabled,
		"runs_today":        runsToday,
		"success_rate_30d":  successRate,
		"ai_flagged_30d":    aiFlagged30,
		"daily":             daily,
		"top_failed_rules":  topRules,
		"next_run":          nextRun,
	})
}

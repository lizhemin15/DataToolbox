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
	LastRunAt        string   `json:"last_run_at"`
	LastRunStatus    string   `json:"last_run_status"`
	NextRunAt        string   `json:"next_run_at"`
	CreatedBy        string   `json:"created_by"`
	CreatedAt        string   `json:"created_at"`
	UpdatedAt        string   `json:"updated_at"`
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
	q := `SELECT id, name, database_id, cron_expr, enabled, rule_nms, ai_check_nms, ai_prompt, report_template_id, fill_enabled, ai_check_enabled, last_run_at, last_run_status, next_run_at, created_by, created_at, updated_at FROM qa_schedules`
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
	row := db.QueryRow(`SELECT id, name, database_id, cron_expr, enabled, rule_nms, ai_check_nms, ai_prompt, report_template_id, fill_enabled, ai_check_enabled, last_run_at, last_run_status, next_run_at, created_by, created_at, updated_at FROM qa_schedules WHERE id=?`, id)
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
	if err := sc.Scan(&s.ID, &s.Name, &s.DatabaseID, &s.CronExpr, &enabled, &ruleNMs, &aiNMs, &s.AIPrompt, &s.ReportTemplateID, &fillEnabled, &aiEnabled, &s.LastRunAt, &s.LastRunStatus, &s.NextRunAt, &s.CreatedBy, &s.CreatedAt, &s.UpdatedAt); err != nil {
		return nil, err
	}
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
		if _, err := db.Exec(`UPDATE qa_schedules SET name=?, database_id=?, cron_expr=?, enabled=?, rule_nms=?, ai_check_nms=?, ai_prompt=?, report_template_id=?, fill_enabled=?, ai_check_enabled=?, next_run_at=?, updated_at=? WHERE id=?`,
			req.Name, req.DatabaseID, req.CronExpr, en, string(rulesJSON), string(aiJSON), req.AIPrompt, strings.TrimSpace(req.ReportTemplateID), fe, ae, nextRun, now, req.ID); err != nil {
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
	if _, err := db.Exec(`INSERT INTO qa_schedules (id, name, database_id, cron_expr, enabled, rule_nms, ai_check_nms, ai_prompt, report_template_id, fill_enabled, ai_check_enabled, last_run_at, last_run_status, next_run_at, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		id, req.Name, req.DatabaseID, req.CronExpr, en, string(rulesJSON), string(aiJSON), req.AIPrompt, strings.TrimSpace(req.ReportTemplateID), fe, ae, "", "", nextRun, username, now, now); err != nil {
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
		_, status, runErr := qaRunScheduleCoreWithProgress(s, "manual", username, runID, pr)
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
	_, status, err := qaRunScheduleCoreWithProgress(s, triggerType, username, runID, pr)
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
func qaRunScheduleCoreWithProgress(s *qaSchedule, triggerType, username, runID string, pr *qaRunProgress) (string, string, error) {
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

	switch {
	case !dbOK:
		status = "failed"
		runErrMsg = "目标数据库不存在"
		pr.setPhase("rules", "执行审核规则")
	default:
		dialect := normalizeQualityDialect(dbConfig.Type)
		pr.setPhase("connect", "连接数据库")
		// 先把规则条数报上去：数据库连接慢的时候进度条不至于一直显示 0/0
		pr.addTotal(len(s.RuleNMs))
		targetDB, derr := getDBFromPool(dbConfig)
		if derr != nil {
			status = "failed"
			runErrMsg = "连接失败: " + derr.Error()
			break
		}
		pr.setPhase("rules", "执行审核规则")
		ruleResults, p, f, exErr := qaExecuteRules(s.DatabaseID, targetDB, dialect, s.RuleNMs, username, startedAt, func(nm, name string) {
			if name == "" {
				name = nm
			}
			pr.tick(name)
		})
		passed, failed = p, f
		if exErr != nil {
			status = "failed"
			runErrMsg = exErr.Error()
			pr.fail(exErr.Error())
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
			itemStats = runFillStatsWithProgress(targetDB, dialect, itemRows, func() { pr.tick("") })
			recStats = runFillStatsWithProgress(targetDB, dialect, recRows, func() { pr.tick("") })
		}

		// AI 复核：只对「本次未通过且规则自带复核原则」的规则；总开关在任务上
		pr.setPhase("ai", "AI 复核")
		aiMap, aiModel, aiSkipReason := qaAIVerifyWithProgress(ruleResults, s.AICheckEnabled, pr)
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

		// 生成报告并落盘
		pr.setPhase("report", "生成报告")
		pr.addTotal(1)
		if doc, err := qaBuildReportDocx(qaNormalizeAuditJSON(map[string]interface{}{
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
		}), s.ReportTemplateID); err == nil {
			if err := os.MkdirAll(qaReportsDir(), 0755); err == nil {
				name := runID + ".docx"
				if werr := os.WriteFile(filepath.Join(qaReportsDir(), name), doc, 0644); werr == nil {
					reportFile = name
				}
			}
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

	finishedAt := time.Now()
	duration := finishedAt.Sub(startedAt).Milliseconds()
	summaryJSON, _ := json.Marshal(summaryMap)

	if db, err := openQualityAuditDB(); err == nil {
		_, _ = db.Exec(`INSERT INTO qa_runs (id, schedule_id, schedule_name, trigger_type, database_id, started_at, finished_at, duration_ms, status, total_rules, passed, failed, ai_flagged, report_file, summary, detail, error, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			runID, s.ID, s.Name, triggerType, s.DatabaseID, startedAt.Format(time.RFC3339), finishedAt.Format(time.RFC3339), duration, status, passed+failed, passed, failed, aiFlagged, reportFile, string(summaryJSON), string(detailJSON), runErrMsg, username)
		_, _ = db.Exec(`UPDATE qa_schedules SET last_run_at=?, last_run_status=?, updated_at=? WHERE id=?`,
			finishedAt.Format(time.RFC3339), status, finishedAt.Format(time.RFC3339), s.ID)
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
// 返回：nm → 复核结论、使用的模型名、跳过原因。
func qaAIVerifyWithProgress(ruleResults []map[string]interface{}, enabled bool, pr *qaRunProgress) (map[string]map[string]interface{}, string, string) {
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
	aiMap, aiModel, skipReason := qaAIVerifyWithProgress(ruleResults, enabled, nil)
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

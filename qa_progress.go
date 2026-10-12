package main

import (
	"context"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// qaRunProgress 后台执行进度（内存态）。
//
// 定时任务与「立即执行」都在服务端 goroutine 里跑：HTTP 请求立刻返回 run_id，
// 页面可以随意离开/刷新，回来后用 /progress 接口继续看进度。
// 注意：进度只存内存，进程重启即丢失；未跑完的执行不会写入 qa_runs（与旧行为一致）。
type qaRunProgress struct {
	mu sync.Mutex

	RunID        string
	ScheduleID   string
	ScheduleName string
	TriggerType  string
	// databaseID 目标数据库。用于「老前端只传 database_id 的取消请求」反查 run_id，
	// 也方便界面把执行记录和库对上。
	databaseID string

	Status     string // running | success | failed
	Phase      string // prepare | rules | fill | ai | report | done
	PhaseLabel string
	Total      int
	Done       int
	Current    string
	Error      string

	StartedAt      time.Time
	PhaseStartedAt time.Time
	UpdatedAt      time.Time
	FinishedAt     time.Time
	// CurrentSince 「当前项」是什么时候开始跑的。
	// 为什么需要它：只显示一个名字，用户无法判断这一项到底跑了 3 秒还是 30 分钟，
	// 卡死时看起来和正常跑一模一样。
	CurrentSince time.Time

	// cancel 由执行方注册（context.CancelFunc），「取消执行」接口靠它真停掉后台 goroutine。
	// 历史教训：早先有一套按 database_id 索引的 qaCancelFuncs，但从来没人注册也没有接口调，
	// 是死代码 —— 前端点取消后端毫无反应。
	cancel     context.CancelFunc
	canceled   bool
	canceledAt time.Time
	// finished 首个终态胜出。
	// 为什么要这个：看门狗（整体超时）和执行方 goroutine 可能几乎同时宣布结束，
	// 谁先到谁定终态，后到的直接丢弃，避免「先报了失败、随后又被改回成功」。
	finished bool
	// recorded 标记 qa_runs 是否已被写入，保证一次执行只落一条记录。
	// 卡死场景下执行方可能永远回不来，只能由看门狗代写；两边都必须先抢这个标记再写。
	recorded bool
}

// qaProgressKeep 内存里最多保留多少条已结束的执行进度。
const qaProgressKeep = 60

// 进度停滞多久算「疑似卡住」。取 2 分钟：正常单条规则查询很少超过这个量级，
// 一旦超过，用户看进度条看不出区别，必须显式提示 + 给取消入口。
const qaStaleIdleDefaultMS = 120000

// qaEnvMS 读取毫秒级环境变量，非法/缺省时回退默认值。
func qaEnvMS(key string, def int64) int64 {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return def
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n <= 0 {
		return def
	}
	return n
}

// qaStaleIdleMS 「疑似卡住」判定阈值。
func qaStaleIdleMS() int64 { return qaEnvMS("DT_QA_STALE_IDLE_MS", qaStaleIdleDefaultMS) }

// qaEnvAllowZeroInt 读取整数环境变量，允许显式写 0（0 是有意义的值，比如
// DT_QA_RULE_RETRIES=0 表示「超时也不重试」，所以不能沿用 qaEnvMS 那种「<=0 当没填」的语义）。
// 非法/缺省/负数回退默认值。
func qaEnvAllowZeroInt(key string, def int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return def
	}
	return n
}

// qaRunTimeoutMS 单次执行的整体超时（默认 30 分钟），超时按失败落库，锁必释放。
func qaRunTimeoutMS() int64 { return qaEnvMS("DT_QA_RUN_TIMEOUT_MS", 30*60*1000) }

// qaReportTimeoutMS 报告生成阶段的独立超时（默认 3 分钟）。
// 用户报障「卡在生成 word 阶段」，所以这一段单独设闸门。
func qaReportTimeoutMS() int64 { return qaEnvMS("DT_QA_REPORT_TIMEOUT_MS", 3*60*1000) }

// qaConnectTimeoutMS 建立数据库连接的单步上限（默认 30 秒）。
// 连接池打满、网络半开时，光「连上」这一步就能把整个任务挂住。
func qaConnectTimeoutMS() int64 { return qaEnvMS("DT_QA_CONNECT_TIMEOUT_MS", 30*1000) }

var (
	qaProgressMu  sync.Mutex
	qaProgressMap = map[string]*qaRunProgress{}
	qaProgressSeq []string // 按开始时间排序的 run_id
)

// qaProgressStart 创建一个执行进度对象并登记。
func qaProgressStart(runID, scheduleID, scheduleName, triggerType string) *qaRunProgress {
	now := time.Now()
	p := &qaRunProgress{
		RunID:          runID,
		ScheduleID:     scheduleID,
		ScheduleName:   scheduleName,
		TriggerType:    triggerType,
		Status:         "running",
		Phase:          "prepare",
		PhaseLabel:     "准备执行",
		StartedAt:      now,
		UpdatedAt:      now,
		PhaseStartedAt: now,
	}
	qaProgressMu.Lock()
	qaProgressMap[runID] = p
	qaProgressSeq = append(qaProgressSeq, runID)
	qaProgressTrimLocked()
	qaProgressMu.Unlock()
	return p
}

// qaProgressTrimLocked 丢弃过老的进度记录，避免内存无限增长。
func qaProgressTrimLocked() {
	for len(qaProgressSeq) > qaProgressKeep {
		oldest := qaProgressSeq[0]
		qaProgressSeq = qaProgressSeq[1:]
		delete(qaProgressMap, oldest)
	}
}

// qaProgressGet 取进度对象（可能为 nil）。
func qaProgressGet(runID string) *qaRunProgress {
	qaProgressMu.Lock()
	defer qaProgressMu.Unlock()
	return qaProgressMap[runID]
}

// qaProgressActive 返回当前正在执行的进度快照（按开始时间升序）。
func qaProgressActive() []map[string]interface{} {
	qaProgressMu.Lock()
	entries := make([]*qaRunProgress, 0, len(qaProgressSeq))
	for _, id := range qaProgressSeq {
		if p := qaProgressMap[id]; p != nil {
			entries = append(entries, p)
		}
	}
	qaProgressMu.Unlock()

	out := []map[string]interface{}{}
	for _, p := range entries {
		snap := p.snapshot()
		if snap["status"] == "running" {
			out = append(out, snap)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return asString(out[i]["started_at"]) < asString(out[j]["started_at"])
	})
	return out
}

func asString(v interface{}) string {
	s, _ := v.(string)
	return s
}

// addTotal 累加「总项数」。
func (p *qaRunProgress) addTotal(n int) {
	if p == nil || n <= 0 {
		return
	}
	p.mu.Lock()
	p.Total += n
	p.UpdatedAt = time.Now()
	p.mu.Unlock()
}

// setPhase 切换阶段（不影响已完成计数）。
//
// 必须清空 Current：否则从「执行审核规则」切到「生成报告」后，前端还在显示
// 「正在执行：<最后一条规则名>」—— 用户看到的就是「以为还在跑最后一项」。
func (p *qaRunProgress) setPhase(phase, label string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.Phase = phase
	p.PhaseLabel = label
	p.PhaseStartedAt = time.Now()
	p.Current = ""
	p.CurrentSince = time.Time{}
	p.UpdatedAt = p.PhaseStartedAt
	p.mu.Unlock()
}

// tick 完成一项。
func (p *qaRunProgress) tick(current string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.Done++
	if p.Total < p.Done {
		p.Total = p.Done
	}
	if current != "" {
		p.Current = current
		p.CurrentSince = time.Now()
	}
	p.UpdatedAt = time.Now()
	p.mu.Unlock()
}

// setCurrent 只更新「当前正在做什么」，不推进 done 计数。
// 用于那些拿不到逐项回调的阶段（比如报告生成、AI 复核单次调用）。
func (p *qaRunProgress) setCurrent(current string) {
	if p == nil || current == "" {
		return
	}
	p.mu.Lock()
	p.Current = current
	p.CurrentSince = time.Now()
	p.UpdatedAt = time.Now()
	p.mu.Unlock()
}

// beat 心跳：阶段内部还在动（比如逐行处理），刷新 UpdatedAt 让「疑似卡住」不误报。
func (p *qaRunProgress) beat() {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.UpdatedAt = time.Now()
	p.mu.Unlock()
}

// setCancel 注册取消函数。执行方在启动前调用，结束后由 clearCancel 摘掉。
func (p *qaRunProgress) setCancel(cancel context.CancelFunc) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.cancel = cancel
	p.mu.Unlock()
}

// clearCancel 摘掉取消函数，避免取消接口打到已经结束的执行上。
func (p *qaRunProgress) clearCancel() {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.cancel = nil
	p.mu.Unlock()
}

// requestCancel 触发取消。返回 false 表示这次执行已经结束（没什么可取消的）。
func (p *qaRunProgress) requestCancel() bool {
	if p == nil {
		return false
	}
	p.mu.Lock()
	cancel := p.cancel
	running := p.Status == "running"
	if running {
		p.canceled = true
		p.canceledAt = time.Now()
	}
	p.mu.Unlock()
	if !running || cancel == nil {
		return false
	}
	cancel()
	return true
}

// wasCanceled 判断这次执行是否收到过取消信号。
func (p *qaRunProgress) wasCanceled() bool {
	if p == nil {
		return false
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.canceled
}

// fail 标记执行失败（只改状态，收尾交给 finish）。
// tryMarkRecorded 抢占「写 qa_runs」的资格。返回 true 表示这次由你写入。
// pr 为 nil（老调用路径不带进度）时永远返回 true，保持旧行为不变。
func (p *qaRunProgress) tryMarkRecorded() bool {
	if p == nil {
		return true
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.recorded {
		return false
	}
	p.recorded = true
	return true
}

// qaRequestCancelByRunID 按 run_id 取消一次执行。返回 false 表示没找到 / 已结束。
func qaRequestCancelByRunID(runID string) bool {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return false
	}
	return qaProgressGet(runID).requestCancel()
}

// setDatabase 记录目标数据库（在登记之后调用）。
func (p *qaRunProgress) setDatabase(id string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.databaseID = id
	p.mu.Unlock()
}

// qaActiveRunIDByDatabase 反查某个数据库当前正在执行的 run_id（取最早开始的那个）。
// 只服务于「老前端只传 database_id」的兼容路径；返回空串表示没有在跑的执行。
func qaActiveRunIDByDatabase(databaseID string) string {
	databaseID = strings.TrimSpace(databaseID)
	if databaseID == "" {
		return ""
	}
	qaProgressMu.Lock()
	defer qaProgressMu.Unlock()
	// qaProgressSeq 按开始时间升序，所以第一个命中的就是最早开始的。
	for _, id := range qaProgressSeq {
		p := qaProgressMap[id]
		if p == nil {
			continue
		}
		p.mu.Lock()
		hit := p.Status == "running" && p.databaseID == databaseID
		p.mu.Unlock()
		if hit {
			return id
		}
	}
	return ""
}

func (p *qaRunProgress) fail(msg string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.Error = msg
	p.mu.Unlock()
}

// finish 标记结束。
// 幂等：一次执行只有第一个终态算数（见 finished 字段注释）。
func (p *qaRunProgress) finish(status, errMsg string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.finished {
		return
	}
	p.finished = true
	p.Status = status
	p.Phase = "done"
	p.cancel = nil // 结束后不再接受取消，否则会打到下一次执行上
	if status == "failed" {
		// 取消按失败落库（qa_runs.status 只有 success/failed 两态，不新增枚举值），
		// 但文案要能让用户一眼看出是「他自己点的取消」，不是系统故障。
		if p.canceled {
			p.PhaseLabel = "已取消"
		} else {
			p.PhaseLabel = "执行失败"
		}
	} else {
		p.PhaseLabel = "执行完成"
	}
	if errMsg != "" {
		p.Error = errMsg
	}
	if p.canceled && p.Error == "" {
		p.Error = "执行已被取消"
	}
	if p.Total >= 0 {
		p.Done = p.Total
	}
	p.Current = ""
	p.CurrentSince = time.Time{}
	p.FinishedAt = time.Now()
	p.UpdatedAt = p.FinishedAt
}

// snapshot 生成对外 JSON（含 percent / eta_ms / elapsed_ms）。
func (p *qaRunProgress) snapshot() map[string]interface{} {
	if p == nil {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	now := time.Now()
	end := now
	if !p.FinishedAt.IsZero() {
		end = p.FinishedAt
	}
	elapsed := end.Sub(p.StartedAt)
	elapsedMS := elapsed.Milliseconds()
	if elapsedMS < 0 {
		elapsedMS = 0
	}

	percent := 0.0
	if p.Total > 0 {
		percent = float64(p.Done) / float64(p.Total) * 100
		if percent > 100 {
			percent = 100
		}
	}
	if p.Status == "running" && percent >= 100 {
		percent = 99.0 // 还没落库，别显示 100%
	}
	if p.Status != "running" {
		percent = 100
	}

	etaMS := int64(-1)
	remaining := p.Total - p.Done
	if p.Status == "running" && p.Done > 0 && remaining > 0 {
		etaMS = int64(float64(elapsedMS) / float64(p.Done) * float64(remaining))
	}

	// idle_ms：距上一次「有任何进展」过去了多久。
	// 这是本页最重要的一个数字 —— 用户报的「卡死」在旧版界面上完全看不出来，
	// 因为进度条、当前项、done 计数全都停在原地，和正常运行时长得一模一样。
	idleMS := now.Sub(p.UpdatedAt).Milliseconds()
	if p.Status != "running" {
		idleMS = 0
	}
	if idleMS < 0 {
		idleMS = 0
	}
	phaseElapsedMS := int64(0)
	if !p.PhaseStartedAt.IsZero() {
		phaseEnd := now
		if !p.FinishedAt.IsZero() {
			phaseEnd = p.FinishedAt
		}
		if d := phaseEnd.Sub(p.PhaseStartedAt).Milliseconds(); d > 0 {
			phaseElapsedMS = d
		}
	}
	// current_elapsed_ms：当前项已经跑了多久。没跑任何一项时必须是 -1（未知），
	// 不能是 0 —— 0 会被读成「这一项刚开始了 0 秒」（正常得很），
	// 而真实情况是「已经没有当前项了」。本文件里 -1 就是「未知」的约定（见上面 etaMS）。
	currentElapsedMS := int64(-1)
	if !p.CurrentSince.IsZero() && p.Status == "running" {
		currentElapsedMS = 0
		if d := now.Sub(p.CurrentSince).Milliseconds(); d > 0 {
			currentElapsedMS = d
		}
	}
	stale := p.Status == "running" && idleMS >= qaStaleIdleMS()

	return map[string]interface{}{
		"run_id":             p.RunID,
		"schedule_id":        p.ScheduleID,
		"schedule_name":      p.ScheduleName,
		"trigger_type":       p.TriggerType,
		"database_id":        p.databaseID,
		"status":             p.Status,
		"phase":              p.Phase,
		"phase_label":        p.PhaseLabel,
		"total":              p.Total,
		"done":               p.Done,
		"remaining":          remaining,
		"percent":            percent,
		"current":            p.Current,
		"elapsed_ms":         elapsedMS,
		"eta_ms":             etaMS,
		"phase_elapsed_ms":   phaseElapsedMS,
		"current_elapsed_ms": currentElapsedMS,
		"idle_ms":            idleMS,
		"stale":              stale,
		"stale_threshold_ms": qaStaleIdleMS(),
		"cancelable":         p.Status == "running" && p.cancel != nil,
		"canceled":           p.canceled,
		"started_at":         p.StartedAt.Format(time.RFC3339),
		"updated_at":         p.UpdatedAt.Format(time.RFC3339),
		"phase_started_at":   p.PhaseStartedAt.Format(time.RFC3339),
		"finished":           p.Status != "running",
		"error":              p.Error,
	}
}

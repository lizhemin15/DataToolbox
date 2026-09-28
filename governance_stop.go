package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// ==================== 治理任务：停止运行 / 僵死状态复位 ====================
//
// 背景：治理任务由后端 worker 拉起 gov-runner 子进程执行（单次最长 10 分钟）。
// 旧实现里「停止」这件事根本不存在，于是留下两类坑：
//   1) 真在跑的任务停不下来，只能干等它跑完或超时；
//   2) 子进程异常退出 / 服务重启后，任务状态永久卡在 running 出不来（前端一直转圈）。
//
// 本文件负责让「停止」真正生效，并提供三层自愈：
//   - 手动停止：中断正在跑的 gov-runner 子进程（含排队未开跑的运行）
//   - 僵死复位：状态是 running 但已无对应子进程时，直接复位状态
//   - 看门狗：定期扫描，超时未回收的自动复位，用户不点停止也能恢复
//   - 启动对账：进程刚起来不可能有运行在跑，启动时把残留 running 清干净

const (
	// govStopReasonStopped 手动停止时的统一说明
	govStopReasonStopped = "任务已被手动停止"
	// govStopReasonInterrupted 服务重启导致上次运行中断
	govStopReasonInterrupted = "服务重启，上次运行被中断（状态已自动复位）"
	// govStopReasonAutoReset 看门狗判定超时未回收
	govStopReasonAutoReset = "运行超时未被回收，已自动复位（可重新运行）"
)

// govStuckRunTimeout 看门狗判定「卡死」的阈值。
// gov-runner 自身超时为 10 分钟，这里多给 5 分钟余量，避免误伤正常慢任务。
const govStuckRunTimeout = 15 * time.Minute

// govRunnerWaitDelay 子进程等待宽限期：ctx 取消/超时后，即便还有进程握着 stdout/stderr
// 管道不放（孙进程没被杀干净），也让 Run() 在此时限内强制返回，保证 worker 一定收得了尾。
const govRunnerWaitDelay = 5 * time.Second

// govStopReapGrace 已请求停止后，再宽限这么久仍不注销的活跃运行视为泄漏，强制注销。
// 兜底用：万一将来又出现「worker 卡在某个环节」导致 govRunEnd 没跑，也不能让它
// 永久挡住看门狗的僵死复位（那正是用户看到的「任务一直卡在运行中」）。
const govStopReapGrace = 90 * time.Second

// govActiveRun 一次正在执行的运行
type govActiveRun struct {
	TaskID     string
	RunID      string
	ShareToken string
	IsShare    bool
	StartedAt  time.Time
	StoppedAt  time.Time // 首次请求停止的时间，零值表示没请求过停止
	cancel     context.CancelFunc
	stopped    bool
}

var (
	govActiveRunMu sync.Mutex
	// govActiveRuns 已拉起子进程的活跃运行：runID -> 运行信息
	govActiveRuns = make(map[string]*govActiveRun)
	// govStopRequested 已请求停止的 runID（含「已入队但 worker 还没开跑」的情况）：runID -> 原因
	govStopRequested = make(map[string]string)
)

// govRunBegin 登记活跃运行，使其可被「停止」中断
func govRunBegin(taskID, runID, shareToken string, isShare bool, cancel context.CancelFunc) {
	if runID == "" || cancel == nil {
		return
	}
	govActiveRunMu.Lock()
	alreadyStopped := govStopRequested[runID] != ""
	govActiveRuns[runID] = &govActiveRun{
		TaskID:     taskID,
		RunID:      runID,
		ShareToken: shareToken,
		IsShare:    isShare,
		StartedAt:  time.Now(),
		cancel:     cancel,
		stopped:    alreadyStopped,
	}
	govActiveRunMu.Unlock()

	// 排队期间就被点了停止：子进程刚拉起就立刻干掉
	if alreadyStopped {
		cancel()
	}
}

// govRunEnd 运行结束（无论成败）后注销登记
func govRunEnd(runID string) {
	if runID == "" {
		return
	}
	govActiveRunMu.Lock()
	delete(govActiveRuns, runID)
	govActiveRunMu.Unlock()
}

// govRunShouldStop 判断该运行是否已被请求停止
func govRunShouldStop(runID string) bool {
	if runID == "" {
		return false
	}
	govActiveRunMu.Lock()
	_, requested := govStopRequested[runID]
	govActiveRunMu.Unlock()
	return requested
}

// govRunStopReason 取停止原因，没有时回退到默认文案
func govRunStopReason(runID string) string {
	govActiveRunMu.Lock()
	reason := govStopRequested[runID]
	govActiveRunMu.Unlock()
	if reason == "" {
		return govStopReasonStopped
	}
	return reason
}

// govMarkRunStopped 标记「已请求停止」。
// 用于还没拉起子进程的运行（排队中），避免停止后又被 worker 取出来执行。
// 返回 true 表示本次是新增标记（原先没标记过）。
func govMarkRunStopped(runID, reason string) bool {
	if runID == "" {
		return false
	}
	if reason == "" {
		reason = govStopReasonStopped
	}
	govActiveRunMu.Lock()
	_, existed := govStopRequested[runID]
	if !existed {
		govStopRequested[runID] = reason
	}
	govActiveRunMu.Unlock()
	return !existed
}

// govClearRunStop 运行收尾完成后清理停止标记，避免污染同名 runID 的后续运行
func govClearRunStop(runID string) {
	if runID == "" {
		return
	}
	govActiveRunMu.Lock()
	delete(govStopRequested, runID)
	govActiveRunMu.Unlock()
}

// govHasActiveRun 该任务是否有正在执行的子进程
func govHasActiveRun(taskID string) bool {
	govActiveRunMu.Lock()
	defer govActiveRunMu.Unlock()
	for _, run := range govActiveRuns {
		if run.TaskID == taskID {
			return true
		}
	}
	return false
}

// govStopRunsOfTask 中断该任务的所有活跃运行（杀掉子进程）
func govStopRunsOfTask(taskID, reason string) (cancelled []string) {
	if reason == "" {
		reason = govStopReasonStopped
	}
	var cancels []context.CancelFunc

	govActiveRunMu.Lock()
	for _, run := range govActiveRuns {
		if run.TaskID != taskID {
			continue
		}
		govStopRequested[run.RunID] = reason
		run.stopped = true
		if run.StoppedAt.IsZero() {
			run.StoppedAt = time.Now()
		}
		cancels = append(cancels, run.cancel)
		cancelled = append(cancelled, run.RunID)
	}
	govActiveRunMu.Unlock()

	// 取消函数在锁外调用，避免持锁时做进程操作
	for _, c := range cancels {
		c()
	}
	return cancelled
}

// govMarkRunningLogsStopped 把仍在 running 的执行日志标记为已停止。
// runID 非空时只处理该次运行；为空时处理该任务下所有运行中的日志。
func govMarkRunningLogsStopped(taskID, runID, reason string) int {
	if reason == "" {
		reason = govStopReasonStopped
	}
	now := time.Now().Format(time.RFC3339)
	count := 0

	dataOntologyMu.Lock()
	for _, entry := range governanceTaskLogs[taskID] {
		if entry == nil || entry.Status != "running" {
			continue
		}
		if runID != "" && entry.RunID != "" && entry.RunID != runID {
			continue
		}
		entry.Status = "error"
		entry.EndTime = now
		if entry.Error == "" {
			entry.Error = reason
		} else {
			entry.Error = reason + " | " + entry.Error
		}
		count++
	}
	dataOntologyMu.Unlock()
	return count
}

// govResetRunningTask 把卡在 running 的任务状态复位。
// 用 "error" 而不是 "idle"：这次运行确实没跑完，标成失败比悄悄回到待运行更诚实；
// 前端状态图标把非 idle/running/success 一律显示为失败，不需要新增状态枚举。
func govResetRunningTask(taskID, reason string) bool {
	if reason == "" {
		reason = govStopReasonStopped
	}
	reset := false

	dataOntologyMu.Lock()
	if t, ok := governanceTasks[taskID]; ok && t != nil && t.Status == "running" {
		t.Status = "error"
		t.LastError = reason
		t.LastRunAt = time.Now().Format(time.RFC3339)
		t.RunID = ""
		t.CurrentFile = ""
		t.Percent = 100
		t.ProcessedFiles = t.TotalFiles
		reset = true
	}
	dataOntologyMu.Unlock()

	if reset {
		saveDataOntologyStore()
	}
	return reset
}

// govTaskRunExpired 判断任务的本次运行是否已超过卡死阈值。
// 依据：优先与 runID 匹配的执行日志起始时间，其次任务的 StartedAt。
// 两者都拿不到或解析失败时返回 true —— 调用方已确认没有活跃子进程，此时残留 running 必是僵死状态。
func govTaskRunExpired(taskID, runID string) bool {
	var startedAt string

	dataOntologyMu.RLock()
	if runID != "" {
		for _, entry := range governanceTaskLogs[taskID] {
			if entry == nil || entry.RunID != runID {
				continue
			}
			startedAt = entry.StartTime
			break
		}
	}
	if startedAt == "" {
		if t, ok := governanceTasks[taskID]; ok && t != nil {
			startedAt = t.StartedAt
		}
	}
	dataOntologyMu.RUnlock()

	if startedAt == "" {
		return true
	}
	tm, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return true
	}
	return tm.Before(time.Now().Add(-govStuckRunTimeout))
}

// syncShareRunsStopped 把该任务下仍处于未完成状态的分享执行记录收尾，
// 避免免鉴权的分享页一直转圈等一个永远不会来的结果。
func syncShareRunsStopped(taskID, runID, reason string) {
	if reason == "" {
		reason = govStopReasonStopped
	}

	governanceShareRunsMu.Lock()
	var targets []string
	for id, run := range governanceShareRuns {
		if run == nil || run.TaskID != taskID {
			continue
		}
		if run.Status == "completed" || run.Status == "failed" {
			continue
		}
		if runID != "" && id != runID {
			continue
		}
		targets = append(targets, id)
	}
	governanceShareRunsMu.Unlock()

	for _, id := range targets {
		updateShareRun(id, "failed", 100, reason, nil, nil)
	}
}

// govStopTaskOutcome 停止操作的结果（用于返回给前端做提示）
type govStopTaskOutcome struct {
	CancelledRuns []string // 被真正中断的活跃运行 runID
	MarkedLogs    int      // 被标记为已停止的执行日志条数
	ResetZombie   bool     // 是否复位了僵死的 running 状态
	WasRunning    bool     // 操作前任务是否处于运行中
}

// govStopGovernanceTask 停止任务：
//   - 有活跃子进程 -> 杀进程 + 标记停止，任务收尾交给 executeGovernanceJob 自己走完
//   - 无活跃子进程但状态是 running（排队中被取消 / 进程已死 / 重启残留）-> 直接复位状态
func govStopGovernanceTask(taskID, reason string) govStopTaskOutcome {
	if reason == "" {
		reason = govStopReasonStopped
	}
	var out govStopTaskOutcome

	// 取当前运行信息（task.RunID 指向最近一次运行，排队中的运行靠它拦下）
	dataOntologyMu.RLock()
	if t, ok := governanceTasks[taskID]; ok && t != nil {
		if t.Status == "running" {
			out.WasRunning = true
		}
		if t.RunID != "" {
			govMarkRunStopped(t.RunID, reason)
		}
	}
	dataOntologyMu.RUnlock()

	// 中断正在跑的子进程
	out.CancelledRuns = govStopRunsOfTask(taskID, reason)

	// 标记执行日志（先标记再复位状态，保证前端刷新时看到的是失败而不是运行中）
	out.MarkedLogs = govMarkRunningLogsStopped(taskID, "", reason)

	// 状态复位。有活跃子进程时也要复位：
	// 否则从杀进程到 worker 收尾之间，前端仍显示「运行中」，用户会以为没停掉。
	if govHasActiveRun(taskID) && len(out.CancelledRuns) == 0 {
		// 极端竞态：有活跃运行但不在取消列表里，不强行复位，等它自己收尾
		log.Printf("[治理任务] 任务 %s 存在未登记的活跃运行，跳过状态复位", taskID)
	} else {
		out.ResetZombie = govResetRunningTask(taskID, reason)
	}

	// 分享执行记录同步收尾
	syncShareRunsStopped(taskID, "", reason)

	return out
}

// handleGovernanceTaskStop POST /api/v1/gov/tasks/{taskID}/stop —— 停止运行中或卡死的任务
func handleGovernanceTaskStop(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
		return
	}
	if _, _, ok := requireGovernanceTaskAccess(w, r, taskID); !ok {
		return
	}

	out := govStopGovernanceTask(taskID, govStopReasonStopped)

	if len(out.CancelledRuns) == 0 && !out.ResetZombie {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"stopped": false,
			"message": "任务当前不在运行中",
		})
		return
	}

	msg := "已停止运行"
	switch {
	case len(out.CancelledRuns) > 0:
		msg = fmt.Sprintf("已停止运行（中断 %d 个子进程）", len(out.CancelledRuns))
	case out.ResetZombie:
		msg = "已复位卡住的运行状态"
	}

	log.Printf("[治理任务] 停止任务 %s：中断运行 %d 个、标记日志 %d 条、复位状态 %v",
		taskID, len(out.CancelledRuns), out.MarkedLogs, out.ResetZombie)

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"stopped":        true,
		"cancelled_runs": out.CancelledRuns,
		"marked_logs":    out.MarkedLogs,
		"reset_zombie":   out.ResetZombie,
		"message":        msg,
	})
}

// govReconcileStaleRunsOnBoot 启动对账。
// 进程刚起来，不可能有任何运行在跑，所以残留的 running 一定是上次进程被杀留下的脏状态。
func govReconcileStaleRunsOnBoot() {
	now := time.Now().Format(time.RFC3339)
	taskCount := 0
	logCount := 0

	dataOntologyMu.Lock()
	for _, t := range governanceTasks {
		if t == nil || t.Status != "running" {
			continue
		}
		t.Status = "error"
		t.LastError = govStopReasonInterrupted
		t.LastRunAt = now
		t.RunID = ""
		t.CurrentFile = ""
		taskCount++
	}
	for _, logs := range governanceTaskLogs {
		for _, entry := range logs {
			if entry == nil || entry.Status != "running" {
				continue
			}
			entry.Status = "error"
			entry.EndTime = now
			if entry.Error == "" {
				entry.Error = govStopReasonInterrupted
			}
			logCount++
		}
	}
	dataOntologyMu.Unlock()

	if taskCount > 0 || logCount > 0 {
		saveDataOntologyStore()
		log.Printf("[治理任务] 启动对账：复位 %d 个残留「运行中」任务、%d 条运行中日志", taskCount, logCount)
	}
}

// govStuckRunWatchdog 看门狗：定期扫描，让卡死的运行能自愈，不必等用户点停止
func govStuckRunWatchdog() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		govReapStuckRuns()
	}
}

// govReapStuckRuns 执行一轮僵死运行回收
func govReapStuckRuns() {
	// 第一层：登记的活跃运行超过阈值仍未结束（防御性兜底，正常应由 runner 自身超时结束）
	govActiveRunMu.Lock()
	var stuckCancels []context.CancelFunc
	var purged []string
	for id, run := range govActiveRuns {
		// 已请求停止却迟迟不注销 -> worker 收尾失败（历史 bug：孙进程握着管道让 Run() 永不返回）。
		// 强制注销，否则它会永久挡住下面第二层的僵死复位，任务就永远出不来。
		if !run.StoppedAt.IsZero() && time.Since(run.StoppedAt) > govStopReapGrace {
			delete(govActiveRuns, id)
			purged = append(purged, id)
			continue
		}
		if time.Since(run.StartedAt) <= govStuckRunTimeout {
			continue
		}
		govStopRequested[run.RunID] = govStopReasonAutoReset
		run.stopped = true
		if run.StoppedAt.IsZero() {
			run.StoppedAt = time.Now()
		}
		stuckCancels = append(stuckCancels, run.cancel)
		log.Printf("[治理任务] 运行 %s 超过 %s 仍未结束，强制中断", run.RunID, govStuckRunTimeout)
	}
	govActiveRunMu.Unlock()
	for _, c := range stuckCancels {
		c()
	}
	for _, id := range purged {
		govClearRunStop(id)
		log.Printf("[治理任务] 运行 %s 停止后超过 %s 仍未注销，已强制清理登记（防任务僵死卡住）", id, govStopReapGrace)
	}

	// 第二层：状态是 running，但已经没有任何对应子进程 —— 典型的「卡在运行中出不来」
	type staleTask struct {
		taskID string
		runID  string
	}
	var stales []staleTask

	dataOntologyMu.RLock()
	for id, t := range governanceTasks {
		if t == nil || t.Status != "running" {
			continue
		}
		stales = append(stales, staleTask{taskID: id, runID: t.RunID})
	}
	dataOntologyMu.RUnlock()

	for _, s := range stales {
		if govHasActiveRun(s.taskID) {
			continue // 真在跑，交给 runner 自己的超时机制
		}
		if !govTaskRunExpired(s.taskID, s.runID) {
			continue // 刚入队还没被 worker 取走，给它时间
		}
		log.Printf("[治理任务] 任务 %s 状态为「运行中」但无对应子进程，自动复位", s.taskID)
		govMarkRunStopped(s.runID, govStopReasonAutoReset)
		govMarkRunningLogsStopped(s.taskID, "", govStopReasonAutoReset)
		govResetRunningTask(s.taskID, govStopReasonAutoReset)
		govClearRunStop(s.runID)
	}
}

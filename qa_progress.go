package main

import (
	"sort"
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

	Status     string // running | success | failed
	Phase      string // prepare | rules | fill | ai | report | done
	PhaseLabel string
	Total      int
	Done       int
	Current    string
	Error      string

	StartedAt  time.Time
	UpdatedAt  time.Time
	FinishedAt time.Time
}

// qaProgressKeep 内存里最多保留多少条已结束的执行进度。
const qaProgressKeep = 60

var (
	qaProgressMu  sync.Mutex
	qaProgressMap = map[string]*qaRunProgress{}
	qaProgressSeq []string // 按开始时间排序的 run_id
)

// qaProgressStart 创建一个执行进度对象并登记。
func qaProgressStart(runID, scheduleID, scheduleName, triggerType string) *qaRunProgress {
	now := time.Now()
	p := &qaRunProgress{
		RunID:        runID,
		ScheduleID:   scheduleID,
		ScheduleName: scheduleName,
		TriggerType:  triggerType,
		Status:       "running",
		Phase:        "prepare",
		PhaseLabel:   "准备执行",
		StartedAt:    now,
		UpdatedAt:    now,
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
func (p *qaRunProgress) setPhase(phase, label string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.Phase = phase
	p.PhaseLabel = label
	p.UpdatedAt = time.Now()
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
	}
	p.UpdatedAt = time.Now()
	p.mu.Unlock()
}

// fail 标记执行失败（只改状态，收尾交给 finish）。
func (p *qaRunProgress) fail(msg string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.Error = msg
	p.mu.Unlock()
}

// finish 标记结束。
func (p *qaRunProgress) finish(status, errMsg string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Status = status
	p.Phase = "done"
	if status == "failed" {
		p.PhaseLabel = "执行失败"
	} else {
		p.PhaseLabel = "执行完成"
	}
	if errMsg != "" {
		p.Error = errMsg
	}
	if p.Total >= 0 {
		p.Done = p.Total
	}
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

	return map[string]interface{}{
		"run_id":        p.RunID,
		"schedule_id":   p.ScheduleID,
		"schedule_name": p.ScheduleName,
		"trigger_type":  p.TriggerType,
		"status":        p.Status,
		"phase":         p.Phase,
		"phase_label":   p.PhaseLabel,
		"total":         p.Total,
		"done":          p.Done,
		"remaining":     remaining,
		"percent":       percent,
		"current":       p.Current,
		"elapsed_ms":    elapsedMS,
		"eta_ms":        etaMS,
		"started_at":    p.StartedAt.Format(time.RFC3339),
		"updated_at":    p.UpdatedAt.Format(time.RFC3339),
		"finished":      p.Status != "running",
		"error":         p.Error,
	}
}

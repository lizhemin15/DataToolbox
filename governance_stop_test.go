package main

import (
	"sort"
	"testing"
	"time"
)

// 这些测试锁住「治理任务停止 / 僵死自愈」的核心契约。
// 背景 bug：gov-runner 的孙进程若没被杀干净，会握着 stdout/stderr 管道不放，
// 导致 cmd.Run() 永不返回 -> govRunEnd 不执行 -> 活跃运行登记永久残留 ->
// 看门狗第二层（状态 running 但无子进程 -> 自动复位）被 govHasActiveRun 挡住，
// 任务就永久卡在「运行中」。用户原话：「有些任务容易陷入执行状态一直出不来」。

// setupGovStopTest 隔离全局状态，避免污染其它测试
func setupGovStopTest(t *testing.T) {
	t.Helper()

	origTasks := governanceTasks
	origLogs := governanceTaskLogs
	origRuns := govActiveRuns
	origStops := govStopRequested
	origPath := getDataOntologyStorePathFn

	dir := t.TempDir()
	getDataOntologyStorePathFn = func() string { return dir + "/store.json" }
	governanceTasks = map[string]*GovernanceTask{}
	governanceTaskLogs = map[string][]*GovernanceTaskLog{}
	govActiveRuns = make(map[string]*govActiveRun)
	govStopRequested = make(map[string]string)

	t.Cleanup(func() {
		governanceTasks = origTasks
		governanceTaskLogs = origLogs
		govActiveRuns = origRuns
		govStopRequested = origStops
		getDataOntologyStorePathFn = origPath
	})
}

// TestGovReapRecoversTaskStuckAfterStop：停止后 worker 没能注销的残留运行，
// 看门狗必须强制清理并复位任务，否则任务永远出不来。
func TestGovReapRecoversTaskStuckAfterStop(t *testing.T) {
	setupGovStopTest(t)

	oldStart := time.Now().Add(-20 * time.Minute).Format(time.RFC3339)
	governanceTasks["t1"] = &GovernanceTask{ID: "t1", Status: "running", RunID: "r1"}
	governanceTaskLogs["t1"] = []*GovernanceTaskLog{
		{ID: "l1", TaskID: "t1", RunID: "r1", Status: "running", StartTime: oldStart},
	}
	// 残留登记：早就请求过停止（超过 govStopReapGrace），但一直没注销
	govActiveRuns["r1"] = &govActiveRun{
		TaskID:    "t1",
		RunID:     "r1",
		StartedAt: time.Now().Add(-20 * time.Minute),
		StoppedAt: time.Now().Add(-2 * govStopReapGrace),
		cancel:    func() {},
	}
	govStopRequested["r1"] = govStopReasonStopped

	govReapStuckRuns()

	if _, ok := govActiveRuns["r1"]; ok {
		t.Fatalf("停止后长期未注销的运行必须被强制清理，否则会永久挡住僵死复位")
	}
	if _, ok := govStopRequested["r1"]; ok {
		t.Fatalf("停止标记应被清理，避免污染同名 runID 的后续运行")
	}
	task := governanceTasks["t1"]
	if task.Status != "error" {
		t.Fatalf("卡住的 running 任务应被复位为 error，实际 %q", task.Status)
	}
	if task.LastError != govStopReasonAutoReset {
		t.Fatalf("复位原因应为看门狗自动复位，实际 %q", task.LastError)
	}
	if task.RunID != "" {
		t.Fatalf("复位后 RunID 应清空，实际 %q", task.RunID)
	}
	if got := governanceTaskLogs["t1"][0].Status; got != "error" {
		t.Fatalf("运行中的执行日志应收尾为 error，实际 %q", got)
	}
}

// TestGovReapKeepsHealthyRunAlive：正在跑（未请求停止、未超时）的运行不能被误杀
func TestGovReapKeepsHealthyRunAlive(t *testing.T) {
	setupGovStopTest(t)

	now := time.Now().Format(time.RFC3339)
	governanceTasks["t2"] = &GovernanceTask{ID: "t2", Status: "running", RunID: "r2", StartedAt: now}
	governanceTaskLogs["t2"] = []*GovernanceTaskLog{
		{ID: "l2", TaskID: "t2", RunID: "r2", Status: "running", StartTime: now},
	}
	cancelled := 0
	govActiveRuns["r2"] = &govActiveRun{
		TaskID:    "t2",
		RunID:     "r2",
		StartedAt: time.Now(),
		cancel:    func() { cancelled++ },
	}

	govReapStuckRuns()

	if _, ok := govActiveRuns["r2"]; !ok {
		t.Fatalf("健康的活跃运行不能被清理")
	}
	if cancelled != 0 {
		t.Fatalf("健康的活跃运行不能被中断，实际调用 cancel %d 次", cancelled)
	}
	if governanceTasks["t2"].Status != "running" {
		t.Fatalf("正在跑的任务不应被复位，实际 %q", governanceTasks["t2"].Status)
	}
}

// TestGovStopRunsOfTaskOnlyTouchesOwnTask：停止只杀该任务的运行，并记下停止时间
func TestGovStopRunsOfTaskOnlyTouchesOwnTask(t *testing.T) {
	setupGovStopTest(t)

	hit := map[string]int{}
	mkCancel := func(id string) func() { return func() { hit[id]++ } }

	govActiveRuns["r1"] = &govActiveRun{TaskID: "t1", RunID: "r1", StartedAt: time.Now(), cancel: mkCancel("r1")}
	govActiveRuns["r2"] = &govActiveRun{TaskID: "t1", RunID: "r2", StartedAt: time.Now(), cancel: mkCancel("r2")}
	govActiveRuns["r9"] = &govActiveRun{TaskID: "other", RunID: "r9", StartedAt: time.Now(), cancel: mkCancel("r9")}

	cancelled := govStopRunsOfTask("t1", govStopReasonStopped)
	sort.Strings(cancelled)

	if len(cancelled) != 2 || cancelled[0] != "r1" || cancelled[1] != "r2" {
		t.Fatalf("只应中断本任务的两个运行，实际 %v", cancelled)
	}
	if hit["r1"] != 1 || hit["r2"] != 1 {
		t.Fatalf("本任务的运行必须被中断，实际 %v", hit)
	}
	if hit["r9"] != 0 {
		t.Fatalf("别的任务的运行不能被误杀")
	}
	if govActiveRuns["r1"].StoppedAt.IsZero() || govActiveRuns["r2"].StoppedAt.IsZero() {
		t.Fatalf("停止时间必须被记录，供看门狗判定残留")
	}
	if !govRunShouldStop("r1") || govRunStopReason("r1") != govStopReasonStopped {
		t.Fatalf("停止标记与原因必须可被 worker 读到")
	}
}

// TestGovRunBeginAfterStopKillsImmediately：入队期间被点停止的运行，一拉起就干掉
func TestGovRunBeginAfterStopKillsImmediately(t *testing.T) {
	setupGovStopTest(t)

	govMarkRunStopped("r5", govStopReasonStopped)
	cancelled := 0
	govRunBegin("t5", "r5", "", false, func() { cancelled++ })

	if cancelled != 1 {
		t.Fatalf("排队期间已被停止的运行，拉起后必须立刻中断，实际 cancel %d 次", cancelled)
	}
	if !govRunShouldStop("r5") {
		t.Fatalf("运行应处于已请求停止状态")
	}
}

// TestGovResetRunningTaskOnlyResetsRunning：复位只对 running 生效，避免把成功的任务改成失败
func TestGovResetRunningTaskOnlyResetsRunning(t *testing.T) {
	setupGovStopTest(t)

	governanceTasks["ok"] = &GovernanceTask{ID: "ok", Status: "success"}
	governanceTasks["run"] = &GovernanceTask{ID: "run", Status: "running", RunID: "rr"}

	if govResetRunningTask("ok", govStopReasonStopped) {
		t.Fatalf("非 running 状态不应被复位")
	}
	if governanceTasks["ok"].Status != "success" {
		t.Fatalf("成功的任务不能被改成失败，实际 %q", governanceTasks["ok"].Status)
	}
	if !govResetRunningTask("run", govStopReasonStopped) {
		t.Fatalf("running 状态应被复位")
	}
	if governanceTasks["run"].Status != "error" {
		t.Fatalf("复位后应为 error，实际 %q", governanceTasks["run"].Status)
	}
}

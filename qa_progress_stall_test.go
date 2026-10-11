package main

import (
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// 质量审核「卡死看不出来 / 取消不动」回归测试
//
// 用户原话：「数据质量审核容易卡死在某个地方一直运行，可能是在生成 word 阶段，
// 但是以为还在运行最后一项」。
//
// 这句话精确对应两个可测的事实缺陷，分别钉在下面两个测试里：
//   ① 阶段切换时没清 Current → 界面还在显示「正在执行：<最后一条规则名>」，
//      而实际上已经进到「生成报告」了。用户据此判断「还在跑最后一项」，其实早跑完了。
//   ② 旧界面没有任何「多久没动静」的信息 → 真卡死和正常跑长得一模一样。
//
// 这两个缺陷都是「静默」的：不报错、不崩、日志干净，只是让人误判。
// 所以必须有断言守着，否则重构一次就会悄悄回来。
// ---------------------------------------------------------------------------

// cleanupQAProgressForTest 把测试用的 run 从全局进度表里摘掉。
//
// 必须清理：qaProgressMap / qaProgressSeq 是包级全局的，测试之间会互相看见对方
// 残留的「运行中」进度，导致 qaProgressActive 之类的断言莫名其妙地变红（或假绿）。
func cleanupQAProgressForTest(runID string) {
	qaProgressMu.Lock()
	defer qaProgressMu.Unlock()
	delete(qaProgressMap, runID)
	for i, id := range qaProgressSeq {
		if id == runID {
			qaProgressSeq = append(qaProgressSeq[:i], qaProgressSeq[i+1:]...)
			break
		}
	}
}

// ① 阶段切换必须清空「当前项」。
//
// 这是用户那句「以为还在运行最后一项」的直接病根：规则阶段结束后进入报告阶段，
// 如果 Current 还留着最后一条规则名，前端就会一直显示「正在执行：XX规则」。
func TestQASetPhaseClearsCurrentItem(t *testing.T) {
	p := qaProgressStart("run-phase-1", "sched-1", "日报审核", "manual")
	t.Cleanup(func() { cleanupQAProgressForTest("run-phase-1") })

	p.addTotal(3)
	p.setPhase("rules", "执行审核规则")
	p.tick("规则A")
	p.tick("规则B")
	p.tick("规则C")

	snap := p.snapshot()
	if snap["current"] != "规则C" {
		t.Fatalf("规则阶段应显示当前项「规则C」，实际 %q", snap["current"])
	}

	// 切到报告阶段 —— 这一步必须以「当前项为空」收场
	p.setPhase("report", "生成审核报告")

	snap = p.snapshot()
	if snap["phase"] != "report" {
		t.Fatalf("阶段应为 report，实际 %v", snap["phase"])
	}
	if got, _ := snap["current"].(string); got != "" {
		t.Fatalf("切到报告阶段后 current 仍为 %q —— 界面会显示「正在执行：%s」，"+
			"用户就会误以为还在跑最后一项规则（而他其实早就跑完了）", got, got)
	}
	if snap["current_elapsed_ms"].(int64) != -1 {
		t.Fatalf("current 已清空时 current_elapsed_ms 应为 -1（未知），实际 %v", snap["current_elapsed_ms"])
	}
}

// ② 停滞必须可观测：idle_ms 反映「距上次进展多久」，stale 只在超过阈值时为真。
func TestQASnapshotIdleMsAndStale(t *testing.T) {
	// 阈值调小，测试不用真等 2 分钟
	t.Setenv("DT_QA_STALE_IDLE_MS", "50")

	p := qaProgressStart("run-stall-1", "sched-1", "日报审核", "manual")
	t.Cleanup(func() { cleanupQAProgressForTest("run-stall-1") })
	p.addTotal(5)
	p.setPhase("report", "生成审核报告")

	snap := p.snapshot()
	if snap["status"] != "running" {
		t.Fatalf("状态应为 running，实际 %v", snap["status"])
	}
	if snap["stale"] != false {
		t.Fatalf("刚切完阶段就报 stale（idle_ms=%v）—— 会误报卡死，用户会去点取消，"+
			"把正常跑的执行打断", snap["idle_ms"])
	}
	if snap["stale_threshold_ms"].(int64) != 50 {
		t.Fatalf("阈值应取环境变量 50，实际 %v", snap["stale_threshold_ms"])
	}

	// 等过阈值：一直没有任何进展 → 必须报 stale
	time.Sleep(80 * time.Millisecond)
	snap = p.snapshot()
	if idle := snap["idle_ms"].(int64); idle < 50 {
		t.Fatalf("idle_ms 应 >= 50，实际 %d —— 停滞时长算错了，看门狗会误判", idle)
	}
	if snap["stale"] != true {
		t.Fatalf("超过 %v ms 无进展却没报 stale —— 真卡死仍然看不出来，用户还是只能干等",
			snap["stale_threshold_ms"])
	}

	// 任何一次 tick 都要把 idle 打回新鲜，否则一次慢规则之后会永久显示「疑似卡住」
	p.tick("报告已生成 1/3")
	snap = p.snapshot()
	if snap["stale"] != false {
		t.Fatalf("有进展之后仍报 stale（idle_ms=%v）—— 会一直显示「疑似卡住」，"+
			"警告就没意义了", snap["idle_ms"])
	}
}

// ③ 已结束的执行不该被当成「疑似卡住」，也不该还能被取消。
func TestQASnapshotNoStaleAfterFinish(t *testing.T) {
	t.Setenv("DT_QA_STALE_IDLE_MS", "1")

	p := qaProgressStart("run-done-1", "sched-1", "日报审核", "manual")
	t.Cleanup(func() { cleanupQAProgressForTest("run-done-1") })
	p.addTotal(1)
	p.setPhase("report", "生成审核报告")
	p.tick("done")
	p.finish("success", "")

	time.Sleep(30 * time.Millisecond)
	snap := p.snapshot()
	if snap["status"] != "success" {
		t.Fatalf("状态应为 success，实际 %v", snap["status"])
	}
	if snap["stale"] != false {
		t.Fatal("已成功的执行不该报 stale —— 否则界面上一个跑完的任务挂着「疑似卡住」的警告")
	}
	if snap["cancelable"] != false {
		t.Fatal("已结束的执行不该可取消 —— 否则取消按钮会打到没有意义的目标上")
	}
}

package main

import (
	"strconv"
	"testing"
)

// 进度快照：总数/已完成/百分比/ETA 的计算规则。
func TestQAProgressSnapshot(t *testing.T) {
	p := qaProgressStart("run-test-1", "sched-1", "日报审核", "manual")
	p.addTotal(10)
	p.setPhase("rules", "执行审核规则")

	snap := p.snapshot()
	if snap["status"] != "running" {
		t.Fatalf("状态应为 running，实际 %v", snap["status"])
	}
	if snap["total"].(int) != 10 {
		t.Fatalf("总数应为 10，实际 %v", snap["total"])
	}
	if snap["done"].(int) != 0 {
		t.Fatalf("已完成应为 0，实际 %v", snap["done"])
	}
	// 一项都没跑完时算不出 ETA
	if snap["eta_ms"].(int64) != -1 {
		t.Fatalf("done=0 时 eta 应为 -1（未知），实际 %v", snap["eta_ms"])
	}
	if snap["percent"].(float64) != 0 {
		t.Fatalf("done=0 时百分比应为 0，实际 %v", snap["percent"])
	}

	for i := 0; i < 5; i++ {
		p.tick("规则 " + strconv.Itoa(i))
	}
	snap = p.snapshot()
	if snap["done"].(int) != 5 {
		t.Fatalf("已完成应为 5，实际 %v", snap["done"])
	}
	if pct := snap["percent"].(float64); pct < 49 || pct > 51 {
		t.Fatalf("百分比应约 50，实际 %v", pct)
	}
	if snap["eta_ms"].(int64) < 0 {
		t.Fatalf("跑了一半应能给出 ETA，实际 %v", snap["eta_ms"])
	}
	if snap["current"].(string) != "规则 4" {
		t.Fatalf("当前项应为最后一项，实际 %v", snap["current"])
	}

	// 执行中即使 done==total 也不能显示 100%（还没落库）
	p.addTotal(1)
	snap = p.snapshot()
	if pct := snap["percent"].(float64); pct >= 100 {
		t.Fatalf("执行中不应显示 100%%，实际 %v", pct)
	}

	p.finish("success", "")
	snap = p.snapshot()
	if snap["status"] != "success" || snap["finished"] != true {
		t.Fatalf("结束后状态不对：%v %v", snap["status"], snap["finished"])
	}
	if snap["percent"].(float64) != 100 {
		t.Fatalf("结束后百分比应为 100，实际 %v", snap["percent"])
	}
	if snap["done"].(int) != snap["total"].(int) {
		t.Fatalf("结束后 done 应补齐为 total：%v / %v", snap["done"], snap["total"])
	}
	if snap["phase_label"] != "执行完成" {
		t.Fatalf("结束阶段文案不对：%v", snap["phase_label"])
	}

	// 已结束的不应再出现在「正在执行」列表里
	for _, a := range qaProgressActive() {
		if a["run_id"] == "run-test-1" {
			t.Fatalf("已结束的任务不该出现在 active 列表")
		}
	}
}

func TestQAProgressFailedAndTrim(t *testing.T) {
	p := qaProgressStart("run-test-2", "sched-2", "夜间审核", "cron")
	p.addTotal(3)
	p.tick("a")
	p.fail("连接失败: dial tcp timeout")
	p.finish("failed", "")

	snap := p.snapshot()
	if snap["status"] != "failed" {
		t.Fatalf("状态应为 failed，实际 %v", snap["status"])
	}
	if snap["error"] != "连接失败: dial tcp timeout" {
		t.Fatalf("失败原因丢失：%v", snap["error"])
	}
	if snap["trigger_type"] != "cron" {
		t.Fatalf("触发方式丢失：%v", snap["trigger_type"])
	}
	if snap["phase_label"] != "执行失败" {
		t.Fatalf("失败阶段文案不对：%v", snap["phase_label"])
	}

	// 内存里只保留最近 qaProgressKeep 条
	for i := 0; i < qaProgressKeep+10; i++ {
		qaProgressStart("run-trim-"+strconv.Itoa(i), "s", "t", "manual")
	}
	if got := len(qaProgressSeq); got > qaProgressKeep {
		t.Fatalf("进度记录未裁剪，当前 %d 条", got)
	}
	if qaProgressGet("run-trim-0") != nil {
		t.Fatalf("最老的进度记录应被裁剪掉")
	}
}

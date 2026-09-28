//go:build !windows

package main

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

// TestGovKillProcessTreeKillsGrandchildren 是「任务卡在运行中」那个 bug 的回归防线。
//
// 真实故障链：
//  1. exec.CommandContext 取消时只杀直接子进程，gov-runner 自己 fork 的孙进程活下来；
//  2. 孙进程继承了 stdout/stderr 管道的写端，Go 侧读管道永远等不到 EOF；
//  3. 于是 cmd.Run() 永不返回 -> worker 收不了尾 -> 活跃运行登记残留；
//  4. 看门狗因「仍有活跃运行」跳过复位 -> 任务永久卡在「运行中」。
//
// 本测试用一个会 fork 孙进程的替身脚本复现该结构，断言：
//   - cmd.Wait() 必须立刻返回（不是靠 WaitDelay 的 5s 宽限拖过去）
//   - 整个进程组必须全部消失（孙进程也被杀干净，不留孤儿）
func TestGovKillProcessTreeKillsGrandchildren(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("环境缺少 sh，跳过进程树测试")
	}

	dir := t.TempDir()
	stub := filepath.Join(dir, "stub-runner.sh")
	// 替身：后台孙进程 + 自身长睡；两者都继承 stdout（正是钉死管道的成因）
	body := "#!/bin/sh\nsleep 300 &\necho runner-started\nsleep 300\n"
	if err := os.WriteFile(stub, []byte(body), 0o755); err != nil {
		t.Fatalf("写替身脚本失败: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cmd := exec.CommandContext(ctx, stub)
	govConfigureProcessGroup(cmd)
	cmd.WaitDelay = govRunnerWaitDelay
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out

	if err := cmd.Start(); err != nil {
		t.Fatalf("启动替身失败: %v", err)
	}
	pid := cmd.Process.Pid
	time.Sleep(400 * time.Millisecond) // 等孙进程起来并握住管道

	govKillProcessTree(cmd)
	cancel()

	waitDone := make(chan error, 1)
	go func() { waitDone <- cmd.Wait() }()

	start := time.Now()
	select {
	case <-waitDone:
	case <-time.After(20 * time.Second):
		t.Fatalf("cmd.Wait() 20s 未返回：孙进程把 stdout 管道钉住了，worker 将永久卡死")
	}
	elapsed := time.Since(start)

	// 必须秒回：若只是靠 WaitDelay 兜底会耗满 5s，说明整组杀进程其实没生效
	if elapsed >= govRunnerWaitDelay {
		t.Fatalf("等待耗时 %s >= WaitDelay(%s)：说明进程树没被整组杀掉，只是被宽限期放行", elapsed, govRunnerWaitDelay)
	}

	time.Sleep(200 * time.Millisecond)
	if err := syscall.Kill(-pid, 0); err == nil {
		t.Fatalf("进程组 %d 仍有存活进程：孙进程未被清理，会变成孤儿残留", pid)
	}
}

//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// govConfigureProcessGroup 让 gov-runner 自成一个进程组。
//
// 为什么必须这么做：exec.CommandContext 在 ctx 取消 / 超时后只对**直接子进程**发信号。
// 如果 gov-runner 自己再 fork 出孙进程（生成代码里调 shell、python、node 等），
// 孙进程会活下来继续握着 stdout/stderr 管道的写端 —— 于是 Go 侧读管道的 goroutine
// 永远等不到 EOF，cmd.Run() 永不返回，worker 收不了尾，任务就永久卡在「运行中」。
// 放进独立进程组后，「停止」可以整组一刀切干净。
func govConfigureProcessGroup(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}

// govKillProcessTree 杀掉整个进程组（含孙进程）。进程尚未启动时静默返回。
func govKillProcessTree(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	pid := cmd.Process.Pid
	if pid <= 0 {
		return
	}
	// 负号 = 整个进程组；Setpgid 后子进程自己就是组长，组 id 等于其 pid
	if err := syscall.Kill(-pid, syscall.SIGKILL); err != nil {
		// 进程组不存在（可能刚退出）时退回单进程 kill，尽力而为
		_ = cmd.Process.Kill()
	}
}

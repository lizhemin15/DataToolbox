//go:build windows

package main

import (
	"os/exec"
	"strconv"
	"syscall"
)

// govConfigureProcessGroup Windows 下把 gov-runner 放进新进程组，
// 停止时用 taskkill /T 连子进程一起收掉（对应 unix 侧的 Setpgid）。
func govConfigureProcessGroup(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= syscall.CREATE_NEW_PROCESS_GROUP
}

// govKillProcessTree Windows 下杀整棵进程树。
func govKillProcessTree(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	pid := cmd.Process.Pid
	if pid <= 0 {
		return
	}
	if err := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(pid)).Run(); err != nil {
		_ = cmd.Process.Kill()
	}
}

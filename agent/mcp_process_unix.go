//go:build linux || darwin

package agent

import (
	"os/exec"
	"syscall"
)

func setSysProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func killProcessGroup(pid int, sig interface{}) error {
	if sig == "kill" {
		return syscall.Kill(-pid, syscall.SIGKILL)
	}
	return syscall.Kill(-pid, syscall.SIGTERM)
}
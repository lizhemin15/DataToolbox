//go:build windows

package agent

import (
	"os/exec"
)

func setSysProcAttr(cmd *exec.Cmd) {
	// Windows doesn't support Setpgid — no process group management needed.
}

func killProcessGroup(pid int, sig interface{}) error {
	// Windows doesn't support signal-based process group killing.
	// cmd.Process.Kill() handles this.
	return nil
}
package agent

import "os/exec"

// setSysProcAttr sets process group attributes for proper cleanup (Linux).
func setSysProcAttr(cmd *exec.Cmd) {
	// no-op on this platform stub
}

// killProcessGroup kills the entire process group.
func killProcessGroup(cmd *exec.Cmd) error {
	if cmd.Process != nil {
		return cmd.Process.Kill()
	}
	return nil
}

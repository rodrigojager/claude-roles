//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

const (
	detachedProcess        = 0x00000008
	createNewProcessGroup  = 0x00000200
	createBreakawayFromJob = 0x01000000
	createNoWindow         = 0x08000000
)

func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

// startDetached starts cmd outside the status line's process tree, so cancelling
// the status line (taskkill /T) does not reach it. Leaving a job that forbids it
// fails, so that is tried first and dropped if refused.
func startDetached(cmd *exec.Cmd) bool {
	for _, flags := range []uint32{
		detachedProcess | createNewProcessGroup | createBreakawayFromJob,
		detachedProcess | createNewProcessGroup,
	} {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: flags}
		if cmd.Start() == nil {
			return true
		}
		cmd.Process = nil
	}
	return false
}

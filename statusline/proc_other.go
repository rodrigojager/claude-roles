//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

func hideWindow(cmd *exec.Cmd) {}

// startDetached starts cmd in its own session, outside the status line's process group.
func startDetached(cmd *exec.Cmd) bool {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	return cmd.Start() == nil
}

package main

import (
	"runtime"
	"testing"
)

func TestGovRunnerCacheName(t *testing.T) {
	name := govRunnerCacheName()
	if runtime.GOOS == "windows" {
		if name != "gov-runner.exe" {
			t.Fatalf("expected windows cache name gov-runner.exe, got %q", name)
		}
		return
	}
	if name != "gov-runner" {
		t.Fatalf("expected non-windows cache name gov-runner, got %q", name)
	}
}

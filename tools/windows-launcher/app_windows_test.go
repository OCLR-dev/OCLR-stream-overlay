package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRetiredBackendCannotReplaceCurrentStatus(t *testing.T) {
	a := newLauncher(&diagnostics{})
	a.activePID = 22
	a.state.Status = "ready"
	a.state.Address = "http://127.0.0.1:3011"
	for _, old := range []*backend{{pid: 21, endpoint: a.state.Address}, {pid: 22, endpoint: "http://127.0.0.1:3001"}} {
		a.applyServiceState(old, serviceExited)
		if a.Snapshot().Status != "ready" {
			t.Fatal("retired backend changed current UI")
		}
	}
	current := &backend{pid: 22, endpoint: a.state.Address}
	a.applyServiceState(current, serviceWaiting)
	if a.Snapshot().Status != "waiting" {
		t.Fatal("health failure not visible")
	}
	a.applyServiceState(current, serviceReady)
	if a.Snapshot().Status != "ready" {
		t.Fatal("health recovery not visible")
	}
	a.state.Status = "stopping"
	a.applyServiceState(current, serviceExited)
	if a.Snapshot().Status != "stopping" {
		t.Fatal("exit callback replaced save progress")
	}
	a.state.Status = "failed"
	a.state.Notice = "new launch failed"
	a.applyServiceState(current, serviceExited)
	if a.Snapshot().Notice != "new launch failed" {
		t.Fatal("retired exit hid the new launch failure")
	}
}

func TestLauncherRejectsConcurrentAndClosingMutations(t *testing.T) {
	a := newLauncher(&diagnostics{})
	a.state.Busy = false
	if err := a.begin(); err != nil {
		t.Fatal(err)
	}
	if err := a.StartTosu(); err == nil {
		t.Fatal("concurrent action accepted")
	}
	if err := a.ChooseTool("tosu"); err == nil {
		t.Fatal("picker opened during an action")
	}
	a.end()
	a.closing = true
	if err := a.OpenControl(); err == nil {
		t.Fatal("action accepted while closing")
	}
	if a.Snapshot().Busy {
		t.Fatal("rejected action left busy state behind")
	}
}

func TestInvalidRestartAndToolNeverWritePreferences(t *testing.T) {
	local := t.TempDir()
	t.Setenv("LOCALAPPDATA", local)
	a := newLauncher(&diagnostics{})
	for _, port := range []string{"0", "65536", "3001\n", "3001;shutdown", "http://example.com"} {
		if err := a.Restart(port); err == nil {
			t.Fatal("invalid port accepted", port)
		}
	}
	if err := a.ChooseTool("shell"); err == nil {
		t.Fatal("arbitrary tool accepted")
	}
	if _, err := os.Stat(filepath.Join(local, "OCLR")); !os.IsNotExist(err) {
		t.Fatal("invalid input changed local preferences")
	}
}

func TestNativeSelectionPreservesOtherToolAndDoesNotPublishFailedSave(t *testing.T) {
	local := t.TempDir()
	t.Setenv("LOCALAPPDATA", local)
	exe := filepath.Join(t.TempDir(), "tosu.exe")
	if err := os.WriteFile(exe, []byte("synthetic fixture, never launched"), 0600); err != nil {
		t.Fatal(err)
	}
	a := newLauncher(&diagnostics{})
	a.state.OsuPath = "previous-osu.exe"
	if err := a.saveTool("tosu", exe); err != nil {
		t.Fatal(err)
	}
	path, _ := launcherSettingsPath()
	saved, err := loadLauncherSettings(path)
	if err != nil || saved.TosuPath != exe || saved.OsuPath != "previous-osu.exe" {
		t.Fatal("selection lost another preference", err)
	}
	blocked := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocked, []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LOCALAPPDATA", blocked)
	before := a.Snapshot()
	if err := a.saveTool("tosu", exe); err == nil {
		t.Fatal("save should fail")
	}
	if a.Snapshot() != before {
		t.Fatal("failed save changed UI preferences")
	}
}

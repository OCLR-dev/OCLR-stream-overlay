package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesktopBrowserDestinations(t *testing.T) {
	const endpoint = "http://127.0.0.1:42601"
	for _, tc := range []struct {
		destination, edition, expected string
	}{
		{"control", "", endpoint + "/control"},
		{"showcase", "", endpoint + "/showcase"},
		{"overlay", "", endpoint + "/overlay"},
		{"showcase-output", "", endpoint + "/showcase?clean=1"},
		{"streaming-login", "s12-pro", endpoint + "/control?desktop-login=s12-pro"},
		{"streaming-page", "s11", "https://oclr.org/streaming/s11"},
		{"https://example.org/", "", ""},
		{"file:///C:/Windows/notepad.exe", "", ""},
		{"streaming-login", "s11&token=example", ""},
		{"streaming-page", "../settings", ""},
	} {
		got, err := browserDestination(endpoint, tc.destination, tc.edition)
		if got != tc.expected || (err == nil) != (tc.expected != "") {
			t.Errorf("%s(%q) = %q, %v; want %q", tc.destination, tc.edition, got, err, tc.expected)
		}
	}
}

func TestTosuStartupAdviceAndModalRecheck(t *testing.T) {
	for _, tc := range []struct {
		name                    string
		first, after, osu       processStatus
		accept, want, wantError bool
		checks, prompts         int
	}{
		{"osu running", processStopped, processStopped, processRunning, false, true, false, 1, 0},
		{"cancel advice", processStopped, processStopped, processStopped, false, false, false, 1, 1},
		{"accept advice", processStopped, processStopped, processStopped, true, true, false, 2, 1},
		{"osu unknown", processStopped, processStopped, processUnknown, true, true, false, 2, 1},
		{"tosu started during modal", processStopped, processRunning, processStopped, true, false, false, 2, 1},
		{"file removed during modal", processStopped, processMissing, processStopped, true, false, true, 2, 1},
		{"already running", processRunning, processRunning, processStopped, true, false, false, 1, 0},
		{"unknown blocks duplicate", processUnknown, processUnknown, processRunning, true, false, true, 1, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			checks, prompts := 0, 0
			ok, err := allowTosuStart("selected tosu", "selected osu", func(path string) processStatus {
				if path != "selected tosu" {
					t.Fatal("wrong executable")
				}
				checks++
				if checks == 1 {
					return tc.first
				}
				return tc.after
			}, func(path string) processStatus {
				if path != "selected osu" {
					t.Fatal("wrong osu selection")
				}
				return tc.osu
			}, func(title, body string) bool {
				prompts++
				if !strings.Contains(body, "先打开 osu!Tourney") || (tc.osu == processUnknown && !strings.Contains(body, "无法确认")) {
					t.Fatal("missing advice", body)
				}
				return tc.accept
			})
			if ok != tc.want || (err != nil) != tc.wantError || checks != tc.checks || prompts != tc.prompts {
				t.Fatalf("allowed=%v error=%v checks=%d prompts=%d", ok, err, checks, prompts)
			}
		})
	}
}

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
	if err := a.OpenBrowser("control", ""); err == nil {
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

func TestChoosingOsuDoesNotPersistDetectedBundledTosu(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	exe := filepath.Join(t.TempDir(), "osu!.exe")
	if err := os.WriteFile(exe, []byte("synthetic"), 0600); err != nil {
		t.Fatal(err)
	}
	a := newLauncher(&diagnostics{})
	a.state.TosuPath = filepath.Join(t.TempDir(), "tosu", "tosu.exe")
	if err := a.saveTool("osu", exe); err != nil {
		t.Fatal(err)
	}
	path, _ := launcherSettingsPath()
	saved, err := loadLauncherSettings(path)
	if err != nil || saved.TosuPath != "" || saved.OsuPath != exe {
		t.Fatal("portable default was persisted", saved, err)
	}
}

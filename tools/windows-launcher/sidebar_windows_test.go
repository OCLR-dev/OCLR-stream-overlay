package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"unsafe"
)

func TestLauncherSidebarShowsPageControlsAndPreservesSettings(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	previousLog := localLog
	localLog = &diagnostics{path: filepath.Join(t.TempDir(), "launcher.log")}
	defer func() { localLog = previousLog }()
	localLog.record("launcher ready")

	cleanup := createLauncherWindow()
	if cleanup == nil {
		t.Fatal("failed to create the native window")
	}
	defer func() {
		call(user, "DestroyWindow", window)
		var pending msg
		call(user, "PeekMessageW", uintptr(unsafe.Pointer(&pending)), 0, 0x0012, 0x0012, 1) // Remove WM_QUIT from this test.
		cleanup()
	}()
	visible := func(id uintptr) bool {
		control := call(user, "GetDlgItem", window, id)
		if control == 0 {
			t.Fatalf("missing control %d", id)
		}
		return call(user, "GetWindowLongW", control, ^uintptr(15))&0x10000000 != 0 // GWL_STYLE, WS_VISIBLE
	}
	readControl := func(control uintptr) string {
		var buffer [512]uint16
		call(user, "GetWindowTextW", control, uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)))
		return syscall.UTF16ToString(buffer[:])
	}
	groups := [pageCount][]uintptr{
		{buttonControl, buttonCopyOBS, buttonTosu, buttonOpenTourney},
		{editServicePort, buttonRestart, buttonCopyAddresses, buttonChoose, buttonChooseOsu, buttonGenerateTourney},
		{buttonOpenLog, editLogPreview},
		{buttonProject},
	}
	assertPage := func(want launcherPage) {
		t.Helper()
		for page, ids := range groups {
			for _, id := range ids {
				if visible(id) != (launcherPage(page) == want) {
					t.Errorf("control %d has wrong visibility on page %d", id, want)
				}
			}
		}
		for id := buttonOverview; id <= buttonAbout; id++ {
			if !visible(uintptr(id)) {
				t.Errorf("sidebar item %d disappeared on page %d", id, want)
			}
		}
	}
	navigate := func(id uintptr) {
		call(user, "SendMessageW", window, 0x0111, id, 0) // WM_COMMAND
	}

	assertPage(pageOverview)
	navigate(buttonSettings)
	assertPage(pageSettings)
	setText(portField, "3456")
	navigate(buttonLogs)
	assertPage(pageLogs)
	if got := readControl(logPreview); !strings.Contains(got, "launcher ready") {
		t.Fatalf("logs page did not show the local log: %q", got)
	}
	navigate(buttonAbout)
	assertPage(pageAbout)
	navigate(buttonSettings)
	if got := readControl(portField); got != "3456" {
		t.Fatalf("switching pages discarded the port input: %q", got)
	}
	localLog.record("service ready on new port")
	navigate(buttonLogs)
	if got := readControl(logPreview); !strings.Contains(got, "service ready on new port") {
		t.Fatalf("reopening logs did not show the latest entry: %q", got)
	}
}

func TestLauncherLogPreviewBoundsAndTruncatesOnLineBoundary(t *testing.T) {
	log := &diagnostics{path: filepath.Join(t.TempDir(), "launcher.log")}
	if got, err := log.preview(); got != "" || err != nil {
		t.Fatalf("expected an empty preview for a new profile, got %q, %v", got, err)
	}
	line := "2026-01-01T00:00:00Z service restarted 此处为测试记录\r\n"
	content := "old log entry\r\n" + strings.Repeat(line, previewLimit/len(line)+2) + "latest\x00entry\r\n"
	if err := os.WriteFile(log.path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := log.preview()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) > previewLimit || !strings.HasPrefix(got, line) || !strings.HasSuffix(got, "latest�entry\r\n") {
		t.Fatal("preview did not retain complete, bounded recent log lines")
	}
}

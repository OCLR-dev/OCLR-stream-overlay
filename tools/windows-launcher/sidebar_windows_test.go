package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

func TestLauncherSidebarShowsPageControlsAndPreservesSettings(t *testing.T) {
	previousLog := localLog
	localLog = &diagnostics{path: filepath.Join(t.TempDir(), "launcher.log")}
	defer func() { localLog = previousLog }()
	localLog.record("launcher ready")

	created, done := make(chan struct{}), make(chan struct{})
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer close(done)
		wnd, cleanup := newLauncherWindow(func() { close(created) })
		defer cleanup()
		wnd.RunAsMain()
	}()
	select {
	case <-created:
	case <-time.After(10 * time.Second):
		t.Fatal("Windigo did not create the native window")
	}
	defer func() {
		call(user, "PostMessageW", window, 0x0010, 0, 0) // WM_CLOSE
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Error("Windigo did not close the native window")
		}
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
		control := call(user, "GetDlgItem", window, id)
		call(user, "SendMessageW", control, 0x00F5, 0, 0) // BM_CLICK
	}

	assertPage(pageOverview)
	navigate(buttonSettings)
	assertPage(pageSettings)
	assertSidebarFocusPaint(t)
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

func assertSidebarFocusPaint(t *testing.T) {
	t.Helper()
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	screen := call(user, "GetDC", window)
	if screen == 0 {
		t.Fatal("could not get a launcher drawing context")
	}
	defer call(user, "ReleaseDC", window, screen)
	dc := call(gdi, "CreateCompatibleDC", screen)
	bitmap := call(gdi, "CreateCompatibleBitmap", screen, px(128), px(36))
	if dc == 0 || bitmap == 0 {
		t.Fatal("could not create a sidebar test surface")
	}
	defer call(gdi, "DeleteDC", dc)
	defer call(gdi, "DeleteObject", bitmap)
	previous := call(gdi, "SelectObject", dc, bitmap)
	defer call(gdi, "SelectObject", dc, previous)

	item := drawItem{ControlType: 4, ControlID: buttonSettings, DC: dc,
		Item: call(user, "GetDlgItem", window, buttonSettings), Bounds: area(0, 0, 128, 36)}
	item.State = 0x0010 | 0x0200                                                               // Focus without a visible cue.
	call(user, "SendMessageW", window, 0x002B, buttonSettings, uintptr(unsafe.Pointer(&item))) // WM_DRAWITEM
	if got := color(call(gdi, "GetPixel", dc, px(5), px(18))); got != activeColor {
		t.Errorf("hidden focus changed the page highlight: %#x", got)
	}

	item.State = 0x0010 // Visible keyboard focus.
	call(user, "SendMessageW", window, 0x002B, buttonSettings, uintptr(unsafe.Pointer(&item)))
	if got := color(call(gdi, "GetPixel", dc, px(5), px(18))); got != accentColor {
		t.Errorf("keyboard focus mark was not drawn: %#x", got)
	}
	for x := px(40); x < px(120); x++ {
		if got := color(call(gdi, "GetPixel", dc, x, px(4))); got != activeColor {
			t.Errorf("sidebar focus painted a box over the label at pixel %d: %#x", x, got)
			break
		}
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

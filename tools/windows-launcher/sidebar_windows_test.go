package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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

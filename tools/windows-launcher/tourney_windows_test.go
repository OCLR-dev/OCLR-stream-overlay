package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTournamentConfigUsesAuthorizedEdition(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tournament.cfg")
	backup := path + ".oclr.bak"
	read := func(path string) string {
		t.Helper()
		content, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return string(content)
	}
	want := "TeamSize = 4\r\nHeight = 1080\r\nacronym = OCLR S12\r\nprivateserver = \r\n" +
		"BufferTotalTime = 3000\r\nBufferDangerTime = 1000\r\nBufferTimeoutTime = 20000\r\n" +
		"ClientNameSize = 56\r\nContactTime = 10000\r\nRankingChatDelay = 15000\r\nStartupDelay = 0\r\nAspect = 2\r\n"
	if err := writeTournamentConfig(dir, "s12"); err != nil {
		t.Fatal(err)
	}
	if got := read(path); got != want {
		t.Fatalf("unexpected tournament.cfg: %q", got)
	}
	for _, edition := range []string{"", "s13\r\nTeamSize = 1", "s 13", strings.Repeat("a", 81)} {
		if err := writeTournamentConfig(dir, edition); err == nil {
			t.Fatalf("accepted invalid edition %q", edition)
		}
	}
	if got := read(path); got != want {
		t.Fatalf("invalid edition changed tournament.cfg: %q", got)
	}
	for i := 0; i < 2; i++ {
		if err := writeTournamentConfig(dir, "s13"); err != nil {
			t.Fatal(err)
		}
		if got := read(path); got != strings.Replace(want, "OCLR S12", "OCLR S13", 1) {
			t.Fatalf("changed edition did not update the config: %q", got)
		}
		if got := read(backup); got != want {
			t.Fatalf("previous config was not preserved: %q", got)
		}
	}
}

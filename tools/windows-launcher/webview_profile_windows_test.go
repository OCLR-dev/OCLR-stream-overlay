package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWebviewProfilesIsolateLaunchesAndPruneOnlyRetiredCaches(t *testing.T) {
	settings := t.TempDir()
	cache := filepath.Join(settings, "WebView2Sessions")
	active, activeLease, err := newWebviewProfile(cache)
	if err != nil {
		t.Fatal(err)
	}
	defer activeLease.Close()
	retired, retiredLease, err := newWebviewProfile(cache)
	if err != nil {
		t.Fatal(err)
	}
	if err := retiredLease.Close(); err != nil {
		t.Fatal(err)
	}
	if active == retired {
		t.Fatal("independent launches used the same profile")
	}
	for _, dir := range []string{active, retired, filepath.Join(settings, "WebView2"), filepath.Join(cache, "session-unmanaged")} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "cache-file"), []byte("test"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	pruneWebviewProfiles(cache, time.Now())
	if _, err := os.Stat(retired); err != nil {
		t.Fatal("recently closed WebView cache was pruned:", err)
	}
	pruneWebviewProfiles(cache, time.Now().Add(2*webviewProfileGrace))
	if _, err := os.Stat(filepath.Dir(retired)); !os.IsNotExist(err) {
		t.Fatal("retired profile directory was not pruned:", err)
	}
	for _, dir := range []string{active, filepath.Join(settings, "WebView2"), filepath.Join(cache, "session-unmanaged")} {
		if _, err := os.Stat(filepath.Join(dir, "cache-file")); err != nil {
			t.Fatal("pruned active, legacy, or unmanaged data:", err)
		}
	}
}

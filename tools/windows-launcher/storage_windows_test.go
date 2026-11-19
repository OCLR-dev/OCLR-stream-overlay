package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestPortableStorageCopiesOnceAndKeepsBothProfiles(t *testing.T) {
	local, packageDir := t.TempDir(), t.TempDir()
	t.Setenv("LOCALAPPDATA", local)
	appData := filepath.Join(local, "OCLR")
	write := func(path, value string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	read := func(path, want string) {
		t.Helper()
		if data, err := os.ReadFile(path); err != nil || string(data) != want {
			t.Fatalf("read %s: %q, %v", path, data, err)
		}
	}
	mode, err := detectStorage(packageDir)
	if err != nil || mode.enabled {
		t.Fatalf("default mode: %+v, %v", mode, err)
	}
	osu := filepath.Join(packageDir, "tools", "osu!.exe")
	preferences, _ := mode.settingsPath()
	if err := saveLauncherSettings(preferences, launcherSettings{OsuPath: osu}); err != nil {
		t.Fatal(err)
	}
	session := filepath.Join("StreamOverlay", "session.json")
	showcase := filepath.Join("StreamOverlay", "showcase.json")
	archive := filepath.Join("StreamOverlay", "archive", "match.json")
	port := filepath.Join("StreamOverlayLauncher", "service-port.txt")
	cache := filepath.Join("StreamOverlayLauncher", "WebView2Sessions", "locked-file")
	for path, contents := range map[string]string{session: "session", showcase: "showcase", archive: "archive", port: "3456", cache: "cache"} {
		write(filepath.Join(appData, path), contents)
	}
	if err := mode.change(true); err != nil {
		t.Fatal(err)
	}
	mode, err = detectStorage(packageDir)
	if err != nil || !mode.enabled {
		t.Fatalf("portable mode: %+v, %v", mode, err)
	}
	root, _ := mode.root()
	for path, contents := range map[string]string{session: "session", showcase: "showcase", archive: "archive", port: "3456"} {
		read(filepath.Join(root, path), contents)
	}
	if _, err := os.Stat(filepath.Join(root, cache)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("old WebView profile was copied: %v", err)
	}
	settings, _ := mode.settingsPath()
	prefs, err := loadLauncherSettings(settings)
	if err != nil || prefs.OsuPath != `.\tools\osu!.exe` || mode.readTool(prefs.OsuPath) != osu {
		t.Fatalf("portable tool path: %+v, %v", prefs, err)
	}
	moved := portableStorage{packageDir: t.TempDir(), enabled: true}
	if got := moved.readTool(prefs.OsuPath); got != filepath.Join(moved.packageDir, "tools", "osu!.exe") {
		t.Fatalf("relative tool path did not move with package: %q", got)
	}
	if mode.storeTool(preferences) != preferences || filepath.IsAbs(mode.readTool(`.\..\external.exe`)) {
		t.Fatal("a path outside the package was stored as portable")
	}
	write(filepath.Join(root, session), "portable edit")
	if err := mode.change(false); err != nil {
		t.Fatal(err)
	}
	mode, err = detectStorage(packageDir)
	if err != nil || mode.enabled {
		t.Fatalf("returned mode: %+v, %v", mode, err)
	}
	read(filepath.Join(appData, session), "session")
	if err := mode.change(true); err != nil {
		t.Fatal(err)
	}
	read(filepath.Join(root, session), "portable edit")
}

func TestPortableStorageConflictLeavesModeAndOriginalDataAlone(t *testing.T) {
	packageDir := t.TempDir()
	mode := portableStorage{packageDir: packageDir}
	if err := os.WriteFile(mode.portableRoot(), []byte("keep this file"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := mode.change(true); err == nil {
		t.Fatal("expected a file-versus-directory conflict")
	}
	if _, err := os.Stat(filepath.Join(packageDir, storageMarker)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("mode changed after failed copy: %v", err)
	}
	if data, err := os.ReadFile(mode.portableRoot()); err != nil || string(data) != "keep this file" {
		t.Fatalf("original destination changed: %q, %v", data, err)
	}
}

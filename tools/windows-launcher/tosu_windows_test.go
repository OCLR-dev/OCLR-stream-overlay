package main

import (
	"net"
	"os"
	"path/filepath"
	"testing"
)

func TestTosuProcessMatchesFullPath(t *testing.T) {
	current, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if got := findTosu(current); got != tosuRunning {
		image, imageErr := processImage(uint32(os.Getpid()))
		t.Fatalf("running executable %q was not detected: %d (process image %q, %v)", current, got, image, imageErr)
	}
	if !sameExecutable(current, `\\?\`+current) {
		t.Fatal("the extended-length spelling of the same path was not detected")
	}
	other := filepath.Join(t.TempDir(), filepath.Base(current))
	if err := os.WriteFile(other, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := findTosu(other); got != tosuStopped {
		t.Fatalf("same name in another directory was mistaken for the selected program: %d", got)
	}
}

func TestTosuPortCheck(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	address := listener.Addr().String()
	if !tosuPortOpen(address) {
		t.Fatal("expected the loopback port to be reachable")
	}
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	if tosuPortOpen(address) {
		t.Fatal("closed loopback port reported reachable")
	}
}

func TestTosuPreferenceSurvivesReloadAndInvalidSelection(t *testing.T) {
	local := t.TempDir()
	t.Setenv("LOCALAPPDATA", local)
	settingsFile, err := launcherSettingsPath()
	if err != nil {
		t.Fatal(err)
	}
	if settings, err := loadLauncherSettings(settingsFile); err != nil || settings.TosuPath != "" {
		t.Fatalf("expected a new profile, got %+v, %v", settings, err)
	}
	bin := filepath.Join(local, "实况 工具")
	if err := os.Mkdir(bin, 0700); err != nil {
		t.Fatal(err)
	}
	first := filepath.Join(bin, "tosu.exe")
	second := filepath.Join(bin, "tosu 新版.EXE")
	for _, path := range []string{first, second} {
		if err := os.WriteFile(path, []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := saveTosuPath(settingsFile, path); err != nil {
			t.Fatal(err)
		}
		settings, err := loadLauncherSettings(settingsFile)
		if err != nil || settings.TosuPath != path {
			t.Fatalf("saved selection did not reload: %+v, %v", settings, err)
		}
	}
	for _, path := range []string{"tosu.exe", bin, filepath.Join(bin, "missing.exe")} {
		if err := saveTosuPath(settingsFile, path); err == nil {
			t.Fatalf("saved invalid executable %q", path)
		}
	}
	settings, err := loadLauncherSettings(settingsFile)
	if err != nil || settings.TosuPath != second {
		t.Fatalf("invalid selection replaced a valid preference: %+v, %v", settings, err)
	}
	if _, err := os.Stat(filepath.Join(local, "OCLR", "StreamOverlay")); !os.IsNotExist(err) {
		t.Fatalf("launcher preferences must not initialize the match directory: %v", err)
	}
}

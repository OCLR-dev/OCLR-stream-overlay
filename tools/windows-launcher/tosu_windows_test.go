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
	if got := findExecutableProcess(current); got != processRunning {
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
	if got := findExecutableProcess(other); got != processStopped {
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

func TestLauncherPreferencesSurviveReloadAndOldSettings(t *testing.T) {
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
	osu := filepath.Join(bin, "osu!.exe")
	for _, path := range []string{first, second, osu} {
		if err := os.WriteFile(path, []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, want := range []launcherSettings{{TosuPath: first}, {TosuPath: first, OsuPath: osu}, {TosuPath: second, OsuPath: osu}} {
		if err := saveLauncherSettings(settingsFile, want); err != nil {
			t.Fatal(err)
		}
		settings, err := loadLauncherSettings(settingsFile)
		if err != nil || settings != want {
			t.Fatalf("saved selection did not reload: %+v, %v", settings, err)
		}
	}
	for _, path := range []string{"osu!.exe", bin, second, filepath.Join(local, "osu!.exe")} {
		if isOsuExecutable(path) {
			t.Fatalf("accepted invalid osu! executable %q", path)
		}
	}
	if !isOsuExecutable(osu) {
		t.Fatal("a valid osu!.exe was rejected")
	}
	if _, err := os.Stat(filepath.Join(local, "OCLR", "StreamOverlay")); !os.IsNotExist(err) {
		t.Fatalf("launcher preferences must not initialize the match directory: %v", err)
	}
}

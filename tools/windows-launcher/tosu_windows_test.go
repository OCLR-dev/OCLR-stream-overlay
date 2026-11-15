package main

import (
	"errors"
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

func TestTosuProbeReadsPortFromSelectedDirectoryOnEveryCheck(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	address := listener.Addr().String()
	_, port, err := net.SplitHostPort(address)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	exe := filepath.Join(dir, "tosu.exe")
	if err := os.WriteFile(exe, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	probe := probeTosu(exe, 2)
	if !errors.Is(probe.portErr, os.ErrNotExist) || probe.port != "" || probe.portOpen {
		t.Fatalf("missing tosu.env should leave the port unknown: %+v", probe)
	}
	env := filepath.Join(dir, "tosu.env")
	if err := os.WriteFile(env, []byte("SERVER_IP=127.0.0.1\r\nSERVER_PORT="+port+"\r\n"), 0600); err != nil {
		t.Fatal(err)
	}
	probe = probeTosu(exe, 2)
	if probe.portErr != nil || probe.address() != address || !probe.portOpen || probe.selection != 2 {
		t.Fatalf("expected the configured endpoint to be reachable: %+v", probe)
	}
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	probe = probeTosu(exe, 2)
	if probe.portErr != nil || probe.address() != address || probe.portOpen {
		t.Fatalf("closed port reported reachable: %+v", probe)
	}
	if err := os.WriteFile(env, []byte("SERVER_PORT=65536"), 0600); err != nil {
		t.Fatal(err)
	}
	probe = probeTosu(exe, 2)
	if !errors.Is(probe.portErr, errTosuPortInvalid) || probe.port != "" || probe.portOpen {
		t.Fatalf("invalid edited config should clear the old port: %+v", probe)
	}
}

func TestReadTosuPort(t *testing.T) {
	dir := t.TempDir()
	for _, tc := range []struct {
		name, content, port string
		err                 error
	}{
		{name: "provided format", content: "DEBUG_LOG=false\n\nSERVER_IP=127.0.0.1\nSERVER_PORT=24050\nALLOWED_IPS=127.0.0.1,localhost,absolute", port: "24050"},
		{name: "BOM and Windows lines", content: "\uFEFF SERVER_PORT = \"25678\" # local\r\n", port: "25678"},
		{name: "last assignment and highest port", content: "SERVER_PORT=24050\nSERVER_PORT='65535'\n", port: "65535"},
		{name: "commented out", content: "# SERVER_PORT=24050\nOTHER_SERVER_PORT=26300", err: errTosuPortMissing},
		{name: "empty", content: "SERVER_PORT= # missing value", err: errTosuPortInvalid},
		{name: "non-numeric", content: "SERVER_PORT=localhost:24050", err: errTosuPortInvalid},
		{name: "unmatched quote", content: "SERVER_PORT=\"24050", err: errTosuPortInvalid},
		{name: "zero", content: "SERVER_PORT=0", err: errTosuPortInvalid},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := os.WriteFile(filepath.Join(dir, "tosu.env"), []byte(tc.content), 0600); err != nil {
				t.Fatal(err)
			}
			port, err := readTosuPort(filepath.Join(dir, "tosu.exe"))
			if port != tc.port || !errors.Is(err, tc.err) {
				t.Fatalf("got port %q, error %v; want %q, %v", port, err, tc.port, tc.err)
			}
		})
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

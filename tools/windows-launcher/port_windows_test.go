package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestServicePortValidation(t *testing.T) {
	for _, value := range []string{"1", "3001", "3011", "65535"} {
		if !validServicePort(value) {
			t.Fatal(value)
		}
	}
	for _, value := range []string{"", "0", "65536", "-1", "1.5", "1e3", " 3011", "3011\n"} {
		if validServicePort(value) {
			t.Fatal(value)
		}
	}
}
func TestServicePortPersistsSeparatelyFromExecutablePreferences(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	oldPort, oldBase := servicePort, base
	defer func() { servicePort, base = oldPort, oldBase }()
	p := portSettingsPath()
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		t.Fatal(err)
	}
	if err := replaceFile(p, []byte("3011")); err != nil {
		t.Fatal(err)
	}
	prefs, _ := launcherSettingsPath()
	if err := saveLauncherSettings(prefs, launcherSettings{TosuPath: "synthetic.exe"}); err != nil {
		t.Fatal(err)
	}
	loadServicePort()
	if base != "http://127.0.0.1:3011" {
		t.Fatal(base)
	}
	if err := replaceFile(p, []byte("3012")); err != nil {
		t.Fatal(err)
	}
	loadServicePort()
	if servicePort != "3012" {
		t.Fatal(servicePort)
	}
}

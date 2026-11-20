package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

var servicePort = "3001"
var portField, addressLabel uintptr

func validServicePort(value string) bool {
	if value == "" {
		return false
	}
	for _, c := range value {
		if c < '0' || c > '9' {
			return false
		}
	}
	n, err := strconv.Atoi(value)
	return err == nil && n >= 1 && n <= 65535
}

func portSettingsPath() string {
	p, err := launcherSettingsPath()
	if err != nil {
		return ""
	}
	return filepath.Join(filepath.Dir(p), "service-port.txt")
}

func loadServicePort() {
	if data, err := os.ReadFile(portSettingsPath()); err == nil {
		value := strings.TrimSpace(string(data))
		if validServicePort(value) {
			servicePort = value
		}
	}
	base = "http://127.0.0.1:" + servicePort
}

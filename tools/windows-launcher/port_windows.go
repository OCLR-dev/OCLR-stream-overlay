package main

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"unsafe"
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

func saveServicePort(value string) (string, error) {
	if !validServicePort(value) {
		return "", errors.New("请输入 1–65535 的整数端口。")
	}
	number, _ := strconv.Atoi(value)
	port := strconv.Itoa(number)
	path := portSettingsPath()
	if path == "" || os.MkdirAll(filepath.Dir(path), 0700) != nil || replaceFile(path, []byte(port)) != nil {
		return "", errors.New("无法保存端口设置。")
	}
	return port, nil
}

func restartOnPort(h uintptr) {
	if starting || exiting || tourneyBusy {
		return
	}
	var value [64]uint16
	call(user, "GetWindowTextW", portField, uintptr(unsafe.Pointer(&value[0])), uintptr(len(value)))
	port := syscall.UTF16ToString(value[:])
	if !validServicePort(port) {
		message("请输入 1–65535 的整数端口。")
		return
	}
	if service != nil && !service.exited() {
		if call(user, "MessageBoxW", h, ptr("重新启动会暂时中断 OBS 输出与 OCLR 连接，比赛记录会保留。继续？"), ptr("重新启动服务"), 0x124) != 6 {
			return
		}
	}
	// Persist before stopping; a failed write must leave the live service intact.
	port, err := saveServicePort(port)
	if err != nil {
		message(err.Error())
		return
	}
	starting = true
	call(user, "EnableWindow", call(user, "GetDlgItem", h, buttonRestart), 0)
	enableServiceButtons(h, 0)
	if service != nil {
		service.stop("operator port restart")
	}
	service = nil
	servicePort = port
	base = "http://127.0.0.1:" + port
	setText(addressLabel, base+"/overlay")
	setStatus(serviceStatus, "● 正在启动", waitColor)
	text("正在重新启动；连接 OBS 后自动同步画面地址。")
	go func() {
		b, e := start(localLog)
		result <- started{b, e}
		call(user, "PostMessageW", h, msgServiceStarted, 0, 0)
	}()
}

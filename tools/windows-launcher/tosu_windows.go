package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var queryProcessImage = kernel.NewProc("QueryFullProcessImageNameW")

var errTosuPortMissing = errors.New("SERVER_PORT is missing")
var errTosuPortInvalid = errors.New("SERVER_PORT must be between 1 and 65535")

type launcherSettings struct {
	TosuPath      string `json:"tosuPath,omitempty"`
	OsuPath       string `json:"osuPath,omitempty"` // Existing Tourney selection.
	OsuStablePath string `json:"osuStablePath,omitempty"`
}

func launcherSettingsPath() (string, error) {
	return storage.settingsPath()
}

func loadLauncherSettings(path string) (launcherSettings, error) {
	var settings launcherSettings
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return settings, nil
	}
	if err != nil {
		return settings, err
	}
	err = json.Unmarshal(data, &settings)
	return settings, err
}

func isExecutable(path string) bool {
	if !filepath.IsAbs(path) || !strings.EqualFold(filepath.Ext(path), ".exe") {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

// Resolve on each launch rather than persisting the portable bundle's absolute path.
func resolveTosuPath(selected, launcherExe string) string {
	if isExecutable(selected) {
		return selected
	}
	if filepath.IsAbs(launcherExe) {
		bundled := filepath.Join(filepath.Dir(launcherExe), "tosu", "tosu.exe")
		if isExecutable(bundled) {
			return bundled
		}
	}
	return selected
}

func effectiveTosuPath(selected string) string {
	exe, _ := os.Executable()
	return resolveTosuPath(selected, exe)
}

func saveLauncherSettings(path string, settings launcherSettings) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	return replaceFile(path, data)
}

func replaceFile(path string, data []byte) error {
	staged, err := os.CreateTemp(filepath.Dir(path), ".oclr-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(staged.Name())
	_, writeErr := staged.Write(data)
	closeErr := staged.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		return err
	}
	return os.Rename(staged.Name(), path)
}

type processStatus uint8

const (
	processChecking processStatus = iota
	processMissing
	processStopped
	processRunning
	processUnknown
)

func processImage(pid uint32) (string, error) {
	const processQueryLimitedInformation = 0x1000
	handle, err := syscall.OpenProcess(processQueryLimitedInformation, false, pid)
	if err != nil {
		return "", err
	}
	defer syscall.CloseHandle(handle)
	image := make([]uint16, 32768)
	size := uint32(len(image))
	ok, _, err := queryProcessImage.Call(uintptr(handle), 0, uintptr(unsafe.Pointer(&image[0])), uintptr(unsafe.Pointer(&size)))
	if ok == 0 {
		return "", err
	}
	return syscall.UTF16ToString(image[:size]), nil
}

func sameExecutable(selected, image string) bool {
	if strings.EqualFold(filepath.Clean(selected), filepath.Clean(image)) {
		return true
	}
	// The process image can use a different DOS path to the same file.
	want, wantErr := os.Stat(selected)
	got, gotErr := os.Stat(image)
	return wantErr == nil && gotErr == nil && os.SameFile(want, got)
}

func findExecutableProcess(path string) processStatus {
	if !isExecutable(path) {
		return processMissing
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return processUnknown
	}
	return findProcess(filepath.Base(resolved), resolved)
}

// An empty path matches a running process by image name.
func findProcess(name, path string) processStatus {
	snapshot, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return processUnknown
	}
	defer syscall.CloseHandle(snapshot)
	entry := syscall.ProcessEntry32{Size: uint32(unsafe.Sizeof(syscall.ProcessEntry32{}))}
	status := processStopped
	err = syscall.Process32First(snapshot, &entry)
	for ; err == nil; err = syscall.Process32Next(snapshot, &entry) {
		imageName := syscall.UTF16ToString(entry.ExeFile[:])
		matchingName := strings.EqualFold(imageName, name)
		// An 8.3 image name can differ from the selected file's long name.
		if !matchingName && (path == "" || !strings.Contains(imageName, "~")) {
			continue
		}
		if path == "" {
			return processRunning
		}
		image, queryErr := processImage(entry.ProcessID)
		if queryErr != nil {
			if matchingName {
				status = processUnknown
			}
			continue
		}
		if sameExecutable(path, image) {
			return processRunning
		}
	}
	if !errors.Is(err, syscall.ERROR_NO_MORE_FILES) {
		return processUnknown
	}
	return status
}

func tosuPortOpen(address string) bool {
	conn, err := net.DialTimeout("tcp4", address, 750*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func readTosuPort(exe string) (string, error) {
	file, err := os.Open(filepath.Join(filepath.Dir(exe), "tosu.env"))
	if err != nil {
		return "", err
	}
	defer file.Close()

	var value string
	var found bool
	lines := bufio.NewScanner(file)
	for lines.Scan() {
		line, _, _ := strings.Cut(strings.TrimPrefix(lines.Text(), "\uFEFF"), "#")
		key, raw, ok := strings.Cut(line, "=")
		if ok && strings.TrimSpace(key) == "SERVER_PORT" {
			value, found = strings.TrimSpace(raw), true
		}
	}
	if err := lines.Err(); err != nil {
		return "", err
	}
	if !found {
		return "", errTosuPortMissing
	}
	if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
		value = strings.TrimSpace(value[1 : len(value)-1])
	}
	port, err := strconv.ParseUint(value, 10, 16)
	if err != nil || port == 0 {
		return "", errTosuPortInvalid
	}
	return strconv.FormatUint(port, 10), nil
}

type tosuProbe struct {
	selection uintptr
	process   processStatus
	port      string
	portOpen  bool
	portErr   error
}

func (probe tosuProbe) address() string {
	return net.JoinHostPort("127.0.0.1", probe.port)
}

func probeTosu(path string, selection uintptr) tosuProbe {
	probe := tosuProbe{selection: selection, process: findExecutableProcess(path)}
	if probe.process == processMissing {
		return probe
	}
	probe.port, probe.portErr = readTosuPort(path)
	if probe.portErr == nil {
		probe.portOpen = tosuPortOpen(probe.address())
	}
	return probe
}

func savedTosuPort() string {
	path, err := launcherSettingsPath()
	if err != nil {
		return ""
	}
	settings, err := loadLauncherSettings(path)
	if err != nil {
		return ""
	}
	selected := effectiveTosuPath(storage.readTool(settings.TosuPath))
	if !isExecutable(selected) {
		return ""
	}
	port, _ := readTosuPort(selected)
	return port
}

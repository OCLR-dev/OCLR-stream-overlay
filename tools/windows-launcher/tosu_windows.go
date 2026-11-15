package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"
)

var commonDialog = syscall.NewLazyDLL("comdlg32.dll")
var queryProcessImage = kernel.NewProc("QueryFullProcessImageNameW")

var errTosuPortMissing = errors.New("SERVER_PORT is missing")
var errTosuPortInvalid = errors.New("SERVER_PORT must be between 1 and 65535")

type launcherSettings struct {
	TosuPath string `json:"tosuPath,omitempty"`
	OsuPath  string `json:"osuPath,omitempty"`
}

func launcherSettingsPath() (string, error) {
	local := os.Getenv("LOCALAPPDATA")
	if !filepath.IsAbs(local) {
		return "", errors.New("local app data directory is unavailable")
	}
	// Keep launcher preferences separate from the backend's match migration.
	return filepath.Join(local, "OCLR", "StreamOverlayLauncher", "settings.json"), nil
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

// Layout matches the Unicode OPENFILENAMEW structure.
type openFileName struct {
	size                  uint32
	owner, instance       uintptr
	filter, custom        *uint16
	maxCustom, index      uint32
	file                  *uint16
	maxFile               uint32
	fileTitle             *uint16
	maxFileTitle          uint32
	initialDir, title     *uint16
	flags                 uint32
	offset, extension     uint16
	defaultExtension      *uint16
	customData, hook      uintptr
	template, reserved    uintptr
	reservedWord, flagsEx uint32
}

func pickExecutable(owner uintptr, previous, caption string) (string, error) {
	buffer := make([]uint16, 32768)
	filter := utf16.Encode([]rune("Windows 应用程序 (*.exe)\x00*.exe\x00\x00"))
	title := syscall.StringToUTF16Ptr(caption)
	dialog := openFileName{
		owner: owner, filter: &filter[0], index: 1, file: &buffer[0], maxFile: uint32(len(buffer)), title: title,
		flags: 0x00080000 | 0x00001000 | 0x00000800 | 0x00000008 | 0x02000000, // Explorer, existing file/path, keep cwd and recent files.
	}
	if filepath.IsAbs(previous) {
		dir := filepath.Dir(previous)
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			dialog.initialDir = syscall.StringToUTF16Ptr(dir)
		}
	}
	dialog.size = uint32(unsafe.Sizeof(dialog))
	if call(commonDialog, "GetOpenFileNameW", uintptr(unsafe.Pointer(&dialog))) != 0 {
		return syscall.UTF16ToString(buffer), nil
	}
	if call(commonDialog, "CommDlgExtendedError") != 0 {
		return "", errors.New("the executable picker failed")
	}
	return "", nil
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
	snapshot, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return processUnknown
	}
	defer syscall.CloseHandle(snapshot)
	entry := syscall.ProcessEntry32{Size: uint32(unsafe.Sizeof(syscall.ProcessEntry32{}))}
	status := processStopped
	name := filepath.Base(resolved)
	err = syscall.Process32First(snapshot, &entry)
	for ; err == nil; err = syscall.Process32Next(snapshot, &entry) {
		imageName := syscall.UTF16ToString(entry.ExeFile[:])
		// An 8.3 image name can differ from the selected file's long name.
		matchingName := strings.EqualFold(imageName, name)
		if !matchingName && !strings.Contains(imageName, "~") {
			continue
		}
		image, queryErr := processImage(entry.ProcessID)
		if queryErr != nil {
			if matchingName {
				status = processUnknown
			}
			continue
		}
		if sameExecutable(resolved, image) {
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

var tosuPath, settingsFile string
var tosuSelection uintptr
var tosuPending bool
var tosuResults = make(chan tosuProbe, 1)

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

func checkTosu(owner uintptr) {
	if tosuPending {
		return
	}
	tosuPending = true
	path, selection := tosuPath, tosuSelection
	go func() {
		tosuResults <- probeTosu(path, selection)
		call(user, "PostMessageW", owner, msgTosuChecked, 0, 0)
	}()
}

func applyTosuCheck(owner uintptr) {
	probe := <-tosuResults
	tosuPending = false
	if probe.selection != tosuSelection {
		checkTosu(owner)
		return
	}
	showTosuProcess(probe.process)
	showTosuPort(probe)
	if service != nil {
		service.setTosuPort(probe.port)
	}
}

func savedTosuPort() string {
	path, err := launcherSettingsPath()
	if err != nil {
		return ""
	}
	settings, err := loadLauncherSettings(path)
	if err != nil || !isExecutable(settings.TosuPath) {
		return ""
	}
	port, _ := readTosuPort(settings.TosuPath)
	return port
}

func loadLauncherPreferences() {
	path, err := launcherSettingsPath()
	if err != nil {
		showTosu("无法找到本机设置目录。")
		showTourney("无法找到本机设置目录。")
		return
	}
	settingsFile = path
	settings, err := loadLauncherSettings(path)
	if err != nil {
		showTosu("无法读取保存的路径，请重新选择。")
		showTourney("无法读取保存的路径，请重新选择。")
		return
	}
	tosuPath = settings.TosuPath
	osuPath = settings.OsuPath
	showTourney("")
	switch {
	case tosuPath == "":
		showTosu("选择一次，下次可直接打开。")
	case isExecutable(tosuPath):
		showTosu("已记住 tosu 路径。")
	default:
		showTosu("找不到保存的文件，请重新选择。")
	}
}

func chooseTosu(owner uintptr) {
	path, err := pickExecutable(owner, tosuPath, "选择 tosu 应用程序")
	if err != nil {
		showTosu("无法打开文件选择窗口，请重试。")
		return
	}
	if path == "" {
		return
	}
	if !isExecutable(path) {
		showTosu("请选择实际的 tosu .exe 文件。")
		return
	}
	if settingsFile == "" || saveLauncherSettings(settingsFile, launcherSettings{TosuPath: path, OsuPath: osuPath}) != nil {
		showTosu("无法保存路径，请检查设置目录权限。")
		return
	}
	if service != nil && path != tosuPath {
		service.setTosuPort("")
	}
	tosuPath = path
	tosuSelection++
	showTosu("已保存 tosu 路径。")
	showTosuProcess(processChecking)
	setStatus(tosuPortStatus, "端口 · 正在检查…", mutedColor)
	checkTosu(owner)
}

func openTosu(owner uintptr) {
	status := findExecutableProcess(tosuPath)
	showTosuProcess(status)
	switch status {
	case processRunning:
		return
	case processMissing:
		showTosu("找不到保存的文件，请重新选择。")
		return
	case processUnknown:
		showTosu("暂时无法确认运行状态，请稍后重试。")
		return
	}
	cmd := exec.Command(tosuPath)
	cmd.Dir = filepath.Dir(tosuPath)
	if err := cmd.Start(); err != nil {
		showTosu("无法启动 tosu，请检查所选程序。")
		return
	}
	tosuSelection++
	selection := tosuSelection
	showTosuProcess(processRunning)
	showTosu("tosu 已启动。")
	go func() {
		var failed uintptr
		if cmd.Wait() != nil {
			failed = 1
		}
		call(user, "PostMessageW", owner, msgTosuExited, failed, selection)
	}()
}

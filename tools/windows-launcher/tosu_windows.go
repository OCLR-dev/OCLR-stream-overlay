package main

import (
	"encoding/json"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"
)

var commonDialog = syscall.NewLazyDLL("comdlg32.dll")
var queryProcessImage = kernel.NewProc("QueryFullProcessImageNameW")

const tosuAddress = "127.0.0.1:24050"

type launcherSettings struct {
	TosuPath string `json:"tosuPath"`
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

func saveTosuPath(path, exe string) error {
	if !isExecutable(exe) {
		return errors.New("tosu path is not an executable file")
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	data, err := json.Marshal(launcherSettings{TosuPath: exe})
	if err != nil {
		return err
	}
	staged, err := os.CreateTemp(dir, "launcher-*.tmp")
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

func pickTosu(owner uintptr, previous string) (string, error) {
	buffer := make([]uint16, 32768)
	filter := utf16.Encode([]rune("Windows 应用程序 (*.exe)\x00*.exe\x00\x00"))
	title := syscall.StringToUTF16Ptr("选择 tosu 应用程序")
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

type tosuProcess uint8

const (
	tosuChecking tosuProcess = iota
	tosuMissing
	tosuStopped
	tosuRunning
	tosuUnknown
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

func findTosu(path string) tosuProcess {
	if !isExecutable(path) {
		return tosuMissing
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return tosuUnknown
	}
	snapshot, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return tosuUnknown
	}
	defer syscall.CloseHandle(snapshot)
	entry := syscall.ProcessEntry32{Size: uint32(unsafe.Sizeof(syscall.ProcessEntry32{}))}
	status := tosuStopped
	err = syscall.Process32First(snapshot, &entry)
	for ; err == nil; err = syscall.Process32Next(snapshot, &entry) {
		if !strings.EqualFold(syscall.UTF16ToString(entry.ExeFile[:]), filepath.Base(resolved)) {
			continue
		}
		image, queryErr := processImage(entry.ProcessID)
		if queryErr != nil {
			status = tosuUnknown
			continue
		}
		if strings.EqualFold(filepath.Clean(image), filepath.Clean(resolved)) {
			return tosuRunning
		}
	}
	if !errors.Is(err, syscall.ERROR_NO_MORE_FILES) {
		return tosuUnknown
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

type tosuProbe struct {
	selection uintptr
	process   tosuProcess
	portOpen  bool
}

var tosuPath, settingsFile string
var tosuSelection uintptr
var tosuPending bool
var tosuResults = make(chan tosuProbe, 1)

func checkTosu(owner uintptr) {
	if tosuPending {
		return
	}
	tosuPending = true
	path, selection := tosuPath, tosuSelection
	go func() {
		tosuResults <- tosuProbe{selection, findTosu(path), tosuPortOpen(tosuAddress)}
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
	showTosuPort(probe.portOpen)
}

func loadTosuPreference() {
	path, err := launcherSettingsPath()
	if err != nil {
		showTosu("无法找到本机设置目录。")
		return
	}
	settingsFile = path
	settings, err := loadLauncherSettings(path)
	if err != nil {
		showTosu("无法读取保存的路径，请重新选择。")
		return
	}
	tosuPath = settings.TosuPath
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
	path, err := pickTosu(owner, tosuPath)
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
	if settingsFile == "" || saveTosuPath(settingsFile, path) != nil {
		showTosu("无法保存路径，请检查设置目录权限。")
		return
	}
	tosuPath = path
	tosuSelection++
	showTosu("已保存 tosu 路径。")
	showTosuProcess(tosuChecking)
	checkTosu(owner)
}

func openTosu(owner uintptr) {
	status := findTosu(tosuPath)
	showTosuProcess(status)
	switch status {
	case tosuRunning:
		return
	case tosuMissing:
		showTosu("找不到保存的文件，请重新选择。")
		return
	case tosuUnknown:
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
	showTosuProcess(tosuRunning)
	showTosu("tosu 已启动。")
	go func() {
		var failed uintptr
		if cmd.Wait() != nil {
			failed = 1
		}
		call(user, "PostMessageW", owner, msgTosuExited, failed, selection)
	}()
}

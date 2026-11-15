// The launcher uses native Windows controls and manages the bundled Node service.
package main

import (
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/rodrigocfd/windigo/co"
)

var buildID string

var base = "http://127.0.0.1:3001"

var user = syscall.NewLazyDLL("user32.dll")
var kernel = syscall.NewLazyDLL("kernel32.dll")
var shell = syscall.NewLazyDLL("shell32.dll")
var gdi = syscall.NewLazyDLL("gdi32.dll")

// Keep UTF-16 buffers alive across indirect Win32 calls (including callbacks).
var wideMu sync.Mutex
var wideStrings = map[string]*uint16{}

func ptr(s string) uintptr {
	wideMu.Lock()
	defer wideMu.Unlock()
	p := wideStrings[s]
	if p == nil {
		p = syscall.StringToUTF16Ptr(s)
		wideStrings[s] = p
	}
	return uintptr(unsafe.Pointer(p))
}

//go:uintptrescapes
func call(d *syscall.LazyDLL, n string, args ...uintptr) uintptr {
	v, _, _ := d.NewProc(n).Call(args...)
	return v
}
func message(s string) { call(user, "MessageBoxW", 0, ptr(s), ptr("OCLR 直播控制台"), 0x10) }
func open(s string) {
	if call(shell, "ShellExecuteW", 0, ptr("open"), ptr(s), 0, 0, 1) <= 32 {
		message("无法打开默认浏览器。请在浏览器中输入：" + s)
	}
}

var (
	window, label uintptr
	service       *backend
	localLog      *diagnostics
	starting      = true
	exiting       bool
)

type started struct {
	b   *backend
	err error
}

var result = make(chan started, 1)

func text(s string) {
	setText(label, s)
	setText(settingsStatus, s)
}
func openLocalLog() {
	path := localLog.path
	if path == "" {
		message("找不到本机日志目录。")
		return
	}
	if _, err := os.Stat(path); err == nil {
		if call(shell, "ShellExecuteW", window, ptr("open"), ptr(path), 0, 0, 1) > 32 {
			return
		}
		notepad := filepath.Join(os.Getenv("SystemRoot"), "System32", "notepad.exe")
		if filepath.IsAbs(notepad) && call(shell, "ShellExecuteW", window, ptr("open"), ptr(`"`+path+`"`), 0, 0, 1) > 32 {
			return
		}
	}
	message("无法打开本机日志。\n" + path)
}
func enableServiceButtons(h, enabled uintptr) {
	for _, id := range []uintptr{buttonControl, buttonCopyOBS} {
		call(user, "EnableWindow", call(user, "GetDlgItem", h, id), enabled)
	}
}
func showServiceReady() {
	setStatus(serviceStatus, "● 服务已就绪", readyColor)
	text("比赛保存在本机。关闭控制台网页后，OBS 输出仍会继续。")
}
func copyOBS() { copyAddress(base + "/overlay") }
func copyAddress(address string) {
	value := syscall.StringToUTF16(address)
	if call(user, "OpenClipboard", window) == 0 {
		message("剪贴板正忙，请重试。OBS 地址：" + base + "/overlay")
		return
	}
	defer call(user, "CloseClipboard")
	mem := call(kernel, "GlobalAlloc", 2, uintptr(len(value)*2))
	if mem == 0 {
		return
	}
	p := call(kernel, "GlobalLock", mem)
	if p == 0 {
		call(kernel, "GlobalFree", mem)
		return
	}
	call(kernel, "RtlMoveMemory", p, uintptr(unsafe.Pointer(&value[0])), uintptr(len(value)*2))
	call(kernel, "GlobalUnlock", mem)
	call(user, "EmptyClipboard")
	if call(user, "SetClipboardData", 13, mem) == 0 {
		call(kernel, "GlobalFree", mem)
		message("复制失败，请重试。")
		return
	}
	text("地址已复制。")
}
func launcherEvent(h uintptr, messageID co.WM, w, l uintptr) {
	switch messageID {
	case msgServiceStarted:
		r := <-result
		starting = false
		call(user, "EnableWindow", call(user, "GetDlgItem", h, buttonRestart), 1)
		service = r.b
		if r.err != nil {
			setStatus(serviceStatus, "● 启动失败", errorColor)
			text("到「设置」修改端口后重试，或到「日志」查看原因。")
			message(r.err.Error() + "\n可在侧栏「日志」查看详情。")
		} else {
			checkTosu(h)
			showServiceReady()
			enableServiceButtons(h, 1)
			go r.b.watch(r.b.probe, 3*time.Second, func(state serviceState) {
				call(user, "PostMessageW", h, msgServiceState, uintptr(state), uintptr(r.b.pid))
			})
			open(base + "/control")
		}
	case msgServiceState:
		if !exiting && service != nil && uintptr(service.pid) == l {
			switch serviceState(w) {
			case serviceWaiting:
				setStatus(serviceStatus, "● 等待服务响应", waitColor)
				text("本机服务暂时没有响应，正在重试。")
			case serviceReady:
				showServiceReady()
			case serviceExited:
				setStatus(serviceStatus, "● 服务已停止", errorColor)
				enableServiceButtons(h, 0)
				text("到「日志」查看原因，可在「设置」重启服务并恢复比赛。")
			}
		}
	case msgTosuExited:
		if l == tosuSelection {
			tosuSelection++
			if w != 0 {
				showTosu("tosu 异常退出，请检查后重试。")
			} else {
				showTosu("tosu 已关闭。")
			}
			checkTosu(h)
		}
	case msgTosuChecked:
		applyTosuCheck(h)
	case msgTourneyFinished:
		tourneyBusy = false
		showTourney(<-tourneyResults)
	}
}

func launcherAction(id uintptr) {
	switch id {
	case buttonOverview, buttonSettings, buttonLogs, buttonAbout:
		showLauncherPage(launcherPage(id - buttonOverview))
	case buttonProject:
		open("https://github.com/OCLR-dev/OCLR-stream-overlay")
	case buttonCopyAddresses:
		copyAddress(base + "/control\r\n" + base + "/overlay\r\n" + base + "/showcase?clean=1")
	case buttonRestart:
		restartOnPort(window)
	case buttonControl:
		open(base + "/control")
	case buttonCopyOBS:
		copyOBS()
	case buttonOpenLog:
		openLocalLog()
	case buttonExit:
		call(user, "SendMessageW", window, 0x10, 0, 0)
	case buttonChoose:
		chooseTosu(window)
	case buttonTosu:
		openTosu(window)
	case buttonChooseOsu:
		chooseOsu(window)
	case buttonGenerateTourney:
		runTourney(window, false)
	case buttonOpenTourney:
		runTourney(window, true)
	}
}

func closeLauncher() {
	if exiting {
		return
	}
	if starting {
		message("正在准备服务，请稍候完成后再退出。")
		return
	}
	if service == nil || service.exited() {
		call(user, "DestroyWindow", window)
		return
	}
	if call(user, "MessageBoxW", window, ptr("退出会停止 OBS 网页输出。比赛已保存，下次启动会恢复。确定结束本次直播服务？"), ptr("退出 OCLR"), 0x124) == 6 {
		exiting = true
		text("正在保存并退出，请稍候…")
		service.stop("operator")
		call(user, "DestroyWindow", window)
	}
}

func main() {
	runtime.LockOSThread()
	os.Exit(runLauncher())
}

func runLauncher() int {
	loadServicePort()
	mutex, _, err := kernel.NewProc("CreateMutexW").Call(0, 0, ptr("Local\\OCLR.StreamOverlay.Portable"))
	if mutex == 0 {
		message("无法建立本机启动保护，请重新登录 Windows 后重试。")
		return 1
	}
	defer syscall.CloseHandle(syscall.Handle(mutex))
	headless := len(os.Args) > 1 && (os.Args[1] == "--smoke-test" || os.Args[1] == "--headless")
	if err == syscall.Errno(183) {
		if e := reuse(); e != nil {
			if !headless {
				message(e.Error())
			}
			return 1
		}
		if !headless {
			open(base + "/control")
		}
		return 0
	}
	localLog = launcherDiagnostics()
	localLog.record("launcher started pid=%d build=%s", os.Getpid(), buildID)
	if headless {
		b, e := start(localLog)
		if e != nil {
			os.Stderr.WriteString(e.Error())
			return 1
		}
		if os.Args[1] == "--headless" {
			b.setTosuPort(savedTosuPort())
			go b.watch(b.probe, 3*time.Second, func(serviceState) {})
			stdinClosed := make(chan struct{})
			go func() {
				io.Copy(io.Discard, os.Stdin)
				close(stdinClosed)
			}()
			select {
			case <-b.done:
			case <-stdinClosed:
				b.stop("launcher stdin closed")
			}
		} else {
			b.stop("smoke test")
		}
		return b.exitCode
	}
	return runWindow()
}

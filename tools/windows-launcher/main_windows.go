// Wails hosts the launcher; the bundled Node service owns the match.
package main

import (
	"embed"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var frontend embed.FS
var buildID string

// Link-time overrides are used only by isolated verification builds, never by
// renderer input or runtime environment variables. Release defaults stay fixed.
var instanceMutex = "Local\\OCLR.StreamOverlay.Portable"
var autoOpenControl = "true"
var base = "http://127.0.0.1:3001"
var user = syscall.NewLazyDLL("user32.dll")
var kernel = syscall.NewLazyDLL("kernel32.dll")
var shell = syscall.NewLazyDLL("shell32.dll")

var wideMu sync.Mutex
var wideStrings = map[string]*uint16{}

// Keep buffers alive across the indirect Win32 calls.
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
func message(s string) { call(user, "MessageBoxW", 0, ptr(s), ptr("OCLR 直播服务"), 0x10) }
func open(s string) {
	if call(shell, "ShellExecuteW", 0, ptr("open"), ptr(s), 0, 0, 1) <= 32 {
		message("无法打开，请重试：" + s)
	}
}
func main() { os.Exit(runLauncher()) }
func runLauncher() int {
	loadServicePort()
	mutex, _, err := kernel.NewProc("CreateMutexW").Call(0, 0, ptr(instanceMutex))
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
	log := launcherDiagnostics()
	log.record("launcher started pid=%d build=%s", os.Getpid(), buildID)
	if headless {
		b, e := start(log)
		if e != nil {
			os.Stderr.WriteString(e.Error())
			return 1
		}
		if os.Args[1] == "--headless" {
			b.setTosuPort(savedTosuPort())
			go b.watch(b.probe, 3*time.Second, func(serviceState) {})
			closed := make(chan struct{})
			go func() { io.Copy(io.Discard, os.Stdin); close(closed) }()
			select {
			case <-b.done:
			case <-closed:
				b.stop("launcher stdin closed")
			}
		} else {
			b.stop("smoke test")
		}
		return b.exitCode
	}
	assets, e := fs.Sub(frontend, "frontend/dist")
	if e != nil {
		message("无法加载启动界面。")
		return 1
	}
	prefs, e := launcherSettingsPath()
	if e != nil {
		message("无法找到本机设置目录。")
		return 1
	}
	app := newLauncher(log)
	messages := windows.DefaultMessages()
	messages.InstallationRequired = "需要 Microsoft Edge WebView2"
	messages.UpdateRequired = "需要更新 Microsoft Edge WebView2"
	messages.MissingRequirements = "启动界面需要 WebView2。请安装后重新打开 OCLR。"
	messages.Webview2NotInstalled = "未找到 Microsoft Edge WebView2 Runtime。"
	messages.DownloadPage = "即将打开 Microsoft 官方下载页面。"
	e = wails.Run(&options.App{
		Title: "OCLR 直播服务", Width: 940, Height: 680, MinWidth: 760, MinHeight: 560,
		BackgroundColour: options.NewRGB(18, 16, 29), AssetServer: &assetserver.Options{Assets: assets},
		EnableFraudulentWebsiteDetection: true,
		DragAndDrop:                      &options.DragAndDrop{DisableWebViewDrop: true},
		OnStartup:                        app.startup, OnBeforeClose: app.beforeClose, OnShutdown: app.shutdown, Bind: []interface{}{app},
		Windows: &windows.Options{Theme: windows.Dark, WebviewUserDataPath: filepath.Join(filepath.Dir(prefs), "WebView2"),
			Messages: messages},
	})
	if e != nil {
		log.record("launcher window failed: %v", e)
		message("无法打开启动界面，请检查 WebView2 安装并重试。")
		return 1
	}
	return 0
}

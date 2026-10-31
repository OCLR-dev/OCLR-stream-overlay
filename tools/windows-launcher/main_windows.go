// The launcher is a small Win32 GUI. No shell, browser engine or external modules.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

var buildID string

var base = "http://127.0.0.1:3001"
var entryScript = "portable.js"
var mutexName = "Local\\OCLR.StreamOverlay.Portable"
var windowTitle = "OCLR 直播服务"

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

var client = &http.Client{Timeout: time.Second}

type health struct {
	Project string
	Build   string
	Ready   bool
	Session bool
	PID     int
}

func getHealth() (health, error) {
	var h health
	r, e := client.Get(base + "/api/health")
	if e != nil {
		return h, e
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return h, errors.New("address occupied")
	}
	e = json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&h)
	return h, e
}
func compatible(h health) bool {
	return h.Project == "oclr-stream-overlay" && h.Build == buildID && h.Ready && h.Session
}
func reuse() error {
	for deadline := time.Now().Add(30 * time.Second); time.Now().Before(deadline); {
		h, e := getHealth()
		if e == nil {
			if compatible(h) {
				return nil
			}
			if h.Project != "oclr-stream-overlay" || h.Build != buildID {
				return errors.New("另一个版本或其他程序正在使用固定地址。请先在原启动窗口退出，再启动本版本。比赛记录会保留，不会自动结束任何程序。")
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	return errors.New("已有启动窗口，但服务尚未就绪。请查看原窗口的提示，退出后重试。")
}

// stderr may be written while the GUI reads it after a failed start.
type lockedBuffer struct {
	sync.Mutex
	b bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) { b.Lock(); defer b.Unlock(); return b.b.Write(p) }
func (b *lockedBuffer) String() string              { b.Lock(); defer b.Unlock(); return b.b.String() }

type backend struct {
	cmd   *exec.Cmd
	input io.WriteCloser
	done  chan error
	log   lockedBuffer
}

func start() (*backend, error) {
	if _, e := getHealth(); e == nil {
		return nil, errors.New("固定地址已有服务，但未找到对应启动窗口。请先退出原版本服务，再启动本版本；不会结束其他程序。")
	}
	exe, e := os.Executable()
	if e != nil {
		return nil, e
	}
	root := filepath.Dir(exe)
	b := &backend{done: make(chan error, 1)}
	b.cmd = exec.Command(filepath.Join(root, "runtime", "node.exe"), filepath.Join(root, "app", "server", entryScript))
	b.cmd.Dir = root
	// Fixed production data location; development/test overrides do not leak in.
	for _, v := range os.Environ() {
		if !strings.HasPrefix(strings.ToUpper(v), "OCLR_DATA_DIR=") && !strings.HasPrefix(strings.ToUpper(v), "NODE_OPTIONS=") {
			b.cmd.Env = append(b.cmd.Env, v)
		}
	}
	b.cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	b.cmd.Stderr = &b.log
	b.input, e = b.cmd.StdinPipe()
	if e != nil {
		return nil, e
	}
	if e = b.cmd.Start(); e != nil {
		return nil, errors.New("无法运行随包附带的服务。请完整解压压缩包，确认 runtime 文件夹仍在。")
	}
	go func() { b.done <- b.cmd.Wait() }()
	for deadline := time.Now().Add(30 * time.Second); time.Now().Before(deadline); {
		select {
		case <-b.done:
			return nil, errors.New("服务未能启动。\n" + b.log.String())
		default:
		}
		h, e := getHealth()
		if e == nil && compatible(h) && h.PID == b.cmd.Process.Pid {
			return b, nil
		}
		if e == nil && (h.Project != "oclr-stream-overlay" || h.Build != buildID) {
			b.stop()
			return nil, errors.New("固定地址已被其他版本或程序占用。请退出原服务后重试；不会自动换地址。")
		}
		time.Sleep(150 * time.Millisecond)
	}
	b.stop()
	return nil, errors.New("服务启动超时。请检查磁盘空间、文件权限，并确认压缩包已完整解压。\n" + b.log.String())
}
func (b *backend) stop() {
	// Only our own child receives shutdown. No process-name/PID sweeping.
	io.WriteString(b.input, "shutdown\n")
	b.input.Close()
	select {
	case <-b.done:
	case <-time.After(15 * time.Second):
		message("服务还在保存比赛，请稍候。关闭此提示后会继续等待，不会强制结束服务。")
		<-b.done
	}
}

type point struct{ X, Y int32 }
type msg struct {
	H       uintptr
	M       uint32
	W, L    uintptr
	T       uint32
	P       point
	Private uint32
}
type wc struct {
	Size, Style                   uint32
	Proc                          uintptr
	Cls, Wnd                      int32
	Instance, Icon, Cursor, Brush uintptr
	Menu, Name                    *uint16
	Small                         uintptr
}

var window, label uintptr
var service *backend

type started struct {
	b   *backend
	err error
}

var result = make(chan started, 1)
var exiting atomic.Bool

func text(s string) { call(user, "SetWindowTextW", label, ptr(s)) }
func copyOBS() {
	value := syscall.StringToUTF16(base + "/overlay")
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
	text("OBS 地址已复制。服务仍在运行；关闭网页不会中断输出。")
}
func wndProc(h uintptr, m uint32, w, l uintptr) uintptr {
	switch m {
	case 0x8001:
		r := <-result
		service = r.b
		if r.err != nil {
			message(r.err.Error())
			call(user, "DestroyWindow", h)
		} else {
			text("本机服务已就绪。关闭控制台网页不会中断 OBS 输出。")
			for _, id := range []uintptr{101, 102} {
				call(user, "EnableWindow", call(user, "GetDlgItem", h, id), 1)
			}
			open(base + "/control")
			go watchService()
		}
		return 0
	case 0x8002:
		message("本机服务已停止，OBS 输出暂时不可用。请退出此窗口后重新启动；已保存的比赛会恢复。")
		call(user, "DestroyWindow", h)
		return 0
	case 0x111:
		switch w & 0xffff {
		case 101:
			open(base + "/control")
		case 102:
			copyOBS()
		case 103:
			call(user, "SendMessageW", h, 0x10, 0, 0)
		}
		return 0
	case 0x10:
		if service == nil {
			message("正在准备服务，请稍候完成后再退出。")
			return 0
		}
		if call(user, "MessageBoxW", h, ptr("退出会停止 OBS 网页输出。比赛已保存，下次启动会恢复。确定结束本次直播服务？"), ptr("退出 OCLR"), 0x124) == 6 {
			exiting.Store(true)
			text("正在保存并退出，请稍候…")
			service.stop()
			call(user, "DestroyWindow", h)
		}
		return 0
	case 2:
		call(user, "PostQuitMessage", 0)
		return 0
	}
	return call(user, "DefWindowProcW", h, uintptr(m), w, l)
}
func main() {
	runtime.LockOSThread()
	mutex, _, err := kernel.NewProc("CreateMutexW").Call(0, 0, ptr(mutexName))
	if mutex == 0 {
		message("无法建立本机启动保护，请重新登录 Windows 后重试。")
		os.Exit(1)
	}
	defer syscall.CloseHandle(syscall.Handle(mutex))
	headless := len(os.Args) > 1 && (os.Args[1] == "--smoke-test" || os.Args[1] == "--headless")
	if err == syscall.Errno(183) {
		if e := reuse(); e != nil {
			if !headless {
				message(e.Error())
			}
			os.Exit(1)
		}
		if !headless {
			open(base + "/control")
			go watchService()
		}
		return
	}
	if headless {
		b, e := start()
		if e != nil {
			os.Stderr.WriteString(e.Error())
			os.Exit(1)
		}
		if os.Args[1] == "--headless" {
			io.Copy(io.Discard, os.Stdin)
		}
		b.stop()
		return
	}
	instance := call(kernel, "GetModuleHandleW", 0)
	name := syscall.StringToUTF16Ptr("OCLRPortableWindow")
	class := wc{Proc: syscall.NewCallback(wndProc), Instance: instance, Cursor: call(user, "LoadCursorW", 0, 32512), Brush: 6, Name: name}
	class.Size = uint32(unsafe.Sizeof(class))
	if call(user, "RegisterClassExW", uintptr(unsafe.Pointer(&class))) == 0 {
		message("无法创建启动窗口。")
		return
	}
	window = call(user, "CreateWindowExW", 0, uintptr(unsafe.Pointer(name)), ptr(windowTitle), 0x00CA0000, 200, 200, 640, 290, 0, 0, instance, 0)
	if window == 0 {
		message("无法创建启动窗口。")
		return
	}
	font := call(gdi, "GetStockObject", 17)
	add := func(kind, title string, x, y, width, height int, id, style uintptr) uintptr {
		h := call(user, "CreateWindowExW", 0, ptr(kind), ptr(title), 0x50000000|style, uintptr(x), uintptr(y), uintptr(width), uintptr(height), window, id, instance, 0)
		call(user, "SendMessageW", h, 0x30, font, 1)
		return h
	}
	label = add("STATIC", "正在启动本机服务，请稍候…", 24, 24, 580, 48, 0, 0)
	add("STATIC", "输出固定地址："+base+"/overlay\r\n比赛自动保存在本机。游戏数据状态请查看控制台顶部。", 24, 82, 580, 52, 0, 0)
	for i, b := range []struct {
		title string
		id    uintptr
	}{{"打开控制台", 101}, {"复制 OBS 地址", 102}, {"退出直播服务", 103}} {
		h := add("BUTTON", b.title, 24+i*198, 158, 184, 44, b.id, 0x10000)
		if b.id != 103 {
			call(user, "EnableWindow", h, 0)
		}
	}
	call(user, "ShowWindow", window, 1)
	call(user, "UpdateWindow", window)
	go func() { b, e := start(); result <- started{b, e}; call(user, "PostMessageW", window, 0x8001, 0, 0) }()
	var m msg
	for int32(call(user, "GetMessageW", uintptr(unsafe.Pointer(&m)), 0, 0, 0)) > 0 {
		if call(user, "IsDialogMessageW", window, uintptr(unsafe.Pointer(&m))) == 0 {
			call(user, "TranslateMessage", uintptr(unsafe.Pointer(&m)))
			call(user, "DispatchMessageW", uintptr(unsafe.Pointer(&m)))
		}
	}
	// On launcher crash/exit the child's stdin closes; the backend drains and stops.
}

func watchService() {
	for {
		time.Sleep(3 * time.Second)
		if exiting.Load() {
			return
		}
		if h, e := getHealth(); e != nil || !compatible(h) {
			// A second check avoids treating one slow local request as a crashed service.
			time.Sleep(time.Second)
			if h, e = getHealth(); e != nil || !compatible(h) {
				if !exiting.Load() {
					call(user, "PostMessageW", window, 0x8002, 0, 0)
				}
				return
			}
		}
	}
}

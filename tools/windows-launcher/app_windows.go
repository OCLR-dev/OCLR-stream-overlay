package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type launcherState struct {
	Status       string `json:"status"`
	Notice       string `json:"notice"`
	Port         string `json:"port"`
	Address      string `json:"address"`
	Build        string `json:"build"`
	Busy         bool   `json:"busy"`
	TosuPath     string `json:"tosuPath"`
	OsuPath      string `json:"osuPath"`
	TosuStatus   string `json:"tosuStatus"`
	TosuPort     string `json:"tosuPort"`
	CanStartTosu bool   `json:"canStartTosu"`
}

// op serializes native actions and child ownership; mu protects UI snapshots.
// No bound method accepts an executable path, command, or URL from JavaScript.
type Launcher struct {
	ctx         context.Context
	op          sync.Mutex
	mu          sync.Mutex
	state       launcherState
	activePID   int      // protected by mu
	service     *backend // protected by op
	log         *diagnostics
	closing     bool
	quitAllowed bool
	stop        chan struct{}
}

func newLauncher(log *diagnostics) *Launcher {
	return &Launcher{log: log, stop: make(chan struct{}), state: launcherState{Status: "starting", Busy: true, Port: servicePort, Address: base, Build: buildID, TosuStatus: "正在检查"}}
}
func (a *Launcher) update(fn func(*launcherState)) { a.mu.Lock(); defer a.mu.Unlock(); fn(&a.state) }
func (a *Launcher) Snapshot() launcherState        { a.mu.Lock(); defer a.mu.Unlock(); return a.state }
func (a *Launcher) startup(ctx context.Context) {
	a.ctx = ctx
	go func() {
		a.op.Lock()
		path, err := launcherSettingsPath()
		prefs, e := loadLauncherSettings(path)
		a.update(func(s *launcherState) {
			s.TosuPath = prefs.TosuPath
			s.OsuPath = prefs.OsuPath
			if err != nil || e != nil {
				s.Notice = "无法读取保存的路径，请在设置重新选择。"
			}
		})
		if !a.closing {
			a.startService()
		}
		a.op.Unlock()
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-a.stop:
				return
			case <-ticker.C:
				if a.op.TryLock() {
					if !a.closing {
						a.checkTosu()
					}
					a.op.Unlock()
				}
			}
		}
	}()
}
func (a *Launcher) startService() {
	a.update(func(s *launcherState) { a.activePID = 0; s.Status = "starting"; s.Busy = true })
	b, err := start(a.log)
	a.service = b
	if err != nil {
		a.update(func(s *launcherState) { s.Status = "failed"; s.Busy = false; s.Notice = err.Error() })
		return
	}
	a.mu.Lock()
	a.activePID = b.pid
	a.mu.Unlock()
	a.update(func(s *launcherState) {
		s.Status = "ready"
		s.Busy = false
		s.Notice = "服务已就绪，关闭控制台网页后，OBS 输出仍会继续。"
	})
	a.checkTosu()
	go b.watch(b.probe, 3*time.Second, func(state serviceState) { a.applyServiceState(b, state) })
	if autoOpenControl == "true" {
		open(b.endpoint + "/control")
	}
}
func (a *Launcher) applyServiceState(b *backend, state serviceState) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if (a.state.Status != "ready" && a.state.Status != "waiting") || a.state.Address != b.endpoint || a.activePID != b.pid {
		return
	}
	switch state {
	case serviceWaiting:
		a.state.Status = "waiting"
		a.state.Notice = "本机服务暂时没有响应，正在重试。"
	case serviceReady:
		a.state.Status = "ready"
		a.state.Notice = "直播服务已恢复。"
	case serviceExited:
		a.state.Status = "stopped"
		a.state.Notice = "服务已停止，请查看日志或重新启动。"
	}
}
func (a *Launcher) begin() error {
	if !a.op.TryLock() {
		return errors.New("正在处理上一项操作，请稍候。")
	}
	if a.closing {
		a.op.Unlock()
		return errors.New("正在退出，请稍候。")
	}
	a.update(func(s *launcherState) { s.Busy = true })
	return nil
}
func (a *Launcher) end() { a.update(func(s *launcherState) { s.Busy = false }); a.op.Unlock() }
func (a *Launcher) confirm(title, body string) bool {
	// Windows returns canonical button IDs; the OS localizes their captions.
	answer, err := wruntime.MessageDialog(a.ctx, wruntime.MessageDialogOptions{Type: wruntime.QuestionDialog, Title: title, Message: body, Buttons: []string{"Yes", "No"}, DefaultButton: "No", CancelButton: "No"})
	return err == nil && answer == "Yes"
}
func (a *Launcher) Restart(port string) error {
	if !validServicePort(port) {
		return errors.New("请输入 1–65535 的整数端口。")
	}
	if err := a.begin(); err != nil {
		return err
	}
	defer a.end()
	if a.service != nil && !a.service.exited() && !a.confirm("重新启动服务", "重新启动会暂时中断 OBS 输出与 OCLR 连接，比赛记录会保留。继续？") {
		return nil
	}
	n, _ := strconv.Atoi(port)
	port = strconv.Itoa(n)
	p := portSettingsPath()
	if p == "" || os.MkdirAll(filepath.Dir(p), 0700) != nil {
		return errors.New("无法保存端口设置。")
	}
	if err := replaceFile(p, []byte(port)); err != nil {
		return errors.New("无法保存端口设置，服务继续运行。")
	}
	a.update(func(s *launcherState) { s.Status = "stopping"; s.Notice = "正在保存比赛并重启…" })
	if a.service != nil {
		a.service.stop("operator port restart")
	}
	servicePort = port
	base = "http://127.0.0.1:" + port
	a.update(func(s *launcherState) { s.Port = port; s.Address = base })
	a.startService()
	return nil
}
func (a *Launcher) checkTosu() {
	state := a.Snapshot()
	probe := probeTosu(state.TosuPath, 0)
	status := "未选择 tosu"
	canStart := false
	switch probe.process {
	case processStopped:
		status = "tosu 未启动"
		canStart = true
	case processRunning:
		status = "tosu 正在运行"
	case processUnknown:
		status = "无法确认 tosu 状态"
	case processMissing:
		if state.TosuPath != "" {
			status = "找不到 tosu，请重新选择"
		}
	}
	port := "等待选择 tosu"
	if state.TosuPath != "" {
		switch {
		case probe.portErr != nil:
			port = "无法读取 tosu 端口，请检查 tosu.env"
		case probe.port == "":
			port = "等待有效端口"
		case probe.portOpen:
			port = "端口 " + probe.port + " 可连接"
		default:
			port = "端口 " + probe.port + " 尚未就绪"
		}
	}
	if a.service != nil {
		a.service.setTosuPort(probe.port)
	}
	a.update(func(s *launcherState) { s.TosuStatus = status; s.TosuPort = port; s.CanStartTosu = canStart })
}
func (a *Launcher) ChooseTool(kind string) error {
	if kind != "tosu" && kind != "osu" {
		return errors.New("未知的应用程序。")
	}
	if err := a.begin(); err != nil {
		return err
	}
	defer a.end()
	title := "选择 tosu.exe"
	if kind == "osu" {
		title = "选择 osu!stable 的 osu!.exe"
	}
	path, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{Title: title, Filters: []wruntime.FileFilter{{DisplayName: "Windows 应用程序", Pattern: "*.exe"}}})
	if err != nil {
		return errors.New("无法打开文件选择窗口，请重试。")
	}
	if path == "" {
		return nil
	}
	return a.saveTool(kind, path)
}

// Native picker result only; deliberately unexported.
func (a *Launcher) saveTool(kind, path string) error {
	if kind != "tosu" && kind != "osu" {
		return errors.New("未知的应用程序。")
	}
	if !isExecutable(path) || (kind == "osu" && !isOsuExecutable(path)) {
		return errors.New("请选择正确的应用程序文件。")
	}
	s := a.Snapshot()
	prefs := launcherSettings{TosuPath: s.TosuPath, OsuPath: s.OsuPath}
	if kind == "tosu" {
		prefs.TosuPath = path
	} else {
		prefs.OsuPath = path
	}
	p, err := launcherSettingsPath()
	if err != nil {
		return err
	}
	if err = saveLauncherSettings(p, prefs); err != nil {
		return errors.New("无法保存路径，请检查设置目录权限。")
	}
	if kind == "tosu" && a.service != nil && path != s.TosuPath {
		a.service.setTosuPort("")
	}
	a.update(func(s *launcherState) {
		s.TosuPath = prefs.TosuPath
		s.OsuPath = prefs.OsuPath
		s.Notice = "应用程序路径已保存。"
	})
	a.checkTosu()
	return nil
}
func (a *Launcher) StartTosu() error {
	if err := a.begin(); err != nil {
		return err
	}
	defer a.end()
	path := a.Snapshot().TosuPath
	switch findExecutableProcess(path) {
	case processRunning:
		return nil
	case processMissing:
		return errors.New("找不到 tosu，请在设置中重新选择。")
	case processUnknown:
		return errors.New("无法确认 tosu 是否已启动，请稍后重试。")
	}
	cmd := exec.Command(path)
	cmd.Dir = filepath.Dir(path)
	if err := cmd.Start(); err != nil {
		return errors.New("无法启动 tosu，请检查所选程序。")
	}
	go func() {
		if cmd.Wait() != nil {
			a.log.record("tosu child exited with error")
		}
	}()
	a.checkTosu()
	return nil
}
func (a *Launcher) Tourney(launch bool) error {
	if err := a.begin(); err != nil {
		return err
	}
	defer a.end()
	if a.service == nil || a.service.exited() {
		return errors.New("请等直播服务就绪后重试。")
	}
	notice := prepareTourney(a.Snapshot().OsuPath, a.service.pid, launch)
	a.update(func(s *launcherState) { s.Notice = notice })
	return nil
}
func (a *Launcher) OpenControl() error {
	if err := a.begin(); err != nil {
		return err
	}
	defer a.end()
	if a.service == nil || a.service.exited() {
		return errors.New("请先启动直播服务。")
	}
	open(a.service.endpoint + "/control")
	return nil
}
func (a *Launcher) CopyAddresses(all bool) error {
	s := a.Snapshot()
	value := s.Address + "/overlay"
	if all {
		value = s.Address + "/control\r\n" + value + "\r\n" + s.Address + "/showcase?clean=1"
	}
	if err := wruntime.ClipboardSetText(a.ctx, value); err != nil {
		return errors.New("剪贴板正忙，请重试。")
	}
	return nil
}
func (a *Launcher) LogPreview() (string, error) { return a.log.preview() }
func (a *Launcher) OpenLog() error {
	if _, err := os.Stat(a.log.path); err != nil {
		return errors.New("无法读取本机日志。")
	}
	open(a.log.path)
	return nil
}
func (a *Launcher) OpenProject() { open("https://github.com/OCLR-dev/OCLR-stream-overlay") }
func (a *Launcher) Quit()        { wruntime.Quit(a.ctx) }
func (a *Launcher) beforeClose(context.Context) bool {
	if !a.op.TryLock() {
		return true
	}
	if a.quitAllowed {
		a.op.Unlock()
		return false
	}
	if a.closing {
		a.op.Unlock()
		return true
	}
	if a.service != nil && !a.service.exited() && !a.confirm("退出 OCLR", "退出会停止 OBS 网页输出。比赛记录会保留，下次启动会恢复。确定退出？") {
		a.op.Unlock()
		return true
	}
	a.closing = true
	a.update(func(s *launcherState) {
		s.Status = "stopping"
		s.Busy = true
		s.Notice = "正在保存比赛并退出，请稍候…"
	})
	go func() {
		if a.service != nil {
			a.service.stop("operator")
		}
		a.quitAllowed = true
		a.op.Unlock()
		wruntime.Quit(a.ctx)
	}()
	return true
}
func (a *Launcher) shutdown(context.Context) {
	a.op.Lock()
	defer a.op.Unlock()
	a.closing = true
	close(a.stop)
	if a.service != nil {
		a.service.stop("window shutdown")
	}
}

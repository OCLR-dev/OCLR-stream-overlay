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
	Status          string `json:"status"`
	Notice          string `json:"notice"`
	Port            string `json:"port"`
	Address         string `json:"address"`
	Build           string `json:"build"`
	ServicePID      int    `json:"servicePID"`
	Busy            bool   `json:"busy"`
	TosuPath        string `json:"tosuPath"`
	OsuPath         string `json:"osuPath"`
	OsuStablePath   string `json:"osuStablePath"`
	TosuStatus      string `json:"tosuStatus"`
	TosuPort        string `json:"tosuPort"`
	CanStartTosu    bool   `json:"canStartTosu"`
	PortableStorage bool   `json:"portableStorage"`
	StoragePath     string `json:"storagePath"`
}

// op serializes native actions and child ownership; mu protects UI snapshots.
// No bound method accepts an executable path, command, or URL from JavaScript.
type Launcher struct {
	ctx              context.Context
	op               sync.Mutex
	mu               sync.Mutex
	state            launcherState
	activePID        int      // protected by mu
	service          *backend // protected by op
	log              *diagnostics
	closing          bool
	quitAllowed      bool
	selectedTosuPath string // explicit preference only, protected by op
	stop             chan struct{}
}

func newLauncher(log *diagnostics) *Launcher {
	path, _ := storage.root()
	return &Launcher{log: log, stop: make(chan struct{}), state: launcherState{Status: "starting", Busy: true, Port: servicePort, Address: base, Build: buildID, TosuStatus: "正在检查", PortableStorage: storage.enabled, StoragePath: path}}
}
func (a *Launcher) update(fn func(*launcherState)) { a.mu.Lock(); defer a.mu.Unlock(); fn(&a.state) }
func (a *Launcher) Snapshot() launcherState        { a.mu.Lock(); defer a.mu.Unlock(); return a.state }
func (a *Launcher) startup(ctx context.Context) {
	a.ctx = ctx
	go func() {
		a.op.Lock()
		path, err := launcherSettingsPath()
		prefs, e := loadLauncherSettings(path)
		prefs.TosuPath = storage.readTool(prefs.TosuPath)
		prefs.OsuPath = storage.readTool(prefs.OsuPath)
		prefs.OsuStablePath = storage.readTool(prefs.OsuStablePath)
		a.selectedTosuPath = prefs.TosuPath
		a.update(func(s *launcherState) {
			s.TosuPath = effectiveTosuPath(prefs.TosuPath)
			s.OsuPath = prefs.OsuPath
			s.OsuStablePath = prefs.OsuStablePath
			if err != nil || e != nil {
				s.Notice = "无法读取保存的路径，请在「服务 → 比赛工具」重新选择。"
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
	a.update(func(s *launcherState) {
		a.activePID = 0
		s.ServicePID = 0
		s.Status = "starting"
		s.Busy = true
		s.Notice = "正在启动本机直播服务。"
	})
	b, err := start(a.log)
	a.service = b
	if err != nil {
		a.update(func(s *launcherState) { s.Status = "failed"; s.Busy = false; s.Notice = err.Error() })
		return
	}
	a.update(func(s *launcherState) {
		a.activePID = b.pid
		s.ServicePID = b.pid
		s.Status = "ready"
		s.Busy = false
		s.Notice = "直播服务已就绪。切换页面时 OBS 输出继续。"
	})
	a.checkTosu()
	go b.watch(b.probe, 3*time.Second, func(state serviceState) { a.applyServiceState(b, state) })
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

func (a *Launcher) ChangeStorage(enabled bool) (bool, error) {
	if err := a.begin(); err != nil {
		return false, err
	}
	defer a.end()
	if enabled == storage.enabled {
		return false, nil
	}
	detail := "切回此 Windows 用户的存储。便携资料会保留在 OCLR 目录，两个位置的资料各自保存。"
	if enabled {
		detail = "首次启用会复制现有设置和比赛记录到 OCLR 目录；如果已有便携资料，则继续使用该份资料。"
	}
	if !a.confirm("切换资料存储位置", detail+"\n\n切换会保存比赛并退出 OCLR，OBS 网页输出会停止。请在方便时切换，之后重新打开 OCLR。") {
		return false, nil
	}
	// Check the package directory before interrupting an active broadcast.
	probe, err := os.CreateTemp(storage.packageDir, ".oclr-write-")
	if err != nil {
		return false, errors.New("OCLR 目录无法写入。请将完整程序移到有写入权限的文件夹后重试。")
	}
	_ = probe.Close()
	_ = os.Remove(probe.Name())
	running := a.service != nil && !a.service.exited()
	if running {
		a.update(func(s *launcherState) { s.Status = "stopping"; s.Notice = "正在保存比赛并切换存储位置…" })
		a.service.stop("operator storage change")
	}
	if running && a.service.exitCode != 0 {
		a.startService()
		return false, errors.New("无法确认比赛已正常保存，存储位置未切换。请查看日志后重试。")
	}
	if err := storage.change(enabled); err != nil {
		a.log.record("storage change failed: %v", err)
		if running {
			a.startService()
		}
		return false, errors.New("无法切换存储位置。请检查目录权限和可用空间；原有资料仍保留。")
	}
	a.closing = true
	a.quitAllowed = true
	a.update(func(s *launcherState) {
		s.Status = "stopping"
		s.Notice = "已切换存储位置，请重新打开 OCLR。"
	})
	return true, nil
}
func (a *Launcher) checkTosu() {
	path := effectiveTosuPath(a.selectedTosuPath)
	a.update(func(s *launcherState) { s.TosuPath = path })
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
		case errors.Is(probe.portErr, os.ErrNotExist):
			port = "未找到 tosu.env"
		case errors.Is(probe.portErr, errTosuPortMissing):
			port = "tosu.env 未设置 SERVER_PORT"
		case errors.Is(probe.portErr, errTosuPortInvalid):
			port = "tosu.env 的 SERVER_PORT 无效"
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
	if err := a.begin(); err != nil {
		return err
	}
	defer a.end()
	state := a.Snapshot()
	var title, previous string
	switch kind {
	case "tosu":
		title, previous = "选择 tosu.exe", state.TosuPath
	case "osu":
		title, previous = "选择比赛用 osu!Tourney 的 osu!.exe", state.OsuPath
	case "osu-stable":
		title, previous = "选择 Showcase 用 osu!Stable 的 osu!.exe", state.OsuStablePath
	default:
		return errors.New("未知的应用程序。")
	}
	directory := ""
	if filepath.IsAbs(previous) {
		if info, err := os.Stat(filepath.Dir(previous)); err == nil && info.IsDir() {
			directory = filepath.Dir(previous)
		}
	}
	path, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{Title: title, DefaultDirectory: directory, Filters: []wruntime.FileFilter{{DisplayName: "Windows 应用程序", Pattern: "*.exe"}}})
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
	s := a.Snapshot()
	prefs := launcherSettings{TosuPath: a.selectedTosuPath, OsuPath: s.OsuPath, OsuStablePath: s.OsuStablePath}
	switch kind {
	case "tosu":
		if !isExecutable(path) {
			return errors.New("请选择正确的应用程序文件。")
		}
		prefs.TosuPath = path
	case "osu":
		if _, err := resolveOsuExecutable(path); err != nil {
			return err
		}
		if sameOsuInstallation(path, prefs.OsuStablePath) {
			return errors.New("请为 osu!Stable 和 osu!Tourney 选择不同文件夹中的 osu!.exe。")
		}
		prefs.OsuPath = path
	case "osu-stable":
		if _, err := resolveStableOsu(path, prefs.OsuPath); err != nil {
			return err
		}
		prefs.OsuStablePath = path
	default:
		return errors.New("未知的应用程序。")
	}
	p, err := launcherSettingsPath()
	if err != nil {
		return err
	}
	stored := launcherSettings{
		TosuPath:      storage.storeTool(prefs.TosuPath),
		OsuPath:       storage.storeTool(prefs.OsuPath),
		OsuStablePath: storage.storeTool(prefs.OsuStablePath),
	}
	if err = saveLauncherSettings(p, stored); err != nil {
		return errors.New("无法保存路径，请检查设置目录权限。")
	}
	a.selectedTosuPath = prefs.TosuPath
	if kind == "tosu" && a.service != nil && path != s.TosuPath {
		a.service.setTosuPort("")
	}
	a.update(func(s *launcherState) {
		s.TosuPath = prefs.TosuPath
		s.OsuPath = prefs.OsuPath
		s.OsuStablePath = prefs.OsuStablePath
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
	a.checkTosu()
	s := a.Snapshot()
	path := s.TosuPath
	allowed, err := allowTosuStart(path, findExecutableProcess, func() processStatus {
		return osuProcessStatus(s.OsuPath, s.OsuStablePath)
	}, a.confirm)
	if !allowed || err != nil {
		a.checkTosu()
		return err
	}
	cmd := exec.Command(path)
	cmd.Dir = filepath.Dir(path)
	if err := cmd.Start(); err != nil {
		return errors.New("无法启动 tosu，请检查所选程序。")
	}
	go func() {
		err := cmd.Wait()
		if err != nil {
			a.log.record("tosu child exited with error")
		}
		a.op.Lock()
		defer a.op.Unlock()
		if !a.closing && a.Snapshot().TosuPath == path {
			a.update(func(s *launcherState) {
				s.Notice = "tosu 已关闭。"
				if err != nil {
					s.Notice = "tosu 异常退出，请检查后重试。"
				}
			})
			a.checkTosu()
		}
	}()
	a.checkTosu()
	return nil
}

// Recheck after the modal: another process may start tosu while it is open.
func allowTosuStart(path string, tosu func(string) processStatus, osu func() processStatus, confirm func(string, string) bool) (bool, error) {
	check := func() (bool, error) {
		switch tosu(path) {
		case processStopped:
			return true, nil
		case processMissing:
			return false, errors.New("找不到 tosu，请在「服务 → 比赛工具」重新选择。")
		case processRunning:
			return false, nil
		default:
			return false, errors.New("无法确认 tosu 是否已启动，请稍后重试。")
		}
	}
	if ok, err := check(); !ok {
		return false, err
	}
	if status := osu(); status != processRunning {
		detail := "未检测到 osu! 正在运行。"
		if status == processUnknown {
			detail = "暂时无法确认 osu! 是否正在运行。"
		}
		if !confirm("打开 tosu", detail+"\n建议先打开本次使用的 osu! 客户端（比赛用 Tourney，Showcase 用 Stable），再打开 tosu。\n\n仍要打开 tosu 吗？") {
			return false, nil
		}
		return check()
	}
	return true, nil
}
func (a *Launcher) StartOsuStable() error {
	if err := a.begin(); err != nil {
		return err
	}
	defer a.end()
	s := a.Snapshot()
	path, err := resolveStableOsu(s.OsuStablePath, s.OsuPath)
	if err != nil {
		return err
	}
	switch findExecutableProcess(path) {
	case processRunning:
		a.update(func(s *launcherState) { s.Notice = "osu!Stable 已在运行。" })
		return nil
	case processStopped:
		cmd := exec.Command(path)
		cmd.Dir = filepath.Dir(path)
		if err := cmd.Start(); err != nil {
			return errors.New("无法启动 osu!Stable，请检查所选程序。")
		}
		go func() { _ = cmd.Wait() }()
		a.update(func(s *launcherState) { s.Notice = "已启动 osu!Stable。" })
		return nil
	case processMissing:
		return errors.New("找不到 osu!Stable，请在「服务 → 比赛工具」重新选择。")
	default:
		return errors.New("无法确认 osu!Stable 是否已启动，请稍后重试。")
	}
}

func (a *Launcher) Tourney(launch bool) error {
	if err := a.begin(); err != nil {
		return err
	}
	defer a.end()
	if a.service == nil || a.service.exited() {
		return errors.New("请等直播服务就绪后重试。")
	}
	s := a.Snapshot()
	if sameOsuInstallation(s.OsuPath, s.OsuStablePath) {
		return errors.New("请为 osu!Stable 和 osu!Tourney 选择不同文件夹中的 osu!.exe。")
	}
	notice := prepareTourney(s.OsuPath, a.service.pid, launch)
	a.update(func(s *launcherState) { s.Notice = notice })
	return nil
}
func (a *Launcher) OpenBrowser(destination, edition string) error {
	if err := a.begin(); err != nil {
		return err
	}
	defer a.end()
	if a.service == nil || a.service.exited() {
		return errors.New("请先启动直播服务。")
	}
	address, err := browserDestination(a.service.endpoint, destination, edition)
	if err != nil {
		return err
	}
	if call(shell, "ShellExecuteW", 0, ptr("open"), ptr(address), 0, 0, 1) <= 32 {
		return errors.New("无法打开默认浏览器，请重试。")
	}
	return nil
}

func browserDestination(endpoint, destination, edition string) (string, error) {
	switch destination {
	case "control":
		return endpoint + "/control", nil
	case "showcase":
		return endpoint + "/showcase", nil
	case "overlay":
		return endpoint + "/overlay", nil
	case "showcase-output":
		return endpoint + "/showcase?clean=1", nil
	case "showcase-demo":
		return endpoint + "/showcase?cover-demo=1", nil
	case "bilibili":
		return "https://play-live.bilibili.com/", nil
	case "blive-help":
		return "https://blive.chat/help", nil
	case "streaming-login", "streaming-page":
		if len(edition) > 80 || !editionSlug.MatchString(edition) {
			return "", errors.New("请输入有效的授权赛季。")
		}
		if destination == "streaming-login" {
			return endpoint + "/control?desktop-login=" + edition, nil
		}
		return "https://oclr.org/streaming/" + edition, nil
	default:
		return "", errors.New("此链接无法在启动器中打开。")
	}
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
	if call(shell, "ShellExecuteW", 0, ptr("open"), ptr(a.log.path), 0, 0, 1) > 32 {
		return nil
	}
	notepad := filepath.Join(os.Getenv("SystemRoot"), "System32", "notepad.exe")
	if filepath.IsAbs(notepad) && call(shell, "ShellExecuteW", 0, ptr("open"), ptr(notepad), ptr(`"`+a.log.path+`"`), 0, 1) > 32 {
		return nil
	}
	return errors.New("无法打开本机日志。")
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

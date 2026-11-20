package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

var client = &http.Client{
	Timeout: time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

type health struct {
	Project           string
	Build             string
	Ready             bool
	Session           bool
	PID               int
	AuthorizedEdition string
}

func getHealth() (health, error) {
	return readHealth(client, base+"/api/health")
}

func readHealth(client *http.Client, url string) (health, error) {
	var h health
	response, err := client.Get(url)
	if err != nil {
		return h, fmt.Errorf("health request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return h, fmt.Errorf("health HTTP status %d", response.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&h); err != nil {
		// The response can come from another process. Do not record its body.
		switch {
		case os.IsTimeout(err):
			return health{}, errors.New("health response body timed out")
		case errors.Is(err, io.EOF):
			return health{}, errors.New("health response was empty")
		case errors.Is(err, io.ErrUnexpectedEOF):
			return health{}, errors.New("health response JSON was incomplete")
		}
		return health{}, fmt.Errorf("health JSON decode failed (%T)", err)
	}
	return h, nil
}

func healthProblem(h health, expectedPID int) error {
	switch {
	case h.Project != "oclr-stream-overlay":
		return errors.New("health project mismatch")
	case h.Build != buildID:
		return errors.New("health build mismatch")
	case expectedPID != 0 && h.PID != expectedPID:
		return fmt.Errorf("health PID mismatch: expected %d, got %d", expectedPID, h.PID)
	case !h.Ready:
		return errors.New("health backend not ready")
	case !h.Session:
		return errors.New("health session unavailable")
	default:
		return nil
	}
}

func reuse() error {
	for deadline := time.Now().Add(30 * time.Second); time.Now().Before(deadline); {
		h, err := getHealth()
		if err == nil {
			if healthProblem(h, 0) == nil {
				return nil
			}
			if h.Project != "oclr-stream-overlay" || h.Build != buildID {
				return errors.New("另一个版本或其他程序正在使用所选地址。请先在原启动窗口退出，再启动本版本。比赛记录会保留，不会自动结束任何程序。")
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	return errors.New("已有启动窗口，但服务尚未就绪。请查看原窗口的提示，退出后重试。")
}

type backend struct {
	endpoint string
	pid      int
	input    io.WriteCloser
	done     chan struct{}
	exitCode int // Written before done closes.
	log      *diagnostics
	tosuPort string
}

func launchBackend(cmd *exec.Cmd, log *diagnostics) (*backend, error) {
	stderr := &backendStderr{log: log}
	cmd.Stderr = stderr
	input, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		input.Close()
		return nil, err
	}
	b := &backend{endpoint: base, pid: cmd.Process.Pid, input: input, done: make(chan struct{}), log: log}
	log.record("backend started pid=%d", b.pid)
	go func() {
		err := cmd.Wait()
		stderr.flush()
		b.exitCode = cmd.ProcessState.ExitCode()
		detail := ""
		if err != nil {
			detail = err.Error()
		}
		log.record("backend exited pid=%d exit_code=%d wait_error=%q", b.pid, b.exitCode, detail)
		close(b.done)
	}()
	return b, nil
}

func start(log *diagnostics) (_ *backend, err error) {
	defer func() {
		if err != nil {
			log.record("launcher startup failed: %s", err)
		}
	}()
	if _, err := getHealth(); err == nil {
		return nil, errors.New("所选地址已有服务，但未找到对应启动窗口。请先退出原版本服务，再启动本版本；不会结束其他程序。")
	}
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	root := filepath.Dir(exe)
	cmd := exec.Command(filepath.Join(root, "runtime", "node.exe"), filepath.Join(root, "app", "server", entryScript))
	cmd.Dir = root
	// Only launcher-selected storage and port reach the packaged backend.
	for _, v := range os.Environ() {
		key, _, _ := strings.Cut(v, "=")
		switch strings.ToUpper(key) {
		case "OCLR_DATA_DIR", "OCLR_LAUNCHER_SETTINGS", "OCLR_REPLAY_TEMP", "NODE_OPTIONS", "OCLR_APP_PORT":
			continue
		}
		cmd.Env = append(cmd.Env, v)
	}
	cmd.Env = append(cmd.Env, "OCLR_APP_PORT="+servicePort)
	prefs, err := storage.settingsPath()
	if err != nil {
		return nil, err
	}
	cmd.Env = append(cmd.Env, "OCLR_LAUNCHER_SETTINGS="+prefs)
	if storage.enabled {
		cmd.Env = append(cmd.Env, "OCLR_DATA_DIR="+filepath.Join(storage.portableRoot(), dataSubdir),
			"OCLR_REPLAY_TEMP="+filepath.Join(storage.portableRoot(), "ReplayTemp"))
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	b, err := launchBackend(cmd, log)
	if err != nil {
		log.record("backend launch error: %v", err)
		return nil, errors.New("无法运行随包附带的服务。请完整解压压缩包，确认 runtime 文件夹仍在。")
	}
	lastFailure := ""
	for deadline := time.Now().Add(30 * time.Second); time.Now().Before(deadline); {
		if b.exited() {
			return nil, errors.New("服务未能启动。")
		}
		started := time.Now()
		h, probeErr := getHealth()
		answerReceived := probeErr == nil
		if probeErr == nil {
			probeErr = healthProblem(h, b.pid)
		}
		if probeErr == nil {
			log.record("backend ready pid=%d", b.pid)
			return b, nil
		}
		if probeErr.Error() != lastFailure {
			lastFailure = probeErr.Error()
			log.record("health startup failed pid=%d elapsed_ms=%d reason=%q", b.pid, time.Since(started).Milliseconds(), lastFailure)
		}
		if answerReceived && (h.Project != "oclr-stream-overlay" || h.Build != buildID) {
			b.stop("startup address occupied")
			return nil, errors.New("所选地址已被其他版本或程序占用。请退出原服务后重试；不会自动换地址。")
		}
		time.Sleep(150 * time.Millisecond)
	}
	b.stop("startup readiness timeout")
	return nil, errors.New("服务启动超时。请检查磁盘空间、文件权限，并确认压缩包已完整解压。")
}

func (b *backend) exited() bool {
	select {
	case <-b.done:
		return true
	default:
		return false
	}
}

func (b *backend) setTosuPort(port string) {
	if port == b.tosuPort || b.exited() {
		return
	}
	value := port
	if value == "" {
		value = "0"
	}
	if _, err := io.WriteString(b.input, "tosu-port "+value+"\n"); err == nil {
		b.tosuPort = port
	}
}

func (b *backend) stop(reason string) {
	if b.exited() {
		return
	}
	// Only our own child receives shutdown. No process-name/PID sweeping.
	b.log.record("backend shutdown requested pid=%d reason=%q", b.pid, reason)
	io.WriteString(b.input, "shutdown\n")
	b.input.Close()
	select {
	case <-b.done:
	case <-time.After(15 * time.Second):
		message("服务还在保存比赛，请稍候。关闭此提示后会继续等待，不会强制结束服务。")
		<-b.done
	}
}

type serviceState uintptr

const (
	serviceWaiting serviceState = iota + 1
	serviceReady
	serviceExited
)

func (b *backend) probe() error {
	h, err := readHealth(client, b.endpoint+"/api/health")
	if err != nil {
		return err
	}
	return healthProblem(h, b.pid)
}

func (b *backend) watch(probe func() error, interval time.Duration, update func(serviceState)) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	failures := 0
	for {
		select {
		case <-b.done:
			update(serviceExited)
			return
		case <-ticker.C:
		}
		started := time.Now()
		err := probe()
		if b.exited() {
			update(serviceExited)
			return
		}
		elapsed := time.Since(started).Milliseconds()
		if err != nil {
			failures++
			b.log.record("health failed pid=%d consecutive=%d elapsed_ms=%d reason=%q", b.pid, failures, elapsed, err.Error())
			if failures == 1 {
				update(serviceWaiting)
			}
		} else if failures > 0 {
			b.log.record("health recovered pid=%d failures=%d elapsed_ms=%d", b.pid, failures, elapsed)
			failures = 0
			update(serviceReady)
		}
	}
}

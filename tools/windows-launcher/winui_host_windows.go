package main

import (
	"bufio"
	"encoding/json"
	"net"
	"os"
	"sync/atomic"
	"time"
)

type winUIRequest struct {
	Action string `json:"action"`
	Value  string `json:"value"`
}

type winUIReply struct {
	Status      string `json:"status"`
	Detail      string `json:"detail"`
	Base        string `json:"base"`
	Port        string `json:"port"`
	Build       string `json:"build"`
	TosuPath    string `json:"tosuPath"`
	TosuProcess string `json:"tosuProcess"`
	TosuPort    string `json:"tosuPort"`
	OsuPath     string `json:"osuPath"`
	OsuValid    bool   `json:"osuValid"`
	LogPath     string `json:"logPath"`
	Log         string `json:"log"`
}

func reuseWinUIHost() int {
	scanner := bufio.NewScanner(os.Stdin)
	if !scanner.Scan() {
		return 0
	}
	reply := winUIReply{Status: "reused", Base: base}
	if err := reuse(); err != nil {
		reply.Status, reply.Detail = "failed", err.Error()
	}
	_ = json.NewEncoder(os.Stdout).Encode(reply)
	return 0
}

func runWinUIHost() int {
	path, err := launcherSettingsPath()
	var settings launcherSettings
	if err == nil {
		settings, err = loadLauncherSettings(path)
	}
	detail := ""
	if err != nil {
		detail = "无法读取保存的程序路径。"
	}
	var running *backend
	var state *atomic.Uint32
	status := "idle"
	defer func() {
		if running != nil {
			running.stop("WinUI host disconnected")
		}
	}()

	startService := func() string {
		var err error
		running, err = start(localLog)
		if err != nil {
			status = "failed"
			return err.Error()
		}
		status = "ready"
		state = new(atomic.Uint32)
		state.Store(uint32(serviceReady))
		watchState := state
		go running.watch(running.probe, 3*time.Second, func(value serviceState) { watchState.Store(uint32(value)) })
		return ""
	}

	scanner := bufio.NewScanner(os.Stdin)
	output := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var request winUIRequest
		reply := winUIReply{}
		if json.Unmarshal(scanner.Bytes(), &request) != nil {
			return 1
		}
		switch request.Action {
		case "start":
			if status == "idle" {
				startupError := startService()
				if startupError != "" {
					detail = startupError
				}
			}
		case "restart":
			port, err := saveServicePort(request.Value)
			if err != nil {
				detail = err.Error()
				break
			}
			if running != nil {
				running.stop("operator port restart")
			}
			servicePort = port
			base = "http://" + net.JoinHostPort("127.0.0.1", port)
			detail = startService()
		case "select-tosu", "select-osu":
			updated := settings
			if request.Action == "select-tosu" && isExecutable(request.Value) {
				updated.TosuPath = request.Value
			} else if request.Action == "select-osu" && isOsuExecutable(request.Value) {
				updated.OsuPath = request.Value
			} else {
				detail = "请选择有效的应用程序。"
				break
			}
			if path == "" || saveLauncherSettings(path, updated) != nil {
				detail = "无法保存程序路径。"
				break
			}
			if settings.TosuPath != updated.TosuPath && running != nil {
				running.setTosuPort("")
			}
			settings = updated
			detail = "已保存程序路径。"
		case "open-tosu":
			if findExecutableProcess(settings.TosuPath) != processStopped {
				detail = "请先选择 tosu，并检查程序是否正在运行。"
				break
			}
			cmd, err := startTosu(settings.TosuPath)
			if err != nil {
				detail = "无法启动 tosu，请检查所选程序。"
				break
			}
			go func() { _ = cmd.Wait() }()
			detail = "tosu 已启动。"
		case "generate-config", "open-tourney":
			if running == nil || running.exited() {
				detail = "请先启动直播服务。"
				break
			}
			detail = prepareTourney(settings.OsuPath, running.pid, request.Action == "open-tourney")
		case "logs":
			reply.Log, err = localLog.preview()
			if err != nil {
				reply.Log = "无法读取本机日志。"
			}
		case "stop":
			if running != nil {
				running.stop("operator")
				running = nil
			}
			_ = output.Encode(winUIReply{Status: "stopped"})
			return 0
		case "status":
		default:
			detail = "未知的启动器操作。"
		}
		probe := probeTosu(settings.TosuPath, 0)
		if running != nil {
			running.setTosuPort(probe.port)
			switch serviceState(state.Load()) {
			case serviceReady:
				status = "ready"
			case serviceWaiting:
				status = "waiting"
			case serviceExited:
				status = "stopped"
			}
		}
		reply.Status, reply.Detail, reply.Base, reply.Port, reply.Build = status, detail, base, servicePort, buildID
		reply.TosuPath, reply.OsuPath, reply.OsuValid = settings.TosuPath, settings.OsuPath, isOsuExecutable(settings.OsuPath)
		reply.TosuProcess, _ = tosuProcessDisplay(probe.process)
		reply.TosuPort, _ = tosuPortDisplay(probe)
		reply.LogPath = localLog.path
		if output.Encode(reply) != nil {
			return 1
		}
		detail = ""
	}
	return 0
}

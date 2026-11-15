package main

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	tournamentConfig  = "tournament.cfg"
	osuExecutableName = "osu!.exe"
)

var editionSlug = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
var osuPath string
var tourneyBusy bool
var tourneyResults = make(chan string, 1)

func isOsuExecutable(path string) bool {
	return strings.EqualFold(filepath.Base(path), osuExecutableName) && isExecutable(path)
}

func osuProcessStatus(path string) processStatus {
	if path == "" {
		return findProcess(osuExecutableName, "")
	}
	return findExecutableProcess(path)
}

func chooseOsu(owner uintptr) {
	path, err := pickExecutable(owner, osuPath, "选择 osu!stable 的 osu!.exe")
	if err != nil {
		showTourney("无法打开文件选择窗口，请重试。")
		return
	}
	if path == "" {
		return
	}
	if !isOsuExecutable(path) {
		showTourney("请选择 osu!stable 的 osu!.exe。")
		return
	}
	if settingsFile == "" || saveLauncherSettings(settingsFile, launcherSettings{TosuPath: tosuPath, OsuPath: path}) != nil {
		showTourney("无法保存路径，请检查设置目录权限。")
		return
	}
	osuPath = path
	showTourney("已保存 osu! 路径。生成或打开时会读取当前授权赛季。")
}

func writeTournamentConfig(dir, edition string) error {
	if len(edition) > 80 || !editionSlug.MatchString(edition) {
		return errors.New("invalid authorized edition")
	}
	content := []byte(strings.Join([]string{
		"TeamSize = 4",
		"Height = 1080",
		"acronym = OCLR " + strings.ToUpper(edition),
		"privateserver = ",
		"BufferTotalTime = 3000",
		"BufferDangerTime = 1000",
		"BufferTimeoutTime = 20000",
		"ClientNameSize = 56",
		"ContactTime = 10000",
		"RankingChatDelay = 15000",
		"StartupDelay = 0",
		"Aspect = 2",
		"",
	}, "\r\n"))
	path := filepath.Join(dir, tournamentConfig)
	info, err := os.Lstat(path)
	if err == nil {
		if !info.Mode().IsRegular() {
			return errors.New("existing tournament.cfg is not a regular file")
		}
		old, err := os.ReadFile(path)
		if err != nil || bytes.Equal(old, content) {
			return err
		}
		if err := replaceFile(path+".oclr.bak", old); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return replaceFile(path, content)
}

func runTourney(owner uintptr, launch bool) {
	if tourneyBusy {
		return
	}
	if service == nil {
		showTourney("请等直播服务就绪后重试。")
		return
	}
	tourneyBusy = true
	showTourney("正在读取授权赛季并检查 osu!…")
	path, pid := osuPath, service.pid
	go func() {
		tourneyResults <- prepareTourney(path, pid, launch)
		call(user, "PostMessageW", owner, msgTourneyFinished, 0, 0)
	}()
}

func prepareTourney(path string, pid int, launch bool) string {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || !isOsuExecutable(path) || !isOsuExecutable(resolved) {
		return "找不到所选 osu!.exe，请重新选择。"
	}
	h, err := getHealth()
	if err != nil || healthProblem(h, pid) != nil {
		return "无法读取本机直播服务，请稍后重试。"
	}
	edition := h.AuthorizedEdition
	if edition == "" {
		return "请在直播控制台连接授权赛季，等待连接成功后重试。"
	}
	switch findExecutableProcess(resolved) {
	case processRunning:
		return "所选 osu! 正在运行，请关闭后再试。"
	case processMissing:
		return "找不到所选 osu!.exe，请重新选择。"
	case processUnknown:
		return "无法确认 osu! 是否已关闭，请稍后重试。"
	}
	dir := filepath.Dir(resolved)
	if err := writeTournamentConfig(dir, edition); err != nil {
		return "无法写入 tournament.cfg，请检查 osu! 文件夹的写入权限。"
	}
	season := "OCLR " + strings.ToUpper(edition)
	if !launch {
		return "已生成 tournament.cfg · " + season
	}
	cmd := exec.Command(resolved)
	cmd.Dir = dir
	if err := cmd.Start(); err != nil {
		return "已生成 tournament.cfg，但无法启动 osu!。请检查所选程序。"
	}
	go func() { _ = cmd.Wait() }()
	return "已启动 osu!Tourney · " + season
}

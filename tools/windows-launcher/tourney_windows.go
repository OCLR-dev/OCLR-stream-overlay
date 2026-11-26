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

func isOsuExecutable(path string) bool {
	return strings.EqualFold(filepath.Base(path), osuExecutableName) && isExecutable(path)
}

func resolveOsuExecutable(path string) (string, error) {
	if !isOsuExecutable(path) {
		return "", errors.New("找不到所选 osu!.exe，请在「服务 → 比赛工具」重新选择。")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || !isOsuExecutable(resolved) {
		return "", errors.New("找不到所选 osu!.exe，请在「服务 → 比赛工具」重新选择。")
	}
	return resolved, nil
}

func sameOsuInstallation(first, second string) bool {
	a, err := resolveOsuExecutable(first)
	if err != nil {
		return false
	}
	b, err := resolveOsuExecutable(second)
	if err != nil {
		return false
	}
	left, lerr := os.Stat(filepath.Dir(a))
	right, rerr := os.Stat(filepath.Dir(b))
	return lerr == nil && rerr == nil && os.SameFile(left, right)
}

func resolveStableOsu(path, tourney string) (string, error) {
	resolved, err := resolveOsuExecutable(path)
	if err != nil {
		return "", err
	}
	if sameOsuInstallation(resolved, tourney) {
		return "", errors.New("请为 osu!Stable 和 osu!Tourney 选择不同文件夹中的 osu!.exe。")
	}
	if _, err := os.Lstat(filepath.Join(filepath.Dir(resolved), tournamentConfig)); !errors.Is(err, os.ErrNotExist) {
		return "", errors.New("请在「服务 → 比赛工具 → osu!Stable」选择不含 tournament.cfg 的普通客户端。")
	}
	return resolved, nil
}

func osuProcessStatus(tourney, stable string) processStatus {
	if tourney == "" && stable == "" {
		return findProcess(osuExecutableName, "")
	}
	status := processStopped
	for _, path := range []string{tourney, stable} {
		if path == "" {
			continue
		}
		switch findExecutableProcess(path) {
		case processRunning:
			return processRunning
		case processUnknown:
			status = processUnknown
		}
	}
	return status
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

func prepareTourney(path string, pid int, launch bool) string {
	resolved, err := resolveOsuExecutable(path)
	if err != nil {
		return err.Error()
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

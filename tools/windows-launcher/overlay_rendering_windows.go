package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

type overlayRendering struct {
	HighResolution bool   `json:"highResolution"`
	Applied        bool   `json:"applied"`
	Error          string `json:"error"`
}

func (a *Launcher) GetOverlayRendering() (overlayRendering, error) {
	return a.overlayRendering(nil)
}

func (a *Launcher) SetOverlayRendering(highResolution bool) (overlayRendering, error) {
	if err := a.begin(); err != nil {
		return overlayRendering{}, err
	}
	defer a.end()
	return a.overlayRendering(&highResolution)
}

func (a *Launcher) overlayRendering(highResolution *bool) (overlayRendering, error) {
	state := a.Snapshot()
	if state.Status != "ready" || state.ServicePID == 0 {
		return overlayRendering{}, errors.New("请等待直播服务就绪后再调整画面设置。")
	}
	h, err := readHealth(client, state.Address+"/api/health")
	if err != nil || healthProblem(h, state.ServicePID) != nil {
		return overlayRendering{}, errors.New("本机直播服务暂未响应，请稍后重试。")
	}
	return requestOverlayRendering(state.Address, highResolution)
}

func requestOverlayRendering(endpoint string, highResolution *bool) (overlayRendering, error) {
	method := http.MethodGet
	var body io.Reader
	if highResolution != nil {
		method = http.MethodPost
		payload, _ := json.Marshal(struct {
			Action         string `json:"action"`
			HighResolution bool   `json:"highResolution"`
		}{"overlay-rendering", *highResolution})
		body = bytes.NewReader(payload)
	}
	req, err := http.NewRequest(method, endpoint+"/api/obs", body)
	if err != nil {
		return overlayRendering{}, err
	}
	if highResolution != nil {
		req.Header.Set("Origin", endpoint)
		req.Header.Set("Content-Type", "application/json")
	}
	obsClient := *client
	obsClient.Timeout = 10 * time.Second
	resp, err := obsClient.Do(req)
	if err != nil {
		return overlayRendering{}, errors.New("无法读取画面设置，请稍后重试。")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		var failure struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&failure) == nil && failure.Error.Message != "" {
			return overlayRendering{}, errors.New(failure.Error.Message)
		}
		return overlayRendering{}, errors.New("未能读取或保存画面设置，请稍后重试。")
	}
	var data struct {
		Rendering *overlayRendering `json:"overlayRendering"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&data); err != nil || data.Rendering == nil {
		return overlayRendering{}, errors.New("无法读取画面设置，请稍后重试。")
	}
	return *data.Rendering, nil
}

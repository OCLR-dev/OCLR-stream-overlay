package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOverlayRenderingRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/obs" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `{"overlayRendering":{"highResolution":false,"applied":false,"error":""},"error":""}`)
			return
		}
		var body struct {
			Action         string `json:"action"`
			HighResolution bool   `json:"highResolution"`
		}
		if r.Method != http.MethodPost || r.Header.Get("Origin") != "http://"+r.Host ||
			r.Header.Get("Content-Type") != "application/json" || json.NewDecoder(r.Body).Decode(&body) != nil ||
			body.Action != "overlay-rendering" || !body.HighResolution {
			t.Error("unexpected rendering request")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_, _ = io.WriteString(w, `{"overlayRendering":{"highResolution":true,"applied":false,"error":""},"error":""}`)
	}))
	defer server.Close()

	prefs, err := requestOverlayRendering(server.URL, nil)
	if err != nil || prefs.HighResolution {
		t.Fatalf("default rendering = %+v, error %v", prefs, err)
	}
	high := true
	prefs, err = requestOverlayRendering(server.URL, &high)
	if err != nil || !prefs.HighResolution || prefs.Applied {
		t.Fatalf("saved rendering = %+v, error %v", prefs, err)
	}
}

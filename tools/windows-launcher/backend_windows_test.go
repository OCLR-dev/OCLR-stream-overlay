package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestBackendChild(t *testing.T) {
	if os.Getenv("OCLR_TEST_BACKEND_CHILD") != "1" {
		return
	}
	fmt.Fprint(os.Stderr, "合成后端错误\r\npartial stderr line")
	var command [1]byte
	_, _ = os.Stdin.Read(command[:])
	os.Exit(23)
}

func TestWatchRecoversAfterMultipleFailuresAndReportsActualExit(t *testing.T) {
	log := &diagnostics{path: filepath.Join(t.TempDir(), "launcher.log")}
	cmd := exec.Command(os.Args[0], "-test.run=^TestBackendChild$")
	cmd.Env = append(os.Environ(), "OCLR_TEST_BACKEND_CHILD=1")
	b, err := launchBackend(cmd, log)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		<-b.done
	})

	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		status := health{Project: "oclr-stream-overlay", Build: buildID, Ready: true, Session: true, PID: b.pid}
		switch calls.Add(1) {
		case 1:
			// An unrelated response at the same address must not count as recovery.
			status.PID++
		case 2, 3:
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_ = json.NewEncoder(w).Encode(status)
	}))
	defer server.Close()
	probe := func() error {
		h, err := readHealth(server.Client(), server.URL)
		if err != nil {
			return err
		}
		return healthProblem(h, b.pid)
	}
	states := make(chan serviceState, 4)
	go b.watch(probe, 20*time.Millisecond, func(state serviceState) { states <- state })
	checkState(t, states, serviceWaiting)
	checkState(t, states, serviceReady)
	if b.exited() {
		t.Fatal("health failures stopped the backend")
	}
	if _, err := b.input.Write([]byte{'x'}); err != nil {
		t.Fatal(err)
	}
	checkState(t, states, serviceExited)
	if b.exitCode != 23 {
		t.Fatalf("exit code = %d, want 23", b.exitCode)
	}
	data, err := os.ReadFile(log.path)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range []string{
		"health PID mismatch", "consecutive=3", "health HTTP status 503", "health recovered",
		"failures=3", "合成后端错误", "partial stderr line", "exit_code=23",
	} {
		if !bytes.Contains(data, []byte(entry)) {
			t.Errorf("missing %q in log:\n%s", entry, data)
		}
	}
	if bytes.Index(data, []byte("partial stderr line")) > bytes.Index(data, []byte("exit_code=23")) {
		t.Error("the final stderr line must be flushed before reporting exit")
	}
}

func checkState(t *testing.T, states <-chan serviceState, want serviceState) {
	t.Helper()
	select {
	case got := <-states:
		if got != want {
			t.Fatalf("service state = %d, want %d", got, want)
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for service state %d", want)
	}
}

func TestDiagnosticsRotateAndBoundStderr(t *testing.T) {
	log := &diagnostics{path: filepath.Join(t.TempDir(), "launcher.log")}
	previous := bytes.Repeat([]byte{'a'}, logLimit)
	if err := os.WriteFile(log.path, previous, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(log.path+".1", []byte("older"), 0600); err != nil {
		t.Fatal(err)
	}
	stderr := &backendStderr{log: log}
	_, _ = stderr.Write(bytes.Repeat([]byte{'b'}, stderrLimit+100))
	_, _ = stderr.Write([]byte("\nnext line\n"))
	rotated, err := os.ReadFile(log.path + ".1")
	if err != nil || !bytes.Equal(rotated, previous) {
		t.Fatal("the previous log was not rotated", err)
	}
	current, err := os.ReadFile(log.path)
	if err != nil {
		t.Fatal(err)
	}
	if len(current) >= stderrLimit+250 || !bytes.Contains(current, []byte("truncated=true")) ||
		!bytes.Contains(current, []byte("\"next line\" (truncated=false)")) {
		t.Fatal("stderr line limit lost the next record")
	}
}

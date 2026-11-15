package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	logLimit    = 1024 * 1024
	stderrLimit = 8 * 1024
)

type diagnostics struct {
	sync.Mutex
	path string
}

func launcherDiagnostics() *diagnostics {
	log := &diagnostics{}
	if path, err := launcherSettingsPath(); err == nil {
		log.path = filepath.Join(filepath.Dir(path), "launcher.log")
	}
	return log
}

func (d *diagnostics) record(format string, args ...any) {
	d.Lock()
	defer d.Unlock()
	if d.path == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(d.path), 0700); err != nil {
		return
	}
	entry := time.Now().Format(time.RFC3339Nano) + " " + fmt.Sprintf(format, args...) + "\r\n"
	if info, err := os.Stat(d.path); err == nil && info.Size()+int64(len(entry)) > logLimit {
		if err := os.Rename(d.path, d.path+".1"); err != nil {
			return
		}
	}
	if file, err := os.OpenFile(d.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600); err == nil {
		_, _ = file.WriteString(entry)
		_ = file.Close()
	}
}

// exec copies stderr on one goroutine. Wait returns after that copy completes.
type backendStderr struct {
	log       *diagnostics
	line      []byte
	truncated bool
}

func (s *backendStderr) Write(p []byte) (int, error) {
	n := len(p)
	for len(p) > 0 {
		line, rest, complete := bytes.Cut(p, []byte{'\n'})
		available := stderrLimit - len(s.line)
		if len(line) > available {
			line = line[:available]
			s.truncated = true
		}
		s.line = append(s.line, line...)
		if complete {
			s.flush()
		}
		p = rest
	}
	return n, nil
}

func (s *backendStderr) flush() {
	line := bytes.TrimSuffix(s.line, []byte{'\r'})
	if len(line) > 0 {
		s.log.record("backend stderr: %q (truncated=%t)", line, s.truncated)
	}
	s.line = s.line[:0]
	s.truncated = false
}

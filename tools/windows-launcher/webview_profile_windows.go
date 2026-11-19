package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/windows"
)

const (
	webviewProfilePrefix = "session-"
	webviewProfileLease  = ".oclr-profile"
	webviewProfileData   = "data"
	webviewProfileGrace  = time.Hour
)

// The launcher stores its settings in Go. WebView2 only needs a cache for
// this process. Reusing its directory can attach to a browser that is exiting.
func newWebviewProfile(cache string) (string, *os.File, error) {
	if err := os.MkdirAll(cache, 0700); err != nil {
		return "", nil, err
	}
	profile, err := os.MkdirTemp(cache, webviewProfilePrefix)
	if err != nil {
		return "", nil, err
	}
	marker := filepath.Join(profile, webviewProfileLease)
	lease, err := os.OpenFile(marker, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	if err == nil {
		err = lockWebviewLease(lease)
		if err == nil {
			return filepath.Join(profile, webviewProfileData), lease, nil
		}
		_ = lease.Close()
		_ = os.Remove(marker)
	}
	_ = os.Remove(profile)
	return "", nil, err
}

func lockWebviewLease(file *os.File) error {
	return windows.LockFileEx(windows.Handle(file.Fd()),
		windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY,
		0, 1, 0, &windows.Overlapped{})
}

// Wait for old browser processes to release the cache before trying to
// remove it. An open lease also protects a launcher in another Windows session.
func pruneWebviewProfiles(cache string, now time.Time) {
	root, err := os.OpenRoot(cache)
	if err != nil {
		return
	}
	defer root.Close()
	entries, err := fs.ReadDir(root.FS(), ".")
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), webviewProfilePrefix) {
			continue
		}
		marker := filepath.Join(entry.Name(), webviewProfileLease)
		info, err := root.Lstat(marker)
		if err != nil || !info.Mode().IsRegular() || now.Sub(info.ModTime()) < webviewProfileGrace {
			continue
		}
		lease, err := root.OpenFile(marker, os.O_RDWR, 0)
		if err != nil {
			continue
		}
		err = lockWebviewLease(lease)
		_ = lease.Close()
		if err == nil {
			// No launcher reopens a retired profile. Keep the marker if
			// Windows still has a file open so a later scan can retry.
			if root.RemoveAll(filepath.Join(entry.Name(), webviewProfileData)) == nil {
				_ = root.Remove(marker)
				_ = root.Remove(entry.Name())
			}
		}
	}
}

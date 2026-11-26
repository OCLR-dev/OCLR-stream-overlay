package main

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

const storageMarker = "OCLR-portable"

type portableStorage struct {
	packageDir string
	enabled    bool
}

// Set once before starting a launcher or its child; changes take effect on reopen.
var storage portableStorage

func detectStorage(packageDir string) (portableStorage, error) {
	mode := portableStorage{packageDir: packageDir}
	marker, err := os.Lstat(filepath.Join(packageDir, storageMarker))
	if errors.Is(err, os.ErrNotExist) {
		return mode, nil
	}
	if err != nil {
		return mode, err
	}
	if !marker.Mode().IsRegular() {
		return mode, errors.New("invalid portable storage marker")
	}
	mode.enabled = true
	return mode, nil
}

func appDataRoot() (string, error) {
	local := os.Getenv("LOCALAPPDATA")
	if !filepath.IsAbs(local) {
		return "", errors.New("local app data directory is unavailable")
	}
	return filepath.Join(local, "OCLR"), nil
}

func (s portableStorage) portableRoot() string { return filepath.Join(s.packageDir, "OCLR-data") }

func (s portableStorage) root() (string, error) {
	if s.enabled {
		return s.portableRoot(), nil
	}
	return appDataRoot()
}

func (s portableStorage) settingsPath() (string, error) {
	root, err := s.root()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "StreamOverlayLauncher", "settings.json"), nil
}

func (s portableStorage) readTool(path string) string {
	if s.enabled && filepath.IsLocal(path) && strings.HasPrefix(path, `.\`) {
		return filepath.Join(s.packageDir, path)
	}
	return path
}

func (s portableStorage) storeTool(path string) string {
	if s.enabled && filepath.IsAbs(path) {
		if rel, err := filepath.Rel(s.packageDir, path); err == nil && filepath.IsLocal(rel) {
			return `.\` + rel
		}
	}
	return path
}

// First use copies both profiles before writing the mode marker. Later switches
// select an existing profile without replacing either side's data.
func (s portableStorage) change(enabled bool) error {
	marker := filepath.Join(s.packageDir, storageMarker)
	if !enabled {
		if _, err := appDataRoot(); err != nil {
			return err
		}
		return os.Remove(marker)
	}
	if err := s.preparePortableProfile(); err != nil {
		return err
	}
	return replaceFile(marker, []byte("OCLR portable storage\n"))
}

func (s portableStorage) preparePortableProfile() error {
	destination := s.portableRoot()
	if info, err := os.Lstat(destination); err == nil {
		if !info.IsDir() {
			return errors.New("portable data location is not a directory")
		}
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	root, err := appDataRoot()
	if err != nil {
		return err
	}
	stage, err := os.MkdirTemp(s.packageDir, ".oclr-data-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	for _, name := range []string{"StreamOverlayLauncher", "StreamOverlay"} {
		if err := copyStorageDirectory(filepath.Join(root, name), filepath.Join(stage, name), name == "StreamOverlayLauncher"); err != nil {
			return err
		}
	}
	settings := filepath.Join(stage, "StreamOverlayLauncher", "settings.json")
	if err := s.rebaseCopiedToolPaths(settings); err != nil {
		return err
	}
	return os.Rename(stage, destination)
}

func (s portableStorage) rebaseCopiedToolPaths(settings string) error {
	data, err := os.ReadFile(settings)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var prefs map[string]json.RawMessage
	if json.Unmarshal(data, &prefs) != nil {
		// Preserve the original bytes and let the usual settings reader report errors.
		return nil
	}
	s.enabled = true
	changed := false
	for _, key := range []string{"tosuPath", "osuPath", "osuStablePath"} {
		var original string
		if json.Unmarshal(prefs[key], &original) != nil {
			continue
		}
		if path := s.storeTool(original); path != original {
			prefs[key], _ = json.Marshal(path)
			changed = true
		}
	}
	if !changed {
		return nil
	}
	data, err = json.Marshal(prefs)
	if err != nil {
		return err
	}
	return replaceFile(settings, data)
}

func copyStorageDirectory(source, target string, launcher bool) error {
	root, err := os.OpenRoot(source)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer root.Close()
	return fs.WalkDir(root.FS(), ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if launcher && strings.EqualFold(path, "WebView2Sessions") && entry.IsDir() {
			return fs.SkipDir
		}
		output := filepath.Join(target, filepath.FromSlash(path))
		if entry.IsDir() {
			return os.Mkdir(output, 0700)
		}
		if !entry.Type().IsRegular() {
			return errors.New("unsupported file in OCLR data")
		}
		input, err := root.Open(path)
		if err != nil {
			return err
		}
		defer input.Close()
		file, err := os.OpenFile(output, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		_, err = io.Copy(file, input)
		return errors.Join(err, file.Close())
	})
}

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
)

var (
	govRunnerPathOnce sync.Once
	govRunnerPathVal  string
	govRunnerPathErr  error
)

func govRunnerCacheName() string {
	if runtime.GOOS == "windows" {
		return "gov-runner.exe"
	}
	return "gov-runner"
}

func resolveGovRunnerPath() (string, error) {
	govRunnerPathOnce.Do(func() {
		govRunnerPathVal, govRunnerPathErr = resolveGovRunnerPathImpl()
	})
	return govRunnerPathVal, govRunnerPathErr
}

func resolveGovRunnerPathImpl() (string, error) {
	if len(govRunnerEmbedded) > 0 {
		return materializeEmbeddedGovRunner()
	}
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	exeDir := filepath.Dir(exePath)
	runnerPath := filepath.Join(exeDir, govRunnerPath)
	if _, err := os.Stat(runnerPath); err == nil {
		return runnerPath, nil
	}
	runnerPath = filepath.Join(filepath.Dir(exeDir), govRunnerPath)
	if _, err := os.Stat(runnerPath); err == nil {
		return runnerPath, nil
	}
	return "", errors.New("gov-runner 可执行文件不存在（请构建 gov-runner 或使用默认嵌入构建）")
}

func materializeEmbeddedGovRunner() (string, error) {
	sum := sha256.Sum256(govRunnerEmbedded)
	sumHex := hex.EncodeToString(sum[:])
	cacheRoot, err := os.UserCacheDir()
	if err != nil {
		cacheRoot = os.TempDir()
	}
	dir := filepath.Join(cacheRoot, "datatoolbox", "gov-runner-"+sumHex[:16])
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("创建缓存目录失败: %w", err)
	}
	out := filepath.Join(dir, govRunnerCacheName())
	marker := filepath.Join(dir, ".sha256")
	needWrite := true
	if prev, err := os.ReadFile(marker); err == nil && string(prev) == sumHex {
		if st, err := os.Stat(out); err == nil && st.Size() == int64(len(govRunnerEmbedded)) {
			needWrite = false
		}
	}
	if needWrite {
		tmp := out + ".tmp"
		if err := os.WriteFile(tmp, govRunnerEmbedded, 0755); err != nil {
			return "", fmt.Errorf("写入 gov-runner 失败: %w", err)
		}
		if err := os.Rename(tmp, out); err != nil {
			os.Remove(tmp)
			return "", fmt.Errorf("安装 gov-runner 失败: %w", err)
		}
		if err := os.WriteFile(marker, []byte(sumHex), 0644); err != nil {
			return "", err
		}
	} else {
		_ = os.Chmod(out, 0755)
	}
	return out, nil
}

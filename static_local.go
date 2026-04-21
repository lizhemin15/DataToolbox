//go:build release

package main

import (
	"net/http"
	"os"
	"path/filepath"
)

// release 模式下从本地文件系统读取静态文件
// 静态文件放在可执行文件同级的 web 目录下

func newStaticFileHandler() http.Handler {
	// 获取可执行文件所在目录
	execPath, err := os.Executable()
	if err != nil {
		execPath = "."
	} else {
		execPath = filepath.Dir(execPath)
	}

	// 静态文件目录
	webDir := filepath.Join(execPath, "web")

	// 如果 web 目录不存在，尝试当前目录下的 web
	if _, err := os.Stat(webDir); os.IsNotExist(err) {
		webDir = "web"
	}

	return http.FileServer(http.Dir(webDir))
}

//go:build release

package main

import (
	"net/http"
	"os"
	"path/filepath"
)

// release 模式下从本地文件系统读取静态文件
// 静态文件直接放在可执行文件同级目录（index.html, apps, css, js, lib）
// 与配置文件（apps/data-ontology/data-store.json）共用同一目录，消除 web 副本冗余

func newStaticFileHandler() http.Handler {
	// 获取可执行文件所在目录
	execPath, err := os.Executable()
	if err != nil {
		execPath = "."
	} else {
		execPath = filepath.Dir(execPath)
	}

	// 静态文件直接在可执行文件目录下，不需要 web 子目录
	// 这样静态文件和配置文件（apps/data-ontology/data-store.json）在同一位置
	return http.FileServer(http.Dir(execPath))
}

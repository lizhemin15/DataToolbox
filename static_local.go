// static_local.go - 静态文件从本地文件系统读取
//
// 前后端分离架构：
// - 静态文件（index.html, js/, css/, lib/, examples/）与二进制同级
// - 数据文件在 data/ 目录
// - 修改静态文件无需重新编译，直接替换即可生效

package main

import (
	"net/http"
	"os"
	"path/filepath"
)

func newStaticFileHandler() http.Handler {
	// 获取可执行文件所在目录
	execPath, err := os.Executable()
	if err != nil {
		execPath = "."
	} else {
		execPath = filepath.Dir(execPath)
	}

	// 静态文件直接在可执行文件目录下
	// 修改静态文件无需重新编译，直接替换即可
	fileServer := http.FileServer(http.Dir(execPath))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// JS/CSS/HTML 文件及根路径禁用缓存，确保更新即时生效
		path := r.URL.Path
		isStatic := len(path) > 3 && (path[len(path)-3:] == ".js" || path[len(path)-4:] == ".css" || path[len(path)-5:] == ".html")
		isRoot := path == "/" || path == "/index.html"
		if isStatic || isRoot {
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			w.Header().Set("Pragma", "no-cache")
			w.Header().Set("Expires", "0")
		}
		fileServer.ServeHTTP(w, r)
	})
}

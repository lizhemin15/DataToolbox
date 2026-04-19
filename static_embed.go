//go:build !release

package main

import (
	"embed"
	"net/http"
)

// 静态资源嵌入：go embed 遵循 .gitignore（含全局规则）；apps/data-ontology/.gitignore 中
// 对 index.html 使用 ! 取消忽略，确保该入口页始终被打进二进制。
//
//go:embed index.html apps css js lib
var staticAssets embed.FS

func newStaticFileHandler() http.Handler {
	return http.FileServer(http.FS(staticAssets))
}

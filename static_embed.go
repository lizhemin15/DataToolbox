//go:build !release

package main

import (
	"embed"
	"net/http"
)

// 静态资源嵌入（开发模式）
// 前端文件在根目录：index.html, script.js, style.css, lib/, example_files/
// 数据文件在 apps/data-ontology/：data-store.db, data-store.json, quality-audit.db
//
//go:embed index.html share.html quality-audit.html script.js style.css governance.js gov-api.js gov-shared.js qa-shared.js quality-audit.js lib example_files apps
var staticAssets embed.FS

func newStaticFileHandler() http.Handler {
	return http.FileServer(http.FS(staticAssets))
}

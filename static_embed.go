package main

import (
	"embed"
	"net/http"
)

//go:embed index.html apps css js lib
var staticAssets embed.FS

func newStaticFileHandler() http.Handler {
	return http.FileServer(http.FS(staticAssets))
}

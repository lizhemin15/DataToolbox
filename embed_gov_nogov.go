//go:build nogov

package main

// 使用 -tags=nogov 时从可执行文件目录查找 gov-runner，不嵌入二进制
var govRunnerEmbedded []byte

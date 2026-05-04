//go:build windows && !nogov

package main

import _ "embed"

//go:embed gov-runner.exe
var govRunnerEmbedded []byte

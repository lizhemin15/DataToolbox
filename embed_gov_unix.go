//go:build !windows && !nogov

package main

import _ "embed"

//go:embed gov-runner/gov-runner
var govRunnerEmbedded []byte

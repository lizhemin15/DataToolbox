package asr

import "context"

// Transcriber is the interface for speech-to-text transcription.
type Transcriber interface {
	Transcribe(ctx context.Context, audioData []byte) (string, error)
}

// DetectTranscriber returns a Transcriber if one is configured, or nil.
func DetectTranscriber(cfg interface{}) Transcriber {
	return nil
}

// NewAgent creates a new voice agent (stub).
func NewAgent(msgBus interface{}, transcriber Transcriber) interface{} {
	return nil
}

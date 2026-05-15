package tts

import "context"

// TTSProvider is the interface for text-to-speech synthesis.
type TTSProvider interface {
	Synthesize(ctx context.Context, text string) ([]byte, error)
}

// DetectTTS returns a TTSProvider if one is configured, or nil.
func DetectTTS(cfg interface{}) TTSProvider {
	return nil
}

// SynthesizeAndStore synthesizes speech and stores it (stub).
func SynthesizeAndStore(ctx context.Context, provider TTSProvider, text string, store interface{}) (interface{}, error) {
	return nil, nil
}

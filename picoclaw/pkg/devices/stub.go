package devices

// Service manages devices (stub).
type Service struct{}

// Config configures the device service (stub).
type Config struct{}

// NewService creates a new device service (stub).
func NewService(cfg Config) *Service {
	return &Service{}
}

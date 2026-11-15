package source

import (
	"context"
	"log"
	"path/filepath"
	"time"

	"officeapi/internal/config"
	"officeapi/internal/derive"
	"officeapi/internal/loader"
)

// local reads the Hermes home on this machine. All filesystem knowledge lives
// in loader/store; this type only adapts it to Source.
type local struct {
	cfg config.Config
	l   *loader.Loader
}

// NewLocal builds the filesystem-backed source.
func NewLocal(cfg config.Config, logger *log.Logger) Source {
	return &local{cfg: cfg, l: loader.New(cfg, logger)}
}

func (s *local) Kind() string { return "local" }

func (s *local) Home() string { return filepath.Clean(s.cfg.Home) }

func (s *local) Snapshot(_ context.Context, now time.Time) (derive.Snapshot, error) {
	// Per-profile errors are handled inside the loader: one unreadable state.db
	// never fails the whole snapshot.
	return s.l.Snapshot(now), nil
}

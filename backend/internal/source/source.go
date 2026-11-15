// Package source abstracts where office data comes from.
//
//   - local  — read state.db + gateway_state.json under HERMES_HOME (the default)
//   - remote — proxy another office's /api/status over HTTP (federation)
//
// The HTTP surface only depends on the Source interface, so nothing above this
// package knows whether the data came from a filesystem or the network.
package source

import (
	"context"
	"fmt"
	"log"
	"time"

	"officeapi/internal/config"
	"officeapi/internal/derive"
	"officeapi/internal/roster"
)

// Source supplies office snapshots.
type Source interface {
	// Kind is "local" or "remote"; it is published in /api/config and /api/health.
	Kind() string
	// Home describes where the data lives (a directory, or the upstream URL).
	Home() string
	// Snapshot returns the current office state.
	Snapshot(ctx context.Context, now time.Time) (derive.Snapshot, error)
}

// Upstream is implemented by sources that can also proxy another office's
// roster/title/timezone. Optional: /api/config falls back to the local roster.
type Upstream interface {
	UpstreamConfig(ctx context.Context) (*roster.Document, error)
}

// New picks the implementation named by cfg.Source.
func New(cfg config.Config, logger *log.Logger) (Source, error) {
	if logger == nil {
		logger = log.Default()
	}
	switch cfg.Source {
	case "", "local":
		return NewLocal(cfg, logger), nil
	case "remote":
		return NewRemote(cfg.RemoteURL, logger)
	default:
		return nil, fmt.Errorf("sumber data %q tidak dikenal (local|remote)", cfg.Source)
	}
}

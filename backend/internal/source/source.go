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
	// It must never contain credentials: a remote URL is published redacted.
	Home() string
	// Snapshot returns the current office state.
	Snapshot(ctx context.Context, now time.Time) (derive.Snapshot, error)
}

// Upstream is implemented by sources that can also proxy another office's
// roster/title/timezone. Optional: /api/config falls back to the local roster.
type Upstream interface {
	UpstreamConfig(ctx context.Context) (*roster.Document, error)
}

// DBStatus is a database health probe result. Available=false means the source
// has no local databases to look at (remote federation), not that they are OK.
type DBStatus struct {
	Available bool
	Checked   int
	OK        int
	Err       int
	Failed    []string
}

// Degraded is true when databases exist and none of them could be opened.
func (d DBStatus) Degraded() bool { return d.Available && d.Checked > 0 && d.OK == 0 && d.Err > 0 }

// Health is implemented by sources that read local databases and can report
// whether they are openable. /api/health uses it; a source without it reports
// no database block at all.
type Health interface {
	DBStatus(ctx context.Context) DBStatus
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

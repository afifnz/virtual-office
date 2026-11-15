package source

import (
	"context"
	"log"
	"sync"
	"time"

	"officeapi/internal/config"
	"officeapi/internal/derive"
	"officeapi/internal/loader"
)

// SnapshotTTL is how long a built snapshot is reused. /api/status is public and
// every open tab polls it every 4 s; without this each request re-reads every
// state.db, so viewers (or a curl loop) multiply database reads.
const SnapshotTTL = 2 * time.Second

// local reads the Hermes home on this machine. All filesystem knowledge lives
// in loader/store; this type only adapts it to Source.
type local struct {
	cfg config.Config
	l   *loader.Loader

	// mu is held while a snapshot is built, so concurrent requests wait for
	// one read instead of queueing their own.
	mu     sync.Mutex
	snap   derive.Snapshot
	snapAt time.Time
	clock  func() time.Time
}

// NewLocal builds the filesystem-backed source.
func NewLocal(cfg config.Config, logger *log.Logger) Source {
	return &local{cfg: cfg, l: loader.New(cfg, logger), clock: time.Now}
}

func (s *local) Kind() string { return "local" }

// Home is published by /api/health, so the user's home dir is shown as "~".
func (s *local) Home() string { return config.ShownHome(s.cfg.Home) }

func (s *local) Snapshot(_ context.Context, now time.Time) (derive.Snapshot, error) {
	// Per-profile errors are handled inside the loader: one unreadable state.db
	// never fails the whole snapshot. The counts travel in the payload.
	s.mu.Lock()
	defer s.mu.Unlock()
	t := s.clock()
	if !s.snapAt.IsZero() && t.Sub(s.snapAt) < SnapshotTTL {
		return s.snap, nil
	}
	s.snap = s.l.Snapshot(now)
	s.snapAt = t
	return s.snap, nil
}

// DBStatus opens and closes each profile database so /api/health can tell
// "no desks yet" from "cannot read a single desk".
func (s *local) DBStatus(context.Context) DBStatus {
	h := s.l.Probe()
	return DBStatus{Available: true, Checked: h.Checked, OK: h.OK, Err: h.Err, Failed: h.Failed}
}

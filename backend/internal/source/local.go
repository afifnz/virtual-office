package source

import (
	"context"
	"fmt"
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

// KPITTL is how long one window's report is reused. A KPI spans 7 or 30 days
// and is polled far less often than /api/status, so a minute of staleness buys
// a lot: a full re-read of every state.db per viewer is otherwise wasteful.
const KPITTL = 60 * time.Second

type kpiEntry struct {
	rep derive.KPIReport
	at  time.Time
}

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

	// kpiMu guards the per-window report cache (60 s).
	kpiMu sync.Mutex
	kpi   map[string]kpiEntry
}

// NewLocal builds the filesystem-backed source.
func NewLocal(cfg config.Config, logger *log.Logger) Source {
	return &local{cfg: cfg, l: loader.New(cfg, logger), clock: time.Now, kpi: map[string]kpiEntry{}}
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

// KPI aggregates one window, reusing a report for 60 s. Invalid windows are
// rejected here too, so a caller of the interface cannot smuggle "90d" in.
func (s *local) KPI(_ context.Context, window string) (derive.KPIReport, error) {
	if _, ok := derive.ParseKPIWindow(window); !ok {
		return derive.KPIReport{}, fmt.Errorf("window=%q tidak dikenal (pakai 7d atau 30d)", window)
	}
	s.kpiMu.Lock()
	defer s.kpiMu.Unlock()
	now := s.clock()
	if e, ok := s.kpi[window]; ok && now.Sub(e.at) < KPITTL {
		return e.rep, nil
	}
	rep := s.l.KPI(window, now)
	if s.kpi == nil {
		s.kpi = map[string]kpiEntry{}
	}
	s.kpi[window] = kpiEntry{rep: rep, at: now}
	return rep, nil
}

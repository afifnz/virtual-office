// Package loader assembles a full office snapshot from disk.
package loader

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"officeapi/internal/config"
	"officeapi/internal/derive"
	"officeapi/internal/store"
)

// MessageWindow caps how many messages per profile are read. It is deliberately
// generous: the office only needs the newest transcript slice plus today's
// counters, and this keeps a 200 MB state.db cheap to poll every 4 s.
const MessageWindow = 12000

// Loader reads the Hermes home on demand.
type Loader struct {
	cfg config.Config
	log *log.Logger
	loc *time.Location
	mu  sync.Mutex
}

// New builds a Loader.
func New(cfg config.Config, logger *log.Logger) *Loader {
	loc, err := config.LocationOf(cfg.TZ)
	if err != nil {
		if logger != nil {
			logger.Printf("warn tz=%q tidak dikenal, pakai %s", cfg.TZ, config.DefaultTZ)
		}
		loc, _ = config.LocationOf(config.DefaultTZ)
	}
	return &Loader{cfg: cfg, log: logger, loc: loc}
}

// DBHealth is the outcome of probing every profile database.
type DBHealth struct {
	// Checked is how many state.db files exist on disk (0 = nothing to read).
	Checked int
	// OK is how many of them opened.
	OK int
	// Err is how many failed to open.
	Err int
	// Failed lists the profile ids that could not be opened (never a full path).
	Failed []string
}

// Degraded reports the one case that must not look like a healthy empty office:
// databases exist, and not a single one could be opened.
func (h DBHealth) Degraded() bool { return h.Checked > 0 && h.OK == 0 }

// Probe opens and closes every profile database without reading rows. It is
// cheap enough for /api/health, which the Docker HEALTHCHECK polls every 30 s.
func (l *Loader) Probe() DBHealth {
	var h DBHealth
	for _, p := range l.cfg.Profiles {
		path := store.DefaultProfileDB(l.cfg.Home, p)
		if !store.HasDB(path) {
			continue
		}
		h.Checked++
		db, err := store.Open(path)
		if err != nil {
			h.Err++
			h.Failed = append(h.Failed, p)
			continue
		}
		db.Close()
		h.OK++
	}
	return h
}

// loaded is the outcome of reading every profile DB once.
type loaded struct {
	datasets []derive.ProfileData
	ok, bad  int
	failed   []string
	capped   bool
	tokenCol bool
}

// readAll opens each profile DB and reads its sessions plus messages at or
// after since (0 = all recent messages up to limit). A per-profile failure
// never aborts the rest: it is counted and named so the payload can say which
// desk is unreadable.
func (l *Loader) readAll(since float64, limit int) loaded {
	var out loaded
	for _, p := range l.cfg.Profiles {
		path := store.DefaultProfileDB(l.cfg.Home, p)
		if !store.HasDB(path) {
			continue
		}
		db, err := store.Open(path)
		if err != nil {
			out.bad++
			out.failed = append(out.failed, p)
			l.log.Printf("warn profile=%s db_open_failed=%q", p, err.Error())
			continue
		}
		sessions, err := db.Sessions()
		if err != nil {
			out.bad++
			out.failed = append(out.failed, p)
			db.Close()
			l.log.Printf("warn profile=%s sessions_failed=%q", p, err.Error())
			continue
		}
		if db.HasTokens() {
			out.tokenCol = true
		}
		var msgs []store.Msg
		if since > 0 {
			msgs, err = db.MessagesSince(since, limit)
		} else {
			msgs, err = db.Messages(limit)
		}
		if err != nil {
			out.bad++
			out.failed = append(out.failed, p)
			db.Close()
			l.log.Printf("warn profile=%s messages_failed=%q", p, err.Error())
			continue
		}
		if limit > 0 && len(msgs) >= limit {
			out.capped = true
		}
		db.Close()
		out.datasets = append(out.datasets, derive.ProfileData{Name: p, Sessions: sessions, Msgs: msgs})
		out.ok++
	}
	return out
}

// Snapshot loads every profile DB and derives the payload. Errors are per
// profile: one unreadable DB must not take the office down. The counts are
// carried into the payload so a client can see a broken DB.
func (l *Loader) Snapshot(now time.Time) derive.Snapshot {
	l.mu.Lock()
	defer l.mu.Unlock()

	r := l.readAll(0, MessageWindow)
	nowF := float64(now.UnixNano()) / 1e9
	snap := derive.Build(derive.Dataset{
		ProfileNames: l.cfg.Profiles,
		Profiles:     r.datasets,
		Gateway:      l.gateway(),
		Now:          nowF,
		Location:     l.loc,

		DBsChecked: r.ok + r.bad,
		DBsOK:      r.ok,
		DBsErr:     r.bad,
		DBsFailed:  r.failed,
	})
	if l.cfg.LogRequests {
		l.log.Printf("info snapshot agents=%d feed=%d tasks=%d comms=%d dbs_ok=%d dbs_err=%d",
			len(snap.Agents), len(snap.Feed), len(snap.Tasks), len(snap.Comms), r.ok, r.bad)
	}
	return snap
}

// KPIHistoryLimit caps rows read per profile for a KPI window. 30 days of heavy
// use can exceed it; the report then says messages_capped=true instead of
// presenting a truncated count as exact.
const KPIHistoryLimit = 50000

// KPI aggregates the requested window (7d or 30d) for every profile. Unlike
// Snapshot it reads only rows inside the window, so a long history stays cheap.
func (l *Loader) KPI(window string, now time.Time) derive.KPIReport {
	days, ok := derive.ParseKPIWindow(window)
	if !ok {
		days = 7
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	nowF := float64(now.UnixNano()) / 1e9
	from := nowF - float64(days)*86400
	r := l.readAll(from, KPIHistoryLimit)
	report := derive.BuildKPI(derive.Dataset{
		ProfileNames: l.cfg.Profiles,
		Profiles:     r.datasets,
		Gateway:      l.gateway(),
		Now:          nowF,
		Location:     l.loc,

		DBsChecked:     r.ok + r.bad,
		DBsOK:          r.ok,
		DBsErr:         r.bad,
		DBsFailed:      r.failed,
		MessagesCapped: r.capped,
		TokenColumn:    r.tokenCol,
	}, days)
	if l.cfg.LogRequests {
		l.log.Printf("info kpi window=%s agents=%d messages=%d dbs_ok=%d dbs_err=%d capped=%v",
			report.Window, len(report.Agents), report.Totals.Messages, r.ok, r.bad, r.capped)
	}
	return report
}

// gateway reads gateway_state.json tolerantly.
func (l *Loader) gateway() derive.Gateway {
	raw, err := os.ReadFile(l.cfg.GatewayPath)
	if err != nil {
		return derive.Gateway{State: "unknown"}
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return derive.Gateway{State: "unknown"}
	}
	g := derive.Gateway{State: "unknown"}
	// The file may be flat or wrap its payload in an object; collect the top-level
	// keys so an unexpected shape is diagnosable from /api/status alone.
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	g.Keys = keys
	g.Source = "gateway_state.json"

	payload := m
	for _, wrapper := range []string{"gateway", "daemon", "state", "gateway_state"} {
		if sub, ok := m[wrapper].(map[string]any); ok {
			payload = sub
			g.Source = "gateway_state.json." + wrapper
			break
		}
	}

	for _, k := range []string{"state", "status", "gateway_state", "lifecycle", "health"} {
		if v, ok := payload[k].(string); ok && v != "" {
			g.State = v
			break
		}
		if v, ok := payload[k].(bool); ok {
			if v {
				g.State = "running"
			} else {
				g.State = "stopped"
			}
			break
		}
	}
	for _, k := range []string{"version", "code_version", "hermes_version", "app_version", "gateway_version"} {
		if v, ok := payload[k].(string); ok && v != "" {
			g.Version = v
			break
		}
	}
	for _, k := range []string{"updated_at", "ts", "time", "started_at"} {
		switch v := payload[k].(type) {
		case string:
			g.UpdatedAt = v
		case float64:
			g.UpdatedAt = time.Unix(int64(store.ParseTime(v)), 0).UTC().Format(time.RFC3339)
		}
		if g.UpdatedAt != "" {
			break
		}
	}
	if g.UpdatedAt == "" {
		if st, err := os.Stat(l.cfg.GatewayPath); err == nil {
			g.UpdatedAt = st.ModTime().UTC().Format(time.RFC3339)
		}
	}
	return g
}

// Home describes where the loader is reading from (used by /api/health).
func (l *Loader) Home() string { return filepath.Clean(l.cfg.Home) }

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

// Snapshot loads every profile DB and derives the payload. Errors are per
// profile: one unreadable DB must not take the office down.
func (l *Loader) Snapshot(now time.Time) derive.Snapshot {
	l.mu.Lock()
	defer l.mu.Unlock()

	datasets := make([]derive.ProfileData, 0, len(l.cfg.Profiles))
	ok, bad := 0, 0
	for _, p := range l.cfg.Profiles {
		path := store.DefaultProfileDB(l.cfg.Home, p)
		if !store.HasDB(path) {
			continue
		}
		db, err := store.Open(path)
		if err != nil {
			bad++
			l.log.Printf("warn profile=%s db_open_failed=%q", p, err.Error())
			continue
		}
		sessions, err := db.Sessions()
		if err != nil {
			bad++
			db.Close()
			l.log.Printf("warn profile=%s sessions_failed=%q", p, err.Error())
			continue
		}
		msgs, err := db.Messages(MessageWindow)
		if err != nil {
			bad++
			db.Close()
			l.log.Printf("warn profile=%s messages_failed=%q", p, err.Error())
			continue
		}
		db.Close()
		datasets = append(datasets, derive.ProfileData{Name: p, Sessions: sessions, Msgs: msgs})
		ok++
	}

	nowF := float64(now.UnixNano()) / 1e9
	snap := derive.Build(derive.Dataset{
		ProfileNames: l.cfg.Profiles,
		Profiles:     datasets,
		Gateway:      l.gateway(),
		Now:          nowF,
		Location:     l.loc,
	})
	l.log.Printf("info snapshot agents=%d feed=%d tasks=%d comms=%d dbs_ok=%d dbs_err=%d",
		len(snap.Agents), len(snap.Feed), len(snap.Tasks), len(snap.Comms), ok, bad)
	return snap
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

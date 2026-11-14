// Package fixture builds temporary Hermes state.db files for tests.
//
// The real ~/.hermes/state.db is not available in CI/sandbox, so every test
// seeds its own SQLite file with the documented schema and a controllable clock.
package fixture

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

// Home is a throwaway HERMES_HOME.
type Home struct {
	Dir string
	t   *testing.T
}

// New creates the home directory.
func New(t *testing.T) *Home {
	t.Helper()
	return &Home{Dir: t.TempDir(), t: t}
}

// Path returns the state.db path for a profile.
func (h *Home) Path(profile string) string {
	if profile == "" || profile == "default" {
		return filepath.Join(h.Dir, "state.db")
	}
	return filepath.Join(h.Dir, "profiles", profile, "state.db")
}

// Profile creates a state.db (with the documented schema) and returns a writer.
func (h *Home) Profile(name string) *Writer {
	h.t.Helper()
	path := h.Path(name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		h.t.Fatalf("mkdir: %v", err)
	}
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		h.t.Fatalf("open: %v", err)
	}
	db.SetMaxOpenConns(1)
	stmts := []string{
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			profile_name TEXT,
			source TEXT,
			parent_session_id TEXT,
			started_at REAL,
			updated_at REAL,
			ended_at REAL,
			end_reason TEXT,
			model_config TEXT
		)`,
		`CREATE TABLE messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT,
			role TEXT,
			content TEXT,
			tool_name TEXT,
			tool_calls TEXT,
			created_at REAL,
			tokens INTEGER
		)`,
	}
	for _, q := range stmts {
		if _, err := db.Exec(q); err != nil {
			h.t.Fatalf("schema: %v", err)
		}
	}
	return &Writer{db: db, t: h.t}
}

// Writer seeds rows.
type Writer struct {
	db *sql.DB
	t  *testing.T
}

// Close flushes to disk.
func (w *Writer) Close() { w.db.Close() }

// Session inserts a session row.
func (w *Writer) Session(s Session) {
	w.t.Helper()
	var ended any
	var endReason any
	var model any
	if s.Ended > 0 {
		ended = s.Ended
	}
	if s.EndReason != "" {
		endReason = s.EndReason
	}
	if s.ModelConfig != "" {
		model = s.ModelConfig
	}
	var parent any
	if s.ParentID != "" {
		parent = s.ParentID
	}
	_, err := w.db.Exec(`INSERT INTO sessions
		(id, profile_name, source, parent_session_id, started_at, updated_at, ended_at, end_reason, model_config)
		VALUES (?,?,?,?,?,?,?,?,?)`,
		s.ID, s.Profile, s.Source, parent, s.Started, s.Updated, ended, endReason, model)
	if err != nil {
		w.t.Fatalf("insert session %s: %v", s.ID, err)
	}
}

// Msg inserts a message row.
func (w *Writer) Msg(m Msg) {
	w.t.Helper()
	var tool any
	var calls any
	if m.Tool != "" {
		tool = m.Tool
	}
	if len(m.Calls) > 0 {
		b, _ := json.Marshal(m.Calls)
		calls = string(b)
	}
	_, err := w.db.Exec(`INSERT INTO messages
		(session_id, role, content, tool_name, tool_calls, created_at, tokens)
		VALUES (?,?,?,?,?,?,?)`,
		m.Session, m.Role, m.Content, tool, calls, m.TS, m.Tokens)
	if err != nil {
		w.t.Fatalf("insert msg: %v", err)
	}
}

// Session is a seeded session.
type Session struct {
	ID, Profile, Source, ParentID, EndReason, ModelConfig string
	Started, Updated, Ended                               float64
}

// Msg is a seeded message. Calls is a slice of tool-call maps.
type Msg struct {
	Session string
	Role    string
	Content string
	Tool    string
	Calls   []map[string]any
	TS      float64
	Tokens  int
}

// Garbage writes a non-SQLite file at a profile's DB path, to exercise the
// "one corrupt profile must not kill the endpoint" path.
func (h *Home) Garbage(profile string) error {
	path := h.Path(profile)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte("this is not a sqlite database, honestly"), 0o644)
}

// Gateway writes gateway_state.json.
func (h *Home) Gateway(state, version string, updatedISO string) {
	h.t.Helper()
	raw, _ := json.Marshal(map[string]string{
		"state": state, "version": version, "updated_at": updatedISO,
	})
	if err := os.WriteFile(filepath.Join(h.Dir, "gateway_state.json"), raw, 0o644); err != nil {
		h.t.Fatalf("gateway: %v", err)
	}
}

// ToolCall builds a tool_calls entry in Hermes' stored shape.
func ToolCall(name string, args map[string]any) map[string]any {
	return map[string]any{
		"id":       "call_" + name,
		"type":     "function",
		"function": map[string]any{"name": name, "arguments": mustJSON(args)},
	}
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

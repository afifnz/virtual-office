// Package store reads a Hermes state.db (SQLite) read-only.
//
// Hermes' schema has drifted across releases, so nothing here is hard-coded to
// one column name: tables and columns are discovered at run time and matched
// against candidate lists. That keeps the API working when a column is renamed
// (created_at -> ts) or a table is singular (session vs sessions).
package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Session is one Hermes chat session (one "task" in office vocabulary).
type Session struct {
	ID          string
	Profile     string
	Source      string
	ParentID    string
	EndReason   string
	ModelConfig string
	Started     float64
	Updated     float64
	Ended       float64
	HasEnded    bool
}

// Msg is a single message row, trimmed to metadata (+ a content prefix used
// only for local classification; it is never emitted by the API).
type Msg struct {
	RowID     int64
	SessionID string
	Role      string
	ToolName  string
	Tools     []string
	Calls     string
	Content   string
	TS        float64
	Tokens    int
}

// DB is an open read-only handle to one profile's state.db.
type DB struct {
	Path       string
	db         *sql.DB
	hasSession bool
	hasMessage bool
	sTable     string
	mTable     string
	sCols      map[string]bool
	mCols      map[string]bool
	// resolved column names ("" when absent)
	c struct {
		sID, sProfile, sSource, sParent, sEnd, sModel, sStart, sUpdated, sEnded string
		mID, mSession, mRole, mTool, mCalls, mContent, mTS, mTokens             string
	}
}

// Open opens path read-only. A missing file is not an error: callers skip it.
func Open(path string) (*DB, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, err
	}
	dsn := "file:" + path + "?mode=ro&_pragma=query_only(1)&_pragma=busy_timeout(2000)"
	sqldb, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	sqldb.SetMaxOpenConns(2)
	d := &DB{Path: path, db: sqldb}
	if err := d.introspect(); err != nil {
		sqldb.Close()
		return nil, err
	}
	return d, nil
}

// Close releases the handle.
func (d *DB) Close() error { return d.db.Close() }

func (d *DB) introspect() error {
	tables := map[string]bool{}
	rows, err := d.db.Query(`SELECT name FROM sqlite_master WHERE type='table'`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err == nil {
			tables[strings.ToLower(n)] = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	pickTable := func(cands ...string) string {
		for _, c := range cands {
			if tables[strings.ToLower(c)] {
				return strings.ToLower(c)
			}
		}
		return ""
	}
	st := pickTable("sessions", "session")
	mt := pickTable("messages", "message", "chat_messages")
	if st == "" && mt == "" {
		return fmt.Errorf("no sessions/messages table in %s", d.Path)
	}
	d.hasSession, d.hasMessage = st != "", mt != ""
	d.sTable, d.mTable = st, mt

	if st != "" {
		cols, err := d.columns(st)
		if err != nil {
			return err
		}
		d.sCols = cols
		d.c.sID = pick(cols, "id", "session_id", "sid")
		d.c.sProfile = pick(cols, "profile_name", "profile", "agent", "agent_id")
		d.c.sSource = pick(cols, "source", "platform", "origin")
		d.c.sParent = pick(cols, "parent_session_id", "parent_id", "parent")
		d.c.sEnd = pick(cols, "end_reason", "ended_reason", "status_reason", "close_reason")
		d.c.sModel = pick(cols, "model_config", "model_cfg", "meta", "metadata")
		d.c.sStart = pick(cols, "started_at", "created_at", "start_time", "timestamp", "ts", "time")
		d.c.sUpdated = pick(cols, "updated_at", "last_active", "last_message_at", "modified_at", "ts", "time")
		d.c.sEnded = pick(cols, "ended_at", "finished_at", "closed_at", "end_time")
	}
	if mt != "" {
		cols, err := d.columns(mt)
		if err != nil {
			return err
		}
		d.mCols = cols
		d.c.mID = pick(cols, "id", "rowid")
		d.c.mSession = pick(cols, "session_id", "session", "sid", "sessionId")
		d.c.mRole = pick(cols, "role", "sender", "author")
		d.c.mTool = pick(cols, "tool_name", "tool", "name", "function_name")
		d.c.mCalls = pick(cols, "tool_calls", "tools", "calls")
		d.c.mContent = pick(cols, "content", "text", "body", "message")
		d.c.mTS = pick(cols, "created_at", "timestamp", "ts", "time", "sent_at", "at")
		d.c.mTokens = pick(cols, "tokens", "token_count", "total_tokens", "n_tokens")
	}
	return nil
}

func (d *DB) columns(table string) (map[string]bool, error) {
	rows, err := d.db.Query(`SELECT name FROM pragma_table_info(?)`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err == nil {
			out[strings.ToLower(n)] = true
		}
	}
	return out, rows.Err()
}

func pick(cols map[string]bool, cands ...string) string {
	for _, c := range cands {
		if cols[c] {
			return c
		}
	}
	return ""
}

// Sessions reads every session row.
func (d *DB) Sessions() ([]Session, error) {
	if !d.hasSession || d.c.sID == "" {
		return nil, nil
	}
	sel := []string{d.c.sID}
	add := func(col string) string {
		if col == "" {
			return "NULL"
		}
		return col
	}
	sel = append(sel, add(d.c.sProfile), add(d.c.sSource), add(d.c.sParent),
		add(d.c.sEnd), add(d.c.sModel), add(d.c.sStart), add(d.c.sUpdated), add(d.c.sEnded))

	q := "SELECT " + strings.Join(sel, ",") + " FROM " + d.sTable
	rows, err := d.db.Query(q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Session
	for rows.Next() {
		var id, profile, source, parent, endReason, model sql.NullString
		var start, updated, ended any
		if err := rows.Scan(&id, &profile, &source, &parent, &endReason, &model, &start, &updated, &ended); err != nil {
			return nil, err
		}
		s := Session{
			ID:          strings.TrimSpace(id.String),
			Profile:     strings.TrimSpace(profile.String),
			Source:      strings.ToLower(strings.TrimSpace(source.String)),
			ParentID:    strings.TrimSpace(parent.String),
			EndReason:   strings.TrimSpace(endReason.String),
			ModelConfig: model.String,
			Started:     ParseTime(start),
			Updated:     ParseTime(updated),
			Ended:       ParseTime(ended),
		}
		s.HasEnded = ended != nil && s.Ended > 0
		if s.ID == "" {
			continue
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// Messages reads message metadata, newest last. content is truncated so a huge
// transcript cannot blow up memory; only its first bytes matter for classifying
// delegation results and tool errors.
func (d *DB) Messages(limit int) ([]Msg, error) {
	if !d.hasMessage || d.c.mSession == "" {
		return nil, nil
	}
	sel := []string{d.c.mSession, orNull(d.c.mRole), orNull(d.c.mTool), orNull(d.c.mCalls)}
	content := "NULL"
	switch {
	case d.c.mContent == "text":
		content = "substr(text,1,600)"
	case d.c.mContent != "":
		content = "substr(" + d.c.mContent + ",1,600)"
	}
	sel = append(sel, content, orNull(d.c.mTS), orNull(d.c.mTokens))
	if d.c.mID != "" {
		sel = append([]string{d.c.mID}, sel...)
	}

	q := "SELECT " + strings.Join(sel, ",") + " FROM " + d.mTable
	if d.c.mTS != "" {
		q += " ORDER BY " + d.c.mTS + " DESC, rowid DESC"
	} else {
		q += " ORDER BY rowid DESC"
	}
	if limit > 0 {
		q += " LIMIT " + strconv.Itoa(limit)
	}

	rows, err := d.db.Query(q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Msg
	for rows.Next() {
		var (
			rowID          int64
			sess           sql.NullString
			role, tool     sql.NullString
			calls, content sql.NullString
			ts             any
			tokens         sql.NullInt64
		)
		dest := []any{}
		if d.c.mID != "" {
			dest = append(dest, &rowID)
		}
		dest = append(dest, &sess, &role, &tool, &calls, &content, &ts, &tokens)
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		m := Msg{
			RowID:     rowID,
			SessionID: sess.String,
			Role:      strings.ToLower(strings.TrimSpace(role.String)),
			ToolName:  strings.TrimSpace(tool.String),
			Content:   content.String,
			TS:        ParseTime(ts),
			Tokens:    int(tokens.Int64),
		}
		m.Tools = ParseToolNames(m.ToolName, calls.String)
		m.Calls = calls.String
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Queried newest-first for the LIMIT; hand back oldest-first.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].TS == out[j].TS {
			return out[i].RowID < out[j].RowID
		}
		return out[i].TS < out[j].TS
	})
	return out, nil
}

func orNull(col string) string {
	if col == "" {
		return "NULL"
	}
	return col
}

// ParseTime accepts unix seconds (float/int), milliseconds, or ISO-8601 text.
func ParseTime(v any) float64 {
	switch t := v.(type) {
	case nil:
		return 0
	case float64:
		return normEpoch(t)
	case int64:
		return normEpoch(float64(t))
	case int:
		return normEpoch(float64(t))
	case []byte:
		return parseTimeString(string(t))
	case string:
		return parseTimeString(t)
	default:
		return 0
	}
}

func parseTimeString(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return normEpoch(f)
	}
	layouts := []string{
		time.RFC3339Nano, time.RFC3339,
		"2006-01-02 15:04:05.999999-07:00",
		"2006-01-02 15:04:05.999999",
		"2006-01-02T15:04:05.999999",
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05",
	}
	for _, l := range layouts {
		if ts, err := time.Parse(l, s); err == nil {
			return float64(ts.UnixNano()) / 1e9
		}
	}
	return 0
}

// normEpoch converts millisecond / microsecond epochs to seconds.
func normEpoch(f float64) float64 {
	switch {
	case f <= 0:
		return 0
	case f > 1e17: // nanoseconds
		return f / 1e9
	case f > 1e14: // microseconds
		return f / 1e6
	case f > 1e11: // milliseconds
		return f / 1e3
	default:
		return f
	}
}

// ParseToolNames normalises the many shapes a tool call is stored in:
// a `tool_name` column, or JSON like {"name":"terminal"}, [{"name":"x"}],
// {"function":{"name":"x"}}, or {"tool_calls":[...]}.
func ParseToolNames(toolName, raw string) []string {
	var out []string
	seen := map[string]bool{}
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			return
		}
		seen[s] = true
		out = append(out, s)
	}
	add(toolName)
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" || raw == "[]" {
		return out
	}
	var anyv any
	if err := json.Unmarshal([]byte(raw), &anyv); err != nil {
		return out
	}
	walkToolNames(anyv, add, 0)
	return out
}

func walkToolNames(v any, add func(string), depth int) {
	if depth > 6 {
		return
	}
	switch t := v.(type) {
	case string:
		add(t)
	case []any:
		for _, e := range t {
			walkToolNames(e, add, depth+1)
		}
	case map[string]any:
		for _, k := range []string{"name", "tool", "tool_name", "function_name"} {
			if s, ok := t[k].(string); ok {
				add(s)
			}
		}
		if fn, ok := t["function"].(map[string]any); ok {
			if s, ok := fn["name"].(string); ok {
				add(s)
			}
		}
		for _, k := range []string{"tool_calls", "tools", "calls"} {
			if inner, ok := t[k]; ok {
				walkToolNames(inner, add, depth+1)
			}
		}
	}
}

// ToolArgs returns the raw arguments JSON of the named tool call, if present.
func ToolArgs(toolName, raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var anyv any
	if err := json.Unmarshal([]byte(raw), &anyv); err != nil {
		return nil
	}
	var out []string
	var walk func(v any, d int)
	walk = func(v any, d int) {
		if d > 6 {
			return
		}
		switch t := v.(type) {
		case []any:
			for _, e := range t {
				walk(e, d+1)
			}
		case map[string]any:
			name := ""
			for _, k := range []string{"name", "tool", "tool_name"} {
				if s, ok := t[k].(string); ok && name == "" {
					name = s
				}
			}
			if fn, ok := t["function"].(map[string]any); ok {
				if s, ok := fn["name"].(string); ok {
					name = s
				}
			}
			if name == toolName {
				collectArgs(t, &out)
			}
			if fn, ok := t["function"].(map[string]any); ok {
				fnName, _ := fn["name"].(string)
				if fnName == "" || fnName == toolName {
					collectArgs(fn, &out)
				}
			}
		}
	}
	walk(anyv, 0)
	return out
}

// collectArgs appends the argument payload of a call node as JSON text.
func collectArgs(node map[string]any, out *[]string) {
	for _, k := range []string{"arguments", "args", "input"} {
		switch v := node[k].(type) {
		case string:
			if strings.TrimSpace(v) != "" {
				*out = append(*out, v)
			}
		case map[string]any, []any:
			if b, err := json.Marshal(v); err == nil {
				*out = append(*out, string(b))
			}
		}
	}
}

// HasDB reports whether a state.db file exists.
func HasDB(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

// DefaultProfileDB returns the DB path for a profile under a Hermes home.
func DefaultProfileDB(home, profile string) string {
	if profile == "" || profile == "default" {
		return filepath.Join(home, "state.db")
	}
	return filepath.Join(home, "profiles", profile, "state.db")
}

// SanitizeToken strips anything that could forge a log line.
func SanitizeToken(s string) string {
	if len(s) > 80 {
		s = s[:80]
	}
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '	' {
			return -1
		}
		return r
	}, s)
}

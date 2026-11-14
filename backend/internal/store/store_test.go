package store

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestParseTimeAcceptsEpochAndISO(t *testing.T) {
	cases := []struct {
		in   any
		want float64
	}{
		{1794667338.04, 1794667338.04},
		{int64(1794667338), 1794667338},
		{"1794667338.5", 1794667338.5},
		{"2026-11-14T14:42:14Z", 1794667334},
		{"2026-11-14 14:42:14", 1794667334},
		{1794667338040.0, 1794667338.04},    // millis
		{1794667338040000.0, 1794667338.04}, // micros
		{"", 0},
		{nil, 0},
	}
	for _, c := range cases {
		got := ParseTime(c.in)
		if diff := got - c.want; diff > 0.01 || diff < -0.01 {
			t.Errorf("ParseTime(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestParseToolNamesShapes(t *testing.T) {
	cases := []struct {
		tool, raw string
		want      []string
	}{
		{"terminal", "", []string{"terminal"}},
		{"", `{"name":"read_file"}`, []string{"read_file"}},
		{"", `[{"name":"a"},{"name":"b"}]`, []string{"a", "b"}},
		{"", `{"function":{"name":"write_file"}}`, []string{"write_file"}},
		{"", `{"tool_calls":[{"name":"delegate_task"}]}`, []string{"delegate_task"}},
		{"delegate_task", `[{"function":{"name":"delegate_task"}}]`, []string{"delegate_task"}},
		{"", `not json`, nil},
	}
	for _, c := range cases {
		got := ParseToolNames(c.tool, c.raw)
		if len(got) != len(c.want) {
			t.Errorf("ParseToolNames(%q,%q) = %v, want %v", c.tool, c.raw, got, c.want)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("ParseToolNames(%q,%q) = %v, want %v", c.tool, c.raw, got, c.want)
			}
		}
	}
}

func TestToolArgsExtractsDelegateProfile(t *testing.T) {
	raw := `[{"id":"c1","type":"function","function":{"name":"delegate_task","arguments":"{\"tasks\":[{\"goal\":\"x\",\"profile\":\"dev\"}]}"}}]`
	args := ToolArgs("delegate_task", raw)
	if len(args) != 1 {
		t.Fatalf("args = %v", args)
	}
	var payload struct {
		Tasks []struct {
			Profile string `json:"profile"`
		} `json:"tasks"`
	}
	if err := json.Unmarshal([]byte(args[0]), &payload); err != nil {
		t.Fatalf("arguments are not JSON: %v (%s)", err, args[0])
	}
	if len(payload.Tasks) != 1 || payload.Tasks[0].Profile != "dev" {
		t.Fatalf("payload = %+v", payload)
	}
}

// TestAlternateSchema proves the reader survives renamed tables/columns.
func TestAlternateSchema(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.db")
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	stmts := []string{
		`CREATE TABLE session (session_id TEXT PRIMARY KEY, profile TEXT, platform TEXT, ts REAL, meta TEXT)`,
		`CREATE TABLE message (session TEXT, sender TEXT, tool TEXT, body TEXT, ts REAL)`,
		`INSERT INTO session VALUES ('alt1','dev','telegram', 1794667300, '{}')`,
		`INSERT INTO message VALUES ('alt1','user',NULL,'halo',1794667290)`,
		`INSERT INTO message VALUES ('alt1','tool','terminal','ok',1794667350)`,
	}
	for _, q := range stmts {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	db.Close()

	d, err := Open(path)
	if err != nil {
		t.Fatalf("open alternate schema: %v", err)
	}
	defer d.Close()

	sessions, err := d.Sessions()
	if err != nil || len(sessions) != 1 {
		t.Fatalf("sessions = %+v err = %v", sessions, err)
	}
	if sessions[0].Profile != "dev" || sessions[0].Source != "telegram" {
		t.Fatalf("session = %+v", sessions[0])
	}
	msgs, err := d.Messages(10)
	if err != nil || len(msgs) != 2 {
		t.Fatalf("messages = %+v err = %v", msgs, err)
	}
	if msgs[0].Role != "user" || msgs[1].Role != "tool" || msgs[1].ToolName != "terminal" {
		t.Fatalf("messages = %+v", msgs)
	}
}

func TestOpenMissingFileIsError(t *testing.T) {
	if _, err := Open(filepath.Join(t.TempDir(), "nope.db")); err == nil {
		t.Fatal("want error for missing file")
	}
}

func TestReadOnlyHandleRejectsWrites(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.db")
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, created_at REAL)`); err != nil {
		t.Fatal(err)
	}
	db.Close()

	// make the file read-only on disk too, mirroring the production setup
	if err := os.Chmod(path, 0o444); err != nil {
		t.Fatal(err)
	}
	d, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if _, err := d.Messages(1); err != nil {
		t.Fatalf("read failed on read-only db: %v", err)
	}
}

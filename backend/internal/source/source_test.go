package source

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"officeapi/internal/config"
	"officeapi/internal/fixture"
	"officeapi/internal/roster"
)

func quiet() *log.Logger { return log.New(io.Discard, "", 0) }

func TestNewSelectsLocalByDefault(t *testing.T) {
	src, err := New(config.Config{Home: t.TempDir()}, quiet())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if src.Kind() != "local" {
		t.Fatalf("kind = %q, want local", src.Kind())
	}
	// An empty HOME must not panic: the local source tolerates a missing dir.
	snap, err := src.Snapshot(context.Background(), time.Unix(1800000000, 0))
	if err != nil {
		t.Fatalf("local snapshot: %v", err)
	}
	if snap.Gateway.State == "" {
		t.Fatal("gateway state should be reported even with no files")
	}
}

func TestNewSelectsRemote(t *testing.T) {
	src, err := New(config.Config{Source: "remote", RemoteURL: "https://office.example.com/"}, quiet())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if src.Kind() != "remote" {
		t.Fatalf("kind = %q", src.Kind())
	}
	if src.Home() != "https://office.example.com" {
		t.Fatalf("home = %q", src.Home())
	}
	if _, ok := src.(Upstream); !ok {
		t.Fatal("remote source should implement Upstream")
	}
}

func TestNewRejectsUnknownSource(t *testing.T) {
	if _, err := New(config.Config{Source: "cloud"}, quiet()); err == nil {
		t.Fatal("expected error for unknown source")
	}
}

func TestNewRemoteNeedsURL(t *testing.T) {
	if _, err := New(config.Config{Source: "remote"}, quiet()); err == nil {
		t.Fatal("expected error without REMOTE_API_URL")
	}
	if _, err := NewRemote("nope", quiet()); err == nil {
		t.Fatal("expected error for a relative URL")
	}
}

func TestLocalSnapshotReadsFixture(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("default")
	w.Session(fixture.Session{ID: "s1", Profile: "default", Source: "telegram",
		Started: 1800000000 - 120, Updated: 1800000000 - 2})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "halo", TS: 1800000000 - 120})
	w.Msg(fixture.Msg{Session: "s1", Role: "tool", Tool: "terminal", Content: "ok", TS: 1800000000 - 2})
	w.Close()
	home.Gateway("running", "0.23.1", "2027-01-15T10:00:00+00:00")

	cfg := config.Config{Home: home.Dir, Profiles: []string{"default"}, TZ: "Asia/Jakarta",
		GatewayPath: home.Dir + "/gateway_state.json"}
	src, err := New(cfg, quiet())
	if err != nil {
		t.Fatal(err)
	}
	snap, err := src.Snapshot(context.Background(), time.Unix(1800000000, 0))
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snap.Agents) != 1 || snap.Agents[0].ID != "default" {
		t.Fatalf("agents = %+v", snap.Agents)
	}
	if snap.Agents[0].Status != "working" {
		t.Fatalf("status = %q", snap.Agents[0].Status)
	}
	if snap.Gateway.State != "running" {
		t.Fatalf("gateway = %+v", snap.Gateway)
	}
}

func TestRemoteSnapshot(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		if r.Header.Get("Accept") != "application/json" {
			t.Errorf("Accept = %q", r.Header.Get("Accept"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"now":1800000000,"gateway":{"state":"running","version":"0.24.0"},
			"agents":[{"id":"dev","status":"idle","today":{"hourly":[]}}],"feed":[],"tasks":[],"comms":[]}`)
	}))
	defer srv.Close()

	src, err := NewRemote(srv.URL, quiet())
	if err != nil {
		t.Fatal(err)
	}
	snap, err := src.Snapshot(context.Background(), time.Now())
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if gotPath != "/api/status" {
		t.Fatalf("path = %q", gotPath)
	}
	if snap.Now != 1800000000 || snap.Gateway.State != "running" || len(snap.Agents) != 1 {
		t.Fatalf("snapshot = %+v", snap)
	}
}

func TestRemoteSnapshotErrors(t *testing.T) {
	cases := map[string]http.HandlerFunc{
		"http 500": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "boom", http.StatusInternalServerError)
		},
		"not json": func(w http.ResponseWriter, r *http.Request) {
			_, _ = io.WriteString(w, "<html>nope</html>")
		},
	}
	for name, h := range cases {
		t.Run(name, func(t *testing.T) {
			srv := httptest.NewServer(h)
			defer srv.Close()
			src, err := NewRemote(srv.URL, quiet())
			if err != nil {
				t.Fatal(err)
			}
			if _, err := src.Snapshot(context.Background(), time.Now()); err == nil {
				t.Fatal("expected an error so the API can answer 502")
			}
		})
	}
}

func TestRemoteSnapshotHonoursCancelledContext(t *testing.T) {
	block := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-block:
		case <-r.Context().Done():
		}
	}))
	defer srv.Close()
	defer close(block)

	src, err := NewRemote(srv.URL, quiet())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := src.Snapshot(ctx, time.Now()); err == nil {
		t.Fatal("cancelled context must fail fast")
	}
}

func TestUpstreamConfig(t *testing.T) {
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/config" {
			t.Errorf("path = %q", r.URL.Path)
		}
		hits++
		_ = json.NewEncoder(w).Encode(map[string]any{
			"title":  "Kantor Remote",
			"tz":     "Asia/Jayapura",
			"roster": []map[string]string{{"id": "dev", "name": "Bima", "role": "Lead", "team": "dev"}},
			"teams":  []map[string]string{{"id": "dev", "label": "Ruang Dev Remote"}},
		})
	}))
	defer srv.Close()

	src, err := NewRemote(srv.URL, quiet())
	if err != nil {
		t.Fatal(err)
	}
	up := src.(Upstream)
	doc, err := up.UpstreamConfig(context.Background())
	if err != nil {
		t.Fatalf("UpstreamConfig: %v", err)
	}
	if doc.Title != "Kantor Remote" || doc.TZ != "Asia/Jayapura" {
		t.Fatalf("doc = %+v", doc)
	}
	set := roster.Resolver{Layers: []*roster.Document{doc}}.Resolve()
	if len(set.Entries) != 1 || set.Entries[0].Name != "Bima" {
		t.Fatalf("entries = %+v", set.Entries)
	}
	if set.Teams[0].Label != "Ruang Dev Remote" {
		t.Fatalf("team = %+v", set.Teams)
	}

	// Second call inside the TTL is served from cache.
	if _, err := up.UpstreamConfig(context.Background()); err != nil {
		t.Fatal(err)
	}
	if hits != 1 {
		t.Fatalf("upstream hit %d times, want 1 (cached)", hits)
	}
}

func TestUpstreamConfigError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	src, err := NewRemote(srv.URL, quiet())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := src.(Upstream).UpstreamConfig(context.Background()); err == nil {
		t.Fatal("expected an error")
	}
}

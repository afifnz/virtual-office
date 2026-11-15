package source

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"officeapi/internal/config"
)

// A credential in REMOTE_API_URL must not survive into Home() (published by
// /api/health) or into an error string (returned in the 502 body).
func TestRemoteRedactsCredentials(t *testing.T) {
	src, err := NewRemote("https://user:s3cret@127.0.0.1:1", quiet())
	if err != nil {
		t.Fatalf("NewRemote: %v", err)
	}
	if got := src.Home(); strings.Contains(got, "s3cret") || strings.Contains(got, "user") {
		t.Fatalf("Home() leaked credentials: %q", got)
	}
	if got := src.Home(); got != "https://127.0.0.1:1" {
		t.Fatalf("Home() = %q", got)
	}

	_, err = src.Snapshot(context.Background(), time.Now())
	if err == nil {
		t.Fatal("expected a connection error")
	}
	if strings.Contains(err.Error(), "s3cret") {
		t.Fatalf("error leaked the password: %v", err)
	}

	// A non-200 upstream must not echo the URL either.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusTeapot)
	}))
	defer srv.Close()
	withCreds := strings.Replace(srv.URL, "http://", "http://user:s3cret@", 1)
	src2, err := NewRemote(withCreds, quiet())
	if err != nil {
		t.Fatalf("NewRemote: %v", err)
	}
	_, err = src2.Snapshot(context.Background(), time.Now())
	if err == nil {
		t.Fatal("expected an HTTP error")
	}
	if strings.Contains(err.Error(), "s3cret") {
		t.Fatalf("HTTP error leaked the password: %v", err)
	}
	if !strings.Contains(err.Error(), "HTTP 418") {
		t.Fatalf("error lost the status code: %v", err)
	}
}

// An older upstream has no /api/config. The roster must come from
// /api/status.agents instead of showing an empty office.
func TestUpstreamConfigFallsBackToStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/config":
			http.NotFound(w, r)
		case "/api/status":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"now":    1800000000,
				"agents": []map[string]any{{"id": "dev"}, {"id": "coder"}, {"id": "edu"}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	src, err := NewRemote(srv.URL, quiet())
	if err != nil {
		t.Fatalf("NewRemote: %v", err)
	}
	up, ok := src.(Upstream)
	if !ok {
		t.Fatal("remote source should implement Upstream")
	}
	doc, err := up.UpstreamConfig(context.Background())
	if err != nil {
		t.Fatalf("UpstreamConfig: %v", err)
	}
	if doc == nil || len(doc.Entries()) != 3 {
		t.Fatalf("fallback roster = %+v", doc)
	}
	got := []string{}
	for _, e := range doc.Entries() {
		got = append(got, e.ID)
	}
	if strings.Join(got, ",") != "dev,coder,edu" {
		t.Fatalf("ids = %v", got)
	}
}

// Both /api/config and /api/status down: the caller gets the real error.
func TestUpstreamConfigFailsWhenBothEndpointsDown(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	src, err := NewRemote(srv.URL, quiet())
	if err != nil {
		t.Fatalf("NewRemote: %v", err)
	}
	if _, err := src.(Upstream).UpstreamConfig(context.Background()); err == nil {
		t.Fatal("expected an error when both endpoints fail")
	}
}

// The shared validator is used here too: a non-http scheme never becomes a source.
func TestNewRemoteRejectsBadScheme(t *testing.T) {
	for _, bad := range []string{"ftp://office.example.com", "office.example.com", "file:///etc/passwd"} {
		if _, err := NewRemote(bad, quiet()); err == nil {
			t.Fatalf("%q accepted", bad)
		}
	}
}

// A local source with no databases reports Checked=false, not "healthy".
func TestLocalDBStatusEmpty(t *testing.T) {
	src, err := New(config.Config{Home: t.TempDir()}, quiet())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	h, ok := src.(Health)
	if !ok {
		t.Fatal("local source should implement Health")
	}
	st := h.DBStatus(context.Background())
	if st.Available != true {
		t.Fatalf("local source should always be probeable: %+v", st)
	}
	if st.Checked != 0 {
		t.Fatalf("empty home reported databases: %+v", st)
	}
	if st.Degraded() {
		t.Fatalf("empty home reported as degraded: %+v", st)
	}
}

// corruptHome builds a HERMES_HOME where each named profile has a state.db that
// is not a SQLite file at all.
func corruptHome(t *testing.T, profiles ...string) string {
	t.Helper()
	home := t.TempDir()
	for _, p := range profiles {
		dir := filepath.Join(home, "profiles", p)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "state.db"), []byte("not a database"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return home
}

func TestLocalDBStatusAllCorrupt(t *testing.T) {
	home := corruptHome(t, "dev", "edu")
	src, err := New(config.Config{Home: home, Profiles: []string{"dev", "edu"}}, quiet())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	st := src.(Health).DBStatus(context.Background())
	if st.Checked != 2 || st.Err != 2 || st.OK != 0 {
		t.Fatalf("status = %+v", st)
	}
	if !st.Degraded() {
		t.Fatalf("all-corrupt home must be degraded: %+v", st)
	}
	if len(st.Failed) != 2 {
		t.Fatalf("failed = %v", st.Failed)
	}
}

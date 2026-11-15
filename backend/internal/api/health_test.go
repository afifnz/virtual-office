package api_test

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"officeapi/internal/api"
	"officeapi/internal/config"
	"officeapi/internal/fixture"
	"officeapi/internal/roster"
)

// corruptServer builds an office whose profiles all have unreadable state.db.
func corruptServer(t *testing.T, profiles ...string) *httptest.Server {
	t.Helper()
	home := fixture.New(t)
	for _, p := range profiles {
		if err := home.Garbage(p); err != nil {
			t.Fatal(err)
		}
	}
	return newTestServer(t, home, profiles...)
}

// Every database failed to open: health must say so and answer 503, not "ok".
func TestHealthDegradedWhenAllDBsFail(t *testing.T) {
	srv := corruptServer(t, "dev", "edu")

	resp, body := get(t, srv.URL+"/api/health")
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("code = %d, want 503 (body %v)", resp.StatusCode, body)
	}
	if body["ok"] != false {
		t.Fatalf("ok = %v, want false", body["ok"])
	}
	if body["degraded"] != true {
		t.Fatalf("degraded = %v, want true", body["degraded"])
	}
	if body["dbs_checked"] != 2.0 || body["dbs_err"] != 2.0 || body["dbs_ok"] != 0.0 {
		t.Fatalf("dbs = checked %v err %v ok %v", body["dbs_checked"], body["dbs_err"], body["dbs_ok"])
	}
	failed, _ := body["dbs_failed"].([]any)
	if len(failed) != 2 {
		t.Fatalf("dbs_failed = %v", body["dbs_failed"])
	}
}

// A healthy office reports its database counts and stays 200.
func TestHealthReportsDatabases(t *testing.T) {
	home := fixture.New(t)
	seed(t, home)
	srv := newTestServer(t, home, "default")

	resp, body := get(t, srv.URL+"/api/health")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("code = %d (body %v)", resp.StatusCode, body)
	}
	if body["ok"] != true || body["degraded"] != false {
		t.Fatalf("health = %v", body)
	}
	if body["dbs_checked"] != 1.0 || body["dbs_ok"] != 1.0 || body["dbs_err"] != 0.0 {
		t.Fatalf("dbs = %v/%v/%v", body["dbs_checked"], body["dbs_ok"], body["dbs_err"])
	}
}

// An empty HERMES_HOME is an empty office, not a broken one.
func TestHealthEmptyHomeIsHealthy(t *testing.T) {
	home := fixture.New(t)
	srv := newTestServer(t, home, "default")

	resp, body := get(t, srv.URL+"/api/health")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("code = %d (body %v)", resp.StatusCode, body)
	}
	if body["dbs_checked"] != 0.0 || body["degraded"] != false {
		t.Fatalf("health = %v", body)
	}
}

// /api/status must not hand back an empty room as if it were real data.
func TestStatusDegradedWhenAllDBsFail(t *testing.T) {
	srv := corruptServer(t, "dev", "edu")

	resp, body := get(t, srv.URL+"/api/status")
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("code = %d, want 503 (body %v)", resp.StatusCode, body)
	}
	msg, _ := body["error"].(string)
	if !strings.Contains(msg, "state.db") || !strings.Contains(msg, "dev") {
		t.Fatalf("unhelpful error: %q", msg)
	}
	if body["degraded"] != true {
		t.Fatalf("degraded = %v", body["degraded"])
	}
}

// A healthy snapshot carries the counts, so a client can show partial breakage.
func TestStatusCarriesDatabaseCounts(t *testing.T) {
	home := fixture.New(t)
	seed(t, home)
	if err := home.Garbage("edu"); err != nil {
		t.Fatal(err)
	}
	srv := newTestServer(t, home, "default", "edu")

	resp, body := get(t, srv.URL+"/api/status")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("one bad DB must not fail the endpoint: %d %v", resp.StatusCode, body)
	}
	if body["dbs_checked"] != 2.0 || body["dbs_ok"] != 1.0 || body["dbs_err"] != 1.0 {
		t.Fatalf("dbs = %v/%v/%v", body["dbs_checked"], body["dbs_ok"], body["dbs_err"])
	}
}

// /api/config must never publish the userinfo of REMOTE_API_URL.
func TestConfigRedactsRemoteCredentials(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/config":
			_ = json.NewEncoder(w).Encode(map[string]any{"title": "Pusat", "roster": []any{}})
		default:
			_, _ = io.WriteString(w, `{"now":1,"agents":[],"feed":[],"tasks":[],"comms":[]}`)
		}
	}))
	defer upstream.Close()

	withCreds := strings.Replace(upstream.URL, "http://", "http://user:s3cret@", 1)
	cfg := config.Config{Source: "remote", RemoteURL: withCreds, Title: "Agent Office", TZ: "Asia/Jakarta"}
	logger := log.New(io.Discard, "", 0)
	srv := httptest.NewServer(api.NewServer(cfg, mustSource(t, cfg), roster.Resolver{}, logger).Handler())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/config")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if strings.Contains(string(raw), "s3cret") || strings.Contains(string(raw), "user:") {
		t.Fatalf("/api/config leaked credentials: %s", raw)
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	if body["remote_api_url"] != upstream.URL {
		t.Fatalf("remote_api_url = %v, want %v", body["remote_api_url"], upstream.URL)
	}

	// /api/health publishes Home(); it must be redacted too.
	_, health := get(t, srv.URL+"/api/health")
	if home, _ := health["home"].(string); strings.Contains(home, "s3cret") {
		t.Fatalf("/api/health leaked credentials: %q", home)
	}
}

// The 502 body for a dead upstream must not echo the credential either.
func TestStatusFailureBodyIsRedacted(t *testing.T) {
	cfg := config.Config{
		Source:    "remote",
		RemoteURL: "http://user:s3cret@127.0.0.1:1",
		TZ:        "Asia/Jakarta",
	}
	logger := log.New(io.Discard, "", 0)
	srv := httptest.NewServer(api.NewServer(cfg, mustSource(t, cfg), roster.Resolver{}, logger).Handler())
	defer srv.Close()

	resp, body := get(t, srv.URL+"/api/status")
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("code = %d", resp.StatusCode)
	}
	msg, _ := body["error"].(string)
	if strings.Contains(msg, "s3cret") {
		t.Fatalf("502 body leaked the password: %q", msg)
	}
}

package api_test

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"officeapi/internal/api"
	"officeapi/internal/config"
	"officeapi/internal/fixture"
	"officeapi/internal/roster"
	"officeapi/internal/source"
)

const nowF = 1800000000.0

func newTestServer(t *testing.T, home *fixture.Home, profiles ...string) *httptest.Server {
	t.Helper()
	cfg := config.Config{Home: home.Dir, Port: 8131, Addr: "127.0.0.1",
		Profiles: profiles, GatewayPath: home.Dir + "/gateway_state.json",
		Source: "local", TZ: "Asia/Jakarta", Title: "Agent Office"}
	logger := log.New(io.Discard, "", 0)
	res := roster.Resolver{Profiles: profiles}
	srv := httptest.NewServer(api.NewServer(cfg, source.NewLocal(cfg, logger), res, logger).Handler())
	t.Cleanup(srv.Close)
	return srv
}

func seed(t *testing.T, home *fixture.Home) {
	t.Helper()
	w := home.Profile("default")
	w.Session(fixture.Session{ID: "s1", Profile: "default", Source: "telegram", Started: nowF - 120, Updated: nowF - 2})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "halo", TS: nowF - 120})
	w.Msg(fixture.Msg{Session: "s1", Role: "tool", Tool: "terminal", Content: "ok", TS: nowF - 2})
	w.Close()
	home.Gateway("running", "0.23.1", "2027-01-15T10:00:00+00:00")
}

func get(t *testing.T, url string) (*http.Response, map[string]any) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	var body map[string]any
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&body); err != nil && err != io.EOF {
		t.Fatalf("decode %s: %v", url, err)
	}
	return resp, body
}

func TestStatusEndpoint(t *testing.T) {
	home := fixture.New(t)
	seed(t, home)
	srv := newTestServer(t, home, "default", "dev")

	resp, body := get(t, srv.URL+"/api/status")
	if resp.StatusCode != 200 {
		t.Fatalf("status code = %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("content-type = %q", ct)
	}
	if resp.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("cache-control = %q", resp.Header.Get("Cache-Control"))
	}
	for _, k := range []string{"now", "gateway", "agents", "feed", "tasks", "comms"} {
		if _, ok := body[k]; !ok {
			t.Fatalf("key %q missing from /api/status", k)
		}
	}
	agents, _ := body["agents"].([]any)
	if len(agents) != 2 {
		t.Fatalf("agents = %d, want 2", len(agents))
	}
}

func TestAgentEndpoint(t *testing.T) {
	home := fixture.New(t)
	seed(t, home)
	srv := newTestServer(t, home, "default", "dev")

	resp, body := get(t, srv.URL+"/api/agents/default")
	if resp.StatusCode != 200 {
		t.Fatalf("code = %d", resp.StatusCode)
	}
	if body["id"] != "default" || body["status"] != "working" {
		t.Fatalf("body = %v", body)
	}

	resp, body = get(t, srv.URL+"/api/agents/tidak-ada")
	if resp.StatusCode != 404 {
		t.Fatalf("unknown agent code = %d, want 404", resp.StatusCode)
	}
	if _, ok := body["error"]; !ok {
		t.Fatalf("404 body has no error field: %v", body)
	}
}

func TestHealthEndpoint(t *testing.T) {
	home := fixture.New(t)
	srv := newTestServer(t, home, "default")
	resp, body := get(t, srv.URL+"/api/health")
	if resp.StatusCode != 200 || body["ok"] != true {
		t.Fatalf("code=%d body=%v", resp.StatusCode, body)
	}
	if body["version"] != api.Version {
		t.Fatalf("version = %v", body["version"])
	}
}

func TestUnknownRouteAndMethods(t *testing.T) {
	home := fixture.New(t)
	srv := newTestServer(t, home, "default")

	resp, _ := get(t, srv.URL+"/api/tidakada")
	if resp.StatusCode != 404 {
		t.Fatalf("unknown route = %d", resp.StatusCode)
	}

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/status", nil)
	resp2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("POST /api/status = %d, want 405", resp2.StatusCode)
	}

	req, _ = http.NewRequest(http.MethodOptions, srv.URL+"/api/status", nil)
	resp3, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp3.Body.Close()
	if resp3.StatusCode != http.StatusNoContent {
		t.Fatalf("OPTIONS = %d, want 204", resp3.StatusCode)
	}
}

// A broken DB must not take the endpoint down.
func TestCorruptDatabaseIsSkipped(t *testing.T) {
	home := fixture.New(t)
	seed(t, home)
	if err := home.Garbage("dev"); err != nil {
		t.Fatal(err)
	}
	srv := newTestServer(t, home, "default", "dev")
	resp, body := get(t, srv.URL+"/api/status")
	if resp.StatusCode != 200 {
		t.Fatalf("code = %d, want 200 with a corrupt sibling db", resp.StatusCode)
	}
	agents, _ := body["agents"].([]any)
	if len(agents) != 2 {
		t.Fatalf("agents = %d", len(agents))
	}
	_ = time.Now()
}

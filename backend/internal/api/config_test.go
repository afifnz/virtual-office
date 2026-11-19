package api_test

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"officeapi/internal/api"
	"officeapi/internal/config"
	"officeapi/internal/fixture"
	"officeapi/internal/roster"
	"officeapi/internal/source"
)

func newConfigServer(t *testing.T, cfg config.Config, res roster.Resolver) *httptest.Server {
	t.Helper()
	logger := log.New(io.Discard, "", 0)
	srv := httptest.NewServer(api.NewServer(cfg, source.NewLocal(cfg, logger), res, logger).Handler())
	t.Cleanup(srv.Close)
	return srv
}

func TestConfigEndpoint(t *testing.T) {
	home := fixture.New(t)
	seed(t, home)
	cfg := config.Config{
		Home: home.Dir, Port: 8131, Addr: "127.0.0.1", Source: "local",
		Title: "Kantor Uji", TZ: "Asia/Jakarta",
		GatewayPath: filepath.Join(home.Dir, "gateway_state.json"),
		Profiles:    []string{"default", "dev"},
	}
	doc := &roster.Document{Agents: []roster.Entry{{ID: "dev", Name: "Bima", Role: "Lead Dev"}}}
	srv := newConfigServer(t, cfg, roster.Resolver{Profiles: cfg.Profiles, Layers: []*roster.Document{doc}})

	resp, body := get(t, srv.URL+"/api/config")
	if resp.StatusCode != 200 {
		t.Fatalf("code = %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("content-type = %q", ct)
	}
	for _, k := range []string{"title", "tz", "source", "hermes_home", "profiles", "roster", "layout", "teams"} {
		if _, ok := body[k]; !ok {
			t.Fatalf("key %q missing from /api/config: %v", k, body)
		}
	}
	if body["title"] != "Kantor Uji" || body["tz"] != "Asia/Jakarta" || body["source"] != "local" {
		t.Fatalf("body = %v", body)
	}
	if body["hermes_home"] != home.Dir {
		t.Fatalf("hermes_home = %v, want %s", body["hermes_home"], home.Dir)
	}

	layout, _ := body["layout"].(map[string]any)
	floor, _ := layout["floor"].(map[string]any)
	if floor["w"] != 28.0 || floor["d"] != 20.0 {
		t.Fatalf("floor = %v", floor)
	}

	entries, _ := body["roster"].([]any)
	if len(entries) != 2 {
		t.Fatalf("roster = %v", entries)
	}
	byID := map[string]map[string]any{}
	for _, raw := range entries {
		e, _ := raw.(map[string]any)
		byID[e["id"].(string)] = e
	}
	if byID["dev"]["name"] != "Bima" || byID["dev"]["role"] != "Lead Dev" || byID["dev"]["team"] != "dev" {
		t.Fatalf("dev = %v", byID["dev"])
	}
	// a profile with no override still gets the seed name/role/team
	if byID["default"]["name"] != "Ndoro Kakung" || byID["default"]["role"] != "ASISTEN UTAMA" {
		t.Fatalf("default = %v", byID["default"])
	}
	if byID["default"]["team"] != "lobby" {
		t.Fatalf("default team = %v", byID["default"]["team"])
	}

	teams, _ := body["teams"].([]any)
	if len(teams) != 2 {
		t.Fatalf("teams = %v", teams)
	}
}

// A roster file is enough to relabel the office; no code change, no env name
// per agent.
func TestConfigEndpointReadsRosterFile(t *testing.T) {
	home := fixture.New(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "roster.yaml")
	body := "title: Kantor Afif\ntz: Asia/Makassar\nagents:\n  - id: dev\n    name: Bima\n    role: Lead Dev\n"
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	doc, err := roster.LoadFile(path)
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	cfg := config.Config{Home: home.Dir, Source: "local", Title: "Agent Office", TZ: "Asia/Jakarta",
		Profiles: []string{"dev"}}
	srv := newConfigServer(t, cfg, roster.Resolver{Profiles: cfg.Profiles, Layers: []*roster.Document{doc}})

	_, got := get(t, srv.URL+"/api/config")
	if got["title"] != "Kantor Afif" || got["tz"] != "Asia/Makassar" {
		t.Fatalf("file did not win: %v", got)
	}
	entries, _ := got["roster"].([]any)
	e, _ := entries[0].(map[string]any)
	if e["name"] != "Bima" || e["role"] != "Lead Dev" {
		t.Fatalf("entry = %v", e)
	}
}

// Federation: this office points at another one and inherits its roster.
func TestConfigAndStatusFromRemote(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/config":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"title":  "Kantor Pusat",
				"tz":     "Asia/Jayapura",
				"source": "local",
				"roster": []map[string]string{{"id": "dev", "name": "Bima", "role": "Lead", "team": "dev"}},
				"teams":  []map[string]string{{"id": "dev", "label": "Ruang Dev Pusat"}},
			})
		case "/api/status":
			_, _ = io.WriteString(w, `{"now":1800000000,"gateway":{"state":"running"},
				"agents":[{"id":"dev","status":"working","today":{"hourly":[]}}],"feed":[],"tasks":[],"comms":[]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	cfg := config.Config{Source: "remote", RemoteURL: upstream.URL, Title: "Agent Office", TZ: "Asia/Jakarta"}
	srv := httptest.NewServer(api.NewServer(cfg, mustSource(t, cfg), roster.Resolver{}, log.New(io.Discard, "", 0)).Handler())
	defer srv.Close()

	_, cfgBody := get(t, srv.URL+"/api/config")
	if cfgBody["source"] != "remote" {
		t.Fatalf("source = %v", cfgBody["source"])
	}
	if cfgBody["hermes_home"] != "" {
		t.Fatalf("remote must not advertise a local home: %v", cfgBody["hermes_home"])
	}
	if cfgBody["remote_api_url"] != upstream.URL {
		t.Fatalf("remote_api_url = %v", cfgBody["remote_api_url"])
	}
	if cfgBody["title"] != "Kantor Pusat" || cfgBody["tz"] != "Asia/Jayapura" {
		t.Fatalf("upstream title/tz not inherited: %v", cfgBody)
	}
	entries, _ := cfgBody["roster"].([]any)
	if len(entries) != 1 {
		t.Fatalf("roster = %v", entries)
	}

	resp, status := get(t, srv.URL+"/api/status")
	if resp.StatusCode != 200 {
		t.Fatalf("status code = %d", resp.StatusCode)
	}
	agents, _ := status["agents"].([]any)
	if len(agents) != 1 {
		t.Fatalf("proxied agents = %v", agents)
	}

	// /api/health must report the inherited desks, not 0.
	_, health := get(t, srv.URL+"/api/health")
	if health["profiles"] != 1.0 || health["source"] != "remote" {
		t.Fatalf("health = %v", health)
	}
	if health["home"] != upstream.URL {
		t.Fatalf("health home = %v, want the upstream URL", health["home"])
	}
}

func mustSource(t *testing.T, cfg config.Config) source.Source {
	t.Helper()
	src, err := source.New(cfg, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("source.New: %v", err)
	}
	return src
}

// A dead upstream must answer 502, not an empty room.
func TestStatusRemoteFailure(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer upstream.Close()

	cfg := config.Config{Source: "remote", RemoteURL: upstream.URL}
	srv := httptest.NewServer(api.NewServer(cfg, mustSource(t, cfg), roster.Resolver{}, log.New(io.Discard, "", 0)).Handler())
	defer srv.Close()

	resp, body := get(t, srv.URL+"/api/status")
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("code = %d, want 502", resp.StatusCode)
	}
	if _, ok := body["error"]; !ok {
		t.Fatalf("body = %v", body)
	}
}

func TestConfigRejectsPost(t *testing.T) {
	home := fixture.New(t)
	cfg := config.Config{Home: home.Dir, Source: "local", TZ: "Asia/Jakarta"}
	srv := newConfigServer(t, cfg, roster.Resolver{Profiles: []string{"default"}})
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/config", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("POST /api/config = %d, want 405", resp.StatusCode)
	}
}

func TestStaticServingWhenWebDirSet(t *testing.T) {
	home := fixture.New(t)
	web := t.TempDir()
	if err := os.WriteFile(filepath.Join(web, "index.html"), []byte("<!doctype html><title>office</title>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(web, "app.js"), []byte("console.log(1)"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{Home: home.Dir, Source: "local", TZ: "Asia/Jakarta", WebDir: web}
	srv := newConfigServer(t, cfg, roster.Resolver{Profiles: []string{"default"}})

	for _, path := range []string{"/", "/app.js", "/deep/link?face=dev"} {
		resp, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("GET %s = %d", path, resp.StatusCode)
		}
		if len(body) == 0 {
			t.Fatalf("GET %s returned an empty body", path)
		}
	}

	// API paths must still answer JSON 404, never index.html.
	resp, _ := get(t, srv.URL+"/api/nope")
	if resp.StatusCode != 404 {
		t.Fatalf("/api/nope = %d", resp.StatusCode)
	}
}

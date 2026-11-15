package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"officeapi/internal/roster"
)

// clearEnv unsets every variable this package reads so a test starts from a
// known state regardless of the developer's shell.
func clearEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"HERMES_HOME", "PORT", "BIND", "OFFICE_SOURCE", "REMOTE_API_URL",
		"OFFICE_ROSTER", "OFFICE_ROSTER_JSON", "OFFICE_TITLE", "OFFICE_TZ",
		"PROFILES", "GATEWAY_FILE", "LOG_REQUESTS", "WEB_DIR",
	} {
		t.Setenv(k, "")
		os.Unsetenv(k)
	}
}

func TestLoadDefaults(t *testing.T) {
	clearEnv(t)
	home := t.TempDir()
	t.Setenv("HERMES_HOME", home)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Source != "local" {
		t.Fatalf("source = %q, want local", cfg.Source)
	}
	if cfg.Port != 8131 || cfg.Addr != "127.0.0.1" {
		t.Fatalf("bind = %s:%d", cfg.Addr, cfg.Port)
	}
	if cfg.Home != home {
		t.Fatalf("home = %q, want %q", cfg.Home, home)
	}
	if cfg.TZ != "Asia/Jakarta" || cfg.Title != "Agent Office" {
		t.Fatalf("tz/title = %q/%q", cfg.TZ, cfg.Title)
	}
	if cfg.GatewayPath != filepath.Join(home, "gateway_state.json") {
		t.Fatalf("gateway = %q", cfg.GatewayPath)
	}
	if cfg.ListenAddr() != "127.0.0.1:8131" {
		t.Fatalf("listen = %q", cfg.ListenAddr())
	}
}

// Every documented variable must actually reach the config.
func TestLoadEveryDocumentedEnvVar(t *testing.T) {
	clearEnv(t)
	home := t.TempDir()
	t.Setenv("HERMES_HOME", home)
	t.Setenv("PORT", "9090")
	t.Setenv("BIND", "0.0.0.0")
	t.Setenv("OFFICE_SOURCE", "local")
	t.Setenv("OFFICE_ROSTER", "/tmp/roster.yaml")
	t.Setenv("OFFICE_ROSTER_JSON", `{"agents":[{"id":"dev","name":"Bima"}]}`)
	t.Setenv("OFFICE_TITLE", "Kantor Uji")
	t.Setenv("OFFICE_TZ", "Europe/Amsterdam")
	t.Setenv("GATEWAY_FILE", "/tmp/gateway_state.json")
	t.Setenv("WEB_DIR", "/srv/web")
	t.Setenv("LOG_REQUESTS", "1")
	t.Setenv("PROFILES", "default,dev")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Port != 9090 || cfg.Addr != "0.0.0.0" {
		t.Fatalf("bind = %s:%d", cfg.Addr, cfg.Port)
	}
	if cfg.RosterPath != "/tmp/roster.yaml" {
		t.Fatalf("roster path = %q", cfg.RosterPath)
	}
	if cfg.RosterJSON != `{"agents":[{"id":"dev","name":"Bima"}]}` {
		t.Fatalf("roster json = %q", cfg.RosterJSON)
	}
	if cfg.Title != "Kantor Uji" || cfg.TZ != "Europe/Amsterdam" {
		t.Fatalf("title/tz = %q/%q", cfg.Title, cfg.TZ)
	}
	if cfg.GatewayPath != "/tmp/gateway_state.json" {
		t.Fatalf("gateway = %q", cfg.GatewayPath)
	}
	if cfg.WebDir != "/srv/web" {
		t.Fatalf("web dir = %q", cfg.WebDir)
	}
	if !cfg.LogRequests {
		t.Fatal("LOG_REQUESTS=1 did not reach the config")
	}
	if strings.Join(cfg.Profiles, ",") != "default,dev" {
		t.Fatalf("profiles = %v", cfg.Profiles)
	}
	loc, err := LocationOf(cfg.TZ)
	if err != nil {
		t.Fatalf("LocationOf: %v", err)
	}
	if got := time.Date(2027, 1, 15, 12, 0, 0, 0, loc).Format("MST"); got != "CET" {
		t.Fatalf("zone = %q, want CET (Europe/Amsterdam in winter)", got)
	}
}

func TestRemoteRequiresURL(t *testing.T) {
	clearEnv(t)
	t.Setenv("HERMES_HOME", t.TempDir())
	t.Setenv("OFFICE_SOURCE", "remote")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "REMOTE_API_URL") {
		t.Fatalf("expected REMOTE_API_URL error, got %v", err)
	}
}

func TestRemoteValidatesURL(t *testing.T) {
	clearEnv(t)
	t.Setenv("HERMES_HOME", t.TempDir())
	t.Setenv("OFFICE_SOURCE", "remote")
	t.Setenv("REMOTE_API_URL", "office.example.com")

	if _, err := Load(); err == nil {
		t.Fatal("relative URL must be rejected")
	}
}

// In remote mode the office must not touch this filesystem: no profile
// discovery, and the home directory is irrelevant.
func TestRemoteDoesNotScanDisk(t *testing.T) {
	clearEnv(t)
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, "profiles", "hidden", ""), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "profiles", "hidden", "state.db"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HERMES_HOME", home)
	t.Setenv("OFFICE_SOURCE", "remote")
	t.Setenv("REMOTE_API_URL", "https://office.example.com/")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.Profiles) != 0 {
		t.Fatalf("remote mode discovered %v, want no filesystem scan", cfg.Profiles)
	}
	if cfg.RemoteURL != "https://office.example.com" {
		t.Fatalf("trailing slash not trimmed: %q", cfg.RemoteURL)
	}
	if !cfg.IsRemote() {
		t.Fatal("IsRemote() = false")
	}
}

func TestLocalDiscoversProfiles(t *testing.T) {
	clearEnv(t)
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, "profiles", "zzz-new"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "profiles", "zzz-new", "state.db"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HERMES_HOME", home)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	found := false
	for _, p := range cfg.Profiles {
		if p == "zzz-new" {
			found = true
		}
	}
	if !found {
		t.Fatalf("discovered profile missing from %v", cfg.Profiles)
	}
}

func TestLoadRejectsBadValues(t *testing.T) {
	cases := map[string]map[string]string{
		"unknown source": {"OFFICE_SOURCE": "cloud"},
		"bad port":       {"PORT": "tujuh"},
		"bad tz":         {"OFFICE_TZ": "Mars/Olympus"},
	}
	for name, env := range cases {
		t.Run(name, func(t *testing.T) {
			clearEnv(t)
			t.Setenv("HERMES_HOME", t.TempDir())
			for k, v := range env {
				t.Setenv(k, v)
			}
			if _, err := Load(); err == nil {
				t.Fatalf("%s: expected error", name)
			}
		})
	}
}

func TestBuildPayload(t *testing.T) {
	cfg := Config{
		Home: "/hermes", Port: 8080, Addr: "0.0.0.0",
		Source: "local", Title: "Kantor", TZ: "Asia/Jakarta",
	}
	set := roster.Resolver{Profiles: []string{"default", "dev"}}.Resolve()

	p := Build(cfg, set)
	if p.Title != "Kantor" || p.TZ != "Asia/Jakarta" || p.Source != "local" {
		t.Fatalf("payload = %+v", p)
	}
	if p.HermesHome != "/hermes" || p.RemoteURL != "" {
		t.Fatalf("home/remote = %q/%q", p.HermesHome, p.RemoteURL)
	}
	if p.Layout.Floor.W != 40 || p.Layout.Floor.D != 30 {
		t.Fatalf("floor = %+v", p.Layout.Floor)
	}
	if len(p.Roster) != 2 || len(p.Teams) == 0 || len(p.Profiles) != 2 {
		t.Fatalf("roster/teams/profiles = %v/%v/%v", p.Roster, p.Teams, p.Profiles)
	}
	for _, e := range p.Roster {
		if e.Name == "" || e.Role == "" || e.Team == "" {
			t.Fatalf("incomplete entry %+v", e)
		}
	}
}

func TestBuildPayloadRemoteHidesHome(t *testing.T) {
	cfg := Config{Source: "remote", RemoteURL: "https://office.example.com", Home: "/should-not-leak"}
	p := Build(cfg, roster.Set{})
	if p.HermesHome != "" {
		t.Fatalf("remote payload leaked hermes_home=%q", p.HermesHome)
	}
	if p.RemoteURL != "https://office.example.com" {
		t.Fatalf("remote url = %q", p.RemoteURL)
	}
	if p.Profiles == nil || p.Roster == nil || p.Teams == nil {
		t.Fatalf("empty slices must serialise as [] not null: %+v", p)
	}
	if p.Title != DefaultTitle || p.TZ != DefaultTZ {
		t.Fatalf("defaults not applied: %q/%q", p.Title, p.TZ)
	}
}

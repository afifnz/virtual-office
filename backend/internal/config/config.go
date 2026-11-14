// Package config loads runtime settings from the environment.
package config

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// DefaultProfiles mirrors the office roster. Extra state.db folders found under
// $HERMES_HOME/profiles are appended automatically, so a new profile shows up
// without a config change.
var DefaultProfiles = []string{
	"default", "dev", "planner", "uiux", "coder", "reviewer", "tester",
	"edu", "edu-designer", "edu-writer", "edu-reviewer",
}

// Config is the resolved server configuration.
type Config struct {
	Home        string
	Addr        string
	Port        int
	Profiles    []string
	GatewayPath string
	LogRequests bool
}

// Load reads the environment, applying defaults.
func Load() Config {
	home := os.Getenv("HERMES_HOME")
	if home == "" {
		h, err := os.UserHomeDir()
		if err != nil || h == "" {
			h = "."
		}
		home = filepath.Join(h, ".hermes")
	}
	port := 8131
	if p := os.Getenv("PORT"); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 0 && n < 65536 {
			port = n
		}
	}
	addr := os.Getenv("BIND")
	if addr == "" {
		addr = "127.0.0.1"
	}
	gateway := os.Getenv("GATEWAY_FILE")
	if gateway == "" {
		gateway = filepath.Join(home, "gateway_state.json")
	}
	profiles := DefaultProfiles
	if raw := os.Getenv("PROFILES"); strings.TrimSpace(raw) != "" {
		profiles = nil
		for _, p := range strings.Split(raw, ",") {
			if p = strings.TrimSpace(p); p != "" {
				profiles = append(profiles, p)
			}
		}
	}
	return Config{
		Home:        home,
		Addr:        addr,
		Port:        port,
		Profiles:    withDiscovered(profiles, home),
		GatewayPath: gateway,
		LogRequests: os.Getenv("LOG_REQUESTS") == "1",
	}
}

// withDiscovered appends profile folders that exist on disk but are not listed.
func withDiscovered(base []string, home string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(base)+4)
	for _, p := range base {
		if p == "" || seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	entries, err := os.ReadDir(filepath.Join(home, "profiles"))
	if err != nil {
		return out
	}
	var extra []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		if seen[name] {
			continue
		}
		if _, err := os.Stat(filepath.Join(home, "profiles", name, "state.db")); err != nil {
			continue
		}
		seen[name] = true
		extra = append(extra, name)
	}
	sort.Strings(extra)
	return append(out, extra...)
}

// ListenAddr is the host:port the server binds.
func (c Config) ListenAddr() string {
	return c.Addr + ":" + strconv.Itoa(c.Port)
}

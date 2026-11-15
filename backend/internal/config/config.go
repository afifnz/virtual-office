// Package config loads runtime settings from the environment.
//
// Every value has a default that works on a fresh machine, so the server starts
// with no configuration at all:
//
//	./office-api                       # reads ~/.hermes, serves on 127.0.0.1:8131
//	HERMES_HOME=/hermes BIND=0.0.0.0 PORT=8080 ./office-api
//	OFFICE_SOURCE=remote REMOTE_API_URL=https://office.example.com ./office-api
//
// Nothing is hard-coded to one user's home directory.
package config

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"officeapi/internal/roster"

	// Embed the IANA timezone database so OFFICE_TZ works in a scratch/alpine
	// image that ships no /usr/share/zoneinfo.
	_ "time/tzdata"
)

// DefaultProfiles mirrors the office roster. Extra state.db folders found under
// $HERMES_HOME/profiles are appended automatically, so a new profile shows up
// without a config change. A profile listed here without a state.db still gets
// an offline desk.
var DefaultProfiles = []string{
	"default", "dev", "planner", "uiux", "coder", "reviewer", "tester",
	"edu", "edu-designer", "edu-writer", "edu-reviewer",
}

// Defaults for the plug-and-play surface.
const (
	DefaultSource = "local"
	DefaultTitle  = "Agent Office"
	DefaultTZ     = "Asia/Jakarta"
	DefaultPort   = 8131
	DefaultBind   = "127.0.0.1"
)

// Config is the resolved server configuration.
type Config struct {
	Home        string
	Addr        string
	Port        int
	Profiles    []string
	GatewayPath string
	LogRequests bool

	// Plug and play.
	Source     string // "local" (state.db on disk) or "remote" (another office's API)
	RemoteURL  string // base URL of the remote office, e.g. https://office.example.com
	RosterPath string // optional JSON/YAML roster override
	RosterJSON string // optional inline JSON roster override (wins over the file)
	Title      string // window/document title
	TZ         string // IANA name; the office day boundary and hourly buckets follow it
	WebDir     string // optional directory with the built frontend; "" = API only
}

// Load reads the environment, applying defaults, and validates the result.
func Load() (Config, error) {
	home := os.Getenv("HERMES_HOME")
	if home == "" {
		h, err := os.UserHomeDir()
		if err != nil || h == "" {
			h = "."
		}
		home = filepath.Join(h, ".hermes")
	}
	home = filepath.Clean(home)

	src := strings.ToLower(strings.TrimSpace(os.Getenv("OFFICE_SOURCE")))
	if src == "" {
		src = DefaultSource
	}
	if src != "local" && src != "remote" {
		return Config{}, fmt.Errorf("OFFICE_SOURCE=%q tidak dikenal (pakai local atau remote)", src)
	}

	remote := strings.TrimSpace(os.Getenv("REMOTE_API_URL"))
	if src == "remote" {
		if remote == "" {
			return Config{}, fmt.Errorf("OFFICE_SOURCE=remote butuh REMOTE_API_URL")
		}
		u, err := ValidateBaseURL(remote)
		if err != nil {
			return Config{}, err
		}
		remote = u
	} else {
		// Local mode never opens a socket; an unused REMOTE_API_URL must not
		// stop the office from starting.
		remote = ""
	}

	port := DefaultPort
	if p := strings.TrimSpace(os.Getenv("PORT")); p != "" {
		n, err := strconv.Atoi(p)
		if err != nil || n <= 0 || n > 65535 {
			return Config{}, fmt.Errorf("PORT=%q bukan port yang valid", p)
		}
		port = n
	}

	addr := strings.TrimSpace(os.Getenv("BIND"))
	if addr == "" {
		addr = DefaultBind
	}

	title := strings.TrimSpace(os.Getenv("OFFICE_TITLE"))
	if title == "" {
		title = DefaultTitle
	}

	tz := strings.TrimSpace(os.Getenv("OFFICE_TZ"))
	if tz == "" {
		tz = DefaultTZ
	}
	if _, err := LocationOf(tz); err != nil {
		return Config{}, err
	}

	gateway := os.Getenv("GATEWAY_FILE")
	if gateway == "" {
		gateway = filepath.Join(home, "gateway_state.json")
	}

	var profiles []string
	if src == "remote" {
		// A remote office reports its own roster through /api/config. PROFILES is
		// ignored on purpose: it would name desks that do not exist upstream.
		profiles = nil
	} else {
		profiles = DefaultProfiles
		if raw := strings.TrimSpace(os.Getenv("PROFILES")); raw != "" {
			profiles = nil
			for _, p := range strings.Split(raw, ",") {
				if p = strings.TrimSpace(p); p != "" {
					if err := roster.ValidateID(p); err != nil {
						return Config{}, fmt.Errorf("PROFILES: %w", err)
					}
					profiles = append(profiles, p)
				}
			}
		}
		profiles = withDiscovered(profiles, home)
	}

	return Config{
		Home:        home,
		Addr:        addr,
		Port:        port,
		Profiles:    profiles,
		GatewayPath: gateway,
		LogRequests: os.Getenv("LOG_REQUESTS") == "1",

		Source:     src,
		RemoteURL:  remote,
		RosterPath: strings.TrimSpace(os.Getenv("OFFICE_ROSTER")),
		RosterJSON: strings.TrimSpace(os.Getenv("OFFICE_ROSTER_JSON")),
		Title:      title,
		TZ:         tz,
		WebDir:     strings.TrimSpace(os.Getenv("WEB_DIR")),
	}, nil
}

// ValidateBaseURL accepts an absolute http(s) base URL and returns it without a
// trailing slash. It is the single validator shared by config.Load and
// source.NewRemote, so both reject exactly the same inputs.
func ValidateBaseURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("URL kosong")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("URL=%q bukan URL absolut (contoh: https://office.example.com)", raw)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("URL=%q harus http atau https", raw)
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("URL=%q tidak boleh memuat query atau fragment", raw)
	}
	return strings.TrimRight(u.String(), "/"), nil
}

// RedactURL returns the URL with the userinfo section removed. Credentials in
// REMOTE_API_URL (basic auth, or a bare token as the username) must never reach
// a response body or a log line; only the HTTP client sees the raw value.
func RedactURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		// Unparseable: do not echo it, it may well be a credential.
		return "<url tidak valid>"
	}
	if u.User != nil {
		u.User = nil
	}
	return strings.TrimRight(u.String(), "/")
}

// LocationOf resolves an IANA timezone name, defaulting to Asia/Jakarta.
func LocationOf(tz string) (*time.Location, error) {
	tz = strings.TrimSpace(tz)
	if tz == "" {
		tz = DefaultTZ
	}
	if strings.EqualFold(tz, "local") {
		return time.Local, nil
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, fmt.Errorf("OFFICE_TZ=%q bukan zona IANA yang dikenal (contoh: Asia/Jakarta)", tz)
	}
	return loc, nil
}

// withDiscovered appends profile folders that exist on disk but are not listed.
// A folder whose name is not a valid roster id is skipped: the name becomes a
// path segment and a DSN later, so `../../etc` must never get that far.
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
		if seen[name] || !roster.ValidID(name) {
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

// IsRemote reports whether the data comes from another office over HTTP.
func (c Config) IsRemote() bool { return c.Source == "remote" }

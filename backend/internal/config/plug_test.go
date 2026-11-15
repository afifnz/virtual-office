package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"officeapi/internal/roster"
)

// writeDB creates a file at home/rel, standing in for a state.db.
func writeDB(home, rel string) error {
	p := filepath.Join(home, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, []byte("x"), 0o644)
}

// One validator, used by config.Load and source.NewRemote, so both reject the
// same inputs. Only http(s) is a legal data source.
func TestValidateBaseURL(t *testing.T) {
	ok := map[string]string{
		"https://office.example.com":     "https://office.example.com",
		"https://office.example.com/":    "https://office.example.com",
		"http://127.0.0.1:8131":          "http://127.0.0.1:8131",
		"https://user:pass@office.local": "https://user:pass@office.local",
		"  https://office.example.com  ": "https://office.example.com",
	}
	for in, want := range ok {
		got, err := ValidateBaseURL(in)
		if err != nil {
			t.Fatalf("%q: %v", in, err)
		}
		if got != want {
			t.Fatalf("%q -> %q, want %q", in, got, want)
		}
	}

	bad := []string{
		"",
		"office.example.com",       // no scheme
		"//office.example.com",     // no scheme
		"ftp://office.example.com", // wrong scheme
		"file:///etc/passwd",
		"javascript:alert(1)",
		"https://office.example.com/?a=1", // query would be appended twice
		"https://office.example.com/#x",
	}
	for _, in := range bad {
		if got, err := ValidateBaseURL(in); err == nil {
			t.Fatalf("%q accepted as %q", in, got)
		}
	}
}

// A credential in REMOTE_API_URL must never reach a response or a log line.
func TestRedactURL(t *testing.T) {
	cases := map[string]string{
		"https://user:secret@office.example.com": "https://office.example.com",
		"https://token@office.example.com":       "https://office.example.com",
		"https://office.example.com/":            "https://office.example.com",
		"":                                       "",
	}
	for in, want := range cases {
		if got := RedactURL(in); got != want {
			t.Fatalf("RedactURL(%q) = %q, want %q", in, got, want)
		}
	}
	for _, raw := range []string{"https://user:secret@office.example.com", "https://tok_abc@host"} {
		out := RedactURL(raw)
		for _, secret := range []string{"secret", "tok_abc", "@"} {
			if strings.Contains(out, secret) {
				t.Fatalf("%q leaked %q in %q", raw, secret, out)
			}
		}
	}
	if got := RedactURL("://not a url"); got != "<url tidak valid>" {
		t.Fatalf("unparseable input echoed back: %q", got)
	}
}

// In remote mode PROFILES names desks that do not exist upstream, so it is
// ignored on purpose — even when it is set explicitly.
func TestRemoteIgnoresProfiles(t *testing.T) {
	clearEnv(t)
	t.Setenv("HERMES_HOME", t.TempDir())
	t.Setenv("OFFICE_SOURCE", "remote")
	t.Setenv("REMOTE_API_URL", "https://office.example.com")
	t.Setenv("PROFILES", "dev,edu")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.Profiles) != 0 {
		t.Fatalf("remote kept PROFILES=%v", cfg.Profiles)
	}
}

// A roster id becomes a directory name and a DSN, so a traversal attempt must
// be rejected at load time.
func TestLocalRejectsUnsafeProfileID(t *testing.T) {
	for _, bad := range []string{"../../tmp/leak", "a/b", "..", "na me", "profiles/x"} {
		clearEnv(t)
		t.Setenv("HERMES_HOME", t.TempDir())
		t.Setenv("PROFILES", bad)
		if _, err := Load(); err == nil {
			t.Fatalf("PROFILES=%q accepted", bad)
		}
	}
}

func TestLocalSkipsUnsafeDiscoveredFolder(t *testing.T) {
	clearEnv(t)
	home := t.TempDir()
	// A folder name that is not a valid id must never become a desk.
	if err := writeDB(home, "profiles/bad name/state.db"); err != nil {
		t.Fatal(err)
	}
	if err := writeDB(home, "profiles/good-one/state.db"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HERMES_HOME", home)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	for _, p := range cfg.Profiles {
		if p == "bad name" {
			t.Fatalf("unsafe folder discovered: %v", cfg.Profiles)
		}
	}
	found := false
	for _, p := range cfg.Profiles {
		if p == "good-one" {
			found = true
		}
	}
	if !found {
		t.Fatalf("valid folder missing from %v", cfg.Profiles)
	}
}

func TestBuildPayloadPublishesGridAndRedactsRemote(t *testing.T) {
	cfg := Config{
		Source:    "remote",
		RemoteURL: "https://user:s3cret@office.example.com",
		Title:     "Kantor",
		TZ:        "Asia/Jakarta",
	}
	p := Build(cfg, roster.Set{})
	if p.RemoteURL != "https://office.example.com" {
		t.Fatalf("remote_api_url = %q (credential leaked?)", p.RemoteURL)
	}
	if p.Layout.Grid.DX != 4.5 || p.Layout.Grid.DZ != 4.0 || p.Layout.Aisle != 1.6 {
		t.Fatalf("layout = %+v", p.Layout)
	}
	if p.Layout.Floor.W != 40 || p.Layout.Floor.D != 30 {
		t.Fatalf("floor = %+v", p.Layout.Floor)
	}
}

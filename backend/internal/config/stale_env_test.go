package config

import "testing"

// The stale threshold has a working default and a real env override; a typo
// must fail at startup instead of silently pinning every desk to "working".
func TestStaleSecondsDefaultAndOverride(t *testing.T) {
	t.Setenv("HERMES_HOME", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	t.Setenv("OFFICE_STALE_SECONDS", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.StaleSeconds != DefaultStaleSeconds {
		t.Fatalf("StaleSeconds = %d, want %d", cfg.StaleSeconds, DefaultStaleSeconds)
	}

	t.Setenv("OFFICE_STALE_SECONDS", "45")
	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.StaleSeconds != 45 {
		t.Fatalf("StaleSeconds = %d, want 45", cfg.StaleSeconds)
	}
}

func TestStaleSecondsRejectsBadValues(t *testing.T) {
	t.Setenv("HERMES_HOME", t.TempDir())
	t.Setenv("HOME", t.TempDir())

	for _, raw := range []string{"0", "-5", "3m", "abc"} {
		t.Setenv("OFFICE_STALE_SECONDS", raw)
		if _, err := Load(); err == nil {
			t.Fatalf("OFFICE_STALE_SECONDS=%q accepted, want an error", raw)
		}
	}
}

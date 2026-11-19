package config

import (
	"strings"
	"testing"
)

// Rate limiting is on by default: an unset env must not leave the public
// endpoint unprotected.
func TestRateLimitDefaults(t *testing.T) {
	t.Setenv("HERMES_HOME", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	t.Setenv("RATE_LIMIT", "")
	t.Setenv("RATE_LIMIT_PER_MIN", "")
	t.Setenv("RATE_LIMIT_BURST", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.RateLimit {
		t.Fatal("RateLimit = false by default")
	}
	if cfg.RateLimitPerMin != DefaultRateLimitPerMin || cfg.RateLimitBurst != DefaultRateLimitBurst {
		t.Fatalf("defaults = %d/min burst %d", cfg.RateLimitPerMin, cfg.RateLimitBurst)
	}
}

func TestRateLimitOffAndOverrides(t *testing.T) {
	t.Setenv("HERMES_HOME", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	t.Setenv("RATE_LIMIT", "off")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.RateLimit {
		t.Fatal("RATE_LIMIT=off still enabled the limiter")
	}

	t.Setenv("RATE_LIMIT", "on")
	t.Setenv("RATE_LIMIT_PER_MIN", "7")
	t.Setenv("RATE_LIMIT_BURST", "2")
	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.RateLimit || cfg.RateLimitPerMin != 7 || cfg.RateLimitBurst != 2 {
		t.Fatalf("override = on=%v perMin=%d burst=%d", cfg.RateLimit, cfg.RateLimitPerMin, cfg.RateLimitBurst)
	}
}

// A typo must fail at startup (exit 2) instead of silently running unlimited.
func TestRateLimitRejectsBadValues(t *testing.T) {
	cases := []struct{ name, key, value, want string }{
		{"unknown switch", "RATE_LIMIT", "maybe", "RATE_LIMIT"},
		{"zero per minute", "RATE_LIMIT_PER_MIN", "0", "RATE_LIMIT_PER_MIN"},
		{"non-numeric", "RATE_LIMIT_PER_MIN", "120/m", "RATE_LIMIT_PER_MIN"},
		{"zero burst", "RATE_LIMIT_BURST", "0", "RATE_LIMIT_BURST"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("HERMES_HOME", t.TempDir())
			t.Setenv("HOME", t.TempDir())
			t.Setenv(tc.key, tc.value)
			_, err := Load()
			if err == nil {
				t.Fatalf("%s=%q accepted", tc.key, tc.value)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %q, want it to name %s", err, tc.want)
			}
		})
	}
}

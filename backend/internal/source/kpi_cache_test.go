package source

import (
	"context"
	"testing"
	"time"

	"officeapi/internal/config"
	"officeapi/internal/fixture"
)

// The KPI report is expensive (every state.db, 7-30 days of rows) and is
// requested far less often than /api/status, so it is cached for 60 s. This
// proves the cache actually holds and then expires, with a controllable clock
// instead of a sleep.
func TestKPICacheHoldsSixtySeconds(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("dev")
	w.Session(fixture.Session{ID: "s1", Profile: "dev", Source: "cli", Started: 1800000000 - 600, Updated: 1800000000 - 60})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "satu", TS: 1800000000 - 600})
	w.Msg(fixture.Msg{Session: "s1", Role: "assistant", Content: "dua", TS: 1800000000 - 60})
	w.Close()

	cfg := config.Config{Home: home.Dir, Profiles: []string{"dev"}, Port: 8130,
		GatewayPath: home.Dir + "/gateway_state.json", TZ: "Asia/Jakarta"}
	s := NewLocal(cfg, quiet()).(*local)
	clock := time.Unix(1800000000, 0).Add(-30 * time.Second) // keep seeded rows in the past
	s.clock = func() time.Time { return clock }

	rep, err := s.KPI(context.Background(), "7d")
	if err != nil {
		t.Fatalf("first KPI: %v", err)
	}
	if rep.Totals.Messages != 2 {
		t.Fatalf("first messages = %d, want 2", rep.Totals.Messages)
	}

	// Advance to just inside the TTL: the cached report must be returned.
	clock = clock.Add(59 * time.Second)
	rep, err = s.KPI(context.Background(), "7d")
	if err != nil {
		t.Fatalf("cached KPI: %v", err)
	}
	if rep.Totals.Messages != 2 {
		t.Fatalf("cached messages = %d, want the cached 2", rep.Totals.Messages)
	}
	if rep.GeneratedAt != float64(clock.Unix())-59 {
		t.Fatalf("generated_at = %v, want the first build time", rep.GeneratedAt)
	}

	// Past the TTL it is rebuilt; the window is now shifted, which is visible
	// because the seeded rows fall out of a 7d window only after 7 days.
	clock = clock.Add(2 * time.Second)
	rep, err = s.KPI(context.Background(), "7d")
	if err != nil {
		t.Fatalf("refreshed KPI: %v", err)
	}
	if rep.GeneratedAt != float64(clock.Unix()) {
		t.Fatalf("generated_at = %v, want rebuilt at %v", rep.GeneratedAt, clock.Unix())
	}

	if _, err := s.KPI(context.Background(), "90d"); err == nil {
		t.Fatal("invalid window must be rejected by the source too")
	}
}

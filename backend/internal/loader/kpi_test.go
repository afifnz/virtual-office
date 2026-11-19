package loader

import (
	"log"
	"os"
	"path/filepath"
	"testing"
	"time"

	"officeapi/internal/config"
	"officeapi/internal/derive"
	"officeapi/internal/fixture"
)

// kpiHome seeds a real SQLite fixture: one busy profile, one profile whose
// token column is all zero (Hermes may not write it), and one profile with no
// database at all (an idle desk that must still appear).
func kpiHome(t *testing.T, now float64) config.Config {
	t.Helper()
	home := fixture.New(t)

	dev := home.Profile("dev")
	t0 := now - 3*3600
	dev.Session(fixture.Session{ID: "s1", Profile: "dev", Source: "cli", Started: t0, Updated: t0 + 300})
	dev.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "kerjakan", TS: t0})
	dev.Msg(fixture.Msg{Session: "s1", Role: "assistant", TS: t0 + 60, Tokens: 100,
		Calls: []map[string]any{fixture.ToolCall("terminal", map[string]any{"command": "make"})}})
	dev.Msg(fixture.Msg{Session: "s1", Role: "tool", Tool: "terminal", Content: "ok", TS: t0 + 120})
	dev.Msg(fixture.Msg{Session: "s1", Role: "tool", Tool: "terminal", Content: "[TOOL_ERROR] boom", TS: t0 + 180})
	dev.Msg(fixture.Msg{Session: "s1", Role: "tool", Tool: "terminal", Content: "[TOOL_ERROR] boom lagi", TS: t0 + 240})
	dev.Msg(fixture.Msg{Session: "s1", Role: "assistant", Content: "menyerah sementara", TS: t0 + 300, Tokens: 250})
	// Outside the 7d window, inside 30d.
	dev.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "lama", TS: now - 8*86400, Tokens: 999})
	dev.Close()

	edu := home.Profile("edu")
	edu.Session(fixture.Session{ID: "e1", Profile: "edu", Source: "telegram", Started: now - 600, Updated: now - 540})
	edu.Msg(fixture.Msg{Session: "e1", Role: "user", Content: "halo", TS: now - 600})
	edu.Close()

	home.Gateway("running", "0.24.0", time.Unix(int64(now), 0).UTC().Format(time.RFC3339))
	return config.Config{
		Home:        home.Dir,
		Profiles:    []string{"dev", "edu", "planner"},
		GatewayPath: filepath.Join(home.Dir, "gateway_state.json"),
		TZ:          "Asia/Jakarta",
		Port:        8130,
	}
}

func kpiAgent(t *testing.T, rep derive.KPIReport, id string) derive.AgentKPI {
	t.Helper()
	for _, a := range rep.Agents {
		if a.ID == id {
			return a
		}
	}
	t.Fatalf("agent %s missing from report (%d agents)", id, len(rep.Agents))
	return derive.AgentKPI{}
}

func TestKPIAggregatesFixtureDB(t *testing.T) {
	now := 1800000000.0
	cfg := kpiHome(t, now)
	l := New(cfg, log.New(os.Stderr, "", 0))

	rep := l.KPI("7d", time.Unix(int64(now), 0))
	if rep.Window != "7d" || rep.CacheTTLS != 60 {
		t.Fatalf("window/ttl = %q/%d", rep.Window, rep.CacheTTLS)
	}
	if rep.Data.ProfilesOK != 2 || rep.Data.ProfilesErr != 0 || rep.Data.ProfilesRead != 2 {
		t.Fatalf("profiles read/ok/err = %d/%d/%d", rep.Data.ProfilesRead, rep.Data.ProfilesOK, rep.Data.ProfilesErr)
	}
	if rep.Data.CostAvailable {
		t.Fatal("cost must not be claimed without a cost column")
	}
	if !rep.Data.TokenColumn {
		t.Fatal("token_column must be true for a schema that has a tokens column")
	}

	dev := kpiAgent(t, rep, "dev")
	if dev.Sessions != 1 || dev.Messages != 6 {
		t.Fatalf("dev sessions/messages = %d/%d, want 1/6", dev.Sessions, dev.Messages)
	}
	if dev.ToolCalls != 1 {
		t.Fatalf("dev tool_calls = %d, want 1 (one assistant call, results not counted)", dev.ToolCalls)
	}
	if dev.ActiveDays != 1 || dev.ActiveHours != 1 {
		t.Fatalf("dev active days/hours = %d/%d, want 1/1", dev.ActiveDays, dev.ActiveHours)
	}
	if dev.ActiveSeconds != 300 {
		t.Fatalf("dev active_seconds = %d, want 300", dev.ActiveSeconds)
	}
	if dev.BlockedSeconds != 120 {
		t.Fatalf("dev blocked_seconds = %d, want 120", dev.BlockedSeconds)
	}
	if dev.BlockedPct == nil || *dev.BlockedPct != 40 {
		t.Fatalf("dev blocked_pct = %v, want 40", dev.BlockedPct)
	}
	if dev.MedianGapS == nil || *dev.MedianGapS != 60 {
		t.Fatalf("dev median_gap_s = %v, want 60", dev.MedianGapS)
	}
	if !dev.Tokens.Available || dev.Tokens.Total == nil || *dev.Tokens.Total != 350 {
		t.Fatalf("dev tokens = %+v, want available 350", dev.Tokens)
	}
	if dev.Tokens.MessagesWithTokens != 2 {
		t.Fatalf("dev token messages = %d, want 2", dev.Tokens.MessagesWithTokens)
	}

	// A profile whose token column is present but all zero must not claim "0
	// tokens": that is indistinguishable from "not recorded".
	edu := kpiAgent(t, rep, "edu")
	if edu.Messages != 1 {
		t.Fatalf("edu messages = %d, want 1", edu.Messages)
	}
	if edu.Tokens.Available || edu.Tokens.Total != nil {
		t.Fatalf("edu tokens = %+v, want unavailable/null", edu.Tokens)
	}
	if edu.BlockedPct != nil {
		t.Fatalf("edu blocked_pct = %v, want null (no measurable span)", *edu.BlockedPct)
	}

	planner := kpiAgent(t, rep, "planner")
	if planner.Messages != 0 || planner.Sessions != 0 || planner.Tokens.Available {
		t.Fatalf("planner should be an empty desk: %+v", planner)
	}

	if rep.Totals.Messages != 7 || rep.Totals.ActiveAgents != 2 {
		t.Fatalf("totals messages/active = %d/%d, want 7/2", rep.Totals.Messages, rep.Totals.ActiveAgents)
	}
	if rep.Totals.Tokens.Total == nil || *rep.Totals.Tokens.Total != 350 {
		t.Fatalf("totals tokens = %+v, want 350", rep.Totals.Tokens)
	}
}

func TestKPIWindowIsApplied(t *testing.T) {
	now := 1800000000.0
	l := New(kpiHome(t, now), log.New(os.Stderr, "", 0))

	week := l.KPI("7d", time.Unix(int64(now), 0))
	month := l.KPI("30d", time.Unix(int64(now), 0))
	if got := kpiAgent(t, week, "dev").Messages; got != 6 {
		t.Fatalf("7d messages = %d, want 6 (an 8-day-old row excluded)", got)
	}
	if got := kpiAgent(t, month, "dev").Messages; got != 7 {
		t.Fatalf("30d messages = %d, want 7", got)
	}
	if got := kpiAgent(t, month, "dev").Tokens; got.Total == nil || *got.Total != 1349 {
		t.Fatalf("30d tokens = %+v, want 1349", got)
	}
}

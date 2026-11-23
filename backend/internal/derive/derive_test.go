package derive_test

import (
	"encoding/json"
	"io"
	"log"
	"strings"
	"testing"
	"time"

	"officeapi/internal/config"
	"officeapi/internal/derive"
	"officeapi/internal/fixture"
	"officeapi/internal/loader"
)

// The office clock is fixed in every test: 2027-01-15T10:00:00Z.
const nowF = 1800000000.0

func snapshot(t *testing.T, home *fixture.Home, profiles ...string) derive.Snapshot {
	t.Helper()
	cfg := config.Config{Home: home.Dir, Profiles: profiles, GatewayPath: home.Dir + "/gateway_state.json"}
	l := loader.New(cfg, testLogger(t))
	return l.Snapshot(time.Unix(int64(nowF), 0))
}

func testLogger(t *testing.T) *log.Logger {
	t.Helper()
	return log.New(io.Discard, "", 0)
}

func agent(t *testing.T, s derive.Snapshot, id string) derive.Agent {
	t.Helper()
	for _, a := range s.Agents {
		if a.ID == id {
			return a
		}
	}
	t.Fatalf("agent %q missing from snapshot", id)
	return derive.Agent{}
}

// --- status derivation -------------------------------------------------------

func TestWorkingWhenLastMessageIsFresh(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("default")
	w.Session(fixture.Session{ID: "s1", Profile: "default", Source: "telegram", Started: nowF - 300, Updated: nowF - 5})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "halo", TS: nowF - 300})
	w.Msg(fixture.Msg{Session: "s1", Role: "tool", Tool: "terminal", Content: "ok", TS: nowF - 5})
	w.Close()

	s := snapshot(t, home, "default")
	a := agent(t, s, "default")
	if a.Status != "working" {
		t.Fatalf("status = %q, want working", a.Status)
	}
	if a.Current == nil || a.Current.Kind != "tool_result" {
		t.Fatalf("current = %+v, want tool_result", a.Current)
	}
	if len(a.Current.Tools) != 1 || a.Current.Tools[0] != "terminal" {
		t.Fatalf("tools = %v", a.Current.Tools)
	}
}

func TestIdleWhenLastMessageIsStale(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("default")
	w.Session(fixture.Session{ID: "s1", Profile: "default", Source: "telegram", Started: nowF - 7200, Updated: nowF - 3600})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "halo", TS: nowF - 7200})
	w.Msg(fixture.Msg{Session: "s1", Role: "assistant", Content: "selesai", TS: nowF - 3600})
	w.Close()

	a := agent(t, snapshot(t, home, "default"), "default")
	if a.Status != "idle" {
		t.Fatalf("status = %q, want idle (assistant reply ends the turn)", a.Status)
	}
	if a.Current == nil || a.Current.Kind != "reply" {
		t.Fatalf("current = %+v, want reply", a.Current)
	}
}

func TestReviewerReportsReviewing(t *testing.T) {
	home := fixture.New(t)
	for _, p := range []string{"reviewer", "coder"} {
		w := home.Profile(p)
		w.Session(fixture.Session{ID: "s-" + p, Profile: p, Source: "subagent", Started: nowF - 60, Updated: nowF - 3})
		w.Msg(fixture.Msg{Session: "s-" + p, Role: "user", Content: "review", TS: nowF - 60})
		w.Msg(fixture.Msg{Session: "s-" + p, Role: "tool", Tool: "read_file", Content: "ok", TS: nowF - 3})
		w.Close()
	}

	s := snapshot(t, home, "reviewer", "coder")
	if got := agent(t, s, "reviewer").Status; got != "reviewing" {
		t.Fatalf("reviewer status = %q, want reviewing", got)
	}
	if got := agent(t, s, "coder").Status; got != "working" {
		t.Fatalf("coder status = %q, want working", got)
	}
}

func TestOfflineProfileWithNoDatabase(t *testing.T) {
	home := fixture.New(t)
	a := agent(t, snapshot(t, home, "default", "edu"), "edu")
	if a.Status != "offline" {
		t.Fatalf("status = %q, want offline", a.Status)
	}
	if a.Today.Hourly == nil || len(a.Today.Hourly) != 24 {
		t.Fatalf("hourly buckets = %v", a.Today.Hourly)
	}
}

// --- blocked -----------------------------------------------------------------

func TestBlockedAfterTwoConsecutiveFailingTools(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("coder")
	w.Session(fixture.Session{ID: "s1", Profile: "coder", Source: "subagent", Started: nowF - 120, Updated: nowF - 20})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "build", TS: nowF - 120})
	w.Msg(fixture.Msg{Session: "s1", Role: "assistant", Calls: []map[string]any{
		fixture.ToolCall("terminal", map[string]any{"command": "npm run build"}),
	}, TS: nowF - 100})
	w.Msg(fixture.Msg{Session: "s1", Role: "tool", Tool: "terminal", Content: `{"error": "exit 1: cannot find module"}`, TS: nowF - 60})
	w.Msg(fixture.Msg{Session: "s1", Role: "tool", Tool: "terminal", Content: `{"error": "exit 1: still broken"}`, TS: nowF - 20})
	w.Close()

	a := agent(t, snapshot(t, home, "coder"), "coder")
	if a.Status != "blocked" {
		t.Fatalf("status = %q, want blocked", a.Status)
	}
	if a.Blocked == nil || !strings.Contains(a.Blocked.Reason, "2 tool gagal") {
		t.Fatalf("blocked = %+v, want reason '2 tool gagal berturut'", a.Blocked)
	}
}

func TestBlockedExpiresAfterThirtyMinutes(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("coder")
	w.Session(fixture.Session{ID: "s1", Profile: "coder", Source: "subagent", Started: nowF - 3600, Updated: nowF - 2400})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "build", TS: nowF - 3600})
	w.Msg(fixture.Msg{Session: "s1", Role: "tool", Tool: "terminal", Content: `{"error":"a"}`, TS: nowF - 2500})
	w.Msg(fixture.Msg{Session: "s1", Role: "tool", Tool: "terminal", Content: `{"error":"b"}`, TS: nowF - 2400})
	w.Close()

	a := agent(t, snapshot(t, home, "coder"), "coder")
	if a.Status == "blocked" || a.Blocked != nil {
		t.Fatalf("status=%q blocked=%+v, want the verdict to expire after 30 min", a.Status, a.Blocked)
	}
}

func TestBlockedFromErrorEndReason(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("tester")
	w.Session(fixture.Session{ID: "s1", Profile: "tester", Source: "subagent",
		Started: nowF - 600, Updated: nowF - 30, Ended: nowF - 30, EndReason: "tool_error"})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "test", TS: nowF - 600})
	w.Msg(fixture.Msg{Session: "s1", Role: "assistant", Content: "gagal", TS: nowF - 30})
	w.Close()

	a := agent(t, snapshot(t, home, "tester"), "tester")
	if a.Status != "blocked" || a.Blocked == nil {
		t.Fatalf("status=%q blocked=%+v, want blocked from error end_reason", a.Status, a.Blocked)
	}
	if !strings.Contains(a.Blocked.Reason, "tool_error") {
		t.Fatalf("reason = %q", a.Blocked.Reason)
	}
}

// --- subagent attribution ----------------------------------------------------

func TestSubagentRoutedProfileOwnsTheSession(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("default")
	w.Session(fixture.Session{ID: "parent1", Profile: "default", Source: "telegram", Started: nowF - 600, Updated: nowF - 590})
	w.Msg(fixture.Msg{Session: "parent1", Role: "user", Content: "kerjakan fitur", TS: nowF - 600})
	w.Msg(fixture.Msg{Session: "parent1", Role: "assistant", Calls: []map[string]any{
		fixture.ToolCall("delegate_task", map[string]any{
			"tasks": []map[string]any{{"goal": "build the thing", "profile": "dev"}},
		}),
	}, TS: nowF - 590})
	// child lives in the parent's DB, routed to profile "dev"
	w.Session(fixture.Session{ID: "child1", Profile: "default", Source: "subagent", ParentID: "parent1",
		ModelConfig: `{"_subagent_id":"sa-0-parent1"}`, Started: nowF - 580, Updated: nowF - 2})
	w.Msg(fixture.Msg{Session: "child1", Role: "user", Content: "build the thing", TS: nowF - 580})
	w.Msg(fixture.Msg{Session: "child1", Role: "tool", Tool: "terminal", Content: "ok", TS: nowF - 2})
	w.Close()

	s := snapshot(t, home, "default", "dev")
	dev := agent(t, s, "dev")
	if dev.Status != "working" {
		t.Fatalf("dev status = %q, want working via routed subagent", dev.Status)
	}
	if dev.Source != "subagent" {
		t.Fatalf("dev source = %q, want subagent", dev.Source)
	}
	if dev.Task == nil || *dev.Task != "child1" {
		t.Fatalf("dev task = %v, want child1", dev.Task)
	}
	// a delegate comm must exist from default -> dev
	found := false
	for _, c := range s.Comms {
		if c.Kind == "delegate" && c.From == "default" && c.To == "dev" {
			found = true
		}
	}
	if !found {
		t.Fatalf("no delegate comm default->dev in %+v", s.Comms)
	}
	// and the task must be owned by dev, attributed from default
	var task *derive.Task
	for i := range s.Tasks {
		if s.Tasks[i].ID == "child1" {
			task = &s.Tasks[i]
		}
	}
	if task == nil || task.Owner != "dev" || task.From != "parent1" || task.Via != "subagent" {
		t.Fatalf("task = %+v, want owner=dev from=parent1 via=subagent", task)
	}
}

func TestUnroutedSubagentStaysWithParent(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("default")
	w.Session(fixture.Session{ID: "parent1", Profile: "default", Source: "telegram", Started: nowF - 600, Updated: nowF - 590})
	w.Msg(fixture.Msg{Session: "parent1", Role: "assistant", Calls: []map[string]any{
		fixture.ToolCall("delegate_task", map[string]any{
			"tasks": []map[string]any{{"goal": "anonymous"}},
		}),
	}, TS: nowF - 590})
	w.Session(fixture.Session{ID: "child1", Profile: "default", Source: "subagent", ParentID: "parent1",
		ModelConfig: `{"_subagent_id":"sa-0-parent1"}`, Started: nowF - 580, Updated: nowF - 2})
	w.Msg(fixture.Msg{Session: "child1", Role: "tool", Tool: "terminal", Content: "ok", TS: nowF - 2})
	w.Close()

	s := snapshot(t, home, "default", "dev")
	if got := agent(t, s, "dev").Status; got != "offline" {
		t.Fatalf("dev status = %q, want offline (anonymous child belongs to parent)", got)
	}
	if got := agent(t, s, "default").Status; got != "working" {
		t.Fatalf("default status = %q, want working", got)
	}
}

// --- counters / feed ---------------------------------------------------------

func TestTodayCountersUseWIBBuckets(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("default")
	// nowF is 10:00Z = 17:00 WIB; messages at 08:00 WIB and 17:00 WIB today.
	w.Session(fixture.Session{ID: "s1", Profile: "default", Source: "telegram", Started: nowF - 9*3600, Updated: nowF - 60})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "pagi", TS: nowF - 9*3600, Tokens: 100})
	w.Msg(fixture.Msg{Session: "s1", Role: "assistant", Calls: []map[string]any{
		fixture.ToolCall("terminal", map[string]any{"command": "ls"}),
	}, TS: nowF - 60, Tokens: 50})
	w.Close()

	a := agent(t, snapshot(t, home, "default"), "default")
	if a.Today.Messages != 2 {
		t.Fatalf("today.messages = %d, want 2", a.Today.Messages)
	}
	if a.Today.ToolCalls != 1 {
		t.Fatalf("today.tool_calls = %d, want 1", a.Today.ToolCalls)
	}
	if a.Today.Tokens != 150 {
		t.Fatalf("today.tokens = %d, want 150", a.Today.Tokens)
	}
	wib := time.FixedZone("WIB", 7*3600)
	lt := time.Unix(int64(nowF), 0).In(wib)
	dayStart := time.Date(lt.Year(), lt.Month(), lt.Day(), 0, 0, 0, 0, wib).Unix()
	slot := func(ts float64) int { return int((ts - float64(dayStart)) / 3600) }
	morning, fresh := slot(nowF-9*3600), slot(nowF-60)
	if a.Today.Hourly[morning] != 1 || a.Today.Hourly[fresh] != 1 {
		t.Fatalf("hourly[%d]=%d hourly[%d]=%d, want 1 and 1",
			morning, a.Today.Hourly[morning], fresh, a.Today.Hourly[fresh])
	}
	sum := 0
	for _, v := range a.Today.Hourly {
		sum += v
	}
	if sum != 2 {
		t.Fatalf("hourly sum = %d, want 2", sum)
	}
	if a.Today.Sessions != 1 || a.Total.Sessions != 1 {
		t.Fatalf("sessions today=%d total=%d", a.Today.Sessions, a.Total.Sessions)
	}
}

func snapshotTZ(t *testing.T, home *fixture.Home, tz string, profiles ...string) derive.Snapshot {
	t.Helper()
	cfg := config.Config{Home: home.Dir, Profiles: profiles, TZ: tz,
		GatewayPath: home.Dir + "/gateway_state.json"}
	l := loader.New(cfg, testLogger(t))
	return l.Snapshot(time.Unix(int64(nowF), 0))
}

// OFFICE_TZ moves the day boundary and the hourly buckets: the same messages
// are "today" in Jakarta and "yesterday" in a zone where it just turned
// midnight.
func TestTodayCountersFollowOfficeTZ(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("default")
	// nowF is 08:00Z = 15:00 WIB = 00:00 in Los Angeles; these messages are two
	// hours earlier, so they are today in Jakarta and yesterday in LA.
	w.Session(fixture.Session{ID: "s1", Profile: "default", Source: "telegram",
		Started: nowF - 2*3600, Updated: nowF - 2*3600 + 1})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "menjelang tengah malam", TS: nowF - 2*3600})
	w.Msg(fixture.Msg{Session: "s1", Role: "assistant", Content: "ok", TS: nowF - 2*3600 + 1})
	w.Close()

	if a := agent(t, snapshotTZ(t, home, "Asia/Jakarta", "default"), "default"); a.Today.Messages != 2 {
		t.Fatalf("Jakarta today.messages = %d, want 2", a.Today.Messages)
	}
	if a := agent(t, snapshotTZ(t, home, "America/Los_Angeles", "default"), "default"); a.Today.Messages != 0 {
		t.Fatalf("Los Angeles today.messages = %d, want 0 (still yesterday there)", a.Today.Messages)
	}
	if a := agent(t, snapshot(t, home, "default"), "default"); a.Today.Messages != 2 {
		t.Fatalf("default tz today.messages = %d, want 2 (WIB fallback)", a.Today.Messages)
	}
}

func TestFeedIsNewestFirstAndCapped(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("default")
	w.Session(fixture.Session{ID: "s1", Profile: "default", Source: "telegram", Started: nowF - 5000, Updated: nowF - 10})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "mulai", TS: nowF - 5000})
	for i := 0; i < 60; i++ {
		w.Msg(fixture.Msg{Session: "s1", Role: "tool", Tool: "terminal", Content: "ok", TS: nowF - 4000 + float64(i)*10})
	}
	w.Close()

	s := snapshot(t, home, "default")
	if len(s.Feed) != derive.FeedLimit {
		t.Fatalf("feed len = %d, want %d", len(s.Feed), derive.FeedLimit)
	}
	if s.Feed[0].TS < s.Feed[1].TS {
		t.Fatalf("feed not newest-first: %v then %v", s.Feed[0].TS, s.Feed[1].TS)
	}
	if s.Feed[0].Kind != "tool_result" {
		t.Fatalf("newest kind = %q", s.Feed[0].Kind)
	}
}

// --- JSON contract -----------------------------------------------------------

func TestJSONShapeMatchesLegacyContract(t *testing.T) {
	home := fixture.New(t)
	home.Gateway("running", "0.23.1", "2027-01-15T10:00:00+00:00")
	w := home.Profile("default")
	w.Session(fixture.Session{ID: "s1", Profile: "default", Source: "telegram", Started: nowF - 90, Updated: nowF - 4})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "RAHASIA-jangan-bocor", TS: nowF - 90})
	w.Msg(fixture.Msg{Session: "s1", Role: "tool", Tool: "terminal", Content: "RAHASIA-output", TS: nowF - 4})
	w.Close()

	s := snapshot(t, home, "default")
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(raw), "RAHASIA") {
		t.Fatalf("payload leaks message content: %s", raw)
	}

	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, k := range []string{"now", "gateway", "agents", "feed", "tasks", "comms"} {
		if _, ok := top[k]; !ok {
			t.Fatalf("top-level key %q missing", k)
		}
	}
	// The contract is additive: the six legacy keys plus the database health
	// block. Anything else is a new field nobody agreed on.
	allowed := map[string]bool{
		"now": true, "gateway": true, "agents": true, "feed": true,
		"tasks": true, "comms": true,
		"dbs_checked": true, "dbs_ok": true, "dbs_err": true, "dbs_failed": true,
	}
	for _, k := range keys(top) {
		if !allowed[k] {
			t.Fatalf("unexpected top-level key %q", k)
		}
	}
	for _, k := range []string{"dbs_checked", "dbs_ok", "dbs_err"} {
		if _, ok := top[k]; !ok {
			t.Fatalf("db health key %q missing", k)
		}
	}

	var agents []map[string]json.RawMessage
	_ = json.Unmarshal(top["agents"], &agents)
	if len(agents) == 0 {
		t.Fatal("no agents")
	}
	for _, k := range []string{"id", "status", "last_active", "current", "today", "total", "task", "source", "blocked", "stale"} {
		if _, ok := agents[0][k]; !ok {
			t.Fatalf("agent key %q missing", k)
		}
	}
	var today map[string]json.RawMessage
	_ = json.Unmarshal(agents[0]["today"], &today)
	for _, k := range []string{"sessions", "messages", "tool_calls", "tokens", "hourly"} {
		if _, ok := today[k]; !ok {
			t.Fatalf("today key %q missing", k)
		}
	}

	var gw map[string]any
	_ = json.Unmarshal(top["gateway"], &gw)
	if gw["state"] != "running" || gw["version"] != "0.23.1" {
		t.Fatalf("gateway = %v", gw)
	}

	var feed []map[string]json.RawMessage
	_ = json.Unmarshal(top["feed"], &feed)
	for _, k := range []string{"agent", "ts", "kind", "tools", "source"} {
		if _, ok := feed[0][k]; !ok {
			t.Fatalf("feed key %q missing", k)
		}
	}

	var tasks []map[string]json.RawMessage
	_ = json.Unmarshal(top["tasks"], &tasks)
	for _, k := range []string{"id", "owner", "from", "via", "status", "blocked", "started", "last", "ended", "tools", "messages"} {
		if _, ok := tasks[0][k]; !ok {
			t.Fatalf("task key %q missing", k)
		}
	}

	var comms []map[string]json.RawMessage
	_ = json.Unmarshal(top["comms"], &comms)
	if len(comms) == 0 {
		t.Fatal("no comms derived for a user request")
	}
	for _, k := range []string{"ts", "from", "to", "kind", "task"} {
		if _, ok := comms[0][k]; !ok {
			t.Fatalf("comms key %q missing", k)
		}
	}
}

func TestEmptyHomeStillReturnsValidSnapshot(t *testing.T) {
	home := fixture.New(t)
	s := snapshot(t, home, "default", "dev")
	if s.Agents == nil || s.Feed == nil || s.Tasks == nil || s.Comms == nil {
		t.Fatalf("empty slices must serialise as [] not null: %+v", s)
	}
	if s.Gateway.State != "unknown" {
		t.Fatalf("gateway state = %q, want unknown", s.Gateway.State)
	}
	raw, _ := json.Marshal(s)
	if strings.Contains(string(raw), "null}") && strings.Contains(string(raw), `"feed":null`) {
		t.Fatalf("null array in payload: %s", raw)
	}
}

// --- status truth: stale + waiting -------------------------------------------

// snapshotStale builds a snapshot with an explicit stale threshold.
func snapshotStale(t *testing.T, home *fixture.Home, stale int, profiles ...string) derive.Snapshot {
	t.Helper()
	cfg := config.Config{Home: home.Dir, Profiles: profiles, StaleSeconds: stale,
		GatewayPath: home.Dir + "/gateway_state.json"}
	l := loader.New(cfg, testLogger(t))
	return l.Snapshot(time.Unix(int64(nowF), 0))
}

// A tool call cannot keep a desk "working" forever: after StaleAfter with no
// reply and no session end, the verdict is an artefact and must read idle —
// but the last activity is kept so the UI can explain it.
func TestStaleWorkingFallsBackToIdle(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("dev")
	w.Session(fixture.Session{ID: "s1", Profile: "dev", Source: "cli", Started: nowF - 900, Updated: nowF - 400})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "mulai", TS: nowF - 900})
	w.Msg(fixture.Msg{Session: "s1", Role: "assistant", Calls: []map[string]any{
		fixture.ToolCall("terminal", map[string]any{"command": "sleep 1000"}),
	}, TS: nowF - 400})
	w.Close()

	a := agent(t, snapshot(t, home, "dev"), "dev")
	if a.Status != "idle" {
		t.Fatalf("status = %q, want idle after 400 s of silence (stale rule)", a.Status)
	}
	if !a.Stale {
		t.Fatal("stale = false, want true so the UI can explain the demotion")
	}
	if a.LastKind != "tool" {
		t.Fatalf("last_kind = %q, want tool", a.LastKind)
	}
	// the activity itself is still published: only the verdict changed
	if a.Current == nil || len(a.Current.Tools) != 1 || a.Current.Tools[0] != "terminal" {
		t.Fatalf("current = %+v, want the terminal call preserved", a.Current)
	}
	if a.LastActive != nowF-400 {
		t.Fatalf("last_active = %v, want %v", a.LastActive, nowF-400)
	}
}

func TestFreshWorkingIsNotStale(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("dev")
	w.Session(fixture.Session{ID: "s1", Profile: "dev", Source: "cli", Started: nowF - 300, Updated: nowF - 60})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "mulai", TS: nowF - 300})
	w.Msg(fixture.Msg{Session: "s1", Role: "tool", Tool: "terminal", Content: "ok", TS: nowF - 60})
	w.Close()

	a := agent(t, snapshot(t, home, "dev"), "dev")
	if a.Status != "working" || a.Stale {
		t.Fatalf("status=%q stale=%v, want working and fresh", a.Status, a.Stale)
	}
}

// OFFICE_STALE_SECONDS is a real knob: the same quiet desk stays working when
// the threshold is longer than the silence.
func TestStaleThresholdOverride(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("dev")
	w.Session(fixture.Session{ID: "s1", Profile: "dev", Source: "cli", Started: nowF - 900, Updated: nowF - 400})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "mulai", TS: nowF - 900})
	w.Msg(fixture.Msg{Session: "s1", Role: "assistant", Calls: []map[string]any{
		fixture.ToolCall("terminal", map[string]any{"command": "sleep 1000"}),
	}, TS: nowF - 400})
	w.Close()

	a := agent(t, snapshotStale(t, home, 600, "dev"), "dev")
	if a.Status != "working" || a.Stale {
		t.Fatalf("status=%q stale=%v with 600 s threshold, want working", a.Status, a.Stale)
	}
}

// Reviewers get the same treatment: "reviewing" is a verdict, not a fact.
func TestStaleReviewingFallsBackToIdle(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("reviewer")
	w.Session(fixture.Session{ID: "s1", Profile: "reviewer", Source: "subagent", Started: nowF - 900, Updated: nowF - 500})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "review", TS: nowF - 900})
	w.Msg(fixture.Msg{Session: "s1", Role: "tool", Tool: "read_file", Content: "ok", TS: nowF - 500})
	w.Close()

	a := agent(t, snapshot(t, home, "reviewer"), "reviewer")
	if a.Status != "idle" || !a.Stale {
		t.Fatalf("status=%q stale=%v, want idle + stale", a.Status, a.Stale)
	}
}

// delegateTask seeds a parent session whose last event is a delegate_task call
// at callTS, in the given profile. targets are the task profiles, one per child.
func delegateTask(w *fixture.Writer, profile, parentID string, callTS float64, targets ...string) {
	if len(targets) == 0 {
		targets = []string{"planner"}
	}
	tasks := make([]map[string]any, 0, len(targets))
	for _, t := range targets {
		tasks = append(tasks, map[string]any{"goal": "build", "profile": t})
	}
	w.Session(fixture.Session{ID: parentID, Profile: profile, Source: "cli", Started: callTS - 60, Updated: callTS})
	w.Msg(fixture.Msg{Session: parentID, Role: "user", Content: "kerjakan", TS: callTS - 60})
	w.Msg(fixture.Msg{Session: parentID, Role: "assistant", Calls: []map[string]any{
		fixture.ToolCall("delegate_task", map[string]any{"tasks": tasks}),
	}, TS: callTS})
}

// The parent of a running subagent is waiting, not working: same shape as the
// trace where `dev` sat on `working` + delegate_task for seven minutes.
func TestWaitingWhileChildRuns(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("dev")
	delegateTask(w, "dev", "parent1", nowF-600)
	w.Session(fixture.Session{ID: "child1", Profile: "dev", Source: "subagent", ParentID: "parent1",
		ModelConfig: `{"_subagent_id":"sa-0-parent1"}`, Started: nowF - 590, Updated: nowF - 30})
	w.Msg(fixture.Msg{Session: "child1", Role: "user", Content: "build", TS: nowF - 590})
	w.Msg(fixture.Msg{Session: "child1", Role: "tool", Tool: "terminal", Content: "ok", TS: nowF - 30})
	w.Close()

	dev := agent(t, snapshot(t, home, "dev", "planner"), "dev")
	if dev.Status != "waiting" {
		t.Fatalf("dev status = %q, want waiting while its child runs", dev.Status)
	}
	if dev.Children == nil || dev.Children.Total != 1 || dev.Children.Running != 1 {
		t.Fatalf("children = %+v, want {total:1 running:1}", dev.Children)
	}
	if dev.Stale {
		t.Fatal("a waiting agent is not stale: the child is doing the work")
	}
	if dev.Current == nil || !contains(dev.Current.Tools, "delegate_task") {
		t.Fatalf("current = %+v, want tools=[delegate_task]", dev.Current)
	}
	if dev.LastKind != "tool" {
		t.Fatalf("last_kind = %q, want tool", dev.LastKind)
	}
}

// Once the child answers and the parent records the result, it is working again
// and the children block disappears.
func TestWorkingAgainAfterChildResult(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("dev")
	delegateTask(w, "dev", "parent1", nowF-600)
	w.Session(fixture.Session{ID: "child1", Profile: "dev", Source: "subagent", ParentID: "parent1",
		ModelConfig: `{"_subagent_id":"sa-0-parent1"}`, Started: nowF - 590, Updated: nowF - 120,
		Ended: nowF - 120, EndReason: "ok"})
	w.Msg(fixture.Msg{Session: "child1", Role: "user", Content: "build", TS: nowF - 590})
	w.Msg(fixture.Msg{Session: "child1", Role: "assistant", Content: "selesai", TS: nowF - 120})
	w.Msg(fixture.Msg{Session: "parent1", Role: "user", Content: "ASYNC DELEGATION complete", TS: nowF - 100})
	w.Close()

	dev := agent(t, snapshot(t, home, "dev", "planner"), "dev")
	if dev.Status != "working" {
		t.Fatalf("dev status = %q, want working after the result landed", dev.Status)
	}
	if dev.Children != nil {
		t.Fatalf("children = %+v, want nil once no child is running", dev.Children)
	}
	if dev.Stale {
		t.Fatal("dev is stale right after a result")
	}
}

// total counts every child of the call, running only the live ones.
func TestChildrenTotalCountsFinishedKids(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("dev")
	delegateTask(w, "dev", "parent1", nowF-600, "planner", "coder")
	w.Session(fixture.Session{ID: "child1", Profile: "dev", Source: "subagent", ParentID: "parent1",
		ModelConfig: `{"_subagent_id":"sa-0-parent1"}`, Started: nowF - 590, Updated: nowF - 300,
		Ended: nowF - 300, EndReason: "ok"})
	w.Msg(fixture.Msg{Session: "child1", Role: "assistant", Content: "done", TS: nowF - 300})
	w.Session(fixture.Session{ID: "child2", Profile: "dev", Source: "subagent", ParentID: "parent1",
		ModelConfig: `{"_subagent_id":"sa-1-parent1"}`, Started: nowF - 280, Updated: nowF - 20})
	w.Msg(fixture.Msg{Session: "child2", Role: "tool", Tool: "terminal", Content: "ok", TS: nowF - 20})
	w.Close()

	dev := agent(t, snapshot(t, home, "dev", "planner"), "dev")
	if dev.Status != "waiting" {
		t.Fatalf("dev status = %q, want waiting", dev.Status)
	}
	if dev.Children == nil || dev.Children.Total != 2 || dev.Children.Running != 1 {
		t.Fatalf("children = %+v, want {total:2 running:1}", dev.Children)
	}
}

// A desk with a database but no session at all is offline, never idle-by-luck.
func TestAgentWithoutSessionsStaysOffline(t *testing.T) {
	home := fixture.New(t)
	home.Profile("edu").Close()
	a := agent(t, snapshot(t, home, "edu"), "edu")
	if a.Status != "offline" || a.Stale || a.Children != nil {
		t.Fatalf("status=%q stale=%v children=%+v, want offline", a.Status, a.Stale, a.Children)
	}
}

// A session that closed is not "working", even when its last row is a tool call
// inside the 15-minute mid-turn window.
func TestEndedSessionIsNotWorking(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("dev")
	w.Session(fixture.Session{ID: "s1", Profile: "dev", Source: "cli", Started: nowF - 900, Updated: nowF - 390,
		Ended: nowF - 390, EndReason: "ok"})
	w.Msg(fixture.Msg{Session: "s1", Role: "user", Content: "mulai", TS: nowF - 900})
	w.Msg(fixture.Msg{Session: "s1", Role: "tool", Tool: "terminal", Content: "ok", TS: nowF - 400})
	w.Close()

	a := agent(t, snapshot(t, home, "dev"), "dev")
	if a.Status != "idle" || a.Stale {
		t.Fatalf("status=%q stale=%v for a closed session, want idle and not stale", a.Status, a.Stale)
	}
}

// A subagent may run longer than the parent's own mid-turn window; the parent is
// still waiting for it.
func TestWaitingSurvivesMidTurnWindow(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("dev")
	delegateTask(w, "dev", "parent1", nowF-1200)
	w.Session(fixture.Session{ID: "child1", Profile: "dev", Source: "subagent", ParentID: "parent1",
		ModelConfig: `{"_subagent_id":"sa-0-parent1"}`, Started: nowF - 1190, Updated: nowF - 30})
	w.Msg(fixture.Msg{Session: "child1", Role: "user", Content: "build", TS: nowF - 1190})
	w.Msg(fixture.Msg{Session: "child1", Role: "tool", Tool: "terminal", Content: "ok", TS: nowF - 30})
	w.Close()

	dev := agent(t, snapshot(t, home, "dev", "planner"), "dev")
	if dev.Status != "waiting" {
		t.Fatalf("dev status = %q after 20 min, want waiting while the child still works", dev.Status)
	}
	if dev.Children == nil || dev.Children.Running != 1 {
		t.Fatalf("children = %+v, want one running child", dev.Children)
	}
}

// A leaked child row (no ended_at, silent for longer than the mid-turn window)
// must not pin the parent as waiting forever.
func TestDeadChildDoesNotPinWaiting(t *testing.T) {
	home := fixture.New(t)
	w := home.Profile("dev")
	delegateTask(w, "dev", "parent1", nowF-1200)
	w.Session(fixture.Session{ID: "child1", Profile: "dev", Source: "subagent", ParentID: "parent1",
		ModelConfig: `{"_subagent_id":"sa-0-parent1"}`, Started: nowF - 1190, Updated: nowF - 1000})
	w.Msg(fixture.Msg{Session: "child1", Role: "tool", Tool: "terminal", Content: "ok", TS: nowF - 1000})
	w.Close()

	dev := agent(t, snapshot(t, home, "dev", "planner"), "dev")
	if dev.Status != "idle" || dev.Children != nil {
		t.Fatalf("status=%q children=%+v, want idle with no children for a silent child", dev.Status, dev.Children)
	}
}

func contains(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

func keys(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

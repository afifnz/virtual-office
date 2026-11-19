package api_test

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"officeapi/internal/fixture"
)

// seedKPI writes a small history so /api/kpi has something to aggregate. The
// KPI window is anchored to the real clock, so the fixture must be too.
func seedKPI(t *testing.T, home *fixture.Home) {
	t.Helper()
	now := float64(time.Now().Unix())
	w := home.Profile("default")
	w.Session(fixture.Session{ID: "k1", Profile: "default", Source: "telegram",
		Started: now - 7200, Updated: now - 60})
	w.Msg(fixture.Msg{Session: "k1", Role: "user", Content: "rahasia-pesan", TS: now - 7200})
	w.Msg(fixture.Msg{Session: "k1", Role: "assistant", TS: now - 7140, Tokens: 120,
		Calls: []map[string]any{fixture.ToolCall("terminal", map[string]any{"command": "ls"})}})
	w.Msg(fixture.Msg{Session: "k1", Role: "tool", Tool: "terminal", Content: "ok", TS: now - 60})
	w.Close()
	home.Gateway("running", "0.23.1", "2027-01-15T10:00:00+00:00")
}

func TestKPIEndpoint(t *testing.T) {
	home := fixture.New(t)
	seedKPI(t, home)
	srv := newTestServer(t, home, "default", "dev")

	resp, body := get(t, srv.URL+"/api/kpi")
	if resp.StatusCode != 200 {
		t.Fatalf("status code = %d", resp.StatusCode)
	}
	for _, k := range []string{"window", "from", "to", "agents", "totals", "data"} {
		if _, ok := body[k]; !ok {
			t.Fatalf("key %q missing from /api/kpi", k)
		}
	}
	if body["window"] != "7d" {
		t.Fatalf("default window = %v, want 7d", body["window"])
	}
	agents, _ := body["agents"].([]any)
	if len(agents) != 2 {
		t.Fatalf("agents = %d, want 2 (roster ids, including the empty desk)", len(agents))
	}
	first, _ := agents[0].(map[string]any)
	if first["id"] != "default" {
		t.Fatalf("first agent = %v, want default (it has the activity)", first["id"])
	}
	if first["messages"] != float64(3) || first["tool_calls"] != float64(1) {
		t.Fatalf("default messages/tool_calls = %v/%v", first["messages"], first["tool_calls"])
	}
	tokens, _ := first["tokens"].(map[string]any)
	if tokens["available"] != true || tokens["total"] != float64(120) {
		t.Fatalf("tokens = %v", tokens)
	}
	data, _ := body["data"].(map[string]any)
	if data["cost_available"] != false {
		t.Fatalf("cost_available = %v, want false", data["cost_available"])
	}
	if data["token_column"] != true {
		t.Fatalf("token_column = %v, want true (fixture has a tokens column)", data["token_column"])
	}
	// Metadata only: the message text must never be echoed.
	raw, err := http.Get(srv.URL + "/api/kpi")
	if err != nil {
		t.Fatalf("raw GET: %v", err)
	}
	blob, _ := io.ReadAll(raw.Body)
	raw.Body.Close()
	if strings.Contains(string(blob), "rahasia-pesan") {
		t.Fatal("message content leaked into /api/kpi")
	}

	_, body = get(t, srv.URL+"/api/kpi?window=30d")
	if body["window"] != "30d" {
		t.Fatalf("window = %v, want 30d", body["window"])
	}

	resp, body = get(t, srv.URL+"/api/kpi?window=90d")
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("90d status = %d, want 400", resp.StatusCode)
	}
	if body["error"] == nil {
		t.Fatal("400 must explain the accepted windows")
	}

	// The new route is GET-only, like every other endpoint.
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/kpi", nil)
	presp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	presp.Body.Close()
	if presp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("POST status = %d, want 405", presp.StatusCode)
	}
}

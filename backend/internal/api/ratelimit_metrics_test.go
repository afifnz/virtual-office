package api_test

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"officeapi/internal/api"
	"officeapi/internal/config"
	"officeapi/internal/fixture"
	"officeapi/internal/roster"
	"officeapi/internal/source"
)

// limitedHandler builds a real handler over a fixture home with the limit on.
func limitedHandler(t *testing.T, perMin, burst int) http.Handler {
	t.Helper()
	home := fixture.New(t)
	seed(t, home)
	cfg := config.Config{
		Home: home.Dir, Port: 8131, Addr: "127.0.0.1",
		Profiles: []string{"default"}, GatewayPath: home.Dir + "/gateway_state.json",
		Source: "local", TZ: "Asia/Jakarta", Title: "Agent Office",
		RateLimit: true, RateLimitPerMin: perMin, RateLimitBurst: burst,
	}
	logger := log.New(io.Discard, "", 0)
	res := roster.Resolver{Profiles: cfg.Profiles}
	return api.NewServer(cfg, source.NewLocal(cfg, logger), res, logger).Handler()
}

func call(h http.Handler, path, remote string, headers map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, path, nil)
	if remote != "" {
		r.RemoteAddr = remote
	}
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

const loopback = "127.0.0.1:54321"

// The third request past a burst of 2 must be refused with 429, a Retry-After
// header and the documented JSON body.
func TestRateLimitReturns429WithRetryAfter(t *testing.T) {
	h := limitedHandler(t, 60, 2)

	for i := 0; i < 2; i++ {
		if w := call(h, "/api/config", loopback, nil); w.Code != http.StatusOK {
			t.Fatalf("request %d = %d, want 200", i+1, w.Code)
		}
	}
	w := call(h, "/api/config", loopback, nil)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("code = %d, want 429", w.Code)
	}
	retry := w.Header().Get("Retry-After")
	if retry == "" {
		t.Fatal("Retry-After header missing")
	}
	n, err := strconv.Atoi(retry)
	if err != nil || n < 1 {
		t.Fatalf("Retry-After = %q, want a positive integer", retry)
	}
	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode 429 body: %v", err)
	}
	if body["error"] != "rate_limited" {
		t.Fatalf("error = %v, want rate_limited", body["error"])
	}
	if got, _ := body["retry_after_s"].(float64); int(got) != n {
		t.Fatalf("retry_after_s = %v, header = %d", body["retry_after_s"], n)
	}
	// A 429 must still carry the common headers, or a client cache could store it.
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("429 lost Cache-Control: %q", w.Header().Get("Cache-Control"))
	}
}

// Health is the monitoring path: it must answer even when the bucket is empty.
func TestHealthIsNeverRateLimited(t *testing.T) {
	h := limitedHandler(t, 60, 1)

	call(h, "/api/config", loopback, nil) // drain the only token
	if w := call(h, "/api/config", loopback, nil); w.Code != http.StatusTooManyRequests {
		t.Fatalf("setup: second config = %d, want 429", w.Code)
	}
	for i := 0; i < 20; i++ {
		if w := call(h, "/api/health", loopback, nil); w.Code != http.StatusOK {
			t.Fatalf("health #%d = %d, want 200", i+1, w.Code)
		}
		if w := call(h, "/health", loopback, nil); w.Code == http.StatusTooManyRequests {
			t.Fatalf("bare /health #%d was rate limited", i+1)
		}
	}
}

// Two clients behind the same proxy must not share a bucket.
func TestRateLimitIsPerForwardedIP(t *testing.T) {
	h := limitedHandler(t, 60, 1)

	first := map[string]string{"X-Real-IP": "198.51.100.7"}
	second := map[string]string{"X-Real-IP": "203.0.113.8"}

	if w := call(h, "/api/status", loopback, first); w.Code != http.StatusOK {
		t.Fatalf("first client = %d, want 200", w.Code)
	}
	if w := call(h, "/api/status", loopback, first); w.Code != http.StatusTooManyRequests {
		t.Fatalf("first client repeat = %d, want 429", w.Code)
	}
	if w := call(h, "/api/status", loopback, second); w.Code != http.StatusOK {
		t.Fatalf("second client = %d, want 200 (shared bucket)", w.Code)
	}
}

// X-Real-IP from a direct, non-private peer is a spoofing attempt and must be
// ignored: the limit has to keep counting that peer.
func TestRateLimitIgnoresForgedHeaderFromPublicPeer(t *testing.T) {
	h := limitedHandler(t, 60, 1)

	if w := call(h, "/api/config", "203.0.113.9:4000", map[string]string{"X-Real-IP": "10.1.1.1"}); w.Code != http.StatusOK {
		t.Fatalf("first = %d, want 200", w.Code)
	}
	w := call(h, "/api/config", "203.0.113.9:4000", map[string]string{"X-Real-IP": "10.2.2.2"})
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("second = %d, want 429 (forged header reset the bucket)", w.Code)
	}
}

// The switch has to actually switch it off.
func TestRateLimitCanBeDisabled(t *testing.T) {
	home := fixture.New(t)
	seed(t, home)
	cfg := config.Config{
		Home: home.Dir, Port: 8131, Addr: "127.0.0.1",
		Profiles: []string{"default"}, GatewayPath: home.Dir + "/gateway_state.json",
		Source: "local", TZ: "Asia/Jakarta", Title: "Agent Office",
	}
	logger := log.New(io.Discard, "", 0)
	off := api.NewServer(cfg, source.NewLocal(cfg, logger), roster.Resolver{Profiles: cfg.Profiles}, logger).Handler()

	for i := 0; i < 30; i++ {
		if w := call(off, "/api/config", loopback, nil); w.Code != http.StatusOK {
			t.Fatalf("request %d with the limit off = %d, want 200", i+1, w.Code)
		}
	}
}

// /metrics is loopback-only: the same handler answers 200 from 127.0.0.1 and
// 403 from anywhere else.
func TestMetricsOnlyFromLoopback(t *testing.T) {
	h := limitedHandler(t, 600, 10)

	ok := call(h, "/metrics", loopback, nil)
	if ok.Code != http.StatusOK {
		t.Fatalf("loopback /metrics = %d, want 200", ok.Code)
	}
	if ct := ok.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
		t.Fatalf("content-type = %q, want text/plain", ct)
	}
	body := ok.Body.String()
	for _, want := range []string{
		"office_http_requests_total",
		"office_http_request_duration_seconds_bucket",
		"office_snapshot_age_seconds",
		"office_rate_limited_total",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics body missing %q:\n%s", want, body)
		}
	}

	for _, remote := range []string{"203.0.113.9:4000", "192.168.1.5:4000", "[2001:db8::1]:4000"} {
		if w := call(h, "/metrics", remote, nil); w.Code != http.StatusForbidden {
			t.Fatalf("/metrics from %s = %d, want 403", remote, w.Code)
		}
	}
	// A proxy that forwards /metrics announces the real client: still 403.
	if w := call(h, "/metrics", loopback, map[string]string{"X-Real-IP": "203.0.113.9"}); w.Code != http.StatusForbidden {
		t.Fatalf("proxied /metrics = %d, want 403", w.Code)
	}
}

// The metrics endpoint must report what the limiter did, with a bounded label.
func TestMetricsCountRequestsAndLimiter(t *testing.T) {
	h := limitedHandler(t, 60, 1)

	call(h, "/api/config", loopback, nil)
	call(h, "/api/config", loopback, nil) // 429
	call(h, "/api/agents/default", loopback, map[string]string{"X-Real-IP": "198.51.100.4"})
	// An unknown id must not create a second series.
	call(h, "/api/agents/nobody", loopback, map[string]string{"X-Real-IP": "198.51.100.5"})

	body := call(h, "/metrics", loopback, nil).Body.String()
	for _, want := range []string{
		`office_http_requests_total{path="/api/config",status="200"} 1`,
		`office_http_requests_total{path="/api/config",status="429"} 1`,
		`office_http_requests_total{path="/api/agents/:id",status="200"} 1`,
		`office_http_requests_total{path="/api/agents/:id",status="404"} 1`,
		"office_rate_limited_total 1",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics missing %q in:\n%s", want, body)
		}
	}
	if n := strings.Count(body, `path="/api/agents/`); n != 2 {
		t.Fatalf("agent id leaked into %d series, want 2 (one per status)", n)
	}
}

// The age gauge is fed by the cached local snapshot.
func TestMetricsReportsSnapshotAge(t *testing.T) {
	h := limitedHandler(t, 600, 10)
	call(h, "/api/status", loopback, nil) // build the cache

	body := call(h, "/metrics", loopback, nil).Body.String()
	if strings.Contains(body, "office_snapshot_age_seconds 0.000000") {
		t.Fatalf("snapshot age stayed 0 after a status call:\n%s", body)
	}
}

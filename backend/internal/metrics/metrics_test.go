package metrics

import (
	"strings"
	"testing"
	"time"
)

func render(t *testing.T, r *Registry, age float64) string {
	t.Helper()
	var b strings.Builder
	if err := r.WriteText(&b, age); err != nil {
		t.Fatalf("WriteText: %v", err)
	}
	return b.String()
}

func TestCountersAndHistogram(t *testing.T) {
	r := New()
	r.Observe("/api/status", "200", 3*time.Millisecond)
	r.Observe("/api/status", "200", 40*time.Millisecond)
	r.Observe("/api/status", "429", 2000*time.Millisecond)
	r.IncRateLimited()

	out := render(t, r, 0.25)

	for _, want := range []string{
		`office_http_requests_total{path="/api/status",status="200"} 2`,
		`office_http_requests_total{path="/api/status",status="429"} 1`,
		`office_http_request_duration_seconds_bucket{le="0.005"} 1`,
		`office_http_request_duration_seconds_bucket{le="0.05"} 2`,
		`office_http_request_duration_seconds_bucket{le="+Inf"} 3`,
		`office_http_request_duration_seconds_count 3`,
		`office_snapshot_age_seconds 0.250000`,
		`office_rate_limited_total 1`,
		`# TYPE office_http_request_duration_seconds histogram`,
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in:\n%s", want, out)
		}
	}
	// One 2 s sample is above the last finite bucket (1 s).
	if strings.Contains(out, `office_http_request_duration_seconds_bucket{le="1"} 3`) {
		t.Fatalf("a 2s sample leaked into the le=1 bucket:\n%s", out)
	}
}

// A path with an id must already be normalized by the caller; the registry just
// keeps the series it is given, and escaping must not break the format.
func TestLabelEscaping(t *testing.T) {
	r := New()
	r.Observe(`/api/agents/"x"`, "200", time.Millisecond)
	out := render(t, r, 0)
	if !strings.Contains(out, `path="/api/agents/\"x\""`) {
		t.Fatalf("label not escaped:\n%s", out)
	}
}

// An empty registry still renders valid text with the gauge series present.
func TestEmptyRegistryIsValidText(t *testing.T) {
	out := render(t, New(), 0)
	if !strings.Contains(out, "office_snapshot_age_seconds 0.000000") {
		t.Fatalf("gauge missing:\n%s", out)
	}
	if strings.Contains(out, "office_http_requests_total{") {
		t.Fatalf("unexpected request series:\n%s", out)
	}
}

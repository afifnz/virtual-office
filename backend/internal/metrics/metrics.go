// Package metrics keeps the counters behind GET /metrics in the Prometheus
// text exposition format. Hand-rolled on purpose: stdlib only, no registry
// dependency for four metrics.
package metrics

import (
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// durationBounds is the histogram ladder in seconds (5 ms … 1 s). The +Inf
// bucket is implicit and printed from Count.
var durationBounds = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1}

type reqKey struct {
	path   string
	status string
}

// Registry collects request counters. Path must already be normalized by the
// caller: one label per id would make the series unbounded.
type Registry struct {
	mu       sync.Mutex
	requests map[reqKey]uint64
	buckets  []uint64
	sum      float64
	count    uint64
	limited  uint64
}

// New returns an empty registry.
func New() *Registry {
	return &Registry{
		requests: map[reqKey]uint64{},
		buckets:  make([]uint64, len(durationBounds)),
	}
}

// Observe records one finished request.
func (r *Registry) Observe(path, status string, d time.Duration) {
	if path == "" {
		path = "/other"
	}
	if status == "" {
		status = "200"
	}
	secs := d.Seconds()

	r.mu.Lock()
	defer r.mu.Unlock()
	r.requests[reqKey{path: path, status: status}]++
	for i, le := range durationBounds {
		if secs <= le {
			r.buckets[i]++
		}
	}
	r.sum += secs
	r.count++
}

// IncRateLimited counts a request rejected by the rate limiter.
func (r *Registry) IncRateLimited() {
	r.mu.Lock()
	r.limited++
	r.mu.Unlock()
}

// WriteText renders the registry. snapshotAge is the age of the cached office
// snapshot in seconds; sources without a cache report 0.
func (r *Registry) WriteText(w io.Writer, snapshotAge float64) error {
	r.mu.Lock()
	reqs := make(map[reqKey]uint64, len(r.requests))
	for k, v := range r.requests {
		reqs[k] = v
	}
	buckets := append([]uint64(nil), r.buckets...)
	sum, count, limited := r.sum, r.count, r.limited
	r.mu.Unlock()

	var b strings.Builder
	b.WriteString("# HELP office_http_requests_total HTTP requests by normalized path and status.\n")
	b.WriteString("# TYPE office_http_requests_total counter\n")
	keys := make([]reqKey, 0, len(reqs))
	for k := range reqs {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].path != keys[j].path {
			return keys[i].path < keys[j].path
		}
		return keys[i].status < keys[j].status
	})
	for _, k := range keys {
		fmt.Fprintf(&b, "office_http_requests_total{path=\"%s\",status=\"%s\"} %d\n",
			escapeLabel(k.path), escapeLabel(k.status), reqs[k])
	}

	b.WriteString("# HELP office_http_request_duration_seconds Request latency, all paths.\n")
	b.WriteString("# TYPE office_http_request_duration_seconds histogram\n")
	for i, le := range durationBounds {
		fmt.Fprintf(&b, "office_http_request_duration_seconds_bucket{le=\"%s\"} %d\n",
			strconv.FormatFloat(le, 'g', -1, 64), buckets[i])
	}
	fmt.Fprintf(&b, "office_http_request_duration_seconds_bucket{le=\"+Inf\"} %d\n", count)
	fmt.Fprintf(&b, "office_http_request_duration_seconds_sum %s\n", formatFloat(sum))
	fmt.Fprintf(&b, "office_http_request_duration_seconds_count %d\n", count)

	b.WriteString("# HELP office_snapshot_age_seconds Age of the cached office snapshot; 0 when the source keeps no cache.\n")
	b.WriteString("# TYPE office_snapshot_age_seconds gauge\n")
	fmt.Fprintf(&b, "office_snapshot_age_seconds %s\n", formatFloat(snapshotAge))

	b.WriteString("# HELP office_rate_limited_total Requests rejected with 429 by the per-IP rate limiter.\n")
	b.WriteString("# TYPE office_rate_limited_total counter\n")
	fmt.Fprintf(&b, "office_rate_limited_total %d\n", limited)

	_, err := io.WriteString(w, b.String())
	return err
}

func formatFloat(v float64) string {
	return strconv.FormatFloat(v, 'f', 6, 64)
}

// escapeLabel follows the text-format rules: backslash, quote and newline.
func escapeLabel(s string) string {
	if !strings.ContainsAny(s, "\\\"\n") {
		return s
	}
	r := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`)
	return r.Replace(s)
}

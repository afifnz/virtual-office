package source

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"officeapi/internal/derive"
	"officeapi/internal/roster"
)

// Remote timeouts. The office polls every 4 s, so a status call that takes
// longer than this is already stale; failing fast lets the client show its own
// "can't reach the office" state instead of hanging.
const (
	RemoteTimeout       = 6 * time.Second
	RemoteConfigTimeout = 3 * time.Second
	RemoteConfigTTL     = 30 * time.Second
)

// remote proxies another office instance. It never touches the filesystem.
type remote struct {
	base   string
	client *http.Client
	log    *log.Logger

	mu    sync.Mutex
	doc   *roster.Document
	docAt time.Time
}

// NewRemote builds an HTTP-backed source pointing at base (e.g.
// https://office.example.com). A trailing slash is tolerated.
func NewRemote(base string, logger *log.Logger) (Source, error) {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		return nil, fmt.Errorf("REMOTE_API_URL wajib diisi untuk OFFICE_SOURCE=remote")
	}
	u, err := url.Parse(base)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("REMOTE_API_URL=%q bukan URL absolut", base)
	}
	if logger == nil {
		logger = log.Default()
	}
	return &remote{
		base:   base,
		client: &http.Client{Timeout: RemoteTimeout},
		log:    logger,
	}, nil
}

func (r *remote) Kind() string { return "remote" }

func (r *remote) Home() string { return r.base }

// Snapshot GETs <base>/api/status.
func (r *remote) Snapshot(ctx context.Context, _ time.Time) (derive.Snapshot, error) {
	var snap derive.Snapshot
	ctx, cancel := context.WithTimeout(ctx, RemoteTimeout)
	defer cancel()
	if err := r.getJSON(ctx, "/api/status", &snap); err != nil {
		return derive.Snapshot{}, err
	}
	if snap.Agents == nil {
		snap.Agents = []derive.Agent{}
	}
	if snap.Feed == nil {
		snap.Feed = []derive.FeedEvent{}
	}
	if snap.Tasks == nil {
		snap.Tasks = []derive.Task{}
	}
	if snap.Comms == nil {
		snap.Comms = []derive.Comm{}
	}
	if snap.Gateway.State == "" {
		snap.Gateway.State = "unknown"
	}
	return snap, nil
}

// UpstreamConfig GETs <base>/api/config so a federated office shows the remote
// roster instead of an empty room. Cached briefly: /api/config is polled far
// less often than /api/status, but a stampede on a slow upstream is still bad.
func (r *remote) UpstreamConfig(ctx context.Context) (*roster.Document, error) {
	r.mu.Lock()
	if r.doc != nil && time.Since(r.docAt) < RemoteConfigTTL {
		doc := r.doc
		r.mu.Unlock()
		return doc, nil
	}
	r.mu.Unlock()

	var doc roster.Document
	cctx, cancel := context.WithTimeout(ctx, RemoteConfigTimeout)
	defer cancel()
	if err := r.getJSON(cctx, "/api/config", &doc); err != nil {
		return nil, err
	}
	r.mu.Lock()
	r.doc, r.docAt = &doc, time.Now()
	r.mu.Unlock()
	return &doc, nil
}

func (r *remote) getJSON(ctx context.Context, path string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := r.client.Do(req)
	if err != nil {
		return fmt.Errorf("remote %s%s: %w", r.base, path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
		return fmt.Errorf("remote %s%s: HTTP %d %s", r.base, path, resp.StatusCode,
			strings.TrimSpace(string(body)))
	}
	dec := json.NewDecoder(io.LimitReader(resp.Body, 32<<20))
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("remote %s%s: respons bukan JSON: %w", r.base, path, err)
	}
	return nil
}

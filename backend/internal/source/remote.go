package source

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"officeapi/internal/config"
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
	base string // raw, with any userinfo — only ever handed to the HTTP client
	// shown is the same URL with the userinfo stripped. Every log line, error
	// message and published field uses this one, so a token in REMOTE_API_URL
	// can never leak to a client.
	shown  string
	client *http.Client
	log    *log.Logger

	mu    sync.Mutex
	doc   *roster.Document
	docAt time.Time
}

// NewRemote builds an HTTP-backed source pointing at base (e.g.
// https://office.example.com). A trailing slash is tolerated. The URL is
// validated with the same helper config.Load uses.
func NewRemote(base string, logger *log.Logger) (Source, error) {
	base = strings.TrimSpace(base)
	if base == "" {
		return nil, fmt.Errorf("REMOTE_API_URL wajib diisi untuk OFFICE_SOURCE=remote")
	}
	clean, err := config.ValidateBaseURL(base)
	if err != nil {
		return nil, fmt.Errorf("REMOTE_API_URL: %w", err)
	}
	if logger == nil {
		logger = log.Default()
	}
	return &remote{
		base:   clean,
		shown:  config.RedactURL(clean),
		client: &http.Client{Timeout: RemoteTimeout},
		log:    logger,
	}, nil
}

func (r *remote) Kind() string { return "remote" }

// Home is the upstream URL without credentials — it is published in /api/health.
func (r *remote) Home() string { return r.shown }

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
//
// An older instance may predate /api/config. Rather than showing an empty
// office, fall back to the agent ids in its /api/status and let the local seed
// roster name them.
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
		if fallback, ferr := r.configFromStatus(ctx); ferr == nil && fallback != nil {
			r.log.Printf("warn upstream_config_fallback=status agents=%d err=%q", len(fallback.Agents), err.Error())
			r.store(fallback)
			return fallback, nil
		}
		return nil, err
	}
	r.store(&doc)
	return &doc, nil
}

func (r *remote) store(doc *roster.Document) {
	r.mu.Lock()
	r.doc, r.docAt = doc, time.Now()
	r.mu.Unlock()
}

// configFromStatus rebuilds a roster document from /api/status.agents, which
// every version of the API has published.
func (r *remote) configFromStatus(ctx context.Context) (*roster.Document, error) {
	var snap struct {
		Agents []struct {
			ID string `json:"id"`
		} `json:"agents"`
	}
	cctx, cancel := context.WithTimeout(ctx, RemoteConfigTimeout)
	defer cancel()
	if err := r.getJSON(cctx, "/api/status", &snap); err != nil {
		return nil, err
	}
	doc := &roster.Document{Agents: make([]roster.Entry, 0, len(snap.Agents))}
	for _, a := range snap.Agents {
		if a.ID == "" {
			continue
		}
		doc.Agents = append(doc.Agents, roster.Entry{ID: a.ID})
	}
	return doc, nil
}

func (r *remote) getJSON(ctx context.Context, path string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := r.client.Do(req)
	if err != nil {
		return fmt.Errorf("remote %s%s: %w", r.shown, path, redactErr(err))
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
		return fmt.Errorf("remote %s%s: HTTP %d %s", r.shown, path, resp.StatusCode,
			strings.TrimSpace(string(body)))
	}
	dec := json.NewDecoder(io.LimitReader(resp.Body, 32<<20))
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("remote %s%s: respons bukan JSON: %w", r.shown, path, err)
	}
	return nil
}

// redactErr strips the raw URL out of a transport error. *url.Error carries
// the full request URL in its message, which would undo the redaction above.
func redactErr(err error) error {
	var uerr *url.Error
	if errors.As(err, &uerr) {
		return fmt.Errorf("%s %s: %w", uerr.Op, config.RedactURL(uerr.URL), uerr.Err)
	}
	return err
}

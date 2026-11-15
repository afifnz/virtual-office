// Package api exposes the read-only HTTP surface.
//
// Data comes from a source.Source, so the handlers are identical whether the
// office is reading state.db locally or proxying another instance.
package api

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"officeapi/internal/config"
	"officeapi/internal/roster"
	"officeapi/internal/source"
)

// Version of the office API.
const Version = "2.3.0"

// Build metadata, overridden at build time with -ldflags "-X officeapi/internal/api.BuildCommit=...".
var (
	BuildCommit = "dev"
	BuildTime   = "unknown"
)

// StackID is what the health endpoint reports and what Caddy-fronted clients can check.
const StackID = "virtual-office/go+react"

// Server wires a data source and a roster to the router.
type Server struct {
	cfg     config.Config
	src     source.Source
	res     roster.Resolver
	log     *log.Logger
	started time.Time

	gz gzipCache
}

// NewServer builds the API server. res is used for /api/config; the source
// supplies /api/status.
func NewServer(cfg config.Config, src source.Source, res roster.Resolver, logger *log.Logger) *Server {
	if logger == nil {
		logger = log.Default()
	}
	return &Server{
		cfg:     cfg,
		src:     src,
		res:     res,
		log:     logger,
		started: time.Now(),
		gz:      gzipCache{entries: map[string]gzipEntry{}},
	}
}

// Handler returns the root mux (Go 1.22 method+pattern routing, stdlib only).
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/config", s.handleConfig)
	mux.HandleFunc("GET /api/status", s.handleStatus)
	mux.HandleFunc("GET /api/agents/{id}", s.handleAgent)
	mux.HandleFunc("/", s.handleRoot)
	return s.withCommon(mux)
}

func (s *Server) withCommon(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Office-Stack", StackID)
		w.Header().Set("X-Office-Commit", BuildCommit)
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		start := time.Now()
		next.ServeHTTP(w, r)
		if s.cfg.LogRequests {
			s.log.Printf("info method=%s path=%s dur_ms=%d", r.Method, r.URL.Path, time.Since(start).Milliseconds())
		}
	})
}

// rosterSet resolves the roster, inheriting the upstream roster when the source
// is a remote office and no local override names the desks.
func (s *Server) rosterSet(r *http.Request) roster.Set {
	set := s.res.Resolve()
	if up, ok := s.src.(source.Upstream); ok {
		if doc, err := up.UpstreamConfig(r.Context()); err == nil && doc != nil {
			set = s.res.Resolve(doc)
		} else if err != nil && s.cfg.LogRequests {
			s.log.Printf("warn upstream_config=%q", err.Error())
		}
	}
	return set
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, config.Build(s.cfg, s.rosterSet(r)))
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	snap, err := s.src.Snapshot(r.Context(), time.Now())
	if err != nil {
		// A federated office must not pretend the room is empty when the
		// upstream is down: say so and let the client show its error state.
		s.log.Printf("warn snapshot_failed source=%s err=%q", s.src.Kind(), err.Error())
		writeError(w, http.StatusBadGateway, "sumber data tidak bisa dibaca: "+err.Error())
		return
	}
	// Every database exists and none of them opened: an empty room here would be
	// a lie. Answer 503 so the client shows its error state instead.
	if degraded(snap.DBsChecked, snap.DBsOK, snap.DBsErr) {
		s.log.Printf("warn snapshot_degraded dbs_checked=%d dbs_err=%d failed=%v",
			snap.DBsChecked, snap.DBsErr, snap.DBsFailed)
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error":       "semua state.db gagal dibuka (" + strconv.Itoa(snap.DBsErr) + "): " + strings.Join(snap.DBsFailed, ", "),
			"degraded":    true,
			"dbs_checked": snap.DBsChecked,
			"dbs_ok":      snap.DBsOK,
			"dbs_err":     snap.DBsErr,
			"dbs_failed":  snap.DBsFailed,
		})
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

// degraded is the shared rule: databases were found, and not one opened.
func degraded(checked, ok, errs int) bool { return checked > 0 && ok == 0 && errs > 0 }

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	// Desks come from the resolved roster, so a federated office reports the
	// upstream's desks rather than 0.
	db := source.DBStatus{}
	if h, ok := s.src.(source.Health); ok {
		db = h.DBStatus(r.Context())
	}
	code := http.StatusOK
	isDegraded := db.Degraded()
	if isDegraded {
		code = http.StatusServiceUnavailable
	}
	body := map[string]any{
		"ok":            !isDegraded,
		"degraded":      isDegraded,
		"service":       "virtual-office-api",
		"stack":         StackID,
		"version":       Version,
		"commit":        BuildCommit,
		"build_time":    BuildTime,
		"now":           float64(time.Now().UnixNano()) / 1e9,
		"uptime_s":      int(time.Since(s.started).Seconds()),
		"source":        s.src.Kind(),
		"home":          s.src.Home(),
		"profiles":      len(s.rosterSet(r).IDs()),
		"bind":          s.cfg.ListenAddr(),
		"tz":            s.cfg.TZ,
		"dbs_available": db.Available,
		"dbs_checked":   db.Checked,
		"dbs_ok":        db.OK,
		"dbs_err":       db.Err,
	}
	if len(db.Failed) > 0 {
		body["dbs_failed"] = db.Failed
	}
	if isDegraded {
		s.log.Printf("warn health_degraded dbs_err=%d failed=%v", db.Err, db.Failed)
	}
	writeJSON(w, code, body)
}

func (s *Server) handleAgent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "id wajib diisi")
		return
	}
	snap, err := s.src.Snapshot(r.Context(), time.Now())
	if err != nil {
		writeError(w, http.StatusBadGateway, "sumber data tidak bisa dibaca: "+err.Error())
		return
	}
	for _, a := range snap.Agents {
		if a.ID == id {
			writeJSON(w, http.StatusOK, a)
			return
		}
	}
	writeError(w, http.StatusNotFound, "agen tidak dikenal: "+id)
}

var knownPaths = map[string]bool{"/api/health": true, "/api/status": true, "/api/config": true}

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	if knownPaths[r.URL.Path] || strings.HasPrefix(r.URL.Path, "/api/agents/") {
		w.Header().Set("Allow", "GET, OPTIONS")
		writeError(w, http.StatusMethodNotAllowed, "metode tidak didukung: "+r.Method)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" {
		writeError(w, http.StatusNotFound, "endpoint tidak ada: "+r.URL.Path)
		return
	}
	// Everything else is the built frontend when WEB_DIR is set (single-process
	// image); with no WEB_DIR the API stays API-only and Caddy serves the SPA.
	if s.cfg.WebDir == "" {
		writeError(w, http.StatusNotFound, "endpoint tidak ada: "+r.URL.Path)
		return
	}
	s.serveStatic(w, r)
}

// serveStatic serves a file from WEB_DIR. A missing *file* is a 404: returning
// index.html for a missing /assets/app.js would make the browser parse HTML as
// JavaScript. Only a navigation request (Accept: text/html) falls back to
// index.html, so client routes and ?face=… deep links survive a hard refresh.
func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request) {
	root := filepath.Clean(s.cfg.WebDir)
	rel := filepath.Clean("/" + r.URL.Path)
	if strings.Contains(rel, "..") {
		writeError(w, http.StatusNotFound, "endpoint tidak ada: "+r.URL.Path)
		return
	}
	full := filepath.Join(root, rel)
	if full != root && !strings.HasPrefix(full, root+string(os.PathSeparator)) {
		writeError(w, http.StatusNotFound, "endpoint tidak ada: "+r.URL.Path)
		return
	}
	if st, err := os.Stat(full); err == nil && !st.IsDir() {
		s.serveFile(w, r, full, st)
		return
	}
	if isAssetPath(r.URL.Path) || !acceptsHTML(r) {
		writeError(w, http.StatusNotFound, "berkas tidak ada: "+r.URL.Path)
		return
	}
	index := filepath.Join(root, "index.html")
	st, err := os.Stat(index)
	if err != nil {
		writeError(w, http.StatusNotFound, "frontend belum dibangun: "+index)
		return
	}
	s.serveFile(w, r, index, st)
}

// isAssetPath reports whether the request is for a build artefact rather than a
// client-side route. A route never has a file extension.
func isAssetPath(p string) bool {
	return strings.HasPrefix(p, "/assets/") || filepath.Ext(p) != ""
}

func acceptsHTML(r *http.Request) bool {
	accept := r.Header.Get("Accept")
	return accept == "" || strings.Contains(accept, "text/html") || strings.Contains(accept, "application/xhtml")
}

// serveFile writes one file with a cache policy and, when useful, gzip.
//
// /assets/* names carry a content hash, so they are immutable for a year; every
// other file (index.html) must be revalidated or a deploy would never reach a
// returning visitor.
func (s *Server) serveFile(w http.ResponseWriter, r *http.Request, full string, st os.FileInfo) {
	ctype := mime.TypeByExtension(filepath.Ext(full))
	if ctype == "" {
		ctype = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ctype)
	if strings.HasPrefix(r.URL.Path, "/assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	if compressible(ctype) {
		w.Header().Add("Vary", "Accept-Encoding")
		if acceptsGzip(r) {
			if data, err := s.gz.read(full, st); err == nil {
				w.Header().Set("Content-Encoding", "gzip")
				w.Header().Set("Content-Length", strconv.Itoa(len(data)))
				if r.Method == http.MethodHead {
					w.WriteHeader(http.StatusOK)
					return
				}
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(data)
				return
			}
		}
	}
	http.ServeFile(w, r, full)
}

func compressible(ctype string) bool {
	switch {
	case strings.HasPrefix(ctype, "text/"):
		return true
	case strings.Contains(ctype, "javascript"), strings.Contains(ctype, "json"),
		strings.Contains(ctype, "svg"), strings.Contains(ctype, "xml"),
		strings.Contains(ctype, "wasm"):
		return true
	}
	return false
}

func acceptsGzip(r *http.Request) bool {
	for _, enc := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		if strings.TrimSpace(strings.SplitN(enc, ";", 2)[0]) == "gzip" {
			return true
		}
	}
	return false
}

// gzipCache keeps the compressed bytes for a file until its mtime or size
// changes, so the 1 MB JS bundle is compressed once per deploy, not per request.
type gzipEntry struct {
	mod  time.Time
	size int64
	data []byte
}

type gzipCache struct {
	mu      sync.Mutex
	entries map[string]gzipEntry
}

func (c *gzipCache) read(path string, st os.FileInfo) ([]byte, error) {
	c.mu.Lock()
	if e, ok := c.entries[path]; ok && e.size == st.Size() && e.mod.Equal(st.ModTime()) {
		c.mu.Unlock()
		return e.data, nil
	}
	c.mu.Unlock()

	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	if _, err := zw.Write(raw); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	data := buf.Bytes()

	c.mu.Lock()
	if c.entries == nil {
		c.entries = map[string]gzipEntry{}
	}
	c.entries[path] = gzipEntry{mod: st.ModTime(), size: st.Size(), data: data}
	c.mu.Unlock()
	return data, nil
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

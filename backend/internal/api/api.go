// Package api exposes the read-only HTTP surface.
//
// Data comes from a source.Source, so the handlers are identical whether the
// office is reading state.db locally or proxying another instance.
package api

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"officeapi/internal/config"
	"officeapi/internal/roster"
	"officeapi/internal/source"
)

// Version of the office API.
const Version = "2.2.0"

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
	writeJSON(w, http.StatusOK, snap)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	// Desks come from the resolved roster, so a federated office reports the
	// upstream's desks rather than 0.
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"service":    "virtual-office-api",
		"stack":      StackID,
		"version":    Version,
		"commit":     BuildCommit,
		"build_time": BuildTime,
		"now":        float64(time.Now().UnixNano()) / 1e9,
		"uptime_s":   int(time.Since(s.started).Seconds()),
		"source":     s.src.Kind(),
		"home":       s.src.Home(),
		"profiles":   len(s.rosterSet(r).IDs()),
		"bind":       s.cfg.ListenAddr(),
		"tz":         s.cfg.TZ,
	})
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

// serveStatic serves a file from WEB_DIR, falling back to index.html so client
// routes (and ?face=… deep links) work on a hard refresh.
func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request) {
	root := filepath.Clean(s.cfg.WebDir)
	rel := filepath.Clean("/" + r.URL.Path)
	if strings.Contains(rel, "..") {
		writeError(w, http.StatusNotFound, "endpoint tidak ada: "+r.URL.Path)
		return
	}
	full := filepath.Join(root, rel)
	if !strings.HasPrefix(full, root) {
		writeError(w, http.StatusNotFound, "endpoint tidak ada: "+r.URL.Path)
		return
	}
	if st, err := os.Stat(full); err == nil && !st.IsDir() {
		http.ServeFile(w, r, full)
		return
	}
	index := filepath.Join(root, "index.html")
	if _, err := os.Stat(index); err != nil {
		writeError(w, http.StatusNotFound, "frontend belum dibangun: "+index)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	http.ServeFile(w, r, index)
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

// Package api exposes the read-only HTTP surface.
package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"officeapi/internal/config"
	"officeapi/internal/loader"
)

// Version of the office API.
const Version = "2.1.0"

// Build metadata, overridden at build time with -ldflags "-X officeapi/internal/api.BuildCommit=...".
var (
	BuildCommit = "dev"
	BuildTime   = "unknown"
)

// StackID is what the health endpoint reports and what Caddy-fronted clients can check.
const StackID = "virtual-office/go+react"

// Server wires the loader to the router.
type Server struct {
	cfg     config.Config
	loader  *loader.Loader
	log     *log.Logger
	started time.Time
}

// NewServer builds the API server.
func NewServer(cfg config.Config, l *loader.Loader, logger *log.Logger) *Server {
	return &Server{cfg: cfg, loader: l, log: logger, started: time.Now()}
}

// Handler returns the root mux (Go 1.22 method+pattern routing, stdlib only).
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/status", s.handleStatus)
	mux.HandleFunc("GET /api/agents/{id}", s.handleAgent)
	mux.HandleFunc("/", s.handleNotFound)
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

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	snap := s.loader.Snapshot(time.Now())
	writeJSON(w, http.StatusOK, snap)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"service":    "virtual-office-api",
		"stack":      StackID,
		"version":    Version,
		"commit":     BuildCommit,
		"build_time": BuildTime,
		"now":        float64(time.Now().UnixNano()) / 1e9,
		"uptime_s":   int(time.Since(s.started).Seconds()),
		"home":       s.loader.Home(),
		"profiles":   len(s.cfg.Profiles),
		"bind":       s.cfg.ListenAddr(),
	})
}

func (s *Server) handleAgent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "id wajib diisi")
		return
	}
	snap := s.loader.Snapshot(time.Now())
	for _, a := range snap.Agents {
		if a.ID == id {
			writeJSON(w, http.StatusOK, a)
			return
		}
	}
	writeError(w, http.StatusNotFound, "agen tidak dikenal: "+id)
}

var knownPaths = map[string]bool{"/api/health": true, "/api/status": true}

func (s *Server) handleNotFound(w http.ResponseWriter, r *http.Request) {
	// Only API paths get JSON; the static build is served by Caddy in prod.
	if knownPaths[r.URL.Path] || strings.HasPrefix(r.URL.Path, "/api/agents/") {
		w.Header().Set("Allow", "GET, OPTIONS")
		writeError(w, http.StatusMethodNotAllowed, "metode tidak didukung: "+r.Method)
		return
	}
	writeError(w, http.StatusNotFound, "endpoint tidak ada: "+r.URL.Path)
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

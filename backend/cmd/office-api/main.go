// Command office-api serves the 3D agent office data as read-only JSON.
//
// Local (default) — read a Hermes home on this machine:
//
//	HERMES_HOME=~/.hermes PORT=8131 ./office-api
//
// Remote — federate another office instance, no filesystem access:
//
//	OFFICE_SOURCE=remote REMOTE_API_URL=https://office.example.com ./office-api
//
// Every setting is an environment variable; see README.md.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"officeapi/internal/api"
	"officeapi/internal/config"
	"officeapi/internal/roster"
	"officeapi/internal/source"
)

func main() {
	logger := log.New(os.Stderr, "office-api ", log.LstdFlags|log.LUTC)

	cfg, err := config.Load()
	if err != nil {
		logger.Printf("error config=%q", err.Error())
		os.Exit(2)
	}

	// Roster overrides: inline JSON wins over the file. Missing file is fatal
	// (a typo in OFFICE_ROSTER should be visible, not silently ignored).
	fileDoc, err := roster.LoadFile(cfg.RosterPath)
	if err != nil {
		logger.Printf("error %q", err.Error())
		os.Exit(2)
	}
	var inlineDoc *roster.Document
	if cfg.RosterJSON != "" {
		inlineDoc, err = roster.ParseJSON([]byte(cfg.RosterJSON))
		if err != nil {
			logger.Printf("error OFFICE_ROSTER_JSON=%q", err.Error())
			os.Exit(2)
		}
	}
	// An id becomes a directory name under HERMES_HOME/profiles and part of a
	// SQLite DSN, so reject anything that is not ^[a-zA-Z0-9_-]+$ before use.
	for name, doc := range map[string]*roster.Document{"OFFICE_ROSTER": fileDoc, "OFFICE_ROSTER_JSON": inlineDoc} {
		if err := doc.Validate(); err != nil {
			logger.Printf("error %s=%q", name, err.Error())
			os.Exit(2)
		}
	}
	override := roster.Merge(inlineDoc, fileDoc)

	res := roster.Resolver{Profiles: cfg.Profiles}
	if override != nil {
		res.Layers = []*roster.Document{override}
	}
	set := res.Resolve()

	// The roster is the source of truth for which desks exist: a desk named in
	// an override but missing from PROFILES still gets an offline agent.
	if !cfg.IsRemote() {
		cfg.Profiles = set.IDs()
	}

	// A tz in the roster is more specific than OFFICE_TZ, so it must reach the
	// loader — otherwise the day boundary and hourly buckets silently keep the
	// old zone. An unknown zone is a configuration error, not a fallback.
	if tz := strings.TrimSpace(set.TZ); tz != "" {
		if _, err := config.LocationOf(tz); err != nil {
			logger.Printf("error roster tz=%q", tz)
			os.Exit(2)
		}
		cfg.TZ = tz
	}

	src, err := source.New(cfg, logger)
	if err != nil {
		logger.Printf("error source=%q", err.Error())
		os.Exit(2)
	}

	srv := &http.Server{
		Addr:              cfg.ListenAddr(),
		Handler:           api.NewServer(cfg, src, res, logger).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	logger.Printf("info start version=%s addr=%s source=%s home=%s desks=%d tz=%s web=%q",
		api.Version, cfg.ListenAddr(), src.Kind(), src.Home(), len(set.IDs()), cfg.TZ, cfg.WebDir)

	errCh := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		logger.Printf("error listen failed=%q", err.Error())
		os.Exit(1)
	case sig := <-stop:
		logger.Printf("info stopping signal=%s", sig.String())
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			logger.Printf("error shutdown=%q", err.Error())
		}
		logger.Printf("info stopped")
	}
}

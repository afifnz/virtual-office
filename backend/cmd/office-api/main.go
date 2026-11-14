// Command office-api serves the 3D agent office data as read-only JSON.
//
//	HERMES_HOME=/home/ubuntu/.hermes PORT=8131 ./office-api
//
// It binds to localhost only; Caddy reverse-proxies /api/* to it.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"officeapi/internal/api"
	"officeapi/internal/config"
	"officeapi/internal/loader"
)

func main() {
	logger := log.New(os.Stderr, "office-api ", log.LstdFlags|log.LUTC)
	cfg := config.Load()

	srv := &http.Server{
		Addr:              cfg.ListenAddr(),
		Handler:           api.NewServer(cfg, loader.New(cfg, logger), logger).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	logger.Printf("info start version=%s addr=%s home=%s profiles=%d", api.Version, cfg.ListenAddr(), cfg.Home, len(cfg.Profiles))

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

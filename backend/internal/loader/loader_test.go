package loader

import (
	"log"
	"os"
	"path/filepath"
	"testing"

	"officeapi/internal/config"
)

// writeGateway drops a gateway_state.json with the given raw body into a temp home.
func writeGateway(t *testing.T, body string) config.Config {
	t.Helper()
	home := t.TempDir()
	path := filepath.Join(home, "gateway_state.json")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write gateway file: %v", err)
	}
	return config.Config{Home: home, GatewayPath: path, Port: 8130}
}

func gatewayFor(t *testing.T, body string) (state, version, source string) {
	t.Helper()
	cfg := writeGateway(t, body)
	l := New(cfg, log.New(os.Stderr, "", 0))
	g := l.gateway()
	return g.State, g.Version, g.Source
}

func TestGatewayFlatShape(t *testing.T) {
	state, version, source := gatewayFor(t, `{"state":"running","version":"0.23.1","updated_at":"2026-11-14T23:14:31Z"}`)
	if state != "running" || version != "0.23.1" || source != "gateway_state.json" {
		t.Fatalf("flat: got %q %q %q", state, version, source)
	}
}

func TestGatewayNestedShape(t *testing.T) {
	// A wrapped payload must still resolve, and the wrapper must be reported.
	state, version, source := gatewayFor(t, `{"gateway":{"status":"degraded","hermes_version":"0.24.0"}}`)
	if state != "degraded" {
		t.Fatalf("nested state: got %q", state)
	}
	if version != "0.24.0" {
		t.Fatalf("nested version: got %q", version)
	}
	if source != "gateway_state.json.gateway" {
		t.Fatalf("nested source: got %q", source)
	}
}

func TestGatewayBooleanShape(t *testing.T) {
	state, _, _ := gatewayFor(t, `{"running":true,"gateway":{"state":true}}`)
	if state != "running" {
		t.Fatalf("boolean state: got %q", state)
	}
}

func TestGatewayUnknownShapeKeepsKeys(t *testing.T) {
	cfg := writeGateway(t, `{"uptime":123,"pid":4242}`)
	l := New(cfg, log.New(os.Stderr, "", 0))
	g := l.gateway()
	if g.State != "unknown" {
		t.Fatalf("unknown shape should stay unknown, got %q", g.State)
	}
	if len(g.Keys) != 2 || g.Keys[0] != "pid" || g.Keys[1] != "uptime" {
		t.Fatalf("keys not exposed sorted: %v", g.Keys)
	}
}

func TestGatewayMissingFile(t *testing.T) {
	cfg := config.Config{Home: t.TempDir(), GatewayPath: filepath.Join(t.TempDir(), "nope.json"), Port: 8130}
	l := New(cfg, log.New(os.Stderr, "", 0))
	if g := l.gateway(); g.State != "unknown" {
		t.Fatalf("missing file should be unknown, got %q", g.State)
	}
}

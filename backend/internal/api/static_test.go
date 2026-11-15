package api_test

import (
	"compress/gzip"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"officeapi/internal/config"
	"officeapi/internal/fixture"
	"officeapi/internal/roster"
)

// webDir builds a dist/ lookalike: index.html plus one hashed asset.
func webDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"index.html":         "<!doctype html><title>office</title>",
		"assets/index-a1.js": "console.log('office')\n" + strings.Repeat("// pad\n", 200),
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func webServer(t *testing.T, web string) string {
	t.Helper()
	home := fixture.New(t)
	cfg := config.Config{Home: home.Dir, Source: "local", TZ: "Asia/Jakarta", WebDir: web}
	return newConfigServer(t, cfg, roster.Resolver{Profiles: []string{"default"}}).URL
}

// A missing /assets/* file is a 404 even when the browser asks for HTML: an
// index.html served as JavaScript breaks the app with "Unexpected token '<'".
func TestStaticMissingAssetIs404(t *testing.T) {
	base := webServer(t, webDir(t))

	req, _ := http.NewRequest(http.MethodGet, base+"/assets/index-deadbeef.js", nil)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("missing asset = %d (body %q), want 404", resp.StatusCode, body)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("404 content-type = %q", ct)
	}
}

// A client route (no extension) still falls back to index.html on a hard refresh.
func TestStaticSPAFallbackForNavigation(t *testing.T) {
	base := webServer(t, webDir(t))

	req, _ := http.NewRequest(http.MethodGet, base+"/deep/link?face=dev", nil)
	req.Header.Set("Accept", "text/html")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(body), "<!doctype html>") {
		t.Fatalf("navigation fallback = %d %q", resp.StatusCode, body)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("index cache-control = %q, want no-cache", cc)
	}
}

// A non-navigation request for a missing route must not get the SPA either.
func TestStaticNoSPAFallbackForNonHTML(t *testing.T) {
	base := webServer(t, webDir(t))

	req, _ := http.NewRequest(http.MethodGet, base+"/deep/link", nil)
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("non-HTML fallback = %d, want 404", resp.StatusCode)
	}
}

// Hashed assets are immutable for a year and compressed on the wire.
func TestStaticAssetCacheAndGzip(t *testing.T) {
	web := webDir(t)
	base := webServer(t, web)
	want, err := os.ReadFile(filepath.Join(web, "assets/index-a1.js"))
	if err != nil {
		t.Fatal(err)
	}

	req, _ := http.NewRequest(http.MethodGet, base+"/assets/index-a1.js", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("code = %d", resp.StatusCode)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Fatalf("cache-control = %q", cc)
	}
	if enc := resp.Header.Get("Content-Encoding"); enc != "gzip" {
		t.Fatalf("content-encoding = %q, want gzip", enc)
	}
	if v := resp.Header.Get("Vary"); !strings.Contains(v, "Accept-Encoding") {
		t.Fatalf("vary = %q", v)
	}
	zr, err := gzip.NewReader(resp.Body)
	if err != nil {
		t.Fatalf("gzip reader: %v", err)
	}
	got, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("gunzip: %v", err)
	}
	if string(got) != string(want) {
		t.Fatalf("gzip body mismatch: %d vs %d bytes", len(got), len(want))
	}

	// Without Accept-Encoding the bytes are served as-is.
	plain, err := http.Get(base + "/assets/index-a1.js")
	if err != nil {
		t.Fatal(err)
	}
	defer plain.Body.Close()
	if enc := plain.Header.Get("Content-Encoding"); enc != "" {
		t.Fatalf("unrequested encoding = %q", enc)
	}
	raw, _ := io.ReadAll(plain.Body)
	if string(raw) != string(want) {
		t.Fatal("plain body mismatch")
	}
}

// A traversal attempt never escapes WEB_DIR.
func TestStaticRejectsTraversal(t *testing.T) {
	web := webDir(t)
	base := webServer(t, web)
	for _, p := range []string{"/../go.mod", "/assets/../../go.mod", "/%2e%2e/go.mod"} {
		resp, err := http.Get(base + p)
		if err != nil {
			t.Fatalf("GET %s: %v", p, err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode == http.StatusOK && strings.Contains(string(body), "module officeapi") {
			t.Fatalf("%s escaped WEB_DIR", p)
		}
	}
}

#!/usr/bin/env bash
# Build the Go API + the React frontend.
#
#   deploy/build.sh              build only (writes backend/bin + frontend/dist)
#   deploy/build.sh --stage DIR  also copy dist/ into DIR (e.g. a release dir)
#
# Nothing here touches systemd, Caddy or /var/www — deployment is manual and
# documented in README.md.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) STAGE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "argumen tidak dikenal: $1" >&2; exit 2 ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "butuh $1 di PATH" >&2; exit 1; }; }
need go
need npm

echo "==> Go: vet + test"
cd "$REPO/backend"
go vet ./...
go test ./...

echo "==> Go: build backend/bin/office-api"
mkdir -p bin
CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o bin/office-api ./cmd/office-api
ls -lh bin/office-api

echo "==> Frontend: npm ci + build"
cd "$REPO/frontend"
if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
npm run build
du -sh dist

if [[ -n "$STAGE" ]]; then
  echo "==> Stage dist -> $STAGE"
  mkdir -p "$STAGE"
  rsync -a --delete "$REPO/frontend/dist/" "$STAGE/"
  echo "selesai. Root Caddy sekarang bisa diarahkan ke $STAGE"
else
  echo "selesai. dist ada di $REPO/frontend/dist"
fi

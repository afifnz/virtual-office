#!/usr/bin/env bash
# Build the Go API + the React frontend.
#
#   deploy/build.sh              build only (writes backend/bin/office-api + frontend/dist)
#   deploy/build.sh --out PATH   tulis binary ke PATH (mis. deploy/office-api untuk deploy manual)
#   deploy/build.sh --stage DIR  also copy dist/ into DIR (e.g. a release dir)
#
# Nothing here touches systemd, Caddy or /var/www — deployment is manual and
# documented in README.md.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE=""
OUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT="${2:-}"; shift 2 ;;
    --stage) STAGE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "argumen tidak dikenal: $1" >&2; exit 2 ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "butuh $1 di PATH" >&2; exit 1; }; }
need go
need npm

[[ -n "$OUT" ]] || OUT="$REPO/backend/bin/office-api"

# /api/health melaporkan `commit` dari BuildCommit; tanpa ini nilainya "dev" dan
# CD tidak bisa membuktikan versi mana yang jalan.
COMMIT=$(git -C "$REPO" rev-parse --short=7 HEAD 2>/dev/null || echo dev)
BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "==> Go: vet + test"
cd "$REPO/backend"
go vet ./...
go test ./...

echo "==> Go: build $OUT (commit=$COMMIT)"
mkdir -p "$(dirname "$OUT")"
CGO_ENABLED=0 go build -trimpath \
  -ldflags "-s -w -X officeapi/internal/api.BuildCommit=$COMMIT -X officeapi/internal/api.BuildTime=$BUILD_TIME" \
  -o "$OUT" ./cmd/office-api
ls -lh "$OUT"

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

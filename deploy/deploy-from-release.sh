#!/usr/bin/env bash
# CD Agent Office — tarik artefak rilis terakhir dari GitHub lalu pasang.
#
# Alur: workflow .github/workflows/publish.yml membangun binary + bundle statis
# pada setiap push ke `main` dan menerbitkannya sebagai GitHub Release bertanda
# `deploy-<sha7>`. Skrip ini (dijalankan cron di host) membandingkan commit yang
# SEDANG berjalan di /api/health dengan tag rilis terakhir. Kalau berbeda, ia
# mengunduh artefak, memverifikasi SHA256, membackup versi sekarang ke `.prev`,
# memasang, lalu memverifikasi commit baru benar-benar aktif. Gagal di titik mana
# pun = rollback otomatis ke `.prev`.
#
# Pemakaian:
#   bash deploy/deploy-from-release.sh --dry-run   # cek saja, tanpa mengubah apa pun
#   bash deploy/deploy-from-release.sh             # deploy kalau ketinggalan
#
# Prasyarat di host:
#   - /var/www/office bisa ditulis user ini (sekali saja:
#       sudo chown -R ubuntu:www-data /var/www/office && sudo chmod -R 755 /var/www/office)
#     kalau tidak, skrip memakai `sudo -n` dan butuh aturan NOPASSWD untuk rsync.
#   - unit systemd user `virtual-office-api` sudah aktif.
set -euo pipefail

REPO="${REPO:-afifnz/virtual-office}"
HEALTH="${HEALTH:-http://127.0.0.1:8130/api/health}"
BIN="${BIN:-$HOME/.local/bin/office-api}"
WEB="${WEB:-/var/www/office}"
UNIT="${UNIT:-virtual-office-api}"
TAG_PREFIX="deploy-"
# Bisa diarahkan ke mirror/internal untuk diuji tanpa menyentuh GitHub.
RELEASES_API="${RELEASES_API:-https://api.github.com/repos/$REPO/releases/latest}"
RELEASE_BASE="${RELEASE_BASE:-https://github.com/$REPO/releases/download}"
DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "GAGAL: $*"; exit 1; }

# systemd --user butuh ini saat dijalankan dari cron
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# Satu instance saja
LOCK="${TMPDIR:-/tmp}/office-deploy-$(id -u).lock"
exec 9>"$LOCK"
flock -n 9 || { log "deploy lain sedang berjalan — keluar"; exit 0; }

# --- 1. commit yang sedang jalan -----------------------------------------
CUR=$(curl -sf -m 10 "$HEALTH" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' || true)
[[ -n "$CUR" ]] || die "tidak bisa membaca commit dari $HEALTH — API hidup?"

# --- 2. rilis terakhir ---------------------------------------------------
TAG=$(curl -sf -m 20 "$RELEASES_API" \
	| sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
[[ -n "$TAG" ]] || die "tidak bisa membaca release terakhir dari $REPO"
[[ "$TAG" == "$TAG_PREFIX"* ]] || die "release terakhir bukan artefak deploy ($TAG)"
NEW="${TAG#"$TAG_PREFIX"}"

if [[ "$CUR" == "$NEW" ]]; then
	log "sudah terbaru: $CUR"
	exit 0
fi
log "ketinggalan: berjalan $CUR, terbaru $NEW"

# --- 3. unduh + verifikasi ----------------------------------------------
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
BASE="$RELEASE_BASE/$TAG"
for f in office-api dist.tar.gz SHA256SUMS; do
	curl -sfL -m 180 "$BASE/$f" -o "$STAGE/$f" || die "unduh $f gagal"
done
(cd "$STAGE" && sha256sum -c SHA256SUMS >/dev/null) || die "checksum tidak cocok — artefak rusak"

mkdir -p "$STAGE/web"
tar -C "$STAGE/web" -xzf "$STAGE/dist.tar.gz"
[[ -f "$STAGE/web/index.html" ]] || die "dist.tar.gz tidak berisi index.html"
[[ -x "$STAGE/office-api" || -f "$STAGE/office-api" ]] || die "binary office-api kosong"

if [[ $DRY -eq 1 ]]; then
	log "dry-run: akan memasang $NEW"
	log "  binary : $STAGE/office-api -> $BIN"
	log "  statis : $STAGE/web -> $WEB"
	log "  backup : $BIN.prev + $WEB.prev"
	exit 0
fi

# --- 4. siapkan akses tulis ke root statis ------------------------------
if [[ -w "$WEB" || ( ! -e "$WEB" && -w "$(dirname "$WEB")" ) ]]; then
	SUDO=""
else
	command -v sudo >/dev/null || die "$WEB tidak bisa ditulis dan sudo tidak ada"
	sudo -n true 2>/dev/null || die "$WEB tidak bisa ditulis dan sudo butuh password.
Sekali saja jalankan: sudo chown -R $(id -un):www-data $WEB && sudo chmod -R 755 $WEB"
	SUDO="sudo -n"
fi

# --- 5. backup + pasang -------------------------------------------------
mkdir -p "$(dirname "$BIN")"
[[ -f "$BIN" ]] && cp -a "$BIN" "$BIN.prev"
if [[ -d "$WEB" ]]; then
	$SUDO rm -rf "$WEB.prev"
	$SUDO cp -a "$WEB" "$WEB.prev"
fi

rollback() {
	log "ROLLBACK ke versi sebelumnya"
	systemctl --user stop "$UNIT" 2>/dev/null || true
	[[ -f "$BIN.prev" ]] && install -m 0755 "$BIN.prev" "$BIN"
	if [[ -d "$WEB.prev" ]]; then
		$SUDO rm -rf "$WEB.tmp-rollback"
		$SUDO cp -a "$WEB.prev" "$WEB.tmp-rollback"
		$SUDO rm -rf "$WEB"
		$SUDO mv "$WEB.tmp-rollback" "$WEB"
	fi
	systemctl --user start "$UNIT" 2>/dev/null || true
	log "kembali ke versi sebelumnya — deploy dibatalkan"
	exit 1
}

systemctl --user stop "$UNIT" || log "peringatan: unit $UNIT tidak berhenti bersih"
install -m 0755 "$STAGE/office-api" "$BIN"
systemctl --user start "$UNIT" || rollback
$SUDO rsync -a --delete "$STAGE/web/" "$WEB/" || rollback
if [[ -n "$SUDO" ]]; then
	$SUDO chown -R "$(id -un):www-data" "$WEB" || true
fi

# --- 6. verifikasi: commit baru benar-benar aktif -----------------------
for i in $(seq 1 15); do
	LIVE=$(curl -sf -m 5 "$HEALTH" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' || true)
	[[ "$LIVE" == "$NEW" ]] && break
	sleep 1
done

if [[ "${LIVE:-}" != "$NEW" ]]; then
	log "health masih melaporkan '${LIVE:-?}', bukan $NEW"
	rollback
fi

log "OK: $CUR -> $NEW terpasang dan terverifikasi"
log "rollback manual: install -m 0755 $BIN.prev $BIN && systemctl --user restart $UNIT"

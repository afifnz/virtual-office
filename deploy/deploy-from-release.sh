#!/usr/bin/env bash
# CD Agent Office — tarik artefak rilis terakhir dari GitHub lalu pasang.
#
# Alur: workflow .github/workflows/publish.yml membangun binary + bundle statis
# pada setiap push ke `main` dan menerbitkannya sebagai GitHub Release bertanda
# `deploy-<sha7>`. Skrip ini (dijalankan cron di host) membandingkan commit yang
# SEDANG berjalan di /api/health dengan tag rilis terakhir. Kalau berbeda, ia
# mengunduh artefak, memverifikasi SHA256, membackup versi sekarang ke `.prev`,
# memasang, lalu membuktikan bahwa commit baru DAN bundle statis baru benar-benar
# live. Gagal di titik mana pun = rollback otomatis ke `.prev`.
#
# Pemakaian:
#   bash deploy/deploy-from-release.sh --dry-run   # cek saja, tanpa mengubah apa pun
#   bash deploy/deploy-from-release.sh             # deploy kalau ketinggalan
#
# Env (semua opsional):
#   REPO, HEALTH, BIN, WEB, UNIT      lokasi & nama yang dipakai produksi
#   SITE_URL                          URL yang benar-benar menyajikan isi $WEB
#                                     (default https://office.afifnurzein.my.id/).
#                                     Verifikasi statis membandingkan hash
#                                     index.html yang baru dipasang dengan yang
#                                     dikembalikan URL ini.
#   RELEASES_API, RELEASE_BASE        sumber artefak (bisa diarahkan ke mirror)
#   COMPARE_API                       dipakai untuk deteksi downgrade
#   DEPLOY_PIN                        kalau diisi, hanya commit ini yang dipasang
#
# Prasyarat di host:
#   - unit systemd user `virtual-office-api` aktif dan hidup tanpa login:
#       sudo loginctl enable-linger "$USER"
#   - /var/www DAN /var/www/office bisa ditulis user ini, karena `.prev` dibuat
#     di samping $WEB (sekali saja):
#       sudo chown -R "$USER":www-data /var/www /var/www/office
#       sudo chmod -R 755 /var/www /var/www/office
#     Kalau tidak, skrip memakai `sudo -n` dan butuh aturan NOPASSWD.
set -euo pipefail

REPO="${REPO:-afifnz/virtual-office}"
HEALTH="${HEALTH:-http://127.0.0.1:8130/api/health}"
BIN="${BIN:-$HOME/.local/bin/office-api}"
WEB="${WEB:-/var/www/office}"
UNIT="${UNIT:-virtual-office-api}"
SITE_URL="${SITE_URL:-https://office.afifnurzein.my.id/}"
TAG_PREFIX="deploy-"
# Bisa diarahkan ke mirror/internal untuk diuji tanpa menyentuh GitHub.
RELEASES_API="${RELEASES_API:-https://api.github.com/repos/$REPO/releases/latest}"
RELEASE_BASE="${RELEASE_BASE:-https://github.com/$REPO/releases/download}"
COMPARE_API="${COMPARE_API:-https://api.github.com/repos/$REPO/compare}"
DEPLOY_PIN="${DEPLOY_PIN:-}"
DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

SITE_URL="${SITE_URL%/}/"
WEB_PARENT="$(dirname "$WEB")"
SUDO=""
HAD_BIN=0
HAD_WEB=0

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
# log_err dipakai dari dalam fungsi yang stdout-nya ditangkap $( ), supaya pesan
# tidak ikut terbaca sebagai nilai.
log_err() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
warn() { log "PERINGATAN: $*"; }
die() { log "GAGAL: $*"; exit 1; }

# systemd --user butuh ini saat dijalankan dari cron
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# Satu instance saja
LOCK="${TMPDIR:-/tmp}/office-deploy-$(id -u).lock"
exec 9>"$LOCK"
flock -n 9 || { log "deploy lain sedang berjalan — keluar"; exit 0; }

# --- 0. helper -----------------------------------------------------------

# Baca `commit` dari /api/health. 200 = normal, 503 = degraded tetapi payload
# tetap membawa commit; keduanya diterima supaya instance degraded masih bisa
# di-self-heal oleh CD (dulu 503 membuat skrip buta dan berhenti selamanya).
health_commit() {
	local body code out
	body=$(mktemp) || return 1
	code=$(curl -s -m 10 -o "$body" -w '%{http_code}' "$HEALTH" 2>/dev/null || echo 000)
	out=""
	case "$code" in
	200) out=$(sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' "$body") ;;
	503)
		out=$(sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' "$body")
		[[ -n "$out" ]] && log_err "API degraded (HTTP 503) — commit tetap terbaca: $out"
		;;
	*)
		rm -f "$body"
		return 1
		;;
	esac
	rm -f "$body"
	[[ -n "$out" ]] || return 1
	printf '%s' "$out"
}

# Hash index.html yang benar-benar dikembalikan server statis. Cache-buster
# dipakai supaya CDN/proxy di depan tidak mengembalikan salinan lama.
served_hash() {
	local body code h
	body=$(mktemp) || return 1
	code=$(curl -s -m 15 -o "$body" -w '%{http_code}' "$SITE_URL?deploy-check=$NEW" 2>/dev/null || echo 000)
	case "$code" in
	2*) h=$(sha256sum "$body" | cut -d' ' -f1) ;;
	*) h="" ;;
	esac
	rm -f "$body"
	[[ -n "$h" ]] || return 1
	printf '%s' "$h"
}

# 0 = $2 (yang berjalan) memuat $1 (rilis) -> host lebih baru, jangan turunkan.
# 1 = host memang ketinggalan. 2 = tidak bisa dibandingkan (offline/rate limit).
compare_ahead() {
	local st
	st=$(curl -sf -m 20 "$COMPARE_API/$1...$2" 2>/dev/null \
		| sed -n 's/.*"status": *"\([^"]*\)".*/\1/p' | head -1) || true
	case "${st:-}" in
	ahead | identical) return 0 ;;
	behind | diverged) return 1 ;;
	*) return 2 ;;
	esac
}

# Hapus berkas/direktori milik $WEB, termasuk `.prev` lama yang bisa jadi milik
# root. Gagal tanpa sudo -> coba sudo; gagal juga -> kembalikan 1 (pemanggil
# memberi pesan yang bisa ditindaklanjuti).
web_rm_rf() {
	[[ -e "$1" ]] || return 0
	rm -rf "$1" 2>/dev/null && return 0
	if [[ -n "$SUDO" ]] && $SUDO rm -rf "$1"; then return 0; fi
	if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
		SUDO="sudo -n"
		$SUDO rm -rf "$1" && return 0
	fi
	return 1
}

rollback() {
	log "ROLLBACK: mengembalikan versi sebelumnya"
	systemctl --user stop "$UNIT" 2>/dev/null || true
	if [[ $HAD_BIN -eq 1 && -f "$BIN.prev" ]]; then
		install -m 0755 "$BIN.prev" "$BIN" || warn "gagal memasang ulang $BIN.prev"
	elif [[ $HAD_BIN -eq 0 ]]; then
		# Instalasi pertama: tidak ada versi lama. Buang binary yang gagal
		# verifikasi supaya tidak ada yang menjalankannya belakangan.
		rm -f "$BIN"
	fi
	if [[ $HAD_WEB -eq 1 && -d "$WEB.prev" ]]; then
		if web_rm_rf "$WEB.tmp-rollback" \
			&& $SUDO cp -a "$WEB.prev" "$WEB.tmp-rollback" \
			&& web_rm_rf "$WEB" \
			&& $SUDO mv "$WEB.tmp-rollback" "$WEB"; then
			:
		else
			warn "statis gagal dikembalikan dari $WEB.prev — periksa manual"
			web_rm_rf "$WEB.tmp-rollback" || true
		fi
	elif [[ $HAD_WEB -eq 0 ]]; then
		web_rm_rf "$WEB" || warn "tidak bisa menghapus $WEB (statis baru tanpa versi sebelumnya)"
	fi
	if [[ $HAD_BIN -eq 1 ]]; then
		systemctl --user start "$UNIT" || warn "unit $UNIT gagal dinyalakan setelah rollback"
		log "kembali ke versi sebelumnya — deploy dibatalkan"
	else
		# Instalasi pertama: tidak ada versi lama yang bisa dipercaya, jadi
		# jangan biarkan unit menyajikan versi yang gagal verifikasi.
		warn "tidak ada binary sebelumnya — unit $UNIT dibiarkan MATI, bukan menyajikan versi gagal-verifikasi"
	fi
	exit 1
}

# --- 1. commit yang sedang jalan -----------------------------------------
CUR=$(health_commit) || die "tidak bisa membaca commit dari $HEALTH — API hidup?"

# --- 2. rilis terakhir ---------------------------------------------------
TAG=$(curl -sf -m 20 "$RELEASES_API" \
	| sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
[[ -n "$TAG" ]] || die "tidak bisa membaca release terakhir dari $REPO"
[[ "$TAG" == "$TAG_PREFIX"* ]] || die "release terakhir bukan artefak deploy ($TAG)"
NEW="${TAG#"$TAG_PREFIX"}"

if [[ "$CUR" == "$NEW" ]]; then
	log "sudah terbaru: $CUR"
	# Sanity read-only: commit baru tetapi statis tersaji masih beda berarti CD
	# sebelumnya tidak tuntas. Hanya peringatan, tidak menyentuh apa pun.
	if [[ -f "$WEB/index.html" ]]; then
		WANT_UP=$(sha256sum "$WEB/index.html" | cut -d' ' -f1)
		GOT_UP=$(served_hash || true)
		if [[ -n "$GOT_UP" && "$GOT_UP" != "$WANT_UP" ]]; then
			warn "statis yang disajikan $SITE_URL berbeda dari $WEB/index.html — periksa SITE_URL/Caddy"
		fi
	fi
	exit 0
fi
log "ketinggalan: berjalan $CUR, terbaru $NEW"

# --- 3. guard downgrade --------------------------------------------------
# Host bisa saja menjalankan commit yang lebih baru dari rilis terakhir
# (hotfix manual). Tanpa guard, cron akan men-downgrade dalam ≤5 menit.
if [[ -n "$DEPLOY_PIN" ]]; then
	PIN="${DEPLOY_PIN#deploy-}"
	if [[ "$NEW" != "$PIN"* && "$PIN" != "$NEW"* ]]; then
		warn "DEPLOY_PIN=$DEPLOY_PIN aktif — rilis $NEW tidak dipasang (pin dihormati)"
		exit 0
	fi
fi
RC=0
compare_ahead "$NEW" "$CUR" || RC=$?
if [[ $RC -eq 0 ]]; then
	warn "host menjalankan $CUR yang memuat rilis $NEW (lebih baru) — dilewati, TIDAK men-downgrade"
	exit 0
fi
if [[ $RC -eq 2 ]]; then
	warn "tidak bisa membandingkan $NEW..$CUR — anggap ketinggalan dan lanjut"
fi

# --- 4. unduh + verifikasi ----------------------------------------------
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
	log "  backup : $BIN.prev + $WEB.prev (kalau ada versi sekarang)"
	log "  verifikasi: commit di $HEALTH DAN hash $SITE_URL == index.html baru"
	exit 0
fi

# --- 5. siapkan akses tulis ke root statis ------------------------------
# `.prev` dan `.tmp-rollback` dibuat/dihapus di $WEB_PARENT, jadi yang harus
# bisa ditulis adalah $WEB **dan** parent-nya — bukan $WEB saja. Ini yang dulu
# bikin `cp -a /var/www/office /var/www/office.prev` gagal Permission denied
# walau /var/www/office sendiri milik user.
NEED_SUDO=0
# $WEB boleh belum ada (instalasi pertama) — yang penting parent-nya bisa ditulis.
if [[ -e "$WEB" && ! -w "$WEB" ]]; then NEED_SUDO=1; fi
[[ -w "$WEB_PARENT" ]] || NEED_SUDO=1
if [[ -e "$WEB.prev" && ! -w "$WEB.prev" ]]; then NEED_SUDO=1; fi

if [[ $NEED_SUDO -eq 1 ]]; then
	command -v sudo >/dev/null 2>&1 || die "$WEB_PARENT/$WEB tidak bisa ditulis dan sudo tidak ada.
Sekali saja jalankan:
  sudo chown -R $(id -un):www-data $WEB_PARENT $WEB && sudo chmod -R 755 $WEB_PARENT $WEB"
	sudo -n true 2>/dev/null || die "$WEB_PARENT tidak bisa ditulis user ini, jadi $WEB.prev tidak bisa dibuat/dihapus, dan sudo -n tidak tersedia (butuh password).
Sekali saja jalankan:
  sudo chown -R $(id -un):www-data $WEB_PARENT $WEB && sudo chmod -R 755 $WEB_PARENT $WEB
atau beri aturan sudoers NOPASSWD untuk rsync/cp/rm/mv/chown pada $WEB_PARENT."
	SUDO="sudo -n"
fi

# --- 6. backup + pasang -------------------------------------------------
BIN_DIR="$(dirname "$BIN")"
mkdir -p "$BIN_DIR"
[[ -w "$BIN_DIR" ]] || die "$BIN_DIR tidak bisa ditulis — install binary akan gagal"

if [[ -f "$BIN" ]]; then
	cp -a "$BIN" "$BIN.prev" || die "gagal membackup $BIN ke $BIN.prev"
	HAD_BIN=1
fi
if [[ -d "$WEB" ]]; then
	web_rm_rf "$WEB.prev" || die "tidak bisa menghapus $WEB.prev lama (milik root?).
Jalankan sekali: sudo rm -rf $WEB.prev"
	$SUDO cp -a "$WEB" "$WEB.prev" || die "gagal membackup $WEB ke $WEB.prev (akses tulis $WEB_PARENT?)"
	HAD_WEB=1
fi

systemctl --user stop "$UNIT" || die "unit $UNIT tidak mau berhenti — binary yang sedang jalan tidak akan tertimpa; deploy dibatalkan (versi lama tetap melayani)"
install -m 0755 "$STAGE/office-api" "$BIN" || rollback
systemctl --user start "$UNIT" || rollback
$SUDO rsync -a --delete "$STAGE/web/" "$WEB/" || rollback
if [[ -n "$SUDO" ]]; then
	$SUDO chown -R "$(id -un):www-data" "$WEB" 2>/dev/null || true
fi

# --- 7. verifikasi: commit baru benar-benar aktif -----------------------
LIVE=""
for i in $(seq 1 15); do
	LIVE=$(health_commit 2>/dev/null || true)
	[[ "$LIVE" == "$NEW" ]] && break
	sleep 1
done
if [[ "${LIVE:-}" != "$NEW" ]]; then
	log "health masih melaporkan '${LIVE:-?}', bukan $NEW"
	rollback
fi

# --- 8. verifikasi: statis yang disajikan benar-benar bundle baru -------
# rsync bisa "sukses" sementara Caddy menyajikan direktori lain (WEB salah,
# mount, atau root Caddy beda). Tanpa cek ini skrip mencetak OK padahal situs
# masih bundle lama.
WANT=$(sha256sum "$WEB/index.html" 2>/dev/null | cut -d' ' -f1 || true)
STAGED=$(sha256sum "$STAGE/web/index.html" | cut -d' ' -f1)
if [[ -z "$WANT" ]]; then
	log "index.html tidak ada di $WEB setelah rsync"
	rollback
fi
if [[ "$WANT" != "$STAGED" ]]; then
	log "rsync tidak memasang index.html baru di $WEB (harap $STAGED, ada $WANT)"
	rollback
fi

GOT=""
for i in $(seq 1 5); do
	GOT=$(served_hash || true)
	[[ "$GOT" == "$WANT" ]] && break
	sleep 1
done
if [[ "$GOT" != "$WANT" ]]; then
	log "statis yang disajikan $SITE_URL bukan bundle baru (harap $WANT, dapat ${GOT:-gagal-fetch})"
	rollback
fi

log "OK: $CUR -> $NEW terpasang dan terverifikasi (binary + statis $SITE_URL)"
log "rollback manual: install -m 0755 $BIN.prev $BIN && systemctl --user restart $UNIT"

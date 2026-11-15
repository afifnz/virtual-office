#!/usr/bin/env bash
# Pasang header keamanan + aturan cache ke site block Caddy untuk Agent Office.
#
# Kenapa ada skrip ini: `deploy/Caddyfile.block` berisi header yang benar, tetapi
# produksi tidak pernah memakainya — akibatnya HTML dikirim tanpa Cache-Control
# (browser menyajikan bundle lama setelah deploy) dan tanpa header keamanan.
#
# Sifat skrip: idempoten, menyentuh HANYA satu site block, selalu backup dulu,
# dan otomatis rollback kalau `caddy validate` atau verifikasi header gagal.
#
# Pemakaian (di host, butuh sudo):
#   bash deploy/apply-caddy-headers.sh --dry-run   # lihat rencananya saja
#   bash deploy/apply-caddy-headers.sh             # pasang
set -euo pipefail

SITE="${SITE:-office.afifnurzein.my.id}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

say() { printf '%s\n' "$*"; }
die() { printf 'GAGAL: %s\n' "$*" >&2; exit 1; }

[[ -f "$CADDYFILE" ]] || die "Caddyfile tidak ada di $CADDYFILE (set CADDYFILE=...)"
command -v caddy >/dev/null || die "binary caddy tidak ditemukan"

if [[ $DRY_RUN -eq 0 && $EUID -ne 0 ]]; then
	die "jalankan dengan sudo (butuh tulis $CADDYFILE + reload caddy)"
fi

# --- 1. temukan site block ------------------------------------------------
START=$(awk -v s="$SITE" 'index($0, s) && /\{/ { print NR; exit }' "$CADDYFILE" || true)
[[ -n "${START:-}" ]] || die "site block '$SITE' tidak ditemukan di $CADDYFILE"

say "site block '$SITE' mulai di baris $START"

# --- 2. pastikan layout produksi, bukan layout lama ----------------------
BLOCK=$(awk -v start="$START" '
	NR >= start { print }
	NR > start && /^}/ { exit }
' "$CADDYFILE")

if ! grep -q 'reverse_proxy 127\.0\.0\.1:8130' <<<"$BLOCK"; then
	say ""
	say "PERINGATAN: site block ini tidak mem-proxy ke 127.0.0.1:8130."
	say "Baris reverse_proxy yang ditemukan:"
	grep -n 'reverse_proxy' <<<"$BLOCK" || say "  (tidak ada)"
	die "samakan dulu target API (lihat deploy/Caddyfile.block), lalu jalankan ulang"
fi

if ! grep -q 'root \* /var/www/office$' <<<"$BLOCK"; then
	say ""
	say "PERINGATAN: root statis bukan /var/www/office."
	grep -n 'root \*' <<<"$BLOCK" || say "  (tidak ada)"
	die "samakan dulu root statis (lihat deploy/Caddyfile.block), lalu jalankan ulang"
fi

# --- 3. sudah terpasang? --------------------------------------------------
if grep -q 'Cache-Control "no-cache"' <<<"$BLOCK" && grep -q 'X-Content-Type-Options' <<<"$BLOCK"; then
	say "Header sudah terpasang di site block ini — tidak ada yang diubah."
	say ""
	say "Header yang terlihat dari luar:"
	curl -sI "https://$SITE/" | grep -iE 'cache-control|content-security|x-content-type|referrer|permissions' || say "  (kosong — cek ulang setelah reload)"
	exit 0
fi

# --- 4. siapkan sisipan ---------------------------------------------------
SNIPPET=$(cat <<'EOF'

	# --- ditambahkan oleh deploy/apply-caddy-headers.sh -------------------
	header {
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		X-Frame-Options DENY
		Permissions-Policy "geolocation=(), microphone=(), camera=(), payment=()"
		Cross-Origin-Opener-Policy same-origin
		Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
		-Server
	}

	@assets path /assets/*
	header @assets Cache-Control "public, max-age=31536000, immutable"
	@shell path / /index.html
	header @shell Cache-Control "no-cache"
	# --- akhir sisipan ----------------------------------------------------
EOF
)

if [[ $DRY_RUN -eq 1 ]]; then
	say ""
	say "RENCANA (dry-run, tidak ada yang ditulis):"
	say "  backup   : $CADDYFILE.bak-$(date +%Y%m%d%H%M%S)"
	say "  sisipkan : setelah baris $START"
	say "  validasi : caddy validate --config $CADDYFILE"
	say "  reload   : systemctl reload caddy"
	say ""
	say "Sisipan:"
	printf '%s\n' "$SNIPPET"
	exit 0
fi

# --- 5. backup, sisipkan, validasi ---------------------------------------
BACKUP="$CADDYFILE.bak-$(date +%Y%m%d%H%M%S)"
cp -a "$CADDYFILE" "$BACKUP"
say "backup: $BACKUP"

TMP=$(mktemp)
awk -v start="$START" -v snippet="$SNIPPET" '
	{ print }
	NR == start { printf "%s\n", snippet }
' "$CADDYFILE" >"$TMP"

rollback() {
	say "ROLLBACK: mengembalikan $BACKUP"
	cp -a "$BACKUP" "$CADDYFILE"
	caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1 || true
	systemctl reload caddy 2>/dev/null || true
	rm -f "$TMP"
	exit 1
}

install -m 0644 "$TMP" "$CADDYFILE"
rm -f "$TMP"

if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >/tmp/caddy-validate.log 2>&1; then
	say "caddy validate menolak konfigurasi baru:"
	tail -5 /tmp/caddy-validate.log
	rollback
fi
say "caddy validate: OK"

systemctl reload caddy || rollback
say "caddy reload: OK"

# --- 6. verifikasi dari luar ---------------------------------------------
sleep 1
H=$(curl -sI "https://$SITE/" || true)
echo "$H" | grep -qi 'cache-control: no-cache' || { say "HTML tidak dapat Cache-Control: no-cache"; say "$H"; rollback; }
echo "$H" | grep -qi 'x-content-type-options' || { say "header keamanan tidak muncul"; say "$H"; rollback; }

say ""
say "BERHASIL. Header sekarang:"
echo "$H" | grep -iE 'cache-control|content-security|x-content-type|referrer|permissions|strict-transport'
say ""
say "Rollback manual kalau perlu: sudo cp -a $BACKUP $CADDYFILE && sudo systemctl reload caddy"

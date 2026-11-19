#!/usr/bin/env bash
# Pasang header keamanan + aturan cache ke site block Caddy untuk Agent Office.
#
# Kenapa ada skrip ini: `deploy/Caddyfile.block` berisi header yang benar, tetapi
# produksi tidak pernah memakainya — akibatnya HTML dikirim tanpa Cache-Control
# (browser menyajikan bundle lama setelah deploy) dan tanpa header keamanan.
#
# Sifat skrip: idempoten, menyentuh HANYA satu site block, selalu backup dulu,
# dan otomatis rollback kalau `caddy validate`, reload, atau verifikasi gagal.
#
# Yang disisipkan (masing-masing hanya kalau belum ada):
#   - satu blok `header { ... }` berisi header keamanan + CSP
#   - matcher aset ber-hash  -> Cache-Control immutable
#   - matcher "bukan aset"   -> Cache-Control no-cache (termasuk deep-link SPA)
#
# Pemakaian (di host, butuh sudo):
#   bash deploy/apply-caddy-headers.sh --dry-run   # lihat rencananya saja
#   bash deploy/apply-caddy-headers.sh             # pasang
#
# Env: SITE (alamat situs), CADDYFILE, PUBLIC_URL (default https://$SITE).
set -euo pipefail

SITE="${SITE:-office.afifnurzein.my.id}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
PUBLIC_URL="${PUBLIC_URL:-https://$SITE}"
DRY_RUN=0

for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY_RUN=1 ;;
		-h | --help)
			sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
			exit 0
			;;
		*)
			printf 'argumen tidak dikenal: %s\n' "$arg" >&2
			exit 2
			;;
	esac
done

say() { printf '%s\n' "$*"; }
die() { printf 'GAGAL: %s\n' "$*" >&2; exit 1; }

[[ -f "$CADDYFILE" ]] || die "Caddyfile tidak ada di $CADDYFILE (set CADDYFILE=...)"
command -v caddy >/dev/null || die "binary caddy tidak ditemukan"
command -v curl >/dev/null || die "curl tidak ditemukan (dipakai untuk verifikasi)"

if [[ $DRY_RUN -eq 0 && $EUID -ne 0 ]]; then
	die "jalankan dengan sudo (butuh tulis $CADDYFILE + reload caddy)"
fi

# --- 1. temukan site block ------------------------------------------------
# Alamat situs dan `{` boleh di baris yang sama, boleh di baris berikutnya
# (dua-duanya Caddyfile sah). Baris komentar penuh tidak dihitung.
START=$(awk -v s="$SITE" '
	!addr && $0 !~ /^[[:space:]]*#/ && index($0, s) { addr = NR }
	addr && index($0, "{") { print addr; exit }
' "$CADDYFILE")
[[ -n "${START:-}" ]] || die "site block '$SITE' tidak ditemukan di $CADDYFILE"

# Baris `{` pembuka — sisipan HARUS setelah baris ini, bukan setelah alamat.
BRACE=$(awk -v start="$START" 'NR >= start && index($0, "{") { print NR; exit }' "$CADDYFILE")
[[ -n "${BRACE:-}" ]] || die "kurung buka '{' untuk '$SITE' tidak ditemukan"

say "site block '$SITE' mulai di baris $START (kurung buka: baris $BRACE)"

# --- 2. pastikan layout produksi, bukan layout lama ----------------------
BLOCK=$(awk -v start="$START" '
	NR >= start { print }
	NR > start && /^}[[:space:]]*$/ { exit }
' "$CADDYFILE")

# --- 2. catat layout produksi — peringatan, bukan penghalang ---------------
# Target proxy dan root bisa berbeda antar pemasangan (8130 vs 8131, office vs
# office-v2). Yang penting header terpasang; perbedaan layout hanya dicatat.
TARGET=$(grep -oE 'reverse_proxy[[:space:]]+[0-9.]+:[0-9]+' <<<"$BLOCK" | head -1 | sed -E 's/reverse_proxy[[:space:]]+//')
if [[ -z "${TARGET:-}" ]]; then
	say ""
	say "PERINGATAN: site block ini tidak mem-proxy ke API sama sekali."
	grep -n 'reverse_proxy' <<<"$BLOCK" || say "  (tidak ada)"
	die "tambahkan handle /api/* -> reverse_proxy dulu, baru pasang header"
fi
say "proxy API ditemukan : $TARGET"
if [[ "$TARGET" != "127.0.0.1:8130" ]]; then
	say "  catatan           : produksi memakai $TARGET (rujukan repo: 8130)."
	say "                      Header tetap dipasang; samakan hanya bila memang perlu."
fi

ROOT_DIR=$(grep -oE 'root[[:space:]]+\*[[:space:]]+[^[:space:]]+' <<<"$BLOCK" | head -1 | awk '{print $3}')
if [[ -z "${ROOT_DIR:-}" ]]; then
	say "PERINGATAN: site block tidak punya 'root *' — pastikan SPA memang disajikan di sini."
else
	say "root statis         : $ROOT_DIR"
	[[ "$ROOT_DIR" != "/var/www/office" ]] && say "  catatan           : root produksi bukan /var/www/office."
fi

# --- 3. apa saja yang belum ada? -----------------------------------------
# Guard "sudah terpasang" TIDAK boleh puas dengan dua string generik: blok lama
# di repo ini sendiri sudah punya X-Content-Type-Options + Cache-Control no-cache
# (lewat @index) tetapi tanpa CSP sama sekali. Syaratnya: CSP dan X-Frame-Options
# DENY harus benar-benar ada.
HAVE_CSP=0 HAVE_XFO=0
grep -q 'Content-Security-Policy' <<<"$BLOCK" && HAVE_CSP=1
grep -qE 'X-Frame-Options[[:space:]]+DENY' <<<"$BLOCK" && HAVE_XFO=1

free_matcher() { # $1 = nama yang diinginkan; kembalikan nama yang belum dipakai
	local base="$1" name="$1" i=2
	while grep -qE "^[[:space:]]*${name}[[:space:]]" <<<"$BLOCK"; do
		name="${base}_$i"
		i=$((i + 1))
	done
	printf '%s' "$name"
}

# Aset: pakai matcher yang sudah ada kalau bentuknya memang path /assets/*,
# supaya tidak ada matcher ganda (@assets dua kali = caddy validate menolak).
ASSETS_NAME="" ASSETS_DEFINE=0
if ! grep -q 'max-age=31536000, immutable' <<<"$BLOCK"; then
	if existing=$(sed -nE 's/^[[:space:]]*(@[A-Za-z0-9_]+)[[:space:]]+path[[:space:]]+\/assets\/\*.*/\1/p' <<<"$BLOCK" | head -1) && [[ -n "$existing" ]]; then
		ASSETS_NAME="$existing" # sisipkan header saja, matcher dipakai ulang
	else
		ASSETS_NAME=$(free_matcher @assets)
		ASSETS_DEFINE=1
	fi
fi

# Shell: yang dianggap lengkap adalah matcher yang menutup SEMUA path non-aset
# (`not path /assets/*`), bukan `path / /index.html` — deep-link SPA (/foo) juga
# harus dapat no-cache, karena try_files menyajikan index.html untuk path itu.
SHELL_NAME="" SHELL_DEFINE=0
SHELL_COMPLETE=0
if grep -q 'Cache-Control "no-cache"' <<<"$BLOCK" &&
	grep -qE '^[[:space:]]*@[A-Za-z0-9_]+[[:space:]]+not[[:space:]]+path[[:space:]]+/assets/\*' <<<"$BLOCK"; then
	SHELL_COMPLETE=1
fi
if [[ $SHELL_COMPLETE -eq 0 ]]; then
	if existing=$(sed -nE 's/^[[:space:]]*(@[A-Za-z0-9_]+)[[:space:]]+not[[:space:]]+path[[:space:]]+\/assets\/\*.*/\1/p' <<<"$BLOCK" | head -1) && [[ -n "$existing" ]]; then
		SHELL_NAME="$existing" # matcher sudah ada, header-nya yang belum
	else
		SHELL_NAME=$(free_matcher @shell)
		SHELL_DEFINE=1
	fi
fi

if [[ $HAVE_CSP -eq 1 && $HAVE_XFO -eq 1 && -z "$ASSETS_NAME" && -z "$SHELL_NAME" ]]; then
	say "Header sudah terpasang di site block ini — tidak ada yang diubah."
	say ""
	say "Header yang terlihat dari luar:"
	curl -sI -m 10 --retry 2 --retry-delay 1 "$PUBLIC_URL/" |
		grep -iE 'cache-control|content-security|x-content-type|referrer|permissions|x-frame' ||
		say "  (kosong — cek ulang setelah reload)"
	exit 0
fi

# --- 4. siapkan sisipan ---------------------------------------------------
SNIPPET=""
addline() {
	if [[ -z "${1:-}" ]]; then
		SNIPPET+=$'\n'
	else
		SNIPPET+=$'\t'"$1"$'\n'
	fi
}

if [[ $HAVE_CSP -eq 0 || $HAVE_XFO -eq 0 ]]; then
	addline ""
	addline "# --- ditambahkan oleh deploy/apply-caddy-headers.sh -------------------"
	addline "header {"
	addline $'\tX-Content-Type-Options nosniff'
	addline $'\tReferrer-Policy no-referrer'
	addline $'\tX-Frame-Options DENY'
	addline $'\tPermissions-Policy "geolocation=(), microphone=(), camera=(), payment=()"'
	addline $'\tCross-Origin-Opener-Policy same-origin'
	addline $'\tContent-Security-Policy "default-src \'self\'; script-src \'self\' \'wasm-unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; font-src \'self\'; connect-src \'self\'; object-src \'none\'; base-uri \'none\'; frame-ancestors \'none\'; form-action \'none\'"'
	addline $'\t-Server'
	addline "}"
fi

if [[ -n "$ASSETS_NAME" ]]; then
	addline ""
	addline "# --- cache: aset ber-hash boleh immutable -----------------------------"
	[[ $ASSETS_DEFINE -eq 1 ]] && addline "$ASSETS_NAME path /assets/*"
	addline "header $ASSETS_NAME Cache-Control \"public, max-age=31536000, immutable\""
fi

if [[ -n "$SHELL_NAME" ]]; then
	addline ""
	addline "# --- cache: shell HTML + deep-link SPA, kecuali aset dan API ----------"
	# /api/* dikecualikan: handler Go sudah mengirim `Cache-Control: no-store`,
	# dan header di sini akan menimpanya.
	[[ $SHELL_DEFINE -eq 1 ]] && addline "$SHELL_NAME not path /assets/* /api/*"
	addline "header $SHELL_NAME Cache-Control \"no-cache\""
fi

if [[ $DRY_RUN -eq 1 ]]; then
	say ""
	say "RENCANA (dry-run, tidak ada yang ditulis):"
	say "  backup   : $CADDYFILE.bak-$(date +%Y%m%d%H%M%S)"
	say "  sisipkan : setelah baris $BRACE (di dalam site block)"
	say "  validasi : caddy validate --config $CADDYFILE"
	say "  reload   : systemctl reload caddy"
	say "  verifikasi: curl -sI $PUBLIC_URL/"
	say ""
	say "Sisipan:"
	printf '%s' "$SNIPPET"
	exit 0
fi

# --- 5. backup, sisipkan, validasi ---------------------------------------
BACKUP="$CADDYFILE.bak-$(date +%Y%m%d%H%M%S)"
cp -a "$CADDYFILE" "$BACKUP"
say "backup: $BACKUP"

TMP=$(mktemp)
LOG=$(mktemp)
trap 'rm -f "$TMP" "$LOG"' EXIT

awk -v at="$BRACE" -v snippet="$SNIPPET" '
	{ print }
	NR == at { printf "%s", snippet }
' "$CADDYFILE" >"$TMP"

rollback() {
	say "ROLLBACK: mengembalikan $BACKUP"
	# `cat >` menulis ke inode yang sama, jadi mode + owner asli
	# (mis. 0640 root:caddy) tidak berubah — beda dengan `install -m`.
	cat "$BACKUP" >"$CADDYFILE"
	caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1 || true
	systemctl reload caddy 2>/dev/null || true
	exit 1
}

# Jangan `install -m 0644`: itu melebarkan izin dan mengganti owner.
cat "$TMP" >"$CADDYFILE"

if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >"$LOG" 2>&1; then
	say "caddy validate menolak konfigurasi baru:"
	tail -5 "$LOG"
	rollback
fi
say "caddy validate: OK"

systemctl reload caddy || rollback
say "caddy reload: OK"

# --- 6. verifikasi dari luar ---------------------------------------------
sleep 1
H=$(curl -sI -m 10 --retry 2 --retry-delay 1 "$PUBLIC_URL/" || true)
echo "$H" | grep -qi 'cache-control: no-cache' || {
	say "HTML tidak dapat Cache-Control: no-cache"
	say "$H"
	rollback
}
echo "$H" | grep -qi 'content-security-policy' || {
	say "CSP tidak muncul di respons"
	say "$H"
	rollback
}
echo "$H" | grep -qi 'x-frame-options: deny' || {
	say "X-Frame-Options DENY tidak muncul di respons"
	say "$H"
	rollback
}
echo "$H" | grep -qi 'x-content-type-options' || {
	say "header keamanan tidak muncul"
	say "$H"
	rollback
}

# Deep-link: tidak fatal (situs tanpa fallback SPA akan 404), tapi harus dilaporkan.
D=$(curl -sI -m 10 --retry 2 --retry-delay 1 "$PUBLIC_URL/some/deep/path" || true)
if echo "$D" | grep -qi 'cache-control: no-cache'; then
	say "deep-link: OK (Cache-Control: no-cache)"
else
	say "PERINGATAN: deep-link /some/deep/path tidak dapat Cache-Control: no-cache"
fi

say ""
say "BERHASIL. Header sekarang:"
echo "$H" | grep -iE 'cache-control|content-security|x-content-type|referrer|permissions|x-frame|strict-transport'
say ""
say "Rollback manual kalau perlu: sudo cat $BACKUP > $CADDYFILE && sudo systemctl reload caddy"

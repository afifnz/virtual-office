# Agent Office — kantor virtual 2D pixel-art (React + Go)

Kantor virtual tempat 13 profil Hermes punya meja sendiri, digambar sebagai
diorama pixel-art top-down di satu `<canvas>` 2D: sprite, font, dan palet
seluruhnya prosedural (tanpa file aset, tanpa WebGL). API Go read-only membaca
`state.db` Hermes; kontrak `/api/config` & `/api/status` tidak berubah.

```
backend/   API Go (net/http, modernc.org/sqlite, tanpa cgo)
frontend/  React 18 + Vite + TypeScript + canvas 2D (tanpa three.js)
  src/scene2d/  renderer, sprite, label, pixel font, animasi, viewport
deploy/    systemd unit, blok Caddy, build script, pembuat fixture
verify/    check murni (roster/layout/anim/visual) + probe browser + e2e
docs/      rencana (plans/), spec UI/UX (design/), atribusi, riset
```

Asal-usul gaya (dan lisensinya) dicatat di
[`docs/attribution-2d.md`](docs/attribution-2d.md): tidak ada kode, sprite, atau
aset pihak ketiga yang disalin.

> **Agen otomatis / AI coding tools:** baca [`AGENTS.md`](AGENTS.md) sebelum bekerja —
> di situ ada aturan wajib (privasi metadata-only, kontrak API, larangan menulis ke `state.db`),
> alur branch → PR → review, definisi "selesai", prosedur deploy/rollback, dan daftar jebakan
> yang sudah pernah menggigit. `CLAUDE.md` hanya penunjuk ke berkas yang sama.

## Isi ruangan

| Ruang | Agen |
|---|---|
| **Pendopo** (depan, z > 4) | Ndoro Kakung — `default` |
| **Ruang Tim Dev** (kiri belakang) | Bima `dev`, Raka `planner`, Laras `uiux`, Dimas `coder`, Yoga `reviewer`, Sari `tester` |
| **Ruang Tim Edu** (kanan belakang) | Ayu `edu`, Nisa `edu-designer`, Yohan `edu-writer`, Hadi `edu-reviewer` |

`id` agen = nama profil Hermes. Roster bawaan (id, nama, peran, tim) ada di
**dua** tempat yang dijaga tetap sama: `backend/internal/roster.DefaultAgents`
dan `frontend/src/lib/agents.ts`. Sebuah test Go mem-parse file TS itu dan
gagal kalau keduanya berbeda (`TestDefaultAgentsMatchFrontend`).

Saat runtime, `GET /api/config` adalah sumber kebenarannya: frontend mengambil
judul, zona waktu, daftar tim dan roster dari sana sebelum render pertama.
Roster bisa dioverride lewat `OFFICE_ROSTER`/`OFFICE_ROSTER_JSON` (lihat
[Roster dinamis](#roster-dinamis)), dan agen baru yang tidak punya meja
digambar otomatis — tanpa mengubah kode.

## Quick start

Cukup tiga langkah, tanpa mengedit kode. Butuh Docker (Compose v2) dan satu
folder Hermes (`~/.hermes` — bawaan; lewati kalau beda).

```bash
# 1. build image (Go API + frontend jadi satu proses) dan jalankan
docker compose up -d --build

# 2. pastikan kantornya sudah membaca data
curl -s localhost:8080/api/config
curl -s localhost:8080/api/status | head -c 400

# 3. buka http://localhost:8080
```

Kalau folder Hermes bukan `~/.hermes`, sebutkan sekali:

```bash
HERMES_HOME=/path/ke/.hermes docker compose up -d
```

Tanpa Docker (Go 1.23+ dan Node 20+):

```bash
# 1. API — membaca ~/.hermes, melayani :8131
cd backend && HERMES_HOME=~/.hermes go run ./cmd/office-api

# 2. frontend dev server, proxy /api ke :8131
cd ../frontend && npm ci && npm run dev

# 3. buka http://127.0.0.1:5173
```

Tanpa data Hermes sungguhan, bikin contoh dulu: `python3 deploy/make-fixture.py /tmp/hermes-demo`
lalu pakai `HERMES_HOME=/tmp/hermes-demo`. Frontend memanggil API dengan path
relatif (`/api/...`, same origin), jadi tidak ada URL yang perlu di-hardcode.

## Menjalankan di lokal

Butuh Node 20+ dan Go 1.23+.

```bash
# 1. data contoh (JANGAN untuk produksi)
python3 deploy/make-fixture.py /tmp/hermes-demo

# 2. API
cd backend
export HERMES_HOME=/tmp/hermes-demo PORT=8131
go run ./cmd/office-api           # http://127.0.0.1:8131/api/status

# 3. frontend (dev server, proxy /api -> :8131)
cd ../frontend
npm ci
npm run dev                       # http://127.0.0.1:5173
```

Build produksi:

```bash
cd backend && go build -o bin/office-api ./cmd/office-api
cd ../frontend && npm ci && npm run build     # -> frontend/dist
# atau sekaligus:
deploy/build.sh
```

## Docker (satu image, satu proses)

`Dockerfile` dua tahap: build Go (`CGO_ENABLED=0`), build frontend, lalu
menyalin keduanya ke `alpine` tanpa toolchain. Binary yang sama menyajikan
`/api/*` **dan** `frontend/dist` (`WEB_DIR=/app/web`), jadi tidak perlu Caddy
atau nginx di dalam image.

```bash
docker build -t virtual-office .
docker run --rm -p 8080:8080 \
  -v ~/.hermes:/hermes:ro \
  -e HERMES_HOME=/hermes \
  virtual-office
```

Atau `docker compose up -d --build` (lihat `docker-compose.yml`; contoh
`OFFICE_SOURCE=remote` dan mount roster ada di komentar file itu).

Catatan:

- `~/.hermes` di-mount **read-only**; kantor tidak pernah menulis ke state
  Hermes. SQLite dibuka `mode=ro`.
- Hermes menulis `state.db` dalam mode WAL, jadi saat gateway hidup ada
  `state.db-wal`/`-shm` di folder itu. Mount `:ro` tetap bisa membacanya selama
  kedua file itu ada; kalau muncul error "attempt to write a readonly
  database", lepas `:ro` (mount read-write) — API tetap tidak menulis apa pun.
- Image berjalan sebagai uid 10001. Kalau `~/.hermes` milik uid lain (biasanya
  `0700`), jalankan container sebagai diri sendiri:
  `docker run --user "$(id -u):$(id -g)" ...` (compose: `OFFICE_UID`/`OFFICE_GID`).
- Kesehatan: `curl localhost:8080/api/health`; image punya `HEALTHCHECK`.

## Deploy

Dua jalur: otomatis (rilis GitHub → host) dan manual. Keduanya idempoten dan memperlakukan
binary + statis sebagai satu kesatuan: kalau verifikasi gagal, keduanya dikembalikan dari
backup `.prev`. Backup itu dibuat **kalau memang ada versi sebelumnya** — pada instalasi
pertama tidak ada yang bisa dibackup, jadi kegagalan verifikasi berakhir dengan unit
**dimatikan** dan artefak yang gagal dibuang, bukan menyajikan versi yang belum terbukti.

**Prasyarat sekali saja di host.** CD memakai unit systemd *user*, jadi unit harus hidup
tanpa login:

```bash
sudo loginctl enable-linger "$USER"                        # unit user tetap hidup setelah logout
sudo chown -R "$USER":www-data /var/www /var/www/office    # /var/www ikut: .prev dibuat di sampingnya
sudo chmod -R 755 /var/www /var/www/office
systemctl --user enable --now virtual-office-api
```

`/var/www` (bukan hanya `/var/www/office`) perlu bisa ditulis karena `office.prev` dan
`office.tmp-rollback` dibuat/dihapus di direktori induknya. Kalau tetap milik root, skrip
memakai `sudo -n`; tanpa NOPASSWD ia berhenti dengan pesan yang menyebut perintah `chown`
di atas, bukan `Permission denied` mentah.

**Otomatis (disarankan).** `.github/workflows/publish.yml` membangun binary + bundle pada
setiap push ke `main` dan menerbitkannya sebagai GitHub Release `deploy-<sha7>`. Di host,
cron tiap 5 menit menjalankan:

```bash
cd ~/workspace/virtual-office && ./deploy/deploy-from-release.sh   # --dry-run untuk cek
```

Script membaca `commit` dari `/api/health` (200 normal maupun 503 degraded), membandingkannya
dengan rilis terakhir, lalu: unduh → verifikasi SHA256 → backup `.prev` → stop unit → pasang
binary → start → sync statis → **membuktikan** commit baru aktif *dan* `index.html` yang
disajikan `$SITE_URL` sama persis dengan yang baru dipasang. Gagal di titik mana pun =
rollback otomatis (binary dan statis). Host yang menjalankan commit lebih baru dari rilis
terakhir — mis. hotfix manual — dilewati dengan peringatan, tidak diturunkan.

```bash
( crontab -l 2>/dev/null; echo "*/5 * * * * cd \$HOME/workspace/virtual-office && ./deploy/deploy-from-release.sh >> \$HOME/.cache/office-deploy.log 2>&1" ) | crontab -
```

Env yang sering dipakai: `SITE_URL` (default `https://office.afifnurzein.my.id/`; harus
menyajikan isi `/var/www/office` — kalau API juga menyajikan SPA, `http://127.0.0.1:8130/`
bisa dipakai), `DEPLOY_PIN=<sha7>` untuk menahan host pada satu rilis, dan `--dry-run`.

**Manual.** Build dulu di commit yang akan dikirim, lalu di host:

```bash
# di sandbox/repo: binary langsung ke deploy/office-api (commit ikut tertanam)
deploy/build.sh --out deploy/office-api

# di host:
systemctl --user stop virtual-office-api \
&& install -m 0755 ~/workspace/virtual-office/deploy/office-api ~/.local/bin/office-api \
&& systemctl --user start virtual-office-api \
&& sudo rsync -a --delete ~/workspace/virtual-office/frontend/dist/ /var/www/office/ \
&& curl -s http://127.0.0.1:8130/api/health
```

`deploy/build.sh` tanpa `--out` menulis ke `backend/bin/office-api`; pakai `--out` supaya
jalur di atas dan artefak rilis menunjuk berkas yang sama.

**Caddy** (cache + header keamanan): `bash deploy/apply-caddy-headers.sh` — menyisipkan
`@assets immutable` / `@shell no-cache` dan header keamanan ke site block, dengan
`caddy validate` + rollback otomatis. Rujukan lengkap blok situs (proxy ke `8130`, root
`/var/www/office`): `deploy/Caddyfile.block`.

**Rollback**: `systemctl --user stop virtual-office-api && install -m 0755 ~/.local/bin/office-api.prev ~/.local/bin/office-api && systemctl --user start virtual-office-api && sudo rsync -a --delete /var/www/office.prev/ /var/www/office/`.
Rollback hanya mungkin kalau `.prev` ada; pada instalasi pertama keduanya belum ada, jadi
satu-satunya jalan adalah memasang ulang rilis secara manual.

## API

Read-only, tanpa auth, bind `127.0.0.1` saja (Caddy yang mempublikasikan).

| Endpoint | Isi |
|---|---|
| `GET /api/health` | `{ok, degraded, version, now, uptime_s, source, home, profiles, bind, tz, dbs_available, dbs_checked, dbs_ok, dbs_err, dbs_failed[]}` |
| `GET /api/config` | `{title, tz, source, hermes_home, remote_api_url, profiles, roster[], layout{floor,grid,aisle}, teams[]}` |
| `GET /api/status` | `{now, gateway, agents[], feed[], tasks[], comms[], dbs_checked, dbs_ok, dbs_err, dbs_failed[]}` |
| `GET /api/kpi?window=7d\|30d` | agregat per profil: `{window, from, to, generated_at, cache_ttl_s, agents[], totals, data}`; cache 60 detik per jendela |
| `GET /api/agents/{id}` | satu objek agen, `404` kalau tidak ada |
| `GET /metrics` | teks Prometheus; **hanya dari `127.0.0.1`**, IP lain `403` |

Bentuk JSON identik dengan API lama (kunci baru hanya ditambahkan), jadi reverse
proxy/frontend lain tetap cocok.

**Rate limit & metrik.** Setiap `/api/*` dibatasi per IP dengan token bucket
in-memory (default `120`/menit, burst `30`; lihat `RATE_LIMIT*` di bawah). Lewat
limit → `429` dengan header `Retry-After` dan body
`{"error":"rate_limited","retry_after_s":N}`. `/health` dan `/api/health`
dikecualikan supaya monitoring tidak pernah ikut kena. IP diambil dari
`X-Real-IP` (di-set Caddy) hanya kalau peer-nya loopback/privat; selain itu
`RemoteAddr`, jadi header itu tidak bisa dipalsukan dari internet.
`GET /metrics` menyajikan `office_http_requests_total{path,status}`,
`office_http_request_duration_seconds`, `office_snapshot_age_seconds`, dan
`office_rate_limited_total` dalam format teks Prometheus; endpoint ini hanya
bisa dibaca dari `127.0.0.1` (Caddy tidak mem-proxy-kannya) — IP lain `403`.

**Kesehatan basis data.** `/api/health` membuka setiap `state.db` (tanpa membaca
baris) dan melaporkan `dbs_ok`/`dbs_err`. Kalau ada DB tapi **tidak satu pun**
bisa dibuka, jawabannya `503` dengan `ok:false, degraded:true` — bukan kantor
kosong yang terlihat sehat. `/api/status` melakukan hal yang sama (`503` +
`degraded:true`), dan selalu membawa `dbs_ok`/`dbs_err` supaya kerusakan
sebagian tetap kelihatan. `HERMES_HOME` kosong (belum ada DB) tetap sehat.

**Kredensial.** `REMOTE_API_URL` boleh memuat basic-auth (`https://user:pass@host`).
Nilai mentahnya hanya dipakai HTTP client; semua yang keluar — `remote_api_url`
di `/api/config`, `home` di `/api/health`, body `502`, dan log — memakai URL
tanpa userinfo.

**KPI per agen.** `/api/kpi` mengagregasi 7 atau 30 hari terakhir dari setiap
`state.db`: sesi, pesan, tool call, hari/jam aktif, span aktif, detik terblokir
(rangkaian ≥2 hasil tool yang gagal, tiap rangkaian dipegang maksimum
`BlockedHold`), median/P90 jeda antar pesan, dan token bila kolomnya ada.
Jendela lain dijawab `400`. Hasilnya di-cache **60 detik per jendela** supaya
penonton tidak memicu pembacaan seluruh DB pada setiap request.

Endpoint ini **tidak** mengubah `/api/status`; keduanya berbagi atribusi sesi
yang sama (`derive.prepare`) tetapi tidak saling bergantung.

**Kejujuran angka.** Tidak ada metrik yang dikarang:

- `tokens.available:false` + `tokens.total:null` berarti kolom token tidak ada
  (atau tidak berisi nilai) di `state.db` — **bukan** nol token. `data.token_column`
  menyatakan apakah skemanya punya kolom itu sama sekali.
- `data.cost_available` selalu `false`: `state.db` tidak menyimpan harga model
  per pesan, jadi biaya rupiah/dolar per agen tidak bisa dihitung dan tidak
  pernah ditampilkan sebagai `0`.
- `data.messages_capped:true` berarti satu profil mencapai batas baca, sehingga
  jumlah pesan adalah batas bawah, bukan total.
- `blocked_pct`/`median_gap_s` bernilai `null` bila jendela tidak punya cukup
  data — bukan `0%`.

```jsonc
{
  "now": 1794668541.39,
  "gateway": { "state": "running", "version": "0.23.1", "updated_at": "2026-11-14T15:01:51+00:00" },
  "agents": [{
    "id": "coder", "status": "blocked", "last_active": 1794668421.2,
    "current": { "kind": "tool_result", "tools": ["terminal"] },
    "today": { "sessions": 1, "messages": 16, "tool_calls": 9, "tokens": 2400, "hourly": [/* 24 */] },
    "total": { "sessions": 1, "messages": 16 },
    "task": "c0de0001", "source": "subagent",
    "blocked": { "reason": "2 tool gagal berturut", "since": 1794668421.2, "tools": 2 }
  }],
  "feed": [{ "agent": "dev", "ts": 1794668500.1, "kind": "tool_result", "tools": ["terminal"], "source": "subagent" }],
  "tasks": [{ "id": "c0de0001", "owner": "coder", "from": "user", "via": "subagent", "status": "blocked",
              "blocked": null, "started": 1794667300, "last": 1794668421, "ended": null, "tools": 9, "messages": 16 }],
  "comms": [{ "ts": 1794668499.2, "from": "default", "to": "dev", "kind": "delegate", "task": "" }]
}
```

### Aturan turunan status

| Status | Kapan |
|---|---|
| `working` | ada sesi aktif: pesan terakhir < 20 detik, atau mid-turn (peran terakhir `user`/`tool`/tool-call) < 15 menit |
| `reviewing` | sama seperti working tapi profilnya reviewer (`reviewer`, `edu-reviewer`) |
| `waiting` | tool terakhir adalah `delegate_task` dan sesi anaknya (`parent_session_id`) yang mulai setelah panggilan itu masih berjalan — menunggu subagen, bukan bekerja. Bertahan melewati jendela mid-turn induk (subagen boleh jalan >15 menit); anak yang sudah senyap >15 menit dianggap tidak berjalan agar baris bocor tidak menyandera induk. `current.tools` tetap `["delegate_task"]`, `children: {total, running}` menghitung sesi anak |
| `blocked` | sesi terakhir berakhir dengan ≥ 2 tool result gagal berturut, atau `end_reason` mengandung error/timeout; berlaku 30 menit |
| `idle` | punya data tapi tidak ada sesi aktif (sesi yang sudah berakhir selalu idle) |
| `offline` | profil tidak punya `state.db` |

**`stale`** (aditif, bukan status baru): `working`/`reviewing` yang tidak punya
event baru selama `OFFICE_STALE_SECONDS` (default 180 detik) **dan** tidak
ditutup balasan/sesi berakhir akan diturunkan ke `idle` dengan `stale: true` +
`last_kind` (jenis event terakhir: `tool`, `tool_result`, `reply`, …). Karena
`status` sudah diturunkan, klien harus membaca flag `stale` — bukan menebak dari
status lama. Field `status`, `current`, `today`, `total` tidak berubah bentuk —
UI memakai `stale` untuk menjelaskan kenapa meja itu diam, dan tidak
menghitungnya sebagai bekerja.

**Subagen**: sesi `source='subagent'` tersimpan di `state.db` induk
(`profile_name` = induk). Profil tujuan dibaca dari argumen `delegate_task`
(`tasks[i].profile`, dicocokkan lewat `model_config._subagent_id = "sa-<i>-…"`).
Kalau profil tujuan ada, meja agen itulah yang menyala; kalau tidak, sesi
dihitung milik induk.

**Privasi**: hanya metadata — status, nama tool, waktu, counter, siapa bicara
kepada siapa. Isi pesan dibaca lokal hanya untuk menandai tool error / hasil
delegasi, dan tidak pernah dikirim ke klien. Tidak ada nama pengguna atau chat
id di payload (pengguna tampil sebagai "Pengguna").

### Konfigurasi (env)

Semua lewat environment variable; tidak ada path user yang di-hardcode.

| Variabel | Default | Arti |
|---|---|---|
| `HERMES_HOME` | `~/.hermes` | sumber `state.db` + `gateway_state.json` (mode `local`) |
| `PORT` | `8131` | port HTTP (image Docker: `8080`) |
| `BIND` | `127.0.0.1` | alamat bind (`0.0.0.0` di Docker) |
| `OFFICE_SOURCE` | `local` | `local` = baca `state.db` di mesin ini; `remote` = ambil dari instance lain lewat HTTP, tanpa akses filesystem |
| `REMOTE_API_URL` | — | wajib untuk `OFFICE_SOURCE=remote`, mis. `https://office.example.com` |
| `OFFICE_ROSTER` | — | path file roster JSON/YAML (nama, peran, tim). Lihat `deploy/roster.example.yaml`. Id wajib `^[a-zA-Z0-9_-]+$` |
| `OFFICE_ROSTER_JSON` | — | roster inline JSON; menang atas `OFFICE_ROSTER` |
| `OFFICE_TITLE` | `Agent Office` | judul kantor (dipakai frontend dari `/api/config`) |
| `OFFICE_TZ` | `Asia/Jakarta` | zona waktu untuk batas hari & bucket per jam (dan jam di UI). Nilai `tz` di file roster menang atas ini; zona tak dikenal = gagal start (`exit 2`) |
| `PROFILES` | 13 profil bawaan | daftar profil dipisah koma (mengganti default). **Diabaikan sepenuhnya di mode `remote`** — roster datang dari upstream `/api/config` |
| `GATEWAY_FILE` | `$HERMES_HOME/gateway_state.json` | status gateway |
| `WEB_DIR` | — | folder `dist` frontend; kalau diisi, API juga menyajikan SPA (dipakai image Docker) |
| `LOG_REQUESTS` | `0` | log tiap request ke stderr |
| `RATE_LIMIT` | `on` | `off` mematikan rate limit per-IP untuk `/api/*` |
| `RATE_LIMIT_PER_MIN` | `120` | token yang diisi ulang per menit per IP |
| `RATE_LIMIT_BURST` | `30` | token awal; lonjakan sebesar ini dilayani sekaligus |
| `OFFICE_STALE_SECONDS` | `180` | batas diam sebelum `working`/`reviewing` diturunkan ke `idle` + `stale: true`; harus 1..86400 |

Profil yang punya folder `$HERMES_HOME/profiles/<nama>/state.db` otomatis
ditambahkan ke roster walau tidak ada di `PROFILES`. Profil tanpa `state.db`
tetap dapat meja (status `offline`), dan nama/peran/tim-nya bisa dioverride
tanpa mengubah kode.

### Roster dinamis

`GET /api/config` adalah satu-satunya sumber yang dibutuhkan frontend:

```jsonc
{
  "title": "Agent Office",
  "tz": "Asia/Jakarta",
  "source": "local",
  "hermes_home": "/hermes",
  "profiles": ["default", "dev", "coder"],
  "roster": [{ "id": "dev", "name": "Bima", "role": "SDLC LEAD", "team": "dev" }],
  "layout": {
    "floor": { "w": 40, "d": 30 },
    "grid": { "dx": 4.5, "dz": 4.0 },
    "aisle": 1.6
  },
  "teams": [{ "id": "dev", "label": "Tim Dev" }]
}
```

**Tim memakai id ruangan yang digambar frontend: `lobby`, `dev`, `edu`.**
`pendopo` masih diterima di file roster sebagai alias `lobby`.

Roster diturunkan dari profil yang ditemukan. Profil yang ada di roster bawaan
(`DefaultAgents`, 13 profil) memakai nama/peran/tim aslinya — Ndoro Kakung, Bima, dst.
Profil lain dapat `name = id`, peran `Agen`, dan tim ditebak dari nama
(`default`/`lobby` → `lobby`, `edu*` → `edu`, sisanya `dev`). Override berlapis,
prioritas dari atas: `OFFICE_ROSTER_JSON` → file `OFFICE_ROSTER` → roster
instance upstream (mode `remote`) → roster bawaan. Override bersifat per-field:
menyebut `name` saja tidak menghapus peran/tim bawaan.

`tz` di roster (atau di upstream) menang atas `OFFICE_TZ` dan dipakai loader
untuk batas hari — jadi zona yang salah tidak lagi diabaikan diam-diam. Zona
yang tidak dikenal membuat proses berhenti dengan `exit 2`.

Desain lengkapnya ada di `deploy/roster.example.yaml`. File YAML-nya subset
sederhana: daftar `- id:` (boleh di kolom 0, boleh diindentasi) plus
`name/role/team`, `agents: []` untuk daftar kosong, dan `#` komentar. JSON
dengan bentuk sama juga diterima, dan keluaran `/api/config` bisa langsung
dipakai ulang sebagai file roster.

Id roster wajib `^[a-zA-Z0-9_-]+$`. Id menjadi nama folder di
`$HERMES_HOME/profiles/` dan bagian dari DSN SQLite, jadi `../../tmp/leak`
ditolak saat load (`exit 2`), bukan dipakai sebagai path.

#### Agen baru tanpa meja

Frontend tidak butuh meja yang digambar tangan. Untuk setiap agen di roster
yang tidak ada di `agents.ts`:

- **Meja** ditempatkan otomatis pada lattice **4.5 × 4.0** yang sama dengan meja
  lain, di blok bebas terdekat dari timnya, dengan sirkulasi **≥ 1.6** ke
  dinding, furnitur, meja lain, dan jalur jalan (`lib/layout.ts`).
- **Tampilan** (`look`) dihasilkan deterministik dari hash FNV-1a id-nya, memakai
  palet warna yang sudah ada — id yang sama selalu menghasilkan orang yang sama,
  tanpa file konfigurasi.
- Agen lama tidak berubah sama sekali: meja dan tampilannya tetap yang
  digambar tangan (dijaga `verify/roster_check.ts`).

### Federasi (`OFFICE_SOURCE=remote`)

Satu instance kantor bisa menunjuk instance lain — mis. kantor pusat di server,
kantor rumah cuma jadi penampil:

```bash
OFFICE_SOURCE=remote REMOTE_API_URL=https://office.example.com ./office-api
```

Mode ini tidak membuka `state.db` sama sekali: `/api/status` diproksikan ke
`$REMOTE_API_URL/api/status`, dan roster/judul/zona diambil dari
`$REMOTE_API_URL/api/config` (cache 30 detik) supaya nama & peran tetap benar.
Kalau upstream mati, `/api/status` menjawab `502` dengan pesan error — bukan
kantor kosong yang menyesatkan. Status agen tetap dibaca dari `state.db` di
instance pemilik data: API Hermes sendiri (`/v1/chat/completions`, `/v1/models`,
…) tidak punya endpoint status sesi, jadi tidak bisa dijadikan sumber langsung.

`PROFILES` diabaikan di mode ini: daftar meja datang dari upstream, bukan dari
env lokal. Instance lama yang belum punya `/api/config` tetap bisa dipakai —
roster jatuh kembali ke `agents` di `/api/status`, dengan nama/peran bawaan dari
`DefaultAgents` (jadi `dev` tetap tampil sebagai Bima). Upstream yang lebih tua
dari versi ini karena itu tidak perlu di-upgrade lebih dulu.

## Verifikasi

```bash
cd backend  && go vet ./... && go test ./...          # 110 test, semua lulus
cd frontend && npx tsc --noEmit && npm run build      # dist/ (JS 216 kB, 71 kB gzip)
```

Pemeriksaan murni, tanpa browser (esbuild + node):

```bash
for c in roster_check layout_check anim_check visual_check theme_check render_check building_check status_check traffic_check; do
  frontend/node_modules/.bin/esbuild verify/$c.ts --bundle --format=esm \
    --platform=node --outfile=/tmp/$c.mjs && node /tmp/$c.mjs
done
```

- `status_check` — `waiting` vs `stale` truth: chip/label, header & tab
  arithmetic (waiting and stale are never counted as bekerja), palette.
- `layout_check` — grid 4.5 × 4.0, sirkulasi ≥ 1.6, nav graph bebas furnitur.
- `roster_check` — `/api/config` menggerakkan kantor: meja lama tidak bergeser,
  agen baru dapat meja di lattice, penempatan deterministik, `look` stabil per id.
- `anim_check` — pemetaan pose dari `/api/status`, transform world↔pixel, clamp
  zoom, dan chip blocked tidak membocorkan `reason` mentah.
- `visual_check` — gate legibilitas/geometri per lantai: 13 meja terlihat pada
  1280×800 dan 390×844; tidak ada nameplate/chip yang bertumpuk; tidak ada plat
  keluar kanvas.
- `theme_check` — jendela terang 06:00–18:00 WIB, override/`?theme=`, dan tabel
  kontras 4.5:1 untuk kedua tema.
- `render_check` — setiap lantai × tema benar-benar digambar lewat `renderFrame`
  (tanpa browser), termasuk roster kosong, semua agen berjalan, dan seed offline.
- `building_check` — mode GEDUNG: **satu skala untuk seluruh adegan**. Band lantai
  83 px = round(m2px(3,4)) (3,4 m floor-to-floor = 3,0 m clear + 0,4 m slab),
  semua prop interior (meja, kursi, monitor, pintu lift, kereta lift, shaft)
  diturunkan dari `m2px()` ±10 %, avatar 42 px = 50,6 % band (gerbang 45–60 %);
  3 band + 13 meja + 13 nameplate + furnitur jalan + rect kota × `SCENE_ZOOM`
  di dalam 1000×688 **dan** 390×692 dalam px final; 0 label overlap, gedung
  tepat di tengah lembar design, lift terlihat di antara lantai saat delegasi,
  0 rect kota menutupi fasad; jalan **kedalaman sejati** (lajur 86 px dalam =
  86 px lebar, jalan 172 px = 2 lajur, total 236 px = 9,6 m pada 1:1), dan
  urutan cat **furniture sebelum fasad** (pohon/tiang hanya bisa tertutup
  gedung, tidak pernah dicat di atasnya).
- `traffic_check` — keramaian jalan di mode GEDUNG, semuanya dari **satu skala**
  `PX_PER_M = 24,5` (avatar 42 px = 1,7 m; gerbang ±10 %): mobil 110×37, van
  135×54, bus 220×78 (tinggi 3,2 m, panjang dipangkas dari 294), motor 49×27,
  pejalan 11×42, pohon 172 px, tiang lampu 147 px, lajur 86 px (dalam = lebar,
  tanpa forsir), jalan 172 px = 2 lajur, zebra 88 px (3,6 m), marka putus
  74+147 px. 10 kendaraan (2 lajur, arah berlawanan) + 5 pejalan
  kaki (3 trotoar, 2 penyeberang) di dalam band jalan/trotoar/zebra — badan
  kendaraan seluruhnya di dalam band jalan 172 px — dan **tidak pernah**
  menutupi fasad; 0 bbox kendaraan bertumpuk dalam 120 dtk pada 30 Hz
  (jarak bumper minimum 29 px); lampu merah menghentikan kendaraan (0 yang
  menembus zebra, antrean diam di garis, clearance zebra 2,2 dtk dihitung dari
  bus 318 px / 151 px·dtk⁻¹); penyeberangan 184 px (7,51 m jarak jalan kaki;
  jalan kerb-ke-kerb 172 px = 7,02 m, 12 px terakhir mencapai garis berdiri
  seberang) dalam 5,8 dtk =
  1,29 m/dtk, jendela 10,2–16,0 dtk masuk fase merah 9 dtk (siklus 6/2/9);
  posisi identik untuk `t` yang sama (`?still=1`); headlight hanya malam dan
  selalu mengarah ke depan; awan/burung/kedip jendela
  deterministik. Skrip juga melaporkan biaya painter (ms/frame dengan mock ctx —
  angka browser dari front desk lewat `__office2dPerf()` / `__office2dTraffic()`).

Pemeriksaan yang butuh layout engine (`verify/office2d_probe.js`) dijalankan di
browser: buka build preview, tempel isi file itu di Console (atau
`Runtime.evaluate` lewat CDP). Skrip melaporkan `ok: true/false` untuk: kanvas
benar-benar tergambar, tidak ada panel menutupi kanvas, `.roster-body` benar-benar
scroll (13 baris, `scrollTop` naik), dan lantai muat di kanvas pada zoom sekarang.

Uji end-to-end terhadap binary sungguhan (roster override, tz tak dikenal,
URL ber-kredensial, DB gagal dibuka, aset hilang, federasi ke instance lama):

```bash
bash verify/e2e_review.sh      # 51 pemeriksaan, butuh binary di /workspace/.gotmp/bin
```

Hasil terakhir: `go vet` bersih, `go test` ok di api/derive/store, `tsc --noEmit`
tanpa error, `vite build` sukses, `roster/layout/anim/visual/theme/render/building/traffic`
semuanya OK, dan `verify/office2d_probe.js` melaporkan `ok: true` (kanvas
tergambar, tidak ada panel menutupi kanvas, roster scroll, GEDUNG default,
lantai muat).

Screenshot (1280×800 dan 390×844) memakai `?still=1` agar frame deterministik.
Default sekarang **GEDUNG**: potongan tiga lantai di tengah kota, ketiganya
terlihat sekaligus. Tab HUD: **GEDUNG | L1 | L2 | L3**; keyboard `0`/`B` untuk
gedung dan `1..3` untuk lantai.

```
/?still=1&theme=day                      # GEDUNG, siang (default)
/?still=1&theme=night&view=building      # GEDUNG, malam
/?still=1&theme=day&floor=3              # L3 seperti sebelumnya
/?face=dev                               # lantai agen + zoom ke mejanya
```

Di GEDUNG: klik agen → pindah ke lantai agen itu + fokus meja; klik band lantai
kosong → buka lantai itu; zoom masuk (tombol `+`/pinch) mengaktifkan pan vertikal
dan horizontal (desktop sampai 3×). Nameplate diringkas (nama depan + dot
status). **Satu skala untuk seluruh adegan**, `PX_PER_M = 24,5` (42 px / 1,7 m),
dikomposisikan pada lembar design 833×573 yang di-zoom seragam `SCENE_ZOOM
= 1,2` ke kanvas 1000×688 (1,2 adalah zoom seragam terbesar yang masih memuat
jalan realistis: 573 × 1,2 = 687,6 ≤ 688): band lantai 83 px design / 99,6 px
final (3,4 m floor-to-floor), avatar 42/50,4 px (50,6 % band), meja
39,2/47 px, pintu lift 51, kereta lift 54, shaft 29 px. Jalan kini
**kedalaman sejati 9,6 m pada 1:1** (forsir ×0,56 dihapus): trotoar dekat 44 px
(1,8 m), jalan 172 px = 2 lajur × 86 px (3,5 m), trotoar jauh 20 px (0,8 m);
mobil 110×37, bus 220×78, motor 49×27, pejalan 42, pohon 172, tiang lampu 147,
zebra 88 px (3,6 m), lampu 6/2/9 dengan jendela penyeberang 10,2–16,0 dtk di
dalam merah.

## Catatan desain (kantor 2D)

- **Satu `<canvas>` 2D, semuanya prosedural.** Sprite (chibi 12×16, meja, kursi,
  furnitur per id `OBSTACLES`, kucing, amplop), font 5×7, dan palet digambar
  dengan `fillRect` di `frontend/src/scene2d/`; tidak ada file aset, tidak ada
  webfont, tidak ada WebGL. Sumber gaya & lisensi: `docs/attribution-2d.md`.
- **Dua ruang koordinat.** Dunia digambar pada px zoom-1 (TILE 16) lalu di-blit
  dengan faktor integer (`blitScale(zoom, dpr)`) supaya tetap nearest-neighbour
  di DPR pecahan. Label diukur dalam **CSS px** (`scene2d/labels.ts`) agar
  lebarnya tidak ikut membesar bersama zoom — pitch meja hanya 26 px, jadi plat
  berukuran px dunia akan saling menimpa (bug "OM BT" pada gate T1.9).
- **Nama terbaca tanpa membuka panel.** Setiap plat membawa nama depan penuh
  (maks 6 huruf). Pada zoom 1 font pixel diskalakan 2× (glyph 14 px) supaya
  terbaca di HP; plat yang lebih lebar dari pitch meja ditata `placeStacks`
  (stagger vertikal, overlap 0). Zoom ≥2 memakai skala 1 karena dunianya sudah
  2× lebih besar.
- **View default = zoom-fit seluruh lantai** (`fitZoom`): zoom 2 (label 200 %)
  pada 1280×800 (kanvas 1000×688, lantai 896×640) dan zoom 1 (label 100 %,
  lantai 448×320, pan horizontal) pada 390×844. `?spot=lobby|dev|edu` tetap ada
  untuk masuk ke satu zona.
- **Status tidak pernah hanya warna**: `offline` = kursi kosong navy + plat
  berlubang + "Z Z Z" + chip `offline`; `idle` = chibi duduk, dot cincin, chip
  `idle`; `blocked` = chip kuning + gelembung "!"; `working` = monitor hidup +
  chip nama alat.
- **Privasi**: chip task hanya menampilkan id (dipotong), chip blocked memakai
  teks generik ("butuh izin"), tidak ada isi pesan/judul yang digambar.
- **Outage ≠ kantor kosong**: meja & kursi digambar dari `rosterAgents()`, bukan
  dari payload status, jadi API mati tetap menampilkan 13 meja offline.
- **Layout panel**: HUD 56 px di atas, rail kanan 280 px (roster di atas, feed
  dock di kakinya — keduanya hanya memakan lebar kanvas saat terbuka), toolbar
  56 px di bawah — kanvas tidak pernah tertutup panel. Di HP sidebar & feed
  menjadi bottom sheet, D-pad kiri-bawah, zoom kanan-bawah.
- **Roster scroll**: `.roster-body` memakai `flex:1 1 auto; min-height:0;
  overflow-y:auto` (regresi cc2add3), dibuktikan `verify/office2d_probe.js`.
- **Tanpa dependensi baru**: `three`, `@react-three/fiber`, `@react-three/drei`,
  `@types/three` sudah dihapus dari `package.json`; JS total turun dari
  ±331 kB gzip ke ±71 kB gzip. GLB Quaternius di `public/models/` masih ada
  sebagai arsip (keputusan Q1) tetapi tidak dipakai maupun di-fetch.

## Sisa pekerjaan deploy

Lihat bagian **Deploy** di atas. Yang sengaja belum dijalankan dari sesi ini:
`systemctl --user enable --now virtual-office-api`, penyalinan ke
`/var/www/office-v2`, dan reload Caddy.

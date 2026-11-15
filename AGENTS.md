# AGENTS.md — aturan kerja di repo ini

Panduan untuk **agen otomatis** (Hermes, [CC], Codex, Cursor, Copilot, dan sejenisnya) yang
melanjutkan pekerjaan di repo ini. Manusia cukup baca `README.md`; berkas ini mengikat
perilaku agen: apa yang boleh, apa yang dilarang, dan bagaimana menyatakan pekerjaan selesai.

Produk: **Agent Office** — kantor virtual 3D yang menampilkan agen Hermes secara live.
Live: https://office.afifnurzein.my.id · Repo: `afifnz/virtual-office`

---

## 1. Aturan emas (jangan dilanggar, alasannya menyusul di bawah)

1. **Metadata saja.** API tidak boleh mengeluarkan isi pesan, judul tugas, id user/chat, atau
   `tool_input`. Yang boleh: status, nama tool, timestamp, counter, siapa-bicara-ke-siapa.
   Endpoint ini **publik** — kebocoran sekecil apa pun langsung terekspos.
2. **`state.db` Hermes hanya dibaca.** Jangan pernah membuka dengan mode tulis, jangan migrasi
   skema, jangan `VACUUM`. Buka `mode=ro`.
3. **Kontrak `/api/status` stabil.** Frontend dan deployment mengandalkannya
   (`{now, gateway, agents[], feed[], tasks[], comms[]}`). Menambah field boleh; mengganti nama
   atau menghapus field tidak.
4. **Deploy itu in-place, Caddy tidak disentuh.** API jalan di `127.0.0.1:8130`, statis di
   `/var/www/office`. Jangan mengedit `/etc/caddy/Caddyfile` tanpa backup + `caddy validate` +
   rencana rollback.
5. **Satu sumber koordinat.** Meja, `DESK_EXIT`, `POIS`, `NAV`, dan `SPOTS` kamera diturunkan
   dari `frontend/src/lib/rooms.ts`. Ubah satu, periksa semuanya — kalau tidak, agen berjalan
   menembus furniture.
6. **Artefak build tidak masuk git.** `frontend/dist/`, `node_modules/`, `backend/bin/`,
   `deploy/office-api`, `verify/*.png`.
7. **Jangan push langsung ke `main`.** Satu pekerjaan = satu branch = satu PR. Review dilakukan
   agen lain (lihat §6), bukan penulisnya sendiri.
8. **Tidak ada kredensial di repo.** Token, `API_SERVER_KEY`, HMAC secret, dan URL ber-userinfo
   tidak boleh muncul di kode, test, commit, atau log.

---

## 2. Peta repo

```
backend/            Go 1.23, stdlib net/http, modernc.org/sqlite (tanpa cgo)
  cmd/office-api/   main: baca env, pilih sumber data, serve
  internal/config/  env + payload /api/config (termasuk RedactURL)
  internal/source/  abstraksi sumber: local (state.db) | remote (HTTP)
  internal/loader/  rakit snapshot: agent, feed, task, comms, gateway
  internal/store/   pembacaan SQLite read-only + toleransi skema
  internal/derive/  logika murni: status, blocked, jendela hari, DST
  internal/roster/  roster dinamis + parser YAML
  internal/api/     handler HTTP, header X-Office-*, static/SPA
frontend/           React 18 + Vite + TS strict + @react-three/fiber
  src/scene/        Office, Room, Desk, Furniture, Avatar, human, face, galuh
  src/lib/          rooms (koordinat), agents (seed look), roster (runtime), layout
  src/components/   HUD, Roster, Feed, TaskBoard, ProximityCard, DPad
  public/models/    GLB Quaternius (CC0) + LICENSE-quaternius.txt
deploy/             build.sh, unit systemd, Caddy block, roster.example.yaml
docs/rnd/           laporan riset arsitektur integrasi
verify/             skrip screenshot, e2e, roster/layout check (PNG di-gitignore)
```

**Lokasi di host** (penting, sering salah):
- Repo kerja agen = `/home/ubuntu/.hermes/sandboxes/docker/default/workspace/virtual-office`
  (di dalam sandbox tampil sebagai `/workspace/virtual-office`). **Ini yang punya `.git`.**
- `~/workspace/virtual-office` = salinan deploy hasil `rsync`, **tanpa** `.git` (sengaja).
- `/var/www/office` = statis yang disajikan Caddy · `~/.local/bin/office-api` = binary yang jalan.

---

## 3. Menjalankan

```bash
# backend (membaca ~/.hermes)
cd backend && HERMES_HOME=$HOME/.hermes PORT=8130 go run ./cmd/office-api

# frontend dev (proxy /api -> 127.0.0.1:8130)
cd frontend && npm ci && npm run dev      # http://127.0.0.1:5173

# sekaligus (satu proses, tanpa Caddy)
deploy/build.sh
WEB_DIR=$PWD/frontend/dist PORT=8130 ./backend/bin/office-api
```

Diagnostik di URL: `?face=<id>&front=1` (potret), `?spot=tampak|dev|edu`, `?still=1`, `?cam=&aim=`.

Tanpa akses `~/.hermes`? Pakai fixture: `deploy/make-fixture.py` lalu
`HERMES_HOME=<dir-fixture>`.

---

## 4. Env yang tersedia

| Var | Default | Catatan |
|---|---|---|
| `HERMES_HOME` | `~/.hermes` | sumber `state.db` + `gateway_state.json` (mode local) |
| `PORT` / `BIND` | `8131` / `127.0.0.1` | di image: `8080` / `0.0.0.0` |
| `OFFICE_SOURCE` | `local` | `local` \| `remote`; nilai lain → exit 2 |
| `REMOTE_API_URL` | — | wajib di mode `remote`, harus absolut http(s) |
| `OFFICE_ROSTER` / `OFFICE_ROSTER_JSON` | — | override roster (file YAML/JSON atau inline) |
| `OFFICE_TITLE` / `OFFICE_TZ` | `Agent Office` / `Asia/Jakarta` | judul & zona waktu |
| `WEB_DIR` | — | kalau diisi, API juga menyajikan SPA |
| `PROFILES`, `GATEWAY_FILE`, `LOG_REQUESTS` | — | lama, masih berlaku (kecuali `PROFILES` di mode remote) |

Detail lengkap: `README.md` §Konfigurasi.

---

## 5. Definisi "selesai" (wajib, bukan opsional)

Sebuah perubahan **belum selesai** sebelum semua ini lulus dan outputnya ditempel di PR:

```bash
cd backend  && GOTMPDIR=/workspace/.gotmp TMPDIR=/workspace/.gotmp go vet ./... && go test -count=1 ./...
cd frontend && npx tsc --noEmit && npm run build
bash verify/e2e_review.sh          # 51 pemeriksaan end-to-end terhadap binary sungguhan
```

- Perubahan **layout/avatar/scene**: sertakan screenshot (desktop 1280×800 + mobile 390×844)
  **dan** verdict `vision_analyze`. Klaim "lebih rapi/lebih cantik" tanpa gambar tidak diterima.
- Perubahan **API**: sertakan `curl` nyata (health, config, status) sebelum/sesudah.
- **CI** (`.github/workflows/ci.yml`) menjalankan job `backend` (gofmt, vet, test), `frontend`
  (tsc, build), dan `e2e` di setiap PR. Branch protection `main` **mewajibkan ketiganya hijau**;
  PR merah tidak bisa di-merge — perbaiki, jangan diakali. Cek: `gh pr checks <n>`. CI hijau
  tidak menggantikan screenshot untuk perubahan visual.
- Perubahan **UI**: cek juga bahwa dengan API mati kantor tetap menampilkan roster offline
  (fallback seed), bukan ruangan kosong.

---

## 6. Alur git (wajib)

```bash
git switch -c feat/<slug> origin/main        # atau fix/<slug>, docs/<slug>
# ... kerja, commit kecil dan bermakna ...
GH_PAGER=cat git push -u origin HEAD
GH_PAGER=cat gh pr create --title "<type>: <ringkas>" --body-file /tmp/pr-body.md
```

Body PR (maks ~20 baris): **Problem · Change · Proof (perintah + hasil) · Risk**.
Review oleh **agen lain dengan konteks segar** — beri dia nomor PR dan kriteria penerimaan saja;
dia wajib `gh pr diff`, menjalankan test sendiri, dan memberi `VERDICT: LULUS | REVISI` dengan
temuan `file:line — masalah — bukti`. Penulis tidak boleh me-review atau men-merge karyanya sendiri.
Merge: `gh pr merge <n> --squash --delete-branch`, hanya setelah CI/test hijau dan verdict LULUS.

Commit: subject imperatif ≤60 karakter, body menjawab *mengapa*. Bahasa Indonesia untuk dokumen,
Inggris untuk kode/komentar/commit.

---

## 7. Deploy & rollback

Deploy dijalankan **dari host** (sandbox tidak punya akses systemd/Caddy):

```bash
# satu baris, idempoten: sync kode → backup versi jalan → stop unit → pasang binary
# → start → sync statis
rsync -a --delete --exclude node_modules --exclude .git \
  ~/.hermes/sandboxes/docker/default/workspace/virtual-office/ ~/workspace/virtual-office/ \
&& cp -a ~/.local/bin/office-api ~/.local/bin/office-api.prev \
&& sudo rsync -a --delete /var/www/office/ /var/www/office.prev/ \
&& systemctl --user stop virtual-office-api \
&& install -m 0755 ~/workspace/virtual-office/deploy/office-api ~/.local/bin/office-api \
&& systemctl --user start virtual-office-api \
&& sudo rsync -a --delete ~/workspace/virtual-office/frontend/dist/ /var/www/office/ \
&& sudo chown -R www-data:www-data /var/www/office \
&& curl -s http://127.0.0.1:8130/api/health
```

Atau lewat script: `bash ~/.hermes/scripts/deploy-virtual-office.sh` (melakukan hal yang sama,
termasuk backup `.prev`; `--dry-run` untuk melihat saja).

### CD otomatis (rilis GitHub → host)

Deploy manual di atas masih sah, tetapi jalur utama sekarang otomatis dan **tidak butuh runner,
token, atau port baru**:

1. `.github/workflows/publish.yml` jalan pada setiap push ke `main` (dan `workflow_dispatch`):
   membangun `office-api` + `dist.tar.gz`, menulis `SHA256SUMS`, lalu menerbitkannya sebagai
   GitHub Release bertanda `deploy-<sha7>` (aset publik, repo publik).
2. Di host, cron tiap 5 menit menjalankan `deploy/deploy-from-release.sh`:
   membaca `commit` dari `/api/health`, membandingkannya dengan tag rilis terakhir, dan hanya
   bertindak kalau berbeda — unduh → verifikasi SHA256 → backup `.prev` → stop unit → pasang
   binary → start → sync statis → **verifikasi commit baru benar-benar aktif**. Gagal di titik
   mana pun = rollback otomatis. `--dry-run` untuk melihat rencananya.

```bash
# sekali saja di host: biar /var/www/office bisa ditulis tanpa sudo
sudo chown -R "$USER":www-data /var/www/office && sudo chmod -R 755 /var/www/office

# pasang cron
( crontab -l 2>/dev/null; echo "*/5 * * * * cd \$HOME/workspace/virtual-office && ./deploy/deploy-from-release.sh >> \$HOME/.cache/office-deploy.log 2>&1" ) | crontab -
```

Script memakai `flock`, jadi aman walau cron tumpang tindih. Kalau `/var/www/office` tetap
milik root, script memakai `sudo -n` dan butuh aturan NOPASSWD untuk `rsync` — lebih baik
jalankan `chown` di atas sekali saja.

### Header Caddy (cache + keamanan)

Produksi sempat mengirim HTML **tanpa** `Cache-Control`, sehingga browser menyajikan bundle lama
setelah deploy — gejalanya "sudah deploy tapi masih tampil versi lama". Perbaikannya idempoten
dan otomatis rollback:

```bash
bash deploy/apply-caddy-headers.sh --dry-run   # lihat rencana
bash deploy/apply-caddy-headers.sh             # pasang (butuh sudo)
```

Skrip menyisipkan header keamanan + `@assets immutable` / `@shell no-cache` ke site block
`office.afifnurzein.my.id` saja, memvalidasi dengan `caddy validate`, reload, lalu memverifikasi
header benar-benar muncul dari luar; kalau salah satu langkah gagal, Caddyfile dikembalikan
dari backup dan Caddy di-reload lagi. `deploy/Caddyfile.block` adalah rujukan lengkapnya —
pastikan target proxy `8130` dan root `/var/www/office`, bukan nilai lama `8131` /
`/var/www/office-v2`.

**Rollback** (satu generasi ke belakang, dari backup `.prev` yang dibuat saat deploy):

```bash
systemctl --user stop virtual-office-api \
&& install -m 0755 ~/.local/bin/office-api.prev ~/.local/bin/office-api \
&& systemctl --user start virtual-office-api \
&& sudo rsync -a --delete /var/www/office.prev/ /var/www/office/ \
&& curl -s http://127.0.0.1:8130/api/health    # commit harus kembali ke versi lama
```
Atau: `bash ~/.hermes/scripts/deploy-virtual-office.sh --rollback`.

**Verifikasi setelah deploy** (dari luar, bukan dari output script):
`/api/health` → `commit` harus sama dengan `git log -1`, `dbs_err: 0`, `degraded: false`;
`/api/config` hidup; bundle `/assets/index-*.js` berganti; header `X-Office-Commit` cocok.

**Build sebelum deploy** — skrip deploy tidak mem-build. Dari sandbox, di commit yang akan dikirim:

```bash
C=$(git rev-parse --short=7 HEAD); T=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cd backend && CGO_ENABLED=0 GOTMPDIR=/workspace/.gotmp TMPDIR=/workspace/.gotmp go build -trimpath \
  -ldflags "-s -w -X officeapi/internal/api.BuildCommit=$C -X officeapi/internal/api.BuildTime=$T" \
  -o ../deploy/office-api ./cmd/office-api
cd ../frontend && npm ci && npm run build
```

Tanpa `-X …BuildCommit`, `/api/health` melapor `commit: "dev"` dan deploy tidak bisa dibuktikan.

---

## 8. Jebakan yang sudah menggigit (baca sebelum menyalahkan kode)

| Gejala | Sebab | Obat |
|---|---|---|
| `fork/exec … permission denied` saat `go test` | `/tmp` di sandbox `noexec` | `GOTMPDIR=/workspace/.gotmp TMPDIR=/workspace/.gotmp` |
| `Text file busy` saat deploy | menimpa binary yang sedang jalan | `systemctl --user stop` dulu, atau bandingkan sha256 |
| Port/env baru tidak berlaku | `enable --now` pada unit yang sudah aktif tidak me-restart | `systemctl --user restart` |
| Browser masih menampilkan versi lama | HTML dikirim tanpa `Cache-Control`, browser memakai heuristic cache | hard reload; permanen: aturan `header` di Caddy |
| `gateway.state = unknown` | kunci aslinya `gateway_state`, versinya `code_version` | sudah ditangani loader; jangan "perbaiki" dengan `state`/`version` |
| Scene hitam di screenshot headless | WebGL di software rasterizer | `--use-gl=swiftshader --enable-unsafe-swiftshader`, viewport kecil, tunggu ~5 s |
| `ModuleNotFoundError` saat `go run` | dijalankan dari direktori salah | jalankan dari `backend/`, pakai `./cmd/office-api` |
| `/api/status` "telat" ≤2 s, `now` sama di beberapa request | snapshot sengaja di-cache 2 s (`SnapshotTTL`, `source/local.go`) agar penonton tidak melipatgandakan pembacaan `state.db` | normal; jangan dihapus. `/api/health` tidak di-cache |
| Journal tidak lagi berisi `info snapshot` | log itu kini di belakang `LOG_REQUESTS=1` | set `LOG_REQUESTS=1` saat debug |
| `hermes_home`/`home` tampil `~/.hermes` | `config.ShownHome` menyembunyikan nama akun di endpoint publik | disengaja; jangan "perbaiki" jadi path penuh |
| Avatar tenggelam/melayang | bone kaki pack Quaternius menempel ke `Body` | pose diselesaikan di `human.ts` terhadap kursi + lantai; jangan set sudut manual |

---

## 9. Yang butuh keputusan manusia (jangan diputuskan sendiri)

- Mengubah skema database Hermes atau menulis ke `state.db` — **tidak pernah**.
- Mengubah kontrak API yang menghapus/mengganti nama field.
- Mengaktifkan/mengubah Caddy, systemd, atau port publik.
- Menambah dependensi baru di backend (Go) atau frontend (npm) yang bukan stdlib/platform.
- Menghapus aset berlisensi (GLB Quaternius) atau mengubah atribusi CC0.
- Mengubah warna/tema/identitas visual yang sudah disetujui.
- Menyalakan mode `remote`/federasi yang membuka ingest ke internet publik.

Kalau ragu: hentikan, tulis pertanyaannya di PR atau ke manusia, jangan mengarang keputusan.

---

## 10. Peta dokumen

- `README.md` — cara pakai, API, env, docker (untuk manusia dan agen)
- `AGENTS.md` — berkas ini: aturan dan alur kerja agen
- `docs/rnd/integration-architecture.md` — riset arsitektur integrasi Hermes (opsi push/pull/hybrid)
- `deploy/roster.example.yaml` — contoh override roster

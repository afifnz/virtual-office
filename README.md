# Agent Office — kantor virtual 3D (React + Go)

Kantor virtual tempat 11 profil Hermes punya meja sendiri. Frontend React/three.js,
API Go read-only yang membaca `state.db` Hermes. Menggantikan versi lama
(satu file `index.html` p5.js + `server.py` stdlib Python).

```
backend/   API Go (net/http, modernc.org/sqlite, tanpa cgo)
frontend/  React 18 + Vite + TypeScript + @react-three/fiber
deploy/    systemd unit, blok Caddy, build script, pembuat fixture
verify/    skrip screenshot Playwright + hasil PNG
```

## Isi ruangan

| Ruang | Agen |
|---|---|
| **Pendopo** (depan, z > 4) | Galuh — `default` |
| **Ruang Tim Dev** (kiri belakang) | Bima `dev`, Raka `planner`, Laras `uiux`, Dimas `coder`, Yoga `reviewer`, Sari `tester` |
| **Ruang Tim Edu** (kanan belakang) | Ayu `edu`, Nisa `edu-designer`, Yohan `edu-writer`, Hadi `edu-reviewer` |

`id` agen = nama profil Hermes. Nama tampilan & peran ada di
`frontend/src/lib/agents.ts` (satu sumber untuk 3D, roster, dan kartu).

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

## Deploy (manual, tidak dijalankan otomatis)

1. **Build** di mesin yang sama:
   ```bash
   cd ~/workspace/virtual-office && deploy/build.sh
   ```
2. **API sebagai systemd user unit** (port 8131, menggantikan `office-api`
   Python di 8130 — keduanya bisa hidup berdampingan):
   ```bash
   mkdir -p ~/.config/systemd/user
   cp deploy/virtual-office-api.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now virtual-office-api
   systemctl --user status virtual-office-api --no-pager
   curl -s http://127.0.0.1:8131/api/health
   loginctl enable-linger "$USER"      # supaya tetap jalan setelah logout
   ```
3. **Static frontend**: salin `frontend/dist/` ke root baru, mis.
   `/var/www/office-v2` (jangan menimpa `/var/www/office` sebelum yakin):
   ```bash
   sudo mkdir -p /var/www/office-v2
   sudo rsync -a --delete frontend/dist/ /var/www/office-v2/
   ```
4. **Caddy**: tempel isi `deploy/Caddyfile.block` ke blok situs
   `office.afifnurzein.my.id`, lalu:
   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   curl -s https://office.afifnurzein.my.id/api/health
   ```
5. **Rollback**: `systemctl --user disable --now virtual-office-api`, kembalikan
   blok Caddy lama (proxy ke 8130 + `/var/www/office`).

## API

Read-only, tanpa auth, bind `127.0.0.1` saja (Caddy yang mempublikasikan).

| Endpoint | Isi |
|---|---|
| `GET /api/health` | `{ok, version, now, uptime_s, home, profiles, bind}` |
| `GET /api/status` | `{now, gateway, agents[], feed[], tasks[], comms[]}` |
| `GET /api/agents/{id}` | satu objek agen, `404` kalau tidak ada |

Bentuk JSON identik dengan API lama, jadi reverse proxy/frontend lain tetap cocok.

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
| `blocked` | sesi terakhir berakhir dengan ≥ 2 tool result gagal berturut, atau `end_reason` mengandung error/timeout; berlaku 30 menit |
| `idle` | punya data tapi tidak ada sesi aktif |
| `offline` | profil tidak punya `state.db` |

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

| Variabel | Default | Arti |
|---|---|---|
| `HERMES_HOME` | `~/.hermes` | sumber `state.db` + `gateway_state.json` |
| `PORT` | `8131` | port HTTP |
| `BIND` | `127.0.0.1` | alamat bind |
| `PROFILES` | 11 profil bawaan | daftar profil dipisah koma (mengganti default) |
| `GATEWAY_FILE` | `$HERMES_HOME/gateway_state.json` | status gateway |
| `LOG_REQUESTS` | `0` | log tiap request ke stderr |

Profil yang punya folder `$HERMES_HOME/profiles/<nama>/state.db` otomatis
ditambahkan ke roster walau tidak ada di `PROFILES`.

## Verifikasi

```bash
cd backend  && go vet ./... && go test ./...          # 24 test, semua lulus
cd frontend && npx tsc --noEmit && npm run build      # dist/ (1,04 MB, 289 kB gzip)
python3 verify/shoot.py                               # screenshot + cek layout
```

Hasil terakhir: `go vet` bersih, `go test` ok di api/derive/store, `tsc --noEmit`
tanpa error, `vite build` sukses, dan `verify/shoot.py` melaporkan
`dpad_inside_viewport: true`, `dpad_bar_overlap_px2: 0`,
`no_horizontal_overflow: true`, `feed_sheet_covers_controls: 0`,
`taskboard_fullscreen: true`, tanpa error konsol.

`verify/shoot.py` butuh API di :8131 dan `vite preview` di :4173. Hasil PNG:

- `verify/desktop-1280-overview.png` — Pendopo dengan HUD
- `verify/desktop-1280-overview-clean.png` — ruangan tanpa panel
- `verify/desktop-1280-face-closeup.png` — potret Galuh (`?face=galuh`)
- `verify/desktop-1280-face-crop.png` — crop 900×900 area kepala
- `verify/portrait-galuh.png` / `-crop.png` — potret yang sama, versi file potret
- `verify/portrait-bima.png` / `-crop.png` — potret agen pria (rambut pendek)
- `verify/mobile-390-default.png` — HUD satu baris, feed tertutup
- `verify/mobile-390-feed.png` — bottom sheet Aktivitas
- `verify/mobile-390-taskboard.png` — taskboard satu kolom penuh
- `verify/mobile-390-roster.png` — drawer daftar agen

`verify/shoot.py` juga mengukur tata letak dan mencetak JSON: D-pad & bar di
dalam viewport, tanpa overflow horizontal, taskboard setinggi layar, dan
D-pad disembunyikan saat sheet terbuka (tidak ada yang menutupi kontrol).
`verify/portrait.py <id|nama>` mengambil satu potret, `verify/mobile.py`
mengulang tiga tangkapan panel HP.

Pemeriksaan pose (dipakai untuk merapikan avatar di skala dashboard):

- `verify/pose_check.py` — membaca scene yang hidup dan mencetak, per agen:
  tinggi pinggul vs dudukan kursi, kerataan paha, sudut lutut kiri/kanan,
  tinggi sol sepatu, dan posisi kedua pergelangan vs kotak keyboard. Exit
  non-zero kalau ada yang melenceng (melayang, kaki menembus lantai, lutut
  asimetris).
- `verify/final_shots.py` — `final-overview.png` (spot "Tampak", semua agen
  ditahan di meja lewat `?still=1`) dan `final-closeup.png` (satu agen duduk
  dari samping, memperlihatkan lutut, telapak, dan tangan di keyboard).
- `verify/face_sym.py <id>` — potret lurus dengan kamera dipaku di normal
  wajah (`?cam=&aim=`) lalu skor beda cermin, untuk memisahkan asimetri
  geometri mata dari asimetri pencahayaan.

## Catatan desain (beda dari versi p5)

- **Avatar = GLB manusia rigged (Quaternius Ultimate Modular, CC0 1.0)**, bukan
  primitif lagi. Lima model di `frontend/public/models/` (men-suit, men-casual,
  men-hoodie, women-casual, women-formal), satu per agen lewat
  `MODEL_FOR_AGENT`; tiap agen dapat klon sendiri (`SkeletonUtils.clone`) jadi
  skeleton dan material tidak pernah dipakai bersama. Model diskalakan ke 1,7 m,
  diputar 180° (paket menghadap +Z, kantor menghadap −Z), dan variasi per agen
  datang dari override warna material per peran (Skin/Hair/Shirt/Pants/Shoes).
- **Pose duduk tanpa klip Sit**: paket hanya punya Idle/Walk/Run/Interact. Duduk
  tidak dibentuk dari sudut tulang tebakan, tapi dipecahkan terhadap furnitur:
  `instantiate()` mengukur panjang paha, betis, lengan atas/bawah dan tinggi
  mata kaki tiap model, lalu `pose()` mengarahkan tiap tulang ke titik yang
  diturunkan dari kursi (dudukan 0,4725 m), lantai, dan keyboard
  (`aim()` + IK dua tulang untuk siku). Hasilnya: pinggul mendarat di dudukan,
  paha mendatar, lutut 90°, telapak di lantai, dan kedua pergelangan tepat di
  atas tuts — simetris karena target kiri/kanan dicerminkan, bukan karena
  kebetulan rotasi tulang. `verify/pose_check.py` mencetak angka itu per agen
  (hip, sudut lutut, tinggi sol, posisi wrist) dan gagal kalau melenceng.
  Tulang kaki paket ini menempel ke `Body`, bukan ke shin, jadi tumit
  ditempatkan ulang tiap frame agar kaki ikut lutut dan tidak menembus lantai.
  Berdiri/berjalan memakai klip `Walk` yang waktunya disinkronkan ke jarak
  tempuh, diam di POI memakai `Idle_Neutral`.
- **Proporsi & kontras**: kepala dikecilkan lewat skala tulang `Head` (0,94),
  pakaian dicampur 8–14% putih plus sedikit emissive per peran, kursi dibuat
  lebih gelap dari outfit mana pun, dan apron depan meja ditipiskan jadi bibir
  5,8 cm supaya pangkuan tidak menembus meja. Lid laptop juga direndahkan agar
  dada tetap terlihat dari kamera "Tampak".
- **Wajah**: Quaternius hanya memberi mata berupa dua quad hitam dan tidak punya
  mulut, jadi `scene/face.ts` menambahkan bola mata (sklera + iris + pupil +
  kilau), kelopak yang berkedip, lubang hidung, dan bibir. Posisinya diukur dari
  mesh mata dan permukaan kepala model itu sendiri (raycast bbox + sampel
  vertex), sehingga menempel benar di kedua paket. Hijab/ kacamata/ headphone
  dibangun di ruang model dan dipasang ke tulang `Head` lewat matriks tetap.

- **Tanpa shadow map**: kontak bayangan pakai tekstur radial. Ini menjaga fps
  di HP kelas bawah dan menghindari moiré yang dulu muncul di atap/tepi.
- **Label = sprite canvas**, bukan `troika`/webfont: tetap tajam dan tetap
  tampil tanpa jaringan (font sistem).
- **Tidak ada atap** supaya kamera "Tampak" bisa melihat ke dalam ruangan
  seperti dollhouse; versi lama memakai atap joglo penuh.
- **Laptop, bukan monitor 27"**, di sisi meja (diputar 43°) supaya wajah agen
  tetap terlihat dari sudut pandang pengunjung. Nameplate diperkecil (0,3 unit)
  agar tidak menutupi orangnya.
- **Deep link potret**: `?face=galuh` (atau `?face=dev`) menerbangkan kamera ke
  potret 3/4 dengan lensa 30° pada jarak 1,4 m — dipakai `verify/shoot.py`
  sebagai bukti wajah. `#coder` tetap membuka meja agen seperti versi lama.
- **Mobile**: feed jadi bottom sheet 58–62dvh yang bisa ditutup, taskboard
  full-screen satu kolom, kartu agen jadi chip yang hilang sendiri setelah 5 s,
  HUD satu baris yang bisa di-collapse, tombol ≥ 44 px, `100dvh` + safe-area,
  D-pad di kiri bawah dan bar panel di bawah — tidak ada yang menutupi D-pad.
- **Kedalaman tampilan** dibatasi `dpr` 1.8 (desktop) / 1.5 (mobile) dan
  polling 4 detik dengan backoff 6/12/24/30 detik (sama seperti versi lama).

## Sisa pekerjaan deploy

Lihat bagian **Deploy** di atas. Yang sengaja belum dijalankan dari sesi ini:
`systemctl --user enable --now virtual-office-api`, penyalinan ke
`/var/www/office-v2`, dan reload Caddy.

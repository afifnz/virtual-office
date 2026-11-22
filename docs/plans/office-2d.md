# Kantor 2D Pixel-Art — mengganti scene three.js dengan canvas 2D prosedural

**Status:** rencana (belum dieksekusi) · **Branch:** `feat/office-2d` (base `origin/main` @ `a05fc44`)
**Goal:** mengganti scene 3D `@react-three/fiber` + three.js dengan kantor 2D pixel-art top-down
di satu `<canvas>` HTML5 2D, sprite prosedural 100% kode sendiri, tanpa mengubah kontrak
`/api/config` & `/api/status`, tanpa menyentuh backend Go, dan menghapus three dari bundle.
**ui: yes** — orchestrator mengirim rencana ini ke `uiux` dulu; hasil desain diharapkan di
`docs/design/office-2d.md` (palet final, motif zona, spesifikasi sprite & panel). Task visual
di bawah merujuk dokumen itu; scaffolding boleh mulai dengan palet aksen `TEAMS` yang ada.

**Non-goals (di luar lingkup, dilarang dikerjakan):**
- Editor layout per-tile, peluncuran terminal dari kanvas, wardrobe karakter, chat dengan agen.
- Menyalin sprite/aset/kode dari repo referensi (lisensi bukan milik kita — lihat atribusi).
- Mengubah kontrak API, menambah field backend, atau menyentuh `backend/` sama sekali.
- Mengubah data koordinat: `lib/rooms.ts`, `lib/agents.ts`, `lib/layout.ts`, `lib/roster.ts`,
  `lib/nav.ts`, `lib/routes.ts` adalah **satu sumber koordinat** dan dibekukan untuk fitur ini.
- Menambah dependensi npm baru (AGENTS.md §9: butuh keputusan manusia). Font pixel pun prosedural.

**Commands:**
- typecheck = `cd frontend && npx tsc --noEmit`
- build = `cd frontend && npm run build`
- geometri = `frontend/node_modules/.bin/esbuild verify/roster_check.ts --bundle --format=esm --platform=node --outfile=/tmp/roster_check.mjs && node /tmp/roster_check.mjs` (idem `layout_check.ts`)
- e2e = `bash verify/e2e_review.sh`
- backend (DoD, tidak berubah) = `cd backend && GOTMPDIR=/workspace/.gotmp TMPDIR=/workspace/.gotmp go vet ./... && go test -count=1 ./...`

---

## Analysis

### Requirement fungsional
1. Scene 3D diganti kantor 2D pixel-art top-down/2.5D di atas grid tile persegi (bukan isometrik
   diamond), gaya "cutaway diorama": dinding tebal, lantai bermotif beda per zona, furnitur
   dekoratif dengan sedikit elevasi depan, karakter chibi menghadap depan.
2. Satu `<canvas>` 2D; semua sprite digambar prosedural oleh kode sendiri (`fillRect` per pixel),
   `imageSmoothingEnabled=false`, nearest-neighbor, skala integer, palet terbatas 2–3 tone shading.
   **Tanpa file aset eksternal** (bebas lisensi).
3. 13 profil, 3 zona, nama/peran dari `/api/config`; seat dari satu sumber koordinat yang ada:
   Pendopo (default + resepsionis), Tim Dev (dev, planner, uiux, coder, coder2, reviewer, tester,
   devops di samping rak server), Tim Edu (edu, edu-designer, edu-writer, edu-reviewer).
4. Status terbaca jelas di kanvas: working/idle/reviewing/blocked/offline + tool saat ini +
   counter hari ini + task (id, bukan judul). Kursi offline **tetap digambar** (redup + label),
   tidak dihilangkan.
5. Animasi digerakkan aktivitas **nyata** dari `/api/status` (`current.tools`, `current.kind`,
   `comms`) — pemetaan wajib di §Technical design. Tidak ada state backend baru.
6. Panel Roster/Feed/TaskBoard/Hud/KPI/ProximityCard tetap berfungsi, di-restyle pixel; roster
   tetap bisa discroll (overflow nyata, dibuktikan `scrollTop` berubah).
7. Responsif: desktop 1280×800 + HP 390×844; sidebar jadi sheet/accordion di mobile, toolbar
   tetap, kontrol zoom di tepi kanvas.
8. Dependensi `three`, `@react-three/fiber`, `@react-three/drei`, `@types/three` hilang dari
   `package.json` dan bundle; ukuran bundle sebelum/sesudah dilaporkan (angka nyata di bawah).

### Requirement non-fungsional
- **Kontrak API stabil** (AGENTS.md §1.3): frontend hanya konsumen; `types.ts`, `lib/api.ts`,
  `hooks/useStatus.ts`, `hooks/useKPI.ts` tidak berubah.
- **Fallback outage**: config gagal → `seedConfig()` tetap menggambar 13 meja; status gagal →
  `offlinePayload()` semua kursi offline + banner data basi (`stale`). Outage ≠ kantor kosong.
- **Privacy metadata-only**: yang dirender hanya status, nama tool, timestamp, counter, id task,
  siapa-bicara-ke-siapa. Jangan pernah merender isi pesan/judul task (API memang tidak mengirimnya;
  chip blocked memakai teks generik, bukan `blocked.reason` mentah).
- **Tes geometri tetap hijau**: `verify/roster_check.ts` & `verify/layout_check.ts` (esbuild+node,
  tanpa browser) menguji data koordinat — bukan render. Keduanya hijau di base (diverifikasi saat
  planning: `ROSTER OK`, `LAYOUT OK`).
- Performa: 60 fps di laptop menengah; layer statis di-prerender sekali, loop per-frame hanya
  menggambar agen + chip; pause saat `document.hidden`.
- Deterministik: config yang sama → kantor yang sama (sudah dijamin `roster.ts`; render tidak
  boleh menambah randomness yang tidak di-seed).

### Kriteria penerimaan (definition of done fitur ini)
- [ ] `npx tsc --noEmit && npm run build` hijau; tidak ada chunk `three` di `dist/assets/`.
- [ ] `roster_check.ts`, `layout_check.ts`, dan `verify/anim_check.ts` (baru) semuanya OK.
- [ ] `bash verify/e2e_review.sh` lulus (51 pemeriksaan; berbasis API + webroot sintetis, tidak
      depend pada scene — diverifikasi saat planning).
- [ ] Screenshot desktop 1280×800 + mobile 390×844 + verdict `vision_analyze` (AGENTS.md §5).
- [ ] Screenshot mode offline (API mati): 13 meja tetap tergambar, semua offline, banner basi.
- [ ] Bukti scroll roster: `scrollTop` `.roster-body` berubah dari 0 → >0 (snippet di T1.9).
- [ ] Tabel bundle sebelum/sesudah (raw + gzip per chunk) ditempel di PR.
- [ ] File atribusi ada (`docs/attribution-2d.md`), tidak ada aset pihak ketiga di bundle.
- [ ] Backend tidak tersentuh (`git diff --stat origin/main -- backend/` kosong).

### Asumsi & pertanyaan terbuka
- **A1** Bos sudah memutuskan identitas visual baru (2D pixel) — ini keputusan manusia yang
  dibutuhkan AGENTS.md §9, jadi tidak perlu tanya ulang soal gaya.
- **A2** `?face=<id>` tetap didukung sebagai deep-link, tapi bermakna baru: zoom dekat ke meja
  agen (bukan potret wajah 3D). `?spot=`, `?still=1` tetap didukung dengan semantik viewport 2D.
  `?cam=&aim=` (diagnostik kamera 3D) hilang bersama skrip pemakainya.
- **Q1 (butuh bos, AGENTS.md §9)** GLB Quaternius di `frontend/public/models/` (~8 MB) tidak
  dipakai lagi tapi ikut tersalin ke `dist/`. Menghapus/memindah aset berlisensi butuh keputusan
  manusia. **Default rencana: biarkan file + LICENSE apa adanya** (tidak di-fetch oleh aplikasi
  2D); usulkan pengarsipan sebagai follow-up terpisah.
- **Q2** Skrip `verify/*.py` khusus 3D (19 file, bergantung `__officeScene`/WebGL/swiftshader)
  menjadi usang. Default: hapus di T2.5 (riwayat git menyimpan); alternatif arsip ke
  `verify/legacy3d/`. Konfirmasi bos saat review PR.
- **Q3** Animasi jalan antar-meja saat delegasi: agen berjalan ke `DESK_EXIT` agen target (atau
  POI `rapat` bila target tak dikenal), berdiri ~6–10 dtk, lalu pulang via `homeward()`. Rute
  memakai `lib/routes.ts` yang sudah teruji bebas furniture. Diasumsikan cukup; tidak ada
  state backend baru.
- **Q4** Dokumen desain `uiux` (`docs/design/office-2d.md`) idealnya selesai sebelum T1.4
  (palet/sprite) dan T2.1 (restyle panel) difinalkan; task scaffolding tidak menunggu.

---

## Technical design

### Arsitektur & batas frontend/backend
```
/api/config ──► lib/roster.ts (applyConfig/seedConfig)  ─┐  TIDAK BERUBAH
/api/status ──► hooks/useStatus.ts (poll 4s, fallback)  ─┤  (kontrak stabil)
/api/kpi    ──► hooks/useKPI.ts                         ─┘
                        │ props yang sama (status, command, moveIntent, onNear, onMove, onPick)
App.tsx ──► components/Scene.tsx (lazy, double-rAF) ──► scene2d/Office2D.tsx (BARU)
                                                          │
                    ┌─────────────┬─────────────┬─────────┴───┬──────────────┐
              viewport.ts     render.ts     sprites.ts     anim.ts      pixelfont.ts
              (world↔pixel,   (layer painter, (draw* prosedural, (poseFor murni, (font 5×7
               zoom integer,   prerender      cache offscreen)  rute via        prosedural)
               pan, hit-test)  statis)                          lib/routes)
```
- Backend Go **tidak disentuh**. Tidak ada endpoint/field baru.
- `lib/rooms|agents|layout|roster|nav|routes|presence|types|api|format` dibekukan (kecuali
  `lib/focus.ts` yang hanya ganti sumber tipe). Tes geometri karena itu tetap hijau by construction.
- Tipe `RigCommand`/`MoveIntent` pindah dari `scene/CameraRig.tsx` ke modul murni baru
  `lib/view.ts` (bentuk sama persis) supaya `App.tsx`, `DPad.tsx`, `lib/focus.ts` tidak lagi
  mengimpor apa pun dari direktori scene — pola type-only import yang sudah ada dipertahankan
  agar entry bundle tidak menyeret chunk scene.

### Keputusan render (sudah diputuskan bos, diikuti)
- Satu `<canvas>` HTML5 2D. Sprite prosedural digambar langsung di canvas (offscreen cache per
  sprite), `imageSmoothingEnabled=false`, skala integer. Tanpa file aset eksternal.
- Layer (urutan gambar): **lantai → pola/motif zona → dinding → furnitur → meja+kursi → agen →
  nameplate/chip → overlay UI**. Overlay UI (tombol zoom, panel) adalah DOM, bukan canvas.
- Animasi: idle bob, gelembung "..." saat working, jalan singkat antar meja (murah: rute sudah
  ada dan teruji di `lib/routes.ts` + `lib/nav.ts`).
- Palet hangat terakota + navy kontras tinggi (aksen zona sudah ada di `TEAMS`:
  lobby `#d4805c`, dev `#82aac8`, edu `#deb860`); shading 2–3 tone per objek.
- Font pixel prosedural (glyph 5×7 digambar `fillRect`) untuk label in-world; sans-serif bersih
  untuk panel UI. Tidak ada webfont/dep baru.

### Pemetaan world → pixel (modul `scene2d/viewport.ts`)
- Sumber: `FLOOR = {w:28, d:20}` dari `lib/rooms.ts`. World x ∈ [-14,14], z ∈ [-10,10].
- **TILE = 16 px per world unit** pada skala dasar. Rumus:
  `px = (x + FLOOR.w/2) * TILE`, `py = (z + FLOOR.d/2) * TILE`.
  Sumbu +z dunia = bawah layar: dinding belakang (z=-10) di atas, pintu MASUK (z=+10) di bawah —
  Pendopo di depan/bawah, Tim Dev kiri-atas, Tim Edu kanan-atas, persis denah `WALLS`.
- Permukaan world offscreen: 448×320 px (28×20 tile), plus pita luar ~3 tile untuk batur/halaman
  sederhana (pengganti `Exterior` 3D, murah: beberapa tone hijau + gapura pixel di sisi bawah).
- **Zoom integer** `z ∈ {1,2,3,4}`; default desktop 2 (896×640, muat di area kanvas ±960×800
  setelah sidebar), default mobile 1 (448×320, pan horizontal). Kontrol `+`/`−` di tepi kanvas
  (DOM), wheel zoom ke arah kursor, drag/1-jari pan, pinch zoom (snap ke integer), WASD/panah
  dan DPad = pan (bukan jalan first-person lagi).
- **DPR pecahan tetap crisp**: backing store = ukuran CSS × dpr; faktor blit integer
  `s = max(1, floor(zoom * dpr))`; world offscreen di-`drawImage` dengan faktor `s` ke backing
  store, lalu CSS size = backing/dpr. Semua penskalaan integer → nearest-neighbor murni.
- Preset spot (`SPOTS` di rooms.ts tetap data; viewport menerjemahkan): `lobby/dev/edu` →
  pusat zona + zoom 2/3; `tampak` → seluruh lantai zoom-fit; `luar` → zoom 1 + pita exterior;
  `focus {x,z}` (klik agen/deep-link) → pusat meja zoom 3; `tight` (`?face=`) → zoom 4.
- Hit-test klik: inverse transform layar→world, cari agen dengan jarak < 0.9 unit dari titik
  (prioritas: kursi/meja agen) → `onPick(id)`; klik kosong → `onPick('')`. `onNear` = agen
  terdekat dari pusat viewport (< 2.5 unit) untuk ProximityCard, dipanggil hanya saat berubah.
- Label in-world pada zoom 1 memakai font skala 2 pixel-per-glyph-pixel (tetap integer) supaya
  nama terbaca di HP; zoom ≥2 skala 1.

### Perlakuan `rot` meja — DATA tidak boleh diubah, render bebas memilih cara menggambar
`verify/roster_check.ts` & `layout_check.ts` menguji **data**: posisi (x,z), `rot` (0, π, ±π/2),
blok cluster mepet (pitch 1.62/0.78), lead desk flush + `rot -π/2`, aisle 1.6, determinisme.
Render 2D tidak boleh "memperbaiki" rot agar sprite terlihat benar. Aturannya:
1. **Footprint meja** = `deskObstacle(desk, id)` dari `lib/layout.ts` (AABB world untuk keempat
   rot siku-siku) → dikonversi ke rect pixel. Meja lead (rot -π/2) otomatis menjadi rect vertikal
   1.03×1.62 unit — sama seperti yang diuji tes. Tidak ada geometri meja yang ditulis ulang.
2. **Titik duduk agen** = `seatPoint(meta)` dari `lib/routes.ts` (`desk + (sin rot, cos rot)*0.42`).
   Ini menentukan sisi meja tempat agen appears: rot 0 → agen di sisi bawah meja (layar),
   rot π → sisi atas, rot -π/2 (lead dev) → sisi kanan meja menghadap timnya.
3. **Sprite selalu chibi menghadap depan** (tidak ada sprite punggung). Elevasi "front panel"
   gelap meja digambar di tepi selatan footprint (konvensi diorama); monitor di tengah top
   surface dengan sisi layar menghadap sisi duduk. Untuk baris belakang (rot π) agen otomatis
   tampak "di belakang meja" dari sudut pandang penonton; untuk baris depan (rot 0) sprite agen
   (anchor di kaki, badan ke atas) sedikit menimpa tepi meja — terbaca sebagai duduk di meja,
   gaya Stardew/Gather. Komposisi ini pilihan render, bukan perubahan data.
4. **Urutan gambar**: layer meja statis; layer agen di-sort painter's algorithm by world-z
   (makin selatan makin akhir). Nameplate/chip selalu paling akhir per agen.
5. Kursi digambar di `seatPoint` (bagian layer meja); agen offline → kursi kosong + meja &
   nameplate diredupkan (alpha ±0.5), label "offline" tetap ada.

### Pemetaan perilaku (WAJIB; fungsi murni `poseFor(agent, now, comms)` di `scene2d/anim.ts`)
Semua diturunkan dari field yang sudah ada di `types.ts` — tidak ada state backend baru.
`poseFor` murni (tanpa DOM) sehingga bisa diuji headless via esbuild+node seperti tes geometri.

| Kondisi dari `/api/status` | Pose/animasi di kanvas |
|---|---|
| `status=offline` (atau agen tak ada di payload) | kursi kosong, meja+nameplate redup, label "offline" |
| `status=blocked` (`blocked != null`) | duduk + **chip kuning** di atas kepala "butuh input" (teks generik + `blocked.tools` bila >0; jangan render `reason` mentah), pulse pelan |
| `status=working/reviewing` && `current.tools` ∩ {`terminal`, `execute_code`, `patch`, `write_file`} | **mengetik** di meja: 2-frame tangan naik-turun + gelembung "..." |
| `status=working/reviewing` && `current.tools` ∩ {`read_file`, `search_files`, `web_extract`, `web_search`, `session_search`} | **membaca**: sprite buku/scroll di meja, "..." lebih lambat |
| `status=reviewing` (tanpa tool cocok) | pose membaca + chip kaca pembesar |
| `status=working` (tool lain / kosong) | pose kerja generik + "..." + chip nama tool (`toolLabel()` yang sudah ada) |
| `current.kind='tool'` && tools memuat `delegate_task`, **atau** `comms` punya `kind='delegate'` dari agen ini dalam ±30 dtk | **jalan** ke meja target: `comms.to` → `agentMeta(to).desk` → `onward()` ke `DESK_EXIT` target; target tak dikenal → POI `rapat`. Berdiri 6–10 dtk, pulang `homeward()`. Maks 1 pengunjung per target (pakai `poiTaken`/`walkerPositions` di `lib/presence.ts` yang sudah ada). Amplop pixel kecil melompat from→to saat comm baru (pengganti `Envelopes` 3D, murah). |
| `current.kind='reply'` + `status=idle` | duduk santai, bob pelan, sesekali pose seruput kopi |
| `status=idle` tanpa current | idle bob di kursi; opsional (stretch, tetap di T1): jalan singkat ke POI tim (`POIS` + `onward/homeward`, maks 1–2 walker bersamaan) |

Chip/nameplate per agen (layer terakhir): pill nameplate warna aksen tim (nama, font pixel),
dot status + label tool, chip counter hari ini (`today.messages` pesan · `today.tool_calls` tool),
chip task gelap berisi **id task** dipotong (bukan judul — API hanya mengirim id). Semua teks
in-world lewat cache plate offscreen, bukan `fillText` per frame.

### Loop render & performa (`scene2d/Office2D.tsx` + `render.ts`)
- Prerender **layer statis** (lantai+motif+dinding+furnitur+meja+kursi) ke offscreen sekali per
  perubahan roster/config/resize — bukan per frame. Motif zona: Pendopo kawung-terakota,
  Tim Dev karpet grid navy, Tim Edu check hangat (digambar prosedural, pola 8×8 atau 16×16).
- Furnitur dekoratif dipetakan dari `OBSTACLES` by id (satu sumber!): `server` → rak server
  ber-LED kedip di zona devops, `meja-rapat` → meja rapat tengah Pendopo, `sofa`/`sofa-table`/
  `kopi`/`meja-kopi` → sudut Pendopo, `gamelan`, `papan-dev`/`papan-edu`, `buku`, `lesehan`,
  `resepsionis`, `kucing` (sprite kucing oren 2-frame). Id tak dikenal → kotak furnitur generik.
- Per frame: blit statis → walker/agen (z-sorted, sprite dari cache `Map<key, offscreen>`,
  key = hash look + pose + frame) → chip/bubble → selesai. 13 agen + chip ≪ budget 16 ms.
- rAF dengan delta-time; berhenti saat `document.hidden` (pola `useStatus` sudah ada);
  `?still=1` menahan semua agen di meja untuk screenshot deterministik; hook diagnostik baru
  `window.__office2dReady = true` setelah frame pertama (pengganti `__officeScene` dkk).
- Resize: `ResizeObserver` pada wrap; hitung ulang zoom-fit & clamp pan agar lantai tak keluar
  area saat zoom minimum.

### Kontrak antar-modul (tetap, supaya App/panel tak berubah)
- `OfficeProps` bentuk sama: `{status, command, moveIntent, onNear, onMove, onPick, dpr?}` —
  `dpr` diterima tapi diabaikan (canvas 2D mengatur backing sendiri); `moveIntent` kini pan.
- `lib/view.ts` mengekspor tipe `RigCommand` & `MoveIntent` **identik** dengan yang lama
  (`{spot, nonce, focus?, tight?}` / `{x, z}`) + preset `SPOT_VIEW` murni. `CameraRig.tsx` lama
  tetap mengekspor ulang tipe ini selama masa transisi T1.1 (dihapus di T1.8).
- Tidak ada perubahan props panel mana pun; restyle T2 murni CSS + kelas tambahan bila perlu.

### Ukuran bundle — SEBELUM (diukur nyata di base `a05fc44`, `npm ci && npm run build`)
| Chunk | Raw | Gzip |
|---|---:|---:|
| `index-*.js` (entry) | 44.567 B | 15.254 B |
| `Office-*.js` (scene 3D, lazy) | 91.183 B | 28.720 B |
| `react-*.js` | 147.053 B | 47.552 B |
| `three-*.js` | 890.627 B | 239.429 B |
| **Total JS** | **1.173.430 B (≈1,17 MB)** | **330.955 B (≈331 kB)** |
| `index-*.css` | 20.580 B | 4.800 B |

`three` = 72,3% gzip JS. Tanpa three, JS tinggal 282.803 B raw / 91.526 B gzip; chunk scene 2D
baru diperkirakan 50–80 kB raw (≈18–25 kB gzip) → **target total JS ≈ 250–280 kB raw /
≈95–115 kB gzip (turun ±70%)**. `dist/` total saat ini 8,9 MB termasuk ±8 MB GLB yang tersalin
dari `public/models/` (lihat Q1 — tidak di-fetch aplikasi 2D). Angka SESUDAH wajib diukur ulang
dengan perintah yang sama di T2.3 dan ditempel di PR, bukan estimasi ini.

---

## Inventory file

### Dihapus (T1.8 — scene 3D, 14 file)
`frontend/src/scene/Office.tsx`, `Room.tsx`, `Desk.tsx`, `Furniture.tsx`, `Avatar.tsx`,
`AgentActor.tsx`, `CameraRig.tsx`, `Envelopes.tsx`, `Exterior.tsx`, `Nusantara.tsx`,
`human.ts`, `face.ts`, `toon.ts`, `ndoroKakung.ts` — seluruh direktori `src/scene/`.

### Dihapus (T1.8 — lib bergantung three, hanya dipakai scene 3D)
`frontend/src/lib/label.ts` (plate→`THREE.CanvasTexture`), `frontend/src/lib/textures.ts`
(texture lantai/ukir→three). Pengganti: `scene2d/pixelfont.ts` + cache plate 2D murni.

### Dibuat
| File | Isi |
|---|---|
| `frontend/src/lib/view.ts` | tipe `RigCommand`/`MoveIntent` (pindahan) + preset `SPOT_VIEW` murni |
| `frontend/src/scene2d/viewport.ts` | transform world↔pixel, zoom integer, pan clamp, hit-test, DPR |
| `frontend/src/scene2d/anim.ts` | `poseFor()` murni + state walker (rute via `lib/routes`) |
| `frontend/src/scene2d/palette.ts` | palet terbatas terakota+navy, tone per zona, motif tile |
| `frontend/src/scene2d/pixelfont.ts` | glyph 5×7 prosedural + pengukur teks |
| `frontend/src/scene2d/sprites.ts` | `drawAgent(look,pose,frame)`, meja, kursi, furnitur per id OBSTACLES, kucing, amplop; cache offscreen |
| `frontend/src/scene2d/render.ts` | prerender layer statis + painter dinamis (agen z-sorted, nameplate/chip) |
| `frontend/src/scene2d/Office2D.tsx` | komponen React: canvas, rAF, resize, input, wiring props |
| `verify/anim_check.ts` | tes murni: pemetaan pose, transform world→pixel, clamp zoom, determinisme (esbuild+node) |
| `verify/office2d_shots.py` | screenshot headless desktop+mobile+offline, tunggu `__office2dReady`, `?still=1` |
| `docs/attribution-2d.md` | sumber inspirasi + lisensi + pernyataan aset prosedural sendiri |
| `docs/design/office-2d.md` | (oleh uiux, bukan coder) spesifikasi visual final |

### Diubah
| File | Perubahan |
|---|---|
| `frontend/src/components/Scene.tsx` | lazy import → `scene2d/Office2D`; teks placeholder "memuat kantor 2D"; pola double-rAF + fallback timeout **dipertahankan** |
| `frontend/src/App.tsx` | import tipe dari `lib/view`; semantik DPad=pan; deep-link `#id`/`?face=`/`?spot=` tetap (focus→zoom) |
| `frontend/src/components/DPad.tsx` | import tipe dari `lib/view`; label/aria jadi "geser tampilan" |
| `frontend/src/lib/focus.ts` | import tipe dari `lib/view` (tetap murni, tanpa scene) |
| `frontend/src/styles/global.css` | tema pixel panel (T2.1–T2.2); overflow roster dipertahankan |
| `frontend/src/components/{Hud,Roster,Feed,TaskBoard,KPI,ProximityCard}.tsx` | hanya bila restyle butuh kelas/markup kecil; props & logika tetap |
| `frontend/package.json` + `package-lock.json` | hapus `three`, `@react-three/fiber`, `@react-three/drei`, `@types/three` |
| `frontend/vite.config.ts` | hapus cabang `manualChunks` three; **pertahankan** cabang react + baris `vite/preload-helper` |
| `README.md`, `AGENTS.md` | §diagnostik & peta repo: scene 2D, `__office2dReady`, baris swiftshader usang (T2.5) |

### Dihapus (T2.5 — skrip verify khusus 3D; semuanya bergantung `__officeScene`/WebGL/swiftshader)
`verify/compact_shots.py`, `face_shot.py`, `face_sym.py`, `final_shots.py`, `layout_probe.py`,
`layout_shots.py`, `mobile.py`, `mouth_check.py`, `ndoro_shots.py`, `neck_mobile.py`,
`neck_probe.py`, `neck_shot.py`, `overview_glb.py`, `perf_glb.py`, `portrait.py`,
`portrait_glb.py`, `pose_check.py`, `refresh.py`, `shoot.py` (+ direktori artefak `verify/neck/`
bila hanya berisi ukuran 3D — periksa isinya dulu; PNG sudah di-gitignore).

### Tidak disentuh (dibekukan)
`backend/**`, `deploy/**`, `frontend/src/lib/{rooms,agents,layout,roster,nav,routes,presence,types,api,format}.ts`,
`frontend/src/hooks/*`, `frontend/public/models/**` (Q1), `verify/{roster_check,layout_check}.ts`,
`verify/e2e_review.sh`, `.github/workflows/*`.

---

## Tasks

Dua paket kerja untuk orchestrator: **T1 = scene 2D** dan **T2 = panel + deps + atribusi**.
Subtask kecil berurutan; build harus tetap hijau setelah tiap subtask. Semua `[fe]` kecuali
bertag `[test]`. Tidak ada task `[be]`/`[db]` — backend dilarang disentuh.

### T1 — Scene 2D + sprites + animasi + zoom/pan + wiring App

**T1.1 `[fe]` Ekstrak tipe view ke `lib/view.ts`**
- Files: `frontend/src/lib/view.ts` (buat), `scene/CameraRig.tsx` (re-export tipe dari lib/view),
  `App.tsx`, `components/DPad.tsx`, `lib/focus.ts` (ganti sumber import tipe).
- Test first: tidak ada perilaku baru; gate = typecheck.
- Implement: pindah `RigCommand`/`MoveIntent` verbatim + `SPOT_VIEW` (data pusat/zoom per spot).
- Verify: `npx tsc --noEmit && npm run build` hijau; geometri checks OK.
- Depends: none. **Independen, bisa paralel dengan T1.2/T1.4.**

**T1.2 `[test]` Tes murni untuk anim & viewport (RED)**
- Files: `verify/anim_check.ts` (buat).
- Test first (ini tesnya): kasus `poseFor` untuk seluruh baris tabel pemetaan (offline, blocked,
  typing, reading, delegate→walk, reply+idle, idle); roundtrip `worldToPixel/screenToWorld`;
  clamp zoom integer 1..4; determinisme (dua panggilan sama → hasil sama); chip blocked tidak
  berisi `reason` mentah. Impor dari `scene2d/anim` & `scene2d/viewport` yang belum ada.
- Verify: esbuild+node → **gagal dulu** (modul belum ada), lalu hijau setelah T1.3.
- Depends: none.

**T1.3 `[fe]` `anim.ts` (poseFor) + `viewport.ts` (matematika) — GREEN**
- Files: `frontend/src/scene2d/anim.ts`, `frontend/src/scene2d/viewport.ts` (buat).
- Implement: fungsi murni sesuai tabel pemetaan + transform TILE=16, zoom integer, pan clamp,
  hit-test. Tanpa DOM di fungsi yang diuji (canvas hanya di Office2D/render).
- Verify: `frontend/node_modules/.bin/esbuild verify/anim_check.ts --bundle --format=esm --platform=node --outfile=/tmp/anim_check.mjs && node /tmp/anim_check.mjs` → `ANIM OK`; `npx tsc --noEmit`.
- Depends: T1.2.

**T1.4 `[fe]` Palet + font pixel prosedural**
- Files: `frontend/src/scene2d/palette.ts`, `frontend/src/scene2d/pixelfont.ts` (buat).
- Implement: palet terbatas (terakota/navy + aksen `TEAMS`), shading 2–3 tone; glyph 5×7
  (A–Z, 0–9, tanda baca) sebagai array bitmask; motif tile 3 zona. Finalkan mengikuti
  `docs/design/office-2d.md` bila sudah ada.
- Verify: `npx tsc --noEmit && npm run build`; cek glyph via `anim_check` (lebar teks deterministik).
- Depends: none (paralel dengan T1.2/T1.3).

**T1.5 `[fe]` Sprites prosedural + cache**
- Files: `frontend/src/scene2d/sprites.ts` (buat).
- Implement: `drawAgent(ctx, look, pose, frame)` memetakan field `Look` yang ada (skin/hair/
  style/shirt/pants/accent, glasses, peci, mustache, stubble, female/skirt, build/tall → variasi
  chibi 12×16 px); meja (top terang + front panel gelap + monitor), kursi, furnitur per id
  `OBSTACLES`, kucing oren, amplop. Cache `Map<key, HTMLCanvasElement>`; key dari `hashId` look
  + pose + frame. Semua `fillRect`, tanpa aset eksternal.
- Verify: `npx tsc --noEmit && npm run build`.
- Depends: T1.4.

**T1.6 `[fe]` Renderer layer (statis + dinamis)**
- Files: `frontend/src/scene2d/render.ts` (buat).
- Implement: prerender lantai 28×20 tile → motif zona → dinding tebal dari `WALLS` (celah pintu
  + label pixel dari `DOORS`) → furnitur dari `OBSTACLES` → meja dari `rosterAgents()` +
  `deskObstacle()` + kursi di `seatPoint()`; dinamis: agen z-sorted, nameplate pill aksen tim,
  dot status + tool, chip counter `today`, chip task (id), bubble "...", chip kuning blocked,
  offline redup. Pita exterior sederhana untuk spot `luar`.
- Verify: `npx tsc --noEmit && npm run build`; geometri checks OK (tidak menyentuh lib).
- Depends: T1.3, T1.5.

**T1.7 `[fe]` `Office2D.tsx` + ganti lazy Scene**
- Files: `frontend/src/scene2d/Office2D.tsx` (buat), `frontend/src/components/Scene.tsx` (ubah).
- Implement: canvas + rAF delta-time (pause saat hidden), ResizeObserver + backing integer-DPR,
  pointer pick→`onPick`, `onNear` dari pusat viewport, wheel/drag/pinch + tombol zoom DOM di tepi
  kanvas, keyboard pan, walker delegasi/idle via `onward/homeward/retrace/avoid` + `lib/presence`,
  amplop comms, `?still=1`, `window.__office2dReady`. `Scene.tsx`: lazy → `Office2D`, placeholder
  "memuat kantor 2D", pola double-rAF + timeout 1500 ms tetap.
- Verify: `npx tsc --noEmit && npm run build`; `npm run dev` manual: kanvas muncul, klik agen
  membuka ProximityCard, zoom/pan jalan.
- Depends: T1.1, T1.6.

**T1.8 `[fe]` Wiring App + hapus scene 3D**
- Files: `App.tsx`, `components/DPad.tsx` (semantik pan), hapus seluruh `src/scene/` (14 file)
  + `lib/label.ts` + `lib/textures.ts`.
- Implement: deep-link `#id`/`?face=`→focus zoom, `?spot=`→preset; DPad menggerakkan pan;
  tidak ada lagi import dari `src/scene`.
- Verify: `npx tsc --noEmit && npm run build` → **tidak ada chunk `three-*.js` di output**
  (deps masih terpasang tapi tak diimpor); `grep -rn "from '.*scene/" src` kosong;
  roster_check + layout_check + anim_check OK.
- Depends: T1.7.

**T1.9 `[test]` Gate visual + fallback + scroll**
- Files: `verify/office2d_shots.py` (buat).
- Implement: chromium headless (tanpa swiftshader — canvas 2D), tunggu `__office2dReady`,
  `?still=1`; shot desktop 1280×800 & mobile 390×844; shot offline (route `/api/*` → abort):
  13 meja tergambar, semua offline, banner basi; bukti scroll roster via CDP evaluate:
  ```js
  const el = document.querySelector('.roster-body');
  const before = el.scrollTop; el.scrollTop = el.scrollHeight;
  ({before, after: el.scrollTop, overflow: el.scrollHeight > el.clientHeight})
  ```
  `after > before` dan `overflow === true` wajib. Jalankan `vision_analyze` pada shot desktop
  & mobile, simpan verdict.
- Verify: skrip menghasilkan PNG + JSON bukti; verdict vision dicatat di ledger.
- Depends: T1.8.

### T2 — Restyle panel + responsive + hapus deps three + atribusi

**T2.1 `[fe]` Tema pixel panel (desktop)**
- Files: `frontend/src/styles/global.css`, kelas kecil di `components/{Hud,Roster,Feed,TaskBoard,KPI,ProximityCard}.tsx` bila perlu.
- Implement: token palet selaras kanvas; border 2 px keras, shadow tanpa blur, sudut tegas;
  sans-serif UI tetap; dot status & aksen tim konsisten dengan sprite. **Pertahankan**
  `.roster-body { overflow-y: auto }` + tinggi terbatas (regresi cc2add3 jangan terulang).
  Props/logika panel tidak berubah. Ikuti `docs/design/office-2d.md`.
- Verify: `npm run build`; shot T1.9 diulang; bukti scrollTop roster lulus.
- Depends: gate setelah T1.8 (draft CSS boleh paralel dengan T1).

**T2.2 `[fe]` Responsive mobile: sheet/accordion + toolbar**
- Files: `global.css`, `App.tsx` (bila perlu kelas sheet), `components/Scene.tsx` tidak berubah.
- Implement: 390×844 — Roster/Feed jadi bottom sheet/accordion, toolbar bawah tetap, tombol
  zoom terjangkau jempol, kanvas default zoom 1 + pan; tidak ada elemen menutupi kontrol.
- Verify: shot mobile 390×844 + verdict vision; sheet buka/tutup manual di dev server.
- Depends: T2.1.

**T2.3 `[fe]` Hapus dependensi three + bersihkan vite config**
- Files: `frontend/package.json`, `package-lock.json` (via `npm install` setelah edit),
  `frontend/vite.config.ts`.
- Implement: hapus `three`, `@react-three/fiber`, `@react-three/drei`, `@types/three`;
  hapus cabang `manualChunks` three; **jangan hapus** baris `vite/preload-helper` → react
  (jebakan lama: helper terseret ke chunk scene). Komentar config diperbarui.
- Verify: `npm ci && npx tsc --noEmit && npm run build`; `ls dist/assets` tanpa `three-*.js`;
  `grep -l "WebGLRenderer" dist/assets/*.js` kosong; ukur ulang tabel bundle (raw+gzip per
  chunk, perintah sama dengan baseline) → tempel di PR; geometri + anim + e2e hijau.
- Depends: T1.8 (semua import three sudah hilang).

**T2.4 `[fe]` Hapus skrip verify 3D usang + perbarui dokumen**
- Files: 19 skrip `verify/*.py` (daftar di inventory), `README.md` (bagian diagnostik/screenshot),
  `AGENTS.md` (§2 peta repo: `src/scene2d/`; §8 baris swiftshader & avatar Quaternius usang).
- Implement: hapus skrip yang bergantung `__officeScene`/WebGL; ganti rujukan screenshot ke
  `verify/office2d_shots.py`; periksa `verify/neck/` sebelum menghapus (artefak ukuran 3D).
- Verify: `grep -rn "__officeScene\|swiftshader" verify/ README.md AGENTS.md` hanya menyisakan
  catatan sejarah bila ada; `bash verify/e2e_review.sh` tetap lulus.
- Depends: T1.8. **Paralel dengan T2.1–T2.3.** (Q2: bila bos memilih arsip, pindahkan, jangan hapus.)

**T2.5 `[fe]` File atribusi**
- Files: `docs/attribution-2d.md` (buat).
- Isi: inspirasi gaya dari `github.com/eliautobot/my-virtual-office` dan
  `github.com/pixel-agents-hq/pixel-agents` (cek & catat lisensi masing-masing saat menulis;
  konteks menyebut AGPL/Metro City — **tidak ada kode/sprite/aset yang disalin**, hanya gaya
  umum pixel-art top-down); seluruh sprite/font/palet di `scene2d/` kode orisinal repo ini;
  GLB Quaternius CC0 tetap di `public/models/` beserta `LICENSE-quaternius.txt` (tidak dipakai
  scene 2D; pengarsipan menunggu Q1). Tautkan dari README.
- Verify: file ada, klaim lisensi cocok dengan repo referensi (buka keduanya saat menulis).
- Depends: none. **Independen, boleh paralel dengan semua task.**

**T2.6 `[test]` Gate akhir (definition of done penuh)**
- Files: tidak ada kode baru; jalankan semua gate + siapkan body PR (Problem·Change·Proof·Risk).
- Verify (semua wajib, output ditempel di PR):
  1. `cd backend && GOTMPDIR=/workspace/.gotmp TMPDIR=/workspace/.gotmp go vet ./... && go test -count=1 ./...`
  2. `cd frontend && npx tsc --noEmit && npm run build`
  3. `bash verify/e2e_review.sh`
  4. roster_check + layout_check + anim_check (esbuild+node) → ketiganya OK
  5. shot desktop+mobile+offline + verdict `vision_analyze`
  6. bukti scrollTop roster
  7. tabel bundle sebelum/sesudah
  8. `git diff --stat origin/main -- backend/` kosong
- Depends: semua task di atas. Review oleh agen lain (AGENTS.md §6), penulis tidak me-review.

### Graf dependensi & paralelisme
```
T1.1 ─┐            T1.2 → T1.3 ─┐
T1.4 → T1.5 ────────────────────┴→ T1.6 → T1.7 → T1.8 ─┬→ T1.9 → T2.1 → T2.2 ─┐
                                                        ├→ T2.3 ───────────────┤
                                                        └→ T2.4 ───────────────┼→ T2.6
T2.5 (independen, paralel penuh) ──────────────────────────────────────────────┘
```
Aman paralel: {T1.1, T1.2, T1.4, T2.5} di awal; {T1.9/T2.1, T2.3, T2.4} setelah T1.8.

---

## Risiko & jebakan

1. **Tes geometri adalah gate keras.** `roster_check.ts`/`layout_check.ts` mengimpor
   `lib/rooms→roster→layout` (+ `nav`, `routes`). Godaan terbesar coder: "merapikan" rot/posisi
   meja agar sprite 2D terlihat benar. **Dilarang** — rot adalah data; render beradaptasi
   (§perlakuan rot). Jalankan kedua check setelah setiap subtask yang menyentuh `lib/`.
2. **Lazy-load `Scene.tsx` jangan dirusak.** Pola double-rAF + fallback timeout 1500 ms ada
   karena pelajaran performa nyata (komentar di file). `lib/focus.ts` harus tetap type-only
   terhadap modul view agar entry bundle tidak menyeret chunk scene.
3. **Bundle split**: cabang `vite/preload-helper → react` di `manualChunks` wajib bertahan;
   tanpa itu Rollup memarkir helper di chunk scene dan first paint melambat (jebakan lama).
   Sesudah T2.3, pastikan `three` benar-benar hilang dari `dist` (grep `WebGLRenderer`), bukan
   cuma dari `package.json`.
4. **Outage ≠ kantor kosong.** `seedConfig`/`offlinePayload` sudah benar; risiko ada di render
   baru yang hanya menggambar agen dari `status.agents`. Renderer harus menggambar kursi/meja
   dari `rosterAgents()` (bukan dari payload), lalu menimpa status per id. Shot offline wajib.
5. **Privacy**: chip blocked memakai teks generik, bukan `blocked.reason` mentah; chip task
   hanya id; tidak ada `fillText` yang mengambil string dari feed selain kind/tool/counter.
6. **Roster scroll regresi** (pernah terjadi, cc2add3): restyle CSS bisa menghapus overflow.
   Bukti `scrollTop` numerik wajib, bukan klaim visual.
7. **DPR pecahan (HP 1.5/2.625)**: penskalaan naif membuat pixel blur. Resep backing-integer di
   §viewport wajib diikuti; uji di shot mobile.
8. **Screenshot headless**: canvas 2D tidak butuh swiftshader, tapi rAF bisa throttled — tunggu
   `__office2dReady` + `?still=1`, jangan `sleep` buta. Skrip 3D lama akan error kalau dijalankan
   setelah T1.8 (hook `__officeScene` hilang) — hapus di T2.4, jangan biarkan menggantung.
9. **AGENTS.md §9**: hapus GLB berlisensi & tambah dep npm = keputusan manusia. Rencana ini
   tidak melakukan keduanya (Q1; font prosedural). Perubahan identitas visual sudah diputuskan bos.
10. **`e2e_review.sh`** memakai webroot sintetis untuk cek aset statis — tidak terdampak scene,
    tapi jangan ubah perilaku cache/gzip backend; jalankan tetap sebagai gate.
11. **Performa teks**: `fillText`/plate per frame untuk 13 agen × beberapa chip bisa mahal di
    HP murah — cache plate offscreen per (teks, warna, skala), invalidasi hanya saat berubah.
12. **Determinisme walk**: randomness POI harus di-seed dari `hashId(id)` + lantai waktu snapshot
    (`status.now`), bukan `Math.random()` per frame, agar `?still=1` dan screenshot stabil.

---

## Progress ledger

- [x] T1.1 tipe view di `lib/view.ts`, import App/DPad/focus pindah — tsc+build hijau
- [x] T1.2 `verify/anim_check.ts` ditulis (RED)
- [x] T1.3 `anim.ts` + `viewport.ts` — ANIM OK
- [x] T1.4 `palette.ts` + `pixelfont.ts`
- [x] T1.5 `sprites.ts` + cache
- [x] T1.6 `render.ts` layer statis+dinamis
- [x] T1.7 `Office2D.tsx` + Scene lazy baru
- [x] T1.8 wiring App + hapus `src/scene/` + label/textures — build tanpa chunk three
- [ ] T1.9 shot desktop/mobile/offline + verdict vision + bukti scrollTop
- [ ] T2.1 tema pixel panel desktop (overflow roster selamat)
- [ ] T2.2 mobile sheet/accordion + toolbar + zoom terjangkau
- [ ] T2.3 deps three dihapus + vite config bersih + tabel bundle SESUDAH
- [ ] T2.4 skrip verify 3D usang dihapus + README/AGENTS diperbarui
- [ ] T2.5 `docs/attribution-2d.md`
- [ ] T2.6 gate akhir: backend vet+test · tsc+build · e2e 51 cek · roster/layout/anim OK ·
      shot+vision · scrollTop · bundle sebelum/sesudah · `git diff backend/` kosong
- [ ] Q1 (GLB) & Q2 (skrip lama) dijawab bos di review PR
- [ ] PR dibuat oleh orchestrator/bos (rencana ini TIDAK di-commit oleh planner)

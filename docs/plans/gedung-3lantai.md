# Gedung 3 Lantai — mengganti kantor satu lantai dengan gedung modern cutaway

**Status:** rencana (belum dieksekusi) · **Branch:** `feat/gedung-3lantai` (base `origin/main` @ `eb62293`)
**Goal:** mengganti lantai tunggal 28×20 dengan gedung modern 3 lantai (L1 Lobby/Pendopo,
L2 Tim Edu, L3 Tim Dev) bergaya pixel-art prosedural — kaca, baja, lift + tangga — yang
default-nya tampil **cutaway**: tiga slab bertumpuk terlihat sekaligus, 13 agen terbaca,
klik lantai / tombol L1/L2/L3 = zoom integer ke lantai itu. Kontrak `/api/config` &
`/api/status` tidak berubah; `backend/` tidak disentuh.
**ui: yes** — orchestrator mengirim rencana ini ke `uiux` dulu; hasil desain diharapkan di
`docs/design/gedung-3lantai.md` (palet modern, detail fasad kaca/baja, sprite lift/tangga/
resepsionis/sofa/tanaman/kopi, perlakuan plakat per slab). Task visual di bawah merujuk
dokumen itu; scaffolding boleh mulai dengan palet `TEAMS` + `palette.ts` yang ada.

**Keputusan bos (sudah final, tidak ditanya ulang):** gedung 3 lantai, footprint sama per
lantai, cutaway sebagai presentasi default, gaya tetap pixel-art prosedural tanpa aset
eksternal. Semua angka koordinat di §Technical design adalah model yang **sudah disetujui**
— dilarang mengganti angka beku (meja, furnitur, service core, ukuran lantai); node nav
usulan boleh digeser kecil hanya bila gate per-lantai menuntut dan angka beku tidak berubah.

**Non-goals (di luar lingkup, dilarang dikerjakan):**
- Perubahan backend apa pun: tidak ada endpoint/field baru, `git diff origin/main -- backend/`
  wajib kosong. `state.db` tetap read-only.
- Dependensi npm baru atau file aset baru (font pun tetap prosedural `pixelfont.ts`).
- Editor layout per-tile, wardrobe, chat dengan agen, panel baru, mode isometrik,
  first-person, atau kamera 3D. Panel yang ada tidak ditambah/dikurangi.
- Mengubah kontrak `OfficeProps`/props panel secara merusak; perubahan hanya aditif
  (mis. `onFloor?`, `focus.floor`).
- Menghapus/memindah GLB Quaternius di `public/models/` (keputusan manusia, AGENTS.md §9;
  tidak dipakai scene 2D, biarkan apa adanya).

**Commands:**
- typecheck = `cd frontend && npx tsc --noEmit`
- build = `cd frontend && npm run build`
- check murni = `frontend/node_modules/.bin/esbuild verify/<nama>.ts --bundle --format=esm --platform=node --outfile=/tmp/<nama>.mjs && node /tmp/<nama>.mjs`
  (nama: `roster_check`, `layout_check`, `anim_check`, `visual_check`)
- e2e = `bash verify/e2e_review.sh`
- backend (DoD, tidak berubah) = `cd backend && GOTMPDIR=/workspace/.gotmp TMPDIR=/workspace/.gotmp go vet ./... && go test -count=1 ./...`
  (`/tmp` sandbox `noexec`; `/workspace` ext4 bisa exec. Sandbox planning ini tidak punya
  Go — gate backend dijalankan di lingkungan eksekutor; karena `backend/` tak disentuh,
  gate ini trivially hijau bila diff kosong.)

**Baseline terverifikasi saat planning (eb62293):** `ROSTER OK`, `LAYOUT OK`, `ANIM OK`,
`VISUAL OK`, `npx tsc --noEmit` hijau, `git diff --stat origin/main -- backend/` kosong.

---

## Analysis

### Requirement fungsional
1. Satu gedung, tiga lantai dengan footprint **identik** 24×12 unit dunia (x ∈ [-12,12],
   z ∈ [-6,6] lokal per lantai). L1 = Lobby/Pendopo (agen `default`/Ndoro Kakung sebagai
   resepsionis di meja menghadap pintu masuk), L2 = Tim Edu (4 agen), L3 = Tim Dev (8 agen).
2. Presentasi default **cutaway**: tiga slab bertumpuk vertikal, semua 13 agen terlihat,
   nama terbaca, pada desktop 1280×800 maupun HP 390×844. Klik sebuah slab atau tombol
   L1/L2/L3 mem-focus lantai itu (zoom integer 2, slab di tengah).
3. Gaya modern tapi tetap prosedural pixel-art: curtain wall kaca + rangka baja pada pita
   antar-slab, shaft lift digambar sebagai **satu kolom vertikal menerus** menembus ketiga
   slab (service core identik di sisi timur tiap lantai), tangga di sebelahnya, lobby dengan
   resepsionis/sofa/tanaman/kopi/meja rapat. Semua `fillRect`, tanpa file aset.
4. Delegasi lintas lantai: agen berjalan ke node lift lantainya, "naik lift" (animasi
   pendek deterministik), muncul di node lift lantai tujuan, berjalan ke meja target.
   Maks 1 pengunjung per target seperti sekarang. Tanpa field backend baru.
5. Status tetap terbaca: working/idle/reviewing/blocked/offline + tool + counter + task id.
   Kursi offline tetap digambar (redup + kursi kosong + Z Z Z + chip offline). Outage ≠
   kantor kosong: meja digambar dari `rosterAgents()`, bukan dari payload status.
6. Panel Hud/Roster/Feed/TaskBoard/KPI/ProximityCard tetap berfungsi; roster/feed tetap
   docked right rail (desktop) / bottom sheet (HP); `.roster-body` benar-benar overflow.
7. Deep-link: `?floor=1|2|3` focus lantai; `?spot=lobby|dev|edu` legacy dipetakan ke
   floor 1/3/2; `?spot=tampak|luar` = cutaway; `#<id>` dan `?face=<id>` focus agen
   (pindah ke lantainya, zoom 3/4). `?still=1` tetap membekukan animasi.

### Requirement non-fungsional
- **Kontrak API stabil** (AGENTS.md §1.3): `types.ts`, `lib/api.ts`, `hooks/useStatus.ts`,
  `hooks/useKPI.ts` tidak berubah. `/api/config` tetap mengirim `layout.floor {w:28,d:20}`
  dari backend — frontend **mengabaikan** angka itu (footprint diambil dari `FLOORS`);
  `grid`/`aisle` dari config tetap dibaca. Ini keputusan klien, bukan perubahan kontrak.
- **Privacy metadata-only**: chip blocked teks generik (`blockedChipText`, bukan
  `blocked.reason` mentah); chip task hanya id; tidak ada isi pesan/judul yang dirender.
- **Satu sumber koordinat** (AGENTS.md §1.5): `lib/rooms.ts` memiliki `FLOORS`; meja,
  furnitur, nav, POI, dinding, plakat, dan preset view semuanya diturunkan dari sana.
  Tidak ada angka koordinat yang diduplikasi di render/test.
- **Tes geometri per lantai**: `roster_check.ts` & `layout_check.ts` menjalankan seluruh
  set assertion **per lantai** (aisle ≥ 1.6, blok mepet, lead flush, exit/POI bebas
  furniture, errand replay, ruang papasan, graph terhubung, lift/stair ada & terhubung,
  node lift di x,z lokal yang sama di semua lantai) dan tetap hijau.
- **Nameplate CSS px**: anti-overlap solver `placeStacks` dipertahankan; nama depan penuh
  (tanpa stub 3 huruf); `plateScale` 2 di zoom 1, 1 di zoom ≥ 2; zoom integer 1..4 saja.
- **Deterministik**: tidak ada `Math.random`; seed `hashId(id)` + clock render `t`
  (beku saat `?still=1`); config sama → gedung sama.
- Performa: layer statis gedung di-prerender sekali per perubahan config/resize; loop
  per-frame hanya agen + chip + lift + amplop (13 agen ≪ budget 16 ms); pause saat
  `document.hidden`; DPR pecahan tetap crisp (blit integer, pola lama).

### Kriteria penerimaan (definition of done fitur ini)
- [ ] `npx tsc --noEmit && npm run build` hijau; tanpa dependensi/aset baru.
- [ ] `roster_check`, `layout_check`, `anim_check`, `visual_check` semuanya OK —
      roster/layout berjalan per lantai (3× set assertion), termasuk invariant lift/stair.
- [ ] `bash verify/e2e_review.sh` lulus (51 pemeriksaan; tidak depend pada scene).
- [ ] `visual_check`: 13 meja + 13 nameplate, 3 slab, overlap 0, tidak ada yang
      off-canvas di 1000×688 (desktop) dan 390×692 (HP), zoom default integer,
      zoom floor-focus integer.
- [ ] Screenshot desktop 1280×800 + mobile 390×844 (cutaway + floor-focus) + verdict
      `vision_analyze` (AGENTS.md §5).
- [ ] Screenshot offline (API mati): 13 meja tetap tergambar di 3 slab, semua offline,
      banner basi tetap muncul.
- [ ] Bukti scroll roster: `scrollTop` `.roster-body` berubah 0 → >0 (probe).
- [ ] Delegasi lintas lantai terlihat di shot/probe: agen berpindah slab via shaft lift;
      amplop comms terbang antar slab; deterministik pada `?still=1`.
- [ ] Deep-link teruji: `?floor=2`, `?spot=dev` (→L3), `?spot=luar` (→cutaway),
      `#coder` (→L3 zoom 3), `?face=edu` (→L2 zoom 4).
- [ ] Tabel bundle sebelum/sesudah (raw + gzip per chunk) ditempel di PR.
- [ ] `git diff --stat origin/main -- backend/` kosong; backend vet+test hijau.

### Asumsi & pertanyaan terbuka
- **A1** Identitas visual gedung modern sudah diputuskan bos; detail akhir (tone kaca,
  motif slab, sprite lift) menunggu `docs/design/gedung-3lantai.md` dari uiux.
- **A2** Angka `layout.floor` 28×20 yang masih dikirim backend diabaikan klien (lihat
  atas). `seedConfig()` diperbarui ke 24×12; `applyConfig` tidak lagi memakai
  `cfg.layout.floor.w/d` untuk geometri.
- **A3 (keputusan gate, bukan angka baru)** Node lift (7.9,-0.2) berjarak 0.7 dari kabin
  lift (x1=8.6) dan node stair (7.9,3.4) berjarak 0.7 dari obstacle tangga — lebih kecil
  dari ruang papasan 0.25+SIDESTEP=0.75. Karena angka core dibekukan bos, edge yang
  **menyentuh node lift/stair** diuji dengan clearance pejalan RADIUS=0.35 (0.7 ≥ 0.35 ✓),
  bukan PASS=0.75: itu area antrean boarding, bukan lorong papasan. Semua edge sirkulasi
  murni tetap wajib ≥ 0.75. Ini dicatat eksplisit di `layout_check` dan di Risiko #1.
- **A4** POI lama `gamelan` dan `jendela` tidak punya furnitur padanan di denah baru;
  keduanya diganti: L3 = {server, papan}, L2 = {lesehan, buku, papan-edu}, L1 = {kopi,
  meja-kopi, sofa, resepsionis, rapat, kucing}. Konfirmasi bos saat review PR bila
  gamelan ingin dipertahankan sebagai furnitur L3 (di luar angka beku → perubahan denah).
- **Q1** Floor-focus zoom 2 di HP: slab 384×192 → 768×384 px, lebih lebar dari 390 px;
  pan horizontal diperlukan (clamp menjaga slab tetap terlihat penuh secara vertikal).
  Diasumsikan diterima (pola lama: zoom minimum + pan). Alternatif zoom 1 per lantai
  ditolak karena nama/chip jadi terlalu kecil.
- **Q2** Tombol toolbar lama `Luar` digantikan `Gedung` (cutaway). Deep-link `?spot=luar`
  tetap diterima dan dipetakan ke cutaway. Konfirmasi penamaan tombol saat review uiux.

---

## Technical design

### Arsitektur & batas frontend/backend
```
/api/config ──► lib/roster.ts (applyConfig/seedConfig, planning PER LANTAI) ─┐ kontrak
/api/status ──► hooks/useStatus.ts (poll 4s, fallback offline)               ─┤ stabil
/api/kpi    ──► hooks/useKPI.ts                                              ─┘
                        │ props sama (+ onFloor? aditif)
App.tsx ──► components/Scene.tsx (lazy, double-rAF, TIDAK BERUBAH)
              └► scene2d/Office2D.tsx ──► render.ts (gedung cutaway)
                     │                        │
        viewport.ts (math gedung,   sprites.ts (lift, tangga, kaca, baja,
        zoom integer, floor          furnitur modern) + labels.ts (CSS px,
        hit-test)                    solver anti-overlap, per slab)
                     │
        lib/rooms.ts FLOORS ◄── SATU SUMBER: walls, doors, furniture, pois,
        (FloorId 1|2|3)             nav, navEdges, lift, stair per lantai
                     │
        lib/nav.ts (Dijkstra per lantai) · lib/routes.ts (onward/homeward +
        Trip lintas lantai) · lib/presence.ts (posisi + floor)
```
- Backend Go **tidak disentuh**; tidak ada endpoint/field baru.
- `lib/{types,api,format}.ts`, `hooks/*`, `components/{Scene,Roster,Feed,TaskBoard,KPI,
  ProximityCard,DPad}.tsx`, `verify/e2e_review.sh`, `.github/workflows/*` dibekukan.
- `lib/{rooms,agents,layout,roster,nav,routes,presence,view,focus}.ts` dan seluruh
  `scene2d/*` berubah sesuai inventory; `Hud.tsx`/`App.tsx`/`global.css` berubah kecil.

### Model koordinat: `FLOORS` di `lib/rooms.ts` (satu sumber)
```ts
export type FloorId = 1 | 2 | 3
export interface FloorPlan {
  id: FloorId
  label: 'LOBBY' | 'TIM EDU' | 'TIM DEV'   // plakat slab
  name: string                            // nama tampilan
  w: 24; d: 12                            // footprint identik (gedung sungguhan)
  walls: WallSeg[]                        // keliling lokal x[-12,12] z[-6,6]
  doors: Door[]                           // MASUK (L1), LIFT + entrance tangga tiap lantai
  furniture: Obstacle[]                   // non-meja (termasuk kabin lift & tangga)
  pois: Poi[]
  nav: NavNode[]
  navEdges: Array<[string, string]>
  lift: string                            // id node 'lift'
  stair: string                           // id node 'stair'
}
export const FLOORS: Record<FloorId, FloorPlan>
```
Agregat turunan (bukan sumber kedua): `DESKS_BY_FLOOR`, `OBSTACLES_BY_FLOOR`
(furniture + footprint meja dari `deskObstacle`), `NAV_BY_FLOOR`, `WALL_OBSTACLES`
per lantai, `nearestNode(floor, x, z)`, `DESK_EXIT_BY_FLOOR` (rumus `deskExit` lama:
`desk + (sin rot, cos rot) * 2.0`), `CLUSTERS`/`LEAD_DESKS` tetap (dev di L3, edu di L2).
`AgentMeta.desk` bertambah `floor: FloorId`; peta tim→lantai: `lobby=1, edu=2, dev=3`.
`TEAM_CENTRE` (layout.ts) menjadi pusat lokal baru: lobby `[0,1.0]`, dev `[-6.18,-2.79]`,
edu `[-0.19,-2.79]` (usul; anchor lattice untuk agen baru). `DEFAULT_FLOOR` roster =
24×12; `applyConfig` mengabaikan `cfg.layout.floor.w/d` (A2).

Dinding tiap lantai: keliling penuh `WALL_T=0.22` — utara z=-6, barat x=-12, timur x=12,
selatan z=6. **L1 saja** punya celah pintu utama di dinding selatan x ∈ [-2.2,2.2]
(lebar 4.4, plakat `MASUK`); L2/L3 keliling tertutup (akses hanya via lift/tangga).
Pintu lift menghadap barat di tiap lantai, berlabel `LIFT`; entrance tangga di sisi barat.

### Pemetaan agen → lantai (13 agen, nama/peran tetap dari seed)
| Lantai | Tim | Agen (id → nama) | Meja (x, z, rot) lokal |
|---|---|---|---|
| L1 LOBBY | lobby | `default` → Ndoro Kakung (resepsionis) | (-0.5, 2.3, π) menghadap pintu masuk |
| L2 TIM EDU | edu | `edu` → Ayu | (-1.0, -2.4, 0) |
| | | `edu-designer` → Nisa | (0.62, -2.4, 0) |
| | | `edu-writer` → Yohan | (-1.0, -3.18, π) |
| | | `edu-reviewer` → Hadi | (0.62, -3.18, π) |
| L3 TIM DEV | dev | `coder2` → Bagas | (-7.8, -2.4, 0) |
| | | `planner` → Raka | (-6.18, -2.4, 0) |
| | | `uiux` → Laras | (-4.56, -2.4, 0) |
| | | `coder` → Dimas | (-7.8, -3.18, π) |
| | | `reviewer` → Yoga | (-6.18, -3.18, π) |
| | | `tester` → Sari | (-4.56, -3.18, π) |
| | | `dev` → Bima (lead) | (-9.0, -2.79, -π/2) flush sisi barat blok |
| | | `devops` → Wahyu | (-0.8, -1.0, 0) dekat rak server |

Koordinat di atas adalah translasi blok terverifikasi lama (pitch kolom 1.62, pitch
baris 0.78, blok mepet `BLOCK_GAP=0.02`, lead vertikal 1.03×1.62 flush + menghadap tim).
`DESK_EXIT` turunan (dipakai test & rute): L3 coder2/planner/uiux (-7.8/-6.18/-4.56, -0.4),
coder/reviewer/tester (-7.8/-6.18/-4.56, -5.18), dev (-11.0, -2.79), devops (-0.8, 1.0);
L2 edu/edu-designer (-1.0/0.62, -0.4), edu-writer/edu-reviewer (-1.0/0.62, -5.18);
L1 default (-0.5, 0.3).

### Service core (identik di ketiga lantai, sisi timur — shaft satu kolom)
| Objek | AABB lokal | Node nav | Keterangan |
|---|---|---|---|
| Kabin lift | x [8.6, 10.4], z [-1.2, 0.8] | `lift` (7.9, -0.2) | pintu menghadap barat, label `LIFT` |
| Tangga | x [8.6, 10.4], z [1.8, 5.0] | `stair` (7.9, 3.4) | entry barat |
| Lorong timur | x = 7.9 | edge `lift`–`stair` | menghubungkan keduanya; jarak 0.7 ke core → uji RADIUS (A3) |

Renderer menggambar shaft sebagai kolom menerus x [8.6,10.4] menembus ketiga slab
(termasuk pita antar-slab), kabin lift = sprite yang posisi vertikalnya dianimasikan
di dalam shaft; tangga digambar zig-zag statis per slab. Node `lift`/`stair` wajib
ada di setiap lantai dengan **x,z lokal yang sama** (invariant test).

### Denah per lantai (ASCII kasar; x → kanan, z ↓ bawah; ukuran 24×12)
Legenda: `D` meja, `L` kabin lift, `S` tangga, huruf kecil furnitur, `·` lantai kosong.
Koordinat pasti ada di tabel furnitur bawah tiap denah (angka beku).

**L3 — TIM DEV** (8 meja): blok dev 3×2 + lead di barat, devops sendiri dekat server.
```
x: -12        -6         0         6    12
z=-6 ┌──────────────────────────────────────┐
     │······pp······························│  p = papan-dev (dinding utara)
     │······································│
     │·DDDDDD·······v·······················│  v = rak server
     │·DDDDDD·······v·······················│  D = blok dev (lead+3×2)
     │·DDDDDD····d··························│  d = meja devops
     │·······························LLL····│  L = lift (pintu barat)
     │·······························LLL····│
     │·······························SSS····│  S = tangga
     │·······························SSS····│
     │·······························SSS····│
     │·······························SSS····│
z=+6 └──────────────────────────────────────┘
```
| Furnitur L3 | AABB |
|---|---|
| `server` (rak, dekat devops 1.6..3 — terukur 2.21) | x [-1.2, -0.3], z [-4.6, -3.6] |
| `papan-dev` (dinding utara) | x [-5.6, -3.2], z [-5.89, -5.72] |
| `lift` / `stair` | lihat service core |

POI L3: `server` (-1.9, -4.1, act check), `papan` (-4.4, -5.3, act read).

**L2 — TIM EDU** (4 meja): blok 2×2 di tengah-barat, lesehan timur, buku dinding timur.
```
x: -12        -6         0         6    12
z=-6 ┌──────────────────────────────────────┐
     │········pp····························│  p = papan-edu (dinding utara)
     │····································b·│  b = rak buku (dinding timur)
     │····DDDD····························b·│
     │····DDDD·······llll·················b·│  l = lesehan
     │····DDDD·······llll···················│
     │·······························LLL····│
     │·······························LLL····│
     │·······························SSS····│
     │·······························SSS····│
     │·······························SSS····│
     │·······························SSS····│
z=+6 └──────────────────────────────────────┘
```
| Furnitur L2 | AABB |
|---|---|
| `lesehan` | x [3.2, 6.6], z [-4.6, -2.0] |
| `papan-edu` (dinding utara) | x [-2.4, 1.2], z [-5.89, -5.72] |
| `buku` (rak, dinding timur) | x [11.3, 11.85], z [-4.4, -2.0] |
| `lift` / `stair` | lihat service core |

POI L2: `lesehan` (4.9, -1.4, sit), `buku` (10.6, -3.2, read), `papan-edu` (-0.6, -5.3, read).

**L1 — LOBBY/PENDOPO** (1 meja: default menghadap pintu MASUK di selatan).
```
x: -12        -6         0         6    12
z=-6 ┌──────────────────────────────────────┐
     │k···································t·│  k = mesin kopi, t = tanaman
     │k·····mm······························│  m = meja-kopi
     │k·····mm······························│
     │······················rrrr·····LLL····│  r = meja rapat
     │······················rrrr·····LLL····│
     │············D··cc·····················│  D = meja default, c = resepsionis
     │···············cc··············SSS····│
     │···············cc··············SSS····│
     │····ss··tt·····················SSS····│  s = sofa, t = meja sofa
     │····ss·························SSS····│
     │t··························kucing·····│  t = tanaman, kucing (5.2,4.8)
z=+6 └────────────────══MASUK══─────────────┘  celah x[-2.2,2.2]
```
| Furnitur L1 | AABB |
|---|---|
| `resepsionis` (counter) | x [2.0, 2.8], z [1.0, 3.6] |
| `sofa` | x [-8.8, -7.4], z [3.4, 4.2] |
| `sofa-table` | x [-6.6, -5.4], z [3.5, 4.1] |
| `meja-rapat` | x [4.6, 7.2], z [-1.6, 0.6] |
| `kopi` (mesin) | x [-11.6, -10.9], z [-5.2, -3.6] |
| `meja-kopi` | x [-9.6, -7.8], z [-4.6, -3.2] |
| `tanaman-1` / `tanaman-2` | x [-11.6, -10.8], z [4.6, 5.4] / x [10.8, 11.6], z [-5.4, -4.6] |
| `kucing` | (5.2, 4.8), 0.48×0.48 → x [4.96, 5.44], z [4.56, 5.04] |
| `lift` / `stair` | lihat service core |

POI L1: `kopi` (-11.25, -2.9, sip), `meja-kopi` (-7.1, -3.9, sip), `sofa` (-8.1, 2.7, sit),
`resepsionis` (1.3, 2.3, chat), `rapat` (3.9, -0.5, chat), `kucing` (4.5, 4.8, pet).
Semua POI berjarak ≥ 0.35 dari furniturnya (kaki lurus node→POI diuji RADIUS).

### Graph nav usulan per lantai (node selain lift/stair boleh digeser kecil oleh gate)
Aturan: semua edge bebas furniture (RADIUS 0.35); edge sirkulasi murni wajib ruang
papasan ≥ 0.75; edge yang menyentuh `lift`/`stair` diuji RADIUS saja (A3). Lorong
utama avoiding furnitur: lorong depan z=-0.4, lorong belakang z=-4.9 (bukan -5.18:
papan dinding berjarak 0.54 dari -5.18 < 0.75), spine barat L3 x=-11.0 (0.89 dari
dinding), spine L2 x=-4.0 dan x=2.4 (0.8 dari lesehan), lorong L1 z=0.2 (0.8 dari
resepsionis) dan x=7.9 sisi timur.

**L3** (12 node): `lift`(7.9,-0.2), `stair`(7.9,3.4), `f-w`(-11.0,-0.4), `f`(-6.18,-0.4),
`f-e`(-2.6,-0.4), `w-mid`(-11.0,-2.79), `b-w`(-11.0,-4.9), `b`(-6.18,-4.9),
`b-e`(-2.6,-4.9), `s-mid`(-2.6,1.0), `ops`(-0.8,1.0).
Edge: lift–stair; ops–lift; s-mid–ops; f-e–s-mid; b-e–f-e; f-w–f; f–f-e;
f-w–w-mid; w-mid–b-w; b-w–b; b–b-e.
Exit meja mendarat di/d dekat node: baris depan → lorong z=-0.4; baris belakang →
lorong z=-4.9 (kaki 0.28); dev → `w-mid`; devops → `ops`.

**L2** (11 node): `lift`(7.9,-0.2), `stair`(7.9,3.4), `shelf`(7.9,-3.2),
`f-w`(-4.0,-0.4), `f`(-1.0,-0.4), `f-e`(0.62,-0.4), `f-e2`(2.4,-0.4),
`b-w`(-4.0,-4.9), `b`(-1.0,-4.9), `b-e`(0.62,-4.9), `e`(2.4,-4.9).
Edge: lift–stair; lift–shelf; lift–f-e2; f-e2–f-e; f-e–f; f–f-w; f-w–b-w;
b-w–b; b–b-e; b-e–e; f-e2–e.

**L1** (15 node): `gate`(0,5.3), `lift`(7.9,-0.2), `stair`(7.9,3.4), `east-s`(7.9,1.4),
`c`(-0.5,0.2), `w`(-2.2,0.2), `ws`(-2.2,5.3), `mid`(3.8,0.2), `me`(3.8,1.4),
`recep`(1.3,0.2), `kopi-n`(-11.1,0.2), `kopi-nw`(-11.1,-2.4), `kopi-e`(-8.7,-2.4),
`mk-n`(-7.0,-2.4), `sofa-n`(-8.1,2.0).
Edge: gate–ws; ws–w; w–c; c–recep; recep–mid; mid–me; me–east-s; east-s–lift;
east-s–stair; lift–stair; w–kopi-n; kopi-n–kopi-nw; kopi-nw–kopi-e; kopi-e–mk-n;
mk-n–w; kopi-n–sofa-n; sofa-n–ws.
(Celah antar furnitur yang lebih sempit dari 1.5 — mis. antara mesin kopi dan meja-kopi
— tidak boleh dilalui edge nav; POI didekati dari sisi yang longgar, seperti di atas.)

`lib/nav.ts`: adjacency dibangun **per lantai** dari `FLOORS`; `navPath(floor, fromId,
toId)`. `lib/routes.ts`: `onward(meta, to)` / `homeward(meta, from)` / `retrace` memakai
`meta.desk.floor` dan `nearestNode(floor, …)`; `seatPoint` tetap. `lib/presence.ts`:
`walkerPositions` menjadi `{x, z, floor}`; `avoid()` hanya mempertimbangkan walker di
lantai yang sama; `poiTaken` di-key per lantai (id POI unik per lantai).

### Perjalanan lintas lantai (Trip) & cara kerja lift
```ts
export interface TripLeg { floor: FloorId; pts: Pt[] }
export interface Trip {
  legs: TripLeg[]                       // 1 leg = perjalanan satu lantai (perilaku lama)
  ride?: { from: FloorId; to: FloorId } // transisi lift di antara dua leg
}
```
- `buildTrip(meta, target)` (routes.ts, murni): target satu lantai → `legs=[onward(...)]`,
  tanpa ride (perilaku hari ini, tidak berubah). Beda lantai →
  leg 1 = `onward(meta, node lift lantainya)`; ride; leg 2 = dari node lift lantai tujuan
  via `navPath` ke `DESK_EXIT` target (atau POI). Pulang = simetri (lift lagi).
- **Ride deterministik**: durasi `1.0 + 0.5*|Δfloor| + seed*0.4` detik,
  `seed = (hashId(id) % 1000)/1000`; posisi kabin = interpolasi linear offset slab
  (lihat viewport) selama ride; agen disembunyikan di dalam kabin (siluet 2-frame).
  Semua dari clock render `t` — bukan `Math.random`, bukan timer terpisah; `?still=1`
  membekukan `t` sehingga frame screenshot stabil.
- `walkState` (render.ts) mengonsumsi Trip: total durasi = Σ panjang leg / speed +
  durasi ride; fase (keluar → berdiri 5–9 dtk → pulang) tetap seperti pola lama,
  di-seed `hashId`. Maks 1 pengunjung per target seperti sekarang (`poiTaken` untuk
  POI; fase per-agen deterministik untuk meja).
- **Amplop comms**: interpolasi posisi building-px dari `seatPoint(from)` (lantai A) ke
  `seatPoint(to)` (lantai B) + busur `-sin(kπ)*0.6`; jendela umur 1.5 s tetap; lintas
  slab otomatis karena koordinat sudah building-space. Tidak ada field backend baru.
- Delegasi tetap dipicu `poseFor` (tabel pemetaan lama tidak berubah: offline > blocked >
  walk/delegate > typing > reading > working > relax > idle). `walkTarget` tetap
  `{kind:'desk'|'poi', id}`; lantai target diturunkan dari `agentMeta(id).desk.floor`.
  Target tak dikenal → POI `rapat` L1 (perilaku lama).

### Viewport gedung (`scene2d/viewport.ts`)
- `TILE = 16` tetap. Slab per lantai = 24×12 tile = **384×192 px**.
  `SLAB_GAP_PX = 24` (pita slab baja+kaca antar lantai). Stride antar slab =
  192+24 = **216 px = 13.5 unit**. Offset vertikal lantai f = `(3-f) * 216` px
  (L3=0 di atas, L2=216, L1=432). Konten gedung = **384×624 px** (39 unit tinggi).
- `worldToPixel(x, z, floor)` = `{ x:(x+12)*TILE, y:(z+6)*TILE + (3-floor)*(FLOOR_D*TILE+SLAB_GAP_PX) }`;
  `worldToScreen(vp, w, h, x, z, floor)` lewat pusat vp. `Viewport = {x, z, zoom}`
  dengan x unit dunia [-12,12] dan **z unit gedung [0,39]** (0 = tepi atas slab L3);
  `pixelToWorld`/`screenToWorld` mengembalikan `{x, z, floor}` — floor =
  `3 - floor(py/216)` clamp 1..3; py di pita gap → slab terdekat (untuk hit-test klik).
- `fitZoom` memakai extent GEDUNG (384×624, `FIT_MARGIN` tetap):
  `fitZoom(1000,688)=1` dan `fitZoom(390,692)=1` → cutaway penuh muat di kedua layar
  (desktop canvas 1000×688 = 1280−280 rail × 800−56−56; HP 390×692 = 844−96−56).
  `clampCenter` clamp ke extent gedung, bukan satu lantai. Zoom integer 1..4 tetap;
  blit integer-DPR (`blitScale`) tetap.
- **Floor focus** = zoom 2, pusat slab: `x=0`, `z=(3-f)*13.5 + 6`. Slab 768×384 px:
  muat penuh di desktop; di HP pan horizontal (Q1). `?face=`/tight = zoom 4, `#id` =
  zoom 3, keduanya di lantai agen.
- Hit-test: klik agen = `nearestAt` radius 0.9 **pada floor hasil inverse transform**;
  klik area kosong slab = focus lantai itu (`onFloor(f)` → perintah view zoom 2);
  klik pita gap/shaft = slab terdekat. `onNear` = agen terdekat dari pusat viewport
  pada floor pusat (radius 2.5), dipanggil hanya saat berubah.

### Deep-link (nasib nilai lama didokumentasikan)
| URL | Perilaku baru |
|---|---|
| `?floor=1\|2\|3` | focus lantai itu, zoom 2 |
| `?spot=lobby` (legacy) | = `?floor=1` |
| `?spot=dev` (legacy) | = `?floor=3` |
| `?spot=edu` (legacy) | = `?floor=2` |
| `?spot=tampak` / `?spot=luar` (legacy) | cutaway gedung (zoom-fit, default) |
| tanpa parameter | cutaway gedung (default baru menggantikan "tampak" lantai tunggal) |
| `#<id>` / `?face=<id>` | resolve nama/id → lantai agen, zoom 3 / 4 |
| `?still=1` | tetap: bekukan clock animasi untuk screenshot |
| `?cam=&aim=` | sudah hilang sejak scene 2D; tidak dihidupkan lagi |
`lib/view.ts`: `SPOT_VIEW` menjadi preset lantai `{floor, zoom}` + `gedung {fit:true}`
(alias `tampak`/`luar`); `RigCommand.focus` bertambah `floor: FloorId` (opsional dulu
di T1, wajib mulai T3). `lib/focus.ts` `agentFocus` mengembalikan floor. Toolbar Hud:
`[L1 Lobby] [L2 Edu] [L3 Dev] [Gedung]` menggantikan `[Pendopo][Tim Dev][Tim Edu][Luar]`.

### Render gedung cutaway (`render.ts` + `sprites.ts` + `palette.ts`)
- Prerender **satu surface gedung 384×624** sekali per perubahan config/resize:
  per slab (atas→bawah L3,L2,L1): lantai bermotif tim (dev plank navy, edu anyaman,
  lobby checker hangat — motif lama dipertahankan, di-modern-kan mengikuti doc uiux) →
  dinding dari `FLOORS[f].walls` (celah MASUK L1) → furnitur dari `FLOORS[f].furniture`
  by id (sprite baru: resepsionis, sofa, tanaman, mesin kopi, meja rapat, lesehan, buku,
  papan, server, kucing) → meja+kursi dinamis per lantai seperti sekarang.
- Pita antar-slab 24 px: edge slab beton/baja + curtain wall kaca (panel 2-tone,
  mullion baja 1 px, pantulan diagonal prosedural). Kolom baja di sudut + shaft lift
  menerus x [8.6,10.4] seluruh 624 px; kabin lift sprite dinamis di dalam shaft.
  Dasar gedung: batur/ground strip sederhana prosedural (pengganti `EXTERIOR` lama
  yang dihapus bersama `SPOTS` kamera 3D).
- Urutan gambar dinamis: slab L3 → L2 → L1; dalam slab painter's algorithm by z;
  kepala chibi (16 px) muat di gap 24 px sehingga tidak menimpa slab tetangga;
  nameplate/chip selalu terakhir (CSS px, `labels.ts`).
- `labels.ts`: `WORLD_LABELS` per lantai — plakat `LOBBY`/`TIM EDU`/`TIM DEV` di pita
  utara tiap slab (z lokal ≈ -5.55), `MASUK` di L1 (0, 5.55), `LIFT` dekat core tiap
  lantai. `plateMode`/`plateScale`/`shortName`/`buildStacks`/`placeStacks` **tidak
  berubah** (nama depan penuh, scale 2 di zoom 1, solver deterministik); reserved
  rects mencakup plakat ketiga slab. Risiko plate melayang ke slab tetangga dibatasi
  ladder dy yang ada + gate visual (Risiko #2).
- Offline: meja dari `rosterAgents()` per lantai; agen tanpa baris status → kursi kosong
  + redup + Z Z Z + chip `offline` (pola lama, jangan render dari payload saja).
- `Office2D.tsx`: props lama + `onFloor?: (f: FloorId) => void` (aditif, Scene meneruskan);
  initial vp = cutaway fit; perintah floor → zoom 2 pusat slab; `__office2dReady` /
  `__office2dVp` tetap (probe memakai keduanya); `?still=1`, reduced-motion, pause
  hidden, ResizeObserver, pinch/drag/WASD/DPad = pan (sumbu z kini unit gedung).

### Kontrak antar-modul (tetap supaya panel tak berubah)
- `OfficeProps` bentuk lama + `onFloor?` opsional; `moveIntent` tetap pan `{x,z}`.
- Props Hud/Roster/Feed/TaskBoard/KPI/ProximityCard tidak berubah; hanya `SpotNav`
  (Hud) yang ganti daftar tombol. `.roster-body { overflow-y:auto }` + tinggi terbatas
  dipertahankan (regresi cc2add3 jangan terulang).
- `types.ts`/`api.ts`/hooks tidak disentuh → fallback `seedConfig`/`offlinePayload`
  dan banner stale bekerja seperti sekarang.

---

## Inventory file

### Dibuat
| File | Isi |
|---|---|
| `docs/plans/gedung-3lantai.md` | rencana ini |
| `docs/design/gedung-3lantai.md` | (oleh uiux, bukan coder) spec visual gedung: palet kaca/baja, sprite lift/tangga/furnitur lobby, plakat slab, state floor-focus |

Tidak ada modul kode baru yang direncanakan — semua perubahan menumpang modul yang ada
(YAGNI); bila T2 ternyata butuh pemecah, helper shaft/slab tetap tinggal di
`render.ts`/`sprites.ts`.

### Diubah
| File | Perubahan |
|---|---|
| `frontend/src/lib/rooms.ts` | tulis ulang: `FloorId`, `FLOORS` (walls/doors/furniture/pois/nav/navEdges/lift/stair per lantai), agregat turunan per lantai, `nearestNode(floor,…)`, `DESK_EXIT_BY_FLOOR`; hapus `FLOOR` 28×20, `SPOTS` kamera 3D, `EXTERIOR`, `NAV`/`NAV_EDGES`/`OBSTACLES` flat (diganti turunan per lantai); `setFloorContext`/`setFurniture` per lantai |
| `frontend/src/lib/agents.ts` | `AgentMeta.desk.floor`; koordinat meja baru (§tabel, angka beku); fallback `agentMeta` dipindah ke L1 yang valid; `TEAMS` tetap |
| `frontend/src/lib/layout.ts` | `TEAM_CENTRE` pusat lokal baru; `planDesks`/`clearance`/`deskObstacle` tetap (input floor 24×12 per lantai) |
| `frontend/src/lib/roster.ts` | registry per lantai: `setFloorContext(floor,…)`, `setFurniture(floor,…)`, planning agen baru per lantai timnya, `DEFAULT_FLOOR` 24×12, abaikan `cfg.layout.floor.w/d`, `seedConfig` 24×12 |
| `frontend/src/lib/nav.ts` | graph per lantai; `navPath(floor, from, to)` |
| `frontend/src/lib/routes.ts` | `onward/homeward/retrace` floor-aware; `buildTrip` + tipe `Trip`/`TripLeg`; `avoid`/`SIDESTEP`/`BODY` tetap |
| `frontend/src/lib/presence.ts` | `walkerPositions` + `floor`; `poiTaken` per lantai |
| `frontend/src/lib/view.ts` | `SPOT_VIEW` preset lantai + `gedung`/alias legacy; `RigCommand.focus.floor` |
| `frontend/src/lib/focus.ts` | `agentFocus` ikut mengembalikan floor |
| `frontend/src/scene2d/viewport.ts` | math gedung: `worldToPixel(x,z,floor)`, extent 384×624, `Viewport.z` unit gedung, `fitZoom`/`clampCenter` gedung, `screenToWorld` → floor |
| `frontend/src/scene2d/render.ts` | static layer gedung 3 slab + shaft menerus + pita kaca/baja; `walkState` Trip + ride lift; amplop lintas slab; plakat per slab |
| `frontend/src/scene2d/sprites.ts` | sprite baru: kabin lift, tangga, panel kaca, kolom baja, resepsionis, sofa, tanaman, mesin kopi, meja rapat; furnitur lama dipertahankan/diperbarui; chibi tetap |
| `frontend/src/scene2d/palette.ts` | tone modern tambahan (kaca, baja, beton) mengikuti doc uiux; palet inti tetap |
| `frontend/src/scene2d/labels.ts` | `WORLD_LABELS`/`ZONE_LABELS` per slab (LOBBY/TIM EDU/TIM DEV/MASUK/LIFT); solver & ukuran plate tetap |
| `frontend/src/scene2d/anim.ts` | `walkTarget` tetap; lantai target diturunkan dari meta (helper kecil); tabel pose tetap |
| `frontend/src/scene2d/Office2D.tsx` | initial vp cutaway, perintah floor/focus lantai, hit-test per floor + `onFloor`, clamp gedung, `__office2dVp` tetap |
| `frontend/src/components/Hud.tsx` | `SpotNav`: L1/L2/L3 + Gedung (menggantikan Luar); perilaku toggle panel tetap |
| `frontend/src/App.tsx` | deep-link `?floor=` + mapping `?spot=` legacy; `flyToAgent` membawa floor; wiring `onFloor` → `goTo` |
| `frontend/src/styles/global.css` | gaya tombol lantai (aktif = aksen lantai), kelas kecil bila perlu; overflow roster & layout rail/sheet dipertahankan |
| `verify/roster_check.ts` | seluruh assertion per lantai + invariant floor/lift/stair (§T1.3) |
| `verify/layout_check.ts` | seluruh assertion per lantai + errand lintas lantai + invariant core (§T1.3, §T4.3) |
| `verify/anim_check.ts` | math viewport gedung, Trip/ride deterministik, mapping deep-link murni (§T2.2, §T4.3) |
| `verify/visual_check.ts` | gate cutaway 3 slab (§T5.1) |
| `verify/office2d_probe.js` | cek 3 slab, tombol lantai, zoom integer via `__office2dVp`, scroll roster, panel tidak menutupi kanvas |
| `README.md`, `AGENTS.md` | §diagnostik: `?floor=`, nasib `?spot=` legacy, peta repo `FLOORS` (baris 28×20 usang) |

### Tidak disentuh (dibekukan)
`backend/**`, `deploy/**`, `frontend/src/lib/{types,api,format}.ts`, `frontend/src/hooks/*`,
`frontend/src/components/{Scene,Roster,Feed,TaskBoard,KPI,ProximityCard,DPad}.tsx`,
`frontend/src/scene2d/pixelfont.ts`, `frontend/public/**`, `verify/e2e_review.sh`,
`.github/workflows/*`, `frontend/package.json` + `package-lock.json` (tanpa dep baru),
`frontend/vite.config.ts` (cabang react + `vite/preload-helper` wajib bertahan).

---

## Tasks

Enam paket kerja berurutan untuk orchestrator; subtask kecil, build hijau setelah tiap
subtask. Semua `[fe]` kecuali bertag `[test]`. Tidak ada task `[be]`/`[db]`/`[infra]` —
backend dilarang disentuh. Angka beku (§Technical design) tidak boleh diubah oleh task
mana pun; yang boleh menyesuaikan hanya node nav usulan, dan hanya bila gate menuntut.

### T1 — Model koordinat 3 lantai + tes per lantai

**T1.1 `[fe]` `FLOORS` di rooms.ts + meja baru di agents.ts**
- Files: `frontend/src/lib/rooms.ts` (tulis ulang), `frontend/src/lib/agents.ts`,
  `frontend/src/lib/layout.ts` (`TEAM_CENTRE`).
- Test first: gate = typecheck; check lama boleh RED setelah T1.2 sampai T1.3 —
  di subtask ini jaga typecheck hijau dengan mengekspor agregat turunan sementara.
- Implement: `FloorId`, `FloorPlan`, `FLOORS` persis §denah (walls/doors/furniture/pois/
  nav/navEdges/lift/stair), `DESKS_BY_FLOOR`, `OBSTACLES_BY_FLOOR`, `WALL_OBSTACLES`
  per lantai, `nearestNode(floor,x,z)`, `DESK_EXIT_BY_FLOOR`; `AgentMeta.desk.floor` +
  koordinat tabel; peta tim→floor lobby=1/edu=2/dev=3.
- Verify: `npx tsc --noEmit` hijau.
- Depends: none.

**T1.2 `[fe]` Roster/nav/routes/presence per lantai**
- Files: `frontend/src/lib/roster.ts`, `nav.ts`, `routes.ts`, `presence.ts`.
- Implement: `setFloorContext(floor,…)`/`setFurniture(floor,…)`; `applyConfig`/
  `ensureAgent` men-plan agen baru di lantai timnya (obstacles+walls+edges lantai itu,
  floor 24×12); abaikan `cfg.layout.floor.w/d`; `seedConfig` 24×12; `navPath(floor,…)`;
  `onward/homeward/retrace` floor-aware + `buildTrip`/`Trip` (satu lantai = 1 leg,
  perilaku lama); `walkerPositions {x,z,floor}`, `avoid` filter floor, `poiTaken` per lantai.
- Verify: `npx tsc --noEmit` hijau (check lama boleh RED sampai T1.3).
- Depends: T1.1.

**T1.3 `[test]` roster_check + layout_check PER LANTAI (GREEN)**
- Files: `verify/roster_check.ts`, `verify/layout_check.ts` (tulis ulang loop per lantai).
- Test first (ini tesnya): untuk tiap floor 1..3 jalankan seluruh set lama — seed tak
  berubah (koordinat baru), config mendorong roster, aisle ≥ 1.6 (pengecualian blok),
  pitch 1.62/0.78 + blok mepet ≤ 0.02 (dev L3, edu L2), lead flush + rot -π/2 (L3),
  devops–server 1.6..3 (L3), lattice agen baru per lantai, meja tidak di walkway
  (0.35), determinisme, lookFor, status-only agent dapat meja di lantai timnya;
  dinding dalam 24×12, edge nav bebas furniture, kaki POI+exit lurus bebas furniture,
  errand replay meja→POI lantai sendiri→meja (+ recall tengah jalan), ruang papasan
  ≥ 0.75 **dengan pengecualian edge incident lift/stair → RADIUS 0.35 (A3, tulis
  alasannya di komentar)**, simulasi papasan walker (kasus disesuaikan ke lorong baru),
  graph terhubung dari entrance (L1: `gate`; L2/L3: `lift`), semua POI terjangkau.
  Invariant baru: node `lift` & `stair` ada + terhubung di tiap lantai; x,z lokal
  `lift`=(7.9,-0.2) dan `stair`=(7.9,3.4) identik di ketiga lantai; setiap meja punya
  `floor` sesuai peta tim; tidak ada dua meja berbeda lantai yang saling diuji
  (semua assertion antar-objek hanya dalam satu lantai).
- Verify: esbuild+node kedua check → `ROSTER OK`, `LAYOUT OK`; `npx tsc --noEmit`.
- Depends: T1.2.

**T1.4 `[fe]` Tipe view/focus sadar lantai (aditif)**
- Files: `frontend/src/lib/view.ts`, `frontend/src/lib/focus.ts`.
- Implement: `RigCommand.focus.floor?: FloorId` (opsional dulu agar Office2D lama tetap
  hijau); `agentFocus` mengembalikan floor; `SPOT_VIEW` lama belum diubah (T3.1).
- Verify: `npx tsc --noEmit && npm run build`; roster/layout OK.
- Depends: T1.1. **Independen, paralel dengan T1.2/T1.3 dan T2.1.**

### T2 — Renderer gedung cutaway

**T2.1 `[fe]` Palet modern + sprite gedung**
- Files: `frontend/src/scene2d/palette.ts`, `sprites.ts`.
- Implement: tone kaca/baja/beton (ikuti `docs/design/gedung-3lantai.md` bila sudah ada);
  `drawLiftCabin`, `drawStairs`, `drawGlassPanel`, `drawSteelColumn`, `drawReception`,
  `drawSofa`, `drawPlant`, `drawCoffeeMachine`, `drawMeetingTable`; `drawFurniture`
  memetakan id furnitur baru (§denah); id tak dikenal → kotak generik (pola lama).
  Semua `fillRect` + cache `getSprite`; tanpa aset/dep baru.
- Verify: `npx tsc --noEmit && npm run build`.
- Depends: none (paralel dengan T1). Finalisasi warna menunggu doc uiux.

**T2.2 `[fe]` Viewport gedung + render 3 slab**
- Files: `frontend/src/scene2d/viewport.ts`, `render.ts`, `labels.ts`,
  `verify/anim_check.ts` (bagian viewport).
- Implement: math gedung persis §viewport (offset `(3-f)*216`, extent 384×624,
  `Viewport.z` unit gedung 0..39, `fitZoom`/`clampCenter` gedung, inverse → floor);
  `createStaticLayer` → surface gedung 3 slab + shaft menerus + pita kaca/baja + batur;
  `renderFrame` blit gedung, meja/agen per slab (painter by z dalam slab, slab atas
  dulu), plakat per slab di `WORLD_LABELS`; solver label tetap. `walkState` sementara
  tetap satu lantai (Trip penuh di T4). Anim_check: roundtrip per floor, offset slab,
  clamp extent gedung, `fitZoom(1000,688)=fitZoom(390,692)=1`, zoom integer.
- Verify: esbuild+node `anim_check` → `ANIM OK`; `npx tsc --noEmit && npm run build`;
  roster/layout OK.
- Depends: T1.3, T2.1.

**T2.3 `[fe]` Office2D cutaway (tanpa interaksi lantai dulu)**
- Files: `frontend/src/scene2d/Office2D.tsx`.
- Implement: initial vp = fit gedung (cutaway) menggantikan "tampak" lantai tunggal;
  resize/clamp memakai extent gedung; pan/drag/pinch/WASD/DPad bekerja pada sumbu z
  gedung; `__office2dReady`/`__office2dVp` tetap; `?still=1` tetap. Perintah spot lama
  masih diterima (mapping penuh di T3.1).
- Verify: `npx tsc --noEmit && npm run build`; `npm run dev` manual: 3 slab terlihat,
  13 nama terbaca, pan/zoom jalan.
- Depends: T2.2.

### T3 — Interaksi pilih lantai + deep-link + zoom

**T3.1 `[fe]` Tombol L1/L2/L3 + preset view + deep-link**
- Files: `frontend/src/lib/view.ts` (`SPOT_VIEW` final: `{floor,zoom:2}` + `gedung{fit}`
  + alias `tampak`/`luar`/`lobby`/`dev`/`edu`), `frontend/src/components/Hud.tsx`
  (`SpotNav` L1/L2/L3+Gedung), `frontend/src/App.tsx` (`?floor=`, mapping `?spot=`
  legacy, `flyToAgent` membawa floor, `onFloor` → `goTo`), `Office2D.tsx` (perintah
  floor → zoom 2 pusat slab; `focus.floor` wajib), `global.css` (tombol aktif).
- Implement: persis §deep-link; `RigCommand.focus.floor` menjadi wajib; floor-focus
  integer zoom 2, `#id` zoom 3, `?face=` zoom 4 di lantai agen.
- Verify: `npx tsc --noEmit && npm run build`; manual dev: `?floor=2` → L2 di tengah;
  `?spot=dev` → L3; `?spot=luar` → cutaway; `#coder` → L3 zoom 3; tombol toolbar aktif
  benar; roster/feed tetap terbuka seperti sebelumnya.
- Depends: T2.3, T1.4.

**T3.2 `[fe]` Hit-test per lantai + klik slab = focus**
- Files: `frontend/src/scene2d/Office2D.tsx`, `viewport.ts` (bila perlu helper),
  `render.ts` (`pickTargets` per floor).
- Implement: tap agen → `onPick` (radius 0.9 pada floor hasil inverse); tap slab kosong
  → `onFloor(f)` (focus zoom 2); tap gap/shaft → slab terdekat; `onNear` per floor pusat;
  klik tidak pernah memilih agen lantai lain yang kebetulan sejajar vertikal.
- Verify: `npx tsc --noEmit && npm run build`; manual: klik meja L2 saat cutaway →
  ProximityCard agen L2; klik area kosong L3 → zoom ke L3; Esc/klik kosong tetap menutup.
- Depends: T3.1.

**T3.3 `[test]` Gate interaksi di anim_check**
- Files: `verify/anim_check.ts`.
- Test first: mapping deep-link murni (`lobby→1, dev→3, edu→2, tampak/luar→fit`),
  floor-focus selalu integer 2 dan pusat slab `(3-f)*13.5+6`, focus agen integer 3/4,
  `screenToWorld` mengembalikan floor yang benar untuk titik di tiap slab dan di gap,
  clamp tidak memotong slab saat floor-focus di 1000×688.
- Verify: esbuild+node → `ANIM OK`.
- Depends: T3.2.

### T4 — Animasi lift + amplop comms

**T4.1 `[fe]` Trip lintas lantai + ride lift deterministik**
- Files: `frontend/src/lib/routes.ts` (`buildTrip` final), `frontend/src/scene2d/render.ts`
  (`walkState` Trip), `sprites.ts` (kabin dinamis), `presence.ts` (bila perlu).
- Implement: leg 1 ke lift lantai asal → ride (durasi `1.0+0.5*|Δfloor|+seed*0.4`,
  posisi kabin interpolasi offset slab, agen siluet dalam kabin) → leg 2 dari lift
  lantai tujuan ke exit target; pulang simetri; satu lantai = perilaku lama persis;
  `avoid` hanya sesama lantai; maks 1 pengunjung per target.
- Verify: `npx tsc --noEmit && npm run build`; manual dev dengan fixture delegate
  lintas tim: agen terlihat naik shaft dan muncul di lantai tujuan.
- Depends: T1.3, T2.3. **Paralel dengan T3 setelah T2.3.**

**T4.2 `[fe]` Amplop comms lintas slab**
- Files: `frontend/src/scene2d/render.ts`.
- Implement: amplop interpolasi building-px antar `seatPoint` dua lantai + busur
  `-sin(kπ)*0.6`, jendela 1.5 s tetap; tidak ada teks dari payload selain kind/counter.
- Verify: `npx tsc --noEmit && npm run build`; shot comms (fixture) menunjukkan amplop
  antar slab.
- Depends: T4.1.

**T4.3 `[test]` Gate Trip di anim_check + layout_check**
- Files: `verify/anim_check.ts`, `verify/layout_check.ts`.
- Test first: trip satu lantai = 1 leg tanpa ride (identik pola lama); trip lintas
  lantai = 2 leg + ride dengan lantai benar; posisi ride deterministik (dua panggilan
  t sama → sama; tidak ada `Math.random` — grep sumber); `?still=1` (t=0) stabil;
  layout_check: replay errand lintas lantai (meja → lift lantai asal, ride, lift lantai
  tujuan → exit target → pulang) semua kaki bebas furniture lantai masing-masing.
- Verify: esbuild+node → `ANIM OK`, `LAYOUT OK`.
- Depends: T4.2.

### T5 — Gate visual + probe + dokumen

**T5.1 `[test]` visual_check cutaway 3 slab**
- Files: `verify/visual_check.ts` (tulis ulang sesuai model baru).
- Test first (ini tesnya): 13 meja + 13 nameplate (satu per agen, nama depan penuh,
  tanpa stub); 3 slab tergambar pada extent gedung; overlap plate 0 dan plate tidak
  menutupi plakat slab mana pun; tidak ada plate/meja/kepala off-canvas di **1000×688**
  dan **390×692** pada zoom default; zoom default integer (=1 di kedua layar);
  floor-focus integer 2; `plateScale(1)=2`, `plateScale(2)=1`; offline vs idle beda
  bentuk (Z Z Z + chip kata, bukan warna saja); chip blocked generik; konstanta plate
  tetap jujur (PLATE_H=11, NAME_GAP≥1).
- Verify: esbuild+node → `VISUAL OK`.
- Depends: T3.3, T4.3.

**T5.2 `[test]` Probe browser + screenshot + verdict vision**
- Files: `verify/office2d_probe.js` (perbarui).
- Implement: tunggu `__office2dReady`, `?still=1`; cek 3 slab & 13 nameplate, tombol
  L1/L2/L3+Gedung ada dan berfungsi (klik → `__office2dVp().zoom===2` integer),
  cutaway default zoom integer, tidak ada panel menutupi kanvas/kontrol, bukti scroll
  `.roster-body` (`scrollTop` 0→>0, `scrollHeight>clientHeight`); shot desktop 1280×800
  + mobile 390×844 (cutaway & floor-focus) + offline (route `/api/*` abort: 13 meja,
  semua offline, banner basi); jalankan `vision_analyze`, simpan verdict.
- Verify: probe `ok:true`; PNG + JSON bukti + verdict vision dicatat di ledger.
- Depends: T5.1.

**T5.3 `[fe]` Dokumen + tabel bundle**
- Files: `README.md`, `AGENTS.md` (§3 diagnostik `?floor=` & nasib `?spot=`, §2 peta
  repo `FLOORS`), rujukan ke `docs/design/gedung-3lantai.md`.
- Implement: dokumentasikan deep-link baru + legacy, cutaway default, lift; ukur bundle
  sebelum/sesudah (`npm run build`, raw+gzip per chunk) — tanpa dep baru, kenaikan
  hanya dari kode sprite gedung.
- Verify: `grep -n "28 x 20\|28×20" README.md AGENTS.md` hanya menyisakan catatan
  sejarah; `bash verify/e2e_review.sh` tetap lulus; tabel bundle siap tempel.
- Depends: T3.1. **Paralel dengan T4/T5.1–T5.2.**

### T6 — Gate akhir (definition of done penuh)

**T6.1 `[test]` Semua gate + body PR**
- Files: tidak ada kode baru; jalankan semua gate, siapkan body PR (Problem·Change·
  Proof·Risk), review oleh agen lain (AGENTS.md §6 — penulis tidak me-review).
- Verify (semua wajib, output ditempel di PR):
  1. `cd backend && GOTMPDIR=/workspace/.gotmp TMPDIR=/workspace/.gotmp go vet ./... && go test -count=1 ./...`
  2. `cd frontend && npx tsc --noEmit && npm run build`
  3. `bash verify/e2e_review.sh`
  4. roster_check + layout_check + anim_check + visual_check (esbuild+node) → keempatnya OK
  5. shot desktop+mobile (cutaway & floor-focus) + offline + verdict `vision_analyze`
  6. bukti scrollTop roster + probe `ok:true`
  7. tabel bundle sebelum/sesudah
  8. `git diff --stat origin/main -- backend/` kosong
- Depends: semua task di atas.

### Graf dependensi & paralelisme
```
T1.1 → T1.2 → T1.3 ─┬→ T2.2 → T2.3 ─┬→ T3.1 → T3.2 → T3.3 ─┐
T1.4 (paralel) ─────┘               │                       │
T2.1 (paralel penuh) ──→ T2.2       └→ T4.1 → T4.2 → T4.3 ──┼→ T5.1 → T5.2 ─┐
                                    T5.3 (paralel setelah T3.1) ────────────┼→ T6.1
```
Aman paralel: {T1.4, T2.1} dengan rantai T1; {T3, T4} setelah T2.3; {T5.3} dengan T4/T5.1.

---

## Risiko & jebakan

1. **Gate geometri vs angka beku (terbesar).** Angka core membuat node lift/stair
   berjarak 0.7 dari obstacle-nya (< ruang papasan 0.75). Solusi sudah diputuskan di
   A3: edge incident core diuji RADIUS 0.35, edge sirkulasi tetap 0.75 — tulis
   alasannya di komentar test supaya reviewer tidak menganggap gate dilonggarkan
   sembarangan. Godaan lain: "merapikan" rot/posisi meja agar sprite terlihat benar —
   **dilarang**, rot adalah data (pelajaran office-2d). Jalankan roster+layout check
   setelah setiap subtask yang menyentuh `lib/`. Lorong belakang wajib z=-4.9 (bukan
   -5.18) karena papan dinding; celah sempit antar furnitur L1 tidak boleh jadi edge nav.
2. **Label overlap lintas slab.** Solver `placeStacks` bekerja di seluruh kanvas;
   plate lantai bawah bisa melayang naik ke slab tetangga saat ladder dy panjang.
   Mitigasi: plakat slab sebagai reserved rects, gate visual overlap 0 di kedua layar,
   dan bila perlu batas dy per mode disetel di uiux doc — tanpa mengubah aturan
   plateScale/nama penuh. 13 plate scale-2 di 390×692 lebih longgar dari lantai lama
   (624 px vertikal vs 320), tapi wajib dibuktikan angka, bukan klaim.
3. **Hit-test lintas lantai.** Dua meja di x,z lokal sama pada lantai berbeda tidak
   boleh tertukar: inverse transform harus mengembalikan floor, dan `nearestAt`
   difilter per floor. Klik gap/shaft harus jatuh ke slab terdekat, bukan `onPick('')`
   yang menutup kartu. Uji manual + probe.
4. **Zoom clamp extent gedung.** `clampCenter`/`fitZoom` lama memakai extent satu
   lantai; bila lupa diganti, cutaway terpotong atau floor-focus menggeser slab
   keluar layar. Gate: `fitZoom(1000,688)=fitZoom(390,692)=1`, floor-focus integer 2,
   tidak ada yang off-canvas (visual_check).
5. **Performa 3 slab.** Static layer 384×624 (≈3× luas lama) tetap di-prerender sekali;
   bahaya bila coder menggambar ulang dinding/furnitur per frame atau membuat 3
   offscreen yang di-blit ulang tiap frame tanpa cache. Loop per-frame hanya agen +
   chip + kabin + amplop; pause `document.hidden`; plate cache per (teks,warna,skala).
6. **Determinisme walk/ride.** Semua fase dari `hashId` + `t`; ride lift bukan
   `setTimeout`/`Math.random`. `?still=1` membekukan t → screenshot stabil; dua reload
   dengan payload sama harus menghasilkan frame identik (diuji anim_check).
7. **`cfg.layout.floor` 28×20 dari backend.** Bila `applyConfig` masih membaca angka
   itu, planning agen baru memakai extent salah dan meja bisa mendarat di luar slab.
   Frontend wajib memakai footprint `FLOORS` (A2); `seedConfig` 24×12; check per lantai
   menangkap pelanggaran.
8. **Outage ≠ kantor kosong.** Renderer wajib menggambar meja dari `rosterAgents()`
   per lantai, lalu menimpa status per id; agen hilang dari payload = offline (redup +
   Z Z Z + chip), bukan kursi hilang. Shot offline wajib (T5.2).
9. **Privacy.** Chip blocked tetap `blockedChipText` generik; chip task hanya id;
   amplop tidak membawa teks; tidak ada `fillText` dari feed selain kind/tool/counter.
10. **Roster scroll regresi (cc2add3).** Restyle tombol lantai/CSS bisa menghapus
    overflow `.roster-body`. Bukti numerik `scrollTop` wajib di probe, bukan klaim visual.
11. **DPR pecahan & lazy-load.** Resep backing-integer (`blitScale`) dan pola
    double-rAF + fallback 1500 ms di `Scene.tsx` wajib bertahan; cabang
    `vite/preload-helper → react` di vite config jangan disentuh; `lib/focus.ts`
    tetap type-only terhadap modul view agar entry bundle tidak menyeret chunk scene.
12. **HP floor-focus zoom 2 = pan horizontal** (Q1): clamp harus menjaga slab terlihat
    penuh vertikal; jangan "memperbaiki" dengan zoom pecahan — zoom integer 1..4 harga mati.
13. **e2e_review.sh** memakai webroot sintetis — tidak terdampak scene, tapi jangan
    ubah perilaku cache/gzip backend; tetap dijalankan sebagai gate.

---

## Progress ledger

- [ ] T1.1 `FLOORS` di rooms.ts + `desk.floor` + koordinat meja baru (angka beku)
- [ ] T1.2 roster/nav/routes/presence per lantai + `buildTrip` + abaikan cfg floor 28×20
- [ ] T1.3 roster_check + layout_check per lantai (incl. invariant lift/stair, A3) — ROSTER OK, LAYOUT OK
- [ ] T1.4 `focus.floor` aditif di view/focus — tsc+build hijau
- [ ] T2.1 palet modern + sprite lift/tangga/kaca/baja/furnitur lobby
- [ ] T2.2 viewport gedung (384×624, offset 216) + render 3 slab + anim_check viewport — ANIM OK
- [ ] T2.3 Office2D cutaway default + pan/zoom gedung
- [ ] T3.1 tombol L1/L2/L3+Gedung, `SPOT_VIEW` lantai, deep-link `?floor=` + mapping legacy
- [ ] T3.2 hit-test per floor + klik slab = focus + onNear per floor
- [ ] T3.3 gate interaksi/deep-link di anim_check — ANIM OK
- [ ] T4.1 Trip lintas lantai + ride lift deterministik (kabin di shaft)
- [ ] T4.2 amplop comms lintas slab
- [ ] T4.3 gate Trip (anim_check) + errand lintas lantai (layout_check) — ANIM OK, LAYOUT OK
- [ ] T5.1 visual_check cutaway: 13 meja+plate, 3 slab, overlap 0, on-canvas 1000×688 & 390×692 — VISUAL OK
- [ ] T5.2 probe diperbarui + shot desktop/mobile/offline/floor-focus + verdict vision + scrollTop
- [ ] T5.3 README/AGENTS diagnostik baru + tabel bundle sebelum/sesudah
- [ ] T6.1 gate akhir: backend vet+test · tsc+build · e2e 51 cek · 4 check OK · shot+vision ·
      scrollTop · bundle · `git diff backend/` kosong
- [ ] Q1 (pan HP zoom 2) & Q2 (nama tombol Gedung) + A4 (POI gamelan/jendela) dikonfirmasi saat review
- [ ] `docs/design/gedung-3lantai.md` selesai oleh uiux sebelum finalisasi T2.1/T2.2
- [ ] PR dibuat oleh orchestrator/bos; review oleh agen lain (penulis tidak me-review)
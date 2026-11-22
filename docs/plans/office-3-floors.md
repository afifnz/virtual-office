# Rencana: Gedung Kantor 3 Lantai (office-3-floors)

**Goal:** mengubah kantor 2D satu lantai menjadi gedung modern 3 lantai — L1 Lobby, L2 Tim Edu, L3 Tim Dev — satu lantai per layar, dengan lift sebagai satu-satunya transisi antar lantai, tetap di engine canvas 2D `frontend/src/scene2d/`.

**Non-goals:** tidak ada perubahan backend (kontrak `/api/config` & `/api/status` tetap), tidak ada dependensi npm baru, tidak ada three.js/WebGL, tidak ada tampilan cutaway bertumpuk atau eksterior gedung, tidak ada motif joglo/pendopo/gamelan/lesehan.

**ui: yes** — ada UI baru (tab lantai L1/L2/L3 di DOM bar atas kanvas, chip lift, roster dikelompokkan per lantai). Detail visual diserahkan ke desainer uiux; acuan: `docs/design/office-3-floors.md` (dibuat/diperbarui di M3, dari `docs/design/office-2d.md`).

**Commands** (dari root repo):
- typecheck = `cd frontend && npx tsc --noEmit`
- build = `cd frontend && npm run build`
- check = `frontend/node_modules/.bin/esbuild verify/<name>.ts --bundle --format=esm --platform=node --outfile=/tmp/<name>.mjs && node /tmp/<name>.mjs` untuk `roster_check`, `layout_check`, `anim_check`, `visual_check`
- e2e = `python3 deploy/make-fixture.py /tmp/hh && bash verify/e2e_review.sh` (butuh binary Go, lihat §Risks)
- probe = build + `npm run preview`, tempel `verify/office2d_probe.js` di console pada `?still=1`, desktop 1280×800 dan mobile 390×844

---

## Analysis

### Keadaan kode saat ini (diverifikasi di branch ini, basis `eb62293`)

| Modul | Isi sekarang | Implikasi untuk 3 lantai |
|---|---|---|
| `lib/rooms.ts` (362 baris) | Satu `FLOOR = {w:28, d:20}`; `WALLS/DOORS/POIS/NAV/NAV_EDGES/OBSTACLES` flat tanpa lantai; partisi pendopo di z=2; `SPOTS`/`EXTERIOR`/`START_SPOT` sisa 3D; `DESKS` diturunkan dari `AGENTS`; `DESK_EXIT` = 2.0 di belakang kursi; `nearestNode(x,z)` global; memanggil `setFloorContext(WALLS, edges)` + `setFurniture(...)` ke roster saat module load | Semua array butuh medan `floor` + accessor; `SPOTS/EXTERIOR/START_SPOT` dihapus (dead code 3D, hanya dipakai `App.tsx` dan `layout_check.ts`) |
| `lib/agents.ts` (250) | 13 agen seed, `desk: {x,z,rot}` tanpa floor; blok dev 3×2 di x -9.22..-5.98, z -4.79..-4.01 + lead di (-10.42,-4.4); blok edu 2×2 di x 6.19..7.81; `TEAMS.lobby.label = 'PENDOPO'` | Koordinat blok digeser utuh (relasi antar meja tidak berubah, semua check blok tetap lulus); `desk.floor` ditambah; label lobby → `LOBBY` |
| `lib/layout.ts` (289) | `planDesks` murni: lattice 4.5×4.0, aisle 1.6, `TEAM_CENTRE` per tim, `clearance({floor:{w,d}})` sudah menerima ukuran lantai | Tinggal diberi konteks floor: `TEAM_CENTRE` per lantai + `PlanInput.floor` diisi `FLOORS[f]`; algoritma tidak berubah |
| `lib/nav.ts` (72) | Dijkstra satu grafik global `ADJ` dari `NAV_EDGES` | Adjacency per lantai; id node diberi prefix `l1-`/`l2-`/`l3-` sehingga `navPath(from,to)` tidak pernah menyeberang lantai by construction |
| `lib/routes.ts` (96) | `onward/homeward/retrace` memakai `nearestNode` global; `avoid()` local avoidance | `nearestNode(x,z,floor)`; rute tidak pernah lintas lantai — lift adalah segmen perjalanan terpisah |
| `lib/roster.ts` (481) | `/api/config` sumber kebenaran; `applyConfig` memakai `cfg.layout.floor` (28×20 dari backend) untuk placement; `setFloorContext`/`setFurniture` tunggal; `guessTeam`: default→lobby, edu*→edu, sisanya dev | Placement per lantai: `TEAM_FLOOR = {lobby:1, edu:2, dev:3}`; ukuran lantai diambil dari `FLOORS` (frontend otoritatif), `cfg.layout.floor` tetap diparse tapi tidak dipakai untuk geometry (backend tidak boleh berubah) |
| `scene2d/viewport.ts` (131) | `WORLD_W/H = 448×320` global; `worldToPixel(x,z)`, `fitZoom(w,h)`, `clampCenter(vp,w,h)`; `Viewport {x,z,zoom}` | Semua fungsi diberi parameter/medan `floor`; `Viewport` gains `floor: 1\|2\|3` |
| `scene2d/render.ts` (641) | `createStaticLayer()` tunggal; `zoneAt` hardcoded lobby/dev/edu; `walkState()` delegate satu lantai (out→stand→back, period 16+seed·6, speed 1.8); envelope comm lerp antar kursi; batur terakota di luar lantai | Static layer di-cache per lantai; `walkState` → `journeyState` (segmen lift); envelope hanya sesama lantai aktif (lihat §Lift); batur → alas beton modern |
| `scene2d/labels.ts` (281) | `ZONE_LABELS` 3 plakat (TIM DEV/TIM EDU/PENDOPO) + MASUK; `placeStacks` deterministik CSS-px | Plakat per lantai: L1 `LOBBY`+`MASUK`, L2 `TIM EDU`, L3 `TIM DEV`; matematika label tidak berubah |
| `scene2d/Office2D.tsx` (366) | Satu kanvas, pan/zoom integer 1..4, `?still=1`, `__office2dReady`/`__office2dVp`, keyboard WASD/+/− | `vp.floor`, cache static per lantai, keyboard 1/2/3, pick/proximity hanya lantai aktif |
| `App.tsx` (245) + `components/Hud.tsx` | `?spot=` via `SPOTS`, `?face=`/`#id` via `flyToAgent`; `SpotNav` tombol ruang lobby/dev/edu/luar di HUD | State `floor` + `?floor=`; `SpotNav` diganti tab lantai (slot DOM yang sama — anggaran tinggi kanvas tidak berubah); `flyToAgent` pindah lantai otomatis |
| `verify/*` | `roster_check` (seed tetap, aisle, blok, lattice), `layout_check` (nav/POI/exit/errand/papasan/konektivitas dari `gate`), `anim_check` (pose, viewport math, palette), `visual_check` (13 meja on-screen, plate no-overlap di canvas 1000×688 & 390×692), `office2d_probe.js` (DOM, hardcoded 448×320) | Semua jadi per-lantai; probe membaca ukuran dunia dari `vp.floor` |

Baseline terverifikasi hari ini di branch ini: `npx tsc --noEmit` OK; `roster_check` → ROSTER OK; `layout_check` → LAYOUT OK; `anim_check` → ANIM OK; `visual_check` → VISUAL OK.

### Requirement (fungsional + non-fungsional)

Fungsional:
1. Tiga lantai, satu lantai per layar; tab L1/L2/L3 di DOM bar di atas kanvas; keyboard 1/2/3 pindah lantai.
2. Pemetaan agen 1/4/8 (tabel di bawah); resepsionis hanya prop/POI di L1, bukan agen.
3. Lift core tunggal di sisi timur setiap lantai; delegasi lintas lantai = jalan ke lift → dwell 2.6 s (pintu terbuka + chip lantai tujuan, mis. "di lift · L3") → muncul di lift lantai tujuan → jalan ke meja target → berdiri → balik ke lift → lift balik → jalan pulang. Tidak ada teleport tanpa transisi.
4. Deep link lama tetap hidup: `?spot=`, `?face=`, `#id`, `?still=1`; baru `?floor=1|2|3`.
5. Zoom integer 1..4; default desktop = fit per lantai, mobile = zoom 1 + pan.
6. Roster dikelompokkan per lantai; klik agen → pindah lantai + fokus meja.
7. Privasi: chip blocked tetap generik (`blockedChipText`), chip tugas hanya id (`#` + 6 huruf pertama, sudah ada di `countersLine`); chip lift hanya label lantai — tidak pernah isi pesan/judul.

Non-fungsional: tetap canvas 2D pixel-art nearest-neighbour (TILE=16, blit integer), deterministik (tanpa `Math.random`, clock `t` beku saat `?still=1`), murni/headless-testable (semua matematika di `lib/` + `labels.ts`/`viewport.ts` tanpa DOM), fallback seed saat API mati tetap menampilkan 13 meja (AGENTS.md §5), tanpa dependensi baru.

### Kriteria penerimaan

- 13 meja terbagi 1/4/8 di lantai yang benar; setiap meja/POI/wall/door/nav node punya `floor`.
- Aisle ≥ 1.6 ke dinding/furniture di luar blok; blok dev 3×2 + lead flush, blok edu 2×2 tetap mepet (BLOCK_GAP 0.02).
- Konektivitas nav 100% per lantai; node lift ada di tiap lantai dan terhubung ke grafik lantai itu; shaft lift adalah obstacle di tiap lantai.
- Perjalanan lift: dwell tepat 2.6 s, chip lantai tujuan, agen hanya tergambar di satu lantai pada satu waktu; delegasi sesama lantai tetap loop walk-out/walk-home lama.
- Plate di dalam kanvas + tanpa overlap di desktop 1000×688 dan mobile 390×692, per lantai; lift tergambar di setiap lantai.
- Semua gate §DoD hijau; screenshot desktop+mobile + verdict `vision_analyze` (AGENTS.md §5).

### Asumsi

- 13 agen tetap; tidak ada agen resepsionis (POI `resepsionis` + prop counter).
- Backend tidak disentuh: `/api/config` tetap menerbitkan `layout.floor 28×20` dan label `Pendopo`; frontend yang memetakan tim→lantai dan ukuran lantai (lihat §Risks R2).
- Koordinat furniture L1/L2/L3 di bawah adalah proposal final yang sudah dihitung clearance-nya; `layout_check` tetap penentu akhir — geser kecil (< 0.5 unit) di dalam zona yang sama diperbolehkan tanpa mengubah rencana.

---

## Technical design

### Arsitektur

Tidak ada komponen baru di luar pola yang ada: data geometri di `lib/rooms.ts` (satu sumber koordinat, AGENTS.md §1.5), matematika murni di `lib/layout|nav|routes` + `scene2d/viewport|labels`, painter di `scene2d/render`, state React di `App`/`Office2D`. Aliran baru: `App.floor` → `RigCommand.floor` → `Viewport.floor` → `renderFrame` hanya menggambar lantai aktif; `journeyState(meta, pose, t)` (murni, di `render.ts`) menghitung posisi + lantai berjalan seorang delegator, termasuk dwell lift.

### Data model (satu sumber koordinat per lantai)

Pilihan: **array flat dengan medan `floor: 1|2|3` + accessor** (bukan nested record) — perubahan bentuk minimal, check lama cukup memfilter per lantai.

```ts
// lib/rooms.ts
export type FloorId = 1 | 2 | 3
export const FLOOR_IDS: FloorId[] = [1, 2, 3]
export const FLOORS: Record<FloorId, { id: FloorId; w: number; d: number; name: string; label: string; sub: string }> = {
  1: { id: 1, w: 28, d: 20, name: 'Lobby',   label: 'LOBBY',   sub: 'penerima tamu' },
  2: { id: 2, w: 20, d: 16, name: 'Tim Edu', label: 'TIM EDU', sub: 'materi kuliah & pelatihan' },
  3: { id: 3, w: 24, d: 18, name: 'Tim Dev', label: 'TIM DEV', sub: 'pengembangan aplikasi' },
}
// WallSeg/Door/Poi/NavNode/Obstacle gains floor: FloorId
export function wallsOf(f: FloorId): WallSeg[]      // + doorsOf, poisOf, navOf, edgesOf, obstaclesOf
export function nearestNode(x: number, z: number, floor: FloorId): NavNode
export const LIFT: Record<FloorId, { shaft: Obstacle; doorX: number; node: NavNode }>
export function liftNode(f: FloorId): NavNode
// DESKS/DESK_EXIT/CLUSTERS/LEAD_DESKS/BLOCK_GAP: bentuk tetap (DESKS ikut desk.floor)
// SPOTS, EXTERIOR, START_SPOT, WALL_H: dihapus (sisa 3D)
```

Ukuran lantai **dipilih dari furniture**, bukan sebaliknya (pola lama):
- L3 24×18: pulau dev 3×1.62 = 4.86 lebar + meja lead 1.03 di sisi barat + aisle 1.6 keliling + lorong utara ke rak server/papan sprint + pantry barat + meja standup tenggara + shaft lift 2.6 di timur → 24 cukup dengan aisle ≥ 1.6 di semua sisi; kedalaman 18 memberi lorong depan (z≈2.6) dan belakang (z≈-3.4) plus zona utara.
- L2 20×16: blok edu 2×1.62 = 3.24 + aisle 1.6 + rak buku/papan tulis utara + nook rapat barat daya + printer tenggara + lift timur → 20×16; lantai lebih kecil karena hanya 4 meja.
- L1 28×20: tetap ukuran lama (satu-satunya lantai yang sudah 28×20) — resepsionis + meja Ndoro menghadap pintu masuk, lounge tenggara, ruang rapat kaca timur laut, pantry barat, lift timur.

`lib/agents.ts`: `AgentMeta.desk` gains `floor: FloorId`; `TEAMS.lobby = { label: 'LOBBY', name: 'Lobby', ... }` (edu/dev label tetap). `lib/layout.ts`: `TEAM_CENTRE: Record<string, { floor: FloorId; x: number; z: number }>`; `PlanInput.floor` tetap `{w,d}` tapi diisi `FLOORS[f]` oleh pemanggil. `lib/nav.ts`: id node berprefix `l1-`/`l2-`/`l3-`, `NAV_EDGES` hanya intra-lantai → `navPath` tetap 2 argumen dan tidak pernah lintas lantai. `lib/routes.ts`: `DeskLike.desk` gains `floor`; `onward/homeward` memanggil `nearestNode(..., meta.desk.floor)`. `lib/roster.ts`: `TEAM_FLOOR = { lobby: 1, edu: 2, dev: 3 }`; `setFloorContext(floor, walls, edges)` + `setFurniture(floor, list)`; `ensureAgent`/`applyConfig` men-plan per lantai dengan obstacle/edge/ukuran lantai itu; `cfg.layout.floor` tidak dipakai untuk geometry.

`scene2d/viewport.ts`:

```ts
export interface Viewport { x: number; z: number; zoom: number; floor: FloorId }
export function worldSize(f: FloorId): { w: number; h: number }   // px: 448×320, 320×256, 384×288
export function worldToPixel(x: number, z: number, floor: FloorId): PixelPoint
export function pixelToWorld(px: number, py: number, floor: FloorId): WorldPoint
export function fitZoom(floor: FloorId, viewW: number, viewH: number): number
export function clampCenter(vp: Viewport, viewW: number, viewH: number): Viewport  // pakai vp.floor
// worldToScreen/screenToWorld: pakai vp.floor; WORLD_W/H, FLOOR_W/D global dihapus
```

Nilai fit terverifikasi (TILE=16, FIT_MARGIN=0.94): desktop canvas 1000×688 → zoom **2** di ketiga lantai; mobile 390×692 → zoom **1** di ketiga lantai (L1 448 px pan horizontal, L2 320 px dan L3 384 px muat lebar).

### Kontrak "API" (tidak ada HTTP baru; kontrak internal dipatok sebelum task fe)

Deep link (query contract, diputus di M2):

| Param | Perilaku |
|---|---|
| `?floor=1\|2\|3` | lantai awal; nilai lain/absen → 1. Prioritas tertinggi |
| `?face=<id>` / `#<id>` | potret/fokus agen → lantai = `desk.floor` agen (kecuali `?floor=` eksplisit menang) |
| `?spot=lobby` | lantai 1, preset lobby; `?spot=edu` → lantai 2; `?spot=dev` → lantai 3 |
| `?spot=tampak` | fit lantai aktif (default 1); `?spot=luar` → alias fit lantai 1 (tidak ada view eksterior) |
| `?still=1` | clock beku, tidak berubah |

Pindah lantai (tab/keyboard/roster) menulis `history.replaceState` `?floor=` agar deep link selalu shareable. `RigCommand` gains `floor?: FloorId`; `SPOT_VIEW` jadi per-lantai di `lib/view.ts` (`SPOT_VIEW: Record<FloorId, Record<string, SpotView>>` + `SPOT_FLOOR: Record<string, FloorId>` untuk kompatibilitas `?spot=`).

Kontrak journey (murni, diuji `anim_check` sebelum diimplementasi):

```ts
// scene2d/render.ts (atau lib/journey.ts bila lebih bersih) — bentuk:
interface JourneyState { floor: FloorId; x: number; z: number; walking: boolean; liftDest: FloorId | null }
function journeyState(meta: AgentMeta, pose: Pose, t: number): JourneyState
// liftDest != null hanya selama dwell 2.6 s → chip "di lift · L<liftDest>" + pintu terbuka
```

### Batas frontend/backend

Semua perubahan di `frontend/` + `verify/` + `docs/`. Backend Go, `/api/config`, `/api/status`, `deploy/` tidak disentuh. Label tim dari backend (`Pendopo`) dinormalisasi roster seperti sekarang (`normalizeTeam`), lalu dipetakan ke lantai oleh frontend.

---

## Pemetaan agen → lantai (13 agen: 1/4/8)

| Lantai | Tim | id | Nama | Meja (x, z, rot) |
|---|---|---|---|---|
| L1 | lobby | `default` | Ndoro Kakung (ASISTEN UTAMA) | (-6.9, 6.4, PI) — tetap, menghadap pintu masuk |
| L2 | edu | `edu` | Ayu (EDU LEAD) | (-0.81, 1.0, 0) |
| L2 | edu | `edu-designer` | Nisa | (0.81, 1.0, 0) |
| L2 | edu | `edu-writer` | Yohan | (-0.81, 0.22, PI) |
| L2 | edu | `edu-reviewer` | Hadi | (0.81, 0.22, PI) |
| L3 | dev | `dev` | Bima (SDLC LEAD) | (-2.82, -0.39, -PI/2) — vertikal 1.03×1.62 flush sisi barat pulau |
| L3 | dev | `coder2` | Bagas | (-1.62, 0, 0) |
| L3 | dev | `planner` | Raka | (0, 0, 0) |
| L3 | dev | `uiux` | Laras | (1.62, 0, 0) |
| L3 | dev | `coder` | Dimas | (-1.62, -0.78, PI) |
| L3 | dev | `reviewer` | Yoga | (0, -0.78, PI) |
| L3 | dev | `tester` | Sari | (1.62, -0.78, PI) |
| L3 | dev | `devops` | Wahyu | (5.0, -6.2, 0) — free-standing dekat rak server |

Blok digeser utuh dari koordinat lama sehingga semua invarian blok (pitch kolom 1.62, pitch baris 0.78, tops mepet, lead flush + centered) tetap berlaku: dev = translasi (+7.6, +4.01), edu = translasi (-7.0, +5.01). Lead L3 terhitung: footprint x -3.46..-2.43 (x2 = tepi barat pulau -2.43, flush), z -1.2..0.42 (pusat -0.39 = pusat kedalaman pulau). Resepsionis = prop counter + POI di L1, **bukan** agen.

---

## Denah per lantai

Konvensi: +z ke selatan (bawah layar), dinding utara z = -d/2. Semua koordinat world unit. Shaft lift = obstacle di tiap lantai; node lift walkable 1.0 di barat pintu.

### Lift (aturan sama persis di ketiga lantai)

- Shaft: `x1 = floorHalfWidth - 2.8`, `x2 = floorHalfWidth - 0.2`, `z -1.0..2.2` (2.6 × 3.2), pintu menghadap barat (di sisi x1).
- Node lift: 1.0 barat pintu, z = 0.6 → **L1 (10.2, 0.6), L2 (6.2, 0.6), L3 (8.2, 0.6)**; id `l1-lift`/`l2-lift`/`l3-lift`.
- Shaft masuk `OBSTACLES` tiap lantai (id `lift-1/2/3`); node terhubung ke grafik lantai itu.

| Lantai | halfWidth | Shaft x1..x2 | Node lift |
|---|---|---|---|
| L1 | 14 | 11.2..13.8 | (10.2, 0.6) |
| L2 | 10 | 7.2..9.8 | (6.2, 0.6) |
| L3 | 12 | 9.2..11.8 | (8.2, 0.6) |

### L1 — Lobby, 28×20 (x -14..14, z -10..10)

```
        UTARA (z=-10)
  +------------------+-----------+
  |                  | RAPAT     |   partisi kaca: z=-3.5 (x 3.2..14,
  |   (area terbuka) | meja rapat|   doorway x 6.6..9.4) + x=3.2 (z -10..-3.5)
  |                  |           |
  |            [LIFT]=========== |   shaft x 11.2..13.8, z -1.0..2.2
  | PANTRY  kopi     |  ·lift    |
  | (barat) meja-kopi|           |
  |                  |  LOUNGE   |   sofa x 12.95..13.85 z 4.2..6.6
  | Ndoro  resepsio- |  sofa+meja|   sofa-table x 11.15..12.45 z 5.05..5.75
  | meja   nis       |           |
  +------[ MASUK ]---+-----------+
        SELATAN (z=10, gap x -2.2..2.2)
```

Zona/furniture (proposal; `layout_check` penentu akhir):
- Dinding luar: utara z=-10, barat x=-14, timur x=14; selatan z=10 dengan gap masuk x -2.2..2.2 (door `MASUK`, w 4.4).
- Partisi kaca ruang rapat: `{axis:'x', at:-3.5, from:3.2, to:6.6}` + `{from:9.4, to:14}` dan `{axis:'z', at:3.2, from:-10, to:-3.5}`; doorway 2.8 di x 6.6..9.4.
- Meja Ndoro (-6.9, 6.4, PI) + counter resepsionis (obstacle x -4.27..-3.53, z 5.62..8.38 — tetap) menghadap pintu masuk; POI `resepsionis` (-3.0, 6.6, act chat).
- Lounge tenggara: sofa + sofa-table (koordinat lama, tetap); POI `lounge` (10.6, 5.4, act sit).
- Ruang rapat timur laut: meja rapat obstacle x 6.4..9.6, z -7.6..-5.4; POI `rapat` (8.0, -4.9, act chat) — fallback delegasi target tak dikenal untuk agen L1.
- Pantry barat: counter kopi x -13.9..-13.2, z 3.9..6.9 + meja-kopi x -11.35..-9.45, z 4.7..6.5 (tetap); POI `kopi` (-12.4, 5.4, sip), `meja-kopi` (-10.4, 4.2, sip), `jendela` (-10.4, 9.2, gaze).
- Dihapus: kucing, gamelan, lesehan, berkas/materi (prop lama z≈1), semua dinding partisi z=2.
- Nav (prefix `l1-`, proposal): `gate` (0,9.3), `south-w` (-8.6,9.3), `south-e` (8.6,9.3), `pantry-s` (-12.3,8.6), `pantry` (-12.3,5.4), `west` (-12.3,3.5), `wm` (-8.6,3.5), `c` (-2.0,3.5), `sc` (2.6,3.5), `e` (10.2,3.5), `recep` (-2.2,6.6), `lounge` (10.2,5.4), `meet-door` (8.0,-2.6), `meet-in` (8.0,-4.4), `lift` (10.2,0.6). Edge: ring selatan `gate↔south-w↔pantry-s↔pantry↔west↔wm↔c↔sc↔e↔south-e↔gate`, spur `c↔recep`, `sc↔lounge`, `e↔lift`, `e↔meet-door↔meet-in`, `lift↔meet-door`. Exit Ndoro (-6.9,4.4) → `wm` lurus bebas furniture.

### L2 — Tim Edu, 20×16 (x -10..10, z -8..8)

```
        UTARA (z=-8)
  +--[rak buku]--[whiteboard]----+
  |                              |
  |   lorong utara (z≈-2.2)      |
  |        [blok edu 2x2]   [LIFT]  shaft x 7.2..9.8, z -1.0..2.2
  |   lorong selatan (z≈3.4)     |
  | NOOK rapat        PRINTER    |
  | (barat daya)      (tenggara) |
  +------------------------------+
        SELATAN (z=8)
```

- Blok edu 2×2 touching: kolom x ±0.81 (pitch 1.62), baris depan z=1.0 rot 0, belakang z=0.22 rot PI (pitch 0.78). Exit depan (±0.81, 3.0), belakang (±0.81, -1.78).
- Rak buku dinding utara: obstacle x -4..-1, z -7.9..-7.5; POI `buku` (-2.5, -7.0, read). Whiteboard: x 1..4, z -7.85..-7.65; POI `papan-edu` (2.5, -7.0, read).
- Nook rapat barat daya: meja obstacle x -7.3..-5.7, z 4.9..6.1; POI `rapat` (-6.5, 4.4, chat) — fallback delegasi L2.
- Printer tenggara: obstacle x 5.6..6.4, z 6.2..6.8; POI `printer` (5.0, 6.5, check).
- Nav (prefix `l2-`): `lift` (6.2,0.6), `s` (0,3.4), `sw` (-4.5,3.4), `se` (4.5,3.4), `n` (0,-2.2), `nw` (-4.5,-2.2), `ne` (4.5,-2.2), `shelf` (-2.5,-6.6), `board` (2.5,-6.6), `nook` (-6.5,3.9), `printer` (4.6,6.0). Edge: `s↔sw`, `sw↔nook`, `s↔se`, `se↔printer`, `n↔nw`, `nw↔shelf`, `n↔ne`, `ne↔board`, `sw↔nw`, `se↔ne`, `se↔lift`, `ne↔lift`. **Tidak ada edge `s↔n`** — garis x=0 menembus blok edu; lorong utara↔selatan lewat ring barat (`sw↔nw`) atau timur (`se↔ne`).

### L3 — Tim Dev, 24×18 (x -12..12, z -9..9)

```
        UTARA (z=-9)
  +--[papan sprint]-----[rak server]--+
  |                                   |
  |  lorong belakang (z≈-3.4)   Wahyu |
  | [lead][pulau dev 3x2]       meja  |
  |  lorong depan (z≈2.6)        [LIFT]  shaft x 9.2..11.8, z -1.0..2.2
  | PANTRY                STANDUP     |
  | (barat)               (tenggara)  |
  +-----------------------------------+
        SELATAN (z=9)
```

- Pulau dev 3×2: kolom x -1.62, 0, 1.62; depan z=0 rot 0, belakang z=-0.78 rot PI. Lead Bima (-2.82, -0.39, -PI/2) flush sisi barat (x2=-2.43 = x1 pulau), menghadap +x. Exit depan (x, 2.0), belakang (x, -2.78), lead (-4.82, -0.39).
- Devops Wahyu (5.0, -6.2, 0); rak server dinding utara di **samping** mejanya: obstacle x 7.5..8.4, z -8.9..-8.0 → gap meja↔rak ≈ 2.2 (≤ 3, aturan lama) dan aisle ≥ 1.6 terjaga (dx 1.69). POI `server` (7.9, -7.4, check).
- Papan sprint dinding utara: obstacle x -4..0, z -8.85..-8.65; POI `papan` (-2.0, -8.0, read).
- Pantry barat: counter x -11.9..-11.2, z -1.5..1.5; POI `kopi` (-10.4, 0.6, sip).
- Standup tenggara: meja obstacle x 6.2..7.8, z 6.0..6.8; POI `standup` (7.0, 5.4, chat) — fallback delegasi L3.
- Nav (prefix `l3-`): `lift` (8.2,0.6), `s` (0,2.6), `sw` (-4.8,2.6), `se` (4.8,2.6), `n` (0,-3.4), `nw` (-4.8,-3.4), `ne` (4.8,-3.4), `w` (-4.8,-0.39), `ops-e` (7.4,-3.4), `rack` (7.9,-7.2), `board` (-2.0,-7.6), `pantry` (-10.4,0.6), `standup` (7.0,5.0). Edge: ring `s↔sw↔w↔nw↔n↔ne↔se↔s`, `nw↔board`, `ne↔ops-e`, `ops-e↔rack`, `sw↔pantry`, `se↔standup`, `se↔lift`, `ne↔lift`. Exit devops (5.0,-4.2) → `ne` lurus. (Node `rack` lewat `ops-e`, bukan langsung dari `ne`: garis `ne→rack` menyerempet sudut meja devops pada 0.53 < 0.75 ruang papasan — sudah diverifikasi numerik.)

---

## Cara kerja lift (spesifikasi persis)

1. **Satu lift core per lantai**, sisi timur, aturan posisi identik (§Denah/Lift). Shaft = obstacle; node lift walkable (10.2/6.2/8.2, 0.6) terhubung ke grafik lantai itu. Tidak ada edge antar lantai di `NAV_EDGES`.
2. **Delegasi lintas lantai** (`pose.walkTo.kind === 'desk'` dan `AGENT_BY_ID[to].desk.floor !== meta.desk.floor`) memakai journey bersegmen, deterministik dari `hashId(meta.id)` + clock `t`:
   - segmen A: jalan meja → node lift **lantai asal** (`onward` ke titik lift);
   - segmen B: **dwell 2.6 s** di node lift, pintu lift lantai asal terbuka, chip `di lift · L<tujuan>` (hanya label lantai — privasi aman);
   - segmen C: agen "berpindah" ke lantai tujuan — digambar di node lift lantai tujuan — lalu jalan node lift → `DESK_EXIT[target]`;
   - segmen D: berdiri di meja target (durasi stand lama, 5+seed·4 s);
   - segmen E: jalan balik ke node lift lantai tujuan;
   - segmen F: dwell 2.6 s lagi, chip `di lift · L<asal>`;
   - segmen G: muncul di node lift lantai asal → jalan pulang ke kursi (`homeward`).
   - Total periode = 2·(tA + tC) + 2·2.6 + stand + sisa duduk; speed tetap 1.8; tanpa `Math.random`; beku saat `?still=1`.
3. **Render hanya lantai aktif.** `journeyState` mengembalikan `floor` saat ini; `renderFrame` menggambar agen hanya bila `floor === vp.floor`. Agen in-transit digambar di lift lantai tempat ia berada — **tidak pernah di dua lantai sekaligus**. Pintu lift terbuka hanya selama ada agen dwell di lantai itu; chip lift adalah plate label biasa (ikut `placeStacks`, tidak overlap).
4. **Delegasi sesama lantai** tetap loop lama (out → stand → back, `walkState` sekarang menjadi kasus khusus journey tanpa segmen lift).
5. **Envelope comm**: hanya digambar bila pengirim & penerima di lantai aktif yang sama. Comm lintas lantai diwakili oleh chip lift + perjalanan agen (keputusan desain — tidak ada envelope menembus lantai; lihat §Risks R5).
6. Target delegasi tak dikenal → POI rapat **di lantai sendiri** (`rapat` L1, `rapat` nook L2, `standup` L3), bukan teleport.

---

## Perubahan per file

| File | Perubahan |
|---|---|
| `frontend/src/lib/rooms.ts` | `FLOORS/FLOOR_IDS/FloorId`, medan `floor` di semua array + accessor `wallsOf/doorsOf/poisOf/navOf/edgesOf/obstaclesOf`, `LIFT` + `liftNode`, `nearestNode(x,z,floor)`; geometri 3 lantai baru (§Denah); hapus `SPOTS/EXTERIOR/START_SPOT/WALL_H`, partisi z=2, prop gamelan/kucing/lesehan; `setFloorContext`/`setFurniture` dipanggil per lantai |
| `frontend/src/lib/agents.ts` | `desk.floor` + koordinat baru (§Tabel); `TEAMS.lobby` label `LOBBY`/name `Lobby`; fallback `agentMeta` floor 1 |
| `frontend/src/lib/layout.ts` | `TEAM_CENTRE` per lantai (`{floor,x,z}`); `planDesks/candidates` sadar floor (pemanggil menyuplai obstacle/edge/ukuran per lantai); algoritma lattice tetap |
| `frontend/src/lib/nav.ts` | Adjacency dari edge intra-lantai (id berprefix); `navPath` tetap dalam satu lantai |
| `frontend/src/lib/routes.ts` | `DeskLike.desk.floor`; `onward/homeward/retrace` memakai `nearestNode(..., floor)`; rute tidak lintas lantai |
| `frontend/src/lib/roster.ts` | `TEAM_FLOOR`; `setFloorContext(floor,...)`/`setFurniture(floor,...)`; `ensureAgent`/`applyConfig` plan per lantai dengan `FLOORS[f]`; `cfg.layout.floor` tidak dipakai untuk geometry; fallback seed tetap 13 meja |
| `frontend/src/lib/view.ts` | `RigCommand.floor?`, `SPOT_VIEW` per lantai, `SPOT_FLOOR` untuk `?spot=` lama |
| `frontend/src/lib/focus.ts` | `agentFocus` ikut mengembalikan floor (dari `meta.desk.floor`) |
| `frontend/src/scene2d/viewport.ts` | `Viewport.floor`, `worldSize(floor)`, `worldToPixel/pixelToWorld(x,z,floor)`, `fitZoom(floor,w,h)`, `clampCenter` pakai `vp.floor`; konstanta global dihapus |
| `frontend/src/scene2d/render.ts` | `createStaticLayer(floor)` cache `Map<FloorId,canvas>`; motif lantai/zona per lantai; `drawLift` (shaft baja + pintu, terbuka saat dwell); `journeyState` (§Lift); filter agen/meja/plate per lantai aktif; envelope sesama lantai; batur terakota → alas beton |
| `frontend/src/scene2d/labels.ts` | `ZONE_LABELS`/`WORLD_LABELS` per lantai (`labelsOf(floor)`): L1 LOBBY+MASUK, L2 TIM EDU, L3 TIM DEV; matematika plate tetap |
| `frontend/src/scene2d/palette.ts` | Token modern: beton grey-blue, kaca biru translusen, baja lift, lampu plafon; aksen tim tetap (kontrak `anim_check` §10 — token lama yang diuji tetap ada) |
| `frontend/src/scene2d/sprites.ts` | Sprite baru: partisi kaca, lift, lampu plafon, pantry, lounge, meja rapat, rak server modern; hapus `drawCat`/gamelan/lesehan; meja/kursi/monitor tetap |
| `frontend/src/scene2d/anim.ts` | `walkTarget` fallback → POI rapat lantai sendiri; `poseFor`/`blockedChipText` tetap (privasi) |
| `frontend/src/scene2d/Office2D.tsx` | `vp.floor` dari command; static layer per lantai; keyboard 1/2/3 → `onFloor`; pick/proximity hanya lantai aktif; `__office2dVp()` menyertakan floor |
| `frontend/src/App.tsx` | State `floor` (`?floor=`), tab lantai, `flyToAgent` pindah lantai, `?spot=` dipetakan via `SPOT_FLOOR`, `history.replaceState` saat pindah lantai |
| `frontend/src/components/Hud.tsx` | `SpotNav` (lobby/dev/edu/luar) diganti `FloorTabs` L1/L2/L3 di slot yang sama (anggaran tinggi kanvas tetap) |
| `frontend/src/components/FloorTabs.tsx` (baru) | DOM bar tab lantai, `aria-pressed`, label L1/L2/L3 + nama lantai; spec visual di `docs/design/office-3-floors.md` |
| `frontend/src/components/Roster.tsx` | Grup per lantai (L1 LOBBY / L2 TIM EDU / L3 TIM DEV); klik → `onPick` (sudah pindah lantai via `flyToAgent`) |
| `frontend/src/styles/*` | Gaya tab lantai + chip lift mengikuti token modern (detail: uiux) |
| `verify/roster_check.ts` | Seed baru (koordinat+floor), split 1/4/8, aisle per lantai, blok per lantai, lattice per lantai, node lift ada di tiap lantai |
| `verify/layout_check.ts` | Semua seksi per lantai (`obstaclesOf` dll); tim dari `desk.floor` (bukan heuristik z/x); errand replay per lantai; konektivitas 100% per lantai (L1 dari `gate`, L2/L3 dari node lift); kasus papasan memakai lorong L3 baru; seksi kamera 3D diganti cek `SPOT_FLOOR`; shaft lift = obstacle & node lift terhubung |
| `verify/anim_check.ts` | Matematika viewport per lantai (sudut/roundtrip/fit/clamp per `FloorId`); journey lift: urutan segmen, dwell 2.6, chip lantai, satu lantai per waktu, determinisme; fallback POI per lantai |
| `verify/visual_check.ts` | Loop per lantai × screen (canvas 1000×688 & 390×692): semua meja lantai itu on-screen, plate inside + no-overlap, plakat per lantai, fit desktop=2/mobile=1 per lantai, lift node ada di tiap lantai |
| `verify/office2d_probe.js` | Ukuran dunia dari `vp.floor` (bukan 448×320 hardcoded); tab lantai ada 3 & klik pindah `vp.floor`; roster 13 baris tergrup 1/4/8; lift tergambar di tiap lantai (cek piksel area shaft / debug hook) |
| `docs/design/office-3-floors.md` (baru, M3) | Spec uiux: token modern, denah, tab, chip lift, state layar; pengganti/pendamping `office-2d.md` |

---

## Tasks

Urutan: kontrak data (§Technical design) dipatok dulu; task `[test]` menulis assertion gagal sebelum implementasi (TDD). Catatan kejujuran: di tengah M1 tsc boleh merah sementara selama refaktoring signatures berantai — **checkpoint hijau adalah gate milestone** (T1.9, T2.7, T3.6); setiap task tetap punya verify sendiri. Task bertanda ∥ aman paralel.

### M1 — model data per lantai + geometri (app tetap render satu lantai, semua gate hijau)

- **T1.1 [test]** Assertion per-lantai di `verify/roster_check.ts` + `verify/layout_check.ts` (RED): split 1/4/8, `desk.floor` benar, aisle per lantai, konektivitas per lantai, node+shaft lift tiap lantai.
  - Files: `verify/roster_check.ts`, `verify/layout_check.ts` (modify)
  - Verify: esbuild+node keduanya → FAIL dengan pesan floor (belum ada API floor)
  - Depends: none
- **T1.2 [fe]** `lib/rooms.ts`: `FLOORS/FLOOR_IDS/LIFT/liftNode`, medan floor + accessor, geometri L1/L2/L3 (§Denah), hapus dead code 3D; `lib/agents.ts`: `desk.floor` + koordinat baru + `TEAMS.lobby` LOBBY.
  - Files: `frontend/src/lib/rooms.ts`, `frontend/src/lib/agents.ts`
  - Verify: `npx tsc --noEmit` (importer lama masih merah sampai T1.6 — wajar, lihat catatan)
  - Depends: T1.1
- **T1.3 [fe]** `lib/layout.ts` (`TEAM_CENTRE` per lantai, `planDesks` floor-aware) ∥ **T1.4 [fe]** `lib/nav.ts` (adjacency per lantai) ∥ **T1.5 [fe]** `lib/routes.ts` (onward/homeward floor-aware).
  - Files: masing-masing; ketiganya independen setelah T1.2
  - Verify: `npx tsc --noEmit` per file selesai
  - Depends: T1.2; T1.3 ∥ T1.4 ∥ T1.5
- **T1.6 [fe]** `lib/roster.ts`: `TEAM_FLOOR`, context per lantai, placement per lantai dengan `FLOORS[f]`; fallback seed 13 meja tetap.
  - Files: `frontend/src/lib/roster.ts`
  - Verify: esbuild+node `roster_check` → ROSTER OK
  - Depends: T1.3, T1.4, T1.5
- **T1.7 [fe]** `scene2d/viewport.ts` per lantai (`Viewport.floor`, `worldSize`, `fitZoom(floor,...)`, `clampCenter`) + `lib/view.ts` (`RigCommand.floor`, `SPOT_VIEW` per lantai, `SPOT_FLOOR`) + `lib/focus.ts`.
  - Files: `viewport.ts`, `view.ts`, `focus.ts`
  - Verify: `npx tsc --noEmit` hijau setelah T1.8 menyesuaikan pemanggil
  - Depends: T1.2
- **T1.8 [fe]** Penyesuaian pemanggil minimal: `render.ts` (`createStaticLayer(floor)`, filter lantai aktif, `drawLift` placeholder baja), `labels.ts` (plakat per lantai), `Office2D.tsx` + `App.tsx` (state floor default 1, belum ada tab), `Hud.tsx` (SpotNav → floor sementara via `SPOT_FLOOR`), `anim.ts` (fallback POI per lantai).
  - Files: `render.ts`, `labels.ts`, `Office2D.tsx`, `App.tsx`, `Hud.tsx`, `anim.ts`
  - Verify: `npx tsc --noEmit` && `npm run build` hijau; app render L1
  - Depends: T1.6, T1.7
- **T1.9 [test] + gate M1** Perbarui `anim_check.ts` + `visual_check.ts` ke API per lantai (math viewport per FloorId, screen loop per lantai); jalankan semua gate; commit `feat(office): model data & geometri 3 lantai (M1)`.
  - Files: `verify/anim_check.ts`, `verify/visual_check.ts`
  - Verify: tsc + build + 4 check esbuild/node + e2e → semua hijau
  - Depends: T1.8

### M2 — perjalanan lift + tab lantai + deep link (panel tetap berfungsi)

- **T2.1 [test]** Assertion journey di `anim_check.ts` (RED): delegasi lintas lantai → urutan segmen A..G, dwell tepat 2.6 s, chip `di lift · L<tujuan>`, `floor` tunggal per waktu, determinisme, sesama lantai tetap loop lama.
  - Files: `verify/anim_check.ts`
  - Verify: node → FAIL (journeyState belum ada)
  - Depends: T1.9
- **T2.2 [fe]** `journeyState` + pintu lift + chip lift di `render.ts` (kontrak §Lift); envelope sesama lantai saja. ∥ **T2.4 [fe]** `components/FloorTabs.tsx` + gaya + pasang di slot `SpotNav` HUD (spec: `docs/design/office-3-floors.md`).
  - Files: `render.ts`; `FloorTabs.tsx` (baru), `Hud.tsx`, styles
  - Verify: `npx tsc --noEmit`; node `anim_check` → journey OK (T2.2)
  - Depends: T2.1 (kontrak); T2.2 ∥ T2.4
- **T2.3 [fe]** `App.tsx`: state floor + `?floor=` + keyboard 1/2/3 + `flyToAgent` pindah lantai + `history.replaceState`; `Office2D.tsx`: cache static per lantai, pick/proximity per lantai, `__office2dVp().floor`.
  - Files: `App.tsx`, `Office2D.tsx`
  - Verify: tsc + build; manual `?floor=2`, tombol 1/2/3, `?face=dev` → L3
  - Depends: T2.2, T2.4
- **T2.5 [test]** `visual_check.ts`: plate/fit per lantai di 1000×688 & 390×692 + lift node tiap lantai; `layout_check.ts`: konektivitas lift per lantai (sudah di T1.1, pertegas dwell-independent).
  - Files: `verify/visual_check.ts`, `verify/layout_check.ts`
  - Verify: node keduanya → OK
  - Depends: T2.3
- **T2.6 [test]** Regresi panel: roster/feed/task/KPI/proximity tetap berfungsi lintas lantai; API mati → seed 13 meja (AGENTS.md §5); probe manual sementara.
  - Files: tidak ada kode produksi; jalankan preview + probe
  - Verify: probe `ok: true` desktop & mobile
  - Depends: T2.5
- **T2.7 gate M2** Semua gate §DoD + commit `feat(office): lift, tab lantai & deep link per lantai (M2)`.
  - Depends: T2.6

### M3 — visual modern + roster per lantai + dokumen (semua gate hijau)

- **T3.1 [fe]** `palette.ts` token modern (beton grey-blue, kaca biru translusen, baja, lampu plafon) + `sprites.ts` (partisi kaca, lift final, pantry/lounge/meeting/server; hapus gamelan/lesehan/kucing). ∥ **T3.3 [fe]** `Roster.tsx` grup per lantai 1/4/8, klik → pindah lantai + fokus.
  - Files: `palette.ts`, `sprites.ts`; `Roster.tsx`
  - Verify: tsc + build; node `anim_check` (palette §10 tetap hijau — token lama yang diuji jangan dihapus)
  - Depends: T2.7; T3.1 ∥ T3.3
- **T3.2 [fe]** `render.ts`: motif lantai modern per lantai (beton/kaca/plafon), alas beton pengganti batur terakota; plakat final.
  - Files: `render.ts`, `labels.ts`
  - Verify: tsc + build + `visual_check`
  - Depends: T3.1
- **T3.4 [test]** `visual_check.ts` + `office2d_probe.js`: assertion lift tergambar di tiap lantai, split roster 1/4/8, tab 3 buah, ukuran dunia per `vp.floor`; jalankan probe desktop 1280×800 + mobile 390×844.
  - Files: `verify/visual_check.ts`, `verify/office2d_probe.js`
  - Verify: node `visual_check` OK; probe `ok: true` di kedua ukuran
  - Depends: T3.2, T3.3
- **T3.5 [infra]** `docs/design/office-3-floors.md` (spec uiux final: token, denah, tab, chip lift, state) + screenshot desktop+mobile per lantai + verdict `vision_analyze` (AGENTS.md §5).
  - Files: `docs/design/office-3-floors.md` (baru)
  - Verify: screenshot terlampir di PR + verdict vision
  - Depends: T3.4
- **T3.6 gate M3** Semua gate §DoD + commit `feat(office): visual gedung modern & roster per lantai (M3)`.
  - Depends: T3.5

---

## Definition of Done (gate wajib, output ditempel di PR)

```bash
cd frontend && npx tsc --noEmit
cd frontend && npm run build
# dari root, untuk masing-masing roster_check layout_check anim_check visual_check:
frontend/node_modules/.bin/esbuild verify/<name>.ts --bundle --format=esm --platform=node --outfile=/tmp/<name>.mjs
node /tmp/<name>.mjs
python3 deploy/make-fixture.py /tmp/hh && bash verify/e2e_review.sh
```

Plus (AGENTS.md §5): screenshot desktop 1280×800 + mobile 390×844 per lantai dengan verdict `vision_analyze`; probe `office2d_probe.js` `ok: true` di kedua ukuran; dengan API mati kantor tetap menampilkan 13 meja seed (bukan ruangan kosong); tidak ada dependensi npm baru; tidak ada file backend berubah. Setiap milestone di-commit terpisah (`feat(office): ...`), tidak push ke main, PR di-review agen lain.

## Risks

- **R1 — e2e butuh Go & path sandbox.** `verify/e2e_review.sh` memakai `BIN=/workspace/.gotmp/bin/office-api`; lingkungan planner ini tidak punya Go maupun `/workspace`. Gate e2e harus dijalankan di lingkungan coder yang punya Go: build dulu `cd backend && CGO_ENABLED=0 GOTMPDIR=/workspace/.gotmp TMPDIR=/workspace/.gotmp go build -o /workspace/.gotmp/bin/office-api ./cmd/office-api`. Backend tidak berubah → e2e seharusnya tetap hijau; bila path sandbox berbeda, sesuaikan `BIN` lewat lingkungan, jangan edit skrip.
- **R2 — `cfg.layout.floor` backend tetap 28×20.** Frontend menjadikan `FLOORS` otoritatif untuk geometry; `cfg.layout.floor` diparse tapi diabaikan untuk placement. Ini keputusan sadar (backend tidak boleh berubah); grid/aisle dari config tetap dihormati. `roster_check` harus menegaskan agen baru mendarat di lantai timnya dengan ukuran `FLOORS`, bukan 28×20.
- **R3 — anggaran tinggi kanvas.** Gate visual memakai canvas 1000×688 (desktop) & 390×692 (mobile). Tab lantai **menggantikan** `SpotNav` di slot HUD yang sama, bukan bar baru yang menambah tinggi — kalau tidak, semua angka fit/plate bergeser. uiux memfinalkan letak; gate tetap di dua ukuran itu.
- **R4 — koordinat furniture proposal.** Koordinat L1/L2/L3 di atas sudah dihitung clearance-nya (lead flush, devops↔rak ≈2.2, aisle ≥1.6), tapi `layout_check` adalah penentu akhir; geser kecil dalam zona yang sama diperbolehkan. Jangan mengubah pitch blok/lead — invarian itu diuji keras.
- **R5 — envelope lintas lantai disembunyikan** (keputusan desain, §Lift.5). Bila bos ingin animasi comm lintas lantai, itu perubahan kecil di `render.ts` (dua hop via lift) — tidak mengubah kontrak journey.
- **R6 — privasi.** Chip lift hanya label lantai; `blockedChipText` dan `countersLine` (id tugas saja) tidak boleh berubah. `anim_check` sudah menguji kebocoran reason; tambah assertion chip lift tidak memuat teks selain `di lift · L\d`.
- **R7 — keyboard 1/2/3** tidak boleh tertelan saat fokus di elemen interaktif panel; guard `e.target` (tidak ada input teks sekarang, tapi roster/feed punya tombol).
- **R8 — fallback seed & determinisme.** `applyConfig(null)`/API mati harus tetap 13 meja 1/4/8; journey deterministik dari `hashId`+`t` (beku saat `?still=1`) agar probe/screenshot stabil.

## Open questions (tidak memblokir M1)

1. Format teks chip lift final: proposal `di lift · L3` (menunggu uiux; angka lantai saja yang wajib).
2. `?spot=luar` dipetakan ke fit L1 (tidak ada eksterior) — konfirmasi bos bila ada deep link lama yang mengharapkan view luar.
3. Apakah tab lantai perlu menampilkan jumlah agen aktif per lantai (badge)? Default: tidak, kecuali uiux meminta.

---

## Progress

### M1 — model data per lantai + geometri
- [x] T1.1 [test] assertion per-lantai roster_check/layout_check (RED)
- [x] T1.2 [fe] rooms.ts + agents.ts (FLOORS, floor field, koordinat baru, LOBBY)
- [x] T1.3 [fe] layout.ts floor-aware
- [x] T1.4 [fe] nav.ts adjacency per lantai
- [x] T1.5 [fe] routes.ts floor-aware
- [x] T1.6 [fe] roster.ts TEAM_FLOOR + placement per lantai
- [x] T1.7 [fe] viewport.ts + view.ts + focus.ts per lantai
- [x] T1.8 [fe] render/labels/Office2D/App/Hud/anim penyesuaian minimal
- [x] T1.9 [test] anim_check + visual_check per lantai; semua gate hijau; commit M1

**Status M1: DONE** (2026-11-22) — semua gate hijau: `tsc --noEmit`, `npm run build`,
roster/layout/anim/visual check OK per lantai, e2e_review 51 ok / 0 FAIL.
Koordinat persis sesuai rencana (tanpa penyesuaian); lift placeholder digambar di
tiap lantai; satu lantai dirender (default L1, tab M2).

### M2 — lift + tab + deep link
- [x] T2.1 [test] assertion journey lift (RED)
- [x] T2.2 [fe] journeyState + pintu + chip lift + envelope sesama lantai
- [x] T2.3 [fe] App floor state + ?floor= + keyboard 1/2/3 + Office2D per lantai
- [x] T2.4 [fe] FloorTabs (slot SpotNav) + gaya
- [x] T2.5 [test] visual_check/layout_check per lantai + lift
- [x] T2.6 [test] regresi panel + seed fallback + probe
- [x] T2.7 gate M2 hijau; commit M2

**Status M2: DONE** (2026-11-22) — `journey.ts` murni (segmen A..G, dwell 2.6 s,
chip `di lift · L<n>` generik, total menutup pulang-pergi); render hanya lantai
aktif + pintu lift terbuka saat dwell + envelope sesama lantai; FloorTabs DOM
overlay (L1/L2/L3 + jumlah agen + ringkasan status, keyboard 1/2/3, SpotNav
dihapus); `?floor=` menang atas `?spot=`/`?face=`, pindah lantai menulis URL &
re-fit. Semua gate hijau: tsc, build, roster/layout/anim/visual OK, e2e 51 ok.

### M3 — visual modern + roster + dokumen
- [ ] T3.1 [fe] palette + sprites modern (hapus gamelan/lesehan/kucing)
- [ ] T3.2 [fe] render motif lantai modern + alas beton
- [ ] T3.3 [fe] Roster grup per lantai 1/4/8
- [ ] T3.4 [test] visual_check + probe assertion lift/split; probe desktop+mobile
- [ ] T3.5 [infra] docs/design/office-3-floors.md + screenshot + vision_analyze
- [ ] T3.6 gate M3 hijau; commit M3
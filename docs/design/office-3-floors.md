# Kantor 3 Lantai — Spec Visual Modern (M3)

> Pengganti gaya joglo/pendopo/terakota di `docs/design/office-2d.md` (yang
> dokumennya kini superseded). Berlaku untuk kanvas 2D pixel-art
> (`frontend/src/scene2d/*`) dan panel-panel di `frontend/src/components/*`.
> Aturan tegas: **tanpa gradien, tanpa blur, tanpa emoji**; bayangan = tone
> solid satu tingkat lebih gelap; semua sprite prosedural `fillRect` (tanpa
> aset gambar).

## 1. Bahasa visual

Gedung kantor modern: rampa beton grey-blue membawa lantai, dinding, dan
papan nama; kaca biru sebagai partisi (2–3 tone solid, **bukan** gradien
alpha); baja untuk lift, kaki meja, dan frame; lampu plafon warm-white
satu-satunya catatan terang; satu aksen amber untuk state aktif. Warna status
agen dibagi dengan chrome panel sehingga titik di kanvas = titik di sidebar.

## 2. Token palet (`scene2d/palette.ts`)

### 2.1 Keluarga utama (PALETTE)

| Token | Hex | Pemakaian | Catatan kontras |
|---|---|---|---|
| `concrete100` | `#E4EAF0` | top meja putih, resepsionis | teks gelap `bubbleInk` di atasnya |
| `concrete200` | `#C7D2DE` | panel depan meja, lantai L2 | kontras baik dengan `ink` maupun `concrete700` |
| `concrete500` | `#3B4A5E` | trim, tepi plinth, border plate offline | batas plate terbaca di atas `concrete800/900` |
| `concrete600` | `#2E3B4D` | badan dinding, plinth | garis tepi kaca/partisi |
| `concrete700` | `#24303F` | isian hollow, border plate | |
| `concrete800` | `#1A2330` | badan plate, background panel | |
| `concrete900` | `#121924` | permukaan terdalam, plate offline | `muted`/`inkDim` tetap terbaca |
| `glass300` | `#7FA3C0` | kilau pane/mullion | highlight kaca |
| `glass500` | `#456E8F` | pane kaca itu sendiri | partisi, top meja meeting |
| `glass700` | `#2C4A66` | tone bayangan pane | |
| `steel300` | `#7E8B99` | tepi highlight baja | |
| `steel500` | `#525F6D` | badan baja: lift, kaki, frame, tray | |
| `steel700` | `#39434F` | bayangan baja, kursi graphite | kursi offline digambar hollow-frame |
| `lamp` | `#F2E7C4` | strip & pool lampu plafon warm-white | satu-satunya catatan terang |
| `amber` | `#E8A33D` | state aktif: lift call, aksen plakat | teks di atasnya pakai `inkOnAmber` |
| `amberDeep` | `#9A6A1E` | border/bayangan aksen | |
| `ink` / `inkDim` / `muted` | `#EDF1F6` / `#C3CDD9` / `#8A97A9` | teks di atas permukaan gelap | hierarki 3 tingkat |
| `line` | `#2E3B4D` | garis struktural | = `concrete600` |

### 2.2 Status (STATUS — identik di kanvas & panel)

| Status | Hex |
|---|---|
| working | `#F2B434` |
| reviewing | `#A98CE0` |
| idle | `#6FB1E8` |
| blocked | `#FFC93B` (chip + teks `butuh izin`, bukan alasan mentah) |
| offline | `#8B93A5` |
| ok / danger | `#7FC08C` / `#E2705F` |

### 2.3 Layar & detail (SCREEN)

`bg #14201A` (monitor), `green #9CE8A8`, `blue #8FB8E8`, `paper #EFE4CC`,
`bubbleInk #1A2027` (teks di atas `concrete100`).

### 2.4 Motif lantai (FLOOR_MOTIF)

| Lantai | Slab | Motif |
|---|---|---|
| L1 Lobby | `#39434F` polished concrete + terrazzo fleck deterministik (hash integer per tile) | keset gelap di pintu MASUK, pool lampu `#414C59` |
| L2 Tim Edu | `#C7D2DE` light concrete + seam `#B4C0CD` | rug lembut `#8E99AC` di bawah blok edu 2×2, band kaca `#456E8F` di dinding utara |
| L3 Tim Dev | `#232C38` dark polished + seam `#1B222D` | cable tray baja `#39434F`, strip lampu `#F2E7C4`, pool `#2B3542` |

### 2.5 Aksen tim (TEAM — identitas, bukan warna lantai)

| Tim | Hex | Keterangan |
|---|---|---|
| dev | `#82AAC8` | biru dingin |
| edu | `#DEB860` | amber-kuning hangat |
| lobby | `#D4805C` | netral hangat — satu-satunya catatan warm selain aksen amber |

### 2.6 Chrome panel (CSS `global.css`)

`--concrete-100..900`, `--amber/-light/-deep`, `--steel-500` menggantikan
nama lama `--navy-*`/`--terra-*`/`--sand-*` (nol sisa pemakaian). Status
CSS (`--working` dst.) = STATUS di atas. Bevel & offset block shadow tetap
(solid, tanpa blur).

## 3. Lift

Satu aturan di tiap lantai: shaft baja 2.6×3.2 unit di timur, pintu
menghadap barat (`LIFT[f].doorX`), node jalan 1.0 unit di barat pintu.
Digambar: shaft `steel500/700` + trim `steel300`, dua panel pintu yang
**terbuka saat dwell** (perjalanan lift), indikator lantai di atas pintu
(angka lantai tujuan, tone amber saat panggilan aktif). Seluruh denah &
obstacle tidak berubah — hanya tampilan.

## 4. Roster per lantai

`Roster.tsx` mengelompokkan baris per lantai (urutan naik): header
**L1 LOBBY / L2 TIM EDU / L3 TIM DEV** dengan jumlah agen dan ringkasan
status kompak (`4 aktif · 1 idle`), accordion fold tetap aktif, keyboard
access via `<button>` utuh, 13 baris tidak berubah. Klik baris → `onPick`
→ App pindah lantai agen dan fokus ke mejanya.

## 5. State & privasi

| State | Tampilan |
|---|---|
| online (working/reviewing/idle) | chibi + dot status + chip status |
| blocked | chip `butuh izin` (canvas & panel), **alasan mentah tidak pernah dirender** — ProximityCard/TaskBoard menampilkan `butuh izin · N alat` |
| offline | kursi hollow-frame + tile `Z Z Z` + plate redup + overlay dim; feed tidak menampilkan konten pesan — hanya kind, alat, dan nama |
| stale | banner `data lama — mencoba ulang…` di HUD (`.stale`) |
| seed offline | `/api/config` gagal → 13 meja seed tetap tampil di ketiga lantai, semua OFFLINE + banner stale |

Privasi: konten pesan dan judul tugas tidak dirender di mana pun; chip tugas
hanya menampilkan id tugas.

## 6. Gate yang menjaga spec ini

- `verify/anim_check.ts` §10: token palet (rampa concrete, kaca, baja,
  lampu, amber, aksen tim, blocked) — FAIL saat drift.
- `verify/visual_check.ts`: split meja 13 = 1/4/8, plate dalam kanvas &
  tanpa overlap di tiap lantai (desktop 1000×688 + mobile 390×692), zoom
  integer default per lantai, shaft lift + node nav per lantai, plakat zona
  `L1 LOBBY / L2 TIM EDU / L3 TIM DEV` per lantai, partisi kaca L1.
- `verify/office2d_probe.js` (browser): kanvas terpainting di ketiga lantai,
  3 tab lantai menulis `?floor=`, hook `__office2dFloors()` (split seed +
  koordinat lift), roster 13 baris, `.floor-tabs` dikecualikan dari aturan
  overlap; jalur offline di-assert saat roster terdeteksi all-offline (langkah
  manual: matikan API, muat ulang, cek screenshot).

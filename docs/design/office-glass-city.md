# Spec Visual — Kantor 2D Glass + Kota (arah _Sky Lobby_)

> Turunan dari `docs/rnd/office-glass-city.md` §6.1 dan §7. Dokumen ini adalah
> **spesifikasi yang bisa diimplementasikan**, bukan rencana kerja (lihat §8
> dokumen R&D untuk fase & gate).
>
> Menggantikan aturan "tanpa gradien, tanpa blur" di `docs/design/office-3-floors.md`
> **hanya untuk permukaan kaca dan band jendela**. Aturan lama tetap berlaku untuk
> furniture, plakat, dan lift: tidak ada bayangan blur di dalam kanvas.
>
> Avatar **bukan** pixel-art lagi. Lihat §6.

## 1. Prinsip

1. **Kaca itu peran, bukan dekorasi.** Hanya empat permukaan boleh memakai kaca:
   HUD, tab lantai, roster, dan band jendela. Sisanya solid.
2. **Teks tidak pernah bergantung pada kaca.** Semua label (nameplate, chip
   status, nama di roster) duduk di atas permukaan alpha ≥ 0,90.
3. **Kota memberi kedalaman, bukan perhatian.** Jendela kota alpha ≤ 0,65 dan
   selalu di bawah veil 20–22 %.
4. **Satu aksen.** Amber `#F0B45A`. Status tetap memakai `STATUS` yang sudah ada.
5. **Tidak ada blur di dalam loop render.** Blur = sekali per (lantai, ukuran,
   waktu-hari) ke offscreen; per frame hanya `drawImage`.

## 2. Token

### 2.1 CSS (`frontend/src/styles/global.css`)

```css
:root {
  /* permukaan */
  --surface-glass: rgba(20, 27, 46, 0.62);
  --surface-solid: #141b2e;      /* fallback reduced-transparency */
  --surface-raised: #1b2334;
  --page: #080c16;
  --floor: #1a2230;
  --wall: #121a29;

  /* kaca */
  --glass-border: rgba(255, 255, 255, 0.16);
  --glass-highlight: rgba(255, 255, 255, 0.30);
  --glass-noise: 0.04;            /* alpha tile noise 64×64 */
  --glass-radius-sm: 12px;
  --glass-radius-md: 14px;
  --glass-radius-lg: 18px;
  --glass-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);

  /* teks */
  --ink: #f2f5fa;
  --ink-dim: #c6d0e0;
  --muted: #93a0b6;

  /* aksen */
  --accent: #f0b45a;
  --accent-deep: #a9741f;
  --accent-ink: #1a1206;

  /* tipografi */
  --font-ui: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --label-size: 11px; --label-weight: 600; --label-track: 0.08em;
  --meta-size: 9.5px; --body-size: 12.5px; --title-size: 15px; --display-size: 22px;
}
```

`--working/--reviewing/--idle/--blocked/--offline/--ok/--danger` **tidak berubah**
(nilai identik dengan `STATUS` di `scene2d/palette.ts`).

### 2.2 Kanvas (`scene2d/palette.ts`)

Tambah tanpa mengubah yang lama:

```ts
export const GLASS = {
  surface: '#141B2E', surfaceAlpha: 0.62,
  border: '#FFFFFF', borderAlpha: 0.16,
  highlight: '#FFFFFF', highlightAlpha: 0.30,
} as const

export const CITY = {
  skyTop: '#0C1222', skyMid: '#2B3350', skyLow: '#8A5560', horizon: '#E0A06A',
  layers: ['#0E1626', '#16203A', '#1D2A47', '#26344F'],  // jauh → dekat
  windowWarm: '#F3C57B', windowCool: '#9FD8E8',
} as const
```

## 3. Geometri

| Elemen | Ukuran | Catatan |
|---|---|---|
| HUD | tinggi 56 px | tab lantai pindah ke sini (lihat §4.1) |
| Canvas | sisa lebar/tinggi | sidebar 280 px di desktop |
| Band jendela | tinggi **96 px** di atas garis dinding utara | visual-only, bukan koordinat |
| Plinth | 10 px di luar denah | tetap |
| Roster | 280×668 px, radius 14 | satu-satunya panel besar ber-kaca |
| Tab lantai | 118×32 px, radius 8, gap 6 | 3 tab, satu aktif |
| Zoom control | 100×36 px, radius 9 | kaca kecil (boleh blur, luas < 120×120) |
| Nameplate | tinggi 19 px, radius 9, padding 9 | lihat §6.4 |

**Grid 8 pt**: padding panel 16/24, gap 8, tinggi baris 34 (desktop) / 38 (mobile).
Radius tidak ikut grid (12/14/18) — radius adalah bahasa bentuk, bukan spasi.

## 4. Perlakuan kaca

### 4.1 Resep per permukaan

| Permukaan | Isian | Blur | Border | Highlight | Noise | Catatan |
|---|---|---|---|---|---|---|
| HUD | `--surface-solid` | — | 1 px 0,10 | — | — | solid: selalu ada, tidak boleh "berenang" |
| Tab lantai | `--surface-glass` | 12 px (aktif: tanpa blur) | 1 px 0,16 | atas 1 px 0,30 | 4 % | tab aktif memakai `--accent` solid |
| Roster | `--surface-glass` @ 0,78 | 18 px | 1 px 0,16 | atas 1 px 0,30 | 4 % | satu-satunya blur besar; di atas latar halaman, bukan di atas kanvas |
| Zoom control | `--surface-glass` @ 0,80 | 12 px | 1 px 0,16 | atas 1 px 0,30 | 4 % | luas < 120×120 → aman untuk `backdrop-filter` |
| Band jendela (kanvas) | alpha bertingkat | **pre-render** | mullion 3 px | sheen 5 diagonal | 3 % | tidak ada konvolusi per frame |

### 4.2 Tab lantai pindah ke HUD

Alasan: band jendela menempati 96 px teratas kanvas, dan tab yang mengambang di
kiri-atas akan menutupinya. Tab tetap `<button>` yang sama, tetap menulis
`?floor=`, tetap punya `aria-pressed`; hanya kontainernya pindah dari
`.floor-tabs` (overlay kanvas) ke `.hud-tabs`.

### 4.3 Larangan

- Maksimum **2 permukaan ber-blur terlihat sekaligus**.
- Tidak ada kaca di atas kaca (Acrylic: "hindari melapisi beberapa permukaan
  acrylic").
- Tidak ada kaca untuk kartu konten (KPI, taskboard) — kartu tetap solid.
- Tidak ada `backdrop-filter` pada elemen yang menutupi kanvas beranimasi bila
  luasnya > 120×120 px.

## 5. Band jendela kota

```
┌──────────────────────────────────────────────┐  ← 96 px
│ langit (gradien 4 stop)                      │
│  ▁▂▃ bangunan jauh   (layer 0, alpha 0.55)   │
│  ▂▄▆ bangunan tengah (layer 1, alpha 0.75)   │
│  ▃▅▇ bangunan dekat  (layer 2, alpha 1.00)   │
│ veil 22 % + jendela menyala alpha 80–165     │
└──────────────────────────────────────────────┘
   mullion 3 px tiap 3 unit · transom di 42 %
```

- **3 lapisan** di produksi (mockup memakai 4 untuk melihat batas).
- Tile 256×96 px, diulang horizontal, seed per lantai agar tidak identik.
- **Tidak ikut zoom/pan.** Parallax maksimum 6 px per 100 px pan, hanya layer 1–2.
- Pre-render: `OffscreenCanvas(768 × 96 × dpr)` per (lantai × waktu-hari) →
  9 kanvas, ≈0,6 MB. Invalidasi saat resize / ganti lantai / ganti tema.
- Di atas band: garis slab 4 px `--desk-top`, supaya band "duduk" di dinding.

## 6. Avatar clean vector

### 6.1 Proporsi (satuan unit, 1 unit = 1/44 tinggi avatar)

| Bagian | Rentang Y | Lebar | Catatan |
|---|---|---|---|
| Kepala | 2,1 – 16,6 | 13,8 (elips) | rasio kepala:torso ≈ 1:1,6 (chibi ringan, bukan realistis) |
| Leher | 13,6 – 19,6 | 5,0 | harus terlihat ≥ 2 px di zoom 2 |
| Torso | 18,4 – 31,8 | 16 × `build` | poligon tapered, bahu elips |
| Lengan | 19,8 – 31,0 | 4,4 | rounded-rect + cuff + tangan mitten |
| Kaki | 29,4 – 40,8 | 5,4 | dua rounded-rect |
| Sepatu | 39,8 – 43,2 | 6,6 | blok + sol terang, **tidak menyatu** |
| Tinggi total | 44 | | × `tall` (0,94–1,06) |

Di layar: tinggi **50 px @ zoom 2** (naik dari 32 px chibi). Alasan: pada 32 px
mata dan aksesori tidak terbaca; 50 px masih di bawah lebar meja (48 px) sehingga
tidak menutupi tetangga.

### 6.2 Gradien

Dua stop per bagian, diturunkan dari warna `Look`:

```ts
const shade = (hex: string, k: number) => /* k<1 gelap, k>1 terang */
// kulit:   shade(skin, 1.06) → shade(skin, 0.88)
// rambut:  shade(hair, 1.15) → shade(hair, 0.85)
// kemeja:  shade(shirt, 1.12) → shade(shirt, 0.82)
```

Tidak ada bayangan jatuh (drop shadow) di avatar; kedalaman hanya dari gradien +
satu outline tipis `shade(skin, 0.62)` pada kepala.

### 6.3 Pemetaan `Look` → gambar

| Field | Perlakuan |
|---|---|
| `skin` | gradien kepala/leher/tangan |
| `hair` + `style` | cap elips + massa per gaya: `crop` (cap saja), `short` (+ sideburn), `side` (sweep asimetris), `long` (dua panel sampai bahu), `bun` (cincin di atas), `curly` (4 bulge), `messy` (3 spike) |
| `shirt` | torso + lengan; kerah V `shade(shirt, 0.66)` |
| `pants` | kaki + sepatu `shade(pants, 0.38)` + sol `#E8E9EC` |
| `accent` | strip dada 1 path (identitas tim) |
| `glasses` | 2 rounded-rect + bridge + lensa `rgba(210,232,245,0.24)` |
| `headphones` | arc + 2 ear cup |
| `peci` | rounded-rect `#1B1B22` di atas kepala |
| `mustache` | rounded-rect tipis di bawah hidung |
| `stubble` | **arc rahang** alpha 105 — bukan oval penuh (terbaca seperti masker) |
| `build` / `tall` | lebar torso / skala tinggi |
| `female` | mematikan stubble & mustache |
| `sculptedHead` | diabaikan pada iterasi ini |

### 6.4 Nameplate

- Tinggi 19 px, radius 9, isian `rgba(20,27,46,0.92)`, border 1 px alpha 0,33.
- Isi: dot status 6 px + nama depan (kapital, maks 6 huruf) + (zoom ≥ 3) chip status.
- Lebar = `ctx.measureText(nama).width + 18`; **tidak boleh** melebihi pitch meja
  (48 px @ zoom 2) — kalau lebih, pakai mode `compact` (nama saja, 9 px).
- Penempatan: `y1 = kaki − 62`; tabrakan diselesaikan dengan menggeser ke atas
  19+2 px sampai tidak ada irisan (fungsi `placeStacks` yang sudah ada).
- Dot `idle` = cincin (bukan cakram), `offline` = plate hollow — pembeda bentuk,
  bukan hanya warna (WCAG 1.4.1).

### 6.5 Cache & ancor

```ts
// key stabil, bukan per frame
const key = `avatar:${hashLook(look)}:${pose}:${frame}:${dprBucket}`
// gambar sekali ke canvas offscreen ukuran 30×50 × dprBucket, lalu drawImage
```

- Ancor kaki: `(cx, feetY)` dihitung dari meja; `pickTargets` tetap memakai
  koordinat dunia (`desk.x/desk.z`), radius 0,9 unit — **tidak berubah**.
- Cache maksimum: 13 look × 6 pose × 2 frame × 2 bucket = 312; LRU 64 entri.
- Membangun 8 avatar @50 px ≈ 18 ms di rasteriser CPU (sekali); blit 8 sprite
  ≈ 0,06 ms per frame.

## 7. Tipografi

| Peran | Ukuran | Bobot | Tracking | Warna |
|---|---|---|---|---|
| Nama agen (roster) | 11 px | 700 | 0 | `--ink` |
| Status (roster) | 9 px | 500 | 0 | warna status |
| Task id | 9 px mono | 500 | 0 | `--muted` |
| Label panel | 11 px | 600 | +0,08em, uppercase | `--ink` |
| Meta panel | 9,5 px | 500 | 0 | `--muted` |
| Angka KPI | 22 px | 700 | −0,01em | `--ink` |

Font label di kanvas: font UI yang sama (bukan 5×7). Font 5×7 hanya dipertahankan
untuk **plakat zona** dan **indikator lantai lift** sebagai jejak identitas.

## 8. Gerak

| Elemen | Durasi | Easing | Catatan |
|---|---|---|---|
| Ganti lantai (band + denah) | 180 ms | `cubic-bezier(.2,.7,.2,1)` | opacity + translateY 6 px |
| Tab aktif | 120 ms | ease-out | warna, tanpa blur |
| Parallax kota | kontinu, 0,02× pan | linear | dimatikan saat `prefers-reduced-motion` |
| Denyut dot `working` | 2,4 s | ease-in-out | hanya opacity 0,75–1 |

Tidak ada animasi pada blur, radius, atau warna kaca (memicu repaint mahal).

## 9. Fallback & aksesibilitas

| Kondisi | Perilaku |
|---|---|
| `prefers-reduced-transparency: reduce` | `--surface-glass` → `--surface-solid`; blur dimatikan; noise dimatikan |
| `prefers-reduced-motion: reduce` | parallax & denyut dimatikan (sudah ada) |
| `prefers-contrast: more` | border kaca 0,16 → 0,40; teks muted → ink-dim |
| `data-contrast="high"` (tombol toolbar) | sama seperti di atas, dipaksa |
| Browser tanpa `backdrop-filter` | latar `--surface-glass` @ 0,90 (hampir solid), tanpa blur |
| `document.hidden` | loop berhenti (sudah ada) |

Ambang yang harus lolos di gate: teks ≥ 4,5:1, dot/border ≥ 3:1, chip status ≥ 4,5:1.

## 10. Yang tidak berubah

- `frontend/src/lib/rooms.ts`: meja, `LIFT`, `POIS`, `NAV`, `SPOTS` — nol perubahan.
- `LIFT`: shaft 2,6×3,2, pintu barat, indikator `L1/L2/L3` di header.
- Tab lantai: 3 tab, `?floor=`, keyboard access, `aria-pressed`.
- Kontrak `/api/status` dan hook `__office2dFloors()`.
- Privasi: tidak ada isi pesan/judul tugas di kanvas maupun panel.
- `layout_check`: walkability, aisle, edge nav, kaki POI.

## 11. Gate yang harus diperbarui

| Gate | Perubahan |
|---|---|
| `verify/anim_check.ts` | token `GLASS`/`CITY` baru; `avatarKey` unik untuk 13 look; palet status tidak berubah |
| `verify/visual_check.ts` | `plateWidth` dari `measureText` (bukan `textWidth` pixel font); tinggi plate 19; cek "nama utuh" tetap; cek band jendela tidak menutupi meja |
| `verify/office2d_probe.js` | selektor tab pindah ke `.hud-tabs .floor-tab`; sisanya tetap |
| `verify/e2e_review.sh` | tambah langkah screenshot 3 lantai + mobile dengan `?skin=glass` |
| Audit kontras | skrip baru: baca `tokens.json`, gagal bila ada pasangan < ambang |

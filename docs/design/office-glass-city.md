# Spec Visual — Kantor 2D Glass + Kota (dua tema, view samping)

> Turunan dari `docs/rnd/office-glass-city.md` §6, §11, dan §12. Dokumen ini adalah
> **spesifikasi yang bisa diimplementasikan**, bukan rencana kerja (fase & gate ada
> di §8 dokumen R&D).
>
> Keputusan bos yang mengikat dokumen ini:
> 1. **Dua tema first-class** — *Terang* (Daylight Atrium) untuk siang, *Gelap*
>    (Sky Lobby) untuk malam — berganti **otomatis mengikuti waktu lokal** dari
>    `tz` di `/api/config` (sekarang `Asia/Jakarta`, WIB). Neon Metro = alternatif.
> 2. **Scene = view samping** (elevasi/potongan gedung), bukan denah top-down.
> 3. Avatar **bukan** pixel-art lagi (clean vector), dan **status = warna + bentuk + teks**.
>
> Menggantikan aturan "tanpa gradien, tanpa blur" di `docs/design/office-3-floors.md`
> hanya untuk permukaan kaca, band kota, dan furnitur yang sekarang digambar dalam
> profil. Aturan lama tetap berlaku untuk plakat zona dan indikator lift.

## 1. Prinsip

1. **Kaca itu peran, bukan dekorasi.** Empat permukaan kaca di chrome (HUD, tab
   lantai, roster, kontrol zoom) + **satu** partisi kaca di dalam scene. Sisanya solid.
2. **Teks tidak pernah bergantung pada kaca.** Semua label (nameplate, chip status,
   nama di roster) duduk di atas permukaan alpha ≥ 0,90.
3. **Kota memberi kedalaman, bukan perhatian.** Jendela kota alpha ≤ 0,65 dan selalu
   di bawah veil (22 % malam, 8 % siang).
4. **Satu aksen per tema.** Terang: biru `#1D4ED8`. Gelap: amber `#F0B45A`.
5. **Tidak ada blur di dalam loop render.** Blur = sekali per (lantai × tema ×
   ukuran) ke offscreen; per frame hanya `drawImage`.
6. **Tema ditentukan data, bukan jam perangkat.** `tz` dari API + `now` dari
   `/api/status`; override manual dan `?theme=` selalu menang.

## 2. Tema & token

### 2.1 Aturan penentu tema (mengikat)

| Hal | Nilai |
|---|---|
| Sumber zona waktu | `/api/config` → `tz` (fallback `Asia/Jakarta`) |
| Sumber waktu | `now` dari `/api/status` (bukan jam perangkat) |
| Jendela siang | `DAY_START_HOUR = 6` ≤ jam lokal < `DAY_END_HOUR = 18` |
| Hasil | di dalam jendela → `day` (Terang); di luar → `night` (Gelap) |
| Urutan keputusan | override HUD (`localStorage`) → `?theme=day\|night\|auto` → otomatis dari `tz` → `prefers-color-scheme` (hanya bila `tz` tidak ada & tanpa override) |
| Modul | `frontend/src/lib/theme.ts` (murni) · uji: `verify/theme_check.ts` |
| Tidak boleh berkedip | tema diterapkan saat static layer berikutnya di-render, bukan di tengah frame |
| Deep link | `?theme=day`, `?theme=night`, `?theme=auto` — dipakai gate visual agar screenshot deterministik |

### 2.2 CSS — dua mode (`frontend/src/styles/global.css`)

```css
:root {                          /* mode GELAP (default bila tanpa tz) */
  --surface-glass: rgba(20, 27, 46, 0.62);
  --surface-solid: #141b2e;
  --surface-raised: #1b2334;
  --page: #080c16;  --floor: #1a2230;  --wall: #121a29;
  --glass-border: rgba(255, 255, 255, 0.16);
  --glass-highlight: rgba(255, 255, 255, 0.30);
  --glass-noise: 0.04;
  --glass-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
  --ink: #f2f5fa;  --ink-dim: #c6d0e0;  --muted: #93a0b6;
  --accent: #f0b45a;  --accent-deep: #a9741f;  --accent-ink: #1a1206;
  --working: #f2b434; --reviewing: #a98ce0; --idle: #6fb1e8;
  --blocked: #ffc93b; --offline: #8b93a5; --ok: #7fc08c; --danger: #e2705f;
  --glass-radius-sm: 12px; --glass-radius-md: 14px; --glass-radius-lg: 18px;
  --font-ui: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --label-size: 11px; --label-weight: 600; --label-track: 0.08em;
  --meta-size: 9.5px; --body-size: 12.5px; --title-size: 15px; --display-size: 22px;
}

:root[data-theme="day"] {        /* mode TERANG */
  --surface-glass: rgba(255, 255, 255, 0.66);
  --surface-solid: #f7fafd;
  --surface-raised: #ffffff;
  --page: #eef3f8;  --floor: #e3eaf2;  --wall: #dde6f0;
  --glass-border: rgba(15, 36, 64, 0.20);
  --glass-highlight: rgba(255, 255, 255, 0.85);
  --glass-noise: 0.04;
  --glass-shadow: 0 18px 40px rgba(15, 36, 64, 0.10);
  --ink: #16202e;  --ink-dim: #41506a;  --muted: #556377;
  --accent: #1d4ed8;  --accent-deep: #1d4ed8;  --accent-ink: #ffffff;
  --working: #8a5406; --reviewing: #6d28d9; --idle: #1d4ed8;
  --blocked: #b33a12; --offline: #556073; --ok: #116b33; --danger: #b91c1c;
  --body-size: 13px; --label-weight: 500;
}
```

Nilai status tema Terang **bukan** tebakan: `working`, `blocked`, `ok`, dan
`offline` digelapkan dari versi tailwind-700 karena gagal ambang 4,5:1 saat
dipakai sebagai *teks* (lihat §3.3). Jangan mengembalikannya tanpa menghitung ulang.

### 2.3 Kanvas (`scene2d/palette.ts`)

```ts
export const THEME_TOKENS = {
  day:   { glass: { surface: '#FFFFFF', alpha: 0.66, border: '#0F2440', borderAlpha: 0.20,
                    highlight: '#FFFFFF', highlightAlpha: 0.85 },
           city:  { skyTop: '#3E8FD6', skyMid: '#7CBCEC', skyLow: '#C4E1F6', horizon: '#F0F9FF',
                    layers: ['#A9C6DD', '#8FB0CC', '#7699B8', '#5E82A3'],
                    windowWarm: '#EAF7FF', windowCool: '#BFE2F7' } },
  night: { glass: { surface: '#141B2E', alpha: 0.62, border: '#FFFFFF', borderAlpha: 0.16,
                    highlight: '#FFFFFF', highlightAlpha: 0.30 },
           city:  { skyTop: '#0C1222', skyMid: '#2B3350', skyLow: '#8A5560', horizon: '#E0A06A',
                    layers: ['#0E1626', '#16203A', '#1D2A47', '#26344F'],
                    windowWarm: '#F3C57B', windowCool: '#9FD8E8' } },
} as const
```

## 3. Status: warna + bentuk + teks

### 3.1 Bentuk penanda (wajib, WCAG 1.4.1)

| Status | Bentuk | Ukuran |
|---|---|---|
| `working` | bulatan penuh | 6 px |
| `reviewing` | bulatan + cincin dalam lebih terang | 6 px |
| `idle` | cincin kosong | 6 px |
| `blocked` | belah ketupat (kotak diputar 45°) | 6 px |
| `offline` | kotak kosong | 6 px |
| `ok` | bulatan + centang | 6 px |
| `danger` | segitiga penuh | 7 px |

Bentuk dipakai di roster, nameplate, sheet mobile, dan chip HUD. Warna saja tidak
pernah menjadi satu-satunya pembeda.

### 3.2 Kontras — hasil ukur, bukan perkiraan

Sumber: `docs/design/mockups/tokens.py` → `tokens.json` (78 pasangan, 0 gagal).
Ambang: **teks 4,5:1** (karena kata status dicetak di roster), **dot/garis 3:1**,
**chip 4,5:1**.

| Status | Terang: teks / chip | Gelap: teks / chip |
|---|---|---|
| `working` | 5,31 / 6,27 | 8,55 / 10,02 |
| `reviewing` | 6,02 / 7,10 | 5,66 / 6,88 |
| `idle` | 5,68 / 6,70 | 6,87 / 8,08 |
| `blocked` | 5,04 / 5,95 | 10,29 / 12,06 |
| `offline` | 5,38 / 6,35 | 5,13 / 6,13 |
| `ok` | 5,60 / 6,61 | 7,39 / 8,76 |
| `danger` | 5,48 / 6,47 | 5,06 / 6,22 |

### 3.3 Riwayat perbaikan (jangan diulang)

| Warna | Nilai lama | Gagal di | Diganti |
|---|---|---|---|
| `working` | `#A16207` | teks 4,17:1 | `#8A5406` (5,31) |
| `blocked` | `#B45309` | teks 4,25:1, hue terlalu dekat `working` | `#B33A12` (5,04, hue 15° vs 35°) |
| `ok` | `#15803D` | teks 4,25:1 | `#116B33` (5,60) |
| `offline` | `#5F6A7D` | margin tipis 4,63:1 | `#556073` (5,38) |

## 4. Geometri view samping

Kanvas 1000×688 (HUD 56 px di atas, toolbar 56 px di bawah, sidebar 280 px).

**Skala kamera adalah angka desain, bukan hasil bagi lebar.** Versi pertama
memetakan span meja ke 960 px, dan itu persis bagaimana avatar 54 px berakhir di
ruangan 286 px (1:5,3) — verdict bos: *"avatar terlihat kecil, sedangkan ruangnya
tampak tinggi"*. Sekarang `SIDE_PPU = 140 px/unit` dipakai untuk **kedua sumbu**
(tidak ada pemampatan anisotropik), dan seluruh angka di bawah turun dari situ:

| Target | Angka | Terukur |
|---|---|---|
| Skala kamera | 140–160 px/unit | **140 px/unit** |
| Tinggi avatar @ zoom 2 | 75–90 px | **88 px** (lane 2), 84 / 81 px (lane 1 / 0) |
| Tinggi plafon | 2,2–2,5 unit | **2,2 unit = 308 px** lantai→soffit |
| Rasio avatar:ruangan | 1:3–1:4 | **1:3,50** |

| Band | Tinggi | Isi |
|---|---|---|
| Kota | **252 px** (dulu 310) | skyline + langit (lihat §6) |
| Soffit | 26 px | **satu** cove cahaya menerus + **7 downlight** recessed (bukan 3 strip) |
| Ruangan | **308 px** | lantai→soffit: dinding, papan, rak, partisi, meja, agen |
| Floor finish | 80 px | garis lane, bayangan, meja |
| Slab | 22 px | garis atas 1 px highlight |

252 + 26 + 308 + 80 + 22 = **688 px** (pas kanvas). Garis lantai per lane:
**606 / 630 / 654 px** (lane belakang → depan).

| Elemen | Ukuran | Catatan |
|---|---|---|
| Avatar | **88 px** tinggi (× skala lane: 81 / 84,5 / 88) | lihat §7 |
| Meja (profil) | top **55 px** di atas garis lantai, tebal 10 px, 2 kaki 5 px | lebar 75 px; monitor **21×17 px** di cx+17 (bukan di depan wajah) |
| Kursi | sandaran 39×49 px | di belakang agen |
| Curtain wall | 1 lembar kaca menerus + **3 mullion** 3 px (4 teluk × 242 px) + 1 transom | jangan digambar per-pane: 10 pane ber-shadow = gambar ter-tile |
| Partisi kaca | soffit → lantai (penuh) | resep §5.2 |
| Nameplate | tinggi **21 px**, radius 10, font 10,5 | lihat §7.4 |
| Slot agen | **≥ 86 px** antar pusat agen | §4.2 |
| Kamera | **140 px/unit tetap**, koridor 1,95–4,30 unit dipotong jadi 0,35 unit | span elevasi 815 px; bukan fit-to-width |


**Kamera adalah potongan, bukan seluruh lantai.** L3 selebar 24 unit; kalau dipaksa
masuk, hasilnya 41 px/unit dan agen bertabrakan. UI harus menyebut "potongan L3".

### 4.1 Lane 2.5D (pemetaan `z` → kedalaman)

| Lane | Skala | Offset y | Tinggi avatar | Arti |
|---|---|---|---|---|
| 0 | 0,92 | 0 px | 81 px | paling belakang (dekat jendela) |
| 1 | 0,96 | +24 px | 84,5 px | tengah |
| 2 | 1,00 | +48 px | 88 px | paling depan (dekat penonton) |

Aturan:
1. lane awal dari ambang `z` per lantai;
2. **resolver tabrakan**: dua agen dengan `x` sama (selisih < 0,25 unit) tidak boleh
   satu lane — yang `z`-nya lebih jauh digeser satu lane ke belakang;
3. urutan gambar: lane 0 → 2, lalu `x` naik; partisi kaca digambar sebelum furnitur
   (ia duduk di belakang meja, jadi meja dan agen selalu menutupinya);
4. `z` **tidak** lagi menjadi koordinat layar; ia hanya memilih lane + urutan.

Bukti kenapa ini wajib: L3 punya tiga pasangan `x` identik (`coder`/`coder2` di
−1,62; `planner`/`reviewer` di 0; `uiux`/`tester` di 1,62). Dengan elevasi murni
satu agen dari tiap pasangan hilang.

### 4.2 Slot horizontal wajib (bukan hanya offset vertikal)

Lane saja **tidak cukup**: offset vertikal 24 px tidak memisahkan dua label selebar
62 px yang pusatnya sama. Aturan tambahan, dijalankan `side_slots()`:

1. urutkan agen menurut `cx` dunia (lalu `lane`) — urutan kiri→kanan tetap urutan
   `rooms.ts`;
2. tiap agen mendapat satu slot: pusat berikutnya minimal **86 px** (= label
   terlebar 62 px + napas + lebar badan 53 px) dari pusat sebelumnya; pasangan yang
   bertabrakan digeser ke kiri/kanan, bukan ditumpuk;
3. bila pita melewati kanvas, seluruh pita digeser masuk lalu dinaikkan lagi bila
   mentok — tidak ada agen yang boleh keluar dari margin 20 px.

Hasil terukur di L3 (8 agen): `BIMA 93 · DIMAS 261 · BAGAS 347 · YOGA 487 ·
RAKA 573 · SARI 714 · LARAS 800 · WAHYU 907`, jarak pusat minimum **86,0 px**.
Pola yang terbaca: baris belakang (DIMAS/YOGA/SARI, +24 px) menyela di antara
baris depan (BIMA/BAGAS/RAKA/LARAS) — dua baris meja yang jelas, bukan satu baris
datar.

### 4.3 Dinding diisi informasi (bukan dibiarkan kosong)

Separuh lain dari verdict bos: dinding di atas kepala hanya bidang kosong. Dinding
sekarang punya program yang diukur, bukan dirasa — setiap band di bawah adalah rect
yang dihitung `side_wall_gate()`:

| Band (y) | Isi | Tinggi |
|---|---|---|
| 252–278 | soffit: satu cove cahaya + **7 downlight** recessed | 26 px |
| 300–314 | trunking kabel menerus + 7 junction box | 14 px |
| 314–430 | **enam papan** yang saling menempel: plakat zona (L3 · TIM DEV), papan status (6/8 + 8 titik + 4 chip), pinboard + burndown A4, whiteboard arsitektur (L1/L2/L3/API, WIP 3), jam dinding (jarum ikut WIB tema), rak buku berangka | 116 px = 1,3 × avatar |
| 430–490 | **rak panjang** menerus: buku, binder, kotak, tanaman, tumpukan kertas, foto berbingkai | 60 px |
| 566–586 | plinth / shadow gap di kaki dinding | 20 px |

**Gate `side_wall_gate()`** (keras, dijalankan untuk L1/L2/L3):

| Aturan | Hasil terukur L3 |
|---|---|
| area dinding+plafon kosong | **24,2 %** (batas 30 %) |
| run kosong vertikal tertinggi (kolom 20 px) | **76 px = 24,7 %** tinggi ruangan (batas 30 %) |
| kolom yang melewati batas | **0** |

Kenapa dua baris (papan 116 px + rak 60 px), bukan satu papan 176 px: papan setinggi
176 px terbaca sebagai kartu UI raksasa. Papan 116 px = **1,3 × avatar = 0,38 ×
tinggi ruangan**, dan sisa 60 px diisi rak berisi objek — dinding terisi 236 dari
308 px (76,6 %) tanpa ada satu pun elemen yang kelewat besar.


## 5. Perlakuan kaca

### 5.1 Resep per permukaan

| Permukaan | Isian | Blur | Border | Highlight | Noise |
|---|---|---|---|---|---|
| HUD | `--surface-solid` | — | 1 px 0,10 | — | — |
| Tab lantai | `--surface-glass` | 12 px (aktif: tanpa blur) | 1 px (0,16 / 0,20) | atas 1 px (0,30 / 0,85) | 4 % |
| Roster | `--surface-glass` @ 0,78 | 18 px | 1 px | atas 1 px | 4 % |
| Zoom control | `--surface-glass` @ 0,80 | 12 px | 1 px | atas 1 px | 4 % |
| Curtain wall (kanvas) | **satu** lembar alpha 0,20 | pre-render | mullion 3 px (×3) + 1 transom | 1 px atas | 3 % |
| Partisi kaca (kanvas) | alpha **0,42** | — (alpha bertingkat) | lihat §5.2 | sheen | 3 % |

### 5.2 Resep kaca di kanvas — parameter pasti

Partisi kaca dan pintu lift **wajib** memakai urutan ini (kalau tidak, ia terbaca
sebagai pintu/whiteboard, bukan kaca):

| Langkah | Parameter |
|---|---|
| 1. Bayangan di bawah | Gaussian **blur 8 px**, hitam **alpha 15 %**, offset **+6 px** di y |
| 2. Isian | warna `surface` tema pada **alpha 0,42** di atas lantai |
| 3. Tepi dalam | **1 px** putih pada **alpha 0,55**, inset 1 px |
| 4. Tepi luar (mode Terang saja) | **1 px** `--glass-border` pada **alpha 0,18** — memisahkan kaca putih dari lantai putih |
| 5. Sheen diagonal | **2 px** putih pada **alpha 0,18**, dari **18 %** ke **62 %** lebar panel, kemiringan **~35°** (`dy = 0,70·dx`), di-clip ke panel |
| 6. Refleksi lantai | strip **6 px** putih **alpha 0,30** yang memudar ke 0 |

Pane curtain wall memakai isian **0,20** (bukan 0,42): pada 0,42 skyline malam
padam dan jendela yang menyala hilang.

### 5.3 Larangan

- Maksimum **2 permukaan ber-blur terlihat sekaligus**.
- Tidak ada kaca di atas kaca (Acrylic: "hindari melapisi beberapa permukaan acrylic").
- Tidak ada kaca untuk kartu konten (KPI, taskboard) — kartu tetap solid.
- Tidak ada `backdrop-filter` pada elemen yang menutupi kanvas beranimasi bila
  luasnya > 120×120 px.
- Tidak ada sheen lebih dari satu per panel (dua sheen = plastik, bukan kaca).

## 6. Band jendela kota (ikut tema)

```
┌──────────────────────────────────────────────┐  ← 252 px (dulu 310)
│ langit (gradien 4 stop, palet tema)          │
│  ▁▂▃ bangunan jauh   (layer 0)               │
│  ▂▄▆ bangunan tengah (layer 1)               │
│  ▃▅▇ bangunan dekat  (layer 2)               │
│ veil (22 % malam / 8 % siang) + jendela      │
└──────────────────────────────────────────────┘
   satu lembar kaca alpha 0,20 · mullion 3 px ×3 (4 teluk × 242 px) · 1 transom di 62 %
```

| Aspek | Siang (Terang) | Malam (Gelap) |
|---|---|---|
| Langit | `#3E8FD6 → #7CBCEC → #C4E1F6 → #F0F9FF` | `#0C1222 → #2B3350 → #8A5560 → #E0A06A` |
| Matahari | cakram putih tinggi + halo | — |
| Gedung | kaca memantul, muka terang di sisi matahari | siluet |
| Jendela | refleksi, alpha 40–95 | menyala, alpha 80–165 |
| Haze | 8 % | 22 % |
| Bayangan furnitur | tajam (blur 3 px, alpha 55/255) | lembut (blur 7 px, alpha 70/255) |

- **3 lapisan** di produksi (mockup memakai 4 untuk melihat batas).
- **Tidak ikut zoom/pan**; parallax maksimum 6 px per 100 px pan, hanya layer 1–2.
- **Cache per (lantai × tema)** — 3 × 2 = **6 cache** (Neon jadi 9). Satu layer
  768×576 @ DPR 2 ≈ 3,5 MB → total ≈ 21 MB; LRU 6, invalidasi saat tema berganti,
  resize/DPR berubah, atau bentuk roster berubah.
- Transisi 06:00 / 18:00: **crossfade 400 ms** antara dua cache; tidak ada state
  subuh/senja (lihat alasan di R&D §11).

## 7. Avatar clean vector

### 7.0 Resep raster (yang membuatnya benar-benar vector, bukan pixel)

Tiga aturan yang tidak boleh dilanggar, karena inilah yang dulu gagal:

1. **Digambar pada ukuran akhir, bukan di-upscale.** Sprite dilukis pada permukaan
   **4× tinggi tampil** (`AV_SUPER = 4`), lalu diperkecil **satu kali** dengan
   `LANCZOS`. Tidak pernah ada `resize(..., NEAREST)` dan tidak pernah ada
   pembesaran dari kanvas kecil. Di 88 px tampil, path dilukis di permukaan 352 px —
   jadi outline 1 unit benar-benar stroke ±1 px, bukan tangga.
2. **Satu satuan = 1/44 tinggi avatar**, jadi angka proporsi di §7.1 tidak
   bergantung pada ukuran tampil.
3. **Setiap material dua tone + outline**, dan tidak ada bagian yang hanya
   `fillRect`/blok. Kulit, rambut, kemeja, celana, sepatu semuanya gradien dua stop
   dengan stroke `shade(warna, 0,5)` selebar 1 unit.

### 7.1 Proporsi (1 unit = 1/44 tinggi avatar)

| Bagian | Rentang Y | Lebar | Catatan |
|---|---|---|---|
| Kepala | 1,6 – 18,4 | 15,6 (elips, rx 7,8 / ry 8,4) | chibi: kepala ≈ 38 % tinggi |
| Telinga | 10,2 – 13,4 | 2,4 | digambar **sebelum** kepala (di belakang) |
| Leher | 16,4 – 21,6 | 5,2 | tertutup dagu sebagian |
| Torso | 20,2 – 33,8 | 15,2 × `build` | poligon tapered + shoulder cap |
| Lengan | 21,8 – 29,8 | 4,6 | rounded-rect + tangan 3,6 |
| Kaki | ±32,4 – 41,4 | 5,4 | dua rounded-rect |
| Sepatu | 40,5 – 43,7 | 6,8 | blok + sol terang, tidak menyatu |
| Tinggi total | 44 | | kaki `tall` menggeser pinggul ±1 unit |

Wajah (semua relatif ke pusat kepala `hcy = 10`):

| Fitur | Posisi | Ukuran | Terbaca di 88 px |
|---|---|---|---|
| Alis | `hcy − 0,4` | 3,4 × 0,9 unit | ±1,8 px, **digambar di semua look** |
| Mata | `hcy + 1,9`, x ±2,9 | sclera 2,7 × 3,0 + iris 1,7 + glint | ±5,4 px, jelas |
| Hidung | `hcy + 2,9 … 4,6` | segitiga `shade(skin, 0,74)` | bayangan, bukan garis |
| Mulut | `hcy + 3,9 … 6,9` | arc 12°–168°, stroke 1,1 unit | ±8 px, jelas |

Di layar: **88 px @ zoom 2** (sprite digambar pada permukaan 4× = 352 px, lalu
diperkecil sekali dengan LANCZOS). Di view samping tinggi efektif = `88 px × skala
lane` = **81 / 84,5 / 88 px** (lane 0/1/2).

Kenapa 88 dan bukan 54: dengan kamera 140 px/unit, ruangan 2,2 unit = 308 px. Avatar
88 px membuat rasio **1:3,50** — di dalam target 1:3–1:4 dan jauh dari 1:5,3 yang
dibaca bos sebagai "avatar kecil, ruangan tinggi". Ukuran nameplate, meja, kursi dan
monitor ikut naik (`SIDE_K = 88/54 = 1,63`), jadi proporsinya antar-elemen tidak
berubah — yang berubah hanya skala relatif terhadap ruangan.

### 7.2 Dua tone + outline per material

```ts
const shade = (hex: string, k: number) => /* k<1 gelap, k>1 terang */
// kulit:  shade(skin, 1.10) → shade(skin, 0.84)   + outline shade(skin, 0.50)
// rambut: shade(hair, 1.95) → shade(hair, 0.95)   + outline shade(hair, 0.50)
// kemeja: shade(shirt, 1.14) → shade(shirt, 0.84) + outline shade(shirt, 0.56)
// celana: shade(pants, 1.10) → shade(pants, 0.84) + outline shade(pants, 0.46)
```

Selain gradien, tiap material punya **satu bidang tone kedua yang keras** supaya
beda tone terbaca di 88 px (gradien halus saja tidak cukup): panel samping kemeja
`shade(shirt, 0.78)` alpha 150, pipi `shade(skin, 0.80)` alpha 105 yang di-clip ke
mask kepala (tidak pernah meluber keluar siluet).

Tidak ada drop shadow di avatar. **Jumlah operasi terukur: 53–63 path/isi + 28–32
gradien per avatar** (WAHYU/RAKA/DIMAS paling banyak: kacamata + stubble +
headphone), dihitung saat render oleh `render_mockups.py`.

### 7.3 Pemetaan `Look` → gambar

| Field | Perlakuan |
|---|---|
| `skin` | gradien kepala/leher/tangan + pipi dua tone |
| `hair` + `style` | cap elips + **fringe yang berbeda per gaya**: `crop`/`short` (garis hampir lurus), `side` (sapuan ke kanan), `long` (dua panel sampai bahu), `bun` (sanggul bulat di atas-belakang), `curly` (4 bulge), `messy` (3 spike) |
| `shirt` | torso + lengan; kerah V `shade(shirt, 0.62)` |
| `pants` | kaki + sepatu `shade(pants, 0.55)` + sol `#E7EAEE` |
| `accent` | strip dada 1 path (identitas tim) |
| `glasses` | 2 rounded-rect + bridge + lensa `rgba(206,228,244,0.24)` |
| `headphones` | band + 2 ear cup |
| `peci` | rounded-rect `#20202A` di atas kepala |
| `mustache` | rounded-rect tipis di atas mulut |
| `stubble` | oval rahang alpha 68 — bukan oval penuh |
| `build` / `tall` | lebar torso / panjang kaki |
| `female` | mematikan stubble & mustache |

Catatan penting: **jangan** menambahkan pita highlight ellips di atas tengkorak —
di 88 px ia terbaca sebagai headband/helm, bukan rambut. Tone kedua rambut harus
dari gradien massa rambut itu sendiri.

### 7.4 Nameplate (aturan baru — selalu di atas kepala)

- Tinggi **21 px**, radius 10, font 10,5 bold, isian `rgba(surface,0.92)`, border
  1 px alpha 0,33.
- Isi: penanda status (bentuk + warna, §3.1) + nama depan kapital.
- **Selalu di atas kepala** dengan jarak tetap **7 px** dari atas kotak avatar
  (terukur 7,0 px minimum di mockup).
- Bila slot ideal sudah terpakai: naik **24 px** (tinggi + 3) per langkah, tetap di
  dalam bidang, dan **garis penghubung 1 px** digambar dari bawah plate ke kepala
  (border tema, alpha 55 %) supaya label tidak pernah terlihat "melayang".
- **Gate keras** (`side_gate()`, dijalankan untuk L1/L2/L3 sebelum render), tiga
  aturan, semuanya dicetak sebagai angka:
  1. **0** label yang menimpa label lain;
  2. **0** label yang menimpa kotak kepala agen **lain**;
  3. overlap bbox avatar vs avatar **≤ 20 %** dari yang lebih kecil (aturan yang
     menangkap dua agen di lane + `x` yang sama).
  Ditambah syarat jarak pusat agen **≥ 86 px**. Gate ini sudah berjalan di renderer
  mockup; implementasi harus memakai gate yang sama.
- Tinggi kepala di view samping: `floor_y − avatar_h × skala_lane`, bukan angka
  top-down.

### 7.5 Cache & ancor

```ts
const key = `avatar:${hashLook(look)}:${pose}:${frame}:${dprBucket}`
// gambar sekali ke offscreen 53×88 × dprBucket, lalu drawImage
```

- Ancor kaki: `(cx, floorY_lane)`; `pickTargets` tetap memakai koordinat dunia.
- Cache maksimum 312 entri; LRU 64.
- Bangun 8 avatar @88 px ≈ 40 ms sekali (skala kuadratik dari 54 px); blit 8
  sprite ≈ 0,06 ms/frame — biaya build tidak per frame.

### 7.6 Bukti terukur (dari `render_mockups.py`, bukan klaim)

`avatar_proof()` mencetak angka untuk satu agen di mockup yang benar-benar dirender,
dan menulis `docs/design/mockups/avatar-zoom-check.png` (crop 4×):

| Metrik | Nilai terukur | Ambang | Arti |
|---|---|---|---|
| Tinggi avatar di mockup | **88 px** (lane 2), 84 px (lane 1), 81 px (lane 0) | 75–90 px | ukuran tampil akhir |
| Rasio avatar:ruangan | **1:3,50** (88 : 308) | 1:3–1:4 | verdict bos, diukur |
| Warna unik dalam siluet (sprite) | **1077** | pixel-art ≤ 12, vector ≥ 40 | gradien + anti-aliasing |
| Warna unik di crop mockup | **1904** | — | termasuk latar (gradien ikut bergeser) |
| Piksel tepi siluet yang **blending** | **644 / 645 = 100 %** | pixel-art 0 % | tidak ada upscale nearest |
| Piksel alpha parsial | **2072** | > 0 | tepi sub-piksel nyata |
| Operasi gambar | **53–63 path/isi + 28–32 gradien** | — | dihitung saat render |

Cara memeriksa ulang: `python3 docs/design/mockups/render_mockups.py` — baris
`avatar proof BAGAS: ...` dan `side gate L3: ...` tercetak di stdout.

## 8. Tipografi

| Peran | Ukuran | Bobot | Tracking | Warna |
|---|---|---|---|---|
| Nama agen (roster) | 11 px | 700 | 0 | `--ink` |
| Status (roster) | 9 px | 500 | 0 | warna status |
| Task id | 9 px mono | 500 | 0 | `--muted` |
| Label panel | 11 px | 500 (Terang) / 600 (Gelap) | +0,08em, uppercase | `--ink` |
| Meta panel | 9,5 px | 500 | 0 | `--muted` |
| Angka KPI | 22 px | 700 | −0,01em | `--ink` |

Font label di kanvas: font UI (bukan 5×7). Font 5×7 hanya untuk plakat zona dan
indikator lantai lift.

## 9. Gerak

| Elemen | Durasi | Easing | Catatan |
|---|---|---|---|
| Ganti lantai (band + scene) | 180 ms | `cubic-bezier(.2,.7,.2,1)` | opacity + translateY 6 px |
| Ganti tema (crossfade cache) | 400 ms | linear | hanya tepat di 06:00 / 18:00 |
| Lift naik/turun | 400 ms | ease-in-out | pintu 160 ms; sekarang vertikal, jadi natural |
| Agen pindah lane | 120 ms | ease-out | interpolasi offset y |
| Tab aktif | 120 ms | ease-out | warna, tanpa blur |
| Parallax kota | kontinu 0,02× pan | linear | mati saat `prefers-reduced-motion` |
| Denyut dot `working` | 2,4 s | ease-in-out | opacity 0,75–1 |

## 10. Fallback & aksesibilitas

| Kondisi | Perilaku |
|---|---|
| `prefers-reduced-transparency: reduce` | `--surface-glass` → `--surface-solid`; blur & noise dimatikan |
| `prefers-reduced-motion: reduce` | parallax, crossfade tema, denyut dimatikan |
| `prefers-contrast: more` | border kaca 0,16/0,20 → 0,40; muted → ink-dim |
| `data-contrast="high"` (tombol toolbar) | sama seperti di atas, dipaksa |
| Browser tanpa `backdrop-filter` | `--surface-glass` @ 0,90 (hampir solid), tanpa blur |
| `tz` tidak ada / tidak valid | `Asia/Jakarta`, `source: 'fallback-tz'` |
| `prefers-color-scheme` | hanya dipakai bila `tz` tidak ada dan tanpa override |
| `document.hidden` | loop berhenti (sudah ada) |

Ambang gate: teks ≥ 4,5:1, dot/garis ≥ 3:1, chip status ≥ 4,5:1 — dihitung
terhadap komposit kaca, bukan terhadap putih/hitam.

## 11. Yang tidak berubah

- `frontend/src/lib/rooms.ts`: meja, `LIFT`, `POIS`, `NAV`, `SPOTS` — nol perubahan;
  lane dihitung di renderer dari `z`.
- `LIFT`: shaft 2,6×3,2, pintu barat, indikator `L1/L2/L3` di header (sekarang
  animasinya vertikal).
- Tab lantai: 3 tab, `?floor=`, keyboard access, `aria-pressed`.
- Kontrak `/api/status`, `/api/config` (termasuk `tz`), hook `__office2dFloors()`.
- Privasi: tidak ada isi pesan/judul tugas di kanvas maupun panel.
- `layout_check`: walkability, aisle, edge nav, kaki POI (tetap graf 2D).

## 12. Gate yang harus diperbarui

| Gate | Perubahan |
|---|---|
| `verify/theme_check.ts` (baru) | 23 pemeriksaan: 05:59/06:00/17:59/18:00, tengah malam, override menang, `?theme=`, fallback tz, DST Amsterdam |
| `verify/anim_check.ts` | `THEME_TOKENS` baru; `avatarKey` unik 13 look; lane resolver deterministik |
| `verify/visual_check.ts` | `plateWidth` dari `measureText`; plate 21 px; gate plate 0 overlap/0 kepala tertutup; band kota tidak menutupi meja |
| `verify/office2d_probe.js` | selektor tab di `.hud-tabs .floor-tab`; tambah `?theme=` pada screenshot |
| `verify/e2e_review.sh` | screenshot 3 lantai × 2 tema + mobile, semuanya dengan `?theme=` eksplisit |
| Audit kontras | skrip baru: baca `tokens.json`, gagal bila ada pasangan < ambang (78 pasangan) |

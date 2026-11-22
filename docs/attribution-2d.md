# Atribusi & lisensi — kantor 2D pixel-art

Dokumen ini mencatat dari mana **gaya** kantor 2D berasal, lisensi proyek yang
menginspirasi, dan pernyataan tegas tentang apa yang **tidak** disalin.

Status: seluruh isi `frontend/src/scene2d/` adalah kode orisinal repo ini.
Tidak ada satu sprite, tile, glyph, palet, atau baris kode pihak ketiga di
dalamnya.

---

## 1. Inspirasi gaya (bukan sumber aset)

| Proyek | Lisensi | Yang diambil |
|---|---|---|
| [`eliautobot/my-virtual-office`](https://github.com/eliautobot/my-virtual-office) — "A self-hosted 2D AI workspace for AI Agents" | **AGPL-3.0** | Hanya *ide*: meja dengan monitor yang memperlihatkan pekerjaan nyata, chip status di atas kepala agen, pesan terbang antar-meja, agen offline digambarkan "tertidur" (Zzz). |
| [`pixel-agents-hq/pixel-agents`](https://github.com/pixel-agents-hq/pixel-agents) — "A playful way to manage your AI workforce" | **MIT** | Hanya *ide*: siklus jalan → duduk → mengetik/membaca, dan penanda visual saat agen tertahan (butuh izin). |

Keduanya adalah kantor virtual 2D untuk agen AI dengan gaya pixel-art top-down.
Kemiripan yang terlihat di layar adalah kemiripan **konvensi genre** (diorama
top-down, chibi 16-bit, nameplate di atas kepala) — sama seperti dua game
platformer yang sama-sama menggambar blok bata.

### Kenapa tidak ada kode/aset yang disalin

- **Lisensi.** Proyek pertama AGPL-3.0: menyalin kode atau asetnya akan memaksa
  seluruh repo ini berlisensi AGPL dan membuka kewajiban distribusi sumber.
  Karena itu tidak ada satu pun file, potongan kode, atau gambar dari sana yang
  dipakai. Proyek kedua MIT (izin salin dengan atribusi) — tetapi tetap tidak
  disalin, supaya tidak ada aset pihak ketiga di bundle dan tidak ada
  ketergantungan lisensi.
- **Teknis.** Semua sprite digambar dengan `fillRect` di
  `frontend/src/scene2d/sprites.ts` (chibi 12×16, meja, kursi, furnitur per id
  `OBSTACLES`, kucing, amplop). Semua teks in-world memakai font 5×7 prosedural
  yang glyph-nya ditulis tangan di `pixelfont.ts`. Tidak ada `@font-face`, tidak
  ada file gambar di `frontend/public/` selain arsip GLB (lihat §3), dan
  `frontend/dist/assets/` hanya berisi JS/CSS hasil build.
- **Verifikasi.** `git log -- frontend/src/scene2d` seluruhnya commit repo ini;
  `grep -rn "pixel-agents\|my-virtual-office" frontend/src` tidak menemukan
  apa pun.

---

## 2. Palet & tipografi

- **Palet**: token `--px-*` di `docs/design/office-2d.md` §2.1–2.3, diturunkan
  dari warna tim yang sudah ada di repo (`TEAMS` di `lib/agents.ts`:
  `#d4805c`, `#82aac8`, `#deb860`) plus navy/terakota yang dipilih untuk proyek
  ini. Tidak ada palet yang diambil dari proyek lain.
- **Font in-world**: 5×7 pixel font prosedural (`scene2d/pixelfont.ts`),
  A–Z, 0–9, dan tanda baca, digambar sebagai bitmask per baris. Tidak memakai
  webfont, tidak memakai `fillText`.
- **Font panel (DOM)**: stack sans-serif sistem (`ui-sans-serif, system-ui,
  -apple-system, 'Segoe UI', Roboto`). Tidak ada font yang diunduh. Spec desain
  menyebut `Pixelify Sans` (OFL) sebagai opsi; implementasi memilih tidak
  memakainya supaya tidak ada file font di repo — semua label pixel tetap
  prosedural.

---

## 3. Aset pihak ketiga yang masih ada di repo

| Aset | Lisensi | Status |
|---|---|---|
| `frontend/public/models/*.glb` (Quaternius Ultimate Modular, 5 model) + `LICENSE-quaternius.txt` | **CC0 1.0** (public domain) | Arsip dari scene 3D. **Tidak dipakai** scene 2D dan tidak di-fetch aplikasi; masih ikut tersalin ke `dist/` (±8 MB). Penghapusan/pengarsipan menunggu keputusan pemilik repo (Q1 di `docs/plans/office-2d.md`). |

Tidak ada aset pihak ketiga lain. `frontend/dist/` tidak memuat gambar, font,
atau model yang dirujuk kode.

---

## 4. Ringkasan untuk review

- Gaya: terinspirasi dua proyek publik (AGPL-3.0 & MIT) — **ide saja**.
- Kode, sprite, tile, glyph, palet: orisinal, ditulis di repo ini.
- Satu-satunya aset pihak ketiga: GLB Quaternius **CC0** yang sudah ada sejak
  versi 3D, tidak dipakai fitur ini.
- Karena tidak ada kode AGPL yang disalin, repo ini **tidak** terkena kewajiban
  AGPL dari proyek referensi.

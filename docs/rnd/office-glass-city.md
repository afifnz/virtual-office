# R&D — Kantor 2D Glassmorphism + Pemandangan Kota Metropolitan

**Status:** riset & spesifikasi desain (bukan implementasi produksi)
**Branch:** `rnd/office-glass-city`
**Versi:** 1.0 · 22 November 2026
**Penyusun:** Tim R&D (Hermes · profil `dev`)
**Ruang lingkup:** `frontend/src/scene2d/*`, `frontend/src/components/*`, `frontend/src/styles/global.css` — hanya dibahas, tidak diubah.

---

## 1. Ringkasan eksekutif

Kantor 2D sekarang adalah ruang pixel-art prosedural: kanvas 2D tunggal, sprite `fillRect`, font 5×7, zoom integer 1–4, blit nearest-neighbour, tiga lantai dengan tab + lift, dan panel DOM (roster/feed/taskboard/KPI/HUD) bergaya solid tanpa blur. Permintaan bos: gaya **modern clean + glassmorphism** dengan latar **pemandangan kota metropolitan**.

Kesimpulan riset, singkat:

1. **Glassmorphism yang bekerja bukan "semua transparan".** Resep yang terbukti di produk nyata adalah empat lapis: isian translusen, blur latar, garis tepi tipis, dan satu highlight dalam 1 px — ditambah noise halus untuk memecah gradien (Microsoft menamainya resep Acrylic: *background, blur, exclusion blend, color/tint overlay, noise*). Kegagalan yang paling sering terjadi juga terdokumentasi: kontras teks jatuh saat latar di belakang kaca berubah, dan tumpukan kaca berlapis membuat mata lelah.
2. **Di canvas 2D, blur itu mungkin tetapi mahal dan tidak portabel.** `ctx.filter = 'blur(Npx)'` baru ada di Safari 18 (2024); di iOS lama ia **diam-diam diabaikan**. Blur di kanvas juga hanya mem-blur isi kanvas, bukan DOM di belakangnya. Panel DOM dengan `backdrop-filter` **bisa** mem-blur kanvas di belakangnya, tetapi biayanya dibayar ulang setiap frame selama kanvas bergerak. Karena itu arsitektur yang dipilih: kaca di **chrome DOM** (roster/tab/HUD), dan di dalam kanvas kaca digambar sebagai **blok alpha bertingkat + highlight + noise** (tanpa konvolusi per frame), dengan blur hanya pada **band jendela yang di-cache**.
3. **Pemandangan kota menuntut view samping, bukan denah.** Pada denah top-down, dinding utara hanyalah strip 0,22 unit (≈7 px di zoom 2) sehingga kota tidak mungkin "di belakang dinding". Keputusan bos: scene digambar sebagai **elevasi/potongan gedung dilihat dari depan** — lantai jadi band horizontal, curtain wall kaca jadi bidang vertikal, kota besar di belakangnya. Konsekuensi datanya dianalisis di §12: `x` tetap horizontal, `z` menjadi **baris kedalaman** (2.5D), bukan lagi posisi vertikal layar.
4. **Avatar tidak lagi pixel-art.** Avatar menjadi **clean vector** (path + gradien, anti-aliased), di-cache sebagai sprite. Biayanya di **migrasi 13 `look`**, penggantian font label 5×7, dan pembaruan gate visual — 3–4 hari, sudah termasuk gate.
5. **Dua tema, berganti otomatis mengikuti waktu lokal.** Bos memutuskan kantor tampil **Terang** (Daylight Atrium: kaca putih susu, permukaan cerah, aksen biru, skyline siang) pada 06:00–18:00 waktu `Asia/Jakarta` dari `/api/config`, dan **Gelap** (Sky Lobby: kaca frosted gelap, skyline malam) di luar itu. Bukan pilihan salah-satu: dua-duanya first-class, dengan override manual + `?theme=` untuk screenshot. Aturannya hidup di satu modul murni yang diuji headless (§11).
6. **Rekomendasi akhir:** dua tema di atas + scene **view samping all-vector** + kaca dibatasi empat permukaan di chrome (HUD, tab, roster) plus satu curtain wall di dalam scene, blur hanya di chrome dan kota yang di-cache. Neon Metro turun menjadi alternatif, bukan tema utama.

Angka kunci (label **terukur** vs **estimasi** disebut eksplisit):

| Ukuran | Nilai | Status | Cara ukur |
|---|---|---|---|
| Biaya blur panel 280×640 @ DPR 2, radius 12 px | 31,1 ms/frame | **terukur** (CPU, Pillow) | `docs/rnd/bench/glass_blur_bench.py` → `glass_blur_bench.json` |
| Biaya panel yang sama bila blur di-cache | 0,10 ms/frame | **terukur** (CPU) | idem |
| Kontras teks utama, tema Terang / Gelap | 13,9:1 / 14,5:1 | **terukur** | `tokens.py` (WCAG 2.x relatif luminans) |
| Pasangan kontras terburuk seluruh tema | 5,00:1 (status `offline` di Neon) · 5,04:1 (`blocked` di tema Terang) | **terukur** | idem, 78 pasangan |
| Chunk scene saat ini | 46.417 B (15.320 B gzip) | **terukur** | `frontend/dist/assets/Office2D-*.js` |
| Operasi gambar per avatar vector | 53–63 path/isi + 28–32 gradien (tergantung look) | **terukur** | dihitung saat render, `render_mockups.py` |
| Bangun 8 avatar @150 px (Pillow, supersample 4×) | **1109 ms** per set (@88 px di mesin yang sama: 455 ms) | **terukur** (CPU mockup) | `avatar()` di `render_mockups.py`; angka canvas di browser belum diukur |
| Kamera view samping | **150 px/unit tetap** (bukan fit-to-width) · avatar 150 px · ruangan **548 px** (lantai→plafon, termasuk jendela) | **terukur** | `side_report()` + `side_metrics()` di `render_mockups.py` |
| Rasio avatar:ruangan (verdict bos) | **1:3,65** (dulu 1:3,50 di atas kertas / 1:5,3 dirasakan) | **terukur** | idem, `side_metrics()` |
| Dinding kosong | **0,0 %** bidang telanjang · kaca+kota **88,5 %** · papan **27,0 %** | **terukur** | `side_wall_gate()` |
| fps 60 desktop / 30 HP dengan band kota | — | **estimasi** (belum diukur di perangkat) | target Fase 0, harus diukur sebelum lanjut |

---

## 2. Latar belakang & tujuan

Kantor agen adalah dashboard monitoring: yang harus terbaca dalam < 2 detik adalah **siapa sedang apa, di mana, dan siapa yang butuh perhatian**. Gaya visual sekarang (pixel-art, solid, tanpa blur) sangat kuat untuk itu — kontras tinggi, tanpa efek yang menipu mata — tetapi terasa "game", bukan "produk".

Permintaan bos menambah dua hal yang secara desain berkonflik dengan pixel-art:

- **glassmorphism** (translusensi + blur + tepi terang), dan
- **pemandangan kota metropolitan** (detail tinggi, banyak titik terang, bergerak bila parallax).

Tujuan dokumen ini:

1. Memberi dasar riset bersumber untuk gaya tersebut, termasuk **kegagalan** yang harus dihindari.
2. Menjawab pertanyaan teknis yang menentukan: bisakah blur itu dilakukan di canvas 2D, berapa biayanya, dan kapan harus di-cache.
3. Menyediakan **tiga arah desain** yang bisa dinilai, lengkap dengan token, kontras, dan mockup 1280×800.
4. Merekomendasikan satu arah, plus rencana bertahap yang bisa berhenti kapan saja tanpa merusak produksi.

**Bukan** tujuan dokumen ini: mengubah kode produksi, menambah dependensi, atau memutuskan identitas merek.

---

## 3. Metode & sumber

Riset dilakukan dengan membuka sumber primer (dokumentasi platform, spesifikasi, pedoman aksesibilitas) dan sumber sekunder yang menyebut dirinya sebagai analisis. Setiap klaim di §4 dan §5 diberi nomor rujukan ke §13.

Yang **diukur** di mesin ini (AMD EPYC 9754, 2 vCPU, Pillow 12.3, Python 3.13):

- biaya blur dan komposit panel kaca pada dua DPR dan tiga radius (`docs/rnd/bench/glass_blur_bench.py`),
- rasio kontras seluruh pasangan warna arah desain (`docs/design/mockups/tokens.py`),
- ukuran chunk JS produksi yang ada,
- waktu bangun cache avatar vector dan biaya blit sprite.

Yang **diestimasi** (dan selalu diberi label "estimasi"):

- biaya blur di browser (GPU/Skia) — angka CPU di atas adalah **batas atas**, bukan hasil pengukuran browser; rasio antar-strategi yang dipakai untuk keputusan,
- ukuran bundle tambahan modul avatar vector,
- estimasi usaha per fase.

Mockup dibuat prosedural dengan Pillow (`docs/design/mockups/render_mockups.py`): tidak ada aset pihak ketiga yang disalin. Geometri mockup memakai koordinat asli L3 dari `frontend/src/lib/rooms.ts` (24×18 unit, TILE 16, zoom 2, 8 meja dev) dan look asli dari `frontend/src/lib/agents.ts`, supaya bisa dibandingkan satu-satu dengan tangkapan layar aplikasi.

**Lisensi & atribusi.** Font DejaVu (lisensi Bitstream Vera/DejaVu, permisif) dipakai hanya untuk merender teks mockup, tidak dikirim ke aplikasi. Referensi kota prosedural `marianmeres/cityscape` berlisensi MIT — dibaca sebagai referensi arsitektur, **tidak ada kode yang disalin**. Dokumentasi Apple/Microsoft/W3C/MDN dirujuk sebagai teks, bukan aset. Seluruh piksel mockup dihasilkan skrip di repo ini.

---

## 4. Temuan riset

### 4.1 Anatomi glassmorphism yang bekerja

NN/g mendefinisikan glassmorphism sebagai gaya yang "menggunakan tingkat translusensi berbeda untuk menciptakan kedalaman dan kontras antara elemen depan dan belakang, meniru kaca buram", dan mencatat bahwa gaya ini menonjol justru di depan **gradien atau latar kompleks** [9]. Artinya: kaca butuh latar yang punya variasi; kaca di atas bidang rata hanya terlihat seperti kotak abu-abu.

Resep yang dipakai produk nyata, dari dokumentasi resmi:

| Lapis | Fungsi | Bukti |
|---|---|---|
| Isian translusen (alpha 0,55–0,72) | memberi "bahan", bukan lubang | Apple: material "membiarkan warna lewat dari latar ke depan" untuk membangun hierarki [8] |
| Blur latar (8–20 px) | meredam detail di belakang teks | Apple varian *regular* "mem-blur dan menyesuaikan luminositas latar untuk menjaga keterbacaan" [8] |
| Garis tepi tipis (alpha 0,10–0,20) | memisahkan kaca dari latar tanpa bayangan berat | Acrylic memakai *exclusion blend* untuk kontras [7] |
| Highlight dalam 1 px di tepi atas | mensimulasikan pantulan cahaya pada ketebalan kaca | NN/g menyebut stroke/gradien sebagai cara memberi "ketebalan" [9] |
| Noise halus (alpha 3–6 %) | memecah gradien sehingga tidak terlihat seperti "plastik" | resep Acrylic eksplisit memasukkan *noise* [7] |
| Tint warna terbatas | mengikat kaca ke identitas, bukan netral | Acrylic memakai *color/tint overlay* [7] |

Yang **tidak** boleh dilakukan, dari sumber yang sama:

- **Menumpuk kaca di atas kaca.** Microsoft: "hindari melapisi beberapa permukaan acrylic: beberapa lapis acrylic dapat menciptakan ilusi optik yang mengganggu" [7].
- **Memakai kaca untuk panel permanen yang besar.** Microsoft menyarankan panel vertikal yang memisahkan konten memakai latar **opaque**, bukan acrylic; acrylic untuk permukaan transien (flyout, context menu) [7].
- **Mengandalkan kaca untuk keterbacaan.** NN/g: masalah terbesar glassmorphism adalah teks yang terlalu terang/gelap atau latar terlalu ramai; tiga praktik yang disarankan: penuhi ambang kontras, **lebih banyak blur lebih baik** untuk latar rumit, dan beri pengguna kendali transparansi [9].

### 4.2 Contoh produk nyata

| Produk | Material | Pelajaran yang bisa dipakai |
|---|---|---|
| Apple visionOS / macOS / iOS (Liquid Glass, sejak 2025) | kaca dinamis untuk lapisan kontrol & navigasi, varian *regular* mem-blur + menyesuaikan luminositas | kaca dipakai untuk **lapisan fungsi** (tab bar, sidebar), bukan untuk konten; ada setelan *reduce transparency* & *increase contrast* [8] |
| Windows 11 (Fluent) | **Mica** (opaque, ditint dari wallpaper, untuk window utama) dan **Acrylic** (translusen, untuk flyout/menu) | dua tingkat material: chrome permanen pakai yang (hampir) opaque, permukaan transien pakai yang transparan [6][7] |
| Dashboard gelap beraksen tunggal (Linear, Vercel, Stripe) | permukaan gelap netral + satu aksen + tipografi kecil rapat | pola yang lazim, tetapi **pengamatan visual**, bukan dokumentasi resmi — jangan dijadikan rujukan normatif |

Pelajaran gabungan: **material berbeda untuk peran berbeda**. Sidebar/roster yang selalu ada lebih baik mendekati opaque; tab/menu/popover yang muncul sesaat boleh lebih transparan. Ini yang akan dipakai di §6.

### 4.3 Kegagalan umum glassmorphism

1. **Kontras teks jatuh.** Teks di atas kaca hanya sebaik apa pun yang lewat di belakangnya; di dashboard yang latarnya bergerak, kontras berubah tiap frame [9][10]. NN/g bahkan menulis kritik tajam terhadap Liquid Glass iOS 26: "teks di atas gambar adalah ide buruk karena kontras antara teks dan latar sering terlalu rendah" [10].
2. **Blur membuat lelah.** Blur mengurangi ketajaman yang dibutuhkan mata untuk memfokuskan teks; NN/g menyarankan blur **lebih banyak** (bukan lebih sedikit) agar latar benar-benar tenggelam, dan menyediakan opsi mengurangi transparansi [9].
3. **Terlalu banyak lapisan transparan.** Selain ilusi optik [7], setiap lapisan menambah biaya komposit dan membuat hierarki kabur.
4. **Kaca di atas konten yang berubah cepat** memaksa blur dihitung ulang terus-menerus — ini masalah performa, dibahas di §5.2.
5. **Kaca sebagai dekorasi.** Kalau kaca tidak menandai peran (fungsi vs konten), ia hanya menambah noise visual.

Konsekuensi untuk kita: kaca harus **sedikit, berperan, dan punya lantai opaque**. Setiap nameplate dan chip status tetap hampir opaque (alpha ≥ 0,90) — kaca dipakai untuk panel, bukan untuk teks.

### 4.4 Pemandangan kota metropolitan sebagai latar

Komposisi skyline yang bekerja secara visual punya tiga hukum:

1. **Aerial perspective (perspektif atmosferik).** Semakin jauh objek, kontras dan saturasinya turun dan warnanya bergeser ke warna latar (biasanya kebiruan; kemerahan saat matahari rendah) [19]. Praktisnya: lapisan kota terjauh paling pucat dan paling rendah kontras, lapisan terdekat paling gelap/pekat. Tanpa ini, skyline terlihat seperti stiker.
2. **Parallax berlapis.** Kota prosedural yang sudah terbukti memakai beberapa lapisan kedalaman yang bergerak dengan kecepatan berbeda, jendela yang menyala dan meredup, serta siklus "mood" yang menggerakkan langit dan kehangatan jendela bersama-sama [20]. Untuk dashboard, parallax harus **sangat lambat atau nol** — tujuannya memberi kedalaman, bukan menarik mata.
3. **Jendela menyala sebagai tekstur, bukan fokus.** Titik-titik terang berjumlah ratusan akan bersaing dengan dot status. Solusinya: turunkan alpha jendela (80–165 dari 255), kecilkan ukurannya (1–3 px), dan beri veil/haze di atas band.

Waktu hari: **dusk** memberi kontras terbaik untuk kaca (langit masih punya gradien, kota sudah gelap), **night** paling dramatis tetapi paling berisiko (banyak titik terang + glow), **day** paling "clean" tetapi paling sulit memisahkan kaca putih dari langit pucat.

**Batasan proyeksi kita (temuan penting).** Kantor digambar **top-down**: dinding utara adalah strip setebal `WALL_T = 0,22` unit, yaitu ≈7 px pada zoom 2. Tidak ada ruang vertikal untuk "melihat keluar jendela". Maka pemandangan kota hanya bisa hidup di:

- **(a) band elevasi** setinggi 2–3 unit di atas garis dinding utara (tambahan visual murni, tidak mengubah koordinat, seperti prop), dan
- **(b) latar kanvas** di luar denah (area plinth), yang sekarang memang kosong.

Keduanya visual-only. Ini menjaga aturan "satu sumber koordinat" (`rooms.ts`) tetap utuh.

### 4.5 Estetika "modern clean" untuk dashboard monitoring

| Prinsip | Aturan yang dipakai | Sumber |
|---|---|---|
| Grid 8 pt | semua padding/gap/tinggi komponen kelipatan 8 (4 hanya untuk ikon) | Material 3: sistem spasi 8 dp, `space100 = 8dp` [18] |
| Hierarki tipografi 3 tingkat | label 10–11 px uppercase +0,08em; body 12,5–13 px; judul 15 px bold; angka tabular | praktik dashboard; ukuran mengikuti skala Material [18] |
| Satu aksen | satu warna aksen (amber / biru / cyan) untuk state aktif dan aksi utama; sisanya netral | [6][7] (tint terbatas) |
| Status = warna + bentuk + teks | dot status selalu disertai label teks; offline = cincin, bukan cakram | WCAG 1.4.1: warna tidak boleh satu-satunya pembeda [17] |
| Kontras | teks ≥ 4,5:1; elemen non-teks (dot, border) ≥ 3:1 | WCAG 1.4.3 [15], 1.4.11 [16] |
| Density | baris roster 34 px (desktop), 38 px (mobile); tidak ada baris < 32 px | Material density [18] |

---

## 5. Analisis teknis canvas 2D

### 5.1 Batas nyata: `backdrop-filter` vs `ctx.filter`

Ini bagian yang paling sering salah dijelaskan, jadi perlu tepat:

- **`backdrop-filter` (CSS, pada elemen DOM)** memfilter **segala sesuatu yang dilukis di belakang elemen itu** [1][2]. Karena `<canvas>` adalah elemen yang dilukis di belakang panel, **panel DOM dengan `backdrop-filter` BISA mem-blur kanvas**. Jadi bukan "tidak mungkin".
- **`ctx.filter` (canvas 2D)** memfilter **hasil penggambaran ke kanvas itu sendiri** [3]. Kanvas tidak punya API untuk membaca apa pun di belakangnya; `ctx.filter` tidak bisa "mengintip" DOM. Jadi panel kaca yang digambar **di dalam** kanvas tidak bisa mem-blur DOM di belakang kanvas — tetapi bisa mem-blur **isi kanvas** (mis. kota di band jendela), asal isi itu digambar lebih dulu ke kanvas/offscreen.
- **Dukungan `ctx.filter`:** Chrome 52, Firefox 49, **Safari 18** (2024) [4]. Di Safari < 18 properti ini tidak error, hanya **diabaikan** — hasilnya kaca rata tanpa blur. Ini alasan kuat untuk tidak menggantungkan seluruh gaya pada `ctx.filter`.
- **Dukungan `backdrop-filter`:** Chrome 76, Edge 79, Firefox 103, Safari 18 (unprefixed; `-webkit-` lebih awal); Baseline sejak September 2024 [1][4].
- **`OffscreenCanvas`:** Chrome 69, Firefox 105, Safari 16.4 [4] — cukup aman untuk pre-render.

Kesimpulan arsitektural:

> Panel kaca yang menutupi kanvas **harus** DOM + `backdrop-filter` (bisa, dan itu yang dipakai untuk roster/tab/HUD). Kaca **di dalam** kanvas (band jendela, partisi) digambar sebagai blok alpha + highlight + noise, dan bila butuh blur, di-blur **sekali** ke offscreen saat resize/ganti lantai — bukan per frame.

### 5.2 Biaya blur: tiga strategi, angka terukur

Benchmark (`docs/rnd/bench/glass_blur_bench.py`) memakai rasteriser software Pillow — algoritme blur-nya kelas yang sama (tiga lintasan box mendekati Gaussian) dengan jalur CPU Skia. Angka absolut browser (GPU) lebih rendah; **rasio** antar-strategi dan sifat skalanya yang dipakai untuk keputusan.

Panel uji: **280×640 CSS px** (sidebar roster, permukaan kaca terlebar), latar bergerak (gradien + 40 blok jendela menyala).

| DPR | radius | px panel | A. blur/frame | B. cache | C. fake glass | D. half-res | E. frame penuh |
|---|---|---|---|---|---|---|---|
| 1× | 8 px | 179.200 | 7,83 ms (p95 8,80) | **0,03 ms** | 1,44 ms | 4,60 ms | 0,25 ms |
| 1× | 12 px | 179.200 | 7,85 ms (p95 9,28) | **0,03 ms** | — | 4,69 ms | 0,23 ms |
| 1× | 20 px | 179.200 | 7,74 ms (p95 8,33) | **0,03 ms** | — | 4,69 ms | 0,25 ms |
| 2× | 8 px | 716.800 | 31,62 ms (p95 33,55) | **0,09 ms** | 6,66 ms | 19,31 ms | 2,40 ms |
| 2× | 12 px | 716.800 | 31,13 ms (p95 32,84) | **0,10 ms** | — | 19,17 ms | 2,35 ms |
| 2× | 20 px | 716.800 | 32,28 ms (p95 35,10) | **0,10 ms** | — | 19,52 ms | 2,25 ms |

Tiga hal yang bisa dibaca dari tabel:

1. **Biaya blur sebanding luas, bukan radius.** 4× luas (DPR 1→2) ≈ 4× waktu; radius 8→20 px hampir tidak mengubah waktu karena implementasi memakai aproksimasi box (jumlah lintasan tetap). Ini penting: menaikkan radius untuk "blur lebih halus" **gratis** secara komputasi, sementara menaikkan luas panel **mahal**.
2. **Blur per frame tidak layak.** Pada DPR 2, satu panel 280×640 memakan 31 ms — seluruh anggaran 30 fps (33 ms), dan 1,9× anggaran 60 fps (16,7 ms). web.dev menegaskan hal yang sama dari sisi browser: "apa pun yang melibatkan blur akan lebih lama dilukis", dan 10 ms per frame biasanya tidak cukup untuk kerja paint, terutama di perangkat mobile [11].
3. **Cache mengubahnya menjadi gratis.** Komposit panel yang sudah di-blur = 0,03–0,10 ms. Jadi aturannya: **blur sekali per (lantai, ukuran, waktu-hari), komposit tiap frame**.

Catatan kejujuran: angka CPU ini bukan angka browser. Di browser, `backdrop-filter` di atas kanvas yang beranimasi tetap memaksa komposit ulang tiap frame; biayanya di GPU, tetapi tetap tumbuh dengan luas kaca × jumlah lapisan. Karena itu anggaran kita: **maksimum 2 permukaan kaca ber-blur yang terlihat sekaligus**, dan tidak ada blur di dalam loop render kanvas.

**Kapan harus di-cache** (aturan operasional):

| Kondisi | Aksi |
|---|---|
| Panel kaca DOM di atas kanvas yang bergerak | `backdrop-filter` **hanya** jika luas < 120×120 px (chip, tombol); panel besar pakai latar opaque-ish `rgba` + noise, tanpa blur |
| Band jendela kota di kanvas | pre-render ke `OffscreenCanvas` per (lantai × waktu-hari); digambar sebagai satu `drawImage` |
| Ganti lantai / resize / DPR berubah | invalidasi cache band (bukan tiap frame) |
| `prefers-reduced-transparency: reduce` | matikan blur, pakai `surface_solid` |

### 5.3 Dampak ke gaya sprite & proyeksi

Karena avatar sekarang **clean vector**, pertanyaannya bukan lagi "pixel vs kaca" untuk avatar, melainkan **seberapa jauh scene ikut non-pixel**. Tiga tingkat, dengan konsekuensi:

| Tingkat | Isi | Konsekuensi |
|---|---|---|
| (a) **Hibrida** | avatar vector di atas scene pixel (meja, furnitur, font 5×7 tetap) | paling murah (0 hari untuk scene), tetapi **tabrakan gaya**: tepi tajam 1 px di sebelah kurva anti-aliased. Layak hanya sebagai langkah transisi 1 rilis |
| (b) **Scene all-vector** | avatar + meja + furnitur + font label anti-aliased | koheren; butuh menulis ulang ~6 fungsi gambar (`drawDesk`, `drawFurnitureLayer`, `drawWalls`, `drawLift`, `props`), font label baru, dan **semua gate visual di-update**. Estimasi 3–5 hari |
| (c) **Vector + kaca & kota penuh** | (b) + band jendela kota, kaca di chrome, parallax halus | seperti (b) + 2–3 hari; risiko performa paling tinggi tetapi masih di bawah anggaran bila blur di-cache |

Bukti visual: tiga crop identik dari L3 pada ketiga tingkat. Pada (a) terlihat jelas garis 16 px yang "bergerigi" berdampingan dengan bahu avatar yang halus — persis kekhawatiran di brief.

![Gambar 1 — Perbandingan scene-tech pada crop L3 yang sama (denah top-down): (a) avatar vector di atas scene pixel, (b) seluruh scene vector, (c) scene vector + kaca & kota penuh. Ketiganya sudah memakai avatar clean-vector; keputusan view samping ada di §12.](docs/design/mockups/scene-tech-compare.png,15.5)

### 5.4 Pemandangan kota: lapisan, tile, zoom, biaya

Rancangan yang diusulkan:

| Parameter | Nilai | Alasan |
|---|---|---|
| Jumlah lapisan parallax | **3** (jauh, tengah, dekat) + 1 lapisan langit | 4 lapis di mockup terbaca "ramai"; 3 cukup untuk kedalaman [19][20] |
| Ukuran tile | 256×96 px per lapisan, diulang horizontal | satu tile = satu `drawImage`; pola berulang tidak terlihat karena bangunan diacak per tile |
| Ikut zoom/pan? | **Tidak.** Band jendela tetap di tempatnya | kalau ikut zoom, jendela jadi 2–4× lebih besar dan bersaing dengan meja |
| Parallax saat pan | maksimum 6 px per 100 px pan, hanya lapisan tengah & dekat | cukup untuk kesan gerak, tidak memicu mabuk gerak |
| Biaya render | 3 `drawImage` + 1 veil per frame ≈ **0,02–0,05 ms** (estimasi, GPU) | band di-cache, bukan digambar ulang |
| Waktu hari | **dua tema**: `day` 06:00–18:00 WIB, `night` di luar itu (§11) | aturan jam, bukan pilihan manual; subuh/senja dipotong (alasan di §11) |

Pre-render sekali per (lantai × tema) → 3 lantai × 2 tema = **6 kanvas offscreen** ukuran 768×576 @DPR 2 ≈ 3,5 MB per layer (≈ 21 MB total). Neon, kalau diaktifkan, menambah 3 lagi. Cache di-cap LRU 6 dan di-invalidasi saat tema berganti, resize/DPR berubah, atau bentuk roster berubah — lihat §11.

### 5.5 Kinerja: target, anggaran, dan pengaman

| Target | Angka | Cara mencapainya |
|---|---|---|
| Desktop menengah | **60 fps** (16,7 ms/frame) | scene statis di-cache per lantai (sudah begitu), avatar di-cache, band di-cache, blur hanya di DOM |
| HP kelas menengah | **30 fps** (33 ms/frame) | zoom 1 (denah 384×288), animasi agen diperlambat, parallax dimatikan |
| Saat tab tidak terlihat | 0 frame | `document.hidden` sudah dipakai di loop (`Office2D.tsx`) |
| `prefers-reduced-motion` | tanpa animasi | sudah dipakai (`still`) |
| `prefers-reduced-transparency` | kaca → solid | **belum ada**; Chrome 118+/Firefox 113+, Safari belum [13][14] → perlu fallback manual |

Catatan penting soal `prefers-reduced-transparency`: dukungannya **belum universal** (Safari tidak mendukung) [14], jadi fallback tidak boleh bergantung padanya. Rencana: media query **plus** tombol "kontras tinggi" di toolbar yang menulis `data-contrast="high"` pada `<html>` — dua jalur, satu hasil.

### 5.6 Avatar: dari pixel ke clean vector

Ini sub-bab yang diminta eksplisit oleh bos. Ringkasnya: avatar **tidak lagi** 12×16 pixel; ia menjadi figur vector dengan path + gradien, di-cache sebagai sprite, dan digambar di kanvas dengan anti-aliasing.

#### 5.6.1 Apa yang berubah, apa yang tidak

| Aspek | Sekarang (pixel) | Usulan (vector) | Berubah? |
|---|---|---|---|
| Sumber bentuk | `sprites.ts` — 514 baris `fillRect` 1 px | modul baru `avatar.ts` — path + `createLinearGradient` | ya |
| Ukuran di layar | 12×16 world px → 24×32 CSS px @ zoom 2 | 1,4×0,9 unit → 32×54 CSS px di denah · **90×150 px di view samping** (naik setelah dua verdict bos) | ya, jauh lebih besar, disengaja |
| Ancor kaki | kaki di `desk.z`, dipakai `pickTargets` | **sama** — kaki tetap di `desk.z`, radius pick 0,9 unit | tidak |
| Cache | `getSprite(key)` per (look, pose, frame) | **sama**, key diperluas dengan `style` vector | tidak (pola tetap) |
| Label nama | font 5×7 `pixelfont.ts`, `plateScale(zoom)` | teks anti-aliased (`ctx.fillText`) 9,5 px, `measureText` | ya |
| Palet | `PALETTE`/`STATUS` | **sama**, ditambah gradien turunan (`shade()`) | tidak |
| Koordinat & kontrak | `rooms.ts`, `/api/status` | tidak disentuh | tidak |

#### 5.6.2 Biaya migrasi 13 `look` — konkret

`Look` di `agents.ts` punya 14 field: `skin, hair, style, shirt, pants, accent, sculptedHead?, skirt?, glasses?, headphones?, longSleeve?, peci?, mustache?, stubble?, build, tall, female?`. Pemetaannya ke primitive vector:

| Field | Primitive vector | Catatan |
|---|---|---|
| `skin` | 2-stop gradient pada elips kepala + leher + tangan | gradient = `shade(skin, 1.06)` → `shade(skin, 0.88)` |
| `hair` + `style` (7 nilai: crop, short, side, long, bun, curly, messy) | satu cap elips + massa tambahan per gaya | 7 cabang, masing-masing 1–3 path |
| `shirt` | path torso (poligon tapered) + gradient + kerah V | bentuk torso ikut `build` |
| `pants` | 2 rounded-rect + sepatu + sol | `tall` menggeser baseline |
| `accent` | strip dada 1 path | identitas tim, sama seperti sekarang |
| `glasses` | 2 rounded-rect outline + bridge + tint lensa | 3 agen L3 memakainya |
| `headphones` | arc + 2 ear cup | 1 agen |
| `bun` / `long` / `messy` | massa rambut tambahan | pembeda paling terbaca |
| `stubble` / `mustache` | arc rahang / rounded-rect tipis, alpha 105 | **jangan** oval penuh: di uji mockup terbaca seperti "masker" |
| `peci` | rounded-rect gelap di atas kepala | 1 agen (lobby) |
| `build` (0,88–1,12) | lebar torso = `16 × build` unit | sama seperti pixel |
| `tall` (0,94–1,06) | skala tinggi total | sama |
| `female` | mematikan stubble/mustache | sama |
| `sculptedHead` | **dibuang** untuk sekarang (kepala vector generik) | kalau bos mau, jadi pekerjaan terpisah |

Jumlah operasi gambar per avatar: **53–63 path/isi + 28–32 gradien**, tergantung look (WAHYU, RAKA, dan DIMAS paling banyak karena kacamata + stubble + headphone). Angka ini dihitung **saat render** oleh `render_mockups.py` (bukan dihitung tangan), dan bukan beban per frame karena sprite di-cache — lihat 5.6.3.

Tiga aturan raster yang membuat hasilnya benar-benar vector (bukan pixel yang di-upscale): sprite dilukis pada permukaan **4× tinggi tampil** lalu diperkecil **satu kali** dengan LANCZOS; **tidak pernah** ada `resize(..., NEAREST)`; setiap material membawa **dua tone + outline** `shade(warna, 0,5)` selebar 1 unit. Alasan aturan ini ada: versi sebelumnya sudah "vector" di kode tetapi dilukis terlalu kecil lalu dibesarkan, sehingga hasil akhirnya kembali bertangga — lihat bukti angka di 5.6.5.

Yang harus ditulis/diubah:

1. `frontend/src/scene2d/avatar.ts` (baru, ±350 baris): `drawAvatar(ctx, look, pose, frame)` + `avatarKey(look)`.
2. `sprites.ts`: hapus `drawAgent`/`drawHair` (≈120 baris), panggil modul baru.
3. `labels.ts`: `plateWidth()` berubah dari `textWidth()` pixel font ke `ctx.measureText()`; `plateScale()` tetap (1 @zoom1, 2 @zoom2) tetapi artinya "skala font" bukan "skala glyph".
4. `pixelfont.ts`: tetap dipakai untuk **plakat zona** dan **angka lift** (agar identitas pixel tidak hilang total) — atau dihapus seluruhnya bila bos mau 100% bersih.
5. `verify/visual_check.ts`: 3 asersi berubah (lebar plate, tinggi plate, "nama utuh"), sisanya tetap.
6. `verify/anim_check.ts`: token palet tetap; tambah cek `avatarKey` unik untuk 13 look.
7. `verify/office2d_probe.js`: selektor & hook `__office2dFloors()` tidak berubah.

#### 5.6.3 Performa avatar vector: cache, bukan gambar ulang

Diukur di mesin ini (CPU, supersample 3× sebagai proxy anti-aliasing):

| Operasi | Waktu | Catatan |
|---|---|---|
| Bangun 8 avatar @88 px (Pillow, mockup, supersample 4×) | **455 ms** (sekali) | pembanding |
| Bangun 8 avatar @150 px (Pillow, mockup, supersample 4×) | **1109 ms** (sekali) | ukuran yang dipakai sekarang |
| Blit 8 sprite yang sudah di-cache | **0,06 ms** per frame | setara biaya sekarang |

Konsekuensi: **jangan** menggambar path avatar di dalam loop render. Simpan di cache sprite yang sudah ada (`getSprite`), key = `avatar:{hash(look)}:{pose}:{frame}:{dprBucket}`. Ruang cache maksimum: 13 look × 6 pose × 2 frame × 2 bucket = 312 sprite; satu sprite 90×150 px @DPR 2 = 180×300 px × 4 B ≈ 211 KB, jadi 312 entri ≈ 66 MB — terlalu besar. LRU 64 entri ≈ 13,5 MB, dan itu batas yang dipakai.

Estimasi bundle: chunk scene sekarang **46.417 B (15.320 B gzip)**. Modul avatar vector menggantikan `sprites.ts` (19,9 KB sumber); perkiraan **+2–4 KB raw / +1–1,5 KB gzip** — estimasi, belum diukur dengan build.

#### 5.6.4 Bukti visual sebelum/sesudah

![Gambar 2 — Avatar sebelum/sesudah: 12×16 pixel (atas) dan clean vector 150 px (bawah) untuk delapan look L3 yang sama. Baris bawah inilah yang dipakai di semua mockup scene.](docs/design/mockups/avatar-before-after.png,15.5)

Delapan look L3 yang sama, atas = rekonstruksi 12×16 pixel sekarang, bawah = avatar vector 150 px. Perbedaan yang terbaca: siluet (bahu, leher, sepatu), rambut (bun/long/messy/side), aksesori (kacamata berbingkai + lensa, headphone dengan ear cup), dan ekspresi (alis datar, mulut melengkung halus).

Mockup tiga arah memakai avatar vector ini di 8 meja L3 — bisa dinilai bos tanpa membuka Figma.

#### 5.6.5 Bukti angka: 150 px, 1477 warna, 100 % tepi blending

Klaim "vector" tidak cukup; bos meminta angka. `avatar_proof()` di `render_mockups.py`
mengukur satu agen **pada mockup yang benar-benar dirender** dan mencetak hasilnya:

| Metrik | Terukur | Ambang yang dipakai | Kesimpulan |
|---|---|---|---|
| Tinggi avatar di mockup (depan/belakang) | **150 / 141 px** | 135–180 px | ukuran tampil akhir, bukan hasil upscale |
| Warna unik di dalam siluet | **1477** | pixel-art ≤ 12 · vector ≥ 40 | jauh di atas ambang vector |
| Warna unik di crop mockup | **3515** | — | termasuk latar (gradien ikut bergeser) |
| Piksel tepi siluet yang **blending** | **1367/1367 = 100 %** | pixel-art = 0 % | ada anti-aliasing nyata di tepi |
| Piksel alpha parsial | **4956** | > 0 | tepi sub-piksel |
| Operasi gambar | **53–63 path + 28–32 gradien** | — | dihitung saat render |

![Gambar 3 — Bukti zoom: crop 4x satu avatar (BAGAS) dari l3-side-day.png plus delapan look L3 pada zoom yang sama. Angka di bawah gambar dicetak oleh renderer.](docs/design/mockups/avatar-zoom-check.png,15.5)

Cara memeriksa ulang: jalankan `python3 docs/design/mockups/render_mockups.py` dan
baca baris `avatar proof BAGAS: ...` serta `side gate L3: ...` di stdout. Kalau
angkanya turun ke ≤ 12 warna dan 0 % blending, berarti ada yang mengembalikan jalur
upscale nearest — itu regresi, bukan selera.

---

## 6. Dua tema + satu alternatif

Kantor memakai **dua tema first-class** yang berganti otomatis mengikuti jam lokal (§11): **Terang** (Daylight Atrium) untuk 06:00–18:00 dan **Gelap** (Sky Lobby) di luar itu. Neon Metro tetap ada sebagai alternatif **di level renderer/mockup** (`--theme neon`), bukan nilai kontrak `?theme=` (yang hanya menerima `day`, `night`, `auto`).

Semua tema memakai: grid 8 pt, tiga tingkat tipografi, satu aksen, **status = warna + bentuk + teks**, nameplate hampir opaque (alpha 0,90–0,92) yang selalu di atas kepala agen, avatar clean vector, **view samping** dengan curtain wall kaca dan skyline kota di belakang, serta panel kaca dengan resep yang sama (isian translusen, tepi 1 px lebih terang dari permukaan, satu highlight diagonal tipis, bayangan lembut, noise halus). Yang berbeda: waktu hari, tint kaca, aksen, dan palet status.

### 6.1 Tema Terang — Daylight Atrium (siang, 06:00–18:00 WIB)

**Konsep.** Atrium dengan curtain wall: cahaya siang, kaca susu, kota biru di luar. Ini tema yang tampil paling lama setiap hari, jadi ia harus paling nyaman untuk monitoring seharian — dan paling sulit, karena kaca putih di atas lantai terang butuh pemisahan ekstra (tepi, bayangan tipis, outline furnitur).

**Palet (token lengkap):**

| Token | Hex | Pemakaian |
|---|---|---|
| `surface` | `#FFFFFF` @ 0,66 | isian kaca |
| `surface-solid` | `#F7FAFD` | fallback reduced-transparency |
| `page` | `#EEF3F8` | latar halaman |
| `floor` | `#E3EAF2` | slab lantai |
| `wall` | `#DDE6F0` | dinding, HUD, toolbar |
| `desk` / `desk-top` | `#FFFFFF` / `#F2F6FA` | meja (butuh outline) |
| `ink` | `#16202E` | teks utama |
| `ink-dim` | `#41506A` | teks sekunder |
| `muted` | `#556377` | metadata |
| `accent` | `#1D4ED8` | tab aktif, aksi |
| `accent-ink` | `#FFFFFF` | teks di atas aksen |
| `border` | `#0F2440` @ 0,20 | garis tepi kaca |
| `highlight` | `#FFFFFF` @ 0,85 | inner highlight 1 px |
| langit | `#3E8FD6 → #7CBCEC → #C4E1F6 → #F0F9FF` | siang cerah |
| bangunan | `#A9C6DD / #8FB0CC / #7699B8 / #5E82A3` | 4 lapisan, kaca memantul |
| jendela | `#EAF7FF`, `#BFE2F7` | refleksi, bukan lampu |

**Kontras terukur — dan tiga perbaikan yang wajib.** Tema terang adalah tempat status paling sering gagal, karena warna status dipakai dua peran: **dot/garis** (ambang 3:1) dan **kata status di roster** (ambang 4,5:1). Versi pertama gagal di peran teks: `working` 4,17:1, `blocked` 4,25:1, `ok` 4,25:1 — semuanya di bawah 4,5:1. Token digelapkan sampai lolos, bukan sekadar dicatat:

| Status | Sebelum | Sesudah | Teks di kaca (≥4,5:1) | Chip (≥4,5:1) |
|---|---|---|---|---|
| `working` | `#A16207` (4,17) | `#8A5406` | **5,31:1** | 6,27:1 |
| `blocked` | `#B45309` (4,25) | `#B33A12` | **5,04:1** | 5,95:1 |
| `ok` | `#15803D` (4,25) | `#116B33` | **5,60:1** | 6,61:1 |
| `offline` | `#5F6A7D` (4,63) | `#556073` | **5,38:1** | 6,35:1 |
| `idle` | `#1D4ED8` | tetap | 5,68:1 | 6,70:1 |
| `reviewing` | `#6D28D9` | tetap | 6,02:1 | 7,10:1 |
| `danger` | `#B91C1C` | tetap | 5,48:1 | 6,47:1 |

`working` dan `blocked` tadinya juga terlalu mirip secara hue (amber vs amber-oranye). `blocked` digeser ke oranye-merah (`#B33A12`, hue 15° vs 35°) **dan** dibedakan bentuknya: `working` = bulatan penuh, `blocked` = belah ketupat. Jadi status tidak pernah bergantung pada warna saja (WCAG 1.4.1).

Kontras teks: ink 13,9:1 · ink-dim 6,9:1 · muted 5,18:1 · aksen 5,68:1. Seluruh 26 pasangan tema Terang lolos; terburuk 5,04:1.

**Tipografi.** system-ui/Inter; body 13 px; label 11 px 600 → 500 agar tidak "berteriak" di latar terang; angka tabular untuk waktu/task id.

**Perlakuan kaca.** Kaca putih 0,66, blur 20 px (chrome saja), border 0,20 (lebih tegas dari tema gelap), highlight 0,85, bayangan lebih dalam (alpha 0,10, blur 26 px), noise 4 % untuk memecah bidang putih besar. Furnitur putih wajib outline 1 px.

**Latar kota.** Siang: langit biru bergradien, matahari tinggi dengan halo, gedung kaca dengan muka terang di sisi matahari, jendela sebagai refleksi (alpha 40–95), horizon tegas, haze tipis 8 %.

**Bayangan.** Siang memakai bayangan **tajam** (blur 3 px, alpha 55/255) — bayangan lembut di cahaya terang terbaca sebagai kabut, bukan kedalaman.

![Gambar 4 — Tema Terang, L3 Tim Dev, view samping, 1280×800. Kota siang terlihat lewat curtain wall yang menjadi dinding belakang ruangan; ruangan mengisi kanvas (548 px lantai→plafon), delapan agen vector dalam dua baris 4+4, nameplate selalu di atas kepala.](docs/design/mockups/l3-side-day.png,15.5)

**Contoh layar.** `docs/design/mockups/l3-side-day.png` · mobile `docs/design/mockups/l3-side-mobile-day.png`.

### 6.2 Tema Gelap — Sky Lobby (malam, 18:00–06:00 WIB)

**Konsep.** Kantor di lantai atas saat malam: langit gelap, kota menyalakan jendela, kaca frosted gelap menahan silau, amber menandai hal yang hidup. Ini tema yang paling dekat dengan identitas sekarang (dark, amber) sehingga risiko desainnya paling kecil.

**Palet (token lengkap):**

| Token | Hex | Pemakaian |
|---|---|---|
| `surface` | `#141B2E` @ 0,62 | isian kaca |
| `surface-solid` | `#141B2E` | fallback reduced-transparency |
| `page` | `#080C16` | latar halaman |
| `floor` | `#1A2230` | slab lantai |
| `wall` | `#121A29` | dinding, HUD, toolbar |
| `desk` / `desk-top` | `#243044` / `#39485F` | meja |
| `ink` | `#F2F5FA` | teks utama |
| `ink-dim` | `#C6D0E0` | teks sekunder |
| `muted` | `#93A0B6` | metadata |
| `accent` | `#F0B45A` | tab aktif, aksi |
| `accent-ink` | `#1A1206` | teks di atas aksen |
| `border` | `#FFFFFF` @ 0,16 | garis tepi kaca |
| `highlight` | `#FFFFFF` @ 0,30 | inner highlight 1 px |
| langit | `#0C1222 → #2B3350 → #8A5560 → #E0A06A` | langit malam |
| bangunan | `#0E1626 / #16203A / #1D2A47 / #26344F` | 4 lapisan |
| jendela | `#F3C57B`, `#9FD8E8` | hangat + dingin |

**Kontras terukur:** ink 14,47:1 · ink-dim 10,16:1 · muted 5,98:1 · aksen 8,57:1 · status teks terendah 5,06:1 (`danger`) · chip terendah 6,13:1. Seluruh 26 pasangan lolos.

**Tipografi.** Sama dengan tema Terang; body 12,5 px karena latar gelap menahan lebih banyak teks.

**Perlakuan kaca.** Kaca gelap 0,62, blur 16–18 px (chrome), border 0,16, highlight 0,30, noise 4 %. Bayangan lebih lembut (blur 7 px, alpha 70/255) karena di malam hari cahaya tersebar.

**Latar kota.** Malam: siluet gedung, jendela menyala (alpha 80–165), kabut 22 % agar tidak bersaing dengan dot status. Curtain wall tetap transparan (isian 0,18 di mockup) supaya skyline tidak padam.

![Gambar 5 — Tema Gelap, L3 Tim Dev, view samping, 1280×800. Skyline malam dengan jendela menyala di balik kaca frosted gelap; komposisi, agen dan meja identik dengan tema Terang.](docs/design/mockups/l3-side-night.png,15.5)

**Contoh layar.** `docs/design/mockups/l3-side-night.png` · mobile `docs/design/mockups/l3-side-mobile-night.png`.

### 6.3 Neon Metro — alternatif (bukan tema utama)

**Konsep.** Kantor di kawasan bisnis yang tidak pernah tidur: hitam pekat, neon cyan/magenta, kaca hitam dengan tepi menyala. Paling dramatis, tetapi paling berisiko untuk keterbacaan status dan performa (glow = beberapa lapis blur). Dipertahankan sebagai alternatif `?theme=neon` untuk eksperimen visual, bukan sebagai tema harian.

**Palet:** `surface #0B0E1C @ 0,70` · `surface-solid #0B0E1C` · `page #04050B` · `floor #0C1020` · `wall #0A0C18` · `desk #141A30` / `desk-top #1E2742` · `ink #EAF2FF` · `ink-dim #B9C6E0` · `muted #8493B0` · `accent #22D3EE` · `accent-ink #04141A` · `border #22D3EE @ 0,45` · `highlight #67E8F9 @ 0,40` · langit `#04040C → #0B0B22 → #2A0F3A → #7A1E5A` · bangunan `#080A14 / #0D1022 / #141833 / #1C2145` · jendela `#67E8F9`, `#F472B6`.

**Kontras terukur:** ink 16,67:1 · ink-dim 10,92:1 · muted 6,06:1 · aksen 10,39:1 · status teks terendah 5,00:1 · chip terendah 5,17:1. Masalahnya bukan kontras, melainkan **beban visual** (glow) dan kelelahan mata.

**Perlakuan kaca.** Kaca hitam 0,70, border cyan 0,45, glow luar 1 lapis (bukan 3), blur 14 px. Latar kota: jendela neon dua warna, glow horizon magenta, alpha jendela diturunkan ke 80–140 agar tidak bersaing dengan dot status.

![Gambar 6 — Neon Metro (alternatif), L3 Tim Dev, 1280×800. Kaca hitam, tepi cyan, glow dibatasi satu lapis. Mockup ini masih memakai denah top-down dan disimpan sebagai pembanding arah, bukan sebagai target view.](docs/design/mockups/neon-metro.png,15.5)

**Contoh layar.** `docs/design/mockups/neon-metro.png`.

---

## 7. Matriks keputusan & rekomendasi

Bobot ditetapkan sebelum menilai (agar tidak menyesuaikan diri dengan hasil): keterbacaan status 25 %, biaya implementasi 20 %, risiko performa 15 %, kesan "modern clean" 20 %, konsistensi dengan data/token yang ada 10 %, aksesibilitas 10 %.

| Kriteria (bobot) | Terang (Daylight) | Gelap (Sky Lobby) | Neon Metro |
|---|---|---|---|
| Keterbacaan status (25 %) | **5** | 4 | 3 |
| Biaya implementasi (20 %) | 2 | **5** | 4 |
| Risiko performa (15 %) | 4 | 4 | 3 |
| Kesan "modern clean" (20 %) | **5** | 4 | 3 |
| Konsistensi data & token (10 %) | 3 | **5** | 4 |
| Aksesibilitas (10 %) | **5** | 4 | 2 |
| **Skor berbobot** | **4,05** | **4,30** | 3,20 |
| Peran dalam produk | **tema siang (06:00–18:00)** | **tema malam (18:00–06:00)** | alternatif `?theme=neon` |

Skor tidak lagi dipakai untuk memilih salah satu, karena keputusan bos adalah **memakai keduanya**: Terang menang di keterbacaan dan kesan bersih, Gelap menang di biaya dan konsistensi token. Yang diambil dari masing-masing: palet Terang untuk jam kerja, palet Gelap untuk malam, dan Neon hanya untuk eksperimen.

Matriks kedua, untuk keputusan **view** (ini yang mengubah mockup secara mendasar):

| Opsi view | Keterbacaan | Biaya | Risiko | Catatan |
|---|---|---|---|---|
| denah top-down (sekarang) | 5 | **5** | 5 | kota tidak mungkin di belakang dinding (dinding 7 px) |
| **(a) elevasi murni** | 2 | **4** | 3 | `z` hanya jadi urutan gambar → agen di `x` sama saling menimpa (L3 punya 3 pasangan seperti itu) |
| **(b) elevasi 2.5D (dua baris + slot)** | **4** | 3 | 3 | `z` → **2 baris** (4 depan + 4 belakang; offset 44 px, skala 1,00/0,94) **plus** slot horizontal 200 px per baris; dua baris meja terbaca, tidak ada label bertumpuk |

**Rekomendasi akhir: dua tema (Terang + Gelap) di atas scene view samping 2.5D, all-vector, dengan anggaran kaca.**

Alasan:

1. **Keputusan bos diikuti apa adanya**: dua tema first-class, berganti otomatis menurut WIB, bukan salah satu.
2. **View samping adalah satu-satunya cara kota benar-benar terlihat** — dan kota adalah inti permintaan. Ia juga membuat lift (naik-turun vertikal) dan kaca (bidang vertikal) terbaca alami, bukan sebagai hiasan.
3. **Dua baris 2.5D + slot horizontal menyelamatkan data yang sudah ada**: `rooms.ts` tidak berubah; `z` hanya berubah perannya di renderer. Offset vertikal saja **tidak cukup** — 24 px tidak memisahkan dua label yang pusatnya sama. Tanpa slot horizontal, tiga pasangan agen L3 (DIMAS/BAGAS, YOGA/RAKA, SARI/LARAS) tetap bertumpuk di `x` yang sama: itu terlihat di mockup (8 agen hanya tampil sebagai 4 posisi). Dengan grid 200 px per baris + stagger 100 px, kedelapan agen dapat posisi sendiri dan gate mengukurnya: 0 label bertumpuk, 0 label menimpa kepala agen lain, overlap bbox avatar 0,0 %.
4. **Biaya kaca terkendali**: empat permukaan kaca di chrome + satu curtain wall di dalam scene; blur hanya di chrome, kota di dalam bidang jendela yang di-cache per (lantai × tema) — lihat §12.
5. **Bisa dihentikan**: kalau view samping tidak lolos penilaian, kembali ke denah top-down cukup dengan mematikan flag renderer; token, kontras, avatar, dan TOC dokumen tidak terpengaruh.

**Yang TIDAK berubah** (kontrak yang dijaga):

- koordinat: `frontend/src/lib/rooms.ts` (meja, `LIFT`, `POIS`, `NAV`, `SPOTS`) — nol perubahan; baris dihitung di renderer dari `z`;
- kontrak API `/api/status`, `/api/config` (termasuk `tz`), dan `__office2dFloors()`;
- lift: shaft 2,6×3,2, pintu barat, indikator lantai di header;
- tab lantai: 3 tab, `?floor=` di URL, keyboard access;
- privasi: tidak ada isi pesan/judul tugas di kanvas maupun panel;
- gate: `go vet`/`go test`, `tsc --noEmit`, `npm run build`, `verify/e2e_review.sh`, plus gate visual yang di-update (bukan dihapus).

**Yang berubah (dan sudah disetujui bos):** avatar jadi vector, font label anti-aliased, scene jadi view samping dengan dua baris, dua palet tema + modul penentu tema, dan satu permukaan kaca baru (curtain wall sebagai dinding belakang ruangan).

![Gambar 7 — Tema Terang di 390×844: bottom sheet kaca, tab lantai di atas sheet, scene view samping tetap terlihat.](docs/design/mockups/l3-side-mobile-day.png,7.6)

---

## 8. Rencana implementasi bertahap

Prinsip: **setiap fase bisa berhenti** dan produksi tetap jalan. Tidak ada fase yang menyentuh `backend/` atau kontrak API.

| Fase | Isi | Gate (harus hijau untuk lanjut) | Estimasi | Rollback |
|---|---|---|---|---|
| **0 — Spike** | dua palet (Terang + Gelap) di satu blok CSS; `theme.ts` murni + `verify/theme_check.ts`; band kota pre-render; flag `?skin=glass&theme=day\|night`; bench fps di laptop + HP | fps ≥ 60 desktop / ≥ 30 HP dengan band aktif; `theme_check` hijau (05:59/06:00/17:59/18:00 + override + fallback tz); tidak ada perubahan visual saat flag mati | **2–3 hari** | hapus flag + blok CSS (1 commit) |
| **1 — Avatar vector** | `avatar.ts`, cache sprite, label anti-aliased, plate baru (selalu di atas kepala + gate 0 overlap); 13 look dimigrasi | `visual_check` (plate tidak overlap, nama utuh, tidak keluar kanvas) + `office2d_probe` hijau; before/after screenshot disetujui | **3–4 hari** | revert modul + panggil `drawAgent` lama (2 file) |
| **2 — Scene vector + view samping** | meja/kursi/furnitur/dinding dalam profil, **dua baris 2.5D dari `z`**, curtain wall + kota **di dalam ruangan**, papan digantung di depan kaca; hapus `fillRect` chibi; zoom 3–4 tetap tajam (DPR-aware) | semua gate visual + `layout_check` (walkability tidak berubah); 8 agen L3 terbaca tanpa tumpukan (gate plate 0 overlap/0 head-cover); fps tidak turun > 10 % | **4–6 hari** | flag `?scene=plan\|side` selama 2 rilis |
| **3 — Tema otomatis + kaca** | HUD toggle + `localStorage`, `prefers-color-scheme`, `?theme=day\|night\|auto`; cache static layer per (lantai × tema); roster/tab/HUD kaca + `backdrop-filter` + fallback; `data-contrast`; reduced-motion/transparency | audit kontras otomatis dua mode (semua pasangan ≥ ambang), fps kedua tema, screenshot 3 lantai × 2 tema + mobile, `theme_check` + `anim_check` hijau | **3–4 hari** | matikan blok kaca (CSS-only) + `?theme=day` paksa |

Total: **12–17 hari kerja**. Titik berhenti yang disarankan: akhir Fase 1 (avatar saja sudah memenuhi koreksi bos) dan akhir Fase 2 (scene bersih tanpa kaca).

**Kapan harus berhenti karena hasilnya jelek** (kriteria eksplisit):

- Fase 0: fps desktop < 55 dengan jendela kota aktif, atau kota membuat teks kanvas sulit dibaca → naikkan sill jendela (kurangi tinggi kaca), jangan lanjut ke view samping.
- Fase 1: avatar vector terbaca "boneka" pada ukuran kecil (uji 5 orang) → **sudah ditangani**: tinggi **150 px** di view samping (naik dari 54 → 88 → 150 px setelah dua verdict bos), kepala chibi 38 % tinggi, alis+mata+mulut digambar eksplisit, dua tone + outline per material. Kalau masih terbaca boneka di browser, naikkan skala kamera ke 160 px/unit, jangan lanjut ke scene.
- Fase 2: view samping membuat posisi agen ambigu walau sudah dua baris (uji: "siapa di meja mana?" salah > 1 dari 5 kali) → perbesar stagger ke satu pitch penuh (baris belakang tepat di antara dua slot depan) atau kembalikan `z` ke kedalaman penuh (opsi a) dan sembunyikan agen yang tertimpa di balik nameplate bertumpuk.
- Fase 3: dua permukaan kaca ber-blur membuat fps HP < 30 → kaca hanya di roster, tab/HUD solid; tema Terang tetap boleh.

---

## 9. Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Kontras teks jatuh saat kota terang di belakang kaca | status tidak terbaca | nameplate alpha ≥ 0,90; audit kontras otomatis di gate; uji dengan 3 waktu-hari |
| Blur per frame di HP | fps < 30, baterai | blur hanya di chrome, cache band, cap 2 permukaan, `will-change` dihindari |
| `ctx.filter` diabaikan Safari < 18 | kaca rata tanpa blur | jangan bergantung pada `ctx.filter`; blur di DOM + fallback tint solid |
| `prefers-reduced-transparency` tidak didukung Safari | preferensi pengguna diabaikan | tombol kontras tinggi manual + `data-contrast` |
| Migrasi avatar merusak gate visual | gate merah / false green | gate di-update bersamaan, bukan dihapus; simpan snapshot lama untuk pembanding |
| Rewrite meja menggeser walkability | agen menembus furnitur | geometri tidak disentuh; `layout_check` tetap sumber kebenaran |
| Scope creep ke 3D | proyek membengkak | tetap canvas 2D; kota hanya band + latar |
| Kaca di atas kanvas menutupi meja | info hilang di balik panel | aturan lama dipertahankan: panel di luar kanvas (sidebar), bukan mengambang |

---

## 10. Lampiran — token & tipografi

### 10.1 Skala spasi (8 pt)

`4 · 8 · 12 · 16 · 24 · 32 · 40 · 48 · 56 · 64` — 4 hanya untuk ikon dan gap di dalam chip.

### 10.2 Skala tipografi

| Peran | Ukuran | Bobot | Letter-spacing | Pemakaian |
|---|---|---|---|---|
| label | 11 px | 600 | +0,08em, uppercase | header grup, tab |
| meta | 9,5–10 px | 500 | 0 | status, task id, waktu |
| body | 12,5–13 px | 400 | 0 | nama agen, feed |
| title | 15 px | 700 | 0 | judul panel |
| display | 22 px | 700 | −0,01em | angka KPI |

### 10.3 Radius, border, bayangan

Kaca: radius 12 (panel kecil) / 14 (roster) / 18 (bottom sheet). Border 1 px alpha 0,16–0,20. Highlight atas 1 px alpha 0,30–0,85 (mode terang lebih tegas). Bayangan: `0 18px 40px rgba(0,0,0,0.45)` untuk kaca, tanpa bayangan untuk elemen di dalam kanvas.

### 10.4 Tabel kontras lengkap — dua mode

Sumber tunggal: `docs/design/mockups/tokens.py` → `tokens.json`. Tabel ini mencakup **setiap** warna status dalam **dua perannya** (teks di kaca ≥ 4,5:1 dan dot/garis ≥ 3:1) untuk **kedua mode**, plus chip (teks di atas isian status). Total **78 pasangan, 0 gagal**.

| Mode | Pasangan | Rasio | Ambang |
|---|---|---|---|
| Terang | ink di atas kaca | 13,90 | 4,5 |
| Terang | ink-dim di atas kaca | 6,90 | 4,5 |
| Terang | muted di atas kaca | 5,18 | 4,5 |
| Terang | accent di atas kaca | 5,68 | 4,5 |
| Terang | status `working` teks / dot | 5,31 / 5,31 | 4,5 / 3,0 |
| Terang | status `reviewing` teks / dot | 6,02 / 6,02 | 4,5 / 3,0 |
| Terang | status `idle` teks / dot | 5,68 / 5,68 | 4,5 / 3,0 |
| Terang | status `blocked` teks / dot | 5,04 / 5,04 | 4,5 / 3,0 |
| Terang | status `offline` teks / dot | 5,38 / 5,38 | 4,5 / 3,0 |
| Terang | status `ok` teks / dot | 5,60 / 5,60 | 4,5 / 3,0 |
| Terang | status `danger` teks / dot | 5,48 / 5,48 | 4,5 / 3,0 |
| Terang | chip status (terendah, `blocked`) | 5,95 | 4,5 |
| Gelap | ink / ink-dim / muted / accent | 14,47 / 10,16 / 5,98 / 8,57 | 4,5 |
| Gelap | status teks terendah (`danger`) | 5,06 | 4,5 |
| Gelap | status dot terendah (`danger`) | 5,06 | 3,0 |
| Gelap | chip status terendah (`offline`) | 6,13 | 4,5 |
| Neon (alt.) | ink / ink-dim / muted / accent | 16,67 / 10,92 / 6,06 / 10,39 | 4,5 |
| Neon (alt.) | status teks terendah (`offline`) | 5,00 | 4,5 |
| Neon (alt.) | chip status terendah (`offline`) | 5,17 | 4,5 |

Dua catatan yang menentukan:

1. **Ambang 4,5:1 untuk warna status, bukan 3:1.** Warna status dipakai sebagai *kata* di roster ("working", "blocked"), jadi ia adalah teks biasa. Kalau hanya dinilai sebagai dot (3:1), tiga warna tema Terang akan lolos padahal tidak terbaca sebagai teks — persis kegagalan yang paling sering di tema terang.
2. **Kontras dihitung terhadap hasil komposit kaca**, bukan terhadap `#FFFFFF` atau `#000000`. Setiap mode mendeklarasikan dua latar ekstrem (gelap & terang) dan tabel melaporkan yang **terburuk**; itu sebabnya angka tema Terang lebih rendah dari tema Gelap meski paletnya terlihat "aman".

---

## 11. Tema mengikuti waktu lokal

**Aturan (mengikat).** Zona waktu dibaca dari `/api/config` → `tz` (sekarang `Asia/Jakarta`; jangan pernah menulis offset `+07:00` di kode). Jam lokal dihitung dengan `Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false })`. Jendela siang: **06:00 ≤ jam < 18:00 waktu lokal → Terang**, di luar itu **Gelap**. Batasnya konstanta bernama `DAY_START_HOUR = 6`, `DAY_END_HOUR = 18` di satu modul murni.

**Modul & uji.** `frontend/src/lib/theme.ts` (murni: tanpa React, tanpa DOM, tanpa `Date.now()` di dalam fungsi — pemanggil yang memberi `nowMs`). Uji headless: `verify/theme_check.ts`, dijalankan seperti check lain:

```
frontend/node_modules/.bin/esbuild verify/theme_check.ts --bundle --format=esm --platform=node --outfile=/tmp/theme_check.mjs
node /tmp/theme_check.mjs        # 23 pemeriksaan, "THEME OK", exit 0
```

Yang diuji: `05:59 → gelap`, `06:00 → terang`, `17:59 → terang`, `18:00 → gelap`, tengah malam (`00:00`, `23:59`) → gelap; override `day` menang pada 23:00 dan `night` menang pada 12:00; `?theme=day|night|auto` terurai, `?theme=bogus`/absen → `null`; `tz` tidak dikenal → fallback `Asia/Jakarta` (sumber `fallback-tz`); dan zona ber-DST (`Europe/Amsterdam`) benar di kedua sisi transisi (CET ↔ CEST) pada 06:30 dan 05:30.

**Urutan keputusan.** override manual (toggle HUD, disimpan di `localStorage`) → `?theme=` di URL → otomatis dari `tz` → `prefers-color-scheme` **hanya** bila `tz` tidak ada dan tidak ada override. Jam kantor menang atas preferensi OS, karena tema ini mengikuti "siang di Jakarta", bukan siang di perangkat pembaca.

**Satu sumber waktu.** Yang dipakai adalah `now` dari `/api/status` (waktu server), bukan jam perangkat. Alasannya konkret: jam laptop yang basi 3 jam akan membuat kantor tampil gelap pada pukul 09:00. Kalau `now` server belum tersedia (fetch pertama gagal), **jangan** memakai jam perangkat — tahan tema terakhir (atau `prefers-color-scheme` saat boot) sampai `now` server datang.

**Tidak boleh berkedip.** Tema hanya diterapkan saat **static layer berikutnya di-render** (per lantai × tema), tidak pernah di tengah frame. Konsekuensinya: pergantian tema paling lambat terlihat satu frame setelah detik batas — tidak terasa, dan tidak ada kedipan putih.

**Skyline ikut waktu.** Siang: langit biru bergradien, matahari tinggi + halo, muka gedung kaca memantul, jendela sebagai refleksi (alpha 40–95), horizon tegas, bayangan furnitur tajam (blur 3 px). Malam: siluet, jendela menyala (alpha 80–165), kabut 22 %, bayangan lembut (blur 7 px). **Dua state transisi (subuh/senja) dipotong**, dan ini alasannya: aturan otomatis berbasis jam (bukan posisi matahari), jadi gradien subuh 20 menit hanya akan terlihat kalau palet diinterpolasi per menit — itu menambah 2 set palet × 3 lantai = 6 cache lagi dan membuat screenshot tidak deterministik. Gantinya murah: **crossfade 400 ms** antara dua cache (satu komposit tambahan) tepat di 06:00 dan 18:00, cukup untuk menghilangkan "kaget" tanpa mesin waktu.

**Cache per (lantai × tema).** Static layer (denah + kota + furnitur, tanpa avatar) di-cache per pasangan: 3 lantai × 2 tema = **6 cache** (Neon, kalau diaktifkan, jadi 9). Ukuran: satu layer 768×576 @ DPR 2 ≈ 3,5 MB, jadi 6 cache ≈ 21 MB — masih di bawah anggaran memori tab biasa, tetapi tidak gratis; karena itu cache di-cap LRU 6 dan di-invalidasi saat: tema berganti, resize/DPR berubah, atau data roster berubah bentuk (bukan tiap frame). Waktu bangun cache diukur sekali di Fase 2; kalau > 30 ms, bangun di `requestIdleCallback` setelah frame pertama tema lama.

**Determinisme screenshot.** `?still=1` **tidak boleh** bergantung jam dinding: tanpa `?theme=`, `?still=1` memakai tema hasil `resolveTheme` pada `now` server; dengan `?theme=day|night`, override eksplisit menang. Gate visual memakai `?theme=` supaya screenshot tidak berubah sendiri antara pagi dan malam.

**Kalau `tz` tidak valid atau tidak ada.** Dua kasus berbeda, dan keduanya harus ditangani berbeda: (1) `tz` **ada tetapi tidak dikenal** → `Intl` melempar `RangeError`, modul menangkapnya, memakai `Asia/Jakarta`, dan menandai `source: 'fallback-tz'`; (2) `tz` **tidak ada / kosong** → tidak ada jam kantor yang bisa dipakai, jadi tema jatuh ke `prefers-color-scheme` (`source: 'prefers-color-scheme'`). Backend sendiri sudah memvalidasi `OFFICE_TZ` saat boot (`LocationOf`), jadi kasus (1) hanya muncul kalau payload dipotong proxy atau versi API lebih tua.

---

## 12. Dari top-down ke view samping

**Alasan.** Pada denah top-down, dinding utara hanya strip 0,22 unit (≈7 px di zoom 2): kota tidak mungkin berada "di belakang dinding", jadi ia hanya bisa jadi hiasan di atas denah. Permintaan bos — kaca + pemandangan kota — baru masuk akal kalau scene digambar sebagai **elevasi/potongan gedung dilihat dari depan**: lantai jadi band horizontal, curtain wall kaca jadi bidang vertikal, kota besar di belakangnya, meja dan orang terlihat dari depan/samping.

**Pemetaan data.** Koordinat sekarang `(x, z)` per lantai. Di view samping `x` tetap horizontal layar, dan `z` berubah peran menjadi **kedalaman**. Dua opsi:

| Opsi | Cara | Kelebihan | Kekurangan |
|---|---|---|---|
| **(a) elevasi murni** | `z` hanya menentukan urutan gambar | paling murah (0 perubahan data), komposisi paling "bersih" | dua agen dengan `x` sama saling menimpa → ambigu; L3 punya **3 pasangan** seperti itu |
| **(b) elevasi 2.5D (baris + slot)** | `z` → salah satu dari **2 baris** (depan/belakang); baris belakang punya offset vertikal + skala lebih kecil, **dan** tiap agen dapat slot horizontal sendiri | kedalaman tidak hilang, tabrakan `x` benar-benar terpisah, tetap terbaca sebagai view samping | perlu aturan baris + slot + skala per baris; satu tingkat kesulitan baru di hit-test |

**Rekomendasi: (b).** Bukti dari data L3 (bukan dugaan): `coder (-1,62; -0,78)` vs
`coder2 (-1,62; 0)`, `planner (0; 0)` vs `reviewer (0; -0,78)`, `uiux (1,62; 0)` vs
`tester (1,62; -0,78)` — tiga pasang agen menempati `x` yang sama. Dengan opsi (a)
mereka bertumpuk persis dan satu agen hilang dari pandangan. **Offset vertikal saja
juga belum cukup** — itu terbukti di mockup: offset 24 px tidak memisahkan dua label
selebar 62 px yang pusatnya sama, sehingga 8 agen hanya tampil sebagai 4 posisi.
Yang dipakai adalah baris **plus slot horizontal** (lihat §12.1).

**Aturan baris yang dipakai di mockup.**

| Baris | Skala | Offset y | Tinggi avatar | Agen L3 |
|---|---|---|---|---|
| **Belakang** (jauh) | 0,94 | 0 px (garis lantai 596) | 141 px | DIMAS, YOGA, SARI (z −0,78), WAHYU (z −6,2) |
| **Depan** (dekat) | 1,00 | +44 px (garis lantai 640) | 150 px | BIMA, BAGAS, RAKA, LARAS (z ≥ −0,39) |

Catatan penting: pitch `z` di data hanya 0,78 unit, jadi pemetaan **tidak boleh**
memakai pembagian linier `z → baris` apa adanya (semua meja island akan jatuh di
satu baris). Yang dipakai: urutkan agen menurut `z` menurun, separuh pertama
menjadi baris depan — deterministik, dan untuk L3 hasilnya persis pemisahan yang
dipakai dokumen ini sejak awal (z ≥ −0,39 vs z ≤ −0,78).

### 12.1 Dua baris 4+4 + slot horizontal

Mockup pertama membuktikan offset vertikal saja tidak cukup: 8 agen L3 hanya tampil
sebagai **4 posisi** karena DIMAS+BAGAS, YOGA+RAKA, dan SARI+LARAS punya pusat `x`
identik dan labelnya menumpuk. Mockup ketiga menambah masalah kedua: pada avatar
150 px, delapan slot sebaris butuh 8 × 200 = 1400 px — lebih lebar dari kanvas
1000 px. Jadi dua aturan, keduanya dijalankan `side_rows()` + `side_slots()`:

1. **dua baris 4+4** dari `z` (lihat tabel di atas), baris belakang digambar dulu;
2. di dalam satu baris, urutan kiri→kanan tetap urutan `x` dunia `rooms.ts`;
3. tiap baris memakai grid **200 px** per slot (4 slot = 600 px), baris belakang
   digeser **setengah pitch (100 px)** supaya kedua baris saling mengunci — badan
   baris belakang terlihat di sela baris depan, bukan tertutup;
4. grid digeser 30 px ke kiri dari tengah supaya rak server masih punya tempat;
5. label 24 px duduk **8 px** di atas kepala; kalau bentrok, plate naik 27 px per
   langkah dengan garis penghubung 1 px.

Hasil terukur di L3:

| Baris | Slot x |
|---|---|
| Depan | BIMA **170** · BAGAS **370** · RAKA **570** · LARAS **770** |
| Belakang | DIMAS **270** · YOGA **470** · SARI **670** · WAHYU **870** |

Jarak pusat minimum **200,0 px** sebaris dan **100,0 px** antar baris. Label terlebar
70 px, jadi dua label butuh ≥ 70 px — 100 px lolos dengan 30 px napas.

**Gate keras `side_gate()`** (dijalankan sebelum render, L1/L2/L3, mencetak angka):

| Aturan | Hasil terukur L3 |
|---|---|
| label ↔ label bertumpuk | **0** dari 8 label |
| label ↔ kotak kepala agen lain | **0** |
| overlap bbox avatar vs avatar (≤ 20 % dari yang lebih kecil) | **0,0 %** dari 28 pasang |
| jarak pusat dua agen **sebaris** | **200,0 px** (minimum 180 px) |
| jarak plat ↔ kepala (terukur) | **8,0 px** (minimum) |

Kalau salah satu aturan dilanggar, renderer berhenti dengan nama agennya — bukan
sekadar peringatan, supaya mockup tidak bisa "lulus" dengan label bertumpuk.

**Dampak teknis.**

| Aspek | Sekarang (top-down) | View samping 2.5D |
|---|---|---|
| Nav graph | graf 2D `NAV` (node `x,z` + edge) | tetap graf 2D untuk pathfinding, tetapi render memakai **koridor 1D per baris**; agen yang berpindah baris memakai satu edge "tangga" dan offsetnya diinterpolasi 120 ms |
| Hit-test klik | `nearestAt(x,z)` di bidang | `x` → kandidat terdekat; kalau > 1 kandidat, pilih baris dengan `y` terdekat; radius klik 24 px, baris terdekat menang |
| Nameplate | di atas kepala (top-down = di atas sprite) | kepala sekarang di `floor_y − avatar_h × skala_baris`; plate 24 px di atas itu, jarak tetap **8 px**, ditumpuk ke atas bila bentrok, dengan garis penghubung 1 px (gate: 0 overlap, 0 kepala tertutup) |
| Urutan gambar | z-sort naik | baris belakang → baris depan, lalu `x`; papan dinding digambar sebelum agen |
| Lift | kotak 2,6×3,2 di denah | naik-turun **vertikal** antar band lantai — animasi 400 ms ease-in-out, pintu 160 ms, indikator lantai di header ikut berubah; ini justru lebih natural dari sekarang |
| Zoom/pan | bebas 2 arah | pan **horizontal dominan**; vertikal dikunci (hanya 2 baris), zoom mengubah px/unit horizontal |

**Uji kelayakan (diukur di mockup 1280×800, kanvas 1000×688).**

| Pertanyaan | Jawaban terukur |
|---|---|
| Tinggi band per lantai | atap **40 px** · soffit 18 px · **kaca 485 px (di dalam ruangan)** · ruangan **548 px** lantai→plafon · floor plane 60 px · slab 40 px = **688 px** (pas kanvas) |
| Berapa baris yang masih terbaca | **2** (4 depan + 4 belakang), baris belakang +44 px di layar dan skala 0,94; baris ke-3 tidak muat — 12 slot × 200 px melewati kanvas |
| Apakah 8 agen L3 muat | **ya** — grid **200 px** per baris (4 slot = 600 px), baris belakang digeser **100 px**; overlap bbox avatar **0,0 %**, 0 label bertabrakan, 0 kepala tertutup |
| Tinggi avatar & meja | avatar **150 px** (baris depan) / **141 px** (belakang ×0,94) · meja 94 px dari garis lantai, lebar 128 px, tebal 17 px · monitor 42×30 px dengan stand 8 px |
| Konsekuensi kamera | view samping **adalah potongan**, bukan seluruh lantai; UI harus menyebut "potongan L3" dan pan horizontal menggantikan pan 2 arah |

### 12.2 Proporsi: verdict bos, dijawab dengan angka

Verdict bos, dua kali, dan dua-duanya benar:

1. **"avatar terlihat kecil, sedangkan ruangnya tampak tinggi."** Mockup pertama:
   avatar 54 px di ruangan 286 px = **1:5,3**, kamera masih fit-to-width.
2. **"avatar terlihat kecil, ruangnya tampak tinggi"** (lagi, setelah perbaikan
   pertama). Mockup kedua mencetak **1:3,50 di atas kertas** — 88 px di "ruangan"
   308 px — tetapi yang diukur hanya lantai→soffit, sementara band skyline **252 px
   digambar di atas plafon**. Tinggi yang dilihat mata adalah lantai→puncak jendela
   ≈430–450 px, jadi rasio yang **dirasakan** ≈1:5,5–1:6, dan separuh atas kanvas
   dikuasai langit/kota. Angkanya benar; definisinya yang salah.

Perbaikan ketiga karena itu bukan "avatar dibesarkan sedikit", melainkan tiga
perubahan komposisi yang bisa diukur:

| Target brief | Angka yang dipakai | Terukur |
|---|---|---|
| kota terlihat **lewat jendela di dalam ruangan** | curtain wall = dinding belakang, kaca y 58–543 (dari 0,30 unit di atas lantai sampai plafon) | **485 px kaca = 88,5 % dinding**, skyline di belakang meja |
| ruangan mengisi kanvas, lantai→plafon 520–560 px | `SIDE_ROOM_H = 548` | **548 px** (termasuk jendela) |
| di atas plafon ≤ 40 px | `SIDE_ROOF_H = 40` (coping + slab + fascia) | **40 px**, tanpa band langit |
| avatar 135–180 px | `SIDE_PPU = 150` × 1,00 unit | **150 px** (depan) · **141 px** (belakang ×0,94) |
| rasio **dirasakan** 1:3–1:4 | turunan dari dua angka di atas | **1:3,65** (548 : 150) |
| 8 agen = dua baris 4+4 | `side_rows()` + `side_slots()`, grid 200 px, stagger 100 px | **4 + 4**, slot sebaris **200 px**, antar-baris **100 px** |
| 0 label bertabrakan / 0 kepala tertutup | `side_gate()` | **0 · 0**, overlap avatar **0,0 %**, jarak plat↔kepala **8 px** |
| dinding tidak kosong | `side_wall_gate()` | **0,0 %** bidang telanjang (batas 30 %) |

**Definisi yang mengikat (supaya tidak salah tafsir saat implementasi):**

> Tinggi ruangan = **lantai → plafon, termasuk band jendela**. Yang dihitung adalah
> `SIDE_ROOM_H = 548 px` (y 40 → 588), bukan tinggi dinding opak, bukan
> lantai→soffit. Rasio avatar selalu dihitung terhadap angka ini.

**Kenapa kamera harus tetap, bukan fit-to-width.** Kode lama membagi 960 px dengan
span meja 10,82 unit → 88,7 px/unit. Skala itu *keluaran* dari lebar kanvas, jadi
avatar dan ruangan ikut mengecil bersama dan rasionya tidak pernah bisa diperbaiki.
Sekarang skalanya konstanta (`SIDE_PPU = 150`), dan yang menyesuaikan adalah padding.
Karena slot horizontal kini memakai grid desain (bukan jarak dunia), koridor kosong
antara pulau dev dan sudut devops tidak perlu dipotong-potong lagi: urutan
kiri→kanan tetap urutan `x` `rooms.ts`, tetapi jaraknya seragam 200 px per baris.

**Dinding = kaca, papan digantung di depannya.** Enam papan (plakat zona L3 · TIM
DEV, papan status 6/8 dengan 8 titik + 4 chip, pinboard 9 catatan + burndown A4,
whiteboard arsitektur, jam dinding yang jarumnya ikut WIB tema, rak buku berangka)
tingginya **148 px ≈ 1,0 × avatar** dan digantung pada satu rail di y 124–132, di
**depan** kaca. Di atasnya 66 px kaca bersih (langit + puncak menara), di bawahnya
**263 px kaca bersih dengan kota tepat di belakang meja**. Ditambah 7 downlight di
soffit dan plinth di kaki dinding.

**Trade-off yang diambil sadar** (tidak bisa dipenuhi bersamaan):

1. **"Kota harus terlihat" vs "dinding diisi papan".** Kalau papan menutup seluruh
   dinding (papan 300 px, seperti percobaan sebelumnya), kota hilang dan masalah
   lama kembali. Yang dipegang: papan 148 px di zona atas, kaca 88,5 % dari dinding.
   Hierarki dijaga — papan adalah aksen, kota adalah latar.
2. **"Avatar 150 px" vs "8 slot dalam satu baris".** Delapan slot × 200 px = 1400 px,
   melewati kanvas 1000 px. Solusinya **dua baris 4+4** (600 px per baris), bukan
   mengecilkan avatar atau memaksa satu baris yang rapat. Baris belakang +44 px dan
   ×0,94 justru memperkuat kesan 2.5D.
3. **"Rasio 1:3–1:4" vs "sisa di atas kepala ±1 avatar".** Keduanya bertabrakan
   secara aritmetika: 1:3,65 berarti ~2,65 avatar tinggi ruang di atas kepala. Yang
   dipegang adalah angka eksplisit 1:3–1:4 (dan 30 % dinding kosong sebagai ukuran
   yang bisa digerbang); "±1 avatar" tidak mungkin tanpa merusak rasio itu.

**Yang tidak berubah:** avatar tetap clean-vector (di 150 px: **1477 warna unik,
100 % tepi siluet blending, 4956 piksel alpha parsial**, tidak pernah NEAREST), dua
tema tetap ikut WIB (jam dinding, chip tema dan HUD memakai waktu yang sama),
skyline tetap **satu lembar kaca menerus** tanpa seam (tidak ter-tile), rak buku
tetap berangka, dan tidak ada prop mengambang — rak rendah, meja, kursi, rak server,
dan tanaman semuanya berdiri di garis lantai barisnya.

**Risiko yang harus dijaga.** (1) Kedalaman bisa ambigu bila dua agen sebaris
berdekatan — mitigasi: grid 200 px sebaris + stagger 100 px + nameplate 24 px.
(2) Nameplate bertumpuk — mitigasi: gate keras (`side_gate()`), sudah berjalan di
mockup dan mencetak angka: 0 label↔label, 0 label↔kepala-agen-lain, overlap bbox
avatar ≤ 20 % (terukur 0,0 %), jarak pusat sebaris 200 px. (3) Sprite harus
digambar ulang untuk profil samping (meja, kursi, monitor, rak server) — biaya Fase
2, bukan tambahan di luar rencana. (4) Walkability tidak boleh ikut berubah:
`layout_check` tetap memakai graf 2D.

---

## 13. Daftar pustaka

1. MDN. *backdrop-filter CSS property.* https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter
2. Argyle, A. & Medley, J. *Create OS-style backgrounds with backdrop-filter.* web.dev. https://web.dev/articles/backdrop-filter
3. MDN. *CanvasRenderingContext2D: filter property.* https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/filter
4. MDN. *browser-compat-data* (api.CanvasRenderingContext2D.filter, css.properties.backdrop-filter, api.OffscreenCanvas, media.prefers-reduced-transparency). https://github.com/mdn/browser-compat-data
5. MDN. *Optimizing canvas.* https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas
6. Microsoft Learn. *Materials in Windows.* https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/materials
7. Microsoft Learn. *Acrylic material.* https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic
8. Apple. *Human Interface Guidelines — Materials.* https://developer.apple.com/design/human-interface-guidelines/materials
9. Brown, M. *Glassmorphism: Definition and Best Practices.* Nielsen Norman Group, 7 Juni 2024. https://www.nngroup.com/articles/glassmorphism/
10. Budiu, R. *Liquid Glass Is Cracked, and Usability Suffers in iOS 26.* Nielsen Norman Group, 10 Oktober 2025. https://www.nngroup.com/articles/liquid-glass/
11. *Simplify paint complexity and reduce paint areas.* web.dev. https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas
12. *Parallaxin'.* web.dev. https://web.dev/articles/speed-parallax
13. *CSS prefers-reduced-transparency.* Chrome for Developers. https://developer.chrome.com/blog/css-prefers-reduced-transparency
14. MDN. *prefers-reduced-transparency CSS media feature.* https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency
15. W3C. *Understanding SC 1.4.3: Contrast (Minimum).* https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
16. W3C. *Understanding SC 1.4.11: Non-text Contrast.* https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
17. W3C. *Understanding SC 1.4.1: Use of Color.* https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
18. Material Design 3. *Spacing.* https://m3.material.io/styles/spacing
19. Wikipedia. *Aerial perspective.* https://en.wikipedia.org/wiki/Aerial_perspective
20. Meres, M. *@marianmeres/cityscape — Spec & Architecture* (MIT). https://github.com/marianmeres/cityscape/blob/master/docs/SPEC.md
21. CSS-Tricks. *blur().* https://css-tricks.com/almanac/functions/b/blur/
22. W3C. *Filter Effects Module Level 2 — BackdropFilterProperty.* https://drafts.fxtf.org/filter-effects-2/#BackdropFilterProperty
23. DejaVu Fonts. *License.* https://dejavu-fonts.github.io/License.html

---

### Lampiran artefak

| Artefak | Path |
|---|---|
| Mockup **view samping** — tema Terang (L3) | `docs/design/mockups/l3-side-day.png` (1280×800) |
| Mockup **view samping** — tema Gelap (L3) | `docs/design/mockups/l3-side-night.png` (1280×800) |
| Mockup mobile — Terang / Gelap | `docs/design/mockups/l3-side-mobile-day.png`, `l3-side-mobile-night.png` (390×844) |
| Referensi denah top-down (sebelum perubahan view) | `daylight-atrium.png`, `sky-lobby.png`, `lobby-daylight.png`, `edu-daylight.png`, `sky-lobby-mobile.png`, `daylight-mobile.png` |
| Neon Metro (alternatif) | `docs/design/mockups/neon-metro.png` (1280×800) |
| Perbandingan scene-tech (top-down) | `docs/design/mockups/scene-tech-compare.png` (1280×800) |
| Avatar sebelum/sesudah | `docs/design/mockups/avatar-before-after.png` (1280×640) |
| Token & kontras dua mode | `docs/design/mockups/tokens.py`, `tokens.json` (78 pasangan) |
| Renderer mockup | `docs/design/mockups/render_mockups.py` |
| Modul tema + uji | `frontend/src/lib/theme.ts`, `verify/theme_check.ts` |
| Benchmark blur | `docs/rnd/bench/glass_blur_bench.py`, `glass_blur_bench.json` |
| Spesifikasi desain | `docs/design/office-glass-city.md` |
| Laporan DOCX | `docs/rnd/RnD-Office-Glassmorphism.docx` |

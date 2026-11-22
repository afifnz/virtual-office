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
3. **Pemandangan kota tidak bisa "di belakang dinding" pada proyeksi top-down.** Dinding pada denah sekarang adalah strip 0,22 unit (≈7 px di zoom 2). Kota harus hidup di **band elevasi** di atas garis dinding utara (tambahan visual, bukan koordinat) dan di latar kanvas di luar denah. Ini temuan teknis yang mengubah komposisi, bukan sekadar selera.
4. **Avatar tidak lagi pixel-art.** Sesuai koreksi bos, avatar menjadi **clean vector** (path + gradien, anti-aliased). Biayanya bukan di render per frame — avatar tetap di-*cache* sebagai sprite — melainkan di **migrasi 13 `look`**, penggantian font label 5×7, dan pembaruan gate visual. Estimasi: 3–4 hari kerja untuk avatar saja, dan itu sudah termasuk gate.
5. **Rekomendasi: arah _Sky Lobby_** (dusk metropolis, kaca gelap frosted, aksen amber) dengan **scene all-vector** dan kaca dibatasi pada empat permukaan (HUD, tab lantai, roster, band jendela). Skor matriks 4,30 dari 5 — tertinggi, dengan risiko performa terendah dan kontras teks terbaik di antara tiga arah yang bisa dipertahankan.

Angka kunci (semua terukur, bukan karangan):

| Ukuran | Nilai | Sumber |
|---|---|---|
| Biaya blur panel 280×640 @ DPR 2, radius 12 px (CPU referensi) | 31,1 ms/frame | `docs/rnd/bench/glass_blur_bench.json` |
| Biaya panel yang sama bila blur di-cache | 0,10 ms/frame | idem |
| Kontras teks utama Sky Lobby di atas kaca | 14,5:1 (min 10,2:1 untuk teks sekunder) | `docs/design/mockups/tokens.json` |
| Kontras terburuk seluruh arah | 4,17:1 (status "working" Daylight, ambang 3:1) | idem |
| Chunk scene saat ini | 46.417 B (15.320 B gzip) | `frontend/dist/assets/Office2D-*.js` |
| Operasi gambar per avatar vector | 33 path/isi | hitung statis `render_mockups.py` |
| Bangun cache 8 avatar @50 px (CPU, supersample 3×) | 18,2 ms sekali | bench lokal |

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

Riset dilakukan dengan membuka sumber primer (dokumentasi platform, spesifikasi, pedoman aksesibilitas) dan sumber sekunder yang menyebut dirinya sebagai analisis. Setiap klaim di §4 dan §5 diberi nomor rujukan ke §11.

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

![Gambar 4 — Tiga tingkat non-pixel pada crop L3 yang sama: (a) avatar vector di atas scene pixel, (b) seluruh scene vector, (c) scene vector + kaca & kota penuh.](docs/design/mockups/scene-tech-compare.png,15.5)

### 5.4 Pemandangan kota: lapisan, tile, zoom, biaya

Rancangan yang diusulkan:

| Parameter | Nilai | Alasan |
|---|---|---|
| Jumlah lapisan parallax | **3** (jauh, tengah, dekat) + 1 lapisan langit | 4 lapis di mockup terbaca "ramai"; 3 cukup untuk kedalaman [19][20] |
| Ukuran tile | 256×96 px per lapisan, diulang horizontal | satu tile = satu `drawImage`; pola berulang tidak terlihat karena bangunan diacak per tile |
| Ikut zoom/pan? | **Tidak.** Band jendela tetap di tempatnya | kalau ikut zoom, jendela jadi 2–4× lebih besar dan bersaing dengan meja |
| Parallax saat pan | maksimum 6 px per 100 px pan, hanya lapisan tengah & dekat | cukup untuk kesan gerak, tidak memicu mabuk gerak |
| Biaya render | 3 `drawImage` + 1 veil per frame ≈ **0,02–0,05 ms** (estimasi, GPU) | band di-cache, bukan digambar ulang |
| Waktu hari | `dusk` default, `day`/`night` sebagai token | dusk = kontras kaca terbaik (§4.4) |

Pre-render sekali per (lantai × waktu-hari) → 3 lantai × 3 waktu = **9 kanvas offscreen** ukuran 768×96 @DPR 2 ≈ 0,6 MB total. Murah.

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
| Ukuran di layar | 12×16 world px → 24×32 CSS px @ zoom 2 | 1,4×0,9 unit → 45×29 CSS px @ zoom 2 (tinggi 50 px termasuk kepala) | ya (sedikit lebih besar, disengaja) |
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

Jumlah operasi gambar per avatar: **33** (dihitung statis dari modul mockup: 12 ellipse, 3 polygon, 6 line, 2 arc, 8 rounded-rect, 2 gradient fill). Ini bukan beban per frame karena di-cache — lihat 5.6.3.

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
| Bangun 8 avatar @50 px | **18,2 ms** (sekali) | sekali per (look, pose, frame) saat pertama muncul |
| Bangun 8 avatar @100 px | 65,6 ms (sekali) | untuk zoom 4 (retina) |
| Blit 8 sprite yang sudah di-cache | **0,06 ms** per frame | setara biaya sekarang |

Konsekuensi: **jangan** menggambar path avatar di dalam loop render. Simpan di cache sprite yang sudah ada (`getSprite`), key = `avatar:{hash(look)}:{pose}:{frame}:{dprBucket}`. Ruang cache maksimum: 13 look × 6 pose × 2 frame × 2 bucket = 312 sprite; pada 50×70 px @DPR 2 ≈ 4,4 MB — masih wajar, dan bisa di-cap dengan LRU 64 entri.

Estimasi bundle: chunk scene sekarang **46.417 B (15.320 B gzip)**. Modul avatar vector menggantikan `sprites.ts` (19,9 KB sumber); perkiraan **+2–4 KB raw / +1–1,5 KB gzip** — estimasi, belum diukur dengan build.

#### 5.6.4 Bukti visual sebelum/sesudah

![Gambar 5 — Avatar sebelum/sesudah: 12×16 pixel (atas) dan clean vector 150 px (bawah) untuk delapan look L3 yang sama.](docs/design/mockups/avatar-before-after.png,15.5)

Delapan look L3 yang sama, atas = rekonstruksi 12×16 pixel sekarang, bawah = avatar vector 150 px. Perbedaan yang terbaca: siluet (bahu, leher, sepatu), rambut (bun/long/messy/side), aksesori (kacamata berbingkai + lensa, headphone dengan ear cup), dan ekspresi (alis datar, mulut melengkung halus).

Mockup tiga arah memakai avatar vector ini di 8 meja L3 — bisa dinilai bos tanpa membuka Figma.

---

## 6. Tiga arah desain

Semua arah memakai: grid 8 pt, tiga tingkat tipografi, satu aksen, status = warna + teks, nameplate hampir opaque (alpha 0,90–0,92), avatar clean vector, dan band jendela kota 96 px di atas dinding utara. Yang berbeda: waktu hari, tint kaca, aksen, dan seberapa "berani" kotanya.

### 6.1 Sky Lobby — dusk metropolis, kaca gelap frosted, aksen amber

**Konsep.** Kantor di lantai atas saat matahari turun: langit masih menyimpan gradien (ungu → jingga), kota sudah menyalakan jendela. Kaca gelap frosted menahan silau, amber menandai hal yang hidup. Ini arah yang paling dekat dengan identitas sekarang (dark, amber, concrete) sehingga risiko desainnya paling kecil.

**Palet (token lengkap):**

| Token | Hex | Pemakaian |
|---|---|---|
| `surface` | `#141B2E` @ 0,62 | isian kaca |
| `surface-solid` | `#141B2E` | fallback reduced-transparency |
| `page` | `#080C16` | latar halaman |
| `floor` | `#1A2230` | slab L3 |
| `wall` | `#121A29` | dinding, HUD, toolbar |
| `desk` / `desk-top` | `#243044` / `#39485F` | meja |
| `ink` | `#F2F5FA` | teks utama |
| `ink-dim` | `#C6D0E0` | teks sekunder |
| `muted` | `#93A0B6` | metadata |
| `accent` | `#F0B45A` | tab aktif, aksi |
| `accent-ink` | `#1A1206` | teks di atas aksen |
| `border` | `#FFFFFF` @ 0,16 | garis tepi kaca |
| `highlight` | `#FFFFFF` @ 0,30 | inner highlight 1 px |
| kota | `#0C1222 → #2B3350 → #8A5560 → #E0A06A` | langit dusk |
| bangunan | `#0E1626 / #16203A / #1D2A47 / #26344F` | 4 lapisan |
| jendela | `#F3C57B`, `#9FD8E8` | hangat + dingin |

**Kontras terukur (terburuk dari dua latar ekstrem):** ink 14,47:1 · ink-dim 10,16:1 · muted 5,98:1 · aksen 8,57:1 · status terendah 5,06:1 (danger) · chip text terendah 6,13:1. Semua lolos AA.

**Tipografi.** system-ui/Inter; label 11 px 600 uppercase +0,08em; body 12,5 px; judul 15 px 700; angka tabular untuk waktu/task id.

**Perlakuan kaca.** Radius 12–14 px, blur 16–18 px (hanya di chrome), tepi 1 px alpha 0,16, highlight atas alpha 0,30, noise 4 %. Tidak ada kaca di dalam kanvas selain band jendela.

**Latar kota.** Dusk, 4 lapisan di mockup (produksi 3), jendela alpha 80–165, veil 22 % agar tidak bersaing dengan dot status.

**Sprite.** Scene all-vector, avatar vector, label anti-aliased. Ikon status tetap dot + teks.

![Gambar 1 — Sky Lobby, L3 Tim Dev, 1280×800. Band jendela kota dusk di atas dinding utara; kaca hanya di HUD, tab, roster, dan zoom.](docs/design/mockups/sky-lobby.png,15.5)

**Contoh layar.** `docs/design/mockups/sky-lobby.png` · mobile `docs/design/mockups/sky-lobby-mobile.png`.

### 6.2 Daylight Atrium — siang terang, kaca putih susu, aksen biru

**Konsep.** Atrium dengan curtain wall: cahaya siang, kaca susu, kota biru pucat di luar. Paling "clean" dan paling ramah untuk monitoring seharian; juga yang paling sulit, karena kaca putih di atas lantai terang butuh pemisahan ekstra (bayangan + outline).

**Palet:** `surface #FFFFFF @ 0,66` · `surface-solid #F7FAFD` · `page #EEF3F8` · `floor #E3EAF2` · `wall #DDE6F0` · `desk #FFFFFF` / `desk-top #F2F6FA` · `ink #16202E` · `ink-dim #41506A` · `muted #556377` · `accent #1D4ED8` · `accent-ink #FFFFFF` · `border #0F2440 @ 0,20` · `highlight #FFFFFF @ 0,85` · langit `#A9CBE8 → #CFE3F3 → #E8F3FB → #F7FBFF` · bangunan `#B9CBDE / #A6BACF / #93A9C1 / #7F97B1`.

**Kontras terukur:** ink 13,90:1 · ink-dim 6,90:1 · muted 5,18:1 · aksen 5,68:1 · status dot terendah 4,17:1 (working) · chip text terendah 4,92:1. (Versi pertama gagal di 3 pasangan — muted 4,18, aksen 4,38, chip offline 3,64 — lalu token digelapkan; ini contoh kenapa tabel kontras harus dihitung, bukan dikira-kira.)

**Tipografi.** Sama, tetapi body 13 px dan bobot label 600 → 500 agar tidak terasa "berteriak" di latar terang.

**Perlakuan kaca.** Kaca putih 0,66, blur 20 px, border 0,20 (lebih tegas), bayangan 72/255 (lebih dalam). Ini satu-satunya arah yang butuh outline pada furnitur putih.

**Latar kota.** Siang; bangunan lebih gelap dari langit supaya siluet terbaca; jendela hampir putih (alpha rendah).

**Sprite.** Scene all-vector; ini arah yang paling menuntut kualitas gambar karena tidak ada gelap yang menyembunyikan detail.

![Gambar 2 — Daylight Atrium, L3 Tim Dev, 1280×800. Kaca putih susu, aksen biru, outline furnitur untuk memisahkan putih dari lantai terang.](docs/design/mockups/daylight-atrium.png,15.5)

**Contoh layar.** `docs/design/mockups/daylight-atrium.png`.

### 6.3 Neon Metro — malam, kota neon, kaca gelap dengan tepi bercahaya

**Konsep.** Kantor di kawasan bisnis yang tidak pernah tidur: hitam pekat, neon cyan/magenta, kaca hitam dengan tepi menyala. Paling dramatis dan paling "berani", tetapi juga paling berisiko untuk keterbacaan status dan performa (glow = beberapa lapis blur).

**Palet:** `surface #0B0E1C @ 0,70` · `surface-solid #0B0E1C` · `page #04050B` · `floor #0C1020` · `wall #0A0C18` · `desk #141A30` / `desk-top #1E2742` · `ink #EAF2FF` · `ink-dim #B9C6E0` · `muted #8493B0` · `accent #22D3EE` · `accent-ink #04141A` · `border #22D3EE @ 0,45` · `highlight #67E8F9 @ 0,40` · langit `#04040C → #0B0B22 → #2A0F3A → #7A1E5A` · bangunan `#080A14 / #0D1022 / #141833 / #1C2145` · jendela `#67E8F9`, `#F472B6`.

**Kontras terukur:** ink 16,67:1 · ink-dim 10,92:1 · muted 6,06:1 · aksen 10,39:1 · status dot terendah 5,00:1 · chip text terendah 5,17:1. Kontras bagus — masalahnya bukan kontras teks, melainkan **beban visual** (glow) dan kelelahan mata.

**Tipografi.** Sama + angka monospace untuk waktu/counter (memberi kesan "kontrol room").

**Perlakuan kaca.** Kaca hitam 0,70, border cyan 0,45, glow luar 1 lapis (bukan 3), blur 14 px.

**Latar kota.** Malam; jendela neon dua warna; glow horizon magenta. Risiko: titik terang bersaing dengan dot status → alpha jendela diturunkan ke 80–140 dan glow dibatasi 1 lapis.

**Sprite.** Scene all-vector dengan rim-light tipis di tepi atas meja.

![Gambar 3 — Neon Metro, L3 Tim Dev, 1280×800. Kaca hitam, tepi cyan, glow dibatasi satu lapis.](docs/design/mockups/neon-metro.png,15.5)

**Contoh layar.** `docs/design/mockups/neon-metro.png`.

---

## 7. Matriks keputusan & rekomendasi

Bobot ditetapkan sebelum menilai (agar tidak menyesuaikan diri dengan hasil): keterbacaan status 25 %, biaya implementasi 20 %, risiko performa 15 %, kesan "modern clean" 20 %, konsistensi dengan data/token yang ada 10 %, aksesibilitas 10 %.

| Kriteria (bobot) | Sky Lobby | Daylight Atrium | Neon Metro |
|---|---|---|---|
| Keterbacaan status (25 %) | 4 | **5** | 3 |
| Biaya implementasi (20 %) | **5** | 2 | 4 |
| Risiko performa (15 %) | 4 | 4 | 3 |
| Kesan "modern clean" (20 %) | 4 | **5** | 3 |
| Konsistensi data & token (10 %) | **5** | 3 | 4 |
| Aksesibilitas (10 %) | 4 | **5** | 2 |
| **Skor berbobot** | **4,30** | 4,05 | 3,20 |

Perhitungan: Sky = 0,25·4 + 0,20·5 + 0,15·4 + 0,20·4 + 0,10·5 + 0,10·4 = 4,30. Daylight = 4,05. Neon = 3,20.

Matriks kedua, untuk pertanyaan "seberapa jauh scene ikut non-pixel" (avatar sudah pasti vector):

| Tingkat | Koherensi visual | Biaya | Risiko | Catatan |
|---|---|---|---|---|
| (a) hibrida: avatar vector + scene pixel | 2 | **5** | 4 | hanya untuk transisi 1 rilis; tabrakan gaya terlihat di `scene-tech-compare.png` |
| (b) scene all-vector | **5** | 2 | 4 | target akhir untuk Sky Lobby |
| (c) (b) + kaca & kota penuh | **5** | 1 | 3 | dipilih, dengan batas: kaca maks 4 permukaan, blur hanya di chrome |

### Rekomendasi

**Sky Lobby, scene all-vector, kaca & kota penuh dengan anggaran kaca.**

Alasan:

1. **Kontras & keterbacaan terbaik yang bisa dipertahankan tanpa mengubah token status.** Palet dark+amber sudah ada di `palette.ts` dan `global.css`; tidak perlu mode terang baru (Daylight menuntut palet status versi terang — risiko drift antara kanvas dan panel).
2. **Kota dusk adalah latar terbaik untuk kaca.** Langit masih bergradien (kaca jadi terlihat) tetapi tidak seterang siang (teks tetap aman).
3. **Biaya paling rendah di antara tiga arah** yang sama-sama all-vector: hanya menambah band jendela + kaca chrome, tanpa mengubah geometri, lift, tab, atau kontrak API.
4. **Ia arah yang paling mudah dihentikan.** Kalau setelah Fase 2 hasilnya jelek, kita berhenti dengan scene vector + panel solid — masih lebih baik dari sekarang.

**Yang TIDAK berubah** (kontrak yang dijaga):

- koordinat: `frontend/src/lib/rooms.ts` (meja, `LIFT`, `POIS`, `NAV`, `SPOTS`) — nol perubahan;
- kontrak API `/api/status` dan `__office2dFloors()`;
- lift: shaft 2,6×3,2, pintu barat, indikator lantai di header;
- tab lantai: 3 tab, `?floor=` di URL, keyboard access;
- privasi: tidak ada isi pesan/judul tugas di kanvas maupun panel;
- gate: `go vet`/`go test`, `tsc --noEmit`, `npm run build`, `verify/e2e_review.sh`, plus gate visual yang di-update (bukan dihapus).

**Yang berubah (dan harus disetujui bos):** avatar jadi vector, font label jadi anti-aliased, tab lantai pindah ke baris HUD (agar band jendela tidak tertutup), dan satu permukaan kaca baru (roster) yang kini boleh ber-blur.

![Gambar 6 — Sky Lobby di 390×844: bottom sheet kaca, tab lantai di atas sheet, scene tetap terlihat.](docs/design/mockups/sky-lobby-mobile.png,7.6)

---

## 8. Rencana implementasi bertahap

Prinsip: **setiap fase bisa berhenti** dan produksi tetap jalan. Tidak ada fase yang menyentuh `backend/` atau kontrak API.

| Fase | Isi | Gate (harus hijau untuk lanjut) | Estimasi | Rollback |
|---|---|---|---|---|
| **0 — Spike** | token Sky Lobby di satu blok CSS; band jendela kota (pre-render) di L3; flag `?skin=glass`; bench fps di laptop + HP | fps ≥ 60 desktop / ≥ 30 HP dengan band aktif; tidak ada perubahan visual saat flag mati; screenshot + verdict `vision_analyze` | **1–2 hari** | hapus flag + blok CSS (1 commit) |
| **1 — Avatar vector** | `avatar.ts`, cache sprite, label anti-aliased, plate baru; 13 look dimigrasi | `visual_check` (plate tidak overlap, nama utuh, tidak keluar kanvas) + `office2d_probe` hijau; before/after screenshot disetujui | **3–4 hari** | revert modul + panggil `drawAgent` lama (2 file) |
| **2 — Scene vector** | meja, kursi, furnitur, dinding, lift, prop; hapus `fillRect` chibi; zoom 3–4 tetap tajam (DPR-aware) | semua gate visual + `layout_check` (walkability tidak berubah); fps tidak turun > 10 % | **3–5 hari** | flag per-elemen (`?scene=pixel`) selama 2 rilis |
| **3 — Kaca & polish** | roster/tab/HUD kaca, `backdrop-filter` + fallback, `data-contrast`, reduced-motion/transparency, dokumentasi | audit kontras otomatis (semua pasangan ≥ ambang), fps, screenshot 3 lantai + mobile | **2–3 hari** | matikan blok kaca (CSS-only) |

Total: **9–14 hari kerja**. Titik berhenti yang disarankan: akhir Fase 1 (avatar saja sudah memenuhi koreksi bos) dan akhir Fase 2 (scene bersih tanpa kaca).

**Kapan harus berhenti karena hasilnya jelek** (kriteria eksplisit):

- Fase 0: fps desktop < 55 dengan band aktif, atau band membuat teks kanvas sulit dibaca → kembalikan kota ke latar luar denah saja.
- Fase 1: avatar vector terbaca "boneka" pada 50 px di zoom 2 (uji 5 orang) → naikkan tinggi ke 56 px atau sederhanakan detail, jangan lanjut ke scene.
- Fase 2: meja vector menghilangkan keterbacaan zona (papan sprint, rak server) → pertahankan furnitur pixel untuk prop, vector hanya untuk avatar + meja.
- Fase 3: dua permukaan kaca ber-blur membuat fps HP < 30 → kaca hanya di roster, tab/HUD solid.

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

### 10.4 Tabel kontras lengkap

Lihat `docs/design/mockups/tokens.json` (dihasilkan `tokens.py`) — 60 pasangan, semua ≥ ambangnya. Ringkasan terburuk per arah:

| Arah | teks utama | teks sekunder | muted | aksen | status dot (≥3:1) | chip text |
|---|---|---|---|---|---|---|
| Sky Lobby | 14,47 | 10,16 | 5,98 | 8,57 | 5,06 | 6,13 |
| Daylight Atrium | 13,90 | 6,90 | 5,18 | 5,68 | 4,17 | 4,92 |
| Neon Metro | 16,67 | 10,92 | 6,06 | 10,39 | 5,00 | 5,17 |

---

## 11. Daftar pustaka

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
| Mockup Sky Lobby | `docs/design/mockups/sky-lobby.png` (1280×800) |
| Mockup Daylight Atrium | `docs/design/mockups/daylight-atrium.png` (1280×800) |
| Mockup Neon Metro | `docs/design/mockups/neon-metro.png` (1280×800) |
| Mockup mobile (Sky Lobby) | `docs/design/mockups/sky-lobby-mobile.png` (390×844) |
| Perbandingan scene-tech | `docs/design/mockups/scene-tech-compare.png` (1280×800) |
| Avatar sebelum/sesudah | `docs/design/mockups/avatar-before-after.png` (1280×640) |
| Token & kontras | `docs/design/mockups/tokens.py`, `tokens.json` |
| Benchmark blur | `docs/rnd/bench/glass_blur_bench.py`, `glass_blur_bench.json` |
| Spesifikasi desain | `docs/design/office-glass-city.md` |
| Laporan DOCX | `docs/rnd/RnD-Office-Glassmorphism.docx` |

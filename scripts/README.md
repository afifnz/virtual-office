# scripts/ — alat operasional

## `probe-models.py` — uji function calling sebelum ganti model profil

Katalog 9router/InferHub hanya memberi **harga dan konteks**, bukan kemampuan tool. Model yang
tidak bisa memanggil tool bukan model yang lebih murah, tapi agen yang rusak. Skrip ini menguji
tiga tahap per model, langsung lewat router:

| Uji | Yang dikirim | Lulus bila |
|---|---|---|
| **T1** tool tunggal | `tools=[read_file]`, prompt menyuruh membaca `/etc/hostname` | ada `tool_calls` dengan nama `read_file` dan `arguments` JSON berisi `path` |
| **T2** dua tool berurutan | hasil tool pertama berisi `ROOT=/srv/team-alpha`, lalu diminta `list_dir` | `list_dir` dipanggil dengan path **dari hasil tool**, bukan path karangan |
| **T3** kepatuhan hasil tool | token acak `ZZ-NNNN` hanya ada di pesan `tool` | token disebut **persis**; menangkap model yang mengabaikan hasil tool |

Selain verdict, skrip mencetak latensi (median 3 percobaan bila T1 lulus), `usage.prompt_tokens` /
`completion_tokens` bila dikirim router, dan **error mentah** (status HTTP, `error.type`,
`error.code`, `error.message`) — bukan ringkasan "gagal".

### Menjalankan di host (router 9router ada di host, bukan di sandbox)

```bash
PROBE_BASE_URL=http://127.0.0.1:20128/v1 PROBE_API_KEY=$KEY \
  python3 scripts/probe-models.py
```

Model tertentu, simpan hasil JSON:

```bash
PROBE_BASE_URL=http://127.0.0.1:20128/v1 PROBE_API_KEY=$KEY \
  python3 scripts/probe-models.py --models inferhub/kimi-k2.5 --json /tmp/probe.json
```

Exit code `0` hanya bila **semua** model lulus T1+T2+T3. Tanpa router sama sekali:
`python3 scripts/probe-models.py --self-test` (menjalankan mock [OI]-compatible di dalam proses).

## Seluruh katalog: dua fase, bukan satu sapuan

Katalog InferHub berisi **512 entri (~316 nama model teks unik)**. Tiga tahap penuh ≈ 7 request per
model, jadi menyapu semuanya sekaligus berarti ribuan request dan berjam-jam — sebagian besar
terbuang pada model yang bahkan tidak bisa memanggil tool. Karena itu ada dua fase, keduanya
resumable:

### Fase 1 — smoke seluruh katalog (1 request per model)

```bash
PROBE_BASE_URL=http://127.0.0.1:20128/v1 PROBE_API_KEY=$KEY \
  python3 scripts/probe-models.py --from-catalog --stage 1 \
      --concurrency 4 --jsonl /tmp/probe-all.jsonl --summary-json /tmp/probe-all.summary.json
```

`--stage 1` hanya mengirim **satu** T1 per model: "bisa function calling sama sekali?". Tidak ada
pengulangan latensi, tidak ada T2/T3. Proses boleh dimatikan kapan saja; jalankan ulang dengan
`--resume` dan model yang sudah tercatat di JSONL dilewati tanpa request baru.

### Fase 2 — hanya yang lulus fase 1, uji penuh

```bash
PROBE_BASE_URL=http://127.0.0.1:20128/v1 PROBE_API_KEY=$KEY \
  python3 scripts/probe-models.py --from-jsonl /tmp/probe-all.jsonl \
      --stage all --concurrency 4 --jsonl /tmp/probe-full.jsonl --resume
```

`--from-jsonl` memilih **hanya** model yang `passed` di berkas fase 1, lalu menjalankan T1+T2+T3.
Berkasnya berbeda dari fase 1 supaya rekaman fase 1 tetap utuh sebagai bukti.

### Flag

| Flag | Arti |
|---|---|
| `--from-catalog` | ambil daftar dari `GET {PROBE_BASE_URL}/models` (`{"data":[{"id":…}]}`), pakai `id` apa adanya |
| `--from-jsonl PATH` | probe hanya model yang lulus di JSONL sebelumnya (fase 2) |
| `--filter REGEX` / `--exclude REGEX` | saring id dengan `re.search`, `--exclude` diterapkan setelah `--filter` |
| `--stage {1,2,all}` | `1` = T1 saja (1 request/model); `2`/`all` = perilaku penuh (default) |
| `--concurrency N` | model paralel, 1–16, default 4; tabel tetap urut katalog |
| `--jsonl PATH` | satu baris JSON per model selesai, di-append + di-flush + fsync segera |
| `--resume` | lewati model yang sudah ada di `--jsonl` (butuh `--jsonl`) |
| `--retry-failed` | dengan `--resume`: probe ulang yang sebelumnya gagal |
| `--summary-json PATH` | jumlah per status sebagai JSON |
| `--retry-delay S` | basis backoff eksponensial untuk 429/5xx (default 1.0, berlipat 2×, menghormati `Retry-After`) |
| `--max-tokens N` | default 256 — probe hanya butuh tool call, bukan prosa |

### Ringkasan status

Akhir proses mencetak, dan `--summary-json` menyimpan:

```
summary (12.4s)
=======
  total            316
  pass             118
  fail              40
  skipped            0
  model_not_found   96
  timeout           21
  http_error        41
```

Satu status per model, diambil dari kegagalan pertama yang nyata: `model_not_found` (404 katalog),
`timeout`, `http_error` (429/5xx/4xx lain), `fail` (menjawab tapi tidak memanggil tool / tidak
mematuhi hasil tool), dan `skipped` (sudah ada di JSONL saat `--resume`).

### Biaya dan durasi (perkiraan, 316 model, concurrency 4)

| Latensi T1 rata-rata | Fase 1 (316 request) | Fase 2 bila ~40% lulus (630 request) | Total |
|---|---|---|---|
| 2 s | ~2,6 menit | ~5,2 menit | ~8 menit |
| 4 s | ~5,3 menit | ~10,5 menit | ~16 menit |
| 8 s | ~10,5 menit | ~21 menit | ~32 menit |
| 15 s | ~20 menit | ~39 menit | ~59 menit |

Menyapu tiga tahap ke **semua** model butuh ≥1580 request (316 × 5, belum retry); dua fase dengan
ambang fase 1 hanya ~946 request, dan yang paling mahal tidak pernah dikirim ke model yang tidak
bisa memanggil tool. Angka `--concurrency` di atas 4 mempercepat hampir linear sampai router
membalas 429 — di situ backoff yang menahan, bukan skripnya.

### Kredensial

Hanya dari env: `PROBE_BASE_URL`, `PROBE_API_KEY`. Tidak ada key di repo, dan key di-scrub dari
stdout, stderr, serta berkas `--json`. Bila `PROBE_API_KEY` kosong, request dikirim tanpa header
`Authorization` dan skrip mencetak peringatan.

### Bentuk id model — **konfirmasi dulu**

Daftar default = 2 model yang **sudah terbukti resolve** sebagai pembanding, plus 5 kandidat:

```
inferhub/deepseek-v4.1-flash     ← terbukti
inferhub/deepseek-v4-pro         ← terbukti
inferhub/ag/gemini-3.8-flash-high   ← dugaan pola <router>/<prefix>/<model>
inferhub/gpt-6.1-terra              ← dugaan
inferhub/kimi-k2.5                  ← dugaan
inferhub/zai/glm-5.3-flash          ← dugaan
inferhub/grok-4.7                   ← dugaan
```

Hanya dua yang pertama diketahui resolve hari ini. Sisanya **tebakan bentuk id**; kalau salah,
skrip melaporkannya sebagai `model_not_found` (HTTP 404, `error.code: model_not_found`) dan
**tidak** menebak alias lain. Konfirmasi id di katalog hidup (`curl $PROBE_BASE_URL/models`)
sebelum menuliskannya ke config profil.

### Batasan yang jujur

Skrip membuktikan **perilaku endpoint** (tool calling, kepatuhan hasil, latensi) untuk model yang
diuji saat itu. Ia tidak membuktikan kualitas penalaran, vision, atau stabilitas jangka panjang —
dan hasil `model_not_found` berarti id belum benar, bukan modelnya buruk.

Catatan khusus untuk penyapuan katalog:

- `/models` hanya memberi **daftar id**, bukan kemampuan. 512 entri belum tentu 512 model berbeda
  (banyak alias), dan entri non-teks (embedding, image, TTS) akan gagal T1 — itu wajar, bukan bug.
- Lulus fase 1 hanya berarti "bisa memanggil satu tool". Model itu **belum** layak dipakai agen
  sampai lulus fase 2 (T2 memakai hasil tool, T3 tidak berhalusinasi).
- Hasil adalah **snapshot**: router bisa menambah model, mencabut model, atau mengubah perilaku.
  Jalankan ulang fase 1 secara berkala, bukan sekali lalu dipercaya selamanya.
- `--resume` melewati model yang sudah tercatat **pada stage yang sama atau lebih tinggi**; rekaman
  fase 1 tidak akan membuat fase 2 salah dilewati.
- Exit code tetap ketat: `0` hanya bila semua model yang diproses run itu lulus stage yang diminta.
  Dengan ratusan model, exit `1` adalah hal normal — yang dibaca adalah ringkasan status.

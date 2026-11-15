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

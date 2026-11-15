# CLAUDE.md

Berkas ini hanya penunjuk. **Aturan lengkap ada di [`AGENTS.md`](AGENTS.md)** — baca itu dulu
sebelum menyentuh kode, menjalankan deploy, atau mengklaim pekerjaan selesai.

Ringkasan yang tidak boleh dilanggar:

1. **Metadata saja** di API — tidak pernah isi pesan, judul tugas, id user/chat, atau `tool_input`.
   Endpoint-nya publik.
2. **`state.db` Hermes read-only** (`mode=ro`). Jangan menulis, migrasi, atau `VACUUM`.
3. **Kontrak `/api/status` stabil** — boleh menambah field, tidak boleh mengganti/menghapus.
4. **Deploy in-place**: API `127.0.0.1:8130`, statis `/var/www/office`, Caddy tidak disentuh.
5. **Satu sumber koordinat** di `frontend/src/lib/rooms.ts` (meja, NAV, POIS, kamera).
6. **Jangan push ke `main`** — branch → PR → review oleh agen lain → squash merge.
7. **Definisi selesai**: `go vet` + `go test -count=1` + `tsc --noEmit` + `npm run build` +
   `verify/e2e_review.sh` hijau, dan untuk perubahan visual: screenshot + verdict `vision_analyze`.
8. **Jebakan sandbox**: `GOTMPDIR=/workspace/.gotmp TMPDIR=/workspace/.gotmp` (karena `/tmp`
   `noexec`); stop unit sebelum menimpa binary (`Text file busy`); `restart` bukan `enable --now`.

Detail, tabel env, alur deploy, dan daftar "butuh keputusan manusia" → `AGENTS.md`.

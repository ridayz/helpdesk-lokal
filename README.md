# ☁️ Helpdesk Lokal

Dashboard helpdesk pribadi yang jalan **100% lokal** di komputermu (tanpa buka port).
Komputermu yang polling Odoo + kasih **notifikasi desktop + bunyi** tiap ada tiket baru / update stage.

## Sumber data (hasil deepdive Odoo 17 `helpdesk.indonet.id`)

- DB `indonet_helpdesk_live` · 179 tiket · model `helpdesk.ticket` (132 field)
- Stage: New → Open → In Progress → Hold → Solved → Closed
- Team: L1 Customer Care + 20 team L2/L3 · Channel: Web/Telp/Monitoring/Chat/Email
- Field tampil: no tiket, judul, deskripsi, customer (ID/CA/telepon/PIC), team/teknisi,
  prioritas/severity, tipe/kategori/sub, channel, tag, SLA + dampak, downtime mulai–selesai,
  umur tiket, flag GAMAS, solved/closed by, lampiran, 10 log chatter terakhir.

## Jalanin

**Cara gampang (Windows):** klik 2x ikon **Helpdesk Lokal** di Desktop → server nyala sendiri (minimized) + dashboard kebuka di browser. Shortcut-nya jalanin `start-helpdesk.bat` di repo ini.

**Cara manual:**

1. Copy `.env.example` jadi `.env`, isi `ODOO_LOGIN` + `ODOO_APIKEY` (API key dari profil Odoo → Preferences → API Keys).
2. `node server.mjs` (butuh Node 18+, tanpa `npm install`)
3. Buka `http://127.0.0.1:8951`, klik **🔔 Aktifkan notifikasi**, biarkan tab terbuka.
4. Polling tiap 60 detik (`POLL_MS` di `.env`). Tombol ↻ buat refresh manual.

## Privasi

- `.env` **tidak pernah di-commit** (ada di `.gitignore`). Kredensial cuma dipakai server-side.
- Server listen di `127.0.0.1` saja — tidak bisa diakses dari luar.

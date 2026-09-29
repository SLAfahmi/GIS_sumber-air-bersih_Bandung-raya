# 🗺️ caiKU - Web GIS Pemetaan Sumber Air Bersih & Air Siap Minum Bandung Raya

Aplikasi Web GIS (Geographic Information System) interaktif berbasis Node.js, Express.js, Prisma ORM, SQLite, dan Leaflet.js untuk inventarisasi dan pemetaan sumber air bersih serta titik air siap minum di seluruh wilayah aglomerasi Bandung Raya (Kota Bandung, Kota Cimahi, Kabupaten Bandung, dan Kabupaten Bandung Barat).

---

## 🚀 Fitur Utama

1. **🗺️ Peta Interaktif Geospasial (Leaflet.js)**
   - Visualisasi titik fasilitas air dengan marker berkode warna:
     - 🟢 **Siap Minum** (Hijau): Gerai air minum terverifikasi dengan animasi radar pulse.
     - 🟠 **Belum Siap Minum** (Oranye): Sumber air baku, sumur bor, pipa distribusi, dan reservoir (harus dimasak).
     - 🟣 **Perlu Verifikasi** (Indigo): Depot isi ulang atau titik yang memerlukan uji SLHS/lab berkala.
   - Filter instan multi-parameter:
     - Wilayah Administratif (Kota Bandung, Cimahi, Kab. Bandung, KBB)
     - Jenis Fasilitas (Gerai, Katup Distribusi, Reservoir, IPA, Sumur Bor, Mata Air, Depot)
     - Kategori Kelayakan Konsumsi
     - Pencarian teks langsung (Node ID, nama wilayah, instansi pengelola)
   - Lacak Posisi Saya (Geolocation GPS) & penentuan titik sumber air terdekat via formula Haversine.
   - Interactive Detail Drawer (slide-over panel) dengan rincian teknis lengkap, status operasional, dan parameter kelayakan.

2. **🧭 Sistem Navigasi & Tracking Rute Internal (Tanpa Direct Google Maps)**
   - Perhitungan rute turn-by-turn langsung di dalam peta web menggunakan OSRM Routing Engine terintegrasi.
   - Visualisasi garis rute (*glow halo polyline*) dari posisi pengguna ke fasilitas tujuan.
   - Panel Navigasi Mengambang (*Floating Route HUD*): Menampilkan jarak tempuh (km), estimasi durasi (menit), dan daftar instruksi manuver belokan berbahasa Indonesia.
   - Mode **Simulasi Perjalanan Live Tracking**: Animasi pergerakan kendaraan melintasi jalur rute secara *real-time* dengan pelacakan kamera peta otomatis.
   - Opsi alternatif eksternal Google Maps tetap tersedia sebagai opsi cadangan.

3. **⚙️ Modul Manajemen & Update Titik Air (CRUD)**
   - Dashboard KPI inventarisasi: Total Node terdaftar, persentase Siap Minum, Belum Siap Minum, & Perlu Verifikasi.
   - Formulir Tambah/Edit Titik Geospasial dengan penangkapan koordinat via GPS browser atau klik pada peta.
   - Tabel inventaris terfilter dengan paginasi responsif.
   - Fitur Ekspor Data ke format file CSV (.csv).

---

## 🛠️ Tech Stack

- **Backend Runtime:** Node.js (v18+)
- **Framework Web:** Express.js
- **Database:** SQLite (dev.db) / MySQL / PostgreSQL ready
- **ORM:** Prisma ORM v5.22.0
- **CSV Parser:** `csv-parser`
- **Frontend:** HTML5, Tailwind CSS (via CDN), Leaflet.js v1.9.4, Google Fonts (Plus Jakarta Sans & Inter), Material Symbols
- **Arsitektur:** RESTful API + Static File Serving

---

## 📂 Struktur Direktori Proyek

```text
SUMBER_AIR_BERSIH_BANDUNG_RAYA/
├── config/
│   └── database.js               # Prisma Client instance
├── controllers/
│   └── fasilitasController.js    # Logika bisnis & controller CRUD + statistik
├── database/
│   └── Data Air Bersih_TPWB(Data Air Bersih).csv  # Data sumber air 400 node
├── prisma/
│   ├── schema.prisma             # Skema Prisma ORM model FasilitasAir
│   └── seed.js                   # Skrip seeder otomatis dari file CSV
├── public/
│   ├── css/
│   │   └── style.css             # Styling kustom & marker Leaflet
│   ├── js/
│   │   └── app.js                # Logika frontend, peta Leaflet, & interaksi CRUD
│   └── index.html                # Single Page Application (Dashboard & Manajemen)
├── routes/
│   └── api.js                    # Rute API RESTful (/api/fasilitas, /api/stats)
├── .env                          # Variabel konfigurasi lingkungan
├── dev.db                        # SQLite database
├── package.json                  # Dependensi & skrip npm
├── PROJECT_PLAN.md               # Dokumentasi proyek
└── server.js                     # Server Express entrypoint
```

---

## 📡 API Endpoints Reference

| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/api/stats` | Statistik agregasi (total, per kategori, per status operasional) |
| `GET` | `/api/fasilitas` | Daftar semua titik fasilitas (dukung filter `wilayah`, `jenisFasilitas`, `kategoriAirMinum`, `statusOperasional`, `search`) |
| `GET` | `/api/fasilitas/:id` | Detail spesifik titik air berdasarkan ID atau Node ID |
| `POST` | `/api/fasilitas` | Tambah titik fasilitas baru ke database |
| `PUT` | `/api/fasilitas/:id` | Perbarui parameter titik fasilitas |
| `DELETE` | `/api/fasilitas/:id` | Hapus titik fasilitas dari database |

---

## ⚡ Panduan Menjalankan Proyek

1. **Jalankan Migrasi Database (Jika Diperlukan):**
   ```bash
   npx prisma db push
   ```

2. **Jalankan Seeder Data CSV:**
   ```bash
   npm run seed
   ```

3. **Jalankan Server Aplikasi:**
   ```bash
   npm start
   # atau untuk mode development dengan auto-reload:
   npm run dev
   ```

4. **Buka Aplikasi di Browser:**
   Akses `http://localhost:3000` pada peramban web.

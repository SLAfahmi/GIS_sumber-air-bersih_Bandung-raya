# caiKU: Web GIS Sumber Air Bersih se-Pulau Jawa

caiKU adalah aplikasi Web GIS untuk memetakan fasilitas air bersih di enam provinsi Pulau Jawa: Banten, DKI Jakarta, Jawa Barat, Jawa Tengah, DI Yogyakarta, dan Jawa Timur. Titik dikelompokkan menurut pengelolanya: **Perumda (PDAM)**, **Pemda**, **Pamsimas**, dan **Kolam Retensi**.

Warga bisa melihat peta tanpa login. Petugas GIS login untuk menambah, mengubah, menghapus, dan memulihkan titik. Setiap perubahan tercatat di log.

Setiap sumber air punya **analisis cakupan layanan**: perkiraan jumlah pelanggan (sambungan rumah/SR) yang bisa dilayani dan kecamatan yang tercakup. Ada juga **Asisten Cakupan AI** (Google Gemini) yang menjawab pertanyaan dari hasil analisis itu. Saat provinsi atau kab/kota dipilih, area di luar wilayah itu dipotong dari peta.

Asal data, aturan pemetaan kolom, rumus cakupan, dan batasan data dijelaskan di [SUMBER_DATA.md](SUMBER_DATA.md).

## Menjalankan di komputer sendiri

Prasyarat: Node.js 22 atau lebih baru (dibutuhkan SDK Gemini).

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

Buka `.env`, lalu isi `ADMIN_PASSWORD` dan `AUTH_SECRET`. `AUTH_SECRET` bisa dibuat dengan:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Lalu siapkan database dan jalankan server:

```bash
npx prisma db push          # buat tabel SQLite (prisma/dev.db)
npm run seed                # isi data dari database/Titik Air Se Jawa.xlsx
npm start                   # atau: npm run dev (restart otomatis saat file berubah)
```

Buka `http://localhost:3000`. Login petugas memakai `ADMIN_USERNAME` dan `ADMIN_PASSWORD` dari `.env`.

**Asisten AI (opsional):** buat API key gratis di [Google AI Studio](https://aistudio.google.com/apikey), lalu isi `GEMINI_API_KEY` di `.env` dan restart server. Kunci hanya dipakai server dan tidak dikirim ke browser. Tanpa kunci, tombol AI menampilkan pesan belum dikonfigurasi, sedangkan analisis cakupan di panel titik tetap berjalan.

Jika `ADMIN_PASSWORD` dibiarkan kosong, login default `petugas` / `caiku123` dipakai dan server menampilkan peringatan. Dengan `NODE_ENV=production`, server menolak jalan sampai `ADMIN_PASSWORD` dan `AUTH_SECRET` diisi.

### Variabel `.env`

| Variabel | Wajib | Keterangan |
| :--- | :--- | :--- |
| `DATABASE_URL` | Ya | Default `file:./dev.db` (SQLite) |
| `PORT` | Tidak | Default `3000` |
| `NODE_ENV` | Tidak | Isi `production` saat dipakai orang lain: server menolak jalan tanpa `ADMIN_PASSWORD` & `AUTH_SECRET` |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Ya (produksi) | Akun petugas GIS |
| `AUTH_SECRET` | Ya (produksi) | Kunci penanda tangan token login |
| `PUBLIC_RATE_LIMIT_PER_MINUTE` | Tidak | Batas per IP untuk `/api/cakupan/*` dan `/api/route` (default 60/menit) |
| `GEMINI_API_KEY` | Tidak | Mengaktifkan asisten AI |
| `GEMINI_MODEL` | Tidak | Paksa model tertentu; kosong = pilih model Flash terbaru otomatis |
| `AI_RATE_LIMIT_PER_MINUTE` | Tidak | Batas pertanyaan AI per IP (default 15/menit) |
| `AI_TIMEOUT_MS`, `AI_CALL_TIMEOUT_MS` | Tidak | Batas waktu satu pertanyaan (default 90000) & satu panggilan Gemini (default 15000) |
| `GOOGLE_MAPS_API_KEY` | Tidak | Hanya untuk `npm run pamsimas` |
| `SEED_XLSX` | Tidak | File xlsx untuk `seed`, `osm`, `pamsimas` (default `database/Titik Air Se Jawa.xlsx`) |
| `PLACES_CACHE_DIR`, `OSM_CACHE_DIR` | Tidak | Folder cache skrip `pamsimas` dan `osm` |

## Skrip npm

| Perintah | Fungsi |
| :--- | :--- |
| `npm start` | Jalankan server |
| `npm run dev` | Jalankan server dengan restart otomatis |
| `npm run seed` | Ganti seluruh isi database dengan data xlsx |
| `npm test` | Tes API (memakai database terpisah `prisma/test.db`, `dev.db` tidak tersentuh) |
| `npm run build:css` | Build ulang `public/css/tailwind.css` setelah mengubah kelas Tailwind di HTML/JS |
| `npm run watch:css` | Build CSS otomatis saat file berubah |
| `npm run pamsimas` | Cari titik Pamsimas lewat Google Places API (butuh API key, lihat SUMBER_DATA.md) |
| `npm run osm` | Tambah rumah pompa & kolam retensi dari OpenStreetMap ke xlsx (gratis, lihat SUMBER_DATA.md) |
| `npm run batas` | Siapkan batas provinsi, kab/kota, kecamatan Jawa + penduduk ke `public/data/batas/` (hasilnya sudah ada di repo) |
| `npm run kolom-kapasitas` | Tambah kolom kosong Jenis Sumber Air, Debit (L/detik), Jumlah SR ke sheet titik di xlsx |

## Fitur

**Peta (publik)**
- Titik berwarna per kategori. Saat peta diperkecil, titik berdekatan dikelompokkan; cincin kelompok menunjukkan porsi tiap kategori, angkanya jumlah titik.
- Filter provinsi, kab/kota, jenis fasilitas, dan kategori, plus pencarian teks (tekan `/`).
- Lima peta dasar: Peta (OSM), Satelit, Hybrid, Medan, dan Jalan.
- Street View di dalam web, dari panel titik atau dengan mengeklik jalan bergaris biru.
- Lacak posisi GPS dan titik terdekat, rute turn-by-turn (OSRM), dan simulasi perjalanan.
- Tautan langsung ke titik (`?node=JAWA-001`).
- **Potong wilayah terpilih.** Saat provinsi atau kab/kota dipilih, area di luarnya ditutup dan batas kecamatan di dalamnya ditampilkan. Tanpa filter wilayah, peta tampil utuh.
- **Analisis cakupan layanan** di panel titik: debit, kapasitas pelanggan (SR), jiwa terlayani, radius, dan daftar kecamatan tercakup. Tiap angka diberi label *Data* atau *Estimasi*. Tombol "Tampilkan area" memotong peta hanya ke area layanan titik itu (area lain dan titik di luarnya disembunyikan), lengkap dengan kecamatan tercakup. Rumah pompa dan IPAL tidak dihitung karena bukan sumber air bersih; kolam retensi dihitung sebagai potensi.
- **Ringkasan cakupan wilayah** untuk provinsi/kab-kota terpilih: total kapasitas, persen penduduk terlayani, dan kecamatan yang belum tercakup sumber mana pun (bisa disorot di peta).
- **Asisten Cakupan AI** (Google Gemini, function calling): tanya misalnya "Sumber mana yang melayani Kec. Lembang?". AI hanya menjawab dari hasil fungsi analisis di server, dan Node ID di jawaban bisa diklik. AI juga bisa **mengendalikan peta**: "Buka Kota Semarang" langsung memotong peta ke wilayah itu, "Tunjukkan area layanan JAWA-225" membuka titik beserta area cakupannya, dan "tampilkan hanya Pamsimas" menyaring kategori. Aksi yang dijalankan tercatat di bawah jawaban dan bisa diklik untuk menampilkannya lagi.

**Statistik (publik)**
- Ringkasan total titik, kab/kota terwakili, status operasional yang sudah dicek, dan estimasi penduduk terlayani.
- Sebaran titik per provinsi (atau per kab/kota bila provinsi dipilih) menurut kategori, dengan tampilan tabel.
- Cakupan layanan per provinsi, jenis fasilitas, status operasional, status verifikasi, dan 10 kab/kota dengan titik terbanyak. Arahkan kursor atau fokus keyboard ke batang untuk melihat rinciannya.

**Modul petugas (perlu login)**
- Tambah dan edit titik dengan peta mini, peringatan koordinat di luar Jawa, dan peringatan titik ganda.
- Isi kapasitas layanan (jenis sumber air, debit L/detik, jumlah SR) agar analisis cakupan memakai data, bukan estimasi.
- Status operasional: Beroperasi Normal, Debit Menurun, Pemeliharaan, Rusak, atau **Belum diketahui** (default untuk data impor yang belum dicek lapangan).
- Log perubahan per field (nilai lama dan baru, oleh siapa, kapan), hanya bisa dilihat petugas.
- Titik yang dihapus masuk **Arsip** beserta log-nya dan bisa dipulihkan.
- Ekspor CSV dan GeoJSON sesuai filter tabel.

Riwayat perubahan fitur: [docs/PERUBAHAN_REVISI.md](docs/PERUBAHAN_REVISI.md) dan [docs/PERUBAHAN_FITUR_PETA.md](docs/PERUBAHAN_FITUR_PETA.md).

## Teknologi

- Backend: Node.js, Express 5, Prisma ORM 5, SQLite
- Frontend: HTML, Tailwind CSS 3 (di-build, bukan CDN), Leaflet 1.9, Leaflet.markercluster 1.5
- Data: xlsx dari Google Maps Places API dan OpenStreetMap (Overpass + Nominatim), dibaca dengan ExcelJS
- Rute: OSRM publik (lewat proxy `/api/route`), dengan rute garis lurus sebagai cadangan
- Analisis spasial: Turf.js (server), batas wilayah geoBoundaries/OCHA-BPS disederhanakan dengan mapshaper
- AI: Google Gemini lewat `@google/genai` (function calling, hanya di server)

## Struktur folder

```text
config/          konstanta kategori & status, parameter model cakupan (cakupan.js), instance Prisma Client
controllers/     logika API: fasilitas & arsip, autentikasi, rute, cakupan, asisten AI
database/        Titik Air Se Jawa.xlsx (sumber data seed); batas_cache/ unduhan mentah (tidak di-commit)
middleware/      token login & pembatas percobaan login
prisma/          schema.prisma, seed.js
public/          index.html, css/ (style.css + tailwind.css hasil build), js/, img/, data/batas/ (GeoJSON batas Jawa)
routes/          daftar endpoint API
scripts/         cari-pamsimas.js (Pamsimas, Google), tambah-osm.js (rumah pompa & kolam retensi, OSM),
                 siapkan-batas-wilayah.js (batas & penduduk), tambah-kolom-kapasitas.js (kolom xlsx)
services/        cakupan.js (model cakupan), aiAsisten.js (Gemini), dataFasilitas.js
tailwind/        input.css (sumber Tailwind)
tests/           tes API (node:test)
utils/           helper bersama backend: respons error, bentuk datar titik, normalisasi teks
docs/            catatan perubahan fitur (changelog)
server.js        entry point Express
```

## API

Endpoint bertanda **Petugas** butuh header `Authorization: Bearer <token>` dari `/api/auth/login`.

| Method | Endpoint | Akses | Keterangan |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Publik | Login petugas. Diblokir 15 menit setelah 5 kali gagal dari IP yang sama |
| `GET` | `/api/auth/me` | Petugas | Cek sesi |
| `GET` | `/api/stats` | Publik | Jumlah titik per kategori, status, provinsi, dan wilayah |
| `GET` | `/api/wilayah` | Publik | Daftar kab/kota |
| `GET` | `/api/pengelola` | Publik | Daftar pengelola |
| `POST` | `/api/pengelola` | Petugas | Tambah pengelola |
| `GET` | `/api/fasilitas` | Publik | Daftar titik (filter `provinsi`, `wilayah`, `kategori`, `jenisFasilitas`, `statusOperasional`, `search`) |
| `GET` | `/api/fasilitas/:id` | Publik | Detail titik (ID angka atau Node ID) |
| `GET` | `/api/fasilitas/:id/log` | Petugas | Log perubahan titik |
| `POST` | `/api/fasilitas` | Petugas | Tambah titik |
| `PUT` | `/api/fasilitas/:id` | Petugas | Ubah titik; field yang berubah dicatat di log |
| `DELETE` | `/api/fasilitas/:id` | Petugas | Hapus titik; salinan titik dan log-nya disimpan di arsip |
| `GET` | `/api/arsip` | Petugas | Daftar titik terhapus |
| `POST` | `/api/arsip/:id/pulihkan` | Petugas | Pulihkan titik beserta log-nya |
| `GET` | `/api/route` | Publik | Rute (`startLat`, `startLng`, `endLat`, `endLng`, `mode` = `driving`/`walking`/`cycling`) |
| `GET` | `/api/cakupan/:id` | Publik | Analisis cakupan satu titik (ID angka atau Node ID): kapasitas SR, jiwa, radius, kecamatan tercakup, area GeoJSON |
| `GET` | `/api/cakupan/wilayah` | Publik | Ringkasan cakupan (`provinsi`, `wilayah`; kosong = seluruh Jawa) |
| `GET` | `/api/ai/status` | Publik | Apakah asisten AI aktif dan model yang dipakai |
| `POST` | `/api/ai/chat` | Publik | Tanya asisten AI (`pesan`, `riwayat`, `konteks`). Dibatasi 15 pertanyaan/menit per IP; 503 bila `GEMINI_API_KEY` kosong |

## Atribusi

- Peta dasar © OpenStreetMap contributors, Esri, dan OpenTopoMap (lihat atribusi di pojok peta).
- Koordinat PDAM, Pamsimas, dan sebagian kolam retensi berasal dari Google Maps Places API. Ketentuan penyimpanan datanya dijelaskan di [SUMBER_DATA.md](SUMBER_DATA.md#batasan-data).
- Rumah pompa dan sebagian kolam retensi © kontributor OpenStreetMap, lisensi ODbL.
- Batas wilayah: geoBoundaries gbHumanitarian (OCHA ROAP / BPS 2019, CC BY 3.0 IGO). Penduduk kab/kota 2020: HDX COD-PS Indonesia (BPS).

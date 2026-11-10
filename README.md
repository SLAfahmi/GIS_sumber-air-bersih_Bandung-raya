# caiKU: Web GIS Sumber Air Bersih se-Pulau Jawa

caiKU adalah aplikasi Web GIS untuk memetakan fasilitas air bersih di enam provinsi Pulau Jawa: Banten, DKI Jakarta, Jawa Barat, Jawa Tengah, DI Yogyakarta, dan Jawa Timur. Titik dikelompokkan menurut pengelolanya: **Perumda (PDAM)**, **Pemda**, **Pamsimas**, dan **Kolam Retensi**.

Warga bisa melihat peta tanpa login. Petugas GIS login untuk menambah, mengubah, menghapus, dan memulihkan titik. Setiap perubahan tercatat di log.

Asal data, aturan pemetaan kolom, dan batasan data dijelaskan di [SUMBER_DATA.md](SUMBER_DATA.md).

## Menjalankan di komputer sendiri

Prasyarat: Node.js 18 atau lebih baru.

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

Jika `ADMIN_PASSWORD` dibiarkan kosong, login default `petugas` / `caiku123` dipakai dan server menampilkan peringatan. Dengan `NODE_ENV=production`, server menolak jalan sampai `ADMIN_PASSWORD` dan `AUTH_SECRET` diisi.

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

## Fitur

**Peta (publik)**
- Titik berwarna per kategori. Saat peta diperkecil, titik berdekatan dikelompokkan; cincin kelompok menunjukkan porsi tiap kategori, angkanya jumlah titik.
- Filter provinsi, kab/kota, jenis fasilitas, dan kategori, plus pencarian teks (tekan `/`).
- Lima peta dasar: Peta (OSM), Satelit, Hybrid, Medan, dan Jalan.
- Street View di dalam web, dari panel titik atau dengan mengeklik jalan bergaris biru.
- Lacak posisi GPS dan titik terdekat, rute turn-by-turn (OSRM), dan simulasi perjalanan.
- Tautan langsung ke titik (`?node=JAWA-001`).

**Modul petugas (perlu login)**
- Tambah dan edit titik dengan peta mini, peringatan koordinat di luar Jawa, dan peringatan titik ganda.
- Status operasional: Beroperasi Normal, Debit Menurun, Pemeliharaan, Rusak, atau **Belum diketahui** (default untuk data impor yang belum dicek lapangan).
- Log perubahan per field (nilai lama dan baru, oleh siapa, kapan), hanya bisa dilihat petugas.
- Titik yang dihapus masuk **Arsip** beserta log-nya dan bisa dipulihkan.
- Ekspor CSV dan GeoJSON sesuai filter tabel.

## Teknologi

- Backend: Node.js, Express 5, Prisma ORM 5, SQLite
- Frontend: HTML, Tailwind CSS 3 (di-build, bukan CDN), Leaflet 1.9, Leaflet.markercluster 1.5
- Data: xlsx dari Google Maps Places API dan OpenStreetMap (Overpass + Nominatim), dibaca dengan ExcelJS
- Rute: OSRM publik (lewat proxy `/api/route`), dengan rute garis lurus sebagai cadangan

## Struktur folder

```text
config/          konstanta kategori & status, instance Prisma Client
controllers/     logika API: fasilitas & arsip, autentikasi, rute
database/        Titik Air Se Jawa.xlsx (sumber data seed)
middleware/      token login & pembatas percobaan login
prisma/          schema.prisma, seed.js
public/          index.html, css/ (style.css + tailwind.css hasil build), js/, img/
routes/          daftar endpoint API
scripts/         cari-pamsimas.js (Pamsimas, Google), tambah-osm.js (rumah pompa & kolam retensi, OSM)
tailwind/        input.css (sumber Tailwind)
tests/           tes API (node:test)
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

## Atribusi

- Peta dasar © OpenStreetMap contributors, Esri, dan OpenTopoMap (lihat atribusi di pojok peta).
- Koordinat PDAM, Pamsimas, dan sebagian kolam retensi berasal dari Google Maps Places API. Ketentuan penyimpanan datanya dijelaskan di [SUMBER_DATA.md](SUMBER_DATA.md#batasan-data).
- Rumah pompa dan sebagian kolam retensi © kontributor OpenStreetMap, lisensi ODbL.

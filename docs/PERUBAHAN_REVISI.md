# Perubahan: Revisi Keamanan, Data, dan Kerapian Repo

Dokumen ini mencatat revisi caiKU per 4 Nov 2026: apa yang berubah, alasannya, file yang disentuh, dan cara mengujinya.

## Ringkasan

| Revisi | Status |
| :--- | :--- |
| Repo bisa dijalankan setelah di-clone (README, xlsx & `.env.example` ikut Git) | Selesai |
| Login: password & secret sendiri, pembatas percobaan login, mode produksi wajib dikonfigurasi | Selesai |
| Status operasional data impor menjadi "Belum diketahui" | Selesai |
| Data Pemda (rumah pompa) & kolam retensi dari OpenStreetMap | Selesai (Pemda 1 → 186, Kolam Retensi 17 → 30) |
| Data Pamsimas Ciamis | Ditunda (butuh API key Google berbayar) |
| Validasi rute, error tidak dibocorkan, log hanya untuk petugas | Selesai |
| Titik yang dihapus masuk arsip dan bisa dipulihkan | Selesai |
| Clustering titik di peta | Selesai |
| Tailwind di-build (bukan CDN) | Selesai |
| File sisa dipindah ke `arsip/` | Selesai |
| Tes API otomatis (`npm test`) | Selesai, 17 tes |
| Bug: edit titik mencatat perubahan koordinat palsu | Diperbaiki |

## 1. Repo bisa dijalankan setelah di-clone

- `README.md` baru: cara menjalankan, skrip npm, fitur, struktur folder, dan daftar API. `PROJECT_PLAN.md` yang usang (masih membahas Air Siap Minum & Bandung Raya) dipindah ke `arsip/`.
- `.gitignore`: dari folder `database/` hanya `Titik Air Se Jawa.xlsx` yang ikut Git, karena dibutuhkan `npm run seed`. Backup xlsx dan cache API tetap lokal. `.env.example` sekarang ikut Git.
- `.env.example` diperbarui: `ADMIN_PASSWORD` kosong (bukan contoh password yang bisa ditebak), cara membuat `AUTH_SECRET`, `NODE_ENV=production`, dan `GOOGLE_MAPS_API_KEY` opsional.

## 2. Keamanan login

- **Secret token tidak lagi diturunkan dari kredensial.** Sebelumnya, tanpa `AUTH_SECRET`, secret = hash dari username & password. Karena password default tertulis di kode, siapa pun bisa membuat token petugas palsu. Sekarang tanpa `AUTH_SECRET` server membuat secret acak setiap menyala.
- **`.env` lokal sudah diisi** `ADMIN_PASSWORD` dan `AUTH_SECRET` acak. Login petugas memakai password di `.env`; `caiku123` tidak berlaku lagi.
- **Pembatas percobaan login:** 5 kali gagal dari IP yang sama memblokir login selama 15 menit (HTTP 429 + `Retry-After`).
- **Mode produksi:** dengan `NODE_ENV=production`, server menolak jalan bila `ADMIN_PASSWORD` atau `AUTH_SECRET` kosong.

## 3. Status "Belum diketahui"

xlsx tidak memuat kondisi operasional, tetapi seed dulu mengisi semua titik "Beroperasi Normal". Akibatnya statistik "Normal" terlihat pasti padahal tidak ada datanya.

- Status baru **Belum diketahui** menjadi default data impor dan titik baru.
- Formulir punya pilihan "Belum diketahui (belum dicek lapangan)", filter tabel ikut, dan ringkasan di peta menampilkan jumlahnya.
- Marker tetap titik penuh; titik berongga tetap khusus Pemeliharaan/Rusak.

## 4. Data dari OpenStreetMap

Skrip baru [scripts/tambah-osm.js](../scripts/tambah-osm.js) (`npm run osm`) mengambil rumah pompa dan kolam retensi dari OpenStreetMap (Overpass API), melengkapi desa, kecamatan, dan kab/kota lewat Nominatim, membuang duplikat, lalu menulis ke xlsx. Aturan lengkapnya ada di [SUMBER_DATA.md](../SUMBER_DATA.md#menambah-titik-dari-openstreetmap).

Hasilnya ditambahkan ke `database/Titik Air Se Jawa.xlsx` (backup: `Titik Air Se Jawa.sebelum-osm.xlsx`), lalu database di-seed ulang:

| Kategori | Sebelum | Sesudah | Tambahan |
| :--- | ---: | ---: | :--- |
| Perumda (PDAM) | 319 | 319 | - |
| Pemda (rumah pompa) | 1 | 186 | 185, sheet baru **Rumah Pompa**: DKI Jakarta 121, Jawa Tengah 30, Jawa Timur 31, Jawa Barat 3 |
| Pamsimas | 19 | 19 | - |
| Kolam Retensi | 17 | 30 | 13: Banten 4, DKI Jakarta 2, Jawa Barat 3, Jawa Tengah 3, Jawa Timur 1 |
| **Total** | **356** | **554** | |

- Pompa milik PDAM/operator air minum, swasta, sekolah/kompleks, air limbah, dan pompa warga (RW) tanpa pengelola pemerintah dilewati. 8 kandidat sudah ada di xlsx dan 8 duplikat antar-OSM juga dilewati.
- 32 titik diberi status `Perlu cek ulang` (nama generik, desa/kecamatan tidak lengkap, atau kolam yang hanya bertag retensi). Sisanya berstatus baru `Sesuai data OpenStreetMap (belum diverifikasi lapangan)`, yang juga didaftarkan di API dan formulir.
- Kab/kota DKI dari Nominatim dinormalkan (kota administrasi kadang ada di `city_district`).
- Sheet Ringkasan mendapat kolom "Rumah pompa"; sheet Catatan diperbarui. Menjalankan ulang skrip tidak menambah titik ganda.
- Atribusi "© kontributor OpenStreetMap (ODbL)" dicantumkan di kolom Sumber data, README, dan SUMBER_DATA.md.

Pamsimas tetap ditunda: OSM tidak punya data Pamsimas Ciamis, dan skrip `npm run pamsimas` butuh API key Google dengan billing.

## 5. Backend

- **Rute:** parameter `mode` hanya boleh `driving`, `walking`, atau `cycling`. Sebelumnya nilai apa pun disisipkan ke URL OSRM. Rentang koordinat juga divalidasi.
- **Error tidak dibocorkan:** respons 500 tidak lagi mengirim `error.message` (pesan Prisma, path file). Detailnya tetap dicatat di log server.
- **Log hanya untuk petugas:** `GET /api/fasilitas/:id` (publik) tidak lagi membawa log perubahan. Log diambil dari endpoint baru `GET /api/fasilitas/:id/log` yang butuh login.
- **Arsip penghapusan:** tabel baru `ArsipPenghapusan`. Hapus titik menyalin titik dan seluruh log-nya ke arsip dalam satu transaksi. Endpoint baru `GET /api/arsip` dan `POST /api/arsip/:id/pulihkan` mengembalikan titik beserta log lamanya. Pemulihan ditolak bila Node ID sudah dipakai titik lain.
- **Bug koordinat:** formulir membulatkan koordinat ke 6 desimal, sehingga setiap edit (mis. hanya status) ikut mengubah dan mencatat "Longitude" atau "Latitude". Sekarang selisih di bawah 0,000001° (±11 cm) tidak dianggap perubahan, dan edit tanpa perubahan tidak menggeser waktu "Diperbarui".
- `server.js` mengekspor `app` agar bisa dites tanpa membuka port.

## 6. Frontend

- **Clustering** dengan Leaflet.markercluster 1.5.3. Titik berdekatan dikelompokkan sampai zoom 12; cincin kelompok menunjukkan porsi tiap kategori, dan judulnya (hover) merinci jumlahnya. Titik yang sedang dibuka selalu tampil di luar kelompok. Legenda mendapat item "Kelompok titik".
- **Arsip Terhapus:** tombol di header katalog membuka daftar titik terhapus dengan tombol Pulihkan. Dialog hapus menjelaskan bahwa titik masuk arsip.
- **Tailwind di-build:** CDN (`cdn.tailwindcss.com`, tidak untuk produksi) diganti `public/css/tailwind.css` hasil `npm run build:css`. Konfigurasi pindah ke `tailwind.config.js`, komponen ke `tailwind/input.css`. Computed style semua elemen dibandingkan sebelum/sesudah: identik.

## 7. Kerapian

File yang tidak dipakai kode lagi dipindah (bukan dihapus) ke `arsip/` (di-ignore Git): `plan.md`, `PROJECT_PLAN.md`, CSV data awal, `database/osm_bandung_raya.csv`, dan `database/osm_raw/`.

## Pengujian

- `npm test`: 17 tes API memakai database terpisah `prisma/test.db` (dibuat & dihapus otomatis), mencakup login, token palsu, pembatas login, validasi, log, arsip & pemulihan, bug koordinat, validasi rute, dan mode produksi.
- Uji UI di Chrome headless (1440×900 dan 390×844) pada salinan database: kelompok titik, klik kelompok, titik aktif di luar kelompok, status "Belum diketahui", login dengan password baru, edit → log, hapus → arsip → pulihkan, tanpa scroll horizontal di ponsel, dan konsol tanpa error JS.
- `node --check` untuk semua file JS.

## Yang perlu Anda lakukan

1. Login petugas sekarang memakai `ADMIN_PASSWORD` di `.env` (ganti bila perlu).
2. Saat commit, ikutkan file baru: `README.md`, `.env.example`, `database/Titik Air Se Jawa.xlsx`, `public/css/tailwind.css`, `public/js/streetview.js`, `public/img/`, `public/favicon.svg`, `scripts/`, `tests/`, `tailwind/`, `tailwind.config.js`, dan dokumen `PERUBAHAN_*.md`.
3. Setelah mengubah kelas Tailwind di HTML/JS, jalankan `npm run build:css`.

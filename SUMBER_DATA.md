# Sumber Data Titik Air caiKU se-Pulau Jawa

Dokumen ini menjelaskan asal data titik fasilitas air di aplikasi caiKU, cara memuat ulang data ke database, aturan pemetaan kolom, dan batasan yang perlu diketahui sebelum data dipakai.

## Ringkasan

| Aspek | Keterangan |
| :--- | :--- |
| File sumber | `database/Titik Air Se Jawa.xlsx` |
| Asal koordinat | Google Maps (Places API), diakses 18 Okt 2026. Rumah pompa dan sebagian kolam retensi dari OpenStreetMap (ODbL), diakses 4 Nov 2026 |
| Cakupan | 6 provinsi, 119 kab/kota: Banten, DKI Jakarta, Jawa Barat, Jawa Tengah, DI Yogyakarta, Jawa Timur |
| Jumlah titik | 558 (360 dari Google Maps, termasuk 4 Pamsimas Ciamis yang ditambahkan manual; 198 dari OpenStreetMap) |
| Kategori | Perumda (PDAM) 319, Pemda 186, Pamsimas 23, Kolam Retensi 30 |
| Skrip | [prisma/seed.js](prisma/seed.js) (pemuat), [scripts/tambah-osm.js](scripts/tambah-osm.js) (OSM), [scripts/cari-pamsimas.js](scripts/cari-pamsimas.js) (Pamsimas), [scripts/siapkan-batas-wilayah.js](scripts/siapkan-batas-wilayah.js) (batas wilayah & penduduk) |

| Provinsi | Titik |
| :--- | ---: |
| Banten | 30 |
| DKI Jakarta | 151 |
| Jawa Barat | 140 |
| Jawa Tengah | 115 |
| DI Yogyakarta | 18 |
| Jawa Timur | 104 |

## Cara memuat ulang data

```bash
npm run seed                                  # baca database/Titik Air Se Jawa.xlsx
node prisma/seed.js "path/ke/file lain.xlsx"  # atau pakai file xlsx lain dengan kolom yang sama
```

Seed membaca **semua sheet yang header-nya memuat kolom `Nama`, `Latitude`, dan `Longitude`** (saat ini: PDAM Se-Jawa, Kolam Retensi, Instalasi & Reservoar, Pamsimas, Rumah Pompa). Sheet Ringkasan dan Catatan otomatis dilewati. Kolom dibaca berdasarkan nama header, jadi urutan kolom boleh berubah.

File dibaca dan divalidasi dulu sebelum database dikosongkan. Jika tidak ada baris valid, database tidak diubah. Baris dengan koordinat tidak valid, kategori tidak dikenal, atau kab/kota tidak dikenal dilewati dan dilaporkan di terminal.

Seed **mengganti seluruh isi database**, termasuk titik yang ditambahkan petugas, log perubahannya, dan arsip titik terhapus.

## Menambah titik Pamsimas

Titik Pamsimas dicari dengan [scripts/cari-pamsimas.js](scripts/cari-pamsimas.js) lewat Google Places API (New), Text Search:

- **Pass A:** kueri `Pamsimas <kab/kota>, <provinsi>` untuk setiap kab/kota yang ada di xlsx.
- **Pass B:** grid sel 0,1° di Kab. Ciamis, Kota Banjar, Kab. Pangandaran, dan Kab./Kota Tasikmalaya dengan kata kunci `Pamsimas` dan `BPSPAMS KPSPAMS sarana air bersih desa`. Sel yang hasilnya padat dipecah otomatis sampai 0,025°.

Langkah:

1. Di [Google Cloud Console](https://console.cloud.google.com/), buat project, aktifkan billing, lalu aktifkan **Places API (New)**.
2. Buat API key, batasi ke Places API (New), lalu tambahkan ke `.env`:
   ```
   GOOGLE_MAPS_API_KEY=isi_key_anda
   ```
3. Jalankan:
   ```bash
   npm run pamsimas -- --dry-run   # lihat titik baru tanpa menulis xlsx
   npm run pamsimas                # tulis ke xlsx (backup *.sebelum-pamsimas.xlsx dibuat dulu)
   npm run seed                    # muat ulang database
   ```

Catatan:

- Satu run memakai sekitar 300–500 request Text Search (field tingkat Pro saja, tanpa rating). Jumlah ini masih di bawah kuota gratis bulanan Google. Skrip berhenti di `--max-requests` (default 1500).
- Setiap respons disimpan di `database/places_cache/`, jadi menjalankan ulang tidak menambah request. Hapus folder itu untuk mengambil data terbaru.
- Hasil yang sudah ada di xlsx (berdasarkan Place ID), tutup permanen, di luar Jawa, atau bernama sama dalam radius 50 m dilewati. Nama depot/isi ulang/PDAM dibuang.
- Status `Perlu cek ulang` diberikan bila nama generik (mis. hanya "PAMSIMAS"), kecamatan/desa tidak tercantum, atau nama tidak memuat Pamsimas/SPAMS. Alasannya ditulis di kolom Catatan.
- Skrip mengganti nama sheet `Pamsimas (contoh)` menjadi `Pamsimas` dan menyesuaikan rumus di sheet Ringkasan.

## Menambah titik dari OpenStreetMap

Rumah pompa (kategori Pemda) dan sebagian kolam retensi diambil dari OpenStreetMap dengan [scripts/tambah-osm.js](scripts/tambah-osm.js). Skrip ini gratis dan tidak butuh API key.

```bash
npm run osm -- --dry-run   # lihat titik baru tanpa menulis xlsx
npm run osm                # tulis ke xlsx (backup *.sebelum-osm.xlsx dibuat dulu)
npm run seed               # muat ulang database
```

Cara kerjanya:

1. **Overpass API** mencari, di kotak Pulau Jawa, objek `man_made=pumping_station`, `basin=retention/detention`, kolam bernama, dan objek yang namanya memuat "kolam retensi", "rumah pompa", "stasiun pompa", atau "pompa banjir".
2. **Penyaringan.** Pompa milik PDAM/operator air minum (termasuk booster), swasta (PT, perumahan, mal), air limbah, dan pompa warga (RW/RT) dilewati. Pompa RW tetap diambil bila pengelolanya instansi pemerintah, mis. Dinas/Sudin Tata Air. Pompa bernama generik ("Rumah Pompa 5") hanya diambil bila pengelolanya instansi pemerintah, dan namanya ditambah nama kelurahan.
3. **Buang duplikat.** Titik yang sudah ada di xlsx dalam radius 60 m (kolam retensi: 250 m, karena berupa area) atau bernama sama dalam 1 km dilewati, begitu juga duplikat antar-hasil OSM.
4. **Nominatim** (reverse geocoding, 1 request per detik) mengisi desa, kecamatan, kab/kota, provinsi, dan alamat. Titik di luar 6 provinsi Jawa dilewati.
5. Hasil ditulis ke sheet **Rumah Pompa** (baru) dan **Kolam Retensi**. Sheet Ringkasan mendapat kolom "Rumah pompa", dan sheet Catatan diperbarui.

Catatan:

- Respons Overpass dan Nominatim disimpan di `database/osm_cache/`. Menjalankan ulang tidak membebani server OSM; hapus folder itu untuk mengambil data terbaru. Server Overpass publik sering penuh, jadi skrip mencoba beberapa server dengan jeda.
- Status `Sesuai data OpenStreetMap (belum diverifikasi lapangan)` dipakai untuk hasil OSM. Status `Perlu cek ulang` dipakai bila nama generik, kecamatan/desa tidak lengkap, atau kolam hanya bertag retensi tanpa nama "kolam retensi". Alasannya ditulis di kolom Catatan, bersama pengelola yang tercantum di OSM.
- Banyak rumah pompa Jakarta dan Semarang berasal dari survei lapangan HOT InAWARE (2017–2018).
- Hasil run 4 Nov 2026: 185 rumah pompa (DKI Jakarta 121, Jawa Barat 3, Jawa Tengah 30, Jawa Timur 31) dan 13 kolam retensi (Banten 4, DKI Jakarta 2, Jawa Barat 3, Jawa Tengah 3, Jawa Timur 1); 32 di antaranya berstatus `Perlu cek ulang`. 8 kandidat dilewati karena sudah ada di xlsx dan 8 karena duplikat antar-OSM.

## Kategori dan jenis fasilitas

Kolom `Kategori` di xlsx dipetakan ke kategori pengelola dan jenis fasilitas:

| Kategori di xlsx | Kategori di caiKU | Jenis fasilitas |
| :--- | :--- | :--- |
| Kantor PDAM (pusat/utama) | Perumda | Kantor PDAM (Pusat/Utama) |
| Kantor cabang/unit PDAM | Perumda | Kantor Cabang/Unit PDAM |
| Instalasi PDAM (IPA/intake/reservoar), Instalasi PDAM (IPA/intake) | Perumda | Instalasi PDAM (IPA/Intake/Reservoar) |
| Reservoar PDAM | Perumda | Reservoar PDAM |
| IPAL (kolam pengolah limbah) | Perumda | IPAL |
| Rumah pompa | Pemda | Rumah Pompa |
| Kolam retensi | Kolam Retensi | Kolam Retensi |
| Pamsimas, Pamsimas (contoh) | Pamsimas | Pamsimas |

Entri yang bukan PDAM tetapi tercatat sebagai kantor PDAM di xlsx (PT Krakatau Tirta Industri, PT Moya Indonesia, PT Tirta Gemah Ripah, PT Tirta Asasta Depok) ikut kategori Perumda.

## Pemetaan kolom

| Kolom xlsx | Di caiKU |
| :--- | :--- |
| Nama, Kecamatan, Latitude, Longitude | Nama, kecamatan, koordinat |
| Desa/Kelurahan | Desa/Kelurahan |
| Alamat (Google Maps) | Alamat. Untuk baris dari OpenStreetMap, alamat disusun dari Nominatim |
| Kab/Kota (alamat) + Provinsi | Wilayah (kab/kota). `Kab. X` ditulis `Kabupaten X`, `Jakarta Pusat` ditulis `Kota Jakarta Pusat` |
| Wilayah layanan | Wilayah layanan (bisa berbeda dari lokasi kantor) |
| Status | Status verifikasi, disalin apa adanya |
| Catatan | Catatan |
| Sumber data | Sumber data |
| Link Google Maps | Tombol "Buka di Google Maps" di panel detail. Link ini sudah memuat Place ID, jadi Place ID tidak disimpan terpisah |
| Jenis Sumber Air | Jenis sumber air baku: Mata Air, Sumur Bor, Air Sungai, Waduk/Danau/Situ, Air Hujan/Resapan, Lainnya (nilai lain dibaca "Lainnya") |
| Debit (L/detik) | Debit / kapasitas produksi; boleh pakai koma desimal (`1,5`) |
| Jumlah SR | Jumlah sambungan rumah (pelanggan) aktual, bilangan bulat |
| No, Google Place ID, Link OpenStreetMap | Tidak disimpan |

Tiga kolom kapasitas di atas opsional dan ditambahkan (kosong) oleh `npm run kolom-kapasitas`. Sel kosong membuat analisis cakupan memakai nilai tipikal (lihat bagian berikut).

Node ID dibuat ulang setiap seed: `JAWA-001` sampai `JAWA-558`, diurutkan per provinsi dari barat ke timur, lalu kab/kota, kategori, dan nama. Status operasional semua titik diisi **"Belum diketahui"** karena xlsx tidak memuat kondisi operasional. Petugas menggantinya (Beroperasi Normal, Debit Menurun, Pemeliharaan, Rusak) setelah cek lapangan, dan setiap perubahan tercatat di log.

## Pengelola

xlsx tidak punya kolom pengelola, sehingga seed menentukannya dengan aturan berikut:

| Kategori | Pengelola |
| :--- | :--- |
| Perumda, nama diawali `PT` | Nama perusahaan (bagian sebelum ` - `, tanpa keterangan dalam kurung), mis. PT Krakatau Tirta Industri |
| Perumda, wilayah layanan DKI Jakarta | Perumda PAM JAYA |
| Perumda lainnya | `PDAM <wilayah layanan>`, mis. PDAM Kabupaten Lebak. Untuk "Kab. Serang dan Kota Serang" atau "Kab. Bekasi (dan sebagian Kota Bekasi)" dipakai wilayah pertama |
| Pemda, Kolam Retensi | `Pemerintah <kab/kota>`; di DKI Jakarta: Pemerintah Provinsi DKI Jakarta |
| Pamsimas | KPSPAMS (Pengelola Pamsimas Desa) |

Nama pengelola ini adalah label wilayah layanan, bukan nama resmi badan usaha (mis. "PDAM Kota Bandung", bukan "Perumda Tirtawening"). Petugas bisa menggantinya lewat formulir.

## Status verifikasi

| Nilai | Arti |
| :--- | :--- |
| Terverifikasi (Google Places) | Entri Google Maps cocok dan meyakinkan |
| Sesuai entri Google Maps (belum diverifikasi lapangan) | Sesuai Google Maps, belum dicek di lapangan |
| Sesuai data OpenStreetMap (belum diverifikasi lapangan) | Diambil dari OpenStreetMap, belum dicek di lapangan |
| Perlu cek ulang | Ulasan sedikit, tipe entri janggal, nama generik, alamat tidak lengkap, atau koordinat dibulatkan |
| Terverifikasi lapangan | Hanya diisi petugas setelah survei lapangan |

## Analisis cakupan layanan

Panel titik, kartu ringkasan wilayah, dan asisten AI memakai model yang sama di [services/cakupan.js](services/cakupan.js). Parameternya ada di [config/cakupan.js](config/cakupan.js) dan bisa diubah.

**Langkah perhitungan untuk satu titik:**

1. **Debit (Q).** Diambil dari kolom Debit bila diisi (label *Data*). Bila kosong, dipakai nilai tipikal per jenis fasilitas (label *Estimasi*).
2. **Kapasitas pelanggan.** `SR = Q × 86.400 × (1 − kehilangan air) ÷ (kebutuhan × 5 jiwa/SR × 1,1)`. Angka 1,1 adalah faktor hari maksimum.
   - Contoh Pamsimas 1,5 L/s: 1,5 × 86.400 × 0,85 ÷ (60 × 5 × 1,1) = **333 SR** (± 1.665 jiwa).
   - Bila kolom Jumlah SR diisi, area layanan memakai SR aktual dan panel menampilkan persentase pemakaian kapasitas.
3. **Status operasional.** Status *Debit Menurun* mengurangi kapasitas menjadi 70%. Status *Pemeliharaan* dan *Rusak* dianggap tidak melayani.
4. **Radius layanan.** `r = √(jiwa terlayani ÷ (π × kepadatan penduduk × porsi rumah tersambung))`, dibatasi 0,3–15 km. Kepadatan diambil dari kecamatan lokasi titik.
5. **Area & wilayah tercakup.** Lingkaran radius r dipotong dengan batas kecamatan, sehingga laut dan luar Jawa tidak dihitung.
   - Bila kolom Wilayah layanan memuat kab/kota lokasi titik, area juga dibatasi ke kab/kota itu.
   - Hasilnya berupa daftar kecamatan beserta persentase luas kecamatan yang tercakup dan perkiraan jiwa per kecamatan (jiwa dibagi menurut luas irisan).

**Parameter per jenis fasilitas:**

| Jenis fasilitas | Peran | Debit tipikal | Kebutuhan (L/orang/hari) | Kehilangan air | Porsi tersambung |
| :--- | :--- | ---: | :--- | ---: | ---: |
| Instalasi PDAM (IPA/Intake/Reservoar) | Sumber | 50 L/s | 150 (kota) / 120 (kabupaten) | 20% | 50% |
| Reservoar PDAM | Sumber | 20 L/s | 150 / 120 | 20% | 50% |
| Pamsimas | Sumber | 1,5 L/s | 60 | 15% | 80% |
| Kolam Retensi | Potensi air baku/resapan | 2 L/s | 60 | 15% | 80% |
| Kantor PDAM / Cabang | Dihitung hanya bila debit atau jumlah SR diisi | - | 150 / 120 | 20% | 50% |
| Rumah Pompa, IPAL | Bukan sumber air bersih, tidak dihitung | - | - | - | - |

Rujukan: Permen PUPR No. 27/PRT/M/2016 tentang Penyelenggaraan SPAM dan kriteria perencanaan Ditjen Cipta Karya (kebutuhan 60–150 L/orang/hari, kehilangan air maksimal 20%, faktor hari maksimum 1,1, 1 SR ≈ 5 jiwa), serta petunjuk teknis Pamsimas (minimal 60 L/orang/hari). Debit tipikal dan porsi tersambung adalah asumsi kerja caiKU, bukan angka resmi.

Jenis sumber air yang kosong ditebak dari nama fasilitas (mis. "intake"/"IPA" → Air Sungai, "sumur"/"bor" → Sumur Bor) dan diberi label *Ditebak*.

**Ringkasan wilayah** menjumlahkan SR seluruh sumber di dalam provinsi/kab-kota terpilih (kolam retensi dipisah sebagai potensi). Jumlah itu dibandingkan dengan penduduk wilayah, lalu dicari kecamatan yang tidak beririsan dengan area layanan mana pun.

### Batas wilayah & penduduk

Batas dibuat oleh [scripts/siapkan-batas-wilayah.js](scripts/siapkan-batas-wilayah.js) (`npm run batas`). Hasilnya di-commit di `public/data/batas/` (± 5 MB) dan dipakai oleh peta maupun server.

- **Batas kab/kota & kecamatan:** geoBoundaries gbHumanitarian IDN ADM2/ADM3, versi *simplified*. Sumber aslinya OCHA ROAP / BPS 2019, lisensi CC BY 3.0 IGO.
  - Hasil: 119 kab/kota dan 2.144 kecamatan. Kecamatan dicocokkan ke kab/kota lewat titik di dalam polygon, dengan suara per pulau berbobot luas, sehingga Kep. Seribu, Karimunjawa, dan Kangean tetap masuk, sedangkan Lampung dan Bali tidak.
  - Batas provinsi dan daratan Jawa dibuat dengan menggabungkan (dissolve) kab/kota memakai mapshaper. Area non-administratif (Waduk Cirata, Waduk Kedungombo, "Hutan") digabung ke daratan provinsi terdekat.
- **Penduduk:** HDX COD-PS Indonesia 2020 (BPS) di level kab/kota. Data penduduk per kecamatan tidak tersedia terbuka, jadi penduduk kab/kota dibagi ke kecamatan menurut luas. Artinya, kepadatan dianggap rata dalam satu kab/kota.
- Unduhan mentah disimpan di `database/batas_cache/` (tidak di-commit). Jalankan `npm run batas -- --unduh-ulang` untuk mengambil versi terbaru.

### Batasan model cakupan

- **Estimasi, bukan data pelanggan.** Selama kolom Debit/Jumlah SR kosong, angka cakupan adalah perkiraan perencanaan. Isi data dari PDAM, BPPSPAM, atau KPSPAMS agar label berubah menjadi *Data*.
- **Persentase penduduk terlayani adalah batas bawah.** Kantor PDAM (289 titik) belum ikut dihitung karena tidak punya debit/SR, padahal sebagian besar pelanggan PDAM dilayani lewat unit-unit itu.
- **Area berbentuk lingkaran.** Jaringan pipa sebenarnya mengikuti jalan dan topografi. Lingkaran hanya mendekati luas yang setara dengan jumlah pelanggan.
- **Kepadatan rata per kab/kota** membuat radius di pusat kota kabupaten terlalu besar dan di pinggiran terlalu kecil.
- **Batas 2019 yang disederhanakan** bisa sedikit bergeser dari batas resmi terbaru, dan nama kecamatan mengikuti ejaan sumber.
- **Asisten AI** tidak menghitung sendiri: setiap angka diambil dari fungsi analisis di server. Jawaban tetap perlu dibaca kritis karena AI bisa salah merangkum.

## Batasan data

Diringkas dari sheet Catatan di xlsx:

- **Kantor bukan sumber air.** Titik kantor PDAM, cabang, dan unit adalah lokasi kantor, bukan intake, mata air, atau sumur produksi. Koordinat intake dan IPA utama perlu diminta dari PDAM atau BBWS.
- **PDAM mendekati lengkap, bukan pasti lengkap.** Pencarian Google Places mengembalikan hasil terbatas per kueri, sehingga kantor yang namanya tidak memuat kata PDAM, cabang, atau unit bisa terlewat.
- **Pamsimas hanya yang terdaftar di Google Maps.** Banyak sarana desa tidak punya entri Google Maps, jadi jumlahnya tidak boleh dipakai sebagai total. Ciamis dan sekitarnya disisir lebih rapat daripada wilayah lain.
- **Kolam retensi di luar Bandung Raya belum lengkap.** Kolam retensi Bandung Raya sudah lengkap dari Google Maps. Di luar itu, datanya gabungan Google Maps dan OpenStreetMap, dan hanya mencakup kolam yang tercatat di kedua sumber.
- **Rumah pompa hanya yang tercatat di OpenStreetMap.** Datanya terpusat di Jakarta, Surabaya, dan Semarang karena di kota-kota itu ada kontributor dan survei. Kota lain bisa saja punya rumah pompa yang belum dipetakan. Pengelola ditentukan dari wilayah lokasi (`Pemerintah <kab/kota>`), bukan dari dinas yang sebenarnya.
- **Lisensi OpenStreetMap.** Data OSM berlisensi ODbL dan wajib mencantumkan atribusi "© kontributor OpenStreetMap". Sumber tiap titik OSM tercatat di kolom Sumber data.
- **Kolam yang tidak ditemukan:** kolam retensi Tegalega (Bandung), Tawang (Semarang), dan beberapa kota besar lain tidak muncul di pencarian.
- **Kota Tasikmalaya:** Google menaruh beberapa entri Tasikmalaya di wilayah Kabupaten Tasikmalaya, sehingga kantor Kota Tasikmalaya belum terpisah.
- **Kota Serang** digabung dengan Kabupaten Serang (PDAM Tirta Albantani) karena satu entitas.
- **Duplikat** sudah dihapus berdasarkan Place ID. Entri ganda dengan Place ID berbeda (mis. Tirta Raharja Soreang) dicatat di kolom Catatan.
- **Ketentuan Google Maps Platform.** Menurut ketentuan layanan Places API, koordinat hanya boleh disimpan sementara (paling lama 30 hari), sedangkan Place ID boleh disimpan. Untuk pemakaian di luar tugas kuliah, cek ketentuan terbaru dan utamakan sumber resmi di bawah.
- Titik yang ditambahkan petugas lewat aplikasi diberi sumber "Input Petugas GIS" agar bisa dibedakan dari data xlsx.

## Sumber resmi untuk melengkapi data

- [pamsimas.pu.go.id](https://pamsimas.pu.go.id): lokasi Pamsimas
- BPPSPAM / Kementerian PU
- Balai Besar Wilayah Sungai (Citarum, Ciliwung-Cisadane, Pemali-Juana, Bengawan Solo, Brantas, dll.)
- Dinas PUPR kab/kota
- PDAM masing-masing, untuk lokasi intake dan IPA

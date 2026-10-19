# Sumber Data Titik Air caiKU se-Pulau Jawa

Dokumen ini menjelaskan asal data titik fasilitas air di aplikasi caiKU, cara memuat ulang data ke database, aturan pemetaan kolom, dan batasan yang perlu diketahui sebelum data dipakai.

## Ringkasan

| Aspek | Keterangan |
| :--- | :--- |
| File sumber | `database/Titik Air Se Jawa.xlsx` |
| Asal koordinat | Google Maps (Places API), diakses 18 Okt 2026 |
| Cakupan | 6 provinsi, 119 kab/kota: Banten, DKI Jakarta, Jawa Barat, Jawa Tengah, DI Yogyakarta, Jawa Timur |
| Jumlah titik | 356 |
| Kategori | Perumda (PDAM) 319, Pemda 1, Pamsimas 19, Kolam Retensi 17 |
| Skrip pemuat | [prisma/seed.js](prisma/seed.js) |

| Provinsi | Titik |
| :--- | ---: |
| Banten | 26 |
| DKI Jakarta | 28 |
| Jawa Barat | 130 |
| Jawa Tengah | 82 |
| DI Yogyakarta | 18 |
| Jawa Timur | 72 |

## Cara memuat ulang data

```bash
npm run seed                                  # baca database/Titik Air Se Jawa.xlsx
node prisma/seed.js "path/ke/file lain.xlsx"  # atau pakai file xlsx lain dengan kolom yang sama
```

Seed membaca **semua sheet yang header-nya memuat kolom `Nama`, `Latitude`, dan `Longitude`** (saat ini: PDAM Se-Jawa, Kolam Retensi, Instalasi & Reservoar, Pamsimas (contoh)). Sheet Ringkasan dan Catatan otomatis dilewati. Kolom dibaca berdasarkan nama header, jadi urutan kolom boleh berubah.

File dibaca dan divalidasi dulu sebelum database dikosongkan. Jika tidak ada baris valid, database tidak diubah. Baris dengan koordinat tidak valid, kategori tidak dikenal, atau kab/kota tidak dikenal dilewati dan dilaporkan di terminal.

Seed **mengganti seluruh isi database**, termasuk titik yang ditambahkan petugas dan log perubahannya.

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
| Pamsimas (contoh) | Pamsimas | Pamsimas |

Entri yang bukan PDAM tetapi tercatat sebagai kantor PDAM di xlsx (PT Krakatau Tirta Industri, PT Moya Indonesia, PT Tirta Gemah Ripah, PT Tirta Asasta Depok) ikut kategori Perumda.

## Pemetaan kolom

| Kolom xlsx | Di caiKU |
| :--- | :--- |
| Nama, Kecamatan, Latitude, Longitude | Nama, kecamatan, koordinat |
| Desa/Kelurahan | Desa/Kelurahan |
| Alamat (Google Maps) | Alamat |
| Kab/Kota (alamat) + Provinsi | Wilayah (kab/kota). `Kab. X` ditulis `Kabupaten X`, `Jakarta Pusat` ditulis `Kota Jakarta Pusat` |
| Wilayah layanan | Wilayah layanan (bisa berbeda dari lokasi kantor) |
| Status | Status verifikasi, disalin apa adanya |
| Catatan | Catatan |
| Sumber data | Sumber data |
| Link Google Maps | Tombol "Buka di Google Maps" di panel detail. Link ini sudah memuat Place ID, jadi Place ID tidak disimpan terpisah |
| No, Google Place ID, Link OpenStreetMap | Tidak disimpan |

Node ID dibuat ulang setiap seed: `JAWA-001` sampai `JAWA-356`, diurutkan per provinsi dari barat ke timur, lalu kab/kota, kategori, dan nama. Status operasional semua titik diisi "Beroperasi Normal" karena xlsx tidak memuat informasi ini.

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
| Perlu cek ulang | Ulasan sedikit, tipe entri janggal, nama generik, alamat tidak lengkap, atau koordinat dibulatkan |
| Terverifikasi lapangan | Hanya diisi petugas setelah survei lapangan |

## Batasan data

Diringkas dari sheet Catatan di xlsx:

- **Kantor bukan sumber air.** Titik kantor PDAM, cabang, dan unit adalah lokasi kantor, bukan intake, mata air, atau sumur produksi. Koordinat intake dan IPA utama perlu diminta dari PDAM atau BBWS.
- **PDAM mendekati lengkap, bukan pasti lengkap.** Pencarian Google Places mengembalikan hasil terbatas per kueri, sehingga kantor yang namanya tidak memuat kata PDAM, cabang, atau unit bisa terlewat.
- **Pamsimas dan kolam retensi di luar Bandung Raya hanya contoh.** Jumlahnya tidak boleh dipakai sebagai total. Kolam retensi Bandung Raya sudah lengkap dari sumber yang sama.
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

# Perubahan: Pilihan Citra Peta, Street View, Logo caiKU, dan Skrip Pamsimas

Dokumen ini mencatat perubahan pada aplikasi caiKU per 29 Okt 2026: apa yang berubah, cara memakainya, file yang disentuh, dan batasan yang perlu diketahui.

> **Pembaruan status (19 Nov 2026):** skrip Pamsimas masih belum dijalankan dengan API key asli. Data kini memuat 23 titik Pamsimas, termasuk 4 titik Pamsimas Ciamis (`JAWA-224` sampai `JAWA-227`) yang ditambahkan manual dari Google Maps. Angka terbaru ada di [SUMBER_DATA.md](../SUMBER_DATA.md).

## Ringkasan

| Fitur | Status |
| :--- | :--- |
| Pilihan citra/peta dasar seperti Google Maps (Satelit, Hybrid, dll.) | Selesai |
| Street View di dalam web (dari panel titik dan mode klik peta) | Selesai |
| Logo dan ikon tab browser caiKU | Selesai |
| Skrip penambah titik Pamsimas (Google Places API) | Skrip siap, **belum dijalankan**; update Ciamis ditunda |

## 1. Pilihan citra peta

Tombol **lapisan** (ikon tumpukan) di dock kanan peta sekarang membuka panel **Tampilan Peta**, bukan lagi berpindah berurutan. Setiap pilihan punya gambar pratinjau dari area yang sedang dilihat.

| Pilihan | Sumber tile | Keterangan |
| :--- | :--- | :--- |
| Peta | OpenStreetMap | Default |
| Satelit | Esri World Imagery | Citra satelit |
| Hybrid | Esri World Imagery + Esri World Transportation + Esri World Boundaries and Places | Satelit dengan label jalan dan nama tempat |
| Medan | OpenTopoMap | Kontur dan relief |
| Jalan | Esri World Street Map | Peta jalan bergaya klasik |

- Semua sumber gratis tanpa API key.
- Pilihan terakhir disimpan di browser (`localStorage`, kunci `caiku.basemap`), jadi tetap terpakai setelah halaman dibuka ulang. Jika penyimpanan browser diblokir (mis. mode privat), peta kembali ke default tanpa error.
- Bagian **Detail peta** di panel yang sama berisi toggle **Cakupan Street View** (garis biru).
- Atribusi di footer peta mengikuti pilihan yang aktif.
- Panel ditutup dengan tombol ×, klik di luar panel, atau Esc.

CARTO Voyager sempat direncanakan, tetapi tile-nya kini meminta API key ("API KEY REQUIRED"), jadi diganti Esri World Street Map.

## 2. Street View

Ada dua cara membuka panorama:

1. **Dari panel detail titik:** tombol **Street View** di sebelah "Buka Rute Navigasi".
2. **Mode Street View:** tombol Street View (ikon orang) di dock kanan.
   - Saat aktif, tombol berwarna biru, garis biru cakupan muncul, dan kursor berubah menjadi tanda plus.
   - Klik jalan bergaris biru untuk membuka panorama di lokasi itu.
   - Klik titik air selama mode aktif untuk membuka panorama titik tersebut, bukan panel detailnya.
   - Esc atau klik tombol lagi untuk keluar. Garis biru kembali ke pengaturan sebelum mode diaktifkan.

Panel panorama:

- Di desktop, panel muncul di sisi kanan peta. Peta di sebelahnya tetap bisa diklik untuk pindah lokasi.
- Di ponsel, panel memenuhi area peta.
- Header berisi nama lokasi, koordinat, tombol **Google Maps** (membuka Street View di tab baru), dan tombol tutup.
- Penanda kuning (pegman) menunjukkan lokasi panorama di peta.
- Urutan Esc: tutup panorama → tutup panel lapisan → keluar dari mode Street View → tutup panel detail.

Jika titik jauh dari jalan, panorama bisa tidak tersedia. Panel menampilkan petunjuk untuk memakai mode Street View dan memilih jalan bergaris biru.

## 3. Logo caiKU

- Ikon tab browser baru: [public/favicon.svg](../public/favicon.svg). Isinya tetesan air putih dengan huruf "c" di kotak biru `#006194`.
- Logo aplikasi: [public/img/caiku-logo.svg](../public/img/caiku-logo.svg). Dipakai di header sidebar dan top bar mobile, menggantikan ikon generik `water_drop`.
- `index.html` sebelumnya tidak punya `<link rel="icon">`, sehingga browser menampilkan ikon lama dari cache localhost. Sekarang ikon dipasang eksplisit dengan `?v=2` untuk melewati cache.
- Server mengarahkan `/favicon.ico` ke `/favicon.svg`. Sebelumnya permintaan itu jatuh ke fallback SPA.

Jika ikon lama masih muncul, tekan **Ctrl+F5** atau hapus cache browser untuk localhost.

## 4. Skrip penambah titik Pamsimas (belum dijalankan)

Data Pamsimas saat ini hanya 19 titik, dan **0 di Ciamis**. OpenStreetMap juga tidak punya data Pamsimas di Ciamis, dan SIM Pamsimas butuh login. Karena itu dibuat skrip [scripts/cari-pamsimas.js](../scripts/cari-pamsimas.js) yang memakai Google Places API (New), sama dengan sumber data lama.

- Pass A mencari `Pamsimas <kab/kota>` untuk setiap kab/kota se-Jawa.
- Pass B menyisir grid rapat di Ciamis, Kota Banjar, Pangandaran, dan Tasikmalaya.
- Hasil yang sudah ada, tutup permanen, depot/isi ulang/PDAM, atau duplikat berdekatan dilewati.
- Respons disimpan di cache supaya menjalankan ulang tidak menambah biaya. Ada juga batas `--max-requests`.

Skrip sudah diuji dengan respons tiruan pada salinan xlsx; xlsx asli dan database **belum diubah**. Pengguna memutuskan update Ciamis dilakukan nanti. Langkah menjalankannya (API key, `--dry-run`, lalu `npm run seed`) ada di [SUMBER_DATA.md](../SUMBER_DATA.md#menambah-titik-pamsimas).

Teks keterangan Pamsimas di panel detail ([core.js](../public/js/core.js)) sudah diubah dari "masih berupa contoh" menjadi "dari pencarian Google Maps; belum mencakup semua sarana desa".

## File yang berubah

| File | Perubahan |
| :--- | :--- |
| [public/js/map.js](../public/js/map.js) | `BASE_LAYERS` baru (5 pilihan, hybrid berlapis), `createBaseLayer`, `setBaseLayer`, panel lapisan (`toggleLayerPicker`, `renderLayerPicker`), penyimpanan pilihan; klik marker saat mode Street View. `toggleMapLayer` dihapus |
| [public/js/streetview.js](../public/js/streetview.js) | **Baru.** Mode Street View, garis cakupan, panel panorama, URL embed dan URL Google Maps |
| [public/js/crud.js](../public/js/crud.js) | Peta mini formulir memakai `createBaseLayer` |
| [public/js/app.js](../public/js/app.js) | Rantai tombol Esc untuk panel Street View, panel lapisan, dan mode Street View |
| [public/js/core.js](../public/js/core.js) | Teks keterangan Pamsimas |
| [public/index.html](../public/index.html) | Favicon dan `theme-color`, logo, panel lapisan, tombol Street View (dock dan panel detail), panel panorama, script `streetview.js` |
| [public/css/style.css](../public/css/style.css) | Gaya panel lapisan, panel panorama, pegman, tombol aktif, dan urutan lapisan (z-index) dock |
| [public/favicon.svg](../public/favicon.svg), [public/img/caiku-logo.svg](../public/img/caiku-logo.svg) | **Baru.** Ikon dan logo caiKU |
| [server.js](../server.js) | Redirect `/favicon.ico` ke `/favicon.svg` |
| [scripts/cari-pamsimas.js](../scripts/cari-pamsimas.js) | **Baru.** Skrip pencari Pamsimas |
| [package.json](../package.json) | Skrip npm `pamsimas` |
| [SUMBER_DATA.md](../SUMBER_DATA.md) | Bagian "Menambah titik Pamsimas" dan batasan data Pamsimas |

## Batasan

- **Embed Street View tanpa API key.** Panorama memakai alamat embed `google.com/maps/embed`, bentuk yang sama dengan menu "Sematkan peta" di Google Maps. Alamat ini bukan API resmi berkunci, jadi bisa berubah sewaktu-waktu. Tombol **Google Maps** di panel tetap memakai Maps URLs resmi (`map_action=pano`) sebagai cadangan.
- **Garis biru cakupan** memakai tile milik Google yang juga dipakai Google Maps. Jika tile ini diblokir, mode Street View tetap berjalan tanpa garis biru. Atribusi "Street View © Google" muncul saat garis aktif.
- **Tile OpenStreetMap** mengikuti kebijakan pemakaian OSM: cocok untuk tugas dan trafik kecil, bukan untuk trafik besar.

## Pengujian yang sudah dilakukan

- `node --check` untuk semua file JS yang berubah.
- Server dijalankan dan dicek dengan curl: halaman, `favicon.svg`, logo, dan `streetview.js` dimuat (200), dan `/favicon.ico` diarahkan (302) ke `/favicon.svg`.
- Uji otomatis di Chrome headless lewat DevTools Protocol, pada ukuran desktop (1440×900) dan ponsel (390×844):
  - Panel lapisan menampilkan 5 pilihan.
  - Memilih Hybrid mengganti tile dan atribusi, dan pilihannya tersimpan.
  - Street View dari panel titik menampilkan panorama.
  - Mode Street View menyalakan garis cakupan; Esc mematikan mode dan garis cakupan.
  - Konsol tanpa error, hanya peringatan bawaan Tailwind CDN.
- Skrip Pamsimas diuji dengan respons tiruan pada **salinan** xlsx, mode `--dry-run` maupun mode tulis.

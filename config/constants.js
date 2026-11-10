// Nilai baku yang diterima API (harus sama dengan opsi di formulir frontend)
const KATEGORI = ['Perumda', 'Pemda', 'Pamsimas', 'Kolam Retensi'];

// "Belum diketahui" dipakai untuk data impor: xlsx sumber tidak memuat kondisi operasional
const STATUS_BELUM_DIKETAHUI = 'Belum diketahui';
const STATUS_OPERASIONAL = ['Beroperasi Normal', 'Debit Menurun', 'Pemeliharaan', 'Rusak', STATUS_BELUM_DIKETAHUI];

// Selain "Terverifikasi lapangan", nilai berasal dari kolom Status di xlsx sumber data
// (Google Maps lewat data awal & cari-pamsimas.js, OpenStreetMap lewat tambah-osm.js)
const STATUS_VERIFIKASI = [
  'Terverifikasi lapangan',
  'Terverifikasi (Google Places)',
  'Sesuai entri Google Maps (belum diverifikasi lapangan)',
  'Sesuai data OpenStreetMap (belum diverifikasi lapangan)',
  'Perlu cek ulang',
];

module.exports = {
  KATEGORI,
  STATUS_BELUM_DIKETAHUI,
  STATUS_OPERASIONAL,
  STATUS_VERIFIKASI,
};

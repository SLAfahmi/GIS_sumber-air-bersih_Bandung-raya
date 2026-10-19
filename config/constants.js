// Nilai baku yang diterima API (harus sama dengan opsi di formulir frontend)
const KATEGORI = ['Perumda', 'Pemda', 'Pamsimas', 'Kolam Retensi'];
const STATUS_OPERASIONAL = ['Beroperasi Normal', 'Debit Menurun', 'Pemeliharaan', 'Rusak'];
// Tiga nilai terakhir berasal dari kolom Status di xlsx sumber data
const STATUS_VERIFIKASI = [
  'Terverifikasi lapangan',
  'Terverifikasi (Google Places)',
  'Sesuai entri Google Maps (belum diverifikasi lapangan)',
  'Perlu cek ulang',
];

module.exports = {
  KATEGORI,
  STATUS_OPERASIONAL,
  STATUS_VERIFIKASI,
};

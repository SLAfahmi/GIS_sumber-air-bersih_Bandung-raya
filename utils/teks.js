// Huruf kecil, selain huruf/angka jadi satu spasi: untuk mencocokkan nama wilayah/kecamatan
// yang ditulis dengan gaya berbeda ("Kab. Bandung" vs "kabupaten  bandung")
const normalisasiTeks = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

module.exports = { normalisasiTeks };

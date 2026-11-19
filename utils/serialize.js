/**
 * Bentuk datar satu titik fasilitas (respons API, analisis cakupan, asisten AI).
 * Objek relasi `wilayah` & `pengelola` dibuang setelah namanya disalin, agar payload
 * GET /api/fasilitas tidak memuat data yang sama dua kali.
 */
function serializeFasilitas(item) {
  const { wilayah, pengelola, ...rest } = item;
  return {
    ...rest,
    wilayahNama: wilayah?.nama || '',
    provinsi: wilayah?.provinsi || '',
    pengelolaNama: pengelola?.nama || '',
  };
}

module.exports = { serializeFasilitas };

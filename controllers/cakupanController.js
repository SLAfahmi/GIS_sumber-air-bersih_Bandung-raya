const cakupan = require('../services/cakupan');
const { ambilSemuaFasilitas, ambilFasilitas } = require('../services/dataFasilitas');
const { serverError } = require('../utils/http');

// Parameter query hanya diterima sebagai string tunggal (?wilayah=a&wilayah=b diabaikan)
const teksQuery = (value) => (typeof value === 'string' ? value : undefined);

// GET /api/cakupan/:id  (id numerik atau Node ID) - analisis cakupan layanan satu titik
const getCakupanTitik = async (req, res) => {
  try {
    const item = await ambilFasilitas(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Fasilitas tidak ditemukan' });
    res.json({ success: true, data: cakupan.analisisCakupan(item) });
  } catch (error) {
    serverError(res, error, 'Gagal menghitung cakupan layanan');
  }
};

// GET /api/cakupan/wilayah?provinsi=&wilayah=  - ringkasan cakupan satu provinsi / kab-kota / seluruh Jawa
const getCakupanWilayah = async (req, res) => {
  try {
    const provinsi = teksQuery(req.query.provinsi);
    const wilayah = teksQuery(req.query.wilayah);
    const facilities = await ambilSemuaFasilitas();
    res.json({ success: true, data: cakupan.ringkasanWilayahCached(facilities, { provinsi, wilayah }) });
  } catch (error) {
    serverError(res, error, 'Gagal menghitung ringkasan cakupan wilayah');
  }
};

module.exports = { getCakupanTitik, getCakupanWilayah };

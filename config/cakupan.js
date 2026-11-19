/**
 * Parameter model cakupan layanan air bersih (dipakai services/cakupan.js).
 *
 * Semua angka di sini adalah asumsi perencanaan yang bisa diubah. Rujukan:
 * - Permen PUPR No. 27/PRT/M/2016 tentang Penyelenggaraan SPAM dan kriteria perencanaan
 *   Ditjen Cipta Karya: kebutuhan air domestik 60 L/orang/hari (perdesaan) s.d. 150 L/orang/hari
 *   (kota besar), kehilangan air (NRW) maksimal 20%, faktor hari maksimum 1,1, 1 SR ≈ 5 jiwa.
 * - Petunjuk teknis Pamsimas: kebutuhan minimal 60 L/orang/hari.
 *
 * Rumus kapasitas (lihat SUMBER_DATA.md):
 *   SR = Q × 86.400 × (1 − kehilangan) / (kebutuhan × JIWA_PER_SR × FAKTOR_HARI_MAKS)
 * Rumus radius layanan:
 *   r = √( jiwa terlayani / (π × kepadatan penduduk × porsi tersambung) )
 */

const DETIK_PER_HARI = 86400;
const JIWA_PER_SR = 5;
const FAKTOR_HARI_MAKS = 1.1;

// Batas radius area layanan (km) agar hasil tetap masuk akal untuk data yang ekstrem
const RADIUS_MIN_KM = 0.3;
const RADIUS_MAX_KM = 15;

// Kebutuhan air (liter/orang/hari) untuk sistem perpipaan PDAM, menurut tipe wilayah lokasi
const KEBUTUHAN_PDAM = { KOTA: 150, KABUPATEN: 120 };

// Jenis sumber air baku (kolom "Jenis Sumber Air" di xlsx dan formulir petugas)
const JENIS_SUMBER = ['Mata Air', 'Sumur Bor', 'Air Sungai', 'Waduk/Danau/Situ', 'Air Hujan/Resapan', 'Lainnya'];

// Tebakan jenis sumber dari nama fasilitas bila kolom belum diisi (urutan = prioritas)
const TEBAK_JENIS_SUMBER = [
  { match: /mata\s*air|sumber\s*air|\bspring\b|\bumbul\b|\bsendang\b/i, jenis: 'Mata Air' },
  { match: /sumur|\bbor\b|artesis|air\s*tanah/i, jenis: 'Sumur Bor' },
  { match: /waduk|bendung|\bsitu\b|danau|telaga|embung/i, jenis: 'Waduk/Danau/Situ' },
  { match: /sungai|\bkali\b|intake|\bipa\b|instalasi pengolahan/i, jenis: 'Air Sungai' },
  { match: /retensi|resapan|tampungan|penampung/i, jenis: 'Air Hujan/Resapan' },
];

/**
 * Peran tiap jenis fasilitas dalam analisis:
 * - sumber  : dihitung dengan debit data, atau debit tipikal bila kosong (ditandai "estimasi")
 * - potensi : seperti sumber, tetapi hasilnya potensi bila air diolah (kolam retensi / air resapan)
 * - kantor  : titik kantor, bukan sumber; dihitung hanya bila petugas mengisi debit atau jumlah SR
 * - bukan   : bukan fasilitas air bersih, tidak dihitung
 */
const PROFIL_FASILITAS = {
  'Instalasi PDAM (IPA/Intake/Reservoar)': {
    peran: 'sumber', debitDefault: 50, kebutuhan: 'PDAM', kehilangan: 0.2, porsiTersambung: 0.5,
  },
  'Reservoar PDAM': {
    peran: 'sumber', debitDefault: 20, kebutuhan: 'PDAM', kehilangan: 0.2, porsiTersambung: 0.5,
  },
  'Pamsimas': {
    peran: 'sumber', debitDefault: 1.5, kebutuhan: 60, kehilangan: 0.15, porsiTersambung: 0.8,
  },
  'Kolam Retensi': {
    peran: 'potensi', debitDefault: 2, kebutuhan: 60, kehilangan: 0.15, porsiTersambung: 0.8,
    jenisSumberDefault: 'Air Hujan/Resapan',
    catatan: 'Kolam retensi menampung air hujan untuk pengendalian banjir dan resapan; angka ini adalah potensi bila airnya diolah menjadi air bersih.',
  },
  'Kantor PDAM (Pusat/Utama)': {
    peran: 'kantor', kebutuhan: 'PDAM', kehilangan: 0.2, porsiTersambung: 0.5,
  },
  'Kantor Cabang/Unit PDAM': {
    peran: 'kantor', kebutuhan: 'PDAM', kehilangan: 0.2, porsiTersambung: 0.5,
  },
  'Rumah Pompa': {
    peran: 'bukan', alasan: 'Rumah pompa milik pemda umumnya untuk pengendalian banjir, bukan sumber air bersih.',
  },
  'IPAL': {
    peran: 'bukan', alasan: 'IPAL mengolah air limbah, bukan sumber air bersih.',
  },
};

// Jenis fasilitas lain (input petugas) diperlakukan seperti kantor: dihitung bila ada data
const PROFIL_LAINNYA = { peran: 'kantor', kebutuhan: 'PDAM', kehilangan: 0.2, porsiTersambung: 0.5 };

// Status operasional memengaruhi kapasitas efektif
const FAKTOR_STATUS = {
  'Debit Menurun': 0.7,
  'Pemeliharaan': 0,
  'Rusak': 0,
};

module.exports = {
  DETIK_PER_HARI,
  JIWA_PER_SR,
  FAKTOR_HARI_MAKS,
  RADIUS_MIN_KM,
  RADIUS_MAX_KM,
  KEBUTUHAN_PDAM,
  JENIS_SUMBER,
  TEBAK_JENIS_SUMBER,
  PROFIL_FASILITAS,
  PROFIL_LAINNYA,
  FAKTOR_STATUS,
};

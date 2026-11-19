/**
 * Model cakupan layanan sumber air bersih.
 *
 * Untuk satu titik fasilitas:
 *   1. Debit (data petugas/xlsx, atau nilai tipikal per jenis fasilitas) → kapasitas sambungan rumah (SR)
 *   2. SR × jiwa/SR → jiwa terlayani → radius layanan dari kepadatan penduduk kecamatan lokasi
 *   3. Lingkaran layanan dipotong dengan batas kecamatan (daratan Jawa, dan kab/kota layanan bila diketahui)
 *      → daftar kecamatan tercakup beserta persentase dan perkiraan jiwa per kecamatan
 *
 * Parameter & rujukan ada di config/cakupan.js; batas wilayah dari scripts/siapkan-batas-wilayah.js.
 * Hasil bersifat estimasi perencanaan, bukan data pelanggan riil, kecuali kolom Jumlah SR diisi.
 */
const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');
const cfg = require('../config/cakupan');
const { normalisasiTeks } = require('../utils/teks');

const BATAS_DIR = path.join(__dirname, '..', 'public', 'data', 'batas');
const KEPADATAN_CADANGAN = 1000; // jiwa/km², dipakai bila batas wilayah belum disiapkan
const LANGKAH_LINGKARAN = 48;

// ============================================================================
// Batas wilayah (dimuat sekali ke memori)
// ============================================================================
let batas = null;

function loadBatas() {
  if (batas) return batas;
  const indexFile = path.join(BATAS_DIR, 'index.json');
  if (!fs.existsSync(indexFile)) {
    batas = { tersedia: false, kabkota: new Map(), provinsi: new Map(), kecamatan: [] };
    return batas;
  }
  const read = (file) => JSON.parse(fs.readFileSync(path.join(BATAS_DIR, file), 'utf8'));
  const index = read('index.json');
  const kabFeatures = read(index.kabkota).features;
  const kecFeatures = index.daftarProvinsi.flatMap((p) => read(p.kecamatan).features);
  batas = {
    tersedia: true,
    atribusi: index.atribusi,
    provinsi: new Map(read(index.provinsi).features.map((f) => [f.properties.nama, f])),
    kabkota: new Map(kabFeatures.map((f) => [f.properties.nama, f])),
    kecamatan: kecFeatures.map((feature) => ({
      feature,
      bbox: turf.bbox(feature),
      key: kunciKecamatan(feature.properties),
    })),
  };
  return batas;
}

function kunciKecamatan({ nama, wilayahNama }) {
  return `${wilayahNama}|${nama}`;
}

const bboxBeririsan = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const bboxMemuat = (b, x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

// Kecamatan tempat titik berada; titik pesisir yang sedikit di luar polygon memakai kecamatan terdekat
function kecamatanDiTitik(lng, lat) {
  const { kecamatan } = loadBatas();
  const titik = turf.point([lng, lat]);
  const dalam = kecamatan.find((k) => bboxMemuat(k.bbox, lng, lat) && turf.booleanPointInPolygon(titik, k.feature));
  if (dalam) return dalam;

  const sekitar = kecamatan.filter((k) => bboxBeririsan(k.bbox, [lng - 0.05, lat - 0.05, lng + 0.05, lat + 0.05]));
  let terdekat = null;
  for (const k of sekitar) {
    const d = turf.distance(titik, turf.centroid(k.feature));
    if (!terdekat || d < terdekat.d) terdekat = { d, k };
  }
  return terdekat?.k || null;
}

// ============================================================================
// Rumus dasar
// ============================================================================
function profilFasilitas(item) {
  return cfg.PROFIL_FASILITAS[item.jenisFasilitas] || cfg.PROFIL_LAINNYA;
}

/** SR = Q × 86.400 × (1 − kehilangan) / (kebutuhan × jiwa/SR × faktor hari maks) */
function hitungKapasitasSR({ debitLps, kebutuhan, kehilangan }) {
  if (!(debitLps > 0) || !(kebutuhan > 0)) return 0;
  const airTersalurPerHari = debitLps * cfg.DETIK_PER_HARI * (1 - kehilangan);
  return Math.floor(airTersalurPerHari / (kebutuhan * cfg.JIWA_PER_SR * cfg.FAKTOR_HARI_MAKS));
}

/** r = √(jiwa / (π × kepadatan × porsi tersambung)), dibatasi RADIUS_MIN_KM..RADIUS_MAX_KM */
function hitungRadiusKm({ jiwa, kepadatan, porsiTersambung }) {
  const r = Math.sqrt(jiwa / (Math.PI * Math.max(kepadatan, 1) * porsiTersambung));
  return Math.min(cfg.RADIUS_MAX_KM, Math.max(cfg.RADIUS_MIN_KM, r));
}

function kebutuhanAir(item, profil) {
  if (profil.kebutuhan !== 'PDAM') return profil.kebutuhan;
  return /^Kota /.test(item.wilayahNama || '') ? cfg.KEBUTUHAN_PDAM.KOTA : cfg.KEBUTUHAN_PDAM.KABUPATEN;
}

function jenisSumber(item, profil) {
  if (item.jenisSumber) return { nilai: item.jenisSumber, asal: 'data' };
  const tebakan = cfg.TEBAK_JENIS_SUMBER.find((t) => t.match.test(item.nama || ''));
  if (tebakan) return { nilai: tebakan.jenis, asal: 'ditebak' };
  if (profil.jenisSumberDefault) return { nilai: profil.jenisSumberDefault, asal: 'ditebak' };
  return { nilai: null, asal: 'tidak diketahui' };
}

// "Kab. Serang dan Kota Serang" / "DKI Jakarta" → nama kab/kota di batas wilayah
function kabkotaLayanan(teks) {
  if (!teks) return [];
  const { kabkota } = loadBatas();
  const hasil = new Set();
  const bagian = teks
    .replace(/\bKab\.\s*/g, 'Kabupaten ')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+dan\s+|,|&|\//i)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const nama of bagian) {
    if (kabkota.has(nama)) hasil.add(nama);
    else if (kabkota.has(`Kota ${nama}`)) hasil.add(`Kota ${nama}`);
    else {
      // Nama provinsi (mis. "DKI Jakarta") → semua kab/kota di provinsi itu
      for (const [kab, f] of kabkota) if (f.properties.provinsi === nama) hasil.add(kab);
    }
  }
  return [...hasil];
}

function bulat(value, digits = 1) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// ============================================================================
// Analisis satu fasilitas
// ============================================================================
const cache = new Map();
const BATAS_CACHE = 3000;

// Map dipakai sebagai LRU sederhana: entri yang dipakai dipindah ke belakang, yang tertua dibuang
function ambilAtauHitung(map, key, batasEntri, hitung) {
  if (map.has(key)) {
    const nilai = map.get(key);
    map.delete(key);
    map.set(key, nilai);
    return nilai;
  }
  const nilai = hitung();
  map.set(key, nilai);
  if (map.size > batasEntri) map.delete(map.keys().next().value);
  return nilai;
}

function analisisCakupan(item) {
  // Nama wilayah ikut di kunci: mengganti relasi wilayah tidak selalu menyentuh updatedAt titik
  const key = `${item.id}:${new Date(item.updatedAt || 0).getTime()}:${item.wilayahNama || ''}`;
  return ambilAtauHitung(cache, key, BATAS_CACHE, () => hitungAnalisis(item));
}

function hitungAnalisis(item) {
  const profil = profilFasilitas(item);
  const dasar = {
    id: item.id,
    nodeId: item.nodeId,
    nama: item.nama || item.jenisFasilitas,
    jenisFasilitas: item.jenisFasilitas,
    wilayahNama: item.wilayahNama,
    provinsi: item.provinsi,
    lokasi: [item.latitude, item.longitude],
    peran: profil.peran,
    jenisSumber: jenisSumber(item, profil),
  };

  if (profil.peran === 'bukan') {
    return { ...dasar, dihitung: false, alasan: profil.alasan };
  }

  const adaDebit = Number.isFinite(item.debitLps);
  const adaSR = Number.isInteger(item.jumlahSR);
  if (profil.peran === 'kantor' && !adaDebit && !adaSR) {
    return {
      ...dasar,
      dihitung: false,
      alasan: 'Titik kantor PDAM, bukan sumber air. Isi debit atau jumlah SR (pelanggan) unit ini lewat formulir petugas agar cakupannya bisa dihitung.',
    };
  }

  const catatan = [];
  if (profil.catatan) catatan.push(profil.catatan);

  const debit = adaDebit
    ? { nilai: item.debitLps, asal: 'data' }
    : profil.debitDefault != null ? { nilai: profil.debitDefault, asal: 'estimasi' } : null;

  const faktorStatus = cfg.FAKTOR_STATUS[item.statusOperasional] ?? 1;
  if (faktorStatus < 1) {
    catatan.push(faktorStatus === 0
      ? `Status "${item.statusOperasional}": dianggap tidak melayani saat ini.`
      : `Status "${item.statusOperasional}": kapasitas efektif dikurangi menjadi ${Math.round(faktorStatus * 100)}%.`);
  }

  const parameter = {
    kebutuhanLOrangHari: kebutuhanAir(item, profil),
    kehilanganAir: profil.kehilangan,
    jiwaPerSR: cfg.JIWA_PER_SR,
    faktorHariMaks: cfg.FAKTOR_HARI_MAKS,
    porsiTersambung: profil.porsiTersambung,
    faktorStatus,
  };

  const debitEfektif = debit ? debit.nilai * faktorStatus : null;
  const kapasitasSR = debit
    ? hitungKapasitasSR({ debitLps: debitEfektif, kebutuhan: parameter.kebutuhanLOrangHari, kehilangan: parameter.kehilanganAir })
    : null;
  const srAktual = adaSR ? item.jumlahSR : null;

  // Area layanan memakai pelanggan aktual bila ada, selain itu kapasitas
  const srLayanan = srAktual ?? kapasitasSR ?? 0;
  const sumberSR = srAktual != null ? 'data' : debit?.asal || 'estimasi';
  const jiwaTerlayani = srLayanan * cfg.JIWA_PER_SR;
  const utilisasiPersen = srAktual != null && kapasitasSR > 0 ? bulat((srAktual / kapasitasSR) * 100, 0) : null;
  if (utilisasiPersen != null && utilisasiPersen > 100) {
    catatan.push('Jumlah SR aktual melebihi kapasitas hitungan: debit mungkin lebih besar dari angka yang tercatat, atau ada sumber lain yang ikut memasok.');
  }

  const hasil = {
    ...dasar,
    dihitung: true,
    statusOperasional: item.statusOperasional,
    debit,
    debitEfektif: debitEfektif != null ? bulat(debitEfektif, 2) : null,
    parameter,
    kapasitasSR,
    srAktual,
    srLayanan,
    sumberSR,
    jiwaTerlayani,
    utilisasiPersen,
    kecamatanLokasi: null,
    radiusKm: 0,
    luasAreaKm2: 0,
    wilayahTercakup: [],
    kabkotaTercakup: [],
    area: null,
    catatan,
  };

  if (srLayanan <= 0) return hasil;

  const { tersedia } = loadBatas();
  const lokasiKec = tersedia ? kecamatanDiTitik(item.longitude, item.latitude) : null;
  const kepadatan = lokasiKec?.feature.properties.kepadatan
    || loadBatas().kabkota.get(item.wilayahNama)?.properties.kepadatan
    || KEPADATAN_CADANGAN;
  if (lokasiKec) {
    const p = lokasiKec.feature.properties;
    hasil.kecamatanLokasi = { nama: p.nama, wilayahNama: p.wilayahNama, provinsi: p.provinsi, kepadatan: p.kepadatan };
  } else if (!tersedia) {
    catatan.push('Batas kecamatan belum disiapkan (npm run batas): area layanan berupa lingkaran tanpa daftar kecamatan.');
  }
  parameter.kepadatanJiwaKm2 = kepadatan;

  const radiusKm = hitungRadiusKm({ jiwa: jiwaTerlayani, kepadatan, porsiTersambung: parameter.porsiTersambung });
  hasil.radiusKm = bulat(radiusKm, 2);
  const lingkaran = turf.circle([item.longitude, item.latitude], radiusKm, { steps: LANGKAH_LINGKARAN, units: 'kilometers' });

  if (!tersedia) {
    hasil.area = lingkaran;
    hasil.luasAreaKm2 = bulat(turf.area(lingkaran) / 1e6, 2);
    return hasil;
  }

  // Kab/kota layanan dari data; dipakai hanya bila lokasi titik memang berada di salah satunya
  const layanan = kabkotaLayanan(item.wilayahLayanan);
  const batasiLayanan = layanan.length > 0 && lokasiKec && layanan.includes(lokasiKec.feature.properties.wilayahNama);
  if (layanan.length > 0 && !batasiLayanan) {
    catatan.push(`Wilayah layanan tercatat "${item.wilayahLayanan}" tidak memuat lokasi titik, sehingga tidak dipakai sebagai batas.`);
  }

  const bboxLingkaran = turf.bbox(lingkaran);
  const potongan = [];
  for (const kec of loadBatas().kecamatan) {
    if (!bboxBeririsan(kec.bbox, bboxLingkaran)) continue;
    if (batasiLayanan && !layanan.includes(kec.feature.properties.wilayahNama)) continue;
    let irisan = null;
    try {
      irisan = turf.intersect(turf.featureCollection([lingkaran, kec.feature]));
    } catch (err) {
      // Satu polygon kecamatan yang tidak valid tidak boleh menggagalkan seluruh analisis
      console.warn(`Cakupan: irisan dengan kecamatan ${kec.key} gagal dihitung (${err.message})`);
    }
    if (!irisan) continue;
    const luas = turf.area(irisan) / 1e6;
    if (luas <= 0) continue;
    potongan.push({ kec, irisan, luas });
  }

  if (potongan.length === 0) {
    hasil.area = lingkaran;
    hasil.luasAreaKm2 = bulat(turf.area(lingkaran) / 1e6, 2);
    catatan.push('Lokasi berada di luar batas kecamatan (mis. di laut/pesisir): area tidak dipotong.');
    return hasil;
  }

  const totalLuas = potongan.reduce((sum, p) => sum + p.luas, 0);
  hasil.luasAreaKm2 = bulat(totalLuas, 2);
  hasil.area = {
    type: 'Feature',
    properties: { nodeId: item.nodeId, radiusKm: hasil.radiusKm },
    geometry: {
      type: 'MultiPolygon',
      coordinates: potongan.flatMap(({ irisan }) =>
        irisan.geometry.type === 'Polygon' ? [irisan.geometry.coordinates] : irisan.geometry.coordinates),
    },
  };

  hasil.wilayahTercakup = potongan
    .map(({ kec, luas }) => {
      const p = kec.feature.properties;
      return {
        kecamatan: p.nama,
        wilayahNama: p.wilayahNama,
        provinsi: p.provinsi,
        persenKecamatan: bulat(Math.min(100, (luas / p.luasKm2) * 100), 1),
        persenArea: bulat((luas / totalLuas) * 100, 1),
        perkiraanJiwa: Math.round((jiwaTerlayani * luas) / totalLuas),
      };
    })
    .filter((w) => w.persenArea >= 0.5)
    .sort((a, b) => b.perkiraanJiwa - a.perkiraanJiwa);
  hasil.kabkotaTercakup = [...new Set(hasil.wilayahTercakup.map((w) => w.wilayahNama))];
  return hasil;
}

// Versi ringkas tanpa geometri, untuk daftar & asisten AI
function ringkasAnalisis(a) {
  if (!a.dihitung) {
    return { nodeId: a.nodeId, nama: a.nama, jenisFasilitas: a.jenisFasilitas, wilayahNama: a.wilayahNama, dihitung: false, alasan: a.alasan };
  }
  const { area, lokasi, id, ...rest } = a;
  return rest;
}

// ============================================================================
// Analisis wilayah & pencarian
// ============================================================================
function filterWilayah(facilities, { provinsi, wilayah } = {}) {
  return facilities.filter((f) =>
    (!provinsi || provinsi === 'all' || f.provinsi === provinsi) &&
    (!wilayah || wilayah === 'all' || f.wilayahNama === wilayah));
}

function pendudukWilayah({ provinsi, wilayah } = {}) {
  const b = loadBatas();
  if (!b.tersedia) return null;
  if (wilayah && wilayah !== 'all') return b.kabkota.get(wilayah)?.properties.penduduk ?? null;
  if (provinsi && provinsi !== 'all') return b.provinsi.get(provinsi)?.properties.penduduk ?? null;
  return [...b.provinsi.values()].reduce((sum, f) => sum + f.properties.penduduk, 0);
}

function kecamatanDiWilayah({ provinsi, wilayah } = {}) {
  return loadBatas().kecamatan.filter(({ feature: { properties: p } }) =>
    (!provinsi || provinsi === 'all' || p.provinsi === provinsi) &&
    (!wilayah || wilayah === 'all' || p.wilayahNama === wilayah));
}

function ringkasanWilayah(facilities, { provinsi, wilayah } = {}) {
  const daftar = filterWilayah(facilities, { provinsi, wilayah });
  const analisis = daftar.map(analisisCakupan);
  const dihitung = analisis.filter((a) => a.dihitung);
  const aktif = dihitung.filter((a) => a.peran !== 'potensi');
  const potensi = dihitung.filter((a) => a.peran === 'potensi');

  const totalSR = aktif.reduce((sum, a) => sum + a.srLayanan, 0);
  const totalJiwa = totalSR * cfg.JIWA_PER_SR;
  const penduduk = pendudukWilayah({ provinsi, wilayah });

  const tercakup = new Set(dihitung.flatMap((a) => a.wilayahTercakup.map((w) => `${w.wilayahNama}|${w.kecamatan}`)));
  const semuaKec = kecamatanDiWilayah({ provinsi, wilayah });
  const tanpaLayanan = semuaKec.filter((k) => !tercakup.has(k.key)).map((k) => ({
    kecamatan: k.feature.properties.nama,
    wilayahNama: k.feature.properties.wilayahNama,
    penduduk: k.feature.properties.penduduk,
  }));

  return {
    wilayah: wilayah && wilayah !== 'all' ? wilayah : provinsi && provinsi !== 'all' ? provinsi : 'Pulau Jawa (6 provinsi)',
    jumlahTitik: daftar.length,
    jumlahSumberDihitung: aktif.length,
    jumlahPotensi: potensi.length,
    jumlahDataAsli: dihitung.filter((a) => a.sumberSR === 'data').length,
    jumlahKantorTanpaData: analisis.filter((a) => !a.dihitung && a.peran === 'kantor').length,
    totalKapasitasSR: totalSR,
    totalJiwaTerlayani: totalJiwa,
    potensiSR: potensi.reduce((sum, a) => sum + a.srLayanan, 0),
    penduduk,
    persenPendudukTerlayani: penduduk ? bulat((totalJiwa / penduduk) * 100, 2) : null,
    jumlahKecamatan: semuaKec.length,
    jumlahKecamatanTercakup: semuaKec.length - tanpaLayanan.length,
    kecamatanTanpaLayanan: tanpaLayanan.sort((a, b) => b.penduduk - a.penduduk),
    sumberTerbesar: [...aktif].sort((a, b) => b.srLayanan - a.srLayanan).slice(0, 5)
      .map((a) => ({ nodeId: a.nodeId, nama: a.nama, srLayanan: a.srLayanan, sumberSR: a.sumberSR })),
    catatan: 'Estimasi model: kapasitas dari debit (data atau nilai tipikal), dibandingkan dengan penduduk BPS 2020. Hanya sumber yang berada di dalam wilayah ini yang dihitung; kantor PDAM tanpa data debit/jumlah SR belum ikut dihitung, sehingga persentase ini batas bawah.',
  };
}

// Sama dengan normalisasiTeks, ditambah membuang awalan "Kec."/"Kecamatan"
// Ringkasan wilayah di-cache per "versi data": jumlah titik, jumlah id, dan updatedAt terbaru.
// Tambah/ubah/hapus/pulihkan titik mengubah versi ini, sehingga cache lama otomatis tidak terpakai.
const cacheRingkasan = new Map();

function versiData(facilities) {
  let jumlahId = 0;
  let terbaru = 0;
  for (const f of facilities) {
    jumlahId += f.id;
    terbaru = Math.max(terbaru, new Date(f.updatedAt || 0).getTime());
  }
  return `${facilities.length}:${jumlahId}:${terbaru}`;
}

function ringkasanWilayahCached(facilities, { provinsi, wilayah } = {}) {
  const key = `${versiData(facilities)}|${provinsi || 'all'}|${wilayah || 'all'}`;
  return ambilAtauHitung(cacheRingkasan, key, 100, () => ringkasanWilayah(facilities, { provinsi, wilayah }));
}

const normal = (s) => normalisasiTeks(String(s || '').toLowerCase().replace(/^(kec(amatan)?\.?\s+)/, ''));

function cariKecamatan(namaKec, wilayah) {
  const target = normal(namaKec);
  const targetWil = normal(wilayah).replace(/^(kabupaten|kab|kota)\s+/, '');
  const cocok = loadBatas().kecamatan.filter(({ feature: { properties: p } }) =>
    normal(p.nama) === target && (!targetWil || normal(p.wilayahNama).includes(targetWil)));
  if (cocok.length) return cocok;
  return loadBatas().kecamatan.filter(({ feature: { properties: p } }) =>
    normal(p.nama).includes(target) && (!targetWil || normal(p.wilayahNama).includes(targetWil))).slice(0, 5);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  return turf.distance([lon1, lat1], [lon2, lat2]);
}

function sumberMelayaniKecamatan(facilities, namaKec, wilayah) {
  return cariKecamatan(namaKec, wilayah).map((kec) => {
    const [lng, lat] = turf.centroid(kec.feature).geometry.coordinates;
    const kandidat = facilities.filter((f) => haversineKm(lat, lng, f.latitude, f.longitude) <= cfg.RADIUS_MAX_KM + 25);
    const melayani = kandidat
      .map(analisisCakupan)
      .filter((a) => a.dihitung)
      .map((a) => ({ a, w: a.wilayahTercakup.find((w) => `${w.wilayahNama}|${w.kecamatan}` === kec.key) }))
      .filter(({ w }) => w)
      .sort((x, y) => y.w.perkiraanJiwa - x.w.perkiraanJiwa)
      .map(({ a, w }) => ({
        nodeId: a.nodeId,
        nama: a.nama,
        jenisFasilitas: a.jenisFasilitas,
        peran: a.peran,
        perkiraanJiwaDiKecamatan: w.perkiraanJiwa,
        persenKecamatanTercakup: w.persenKecamatan,
        sumberSR: a.sumberSR,
      }));
    const terdekat = melayani.length ? [] : sumberTerdekat(facilities, lat, lng, 3);
    const p = kec.feature.properties;
    return {
      kecamatan: p.nama,
      wilayahNama: p.wilayahNama,
      provinsi: p.provinsi,
      penduduk: p.penduduk,
      sumber: melayani,
      sumberTerdekatBilaKosong: terdekat,
    };
  });
}

function sumberTerdekat(facilities, lat, lng, jumlah = 5) {
  return facilities
    .map((f) => ({ f, jarak: haversineKm(lat, lng, f.latitude, f.longitude) }))
    .filter(({ f }) => profilFasilitas(f).peran !== 'bukan')
    .sort((a, b) => a.jarak - b.jarak)
    .slice(0, jumlah)
    .map(({ f, jarak }) => {
      const a = analisisCakupan(f);
      const dalamArea = Boolean(a.area && turf.booleanPointInPolygon(turf.point([lng, lat]), a.area));
      return {
        nodeId: f.nodeId,
        nama: f.nama || f.jenisFasilitas,
        jenisFasilitas: f.jenisFasilitas,
        wilayahNama: f.wilayahNama,
        jarakKm: bulat(jarak, 2),
        cakupanDihitung: a.dihitung,
        lokasiDalamAreaLayanan: dalamArea,
      };
    });
}

function cariFasilitas(facilities, { query, provinsi, kabkota, kategori, jenisFasilitas } = {}, batasJumlah = 10) {
  const q = normal(query);
  const wil = normal(kabkota).replace(/^(kabupaten|kab|kota)\s+/, '');
  const hasil = facilities.filter((f) =>
    (!provinsi || normal(f.provinsi) === normal(provinsi)) &&
    (!wil || normal(f.wilayahNama).includes(wil)) &&
    (!kategori || normal(f.kategori) === normal(kategori)) &&
    (!jenisFasilitas || normal(f.jenisFasilitas).includes(normal(jenisFasilitas))) &&
    (!q || [f.nodeId, f.nama, f.kecamatan, f.desaKelurahan, f.alamat, f.wilayahNama, f.pengelolaNama]
      .some((v) => normal(v).includes(q))));
  return {
    total: hasil.length,
    data: hasil.slice(0, batasJumlah).map((f) => ({
      nodeId: f.nodeId,
      nama: f.nama || f.jenisFasilitas,
      kategori: f.kategori,
      jenisFasilitas: f.jenisFasilitas,
      kecamatan: f.kecamatan,
      wilayahNama: f.wilayahNama,
      provinsi: f.provinsi,
      statusOperasional: f.statusOperasional,
      debitLps: f.debitLps,
      jumlahSR: f.jumlahSR,
    })),
  };
}

module.exports = {
  loadBatas,
  hitungKapasitasSR,
  hitungRadiusKm,
  analisisCakupan,
  ringkasAnalisis,
  ringkasanWilayah,
  ringkasanWilayahCached,
  sumberMelayaniKecamatan,
  sumberTerdekat,
  cariFasilitas,
  profilFasilitas,
};

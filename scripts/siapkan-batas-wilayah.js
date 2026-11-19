/**
 * Siapkan batas wilayah Pulau Jawa (provinsi, kab/kota, kecamatan) untuk peta dan analisis cakupan.
 *
 * Sumber (diunduh sekali, disimpan di database/batas_cache/):
 * - Batas kab/kota (ADM2) & kecamatan (ADM3): geoBoundaries gbHumanitarian IDN, versi simplified,
 *   berasal dari OCHA ROAP / BPS 2019 (CC BY 3.0 IGO).
 * - Penduduk kab/kota 2020: HDX COD-PS Indonesia (BPS, idn_admpop_adm2_2020_v3.csv).
 *   Data penduduk kecamatan tidak tersedia terbuka, sehingga penduduk kab/kota dibagi ke kecamatan
 *   menurut luas (kepadatan dianggap rata dalam satu kab/kota).
 *
 * Hasil (di-commit ke repo, dipakai frontend & server):
 *   public/data/batas/jawa-pulau.geojson         : daratan 6 provinsi Jawa (untuk mask "hanya Jawa")
 *   public/data/batas/jawa-provinsi.geojson      : 6 provinsi
 *   public/data/batas/jawa-kabkota.geojson       : 119 kab/kota + penduduk & kepadatan
 *   public/data/batas/kecamatan/<provinsi>.geojson
 *   public/data/batas/index.json                 : daftar file & atribusi
 *
 * Pemakaian:
 *   npm run batas
 *   npm run batas -- --unduh-ulang     # abaikan cache unduhan
 */
const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');
const mapshaper = require('mapshaper');

const ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'database', 'batas_cache');
const OUT_DIR = path.join(ROOT, 'public', 'data', 'batas');

const GB = 'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbHumanitarian/IDN';
const SUMBER = {
  adm2: { url: `${GB}/ADM2/geoBoundaries-IDN-ADM2_simplified.geojson`, file: 'idn_adm2_simplified.geojson' },
  adm3: { url: `${GB}/ADM3/geoBoundaries-IDN-ADM3_simplified.geojson`, file: 'idn_adm3_simplified.geojson' },
  penduduk: {
    url: 'https://data.humdata.org/dataset/7e00297b-7b5b-4a98-932d-509f298fd8a8/resource/8f6f09d2-95f7-42dc-b6f1-aead319607f3/download/idn_admpop_adm2_2020_v3.csv',
    file: 'idn_admpop_adm2_2020_v3.csv',
  },
};

// Nama provinsi di data sumber → nama provinsi di database (urutan barat → timur, sama dengan seed)
const PROVINSI = {
  'Banten': 'Banten',
  'Dki Jakarta': 'DKI Jakarta',
  'Jawa Barat': 'Jawa Barat',
  'Jawa Tengah': 'Jawa Tengah',
  'Daerah Istimewa Yogyakarta': 'DI Yogyakarta',
  'Jawa Timur': 'Jawa Timur',
};

// Ejaan nama kabupaten di sumber yang berbeda dengan database
const ALIAS_KAB = { 'Gunung Kidul': 'Gunungkidul' };

// Batas kasar Jawa, hanya untuk menyaring kandidat sebelum uji titik-dalam-polygon
const JAWA_BBOX = [105.0, -9.0, 116.5, -5.0];

const PRESISI = 5; // 5 desimal derajat ≈ 1 m

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function namaDb(adm2) {
  if (/^Kota /.test(adm2)) return adm2;
  return `Kabupaten ${ALIAS_KAB[adm2] || adm2}`;
}

async function unduh({ url, file }, ulang) {
  const target = path.join(CACHE_DIR, file);
  if (!ulang && fs.existsSync(target) && fs.statSync(target).size > 0) return target;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`⬇  Mengunduh ${file} ...`);
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60 * 60 * 1000) });
  if (!res.ok) throw new Error(`Gagal mengunduh ${url} (HTTP ${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(`${target}.part`, buffer);
  fs.renameSync(`${target}.part`, target);
  return target;
}

function bacaGeoJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// CSV sederhana (tanpa tanda kutip di nama wilayah)
function bacaPenduduk(file) {
  const [header, ...lines] = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  const cols = header.split(',');
  const idx = (name) => cols.indexOf(name);
  const result = new Map();
  for (const line of lines) {
    const v = line.split(',');
    const provinsi = PROVINSI[v[idx('ADM1_EN')]];
    if (!provinsi) continue;
    result.set(v[idx('ADM2_EN')], { provinsi, kode: v[idx('ADM2_PCODE')], penduduk: Number(v[idx('T_TL')]) });
  }
  return result;
}

function dalamBbox(feature) {
  const [minX, minY, maxX, maxY] = turf.bbox(feature);
  return maxX >= JAWA_BBOX[0] && minX <= JAWA_BBOX[2] && maxY >= JAWA_BBOX[1] && minY <= JAWA_BBOX[3];
}

function bulatkan(feature) {
  return turf.truncate(feature, { precision: PRESISI, coordinates: 2, mutate: true });
}

async function mapshaperRun(command, input) {
  const output = await mapshaper.applyCommands(command, input);
  return JSON.parse(output['out.json']);
}

function tulis(file, data) {
  const target = path.join(OUT_DIR, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(data));
  const kb = (fs.statSync(target).size / 1024).toFixed(0);
  console.log(`   📝 ${path.relative(ROOT, target)} (${kb} KB)`);
}

async function main() {
  const ulang = process.argv.includes('--unduh-ulang');
  const files = {};
  for (const [key, sumber] of Object.entries(SUMBER)) files[key] = await unduh(sumber, ulang);

  // ─── Penduduk & kab/kota ────────────────────────────────────────────────
  const penduduk = bacaPenduduk(files.penduduk);
  console.log(`👥 Penduduk 2020: ${penduduk.size} kab/kota Jawa`);

  const adm2 = bacaGeoJSON(files.adm2);
  const kabkota = [];
  const ekstra = []; // area non-administratif di dalam Jawa (waduk, hutan) ikut membentuk daratan provinsi
  for (const f of adm2.features) {
    if (!dalamBbox(f)) continue;
    const nama = f.properties.shapeName;
    const info = penduduk.get(nama);
    if (info) {
      const luasKm2 = turf.area(f) / 1e6;
      kabkota.push(bulatkan({
        type: 'Feature',
        properties: {
          nama: namaDb(nama),
          provinsi: info.provinsi,
          tipe: /^Kota /.test(nama) ? 'KOTA' : 'KABUPATEN',
          kode: info.kode,
          penduduk: info.penduduk,
          luasKm2: Math.round(luasKm2 * 10) / 10,
          kepadatan: Math.round(info.penduduk / luasKm2),
        },
        geometry: f.geometry,
      }));
    } else if (/waduk|wadung|hutan|danau/i.test(nama)) {
      ekstra.push({ nama, feature: f });
    }
  }
  const hilang = [...penduduk.keys()].filter((nama) => !kabkota.some((k) => k.properties.kode === penduduk.get(nama).kode));
  console.log(`🗺  Kab/kota dengan batas: ${kabkota.length}${hilang.length ? ` (tanpa batas: ${hilang.join(', ')})` : ''}`);

  // Area ekstra diberi provinsi dari kab/kota terdekat agar daratan provinsi tidak berlubang
  const pusatKab = kabkota.map((k) => ({ provinsi: k.properties.provinsi, pusat: turf.centroid(k) }));
  const ekstraFeatures = ekstra.map(({ nama, feature }) => {
    const pusat = turf.centroid(feature);
    const terdekat = pusatKab.reduce((best, k) => {
      const d = turf.distance(pusat, k.pusat);
      return !best || d < best.d ? { d, provinsi: k.provinsi } : best;
    }, null);
    console.log(`   ↳ area non-administratif "${nama}" digabung ke daratan ${terdekat.provinsi}`);
    return bulatkan({ type: 'Feature', properties: { provinsi: terdekat.provinsi }, geometry: feature.geometry });
  });

  // ─── Provinsi & daratan Jawa (dissolve dengan mapshaper agar celah antar-polygon tertutup) ───
  const daratan = {
    type: 'FeatureCollection',
    features: [
      ...kabkota.map((k) => ({ type: 'Feature', properties: { provinsi: k.properties.provinsi }, geometry: k.geometry })),
      ...ekstraFeatures,
    ],
  };
  const provinsiFc = await mapshaperRun(
    `-i daratan.json -clean gap-fill-area=1km2 -dissolve2 provinsi -o out.json format=geojson geojson-type=FeatureCollection precision=0.00001`,
    { 'daratan.json': daratan }
  );
  const urutan = Object.values(PROVINSI);
  provinsiFc.features.sort((a, b) => urutan.indexOf(a.properties.provinsi) - urutan.indexOf(b.properties.provinsi));
  for (const f of provinsiFc.features) {
    const anggota = kabkota.filter((k) => k.properties.provinsi === f.properties.provinsi);
    f.properties = {
      nama: f.properties.provinsi,
      slug: slug(f.properties.provinsi),
      penduduk: anggota.reduce((sum, k) => sum + k.properties.penduduk, 0),
      jumlahKabKota: anggota.length,
    };
  }

  const pulauFc = await mapshaperRun(
    `-i daratan.json -clean gap-fill-area=1km2 -dissolve2 -o out.json format=geojson geojson-type=FeatureCollection precision=0.00001`,
    { 'daratan.json': daratan }
  );
  pulauFc.features.forEach((f) => { f.properties = { nama: 'Pulau Jawa (6 provinsi)' }; });

  // ─── Kecamatan: dicocokkan ke kab/kota lewat titik di dalam polygon ─────
  // Setiap bagian polygon (pulau) memberi suara seluas bagiannya. Kecamatan kepulauan/pesisir
  // (Kep. Seribu, Karimunjawa, Kangean) tetap cocok walau pulau kecilnya hilang saat penyederhanaan,
  // sedangkan polygon Lampung/Bali di dekat Jawa tidak mendapat suara sama sekali.
  const adm3 = bacaGeoJSON(files.adm3);
  const kabIndex = kabkota.map((k) => ({ feature: k, bbox: turf.bbox(k) }));
  const kabDiTitik = (titik) => {
    const [x, y] = titik.geometry.coordinates;
    return kabIndex.find(({ feature, bbox }) =>
      x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3] && turf.booleanPointInPolygon(titik, feature));
  };
  const kecamatanPerKab = new Map();
  let dilewati = 0;
  for (const f of adm3.features) {
    if (!dalamBbox(f)) continue;
    const nama = f.properties.shapeName;
    if (/^(waduk|wadung|hutan|danau)\b/i.test(nama)) continue;
    const bagian = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const suara = new Map();
    for (const rings of bagian) {
      const poly = turf.polygon(rings);
      const hit = kabDiTitik(turf.pointOnFeature(poly));
      if (hit) suara.set(hit, (suara.get(hit) || 0) + turf.area(poly));
    }
    const kab = [...suara].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!kab) {
      dilewati++;
      continue;
    }
    const key = kab.feature.properties.nama;
    if (!kecamatanPerKab.has(key)) kecamatanPerKab.set(key, []);
    kecamatanPerKab.get(key).push({ nama, geometry: f.geometry, luasKm2: turf.area(f) / 1e6 });
  }

  const kecamatanPerProvinsi = new Map();
  for (const k of kabkota) {
    const daftar = kecamatanPerKab.get(k.properties.nama) || [];
    const totalLuas = daftar.reduce((sum, kec) => sum + kec.luasKm2, 0);
    for (const kec of daftar) {
      // Penduduk kab/kota dibagi menurut luas (kepadatan rata dalam satu kab/kota)
      const pendudukKec = totalLuas > 0 ? Math.round((k.properties.penduduk * kec.luasKm2) / totalLuas) : 0;
      const prov = k.properties.provinsi;
      if (!kecamatanPerProvinsi.has(prov)) kecamatanPerProvinsi.set(prov, []);
      kecamatanPerProvinsi.get(prov).push(bulatkan({
        type: 'Feature',
        properties: {
          nama: kec.nama,
          wilayahNama: k.properties.nama,
          provinsi: prov,
          luasKm2: Math.round(kec.luasKm2 * 10) / 10,
          penduduk: pendudukKec,
          kepadatan: kec.luasKm2 > 0 ? Math.round(pendudukKec / kec.luasKm2) : 0,
        },
        geometry: kec.geometry,
      }));
    }
  }
  const tanpaKecamatan = kabkota.filter((k) => !kecamatanPerKab.has(k.properties.nama)).map((k) => k.properties.nama);
  const totalKec = [...kecamatanPerProvinsi.values()].reduce((sum, list) => sum + list.length, 0);
  console.log(`🏘  Kecamatan: ${totalKec}${dilewati ? ` (${dilewati} polygon di sekitar Jawa bukan bagian 6 provinsi dilewati)` : ''}`);
  if (tanpaKecamatan.length) console.log(`   ⚠ Kab/kota tanpa kecamatan: ${tanpaKecamatan.join(', ')}`);

  // ─── Tulis hasil ────────────────────────────────────────────────────────
  console.log('\n💾 Menulis hasil:');
  tulis('jawa-pulau.geojson', pulauFc);
  tulis('jawa-provinsi.geojson', provinsiFc);
  tulis('jawa-kabkota.geojson', { type: 'FeatureCollection', features: kabkota });
  const indexProvinsi = [];
  for (const prov of urutan) {
    const features = kecamatanPerProvinsi.get(prov) || [];
    const file = `kecamatan/${slug(prov)}.geojson`;
    tulis(file, { type: 'FeatureCollection', features });
    indexProvinsi.push({ nama: prov, slug: slug(prov), kecamatan: file, jumlahKecamatan: features.length });
  }
  tulis('index.json', {
    dibuat: new Date().toISOString().slice(0, 10),
    atribusi: 'Batas wilayah: geoBoundaries gbHumanitarian (OCHA ROAP/BPS 2019, CC BY 3.0 IGO). Penduduk: HDX COD-PS Indonesia 2020 (BPS).',
    catatanPenduduk: 'Penduduk kecamatan = penduduk kab/kota 2020 dibagi menurut luas (estimasi).',
    pulau: 'jawa-pulau.geojson',
    provinsi: 'jawa-provinsi.geojson',
    kabkota: 'jawa-kabkota.geojson',
    daftarProvinsi: indexProvinsi,
  });

  // ─── Cocokkan dengan nama wilayah di database (bila tersedia) ───────────
  try {
    const prisma = require('../config/database');
    const wilayah = await prisma.wilayah.findMany();
    await prisma.$disconnect();
    const namaBatas = new Set(kabkota.map((k) => k.properties.nama));
    const tidakCocok = wilayah.filter((w) => !namaBatas.has(w.nama)).map((w) => w.nama);
    console.log(tidakCocok.length
      ? `\n⚠ Wilayah di database tanpa batas: ${tidakCocok.join(', ')}`
      : `\n✅ Semua ${wilayah.length} kab/kota di database punya batas wilayah.`);
  } catch (err) {
    console.log(`\n(i) Pencocokan dengan database dilewati: ${err.message}`);
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});

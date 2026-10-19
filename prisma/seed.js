/**
 * Seeder database dari xlsx titik air se-Pulau Jawa.
 *
 * Default membaca database/Titik Air Se Jawa.xlsx. File lain bisa dipakai:
 * `node prisma/seed.js path/ke/file.xlsx` atau env SEED_XLSX.
 * Semua sheet yang header-nya memuat Nama, Latitude, dan Longitude dibaca
 * (sheet Ringkasan & Catatan otomatis dilewati).
 * Sumber & aturan pemetaan data dijelaskan di SUMBER_DATA.md.
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const prisma = require('../config/database');
const { KATEGORI } = require('../config/constants');

const DEFAULT_XLSX = path.join(__dirname, '..', 'database', 'Titik Air Se Jawa.xlsx');
const NODE_ID_PREFIX = 'JAWA-';

// Urutan barat → timur, sama dengan sheet Ringkasan
const PROVINSI_ORDER = ['Banten', 'DKI Jakarta', 'Jawa Barat', 'Jawa Tengah', 'DI Yogyakarta', 'Jawa Timur'];

// Kolom "Kategori" di xlsx → kategori pengelola & jenis fasilitas di aplikasi
const KATEGORI_XLSX = [
  { match: /^kantor pdam/i,     kategori: 'Perumda',       jenis: 'Kantor PDAM (Pusat/Utama)' },
  { match: /^kantor cabang/i,   kategori: 'Perumda',       jenis: 'Kantor Cabang/Unit PDAM' },
  { match: /^instalasi pdam/i,  kategori: 'Perumda',       jenis: 'Instalasi PDAM (IPA/Intake/Reservoar)' },
  { match: /^reservoar/i,       kategori: 'Perumda',       jenis: 'Reservoar PDAM' },
  { match: /^ipal/i,            kategori: 'Perumda',       jenis: 'IPAL' },
  { match: /^rumah pompa/i,     kategori: 'Pemda',         jenis: 'Rumah Pompa' },
  { match: /^kolam retensi/i,   kategori: 'Kolam Retensi', jenis: 'Kolam Retensi' },
  { match: /^pamsimas/i,        kategori: 'Pamsimas',      jenis: 'Pamsimas' },
];

const REQUIRED_HEADERS = ['Nama', 'Latitude', 'Longitude'];

const optionalText = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim() || null;
const expandKab = (text) => text.replace(/\bKab\.\s*/g, 'Kabupaten ');
const stripParenthetical = (text) => text.replace(/\s*\([^)]*\)\s*$/, '').trim();

// Isi sel sebagai teks; kolom link mengambil URL hyperlink-nya
function cellText(cell, { preferLink = false } = {}) {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (preferLink && value.hyperlink) return value.hyperlink;
    if (value.richText) return value.richText.map((part) => part.text).join('');
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    if (value instanceof Date) return value.toISOString();
  }
  return String(value);
}

// "Kab. Lebak" → "Kabupaten Lebak"; "Jakarta Pusat" (DKI) → "Kota Jakarta Pusat"
function normalizeWilayah(raw, provinsi) {
  let nama = expandKab(optionalText(raw) || '');
  if (provinsi === 'DKI Jakarta' && /^Jakarta /.test(nama)) nama = `Kota ${nama}`;
  if (!/^(Kota|Kabupaten) \S/.test(nama)) return null;
  return nama;
}

function wilayahKode(nama) {
  return nama.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// xlsx tidak punya kolom pengelola, jadi ditentukan dari kategori, nama, dan wilayah layanan
function resolvePengelola({ kategori, nama, wilayahNama, wilayahLayanan, provinsi }) {
  if (kategori === 'Pamsimas') return { nama: 'KPSPAMS (Pengelola Pamsimas Desa)', tipe: 'PAMSIMAS' };

  if (kategori === 'Pemda' || kategori === 'Kolam Retensi') {
    const pemda = provinsi === 'DKI Jakarta' ? 'Pemerintah Provinsi DKI Jakarta' : `Pemerintah ${wilayahNama}`;
    return { nama: pemda, tipe: 'PEMDA' };
  }

  if (/^PT\s/.test(nama)) return { nama: stripParenthetical(nama.split(' - ')[0]), tipe: 'PERUMDA' };
  if (wilayahLayanan === 'DKI Jakarta') return { nama: 'Perumda PAM JAYA', tipe: 'PERUMDA' };
  // "Kab. Serang dan Kota Serang" / "Kab. Bekasi (dan sebagian Kota Bekasi)" → PDAM wilayah pertama
  const layanan = wilayahLayanan ? stripParenthetical(expandKab(wilayahLayanan).split(' dan ')[0]) : wilayahNama;
  return { nama: `PDAM ${layanan}`, tipe: 'PERUMDA' };
}

const provinsiRank = (provinsi) => {
  const index = PROVINSI_ORDER.indexOf(provinsi);
  return index === -1 ? PROVINSI_ORDER.length : index;
};

async function readWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const rows = [];
  const skipped = [];

  workbook.eachSheet((sheet) => {
    const columns = {};
    sheet.getRow(1).eachCell((cell, colNumber) => {
      columns[cellText(cell).trim()] = colNumber;
    });
    if (!REQUIRED_HEADERS.every((header) => columns[header])) return;

    const get = (row, header, options) => (columns[header] ? cellText(row.getCell(columns[header]), options) : '');

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const label = `${sheet.name} baris ${rowNumber}`;
      const nama = optionalText(get(row, 'Nama'));
      if (!nama) return; // baris kosong

      const latitude = parseFloat(get(row, 'Latitude').replace(',', '.'));
      const longitude = parseFloat(get(row, 'Longitude').replace(',', '.'));
      if (!(latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180)) {
        skipped.push(`${label} (koordinat tidak valid)`);
        return;
      }

      const kategoriXlsx = optionalText(get(row, 'Kategori')) || '';
      const mapping = KATEGORI_XLSX.find((k) => k.match.test(kategoriXlsx));
      if (!mapping) {
        skipped.push(`${label} (kategori "${kategoriXlsx}" tidak dikenal)`);
        return;
      }

      const provinsi = optionalText(get(row, 'Provinsi')) || '';
      const wilayahNama = normalizeWilayah(get(row, 'Kab/Kota (alamat)'), provinsi);
      if (!wilayahNama) {
        skipped.push(`${label} (kab/kota "${get(row, 'Kab/Kota (alamat)')}" tidak dikenal)`);
        return;
      }

      const wilayahLayanan = optionalText(get(row, 'Wilayah layanan'));
      rows.push({
        nama,
        kategori: mapping.kategori,
        jenisFasilitas: mapping.jenis,
        provinsi,
        wilayahNama,
        kecamatan: optionalText(get(row, 'Kecamatan')),
        desaKelurahan: optionalText(get(row, 'Desa/Kelurahan')),
        alamat: optionalText(get(row, 'Alamat (Google Maps)')),
        wilayahLayanan,
        latitude,
        longitude,
        statusVerifikasi: optionalText(get(row, 'Status')),
        catatanData: optionalText(get(row, 'Catatan')),
        sumberData: optionalText(get(row, 'Sumber data')) || 'Google Maps',
        sumberUrl: optionalText(get(row, 'Link Google Maps', { preferLink: true })),
        pengelola: resolvePengelola({ kategori: mapping.kategori, nama, wilayahNama, wilayahLayanan, provinsi }),
      });
    });
  });

  rows.sort((a, b) =>
    provinsiRank(a.provinsi) - provinsiRank(b.provinsi) ||
    a.provinsi.localeCompare(b.provinsi) ||
    a.wilayahNama.localeCompare(b.wilayahNama) ||
    KATEGORI.indexOf(a.kategori) - KATEGORI.indexOf(b.kategori) ||
    a.nama.localeCompare(b.nama)
  );

  return { rows, skipped };
}

async function seed() {
  console.log('🌱 Starting multi-table database seeding...\n');

  const xlsxPath = path.resolve(process.argv[2] || process.env.SEED_XLSX || DEFAULT_XLSX);

  if (!fs.existsSync(xlsxPath)) {
    console.error(`❌ File xlsx tidak ditemukan: ${xlsxPath}`);
    process.exit(1);
  }

  // ─── STEP 1: Baca xlsx (sebelum menghapus data, agar file rusak tidak mengosongkan DB) ───
  console.log(`📄 Reading workbook: ${path.basename(xlsxPath)}`);
  const { rows, skipped } = await readWorkbook(xlsxPath);
  if (rows.length === 0) {
    console.error('❌ Tidak ada baris valid di xlsx. Database tidak diubah.');
    process.exit(1);
  }
  console.log(`   ✔ ${rows.length} valid rows read.`);
  if (skipped.length) console.log(`   ⚠ ${skipped.length} baris dilewati: ${skipped.join(', ')}`);
  console.log('');

  // ─── STEP 2: Bersihkan semua tabel (urutan penting karena ada FK) ───────
  console.log('🧹 Clearing existing data...');
  await prisma.logPembaruan.deleteMany({});
  await prisma.fasilitasAir.deleteMany({});
  await prisma.pengelola.deleteMany({});
  await prisma.wilayah.deleteMany({});
  console.log('   ✔ All tables cleared.\n');

  // ─── STEP 3: Seed tabel Wilayah (urutan baris sudah per provinsi barat → timur) ───
  console.log('📍 Seeding Wilayah master data...');
  const wilayahEntries = new Map(rows.map((r) => [r.wilayahNama, r.provinsi]));
  for (const [nama, provinsi] of wilayahEntries) {
    await prisma.wilayah.create({
      data: { kode: wilayahKode(nama), nama, tipe: nama.startsWith('Kota ') ? 'KOTA' : 'KABUPATEN', provinsi },
    });
  }
  const wilayahList = await prisma.wilayah.findMany();
  const wilayahMap = Object.fromEntries(wilayahList.map((w) => [w.nama, w.id]));
  console.log(`   ✔ ${wilayahList.length} Wilayah records created.\n`);

  // ─── STEP 4: Seed tabel Pengelola ───────────────────────────────────────
  console.log('🏢 Seeding Pengelola master data...');
  const pengelolaEntries = new Map(rows.map((r) => [r.pengelola.nama, r.pengelola.tipe]));
  for (const nama of [...pengelolaEntries.keys()].sort()) {
    await prisma.pengelola.create({ data: { nama, tipe: pengelolaEntries.get(nama) } });
  }
  const pengelolaList = await prisma.pengelola.findMany();
  const pengelolaMap = Object.fromEntries(pengelolaList.map((p) => [p.nama, p.id]));
  console.log(`   ✔ ${pengelolaList.length} Pengelola records created.\n`);

  // ─── STEP 5: Seed tabel FasilitasAir ────────────────────────────────────
  console.log('💧 Seeding FasilitasAir records...');
  const data = rows.map(({ provinsi, wilayahNama, pengelola, ...row }, i) => ({
    ...row,
    no: i + 1,
    nodeId: `${NODE_ID_PREFIX}${String(i + 1).padStart(3, '0')}`,
    wilayahId: wilayahMap[wilayahNama],
    pengelolaId: pengelolaMap[pengelola.nama],
    statusOperasional: 'Beroperasi Normal',
  }));
  await prisma.fasilitasAir.createMany({ data });
  console.log(`   ✔ ${data.length} FasilitasAir records created.\n`);

  // ─── STEP 6: Ringkasan ───────────────────────────────────────────────────
  const countBy = (key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
  const byKategori = countBy('kategori');
  const byProvinsi = countBy('provinsi');

  console.log('═══════════════════════════════════════════');
  console.log('✅ Seeding COMPLETE! Database Summary:');
  console.log('═══════════════════════════════════════════');
  console.log(`   📍 Wilayah      : ${await prisma.wilayah.count()} records`);
  console.log(`   🏢 Pengelola    : ${await prisma.pengelola.count()} records`);
  console.log(`   💧 FasilitasAir : ${await prisma.fasilitasAir.count()} records`);
  console.log(`      Per kategori: ${KATEGORI.map((k) => `${k} ${byKategori[k] || 0}`).join(', ')}`);
  console.log(`      Per provinsi: ${Object.entries(byProvinsi).map(([p, n]) => `${p} ${n}`).join(', ')}`);
  console.log('═══════════════════════════════════════════');
}

seed()
  .catch((e) => {
    console.error('\n❌ Seeding error:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

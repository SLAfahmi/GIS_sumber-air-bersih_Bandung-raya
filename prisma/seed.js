const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const prisma = require('../config/database');

// ============================================================
// DATA MASTER: Wilayah (sesuai data CSV Bandung Raya)
// ============================================================
const MASTER_WILAYAH = [
  { kode: 'KBD', nama: 'Kota Bandung',           tipe: 'KOTA',       latCenter: -6.9175,  lngCenter: 107.6191 },
  { kode: 'KAB', nama: 'Kabupaten Bandung',       tipe: 'KABUPATEN',  latCenter: -7.1167,  lngCenter: 107.6500 },
  { kode: 'CMH', nama: 'Kota Cimahi',             tipe: 'KOTA',       latCenter: -6.8724,  lngCenter: 107.5420 },
  { kode: 'KBB', nama: 'Kabupaten Bandung Barat', tipe: 'KABUPATEN',  latCenter: -6.8500,  lngCenter: 107.4500 },
];

// ============================================================
// DATA MASTER: Pengelola (sesuai data CSV)
// ============================================================
const MASTER_PENGELOLA = [
  { nama: 'Perumda Tirtawening',  tipe: 'PERUMDA',       kontak: '(022) 4260490', alamat: 'Jl. Badaksinga No.10, Bandung' },
  { nama: 'Perumda Tirta Raharja',tipe: 'PERUMDA',       kontak: '(022) 5940645', alamat: 'Jl. Raya Soreang, Kabupaten Bandung' },
  { nama: 'Franchise',            tipe: 'FRANCHISE',     kontak: null,            alamat: null },
  { nama: 'Swadaya Masyarakat',   tipe: 'SWADAYA',       kontak: null,            alamat: null },
  { nama: 'Depot Mandiri',        tipe: 'DEPOT_MANDIRI', kontak: null,            alamat: null },
  { nama: 'Lainnya',              tipe: 'LAINNYA',       kontak: null,            alamat: null },
];

// Fungsi normalisasi nama wilayah dari CSV
function normalizeWilayah(raw) {
  const val = (raw || '').trim().toLowerCase();
  if (val.includes('kota bandung') || val === 'bandung') return 'Kota Bandung';
  if (val.includes('kab') && val.includes('barat')) return 'Kabupaten Bandung Barat';
  if (val.includes('kab')) return 'Kabupaten Bandung';
  if (val.includes('cimahi')) return 'Kota Cimahi';
  return 'Kota Bandung'; // default fallback
}

// Fungsi normalisasi nama pengelola dari CSV
function normalizePengelola(raw) {
  const val = (raw || '').trim().toLowerCase();
  if (val.includes('tirtawening')) return 'Perumda Tirtawening';
  if (val.includes('tirta raharja')) return 'Perumda Tirta Raharja';
  if (val.includes('franchise')) return 'Franchise';
  if (val.includes('swadaya')) return 'Swadaya Masyarakat';
  if (val.includes('depot')) return 'Depot Mandiri';
  return 'Lainnya';
}

async function seed() {
  console.log('🌱 Starting multi-table database seeding...\n');

  const csvFilePath = path.join(__dirname, '..', 'database', 'Data Air Bersih_TPWB(Data Air Bersih).csv');

  if (!fs.existsSync(csvFilePath)) {
    console.error(`❌ CSV file not found at: ${csvFilePath}`);
    process.exit(1);
  }

  // ─── STEP 1: Bersihkan semua tabel (urutan penting karena ada FK) ───────
  console.log('🧹 Clearing existing data...');
  await prisma.logPembaruan.deleteMany({});
  await prisma.riwayatUjiLab.deleteMany({});
  await prisma.fasilitasAir.deleteMany({});
  await prisma.pengelola.deleteMany({});
  await prisma.wilayah.deleteMany({});
  console.log('   ✔ All tables cleared.\n');

  // ─── STEP 2: Seed tabel Wilayah ─────────────────────────────────────────
  console.log('📍 Seeding Wilayah master data...');
  for (const w of MASTER_WILAYAH) {
    await prisma.wilayah.create({ data: { ...w, provinsi: 'Jawa Barat' } });
  }
  const wilayahList = await prisma.wilayah.findMany();
  const wilayahMap = Object.fromEntries(wilayahList.map(w => [w.nama, w.id]));
  console.log(`   ✔ ${wilayahList.length} Wilayah records created.\n`);

  // ─── STEP 3: Seed tabel Pengelola ───────────────────────────────────────
  console.log('🏢 Seeding Pengelola master data...');
  for (const p of MASTER_PENGELOLA) {
    await prisma.pengelola.create({ data: p });
  }
  const pengelolaList = await prisma.pengelola.findMany();
  const pengelolaMap = Object.fromEntries(pengelolaList.map(p => [p.nama, p.id]));
  console.log(`   ✔ ${pengelolaList.length} Pengelola records created.\n`);

  // ─── STEP 4: Baca CSV ───────────────────────────────────────────────────
  console.log('📄 Reading CSV file...');
  const rows = [];
  await new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv({ separator: ';' }))
      .on('data', (row) => {
        const rawLat = (row.Latitude || '').replace(',', '.').trim();
        const rawLng = (row.Longitude || '').replace(',', '.').trim();
        const lat = parseFloat(rawLat);
        const lng = parseFloat(rawLng);
        if (!isNaN(lat) && !isNaN(lng) && row.Node_ID) {
          rows.push(row);
        }
      })
      .on('end', () => { console.log(`   ✔ ${rows.length} valid rows read.\n`); resolve(); })
      .on('error', reject);
  });

  // ─── STEP 5: Seed tabel FasilitasAir ────────────────────────────────────
  console.log('💧 Seeding FasilitasAir records...');
  const chunkSize = 30;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const data = chunk.map(row => {
      const wilayahNama = normalizeWilayah(row.Wilayah);
      const pengelolaNama = normalizePengelola(row.Pengelola);
      const lat = parseFloat((row.Latitude || '').replace(',', '.').trim());
      const lng = parseFloat((row.Longitude || '').replace(',', '.').trim());

      return {
        no: row.No ? parseInt(row.No, 10) : null,
        nodeId: (row.Node_ID || '').trim(),
        wilayahId: wilayahMap[wilayahNama] || wilayahMap['Kota Bandung'],
        pengelolaId: pengelolaMap[pengelolaNama] || pengelolaMap['Lainnya'],
        jenisFasilitas: (row.Jenis_Fasilitas || 'Lainnya').trim(),
        latitude: lat,
        longitude: lng,
        statusOperasional: (row.Status_Operasional || 'Beroperasi Normal').trim(),
        kategoriAirMinum: (row.Kategori_Air_Minum || 'Belum siap minum').trim(),
        keteranganAirMinum: (row.Keterangan_Air_Minum || '').trim() || null,
        catatanData: (row.Catatan_Data || '').trim() || null,
      };
    });

    await prisma.fasilitasAir.createMany({ data });
    inserted += chunk.length;
    process.stdout.write(`   Progress: ${inserted}/${rows.length} records...\r`);
  }
  console.log(`\n   ✔ ${inserted} FasilitasAir records created.\n`);

  // ─── STEP 6: Seed contoh RiwayatUjiLab ──────────────────────────────────
  console.log('🧪 Seeding sample RiwayatUjiLab data...');
  const siapMinum = await prisma.fasilitasAir.findMany({
    where: { kategoriAirMinum: { contains: 'Siap minum' } },
    take: 5
  });

  for (const f of siapMinum) {
    await prisma.riwayatUjiLab.create({
      data: {
        fasilitasId: f.id,
        tanggalUji: new Date('2024-06-15'),
        hasilUji: 'LULUS',
        lembagaUji: 'BBTPPI Kementerian Perindustrian',
        parameterUji: 'E. Coli, Total Coliform, pH, Kekeruhan',
        nilaiParameter: 'E.Coli: 0, Coliform: 0, pH: 7.2, Kekeruhan: 0.4 NTU',
        batasAman: 'E.Coli: 0/100ml, Coliform: 0/100ml, pH: 6.5-8.5, Kekeruhan: <1.5 NTU',
        catatan: 'Semua parameter memenuhi standar Permenkes No. 492/2010'
      }
    });
  }
  console.log(`   ✔ ${siapMinum.length} sample uji lab records created.\n`);

  // ─── STEP 7: Ringkasan ───────────────────────────────────────────────────
  const summary = {
    wilayah: await prisma.wilayah.count(),
    pengelola: await prisma.pengelola.count(),
    fasilitasAir: await prisma.fasilitasAir.count(),
    riwayatUjiLab: await prisma.riwayatUjiLab.count(),
    logPembaruan: await prisma.logPembaruan.count(),
  };

  console.log('═══════════════════════════════════════════');
  console.log('✅ Seeding COMPLETE! Database Summary:');
  console.log('═══════════════════════════════════════════');
  console.log(`   📍 Wilayah      : ${summary.wilayah} records`);
  console.log(`   🏢 Pengelola    : ${summary.pengelola} records`);
  console.log(`   💧 FasilitasAir : ${summary.fasilitasAir} records`);
  console.log(`   🧪 UjiLab       : ${summary.riwayatUjiLab} records`);
  console.log(`   📝 Log          : ${summary.logPembaruan} records`);
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

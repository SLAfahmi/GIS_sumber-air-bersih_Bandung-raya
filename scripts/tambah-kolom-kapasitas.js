/**
 * Tambahkan kolom kapasitas (kosong) ke setiap sheet titik di xlsx sumber data:
 *   - Jenis Sumber Air  : Mata Air / Sumur Bor / Air Sungai / Waduk/Danau/Situ / Air Hujan/Resapan / Lainnya
 *   - Debit (L/detik)   : debit atau kapasitas produksi
 *   - Jumlah SR         : jumlah sambungan rumah (pelanggan) aktual
 *
 * Kolom yang sudah ada tidak diubah. Isi kolom ini dari laporan PDAM/BPPSPAM/Pamsimas bila tersedia;
 * sel yang kosong membuat analisis cakupan memakai nilai tipikal (lihat config/cakupan.js).
 *
 * Pemakaian:
 *   node scripts/tambah-kolom-kapasitas.js --dry-run
 *   node scripts/tambah-kolom-kapasitas.js            # backup *.sebelum-kolom-kapasitas.xlsx dibuat dulu
 *   node scripts/tambah-kolom-kapasitas.js "path/file.xlsx"
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { DEFAULT_XLSX, headerColumns, backupSekali } = require('./lib/util');

const REQUIRED_HEADERS = ['Nama', 'Latitude', 'Longitude'];
const KOLOM_BARU = [
  { header: 'Jenis Sumber Air', width: 18 },
  { header: 'Debit (L/detik)', width: 14 },
  { header: 'Jumlah SR', width: 12 },
];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const xlsxPath = path.resolve(args.find((a) => !a.startsWith('--')) || process.env.SEED_XLSX || DEFAULT_XLSX);
  if (!fs.existsSync(xlsxPath)) {
    console.error(`❌ File xlsx tidak ditemukan: ${xlsxPath}`);
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);

  let total = 0;
  workbook.eachSheet((sheet) => {
    const columns = headerColumns(sheet);
    if (!REQUIRED_HEADERS.every((h) => columns[h])) return;

    const missing = KOLOM_BARU.filter((k) => !columns[k.header]);
    if (missing.length === 0) {
      console.log(`✔ ${sheet.name}: kolom kapasitas sudah ada`);
      return;
    }

    const header = sheet.getRow(1);
    const lastCol = Math.max(...Object.values(columns));
    const styleSource = header.getCell(lastCol);
    missing.forEach((kolom, i) => {
      const col = lastCol + 1 + i;
      const cell = header.getCell(col);
      cell.value = kolom.header;
      cell.style = { ...styleSource.style };
      sheet.getColumn(col).width = kolom.width;
    });
    header.commit();
    total += missing.length;
    console.log(`➕ ${sheet.name}: ${missing.map((k) => k.header).join(', ')}`);
  });

  if (total === 0) {
    console.log('Tidak ada yang perlu diubah.');
    return;
  }
  if (dryRun) {
    console.log('(dry-run: xlsx tidak ditulis)');
    return;
  }

  backupSekali(xlsxPath, 'sebelum-kolom-kapasitas');
  workbook.calcProperties.fullCalcOnLoad = true;
  await workbook.xlsx.writeFile(xlsxPath);
  console.log(`📝 ${total} kolom ditambahkan. Isi kolomnya bila ada data, lalu jalankan: npm run seed`);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});

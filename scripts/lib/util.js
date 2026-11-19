/**
 * Helper bersama skrip data (cari-pamsimas.js, tambah-osm.js, tambah-kolom-kapasitas.js).
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_XLSX = path.join(__dirname, '..', '..', 'database', 'Titik Air Se Jawa.xlsx');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Huruf kecil, selain huruf/angka jadi satu spasi: untuk membandingkan nama titik
const normalizeName = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Jarak dua titik {lat, lng} dalam meter (haversine)
function distanceM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Nama header baris 1 → nomor kolom
function headerColumns(sheet) {
  const columns = {};
  sheet.getRow(1).eachCell((cell, col) => { columns[String(cell.text).trim()] = col; });
  return columns;
}

// Salin xlsx ke "<nama>.<akhiran>.xlsx" sebelum ditulis; backup yang sudah ada tidak ditimpa
// agar salinan tetap berisi keadaan sebelum skrip pertama kali dijalankan
function backupSekali(xlsxPath, akhiran) {
  const backup = xlsxPath.replace(/\.xlsx$/i, `.${akhiran}.xlsx`);
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(xlsxPath, backup);
    console.log(`💾 Backup: ${path.basename(backup)}`);
  }
  return backup;
}

module.exports = { DEFAULT_XLSX, sleep, normalizeName, distanceM, headerColumns, backupSekali };

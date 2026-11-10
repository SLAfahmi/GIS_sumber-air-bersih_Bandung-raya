/**
 * Mencari titik Pamsimas di Google Maps (Places API New - Text Search) dan menambahkannya
 * ke sheet Pamsimas di xlsx sumber data. Setelah itu jalankan `npm run seed`.
 *
 * Pass A: kueri "Pamsimas <kab/kota>" untuk setiap kab/kota se-Jawa yang ada di xlsx.
 * Pass B: sisir grid detail di Ciamis, Kota Banjar, Pangandaran, dan Tasikmalaya
 *         (sel dipecah otomatis bila hasilnya padat).
 *
 * Pemakaian:
 *   npm run pamsimas -- --dry-run          # tampilkan hasil tanpa menulis xlsx
 *   npm run pamsimas                       # tulis ke xlsx (backup dibuat dulu)
 *   node scripts/cari-pamsimas.js --max-requests=800 "path/file.xlsx"
 *
 * Butuh GOOGLE_MAPS_API_KEY di .env (Places API (New) aktif). Setiap respons disimpan di
 * database/places_cache sehingga menjalankan ulang tidak menambah request berbayar.
 * Penjelasan lengkap ada di SUMBER_DATA.md.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');

const DATABASE_DIR = path.join(__dirname, '..', 'database');
const DEFAULT_XLSX = path.join(DATABASE_DIR, 'Titik Air Se Jawa.xlsx');
const CACHE_DIR = process.env.PLACES_CACHE_DIR || path.join(DATABASE_DIR, 'places_cache');
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

// Hanya field tingkat "Pro" (tanpa rating/ulasan) agar tidak naik ke SKU Enterprise
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.addressComponents',
  'places.businessStatus',
  'nextPageToken',
].join(',');

const JAWA_RECT = { low: { latitude: -8.9, longitude: 105.0 }, high: { latitude: -5.8, longitude: 114.7 } };

// Ciamis + Kota Banjar + Pangandaran + Kab./Kota Tasikmalaya
const DETAIL_AREA = { minLat: -7.95, maxLat: -7.0, minLng: 107.85, maxLng: 108.85 };
const GRID_STEP = 0.1;
const MIN_STEP = 0.025;

const DETAIL_KEYWORDS = [
  { query: 'Pamsimas', strict: true },
  { query: 'BPSPAMS KPSPAMS sarana air bersih desa', strict: false },
];

const NAME_PAMSIMAS = /pamsimas|spams|hippam/i;
const NAME_LOOSE = /sarana air bersih|air bersih desa/i;
const NAME_EXCLUDE = /pdam|perumda|depot|isi ulang|galon|refill|toko|laundry/i;

const PROVINSI_JAWA = ['Banten', 'DKI Jakarta', 'Jawa Barat', 'Jawa Tengah', 'DI Yogyakarta', 'Jawa Timur'];
const PROVINSI_ALIAS = {
  'Daerah Khusus Ibukota Jakarta': 'DKI Jakarta',
  'Daerah Khusus Jakarta': 'DKI Jakarta',
  'Jakarta': 'DKI Jakarta',
  'Daerah Istimewa Yogyakarta': 'DI Yogyakarta',
  'Special Region of Yogyakarta': 'DI Yogyakarta',
  'West Java': 'Jawa Barat',
  'Central Java': 'Jawa Tengah',
  'East Java': 'Jawa Timur',
};

const STATUS_OK = 'Sesuai entri Google Maps (belum diverifikasi lapangan)';
const STATUS_CEK = 'Perlu cek ulang';
const PAMSIMAS_SHEET = 'Pamsimas';
const OLD_PAMSIMAS_SHEET = 'Pamsimas (contoh)';

// ============================================================================
// Argumen
// ============================================================================
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const maxArg = args.find((a) => a.startsWith('--max-requests='));
const MAX_REQUESTS = maxArg ? Number(maxArg.split('=')[1]) : 1500;
const xlsxPath = path.resolve(args.find((a) => !a.startsWith('--')) || process.env.SEED_XLSX || DEFAULT_XLSX);

const stats = { requests: 0, cacheHits: 0 };

// ============================================================================
// Places API + cache
// ============================================================================
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function searchText(body) {
  const hash = crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex');
  const cacheFile = path.join(CACHE_DIR, `${hash}.json`);
  if (fs.existsSync(cacheFile)) {
    stats.cacheHits++;
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }

  if (stats.requests >= MAX_REQUESTS) {
    throw new Error(`Batas ${MAX_REQUESTS} request tercapai. Naikkan dengan --max-requests=N bila memang perlu.`);
  }
  stats.requests++;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Places API ${res.status}: ${json.error?.message || res.statusText}`);

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(json));
  return json;
}

function baseBody(textQuery, rectangle) {
  return { textQuery, languageCode: 'id', regionCode: 'ID', pageSize: 20, locationRestriction: { rectangle } };
}

function cellRect({ minLat, maxLat, minLng, maxLng }) {
  return { low: { latitude: minLat, longitude: minLng }, high: { latitude: maxLat, longitude: maxLng } };
}

// ============================================================================
// Kandidat
// ============================================================================
function nameMatches(name, strict) {
  if (!name || NAME_EXCLUDE.test(name)) return false;
  return NAME_PAMSIMAS.test(name) || (!strict && NAME_LOOSE.test(name));
}

const candidates = new Map(); // placeId → { place, queries:Set }

function collect(places, query, strict) {
  let matching = 0;
  for (const place of places) {
    if (!nameMatches(place.displayName?.text, strict)) continue;
    matching++;
    const entry = candidates.get(place.id) || { place, queries: new Set() };
    entry.queries.add(query);
    candidates.set(place.id, entry);
  }
  return matching;
}

// Pass A: halaman berikutnya hanya diambil bila halaman ini hampir semuanya cocok
async function searchKabKota(query) {
  let pageToken;
  for (let page = 0; page < 3; page++) {
    const body = { ...baseBody(query, JAWA_RECT), ...(pageToken && { pageToken }) };
    const json = await searchText(body);
    const places = json.places || [];
    const matching = collect(places, query, true);
    if (!json.nextPageToken || places.length < 20 || matching < 15) return;
    pageToken = json.nextPageToken;
    await sleep(1000);
  }
}

// Pass B: sel yang hasil cocoknya penuh dipecah menjadi 4
async function sweepCell(cell, keyword) {
  const json = await searchText(baseBody(keyword.query, cellRect(cell)));
  const places = json.places || [];
  const matching = collect(places, keyword.query, keyword.strict);

  const size = cell.maxLat - cell.minLat;
  if (places.length < 20 || matching < 15 || size / 2 < MIN_STEP) return;

  const midLat = (cell.minLat + cell.maxLat) / 2;
  const midLng = (cell.minLng + cell.maxLng) / 2;
  for (const [minLat, maxLat] of [[cell.minLat, midLat], [midLat, cell.maxLat]]) {
    for (const [minLng, maxLng] of [[cell.minLng, midLng], [midLng, cell.maxLng]]) {
      await sweepCell({ minLat, maxLat, minLng, maxLng }, keyword);
    }
  }
}

function detailGrid() {
  const cells = [];
  const round = (n) => Math.round(n * 1000) / 1000;
  for (let lat = DETAIL_AREA.minLat; lat < DETAIL_AREA.maxLat - 1e-9; lat += GRID_STEP) {
    for (let lng = DETAIL_AREA.minLng; lng < DETAIL_AREA.maxLng - 1e-9; lng += GRID_STEP) {
      cells.push({
        minLat: round(lat),
        maxLat: round(Math.min(lat + GRID_STEP, DETAIL_AREA.maxLat)),
        minLng: round(lng),
        maxLng: round(Math.min(lng + GRID_STEP, DETAIL_AREA.maxLng)),
      });
    }
  }
  return cells;
}

// ============================================================================
// Pemetaan hasil Places → baris xlsx
// ============================================================================
function component(place, type) {
  return (place.addressComponents || []).find((c) => c.types?.includes(type))?.longText || null;
}

function normalizeProvinsi(raw) {
  if (!raw) return null;
  const nama = PROVINSI_ALIAS[raw] || raw;
  return PROVINSI_JAWA.includes(nama) ? nama : null;
}

// "Kabupaten Ciamis" / "Ciamis Regency" → "Kab. Ciamis"; "Banjar City" → "Kota Banjar"
function normalizeKabKota(raw) {
  if (!raw) return null;
  let nama = raw.trim();
  if (/ Regency$/i.test(nama)) nama = `Kab. ${nama.replace(/ Regency$/i, '')}`;
  else if (/ City$/i.test(nama)) nama = `Kota ${nama.replace(/ City$/i, '')}`;
  nama = nama.replace(/^Kabupaten\s+/i, 'Kab. ');
  return /^(Kab\.|Kota) \S/.test(nama) ? nama : null;
}

const stripPrefix = (text, prefix) => (text ? text.replace(prefix, '').trim() || null : null);

// Format alamat mengikuti baris lama: tanpa provinsi & negara, "Kabupaten" disingkat "Kab."
function shortAddress(place, provinsiRaw) {
  let alamat = (place.formattedAddress || '').replace(/,\s*Indonesia$/i, '');
  if (provinsiRaw) alamat = alamat.replace(new RegExp(`,\\s*${provinsiRaw}(\\s+\\d{5})?$`), (_, zip) => zip || '');
  return alamat.replace(/\bKabupaten\s+/g, 'Kab. ').replace(/\bKec\.\s+/g, '').trim() || null;
}

const normalizeName = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function isGenericName(name) {
  const rest = normalizeName(name)
    .replace(/\b(pamsimas|kantor|sekretariat|sumber|air|bersih|sarana|program|desa|unit|\d+)\b/g, '')
    .trim();
  return rest.length === 0;
}

function distanceM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function toRow({ place, queries }, today) {
  const name = place.displayName.text.replace(/\s+/g, ' ').trim();
  const provinsiRaw = component(place, 'administrative_area_level_1');
  const provinsi = normalizeProvinsi(provinsiRaw);
  const kabKota = normalizeKabKota(component(place, 'administrative_area_level_2'));
  if (!provinsi || !kabKota) return null;

  const kecamatan = stripPrefix(component(place, 'administrative_area_level_3'), /^(Kecamatan|Kec\.)\s+/i);
  const desa = stripPrefix(component(place, 'administrative_area_level_4'), /^(Desa|Kelurahan|Kel\.)\s+/i);
  const lat = place.location.latitude;
  const lng = place.location.longitude;

  const reasons = [];
  if (!NAME_PAMSIMAS.test(name)) reasons.push('Nama tidak memuat Pamsimas/SPAMS (hasil kata kunci sarana air bersih)');
  if (isGenericName(name)) reasons.push('Nama generik');
  if (!kecamatan || !desa) reasons.push('Kecamatan/desa tidak tercantum di Google');

  return {
    nama: name,
    desa,
    kecamatan,
    kabKota,
    provinsi,
    lat,
    lng,
    alamat: shortAddress(place, provinsiRaw),
    placeId: place.id,
    gmaps: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${place.id}`,
    osm: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`,
    sumber: `Google Maps (Places API), diakses ${today}`,
    status: reasons.length ? STATUS_CEK : STATUS_OK,
    catatan: reasons.length ? `${reasons.join('. ')}.` : null,
    layanan: kabKota,
    queries: [...queries],
  };
}

// ============================================================================
// xlsx
// ============================================================================
function headerColumns(sheet) {
  const columns = {};
  sheet.getRow(1).eachCell((cell, col) => { columns[String(cell.text).trim()] = col; });
  return columns;
}

function readExisting(workbook) {
  const placeIds = new Set();
  const points = [];
  const kabKota = new Map(); // "Kab. Lebak" → "Banten"

  workbook.eachSheet((sheet) => {
    const cols = headerColumns(sheet);
    if (!cols.Nama || !cols.Latitude || !cols.Longitude) return;
    sheet.eachRow((row, n) => {
      if (n === 1 || !row.getCell(cols.Nama).text) return;
      if (cols['Google Place ID']) placeIds.add(row.getCell(cols['Google Place ID']).text.trim());
      const lat = Number(row.getCell(cols.Latitude).value);
      const lng = Number(row.getCell(cols.Longitude).value);
      if (Number.isFinite(lat) && Number.isFinite(lng)) points.push({ name: normalizeName(row.getCell(cols.Nama).text), lat, lng });
      const kab = cols['Kab/Kota (alamat)'] && row.getCell(cols['Kab/Kota (alamat)']).text.trim();
      const prov = cols.Provinsi && row.getCell(cols.Provinsi).text.trim();
      if (kab && prov && PROVINSI_JAWA.includes(prov)) kabKota.set(kab, prov);
    });
  });
  placeIds.delete('');
  return { placeIds, points, kabKota };
}

function findPamsimasSheet(workbook) {
  return workbook.getWorksheet(PAMSIMAS_SHEET) || workbook.getWorksheet(OLD_PAMSIMAS_SHEET);
}

function writeWorkbook(workbook, rows) {
  const sheet = findPamsimasSheet(workbook);
  const cols = headerColumns(sheet);
  const lastRow = sheet.actualRowCount;

  // Baris lama: kategori "Pamsimas (contoh)" → "Pamsimas"
  sheet.eachRow((row, n) => {
    if (n > 1 && /^pamsimas/i.test(row.getCell(cols.Kategori).text)) row.getCell(cols.Kategori).value = 'Pamsimas';
  });

  // Gaya sel disalin dari baris lama dengan status yang sama (warna "Perlu cek ulang" ikut)
  const templateFor = (status) => {
    for (let n = 2; n <= lastRow; n++) {
      if (sheet.getRow(n).getCell(cols.Status).text === status) return sheet.getRow(n);
    }
    return sheet.getRow(2);
  };

  let no = Math.max(0, ...sheet.getColumn(cols.No).values.filter(Number.isFinite));
  rows.forEach((r) => {
    const values = {
      No: ++no,
      Kategori: 'Pamsimas',
      Nama: r.nama,
      'Desa/Kelurahan': r.desa,
      Kecamatan: r.kecamatan,
      'Kab/Kota (alamat)': r.kabKota,
      Provinsi: r.provinsi,
      Latitude: r.lat,
      Longitude: r.lng,
      'Alamat (Google Maps)': r.alamat,
      'Google Place ID': r.placeId,
      'Link Google Maps': { text: r.gmaps, hyperlink: r.gmaps },
      'Link OpenStreetMap': { text: r.osm, hyperlink: r.osm },
      'Sumber data': r.sumber,
      Status: r.status,
      Catatan: r.catatan,
      'Wilayah layanan': r.layanan,
    };
    const template = templateFor(r.status);
    const row = sheet.getRow(sheet.actualRowCount + 1);
    Object.entries(cols).forEach(([header, col]) => {
      const cell = row.getCell(col);
      cell.style = { ...template.getCell(col).style };
      if (values[header] !== undefined && values[header] !== null) cell.value = values[header];
    });
    row.commit();
  });

  sheet.name = PAMSIMAS_SHEET;
  if (sheet.autoFilter) sheet.autoFilter = `A1:${sheet.getColumn(Object.keys(cols).length).letter}${sheet.actualRowCount}`;

  // Ringkasan: judul kolom & rumus COUNTIF ikut nama sheet baru
  const ringkasan = workbook.getWorksheet('Ringkasan');
  ringkasan?.eachRow((row) => row.eachCell((cell) => {
    const value = cell.value;
    if (typeof value === 'string' && value.includes(OLD_PAMSIMAS_SHEET)) {
      cell.value = value.replace(OLD_PAMSIMAS_SHEET, PAMSIMAS_SHEET);
    } else if (value?.formula?.includes(OLD_PAMSIMAS_SHEET)) {
      cell.value = { formula: value.formula.replace(`'${OLD_PAMSIMAS_SHEET}'`, `'${PAMSIMAS_SHEET}'`) };
    }
  }));

  const catatan = workbook.getWorksheet('Catatan');
  catatan?.eachRow((row) => {
    if (/^Cakupan Pamsimas/i.test(row.getCell(1).text)) {
      row.getCell(2).value =
        'Pamsimas dikumpulkan dari Google Maps (Places API): per kab/kota se-Jawa, dan disisir per sel grid di Ciamis, ' +
        'Kota Banjar, Pangandaran, dan Tasikmalaya (scripts/cari-pamsimas.js). Hanya sarana yang terdaftar di Google Maps; ' +
        'banyak sarana desa belum terdaftar, jadi jumlah ini bukan total. Kolam retensi di luar Bandung Raya dari Google Maps ' +
        'dan OpenStreetMap, belum lengkap.';
    }
  });

  workbook.calcProperties.fullCalcOnLoad = true;
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.error('❌ GOOGLE_MAPS_API_KEY belum diisi di .env.');
    console.error('   Buat API key di Google Cloud Console, aktifkan "Places API (New)", lalu tambahkan baris');
    console.error('   GOOGLE_MAPS_API_KEY=... ke file .env. Lihat SUMBER_DATA.md bagian "Menambah titik Pamsimas".');
    process.exit(1);
  }
  if (!fs.existsSync(xlsxPath)) {
    console.error(`❌ File xlsx tidak ditemukan: ${xlsxPath}`);
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  if (!findPamsimasSheet(workbook)) {
    console.error(`❌ Sheet "${PAMSIMAS_SHEET}" / "${OLD_PAMSIMAS_SHEET}" tidak ada di ${path.basename(xlsxPath)}.`);
    process.exit(1);
  }
  const existing = readExisting(workbook);
  console.log(`📄 ${path.basename(xlsxPath)}: ${existing.placeIds.size} Place ID, ${existing.kabKota.size} kab/kota.\n`);

  console.log('🔎 Pass A: Pamsimas per kab/kota se-Jawa...');
  for (const [kab, prov] of existing.kabKota) {
    await searchKabKota(`Pamsimas ${kab.replace(/^Kab\.\s*/, 'Kabupaten ')}, ${prov}`);
  }
  console.log(`   ${candidates.size} kandidat sejauh ini.`);

  const cells = detailGrid();
  console.log(`🔎 Pass B: grid detail Ciamis & sekitarnya (${cells.length} sel × ${DETAIL_KEYWORDS.length} kata kunci)...`);
  for (const keyword of DETAIL_KEYWORDS) {
    for (const cell of cells) await sweepCell(cell, keyword);
  }
  console.log(`   ${candidates.size} kandidat total.\n`);

  const today = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
  const skipped = { tutup: 0, luarJawa: 0, sudahAda: 0, dekatDuplikat: 0 };
  const rows = [];
  const points = [...existing.points];

  for (const entry of candidates.values()) {
    if (existing.placeIds.has(entry.place.id)) { skipped.sudahAda++; continue; }
    if (entry.place.businessStatus === 'CLOSED_PERMANENTLY') { skipped.tutup++; continue; }
    const row = toRow(entry, today);
    if (!row) { skipped.luarJawa++; continue; }

    const key = normalizeName(row.nama);
    if (points.some((p) => p.name === key && distanceM(p, row) < 50)) { skipped.dekatDuplikat++; continue; }
    points.push({ name: key, lat: row.lat, lng: row.lng });
    rows.push(row);
  }

  rows.sort((a, b) =>
    PROVINSI_JAWA.indexOf(a.provinsi) - PROVINSI_JAWA.indexOf(b.provinsi) ||
    a.kabKota.localeCompare(b.kabKota) || (a.kecamatan || '').localeCompare(b.kecamatan || '') || a.nama.localeCompare(b.nama));

  // ─── Ringkasan ───
  const byKab = rows.reduce((acc, r) => ({ ...acc, [r.kabKota]: (acc[r.kabKota] || 0) + 1 }), {});
  const byStatus = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  console.log('═══════════════════════════════════════════');
  console.log(`✅ ${rows.length} titik Pamsimas baru`);
  console.log(`   Dilewati: ${skipped.sudahAda} sudah ada, ${skipped.dekatDuplikat} duplikat berdekatan, ${skipped.tutup} tutup permanen, ${skipped.luarJawa} di luar Jawa/wilayah tak dikenal`);
  console.log(`   Status : ${Object.entries(byStatus).map(([s, n]) => `${s} ${n}`).join(', ') || '-'}`);
  console.log(`   Per kab/kota: ${Object.entries(byKab).map(([k, n]) => `${k} ${n}`).join(', ') || '-'}`);
  console.log(`   Request Places API: ${stats.requests} baru, ${stats.cacheHits} dari cache`);
  console.log('═══════════════════════════════════════════');

  if (DRY_RUN) {
    rows.forEach((r) => console.log(`   ${r.kabKota.padEnd(22)} ${String(r.kecamatan || '-').padEnd(16)} ${r.nama}${r.status === STATUS_CEK ? '  [cek ulang]' : ''}`));
    console.log('\n(--dry-run: xlsx tidak diubah)');
    return;
  }
  if (rows.length === 0) {
    console.log('Tidak ada titik baru; xlsx tidak diubah.');
    return;
  }

  const backup = xlsxPath.replace(/\.xlsx$/i, '.sebelum-pamsimas.xlsx');
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(xlsxPath, backup);
    console.log(`💾 Backup: ${path.basename(backup)}`);
  }
  writeWorkbook(workbook, rows);
  await workbook.xlsx.writeFile(xlsxPath);
  console.log(`📝 ${rows.length} baris ditambahkan ke sheet "${PAMSIMAS_SHEET}". Lanjutkan dengan: npm run seed`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  console.error(`   Request terkirim: ${stats.requests}. Respons yang sudah diterima tersimpan di cache.`);
  process.exit(1);
});

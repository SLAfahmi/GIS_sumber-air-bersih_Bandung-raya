/**
 * Menambah titik Rumah Pompa (kategori Pemda) dan Kolam Retensi se-Jawa dari OpenStreetMap
 * ke xlsx sumber data. Setelah itu jalankan `npm run seed`.
 *
 * - Titik diambil lewat Overpass API (gratis, tanpa API key).
 * - Desa, kecamatan, kab/kota, dan provinsi dilengkapi lewat Nominatim (reverse geocoding, 1 request/detik).
 * - Titik yang sudah ada di xlsx (berdekatan) dan duplikat antar-hasil OSM dilewati.
 *
 * Pemakaian:
 *   npm run osm -- --dry-run      # tampilkan hasil tanpa menulis xlsx
 *   npm run osm                   # tulis ke xlsx (backup *.sebelum-osm.xlsx dibuat dulu)
 *   node scripts/tambah-osm.js "path/file.xlsx"
 *
 * Respons Overpass & Nominatim disimpan di database/osm_cache, jadi menjalankan ulang tidak
 * membebani server OSM. Hapus folder itu untuk mengambil data terbaru. Lihat SUMBER_DATA.md.
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { DEFAULT_XLSX, sleep, normalizeName, distanceM, headerColumns, backupSekali } = require('./lib/util');

const DATABASE_DIR = path.join(__dirname, '..', 'database');
const CACHE_DIR = process.env.OSM_CACHE_DIR || path.join(DATABASE_DIR, 'osm_cache');
const USER_AGENT = 'caiKU-GIS/1.0 (tugas kuliah)';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

// Kotak Pulau Jawa + Madura (provinsi dicek lagi lewat Nominatim, jadi Bali/Sumatra ikut tersaring)
const BBOX = '-8.9,105.0,-5.8,114.62';

const QUERIES = {
  tags: `[out:json][timeout:170][bbox:${BBOX}];
(
  nwr["basin"~"^(retention|detention)$"];
  nwr["man_made"="pumping_station"];
  nwr["water"="basin"]["name"];
  nwr["landuse"="basin"]["name"];
);
out center tags;`,
  names: `[out:json][timeout:170][bbox:${BBOX}];
(
  nwr["name"~"[Kk]olam [Rr]etensi|[Kk]olam [Dd]etensi|[Kk]olam [Tt]andon|[Rr]umah [Pp]ompa|[Ss]tasiun [Pp]ompa|[Pp]ompa [Bb]anjir"];
);
out center tags;`,
};

const PROVINSI_ISO = {
  'ID-BT': 'Banten',
  'ID-JK': 'DKI Jakarta',
  'ID-JB': 'Jawa Barat',
  'ID-JT': 'Jawa Tengah',
  'ID-YO': 'DI Yogyakarta',
  'ID-JI': 'Jawa Timur',
};
const PROVINSI_JAWA = Object.values(PROVINSI_ISO);

const STATUS_OSM = 'Sesuai data OpenStreetMap (belum diverifikasi lapangan)';
const STATUS_CEK = 'Perlu cek ulang';
const RUMAH_POMPA_SHEET = 'Rumah Pompa';
const KOLAM_SHEET = 'Kolam Retensi';

// ─── Aturan pemilihan ─────────────────────────────────────────────────────────
const KOLAM_NAME = /kolam\s+(retensi|detensi|retarding|tandon|penampung)|\bbozem\b|\bpolder\b|long\s*storage|retention pond|detention pond/i;
const KOLAM_EXCLUDE = /ikan|tambak|renang|taman|pancing|empang|fish|swimming|pompa/i;
const IS_POMPA = /pompa|pump/i;
const POMPA_NAME = /rumah\s+pompa|stasiun\s+pompa|gedung\s+pompa|pompa\s+banjir|pompa\s+air|^pompa\b|pump\s*(station|gate|house)/i;
// Pompa milik PDAM/operator air minum (termasuk booster distribusi) bukan kategori Pemda
const POMPA_UTILITY = /\b(pdam|perumda|pam jaya|aetra|palyja|moya|tirta|pamsimas|spam)\b|booster/i;
// Pompa swasta/kompleks/sekolah: dicek pada nama (operator "Kementerian PU dan Perumahan Rakyat" tidak boleh
// ikut terbuang). Dibuang kecuali pengelolanya instansi pemerintah.
const POMPA_PRIVATE = /villa|perumahan|residen|apartemen|apartment|mall|hotel|pabrik|\bpt\b|plaza|kampus|universitas|sekolah|\b(smp|sma|smk|sd)\b|masjid|rumah sakit|kompleks?\b|komplek/i;
// Pompa warga (RW 04, RW VII): dibuang kecuali pengelolanya instansi pemerintah (mis. "Rumah Pompa RW 04 Kembangan [Dinas PU]")
const POMPA_COMMUNITY = /\b(rw|rt)\s*\.?\s*(\d+|[ivxl]+)\b|warga/i;
// Batas kata wajib: "Karangasem" memuat "gas", "Tipala" memuat "ipal"
const NON_AIR = /\b(sewage|wastewater|limbah|ipal|gas|oil|fuel|bbm|spbu)\b/i;
const GOV_OPERATOR = /dinas|sudin|suku dinas|pemkot|pemkab|pemprov|pemerintah|kementerian|pupr|\bpu\b|bbws|balai|upt|tata air|pematusan|sumber daya air|\bsda\b|kota |kabupaten|provinsi/i;

// ============================================================================
// Argumen
// ============================================================================
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const xlsxPath = path.resolve(args.find((a) => !a.startsWith('--')) || process.env.SEED_XLSX || DEFAULT_XLSX);

const stats = { overpass: 0, nominatim: 0, cacheHits: 0 };

// ============================================================================
// Overpass & Nominatim (dengan cache)
// ============================================================================
function readCache(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

async function overpass(name) {
  const query = QUERIES[name];
  const file = path.join(CACHE_DIR, `overpass-${name}.json`);
  const cached = readCache(file);
  if (cached && cached.query === query) {
    stats.cacheHits++;
    return cached.data;
  }

  // Server Overpass publik sering penuh: coba beberapa server dengan jeda yang makin panjang
  for (let attempt = 0; attempt < 9; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(180000),
      });
      const text = await res.text();
      if (res.ok && text.trim().startsWith('{')) {
        stats.overpass++;
        const data = JSON.parse(text);
        writeCache(file, { query, fetchedAt: new Date().toISOString(), endpoint, data });
        return data;
      }
      console.log(`   Overpass ${new URL(endpoint).host}: HTTP ${res.status}, mencoba lagi...`);
    } catch (err) {
      console.log(`   Overpass ${new URL(endpoint).host}: ${err.name}, mencoba lagi...`);
    }
    await sleep(Math.min(20000 * (attempt + 1), 90000));
  }
  throw new Error(`Overpass tidak bisa dihubungi untuk kueri "${name}". Coba lagi nanti; kueri lain yang sudah berhasil tersimpan di cache.`);
}

let lastNominatimAt = 0;

async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(5)}_${lng.toFixed(5)}`;
  const file = path.join(CACHE_DIR, 'nominatim', `${key}.json`);
  const cached = readCache(file);
  if (cached) {
    stats.cacheHits++;
    return cached;
  }

  // Kebijakan Nominatim: maksimal 1 request per detik
  const wait = lastNominatimAt + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastNominatimAt = Date.now();

  const url = `${NOMINATIM_URL}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=id`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
      if (res.ok) {
        stats.nominatim++;
        const json = await res.json();
        writeCache(file, json);
        return json;
      }
    } catch {
      // coba lagi
    }
    await sleep(3000 * (attempt + 1));
  }
  return null;
}

// ============================================================================
// Kandidat dari elemen OSM
// ============================================================================
const cleanName = (name) => name.replace(/\s+/g, ' ').trim();

function elementPoint(el) {
  if (Number.isFinite(el.lat) && Number.isFinite(el.lon)) return { lat: el.lat, lng: el.lon };
  if (el.center) return { lat: el.center.lat, lng: el.center.lon };
  return null;
}

// "Rumah Pompa", "Rumah Pompa 5", "Pompa Air II" → generik (tidak bisa dibedakan dari namanya)
function isGenericPompaName(name) {
  return normalizeName(name)
    .replace(/\b(rumah|stasiun|gedung|pompa|pump|station|air|banjir|\d+|i|ii|iii|iv|v|vi)\b/g, '')
    .trim().length === 0;
}

function classify(el) {
  const tags = el.tags || {};
  const name = tags.name ? cleanName(tags.name) : '';
  if (!name) return null;
  const operator = tags.operator ? cleanName(tags.operator) : '';
  const technical = `${tags.pumping_station || ''} ${tags.substance || ''} ${tags.pump || ''}`;

  if (POMPA_NAME.test(name) || tags.man_made === 'pumping_station') {
    if (!IS_POMPA.test(name)) return null; // mis. "Waduk Pluit Tengah" bertag pumping_station
    const gov = GOV_OPERATOR.test(operator);
    if (POMPA_UTILITY.test(`${name} ${operator}`)) return null;
    if (/\bpt\b/i.test(operator)) return null;
    if (!gov && (POMPA_PRIVATE.test(name) || POMPA_COMMUNITY.test(`${name} ${operator}`))) return null;
    if (NON_AIR.test(`${technical} ${name}`)) return null;
    const generic = isGenericPompaName(name);
    if (generic && !gov) return null; // nama generik tanpa pengelola pemerintah: tidak jelas
    return { kategori: 'Rumah pompa', name, operator, generic, byTagOnly: false };
  }

  const basinTag = /^(retention|detention)$/.test(tags.basin || '');
  if ((KOLAM_NAME.test(name) || basinTag) && !KOLAM_EXCLUDE.test(name)) {
    return { kategori: 'Kolam retensi', name, operator, generic: isGenericKolamName(name), byTagOnly: !KOLAM_NAME.test(name) };
  }
  return null;
}

// "Kolam Retensi", "Kolam retensi 2" → generik
function isGenericKolamName(name) {
  return normalizeName(name).replace(/\b(kolam|retensi|detensi|tandon|\d+)\b/g, '').trim().length === 0;
}

// Kolam berupa area: titik tengah di OSM & Google bisa berjarak ratusan meter untuk kolam yang sama
const DUPLICATE_RADIUS_M = { 'Rumah pompa': 60, 'Kolam retensi': 250 };
const KOLAM_LIKE = /kolam|retensi|bozem|polder|embung/;

// ============================================================================
// Alamat dari Nominatim → kolom xlsx
// ============================================================================
function normalizeKabKota(address) {
  const regency = address.regency || address.county;
  if (regency) return `Kab. ${regency.replace(/^Kab(upaten)?\.?\s+/i, '').trim()}`;
  const city = address.city;
  if (!city) return null;
  if (/^Kab(upaten)?\.?\s+/i.test(city)) return `Kab. ${city.replace(/^Kab(upaten)?\.?\s+/i, '').trim()}`;
  return `Kota ${city.replace(/^Kota\s+/i, '').replace(/\s+City$/i, '').trim()}`;
}

const DKI_KOTA = /^Jakarta (Pusat|Utara|Barat|Selatan|Timur)$/;

function addressParts(geo) {
  const a = geo?.address || {};
  const iso = a['ISO3166-2-lvl4'];
  const provinsi = PROVINSI_ISO[iso] || null;
  let kabKota;
  let kecamatan;
  let desa;
  if (iso === 'ID-JK') {
    // DKI: kota administrasi kadang di `city`, kadang di `city_district` (bila `city` berisi nama provinsi);
    // `suburb` = kecamatan, `village` = kelurahan
    const kota = [a.city_district, a.city].find((v) => DKI_KOTA.test(v || ''));
    kabKota = kota ? `Kota ${kota}` : null;
    kecamatan = a.suburb || null;
    desa = a.village || null;
  } else {
    kabKota = normalizeKabKota(a);
    kecamatan = a.city_district || a.district || a.municipality || (a.village ? a.suburb : null) || null;
    desa = a.village || (kecamatan === a.suburb ? null : a.suburb) || a.hamlet || null;
  }
  const strip = (text, re) => (text ? text.replace(re, '').trim() || null : null);
  const kec = strip(kecamatan, /^(Kecamatan|Kec\.)\s+/i);
  const des = strip(desa, /^(Desa|Kelurahan|Kel\.)\s+/i);
  const alamat = [a.road, des, kec, [kabKota, a.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;
  return { provinsi, kabKota, kecamatan: kec, desa: des, alamat };
}

// ============================================================================
// xlsx
// ============================================================================
function readExisting(workbook) {
  const points = [];
  workbook.eachSheet((sheet) => {
    const cols = headerColumns(sheet);
    if (!cols.Nama || !cols.Latitude || !cols.Longitude) return;
    sheet.eachRow((row, n) => {
      if (n === 1 || !row.getCell(cols.Nama).text) return;
      const lat = Number(row.getCell(cols.Latitude).value);
      const lng = Number(row.getCell(cols.Longitude).value);
      const osm = cols['Link OpenStreetMap'] ? row.getCell(cols['Link OpenStreetMap']).text : '';
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        points.push({ name: normalizeName(row.getCell(cols.Nama).text), lat, lng, osm });
      }
    });
  });
  return points;
}

// Sheet Rumah Pompa dibuat dari kerangka sheet Kolam Retensi (header, lebar kolom, freeze, filter)
function ensureRumahPompaSheet(workbook) {
  let sheet = workbook.getWorksheet(RUMAH_POMPA_SHEET);
  if (sheet) return sheet;

  const template = workbook.getWorksheet(KOLAM_SHEET);
  sheet = workbook.addWorksheet(RUMAH_POMPA_SHEET, { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });
  template.columns.forEach((column, i) => { sheet.getColumn(i + 1).width = column.width; });
  const header = template.getRow(1);
  const row = sheet.getRow(1);
  header.eachCell((cell, col) => {
    row.getCell(col).value = cell.value;
    row.getCell(col).style = { ...cell.style };
  });
  row.height = header.height;
  row.commit();
  return sheet;
}

function appendRows(sheet, rows, templateSheet) {
  const cols = headerColumns(sheet);
  const tplCols = headerColumns(templateSheet);
  const tplLast = templateSheet.actualRowCount;

  // Gaya sel disalin dari baris lama dengan status yang sama (warna "Perlu cek ulang" ikut)
  const templateFor = (status) => {
    for (let n = 2; n <= tplLast; n++) {
      if (templateSheet.getRow(n).getCell(tplCols.Status).text === status) return templateSheet.getRow(n);
    }
    return templateSheet.getRow(2);
  };

  let no = Math.max(0, ...sheet.getColumn(cols.No).values.filter(Number.isFinite));
  rows.forEach((r) => {
    const values = {
      No: ++no,
      Kategori: r.kategori,
      Nama: r.nama,
      'Desa/Kelurahan': r.desa,
      Kecamatan: r.kecamatan,
      'Kab/Kota (alamat)': r.kabKota,
      Provinsi: r.provinsi,
      Latitude: r.lat,
      Longitude: r.lng,
      'Alamat (Google Maps)': r.alamat,
      'Link OpenStreetMap': { text: r.osm, hyperlink: r.osm },
      'Sumber data': r.sumber,
      Status: r.status,
      Catatan: r.catatan,
      'Wilayah layanan': r.kabKota,
    };
    const template = templateFor(r.status);
    const row = sheet.getRow(sheet.actualRowCount + 1);
    Object.entries(cols).forEach(([header, col]) => {
      const cell = row.getCell(col);
      cell.style = { ...template.getCell(tplCols[header] || col).style };
      if (values[header] !== undefined && values[header] !== null) cell.value = values[header];
    });
    row.commit();
  });

  const lastCol = sheet.getColumn(Object.keys(cols).length).letter;
  sheet.autoFilter = `A1:${lastCol}${sheet.actualRowCount}`;
}

// Ringkasan: kolom baru "Rumah pompa" + total kolom kolam retensi jadi rumus
function updateRingkasan(workbook, today) {
  const ringkasan = workbook.getWorksheet('Ringkasan');
  if (!ringkasan) return;

  let headerRow = null;
  let totalRow = null;
  const provinsiRows = [];
  ringkasan.eachRow((row, n) => {
    const first = row.getCell(1).text.trim();
    if (first === 'Provinsi') headerRow = n;
    else if (first === 'Total') totalRow = n;
    else if (PROVINSI_JAWA.includes(first)) provinsiRows.push(n);
  });
  if (!headerRow || !totalRow) return;

  const header = ringkasan.getRow(headerRow);
  let kolamCol = null;
  let pompaCol = null;
  header.eachCell((cell, col) => {
    if (/^kolam retensi/i.test(cell.text)) kolamCol = col;
    if (/^rumah pompa/i.test(cell.text)) pompaCol = col;
  });

  if (!pompaCol) {
    pompaCol = header.cellCount + 1;
    const prev = pompaCol - 1;
    header.getCell(pompaCol).value = 'Rumah pompa';
    header.getCell(pompaCol).style = { ...header.getCell(prev).style };
    ringkasan.getColumn(pompaCol).width = ringkasan.getColumn(prev).width;
    provinsiRows.forEach((n) => {
      const row = ringkasan.getRow(n);
      row.getCell(pompaCol).value = { formula: `COUNTIF('${RUMAH_POMPA_SHEET}'!$G:$G,A${n})` };
      row.getCell(pompaCol).style = { ...row.getCell(prev).style };
    });
    ringkasan.getRow(totalRow).getCell(pompaCol).style = { ...ringkasan.getRow(totalRow).getCell(prev).style };
  }

  const first = Math.min(...provinsiRows);
  const last = Math.max(...provinsiRows);
  for (const col of [kolamCol, pompaCol].filter(Boolean)) {
    const letter = ringkasan.getColumn(col).letter;
    ringkasan.getRow(totalRow).getCell(col).value = { formula: `SUM(${letter}${first}:${letter}${last})` };
  }

  ringkasan.eachRow((row) => {
    const cell = row.getCell(1);
    if (typeof cell.value === 'string' && cell.value.startsWith('Sumber koordinat:') && !cell.value.includes('OpenStreetMap')) {
      cell.value = `${cell.value} Rumah pompa dan sebagian kolam retensi dari OpenStreetMap (ODbL), ${today}.`;
    }
  });
}

function updateCatatan(workbook, today) {
  const catatan = workbook.getWorksheet('Catatan');
  if (!catatan) return;
  catatan.eachRow((row) => {
    if (/^Batasan$/i.test(row.getCell(1).text)) {
      row.getCell(2).value =
        `Rumah pompa (sheet ${RUMAH_POMPA_SHEET}) dan sebagian kolam retensi ditambahkan dari OpenStreetMap lewat Overpass API ` +
        `(lisensi ODbL, © kontributor OpenStreetMap), diakses ${today}, dengan scripts/tambah-osm.js. Desa, kecamatan, dan kab/kota ` +
        'dari Nominatim. Pompa milik PDAM, swasta, atau warga (RW/perumahan) dilewati. Data OSM bergantung pada kontributor, jadi tidak lengkap.';
    }
  });
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  if (!fs.existsSync(xlsxPath)) {
    console.error(`❌ File xlsx tidak ditemukan: ${xlsxPath}`);
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  if (!workbook.getWorksheet(KOLAM_SHEET)) {
    console.error(`❌ Sheet "${KOLAM_SHEET}" tidak ada di ${path.basename(xlsxPath)}.`);
    process.exit(1);
  }
  const existing = readExisting(workbook);
  console.log(`📄 ${path.basename(xlsxPath)}: ${existing.length} titik lama.\n`);

  console.log('🔎 Mengambil data OpenStreetMap (Overpass)...');
  const elements = new Map();
  for (const name of Object.keys(QUERIES)) {
    const data = await overpass(name);
    data.elements.forEach((el) => elements.set(`${el.type}/${el.id}`, el));
  }
  console.log(`   ${elements.size} elemen OSM unik.`);

  // ─── Saring & buang duplikat (sebelum geocoding agar request Nominatim seminimal mungkin) ───
  const skipped = { bukanTarget: 0, sudahAda: 0, duplikat: 0, luarJawa: 0 };
  const candidates = [];
  for (const [ref, el] of elements) {
    const info = classify(el);
    const point = elementPoint(el);
    if (!info || !point) { skipped.bukanTarget++; continue; }

    const osm = `https://www.openstreetmap.org/${ref}`;
    const key = normalizeName(info.name);
    const radius = DUPLICATE_RADIUS_M[info.kategori];
    const sameAsExisting = existing.some((p) =>
      p.osm === osm ||
      distanceM(p, point) < 60 ||
      (info.kategori === 'Kolam retensi' && KOLAM_LIKE.test(p.name) && distanceM(p, point) < radius) ||
      (p.name === key && distanceM(p, point) < 1000));
    if (sameAsExisting) { skipped.sudahAda++; continue; }

    const dup = candidates.find((c) =>
      distanceM(c, point) < 30 ||
      (c.kategori === info.kategori && info.kategori === 'Kolam retensi' && distanceM(c, point) < radius) ||
      (c.key === key && !info.generic && distanceM(c, point) < 1000));
    if (dup) {
      skipped.duplikat++;
      // Simpan versi area (way/relation) bila ada: titik tengahnya lebih mewakili bangunan/kolam
      if (dup.ref.startsWith('node/') && !ref.startsWith('node/')) Object.assign(dup, { ref, osm, ...point });
      continue;
    }
    candidates.push({ ...info, ...point, ref, osm, key });
  }
  console.log(`   ${candidates.length} kandidat (rumah pompa ${candidates.filter((c) => c.kategori === 'Rumah pompa').length}, kolam retensi ${candidates.filter((c) => c.kategori === 'Kolam retensi').length}).`);

  console.log(`📍 Melengkapi wilayah lewat Nominatim (±${candidates.length} detik bila belum ada di cache)...`);
  const today = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
  const rows = [];
  for (const c of candidates) {
    const geo = await reverseGeocode(c.lat, c.lng);
    const parts = addressParts(geo);
    if (!parts.provinsi || !parts.kabKota) { skipped.luarJawa++; continue; }

    const reasons = [];
    let nama = c.name;
    if (c.generic) {
      const tempat = parts.desa || parts.kecamatan;
      if (tempat) nama = `${c.name} (${tempat})`;
      reasons.push('Nama di OSM generik; ditambah nama desa/kelurahan');
    }
    if (c.byTagOnly) reasons.push('Ditandai kolam retensi/detensi di OSM, tetapi namanya tidak menyebut kolam retensi');
    if (!parts.kecamatan || !parts.desa) reasons.push('Kecamatan/desa tidak lengkap di OSM');

    const notes = [];
    if (c.operator) notes.push(`Pengelola di OSM: ${c.operator}`);
    else if (c.kategori === 'Rumah pompa') notes.push('Pengelola tidak tercantum di OSM; diasumsikan pemerintah daerah');
    notes.push(...reasons);

    rows.push({
      kategori: c.kategori,
      nama,
      ...parts,
      lat: Number(c.lat.toFixed(7)),
      lng: Number(c.lng.toFixed(7)),
      osm: c.osm,
      sumber: `OpenStreetMap (ODbL), diakses ${today}`,
      status: reasons.length ? STATUS_CEK : STATUS_OSM,
      catatan: notes.length ? `${notes.join('. ')}.` : null,
    });
  }

  const order = (a, b) =>
    PROVINSI_JAWA.indexOf(a.provinsi) - PROVINSI_JAWA.indexOf(b.provinsi) ||
    a.kabKota.localeCompare(b.kabKota) || (a.kecamatan || '').localeCompare(b.kecamatan || '') || a.nama.localeCompare(b.nama);
  const pompa = rows.filter((r) => r.kategori === 'Rumah pompa').sort(order);
  const kolam = rows.filter((r) => r.kategori === 'Kolam retensi').sort(order);

  // ─── Ringkasan ───
  const summarize = (list) => Object.entries(list.reduce((acc, r) => ({ ...acc, [r.provinsi]: (acc[r.provinsi] || 0) + 1 }), {}))
    .map(([p, n]) => `${p} ${n}`).join(', ') || '-';
  console.log('═══════════════════════════════════════════');
  console.log(`✅ ${pompa.length} rumah pompa (Pemda) baru: ${summarize(pompa)}`);
  console.log(`✅ ${kolam.length} kolam retensi baru: ${summarize(kolam)}`);
  console.log(`   Perlu cek ulang: ${rows.filter((r) => r.status === STATUS_CEK).length}`);
  console.log(`   Dilewati: ${skipped.bukanTarget} bukan target, ${skipped.sudahAda} sudah ada di xlsx, ${skipped.duplikat} duplikat OSM, ${skipped.luarJawa} di luar 6 provinsi Jawa`);
  console.log(`   Request: Overpass ${stats.overpass}, Nominatim ${stats.nominatim}, dari cache ${stats.cacheHits}`);
  console.log('═══════════════════════════════════════════');

  if (DRY_RUN) {
    [...pompa, ...kolam].forEach((r) => console.log(`   ${r.kategori.padEnd(13)} ${r.kabKota.padEnd(22)} ${r.nama}${r.status === STATUS_CEK ? '  [cek ulang]' : ''}`));
    console.log('\n(--dry-run: xlsx tidak diubah)');
    return;
  }
  if (rows.length === 0) {
    console.log('Tidak ada titik baru; xlsx tidak diubah.');
    return;
  }

  backupSekali(xlsxPath, 'sebelum-osm');

  const kolamSheet = workbook.getWorksheet(KOLAM_SHEET);
  if (kolam.length) appendRows(kolamSheet, kolam, kolamSheet);
  if (pompa.length) appendRows(ensureRumahPompaSheet(workbook), pompa, kolamSheet);
  updateRingkasan(workbook, today);
  updateCatatan(workbook, today);
  workbook.calcProperties.fullCalcOnLoad = true;

  await workbook.xlsx.writeFile(xlsxPath);
  console.log(`📝 ${pompa.length} baris ke sheet "${RUMAH_POMPA_SHEET}", ${kolam.length} baris ke sheet "${KOLAM_SHEET}". Lanjutkan dengan: npm run seed`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
  });
}

module.exports = { QUERIES, classify, addressParts };

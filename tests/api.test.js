/**
 * Tes API caiKU (node:test, tanpa dependensi tambahan). Jalankan: npm test
 *
 * Memakai database terpisah prisma/test.db yang dibuat ulang setiap kali tes berjalan,
 * jadi prisma/dev.db tidak tersentuh. Tes tidak memanggil server OSRM (hanya validasi rute).
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const TEST_DB = path.join(ROOT, 'prisma', 'test.db');

// Harus di-set sebelum server/Prisma di-require (dotenv tidak menimpa env yang sudah ada)
process.env.DATABASE_URL = 'file:./test.db';
process.env.ADMIN_USERNAME = 'penguji';
process.env.ADMIN_PASSWORD = 'sandi-uji-123';
process.env.ADMIN_NAME = 'Petugas Uji';
process.env.AUTH_SECRET = 'secret-khusus-tes';
// Tes tidak pernah memanggil Gemini sungguhan, walau .env pengembang berisi kunci
process.env.GEMINI_API_KEY = '';

let server;
let baseUrl;
let prisma;
let token;
let fixture;

async function call(method, urlPath, { body, auth = false, rawBody } = {}) {
  const headers = {};
  if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = `Bearer ${typeof auth === 'string' ? auth : token}`;
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // bukan JSON
  }
  return { status: res.status, json, headers: res.headers };
}

before(async () => {
  fs.rmSync(TEST_DB, { force: true });
  execSync('npx prisma db push --skip-generate', {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'pipe',
  });

  prisma = require('../config/database');
  const wilayah = await prisma.wilayah.create({
    data: { kode: 'KOTA-UJI', nama: 'Kota Uji', tipe: 'KOTA', provinsi: 'Jawa Barat' },
  });
  const pengelola = await prisma.pengelola.create({ data: { nama: 'PDAM Kota Uji', tipe: 'PERUMDA' } });
  const titik = await prisma.fasilitasAir.create({
    data: {
      no: 1,
      nodeId: 'JAWA-001',
      nama: 'Kantor PDAM Kota Uji',
      kategori: 'Perumda',
      wilayahId: wilayah.id,
      pengelolaId: pengelola.id,
      jenisFasilitas: 'Kantor PDAM (Pusat/Utama)',
      latitude: -6.9,
      longitude: 107.6,
    },
  });
  fixture = { wilayah, pengelola, titik };

  const { app } = require('../server');
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
  fs.rmSync(TEST_DB, { force: true });
});

// ─── Data publik ──────────────────────────────────────────────────────────────
test('GET /fasilitas mengembalikan daftar titik', async () => {
  const { status, json } = await call('GET', '/fasilitas');
  assert.equal(status, 200);
  assert.equal(json.total, 1);
  assert.equal(json.data[0].wilayahNama, 'Kota Uji');
  assert.equal(json.data[0].provinsi, 'Jawa Barat');
  assert.equal(json.data[0].pengelolaNama, 'PDAM Kota Uji');
  // Bentuk datar: objek relasi tidak ikut dikirim dua kali
  assert.equal('wilayah' in json.data[0], false);
  assert.equal('pengelola' in json.data[0], false);
  assert.equal(json.data[0].wilayahId, fixture.wilayah.id);
});

test('aset statis yang tidak ada dijawab 404; navigasi SPA tetap index.html', async () => {
  const root = baseUrl.replace(/\/api$/, '');
  const hilang = await fetch(`${root}/js/tidak-ada.js`);
  assert.equal(hilang.status, 404);
  const spa = await fetch(`${root}/peta`);
  assert.equal(spa.status, 200);
  assert.match(spa.headers.get('content-type'), /text\/html/);
});

test('respons dikompresi bila browser mendukung', async () => {
  const root = baseUrl.replace(/\/api$/, '');
  const res = await fetch(`${root}/js/core.js`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-encoding'), 'gzip');
});

test('titik baru tanpa status operasional tercatat "Belum diketahui"', async () => {
  const { json } = await call('GET', '/fasilitas/JAWA-001');
  assert.equal(json.data.statusOperasional, 'Belum diketahui');

  const stats = await call('GET', '/stats');
  assert.equal(stats.json.data.belumDiketahui, 1);
  assert.equal(stats.json.data.normal, 0);
});

test('detail titik publik tidak membawa log perubahan', async () => {
  const { status, json } = await call('GET', `/fasilitas/${fixture.titik.id}`);
  assert.equal(status, 200);
  assert.equal(json.data.nodeId, 'JAWA-001');
  assert.equal('logPembaruan' in json.data, false);
});

test('endpoint API yang tidak dikenal dijawab JSON 404', async () => {
  const { status, json } = await call('GET', '/tidak-ada');
  assert.equal(status, 404);
  assert.equal(json.success, false);
});

// ─── Autentikasi ──────────────────────────────────────────────────────────────
test('aksi petugas & riwayat log butuh login', async () => {
  assert.equal((await call('POST', '/fasilitas', { body: {} })).status, 401);
  assert.equal((await call('GET', `/fasilitas/${fixture.titik.id}/log`)).status, 401);
  assert.equal((await call('GET', '/arsip')).status, 401);
});

test('token yang ditandatangani dengan secret turunan kredensial lama ditolak', async () => {
  // Cara lama: secret = sha256("caiku-auth:<username>:<password>") bila AUTH_SECRET kosong
  const oldSecret = crypto.createHash('sha256').update('caiku-auth:penguji:sandi-uji-123').digest('hex');
  const body = Buffer.from(JSON.stringify({ username: 'penguji', name: 'X', exp: Date.now() + 60000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', oldSecret).update(body).digest('base64url');
  const { status } = await call('GET', '/auth/me', { auth: `${body}.${signature}` });
  assert.equal(status, 401);
});

test('login dengan password salah ditolak, password benar memberi token', async () => {
  const wrong = await call('POST', '/auth/login', { body: { username: 'penguji', password: 'salah' } });
  assert.equal(wrong.status, 401);

  const ok = await call('POST', '/auth/login', { body: { username: 'penguji', password: 'sandi-uji-123' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.user.name, 'Petugas Uji');
  token = ok.json.data.token;

  const me = await call('GET', '/auth/me', { auth: true });
  assert.equal(me.status, 200);
});

test('body JSON rusak dijawab 400 tanpa detail internal', async () => {
  const { status, json } = await call('POST', '/auth/login', { rawBody: '{"username":' });
  assert.equal(status, 400);
  assert.equal(json.message, 'Format body JSON tidak valid');
  assert.equal(json.error, undefined);
});

// ─── CRUD, log, arsip & pemulihan ─────────────────────────────────────────────
let createdId;
let arsipId;

test('petugas menambah titik; status tidak valid ditolak', async () => {
  const base = {
    nodeId: 'JAWA-002',
    nama: 'Reservoar Uji',
    wilayahId: fixture.wilayah.id,
    pengelolaId: fixture.pengelola.id,
    jenisFasilitas: 'Reservoar PDAM',
    latitude: -6.91,
    longitude: 107.61,
  };

  const invalid = await call('POST', '/fasilitas', { auth: true, body: { ...base, statusOperasional: 'Entah' } });
  assert.equal(invalid.status, 400);

  const { status, json } = await call('POST', '/fasilitas', { auth: true, body: base });
  assert.equal(status, 201);
  assert.equal(json.data.statusOperasional, 'Belum diketahui');
  assert.equal(json.data.sumberData, 'Input Petugas GIS');
  createdId = json.data.id;

  const duplicate = await call('POST', '/fasilitas', { auth: true, body: base });
  assert.equal(duplicate.status, 409);
});

test('perubahan titik tercatat di log khusus petugas', async () => {
  const update = await call('PUT', `/fasilitas/${createdId}`, { auth: true, body: { statusOperasional: 'Beroperasi Normal' } });
  assert.equal(update.status, 200);
  assert.equal(update.json.changes, 1);

  const { status, json } = await call('GET', `/fasilitas/${createdId}/log`, { auth: true });
  assert.equal(status, 200);
  assert.deepEqual(json.data.map((log) => log.fieldDiubah).sort(), ['dibuat', 'statusOperasional']);
  const change = json.data.find((log) => log.fieldDiubah === 'statusOperasional');
  assert.equal(change.nilaiLama, 'Belum diketahui');
  assert.equal(change.nilaiBaru, 'Beroperasi Normal');
  assert.equal(change.diubahOleh, 'Petugas Uji');
});

test('koordinat yang hanya beda pembulatan 6 desimal tidak dianggap perubahan', async () => {
  // Titik fixture memakai koordinat 7 desimal, formulir mengirim versi 6 desimal
  const precise = await prisma.fasilitasAir.update({
    where: { id: fixture.titik.id },
    data: { latitude: -6.9123457, longitude: 107.6123457 },
  });
  const res = await call('PUT', `/fasilitas/${precise.id}`, {
    auth: true,
    body: { latitude: precise.latitude.toFixed(6), longitude: precise.longitude.toFixed(6), nama: precise.nama },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.changes, 0);
  assert.equal(res.json.data.latitude, -6.9123457); // nilai asli tidak ikut terbulatkan
  // Tanpa perubahan, waktu "Diperbarui" tidak ikut bergeser
  assert.equal(new Date(res.json.data.updatedAt).getTime(), precise.updatedAt.getTime());

  const moved = await call('PUT', `/fasilitas/${precise.id}`, { auth: true, body: { latitude: '-6.912400' } });
  assert.equal(moved.json.changes, 1);
});

test('hapus titik memindahkannya ke arsip beserta log-nya', async () => {
  const del = await call('DELETE', `/fasilitas/${createdId}`, { auth: true });
  assert.equal(del.status, 200);
  arsipId = del.json.arsipId;

  assert.equal((await call('GET', '/fasilitas/JAWA-002')).status, 404);

  const { json } = await call('GET', '/arsip', { auth: true });
  assert.equal(json.total, 1);
  assert.equal(json.data[0].nodeId, 'JAWA-002');
  assert.equal(json.data[0].jumlahLog, 2);
  assert.equal(json.data[0].dihapusOleh, 'Petugas Uji');
  assert.equal(json.data[0].dataTitik, undefined); // salinan lengkap tidak dikirim di daftar
});

test('titik di arsip bisa dipulihkan sekali beserta log lamanya', async () => {
  const restore = await call('POST', `/arsip/${arsipId}/pulihkan`, { auth: true });
  assert.equal(restore.status, 200);
  assert.equal(restore.json.data.nodeId, 'JAWA-002');
  assert.equal(restore.json.data.statusOperasional, 'Beroperasi Normal');
  assert.equal(restore.json.data.sumberData, 'Input Petugas GIS');

  const logs = await call('GET', `/fasilitas/${restore.json.data.id}/log`, { auth: true });
  assert.deepEqual(logs.json.data.map((log) => log.fieldDiubah).sort(), ['dibuat', 'dipulihkan', 'statusOperasional']);

  const again = await call('POST', `/arsip/${arsipId}/pulihkan`, { auth: true });
  assert.equal(again.status, 409);

  const arsip = await call('GET', '/arsip', { auth: true });
  assert.ok(arsip.json.data[0].dipulihkanAt);
});

test('pemulihan ditolak bila Node ID sudah dipakai titik lain', async () => {
  const titik = await call('GET', '/fasilitas/JAWA-002');
  const del = await call('DELETE', `/fasilitas/${titik.json.data.id}`, { auth: true });
  await call('POST', '/fasilitas', {
    auth: true,
    body: {
      nodeId: 'JAWA-002', wilayahId: fixture.wilayah.id, pengelolaId: fixture.pengelola.id,
      jenisFasilitas: 'Reservoar PDAM', latitude: -6.92, longitude: 107.62,
    },
  });
  const { status, json } = await call('POST', `/arsip/${del.json.arsipId}/pulihkan`, { auth: true });
  assert.equal(status, 409);
  assert.match(json.message, /sudah dipakai/);
});

// ─── Analisis cakupan layanan ─────────────────────────────────────────────────
test('rumus kapasitas SR dan radius layanan', () => {
  const { hitungKapasitasSR, hitungRadiusKm } = require('../services/cakupan');
  // 1,5 L/s × 86.400 × 0,85 ÷ (60 × 5 × 1,1) = 333,8 → 333 SR
  assert.equal(hitungKapasitasSR({ debitLps: 1.5, kebutuhan: 60, kehilangan: 0.15 }), 333);
  // 50 L/s × 86.400 × 0,8 ÷ (120 × 5 × 1,1) = 5.236,4 → 5.236 SR
  assert.equal(hitungKapasitasSR({ debitLps: 50, kebutuhan: 120, kehilangan: 0.2 }), 5236);
  assert.equal(hitungKapasitasSR({ debitLps: 0, kebutuhan: 60, kehilangan: 0.15 }), 0);
  // Radius dibatasi 0,3–15 km
  assert.equal(hitungRadiusKm({ jiwa: 1, kepadatan: 100000, porsiTersambung: 1 }), 0.3);
  assert.equal(hitungRadiusKm({ jiwa: 1e9, kepadatan: 1, porsiTersambung: 1 }), 15);
});

test('kantor PDAM tanpa data kapasitas tidak dihitung cakupannya', async () => {
  const { status, json } = await call('GET', '/cakupan/JAWA-001');
  assert.equal(status, 200);
  assert.equal(json.data.dihitung, false);
  assert.equal(json.data.peran, 'kantor');
  assert.equal((await call('GET', '/cakupan/JAWA-999')).status, 404);
});

test('kolom kapasitas divalidasi dan dicatat di log', async () => {
  const id = fixture.titik.id;
  assert.equal((await call('PUT', `/fasilitas/${id}`, { auth: true, body: { debitLps: -1 } })).status, 400);
  assert.equal((await call('PUT', `/fasilitas/${id}`, { auth: true, body: { jumlahSR: 2.5 } })).status, 400);
  assert.equal((await call('PUT', `/fasilitas/${id}`, { auth: true, body: { jenisSumber: 'Laut' } })).status, 400);

  const ok = await call('PUT', `/fasilitas/${id}`, { auth: true, body: { jenisSumber: 'Mata Air', debitLps: '1,5', jumlahSR: '250' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.changes, 3);
  assert.equal(ok.json.data.debitLps, 1.5);
  assert.equal(ok.json.data.jumlahSR, 250);

  const kosong = await call('PUT', `/fasilitas/${id}`, { auth: true, body: { debitLps: '' } });
  assert.equal(kosong.json.data.debitLps, null);
  await call('PUT', `/fasilitas/${id}`, { auth: true, body: { debitLps: 1.5 } });
});

test('cakupan memakai data petugas: SR aktual, kapasitas, dan kecamatan tercakup', async () => {
  const { json } = await call('GET', '/cakupan/JAWA-001');
  const d = json.data;
  assert.equal(d.dihitung, true);
  assert.deepEqual(d.debit, { nilai: 1.5, asal: 'data' });
  assert.deepEqual(d.jenisSumber, { nilai: 'Mata Air', asal: 'data' });
  assert.equal(d.parameter.kebutuhanLOrangHari, 150); // lokasi di "Kota ..."
  assert.equal(d.srAktual, 250);
  assert.equal(d.srLayanan, 250);
  assert.equal(d.sumberSR, 'data');
  assert.equal(d.jiwaTerlayani, 1250);
  assert.ok(d.kapasitasSR > 0);
  assert.ok(d.radiusKm >= 0.3);
  assert.ok(d.kecamatanLokasi, 'titik di Bandung punya kecamatan lokasi');
  assert.ok(d.wilayahTercakup.length > 0);
  assert.equal(d.area.type, 'Feature');
  const totalJiwa = d.wilayahTercakup.reduce((sum, w) => sum + w.perkiraanJiwa, 0);
  assert.ok(Math.abs(totalJiwa - d.jiwaTerlayani) <= d.wilayahTercakup.length + 25);
});

test('Pamsimas tanpa debit memakai estimasi; rumah pompa bukan sumber air bersih', async () => {
  const base = { wilayahId: fixture.wilayah.id, pengelolaId: fixture.pengelola.id };
  await call('POST', '/fasilitas', {
    auth: true,
    body: { ...base, nodeId: 'JAWA-010', nama: 'Pamsimas Uji', kategori: 'Pamsimas', jenisFasilitas: 'Pamsimas', latitude: -6.81, longitude: 107.62 },
  });
  await call('POST', '/fasilitas', {
    auth: true,
    body: { ...base, nodeId: 'JAWA-011', nama: 'Rumah Pompa Uji', kategori: 'Pemda', jenisFasilitas: 'Rumah Pompa', latitude: -6.93, longitude: 107.63 },
  });

  const pamsimas = (await call('GET', '/cakupan/JAWA-010')).json.data;
  assert.equal(pamsimas.dihitung, true);
  assert.equal(pamsimas.kapasitasSR, 333);
  assert.equal(pamsimas.sumberSR, 'estimasi');
  assert.ok(pamsimas.wilayahTercakup.length > 0);

  const pompa = (await call('GET', '/cakupan/JAWA-011')).json.data;
  assert.equal(pompa.dihitung, false);
  assert.match(pompa.alasan, /bukan sumber air bersih/);
});

test('ringkasan cakupan wilayah', async () => {
  const { status, json } = await call('GET', `/cakupan/wilayah?provinsi=${encodeURIComponent('Jawa Barat')}`);
  assert.equal(status, 200);
  const d = json.data;
  assert.equal(d.wilayah, 'Jawa Barat');
  // Ambang longgar: angka pasti bergantung pada data batas wilayah (public/data/batas)
  assert.ok(d.jumlahKecamatan > 0);
  assert.ok(d.penduduk > 0);
  assert.ok(d.jumlahSumberDihitung >= 2); // JAWA-001 (data) & Pamsimas uji
  assert.equal(d.jumlahKecamatanTercakup + d.kecamatanTanpaLayanan.length, d.jumlahKecamatan);
});

test('ringkasan cakupan per kab/kota ikut berubah setelah titik ditambah (cache diperbarui)', async () => {
  const url = `/cakupan/wilayah?wilayah=${encodeURIComponent('Kota Uji')}`;
  const sebelum = await call('GET', url);
  assert.equal(sebelum.status, 200);
  assert.equal(sebelum.json.data.wilayah, 'Kota Uji');
  // Panggilan kedua (dari cache) sama persis
  assert.deepEqual((await call('GET', url)).json.data, sebelum.json.data);

  const baru = await call('POST', '/fasilitas', {
    auth: true,
    body: {
      nodeId: 'JAWA-012', nama: 'Pamsimas Cache Uji', kategori: 'Pamsimas', jenisFasilitas: 'Pamsimas',
      wilayahId: fixture.wilayah.id, pengelolaId: fixture.pengelola.id, latitude: -6.85, longitude: 107.58,
    },
  });
  assert.equal(baru.status, 201);

  const sesudah = await call('GET', url);
  assert.equal(sesudah.json.data.jumlahTitik, sebelum.json.data.jumlahTitik + 1);
});

test('query cakupan berbentuk array tidak membuat server error', async () => {
  const { status } = await call('GET', '/cakupan/wilayah?provinsi=a&provinsi=b&wilayah=x&wilayah=y');
  assert.equal(status, 200);
});

test('endpoint cakupan memberi header batas permintaan', async () => {
  const { status, headers } = await call('GET', '/cakupan/JAWA-001');
  assert.equal(status, 200);
  assert.ok(headers.get('ratelimit-policy'), 'header RateLimit-Policy ada');
});

test('filter GET /fasilitas: provinsi, kab/kota, dan pencarian teks', async () => {
  const semua = (await call('GET', '/fasilitas')).json.total;
  assert.ok(semua >= 3);

  const jabar = await call('GET', `/fasilitas?provinsi=${encodeURIComponent('Jawa Barat')}`);
  assert.equal(jabar.json.total, semua);
  assert.equal((await call('GET', '/fasilitas?provinsi=Banten')).json.total, 0);
  assert.equal((await call('GET', `/fasilitas?wilayah=${encodeURIComponent('Kota Uji')}`)).json.total, semua);

  const cari = await call('GET', '/fasilitas?search=Pamsimas');
  assert.ok(cari.json.total >= 1);
  assert.ok(cari.json.data.every((f) => /pamsimas/i.test(`${f.nama} ${f.jenisFasilitas}`)));
  assert.ok(cari.json.data.some((f) => f.nodeId === 'JAWA-010'));
});

test('POST /pengelola: butuh login, nama wajib, nama ganda ditolak', async () => {
  assert.equal((await call('POST', '/pengelola', { body: { nama: 'PDAM Baru' } })).status, 401);
  assert.equal((await call('POST', '/pengelola', { auth: true, body: { nama: '   ' } })).status, 400);
  assert.equal((await call('POST', '/pengelola', { auth: true, body: { nama: 'x'.repeat(121) } })).status, 400);

  const ok = await call('POST', '/pengelola', { auth: true, body: { nama: 'Pamsimas Desa Uji' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.data.tipe, 'PAMSIMAS');

  const ganda = await call('POST', '/pengelola', { auth: true, body: { nama: 'Pamsimas Desa Uji' } });
  assert.equal(ganda.status, 409);
});

test('fungsi aksi peta AI memvalidasi wilayah & titik lalu mengumpulkan aksi', async () => {
  const { jalankanTool, ringkasAksi } = require('../services/aiAsisten');
  const { ambilSemuaFasilitas } = require('../services/dataFasilitas');
  const facilities = await ambilSemuaFasilitas();
  const ctx = {
    aksi: [],
    wilayahList: [
      { wilayahNama: 'Kota Uji', provinsi: 'Jawa Barat' },
      { wilayahNama: 'Kabupaten Tanpa Titik', provinsi: 'Banten' },
    ],
  };

  // Kab/kota tanpa awalan & tanpa provinsi → provinsi diisi otomatis
  const wil = await jalankanTool('tampilkan_wilayah_di_peta', { kabkota: 'uji', sorot_belum_terlayani: true }, facilities, ctx);
  assert.equal(wil.ok, true);
  assert.deepEqual(ctx.aksi.at(-1), { tipe: 'wilayah', provinsi: 'Jawa Barat', wilayah: 'Kota Uji', sorotCelah: true });

  // Kab/kota yang belum punya titik tetap bisa dibuka (dari tabel Wilayah)
  assert.equal((await jalankanTool('tampilkan_wilayah_di_peta', { kabkota: 'Kabupaten Tanpa Titik' }, facilities, ctx)).ok, true);

  // Provinsi tidak cocok dengan kab/kota → error, tidak ada aksi baru
  const jumlah = ctx.aksi.length;
  const salah = await jalankanTool('tampilkan_wilayah_di_peta', { provinsi: 'Banten', kabkota: 'Kota Uji' }, facilities, ctx);
  assert.match(salah.error, /Jawa Barat/);
  assert.equal((await jalankanTool('tampilkan_wilayah_di_peta', { kabkota: 'Kota Antah' }, facilities, ctx)).error !== undefined, true);
  assert.equal(ctx.aksi.length, jumlah);

  const titik = await jalankanTool('buka_titik_di_peta', { node_id: 'jawa-001', tampilkan_area: true }, facilities, ctx);
  assert.equal(titik.ok, true);
  assert.deepEqual(ctx.aksi.at(-1), { tipe: 'titik', nodeId: 'JAWA-001', area: true });
  assert.ok((await jalankanTool('buka_titik_di_peta', { node_id: 'JAWA-999' }, facilities, ctx)).error);

  assert.equal((await jalankanTool('filter_kategori_peta', { kategori: 'pamsimas' }, facilities, ctx)).ok, true);
  assert.ok((await jalankanTool('filter_kategori_peta', { kategori: 'Hotel' }, facilities, ctx)).error);

  // Satu aksi per jenis (terakhir menang), urutan kategori → wilayah → titik
  const ringkas = ringkasAksi(ctx.aksi);
  assert.deepEqual(ringkas.map((a) => a.tipe), ['kategori', 'wilayah', 'titik']);
  assert.equal(ringkas[1].wilayah, 'Kabupaten Tanpa Titik');
  assert.equal(ringkas[1].provinsi, 'Banten');
});

test('asisten AI tanpa GEMINI_API_KEY menjawab 503; input divalidasi', async () => {
  const status = await call('GET', '/ai/status');
  assert.equal(status.json.data.aktif, false);

  const res = await call('POST', '/ai/chat', { body: { pesan: 'Halo' } });
  assert.equal(res.status, 503);
  assert.match(res.json.message, /GEMINI_API_KEY/);

  process.env.GEMINI_API_KEY = 'kunci-palsu-untuk-tes';
  try {
    // Ditolak sebelum memanggil Gemini
    assert.equal((await call('POST', '/ai/chat', { body: { pesan: '   ' } })).status, 400);
    assert.equal((await call('POST', '/ai/chat', { body: { pesan: 'x'.repeat(1001) } })).status, 400);
  } finally {
    process.env.GEMINI_API_KEY = '';
  }
});

// ─── Validasi rute ────────────────────────────────────────────────────────────
test('rute menolak mode dan koordinat yang tidak valid', async () => {
  const coords = 'startLat=-6.9&startLng=107.6&endLat=-6.95&endLng=107.65';
  const badMode = await call('GET', `/route?${coords}&mode=${encodeURIComponent('../../table/v1/driving')}`);
  assert.equal(badMode.status, 400);

  const outOfRange = await call('GET', '/route?startLat=-95&startLng=107.6&endLat=-6.95&endLng=107.65');
  assert.equal(outOfRange.status, 400);

  const notNumber = await call('GET', '/route?startLat=abc&startLng=107.6&endLat=-6.95&endLng=107.65');
  assert.equal(notNumber.status, 400);
});

// ─── Konfigurasi produksi ────────────────────────────────────────────────────
test('mode produksi menolak jalan tanpa ADMIN_PASSWORD/AUTH_SECRET', () => {
  const { assertProductionAuthConfig } = require('../middleware/auth');
  const saved = { NODE_ENV: process.env.NODE_ENV, AUTH_SECRET: process.env.AUTH_SECRET };
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_SECRET;
    assert.throws(() => assertProductionAuthConfig(), /AUTH_SECRET/);
    process.env.AUTH_SECRET = 'ada';
    assert.doesNotThrow(() => assertProductionAuthConfig());
  } finally {
    if (saved.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved.NODE_ENV;
    process.env.AUTH_SECRET = saved.AUTH_SECRET;
  }
});

// ─── Pembatas login (dijalankan terakhir karena memblokir IP tes) ─────────────
test('login diblokir sementara setelah 5 kali gagal', async () => {
  const { LOGIN_MAX_FAILURES, resetLoginFailures } = require('../middleware/auth');
  resetLoginFailures();
  for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
    const res = await call('POST', '/auth/login', { body: { username: 'penguji', password: `salah-${i}` } });
    assert.equal(res.status, 401);
  }
  // Password benar pun ditolak selama masa blokir
  const blocked = await call('POST', '/auth/login', { body: { username: 'penguji', password: 'sandi-uji-123' } });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  resetLoginFailures();
});

/**
 * Asisten AI caiKU (Google Gemini) dengan function calling.
 *
 * Gemini tidak menghitung sendiri: setiap angka diambil dari fungsi di services/cakupan.js
 * (model cakupan yang bisa dijelaskan). Kunci API hanya ada di server (.env GEMINI_API_KEY).
 */
const cakupan = require('./cakupan');
const { ambilSemuaFasilitas, ambilFasilitas } = require('./dataFasilitas');
const { KATEGORI } = require('../config/constants');
const { normalisasiTeks } = require('../utils/teks');
const prisma = require('../config/database');

// Dipakai bila daftar model gagal diambil dari API
const MODEL_CADANGAN = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
const MAKS_PUTARAN_TOOL = 6;
// Batas waktu satu pertanyaan (seluruh putaran function calling)
const BATAS_WAKTU_MS = Number(process.env.AI_TIMEOUT_MS) || 90_000;
// Batas waktu satu panggilan; lewat dari ini dianggap macet dan pindah ke model cadangan
const BATAS_PANGGILAN_MS = Number(process.env.AI_CALL_TIMEOUT_MS) || 15_000;
// Model yang sibuk (503/429) dilewati 2 menit; yang macet sampai batas waktu dilewati 10 menit
const JEDA_MODEL_SIBUK_MS = 2 * 60_000;
const JEDA_MODEL_MACET_MS = 10 * 60_000;

let client = null;
let clientKey = null;
let daftarModel = null;              // { apiKey, models: [...] } model Flash, terbaru dulu
const modelBermasalah = new Set();   // model yang ditolak API (nama salah / tidak tersedia untuk kunci ini)
const modelSibuk = new Map();        // nama model → waktu (ms) sampai boleh dicoba lagi
let modelTerakhirBerhasil = null;    // dicoba lebih dulu agar pertanyaan berikutnya cepat
let peringatanModel = null;

function konfigurasi() {
  return {
    apiKey: (process.env.GEMINI_API_KEY || '').trim(),
    modelDiminta: (process.env.GEMINI_MODEL || '').trim() || null,
  };
}

function aiAktif() {
  return Boolean(konfigurasi().apiKey);
}

/**
 * Model "gemini-X.Y-flash" lalu "gemini-X.Y-flash-lite" yang tersedia untuk kunci ini, terbaru dulu.
 * Diambil dari daftar model (alias seperti gemini-flash-latest bisa dihapus Google sewaktu-waktu).
 * Model "pro"/eksperimental tidak dipakai otomatis karena bisa butuh beberapa menit untuk menjawab.
 */
async function modelFlashTersedia() {
  const { apiKey } = konfigurasi();
  if (daftarModel?.apiKey === apiKey) return daftarModel.models;
  let models = MODEL_CADANGAN;
  try {
    const pager = await getClient().models.list({ config: { pageSize: 200 } });
    const kandidat = [];
    for await (const m of pager) {
      const nama = String(m.name || '').replace(/^models\//, '');
      const cocok = /^gemini-(\d+)(?:\.(\d+))?-flash(-lite)?$/.exec(nama);
      if (cocok && (m.supportedActions || []).includes('generateContent')) {
        kandidat.push({ nama, lite: Boolean(cocok[3]), versi: Number(cocok[1]) * 1000 + Number(cocok[2] || 0) });
      }
    }
    kandidat.sort((a, b) => a.lite - b.lite || b.versi - a.versi);
    if (kandidat.length) models = kandidat.map((k) => k.nama);
  } catch (err) {
    console.warn(`Daftar model Gemini gagal diambil (${err?.status || err?.message}); memakai daftar cadangan`);
  }
  daftarModel = { apiKey, models };
  return models;
}

// Urutan model yang dicoba: GEMINI_MODEL (bila valid), model yang terakhir berhasil,
// lalu Flash terbaru, lalu Flash-Lite. Model yang baru saja sibuk/macet dipindah ke belakang.
async function urutanModel() {
  const { modelDiminta } = konfigurasi();
  const semua = [
    ...(modelDiminta ? [modelDiminta] : []),
    ...(modelTerakhirBerhasil ? [modelTerakhirBerhasil] : []),
    ...(await modelFlashTersedia()),
  ];
  const unik = [...new Set(semua)].filter((m) => !modelBermasalah.has(m));
  const now = Date.now();
  const siap = unik.filter((m) => !(modelSibuk.get(m) > now));
  const sibuk = unik.filter((m) => modelSibuk.get(m) > now);
  return [...siap, ...sibuk];
}

// Nama model salah format (400) atau tidak tersedia untuk kunci ini (404)
function errorModelTidakValid(err) {
  const teks = String(err?.message || '');
  return err?.status === 404 || (err?.status === 400 && /model/i.test(teks) && !/API key/i.test(teks));
}

// Gangguan sementara di sisi Google: model penuh, kuota per model, error server, atau macet
function errorSementara(err) {
  return [429, 500, 502, 503, 504].includes(err?.status) || err?.name === 'AbortError' || err?.name === 'TimeoutError';
}

async function infoModel() {
  if (!aiAktif()) return { model: null, peringatan: null };
  const [model] = await urutanModel();
  return { model, peringatan: peringatanModel };
}

function getClient() {
  const { apiKey } = konfigurasi();
  if (!client || clientKey !== apiKey) {
    const { GoogleGenAI } = require('@google/genai');
    client = new GoogleGenAI({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

// ============================================================================
// Deklarasi fungsi untuk Gemini
// ============================================================================
const TOOLS = [
  {
    name: 'cari_fasilitas',
    description: 'Cari titik fasilitas air (nama, Node ID, kecamatan, alamat, pengelola) dengan filter opsional. Gunakan untuk menemukan Node ID sebelum menghitung cakupan.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Kata kunci, mis. "Lembang", "Tirta Raharja", "JAWA-120"' },
        provinsi: { type: 'string', description: 'Banten, DKI Jakarta, Jawa Barat, Jawa Tengah, DI Yogyakarta, atau Jawa Timur' },
        kabkota: { type: 'string', description: 'Nama kab/kota, mis. "Kabupaten Bandung" atau "Kota Bogor"' },
        kategori: { type: 'string', enum: KATEGORI },
        jenis_fasilitas: { type: 'string', description: 'mis. Pamsimas, Instalasi PDAM, Reservoar, Kantor Cabang, Kolam Retensi, Rumah Pompa' },
      },
    },
  },
  {
    name: 'hitung_cakupan',
    description: 'Hitung cakupan layanan satu titik: debit, kapasitas sambungan rumah (SR/pelanggan), jiwa terlayani, radius, dan kecamatan yang tercakup beserta persentasenya.',
    parametersJsonSchema: {
      type: 'object',
      properties: { node_id: { type: 'string', description: 'Node ID titik, mis. JAWA-120' } },
      required: ['node_id'],
    },
  },
  {
    name: 'ringkasan_wilayah',
    description: 'Ringkasan cakupan layanan satu provinsi atau kab/kota (atau seluruh Jawa bila keduanya kosong): total kapasitas SR, persen penduduk terlayani, dan kecamatan yang belum tercakup sumber mana pun.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        provinsi: { type: 'string' },
        kabkota: { type: 'string', description: 'mis. "Kabupaten Ciamis"' },
      },
    },
  },
  {
    name: 'sumber_yang_melayani_kecamatan',
    description: 'Daftar sumber air yang area layanannya mencakup suatu kecamatan, beserta perkiraan jiwa yang dilayani di kecamatan itu.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        kecamatan: { type: 'string', description: 'Nama kecamatan tanpa awalan "Kec.", mis. "Lembang"' },
        kabkota: { type: 'string', description: 'Opsional, untuk membedakan kecamatan bernama sama' },
      },
      required: ['kecamatan'],
    },
  },
  // ─── Aksi peta: dijalankan di layar pengguna setelah jawaban dikirim ───────
  {
    name: 'tampilkan_wilayah_di_peta',
    description: 'AKSI PETA. Buka dan potong (crop/mask) peta ke satu provinsi atau kab/kota: area di luarnya ditutup, kamera zoom ke wilayah itu, dan kartu ringkasan cakupan wilayah muncul. Kosongkan provinsi & kabkota untuk kembali ke seluruh Pulau Jawa. Pakai saat pengguna minta membuka/menampilkan/zoom/memotong/fokus ke suatu wilayah.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        provinsi: { type: 'string', description: 'Nama provinsi. Boleh kosong bila kabkota diisi.' },
        kabkota: { type: 'string', description: 'Nama kab/kota, mis. "Kota Bandung" atau "Kabupaten Garut"' },
        sorot_belum_terlayani: { type: 'boolean', description: 'true untuk sekaligus menyorot (merah) kecamatan yang belum tercakup sumber mana pun' },
      },
    },
  },
  {
    name: 'buka_titik_di_peta',
    description: 'AKSI PETA. Buka panel detail satu titik dan zoom ke lokasinya. tampilkan_area=true juga menggambar area layanan titik itu dan memotong peta hanya ke area tersebut.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'Node ID titik, mis. JAWA-120' },
        tampilkan_area: { type: 'boolean', description: 'true untuk menampilkan area cakupan layanan titik' },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'filter_kategori_peta',
    description: 'AKSI PETA. Tampilkan hanya titik satu kategori pengelola di peta, atau "Semua" untuk menampilkan semua kategori.',
    parametersJsonSchema: {
      type: 'object',
      properties: { kategori: { type: 'string', enum: [...KATEGORI, 'Semua'] } },
      required: ['kategori'],
    },
  },
  {
    name: 'sumber_terdekat',
    description: 'Sumber air terdekat dari sebuah koordinat, dan apakah koordinat itu berada di dalam area layanannya.',
    parametersJsonSchema: {
      type: 'object',
      properties: { lat: { type: 'number' }, lng: { type: 'number' } },
      required: ['lat', 'lng'],
    },
  },
];

// ============================================================================
// Pelaksana fungsi
// ============================================================================
const normal = normalisasiTeks;

// "Jabar" / "jawa barat" → "Jawa Barat"; "Kab. Bandung" / "bandung" → "Kabupaten Bandung"
function cocokkanWilayah(facilities, { provinsi, kabkota }) {
  const singkatan = { jabar: 'Jawa Barat', jateng: 'Jawa Tengah', jatim: 'Jawa Timur', diy: 'DI Yogyakarta', yogyakarta: 'DI Yogyakarta', jakarta: 'DKI Jakarta', dki: 'DKI Jakarta' };
  const daftarProv = [...new Set(facilities.map((f) => f.provinsi))];
  const daftarWil = [...new Set(facilities.map((f) => f.wilayahNama))];
  let prov = null;
  if (provinsi) {
    const p = normal(provinsi);
    prov = singkatan[p] || daftarProv.find((x) => normal(x) === p) || daftarProv.find((x) => normal(x).includes(p)) || null;
    if (!prov) return { error: `Provinsi "${provinsi}" tidak dikenal. Pilihan: ${daftarProv.join(', ')}` };
  }
  let wil = null;
  if (kabkota) {
    const k = normal(String(kabkota).replace(/\bKab\.\s*/i, 'Kabupaten '));
    const tanpaAwalan = k.replace(/^(kabupaten|kota)\s+/, '');
    const persis = daftarWil.filter((x) => normal(x) === k);
    const kandidat = persis.length ? persis : daftarWil.filter((x) => normal(x).replace(/^(kabupaten|kota)\s+/, '') === tanpaAwalan);
    if (kandidat.length === 1) wil = kandidat[0];
    else if (kandidat.length > 1) return { error: `"${kabkota}" ambigu: ${kandidat.join(' atau ')}. Sebutkan salah satunya.` };
    else return { error: `Kab/kota "${kabkota}" tidak ditemukan di data.` };
  }
  return { provinsi: prov, wilayah: wil };
}

/**
 * @param ctx.aksi       daftar aksi peta yang dikumpulkan selama satu pertanyaan (diisi oleh fungsi AKSI PETA)
 * @param ctx.wilayahList daftar {provinsi, wilayahNama} dari tabel Wilayah, agar kab/kota tanpa titik pun bisa dibuka
 */
async function jalankanTool(nama, args, facilities, ctx = {}) {
  const aksi = ctx.aksi || [];
  switch (nama) {
    case 'tampilkan_wilayah_di_peta': {
      if (!args.provinsi && !args.kabkota) {
        aksi.push({ tipe: 'wilayah', provinsi: 'all', wilayah: 'all' });
        return { ok: true, dijalankan: 'Peta kembali menampilkan seluruh Pulau Jawa.' };
      }
      const daftar = ctx.wilayahList || facilities;
      const wilayah = cocokkanWilayah(daftar, { provinsi: args.provinsi, kabkota: args.kabkota });
      if (wilayah.error) return wilayah;
      // Filter kab/kota di peta butuh provinsinya juga
      const provinsiKab = wilayah.wilayah ? daftar.find((w) => w.wilayahNama === wilayah.wilayah)?.provinsi : null;
      if (wilayah.provinsi && provinsiKab && provinsiKab !== wilayah.provinsi) {
        return { error: `${wilayah.wilayah} tidak berada di provinsi ${wilayah.provinsi}, melainkan ${provinsiKab}.` };
      }
      const provinsi = provinsiKab || wilayah.provinsi;
      aksi.push({ tipe: 'wilayah', provinsi, wilayah: wilayah.wilayah || 'all', sorotCelah: Boolean(args.sorot_belum_terlayani) });
      const label = wilayah.wilayah || provinsi;
      const diWilayah = facilities.filter((f) => (wilayah.wilayah ? f.wilayahNama === wilayah.wilayah : f.provinsi === provinsi));
      const perKategori = Object.fromEntries(KATEGORI.map((k) => [k, diWilayah.filter((f) => f.kategori === k).length]));
      return {
        ok: true,
        dijalankan: `Peta dipotong ke ${label}${args.sorot_belum_terlayani ? ', kecamatan yang belum terlayani disorot' : ''}.`,
        jumlahTitikSemuaKategori: diWilayah.length,
        jumlahTitikPerKategori: perKategori,
      };
    }
    case 'buka_titik_di_peta': {
      const item = await ambilFasilitas(args.node_id);
      if (!item) return { error: `Titik ${args.node_id} tidak ditemukan.` };
      aksi.push({ tipe: 'titik', nodeId: item.nodeId, area: Boolean(args.tampilkan_area) });
      return {
        ok: true,
        dijalankan: `Titik ${item.nodeId} (${item.nama || item.jenisFasilitas}, ${item.wilayahNama}) dibuka di peta${args.tampilkan_area ? ' beserta area layanannya' : ''}.`,
      };
    }
    case 'filter_kategori_peta': {
      const kategori = args.kategori === 'Semua' ? 'all' : KATEGORI.find((k) => normal(k) === normal(args.kategori));
      if (!kategori) return { error: `Kategori "${args.kategori}" tidak dikenal. Pilihan: ${KATEGORI.join(', ')}, Semua` };
      aksi.push({ tipe: 'kategori', kategori });
      return { ok: true, dijalankan: kategori === 'all' ? 'Semua kategori ditampilkan.' : `Peta hanya menampilkan kategori ${kategori}.` };
    }
    case 'cari_fasilitas':
      return cakupan.cariFasilitas(facilities, {
        query: args.query, provinsi: args.provinsi, kabkota: args.kabkota, kategori: args.kategori, jenisFasilitas: args.jenis_fasilitas,
      });
    case 'hitung_cakupan': {
      const item = await ambilFasilitas(args.node_id);
      if (!item) return { error: `Titik ${args.node_id} tidak ditemukan.` };
      const hasil = cakupan.ringkasAnalisis(cakupan.analisisCakupan(item));
      if (hasil.wilayahTercakup?.length > 15) {
        hasil.jumlahKecamatanTercakup = hasil.wilayahTercakup.length;
        hasil.wilayahTercakup = hasil.wilayahTercakup.slice(0, 15);
      }
      return hasil;
    }
    case 'ringkasan_wilayah': {
      const wilayah = cocokkanWilayah(facilities, { provinsi: args.provinsi, kabkota: args.kabkota });
      if (wilayah.error) return wilayah;
      const hasil = cakupan.ringkasanWilayah(facilities, wilayah);
      return {
        ...hasil,
        jumlahKecamatanTanpaLayanan: hasil.kecamatanTanpaLayanan.length,
        kecamatanTanpaLayanan: hasil.kecamatanTanpaLayanan.slice(0, 20),
      };
    }
    case 'sumber_yang_melayani_kecamatan': {
      const hasil = cakupan.sumberMelayaniKecamatan(facilities, args.kecamatan, args.kabkota);
      return hasil.length ? { data: hasil.slice(0, 5) } : { error: `Kecamatan "${args.kecamatan}" tidak ditemukan di batas wilayah Jawa.` };
    }
    case 'sumber_terdekat': {
      const lat = Number(args.lat);
      const lng = Number(args.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: 'Koordinat tidak valid' };
      return { data: cakupan.sumberTerdekat(facilities, lat, lng, 5) };
    }
    default:
      return { error: `Fungsi ${nama} tidak dikenal` };
  }
}

// ============================================================================
// Percakapan
// ============================================================================
function instruksiSistem(konteks) {
  const baris = [
    'Kamu adalah asisten analisis caiKU, peta sumber air bersih se-Pulau Jawa (Perumda/PDAM, Pemda, Pamsimas, Kolam Retensi).',
    'Jawab dalam bahasa Indonesia yang ringkas dan jelas untuk mahasiswa, dosen, dan petugas.',
    'Aturan:',
    '- Semua angka (debit, SR/pelanggan, jiwa, radius, kecamatan tercakup, persentase) HARUS berasal dari hasil fungsi. Jangan mengarang angka atau nama wilayah.',
    '- Sebutkan apakah angka berasal dari data atau estimasi model (field "asal" / "sumberSR"). Bila estimasi, jelaskan singkat asumsinya (debit tipikal per jenis, 5 jiwa per SR, kebutuhan liter/orang/hari, kehilangan air).',
    '- Tulis Node ID (format JAWA-123) setiap kali membahas sebuah titik.',
    '- Rumah pompa dan IPAL bukan sumber air bersih. Kolam retensi dihitung sebagai potensi air baku/resapan, bukan layanan aktif.',
    '- Bila data tidak ada atau fungsi mengembalikan error, katakan terus terang dan sarankan petugas mengisi debit atau jumlah SR lewat formulir.',
    '- Tolak dengan sopan pertanyaan di luar topik air bersih dan peta ini.',
    '- Format: paragraf pendek dan daftar berpoin dengan "- ". Boleh **tebal** untuk angka penting. Jangan memakai tabel.',
    'Aksi peta (kamu bisa mengendalikan peta pengguna):',
    '- Bila pengguna meminta membuka, menampilkan, zoom, memotong, atau fokus ke suatu provinsi/kab/kota, PANGGIL tampilkan_wilayah_di_peta. Jangan hanya menjelaskan caranya.',
    '- Bila pengguna meminta membuka/menunjukkan sebuah titik, panggil buka_titik_di_peta (tampilkan_area=true bila ia menyinggung area/cakupan/jangkauan). Cari Node ID dulu dengan cari_fasilitas bila belum tahu.',
    '- Bila jawabanmu membahas satu wilayah atau satu titik tertentu, sertakan juga aksi peta yang sesuai agar peta mengikuti pembahasan.',
    '- Bila pengguna minta "tampilkan hanya Pamsimas" dan sejenisnya, panggil filter_kategori_peta.',
    '- Bila pertanyaan menyebut satu kategori di suatu wilayah (mis. "Pamsimas di Ciamis"), panggil tampilkan_wilayah_di_peta DAN filter_kategori_peta. Bila hanya ada satu titik yang cocok, buka juga titik itu (dengan area bila diminta); bila lebih dari satu, sebutkan Node ID-nya agar pengguna memilih.',
    '- Aksi baru benar-benar terjadi setelah jawabanmu terkirim. Konfirmasi singkat apa yang ditampilkan di peta (berdasarkan field "dijalankan"), lalu beri 1-3 poin informasi penting dari data. Bila fungsi aksi mengembalikan error (mis. nama ambigu), tanyakan pengguna maksudnya.',
  ];
  if (konteks?.nodeId) baris.push(`Konteks layar: pengguna sedang membuka titik ${konteks.nodeId}. "Titik ini" berarti ${konteks.nodeId}.`);
  if (konteks?.wilayah && konteks.wilayah !== 'all') baris.push(`Konteks layar: filter peta kab/kota ${konteks.wilayah}.`);
  else if (konteks?.provinsi && konteks.provinsi !== 'all') baris.push(`Konteks layar: filter peta provinsi ${konteks.provinsi}.`);
  return baris.join('\n');
}

function pesanError(err) {
  const status = err?.status || err?.code;
  const teks = String(err?.message || '');
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return { status: 504, message: `Model Gemini terlalu lama menjawab (lebih dari ${Math.round(BATAS_WAKTU_MS / 1000)} detik). Server Google mungkin sedang sibuk; coba lagi sebentar lagi.` };
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(teks)) {
    return { status: 429, message: 'Kuota Gemini sedang habis atau terlalu banyak permintaan. Coba lagi beberapa saat lagi.' };
  }
  if ([500, 502, 503, 504].includes(status)) {
    return { status: 503, message: 'Model Gemini sedang sibuk di server Google (high demand). Coba lagi sebentar lagi.' };
  }
  if (status === 400 && /API key/i.test(teks)) return { status: 503, message: 'GEMINI_API_KEY tidak valid. Periksa isi .env di server.' };
  if (status === 403) return { status: 503, message: 'GEMINI_API_KEY tidak punya akses ke model ini.' };
  if (errorModelTidakValid(err)) return { status: 503, message: 'Model Gemini tidak tersedia untuk kunci ini. Kosongkan GEMINI_MODEL di .env agar model dipilih otomatis.' };
  return { status: 502, message: 'Asisten AI gagal menjawab. Coba lagi.' };
}

const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Satu panggilan Gemini dengan cadangan otomatis.
 * - Sebelum ada jawaban model: bila model sibuk/macet/tidak tersedia, pindah ke model berikutnya
 *   (GEMINI_MODEL → Flash terbaru → Flash-Lite).
 * - Setelah model menjawab (sedang function calling), model tidak diganti karena riwayat memuat
 *   thought signature milik model itu; gangguan sementara dicoba ulang sekali.
 */
async function generate(ai, state, contents, baseConfig, deadline) {
  const kandidat = state.terkunci ? [state.model] : await urutanModel();
  let lastErr = null;
  for (const model of kandidat) {
    for (let ulang = 0; ulang < (state.terkunci ? 2 : 1); ulang++) {
      const abortSignal = AbortSignal.any([deadline, AbortSignal.timeout(BATAS_PANGGILAN_MS)]);
      try {
        const response = await ai.models.generateContent({ model, contents, config: { ...baseConfig, abortSignal } });
        if (state.model !== model && !state.terkunci) {
          console.warn(`ℹ️  Asisten AI memakai ${model}${state.model ? ` (cadangan dari ${state.model})` : ''}`);
        }
        state.model = model;
        state.terkunci = true;
        modelSibuk.delete(model);
        modelTerakhirBerhasil = model;
        return response;
      } catch (err) {
        lastErr = err;
        if (deadline.aborted) throw err;
        const { modelDiminta } = konfigurasi();
        if (errorModelTidakValid(err) && !state.terkunci) {
          modelBermasalah.add(model); // tidak dicoba lagi sampai server restart
          if (model === modelDiminta) {
            peringatanModel = `GEMINI_MODEL "${modelDiminta}" tidak tersedia untuk kunci ini; model dipilih otomatis.`;
            console.warn(`⚠️  ${peringatanModel} Perbaiki atau kosongkan GEMINI_MODEL di .env.`);
          }
          break; // lanjut ke model berikutnya
        }
        if (!errorSementara(err)) throw err;
        const macet = err?.name === 'AbortError' || err?.name === 'TimeoutError';
        modelSibuk.set(model, Date.now() + (macet ? JEDA_MODEL_MACET_MS : JEDA_MODEL_SIBUK_MS));
        if (macet && model === modelDiminta) {
          peringatanModel = `GEMINI_MODEL "${modelDiminta}" tidak menjawab dalam ${BATAS_PANGGILAN_MS / 1000} detik; dipakai model Flash lain.`;
        }
        console.warn(`⚠️  ${model} ${macet ? 'macet' : 'sibuk'} (${err?.status || err?.name}); ${state.terkunci ? 'mencoba ulang' : 'mencoba model lain'}`);
        if (state.terkunci) await tunggu(1500);
      }
    }
  }
  throw lastErr || new Error('Tidak ada model Gemini yang bisa dipakai');
}

/**
 * @param {{ pesan: string, riwayat: {peran: 'user'|'ai', teks: string}[], konteks: object }} input
 * @returns {Promise<{ jawaban: string, nodeIds: string[], toolDipakai: string[] }>}
 */
async function tanya({ pesan, riwayat = [], konteks = {} }) {
  const ai = getClient();
  const state = { model: null, terkunci: false };
  const deadline = AbortSignal.timeout(BATAS_WAKTU_MS); // satu batas untuk seluruh putaran
  const [facilities, wilayahDb] = await Promise.all([
    ambilSemuaFasilitas(),
    prisma.wilayah.findMany({ select: { nama: true, provinsi: true } }),
  ]);
  const ctx = { aksi: [], wilayahList: wilayahDb.map((w) => ({ wilayahNama: w.nama, provinsi: w.provinsi })) };

  const contents = [
    ...riwayat.map((r) => ({ role: r.peran === 'ai' ? 'model' : 'user', parts: [{ text: r.teks }] })),
    { role: 'user', parts: [{ text: pesan }] },
  ];
  const config = {
    systemInstruction: instruksiSistem(konteks),
    tools: [{ functionDeclarations: TOOLS }],
    temperature: 0.3,
  };

  const toolDipakai = [];
  for (let putaran = 0; putaran < MAKS_PUTARAN_TOOL; putaran++) {
    const response = await generate(ai, state, contents, config, deadline);
    const calls = response.functionCalls || [];
    if (calls.length === 0) {
      const jawaban = (response.text || '').trim() || 'Maaf, saya tidak menemukan jawaban dari data yang ada.';
      const nodeIds = [...new Set(jawaban.toUpperCase().match(/JAWA-\d{3,}/g) || [])]
        .filter((id) => facilities.some((f) => f.nodeId === id));
      return { jawaban, nodeIds, toolDipakai, model: state.model, aksi: ringkasAksi(ctx.aksi) };
    }

    // Simpan giliran model apa adanya (termasuk thought signature) lalu kirim hasil fungsi
    contents.push(response.candidates?.[0]?.content || { role: 'model', parts: calls.map((c) => ({ functionCall: c })) });
    const parts = [];
    for (const call of calls) {
      toolDipakai.push(call.name);
      let result;
      try {
        result = await jalankanTool(call.name, call.args || {}, facilities, ctx);
      } catch (err) {
        console.error(`Tool ${call.name} gagal:`, err);
        result = { error: 'Fungsi gagal dijalankan' };
      }
      parts.push({ functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: { result } } });
    }
    contents.push({ role: 'user', parts });
  }
  return { jawaban: 'Pertanyaan ini membutuhkan terlalu banyak langkah. Coba persempit pertanyaannya (mis. sebutkan Node ID atau nama kecamatan).', nodeIds: [], toolDipakai, model: state.model, aksi: ringkasAksi(ctx.aksi) };
}

// Satu aksi per jenis (yang terakhir menang), urutan: kategori → wilayah → titik,
// agar titik dibuka setelah wilayah dipotong
function ringkasAksi(daftar) {
  const terakhir = new Map();
  for (const a of daftar) terakhir.set(a.tipe, a);
  return ['kategori', 'wilayah', 'titik'].filter((t) => terakhir.has(t)).map((t) => terakhir.get(t));
}

module.exports = { aiAktif, konfigurasi, infoModel, tanya, pesanError, TOOLS, jalankanTool, cocokkanWilayah, ringkasAksi };

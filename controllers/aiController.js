const asisten = require('../services/aiAsisten');

const MAKS_PESAN = 1000;
const MAKS_RIWAYAT = 10;
const MAKS_TEKS_RIWAYAT = 4000;

// Pembatas laju sederhana per IP (in-memory) agar kuota Gemini tidak habis oleh satu pengguna
const BATAS_PER_MENIT = Number(process.env.AI_RATE_LIMIT_PER_MINUTE) || 15;
const jejak = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const daftar = (jejak.get(ip) || []).filter((t) => now - t < 60_000);
  if (daftar.length >= BATAS_PER_MENIT) {
    return res.status(429).json({ success: false, message: 'Terlalu banyak pertanyaan. Tunggu sebentar sebelum bertanya lagi.' });
  }
  daftar.push(now);
  jejak.set(ip, daftar);
  if (jejak.size > 5000) {
    for (const [key, times] of jejak) if (!times.some((t) => now - t < 60_000)) jejak.delete(key);
  }
  next();
}

// GET /api/ai/status
const getStatus = async (req, res) => {
  const { model, peringatan } = await asisten.infoModel();
  res.json({ success: true, data: { aktif: asisten.aiAktif(), model, peringatan } });
};

function parseInput(body = {}) {
  const pesan = String(body.pesan ?? '').trim();
  if (!pesan) return { error: 'Pertanyaan tidak boleh kosong' };
  if (pesan.length > MAKS_PESAN) return { error: `Pertanyaan maksimal ${MAKS_PESAN} karakter` };

  const riwayat = Array.isArray(body.riwayat) ? body.riwayat : [];
  const riwayatBersih = riwayat
    .slice(-MAKS_RIWAYAT)
    .filter((r) => r && (r.peran === 'user' || r.peran === 'ai') && typeof r.teks === 'string' && r.teks.trim())
    .map((r) => ({ peran: r.peran, teks: r.teks.slice(0, MAKS_TEKS_RIWAYAT) }));

  const k = body.konteks && typeof body.konteks === 'object' ? body.konteks : {};
  const teksPendek = (v) => (typeof v === 'string' ? v.slice(0, 80) : undefined);
  const konteks = { nodeId: teksPendek(k.nodeId), provinsi: teksPendek(k.provinsi), wilayah: teksPendek(k.wilayah) };
  return { data: { pesan, riwayat: riwayatBersih, konteks } };
}

// POST /api/ai/chat  { pesan, riwayat?, konteks? }
const chat = async (req, res) => {
  if (!asisten.aiAktif()) {
    return res.status(503).json({
      success: false,
      message: 'Asisten AI belum dikonfigurasi. Isi GEMINI_API_KEY di file .env server (gratis dari Google AI Studio). Analisis cakupan tetap bisa dipakai tanpa AI.',
    });
  }
  const { data, error } = parseInput(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  try {
    const hasil = await asisten.tanya(data);
    res.json({ success: true, data: hasil });
  } catch (err) {
    const { status, message } = asisten.pesanError(err);
    console.error('Asisten AI gagal:', err?.message || err);
    res.status(status).json({ success: false, message });
  }
};

module.exports = { getStatus, chat, rateLimit };

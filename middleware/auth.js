const crypto = require('crypto');

// Token berlaku satu shift kerja petugas
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

const DEFAULT_USERNAME = 'petugas';
const DEFAULT_PASSWORD = 'caiku123';

// Tanpa AUTH_SECRET, secret dibuat acak saat server menyala: token lama tidak berlaku lagi
// setelah server restart, tetapi token juga tidak bisa dipalsukan dari kredensial default
// yang tertulis di kode. Isi AUTH_SECRET di .env agar sesi bertahan setelah restart.
const RANDOM_SECRET = crypto.randomBytes(32).toString('hex');

function getAuthConfig() {
  const username = process.env.ADMIN_USERNAME || DEFAULT_USERNAME;
  const password = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;

  return {
    username,
    password,
    name: process.env.ADMIN_NAME || 'Operator Unit Teknis',
    secret: process.env.AUTH_SECRET || RANDOM_SECRET,
    usingDefaults: !process.env.ADMIN_PASSWORD,
    usingRandomSecret: !process.env.AUTH_SECRET,
  };
}

// Mode produksi wajib memakai kredensial & secret sendiri
function assertProductionAuthConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  const missing = ['ADMIN_PASSWORD', 'AUTH_SECRET'].filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`NODE_ENV=production tetapi ${missing.join(' dan ')} belum diisi di .env`);
  }
}

// Perbandingan waktu-konstan (hash dulu agar panjang buffer selalu sama)
function safeEqual(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function signToken(payload) {
  const { secret } = getAuthConfig();
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;

  const [body, signature] = token.split('.');
  const { secret } = getAuthConfig();
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Middleware: hanya petugas GIS terautentikasi yang boleh mengubah data
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({
      success: false,
      message: 'Sesi petugas tidak valid atau sudah berakhir. Silakan login kembali.'
    });
  }

  req.user = payload;
  next();
}

// ============================================================================
// Pembatas percobaan login (per alamat IP, disimpan di memori)
// ============================================================================
const LOGIN_MAX_FAILURES = 5;
const LOGIN_BLOCK_WINDOW_MS = 15 * 60 * 1000;
const loginFailures = new Map(); // ip -> { count, firstAt }

function pruneLoginFailures(now) {
  for (const [ip, entry] of loginFailures) {
    if (now - entry.firstAt > LOGIN_BLOCK_WINDOW_MS) loginFailures.delete(ip);
  }
}

// Sisa waktu blokir (ms) untuk IP ini; 0 bila masih boleh mencoba
function loginBlockedFor(ip, now = Date.now()) {
  pruneLoginFailures(now);
  const entry = loginFailures.get(ip);
  if (!entry || entry.count < LOGIN_MAX_FAILURES) return 0;
  return entry.firstAt + LOGIN_BLOCK_WINDOW_MS - now;
}

function recordLoginFailure(ip, now = Date.now()) {
  const entry = loginFailures.get(ip);
  if (!entry || now - entry.firstAt > LOGIN_BLOCK_WINDOW_MS) {
    loginFailures.set(ip, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
}

function resetLoginFailures(ip) {
  if (ip === undefined) loginFailures.clear();
  else loginFailures.delete(ip);
}

module.exports = {
  TOKEN_TTL_MS,
  LOGIN_MAX_FAILURES,
  getAuthConfig,
  assertProductionAuthConfig,
  safeEqual,
  signToken,
  verifyToken,
  requireAuth,
  loginBlockedFor,
  recordLoginFailure,
  resetLoginFailures,
};

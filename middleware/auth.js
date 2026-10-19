const crypto = require('crypto');

// Token berlaku satu shift kerja petugas
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

const DEFAULT_USERNAME = 'petugas';
const DEFAULT_PASSWORD = 'caiku123';

function getAuthConfig() {
  const username = process.env.ADMIN_USERNAME || DEFAULT_USERNAME;
  const password = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;

  return {
    username,
    password,
    name: process.env.ADMIN_NAME || 'Operator Unit Teknis',
    // Tanpa AUTH_SECRET, secret diturunkan dari kredensial agar token tetap valid setelah server restart
    secret: process.env.AUTH_SECRET || crypto.createHash('sha256').update(`caiku-auth:${username}:${password}`).digest('hex'),
    usingDefaults: !process.env.ADMIN_PASSWORD,
  };
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

module.exports = {
  TOKEN_TTL_MS,
  getAuthConfig,
  safeEqual,
  signToken,
  verifyToken,
  requireAuth,
};

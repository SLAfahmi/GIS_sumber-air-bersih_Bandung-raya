const {
  TOKEN_TTL_MS,
  getAuthConfig,
  safeEqual,
  signToken,
  loginBlockedFor,
  recordLoginFailure,
  resetLoginFailures,
} = require('../middleware/auth');

// POST /api/auth/login
const login = (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const blockedMs = loginBlockedFor(ip);
  if (blockedMs > 0) {
    const minutes = Math.ceil(blockedMs / 60000);
    res.set('Retry-After', String(Math.ceil(blockedMs / 1000)));
    return res.status(429).json({
      success: false,
      message: `Terlalu banyak percobaan login gagal. Coba lagi dalam ${minutes} menit.`
    });
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi' });
  }

  const config = getAuthConfig();
  // Bitwise & agar kedua perbandingan selalu dijalankan (tidak short-circuit)
  const valid = safeEqual(String(username).trim(), config.username) & safeEqual(String(password), config.password);

  if (!valid) {
    recordLoginFailure(ip);
    return res.status(401).json({ success: false, message: 'Username atau password salah' });
  }

  resetLoginFailures(ip);
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const user = { username: config.username, name: config.name, role: 'PETUGAS_GIS' };
  const token = signToken({ ...user, exp: expiresAt });

  res.json({ success: true, data: { token, user, expiresAt } });
};

// GET /api/auth/me
const me = (req, res) => {
  const { exp, ...user } = req.user;
  res.json({ success: true, data: { user, expiresAt: exp } });
};

module.exports = {
  login,
  me,
};

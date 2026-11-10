require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/api');
const prisma = require('./config/database');
const { getAuthConfig, assertProductionAuthConfig } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Browser yang meminta /favicon.ico diarahkan ke logo caiKU (bukan fallback SPA)
app.get('/favicon.ico', (req, res) => res.redirect('/favicon.svg'));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Mount API routes
app.use('/api', apiRoutes);

// Endpoint API yang tidak dikenal dijawab JSON, bukan halaman SPA
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan` });
});

// Fallback route for SPA navigation
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler (mis. body JSON tidak valid)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('Unhandled error:', err);
  res.status(status).json({
    success: false,
    message: err.type === 'entity.parse.failed' ? 'Format body JSON tidak valid' : 'Terjadi kesalahan pada server'
  });
});

function start(port = PORT) {
  assertProductionAuthConfig();

  const server = app.listen(port, () => {
    const auth = getAuthConfig();
    console.log(`=======================================================`);
    console.log(`💧 Web Pemetaan Sumber Air Bersih se-Pulau Jawa`);
    console.log(`🚀 Server aktif di: http://localhost:${port}`);
    console.log(`📡 API endpoint:   http://localhost:${port}/api/fasilitas`);
    console.log(`📊 API statistik:  http://localhost:${port}/api/stats`);
    if (auth.usingDefaults) {
      console.log(`⚠️  Login petugas memakai kredensial default: ${auth.username} / ${auth.password}`);
      console.log(`   Atur ADMIN_USERNAME & ADMIN_PASSWORD di .env sebelum aplikasi dipakai orang lain.`);
    }
    if (auth.usingRandomSecret) {
      console.log(`⚠️  AUTH_SECRET belum diisi: sesi petugas akan berakhir setiap server restart.`);
    }
    console.log(`=======================================================`);
  });

  // Graceful shutdown
  async function shutdown() {
    console.log('\nMematikan server...');
    await prisma.$disconnect();
    server.close(() => {
      console.log('Server ditutup dengan aman.');
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

// `node server.js` menyalakan server; require('./server') (mis. dari tes) hanya mengambil app
if (require.main === module) {
  try {
    start();
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

module.exports = { app, start };

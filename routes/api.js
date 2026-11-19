const express = require('express');
const router = express.Router();
const fasilitasController = require('../controllers/fasilitasController');
const routeController = require('../controllers/routeController');
const authController = require('../controllers/authController');
const cakupanController = require('../controllers/cakupanController');
const aiController = require('../controllers/aiController');
const { rateLimit } = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');

// Endpoint publik yang berat (hitung geometri turf / panggil OSRM) dibatasi per IP
const batasEndpointBerat = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.PUBLIC_RATE_LIMIT_PER_MINUTE) || 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.' },
});

// Autentikasi Petugas GIS
router.post('/auth/login', authController.login);
router.get('/auth/me', requireAuth, authController.me);

// Statistics Endpoint
router.get('/stats', fasilitasController.getStats);

// Master Data: Wilayah
router.get('/wilayah', fasilitasController.getWilayah);

// Master Data: Pengelola
router.get('/pengelola', fasilitasController.getPengelola);
router.post('/pengelola', requireAuth, fasilitasController.createPengelola);

// Navigation & Routing (OSRM In-App Turn-by-Turn)
router.get('/route', batasEndpointBerat, routeController.getRouteNavigation);

// Facilities Endpoints (baca: publik, ubah & riwayat: petugas)
router.get('/fasilitas', fasilitasController.getAllFasilitas);
router.get('/fasilitas/:id', fasilitasController.getFasilitasById);
router.get('/fasilitas/:id/log', requireAuth, fasilitasController.getFasilitasLog);
router.post('/fasilitas', requireAuth, fasilitasController.createFasilitas);
router.put('/fasilitas/:id', requireAuth, fasilitasController.updateFasilitas);
router.delete('/fasilitas/:id', requireAuth, fasilitasController.deleteFasilitas);

// Arsip titik yang dihapus (petugas)
router.get('/arsip', requireAuth, fasilitasController.getArsip);
router.post('/arsip/:id/pulihkan', requireAuth, fasilitasController.pulihkanArsip);

// Analisis cakupan layanan (publik). /wilayah didaftarkan sebelum /:id
router.get('/cakupan/wilayah', batasEndpointBerat, cakupanController.getCakupanWilayah);
router.get('/cakupan/:id', batasEndpointBerat, cakupanController.getCakupanTitik);

// Asisten AI (Google Gemini), dibatasi per IP
router.get('/ai/status', aiController.getStatus);
router.post('/ai/chat', aiController.rateLimit, aiController.chat);

module.exports = router;

const express = require('express');
const router = express.Router();
const fasilitasController = require('../controllers/fasilitasController');
const routeController = require('../controllers/routeController');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

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
router.get('/route', routeController.getRouteNavigation);

// Facilities Endpoints (baca: publik, ubah: petugas)
router.get('/fasilitas', fasilitasController.getAllFasilitas);
router.get('/fasilitas/:id', fasilitasController.getFasilitasById);
router.post('/fasilitas', requireAuth, fasilitasController.createFasilitas);
router.put('/fasilitas/:id', requireAuth, fasilitasController.updateFasilitas);
router.delete('/fasilitas/:id', requireAuth, fasilitasController.deleteFasilitas);

module.exports = router;

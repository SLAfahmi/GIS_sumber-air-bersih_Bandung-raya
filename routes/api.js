const express = require('express');
const router = express.Router();
const fasilitasController = require('../controllers/fasilitasController');

// Statistics Endpoint
router.get('/stats', fasilitasController.getStats);

// Master Data: Wilayah
router.get('/wilayah', fasilitasController.getWilayah);

// Master Data: Pengelola
router.get('/pengelola', fasilitasController.getPengelola);

// Navigation & Routing (OSRM In-App Turn-by-Turn)
router.get('/route', fasilitasController.getRouteNavigation);

// Facilities Endpoints (CRUD)
router.get('/fasilitas', fasilitasController.getAllFasilitas);
router.get('/fasilitas/:id', fasilitasController.getFasilitasById);
router.post('/fasilitas', fasilitasController.createFasilitas);
router.put('/fasilitas/:id', fasilitasController.updateFasilitas);
router.delete('/fasilitas/:id', fasilitasController.deleteFasilitas);

module.exports = router;

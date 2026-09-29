const prisma = require('../config/database');

// Helper: include relasi wilayah & pengelola
const fasilitasInclude = {
  wilayah: true,
  pengelola: true,
};

// Helper: transform output agar API tetap backward-compatible
function transformFasilitas(item) {
  return {
    ...item,
    // Field backward-compatible untuk frontend lama
    wilayahNama: item.wilayah?.nama || '',
    pengelolaNama: item.pengelola?.nama || '',
  };
}

// GET /api/fasilitas
const getAllFasilitas = async (req, res) => {
  try {
    const { wilayah, jenisFasilitas, kategoriAirMinum, statusOperasional, search } = req.query;

    const where = {};

    if (wilayah && wilayah !== 'all') {
      where.wilayah = { is: { nama: { contains: wilayah } } };
    }

    if (jenisFasilitas && jenisFasilitas !== 'all') {
      where.jenisFasilitas = { contains: jenisFasilitas };
    }

    if (kategoriAirMinum && kategoriAirMinum !== 'all') {
      where.kategoriAirMinum = { equals: kategoriAirMinum };
    }

    if (statusOperasional && statusOperasional !== 'all') {
      where.statusOperasional = { equals: statusOperasional };
    }

    if (search) {
      const term = search.trim();
      where.OR = [
        { nodeId: { contains: term } },
        { jenisFasilitas: { contains: term } },
        { keteranganAirMinum: { contains: term } },
        { wilayah: { is: { nama: { contains: term } } } },
        { pengelola: { is: { nama: { contains: term } } } },
      ];
    }

    const data = await prisma.fasilitasAir.findMany({
      where,
      include: fasilitasInclude,
      orderBy: { id: 'asc' }
    });

    res.json({
      success: true,
      total: data.length,
      data: data.map(transformFasilitas)
    });
  } catch (error) {
    console.error('Error fetching fasilitas:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data fasilitas', error: error.message });
  }
};

// GET /api/fasilitas/:id
const getFasilitasById = async (req, res) => {
  try {
    const { id } = req.params;
    let item;

    if (!isNaN(parseInt(id, 10))) {
      item = await prisma.fasilitasAir.findUnique({
        where: { id: parseInt(id, 10) },
        include: {
          ...fasilitasInclude,
          riwayatUjiLab: { orderBy: { tanggalUji: 'desc' }, take: 5 },
          logPembaruan:  { orderBy: { createdAt: 'desc' }, take: 10 },
        }
      });
    }

    if (!item) {
      item = await prisma.fasilitasAir.findFirst({
        where: { nodeId: id },
        include: {
          ...fasilitasInclude,
          riwayatUjiLab: { orderBy: { tanggalUji: 'desc' }, take: 5 },
          logPembaruan:  { orderBy: { createdAt: 'desc' }, take: 10 },
        }
      });
    }

    if (!item) {
      return res.status(404).json({ success: false, message: 'Fasilitas tidak ditemukan' });
    }

    res.json({ success: true, data: transformFasilitas(item) });
  } catch (error) {
    console.error('Error fetching detail:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil detail fasilitas', error: error.message });
  }
};

// POST /api/fasilitas
const createFasilitas = async (req, res) => {
  try {
    const {
      nodeId, wilayahId, pengelolaId,
      jenisFasilitas, latitude, longitude,
      statusOperasional, kategoriAirMinum,
      keteranganAirMinum, catatanData
    } = req.body;

    if (!nodeId || !wilayahId || !jenisFasilitas || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'nodeId, wilayahId, jenisFasilitas, latitude, dan longitude wajib diisi'
      });
    }

    const parsedLat = parseFloat(latitude);
    const parsedLng = parseFloat(longitude);

    if (isNaN(parsedLat) || isNaN(parsedLng)) {
      return res.status(400).json({ success: false, message: 'Format Latitude dan Longitude harus berupa angka valid' });
    }

    const lastRecord = await prisma.fasilitasAir.findFirst({ orderBy: { id: 'desc' } });
    const nextNo = lastRecord?.no ? lastRecord.no + 1 : 1;

    const newItem = await prisma.fasilitasAir.create({
      data: {
        no: nextNo,
        nodeId: nodeId.trim(),
        wilayahId: parseInt(wilayahId, 10),
        pengelolaId: pengelolaId ? parseInt(pengelolaId, 10) : undefined,
        jenisFasilitas: jenisFasilitas.trim(),
        latitude: parsedLat,
        longitude: parsedLng,
        statusOperasional: (statusOperasional || 'Beroperasi Normal').trim(),
        kategoriAirMinum: (kategoriAirMinum || 'Belum siap minum').trim(),
        keteranganAirMinum: keteranganAirMinum?.trim() || null,
        catatanData: catatanData?.trim() || null,
      },
      include: fasilitasInclude
    });

    res.status(201).json({ success: true, message: 'Titik fasilitas berhasil ditambahkan', data: transformFasilitas(newItem) });
  } catch (error) {
    console.error('Error creating fasilitas:', error);
    res.status(500).json({ success: false, message: 'Gagal menambahkan titik fasilitas', error: error.message });
  }
};

// PUT /api/fasilitas/:id
const updateFasilitas = async (req, res) => {
  try {
    const { id } = req.params;
    const numericId = parseInt(id, 10);

    const existing = await prisma.fasilitasAir.findUnique({ where: { id: numericId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Data titik tidak ditemukan' });

    const { nodeId, wilayahId, pengelolaId, jenisFasilitas, latitude, longitude,
            statusOperasional, kategoriAirMinum, keteranganAirMinum, catatanData } = req.body;

    const updateData = {};
    if (nodeId !== undefined) updateData.nodeId = nodeId.trim();
    if (wilayahId !== undefined) updateData.wilayahId = parseInt(wilayahId, 10);
    if (pengelolaId !== undefined) updateData.pengelolaId = parseInt(pengelolaId, 10);
    if (jenisFasilitas !== undefined) updateData.jenisFasilitas = jenisFasilitas.trim();
    if (statusOperasional !== undefined) updateData.statusOperasional = statusOperasional.trim();
    if (kategoriAirMinum !== undefined) updateData.kategoriAirMinum = kategoriAirMinum.trim();
    if (keteranganAirMinum !== undefined) updateData.keteranganAirMinum = keteranganAirMinum?.trim() || null;
    if (catatanData !== undefined) updateData.catatanData = catatanData?.trim() || null;
    if (latitude !== undefined) { const v = parseFloat(latitude); if (!isNaN(v)) updateData.latitude = v; }
    if (longitude !== undefined) { const v = parseFloat(longitude); if (!isNaN(v)) updateData.longitude = v; }

    // Catat log perubahan
    for (const [field, newVal] of Object.entries(updateData)) {
      const oldVal = String(existing[field] ?? '');
      if (String(newVal) !== oldVal) {
        await prisma.logPembaruan.create({
          data: {
            fasilitasId: numericId,
            fieldDiubah: field,
            nilaiLama: oldVal,
            nilaiBaru: String(newVal),
            diubahOleh: req.headers['x-user'] || 'Admin',
          }
        });
      }
    }

    const updated = await prisma.fasilitasAir.update({
      where: { id: numericId },
      data: updateData,
      include: fasilitasInclude
    });

    res.json({ success: true, message: 'Data titik berhasil diperbarui', data: transformFasilitas(updated) });
  } catch (error) {
    console.error('Error updating fasilitas:', error);
    res.status(500).json({ success: false, message: 'Gagal memperbarui data titik', error: error.message });
  }
};

// DELETE /api/fasilitas/:id
const deleteFasilitas = async (req, res) => {
  try {
    const { id } = req.params;
    const numericId = parseInt(id, 10);

    const existing = await prisma.fasilitasAir.findUnique({ where: { id: numericId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Data titik tidak ditemukan' });

    await prisma.fasilitasAir.delete({ where: { id: numericId } });

    res.json({ success: true, message: `Titik ${existing.nodeId} berhasil dihapus` });
  } catch (error) {
    console.error('Error deleting fasilitas:', error);
    res.status(500).json({ success: false, message: 'Gagal menghapus data titik', error: error.message });
  }
};

// GET /api/stats
const getStats = async (req, res) => {
  try {
    const total = await prisma.fasilitasAir.count();

    const [byKategori, byStatus, byJenis, wilayahStats] = await Promise.all([
      prisma.fasilitasAir.groupBy({ by: ['kategoriAirMinum'], _count: { id: true } }),
      prisma.fasilitasAir.groupBy({ by: ['statusOperasional'], _count: { id: true } }),
      prisma.fasilitasAir.groupBy({ by: ['jenisFasilitas'], _count: { id: true } }),
      // Grouping per wilayah lewat relasi
      prisma.wilayah.findMany({
        include: { _count: { select: { fasilitas: true } } }
      }),
    ]);

    const kategoriMap = Object.fromEntries(byKategori.map(k => [k.kategoriAirMinum, k._count.id]));
    const statusMap   = Object.fromEntries(byStatus.map(s => [s.statusOperasional, s._count.id]));
    const jenisMap    = Object.fromEntries(byJenis.map(j => [j.jenisFasilitas, j._count.id]));
    const wilayahMap  = Object.fromEntries(wilayahStats.map(w => [w.nama, w._count.fasilitas]));

    res.json({
      success: true,
      data: {
        total,
        siapMinum:      kategoriMap['Siap minum'] || 0,
        belumSiapMinum: kategoriMap['Belum siap minum'] || 0,
        perluVerifikasi:kategoriMap['Perlu verifikasi'] || 0,
        normal:         statusMap['Beroperasi Normal'] || 0,
        pemeliharaan:   statusMap['Pemeliharaan'] || 0,
        debitMenurun:   statusMap['Debit Menurun'] || 0,
        rusak:          statusMap['Rusak'] || 0,
        byWilayah: wilayahMap,
        byJenis:   jenisMap
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data statistik', error: error.message });
  }
};

// Helper untuk format instruksi navigasi berbahasa Indonesia
function formatManeuverInstruction(step) {
  const maneuver = step.maneuver || {};
  const type = maneuver.type || '';
  const modifier = maneuver.modifier || '';
  const street = step.name && step.name.trim() !== '' ? step.name : 'jalan setempat';

  if (type === 'depart') {
    return `Mulai perjalanan ke arah ${street}`;
  }
  if (type === 'arrive') {
    return 'Tiba di lokasi fasilitas air bersih';
  }
  if (type === 'roundabout' || type === 'rotary') {
    return `Masuk bundaran dan keluar menuju ${street}`;
  }
  if (type === 'uturn') {
    return `Putar balik di ${street}`;
  }

  const modMap = {
    'left': 'Belok kiri',
    'right': 'Belok kanan',
    'slight left': 'Sedikit serong ke kiri',
    'slight right': 'Sedikit serong ke kanan',
    'sharp left': 'Belok tajam ke kiri',
    'sharp right': 'Belok tajam ke kanan',
    'straight': 'Lurus terus'
  };

  const action = modMap[modifier] || (type === 'turn' ? 'Belok' : 'Lanjutkan');
  return `${action} ke ${street}`;
}

// GET /api/route  - Menghitung navigasi rute turn-by-turn tanpa redirect Google Maps
const getRouteNavigation = async (req, res) => {
  try {
    const { startLat, startLng, endLat, endLng, mode = 'driving' } = req.query;

    const sLat = parseFloat(startLat);
    const sLng = parseFloat(startLng);
    const eLat = parseFloat(endLat);
    const eLng = parseFloat(endLng);

    if (isNaN(sLat) || isNaN(sLng) || isNaN(eLat) || isNaN(eLng)) {
      return res.status(400).json({
        success: false,
        message: 'Parameter koordinat startLat, startLng, endLat, endLng harus angka valid'
      });
    }

    // Call Public OSRM routing service
    const osrmUrl = `https://router.project-osrm.org/route/v1/${mode}/${sLng},${sLat};${eLng},${eLat}?overview=full&geometries=geojson&steps=true`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

    let osrmData = null;
    try {
      const response = await fetch(osrmUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        osrmData = await response.json();
      }
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      console.warn('OSRM public fetch failed or timed out, generating geodesic fallback route:', fetchErr.message);
    }

    if (osrmData && osrmData.code === 'Ok' && osrmData.routes && osrmData.routes.length > 0) {
      const primaryRoute = osrmData.routes[0];
      const distanceMeters = primaryRoute.distance;
      const durationSeconds = primaryRoute.duration;

      // Ubah GeoJSON [lng, lat] menjadi format Leaflet [lat, lng]
      const coordinates = primaryRoute.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

      // Parse langkah navigasi turn-by-turn
      const steps = [];
      if (primaryRoute.legs && primaryRoute.legs[0] && primaryRoute.legs[0].steps) {
        primaryRoute.legs[0].steps.forEach((st, idx) => {
          const stepDist = st.distance;
          const distText = stepDist >= 1000 
            ? `${(stepDist / 1000).toFixed(1)} km` 
            : `${Math.round(stepDist)} m`;

          steps.push({
            stepNumber: idx + 1,
            instruction: formatManeuverInstruction(st),
            streetName: st.name || 'Jalan Sekitar',
            distance: stepDist,
            distanceText: distText,
            duration: Math.round(st.duration),
            modifier: st.maneuver?.modifier || '',
            type: st.maneuver?.type || '',
            location: st.maneuver?.location ? [st.maneuver.location[1], st.maneuver.location[0]] : null
          });
        });
      }

      const distanceKm = (distanceMeters / 1000).toFixed(1);
      const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));

      return res.json({
        success: true,
        source: 'OSRM-Routing-Engine',
        data: {
          distance: distanceMeters,
          distanceFormatted: distanceMeters >= 1000 ? `${distanceKm} km` : `${Math.round(distanceMeters)} m`,
          duration: durationSeconds,
          durationFormatted: durationMinutes >= 60 
            ? `${Math.floor(durationMinutes / 60)} jam ${durationMinutes % 60} menit`
            : `${durationMinutes} Menit`,
          coordinates,
          steps,
          origin: [sLat, sLng],
          destination: [eLat, eLng]
        }
      });
    }

    // Fallback rute geodesik jika OSRM sedang sibuk
    const dLat = (eLat - sLat) * Math.PI / 180;
    const dLng = (eLng - sLng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(sLat * Math.PI / 180) * Math.cos(eLat * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const straightDistance = Math.round(6371000 * c * 1.25); // Koreksi faktor jalan ~1.25
    const estDuration = Math.round((straightDistance / 35000) * 3600); // Rata-rata 35 km/jam

    const straightDistKm = (straightDistance / 1000).toFixed(1);
    const estMinutes = Math.max(1, Math.round(estDuration / 60));

    // Bikin beberapa titik interpolasi rute
    const waypoints = [];
    const segments = 10;
    for (let i = 0; i <= segments; i++) {
      const frac = i / segments;
      waypoints.push([
        sLat + (eLat - sLat) * frac,
        sLng + (eLng - sLng) * frac
      ]);
    }

    return res.json({
      success: true,
      source: 'Direct-Interpolation-Fallback',
      data: {
        distance: straightDistance,
        distanceFormatted: `${straightDistKm} km`,
        duration: estDuration,
        durationFormatted: `${estMinutes} Menit`,
        coordinates: waypoints,
        steps: [
          {
            stepNumber: 1,
            instruction: 'Mulai rute langsung menuju lokasi fasilitas',
            streetName: 'Rute Jalan Penghubung',
            distance: straightDistance,
            distanceText: `${straightDistKm} km`,
            duration: estDuration,
            modifier: 'straight',
            type: 'depart'
          },
          {
            stepNumber: 2,
            instruction: 'Tiba di lokasi fasilitas air bersih',
            streetName: 'Titik Tujuan',
            distance: 0,
            distanceText: '0 m',
            duration: 0,
            modifier: '',
            type: 'arrive'
          }
        ],
        origin: [sLat, sLng],
        destination: [eLat, eLng]
      }
    });

  } catch (error) {
    console.error('Error generating route navigation:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memproses rute navigasi',
      error: error.message
    });
  }
};

// GET /api/wilayah  - daftar wilayah untuk dropdown
const getWilayah = async (req, res) => {
  try {
    const data = await prisma.wilayah.findMany({ orderBy: { nama: 'asc' } });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data wilayah', error: error.message });
  }
};

// GET /api/pengelola  - daftar pengelola untuk dropdown
const getPengelola = async (req, res) => {
  try {
    const data = await prisma.pengelola.findMany({ orderBy: { nama: 'asc' } });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data pengelola', error: error.message });
  }
};

module.exports = {
  getAllFasilitas,
  getFasilitasById,
  createFasilitas,
  updateFasilitas,
  deleteFasilitas,
  getStats,
  getWilayah,
  getPengelola,
  getRouteNavigation,
};


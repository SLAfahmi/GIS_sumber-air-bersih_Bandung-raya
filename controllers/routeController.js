// Navigasi rute turn-by-turn di dalam peta caiKU (tanpa redirect ke Google Maps)

const OSRM_BASE_URL = 'https://router.project-osrm.org/route/v1';
const OSRM_TIMEOUT_MS = 6000;

// Faktor koreksi jarak garis lurus -> jarak jalan & kecepatan rata-rata untuk rute cadangan
const ROAD_FACTOR = 1.25;
const FALLBACK_SPEED_KMH = 35;

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} jam ${minutes % 60} menit` : `${minutes} menit`;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Format instruksi manuver OSRM ke Bahasa Indonesia
function formatManeuverInstruction(step) {
  const maneuver = step.maneuver || {};
  const type = maneuver.type || '';
  const modifier = maneuver.modifier || '';
  const street = step.name && step.name.trim() !== '' ? step.name : 'jalan setempat';

  if (type === 'depart') {
    return `Mulai perjalanan ke arah ${street}`;
  }
  if (type === 'arrive') {
    if (modifier.includes('left')) return 'Tiba di tujuan, lokasi berada di sebelah kiri';
    if (modifier.includes('right')) return 'Tiba di tujuan, lokasi berada di sebelah kanan';
    return 'Tiba di lokasi fasilitas air bersih';
  }
  if (type === 'roundabout' || type === 'rotary') {
    const exit = maneuver.exit ? ` pada pintu keluar ke-${maneuver.exit}` : '';
    return `Masuk bundaran dan keluar${exit} menuju ${street}`;
  }
  if (type === 'merge') {
    return `Bergabung ke ${street}`;
  }
  if (type === 'fork') {
    return modifier.includes('left') ? `Ambil jalur kiri di percabangan menuju ${street}` : `Ambil jalur kanan di percabangan menuju ${street}`;
  }

  const modMap = {
    'left': 'Belok kiri',
    'right': 'Belok kanan',
    'slight left': 'Sedikit serong ke kiri',
    'slight right': 'Sedikit serong ke kanan',
    'sharp left': 'Belok tajam ke kiri',
    'sharp right': 'Belok tajam ke kanan',
    'straight': 'Lurus terus',
    'uturn': 'Putar balik'
  };

  const action = modMap[modifier] || (type === 'turn' ? 'Belok' : 'Lanjutkan');
  return `${action} ke ${street}`;
}

async function fetchOsrmRoute(mode, sLat, sLng, eLat, eLng) {
  const osrmUrl = `${OSRM_BASE_URL}/${mode}/${sLng},${sLat};${eLng},${eLat}?overview=full&geometries=geojson&steps=true`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);

  try {
    const response = await fetch(osrmUrl, { signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json();
    return data.code === 'Ok' && data.routes?.length ? data.routes[0] : null;
  } catch (fetchErr) {
    console.warn('OSRM public fetch failed or timed out, generating geodesic fallback route:', fetchErr.message);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildOsrmResult(route, origin, destination) {
  // GeoJSON [lng, lat] -> Leaflet [lat, lng]
  const coordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

  const steps = (route.legs?.[0]?.steps || []).map((st, idx) => ({
    stepNumber: idx + 1,
    instruction: formatManeuverInstruction(st),
    streetName: st.name || 'Jalan Sekitar',
    distance: st.distance,
    distanceText: formatDistance(st.distance),
    duration: Math.round(st.duration),
    modifier: st.maneuver?.modifier || '',
    type: st.maneuver?.type || '',
    location: st.maneuver?.location ? [st.maneuver.location[1], st.maneuver.location[0]] : null
  }));

  return {
    distance: route.distance,
    distanceFormatted: formatDistance(route.distance),
    duration: route.duration,
    durationFormatted: formatDuration(route.duration),
    coordinates,
    steps,
    origin,
    destination
  };
}

// Rute cadangan berupa garis lurus terinterpolasi jika OSRM tidak dapat dihubungi
function buildFallbackResult(origin, destination) {
  const [sLat, sLng] = origin;
  const [eLat, eLng] = destination;

  const distance = Math.round(haversineMeters(sLat, sLng, eLat, eLng) * ROAD_FACTOR);
  const duration = Math.round((distance / 1000 / FALLBACK_SPEED_KMH) * 3600);

  const segments = 10;
  const coordinates = Array.from({ length: segments + 1 }, (_, i) => {
    const frac = i / segments;
    return [sLat + (eLat - sLat) * frac, sLng + (eLng - sLng) * frac];
  });

  return {
    distance,
    distanceFormatted: formatDistance(distance),
    duration,
    durationFormatted: formatDuration(duration),
    coordinates,
    steps: [
      {
        stepNumber: 1,
        instruction: 'Mulai rute langsung menuju lokasi fasilitas',
        streetName: 'Perkiraan garis lurus',
        distance,
        distanceText: formatDistance(distance),
        duration,
        modifier: 'straight',
        type: 'depart',
        location: origin
      },
      {
        stepNumber: 2,
        instruction: 'Tiba di lokasi fasilitas air bersih',
        streetName: 'Titik Tujuan',
        distance: 0,
        distanceText: '0 m',
        duration: 0,
        modifier: '',
        type: 'arrive',
        location: destination
      }
    ],
    origin,
    destination
  };
}

// GET /api/route
const getRouteNavigation = async (req, res) => {
  try {
    const { startLat, startLng, endLat, endLng, mode = 'driving' } = req.query;

    const sLat = parseFloat(startLat);
    const sLng = parseFloat(startLng);
    const eLat = parseFloat(endLat);
    const eLng = parseFloat(endLng);

    if ([sLat, sLng, eLat, eLng].some((v) => isNaN(v))) {
      return res.status(400).json({
        success: false,
        message: 'Parameter koordinat startLat, startLng, endLat, endLng harus angka valid'
      });
    }

    const origin = [sLat, sLng];
    const destination = [eLat, eLng];
    const osrmRoute = await fetchOsrmRoute(mode, sLat, sLng, eLat, eLng);

    if (osrmRoute) {
      return res.json({ success: true, source: 'OSRM-Routing-Engine', data: buildOsrmResult(osrmRoute, origin, destination) });
    }

    res.json({ success: true, source: 'Direct-Interpolation-Fallback', data: buildFallbackResult(origin, destination) });
  } catch (error) {
    console.error('Error generating route navigation:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memproses rute navigasi',
      error: error.message
    });
  }
};

module.exports = {
  getRouteNavigation,
};

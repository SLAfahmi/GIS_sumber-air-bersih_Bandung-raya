/**
 * Navigasi rute di dalam peta caiKU (OSRM via /api/route) & simulasi live tracking
 */
let currentRouteGroup = null;
let activeRouteData = null;
let activeRouteTarget = null;
let simulation = null;

const WALKING_SPEED_KMH = 4.8;

// Asal rute cadangan bila GPS tidak tersedia: pusat ibu kota provinsi titik tujuan
const FALLBACK_ORIGINS = {
  'Banten': { coords: [-6.1201, 106.1503], label: 'Pusat Kota Serang' },
  'DKI Jakarta': { coords: [-6.1754, 106.8272], label: 'Monas, Jakarta Pusat' },
  'Jawa Barat': { coords: [-6.917464, 107.619123], label: 'Pusat Kota Bandung' },
  'Jawa Tengah': { coords: [-6.9903, 110.4229], label: 'Simpang Lima, Semarang' },
  'DI Yogyakarta': { coords: [-7.7829, 110.3671], label: 'Tugu Yogyakarta' },
  'Jawa Timur': { coords: [-7.2459, 112.7378], label: 'Tugu Pahlawan, Surabaya' }
};

function fallbackOrigin(target) {
  return FALLBACK_ORIGINS[target.provinsi] || { coords: JAWA_CENTER, label: 'Tengah Pulau Jawa' };
}

// Asal rute: GPS pengguna, atau ibu kota provinsi tujuan bila GPS tidak tersedia
async function getRouteOrigin(target) {
  if (state.userCoords) return { coords: state.userCoords, label: 'Lokasi GPS Saya' };
  if (!navigator.geolocation) return fallbackOrigin(target);

  try {
    showToast('Mendeteksi posisi GPS Anda untuk membuat rute...', 'info');
    const pos = await getCurrentPositionAsync({ enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
    setUserLocation([pos.coords.latitude, pos.coords.longitude], pos.coords.accuracy);
    return { coords: state.userCoords, label: 'Lokasi GPS Saya' };
  } catch (err) {
    const origin = fallbackOrigin(target);
    showToast(`${geolocationErrorMessage(err)} Rute dihitung dari ${origin.label}.`, 'info');
    return origin;
  }
}

/**
 * Triggered from Drawer: Starts navigation from user's location to the active water node
 */
async function startNavigationToActiveNode() {
  if (!activeNode) {
    showToast('Pilih titik fasilitas air terlebih dahulu', 'error');
    return;
  }

  const target = activeNode;
  const btn = $('drawer-nav-btn');
  btn.disabled = true;
  try {
    const origin = await getRouteOrigin(target);
    await calculateAndRenderRoute(origin.coords, target, origin.label);
  } finally {
    btn.disabled = false;
  }
}

/**
 * Re-fetch GPS location and re-calculate the active route
 */
async function recalculateRouteFromGPS() {
  if (!activeRouteTarget) return;
  if (!navigator.geolocation) {
    showToast('Geolocation tidak didukung browser', 'error');
    return;
  }

  showToast('Memperbarui koordinat GPS...', 'info');
  try {
    const pos = await getCurrentPositionAsync({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    setUserLocation([pos.coords.latitude, pos.coords.longitude], pos.coords.accuracy);
    await calculateAndRenderRoute(state.userCoords, activeRouteTarget, 'Posisi GPS Terkini');
  } catch (err) {
    showToast(geolocationErrorMessage(err), 'error');
  }
}

function pointIcon(html, size) {
  return L.divIcon({ html, className: 'geo-marker', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

/**
 * Fetch route from internal API and draw polyline + turn-by-turn guidance
 */
async function calculateAndRenderRoute(startCoords, target, originLabel) {
  const destCoords = [target.latitude, target.longitude];
  showToast('Menghitung rute navigasi terbaik...', 'info');

  let json;
  try {
    const params = new URLSearchParams({
      startLat: startCoords[0], startLng: startCoords[1],
      endLat: destCoords[0], endLng: destCoords[1]
    });
    json = await api(`/route?${params}`);
  } catch (err) {
    showToast(`Gagal memproses rute navigasi: ${err.message}`, 'error');
    return;
  }

  clearRouteNavigation({ reopenDrawer: false });
  clearProximityLine();

  activeRouteData = { ...json.data, source: json.source };
  activeRouteTarget = target;
  const isFallback = json.source !== 'OSRM-Routing-Engine';
  const coords = activeRouteData.coordinates;

  currentRouteGroup = L.featureGroup().addTo(map);

  // Casing putih + garis utama
  L.polyline(coords, { color: '#ffffff', weight: 9, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false })
    .addTo(currentRouteGroup);
  L.polyline(coords, {
    color: '#006194',
    weight: 5,
    opacity: 0.95,
    lineCap: 'round',
    lineJoin: 'round',
    dashArray: isFallback ? '8 8' : null,
    className: 'route-glow-path',
    interactive: false
  }).addTo(currentRouteGroup);

  // Jika asal = lokasi GPS, penanda "Anda di sini" sudah ada sehingga tidak perlu penanda asal lagi
  const startsAtUser = state.userCoords && startCoords[0] === state.userCoords[0] && startCoords[1] === state.userCoords[1];
  if (!startsAtUser) {
    L.marker(startCoords, { icon: pointIcon('<span class="route-origin-dot"></span>', 18), keyboard: false })
      .bindTooltip(escapeHtml(originLabel), { permanent: true, direction: 'right', offset: [8, 0], className: 'geo-tooltip geo-tooltip--origin' })
      .addTo(currentRouteGroup);
  }

  L.marker(destCoords, {
    icon: pointIcon('<span class="route-dest-pin"><span class="material-symbols-outlined">flag</span></span>', 22),
    zIndexOffset: 1100,
    keyboard: false
  })
    .bindTooltip(`Tujuan: ${escapeHtml(target.nodeId)}`, { direction: 'top', offset: [0, -10], className: 'geo-tooltip' })
    .addTo(currentRouteGroup);

  // Isi panel rute
  $('route-origin-label').textContent = originLabel;
  $('route-destination-label').textContent = `${target.nodeId} • ${facilityTitle(target)}`;
  $('route-distance-val').textContent = activeRouteData.distanceFormatted;
  $('route-duration-val').textContent = formatDuration(activeRouteData.duration);
  $('route-walk-val').textContent = `Jalan kaki ±${formatDuration((activeRouteData.distance / 1000 / WALKING_SPEED_KMH) * 3600)}`;
  $('route-step-count').textContent = `${activeRouteData.steps.length} langkah`;
  setVisible('route-source-note', isFallback);
  $('route-gmaps-link').href = `https://www.google.com/maps/dir/?api=1&origin=${startCoords[0]},${startCoords[1]}&destination=${destCoords[0]},${destCoords[1]}`;
  resetSimulationUI();
  renderRouteSteps(activeRouteData.steps);

  setPanelOpen('node-drawer', false);
  setPanelOpen('route-panel', true);
  map.fitBounds(currentRouteGroup.getBounds(), { ...getMapPadding(), maxZoom: 16 });

  showToast(`Rute aktif: ${activeRouteData.distanceFormatted} (${formatDuration(activeRouteData.duration)})`, 'success');
}

function maneuverIcon(step) {
  if (step.type === 'depart') return 'trip_origin';
  if (step.type === 'arrive') return 'sports_score';
  if (['roundabout', 'rotary', 'roundabout turn', 'exit roundabout', 'exit rotary'].includes(step.type)) return 'roundabout_right';
  if (step.type === 'merge') return 'merge';
  if (step.type === 'fork') return (step.modifier || '').includes('left') ? 'fork_left' : 'fork_right';

  const icons = {
    'left': 'turn_left',
    'right': 'turn_right',
    'slight left': 'turn_slight_left',
    'slight right': 'turn_slight_right',
    'sharp left': 'turn_sharp_left',
    'sharp right': 'turn_sharp_right',
    'uturn': 'u_turn_left',
    'straight': 'straight'
  };
  return icons[step.modifier] || 'straight';
}

/**
 * Render turn-by-turn navigation steps into panel
 */
function renderRouteSteps(steps) {
  const container = $('route-steps-list');

  if (!steps || steps.length === 0) {
    container.innerHTML = '<div class="p-4 text-center text-on-surface-variant text-xs">Tidak ada data langkah rute terperinci.</div>';
    return;
  }

  container.innerHTML = steps.map((step, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === steps.length - 1;
    const iconBg = isFirst ? 'bg-emerald-600 text-white' : isLast ? 'bg-primary text-white' : 'bg-surface-container-high text-primary';

    return `
      <button type="button" data-step-index="${idx}" class="route-step w-full text-left p-2.5 rounded-xl bg-surface-container-low hover:bg-surface-container border border-surface-container flex items-start gap-2.5 transition-colors group">
        <span class="w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
          <span class="material-symbols-outlined text-[17px]">${maneuverIcon(step)}</span>
        </span>
        <span class="flex flex-col flex-1 min-w-0">
          <span class="font-bold text-xs text-on-surface leading-tight group-hover:text-primary transition-colors">${escapeHtml(step.instruction)}</span>
          <span class="flex items-center gap-2 mt-1 text-[11px] text-on-surface-variant font-medium">
            <span class="truncate">${escapeHtml(step.streetName)}</span>
            <span class="text-outline">•</span>
            <span class="font-semibold text-primary shrink-0">${escapeHtml(step.distanceText)}</span>
          </span>
        </span>
        <span class="text-[10px] font-mono text-outline font-bold mt-1">#${step.stepNumber}</span>
      </button>`;
  }).join('');

  container.onclick = (e) => {
    const stepEl = e.target.closest('[data-step-index]');
    if (stepEl) flyToRouteStep(Number(stepEl.dataset.stepIndex));
  };
}

/**
 * Click on step in panel to fly directly to that turn on map
 */
function flyToRouteStep(index) {
  const step = activeRouteData?.steps[index];
  if (!step?.location) return;
  map.flyTo(step.location, 17, { duration: 1 });
}

/**
 * Zoom to fit entire route
 */
function zoomToActiveRoute() {
  if (!currentRouteGroup) return;
  map.fitBounds(currentRouteGroup.getBounds(), { ...getMapPadding(), maxZoom: 16 });
}

// Tampilkan kembali panel rute dari banner di panel detail
function showRoutePanel() {
  if (!activeRouteData) return;
  setPanelOpen('node-drawer', false);
  setPanelOpen('route-panel', true);
  zoomToActiveRoute();
}

/**
 * Clear the current active route and stop tracking simulation
 */
function clearRouteNavigation({ reopenDrawer = true } = {}) {
  stopSimulation();

  if (currentRouteGroup) {
    map.removeLayer(currentRouteGroup);
    currentRouteGroup = null;
  }

  const target = activeRouteTarget;
  activeRouteData = null;
  activeRouteTarget = null;
  setPanelOpen('route-panel', false);

  if (reopenDrawer && target) {
    openDrawer(state.facilityById.get(target.id) || target);
  } else {
    updateDrawerRouteBanner();
  }
}

// ============================================================================
// Simulasi perjalanan: kendaraan bergerak dengan kecepatan konstan di sepanjang rute
// ============================================================================
function buildCumulativeDistances(coords) {
  const cumulative = [0];
  for (let i = 1; i < coords.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineKm(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]) * 1000);
  }
  return cumulative;
}

function positionAlongRoute(coords, cumulative, distance) {
  const last = cumulative.length - 1;
  if (distance <= 0) return coords[0];
  if (distance >= cumulative[last]) return coords[last];

  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] <= distance) lo = mid;
    else hi = mid;
  }
  const t = (distance - cumulative[lo]) / ((cumulative[hi] - cumulative[lo]) || 1);
  return [
    coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t,
    coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t
  ];
}

function bearingDeg([lat1, lon1], [lat2, lon2]) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function ensureSimulation() {
  if (simulation) return simulation;

  const coords = activeRouteData.coordinates;
  const cumulative = buildCumulativeDistances(coords);
  const total = cumulative[cumulative.length - 1];

  // Awal tiap langkah manuver di sepanjang garis rute (untuk menyorot langkah aktif)
  const stepDistances = activeRouteData.steps.map((s) => s.distance || 0);
  const stepTotal = stepDistances.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  const stepStarts = stepDistances.map((d) => {
    const start = (acc / stepTotal) * total;
    acc += d;
    return start;
  });

  const marker = L.marker(coords[0], {
    icon: pointIcon('<div class="sim-vehicle"><span class="material-symbols-outlined">navigation</span></div>', 28),
    zIndexOffset: 1200,
    interactive: false,
    keyboard: false
  }).addTo(currentRouteGroup);

  simulation = {
    coords,
    cumulative,
    total,
    stepStarts,
    marker,
    traveled: 0,
    // Satu perjalanan disimulasikan sekitar 30 detik
    speed: Math.max(total / 30, 40),
    playing: false,
    finished: false,
    rafId: null,
    lastTs: null,
    lastPanAt: 0,
    bearing: 0,
    currentStep: -1
  };
  return simulation;
}

function setSimulationButton(icon, label) {
  $('sim-btn-icon').textContent = icon;
  $('sim-btn-label').textContent = label;
}

function resetSimulationUI() {
  setSimulationButton('play_arrow', 'Simulasi Perjalanan');
  setVisible('route-progress', false);
  $('route-progress-bar').style.width = '0%';
}

function toggleRouteSimulation() {
  if (!activeRouteData?.coordinates?.length) {
    showToast('Tidak ada rute aktif untuk disimulasikan', 'error');
    return;
  }

  if (simulation?.playing) {
    pauseSimulation();
    return;
  }

  const sim = ensureSimulation();
  if (sim.finished) {
    sim.traveled = 0;
    sim.finished = false;
  }
  if (sim.traveled === 0) showToast('Memulai simulasi perjalanan di sepanjang rute...', 'info');

  sim.playing = true;
  sim.lastTs = null;
  setSimulationButton('pause', 'Jeda Simulasi');
  setVisible('route-progress', true);
  sim.rafId = requestAnimationFrame(simulationFrame);
}

function simulationFrame(timestamp) {
  const sim = simulation;
  if (!sim || !sim.playing) return;

  if (sim.lastTs !== null) {
    sim.traveled = Math.min(sim.total, sim.traveled + ((timestamp - sim.lastTs) / 1000) * sim.speed);
  }
  sim.lastTs = timestamp;
  updateSimulationPosition(sim, timestamp);

  if (sim.traveled >= sim.total) {
    finishSimulation();
    return;
  }
  sim.rafId = requestAnimationFrame(simulationFrame);
}

function updateSimulationPosition(sim, timestamp) {
  const position = positionAlongRoute(sim.coords, sim.cumulative, sim.traveled);
  sim.marker.setLatLng(position);

  // Arahkan ikon kendaraan ke titik 15 m di depan
  const ahead = positionAlongRoute(sim.coords, sim.cumulative, Math.min(sim.total, sim.traveled + 15));
  if (ahead[0] !== position[0] || ahead[1] !== position[1]) sim.bearing = bearingDeg(position, ahead);
  const vehicle = sim.marker.getElement()?.querySelector('.sim-vehicle');
  if (vehicle) vehicle.style.transform = `rotate(${sim.bearing}deg)`;

  // Kamera mengikuti kendaraan saat mendekati tepi peta
  if (timestamp - sim.lastPanAt > 700 && !map.getBounds().pad(-0.2).contains(position)) {
    sim.lastPanAt = timestamp;
    map.panTo(position, { animate: true, duration: 0.6 });
  }

  const progress = sim.total ? sim.traveled / sim.total : 1;
  $('route-progress-bar').style.width = `${(progress * 100).toFixed(1)}%`;
  $('route-progress-text').textContent = progress >= 1
    ? 'Tiba di tujuan'
    : `${Math.round(progress * 100)}% • sisa ${formatDistance((sim.total - sim.traveled) / 1000)} • ±${formatDuration(activeRouteData.duration * (1 - progress))}`;

  let stepIndex = 0;
  sim.stepStarts.forEach((start, i) => {
    if (start <= sim.traveled) stepIndex = i;
  });
  if (stepIndex !== sim.currentStep) {
    sim.currentStep = stepIndex;
    document.querySelectorAll('#route-steps-list .route-step').forEach((el, i) => el.classList.toggle('is-current', i === stepIndex));
    document.querySelector(`#route-steps-list [data-step-index="${stepIndex}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function pauseSimulation() {
  if (!simulation) return;
  cancelAnimationFrame(simulation.rafId);
  simulation.playing = false;
  setSimulationButton('play_arrow', 'Lanjutkan Simulasi');
  showToast('Simulasi perjalanan dijeda', 'info');
}

function finishSimulation() {
  simulation.playing = false;
  simulation.finished = true;
  setSimulationButton('replay', 'Ulangi Simulasi');
  showToast('Anda telah tiba di lokasi fasilitas air!', 'success');
}

function stopSimulation() {
  if (simulation) {
    cancelAnimationFrame(simulation.rafId);
    if (currentRouteGroup) currentRouteGroup.removeLayer(simulation.marker);
    simulation = null;
  }
  resetSimulationUI();
}

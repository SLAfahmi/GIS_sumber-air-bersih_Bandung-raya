/**
 * Peta interaktif Leaflet: marker titik air, filter, panel detail, dan lacak lokasi
 */
let map;
let markersLayer;
let baseLayers = [];
let currentLayerIndex = 0;
let markerById = new Map();
let visibleFacilities = [];
let activeCategory = 'all';
let activeNode = null;
let userLocationLayer = null;
let proximityLine = null;

// Mulai zoom ini marker sedikit diperbesar
const NEAR_ZOOM = 15;

const BASE_LAYERS = [
  {
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19 },
    attribution: '© OpenStreetMap contributors'
  },
  {
    name: 'Topografi (OpenTopoMap)',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: { maxNativeZoom: 17, maxZoom: 19, subdomains: 'abc' },
    attribution: '© OpenStreetMap contributors, SRTM • © OpenTopoMap (CC-BY-SA)'
  },
  {
    name: 'Satelit Esri',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19 },
    attribution: 'Citra © Esri • Data titik: Google Maps'
  }
];

/**
 * Initialize Leaflet Map with Multiple Tile Layers
 */
function initMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView(JAWA_CENTER, JAWA_ZOOM);

  baseLayers = BASE_LAYERS.map((layer) => L.tileLayer(layer.url, layer.options));
  baseLayers[currentLayerIndex].addTo(map);
  updateAttribution();

  markersLayer = L.layerGroup().addTo(map);

  // Skala metrik dipindahkan ke footer kustom
  const scale = L.control.scale({ imperial: false, maxWidth: 90 }).addTo(map);
  $('scale-slot').appendChild(scale.getContainer());

  map.on('zoomend', updateZoomClass);
  updateZoomClass();

  // Koordinat kursor; saat kursor di luar peta tampilkan koordinat pusat peta
  const showCoords = (latlng) => {
    $('cursor-coords').textContent = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
  };
  map.on('mousemove', (e) => showCoords(e.latlng));
  map.on('moveend mouseout', () => showCoords(map.getCenter()));
  showCoords(map.getCenter());

  renderCategoryControls();
  observeMapChrome();
  setupMapEvents();

  setTimeout(() => map.invalidateSize(), 250);
}

// Ukur tinggi kontrol atas & footer agar panel samping tidak menimpanya
function observeMapChrome() {
  const card = $('map-card');
  const top = $('map-top-controls');
  const bottom = $('map-footer');
  const update = () => {
    card.style.setProperty('--top-h', `${top.offsetHeight}px`);
    card.style.setProperty('--bottom-h', `${bottom.offsetHeight}px`);
  };

  update();
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(update);
    observer.observe(top);
    observer.observe(bottom);
  } else {
    window.addEventListener('resize', update);
  }
}

function setupMapEvents() {
  const searchInput = $('geoSearchInput');
  searchInput.addEventListener('input', () => applyMapFilters());
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      jumpToSearchResult();
    }
  });

  $('filterProvinsi').addEventListener('change', () => {
    fillWilayahFilter($('filterWilayah'), $('filterProvinsi').value);
    applyMapFilters({ fit: true });
  });
  $('filterWilayah').addEventListener('change', () => applyMapFilters({ fit: true }));
  $('filterFasilitas').addEventListener('change', () => applyMapFilters({ fit: true }));
}

// Chip filter & legenda dibangun dari KATEGORI_META agar selalu sama dengan data
function renderCategoryControls() {
  const chip = (cat, marker, label) => `
    <button type="button" onclick="setCategoryFilter('${escapeHtml(cat)}')" class="filter-chip${cat === activeCategory ? ' active' : ''}" data-cat="${escapeHtml(cat)}">
      ${marker}<span>${escapeHtml(label)}</span><span class="chip-badge" data-count>0</span>
    </button>`;
  $('category-chips').innerHTML =
    chip('all', '<span class="material-symbols-outlined text-[16px]">water_drop</span>', 'Semua') +
    Object.entries(KATEGORI_META).map(([cat, meta]) =>
      chip(cat, `<span class="w-2.5 h-2.5 rounded-full" style="background:${meta.color}"></span>`, meta.label)).join('');

  $('map-legend-items').innerHTML =
    Object.values(KATEGORI_META).map((meta) =>
      `<span class="flex items-center gap-1.5"><span class="geo-dot inline-block" style="--dot:${meta.color}"></span>${escapeHtml(meta.label)}</span>`).join('') +
    '<span class="flex items-center gap-1.5"><span class="geo-dot is-inactive inline-block" style="--dot:#707881"></span>Pemeliharaan / Rusak</span>';
}

function updateZoomClass() {
  map.getContainer().classList.toggle('map-zoom-near', map.getZoom() >= NEAR_ZOOM);
}

function updateAttribution() {
  $('map-attribution').textContent = BASE_LAYERS[currentLayerIndex].attribution;
}

/**
 * Toggle Map Layer (OSM -> Carto -> Satelit)
 */
function toggleMapLayer() {
  map.removeLayer(baseLayers[currentLayerIndex]);
  currentLayerIndex = (currentLayerIndex + 1) % baseLayers.length;
  baseLayers[currentLayerIndex].addTo(map);
  updateAttribution();
  showToast(`Tampilan Peta: ${BASE_LAYERS[currentLayerIndex].name}`, 'info');
}

// ============================================================================
// Marker titik air
// ============================================================================
function hasCoords(item) {
  return Number.isFinite(item.latitude) && Number.isFinite(item.longitude);
}

function createFacilityIcon(item, isActive = false) {
  const classes = ['geo-dot'];
  if (!statusMeta(item.statusOperasional).active) classes.push('is-inactive');
  if (isActive) classes.push('is-active');

  return L.divIcon({
    html: `<span class="${classes.join(' ')}" style="--dot:${kategoriMeta(item.kategori).color}"></span>`,
    className: 'geo-marker',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    tooltipAnchor: [0, -7]
  });
}

function renderMapMarkers(facilities) {
  markersLayer.clearLayers();
  markerById = new Map();

  facilities.filter(hasCoords).forEach((item) => {
    const isActive = activeNode?.id === item.id;
    const marker = L.marker([item.latitude, item.longitude], {
      icon: createFacilityIcon(item, isActive),
      zIndexOffset: isActive ? 1000 : 0,
      riseOnHover: true
    });

    marker.bindTooltip(
      `<b>${escapeHtml(item.nodeId)}</b> · ${escapeHtml(facilityTitle(item))}`,
      { direction: 'top', className: 'geo-tooltip' }
    );
    marker.on('click', () => focusFacility(item, { zoom: false }));

    markersLayer.addLayer(marker);
    markerById.set(item.id, marker);
  });
}

function refreshMarkerIcon(id) {
  const marker = markerById.get(id);
  const item = state.facilityById.get(id);
  if (!marker || !item) return;
  const isActive = activeNode?.id === id;
  marker.setIcon(createFacilityIcon(item, isActive));
  marker.setZIndexOffset(isActive ? 1000 : 0);
}

// ============================================================================
// Filter peta
// ============================================================================
function populateMapFilterOptions() {
  const jenisSelect = $('filterFasilitas');
  const previousJenis = jenisSelect.value;

  fillProvinsiFilter($('filterProvinsi'));
  fillWilayahFilter($('filterWilayah'), $('filterProvinsi').value);

  // Hanya jenis yang benar-benar ada datanya, lengkap dengan jumlah titik
  const counts = countBy(state.facilities, 'jenisFasilitas');
  jenisSelect.innerHTML = '<option value="all">Semua Jenis Fasilitas</option>' +
    allJenisValues()
      .filter((jenis) => counts[jenis])
      .map((jenis) => `<option value="${escapeHtml(jenis)}">${escapeHtml(jenis)} (${counts[jenis]})</option>`)
      .join('');

  restoreSelectValue(jenisSelect, previousJenis);
}

function matchesSearch(item, query) {
  return [item.nodeId, item.nama, item.alamat, item.desaKelurahan, item.kecamatan, item.wilayahNama, item.provinsi, item.jenisFasilitas, item.pengelolaNama]
    .some((value) => (value || '').toLowerCase().includes(query));
}

function applyMapFilters({ fit = false } = {}) {
  const search = $('geoSearchInput').value.toLowerCase().trim();
  const provinsi = $('filterProvinsi').value;
  const wilayah = $('filterWilayah').value;
  const jenis = $('filterFasilitas').value;

  // Hitungan chip kategori mengikuti filter lain yang aktif
  const base = state.facilities.filter((item) =>
    matchesRegion(item, provinsi, wilayah) &&
    (jenis === 'all' || item.jenisFasilitas === jenis) &&
    (!search || matchesSearch(item, search))
  );
  updateCategoryChipCounts(base);

  visibleFacilities = activeCategory === 'all' ? base : base.filter((item) => item.kategori === activeCategory);
  renderMapMarkers(visibleFacilities);

  $('map-result-count').textContent = `${visibleFacilities.length} titik ditampilkan`;
  $('btn-clear-search').classList.toggle('hidden', !search);

  if (fit) fitMapToFacilities(visibleFacilities);
}

function updateCategoryChipCounts(list) {
  const counts = countBy(list, 'kategori');
  document.querySelectorAll('.filter-chip').forEach((chip) => {
    const cat = chip.dataset.cat;
    chip.querySelector('[data-count]').textContent = cat === 'all' ? list.length : (counts[cat] || 0);
  });
}

/**
 * Category Chip Filter Click
 */
function setCategoryFilter(category) {
  activeCategory = category;
  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.cat === category);
  });
  applyMapFilters();
}

function clearMapSearch() {
  $('geoSearchInput').value = '';
  applyMapFilters();
  $('geoSearchInput').focus();
}

// Enter di kotak pencarian: buka hasil tunggal, atau zoom ke semua hasil
function jumpToSearchResult() {
  if (visibleFacilities.length === 0) {
    showToast('Tidak ada titik yang cocok dengan pencarian', 'info');
  } else if (visibleFacilities.length === 1) {
    focusFacility(visibleFacilities[0]);
  } else {
    fitMapToFacilities(visibleFacilities);
  }
}

// ============================================================================
// Kamera peta
// ============================================================================
const SIDE_PANEL_IDS = ['node-drawer', 'route-panel'];

function setPanelOpen(id, open) {
  const panel = $(id);
  panel.classList.toggle('panel-open', open);
  panel.classList.toggle('panel-closed', !open);
  panel.setAttribute('aria-hidden', String(!open));
}

function getOpenSidePanel() {
  return SIDE_PANEL_IDS.map((id) => $(id)).find((panel) => panel.classList.contains('panel-open')) || null;
}

function isWideScreen() {
  return window.innerWidth >= 640;
}

// Padding fitBounds agar titik tidak tertutup kontrol atau panel
function getMapPadding() {
  const card = $('map-card');
  const top = parseFloat(card.style.getPropertyValue('--top-h')) || 120;
  const bottom = parseFloat(card.style.getPropertyValue('--bottom-h')) || 80;
  const panel = getOpenSidePanel();

  if (isWideScreen()) {
    return { paddingTopLeft: [panel ? panel.offsetWidth + 40 : 40, top + 10], paddingBottomRight: [70, bottom + 10] };
  }
  return { paddingTopLeft: [20, top + 10], paddingBottomRight: [20, panel ? panel.offsetHeight + 20 : bottom + 10] };
}

// Selisih (px) antara pusat peta dan pusat area peta yang tidak tertutup kontrol/panel
function getVisibleCenterOffset() {
  const card = $('map-card');
  const top = parseFloat(card.style.getPropertyValue('--top-h')) || 0;
  const bottom = parseFloat(card.style.getPropertyValue('--bottom-h')) || 0;
  const panel = getOpenSidePanel();

  if (isWideScreen()) return [panel ? (panel.offsetWidth + 16) / 2 : 0, (top - bottom) / 2];
  // Mobile: panel berupa bottom sheet
  return [0, (top - (panel ? panel.offsetHeight + 8 : bottom)) / 2];
}

// Terbang ke titik sehingga titik berada di tengah area peta yang terlihat
function flyToVisibleCenter(latlng, zoom = map.getZoom()) {
  const target = map.unproject(map.project(latlng, zoom).subtract(getVisibleCenterOffset()), zoom);
  map.flyTo(target, zoom, { duration: 0.8 });
}

function fitMapToFacilities(list = state.facilities, { animate = true } = {}) {
  const points = list.filter(hasCoords).map((item) => [item.latitude, item.longitude]);
  if (points.length === 0) return;
  // Ukuran kontainer bisa berubah setelah CSS Tailwind CDN selesai diterapkan
  map.invalidateSize({ pan: false });
  if (points.length === 1) {
    flyToVisibleCenter(points[0], 16);
    return;
  }
  map.fitBounds(L.latLngBounds(points), { ...getMapPadding(), maxZoom: 16, animate });
}

/**
 * Reset Map View ke seluruh titik se-Pulau Jawa
 */
function resetMapView() {
  fitMapToFacilities(state.facilities);
  showToast('Peta menampilkan seluruh titik se-Pulau Jawa', 'info');
}

// ============================================================================
// Panel detail titik
// ============================================================================
function focusFacility(item, { zoom = true } = {}) {
  openDrawer(item);
  flyToVisibleCenter([item.latitude, item.longitude], zoom ? Math.max(map.getZoom(), 16) : map.getZoom());
}

function openDrawer(item) {
  const previous = activeNode;
  activeNode = item;
  if (previous && previous.id !== item.id) refreshMarkerIcon(previous.id);
  refreshMarkerIcon(item.id);

  renderDrawer(item);
  setPanelOpen('route-panel', false);
  setPanelOpen('node-drawer', true);
  updateNodeUrl(item.nodeId);
}

function closeDrawer() {
  setPanelOpen('node-drawer', false);
  updateNodeUrl(null);

  // Saat navigasi aktif, titik tujuan tetap disorot
  if (!activeRouteData && activeNode) {
    const id = activeNode.id;
    activeNode = null;
    refreshMarkerIcon(id);
  }
}

function renderDrawer(item) {
  const meta = kategoriMeta(item.kategori);
  const status = statusMeta(item.statusOperasional);

  $('drawer-node-id').textContent = item.nodeId;
  $('drawer-title').textContent = facilityTitle(item);
  $('drawer-subtitle').textContent = [item.desaKelurahan, item.kecamatan && `Kec. ${item.kecamatan}`, item.wilayahNama].filter(Boolean).join(', ');
  $('drawer-jenis-icon').textContent = jenisIcon(item.jenisFasilitas);
  $('drawer-jenis-icon-wrap').style.backgroundColor = meta.color;

  // Banner kategori pengelola
  $('drawer-category-banner').className = `p-3.5 rounded-xl border flex flex-col gap-1.5 ${meta.banner}`;
  $('drawer-banner-title').className = `text-[11px] uppercase tracking-wider font-bold ${meta.accentText}`;
  $('drawer-badge-pill').className = `flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold shadow-sm shrink-0 ${meta.pill}`;
  $('drawer-badge-icon').textContent = meta.icon;
  $('drawer-kategori').textContent = meta.label;
  $('drawer-deskripsi').textContent = meta.deskripsi;
  $('drawer-subnote').textContent = meta.subnote;
  $('drawer-subnote-row').className = `flex items-start gap-1.5 text-[11px] font-medium ${meta.accentText}`;

  $('drawer-alamat').textContent = item.alamat || '';
  setVisible('drawer-alamat-wrapper', Boolean(item.alamat));

  // Spesifikasi
  $('drawer-fasilitas').textContent = item.jenisFasilitas;
  $('drawer-pengelola').textContent = item.pengelolaNama || '-';
  $('drawer-wilayah').textContent = shortWilayah(item.wilayahNama) || '-';
  $('drawer-provinsi').textContent = item.provinsi || '';
  $('drawer-wilayah-layanan').textContent = item.wilayahLayanan || '-';
  $('drawer-verifikasi').innerHTML = verifikasiBadge(item.statusVerifikasi) || '<span class="font-bold text-xs">-</span>';
  $('drawer-status-dot').className = `w-2 h-2 rounded-full shrink-0 ${status.dot}`;
  $('drawer-status').className = `font-bold text-xs ${status.text}`;
  $('drawer-status').textContent = item.statusOperasional || '-';
  $('drawer-coords').textContent = formatCoords(item.latitude, item.longitude);
  renderDrawerDistance(item);

  // Catatan
  $('drawer-catatan').textContent = item.catatanData || '';
  setVisible('drawer-catatan-wrapper', Boolean(item.catatanData));

  // Sumber data & pembaruan terakhir
  $('drawer-source').innerHTML = `Sumber: <span class="font-semibold">${escapeHtml(item.sumberData || 'Tidak tercatat')}</span>`;
  $('drawer-updated').textContent = `Diperbarui ${formatRelativeDate(item.updatedAt)}`;

  // Link Google Maps dari data (sudah memuat Place ID); tanpa link, cari berdasarkan koordinat
  $('drawer-nav-gmaps').href = /^https?:\/\//i.test(item.sumberUrl || '')
    ? item.sumberUrl
    : `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`;

  updateDrawerRouteBanner();
}

function renderDrawerDistance(item) {
  const el = $('drawer-distance');
  if (!state.userCoords || !item) {
    el.classList.add('hidden');
    return;
  }
  const km = haversineKm(state.userCoords[0], state.userCoords[1], item.latitude, item.longitude);
  el.textContent = `± ${formatDistance(km)} dari lokasi Anda (garis lurus)`;
  el.classList.remove('hidden');
}

function updateDrawerRouteBanner() {
  const showBanner = Boolean(activeRouteData && activeRouteTarget);
  setVisible('drawer-route-banner', showBanner);
  if (showBanner) {
    $('drawer-route-text').textContent = activeRouteTarget.id === activeNode?.id
      ? 'Navigasi aktif ke titik ini'
      : `Navigasi aktif ke ${activeRouteTarget.nodeId}`;
  }
}

// Simpan titik yang sedang dibuka di URL (?node=...) agar mudah dibagikan
function updateNodeUrl(nodeId) {
  const url = new URL(location.href);
  if (nodeId) url.searchParams.set('node', nodeId);
  else url.searchParams.delete('node');
  history.replaceState(null, '', url);
}

function openNodeFromUrl() {
  const nodeId = new URLSearchParams(location.search).get('node');
  if (!nodeId) return;
  const item = state.facilities.find((f) => f.nodeId.toLowerCase() === nodeId.toLowerCase());
  if (item) focusFacility(item);
  else showToast(`Titik ${nodeId} tidak ditemukan`, 'error');
}

/**
 * Copy Current Active Node Coordinates
 */
async function copyCurrentCoords() {
  if (!activeNode) return;
  const coords = formatCoords(activeNode.latitude, activeNode.longitude);
  const ok = await copyText(coords);
  showToast(ok ? `Koordinat ${coords} disalin` : 'Gagal menyalin koordinat', ok ? 'success' : 'error');
}

async function shareActiveNode() {
  if (!activeNode) return;
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('node', activeNode.nodeId);
  const title = `${facilityTitle(activeNode)} (${activeNode.nodeId}) - caiKU`;

  if (navigator.share) {
    try {
      await navigator.share({ title, text: `${title}: ${kategoriMeta(activeNode.kategori).label}`, url: url.href });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const ok = await copyText(url.href);
  showToast(ok ? 'Tautan titik disalin ke clipboard' : 'Gagal menyalin tautan', ok ? 'success' : 'error');
}

function editActiveNode() {
  const item = activeNode;
  if (!item) return;
  requireLogin(() => {
    switchView('crud');
    populateFormForEdit(state.facilityById.get(item.id) || item);
  }, 'Login sebagai petugas untuk memperbarui data titik ini.');
}

// ============================================================================
// Geolocation: lokasi pengguna & titik terdekat
// ============================================================================
function getCurrentPositionAsync(options) {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
}

function geolocationErrorMessage(err) {
  if (err?.code === 1) return 'Izin lokasi ditolak. Aktifkan izin lokasi di browser.';
  if (err?.code === 2) return 'Posisi GPS tidak tersedia.';
  if (err?.code === 3) return 'Waktu habis saat mencari sinyal GPS.';
  return `Gagal mendapatkan lokasi: ${err?.message || 'tidak diketahui'}`;
}

function setUserLocation(latlng, accuracy) {
  state.userCoords = latlng;
  if (userLocationLayer) map.removeLayer(userLocationLayer);

  const layers = [];
  if (accuracy) {
    layers.push(L.circle(latlng, {
      radius: Math.min(accuracy, 3000),
      color: '#2563eb',
      weight: 1,
      opacity: 0.35,
      fillColor: '#2563eb',
      fillOpacity: 0.07,
      interactive: false
    }));
  }

  const icon = L.divIcon({ html: '<span class="user-dot"></span>', className: 'geo-marker', iconSize: [18, 18], iconAnchor: [9, 9] });
  const label = accuracy ? `Anda di sini (±${Math.round(accuracy)} m)` : 'Anda di sini';
  layers.push(
    L.marker(latlng, { icon, zIndexOffset: 900, keyboard: false })
      .bindTooltip(label, { permanent: true, direction: 'right', offset: [8, 0], className: 'geo-tooltip geo-tooltip--user' })
  );

  userLocationLayer = L.layerGroup(layers).addTo(map);
  if (activeNode) renderDrawerDistance(activeNode);
}

function findNearestFacility(lat, lng, candidates) {
  let nearest = null;
  candidates.filter(hasCoords).forEach((item) => {
    const distance = haversineKm(lat, lng, item.latitude, item.longitude);
    if (!nearest || distance < nearest.distance) nearest = { item, distance };
  });
  return nearest;
}

function clearProximityLine() {
  if (proximityLine) {
    map.removeLayer(proximityLine);
    proximityLine = null;
  }
}

function setLocateLoading(loading) {
  $('btnLacakLokasi').disabled = loading;
  const icon = $('btnLacakIcon');
  icon.textContent = loading ? 'progress_activity' : 'near_me';
  icon.classList.toggle('spin', loading);
}

/**
 * Lacak posisi pengguna & buka titik terdekat (mengikuti filter yang aktif)
 */
async function locateUserProximity() {
  if (!navigator.geolocation) {
    showToast('Geolocation tidak didukung oleh browser Anda', 'error');
    return;
  }

  setLocateLoading(true);
  showToast('Melacak posisi GPS Anda...', 'info');

  try {
    const pos = await getCurrentPositionAsync({ enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
    const { latitude, longitude, accuracy } = pos.coords;
    const userLatLng = [latitude, longitude];
    setUserLocation(userLatLng, accuracy);

    const usingFilter = visibleFacilities.length > 0 && visibleFacilities.length < state.facilities.length;
    const nearest = findNearestFacility(latitude, longitude, visibleFacilities.length ? visibleFacilities : state.facilities);
    if (!nearest) {
      map.flyTo(userLatLng, 15);
      return;
    }

    clearProximityLine();
    proximityLine = L.polyline([userLatLng, [nearest.item.latitude, nearest.item.longitude]], {
      color: '#006194',
      weight: 2,
      opacity: 0.8,
      dashArray: '4 6',
      interactive: false
    }).addTo(map);

    openDrawer(nearest.item);
    map.fitBounds(L.latLngBounds([userLatLng, [nearest.item.latitude, nearest.item.longitude]]), { ...getMapPadding(), maxZoom: 16 });
    showToast(`Terdekat${usingFilter ? ' (sesuai filter)' : ''}: ${facilityTitle(nearest.item)} • ${formatDistance(nearest.distance)}`, 'success');
  } catch (err) {
    showToast(geolocationErrorMessage(err), 'error');
  } finally {
    setLocateLoading(false);
  }
}

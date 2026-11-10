/**
 * Street View: panorama Google di dalam web, mode klik peta (pegman), dan garis cakupan biru
 */
let svCoverageLayer = null;
let svModeActive = false;
let svCoverageBeforeMode = false;
let svPegman = null;

// Tile garis biru cakupan Street View (sama dengan yang dipakai Google Maps)
const SV_COVERAGE_URL = 'https://mts{s}.googleapis.com/vt?hl=id&lyrs=svv|cb_client:apiv3&style=40,18&x={x}&y={y}&z={z}';

// Embed tanpa API key (bentuk yang sama dengan "Sematkan peta" di Google Maps); mencari panorama terdekat
function streetViewEmbedUrl(lat, lng) {
  return `https://www.google.com/maps/embed?pb=!6m6!1m5!2m2!1d${lat.toFixed(6)}!2d${lng.toFixed(6)}!4f0!5f1`;
}

// Maps URLs resmi: membuka Street View terdekat di Google Maps
function streetViewExternalUrl(lat, lng) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function setupStreetView() {
  map.on('click', (e) => {
    if (svModeActive) openStreetView({ lat: e.latlng.lat, lng: e.latlng.lng });
  });
}

// ============================================================================
// Garis cakupan
// ============================================================================
function isStreetViewCoverageOn() {
  return Boolean(svCoverageLayer && map.hasLayer(svCoverageLayer));
}

function setStreetViewCoverage(on) {
  if (!svCoverageLayer) {
    svCoverageLayer = L.tileLayer(SV_COVERAGE_URL, { subdomains: '0123', maxZoom: 19, opacity: 0.8, zIndex: 50 });
  }
  if (on) svCoverageLayer.addTo(map);
  else map.removeLayer(svCoverageLayer);
  $('toggle-sv-coverage').checked = on;
  updateAttribution();
}

// ============================================================================
// Mode pegman: klik jalan atau titik air untuk membuka panorama
// ============================================================================
function isStreetViewMode() {
  return svModeActive;
}

function toggleStreetViewMode(active = !svModeActive) {
  if (active === svModeActive) return;
  svModeActive = active;

  map.getContainer().classList.toggle('sv-mode', active);
  const btn = $('btn-streetview');
  btn.classList.toggle('is-on', active);
  btn.setAttribute('aria-pressed', String(active));

  // Garis cakupan selalu tampil selama mode aktif, lalu kembali ke pilihan sebelumnya
  if (active) {
    svCoverageBeforeMode = isStreetViewCoverageOn();
    setStreetViewCoverage(true);
    showToast('Mode Street View: klik jalan bergaris biru atau titik air', 'info');
  } else {
    setStreetViewCoverage(svCoverageBeforeMode);
  }
}

// ============================================================================
// Panel panorama
// ============================================================================
function isStreetViewOpen() {
  return !$('streetview-panel').classList.contains('hidden');
}

function openStreetView({ lat, lng, title = 'Lokasi dipilih di peta' }) {
  if (svPegman) map.removeLayer(svPegman);
  const icon = L.divIcon({
    html: '<span class="sv-pegman"><span class="material-symbols-outlined">person</span></span>',
    className: 'geo-marker',
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
  svPegman = L.marker([lat, lng], { icon, zIndexOffset: 1100, interactive: false, keyboard: false }).addTo(map);

  $('sv-title').textContent = title;
  $('sv-coords').textContent = formatCoords(lat, lng);
  $('sv-external').href = streetViewExternalUrl(lat, lng);
  $('sv-frame').src = streetViewEmbedUrl(lat, lng);
  setVisible('streetview-panel', true);
}

function openStreetViewForFacility(item) {
  if (!item || !hasCoords(item)) return;
  openStreetView({ lat: item.latitude, lng: item.longitude, title: facilityTitle(item) });
}

function openStreetViewForActiveNode() {
  openStreetViewForFacility(activeNode);
}

function closeStreetView() {
  setVisible('streetview-panel', false);
  // Kosongkan iframe agar panorama berhenti memuat
  $('sv-frame').src = 'about:blank';
  if (svPegman) {
    map.removeLayer(svPegman);
    svPegman = null;
  }
}

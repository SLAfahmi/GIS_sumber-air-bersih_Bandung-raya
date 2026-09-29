/**
 * caiKU - GIS Air Bersih Bandung Raya
 * Frontend Application Logic (Leaflet Map & CRUD Management)
 */

// Application State
let map;
let markersLayer;
let baseLayers = {};
let currentLayerIndex = 0;
let userLocationMarker = null;
let allFacilities = [];
let activeCategory = 'all';
let currentEditingId = null;
let activeNode = null;

// Route & Navigation State
let currentUserCoords = null;
let currentRouteGroup = null;
let activeRouteData = null;
let routeSimulationInterval = null;
let isSimulatingRoute = false;
let simulationCoordIndex = 0;
let simulationMarker = null;

// Table Pagination State
let tableCurrentPage = 1;
const tablePageSize = 8;
let tableFilteredList = [];

// Bandung Raya Default Coordinates & Zoom
const BANDUNG_CENTER = [-6.917464, 107.619123];
const BANDUNG_ZOOM = 12;

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  initMap();
  await loadStatistics();
  await loadFacilities();
  setupEventListeners();
});

/**
 * Initialize Leaflet Map with Multiple Tile Layers
 */
function initMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView(BANDUNG_CENTER, BANDUNG_ZOOM);

  // Define Tile Layers (OpenStreetMap Standard as primary base map)
  const osmStandard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  });

  const cartoVoyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd'
  });

  const esriSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19
  });

  baseLayers = [osmStandard, cartoVoyager, esriSatellite];
  baseLayers[0].addTo(map);

  // Layer group for facility pins
  markersLayer = L.layerGroup().addTo(map);

  // Ensure map tiles render fully across container
  setTimeout(() => {
    map.invalidateSize();
  }, 250);

  // Click on map to capture coordinates for form
  map.on('click', (e) => {
    const lat = e.latlng.lat.toFixed(6);
    const lng = e.latlng.lng.toFixed(6);
    const latInput = document.getElementById('form-lat');
    const lngInput = document.getElementById('form-lng');
    if (latInput && lngInput) {
      latInput.value = lat;
      lngInput.value = lng;
    }
  });
}

/**
 * Toggle Map Layer (Carto -> OSM -> Satellite)
 */
function toggleMapLayer() {
  map.removeLayer(baseLayers[currentLayerIndex]);
  currentLayerIndex = (currentLayerIndex + 1) % baseLayers.length;
  baseLayers[currentLayerIndex].addTo(map);

  const layerNames = ['OpenStreetMap', 'CartoDB Voyager', 'Satelit ESRI'];
  showToast(`Tampilan Peta: ${layerNames[currentLayerIndex]}`, 'info');
}

/**
 * Fetch and Render Telemetry Statistics
 */
async function loadStatistics() {
  try {
    const res = await fetch('/api/stats');
    const json = await res.json();
    if (!json.success) return;

    const stats = json.data;

    // Telemetry top bar pills
    document.getElementById('telemetry-total').textContent = stats.total;
    document.getElementById('telemetry-normal').textContent = `${stats.normal} Normal`;
    document.getElementById('telemetry-maintenance').textContent = `${stats.pemeliharaan} Pemeliharaan`;

    // Filter Badges
    document.getElementById('badge-cat-all').textContent = stats.total;
    document.getElementById('badge-cat-siap').textContent = stats.siapMinum;
    document.getElementById('badge-cat-belum').textContent = stats.belumSiapMinum;
    document.getElementById('badge-cat-verif').textContent = stats.perluVerifikasi;

    // KPI Cards in CRUD view
    document.getElementById('kpi-total').textContent = stats.total;
    document.getElementById('kpi-siap').textContent = stats.siapMinum;
    document.getElementById('kpi-belum').textContent = stats.belumSiapMinum;
    document.getElementById('kpi-verif').textContent = stats.perluVerifikasi;

    if (stats.total > 0) {
      document.getElementById('kpi-siap-pct').textContent = `(${((stats.siapMinum / stats.total) * 100).toFixed(0)}%)`;
      document.getElementById('kpi-belum-pct').textContent = `(${((stats.belumSiapMinum / stats.total) * 100).toFixed(0)}%)`;
      document.getElementById('kpi-verif-pct').textContent = `(${((stats.perluVerifikasi / stats.total) * 100).toFixed(0)}%)`;
    }
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

/**
 * Fetch All Facilities & Open BDG-WATER-001 initially
 */
async function loadFacilities() {
  try {
    const res = await fetch('/api/fasilitas');
    const json = await res.json();
    if (json.success) {
      allFacilities = json.data;
      renderMapMarkers(allFacilities);
      updateInventoryTable();
    }
  } catch (err) {
    console.error('Failed to load facilities:', err);
    showToast('Gagal memuat data dari server', 'error');
  }
}

/**
 * Render Leaflet Markers Matching Reference Design
 */
function renderMapMarkers(facilities) {
  markersLayer.clearLayers();

  facilities.forEach((item) => {
    if (!item.latitude || !item.longitude) return;

    // Category styling & icons
    let circleBg = '#f59e0b';
    let iconName = 'water_damage';
    let pulseHtml = '';
    let labelColor = 'text-amber-600';

    if (item.kategoriAirMinum === 'Siap minum') {
      circleBg = '#006947';
      iconName = 'verified';
      labelColor = 'text-tertiary';
      pulseHtml = `<span class="pin-radar-ring bg-emerald-500/25"></span>`;
    } else if (item.kategoriAirMinum === 'Perlu verifikasi') {
      circleBg = '#6366f1';
      iconName = 'pending_actions';
      labelColor = 'text-indigo-600';
    } else {
      // Icon variations for belum siap minum
      if (item.jenisFasilitas.includes('Katup')) iconName = 'valve';
      else if (item.jenisFasilitas.includes('IPA')) iconName = 'domain';
      else if (item.jenisFasilitas.includes('Mata Air')) iconName = 'landscape';
      else if (item.jenisFasilitas.includes('Sumur')) iconName = 'water';
    }

    const iconHtml = `
      <div class="custom-geo-pin group">
        <div class="pin-label-pill ${labelColor} hidden group-hover:flex">
          <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${circleBg}"></span>
          <span>${item.nodeId} • ${item.jenisFasilitas}</span>
        </div>
        ${pulseHtml}
        <div class="pin-circle" style="background-color: ${circleBg}">
          <span class="material-symbols-outlined text-[18px]">${iconName}</span>
        </div>
        <div class="pin-needle" style="background-color: ${circleBg}"></div>
      </div>
    `;

    const customIcon = L.divIcon({
      html: iconHtml,
      className: '',
      iconSize: [36, 44],
      iconAnchor: [18, 44],
      popupAnchor: [0, -44]
    });

    const marker = L.marker([item.latitude, item.longitude], { icon: customIcon });

    marker.on('click', () => {
      openDrawer(item);
      map.panTo([item.latitude, item.longitude]);
    });

    markersLayer.addLayer(marker);
  });
}

/**
 * Filter Facilities for Map
 */
function applyMapFilters() {
  const searchQuery = document.getElementById('geoSearchInput').value.toLowerCase().trim();
  const wilayahFilter = document.getElementById('filterWilayah').value;
  const fasilitasFilter = document.getElementById('filterFasilitas').value;

  const filtered = allFacilities.filter((item) => {
    // Category match
    if (activeCategory !== 'all' && item.kategoriAirMinum !== activeCategory) {
      return false;
    }

    // Wilayah match
    if (wilayahFilter !== 'all' && !item.wilayah.toLowerCase().includes(wilayahFilter.toLowerCase())) {
      return false;
    }

    // Fasilitas match
    if (fasilitasFilter !== 'all' && !item.jenisFasilitas.toLowerCase().includes(fasilitasFilter.toLowerCase())) {
      return false;
    }

    // Search query match
    if (searchQuery) {
      const matchNode = (item.nodeId || '').toLowerCase().includes(searchQuery);
      const matchWilayah = (item.wilayah || '').toLowerCase().includes(searchQuery);
      const matchJenis = (item.jenisFasilitas || '').toLowerCase().includes(searchQuery);
      const matchPengelola = (item.pengelola || '').toLowerCase().includes(searchQuery);
      const matchKet = (item.keteranganAirMinum || '').toLowerCase().includes(searchQuery);
      if (!matchNode && !matchWilayah && !matchJenis && !matchPengelola && !matchKet) {
        return false;
      }
    }

    return true;
  });

  renderMapMarkers(filtered);
}

/**
 * Category Chip Filter Click
 */
function setCategoryFilter(category) {
  activeCategory = category;

  document.querySelectorAll('.filter-chip').forEach((btn) => {
    if (btn.dataset.cat === category) {
      btn.classList.add('active', 'bg-primary', 'text-on-primary');
      btn.classList.remove('bg-surface-container-lowest/90', 'text-on-surface');
    } else {
      btn.classList.remove('active', 'bg-primary', 'text-on-primary');
      btn.classList.add('bg-surface-container-lowest/90', 'text-on-surface');
    }
  });

  applyMapFilters();
}

/**
 * Open Node Detail Card on the Left (Matching User's Screenshot)
 */
function openDrawer(item) {
  activeNode = item;

  // Header
  document.getElementById('drawer-node-id').textContent = item.nodeId;
  
  // Title & Subtitle formatting
  if (item.nodeId === 'BDG-WATER-001') {
    document.getElementById('drawer-title').textContent = 'Cikutra / Dago';
    document.getElementById('drawer-subtitle').textContent = 'Kec. Cibeunying Kidul, Kota Bandung';
  } else {
    document.getElementById('drawer-title').textContent = `${item.jenisFasilitas} ${item.pengelola}`;
    document.getElementById('drawer-subtitle').textContent = `${item.wilayah}`;
  }

  // Category Banner
  const categoryBanner = document.getElementById('drawer-category-banner');
  const badgePill = document.getElementById('drawer-badge-pill');
  const badgeIcon = document.getElementById('drawer-badge-icon');
  const badgeKategori = document.getElementById('drawer-kategori');
  const keteranganText = document.getElementById('drawer-keterangan');
  const subnoteText = document.getElementById('drawer-subnote');
  const statusDot = document.getElementById('drawer-status-dot');
  const statusText = document.getElementById('drawer-status');
  const slhsText = document.getElementById('drawer-slhs');

  if (item.kategoriAirMinum === 'Siap minum') {
    categoryBanner.className = 'p-3.5 rounded-xl bg-tertiary-container/10 border border-tertiary/20 flex flex-col gap-1.5';
    badgePill.className = 'flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-tertiary text-on-tertiary text-xs font-bold shadow-sm';
    badgeIcon.textContent = 'check_circle';
    badgeKategori.textContent = 'Siap Minum';
    keteranganText.textContent = item.keteranganAirMinum || 'Gerai air minum siap konsumsi langsung tanpa perebusan. Terhubung sistem filtrasi multi-tahap ozonisasi terstandarisasi.';
    subnoteText.textContent = 'Tetap perlu uji kualitas kelayakan berkala per 30 hari.';
    statusDot.className = 'w-2 h-2 rounded-full bg-tertiary animate-pulse';
    statusText.textContent = item.statusOperasional || 'Beroperasi Normal';
    statusText.className = 'font-bold text-xs text-tertiary';
    slhsText.textContent = 'Dinkes Terbit (Aktif)';
  } else if (item.kategoriAirMinum === 'Perlu verifikasi') {
    categoryBanner.className = 'p-3.5 rounded-xl bg-indigo-50 border border-indigo-200 flex flex-col gap-1.5';
    badgePill.className = 'flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-600 text-white text-xs font-bold shadow-sm';
    badgeIcon.textContent = 'pending_actions';
    badgeKategori.textContent = 'Perlu Verifikasi';
    keteranganText.textContent = item.keteranganAirMinum || 'Depot air isi ulang atau titik distribusi; cek sertifikat SLHS dan hasil uji laboratorium sebelum diminum.';
    subnoteText.textContent = 'Menunggu inspeksi dan uji kualitas air berkala.';
    statusDot.className = 'w-2 h-2 rounded-full bg-indigo-500 animate-pulse';
    statusText.textContent = item.statusOperasional || 'Perlu Verifikasi';
    statusText.className = 'font-bold text-xs text-indigo-700';
    slhsText.textContent = 'Uji Lab Terjadwal';
  } else {
    categoryBanner.className = 'p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex flex-col gap-1.5';
    badgePill.className = 'flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold shadow-sm';
    badgeIcon.textContent = 'water_damage';
    badgeKategori.textContent = 'Belum Siap Minum';
    keteranganText.textContent = item.keteranganAirMinum || 'Titik air bersih untuk kebutuhan sanitasi dan cuci. Wajib dimasak/diolah hingga mendidih sebelum dikonsumsi.';
    subnoteText.textContent = 'Bukan titik minum langsung. Masak dulu sebelum diminum.';
    statusDot.className = 'w-2 h-2 rounded-full bg-amber-500';
    statusText.textContent = item.statusOperasional || 'Beroperasi Normal';
    statusText.className = 'font-bold text-xs text-amber-700';
    slhsText.textContent = 'Baku Mutu Air Bersih';
  }

  // Metadata Specs
  document.getElementById('drawer-fasilitas').textContent = item.jenisFasilitas;
  document.getElementById('drawer-pengelola').textContent = item.pengelola;
  document.getElementById('drawer-coords').textContent = `Lat ${item.latitude.toFixed(6)}, Long ${item.longitude.toFixed(6)}`;

  // Catatan Data if exists
  const catatanWrapper = document.getElementById('drawer-catatan-wrapper');
  if (item.catatanData) {
    document.getElementById('drawer-catatan').textContent = item.catatanData;
    catatanWrapper.classList.remove('hidden');
  } else {
    catatanWrapper.classList.add('hidden');
  }

  // Navigation Links (Fallback external GMaps)
  const gmapsLink = `https://www.google.com/maps/dir/?api=1&destination=${item.latitude},${item.longitude}`;
  const gmapsDrawerBtn = document.getElementById('drawer-nav-gmaps');
  if (gmapsDrawerBtn) gmapsDrawerBtn.href = gmapsLink;

  // Edit Action in Drawer
  document.getElementById('drawer-edit-btn').onclick = () => {
    populateFormForEdit(item);
    switchView('crud');
  };

  // Open Drawer (sliding in from left)
  const drawer = document.getElementById('node-drawer');
  drawer.classList.remove('drawer-closed');
  drawer.classList.add('drawer-open');
}

function closeDrawer() {
  const drawer = document.getElementById('node-drawer');
  drawer.classList.remove('drawer-open');
  drawer.classList.add('drawer-closed');
}

/**
 * Copy Current Active Node Coordinates
 */
function copyCurrentCoords() {
  if (!activeNode) return;
  const coordsStr = `${activeNode.latitude.toFixed(6)}, ${activeNode.longitude.toFixed(6)}`;
  navigator.clipboard.writeText(coordsStr).then(() => {
    showToast(`Koordinat ${coordsStr} disalin ke clipboard!`, 'success');
  });
}

/**
 * Reset Map View to Bandung Raya
 */
function resetMapView() {
  map.flyTo(BANDUNG_CENTER, BANDUNG_ZOOM);
  showToast('Pusat peta diatur ke Bandung Raya', 'info');
}

/**
 * Geolocation - Find user's location & closest facility
 */
function locateUserProximity() {
  if (!navigator.geolocation) {
    showToast('Geolocation tidak didukung oleh browser Anda', 'error');
    return;
  }

  showToast('Melacak posisi GPS Anda...', 'info');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const userLat = pos.coords.latitude;
      const userLng = pos.coords.longitude;
      currentUserCoords = [userLat, userLng];

      if (userLocationMarker) {
        map.removeLayer(userLocationMarker);
      }

      // Add user pulsating icon
      const userIcon = L.divIcon({
        html: `
          <div class="relative flex items-center justify-center">
            <span class="w-10 h-10 rounded-full bg-primary/20 animate-ping absolute"></span>
            <span class="w-4 h-4 rounded-full bg-primary ring-4 ring-white shadow-md"></span>
            <span class="absolute top-5 bg-white text-primary text-[10px] font-bold px-1.5 py-0.5 rounded shadow whitespace-nowrap">Anda di sini</span>
          </div>
        `,
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      userLocationMarker = L.marker([userLat, userLng], { icon: userIcon }).addTo(map);
      map.flyTo([userLat, userLng], 14);

      // Find nearest facility
      let nearest = null;
      let minDistance = Infinity;

      allFacilities.forEach((item) => {
        const d = calculateDistance(userLat, userLng, item.latitude, item.longitude);
        if (d < minDistance) {
          minDistance = d;
          nearest = item;
        }
      });

      if (nearest) {
        showToast(`Lokasi terdekat: ${nearest.nodeId} (${minDistance.toFixed(2)} km)`, 'success');
        setTimeout(() => {
          openDrawer(nearest);
        }, 1000);
      }
    },
    (err) => {
      showToast('Gagal mendapatkan lokasi GPS: ' + err.message, 'error');
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// Haversine formula (km)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Switch View (Map <-> CRUD)
 */
function switchView(viewName) {
  const viewMap = document.getElementById('view-map');
  const viewCrud = document.getElementById('view-crud');
  const btnMap = document.getElementById('nav-btn-map');
  const btnCrud = document.getElementById('nav-btn-crud');

  if (viewName === 'map') {
    viewMap.classList.remove('hidden');
    viewCrud.classList.add('hidden');

    btnMap.classList.add('bg-primary-container', 'text-on-primary-container');
    btnMap.classList.remove('text-on-surface-variant');

    btnCrud.classList.remove('bg-primary-container', 'text-on-primary-container');
    btnCrud.classList.add('text-on-surface-variant');

    setTimeout(() => {
      map.invalidateSize();
    }, 200);
  } else {
    viewMap.classList.add('hidden');
    viewCrud.classList.remove('hidden');

    btnCrud.classList.add('bg-primary-container', 'text-on-primary-container');
    btnCrud.classList.remove('text-on-surface-variant');

    btnMap.classList.remove('bg-primary-container', 'text-on-primary-container');
    btnMap.classList.add('text-on-surface-variant');

    updateInventoryTable();
  }
}

/**
 * Update Inventory Table with Pagination & Filters
 */
function updateInventoryTable() {
  const search = document.getElementById('tableSearchInput')?.value.toLowerCase().trim() || '';
  const wilayah = document.getElementById('tableFilterWilayah')?.value || 'all';
  const kategori = document.getElementById('tableFilterKategori')?.value || 'all';

  tableFilteredList = allFacilities.filter((item) => {
    if (wilayah !== 'all' && !item.wilayah.toLowerCase().includes(wilayah.toLowerCase())) return false;
    if (kategori !== 'all' && item.kategoriAirMinum !== kategori) return false;
    if (search) {
      const matchNode = (item.nodeId || '').toLowerCase().includes(search);
      const matchWilayah = (item.wilayah || '').toLowerCase().includes(search);
      const matchJenis = (item.jenisFasilitas || '').toLowerCase().includes(search);
      const matchPengelola = (item.pengelola || '').toLowerCase().includes(search);
      if (!matchNode && !matchWilayah && !matchJenis && !matchPengelola) return false;
    }
    return true;
  });

  const totalItems = tableFilteredList.length;
  const totalPages = Math.ceil(totalItems / tablePageSize) || 1;

  if (tableCurrentPage > totalPages) tableCurrentPage = totalPages;
  if (tableCurrentPage < 1) tableCurrentPage = 1;

  const startIndex = (tableCurrentPage - 1) * tablePageSize;
  const pageItems = tableFilteredList.slice(startIndex, startIndex + tablePageSize);

  const tbody = document.getElementById('inventory-table-body');
  if (!tbody) return;

  if (pageItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-8 text-center text-on-surface-variant">Tidak ada titik fasilitas yang cocok.</td>
      </tr>
    `;
  } else {
    tbody.innerHTML = pageItems.map((item) => `
      <tr class="hover:bg-surface-container-low transition-colors">
        <td class="py-3 px-3 font-mono font-bold text-primary">${item.nodeId}</td>
        <td class="py-3 px-3">
          <div class="font-bold text-on-surface">${item.jenisFasilitas}</div>
          <div class="text-[11px] text-on-surface-variant">${item.wilayah}</div>
        </td>
        <td class="py-3 px-3 text-on-surface">${item.pengelola}</td>
        <td class="py-3 px-3">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${
            item.kategoriAirMinum === 'Siap minum' ? 'bg-emerald-100 text-emerald-800' :
            item.kategoriAirMinum === 'Perlu verifikasi' ? 'bg-indigo-100 text-indigo-800' : 'bg-amber-100 text-amber-800'
          }">${item.kategoriAirMinum}</span>
        </td>
        <td class="py-3 px-3">
          <span class="text-[11px] font-medium text-on-surface-variant">${item.statusOperasional}</span>
        </td>
        <td class="py-3 px-3 text-right">
          <div class="flex items-center justify-end gap-1">
            <button onclick="locateAndShowOnMap(${item.id})" title="Lihat di Peta" class="p-1.5 rounded-lg text-primary hover:bg-surface-container">
              <span class="material-symbols-outlined text-[16px]">map</span>
            </button>
            <button onclick="populateFormForEditById(${item.id})" title="Edit Titik" class="p-1.5 rounded-lg text-secondary hover:bg-surface-container">
              <span class="material-symbols-outlined text-[16px]">edit</span>
            </button>
            <button onclick="confirmDeleteFacility(${item.id}, '${item.nodeId}')" title="Hapus Titik" class="p-1.5 rounded-lg text-error hover:bg-error-container">
              <span class="material-symbols-outlined text-[16px]">delete</span>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // Info & Pagination Controls
  document.getElementById('table-pagination-info').textContent = 
    `Menampilkan ${totalItems === 0 ? 0 : startIndex + 1} - ${Math.min(startIndex + tablePageSize, totalItems)} dari ${totalItems} titik`;
  document.getElementById('table-current-page').textContent = tableCurrentPage;
  document.getElementById('btn-prev-page').disabled = tableCurrentPage <= 1;
  document.getElementById('btn-next-page').disabled = tableCurrentPage >= totalPages;
}

function handleTableSearch() {
  tableCurrentPage = 1;
  updateInventoryTable();
}

function handleTableFilter() {
  tableCurrentPage = 1;
  updateInventoryTable();
}

function changeTablePage(delta) {
  tableCurrentPage += delta;
  updateInventoryTable();
}

/**
 * Locate facility and show on map
 */
function locateAndShowOnMap(id) {
  const item = allFacilities.find((f) => f.id === id);
  if (!item) return;

  switchView('map');
  setTimeout(() => {
    map.flyTo([item.latitude, item.longitude], 15);
    openDrawer(item);
  }, 250);
}

/**
 * Populate Form for Editing an Existing Node
 */
function populateFormForEdit(item) {
  currentEditingId = item.id;
  document.getElementById('form-id').value = item.id;
  document.getElementById('form-node-id').value = item.nodeId;
  document.getElementById('form-wilayah').value = item.wilayah;
  document.getElementById('form-jenis').value = item.jenisFasilitas;
  document.getElementById('form-pengelola').value = item.pengelola;
  document.getElementById('form-lat').value = item.latitude;
  document.getElementById('form-lng').value = item.longitude;
  document.getElementById('form-status').value = item.statusOperasional;
  document.getElementById('form-kategori').value = item.kategoriAirMinum;
  document.getElementById('form-keterangan').value = item.keteranganAirMinum || '';
  document.getElementById('form-catatan').value = item.catatanData || '';

  // Update badge & title
  document.getElementById('form-heading-title').textContent = `Edit Titik: ${item.nodeId}`;
  document.getElementById('form-mode-badge').textContent = 'EDIT MODE';
  document.getElementById('form-mode-badge').className = 'px-3 py-1 rounded-full bg-amber-100 text-amber-900 font-bold text-xs';
  document.getElementById('btn-save-text').textContent = 'Simpan Perubahan';
}

function populateFormForEditById(id) {
  const item = allFacilities.find((f) => f.id === id);
  if (item) {
    populateFormForEdit(item);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

/**
 * Reset Form to New Node Mode
 */
function resetFormToNew() {
  currentEditingId = null;
  document.getElementById('crud-form').reset();
  document.getElementById('form-id').value = '';

  const nextNum = allFacilities.length + 1;
  const padded = String(nextNum).padStart(3, '0');
  document.getElementById('form-node-id').value = `BDG-WATER-${padded}`;
  document.getElementById('form-lat').value = '-6.914744';
  document.getElementById('form-lng').value = '107.609810';

  document.getElementById('form-heading-title').textContent = 'Tambah Titik Fasilitas Baru';
  document.getElementById('form-mode-badge').textContent = 'NEW MODE';
  document.getElementById('form-mode-badge').className = 'px-3 py-1 rounded-full bg-primary-fixed text-on-primary-fixed-variant font-bold text-xs';
  document.getElementById('btn-save-text').textContent = 'Tambah Fasilitas Air';
}

/**
 * Form Submit (Create or Update)
 */
async function handleFormSubmit(e) {
  e.preventDefault();

  const payload = {
    nodeId: document.getElementById('form-node-id').value,
    wilayah: document.getElementById('form-wilayah').value,
    jenisFasilitas: document.getElementById('form-jenis').value,
    pengelola: document.getElementById('form-pengelola').value,
    latitude: parseFloat(document.getElementById('form-lat').value),
    longitude: parseFloat(document.getElementById('form-lng').value),
    statusOperasional: document.getElementById('form-status').value,
    kategoriAirMinum: document.getElementById('form-kategori').value,
    keteranganAirMinum: document.getElementById('form-keterangan').value,
    catatanData: document.getElementById('form-catatan').value
  };

  const isEdit = currentEditingId !== null;
  const url = isEdit ? `/api/fasilitas/${currentEditingId}` : '/api/fasilitas';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const json = await res.json();

    if (json.success) {
      showToast(isEdit ? 'Titik air berhasil diperbarui!' : 'Titik air baru berhasil ditambahkan!', 'success');
      await refreshData();
      resetFormToNew();
    } else {
      showToast(json.message || 'Gagal menyimpan data', 'error');
    }
  } catch (err) {
    console.error('Error submitting form:', err);
    showToast('Terjadi kesalahan jaringan', 'error');
  }
}

/**
 * Delete Facility
 */
async function confirmDeleteFacility(id, nodeId) {
  if (!confirm(`Apakah Anda yakin ingin menghapus data fasilitas ${nodeId}? Tindakan ini permanen.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/fasilitas/${id}`, { method: 'DELETE' });
    const json = await res.json();

    if (json.success) {
      showToast(`Titik ${nodeId} berhasil dihapus`, 'success');
      await refreshData();
    } else {
      showToast(json.message || 'Gagal menghapus titik', 'error');
    }
  } catch (err) {
    console.error('Error deleting facility:', err);
    showToast('Terjadi kesalahan koneksi', 'error');
  }
}

/**
 * Refresh All Data
 */
async function refreshData() {
  await loadStatistics();
  await loadFacilities();
  showToast('Data berhasil disinkronisasi', 'success');
}

/**
 * Export to CSV
 */
function exportToCSV() {
  if (allFacilities.length === 0) {
    showToast('Tidak ada data untuk diekspor', 'error');
    return;
  }

  const headers = ['No', 'Node_ID', 'Wilayah', 'Jenis_Fasilitas', 'Pengelola', 'Latitude', 'Longitude', 'Status_Operasional', 'Kategori_Air_Minum', 'Keterangan_Air_Minum', 'Catatan_Data'];
  const rows = allFacilities.map((f, idx) => [
    idx + 1,
    `"${f.nodeId || ''}"`,
    `"${f.wilayah || ''}"`,
    `"${f.jenisFasilitas || ''}"`,
    `"${f.pengelola || ''}"`,
    f.latitude,
    f.longitude,
    `"${f.statusOperasional || ''}"`,
    `"${f.kategoriAirMinum || ''}"`,
    `"${(f.keteranganAirMinum || '').replace(/"/g, '""')}"`,
    `"${(f.catatanData || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `caiKU_Titik_Air_Bandung_Raya_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('Ekspor CSV selesai diunduh', 'success');
}

/**
 * Get GPS Coordinates for Form
 */
function getCurrentLocationForForm() {
  if (!navigator.geolocation) {
    showToast('Geolocation tidak didukung browser ini', 'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById('form-lat').value = pos.coords.latitude.toFixed(6);
      document.getElementById('form-lng').value = pos.coords.longitude.toFixed(6);
      showToast('Koordinat GPS berhasil disematkan ke formulir', 'success');
    },
    (err) => {
      showToast('Gagal mengambil GPS: ' + err.message, 'error');
    }
  );
}

/**
 * Toast Notification Utility
 */
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-msg');
  const toastIcon = document.getElementById('toast-icon');

  toastMsg.textContent = message;

  if (type === 'success') {
    toastIcon.textContent = 'check_circle';
    toastIcon.className = 'material-symbols-outlined text-[18px] text-emerald-400';
  } else if (type === 'error') {
    toastIcon.textContent = 'error';
    toastIcon.className = 'material-symbols-outlined text-[18px] text-rose-400';
  } else {
    toastIcon.textContent = 'info';
    toastIcon.className = 'material-symbols-outlined text-[18px] text-sky-400';
  }

  toast.classList.remove('translate-y-20', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 3500);
}

/**
 * Setup Event Listeners for Filters
 */
function setupEventListeners() {
  const geoSearchInput = document.getElementById('geoSearchInput');
  if (geoSearchInput) {
    geoSearchInput.addEventListener('input', applyMapFilters);
  }

  const filterWilayah = document.getElementById('filterWilayah');
  if (filterWilayah) {
    filterWilayah.addEventListener('change', applyMapFilters);
  }

  const filterFasilitas = document.getElementById('filterFasilitas');
  if (filterFasilitas) {
    filterFasilitas.addEventListener('change', applyMapFilters);
  }
}

// ============================================================================
// 🧭 IN-APP NAVIGATION & LIVE TRACKING ENGINE (No External GMaps Required)
// ============================================================================

/**
 * Triggered from Drawer: Starts navigation from user's location to the active water node
 */
function startNavigationToActiveNode() {
  if (!activeNode) {
    showToast('Pilih titik fasilitas air terlebih dahulu', 'error');
    return;
  }

  // If user GPS coords are already cached, route directly
  if (currentUserCoords) {
    calculateAndRenderRoute(
      currentUserCoords,
      [activeNode.latitude, activeNode.longitude],
      activeNode,
      '📍 Lokasi GPS Saya'
    );
    return;
  }

  // Otherwise, request current GPS location
  if (navigator.geolocation) {
    showToast('Mendeteksi posisi GPS Anda untuk membuat rute...', 'info');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        currentUserCoords = [pos.coords.latitude, pos.coords.longitude];
        calculateAndRenderRoute(
          currentUserCoords,
          [activeNode.latitude, activeNode.longitude],
          activeNode,
          '📍 Lokasi GPS Saya'
        );
      },
      (err) => {
        console.warn('GPS failed/denied, falling back to Bandung center:', err.message);
        showToast('Izin GPS ditolak atau tidak aktif. Menggunakan titik awal Bandung Kota.', 'info');
        currentUserCoords = BANDUNG_CENTER;
        calculateAndRenderRoute(
          BANDUNG_CENTER,
          [activeNode.latitude, activeNode.longitude],
          activeNode,
          '🏛️ Pusat Kota Bandung (Alun-Alun)'
        );
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  } else {
    currentUserCoords = BANDUNG_CENTER;
    calculateAndRenderRoute(
      BANDUNG_CENTER,
      [activeNode.latitude, activeNode.longitude],
      activeNode,
      '🏛️ Pusat Kota Bandung (Alun-Alun)'
    );
  }
}

/**
 * Re-fetch GPS location and re-calculate the active route
 */
function recalculateRouteFromGPS() {
  if (!activeNode) return;
  if (!navigator.geolocation) {
    showToast('Geolocation tidak didukung browser', 'error');
    return;
  }

  showToast('Memperbarui koordinat GPS...', 'info');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentUserCoords = [pos.coords.latitude, pos.coords.longitude];
      calculateAndRenderRoute(
        currentUserCoords,
        [activeNode.latitude, activeNode.longitude],
        activeNode,
        '📍 Posisi GPS Terkini'
      );
    },
    (err) => {
      showToast('Gagal memperbarui GPS: ' + err.message, 'error');
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

/**
 * Fetch route from internal API and draw polyline + turn-by-turn guidance
 */
async function calculateAndRenderRoute(startCoords, destCoords, targetNode, originLabel = '📍 Lokasi GPS') {
  try {
    showToast('Menghitung rute navigasi terbaik...', 'info');

    const apiUrl = `/api/route?startLat=${startCoords[0]}&startLng=${startCoords[1]}&endLat=${destCoords[0]}&endLng=${destCoords[1]}`;
    const res = await fetch(apiUrl);
    const json = await res.json();

    if (!json.success || !json.data) {
      showToast('Gagal memproses rute navigasi: ' + (json.message || 'Coba lagi nanti'), 'error');
      return;
    }

    // Reset previous route from map
    clearRouteNavigation(false);

    activeRouteData = json.data;
    const coords = activeRouteData.coordinates;

    // Create a new Leaflet FeatureGroup for the route
    currentRouteGroup = L.featureGroup().addTo(map);

    // 1. Soft Outer Glow Polyline
    L.polyline(coords, {
      color: '#007bb9',
      weight: 9,
      opacity: 0.45,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(currentRouteGroup);

    // 2. Primary Route Polyline (Glow effect via CSS)
    L.polyline(coords, {
      color: '#006194',
      weight: 5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round',
      className: 'route-glow-path'
    }).addTo(currentRouteGroup);

    // 3. Origin Start Marker
    const startIcon = L.divIcon({
      html: `
        <div class="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-600 text-white text-[11px] font-bold shadow-lg border-2 border-white whitespace-nowrap">
          <span class="w-2 h-2 rounded-full bg-white animate-pulse"></span>
          <span>${originLabel}</span>
        </div>
      `,
      className: '',
      iconSize: [140, 30],
      iconAnchor: [70, 15]
    });
    L.marker(startCoords, { icon: startIcon }).addTo(currentRouteGroup);

    // 4. Destination Flag Marker
    const destIcon = L.divIcon({
      html: `
        <div class="flex flex-col items-center">
          <div class="px-2.5 py-0.5 rounded-full bg-primary text-white text-[10px] font-bold shadow-md border border-white whitespace-nowrap mb-0.5">
            Tujuan: ${targetNode.nodeId}
          </div>
          <div class="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center shadow-xl border-2 border-white ring-2 ring-primary/40">
            <span class="material-symbols-outlined text-[20px]">sports_score</span>
          </div>
        </div>
      `,
      className: '',
      iconSize: [120, 56],
      iconAnchor: [60, 52]
    });
    L.marker(destCoords, { icon: destIcon }).addTo(currentRouteGroup);

    // Fit map view to bounds of the route with padding
    map.fitBounds(currentRouteGroup.getBounds(), {
      padding: [70, 70],
      maxZoom: 16
    });

    // Populate Floating Route Panel UI
    document.getElementById('route-origin-label').textContent = originLabel;
    document.getElementById('route-destination-label').textContent = `${targetNode.nodeId} • ${targetNode.jenisFasilitas}`;
    document.getElementById('route-distance-val').textContent = activeRouteData.distanceFormatted;
    document.getElementById('route-duration-val').textContent = activeRouteData.durationFormatted;
    document.getElementById('route-step-count').textContent = `${activeRouteData.steps.length} manuver`;

    // External GMaps link backup
    const gmapsLink = `https://www.google.com/maps/dir/?api=1&origin=${startCoords[0]},${startCoords[1]}&destination=${destCoords[0]},${destCoords[1]}`;
    const routeGmaps = document.getElementById('route-gmaps-link');
    if (routeGmaps) routeGmaps.href = gmapsLink;

    // Render turn-by-turn step list
    renderRouteSteps(activeRouteData.steps);

    // Close the detail drawer and open the route panel
    closeDrawer();
    openRoutePanel();

    showToast(`Rute aktif! Jarak ${activeRouteData.distanceFormatted} (${activeRouteData.durationFormatted})`, 'success');

  } catch (err) {
    console.error('Route calculation error:', err);
    showToast('Terjadi kesalahan saat membuat rute: ' + err.message, 'error');
  }
}

/**
 * Render turn-by-turn navigation steps into panel
 */
function renderRouteSteps(steps) {
  const container = document.getElementById('route-steps-list');
  if (!container) return;

  if (!steps || steps.length === 0) {
    container.innerHTML = `
      <div class="p-4 text-center text-on-surface-variant text-xs">
        Tidak ada data langkah rute terperinci.
      </div>
    `;
    return;
  }

  const maneuverIcons = {
    'depart': 'trip_origin',
    'arrive': 'flag',
    'turn_left': 'turn_left',
    'turn_right': 'turn_right',
    'turn_slight_left': 'turn_slight_left',
    'turn_slight_right': 'turn_slight_right',
    'turn_sharp_left': 'turn_sharp_left',
    'turn_sharp_right': 'turn_sharp_right',
    'roundabout': 'roundabout_right',
    'rotary': 'roundabout_right',
    'uturn': 'u_turn_left',
    'straight': 'straight'
  };

  container.innerHTML = steps.map((step, idx) => {
    let iconKey = step.type;
    if (step.modifier && (step.type === 'turn' || step.type === 'end of road')) {
      iconKey = `turn_${step.modifier.replace(' ', '_')}`;
    }
    const iconName = maneuverIcons[iconKey] || (step.type === 'arrive' ? 'sports_score' : 'straight');

    const isFirst = idx === 0;
    const isLast = idx === steps.length - 1;

    const locParam = step.location ? `${step.location[0]}, ${step.location[1]}` : null;
    const clickHandler = locParam ? `onclick="flyToRouteStep(${locParam}, ${step.stepNumber})"` : '';

    return `
      <div ${clickHandler} class="p-2.5 rounded-xl bg-surface-container-low hover:bg-surface-container border border-surface-container flex items-start gap-2.5 cursor-pointer transition-colors group">
        <div class="w-7 h-7 rounded-lg ${isFirst ? 'bg-emerald-600 text-white' : isLast ? 'bg-primary text-white' : 'bg-surface-container-high text-primary'} flex items-center justify-center shrink-0 mt-0.5 shadow-sm group-hover:scale-105 transition-transform">
          <span class="material-symbols-outlined text-[17px]">${iconName}</span>
        </div>
        <div class="flex flex-col flex-1 min-w-0">
          <span class="font-bold text-xs text-on-surface leading-tight group-hover:text-primary transition-colors">
            ${step.instruction}
          </span>
          <div class="flex items-center gap-2 mt-1 text-[11px] text-on-surface-variant font-medium">
            <span class="truncate">${step.streetName}</span>
            <span class="text-outline">•</span>
            <span class="font-semibold text-primary shrink-0">${step.distanceText}</span>
          </div>
        </div>
        <span class="text-[10px] font-mono text-outline font-bold mt-1">#${step.stepNumber}</span>
      </div>
    `;
  }).join('');
}

/**
 * Click on step in panel to fly directly to that turn on map
 */
function flyToRouteStep(lat, lng, stepNumber) {
  if (lat && lng) {
    map.flyTo([lat, lng], 17, { duration: 1 });
    showToast(`Langkah #${stepNumber} pada rute`, 'info');
  }
}

/**
 * Zoom to fit entire route
 */
function zoomToActiveRoute() {
  if (currentRouteGroup) {
    map.fitBounds(currentRouteGroup.getBounds(), {
      padding: [70, 70],
      maxZoom: 16
    });
    showToast('Peta dipusatkan ke seluruh bentang rute', 'info');
  }
}

/**
 * Open & Close Route Panel
 */
function openRoutePanel() {
  const panel = document.getElementById('route-panel');
  if (panel) {
    panel.classList.remove('route-panel-closed');
    panel.classList.add('route-panel-open');
  }
}

function closeRoutePanel() {
  const panel = document.getElementById('route-panel');
  if (panel) {
    panel.classList.remove('route-panel-open');
    panel.classList.add('route-panel-closed');
  }
}

/**
 * Clear the current active route and stop tracking simulation
 */
function clearRouteNavigation(reopenDrawer = true) {
  // Stop simulation
  if (routeSimulationInterval) {
    clearInterval(routeSimulationInterval);
    routeSimulationInterval = null;
  }
  isSimulatingRoute = false;

  const simBtnLabel = document.getElementById('sim-btn-label');
  const simBtnIcon = document.getElementById('sim-btn-icon');
  if (simBtnLabel) simBtnLabel.textContent = 'Simulasi Perjalanan';
  if (simBtnIcon) simBtnIcon.textContent = 'play_arrow';

  // Remove simulation marker
  if (simulationMarker && map) {
    map.removeLayer(simulationMarker);
    simulationMarker = null;
  }

  // Remove route polyline & markers group
  if (currentRouteGroup && map) {
    map.removeLayer(currentRouteGroup);
    currentRouteGroup = null;
  }

  activeRouteData = null;
  simulationCoordIndex = 0;

  // Close panel
  closeRoutePanel();

  if (reopenDrawer && activeNode) {
    openDrawer(activeNode);
  }
}

/**
 * Live GPS Simulation: Animates a vehicle moving along the route coordinates in real-time
 */
function toggleRouteSimulation() {
  if (!activeRouteData || !activeRouteData.coordinates || activeRouteData.coordinates.length === 0) {
    showToast('Tidak ada rute aktif untuk disimulasikan', 'error');
    return;
  }

  const coords = activeRouteData.coordinates;
  const simBtnLabel = document.getElementById('sim-btn-label');
  const simBtnIcon = document.getElementById('sim-btn-icon');

  if (isSimulatingRoute) {
    // Pause simulation
    clearInterval(routeSimulationInterval);
    routeSimulationInterval = null;
    isSimulatingRoute = false;
    if (simBtnLabel) simBtnLabel.textContent = 'Lanjutkan Simulasi';
    if (simBtnIcon) simBtnIcon.textContent = 'play_arrow';
    showToast('Simulasi perjalanan dijeda', 'info');
    return;
  }

  // Start simulation
  isSimulatingRoute = true;
  if (simBtnLabel) simBtnLabel.textContent = 'Jeda Simulasi';
  if (simBtnIcon) simBtnIcon.textContent = 'pause';

  if (!simulationMarker) {
    const vehicleIcon = L.divIcon({
      html: `
        <div class="sim-vehicle-marker flex items-center justify-center w-9 h-9 rounded-full bg-primary text-white shadow-2xl border-2 border-white ring-4 ring-primary/30">
          <span class="material-symbols-outlined text-[20px] transform rotate-45">navigation</span>
        </div>
      `,
      className: '',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
    simulationMarker = L.marker(coords[simulationCoordIndex], { icon: vehicleIcon, zIndexOffset: 1000 }).addTo(map);
  }

  showToast('Memulai simulasi tracking kendaraan di sepanjang rute...', 'info');

  // Move vehicle along coordinates array
  routeSimulationInterval = setInterval(() => {
    if (simulationCoordIndex >= coords.length - 1) {
      clearInterval(routeSimulationInterval);
      routeSimulationInterval = null;
      isSimulatingRoute = false;
      simulationCoordIndex = 0;
      if (simBtnLabel) simBtnLabel.textContent = 'Ulangi Simulasi';
      if (simBtnIcon) simBtnIcon.textContent = 'replay';
      showToast('🎉 Anda telah tiba di lokasi fasilitas air!', 'success');
      return;
    }

    simulationCoordIndex++;
    const currentPos = coords[simulationCoordIndex];

    if (simulationMarker) {
      simulationMarker.setLatLng(currentPos);
    }

    // Keep map centered on vehicle every 5 steps
    if (simulationCoordIndex % 5 === 0) {
      map.panTo(currentPos, { animate: true, duration: 0.3 });
    }
  }, 100); // 100ms per coordinate step
}

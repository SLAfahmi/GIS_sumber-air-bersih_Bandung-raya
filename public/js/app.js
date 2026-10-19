/**
 * caiKU - GIS Air Bersih Pulau Jawa
 * Bootstrap aplikasi, sinkronisasi data, dan navigasi antar tampilan
 */
let currentView = 'map';
let hasFittedInitialView = false;

document.addEventListener('DOMContentLoaded', async () => {
  loadStoredAuth();
  renderAuthUI();
  initMap();
  initCrudForm();
  bindGlobalShortcuts();

  await Promise.all([loadMasterData(), syncData()]);
  setTimeout(openNodeFromUrl, 300);
  if (state.auth) verifySession();
});

async function loadMasterData() {
  try {
    const [wilayahRes, pengelolaRes] = await Promise.all([api('/wilayah'), api('/pengelola')]);
    state.wilayahList = wilayahRes.data;
    state.pengelolaList = pengelolaRes.data;
    populateFormSelects();
    populateMapFilterOptions();
  } catch (err) {
    console.error('Failed to load master data:', err);
    showToast('Gagal memuat data wilayah & pengelola', 'error');
  }
}

/**
 * Ambil statistik & seluruh titik, lalu perbarui peta, KPI, dan tabel
 */
async function syncData() {
  try {
    const [statsRes, fasilitasRes] = await Promise.all([api('/stats'), api('/fasilitas')]);
    state.stats = statsRes.data;
    setFacilities(fasilitasRes.data);

    // Objek titik yang sedang dibuka diganti dengan versi terbaru
    if (activeNode) {
      const fresh = state.facilityById.get(activeNode.id);
      if (!fresh) {
        closeDrawer();
      } else {
        activeNode = fresh;
        if ($('node-drawer').classList.contains('panel-open')) renderDrawer(fresh);
      }
    }

    renderStats();
    populateMapFilterOptions();
    applyMapFilters();
    refreshSuggestedNodeId();
    renderMinimapReferencePoints();
    updateInventoryTable();
    setSyncStatus(true);

    if (!hasFittedInitialView && !new URLSearchParams(location.search).has('node')) {
      hasFittedInitialView = true;
      // Tunggu layout stabil (CSS Tailwind CDN) sebelum menghitung zoom awal
      setTimeout(() => fitMapToFacilities(state.facilities, { animate: false }), 300);
    }
    return true;
  } catch (err) {
    console.error('Failed to sync data:', err);
    setSyncStatus(false);
    showToast('Gagal memuat data dari server', 'error');
    return false;
  }
}

/**
 * Tombol "Sinkronisasi": muat ulang data dari server
 */
async function refreshData() {
  const btn = $('btn-sync');
  btn.disabled = true;
  const ok = await syncData();
  btn.disabled = false;
  if (ok) showToast('Data berhasil disinkronisasi', 'success');
}

function formatPercentage(value, total) {
  return `(${total ? Math.round((value / total) * 100) : 0}%)`;
}

function kpiKategoriCard(kategori, value, total) {
  const meta = kategoriMeta(kategori);
  return `
    <div class="card p-5 flex items-center justify-between gap-3" data-kpi-kategori>
      <div class="flex flex-col min-w-0">
        <span class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${meta.accentText}">
          <span class="w-2 h-2 rounded-full shrink-0" style="background:${meta.color}"></span>${escapeHtml(meta.label)}
        </span>
        <div class="flex items-baseline gap-1 mt-1">
          <span class="font-heading font-extrabold text-2xl text-on-surface tabular">${value}</span>
          <span class="text-xs font-bold ${meta.accentText}">${formatPercentage(value, total)}</span>
        </div>
      </div>
      <div class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${meta.badge}">
        <span class="material-symbols-outlined text-[26px]">${meta.icon}</span>
      </div>
    </div>`;
}

function renderStats() {
  const stats = state.stats;
  if (!stats) return;

  $('telemetry-total').textContent = stats.total;
  $('telemetry-normal').textContent = `${stats.normal} Normal`;
  $('telemetry-maintenance').textContent = `${stats.pemeliharaan + stats.rusak} Pemeliharaan/Rusak`;

  $('kpi-total').textContent = stats.total;
  $('kpi-total-note').textContent = `${stats.jumlahWilayah} kab/kota di ${stats.jumlahProvinsi} provinsi`;

  // Kartu total tetap, kartu per kategori dibangun ulang dari KATEGORI_META
  const grid = $('kpi-grid');
  grid.querySelectorAll('[data-kpi-kategori]').forEach((card) => card.remove());
  grid.insertAdjacentHTML('beforeend', Object.keys(KATEGORI_META)
    .map((kategori) => kpiKategoriCard(kategori, stats.byKategori?.[kategori] || 0, stats.total))
    .join(''));
}

function setSyncStatus(ok) {
  const now = new Date();
  $('sync-dot').className = `w-2 h-2 rounded-full ${ok ? 'bg-tertiary animate-pulse' : 'bg-error'}`;
  $('sync-label').className = `font-bold ${ok ? 'text-tertiary' : 'text-error'}`;
  $('sync-label').textContent = ok ? 'Live Terhubung' : 'Terputus';
  $('sync-pill').title = ok ? `Sinkronisasi terakhir ${formatDate(now, { withTime: true })}` : 'Server tidak dapat dihubungi';

  $('sync-badge').className = `px-2 py-0.5 rounded-md font-bold ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-error-container text-on-error-container'}`;
  $('sync-badge').textContent = ok ? `Tersinkronisasi ${timeFormatter.format(now)}` : 'Gagal sinkronisasi';
}

/**
 * Switch View (Map <-> CRUD). Modul CRUD hanya untuk petugas.
 */
function switchView(viewName) {
  if (viewName === 'crud' && !isLoggedIn()) {
    requireLogin(() => switchView('crud'), 'Login sebagai petugas untuk membuka modul Update Titik Air.');
    return;
  }

  currentView = viewName;
  const isMap = viewName === 'map';

  $('view-map').classList.toggle('hidden', !isMap);
  setVisible('view-crud', !isMap);
  $('nav-btn-map').classList.toggle('is-active', isMap);
  $('nav-btn-crud').classList.toggle('is-active', !isMap);
  toggleSidebar(false);

  if (isMap) {
    setTimeout(() => map.invalidateSize(), 150);
  } else {
    ensureFormMinimap();
    updateInventoryTable();
    window.scrollTo({ top: 0 });
  }
}

/**
 * Sidebar off-canvas untuk layar kecil
 */
function toggleSidebar(open) {
  $('sidebar').classList.toggle('-translate-x-full', !open);
  $('sidebar-backdrop').classList.toggle('hidden', !open);
}

function bindGlobalShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isModalOpen('modal-confirm')) resolveConfirm(false);
      else if (isModalOpen('modal-login')) closeLoginModal();
      else if (!$('sidebar-backdrop').classList.contains('hidden')) toggleSidebar(false);
      else if (currentView === 'map' && $('node-drawer').classList.contains('panel-open')) closeDrawer();
      return;
    }

    // "/" untuk langsung mencari di peta
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (e.key === '/' && !typing && currentView === 'map') {
      e.preventDefault();
      $('geoSearchInput').focus();
    }
  });
}

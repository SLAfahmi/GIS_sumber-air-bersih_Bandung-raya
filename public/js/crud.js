/**
 * Modul Update & Manajemen Titik Air: formulir CRUD + peta mini, tabel katalog,
 * log perubahan, serta ekspor data
 */
let currentEditingId = null;
let lastSuggestedNodeId = '';
let formMinimap = null;
let formMinimapMarker = null;
let formMinimapPoints = null;
let historyRequestId = 0;

let tableCurrentPage = 1;
const TABLE_PAGE_SIZE = 8;
let tableFilteredList = [];
let tableActiveKategori = 'all';

const NEW_PENGELOLA_VALUE = '__new__';
// Titik sejenis yang lebih dekat dari ini kemungkinan duplikat
const DUPLICATE_RADIUS_KM = 0.06;

// Kolom ekspor mengikuti urutan kolom xlsx sumber data
const EXPORT_HEADER = [
  'No', 'Node_ID', 'Kategori', 'Jenis_Fasilitas', 'Nama', 'Desa_Kelurahan', 'Kecamatan', 'Wilayah', 'Provinsi',
  'Latitude', 'Longitude', 'Alamat', 'Pengelola', 'Wilayah_Layanan', 'Status_Operasional', 'Status_Verifikasi',
  'Catatan', 'Sumber_Data', 'Link_Google_Maps'
];
const LAT_LNG_COLUMNS = [EXPORT_HEADER.indexOf('Latitude'), EXPORT_HEADER.indexOf('Longitude')];

function initCrudForm() {
  $('form-lat').addEventListener('change', () => syncMinimapFromInputs());
  $('form-lng').addEventListener('change', () => syncMinimapFromInputs());
  $('form-pengelola').addEventListener('change', updateNewPengelolaField);

  $('inventory-table-body').addEventListener('click', handleTableAction);
  $('table-pages').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (btn) goToTablePage(Number(btn.dataset.page));
  });
  $('table-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-kategori]');
    if (tab) setTableKategori(tab.dataset.kategori);
  });

  $('tableFilterStatus').innerHTML = '<option value="all">Semua Status Operasi</option>' +
    Object.keys(STATUS_META).map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  $('form-jenis').innerHTML = JENIS_FASILITAS.map((j) => `<option value="${escapeHtml(j.value)}">${escapeHtml(j.value)}</option>`).join('');
  $('form-verifikasi').innerHTML = '<option value="">Belum diisi</option>' +
    Object.keys(STATUS_VERIFIKASI_META).map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  renderKategoriOptions();

  resetFormToNew();
}

// Pilihan kategori di formulir & tab tabel dibangun dari KATEGORI_META
function renderKategoriOptions() {
  $('form-kategori-options').innerHTML = Object.entries(KATEGORI_META).map(([kategori, meta], i) => `
    <label class="radio-card">
      <input type="radio" name="kategori" value="${escapeHtml(kategori)}"${i === 0 ? ' required' : ''} class="mt-0.5 accent-[#006194]">
      <span class="flex flex-col gap-0.5">
        <span class="px-1.5 py-0.5 rounded font-bold text-[11px] self-start ${meta.badge}">${escapeHtml(meta.label)}</span>
        <span class="text-[11px] text-on-surface-variant leading-snug">${escapeHtml(meta.deskripsi)}</span>
      </span>
    </label>`).join('');

  const tab = (kategori, label) =>
    `<button type="button" class="table-tab px-3 py-1.5 rounded-lg text-xs font-bold text-on-surface-variant transition-colors" data-kategori="${escapeHtml(kategori)}">${escapeHtml(label)} (<span data-count>0</span>)</button>`;
  $('table-tabs').innerHTML = tab('all', 'Semua') +
    Object.entries(KATEGORI_META).map(([kategori, meta]) => tab(kategori, meta.label)).join('');
}

// Dropdown wilayah & pengelola diisi dari master data API
function populateFormSelects() {
  const formWilayah = $('form-wilayah');
  const formPengelola = $('form-pengelola');
  const prev = { wilayah: formWilayah.value, pengelola: formPengelola.value };

  formWilayah.innerHTML = wilayahOptgroups(state.wilayahList, { value: (w) => w.id, label: (w) => w.nama });
  formPengelola.innerHTML = state.pengelolaList.map((p) => `<option value="${p.id}">${escapeHtml(p.nama)}</option>`).join('') +
    `<option value="${NEW_PENGELOLA_VALUE}">+ Tambah pengelola baru...</option>`;
  fillProvinsiFilter($('tableFilterProvinsi'));
  fillWilayahFilter($('tableFilterWilayah'), $('tableFilterProvinsi').value);

  const restore = (select, value) => {
    if (value && [...select.options].some((o) => o.value === value)) select.value = value;
  };
  restore(formWilayah, prev.wilayah);
  if (prev.pengelola && prev.pengelola !== NEW_PENGELOLA_VALUE) restore(formPengelola, prev.pengelola);
  else setDefaultPengelola();
  updateNewPengelolaField();
}

function setDefaultPengelola() {
  const select = $('form-pengelola');
  if (select.options.length) select.selectedIndex = 0;
}

function updateNewPengelolaField() {
  const isNew = $('form-pengelola').value === NEW_PENGELOLA_VALUE;
  const input = $('form-pengelola-baru');
  input.classList.toggle('hidden', !isNew);
  input.required = isNew;
  if (isNew) input.focus();
}

function ensureSelectOption(select, value) {
  if (value && ![...select.options].some((o) => o.value === value)) {
    select.add(new Option(value, value));
  }
}

function setRadio(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((radio) => {
    radio.checked = radio.value === value;
  });
}

function getRadio(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value;
}

function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// ============================================================================
// Peta mini untuk memilih koordinat
// ============================================================================
function readFormCoords() {
  const lat = parseFloat($('form-lat').value);
  const lng = parseFloat($('form-lng').value);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

function ensureFormMinimap() {
  if (formMinimap) {
    setTimeout(() => formMinimap.invalidateSize(), 150);
    return;
  }

  const start = readFormCoords() || JAWA_CENTER;
  formMinimap = L.map('form-minimap', { attributionControl: false, scrollWheelZoom: false }).setView(start, 14);
  L.tileLayer(BASE_LAYERS[0].url, BASE_LAYERS[0].options).addTo(formMinimap);

  // Titik lain sebagai acuan agar tidak menambah titik ganda
  formMinimapPoints = L.layerGroup().addTo(formMinimap);

  formMinimapMarker = L.marker(start, {
    draggable: true,
    zIndexOffset: 1000,
    icon: L.divIcon({ html: '<span class="form-pin"></span>', className: 'geo-marker', iconSize: [24, 24], iconAnchor: [12, 12] })
  }).addTo(formMinimap);
  formMinimapMarker.on('dragend', () => setFormCoords(formMinimapMarker.getLatLng(), { pan: false }));
  formMinimap.on('click', (e) => setFormCoords(e.latlng));

  renderMinimapReferencePoints();
  setTimeout(() => formMinimap.invalidateSize(), 150);
}

function renderMinimapReferencePoints() {
  if (!formMinimapPoints) return;
  formMinimapPoints.clearLayers();
  state.facilities.filter((f) => f.id !== currentEditingId && hasCoords(f)).forEach((f) => {
    L.circleMarker([f.latitude, f.longitude], {
      radius: 4,
      color: '#ffffff',
      weight: 1.5,
      fillColor: kategoriMeta(f.kategori).color,
      fillOpacity: 0.85
    })
      .bindTooltip(`${escapeHtml(f.nodeId)} · ${escapeHtml(facilityTitle(f))}`, { direction: 'top', className: 'geo-tooltip' })
      .addTo(formMinimapPoints);
  });
}

function setFormCoords(latlng, { pan = true } = {}) {
  $('form-lat').value = latlng.lat.toFixed(6);
  $('form-lng').value = latlng.lng.toFixed(6);
  syncMinimapFromInputs({ pan });
}

function syncMinimapFromInputs({ pan = true } = {}) {
  const coords = readFormCoords();
  updateLocationHint(coords);
  if (!coords || !formMinimap) return;
  formMinimapMarker.setLatLng(coords);
  if (pan) formMinimap.panTo(coords);
}

function updateLocationHint(coords) {
  const hint = $('form-location-hint');
  const setHint = (text, color) => {
    hint.textContent = text;
    hint.className = `text-[11px] ${color}`;
  };

  if (!coords) {
    setHint('Masukkan latitude & longitude yang valid.', 'text-error');
    return;
  }
  if (!isInsideJawa(coords[0], coords[1])) {
    setHint('Koordinat berada di luar cakupan Pulau Jawa.', 'text-amber-700 font-semibold');
    return;
  }

  const others = state.facilities.filter((f) => f.id !== currentEditingId);
  const nearest = findNearestFacility(coords[0], coords[1], others);
  if (nearest && nearest.distance < DUPLICATE_RADIUS_KM) {
    setHint(`Ada ${nearest.item.nodeId} (${facilityTitle(nearest.item)}) berjarak ${formatDistance(nearest.distance)}. Pastikan bukan titik ganda.`, 'text-amber-700 font-semibold');
    return;
  }
  setHint('Klik peta atau geser pin untuk menentukan titik.', 'text-on-surface-variant');
}

function getCurrentLocationForForm() {
  if (!navigator.geolocation) {
    showToast('Geolocation tidak didukung browser ini', 'error');
    return;
  }
  showToast('Mengambil koordinat GPS...', 'info');
  getCurrentPositionAsync({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 })
    .then((pos) => {
      setFormCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      formMinimap?.setView([pos.coords.latitude, pos.coords.longitude], 17);
      showToast(`Koordinat GPS disematkan (akurasi ±${Math.round(pos.coords.accuracy)} m)`, 'success');
    })
    .catch((err) => showToast(geolocationErrorMessage(err), 'error'));
}

// ============================================================================
// Formulir tambah / edit
// ============================================================================
function suggestNextNodeId() {
  const pattern = new RegExp(`^${NODE_ID_PREFIX}(\\d+)$`, 'i');
  const numbers = state.facilities
    .map((f) => pattern.exec(f.nodeId))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  return `${NODE_ID_PREFIX}${String(next).padStart(3, '0')}`;
}

// Perbarui saran Node ID tanpa menimpa ID yang diketik petugas
function refreshSuggestedNodeId() {
  if (currentEditingId !== null) return;
  const input = $('form-node-id');
  if (input.value && input.value !== lastSuggestedNodeId) return;
  lastSuggestedNodeId = suggestNextNodeId();
  input.value = lastSuggestedNodeId;
}

function setFormMode(mode, nodeId = '') {
  const isEdit = mode === 'edit';
  $('form-heading-title').textContent = isEdit ? `Edit Titik: ${nodeId}` : 'Tambah Titik Fasilitas Baru';
  $('form-mode-badge').textContent = isEdit ? 'MODE EDIT' : 'TITIK BARU';
  $('form-mode-badge').className = `px-3 py-1 rounded-full font-bold text-[11px] shrink-0 ${isEdit ? 'bg-amber-100 text-amber-900' : 'bg-primary-fixed text-on-primary-fixed-variant'}`;
  $('btn-save-text').textContent = isEdit ? 'Simpan Perubahan' : 'Tambah Fasilitas Air';
  $('btn-save-icon').textContent = isEdit ? 'save' : 'add_location_alt';
}

function populateFormForEdit(item, { scroll = true } = {}) {
  currentEditingId = item.id;

  $('form-node-id').value = item.nodeId;
  $('form-nama').value = item.nama || '';
  $('form-wilayah').value = String(item.wilayahId);
  $('form-kecamatan').value = item.kecamatan || '';
  $('form-desa').value = item.desaKelurahan || '';
  $('form-wilayah-layanan').value = item.wilayahLayanan || '';
  $('form-alamat').value = item.alamat || '';
  ensureSelectOption($('form-jenis'), item.jenisFasilitas);
  $('form-jenis').value = item.jenisFasilitas;
  $('form-pengelola').value = String(item.pengelolaId);
  $('form-pengelola-baru').value = '';
  updateNewPengelolaField();
  $('form-lat').value = item.latitude.toFixed(6);
  $('form-lng').value = item.longitude.toFixed(6);
  setRadio('status', item.statusOperasional);
  setRadio('kategori', item.kategori);
  ensureSelectOption($('form-verifikasi'), item.statusVerifikasi);
  $('form-verifikasi').value = item.statusVerifikasi || '';
  $('form-gmaps').value = item.sumberUrl || '';
  $('form-catatan').value = item.catatanData || '';

  setFormMode('edit', item.nodeId);
  ensureFormMinimap();
  syncMinimapFromInputs({ pan: false });
  formMinimap?.setView([item.latitude, item.longitude], 16);
  renderMinimapReferencePoints();

  loadNodeHistory(item.id);
  updateInventoryTable();

  if (scroll) $('form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetFormToNew() {
  currentEditingId = null;
  historyRequestId++;

  $('crud-form').reset();
  lastSuggestedNodeId = '';
  $('form-node-id').value = '';
  refreshSuggestedNodeId();

  setDefaultPengelola();
  $('form-pengelola-baru').value = '';
  updateNewPengelolaField();
  // Titik baru dimulai dari tengah tampilan peta utama
  const center = map ? map.getCenter() : { lat: JAWA_CENTER[0], lng: JAWA_CENTER[1] };
  $('form-lat').value = center.lat.toFixed(6);
  $('form-lng').value = center.lng.toFixed(6);
  setRadio('status', 'Beroperasi Normal');
  setRadio('kategori', 'Perumda');
  $('form-verifikasi').value = '';

  setFormMode('new');
  setVisible('panel-node-history', false);

  syncMinimapFromInputs({ pan: false });
  formMinimap?.setView([center.lat, center.lng], 13);
  renderMinimapReferencePoints();
  updateInventoryTable();
}

function startNewFacility() {
  resetFormToNew();
  $('form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => $('form-nama').focus(), 300);
}

function setFormSaving(saving) {
  $('btn-save-form').disabled = saving;
  $('btn-save-icon').textContent = saving ? 'progress_activity' : (currentEditingId !== null ? 'save' : 'add_location_alt');
  $('btn-save-icon').classList.toggle('spin', saving);
}

async function resolvePengelolaId() {
  const select = $('form-pengelola');
  if (select.value !== NEW_PENGELOLA_VALUE) return Number(select.value);

  const nama = $('form-pengelola-baru').value.trim();
  const existing = state.pengelolaList.find((p) => p.nama.toLowerCase() === nama.toLowerCase());
  if (existing) return existing.id;

  const { data } = await api('/pengelola', { method: 'POST', body: { nama } });
  state.pengelolaList = [...state.pengelolaList, data].sort((a, b) => a.nama.localeCompare(b.nama));
  populateFormSelects();
  select.value = String(data.id);
  updateNewPengelolaField();
  return data.id;
}

/**
 * Form Submit (Create or Update)
 */
async function handleFormSubmit(event) {
  event.preventDefault();

  const coords = readFormCoords();
  if (!coords) {
    showToast('Koordinat tidak valid', 'error');
    return;
  }
  if (!isInsideJawa(coords[0], coords[1])) {
    const ok = await confirmDialog({
      title: 'Koordinat di luar Pulau Jawa',
      message: `Titik ${formatCoords(coords[0], coords[1])} berada di luar cakupan Pulau Jawa. Tetap simpan?`,
      confirmLabel: 'Tetap Simpan',
      icon: 'wrong_location'
    });
    if (!ok) return;
  }

  const isEdit = currentEditingId !== null;
  setFormSaving(true);

  try {
    const payload = {
      nodeId: $('form-node-id').value.trim(),
      nama: $('form-nama').value,
      wilayahId: Number($('form-wilayah').value),
      kecamatan: $('form-kecamatan').value,
      desaKelurahan: $('form-desa').value,
      alamat: $('form-alamat').value,
      wilayahLayanan: $('form-wilayah-layanan').value,
      pengelolaId: await resolvePengelolaId(),
      jenisFasilitas: $('form-jenis').value,
      latitude: coords[0],
      longitude: coords[1],
      statusOperasional: getRadio('status'),
      kategori: getRadio('kategori'),
      statusVerifikasi: $('form-verifikasi').value,
      sumberUrl: $('form-gmaps').value,
      catatanData: $('form-catatan').value
    };

    const json = await api(isEdit ? `/fasilitas/${currentEditingId}` : '/fasilitas', {
      method: isEdit ? 'PUT' : 'POST',
      body: payload
    });
    await syncData();

    if (isEdit) {
      showToast(json.changes ? `${json.data.nodeId} diperbarui (${json.changes} perubahan)` : 'Tidak ada perubahan data', json.changes ? 'success' : 'info');
      const fresh = state.facilityById.get(json.data.id);
      if (fresh) populateFormForEdit(fresh, { scroll: false });
    } else {
      showToast(`Titik ${json.data.nodeId} berhasil ditambahkan`, 'success');
      resetFormToNew();
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setFormSaving(false);
  }
}

/**
 * Delete Facility
 */
async function confirmDeleteFacility(id) {
  const item = state.facilityById.get(id);
  if (!item) return;

  const ok = await confirmDialog({
    title: `Hapus ${item.nodeId}?`,
    message: `${facilityTitle(item)} beserta log perubahannya akan dihapus permanen.`,
    confirmLabel: 'Hapus Permanen',
    danger: true
  });
  if (!ok) return;

  try {
    await api(`/fasilitas/${id}`, { method: 'DELETE' });
    if (currentEditingId === id) resetFormToNew();
    if (activeNode?.id === id) closeDrawer();
    if (activeRouteTarget?.id === id) clearRouteNavigation({ reopenDrawer: false });
    await syncData();
    showToast(`Titik ${item.nodeId} berhasil dihapus`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// Log perubahan (mode edit)
// ============================================================================
function listPlaceholder(text, color = 'text-on-surface-variant') {
  return `<li class="text-[11px] ${color} p-3 rounded-xl border border-dashed border-outline-variant">${text}</li>`;
}

async function loadNodeHistory(id) {
  const requestId = ++historyRequestId;
  setVisible('panel-node-history', true);
  $('history-node-label').textContent = state.facilityById.get(id)?.nodeId || '';
  $('log-list').innerHTML = listPlaceholder('Memuat riwayat perubahan...');

  try {
    const { data } = await api(`/fasilitas/${id}`);
    if (requestId !== historyRequestId) return;
    renderLogList(data.logPembaruan || []);
  } catch (err) {
    if (requestId !== historyRequestId) return;
    $('log-list').innerHTML = listPlaceholder(escapeHtml(err.message), 'text-error');
  }
}

function renderLogList(logs) {
  if (logs.length === 0) {
    $('log-list').innerHTML = listPlaceholder('Belum ada perubahan sejak data diimpor.');
    return;
  }

  $('log-list').innerHTML = logs.map((log) => {
    const label = LOG_FIELD_LABEL[log.fieldDiubah] || log.fieldDiubah;
    let detail;
    if (log.fieldDiubah === 'dibuat') {
      detail = escapeHtml(log.keterangan || 'Titik baru ditambahkan');
    } else {
      detail = `<span class="line-through text-outline">${escapeHtml(log.nilaiLama || '(kosong)')}</span> → <span class="font-semibold text-on-surface">${escapeHtml(log.nilaiBaru || '(kosong)')}</span>`;
    }

    return `
      <li class="flex items-start gap-2.5">
        <span class="w-7 h-7 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0">
          <span class="material-symbols-outlined text-[15px]">${log.fieldDiubah === 'dibuat' ? 'add_location' : 'edit'}</span>
        </span>
        <div class="flex-1 min-w-0 flex flex-col gap-0.5">
          <span class="text-xs font-bold text-on-surface">${escapeHtml(label)}</span>
          <span class="text-[11px] text-on-surface-variant break-words line-clamp-3">${detail}</span>
          <span class="text-[10px] text-outline">${escapeHtml(log.diubahOleh)} • ${formatDate(log.createdAt, { withTime: true })}</span>
        </div>
      </li>`;
  }).join('');
}

// ============================================================================
// Tabel katalog
// ============================================================================
function updateInventoryTable() {
  const search = $('tableSearchInput').value.toLowerCase().trim();
  const provinsi = $('tableFilterProvinsi').value;
  const wilayah = $('tableFilterWilayah').value;
  const status = $('tableFilterStatus').value;

  const base = state.facilities.filter((item) =>
    matchesRegion(item, provinsi, wilayah) &&
    (status === 'all' || item.statusOperasional === status) &&
    (!search || matchesSearch(item, search))
  );

  const counts = countBy(base, 'kategori');
  document.querySelectorAll('#table-tabs [data-kategori]').forEach((tab) => {
    const kategori = tab.dataset.kategori;
    tab.querySelector('[data-count]').textContent = kategori === 'all' ? base.length : (counts[kategori] || 0);
    tab.classList.toggle('active', kategori === tableActiveKategori);
  });

  tableFilteredList = tableActiveKategori === 'all' ? base : base.filter((item) => item.kategori === tableActiveKategori);

  const totalItems = tableFilteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / TABLE_PAGE_SIZE));
  tableCurrentPage = Math.min(Math.max(tableCurrentPage, 1), totalPages);
  const startIndex = (tableCurrentPage - 1) * TABLE_PAGE_SIZE;
  const pageItems = tableFilteredList.slice(startIndex, startIndex + TABLE_PAGE_SIZE);

  $('inventory-table-body').innerHTML = pageItems.length
    ? pageItems.map(renderTableRow).join('')
    : '<tr><td colspan="4" class="py-10 text-center text-on-surface-variant">Tidak ada titik fasilitas yang cocok.</td></tr>';

  $('table-pagination-info').textContent = totalItems
    ? `Menampilkan ${startIndex + 1}-${Math.min(startIndex + TABLE_PAGE_SIZE, totalItems)} dari ${totalItems} titik`
    : 'Tidak ada titik';
  $('catalog-subtitle').textContent = `${state.facilities.length} titik tercatat di database geospasial`;
  renderPagination(totalPages);
}

function renderTableRow(item) {
  const meta = kategoriMeta(item.kategori);
  const status = statusMeta(item.statusOperasional);
  const isEditing = item.id === currentEditingId;

  return `
    <tr class="${isEditing ? 'bg-primary-fixed/40' : 'hover:bg-surface-container-low'} transition-colors">
      <td class="py-3 px-3 align-top">
        <div class="font-mono font-bold text-primary">${escapeHtml(item.nodeId)}</div>
        <div class="font-semibold text-on-surface mt-0.5">${escapeHtml(facilityTitle(item))}</div>
        ${item.nama ? `<div class="text-[11px] text-on-surface-variant">${escapeHtml(item.jenisFasilitas)}</div>` : ''}
      </td>
      <td class="py-3 px-3 align-top">
        <div class="font-semibold text-on-surface">${escapeHtml(shortWilayah(item.wilayahNama))}</div>
        <div class="text-[11px] text-on-surface-variant">${escapeHtml([item.kecamatan && `Kec. ${item.kecamatan}`, item.provinsi].filter(Boolean).join(' · '))}</div>
        <div class="text-[11px] text-outline">${escapeHtml(item.pengelolaNama)}</div>
      </td>
      <td class="py-3 px-3 align-top">
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${meta.badge}">
          <span class="material-symbols-outlined text-[13px]">${meta.icon}</span>${meta.label}
        </span>
        <div class="flex items-center gap-1.5 mt-1.5 text-[11px] font-medium ${status.text}">
          <span class="w-2 h-2 rounded-full ${status.dot}"></span>${escapeHtml(item.statusOperasional)}
        </div>
        ${item.statusVerifikasi ? `<div class="mt-1">${verifikasiBadge(item.statusVerifikasi)}</div>` : ''}
        <div class="text-[10px] text-outline mt-0.5">Diperbarui ${formatRelativeDate(item.updatedAt)}</div>
      </td>
      <td class="py-3 px-3 align-top text-right">
        <div class="flex items-center justify-end gap-1">
          <button type="button" data-action="map" data-id="${item.id}" title="Lihat di Peta" class="p-1.5 rounded-lg text-primary hover:bg-surface-container">
            <span class="material-symbols-outlined text-[16px]">map</span>
          </button>
          <button type="button" data-action="edit" data-id="${item.id}" title="Edit Titik" class="p-1.5 rounded-lg text-secondary hover:bg-surface-container">
            <span class="material-symbols-outlined text-[16px]">edit</span>
          </button>
          <button type="button" data-action="delete" data-id="${item.id}" title="Hapus Titik" class="p-1.5 rounded-lg text-error hover:bg-error-container">
            <span class="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </div>
      </td>
    </tr>`;
}

// Nomor halaman ringkas: 1 … 4 5 6 … 12
function buildPageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [...new Set([1, current - 1, current, current + 1, total])]
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
  const result = [];
  pages.forEach((page, i) => {
    if (i > 0 && page - pages[i - 1] > 1) result.push('…');
    result.push(page);
  });
  return result;
}

function renderPagination(totalPages) {
  $('table-pages').innerHTML = buildPageList(tableCurrentPage, totalPages).map((page) => page === '…'
    ? '<span class="px-1 text-outline">…</span>'
    : `<button type="button" data-page="${page}" class="min-w-8 h-8 px-2 rounded-lg font-bold ${page === tableCurrentPage ? 'bg-primary text-on-primary' : 'bg-surface-container-low hover:bg-surface-container text-on-surface'}">${page}</button>`
  ).join('');
  $('btn-prev-page').disabled = tableCurrentPage <= 1;
  $('btn-next-page').disabled = tableCurrentPage >= totalPages;
}

function handleTableFilter() {
  tableCurrentPage = 1;
  updateInventoryTable();
}

function handleTableProvinsiChange() {
  fillWilayahFilter($('tableFilterWilayah'), $('tableFilterProvinsi').value);
  handleTableFilter();
}

function setTableKategori(kategori) {
  tableActiveKategori = kategori;
  handleTableFilter();
}

function changeTablePage(delta) {
  goToTablePage(tableCurrentPage + delta);
}

function goToTablePage(page) {
  tableCurrentPage = page;
  updateInventoryTable();
}

function handleTableAction(event) {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const item = state.facilityById.get(id);
  if (!item) return;

  if (btn.dataset.action === 'map') locateAndShowOnMap(item);
  if (btn.dataset.action === 'edit') populateFormForEdit(item);
  if (btn.dataset.action === 'delete') confirmDeleteFacility(id);
}

function locateAndShowOnMap(item) {
  switchView('map');
  setTimeout(() => focusFacility(item), 250);
}

// ============================================================================
// Ekspor data (mengikuti filter tabel yang aktif)
// ============================================================================
function getExportList() {
  if (tableFilteredList.length === 0) {
    showToast('Tidak ada data untuk diekspor', 'error');
    return null;
  }
  return tableFilteredList;
}

function exportFileName(extension) {
  return `caiKU_Titik_Air_Jawa_${todayIso()}.${extension}`;
}

function exportScopeNote(list) {
  return list.length < state.facilities.length ? ` (${list.length} titik sesuai filter)` : ` (${list.length} titik)`;
}

/**
 * Export to CSV (format sama dengan CSV seed agar bisa diimpor ulang)
 */
function exportToCSV() {
  const list = getExportList();
  if (!list) return;

  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[=+@]/.test(text)) text = `'${text}`; // cegah formula injection di Excel
    return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const decimal = (n) => Number(n).toFixed(6).replace('.', ',');

  const rows = list.map((f, idx) => [
    f.no ?? idx + 1, f.nodeId, f.kategori, f.jenisFasilitas, f.nama, f.desaKelurahan, f.kecamatan, f.wilayahNama, f.provinsi,
    decimal(f.latitude), decimal(f.longitude), f.alamat, f.pengelolaNama, f.wilayahLayanan, f.statusOperasional,
    f.statusVerifikasi, f.catatanData, f.sumberData, f.sumberUrl
  ].map((v, i) => (LAT_LNG_COLUMNS.includes(i) ? v : cell(v))).join(';'));

  // BOM agar Excel membaca UTF-8 dengan benar
  downloadFile(`﻿${[EXPORT_HEADER.join(';'), ...rows].join('\r\n')}`, exportFileName('csv'), 'text/csv;charset=utf-8');
  showToast(`Ekspor CSV selesai${exportScopeNote(list)}`, 'success');
}

/**
 * Export to GeoJSON (siap dibuka di QGIS / ArcGIS / geojson.io)
 */
function exportToGeoJSON() {
  const list = getExportList();
  if (!list) return;

  const geojson = {
    type: 'FeatureCollection',
    name: 'caiKU_titik_air_jawa',
    features: list.filter(hasCoords).map((f) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [f.longitude, f.latitude] },
      properties: {
        nodeId: f.nodeId,
        kategori: f.kategori,
        jenisFasilitas: f.jenisFasilitas,
        nama: f.nama,
        desaKelurahan: f.desaKelurahan,
        kecamatan: f.kecamatan,
        wilayah: f.wilayahNama,
        provinsi: f.provinsi,
        alamat: f.alamat,
        pengelola: f.pengelolaNama,
        wilayahLayanan: f.wilayahLayanan,
        statusOperasional: f.statusOperasional,
        statusVerifikasi: f.statusVerifikasi,
        catatan: f.catatanData,
        sumberData: f.sumberData,
        linkGoogleMaps: f.sumberUrl,
        diperbarui: f.updatedAt
      }
    }))
  };

  downloadFile(JSON.stringify(geojson, null, 2), exportFileName('geojson'), 'application/geo+json');
  showToast(`Ekspor GeoJSON selesai${exportScopeNote(list)}`, 'success');
}

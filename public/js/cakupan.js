/**
 * Analisis cakupan layanan di peta:
 * - Seksi "Analisis Cakupan Layanan" di panel detail titik (kapasitas SR, jiwa, kecamatan tercakup)
 * - Area layanan & kecamatan tercakup digambar di peta
 * - Kartu ringkasan cakupan untuk provinsi / kab-kota yang dipilih di filter
 * Perhitungan dilakukan server (services/cakupan.js) lewat /api/cakupan.
 */
let coverageLayer = null;
let gapLayer = null;
let coverageRequestId = 0;
let coverageShownFor = null; // id titik yang areanya sedang tampil
let regionSummaryRequestId = 0;
let lastRegionSummary = null;
const coverageCache = new Map();
const REGION_SUMMARY_COLLAPSED_KEY = 'caiku.ringkasanCakupan.ciut';

const ASAL_META = {
  data: { label: 'Data', cls: 'bg-emerald-100 text-emerald-800', title: 'Dari xlsx sumber data atau isian petugas' },
  estimasi: { label: 'Estimasi', cls: 'bg-amber-100 text-amber-800', title: 'Nilai tipikal per jenis fasilitas (config/cakupan.js)' },
  ditebak: { label: 'Ditebak', cls: 'bg-slate-100 text-slate-700', title: 'Ditebak dari nama fasilitas' },
  'tidak diketahui': { label: '?', cls: 'bg-slate-100 text-slate-600', title: 'Belum diketahui' },
};

function initCoverageLayers() {
  // Urutan lapisan: mask wilayah 350 < kecamatan tercakup 380 < mask area cakupan 385 < garis area 390 < marker
  map.createPane('coveragePane').style.zIndex = 380;
  map.createPane('coverageMaskPane').style.zIndex = 385;
  map.getPane('coverageMaskPane').style.pointerEvents = 'none';
  map.createPane('coverageAreaPane').style.zIndex = 390;
  coverageLayer = L.layerGroup().addTo(map);
  gapLayer = L.layerGroup().addTo(map);
}

function asalBadge(asal) {
  const meta = ASAL_META[asal] || ASAL_META.estimasi;
  return `<span class="coverage-badge ${meta.cls}" title="${escapeHtml(meta.title)}">${escapeHtml(meta.label)}</span>`;
}

function fetchCoverage(item) {
  const key = `${item.id}:${item.updatedAt}`;
  if (!coverageCache.has(key)) {
    coverageCache.set(key, api(`/cakupan/${item.id}`)
      .then((res) => res.data)
      .catch((err) => {
        coverageCache.delete(key);
        throw err;
      }));
  }
  return coverageCache.get(key);
}

// ============================================================================
// Seksi di panel detail titik
// ============================================================================
async function renderCoverageSection(item) {
  const el = $('drawer-cakupan');
  const requestId = ++coverageRequestId;
  if (coverageShownFor !== null && coverageShownFor !== item.id) clearCoverageArea();

  el.innerHTML = `${coverageHeader()}
    <div class="flex items-center gap-2 text-on-surface-variant text-[11px] py-2">
      <span class="material-symbols-outlined text-[16px] spin">progress_activity</span>Menghitung cakupan layanan...
    </div>`;

  try {
    const data = await fetchCoverage(item);
    if (requestId !== coverageRequestId) return;
    el.innerHTML = coverageHeader() + (data.dihitung ? coverageBody(data) : coverageNotCounted(data));
    if (coverageShownFor === item.id) drawCoverageArea(data, { fit: false });
    updateCoverageToggle();
  } catch (err) {
    if (requestId !== coverageRequestId) return;
    el.innerHTML = `${coverageHeader()}<p class="text-xs text-error">${escapeHtml(err.message || 'Gagal menghitung cakupan')}</p>`;
  }
}

function coverageHeader() {
  return `
    <div class="flex items-center justify-between gap-2">
      <span class="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-bold text-primary">
        <span class="material-symbols-outlined text-[16px]">hub</span>Analisis Cakupan Layanan
      </span>
      <span class="coverage-badge bg-primary-fixed text-on-primary-fixed-variant" title="Rumus model spasial (bukan AI): debit → sambungan rumah → area layanan → kecamatan">
        <span class="material-symbols-outlined text-[12px]">calculate</span>Estimasi model
      </span>
    </div>`;
}

function coverageNotCounted(data) {
  const isKantor = data.peran === 'kantor';
  return `
    <div class="flex items-start gap-2 p-2.5 rounded-lg bg-surface-container-low border border-surface-container text-xs text-on-surface-variant leading-relaxed">
      <span class="material-symbols-outlined text-[16px] text-outline shrink-0">${isKantor ? 'storefront' : 'block'}</span>
      <span>${escapeHtml(data.alasan || 'Cakupan tidak dihitung untuk jenis fasilitas ini.')}</span>
    </div>
    <div class="flex gap-2">
      ${isKantor ? `<button type="button" onclick="editActiveNode()" class="btn-secondary bg-surface-container-lowest flex-1 py-2 px-2.5">
        <span class="material-symbols-outlined text-[16px] text-primary">edit_note</span><span>Isi Debit / Jumlah SR</span></button>` : ''}
      <button type="button" onclick="explainCoverageWithAi('${escapeHtml(data.nodeId)}')" class="btn-secondary bg-surface-container-lowest flex-1 py-2 px-2.5">
        <span class="material-symbols-outlined text-[16px] text-primary">auto_awesome</span><span>Tanya AI sumber terdekat</span>
      </button>
    </div>`;
}

function coverageBody(d) {
  const potensi = d.peran === 'potensi';
  const p = d.parameter;
  const tidakMelayani = d.srLayanan <= 0;

  const srLine = d.srAktual != null
    ? `<div class="text-xs text-on-surface-variant mt-1">Pelanggan aktual <b class="text-on-surface">${formatNumber(d.srAktual)} SR</b> ${asalBadge('data')}${d.kapasitasSR != null ? ` · kapasitas hitungan ${formatNumber(d.kapasitasSR)} SR${d.utilisasiPersen != null ? ` (terpakai ${d.utilisasiPersen}%)` : ''}` : ''}</div>`
    : '';

  const kecamatanRows = d.wilayahTercakup.map((w, i) => `
    <li class="coverage-kec${i >= 5 ? ' hidden' : ''}" data-extra="${i >= 5}">
      <div class="flex items-baseline justify-between gap-2">
        <span class="font-semibold text-on-surface truncate" title="${escapeHtml(`Kec. ${w.kecamatan}, ${w.wilayahNama}`)}">Kec. ${escapeHtml(w.kecamatan)}
          <span class="font-normal text-on-surface-variant">· ${escapeHtml(shortWilayah(w.wilayahNama))}</span></span>
        <span class="tabular text-on-surface-variant shrink-0">± ${formatNumber(w.perkiraanJiwa)} jiwa</span>
      </div>
      <div class="coverage-bar" title="${formatDecimal(w.persenKecamatan, 1)}% luas kecamatan tercakup"><span style="width:${Math.max(2, Math.min(100, w.persenKecamatan))}%"></span></div>
      <span class="text-[11px] text-outline">${formatDecimal(w.persenKecamatan, 1)}% luas kecamatan tercakup</span>
    </li>`).join('');
  const sisa = d.wilayahTercakup.length - 5;

  const rumus = d.debit ? `
      <p><b>Kapasitas</b> = Q × 86.400 × (1 − kehilangan) ÷ (kebutuhan × ${p.jiwaPerSR} jiwa × ${formatDecimal(p.faktorHariMaks, 1)})<br>
      = ${formatDecimal(d.debitEfektif)} × 86.400 × ${formatDecimal(1 - p.kehilanganAir)} ÷ (${p.kebutuhanLOrangHari} × ${p.jiwaPerSR} × ${formatDecimal(p.faktorHariMaks, 1)}) = <b>${formatNumber(d.kapasitasSR)} SR</b></p>` : '';
  const radiusRumus = d.radiusKm ? `
      <p><b>Radius</b> = √(jiwa ÷ (π × kepadatan × porsi tersambung))<br>
      = √(${formatNumber(d.jiwaTerlayani)} ÷ (π × ${formatNumber(p.kepadatanJiwaKm2)} × ${formatDecimal(p.porsiTersambung)})) = <b>${formatDecimal(d.radiusKm)} km</b></p>` : '';

  return `
    ${potensi ? `<div class="flex items-start gap-1.5 p-2 rounded-lg bg-violet-50 border border-violet-200 text-xs text-violet-800">
      <span class="material-symbols-outlined text-[15px] shrink-0">water</span><span><b>Potensi</b>, bukan layanan aktif: ${escapeHtml(d.catatan[0] || '')}</span></div>` : ''}

    <div class="coverage-hero">
      <span class="spec-label">${potensi ? 'Potensi pelanggan' : 'Kapasitas pelanggan'} (sambungan rumah)</span>
      <div class="flex items-baseline gap-2 flex-wrap">
        <span class="font-heading font-extrabold text-2xl text-primary tabular">± ${formatNumber(d.srLayanan)}</span>
        <span class="font-bold text-xs text-on-surface">SR</span>
        ${asalBadge(d.sumberSR)}
        <span class="text-[11px] text-on-surface-variant">≈ ${formatNumber(d.jiwaTerlayani)} jiwa</span>
      </div>
      ${srLine}
    </div>

    <div class="grid grid-cols-2 gap-2">
      <div class="spec-card"><span class="spec-label">Debit</span>
        <span class="spec-value flex items-center gap-1.5 flex-wrap">${d.debit ? `${formatDecimal(d.debit.nilai)} L/detik ${asalBadge(d.debit.asal)}` : '-'}</span></div>
      <div class="spec-card"><span class="spec-label">Jenis Sumber</span>
        <span class="spec-value flex items-center gap-1.5 flex-wrap">${escapeHtml(d.jenisSumber.nilai || 'Belum diketahui')} ${d.jenisSumber.nilai ? asalBadge(d.jenisSumber.asal) : ''}</span></div>
      <div class="spec-card"><span class="spec-label">Radius Layanan</span>
        <span class="spec-value">${d.radiusKm ? `± ${formatDecimal(d.radiusKm)} km` : '-'}</span></div>
      <div class="spec-card"><span class="spec-label">Luas Area</span>
        <span class="spec-value">${d.luasAreaKm2 ? `${formatDecimal(d.luasAreaKm2)} km²` : '-'}</span></div>
    </div>

    ${tidakMelayani ? `<p class="text-xs text-error font-semibold">Titik ini dianggap tidak melayani saat ini (status ${escapeHtml(d.statusOperasional || '-')}).</p>` : `
    <div class="flex flex-col gap-1.5">
      <span class="spec-label">Wilayah tercakup (${d.wilayahTercakup.length} kecamatan${d.kabkotaTercakup.length > 1 ? `, ${d.kabkotaTercakup.length} kab/kota` : ''})</span>
      <ul class="flex flex-col gap-2">${kecamatanRows || '<li class="text-[11px] text-on-surface-variant">Tidak ada kecamatan yang beririsan.</li>'}</ul>
      ${sisa > 0 ? `<button type="button" onclick="toggleCoverageKecamatan(this)" class="self-start text-[11px] font-bold text-primary hover:underline">+ ${sisa} kecamatan lainnya</button>` : ''}
    </div>`}

    <div class="flex gap-2">
      ${tidakMelayani ? '' : `<button type="button" id="btn-coverage-area" onclick="toggleCoverageArea()" class="btn-secondary bg-surface-container-lowest flex-1 py-2 px-2.5">
        <span class="material-symbols-outlined text-[16px] text-primary">radar</span><span>Tampilkan area</span></button>`}
      <button type="button" onclick="explainCoverageWithAi('${escapeHtml(d.nodeId)}')" class="btn-secondary bg-surface-container-lowest flex-1 py-2 px-2.5">
        <span class="material-symbols-outlined text-[16px] text-primary">auto_awesome</span><span>Jelaskan dengan AI</span>
      </button>
    </div>

    <details class="coverage-details">
      <summary>Cara menghitung & asumsi</summary>
      <div class="flex flex-col gap-1.5 pt-1.5">
        ${rumus}${radiusRumus}
        <p>Kebutuhan ${p.kebutuhanLOrangHari} L/orang/hari · kehilangan air ${Math.round(p.kehilanganAir * 100)}% · ${p.jiwaPerSR} jiwa/SR · porsi rumah tersambung ${Math.round(p.porsiTersambung * 100)}% · kepadatan kecamatan ${d.kecamatanLokasi ? `${escapeHtml(d.kecamatanLokasi.nama)} ` : ''}± ${formatNumber(p.kepadatanJiwaKm2)} jiwa/km² (BPS 2020, dibagi rata per luas).</p>
        ${d.catatan.filter((c) => !potensi || c !== d.catatan[0]).map((c) => `<p class="text-amber-800">• ${escapeHtml(c)}</p>`).join('')}
        <p class="text-outline">Isi debit / jumlah SR lewat "Update Data Titik" agar angka berubah dari Estimasi menjadi Data.</p>
      </div>
    </details>`;
}

function toggleCoverageKecamatan(button) {
  const extras = button.parentElement.querySelectorAll('[data-extra="true"]');
  const show = extras[0]?.classList.contains('hidden');
  extras.forEach((li) => li.classList.toggle('hidden', !show));
  button.textContent = show ? 'Sembunyikan' : `+ ${extras.length} kecamatan lainnya`;
}

// ============================================================================
// Area layanan di peta
// ============================================================================
// ----------------------------------------------------------------------------
// Fokus area cakupan: saat area layanan ditampilkan, peta "dipotong" hanya ke area itu.
// Semua di luar area ditutup mask, dan marker di luar area disembunyikan (kecuali titik aktif).
// ----------------------------------------------------------------------------
let coverageMaskLayer = null;
let coverageFocusGeometry = null;

// Ray casting even-odd untuk Polygon/MultiPolygon GeoJSON (lubang ikut terhitung)
function pointInGeometry(lng, lat, geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  let inside = false;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
  }
  return inside;
}

// Dipanggil applyMapFilters (map.js): true bila titik boleh tampil selama fokus area aktif
function coverageFocusFilter(item) {
  if (!coverageFocusGeometry) return true;
  if (activeNode?.id === item.id) return true;
  return pointInGeometry(item.longitude, item.latitude, coverageFocusGeometry);
}

function setCoverageFocus(area) {
  coverageFocusGeometry = area.geometry || area;
  // WORLD_RING, MASK_COLOR, geometryRings dari wilayah.js
  const latlngs = [WORLD_RING, ...geometryRings(coverageFocusGeometry)];
  if (coverageMaskLayer) {
    coverageMaskLayer.setLatLngs(latlngs);
  } else {
    coverageMaskLayer = L.polygon(latlngs, {
      pane: 'coverageMaskPane',
      interactive: false,
      stroke: false,
      fillColor: MASK_COLOR,
      fillOpacity: 1,
      fillRule: 'evenodd',
    }).addTo(map);
  }
  applyMapFilters();
}

function clearCoverageFocus() {
  if (coverageMaskLayer) {
    map.removeLayer(coverageMaskLayer);
    coverageMaskLayer = null;
  }
  if (coverageFocusGeometry) {
    coverageFocusGeometry = null;
    applyMapFilters();
  }
}

function clearCoverageArea() {
  coverageLayer?.clearLayers();
  coverageShownFor = null;
  clearCoverageFocus();
  updateCoverageToggle();
}

function updateCoverageToggle() {
  const btn = $('btn-coverage-area');
  if (!btn) return;
  const shown = activeNode && coverageShownFor === activeNode.id;
  btn.querySelector('span:last-child').textContent = shown ? 'Sembunyikan area' : 'Tampilkan area';
  btn.classList.toggle('is-on', Boolean(shown));
}

async function toggleCoverageArea() {
  if (!activeNode) return;
  if (coverageShownFor === activeNode.id) {
    clearCoverageArea();
    return;
  }
  try {
    const data = await fetchCoverage(activeNode);
    coverageShownFor = activeNode.id;
    await drawCoverageArea(data, { fit: true });
    updateCoverageToggle();
  } catch (err) {
    showToast(err.message || 'Gagal menampilkan area layanan', 'error');
  }
}

async function drawCoverageArea(data, { fit = true } = {}) {
  coverageLayer.clearLayers();
  if (!data?.area) {
    clearCoverageFocus();
    return;
  }

  // Potong peta ke area layanan dulu, agar kamera & marker langsung mengikuti
  setCoverageFocus(data.area);

  // Kecamatan tercakup (oranye, terpotong mask di tepi area), lalu garis area layanan (biru) di atasnya
  const tercakup = new Map(data.wilayahTercakup.map((w) => [`${w.wilayahNama}|${w.kecamatan}`, w]));
  const provinsiList = [...new Set(data.wilayahTercakup.map((w) => w.provinsi))];
  try {
    const collections = await Promise.all(provinsiList.map(loadKecamatanBatas));
    if (coverageShownFor !== data.id) return; // sudah ditutup / berganti titik
    const features = collections.flatMap((fc) => fc.features)
      .filter((f) => tercakup.has(`${f.properties.wilayahNama}|${f.properties.nama}`));
    coverageLayer.addLayer(L.geoJSON({ type: 'FeatureCollection', features }, {
      pane: 'coveragePane',
      style: { color: '#d97706', weight: 1.5, opacity: 0.9, fillColor: '#f59e0b', fillOpacity: 0.1 },
      onEachFeature: (feature, layer) => {
        const w = tercakup.get(`${feature.properties.wilayahNama}|${feature.properties.nama}`);
        layer.bindTooltip(
          `<b>Kec. ${escapeHtml(w.kecamatan)}</b> · ${escapeHtml(shortWilayah(w.wilayahNama))}<br>${formatDecimal(w.persenKecamatan, 1)}% wilayah tercakup · ± ${formatNumber(w.perkiraanJiwa)} jiwa`,
          { sticky: true, direction: 'top', className: 'geo-tooltip' }
        );
      },
    }));
  } catch (err) {
    console.warn('Batas kecamatan tidak dimuat:', err);
  }

  // Di atas mask: garis tepi area tetap terlihat utuh
  const areaLayer = L.geoJSON(data.area, {
    pane: 'coverageAreaPane',
    interactive: false,
    style: { color: '#0369a1', weight: 2.5, fillColor: '#0ea5e9', fillOpacity: 0.08 },
  });
  coverageLayer.addLayer(areaLayer);

  if (fit) {
    const bounds = areaLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { ...getMapPadding(), maxZoom: 15 });
  }
}

// ============================================================================
// Ringkasan cakupan wilayah terpilih (kartu di kiri bawah peta)
// ============================================================================
function regionLabel({ provinsi, wilayah }) {
  if (wilayah !== 'all') return shortWilayah(wilayah);
  if (provinsi !== 'all') return provinsi;
  return 'Pulau Jawa';
}

function clearGapLayer() {
  gapLayer?.clearLayers();
  $('btn-gap')?.classList.remove('is-on');
}

async function refreshRegionSummary() {
  const card = $('region-summary');
  const region = selectedRegion();
  clearGapLayer();
  if (region.provinsi === 'all' && region.wilayah === 'all') {
    lastRegionSummary = null;
    setVisible(card, false);
    return;
  }

  const requestId = ++regionSummaryRequestId;
  setVisible(card, true);
  card.innerHTML = `<div class="flex items-center gap-2 text-on-surface-variant text-[11px]">
    <span class="material-symbols-outlined text-[16px] spin">progress_activity</span>Menghitung cakupan ${escapeHtml(regionLabel(region))}...</div>`;
  try {
    const params = new URLSearchParams({ provinsi: region.provinsi, wilayah: region.wilayah });
    const { data } = await api(`/cakupan/wilayah?${params}`);
    if (requestId !== regionSummaryRequestId) return;
    lastRegionSummary = { ...data, region };
    renderRegionSummary();
  } catch (err) {
    if (requestId !== regionSummaryRequestId) return;
    card.innerHTML = `<span class="text-[11px] text-error">${escapeHtml(err.message || 'Gagal menghitung ringkasan cakupan')}</span>`;
  }
}

// Default: terbuka di layar lebar, ciut di HP agar peta tidak tertutup
function isRegionSummaryCollapsed() {
  const stored = storage.get(REGION_SUMMARY_COLLAPSED_KEY);
  return typeof stored === 'boolean' ? stored : !isWideScreen();
}

function toggleRegionSummaryCollapsed() {
  storage.set(REGION_SUMMARY_COLLAPSED_KEY, !isRegionSummaryCollapsed());
  renderRegionSummary();
}

function renderRegionSummary() {
  const d = lastRegionSummary;
  if (!d) return;
  const collapsed = isRegionSummaryCollapsed();
  const persen = d.persenPendudukTerlayani;
  const tanpa = d.kecamatanTanpaLayanan.length;
  // Kantor PDAM tanpa debit/SR tidak ikut dihitung: persentase hanyalah batas bawah
  const batasBawah = d.jumlahKantorTanpaData > 0 || !d.jumlahDataAsli;
  const persenTeks = persen != null ? `${batasBawah ? '≥ ' : ''}${formatDecimal(persen)}%` : '-';

  const header = `
    <div class="flex items-center justify-between gap-2">
      <span class="flex items-center gap-1.5 font-heading font-bold text-on-surface min-w-0">
        <span class="material-symbols-outlined text-[17px] text-primary">hub</span>
        <span class="truncate">Cakupan Layanan · ${escapeHtml(regionLabel(d.region))}</span>
      </span>
      <button type="button" onclick="toggleRegionSummaryCollapsed()" class="icon-btn w-7 h-7" title="${collapsed ? 'Tampilkan' : 'Ciutkan'}" aria-label="${collapsed ? 'Tampilkan ringkasan cakupan' : 'Ciutkan ringkasan cakupan'}" aria-expanded="${!collapsed}">
        <span class="material-symbols-outlined text-[18px]">${collapsed ? 'expand_less' : 'expand_more'}</span>
      </button>
    </div>`;

  if (collapsed) {
    $('region-summary').innerHTML = `${header}<span class="text-[11px] text-on-surface-variant">± ${formatNumber(d.totalKapasitasSR)} SR · ${persen != null ? `${persenTeks} penduduk` : '-'} · ${d.jumlahKecamatanTercakup}/${d.jumlahKecamatan} kecamatan</span>`;
    return;
  }

  $('region-summary').innerHTML = `${header}
    <div class="grid grid-cols-3 gap-1.5">
      <div class="region-stat"><span class="spec-label">Kapasitas</span><span class="font-heading font-bold text-on-surface tabular">± ${formatNumber(d.totalKapasitasSR)} SR</span><span class="text-[11px] text-outline">${formatNumber(d.totalJiwaTerlayani)} jiwa</span></div>
      <div class="region-stat"><span class="spec-label">Penduduk terlayani</span><span class="font-heading font-bold text-on-surface tabular"${batasBawah ? ' title="Batas bawah: belum semua sumber punya data debit/jumlah SR"' : ''}>${persenTeks}</span><span class="text-[11px] text-outline">dari ${formatNumber(d.penduduk)}</span></div>
      <div class="region-stat"><span class="spec-label">Kecamatan tercakup</span><span class="font-heading font-bold text-on-surface tabular">${d.jumlahKecamatanTercakup}/${d.jumlahKecamatan}</span><span class="text-[11px] text-outline">${tanpa} belum</span></div>
    </div>
    ${batasBawah ? `<div class="flex items-start gap-1.5 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-snug" role="note">
      <span class="material-symbols-outlined text-[16px] shrink-0">info</span>
      <span><b>Angka batas bawah.</b> ${d.jumlahDataAsli ? 'Sebagian' : 'Semua'} kapasitas masih estimasi${d.jumlahKantorTanpaData ? ` dan ${d.jumlahKantorTanpaData} kantor PDAM belum punya data debit/SR, sehingga belum ikut dihitung` : ''}. Persentase sebenarnya kemungkinan lebih tinggi.</span>
    </div>` : ''}
    <p class="text-xs text-on-surface-variant leading-snug">
      ${d.jumlahSumberDihitung} sumber dihitung${d.jumlahPotensi ? ` · ${d.jumlahPotensi} kolam retensi (potensi ± ${formatNumber(d.potensiSR)} SR)` : ''}${d.jumlahKantorTanpaData ? ` · <span title="Isi debit/jumlah SR di formulir petugas agar ikut dihitung">${d.jumlahKantorTanpaData} kantor PDAM belum ada data SR</span>` : ''}.
    </p>
    <div class="flex gap-1.5">
      ${tanpa ? `<button type="button" id="btn-gap" onclick="toggleGapKecamatan()" class="btn-secondary bg-surface-container-lowest flex-1 py-1.5 px-2 text-[11px]">
        <span class="material-symbols-outlined text-[15px] text-error">report</span><span>Sorot ${tanpa} kec. belum terlayani</span></button>` : ''}
      <button type="button" onclick="askAiAboutRegion()" class="btn-secondary bg-surface-container-lowest py-1.5 px-2 text-[11px]">
        <span class="material-symbols-outlined text-[15px] text-primary">auto_awesome</span><span>Tanya AI</span></button>
    </div>`;
}

async function toggleGapKecamatan() {
  const d = lastRegionSummary;
  if (!d) return;
  if (gapLayer.getLayers().length) {
    clearGapLayer();
    return;
  }
  const keys = new Map(d.kecamatanTanpaLayanan.map((k) => [`${k.wilayahNama}|${k.kecamatan}`, k]));
  const provinsiList = d.region.provinsi !== 'all'
    ? [d.region.provinsi]
    : [...new Set(state.wilayahList.filter((w) => w.nama === d.region.wilayah).map((w) => w.provinsi))];
  try {
    const collections = await Promise.all(provinsiList.map(loadKecamatanBatas));
    const features = collections.flatMap((fc) => fc.features)
      .filter((f) => keys.has(`${f.properties.wilayahNama}|${f.properties.nama}`));
    gapLayer.addLayer(L.geoJSON({ type: 'FeatureCollection', features }, {
      pane: 'coveragePane',
      style: { color: '#ba1a1a', weight: 1, opacity: 0.7, fillColor: '#ef4444', fillOpacity: 0.16 },
      onEachFeature: (feature, layer) => {
        const k = keys.get(`${feature.properties.wilayahNama}|${feature.properties.nama}`);
        layer.bindTooltip(
          `<b>Kec. ${escapeHtml(k.kecamatan)}</b> · ${escapeHtml(shortWilayah(k.wilayahNama))}<br>Belum ada sumber tercatat · ± ${formatNumber(k.penduduk)} jiwa`,
          { sticky: true, direction: 'top', className: 'geo-tooltip' }
        );
      },
    }));
    $('btn-gap')?.classList.add('is-on');
  } catch (err) {
    showToast('Batas kecamatan gagal dimuat', 'error');
  }
}

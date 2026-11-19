/**
 * Halaman Statistik (publik).
 * - KPI: total titik, kab/kota terwakili, status operasional diketahui, estimasi penduduk terlayani
 * - Sebaran titik per provinsi (atau per kab/kota bila provinsi dipilih), bertumpuk per kategori
 * - Cakupan layanan per provinsi (dari /api/cakupan/wilayah, estimasi model)
 * - Jenis fasilitas, status operasional, status verifikasi, kab/kota terbanyak
 * Grafik dibuat dari HTML biasa (tanpa pustaka): batang tipis, satu sumbu, warna kategori sama dengan peta.
 */
const STAT_BAR_COLOR = '#006194'; // warna tunggal untuk grafik satu seri (warna primer caiKU)
const statsCoverage = { key: null, promise: null };
let statsRenderId = 0;

document.addEventListener('DOMContentLoaded', () => {
  $('stats-provinsi').addEventListener('change', () => renderStatistikPage());
  bindStatTooltip();
});

// Data titik berubah → cache cakupan per provinsi tidak berlaku lagi
function statsDataKey() {
  return `${state.facilities.length}:${state.stats?.lastUpdated || ''}`;
}

function renderStatistikPage() {
  if (!state.stats) return;
  const select = $('stats-provinsi');
  fillProvinsiFilter(select); // core.js, pilihan sebelumnya dipertahankan
  const provinsi = select.value;
  const list = provinsi === 'all' ? state.facilities : state.facilities.filter((f) => f.provinsi === provinsi);
  const label = provinsi === 'all' ? 'Pulau Jawa' : provinsi;

  $('stats-updated').textContent = state.stats.lastUpdated
    ? `Data diperbarui ${formatDate(state.stats.lastUpdated, { withTime: true })}`
    : '';

  renderStatsKpi(list, provinsi);
  renderStatsSebaran(list, provinsi, label);
  renderStatsBarList('stats-jenis', {
    title: 'Jenis Fasilitas',
    icon: 'category',
    note: `${label} · jumlah titik per jenis`,
    rows: countRows(list, 'jenisFasilitas').map((r) => ({ ...r, icon: jenisIcon(r.key) })),
    total: list.length,
    wide: true,
  });
  renderStatsBarList('stats-status', {
    title: 'Status Operasional',
    icon: 'engineering',
    note: 'Diisi petugas setelah cek lapangan',
    rows: countRows(list, 'statusOperasional').map((r) => ({ ...r, dot: statusMeta(r.key).dot })),
    total: list.length,
  });
  renderStatsBarList('stats-verifikasi', {
    title: 'Status Verifikasi Data',
    icon: 'verified',
    note: 'Asal dan tingkat pemeriksaan koordinat',
    rows: countRows(list, 'statusVerifikasi', 'Belum ada status').map((r) => ({
      ...r,
      label: statusVerifikasiMeta(r.key)?.short || r.key,
      icon: statusVerifikasiMeta(r.key)?.icon || 'help',
    })),
    total: list.length,
  });
  renderStatsBarList('stats-wilayah', {
    title: provinsi === 'all' ? '10 Kab/Kota dengan Titik Terbanyak' : `10 Kab/Kota Terbanyak di ${provinsi}`,
    icon: 'location_city',
    note: 'Jumlah titik fasilitas air per kab/kota',
    rows: countRows(list, 'wilayahNama').slice(0, 10).map((r) => ({ ...r, label: shortWilayah(r.key) })),
    total: list.length,
    wide: true,
  });
  renderStatsCoverage(provinsi);
}

// [{ key, count }] terurut terbanyak
function countRows(list, field, emptyLabel = '-') {
  const counts = countBy(list.map((f) => ({ v: f[field] || emptyLabel })), 'v');
  return Object.entries(counts).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function percent(value, total) {
  return total ? (value / total) * 100 : 0;
}

function cardHeader(title, icon, note) {
  return `
    <div class="flex items-start justify-between gap-3">
      <div class="flex flex-col gap-0.5 min-w-0">
        <h2 class="flex items-center gap-2 font-heading font-bold text-base text-on-surface">
          <span class="material-symbols-outlined text-[20px] text-primary">${icon}</span>${escapeHtml(title)}
        </h2>
        ${note ? `<p class="text-xs text-on-surface-variant">${escapeHtml(note)}</p>` : ''}
      </div>
    </div>`;
}

// ============================================================================
// KPI
// ============================================================================
function kpiTile({ label, value, note, icon, id }) {
  return `
    <div class="card p-5 flex items-center justify-between gap-3">
      <div class="flex flex-col min-w-0">
        <span class="text-xs font-bold text-on-surface-variant uppercase tracking-wider">${escapeHtml(label)}</span>
        <span ${id ? `id="${id}"` : ''} class="font-heading font-extrabold text-2xl text-on-surface tabular mt-1">${value}</span>
        <span ${id ? `id="${id}-note"` : ''} class="text-xs text-on-surface-variant mt-0.5">${note}</span>
      </div>
      <div class="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-primary shrink-0">
        <span class="material-symbols-outlined text-[26px]">${icon}</span>
      </div>
    </div>`;
}

function renderStatsKpi(list, provinsi) {
  const wilayahTotal = provinsi === 'all' ? state.wilayahList.length : state.wilayahList.filter((w) => w.provinsi === provinsi).length;
  const wilayahTerisi = new Set(list.map((f) => f.wilayahNama)).size;
  const diketahui = list.filter((f) => f.statusOperasional && f.statusOperasional !== STATUS_DEFAULT_BARU).length;

  $('stats-kpi').innerHTML = [
    kpiTile({
      label: 'Total Titik', icon: 'water_drop', value: formatNumber(list.length),
      note: provinsi === 'all' ? `di ${new Set(list.map((f) => f.provinsi)).size} provinsi` : escapeHtml(provinsi),
    }),
    kpiTile({
      label: 'Kab/Kota Terwakili', icon: 'location_city', value: `${wilayahTerisi}<span class="text-base text-on-surface-variant font-bold"> / ${wilayahTotal}</span>`,
      note: 'kab/kota yang punya minimal satu titik',
    }),
    kpiTile({
      label: 'Status Operasional Diketahui', icon: 'engineering', value: `${formatDecimal(percent(diketahui, list.length), 1)}%`,
      note: `${formatNumber(diketahui)} titik sudah dicek lapangan`,
    }),
    kpiTile({
      label: 'Penduduk Terlayani (estimasi)', icon: 'groups', value: '…', id: 'stats-kpi-penduduk',
      note: 'menghitung model cakupan…',
    }),
  ].join('');
}

// ============================================================================
// Sebaran titik bertumpuk per kategori
// ============================================================================
function renderStatsSebaran(list, provinsi, label) {
  const kategoriList = Object.keys(KATEGORI_META);
  const byRow = new Map();
  const rowKey = provinsi === 'all' ? 'provinsi' : 'wilayahNama';
  // Provinsi urut barat → timur; kab/kota urut terbanyak
  if (provinsi === 'all') provinsiList().forEach((p) => byRow.set(p, {}));
  for (const f of list) {
    const key = f[rowKey] || '-';
    if (!byRow.has(key)) byRow.set(key, {});
    const row = byRow.get(key);
    row[f.kategori] = (row[f.kategori] || 0) + 1;
  }
  let rows = [...byRow].map(([key, counts]) => ({
    key,
    label: provinsi === 'all' ? key : shortWilayah(key),
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  }));
  if (provinsi !== 'all') rows.sort((a, b) => b.total - a.total);
  rows = rows.filter((r) => r.total > 0 || provinsi === 'all');
  const max = Math.max(1, ...rows.map((r) => r.total));
  const totalKategori = countBy(list, 'kategori');

  const legend = kategoriList.map((k) => `
    <span class="flex items-center gap-1.5">
      <span class="stat-swatch" style="background:${KATEGORI_META[k].color}"></span>
      <span class="text-on-surface">${escapeHtml(KATEGORI_META[k].label)}</span>
      <span class="text-on-surface-variant tabular">${formatNumber(totalKategori[k] || 0)}</span>
    </span>`).join('');

  const bars = rows.map((r) => {
    const tip = [`${r.label}: ${formatNumber(r.total)} titik`,
      ...kategoriList.filter((k) => r.counts[k]).map((k) => `${KATEGORI_META[k].label}: ${formatNumber(r.counts[k])}`)].join('\n');
    const segments = kategoriList.filter((k) => r.counts[k]).map((k) =>
      `<span class="stat-seg" style="flex:${r.counts[k]} 1 0;background:${KATEGORI_META[k].color}"></span>`).join('');
    return `
      <li class="stat-row" tabindex="0" data-tip="${escapeHtml(tip)}">
        <span class="stat-label" title="${escapeHtml(r.key)}">${escapeHtml(r.label)}</span>
        <span class="stat-track"><span class="stat-stack" style="width:${percent(r.total, max)}%">${segments}</span></span>
        <span class="stat-value">${formatNumber(r.total)}</span>
      </li>`;
  }).join('');

  const table = `
    <details class="stat-table-wrap">
      <summary>Lihat sebagai tabel</summary>
      <div class="overflow-x-auto">
        <table class="stat-table">
          <thead><tr><th scope="col">${provinsi === 'all' ? 'Provinsi' : 'Kab/Kota'}</th>${kategoriList.map((k) => `<th scope="col">${escapeHtml(KATEGORI_META[k].label)}</th>`).join('')}<th scope="col">Total</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><th scope="row">${escapeHtml(r.label)}</th>${kategoriList.map((k) => `<td>${formatNumber(r.counts[k] || 0)}</td>`).join('')}<td><b>${formatNumber(r.total)}</b></td></tr>`).join('')}</tbody>
        </table>
      </div>
    </details>`;

  $('stats-sebaran').innerHTML = `
    ${cardHeader(provinsi === 'all' ? 'Sebaran Titik per Provinsi' : `Sebaran Titik per Kab/Kota · ${provinsi}`, 'stacked_bar_chart', `${label} · ${formatNumber(list.length)} titik, menurut kategori pengelola`)}
    <div class="flex flex-wrap gap-x-4 gap-y-1.5 text-xs" aria-label="Legenda kategori">${legend}</div>
    <ul class="stat-list">${bars || '<li class="text-xs text-on-surface-variant">Belum ada titik.</li>'}</ul>
    ${table}`;
}

// ============================================================================
// Daftar batang satu seri
// ============================================================================
function renderStatsBarList(id, { title, icon, note, rows, total, wide = false }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const items = rows.map((r) => {
    const label = r.label || r.key;
    const marker = r.dot
      ? `<span class="w-2 h-2 rounded-full shrink-0 ${r.dot}"></span>`
      : r.icon ? `<span class="material-symbols-outlined text-[15px] text-on-surface-variant shrink-0">${r.icon}</span>` : '';
    const tip = `${label}\n${formatNumber(r.count)} titik (${formatDecimal(percent(r.count, total), 1)}%)`;
    return `
      <li class="stat-row${wide ? ' stat-row--wide' : ''}" tabindex="0" data-tip="${escapeHtml(tip)}">
        <span class="stat-label flex items-center gap-1.5" title="${escapeHtml(r.key)}">${marker}<span class="truncate">${escapeHtml(label)}</span></span>
        <span class="stat-track"><span class="stat-bar" style="width:${percent(r.count, max)}%;background:${STAT_BAR_COLOR}"></span></span>
        <span class="stat-value">${formatNumber(r.count)}</span>
      </li>`;
  }).join('');
  $(id).innerHTML = `${cardHeader(title, icon, note)}
    <ul class="stat-list">${items || '<li class="text-xs text-on-surface-variant">Belum ada data.</li>'}</ul>`;
}

// ============================================================================
// Cakupan layanan per provinsi (estimasi model, dihitung server)
// ============================================================================
function loadStatsCoverage() {
  const key = statsDataKey();
  if (statsCoverage.key !== key || !statsCoverage.promise) {
    statsCoverage.key = key;
    const regions = ['all', ...provinsiList()];
    statsCoverage.promise = Promise.all(regions.map((p) =>
      api(`/cakupan/wilayah?${new URLSearchParams({ provinsi: p, wilayah: 'all' })}`).then((res) => [p, res.data])))
      .then((entries) => new Map(entries))
      .catch((err) => {
        statsCoverage.promise = null; // boleh dicoba lagi
        throw err;
      });
  }
  return statsCoverage.promise;
}

function isBatasBawah(d) {
  return d.jumlahKantorTanpaData > 0 || !d.jumlahDataAsli;
}

async function renderStatsCoverage(provinsi) {
  const renderId = ++statsRenderId;
  const card = $('stats-cakupan');
  card.innerHTML = `${cardHeader('Cakupan Layanan per Provinsi', 'hub', 'Estimasi model: debit → sambungan rumah → kecamatan tercakup')}
    <div class="flex items-center gap-2 text-xs text-on-surface-variant py-2">
      <span class="material-symbols-outlined text-[16px] spin">progress_activity</span>Menghitung cakupan layanan…</div>`;

  let data;
  try {
    data = await loadStatsCoverage();
  } catch (err) {
    if (renderId !== statsRenderId) return;
    card.innerHTML = `${cardHeader('Cakupan Layanan per Provinsi', 'hub')}<p class="text-xs text-error">${escapeHtml(err.message || 'Gagal menghitung cakupan')}</p>`;
    $('stats-kpi-penduduk').textContent = '-';
    $('stats-kpi-penduduk-note').textContent = 'cakupan gagal dihitung';
    return;
  }
  if (renderId !== statsRenderId) return; // provinsi sudah berganti

  const pilihan = data.get(provinsi) || data.get('all');
  const persen = pilihan.persenPendudukTerlayani;
  $('stats-kpi-penduduk').textContent = persen != null ? `${isBatasBawah(pilihan) ? '≥ ' : ''}${formatDecimal(persen)}%` : '-';
  $('stats-kpi-penduduk-note').textContent = `± ${formatNumber(pilihan.totalJiwaTerlayani)} dari ${formatNumber(pilihan.penduduk)} jiwa`;

  const rows = provinsiList().map((p) => ({ p, d: data.get(p) })).filter((r) => r.d);
  const items = rows.map(({ p, d }) => {
    const persenKec = percent(d.jumlahKecamatanTercakup, d.jumlahKecamatan);
    const persenJiwa = d.persenPendudukTerlayani != null ? `${isBatasBawah(d) ? '≥ ' : ''}${formatDecimal(d.persenPendudukTerlayani)}%` : '-';
    const tip = [p,
      `Kecamatan tercakup: ${d.jumlahKecamatanTercakup} dari ${d.jumlahKecamatan} (${formatDecimal(persenKec, 1)}%)`,
      `Kapasitas: ± ${formatNumber(d.totalKapasitasSR)} SR`,
      `Penduduk terlayani: ${persenJiwa}`,
      `${d.jumlahSumberDihitung} sumber dihitung, ${d.jumlahKantorTanpaData} kantor PDAM belum ada data`].join('\n');
    const dim = provinsi !== 'all' && provinsi !== p;
    return `
      <li class="stat-cov${dim ? ' is-dim' : ''}" tabindex="0" data-tip="${escapeHtml(tip)}">
        <div class="flex items-baseline justify-between gap-2">
          <span class="font-semibold text-on-surface text-sm">${escapeHtml(p)}</span>
          <span class="text-xs text-on-surface-variant tabular">${d.jumlahKecamatanTercakup}/${d.jumlahKecamatan} kec.</span>
        </div>
        <span class="stat-track stat-track--full"><span class="stat-bar" style="width:${persenKec}%;background:${STAT_BAR_COLOR}"></span></span>
        <span class="text-xs text-on-surface-variant tabular">± ${formatNumber(d.totalKapasitasSR)} SR · ${persenJiwa} penduduk</span>
      </li>`;
  }).join('');

  card.innerHTML = `
    ${cardHeader('Cakupan Layanan per Provinsi', 'hub', 'Batang = persen kecamatan yang tercakup minimal satu sumber (skala 0–100%)')}
    <ul class="flex flex-col gap-3">${items}</ul>
    <div class="flex items-start gap-1.5 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-snug" role="note">
      <span class="material-symbols-outlined text-[16px] shrink-0">info</span>
      <span><b>Estimasi batas bawah.</b> Kapasitas sebagian besar memakai nilai tipikal, dan kantor PDAM tanpa data debit/jumlah SR belum ikut dihitung. Isi data lewat modul petugas agar angka makin akurat.</span>
    </div>`;
}

// ============================================================================
// Tooltip bersama (mouse & keyboard)
// ============================================================================
function bindStatTooltip() {
  const tip = $('stat-tip');
  const view = $('view-stats');
  const show = (el, x, y) => {
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const pad = 12;
    const { width, height } = tip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, x + pad));
    const top = y + pad + height > window.innerHeight ? y - height - pad : y + pad;
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  };
  const hide = () => { tip.hidden = true; };

  view.addEventListener('mousemove', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) show(el, e.clientX, e.clientY);
    else hide();
  });
  view.addEventListener('mouseleave', hide);
  view.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    show(el, r.left + r.width / 2, r.bottom);
  });
  view.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, { passive: true });
}

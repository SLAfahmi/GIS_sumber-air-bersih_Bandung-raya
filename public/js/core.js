/**
 * caiKU - GIS Air Bersih Pulau Jawa
 * Core: konstanta domain, state global, helper API & utilitas UI
 */

// ============================================================================
// Konstanta domain
// ============================================================================
const JAWA_CENTER = [-7.3, 110.0];
const JAWA_ZOOM = 7;

// Batas kasar Pulau Jawa + Madura + Kepulauan Seribu, dipakai untuk peringatan input koordinat
const JAWA_BOUNDS = { minLat: -9.0, maxLat: -5.0, minLng: 105.0, maxLng: 116.5 };

const NODE_ID_PREFIX = 'JAWA-';

// Kategori pengelola (harus sama dengan KATEGORI di config/constants.js)
const KATEGORI_META = {
  'Perumda': {
    label: 'Perumda (PDAM)',
    color: '#1d63c9',
    icon: 'apartment',
    badge: 'bg-blue-100 text-blue-800',
    banner: 'bg-blue-50 border-blue-200',
    accentText: 'text-blue-700',
    pill: 'bg-blue-600 text-white',
    deskripsi: 'Fasilitas perusahaan daerah air minum (PDAM/Perumda): kantor pelayanan, instalasi pengolahan, dan reservoar.',
    subnote: 'Titik kantor adalah lokasi kantor, bukan intake air baku.'
  },
  'Pemda': {
    label: 'Pemda',
    color: '#d97706',
    icon: 'account_balance',
    badge: 'bg-amber-100 text-amber-800',
    banner: 'bg-amber-50 border-amber-200',
    accentText: 'text-amber-700',
    pill: 'bg-amber-500 text-white',
    deskripsi: 'Infrastruktur air milik pemerintah daerah, misalnya rumah pompa.',
    subnote: 'Pengelola ditentukan dari wilayah lokasi; perlu konfirmasi dinas terkait.'
  },
  'Pamsimas': {
    label: 'Pamsimas',
    color: '#059669',
    icon: 'holiday_village',
    badge: 'bg-emerald-100 text-emerald-800',
    banner: 'bg-emerald-50 border-emerald-200',
    accentText: 'text-emerald-700',
    pill: 'bg-emerald-600 text-white',
    deskripsi: 'Sarana air minum berbasis masyarakat desa (program Pamsimas), dikelola KPSPAMS.',
    subnote: 'Data Pamsimas masih berupa contoh dari Google Maps, belum lengkap.'
  },
  'Kolam Retensi': {
    label: 'Kolam Retensi',
    color: '#7c3aed',
    icon: 'waves',
    badge: 'bg-violet-100 text-violet-800',
    banner: 'bg-violet-50 border-violet-200',
    accentText: 'text-violet-700',
    pill: 'bg-violet-600 text-white',
    deskripsi: 'Kolam penampung air hujan dan limpasan untuk pengendalian banjir dan konservasi air.',
    subnote: 'Di luar Bandung Raya, data kolam retensi masih berupa contoh.'
  }
};

const STATUS_VERIFIKASI_META = {
  'Terverifikasi lapangan': { short: 'Terverifikasi lapangan', icon: 'verified', badge: 'bg-emerald-100 text-emerald-800' },
  'Terverifikasi (Google Places)': { short: 'Terverifikasi Google', icon: 'travel_explore', badge: 'bg-sky-100 text-sky-800' },
  'Sesuai entri Google Maps (belum diverifikasi lapangan)': { short: 'Belum dicek lapangan', icon: 'pin_drop', badge: 'bg-surface-container-high text-on-surface-variant' },
  'Perlu cek ulang': { short: 'Perlu cek ulang', icon: 'report', badge: 'bg-yellow-100 text-yellow-800' }
};

const STATUS_META = {
  'Beroperasi Normal': { short: 'Normal', dot: 'bg-tertiary', text: 'text-tertiary', active: true },
  'Debit Menurun': { short: 'Debit Menurun', dot: 'bg-amber-500', text: 'text-amber-700', active: true },
  'Pemeliharaan': { short: 'Pemeliharaan', dot: 'bg-outline', text: 'text-on-surface-variant', active: false },
  'Rusak': { short: 'Rusak', dot: 'bg-error', text: 'text-error', active: false }
};

// Jenis fasilitas mengikuti kolom Kategori di xlsx sumber data (lihat SUMBER_DATA.md)
const JENIS_FASILITAS = [
  { value: 'Kantor PDAM (Pusat/Utama)', icon: 'corporate_fare' },
  { value: 'Kantor Cabang/Unit PDAM', icon: 'storefront' },
  { value: 'Instalasi PDAM (IPA/Intake/Reservoar)', icon: 'factory' },
  { value: 'Reservoar PDAM', icon: 'propane_tank' },
  { value: 'IPAL', icon: 'recycling' },
  { value: 'Rumah Pompa', icon: 'plumbing' },
  { value: 'Kolam Retensi', icon: 'waves' },
  { value: 'Pamsimas', icon: 'holiday_village' }
];

const LOG_FIELD_LABEL = {
  nodeId: 'Node ID',
  nama: 'Nama Fasilitas',
  kategori: 'Kategori',
  wilayah: 'Wilayah',
  kecamatan: 'Kecamatan',
  desaKelurahan: 'Desa/Kelurahan',
  alamat: 'Alamat',
  wilayahLayanan: 'Wilayah Layanan',
  pengelola: 'Pengelola',
  jenisFasilitas: 'Jenis Fasilitas',
  latitude: 'Latitude',
  longitude: 'Longitude',
  statusOperasional: 'Status Operasional',
  statusVerifikasi: 'Status Verifikasi',
  catatanData: 'Catatan',
  sumberUrl: 'Link Google Maps',
  dibuat: 'Titik ditambahkan'
};

function kategoriMeta(kategori) {
  return KATEGORI_META[kategori] || KATEGORI_META.Perumda;
}

function statusVerifikasiMeta(status) {
  if (!status) return null;
  return STATUS_VERIFIKASI_META[status] || { short: status, icon: 'info', badge: 'bg-surface-container-high text-on-surface-variant' };
}

function verifikasiBadge(status, { size = 'text-[10px]' } = {}) {
  const meta = statusVerifikasiMeta(status);
  if (!meta) return '';
  return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${size} font-bold whitespace-nowrap ${meta.badge}" title="${escapeHtml(status)}">
    <span class="material-symbols-outlined text-[13px]">${meta.icon}</span>${escapeHtml(meta.short)}</span>`;
}

function statusMeta(status) {
  return STATUS_META[status] || { short: status || '-', dot: 'bg-outline', text: 'text-on-surface-variant', active: true };
}

function jenisIcon(jenis) {
  return JENIS_FASILITAS.find((j) => j.value === jenis)?.icon || 'water_drop';
}

// Judul titik: nama dari data, atau jenis fasilitas bila tidak bernama
function facilityTitle(item) {
  return item.nama || item.jenisFasilitas;
}

// ============================================================================
// State global
// ============================================================================
const state = {
  facilities: [],
  facilityById: new Map(),
  wilayahList: [],
  pengelolaList: [],
  stats: null,
  auth: null,
  userCoords: null
};

function setFacilities(list) {
  state.facilities = list;
  state.facilityById = new Map(list.map((item) => [item.id, item]));
}

function countBy(list, key) {
  return list.reduce((acc, item) => {
    acc[item[key]] = (acc[item[key]] || 0) + 1;
    return acc;
  }, {});
}

// Jenis baku + jenis lain yang mungkin sudah ada di database
function allJenisValues() {
  const known = JENIS_FASILITAS.map((j) => j.value);
  const extra = [...new Set(state.facilities.map((f) => f.jenisFasilitas))].filter((j) => j && !known.includes(j)).sort();
  return [...known, ...extra];
}

// ============================================================================
// Helper API
// ============================================================================
async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.auth?.token) headers.Authorization = `Bearer ${state.auth.token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    // respons bukan JSON
  }

  if (res.status === 401 && !path.startsWith('/auth/') && state.auth) {
    handleSessionExpired();
  }

  if (!res.ok || !json?.success) {
    const error = new Error(json?.message || `Permintaan gagal (HTTP ${res.status})`);
    error.status = res.status;
    throw error;
  }
  return json;
}

// ============================================================================
// Utilitas umum
// ============================================================================
const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// Tampilkan/sembunyikan elemen yang memakai kelas display Tailwind (flex, grid, dll)
function setVisible(el, visible, display = 'flex') {
  const node = typeof el === 'string' ? $(el) : el;
  if (!node) return;
  node.classList.toggle('hidden', !visible);
  node.classList.toggle(display, visible);
}

const dateFormatter = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });

function formatDate(value, { withTime = false } = {}) {
  const date = new Date(value);
  if (isNaN(date)) return '-';
  return withTime ? `${dateFormatter.format(date)}, ${timeFormatter.format(date)}` : dateFormatter.format(date);
}

function formatRelativeDate(value) {
  const date = new Date(value);
  if (isNaN(date)) return '-';
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((startOfToday - new Date(date).setHours(0, 0, 0, 0)) / 86400000);
  if (diffDays === 0) return `Hari ini ${timeFormatter.format(date)}`;
  if (diffDays === 1) return `Kemarin ${timeFormatter.format(date)}`;
  return dateFormatter.format(date);
}

function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 2 : 1)} km`;
}

function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} menit`;
  return `${Math.floor(minutes / 60)} jam ${minutes % 60} menit`;
}

function shortWilayah(nama) {
  return (nama || '').replace(/^Kabupaten /, 'Kab. ');
}

function formatCoords(lat, lng) {
  return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
}

function isInsideJawa(lat, lng) {
  const b = JAWA_BOUNDS;
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

// ============================================================================
// Dropdown provinsi & wilayah (urutan dari API: provinsi barat → timur)
// ============================================================================
function provinsiList() {
  return [...new Set(state.wilayahList.map((w) => w.provinsi))];
}

// Opsi wilayah dikelompokkan per provinsi dengan <optgroup>
function wilayahOptgroups(list, { value = (w) => w.nama, label = (w) => shortWilayah(w.nama) } = {}) {
  const groups = new Map();
  list.forEach((w) => {
    if (!groups.has(w.provinsi)) groups.set(w.provinsi, []);
    groups.get(w.provinsi).push(w);
  });
  return [...groups].map(([provinsi, items]) =>
    `<optgroup label="${escapeHtml(provinsi)}">${items.map((w) =>
      `<option value="${escapeHtml(value(w))}">${escapeHtml(label(w))}</option>`).join('')}</optgroup>`
  ).join('');
}

function restoreSelectValue(select, value, fallback = 'all') {
  select.value = [...select.options].some((o) => o.value === value) ? value : fallback;
}

function fillProvinsiFilter(select) {
  const previous = select.value;
  select.innerHTML = '<option value="all">Semua Provinsi</option>' +
    provinsiList().map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  restoreSelectValue(select, previous);
}

// Opsi wilayah menyempit sesuai provinsi yang dipilih
function fillWilayahFilter(select, provinsi) {
  const previous = select.value;
  const list = provinsi === 'all' ? state.wilayahList : state.wilayahList.filter((w) => w.provinsi === provinsi);
  select.innerHTML = '<option value="all">Semua Wilayah</option>' + wilayahOptgroups(list);
  restoreSelectValue(select, previous);
}

function matchesRegion(item, provinsi, wilayah) {
  return (provinsi === 'all' || item.provinsi === provinsi) && (wilayah === 'all' || item.wilayahNama === wilayah);
}

// Haversine formula (km)
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Cadangan untuk browser tanpa Clipboard API / konteks tidak aman
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  }
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const storage = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // penyimpanan tidak tersedia (mode privat)
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // abaikan
    }
  }
};

// ============================================================================
// Toast notifikasi
// ============================================================================
let toastTimer = null;

function showToast(message, type = 'info') {
  const toast = $('toast');
  const toastIcon = $('toast-icon');
  $('toast-msg').textContent = message;

  const icons = {
    success: ['check_circle', 'text-emerald-400'],
    error: ['error', 'text-rose-400'],
    info: ['info', 'text-sky-400']
  };
  const [icon, color] = icons[type] || icons.info;
  toastIcon.textContent = icon;
  toastIcon.className = `material-symbols-outlined text-[18px] ${color}`;

  toast.classList.remove('translate-y-20', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-20', 'opacity-0');
  }, type === 'error' ? 5000 : 3500);
}

// ============================================================================
// Modal & dialog konfirmasi
// ============================================================================
function openModal(id) {
  $(id).classList.add('is-open');
}

function closeModal(id) {
  $(id).classList.remove('is-open');
}

function isModalOpen(id) {
  return $(id).classList.contains('is-open');
}

let confirmResolver = null;

function confirmDialog({ title, message, confirmLabel = 'Ya, lanjutkan', danger = false, icon }) {
  $('confirm-title').textContent = title;
  $('confirm-message').textContent = message;
  $('confirm-ok').textContent = confirmLabel;
  $('confirm-ok').classList.toggle('bg-error', danger);
  $('confirm-ok').classList.toggle('hover:bg-error', danger);
  $('confirm-icon').textContent = icon || (danger ? 'delete_forever' : 'help');
  $('confirm-icon-wrap').className = `w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-error-container text-error' : 'bg-primary-fixed text-primary'}`;

  if (confirmResolver) confirmResolver(false);
  openModal('modal-confirm');
  setTimeout(() => $('confirm-cancel').focus(), 50);
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function resolveConfirm(result) {
  closeModal('modal-confirm');
  if (confirmResolver) {
    confirmResolver(result);
    confirmResolver = null;
  }
}

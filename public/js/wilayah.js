/**
 * Batas wilayah di peta:
 * - Tanpa filter wilayah, peta tampil utuh (tidak ada mask).
 * - Saat provinsi / kab-kota dipilih di filter, area di luar wilayah itu "dipotong" (ditutup mask).
 * - Kab/kota terpilih menampilkan garis batas kecamatan sebagai konteks.
 * Data dari /data/batas (dibuat scripts/siapkan-batas-wilayah.js).
 */
const BATAS_BASE_URL = '/data/batas';
const batasCache = new Map();

let maskLayer = null;
let regionOutlineLayer = null;
let kecamatanContextLayer = null;
let regionRequestId = 0;
let currentRegionFeatures = null;

// Ring luar mask: seluruh dunia (batas proyeksi Web Mercator)
const WORLD_RING = [[-85, -180], [-85, 180], [85, 180], [85, -180]];
const MASK_COLOR = '#e9edf8';

function provinsiSlug(nama) {
  return String(nama).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function loadBatasFile(file) {
  if (!batasCache.has(file)) {
    const promise = fetch(`${BATAS_BASE_URL}/${file}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Batas wilayah ${file} tidak ditemukan (HTTP ${res.status})`);
        return res.json();
      })
      .catch((err) => {
        batasCache.delete(file); // boleh dicoba lagi
        throw err;
      });
    batasCache.set(file, promise);
  }
  return batasCache.get(file);
}

const loadProvinsiBatas = () => loadBatasFile('jawa-provinsi.geojson');
const loadKabKotaBatas = () => loadBatasFile('jawa-kabkota.geojson');
const loadKecamatanBatas = (provinsi) => loadBatasFile(`kecamatan/${provinsiSlug(provinsi)}.geojson`);

// GeoJSON [lng, lat] → ring Leaflet [lat, lng]
function geometryRings(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.flatMap((polygon) => polygon.map((ring) => ring.map(([lng, lat]) => [lat, lng])));
}

function initWilayahLayers() {
  // Mask di atas tile, di bawah garis wilayah, area cakupan, dan marker
  map.createPane('maskPane').style.zIndex = 350;
  map.createPane('regionPane').style.zIndex = 360;
  map.getPane('maskPane').style.pointerEvents = 'none';

  updateRegionMask({ fit: false });
}

function selectedRegion() {
  return { provinsi: $('filterProvinsi').value, wilayah: $('filterWilayah').value };
}

function hasRegionSelection() {
  const { provinsi, wilayah } = selectedRegion();
  return provinsi !== 'all' || wilayah !== 'all';
}

function setRegionMask(features) {
  const rings = features.flatMap((f) => geometryRings(f.geometry));
  const latlngs = [WORLD_RING, ...rings];
  if (maskLayer) {
    maskLayer.setLatLngs(latlngs);
  } else {
    maskLayer = L.polygon(latlngs, {
      pane: 'maskPane',
      interactive: false,
      stroke: false,
      fillColor: MASK_COLOR,
      fillOpacity: 1,
      fillRule: 'evenodd', // ring wilayah menjadi lubang; enklave (mis. Kota Bogor di Kab. Bogor) tetap tertutup
    }).addTo(map);
  }

  if (regionOutlineLayer) map.removeLayer(regionOutlineLayer);
  regionOutlineLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
    pane: 'regionPane',
    interactive: false,
    style: { color: '#006194', weight: 2, opacity: 0.85, fill: false, className: 'region-outline' },
  }).addTo(map);
}

// Tanpa wilayah terpilih: mask & garis tepi dihapus, peta tampil utuh
function clearRegionMask() {
  if (maskLayer) {
    map.removeLayer(maskLayer);
    maskLayer = null;
  }
  if (regionOutlineLayer) {
    map.removeLayer(regionOutlineLayer);
    regionOutlineLayer = null;
  }
  currentRegionFeatures = null;
}

function clearKecamatanContext() {
  if (kecamatanContextLayer) {
    map.removeLayer(kecamatanContextLayer);
    kecamatanContextLayer = null;
  }
}

// Garis batas kecamatan di dalam kab/kota terpilih, dengan nama saat kursor di atasnya
function showKecamatanContext(features) {
  clearKecamatanContext();
  kecamatanContextLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
    pane: 'regionPane',
    style: { color: '#006194', weight: 1, opacity: 0.5, dashArray: '3 4', fillColor: '#006194', fillOpacity: 0 },
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindTooltip(
        `<b>Kec. ${escapeHtml(p.nama)}</b><br>± ${formatNumber(p.penduduk)} jiwa (estimasi 2020)`,
        { sticky: true, direction: 'top', className: 'geo-tooltip' }
      );
      layer.on('mouseover', () => layer.setStyle({ fillOpacity: 0.06 }));
      layer.on('mouseout', () => layer.setStyle({ fillOpacity: 0 }));
    },
  }).addTo(map);
}

/**
 * Perbarui mask sesuai filter wilayah. fit=true → kamera menyesuaikan batas wilayah.
 */
async function updateRegionMask({ fit = false } = {}) {
  const requestId = ++regionRequestId;
  const { provinsi, wilayah } = selectedRegion();
  if (provinsi === 'all' && wilayah === 'all') {
    clearRegionMask();
    clearKecamatanContext();
    if (fit) fitMapToFacilities(visibleFacilities);
    return;
  }
  try {
    let features;
    let kecamatan = null;
    if (wilayah !== 'all') {
      const kab = await loadKabKotaBatas();
      features = kab.features.filter((f) => f.properties.nama === wilayah);
      const prov = features[0]?.properties.provinsi;
      if (prov) {
        const kecFc = await loadKecamatanBatas(prov);
        kecamatan = kecFc.features.filter((f) => f.properties.wilayahNama === wilayah);
      }
    } else {
      const prov = await loadProvinsiBatas();
      features = prov.features.filter((f) => f.properties.nama === provinsi);
    }
    if (requestId !== regionRequestId) return; // pilihan sudah berganti
    if (!features.length) throw new Error('Batas wilayah terpilih tidak ditemukan');

    currentRegionFeatures = features;
    setRegionMask(features);
    if (kecamatan?.length) showKecamatanContext(kecamatan);
    else clearKecamatanContext();
    if (fit) fitToCurrentRegion();
  } catch (err) {
    console.warn('Batas wilayah tidak dimuat:', err);
    if (requestId === regionRequestId && fit) fitMapToFacilities(visibleFacilities);
  }
}

function fitToCurrentRegion({ animate = true } = {}) {
  if (!currentRegionFeatures?.length) return false;
  const bounds = L.geoJSON({ type: 'FeatureCollection', features: currentRegionFeatures }).getBounds();
  if (!bounds.isValid()) return false;
  map.invalidateSize({ pan: false });
  map.fitBounds(bounds, { ...getMapPadding(), animate });
  return true;
}

/**
 * Atur filter wilayah dari kode (mis. aksi asisten AI): dropdown ikut berubah, peta dipotong & zoom
 * ke wilayah itu. Mengembalikan promise ringkasan cakupan wilayah agar pemanggil bisa menunggunya.
 */
function setRegionFilter(provinsi = 'all', wilayah = 'all') {
  restoreSelectValue($('filterProvinsi'), provinsi);
  fillWilayahFilter($('filterWilayah'), $('filterProvinsi').value);
  restoreSelectValue($('filterWilayah'), wilayah);
  applyMapFilters();
  updateRegionMask({ fit: true });
  return typeof refreshRegionSummary === 'function' ? refreshRegionSummary() : Promise.resolve();
}

// Dipanggil saat filter provinsi / kab-kota berubah
function onRegionFilterChange() {
  updateRegionMask({ fit: true });
  if (typeof refreshRegionSummary === 'function') refreshRegionSummary();
}

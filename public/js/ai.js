/**
 * Panel Asisten Cakupan AI (Google Gemini lewat /api/ai/chat).
 * Jawaban AI selalu bersumber dari fungsi analisis cakupan di server; kunci API tidak pernah ke browser.
 */
const aiState = {
  history: [],   // { peran: 'user' | 'ai', teks, nodeIds?, error? }
  busy: false,
  status: null,  // { aktif, model }
};

// Contoh dari beberapa provinsi; sebagian memicu aksi peta (potong wilayah, buka titik + area)
const AI_SUGGESTIONS = [
  'Buka Kota Semarang dan potong wilayahnya.',
  'Tampilkan Kabupaten Sidoarjo dan sorot kecamatan yang belum terlayani.',
  'Tunjukkan area layanan Pamsimas di Ciamis.',
  'Sumber mana yang melayani Kecamatan Lembang?',
  'Tampilkan hanya kolam retensi di DKI Jakarta.',
];

document.addEventListener('DOMContentLoaded', () => {
  const input = $('ai-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('ai-form').requestSubmit();
    }
  });
  // Tinggi textarea mengikuti isi
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
  });
});

async function ensureAiStatus() {
  if (aiState.status) return aiState.status;
  try {
    aiState.status = (await api('/ai/status')).data;
  } catch {
    aiState.status = { aktif: false };
  }
  $('ai-subtitle').textContent = aiState.status.aktif
    ? 'Google Gemini · menjawab dari model cakupan caiKU'
    : 'Belum dikonfigurasi (GEMINI_API_KEY kosong)';
  $('ai-subtitle').title = aiState.status.peringatan || '';
  return aiState.status;
}

function isAiPanelOpen() {
  return $('ai-panel').classList.contains('panel-open');
}

async function toggleAiPanel(open = !isAiPanelOpen()) {
  const panel = $('ai-panel');
  panel.classList.toggle('panel-open', open);
  panel.classList.toggle('panel-closed', !open);
  panel.setAttribute('aria-hidden', String(!open));
  $('btn-ai').classList.toggle('is-on', open);
  $('btn-ai').setAttribute('aria-expanded', String(open));
  if (!open) return;

  // Panel panorama memakai tempat yang sama di kanan
  if (typeof isStreetViewOpen === 'function' && isStreetViewOpen()) closeStreetView();
  if (isLayerPickerOpen()) toggleLayerPicker(false);
  updateAiContext();
  await ensureAiStatus();
  renderAiMessages();
  if (isWideScreen()) setTimeout(() => $('ai-input').focus(), 250);
}

function aiContext() {
  const drawerOpen = $('node-drawer').classList.contains('panel-open');
  const { provinsi, wilayah } = selectedRegion();
  return { nodeId: drawerOpen ? activeNode?.nodeId : undefined, provinsi, wilayah };
}

function updateAiContext() {
  const ctx = aiContext();
  const parts = [];
  if (ctx.nodeId) parts.push(`Titik ${ctx.nodeId}`);
  if (ctx.wilayah !== 'all') parts.push(shortWilayah(ctx.wilayah));
  else if (ctx.provinsi !== 'all') parts.push(ctx.provinsi);
  $('ai-context-text').textContent = parts.length ? `Konteks: ${parts.join(' · ')}` : 'Konteks: seluruh Pulau Jawa';
}

function resetAiChat() {
  aiState.history = [];
  renderAiMessages();
}

function submitAiForm(event) {
  event.preventDefault();
  const input = $('ai-input');
  const text = input.value.trim();
  if (!text || aiState.busy) return;
  input.value = '';
  input.style.height = 'auto';
  askAi(text);
}

function setAiBusy(busy) {
  aiState.busy = busy;
  $('ai-send').disabled = busy;
  $('ai-send-icon').textContent = busy ? 'progress_activity' : 'send';
  $('ai-send-icon').classList.toggle('spin', busy);
}

async function askAi(text) {
  if (aiState.busy) return;
  if (!isAiPanelOpen()) await toggleAiPanel(true);
  const status = await ensureAiStatus();
  updateAiContext();

  const riwayat = aiState.history.filter((m) => !m.error).slice(-10).map(({ peran, teks }) => ({ peran, teks }));
  aiState.history.push({ peran: 'user', teks: text });
  if (!status.aktif) {
    aiState.history.push({ peran: 'ai', error: true, teks: 'Asisten AI belum dikonfigurasi. Isi GEMINI_API_KEY di file .env server (gratis dari Google AI Studio), lalu restart server. Analisis cakupan di panel titik tetap bisa dipakai tanpa AI.' });
    renderAiMessages();
    return;
  }

  setAiBusy(true);
  renderAiMessages({ thinking: true });
  try {
    const { data } = await api('/ai/chat', { method: 'POST', body: { pesan: text, riwayat, konteks: aiContext() } });
    aiState.history.push({ peran: 'ai', teks: data.jawaban, nodeIds: data.nodeIds, model: data.model, aksi: data.aksi || [] });
    renderAiMessages();
    await runAiActions(data.aksi);
  } catch (err) {
    // bisaUlang: kegagalan jaringan/server (bukan konfigurasi) → tampilkan tombol "Coba lagi"
    aiState.history.push({ peran: 'ai', error: true, bisaUlang: true, teks: err.message || 'Asisten AI gagal menjawab.' });
  } finally {
    setAiBusy(false);
    renderAiMessages();
  }
}

// ============================================================================
// Aksi peta dari AI (server sudah memvalidasi wilayah & Node ID)
// ============================================================================
async function runAiActions(actions = []) {
  if (!actions?.length) return;
  if (currentView !== 'map') switchView('map');
  for (const action of actions) {
    try {
      await runAiAction(action);
    } catch (err) {
      console.warn('Aksi peta AI gagal:', action, err);
      showToast(err.message || 'Aksi peta gagal dijalankan', 'error');
    }
  }
  updateAiContext(); // baris "Konteks:" mengikuti wilayah/titik yang baru dibuka
  // Di HP panel AI menutupi peta: tutup agar hasilnya langsung terlihat
  if (!isWideScreen()) toggleAiPanel(false);
}

async function runAiAction(action) {
  if (action.tipe === 'kategori') {
    setCategoryFilter(action.kategori);
    return;
  }

  if (action.tipe === 'wilayah') {
    // Titik yang terbuka di luar wilayah baru ditutup; area cakupan selalu dilepas agar potongan wilayah terlihat
    if (activeNode && !matchesRegion(activeNode, action.provinsi, action.wilayah)) closeDrawer();
    else clearCoverageArea();
    await setRegionFilter(action.provinsi, action.wilayah);
    if (action.sorotCelah && lastRegionSummary && !gapLayer.getLayers().length) await toggleGapKecamatan();
    return;
  }

  if (action.tipe === 'titik') {
    const item = state.facilities.find((f) => f.nodeId === action.nodeId);
    if (!item) throw new Error(`Titik ${action.nodeId} tidak ada di peta`);
    // Pastikan marker titik tidak tersembunyi oleh filter yang sedang aktif
    const { provinsi, wilayah } = selectedRegion();
    if (!matchesRegion(item, provinsi, wilayah)) await setRegionFilter('all', 'all');
    if (activeCategory !== 'all' && activeCategory !== item.kategori) setCategoryFilter('all');
    focusFacility(item);
    if (action.area && coverageShownFor !== item.id) await toggleCoverageArea();
  }
}

function aiActionLabel(action) {
  if (action.tipe === 'wilayah') {
    if (action.wilayah !== 'all') return { icon: 'crop', text: `Potong ke ${shortWilayah(action.wilayah)}` };
    if (action.provinsi !== 'all') return { icon: 'crop', text: `Potong ke ${action.provinsi}` };
    return { icon: 'public', text: 'Seluruh Pulau Jawa' };
  }
  if (action.tipe === 'titik') return { icon: action.area ? 'radar' : 'location_on', text: `${action.nodeId}${action.area ? ' + area layanan' : ''}` };
  if (action.tipe === 'kategori') return { icon: 'filter_alt', text: action.kategori === 'all' ? 'Semua kategori' : `Hanya ${action.kategori}` };
  return { icon: 'map', text: 'Aksi peta' };
}

// Jalankan ulang aksi peta dari satu pesan AI (indeks riwayat, bukan teks, agar aman di onclick)
function replayAiActions(index) {
  const m = aiState.history[index];
  if (m?.aksi?.length) runAiActions(m.aksi);
}

// Kirim ulang pertanyaan terakhir yang gagal (pesan error & pertanyaannya dibuang dari riwayat dulu)
function retryLastAi() {
  const last = aiState.history[aiState.history.length - 1];
  const question = aiState.history[aiState.history.length - 2];
  if (aiState.busy || !last?.bisaUlang || question?.peran !== 'user') return;
  aiState.history.splice(-2, 2);
  askAi(question.teks);
}

function explainCoverageWithAi(nodeId) {
  askAi(`Jelaskan cakupan layanan titik ${nodeId}: berapa pelanggan (SR) dan jiwa yang bisa dilayani, kecamatan mana saja yang tercakup, dan asumsi apa yang dipakai. Bila cakupannya tidak dihitung, sebutkan sumber air terdekat.`);
}

function askAiAboutRegion() {
  const label = regionLabel(selectedRegion());
  askAi(`Ringkas cakupan layanan air bersih di ${label}: berapa kapasitas dan persen penduduk yang terlayani, sumber terbesar, dan kecamatan mana yang belum terlayani sumber tercatat?`);
}

// Teks jawaban → HTML aman: **tebal**, daftar "- ", dan Node ID yang bisa diklik
function formatAiText(text) {
  const inline = (line) => escapeHtml(line)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\b(JAWA-\d{3,})\b/g, '<button type="button" class="ai-node-link" onclick="openNodeFromAi(\'$1\')">$1</button>');

  const blocks = [];
  let list = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line) || /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) {
        list = [];
        blocks.push({ list });
      }
      list.push(inline(bullet[1]));
      continue;
    }
    list = null;
    if (line) blocks.push({ p: inline(line.replace(/^#+\s*/, '')) });
  }
  return blocks.map((b) => (b.list ? `<ul>${b.list.map((li) => `<li>${li}</li>`).join('')}</ul>` : `<p>${b.p}</p>`)).join('');
}

function openNodeFromAi(nodeId) {
  const item = state.facilities.find((f) => f.nodeId === nodeId);
  if (!item) {
    showToast(`Titik ${nodeId} tidak ditemukan`, 'error');
    return;
  }
  if (!isWideScreen()) toggleAiPanel(false); // di HP panel AI menutupi panel detail
  focusFacility(item);
}

function renderAiMessages({ thinking = false } = {}) {
  const box = $('ai-messages');
  const status = aiState.status;

  if (aiState.history.length === 0) {
    box.innerHTML = `
      <div class="flex flex-col gap-2 text-on-surface-variant leading-relaxed">
        <p class="text-on-surface font-semibold">Halo! Saya membantu membaca cakupan layanan sumber air di Pulau Jawa.</p>
        <p>Saya menghitung dengan model cakupan caiKU: debit → jumlah sambungan rumah (SR) → area layanan → kecamatan tercakup. Angka yang masih estimasi akan saya tandai.</p>
        ${status && !status.aktif ? `<p class="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">Asisten AI belum aktif: isi <b>GEMINI_API_KEY</b> di file .env server. Analisis cakupan di panel titik tetap bisa dipakai.</p>` : ''}
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="spec-label">Contoh pertanyaan</span>
        ${AI_SUGGESTIONS.map((q) => `<button type="button" class="ai-suggestion" onclick="askAi(this.textContent.trim())">${escapeHtml(q)}</button>`).join('')}
        ${activeNode ? `<button type="button" class="ai-suggestion" onclick="explainCoverageWithAi('${escapeHtml(activeNode.nodeId)}')">Berapa pelanggan yang bisa dilayani ${escapeHtml(activeNode.nodeId)}?</button>` : ''}
      </div>`;
    return;
  }

  const lastIndex = aiState.history.length - 1;
  box.innerHTML = aiState.history.map((m, i) => {
    if (m.peran === 'user') return `<div class="ai-msg ai-msg--user">${escapeHtml(m.teks)}</div>`;
    const retry = m.bisaUlang && i === lastIndex && !thinking
      ? `<div class="pt-1.5"><button type="button" class="ai-chip" onclick="retryLastAi()"><span class="material-symbols-outlined text-[13px]">refresh</span>Coba lagi</button></div>`
      : '';
    const chips = (m.nodeIds || []).slice(0, 6)
      .map((id) => `<button type="button" class="ai-chip" onclick="openNodeFromAi('${escapeHtml(id)}')"><span class="material-symbols-outlined text-[13px]">location_on</span>Buka ${escapeHtml(id)}</button>`)
      .join('');
    const actions = (m.aksi || []).map(aiActionLabel);
    const actionRow = actions.length
      ? `<div class="ai-actions"><span class="ai-actions-label"><span class="material-symbols-outlined text-[14px]">map</span>Peta diperbarui:</span>
          <button type="button" class="ai-chip" onclick="replayAiActions(${i})" title="Tampilkan lagi di peta">
            ${actions.map((a) => `<span class="material-symbols-outlined text-[13px]">${a.icon}</span>${escapeHtml(a.text)}`).join('<span class="text-outline">·</span>')}
          </button></div>`
      : '';
    const modelNote = m.model ?`<div class="text-[11px] text-outline pt-1.5">Dijawab ${escapeHtml(m.model)}</div>` : '';
    return `<div class="ai-msg ai-msg--ai${m.error ? ' is-error' : ''}">${m.error ? `<p>${escapeHtml(m.teks)}</p>` : formatAiText(m.teks)}${actionRow}${chips ? `<div class="flex flex-wrap gap-1.5 pt-1">${chips}</div>` : ''}${retry}${modelNote}</div>`;
  }).join('') + (thinking ? `<div class="ai-msg ai-msg--ai text-on-surface-variant flex items-center gap-2"><span class="material-symbols-outlined text-[16px] spin">progress_activity</span>Menganalisis data cakupan...</div>` : '');
  box.scrollTop = box.scrollHeight;
}

/**
 * Autentikasi Petugas GIS: mode publik (lihat peta) vs mode petugas (kelola data)
 */
const AUTH_STORAGE_KEY = 'caiku.auth';
let pendingAfterLogin = null;

function loadStoredAuth() {
  const saved = storage.get(AUTH_STORAGE_KEY);
  if (saved?.token && saved.expiresAt > Date.now()) {
    state.auth = saved;
  } else {
    storage.remove(AUTH_STORAGE_KEY);
  }
}

function isLoggedIn() {
  return Boolean(state.auth && state.auth.expiresAt > Date.now());
}

function setAuth(auth) {
  state.auth = auth;
  if (auth) storage.set(AUTH_STORAGE_KEY, auth);
  else storage.remove(AUTH_STORAGE_KEY);
  renderAuthUI();
}

function renderAuthUI() {
  const loggedIn = isLoggedIn();
  setVisible('auth-guest', !loggedIn);
  setVisible('auth-user', loggedIn);
  $('nav-crud-lock').classList.toggle('hidden', loggedIn);

  if (loggedIn) {
    const { user, expiresAt } = state.auth;
    $('auth-user-name').textContent = user.name;
    $('auth-user-meta').textContent = `@${user.username} • sesi s/d ${timeFormatter.format(new Date(expiresAt))}`;
  }
}

// Jalankan aksi yang butuh login; jika belum login, tampilkan modal lalu lanjutkan setelah berhasil
function requireLogin(onSuccess, message) {
  if (isLoggedIn()) {
    onSuccess?.();
    return;
  }
  openLoginModal(message, onSuccess);
}

function openLoginModal(message = 'Masuk untuk mengelola titik fasilitas air.', onSuccess = null) {
  pendingAfterLogin = onSuccess;
  $('login-message').textContent = message;
  setVisible('login-error', false);
  toggleSidebar(false);
  openModal('modal-login');
  setTimeout(() => $('login-username').focus(), 50);
}

function closeLoginModal() {
  pendingAfterLogin = null;
  closeModal('modal-login');
}

function togglePasswordVisibility() {
  const input = $('login-password');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('login-password-icon').textContent = show ? 'visibility_off' : 'visibility';
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const btn = $('btn-login-submit');
  btn.disabled = true;
  setVisible('login-error', false);

  try {
    const json = await api('/auth/login', {
      method: 'POST',
      body: { username: $('login-username').value.trim(), password: $('login-password').value }
    });
    setAuth(json.data);

    const next = pendingAfterLogin;
    pendingAfterLogin = null;
    closeModal('modal-login');
    $('login-password').value = '';
    showToast(`Selamat datang, ${json.data.user.name}`, 'success');
    next?.();
  } catch (err) {
    $('login-error-text').textContent = err.message;
    setVisible('login-error', true);
    $('login-password').select();
  } finally {
    btn.disabled = false;
  }
}

async function logout() {
  const ok = await confirmDialog({
    title: 'Keluar dari mode petugas?',
    message: 'Anda akan kembali ke mode publik yang hanya dapat melihat peta.',
    confirmLabel: 'Keluar',
    icon: 'logout'
  });
  if (!ok) return;

  setAuth(null);
  switchView('map');
  showToast('Anda telah keluar. Mode publik aktif.', 'info');
}

// Cek ulang token tersimpan ke server saat aplikasi dibuka; token tidak valid dihapus diam-diam
async function verifySession() {
  if (!state.auth) return;
  try {
    await api('/auth/me');
  } catch (err) {
    if (err.status === 401) setAuth(null);
  }
}

function handleSessionExpired() {
  setAuth(null);
  if (currentView === 'crud') switchView('map');
  openLoginModal('Sesi petugas berakhir. Silakan login kembali.', () => switchView('crud'));
}

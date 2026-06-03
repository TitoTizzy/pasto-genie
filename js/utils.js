// ================================================================
//  PASTO GÉNIE — Utilitaires partagés
// ================================================================

/** Toast notifications */
export function toast(msg, type = 'info', duration = 4000) {
  const icons = { success: 'ri-checkbox-circle-line', error: 'ri-error-warning-line', info: 'ri-information-line' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="${icons[type] || icons.info}"></i><span>${msg}</span>`;
  document.getElementById('toast-container')?.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 320);
  }, duration);
}

/** Pulse an element with scorePop animation */
export function pulsify(el) {
  if (!el) return;
  el.classList.remove('score-pulse');
  void el.offsetWidth;
  el.classList.add('highlight');
  setTimeout(() => el.classList.remove('highlight'), 600);
}

/** Floating +N pts animation */
export function floatPts(x, y, pts, positive = true) {
  const el = document.createElement('div');
  el.className = 'floating-pts';
  el.style.cssText = `left:${x}px;top:${y}px;color:${positive ? 'var(--green)' : 'var(--red)'}`;
  el.textContent = positive ? `+${pts}` : '✕';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

/** Format seconds → MM:SS */
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/** Show/hide an overlay */
export function openOverlay(id)  { document.getElementById(id)?.classList.add('open'); }
export function closeOverlay(id) { document.getElementById(id)?.classList.remove('open'); }

/** Show/hide sections (admin sidebar nav) */
export function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  document.querySelectorAll('.sidebar-link').forEach(l => {
    l.classList.toggle('active', l.dataset.section === id);
  });
}

/** Show inline alert */
export function showAlert(msgId, alertId, msg) {
  const msgEl    = document.getElementById(msgId);
  const alertEl  = document.getElementById(alertId);
  if (msgEl)   msgEl.textContent = msg;
  if (alertEl) alertEl.classList.remove('hidden');
}

/** Hide inline alert */
export function hideAlert(alertId) {
  document.getElementById(alertId)?.classList.add('hidden');
}

/** Generate a short player ID */
let _pid = 1;
export function nextPlayerId() { return `J${String(_pid++).padStart(2, '0')}`; }

/** Get active category from match data */
export function getActiveCat(matchData, CATEGORIES) {
  const ordre    = matchData?.categoriesOrdre || [];
  const actuelle = matchData?.categorieActuelle ?? 0;
  const catId    = ordre[actuelle];
  return CATEGORIES.find(c => c.id === catId) || null;
}

/** Render category track pills */
export function renderCatTrack(containerId, ordre, actuelle, CATEGORIES) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  ordre.forEach((catId, i) => {
    const meta = CATEGORIES.find(c => c.id === catId) || { emoji: '❓', label: catId };
    const pill = document.createElement('div');
    pill.className = 'cat-pill' +
      (i === actuelle ? ' active' : i < actuelle ? ' done' : '');
    pill.innerHTML = `${meta.emoji} ${meta.label}`;
    el.appendChild(pill);
  });
}

/** Auth error messages in French */
export function authErrMsg(code) {
  const text = String(code || '').toLowerCase();
  if (text.includes('invalid login') || text.includes('invalid credentials')) return 'Identifiants invalides.';
  if (text.includes('email')) return "Format d'e-mail invalide.";
  if (text.includes('password')) return 'Mot de passe invalide ou trop faible.';
  if (text.includes('rate') || text.includes('too many')) return 'Trop de tentatives. Reessayez plus tard.';
  if (text.includes('network')) return 'Erreur reseau. Verifiez votre connexion.';
  const map = {
    'auth/user-not-found':         'Aucun compte avec cet e-mail.',
    'auth/wrong-password':         'Mot de passe incorrect.',
    'auth/invalid-credential':     'Identifiants invalides.',
    'auth/invalid-email':          "Format d'e-mail invalide.",
    'auth/too-many-requests':      'Trop de tentatives. Réessayez plus tard.',
    'auth/network-request-failed': 'Erreur réseau. Vérifiez votre connexion.',
    'auth/email-already-in-use':   'Cet e-mail est déjà utilisé.',
    'auth/weak-password':          'Mot de passe trop faible (min. 6 caractères).',
  };
  return map[code] || code || 'Une erreur est survenue.';
}

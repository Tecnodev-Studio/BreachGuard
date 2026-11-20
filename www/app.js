import { checkEmail, checkPassword, validEmail, MAX_PASSWORD_LENGTH } from './js/lib.js';
import { pickLanguage, dirFor, t, SUPPORTED } from './js/i18n.js';
import { showMessage, renderEmailBreaches, renderSources, renderLearn, el } from './js/render.js';

const VERSION = '0.4.0';
const VIEWS = ['dashboard', 'email', 'password', 'sources', 'learn'];
const $ = (s) => document.querySelector(s);

// Defense-in-depth against framing. Real protection is the frame-ancestors
// header (see _headers); meta CSP cannot set it.
if (window.top !== window.self) {
  document.documentElement.hidden = true;
  try { window.top.location.replace(window.self.location.href); } catch { /* blocked */ }
}

// Session-only state. Holds outcome categories, never emails or passwords.
const state = { lang: 'en', view: 'dashboard', email: 'idle', password: 'idle' };

const STATUS_KEY = { idle: 'stIdle', found: 'stFound', not_found: 'stNotFound', unknown: 'stUnknown', error: 'stError' };
const STATUS_CLASS = { idle: 'idle', found: 'bad', not_found: 'ok', unknown: 'warn', error: 'warn' };

const tr = (key, params) => t(state.lang, key, params);
const isSecure = () => globalThis.isSecureContext === true;
const isOffline = () => navigator.onLine === false;

function setBadge(node, kind, label) {
  node.className = `status ${kind}`;
  node.textContent = label;
}

function renderDashboardStatus() {
  for (const k of ['email', 'password']) {
    setBadge($(`#st-${k}`), STATUS_CLASS[state[k]], tr(STATUS_KEY[state[k]]));
  }
  setBadge($('#st-connection'), isOffline() ? 'warn' : 'ok', tr(isOffline() ? 'stOffline' : 'stOnline'));
  setBadge($('#st-context'), isSecure() ? 'ok' : 'bad', tr(isSecure() ? 'stSecure' : 'stInsecure'));
  $('#offlineBanner').hidden = !isOffline();
}

function setOutcome(kind, outcome) {
  state[kind] = outcome;
  renderDashboardStatus();
}

function applyLanguage(lang, persist = true) {
  state.lang = lang;
  const root = document.documentElement;
  root.lang = lang;
  root.dir = dirFor(lang);
  document.title = 'BreachGuard';
  document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = tr(n.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((n) => { n.placeholder = tr(n.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-aria]').forEach((n) => { n.setAttribute('aria-label', tr(n.dataset.i18nAria)); });
  $('#footerText').textContent = tr('footer', { v: VERSION });
  syncPasswordToggle();
  renderSources(document, $('#sourceList'), lang);
  renderLearn(document, $('#learnList'), lang);
  for (const id of ['#emailResult', '#passwordResult']) {
    const n = $(id);
    n.replaceChildren();
    n.className = 'result hidden';
  }
  renderDashboardStatus();
  if (persist) {
    try { localStorage.setItem('bg.lang', lang); } catch { /* storage unavailable */ }
  }
}

function showView(id, { focus = false } = {}) {
  if (!VIEWS.includes(id)) id = 'dashboard';
  if (state.view === 'password' && id !== 'password') $('#passwordInput').value = '';
  state.view = id;
  for (const v of VIEWS) {
    const section = document.getElementById(v);
    section.classList.toggle('hidden', v !== id);
  }
  document.querySelectorAll('.tab').forEach((b) => {
    const active = b.dataset.view === id;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (focus) {
    const h = document.querySelector(`#${id} h1, #${id} h2`);
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  window.scrollTo(0, 0);
}

function navigate(id) {
  // Hash navigation gives the Android back button / browser history sensible behaviour.
  if (location.hash === `#${id}`) showView(id, { focus: true });
  else location.hash = id;
}

function errorKey(prefix, code) {
  if (code === 'rate_limited') return `${prefix}Rate`;
  if (code === 'timeout') return `${prefix}Timeout`;
  return `${prefix}Error`;
}

// ---------- email ----------
async function onEmailCheck() {
  const input = $('#emailInput');
  const consent = $('#emailConsent');
  const button = $('#emailBtn');
  const out = $('#emailResult');
  const email = input.value.trim();

  if (!validEmail(email)) return showMessage(document, out, tr('emailInvalid'), 'error');
  if (!consent.checked) return showMessage(document, out, tr('emailNeedConsent'), 'error');
  if (isOffline()) return showMessage(document, out, tr('emailOffline'), 'error');
  if (!isSecure()) return showMessage(document, out, tr('emailInsecure'), 'error');

  button.disabled = true;
  showMessage(document, out, tr('emailChecking'));
  try {
    const r = await checkEmail(email);
    if (r.status === 'found') {
      renderEmailBreaches(document, out, {
        title: tr('emailFoundTitle', { email }),
        note: tr('emailFoundNote', { n: r.breaches.length }),
        names: r.breaches,
        foot: tr('emailFoundFoot'),
        linkLabel: tr('openSource')
      });
      setOutcome('email', 'found');
    } else if (r.status === 'not_found') {
      showMessage(document, out, tr('emailNotFound'), 'success');
      setOutcome('email', 'not_found');
    } else {
      showMessage(document, out, tr('emailUnknown'), 'info');
      setOutcome('email', 'unknown');
    }
  } catch (e) {
    showMessage(document, out, tr(errorKey('email', e?.code)), 'error');
    setOutcome('email', 'error');
  } finally {
    consent.checked = false; // consent is per check
    button.disabled = false;
  }
}

// ---------- password ----------
function syncPasswordToggle() {
  const shown = $('#passwordInput').type === 'text';
  const b = $('#pwToggle');
  b.textContent = tr(shown ? 'pwHide' : 'pwShow');
  b.setAttribute('aria-pressed', String(shown));
}

async function onPasswordCheck() {
  const input = $('#passwordInput');
  const button = $('#passwordBtn');
  const out = $('#passwordResult');
  const password = input.value;

  if (!password) return showMessage(document, out, tr('pwEmpty'), 'error');
  if (password.length > MAX_PASSWORD_LENGTH) {
    input.value = '';
    return showMessage(document, out, tr('pwTooLong'), 'error');
  }
  if (isOffline()) { input.value = ''; return showMessage(document, out, tr('pwOffline'), 'error'); }
  if (!isSecure() || !globalThis.crypto?.subtle) {
    input.value = '';
    return showMessage(document, out, tr('pwInsecure'), 'error');
  }

  button.disabled = true;
  showMessage(document, out, tr('pwChecking'));
  try {
    const r = await checkPassword(password);
    if (r.status === 'found') {
      showMessage(document, out, tr('pwFound', { n: r.count.toLocaleString(state.lang) }), 'warning');
      setOutcome('password', 'found');
    } else {
      showMessage(document, out, tr('pwNotFound'), 'success');
      setOutcome('password', 'not_found');
    }
  } catch (e) {
    showMessage(document, out, tr(errorKey('pw', e?.code)), 'error');
    setOutcome('password', 'error');
  } finally {
    input.value = '';
    input.type = 'password';
    syncPasswordToggle();
    out.append(el(document, 'p', { cls: 'fine', text: tr('pwCleared') }));
    button.disabled = false;
  }
}

// ---------- wiring ----------
document.querySelectorAll('.tab, [data-goto]').forEach((b) => {
  b.addEventListener('click', () => navigate(b.dataset.view || b.dataset.goto));
});
window.addEventListener('hashchange', () => showView(location.hash.slice(1), { focus: true }));

$('#langBtn').addEventListener('click', () => {
  applyLanguage(SUPPORTED[(SUPPORTED.indexOf(state.lang) + 1) % SUPPORTED.length]);
});
$('#emailBtn').addEventListener('click', onEmailCheck);
$('#passwordBtn').addEventListener('click', onPasswordCheck);
$('#pwToggle').addEventListener('click', () => {
  const i = $('#passwordInput');
  i.type = i.type === 'password' ? 'text' : 'password';
  syncPasswordToggle();
});
for (const id of ['#emailInput', '#passwordInput']) {
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); (id === '#emailInput' ? onEmailCheck : onPasswordCheck)(); }
  });
}
window.addEventListener('online', renderDashboardStatus);
window.addEventListener('offline', renderDashboardStatus);

// Never leave a typed password sitting in a backgrounded page.
const clearPassword = () => { const i = $('#passwordInput'); i.value = ''; i.type = 'password'; syncPasswordToggle(); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') clearPassword(); });
window.addEventListener('pagehide', clearPassword);

let stored = null;
try { stored = localStorage.getItem('bg.lang'); } catch { /* storage unavailable */ }
applyLanguage(pickLanguage(stored, navigator.language), false);
showView(location.hash.slice(1));

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => { /* offline support is optional */ });
  });
}

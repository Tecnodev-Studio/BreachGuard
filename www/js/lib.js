// BreachGuard core logic. Pure functions and injectable dependencies so every
// behaviour can be unit-tested in Node without a browser.

export const PASSWORD_API = 'https://api.pwnedpasswords.com/range/';
export const EMAIL_API = 'https://api.xposedornot.com/v1/check-email/';
export const REQUEST_TIMEOUT_MS = 12000;
export const MAX_RESPONSE_CHARS = 1_000_000;
export const MAX_PASSWORD_LENGTH = 1024;
export const MAX_BREACH_NAMES = 500;
export const MAX_NAME_LENGTH = 100;

/** Hosts the app may link out to. Anything else is refused. */
export const ALLOWED_EXTERNAL_HOSTS = Object.freeze([
  'haveibeenpwned.com',
  'monitor.mozilla.org',
  'passwords.google.com',
  'xposedornot.com'
]);

/** Error with a stable machine-readable code (never contains user input). */
export class CheckError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CheckError';
    this.code = code;
  }
}

const LOCAL_PART = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

/** Conservative ASCII email validation (not a full RFC 5322 parser). */
export function validEmail(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 3 || value.length > 254) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !domain || domain.length > 253) return false;
  if (!LOCAL_PART.test(local)) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every((l) => l.length > 0 && l.length <= 63 && DOMAIN_LABEL.test(l)) &&
    /^[a-z]{2,}$/i.test(labels[labels.length - 1]);
}

/** Returns an https URL string only if its host is on the allowlist. */
export function safeExternalUrl(input, allowed = ALLOWED_EXTERNAL_HOSTS) {
  if (typeof input !== 'string') return null;
  let u;
  try { u = new URL(input); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password || u.port) return null;
  if (!allowed.includes(u.hostname.toLowerCase())) return null;
  return u.href;
}

/** SHA-1 as uppercase hex, computed locally with Web Crypto. */
export async function sha1Hex(value, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new CheckError('no_crypto');
  const digest = await subtle.digest('SHA-1', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Split a 40-char hash into the 5-char prefix (sent) and 35-char suffix (kept local). */
export function splitHash(hash) {
  if (!/^[0-9A-F]{40}$/.test(hash)) throw new CheckError('bad_hash');
  return { prefix: hash.slice(0, 5), suffix: hash.slice(5) };
}

/**
 * Parse a Pwned Passwords range body and look for `suffix`.
 * Padding entries (count 0) are ignored. A body with no valid lines is
 * treated as malformed rather than as "not found".
 */
export function parseRangeResponse(body, suffix) {
  if (typeof body !== 'string' || body.length > MAX_RESPONSE_CHARS) throw new CheckError('malformed_response');
  const want = String(suffix).toUpperCase();
  let valid = 0;
  let count = 0;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([0-9A-F]{35}):([0-9]{1,15})$/i.exec(line);
    if (!m) continue;
    valid += 1;
    if (m[1].toUpperCase() === want) count = Number(m[2]);
  }
  if (valid === 0) throw new CheckError('malformed_response');
  return count;
}

/** Extract a bounded, de-duplicated list of printable breach names. */
export function collectBreachNames(payload) {
  const out = [];
  const push = (v) => {
    if (typeof v !== 'string') return;
    const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
    if (s) out.push(s);
  };
  if (Array.isArray(payload?.breaches)) {
    for (const g of payload.breaches) {
      if (Array.isArray(g)) g.forEach(push); else push(g);
    }
  }
  return [...new Set(out)].slice(0, MAX_BREACH_NAMES);
}

/** fetch with a hard timeout that also covers reading the response body. */
export async function fetchWithTimeout(url, options = {}, consume = async (r) => r, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  if (typeof fetchImpl !== 'function') throw new CheckError('network');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer'
    });
    return await consume(response);
  } catch (e) {
    if (e instanceof CheckError) throw e;
    throw new CheckError(timedOut || e?.name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
}

async function readTextBounded(response) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_CHARS) throw new CheckError('response_too_large');
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARS) throw new CheckError('response_too_large');
  return text;
}

/**
 * Pwned Passwords k-anonymity check.
 * Only the first 5 hex chars of SHA-1(password) leave the device.
 * @returns {Promise<{status:'found'|'not_found', count:number}>}
 */
export async function checkPassword(password, deps = {}) {
  if (typeof password !== 'string' || password.length === 0) throw new CheckError('empty');
  if (password.length > MAX_PASSWORD_LENGTH) throw new CheckError('too_long');
  const hash = await sha1Hex(password, deps.subtle);
  const { prefix, suffix } = splitHash(hash);
  const body = await fetchWithTimeout(PASSWORD_API + prefix, {
    method: 'GET',
    headers: { 'Add-Padding': 'true', Accept: 'text/plain' }
  }, async (res) => {
    if (res.status === 429) throw new CheckError('rate_limited');
    if (!res.ok) throw new CheckError(`http_${res.status}`);
    return readTextBounded(res);
  }, deps);
  const count = parseRangeResponse(body, suffix);
  return count > 0 ? { status: 'found', count } : { status: 'not_found', count: 0 };
}

/**
 * XposedOrNot free-API email lookup. The full email address IS sent to the provider.
 * @returns {Promise<{status:'found', breaches:string[]}|{status:'not_found'}|{status:'unknown'}>}
 */
export async function checkEmail(email, deps = {}) {
  if (!validEmail(email)) throw new CheckError('invalid_email');
  const result = await fetchWithTimeout(EMAIL_API + encodeURIComponent(email), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  }, async (res) => {
    if (res.status === 404) return { notFound: true };
    if (res.status === 429) throw new CheckError('rate_limited');
    if (!res.ok) throw new CheckError(`http_${res.status}`);
    const text = await readTextBounded(res);
    try { return { payload: JSON.parse(text) }; } catch { throw new CheckError('malformed_response'); }
  }, deps);
  if (result.notFound) return { status: 'not_found' };
  const p = result.payload;
  if (p && typeof p === 'object' && (p.Error === 'Not found' || p.status === 'not_found')) return { status: 'not_found' };
  const names = collectBreachNames(p);
  return names.length ? { status: 'found', breaches: names } : { status: 'unknown' };
}

const crypto = require('crypto');

// Tenant API keys (TenantApiKey in schema.prisma). Only the SHA-256 hash is
// stored. A plain unsalted hash is enough here: the keys are 192 random bits,
// so there's nothing to brute-force or look up in a rainbow table, and an
// unsalted hash is what lets a request's key be found with one indexed lookup.
//
// hashApiKey must stay in step with the backfill in
// prisma/migrations/20260924120000_tenant_api_keys_and_consent.

const KEY_PREFIX_LENGTH = 9; // "tk_" + 6 hex chars — enough to tell keys apart, useless for guessing
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

function makeApiKey() {
  return `tk_${crypto.randomBytes(24).toString('hex')}`;
}

function hashApiKey(key) {
  return crypto.createHash('sha256').update(String(key), 'utf8').digest('hex');
}

function keyPrefix(key) {
  return String(key).slice(0, KEY_PREFIX_LENGTH);
}

// Creates a key row and returns the plaintext — the only time it's ever
// available. `db` is the prisma client or a transaction client.
async function issueApiKey(db, tenantId, label = 'Default') {
  const key = makeApiKey();
  const row = await db.tenantApiKey.create({
    data: { tenantId, keyHash: hashApiKey(key), keyPrefix: keyPrefix(key), label }
  });
  return { key, row };
}

// The key row for `providedKey` if it's a live key belonging to `tenantId`,
// else null. A key for a different tenant is rejected the same way as an
// unknown one, so callers can't probe which tenant a key belongs to.
async function findValidApiKey(db, tenantId, providedKey) {
  if (!providedKey || typeof providedKey !== 'string') return null;
  const row = await db.tenantApiKey.findUnique({ where: { keyHash: hashApiKey(providedKey) } });
  if (!row || row.tenantId !== tenantId || row.revokedAt) return null;
  return row;
}

// Bumps lastUsedAt at most once per interval — a write on every chat
// message would be pure overhead for a value only ever shown as "last used".
function shouldTouchLastUsed(row, now = Date.now()) {
  return !row.lastUsedAt || now - new Date(row.lastUsedAt).getTime() > LAST_USED_WRITE_INTERVAL_MS;
}

// ── Allowed websites. A widget key is effectively public — it ships in the
// embed snippet on the tenant's site — so it can't prove who is calling. What
// a browser CAN prove is the page's Origin, which a site can't forge for its
// visitors: a list of allowed origins stops other websites embedding the key
// and spending the tenant's budget. (A non-browser client can send any Origin;
// the per-visitor rate limits are what bound that.)
const MAX_ALLOWED_ORIGINS = 20;

/** "https://Shop.Acme.com/any/path" → "https://shop.acme.com"; null for anything that isn't an http(s) origin. */
function normalizeOrigin(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 255) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * A key's allowed-origins list from user input, every entry validated.
 * @returns {{ ok: true, origins: string[] } | { ok: false, error: string }}
 */
function normalizeAllowedOrigins(list) {
  if (!Array.isArray(list)) return { ok: false, error: 'allowedOrigins must be a list of website addresses' };
  if (list.length > MAX_ALLOWED_ORIGINS) return { ok: false, error: `A key can allow at most ${MAX_ALLOWED_ORIGINS} websites` };
  const origins = [];
  for (const entry of list) {
    const origin = normalizeOrigin(entry);
    if (!origin) return { ok: false, error: `"${String(entry).slice(0, 80)}" is not a website address like https://www.example.com` };
    if (!origins.includes(origin)) origins.push(origin);
  }
  return { ok: true, origins };
}

/**
 * Whether a request's Origin may use a key. No list = any origin; no Origin
 * header = not a cross-site browser request (a server, or the same site), so
 * it's allowed and left to the rate limits. A listed key refuses everything
 * else, including the opaque "null" origin of sandboxed iframes and file:// pages.
 */
function originAllowed(allowedOrigins, originHeader) {
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length) return true;
  if (originHeader === undefined || originHeader === null || originHeader === '') return true;
  const origin = normalizeOrigin(originHeader);
  return !!origin && allowedOrigins.includes(origin);
}

module.exports = {
  makeApiKey, hashApiKey, keyPrefix, issueApiKey, findValidApiKey, shouldTouchLastUsed, KEY_PREFIX_LENGTH,
  normalizeOrigin, normalizeAllowedOrigins, originAllowed, MAX_ALLOWED_ORIGINS
};

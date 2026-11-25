const prisma = require('../lib/prisma');
const { store, keys } = require('../lib/sharedStore');
const { ipBucket } = require('./shared/netGuard');
const { MAX_MINUTES: MAX_VOICE_MINUTES } = require('./voiceUsage');

// Per-tenant Guardrails config store (schema.prisma model TenantGuardrails):
// reading the row (with platform-default fallbacks for absent fields),
// validating a dashboard PATCH, and upserting it — plus the enforcement
// primitives (per-device rate limiting and country blocking) the chat routes
// call. Spam auto-pause lives with the turn it gates, in services/tenantChat.js.

// Shown in place of a bot reply once a visitor is over their per-device rate
// limit, when the tenant set no custom limitMessage.
const DEFAULT_LIMIT_MESSAGE =
  'You’re sending messages very quickly. Please wait a moment and try again.';

// CDN / proxy edge headers that carry the visitor's country (ISO-3166 alpha-2).
// Cloudflare uses "XX" for unknown / Tor / local — treated as absent (fail-open).
const COUNTRY_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country'];

const MAX_MESSAGES_MIN = 1;
const MAX_MESSAGES_MAX = 1000;
const WINDOW_SECONDS_MIN = 1;
const WINDOW_SECONDS_MAX = 3600;
const MAX_LIMIT_MESSAGE = 300;
const MAX_BLOCKED_COUNTRIES = 250;
const COUNTRY_RE = /^[A-Za-z]{2}$/; // ISO-3166 alpha-2; stored upper-case

const PUBLIC_FIELDS = {
  maxMessages: true, windowSeconds: true, limitMessage: true,
  spamCheckEnabled: true, blockedCountries: true, imagesEnabled: true,
  voiceMonthlyMinutes: true
};

// What a tenant with no saved row looks like (and the null-field defaults).
function defaults() {
  return {
    maxMessages: null, windowSeconds: null, limitMessage: null,
    spamCheckEnabled: false, blockedCountries: [], imagesEnabled: true,
    voiceMonthlyMinutes: null
  };
}

/** The tenant's guardrails config, or platform defaults when none is saved. */
async function getGuardrails(tenantId) {
  const row = await prisma.tenantGuardrails.findUnique({ where: { tenantId }, select: PUBLIC_FIELDS });
  return row || defaults();
}

// Validate one integer-or-null field within [min, max].
function parseIntField(body, key, min, max, data) {
  if (!(key in body)) return null;
  if (body[key] === null) { data[key] = null; return null; }
  const n = Number(body[key]);
  if (!Number.isInteger(n) || n < min || n > max) return `${key} must be an integer between ${min} and ${max}`;
  data[key] = n;
  return null;
}

/**
 * Validate a dashboard PATCH body into a Prisma data object. Only keys present in
 * the body are touched (partial update).
 * @returns {{ ok: true, data: object } | { ok: false, error: string }}
 */
function parseGuardrailsInput(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'A guardrails object is required' };
  const data = {};

  const intErr = parseIntField(body, 'maxMessages', MAX_MESSAGES_MIN, MAX_MESSAGES_MAX, data)
    || parseIntField(body, 'windowSeconds', WINDOW_SECONDS_MIN, WINDOW_SECONDS_MAX, data)
    // 0 = unlimited, so the floor is 0 (not 1); null clears back to the platform default.
    || parseIntField(body, 'voiceMonthlyMinutes', 0, MAX_VOICE_MINUTES, data);
  if (intErr) return { ok: false, error: intErr };

  if ('limitMessage' in body) {
    if (body.limitMessage === null || body.limitMessage === '') data.limitMessage = null;
    else if (typeof body.limitMessage !== 'string') return { ok: false, error: 'limitMessage must be text' };
    else data.limitMessage = body.limitMessage.trim().slice(0, MAX_LIMIT_MESSAGE);
  }

  if ('spamCheckEnabled' in body) {
    if (typeof body.spamCheckEnabled !== 'boolean') return { ok: false, error: 'spamCheckEnabled must be true or false' };
    data.spamCheckEnabled = body.spamCheckEnabled;
  }
  if ('imagesEnabled' in body) {
    if (typeof body.imagesEnabled !== 'boolean') return { ok: false, error: 'imagesEnabled must be true or false' };
    data.imagesEnabled = body.imagesEnabled;
  }

  if ('blockedCountries' in body) {
    if (!Array.isArray(body.blockedCountries)) return { ok: false, error: 'blockedCountries must be a list of ISO country codes' };
    if (body.blockedCountries.length > MAX_BLOCKED_COUNTRIES) return { ok: false, error: `At most ${MAX_BLOCKED_COUNTRIES} countries` };
    const out = [];
    for (const c of body.blockedCountries) {
      if (typeof c !== 'string' || !COUNTRY_RE.test(c.trim())) {
        return { ok: false, error: `"${String(c).slice(0, 16)}" is not a 2-letter ISO country code` };
      }
      const up = c.trim().toUpperCase();
      if (!out.includes(up)) out.push(up);
    }
    data.blockedCountries = out;
  }

  if (Object.keys(data).length === 0) return { ok: false, error: 'Nothing to update' };
  return { ok: true, data };
}

/** Upsert the tenant's guardrails row from a validated data object. */
async function saveGuardrails(tenantId, data) {
  return prisma.tenantGuardrails.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
    select: PUBLIC_FIELDS
  });
}

// ── Enforcement ────────────────────────────────────────────────────────────

/**
 * The identity a per-device rate limit counts against. On WhatsApp the phone
 * number is the device; on the web it's the widget's browserId paired with the
 * IP /64 (so clearing storage alone doesn't reset the count, and one NAT's many
 * visitors aren't merged). With neither, the IP bucket alone is the fallback.
 * @param {{ body?: object, ip?: string }} req
 */
function deviceKey({ body, ip }) {
  const phone = typeof body?.phone === 'string' && body.phone.trim() ? body.phone.trim().slice(0, 32) : null;
  if (phone) return `wa:${phone}`;
  const bucket = ipBucket(ip || 'unknown');
  const browserId = typeof body?.browserId === 'string' && body.browserId.trim()
    ? body.browserId.trim().slice(0, 100) : null;
  return browserId ? `web:${browserId}:${bucket}` : `ip:${bucket}`;
}

/**
 * True when this device has already used its allowance for the current window.
 * Dynamic (max/window come from the tenant's config, not a fixed limiter), so
 * it calls the sliding-window store directly. Fails open: a store outage returns
 * a 0 count, so a transient failure never locks real visitors out.
 * @returns {Promise<boolean>}
 */
async function isDeviceRateLimited({ tenantId, device, maxMessages, windowSeconds }) {
  if (!maxMessages || !windowSeconds) return false; // not configured → no per-device cap
  const count = await store().incrWindow(keys.rateLimit('guardrail-device', `${tenantId}:${device}`), windowSeconds * 1000);
  return count > maxMessages;
}

/**
 * The blocked country for this request, or null to allow it. Reads the CDN/proxy
 * country header; absent or unknown ("XX") means fail-open (allow), so a
 * deployment with no country edge never blocks everyone by accident.
 * @returns {string|null} the ISO-3166 alpha-2 code that is blocked, or null
 */
function blockedCountry(headers, blockedCountries) {
  if (!blockedCountries?.length) return null;
  let code = '';
  for (const h of COUNTRY_HEADERS) {
    const v = headers?.[h];
    if (typeof v === 'string' && v.trim()) { code = v.trim().toUpperCase(); break; }
  }
  if (!code || code === 'XX' || code === 'T1') return null; // unknown / Tor → fail-open
  return blockedCountries.includes(code) ? code : null;
}

module.exports = {
  getGuardrails, saveGuardrails, parseGuardrailsInput, defaults,
  PUBLIC_FIELDS, MAX_LIMIT_MESSAGE, MAX_BLOCKED_COUNTRIES,
  DEFAULT_LIMIT_MESSAGE, deviceKey, isDeviceRateLimited, blockedCountry
};

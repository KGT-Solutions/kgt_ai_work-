const crypto = require('crypto');
const { logger } = require('../lib/logger');
const net = require('net');
const defaultPrisma = require('../lib/prisma');
const { encrypt, decrypt, encryptionConfigured } = require('../utils/encryption');
const { publicAgent, resolvePublicHost, isPrivateAddress, privateHostsAllowed } = require('./shared/netGuard');
const { EVENTS, isEvent } = require('./integrationEvents');

// Generic outbound webhooks (Feature 8). A tenant can register HTTP endpoints
// and subscribe each to one or more events (lead.created, ticket.created,
// chat.session.completed). When an event fires, we POST a signed JSON envelope
// to every matching endpoint, with retry on transient failures, and record a
// delivery log row per attempt-set. Everything is strictly tenant-scoped.
//
// Security:
//   • The per-endpoint signing secret is generated here, stored AES-256-GCM
//     encrypted (utils/encryption.js) and returned to the client ONLY once — at
//     creation or rotation — so the receiver can verify signatures. list/get
//     never return it (only `secretSet`).
//   • Every delivery goes through netGuard: the URL is refused up front if it is
//     an IP literal in a private range, and the POST uses the publicAgent
//     dispatcher so each connection re-checks its resolved address (DNS-rebinding
//     safe), exactly like the crawler. A webhook can never be pointed at an
//     internal address or cloud metadata endpoint.
//   • Delivery logs store only { statusCode, error message } — never the request
//     body, the secret, or any response body.

const MAX_WEBHOOKS_PER_TENANT = Number(process.env.WEBHOOKS_MAX_PER_TENANT || 20);
const MAX_URL_LEN = 2048;
const MAX_DESC_LEN = 200;
const TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS || 10000);
const DELIVERIES_PAGE = 50;
const SECRET_BYTES = 24;
// Backoff for transient failures (network, timeout, 429, 5xx), same shape as the
// CRM sync retries (services/crm/zohoSync.js).
const RETRY_DELAYS_MS = String(process.env.WEBHOOK_RETRY_DELAYS_MS || '1000,5000')
  .split(',').map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0);

const sleep = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); });

class WebhookError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'WebhookError';
    this.statusCode = statusCode;
  }
}

// ── Validation ────────────────────────────────────────────────────────────

/** Parse + sanity-check a webhook URL. Rejects non-http(s) and private IP literals up front. */
function validateUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new WebhookError('A webhook URL is required.');
  if (value.length > MAX_URL_LEN) throw new WebhookError('That webhook URL is too long.');
  let parsed;
  try { parsed = new URL(value); } catch { throw new WebhookError('That is not a valid URL.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebhookError('Webhook URLs must start with http:// or https://');
  }
  // An IP-literal host never reaches a DNS lookup (sockets dial it directly), so
  // it is checked here; hostnames are re-checked at dial time by publicAgent.
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !privateHostsAllowed() && isPrivateAddress(host)) {
    throw new WebhookError('That address is not allowed.');
  }
  return parsed.toString();
}

function normalizeEvents(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const cleaned = [...new Set(list.map((e) => String(e || '').trim()).filter(Boolean))];
  const unknown = cleaned.filter((e) => !isEvent(e));
  if (unknown.length) throw new WebhookError(`Unknown event(s): ${unknown.join(', ')}. Choose from: ${EVENTS.join(', ')}`);
  if (!cleaned.length) throw new WebhookError('Subscribe the webhook to at least one event.');
  return cleaned;
}

// ── Views (never leak the secret) ───────────────────────────────────────────

function toView(row) {
  return {
    id: row.id,
    url: row.url,
    events: row.events || [],
    enabled: row.enabled !== false,
    description: row.description || '',
    secretSet: !!row.secret,
    lastStatus: row.lastStatus || null,
    lastDeliveryAt: row.lastDeliveryAt || null,
    failureCount: row.failureCount || 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

// ── CRUD ────────────────────────────────────────────────────────────────────

async function listWebhooks(tenantId, { prisma = defaultPrisma } = {}) {
  const rows = await prisma.tenantWebhook.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  return { webhooks: rows.map(toView), events: EVENTS, max: MAX_WEBHOOKS_PER_TENANT };
}

async function getWebhook(tenantId, id, { prisma = defaultPrisma } = {}) {
  const row = await prisma.tenantWebhook.findFirst({ where: { id, tenantId } });
  return row ? toView(row) : null;
}

/**
 * Create a webhook. Generates the signing secret, stores it encrypted, and
 * returns the view PLUS the plaintext secret exactly once so the owner can copy
 * it into their receiver.
 * @returns {Promise<object>} the view with an extra `secret` field (one-time)
 */
async function createWebhook(tenantId, { url, events, description = '', enabled = true } = {}, { prisma = defaultPrisma } = {}) {
  if (!encryptionConfigured()) throw new WebhookError('Secure storage is not configured on the server (ENCRYPTION_KEY is unset).', 503);
  const count = await prisma.tenantWebhook.count({ where: { tenantId } });
  if (count >= MAX_WEBHOOKS_PER_TENANT) throw new WebhookError(`You can have at most ${MAX_WEBHOOKS_PER_TENANT} webhooks.`, 409);
  const cleanUrl = validateUrl(url);
  const cleanEvents = normalizeEvents(events);
  const secret = `whsec_${crypto.randomBytes(SECRET_BYTES).toString('base64url')}`;
  const row = await prisma.tenantWebhook.create({
    data: {
      tenantId, url: cleanUrl, events: cleanEvents, enabled: enabled !== false,
      description: String(description || '').slice(0, MAX_DESC_LEN), secret: encrypt(secret)
    }
  });
  return { ...toView(row), secret };
}

async function updateWebhook(tenantId, id, patch = {}, { prisma = defaultPrisma } = {}) {
  const existing = await prisma.tenantWebhook.findFirst({ where: { id, tenantId } });
  if (!existing) throw new WebhookError('Webhook not found.', 404);
  const data = {};
  if (patch.url !== undefined) data.url = validateUrl(patch.url);
  if (patch.events !== undefined) data.events = normalizeEvents(patch.events);
  if (patch.enabled !== undefined) data.enabled = !!patch.enabled;
  if (patch.description !== undefined) data.description = String(patch.description || '').slice(0, MAX_DESC_LEN);
  if (!Object.keys(data).length) throw new WebhookError('Nothing to update.');
  const row = await prisma.tenantWebhook.update({ where: { id: existing.id }, data });
  return toView(row);
}

async function deleteWebhook(tenantId, id, { prisma = defaultPrisma } = {}) {
  const existing = await prisma.tenantWebhook.findFirst({ where: { id, tenantId } });
  if (!existing) throw new WebhookError('Webhook not found.', 404);
  await prisma.tenantWebhook.delete({ where: { id: existing.id } });
  return { deleted: true };
}

/** Rotate the signing secret; returns the new plaintext secret once. */
async function rotateSecret(tenantId, id, { prisma = defaultPrisma } = {}) {
  if (!encryptionConfigured()) throw new WebhookError('Secure storage is not configured on the server (ENCRYPTION_KEY is unset).', 503);
  const existing = await prisma.tenantWebhook.findFirst({ where: { id, tenantId } });
  if (!existing) throw new WebhookError('Webhook not found.', 404);
  const secret = `whsec_${crypto.randomBytes(SECRET_BYTES).toString('base64url')}`;
  const row = await prisma.tenantWebhook.update({ where: { id: existing.id }, data: { secret: encrypt(secret) } });
  return { ...toView(row), secret };
}

async function listDeliveries(tenantId, { webhookId = null, limit = DELIVERIES_PAGE, prisma = defaultPrisma } = {}) {
  const where = { tenantId, ...(webhookId ? { webhookId } : {}) };
  const rows = await prisma.webhookDelivery.findMany({
    where, orderBy: { createdAt: 'desc' }, take: Math.min(Number(limit) || DELIVERIES_PAGE, 200)
  });
  return { deliveries: rows };
}

// ── Signing + delivery ───────────────────────────────────────────────────────

/** The HMAC-SHA256 signature of `${timestamp}.${body}`, hex. The receiver recomputes it to verify authenticity. */
function signPayload(secret, timestamp, body) {
  return crypto.createHmac('sha256', String(secret)).update(`${timestamp}.${body}`).digest('hex');
}

function safeDecrypt(value) {
  if (!value) return null;
  try { return decrypt(value); } catch { return null; }
}

/**
 * POST the signed envelope to one endpoint, retrying transient failures. Never
 * throws: returns a small result describing the outcome.
 * @returns {Promise<{ ok: boolean, statusCode: number|null, attempts: number, error: string|null }>}
 */
async function deliverOnce(url, { secret, body, event, deliveryId, fetchImpl, now }) {
  const timestamp = Math.floor(now / 1000);
  const signature = secret ? signPayload(secret, timestamp, body) : '';
  const headers = {
    'content-type': 'application/json',
    'user-agent': 'KGT-Webhooks/1',
    'x-kgt-event': event,
    'x-kgt-delivery': deliveryId,
    'x-kgt-timestamp': String(timestamp),
    ...(signature ? { 'x-kgt-signature': `sha256=${signature}` } : {})
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { method: 'POST', headers, body, signal: controller.signal, dispatcher: publicAgent });
    const statusCode = res.status;
    if (statusCode >= 200 && statusCode < 300) return { ok: true, statusCode, error: null };
    const retryable = statusCode === 429 || statusCode >= 500;
    return { ok: false, statusCode, error: `HTTP ${statusCode}`, retryable };
  } catch (err) {
    // EPRIVATE (netGuard refused a non-public address) is NOT retryable.
    const retryable = err?.code !== 'EPRIVATE';
    return { ok: false, statusCode: null, error: String(err?.message || err).slice(0, 200), retryable };
  } finally {
    clearTimeout(timer);
  }
}

async function deliverWithRetry(url, opts) {
  let attempts = 0;
  let last = { ok: false, statusCode: null, error: 'not attempted' };
  for (let i = 0; ; i++) {
    attempts += 1;
    last = await deliverOnce(url, opts);
    if (last.ok) break;
    const delay = last.retryable ? RETRY_DELAYS_MS[i] : undefined;
    if (delay === undefined) break;
    await sleep(delay);
  }
  return { ...last, attempts };
}

/** Record one delivery outcome and update the webhook's rollup. Best-effort. */
async function recordDelivery(prisma, { tenantId, webhook, event, outcome, now }) {
  try {
    await prisma.webhookDelivery.create({
      data: {
        tenantId, webhookId: webhook.id, event,
        status: outcome.ok ? 'success' : 'failed',
        statusCode: outcome.statusCode ?? null,
        attempts: outcome.attempts || 1,
        error: outcome.ok ? null : String(outcome.error || 'failed').slice(0, 300)
      }
    });
  } catch (err) { logger.warn(`[webhooks] could not log delivery for ${webhook.id}: ${err.message}`); }
  try {
    await prisma.tenantWebhook.update({
      where: { id: webhook.id },
      data: {
        lastStatus: outcome.ok ? 'success' : 'failed',
        lastDeliveryAt: new Date(now),
        failureCount: outcome.ok ? 0 : { increment: 1 }
      }
    });
  } catch (err) { logger.warn(`[webhooks] could not update webhook ${webhook.id}: ${err.message}`); }
}

/**
 * Fan an event envelope out to every enabled webhook subscribed to it. Called by
 * integrationEvents.emitTenantEvent — fire-and-forget. Never throws.
 * @param {string} tenantId
 * @param {object} envelope { id, event, tenantId, createdAt, data }
 */
async function emitEvent(tenantId, envelope, deps = {}) {
  const prisma = deps.prisma || defaultPrisma;
  const fetchImpl = deps.fetchImpl || fetch;
  const now = deps.now || Date.now();
  const { event } = envelope;
  let rows;
  try {
    rows = await prisma.tenantWebhook.findMany({ where: { tenantId, enabled: true, events: { has: event } } });
  } catch (err) {
    logger.warn(`[webhooks] could not load webhooks for tenant ${tenantId}: ${err.message}`);
    return { delivered: 0 };
  }
  if (!rows.length) return { delivered: 0 };
  const body = JSON.stringify(envelope);
  let delivered = 0;
  await Promise.all(rows.map(async (webhook) => {
    const secret = safeDecrypt(webhook.secret);
    const outcome = await deliverWithRetry(webhook.url, {
      secret, body, event, deliveryId: `${envelope.id}-${webhook.id}`, fetchImpl, now
    });
    if (outcome.ok) delivered += 1;
    else logger.warn(`[webhooks] ${event} → ${webhook.id} failed (${outcome.statusCode || outcome.error}) after ${outcome.attempts} attempt(s)`);
    await recordDelivery(prisma, { tenantId, webhook, event, outcome, now });
  }));
  return { delivered, total: rows.length };
}

/**
 * Send a one-off `ping` test delivery to a single webhook, so the owner can
 * confirm their receiver works. Returns the outcome (and logs it).
 */
async function testWebhook(tenantId, id, deps = {}) {
  const prisma = deps.prisma || defaultPrisma;
  const fetchImpl = deps.fetchImpl || fetch;
  const now = deps.now || Date.now();
  const webhook = await prisma.tenantWebhook.findFirst({ where: { id, tenantId } });
  if (!webhook) throw new WebhookError('Webhook not found.', 404);
  const envelope = { id: crypto.randomUUID(), event: 'ping', tenantId, createdAt: new Date(now).toISOString(), data: { message: 'This is a test delivery from KGT AI Hub.' } };
  const secret = safeDecrypt(webhook.secret);
  const outcome = await deliverWithRetry(webhook.url, {
    secret, body: JSON.stringify(envelope), event: 'ping', deliveryId: `${envelope.id}-${webhook.id}`, fetchImpl, now
  });
  await recordDelivery(prisma, { tenantId, webhook, event: 'ping', outcome, now });
  return { ok: outcome.ok, statusCode: outcome.statusCode, attempts: outcome.attempts, error: outcome.ok ? null : outcome.error };
}

module.exports = {
  WebhookError,
  listWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  rotateSecret,
  listDeliveries,
  testWebhook,
  emitEvent,
  signPayload,
  validateUrl,
  normalizeEvents,
  MAX_WEBHOOKS_PER_TENANT,
  RETRY_DELAYS_MS,
  // internals exported for tests
  deliverWithRetry,
  _resolvePublicHost: resolvePublicHost
};

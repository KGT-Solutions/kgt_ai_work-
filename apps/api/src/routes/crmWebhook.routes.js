const express = require('express');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { applyInboundStatus } = require('../services/crm/zohoSync');
const { applyInboundStatus: applyHubspotStatus } = require('../services/crm/hubspotSync');
const { tenantIdForPortal } = require('../services/crm/hubspotSettings');
const { createIpRateLimiter } = require('../utils/ipRateLimit');

// Inbound CRM webhooks: a sales rep changing a lead's status inside Zoho
// mirrors back into KGT Orb in real time.
//
//   POST /api/v1/webhooks/zoho   (public; shared-secret authenticated)
//
// Zoho workflow "webhook" notifications are configured to POST here with a
// secret token (header x-zoho-webhook-token or ?token=) that must match
// ZOHO_WEBHOOK_SECRET. The payload is deliberately read loosely — Zoho's
// field names depend on how the workflow is set up — so we accept the record
// id, the new status and (optionally) the email/tenant under several common
// keys. The handler NEVER throws into Express: an unmatched or malformed
// event is acknowledged with a reason, not a 500, so Zoho doesn't hammer us
// with retries over something we can't act on.
const router = express.Router();

// Per-IP flood/brute-force guard, ahead of the shared-secret check so repeated
// token guesses are throttled before any comparison runs. Backed by the shared
// store (Redis in production), so the limit holds across replicas. Default 30
// requests/minute/IP — plenty for a real Zoho workflow, far below a brute force.
const isWebhookRateLimited = createIpRateLimiter({
  name: 'crm-webhook',
  max: Number(process.env.CRM_WEBHOOK_RATE_LIMIT_MAX || 30),
  windowMs: Number(process.env.CRM_WEBHOOK_RATE_LIMIT_WINDOW_MIN || 1) * 60 * 1000
});

// Constant-time compare so the secret check can't be probed by timing.
function secretOk(provided) {
  const expected = String(process.env.ZOHO_WEBHOOK_SECRET || '').trim();
  if (!expected) return null; // not configured
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');

router.post('/zoho', async (req, res) => {
  // Throttle before touching the secret, so brute-forcing the token is bounded.
  if (await isWebhookRateLimited(req.ip)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const ok = secretOk(req.get('x-zoho-webhook-token') || req.query.token);
  if (ok === null) return res.status(503).json({ error: 'CRM webhooks are not configured' });
  if (!ok) return res.status(401).json({ error: 'Invalid webhook token' });

  const body = req.body || {};
  const first = Array.isArray(body.data) ? body.data[0] || {} : {};
  const recordId = pick(body.recordId, body.record_id, body.id, first.id);
  const zohoStatus = pick(body.status, body.Lead_Status, body.leadStatus, first.Lead_Status, first.status);
  const email = pick(body.email, body.Email, first.Email);
  const tenantSlug = pick(body.tenant, req.query.tenant);

  if (!recordId && !email) return res.status(200).json({ ok: true, updated: false, reason: 'no-record-identifier' });
  if (!zohoStatus) return res.status(200).json({ ok: true, updated: false, reason: 'no-status' });

  // Resolve an optional tenant hint to its id, so the lead lookup is scoped.
  let tenantId = null;
  if (tenantSlug) {
    const tenant = await prisma.tenant.findUnique({ where: { slug: String(tenantSlug) } }).catch(() => null);
    tenantId = tenant?.id || null;
  }

  const result = await applyInboundStatus({ recordId, zohoStatus, tenantId, email });
  return res.status(200).json({ ok: true, ...result });
});

// ── Inbound HubSpot webhooks (Feature 9): a sales rep changing a contact's
// lifecycle stage or lead status inside HubSpot mirrors back into KGT Orb.
//
//   POST /api/v1/webhooks/hubspot   (public; HubSpot-signature authenticated)
//
// HubSpot POSTs an ARRAY of event objects (portalId, objectId, propertyName,
// propertyValue, subscriptionType). Authenticity is proven by the v1 signature —
// SHA256(clientSecret + rawBody) in the x-hubspot-signature header — so no
// per-tenant secret is needed; the portalId maps each event to its tenant. A
// shared-secret token (HUBSPOT_WEBHOOK_SECRET) is also accepted as an escape
// hatch. The handler NEVER throws into Express: an event we can't act on is
// acknowledged with a reason, so HubSpot doesn't retry forever.

const isHubspotWebhookRateLimited = createIpRateLimiter({
  name: 'crm-webhook-hubspot',
  max: Number(process.env.CRM_WEBHOOK_RATE_LIMIT_MAX || 30),
  windowMs: Number(process.env.CRM_WEBHOOK_RATE_LIMIT_WINDOW_MIN || 1) * 60 * 1000
});

// Timing-safe equality for strings of any length.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Verify a HubSpot webhook request. Returns true/false, or null when nothing is
 * configured to verify against (so the route can answer 503 rather than trust it).
 */
function hubspotSignatureOk(req) {
  const sharedSecret = String(process.env.HUBSPOT_WEBHOOK_SECRET || '').trim();
  const clientSecret = String(process.env.HUBSPOT_CLIENT_SECRET || '').trim();
  if (!sharedSecret && !clientSecret) return null; // not configured

  // Escape hatch: a shared token (header or ?token=), like the Zoho webhook.
  if (sharedSecret && safeEqual(req.get('x-hubspot-webhook-token') || req.query.token, sharedSecret)) {
    return true;
  }
  // HubSpot v1 signature: SHA256(clientSecret + rawRequestBody), hex. Needs the
  // exact bytes HubSpot sent (captured in app.js as req.rawBody).
  if (clientSecret && req.rawBody) {
    const provided = req.get('x-hubspot-signature');
    if (!provided) return false;
    const expected = crypto.createHash('sha256').update(clientSecret + req.rawBody.toString('utf8')).digest('hex');
    return safeEqual(provided, expected);
  }
  return false;
}

// Only these contact property changes carry a status we map back.
const STATUS_PROPERTIES = new Set(['hs_lead_status', 'lifecyclestage']);

router.post('/hubspot', async (req, res) => {
  if (await isHubspotWebhookRateLimited(req.ip)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const ok = hubspotSignatureOk(req);
  if (ok === null) return res.status(503).json({ error: 'HubSpot webhooks are not configured' });
  if (!ok) return res.status(401).json({ error: 'Invalid webhook signature' });

  // HubSpot sends an array of events; a single object is tolerated too.
  const events = Array.isArray(req.body) ? req.body : (req.body ? [req.body] : []);
  if (!events.length) return res.status(200).json({ ok: true, processed: 0 });

  // Cache portalId → tenantId within this batch (events usually share a portal).
  const tenantByPortal = new Map();
  let updated = 0;
  const results = [];

  for (const ev of events.slice(0, 100)) {
    const propertyName = ev?.propertyName;
    if (!STATUS_PROPERTIES.has(String(propertyName))) { results.push({ reason: 'ignored-property' }); continue; }
    const portalId = ev?.portalId != null ? String(ev.portalId) : null;
    const recordId = ev?.objectId != null ? String(ev.objectId) : null;
    const value = ev?.propertyValue;
    if (!recordId || value === undefined || value === null || value === '') {
      results.push({ reason: 'incomplete-event' });
      continue;
    }

    let tenantId = portalId ? tenantByPortal.get(portalId) : null;
    if (tenantId === undefined || tenantId === null) {
      tenantId = await tenantIdForPortal(portalId);
      if (portalId) tenantByPortal.set(portalId, tenantId);
    }
    if (!tenantId) { results.push({ reason: 'unknown-portal' }); continue; }

    const r = await applyHubspotStatus({ recordId, propertyName, value, tenantId });
    if (r.updated) updated += 1;
    results.push(r);
  }

  return res.status(200).json({ ok: true, processed: results.length, updated });
});

module.exports = router;

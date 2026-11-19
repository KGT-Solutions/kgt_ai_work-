const express = require('express');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { applyInboundStatus } = require('../services/crm/zohoSync');
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

module.exports = router;

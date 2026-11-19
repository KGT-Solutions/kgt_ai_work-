const express = require('express');
const prisma = require('../lib/prisma');
const { findValidApiKey, shouldTouchLastUsed, shouldTouchWidgetSeen, sanitizeWidgetUrl } = require('../utils/tenantApiKeys');
const { handleChat } = require('../services/tenantChat');
const { endSession } = require('../services/chatSessions');
const { createIpRateLimiter } = require('../utils/ipRateLimit');

// The widget pings once per page load; this only bounds the key lookup per
// address (the row write is throttled separately). Generous, because an office
// or campus behind one NAT can have many legitimate visitors at once.
const isPingRateLimited = createIpRateLimiter({ name: 'widget-ping', max: 60, windowMs: 10 * 60 * 1000 });

// Public chat endpoint used by the embed widget and customers' own apps:
//   POST /api/v1/tenant-chat/:slug/chat   header X-Tenant-Api-Key: tk_...
//   body { query, botType: "support" | "sales" (alias: bot; default support), sessionId?, language? }
// botType picks the persona and the category weighting (domains/tenantProfile.js);
// an unknown value is a 400, and the response echoes the botType that answered.
// language ("en" | "hi") sets the reply language; without it the engine falls
// back to detecting the message's own language (engine/language.js). The
// response echoes the `language` it came out in.
// The slug picks the tenant; the key must be a live (non-revoked) key of
// THAT tenant, matched by SHA-256 hash — a key of another tenant is
// rejected exactly like an unknown one. Everything after this point
// (services/tenantChat.js) only ever sees req.tenant.
const router = express.Router();

router.use('/:slug', async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: req.params.slug } });
    if (!tenant || !tenant.active) return res.status(404).json({ error: 'Unknown tenant' });

    const key = await findValidApiKey(prisma, tenant.id, req.headers['x-tenant-api-key']);
    if (!key) return res.status(401).json({ error: 'Missing or invalid X-Tenant-Api-Key' });
    if (shouldTouchLastUsed(key)) {
      // Best-effort bookkeeping — never fail or delay a chat request over it.
      prisma.tenantApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    }

    req.tenant = tenant;
    req.apiKey = key; // the validated key row, so /ping can stamp install telemetry on it
    next();
  } catch (err) {
    next(err);
  }
});

router.post('/:slug/chat', handleChat);

// The widget pings this once when it loads on a customer's page, so the
// dashboard can show "widget detected" without waiting for a first chat. Auth is
// the same slug + X-Tenant-Api-Key as every route here. Best-effort and always
// 204 for an authenticated caller: a telemetry write must never surface an error
// to the embed. body { url?: the page it loaded on }; the Referer is the
// fallback. The row write is throttled (shouldTouchWidgetSeen) so heavy traffic
// doesn't hammer one key row.
router.post('/:slug/ping', async (req, res) => {
  if (await isPingRateLimited(req.ip)) return res.status(429).json({ error: 'Too many requests' });
  if (shouldTouchWidgetSeen(req.apiKey)) {
    const widgetUrl = sanitizeWidgetUrl(req.body?.url) || sanitizeWidgetUrl(req.headers.referer);
    // Keep a previously-recorded page if this ping carried no usable URL.
    const data = widgetUrl ? { widgetSeenAt: new Date(), widgetUrl } : { widgetSeenAt: new Date() };
    prisma.tenantApiKey
      .update({ where: { id: req.apiKey.id }, data })
      .catch(() => {}); // never let a telemetry write break the widget
  }
  res.status(204).end();
});

// The widget reports its page closing: body { sessionId }. The conversation
// is summarized now instead of after the idle delay (services/chatSessions.js).
// 204 either way for a well-formed id, so the endpoint can't be used to probe
// which session ids exist.
router.post('/:slug/session/end', async (req, res) => {
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.slice(0, 64) : '';
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
  await endSession({ tenantId: req.tenant.id, sessionId });
  res.status(204).end();
});

module.exports = router;

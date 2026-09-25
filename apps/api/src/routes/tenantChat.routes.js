const express = require('express');
const prisma = require('../lib/prisma');
const { findValidApiKey, shouldTouchLastUsed } = require('../utils/tenantApiKeys');
const { getEngineAnswer } = require('../engine/chatEngine');
const { createTenantSupportProfile, createTenantSalesProfile } = require('../domains/tenantProfile');

const router = express.Router();

const BOT_PROFILE_FACTORIES = { support: createTenantSupportProfile, sales: createTenantSalesProfile };

const MAX_QUERY_LEN = 1000;
const RATE_LIMIT_MAX = Number(process.env.TENANT_CHAT_RATE_LIMIT_MAX || 30);
const RATE_LIMIT_WINDOW_MS = Number(process.env.TENANT_CHAT_RATE_LIMIT_WINDOW_MIN || 10) * 60 * 1000;
const requestLog = new Map(); // tenantId -> timestamps[]

function isRateLimited(tenantId) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (requestLog.get(tenantId) || []).filter((t) => t > windowStart);
  timestamps.push(now);
  requestLog.set(tenantId, timestamps);

  // Occasional, cheap sweep of now-empty entries — bounds the otherwise
  // permanent per-tenant Map growth over the process lifetime.
  if (requestLog.size > 5000 && Math.random() < 0.01) {
    for (const [key, arr] of requestLog) {
      if (!arr.some((t) => t > windowStart)) requestLog.delete(key);
    }
  }

  return timestamps.length > RATE_LIMIT_MAX;
}

// Every route below is scoped to one tenant, resolved + authenticated here
// once — this is the "strict data segregation between organizations" from
// Pillar 1: nothing downstream can accidentally run against a different
// tenant's data because nothing downstream ever sees another tenant's id.
// (Not covered by app.js's wrapRouterAsync — that only wraps .route()
// handlers, not a plain router.use() middleware like this one — so this one
// keeps its own try/catch.)
router.use('/:slug', async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: req.params.slug } });
    if (!tenant || !tenant.active) return res.status(404).json({ error: 'Unknown tenant' });

    // Keys are looked up by hash (utils/tenantApiKeys.js), so there's no
    // byte-by-byte string comparison to leak timing on.
    const key = await findValidApiKey(prisma, tenant.id, req.headers['x-tenant-api-key']);
    if (!key) {
      return res.status(401).json({ error: 'Missing or invalid X-Tenant-Api-Key' });
    }
    if (shouldTouchLastUsed(key)) {
      // Best-effort bookkeeping — never fail or delay a chat request over it.
      prisma.tenantApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    }

    req.tenant = tenant;
    next();
  } catch (err) {
    next(err);
  }
});

router.post('/:slug/chat', async (req, res, next) => {
  try {
    const query = String(req.body?.query || '').trim();
    if (!query) return res.status(400).json({ error: 'query is required' });
    if (query.length > MAX_QUERY_LEN) {
      return res.status(400).json({ error: `query must be ${MAX_QUERY_LEN} characters or fewer` });
    }

    // Dual-bot training: same tenant, same knowledge base, different
    // persona/gating — see domains/tenantProfile.js for how the two stay
    // from cross-contaminating each other. Defaults to 'support' so an
    // existing integration that never sends botType keeps its current
    // behavior unchanged.
    const botType = ['support', 'sales'].includes(req.body?.botType) ? req.body.botType : 'support';

    if (isRateLimited(req.tenant.id)) {
      return res.status(429).json({ error: 'Too many chat requests. Please wait a few minutes and try again.' });
    }

    const sessionId = req.body?.sessionId;
    let session = sessionId
      ? await prisma.chatSession.findFirst({ where: { id: sessionId, tenantId: req.tenant.id } })
      : null;
    if (!session) {
      session = await prisma.chatSession.create({
        data: { tenantId: req.tenant.id, externalUserId: req.body?.externalUserId || null }
      });
    }

    // Conversation history is shared across bot types within one session
    // (e.g. an embed that lets a visitor bounce between "ask support" and
    // "talk to sales" tabs) rather than kept in two separate threads — a
    // deliberate simplification, not a limitation of the profile split
    // itself; splitting history per bot type would just mean scoping this
    // query by a botType column on ChatMessage as a future addition.
    const recentTurns = await prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'desc' },
      take: 6
    });

    const profile = BOT_PROFILE_FACTORIES[botType](req.tenant);
    const result = await getEngineAnswer({
      profile,
      query,
      ctx: { tenantId: req.tenant.id, recentTurns: recentTurns.reverse().map((m) => ({ role: m.role, content: m.content })) }
    });

    await prisma.chatMessage.createMany({
      data: [
        { sessionId: session.id, role: 'user', content: query },
        { sessionId: session.id, role: 'assistant', content: result.answer, confidence: result.confidence ?? null }
      ]
    });

    res.json({ ...result, sessionId: session.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const prisma = require('../lib/prisma');
const { getEngineAnswer } = require('../engine/chatEngine');
const { createTenantSupportProfile, createTenantSalesProfile } = require('../domains/tenantProfile');
const { createIpRateLimiter } = require('../utils/ipRateLimit');

// One chat turn for one tenant. Shared by every way a tenant's bots are
// reached — the embed widget (API key), the client dashboard (client JWT)
// and the staff console (operator JWT) — so all three get the same
// validation, rate limit, session scoping and engine. The caller has
// already authenticated and resolved `tenant`; everything below is scoped
// by tenant.id and never reads another tenant's rows.

const BOT_PROFILE_FACTORIES = { support: createTenantSupportProfile, sales: createTenantSalesProfile };
const MAX_QUERY_LEN = 1000;

// Per tenant, not per IP: bounds each tenant's LLM spend however many
// visitors its widget has. The limiter keys by any string.
const isTenantRateLimited = createIpRateLimiter({
  max: Number(process.env.TENANT_CHAT_RATE_LIMIT_MAX || 30),
  windowMs: Number(process.env.TENANT_CHAT_RATE_LIMIT_WINDOW_MIN || 10) * 60 * 1000
});

const BOT_TYPES = Object.keys(BOT_PROFILE_FACTORIES);

/**
 * Which bot a request is for. Accepts botType, or bot (the widget's
 * data-bot attribute name), case-insensitively; omitted means support.
 * An unrecognised value is an error rather than a silent fallback, so a
 * pricing page with a typo in its snippet doesn't quietly get the support persona.
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function parseBotType(body) {
  const raw = body?.botType ?? body?.bot;
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: 'support' };
  const value = String(raw).trim().toLowerCase();
  return BOT_TYPES.includes(value)
    ? { ok: true, value }
    : { ok: false, error: `botType must be one of: ${BOT_TYPES.join(', ')}` };
}

class ChatRequestError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * @param {{ tenant: object, body: object }} args  body: { query, botType? (or bot), sessionId?, externalUserId? }
 * @returns {Promise<object>} the bot's result plus sessionId and the botType that answered
 * @throws {ChatRequestError} for invalid input (400) or rate limiting (429)
 */
async function runTenantChat({ tenant, body }) {
  const query = String(body?.query || '').trim();
  if (!query) throw new ChatRequestError('query is required', 400);
  if (query.length > MAX_QUERY_LEN) throw new ChatRequestError(`query must be ${MAX_QUERY_LEN} characters or fewer`, 400);

  // Same tenant, same knowledge base, different persona/gating per bot —
  // see domains/tenantProfile.js. Defaults to support.
  const bot = parseBotType(body);
  if (!bot.ok) throw new ChatRequestError(bot.error, 400);
  const botType = bot.value;

  if (isTenantRateLimited(tenant.id)) {
    throw new ChatRequestError('Too many chat requests. Please wait a few minutes and try again.', 429);
  }

  // A sessionId from another tenant simply isn't found, and a new session starts.
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : null;
  let session = sessionId
    ? await prisma.chatSession.findFirst({ where: { id: sessionId, tenantId: tenant.id } })
    : null;
  if (!session) {
    const externalUserId = typeof body?.externalUserId === 'string' ? body.externalUserId.slice(0, 200) : null;
    session = await prisma.chatSession.create({ data: { tenantId: tenant.id, externalUserId } });
  }

  const recentTurns = await prisma.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'desc' },
    take: 6
  });

  const result = await getEngineAnswer({
    profile: BOT_PROFILE_FACTORIES[botType](tenant),
    query,
    ctx: { tenantId: tenant.id, recentTurns: recentTurns.reverse().map((m) => ({ role: m.role, content: m.content })) }
  });

  await prisma.chatMessage.createMany({
    data: [
      { sessionId: session.id, role: 'user', content: query, botType },
      { sessionId: session.id, role: 'assistant', content: result.answer, confidence: result.confidence ?? null, botType }
    ]
  });

  return { ...result, sessionId: session.id, botType };
}

// Express helper: run a turn and map input errors to their status codes.
async function handleChat(req, res, next) {
  try {
    res.json(await runTenantChat({ tenant: req.tenant, body: req.body }));
  } catch (err) {
    if (err instanceof ChatRequestError) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
}

module.exports = { runTenantChat, handleChat, parseBotType, ChatRequestError, MAX_QUERY_LEN, BOT_TYPES };

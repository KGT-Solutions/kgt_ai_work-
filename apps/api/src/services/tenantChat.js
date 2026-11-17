const prisma = require('../lib/prisma');
const { getEngineAnswer } = require('../engine/chatEngine');
const { resolveLanguage } = require('../engine/language');
const { matchCatalogProducts } = require('./catalogIngest');
const { isProductListingIntent, isProductFollowUp } = require('./shared/productMatch');
const { store, keys } = require('../lib/sharedStore');
const { createTenantSupportProfile, createTenantSalesProfile } = require('../domains/tenantProfile');
const { createIpRateLimiter } = require('../utils/ipRateLimit');
const { pickFollowUps } = require('./followUps');
const { trackLeadActivity } = require('./leads');
const { recordTurn } = require('./chatSessions');
const { notifyIfNeedsAttention } = require('./teamAlerts');
const { extractStatedEmail } = require('../domains/handoffActions');
const {
  runImageGuardrailPipeline, isImagePipelineEnabled, parseImageDataUrl,
  guardrailFallbackMessage, securityRefusalMessage
} = require('./shared/imageGuardrailPipeline');

// One chat turn for one tenant. Shared by every way a tenant's bots are
// reached — the embed widget (API key), the client dashboard (client JWT)
// and the staff console (operator JWT) — so all three get the same
// validation, rate limit, session scoping and engine. The caller has
// already authenticated and resolved `tenant`; everything below is scoped
// by tenant.id and never reads another tenant's rows.

const BOT_PROFILE_FACTORIES = { support: createTenantSupportProfile, sales: createTenantSalesProfile };
const MAX_QUERY_LEN = 1000;

// How long a session's last matched product cards stay available to carry
// forward onto a follow-up turn ("link as well", "show their images"). Long
// enough to cover a natural back-and-forth, short enough that a much later,
// unrelated question doesn't resurrect stale cards.
const PRODUCT_CONTEXT_TTL_MS = 30 * 60 * 1000;

// Per tenant, not per IP: bounds each tenant's LLM spend however many
// visitors its widget has. The limiter keys by any string.
//
// This is abuse protection, not a capacity limit, and the default is sized
// that way: 30 per 10 minutes is 3 messages a minute for an ENTIRE company's
// website, shared by every visitor at once — and the dashboard's own test
// chat draws from the same bucket, so a tenant trying their bots could lock
// their visitors out. Retrieval costs well under a millisecond per turn
// (scripts/bench-retrieval.js), so the ceiling here is the LLM bill, not the
// server. Lower it per deployment if a provider quota needs protecting.
const isTenantRateLimited = createIpRateLimiter({ name: 'tenant-chat',
  max: Number(process.env.TENANT_CHAT_RATE_LIMIT_MAX || 300),
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
 * @param {{ tenant: object, body: object, sandbox?: boolean, imageDeps?: object }} args
 *   body: { query, image?, botType? (or bot), sessionId?, externalUserId?, language? }
 *   query and image are each optional on their own but one is required: the
 *   widget allows sending a photo with no text. image is a base64 data URL
 *   (png/jpeg/webp/gif) and is screened by the guardrail pipeline before any
 *   retrieval or generation.
 *   sandbox: the dashboard's test chat (client or staff), not a website visitor
 *   imageDeps: test-only injection for the guardrail's vision call; production never passes it
 * @returns {Promise<object>} the bot's result (without its confidence score) plus followUps
 *   (0-3 suggested next questions), sessionId and the botType that answered
 * @throws {ChatRequestError} for invalid input (400) or rate limiting (429)
 */
async function runTenantChat({ tenant, body, sandbox = false, imageDeps = undefined }) {
  const query = String(body?.query || '').trim();
  // A photo on its own is a valid message — the widget says so ("either text
  // or an image is required") and sends one with no query — so a turn is
  // valid when it carries either. The image is a base64 data URL; its shape
  // and size are checked here so a malformed one is a 400 rather than a
  // polite "I can't read that" the caller can't act on.
  const image = typeof body?.image === 'string' && body.image.trim() ? body.image.trim() : null;
  if (!query && !image) throw new ChatRequestError('query or image is required', 400);
  if (query.length > MAX_QUERY_LEN) throw new ChatRequestError(`query must be ${MAX_QUERY_LEN} characters or fewer`, 400);
  if (image) {
    const shape = parseImageDataUrl(image);
    if (!shape.ok) throw new ChatRequestError(shape.error, 400);
  }

  // Same tenant, same knowledge base, different persona/gating per bot —
  // see domains/tenantProfile.js. Defaults to support.
  const bot = parseBotType(body);
  if (!bot.ok) throw new ChatRequestError(bot.error, 400);
  const botType = bot.value;

  // Which language the bot must answer in. The UI's top-level selector
  // (body.language) is authoritative: on Hindi the reply is Hindi even for an
  // English question, and vice versa. Only a caller that sends no selector
  // falls back to detecting the message's own language (engine/language.js).
  // Echoed back in the response so the UI knows which language this turn used.
  const language = resolveLanguage(body?.language, query);

  if (await isTenantRateLimited(tenant.id)) {
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

  // What the transcript records for this turn: the visitor's own words, or a
  // marker when they sent only a photo. Never the text a model read out of the
  // image — the transcript is what the visitor said.
  const userContent = query || '(image attached)';

  // ── Image guardrail (services/shared/imageGuardrailPipeline.js) ──
  // An attached photo goes through the 3-tier pipeline BEFORE any retrieval or
  // generation. That ordering is the point: an unusable or irrelevant image is
  // answered from here and never reaches the chat LLM, which is the token
  // saving the pipeline exists for, and an injection signature in the image's
  // metadata or in the text rendered inside it is a hard refusal. It runs after
  // the session exists so a refusal still returns a sessionId and is recorded,
  // and it never throws — a vision outage degrades to "treat as relevant".
  let imageText = '';
  let imageProductText = '';
  if (image && isImagePipelineEnabled()) {
    // imageDeps is a test seam, like fetchImpl elsewhere: it lets a unit test
    // supply the vision classifier so nothing reaches a provider. Production
    // callers (handleChat) never pass it.
    const verdict = await runImageGuardrailPipeline({ dataUrl: image, userText: query, tenant, deps: imageDeps || {} });
    if (verdict.outcome === 'rejected') {
      // A security hit gets a deliberately generic refusal that never says what
      // was detected; everything else gets the polite "send a relevant photo".
      const answer = verdict.security ? securityRefusalMessage(language) : guardrailFallbackMessage(language);
      return refuseImageTurn({ session, botType, language, userContent, answer });
    }
    imageText = String(verdict.text || '').trim();
    imageProductText = String(verdict.productText || '').trim();
  }

  // A photo-only turn still needs a question to retrieve and answer against.
  // The label/issue text the vision tier read IS that question here, so the bot
  // answers about what it was actually sent. With no query and nothing read
  // from the image (vision off or unavailable), there is nothing to answer, so
  // ask for a description rather than guess.
  const visionQuery = [imageProductText, imageText].filter(Boolean).join(' — ').slice(0, MAX_QUERY_LEN);
  if (!query && !visionQuery) {
    return refuseImageTurn({ session, botType, language, userContent, answer: guardrailFallbackMessage(language) });
  }
  const effectiveQuery = query || visionQuery;
  // The engine and retrieval see what the photo showed, clearly labelled, so an
  // answer can speak to it. The visitor's own text stays first and unmodified.
  const engineQuery = query && visionQuery ? `${query}\n\n[Attached photo shows: ${visionQuery}]` : effectiveQuery;

  const recentTurns = await prisma.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'desc' },
    take: 6
  });

  const result = await getEngineAnswer({
    profile: BOT_PROFILE_FACTORIES[botType](tenant),
    query: engineQuery,
    ctx: {
      tenantId: tenant.id,
      sessionId: session.id, // tickets and an email left later are tied to this conversation
      recentTurns: recentTurns.reverse().map((m) => ({ role: m.role, content: m.content })),
      language // pins the reply language (engine/promptBuilder.js)
    }
  });

  // Earlier questions in this conversation (so chips don't repeat them) and
  // this bot's FAQs, read before this turn's messages are written.
  const [askedRows, faqRow] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { sessionId: session.id, role: 'user' }, orderBy: { createdAt: 'desc' }, take: 50, select: { content: true }
    }),
    prisma.tenantFaq.findUnique({
      where: { tenantId: tenant.id },
      select: { supportFaqs: true, salesFaqs: true, supportFaqsHi: true, salesFaqsHi: true }
    })
  ]);

  // The confidence score is stored here (and on tickets) for staff and
  // tenant review, never sent to the chat client; neither is the email just
  // captured, which goes to the lead record, nor the answered flag.
  // offTopic only steers the team alert below.
  const { confidence, contactEmail, answered, offTopic, ...reply } = result;

  // Catalog-aware scope correction + product cards. A tenant's own product and
  // brand queries ("list products", "do you have Pranaa?") must be answered
  // from the catalog, never dismissed as off-topic. We match the catalog
  // directly from the database (not via retrieval), so a product is found even
  // when the generic engine missed it. If we found items but the engine did
  // NOT answer (off-topic redirect or low-confidence fallback — not a human
  // handoff), replace that rejection with a short catalog lead-in; the cards
  // carry the detail. Done before the message is stored so the transcript
  // matches what the visitor saw.
  const wantsCatalog = isProductListingIntent(effectiveQuery);
  const productKey = keys.productContext(tenant.id, session.id);
  let products = [];
  if (!reply.handoff && !reply.awaitingContact) {
    try {
      const matchText = [effectiveQuery, reply.answer, imageProductText].filter(Boolean).join('\n');
      products = await matchCatalogProducts(tenant.id, matchText, { listIntent: wantsCatalog });
    } catch (err) {
      console.warn(`[tenantChat] product match failed for tenant ${tenant.id}: ${err.message}`);
    }
    // Multi-turn carryover: the visitor named no product this turn, but the
    // message refers back to ones we just showed ("link as well", "show
    // images of those"). Reattach the previous turn's cards so the follow-up
    // renders links/images instead of being rejected as off-topic.
    if (!products.length && isProductFollowUp(effectiveQuery)) {
      try {
        const prev = await store().get(productKey);
        if (Array.isArray(prev) && prev.length) products = prev;
      } catch (err) {
        console.warn(`[tenantChat] product context read failed for tenant ${tenant.id}: ${err.message}`);
      }
    }
  }
  const correctedScope = products.length > 0 && !answered && !reply.handoff && !reply.awaitingContact;
  if (correctedScope) reply.answer = catalogLeadIn(botType, language);
  const finalAnswered = !!answered || correctedScope;

  await prisma.chatMessage.createMany({
    data: [
      { sessionId: session.id, role: 'user', content: userContent, botType },
      { sessionId: session.id, role: 'assistant', content: reply.answer, confidence: confidence ?? null, botType, answered: finalAnswered }
    ]
  });
  // After the messages are written, so the lead's transcript and the alert include this turn.
  await recordTurn({ session, botType });
  // Team alerts are for real visitors, not the team testing its own bots.
  const alertTeam = !sandbox;
  // The email the handoff action took, or one stated in a message that went
  // to the knowledge base ("my email is ana@x.com — what's the price for 40
  // seats?"): the question is answered and the lead saved either way.
  const leadEmail = reply.contactCaptured ? contactEmail : extractStatedEmail(query);  // typed text only — never an address read off an image
  await trackLeadActivity({ tenant, botType, sessionId: session.id, contactEmail: leadEmail, alertTeam });
  // A handoff or an answer below 25% confidence: tell the team now (throttled; not awaited).
  // A query we answered from the catalog instead is not a miss, so don't alert on it.
  if (alertTeam && !correctedScope) notifyIfNeedsAttention({ tenant, botType, sessionId: session.id, query: effectiveQuery, result });

  // No suggested questions while the bot is waiting for an email: the reply
  // just asked for one, and chips would pull the visitor away from answering.
  // Suggested chips in the active language: the Hindi FAQ list under a Hindi
  // conversation, the English one otherwise (the *Hi arrays fall back to the
  // English question where a translation was missing — services/tenantFaqs.js).
  const faqKey = `${botType === 'sales' ? 'sales' : 'support'}Faqs${language === 'hi' ? 'Hi' : ''}`;
  const followUps = reply.awaitingContact ? [] : pickFollowUps({
    botType,
    faqs: faqRow?.[faqKey] || [],
    asked: askedRows.map((m) => m.content),
    query: effectiveQuery,
    answer: reply.answer,
    language
  });
  // Remember what we showed so the next turn can carry it forward. Writing on
  // a carried-forward turn too refreshes the TTL, so a chain of follow-ups
  // ("link as well" → "and the images?") keeps working. Best-effort: a store
  // hiccup must never fail the reply the visitor already has.
  if (products.length) {
    try {
      await store().set(productKey, products, PRODUCT_CONTEXT_TTL_MS);
    } catch (err) {
      console.warn(`[tenantChat] product context write failed for tenant ${tenant.id}: ${err.message}`);
    }
  }

  return { ...reply, followUps, sessionId: session.id, botType, language, products };
}

/**
 * Answer a turn from the image guardrail alone: the photo was unusable,
 * irrelevant or hostile, so no retrieval, generation, catalog match, lead
 * capture or team alert runs — that short-circuit is the whole point of a
 * guardrail. The turn is still written to the transcript, so a conversation
 * read later shows what the visitor sent and what they were told, and the
 * sessionId still comes back so the widget keeps the same conversation.
 * @returns {Promise<object>} the same response shape as a normal turn
 */
async function refuseImageTurn({ session, botType, language, userContent, answer }) {
  await prisma.chatMessage.createMany({
    data: [
      { sessionId: session.id, role: 'user', content: userContent, botType },
      // answered: false — the visitor's question was not answered, so this
      // turn counts as a miss in the dashboard rather than a success.
      { sessionId: session.id, role: 'assistant', content: answer, confidence: null, botType, answered: false }
    ]
  });
  await recordTurn({ session, botType });
  return { answer, followUps: [], sessionId: session.id, botType, language, products: [] };
}

// A short, persona-appropriate lead-in used when we answer a product/listing
// query from the catalog (the product cards carry the detail), in the active
// language. Sales leans into value/urgency; Support stays warm and advisory.
function catalogLeadIn(botType, language) {
  const hi = language === 'hi';
  if (botType === 'sales') {
    return hi
      ? 'ये रहे कुछ बेहतरीन विकल्प जो आपके लिए एकदम सही हैं — देखिए और आज ही अपना पसंदीदा चुनिए:'
      : 'Here are some great options I’d genuinely recommend — take a look and grab the one that fits:';
  }
  return hi
    ? 'यहाँ कुछ विकल्प हैं जो आपके लिए अच्छे रहेंगे — देखिए कौन-सा आपकी ज़रूरत के मुताबिक़ है:'
    : 'Here are a few that could be a good fit for you — see which suits your needs best:';
}

// Express helper: run a turn and map input errors to their status codes.
async function handleChat(req, res, next) {
  try {
    // req.actor is set only behind the dashboard's gatekeepers; the widget route has none.
    res.json(await runTenantChat({ tenant: req.tenant, body: req.body, sandbox: !!req.actor }));
  } catch (err) {
    if (err instanceof ChatRequestError) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
}

module.exports = {
  runTenantChat,
  handleChat,
  parseBotType,
  ChatRequestError,
  MAX_QUERY_LEN,
  BOT_TYPES
};

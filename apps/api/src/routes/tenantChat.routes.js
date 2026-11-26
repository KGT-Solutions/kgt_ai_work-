const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const { findValidApiKey, shouldTouchLastUsed, shouldTouchWidgetSeen, sanitizeWidgetUrl, originAllowed } = require('../utils/tenantApiKeys');
const { ipBucket } = require('../services/shared/netGuard');
const { handleChat } = require('../services/tenantChat');
const { endSession } = require('../services/chatSessions');
const { transcribeAudio, isSttConfigured, MAX_AUDIO_BYTES } = require('../services/shared/speechToText');
const { isS2sConfigured } = require('../services/shared/speechToSpeech');
const { runVoiceChat } = require('../services/voiceChat');
const { detectLanguage } = require('../engine/language');
const { createIpRateLimiter } = require('../utils/ipRateLimit');
const { publicTheme } = require('../services/branding');
const { getGuardrails, defaults: guardrailDefaults, blockedCountry, deviceKey, isDeviceRateLimited, DEFAULT_LIMIT_MESSAGE } = require('../services/guardrails');

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
    // One answer for "no such tenant", "inactive tenant" and "bad key": a 404
    // for an unknown slug told anyone which slugs exist. The key lookup runs
    // in every case, so the response time doesn't separate them either.
    const key = await findValidApiKey(prisma, tenant?.active ? tenant.id : null, req.headers['x-tenant-api-key']);
    if (!tenant || !tenant.active || !key) return res.status(401).json({ error: 'Missing or invalid X-Tenant-Api-Key' });

    // A key restricted to the tenant's own websites refuses every other site's
    // browsers (utils/tenantApiKeys.js originAllowed). No Origin = a server.
    if (!originAllowed(key.allowedOrigins, req.get('origin'))) {
      return res.status(403).json({ error: 'This chat widget is not enabled for this website.' });
    }
    if (shouldTouchLastUsed(key)) {
      // Best-effort bookkeeping — never fail or delay a chat request over it.
      prisma.tenantApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    }

    req.tenant = tenant;
    req.apiKey = key; // the validated key row, so /ping can stamp install telemetry on it

    // Guardrails config, loaded once for every route under :slug. Country
    // blocking is enforced here so a blocked visitor gets a 403 on EVERY route
    // — including /theme, which the widget fetches at mount — and the widget
    // tears itself down rather than chatting. Fail-open when no country header
    // is present (services/guardrails.js). The config is also carried on the
    // request so /chat's per-device limit and the engine's spam check reuse it
    // without a second read. Fail-open: a guardrails read that errors falls back
    // to platform defaults (no blocking, no per-device cap) rather than breaking
    // the widget over a config lookup.
    req.guardrails = await getGuardrails(tenant.id).catch(() => guardrailDefaults());
    const blocked = blockedCountry(req.headers, req.guardrails.blockedCountries);
    if (blocked) return res.status(403).json({ error: 'This chat is not available in your region.', blocked: 'country' });

    next();
  } catch (err) {
    next(err);
  }
});

// Per-visitor limit, beneath the per-tenant ones. The tenant API key is public
// (it ships in the embed snippet), so a per-tenant limit alone let any one
// visitor — or a competitor's script — use up a tenant's whole budget and lock
// every real visitor out. Keyed by tenant + IP; chat and voice share it.
const isVisitorLimited = createIpRateLimiter({
  name: 'tenant-chat-visitor',
  max: Number(process.env.TENANT_CHAT_VISITOR_RATE_LIMIT_MAX || 20),
  windowMs: 60 * 1000
});
async function limitVisitor(req, res, next) {
  // ipBucket: an IPv6 visitor counts as their whole /64, which they could otherwise rotate through.
  if (await isVisitorLimited(`${req.tenant.id}:${ipBucket(req.ip)}`)) {
    return res.status(429).json({ error: 'You’re sending messages very quickly. Please wait a moment and try again.' });
  }
  next();
}

// The tenant's own per-device rate limit (dashboard → Guardrails), on top of
// the platform limits above. Unlike those, hitting it is NOT an error: the
// visitor gets a 200 carrying the configured limitMessage in place of a bot
// reply, so the widget shows it as a normal message and the conversation
// continues once the window resets. The device is the WhatsApp phone, else the
// widget browserId + IP, else the IP (services/guardrails.js deviceKey). A
// tenant that set no maxMessages/windowSeconds has no per-device cap.
async function limitDevice(req, res, next) {
  const g = req.guardrails;
  if (!g?.maxMessages || !g?.windowSeconds) return next();
  const device = deviceKey({ body: req.body, ip: req.ip });
  const over = await isDeviceRateLimited({
    tenantId: req.tenant.id, device, maxMessages: g.maxMessages, windowSeconds: g.windowSeconds
  });
  if (!over) return next();
  // Echo the incoming sessionId so the widget keeps the same conversation.
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : null;
  return res.json({
    answer: g.limitMessage || DEFAULT_LIMIT_MESSAGE,
    rateLimited: true, followUps: [], products: [], sessionId
  });
}

router.post('/:slug/chat', limitVisitor, limitDevice, handleChat);

// The widget's look: the design applied in the Theme Studio and the company
// logo, fetched once when the widget starts. { theme: null } = the classic
// look — also what any lookup failure returns, so this never breaks a widget.
// private: the answer is gated on the API key, so shared caches must not keep it.
router.get('/:slug/theme', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=60');
  const theme = await publicTheme(req.tenant);
  // Whether this tenant accepts visitor image uploads (dashboard → Guardrails).
  // The widget hides its attach button when false; runTenantChat enforces it too.
  res.json({ ...theme, imagesEnabled: req.guardrails?.imagesEnabled !== false });
});

// ── Voice input: transcribe an audio blob to text (Groq Whisper), then let the
// widget send that text through /chat as usual. Multipart: one file in field
// "audio". Returns { text, language } where language is detected from the
// transcript (Devanagari ⇒ hi), so the bot replies in the spoken language.
// Transcription is billable, so it is rate-limited per tenant.
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } });
const isTranscribeLimited = createIpRateLimiter({
  name: 'tenant-transcribe',
  max: Number(process.env.TENANT_TRANSCRIBE_RATE_LIMIT_MAX || 60),
  windowMs: Number(process.env.TENANT_TRANSCRIBE_RATE_LIMIT_WINDOW_MIN || 10) * 60 * 1000
});

// Every refusal happens BEFORE multer runs: multer buffers the upload (up to
// MAX_AUDIO_BYTES) in memory, so a limit checked after it still let a
// rate-limited caller make the server hold 20 MB per request.
async function admitTranscription(req, res, next) {
  if (!isSttConfigured()) return res.status(503).json({ error: 'Voice input is not available right now.' });
  if (await isTranscribeLimited(req.tenant.id)) {
    return res.status(429).json({ error: 'Too many voice messages. Please wait a few minutes and try again.' });
  }
  next();
}

router.post('/:slug/transcribe', limitVisitor, admitTranscription, (req, res, next) => audioUpload.single('audio')(req, res, (err) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE'
        ? `Audio must be ${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))}MB or smaller`
        : 'Upload one audio file in a field named "audio"'
    });
  }
  return next(err);
}), async (req, res, next) => {
  if (!req.file || !req.file.buffer?.length) return res.status(400).json({ error: 'Attach an audio file in a field named "audio"' });
  try {
    const { text } = await transcribeAudio({
      buffer: req.file.buffer,
      filename: req.file.originalname || 'audio.webm',
      mimeType: req.file.mimetype || 'audio/webm'
    });
    res.json({ text, language: detectLanguage(text) || 'en' });
  } catch (err) {
    if (err.statusCode === 503) return res.status(503).json({ error: 'Voice input is not available right now.' });
    if (err.statusCode) return res.status(502).json({ error: 'Could not transcribe the audio. Please try again.' });
    next(err);
  }
});

// ── Speech-to-Speech: the visitor speaks (in the language they picked), gets a
// DB-grounded spoken + text answer back in that same language. The answer is
// produced ONLY by runTenantChat (services/voiceChat.js), so every locked rule
// — knowledge-base-only, the price rule, spam pause, rate limits, lead capture —
// applies exactly as in /chat. OpenAI does recognition + voice; the audio comes
// back as base64 so the widget can play it without a second request. Billable,
// so gated on the same per-tenant transcribe limiter as /transcribe.
async function admitVoiceChat(req, res, next) {
  if (!isS2sConfigured()) return res.status(503).json({ error: 'Voice conversations are not available right now.' });
  if (await isTranscribeLimited(req.tenant.id)) {
    return res.status(429).json({ error: 'Too many voice messages. Please wait a few minutes and try again.' });
  }
  next();
}

router.post('/:slug/voice-chat', limitVisitor, admitVoiceChat, (req, res, next) => audioUpload.single('audio')(req, res, (err) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE'
        ? `Audio must be ${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))}MB or smaller`
        : 'Upload one audio file in a field named "audio"'
    });
  }
  return next(err);
}), async (req, res, next) => {
  if (!req.file?.buffer?.length) return res.status(400).json({ error: 'Attach an audio file in a field named "audio"' });
  try {
    // req.actor is unset on the public widget route → a real visitor (not sandbox).
    const out = await runVoiceChat({
      tenant: req.tenant,
      audio: { buffer: req.file.buffer, filename: req.file.originalname || 'voice.webm', mimeType: req.file.mimetype || 'audio/webm' },
      body: req.body, // multer has parsed the text fields (botType, language, sessionId)
      sandbox: !!req.actor,
      guardrails: req.guardrails || null
    });
    res.json(out);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

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

const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const { findValidApiKey, shouldTouchLastUsed, originAllowed } = require('../utils/tenantApiKeys');
const { ipBucket } = require('../services/shared/netGuard');
const { handleChat } = require('../services/tenantChat');
const { endSession } = require('../services/chatSessions');
const { transcribeAudio, isSttConfigured, MAX_AUDIO_BYTES } = require('../services/shared/speechToText');
const { detectLanguage } = require('../engine/language');
const { createIpRateLimiter } = require('../utils/ipRateLimit');
const { publicTheme } = require('../services/branding');

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

router.post('/:slug/chat', limitVisitor, handleChat);

// The widget's look: the design applied in the Theme Studio and the company
// logo, fetched once when the widget starts. { theme: null } = the classic
// look — also what any lookup failure returns, so this never breaks a widget.
// private: the answer is gated on the API key, so shared caches must not keep it.
router.get('/:slug/theme', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=60');
  res.json(await publicTheme(req.tenant));
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

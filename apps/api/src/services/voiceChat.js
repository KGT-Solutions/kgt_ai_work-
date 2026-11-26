const { runTenantChat, parseBotType, ChatRequestError } = require('./tenantChat');
const { logger } = require('../lib/logger');
const { transcribeLocked, synthesizeSpeech, isS2sConfigured } = require('./shared/speechToSpeech');
const { detectLanguage } = require('../engine/language');
const { estimateSeconds, checkVoiceCap, recordUsage, voiceLimitMessage } = require('./voiceUsage');

// Speech-to-Speech orchestration. The whole point of this module is that it
// decides NOTHING about the answer: the visitor's speech is recognised (OpenAI,
// locked to the chosen language), the text is handed to runTenantChat — which
// is the one grounded pipeline (knowledge-base-only answers, the price rule, no
// guessing, spam pause, rate limits, lead capture, sandbox isolation) — and the
// grounded answer is spoken back (OpenAI TTS) in that same language. OpenAI is
// used only for ears and voice; KGT Orb's locked rules stay in the engine.

const LANGS = new Set(['en', 'hi']);

/**
 * The visitor's EXPLICITLY picked language, 'en' or 'hi', or null when none was
 * sent. null is meaningful: it means "no selector", so the caller lets STT
 * auto-detect and then resolves the language from the transcript — the same
 * detection fallback typed chat uses (engine/language.js). This avoids forcing a
 * Hindi speaker who never touched the toggle into English transcription + replies.
 */
function pickLanguage(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return LANGS.has(v) ? v : null;
}

function didNotCatch(language) {
  return language === 'hi'
    ? 'माफ़ कीजिए, मैं आपकी बात समझ नहीं पाया। कृपया दोबारा बोलिए।'
    : "Sorry, I didn't catch that. Please try speaking again.";
}

// Speak the answer in the given language, but never fail the turn over it: if
// TTS is down, the caller still gets the grounded text answer, just without
// audio. The language is passed explicitly so the voice is pinned to it and
// can't drift to the other language (synthesizeSpeech adds a spoken-language
// instruction), independent of any stray characters in the text.
async function speak(text, language, deps) {
  try {
    const { audio, mimeType } = await synthesizeSpeech({ text, language }, deps);
    return { audio: audio.toString('base64'), audioMimeType: mimeType };
  } catch (err) {
    logger.warn(`[voiceChat] TTS unavailable, returning text only: ${err.message}`);
    return { audio: null, audioMimeType: null };
  }
}

/**
 * Run one speech-to-speech turn.
 * @param {{ tenant, audio:{buffer,filename?,mimeType?}, body?:object, sandbox?:boolean, guardrails?:object|null, deps?:object }} args
 *   body: { botType|bot?, language? ('en'|'hi'), sessionId? }
 * @returns {Promise<object>} the runTenantChat result plus { text (the transcript),
 *   audio (base64 spoken reply|null), audioMimeType, language }
 * @throws {ChatRequestError} 503 unconfigured, 400 bad input, or whatever runTenantChat throws (e.g. 429)
 */
async function runVoiceChat({ tenant, audio, body = {}, sandbox = false, guardrails = null, deps = {} }) {
  if (!isS2sConfigured()) throw new ChatRequestError('voice conversations are not configured', 503);

  const picked = pickLanguage(body.language); // 'en' | 'hi' | null (null = auto-detect)
  const bot = parseBotType(body);
  if (!bot.ok) throw new ChatRequestError(bot.error, 400);
  const botType = bot.value;
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;

  // Monthly voice-minute cap (Feature 4) — LIVE chats only; the owner's sandbox
  // test never consumes a tenant's allowance. Checked before we spend any
  // STT/LLM/TTS: once over cap the visitor is told to type instead, spoken in the
  // picked language (or English, since there's no transcript yet to detect from).
  // Fails open on a metering error (services/voiceUsage.js).
  const estSeconds = estimateSeconds(audio?.buffer?.length || 0);
  if (!sandbox) {
    const cap = await checkVoiceCap({ tenantId: tenant.id, guardrails });
    if (!cap.allowed) {
      const language = picked || 'en';
      const answer = voiceLimitMessage(language);
      return { answer, text: '', language, botType, sessionId, followUps: [], products: [], voiceLimitReached: true, audio: null, audioMimeType: null };
    }
  }

  // 1. Recognise speech. When the visitor explicitly picked a language we LOCK
  // STT to it; with no selector we let STT auto-detect and resolve the language
  // from the transcript below, so STT, the grounded answer and the spoken reply
  // all agree instead of defaulting a Hindi speaker to English.
  const { text: transcript } = await transcribeLocked(
    { buffer: audio.buffer, filename: audio.filename, mimeType: audio.mimeType, language: picked || undefined }, deps
  );
  const text = String(transcript || '').trim();

  // Silence / unintelligible: ask them to repeat, spoken in the picked language
  // (English by default — no transcript to detect from). No engine call, no
  // transcript written, and NOT metered — nothing was grounded.
  if (!text) {
    const language = picked || 'en';
    const answer = didNotCatch(language);
    return { answer, text: '', language, botType, sessionId, followUps: [], products: [], noSpeech: true, ...(await speak(answer, language, deps)) };
  }

  // The turn's language: the explicit pick wins; otherwise detect it from the
  // transcript (mirrors typed chat). Passed to runTenantChat as the authoritative
  // selector so the grounded answer comes back in exactly this language.
  const language = picked || detectLanguage(text) || 'en';

  // 2. The grounded answer — the ONLY source of what we say. source:'voice' tags
  // the persisted turn so Chat Logs and the CSV can show it (Feature 4).
  const result = await runTenantChat({
    tenant, body: { query: text, language, botType, sessionId, source: 'voice' }, sandbox, guardrails
  });
  const answerLanguage = result.language || language;

  // Meter this turn against the month's allowance (live only, best-effort: a
  // metering write must never cost the visitor the answer they already got).
  if (!sandbox) {
    try {
      await recordUsage({ tenantId: tenant.id, seconds: estSeconds });
    } catch (err) {
      logger.warn(`[voiceChat] voice usage record failed for tenant ${tenant.id}: ${err.message}`);
    }
  }

  // 3. Speak the grounded answer back in that exact language (best-effort).
  return { ...result, text, language: answerLanguage, ...(await speak(result.answer, answerLanguage, deps)) };
}

module.exports = { runVoiceChat, pickLanguage };

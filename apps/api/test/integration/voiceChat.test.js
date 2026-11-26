// Speech-to-Speech orchestration end to end at the service level: speech in →
// DB-grounded answer (through the real runTenantChat) → speech out. OpenAI is
// injected via deps.fetchImpl, and the engine + prisma are stubbed BEFORE
// voiceChat is required (it transitively destructures them), so nothing touches
// a provider or a database — same load-order discipline as the other chat tests.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.OPENAI_API_KEY = 'sk-test';

const chatEngine = require('../../src/engine/chatEngine');
const catalogIngest = require('../../src/services/catalogIngest');
const leads = require('../../src/services/leads');
const chatSessions = require('../../src/services/chatSessions');
const teamAlerts = require('../../src/services/teamAlerts');

let engineCalls, engineLang;
chatEngine.getEngineAnswer = async ({ query, ctx }) => { engineCalls.push(query); engineLang = ctx.language; return { answer: 'Our hours are 9am–5pm.', confidence: 0.9, answered: true, offTopic: false }; };
catalogIngest.matchCatalogProducts = async () => [];
leads.trackLeadActivity = async () => {};
chatSessions.recordTurn = async () => {};
teamAlerts.notifyIfNeedsAttention = () => {};

const prisma = require('../../src/lib/prisma');
const { resetStore } = require('../../src/lib/sharedStore');
const { runVoiceChat, pickLanguage } = require('../../src/services/voiceChat');

const TENANT = { id: 't-voice', slug: 'acme', name: 'Acme', active: true };

let messages, sttCalls, ttsInputs;
// One fetch fake standing in for both OpenAI calls, routed by URL.
const deps = () => ({
  fetchImpl: async (url, opts) => {
    if (/audio\/transcriptions$/.test(url)) {
      sttCalls.push({ language: opts.body.get('language'), model: opts.body.get('model') });
      return { ok: true, json: async () => ({ text: 'what are your hours?' }) };
    }
    if (/audio\/speech$/.test(url)) {
      ttsInputs.push(JSON.parse(opts.body).input);
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    }
    throw new Error(`unexpected url ${url}`);
  }
});

beforeEach(() => {
  resetStore();
  messages = []; sttCalls = []; ttsInputs = []; engineCalls = []; engineLang = null;
  prisma.chatSession = {
    findFirst: async () => null,
    create: async () => ({ id: 'sess-v', tenantId: TENANT.id, messageCount: 0, pausedAt: null, pauseReason: null })
  };
  prisma.chatMessage = { findMany: async () => [], createMany: async ({ data }) => { messages.push(...data); return { count: data.length }; }, count: async () => 0 };
  prisma.tenantFaq = { findUnique: async () => null };
  // Voice-minute metering (Feature 4): no usage yet, writes accepted.
  prisma.tenantVoiceUsage = { findUnique: async () => null, upsert: async () => ({}) };
});

const audio = { buffer: Buffer.from('spoken'), filename: 'voice.webm', mimeType: 'audio/webm' };

describe('pickLanguage', () => {
  test('returns en/hi for an explicit pick, null when none was sent', () => {
    assert.equal(pickLanguage('hi'), 'hi');
    assert.equal(pickLanguage('EN'), 'en');
    // No valid selector → null, which the caller treats as "auto-detect".
    assert.equal(pickLanguage('fr'), null);
    assert.equal(pickLanguage(undefined), null);
    assert.equal(pickLanguage(''), null);
  });
});

describe('runVoiceChat: grounded answer + spoken reply', () => {
  test('the answer comes from runTenantChat (the KB-grounded engine), then is spoken back', async () => {
    const out = await runVoiceChat({ tenant: TENANT, audio, body: { language: 'en', botType: 'support' }, guardrails: null, deps: deps() });
    assert.equal(out.text, 'what are your hours?', 'the transcript is returned');
    assert.equal(out.answer, 'Our hours are 9am–5pm.', 'the spoken answer is the grounded engine answer');
    assert.equal(engineCalls.length, 1, 'the grounded engine was the one that answered');
    assert.ok(out.audio, 'base64 audio is returned so the widget can play it');
    assert.equal(out.audioMimeType, 'audio/mpeg');
    assert.equal(ttsInputs[0], 'Our hours are 9am–5pm.', 'TTS speaks exactly the grounded answer, nothing of its own');
    assert.equal(out.sessionId, 'sess-v');
    // Both persisted rows are tagged as a voice turn (Feature 4), so Chat Logs
    // and the CSV can show it.
    assert.equal(messages.length, 2);
    assert.ok(messages.every((m) => m.source === 'voice'), 'user + assistant rows tagged source=voice');
  });

  test('language is locked end to end: Hindi pins STT, the engine reply language, and (implicitly) the voice', async () => {
    const out = await runVoiceChat({ tenant: TENANT, audio, body: { language: 'hi', botType: 'support' }, guardrails: null, deps: deps() });
    assert.equal(sttCalls[0].language, 'hi', 'recognition is locked to Hindi');
    assert.equal(engineLang, 'hi', 'the grounded answer is produced in Hindi');
    assert.equal(out.language, 'hi');
  });

  test('with no selector, STT auto-detects and the language is resolved from the transcript (no EN/HI mismatch)', async () => {
    // A Hindi speaker who never touched the toggle: STT is NOT locked, and the
    // detected language flows into the engine and the spoken reply.
    const hiDeps = { fetchImpl: async (url, opts) => {
      if (/transcriptions$/.test(url)) {
        sttCalls.push({ language: opts.body.get('language') });
        return { ok: true, json: async () => ({ text: 'आपके खुलने का समय क्या है?' }) };
      }
      ttsInputs.push(JSON.parse(opts.body).input);
      return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer };
    } };
    const out = await runVoiceChat({ tenant: TENANT, audio, body: { botType: 'support' }, guardrails: null, deps: hiDeps });
    assert.equal(sttCalls[0].language, null, 'STT is not locked when no language was picked');
    assert.equal(engineLang, 'hi', 'the language is detected from the transcript and drives the engine');
    assert.equal(out.language, 'hi', 'and the spoken reply is in that same language');
  });

  test('over the monthly voice cap: the visitor is asked to type, with no STT or engine call', async () => {
    prisma.tenantVoiceUsage.findUnique = async () => ({ secondsUsed: 600 }); // 10 min used
    const out = await runVoiceChat({
      tenant: TENANT, audio, body: { language: 'en', botType: 'support' },
      guardrails: { voiceMonthlyMinutes: 10 }, deps: deps()
    });
    assert.equal(out.voiceLimitReached, true);
    assert.equal(out.audio, null, 'no audio spent once over the cap');
    assert.deepEqual(engineCalls, [], 'the engine is never called');
    assert.deepEqual(sttCalls, [], 'and no transcription is spent');
  });

  test('under the cap, a live turn records its estimated minutes', async () => {
    let recorded = null;
    prisma.tenantVoiceUsage.findUnique = async () => ({ secondsUsed: 60 });
    prisma.tenantVoiceUsage.upsert = async (args) => { recorded = args; return {}; };
    await runVoiceChat({
      tenant: TENANT, audio, body: { language: 'en', botType: 'support' },
      guardrails: { voiceMonthlyMinutes: 10 }, deps: deps()
    });
    assert.ok(recorded, 'usage is upserted for a live voice turn');
    assert.ok(recorded.create.secondsUsed >= 1, 'with the estimated seconds for this turn');
  });

  test('silence / unintelligible audio asks the visitor to repeat, without calling the engine', async () => {
    const quietDeps = { fetchImpl: async (url, opts) => {
      if (/transcriptions$/.test(url)) return { ok: true, json: async () => ({ text: '   ' }) };
      ttsInputs.push(JSON.parse(opts.body).input);
      return { ok: true, arrayBuffer: async () => new Uint8Array([0]).buffer };
    } };
    const out = await runVoiceChat({ tenant: TENANT, audio, body: { language: 'en' }, deps: quietDeps });
    assert.equal(out.noSpeech, true);
    assert.match(out.answer, /didn't catch that/i);
    assert.deepEqual(engineCalls, [], 'nothing to ground, so the engine is never called');
    assert.equal(messages.length, 0, 'and nothing is written to the transcript');
  });

  test('a TTS outage still returns the grounded text answer (audio just null)', async () => {
    const noTtsDeps = { fetchImpl: async (url) => {
      if (/transcriptions$/.test(url)) return { ok: true, json: async () => ({ text: 'what are your hours?' }) };
      return { ok: false, status: 500 }; // speech synthesis down
    } };
    const out = await runVoiceChat({ tenant: TENANT, audio, body: { language: 'en' }, deps: noTtsDeps });
    assert.equal(out.answer, 'Our hours are 9am–5pm.');
    assert.equal(out.audio, null, 'no audio, but the turn still completes with text');
  });

  test('sandbox mode leaves no trace (no transcript rows persisted)', async () => {
    const out = await runVoiceChat({ tenant: TENANT, audio, body: { language: 'en' }, sandbox: true, deps: deps() });
    assert.equal(out.answer, 'Our hours are 9am–5pm.');
    assert.equal(messages.length, 0, 'sandbox persists nothing');
  });

  test('503 when OpenAI is not configured', async () => {
    delete process.env.OPENAI_API_KEY;
    try {
      await assert.rejects(() => runVoiceChat({ tenant: TENANT, audio, body: { language: 'en' }, deps: deps() }), (e) => e.statusCode === 503);
    } finally {
      process.env.OPENAI_API_KEY = 'sk-test';
    }
  });
});

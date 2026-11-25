const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { transcribeLocked, synthesizeSpeech, isS2sConfigured, VoiceError } = require('../../src/services/shared/speechToSpeech');

const ENV = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_STT_MODEL', 'OPENAI_TTS_MODEL', 'OPENAI_TTS_VOICE', 'OPENAI_TTS_FORMAT'];
let saved;
beforeEach(() => { saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]])); for (const k of ENV) delete process.env[k]; process.env.OPENAI_API_KEY = 'sk-test'; });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const audio = { buffer: Buffer.from('spoken-bytes'), filename: 'voice.webm', mimeType: 'audio/webm' };

describe('speechToSpeech: isS2sConfigured', () => {
  test('reflects the presence of an OpenAI key (which stays server-side)', () => {
    assert.equal(isS2sConfigured(), true);
    delete process.env.OPENAI_API_KEY;
    assert.equal(isS2sConfigured(), false);
  });
});

describe('speechToSpeech: transcribeLocked (OpenAI STT)', () => {
  test('posts multipart to OpenAI with the chosen language locked, returns the transcript', async () => {
    let seen = null;
    const fetchImpl = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ text: 'नमस्ते' }) }; };
    const r = await transcribeLocked({ ...audio, language: 'hi' }, { fetchImpl });
    assert.equal(r.text, 'नमस्ते');
    assert.equal(r.model, 'gpt-4o-transcribe'); // default
    assert.match(seen.url, /api\.openai\.com\/v1\/audio\/transcriptions$/);
    assert.match(seen.opts.headers.authorization, /^Bearer sk-test$/);
    assert.ok(seen.opts.body instanceof FormData);
    assert.equal(seen.opts.body.get('model'), 'gpt-4o-transcribe');
    assert.equal(seen.opts.body.get('language'), 'hi'); // locked, unlike the Groq auto-detect flow
  });

  test('honours OPENAI_STT_MODEL and OPENAI_BASE_URL overrides', async () => {
    process.env.OPENAI_STT_MODEL = 'whisper-1';
    process.env.OPENAI_BASE_URL = 'https://proxy.internal/v1/';
    let url;
    const r = await transcribeLocked({ ...audio, language: 'en' }, { fetchImpl: async (u) => { url = u; return { ok: true, json: async () => ({ text: 'hello' }) }; } });
    assert.equal(r.model, 'whisper-1');
    assert.equal(url, 'https://proxy.internal/v1/audio/transcriptions'); // trailing slash trimmed
  });

  test('503 when unconfigured, 400 on empty audio', async () => {
    delete process.env.OPENAI_API_KEY;
    await assert.rejects(() => transcribeLocked({ ...audio, language: 'en' }, { fetchImpl: async () => ({}) }), (e) => e.statusCode === 503);
    process.env.OPENAI_API_KEY = 'sk-test';
    await assert.rejects(() => transcribeLocked({ buffer: Buffer.alloc(0), language: 'en' }, { fetchImpl: async () => ({}) }), (e) => e.statusCode === 400);
  });

  test('a provider error becomes a 502 and never leaks the raw body', async () => {
    await assert.rejects(
      () => transcribeLocked({ ...audio, language: 'en' }, { fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'secret internal detail' }) }),
      (e) => e instanceof VoiceError && e.statusCode === 502 && !/secret/.test(e.message)
    );
  });
});

describe('speechToSpeech: synthesizeSpeech (OpenAI TTS)', () => {
  test('posts JSON with the configured model/voice/format and returns audio bytes', async () => {
    let seen = null;
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl = async (url, opts) => { seen = { url, opts }; return { ok: true, arrayBuffer: async () => bytes.buffer }; };
    const r = await synthesizeSpeech({ text: 'Our hours are 9 to 5.' }, { fetchImpl });
    assert.ok(Buffer.isBuffer(r.audio));
    assert.deepEqual([...r.audio], [1, 2, 3, 4]);
    assert.equal(r.mimeType, 'audio/mpeg'); // mp3 default
    assert.equal(r.model, 'gpt-4o-mini-tts');
    assert.match(seen.url, /\/v1\/audio\/speech$/);
    const body = JSON.parse(seen.opts.body);
    assert.equal(body.model, 'gpt-4o-mini-tts');
    assert.equal(body.voice, 'alloy');
    assert.equal(body.response_format, 'mp3');
    assert.equal(body.input, 'Our hours are 9 to 5.');
  });

  test('model/voice/format are env-configurable (so the 2027 TTS retirement is a config change)', async () => {
    process.env.OPENAI_TTS_MODEL = 'gpt-realtime-2.1-mini';
    process.env.OPENAI_TTS_VOICE = 'verse';
    process.env.OPENAI_TTS_FORMAT = 'wav';
    let body;
    const r = await synthesizeSpeech({ text: 'hi' }, { fetchImpl: async (_u, o) => { body = JSON.parse(o.body); return { ok: true, arrayBuffer: async () => new Uint8Array([9]).buffer }; } });
    assert.equal(body.model, 'gpt-realtime-2.1-mini');
    assert.equal(body.voice, 'verse');
    assert.equal(r.mimeType, 'audio/wav');
  });

  test('empty text is 400; a provider failure is a 502', async () => {
    await assert.rejects(() => synthesizeSpeech({ text: '   ' }, { fetchImpl: async () => ({}) }), (e) => e.statusCode === 400);
    await assert.rejects(() => synthesizeSpeech({ text: 'hi' }, { fetchImpl: async () => ({ ok: false, status: 503 }) }), (e) => e instanceof VoiceError && e.statusCode === 502);
  });
});

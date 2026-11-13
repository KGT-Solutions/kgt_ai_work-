const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { transcribeAudio, isSttConfigured, TranscriptionError } = require('../../src/services/shared/speechToText');

let prevKey;
beforeEach(() => { prevKey = process.env.GROQ_API_KEY; process.env.GROQ_API_KEY = 'gk-test'; });
afterEach(() => { if (prevKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = prevKey; });

const audio = { buffer: Buffer.from('fake-audio-bytes'), filename: 'clip.webm', mimeType: 'audio/webm' };

describe('speechToText: transcribeAudio', () => {
  test('posts multipart to Groq Whisper and returns the transcript (no language hint)', async () => {
    let seen = null;
    const fetchImpl = async (url, opts) => {
      seen = { url, opts };
      return { ok: true, json: async () => ({ text: 'नमस्ते, व्हे प्रोटीन की कीमत क्या है?' }) };
    };
    const r = await transcribeAudio(audio, { fetchImpl });
    assert.equal(r.text, 'नमस्ते, व्हे प्रोटीन की कीमत क्या है?');
    assert.equal(r.model, 'whisper-large-v3-turbo');
    assert.match(seen.url, /api\.groq\.com\/openai\/v1\/audio\/transcriptions/);
    assert.match(seen.opts.headers.authorization, /^Bearer gk-test$/);
    assert.ok(seen.opts.body instanceof FormData);
    assert.equal(seen.opts.body.get('model'), 'whisper-large-v3-turbo');
    assert.equal(seen.opts.body.get('language'), null); // multilingual: never pinned
  });

  test('honours GROQ_WHISPER_MODEL override', async () => {
    const prev = process.env.GROQ_WHISPER_MODEL; process.env.GROQ_WHISPER_MODEL = 'whisper-large-v3';
    try {
      const r = await transcribeAudio(audio, { fetchImpl: async () => ({ ok: true, json: async () => ({ text: 'hello' }) }) });
      assert.equal(r.model, 'whisper-large-v3');
    } finally { if (prev === undefined) delete process.env.GROQ_WHISPER_MODEL; else process.env.GROQ_WHISPER_MODEL = prev; }
  });

  test('a provider error becomes a 502 TranscriptionError (raw body not leaked)', async () => {
    await assert.rejects(
      () => transcribeAudio(audio, { fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'secret internal detail' }) }),
      (e) => e instanceof TranscriptionError && e.statusCode === 502 && !/secret/.test(e.message)
    );
  });

  test('a thrown transport error is wrapped as 502, never bubbles raw', async () => {
    await assert.rejects(
      () => transcribeAudio(audio, { fetchImpl: async () => { throw new Error('ECONNRESET'); } }),
      (e) => e instanceof TranscriptionError && e.statusCode === 502
    );
  });

  test('missing key ⇒ 503, empty audio ⇒ 400', async () => {
    delete process.env.GROQ_API_KEY;
    await assert.rejects(() => transcribeAudio(audio, { fetchImpl: async () => ({}) }), (e) => e.statusCode === 503);
    process.env.GROQ_API_KEY = 'gk-test';
    await assert.rejects(() => transcribeAudio({ buffer: Buffer.alloc(0) }, { fetchImpl: async () => ({}) }), (e) => e.statusCode === 400);
  });
});

describe('speechToText: isSttConfigured', () => {
  test('reflects the presence of a Groq key', () => {
    assert.equal(isSttConfigured(), true);
    delete process.env.GROQ_API_KEY;
    assert.equal(isSttConfigured(), false);
  });
});

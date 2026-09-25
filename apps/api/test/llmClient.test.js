const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const {
  generateAnswer,
  isLlmConfigured,
  ChatConfigError,
  ChatRateLimitError,
  ChatUpstreamError
} = require('../src/engine/llmClient');

const ENV_KEYS = ['LLM_PRIMARY', 'LLM_FALLBACK', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
let savedEnv;

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe('llmClient.generateAnswer — provider fallback chain', () => {
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    mock.restoreAll();
  });

  test('throws ChatConfigError with no provider configured at all (default chain: anthropic)', async () => {
    await assert.rejects(
      () => generateAnswer({ systemPrompt: 's', userPrompt: 'u' }),
      ChatConfigError
    );
  });

  test('isLlmConfigured reflects whether any provider in the chain has a key', () => {
    assert.equal(isLlmConfigured(), false);
    // The default chain (no LLM_PRIMARY/LLM_FALLBACK set) is ['anthropic']
    // alone — a key for a provider NOT in the chain must not count.
    process.env.GROQ_API_KEY = 'key';
    assert.equal(isLlmConfigured(), false, 'a key for a provider outside the active chain should not count');
    process.env.ANTHROPIC_API_KEY = 'key';
    assert.equal(isLlmConfigured(), true);
  });

  test('a successful call to the primary provider returns its answer, provider, model, and usage', async () => {
    process.env.LLM_PRIMARY = 'groq';
    process.env.GROQ_API_KEY = 'key';
    mock.method(globalThis, 'fetch', async () => jsonResponse(200, {
      choices: [{ message: { content: 'Pay via the Bills tab.' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 }
    }));

    const result = await generateAnswer({ systemPrompt: 's', userPrompt: 'u' });
    assert.equal(result.text, 'Pay via the Bills tab.');
    assert.equal(result.provider, 'groq');
    assert.deepEqual(result.usage, { promptTokens: 100, completionTokens: 20 });
  });

  test('falls through to the next provider in the chain on a 401 (ChatConfigError)', async () => {
    process.env.LLM_PRIMARY = 'groq';
    process.env.LLM_FALLBACK = 'openai';
    process.env.GROQ_API_KEY = 'bad-key';
    process.env.OPENAI_API_KEY = 'good-key';

    let call = 0;
    mock.method(globalThis, 'fetch', async (url) => {
      call += 1;
      if (String(url).includes('groq')) return jsonResponse(401, { error: 'unauthorized' });
      return jsonResponse(200, { choices: [{ message: { content: 'fallback answer' } }], usage: {} });
    });

    const result = await generateAnswer({ systemPrompt: 's', userPrompt: 'u' });
    assert.equal(result.provider, 'openai');
    assert.equal(result.text, 'fallback answer');
    assert.equal(call, 2);
  });

  test('falls through on a 429 (ChatRateLimitError) too', async () => {
    process.env.LLM_PRIMARY = 'groq';
    process.env.LLM_FALLBACK = 'anthropic';
    process.env.GROQ_API_KEY = 'key';
    process.env.ANTHROPIC_API_KEY = 'key';

    mock.method(globalThis, 'fetch', async (url) => {
      if (String(url).includes('groq')) return jsonResponse(429, {});
      return jsonResponse(200, { content: [{ text: 'anthropic answer' }], usage: { input_tokens: 5, output_tokens: 5 } });
    });

    const result = await generateAnswer({ systemPrompt: 's', userPrompt: 'u' });
    assert.equal(result.provider, 'anthropic');
    assert.equal(result.text, 'anthropic answer');
  });

  test('a network failure (fetch throws) is treated as ChatUpstreamError and also falls through', async () => {
    process.env.LLM_PRIMARY = 'groq';
    process.env.LLM_FALLBACK = 'openai';
    process.env.GROQ_API_KEY = 'key';
    process.env.OPENAI_API_KEY = 'key';

    mock.method(globalThis, 'fetch', async (url) => {
      if (String(url).includes('groq')) throw new Error('ECONNRESET');
      return jsonResponse(200, { choices: [{ message: { content: 'recovered' } }], usage: {} });
    });

    const result = await generateAnswer({ systemPrompt: 's', userPrompt: 'u' });
    assert.equal(result.text, 'recovered');
  });

  test('when every provider in the chain fails, the LAST error is thrown', async () => {
    process.env.LLM_PRIMARY = 'groq';
    process.env.LLM_FALLBACK = 'openai';
    process.env.GROQ_API_KEY = 'key';
    process.env.OPENAI_API_KEY = 'key';

    mock.method(globalThis, 'fetch', async (url) => {
      if (String(url).includes('groq')) return jsonResponse(429, {});
      return jsonResponse(500, {});
    });

    await assert.rejects(
      () => generateAnswer({ systemPrompt: 's', userPrompt: 'u' }),
      ChatUpstreamError // the openai 500 is the last error, not groq's 429
    );
  });

  test('an unconfigured provider (missing key) is a ChatConfigError that falls through without a network call', async () => {
    process.env.LLM_PRIMARY = 'groq'; // no GROQ_API_KEY set
    process.env.LLM_FALLBACK = 'openai';
    process.env.OPENAI_API_KEY = 'key';

    let fetchCalls = 0;
    mock.method(globalThis, 'fetch', async () => {
      fetchCalls += 1;
      return jsonResponse(200, { choices: [{ message: { content: 'openai only' } }], usage: {} });
    });

    const result = await generateAnswer({ systemPrompt: 's', userPrompt: 'u' });
    assert.equal(result.provider, 'openai');
    assert.equal(fetchCalls, 1, 'groq should never have hit the network — no key configured');
  });

  test('an empty response body from the provider is a ChatUpstreamError', async () => {
    process.env.LLM_PRIMARY = 'groq';
    process.env.GROQ_API_KEY = 'key';
    mock.method(globalThis, 'fetch', async () => jsonResponse(200, { choices: [{ message: { content: '' } }] }));

    await assert.rejects(
      () => generateAnswer({ systemPrompt: 's', userPrompt: 'u' }),
      ChatUpstreamError
    );
  });

  test('the provider chain de-duplicates LLM_FALLBACK entries that repeat LLM_PRIMARY', async () => {
    process.env.LLM_PRIMARY = 'groq';
    process.env.LLM_FALLBACK = 'groq,openai';
    process.env.GROQ_API_KEY = 'key';
    process.env.OPENAI_API_KEY = 'key';

    let calls = [];
    mock.method(globalThis, 'fetch', async (url) => {
      calls.push(String(url));
      return jsonResponse(500, {}); // force every attempt to fail, so we can count attempts
    });

    await assert.rejects(() => generateAnswer({ systemPrompt: 's', userPrompt: 'u' }));
    // groq should only be attempted once, not twice, then openai once — 2 calls total.
    assert.equal(calls.length, 2);
    assert.equal(calls.filter((u) => u.includes('groq')).length, 1);
  });
});

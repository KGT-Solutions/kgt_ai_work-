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

describe('llmClient — models, reasoning params and startup verification', () => {
  const KEYS = [...ENV_KEYS, 'GROQ_MODEL', 'OPENAI_MODEL', 'LLM_MAX_TOKENS', 'LLM_REASONING_EFFORT'];
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    process.env.LLM_PRIMARY = 'groq';
    process.env.GROQ_API_KEY = 'key';
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    mock.restoreAll();
  });

  const { verifyLlmModels, DEFAULT_MODELS } = require('../src/engine/llmClient');
  const ok = (content, extra = {}) => jsonResponse(200, { choices: [{ message: { content }, ...extra }], usage: {} });

  test('default Groq model is a current one, sent with low reasoning effort and room for reasoning tokens', async () => {
    let body;
    mock.method(globalThis, 'fetch', async (_url, init) => { body = JSON.parse(init.body); return ok('Hi'); });
    await generateAnswer({ systemPrompt: 's', userPrompt: 'u' });
    assert.equal(body.model, DEFAULT_MODELS.groq);
    assert.equal(body.model, 'openai/gpt-oss-120b');
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.max_tokens, 1024);
  });

  test('a non-reasoning Groq model gets no reasoning_effort; LLM_MAX_TOKENS overrides the cap', async () => {
    process.env.GROQ_MODEL = 'qwen/qwen3.8-27b';
    process.env.LLM_MAX_TOKENS = '600';
    let body;
    mock.method(globalThis, 'fetch', async (_url, init) => { body = JSON.parse(init.body); return ok('Hi'); });
    await generateAnswer({ systemPrompt: 's', userPrompt: 'u' });
    assert.equal(body.model, 'qwen/qwen3.8-27b');
    assert.equal('reasoning_effort' in body, false);
    assert.equal(body.max_tokens, 600);
  });

  test('a retired model is a ChatConfigError naming GROQ_MODEL, and the chain moves on to the fallback', async () => {
    process.env.GROQ_MODEL = 'llama3-70b-8192';
    process.env.LLM_FALLBACK = 'openai';
    process.env.OPENAI_API_KEY = 'key';
    mock.method(globalThis, 'fetch', async (url) => (String(url).includes('groq')
      ? jsonResponse(400, { error: { message: 'The model `llama3-70b-8192` has been decommissioned', code: 'model_decommissioned' } })
      : ok('From OpenAI')));
    const warn = mock.method(console, 'warn', () => {});
    const result = await generateAnswer({ systemPrompt: 's', userPrompt: 'u' });
    assert.equal(result.provider, 'openai');
    assert.match(warn.mock.calls[0].arguments[0], /ChatConfigError.*llama3-70b-8192.*GROQ_MODEL/);
  });

  test('an answer cut off by the token cap says to raise LLM_MAX_TOKENS', async () => {
    mock.method(globalThis, 'fetch', async () => ok('', { finish_reason: 'length' }));
    await assert.rejects(() => generateAnswer({ systemPrompt: 's', userPrompt: 'u' }), /LLM_MAX_TOKENS/);
  });

  test('verifyLlmModels reports ok, missing (with suggestions) and unverified providers', async () => {
    process.env.LLM_FALLBACK = 'openai';
    process.env.OPENAI_API_KEY = 'key';
    process.env.OPENAI_MODEL = 'gpt-retired';
    mock.method(globalThis, 'fetch', async (url) => (String(url).includes('groq')
      ? jsonResponse(200, { data: [{ id: 'openai/gpt-oss-120b' }, { id: 'whisper-large-v3' }] })
      : jsonResponse(200, { data: [{ id: 'gpt-4o-mini' }, { id: 'text-embedding-3-small' }, { id: 'tts-1' }] })));
    const results = await verifyLlmModels();
    assert.deepEqual(results[0], { provider: 'groq', model: 'openai/gpt-oss-120b', status: 'ok' });
    assert.equal(results[1].status, 'missing');
    assert.deepEqual(results[1].suggestions, ['gpt-4o-mini']);
  });

  test('verifyLlmModels never throws when a provider is unreachable', async () => {
    mock.method(globalThis, 'fetch', async () => { throw new Error('ECONNREFUSED'); });
    const [r] = await verifyLlmModels();
    assert.equal(r.status, 'unverified');
  });
});

describe('llmClient — short rate-limit waits', () => {
  let saved;
  beforeEach(() => {
    saved = { ...process.env };
    process.env.LLM_PRIMARY = 'groq';
    process.env.GROQ_API_KEY = 'key';
    delete process.env.LLM_FALLBACK;
  });
  afterEach(() => { process.env = saved; mock.restoreAll(); });

  const limited = (retryAfter) => ({
    ok: false, status: 429, headers: { get: (h) => (h === 'retry-after' ? String(retryAfter) : null) },
    json: async () => ({}), text: async () => ''
  });

  test('a 429 with a short Retry-After is retried once and then succeeds', async () => {
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => (++calls === 1
      ? limited(0.01)
      : jsonResponse(200, { choices: [{ message: { content: 'OK' } }], usage: {} })));
    const result = await generateAnswer({ systemPrompt: 's', userPrompt: 'u' });
    assert.equal(result.text, 'OK');
    assert.equal(calls, 2);
  });

  test('a 429 asking for a long wait fails over immediately instead of stalling the chat', async () => {
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => { calls++; return limited(60); });
    await assert.rejects(() => generateAnswer({ systemPrompt: 's', userPrompt: 'u' }), ChatRateLimitError);
    assert.equal(calls, 1);
  });
});

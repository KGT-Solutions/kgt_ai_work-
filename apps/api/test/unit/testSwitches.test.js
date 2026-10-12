const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { assertProdSafety, ProdSafetyError } = require('../../src/utils/assertProdSafety');
const { smtpConfig } = require('../../src/services/mailer');
const { assertPublicHost } = require('../../src/services/shared/crawler');
const { generateAnswer } = require('../../src/engine/llmClient');

// The three opt-in switches the sandboxed E2E stack needs: each one is off by
// default, does exactly one thing when on, and production refuses to start
// with it.

const SAFE = { DEPLOY_ENV: 'production', JWT_SECRET: '9f2c4e7a1b8d3f6e0a5c2b9d7e4f1a3c', CORS_ORIGINS: 'https://hub.example.com' };
const KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_ALLOW_INSECURE', 'CRAWLER_ALLOW_PRIVATE_HOSTS', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'LLM_PRIMARY', 'LLM_FALLBACK', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  mock.restoreAll();
});

describe('production refuses every test switch', () => {
  const problemKeys = (extra) => {
    try { assertProdSafety({ ...SAFE, ...extra }); return []; } catch (e) { assert.ok(e instanceof ProdSafetyError); return e.problems.map((p) => p.key); }
  };
  test('CRAWLER_ALLOW_PRIVATE_HOSTS and SMTP_ALLOW_INSECURE', () => {
    assert.deepEqual(problemKeys({ CRAWLER_ALLOW_PRIVATE_HOSTS: 'true' }), ['CRAWLER_ALLOW_PRIVATE_HOSTS']);
    assert.deepEqual(problemKeys({ SMTP_ALLOW_INSECURE: 'TRUE' }), ['SMTP_ALLOW_INSECURE']);
    assert.deepEqual(problemKeys({ CRAWLER_ALLOW_PRIVATE_HOSTS: 'false', SMTP_ALLOW_INSECURE: '' }), []);
  });
  test('OPENAI_BASE_URL must be https in production', () => {
    assert.deepEqual(problemKeys({ OPENAI_BASE_URL: 'http://fake-llm:8080/v1' }), ['OPENAI_BASE_URL']);
    assert.deepEqual(problemKeys({ OPENAI_BASE_URL: 'https://proxy.example.com/v1' }), []);
  });
  test('outside production none of them blocks startup', () => {
    assert.doesNotThrow(() => assertProdSafety({ CRAWLER_ALLOW_PRIVATE_HOSTS: 'true', SMTP_ALLOW_INSECURE: 'true', OPENAI_BASE_URL: 'http://x' }));
  });
});

describe('SMTP_ALLOW_INSECURE', () => {
  test('off (default): STARTTLS is required', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    delete process.env.SMTP_ALLOW_INSECURE;
    const c = smtpConfig();
    assert.equal(c.requireTLS, true);
    assert.equal(c.ignoreTLS, undefined);
  });
  test('on: plaintext to a local catcher', () => {
    Object.assign(process.env, { SMTP_HOST: 'mailpit', SMTP_PORT: '1025', SMTP_ALLOW_INSECURE: 'true' });
    const c = smtpConfig();
    assert.equal(c.requireTLS, false);
    assert.equal(c.ignoreTLS, true);
  });
});

describe('CRAWLER_ALLOW_PRIVATE_HOSTS', () => {
  test('off (default): a private address is refused', async () => {
    delete process.env.CRAWLER_ALLOW_PRIVATE_HOSTS;
    await assert.rejects(assertPublicHost('localhost'), /non-public address/);
  });
  test('on: the guard is lifted', async () => {
    process.env.CRAWLER_ALLOW_PRIVATE_HOSTS = 'true';
    await assert.doesNotReject(assertPublicHost('localhost'));
  });
});

describe('OPENAI_BASE_URL', () => {
  const reply = () => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  for (const [label, base, expected] of [
    ['default', undefined, 'https://api.openai.com/v1/chat/completions'],
    ['override (trailing slash trimmed)', 'http://fake-llm:8080/v1/', 'http://fake-llm:8080/v1/chat/completions']
  ]) {
    test(label, async () => {
      Object.assign(process.env, { OPENAI_API_KEY: 'sk-test', LLM_PRIMARY: 'openai', LLM_FALLBACK: '', GROQ_API_KEY: '', ANTHROPIC_API_KEY: '' });
      if (base === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = base;
      const calls = [];
      mock.method(globalThis, 'fetch', async (url) => { calls.push(String(url)); return reply(); });
      await generateAnswer({ systemPrompt: 's', userPrompt: 'u' });
      assert.deepEqual(calls, [expected]);
    });
  }
});

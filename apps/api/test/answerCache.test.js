const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// Mocked before chatEngine.js is required (it destructures generateAnswer).
const llmClient = require('../src/engine/llmClient');
const generateAnswerMock = mock.method(llmClient, 'generateAnswer', async ({ userPrompt }) => ({
  text: `answer #${generateAnswerMock.mock.callCount() + 1}`,
  provider: 'mock',
  model: 'mock-1',
  usage: { promptTokens: 100, completionTokens: 20 },
  userPrompt
}));
const { getEngineAnswer } = require('../src/engine/chatEngine');
const { answerCache, AnswerCache, normalizeQuestion } = require('../src/engine/answerCache');
const { foldBreakdowns } = require('../src/services/usageStats');

const ENV_KEYS = ['ANSWER_CACHE_ENABLED', 'ANSWER_CACHE_TTL_HOURS', 'ANSWER_CACHE_MAX_ENTRIES'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  answerCache.clear();
  generateAnswerMock.mock.resetCalls();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('normalizeQuestion', () => {
  test('ignores case, punctuation, apostrophes and extra whitespace', () => {
    assert.equal(normalizeQuestion("  What's your   PRICING?? "), 'whats your pricing');
    assert.equal(normalizeQuestion('whats your pricing'), 'whats your pricing');
    assert.equal(normalizeQuestion('Do you ship—to Canada?!'), 'do you ship to canada');
  });

  test('keeps digits, so different plans stay different questions', () => {
    assert.notEqual(normalizeQuestion('Price of plan 2?'), normalizeQuestion('Price of plan 3?'));
  });
});

describe('AnswerCache', () => {
  const v = { text: 'x', model: 'm', usage: { promptTokens: 1, completionTokens: 1 } };

  test('keys isolate tenants and bots', () => {
    const c = new AnswerCache();
    c.set('tenant-a', 'sales', 'How much?', v, c.generation('tenant-a'));
    assert.ok(c.get('tenant-a', 'sales', 'how much').value);
    assert.equal(c.get('tenant-b', 'sales', 'How much?').value, null);
    assert.equal(c.get('tenant-a', 'support', 'How much?').value, null);
  });

  test('entries expire after the TTL', () => {
    process.env.ANSWER_CACHE_TTL_HOURS = '1';
    const c = new AnswerCache();
    const now = Date.now();
    const clock = mock.method(Date, 'now', () => now);
    c.set('t', 'support', 'q one', v, 0);
    clock.mock.mockImplementation(() => now + 59 * 60 * 1000);
    assert.ok(c.get('t', 'support', 'q one').value);
    clock.mock.mockImplementation(() => now + 61 * 60 * 1000);
    assert.equal(c.get('t', 'support', 'q one').value, null);
    clock.mock.restore();
  });

  test('evicts the least recently used entry past the size limit', () => {
    process.env.ANSWER_CACHE_MAX_ENTRIES = '2';
    const c = new AnswerCache();
    c.set('t', 'support', 'first', v, 0);
    c.set('t', 'support', 'second', v, 0);
    c.get('t', 'support', 'first'); // now most recently used
    c.set('t', 'support', 'third', v, 0);
    assert.ok(c.get('t', 'support', 'first').value);
    assert.equal(c.get('t', 'support', 'second').value, null);
    assert.ok(c.get('t', 'support', 'third').value);
  });

  test('invalidateTenant drops only that tenant, and refuses answers started before it', () => {
    const c = new AnswerCache();
    c.set('a', 'support', 'q', v, 0);
    c.set('b', 'support', 'q', v, 0);
    const { generation } = c.get('a', 'support', 'other question'); // a call starts...
    c.invalidateTenant('a'); // ...documents change mid-call
    assert.equal(c.set('a', 'support', 'other question', v, generation), false);
    assert.equal(c.get('a', 'support', 'q').value, null);
    assert.ok(c.get('b', 'support', 'q').value);
  });

  test('ANSWER_CACHE_ENABLED=false turns it off', () => {
    process.env.ANSWER_CACHE_ENABLED = 'false';
    const c = new AnswerCache();
    assert.equal(c.set('t', 'support', 'q', v, 0), false);
    assert.equal(c.get('t', 'support', 'q').value, null);
  });
});

describe('getEngineAnswer with the answer cache', () => {
  function profile(botType) {
    return {
      id: `fake:${botType}`,
      botType,
      answerCache: true,
      usageTracking: false, // no DB in unit tests
      resolveKnowledge: async () => [
        { id: 'p#0', title: 'Pricing', content: 'pricing plans cost pricing plans cost', sourceFile: 'p.md', tags: [] }
      ],
      topK: 3,
      minScore: 0,
      excerptLabel: 'EXCERPTS',
      queryLabel: 'QUERY',
      noAnswerSentinel: 'NO_ANSWER',
      systemPrompt: () => 'system prompt',
      formatFallback: () => ({ answer: 'FALLBACK' }),
      formatSuccess: (text) => ({ answer: text }),
      formatDegraded: () => ({ answer: 'DEGRADED' })
    };
  }

  test('a repeated question is answered from cache without an LLM call', async () => {
    const first = await getEngineAnswer({ profile: profile('sales'), query: 'What do your pricing plans cost?', ctx: { tenantId: 'a' } });
    const again = await getEngineAnswer({ profile: profile('sales'), query: 'what do your pricing plans COST', ctx: { tenantId: 'a' } });
    assert.equal(generateAnswerMock.mock.callCount(), 1);
    assert.equal(again.answer, first.answer);
    assert.equal(again.cached, true);
    assert.equal(first.cached, undefined);
  });

  test('another tenant or the other bot never gets the cached answer', async () => {
    await getEngineAnswer({ profile: profile('sales'), query: 'pricing plans cost?', ctx: { tenantId: 'a' } });
    const otherTenant = await getEngineAnswer({ profile: profile('sales'), query: 'pricing plans cost?', ctx: { tenantId: 'b' } });
    const otherBot = await getEngineAnswer({ profile: profile('support'), query: 'pricing plans cost?', ctx: { tenantId: 'a' } });
    assert.equal(generateAnswerMock.mock.callCount(), 3);
    assert.equal(otherTenant.cached, undefined);
    assert.equal(otherBot.cached, undefined);
  });

  test('a knowledge change forces a fresh answer', async () => {
    await getEngineAnswer({ profile: profile('support'), query: 'pricing plans cost?', ctx: { tenantId: 'a' } });
    answerCache.invalidateTenant('a');
    const fresh = await getEngineAnswer({ profile: profile('support'), query: 'pricing plans cost?', ctx: { tenantId: 'a' } });
    assert.equal(generateAnswerMock.mock.callCount(), 2);
    assert.equal(fresh.cached, undefined);
  });
});

describe('usageStats.foldBreakdowns', () => {
  test('splits by bot, separates cache hits, and computes hit rate and burn', () => {
    const sum = (p, c, cost, st = 0, sc = 0) => ({ promptTokens: p, completionTokens: c, estimatedCostUsd: cost, savedTokens: st, savedCostUsd: sc });
    const out = foldBreakdowns({
      usage: [
        { tenantId: 't', botType: 'support', cacheHit: false, _count: { _all: 3 }, _sum: sum(300, 60, 0.3) },
        { tenantId: 't', botType: 'support', cacheHit: true, _count: { _all: 1 }, _sum: sum(0, 0, 0, 120, 0.1) },
        { tenantId: 't', botType: 'sales', cacheHit: false, _count: { _all: 2 }, _sum: sum(200, 40, 0.2) },
        { tenantId: 't', botType: null, cacheHit: false, _count: { _all: 1 }, _sum: sum(50, 10, 0.05) }
      ],
      recent: [{ tenantId: 't', botType: 'sales', _sum: { promptTokens: 140, completionTokens: 0, estimatedCostUsd: 0.1 } }],
      questions: [{ tenantId: 't', botType: 'support', n: 5 }, { tenantId: 't', botType: 'sales', n: 2 }]
    }).get('t');

    assert.equal(out.support.aiAnswers, 3);
    assert.equal(out.support.cacheHits, 1);
    assert.equal(out.support.cacheHitRate, 0.25);
    assert.equal(out.support.tokens, 360);
    assert.equal(out.support.savedTokens, 120);
    assert.equal(out.sales.costUsd, 0.2);
    assert.equal(out.sales.tokensPerDay, 20);
    assert.equal(out.other.aiAnswers, 1);
    assert.equal(out.totals.aiAnswers, 6);
    assert.equal(out.totals.questions, 7);
    assert.equal(out.totals.cacheHitRate, 1 / 7);
  });
});

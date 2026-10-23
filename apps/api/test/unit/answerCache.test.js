const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// Mocked before chatEngine.js is required (it destructures generateAnswer).
const llmClient = require('../../src/engine/llmClient');
const generateAnswerMock = mock.method(llmClient, 'generateAnswer', async ({ userPrompt }) => ({
  text: `answer #${generateAnswerMock.mock.callCount() + 1}`,
  provider: 'mock',
  model: 'mock-1',
  usage: { promptTokens: 100, completionTokens: 20 },
  userPrompt
}));
const { getEngineAnswer } = require('../../src/engine/chatEngine');
const { answerCache, AnswerCache, normalizeQuestion } = require('../../src/engine/answerCache');
const { foldBreakdowns } = require('../../src/services/usageStats');
// Generations live in the shared store now, so they outlive an AnswerCache
// instance and have to be reset between tests.
const { store, resetStore } = require('../../src/lib/sharedStore');

const ENV_KEYS = ['ANSWER_CACHE_ENABLED', 'ANSWER_CACHE_TTL_HOURS', 'ANSWER_CACHE_MAX_ENTRIES'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  answerCache.clear();
  resetStore();
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

  // get() takes the generation the caller already read for this request, and
  // set() re-reads it; both are async because the generation is shared.
  const put = (c, tenant, bot, q, gen = 0) => c.set(tenant, bot, q, v, gen);
  const got = (c, tenant, bot, q, gen = 0) => c.get(tenant, bot, q, gen).value;

  test('keys isolate tenants and bots', async () => {
    const c = new AnswerCache();
    await put(c, 'tenant-a', 'sales', 'How much?', await c.generation('tenant-a'));
    assert.ok(got(c, 'tenant-a', 'sales', 'how much'));
    assert.equal(got(c, 'tenant-b', 'sales', 'How much?'), null);
    assert.equal(got(c, 'tenant-a', 'support', 'How much?'), null);
  });

  test('entries expire after the TTL', async () => {
    process.env.ANSWER_CACHE_TTL_HOURS = '1';
    const c = new AnswerCache();
    const now = Date.now();
    await put(c, 't', 'support', 'q one');
    const clock = mock.method(Date, 'now', () => now + 59 * 60 * 1000);
    assert.ok(got(c, 't', 'support', 'q one'));
    clock.mock.mockImplementation(() => now + 61 * 60 * 1000);
    assert.equal(got(c, 't', 'support', 'q one'), null);
    clock.mock.restore();
  });

  test('evicts the least recently used entry past the size limit', async () => {
    process.env.ANSWER_CACHE_MAX_ENTRIES = '2';
    const c = new AnswerCache();
    await put(c, 't', 'support', 'first');
    await put(c, 't', 'support', 'second');
    got(c, 't', 'support', 'first'); // now most recently used
    await put(c, 't', 'support', 'third');
    assert.ok(got(c, 't', 'support', 'first'));
    assert.equal(got(c, 't', 'support', 'second'), null);
    assert.ok(got(c, 't', 'support', 'third'));
  });

  test('invalidateTenant drops only that tenant, and refuses answers started before it', async () => {
    const c = new AnswerCache();
    await put(c, 'a', 'support', 'q');
    await put(c, 'b', 'support', 'q');
    const generation = await c.generation('a'); // a call starts...
    await c.invalidateTenant('a'); // ...documents change mid-call
    assert.equal(await c.set('a', 'support', 'other question', v, generation), false);
    assert.equal(got(c, 'a', 'support', 'q'), null);
    assert.ok(got(c, 'b', 'support', 'q'));
  });

  test('an invalidation on one instance invalidates the OTHER instances too', async () => {
    // The reason the generation is in lib/sharedStore.js rather than in each
    // process: two API containers each hold their own answers, so an edit
    // handled by one of them has to invalidate the other's. Before, it could
    // not — the second instance kept serving answers written from content that
    // no longer existed, for as long as that process lived.
    const instanceA = new AnswerCache();
    const instanceB = new AnswerCache();
    const generation = await instanceA.generation('shared-tenant');
    await instanceA.set('shared-tenant', 'support', 'q', v, generation);
    await instanceB.set('shared-tenant', 'support', 'q', v, generation);
    assert.ok(instanceB.get('shared-tenant', 'support', 'q', generation).value, 'B has its own copy');

    await instanceA.invalidateTenant('shared-tenant'); // a document is edited on A

    const fresh = await instanceB.generation('shared-tenant');
    assert.notEqual(fresh, generation, 'B must see the bumped generation');
    assert.equal(instanceB.get('shared-tenant', 'support', 'q', fresh).value, null, "B's copy is now a miss");
  });

  test('ANSWER_CACHE_ENABLED=false turns it off', async () => {
    process.env.ANSWER_CACHE_ENABLED = 'false';
    const c = new AnswerCache();
    assert.equal(await put(c, 't', 'support', 'q'), false);
    assert.equal(got(c, 't', 'support', 'q'), null);
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

  test('an answer built from documents that changed mid-request is not cached', async () => {
    // A document edit lands while this request is reading the knowledge base:
    // its answer may reflect the old documents, so the next ask must not get it from cache.
    let editPending = true;
    const racing = {
      ...profile('support'),
      resolveKnowledge: async (ctx) => {
        const chunks = await profile('support').resolveKnowledge(ctx);
        if (editPending) { editPending = false; answerCache.invalidateTenant('a'); }
        return chunks;
      }
    };
    await getEngineAnswer({ profile: racing, query: 'pricing plans cost?', ctx: { tenantId: 'a' } });
    const next = await getEngineAnswer({ profile: racing, query: 'pricing plans cost?', ctx: { tenantId: 'a' } });
    assert.equal(generateAnswerMock.mock.callCount(), 2);
    assert.equal(next.cached, undefined);
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

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// llmClient.generateAnswer is destructured by chatEngine.js at require time,
// so it must be mocked BEFORE chatEngine.js is first required here.
// mock.mockImplementation() below then mutates that same captured reference
// in place for each test (verified: chatEngine holds a live reference to
// this exact mock function object, not a snapshot of its current behavior).
const llmClient = require('../src/engine/llmClient');
const generateAnswerMock = require('node:test').mock.method(
  llmClient,
  'generateAnswer',
  async () => ({ text: 'unset', provider: 'mock', model: 'mock-1', usage: { promptTokens: 0, completionTokens: 0 } })
);
const { getEngineAnswer } = require('../src/engine/chatEngine');
const { registerAction } = require('../src/engine/actionRegistry');
const { ChatConfigError, ChatUpstreamError } = llmClient;

// generateAnswerMock is one shared mock instance for the whole file — its
// call count accumulates across tests unless reset before each one runs.
beforeEach(() => {
  generateAnswerMock.mock.resetCalls();
});

// A minimal fake DomainProfile — exercises the engine's own orchestration
// (action bypass, gating, citation reorder, degraded fallback) without
// depending on either bot's real persona/knowledge base, which are covered
// separately in supportProfile.test.js / salesProfile.test.js and the two
// *BotIntegration.test.js files.
function makeProfile(overrides = {}) {
  return {
    id: 'fake',
    knowledgeBasePath: null,
    resolveKnowledge: async () => [
      { id: 'a#0', title: 'Alpha', content: 'alpha content alpha content', sourceFile: 'a.md', tags: [] },
      { id: 'b#0', title: 'Beta', content: 'beta content beta content', sourceFile: 'b.md', tags: [] }
    ],
    topK: 3,
    minScore: 2,
    excerptLabel: 'EXCERPTS',
    queryLabel: 'QUERY',
    noAnswerSentinel: 'NO_ANSWER',
    systemPrompt: () => 'system prompt',
    formatFallback: (ctx, confidence) => ({ answer: 'FALLBACK', confidence }),
    formatSuccess: (text, ranked) => ({ answer: text, citedTitle: ranked[0]?.chunk.title ?? null }),
    formatDegraded: (ranked) => ({ answer: 'DEGRADED', citedTitle: ranked[0]?.chunk.title ?? null }),
    ...overrides
  };
}

describe('getEngineAnswer — action bypass (Requirement 3)', () => {
  beforeEach(() => registerAction('fakeAction', { match: () => false, run: async () => null }));

  test('an action that matches and returns a result bypasses RAG/LLM entirely', async () => {
    registerAction('fakeAction', {
      match: (query) => query === 'balance',
      run: async () => ({ answer: 'You owe ₹100' })
    });
    const profile = makeProfile({ actions: ['fakeAction'] });

    const result = await getEngineAnswer({ profile, query: 'balance', ctx: {} });
    assert.equal(result.answer, 'You owe ₹100');
    assert.equal(generateAnswerMock.mock.callCount(), 0, 'the LLM must never be called when an action answers');
  });

  test('formatSuccess receives an empty ranked array on the action path (no citation to report)', async () => {
    registerAction('fakeAction', {
      match: () => true,
      run: async () => ({ answer: 'action answer' })
    });
    const profile = makeProfile({ actions: ['fakeAction'] });
    const result = await getEngineAnswer({ profile, query: 'q', ctx: {} });
    assert.equal(result.citedTitle, null);
  });

  test('an action that matches but returns null falls through to RAG normally', async () => {
    registerAction('fakeAction', { match: () => true, run: async () => null });
    generateAnswerMock.mock.mockImplementation(async () => ({ text: 'alpha answer', provider: 'x', model: 'y', usage: {} }));
    const profile = makeProfile({ actions: ['fakeAction'], minScore: 0 });

    const result = await getEngineAnswer({ profile, query: 'alpha', ctx: {} });
    assert.equal(result.answer, 'alpha answer');
  });

  test('an unregistered action id in profile.actions is skipped, not a crash', async () => {
    const profile = makeProfile({ actions: ['does-not-exist'], minScore: 0 });
    generateAnswerMock.mock.mockImplementation(async () => ({ text: 'alpha answer', provider: 'x', model: 'y', usage: {} }));
    const result = await getEngineAnswer({ profile, query: 'alpha', ctx: {} });
    assert.equal(result.answer, 'alpha answer');
  });
});

describe('getEngineAnswer — confidence gate', () => {
  test('zero matching chunks always gates to formatFallback, with a profile that has no minConfidence at all', async () => {
    const profile = makeProfile({ minScore: 2 });
    const result = await getEngineAnswer({ profile, query: 'totally unrelated gibberish zzy', ctx: {} });
    assert.equal(result.answer, 'FALLBACK');
    assert.equal(generateAnswerMock.mock.callCount(), 0);
  });

  test('a profile without minConfidence lets any nonzero-scoring match through to the LLM', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({ text: 'alpha answer', provider: 'x', model: 'y', usage: {} }));
    const profile = makeProfile({ minScore: 0 });
    const result = await getEngineAnswer({ profile, query: 'zzz alpha zzz', ctx: {} });
    assert.equal(result.answer, 'alpha answer');
  });

  test('a profile that opts into minConfidence rejects a match below the threshold even with chunks present', async () => {
    const profile = makeProfile({ minScore: 0, minConfidence: 0.99 }); // near-impossible to clear
    const result = await getEngineAnswer({ profile, query: 'alpha', ctx: {} });
    assert.equal(result.answer, 'FALLBACK');
    assert.equal(generateAnswerMock.mock.callCount(), 0);
  });

  test('formatFallback receives the computed confidence value, not undefined', async () => {
    let seenConfidence;
    const profile = makeProfile({
      minScore: 0,
      minConfidence: 0.99,
      formatFallback: (ctx, confidence) => { seenConfidence = confidence; return { answer: 'FALLBACK' }; }
    });
    await getEngineAnswer({ profile, query: 'alpha', ctx: {} });
    assert.equal(typeof seenConfidence, 'number');
    assert.ok(seenConfidence >= 0 && seenConfidence < 1);
  });
});

describe('getEngineAnswer — LLM success path, sentinel, and citation reordering', () => {
  test('the raw LLM answer flows through to formatSuccess verbatim', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({ text: '  Go check Alpha.  ', provider: 'x', model: 'y', usage: {} }));
    const profile = makeProfile({ minScore: 0 });
    const result = await getEngineAnswer({ profile, query: 'alpha', ctx: {} });
    assert.equal(result.answer, 'Go check Alpha.'); // trimmed
  });

  test('the exact noAnswerSentinel value triggers formatFallback instead of formatSuccess', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({ text: 'NO_ANSWER', provider: 'x', model: 'y', usage: {} }));
    const profile = makeProfile({ minScore: 0 });
    const result = await getEngineAnswer({ profile, query: 'alpha', ctx: {} });
    assert.equal(result.answer, 'FALLBACK');
  });

  test('a self-reported SOURCE_EXCERPT citation reorders the ranked list before formatSuccess sees it', async () => {
    // Two chunks that both score (so ranked has 2 entries): "Alpha" naturally
    // ranks first by lexical score, but the model says it actually grounded
    // its answer in excerpt 2 ("Beta") — formatSuccess must see Beta first.
    generateAnswerMock.mock.mockImplementation(async () => ({
      text: 'The answer is in Beta.\nSOURCE_EXCERPT: 2',
      provider: 'x', model: 'y', usage: {}
    }));
    const profile = makeProfile({
      minScore: 0,
      resolveKnowledge: async () => [
        { id: 'a#0', title: 'Alpha', content: 'shared content shared content shared', sourceFile: 'a.md', tags: [] },
        { id: 'b#0', title: 'Beta', content: 'shared content shared content shared', sourceFile: 'b.md', tags: [] }
      ]
    });
    const result = await getEngineAnswer({ profile, query: 'shared', ctx: {} });
    assert.equal(result.citedTitle, 'Beta');
    assert.equal(result.answer, 'The answer is in Beta.'); // SOURCE_EXCERPT line stripped
  });

  test('an invalid/out-of-range SOURCE_EXCERPT falls back to rank[0] rather than crashing', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({
      text: 'answer text\nSOURCE_EXCERPT: 99',
      provider: 'x', model: 'y', usage: {}
    }));
    const profile = makeProfile({ minScore: 0 });
    const result = await getEngineAnswer({ profile, query: 'alpha', ctx: {} });
    assert.equal(result.answer, 'answer text');
    assert.ok(result.citedTitle); // still cites something sane, not null/crash
  });
});

describe('getEngineAnswer — graceful degradation on LLM failure', () => {
  test('a ChatConfigError falls back to formatDegraded with the ranked chunks, not an unhandled rejection', async () => {
    generateAnswerMock.mock.mockImplementation(async () => { throw new ChatConfigError('no key'); });
    const profile = makeProfile({ minScore: 0 });
    const result = await getEngineAnswer({ profile, query: 'alpha', ctx: {} });
    assert.equal(result.answer, 'DEGRADED');
    assert.equal(result.citedTitle, 'Alpha');
  });

  test('a ChatUpstreamError degrades the same way', async () => {
    generateAnswerMock.mock.mockImplementation(async () => { throw new ChatUpstreamError('502'); });
    const profile = makeProfile({ minScore: 0 });
    const result = await getEngineAnswer({ profile, query: 'alpha', ctx: {} });
    assert.equal(result.answer, 'DEGRADED');
  });

  test('an unrelated/unexpected error is NOT swallowed into formatDegraded — it propagates', async () => {
    generateAnswerMock.mock.mockImplementation(async () => { throw new TypeError('programmer error'); });
    const profile = makeProfile({ minScore: 0 });
    await assert.rejects(
      () => getEngineAnswer({ profile, query: 'alpha', ctx: {} }),
      TypeError
    );
  });
});

describe('getEngineAnswer — onResult hook and opt-in gating (minConfidence unset = old behavior)', () => {
  test('onResult fires exactly once with the final result, on every outcome (success, fallback, degraded)', async () => {
    const seen = [];
    const profile = makeProfile({ minScore: 0, onResult: async (result) => { seen.push(result.answer); } });

    generateAnswerMock.mock.mockImplementation(async () => ({ text: 'alpha answer', provider: 'x', model: 'y', usage: {} }));
    await getEngineAnswer({ profile, query: 'alpha', ctx: {} });

    generateAnswerMock.mock.mockImplementation(async () => { throw new ChatConfigError('x'); });
    await getEngineAnswer({ profile, query: 'alpha', ctx: {} });

    const gatedProfile = makeProfile({ minScore: 2, onResult: async (result) => { seen.push(result.answer); } });
    await getEngineAnswer({ profile: gatedProfile, query: 'zzz totally unrelated zzz', ctx: {} });

    assert.deepEqual(seen, ['alpha answer', 'DEGRADED', 'FALLBACK']);
  });

  test('a profile with no onResult at all does not throw (the hook is optional)', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({ text: 'alpha answer', provider: 'x', model: 'y', usage: {} }));
    const profile = makeProfile({ minScore: 0 });
    delete profile.onResult;
    await assert.doesNotReject(() => getEngineAnswer({ profile, query: 'alpha', ctx: {} }));
  });
});

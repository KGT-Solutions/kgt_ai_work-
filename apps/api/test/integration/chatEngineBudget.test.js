const { test, describe, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// chatEngine.js destructures its imports at require time, so every collaborator
// must be mocked BEFORE it is required (same pattern as chatEngine.test.js does
// for llmClient.generateAnswer).
const llmClient = require('../../src/engine/llmClient');
const usageTracking = require('../../src/engine/usageTracking');
const ticketing = require('../../src/engine/ticketing');

const genMock = mock.method(llmClient, 'generateAnswer', async () => ({
  text: 'a real model answer', provider: 'x', model: 'y', usage: { promptTokens: 10, completionTokens: 5 }
}));
let overBudget = false;
mock.method(usageTracking, 'isTenantOverBudget', async () => overBudget);
mock.method(usageTracking, 'logUsage', async () => null);
mock.method(usageTracking, 'logCacheHit', async () => null);
const ticketMock = mock.method(ticketing, 'fileSupportTicket', async () => null);

const { getEngineAnswer } = require('../../src/engine/chatEngine');

function makeProfile(overrides = {}) {
  return {
    id: 'fake',
    resolveKnowledge: async () => [
      { id: 'a#0', title: 'Alpha', content: 'alpha content alpha content', sourceFile: 'a.md', tags: [] }
    ],
    topK: 3,
    minScore: 0,
    noAnswerSentinel: 'NO_ANSWER',
    usageTracking: true,
    ticketing: true,
    botType: 'support',
    systemPrompt: () => 'system prompt',
    formatFallback: (ctx, confidence) => ({ answer: 'FALLBACK', confidence }),
    formatSuccess: (text) => ({ answer: text, answered: true }),
    formatDegraded: () => ({ answer: 'DEGRADED' }),
    ...overrides
  };
}

describe('getEngineAnswer — per-tenant budget guardrail', () => {
  beforeEach(() => { genMock.mock.resetCalls(); ticketMock.mock.resetCalls(); overBudget = false; });

  test('under budget: a cache miss calls the model normally', async () => {
    overBudget = false;
    const result = await getEngineAnswer({ profile: makeProfile(), query: 'alpha', ctx: { tenantId: 't1' } });
    assert.equal(genMock.mock.callCount(), 1, 'the model is called when under budget');
    assert.equal(result.answer, 'a real model answer');
  });

  test('over budget: the billable model call is skipped and a budget handoff is filed', async () => {
    overBudget = true;
    const result = await getEngineAnswer({ profile: makeProfile(), query: 'alpha', ctx: { tenantId: 't1' } });
    assert.equal(genMock.mock.callCount(), 0, 'no LLM call when over budget');
    assert.equal(result.handoff, true);
    assert.equal(result.awaitingContact, true);
    assert.equal(result.answer, 'FALLBACK');
    assert.equal(ticketMock.mock.callCount(), 1, 'the question is captured as a ticket');
    assert.equal(ticketMock.mock.calls[0].arguments[0].kind, 'budget');
  });

  test('over budget never blocks when there is no tenant context', async () => {
    overBudget = true;
    // No tenantId => the guardrail is skipped (platform work, not a billed tenant).
    const result = await getEngineAnswer({ profile: makeProfile(), query: 'alpha', ctx: {} });
    assert.equal(genMock.mock.callCount(), 1);
    assert.equal(result.answer, 'a real model answer');
  });
});

// End-to-end tests for the FLATBRIZ Support Bot: the real domain profile,
// the real chatEngine, the real resident/admin manuals on disk, and the real
// checkBillStatus action registration — everything except the actual
// network call to the LLM, which is mocked. This is what confirms the whole
// pipeline is wired together correctly, not just each piece in isolation.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// llmClient.generateAnswer is destructured by chatEngine.js at require time
// — mock it before chatEngine.js (pulled in via supportBot.js) is required.
const llmClient = require('../src/engine/llmClient');
const generateAnswerMock = require('node:test').mock.method(
  llmClient,
  'generateAnswer',
  async () => ({ text: 'stub', provider: 'mock', model: 'mock', usage: {} })
);

require('../src/actions'); // registers checkBillStatus — matches app.js's boot sequence exactly
const { getSupportAnswer, OUT_OF_SCOPE_MESSAGE } = require('../src/services/chatbot/supportBot');
const { ChatUpstreamError } = llmClient;

beforeEach(() => {
  generateAnswerMock.mock.resetCalls();
});

describe('getSupportAnswer — retrieval + citation, against the real resident manual', () => {
  test('a vehicle-registration question is grounded in the Vehicles section, not the Logging In stemming collision', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({
      text: 'Go to the Vehicles section in your profile and add your license plate.',
      provider: 'mock', model: 'mock', usage: {}
    }));

    const result = await getSupportAnswer({ query: 'How do I register my car?', userRole: 'resident' });
    assert.equal(result.sourceSection, 'Vehicles');
    assert.match(result.answer, /Vehicles section/);
  });

  test('a payment-procedure question is grounded in Maintenance Bills & Payments, not the checkBillStatus live action', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({
      text: 'Open the Bills tab, view the UPI QR code, and upload your payment screenshot.',
      provider: 'mock', model: 'mock', usage: {}
    }));

    // No buildingId/userId supplied — checkBillStatus.match() requires both,
    // so this also proves the action correctly never fires without a live
    // session, and the engine falls through to RAG as it should.
    const result = await getSupportAnswer({ query: 'How do I pay my maintenance bill?', userRole: 'resident' });
    assert.equal(result.sourceSection, 'Maintenance Bills & Payments');
    assert.equal(generateAnswerMock.mock.callCount(), 1, 'the LLM must be called — the action must not have short-circuited it');
  });

  test('a synonym-only vehicle question ("parking access") still routes to Vehicles via the entity boost', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({
      text: 'Vehicles are matched to residents via your registered license plate.',
      provider: 'mock', model: 'mock', usage: {}
    }));
    const result = await getSupportAnswer({ query: 'How does parking access work for my vehicle?', userRole: 'resident' });
    assert.equal(result.sourceSection, 'Vehicles');
  });
});

describe('getSupportAnswer — per-role manual access is enforced end-to-end', () => {
  // "How do I reconcile vendor outgoings?" is deliberately jargon-only
  // (admin-manual.md's Finance & Expense Tracking section) — verified via a
  // direct retrieve() check that it scores zero against resident-manual.md
  // (no generic word like "building" to accidentally bleed into an
  // unrelated resident section) and clears minScore only for admin.
  const ADMIN_ONLY_QUERY = 'How do I reconcile vendor outgoings?';

  test('a resident asking an admin-only question gets the out-of-scope fallback, never the LLM', async () => {
    const result = await getSupportAnswer({ query: ADMIN_ONLY_QUERY, userRole: 'resident' });
    assert.equal(result.answer, OUT_OF_SCOPE_MESSAGE);
    assert.equal(result.sourceSection, null);
    assert.equal(generateAnswerMock.mock.callCount(), 0);
  });

  test('an admin asking the same question is correctly grounded in the admin manual', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({
      text: 'Use the Finance section to reconcile dues and vendor outgoings.',
      provider: 'mock', model: 'mock', usage: {}
    }));
    const result = await getSupportAnswer({ query: ADMIN_ONLY_QUERY, userRole: 'admin' });
    assert.equal(result.sourceSection, 'Finance & Expense Tracking');
  });

  test('a guard is scoped like a resident and also cannot reach admin-only content', async () => {
    const result = await getSupportAnswer({ query: ADMIN_ONLY_QUERY, userRole: 'guard' });
    assert.equal(result.answer, OUT_OF_SCOPE_MESSAGE);
  });

  test('an unrecognized role sees no manual content at all and always falls back', async () => {
    const result = await getSupportAnswer({ query: 'How do I pay my bill?', userRole: 'sales_prospect' });
    assert.equal(result.answer, OUT_OF_SCOPE_MESSAGE);
    assert.equal(generateAnswerMock.mock.callCount(), 0);
  });
});

describe('getSupportAnswer — sentinel and degraded-LLM handling', () => {
  test('the model emitting the exact NO_ANSWER_IN_MANUAL sentinel yields the out-of-scope message, not the raw token', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({ text: 'NO_ANSWER_IN_MANUAL', provider: 'mock', model: 'mock', usage: {} }));
    const result = await getSupportAnswer({ query: 'How do I register my car?', userRole: 'resident' });
    assert.equal(result.answer, OUT_OF_SCOPE_MESSAGE);
  });

  test('an LLM outage (ChatUpstreamError) degrades to a direct manual excerpt instead of erroring out', async () => {
    generateAnswerMock.mock.mockImplementation(async () => { throw new ChatUpstreamError('upstream 502'); });
    const result = await getSupportAnswer({ query: 'How do I register my car?', userRole: 'resident' });
    assert.equal(result.sourceSection, 'Vehicles');
    assert.match(result.answer, /couldn't reach the assistant right now/);
    assert.match(result.answer, /"Vehicles"/);
  });

  test('a question with no manual coverage at all gates to fallback before ever calling the LLM', async () => {
    const result = await getSupportAnswer({ query: 'what is the weather like today', userRole: 'resident' });
    assert.equal(result.answer, OUT_OF_SCOPE_MESSAGE);
    assert.equal(generateAnswerMock.mock.callCount(), 0);
  });
});

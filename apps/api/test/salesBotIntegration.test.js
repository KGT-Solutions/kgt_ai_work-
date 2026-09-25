// End-to-end tests for the FLATBRIZ Sales Bot: the real intent classifier,
// the real domain profile, the real chatEngine, and the real sales
// knowledge base on disk. Only the network LLM call and the DB/email side
// effect of lead capture are mocked.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const llmClient = require('../src/engine/llmClient');
const generateAnswerMock = require('node:test').mock.method(
  llmClient,
  'generateAnswer',
  async () => ({ text: 'stub', provider: 'mock', model: 'mock', usage: {} })
);

// captureLead is destructured by flatbrizSales.profile.js at require time —
// mock it before the profile (pulled in via salesBot.js) is first required.
const leadCapture = require('../src/services/salesbot/leadCapture');
const captureLeadMock = require('node:test').mock.method(leadCapture, 'captureLead', async () => ({ logged: true, alerted: false }));

const { getSalesAnswer, OUT_OF_SCOPE_MESSAGE } = require('../src/services/salesbot/salesBot');
const { ChatUpstreamError } = llmClient;

beforeEach(() => {
  generateAnswerMock.mock.resetCalls();
  captureLeadMock.mock.resetCalls();
});

describe('getSalesAnswer — objection routing (query → intent classifier → retrieval → prompt)', () => {
  test('a pricing objection is grounded in the matching objection-rebuttal section', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({
      text: 'FLATBRIZ actually costs less overall since there is zero payment gateway commission.',
      provider: 'mock', model: 'mock', usage: {}
    }));

    const result = await getSalesAnswer({
      query: 'This seems more expensive than what we currently use, is it worth switching?',
      clientType: 'rwa_president'
    });

    assert.match(result.answer, /zero payment gateway commission/);
    assert.ok(
      result.keyBenefitsHighlighted.some((b) => /commission/i.test(b)),
      `expected a commission-related benefit, got ${JSON.stringify(result.keyBenefitsHighlighted)}`
    );
    // No buying signal, one objection with a mapped CTA -> the pricing follow-up.
    assert.match(result.suggestedFollowUp, /gateway-commission savings/);
  });

  test('a lead is captured for the objection query, tagged with the detected objection as a signal', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({ text: 'answer', provider: 'mock', model: 'mock', usage: {} }));
    await getSalesAnswer({ query: 'This is too expensive for our budget', clientType: 'rwa_president' });

    assert.equal(captureLeadMock.mock.callCount(), 1);
    const call = captureLeadMock.mock.calls[0].arguments[0];
    assert.equal(call.clientType, 'rwa_president');
    assert.ok(call.signals.includes('objection:pricing'));
  });
});

describe('getSalesAnswer — competitor comparison routing', () => {
  test('a MyGate comparison question is grounded in the FLATBRIZ vs. MyGate section', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({
      text: 'Unlike MyGate, FLATBRIZ charges zero gateway commission on collections.',
      provider: 'mock', model: 'mock', usage: {}
    }));
    const result = await getSalesAnswer({ query: 'How do you compare to MyGate?', clientType: 'builder' });
    assert.match(result.answer, /MyGate/);
    // No objection/buying-signal tags on a pure competitor question -> the
    // builder clientType CTA, not a generic default.
    assert.match(result.suggestedFollowUp, /tower\/phase structure/);
  });
});

describe('getSalesAnswer — buying-intent signals drive both retrieval and the follow-up CTA', () => {
  test('multiple buying signals flip isHighIntent and select the buying-signal CTA', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({ text: 'Happy to set that up.', provider: 'mock', model: 'mock', usage: {} }));
    const result = await getSalesAnswer({
      query: 'We want a demo, then a trial, then to discuss the contract and timeline',
      clientType: 'builder'
    });
    assert.equal(result.suggestedFollowUp, 'Would you like to schedule a short call or live demo with our team?');

    const call = captureLeadMock.mock.calls[0].arguments[0];
    assert.equal(call.isHighIntent, true);
    assert.ok(call.intentScore >= 40);
  });
});

describe('getSalesAnswer — sentinel, degraded LLM, and out-of-scope handling', () => {
  test('the model emitting NO_ANSWER_IN_KB yields the sales out-of-scope message, not the raw token', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({ text: 'NO_ANSWER_IN_KB', provider: 'mock', model: 'mock', usage: {} }));
    const result = await getSalesAnswer({ query: 'This is too expensive for our budget', clientType: 'builder' });
    assert.equal(result.answer, OUT_OF_SCOPE_MESSAGE);
    assert.deepEqual(result.keyBenefitsHighlighted, []);
  });

  test('an LLM outage degrades to a direct KB excerpt, still carrying benefit badges and marked degraded', async () => {
    generateAnswerMock.mock.mockImplementation(async () => { throw new ChatUpstreamError('upstream 502'); });
    const result = await getSalesAnswer({ query: 'This is too expensive for our budget', clientType: 'builder' });
    assert.equal(result.degraded, true);
    assert.match(result.answer, /most relevant on/);
    assert.ok(result.keyBenefitsHighlighted.length > 0);
  });

  // Unlike the support bot (which has genuine dead ends — an unrecognized
  // role sees literally zero chunks, see supportBotIntegration.test.js),
  // boostTags() always adds a `client:${clientType}` tag, and every known
  // clientType has its own always-tagged playbook section (client-playbooks.md).
  // So with a real clientType, retrieval never truly empties out for ANY
  // query — off-topic rejection for the sales bot is enforced by the LLM's
  // own NO_ANSWER_IN_KB sentinel (see the describe block above), not by the
  // zero-retrieval gate. This is a deliberate product difference (a sales
  // conversation always has at least the client's own playbook as context)
  // and both tests below pin it down rather than assume support-bot parity.
  test('an off-topic question with a KNOWN clientType still reaches the LLM — the client-playbook tag keeps retrieval non-empty', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({ text: 'NO_ANSWER_IN_KB', provider: 'mock', model: 'mock', usage: {} }));
    const result = await getSalesAnswer({ query: 'what is your favorite movie genre', clientType: 'builder' });
    assert.equal(generateAnswerMock.mock.callCount(), 1, 'the client:builder tag boost should have kept "Talking to Builders" above minScore');
    assert.equal(result.answer, OUT_OF_SCOPE_MESSAGE); // rejection came from the sentinel, not the gate
  });

  test('the same off-topic question with NO/unknown clientType has nothing to boost and correctly gates before the LLM', async () => {
    const result = await getSalesAnswer({ query: 'what is your favorite movie genre', clientType: undefined });
    assert.equal(result.answer, OUT_OF_SCOPE_MESSAGE);
    assert.equal(generateAnswerMock.mock.callCount(), 0);
  });

  test('a lead is still captured even for an out-of-scope question — every inquiry is logged', async () => {
    await getSalesAnswer({ query: 'what is your favorite movie genre', clientType: 'builder' });
    assert.equal(captureLeadMock.mock.callCount(), 1);
  });
});

describe('getSalesAnswer — the support bot\'s action registry never leaks into the sales bot', () => {
  test('flatbrizSalesProfile.actions is empty — sales queries can never bypass RAG the way "how much do I owe" does for support', () => {
    const { flatbrizSalesProfile } = require('../src/domains/flatbrizSales.profile');
    assert.deepEqual(flatbrizSalesProfile.actions, []);
  });
});

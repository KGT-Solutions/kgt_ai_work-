const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Conversational handoffs (domains/handoffActions.js) through the real
// engine and tenant profiles. Prisma is an in-memory store; the LLM is a
// mock that must never be called for a handoff.

const llmClient = require('../src/engine/llmClient');
const generateAnswerMock = require('node:test').mock.method(llmClient, 'generateAnswer', async () => ({
  text: 'NO_ANSWER_IN_TENANT_KB', provider: 'mock', model: 'mock-1', usage: { promptTokens: 0, completionTokens: 0 }
}));
const prisma = require('../src/lib/prisma');
const { getEngineAnswer } = require('../src/engine/chatEngine');
const { createTenantSupportProfile, createTenantSalesProfile, invalidateTenantKnowledge } = require('../src/domains/tenantProfile');
const { extractBareEmail, isHumanRequest, isDemoRequest } = require('../src/domains/handoffActions');

const TENANT = {
  id: 'tenant-h', slug: 'acme', name: 'Acme', industryLabel: 'Property management', persona: null,
  outOfScopeMessage: 'I want to make sure you get the exact right answer for that, so let me connect you with our team. Would you like to leave your email so we can reach out?',
  minConfidence: 0.3
};

describe('handoff matching', () => {
  test('a bare email, with or without a short lead-in, is recognised and lower-cased', () => {
    for (const [msg, email] of [
      ['ana@acme.com', 'ana@acme.com'],
      ['Sure, it\'s Ana.Lee@Acme.co.uk', 'ana.lee@acme.co.uk'],
      ['my email is ana@acme.com thanks!', 'ana@acme.com'],
      ['you can reach me at ana+demo@acme.io.', 'ana+demo@acme.io']
    ]) assert.equal(extractBareEmail(msg), email, msg);
  });

  test('an email inside a real question is not a contact handoff', () => {
    for (const msg of [
      "ana@acme.com isn't getting the OTP",
      'Why does ana@acme.com show as inactive in the resident list?',
      'what is your email address?'
    ]) assert.equal(extractBareEmail(msg), null, msg);
  });

  test('requests for a person are caught; feature questions about chatting are not', () => {
    for (const msg of ['Can I talk to support team?', 'I want to speak with a human', 'connect me with your team', 'agent', 'Please call me back'])
      assert.ok(isHumanRequest(msg), msg);
    for (const msg of ['How do residents chat with the society manager?', 'Can tenants talk to security from the app?', 'How do I contact support about billing?'])
      assert.ok(!isHumanRequest(msg), msg);
  });

  test('demo and meeting requests are caught; ordinary questions are not', () => {
    for (const msg of ['Can I schedule a demo?', 'do you offer a product tour', 'Book a quick call with sales'])
      assert.ok(isDemoRequest(msg), msg);
    for (const msg of ['How do I book the clubhouse?', 'What does the starter plan cost?'])
      assert.ok(!isDemoRequest(msg), msg);
  });
});

describe('handoff flow through the engine', () => {
  let tickets;
  before(() => {
    const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => {
      if (v === null) return row[k] == null;
      if (v && typeof v === 'object' && 'not' in v) return row[k] != v.not; // { not: null }
      return row[k] === v;
    });
    prisma.supportTicket.create = async ({ data }) => { const t = { id: `t${tickets.length + 1}`, createdAt: new Date(Date.now() + tickets.length), ...data }; tickets.push(t); return t; };
    prisma.supportTicket.findFirst = async ({ where }) => [...tickets].reverse().find((t) => matches(t, where)) || null;
    prisma.supportTicket.update = async ({ where, data }) => Object.assign(tickets.find((t) => t.id === where.id), data);
    prisma.tenantDocument.findMany = async () => [
      { title: 'Billing', category: 'FAQ', content: '## Paying maintenance\n\nResidents pay maintenance bills from the Payments tab in the resident app using UPI or card.' }
    ];
    prisma.usageLog.create = async () => null;
  });
  beforeEach(() => { tickets = []; generateAnswerMock.mock.resetCalls(); invalidateTenantKnowledge(TENANT.id); });

  const support = () => createTenantSupportProfile(TENANT);
  const sales = () => createTenantSalesProfile(TENANT);
  const ask = (profile, query, turns = []) =>
    getEngineAnswer({ profile, query, ctx: { tenantId: TENANT.id, sessionId: 's1', recentTurns: turns } });

  test('a demo request gets a warm ask for an email and a demo ticket — no LLM call, no "no info" reply', async () => {
    const r = await ask(sales(), 'Can I schedule a demo?');
    assert.equal(generateAnswerMock.mock.callCount(), 0);
    assert.match(r.answer, /show you how Acme works.*share your email/i);
    assert.equal(r.handoff, true);
    assert.equal(r.awaitingContact, true);
    assert.equal(tickets.length, 1);
    assert.deepEqual([tickets[0].kind, tickets[0].botType, tickets[0].sessionId, tickets[0].confidence], ['demo_request', 'sales', 's1', null]);
  });

  test('the email left next is attached to that ticket and confirmed back', async () => {
    await ask(sales(), 'Can I schedule a demo?');
    const turns = [{ role: 'user', content: 'Can I schedule a demo?' }, { role: 'assistant', content: '…share your email…' }];
    const r = await ask(sales(), "Sure, it's ana@acme.com", turns);
    assert.equal(tickets.length, 1, 'no second ticket');
    assert.equal(tickets[0].contactEmail, 'ana@acme.com');
    assert.equal(r.contactCaptured, true);
    assert.match(r.answer, /ana@acme\.com/);
    assert.equal(generateAnswerMock.mock.callCount(), 0);
  });

  test('a later request in the same conversation reuses the email instead of asking again', async () => {
    await ask(support(), 'I want to speak with a human');
    await ask(support(), 'ana@acme.com', [{ role: 'assistant', content: '…' }]);
    const r = await ask(support(), 'Can I schedule a demo?');
    assert.match(r.answer, /reach out to you at ana@acme\.com/);
    assert.equal(r.awaitingContact, undefined);
    assert.equal(tickets.at(-1).kind, 'demo_request');
    assert.equal(tickets.at(-1).contactEmail, 'ana@acme.com');
  });

  test('an email after a reply with no ticket opens a follow-up ticket for the question that prompted it', async () => {
    const turns = [{ role: 'user', content: 'Do you support solar panel billing?' }, { role: 'assistant', content: '…share your email…' }];
    const r = await ask(support(), 'ana@acme.com', turns);
    assert.equal(r.contactCaptured, true);
    assert.equal(tickets.length, 1);
    assert.deepEqual([tickets[0].kind, tickets[0].query, tickets[0].contactEmail], ['contact_request', 'Do you support solar panel billing?', 'ana@acme.com']);
  });

  test('an email as the very first message is not captured — it goes to the knowledge base', async () => {
    const r = await ask(support(), 'ana@acme.com');
    assert.equal(r.contactCaptured, undefined);
    assert.ok(!tickets.some((t) => t.contactEmail));
  });

  test('a support question below the threshold hands off warmly and waits for an email', async () => {
    const r = await ask(support(), 'zebra quantum saxophone');
    assert.equal(r.answer, TENANT.outOfScopeMessage);
    assert.equal(r.handoff, true);
    assert.equal(r.awaitingContact, true);
    assert.deepEqual([tickets[0].kind, tickets[0].botType], ['unanswered', 'support']);
    assert.equal(typeof tickets[0].confidence, 'number');
  });

  test('an ordinary product question still reaches the knowledge base, not a handoff', async () => {
    await ask(support(), 'How do residents pay maintenance bills in the app?');
    // The first model call answers from the documents (the mock then says "no
    // answer", so a second one writes the contextual reply).
    assert.match(generateAnswerMock.mock.calls[0].arguments[0].userPrompt, /Payments tab/);
    assert.ok(!tickets.some((t) => t.kind === 'human_request' || t.kind === 'demo_request'));
  });

  // `answered` decides what the visitor's confirmation email recaps (services/leads.js).
  test('only a real knowledge-base answer is marked answered — never a handoff, fallback or "no answer"', async () => {
    generateAnswerMock.mock.mockImplementationOnce(async () => ({
      text: 'Residents pay from the Payments tab using UPI or card.', provider: 'mock', model: 'mock-1', usage: { promptTokens: 0, completionTokens: 0 }
    }));
    const answered = await ask(support(), 'How do residents pay maintenance bills in the app?');
    assert.equal(answered.answered, true);
    // A different question (the same one would be served from the answer cache, still answered).
    assert.equal((await ask(support(), 'Can residents pay maintenance bills by card?')).answered, undefined, 'model said NO_ANSWER');
    assert.equal((await ask(sales(), 'Can I schedule a demo?')).answered, undefined, 'handoff action');
    assert.equal((await ask(support(), 'zebra quantum saxophone')).answered, undefined, 'below the gate');
  });
});

describe('small talk', () => {
  const { smallTalkKind } = require('../src/domains/smallTalk');

  test('greetings, "how are you", thanks, goodbyes and acknowledgements are recognised', () => {
    for (const [msg, kind] of [
      ['Hi', 'greeting'], ['hello there!', 'greeting'], ['Good morning', 'greeting'], ['Howdy', 'greeting'],
      ['Hey, how are you?', 'howAreYou'], ["how's it going", 'howAreYou'],
      ['thanks!', 'thanks'], ['Thank you so much for your help', 'thanks'], ['ok thanks', 'thanks'],
      ['bye', 'goodbye'], ["that's all", 'goodbye'], ['ok', 'acknowledge'], ['got it', 'acknowledge']
    ]) assert.equal(smallTalkKind(msg), kind, msg);
  });

  test('a greeting with a real question is not small talk', () => {
    for (const msg of ['Hi, how do I pay my bill?', 'hello can I add a resident', 'Hey there, what does the app cost?', 'thanks, but the payment still failed'])
      assert.equal(smallTalkKind(msg), null, msg);
  });
});

describe('greetings, offers and contextual replies through the engine', () => {
  let tickets;
  const { acceptBridge } = require('../src/engine/bridgeReply');
  before(() => {
    prisma.supportTicket.create = async ({ data }) => { tickets.push(data); return data; };
    prisma.supportTicket.findFirst = async () => null;
    prisma.supportTicket.update = async () => null;
  });
  beforeEach(() => { tickets = []; generateAnswerMock.mock.resetCalls(); invalidateTenantKnowledge(TENANT.id); });
  const ask = (profile, query, turns = []) =>
    getEngineAnswer({ profile, query, ctx: { tenantId: TENANT.id, sessionId: 's2', recentTurns: turns } });

  test('"Hi" gets a warm welcome — no LLM call, no ticket, no handoff', async () => {
    const r = await ask(createTenantSupportProfile(TENANT), 'Hi');
    assert.match(r.answer, /^Hello there! Welcome to Acme support/);
    assert.equal(generateAnswerMock.mock.callCount(), 0);
    assert.equal(tickets.length, 0);
    assert.equal(r.handoff, undefined);
    const again = await ask(createTenantSalesProfile(TENANT), 'hello', [{ role: 'assistant', content: 'Hi there…' }]);
    assert.equal(again.answer, 'Hi again! What else would you like to know?');
  });

  test('"yes" to a follow-up offer asks for the email; "no thanks" is gracious; both without a new ticket', async () => {
    const offer = [{ role: 'user', content: 'Can I pay in bitcoin?' }, { role: 'assistant', content: 'Would you like me to drop a quick note for our team?' }];
    const yes = await ask(createTenantSupportProfile(TENANT), 'yes please', offer);
    assert.match(yes.answer, /best email/);
    assert.equal(yes.awaitingContact, true);
    const no = await ask(createTenantSupportProfile(TENANT), 'no thanks', offer);
    assert.match(no.answer, /No problem at all/);
    assert.equal(tickets.length, 0);
  });

  test('without a pending offer, "ok" is just an acknowledgement', async () => {
    const r = await ask(createTenantSupportProfile(TENANT), 'ok', [{ role: 'assistant', content: 'Go to Payments and tap Pay.' }]);
    assert.match(r.answer, /^Great!/);
    assert.equal(r.awaitingContact, undefined);
  });

  test('an unanswerable question gets the contextual reply when it passes the safety checks', async () => {
    const bridge = "It sounds like you'd like to pay your dues in cryptocurrency. I'm your Acme assistant and mostly help " +
      'with using Acme day to day, so would you like me to drop a quick note for our team to follow up with you directly?';
    generateAnswerMock.mock.mockImplementation(async () => ({ text: bridge, provider: 'mock', model: 'mock-1', usage: { promptTokens: 0, completionTokens: 0 } }));
    try {
      const r = await ask(createTenantSupportProfile(TENANT), 'zebra quantum saxophone crypto');
      assert.equal(r.answer, bridge);
      assert.equal(r.handoff, true);
      assert.equal(tickets[0].kind, 'unanswered', 'still logged for the knowledge-gap list');
    } finally {
      generateAnswerMock.mock.mockImplementation(async () => ({ text: 'NO_ANSWER_IN_TENANT_KB', provider: 'mock', model: 'mock-1', usage: { promptTokens: 0, completionTokens: 0 } }));
    }
  });

  test('a contextual reply that slips in an answer is discarded for the fixed message', async () => {
    generateAnswerMock.mock.mockImplementation(async () => ({ text: 'Sure! Go to Settings and pay 500 rupees by card. Want our team to follow up?', provider: 'mock', model: 'mock-1', usage: { promptTokens: 0, completionTokens: 0 } }));
    try {
      const r = await ask(createTenantSupportProfile(TENANT), 'zebra quantum saxophone');
      assert.equal(r.answer, TENANT.outOfScopeMessage);
    } finally {
      generateAnswerMock.mock.mockImplementation(async () => ({ text: 'NO_ANSWER_IN_TENANT_KB', provider: 'mock', model: 'mock-1', usage: { promptTokens: 0, completionTokens: 0 } }));
    }
  });

  test('acceptBridge rejects numbers, links, lists, the sentinel, no follow-up offer, and length extremes', () => {
    const ok = "I can see you'd like help with something beyond the app itself. Would you like me to drop a quick note for our team?";
    assert.deepEqual(acceptBridge(ok, { sentinel: 'NO_ANSWER' }), { text: ok, offTopic: false });
    for (const bad of [
      ok.replace('beyond', 'in 2 steps beyond'),
      `${ok} See https://acme.com`,
      `- First, open the app.\n${ok}`,
      `NO_ANSWER ${ok}`,
      "I can see you'd like help with something beyond the app itself, and that's completely understandable.",
      'Shall I note it?',
      `${ok} `.repeat(6)
    ]) assert.equal(acceptBridge(bad, { sentinel: 'NO_ANSWER' }), null, bad.slice(0, 60));
  });

  test('numbers the visitor used may be echoed back; any other number may not', () => {
    const reply = "Pricing for a 200-flat society is something our team can confirm for you. Would you like me to drop a quick note for our team?";
    assert.ok(acceptBridge(reply, { query: 'How much for 200 flats?' }));
    assert.equal(acceptBridge(reply, { query: 'How much for my society?' }), null);
  });

  test('an off-topic message gets a kind redirect: no follow-up offer needed, no handoff, no ticket', async () => {
    const redirect = "That one's outside what I can help with here, but I'd be glad to help with anything about using Acme.";
    generateAnswerMock.mock.mockImplementation(async () => ({ text: `OFF_TOPIC: ${redirect}`, provider: 'mock', model: 'mock-1', usage: { promptTokens: 0, completionTokens: 0 } }));
    try {
      const r = await ask(createTenantSupportProfile(TENANT), 'What is the capital of France?');
      assert.equal(r.answer, redirect, 'the marker is stripped');
      assert.equal(r.handoff, undefined);
      assert.equal(r.awaitingContact, undefined);
      assert.equal(tickets.length, 0);
    } finally {
      generateAnswerMock.mock.mockImplementation(async () => ({ text: 'NO_ANSWER_IN_TENANT_KB', provider: 'mock', model: 'mock-1', usage: { promptTokens: 0, completionTokens: 0 } }));
    }
  });
});

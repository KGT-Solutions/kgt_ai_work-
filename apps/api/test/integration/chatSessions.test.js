const { test, describe, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// Session-wise summaries (services/chatSessions.js) and team alerts
// (services/teamAlerts.js). Prisma is an in-memory store; the mailer and the
// LLM are mocks, installed before the services are required (they destructure them).

const mailer = require('../../src/services/mailer');
const sendMailMock = mock.method(mailer, 'sendMail', async () => ({ sent: true, via: 'dev-log' }));
const llmClient = require('../../src/engine/llmClient');
mock.method(llmClient, 'isLlmConfigured', () => true);
const generateAnswerMock = mock.method(llmClient, 'generateAnswer', async () => ({
  text: 'Intent: Asked about opening hours\nKey questions:\n- When are you open?\nOutcome: Answered\nFollow-up actions:\n- None',
  provider: 'mock', model: 'mock-1', usage: { promptTokens: 5, completionTokens: 5 }
}));

const prisma = require('../../src/lib/prisma');
const { summarizeSession, endSession, findSessionsToSummarize } = require('../../src/services/chatSessions');
const {
  needsAttention, parseTeamEmail, teamRecipients, notifyIfNeedsAttention, resetAlertThrottle
} = require('../../src/services/teamAlerts');

const TENANT = { id: 'tenant-s', slug: 'acme', name: 'Acme', industryLabel: 'Retail', teamEmail: 'team@acme.test' };
let sessions, messages, leads, users;
/** Polls until cond() holds (up to 3s): background work, not a fixed delay, which flakes under load. */
async function waitFor(cond) {
  for (let i = 0; i < 300 && !cond(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
}

beforeEach(() => {
  sessions = []; messages = []; leads = []; users = [];
  sendMailMock.mock.resetCalls();
  generateAnswerMock.mock.resetCalls();
  resetAlertThrottle();

  prisma.chatSession.findUnique = async ({ where }) => {
    const s = sessions.find((x) => x.id === where.id);
    return s ? { ...s, tenant: { id: TENANT.id, name: TENANT.name, industryLabel: TENANT.industryLabel } } : null;
  };
  prisma.chatSession.findFirst = async ({ where }) => sessions.find((s) => s.id === where.id && s.tenantId === where.tenantId) || null;
  prisma.chatSession.update = async ({ where, data }) => Object.assign(sessions.find((s) => s.id === where.id), data);
  prisma.chatSession.updateMany = async ({ where, data }) => {
    const hit = sessions.filter((s) => s.id === where.id && s.tenantId === where.tenantId && (!('endedAt' in where) || s.endedAt == null));
    for (const s of hit) Object.assign(s, data);
    return { count: hit.length };
  };
  prisma.chatMessage.findMany = async ({ where, take }) =>
    [...messages.filter((m) => m.sessionId === where.sessionId)].reverse().slice(0, take);
  prisma.lead.findMany = async ({ where }) => leads.filter((l) => l.sessionId === where.sessionId && l.tenantId === where.tenantId);
  prisma.lead.findUnique = async () => null;
  prisma.tenantUser.findMany = async () => users;
  prisma.usageLog.create = async () => null;
});

const addSession = (over = {}) => {
  const s = { id: `s${sessions.length + 1}`, tenantId: TENANT.id, botType: 'support', summary: null, summaryStatus: 'none', endedAt: null, ...over };
  sessions.push(s);
  return s;
};
const addTurn = (sessionId, q, a) => messages.push(
  { sessionId, role: 'user', content: q, botType: 'support', createdAt: new Date(messages.length + 1) },
  { sessionId, role: 'assistant', content: a, botType: 'support', createdAt: new Date(messages.length + 2) }
);

describe('summarizeSession', () => {
  test('writes a cleaned summary for a conversation without a lead, using the review-style prompt', async () => {
    const s = addSession();
    addTurn(s.id, 'When are you open?', 'Nine to five, Monday to Friday.');
    await summarizeSession(s.id);
    assert.equal(s.summaryStatus, 'ready');
    assert.match(s.summary, /^Intent: Asked about opening hours\nKey questions:\n• When are you open\?\nOutcome: Answered/);
    assert.ok(s.summarizedAt instanceof Date);
    const { systemPrompt, userPrompt } = generateAnswerMock.mock.calls[0].arguments[0];
    assert.match(systemPrompt, /didn't leave contact details/);
    assert.match(systemPrompt, /Outcome:/);
    assert.match(userPrompt, /Visitor: When are you open\?/);
  });

  test('a conversation that produced a lead is left to the lead summarizer: no second LLM call', async () => {
    const s = addSession();
    addTurn(s.id, 'Pricing?', 'Share your email and we will send it.');
    leads.push({ id: 'l1', tenantId: TENANT.id, sessionId: s.id });
    await summarizeSession(s.id);
    assert.equal(generateAnswerMock.mock.callCount(), 0);
    assert.equal(s.summaryStatus, 'none');
  });

  test('a single message is not worth a summary', async () => {
    const s = addSession();
    messages.push({ sessionId: s.id, role: 'user', content: 'hi', createdAt: new Date() });
    await summarizeSession(s.id);
    assert.equal(generateAnswerMock.mock.callCount(), 0);
    assert.equal(s.summaryStatus, 'none');
    assert.ok(s.summarizedAt instanceof Date, 'marked as looked at, so the sweep skips it');
  });

  test('an LLM failure is recorded, not thrown', async () => {
    generateAnswerMock.mock.mockImplementationOnce(async () => { throw new Error('upstream down'); });
    const s = addSession();
    addTurn(s.id, 'Q', 'A');
    await summarizeSession(s.id);
    assert.equal(s.summaryStatus, 'failed');
    assert.ok(s.summarizedAt instanceof Date);
  });
});

describe('endSession', () => {
  test("marks the conversation ended and summarizes it now; another tenant's id is not found", async () => {
    const s = addSession();
    addTurn(s.id, 'Q', 'A');
    assert.equal(await endSession({ tenantId: 'someone-else', sessionId: s.id }), false);
    assert.equal(s.endedAt, null);
    assert.equal(await endSession({ tenantId: TENANT.id, sessionId: s.id }), true);
    assert.ok(s.endedAt instanceof Date);
    await waitFor(() => s.summaryStatus === 'ready');
    assert.equal(s.summaryStatus, 'ready');
  });
});

describe('findSessionsToSummarize', () => {
  test('asks the database for idle, stale conversations of active tenants', async () => {
    let sql = '';
    prisma.$queryRaw = async (strings) => { sql = strings.join('?'); return [{ id: 's9' }]; };
    assert.deepEqual(await findSessionsToSummarize({ limit: 5 }), ['s9']);
    assert.match(sql, /t\.active/);
    assert.match(sql, /"summarizedAt" IS NULL OR s\."summarizedAt" < s\."lastMessageAt"/);
  });
});

describe('team alerts', () => {
  test('needsAttention: handoffs and answers below 25%, never off-topic redirects or the email-captured turn', () => {
    assert.equal(needsAttention({ handoff: true }), 'handoff');
    assert.equal(needsAttention({ confidence: 0.24 }), 'low_confidence');
    assert.equal(needsAttention({ confidence: 0.25 }), null);
    // Ordinary, correct answers score 33-50% (engine/confidence.js): no alert.
    for (const c of [0.33, 0.44, 0.5]) assert.equal(needsAttention({ confidence: c, answered: true }), null);
    assert.equal(needsAttention({ confidence: undefined }), null); // greetings and actions carry no score
    assert.equal(needsAttention({ confidence: 0.1, offTopic: true }), null);
    assert.equal(needsAttention({ handoff: true, contactCaptured: true }), null);
  });

  test('LOW_CONFIDENCE_ALERT_BELOW moves the threshold', () => {
    process.env.LOW_CONFIDENCE_ALERT_BELOW = '0.7';
    try {
      assert.equal(needsAttention({ confidence: 0.6 }), 'low_confidence');
    } finally {
      delete process.env.LOW_CONFIDENCE_ALERT_BELOW;
    }
  });

  test('parseTeamEmail: up to 5 valid addresses, lower-cased and de-duplicated; empty clears', () => {
    assert.deepEqual(parseTeamEmail('A@x.com; b@x.com, a@x.com'), { ok: true, value: 'a@x.com, b@x.com' });
    assert.deepEqual(parseTeamEmail(''), { ok: true, value: null });
    assert.equal(parseTeamEmail('not-an-email').ok, false);
    assert.equal(parseTeamEmail('a@x.co,b@x.co,c@x.co,d@x.co,e@x.co,f@x.co').ok, false);
  });

  test('recipients: the team email, else the signup email, else the dashboard users', async () => {
    users = [{ email: 'owner@acme.test' }];
    assert.deepEqual(await teamRecipients({ id: TENANT.id, teamEmail: 'a@x.com, b@x.com' }), ['a@x.com', 'b@x.com']);
    assert.deepEqual(await teamRecipients({ id: TENANT.id, signupEmail: 'Sign@Acme.test' }), ['sign@acme.test']);
    assert.deepEqual(await teamRecipients({ id: TENANT.id }), ['owner@acme.test']);
  });

  test('a low-confidence answer sends one alert with the percentage; the same conversation is then throttled', async () => {
    const s = addSession();
    addTurn(s.id, 'Do you ship to <Mars>?', 'Possibly.');
    const args = { tenant: TENANT, botType: 'sales', sessionId: s.id, query: 'Do you ship to <Mars>?', result: { confidence: 0.12 } };
    const first = await notifyIfNeedsAttention(args);
    assert.equal(first.sent, true);
    const mail = sendMailMock.mock.calls[0].arguments[0];
    assert.deepEqual(mail.to, ['team@acme.test']);
    assert.match(mail.subject, /Sales bot gave a low-confidence answer \(12%\)/);
    assert.match(mail.html, /&lt;Mars&gt;/);
    assert.doesNotMatch(mail.html, /<Mars>/);
    assert.equal((await notifyIfNeedsAttention(args)).reason, 'session-cooldown');
    assert.equal(sendMailMock.mock.callCount(), 1);
  });

  test('the per-tenant hourly cap holds across conversations', async () => {
    process.env.ALERT_TENANT_MAX_PER_HOUR = '2';
    try {
      const results = [];
      for (let i = 0; i < 3; i++) {
        results.push(await notifyIfNeedsAttention({ tenant: TENANT, botType: 'support', sessionId: `x${i}`, query: 'q', result: { handoff: true } }));
      }
      assert.deepEqual(results.map((r) => r.sent || r.reason), [true, true, 'throttled']);
    } finally {
      delete process.env.ALERT_TENANT_MAX_PER_HOUR;
    }
  });

  test('TEAM_ALERTS_ENABLED=false turns alerts off', async () => {
    process.env.TEAM_ALERTS_ENABLED = 'false';
    try {
      const r = await notifyIfNeedsAttention({ tenant: TENANT, botType: 'support', sessionId: 'z', query: 'q', result: { handoff: true } });
      assert.equal(r.sent, false);
      assert.equal(sendMailMock.mock.callCount(), 0);
    } finally {
      delete process.env.TEAM_ALERTS_ENABLED;
    }
  });
});

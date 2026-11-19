const { test, describe, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// Step 6 G1 — the dashboard's test chat (sandbox) must leave no trace:
//   - runTenantChat (services/tenantChat.js): no chat_sessions row, no
//     chat_messages, no lead, no team-alert check; it still runs the full engine
//     and threads ctx.sandbox through so the engine knows this is a test;
//   - fileSupportTicket (engine/ticketing.js): ctx.sandbox short-circuits before
//     any ticket is created.
// A live visitor chat (sandbox:false) still does all of the above.
//
// Every destructured dependency of tenantChat is mocked BEFORE the service is
// required, so the module picks up the mocks at load (destructuring copies the
// reference). prisma methods are stubbed per-test since they're called off the
// cached prisma object, not destructured.

const chatEngine = require('../../src/engine/chatEngine');
const getEngineAnswerMock = mock.method(chatEngine, 'getEngineAnswer', async () => ({
  answer: 'We are open 9 to 5.', confidence: 0.6, answered: true
}));
const catalogIngest = require('../../src/services/catalogIngest');
mock.method(catalogIngest, 'matchCatalogProducts', async () => []);
const tenantProfile = require('../../src/domains/tenantProfile');
mock.method(tenantProfile, 'createTenantSupportProfile', () => ({ botType: 'support' }));
mock.method(tenantProfile, 'createTenantSalesProfile', () => ({ botType: 'sales' }));
const leads = require('../../src/services/leads');
const trackLeadMock = mock.method(leads, 'trackLeadActivity', async () => null);
const chatSessionsSvc = require('../../src/services/chatSessions');
const recordTurnMock = mock.method(chatSessionsSvc, 'recordTurn', async () => null);
const teamAlerts = require('../../src/services/teamAlerts');
const notifyMock = mock.method(teamAlerts, 'notifyIfNeedsAttention', async () => ({ sent: false }));

const prisma = require('../../src/lib/prisma');
const { runTenantChat } = require('../../src/services/tenantChat');
const { fileSupportTicket } = require('../../src/engine/ticketing');

const TENANT = { id: 'tenant-sb', name: 'Acme', slug: 'acme', industryLabel: 'Retail' };

describe('runTenantChat: sandbox isolation', () => {
  let calls;
  beforeEach(() => {
    calls = { sessionCreate: 0, messageCreateMany: 0 };
    prisma.chatSession.findFirst = async () => null;
    prisma.chatSession.create = async ({ data }) => { calls.sessionCreate++; return { id: 'real-session-1', ...data }; };
    prisma.chatMessage.findMany = async () => [];
    prisma.chatMessage.createMany = async () => { calls.messageCreateMany++; return { count: 2 }; };
    prisma.tenantFaq.findUnique = async () => null;
    getEngineAnswerMock.mock.resetCalls();
    trackLeadMock.mock.resetCalls();
    recordTurnMock.mock.resetCalls();
    notifyMock.mock.resetCalls();
  });

  test('a sandbox test chat writes nothing and returns a synthetic session id', async () => {
    const res = await runTenantChat({ tenant: TENANT, body: { query: 'What are your hours?' }, sandbox: true });

    assert.equal(calls.sessionCreate, 0, 'no chat_sessions row is created');
    assert.equal(calls.messageCreateMany, 0, 'no chat_messages are written');
    assert.equal(recordTurnMock.mock.callCount(), 0, 'no session bookkeeping');
    assert.equal(trackLeadMock.mock.callCount(), 0, 'no lead is tracked');
    assert.equal(notifyMock.mock.callCount(), 0, 'no team alert check');

    assert.match(res.sessionId, /^sandbox-/, 'an ephemeral, unpersisted session id');
    assert.equal(res.answer, 'We are open 9 to 5.');
    // The flag is threaded into the engine ctx, where engine/ticketing.js reads it.
    assert.equal(getEngineAnswerMock.mock.calls[0].arguments[0].ctx.sandbox, true);
  });

  test('a live visitor chat records the session, messages, lead and alert check', async () => {
    const res = await runTenantChat({ tenant: TENANT, body: { query: 'What are your hours?' }, sandbox: false });

    assert.equal(calls.sessionCreate, 1);
    assert.equal(calls.messageCreateMany, 1);
    assert.equal(recordTurnMock.mock.callCount(), 1);
    assert.equal(trackLeadMock.mock.callCount(), 1);
    assert.equal(notifyMock.mock.callCount(), 1);
    assert.equal(res.sessionId, 'real-session-1');
    assert.equal(getEngineAnswerMock.mock.calls[0].arguments[0].ctx.sandbox, false);
  });
});

describe('fileSupportTicket: sandbox guard', () => {
  let ticketCreate;
  beforeEach(() => {
    ticketCreate = 0;
    prisma.supportTicket.create = async ({ data }) => { ticketCreate++; return { id: 't1', ...data }; };
  });

  test('a sandbox ctx never files a real ticket', async () => {
    const r = await fileSupportTicket({ profile: { botType: 'support' }, query: 'q', confidence: 0.1, ctx: { tenantId: 't', sessionId: 's', sandbox: true } });
    assert.equal(r, null);
    assert.equal(ticketCreate, 0);
  });

  test('a live ctx files the ticket as before', async () => {
    const r = await fileSupportTicket({ profile: { botType: 'support' }, query: 'q', confidence: 0.1, ctx: { tenantId: 't', sessionId: 's', sandbox: false } });
    assert.equal(ticketCreate, 1);
    assert.ok(r && r.id);
  });

  test('no tenant still returns null (unchanged behavior)', async () => {
    const r = await fileSupportTicket({ profile: {}, query: 'q', ctx: {} });
    assert.equal(r, null);
    assert.equal(ticketCreate, 0);
  });
});

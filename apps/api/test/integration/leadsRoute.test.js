const { test, describe, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
// Before the router (and teamAlerts.js) is required: it destructures sendMail.
const mailer = require('../../src/services/mailer');
const sendMailMock = mock.method(mailer, 'sendMail', async () => ({ sent: true, via: 'smtp' }));

// GET /leads and PATCH /leads/:id on the workspace router (the one mounted
// at /api/v1/client/workspace). Prisma's lead model is an in-memory table
// that applies the same where/orderBy/take the route asks the database for,
// so these check that filtering happens in the query, scoped to the tenant.

const prisma = require('../../src/lib/prisma');
const workspaceRouter = require('../../src/routes/tenantWorkspace.routes');

const TENANT_ID = 'tenant-r';
let rows, queries;
const lead = (id, tenantId, botType, status, minutesAgo) =>
  ({ id, tenantId, botType, status, email: `${id}@x.com`, createdAt: new Date(Date.now() - minutesAgo * 60_000) });
const matches = (row, where) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
  if (v && typeof v === 'object' && 'gt' in v) return row[k] > v.gt;
  return row[k] === v;
});

let server, base;
before(async () => {
  prisma.lead.findMany = async ({ where, orderBy, take }) => {
    queries.push(where);
    const dir = orderBy.createdAt === 'desc' ? -1 : 1;
    return rows.filter((r) => matches(r, where)).sort((a, b) => dir * (a.createdAt - b.createdAt)).slice(0, take);
  };
  prisma.lead.groupBy = async ({ by, where }) => {
    const groups = new Map();
    for (const r of rows.filter((r) => matches(r, where))) {
      const key = by.map((k) => r[k]).join('|');
      const g = groups.get(key) || { ...Object.fromEntries(by.map((k) => [k, r[k]])), _count: { _all: 0 } };
      g._count._all += 1;
      groups.set(key, g);
    }
    return [...groups.values()];
  };
  prisma.lead.findFirst = async ({ where }) => rows.find((r) => matches(r, where)) || null;
  prisma.lead.update = async ({ where, data }) => Object.assign(rows.find((r) => r.id === where.id), data);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.tenant = { id: TENANT_ID }; req.actor = 'client'; next(); });
  app.use('/', workspaceRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

beforeEach(() => {
  queries = [];
  rows = [
    lead('s-new', TENANT_ID, 'sales', 'NEW', 1),
    lead('s-done', TENANT_ID, 'sales', 'CONTACTED', 2),
    lead('p-new', TENANT_ID, 'support', 'NEW', 3),
    lead('p-new2', TENANT_ID, 'support', 'NEW', 4),
    lead('other', 'someone-else', 'sales', 'NEW', 0)
  ];
});

const get = async (qs = '') => {
  const res = await fetch(`${base}/leads${qs}`);
  return { status: res.status, body: await res.json() };
};
const ids = (body) => body.leads.map((l) => l.id);

describe('GET /leads', () => {
  test('no filter: every lead of this tenant, newest first, and never another tenant\'s', async () => {
    const { status, body } = await get();
    assert.equal(status, 200);
    assert.deepEqual(ids(body), ['s-new', 's-done', 'p-new', 'p-new2']);
    assert.deepEqual(queries[0], { tenantId: TENANT_ID });
    assert.deepEqual(body.filters, { botType: 'all', status: 'all' });
  });

  test('bot and status filters go into the database query, alone and combined', async () => {
    assert.deepEqual(ids((await get('?botType=sales')).body), ['s-new', 's-done']);
    assert.deepEqual(ids((await get('?botType=support')).body), ['p-new', 'p-new2']);
    assert.deepEqual(ids((await get('?status=NEW')).body), ['s-new', 'p-new', 'p-new2']);
    assert.deepEqual(ids((await get('?status=contacted')).body), ['s-done'], 'status is case-insensitive');
    assert.deepEqual(ids((await get('?botType=Support&status=NEW')).body), ['p-new', 'p-new2']);
    assert.deepEqual(ids((await get('?botType=support&status=CONTACTED')).body), []);
    assert.deepEqual(queries.at(-1), { tenantId: TENANT_ID, botType: 'support', status: 'CONTACTED' });
    assert.deepEqual(ids((await get('?botType=all&status=all')).body).length, 4);
  });

  test('counts cover all of the tenant\'s leads, whatever the filter', async () => {
    const { body } = await get('?botType=sales&status=CONTACTED');
    assert.deepEqual(body.counts, { total: 4, sales: 2, support: 2, NEW: 3, CONTACTED: 1 });
  });

  test('unknown filter values are rejected, not ignored', async () => {
    assert.equal((await get('?botType=marketing')).status, 400);
    assert.equal((await get('?status=ARCHIVED')).status, 400);
    assert.equal(queries.length, 0);
  });
});

describe('PATCH /leads/:id', () => {
  const patch = (id, body) => fetch(`${base}/leads/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });

  test('marking a lead contacted moves it between the status filters', async () => {
    assert.equal((await patch('p-new', { status: 'CONTACTED' })).status, 200);
    assert.deepEqual(ids((await get('?status=CONTACTED')).body), ['s-done', 'p-new']);
    assert.deepEqual(ids((await get('?status=NEW')).body), ['s-new', 'p-new2']);
  });

  test('another tenant\'s lead reads as missing; a bad status is rejected', async () => {
    assert.equal((await patch('other', { status: 'CONTACTED' })).status, 404);
    assert.equal(rows.find((r) => r.id === 'other').status, 'NEW');
    assert.equal((await patch('s-new', { status: 'WON' })).status, 400);
  });
});

// GET /sessions and GET /sessions/:id: an in-memory ChatSession table that
// honours the route's where, cursor and take.
describe('sessions', () => {
  let sessions, messages;
  const session = (id, tenantId, botType, minutesAgo, over = {}) => ({
    id, tenantId, botType, messageCount: 2, lastMessageAt: new Date(Date.now() - minutesAgo * 60_000),
    summary: `summary of ${id}`, summaryStatus: 'ready', ...over
  });

  beforeEach(() => {
    sessions = [
      session('a', TENANT_ID, 'sales', 1),
      session('b', TENANT_ID, 'support', 2),
      session('empty', TENANT_ID, 'support', 0, { messageCount: 0 }),
      session('theirs', 'someone-else', 'sales', 0)
    ];
    messages = [
      { id: 'm1', sessionId: 'b', role: 'user', content: 'hi', createdAt: new Date(1) },
      { id: 'm2', sessionId: 'b', role: 'assistant', content: 'hello', confidence: 0.4, createdAt: new Date(2) }
    ];
    rows.push({ ...lead('lead-b', TENANT_ID, 'support', 'NEW', 2), sessionId: 'b' });
    prisma.chatSession.findMany = async ({ where, take, cursor }) => {
      queries.push(where);
      let list = sessions.filter((s) => matches(s, where)).sort((x, y) => y.lastMessageAt - x.lastMessageAt);
      if (cursor) list = list.slice(list.findIndex((s) => s.id === cursor.id) + 1);
      return list.slice(0, take);
    };
    prisma.chatSession.findFirst = async ({ where }) => sessions.find((s) => matches(s, where)) || null;
    prisma.chatMessage.findMany = async ({ where }) => messages.filter((m) => m.sessionId === where.sessionId);
  });

  test("lists this tenant's conversations with a turn, newest first, each with its leads", async () => {
    const body = await (await fetch(`${base}/sessions`)).json();
    assert.deepEqual(body.sessions.map((s) => s.id), ['a', 'b']);
    assert.deepEqual(body.sessions[1].leads.map((l) => l.email), ['lead-b@x.com']);
    assert.deepEqual(body.sessions[0].leads, []);
    assert.equal(body.nextCursor, null);
  });

  test('the bot filter goes into the query; an unknown bot is rejected', async () => {
    const body = await (await fetch(`${base}/sessions?botType=support`)).json();
    assert.deepEqual(body.sessions.map((s) => s.id), ['b']);
    assert.deepEqual(queries.find((q) => 'messageCount' in q), { tenantId: TENANT_ID, messageCount: { gt: 0 }, botType: 'support' });
    assert.equal((await fetch(`${base}/sessions?botType=marketing`)).status, 400);
  });

  test("one conversation comes with its transcript; another tenant's reads as missing", async () => {
    const body = await (await fetch(`${base}/sessions/b`)).json();
    assert.deepEqual(body.messages.map((m) => m.content), ['hi', 'hello']);
    assert.equal(body.leads[0].id, 'lead-b');
    assert.equal((await fetch(`${base}/sessions/theirs`)).status, 404);
  });
});

// GET /improvements: the SQL that picks sessions runs against Postgres in
// test/db; here $queryRaw is stubbed and the route's pairing of each weak
// answer with its question is checked.
describe('improvements', () => {
  let sql, messages;
  const at = (n) => new Date(2026, 9, 16, 12, 0, n);
  beforeEach(() => {
    sql = null;
    messages = [
      { id: 'u1', sessionId: 'b', role: 'user', content: 'Do you ship to Mars?', botType: 'support', createdAt: at(1) },
      // The gate's fallback: low score, no answer.
      { id: 'a1', sessionId: 'b', role: 'assistant', content: 'Not sure.', botType: 'support', confidence: 0.21, answered: false, createdAt: at(1) },
      { id: 'u2', sessionId: 'b', role: 'user', content: 'Opening hours?', botType: 'support', createdAt: at(2) },
      // An ordinary, correct answer: scores in the 33-50% band are normal (engine/confidence.js).
      { id: 'a2', sessionId: 'b', role: 'assistant', content: '9 to 5.', botType: 'support', confidence: 0.44, answered: true, createdAt: at(2) },
      { id: 'u3', sessionId: 'b', role: 'user', content: 'Enterprise pricing?', botType: 'sales', createdAt: at(3) },
      // Retrieval found something (40%) but the model found no answer in it: a miss whatever the score.
      { id: 'a3', sessionId: 'b', role: 'assistant', content: 'Could you rephrase?', botType: 'sales', confidence: 0.4, answered: false, createdAt: at(3) },
      { id: 'u4', sessionId: 'b', role: 'user', content: 'Annual billing?', botType: 'sales', createdAt: at(4) },
      { id: 'a4', sessionId: 'b', role: 'assistant', content: 'Yes, yearly.', botType: 'sales', confidence: 0.36, answered: true, createdAt: at(4) }
    ];
    prisma.$queryRaw = async (strings, ...values) => {
      // Prisma.sql fragments arrive as nested values; Prisma itself flattens them.
      sql = { text: strings.join('?'), values: values.flatMap((v) => (v && Array.isArray(v.values) ? v.values : [v])) };
      return [{ id: 'b', lowest: 0.21, weakAnswers: 2, lastWeakAt: at(3), totalSessions: 1, totalWeakAnswers: 2 }];
    };
    prisma.chatSession.findMany = async ({ where }) =>
      [{ id: 'b', tenantId: TENANT_ID, botType: 'support', messageCount: 6, lastMessageAt: at(3) }].filter((s) => where.id.in.includes(s.id));
    prisma.chatMessage.findMany = async ({ where }) => messages.filter((m) => where.sessionId.in.includes(m.sessionId));
  });

  test('only genuine misses come back, each with the question that led to it, across both bots', async () => {
    const body = await (await fetch(`${base}/improvements`)).json();
    assert.equal(body.below, 0.25);
    assert.equal(body.totalSessions, 1);
    // Not the correct answers at 44% and 36%.
    assert.deepEqual(body.sessions[0].weak.map((w) => [w.question, w.confidence, w.botType]),
      [['Do you ship to Mars?', 0.21, 'support'], ['Enterprise pricing?', 0.4, 'sales']]);
    assert.equal(body.sessions[0].lowest, 0.21);
    assert.equal(body.nextPage, null);
    assert.ok(sql.values.includes(TENANT_ID), 'scoped to this tenant');
    assert.ok(sql.values.includes(0.25));
    assert.match(sql.text, /m\.confidence < \? OR NOT m\.answered/, 'the database applies the same rule');
  });

  test('the bot filter narrows the query and the answers; an unknown bot is rejected', async () => {
    const body = await (await fetch(`${base}/improvements?botType=sales`)).json();
    assert.ok(sql.values.includes('sales'));
    assert.deepEqual(body.sessions[0].weak.map((w) => w.question), ['Enterprise pricing?']);
    assert.equal((await fetch(`${base}/improvements?botType=marketing`)).status, 400);
  });

  test('IMPROVEMENT_CONFIDENCE_BELOW moves the threshold', async () => {
    process.env.IMPROVEMENT_CONFIDENCE_BELOW = '0.4';
    try {
      const body = await (await fetch(`${base}/improvements`)).json();
      assert.equal(body.below, 0.4);
      assert.deepEqual(body.sessions[0].weak.map((w) => w.id), ['a1', 'a3', 'a4']);
    } finally {
      delete process.env.IMPROVEMENT_CONFIDENCE_BELOW;
    }
  });
});

describe('notifications', () => {
  let tenant;
  beforeEach(() => {
    tenant = { id: TENANT_ID, teamEmail: null, signupEmail: 'owner@acme.test' };
    prisma.tenant.findUnique = async () => ({ ...tenant });
    prisma.tenant.update = async ({ data }) => Object.assign(tenant, data);
  });
  const patch = (teamEmail) => fetch(`${base}/notifications`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamEmail })
  });

  test('defaults to the signup email; a team address overrides it; empty goes back to the default', async () => {
    assert.deepEqual((await (await fetch(`${base}/notifications`)).json()).recipients, ['owner@acme.test']);
    const set = await (await patch('Sales@Acme.test, ops@acme.test')).json();
    assert.equal(set.teamEmail, 'sales@acme.test, ops@acme.test');
    assert.deepEqual(set.recipients, ['sales@acme.test', 'ops@acme.test']);
    assert.deepEqual((await (await patch('')).json()).recipients, ['owner@acme.test']);
    assert.equal((await patch('nope')).status, 400);
  });

  test('a lead alert goes to exactly the recipients shown here, replying to the visitor', async () => {
    const { notifyLeadCaptured, resetAlertThrottle } = require('../../src/services/teamAlerts');
    const alertTo = async () => {
      sendMailMock.mock.resetCalls();
      resetAlertThrottle();
      const result = await notifyLeadCaptured({
        tenant: { ...tenant, name: 'Acme', slug: 'acme' },
        lead: { id: 'l1', botType: 'sales', email: 'ana@x.com', sessionId: null },
        summary: 'Intent: Wants a quote'
      });
      assert.equal(result.sent, true);
      const mail = sendMailMock.mock.calls[0].arguments[0];
      assert.equal(mail.replyTo, 'ana@x.com');
      assert.equal(mail.subject, 'New Lead Captured from Sales Bot! ana@x.com');
      assert.match(mail.text, /AI summary:\nIntent: Wants a quote/);
      return mail.to;
    };
    const shown = async () => (await (await fetch(`${base}/notifications`)).json()).recipients;

    assert.deepEqual(await alertTo(), await shown()); // the signup email by default
    assert.deepEqual(await alertTo(), ['owner@acme.test']);
    await patch('sales@acme.test, ops@acme.test');
    assert.deepEqual(await alertTo(), await shown());
    assert.deepEqual(await alertTo(), ['sales@acme.test', 'ops@acme.test']);
  });
});

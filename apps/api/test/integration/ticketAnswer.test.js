const { test, describe, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// POST /tickets/:id/answer on the workspace router: the last mile of the
// feedback loop. One open ticket becomes a published knowledge document and the
// ticket is marked 'answered', in a single transaction; afterwards the RAG
// cache is cleared and a readiness re-audit is scheduled.
//
// The two side effects are mocked out here (their own suites cover them), so
// these tests isolate the route's contract: what it writes, what it refuses,
// and that it never touches another tenant's ticket. They must be replaced
// BEFORE the router is required, because the router destructures them at load.
const tenantProfile = require('../../src/domains/tenantProfile');
const invalidateMock = mock.method(tenantProfile, 'invalidateTenantKnowledge', async () => {});
const botAuditor = require('../../src/services/botAuditor');
const auditMock = mock.method(botAuditor, 'scheduleTenantAudit', () => {});

const prisma = require('../../src/lib/prisma');
const workspaceRouter = require('../../src/routes/tenantWorkspace.routes');

const TENANT_ID = 'tenant-t';
let tickets, docs, docCount;

let server, base;
before(async () => {
  prisma.supportTicket.findFirst = async ({ where }) =>
    tickets.find((t) => t.id === where.id && t.tenantId === where.tenantId) || null;
  prisma.tenantDocument.count = async ({ where }) =>
    (where.tenantId === TENANT_ID ? docCount : 0);
  // Callback-form transaction: run the body against an in-memory tx that writes
  // to the same arrays, so document + ticket update commit together here too.
  prisma.$transaction = async (fn) => fn({
    tenantDocument: {
      create: async ({ data }) => {
        const doc = { id: `doc-${docs.length + 1}`, ...data };
        docs.push(doc);
        return doc;
      }
    },
    supportTicket: {
      // Atomic claim: flips to answered only if still open. The read + write are
      // synchronous within one call, so a concurrent caller sees the flipped status
      // and gets count 0 — exactly what the row lock does in Postgres.
      updateMany: async ({ where, data }) => {
        const t = tickets.find((x) => x.id === where.id && x.tenantId === where.tenantId && x.status === where.status);
        if (!t) return { count: 0 };
        Object.assign(t, data);
        return { count: 1 };
      }
    }
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.tenant = { id: TENANT_ID }; req.actor = 'client'; next(); });
  app.use('/', workspaceRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

beforeEach(() => {
  docs = [];
  docCount = 3;
  tickets = [
    { id: 'open-1', tenantId: TENANT_ID, query: 'Do you ship to Canada?', status: 'open' },
    { id: 'done-1', tenantId: TENANT_ID, query: 'Opening hours?', status: 'answered' },
    { id: 'theirs', tenantId: 'someone-else', query: 'Their question', status: 'open' }
  ];
  invalidateMock.mock.resetCalls();
  auditMock.mock.resetCalls();
});

const answer = (id, body) => fetch(`${base}/tickets/${id}/answer`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});

describe('POST /tickets/:id/answer', () => {
  test('publishes the answer as a FAQ document, marks the ticket answered, clears cache and re-audits', async () => {
    const res = await answer('open-1', { answer: 'Yes, we ship across Canada in 3-5 days.' });
    assert.equal(res.status, 201);
    const body = await res.json();

    // The ticket is resolved, in the response and in the row.
    assert.deepEqual(body.ticket, { id: 'open-1', status: 'answered' });
    assert.equal(tickets.find((t) => t.id === 'open-1').status, 'answered');

    // A document was created: question → title, answer → content, FAQ by default.
    assert.equal(docs.length, 1);
    assert.equal(docs[0].title, 'Do you ship to Canada?');
    assert.equal(docs[0].content, 'Yes, we ship across Canada in 3-5 days.');
    assert.equal(docs[0].category, 'FAQ');
    assert.equal(docs[0].tenantId, TENANT_ID);
    assert.equal(body.document.title, 'Do you ship to Canada?');

    // The knowledge-change side effects fired, once each, for this tenant.
    assert.equal(invalidateMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[0], TENANT_ID);
  });

  test('honours a chosen category', async () => {
    const res = await answer('open-1', { answer: 'See our returns policy.', category: 'CUSTOM_POLICY' });
    assert.equal(res.status, 201);
    assert.equal(docs[0].category, 'CUSTOM_POLICY');
  });

  test('an unknown category is rejected and nothing is written', async () => {
    const res = await answer('open-1', { answer: 'x', category: 'NONSENSE' });
    assert.equal(res.status, 400);
    assert.equal(docs.length, 0);
    assert.equal(tickets.find((t) => t.id === 'open-1').status, 'open');
    assert.equal(auditMock.mock.callCount(), 0);
  });

  test('an empty answer is rejected', async () => {
    const res = await answer('open-1', { answer: '   ' });
    assert.equal(res.status, 400);
    assert.equal(docs.length, 0);
  });

  test("another tenant's ticket reads as missing — never answered", async () => {
    const res = await answer('theirs', { answer: 'nope' });
    assert.equal(res.status, 404);
    assert.equal(docs.length, 0);
    assert.equal(tickets.find((t) => t.id === 'theirs').status, 'open');
  });

  test('an already-answered ticket is refused, not duplicated', async () => {
    const res = await answer('done-1', { answer: 'again' });
    assert.equal(res.status, 409);
    assert.equal(docs.length, 0);
  });

  test('concurrent double-submit answers the ticket exactly once — no duplicate document', async () => {
    const [a, b] = await Promise.all([
      answer('open-1', { answer: 'first attempt' }),
      answer('open-1', { answer: 'second attempt' })
    ]);
    // Exactly one wins (201) and the other is refused (409) — never two 201s.
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    assert.equal(docs.length, 1, 'only one FAQ document is created from one ticket');
    assert.equal(tickets.find((t) => t.id === 'open-1').status, 'answered');
    assert.equal(auditMock.mock.callCount(), 1, 'the re-audit is scheduled once, by the winner');
  });

  test('a missing ticket is a 404', async () => {
    const res = await answer('nope', { answer: 'x' });
    assert.equal(res.status, 404);
  });

  test('the document cap is enforced', async () => {
    docCount = 500;
    const res = await answer('open-1', { answer: 'one too many' });
    assert.equal(res.status, 409);
    assert.equal(docs.length, 0);
    assert.equal(tickets.find((t) => t.id === 'open-1').status, 'open');
  });
});

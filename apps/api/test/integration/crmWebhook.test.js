const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Pin a small per-IP limit BEFORE the router is required, so its limiter picks
// it up at import. 5/min keeps the functional tests (each resets the store, ≤2
// posts) comfortably under the cap, while the dedicated test can exceed it fast.
process.env.CRM_WEBHOOK_RATE_LIMIT_MAX = '5';

const prisma = require('../../src/lib/prisma');
const { resetStore } = require('../../src/lib/sharedStore');
const webhookRouter = require('../../src/routes/crmWebhook.routes');

// POST /api/v1/webhooks/zoho: an inbound Zoho status change mirrors onto the
// matching Lead. Prisma's lead table is an in-memory stand-in honouring the
// route's where/orderBy; the CRMSyncLog audit write is stubbed.

const SECRET = 'wh-secret-123';
let server, base, leads, updates;

const matches = (row, where) => Object.entries(where).every(([k, v]) => {
  if (k === 'tenantId' && v === undefined) return true;
  return row[k] === v;
});

before(async () => {
  process.env.ZOHO_WEBHOOK_SECRET = SECRET;
  prisma.lead.findFirst = async ({ where, orderBy }) => {
    let list = leads.filter((r) => matches(r, where));
    if (orderBy?.createdAt === 'desc') list = list.sort((a, b) => b.createdAt - a.createdAt);
    return list[0] || null;
  };
  prisma.lead.update = async ({ where, data }) => { updates.push({ id: where.id, ...data }); return Object.assign(leads.find((l) => l.id === where.id), data); };
  prisma.tenant.findUnique = async ({ where }) => (where.slug === 'acme' ? { id: 't1', slug: 'acme' } : null);
  prisma.cRMSyncLog = { create: async () => ({ id: 'log-1' }) };

  const app = express();
  app.use(express.json());
  app.use('/api/v1/webhooks', webhookRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); delete process.env.ZOHO_WEBHOOK_SECRET; delete process.env.CRM_WEBHOOK_RATE_LIMIT_MAX; });

beforeEach(() => {
  resetStore(); // fresh rate-limit window per test, so they don't share a budget
  updates = [];
  leads = [
    { id: 'lead-1', tenantId: 't1', email: 'ana@x.com', crmProvider: 'ZOHO', crmRecordId: 'z-1', status: 'NEW', createdAt: new Date(2) },
    { id: 'lead-2', tenantId: 't1', email: 'ana@x.com', crmProvider: null, crmRecordId: null, status: 'NEW', createdAt: new Date(5) }
  ];
});

const post = (body, { token = SECRET, header = true, qs = '' } = {}) => fetch(`${base}/api/v1/webhooks/zoho${qs}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(header && token ? { 'x-zoho-webhook-token': token } : {}) },
  body: JSON.stringify(body)
});

describe('POST /webhooks/zoho', () => {
  test('a valid status change updates the matching lead by CRM id', async () => {
    const res = await post({ id: 'z-1', Lead_Status: 'Converted', tenant: 'acme' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.updated, true);
    assert.equal(body.status, 'CONTACTED');
    assert.deepEqual(updates, [{ id: 'lead-1', status: 'CONTACTED' }]);
  });

  test('accepts the token as a query parameter too', async () => {
    const res = await post({ id: 'z-1', status: 'Contacted' }, { header: false, qs: `?token=${SECRET}` });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).updated, true);
  });

  test('a wrong token is rejected with 401 and changes nothing', async () => {
    const res = await post({ id: 'z-1', status: 'Converted' }, { token: 'nope' });
    assert.equal(res.status, 401);
    assert.equal(updates.length, 0);
  });

  test('an unmapped status is acknowledged without changing the lead', async () => {
    const res = await post({ id: 'z-1', status: 'Some Pipeline Stage' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.updated, false);
    assert.equal(body.reason, 'unmapped-status');
    assert.equal(updates.length, 0);
  });

  test('missing identifiers or status are acknowledged, not errored', async () => {
    assert.equal((await (await post({ status: 'Contacted' })).json()).reason, 'no-record-identifier');
    assert.equal((await (await post({ id: 'z-1' })).json()).reason, 'no-status');
  });

  test('without ZOHO_WEBHOOK_SECRET configured the endpoint refuses (503)', async () => {
    delete process.env.ZOHO_WEBHOOK_SECRET;
    const res = await post({ id: 'z-1', status: 'Converted' }, { token: null });
    assert.equal(res.status, 503);
    process.env.ZOHO_WEBHOOK_SECRET = SECRET;
  });

  test('rate-limits high-frequency requests per IP, throttling token brute-force before the secret check', async () => {
    const codes = [];
    // All wrong-token attempts: the limiter must cut them off regardless of the
    // (failing) secret check, so brute-forcing the token is bounded.
    for (let i = 0; i < 7; i++) {
      const res = await post({ id: 'z-1', status: 'Converted' }, { token: 'nope' });
      codes.push(res.status);
    }
    assert.ok(codes.filter((c) => c === 401).length <= 5, 'at most MAX attempts reach the secret check');
    assert.ok(codes.includes(429), 'the limiter returns 429 once the per-IP window is exceeded');
    assert.equal(updates.length, 0, 'nothing is ever mutated on throttled/invalid requests');
  });
});

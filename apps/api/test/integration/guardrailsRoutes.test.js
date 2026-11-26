const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// GET/PATCH /guardrails over HTTP, mounted on the workspace router exactly as in
// production (req.tenant + req.actor supplied by the auth middleware). Prisma's
// tenantGuardrails delegate is an in-memory store: one row per tenant, honouring
// the `select` the service asks for. Enforcement is not wired yet — this covers
// the scaffold's read / validate / upsert contract only.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-guardrails-routes';

const prisma = require('../../src/lib/prisma');
const { defaults } = require('../../src/services/guardrails');
const workspace = require('../../src/routes/tenantWorkspace.routes');

let rows, server, base;
const pick = (obj, select) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, obj[k]])) : obj);
const get = () => fetch(`${base}/guardrails`);
const patch = (body) => fetch(`${base}/guardrails`, {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});
const json = async (res) => ({ status: res.status, body: await res.json() });

before(async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { req.tenant = { id: 't1' }; req.actor = 'client'; next(); }, workspace);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

beforeEach(() => {
  rows = new Map();
  prisma.tenantGuardrails.findUnique = async ({ where, select }) => {
    const row = rows.get(where.tenantId);
    return row ? pick(row, select) : null;
  };
  prisma.tenantGuardrails.upsert = async ({ where, create, update, select }) => {
    const existing = rows.get(where.tenantId);
    const row = existing ? { ...existing, ...update } : { ...defaults(), ...create };
    rows.set(where.tenantId, row);
    return pick(row, select);
  };
});

describe('GET /guardrails', () => {
  test('a tenant with no saved row reads as platform defaults', async () => {
    const { status, body } = await json(await get());
    assert.equal(status, 200);
    assert.deepEqual(body, defaults());
  });

  test('reflects what was saved', async () => {
    rows.set('t1', { ...defaults(), maxMessages: 10, windowSeconds: 60, imagesEnabled: false });
    const { body } = await json(await get());
    assert.equal(body.maxMessages, 10);
    assert.equal(body.windowSeconds, 60);
    assert.equal(body.imagesEnabled, false);
  });
});

describe('PATCH /guardrails', () => {
  test('validates, upserts, and echoes the full config', async () => {
    const { status, body } = await json(await patch({
      maxMessages: 20, windowSeconds: 60, limitMessage: '  slow down  ',
      spamCheckEnabled: true, blockedCountries: ['ru', 'RU', 'cn'], imagesEnabled: false
    }));
    assert.equal(status, 200);
    assert.equal(body.maxMessages, 20);
    assert.equal(body.windowSeconds, 60);
    assert.equal(body.limitMessage, 'slow down');
    assert.equal(body.spamCheckEnabled, true);
    assert.deepEqual(body.blockedCountries, ['RU', 'CN']);
    assert.equal(body.imagesEnabled, false);
    // persisted — a follow-up GET sees it
    assert.equal((await json(await get())).body.maxMessages, 20);
  });

  test('a partial update leaves the other saved fields untouched', async () => {
    await patch({ maxMessages: 5, windowSeconds: 30 });
    const { body } = await json(await patch({ imagesEnabled: false }));
    assert.equal(body.maxMessages, 5);
    assert.equal(body.windowSeconds, 30);
    assert.equal(body.imagesEnabled, false);
  });

  test('rejects invalid input with 400 and saves nothing', async () => {
    assert.equal((await patch({ maxMessages: 0 })).status, 400);
    assert.equal((await patch({ windowSeconds: 99999 })).status, 400);
    assert.equal((await patch({ blockedCountries: ['USA'] })).status, 400);
    assert.equal((await patch({ spamCheckEnabled: 'yes' })).status, 400);
    assert.equal((await patch({})).status, 400);
    assert.equal(rows.size, 0, 'no row was created by any rejected request');
  });
});

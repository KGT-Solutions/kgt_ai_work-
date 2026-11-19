const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const prisma = require('../../src/lib/prisma');
const workspaceRouter = require('../../src/routes/tenantWorkspace.routes');

// PATCH /api-keys/:keyId — the dashboard sets the websites allowed to use a
// widget key (review #2). Keys are an in-memory stand-in.

const TENANT = { id: 't-a', slug: 'acme', name: 'Acme', active: true };
let keys;
let server;
let base;

before(async () => {
  prisma.tenantApiKey.findFirst = async ({ where }) => keys.find((k) => k.id === where.id && k.tenantId === where.tenantId) || null;
  prisma.tenantApiKey.update = async ({ where, data, select }) => {
    const k = Object.assign(keys.find((x) => x.id === where.id), data);
    return Object.fromEntries(Object.keys(select).map((f) => [f, k[f]]));
  };
  prisma.tenantApiKey.findMany = async ({ where, select }) => keys.filter((k) => k.tenantId === where.tenantId)
    .map((k) => Object.fromEntries(Object.keys(select).map((f) => [f, k[f]])));
  const app = express();
  app.use(express.json());
  app.use('/ws', (req, _res, next) => { req.tenant = TENANT; req.actor = 'client'; next(); }, workspaceRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  keys = [
    { id: 'k1', tenantId: 't-a', keyHash: 'h1', keyPrefix: 'tk_aaaa', label: 'Site', createdAt: new Date(), lastUsedAt: null, revokedAt: null, allowedOrigins: [] },
    { id: 'k2', tenantId: 't-a', keyHash: 'h2', keyPrefix: 'tk_bbbb', label: 'Old', createdAt: new Date(), lastUsedAt: null, revokedAt: new Date(), allowedOrigins: [] },
    { id: 'k3', tenantId: 't-other', keyHash: 'h3', keyPrefix: 'tk_cccc', label: 'Theirs', createdAt: new Date(), lastUsedAt: null, revokedAt: null, allowedOrigins: [] }
  ];
});

const patch = (id, body) => fetch(`${base}/ws/api-keys/${id}`, {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});

describe('PATCH /api-keys/:keyId (allowed websites)', () => {
  test('stores normalised, de-duplicated origins and returns the public fields only', async () => {
    const res = await patch('k1', { allowedOrigins: ['https://WWW.Acme.com/pricing', 'https://www.acme.com', 'http://localhost:3000'] });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.allowedOrigins, ['https://www.acme.com', 'http://localhost:3000']);
    assert.equal(body.keyHash, undefined, 'the hash is never returned');
    assert.deepEqual(keys[0].allowedOrigins, ['https://www.acme.com', 'http://localhost:3000']);
  });

  test('an empty list re-opens the key to any website', async () => {
    keys[0].allowedOrigins = ['https://www.acme.com'];
    assert.equal((await patch('k1', { allowedOrigins: [] })).status, 200);
    assert.deepEqual(keys[0].allowedOrigins, []);
  });

  test('invalid input is a 400 naming the bad entry, and nothing is saved', async () => {
    for (const body of [{}, { allowedOrigins: 'https://a.com' }, { allowedOrigins: ['https://a.com', 'javascript:alert(1)'] }]) {
      assert.equal((await patch('k1', body)).status, 400, JSON.stringify(body));
    }
    assert.deepEqual(keys[0].allowedOrigins, []);
  });

  test('another tenant\'s key is a 404; a revoked key is a 409', async () => {
    assert.equal((await patch('k3', { allowedOrigins: ['https://a.com'] })).status, 404);
    assert.deepEqual(keys[2].allowedOrigins, []);
    assert.equal((await patch('k2', { allowedOrigins: ['https://a.com'] })).status, 409);
  });

  test('the key list includes each key\'s allowed websites', async () => {
    keys[0].allowedOrigins = ['https://www.acme.com'];
    const list = await (await fetch(`${base}/ws/api-keys`)).json();
    assert.deepEqual(list.find((k) => k.id === 'k1').allowedOrigins, ['https://www.acme.com']);
  });
});

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Phase D — widget install telemetry.
//   POST /api/v1/tenant-chat/:slug/ping   (public widget router) stamps
//     widgetSeenAt / widgetUrl on the key it authenticated with.
//   GET  /install-status                  (workspace router) reports whether the
//     widget has loaded yet, for the dashboard poll.
// prisma is an in-memory stand-in; the real auth (slug + X-Tenant-Api-Key hash)
// and the throttle/sanitize logic run unchanged.

const prisma = require('../../src/lib/prisma');
const { hashApiKey } = require('../../src/utils/tenantApiKeys');
const chatRouter = require('../../src/routes/tenantChat.routes');
const workspaceRouter = require('../../src/routes/tenantWorkspace.routes');

const TENANT = { id: 'tenant-w', slug: 'acme', active: true };
const PLAINTEXT = `tk_${'a'.repeat(48)}`;
let keys;

const waitFor = async (cond, { tries = 100, ms = 10 } = {}) => {
  for (let i = 0; i < tries; i++) { if (await cond()) return; await new Promise((r) => setTimeout(r, ms)); }
  throw new Error('waitFor: condition not met in time');
};

let server, base;
before(async () => {
  prisma.tenant.findUnique = async ({ where }) => (where.slug === TENANT.slug ? { ...TENANT } : null);
  prisma.tenantApiKey.findUnique = async ({ where }) => keys.find((k) => k.keyHash === where.keyHash) || null;
  prisma.tenantApiKey.update = async ({ where, data }) => Object.assign(keys.find((k) => k.id === where.id), data);
  prisma.tenantApiKey.findFirst = async ({ where }) => {
    let list = keys.filter((k) => k.tenantId === where.tenantId);
    if (where.revokedAt === null) list = list.filter((k) => !k.revokedAt);
    if (where.widgetSeenAt && where.widgetSeenAt.not === null) list = list.filter((k) => k.widgetSeenAt);
    return list.sort((a, b) => (b.widgetSeenAt || 0) - (a.widgetSeenAt || 0))[0] || null;
  };

  const app = express();
  app.use(express.json());
  app.use('/tenant-chat', chatRouter);
  app.use('/ws', (req, _res, next) => { req.tenant = { id: TENANT.id }; req.actor = 'client'; next(); }, workspaceRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

beforeEach(() => {
  keys = [{
    id: 'key-1', tenantId: TENANT.id, keyHash: hashApiKey(PLAINTEXT), keyPrefix: PLAINTEXT.slice(0, 9),
    label: 'Website widget', revokedAt: null, lastUsedAt: null, widgetSeenAt: null, widgetUrl: null
  }];
});

const ping = (body, headers = {}) => fetch(`${base}/tenant-chat/${TENANT.slug}/ping`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-tenant-api-key': PLAINTEXT, ...headers },
  body: JSON.stringify(body || {})
});
const installStatus = async () => (await fetch(`${base}/ws/install-status`)).json();

describe('POST /tenant-chat/:slug/ping', () => {
  test('a valid key stamps widgetSeenAt and the sanitized page URL', async () => {
    const res = await ping({ url: 'https://shop.acme.com/pricing?token=secret#top' });
    assert.equal(res.status, 204);
    await waitFor(() => keys[0].widgetSeenAt !== null); // the write is fire-and-forget
    assert.ok(keys[0].widgetSeenAt instanceof Date);
    assert.equal(keys[0].widgetUrl, 'https://shop.acme.com/pricing'); // query/hash dropped
  });

  test('falls back to the Referer when the body carries no url', async () => {
    const res = await ping({}, { Referer: 'https://acme.test/contact?x=1' });
    assert.equal(res.status, 204);
    await waitFor(() => keys[0].widgetSeenAt !== null);
    assert.equal(keys[0].widgetUrl, 'https://acme.test/contact');
  });

  test('an invalid key is rejected (401) and nothing is stamped', async () => {
    const res = await fetch(`${base}/tenant-chat/${TENANT.slug}/ping`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant-api-key': 'tk_wrong' }, body: '{}'
    });
    assert.equal(res.status, 401);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(keys[0].widgetSeenAt, null);
  });

  test('an unknown tenant slug is rejected with the same 401 as a bad key (no slug probing)', async () => {
    const res = await fetch(`${base}/tenant-chat/nope/ping`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant-api-key': PLAINTEXT }, body: '{}'
    });
    // The chat middleware answers unknown-slug, inactive-tenant and bad-key
    // identically (401), so the response never reveals which slugs exist.
    assert.equal(res.status, 401);
  });

  test('the write is throttled: a recent widgetSeenAt is not overwritten', async () => {
    keys[0].widgetSeenAt = new Date(Date.now() - 60 * 1000); // seen a minute ago
    keys[0].widgetUrl = 'https://acme.test/first';
    const res = await ping({ url: 'https://acme.test/second' });
    assert.equal(res.status, 204);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(keys[0].widgetUrl, 'https://acme.test/first', 'throttled — the earlier page is kept');
  });
});

describe('GET /install-status', () => {
  test('reports not installed before any ping', async () => {
    assert.deepEqual(await installStatus(), { installed: false, seenAt: null, url: null, keyPrefix: null });
  });

  test('reports installed with the page and prefix once the widget has pinged', async () => {
    await ping({ url: 'https://shop.acme.com/' });
    await waitFor(() => keys[0].widgetSeenAt !== null);
    const status = await installStatus();
    assert.equal(status.installed, true);
    assert.equal(status.url, 'https://shop.acme.com/');
    assert.equal(status.keyPrefix, PLAINTEXT.slice(0, 9));
    assert.ok(status.seenAt);
  });

  test("another tenant's seen key never counts as this tenant's install", async () => {
    keys.push({ id: 'key-2', tenantId: 'someone-else', keyHash: 'x', keyPrefix: 'tk_other', revokedAt: null, widgetSeenAt: new Date() });
    assert.equal((await installStatus()).installed, false);
  });

  test('a revoked key that was once seen does not count as installed', async () => {
    keys[0].widgetSeenAt = new Date();
    keys[0].revokedAt = new Date();
    assert.equal((await installStatus()).installed, false);
  });
});

const { test, describe, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const dns = require('dns').promises;

const prisma = require('../../src/lib/prisma');
const { resetStore } = require('../../src/lib/sharedStore');
const workspaceRouter = require('../../src/routes/tenantWorkspace.routes');
const tenantChatRouter = require('../../src/routes/tenantChat.routes');
const { hashApiKey } = require('../../src/utils/tenantApiKeys');
const branding = require('../../src/services/branding');

// Theme Studio over HTTP: the dashboard's /branding endpoints (scoped to
// req.tenant) and the widget's public GET /tenant-chat/:slug/theme behind the
// tenant API key. TenantBranding is an in-memory stand-in; the website scan
// runs through the real crawler with DNS and outbound fetch mocked.

const TENANT = { id: 'tenant-brand', slug: 'acme-foods', name: 'Acme Foods', active: true };
const API_KEY = `tk_${'a'.repeat(48)}`;
const realFetch = globalThis.fetch;
let row, server, base;

const HOME = `<html><head><meta name="theme-color" content="#0d9488"></head>
  <body><header><img class="logo" src="/logo.svg" alt="Acme"></header><main><p>Snacks</p></main></body></html>`;

const realTx = { tx: prisma.$transaction, raw: prisma.$executeRaw };
let assetRows = new Map();
before(async () => {
  prisma.$transaction = async (fn) => fn(prisma); // the in-memory doubles stand in for the transaction client
  prisma.$executeRaw = async () => 0; // the branding row lock
  prisma.tenantLogoAsset = {
    findFirst: async ({ where }) => [...assetRows.values()].find((a) => where.OR.some((c) => a.key === c.key || (c.reversedKey && a.reversedKey === c.reversedKey))) || null,
    findUnique: async ({ where }) => assetRows.get(where.tenantId_key.key) || null,
    upsert: async ({ where, create }) => { if (!assetRows.has(where.tenantId_key.key)) assetRows.set(where.tenantId_key.key, create); return assetRows.get(where.tenantId_key.key); },
    deleteMany: async ({ where }) => {
      let count = 0;
      for (const k of [...assetRows.keys()]) if (!where.key || k !== where.key.not) { assetRows.delete(k); count += 1; }
      return { count };
    }
  };
  prisma.tenantBranding = {
    findUnique: async ({ where }) => (where.tenantId === TENANT.id ? row : null),
    upsert: async ({ create, update }) => { row = row ? { ...row, ...update } : { id: 'b1', ...create }; return row; },
    update: async ({ data }) => { row = { ...row, ...data }; return row; }
  };
  prisma.tenantConsent = { findFirst: async () => ({ domain: 'acme.test' }) };
  prisma.tenant.findUnique = async ({ where }) => (where.slug === TENANT.slug ? TENANT : null);
  prisma.tenantApiKey.findUnique = async ({ where }) =>
    (where.keyHash === hashApiKey(API_KEY) ? { id: 'k1', tenantId: TENANT.id, revokedAt: null, lastUsedAt: new Date() } : null);

  const app = express();
  app.use(express.json());
  app.use('/ws', (req, _res, next) => { req.tenant = TENANT; req.actor = 'client'; next(); }, workspaceRouter);
  app.use('/api/v1/tenant-chat', tenantChatRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); prisma.$transaction = realTx.tx; prisma.$executeRaw = realTx.raw; });
// The theme cache is per process; resetting the store restarts the generation
// counters, so a cached entry could otherwise match a fresh counter by chance.
beforeEach(() => { row = null; assetRows = new Map(); resetStore(); branding.clearThemeCache(); });
afterEach(() => mock.restoreAll());

const call = (path, { method = 'GET', body, headers = {} } = {}) => fetch(`${base}${path}`, {
  method,
  headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
  body: body !== undefined ? JSON.stringify(body) : undefined
});

describe('GET /branding', () => {
  test('creates a neutral kit with three designs, applies none, and suggests the signup site', async () => {
    const res = await call('/ws/branding');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.themes.map((t) => t.id), ['minimal', 'vibrant', 'corporate']);
    assert.equal(body.selectedThemeId, null);
    assert.equal(body.sourceUrl, 'https://acme.test');
  });
});

describe('POST /branding/select', () => {
  test('requires an explicit themeId, rejects unknown ids, and applies a valid one', async () => {
    assert.equal((await call('/ws/branding/select', { method: 'POST', body: {} })).status, 400);
    assert.equal((await call('/ws/branding/select', { method: 'POST', body: { themeId: 'neon' } })).status, 400);
    const res = await call('/ws/branding/select', { method: 'POST', body: { themeId: 'vibrant' } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).selectedThemeId, 'vibrant');
    const back = await call('/ws/branding/select', { method: 'POST', body: { themeId: null } });
    assert.equal((await back.json()).selectedThemeId, null);
  });
});

describe('PATCH /branding', () => {
  test('rejects a malformed colour and saves a valid colour + logo', async () => {
    mock.method(dns, 'lookup', async () => { throw new Error('ENOTFOUND'); }); // logo analysis: fail fast, offline
    assert.equal((await call('/ws/branding', { method: 'PATCH', body: { primaryColor: 'teal' } })).status, 400);
    const res = await call('/ws/branding', { method: 'PATCH', body: { primaryColor: '#7c3aed', logoUrl: 'https://cdn.acme.test/logo.svg' } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.primaryColor, '#7c3aed');
    assert.equal(body.logoUrl, 'https://cdn.acme.test/logo.svg');
  });
});

describe('POST /branding/scan', () => {
  test('needs a url', async () => {
    assert.equal((await call('/ws/branding/scan', { method: 'POST', body: {} })).status, 400);
  });

  test("reads the site's logo and theme colour and regenerates the designs", async () => {
    mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
    mock.method(globalThis, 'fetch', async (url, opts) => (String(url).startsWith(base)
      ? realFetch(url, opts)
      : new Response(HOME, { status: 200, headers: { 'content-type': 'text/html' } })));
    const res = await call('/ws/branding/scan', { method: 'POST', body: { url: 'https://acme.test' } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.found, { logo: true, colors: true });
    assert.equal(body.logoUrl, 'https://acme.test/logo.svg');
    assert.equal(body.primaryColor, '#0d9488');
    assert.equal(body.source, 'website');
  });

  test('an unsafe address is refused with a 4xx, not a 500', async () => {
    mock.method(dns, 'lookup', async () => [{ address: '169.254.169.254', family: 4 }]);
    const res = await call('/ws/branding/scan', { method: 'POST', body: { url: 'http://metadata.acme.test' } });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /non-public address/);
  });
});

describe('GET /tenant-chat/:slug/theme (the widget)', () => {
  const key = { 'x-tenant-api-key': API_KEY };

  test('requires the tenant API key', async () => {
    assert.equal((await call('/api/v1/tenant-chat/acme-foods/theme')).status, 401);
  });

  test('serves the classic look until a design is applied, then that design and the logo', async () => {
    mock.method(dns, 'lookup', async () => { throw new Error('ENOTFOUND'); }); // logo analysis: fail fast, offline
    let res = await call('/api/v1/tenant-chat/acme-foods/theme', { headers: key });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control'), /private/);
    assert.equal((await res.json()).theme, null);

    await call('/ws/branding', { method: 'PATCH', body: { logoUrl: 'https://cdn.acme.test/logo.svg', primaryColor: '#7c3aed' } });
    await call('/ws/branding/select', { method: 'POST', body: { themeId: 'corporate' } });

    res = await call('/api/v1/tenant-chat/acme-foods/theme', { headers: key });
    const body = await res.json();
    assert.equal(body.theme.id, 'corporate');
    assert.equal(body.theme.headerStyle, 'solid');
    assert.equal(body.logoUrl, 'https://cdn.acme.test/logo.svg');
    assert.equal(body.companyName, 'Acme Foods');
  });
});

describe('bot display name over HTTP', () => {
  const key = { 'x-tenant-api-key': API_KEY };

  test('PATCH saves it, GET returns it, and an over-long name is a 400', async () => {
    assert.equal((await call('/ws/branding', { method: 'PATCH', body: { botName: 'x'.repeat(41) } })).status, 400);
    const res = await call('/ws/branding', { method: 'PATCH', body: { botName: 'Sales Expert' } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).botName, 'Sales Expert');
    assert.equal((await (await call('/ws/branding')).json()).botName, 'Sales Expert');
  });

  test('the widget receives the name with or without a design applied', async () => {
    await call('/ws/branding', { method: 'PATCH', body: { botName: 'Aria' } });
    let body = await (await call('/api/v1/tenant-chat/acme-foods/theme', { headers: key })).json();
    assert.equal(body.botName, 'Aria');
    assert.equal(body.theme, null);

    await call('/ws/branding/select', { method: 'POST', body: { themeId: 'vibrant' } });
    body = await (await call('/api/v1/tenant-chat/acme-foods/theme', { headers: key })).json();
    assert.equal(body.botName, 'Aria');
    assert.equal(body.theme.id, 'vibrant');
    assert.ok(['plain', 'pill', 'tile'].includes(body.theme.logoBadge.mode));

    await call('/ws/branding', { method: 'PATCH', body: { botName: null } });
    body = await (await call('/api/v1/tenant-chat/acme-foods/theme', { headers: key })).json();
    assert.equal(body.botName, null);
  });
});

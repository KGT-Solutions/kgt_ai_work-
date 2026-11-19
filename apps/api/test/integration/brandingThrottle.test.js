const { test, describe, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const dns = require('dns');

const prisma = require('../../src/lib/prisma');
const { resetStore } = require('../../src/lib/sharedStore');
const workspaceRouter = require('../../src/routes/tenantWorkspace.routes');
const branding = require('../../src/services/branding');

// Logo URL ingestion throttling (adversarial review, Major). A pasted logo URL
// makes the server download and decode that image; unthrottled, pasting URLs
// in a loop burned CPU and pointed our servers at third-party hosts. It now
// draws on the per-tenant brand-scan budget (6/hour), and a URL that couldn't
// be cleaned isn't fetched again at the same pipeline version.

const TENANT = { id: 'tenant-throttle', slug: 'acme-t', name: 'Acme', active: true };
let row;
let server;
let base;
let lookups;
const real = {};

before(async () => {
  real.tx = prisma.$transaction; real.raw = prisma.$executeRaw;
  real.branding = prisma.tenantBranding; real.asset = prisma.tenantLogoAsset; real.consent = prisma.tenantConsent;
  prisma.$transaction = async (fn) => fn(prisma);
  prisma.$executeRaw = async () => 0;
  prisma.tenantBranding = {
    findUnique: async () => row,
    upsert: async ({ create, update }) => { row = row ? { ...row, ...update } : { id: 'b1', ...create }; return row; },
    update: async ({ data }) => { row = { ...row, ...data }; return row; }
  };
  prisma.tenantLogoAsset = { deleteMany: async () => ({ count: 0 }), upsert: async ({ create }) => create, findUnique: async () => null, findFirst: async () => null };
  prisma.tenantConsent = { findFirst: async () => null };
  const app = express();
  app.use(express.json());
  app.use('/ws', (req, _res, next) => { req.tenant = TENANT; req.actor = 'client'; next(); }, workspaceRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  Object.assign(prisma, { $transaction: real.tx, $executeRaw: real.raw, tenantBranding: real.branding, tenantLogoAsset: real.asset, tenantConsent: real.consent });
});
beforeEach(() => {
  row = null;
  lookups = 0;
  resetStore();
  branding.clearThemeCache();
  // Every outbound logo fetch starts with a DNS lookup (fetchSafe's SSRF guard):
  // counting them counts downloads, and failing them keeps the test offline.
  mock.method(dns.promises, 'lookup', async () => { lookups += 1; throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); });
});
afterEach(() => mock.restoreAll());

const patch = (body) => fetch(`${base}/ws/branding`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('PATCH /branding with a logo URL shares the brand-scan budget', () => {
  test('six logo URLs an hour, then 429 — before anything is downloaded', async () => {
    for (let i = 0; i < 6; i++) assert.equal((await patch({ logoUrl: `https://cdn${i}.acme.test/logo.png` })).status, 200, `paste ${i + 1}`);
    const before = lookups;
    const limited = await patch({ logoUrl: 'https://cdn9.acme.test/logo.png' });
    assert.equal(limited.status, 429);
    assert.match((await limited.json()).error, /Too many logo or website lookups/);
    assert.equal(lookups, before, 'the refused request fetched nothing');
  });

  test('colour or name saves, and clearing the logo, are never throttled', async () => {
    for (let i = 0; i < 6; i++) await patch({ logoUrl: `https://cdn${i}.acme.test/logo.png` });
    assert.equal((await patch({ primaryColor: '#0d9488' })).status, 200);
    assert.equal((await patch({ botName: 'Aria' })).status, 200);
    assert.equal((await patch({ logoUrl: '' })).status, 200);
  });

  test('a URL that couldn\'t be fetched is not re-fetched by later colour saves', async () => {
    assert.equal((await patch({ logoUrl: 'https://blocked.acme.test/logo.png' })).status, 200);
    const afterPaste = lookups;
    assert.ok(afterPaste >= 1, 'the paste tried to fetch it');
    for (const c of ['#0d9488', '#1d4ed8', '#be123c', '#7c3aed']) assert.equal((await patch({ primaryColor: c })).status, 200);
    assert.equal(lookups, afterPaste, 'four colour saves, zero further downloads');
  });
});

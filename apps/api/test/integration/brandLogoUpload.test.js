const { test, describe, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const sharp = require('sharp');

const prisma = require('../../src/lib/prisma');
const { resetStore } = require('../../src/lib/sharedStore');
const workspaceRouter = require('../../src/routes/tenantWorkspace.routes');
const tenantChatRouter = require('../../src/routes/tenantChat.routes');
const brandAssetRouter = require('../../src/routes/brandAssets.routes');
const { hashApiKey } = require('../../src/utils/tenantApiKeys');
const branding = require('../../src/services/branding');

// Custom logo upload in the Theme Studio, end to end over HTTP: upload →
// stored re-encoded → served publicly → the widget's theme points at it;
// "Remove logo" → the widget falls back to the initial. TenantBranding and
// TenantLogoAsset are in-memory stand-ins.

const TENANT = { id: 'tenant-logo', slug: 'acme-logo', name: 'Acme Logo', active: true };
const API_KEY = `tk_${'l'.repeat(48)}`;
let row;
// Content-keyed image rows, as in Postgres: (tenantId, key) → row.
let assets;
let server;
let base;
const real = {};
const liveAsset = () => (row?.customLogoKey && assets.get(row.customLogoKey)) || null;
const pick = (a, select) => (a ? (select ? Object.fromEntries(Object.keys(select).map((f) => [f, a[f]])) : a) : null);

before(async () => {
  real.tx = prisma.$transaction;
  real.raw = prisma.$executeRaw;
  prisma.$transaction = async (fn) => fn(prisma); // the in-memory doubles below stand in for the transaction client
  prisma.$executeRaw = async () => 0; // the row lock
  prisma.tenantBranding = {
    findUnique: async ({ where }) => (where.tenantId === TENANT.id ? row : null),
    upsert: async ({ create, update }) => { row = row ? { ...row, ...update } : { id: 'b1', ...create }; return row; },
    update: async ({ data }) => { row = { ...row, ...data }; return row; }
  };
  prisma.tenantLogoAsset = {
    findFirst: async ({ where, select }) => pick([...assets.values()].find((a) => a.tenantId === where.tenantId &&
      where.OR.some((c) => (c.key !== undefined && a.key === c.key) || (c.reversedKey !== undefined && a.reversedKey === c.reversedKey))), select),
    findUnique: async ({ where, select }) => {
      const a = assets.get(where.tenantId_key.key);
      return a && a.tenantId === where.tenantId_key.tenantId ? pick(a, select) : null;
    },
    upsert: async ({ where, create }) => {
      if (!assets.has(where.tenantId_key.key)) assets.set(where.tenantId_key.key, { ...create });
      return assets.get(where.tenantId_key.key);
    },
    deleteMany: async ({ where }) => {
      let count = 0;
      for (const [k, a] of assets) if (a.tenantId === where.tenantId && (!where.key || k !== where.key.not)) { assets.delete(k); count += 1; }
      return { count };
    }
  };
  prisma.tenantConsent = { findFirst: async () => null };
  prisma.tenant.findUnique = async ({ where }) => (where.slug === TENANT.slug ? TENANT : null);
  prisma.tenantApiKey.findUnique = async ({ where }) =>
    (where.keyHash === hashApiKey(API_KEY) ? { id: 'k1', tenantId: TENANT.id, revokedAt: null, lastUsedAt: new Date(), allowedOrigins: [] } : null);

  const app = express();
  app.use(express.json());
  app.use('/ws', (req, _res, next) => { req.tenant = TENANT; req.actor = 'client'; next(); }, workspaceRouter);
  app.use('/api/v1/tenant-chat', tenantChatRouter);
  app.use('/api/v1/public/brand-assets', brandAssetRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); prisma.$transaction = real.tx; prisma.$executeRaw = real.raw; });
beforeEach(() => { row = null; assets = new Map(); resetStore(); branding.clearThemeCache(); brandAssetRouter.clearCache(); });
afterEach(() => mock.restoreAll());

const png = (w = 120, h = 60, color = { r: 13, g: 148, b: 136, alpha: 1 }) =>
  sharp({ create: { width: w, height: h, channels: 4, background: color } }).png().toBuffer();

function upload(buffer, { type = 'image/png', name = 'logo.png', field = 'logo' } = {}) {
  const form = new FormData();
  form.append(field, new Blob([buffer], { type }), name);
  return fetch(`${base}/ws/branding/logo`, { method: 'POST', body: form });
}
const json = (path, { method = 'GET', body } = {}) => fetch(`${base}${path}`, {
  method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined
});
const widgetTheme = async () => (await fetch(`${base}/api/v1/tenant-chat/${TENANT.slug}/theme`, { headers: { 'x-tenant-api-key': API_KEY } })).json();

describe('POST /branding/logo', () => {
  test('stores the re-encoded image and makes it the logo, served at a public, immutable URL', async () => {
    const res = await upload(await png());
    assert.equal(res.status, 200);
    const view = await res.json();
    assert.equal(view.logoSource, 'upload');
    assert.match(view.logoUrl, /^\/api\/v1\/public\/brand-assets\/logo\/tenant-logo\/[0-9a-f]{24}\.png$/);
    assert.equal(row.customLogoKey, liveAsset().key);
    assert.ok(view.logoAppearance, 'the upload was analysed so the designs seat it');

    const img = await fetch(`${base}${view.logoUrl}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(img.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.match(img.headers.get('cache-control'), /immutable/);
    assert.match(img.headers.get('content-security-policy'), /default-src 'none'/);
    const served = Buffer.from(await img.arrayBuffer());
    assert.deepEqual((await sharp(served).metadata()).width, 120);
  });

  test('the widget theme points at the uploaded logo once a design is applied', async () => {
    const view = await (await upload(await png())).json();
    await json('/ws/branding/select', { method: 'POST', body: { themeId: 'minimal' } });
    const theme = await widgetTheme();
    assert.equal(theme.logoUrl, view.logoUrl);
    assert.ok(theme.theme.logoBadge, 'the design carries a badge chosen for this logo');
  });

  test('a new upload is a new URL, and the old URL stops resolving', async () => {
    const first = await (await upload(await png())).json();
    const second = await (await upload(await png(80, 80, { r: 200, g: 30, b: 30, alpha: 1 }))).json();
    assert.notEqual(first.logoUrl, second.logoUrl);
    assert.equal((await fetch(`${base}${first.logoUrl}`)).status, 404);
    assert.equal((await fetch(`${base}${second.logoUrl}`)).status, 200);
  });

  test('wrong declared type is 400; an SVG disguised as PNG is 400; over 2 MB is 413; no file is 400', async () => {
    assert.equal((await upload(Buffer.from('<svg/>'), { type: 'image/svg+xml', name: 'logo.svg' })).status, 400);
    const disguised = await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    assert.equal(disguised.status, 400);
    assert.match((await disguised.json()).error, /PNG, JPEG or WebP/);
    assert.equal((await upload(Buffer.alloc(2 * 1024 * 1024 + 10, 1))).status, 413);
    assert.equal((await fetch(`${base}/ws/branding/logo`, { method: 'POST', body: new FormData() })).status, 400);
    assert.equal((await upload(await png(), { field: 'file' })).status, 400, 'wrong field name');
    assert.equal(assets.size, 0, 'nothing was stored');
  });

  test('a rescan or colour change keeps the uploaded logo; a pasted URL replaces it', async () => {
    const view = await (await upload(await png())).json();
    const colour = await (await json('/ws/branding', { method: 'PATCH', body: { primaryColor: '#7c3aed' } })).json();
    assert.equal(colour.logoUrl, view.logoUrl, 'a colour-only edit leaves the logo');
    mock.method(branding, 'getLogoAsset'); // no-op spy; the route uses the module export
    const linked = await (await json('/ws/branding', { method: 'PATCH', body: { logoUrl: 'https://cdn.acme.test/logo.png' } })).json();
    assert.equal(linked.logoSource, 'link');
    assert.equal(linked.logoUrl, 'https://cdn.acme.test/logo.png');
    assert.equal(assets.size, 0, 'the replaced upload is deleted');
    assert.equal(row.customLogoKey, null);
  });
});

describe('white-box logos on coloured headers (no pasted rectangles)', () => {
  // "Emblem + dark company name" on a white box, as a JPEG — the common real-world logo.
  const boxedJpeg = () => sharp({ create: { width: 360, height: 120, channels: 3, background: '#ffffff' } })
    .composite([{
      input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120">' +
        '<polygon points="60,10 105,35 105,85 60,110 15,85 15,35" fill="#2563eb"/>' +
        '<rect x="130" y="35" width="200" height="50" rx="6" fill="#0f172a"/></svg>'),
      top: 0, left: 0
    }]).jpeg({ quality: 85 }).toBuffer();
  const cornerAlpha = async (png) => (await sharp(png).ensureAlpha().raw().toBuffer())[3];

  test('the upload is stored with its white box removed and a reversed variant for dark headers', async () => {
    const view = await (await upload(await boxedJpeg(), { type: 'image/jpeg', name: 'logo.jpg' })).json();
    assert.equal(view.logoCleaned, true);
    assert.equal(view.logoAppearance.background, 'transparent');
    const served = Buffer.from(await (await fetch(`${base}${view.logoUrl}`)).arrayBuffer());
    assert.equal(await cornerAlpha(served), 0, 'the served logo has no box');
    assert.match(view.logoUrlReversed, /\/[0-9a-f]{24}\.png$/);
    assert.equal((await fetch(`${base}${view.logoUrlReversed}`)).status, 200);

    const minimal = view.themes.find((t) => t.id === 'minimal').logoBadge;
    const corporate = view.themes.find((t) => t.id === 'corporate').logoBadge;
    assert.equal(minimal.mode, 'plain', 'straight on the light header');
    assert.equal(minimal.variant, null);
    assert.deepEqual([corporate.mode, corporate.variant], ['plain', 'reversed'], 'straight on the dark header, lettering reversed');
  });

  test('the widget gets the variant matching the applied design', async () => {
    const view = await (await upload(await boxedJpeg(), { type: 'image/jpeg', name: 'logo.jpg' })).json();
    await json('/ws/branding/select', { method: 'POST', body: { themeId: 'corporate' } });
    assert.equal((await widgetTheme()).logoUrl, view.logoUrlReversed);
    branding.clearThemeCache();
    await json('/ws/branding/select', { method: 'POST', body: { themeId: 'minimal' } });
    assert.equal((await widgetTheme()).logoUrl, view.logoUrl);
  });

  test('a logo stored by an older pipeline is re-cleaned on the next brand-kit save (existing tenants)', async () => {
    await upload(await boxedJpeg(), { type: 'image/jpeg', name: 'logo.jpg' });
    // Simulate a logo uploaded before box removal existed: the stored image
    // still has its white box, and no pipeline version is recorded.
    liveAsset().data = await sharp(await boxedJpeg()).resize({ width: 300 }).png().toBuffer();
    row.brandTokens = { ...row.brandTokens, customLogoPipeline: null, customLogoCleaned: false };
    const before = row.customLogoKey;
    const view = await (await json('/ws/branding', { method: 'PATCH', body: { primaryColor: '#0d9488' } })).json();
    assert.notEqual(view.logoUrl.split('/').pop(), `${before}.png`, 'a new, cleaned image');
    assert.equal(view.logoCleaned, true);
    assert.equal(view.logoSource, 'upload', 'still the client\'s own logo');
    const served = Buffer.from(await (await fetch(`${base}${view.logoUrl}`)).arrayBuffer());
    assert.equal(await cornerAlpha(served), 0, 'the box is gone');
    const again = await (await json('/ws/branding', { method: 'PATCH', body: { primaryColor: '#0d9488' } })).json();
    assert.equal(again.logoUrl, view.logoUrl, 'an up-to-date logo is not re-processed');
  });

  test('a replaced logo\'s reversed URL stops resolving too', async () => {
    const first = await (await upload(await boxedJpeg(), { type: 'image/jpeg', name: 'logo.jpg' })).json();
    await upload(await png(80, 80, { r: 200, g: 30, b: 30, alpha: 1 }));
    assert.equal((await fetch(`${base}${first.logoUrlReversed}`)).status, 404);
  });
});

describe('DELETE /branding/logo (Remove logo)', () => {
  test('removes an uploaded logo: the widget falls back to the initial and the image URL is gone', async () => {
    const view = await (await upload(await png())).json();
    await json('/ws/branding/select', { method: 'POST', body: { themeId: 'vibrant' } });
    const res = await json('/ws/branding/logo', { method: 'DELETE' });
    assert.equal(res.status, 200);
    const after = await res.json();
    assert.equal(after.logoUrl, null);
    assert.equal(after.logoSource, null);
    assert.equal(assets.size, 0, 'every image row of the tenant is purged');
    assert.equal((await widgetTheme()).logoUrl, null, 'the widget shows the initial');
    assert.equal((await fetch(`${base}${view.logoUrl}`)).status, 404);
  });

  test('removes a scanned or linked logo too', async () => {
    await json('/ws/branding', { method: 'PATCH', body: { logoUrl: 'https://cdn.acme.test/logo.png' } });
    const after = await (await json('/ws/branding/logo', { method: 'DELETE' })).json();
    assert.equal(after.logoUrl, null);
    assert.equal(row.logoUrl, null);
  });
});

describe('GET /api/v1/public/brand-assets/logo/:tenantId/:key.png', () => {
  test('malformed or unknown keys are 404, never a stack trace or another tenant\'s logo', async () => {
    await upload(await png());
    const { key } = liveAsset();
    for (const path of [
      `/logo/${TENANT.id}/${'0'.repeat(24)}.png`,
      `/logo/other-tenant/${key}.png`,
      `/logo/${TENANT.id}/${key}.svg`,
      `/logo/${TENANT.id}/..%2F..%2Fetc%2Fpasswd`
    ]) {
      assert.equal((await fetch(`${base}/api/v1/public/brand-assets${path}`)).status, 404, path);
    }
  });
});

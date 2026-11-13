const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Small limits, read by the route module at load (this file runs in its own process).
process.env.BRAND_ASSET_RATE_LIMIT_MAX = '8';
process.env.BRAND_ASSET_CACHE_MAX_BYTES = String(10 * 1024);

const prisma = require('../../src/lib/prisma');
const { resetStore } = require('../../src/lib/sharedStore');
const branding = require('../../src/services/branding');
const brandAssetRouter = require('../../src/routes/brandAssets.routes');

// Public logo delivery hardening (adversarial review, Major):
//  - a guessed key must cost a few short columns, never image bytes;
//  - exactly one binary column is read for a real key;
//  - per-IP rate limit;
//  - the in-memory cache is bounded by bytes (LRU) and re-validated, so a
//    replaced or removed logo stops being served.

const T = 'tenant-a';
const K1 = '1'.repeat(24);
const K2 = '2'.repeat(24);
const KR = 'f'.repeat(24);
let rows; // (tenantId, key) → row
let queries; // every select the route made
let server;
let base;
let realAsset;

const pick = (a, select) => (a ? Object.fromEntries(Object.keys(select).map((f) => [f, a[f]])) : null);

before(async () => {
  realAsset = prisma.tenantLogoAsset;
  prisma.tenantLogoAsset = {
    findFirst: async ({ where, select }) => {
      queries.push({ op: 'findFirst', select: Object.keys(select || {}) });
      return pick([...rows.values()].find((a) => a.tenantId === where.tenantId &&
        where.OR.some((c) => (c.key !== undefined && a.key === c.key) || (c.reversedKey !== undefined && a.reversedKey === c.reversedKey))), select);
    },
    findUnique: async ({ where, select }) => {
      queries.push({ op: 'findUnique', select: Object.keys(select || {}) });
      const a = rows.get(`${where.tenantId_key.tenantId}/${where.tenantId_key.key}`);
      return a ? pick(a, select) : null;
    }
  };
  const app = express();
  app.set('trust proxy', true); // X-Forwarded-For picks the visitor IP per test
  app.use('/assets', brandAssetRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); prisma.tenantLogoAsset = realAsset; });
beforeEach(() => {
  resetStore();
  brandAssetRouter.clearCache();
  queries = [];
  rows = new Map([[`${T}/${K1}`, { tenantId: T, key: K1, mimeType: 'image/png', data: Buffer.alloc(3000, 1), reversedKey: KR, reversedData: Buffer.alloc(3000, 2) }]]);
});

const get = (key, ip = '203.0.113.1', tenant = T) => fetch(`${base}/assets/logo/${tenant}/${key}.png`, { headers: { 'x-forwarded-for': ip } });

describe('no image bytes are read until the key is known to be live', () => {
  test('a guessed key: one keys-only lookup, no binary column selected, 404', async () => {
    assert.equal((await get('a'.repeat(24))).status, 404);
    assert.equal(queries.length, 1);
    assert.equal(queries[0].op, 'findFirst');
    assert.ok(!queries[0].select.includes('data') && !queries[0].select.includes('reversedData'), `selected ${queries[0].select}`);
  });

  test('the main key reads exactly the data column; the reversed key exactly reversedData', async () => {
    const main = await get(K1);
    assert.equal(main.status, 200);
    assert.equal(Buffer.from(await main.arrayBuffer())[0], 1);
    assert.deepEqual(queries.map((q) => q.select), [['key', 'reversedKey', 'mimeType'], ['data']]);
    queries = [];
    const rev = await get(KR);
    assert.equal(rev.status, 200);
    assert.equal(Buffer.from(await rev.arrayBuffer())[0], 2);
    assert.deepEqual(queries.map((q) => q.select), [['key', 'reversedKey', 'mimeType'], ['reversedData']]);
  });

  test('getLogoAsset / resolveLogoKey refuse malformed input without querying', async () => {
    for (const [t, k] of [[T, 'zz'], [T, 'A'.repeat(24)], [T, `${K1}0`], [{}, K1], ['x'.repeat(200), K1], [T, null]]) {
      assert.equal(await branding.getLogoAsset(t, k), null);
    }
    assert.equal(queries.length, 0);
  });
});

describe('per-IP rate limit', () => {
  test('a client past the limit gets 429 with Retry-After; another client is unaffected', async () => {
    for (let i = 0; i < 8; i++) assert.notEqual((await get('a'.repeat(24), '198.51.100.7')).status, 429);
    const limited = await get(K1, '198.51.100.7');
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
    assert.equal((await get(K1, '198.51.100.8')).status, 200);
  });
});

describe('byte-bounded LRU cache with re-validation', () => {
  test('the cache never exceeds its byte budget; the least recently used entry goes first', async () => {
    for (let i = 0; i < 6; i++) {
      const key = String(i).repeat(24).slice(0, 24).replace(/[^0-9a-f]/g, 'a');
      rows.set(`${T}/${key}`, { tenantId: T, key, mimeType: 'image/png', data: Buffer.alloc(3000, i), reversedKey: null, reversedData: null });
      assert.equal((await get(key, `192.0.2.${i}`)).status, 200);
      const { bytes, maxBytes } = brandAssetRouter.cacheStats();
      assert.ok(bytes <= maxBytes, `cache at ${bytes} bytes, budget ${maxBytes}`);
    }
    assert.equal(brandAssetRouter.cacheStats().entries, 3, '3 × 3000 B fit in 10 KiB');
  });

  test('an image bigger than the whole budget is served but never cached', async () => {
    rows.set(`${T}/${K2}`, { tenantId: T, key: K2, mimeType: 'image/png', data: Buffer.alloc(20 * 1024, 7), reversedKey: null, reversedData: null });
    assert.equal((await get(K2)).status, 200);
    assert.equal(brandAssetRouter.cacheStats().entries, 0);
  });

  test('a cached logo that was removed stops being served once re-validated', async () => {
    assert.equal((await get(K1)).status, 200); // cached
    rows.clear(); // the logo was replaced or removed
    assert.equal((await get(K1)).status, 200, 'within the re-validation window the cache still answers');
    const realNow = Date.now;
    Date.now = () => realNow() + 31 * 1000;
    try {
      queries = [];
      assert.equal((await get(K1)).status, 404, 'after it, a keys-only check finds it gone');
      assert.ok(queries.every((q) => !q.select.includes('data')), 're-validation reads no bytes');
      assert.equal(brandAssetRouter.cacheStats().entries, 0, 'and it is evicted');
    } finally {
      Date.now = realNow;
    }
  });
});

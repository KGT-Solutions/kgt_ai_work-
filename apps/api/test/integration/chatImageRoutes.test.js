const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// The scoped, content-addressed serving of visitor chat images. The rate-limit
// ceiling is set low (before the router is required, when the limiter is built)
// so the limit can be reached without hundreds of requests.
process.env.CHAT_IMAGE_RATE_LIMIT_MAX = '2';

const prisma = require('../../src/lib/prisma');
const { resetStore } = require('../../src/lib/sharedStore');
const router = require('../../src/routes/chatImages.routes');

const KEY = 'a'.repeat(32); // a valid 32-hex content key
const BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
let server, base;

before(async () => {
  prisma.chatImageAsset = { findUnique: async ({ where }) =>
    (where.tenantId_key.tenantId === 't1' && where.tenantId_key.key === KEY ? { data: BYTES, mimeType: 'image/png' } : null) };
  const app = express();
  app.set('trust proxy', true);
  app.use('/api/v1/public/chat-images', router);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => resetStore());

const get = (path, ip = '5.0.0.1') => fetch(`${base}/api/v1/public/chat-images/${path}`, { headers: { 'x-forwarded-for': ip } });

describe('GET /chat-images/:tenantId/:key', () => {
  test('serves the stored bytes with the stored content type and hardened headers', async () => {
    const res = await get(`t1/${KEY}.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('cache-control'), /private/);
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
    const body = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(body, BYTES);
  });

  test('the extension is optional — a bare key resolves', async () => {
    assert.equal((await get(`t1/${KEY}`)).status, 200);
  });

  test('404 for an unknown key, a wrong tenant, or a malformed key', async () => {
    // Distinct IPs so the low rate-limit ceiling doesn't turn a 404 into a 429.
    assert.equal((await get(`t1/${'b'.repeat(32)}.png`, '1.0.0.1')).status, 404);
    assert.equal((await get(`t2/${KEY}.png`, '1.0.0.2')).status, 404, 'scoped to the tenant in the path');
    assert.equal((await get('t1/short.png', '1.0.0.3')).status, 404);
    assert.equal((await get(`t1/${KEY}.gif`, '1.0.0.4')).status, 404, 'only image extensions are accepted');
  });

  test('rate-limits a flood of requests from one address', async () => {
    assert.equal((await get(`t1/${KEY}`, '9.9.9.9')).status, 200);
    assert.equal((await get(`t1/${KEY}`, '9.9.9.9')).status, 200);
    assert.equal((await get(`t1/${KEY}`, '9.9.9.9')).status, 429, 'the 3rd within the window is limited');
  });
});

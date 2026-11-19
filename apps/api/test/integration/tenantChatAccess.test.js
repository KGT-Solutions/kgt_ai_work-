const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.TENANT_CHAT_VISITOR_RATE_LIMIT_MAX = '3';

const prisma = require('../../src/lib/prisma');
const { resetStore } = require('../../src/lib/sharedStore');
const tenantChatRouter = require('../../src/routes/tenantChat.routes');
const { hashApiKey, normalizeOrigin, normalizeAllowedOrigins, originAllowed } = require('../../src/utils/tenantApiKeys');

// Public widget access control (review #2):
//  - slug enumeration: an unknown or inactive tenant answers exactly like a bad key (401);
//  - allowed origins: a key restricted to the tenant's websites refuses other sites' browsers (403);
//  - IPv6 visitors are rate limited per /64, not per address.
// Tenants and keys are in-memory stand-ins.

const TENANTS = [
  { id: 't-a', slug: 'acme', active: true, key: `tk_${'a'.repeat(48)}`, allowedOrigins: [] },
  { id: 't-b', slug: 'globex', active: true, key: `tk_${'b'.repeat(48)}`, allowedOrigins: ['https://www.globex.com', 'https://shop.globex.com'] },
  { id: 't-c', slug: 'dormant', active: false, key: `tk_${'c'.repeat(48)}`, allowedOrigins: [] }
];
let server;
let base;
let keyLookups = 0;

before(async () => {
  prisma.tenant.findUnique = async ({ where }) => TENANTS.find((t) => t.slug === where.slug) || null;
  prisma.tenantApiKey.findUnique = async ({ where }) => {
    keyLookups += 1;
    const t = TENANTS.find((x) => hashApiKey(x.key) === where.keyHash);
    return t ? { id: `k-${t.id}`, tenantId: t.id, revokedAt: null, lastUsedAt: new Date(), allowedOrigins: t.allowedOrigins } : null;
  };
  const app = express();
  app.set('trust proxy', true); // lets each test choose the visitor's IP via X-Forwarded-For
  app.use(express.json());
  app.use('/api/v1/tenant-chat', tenantChatRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => { resetStore(); keyLookups = 0; });

// An empty chat body reaches the handler and gets 400: "past every gate".
const chat = (slug, { key, origin, ip } = {}) => fetch(`${base}/api/v1/tenant-chat/${slug}/chat`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(key ? { 'x-tenant-api-key': key } : {}),
    ...(origin !== undefined ? { origin } : {}),
    ...(ip ? { 'x-forwarded-for': ip } : {})
  },
  body: '{}'
});

describe('no slug enumeration: every authentication failure looks the same', () => {
  test('unknown slug, inactive tenant, missing key, wrong key and another tenant\'s key → identical 401', async () => {
    const [acme, globex, dormant] = TENANTS;
    const cases = [
      ['no-such-company', acme.key],
      ['dormant', dormant.key],
      ['acme', undefined],
      ['acme', `tk_${'z'.repeat(48)}`],
      ['acme', globex.key]
    ];
    const bodies = new Set();
    for (const [slug, key] of cases) {
      const res = await chat(slug, { key });
      assert.equal(res.status, 401, `${slug} / ${key ? key.slice(0, 5) : 'no key'}`);
      bodies.add(await res.text());
    }
    assert.equal(bodies.size, 1, `one response body for all of them, got ${[...bodies].join(' | ')}`);
  });

  test('the key lookup runs for an unknown slug too, so timing doesn\'t separate the cases', async () => {
    await chat('no-such-company', { key: TENANTS[0].key });
    assert.equal(keyLookups, 1);
  });

  test('the theme endpoint is gated the same way', async () => {
    const res = await fetch(`${base}/api/v1/tenant-chat/no-such-company/theme`, { headers: { 'x-tenant-api-key': TENANTS[0].key } });
    assert.equal(res.status, 401);
  });
});

describe('allowed origins on a widget key', () => {
  const globex = TENANTS[1];

  test('a listed website is let through', async () => {
    assert.equal((await chat('globex', { key: globex.key, origin: 'https://www.globex.com' })).status, 400);
    assert.equal((await chat('globex', { key: globex.key, origin: 'https://SHOP.globex.com' })).status, 400, 'case-insensitive host');
  });

  test('any other website gets 403 — including look-alikes, other schemes and ports, and the opaque "null" origin', async () => {
    for (const origin of ['https://evil.example', 'https://www.globex.com.evil.example', 'http://www.globex.com', 'https://www.globex.com:8443', 'null']) {
      const res = await chat('globex', { key: globex.key, origin });
      assert.equal(res.status, 403, origin);
      assert.match((await res.json()).error, /not enabled for this website/);
    }
  });

  test('no Origin header (a server-to-server call) is allowed through to the rate limits', async () => {
    assert.equal((await chat('globex', { key: globex.key })).status, 400);
  });

  test('a key with no list works from any website (existing keys are unaffected)', async () => {
    assert.equal((await chat('acme', { key: TENANTS[0].key, origin: 'https://anything.example' })).status, 400);
  });

  test('a bad key is still 401, never 403 — the origin check comes after authentication', async () => {
    assert.equal((await chat('globex', { key: `tk_${'z'.repeat(48)}`, origin: 'https://evil.example' })).status, 401);
  });
});

describe('origin helpers', () => {
  test('normalizeOrigin keeps scheme, host and port only, and refuses non-http(s) or credentialed URLs', () => {
    assert.equal(normalizeOrigin('https://Shop.Acme.com/some/path?x=1'), 'https://shop.acme.com');
    assert.equal(normalizeOrigin('http://localhost:3000'), 'http://localhost:3000');
    assert.equal(normalizeOrigin('https://acme.com:443'), 'https://acme.com');
    for (const bad of ['', 'acme.com', 'javascript:alert(1)', 'ftp://acme.com', 'https://user:pw@acme.com', 'null', 'x'.repeat(300)]) {
      assert.equal(normalizeOrigin(bad), null, bad);
    }
  });

  test('normalizeAllowedOrigins validates every entry, de-duplicates and caps the list', () => {
    assert.deepEqual(normalizeAllowedOrigins(['https://a.com/', 'https://A.com', 'https://b.com']), { ok: true, origins: ['https://a.com', 'https://b.com'] });
    assert.equal(normalizeAllowedOrigins('https://a.com').ok, false);
    assert.match(normalizeAllowedOrigins(['https://a.com', 'not a site']).error, /not a website address/);
    assert.match(normalizeAllowedOrigins(Array.from({ length: 21 }, (_, i) => `https://s${i}.com`)).error, /at most 20/);
  });

  test('originAllowed', () => {
    assert.equal(originAllowed([], 'https://x.com'), true);
    assert.equal(originAllowed(undefined, 'https://x.com'), true);
    assert.equal(originAllowed(['https://a.com'], undefined), true);
    assert.equal(originAllowed(['https://a.com'], 'https://a.com'), true);
    assert.equal(originAllowed(['https://a.com'], 'https://b.com'), false);
    assert.equal(originAllowed(['https://a.com'], 'null'), false);
  });
});

describe('IPv6 visitors are limited per /64', () => {
  const acme = TENANTS[0];

  test('rotating addresses inside one /64 does not escape the per-visitor limit', async () => {
    for (let i = 1; i <= 3; i++) {
      assert.equal((await chat('acme', { key: acme.key, ip: `2001:db8:1234:5678::${i}` })).status, 400);
    }
    assert.equal((await chat('acme', { key: acme.key, ip: '2001:db8:1234:5678:ffff:eeee:dddd:cccc' })).status, 429);
  });

  test('a different /64 has its own budget', async () => {
    for (let i = 1; i <= 3; i++) await chat('acme', { key: acme.key, ip: `2001:db8:1234:5678::${i}` });
    assert.equal((await chat('acme', { key: acme.key, ip: '2001:db8:1234:9999::1' })).status, 400);
  });

  test('IPv4 visitors are still limited per address', async () => {
    for (let i = 0; i < 3; i++) await chat('acme', { key: acme.key, ip: '203.0.113.7' });
    assert.equal((await chat('acme', { key: acme.key, ip: '203.0.113.7' })).status, 429);
    assert.equal((await chat('acme', { key: acme.key, ip: '203.0.113.8' })).status, 400);
  });
});

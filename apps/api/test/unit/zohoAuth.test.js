const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// ENCRYPTION_KEY must be set before encryption.js derives its key.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-for-crm';
const { encrypt } = require('../../src/utils/encryption');
const {
  resolveDomains, normalizeRegion, getAccessToken, tokenIsFresh, isZohoConfigured, CrmError
} = require('../../src/services/crm/zohoAuth');

let prev;
beforeEach(() => {
  prev = { id: process.env.ZOHO_CLIENT_ID, secret: process.env.ZOHO_CLIENT_SECRET };
  process.env.ZOHO_CLIENT_ID = 'zoho-client';
  process.env.ZOHO_CLIENT_SECRET = 'zoho-secret';
});
afterEach(() => {
  for (const [k, v] of [['ZOHO_CLIENT_ID', prev.id], ['ZOHO_CLIENT_SECRET', prev.secret]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const integration = (over = {}) => ({
  id: 'int-1', region: 'in',
  accessToken: null, refreshToken: encrypt('rt-abc'), tokenExpiry: null, ...over
});

describe('zohoAuth: regional domains', () => {
  test('resolves the India, global and EU data centres', () => {
    assert.deepEqual(resolveDomains('in'), { region: 'in', accounts: 'https://accounts.zoho.in', api: 'https://www.zohoapis.in' });
    assert.equal(resolveDomains('com').api, 'https://www.zohoapis.com');
    assert.equal(resolveDomains('eu').api, 'https://www.zohoapis.eu');
  });

  test('a leading dot and case are tolerated; an unknown region falls back to .com', () => {
    assert.equal(normalizeRegion('.IN'), 'in');
    assert.equal(normalizeRegion('mars'), 'com');
    assert.equal(resolveDomains('zz').api, 'https://www.zohoapis.com');
  });

  test('isZohoConfigured reflects the OAuth client env', () => {
    assert.equal(isZohoConfigured(), true);
    delete process.env.ZOHO_CLIENT_SECRET;
    assert.equal(isZohoConfigured(), false);
  });
});

describe('zohoAuth: getAccessToken', () => {
  test('reuses a still-fresh stored token without refreshing', async () => {
    const int = integration({ accessToken: encrypt('at-fresh'), tokenExpiry: new Date(NOW + 10 * 60 * 1000) });
    let called = false;
    const r = await getAccessToken({ integration: int, fetchImpl: async () => { called = true; return {}; }, now: NOW });
    assert.equal(r.accessToken, 'at-fresh');
    assert.equal(r.refreshed, false);
    assert.equal(r.apiDomain, 'https://www.zohoapis.in');
    assert.equal(called, false, 'no network call when the token is fresh');
  });

  test('refreshes an expired token at the tenant data centre and persists it encrypted', async () => {
    const int = integration({ accessToken: encrypt('at-old'), tokenExpiry: new Date(NOW - 1000) });
    let seenUrl = null, saved = null;
    const fetchImpl = async (url) => {
      seenUrl = url;
      return { ok: true, json: async () => ({ access_token: 'at-new', expires_in: 3600, api_domain: 'https://www.zohoapis.in' }) };
    };
    const prisma = { tenantCRMIntegration: { update: async ({ data }) => { saved = data; } } };
    const r = await getAccessToken({ integration: int, prisma, fetchImpl, now: NOW });

    assert.equal(r.accessToken, 'at-new');
    assert.equal(r.refreshed, true);
    assert.match(seenUrl, /^https:\/\/accounts\.zoho\.in\/oauth\/v2\/token$/, 'refresh hits the India accounts host');
    assert.ok(saved, 'the refreshed token was persisted');
    assert.notEqual(saved.accessToken, 'at-new', 'stored token is ciphertext, never plaintext');
    assert.ok(saved.tokenExpiry instanceof Date);
  });

  test('a missing refresh token is a 400, not a crash', async () => {
    const int = integration({ refreshToken: null });
    await assert.rejects(() => getAccessToken({ integration: int, fetchImpl: async () => ({}), now: NOW }),
      (e) => e instanceof CrmError && e.statusCode === 400);
  });

  test("Zoho's 200-with-error body is surfaced as a CrmError", async () => {
    const int = integration({ tokenExpiry: new Date(NOW - 1) });
    await assert.rejects(
      () => getAccessToken({ integration: int, fetchImpl: async () => ({ ok: true, json: async () => ({ error: 'invalid_code' }) }), now: NOW }),
      (e) => e instanceof CrmError && /invalid_code/.test(e.message)
    );
  });

  test('a 500 from the token endpoint is retryable; a 400 is not', async () => {
    const int = integration({ tokenExpiry: new Date(NOW - 1) });
    await assert.rejects(
      () => getAccessToken({ integration: int, fetchImpl: async () => ({ ok: false, status: 500 }), now: NOW }),
      (e) => e instanceof CrmError && e.retryable === true
    );
    await assert.rejects(
      () => getAccessToken({ integration: int, fetchImpl: async () => ({ ok: false, status: 400 }), now: NOW }),
      (e) => e instanceof CrmError && e.retryable === false
    );
  });

  test('tokenIsFresh accounts for the expiry skew', () => {
    assert.equal(tokenIsFresh({ accessToken: 'x', tokenExpiry: new Date(NOW + 10 * 60 * 1000) }, NOW), true);
    assert.equal(tokenIsFresh({ accessToken: 'x', tokenExpiry: new Date(NOW + 1000) }, NOW), false, 'within the skew window = stale');
    assert.equal(tokenIsFresh({ accessToken: null, tokenExpiry: new Date(NOW + 10 * 60 * 1000) }, NOW), false);
  });
});

describe('zohoAuth: single-flight refresh', () => {
  const minted = (n) => ({ ok: true, json: async () => ({ access_token: `at-${n}`, expires_in: 3600, api_domain: 'https://www.zohoapis.in' }) });
  const slowZoho = () => {
    const counter = { refreshes: 0 };
    const fetchImpl = async () => {
      counter.refreshes += 1;
      const n = counter.refreshes;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return minted(n);
    };
    return { counter, fetchImpl };
  };
  const countingPrisma = () => {
    const counter = { saves: 0 };
    return { counter, prisma: { tenantCRMIntegration: { update: async () => { counter.saves += 1; } } } };
  };

  test('concurrent callers for one integration share one refresh and one save', async () => {
    const { counter, fetchImpl } = slowZoho();
    const { counter: db, prisma } = countingPrisma();
    const row = integration({ id: 'int-sf-1' });
    const results = await Promise.all(Array.from({ length: 5 }, () => getAccessToken({ integration: row, prisma, fetchImpl, now: NOW })));
    assert.equal(counter.refreshes, 1);
    assert.equal(db.saves, 1);
    assert.ok(results.every((r) => r.accessToken === 'at-1' && r.refreshed));
    // Once it has settled, the next stale call refreshes again rather than reusing it.
    await getAccessToken({ integration: row, prisma, fetchImpl, now: NOW });
    assert.equal(counter.refreshes, 2);
  });

  test('different integrations refresh independently', async () => {
    const { counter, fetchImpl } = slowZoho();
    await Promise.all([
      getAccessToken({ integration: integration({ id: 'int-sf-a' }), fetchImpl, now: NOW }),
      getAccessToken({ integration: integration({ id: 'int-sf-b' }), fetchImpl, now: NOW })
    ]);
    assert.equal(counter.refreshes, 2);
  });

  test('a failed refresh rejects every waiter and is not remembered', async () => {
    let calls = 0;
    const failing = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return { ok: false, status: 401 }; };
    const row = integration({ id: 'int-sf-fail' });
    const outcomes = await Promise.allSettled([1, 2, 3].map(() => getAccessToken({ integration: row, fetchImpl: failing, now: NOW })));
    assert.ok(outcomes.every((o) => o.status === 'rejected' && o.reason instanceof CrmError));
    assert.equal(calls, 1);
    const { fetchImpl } = slowZoho();
    assert.equal((await getAccessToken({ integration: row, fetchImpl, now: NOW })).accessToken, 'at-1');
  });

  test('force skips a still-fresh stored token (Zoho just rejected it)', async () => {
    const { counter, fetchImpl } = slowZoho();
    const row = integration({ id: 'int-sf-force', accessToken: encrypt('old-token'), tokenExpiry: new Date(NOW + 30 * 60 * 1000) });
    assert.equal((await getAccessToken({ integration: row, fetchImpl, now: NOW })).accessToken, 'old-token');
    assert.equal(counter.refreshes, 0);
    const forced = await getAccessToken({ integration: row, fetchImpl, now: NOW, force: true });
    assert.equal(forced.accessToken, 'at-1');
    assert.equal(counter.refreshes, 1);
  });
});
